# Ayodhya Protocol: Lanka Reforged — Cross-Functional Game Director Review

**Date:** 2026-03-14
**Build:** 12,202 LOC | Babylon.js 7.28.0 WebGPU | 7-chapter Ramayana storyline
**Reviewers:** Lead Game Designer · Art Director · Producer/Product Owner

---

## 1. Internal Review

### Lead Game Designer Assessment

The core loop — traverse Ramayana geography → encounter enemies → earn Astras → defeat Ravana — is structurally sound. The 7-chapter progression (Tutorial → Dandaka → Jatayu → Kishkindha → Southern Shore → Ram Setu → Lanka → Boss) follows the epic's narrative arc faithfully. Key systems that land well: the Astra Synergy combo system (6 element combos), Karma scoring (mercy/valor/devotion triad), the Lakshman choice (companion vs. Lone Warrior +30% damage), and the 7-phase encounter state machine (Dormant through Defeated with mid-fight dialogue). The difficulty tier system (Story/Dharma/Tapasya) is well-calibrated.

However, the core loop suffers from unclear wayfinding across the now-massive 800-unit world, a difficulty cliff at Chapter 4 where Flying/Erratic enemies arrive without mechanical introduction, and an overly punishing arrow economy (20 starting ammo, 3-7 per drop) for a game whose primary verb is ranged combat. Tutorial coverage is broad (10 steps) but omits critical systems the player will need: Astra switching, companion abilities, and meditation.

### Art Director Assessment

The rendering pipeline is technically strong: WebGPU with ACES tone mapping, bloom, chromatic aberration, dramatic vignette, shadow maps, and a day/night cycle tied to chapter progression create genuine atmosphere. The "eternal blood dusk" color palette (orange sun, indigo fill, purple shadows) is cohesive and evocative. Billboard sprite characters with fallback humanoid primitives are a pragmatic choice.

Visual weaknesses: the world geometry is overwhelmingly flat (no heightmap deformation despite the code skeleton being present — `generateHeightmap`/`applyHeightmapToGround` are referenced but the ground is a flat plane). All 8 biome zones look nearly identical — same green ground, same tree distribution, same rock scattering. The Ram Setu bridge stones have no visual distinction from surrounding rocks. Enemy visual feedback (hit flash, telegraph indicators) exists in code but is subtle enough to be missed in combat. Water features are flat blue planes without shoreline blending.

### Producer: Top 10 Prioritized Issues

| # | Tag | Issue | Impact |
|---|-----|-------|--------|
| 1 | [GAMEPLAY] | **No wayfinding system between chapter zones** — 800-unit world with no compass, breadcrumbs, or directional cues; player has minimap but no guidance toward next chapter zone | Players will wander aimlessly after each chapter transition, breaking narrative momentum |
| 2 | [GRAPHICS] | **Flat terrain with no biome differentiation** — all 8 chapter zones share identical ground material, tree/rock density, and fog color despite representing wildly different locations (forest, cliffside, shore, ocean bridge, volcanic Lanka) | Destroys sense of journey; the Ramayana's geographic progression is a core narrative device |
| 3 | [GAMEPLAY] | **Flying/Erratic enemies appear without introduction** — new enemy archetypes at Ch4-5 with fundamentally different counters (vertical aiming for Flying, dodge-timing for Erratic charges) but no tutorial or gentle ramp | Feels unfair; players lack the vocabulary to respond correctly |
| 4 | [GRAPHICS] | **Camera maxZ=280 in an 800-unit world** — far clip plane cuts off at 280 units, so distant chapter zones, Ram Setu bridge, and Lanka are invisible even from elevated positions | Player never sees the epic scale of the journey or their destination |
| 5 | [GAMEPLAY] | **Arrow economy too punishing for ranged-primary game** — 20 starting arrows, meditation restores only 5, and drops average 5 per kill; during wave encounters (Ch4+) players will run dry mid-fight | Forced into melee with a character designed for archery; breaks fantasy |
| 6 | [GRAPHICS] | **Boss arena visible from game start** — the arena at (600, -700) has always-on emissive lava veins and pillar orbs; no LOD gating or distance fade | Spoils the climax; Lanka should be a revelation, not background furniture |
| 7 | [GAMEPLAY] | **No player feedback on encounter phase transitions** — Detection/Challenge/MidFight phases trigger HUD notifications but gameplay doesn't pause or slow time; dialogue overlaps active combat | Players miss critical story moments and lore-authentic dialogue |
| 8 | [GRAPHICS] | **Water has no physics integration in World.ts** — `isInWater()` exists in LocalSim for speed debuff but water surfaces are visually flat blue planes with no shoreline gradient, foam, or depth variation | Breaks immersion at the pivotal Southern Shore / Ram Setu crossing |
| 9 | [GAMEPLAY] | **Companion AI is fire-and-forget** — Hanuman/Angad/Lakshman have active abilities on long cooldowns (15-25s) but no autonomous combat behavior or positioning; they're cooldown buttons, not companions | Undermines the "brotherhood" theme central to the Ramayana's message |
| 10 | [GRAPHICS] | **Maya illusions have no visual tell** — illusions spawn as identical enemies with no shimmer, transparency, or aura distinguishing them from the real champion | Players waste arrows on decoys with no way to identify the real enemy, which is frustrating rather than strategic |

---

## 2. High-Level Roadmap

### Phase 1: "The Journey" — Wayfinding, Biomes, and Onboarding (4 weeks)

**Objective:** Make the 800-unit world feel like a pilgrimage through distinct Ramayana landscapes, with clear guidance so the player always knows where to go next.

**Workstreams:**

- **Gameplay:** Add waypoint compass HUD (arrow pointing to next chapter zone), expand tutorial to cover Astra switching and companion abilities, add "soft intro" encounters for Flying (Ch3) and Erratic (Ch4) enemies before they appear in waves, increase starting ammo to 30 and meditation restore to 10.
- **Graphics:** Implement per-biome ground materials, fog colors, and tree/rock distributions for all 8 zones (Panchavati = lush green, Dandaka = dark canopy, Jatayu = arid cliffside, Kishkindha = rocky highland, Southern Shore = sandy with palm sprites, Ram Setu = ocean mist, Lanka Outskirts = scorched earth, Ravana's Lanka = volcanic). Activate heightmap terrain deformation. Extend camera maxZ to 600+ with LOD gating on boss arena geometry.
- **Tech:** Implement biome-zone material blending (smooth 50-unit crossfade between zones), LOD system for chapter landmarks beyond 200 units, save/load checkpoint verification.

**Success Criteria:** Blind playtester completes Ch0-3 without getting lost, correctly identifies each zone by name from visuals alone, and can describe what each new enemy type does.

### Phase 2: "The Battle" — Combat Feel, Visual Feedback, and Narrative Integration (3 weeks)

**Objective:** Make every arrow impact, encounter transition, and companion action feel cinematic and lore-authentic.

**Workstreams:**

- **Gameplay:** Add slow-time (0.3x for 1.5s) during Detection and Challenge encounter phases so dialogue lands before combat begins, give companions autonomous combat AI (periodic ranged attacks, positioning behind player), implement Maya illusion visual tells and strategic counterplay (real champion has golden name tag), tune wave pacing (rest beats between waves).
- **Graphics:** Add per-Astra projectile trail VFX (fire = ember trail, wind = distortion wake, water = droplet scatter, poison = green mist), Maya illusion shimmer (oscillating alpha 0.4-0.8), telegraph ground indicators (red circle for AoE, directional cone for charges), shoreline blending on water features, boss arena fog gate that lifts on Ch7 entry.
- **Tech:** Pool enemy mesh instances, reduce draw calls in dense wave encounters, profile and optimize particle systems in boss arena.

**Success Criteria:** Combat "feels good" per 3-second-rule (every 3s the player sees meaningful visual/audio feedback), encounter dialogues are fully readable before first hit, Maya illusions are identifiable within 2 seconds of spawning.

### Phase 3: "The Dharma" — Polish, Balance, and Narrative Payoff (2 weeks)

**Objective:** Final tuning pass ensuring the complete playthrough (1.5-2 hours) feels like a cohesive retelling of the Ramayana with satisfying difficulty curve.

**Workstreams:**

- **Gameplay:** Full balance pass on HP/damage/ammo across all 3 difficulty tiers, Karma scoring calibration (ensure all 3 axes are meaningfully earnable), end-screen narrative summary reflecting player choices (Lakshman choice, mercy count, devotion actions), achievement triggers for lore-authentic moments.
- **Graphics:** Final lighting pass per chapter, particle density tuning for performance targets (60fps on mid-tier GPU), skybox variation per time-of-day, boss death cinematic (slow-mo Brahmastra impact, head-by-head collapse).
- **Tech:** Bundle size optimization (currently 5.3MB gzipped), asset lazy-loading for texture PBR sets, final save/load integration testing.

**Success Criteria:** Full playthrough on Dharma difficulty in 90-120 minutes, 60fps sustained on GTX 1060 equivalent, zero softlocks, Karma report reflects actual play choices.

---

## 3. Simulated Elite Focus Group

### Persona Feedback

**A) Pro Tournament Player (competitive 3PS/action expertise)**

1. **Liked:** Dodge → Dharma Counter system is tight (100ms window, 1.5s damage boost) — rewards mastery. Stamina-tiered shockwave is a good risk/reward decision.
2. **Weak:** Enemy telegraph windows (400ms melee, 600ms ranged) are readable but the visual indicator is almost invisible — need ground markers or enemy glow states.
3. **Weak:** Pack behavior logic (spread when 3+ enemies cluster) works but enemies still stack on the same path to player — needs formation AI or approach-angle variety.
4. **Lore concern:** Brahmastra with 20s cooldown feels spammable for what lore describes as the ultimate weapon. Should be a once-per-encounter ability or require a build-up mechanic.
5. **Must fix:** Enemy telegraph visibility — without clear ground indicators, higher difficulties become a guessing game rather than a reading game.

**B) Speedrunner (optimization and routing expertise)**

1. **Liked:** The 800-unit world with separated chapter zones means routing matters — which encounters to engage vs. skip is a real decision. Waypoint system on map is useful.
2. **Weak:** Chapter transitions are gated purely by kill count (`chapterEnemiesKilled`) — speedrunners will want a "pacifist run" option or alternative progression (investigation points, dialogue completions).
3. **Weak:** No animation canceling on bow charge — committed to full 1500ms charge even if you see an incoming attack. Need a charge-cancel → dodge option.
4. **Liked:** Checkpoint system means route segmentation is possible. Save/load is clean.
5. **Must fix:** Bow charge canceling — the inability to cancel a charge into dodge is the single biggest movement restriction and feels like a bug, not a design choice.

**C) Lore-Focused Completionist (narrative and world-building expertise)**

1. **Liked:** Backstory slides are accurate to Valmiki's Ramayana — Jatayu's dying words, Kaikeyi's boons, Hanuman's ocean leap. The Ravana Phase 2/3 dialogues are exceptional (Veena sinews, Mandodari reference, Vibhishana's conflicted grief).
2. **Weak:** Investigation points are defined in the interface but `setupInvestigationPoints()` creates zero actual points — this system is a skeleton with no content. Should have 2-3 per chapter: Sita's jewelry trail, Jatayu's feathers, Vanara scouts' reports.
3. **Lore concern:** Chapter 3 (Kishkindha) has no Vali subplot — the Sugriv-Vali conflict is one of the Ramayana's most morally complex episodes and its absence weakens the Karma system's theme.
4. **Liked:** The Lakshman choice (companion vs. Lone Warrior) is a genuine moral fork that maps to Ramayana themes of brotherhood vs. individual dharma.
5. **Must fix:** Investigation points need actual content — the empty system is the biggest missed opportunity for lore depth. Even 1-2 discoverable clues per chapter (text-only is fine) would double the narrative texture.

**D) Accessibility-Focused Player (UX clarity and inclusive design)**

1. **Liked:** Difficulty tiers (Story mode at 0.7x damage) and generous checkpoint system. Damage direction indicator exists.
2. **Weak:** Controls are never shown on-screen after tutorial — no pause-menu control reference. Players who skip tutorial or forget a binding are stuck.
3. **Weak:** Colorblind players cannot distinguish Astra types — fire (orange), wind (white), water (blue), poison (green) rely entirely on color. Need shape-coded projectile trails or icon indicators.
4. **Weak:** Dialogue text has no size/contrast options and auto-advances on timer — players with reading difficulties may miss lore. Need a "press to advance" mode (which partially exists but isn't consistent).
5. **Must fix:** On-screen control reference accessible from pause/map menu — the game has 14+ input bindings and no way to review them mid-play.

**E) Graphics Connoisseur (rendering and visual design expertise)**

1. **Liked:** Post-processing pipeline is professional-grade — ACES tone mapping, color curves with amber highlights and purple shadows, bloom on emissives. The palette is cohesive and evocative.
2. **Weak:** The world is a single flat plane at Y=0 with objects placed on top — there's no terrain deformation, no hills, no valleys. The heightmap code exists but isn't connected to the ground mesh. For an 800-unit world this is inexcusable.
3. **Weak:** Shadow map resolution (2048) is shared across the entire 800-unit world — shadows are blurry beyond 50 units from the camera. Need cascaded shadow maps or at minimum a shadow distance limit.
4. **Lore concern:** Lanka should be visually distinct from every other zone — in the Ramayana it's described as a golden city with crystal spires. Current implementation is a dark volcanic arena that could be any dungeon.
5. **Must fix:** Terrain heightmap activation — the flat world undermines every other visual investment. Even gentle 2-3m undulation would transform the experience.

### Consolidated Insights (Prioritized)

| # | Insight | Source | Impact Area |
|---|---------|--------|-------------|
| 1 | **Activate heightmap terrain** — world is flat despite code existing for deformation | E, B | Graphics / Immersion |
| 2 | **Per-biome visual identity** — all 8 zones look identical; destroys sense of journey | E, C | Graphics / Narrative |
| 3 | **Enemy telegraph ground indicators** — combat readability at higher difficulties | A, D | Gameplay / Accessibility |
| 4 | **Bow charge canceling into dodge** — core movement restriction feels like a bug | A, B | Gameplay / Feel |
| 5 | **Investigation point content** — skeleton system with zero actual clues | C | Gameplay / Narrative |
| 6 | **Control reference in pause menu** — 14+ bindings with no way to review | D | UX / Accessibility |
| 7 | **Maya illusion visual tells** — no way to identify real vs. decoy enemies | A, D | Gameplay / Readability |
| 8 | **Wayfinding compass/breadcrumbs** — 800-unit world with no directional guidance | B, D | Gameplay / UX |
| 9 | **Brahmastra usage design** — should feel like the ultimate weapon, not a 20s cooldown | A, C | Gameplay / Lore |
| 10 | **Colorblind-safe Astra indicators** — shape or icon coding beyond color alone | D | Accessibility |
| 11 | **Encounter phase slow-time** — dialogue overlaps combat, story moments are missed | C, D | Gameplay / Narrative |
| 12 | **Lanka visual identity** — golden city with crystal spires, not generic volcanic arena | C, E | Graphics / Lore |

---

## 4. Next-Phase Requirements (Phase 1: "The Journey")

### A) Gameplay Requirements — Lead Game Designer

**G-01: Compass Waypoint HUD** [Must-Have]
Add a screen-edge compass indicator pointing toward the next chapter zone center. As the player completes a chapter, the waypoint updates to the next `CHAPTER_ZONES` entry. This directly supports the Ramayana's southward journey narrative and prevents aimless wandering in the 800-unit world.
*Acceptance: Compass arrow visible at all times during gameplay, rotates correctly relative to player yaw, updates on chapter transition. Verified by walking away from target and confirming arrow direction.*

**G-02: Expanded Tutorial — Astra Switching** [Must-Have]
Add tutorial step after "specialArrow" that teaches cycling through Astra types (1-5 keys) and firing each one at a marked target. The current tutorial covers basic shooting but players reach Ch1 without knowing how to use Vayu/Varuna/Naga Astras.
*Acceptance: Tutorial checklist includes "Switch Astra" step; step completes when player fires at least 2 different Astra types. All existing tutorial steps still function.*

**G-03: Expanded Tutorial — Companion Abilities** [Should-Have]
After Hanuman joins in Ch3, trigger a brief ability tutorial overlay explaining the companion ability key and cooldown. Currently companions join silently with a HUD notification but no mechanical explanation.
*Acceptance: On first companion join, show a 3-second overlay with ability name, key binding, and cooldown. Player can dismiss with any key.*

**G-04: Flying Enemy Soft Introduction (Ch3)** [Must-Have]
Spawn 1-2 Flying enemies during Chapter 3 (Kishkindha) at reduced difficulty (0.7x HP/damage) before they appear at full strength in Ch4 waves. This teaches vertical aiming before it becomes life-or-death.
*Acceptance: Ch3 spawns 1-2 Flying archers. They die in 2-3 arrows on Dharma difficulty. No Flying enemies appear before Ch3.*

**G-05: Erratic Enemy Soft Introduction (Ch4)** [Must-Have]
Spawn 1 Erratic brute during Chapter 4 (Southern Shore) early encounters before wave spawning begins. Include a detection-phase dialogue hint: "This one moves unpredictably — wait for the charge, then dodge!" to teach the counter.
*Acceptance: Ch4 contains at least 1 Erratic enemy before wave encounters begin. Encounter dialogue references the dodge-timing mechanic.*

**G-06: Arrow Economy Rebalance** [Must-Have]
Increase `STARTING_AMMO` from 20 to 30, `MEDITATION_ARROW_RESTORE` from 5 to 10, and `ARROW_DROP_MIN` from 3 to 4. The current economy runs players dry during Ch4+ wave encounters, forcing melee on a character designed for archery.
*Acceptance: Player never drops below 5 arrows during normal wave encounter play on Dharma difficulty (verified by adding a console warning if ammo hits 0 during waves).*

**G-07: Bow Charge Cancel into Dodge** [Should-Have]
Allow the player to press Dodge while charging a bow shot to cancel the charge and execute a dodge. Currently the 1500ms charge commitment prevents emergency evasion and feels like an unintended restriction.
*Acceptance: Pressing dodge during bow charge cancels the charge (no arrow fired), consumes stamina, and performs standard dodge. No damage window during transition.*

**G-08: Investigation Point Content (Ch1-4)** [Should-Have]
Add 2 investigation points per chapter (Ch1-4) with lore-authentic clue text. Examples: Ch1 = Maricha's golden deer hoofprints + shredded Sita's jewelry; Ch2 = Jatayu's feather + Ravana's chariot wheel marks; Ch3 = Vanara scout reports + Vali's throne room; Ch4 = ocean tide patterns + Nala's bridge blueprints.
*Acceptance: Each Ch1-4 zone contains 2 interactable points within `INVESTIGATION_POINT_INTERACT_DISTANCE`. Interaction displays clue text via existing `onInvestigationTriggered` callback. Points appear on minimap.*

**G-09: Encounter Phase Slow-Time** [Should-Have]
During Detection (1.5s) and Challenge (3s) encounter phases, reduce game time scale to 0.3x so dialogue is readable before combat begins. Currently dialogue overlaps with active enemy attacks.
*Acceptance: During Detection/Challenge phases, enemy movement speed visually slows. Dialogue text is fully displayed before Phase1 combat begins. No damage taken during Detection phase.*

**G-10: Control Reference in Map/Pause Menu** [Must-Have]
Add a "Controls" section to the map panel listing all input bindings grouped by category (Movement, Combat, Astras, Companions, UI). The game has 14+ bindings and no way to review them after the tutorial.
*Acceptance: Map panel shows a "Controls" tab/section. All keybindings listed. Works on both keyboard and gamepad (if supported).*

### B) Graphics Requirements — Art Director

**A-01: Heightmap Terrain Activation** [Must-Have]
Connect the existing `generateHeightmap`/`applyHeightmapToGround` code to the ground mesh. Generate biome-appropriate height profiles: gentle rolling hills for forest zones (2-4m amplitude), flat sandy shore for Ch4, elevated rocky terrain for Ch3 (Kishkindha), and volcanic ridges near Lanka. The flat Y=0 plane across 800 units is the single biggest visual deficit.
*Acceptance: Ground mesh has visible height variation. Player camera Y adjusts based on terrain height. Trees and rocks respect terrain height. No visible seams between heightmap regions.*

**A-02: Per-Biome Ground Materials** [Must-Have]
Create 5 distinct ground material profiles: (1) Lush green + brown soil (Ch0-1, Panchavati/Dandaka), (2) Arid tan + sparse grass (Ch2, Jatayu's Fall), (3) Gray rock + moss (Ch3, Kishkindha highlands), (4) Sand + wet shoreline (Ch4, Southern Shore), (5) Scorched dark earth + ember glow (Ch6-7, Lanka). Apply via the existing `setChapterBiome()` pipeline with 50-unit crossfade.
*Acceptance: Standing in each chapter zone, the ground is visually distinct in color, texture tiling, and density of ground cover. Crossfade between zones has no hard seam.*

**A-03: Per-Biome Fog and Atmosphere** [Must-Have]
Set zone-specific fog color and density: dense green mist for Dandaka forest, clear golden haze for Kishkindha, blue ocean mist for Southern Shore / Ram Setu, and red-black volcanic haze for Lanka. Currently all zones share the same warm ember fog.
*Acceptance: Each zone has a perceptibly different fog color. Transitioning between zones shows smooth fog blend. Lanka zone fog is visually ominous compared to forest zones.*

**A-04: Camera Far Plane Extension** [Must-Have]
Increase `camera.maxZ` from 280 to 800 (matching world size). Add distance fog to maintain atmosphere while allowing the player to see Lanka's glow from afar during later chapters — this is narratively critical as Rama sees Lanka burning on the horizon.
*Acceptance: From Ch4 (Southern Shore), the player can see the distant red glow of Lanka. No visible pop-in artifacts at 300+ unit range. FPS impact < 5% on reference hardware.*

**A-05: Enemy Telegraph Ground Indicators** [Must-Have]
Add a red disc (radius = melee range) under enemies during their 400ms melee telegraph, and a directional cone (red, semi-transparent) during 600ms ranged telegraph. For Erratic charges, show a dashed line from enemy to target position. These support combat readability without breaking the art style.
*Acceptance: All three telegraph types render correctly. Indicators appear at telegraph start and fade at telegraph end. Visible against all ground materials (including dark Lanka earth).*

**A-06: Maya Illusion Visual Differentiation** [Must-Have]
Illusion enemies render with oscillating alpha (0.4-0.8 at 2Hz), a purple-tinted material overlay, and no shadow. The real champion retains a subtle golden nameplate above their head. This gives observant players a way to identify the real enemy while preserving the "confusion" fantasy.
*Acceptance: Illusions are visually distinguishable from the real champion within 2 seconds. Real champion has gold nameplate visible at 15+ unit range. Illusions cast no shadow.*

**A-07: Water Shoreline Blending** [Should-Have]
Add a gradient alpha fade on water mesh edges (5-unit blend zone) and a foam-white strip at the shore boundary. Currently water is an opaque blue plane with a hard edge against green ground. The Southern Shore and Ram Setu crossing are pivotal narrative locations.
*Acceptance: Water-to-land transition has no hard edge. Foam strip visible along shoreline. Water near Ram Setu bridge has gentle wave-like vertex animation.*

**A-08: Lanka Visual Identity — Golden City** [Should-Have]
Redesign the boss arena zone to reflect the Ramayana's description: golden-tinted building facades (tall box meshes with emissive amber), crystal spire towers (transparent cylinders with refraction-like glow), and a grand gate structure at the Ch7 entry point. Current volcanic arena doesn't read as "Lanka."
*Acceptance: Arriving at Ch7 zone, the player sees golden structures, at least 4 tall spire towers, and a gate archway. The zone's color palette is gold/amber, distinct from any other zone.*

**A-09: Boss Arena Fog Gate** [Should-Have]
Add a distance-based visibility gate on the boss arena: fully hidden beyond 150 units (thick fog wall), partially visible at 100-150 units (silhouette only), fully revealed at entry. Currently the arena's emissive pillars and lava veins are visible from game start.
*Acceptance: From Ch0 spawn, the boss arena is not visible. From Ch5-6, a faint red glow is visible on the horizon. Full arena revealed only in Ch7.*

**A-10: Astra Projectile Trail VFX** [Should-Have]
Each player Astra type gets a distinct trail: Agni (orange ember particles), Vayu (white distortion streaks), Varuna (blue droplet scatter), Naga (green mist trail), Brahma (golden spiral with light bloom). The existing `vfxTextures` map is loaded but not applied to projectile meshes.
*Acceptance: Each of the 5 Astra types has a visually distinct trail. Trails are visible at 20+ unit range. Trail color/shape alone is sufficient to identify the Astra type (supports colorblind accessibility).*

**A-11: Per-Biome Tree/Rock Variation** [Nice-to-Have]
Vary tree species per zone: tall Banyan/Sal for Dandaka (existing), sparse palm sprites for Southern Shore, no trees for Lanka. Vary rock color: mossy green for forest, sandy tan for shore, obsidian black for Lanka.
*Acceptance: Tree types differ between at least 3 zone groups. Rock materials differ between forest and Lanka zones.*

**A-12: Shadow Distance Optimization** [Nice-to-Have]
Limit shadow rendering to 80 units from camera and increase shadow map resolution to 4096 for that range, or implement 2-cascade shadow mapping. Current 2048 shadow map across 800 units produces blurry shadows beyond 50 units.
*Acceptance: Shadow definition is crisp within 50 units of camera. No visible shadow pop-in during normal movement speed. FPS impact < 3%.*

### Producer Notes

**Priority Summary:**

| Priority | Gameplay | Graphics |
|----------|----------|----------|
| Must-Have | G-01, G-02, G-04, G-05, G-06, G-10 | A-01, A-02, A-03, A-04, A-05, A-06 |
| Should-Have | G-03, G-07, G-08, G-09 | A-07, A-08, A-09, A-10 |
| Nice-to-Have | — | A-11, A-12 |

**Lore Drift Risk Assessment:**

1. **Lanka redesign (A-08):** High risk of drifting toward generic fantasy castle. Mitigation: Reference Valmiki's Sundara Kanda descriptions explicitly — "golden ramparts," "crystal mansions," "jeweled gates." No Western medieval elements. Lanka is opulent, not fortified.

2. **Investigation points (G-08):** Risk of inventing non-canonical events. Mitigation: Every clue text must reference a specific Ramayana verse or episode. Use Aranya Kanda for Ch1-2, Kishkindha Kanda for Ch3, and Sundara Kanda for Ch4. No original lore.

3. **Brahmastra balance (noted by focus group, deferred to Phase 2):** The weapon is described as unstoppable and world-ending. Making it a spammable cooldown trivializes it. Phase 2 should redesign it as a build-up mechanic (charge through combat actions) rather than a timer.

4. **Companion AI (Phase 2):** Hanuman, Angad, and Lakshman have specific canonical personalities. Hanuman is fearless and aggressive, Angad is steadfast and defensive, Lakshman is loyal and follows Rama's lead. Their AI behavior must reflect these traits.
