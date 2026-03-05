// ── Ayodhya Protocol: Lanka Reforged ── Ramayana Dialogue Trees ──
// Pre-authored branching dialogue with Dharma-aligned choices and goal revelation.

export interface DialogueChoice {
  label: string;
  nextNodeId: string;
  revealsGoal?: boolean;  // if true, selecting this reveals the chapter goal
}

export interface DialogueNode {
  id: string;
  speaker: string;
  text: string;
  choices?: DialogueChoice[];  // if no choices, dialogue ends after this node
}

export interface DialogueTree {
  startNodeId: string;
  nodes: Record<string, DialogueNode>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chapter 1: Sage Agastya — guides Rama on his righteous path
// ─────────────────────────────────────────────────────────────────────────────
const ch1_sage_tree: DialogueTree = {
  startNodeId: 'sage_greet',
  nodes: {
    sage_greet: {
      id: 'sage_greet',
      speaker: 'Sage Agastya',
      text: "Namaste, Lord Rama. The jungle whispers of your arrival. Tell me — what brings the righteous heir of Ayodhya to this wilderness? What is your purpose?",
      choices: [
        {
          label: 'To fulfill my Dharma and rescue Sita',
          nextNodeId: 'sage_dharma_correct',
          revealsGoal: true,
        },
        {
          label: 'To wage war on the demons',
          nextNodeId: 'sage_war_hint',
        },
        {
          label: 'I seek counsel, wise one',
          nextNodeId: 'sage_cryptic',
        },
      ],
    },
    sage_dharma_correct: {
      id: 'sage_dharma_correct',
      speaker: 'Sage Agastya',
      text: "Dharma — yes, you understand the deepest truth. Rescue Sita, restore righteous order, and uphold the sacred duty of a husband and a prince. The path will test your courage, but it aligns with the cosmos itself.",
      choices: [
        {
          label: 'What can you tell me of the dangers ahead?',
          nextNodeId: 'sage_sentinels',
        },
      ],
    },
    sage_sentinels: {
      id: 'sage_sentinels',
      speaker: 'Sage Agastya',
      text: "Beware the sentinels that guard Lanka's approaches. They are swift and vicious, scattered across the jungle. Defeat them to prove your readiness. Some carry weapons of fire and stone — stay alert.",
      // No choices, dialogue ends
    },
    sage_war_hint: {
      id: 'sage_war_hint',
      speaker: 'Sage Agastya',
      text: "War, you say? Rama, dharma is not mere destruction. The true victory comes when you defend what is righteous — when you rescue the innocent and restore cosmic order. Focus not on waging war, but on fulfilling your sacred duty.",
      choices: [
        {
          label: 'You are right — I must rescue Sita first',
          nextNodeId: 'sage_dharma_correct',
          revealsGoal: true,
        },
      ],
    },
    sage_cryptic: {
      id: 'sage_cryptic',
      speaker: 'Sage Agastya',
      text: "Ah, the seeker finds wisdom in uncertainty. Listen then: Your path is already written in the stars. A woman waits for you, imprisoned by an evil king. Your courage and duty will light the way.",
      // No choices, dialogue ends
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Chapter 3: Sugriv — The Vanara king repays the bond of dharma
// ─────────────────────────────────────────────────────────────────────────────
const ch3_sugriv_tree: DialogueTree = {
  startNodeId: 'sugriv_recognition',
  nodes: {
    sugriv_recognition: {
      id: 'sugriv_recognition',
      speaker: 'Sugriv, King of Kishkindha',
      text: "Lord Rama! I recognize you — the one who restored my throne when Vali's tyranny crushed my kingdom. You upheld dharma when all seemed lost. Now I hear you face a darker trial. What brings you to seek an alliance with the Vanara nation?",
      choices: [
        {
          label: 'To rescue Sita and restore dharma',
          nextNodeId: 'sugriv_alliance_full',
          revealsGoal: true,
        },
        {
          label: 'To destroy Ravana',
          nextNodeId: 'sugriv_caution',
        },
        {
          label: 'Who are you, mighty king?',
          nextNodeId: 'sugriv_story',
        },
      ],
    },
    sugriv_alliance_full: {
      id: 'sugriv_alliance_full',
      speaker: 'Sugriv, King of Kishkindha',
      text: "Sita Devi — held by Ravana in Lanka's golden palace. You honor the sacred bonds of marriage and duty. The Vanara kingdom pledges our strength to you. My warriors Hanuman and Angad shall aid your righteous cause. Together, we will bring her home.",
      choices: [
        {
          label: 'Your loyalty is a beacon of dharma',
          nextNodeId: 'sugriv_meditate',
        },
      ],
    },
    sugriv_meditate: {
      id: 'sugriv_meditate',
      speaker: 'Sugriv, King of Kishkindha',
      text: "Rest here in Kishkindha, gather your strength. In stillness the warrior finds clarity. Meditate — let your purpose sharpen like the edge of an arrow. Press M to enter meditation.",
      // No choices, dialogue ends
    },
    sugriv_caution: {
      id: 'sugriv_caution',
      speaker: 'Sugriv, King of Kishkindha',
      text: "Destruction? Beware, noble one. Ravana's defeat is necessary, but dharma demands we first rescue the innocent — Sita, your beloved. Vengeance without purpose is adharma itself. Restore her first; the rest will follow.",
      choices: [
        {
          label: 'You are wise — rescue comes first',
          nextNodeId: 'sugriv_alliance_full',
          revealsGoal: true,
        },
      ],
    },
    sugriv_story: {
      id: 'sugriv_story',
      speaker: 'Sugriv, King of Kishkindha',
      text: "I am Sugriv, rightful king of Kishkindha, land of the Vanara — the noble monkey race. Once my throne was stolen by my brother Vali. You restored it when all seemed lost. That debt of gratitude binds me to you forever.",
      choices: [
        {
          label: 'And now I ask for your aid in rescuing Sita',
          nextNodeId: 'sugriv_alliance_full',
          revealsGoal: true,
        },
      ],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Chapter 4: Hanuman — Wisdom about Lanka's defenses and patience
// ─────────────────────────────────────────────────────────────────────────────
const ch4_hanuman_tree: DialogueTree = {
  startNodeId: 'hanuman_greet',
  nodes: {
    hanuman_greet: {
      id: 'hanuman_greet',
      speaker: 'Hanuman',
      text: "Lord Rama, I am Hanuman, devoted servant of Sugriv and your faithful ally. I have crossed the sea to find Sita Devi in Ravana's palace. Now I return to aid you. What would you know of Lanka?",
      choices: [
        {
          label: 'What can you tell me of Lanka\'s defenses?',
          nextNodeId: 'hanuman_strategic',
          revealsGoal: true,
        },
        {
          label: 'We should attack immediately',
          nextNodeId: 'hanuman_patience',
        },
        {
          label: 'Tell me of your journey to find Sita',
          nextNodeId: 'hanuman_story',
        },
      ],
    },
    hanuman_strategic: {
      id: 'hanuman_strategic',
      speaker: 'Hanuman',
      text: "I have seen Lanka's fortifications with my own eyes. Ravana commands a vast army — demons, rakshasas, warriors of great strength. But know this: Ravana relies on his pride and the power of his palace. Strategy and courage will prevail where foolish haste would fail.",
      choices: [
        {
          label: 'Your wisdom guides us',
          nextNodeId: 'hanuman_strength',
        },
      ],
    },
    hanuman_strength: {
      id: 'hanuman_strength',
      speaker: 'Hanuman',
      text: "You must grow stronger before facing Ravana directly. Each enemy you defeat here strengthens your resolve and your power. Prepare yourself — meditate, gather allies, sharpen your skills. When you are ready, Lanka will tremble.",
      // No choices, dialogue ends
    },
    hanuman_patience: {
      id: 'hanuman_patience',
      speaker: 'Hanuman',
      text: "Patience, noble one! A warrior who charges without knowing his enemy is a warrior who falls. Ravana's palace is mightier than you imagine. We must prepare — train your strength, gather allies, and move with purpose, not haste.",
      choices: [
        {
          label: 'I will prepare myself',
          nextNodeId: 'hanuman_strategic',
          revealsGoal: true,
        },
      ],
    },
    hanuman_story: {
      id: 'hanuman_story',
      speaker: 'Hanuman',
      text: "My journey was long and perilous. I leaped the waters of the sea, crossed demon-guarded lands, and found Sita Devi in Ravana's palace. I saw her devotion to you — her heart remains pure and faithful. Now I have returned to help restore her to your side.",
      choices: [
        {
          label: 'And you bring news of Lanka\'s strength',
          nextNodeId: 'hanuman_strategic',
          revealsGoal: true,
        },
      ],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Chapter 5: Angad — Ravana's pride as his weakness
// ─────────────────────────────────────────────────────────────────────────────
const ch5_angad_tree: DialogueTree = {
  startNodeId: 'angad_report',
  nodes: {
    angad_report: {
      id: 'angad_report',
      speaker: 'Angad, Prince of Kishkindha',
      text: "Lord Rama, I have just returned from Ravana's court where I carried Sugriv's ultimatum. I stood before the demon king himself and witnessed his power — but also his nature. What would you ask of me?",
      choices: [
        {
          label: 'What weakness does Ravana have?',
          nextNodeId: 'angad_pride',
          revealsGoal: true,
        },
        {
          label: 'How large is his army?',
          nextNodeId: 'angad_army',
        },
        {
          label: 'Did you truly challenge Ravana\'s court?',
          nextNodeId: 'angad_heroic',
        },
      ],
    },
    angad_pride: {
      id: 'angad_pride',
      speaker: 'Angad, Prince of Kishkindha',
      text: "His weakness? Pride, Lord Rama — overwhelming, unshakeable pride. Ravana believes himself invincible, beyond the reach of any mortal or god. He thinks himself the master of destiny itself. But pride precedes the fall. It clouds judgment and breeds arrogance.",
      choices: [
        {
          label: 'Then I will exploit this weakness',
          nextNodeId: 'angad_exploit',
        },
      ],
    },
    angad_exploit: {
      id: 'angad_exploit',
      speaker: 'Angad, Prince of Kishkindha',
      text: "Face him without fear, and let your righteousness shine. Ravana cannot comprehend a foe who fights not for conquest, but for dharma. This contradiction will confound him. Strike with clarity and purpose — his pride will be his undoing.",
      // No choices, dialogue ends
    },
    angad_army: {
      id: 'angad_army',
      speaker: 'Angad, Prince of Kishkindha',
      text: "An army of thousands — rakshasas, demons, warriors of terrible strength. But numbers alone do not guarantee victory. What matters is the spirit of the fighters and the righteousness of the cause.",
      // No choices, dialogue ends
    },
    angad_heroic: {
      id: 'angad_heroic',
      speaker: 'Angad, Prince of Kishkindha',
      text: "Yes! I stood in Ravana's throne room and called for him to release Sita and restore dharma. When he refused, I challenged him — though I am merely a prince and he a king of demons. My courage came from serving a righteous cause. That is the strength you carry now.",
      choices: [
        {
          label: 'Your bravery inspires me',
          nextNodeId: 'angad_pride',
          revealsGoal: true,
        },
      ],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Chapter 6: Vibhishana — Ravana's brother who defected (reveals how to defeat Ravana)
// ─────────────────────────────────────────────────────────────────────────────
const ch6_vibhishana_tree: DialogueTree = {
  startNodeId: 'vibhishana_introduction',
  nodes: {
    vibhishana_introduction: {
      id: 'vibhishana_introduction',
      speaker: 'Vibhishana, Brother of Ravana',
      text: "I am Vibhishana, Ravana's own brother. I have abandoned Lanka and come to aid you, Lord Rama. My brother's adharma — his unrighteousness — has poisoned our kingdom. I choose to stand with dharma. What would you know?",
      choices: [
        {
          label: 'Tell me how to defeat Ravana, brother of my enemy',
          nextNodeId: 'vibhishana_combat',
          revealsGoal: true,
        },
        {
          label: 'Why did you betray your own brother?',
          nextNodeId: 'vibhishana_dharma_choice',
        },
        {
          label: 'Can Ravana be reasoned with?',
          nextNodeId: 'vibhishana_reason',
        },
      ],
    },
    vibhishana_combat: {
      id: 'vibhishana_combat',
      speaker: 'Vibhishana, Brother of Ravana',
      text: "My brother is a warrior of unmatched skill. He commands magic and has drunk the boon of immunity — no weapon forged can pierce his skin. But there is one thing: his ambition. He must see you as a worthy foe, must engage you directly. When he does, use your righteousness as a shield and your dharma as your blade.",
      choices: [
        {
          label: 'I understand — I will face him with courage',
          nextNodeId: 'vibhishana_power',
        },
      ],
    },
    vibhishana_power: {
      id: 'vibhishana_power',
      speaker: 'Vibhishana, Brother of Ravana',
      text: "The power within you — granted by the gods themselves for your dharma — surpasses any magic my brother wields. Meditate, gather your strength, master your astras. When you face him, you will not be alone. The heavens themselves stand with you.",
      // No choices, dialogue ends
    },
    vibhishana_dharma_choice: {
      id: 'vibhishana_dharma_choice',
      speaker: 'Vibhishana, Brother of Ravana',
      text: "I chose dharma over blood. My brother has forsaken righteousness — he hoards power, enslaves innocents, and defies the gods themselves. A brother who walks the path of adharma is no true brother. I must stand with what is right.",
      choices: [
        {
          label: 'Your wisdom transcends loyalty to blood',
          nextNodeId: 'vibhishana_combat',
          revealsGoal: true,
        },
      ],
    },
    vibhishana_reason: {
      id: 'vibhishana_reason',
      speaker: 'Vibhishana, Brother of Ravana',
      text: "Ravana cannot be reasoned with. His pride has grown so vast that he no longer listens to wisdom — not even from his own advisors. He believes himself beyond morality, beyond the gods themselves. Only his defeat will restore balance.",
      choices: [
        {
          label: 'Then I will defeat him with my whole strength',
          nextNodeId: 'vibhishana_combat',
          revealsGoal: true,
        },
      ],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Export all dialogue trees
// ─────────────────────────────────────────────────────────────────────────────

export const DIALOGUE_TREES: Record<string, DialogueTree> = {
  ch1_sage: ch1_sage_tree,
  ch3_sugriv: ch3_sugriv_tree,
  ch4_hanuman: ch4_hanuman_tree,
  ch5_angad: ch5_angad_tree,
  ch6_vibhishana: ch6_vibhishana_tree,
};
