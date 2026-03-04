// ── Ayodhya Protocol: Lanka Reforged ── Local Single-Player Simulation ──
// Runs the authoritative game logic in the browser so no server is needed.
// 7-chapter Ramayana storyline with companions, meditation, and Lakshman choice.

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

interface Pickup {
  id: number;
  pos: Vec3;
  arrows: number;
}

export interface Companion {
  id: string;
  name: string;
  pos: Vec3;
  damage: number;
  attackInterval: number;
  range: number;
  lastAttackTime: number;
  hpRegenBuff: number;  // HP/s regen buff to player
}

interface AllyNPC {
  id: string;
  name: string;
  pos: Vec3;
  met: boolean;
  message: string;
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

  // Arrow ammo system
  public arrowAmmo = 30;
  public readonly maxArrowAmmo = 50;

  // Pickups on the ground
  private pickups: Pickup[] = [];
  private nextPickupId = 1;

  // Chapter tracking (7 chapters)
  public chapter = 1;
  private chapterEnemiesKilled = 0;
  private chapterStarted = false;

  // Companion system
  public companions: Companion[] = [];

  // Ally NPCs (non-combatant story NPCs)
  public allyNPCs: AllyNPC[] = [];

  // Meditation system
  public isMeditating = false;
  public meditationTimer = 0;
  public readonly maxMeditationTime = 10;
  public canMeditate = false; // only during rest chapters with no enemies alive

  // Lakshman choice
  public lakshmanChoice: 'pending' | 'accepted' | 'declined' | null = null;

  // Lone Warrior buff (if Lakshman declined)
  public loneWarriorBuff = false;

  // Damage multiplier (affected by Lone Warrior)
  public get damageMultiplier(): number {
    return this.loneWarrierBuff_internal ? 1.3 : 1.0;
  }
  private get loneWarrierBuff_internal(): boolean { return this.loneWarriorBuff; }

  // Callbacks
  public onDamage: (targetType: DamageTargetType, targetId: number, damage: number, sourceId: number) => void = () => {};
  public onProjectileSpawn: (proj: ProjectileState) => void = () => {};
  public onGameOver: (won: boolean) => void = () => {};
  public onEnemySpecialArrow: (arrowName: string) => void = () => {};
  public onPickupSpawned: (id: number, pos: Vec3, arrows: number) => void = () => {};
  public onPickupCollected: (id: number) => void = () => {};
  public onChapterChange: (chapter: number, title: string, subtitle: string) => void = () => {};
  public onAllyMet: (id: string, name: string, message: string) => void = () => {};
  public onCompanionJoined: (id: string, name: string, pos: Vec3) => void = () => {};
  public onMeditationStateChanged: (active: boolean) => void = () => {};
  public onLakshmanChoice: () => void = () => {};
  public onAllyNPCSpawned: (id: string, name: string, pos: Vec3) => void = () => {};

  constructor() {
    this.player = {
      id: 1, pos: { ...C.SPAWN_POINT }, vel: { x: 0, y: 0, z: 0 }, yaw: 0,
      hp: C.PLAYER_MAX_HP, maxHp: C.PLAYER_MAX_HP, stamina: C.PLAYER_MAX_STAMINA,
      status: PlayerStatus.Alive, isDodging: false, lastProcessedSeq: 0,
    };

    // Chapter 1: 4 enemies in the jungle
    const chapter1Positions: Vec3[] = [
      { x: -20, y: 0, z: -20 }, { x: 20, y: 0, z: -25 },
      { x: -30, y: 0, z: 10 }, { x: 15, y: 0, z: 30 },
    ];
    for (const pos of chapter1Positions) {
      const id = this.nextEnemyId++;
      this.enemies.push({
        state: { id, pos: { ...pos }, yaw: 0, hp: C.ENEMY_HP, maxHp: C.ENEMY_HP, aiState: EnemyAIState.Patrol, targetId: 0 },
        patrolOrigin: { ...pos }, patrolAngle: Math.random() * Math.PI * 2,
        meleeCdEnd: 0, rangedCdEnd: 0,
      });
    }

    // Spawn boss (stays idle until Chapter 7)
    const maxHp = C.BOSS_HP_BASE;
    this.boss = {
      state: { pos: { ...C.BOSS_ARENA_CENTER }, yaw: 0, hp: maxHp, maxHp, phase: BossPhase.Idle, isAoE: false, isBarrage: false },
      meleeCdEnd: 0, aoeCdEnd: 0, barrageCdEnd: 0,
      aoeEndTime: 0, barrageEndTime: 0, activated: false,
    };
  }

  get playerId(): number { return 1; }

  // ── Meditation ────────────────────────────────────────────────
  startMeditation(): void {
    if (!this.canMeditate || this.isMeditating) return;
    if (this.player.status !== PlayerStatus.Alive) return;
    this.isMeditating = true;
    this.meditationTimer = 0;
    this.onMeditationStateChanged(true);
  }

  stopMeditation(): void {
    if (!this.isMeditating) return;
    this.isMeditating = false;
    this.meditationTimer = 0;
    this.onMeditationStateChanged(false);
  }

  // ── Lakshman Choice ──────────────────────────────────────────
  acceptLakshman(): void {
    if (this.lakshmanChoice !== 'pending') return;
    this.lakshmanChoice = 'accepted';
    // Lakshman joins as companion
    const pos: Vec3 = { x: this.player.pos.x - 4, y: 0, z: this.player.pos.z - 4 };
    this.companions.push({
      id: 'lakshman', name: 'Lakshman', pos,
      damage: 15, attackInterval: 3000, range: 15,
      lastAttackTime: 0, hpRegenBuff: 0,
    });
    this.player.maxHp += 20;
    this.player.hp = Math.min(this.player.hp + 20, this.player.maxHp);
    this.onCompanionJoined('lakshman', 'Lakshman', pos);
    // Enable meditation before final chapter
    this.canMeditate = true;
  }

  declineLakshman(): void {
    if (this.lakshmanChoice !== 'pending') return;
    this.lakshmanChoice = 'declined';
    this.loneWarriorBuff = true;
    // Enable meditation before final chapter
    this.canMeditate = true;
  }

  processInput(input: PlayerInput): void {
    if (this.player.status !== PlayerStatus.Alive) {
      this.player.lastProcessedSeq = input.seq;
      return;
    }

    // Handle meditation toggle
    if (input.flags & InputFlag.Meditate) {
      if (this.isMeditating) {
        this.stopMeditation();
      } else {
        this.startMeditation();
      }
    }

    // During meditation, block all movement/combat
    if (this.isMeditating) {
      // Any movement key cancels meditation
      if (input.flags & (InputFlag.Forward | InputFlag.Backward | InputFlag.Left | InputFlag.Right | InputFlag.Jump | InputFlag.Sprint | InputFlag.Dodge | InputFlag.Shoot)) {
        this.stopMeditation();
      }
      this.player.vel = { x: 0, y: 0, z: 0 };
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
    if (flags & InputFlag.Shoot && this.arrowAmmo > 0) {
      const baseDamage = C.ARROW_BASE_DAMAGE + (C.ARROW_MAX_DAMAGE - C.ARROW_BASE_DAMAGE) * 0.6;
      const damage = baseDamage * this.damageMultiplier;
      const dir: Vec3 = {
        x: -Math.sin(input.yaw) * Math.cos(input.pitch),
        y: Math.sin(input.pitch),
        z: -Math.cos(input.yaw) * Math.cos(input.pitch),
      };
      this.spawnProjectile(1, ProjectileType.Arrow, this.player.pos, dir, damage);
      this.arrowAmmo--;
    }

    // Stamina regen
    this.player.stamina = Math.min(C.PLAYER_MAX_STAMINA, this.player.stamina + C.STAMINA_REGEN_RATE * input.dt);
    this.player.vel = { x: moveX * speed, y: this.playerVelY, z: moveZ * speed };
    this.player.lastProcessedSeq = input.seq;
  }

  handleAbility(ability: AbilityType, dir: Vec3): void {
    const now = performance.now();
    if (this.player.status !== PlayerStatus.Alive) return;
    if (this.isMeditating) return;

    const mult = this.damageMultiplier;

    if (ability === AbilityType.FireArrow && now >= this.fireArrowCd) {
      this.fireArrowCd = now + C.FIRE_ARROW_COOLDOWN_MS;
      this.spawnProjectile(1, ProjectileType.FireArrow, this.player.pos, dir, C.FIRE_ARROW_DAMAGE * mult);
    } else if (ability === AbilityType.Shockwave && now >= this.shockwaveCd) {
      this.shockwaveCd = now + C.SHOCKWAVE_COOLDOWN_MS;
      this.applyShockwave();
    } else if (ability === AbilityType.VayuAstra && now >= this.vayuAstraCd) {
      this.vayuAstraCd = now + VAYU_ASTRA_COOLDOWN_MS;
      this.spawnProjectile(1, ProjectileType.VayuAstra, this.player.pos, dir, VAYU_ASTRA_DAMAGE * mult, VAYU_ASTRA_SPEED);
    } else if (ability === AbilityType.VarunaAstra && now >= this.varunaAstraCd) {
      this.varunaAstraCd = now + VARUNA_ASTRA_COOLDOWN_MS;
      this.spawnProjectile(1, ProjectileType.VarunaAstra, this.player.pos, dir, VARUNA_ASTRA_DAMAGE * mult);
    } else if (ability === AbilityType.NagaAstra && now >= this.nagaAstraCd) {
      this.nagaAstraCd = now + NAGA_ASTRA_COOLDOWN_MS;
      this.spawnProjectile(1, ProjectileType.NagaAstra, this.player.pos, dir, NAGA_ASTRA_DAMAGE * mult);
    } else if (ability === AbilityType.BrahmaAstra && now >= this.brahmaAstraCd) {
      this.brahmaAstraCd = now + BRAHMA_ASTRA_COOLDOWN_MS;
      this.spawnProjectile(1, ProjectileType.BrahmaAstra, this.player.pos, dir, BRAHMA_ASTRA_DAMAGE * mult);
    }
  }

  private applyShockwave(): void {
    const origin = this.player.pos;
    const mult = this.damageMultiplier;
    for (const enemy of this.enemies) {
      if (enemy.state.aiState === EnemyAIState.Dead) continue;
      if (dist3(origin, enemy.state.pos) <= C.SHOCKWAVE_RADIUS) {
        const dmg = C.SHOCKWAVE_DAMAGE * mult;
        enemy.state.hp -= dmg;
        this.onDamage(DamageTargetType.Enemy, enemy.state.id, dmg, 1);
        if (enemy.state.hp <= 0) {
          enemy.state.hp = 0;
          enemy.state.aiState = EnemyAIState.Dead;
          this.chapterEnemiesKilled++;
          this.spawnPickup(enemy.state.pos);
          this.checkChapterProgress();
        }
      }
    }
    if (this.boss.state.phase !== BossPhase.Dead && this.boss.state.phase !== BossPhase.Idle) {
      if (dist3(origin, this.boss.state.pos) <= C.SHOCKWAVE_RADIUS) {
        const dmg = C.SHOCKWAVE_DAMAGE * mult;
        this.boss.state.hp -= dmg;
        this.onDamage(DamageTargetType.Boss, 0, dmg, 1);
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

    // ── Meditation healing ──────────────────────────────────────
    if (this.isMeditating) {
      this.meditationTimer += dt;
      // Heal HP, stamina, arrows
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 10 * dt);
      this.player.stamina = Math.min(C.PLAYER_MAX_STAMINA, this.player.stamina + 20 * dt);
      this.arrowAmmo = Math.min(this.maxArrowAmmo, this.arrowAmmo + Math.floor(5 * dt));
      if (this.meditationTimer >= this.maxMeditationTime) {
        this.stopMeditation();
      }
    }

    // ── Companion HP regen buff ─────────────────────────────────
    for (const comp of this.companions) {
      if (comp.hpRegenBuff > 0) {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + comp.hpRegenBuff * dt);
      }
    }

    // ── Check ally NPC proximity ────────────────────────────────
    for (const ally of this.allyNPCs) {
      if (!ally.met && dist3(this.player.pos, ally.pos) < 5) {
        ally.met = true;
        this.onAllyMet(ally.id, ally.name, ally.message);
        this.handleAllyMet(ally.id);
      }
    }

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
            if (enemy.state.hp <= 0) {
              enemy.state.hp = 0;
              enemy.state.aiState = EnemyAIState.Dead;
              this.chapterEnemiesKilled++;
              this.spawnPickup(enemy.state.pos);
              this.checkChapterProgress();
            }
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

    // Collect pickups
    const pickupsToRemove: number[] = [];
    for (const pickup of this.pickups) {
      if (dist3(this.player.pos, pickup.pos) < 2.0) {
        this.arrowAmmo = Math.min(this.maxArrowAmmo, this.arrowAmmo + pickup.arrows);
        this.onPickupCollected(pickup.id);
        pickupsToRemove.push(pickup.id);
      }
    }
    this.pickups = this.pickups.filter(p => !pickupsToRemove.includes(p.id));

    // Update boss
    this.updateBoss(dt, now);

    // ── Companion AI ────────────────────────────────────────────
    this.updateCompanions(dt, now);

    // ── Update meditation availability ──────────────────────────
    this.updateMeditationAvailability();

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

  private updateMeditationAvailability(): void {
    // Can meditate during rest chapters (3 and 6) when no enemies alive
    const isRestChapter = (this.chapter === 3 || this.chapter === 6);
    const allEnemiesDead = this.enemies.every(e => e.state.aiState === EnemyAIState.Dead);
    this.canMeditate = isRestChapter && allEnemiesDead && this.player.status === PlayerStatus.Alive;
  }

  private updateCompanions(dt: number, now: number): void {
    for (const comp of this.companions) {
      // Follow the player — stay 3-5 units behind
      const dx = this.player.pos.x - comp.pos.x;
      const dz = this.player.pos.z - comp.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 4) {
        const speed = 5 * dt;
        comp.pos.x += (dx / d) * speed;
        comp.pos.z += (dz / d) * speed;
      }

      // Auto-attack nearest enemy/boss
      if (now - comp.lastAttackTime >= comp.attackInterval) {
        let nearestEnemy: LocalEnemy | null = null;
        let nearestDist = Infinity;
        for (const enemy of this.enemies) {
          if (enemy.state.aiState === EnemyAIState.Dead) continue;
          const ed = dist3(comp.pos, enemy.state.pos);
          if (ed < comp.range && ed < nearestDist) {
            nearestDist = ed;
            nearestEnemy = enemy;
          }
        }
        if (nearestEnemy) {
          nearestEnemy.state.hp -= comp.damage;
          this.onDamage(DamageTargetType.Enemy, nearestEnemy.state.id, comp.damage, 100);
          if (nearestEnemy.state.hp <= 0) {
            nearestEnemy.state.hp = 0;
            nearestEnemy.state.aiState = EnemyAIState.Dead;
            this.chapterEnemiesKilled++;
            this.spawnPickup(nearestEnemy.state.pos);
            this.checkChapterProgress();
          }
          comp.lastAttackTime = now;
        } else if (this.boss.state.phase !== BossPhase.Dead && this.boss.state.phase !== BossPhase.Idle) {
          const bd = dist3(comp.pos, this.boss.state.pos);
          if (bd < comp.range) {
            this.boss.state.hp -= comp.damage;
            this.onDamage(DamageTargetType.Boss, 0, comp.damage, 100);
            this.checkBossPhase();
            comp.lastAttackTime = now;
          }
        }
      }
    }
  }

  private handleAllyMet(allyId: string): void {
    if (allyId === 'sugriv') {
      // After meeting Sugriv, transition to Chapter 4 after a delay
      setTimeout(() => {
        this.advanceToChapter4();
      }, 4000);
    }
  }

  private advanceToChapter4(): void {
    this.chapter = 4;
    this.chapterEnemiesKilled = 0;
    this.canMeditate = false;
    this.onChapterChange(4, "Hanuman's Trial",
      "With Sugriv's blessing, you venture deeper into Lanka. Demon scouts block the path to Hanuman...");

    // Spawn 5 demon scouts (70 HP, faster)
    const ch4Positions: Vec3[] = [
      { x: -15, y: 0, z: -40 }, { x: 25, y: 0, z: -35 },
      { x: 40, y: 0, z: -10 }, { x: -35, y: 0, z: 20 },
      { x: 10, y: 0, z: 45 },
    ];
    for (const pos of ch4Positions) {
      const id = this.nextEnemyId++;
      this.enemies.push({
        state: { id, pos: { ...pos }, yaw: 0, hp: 70, maxHp: 70, aiState: EnemyAIState.Patrol, targetId: 0 },
        patrolOrigin: { ...pos }, patrolAngle: Math.random() * Math.PI * 2,
        meleeCdEnd: 0, rangedCdEnd: 0,
      });
    }
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
      // Only activate boss on Chapter 7
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

  private spawnPickup(pos: Vec3): void {
    const pickupId = this.nextPickupId++;
    const arrows = 5 + Math.floor(Math.random() * 6); // 5-10 arrows
    const pickup: Pickup = { id: pickupId, pos: { ...pos }, arrows };
    this.pickups.push(pickup);
    this.onPickupSpawned(pickupId, pickup.pos, pickup.arrows);
  }

  private checkChapterProgress(): void {
    // Chapter 1 → 2: 4 sentinels killed
    if (this.chapter === 1 && this.chapterEnemiesKilled >= 4) {
      this.chapter = 2;
      this.chapterEnemiesKilled = 0;
      this.onChapterChange(2, "The Demon Guard", "The alarm is raised! Ravana's elite guard emerges from the shadows...");

      // Spawn 4 tougher enemies for chapter 2
      const chapter2Positions: Vec3[] = [
        { x: -10, y: 0, z: -35 }, { x: 35, y: 0, z: 15 },
        { x: 25, y: 0, z: 45 }, { x: -15, y: 0, z: 40 },
      ];
      for (const pos of chapter2Positions) {
        const id = this.nextEnemyId++;
        this.enemies.push({
          state: { id, pos: { ...pos }, yaw: 0, hp: 80, maxHp: 80, aiState: EnemyAIState.Patrol, targetId: 0 },
          patrolOrigin: { ...pos }, patrolAngle: Math.random() * Math.PI * 2,
          meleeCdEnd: 0, rangedCdEnd: 0,
        });
      }
    }
    // Chapter 2 → 3 (Kishkindha — meet Sugriv): 4 elites killed
    else if (this.chapter === 2 && this.chapterEnemiesKilled >= 4) {
      this.chapter = 3;
      this.chapterEnemiesKilled = 0;
      this.canMeditate = true;
      this.onChapterChange(3, "Kishkindha — The Vanara Alliance",
        "The forest falls silent. A figure emerges from the trees — Sugriv, King of the Vanaras, seeks an audience...");

      // Spawn Sugriv as ally NPC
      const sugrivPos: Vec3 = { x: 0, y: 0, z: -15 };
      this.allyNPCs.push({
        id: 'sugriv', name: 'Sugriv', pos: sugrivPos, met: false,
        message: "Lord Rama! I am Sugriv, King of Kishkindha. My warriors Hanuman and Angad will aid you in your quest against Ravana. But first, you must prove your valor. Rest here — meditate and gather your strength. Press M to meditate.",
      });
      this.onAllyNPCSpawned('sugriv', 'Sugriv', sugrivPos);
    }
    // Chapter 4 → 5 (Angad's Challenge): 5 scouts killed → Hanuman joins
    else if (this.chapter === 4 && this.chapterEnemiesKilled >= 5) {
      this.chapter = 5;
      this.chapterEnemiesKilled = 0;

      // Hanuman joins as companion
      const hanumanPos: Vec3 = { x: this.player.pos.x + 3, y: 0, z: this.player.pos.z + 3 };
      this.companions.push({
        id: 'hanuman', name: 'Hanuman', pos: hanumanPos,
        damage: 10, attackInterval: 2000, range: 8,
        lastAttackTime: 0, hpRegenBuff: 0,
      });
      this.onCompanionJoined('hanuman', 'Hanuman', hanumanPos);

      this.onChapterChange(5, "Angad's Challenge",
        "Hanuman, the mighty Vanara, joins your side! Now face Ravana's elite demon warriors to earn Angad's loyalty...");

      // Spawn 5 elite demon warriors (90 HP)
      const ch5Positions: Vec3[] = [
        { x: -25, y: 0, z: -30 }, { x: 30, y: 0, z: -20 },
        { x: 40, y: 0, z: 25 }, { x: -20, y: 0, z: 35 },
        { x: 5, y: 0, z: -45 },
      ];
      for (const pos of ch5Positions) {
        const id = this.nextEnemyId++;
        this.enemies.push({
          state: { id, pos: { ...pos }, yaw: 0, hp: 90, maxHp: 90, aiState: EnemyAIState.Patrol, targetId: 0 },
          patrolOrigin: { ...pos }, patrolAngle: Math.random() * Math.PI * 2,
          meleeCdEnd: 0, rangedCdEnd: 0,
        });
      }
    }
    // Chapter 5 → 6 (Lakshman's Choice): 5 warriors killed → Angad joins, Lakshman choice
    else if (this.chapter === 5 && this.chapterEnemiesKilled >= 5) {
      this.chapter = 6;
      this.chapterEnemiesKilled = 0;
      this.canMeditate = true;

      // Angad joins as companion
      const angadPos: Vec3 = { x: this.player.pos.x - 3, y: 0, z: this.player.pos.z + 3 };
      this.companions.push({
        id: 'angad', name: 'Angad', pos: angadPos,
        damage: 8, attackInterval: 2500, range: 8,
        lastAttackTime: 0, hpRegenBuff: 2, // passive +2 HP/s
      });
      this.onCompanionJoined('angad', 'Angad', angadPos);

      this.onChapterChange(6, "Lakshman's Choice",
        "Angad joins your ranks! Your brother Lakshman offers to fight by your side. Will you accept his aid? Rest and meditate before the final battle...");

      // Trigger Lakshman choice after banner fades
      setTimeout(() => {
        this.lakshmanChoice = 'pending';
        this.onLakshmanChoice();
      }, 4500);
    }
  }

  /** Called externally (from Game.ts) when Lakshman choice is made and chapter 6 rest is done */
  advanceToChapter7(): void {
    if (this.chapter !== 6) return;
    if (this.lakshmanChoice === 'pending') return; // must choose first
    this.chapter = 7;
    this.chapterEnemiesKilled = 0;
    this.canMeditate = false;
    this.stopMeditation();

    this.onChapterChange(7, "The Demon King Ravana",
      "With your allies at your side, you march into the heart of Lanka. The ground trembles. Ravana awaits...");

    // Auto-activate boss
    this.boss.state.phase = BossPhase.Phase1;
    this.boss.activated = true;
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
