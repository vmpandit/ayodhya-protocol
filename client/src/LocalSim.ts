// ── Ayodhya Protocol: Lanka Reforged ── Local Single-Player Simulation ──
// Runs the authoritative game logic in the browser so no server is needed.
// 7-chapter Ramayana storyline with companions, meditation, and Lakshman choice.

import {
  PlayerInput, PlayerState, PlayerStatus, ProjectileState, ProjectileType,
  EnemyState, EnemyAIState, BossState, BossPhase, Vec3, AbilityType,
  GameSnapshot, InputFlag, AstraElement, AstraCombo, Difficulty, KarmaScore, EncounterPhase,
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
import { DialogueNode, DialogueTree, DIALOGUE_TREES } from './DialogueTrees';

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
  telegraphEnd: number;     // Time when telegraph period ends; 0 if not telegraphing
  respawnTime?: number;  // For tutorial dummies
  originalMaxHp?: number;  // For tutorial dummies
  behaviorTimer: number;    // Time until next behavior change
  strafeDir: number;        // 1 = clockwise, -1 = counter-clockwise
  preferredRange: number;   // Ideal combat distance (8-20)
  enemyType: 'soldier' | 'archer' | 'brute';  // Enemy type for behavior and visual differentiation
  statusEffects: Set<AstraElement>;  // Active elemental effects (for Astra Synergy)
  statusExpiry: Map<AstraElement, number>;  // When each effect expires
  isChampion: boolean;      // Mini-boss champion variant
  slowFactor: number;       // Movement speed multiplier (Varuna slow)
  slowEnd: number;          // When slow effect expires
  mayaCooldownEnd?: number; // Maya illusion cooldown
  isIllusion?: boolean;     // This enemy is an illusion decoy
  illusionSourceId?: number; // ID of the real enemy if this is an illusion
  scale?: number;           // Enemy size multiplier
  flyingBobOffset?: number; // Sinusoidal bob offset for flying enemies
  erraticChargeEnd?: number; // When erratic charge ends
  erraticChargeTarget?: Vec3; // Charge direction
  erraticRecoveryEnd?: number; // When recovery period ends
  erraticDirectionChangeTimer?: number; // Time until next direction change
  deathTime?: number;       // T3-5: When enemy died (for pruning dead enemies)
  isKumbhakarna?: boolean; // T4-1: Kumbhakarna mini-boss flag
  stompCdEnd?: number; // T4-1: Stomp cooldown end time
  isGoldenDeer?: boolean;   // T4-2: Maricha's golden deer form
}

interface SacredPillar {
  id: string;
  pos: Vec3;
  chapter: number;
  order: number;        // Which position in the sequence (1, 2, 3)
  activated: boolean;
  requiredOrder: number; // Must be activated in this order
}

interface LocalBoss {
  state: BossState;
  meleeCdEnd: number;
  aoeCdEnd: number;
  barrageCdEnd: number;
  aoeEndTime: number;
  barrageEndTime: number;
  activated: boolean;
  heads: RavanaHead[];  // Phase 2 detachable head turrets
}

interface RavanaHead {
  id: number;
  pos: Vec3;
  hp: number;
  maxHp: number;
  cooldownEnd: number;
  alive: boolean;
}

// T4-5: Side quest system
interface SideQuest {
  id: string;
  name: string;
  description: string;
  givenBy: string;       // NPC id who gave it
  chapter: number;
  type: 'kill' | 'investigate' | 'reach';
  target: number;        // kill count target, or investigation point count
  progress: number;
  completed: boolean;
  reward: { hp?: number; arrows?: number; karmaAxis?: 'mercy' | 'valor' | 'devotion'; karmaAmount?: number };
}

interface Pickup {
  id: number;
  pos: Vec3;
  arrows: number;
}

interface HealthPickup {
  id: number;
  pos: Vec3;
  healAmount: number;
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
  // P2-1: Personality-based autonomous AI
  personality: 'aggressive' | 'defensive' | 'loyal';  // Hanuman=aggressive, Angad=defensive, Lakshman=loyal
  preferredDist: number;  // Ideal distance from player (aggressive=far flank, defensive=close, loyal=behind)
  flanking: boolean;      // Currently flanking to a position
  flankTarget: Vec3;      // Current flank destination
  combatCooldown: number; // Autonomous ability cooldown timer
}

interface StoryNPC {
  id: string;
  name: string;
  pos: Vec3;
  dialogueTreeId: string;
  spoken: boolean;
}

interface InvestigationPoint {
  id: string;
  pos: Vec3;
  chapter: number;
  clueText: string;
  investigated: boolean;
}

interface WaveState {
  currentWave: number;
  enemiesRemaining: number;
  waveComplete: boolean;
  waveStartedAt?: number;
  // P2-3: Wave rest beats
  restUntil?: number;     // Timestamp when rest period ends (0 = no rest)
  isResting: boolean;     // Currently in rest beat between waves
}

interface Encounter {
  id: number;
  phase: EncounterPhase;
  championId: number;
  chapter: number;
  phaseTimer: number;
  dialogueShown: boolean;
  midDialogueShown: boolean;
  defeatDialogueShown: boolean;
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
  // P2-2: Brahmastra build-up charge (replaces cooldown as primary gate)
  public brahmaCharge = 0;
  private lastBrahmaFireTime = 0;
  private dodgeCdEnd = 0;
  private dodgeEnd = 0;
  private dodgeJustTriggered = false; // Track if dodge was triggered this frame (G-07)
  private playerVelY = 0;
  private grounded = true;

  // Stealth Archery System (T3-4)
  public isCrouching = false;

  // Arrow ammo system (Arrow Economy: reduced from 30/50)
  public arrowAmmo = C.STARTING_AMMO;
  public readonly maxArrowAmmo = 40;

  // Difficulty system
  public difficulty: Difficulty = Difficulty.Dharma;
  private diffHpMult = 1.0;
  private diffDmgMult = 1.0;
  private diffDropMult = 1.0;

  // Karma scoring
  public karma: KarmaScore = { mercy: 0, valor: 0, devotion: 0 };
  private lastMeditationKarmaNotificationTime = 0;

  // Game over deferral for death dialogue
  private pendingGameOver = false;

  // T3-1: Sita reunion after Ravana death
  private sitaSpawned = false;

  // T3-5: Enemy pruning for memory management
  private lastPruneTime = 0;

  // Ashram rest stop
  public ashramNearby = false;
  private ashramArrowTimer = 0;

  // T4-4: Ashram skill unlock system
  private ashramRestTimer = 0;
  private unlockedAshramSkills: Set<string> = new Set();
  public onSkillUnlocked: (name: string, desc: string) => void = () => {};

  // T4-5: Side quest system
  public sideQuests: SideQuest[] = [];
  public onQuestStarted: (quest: SideQuest) => void = () => {};
  public onQuestProgress: (questId: string, progress: number, target: number) => void = () => {};
  public onQuestCompleted: (quest: SideQuest) => void = () => {};

  // Astra Synergy combo callback
  public onAstraCombo: (combo: AstraCombo, pos: Vec3, damage: number) => void = () => {};
  // Damage direction callback
  public onDamageDirection: (sourcePos: Vec3) => void = () => {};
  // Companion ability callback
  public onCompanionAbility: (companionId: string, abilityName: string) => void = () => {};
  // Karma update callback
  public onKarmaUpdate: (karma: KarmaScore) => void = () => {};
  // Karma event callback (individual karma gains/changes)
  public onKarmaEvent: (axis: 'mercy' | 'valor' | 'devotion', amount: number) => void = () => {};
  // Champion spawn callback
  public onChampionSpawned: (enemyId: number) => void = () => {};
  // Ravana head spawn callback
  public onRavanaHeadSpawned: (headId: number, pos: Vec3) => void = () => {};
  public onRavanaHeadDestroyed: (headId: number) => void = () => {};
  // Checkpoint callback
  public onCheckpointSaved: () => void = () => {};

  // Pashupatastra cooldown (Lone Warrior only)
  private pashupataCd = 0;

  // Companion active ability cooldowns
  private hanumanLeapCd = 0;
  private angadShieldCd = 0;
  private lakshmanCoverCd = 0;
  // Angad shield active absorb
  private angadShieldActive = false;
  private angadShieldAbsorb = 0;

  // Mid-chapter checkpoint
  private midChapterCheckpointSaved = false;
  private nextHeadId = 1;

  // Pickups on the ground
  private pickups: Pickup[] = [];
  private nextPickupId = 1;
  private healthPickups: HealthPickup[] = [];
  private nextHealthPickupId = 1;

  // Chapter tracking (0 = tutorial, 1-7 main chapters)
  public chapter = 0;
  private chapterEnemiesKilled = 0;
  private chapterStarted = false;

  // Companion system
  public companions: Companion[] = [];

  // Story NPCs (non-combatant NPCs with dialogue trees)
  public storyNPCs: StoryNPC[] = [];

  /** Helper: push a story NPC and fire the spawn callback for visual rendering */
  private addStoryNPC(npc: StoryNPC): void {
    this.storyNPCs.push(npc);
    this.onStoryNPCSpawned(npc.id, npc.name, npc.pos);
  }

  // Dialogue system
  public dialogueInProgress = false;
  private currentDialogueTree: DialogueTree | null = null;
  private currentDialogueNodeId: string | null = null;
  private nearbyNPCId: string | null = null;  // ID of NPC player is near (for "Press F to Talk")

  // Meditation system
  public isMeditating = false;
  public meditationTimer = 0;
  public readonly maxMeditationTime = 10;
  public canMeditate = false; // only during rest chapters with no enemies alive

  // Lakshman choice
  public lakshmanChoice: 'pending' | 'accepted' | 'declined' | null = null;

  // Lone Warrior buff (if Lakshman declined)
  public loneWarriorBuff = false;

  // Divine Blessings (Phase 4)
  public blessings: Set<string> = new Set();
  public blessingDamageMultiplier = 1.0;
  public sprintBonusMultiplier = 1.0;
  public arrowSpeedMultiplier = 1.0;
  public dodgeDurationBonus = 0.0;
  public bossDamageMultiplier = 1.0;
  public dharmaGraceEnd = 0;

  // Torch system
  public torchLit = false;
  public torchUnlocked = false;
  public campfirePos: Vec3 | null = null;
  public onTorchToggle: (lit: boolean) => void = () => {};
  public onCampfirePlaced: (pos: Vec3) => void = () => {};
  public onCampfirePickedUp: () => void = () => {};

  // Investigation point system
  private investigationPoints: InvestigationPoint[] = [];
  private nextInvestigationId = 1;

  // T4-2: Maricha Golden Deer encounter
  private goldenDeerActive = false;
  private goldenDeerEnemy: LocalEnemy | null = null;
  private goldenDeerRevealed = false;

  // T4-3: Sacred Pillar puzzle system
  private sacredPillars: SacredPillar[] = [];
  private puzzleSequence: number[] = [];  // Track activation order
  private pendingInteract = false;
  public onPillarActivated: (pillarId: string, correct: boolean) => void = () => {};
  public onPuzzleCompleted: (chapter: number) => void = () => {};

  // Wave-based spawning system (Chapters 4+)
  private waveStates = new Map<number, WaveState>();

  // Checkpoint system
  private lastCheckpointData: {
    chapter: number;
    playerHp: number;
    playerPos: Vec3;
    karma: KarmaScore;
    arrowAmmo: number;
    companions: string[];
  } | null = null;

  // Encounter state machine system
  private encounters: Encounter[] = [];
  private activeEncounter: Encounter | null = null;
  private nextEncounterId = 1;
  public onEncounterPhaseChange: (phase: EncounterPhase, dialogue?: string) => void = () => {};
  public encounterSlowFactor: number = 1.0; // G-09: Slow-time during Detection/Challenge phases

  // Tutorial system (Chapter 0)
  private tutorialSteps: Record<string, boolean> = {
    move: false,
    look: false,
    shoot: false,
    jump: false,
    dodge: false,
    sprint: false,
    specialArrow: false,
    shockwave: false,
    talk: false,
    meditate: false,
  };
  public tutorialComplete = false;
  private previousYaw = 0;

  // Backstory system
  public backstoryInProgress = false;
  private backstoryIndex = 0;
  private readonly BACKSTORY_SLIDES: { speaker: string; text: string }[] = [
    {
      speaker: 'Narrator',
      text: "In the Treta Yuga, in the sacred city of Ayodhya on the banks of the Sarayu, Prince Rama was born — the seventh avatar of Vishnu. He was Dharma incarnate: protector of the righteous, refuge of the helpless, the perfect son of King Dasharatha.",
    },
    {
      speaker: 'Narrator',
      text: "On the eve of his coronation, Queen Kaikeyi — bound by two ancient boons — demanded Rama's exile for fourteen years and the throne for her son Bharata. Rama accepted without a tremor, for a son's duty to his father's word is sacred above all.",
    },
    {
      speaker: 'Narrator',
      text: "Into the Dandaka forest went Rama, with Sita his beloved and Lakshman his loyal brother. There, Sage Agastya gifted Rama celestial weapons — the Brahmastra, Agni Astra, and Vayu Astra — knowing the great trial that lay ahead.",
    },
    {
      speaker: 'Narrator',
      text: "Ravana, the ten-headed king of Lanka, was once the greatest scholar in three worlds — master of the Vedas, blessed by Brahma with near-immortality. But desire poisoned his wisdom. He sent the demon Maricha as a golden deer to lure Rama away, then stole Sita by force.",
    },
    {
      speaker: 'Narrator',
      text: "The noble vulture Jatayu, friend of Dasharatha, fought Ravana in the sky to protect Sita — and fell, mortally wounded. With his dying breath, he told Rama: 'South. Ravana flew south.' Even in death, Dharma found its voice.",
    },
    {
      speaker: 'Narrator',
      text: "Rama journeyed south, restored the exiled Vanara king Sugriv to his throne, and earned the devotion of Hanuman — son of the Wind. Hanuman leapt across the ocean itself and found Sita in the Ashoka Vatika, steadfast in her faith.",
    },
    {
      speaker: 'Narrator',
      text: "Now the bridge of Nala and Nila spans the sea, inscribed with Rama's name — even the stones float for one who walks in Dharma. Lanka's golden towers gleam on the horizon. The final battle approaches — not for vengeance, but for the balance of all worlds.",
    },
  ];

  // Chapter goals system
  public chapterGoals: Record<number, { description: string; revealed: boolean; completed: boolean }> = {
    1: { description: 'Clear the Dandaka forest of Rakshasa sentinels — the path Agastya has shown you', revealed: false, completed: false },
    2: { description: 'Avenge Jatayu — destroy the Demon Guard who patrol where the noble vulture fell', revealed: false, completed: false },
    3: { description: 'Forge the Vanara alliance with King Sugriv of Kishkindha', revealed: false, completed: false },
    4: { description: 'Silence Ravana\'s demon scouts — clear the path to the sea crossing', revealed: false, completed: false },
    5: { description: 'Prove worthy of the Vanara army — defeat Lanka\'s elite warriors', revealed: false, completed: false },
    6: { description: 'Hear Vibhishana\'s secret and prepare for the final battle', revealed: false, completed: false },
    7: { description: 'Strike the Amrita in Ravana\'s navel with the Brahmastra — restore Dharma to the three worlds', revealed: true, completed: false },
  };

  // Damage multiplier (affected by Lone Warrior and Blessings)
  public get damageMultiplier(): number {
    const baseMultiplier = this.loneWarrierBuff_internal ? 1.3 : 1.0;
    return baseMultiplier * this.blessingDamageMultiplier;
  }
  private get loneWarrierBuff_internal(): boolean { return this.loneWarriorBuff; }

  // Terrain obstacles
  private obstacles: { pos: Vec3; radius: number }[] = [
    { pos: { x: -15, y: 0, z: -15 }, radius: 2 },
    { pos: { x: 10, y: 0, z: -30 }, radius: 2.5 },
    { pos: { x: -25, y: 0, z: 5 }, radius: 2 },
    { pos: { x: 30, y: 0, z: -5 }, radius: 3 },
    { pos: { x: -5, y: 0, z: 25 }, radius: 2 },
    { pos: { x: 20, y: 0, z: 35 }, radius: 2.5 },
    { pos: { x: -35, y: 0, z: -25 }, radius: 2 },
    { pos: { x: 0, y: 0, z: -40 }, radius: 2.5 },
  ];

  // Chapter geographic centers (for environment positioning and encounter triggers)
  private readonly CHAPTER_POSITIONS: Record<number, { x: number; z: number }> = {
    0: { x: 0, z: 0 },
    1: { x: -30, z: -100 },
    2: { x: -80, z: -200 },
    3: { x: -150, z: -320 },
    4: { x: -50, z: -450 },
    5: { x: 200, z: -550 },
    6: { x: 450, z: -650 },
    7: { x: 600, z: -700 },
  };

  // Callbacks
  public onDamage: (targetType: DamageTargetType, targetId: number, damage: number, sourceId: number) => void = () => {};
  public onObstaclesInit: (obstacles: { pos: Vec3; radius: number }[]) => void = () => {};
  public onProjectileSpawn: (proj: ProjectileState) => void = () => {};
  public onGameOver: (won: boolean) => void = () => {};
  public onEnemySpecialArrow: (arrowName: string) => void = () => {};
  public onPickupSpawned: (id: number, pos: Vec3, arrows: number) => void = () => {};
  public onPickupCollected: (id: number) => void = () => {};
  public onHeadshot?: (enemyId: number) => void;
  public onCriticalHit?: (targetType: DamageTargetType, targetId: number, damage: number) => void;
  public onHealthPickupSpawned?: (id: number, pos: Vec3, healAmount: number) => void;
  public onHealthPickupCollected?: (id: number) => void;
  public onChapterChange: (chapter: number, title: string, subtitle: string) => void = () => {};
  public onAllyMet: (id: string, name: string, message: string) => void = () => {};
  public onStoryNPCSpawned: (id: string, name: string, pos: Vec3) => void = () => {};
  public onCompanionJoined: (id: string, name: string, pos: Vec3) => void = () => {};
  public onMeditationStateChanged: (active: boolean) => void = () => {};
  public onLakshmanChoice: () => void = () => {};
  public onNPCNearby: (id: string, name: string) => void = () => {};
  public onDialogueNode: (node: DialogueNode, isEnd: boolean) => void = () => {};
  public onGoalRevealed: (chapter: number, description: string) => void = () => {};
  /** Multi-line dialogue sequence for richer story moments */
  public onDialogueSequence: (lines: { name: string; message: string }[]) => void = () => {};
  public onGoalCompleted: (chapter: number, description: string) => void = () => {};
  public onTutorialStep: (step: string, allComplete: boolean) => void = () => {};
  public onBackstorySlide: (index: number, speaker: string, text: string, isLast: boolean) => void = () => {};
  public onBackstoryEnd: () => void = () => {};
  public onMapReveal: (cx: number, cz: number, radius: number, chapter: number, note?: string) => void = () => {};
  public onMapWaypoint: (x: number, z: number, type: number, label: string, chapter: number) => void = () => {};
  public onEnemyDroppedMap: (enemyId: number, cx: number, cz: number, radius: number) => void = () => {};
  public onBlessingReceived: (name: string, description: string) => void = () => {};
  public onDharmaGrace: () => void = () => {};
  public onInvestigationTriggered: (clue: string) => void = () => {};
  public onWaveAnnouncement: (waveNumber: number, totalWaves: number) => void = () => {};
  public onMayaIllusionCreated: (realEnemyId: number, illusionIds: number[]) => void = () => {};

  constructor() {
    const spawnY = getTerrainHeight(C.SPAWN_POINT.x, C.SPAWN_POINT.z);
    this.player = {
      id: 1, pos: { x: C.SPAWN_POINT.x, y: spawnY, z: C.SPAWN_POINT.z }, vel: { x: 0, y: 0, z: 0 }, yaw: 0,
      hp: C.PLAYER_MAX_HP, maxHp: C.PLAYER_MAX_HP, stamina: C.PLAYER_MAX_STAMINA,
      status: PlayerStatus.Alive, isDodging: false, lastProcessedSeq: 0,
    };

    this.previousYaw = 0;

    // Chapter 0 (Tutorial): Spawn 3 training dummies that don't attack
    const tutorialDummyPositions: Vec3[] = [
      { x: 8, y: 0, z: -6 },
      { x: -10, y: 0, z: -10 },
      { x: 12, y: 0, z: -18 },
    ];
    for (const pos of tutorialDummyPositions) {
      const enemy = this.createEnemy(pos, 30, 'soldier');
      enemy.originalMaxHp = 30;
      this.enemies.push(enemy);
    }

    // Spawn Sage Agastya as story NPC in Chapter 0 (tutorial guide)
    const sagePos: Vec3 = { x: 0, y: 0, z: -30 };
    this.addStoryNPC({
      id: 'sage', name: 'Sage Agastya', pos: sagePos,
      dialogueTreeId: 'ch1_sage', spoken: false,
    });

    // Spawn boss (stays idle until Chapter 7)
    const maxHp = C.BOSS_HP_BASE;
    this.boss = {
      state: { pos: { ...C.BOSS_ARENA_CENTER }, yaw: 0, hp: maxHp, maxHp, phase: BossPhase.Idle, isAoE: false, isBarrage: false },
      meleeCdEnd: 0, aoeCdEnd: 0, barrageCdEnd: 0,
      aoeEndTime: 0, barrageEndTime: 0, activated: false,
      heads: [],
    };

    // Initialize obstacles in the world
    this.onObstaclesInit(this.obstacles);

    // T4-3: Initialize sacred pillar puzzles
    this.setupPuzzlePillars();
  }

  get playerId(): number { return 1; }

  getPlayerState(): PlayerState { return this.player; }

  // ── Goal System ─────────────────────────────────────────────────
  revealGoal(chapter: number): void {
    const goal = this.chapterGoals[chapter];
    if (goal && !goal.revealed) {
      goal.revealed = true;
      this.onGoalRevealed(chapter, goal.description);
    }
  }

  completeGoal(chapter: number): void {
    const goal = this.chapterGoals[chapter];
    if (goal) {
      goal.completed = true;
      this.onGoalCompleted(chapter, goal.description);
    }
  }

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

  // ── Dialogue System ──────────────────────────────────────────
  hasDialogueTree(treeId: string): boolean {
    return !!DIALOGUE_TREES[treeId];
  }

  startDialogue(treeId: string): void {
    const tree = DIALOGUE_TREES[treeId];
    if (!tree) {
      console.warn(`[LocalSim] Dialogue tree not found: ${treeId}`);
      return;
    }
    this.currentDialogueTree = tree;
    this.currentDialogueNodeId = tree.startNodeId;
    this.dialogueInProgress = true;

    // Tutorial tracking: mark "talk" step as complete
    if (this.chapter === 0 && !this.tutorialComplete && !this.tutorialSteps.talk) {
      this.tutorialSteps.talk = true;
      this.onTutorialStep('talk', this.checkTutorialComplete());
    }
    // Karma: devotion for engaging in dialogue
    this.karma.devotion += C.KARMA_DEVOTION_DIALOGUE;
    this.onKarmaEvent('devotion', C.KARMA_DEVOTION_DIALOGUE);

    const node = tree.nodes[tree.startNodeId];
    if (node) {
      const isEnd = !node.choices || node.choices.length === 0;
      this.onDialogueNode(node, isEnd);
    }
  }

  // T4-3: Trigger pillar interaction on Talk key
  triggerPillarInteract(): void {
    this.pendingInteract = true;
  }

  selectChoice(index: number): void {
    if (!this.currentDialogueTree || !this.currentDialogueNodeId) return;

    const currentNode = this.currentDialogueTree.nodes[this.currentDialogueNodeId];
    if (!currentNode || !currentNode.choices || index < 0 || index >= currentNode.choices.length) {
      return;
    }

    const choice = currentNode.choices[index];

    // If this choice reveals the goal, do it now
    if (choice.revealsGoal) {
      this.revealGoal(this.chapter);
    }

    // Move to the next node
    const nextNode = this.currentDialogueTree.nodes[choice.nextNodeId];
    if (nextNode) {
      this.currentDialogueNodeId = choice.nextNodeId;
      const isEnd = !nextNode.choices || nextNode.choices.length === 0;
      this.onDialogueNode(nextNode, isEnd);

      // End node: player must press Space or click "Continue" — no auto-close
    }
  }

  endDialogue(): void {
    if (!this.dialogueInProgress) return;

    // Mark the NPC as spoken to and reveal map area (first time only)
    if (this.nearbyNPCId) {
      const npc = this.storyNPCs.find(n => n.id === this.nearbyNPCId);
      if (npc && !npc.spoken) {
        npc.spoken = true;
        // Apply blessing from this NPC (first conversation only)
        this.applyBlessing(npc.id);
        // NPC reveals a large map area + waypoint
        this.onMapWaypoint(npc.pos.x, npc.pos.z, 1, npc.name, this.chapter); // NPCLocation = 1
        this.onMapReveal(npc.pos.x, npc.pos.z, 25, this.chapter, `${npc.name} shared knowledge of the surrounding lands`);
      }
    }

    this.dialogueInProgress = false;
    this.currentDialogueTree = null;
    this.currentDialogueNodeId = null;
    this.nearbyNPCId = null;

    // T3-1: Spawn Sita after Ravana's death dialogue ends
    if (this.pendingGameOver && !this.sitaSpawned) {
      this.sitaSpawned = true;
      const base7 = C.CHAPTER_ZONES[7];
      const sitaPos: Vec3 = { x: base7.x, y: 0, z: base7.z + 10 };
      this.addStoryNPC({
        id: 'sita',
        name: 'Sita',
        pos: sitaPos,
        dialogueTreeId: 'sita_reunion',
        spoken: false,
      });
      this.pendingGameOver = false; // Don't end game yet — let player talk to Sita
      return; // Don't trigger onGameOver yet
    }

    // T3-1: After Sita reunion dialogue ends, trigger victory
    const sita = this.storyNPCs.find(n => n.id === 'sita');
    if (sita && sita.spoken && !this.pendingGameOver) {
      this.onGameOver(true);
      return;
    }

    // Check if this was a deferred game over from Ravana's death dialogue
    if (this.pendingGameOver) {
      this.pendingGameOver = false;
      this.onGameOver(true);
    }
  }

  getNearbyNPC(): StoryNPC | null {
    if (!this.nearbyNPCId) return null;
    return this.storyNPCs.find(n => n.id === this.nearbyNPCId) || null;
  }

  // Get enemy type for visual differentiation
  getEnemyType(enemyId: number): 'soldier' | 'archer' | 'brute' {
    const enemy = this.enemies.find(e => e.state.id === enemyId);
    return enemy ? enemy.enemyType : 'soldier';
  }

  // ── Difficulty Selector ──────────────────────────────────
  // P3-1: Stamina regen multiplier per difficulty
  private staminaRegenMult = 1.0;

  setDifficulty(diff: Difficulty): void {
    this.difficulty = diff;
    if (diff === Difficulty.Story) {
      this.diffHpMult = C.DIFFICULTY_STORY_HP;
      this.diffDmgMult = C.DIFFICULTY_STORY_DMG;
      this.diffDropMult = C.DIFFICULTY_STORY_DROPS;
      this.staminaRegenMult = C.DIFFICULTY_STORY_STAMINA_REGEN;
      this.arrowAmmo = Math.min(this.maxArrowAmmo, this.arrowAmmo + C.DIFFICULTY_STORY_AMMO_BONUS);
    } else if (diff === Difficulty.Tapasya) {
      this.diffHpMult = C.DIFFICULTY_TAPASYA_HP;
      this.diffDmgMult = C.DIFFICULTY_TAPASYA_DMG;
      this.diffDropMult = C.DIFFICULTY_TAPASYA_DROPS;
      this.staminaRegenMult = C.DIFFICULTY_TAPASYA_STAMINA_REGEN;
      this.arrowAmmo = Math.max(5, this.arrowAmmo + C.DIFFICULTY_TAPASYA_AMMO_BONUS);
    } else {
      this.diffHpMult = 1.0;
      this.diffDmgMult = 1.0;
      this.diffDropMult = 1.0;
      this.staminaRegenMult = 1.0;
    }
    // Scale existing enemies
    for (const enemy of this.enemies) {
      if (enemy.state.aiState !== EnemyAIState.Dead) {
        const baseHp = enemy.isChampion
          ? enemy.state.maxHp / C.CHAMPION_HP_MULTIPLIER
          : enemy.state.maxHp;
        const scaledHp = baseHp * this.diffHpMult * (enemy.isChampion ? C.CHAMPION_HP_MULTIPLIER : 1);
        enemy.state.maxHp = scaledHp;
        enemy.state.hp = Math.min(enemy.state.hp, scaledHp);
      }
    }
  }

  /** Create a properly-initialized enemy with all new fields */
  private createEnemy(pos: Vec3, hp: number, enemyType: 'soldier' | 'archer' | 'brute', isChampion = false): LocalEnemy {
    const id = this.nextEnemyId++;
    const champMult = isChampion ? C.CHAMPION_HP_MULTIPLIER : 1;

    // Determine scale based on chapter and type
    const scale = this.determineEnemyScale(enemyType);
    const scaleMult = scale * scale; // HP scales with square of scale
    const scaledHp = hp * this.diffHpMult * champMult * scaleMult;

    const prefRange = enemyType === 'archer' ? 20 + Math.random() * 5
      : enemyType === 'brute' ? 3 + Math.random() * 2
      : 10 + Math.random() * 10;

    // Snap spawn position to terrain height
    const spawnPos = { ...pos, y: getTerrainHeight(pos.x, pos.z) };

    return {
      state: { id, pos: spawnPos, yaw: 0, hp: scaledHp, maxHp: scaledHp, aiState: EnemyAIState.Patrol, targetId: 0, scale },
      patrolOrigin: { ...spawnPos }, patrolAngle: Math.random() * Math.PI * 2,
      meleeCdEnd: 0, rangedCdEnd: 0, telegraphEnd: 0,
      behaviorTimer: 0,
      strafeDir: Math.random() > 0.5 ? 1 : -1,
      preferredRange: prefRange,
      enemyType,
      statusEffects: new Set(),
      statusExpiry: new Map(),
      isChampion,
      slowFactor: 1.0,
      slowEnd: 0,
      mayaCooldownEnd: 0,
      scale,
    };
  }

  private determineEnemyScale(enemyType: 'soldier' | 'archer' | 'brute'): number {
    const rand = Math.random() * 100;

    if (this.chapter <= 2) {
      // Ch0-2: mostly normal (80%) with some small (20%)
      return rand < 20 ? C.ENEMY_SCALE_SMALL : C.ENEMY_SCALE_NORMAL;
    } else if (this.chapter <= 4) {
      // Ch3-4: mix of normal (50%), large (30%), small (20%)
      if (rand < 20) return C.ENEMY_SCALE_SMALL;
      if (rand < 50) return C.ENEMY_SCALE_LARGE;
      return C.ENEMY_SCALE_NORMAL;
    } else {
      // Ch5-7: include giants (10%), large (30%), normal (40%), small (20%)
      if (rand < 20) return C.ENEMY_SCALE_SMALL;
      if (rand < 50) return C.ENEMY_SCALE_NORMAL;
      if (rand < 80) return C.ENEMY_SCALE_LARGE;
      return C.ENEMY_SCALE_GIANT;
    }
  }

  // ── T4-3: Sacred Pillar Puzzle System ────────────────────────────
  private setupPuzzlePillars(): void {
    const puzzleConfigs = [
      { ch: 0, positions: [
        { x: 5, z: 8 }, { x: -5, z: 8 }, { x: 0, z: 13 }
      ]},
      { ch: 1, positions: [
        { x: -25, z: -90 }, { x: -35, z: -90 }, { x: -30, z: -85 }
      ]},
      { ch: 3, positions: [
        { x: -145, z: -315 }, { x: -155, z: -315 }, { x: -150, z: -310 }
      ]},
      { ch: 4, positions: [
        { x: -45, z: -445 }, { x: -55, z: -445 }, { x: -50, z: -440 }
      ]},
    ];

    for (const config of puzzleConfigs) {
      // Shuffle the required order for each chapter's puzzle
      const order = [1, 2, 3];
      for (let i = 2; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }

      config.positions.forEach((pos, i) => {
        this.sacredPillars.push({
          id: `puzzle_ch${config.ch}_${i}`,
          pos: { x: pos.x, y: 0, z: pos.z },
          chapter: config.ch,
          order: i,
          activated: false,
          requiredOrder: order[i],
        });
      });
    }
  }

  // ── Divine Blessings (Phase 4) ────────────────────────────
  private applyBlessing(npcId: string): void {
    const blessingMap: Record<string, { key: string; name: string; desc: string; apply: () => void }> = {
      'sage': {
        key: 'sage_blessing',
        name: "Agastya's Protection",
        desc: '+15 Max HP',
        apply: () => {
          this.player.maxHp += 15;
          this.player.hp = Math.min(this.player.hp + 15, this.player.maxHp);
          this.torchUnlocked = true;
        }
      },
      'jatayu': {
        key: 'jatayu_blessing',
        name: "Jatayu's Resolve",
        desc: '+10% Arrow Damage',
        apply: () => {
          this.blessingDamageMultiplier += 0.10;
        }
      },
      'sugriv': {
        key: 'sugriv_blessing',
        name: 'Vanara Agility',
        desc: '+20% Sprint Speed',
        apply: () => {
          this.sprintBonusMultiplier += 0.20;
        }
      },
      'jambavan': {
        key: 'jambavan_blessing',
        name: "Bear King's Endurance",
        desc: '+25 Max Stamina',
        apply: () => {
          this.player.stamina = Math.min(this.player.stamina + 25, C.PLAYER_MAX_STAMINA + 25);
        }
      },
      'sampati': {
        key: 'sampati_blessing',
        name: "Eagle's Sight",
        desc: '+15% Arrow Speed',
        apply: () => {
          this.arrowSpeedMultiplier += 0.15;
        }
      },
      'angad': {
        key: 'angad_blessing',
        name: 'Immovable Stance',
        desc: '+0.15s Dodge Duration',
        apply: () => {
          this.dodgeDurationBonus += 0.15;
        }
      },
      'angad_npc': {
        key: 'angad_blessing',
        name: 'Immovable Stance',
        desc: '+0.15s Dodge Duration',
        apply: () => {
          this.dodgeDurationBonus += 0.15;
        }
      },
      'vibhishana': {
        key: 'vibhishana_blessing',
        name: "Ravana's Secret",
        desc: '+15% Boss Damage',
        apply: () => {
          this.bossDamageMultiplier += 0.15;
        }
      },
      'maricha': {
        key: 'maricha_blessing',
        name: "Demon's Truth",
        desc: '+3 Devotion Karma',
        apply: () => {
          this.karma.devotion += 3;
          this.onKarmaEvent('devotion', 3);
        }
      },
    };
    const b = blessingMap[npcId];
    if (b && !this.blessings.has(b.key)) {
      this.blessings.add(b.key);
      b.apply();
      this.onBlessingReceived(b.name, b.desc);
      // T4-5: Start side quest from this NPC
      this.startSideQuests(npcId);
    }
  }

  // T4-5: Initialize and trigger side quest from NPC blessing
  private startSideQuests(npcId: string): void {
    const quests: Record<string, SideQuest> = {
      'sage': {
        id: 'sq_agastya', name: 'Trial of the Bow',
        description: 'Defeat 3 enemies using charged shots',
        givenBy: 'sage', chapter: 0, type: 'kill', target: 3, progress: 0, completed: false,
        reward: { arrows: 10, karmaAxis: 'valor', karmaAmount: 10 },
      },
      'jatayu': {
        id: 'sq_jatayu', name: 'Wings of Memory',
        description: 'Find all 3 investigation points in Dandaka',
        givenBy: 'jatayu', chapter: 1, type: 'investigate', target: 3, progress: 0, completed: false,
        reward: { hp: 20, karmaAxis: 'mercy', karmaAmount: 8 },
      },
      'sugriv': {
        id: 'sq_sugriv', name: 'Prove Your Worth',
        description: 'Defeat 5 enemies in Kishkindha',
        givenBy: 'sugriv', chapter: 3, type: 'kill', target: 5, progress: 0, completed: false,
        reward: { arrows: 8, karmaAxis: 'valor', karmaAmount: 12 },
      },
      'jambavan': {
        id: 'sq_jambavan', name: 'Wisdom of the Ancients',
        description: 'Find all investigation points at the Southern Shore',
        givenBy: 'jambavan', chapter: 4, type: 'investigate', target: 3, progress: 0, completed: false,
        reward: { hp: 30, karmaAxis: 'devotion', karmaAmount: 10 },
      },
      'vibhishana': {
        id: 'sq_vibhishana', name: 'Path of Defiance',
        description: 'Defeat 8 Lanka demons',
        givenBy: 'vibhishana', chapter: 6, type: 'kill', target: 8, progress: 0, completed: false,
        reward: { arrows: 15, karmaAxis: 'mercy', karmaAmount: 15 },
      },
    };

    const quest = quests[npcId];
    if (quest && !this.sideQuests.find(q => q.id === quest.id)) {
      this.sideQuests.push(quest);
      this.onQuestStarted(quest);
    }
  }

  // T4-4: Apply ashram passive skill bonuses
  private applyAshramSkill(effect: string): void {
    switch (effect) {
      case 'arrowSpeed':
        this.arrowSpeedMultiplier *= 1.15;
        break;
      case 'staminaRegen':
        this.staminaRegenMult *= 1.2;
        break;
      case 'moveSpeed':
        this.sprintBonusMultiplier *= 1.1;
        break;
      case 'maxHp':
        this.player.maxHp = Math.floor(this.player.maxHp * 1.15);
        this.player.hp = Math.min(this.player.hp + 15, this.player.maxHp);
        break;
    }
  }

  toggleTorch(): void {
    if (!this.torchUnlocked) return;
    this.torchLit = !this.torchLit;
    this.onTorchToggle(this.torchLit);
  }

  placeCampfire(): void {
    if (!this.torchLit) return;
    // Pick up existing campfire if close enough
    if (this.campfirePos) {
      const dx = this.player.pos.x - this.campfirePos.x;
      const dz = this.player.pos.z - this.campfirePos.z;
      if (Math.sqrt(dx * dx + dz * dz) < 3) {
        this.campfirePos = null;
        this.onCampfirePickedUp();
        return;
      }
    }
    // Drop campfire at player position
    this.campfirePos = { x: this.player.pos.x, y: 0, z: this.player.pos.z };
    this.torchLit = false;
    this.onTorchToggle(false);
    this.onCampfirePlaced(this.campfirePos);
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
      personality: 'loyal', preferredDist: 4, flanking: false,
      flankTarget: { x: 0, y: 0, z: 0 }, combatCooldown: 0,
    });
    this.player.maxHp += 20;
    this.player.hp = Math.min(this.player.hp + 20, this.player.maxHp);
    this.onCompanionJoined('lakshman', 'Lakshman', pos);

    // Lakshman's Dharma dialogue on joining
    setTimeout(() => {
      this.onDialogueSequence([
        { name: 'Lakshman', message: "Brother, where you walk, I walk. When you left Ayodhya for the forest, I chose exile by your side — for what is Dharma if not standing with the righteous?" },
        { name: 'Lakshman', message: "Sita Mata awaits deliverance. Together we shall end this Adharma — as we have faced every trial, side by side." },
      ]);
    }, 1500);

    // Enable meditation before final chapter
    this.canMeditate = true;
  }

  declineLakshman(): void {
    if (this.lakshmanChoice !== 'pending') return;
    this.lakshmanChoice = 'declined';
    this.loneWarriorBuff = true;

    // Dharma dialogue for choosing the lone path
    setTimeout(() => {
      this.onDialogueSequence([
        { name: 'Rama', message: "Lakshman, your devotion honors me beyond words. But I must face Ravana bearing the full weight of my own Dharma. This burden is mine alone." },
        { name: 'Lakshman', message: "Then I shall guard the army and pray for your victory. Know this, brother — your solitary courage itself is Dharma. The world will speak of this." },
      ]);
    }, 1500);

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

    // During backstory, block all movement/combat input
    if (this.backstoryInProgress) {
      this.player.vel = { x: 0, y: 0, z: 0 };
      this.player.lastProcessedSeq = input.seq;
      return;
    }

    // During dialogue, block all movement/combat input
    if (this.dialogueInProgress) {
      this.player.vel = { x: 0, y: 0, z: 0 };
      this.player.lastProcessedSeq = input.seq;
      return;
    }

    const now = performance.now();
    this.player.yaw = input.yaw;
    const flags = input.flags;
    const sinY = Math.sin(input.yaw);
    const cosY = Math.cos(input.yaw);

    // T3-4: Stealth Archery — Crouch flag detection
    this.isCrouching = !!(flags & InputFlag.Crouch);

    // ── Tutorial tracking (Chapter 0) ──────────────────────────────
    if (this.chapter === 0 && !this.tutorialComplete) {
      // Check movement
      if (!this.tutorialSteps.move && (flags & (InputFlag.Forward | InputFlag.Backward | InputFlag.Left | InputFlag.Right))) {
        this.tutorialSteps.move = true;
        this.onTutorialStep('move', this.checkTutorialComplete());
      }
      // Check look (yaw change from initial)
      if (!this.tutorialSteps.look && Math.abs(input.yaw - this.previousYaw) > 0.05) {
        this.tutorialSteps.look = true;
        this.onTutorialStep('look', this.checkTutorialComplete());
      }
      // Check shoot
      if (!this.tutorialSteps.shoot && (flags & InputFlag.Shoot)) {
        this.tutorialSteps.shoot = true;
        this.onTutorialStep('shoot', this.checkTutorialComplete());
      }
      // Check dodge
      if (!this.tutorialSteps.dodge && (flags & InputFlag.Dodge)) {
        this.tutorialSteps.dodge = true;
        this.onTutorialStep('dodge', this.checkTutorialComplete());
      }
      // Check sprint
      if (!this.tutorialSteps.sprint && (flags & InputFlag.Sprint)) {
        this.tutorialSteps.sprint = true;
        this.onTutorialStep('sprint', this.checkTutorialComplete());
      }
      // Check jump
      if (!this.tutorialSteps.jump && (flags & InputFlag.Jump)) {
        this.tutorialSteps.jump = true;
        this.onTutorialStep('jump', this.checkTutorialComplete());
      }
      // Check meditate
      if (!this.tutorialSteps.meditate && (flags & InputFlag.Meditate)) {
        this.tutorialSteps.meditate = true;
        this.onTutorialStep('meditate', this.checkTutorialComplete());
      }
    }
    this.previousYaw = input.yaw;

    let moveX = 0, moveZ = 0;
    if (flags & InputFlag.Forward) { moveX -= sinY; moveZ -= cosY; }
    if (flags & InputFlag.Backward) { moveX += sinY; moveZ += cosY; }
    if (flags & InputFlag.Left) { moveX += cosY; moveZ -= sinY; }
    if (flags & InputFlag.Right) { moveX -= cosY; moveZ += sinY; }

    const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
    if (len > 0) { moveX /= len; moveZ /= len; }

    let speed = C.PLAYER_SPEED;
    if ((flags & InputFlag.Sprint) && this.player.stamina > 0) {
      speed *= C.SPRINT_MULTIPLIER;
      this.player.stamina -= C.SPRINT_STAMINA_COST * input.dt;
      if (this.player.stamina < 0) this.player.stamina = 0;
    }
    // T3-4: Apply crouch speed reduction
    if (this.isCrouching) {
      speed *= C.CROUCH_SPEED_MULTIPLIER;
    }

    // Dodge
    this.dodgeJustTriggered = false;
    if ((flags & InputFlag.Dodge) && now >= this.dodgeCdEnd && this.player.stamina >= C.DODGE_STAMINA_COST) {
      this.dodgeCdEnd = now + C.DODGE_COOLDOWN_MS;
      this.dodgeEnd = now + C.DODGE_DURATION_MS;
      this.player.isDodging = true;
      this.player.stamina -= C.DODGE_STAMINA_COST;
      this.dodgeJustTriggered = true; // Track dodge trigger this frame
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

    // Push player out of obstacles
    this.pushOutOfObstacles(this.player.pos);

    // Simple gravity with terrain height
    this.playerVelY += C.GRAVITY * input.dt;
    this.player.pos.y += this.playerVelY * input.dt;
    const groundY = getTerrainHeight(this.player.pos.x, this.player.pos.z);
    if (this.player.pos.y <= groundY) {
      this.player.pos.y = groundY;
      this.playerVelY = 0;
      this.grounded = true;
    }

    // Jump
    if ((flags & InputFlag.Jump) && this.grounded) {
      this.playerVelY = C.JUMP_FORCE;
      this.grounded = false;
    }

    // Shoot — Snap Shot vs Charged Shot
    // G-07: If dodge was triggered this frame, cancel any queued shot (dodge takes priority)
    if ((flags & InputFlag.Shoot && this.arrowAmmo > 0) && !this.dodgeJustTriggered) {
      const dir: Vec3 = input.aimDir ?? {
        x: -Math.sin(input.yaw) * Math.cos(input.pitch),
        y: Math.sin(input.pitch),
        z: -Math.cos(input.yaw) * Math.cos(input.pitch),
      };
      let damage: number;
      if (input.chargeMs < C.CHARGED_SHOT_MIN_MS) {
        // Snap Shot: quick tap, low damage, full movement
        damage = C.SNAP_SHOT_DAMAGE * this.damageMultiplier;
      } else {
        // Charged Shot: 800ms+ hold, scales from base to max
        const chargeT = Math.min(1, (input.chargeMs - C.CHARGED_SHOT_MIN_MS) / (C.BOW_MAX_CHARGE_MS - C.CHARGED_SHOT_MIN_MS));
        damage = (C.ARROW_BASE_DAMAGE + (C.ARROW_MAX_DAMAGE - C.ARROW_BASE_DAMAGE) * chargeT) * this.damageMultiplier;
      }
      this.arrowAmmo--;
      this.spawnProjectile(1, ProjectileType.Arrow, this.player.pos, dir, damage);
      // Karma: valor for shooting
      // (headshots tracked at hit time, not here)
    }

    // Stamina regen (P3-1: scaled by difficulty)
    this.player.stamina = Math.min(C.PLAYER_MAX_STAMINA, this.player.stamina + C.STAMINA_REGEN_RATE * this.staminaRegenMult * input.dt);
    this.player.vel = { x: moveX * speed, y: this.playerVelY, z: moveZ * speed };
    this.player.lastProcessedSeq = input.seq;
  }

  handleAbility(ability: AbilityType, dir: Vec3): void {
    const now = performance.now();
    if (this.player.status !== PlayerStatus.Alive) return;
    if (this.isMeditating) return;

    const mult = this.damageMultiplier;

    // ── Tutorial tracking (Chapter 0) ──────────────────────────────
    if (this.chapter === 0 && !this.tutorialComplete) {
      if ((ability === AbilityType.FireArrow || ability === AbilityType.VayuAstra || ability === AbilityType.VarunaAstra || ability === AbilityType.NagaAstra || ability === AbilityType.BrahmaAstra) && !this.tutorialSteps.specialArrow) {
        this.tutorialSteps.specialArrow = true;
        this.onTutorialStep('specialArrow', this.checkTutorialComplete());
      }
      if (ability === AbilityType.Shockwave && !this.tutorialSteps.shockwave) {
        this.tutorialSteps.shockwave = true;
        this.onTutorialStep('shockwave', this.checkTutorialComplete());
      }
    }

    if (ability === AbilityType.FireArrow && now >= this.fireArrowCd) {
      if (this.arrowAmmo < 1) return; // T1-2: Ammo check
      this.arrowAmmo--;
      this.fireArrowCd = now + C.FIRE_ARROW_COOLDOWN_MS;
      this.spawnProjectile(1, ProjectileType.FireArrow, this.player.pos, dir, C.FIRE_ARROW_DAMAGE * mult);
    } else if (ability === AbilityType.Shockwave && now >= this.shockwaveCd) {
      this.shockwaveCd = now + C.SHOCKWAVE_COOLDOWN_MS;
      this.applyShockwave();
    } else if (ability === AbilityType.VayuAstra && now >= this.vayuAstraCd) {
      if (this.arrowAmmo < 1) return; // T1-2: Ammo check
      this.arrowAmmo--;
      this.vayuAstraCd = now + VAYU_ASTRA_COOLDOWN_MS;
      this.spawnProjectile(1, ProjectileType.VayuAstra, this.player.pos, dir, VAYU_ASTRA_DAMAGE * mult, VAYU_ASTRA_SPEED);
    } else if (ability === AbilityType.VarunaAstra && now >= this.varunaAstraCd) {
      if (this.arrowAmmo < 1) return; // T1-2: Ammo check
      this.arrowAmmo--;
      this.varunaAstraCd = now + VARUNA_ASTRA_COOLDOWN_MS;
      this.spawnProjectile(1, ProjectileType.VarunaAstra, this.player.pos, dir, VARUNA_ASTRA_DAMAGE * mult);
    } else if (ability === AbilityType.NagaAstra && now >= this.nagaAstraCd) {
      if (this.arrowAmmo < 1) return; // T1-2: Ammo check
      this.arrowAmmo--;
      this.nagaAstraCd = now + NAGA_ASTRA_COOLDOWN_MS;
      this.spawnProjectile(1, ProjectileType.NagaAstra, this.player.pos, dir, NAGA_ASTRA_DAMAGE * mult);
    } else if (ability === AbilityType.BrahmaAstra) {
      // P2-2: Brahmastra requires full charge (100) + arrow cost, no longer gated by cooldown alone
      if (this.brahmaCharge >= C.BRAHMA_MAX_CHARGE && this.arrowAmmo >= C.BRAHMA_ARROW_COST
          && now - this.lastBrahmaFireTime >= 3000) { // 3s minimum between fires
        this.brahmaCharge = 0; // Reset charge on fire
        this.lastBrahmaFireTime = now;
        this.arrowAmmo -= C.BRAHMA_ARROW_COST;
        this.spawnProjectile(1, ProjectileType.BrahmaAstra, this.player.pos, dir, BRAHMA_ASTRA_DAMAGE * mult);
        this.karma.devotion += C.KARMA_DEVOTION_BRAHMASTRA; // Divine weapon = devotion
        this.onKarmaEvent('devotion', C.KARMA_DEVOTION_BRAHMASTRA);
      }
    }
    // ── Pashupatastra (Lone Warrior exclusive) ──
    else if (ability === AbilityType.Pashupatastra && this.loneWarriorBuff && now >= this.pashupataCd) {
      this.pashupataCd = now + C.PASHUPATASTRA_COOLDOWN_MS;
      this.spawnProjectile(1, ProjectileType.Pashupatastra, this.player.pos, dir, C.PASHUPATASTRA_DAMAGE * mult, C.PASHUPATASTRA_SPEED);
      this.karma.valor += 3;
      this.onKarmaEvent('valor', 3);
    }
    // ── Companion Active Abilities ──
    else if (ability === AbilityType.HanumanLeap && now >= this.hanumanLeapCd) {
      const hanuman = this.companions.find(c => c.id === 'hanuman');
      if (hanuman) {
        this.hanumanLeapCd = now + C.HANUMAN_LEAP_COOLDOWN_MS;
        // Damage + stun enemies near target area (player's aim direction, 8 units forward)
        const targetPos: Vec3 = {
          x: this.player.pos.x + dir.x * 8,
          y: 0,
          z: this.player.pos.z + dir.z * 8,
        };
        for (const enemy of this.enemies) {
          if (enemy.state.aiState === EnemyAIState.Dead) continue;
          if (dist3(targetPos, enemy.state.pos) <= 5) {
            const dmg = C.HANUMAN_LEAP_DAMAGE * mult;
            enemy.state.hp -= dmg;
            this.onDamage(DamageTargetType.Enemy, enemy.state.id, dmg, 100);
            // Stun: set telegraph end in the past to force a pause
            enemy.behaviorTimer = C.HANUMAN_LEAP_STUN_MS / 1000;
            enemy.state.aiState = EnemyAIState.Patrol; // reset to idle briefly
            if (enemy.state.hp <= 0) this.killEnemy(enemy);
          }
        }
        this.onCompanionAbility('hanuman', 'Leap Strike');
      }
    }
    else if (ability === AbilityType.AngadShield && now >= this.angadShieldCd) {
      const angad = this.companions.find(c => c.id === 'angad');
      if (angad) {
        this.angadShieldCd = now + C.ANGAD_SHIELD_COOLDOWN_MS;
        this.angadShieldActive = true;
        this.angadShieldAbsorb = C.ANGAD_SHIELD_ABSORB;
        this.onCompanionAbility('angad', 'Immovable Shield');
      }
    }
    else if (ability === AbilityType.LakshmanCover && now >= this.lakshmanCoverCd) {
      const lakshman = this.companions.find(c => c.id === 'lakshman');
      if (lakshman) {
        this.lakshmanCoverCd = now + C.LAKSHMAN_COVER_COOLDOWN_MS;
        // Fire a volley of arrows at nearest enemies
        let targets: LocalEnemy[] = [];
        for (const enemy of this.enemies) {
          if (enemy.state.aiState !== EnemyAIState.Dead && dist3(lakshman.pos, enemy.state.pos) < lakshman.range) {
            targets.push(enemy);
          }
        }
        targets = targets.slice(0, C.LAKSHMAN_COVER_ARROWS);
        for (const target of targets) {
          const d = sub3(target.state.pos, lakshman.pos);
          const dirN = normalize3(d);
          this.spawnProjectile(100, ProjectileType.Arrow, lakshman.pos, dirN, C.LAKSHMAN_COVER_DAMAGE * mult);
        }
        this.onCompanionAbility('lakshman', 'Cover Fire');
      }
    }
  }

  // ── Astra Synergy System ─────────────────────────────────
  private applyAstraElement(enemy: LocalEnemy, element: AstraElement, now: number): void {
    enemy.statusEffects.add(element);
    enemy.statusExpiry.set(element, now + 5000);
    this.checkAstraCombos(enemy, element, now);
  }

  private checkAstraCombos(enemy: LocalEnemy, _newElement: AstraElement, now: number): void {
    const effects = enemy.statusEffects;
    const pos = { ...enemy.state.pos };
    const mult = this.damageMultiplier;

    // P2-2: Brahmastra charge on combo
    this.brahmaCharge = Math.min(C.BRAHMA_MAX_CHARGE, this.brahmaCharge + C.BRAHMA_CHARGE_PER_COMBO);

    // Water + Fire → Steam Burst
    if (effects.has(AstraElement.Water) && effects.has(AstraElement.Fire)) {
      effects.delete(AstraElement.Water); effects.delete(AstraElement.Fire);
      const dmg = C.COMBO_STEAM_BURST_DAMAGE * mult;
      for (const e of this.enemies) {
        if (e.state.aiState === EnemyAIState.Dead) continue;
        if (dist3(pos, e.state.pos) <= C.COMBO_STEAM_BURST_RADIUS) {
          e.state.hp -= dmg;
          this.onDamage(DamageTargetType.Enemy, e.state.id, dmg, 1);
          if (e.state.hp <= 0) this.killEnemy(e);
        }
      }
      this.onAstraCombo(AstraCombo.SteamBurst, pos, dmg);
      this.karma.valor += 2;
      this.onKarmaEvent('valor', 2);
      return;
    }
    // Poison + Wind → Toxic Cloud
    if (effects.has(AstraElement.Poison) && effects.has(AstraElement.Wind)) {
      effects.delete(AstraElement.Poison); effects.delete(AstraElement.Wind);
      const dmg = C.COMBO_TOXIC_CLOUD_DAMAGE * mult * C.COMBO_TOXIC_CLOUD_TICKS;
      for (const e of this.enemies) {
        if (e.state.aiState === EnemyAIState.Dead) continue;
        if (dist3(pos, e.state.pos) <= C.COMBO_TOXIC_CLOUD_RADIUS) {
          e.state.hp -= dmg;
          this.onDamage(DamageTargetType.Enemy, e.state.id, dmg, 1);
          if (e.state.hp <= 0) this.killEnemy(e);
        }
      }
      this.onAstraCombo(AstraCombo.ToxicCloud, pos, dmg);
      return;
    }
    // Wind + Divine → Skyfall
    if (effects.has(AstraElement.Wind) && effects.has(AstraElement.Divine)) {
      effects.delete(AstraElement.Wind); effects.delete(AstraElement.Divine);
      const dmg = C.BRAHMA_ASTRA_DAMAGE * C.COMBO_SKYFALL_MULTIPLIER * mult;
      enemy.state.hp -= dmg;
      this.onDamage(DamageTargetType.Enemy, enemy.state.id, dmg, 1);
      if (enemy.state.hp <= 0) this.killEnemy(enemy);
      this.onAstraCombo(AstraCombo.Skyfall, pos, dmg);
      return;
    }
    // Poison + Fire → Venomfire
    if (effects.has(AstraElement.Poison) && effects.has(AstraElement.Fire)) {
      effects.delete(AstraElement.Poison); effects.delete(AstraElement.Fire);
      const dmg = C.COMBO_VENOMFIRE_DAMAGE * mult;
      enemy.state.hp -= dmg;
      this.onDamage(DamageTargetType.Enemy, enemy.state.id, dmg, 1);
      if (enemy.state.hp <= 0) this.killEnemy(enemy);
      this.onAstraCombo(AstraCombo.Venomfire, pos, dmg);
      return;
    }
    // Water + Wind → Monsoon
    if (effects.has(AstraElement.Water) && effects.has(AstraElement.Wind)) {
      effects.delete(AstraElement.Water); effects.delete(AstraElement.Wind);
      for (const e of this.enemies) {
        if (e.state.aiState === EnemyAIState.Dead) continue;
        if (dist3(pos, e.state.pos) <= C.COMBO_MONSOON_RADIUS) {
          e.slowFactor = C.VARUNA_ASTRA_SLOW_FACTOR;
          e.slowEnd = now + C.COMBO_MONSOON_SLOW_DURATION_MS;
        }
      }
      this.onAstraCombo(AstraCombo.Monsoon, pos, 0);
      return;
    }
    // Water + Divine → Purify
    if (effects.has(AstraElement.Water) && effects.has(AstraElement.Divine)) {
      effects.delete(AstraElement.Water); effects.delete(AstraElement.Divine);
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + C.COMBO_PURIFY_HEAL);
      this.onAstraCombo(AstraCombo.Purify, pos, C.COMBO_PURIFY_HEAL);
      this.karma.devotion += 2;
      this.onKarmaEvent('devotion', 2);
      return;
    }
  }

  /** Update encounter state machine for all active encounters */
  private updateEncounters(dt: number, now: number): void {
    // Iterate through all encounters
    for (const encounter of this.encounters) {
      if (encounter.phase === EncounterPhase.Dormant) {
        // Check if player is within 25 units of the champion
        const champion = this.enemies.find(e => e.state.id === encounter.championId);
        if (!champion || champion.state.aiState === EnemyAIState.Dead) {
          // Champion dead before encounter started — mark defeated
          encounter.phase = EncounterPhase.Defeated;
          this.activeEncounter = null;
          continue;
        }

        if (dist3(this.player.pos, champion.state.pos) < 25) {
          // Trigger detection phase
          encounter.phase = EncounterPhase.Detection;
          this.activeEncounter = encounter;
          encounter.phaseTimer = 1.5; // 1.5 second pause
          this.encounterSlowFactor = 0.3; // G-09: Slow-time during Detection
          // Pause all enemies briefly
          for (const enemy of this.enemies) {
            if (enemy.state.aiState !== EnemyAIState.Dead && enemy.state.aiState !== EnemyAIState.Flying) {
              // Save current state and pause
              if (!enemy.statusExpiry) enemy.statusExpiry = new Map();
            }
          }
          this.onEncounterPhaseChange(EncounterPhase.Detection);
        }
      } else if (encounter.phase === EncounterPhase.Detection) {
        encounter.phaseTimer -= dt;
        if (encounter.phaseTimer <= 0) {
          // Transition to Challenge phase
          encounter.phase = EncounterPhase.Challenge;
          encounter.phaseTimer = 3.0; // 3 second dialogue
          this.encounterSlowFactor = 0.3; // G-09: Keep slow-time during Challenge
          const dialogueText = this.getEncounterDialogue(encounter.chapter, 'challenge');
          encounter.dialogueShown = true;
          this.onEncounterPhaseChange(EncounterPhase.Challenge, dialogueText);
        }
      } else if (encounter.phase === EncounterPhase.Challenge) {
        encounter.phaseTimer -= dt;
        if (encounter.phaseTimer <= 0) {
          // Transition to Phase 1 — actual combat
          encounter.phase = EncounterPhase.Phase1;
          this.encounterSlowFactor = 1.0; // G-09: Resume normal speed in Phase1
          this.onEncounterPhaseChange(EncounterPhase.Phase1);
        }
      } else if (encounter.phase === EncounterPhase.Phase1) {
        const champion = this.enemies.find(e => e.state.id === encounter.championId);
        if (!champion || champion.state.aiState === EnemyAIState.Dead) {
          // Champion defeated
          encounter.phase = EncounterPhase.Defeated;
          encounter.phaseTimer = 1.0;
          encounter.defeatDialogueShown = true;
          const defeatText = this.getEncounterDialogue(encounter.chapter, 'defeat');
          this.onEncounterPhaseChange(EncounterPhase.Defeated, defeatText);
          this.activeEncounter = null;
        } else if (champion.state.hp <= champion.state.maxHp * 0.5 && !encounter.midDialogueShown) {
          // Champion at 50% HP — trigger mid-fight dialogue
          encounter.phase = EncounterPhase.MidFightDialog;
          encounter.phaseTimer = 2.0; // 2 second freeze
          encounter.midDialogueShown = true;
          const midText = this.getEncounterDialogue(encounter.chapter, 'midFight');
          this.onEncounterPhaseChange(EncounterPhase.MidFightDialog, midText);
        }
      } else if (encounter.phase === EncounterPhase.MidFightDialog) {
        encounter.phaseTimer -= dt;
        if (encounter.phaseTimer <= 0) {
          // Transition to Phase 2 — hard mode
          encounter.phase = EncounterPhase.Phase2;
          const champion = this.enemies.find(e => e.state.id === encounter.championId);
          if (champion) {
            // Apply Phase 2 buffs
            champion.state.scale = (champion.state.scale || 1) * 1.2;
            // Enrage: increase damage output
            champion.preferredRange = Math.max(8, champion.preferredRange - 2);
            // Enable Maya illusions if available
            if (champion.mayaCooldownEnd === undefined) {
              champion.mayaCooldownEnd = 0;
            }
          }
          this.onEncounterPhaseChange(EncounterPhase.Phase2);
        }
      } else if (encounter.phase === EncounterPhase.Defeated) {
        encounter.phaseTimer -= dt;
        if (encounter.phaseTimer <= 0) {
          // Encounter fully resolved
          this.encounters = this.encounters.filter(e => e.id !== encounter.id);
        }
      }
    }
  }

  /** Get encounter dialogue for a specific chapter and dialogue type */
  private getEncounterDialogue(chapter: number, dialogueType: 'challenge' | 'midFight' | 'defeat'): string {
    const dialogues: Record<number, Record<string, string>> = {
      1: {
        challenge: "You dare enter the Dandaka? Khara's demons will feast on your bones!",
        midFight: "Impossible! How can a mortal wield the Astras of the gods?!",
        defeat: "The Dandaka is yours... for now.",
      },
      2: {
        challenge: "The vulture Jatayu fell here. You will join him!",
        midFight: "The Demon Guard... falls? Ravana will hear of this!",
        defeat: "Jatayu's honor is avenged.",
      },
      4: {
        challenge: "Fools! Ravana's scouts see all! You shall never cross the sea!",
        midFight: "You think this is over? MAYA! ILLUSIONS! COME FORTH!",
        defeat: "The sea path is open.",
      },
      5: {
        challenge: "Even Hanuman's fire could not cleanse Lanka's might!",
        midFight: "I call upon the dark Astras of Lanka! Face the storm!",
        defeat: "Lanka's elite have fallen.",
      },
    };

    const chapterDialogue = dialogues[chapter];
    if (chapterDialogue && chapterDialogue[dialogueType]) {
      return chapterDialogue[dialogueType];
    }
    return '';
  }

  /** Expire old status effects on an enemy */
  private tickStatusEffects(enemy: LocalEnemy, now: number): void {
    for (const [element, expiry] of enemy.statusExpiry) {
      if (now >= expiry) {
        enemy.statusEffects.delete(element);
        enemy.statusExpiry.delete(element);
      }
    }
    if (now >= enemy.slowEnd) enemy.slowFactor = 1.0;
  }

  /** Centralized enemy kill logic */
  private killEnemy(enemy: LocalEnemy): void {
    enemy.state.hp = 0;
    enemy.state.aiState = EnemyAIState.Dead;
    enemy.deathTime = performance.now();  // T3-5: Track death time for pruning
    // Don't count illusion kills for chapter progress
    if (!enemy.isIllusion) this.chapterEnemiesKilled++;
    if (enemy.isChampion) {
      this.karma.valor += C.KARMA_VALOR_CHAMPION_KILL;
      this.onKarmaEvent('valor', C.KARMA_VALOR_CHAMPION_KILL);
    }
    // P2-2: Brahmastra charge on kill
    if (!enemy.isIllusion) {
      this.brahmaCharge = Math.min(C.BRAHMA_MAX_CHARGE, this.brahmaCharge + C.BRAHMA_CHARGE_PER_KILL);
    }
    if (this.chapter === 0 && enemy.originalMaxHp === 30) {
      enemy.respawnTime = performance.now() + 3000;
      this.spawnPickup(enemy.state.pos);
    } else {
      this.spawnPickup(enemy.state.pos);
      if (Math.random() < 0.3 * this.diffDropMult) this.spawnHealthPickup(enemy.state.pos);
    }
    // T4-5: Update kill quests
    for (const quest of this.sideQuests) {
      if (!quest.completed && quest.type === 'kill' && quest.chapter === this.chapter) {
        quest.progress++;
        this.onQuestProgress(quest.id, quest.progress, quest.target);
        if (quest.progress >= quest.target) {
          quest.completed = true;
          if (quest.reward.hp) this.player.hp = Math.min(this.player.maxHp, this.player.hp + quest.reward.hp);
          if (quest.reward.arrows) this.arrowAmmo = Math.min(this.maxArrowAmmo, this.arrowAmmo + quest.reward.arrows);
          if (quest.reward.karmaAxis && quest.reward.karmaAmount) {
            this.karma[quest.reward.karmaAxis] += quest.reward.karmaAmount;
            this.onKarmaEvent(quest.reward.karmaAxis, quest.reward.karmaAmount);
          }
          this.onQuestCompleted(quest);
        }
      }
    }
    this.checkChapterProgress();
  }

  // ── Stamina-Tiered Shockwave ────────────────────────────
  private applyShockwave(): void {
    const origin = this.player.pos;
    const mult = this.damageMultiplier;
    const now = performance.now();
    const stamina = this.player.stamina;

    // 3 tiers based on current stamina
    let radius: number, dmg: number;
    if (stamina >= 80) {
      radius = C.SHOCKWAVE_STRONG_RADIUS;
      dmg = C.SHOCKWAVE_STRONG_DAMAGE * mult;
    } else if (stamina >= 40) {
      radius = C.SHOCKWAVE_RADIUS;
      dmg = C.SHOCKWAVE_DAMAGE * mult;
    } else {
      radius = C.SHOCKWAVE_WEAK_RADIUS;
      dmg = C.SHOCKWAVE_WEAK_DAMAGE * mult;
    }
    // Drain stamina
    this.player.stamina = Math.max(0, this.player.stamina - C.SHOCKWAVE_STAMINA_COST);

    if (now < this.dharmaGraceEnd) dmg *= 1.5;
    for (const enemy of this.enemies) {
      if (enemy.state.aiState === EnemyAIState.Dead) continue;
      if (dist3(origin, enemy.state.pos) <= radius) {
        enemy.state.hp -= dmg;
        this.onDamage(DamageTargetType.Enemy, enemy.state.id, dmg, 1);
        if (enemy.state.hp <= 0) this.killEnemy(enemy);
      }
    }
    if (this.boss.state.phase !== BossPhase.Dead && this.boss.state.phase !== BossPhase.Idle) {
      if (dist3(origin, this.boss.state.pos) <= radius) {
        const bossDmg = dmg * this.bossDamageMultiplier;
        this.boss.state.hp -= bossDmg;
        this.onDamage(DamageTargetType.Boss, 0, bossDmg, 1);
        this.checkBossPhase();
      }
    }
  }

  private spawnProjectile(ownerId: number, type: ProjectileType, origin: Vec3, dir: Vec3, damage: number, speed?: number): void {
    const id = this.nextProjId++;
    let projSpeed = speed ?? C.ARROW_SPEED;
    // Apply arrow speed multiplier from blessings for basic arrows
    if ((type === ProjectileType.Arrow || type === ProjectileType.FireArrow) && !speed) {
      projSpeed *= this.arrowSpeedMultiplier;
    }
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

    // Clamp position — tutorial boundary in Ch0, full world otherwise
    const hs = this.chapter === 0 ? C.TUTORIAL_BOUNDARY : C.WORLD_SIZE - 1;
    this.player.pos.x = Math.max(-hs, Math.min(hs, this.player.pos.x));
    this.player.pos.z = Math.max(-hs, Math.min(hs, this.player.pos.z));

    // ── Meditation healing ──────────────────────────────────────
    if (this.isMeditating) {
      this.meditationTimer += dt;
      // Heal HP, stamina, arrows
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 10 * dt);
      this.player.stamina = Math.min(C.PLAYER_MAX_STAMINA, this.player.stamina + 20 * dt);
      // Arrow restore capped at MEDITATION_ARROW_RESTORE per session
      const arrowCap = Math.min(this.maxArrowAmmo, this.arrowAmmo + C.MEDITATION_ARROW_RESTORE);
      this.arrowAmmo = Math.min(arrowCap, this.arrowAmmo + Math.floor(2 * dt));
      const karmaGain = C.KARMA_DEVOTION_MEDITATE * dt * 0.1;
      this.karma.devotion += karmaGain;
      // Trigger karma event every 0.5 seconds of meditation
      const now = performance.now();
      if (now - this.lastMeditationKarmaNotificationTime >= 500) {
        this.onKarmaEvent('devotion', Math.round(karmaGain * 5)); // Batch the notifications
        this.lastMeditationKarmaNotificationTime = now;
      }
      if (this.meditationTimer >= this.maxMeditationTime) {
        this.stopMeditation();
      }
    }

    // P2-2: Brahmastra charge decay when not attacking (encourages aggressive play)
    if (this.brahmaCharge > 0 && this.brahmaCharge < C.BRAHMA_MAX_CHARGE) {
      this.brahmaCharge = Math.max(0, this.brahmaCharge - C.BRAHMA_CHARGE_DECAY_RATE * dt);
    }

    // ── Companion HP regen buff + Dharma Bond ──────────────────
    for (const comp of this.companions) {
      if (comp.hpRegenBuff > 0) {
        const prevHp = this.player.hp;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + comp.hpRegenBuff * dt);
        // P3-2: Mercy karma from companion healing (every 10 HP healed = 1 mercy tick)
        if (Math.floor(this.player.hp / 10) > Math.floor(prevHp / 10)) {
          this.karma.mercy += C.KARMA_MERCY_COMPANION_HEAL;
          this.onKarmaEvent('mercy', C.KARMA_MERCY_COMPANION_HEAL);
        }
      }
    }
    // Dharma Bond: Brotherhood path extra heal when companions nearby
    if (this.lakshmanChoice === 'accepted' && this.companions.length > 0) {
      let nearbyCount = 0;
      for (const comp of this.companions) {
        if (dist3(this.player.pos, comp.pos) < C.DHARMA_BOND_RANGE) nearbyCount++;
      }
      if (nearbyCount > 0) {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + C.DHARMA_BOND_HEAL_RATE * nearbyCount * dt);
      }
    }

    // ── Ashram rest stop healing ─────────────────────────────────
    this.ashramNearby = false;
    for (const ashramPos of C.ASHRAM_POSITIONS) {
      const adx = this.player.pos.x - ashramPos.x;
      const adz = this.player.pos.z - ashramPos.z;
      const ashramDist = Math.sqrt(adx * adx + adz * adz);
      if (ashramDist < C.ASHRAM_HEAL_RADIUS) {
        this.ashramNearby = true;
        // T1-5: Don't stack with meditation healing
        if (!this.isMeditating) {
          this.player.hp = Math.min(this.player.maxHp, this.player.hp + C.ASHRAM_HEAL_RATE * dt);
          this.player.stamina = Math.min(C.PLAYER_MAX_STAMINA, this.player.stamina + C.ASHRAM_STAMINA_RATE * dt);
        }
        // Restore arrows periodically
        this.ashramArrowTimer += dt;
        if (this.ashramArrowTimer >= C.ASHRAM_ARROW_INTERVAL) {
          this.ashramArrowTimer = 0;
          this.arrowAmmo = Math.min(this.maxArrowAmmo, this.arrowAmmo + C.ASHRAM_ARROW_AMOUNT);
        }
        // T4-4: Ashram skill unlock after resting
        this.ashramRestTimer += dt;
        if (this.ashramRestTimer >= C.ASHRAM_REST_UNLOCK_TIME) {
          // Find which ashram we're at and unlock its skill
          for (let i = 0; i < C.ASHRAM_POSITIONS.length; i++) {
            const ap = C.ASHRAM_POSITIONS[i];
            const skill = C.ASHRAM_SKILLS[i];
            if (!skill) continue;
            const adx2 = this.player.pos.x - ap.x;
            const adz2 = this.player.pos.z - ap.z;
            if (Math.sqrt(adx2 * adx2 + adz2 * adz2) < C.ASHRAM_HEAL_RADIUS) {
              if (!this.unlockedAshramSkills.has(skill.effect)) {
                this.unlockedAshramSkills.add(skill.effect);
                this.applyAshramSkill(skill.effect);
                this.onSkillUnlocked(skill.name, skill.desc);
                this.karma.devotion += 5;
                this.onKarmaEvent('devotion', 5);
              }
              break;
            }
          }
        }
        break; // Only one ashram at a time
      }
    }
    if (!this.ashramNearby) {
      this.ashramArrowTimer = 0;
      this.ashramRestTimer = 0;
    }

    // ── Check story NPC proximity (allow re-talking to spoken NPCs) ──
    this.nearbyNPCId = null;
    for (const npc of this.storyNPCs) {
      const dist = dist3(this.player.pos, npc.pos);
      if (dist < 5) {
        // Set nearby NPC for "Press F to Talk" prompt
        this.nearbyNPCId = npc.id;
        this.onNPCNearby(npc.id, npc.name);
      }
    }

    // ── Snap all enemies to terrain height ────────────────────────
    for (const enemy of this.enemies) {
      if (enemy.state.aiState !== EnemyAIState.Dead) {
        enemy.state.pos.y = getTerrainHeight(enemy.state.pos.x, enemy.state.pos.z);
      }
    }

    // Update projectiles
    const projToRemove: number[] = [];
    for (const [id, proj] of this.projectiles) {
      if (now - proj.spawnTime > C.ARROW_LIFETIME_MS) { projToRemove.push(id); continue; }
      proj.state.pos.x += proj.state.vel.x * dt;
      proj.state.pos.y += proj.state.vel.y * dt;
      proj.state.pos.z += proj.state.vel.z * dt;
      proj.state.vel.y += C.GRAVITY * dt;  // T1-1: Use proper gravity constant
      // T1-6: Terrain collision for projectiles
      const projGroundY = getTerrainHeight(proj.state.pos.x, proj.state.pos.z);
      if (proj.state.pos.y < projGroundY) { projToRemove.push(id); continue; }

      // Check obstacle collision
      for (const obs of this.obstacles) {
        const dx = proj.state.pos.x - obs.pos.x;
        const dz = proj.state.pos.z - obs.pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < obs.radius) {
          projToRemove.push(id);
          break;
        }
      }
      if (projToRemove.includes(id)) continue;

      // Player arrows hit enemies/boss (+ Pashupatastra)
      const isPlayerArrow = proj.state.type === ProjectileType.Arrow || proj.state.type === ProjectileType.FireArrow ||
          proj.state.type === ProjectileType.VayuAstra || proj.state.type === ProjectileType.VarunaAstra ||
          proj.state.type === ProjectileType.NagaAstra || proj.state.type === ProjectileType.BrahmaAstra ||
          proj.state.type === ProjectileType.Pashupatastra;
      if (isPlayerArrow) {
        for (const enemy of this.enemies) {
          if (enemy.state.aiState === EnemyAIState.Dead) continue;
          if (dist3(proj.state.pos, enemy.state.pos) < 1.2) {
            let dmg = proj.state.damage;

            // T3-4: Stealth damage bonus when crouching and enemy is unaware
            if (this.isCrouching && enemy.state.aiState === EnemyAIState.Patrol) {
              dmg *= C.STEALTH_DAMAGE_MULTIPLIER;
              if (this.onCriticalHit) this.onCriticalHit(DamageTargetType.Enemy, enemy.state.id, dmg);
            }

            // Headshot bonus
            if (proj.state.pos.y > enemy.state.pos.y + 1.8) {
              dmg *= 1.5;
              if (this.onHeadshot) this.onHeadshot(enemy.state.id);
              this.karma.valor += C.KARMA_VALOR_HEADSHOT;
              this.onKarmaEvent('valor', C.KARMA_VALOR_HEADSHOT);
            }

            // Critical hit: 10% chance for 2x
            if (Math.random() < 0.1) {
              dmg *= 2;
              if (this.onCriticalHit) this.onCriticalHit(DamageTargetType.Enemy, enemy.state.id, dmg);
            }

            if (now < this.dharmaGraceEnd) dmg *= 1.5;
            enemy.state.hp -= dmg;
            this.onDamage(DamageTargetType.Enemy, enemy.state.id, dmg, 1);

            // P2-2: Build Brahmastra charge on player hits
            this.brahmaCharge = Math.min(C.BRAHMA_MAX_CHARGE, this.brahmaCharge + C.BRAHMA_CHARGE_PER_HIT);

            // ── Astra Synergy: apply elemental status ──
            const pType = proj.state.type;
            if (pType === ProjectileType.FireArrow) this.applyAstraElement(enemy, AstraElement.Fire, now);
            else if (pType === ProjectileType.VayuAstra) this.applyAstraElement(enemy, AstraElement.Wind, now);
            else if (pType === ProjectileType.VarunaAstra) {
              this.applyAstraElement(enemy, AstraElement.Water, now);
              enemy.slowFactor = C.VARUNA_ASTRA_SLOW_FACTOR;
              enemy.slowEnd = now + C.VARUNA_ASTRA_SLOW_DURATION_MS;
            }
            else if (pType === ProjectileType.NagaAstra) this.applyAstraElement(enemy, AstraElement.Poison, now);
            else if (pType === ProjectileType.BrahmaAstra || pType === ProjectileType.Pashupatastra) {
              this.applyAstraElement(enemy, AstraElement.Divine, now);
            }

            if (enemy.state.hp <= 0) this.killEnemy(enemy);
            projToRemove.push(id); break;
          }
        }
        if (projToRemove.includes(id)) continue;

        // Hit boss
        if (this.boss.state.phase !== BossPhase.Dead && this.boss.state.phase !== BossPhase.Idle) {
          if (dist3(proj.state.pos, this.boss.state.pos) < 2.5) {
            let dmg = proj.state.damage * this.bossDamageMultiplier;
            if (now < this.dharmaGraceEnd) dmg *= 1.5;
            this.boss.state.hp -= dmg;
            this.onDamage(DamageTargetType.Boss, 0, dmg, 1);
            this.checkBossPhase();
            projToRemove.push(id);
          }
        }
        if (projToRemove.includes(id)) continue;

        // Hit Ravana head turrets
        for (const head of this.boss.heads) {
          if (!head.alive) continue;
          if (dist3(proj.state.pos, head.pos) < 1.5) {
            head.hp -= proj.state.damage;
            this.onDamage(DamageTargetType.Enemy, head.id, proj.state.damage, 1);
            if (head.hp <= 0) {
              head.alive = false;
              this.onRavanaHeadDestroyed(head.id);
            }
            projToRemove.push(id);
            break;
          }
        }
      }

      // Enemy/boss projectiles hit player
      if (proj.state.type === ProjectileType.EnemyProjectile || proj.state.type === ProjectileType.BossProjectile ||
          proj.state.type === ProjectileType.EnemyAgniAstra || proj.state.type === ProjectileType.EnemyVayuAstra ||
          proj.state.type === ProjectileType.EnemyNagaAstra) {
        if (this.player.status === PlayerStatus.Alive) {
          if (dist3(proj.state.pos, this.player.pos) < 1.0) {
            if (this.player.isDodging) {
              // Perfect Dodge → Dharma Counter
              // Check if any enemy telegraph is ending within the window
              // T1-7: Check if any telegraph ends during the dodge window (not just at dodge start)
              let perfectDodge = false;
              const dodgeWindowStart = now - C.PERFECT_DODGE_WINDOW_MS;
              const dodgeWindowEnd = now + C.PERFECT_DODGE_WINDOW_MS;
              for (const enemy of this.enemies) {
                if (enemy.telegraphEnd > 0 && enemy.telegraphEnd >= dodgeWindowStart && enemy.telegraphEnd <= dodgeWindowEnd) {
                  perfectDodge = true;
                  break;
                }
              }
              if (perfectDodge) {
                // Perfect dodge: slow-mo trigger + auto-aim + karma
                this.dharmaGraceEnd = now + C.DHARMA_COUNTER_DURATION_MS;
                this.karma.valor += C.KARMA_VALOR_PERFECT_DODGE;
                this.onKarmaEvent('valor', C.KARMA_VALOR_PERFECT_DODGE);
              } else {
                // Normal dodge-through
                this.dharmaGraceEnd = now + 2000;
              }
              this.onDharmaGrace();
            } else {
              // ── Angad Shield absorb ──
              let dmg = proj.state.damage * this.diffDmgMult;
              if (this.angadShieldActive && this.angadShieldAbsorb > 0) {
                const absorbed = Math.min(dmg, this.angadShieldAbsorb);
                dmg -= absorbed;
                this.angadShieldAbsorb -= absorbed;
                if (this.angadShieldAbsorb <= 0) this.angadShieldActive = false;
              }
              if (dmg > 0) {
                this.damagePlayer(dmg, proj.state.ownerId);
                this.onDamageDirection(proj.state.pos);
              }
            }
            projToRemove.push(id);
          }
        }
      }
    }
    for (const id of projToRemove) this.projectiles.delete(id);

    // Update enemies (including tutorial dummy respawns)
    this.updateEnemies(dt, now);

    // Handle tutorial dummy respawns
    if (this.chapter === 0) {
      const tutorialDone = this.tutorialSteps.move && this.tutorialSteps.sprint && this.tutorialSteps.jump && this.tutorialSteps.dodge && this.tutorialSteps.shoot;
      for (const enemy of this.enemies) {
        if (enemy.state.aiState === EnemyAIState.Dead && enemy.respawnTime !== undefined) {
          if (tutorialDone) {
            // Tutorial complete — dummies stay dead
            delete enemy.respawnTime;
          } else if (now >= enemy.respawnTime) {
            // Respawn the dummy during tutorial
            enemy.state.hp = enemy.originalMaxHp || 30;
            enemy.state.maxHp = enemy.originalMaxHp || 30;
            enemy.state.aiState = EnemyAIState.Patrol;
            enemy.state.pos = { ...enemy.patrolOrigin };
            delete enemy.respawnTime;
          }
        }
      }
    }

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

    // Collect health pickups
    const healthPickupsToRemove: number[] = [];
    for (const hpickup of this.healthPickups) {
      if (dist3(this.player.pos, hpickup.pos) < 2.0) {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + hpickup.healAmount);
        if (this.onHealthPickupCollected) this.onHealthPickupCollected(hpickup.id);
        healthPickupsToRemove.push(hpickup.id);
      }
    }
    this.healthPickups = this.healthPickups.filter(h => !healthPickupsToRemove.includes(h.id));

    // Update encounter state machine
    this.updateEncounters(dt, now);

    // Update boss
    this.updateBoss(dt, now);

    // P2-3: Wave rest beat management — after all wave enemies die, brief rest before next spawn
    this.updateWaveRests(now);

    // ── Companion AI ────────────────────────────────────────────
    this.updateCompanions(dt, now);

    // ── Update meditation availability ──────────────────────────
    this.updateMeditationAvailability();

    // G-08: Check investigation point proximity
    for (const point of this.investigationPoints) {
      if (!point.investigated && dist3(this.player.pos, point.pos) < C.INVESTIGATION_POINT_INTERACT_DISTANCE) {
        point.investigated = true;
        this.onInvestigationTriggered(point.clueText);
        // P3-2: Karma for investigating lore points
        this.karma.mercy += C.KARMA_MERCY_INVESTIGATION;
        this.karma.devotion += C.KARMA_DEVOTION_INVESTIGATION;
        this.onKarmaEvent('mercy', C.KARMA_MERCY_INVESTIGATION);
        this.onKarmaEvent('devotion', C.KARMA_DEVOTION_INVESTIGATION);
        // T4-5: Update investigation quests
        for (const quest of this.sideQuests) {
          if (!quest.completed && quest.type === 'investigate' && quest.chapter === this.chapter) {
            quest.progress++;
            this.onQuestProgress(quest.id, quest.progress, quest.target);
            if (quest.progress >= quest.target) {
              quest.completed = true;
              if (quest.reward.hp) this.player.hp = Math.min(this.player.maxHp, this.player.hp + quest.reward.hp);
              if (quest.reward.arrows) this.arrowAmmo = Math.min(this.maxArrowAmmo, this.arrowAmmo + quest.reward.arrows);
              if (quest.reward.karmaAxis && quest.reward.karmaAmount) {
                this.karma[quest.reward.karmaAxis] += quest.reward.karmaAmount;
                this.onKarmaEvent(quest.reward.karmaAxis, quest.reward.karmaAmount);
              }
              this.onQuestCompleted(quest);
            }
          }
        }
      }
    }

    // T4-3: Sacred pillar puzzle interaction
    for (const pillar of this.sacredPillars) {
      if (pillar.activated) continue;
      if (pillar.chapter !== this.chapter) continue;
      const pdx = this.player.pos.x - pillar.pos.x;
      const pdz = this.player.pos.z - pillar.pos.z;
      if (Math.sqrt(pdx * pdx + pdz * pdz) < C.PUZZLE_INTERACT_DISTANCE) {
        // Check if player presses interact (Talk key, F)
        if (this.pendingInteract) {
          this.pendingInteract = false;
          const chapterPillars = this.sacredPillars.filter(p => p.chapter === pillar.chapter);
          const activatedCount = chapterPillars.filter(p => p.activated).length;
          const correct = pillar.requiredOrder === activatedCount + 1;

          if (correct) {
            pillar.activated = true;
            this.onPillarActivated(pillar.id, true);
            this.karma.devotion += 3;
            this.onKarmaEvent('devotion', 3);

            // Check if puzzle complete
            if (chapterPillars.every(p => p.activated)) {
              this.onPuzzleCompleted(pillar.chapter);
              this.player.hp = Math.min(this.player.maxHp, this.player.hp + C.PUZZLE_REWARD_HP);
              this.arrowAmmo = Math.min(this.maxArrowAmmo, this.arrowAmmo + C.PUZZLE_REWARD_ARROWS);
            }
          } else {
            // Wrong order — reset all pillars in this chapter
            for (const p of chapterPillars) p.activated = false;
            this.onPillarActivated(pillar.id, false);
          }
        }
      }
    }

    // T3-5: Prune dead enemies every 30s to prevent memory growth
    if (now - this.lastPruneTime > 30000) {
      this.lastPruneTime = now;
      const prevCount = this.enemies.length;
      this.enemies = this.enemies.filter(e =>
        e.state.aiState !== EnemyAIState.Dead ||
        (now - (e.deathTime || 0)) < 5000 // Keep recently dead for death animation
      );
      if (this.enemies.length < prevCount) {
        // Dead enemies already have meshes disposed by World.ts
      }
    }

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

  // P2-3: Wave rest beat management
  private waveRestActive = false;
  private waveRestEndTime = 0;
  private waveNumber = 0;
  private lastAliveEnemyCount = 0;

  private updateWaveRests(now: number): void {
    // Only active in chapters 4+ where wave encounters happen
    if (this.chapter < 4) return;

    const aliveCount = this.enemies.filter(e => e.state.aiState !== EnemyAIState.Dead && !e.isIllusion).length;

    // Detect wave clear: enemies just went to 0 from non-zero
    if (aliveCount === 0 && this.lastAliveEnemyCount > 0 && !this.waveRestActive) {
      // Start rest beat — 4 seconds of breathing room
      this.waveRestActive = true;
      this.waveRestEndTime = now + 4000;
      this.waveNumber++;

      // Partial heal during rest beat
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 15);
      this.player.stamina = Math.min(C.PLAYER_MAX_STAMINA, this.player.stamina + 25);
      this.arrowAmmo = Math.min(this.maxArrowAmmo, this.arrowAmmo + 3);

      // Announce rest
      this.onWaveAnnouncement(this.waveNumber, 0); // 0 = wave cleared
    }

    // Check if rest period is over (spawning of new enemies happens in chapter progression)
    if (this.waveRestActive && now >= this.waveRestEndTime) {
      this.waveRestActive = false;
    }

    this.lastAliveEnemyCount = aliveCount;
  }

  private updateMeditationAvailability(): void {
    // Can meditate during rest chapters (3 and 6) when no enemies alive
    const isRestChapter = (this.chapter === 3 || this.chapter === 6);
    const allEnemiesDead = this.enemies.every(e => e.state.aiState === EnemyAIState.Dead);
    this.canMeditate = isRestChapter && allEnemiesDead && this.player.status === PlayerStatus.Alive;
  }

  private updateCompanions(dt: number, now: number): void {
    // Find nearest alive enemy for targeting
    const findNearestEnemy = (fromPos: Vec3, maxRange: number): LocalEnemy | null => {
      let nearest: LocalEnemy | null = null;
      let nearestDist = Infinity;
      for (const enemy of this.enemies) {
        if (enemy.state.aiState === EnemyAIState.Dead) continue;
        const ed = dist3(fromPos, enemy.state.pos);
        if (ed < maxRange && ed < nearestDist) {
          nearestDist = ed;
          nearest = enemy;
        }
      }
      return nearest;
    };

    for (const comp of this.companions) {
      // ── P2-1: Personality-based positioning ──
      const hasEnemies = this.enemies.some(e => e.state.aiState !== EnemyAIState.Dead);
      const nearestThreat = findNearestEnemy(this.player.pos, 20);

      if (hasEnemies && nearestThreat) {
        // In combat: position based on personality
        let targetX: number, targetZ: number;
        const sinY = Math.sin(this.player.yaw);
        const cosY = Math.cos(this.player.yaw);

        if (comp.personality === 'aggressive') {
          // Hanuman: flank the nearest enemy from the opposite side of the player
          const ex = nearestThreat.state.pos.x;
          const ez = nearestThreat.state.pos.z;
          const toPlayerX = this.player.pos.x - ex;
          const toPlayerZ = this.player.pos.z - ez;
          const tpLen = Math.sqrt(toPlayerX * toPlayerX + toPlayerZ * toPlayerZ) || 1;
          // Position on far side of enemy from player, at comp.preferredDist
          targetX = ex - (toPlayerX / tpLen) * comp.preferredDist;
          targetZ = ez - (toPlayerZ / tpLen) * comp.preferredDist;
        } else if (comp.personality === 'defensive') {
          // Angad: stay between player and nearest threat
          targetX = (this.player.pos.x + nearestThreat.state.pos.x) * 0.5;
          targetZ = (this.player.pos.z + nearestThreat.state.pos.z) * 0.5;
        } else {
          // Loyal (Lakshman): stay behind player relative to nearest threat
          targetX = this.player.pos.x - sinY * comp.preferredDist;
          targetZ = this.player.pos.z - cosY * comp.preferredDist;
        }

        const dx = targetX - comp.pos.x;
        const dz = targetZ - comp.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > 1.5) {
          const speed = (comp.personality === 'aggressive' ? 7 : 5) * dt;
          comp.pos.x += (dx / d) * speed;
          comp.pos.z += (dz / d) * speed;
        }
      } else {
        // Out of combat: follow player at preferred distance
        const dx = this.player.pos.x - comp.pos.x;
        const dz = this.player.pos.z - comp.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > comp.preferredDist + 1) {
          const speed = 5 * dt;
          comp.pos.x += (dx / d) * speed;
          comp.pos.z += (dz / d) * speed;
        }
      }

      // ── P2-1: Autonomous combat attacks with personality flavor ──
      if (now - comp.lastAttackTime >= comp.attackInterval) {
        // Aggressive companions target furthest enemy in range (Hanuman charges deep)
        // Defensive companions target closest enemy to player (Angad protects)
        // Loyal companions target same enemy player is facing (Lakshman follows lead)
        let target: LocalEnemy | null = null;

        if (comp.personality === 'aggressive') {
          // Hanuman: attack the nearest enemy from his position (he's flanking)
          target = findNearestEnemy(comp.pos, comp.range + 4);
        } else if (comp.personality === 'defensive') {
          // Angad: target enemy closest to the player (bodyguard)
          target = findNearestEnemy(this.player.pos, comp.range);
        } else {
          // Lakshman: target nearest to himself
          target = findNearestEnemy(comp.pos, comp.range);
        }

        if (target) {
          const dmg = comp.damage * (comp.personality === 'aggressive' ? 1.3 : 1.0);
          target.state.hp -= dmg;
          this.onDamage(DamageTargetType.Enemy, target.state.id, dmg, 100);
          if (target.state.hp <= 0) {
            target.state.hp = 0;
            target.state.aiState = EnemyAIState.Dead;
            this.chapterEnemiesKilled++;
            this.spawnPickup(target.state.pos);
            this.checkChapterProgress();
          }
          comp.lastAttackTime = now;
        } else if (this.boss.state.phase !== BossPhase.Dead && this.boss.state.phase !== BossPhase.Idle) {
          const bd = dist3(comp.pos, this.boss.state.pos);
          if (bd < comp.range) {
            const dmg = comp.damage * this.bossDamageMultiplier;
            this.boss.state.hp -= dmg;
            this.onDamage(DamageTargetType.Boss, 0, dmg, 100);
            this.checkBossPhase();
            comp.lastAttackTime = now;
          }
        }
      }

      // Snap companion to terrain height
      comp.pos.y = getTerrainHeight(comp.pos.x, comp.pos.z);
    }
  }

  private handleAllyMet(allyId: string): void {
    if (allyId === 'sugriv') {
      // Complete the goal of meeting Sugriv
      this.completeGoal(3);

      // Sugriv Dharma dialogue sequence — then advance
      setTimeout(() => {
        this.onDialogueSequence([
          { name: 'Sugriv', message: "When Vali drove me from Kishkindha, I hid on Rishyamukha — the one mountain his curse forbade him from entering. I lived like a beggar king until you came. Your single arrow freed me and freed Dharma." },
          { name: 'Sugriv', message: "I have sent search parties in all four directions — Angad leads the southern expedition. Hanuman has already crossed the sea and found Sita in the Ashoka Vatika. The Vanara armies are yours, Rama." },
          { name: 'Sugriv', message: "Rest here, gather your strength. Nala and Nila will build the bridge to Lanka — stones inscribed with your name float upon the sea. Meditate while you can — press V to find inner clarity." },
        ]);
      }, 8500);

      // After dialogue finishes, transition to Chapter 4
      setTimeout(() => {
        this.advanceToChapter4();
      }, 24000);
    }
  }

  private advanceToChapter4(): void {
    this.chapter = 4;
    this.chapterEnemiesKilled = 0;
    this.canMeditate = false;
    this.encounters = [];
    this.setupInvestigationPoints(4); // G-08: Setup investigation points for Chapter 4
    this.onChapterChange(4, "The March to the Sea",
      "With Sugriv's Vanara armies at your command, the march south begins. Jambavan the immortal bear-king and Sampati the wingless vulture await — ancient witnesses who carry wisdom no warrior can. But Ravana's demon scouts infest the path...");

    // Spawn Jambavan as story NPC in Chapter 4
    const base4 = this.CHAPTER_POSITIONS[4];
    const jambPos: Vec3 = { x: base4.x - 40, y: 0, z: base4.z - 95 };
    this.addStoryNPC({
      id: 'jambavan', name: 'Jambavan', pos: jambPos,
      dialogueTreeId: 'ch4_jambavan', spoken: false,
    });

    // Spawn Sampati as story NPC in Chapter 4
    const sampatiPos: Vec3 = { x: base4.x + 15, y: 0, z: base4.z - 105 };
    this.addStoryNPC({
      id: 'sampati', name: 'Sampati', pos: sampatiPos,
      dialogueTreeId: 'ch4_sampati', spoken: false,
    });
    this.onMapWaypoint(jambPos.x, jambPos.z, 1, 'Jambavan', 4);
    this.onMapWaypoint(sampatiPos.x, sampatiPos.z, 1, 'Sampati', 4);

    // Spawn 5 demon scouts in shore area (Encounter: Siege-style)
    const ch4Positions: Vec3[] = [
      { x: base4.x - 30, y: 0, z: base4.z - 85 },
      { x: base4.x + 20, y: 0, z: base4.z - 90 },
      { x: base4.x, y: 0, z: base4.z - 100 },
      { x: base4.x - 45, y: 0, z: base4.z - 75 },
      { x: base4.x + 35, y: 0, z: base4.z - 80 },
    ];
    const ch4Types: Array<'soldier' | 'archer' | 'brute'> = ['soldier', 'archer', 'brute', 'soldier', 'archer'];
    const ch4Hps = [70, C.ENEMY_ARCHER_HP, C.ENEMY_BRUTE_HP, 70, C.ENEMY_ARCHER_HP];
    for (let i = 0; i < ch4Positions.length; i++) {
      const isChamp = (i === ch4Positions.length - 1);
      const enemy = this.createEnemy(ch4Positions[i], ch4Hps[i], ch4Types[i], isChamp);
      this.enemies.push(enemy);
      if (isChamp) {
        this.onChampionSpawned(enemy.state.id);
        this.encounters.push({
          id: this.nextEncounterId++,
          phase: EncounterPhase.Dormant,
          championId: enemy.state.id,
          chapter: 4,
          phaseTimer: 0,
          dialogueShown: false,
          midDialogueShown: false,
          defeatDialogueShown: false,
        });
      }
    }
    this.midChapterCheckpointSaved = false;
  }

  private pushOutOfObstacles(pos: Vec3): void {
    for (const obs of this.obstacles) {
      const dx = pos.x - obs.pos.x;
      const dz = pos.z - obs.pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < obs.radius + 0.5) { // 0.5 = entity radius
        const pushDist = obs.radius + 0.5 - dist;
        const nx = dx / (dist || 1);
        const nz = dz / (dist || 1);
        pos.x += nx * pushDist;
        pos.z += nz * pushDist;
      }
    }
    // Clamp to world bounds
    const halfWorld = C.WORLD_SIZE / 2;
    pos.x = Math.max(-halfWorld, Math.min(halfWorld, pos.x));
    pos.z = Math.max(-halfWorld, Math.min(halfWorld, pos.z));
  }

  private updateEnemies(dt: number, now: number): void {
    for (const enemy of this.enemies) {
      if (enemy.state.aiState === EnemyAIState.Dead) continue;

      // T4-2: Golden Deer special behavior — always fleeing unless revealed
      if (enemy.isGoldenDeer && !this.goldenDeerRevealed) {
        // Flee behavior: always run away from player
        const deerDx = enemy.state.pos.x - this.player.pos.x;
        const deerDz = enemy.state.pos.z - this.player.pos.z;
        const deerDist = Math.sqrt(deerDx * deerDx + deerDz * deerDz) || 1;
        enemy.state.pos.x += (deerDx / deerDist) * C.GOLDEN_DEER_SPEED * dt;
        enemy.state.pos.z += (deerDz / deerDist) * C.GOLDEN_DEER_SPEED * dt;
        enemy.state.pos.y = getTerrainHeight(enemy.state.pos.x, enemy.state.pos.z);
        enemy.state.yaw = Math.atan2(-deerDx, -deerDz);

        // When HP drops below threshold, Maricha reveals himself
        if (enemy.state.hp <= C.GOLDEN_DEER_HP * C.GOLDEN_DEER_REVEAL_HP_PCT && !this.goldenDeerRevealed) {
          this.goldenDeerRevealed = true;
          enemy.state.aiState = EnemyAIState.Dead;  // "Kill" the deer form
          // Spawn Maricha NPC for dialogue
          this.addStoryNPC({
            id: 'maricha', name: 'Maricha', pos: { ...enemy.state.pos },
            dialogueTreeId: 'maricha_reveal', spoken: false,
          });
        }
        continue;  // Skip normal AI for golden deer
      }

      // Tick status effects (expire old elements, expire slow)
      this.tickStatusEffects(enemy, now);
      const nearestDist = dist3(enemy.state.pos, this.player.pos);
      // Apply slow factor to effective dt for this enemy
      const eDt = dt * enemy.slowFactor;

      // Update behavior timer
      enemy.behaviorTimer -= eDt;

      if (enemy.state.aiState === EnemyAIState.Patrol) {
        enemy.patrolAngle += dt * 0.5;
        const px = enemy.patrolOrigin.x + Math.cos(enemy.patrolAngle) * 5;
        const pz = enemy.patrolOrigin.z + Math.sin(enemy.patrolAngle) * 5;
        const dx = px - enemy.state.pos.x;
        const dz = pz - enemy.state.pos.z;
        const l = Math.sqrt(dx * dx + dz * dz) || 1;

        // Use type-specific patrol speed
        let patrolSpeed = C.ENEMY_PATROL_SPEED;
        if (enemy.enemyType === 'archer') patrolSpeed = C.ENEMY_ARCHER_PATROL_SPEED;
        else if (enemy.enemyType === 'brute') patrolSpeed = C.ENEMY_BRUTE_PATROL_SPEED;

        enemy.state.pos.x += (dx / l) * patrolSpeed * dt;
        enemy.state.pos.z += (dz / l) * patrolSpeed * dt;
        enemy.state.yaw = Math.atan2(dx, dz);
        this.pushOutOfObstacles(enemy.state.pos);
        // Tutorial dummies don't chase — stay in patrol forever
        // T3-4: Reduce aggro range when player is crouching
        const aggroRange = this.isCrouching ? C.ENEMY_AGGRO_RANGE * C.CROUCH_AGGRO_RANGE_REDUCTION : C.ENEMY_AGGRO_RANGE;
        if (this.chapter !== 0 && this.player.status === PlayerStatus.Alive && nearestDist < aggroRange) {
          enemy.state.aiState = EnemyAIState.Chase;
          enemy.state.targetId = 1;
          enemy.behaviorTimer = 0;
        }
      } else if (
        enemy.state.aiState === EnemyAIState.Chase ||
        enemy.state.aiState === EnemyAIState.Strafe ||
        enemy.state.aiState === EnemyAIState.Retreat ||
        enemy.state.aiState === EnemyAIState.Flank
      ) {
        // Deaggro if player is too far or dead
        if (this.player.status !== PlayerStatus.Alive || nearestDist > C.ENEMY_DEAGGRO_RANGE) {
          enemy.state.aiState = EnemyAIState.Patrol;
          enemy.state.targetId = 0;
          continue;
        }

        const dx = this.player.pos.x - enemy.state.pos.x;
        const dz = this.player.pos.z - enemy.state.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz) || 1;
        enemy.state.yaw = Math.atan2(dx, dz);

        // Pack behavior: when 3+ enemies within 15 units are chasing the same player, increase spread
        let nearbyAllies = 0;
        for (const other of this.enemies) {
          if (other === enemy || other.state.aiState === EnemyAIState.Dead) continue;
          if (other.state.targetId === 1) { // Also chasing player
            const allyDist = dist3(enemy.state.pos, other.state.pos);
            if (allyDist < 15) nearbyAllies++;
          }
        }

        // If in a pack of 3+, increase preferred range to spread out more
        if (nearbyAllies >= 2) { // 2 allies + self = 3+ enemies
          enemy.preferredRange = Math.min(20, enemy.preferredRange + 3);
        }

        // Roll new behavior when timer expires
        if (enemy.behaviorTimer <= 0) {
          // Behavior logic varies by enemy type
          if (enemy.enemyType === 'archer') {
            // Archer: keeps distance, prefers ranged combat, always retreats if too close
            if (d < 10) {
              // Always retreat if too close
              enemy.state.aiState = EnemyAIState.Retreat;
            } else if (d >= 10 && d <= 24) {
              // Preferred ranged zone: 70% strafe/ranged, 20% retreat, 10% chase
              const roll = Math.random();
              if (roll < 0.7) {
                enemy.state.aiState = Math.random() < 0.5 ? EnemyAIState.Strafe : EnemyAIState.RangedAttack;
              } else if (roll < 0.9) {
                enemy.state.aiState = EnemyAIState.Retreat;
              } else {
                enemy.state.aiState = EnemyAIState.Chase;
              }
            } else {
              // Too far: chase to get into range
              enemy.state.aiState = EnemyAIState.Chase;
            }
          } else if (enemy.enemyType === 'brute') {
            // Brute: aggressive melee, almost never ranged, prefers flanking
            if (d > enemy.preferredRange * 1.5) {
              // Chase if too far
              enemy.state.aiState = EnemyAIState.Chase;
            } else {
              // In combat range: 80% chase, 15% flank, 5% strafe (almost never ranged)
              const roll = Math.random();
              if (roll < 0.8) {
                enemy.state.aiState = EnemyAIState.Chase;
              } else if (roll < 0.95) {
                enemy.state.aiState = EnemyAIState.Flank;
              } else {
                enemy.state.aiState = EnemyAIState.Strafe;
              }
            }
          } else {
            // Soldier (default): balanced behavior
            if (d > enemy.preferredRange * 1.5) {
              enemy.state.aiState = EnemyAIState.Chase;
            } else if (d < enemy.preferredRange * 0.5) {
              const roll = Math.random();
              if (roll < 0.4) {
                enemy.state.aiState = EnemyAIState.Retreat;
              } else if (roll < 0.7) {
                enemy.state.aiState = EnemyAIState.Strafe;
              } else {
                enemy.state.aiState = EnemyAIState.Chase;
              }
            } else {
              // In optimal range
              const roll = Math.random();
              if (roll < 0.4) {
                enemy.state.aiState = EnemyAIState.Strafe;
              } else if (roll < 0.7) {
                enemy.state.aiState = EnemyAIState.RangedAttack;
              } else if (roll < 0.85) {
                enemy.state.aiState = EnemyAIState.Flank;
              } else {
                enemy.state.aiState = EnemyAIState.Chase;
              }
            }
          }
          enemy.behaviorTimer = 1.5 + Math.random() * 2;
          enemy.strafeDir = Math.random() > 0.5 ? 1 : -1;
        }

        // Execute current behavior
        if (enemy.state.aiState === EnemyAIState.Chase) {
          // Use type-specific chase speed
          let chaseSpeed = C.ENEMY_CHASE_SPEED;
          if (enemy.enemyType === 'archer') chaseSpeed = C.ENEMY_ARCHER_CHASE_SPEED;
          else if (enemy.enemyType === 'brute') chaseSpeed = C.ENEMY_BRUTE_CHASE_SPEED;

          enemy.state.pos.x += (dx / d) * chaseSpeed * dt;
          enemy.state.pos.z += (dz / d) * chaseSpeed * dt;
        } else if (enemy.state.aiState === EnemyAIState.Strafe) {
          // Perpendicular movement (rotated 90°)
          const perpX = -dz / d * enemy.strafeDir;
          const perpZ = dx / d * enemy.strafeDir;

          // Use type-specific chase speed for strafe
          let chaseSpeed = C.ENEMY_CHASE_SPEED;
          if (enemy.enemyType === 'archer') chaseSpeed = C.ENEMY_ARCHER_CHASE_SPEED;
          else if (enemy.enemyType === 'brute') chaseSpeed = C.ENEMY_BRUTE_CHASE_SPEED;

          enemy.state.pos.x += perpX * chaseSpeed * 0.8 * dt;
          enemy.state.pos.z += perpZ * chaseSpeed * 0.8 * dt;

          // Determine ranged range and cooldown based on type
          let rangedRange = C.ENEMY_RANGED_RANGE;
          let rangedCooldown = C.ENEMY_RANGED_COOLDOWN_MS;
          if (enemy.enemyType === 'archer') {
            rangedRange = C.ENEMY_ARCHER_RANGED_RANGE;
            rangedCooldown = C.ENEMY_ARCHER_RANGED_COOLDOWN_MS;
          } else if (enemy.enemyType === 'brute') {
            rangedRange = C.ENEMY_BRUTE_RANGED_RANGE;
            rangedCooldown = C.ENEMY_BRUTE_RANGED_COOLDOWN_MS;
          }

          // Still fire when able
          if (d <= rangedRange && now >= enemy.rangedCdEnd) {
            const dir = normalize3(sub3(this.player.pos, enemy.state.pos));
            dir.y += 0.1;
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
            enemy.rangedCdEnd = now + rangedCooldown;
          }
        } else if (enemy.state.aiState === EnemyAIState.Retreat) {
          // Use type-specific chase speed for retreat
          let chaseSpeed = C.ENEMY_CHASE_SPEED;
          if (enemy.enemyType === 'archer') chaseSpeed = C.ENEMY_ARCHER_CHASE_SPEED;
          else if (enemy.enemyType === 'brute') chaseSpeed = C.ENEMY_BRUTE_CHASE_SPEED;

          enemy.state.pos.x -= (dx / d) * chaseSpeed * 0.6 * dt;
          enemy.state.pos.z -= (dz / d) * chaseSpeed * 0.6 * dt;
          if (d >= enemy.preferredRange) {
            enemy.state.aiState = EnemyAIState.Strafe;
            enemy.behaviorTimer = 1.5 + Math.random() * 2;
          }
        } else if (enemy.state.aiState === EnemyAIState.Flank) {
          // Use type-specific chase speed for flanking
          let chaseSpeed = C.ENEMY_CHASE_SPEED;
          if (enemy.enemyType === 'archer') chaseSpeed = C.ENEMY_ARCHER_CHASE_SPEED;
          else if (enemy.enemyType === 'brute') chaseSpeed = C.ENEMY_BRUTE_CHASE_SPEED;

          const angle = Math.atan2(dx, dz) + (Math.PI / 4) * enemy.strafeDir;
          enemy.state.pos.x += Math.sin(angle) * chaseSpeed * dt;
          enemy.state.pos.z += Math.cos(angle) * chaseSpeed * dt;
        } else if (enemy.state.aiState === EnemyAIState.RangedAttack) {
          // Stay still and shoot
          // Determine ranged range and cooldown based on type
          let rangedRange = C.ENEMY_RANGED_RANGE;
          let rangedCooldown = C.ENEMY_RANGED_COOLDOWN_MS;
          if (enemy.enemyType === 'archer') {
            rangedRange = C.ENEMY_ARCHER_RANGED_RANGE;
            rangedCooldown = C.ENEMY_ARCHER_RANGED_COOLDOWN_MS;
          } else if (enemy.enemyType === 'brute') {
            rangedRange = C.ENEMY_BRUTE_RANGED_RANGE;
            rangedCooldown = C.ENEMY_BRUTE_RANGED_COOLDOWN_MS;
          }

          if (d <= rangedRange && now >= enemy.rangedCdEnd) {
            // Telegraph period: 600ms before ranged attack
            if (now >= enemy.telegraphEnd) {
              // If telegraph hasn't been set yet for this attack, set it
              if (enemy.telegraphEnd === 0) {
                enemy.telegraphEnd = now + 600;
              } else {
                // Telegraph period has ended, execute the attack
                const dir = normalize3(sub3(this.player.pos, enemy.state.pos));
                dir.y += 0.1;
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
                enemy.rangedCdEnd = now + rangedCooldown;
                enemy.telegraphEnd = 0; // Reset telegraph
              }
            }
          }
        }

        this.pushOutOfObstacles(enemy.state.pos);

        // Melee attack when in range
        // Determine melee range, damage, and cooldown based on type
        let meleeRange = C.ENEMY_MELEE_RANGE;
        let meleeDamage = C.ENEMY_MELEE_DAMAGE;
        let meleeCooldown = C.ENEMY_MELEE_COOLDOWN_MS;

        if (enemy.enemyType === 'archer') {
          meleeDamage = C.ENEMY_ARCHER_MELEE_DAMAGE;
          meleeCooldown = C.ENEMY_ARCHER_MELEE_COOLDOWN_MS;
        } else if (enemy.enemyType === 'brute') {
          meleeRange = C.ENEMY_BRUTE_MELEE_RANGE;
          meleeDamage = C.ENEMY_BRUTE_MELEE_DAMAGE;
          meleeCooldown = C.ENEMY_BRUTE_MELEE_COOLDOWN_MS;
        }
        // Scale damage by difficulty + champion
        meleeDamage *= this.diffDmgMult;
        if (enemy.isChampion) meleeDamage *= C.CHAMPION_DAMAGE_MULTIPLIER;

        if (nearestDist <= meleeRange) {
          if (now >= enemy.meleeCdEnd && !this.player.isDodging) {
            // Telegraph period: 400ms before melee attack
            if (now >= enemy.telegraphEnd) {
              if (enemy.telegraphEnd === 0) {
                enemy.telegraphEnd = now + 400;
              } else {
                // Telegraph done → attack
                let dmg = meleeDamage;
                // Angad shield absorb
                if (this.angadShieldActive && this.angadShieldAbsorb > 0) {
                  const absorbed = Math.min(dmg, this.angadShieldAbsorb);
                  dmg -= absorbed;
                  this.angadShieldAbsorb -= absorbed;
                  if (this.angadShieldAbsorb <= 0) this.angadShieldActive = false;
                }
                if (dmg > 0) {
                  this.damagePlayer(dmg, 200 + enemy.state.id);
                  this.onDamageDirection(enemy.state.pos);
                }
                enemy.meleeCdEnd = now + meleeCooldown;
                enemy.telegraphEnd = 0;
                if (Math.random() < 0.2) {
                  enemy.state.aiState = EnemyAIState.Retreat;
                  enemy.behaviorTimer = 1.5 + Math.random() * 2;
                }
              }
            }
          }
        }
      }
      // T4-1: Kumbhakarna stomp attack
      if (enemy.isKumbhakarna && now >= (enemy.stompCdEnd || 0) && nearestDist < C.KUMBHAKARNA_STOMP_RADIUS) {
        enemy.stompCdEnd = now + C.KUMBHAKARNA_STOMP_COOLDOWN_MS;
        if (!this.player.isDodging) {
          this.damagePlayer(C.KUMBHAKARNA_STOMP_DAMAGE * this.diffDmgMult, 200 + enemy.state.id);
          this.onDamageDirection(enemy.state.pos);
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

    // T1-3: Clamp boss to arena boundary
    const baDx = b.pos.x - C.BOSS_ARENA_CENTER.x;
    const baDz = b.pos.z - C.BOSS_ARENA_CENTER.z;
    const baDist = Math.sqrt(baDx * baDx + baDz * baDz);
    if (baDist > C.BOSS_ARENA_RADIUS) {
      const baScale = C.BOSS_ARENA_RADIUS / baDist;
      b.pos.x = C.BOSS_ARENA_CENTER.x + baDx * baScale;
      b.pos.z = C.BOSS_ARENA_CENTER.z + baDz * baScale;
    }

    // T3-3: Lava geyser damage
    const LAVA_VENT_POSITIONS = [
      { x: C.BOSS_ARENA_CENTER.x + 12, z: C.BOSS_ARENA_CENTER.z },
      { x: C.BOSS_ARENA_CENTER.x - 12, z: C.BOSS_ARENA_CENTER.z },
      { x: C.BOSS_ARENA_CENTER.x, z: C.BOSS_ARENA_CENTER.z + 12 },
      { x: C.BOSS_ARENA_CENTER.x, z: C.BOSS_ARENA_CENTER.z - 12 },
    ];
    const lavaPhaseTime = now * 0.001;
    for (let i = 0; i < LAVA_VENT_POSITIONS.length; i++) {
      const phase = (lavaPhaseTime + i * Math.PI / 2) % (Math.PI * 2);
      const active = Math.sin(phase) > 0.7;
      if (active) {
        const vdx = this.player.pos.x - LAVA_VENT_POSITIONS[i].x;
        const vdz = this.player.pos.z - LAVA_VENT_POSITIONS[i].z;
        if (Math.sqrt(vdx * vdx + vdz * vdz) < C.LAVA_VENT_RADIUS) {
          this.damagePlayer(C.LAVA_VENT_DAMAGE * dt, 255); // 8 damage per second while standing on vent
        }
      }
    }

    // ── Ravana Head Turrets (Phase 2+) ──
    for (const head of this.boss.heads) {
      if (!head.alive) continue;
      if (now >= head.cooldownEnd && this.player.status === PlayerStatus.Alive) {
        // Fire at player
        const hdx = this.player.pos.x - head.pos.x;
        const hdz = this.player.pos.z - head.pos.z;
        const hl = Math.sqrt(hdx * hdx + hdz * hdz) || 1;
        const dir: Vec3 = { x: hdx / hl, y: 0.2, z: hdz / hl };
        this.spawnProjectile(255, ProjectileType.BossProjectile, head.pos, dir, C.RAVANA_HEAD_DAMAGE * enrageMult);
        head.cooldownEnd = now + C.RAVANA_HEAD_COOLDOWN_MS;
      }
    }
  }

  private checkBossPhase(): void {
    const b = this.boss.state;
    if (b.hp <= 0) {
      b.hp = 0;
      b.phase = BossPhase.Dead;
      this.completeGoal(7);
      // Karma: valor for boss kill
      this.karma.valor += 20;
      this.onKarmaEvent('valor', 20);
      this.onKarmaUpdate(this.karma);
      // Start death dialogue instead of immediately ending game
      this.pendingGameOver = true;
      this.startDialogue('ravana_death');
      return;
    }
    // T1-4: Check Phase2 BEFORE Phase3 to prevent skipping Phase2
    const pct = b.hp / b.maxHp;
    if (pct <= C.BOSS_PHASE2_HP_PCT && b.phase === BossPhase.Phase1) {
      b.phase = BossPhase.Phase2;
      // Spawn head turrets on Phase 2 transition
      this.spawnRavanaHeads();
    } else if (pct <= C.BOSS_PHASE3_HP_PCT && b.phase === BossPhase.Phase2) {
      b.phase = BossPhase.Phase3Enrage;
    }
  }

  /** Spawn detachable Ravana head turrets around the boss arena */
  private spawnRavanaHeads(): void {
    const center = this.boss.state.pos;
    const now = performance.now();
    for (let i = 0; i < C.RAVANA_HEAD_COUNT; i++) {
      const angle = (Math.PI * 2 / C.RAVANA_HEAD_COUNT) * i;
      const headPos: Vec3 = { x: center.x + Math.cos(angle) * 6, y: 2, z: center.z + Math.sin(angle) * 6 };
      const headId = this.nextHeadId++;
      const head: RavanaHead = {
        id: headId,
        pos: headPos,
        hp: C.RAVANA_HEAD_HP,
        maxHp: C.RAVANA_HEAD_HP,
        cooldownEnd: now + 2000,
        alive: true,
      };
      this.boss.heads.push(head);
      this.onRavanaHeadSpawned(headId, headPos);
    }
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
    const arrows = C.ARROW_DROP_MIN + Math.floor(Math.random() * (C.ARROW_DROP_MAX - C.ARROW_DROP_MIN + 1)); // 3-7 arrows
    const pickup: Pickup = { id: pickupId, pos: { ...pos }, arrows };
    this.pickups.push(pickup);
    this.onPickupSpawned(pickupId, pickup.pos, pickup.arrows);

    // 35% chance enemy drops a map fragment revealing nearby area
    if (Math.random() < 0.35) {
      const revealRadius = 15 + Math.random() * 15; // 15-30 world units
      const cx = pos.x + (Math.random() - 0.5) * 20;
      const cz = pos.z + (Math.random() - 0.5) * 20;
      this.onEnemyDroppedMap(0, cx, cz, revealRadius);
      this.onMapWaypoint(pos.x, pos.z, 2, 'Fallen Sentinel', this.chapter); // EnemyCamp = 2
    }
  }

  private spawnHealthPickup(pos: Vec3): void {
    const healthPickupId = this.nextHealthPickupId++;
    const healAmount = 15;
    const healthPickup: HealthPickup = { id: healthPickupId, pos: { ...pos }, healAmount };
    this.healthPickups.push(healthPickup);
    if (this.onHealthPickupSpawned) this.onHealthPickupSpawned(healthPickupId, healthPickup.pos, healAmount);
  }

  private checkChapterProgress(): void {
    // ── Mid-chapter checkpoint (save at half-kill count) ──
    if (!this.midChapterCheckpointSaved) {
      const halfKill = this.chapter === 1 ? 2 : this.chapter === 2 ? 2 : this.chapter === 4 ? 3 : this.chapter === 5 ? 3 : 999;
      if (this.chapterEnemiesKilled >= halfKill) {
        this.midChapterCheckpointSaved = true;
        this.onCheckpointSaved();
      }
    }

    // Chapter 1 → 2: 4 sentinels killed
    if (this.chapter === 1 && this.chapterEnemiesKilled >= 4) {
      this.completeGoal(1);
      this.chapter = 2;
      this.chapterEnemiesKilled = 0;
      this.setupInvestigationPoints(2); // G-08: Setup investigation points for Chapter 2
      this.onChapterChange(2, "Jatayu's Legacy", "Beyond the fallen sentinels lies the place where noble Jatayu gave his life defending Sita. Ravana's Demon Guard patrol these bloodied grounds — elite warriors who sold their honour for power. Avenge the vulture king...");
      this.onMapWaypoint(0, 0, 6, 'Chapter 2 — Jatayu\'s Legacy', 2); // ChapterGate = 6
      this.onMapReveal(0, -20, 25, 2, 'The Demon Guard patrols were mapped from battle');

      // Spawn Jatayu's Spirit as story NPC in Chapter 2
      const jatayuPos: Vec3 = { x: -20, y: 0, z: -55 };
      this.addStoryNPC({
        id: 'jatayu', name: 'Spirit of Jatayu', pos: jatayuPos,
        dialogueTreeId: 'ch2_jatayu', spoken: false,
      });

      // Spawn 4 tougher enemies + 1 mini-boss champion for chapter 2
      this.encounters = [];
      const base2 = this.CHAPTER_POSITIONS[2];
      const chapter2Positions: Vec3[] = [
        { x: base2.x - 25, y: 0, z: base2.z - 50 },
        { x: base2.x + 15, y: 0, z: base2.z - 60 },
        { x: base2.x - 10, y: 0, z: base2.z - 70 },
        { x: base2.x + 30, y: 0, z: base2.z - 55 },
      ];
      for (let i = 0; i < chapter2Positions.length; i++) {
        const pos = chapter2Positions[i];
        const isArcher = Math.random() < 0.4;
        const type = isArcher ? 'archer' : 'soldier';
        const hp = isArcher ? C.ENEMY_ARCHER_HP : 80;
        // Last enemy is a champion mini-boss
        const isChamp = (i === chapter2Positions.length - 1);
        const enemy = this.createEnemy(pos, hp, type, isChamp);
        this.enemies.push(enemy);
        if (isChamp) {
          this.onChampionSpawned(enemy.state.id);
          this.encounters.push({
            id: this.nextEncounterId++,
            phase: EncounterPhase.Dormant,
            championId: enemy.state.id,
            chapter: 2,
            phaseTimer: 0,
            dialogueShown: false,
            midDialogueShown: false,
            defeatDialogueShown: false,
          });
        }
      }

      // T4-2: Spawn Maricha as Golden Deer (fleeing enemy variant)
      const deerPos: Vec3 = { x: base2.x + 10, y: 0, z: base2.z + 15 };
      const deer = this.createEnemy(deerPos, C.GOLDEN_DEER_HP, 'soldier', false);
      deer.isGoldenDeer = true;
      deer.state.aiState = EnemyAIState.Retreat;  // Always fleeing
      this.goldenDeerEnemy = deer;
      this.goldenDeerActive = true;
      this.enemies.push(deer);

      // Mid-chapter checkpoint
      this.midChapterCheckpointSaved = false;
    }
    // Chapter 2 → 3 (Kishkindha — meet Sugriv): 4 elites killed
    else if (this.chapter === 2 && this.chapterEnemiesKilled >= 4) {
      this.completeGoal(2);
      this.chapter = 3;
      this.chapterEnemiesKilled = 0;
      this.canMeditate = true;
      this.setupInvestigationPoints(3); // G-08: Setup investigation points for Chapter 3
      this.onChapterChange(3, "Kishkindha — The Vanara Alliance",
        "You arrive at Rishyamukha, where Sugriv once hid from his brother Vali's wrath. It was here that Rama and Sugriv first met — two exiled kings bound by honour. The debt of Kishkindha is repaid in blood and brotherhood...");
      this.onMapWaypoint(0, -15, 6, 'Chapter 3 — Kishkindha', 3);
      this.onMapReveal(0, -15, 30, 3, 'Sugriv revealed paths through Kishkindha');

      // Spawn Sugriv as story NPC with dialogue tree
      const sugrivPos: Vec3 = { x: -55, y: 0, z: -65 };
      this.addStoryNPC({
        id: 'sugriv', name: 'Sugriv', pos: sugrivPos,
        dialogueTreeId: 'ch3_sugriv', spoken: false,
      });
    }
    // Chapter 4 → 5 (Angad's Challenge): 5 scouts killed → Hanuman joins
    else if (this.chapter === 4 && this.chapterEnemiesKilled >= 5) {
      this.completeGoal(4);
      this.chapter = 5;
      this.chapterEnemiesKilled = 0;

      // Hanuman joins as companion
      const hanumanPos: Vec3 = { x: this.player.pos.x + 3, y: 0, z: this.player.pos.z + 3 };
      this.companions.push({
        id: 'hanuman', name: 'Hanuman', pos: hanumanPos,
        damage: 10, attackInterval: 2000, range: 8,
        lastAttackTime: 0, hpRegenBuff: 0,
        personality: 'aggressive', preferredDist: 8, flanking: false,
        flankTarget: { x: 0, y: 0, z: 0 }, combatCooldown: 0,
      });
      this.onCompanionJoined('hanuman', 'Hanuman', hanumanPos);

      this.onChapterChange(5, "Angad's Embassy",
        "Hanuman, who leapt across the ocean and set Lanka ablaze with his burning tail, now fights at your side. But first — Angad, son of the slain Vali, returns from Ravana's court. He planted his foot before the demon throne and none could move it. His loyalty to you transcends the grief of his father's death...");
      this.onMapWaypoint(this.player.pos.x, this.player.pos.z, 7, 'Hanuman Joined', 5);
      this.onMapReveal(this.player.pos.x, this.player.pos.z, 30, 5, 'Hanuman scouted the demon positions ahead');

      // Spawn Angad as story NPC in Chapter 5
      const base5 = this.CHAPTER_POSITIONS[5];
      const angadNpcPos: Vec3 = { x: base5.x + 55, y: 0, z: base5.z - 35 };
      this.addStoryNPC({
        id: 'angad_npc', name: 'Angad', pos: angadNpcPos,
        dialogueTreeId: 'ch5_angad', spoken: false,
      });

      // Hanuman Dharma dialogue after chapter banner
      setTimeout(() => {
        this.onDialogueSequence([
          { name: 'Hanuman', message: "Lord Rama, when I leapt across the ocean, Surasa the serpent-goddess and Simhika the shadow-demon tried to stop me — yet devotion to you carried me over every obstacle." },
          { name: 'Hanuman', message: "In the Ashoka Vatika, I found Mother Sita beneath the Simsapa tree, guarded by Rakshasis. I gave her your signet ring and she wept with joy. She sent this — a jewel from her hair — so you would know she lives and waits." },
          { name: 'Hanuman', message: "I set Lanka's golden rooftops ablaze with the very torch they tied to my tail. Let Ravana know: where Rama's devotee walks, even fire obeys Dharma." },
        ]);
      }, 5000);

      // Spawn 5 elite demon warriors + champion mini-boss in Ch5
      this.encounters = [];
      const ch5Positions: Vec3[] = [
        { x: base5.x + 35, y: 0, z: base5.z - 45 },
        { x: base5.x + 60, y: 0, z: base5.z - 25 },
        { x: base5.x + 45, y: 0, z: base5.z - 55 },
        { x: base5.x + 70, y: 0, z: base5.z - 10 },
        { x: base5.x + 55, y: 0, z: base5.z - 60 },
      ];
      const ch5Types: Array<'soldier' | 'archer' | 'brute'> = ['soldier', 'archer', 'brute', 'archer', 'brute'];
      const ch5Hps = [90, C.ENEMY_ARCHER_HP, C.ENEMY_BRUTE_HP, C.ENEMY_ARCHER_HP, C.ENEMY_BRUTE_HP];
      for (let i = 0; i < ch5Positions.length; i++) {
        const isChamp = (i === ch5Positions.length - 1); // Last is champion
        const enemy = this.createEnemy(ch5Positions[i], ch5Hps[i], ch5Types[i], isChamp);
        this.enemies.push(enemy);
        if (isChamp) {
          this.onChampionSpawned(enemy.state.id);
          this.encounters.push({
            id: this.nextEncounterId++,
            phase: EncounterPhase.Dormant,
            championId: enemy.state.id,
            chapter: 5,
            phaseTimer: 0,
            dialogueShown: false,
            midDialogueShown: false,
            defeatDialogueShown: false,
          });
        }
      }
      this.midChapterCheckpointSaved = false;
    }
    // Chapter 5 → 6 (Lakshman's Choice): 5 warriors killed → Angad joins, Lakshman choice
    else if (this.chapter === 5 && this.chapterEnemiesKilled >= 5) {
      this.completeGoal(5);
      this.chapter = 6;
      this.chapterEnemiesKilled = 0;
      this.canMeditate = true;

      // Angad joins as companion
      const angadPos: Vec3 = { x: this.player.pos.x - 3, y: 0, z: this.player.pos.z + 3 };
      this.companions.push({
        id: 'angad', name: 'Angad', pos: angadPos,
        damage: 8, attackInterval: 2500, range: 8,
        lastAttackTime: 0, hpRegenBuff: 2, // passive +2 HP/s
        personality: 'defensive', preferredDist: 3, flanking: false,
        flankTarget: { x: 0, y: 0, z: 0 }, combatCooldown: 0,
      });
      this.onCompanionJoined('angad', 'Angad', angadPos);

      this.onChapterChange(6, "The Defector of Lanka",
        "Angad joins the righteous army. But now comes the most unexpected ally — Vibhishana, Ravana's own brother, who chose Dharma over blood. Three times he begged Ravana to return Sita. Three times he was refused. Banished from Lanka, he brings the secret that will end this war...");
      this.onMapWaypoint(this.player.pos.x, this.player.pos.z, 7, 'Angad Joined', 6);
      this.onMapReveal(this.player.pos.x, this.player.pos.z, 35, 6, 'Angad revealed Ravana\'s fortress layout');

      // Angad Dharma dialogue
      setTimeout(() => {
        this.onDialogueSequence([
          { name: 'Angad', message: "In Ravana's court, I planted my foot and declared: 'If any warrior in Lanka can lift it, Rama withdraws.' Indrajit tried. Kumbhakarna's sons tried. Even Ravana reached down. None could move me — Dharma held me rooted like Mount Meru." },
          { name: 'Angad', message: "You killed my father Vali, Lord Rama. I wept. But my mother Tara taught me: your arrow struck not from malice but from Dharma. Vali had wronged Sugriv and broken the cosmic order. I serve you because I have seen what unchecked power becomes." },
        ]);
      }, 5000);

      // Spawn Vibhishana as story NPC in Chapter 6
      const vibhishanaPos: Vec3 = { x: 40, y: 0, z: 25 };
      this.addStoryNPC({
        id: 'vibhishana', name: 'Vibhishana', pos: vibhishanaPos,
        dialogueTreeId: 'ch6_vibhishana', spoken: false,
      });

      // T4-1: Spawn Kumbhakarna mini-boss in Lanka Outskirts
      const base6 = this.CHAPTER_POSITIONS[6];
      const kbPos: Vec3 = { x: base6.x, y: 0, z: base6.z - 15 };
      const kumbha = this.createEnemy(kbPos, C.KUMBHAKARNA_HP, 'brute', true);
      kumbha.state.scale = C.KUMBHAKARNA_SCALE;
      kumbha.isKumbhakarna = true;
      kumbha.stompCdEnd = 0;
      this.enemies.push(kumbha);
      this.onChampionSpawned(kumbha.state.id);
      // Add Kumbhakarna as story NPC for dialogue before fight
      this.addStoryNPC({
        id: 'kumbhakarna', name: 'Kumbhakarna',
        pos: kbPos, dialogueTreeId: 'kumbhakarna_wake', spoken: false,
      });

      // Trigger Lakshman choice after Angad's dialogue
      setTimeout(() => {
        this.lakshmanChoice = 'pending';
        this.onLakshmanChoice();
      }, 20000);
    }
  }

  /** Called externally (from Game.ts) when Lakshman choice is made and chapter 6 rest is done */
  advanceToChapter7(): void {
    if (this.chapter !== 6) return;
    if (this.lakshmanChoice === 'pending') return; // must choose first
    this.completeGoal(6);
    this.chapter = 7;
    this.chapterEnemiesKilled = 0;
    this.canMeditate = false;
    this.stopMeditation();

    this.onChapterChange(7, "The Fall of Ravana",
      "Before you stands Lanka — the golden city that Ravana stole from his brother Kubera. Within those walls, ten-headed Ravana sits upon his throne of conquest, and Sita endures in the Ashoka Vatika. Vibhishana has revealed the secret: the Amrita in Ravana's navel sustains his ten heads. The Brahmastra must strike true. End the Adharma. Restore the balance of three worlds...");
    // Reveal the boss arena area on the map
    this.onMapWaypoint(C.BOSS_ARENA_CENTER.x, C.BOSS_ARENA_CENTER.z, 3, 'Ravana — Boss Arena', 7);
    this.onMapReveal(C.BOSS_ARENA_CENTER.x, C.BOSS_ARENA_CENTER.z, 30, 7, 'The gates of Lanka stand open — Ravana awaits');

    // Pre-battle Dharma dialogue
    setTimeout(() => {
      this.onDialogueSequence([
        { name: 'Vibhishana', message: "Lord Rama, my brother sits within. Even now, Mandodari his queen weeps at his feet, begging him to return Sita. He will not listen. His pride has consumed the scholar he once was." },
        { name: 'Rama', message: "Ravana mastered the four Vedas, performed penance that shook Kailasa, and received boons from Brahma and Shiva alike. All that tapasya, all that knowledge — undone by the theft of one innocent woman." },
        { name: 'Rama', message: "This is Dharma Yuddha — righteous war. Remember Vibhishana's words: the Amrita in his navel sustains his ten heads. When the moment comes, the Brahmastra will find its mark. May even Ravana's soul find peace through this liberation." },
      ]);
    }, 5000);

    // Auto-activate boss
    this.boss.state.phase = BossPhase.Phase1;
    this.boss.activated = true;
  }

  // ── Tutorial System ────────────────────────────────────────────
  private checkTutorialComplete(): boolean {
    const allComplete = Object.values(this.tutorialSteps).every(v => v);
    if (allComplete && !this.tutorialComplete) {
      this.tutorialComplete = true;
    }
    return this.tutorialComplete;
  }

  startBackstory(): void {
    this.backstoryInProgress = true;
    this.backstoryIndex = 0;
    this.showBackstorySlide();
  }

  private showBackstorySlide(): void {
    if (this.backstoryIndex >= this.BACKSTORY_SLIDES.length) {
      this.endBackstory();
      return;
    }
    const slide = this.BACKSTORY_SLIDES[this.backstoryIndex];
    const isLast = this.backstoryIndex === this.BACKSTORY_SLIDES.length - 1;
    this.onBackstorySlide(this.backstoryIndex, slide.speaker, slide.text, isLast);
  }

  advanceBackstory(): void {
    if (!this.backstoryInProgress) return;
    this.backstoryIndex++;
    if (this.backstoryIndex >= this.BACKSTORY_SLIDES.length) {
      this.endBackstory();
      return;
    }
    this.showBackstorySlide();
  }

  endBackstory(): void {
    this.backstoryInProgress = false;
    this.onBackstoryEnd(); // Signal Game.ts to hide the overlay and restore controls
    this.chapter = 1;
    this.chapterEnemiesKilled = 0;
    this.setupInvestigationPoints(1); // G-08: Setup investigation points for Chapter 1
    this.spawnChapter1Enemies();
    this.onChapterChange(1, "The Dandaka Forest",
      "Lord Rama steps into the ancient Dandaka — the forest where Rishis performed tapasya under Rakshasa threat. The same woods where Agastya armed you, where Surpanakha's humiliation set Ravana's rage ablaze. Every shadow here remembers...");
  }

  /** G-08: Setup investigation points for a chapter with lore-authentic clues */
  private setupInvestigationPoints(chapter: number): void {
    this.investigationPoints = [];
    const nextId = () => `inv_${chapter}_${this.investigationPoints.length + 1}`;

    if (chapter === 1) {
      // Ch1 (Dandaka Forest, base ~{x:-30, z:-100})
      this.investigationPoints.push(
        {
          id: nextId(), pos: { x: -25, z: -90, y: 0 }, chapter: 1, investigated: false,
          clueText: "Golden hoofprints in the soft earth — the demon Maricha's enchanted form. This is where the deception began, where Sita sent Rama chasing shadows."
        },
        {
          id: nextId(), pos: { x: -35, z: -110, y: 0 }, chapter: 1, investigated: false,
          clueText: "Fragments of Sita's jewelry scattered along the path — she dropped them deliberately, leaving a trail for Rama to follow. Even in captivity, she fought with wisdom."
        }
      );
    } else if (chapter === 2) {
      // Ch2 (Jatayu's Fall, base ~{x:-80, z:-200})
      this.investigationPoints.push(
        {
          id: nextId(), pos: { x: -75, z: -190, y: 0 }, chapter: 2, investigated: false,
          clueText: "Massive feathers, each as tall as a man — Jatayu's plumage. The noble vulture fought Ravana's chariot in the sky to save Sita. His sacrifice will not be forgotten."
        },
        {
          id: nextId(), pos: { x: -85, z: -210, y: 0 }, chapter: 2, investigated: false,
          clueText: "Deep ruts in the earth from Ravana's Pushpaka Vimana — his flying chariot. The tracks lead south, always south, toward Lanka across the sea."
        }
      );
    } else if (chapter === 3) {
      // Ch3 (Kishkindha, base ~{x:-150, z:-320})
      this.investigationPoints.push(
        {
          id: nextId(), pos: { x: -145, z: -310, y: 0 }, chapter: 3, investigated: false,
          clueText: "Vanara scout reports carved into bark: 'Demon patrols sighted at the southern shore. Their armor bears Ravana's ten-headed seal. They fear the crossing.'"
        },
        {
          id: nextId(), pos: { x: -155, z: -330, y: 0 }, chapter: 3, investigated: false,
          clueText: "The throne room of Kishkindha, where Vali once sat. Sugriv now rules justly, but the scratch marks on the stone tell of the brothers' terrible battle."
        }
      );
    } else if (chapter === 4) {
      // Ch4 (Southern Shore, base ~{x:-50, z:-450})
      this.investigationPoints.push(
        {
          id: nextId(), pos: { x: -45, z: -440, y: 0 }, chapter: 4, investigated: false,
          clueText: "Ocean tide patterns mapped by Nala the engineer — these calculations will guide the building of the great bridge. 'Each stone placed with devotion floats,' he wrote."
        },
        {
          id: nextId(), pos: { x: -55, z: -460, y: 0 }, chapter: 4, investigated: false,
          clueText: "Blueprints for Ram Setu etched in sand, preserved by Nala's engineering genius. The bridge will span the ocean — built not by force, but by the devotion of Rama's name inscribed on every stone."
        }
      );
    }
  }

  private spawnChapter1Enemies(): void {
    this.enemies = [];
    this.encounters = [];
    this.nextEnemyId = 1;
    const base = this.CHAPTER_POSITIONS[1];

    // Spawn 4 enemies around the chapter center with random offsets
    const chapter1Positions: Vec3[] = [
      { x: base.x - 20, y: 0, z: base.z - 20 },
      { x: base.x + 20, y: 0, z: base.z - 25 },
      { x: base.x - 30, y: 0, z: base.z + 10 },
      { x: base.x + 15, y: 0, z: base.z + 30 },
    ];
    for (let i = 0; i < chapter1Positions.length; i++) {
      const pos = chapter1Positions[i];
      const isArcher = Math.random() < 0.4;
      const type = isArcher ? 'archer' : 'soldier';
      const hp = isArcher ? C.ENEMY_ARCHER_HP : C.ENEMY_HP;
      const isChamp = (i === chapter1Positions.length - 1);
      const enemy = this.createEnemy(pos, hp, type, isChamp);
      this.enemies.push(enemy);

      // Create encounter for the champion (last enemy)
      if (isChamp) {
        this.encounters.push({
          id: this.nextEncounterId++,
          phase: EncounterPhase.Dormant,
          championId: enemy.state.id,
          chapter: 1,
          phaseTimer: 0,
          dialogueShown: false,
          midDialogueShown: false,
          defeatDialogueShown: false,
        });
        this.onChampionSpawned(enemy.state.id);
      }
    }
    this.midChapterCheckpointSaved = false;
  }

  // ── Save State Extraction (for MapRenderer save system) ──────────────────
  getSaveState(): {
    chapter: number;
    playerHp: number; playerMaxHp: number; playerStamina: number;
    playerPos: Vec3; arrowAmmo: number;
    chapterGoals: Record<number, { description: string; revealed: boolean; completed: boolean }>;
    companionIds: string[]; loneWarriorBuff: boolean;
    lakshmanChoice: 'accepted' | 'declined' | null;
    tutorialComplete: boolean;
    karma: KarmaScore;
    difficulty: Difficulty;
  } {
    return {
      chapter: this.chapter,
      playerHp: this.player.hp,
      playerMaxHp: this.player.maxHp,
      playerStamina: this.player.stamina,
      playerPos: { ...this.player.pos },
      arrowAmmo: this.arrowAmmo,
      chapterGoals: JSON.parse(JSON.stringify(this.chapterGoals)),
      companionIds: this.companions.map(c => c.id),
      loneWarriorBuff: this.loneWarriorBuff,
      lakshmanChoice: this.lakshmanChoice === 'accepted' ? 'accepted'
        : this.lakshmanChoice === 'declined' ? 'declined'
        : null,
      tutorialComplete: this.tutorialComplete,
      karma: { ...this.karma },
      difficulty: this.difficulty,
    };
  }
}

// ── Terrain height sampling (must match World.ts terrainNoise * biomeAmplitude) ──
function terrainNoise(x: number, z: number): number {
  const n1 = Math.sin(x * 0.05) * Math.cos(z * 0.05);
  const n2 = Math.sin(x * 0.13 + 2.7) * Math.cos(z * 0.11 + 1.3) * 0.5;
  return n1 + n2;
}

function biomeAmplitude(z: number): number {
  if (z > -50) return 2.5;
  if (z > -150) return 2.0;
  if (z > -250) return 3.5;
  if (z > -380) return 4.5;
  if (z > -490) return 0.8;
  if (z > -580) return 0.2;
  return 3.5;
}

function getTerrainHeight(x: number, z: number): number {
  return terrainNoise(x, z) * biomeAmplitude(z);
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
