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
  private localPlayerId = -1;
  private lastSnapshot: GameSnapshot | null = null;
  private running = false;
  private useSinglePlayer = false;
  private frameIndex = 0;

  // ── Hit-stop: freeze the sim briefly on a successful enemy hit ──────
  private hitStopEnd = 0;

  // ── Boss phase tracking for phase-shift events ─────────────────────
  private lastBossPhase: BossPhase | null = null;

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
        this.hud.addKillFeedEntry('RAVANA PROTOCOL DESTROYED', '#ffd700');
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
    };

    // Show Chapter 1 intro after a brief delay
    setTimeout(() => {
      this.hud.showChapterBanner(1, "The Forest of Lanka", "Lord Rama enters the dark forests of Lanka. Rakshasa sentinels lurk among the ancient trees...");
    }, 1500);

    this.hud.showNotification('SINGLE PLAYER MODE');
  }

  private gameLoop(): void {
    if (!this.running) return;
    const dt = this.renderer.engine.getDeltaTime() / 1000;
    this.frameIndex++;

    // ── Performance monitoring ─────────────────────────────────
    this.perfManager.update(dt);

    // ── HUD update (combo timer decay) ─────────────────────────
    this.hud.update(dt);

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
        } else if (bp === BossPhase.Phase3Enrage) {
          this.haptics.play(HapticMotif.BossPhaseShift);
          this.audio.play(SFX.BossRoar);
          this.hud.showNotification('BOSS ENRAGED');
        } else if (bp === BossPhase.Dead) {
          this.haptics.play(HapticMotif.BossDefeated);
          this.audio.play(SFX.BossDefeated);
        }
      }
      this.lastBossPhase = bp;
    }

    this.renderer.scene.render();
  }

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
