// ── Ayodhya Protocol: Lanka Reforged ── Main Game Class ──
// Supports single-player (LocalSim) and multiplayer (Network).

import { Renderer } from './Renderer';
import { Network } from './Network';
import { LocalSim } from './LocalSim';
import { PlayerController } from './PlayerController';
import { World } from './World';
import { HUD } from './HUD';
import { Interpolation } from './Interpolation';
import { GameSnapshot, PlayerState, ProjectileState, PlayerStatus, BossPhase } from '@shared/types';

export class Game {
  private canvas: HTMLCanvasElement;
  private renderer!: Renderer;
  private network: Network | null = null;
  private localSim: LocalSim | null = null;
  private controller!: PlayerController;
  private world!: World;
  private hud!: HUD;
  private interpolation!: Interpolation;
  private localPlayerId = -1;
  private lastSnapshot: GameSnapshot | null = null;
  private running = false;
  private useSinglePlayer = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init(): Promise<void> {
    this.renderer = new Renderer(this.canvas);
    await this.renderer.init();

    this.world = new World(this.renderer);
    this.world.build();

    this.hud = new HUD();
    this.interpolation = new Interpolation();
  }

  /** Called after the user clicks "BEGIN OPERATION" on the instructions screen */
  start(): void {
    this.controller = new PlayerController(this.canvas, this.renderer.camera);

    // Try connecting to server; fall back to single-player
    this.tryConnect();

    this.running = true;
    document.getElementById('hud')?.classList.add('visible');
    this.renderer.engine.runRenderLoop(() => this.gameLoop());
  }

  private tryConnect(): void {
    // Attempt multiplayer — if it fails, auto-fallback to local sim
    try {
      const ws = new WebSocket(`ws://${window.location.hostname || 'localhost'}:9001`);
      ws.binaryType = 'arraybuffer';

      const timeout = setTimeout(() => {
        // No connection within 2 s — go single-player
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

      // Stash ws temporarily for setupMultiplayer
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
    this.network.onDamage = (targetType, targetId, damage) => {
      this.world.showDamageNumber(targetType, targetId, damage);
      if (targetType === 0 && targetId === this.localPlayerId) this.hud.flashDamage();
    };
    this.network.onGameOver = (won: boolean) => this.hud.showGameOver(won);

    this.network.connect();
  }

  private startSinglePlayer(): void {
    console.log('[Game] Starting single-player mode');
    this.useSinglePlayer = true;
    this.localSim = new LocalSim();
    this.localPlayerId = this.localSim.playerId;
    this.world.addPlayerMesh(this.localPlayerId, true);

    this.localSim.onDamage = (targetType, targetId, damage) => {
      this.world.showDamageNumber(targetType, targetId, damage);
      if (targetType === 0 && targetId === this.localPlayerId) this.hud.flashDamage();
    };
    this.localSim.onProjectileSpawn = (proj: ProjectileState) => {
      this.world.spawnProjectile(proj);
    };
    this.localSim.onGameOver = (won: boolean) => this.hud.showGameOver(won);

    this.hud.showNotification('SINGLE PLAYER MODE');
  }

  private gameLoop(): void {
    if (!this.running) return;
    const dt = this.renderer.engine.getDeltaTime() / 1000;

    if (this.controller && this.localPlayerId >= 0) {
      const input = this.controller.getInput(dt);

      if (input) {
        if (this.useSinglePlayer && this.localSim) {
          // Feed input directly to local sim
          this.localSim.processInput(input);

          // Abilities
          const ability = this.controller.consumeAbility();
          if (ability) this.localSim.handleAbility(ability.type, ability.dir);

          // Step sim and push as snapshot
          const snap = this.localSim.update(dt);
          this.lastSnapshot = snap;
          this.interpolation.pushSnapshot(snap);
        } else if (this.network) {
          this.network.sendInput(input);
          this.controller.predict(input);

          const ability = this.controller.consumeAbility();
          if (ability) this.network.sendAbility(ability.type, ability.dir);

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

    this.world.updateProjectiles(dt);

    if (this.controller) {
      const localState = interpState?.players.find(p => p.id === this.localPlayerId);
      if (localState) this.controller.updateCamera(localState, dt);
    }

    this.renderer.scene.render();
  }

  private updateWorld(snap: GameSnapshot, _dt: number): void {
    for (const ps of snap.players) this.world.updatePlayerMesh(ps, ps.id === this.localPlayerId);
    for (const es of snap.enemies) this.world.updateEnemyMesh(es);
    if (snap.boss) this.world.updateBossMesh(snap.boss);

    const local = snap.players.find(p => p.id === this.localPlayerId);
    if (local) {
      this.hud.updatePlayerBars(local.hp, local.maxHp, local.stamina);
      this.hud.updateDownedState(local.status === PlayerStatus.Downed);
    }
    this.hud.updateTeamBars(snap.players, this.localPlayerId);
    if (snap.boss && snap.boss.phase !== BossPhase.Idle) this.hud.updateBossBar(snap.boss);
    if (this.controller) this.hud.updateCooldowns(this.controller.getFireArrowCd(), this.controller.getShockwaveCd());
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
