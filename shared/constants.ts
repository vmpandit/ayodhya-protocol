// ── Ayodhya Protocol: Lanka Reforged ── Shared Constants ──

export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const MAX_PLAYERS = 4;

// Physics
export const GRAVITY = -20;
export const PLAYER_SPEED = 6;
export const SPRINT_MULTIPLIER = 2.1;   // Buffed from 1.7 — sprint should feel dramatically faster
export const JUMP_FORCE = 10.5;         // Buffed from 9 — apex 2.76m, 1.05s hang time (Zelda-like)
export const DODGE_FORCE = 15;          // Buffed from 12 — covers 5.25 units (was 3.6, too short)
export const DODGE_DURATION_MS = 350;   // Buffed from 300 — slightly longer for animation feel
export const DODGE_COOLDOWN_MS = 700;   // Reduced from 1200 — enables skill-based dodge chains

// Combat
export const BOW_MIN_CHARGE_MS = 200;
export const BOW_MAX_CHARGE_MS = 1500;
export const ARROW_BASE_DAMAGE = 15;
export const ARROW_MAX_DAMAGE = 45;
export const ARROW_SPEED = 28;          // Reduced from 35 — prevents cross-arena sniping
export const ARROW_LIFETIME_MS = 2200;  // Reduced from 3000 — effective range ~62 units (was 105)
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

export const BRAHMA_ASTRA_COOLDOWN_MS = 20000;  // Legacy: still used as min interval between fires
export const BRAHMA_ASTRA_DAMAGE = 80;
// P2-2: Brahmastra build-up system — charge through combat, not cooldown
export const BRAHMA_MAX_CHARGE = 100;        // Charge needed to fire
export const BRAHMA_CHARGE_PER_HIT = 8;      // Charge per arrow hit on enemy
export const BRAHMA_CHARGE_PER_KILL = 20;    // Charge per enemy kill
export const BRAHMA_CHARGE_PER_COMBO = 5;    // Bonus per Astra combo triggered
export const BRAHMA_CHARGE_DECAY_RATE = 2;   // Charge lost per second when not attacking (encourages aggressive play)

// Enemy special arrow speed (slower for reaction time)
export const ENEMY_SPECIAL_ARROW_SPEED = 18;  // slower than player arrows
export const ENEMY_SPECIAL_ARROW_ALERT_MS = 1200; // alert display time

// Player stats
export const PLAYER_MAX_HP = 100;
export const PLAYER_MAX_STAMINA = 100;
export const STAMINA_REGEN_RATE = 20; // per second (buffed from 15 — faster recovery for active combat)
export const SPRINT_STAMINA_COST = 15; // per second (reduced from 20 — sprint now sustainable)
export const DODGE_STAMINA_COST = 20;  // reduced from 25 — less punishing, encourages evasion
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
export const WORLD_SIZE = 800;
export const TREE_COUNT = 300;
export const SPAWN_POINT = { x: 0, y: 1, z: 0 };
export const BOSS_ARENA_CENTER = { x: 600, y: 0, z: -700 };
export const BOSS_ARENA_RADIUS = 30;
export const TUTORIAL_BOUNDARY = 50;

// ── Chapter Zone Centers (Ramayana geographic journey) ──
export const CHAPTER_ZONES = {
  0: { x: 0, z: 0, name: 'Panchavati — Tutorial' },
  1: { x: -30, z: -100, name: 'Dandaka Forest' },
  2: { x: -80, z: -200, name: 'Jatayu\'s Fall' },
  3: { x: -150, z: -320, name: 'Kishkindha' },
  4: { x: -50, z: -450, name: 'Southern Shore' },
  5: { x: 200, z: -550, name: 'Ram Setu Bridge' },
  6: { x: 450, z: -650, name: 'Lanka Outskirts' },
  7: { x: 600, z: -700, name: 'Ravana\'s Lanka' },
};

// Ram Setu Bridge geometry
export const RAM_SETU_START = { x: -50, z: -470 };
export const RAM_SETU_END = { x: 450, z: -650 };
export const RAM_SETU_WIDTH = 12;

// Tree dimensions (towering Dandaka forest)
export const TREE_TRUNK_HEIGHT_MIN = 12;
export const TREE_TRUNK_HEIGHT_MAX = 22;
export const TREE_TRUNK_DIAMETER = 0.8;
export const TREE_CANOPY_HEIGHT = 18;
export const TREE_CANOPY_RADIUS_MIN = 4;
export const TREE_CANOPY_RADIUS_MAX = 8;

// ── Snap Shot vs Charged Shot ──
export const SNAP_SHOT_DAMAGE = 20;  // T2-1: Buffed from 12 to make quick-fire viable
export const CHARGED_SHOT_MIN_MS = 800;
export const CHARGED_SHOT_SPEED_PENALTY = 0.6;  // Movement speed multiplier while charging

// ── Perfect Dodge → Dharma Counter ──
export const PERFECT_DODGE_WINDOW_MS = 100;  // Last 100ms of telegraph
export const DHARMA_COUNTER_DURATION_MS = 1500;
export const DHARMA_COUNTER_STUN_MS = 500;

// ── Pashupatastra (Lone Warrior Exclusive) ──
export const PASHUPATASTRA_DAMAGE = 120;
export const PASHUPATASTRA_COOLDOWN_MS = 40000;
export const PASHUPATASTRA_SPEED = 40;

// ── Companion Active Abilities ──
export const HANUMAN_LEAP_DAMAGE = 15;
export const HANUMAN_LEAP_STUN_MS = 1000;
export const HANUMAN_LEAP_COOLDOWN_MS = 20000;
export const ANGAD_SHIELD_ABSORB = 30;
export const ANGAD_SHIELD_COOLDOWN_MS = 25000;
export const LAKSHMAN_COVER_ARROWS = 5;
export const LAKSHMAN_COVER_DAMAGE = 10;
export const LAKSHMAN_COVER_COOLDOWN_MS = 15000;

// ── Dharma Bond (Brotherhood passive) ──
export const DHARMA_BOND_HEAL_RATE = 3;  // HP/s when companions within range
export const DHARMA_BOND_RANGE = 10;

// ── Stamina-Tiered Shockwave ──
export const SHOCKWAVE_STAMINA_COST = 35; // Reduced from 40 — better skill expression
export const SHOCKWAVE_WEAK_RADIUS = 4;
export const SHOCKWAVE_WEAK_DAMAGE = 20;
export const SHOCKWAVE_STRONG_RADIUS = 10;
export const SHOCKWAVE_STRONG_DAMAGE = 60;

// ── Arrow Economy ──
export const STARTING_AMMO = 30;
export const ARROW_DROP_MIN = 4;
export const ARROW_DROP_MAX = 7;
export const BRAHMA_ARROW_COST = 5;
export const MEDITATION_ARROW_RESTORE = 10;

// ── Astra Synergy Combo Damage ──
export const COMBO_STEAM_BURST_DAMAGE = 25;
export const COMBO_STEAM_BURST_RADIUS = 4;
export const COMBO_TOXIC_CLOUD_DAMAGE = 8;  // per tick
export const COMBO_TOXIC_CLOUD_TICKS = 4;
export const COMBO_TOXIC_CLOUD_RADIUS = 3;
export const COMBO_SKYFALL_MULTIPLIER = 2.0;
export const COMBO_VENOMFIRE_DAMAGE = 35;
export const COMBO_MONSOON_RADIUS = 5;
export const COMBO_MONSOON_SLOW_DURATION_MS = 4000;
export const COMBO_PURIFY_HEAL = 25;

// ── Mini-Boss Champions ──
export const CHAMPION_HP_MULTIPLIER = 2.5;
export const CHAMPION_DAMAGE_MULTIPLIER = 1.5;
export const CHAMPION_SCALE = 1.4;

// ── Ravana Head Turrets (Phase 2) ──
export const RAVANA_HEAD_HP = 40;
export const RAVANA_HEAD_COOLDOWN_MS = 1500;
export const RAVANA_HEAD_DAMAGE = 10;
export const RAVANA_HEAD_COUNT = 2;

// ── Difficulty Scalars (P3-1: Full balance pass) ──
export const DIFFICULTY_STORY_HP = 0.6;       // Enemies have 60% HP (was 0.7)
export const DIFFICULTY_STORY_DMG = 0.5;      // Player takes 50% damage (was 0.7)
export const DIFFICULTY_STORY_DROPS = 2.5;    // 2.5x drop rate (was 2.0)
export const DIFFICULTY_STORY_AMMO_BONUS = 10; // +10 starting ammo
export const DIFFICULTY_STORY_STAMINA_REGEN = 1.3; // 30% faster stamina regen
export const DIFFICULTY_TAPASYA_HP = 1.5;     // Enemies have 150% HP (was 1.3)
export const DIFFICULTY_TAPASYA_DMG = 1.5;    // Player takes 150% damage (was 1.3)
export const DIFFICULTY_TAPASYA_DROPS = 0.5;  // Half drop rate (was 0.7)
export const DIFFICULTY_TAPASYA_AMMO_BONUS = -5; // -5 starting ammo (scarcity)
export const DIFFICULTY_TAPASYA_STAMINA_REGEN = 0.8; // 20% slower stamina regen

// ── Karma Scoring (P3-2: Calibrated — all 3 axes earnable to ~80+ in full run) ──
export const KARMA_MERCY_SPARE = 5;            // Spare retreating enemy
export const KARMA_MERCY_INVESTIGATION = 3;    // Investigate a lore point (compassion for the story)
export const KARMA_MERCY_COMPANION_HEAL = 2;   // When companion heals player (bond of mercy)
export const KARMA_MERCY_DIALOGUE_CHOICE = 4;  // Merciful dialogue choices
export const KARMA_VALOR_HEADSHOT = 3;
export const KARMA_VALOR_PERFECT_DODGE = 5;
export const KARMA_VALOR_CHAMPION_KILL = 8;    // Kill a champion enemy
export const KARMA_VALOR_WAVE_CLEAR = 3;       // Clear a wave without taking damage
export const KARMA_DEVOTION_MEDITATE = 2;
export const KARMA_DEVOTION_DIALOGUE = 3;
export const KARMA_DEVOTION_BRAHMASTRA = 5;    // Use Brahmastra (divine weapon = devotion)
export const KARMA_DEVOTION_INVESTIGATION = 2; // Investigate sacred clues

// ── Encounter Recipes ──
export const SIEGE_DURATION_MS = 60000;
export const SIEGE_WAVE_INTERVAL_MS = 15000;

// ── Asura Maya Illusion Mechanics ──
export const MAYA_ILLUSION_HP_THRESHOLD = 0.5;        // Trigger at 50% HP
export const MAYA_ILLUSION_DURATION_MS = 5000;        // Decoys last 5 seconds
export const MAYA_ILLUSION_COOLDOWN_MS = 20000;       // Cooldown between uses
export const MAYA_ILLUSION_COUNT = 2;                  // Number of decoys
export const MAYA_ILLUSION_HP_FRACTION = 0.15;        // Decoys have 15% of original HP
export const MAYA_ILLUSION_DAMAGE_MULTIPLIER = 0.5;   // Decoys deal 50% damage

// ── Variable Enemy Scale System ──
export const ENEMY_SCALE_SMALL = 0.7;
export const ENEMY_SCALE_NORMAL = 1.0;
export const ENEMY_SCALE_LARGE = 1.3;
export const ENEMY_SCALE_GIANT = 1.8;

// ── Flying/Erratic Enemy Behavior ──
export const FLYING_ENEMY_HEIGHT_MIN = 4.0;
export const FLYING_ENEMY_HEIGHT_MAX = 6.0;
export const FLYING_ENEMY_BOB_SPEED = 2.0;
export const FLYING_ENEMY_BOB_AMPLITUDE = 0.5;
export const FLYING_ENEMY_CIRCLE_RADIUS = 12.0;

export const ERRATIC_ENEMY_DIRECTION_CHANGE_MIN = 0.5;
export const ERRATIC_ENEMY_DIRECTION_CHANGE_MAX = 1.5;
export const ERRATIC_ENEMY_CHARGE_SPEED_MULTIPLIER = 3.0;
export const ERRATIC_ENEMY_CHARGE_DURATION = 0.5;      // seconds
export const ERRATIC_ENEMY_CHARGE_RECOVERY = 2.0;      // seconds

// ── Stealth Archery System (T3-4) ──
export const CROUCH_SPEED_MULTIPLIER = 0.4;
export const STEALTH_DAMAGE_MULTIPLIER = 2.0;
export const CROUCH_AGGRO_RANGE_REDUCTION = 0.5;

// ── Kumbhakarna Mini-Boss (T4-1) ──
export const KUMBHAKARNA_HP = 300;
export const KUMBHAKARNA_MELEE_DAMAGE = 35;
export const KUMBHAKARNA_MELEE_RANGE = 5;
export const KUMBHAKARNA_MELEE_COOLDOWN_MS = 2500;
export const KUMBHAKARNA_STOMP_DAMAGE = 20;
export const KUMBHAKARNA_STOMP_RADIUS = 8;
export const KUMBHAKARNA_STOMP_COOLDOWN_MS = 8000;
export const KUMBHAKARNA_SCALE = 2.5;
export const KUMBHAKARNA_SPEED = 2.0;

// ── Checkpoint/Savepoint System ──
export const CHECKPOINT_SAVE_KEY = 'ayodhya_checkpoint';

// ── Investigation Point System ──
export const INVESTIGATION_POINT_INTERACT_DISTANCE = 3.0;

// ── Ashram Rest Stops ──
// Ashram fire pits heal the player when standing nearby
export const ASHRAM_HEAL_RADIUS = 8;         // Distance from fire to receive healing
export const ASHRAM_HEAL_RATE = 12;           // HP per second while in range
export const ASHRAM_STAMINA_RATE = 15;        // Stamina per second while in range
export const ASHRAM_ARROW_INTERVAL = 3;       // Seconds between arrow restores
export const ASHRAM_ARROW_AMOUNT = 2;         // Arrows restored per interval
// Ashram fire pit positions (near each chapter zone center)
export const ASHRAM_POSITIONS = [
  { x: 0, z: -2 },             // Ch0: Tutorial ashram fire pit
  { x: -30, z: -102 },         // Ch1: Dandaka rest fire
  { x: -150, z: -322 },        // Ch3: Kishkindha camp
  { x: -50, z: -452 },         // Ch4: Southern shore campfire
];

// ── T4-2: Maricha Golden Deer Encounter ──
export const GOLDEN_DEER_SPEED = 7;
export const GOLDEN_DEER_HP = 80;
export const GOLDEN_DEER_FLEE_RANGE = 20;
export const GOLDEN_DEER_REVEAL_HP_PCT = 0.3;  // Transforms at 30% HP

// ── T4-3: Sacred Pillar Puzzle System ──
export const PUZZLE_INTERACT_DISTANCE = 2.5;
export const PUZZLE_REWARD_HP = 25;
export const PUZZLE_REWARD_ARROWS = 5;

// ── T4-4: Ashram Passive Skill Unlocks ──
export const ASHRAM_REST_UNLOCK_TIME = 10; // seconds of continuous rest to unlock skill
export const ASHRAM_SKILLS = [
  { chapter: 0, name: 'Agastya\'s Focus', desc: '+15% arrow speed', effect: 'arrowSpeed' },
  { chapter: 1, name: 'Dandaka Endurance', desc: '+20% stamina regen', effect: 'staminaRegen' },
  { chapter: 3, name: 'Kishkindha Agility', desc: '+10% movement speed', effect: 'moveSpeed' },
  { chapter: 4, name: 'Ocean\'s Resolve', desc: '+15% max HP', effect: 'maxHp' },
] as const;

// ── T3-3: Rākshasa Maya Trap Hazards (Indrajit's Nagapasha) ──
export const MAYA_TRAP_DAMAGE = 8;             // Damage per second while caught in maya trap
export const MAYA_TRAP_RADIUS = 2.0;           // Radius in which player takes damage
export const MAYA_TRAP_SLOW_FACTOR = 0.4;      // Movement speed multiplier when caught in maya
export const MAYA_TRAP_SLOW_DURATION_MS = 2000; // How long the slow lasts after leaving trap
export const NAGAPASHA_BIND_DURATION_MS = 1500; // Root/stun duration from Nagapasha bind
export const MAYA_DARKNESS_RADIUS = 8;          // Radius of darkness zone effect
