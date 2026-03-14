// ── Ayodhya Protocol: Lanka Reforged ── Main Game Class ──
// Supports single-player (LocalSim) and multiplayer (Network).
// Wires HapticsManager, PerformanceManager, and AudioManager.

import { Renderer } from './Renderer';
import { Network } from './Network';
import { LocalSim } from './LocalSim';
import { PlayerController } from './PlayerController';
import { World } from './World';
import { HUD } from './HUD';
import { Interpolation } from './Interpolation';
import { Targeting } from './Targeting';
import { HapticsManager, HapticMotif } from './HapticsManager';
import { PerformanceManager } from './PerformanceManager';
import { AudioManager, SFX } from './AudioManager';
import { TextureLoader } from './TextureLoader';
import { GameSnapshot, PlayerState, ProjectileState, PlayerStatus, BossPhase, InputFlag, AbilityType, SpecialArrowType, AstraCombo, KarmaScore, EncounterPhase } from '@shared/types';
import { DamageTargetType } from '@shared/protocol';
import { MapRenderer, WaypointType } from './MapRenderer';

export class Game {
  private canvas: HTMLCanvasElement;
  private renderer!: Renderer;
  private network: Network | null = null;
  private localSim: LocalSim | null = null;
  private controller!: PlayerController;
  private world!: World;
  private hud!: HUD;
  private interpolation!: Interpolation;
  private targeting!: Targeting;
  private haptics!: HapticsManager;
  private perfManager!: PerformanceManager;
  private audio!: AudioManager;
  private mapRenderer!: MapRenderer;
  private localPlayerId = -1;
  private lastSnapshot: GameSnapshot | null = null;
  private running = false;
  private useSinglePlayer = false;
  private frameIndex = 0;

  // ── Hit-stop: freeze the sim briefly on a successful enemy hit ──────
  private hitStopEnd = 0;

  // ── Kill slowdown: slow down time when enemy dies ──────────────────
  private killSlowdownTimer = 0;

  // ── Boss phase tracking for phase-shift events ─────────────────────
  private lastBossPhase: BossPhase | null = null;

  // ── Lakshman choice UI state ──────────────────────────────────────
  private lakshmanChoiceActive = false;

  // ── Chapter 6 → 7 advance tracking ───────────────────────────────
  private chapter6ReadyToAdvance = false;

  // ── Tutorial and backstory tracking ─────────────────────────────
  private tutorialComplete = false;
  private _backstoryKeyListener = false;

  // ── Map / pause state ──────────────────────────────────────────
  private mapOpen = false;
  private gamePaused = false;
  private gameStartTime = 0;

  // ── Day/Night cycle ─────────────────────────────────────────
  private gameTimeOfDay = 0.0; // 0=dawn, 0.25=noon, 0.5=dusk, 0.75=midnight

  private triggerHitStop(ms = 70): void {
    this.hitStopEnd = performance.now() + ms;
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init(): Promise<void> {
    this.renderer = new Renderer(this.canvas);
    await this.renderer.init();

    this.world = new World(this.renderer);

    // PBR texture loading — safe per-texture fallback (no more white-screen)
    try {
      const loader = new TextureLoader(this.renderer.scene);
      const assets = await loader.loadAll();
      this.world.setAssets(assets);
      console.log('[Game] PBR textures loaded (safe fallback enabled)');
    } catch (e) {
      console.warn('[Game] Texture loading failed, using flat-colour fallback:', e);
    }

    await this.world.build();

    this.hud = new HUD();
    this.interpolation = new Interpolation();
    this.targeting = new Targeting(this.renderer.scene, this.canvas);
    this.haptics = new HapticsManager();
    this.perfManager = new PerformanceManager(this.renderer.scene);
    this.audio = new AudioManager();

    // Initialize map renderer
    const mapCanvas = document.getElementById('mapCanvas') as HTMLCanvasElement;
    const miniMapCanvas = document.getElementById('miniMapCanvas') as HTMLCanvasElement;
    this.mapRenderer = new MapRenderer(mapCanvas, miniMapCanvas);

    // Attach pipeline for dynamic quality scaling
    this.perfManager.attachPipeline(this.renderer.pipeline, this.renderer.shadowGenerator);
  }

  /** Called after the user clicks "BEGIN OPERATION" on the instructions screen */
  start(): void {
    this.controller = new PlayerController(this.canvas, this.renderer.camera);
    this.audio.play(SFX.UIStart);

    // Try connecting to server; fall back to single-player
    this.tryConnect();

    this.running = true;
    document.getElementById('hud')?.classList.add('visible');
    this.renderer.engine.runRenderLoop(() => this.gameLoop());
  }

  private tryConnect(): void {
    try {
      const ws = new WebSocket(`ws://${window.location.hostname || 'localhost'}:9001`);
      ws.binaryType = 'arraybuffer';

      const timeout = setTimeout(() => {
        ws.close();
        this.startSinglePlayer();
      }, 2000);

      ws.onopen = () => {
        clearTimeout(timeout);
        this.setupMultiplayer();
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        ws.close();
        if (!this.useSinglePlayer && !this.network) {
          this.startSinglePlayer();
        }
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        if (!this.useSinglePlayer && !this.network) {
          this.startSinglePlayer();
        }
      };

      (this as any)._pendingWs = ws;
    } catch {
      this.startSinglePlayer();
    }
  }

  private setupMultiplayer(): void {
    console.log('[Game] Multiplayer connected');
    this.network = new Network();

    this.network.onPlayerJoined = (id: number) => {
      if (this.localPlayerId === -1) this.localPlayerId = id;
      this.world.addPlayerMesh(id, id === this.localPlayerId);
    };
    this.network.onPlayerLeft = (id: number) => this.world.removePlayerMesh(id);
    this.network.onSnapshot = (snap: GameSnapshot) => {
      this.lastSnapshot = snap;
      this.interpolation.pushSnapshot(snap);
    };
    this.network.onProjectileSpawn = (proj: ProjectileState) => this.world.spawnProjectile(proj);
    this.network.onDamage = (targetType: DamageTargetType, targetId: number, damage: number) => {
      this.world.showDamageNumber(targetType, targetId, damage);
      if (targetType === DamageTargetType.Player && targetId === this.localPlayerId) {
        this.hud.flashDamage();
        this.controller?.triggerShake(0.22);
        this.haptics.play(HapticMotif.PlayerDamaged);
        this.audio.play(SFX.PlayerDamaged);
      } else {
        this.triggerHitStop(68);
        this.controller?.triggerShake(0.06);
        this.hud.registerHit();
        if (targetType === DamageTargetType.Boss) {
          this.haptics.play(HapticMotif.ArrowHitBoss);
        } else {
          this.haptics.play(HapticMotif.ArrowHitEnemy);
        }
        this.audio.play(SFX.ArrowHit);
      }
    };
    this.network.onGameOver = (won: boolean) => {
      this.hud.showGameOver(won);
      this.haptics.play(HapticMotif.GameOver);
      this.audio.play(won ? SFX.Victory : SFX.Defeat);
    };

    this.network.connect();
  }

  private startSinglePlayer(): void {
    console.log('[Game] Starting single-player mode');
    this.useSinglePlayer = true;
    this.localSim = new LocalSim();
    this.localPlayerId = this.localSim.playerId;
    this.world.addPlayerMesh(this.localPlayerId, true);

    this.localSim.onObstaclesInit = (obstacles) => {
      this.world.spawnObstacles(obstacles);
    };

    this.localSim.onDamage = (targetType: DamageTargetType, targetId: number, damage: number) => {
      this.world.showDamageNumber(targetType, targetId, damage);
      if (targetType === DamageTargetType.Player && targetId === this.localPlayerId) {
        this.hud.flashDamage();
        this.controller?.triggerShake(0.22);
        this.haptics.play(HapticMotif.PlayerDamaged);
        this.audio.play(SFX.PlayerDamaged);
      } else {
        this.triggerHitStop(68);
        this.controller?.triggerShake(0.06);
        this.hud.registerHit();
        if (targetType === DamageTargetType.Boss) {
          this.haptics.play(HapticMotif.ArrowHitBoss);
          this.audio.play(SFX.ArrowHit);
        } else if (targetType === DamageTargetType.Enemy) {
          this.haptics.play(HapticMotif.ArrowHitEnemy);
          this.audio.play(SFX.ArrowHit);
          // Enemy hit flash
          this.world.flashEnemyHit(targetId);
          // Check for enemy kill → kill feed
          const snap = this.lastSnapshot;
          if (snap) {
            const enemy = snap.enemies.find(e => e.id === targetId);
            if (enemy && enemy.hp - damage <= 0) {
              this.hud.addKillFeedEntry(`Sentinel #${targetId} eliminated`, '#ff6633');
              this.audio.play(SFX.EnemyDeath);
              // Trigger kill slowdown and death burst
              this.killSlowdownTimer = 0.08;
              this.world.spawnDeathBurst(enemy.pos);
            }
          }
        }
      }
    };
    this.localSim.onProjectileSpawn = (proj: ProjectileState) => {
      this.world.spawnProjectile(proj);
    };
    this.localSim.onGameOver = (won: boolean) => {
      this.hud.showGameOver(won);
      this.haptics.play(HapticMotif.GameOver);
      this.audio.play(won ? SFX.Victory : SFX.Defeat);
      if (won) {
        this.hud.addKillFeedEntry('DHARMA PREVAILS — RAVANA DEFEATED', '#ffd700');
        // Show final karma score
        if (this.localSim) {
          const k = this.localSim.karma;
          this.hud.showKarmaScore('KARMA REPORT', k.mercy, k.valor, k.devotion);
        }
      }
    };

    this.localSim.onBlessingReceived = (name, desc) => {
      this.hud.showBlessingReceived(name, desc);
      this.audio.play(SFX.UIStart);
    };

    this.localSim.onDharmaGrace = () => {
      const el = document.getElementById('dharmaGrace');
      if (el) {
        el.style.opacity = '1';
        setTimeout(() => { el.style.opacity = '0'; }, 2000);
      }
    };

    this.localSim.onEnemySpecialArrow = (arrowName: string) => {
      this.hud.showArrowAlert(arrowName);
      this.audio.play(SFX.BowRelease);
    };

    // ── Blueprint callbacks: Astra Combo, Damage Direction, Companions, Karma, Checkpoints ──
    this.localSim.onAstraCombo = (combo, pos, damage) => {
      const comboNames = ['Steam Burst', 'Toxic Cloud', 'Skyfall', 'Venomfire', 'Monsoon', 'Purify'];
      this.hud.showComboNotification(comboNames[combo] || 'COMBO', `${damage} DMG`);
      this.controller?.triggerShake(0.15);
      this.audio.play(SFX.ShockwaveBlast);
    };

    this.localSim.onDamageDirection = (sourcePos) => {
      const p = this.localSim!.getPlayerState();
      const dx = sourcePos.x - p.pos.x;
      const dz = sourcePos.z - p.pos.z;
      const angle = Math.atan2(dx, dz);
      this.hud.showDamageDirection(angle - p.yaw, 'ranged');
    };

    this.localSim.onCompanionAbility = (companionId, abilityName) => {
      this.hud.addKillFeedEntry(`${companionId.toUpperCase()}: ${abilityName}`, '#88ccff');
      this.audio.play(SFX.FireArrowCast);
    };

    this.localSim.onKarmaUpdate = (karma) => {
      this.hud.showKarmaScore('KARMA', karma.mercy, karma.valor, karma.devotion);
    };

    this.localSim.onChampionSpawned = (_enemyId) => {
      this.hud.addKillFeedEntry('CHAMPION APPROACHES', '#ff8800');
      this.audio.play(SFX.BossRoar);
    };

    this.localSim.onEncounterPhaseChange = (phase, dialogue) => {
      if (dialogue) {
        this.hud.showDialogueSequence([{ name: 'Encounter', message: dialogue }]);
      }
      // Show phase notifications
      if (phase === EncounterPhase.Detection) {
        this.hud.showNotification('ENEMY DETECTED');
        this.audio.play(SFX.BossRoar);
      } else if (phase === EncounterPhase.Phase2) {
        this.hud.showNotification('PHASE 2 — ENRAGED');
        this.controller?.triggerShake(0.2);
        this.audio.play(SFX.BossRoar);
      } else if (phase === EncounterPhase.Defeated) {
        this.hud.showNotification('ENCOUNTER COMPLETE');
        this.audio.play(SFX.Victory);
      }
    };

    this.localSim.onRavanaHeadSpawned = (_headId, _pos) => {
      this.hud.addKillFeedEntry('RAVANA HEAD DETACHED', '#ff4444');
    };

    this.localSim.onRavanaHeadDestroyed = (_headId) => {
      this.hud.addKillFeedEntry('RAVANA HEAD DESTROYED', '#90ee90');
      this.audio.play(SFX.EnemyDeath);
    };

    this.localSim.onCheckpointSaved = () => {
      this.saveGame();
      this.hud.showNotification('MID-CHAPTER CHECKPOINT');
    };

    this.localSim.onPickupSpawned = (id, pos, arrows) => {
      this.world.spawnPickup(id, pos, arrows);
    };

    this.localSim.onPickupCollected = (id) => {
      this.world.removePickup(id);
      this.audio.play(SFX.ArrowHit); // pickup sound
    };

    // ── Headshot & Critical hit feedback ────────────────────────────
    this.localSim.onHeadshot = (enemyId: number) => {
      this.hud.addKillFeedEntry('HEADSHOT!', '#ff4444');
      this.hud.triggerScreenShake();
    };

    this.localSim.onCriticalHit = (_targetType: DamageTargetType, _targetId: number, damage: number) => {
      this.hud.addKillFeedEntry(`CRITICAL HIT — ${damage} DMG`, '#ffd700');
    };

    // ── Health pickup system ────────────────────────────────────────
    this.localSim.onHealthPickupSpawned = (id, pos, _healAmount) => {
      this.world.spawnPickup(id, pos, 0); // reuse pickup mesh (0 arrows = health)
    };

    this.localSim.onHealthPickupCollected = (id) => {
      this.world.removePickup(id);
      this.hud.showNotification('+15 HP');
      this.audio.play(SFX.UIStart);
    };

    this.localSim.onChapterChange = (chapter, title, subtitle) => {
      // Update chapter indicator in HUD corner
      const chapterEl = document.getElementById('chapterIndicator');
      if (chapterEl) chapterEl.textContent = `Ch.${chapter} — ${title}`;

      this.hud.showChapterBanner(chapter, title, subtitle);
      this.audio.play(SFX.BossRoar); // dramatic chapter transition sound

      // Update world biome visuals for this chapter
      this.world.setChapterBiome(chapter);

      // Advance day/night cycle based on chapter
      // Ch0-1: dawn(0.0-0.08), Ch2-3: morning→noon(0.12-0.22), Ch4-5: afternoon→dusk(0.32-0.42), Ch6-7: evening→night(0.55-0.72)
      const chapterTimeMap: Record<number, number> = { 0: 0.02, 1: 0.08, 2: 0.15, 3: 0.22, 4: 0.32, 5: 0.42, 6: 0.55, 7: 0.72 };
      this.gameTimeOfDay = chapterTimeMap[chapter] ?? 0.0;
      this.renderer.updateTimeOfDay(this.gameTimeOfDay);

      // Update goal widget
      const goal = this.localSim!.chapterGoals[chapter];
      if (goal && goal.revealed) {
        this.hud.showGoal(goal.description);
      } else {
        this.hud.showGoal('Find and speak with allies to learn your objective...');
      }

      // Auto-save on chapter transition
      if (chapter > 0) {
        this.saveGame();
        this.hud.showNotification('CHECKPOINT SAVED');
      }
    };

    // ── Dialogue system callbacks ──────────────────────────────────────

    this.localSim.onNPCNearby = (id, name) => {
      this.hud.showTalkPrompt(name);
    };

    this.localSim.onDialogueNode = (node, isEnd) => {
      // Show the dialogue node with speaker name and text
      this.hud.showDialogueNode(node, isEnd);
      this.audio.play(SFX.BossRoar); // reuse for dramatic effect
    };

    this.localSim.onStoryNPCSpawned = (id, name, pos) => {
      this.world.spawnAllyNPC(id, name, pos);
    };

    this.localSim.onCompanionJoined = (id, name, pos) => {
      this.world.spawnCompanion(id, name, pos);
      this.hud.showCompanionJoined(name);
      this.audio.play(SFX.UIStart);
    };

    this.localSim.onMeditationStateChanged = (active) => {
      if (active) {
        this.world.startMeditationEffect();
        this.hud.showMeditationBar();
      } else {
        this.world.stopMeditationEffect();
        this.hud.hideMeditationBar();
      }
    };

    this.localSim.onLakshmanChoice = () => {
      this.lakshmanChoiceActive = true;
      this.hud.showLakshmanChoice();
    };

    this.localSim.onDialogueSequence = (lines) => {
      this.hud.showDialogueSequence(lines);
    };

    // Wire HUD dialogue end button (click on "Press SPACE to continue")
    this.hud.onEndDialogue = () => {
      if (this.localSim && this.localSim.dialogueInProgress) {
        this.localSim.endDialogue();
        this.hud.hideDialogueChoices();
        this.hud.hideDialogue();
      }
    };

    this.localSim.onGoalRevealed = (chapter, description) => {
      this.hud.showGoalRevealed(description);
      this.audio.play(SFX.UIStart);
    };

    this.localSim.onGoalCompleted = (chapter, description) => {
      this.hud.completeGoal();
      this.hud.addKillFeedEntry(`Goal Complete: ${description}`, '#90ee90');
      this.audio.play(SFX.UIStart);
    };

    this.localSim.onTorchToggle = (lit) => {
      const p = this.localSim!.getPlayerState();
      this.world.setTorchLit(lit, p.pos);
      this.hud.showNotification(lit ? 'TORCH LIT' : 'TORCH EXTINGUISHED');
    };

    this.localSim.onCampfirePlaced = (pos) => {
      this.world.placeCampfire(pos);
      this.hud.showNotification('CAMPFIRE PLACED');
    };

    this.localSim.onCampfirePickedUp = () => {
      this.world.removeCampfire();
      this.hud.showNotification('CAMPFIRE PICKED UP');
    };

    // ── Tutorial callbacks ────────────────────────────────────────
    this.localSim.onTutorialStep = (step, allComplete) => {
      this.hud.showTutorialStep(step, true);
      if (allComplete) {
        this.tutorialComplete = true;
        setTimeout(() => {
          this.hud.hideTutorialChecklist();
          this.hud.showTutorialComplete();
          // Start backstory after 2 seconds
          setTimeout(() => {
            if (this.localSim) {
              this.localSim.startBackstory();
            }
          }, 2000);
        }, 500);
      }
    };

    this.localSim.onBackstorySlide = (index, speaker, text, isLast) => {
      this.hud.showBackstorySlide(speaker, text, isLast);
    };

    this.localSim.onBackstoryEnd = () => {
      this.hud.hideBackstory();
    };

    // ── Map system callbacks ───────────────────────────────────────
    this.localSim.onMapReveal = (cx, cz, radius, chapter, note) => {
      this.mapRenderer.revealLargeArea(cx, cz, radius, chapter, note);
      this.hud.showNotification('MAP UPDATED');
    };

    this.localSim.onMapWaypoint = (x, z, type, label, chapter) => {
      this.mapRenderer.addWaypoint({ x, z, type: type as WaypointType, label, chapter, timestamp: Date.now() });
    };

    this.localSim.onEnemyDroppedMap = (_enemyId, cx, cz, radius) => {
      this.mapRenderer.revealLargeArea(cx, cz, radius, this.localSim!.chapter, 'Map fragment recovered from fallen enemy');
      this.hud.showNotification('MAP FRAGMENT FOUND');
    };

    // Spawn visual meshes for any story NPCs already created during LocalSim constructor
    for (const npc of this.localSim.storyNPCs) {
      this.world.spawnAllyNPC(npc.id, npc.name, npc.pos);
    }

    // Initial waypoints — spawn point and tutorial area
    this.mapRenderer.addWaypoint({
      x: 0, z: 0, type: WaypointType.Landmark, label: 'Spawn — Training Grounds',
      chapter: 0, timestamp: Date.now(),
    });
    this.mapRenderer.revealRegion(0, 0, 20, 0); // Reveal spawn area

    // Setup minimap tap for mobile (opens full map)
    const miniMapEl = document.getElementById('miniMapContainer');
    if (miniMapEl) {
      miniMapEl.addEventListener('click', () => this.toggleMap());
      miniMapEl.addEventListener('touchend', () => this.toggleMap());
    }

    // Setup map panel buttons
    document.getElementById('mapSaveBtn')?.addEventListener('click', () => this.saveGame());
    document.getElementById('mapNewGameBtn')?.addEventListener('click', () => this.newGame());
    document.getElementById('mapCloseBtn')?.addEventListener('click', () => this.toggleMap());
    document.getElementById('mapLoadBtn')?.addEventListener('click', () => this.loadGame());

    // Show tutorial checklist at start
    this.hud.showTutorialChecklist();

    // ── Show difficulty selector at game start ──────────────────────
    this.hud.showDifficultySelector((difficulty) => {
      if (this.localSim) {
        this.localSim.setDifficulty(difficulty);
        const names = ['Story', 'Dharma', 'Tapasya'];
        this.hud.showNotification(`Difficulty: ${names[difficulty] || 'Dharma'}`);
      }
    });

    this.hud.showNotification('SINGLE PLAYER MODE');
    this.gameStartTime = performance.now();
  }

  // ── Map toggle & pause system ──────────────────────────────────
  private toggleMap(): void {
    this.mapOpen = !this.mapOpen;
    this.gamePaused = this.mapOpen;

    const mapPanel = document.getElementById('mapPanel');
    if (this.mapOpen) {
      // Render full map
      const mapCanvas = document.getElementById('mapCanvas') as HTMLCanvasElement;
      mapCanvas.width = Math.min(800, window.innerWidth - 40);
      mapCanvas.height = Math.min(600, window.innerHeight - 40);
      this.mapRenderer.renderFullMap(this.localSim?.chapter ?? 0);

      // Update stats display
      const statsEl = document.getElementById('mapStats');
      if (statsEl) {
        this.mapRenderer.playTimeMs = performance.now() - this.gameStartTime;
        const explored = this.mapRenderer.getRevealedPercentage().toFixed(1);
        const waypoints = this.mapRenderer.getWaypointCount();
        const chapter = this.localSim?.chapter ?? 0;
        const time = this.mapRenderer.formatPlayTime();
        statsEl.innerHTML = `Chapter: ${chapter} | Explored: ${explored}% | Waypoints: ${waypoints} | Time: ${time}`;
      }

      // Show save slot info
      const saveInfoEl = document.getElementById('mapSaveInfo');
      if (saveInfoEl) {
        if (MapRenderer.hasSave()) {
          const save = MapRenderer.loadFromLocalStorage();
          if (save) {
            const date = new Date(save.timestamp).toLocaleString();
            saveInfoEl.textContent = `Saved: ${date} (Ch.${save.chapter})`;
          }
        } else {
          saveInfoEl.textContent = 'No save found';
        }
      }

      mapPanel?.classList.add('visible');

      // Exit pointer lock when map opens
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    } else {
      mapPanel?.classList.remove('visible');
    }
  }

  private saveGame(): void {
    if (!this.localSim) return;
    const simState = this.localSim.getSaveState();
    const saveData = this.mapRenderer.createSaveData(simState);
    const ok = this.mapRenderer.saveToLocalStorage(saveData);
    this.hud.showNotification(ok ? 'GAME SAVED' : 'SAVE FAILED');

    // Update save info display
    const saveInfoEl = document.getElementById('mapSaveInfo');
    if (saveInfoEl && ok) {
      const date = new Date(saveData.timestamp).toLocaleString();
      saveInfoEl.textContent = `Saved: ${date} (Ch.${saveData.chapter})`;
    }
  }

  private loadGame(): void {
    const save = MapRenderer.loadFromLocalStorage();
    if (!save) {
      this.hud.showNotification('NO SAVE FOUND');
      return;
    }
    // Reload the page to restart with save data
    // The main.ts will check for save data on load
    window.location.reload();
  }

  private newGame(): void {
    const confirmed = window.confirm('Delete all progress and start fresh? This cannot be undone.');
    if (confirmed) {
      MapRenderer.deleteSave();
      window.location.reload();
    }
  }

  private gameLoop(): void {
    if (!this.running) return;
    const realDt = this.renderer.engine.getDeltaTime() / 1000;
    let dt = realDt;
    this.frameIndex++;

    // ── Kill slowdown: slow down time when enemy dies ──────────────────
    if (this.killSlowdownTimer > 0) {
      dt *= 0.3;
      this.killSlowdownTimer -= realDt;
    }

    // ── Performance monitoring ─────────────────────────────────
    this.perfManager.update(dt);

    // ── HUD update (combo timer decay) ─────────────────────────
    this.hud.update(dt);

    // ── Day/Night: slow time progression within chapters ──────
    this.gameTimeOfDay += dt * 0.001; // very slow drift (full cycle in ~1000s)
    if (this.gameTimeOfDay > 1.0) this.gameTimeOfDay -= 1.0;
    if (this.frameIndex % 30 === 0) {
      this.renderer.updateTimeOfDay(this.gameTimeOfDay);
    }

    // ── Handle Map toggle (M key) ────────────────────────────────
    if (this.controller && this.controller.consumeMapToggle()) {
      this.toggleMap();
    }

    // If game is paused (map open), skip sim + render minimap
    if (this.gamePaused) {
      // Still render the 3D scene (frozen)
      this.renderer.scene.render();
      return;
    }

    // ── Update minimap each frame ──────────────────────────────
    if (this.localSim && this.frameIndex % 5 === 0) {
      const p = this.lastSnapshot?.players.find(pl => pl.id === this.localPlayerId);
      if (p) {
        this.mapRenderer.updatePlayerPosition(p.pos, p.yaw);
        this.mapRenderer.renderMinimap();
      }
    }

    // ── Handle Talk input for dialogue ────────────────────────────
    if (this.controller && this.localSim) {
      const talkPressed = this.controller.consumeTalkKey();
      if (talkPressed) {
        const nearbyNpc = this.localSim.getNearbyNPC();
        if (nearbyNpc && !nearbyNpc.spoken && !this.localSim.dialogueInProgress) {
          // Start dialogue with this NPC
          this.localSim.startDialogue(nearbyNpc.dialogueTreeId);
          this.hud.hideTalkPrompt();
        }
      }
    }

    // ── Handle Torch (T) and Campfire (G) keys ──────────────────
    if (this.controller && this.localSim) {
      if (this.controller.consumeTorchKey()) {
        this.localSim.toggleTorch();
      }
      if (this.controller.consumeCampfireKey()) {
        this.localSim.placeCampfire();
      }
    }

    // Update torch position to follow player
    if (this.localSim?.torchLit) {
      const p = this.lastSnapshot?.players.find(pl => pl.id === this.localPlayerId);
      if (p) this.world.updateTorchPosition(p.pos);
    }

    // Update campfire flicker
    if (this.localSim?.campfirePos) {
      this.world.updateCampfireFlicker();
    }

    // ── Wire dialogue choice callback ──────────────────────────────
    this.hud.onChoiceSelected = (index: number) => {
      if (this.localSim) {
        this.localSim.selectChoice(index);
      }
    };

    // ── Handle Lakshman choice ─────────────────────────────────────
    if (this.lakshmanChoiceActive && this.controller && this.localSim) {
      const key = this.controller.consumeLakshmanKey();
      if (key === 'Y') {
        this.localSim.acceptLakshman();
        this.lakshmanChoiceActive = false;
        this.chapter6ReadyToAdvance = true;
        this.hud.hideLakshmanChoice();
        this.hud.showNotification('LAKSHMAN JOINS YOUR SIDE');
      } else if (key === 'N') {
        this.localSim.declineLakshman();
        this.lakshmanChoiceActive = false;
        this.chapter6ReadyToAdvance = true;
        this.hud.hideLakshmanChoice();
        this.hud.showNotification('LONE WARRIOR — +30% DAMAGE');
      }
    }

    // ── Chapter 6 → 7 advance: wait for meditation or 15 seconds ──
    if (this.chapter6ReadyToAdvance && this.localSim) {
      // Advance to chapter 7 when player stops meditating or after a delay
      if (!this.localSim.isMeditating && this.localSim.chapter === 6) {
        // Give 10 seconds to meditate, then auto-advance
        if (!this._ch6AdvanceTimer) {
          this._ch6AdvanceTimer = setTimeout(() => {
            if (this.localSim && this.localSim.chapter === 6) {
              this.localSim.advanceToChapter7();
            }
            this.chapter6ReadyToAdvance = false;
          }, 15000);
        }
      }
    }

    // ── Backstory advancement (Space key) & Dialogue end (Space key) ───
    if (!this._backstoryKeyListener && this.localSim) {
      this._backstoryKeyListener = true;
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
          if (this.localSim && this.localSim.backstoryInProgress) {
            e.preventDefault();
            this.localSim.advanceBackstory();
          } else if (this.localSim && this.localSim.dialogueInProgress) {
            e.preventDefault();
            this.localSim.endDialogue();
            this.hud.hideDialogueChoices();
            this.hud.hideDialogue();
          }
        }
      });
    }

    if (this.controller && this.localPlayerId >= 0) {
      const input = this.controller.getInput(dt);

      if (input) {
        // ── Haptics: movement feedback ─────────────────────────
        const isMoving = (input.flags & (InputFlag.Forward | InputFlag.Backward | InputFlag.Left | InputFlag.Right)) !== 0;
        const isSprinting = (input.flags & InputFlag.Sprint) !== 0;
        this.haptics.update(dt, isMoving, isSprinting);

        // ── Haptics: dodge ────────────────────────────────────
        if (input.flags & InputFlag.Dodge) {
          this.haptics.play(HapticMotif.PlayerDodge);
          this.audio.play(SFX.Dodge);
        }

        // ── Haptics: jump ─────────────────────────────────────
        if (input.flags & InputFlag.Jump) {
          this.audio.play(SFX.Jump);
        }

        if (this.useSinglePlayer && this.localSim) {
          this.localSim.processInput(input);

          const ability = this.controller.consumeAbility();
          if (ability) {
            this.localSim.handleAbility(ability.type, ability.dir);
            if (ability.type === AbilityType.Shockwave) {
              this.haptics.play(HapticMotif.ShockwaveBlast);
              this.audio.play(SFX.ShockwaveBlast);
            } else if (ability.type === AbilityType.HanumanLeap || ability.type === AbilityType.AngadShield || ability.type === AbilityType.LakshmanCover) {
              this.audio.play(SFX.UIStart);
            } else if (ability.type === AbilityType.Pashupatastra) {
              this.haptics.play(HapticMotif.BossPhaseShift);
              this.audio.play(SFX.BossRoar);
            } else {
              this.haptics.play(HapticMotif.FireArrowCast);
              this.audio.play(SFX.FireArrowCast);
            }
          }

          if (input.flags & InputFlag.Shoot) {
            this.haptics.play(HapticMotif.BowRelease);
            this.audio.play(SFX.BowRelease);
          }

          // Step sim — skip during hit-stop
          if (performance.now() >= this.hitStopEnd) {
            const snap = this.localSim.update(dt);
            this.lastSnapshot = snap;
            this.interpolation.pushSnapshot(snap);
          }
        } else if (this.network) {
          this.network.sendInput(input);
          this.controller.predict(input);

          const ability = this.controller.consumeAbility();
          if (ability) {
            this.network.sendAbility(ability.type, ability.dir);
            if (ability.type === AbilityType.Shockwave) {
              this.haptics.play(HapticMotif.ShockwaveBlast);
              this.audio.play(SFX.ShockwaveBlast);
            } else {
              this.haptics.play(HapticMotif.FireArrowCast);
              this.audio.play(SFX.FireArrowCast);
            }
          }

          if (input.flags & InputFlag.Shoot) {
            this.haptics.play(HapticMotif.BowRelease);
            this.audio.play(SFX.BowRelease);
          }

          if (this.controller.isReviving()) {
            const nearest = this.findNearestDowned();
            if (nearest >= 0) this.network.sendRevive(nearest);
          }
        }
      }
    }

    // Interpolate
    const interpState = this.interpolation.getInterpolated(performance.now());
    if (interpState) this.updateWorld(interpState, dt);

    // Soft-lock targeting
    if (interpState && this.controller) {
      const localPlayer = interpState.players.find(p => p.id === this.localPlayerId);
      const aimInfo = this.targeting.update(interpState.enemies, interpState.boss ?? null, dt);
      this.controller.setTargetLock(
        aimInfo ? aimInfo.worldPos : null,
        localPlayer?.pos ?? { x: 0, y: 0, z: 0 },
      );
    }

    this.world.updateProjectiles(dt);
    // Update water shimmer/flow animation
    this.world.updateWater(dt);
    // Update NPC beacon animations (rotating diamonds, pulsing light pillars)
    this.world.updateNPCBeacons(dt);

    // Update wildlife animations
    if (this.localSim) {
      const p = this.lastSnapshot?.players.find(pl => pl.id === this.localPlayerId);
      if (p) this.world.updateWildlife(dt, p.pos);
    }

    if (this.localSim) {
      this.world.updatePickups(dt);
      // Update companion positions in world
      for (const comp of this.localSim.companions) {
        this.world.updateCompanion(comp.id, comp.pos);
      }
      // Update meditation bar progress
      if (this.localSim.isMeditating) {
        this.hud.updateMeditationBar(this.localSim.meditationTimer / this.localSim.maxMeditationTime);
      }
      // Show meditation hint when available and not meditating
      this.hud.updateMeditationHint(this.localSim.canMeditate && !this.localSim.isMeditating);
    }

    if (this.controller) {
      const localState = interpState?.players.find(p => p.id === this.localPlayerId);
      if (localState) this.controller.updateCamera(localState, dt);
    }

    // ── Boss phase-shift events ────────────────────────────────
    if (interpState?.boss) {
      const bp = interpState.boss.phase;
      if (this.lastBossPhase !== null && bp !== this.lastBossPhase) {
        if (bp === BossPhase.Phase2) {
          this.haptics.play(HapticMotif.BossPhaseShift);
          this.audio.play(SFX.BossRoar);
          this.hud.showNotification('RAVANA ASCENDS — PHASE II');
          // Ravana Dharma dialogue — Phase 2
          setTimeout(() => {
            this.hud.showDialogueSequence([
              { name: 'Ravana', message: "You think yourself righteous? I performed ten thousand years of tapasya! I lifted Mount Kailasa! Brahma himself granted me immortality against gods, gandharvas, and yakshas!" },
              { name: 'Rama', message: "Yet you forgot to ask protection from men and vanaras, Ravana. Even Brahma's boon contains the seed of your undoing — planted by your own arrogance." },
            ]);
          }, 2000);
        } else if (bp === BossPhase.Phase3Enrage) {
          this.haptics.play(HapticMotif.BossPhaseShift);
          this.audio.play(SFX.BossRoar);
          this.hud.showNotification('RAVANA ENRAGED — THE TEN HEADS ROAR');
          // Ravana enrage Dharma dialogue
          setTimeout(() => {
            this.hud.showDialogueSequence([
              { name: 'Ravana', message: "I who made Shiva weep when I played the Veena with my own sinews! I who imprisoned the nine planets! No exile prince and his monkey army can end what the gods could not!" },
              { name: 'Vibhishana', message: "Now, Lord Rama! His navel — the Amrita! The Brahmastra is the only weapon that will not be deflected. End my brother's suffering!" },
              { name: 'Rama', message: "Forgive me, Ravana. This arrow carries not hatred but the accumulated Dharma of those you wronged — Sita, Jatayu, the sages, your own brother. Be free." },
            ]);
          }, 2000);
        } else if (bp === BossPhase.Dead) {
          this.haptics.play(HapticMotif.BossDefeated);
          this.audio.play(SFX.BossDefeated);
          // Victory Dharma dialogue — faithful to Ramayana's aftermath
          setTimeout(() => {
            this.hud.showDialogueSequence([
              { name: 'Narrator', message: "The Brahmastra finds its mark. The Amrita spills from Ravana's navel, and one by one, his ten great heads fall still. The golden city trembles — not with destruction, but with the weight of Adharma finally lifting." },
              { name: 'Rama', message: "Go in peace, Ravana. You were once the greatest devotee of Shiva, the finest scholar of the Vedas. Let this death free you from the prison your pride built." },
              { name: 'Vibhishana', message: "My brother... he was not always this. He was kind once. He taught me the scriptures. Desire consumed him. Thank you, Lord Rama, for ending his suffering." },
              { name: 'Rama', message: "Vibhishana, you are now King of Lanka. Rule with the Dharma your brother forgot. And let Mandodari know — her husband's soul is at peace." },
              { name: 'Hanuman', message: "Jai Shri Ram! The Ashoka Vatika's doors are open — Mother Sita is free! The exile ends. Ayodhya awaits. Dharma prevails across the three worlds!" },
            ]);
          }, 3000);
        }
      }
      this.lastBossPhase = bp;
    }

    this.renderer.scene.render();
  }

  // Internal timer for chapter 6 → 7
  private _ch6AdvanceTimer: ReturnType<typeof setTimeout> | null = null;

  private updateWorld(snap: GameSnapshot, _dt: number): void {
    for (const ps of snap.players) {
      const isLocal = ps.id === this.localPlayerId;
      const yawOverride = isLocal && this.controller ? this.controller.getVisualYaw() : undefined;
      this.world.updatePlayerMesh(ps, isLocal, yawOverride);
    }
    for (const es of snap.enemies) {
      // Set enemy type for visual differentiation
      if (this.localSim) {
        const enemyType = this.localSim.getEnemyType(es.id);
        this.world.setEnemyType(es.id, enemyType);
      }
      this.world.updateEnemyMesh(es);
    }
    if (snap.boss) this.world.updateBossMesh(snap.boss);

    const local = snap.players.find(p => p.id === this.localPlayerId);
    if (local) {
      this.hud.updatePlayerBars(local.hp, local.maxHp, local.stamina);
      this.hud.updateDownedState(local.status === PlayerStatus.Downed);
    }
    this.hud.updateTeamBars(snap.players, this.localPlayerId);
    if (snap.boss && snap.boss.phase !== BossPhase.Idle) this.hud.updateBossBar(snap.boss);
    if (this.localSim) {
      this.hud.updateAmmo(this.localSim.arrowAmmo, this.localSim.maxArrowAmmo);
    }
    if (this.controller) {
      this.hud.updateCooldowns(this.controller.getFireArrowCd(), this.controller.getShockwaveCd());
      // Update special arrow selector
      const selected = this.controller.getSelectedSpecialArrow();
      const cooldowns = [0, 1, 2, 3, 4].map(i => this.controller.getSpecialCooldown(i as SpecialArrowType));
      this.hud.updateArrowSelector(selected, cooldowns);
    }
  }

  private findNearestDowned(): number {
    if (!this.lastSnapshot) return -1;
    const local = this.lastSnapshot.players.find(p => p.id === this.localPlayerId);
    if (!local) return -1;
    let best = -1, bestDist = Infinity;
    for (const p of this.lastSnapshot.players) {
      if (p.id === this.localPlayerId || p.status !== PlayerStatus.Downed) continue;
      const dx = p.pos.x - local.pos.x, dz = p.pos.z - local.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < bestDist && d < 3) { bestDist = d; best = p.id; }
    }
    return best;
  }
}
