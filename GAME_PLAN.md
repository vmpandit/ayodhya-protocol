# Ayodhya Protocol: Lanka Reforged — Master Game Plan

## Expert Review Summary (4 Expert Agents)

### Art Director Findings
- Biomes lack visual distinction (all use same ground material)
- Ashrams need sacred iconography (rangoli, prayer flags, sacred symbols)
- Player lacks divine aura befitting Rama
- Lanka fortress has no visible walls/structures
- Chromatic aberration too aggressive for gameplay clarity

### Gameplay Expert Findings
- Snap shot damage (12) too low to be viable — needs buff
- Astra combos undiscoverable — no tutorial or real-time feedback
- No melee weapon, skill tree, inventory, or side quests
- Real-time karma feedback missing — players can't see scores change
- Boss arena lacks hazards (compared to God of War / Elden Ring)

### Physics Expert Findings (Critical Bugs)
- **BUG-1 CRITICAL**: Projectile gravity 6.7x too weak (hardcoded 3.0 instead of ~20)
- **BUG-2 CRITICAL**: Special arrows (Fire/Vayu/Varuna/Naga) don't consume ammo
- **BUG-3 CRITICAL**: Boss can escape arena — no boundary enforcement
- **BUG-4 HIGH**: Boss phase check order wrong (Phase3 checked before Phase2)
- **BUG-5 HIGH**: Meditation + ashram stamina regen stacks unintentionally
- **BUG-6 MEDIUM**: Projectiles pass through terrain (no ground collision)
- **BUG-7 MEDIUM**: Perfect dodge window only checks AFTER telegraph, not during

### Ramayana Scholar Findings
- Sita never appears as NPC (central motivation feels hollow)
- Key moments only narrated, not dramatized (Golden Deer, Hanuman's Leap, Bridge building)
- Ravana needs final death monologue (dharma wisdom)
- Missing Kumbhakarna as mini-boss
- Excellent dialogue quality overall — NPCs are well-characterized

---

## Prioritized Execution Plan

### TIER 1: Critical Bug Fixes (Highest Impact, Prevents Game-Breaking Issues)
| ID | Fix | Impact | Effort |
|----|-----|--------|--------|
| T1-1 | Fix projectile gravity (line 1515) | Arrows actually arc properly | 1 line |
| T1-2 | Add ammo cost to special arrows | Economy not broken | 4 lines |
| T1-3 | Clamp boss to arena boundary | Final boss stays in arena | 5 lines |
| T1-4 | Fix boss phase check order | Phase2 triggers before Phase3 | Swap 2 lines |
| T1-5 | Prevent meditation+ashram stamina stacking | Balanced healing | 1 guard |
| T1-6 | Add terrain collision for projectiles | Arrows hit ground properly | 3 lines |
| T1-7 | Fix perfect dodge window timing | Feels fair to players | 5 lines |

### TIER 2: Gameplay Feel Improvements (High Impact, Easy-Medium)
| ID | Change | Impact | Effort |
|----|--------|--------|--------|
| T2-1 | Buff snap shot damage 12→20 | Makes quick-fire viable | 1 constant |
| T2-2 | Add real-time karma feed HUD | Players see "+5 Valor!" on actions | Medium |
| T2-3 | Add Ravana death monologue dialogue | Epic narrative payoff | Easy |
| T2-4 | Add biome ground color per chapter | World feels like a journey | Easy |
| T2-5 | Add sacred rangoli floor patterns to ashrams | Ramayana authenticity | Easy |
| T2-6 | Add player divine aura glow | Rama feels divine | Medium |

### TIER 3: Content & Depth (Medium Impact, Medium Effort)
| ID | Change | Impact | Effort |
|----|--------|--------|--------|
| T3-1 | Add Sita NPC in Ch7 post-boss | Central motivation resolved | Medium |
| T3-2 | Add Lanka fortress wall structures | End-game feels earned | Medium |
| T3-3 | Boss arena hazards (lava geysers) | Boss fight more dynamic | Medium |
| T3-4 | Stealth archery (crouch + 2x damage) | Playstyle diversity | Medium |
| T3-5 | Prune dead enemies for memory | Long session stability | Easy |

### TIER 4: Future Content (Lower Priority)
- Kumbhakarna mini-boss
- Maricha Golden Deer encounter
- Skill tree / passive unlocks
- Side quests per chapter
- Environmental puzzles
- Melee sword weapon
