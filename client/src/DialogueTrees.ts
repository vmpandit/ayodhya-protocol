// ── Ayodhya Protocol: Lanka Reforged ── Ramayana Dialogue Trees ──
// Branching dialogue rooted in the Valmiki Ramayana and Tulsidas Ramcharitmanas.
// Each NPC voice reflects their role in the epic — sage, warrior, devotee, defector.

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
// Chapter 0/1: Sage Agastya — the wandering rishi who gave Rama divine weapons
// In the Ramayana, Agastya gifted Rama the Brahmastra and Vaishnavastra in the
// Dandaka forest, and foretold Ravana's doom.
// ─────────────────────────────────────────────────────────────────────────────
const ch1_sage_tree: DialogueTree = {
  startNodeId: 'sage_greet',
  nodes: {
    sage_greet: {
      id: 'sage_greet',
      speaker: 'Sage Agastya',
      text: "Namaste, Prince of Ayodhya. I have waited for you. The stars foretold that Dasharatha's eldest son would one day stand at the threshold of Lanka. Tell me — what carries you forward through this exile?",
      choices: [
        {
          label: 'My duty to Sita and to Dharma',
          nextNodeId: 'sage_dharma_path',
          revealsGoal: true,
        },
        {
          label: 'Rage at Ravana for what he has done',
          nextNodeId: 'sage_anger_counsel',
        },
        {
          label: 'I seek your blessing, Maharishi',
          nextNodeId: 'sage_blessing',
        },
      ],
    },
    sage_dharma_path: {
      id: 'sage_dharma_path',
      speaker: 'Sage Agastya',
      text: "You speak like the son of Kausalya — with the clarity of one who has not forgotten his sacred thread. Sita waits in the Ashoka Vatika, Ravana's garden-prison. She keeps the sacred fire of your love burning even in captivity. Your path lies through Lanka's forest sentinels. They guard the southern approach.",
      choices: [
        {
          label: 'What weapons do you offer me, Guru?',
          nextNodeId: 'sage_weapons',
        },
        {
          label: 'Tell me of these sentinels',
          nextNodeId: 'sage_sentinels',
        },
      ],
    },
    sage_weapons: {
      id: 'sage_weapons',
      speaker: 'Sage Agastya',
      text: "Long ago I received celestial Astras from Vishnu himself — weapons of the divine order. The Agni Astra, born of sacred fire. The Vayu Astra, swift as Hanuman's father. The Brahmastra, which cannot miss its mark. These are not weapons of anger, Rama — they are instruments of Dharma. Use them as such, and they will never fail you.",
      choices: [
        {
          label: 'I will wield them with righteousness',
          nextNodeId: 'sage_sentinels',
        },
      ],
    },
    sage_sentinels: {
      id: 'sage_sentinels',
      speaker: 'Sage Agastya',
      text: "Ravana's Rakshasa sentinels guard the forest perimeter — shapeshifters who thrive in shadow. They are no match for a prince who walks the path of truth. Defeat them, and the way to Kishkindha opens. There, old debts will be repaid.",
    },
    sage_anger_counsel: {
      id: 'sage_anger_counsel',
      speaker: 'Sage Agastya',
      text: "Ah, child. I understand your fury — Ravana stole your wife through vile deception while you were lured away. But hear me: Krodha — anger — is the weapon of Adharma. It was rage that drove Ravana to abduct Sita. Do not mirror his failing. Fight with purpose, not with passion.",
      choices: [
        {
          label: 'You are right. My purpose is Dharma, not revenge.',
          nextNodeId: 'sage_dharma_path',
          revealsGoal: true,
        },
        {
          label: 'How do I control this anger?',
          nextNodeId: 'sage_control',
        },
      ],
    },
    sage_control: {
      id: 'sage_control',
      speaker: 'Sage Agastya',
      text: "Through Dhyana — meditation. Your father Dasharatha, your guru Vasishtha, your beloved Sita — all taught you by example. Still your mind, focus your breath, and let the fire within become a steady flame, not a wildfire. The warrior who masters himself first masters the battlefield.",
      choices: [
        {
          label: 'I will remember this wisdom',
          nextNodeId: 'sage_sentinels',
        },
      ],
    },
    sage_blessing: {
      id: 'sage_blessing',
      speaker: 'Sage Agastya',
      text: "A blessing? You who carry the blessing of Vishnu himself ask for mine? Very well: May Surya, the Sun who is your ancestor, light your path. May Vayu carry your arrows true. May Agni consume the darkness before you. And may Sita's love be the star that guides you home. Now go — Lanka's sentinels await in the forest ahead.",
      choices: [
        {
          label: 'What lies in the forest?',
          nextNodeId: 'sage_sentinels',
          revealsGoal: true,
        },
      ],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Chapter 2: Jatayu's Spirit — the noble vulture who died defending Sita
// In the Ramayana, Jatayu fought Ravana mid-flight and was mortally wounded.
// He lived long enough to tell Rama which direction Ravana flew.
// ─────────────────────────────────────────────────────────────────────────────
const ch2_jatayu_tree: DialogueTree = {
  startNodeId: 'jatayu_appear',
  nodes: {
    jatayu_appear: {
      id: 'jatayu_appear',
      speaker: 'Spirit of Jatayu',
      text: "Rama... it is I, Jatayu. Old friend of your father Dasharatha. I tried to stop Ravana when he stole Sita — I tore at his chariot with my talons, but his sword was too cruel. My body fell, but my spirit remained to guide you.",
      choices: [
        {
          label: 'Noble Jatayu — your sacrifice was not in vain',
          nextNodeId: 'jatayu_guidance',
          revealsGoal: true,
        },
        {
          label: 'Which way did Ravana fly?',
          nextNodeId: 'jatayu_direction',
        },
        {
          label: 'I will avenge you, old friend',
          nextNodeId: 'jatayu_wisdom',
        },
      ],
    },
    jatayu_guidance: {
      id: 'jatayu_guidance',
      speaker: 'Spirit of Jatayu',
      text: "As I fell, I saw Sita drop her ornaments — breadcrumbs of love on the wind. Ravana flew south toward Lanka, over the sea. But first you must pass through the Demon Guard. They are Ravana's elite — warriors who sold their souls for power. Each carries fragments of stolen knowledge. Defeat them and you learn their secrets.",
      choices: [
        {
          label: 'Rest in peace, Jatayu. I will carry your courage.',
          nextNodeId: 'jatayu_farewell',
        },
      ],
    },
    jatayu_direction: {
      id: 'jatayu_direction',
      speaker: 'Spirit of Jatayu',
      text: "South, always south — toward the golden city beyond the sea. But the path is guarded. Ravana's Demon Guard patrols these lands. They are stronger than the forest sentinels — hardened by years of tyranny. Yet they also carry maps of the terrain. Every demon you fell may reveal what lies ahead.",
      choices: [
        {
          label: 'Thank you, noble one',
          nextNodeId: 'jatayu_farewell',
          revealsGoal: true,
        },
      ],
    },
    jatayu_wisdom: {
      id: 'jatayu_wisdom',
      speaker: 'Spirit of Jatayu',
      text: "Not vengeance, young prince — justice. I fought Ravana not for glory but because it was right. An old bird defending an innocent woman against a demon king — that is what Dharma looks like when it has no audience. Fight as I fought: without calculation, without ego, only duty.",
      choices: [
        {
          label: 'Your Dharma humbles me, Jatayu',
          nextNodeId: 'jatayu_guidance',
          revealsGoal: true,
        },
      ],
    },
    jatayu_farewell: {
      id: 'jatayu_farewell',
      speaker: 'Spirit of Jatayu',
      text: "I go now to join your father in the realm of the Pitrs — the ancestors. Dasharatha waits there, still grieving his separation from you. Tell him, when you meet again, that old Jatayu kept his word. Farewell, son of Raghu. The Demon Guard awaits — be swift, be just.",
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Chapter 3: Sugriv — The exiled Vanara king whose throne Rama restored
// In the Ramayana, Sugriv was banished by his brother Vali. Rama killed Vali
// (a morally complex act) and restored Sugriv's kingdom. In return, Sugriv
// pledged his armies to search for Sita.
// ─────────────────────────────────────────────────────────────────────────────
const ch3_sugriv_tree: DialogueTree = {
  startNodeId: 'sugriv_recognition',
  nodes: {
    sugriv_recognition: {
      id: 'sugriv_recognition',
      speaker: 'Sugriv, King of Kishkindha',
      text: "Rama! Son of Dasharatha, slayer of Tataka, protector of Vishvamitra's yajna. I am Sugriv — do you remember? When Vali's injustice drove me into hiding on Rishyamukha, it was you who restored my throne. The debt I owe you is deeper than the sea you must cross.",
      choices: [
        {
          label: 'I need the Vanara armies to rescue Sita',
          nextNodeId: 'sugriv_pledge',
          revealsGoal: true,
        },
        {
          label: 'Tell me what you know of Ravana',
          nextNodeId: 'sugriv_ravana_knowledge',
        },
        {
          label: 'How fares your kingdom since Vali fell?',
          nextNodeId: 'sugriv_kingdom',
        },
      ],
    },
    sugriv_pledge: {
      id: 'sugriv_pledge',
      speaker: 'Sugriv, King of Kishkindha',
      text: "Every Vanara warrior in Kishkindha is yours. I have already dispatched search parties in all four directions. Hanuman — son of Vayu, mightiest among us — he leapt across the ocean itself and found Sita in the Ashoka Vatika. She lives, Rama. She endures, faithful as the Pole Star.",
      choices: [
        {
          label: 'Sita is alive... my heart knows peace again',
          nextNodeId: 'sugriv_strategy',
        },
      ],
    },
    sugriv_strategy: {
      id: 'sugriv_strategy',
      speaker: 'Sugriv, King of Kishkindha',
      text: "But crossing the sea to Lanka — that is no small matter. We will need Nala and Nila, the divine architects, to build a bridge. First, prove your strength against the Demon Guard that still prowls these lands. Rest here in Kishkindha when you need it — press V to meditate and restore your spirit. When you are ready, Hanuman will guide your way.",
    },
    sugriv_ravana_knowledge: {
      id: 'sugriv_ravana_knowledge',
      speaker: 'Sugriv, King of Kishkindha',
      text: "Ravana is no ordinary demon. He performed ten thousand years of tapasya — penance — and Brahma himself granted him near-immortality. No god, no gandharva, no yaksha can slay him. But Ravana, in his pride, forgot to ask protection from men and vanaras. That was his fatal oversight — and that is why you, a mortal prince, carry the destiny of the three worlds.",
      choices: [
        {
          label: 'Then even his boon contains the seed of his defeat',
          nextNodeId: 'sugriv_pledge',
          revealsGoal: true,
        },
      ],
    },
    sugriv_kingdom: {
      id: 'sugriv_kingdom',
      speaker: 'Sugriv, King of Kishkindha',
      text: "Kishkindha thrives. Tara, Vali's widow, has forgiven me — she sees the larger pattern of Dharma at work. Angad, Vali's own son, serves me loyally. This is the miracle of righteous action, Rama: even those wounded by our choices can find healing when the cause is just. I pray the same healing awaits you and Sita.",
      choices: [
        {
          label: 'Your words give me strength, friend',
          nextNodeId: 'sugriv_pledge',
          revealsGoal: true,
        },
      ],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Chapter 4: Jambavan — The immortal bear-king, advisor and elder
// In the Ramayana, Jambavan was present at the churning of the ocean. He was the
// one who reminded Hanuman of his forgotten powers before the leap to Lanka.
// ─────────────────────────────────────────────────────────────────────────────
const ch4_jambavan_tree: DialogueTree = {
  startNodeId: 'jambavan_greet',
  nodes: {
    jambavan_greet: {
      id: 'jambavan_greet',
      speaker: 'Jambavan, King of the Bears',
      text: "I am Jambavan, who circled Vishnu thrice at the churning of the Kshira Sagara. I have lived through yugas, watched kingdoms rise and fall. And in all that time, I have never seen a cause more righteous than yours, Prince Rama.",
      choices: [
        {
          label: 'What counsel do you offer, ancient one?',
          nextNodeId: 'jambavan_counsel',
          revealsGoal: true,
        },
        {
          label: 'You witnessed the churning of the ocean?',
          nextNodeId: 'jambavan_past',
        },
        {
          label: 'Is Hanuman truly strong enough for this task?',
          nextNodeId: 'jambavan_hanuman',
        },
      ],
    },
    jambavan_counsel: {
      id: 'jambavan_counsel',
      speaker: 'Jambavan, King of the Bears',
      text: "Demon scouts infest these woods — Ravana's eyes and ears. They report your movements, your strength, your allies. Silence them, and Ravana fights blind. Each one you defeat brings you closer to the sea crossing. But do not rush — a warrior who trains patiently defeats one who strikes recklessly every time.",
      choices: [
        {
          label: 'I will clear the scouts with purpose',
          nextNodeId: 'jambavan_parting',
        },
      ],
    },
    jambavan_past: {
      id: 'jambavan_past',
      speaker: 'Jambavan, King of the Bears',
      text: "When the Devas and Asuras churned the ocean of milk, I was there. I saw Vishnu take the form of Kurma — the great tortoise — to bear the weight of Mount Mandara on his back. I saw Lakshmi emerge from the foam, and Halahala, the world-poison, consumed by Shiva. I have seen the full cycle of creation. And I tell you: what you do here matters as much as any of those cosmic acts.",
      choices: [
        {
          label: 'Then let my actions honor that legacy',
          nextNodeId: 'jambavan_counsel',
          revealsGoal: true,
        },
      ],
    },
    jambavan_hanuman: {
      id: 'jambavan_hanuman',
      speaker: 'Jambavan, King of the Bears',
      text: "Hanuman? He is the son of Vayu, the wind-god. As a child, he leapt toward the sun, mistaking it for a ripe fruit. Indra struck him down, and a curse made him forget his own power. It was I, old Jambavan, who reminded him: 'You are the son of the Wind. The ocean is nothing to you.' And he leapt. That is what faith looks like, Rama — remembering who you truly are.",
      choices: [
        {
          label: 'A beautiful teaching. I will remember who I am.',
          nextNodeId: 'jambavan_counsel',
          revealsGoal: true,
        },
      ],
    },
    jambavan_parting: {
      id: 'jambavan_parting',
      speaker: 'Jambavan, King of the Bears',
      text: "Go with the blessings of an old bear who has seen everything. When you reach Lanka, remember: Ravana's navel holds the nectar of immortality — the Amrita that sustains his ten heads. Strike there when the time is right. Now — the scouts approach. Ready your bow.",
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Chapter 5: Angad — Vali's son, whose loyalty to Rama transcends grief
// In the Ramayana, Angad was sent as Rama's emissary to Ravana's court.
// He planted his foot before Ravana and challenged any demon to move it —
// none could. This was both a test of strength and a final offer of peace.
// ─────────────────────────────────────────────────────────────────────────────
const ch5_angad_tree: DialogueTree = {
  startNodeId: 'angad_report',
  nodes: {
    angad_report: {
      id: 'angad_report',
      speaker: 'Angad, Son of Vali',
      text: "Lord Rama, I have returned from Lanka. I entered Ravana's court as your emissary and delivered Sugriv's ultimatum: return Sita and seek forgiveness, or face the army of the righteous. Do you wish to know what I witnessed?",
      choices: [
        {
          label: 'What did Ravana say?',
          nextNodeId: 'angad_ravana_response',
          revealsGoal: true,
        },
        {
          label: 'Tell me of the challenge you issued',
          nextNodeId: 'angad_foot_challenge',
        },
        {
          label: 'Angad — you serve me despite what I did to your father',
          nextNodeId: 'angad_forgiveness',
        },
      ],
    },
    angad_ravana_response: {
      id: 'angad_ravana_response',
      speaker: 'Angad, Son of Vali',
      text: "He laughed, Lord Rama. Ravana sat upon his throne of gold and laughed. He called you a homeless wanderer, a prince without a kingdom. He said Sita was his by right of conquest — that might makes dharma. His generals roared approval. But I saw something in his eyes beneath the bravado: fear. He knows you are coming.",
      choices: [
        {
          label: 'Fear in Ravana? That is the seed of his defeat.',
          nextNodeId: 'angad_weakness',
        },
      ],
    },
    angad_weakness: {
      id: 'angad_weakness',
      speaker: 'Angad, Son of Vali',
      text: "His weakness is threefold: pride blinds him to counsel, lust chains him to Sita whom he cannot possess, and power has made him forget what it means to lose. He surrounds himself with sycophants. His own brother Vibhishana pleaded for peace and was banished for it. A king who exiles wisdom invites ruin.",
    },
    angad_foot_challenge: {
      id: 'angad_foot_challenge',
      speaker: 'Angad, Son of Vali',
      text: "I stood in the center of Ravana's court and planted my foot upon the marble floor. I declared: 'If any warrior in Lanka can lift my foot, Rama will withdraw. But if none can move me, know that your king's doom is certain.' They tried — Indrajit, Kumbhakarna's sons, even Ravana himself reached down. None could budge me. Dharma held me rooted like Mount Meru.",
      choices: [
        {
          label: 'Your courage shames armies, Angad',
          nextNodeId: 'angad_ravana_response',
          revealsGoal: true,
        },
      ],
    },
    angad_forgiveness: {
      id: 'angad_forgiveness',
      speaker: 'Angad, Son of Vali',
      text: "You killed my father Vali — yes. I wept. My mother Tara wept. But she taught me something: your arrow struck Vali not from malice but from Dharma. Vali had wronged Sugriv, stolen his wife, his throne. You restored the cosmic balance. I serve you because I have seen with my own eyes what happens when power goes unchecked. Ravana is Vali magnified a thousandfold.",
      choices: [
        {
          label: 'Your wisdom honors Vali\'s memory',
          nextNodeId: 'angad_ravana_response',
          revealsGoal: true,
        },
      ],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Chapter 6: Vibhishana — Ravana's righteous brother who chose Dharma over blood
// In the Ramayana, Vibhishana urged Ravana three times to return Sita. When
// Ravana banished him, Vibhishana flew to Rama's camp and was accepted — Rama
// crowned him king of Lanka even before the battle was won.
// ─────────────────────────────────────────────────────────────────────────────
const ch6_vibhishana_tree: DialogueTree = {
  startNodeId: 'vibhishana_arrival',
  nodes: {
    vibhishana_arrival: {
      id: 'vibhishana_arrival',
      speaker: 'Vibhishana',
      text: "Lord Rama, I come to you with empty hands and a full conscience. I am Vibhishana, youngest brother of Ravana. Three times I beseeched him: 'Return Sita. Seek Rama's forgiveness. Save Lanka from destruction.' Three times he cast my words aside. The third time, he banished me. I choose Dharma over Kula — righteousness over clan.",
      choices: [
        {
          label: 'How can I trust the brother of my enemy?',
          nextNodeId: 'vibhishana_trust',
        },
        {
          label: 'Tell me Ravana\'s secret weakness',
          nextNodeId: 'vibhishana_secret',
          revealsGoal: true,
        },
        {
          label: 'What drove Ravana to such Adharma?',
          nextNodeId: 'vibhishana_ravana_fall',
        },
      ],
    },
    vibhishana_trust: {
      id: 'vibhishana_trust',
      speaker: 'Vibhishana',
      text: "A fair question. Sugriv himself asked the same. I answer as I answered him: judge me not by my blood but by my choices. Ravana's mother Kaikesi was a Rakshasi, yet our grandfather Pulastya was a Brahmarishi — a sage of the highest order. Good and evil are not inherited, Lord Rama. They are chosen, action by action, breath by breath.",
      choices: [
        {
          label: 'Well spoken. You are welcome among us.',
          nextNodeId: 'vibhishana_secret',
          revealsGoal: true,
        },
      ],
    },
    vibhishana_secret: {
      id: 'vibhishana_secret',
      speaker: 'Vibhishana',
      text: "Ravana's body is sustained by a pool of Amrita — divine nectar — stored within his navel. His ten heads will regenerate endlessly unless that source is struck. Brahma's boon protects him from gods and demons, but not from men. You, a mortal prince carrying Vishnu's essence, are the one exception the cosmos has produced. The Brahmastra aimed at his navel — that is how this ends.",
      choices: [
        {
          label: 'What of Kumbhakarna? And Indrajit?',
          nextNodeId: 'vibhishana_generals',
        },
        {
          label: 'I will strike true when the moment comes',
          nextNodeId: 'vibhishana_blessing',
        },
      ],
    },
    vibhishana_generals: {
      id: 'vibhishana_generals',
      speaker: 'Vibhishana',
      text: "Kumbhakarna, my middle brother, sleeps for six months at a time — a curse from Brahma for his gluttony at the boon-granting. When awakened, he is a force of nature. Indrajit, Ravana's son Meghanada, is perhaps more dangerous than his father — he once captured Indra himself. But both share Ravana's flaw: they fight for pride, not for righteousness. Your cause is purer.",
      choices: [
        {
          label: 'I understand. Every enemy has a limit.',
          nextNodeId: 'vibhishana_blessing',
        },
      ],
    },
    vibhishana_blessing: {
      id: 'vibhishana_blessing',
      speaker: 'Vibhishana',
      text: "One more thing, Lord Rama. My sister-in-law Mandodari — Ravana's wife — she too weeps for his folly. She told him: 'You stole Sita, and you will lose everything.' Even within his own palace, Dharma whispers. You are not alone in this fight. The whole cosmos aches for the balance you will restore.",
    },
    vibhishana_ravana_fall: {
      id: 'vibhishana_ravana_fall',
      speaker: 'Vibhishana',
      text: "My brother was once the greatest scholar in all three worlds. He mastered the four Vedas, the sixty-four arts, and every scripture known to gods and men. His penance shook Mount Kailasa itself — Shiva granted him the Atma Lingam. But Kama — desire — entered his heart when he saw Sita. From that moment, every gift became a weapon turned inward. Knowledge without humility is a poison, Rama. That is the lesson of Ravana's life.",
      choices: [
        {
          label: 'A tragedy. But Sita must be freed.',
          nextNodeId: 'vibhishana_secret',
          revealsGoal: true,
        },
      ],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Chapter 4 (alternate): Sampati — Jatayu's brother, whose wings were burned
// In the Ramayana, Sampati lost his wings shielding Jatayu from the sun.
// Years later, he spotted Ravana's chariot flying toward Lanka and told
// the Vanara search party where to find Sita.
// ─────────────────────────────────────────────────────────────────────────────
const ch4_sampati_tree: DialogueTree = {
  startNodeId: 'sampati_greet',
  nodes: {
    sampati_greet: {
      id: 'sampati_greet',
      speaker: 'Sampati, Brother of Jatayu',
      text: "You carry the scent of battle... and of grief. My brother Jatayu — I felt it when he fell. We were young once, two vulture brothers racing toward the sun. I shielded him, and Surya burned my wings. I have lived wingless ever since. Tell me, did my brother die with honor?",
      choices: [
        {
          label: 'Jatayu fought Ravana himself to protect Sita. He died a hero.',
          nextNodeId: 'sampati_pride',
        },
        {
          label: 'He told me Ravana flew south. Can you see further?',
          nextNodeId: 'sampati_sight',
          revealsGoal: true,
        },
      ],
    },
    sampati_pride: {
      id: 'sampati_pride',
      speaker: 'Sampati, Brother of Jatayu',
      text: "Then he surpassed me in the end. I who once shielded him from the sun — he shielded your Sita from the demon king. My wings may be gone, but my eyes are the sharpest in creation. From this peak I saw Ravana's Pushpaka Vimana carrying a weeping woman across the sea to Lanka, a hundred yojanas to the south.",
      choices: [
        {
          label: 'A hundred yojanas — across the sea itself?',
          nextNodeId: 'sampati_sea',
        },
      ],
    },
    sampati_sight: {
      id: 'sampati_sight',
      speaker: 'Sampati, Brother of Jatayu',
      text: "My eyes see what wings cannot reach. From this mountain peak, I watched Ravana's Pushpaka Vimana — the flying chariot he stole from Kubera — carry a woman in white across the sea. She was weeping, calling your name. Lanka lies a hundred yojanas south, across the ocean. That is where she waits.",
      choices: [
        {
          label: 'Then I must find a way to cross the sea',
          nextNodeId: 'sampati_sea',
        },
      ],
    },
    sampati_sea: {
      id: 'sampati_sea',
      speaker: 'Sampati, Brother of Jatayu',
      text: "The sea is vast, but remember — your cause has allies in every element. Varuna, lord of the waters, owes your ancestor Sagara a debt. The stones will float if inscribed with Rama's name — I have seen stranger miracles. First, clear the demon scouts from these lands. Each one you defeat weakens Ravana's intelligence. Then the crossing will come.",
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Export all dialogue trees
// ─────────────────────────────────────────────────────────────────────────────
export const DIALOGUE_TREES: Record<string, DialogueTree> = {
  ch1_sage: ch1_sage_tree,
  ch2_jatayu: ch2_jatayu_tree,
  ch3_sugriv: ch3_sugriv_tree,
  ch4_jambavan: ch4_jambavan_tree,
  ch4_sampati: ch4_sampati_tree,
  ch5_angad: ch5_angad_tree,
  ch6_vibhishana: ch6_vibhishana_tree,
};
