// ── Ayodhya Protocol: Lanka Reforged ── Local Single-Player Simulation ──
// Runs the authoritative game logic in the browser so no server is needed.

import {
  PlayerInput, PlayerState, PlayerStatus, ProjectileState, ProjectileType,
  EnemyState, EnemyAIState, BossState, BossPhase, Vec3, AbilityType,
  GameSnapshot, InputFlag,
} from '@shared/types';
import { DamageTargetType } from '@shared/protocol';
import * as C from '@shared/constants';
import {
  VAYU_ASTRA_DAMAGE, VAYU_ASTRA_SPEED, VAYU_ASTRA_COOLDOWN_MS,
  VARUNA_ASTRA_DAMAGE, VARUNA_ASTRA_COOLDOWN_MS,
  NAGA_ASTRA_DAMAGE, NAGA_ASTRA_COOLDOWN_MS,
  BRAHMA_ASTRA_DAMAGE, BRAHMA_ASTRA_COOLDOWN_MS,
  ENEMY_SPECIAL_ARROW_SPEED,
} from '@shared/constants';

interface LocalProjectile {
  state: ProjectileState;
  spawnTime: number;
  dotTicks: number;
}

interface LocalEnemy {
  state: EnemyState;
  patrolOrigin: Vec3;
  patrolAngle: number;
  meleeCdEnd: number;
  rangedCdEnd: number;
}

interface LocalBoss {
  state: BossState;
  meleeCdEnd: number;
  aoeCdEnd: number;
  barrageCdEnd: number;
  aoeEndTime: number;
  barrageEndTime: number;
  activated: boolean;
}

export class LocalSim {
  private player: PlayerState;
  private projectiles = new Map<number, LocalProjectile>();
  private nextProjId = 1;
  private enemies: LocalEnemy[] = [];
  private nextEnemyId = 1;
  private boss: LocalBoss;
  private tick = 0;
  private fireArrowCd = 0;
  private shockwaveCd = 0;
  private vayuAstraCd = 0;
  private varunaAstraCd = 0;
  private nagaAstraCd = 0;
  private brahmaAstraCd = 0;
  private dodgeCdEnd = 0;
  private dodgeEnd = 0;
  private playerVelY = 0;
  private grounded = true;

  public onDamage: (targetType: DamageTargetType, targetId: number, damage: number, sourceId: number) => void = () => {};
  public onProjectileSpawn: (proj: ProjectileState) => void = () => {};
  public onGameOver: (won: boolean) => void = () => {};
  public onEnemySpecialArrow: (arrowName: string) => void = () => {};

  constructor() {
    this.player = {
      id: 1, pos: { ...C.SPAWN_POINT }, vel: { x: 0, y: 0, z: 0 }, yaw: 0,
      hp: C.PLAYER_MAX_HP, maxHp: C.PLAYER_MAX_HP, stamina: C.PLAYER_MAX_STAMINA,
      status: PlayerStatus.Alive, isDodging: false, lastProcessedSeq: 0,
    };

    // Spawn enemies
    const positions: Vec3[] = [
      { x: -20, y: 0, z: -20 }, { x: 20, y: 0, z: -25 },
      { x: -30, y: 0, z: 10 }, { x: 15, y: 0, z: 30 },
      { x: -10, y: 0, z: -35 }, { x: 35, y: 0, z: 15 },
      { x: 25, y: 0, z: 45 }, { x: -15, y: 0, z: 40 },
    ];
    for (const pos of positions) {
      const id = this.nextEnemyId++;
      this.enemies.push({
        state: { id, pos: { ...pos }, yaw: 0, hp: C.ENEMY_HP, maxHp: C.ENEMY_HP, aiState: EnemyAIState.Patrol, targetId: 0 },
        patrolOrigin: { ...pos }, patrolAngle: Math.random() * Math.PI * 2,
        meleeCdEnd: 0, rangedCdEnd: 0,
      });
    }

    // Spawn boss
    const maxHp = C.BOSS_HP_BASE;
    this.boss = {
      state: { pos: { ...C.BOSS_ARENA_CENTER }, yaw: 0, hp: maxHp, maxHp, phase: BossPhase.Idle, isAoE: false, isBarrage: false },
      meleeCdEnd: 0, aoeCdEnd: 0, barrageCdEnd: 0,
      aoeEndTime: 0, barrageEndTime: 0, activated: false,
    };
  }

  get playerId(): number { return 1; }

  processInput(input: PlayerInput): void {
    if (this.player.status !== PlayerStatus.Alive) {
      this.player.lastProcessedSeq = input.seq;
      return;
    }

    const now = performance.now();
    this.player.yaw = input.yaw;
    const flags = input.flags;
    const sinY = Math.sin(input.yaw);
    const cosY = Math.cos(input.yaw);

    let moveX = 0, moveZ = 0;
    if (flags & InputFlag.Forward) { moveX -= sinY; moveZ -= cosY; }
    if (flags & InputFlag.Backward) { moveX += sinY; moveZ += cosY; }
    if (flags & InputFlag.Left) { moveX -= cosY; moveZ += sinY; }
    if (flags & InputFlag.Right) { moveX += cosY; moveZ -= sinY; }

    const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
    if (len > 0) { moveX /= len; moveZ /= len; }

    let speed = C.PLAYER_SPEED;
    if ((flags & InputFlag.Sprint) && this.player.stamina > 0) {
      speed *= C.SPRINT_MULTIPLIER;
      this.player.stamina -= C.SPRINT_STAMINA_COST * input.dt;
      if (this.player.stamina < 0) this.player.stamina = 0;
    }

    // Dodge
    if ((flags & InputFlag.Dodge) && now >= this.dodgeCdEnd && this.player.stamina >= C.DODGE_STAMINA_COST) {
      this.dodgeCdEnd = now + C.DODGE_COOLDOWN_MS;
      this.dodgeEnd = now + C.DODGE_DURATION_MS;
      this.player.isDodging = true;
      this.player.stamina -= C.DODGE_STAMINA_COST;
    }
    if (now >= this.dodgeEnd) this.player.isDodging = false;

    if (!this.player.isDodging) {
      this.player.pos.x += moveX * speed * input.dt;
      this.player.pos.z += moveZ * speed * input.dt;
    } else {
      const dodgeDir = len > 0
        ? { x: moveX * C.DODGE_FORCE, z: moveZ * C.DODGE_FORCE }
        : { x: -sinY * C.DODGE_FORCE, z: -cosY * C.DODGE_FORCE };
      this.player.pos.x += dodgeDir.x * input.dt;
      this.player.pos.z += dodgeDir.z * input.dt;
    }

    // Simple gravity
    this.playerVelY += C.GRAVITY * input.dt;
    this.player.pos.y += this.playerVelY * input.dt;
    if (this.player.pos.y <= 0) {
      this.player.pos.y = 0;
      this.playerVelY = 0;
      this.grounded = true;
    }

    // Jump
    if ((flags & InputFlag.Jump) && this.grounded) {
      this.playerVelY = C.JUMP_FORCE;
      this.grounded = false;
    }

    // Shoot (instant fire at moderate damage ~60% charge)
    if (flags & InputFlag.Shoot) {
      const damage = C.ARROW_BASE_DAMAGE + (C.ARROW_MAX_DAMAGE - C.ARROW_BASE_DAMAGE) * 0.6;
      const dir: Vec3 = {
        x: -Math.sin(input.yaw) * Math.cos(input.pitch),
        y: Math.sin(input.pitch),
        z: -Math.cos(input.yaw) * Math.cos(input.pitch),
      };
      this.spawnProjectile(1, ProjectileType.Arrow, this.player.pos, dir, damage);
    }

    // Stamina regen
    this.player.stamina = Math.min(C.PLAYER_MAX_STAMINA, this.player.stamina + C.STAMINA_REGEN_RATE * input.dt);
    this.player.vel = { x: moveX * speed, y: this.playerVelY, z: moveZ * speed };
    this.player.lastProcessedSeq = input.seq;
  }

  handleAbility(ability: AbilityType, dir: Vec3): void {
    const now = performance.now();
    if (this.player.status !== PlayerStatus.Alive) return;

    if (ability === AbilityType.FireArrow && now >= this.fireArrowCd) {
      this.fireArrowCd = now + C.FIRE_ARROW_COOLDOWN_MS;
      this.spawnProjectile(1, ProjectileType.FireArrow, this.player.pos, dir, C.FIRE_ARROW_DAMAGE);
    } else if (ability === AbilityType.Shockwave && now >= this.shockwaveCd) {
      this.shockwaveCd = now + C.SHOCKWAVE_COOLDOWN_MS;
      this.applyShockwave();
    } else if (ability === AbilityType.VayuAstra && now >= this.vayuAstraCd) {
      this.vayuAstraCd = now + VAYU_ASTRA_COOLDOWN_MS;
      this.spawnProjectile(1, ProjectileType.VayuAstra, this.player.pos, dir, VAYU_ASTRA_DAMAGE, VAYU_ASTRA_SPEED);
    } else if (ability === AbilityType.VarunaAstra && now >= this.varunaAstraCd) {
      this.varunaAstraCd = now + VARUNA_ASTRA_COOLDOWN_MS;
      this.spawnProjectile(1, ProjectileType.VarunaAstra, this.player.pos, dir, VARUNA_ASTRA_DAMAGE);
    } else if (ability === AbilityType.NagaAstra && now >= this.nagaAstraCd) {
      this.nagaAstraCd = now + NAGA_ASTRA_COOLDOWN_MS;
      this.spawnProjectile(1, ProjectileType.NagaAstra, this.player.pos, dir, NAGA_ASTRA_DAMAGE);
    } else if (ability === AbilityType.BrahmaAstra && now >= this.brahmaAstraCd) {
      this.brahmaAstraCd = now + BRAHMA_ASTRA_COOLDOWN_MS;
      this.spawnProjectile(1, ProjectileType.BrahmaAstra, this.player.pos, dir, BRAHMA_ASTRA_DAMAGE);
    }
  }

  private applyShockwave(): void {
    const origin = this.player.pos;
    for (const enemy of this.enemies) {
      if (enemy.state.aiState === EnemyAIState.Dead) continue;
      if (dist3(origin, enemy.state.pos) <= C.SHOCKWAVE_RADIUS) {
        enemy.state.hp -= C.SHOCKWAVE_DAMAGE;
        this.onDamage(DamageTargetType.Enemy, enemy.state.id, C.SHOCKWAVE_DAMAGE, 1);
        if (enemy.state.hp <= 0) { enemy.state.hp = 0; enemy.state.aiState = EnemyAIState.Dead; }
      }
    }
    if (this.boss.state.phase !== BossPhase.Dead && this.boss.state.phase !== BossPhase.Idle) {
      if (dist3(origin, this.boss.state.pos) <= C.SHOCKWAVE_RADIUS) {
        this.boss.state.hp -= C.SHOCKWAVE_DAMAGE;
        this.onDamage(DamageTargetType.Boss, 0, C.SHOCKWAVE_DAMAGE, 1);
        this.checkBossPhase();
      }
    }
  }

  private spawnProjectile(ownerId: number, type: ProjectileType, origin: Vec3, dir: Vec3, damage: number, speed?: number): void {
    const id = this.nextProjId++;
    const projSpeed = speed ?? C.ARROW_SPEED;
    const l = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
    const vel: Vec3 = { x: (dir.x / l) * projSpeed, y: (dir.y / l) * projSpeed, z: (dir.z / l) * projSpeed };
    const pos: Vec3 = { x: origin.x, y: origin.y + 1.2, z: origin.z };
    const state: ProjectileState = { id, type, ownerId, pos, vel, damage };
    this.projectiles.set(id, { state, spawnTime: performance.now(), dotTicks: 0 });
    this.onProjectileSpawn(state);
  }

  update(dt: number): GameSnapshot {
    const now = performance.now();
    this.tick++;

    // Clamp position
    const hs = C.WORLD_SIZE - 1;
    this.player.pos.x = Math.max(-hs, Math.min(hs, this.player.pos.x));
    this.player.pos.z = Math.max(-hs, Math.min(hs, this.player.pos.z));

    // Update projectiles
    const projToRemove: number[] = [];
    for (const [id, proj] of this.projectiles) {
      if (now - proj.spawnTime > C.ARROW_LIFETIME_MS) { projToRemove.push(id); continue; }
      proj.state.pos.x += proj.state.vel.x * dt;
      proj.state.pos.y += proj.state.vel.y * dt;
      proj.state.pos.z += proj.state.vel.z * dt;
      proj.state.vel.y -= 20 * 0.15 * dt;
      if (proj.state.pos.y < 0) { projToRemove.push(id); continue; }

      // Player arrows hit enemies/boss
      if (proj.state.type === ProjectileType.Arrow || proj.state.type === ProjectileType.FireArrow ||
          proj.state.type === ProjectileType.VayuAstra || proj.state.type === ProjectileType.VarunaAstra ||
          proj.state.type === ProjectileType.NagaAstra || proj.state.type === ProjectileType.BrahmaAstra) {
        for (const enemy of this.enemies) {
          if (enemy.state.aiState === EnemyAIState.Dead) continue;
          if (dist3(proj.state.pos, enemy.state.pos) < 1.2) {
            enemy.state.hp -= proj.state.damage;
            this.onDamage(DamageTargetType.Enemy, enemy.state.id, proj.state.damage, 1);
            if (enemy.state.hp <= 0) { enemy.state.hp = 0; enemy.state.aiState = EnemyAIState.Dead; }
            projToRemove.push(id); break;
          }
        }
        if (projToRemove.includes(id)) continue;
        if (this.boss.state.phase !== BossPhase.Dead && this.boss.state.phase !== BossPhase.Idle) {
          if (dist3(proj.state.pos, this.boss.state.pos) < 2.5) {
            this.boss.state.hp -= proj.state.damage;
            this.onDamage(DamageTargetType.Boss, 0, proj.state.damage, 1);
            this.checkBossPhase();
            projToRemove.push(id);
          }
        }
      }

      // Enemy/boss projectiles hit player
      if (proj.state.type === ProjectileType.EnemyProjectile || proj.state.type === ProjectileType.BossProjectile ||
          proj.state.type === ProjectileType.EnemyAgniAstra || proj.state.type === ProjectileType.EnemyVayuAstra ||
          proj.state.type === ProjectileType.EnemyNagaAstra) {
        if (this.player.status === PlayerStatus.Alive && !this.player.isDodging) {
          if (dist3(proj.state.pos, this.player.pos) < 1.0) {
            this.damagePlayer(proj.state.damage, proj.state.ownerId);
            projToRemove.push(id);
          }
        }
      }
    }
    for (const id of projToRemove) this.projectiles.delete(id);

    // Update enemies
    this.updateEnemies(dt, now);

    // Update boss
    this.updateBoss(dt, now);

    // Build snapshot
    const projectiles: ProjectileState[] = [];
    for (const p of this.projectiles.values()) projectiles.push({ ...p.state });
    return {
      tick: this.tick, serverTime: now,
      players: [{ ...this.player }],
      projectiles,
      enemies: this.enemies.map(e => ({ ...e.state })),
      boss: { ...this.boss.state },
    };
  }

  private updateEnemies(dt: number, now: number): void {
    for (const enemy of this.enemies) {
      if (enemy.state.aiState === EnemyAIState.Dead) continue;
      const nearestDist = dist3(enemy.state.pos, this.player.pos);

      if (enemy.state.aiState === EnemyAIState.Patrol) {
        enemy.patrolAngle += dt * 0.5;
        const px = enemy.patrolOrigin.x + Math.cos(enemy.patrolAngle) * 5;
        const pz = enemy.patrolOrigin.z + Math.sin(enemy.patrolAngle) * 5;
        const dx = px - enemy.state.pos.x;
        const dz = pz - enemy.state.pos.z;
        const l = Math.sqrt(dx * dx + dz * dz) || 1;
        enemy.state.pos.x += (dx / l) * C.ENEMY_PATROL_SPEED * dt;
        enemy.state.pos.z += (dz / l) * C.ENEMY_PATROL_SPEED * dt;
        enemy.state.yaw = Math.atan2(dx, dz);
        if (this.player.status === PlayerStatus.Alive && nearestDist < C.ENEMY_AGGRO_RANGE) {
          enemy.state.aiState = EnemyAIState.Chase;
          enemy.state.targetId = 1;
        }
      } else if (enemy.state.aiState === EnemyAIState.Chase) {
        if (this.player.status !== PlayerStatus.Alive || nearestDist > C.ENEMY_DEAGGRO_RANGE) {
          enemy.state.aiState = EnemyAIState.Patrol; enemy.state.targetId = 0; continue;
        }
        const dx = this.player.pos.x - enemy.state.pos.x;
        const dz = this.player.pos.z - enemy.state.pos.z;
        const l = Math.sqrt(dx * dx + dz * dz) || 1;
        enemy.state.yaw = Math.atan2(dx, dz);
        if (nearestDist <= C.ENEMY_MELEE_RANGE) {
          if (now >= enemy.meleeCdEnd && !this.player.isDodging) {
            this.damagePlayer(C.ENEMY_MELEE_DAMAGE, 200 + enemy.state.id);
            enemy.meleeCdEnd = now + C.ENEMY_MELEE_COOLDOWN_MS;
          }
        } else if (nearestDist <= C.ENEMY_RANGED_RANGE && now >= enemy.rangedCdEnd) {
          const dir = normalize3(sub3(this.player.pos, enemy.state.pos));
          dir.y += 0.1;

          // 30% chance to fire special arrow instead of normal projectile
          if (Math.random() < 0.3) {
            const specialArrowRoll = Math.random();
            let specialType: ProjectileType;
            let arrowName: string;

            if (specialArrowRoll < 0.33) {
              specialType = ProjectileType.EnemyAgniAstra;
              arrowName = "Agni Astra";
            } else if (specialArrowRoll < 0.66) {
              specialType = ProjectileType.EnemyVayuAstra;
              arrowName = "Vayu Astra";
            } else {
              specialType = ProjectileType.EnemyNagaAstra;
              arrowName = "Naga Astra";
            }

            this.spawnProjectile(200 + enemy.state.id, specialType, enemy.state.pos, dir, C.ENEMY_RANGED_DAMAGE, ENEMY_SPECIAL_ARROW_SPEED);
            this.onEnemySpecialArrow(arrowName);
          } else {
            this.spawnProjectile(200 + enemy.state.id, ProjectileType.EnemyProjectile, enemy.state.pos, dir, C.ENEMY_RANGED_DAMAGE);
          }

          enemy.rangedCdEnd = now + C.ENEMY_RANGED_COOLDOWN_MS;
        } else {
          enemy.state.pos.x += (dx / l) * C.ENEMY_CHASE_SPEED * dt;
          enemy.state.pos.z += (dz / l) * C.ENEMY_CHASE_SPEED * dt;
        }
      }
    }
  }

  private updateBoss(dt: number, now: number): void {
    const b = this.boss.state;
    if (b.phase === BossPhase.Dead) return;

    if (b.phase === BossPhase.Idle) {
      if (this.player.status === PlayerStatus.Alive && dist3(this.player.pos, C.BOSS_ARENA_CENTER) < C.BOSS_ARENA_RADIUS) {
        b.phase = BossPhase.Phase1;
      }
      return;
    }

    if (this.player.status !== PlayerStatus.Alive) return;

    const dx = this.player.pos.x - b.pos.x;
    const dz = this.player.pos.z - b.pos.z;
    const nearestDist = Math.sqrt(dx * dx + dz * dz);
    b.yaw = Math.atan2(dx, dz);

    const enrageMult = b.phase === BossPhase.Phase3Enrage ? C.BOSS_ENRAGE_MULTIPLIER : 1;

    if (now >= this.boss.aoeEndTime) b.isAoE = false;
    if (now >= this.boss.barrageEndTime) b.isBarrage = false;

    // Melee
    if (nearestDist < 4 && now >= this.boss.meleeCdEnd) {
      if (!this.player.isDodging) {
        this.damagePlayer(C.BOSS_MELEE_DAMAGE * enrageMult, 255);
      }
      this.boss.meleeCdEnd = now + 2000 / enrageMult;
    }

    // AoE
    if (now >= this.boss.aoeCdEnd && b.phase !== BossPhase.Phase1) {
      b.isAoE = true;
      this.boss.aoeEndTime = now + 1000;
      this.boss.aoeCdEnd = now + 6000 / enrageMult;
      if (this.player.status === PlayerStatus.Alive && !this.player.isDodging) {
        if (dist3(b.pos, this.player.pos) < C.BOSS_AOE_RADIUS) {
          this.damagePlayer(C.BOSS_AOE_DAMAGE * enrageMult, 255);
        }
      }
    }

    // Barrage
    if (now >= this.boss.barrageCdEnd) {
      b.isBarrage = true;
      this.boss.barrageEndTime = now + 1500;
      this.boss.barrageCdEnd = now + 8000 / enrageMult;
      const count = Math.round(C.BOSS_BARRAGE_COUNT * enrageMult);
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 / count) * i;
        const dir: Vec3 = { x: Math.sin(angle), y: 0.3, z: Math.cos(angle) };
        this.spawnProjectile(255, ProjectileType.BossProjectile, b.pos, dir, C.BOSS_PROJECTILE_DAMAGE * enrageMult);
      }
    }

    // Chase
    if (nearestDist > 4) {
      const l = nearestDist || 1;
      const speed = 3 * enrageMult;
      b.pos.x += (dx / l) * speed * dt;
      b.pos.z += (dz / l) * speed * dt;
    }
  }

  private checkBossPhase(): void {
    const b = this.boss.state;
    if (b.hp <= 0) { b.hp = 0; b.phase = BossPhase.Dead; this.onGameOver(true); return; }
    const pct = b.hp / b.maxHp;
    if (pct <= C.BOSS_PHASE3_HP_PCT && b.phase !== BossPhase.Phase3Enrage) b.phase = BossPhase.Phase3Enrage;
    else if (pct <= C.BOSS_PHASE2_HP_PCT && b.phase === BossPhase.Phase1) b.phase = BossPhase.Phase2;
  }

  private damagePlayer(damage: number, sourceId: number): void {
    if (this.player.status !== PlayerStatus.Alive) return;
    this.player.hp -= damage;
    this.onDamage(DamageTargetType.Player, 1, damage, sourceId);
    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this.player.status = PlayerStatus.Downed;
      this.onGameOver(false);
    }
  }
}

function dist3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function sub3(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function normalize3(v: Vec3): Vec3 {
  const l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
