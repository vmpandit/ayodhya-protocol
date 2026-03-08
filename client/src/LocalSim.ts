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
  respawnTime?: number;  // For tutorial dummies
  originalMaxHp?: number;  // For tutorial dummies
  behaviorTimer: number;    // Time until next behavior change
  strafeDir: number;        // 1 = clockwise, -1 = counter-clockwise
  preferredRange: number;   // Ideal combat distance (8-20)
  enemyType: 'soldier' | 'archer' | 'brute';  // Enemy type for behavior and visual differentiation
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

interface StoryNPC {
  id: string;
  name: string;
  pos: Vec3;
  dialogueTreeId: string;
  spoken: boolean;
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

  // Tutorial system (Chapter 0)
  private tutorialSteps: Record<string, boolean> = {
    move: false,
    look: false,
    shoot: false,
    dodge: false,
    sprint: false,
    specialArrow: false,
    shockwave: false,
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

  // Callbacks
  public onDamage: (targetType: DamageTargetType, targetId: number, damage: number, sourceId: number) => void = () => {};
  public onObstaclesInit: (obstacles: { pos: Vec3; radius: number }[]) => void = () => {};
  public onProjectileSpawn: (proj: ProjectileState) => void = () => {};
  public onGameOver: (won: boolean) => void = () => {};
  public onEnemySpecialArrow: (arrowName: string) => void = () => {};
  public onPickupSpawned: (id: number, pos: Vec3, arrows: number) => void = () => {};
  public onPickupCollected: (id: number) => void = () => {};
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
  public onMapReveal: (cx: number, cz: number, radius: number, chapter: number, note?: string) => void = () => {};
  public onMapWaypoint: (x: number, z: number, type: number, label: string, chapter: number) => void = () => {};
  public onEnemyDroppedMap: (enemyId: number, cx: number, cz: number, radius: number) => void = () => {};
  public onBlessingReceived: (name: string, description: string) => void = () => {};
  public onDharmaGrace: () => void = () => {};

  constructor() {
    this.player = {
      id: 1, pos: { ...C.SPAWN_POINT }, vel: { x: 0, y: 0, z: 0 }, yaw: 0,
      hp: C.PLAYER_MAX_HP, maxHp: C.PLAYER_MAX_HP, stamina: C.PLAYER_MAX_STAMINA,
      status: PlayerStatus.Alive, isDodging: false, lastProcessedSeq: 0,
    };

    this.previousYaw = 0;

    // Chapter 0 (Tutorial): Spawn 3 training dummies that don't attack
    const tutorialDummyPositions: Vec3[] = [
      { x: 5, y: 0, z: -8 },
      { x: -6, y: 0, z: -12 },
      { x: 8, y: 0, z: -15 },
    ];
    for (const pos of tutorialDummyPositions) {
      const id = this.nextEnemyId++;
      this.enemies.push({
        state: { id, pos: { ...pos }, yaw: 0, hp: 30, maxHp: 30, aiState: EnemyAIState.Patrol, targetId: 0 },
        patrolOrigin: { ...pos }, patrolAngle: Math.random() * Math.PI * 2,
        meleeCdEnd: 0, rangedCdEnd: 0,
        originalMaxHp: 30,
        behaviorTimer: 0,
        strafeDir: Math.random() > 0.5 ? 1 : -1,
        preferredRange: 10 + Math.random() * 10,
        enemyType: 'soldier',
      });
    }

    // Spawn Sage Agastya as story NPC in Chapter 0 (tutorial guide)
    const sagePos: Vec3 = { x: -5, y: 0, z: -10 };
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
    };

    // Initialize obstacles in the world
    this.onObstaclesInit(this.obstacles);
  }

  get playerId(): number { return 1; }

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
  startDialogue(treeId: string): void {
    const tree = DIALOGUE_TREES[treeId];
    if (!tree) {
      console.warn(`[LocalSim] Dialogue tree not found: ${treeId}`);
      return;
    }
    this.currentDialogueTree = tree;
    this.currentDialogueNodeId = tree.startNodeId;
    this.dialogueInProgress = true;

    const node = tree.nodes[tree.startNodeId];
    if (node) {
      const isEnd = !node.choices || node.choices.length === 0;
      this.onDialogueNode(node, isEnd);
    }
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

      // Auto-end dialogue if this is the last node (no more choices)
      if (isEnd) {
        setTimeout(() => {
          this.endDialogue();
        }, 5000);
      }
    }
  }

  endDialogue(): void {
    if (!this.dialogueInProgress) return;

    // Mark the NPC as spoken to and reveal map area
    if (this.nearbyNPCId) {
      const npc = this.storyNPCs.find(n => n.id === this.nearbyNPCId);
      if (npc) {
        npc.spoken = true;
        // Apply blessing from this NPC
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
    };
    const b = blessingMap[npcId];
    if (b && !this.blessings.has(b.key)) {
      this.blessings.add(b.key);
      b.apply();
      this.onBlessingReceived(b.name, b.desc);
    }
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

    // Push player out of obstacles
    this.pushOutOfObstacles(this.player.pos);

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
      const dir: Vec3 = input.aimDir ?? {
        x: -Math.sin(input.yaw) * Math.cos(input.pitch),
        y: Math.sin(input.pitch),
        z: -Math.cos(input.yaw) * Math.cos(input.pitch),
      };
      this.arrowAmmo--;
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
    if (this.isMeditating) return;

    const mult = this.damageMultiplier;

    // ── Tutorial tracking (Chapter 0) ──────────────────────────────
    if (this.chapter === 0 && !this.tutorialComplete) {
      if (ability === AbilityType.FireArrow && !this.tutorialSteps.specialArrow) {
        this.tutorialSteps.specialArrow = true;
        this.onTutorialStep('specialArrow', this.checkTutorialComplete());
      }
      if (ability === AbilityType.Shockwave && !this.tutorialSteps.shockwave) {
        this.tutorialSteps.shockwave = true;
        this.onTutorialStep('shockwave', this.checkTutorialComplete());
      }
    }

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
    const now = performance.now();
    for (const enemy of this.enemies) {
      if (enemy.state.aiState === EnemyAIState.Dead) continue;
      if (dist3(origin, enemy.state.pos) <= C.SHOCKWAVE_RADIUS) {
        let dmg = C.SHOCKWAVE_DAMAGE * mult;
        if (now < this.dharmaGraceEnd) dmg *= 1.5;
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
        let dmg = C.SHOCKWAVE_DAMAGE * mult * this.bossDamageMultiplier;
        if (now < this.dharmaGraceEnd) dmg *= 1.5;
        this.boss.state.hp -= dmg;
        this.onDamage(DamageTargetType.Boss, 0, dmg, 1);
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

    // ── Check story NPC proximity ────────────────────────────────
    this.nearbyNPCId = null;
    for (const npc of this.storyNPCs) {
      const dist = dist3(this.player.pos, npc.pos);
      if (!npc.spoken && dist < 5) {
        // Set nearby NPC for "Press F to Talk" prompt
        this.nearbyNPCId = npc.id;
        this.onNPCNearby(npc.id, npc.name);
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

      // Player arrows hit enemies/boss
      if (proj.state.type === ProjectileType.Arrow || proj.state.type === ProjectileType.FireArrow ||
          proj.state.type === ProjectileType.VayuAstra || proj.state.type === ProjectileType.VarunaAstra ||
          proj.state.type === ProjectileType.NagaAstra || proj.state.type === ProjectileType.BrahmaAstra) {
        for (const enemy of this.enemies) {
          if (enemy.state.aiState === EnemyAIState.Dead) continue;
          if (dist3(proj.state.pos, enemy.state.pos) < 1.2) {
            let dmg = proj.state.damage;
            if (now < this.dharmaGraceEnd) dmg *= 1.5;
            enemy.state.hp -= dmg;
            this.onDamage(DamageTargetType.Enemy, enemy.state.id, dmg, 1);
            if (enemy.state.hp <= 0) {
              enemy.state.hp = 0;
              enemy.state.aiState = EnemyAIState.Dead;
              this.chapterEnemiesKilled++;
              // Tutorial dummies respawn after 3 seconds; others drop pickups
              if (this.chapter === 0 && enemy.originalMaxHp === 30) {
                enemy.respawnTime = now + 3000;
              } else {
                this.spawnPickup(enemy.state.pos);
              }
              this.checkChapterProgress();
            }
            projToRemove.push(id); break;
          }
        }
        if (projToRemove.includes(id)) continue;
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
      }

      // Enemy/boss projectiles hit player
      if (proj.state.type === ProjectileType.EnemyProjectile || proj.state.type === ProjectileType.BossProjectile ||
          proj.state.type === ProjectileType.EnemyAgniAstra || proj.state.type === ProjectileType.EnemyVayuAstra ||
          proj.state.type === ProjectileType.EnemyNagaAstra) {
        if (this.player.status === PlayerStatus.Alive) {
          if (dist3(proj.state.pos, this.player.pos) < 1.0) {
            if (this.player.isDodging) {
              // Perfect dodge activates Dharma's Grace
              this.dharmaGraceEnd = now + 2000;
              this.onDharmaGrace();
            } else {
              this.damagePlayer(proj.state.damage, proj.state.ownerId);
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
      for (const enemy of this.enemies) {
        if (enemy.state.aiState === EnemyAIState.Dead && enemy.respawnTime !== undefined) {
          if (now >= enemy.respawnTime) {
            // Respawn the dummy
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
            const dmg = comp.damage * this.bossDamageMultiplier;
            this.boss.state.hp -= dmg;
            this.onDamage(DamageTargetType.Boss, 0, dmg, 100);
            this.checkBossPhase();
            comp.lastAttackTime = now;
          }
        }
      }
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
    this.onChapterChange(4, "The March to the Sea",
      "With Sugriv's Vanara armies at your command, the march south begins. Jambavan the immortal bear-king and Sampati the wingless vulture await — ancient witnesses who carry wisdom no warrior can. But Ravana's demon scouts infest the path...");

    // Spawn Jambavan as story NPC in Chapter 4
    const jambPos: Vec3 = { x: -40, y: 0, z: -95 };
    this.addStoryNPC({
      id: 'jambavan', name: 'Jambavan', pos: jambPos,
      dialogueTreeId: 'ch4_jambavan', spoken: false,
    });

    // Spawn Sampati as story NPC in Chapter 4
    const sampatiPos: Vec3 = { x: 15, y: 0, z: -105 };
    this.addStoryNPC({
      id: 'sampati', name: 'Sampati', pos: sampatiPos,
      dialogueTreeId: 'ch4_sampati', spoken: false,
    });
    this.onMapWaypoint(jambPos.x, jambPos.z, 1, 'Jambavan', 4);
    this.onMapWaypoint(sampatiPos.x, sampatiPos.z, 1, 'Sampati', 4);

    // Spawn 5 demon scouts in shore area
    // Mix: 40% soldier, 30% archer, 30% brute
    const ch4Positions: Vec3[] = [
      { x: -30, y: 0, z: -85 }, { x: 20, y: 0, z: -90 },
      { x: 0, y: 0, z: -100 }, { x: -45, y: 0, z: -75 },
      { x: 35, y: 0, z: -80 },
    ];
    for (const pos of ch4Positions) {
      const id = this.nextEnemyId++;
      const rand = Math.random();
      let enemyType: 'soldier' | 'archer' | 'brute';
      let hp: number;
      let preferredRange: number;

      if (rand < 0.4) {
        // Soldier
        enemyType = 'soldier';
        hp = 70;
        preferredRange = 10 + Math.random() * 10;
      } else if (rand < 0.7) {
        // Archer
        enemyType = 'archer';
        hp = C.ENEMY_ARCHER_HP;
        preferredRange = 20 + Math.random() * 5;
      } else {
        // Brute
        enemyType = 'brute';
        hp = C.ENEMY_BRUTE_HP;
        preferredRange = 3 + Math.random() * 2;
      }

      this.enemies.push({
        state: { id, pos: { ...pos }, yaw: 0, hp, maxHp: hp, aiState: EnemyAIState.Patrol, targetId: 0 },
        patrolOrigin: { ...pos }, patrolAngle: Math.random() * Math.PI * 2,
        meleeCdEnd: 0, rangedCdEnd: 0,
        behaviorTimer: 0,
        strafeDir: Math.random() > 0.5 ? 1 : -1,
        preferredRange,
        enemyType,
      });
    }
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
      const nearestDist = dist3(enemy.state.pos, this.player.pos);

      // Update behavior timer
      enemy.behaviorTimer -= dt;

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
        if (this.chapter !== 0 && this.player.status === PlayerStatus.Alive && nearestDist < C.ENEMY_AGGRO_RANGE) {
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

        if (nearestDist <= meleeRange) {
          if (now >= enemy.meleeCdEnd && !this.player.isDodging) {
            this.damagePlayer(meleeDamage, 200 + enemy.state.id);
            enemy.meleeCdEnd = now + meleeCooldown;
            // 20% chance to trigger retreat after melee
            if (Math.random() < 0.2) {
              enemy.state.aiState = EnemyAIState.Retreat;
              enemy.behaviorTimer = 1.5 + Math.random() * 2;
            }
          }
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
    if (b.hp <= 0) {
      b.hp = 0;
      b.phase = BossPhase.Dead;
      this.completeGoal(7);
      this.onGameOver(true);
      return;
    }
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

    // 35% chance enemy drops a map fragment revealing nearby area
    if (Math.random() < 0.35) {
      const revealRadius = 15 + Math.random() * 15; // 15-30 world units
      const cx = pos.x + (Math.random() - 0.5) * 20;
      const cz = pos.z + (Math.random() - 0.5) * 20;
      this.onEnemyDroppedMap(0, cx, cz, revealRadius);
      this.onMapWaypoint(pos.x, pos.z, 2, 'Fallen Sentinel', this.chapter); // EnemyCamp = 2
    }
  }

  private checkChapterProgress(): void {
    // Chapter 1 → 2: 4 sentinels killed
    if (this.chapter === 1 && this.chapterEnemiesKilled >= 4) {
      this.completeGoal(1);
      this.chapter = 2;
      this.chapterEnemiesKilled = 0;
      this.onChapterChange(2, "Jatayu's Legacy", "Beyond the fallen sentinels lies the place where noble Jatayu gave his life defending Sita. Ravana's Demon Guard patrol these bloodied grounds — elite warriors who sold their honour for power. Avenge the vulture king...");
      this.onMapWaypoint(0, 0, 6, 'Chapter 2 — Jatayu\'s Legacy', 2); // ChapterGate = 6
      this.onMapReveal(0, -20, 25, 2, 'The Demon Guard patrols were mapped from battle');

      // Spawn Jatayu's Spirit as story NPC in Chapter 2
      const jatayuPos: Vec3 = { x: -20, y: 0, z: -55 };
      this.addStoryNPC({
        id: 'jatayu', name: 'Spirit of Jatayu', pos: jatayuPos,
        dialogueTreeId: 'ch2_jatayu', spoken: false,
      });

      // Spawn 4 tougher enemies for chapter 2 (south scorched zone)
      // Mix: 60% soldier, 40% archer
      const chapter2Positions: Vec3[] = [
        { x: -25, y: 0, z: -50 }, { x: 15, y: 0, z: -60 },
        { x: -10, y: 0, z: -70 }, { x: 30, y: 0, z: -55 },
      ];
      for (const pos of chapter2Positions) {
        const id = this.nextEnemyId++;
        const rand = Math.random();
        const isArcher = rand < 0.4;

        if (isArcher) {
          this.enemies.push({
            state: { id, pos: { ...pos }, yaw: 0, hp: C.ENEMY_ARCHER_HP, maxHp: C.ENEMY_ARCHER_HP, aiState: EnemyAIState.Patrol, targetId: 0 },
            patrolOrigin: { ...pos }, patrolAngle: Math.random() * Math.PI * 2,
            meleeCdEnd: 0, rangedCdEnd: 0,
            behaviorTimer: 0,
            strafeDir: Math.random() > 0.5 ? 1 : -1,
            preferredRange: 20 + Math.random() * 5,
            enemyType: 'archer',
          });
        } else {
          this.enemies.push({
            state: { id, pos: { ...pos }, yaw: 0, hp: 80, maxHp: 80, aiState: EnemyAIState.Patrol, targetId: 0 },
            patrolOrigin: { ...pos }, patrolAngle: Math.random() * Math.PI * 2,
            meleeCdEnd: 0, rangedCdEnd: 0,
            behaviorTimer: 0,
            strafeDir: Math.random() > 0.5 ? 1 : -1,
            preferredRange: 10 + Math.random() * 10,
            enemyType: 'soldier',
          });
        }
      }
    }
    // Chapter 2 → 3 (Kishkindha — meet Sugriv): 4 elites killed
    else if (this.chapter === 2 && this.chapterEnemiesKilled >= 4) {
      this.completeGoal(2);
      this.chapter = 3;
      this.chapterEnemiesKilled = 0;
      this.canMeditate = true;
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
      });
      this.onCompanionJoined('hanuman', 'Hanuman', hanumanPos);

      this.onChapterChange(5, "Angad's Embassy",
        "Hanuman, who leapt across the ocean and set Lanka ablaze with his burning tail, now fights at your side. But first — Angad, son of the slain Vali, returns from Ravana's court. He planted his foot before the demon throne and none could move it. His loyalty to you transcends the grief of his father's death...");
      this.onMapWaypoint(this.player.pos.x, this.player.pos.z, 7, 'Hanuman Joined', 5);
      this.onMapReveal(this.player.pos.x, this.player.pos.z, 30, 5, 'Hanuman scouted the demon positions ahead');

      // Spawn Angad as story NPC in Chapter 5
      const angadNpcPos: Vec3 = { x: 55, y: 0, z: -35 };
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

      // Spawn 5 elite demon warriors in eastern march
      // Mix: 20% soldier, 40% archer, 40% brute
      const ch5Positions: Vec3[] = [
        { x: 35, y: 0, z: -45 }, { x: 60, y: 0, z: -25 },
        { x: 45, y: 0, z: -55 }, { x: 70, y: 0, z: -10 },
        { x: 55, y: 0, z: -60 },
      ];
      for (const pos of ch5Positions) {
        const id = this.nextEnemyId++;
        const rand = Math.random();
        let enemyType: 'soldier' | 'archer' | 'brute';
        let hp: number;
        let preferredRange: number;

        if (rand < 0.2) {
          // Soldier
          enemyType = 'soldier';
          hp = 90;
          preferredRange = 10 + Math.random() * 10;
        } else if (rand < 0.6) {
          // Archer
          enemyType = 'archer';
          hp = C.ENEMY_ARCHER_HP;
          preferredRange = 20 + Math.random() * 5;
        } else {
          // Brute
          enemyType = 'brute';
          hp = C.ENEMY_BRUTE_HP;
          preferredRange = 3 + Math.random() * 2;
        }

        this.enemies.push({
          state: { id, pos: { ...pos }, yaw: 0, hp, maxHp: hp, aiState: EnemyAIState.Patrol, targetId: 0 },
          patrolOrigin: { ...pos }, patrolAngle: Math.random() * Math.PI * 2,
          meleeCdEnd: 0, rangedCdEnd: 0,
          behaviorTimer: 0,
          strafeDir: Math.random() > 0.5 ? 1 : -1,
          preferredRange,
          enemyType,
        });
      }
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
    this.chapter = 1;
    this.chapterEnemiesKilled = 0;
    this.spawnChapter1Enemies();
    this.onChapterChange(1, "The Dandaka Forest",
      "Lord Rama steps into the ancient Dandaka — the forest where Rishis performed tapasya under Rakshasa threat. The same woods where Agastya armed you, where Surpanakha's humiliation set Ravana's rage ablaze. Every shadow here remembers...");
  }

  private spawnChapter1Enemies(): void {
    // Clear tutorial dummies
    this.enemies = [];
    this.nextEnemyId = 1;

    // Spawn Chapter 1 enemies
    // Mix: 60% soldier, 40% archer
    const chapter1Positions: Vec3[] = [
      { x: -20, y: 0, z: -20 }, { x: 20, y: 0, z: -25 },
      { x: -30, y: 0, z: 10 }, { x: 15, y: 0, z: 30 },
    ];
    for (const pos of chapter1Positions) {
      const id = this.nextEnemyId++;
      const rand = Math.random();
      const isArcher = rand < 0.4;

      if (isArcher) {
        this.enemies.push({
          state: { id, pos: { ...pos }, yaw: 0, hp: C.ENEMY_ARCHER_HP, maxHp: C.ENEMY_ARCHER_HP, aiState: EnemyAIState.Patrol, targetId: 0 },
          patrolOrigin: { ...pos }, patrolAngle: Math.random() * Math.PI * 2,
          meleeCdEnd: 0, rangedCdEnd: 0,
          behaviorTimer: 0,
          strafeDir: Math.random() > 0.5 ? 1 : -1,
          preferredRange: 20 + Math.random() * 5,
          enemyType: 'archer',
        });
      } else {
        this.enemies.push({
          state: { id, pos: { ...pos }, yaw: 0, hp: C.ENEMY_HP, maxHp: C.ENEMY_HP, aiState: EnemyAIState.Patrol, targetId: 0 },
          patrolOrigin: { ...pos }, patrolAngle: Math.random() * Math.PI * 2,
          meleeCdEnd: 0, rangedCdEnd: 0,
          behaviorTimer: 0,
          strafeDir: Math.random() > 0.5 ? 1 : -1,
          preferredRange: 10 + Math.random() * 10,
          enemyType: 'soldier',
        });
      }
    }
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
    };
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
