// ── Ayodhya Protocol: Lanka Reforged ── Shared Constants ──

export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const MAX_PLAYERS = 4;

// Physics
export const GRAVITY = -20;
export const PLAYER_SPEED = 6;
export const SPRINT_MULTIPLIER = 1.7;
export const JUMP_FORCE = 9;
export const DODGE_FORCE = 12;
export const DODGE_DURATION_MS = 300;
export const DODGE_COOLDOWN_MS = 1200;

// Combat
export const BOW_MIN_CHARGE_MS = 200;
export const BOW_MAX_CHARGE_MS = 1500;
export const ARROW_BASE_DAMAGE = 15;
export const ARROW_MAX_DAMAGE = 45;
export const ARROW_SPEED = 35;
export const ARROW_LIFETIME_MS = 3000;
export const FIRE_ARROW_COOLDOWN_MS = 5000;
export const FIRE_ARROW_DAMAGE = 30;
export const FIRE_ARROW_DOT = 5;
export const FIRE_ARROW_DOT_TICKS = 4;
export const SHOCKWAVE_COOLDOWN_MS = 8000;
export const SHOCKWAVE_DAMAGE = 40;
export const SHOCKWAVE_RADIUS = 8;

// Player stats
export const PLAYER_MAX_HP = 100;
export const PLAYER_MAX_STAMINA = 100;
export const STAMINA_REGEN_RATE = 15; // per second
export const SPRINT_STAMINA_COST = 20; // per second
export const DODGE_STAMINA_COST = 25;
export const REVIVE_DURATION_MS = 3000;
export const REVIVE_RANGE = 3;

// Enemy
export const ENEMY_PATROL_SPEED = 2;
export const ENEMY_CHASE_SPEED = 4.5;
export const ENEMY_AGGRO_RANGE = 15;
export const ENEMY_DEAGGRO_RANGE = 25;
export const ENEMY_MELEE_RANGE = 2.5;
export const ENEMY_MELEE_DAMAGE = 12;
export const ENEMY_MELEE_COOLDOWN_MS = 1500;
export const ENEMY_RANGED_RANGE = 18;
export const ENEMY_RANGED_DAMAGE = 8;
export const ENEMY_RANGED_COOLDOWN_MS = 2500;
export const ENEMY_HP = 60;

// Boss
export const BOSS_HP_BASE = 500;
export const BOSS_HP_PER_PLAYER = 200;
export const BOSS_MELEE_DAMAGE = 25;
export const BOSS_AOE_DAMAGE = 35;
export const BOSS_AOE_RADIUS = 10;
export const BOSS_PROJECTILE_DAMAGE = 15;
export const BOSS_BARRAGE_COUNT = 8;
export const BOSS_PHASE2_HP_PCT = 0.6;
export const BOSS_PHASE3_HP_PCT = 0.25;
export const BOSS_ENRAGE_MULTIPLIER = 1.5;

// World
export const WORLD_SIZE = 120;
export const TREE_COUNT = 80;
export const SPAWN_POINT = { x: 0, y: 1, z: 0 };
export const BOSS_ARENA_CENTER = { x: 50, y: 0, z: 50 };
export const BOSS_ARENA_RADIUS = 20;
