// ── Ayodhya Protocol: Lanka Reforged ── Shared Types ──

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

// ── Network message types ──
export const enum MsgType {
  Join = 0,
  Snapshot = 1,
  Input = 2,
  ProjectileSpawn = 3,
  Damage = 4,
  EnemyState = 5,
  PlayerJoined = 6,
  PlayerLeft = 7,
  BossState = 8,
  Ability = 9,
  Revive = 10,
  GameOver = 11,
}

// ── Input flags (bitfield) ──
export const enum InputFlag {
  Forward = 1 << 0,
  Backward = 1 << 1,
  Left = 1 << 2,
  Right = 1 << 3,
  Jump = 1 << 4,
  Sprint = 1 << 5,
  Dodge = 1 << 6,
  Shoot = 1 << 7,
  FireArrow = 1 << 8,
  Shockwave = 1 << 9,
  Revive = 1 << 10,
  Meditate = 1 << 11,
}

export interface PlayerInput {
  seq: number;
  flags: number;
  yaw: number;
  pitch: number;
  chargeMs: number;
  dt: number;
}

// ── Player state ──
export const enum PlayerStatus {
  Alive = 0,
  Downed = 1,
  Dead = 2,
}

export interface PlayerState {
  id: number;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  hp: number;
  maxHp: number;
  stamina: number;
  status: PlayerStatus;
  isDodging: boolean;
  lastProcessedSeq: number;
}

// ── Projectile types ──
export const enum ProjectileType {
  Arrow = 0,
  FireArrow = 1,        // Agni Astra (player)
  ShockwaveArrow = 2,
  EnemyProjectile = 3,
  BossProjectile = 4,
  VayuAstra = 5,        // Wind arrow — knockback
  VarunaAstra = 6,      // Water arrow — slow
  NagaAstra = 7,        // Serpent arrow — poison DoT
  BrahmaAstra = 8,      // Ultimate — massive damage, long CD
  EnemyAgniAstra = 9,   // Enemy fires Agni Astra
  EnemyVayuAstra = 10,  // Enemy fires Vayu Astra
  EnemyNagaAstra = 11,  // Enemy fires Naga Astra
}

// ── Special arrow inventory (player-selectable) ──
export const enum SpecialArrowType {
  AgniAstra = 0,     // Fire — burn DoT
  VayuAstra = 1,     // Wind — knockback
  VarunaAstra = 2,   // Water — slow
  NagaAstra = 3,     // Serpent — poison
  BrahmaAstra = 4,   // Ultimate — massive single hit
}

export interface ProjectileState {
  id: number;
  type: ProjectileType;
  ownerId: number;
  pos: Vec3;
  vel: Vec3;
  damage: number;
}

// ── Enemy state ──
export const enum EnemyAIState {
  Patrol = 0,
  Chase = 1,
  MeleeAttack = 2,
  RangedAttack = 3,
  Dead = 4,
}

export interface EnemyState {
  id: number;
  pos: Vec3;
  yaw: number;
  hp: number;
  maxHp: number;
  aiState: EnemyAIState;
  targetId: number;
}

// ── Boss state ──
export const enum BossPhase {
  Idle = 0,
  Phase1 = 1,
  Phase2 = 2,
  Phase3Enrage = 3,
  Dead = 4,
}

export interface BossState {
  pos: Vec3;
  yaw: number;
  hp: number;
  maxHp: number;
  phase: BossPhase;
  isAoE: boolean;
  isBarrage: boolean;
}

// ── Snapshot ──
export interface GameSnapshot {
  tick: number;
  serverTime: number;
  players: PlayerState[];
  projectiles: ProjectileState[];
  enemies: EnemyState[];
  boss: BossState | null;
}

// ── Ability ──
export const enum AbilityType {
  FireArrow = 0,    // Agni Astra
  Shockwave = 1,
  VayuAstra = 2,
  VarunaAstra = 3,
  NagaAstra = 4,
  BrahmaAstra = 5,
}
