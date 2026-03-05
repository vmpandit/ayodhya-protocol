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
import { GameSnapshot, PlayerState, ProjectileState, PlayerStatus, BossPhase, InputFlag, AbilityType, SpecialArrowType } from '@shared/types';
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
          // Check for enemy kill → kill feed
          const snap = this.lastSnapshot;
          if (snap) {
            const enemy = snap.enemies.find(e => e.id === targetId);
            if (enemy && enemy.hp - damage <= 0) {
              this.hud.addKillFeedEntry(`Sentinel #${targetId} eliminated`, '#ff6633');
              this.audio.play(SFX.EnemyDeath);
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
      }
    };

    this.localSim.onEnemySpecialArrow = (arrowName: string) => {
      this.hud.showArrowAlert(arrowName);
      this.audio.play(SFX.BowRelease); // audio cue for incoming arrow
    };

    this.localSim.onPickupSpawned = (id, pos, arrows) => {
      this.world.spawnPickup(id, pos, arrows);
    };

    this.localSim.onPickupCollected = (id) => {
      this.world.removePickup(id);
      this.audio.play(SFX.ArrowHit); // pickup sound
    };

    this.localSim.onChapterChange = (chapter, title, subtitle) => {
      this.hud.showChapterBanner(chapter, title, subtitle);
      this.audio.play(SFX.BossRoar); // dramatic chapter transition sound

      // Update goal widget
      const goal = this.localSim!.chapterGoals[chapter];
      if (goal && goal.revealed) {
        this.hud.showGoal(goal.description);
      } else {
        this.hud.showGoal('Find and speak with allies to learn your objective...');
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

    this.localSim.onGoalRevealed = (chapter, description) => {
      this.hud.showGoalRevealed(description);
      this.audio.play(SFX.UIStart);
    };

    this.localSim.onGoalCompleted = (chapter, description) => {
      this.hud.completeGoal();
      this.hud.addKillFeedEntry(`Goal Complete: ${description}`, '#90ee90');
      this.audio.play(SFX.UIStart);
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
    MapRenderer.deleteSave();
    window.location.reload();
  }

  private gameLoop(): void {
    if (!this.running) return;
    const dt = this.renderer.engine.getDeltaTime() / 1000;
    this.frameIndex++;

    // ── Performance monitoring ─────────────────────────────────
    this.perfManager.update(dt);

    // ── HUD update (combo timer decay) ─────────────────────────
    this.hud.update(dt);

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

    // ── Backstory advancement (Space key) ────────────────────────
    if (!this._backstoryKeyListener && this.localSim) {
      this._backstoryKeyListener = true;
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && this.localSim && this.localSim.backstoryInProgress) {
          e.preventDefault();
          this.localSim.advanceBackstory();
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
            } else {
              // All arrow-type abilities (FireArrow/Agni, Vayu, Varuna, Naga, Brahma)
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
          this.hud.showNotification('BOSS PHASE II — ASCENDED');
          // Ravana Dharma dialogue — Phase 2
          setTimeout(() => {
            this.hud.showDialogue('Ravana',
              "You think yourself righteous, Rama? I conquered the three worlds! The gods themselves trembled before my penance. Who are you to judge my Dharma?", 6000);
          }, 2000);
        } else if (bp === BossPhase.Phase3Enrage) {
          this.haptics.play(HapticMotif.BossPhaseShift);
          this.audio.play(SFX.BossRoar);
          this.hud.showNotification('BOSS ENRAGED');
          // Ravana enrage Dharma dialogue
          setTimeout(() => {
            this.hud.showDialogueSequence([
              { name: 'Ravana', message: "ENOUGH! I am Ravana — master of ten heads, conqueror of Indra! No mortal arrow can fell me!" },
              { name: 'Rama', message: "Your knowledge was vast, Ravana. But knowledge without compassion is a weapon turned upon oneself. This is the fruit of your Adharma." },
            ]);
          }, 2000);
        } else if (bp === BossPhase.Dead) {
          this.haptics.play(HapticMotif.BossDefeated);
          this.audio.play(SFX.BossDefeated);
          // Victory Dharma dialogue
          setTimeout(() => {
            this.hud.showDialogueSequence([
              { name: 'Rama', message: "It is done. Not with hatred did I loose this arrow, but with the weight of Dharma — duty to the innocent, to Sita, to the order of the world." },
              { name: 'Rama', message: "Let it be known: Ravana fell not because he lacked strength, but because he abandoned Dharma. May even his soul find peace now." },
              { name: 'Hanuman', message: "Jai Shri Ram! Dharma prevails. Lanka is free — and Mother Sita shall be reunited with her Lord." },
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
    for (const es of snap.enemies) this.world.updateEnemyMesh(es);
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
