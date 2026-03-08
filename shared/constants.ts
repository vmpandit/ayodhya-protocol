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

// ── Ramayan Special Arrows ──
export const VAYU_ASTRA_COOLDOWN_MS = 6000;
export const VAYU_ASTRA_DAMAGE = 20;
export const VAYU_ASTRA_SPEED = 45;       // faster than normal
export const VAYU_ASTRA_KNOCKBACK = 8;

export const VARUNA_ASTRA_COOLDOWN_MS = 7000;
export const VARUNA_ASTRA_DAMAGE = 18;
export const VARUNA_ASTRA_SLOW_DURATION_MS = 3000;
export const VARUNA_ASTRA_SLOW_FACTOR = 0.4;

export const NAGA_ASTRA_COOLDOWN_MS = 8000;
export const NAGA_ASTRA_DAMAGE = 12;
export const NAGA_ASTRA_DOT = 6;
export const NAGA_ASTRA_DOT_TICKS = 5;

export const BRAHMA_ASTRA_COOLDOWN_MS = 20000;
export const BRAHMA_ASTRA_DAMAGE = 80;

// Enemy special arrow speed (slower for reaction time)
export const ENEMY_SPECIAL_ARROW_SPEED = 18;  // slower than player arrows
export const ENEMY_SPECIAL_ARROW_ALERT_MS = 1200; // alert display time

// Player stats
export const PLAYER_MAX_HP = 100;
export const PLAYER_MAX_STAMINA = 100;
export const STAMINA_REGEN_RATE = 15; // per second
export const SPRINT_STAMINA_COST = 20; // per second
export const DODGE_STAMINA_COST = 25;
export const REVIVE_DURATION_MS = 3000;
export const REVIVE_RANGE = 3;

// Enemy — Soldier (default)
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

// Enemy — Archer
export const ENEMY_ARCHER_HP = 45;
export const ENEMY_ARCHER_PATROL_SPEED = 2.5;
export const ENEMY_ARCHER_CHASE_SPEED = 5.0;
export const ENEMY_ARCHER_MELEE_DAMAGE = 8;
export const ENEMY_ARCHER_MELEE_COOLDOWN_MS = 2000;
export const ENEMY_ARCHER_RANGED_RANGE = 24;
export const ENEMY_ARCHER_RANGED_COOLDOWN_MS = 800;

// Enemy — Brute
export const ENEMY_BRUTE_HP = 100;
export const ENEMY_BRUTE_PATROL_SPEED = 1.5;
export const ENEMY_BRUTE_CHASE_SPEED = 3.5;
export const ENEMY_BRUTE_MELEE_DAMAGE = 20;
export const ENEMY_BRUTE_MELEE_COOLDOWN_MS = 1200;
export const ENEMY_BRUTE_MELEE_RANGE = 3.5;
export const ENEMY_BRUTE_RANGED_RANGE = 10;
export const ENEMY_BRUTE_RANGED_COOLDOWN_MS = 3000;

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
