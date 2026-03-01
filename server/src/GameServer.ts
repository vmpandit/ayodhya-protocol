// ── Ayodhya Protocol: Lanka Reforged ── Authoritative Game Server ──

import { WebSocket } from 'ws';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import {
  MsgType, PlayerInput, PlayerState, PlayerStatus, ProjectileState, ProjectileType,
  EnemyState, EnemyAIState, BossState, BossPhase, Vec3, AbilityType, GameSnapshot,
} from '../../shared/types.js';
import {
  decodeInput, decodeAbility, decodeRevive,
  encodeSnapshot, encodeProjectileSpawn, encodeDamage, encodePlayerJoined,
  encodePlayerLeft, encodeGameOver, DamageTargetType,
} from '../../shared/protocol.js';
import * as C from '../../shared/constants.js';

interface ServerPlayer {
  ws: WebSocket;
  state: PlayerState;
  inputQueue: PlayerInput[];
  lastInputTime: number;
  fireArrowCd: number;
  shockwaveCd: number;
  dodgeCdEnd: number;
  dodgeEnd: number;
  reviveTarget: number;
  reviveProgress: number;
  body: RAPIER_NS.RigidBody;
}

interface ServerProjectile {
  state: ProjectileState;
  spawnTime: number;
  body: RAPIER_NS.RigidBody;
  dotTicks: number;
  dotTargetId: number;
  dotType: DamageTargetType;
}

interface ServerEnemy {
  state: EnemyState;
  body: RAPIER_NS.RigidBody;
  patrolOrigin: Vec3;
  patrolAngle: number;
  meleeCdEnd: number;
  rangedCdEnd: number;
  spawnTime: number;
}

interface ServerBoss {
  state: BossState;
  body: RAPIER_NS.RigidBody;
  meleeCdEnd: number;
  aoeCdEnd: number;
  barrageCdEnd: number;
  aoeEndTime: number;
  barrageEndTime: number;
  activated: boolean;
}

export class GameServer {
  private RAPIER: typeof RAPIER_NS;
  private world!: RAPIER_NS.World;
  private players = new Map<WebSocket, ServerPlayer>();
  private nextPlayerId = 1;
  private projectiles = new Map<number, ServerProjectile>();
  private nextProjectileId = 1;
  private enemies: ServerEnemy[] = [];
  private nextEnemyId = 1;
  private boss: ServerBoss | null = null;
  private tick = 0;
  private running = false;
  private groundCollider!: RAPIER_NS.Collider;

  constructor(rapier: typeof RAPIER_NS) {
    this.RAPIER = rapier;
    this.initPhysics();
    this.spawnEnemies();
    this.spawnBoss();
  }

  private initPhysics(): void {
    const gravity = new this.RAPIER.Vector3(0, C.GRAVITY, 0);
    this.world = new this.RAPIER.World(gravity);

    // Ground plane
    const groundDesc = this.RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
    const groundBody = this.world.createRigidBody(groundDesc);
    const groundShape = this.RAPIER.ColliderDesc.cuboid(C.WORLD_SIZE, 0.5, C.WORLD_SIZE);
    this.groundCollider = this.world.createCollider(groundShape, groundBody);

    // Walls
    const wallH = 10;
    const hs = C.WORLD_SIZE;
    const wallPositions: [number, number, number, number, number, number][] = [
      [0, wallH / 2, -hs, hs, wallH / 2, 0.5],
      [0, wallH / 2, hs, hs, wallH / 2, 0.5],
      [-hs, wallH / 2, 0, 0.5, wallH / 2, hs],
      [hs, wallH / 2, 0, 0.5, wallH / 2, hs],
    ];
    for (const [px, py, pz, hx, hy, hz] of wallPositions) {
      const desc = this.RAPIER.RigidBodyDesc.fixed().setTranslation(px, py, pz);
      const body = this.world.createRigidBody(desc);
      this.world.createCollider(this.RAPIER.ColliderDesc.cuboid(hx, hy, hz), body);
    }
  }

  private createCharacterBody(pos: Vec3, radius: number, height: number): RAPIER_NS.RigidBody {
    const desc = this.RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y + height / 2, pos.z)
      .setLinearDamping(5)
      .lockRotations();
    const body = this.world.createRigidBody(desc);
    this.world.createCollider(
      this.RAPIER.ColliderDesc.capsule(height / 2, radius).setDensity(1),
      body
    );
    return body;
  }

  private spawnEnemies(): void {
    const positions: Vec3[] = [
      { x: -20, y: 1, z: -20 }, { x: 20, y: 1, z: -25 },
      { x: -30, y: 1, z: 10 }, { x: 15, y: 1, z: 30 },
      { x: -10, y: 1, z: -35 }, { x: 35, y: 1, z: 15 },
      { x: 25, y: 1, z: 45 }, { x: -15, y: 1, z: 40 },
    ];
    for (const pos of positions) {
      const id = this.nextEnemyId++;
      const body = this.createCharacterBody(pos, 0.5, 1.8);
      const now = Date.now();
      this.enemies.push({
        state: {
          id, pos: { ...pos }, yaw: 0, hp: C.ENEMY_HP, maxHp: C.ENEMY_HP,
          aiState: EnemyAIState.Patrol, targetId: 0,
        },
        body, patrolOrigin: { ...pos }, patrolAngle: Math.random() * Math.PI * 2,
        meleeCdEnd: 0, rangedCdEnd: 0, spawnTime: now,
      });
    }
  }

  private spawnBoss(): void {
    const pos = C.BOSS_ARENA_CENTER;
    const body = this.createCharacterBody(pos, 1.5, 4);
    const maxHp = C.BOSS_HP_BASE;
    this.boss = {
      state: {
        pos: { ...pos }, yaw: 0, hp: maxHp, maxHp,
        phase: BossPhase.Idle, isAoE: false, isBarrage: false,
      },
      body, meleeCdEnd: 0, aoeCdEnd: 0, barrageCdEnd: 0,
      aoeEndTime: 0, barrageEndTime: 0, activated: false,
    };
  }

  onConnect(ws: WebSocket): void {
    if (this.players.size >= C.MAX_PLAYERS) {
      ws.close(1013, 'Server full');
      return;
    }
    const id = this.nextPlayerId++;
    const spawn = { ...C.SPAWN_POINT };
    const body = this.createCharacterBody(spawn, 0.4, 1.7);
    const player: ServerPlayer = {
      ws,
      state: {
        id, pos: spawn, vel: { x: 0, y: 0, z: 0 }, yaw: 0,
        hp: C.PLAYER_MAX_HP, maxHp: C.PLAYER_MAX_HP, stamina: C.PLAYER_MAX_STAMINA,
        status: PlayerStatus.Alive, isDodging: false, lastProcessedSeq: 0,
      },
      inputQueue: [], lastInputTime: Date.now(),
      fireArrowCd: 0, shockwaveCd: 0,
      dodgeCdEnd: 0, dodgeEnd: 0,
      reviveTarget: -1, reviveProgress: 0,
      body,
    };
    this.players.set(ws, player);

    // Scale boss HP
    if (this.boss) {
      const pc = this.players.size;
      this.boss.state.maxHp = C.BOSS_HP_BASE + (pc - 1) * C.BOSS_HP_PER_PLAYER;
      if (this.boss.state.hp > 0) {
        this.boss.state.hp = this.boss.state.maxHp;
      }
    }

    // Tell the new player their ID
    this.send(ws, encodePlayerJoined(id));

    // Tell existing players about the new player
    this.broadcast(encodePlayerJoined(id), ws);

    console.log(`[Server] Player ${id} joined (${this.players.size}/${C.MAX_PLAYERS})`);
  }

  onDisconnect(ws: WebSocket): void {
    const player = this.players.get(ws);
    if (!player) return;
    this.world.removeRigidBody(player.body);
    this.players.delete(ws);
    this.broadcast(encodePlayerLeft(player.state.id));
    console.log(`[Server] Player ${player.state.id} left`);
  }

  onMessage(ws: WebSocket, data: Uint8Array): void {
    if (data.length === 0) return;
    const type = data[0] as MsgType;
    const player = this.players.get(ws);
    if (!player) return;

    switch (type) {
      case MsgType.Input:
        player.inputQueue.push(decodeInput(data));
        break;
      case MsgType.Ability: {
        const { type: abilityType, dir } = decodeAbility(data);
        this.handleAbility(player, abilityType, dir);
        break;
      }
      case MsgType.Revive: {
        const targetId = decodeRevive(data);
        player.reviveTarget = targetId;
        player.reviveProgress = 0;
        break;
      }
    }
  }

  private handleAbility(player: ServerPlayer, ability: AbilityType, dir: Vec3): void {
    const now = Date.now();
    if (player.state.status !== PlayerStatus.Alive) return;

    if (ability === AbilityType.FireArrow && now >= player.fireArrowCd) {
      player.fireArrowCd = now + C.FIRE_ARROW_COOLDOWN_MS;
      this.spawnProjectile(player.state.id, ProjectileType.FireArrow, player.state.pos, dir, C.FIRE_ARROW_DAMAGE);
    } else if (ability === AbilityType.Shockwave && now >= player.shockwaveCd) {
      player.shockwaveCd = now + C.SHOCKWAVE_COOLDOWN_MS;
      this.applyShockwave(player);
    }
  }

  private applyShockwave(player: ServerPlayer): void {
    const origin = player.state.pos;

    for (const enemy of this.enemies) {
      if (enemy.state.aiState === EnemyAIState.Dead) continue;
      const d = dist3(origin, enemy.state.pos);
      if (d <= C.SHOCKWAVE_RADIUS) {
        enemy.state.hp -= C.SHOCKWAVE_DAMAGE;
        this.broadcast(encodeDamage(DamageTargetType.Enemy, enemy.state.id, C.SHOCKWAVE_DAMAGE, player.state.id));
        if (enemy.state.hp <= 0) {
          enemy.state.hp = 0;
          enemy.state.aiState = EnemyAIState.Dead;
        }
      }
    }

    if (this.boss && this.boss.state.phase !== BossPhase.Dead && this.boss.state.phase !== BossPhase.Idle) {
      const d = dist3(origin, this.boss.state.pos);
      if (d <= C.SHOCKWAVE_RADIUS) {
        this.boss.state.hp -= C.SHOCKWAVE_DAMAGE;
        this.broadcast(encodeDamage(DamageTargetType.Boss, 0, C.SHOCKWAVE_DAMAGE, player.state.id));
        this.checkBossPhase();
      }
    }
  }

  private spawnProjectile(ownerId: number, type: ProjectileType, origin: Vec3, dir: Vec3, damage: number): void {
    const id = this.nextProjectileId++;
    const speed = C.ARROW_SPEED;
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
    const vel: Vec3 = { x: (dir.x / len) * speed, y: (dir.y / len) * speed, z: (dir.z / len) * speed };
    const pos: Vec3 = { x: origin.x, y: origin.y + 1.2, z: origin.z };

    const bodyDesc = this.RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinvel(vel.x, vel.y, vel.z)
      .setGravityScale(0.15)
      .setCcdEnabled(true);
    const body = this.world.createRigidBody(bodyDesc);
    this.world.createCollider(this.RAPIER.ColliderDesc.ball(0.15).setDensity(0.1), body);

    const state: ProjectileState = { id, type, ownerId, pos, vel, damage };
    this.projectiles.set(id, { state, spawnTime: Date.now(), body, dotTicks: 0, dotTargetId: -1, dotType: DamageTargetType.Enemy });

    const msg = encodeProjectileSpawn(state);
    this.broadcast(msg);
  }

  start(): void {
    this.running = true;
    let lastTime = Date.now();

    const loop = (): void => {
      if (!this.running) return;
      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      this.update(dt, now);
      this.tick++;

      // Send snapshots at tick rate
      if (this.tick % 1 === 0) {
        this.broadcastSnapshot(now);
      }

      setTimeout(loop, C.TICK_MS);
    };
    loop();
  }

  private update(dt: number, now: number): void {
    // Process player inputs
    for (const player of this.players.values()) {
      this.processPlayerInputs(player, now);
    }

    // Step physics
    this.world.step();

    // Sync physics → state
    for (const player of this.players.values()) {
      const t = player.body.translation();
      player.state.pos = { x: t.x, y: t.y - 0.85, z: t.z };
      const v = player.body.linvel();
      player.state.vel = { x: v.x, y: v.y, z: v.z };

      // Regen stamina
      if (player.state.status === PlayerStatus.Alive) {
        player.state.stamina = Math.min(C.PLAYER_MAX_STAMINA, player.state.stamina + C.STAMINA_REGEN_RATE * dt);
      }

      // Revive logic
      if (player.reviveTarget >= 0 && player.state.status === PlayerStatus.Alive) {
        const target = this.findPlayerById(player.reviveTarget);
        if (target && target.state.status === PlayerStatus.Downed) {
          const d = dist3(player.state.pos, target.state.pos);
          if (d <= C.REVIVE_RANGE) {
            player.reviveProgress += dt * 1000;
            if (player.reviveProgress >= C.REVIVE_DURATION_MS) {
              target.state.status = PlayerStatus.Alive;
              target.state.hp = C.PLAYER_MAX_HP * 0.5;
              player.reviveTarget = -1;
              player.reviveProgress = 0;
            }
          } else {
            player.reviveTarget = -1;
            player.reviveProgress = 0;
          }
        } else {
          player.reviveTarget = -1;
          player.reviveProgress = 0;
        }
      }
    }

    // Update projectiles
    this.updateProjectiles(dt, now);

    // Update enemies
    this.updateEnemies(dt, now);

    // Update boss
    this.updateBoss(dt, now);
  }

  private processPlayerInputs(player: ServerPlayer, now: number): void {
    while (player.inputQueue.length > 0) {
      const input = player.inputQueue.shift()!;
      if (player.state.status !== PlayerStatus.Alive) {
        player.state.lastProcessedSeq = input.seq;
        continue;
      }

      player.state.yaw = input.yaw;

      const flags = input.flags;
      let moveX = 0, moveZ = 0;
      const sinY = Math.sin(input.yaw);
      const cosY = Math.cos(input.yaw);

      if (flags & 1) { moveX -= sinY; moveZ -= cosY; }  // Forward
      if (flags & 2) { moveX += sinY; moveZ += cosY; }  // Backward
      if (flags & 4) { moveX -= cosY; moveZ += sinY; }  // Left
      if (flags & 8) { moveX += cosY; moveZ -= sinY; }  // Right

      const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
      if (len > 0) { moveX /= len; moveZ /= len; }

      let speed = C.PLAYER_SPEED;
      if ((flags & 32) && player.state.stamina > 0) { // Sprint
        speed *= C.SPRINT_MULTIPLIER;
        player.state.stamina -= C.SPRINT_STAMINA_COST * input.dt;
        if (player.state.stamina < 0) player.state.stamina = 0;
      }

      // Dodge
      if ((flags & 64) && now >= player.dodgeCdEnd && player.state.stamina >= C.DODGE_STAMINA_COST) {
        player.dodgeCdEnd = now + C.DODGE_COOLDOWN_MS;
        player.dodgeEnd = now + C.DODGE_DURATION_MS;
        player.state.isDodging = true;
        player.state.stamina -= C.DODGE_STAMINA_COST;
        const dodgeDir = len > 0
          ? { x: moveX * C.DODGE_FORCE, y: 2, z: moveZ * C.DODGE_FORCE }
          : { x: -sinY * C.DODGE_FORCE, y: 2, z: -cosY * C.DODGE_FORCE };
        player.body.setLinvel(new this.RAPIER.Vector3(dodgeDir.x, dodgeDir.y, dodgeDir.z), true);
      }

      if (now >= player.dodgeEnd) {
        player.state.isDodging = false;
      }

      if (!player.state.isDodging) {
        const vy = player.body.linvel().y;
        player.body.setLinvel(new this.RAPIER.Vector3(moveX * speed, vy, moveZ * speed), true);
      }

      // Jump
      if ((flags & 16) && Math.abs(player.body.linvel().y) < 0.5) {
        const v = player.body.linvel();
        player.body.setLinvel(new this.RAPIER.Vector3(v.x, C.JUMP_FORCE, v.z), true);
      }

      // Shoot arrow
      if (flags & 128) {
        const chargePct = Math.min(1, input.chargeMs / C.BOW_MAX_CHARGE_MS);
        const damage = C.ARROW_BASE_DAMAGE + (C.ARROW_MAX_DAMAGE - C.ARROW_BASE_DAMAGE) * chargePct;
        const dir: Vec3 = {
          x: -Math.sin(input.yaw) * Math.cos(input.pitch),
          y: Math.sin(input.pitch),
          z: -Math.cos(input.yaw) * Math.cos(input.pitch),
        };
        this.spawnProjectile(player.state.id, ProjectileType.Arrow, player.state.pos, dir, damage);
      }

      player.state.lastProcessedSeq = input.seq;
    }
  }

  private updateProjectiles(dt: number, now: number): void {
    const toRemove: number[] = [];
    for (const [id, proj] of this.projectiles) {
      // Lifetime check
      if (now - proj.spawnTime > C.ARROW_LIFETIME_MS) {
        toRemove.push(id);
        continue;
      }

      const t = proj.body.translation();
      proj.state.pos = { x: t.x, y: t.y, z: t.z };
      const v = proj.body.linvel();
      proj.state.vel = { x: v.x, y: v.y, z: v.z };

      // Ground collision
      if (t.y <= 0.1) {
        toRemove.push(id);
        continue;
      }

      // Player projectile → enemy/boss hit detection
      if (proj.state.type === ProjectileType.Arrow || proj.state.type === ProjectileType.FireArrow) {
        // Check enemies
        for (const enemy of this.enemies) {
          if (enemy.state.aiState === EnemyAIState.Dead) continue;
          const d = dist3(proj.state.pos, enemy.state.pos);
          if (d < 1.2) {
            enemy.state.hp -= proj.state.damage;
            this.broadcast(encodeDamage(DamageTargetType.Enemy, enemy.state.id, proj.state.damage, proj.state.ownerId));
            if (enemy.state.hp <= 0) {
              enemy.state.hp = 0;
              enemy.state.aiState = EnemyAIState.Dead;
            }
            toRemove.push(id);
            break;
          }
        }
        if (toRemove.includes(id)) continue;

        // Check boss
        if (this.boss && this.boss.state.phase !== BossPhase.Dead && this.boss.state.phase !== BossPhase.Idle) {
          const d = dist3(proj.state.pos, this.boss.state.pos);
          if (d < 2.5) {
            this.boss.state.hp -= proj.state.damage;
            this.broadcast(encodeDamage(DamageTargetType.Boss, 0, proj.state.damage, proj.state.ownerId));
            this.checkBossPhase();
            toRemove.push(id);
          }
        }
      }

      // Enemy/boss projectile → player hit detection
      if (proj.state.type === ProjectileType.EnemyProjectile || proj.state.type === ProjectileType.BossProjectile) {
        for (const player of this.players.values()) {
          if (player.state.status !== PlayerStatus.Alive) continue;
          if (player.state.isDodging) continue;
          const d = dist3(proj.state.pos, player.state.pos);
          if (d < 1.0) {
            this.damagePlayer(player, proj.state.damage, proj.state.ownerId);
            toRemove.push(id);
            break;
          }
        }
      }
    }

    for (const id of toRemove) {
      const proj = this.projectiles.get(id);
      if (proj) {
        this.world.removeRigidBody(proj.body);
        this.projectiles.delete(id);
      }
    }
  }

  private updateEnemies(dt: number, now: number): void {
    for (const enemy of this.enemies) {
      if (enemy.state.aiState === EnemyAIState.Dead) continue;

      const t = enemy.body.translation();
      enemy.state.pos = { x: t.x, y: t.y - 0.9, z: t.z };

      // Find nearest alive player
      let nearest: ServerPlayer | null = null;
      let nearestDist = Infinity;
      for (const player of this.players.values()) {
        if (player.state.status !== PlayerStatus.Alive) continue;
        const d = dist3(enemy.state.pos, player.state.pos);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = player;
        }
      }

      if (enemy.state.aiState === EnemyAIState.Patrol) {
        // Patrol in circle
        enemy.patrolAngle += dt * 0.5;
        const px = enemy.patrolOrigin.x + Math.cos(enemy.patrolAngle) * 5;
        const pz = enemy.patrolOrigin.z + Math.sin(enemy.patrolAngle) * 5;
        const dx = px - enemy.state.pos.x;
        const dz = pz - enemy.state.pos.z;
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        const vy = enemy.body.linvel().y;
        enemy.body.setLinvel(new this.RAPIER.Vector3(
          (dx / len) * C.ENEMY_PATROL_SPEED, vy, (dz / len) * C.ENEMY_PATROL_SPEED
        ), true);
        enemy.state.yaw = Math.atan2(dx, dz);

        if (nearest && nearestDist < C.ENEMY_AGGRO_RANGE) {
          enemy.state.aiState = EnemyAIState.Chase;
          enemy.state.targetId = nearest.state.id;
        }
      } else if (enemy.state.aiState === EnemyAIState.Chase) {
        if (!nearest || nearestDist > C.ENEMY_DEAGGRO_RANGE) {
          enemy.state.aiState = EnemyAIState.Patrol;
          enemy.state.targetId = 0;
          continue;
        }
        enemy.state.targetId = nearest.state.id;

        const dx = nearest.state.pos.x - enemy.state.pos.x;
        const dz = nearest.state.pos.z - enemy.state.pos.z;
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        enemy.state.yaw = Math.atan2(dx, dz);

        if (nearestDist <= C.ENEMY_MELEE_RANGE) {
          enemy.state.aiState = EnemyAIState.MeleeAttack;
        } else if (nearestDist <= C.ENEMY_RANGED_RANGE && now >= enemy.rangedCdEnd) {
          enemy.state.aiState = EnemyAIState.RangedAttack;
        } else {
          const vy = enemy.body.linvel().y;
          enemy.body.setLinvel(new this.RAPIER.Vector3(
            (dx / len) * C.ENEMY_CHASE_SPEED, vy, (dz / len) * C.ENEMY_CHASE_SPEED
          ), true);
        }
      } else if (enemy.state.aiState === EnemyAIState.MeleeAttack) {
        if (now >= enemy.meleeCdEnd && nearest) {
          if (nearestDist <= C.ENEMY_MELEE_RANGE && !nearest.state.isDodging) {
            this.damagePlayer(nearest, C.ENEMY_MELEE_DAMAGE, 200 + enemy.state.id);
          }
          enemy.meleeCdEnd = now + C.ENEMY_MELEE_COOLDOWN_MS;
        }
        enemy.state.aiState = EnemyAIState.Chase;
      } else if (enemy.state.aiState === EnemyAIState.RangedAttack) {
        if (now >= enemy.rangedCdEnd && nearest) {
          const dir = normalize3(sub3(nearest.state.pos, enemy.state.pos));
          dir.y += 0.1;
          this.spawnProjectile(200 + enemy.state.id, ProjectileType.EnemyProjectile, enemy.state.pos, dir, C.ENEMY_RANGED_DAMAGE);
          enemy.rangedCdEnd = now + C.ENEMY_RANGED_COOLDOWN_MS;
        }
        enemy.state.aiState = EnemyAIState.Chase;
      }
    }
  }

  private updateBoss(dt: number, now: number): void {
    if (!this.boss) return;
    const boss = this.boss;
    const b = boss.state;

    if (b.phase === BossPhase.Dead) return;

    const t = boss.body.translation();
    b.pos = { x: t.x, y: t.y - 2, z: t.z };

    // Activate boss when player enters arena
    if (b.phase === BossPhase.Idle) {
      for (const player of this.players.values()) {
        if (player.state.status !== PlayerStatus.Alive) continue;
        const d = dist3(player.state.pos, C.BOSS_ARENA_CENTER);
        if (d < C.BOSS_ARENA_RADIUS) {
          b.phase = BossPhase.Phase1;
          boss.activated = true;
          break;
        }
      }
      return;
    }

    // Find nearest player
    let nearest: ServerPlayer | null = null;
    let nearestDist = Infinity;
    for (const player of this.players.values()) {
      if (player.state.status !== PlayerStatus.Alive) continue;
      const d = dist3(b.pos, player.state.pos);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = player;
      }
    }

    if (!nearest) return;

    const dx = nearest.state.pos.x - b.pos.x;
    const dz = nearest.state.pos.z - b.pos.z;
    b.yaw = Math.atan2(dx, dz);

    const enrageMult = b.phase === BossPhase.Phase3Enrage ? C.BOSS_ENRAGE_MULTIPLIER : 1;

    // Reset AoE/barrage flags
    if (now >= boss.aoeEndTime) b.isAoE = false;
    if (now >= boss.barrageEndTime) b.isBarrage = false;

    // Melee if close
    if (nearestDist < 4 && now >= boss.meleeCdEnd) {
      if (!nearest.state.isDodging) {
        this.damagePlayer(nearest, C.BOSS_MELEE_DAMAGE * enrageMult, 255);
      }
      boss.meleeCdEnd = now + 2000 / enrageMult;
    }

    // AoE attack
    if (now >= boss.aoeCdEnd && b.phase !== BossPhase.Phase1) {
      b.isAoE = true;
      boss.aoeEndTime = now + 1000;
      boss.aoeCdEnd = now + 6000 / enrageMult;
      for (const player of this.players.values()) {
        if (player.state.status !== PlayerStatus.Alive) continue;
        if (player.state.isDodging) continue;
        const d = dist3(b.pos, player.state.pos);
        if (d < C.BOSS_AOE_RADIUS) {
          this.damagePlayer(player, C.BOSS_AOE_DAMAGE * enrageMult, 255);
        }
      }
    }

    // Projectile barrage
    if (now >= boss.barrageCdEnd) {
      b.isBarrage = true;
      boss.barrageEndTime = now + 1500;
      boss.barrageCdEnd = now + 8000 / enrageMult;
      const count = Math.round(C.BOSS_BARRAGE_COUNT * enrageMult);
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 / count) * i;
        const dir: Vec3 = { x: Math.sin(angle), y: 0.3, z: Math.cos(angle) };
        this.spawnProjectile(255, ProjectileType.BossProjectile, b.pos, dir, C.BOSS_PROJECTILE_DAMAGE * enrageMult);
      }
    }

    // Chase
    if (nearestDist > 4) {
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const speed = 3 * enrageMult;
      const vy = boss.body.linvel().y;
      boss.body.setLinvel(new this.RAPIER.Vector3((dx / len) * speed, vy, (dz / len) * speed), true);
    }
  }

  private checkBossPhase(): void {
    if (!this.boss) return;
    const b = this.boss.state;
    if (b.hp <= 0) {
      b.hp = 0;
      b.phase = BossPhase.Dead;
      this.broadcast(encodeGameOver(true));
      return;
    }
    const pct = b.hp / b.maxHp;
    if (pct <= C.BOSS_PHASE3_HP_PCT && b.phase !== BossPhase.Phase3Enrage) {
      b.phase = BossPhase.Phase3Enrage;
    } else if (pct <= C.BOSS_PHASE2_HP_PCT && b.phase === BossPhase.Phase1) {
      b.phase = BossPhase.Phase2;
    }
  }

  private damagePlayer(player: ServerPlayer, damage: number, sourceId: number): void {
    if (player.state.status !== PlayerStatus.Alive) return;
    player.state.hp -= damage;
    this.broadcast(encodeDamage(DamageTargetType.Player, player.state.id, damage, sourceId));
    if (player.state.hp <= 0) {
      player.state.hp = 0;
      player.state.status = PlayerStatus.Downed;

      // Check if all players downed → game over
      let allDowned = true;
      for (const p of this.players.values()) {
        if (p.state.status === PlayerStatus.Alive) { allDowned = false; break; }
      }
      if (allDowned) {
        this.broadcast(encodeGameOver(false));
      }
    }
  }

  private findPlayerById(id: number): ServerPlayer | undefined {
    for (const p of this.players.values()) {
      if (p.state.id === id) return p;
    }
    return undefined;
  }

  private broadcastSnapshot(now: number): void {
    const players: PlayerState[] = [];
    for (const p of this.players.values()) {
      players.push({ ...p.state });
    }
    const projectiles: ProjectileState[] = [];
    for (const pr of this.projectiles.values()) {
      projectiles.push({ ...pr.state });
    }
    const enemies: EnemyState[] = this.enemies.map(e => ({ ...e.state }));
    const boss: BossState | null = this.boss ? { ...this.boss.state } : null;

    const snap: GameSnapshot = { tick: this.tick, serverTime: now, players, projectiles, enemies, boss };
    const encoded = encodeSnapshot(snap);
    this.broadcast(encoded);
  }

  private send(ws: WebSocket, data: Uint8Array): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  }

  private broadcast(data: Uint8Array, exclude?: WebSocket): void {
    for (const player of this.players.values()) {
      if (player.ws !== exclude) {
        this.send(player.ws, data);
      }
    }
  }
}

// ── Vec3 helpers ──
function dist3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function normalize3(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
