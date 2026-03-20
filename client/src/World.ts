// ── Ayodhya Protocol: Lanka Reforged ── World Builder & Entity Meshes ──
// N64-style flat-colour PBR primitive meshes for all characters.
// Environment uses PBR textures from TextureLoader when available.
// Enemies support billboard sprite rendering with fallback to primitives.

import {
  MeshBuilder, StandardMaterial, PBRMaterial, Color3, Vector3, Mesh,
  Scene, TransformNode, InstancedMesh,
  Texture, Color4, GlowLayer, ParticleSystem, PointLight, DynamicTexture,
  Engine, VertexBuffer,
} from '@babylonjs/core';
import { Renderer } from './Renderer';
import { LoadedAssets } from './TextureLoader';
import {
  PlayerState, EnemyState, BossState, ProjectileState,
  EnemyAIState, BossPhase, PlayerStatus, ProjectileType, Vec3,
} from '@shared/types';
import { DamageTargetType } from '@shared/protocol';
import * as C from '@shared/constants';

interface ProjectileMesh {
  mesh: Mesh;
  vel: Vec3;
  spawnTime: number;
  type: ProjectileType;
}

// ══════════════════════════════════════════════════════════════════════════════
export class World {
  private renderer: Renderer;
  private scene: Scene;
  private playerMeshes = new Map<number, TransformNode>();
  private enemyMeshes = new Map<number, TransformNode>();
  private bossMesh: TransformNode | null = null;
  private projectileMeshes = new Map<number, ProjectileMesh>();
  private pickupMeshes = new Map<number, Mesh>();
  private allyNPCMeshes = new Map<string, TransformNode>();
  private companionMeshes = new Map<string, TransformNode>();
  private meditationLight: PointLight | null = null;
  private meditationActive = false;
  private damageNumbers: { mesh: Mesh; startTime: number; startY: number }[] = [];
  private trailParticles: { mesh: Mesh; age: number; maxAge: number; type?: number; drift?: number }[] = [];
  private trailSpawnAccum = 0;
  private treeInstances: InstancedMesh[] = [];
  private emberParticles: ParticleSystem | null = null;
  private ashParticles: ParticleSystem | null = null;
  private torchLight: PointLight | null = null;
  private torchMesh: Mesh | null = null;
  private campfireLight: PointLight | null = null;
  private campfireMesh: Mesh | null = null;
  private riverSegments: Mesh[] = [];
  private oceanMesh: Mesh | null = null;
  private groundMesh: Mesh | null = null;  // A-02: Ground mesh reference for biome changes
  private telegraphIndicators = new Map<number, Mesh>();  // A-05: Enemy telegraph ground indicators
  private telegraphMat: StandardMaterial | null = null;  // A-05: Shared telegraph material
  private championPlates = new Map<number, Mesh>();  // A-06: Champion nameplate meshes
  private foamMeshes: Mesh[] = [];  // A-07: Shoreline foam strip meshes
  private bossArenaMeshes: Mesh[] = [];  // A-09: All boss arena meshes for visibility toggling
  private lavaVentLights: PointLight[] = [];  // T3-3: Lava geyser lights for animation
  private lavaVentPositions: Vec3[] = [];  // T3-3: Lava vent positions for damage checking
  // P2-4: Enemy mesh pool — recycle disabled meshes instead of creating new ones
  private enemyMeshPool: TransformNode[] = [];

  /** Shared PBR material cache — keyed by a descriptive string */
  private matCache = new Map<string, PBRMaterial>();

  /** Loaded texture assets from TextureLoader (null = flat-colour fallback) */
  private assets: LoadedAssets | null = null;

  /** Cached enemy sprite textures with white background removed */
  private enemySpriteTextures = {
    sprite1: null as Texture | null,  // sprite_enemy.png (generic fallback)
    sprite2: null as Texture | null,  // sprite_enemy2.png (generic fallback)
    soldier: null as Texture | null,  // sprite_rakshasa_soldier.png
    archer: null as Texture | null,   // sprite_rakshasa_archer.png
    brute: null as Texture | null,    // sprite_rakshasa_brute.png
  };

  private playerSpriteTexture: Texture | null = null;
  private bossSpriteTexture: Texture | null = null;

  /** Cached NPC ally sprite textures keyed by NPC id */
  private npcSpriteTextures = new Map<string, Texture>();

  /** Cached VFX trail textures for special arrow projectiles */
  private vfxTextures = new Map<string, Texture>();

  /** Wildlife sprite textures */
  private birdSpriteTexture: Texture | null = null;
  private deerSpriteTexture: Texture | null = null;

  /** Campfire and torch sprite textures */
  private campfireSpriteTexture: Texture | null = null;
  private torchFlameSpriteTexture: Texture | null = null;

  /** Map to store enemy types for visual differentiation */
  private enemyTypes = new Map<number, 'soldier' | 'archer' | 'brute'>();

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.scene = renderer.scene;
  }

  /** Store enemy type for visual differentiation */
  setEnemyType(id: number, type: 'soldier' | 'archer' | 'brute'): void {
    this.enemyTypes.set(id, type);
  }

  // A-05: Ensure telegraph material is initialized
  private ensureTelegraphMat(): StandardMaterial {
    if (!this.telegraphMat) {
      this.telegraphMat = new StandardMaterial('telegraphMat', this.scene);
      this.telegraphMat.diffuseColor = new Color3(0.8, 0.1, 0.05);
      this.telegraphMat.emissiveColor = new Color3(0.6, 0.05, 0.02);
      this.telegraphMat.alpha = 0.3;
      this.telegraphMat.disableLighting = true;
      this.telegraphMat.backFaceCulling = false;
    }
    return this.telegraphMat;
  }

  /** Call before build() to enable textured PBR materials */
  setAssets(assets: LoadedAssets): void {
    this.assets = assets;
  }

  // A-01: Query terrain height at world position
  public getTerrainHeight(x: number, z: number): number {
    const amp = biomeAmplitude(z);
    return terrainNoise(x, z) * amp;
  }

  async build(): Promise<void> {
    await this.loadEnemySprites();
    this.buildGround();
    this.buildTrees();
    this.buildBossArena();
    this.buildRamSetuBridge();
    this.buildChapterLandmarks();
    this.buildWaterFeatures();
    // Only build fallback skybox if TextureLoader didn't build one
    if (!this.assets) this.buildSkybox();
    this.buildGlowLayer();
    this.buildAmbientParticles();
    this.buildWildlife();
    // T4-3: Build sacred pillar puzzles
    this.buildPuzzlePillars();
  }

  /** Spawn terrain obstacles (rocks/pillars) in the world */
  spawnObstacles(obstacles: { pos: Vec3; radius: number }[]): void {
    for (let i = 0; i < obstacles.length; i++) {
      const obstacle = obstacles[i];
      const pillar = MeshBuilder.CreateCylinder(`obstacle_${i}`, {
        height: 3 + Math.random() * 2,
        diameter: obstacle.radius * 2,
        tessellation: 8,
      }, this.scene);
      pillar.position = new Vector3(obstacle.pos.x, (3 + Math.random()) / 2, obstacle.pos.z);

      const mat = new StandardMaterial(`obstacleMat_${i}`, this.scene);
      mat.diffuseColor = new Color3(0.35, 0.3, 0.25); // dark stone
      mat.specularColor = new Color3(0.1, 0.1, 0.1);
      pillar.material = mat;

      // Cast and receive shadows
      this.renderer.shadowGenerator.addShadowCaster(pillar);
      pillar.receiveShadows = true;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  ENEMY SPRITE LOADING
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Asynchronously load all sprite PNGs (enemies, player, boss, VFX) and process them
   * to remove white backgrounds. Uses canvas-based processing to convert near-white
   * pixels to transparent. Each load is independent — failures don't break others.
   */
  private async loadEnemySprites(): Promise<void> {
    // Load enemy sprites (with individual error handling)
    try {
      this.enemySpriteTextures.sprite1 = await this.loadAndProcessSprite('sprite_enemy.png');
    } catch (err) {
      console.warn('Failed to load sprite_enemy.png:', err);
      this.enemySpriteTextures.sprite1 = null;
    }

    try {
      this.enemySpriteTextures.sprite2 = await this.loadAndProcessSprite('sprite_enemy2.png');
    } catch (err) {
      console.warn('Failed to load sprite_enemy2.png:', err);
      this.enemySpriteTextures.sprite2 = null;
    }

    // Load type-specific Rakshasa sprites
    for (const type of ['soldier', 'archer', 'brute'] as const) {
      try {
        this.enemySpriteTextures[type] = await this.loadAndProcessSprite(`sprite_rakshasa_${type}.png`);
      } catch (err) {
        console.warn(`Failed to load sprite_rakshasa_${type}.png:`, err);
      }
    }

    // Load wildlife sprites
    try { this.birdSpriteTexture = await this.loadAndProcessSprite('sprite_bird.png'); }
    catch { this.birdSpriteTexture = null; }
    try { this.deerSpriteTexture = await this.loadAndProcessSprite('sprite_deer.png'); }
    catch { this.deerSpriteTexture = null; }

    // Load campfire and torch sprites
    try { this.campfireSpriteTexture = await this.loadAndProcessSprite('sprite_campfire.png'); }
    catch { this.campfireSpriteTexture = null; }
    try { this.torchFlameSpriteTexture = await this.loadAndProcessSprite('sprite_torch_flame.png'); }
    catch { this.torchFlameSpriteTexture = null; }

    // Load player sprite
    try {
      this.playerSpriteTexture = await this.loadAndProcessSprite('sprite_player.png');
    } catch (err) {
      console.warn('Failed to load sprite_player.png:', err);
      this.playerSpriteTexture = null;
    }

    // Load boss sprite
    try {
      this.bossSpriteTexture = await this.loadAndProcessSprite('sprite_boss.png');
    } catch (err) {
      console.warn('Failed to load sprite_boss.png:', err);
      this.bossSpriteTexture = null;
    }

    // Load NPC ally sprites
    const npcSpriteFiles: Record<string, string> = {
      'sage': 'sprite_sage_agastya.png',
      'jatayu': 'sprite_jatayu.png',
      'sugriv': 'sprite_sugriv.png',
      'jambavan': 'sprite_jambavan.png',
      'sampati': 'sprite_sampati.png',
      'angad': 'sprite_angad.png',
      'vibhishana': 'sprite_vibhishana.png',
      'hanuman': 'sprite_hanuman.png',
      'lakshman': 'sprite_lakshman.png',
    };
    for (const [npcId, file] of Object.entries(npcSpriteFiles)) {
      try {
        this.npcSpriteTextures.set(npcId, await this.loadAndProcessSprite(file));
      } catch (err) {
        console.warn(`Failed to load NPC sprite ${file}:`, err);
      }
    }

    // Load VFX trail textures
    const vfxFiles = [
      'vfx_agni_trail.png',
      'vfx_vayu_trail.png',
      'vfx_varuna_trail.png',
      'vfx_naga_trail.png',
      'vfx_brahma_trail.png',
    ];

    for (const file of vfxFiles) {
      try {
        const key = file.replace('.png', '');
        this.vfxTextures.set(key, await this.loadAndProcessSprite(file));
      } catch (err) {
        console.warn(`Failed to load VFX sprite ${file}:`, err);
      }
    }
  }

  /**
   * Load a sprite image directly as a Texture (preserves native RGBA alpha).
   * Skips canvas processing which was corrupting transparent edge pixels via premultiplied alpha.
   */
  private loadAndProcessSprite(imagePath: string): Promise<Texture> {
    return new Promise((resolve, reject) => {
      const url = 'textures/' + imagePath;
      const tex = new Texture(url, this.scene, false, true, Texture.BILINEAR_SAMPLINGMODE,
        () => resolve(tex),   // onLoad
        (_msg, err) => reject(err || new Error(`Failed to load sprite: ${imagePath}`)),  // onError
      );
      tex.hasAlpha = true;
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  MATERIAL HELPER — texture-or-fallback
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Returns a loaded PBR material if available, otherwise creates a flat-colour fallback.
   * @param textureName — key in LoadedAssets.materials (e.g. "ground_jungle")
   * @param fallbackKey — unique cache key for the fallback material
   */
  private getMat(
    textureName: string, fallbackKey: string,
    r: number, g: number, b: number,
    metallic: number, roughness: number,
    er = 0, eg = 0, eb = 0,
  ): PBRMaterial {
    // Prefer loaded texture material
    if (this.assets?.materials.has(textureName)) {
      return this.assets.materials.get(textureName)!;
    }
    // Fallback: flat-colour PBR
    return this.mkMat(fallbackKey, r, g, b, metallic, roughness, er, eg, eb);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  WORLD GEOMETRY
  // ══════════════════════════════════════════════════════════════════════════

  private buildGround(): void {
    // Subdivided ground for vertex color variation (pseudo-terrain)
    // Larger ground for 800x800 world
    const ground = MeshBuilder.CreateGround('ground_main', {
      width: C.WORLD_SIZE * 1.2,
      height: C.WORLD_SIZE * 1.2,
      subdivisions: 128,  // Increased resolution for larger world
      updatable: true,  // A-01: Changed to true for vertex displacement
    }, this.scene);
    ground.position.y = 0;
    ground.receiveShadows = true;

    // A-01: Apply heightmap displacement to ground vertices
    let positions = ground.getVerticesData('position');
    if (positions) {
      const newPositions = new Float32Array(positions);
      for (let i = 0; i < newPositions.length; i += 3) {
        const wx = newPositions[i];     // x
        const wz = newPositions[i + 2]; // z
        const amp = biomeAmplitude(wz);
        newPositions[i + 1] = terrainNoise(wx, wz) * amp;
      }
      ground.updateVerticesData('position', newPositions);
      ground.createNormals(true);  // Recompute normals
    }

    // PBR ground material
    const groundMat = new PBRMaterial('groundMat', this.scene);
    const groundPBR = this.assets?.materials.get('ground_jungle');
    if (groundPBR?.albedoTexture) {
      groundMat.albedoTexture = groundPBR.albedoTexture;
      (groundMat.albedoTexture as Texture).uScale = 20;  // Increased tiling for larger world
      (groundMat.albedoTexture as Texture).vScale = 20;
    }
    if (groundPBR?.bumpTexture) {
      groundMat.bumpTexture = groundPBR.bumpTexture;
      (groundMat.bumpTexture as Texture).uScale = 20;
      (groundMat.bumpTexture as Texture).vScale = 20;
    }
    groundMat.albedoColor = new Color3(0.15, 0.28, 0.1); // lush green base
    groundMat.metallic = 0.0;
    groundMat.roughness = 0.95;
    ground.material = groundMat;

    // A-02: Store ground mesh reference for biome color changes
    this.groundMesh = ground;

    // T2-4: Apply biome vertex colors per chapter zone based on Z position
    const colors = new Float32Array((positions?.length ?? 0) * 4 / 3);
    positions = ground.getVerticesData('position');
    if (positions) {
      for (let i = 0; i < positions.length; i += 3) {
      const z = positions[i + 2];
      let r = 0.15, g = 0.28, b = 0.1; // Default Ch0 lush green

      if (z > -50) {
        // Ch0 (z > -50): Lush green (Panchavati forest)
        r = 0.18; g = 0.32; b = 0.12;
      } else if (z > -150) {
        // Ch1 (z -50 to -150): Dark forest (Dandaka)
        r = 0.12; g = 0.22; b = 0.08;
      } else if (z > -250) {
        // Ch2 (z -150 to -250): Scorched earth (Jatayu's Fall)
        r = 0.25; g = 0.15; b = 0.08;
      } else if (z > -380) {
        // Ch3 (z -250 to -380): Rocky highland (Kishkindha)
        r = 0.35; g = 0.3; b = 0.2;
      } else if (z > -490) {
        // Ch4 (z -380 to -490): Sandy shore (Southern Shore)
        r = 0.55; g = 0.48; b = 0.35;
      } else if (z > -580) {
        // Ch5 (z -490 to -580): Wet stone (Ram Setu)
        r = 0.3; g = 0.35; b = 0.38;
      } else {
        // Ch6+ (z < -580): Dark volcanic (Lanka)
        r = 0.15; g = 0.1; b = 0.08;
      }

      const colorIdx = (i / 3) * 4;
      colors[colorIdx] = r;
      colors[colorIdx + 1] = g;
      colors[colorIdx + 2] = b;
      colors[colorIdx + 3] = 1.0; // Alpha
      }
      ground.setVerticesData(VertexBuffer.ColorKind, colors);
    }

    // Add scattered ground cover: upright triangular grass blades
    const rng = mulberry32(9999);

    // Grass blade patches (~1200 blades = 200 * 6x for larger world)
    for (let i = 0; i < 1200; i++) {
      const x = (rng() - 0.5) * C.WORLD_SIZE;
      const z = (rng() - 0.5) * C.WORLD_SIZE;
      // Skip near spawn
      if (Math.abs(x) < 8 && Math.abs(z) < 8) continue;

      // Create upright plane blade
      const blade = MeshBuilder.CreatePlane(`grassBlade_${i}`, {
        width: 0.08,
        height: 0.3 + rng() * 0.2, // 0.3-0.5 height
      }, this.scene);

      // Keep blade upright (no rotation.x), slight random tilt around Y
      blade.rotation.y = rng() * Math.PI * 2;
      blade.position.set(x, 0.15 + rng() * 0.05, z);

      const bladeMat = new StandardMaterial(`grassBladeMat_${i}`, this.scene);
      // Various shades of green
      bladeMat.diffuseColor = new Color3(
        0.08 + rng() * 0.08,
        0.25 + rng() * 0.25,
        0.04 + rng() * 0.08
      );
      bladeMat.specularColor = new Color3(0, 0, 0);
      bladeMat.backFaceCulling = false;
      blade.material = bladeMat;
    }

    // Add flower patches: small colored spheres in clusters (~50 clusters = 8 * 6x)
    for (let cluster = 0; cluster < 50; cluster++) {
      const cx = (rng() - 0.5) * C.WORLD_SIZE * 0.8;
      const cz = (rng() - 0.5) * C.WORLD_SIZE * 0.8;
      // Skip near spawn
      if (Math.abs(cx) < 10 && Math.abs(cz) < 10) continue;

      // 3-5 flowers per cluster
      const flowerCount = 3 + Math.floor(rng() * 3);
      const colors = [
        new Color3(1.0, 0.2, 0.4),    // pink
        new Color3(1.0, 0.85, 0.2),   // yellow
        new Color3(1.0, 1.0, 1.0),    // white
      ];

      for (let f = 0; f < flowerCount; f++) {
        const flower = MeshBuilder.CreateSphere(`flower_${cluster}_${f}`, {
          diameter: 0.1,
          segments: 6,
        }, this.scene);

        flower.position.set(
          cx + (rng() - 0.5) * 1.0,
          0.05,
          cz + (rng() - 0.5) * 1.0
        );

        const flowerMat = new StandardMaterial(`flowerMat_${cluster}_${f}`, this.scene);
        flowerMat.diffuseColor = colors[Math.floor(rng() * colors.length)];
        flowerMat.specularColor = new Color3(0.2, 0.2, 0.2);
        flower.material = flowerMat;
      }
    }

    // Rocks scattered around (small gray boulders) (~180 rocks = 30 * 6x)
    const rockMat = new StandardMaterial('rockMat', this.scene);
    rockMat.diffuseColor = new Color3(0.4, 0.38, 0.35);
    rockMat.specularColor = new Color3(0.1, 0.1, 0.1);

    for (let i = 0; i < 180; i++) {
      const x = (rng() - 0.5) * C.WORLD_SIZE;
      const z = (rng() - 0.5) * C.WORLD_SIZE;
      if (Math.abs(x) < 10 && Math.abs(z) < 10) continue;

      const rock = MeshBuilder.CreateSphere(`rock_${i}`, {
        diameter: 0.4 + rng() * 0.8,
        segments: 5,
      }, this.scene);
      rock.position.set(x, 0.15, z);
      rock.scaling.set(1, 0.5 + rng() * 0.3, 1); // flatten to boulder shape
      rock.rotation.y = rng() * Math.PI * 2;
      rock.material = rockMat;
      if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(rock);
    }
  }

  private buildTrees(): void {
    const rng = mulberry32(12345);
    const treeCount = C.TREE_COUNT;

    // Master tree mesh: tall thin trunk with single large canopy above player
    const trunkHeight = (C.TREE_TRUNK_HEIGHT_MIN + C.TREE_TRUNK_HEIGHT_MAX) / 2; // ~17
    const masterTrunk = MeshBuilder.CreateCylinder('masterTrunk', {
      height: trunkHeight,
      diameterTop: C.TREE_TRUNK_DIAMETER * 0.4,
      diameterBottom: C.TREE_TRUNK_DIAMETER,
      tessellation: 8
    }, this.scene);
    masterTrunk.position.y = trunkHeight / 2;
    masterTrunk.setEnabled(false);

    const trunkMat = new StandardMaterial('treeTrunkMat', this.scene);
    trunkMat.diffuseColor = new Color3(0.35, 0.22, 0.1);
    trunkMat.specularColor = new Color3(0, 0, 0);
    masterTrunk.material = trunkMat;

    // Single large canopy sphere positioned high above ground (above camera at Y=8)
    const canopyMat = new StandardMaterial('canopyMat', this.scene);
    canopyMat.diffuseColor = new Color3(0.15, 0.4, 0.1);  // forest green
    canopyMat.specularColor = new Color3(0, 0, 0);

    const masterCanopy = MeshBuilder.CreateSphere('masterCanopy', {
      diameter: (C.TREE_CANOPY_RADIUS_MIN + C.TREE_CANOPY_RADIUS_MAX),
      segments: 8
    }, this.scene);
    masterCanopy.position.y = C.TREE_CANOPY_HEIGHT;  // High up at Y=18
    masterCanopy.material = canopyMat;
    masterCanopy.setEnabled(false);

    // Place trees throughout world, with denser forest in Ch0-3 zones
    for (let i = 0; i < treeCount; i++) {
      const x = (rng() - 0.5) * C.WORLD_SIZE;
      const z = (rng() - 0.5) * C.WORLD_SIZE;

      // Skip near spawn
      if (Math.abs(x) < 5 && Math.abs(z) < 5) continue;

      // Skip near boss arena
      const dBoss = Math.sqrt((x - C.BOSS_ARENA_CENTER.x) ** 2 + (z - C.BOSS_ARENA_CENTER.z) ** 2);
      if (dBoss < C.BOSS_ARENA_RADIUS + 10) continue;

      // Skip near Ram Setu bridge path
      const nearBridge = Math.abs(x - ((C.RAM_SETU_START.x + C.RAM_SETU_END.x) / 2)) < 20 &&
                         Math.abs(z - ((C.RAM_SETU_START.z + C.RAM_SETU_END.z) / 2)) < 100;
      if (nearBridge) continue;

      // Scale variation: 0.7 to 1.3
      const scale = 0.7 + rng() * 0.6;
      const yRot = rng() * Math.PI * 2;

      // Trunk instance
      const trunk = masterTrunk.createInstance(`tree_trunk_${i}`);
      const trunkHeightScaled = trunkHeight * scale;
      trunk.position.set(x, trunkHeightScaled / 2, z);
      trunk.scaling.setAll(scale);
      trunk.rotation.y = yRot;
      if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(trunk);
      this.treeInstances.push(trunk);

      // Single canopy instance positioned at top of trunk
      const canopy = masterCanopy.createInstance(`tree_canopy_${i}`);
      canopy.position.set(x, (C.TREE_CANOPY_HEIGHT - 2) * scale + trunkHeightScaled * 0.5, z);
      canopy.scaling.setAll(scale);
      canopy.rotation.y = yRot;
      this.treeInstances.push(canopy);
    }
  }

  private buildBossArena(): void {
    const c = C.BOSS_ARENA_CENTER;
    const r = C.BOSS_ARENA_RADIUS;

    // A-08: Arena floor — golden Lanka disc
    const floor = MeshBuilder.CreateDisc('bossArenaFloor', { radius: r, tessellation: 32 }, this.scene);
    floor.rotation.x = Math.PI / 2;
    floor.position.set(c.x, 0.05, c.z);
    const floorMat = new StandardMaterial('arenaFloorMat', this.scene);
    floorMat.diffuseColor = new Color3(0.8, 0.65, 0.2);  // golden
    floorMat.emissiveColor = new Color3(0.15, 0.1, 0.02);  // warm amber glow
    floorMat.specularColor = new Color3(0.1, 0.05, 0.05);
    floor.material = floorMat;
    this.bossArenaMeshes.push(floor);

    // A-08: Raised edge ring (torus) — golden
    const ring = MeshBuilder.CreateTorus('bossArenaRing', { diameter: r * 2, thickness: 0.8, tessellation: 32 }, this.scene);
    ring.position.set(c.x, 0.3, c.z);
    const ringMat = new StandardMaterial('arenaRingMat', this.scene);
    ringMat.diffuseColor = new Color3(0.75, 0.6, 0.15);  // golden
    ringMat.emissiveColor = new Color3(0.2, 0.15, 0.03);  // amber glow
    ring.material = ringMat;
    this.bossArenaMeshes.push(ring);

    // A-08: Center platform (raised disc) — golden
    const centerPlat = MeshBuilder.CreateCylinder('bossCenterPlat', { height: 0.4, diameter: 5, tessellation: 16 }, this.scene);
    centerPlat.position.set(c.x, 0.2, c.z);
    const centerMat = new StandardMaterial('centerPlatMat', this.scene);
    centerMat.diffuseColor = new Color3(0.8, 0.65, 0.2);
    centerMat.emissiveColor = new Color3(0.1, 0.03, 0.02);
    centerPlat.material = centerMat;
    this.bossArenaMeshes.push(centerPlat);

    // A-08: Arena pillars around the edge (8 pillars) — golden/amber
    const pillarMat = new StandardMaterial('arenaPillarMat', this.scene);
    pillarMat.diffuseColor = new Color3(0.85, 0.7, 0.15);  // gold
    pillarMat.emissiveColor = new Color3(0.2, 0.15, 0.02);  // amber glow

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const px = c.x + Math.cos(angle) * (r - 1);
      const pz = c.z + Math.sin(angle) * (r - 1);

      const pillar = MeshBuilder.CreateCylinder(`arenaPillar_${i}`, { height: 6, diameter: 0.8, tessellation: 8 }, this.scene);
      pillar.position.set(px, 3, pz);
      pillar.material = pillarMat;
      if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(pillar);
      this.bossArenaMeshes.push(pillar);

      // A-08: Crystal orb atop each pillar — bright golden emissive
      const orb = MeshBuilder.CreateSphere(`arenaOrb_${i}`, { diameter: 0.6, segments: 6 }, this.scene);
      orb.position.set(px, 6.5, pz);
      const orbMat = new StandardMaterial(`arenaOrbMat_${i}`, this.scene);
      orbMat.emissiveColor = new Color3(1.0, 0.85, 0.4);  // bright golden
      orbMat.disableLighting = true;
      orb.material = orbMat;
      this.bossArenaMeshes.push(orb);
    }

    // A-08: Golden light veins (replace lava veins)
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const vein = MeshBuilder.CreatePlane(`lavaVein_${i}`, { width: 0.3, height: r * 0.8 }, this.scene);
      vein.rotation.x = Math.PI / 2;
      vein.rotation.y = angle;
      vein.position.set(c.x + Math.cos(angle) * r * 0.4, 0.07, c.z + Math.sin(angle) * r * 0.4);
      const veinMat = new StandardMaterial(`lavaVeinMat_${i}`, this.scene);
      veinMat.emissiveColor = new Color3(1.0, 0.8, 0.2);  // golden light
      veinMat.disableLighting = true;
      veinMat.alpha = 0.6;
      veinMat.backFaceCulling = false;
      vein.material = veinMat;
      this.bossArenaMeshes.push(vein);
    }

    // A-08: Four tall crystal spire towers around the arena
    const spireRadius = r + 5;
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const px = c.x + Math.cos(angle) * spireRadius;
      const pz = c.z + Math.sin(angle) * spireRadius;

      const spire = MeshBuilder.CreateCylinder(`arenaSpire_${i}`, {
        diameterBottom: 1.2,
        diameterTop: 0.2,
        height: 12,
        tessellation: 8
      }, this.scene);
      spire.position.set(px, 6, pz);
      const spireMat = new StandardMaterial(`arenaSpireMat_${i}`, this.scene);
      spireMat.diffuseColor = new Color3(0.95, 0.85, 0.4);  // translucent gold
      spireMat.emissiveColor = new Color3(0.9, 0.75, 0.3);  // golden glow
      spireMat.alpha = 0.7;
      spire.material = spireMat;
      if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(spire);
      this.bossArenaMeshes.push(spire);
    }

    // A-08: Gate archway at the south side (approach from Ch6)
    // Two tall pillars with a connecting beam on top
    const gateLeft = MeshBuilder.CreateCylinder('gateLeftPillar', {
      height: 8,
      diameter: 0.6,
      tessellation: 8
    }, this.scene);
    gateLeft.position.set(c.x - 4, 4, c.z - (r + 3));
    const gateMat = new StandardMaterial('gateMat', this.scene);
    gateMat.diffuseColor = new Color3(0.8, 0.65, 0.2);
    gateMat.emissiveColor = new Color3(0.15, 0.1, 0.02);
    gateLeft.material = gateMat;
    if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(gateLeft);
    this.bossArenaMeshes.push(gateLeft);

    const gateRight = MeshBuilder.CreateCylinder('gateRightPillar', {
      height: 8,
      diameter: 0.6,
      tessellation: 8
    }, this.scene);
    gateRight.position.set(c.x + 4, 4, c.z - (r + 3));
    gateRight.material = gateMat;
    if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(gateRight);
    this.bossArenaMeshes.push(gateRight);

    const gateBeam = MeshBuilder.CreateBox('gateBeam', {
      width: 8,
      height: 0.5,
      depth: 0.8
    }, this.scene);
    gateBeam.position.set(c.x, 8, c.z - (r + 3));
    gateBeam.material = gateMat;
    if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(gateBeam);
    this.bossArenaMeshes.push(gateBeam);
  }

  private buildRamSetuBridge(): void {
    // Build traversable stone bridge from RAM_SETU_START to RAM_SETU_END
    const start = C.RAM_SETU_START;
    const end = C.RAM_SETU_END;
    const width = C.RAM_SETU_WIDTH;

    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const bridgeLength = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dx, dz);

    // Build bridge from 20-30 stone segments
    const segmentCount = 25;
    const segmentLength = bridgeLength / segmentCount;
    const stoneMat = new StandardMaterial('stoneMat', this.scene);
    stoneMat.diffuseColor = new Color3(0.5, 0.45, 0.4);
    stoneMat.specularColor = new Color3(0.15, 0.15, 0.15);

    const rng = mulberry32(555);

    for (let i = 0; i < segmentCount; i++) {
      const t = i / (segmentCount - 1);
      const segX = start.x + dx * t;
      const segZ = start.z + dz * t;
      const segY = 0.5 + Math.sin(t * Math.PI) * 0.5; // Slight arc above water

      // Stone segment (box)
      const segment = MeshBuilder.CreateBox(`bridgeSegment_${i}`, {
        width: width,
        height: 0.4,
        depth: segmentLength * 1.1
      }, this.scene);

      segment.position.set(segX, segY, segZ);
      segment.rotation.y = angle;
      const randomYOffset = (rng() - 0.5) * 0.1;
      segment.position.y += randomYOffset;
      segment.material = stoneMat;

      if (this.renderer.shadowGenerator) {
        this.renderer.shadowGenerator.addShadowCaster(segment);
      }
    }

    // Low wall edges on both sides (0.5m high boxes)
    const wallHeight = 0.5;
    const wallMat = new StandardMaterial('wallMat', this.scene);
    wallMat.diffuseColor = new Color3(0.45, 0.4, 0.35);
    wallMat.specularColor = new Color3(0.1, 0.1, 0.1);

    for (let i = 0; i < segmentCount; i++) {
      const t = i / (segmentCount - 1);
      const segX = start.x + dx * t;
      const segZ = start.z + dz * t;
      const segY = 0.5 + Math.sin(t * Math.PI) * 0.5;

      // Left wall
      const wallL = MeshBuilder.CreateBox(`wallL_${i}`, {
        width: 0.3,
        height: wallHeight,
        depth: segmentLength * 1.1
      }, this.scene);
      wallL.position.set(segX - Math.cos(angle) * (width / 2 + 0.15), segY + wallHeight / 2, segZ - Math.sin(angle) * (width / 2 + 0.15));
      wallL.rotation.y = angle;
      wallL.material = wallMat;

      // Right wall
      const wallR = MeshBuilder.CreateBox(`wallR_${i}`, {
        width: 0.3,
        height: wallHeight,
        depth: segmentLength * 1.1
      }, this.scene);
      wallR.position.set(segX + Math.cos(angle) * (width / 2 + 0.15), segY + wallHeight / 2, segZ + Math.sin(angle) * (width / 2 + 0.15));
      wallR.rotation.y = angle;
      wallR.material = wallMat;
    }

    // Carved "RAMA" text at midpoint (glowing disc)
    const midX = (start.x + end.x) / 2;
    const midZ = (start.z + end.z) / 2;
    const midY = 0.5 + 0.5; // At arc peak
    const ramaDisc = MeshBuilder.CreateDisc('ramaDisc', { radius: 1.5, tessellation: 32 }, this.scene);
    ramaDisc.rotation.x = Math.PI / 2;
    ramaDisc.position.set(midX, midY + 0.2, midZ);
    const ramaMat = new StandardMaterial('ramaMat', this.scene);
    ramaMat.emissiveColor = new Color3(1.0, 0.85, 0.3);
    ramaMat.diffuseColor = new Color3(0.8, 0.7, 0.2);
    ramaMat.disableLighting = true;
    ramaDisc.material = ramaMat;
  }

  private buildSkybox(): void {
    // Create gradient hemisphere dome skybox using DynamicTexture
    const textureSize = 512;
    const domeTexture = new DynamicTexture('skyDomeTexture', textureSize, this.scene);
    const ctx = domeTexture.getContext();

    // Paint vertical gradient from dark indigo at top to warm amber at horizon
    for (let y = 0; y < textureSize; y++) {
      const t = y / textureSize;

      // Interpolate from dark indigo (top) to warm amber (horizon)
      const r = 0.1 + t * 0.8;     // 0.1 to 0.9
      const g = 0.05 + t * 0.6;    // 0.05 to 0.65
      const b = 0.3 - t * 0.2;     // 0.3 to 0.1

      const color = `rgb(${Math.floor(r * 255)}, ${Math.floor(g * 255)}, ${Math.floor(b * 255)})`;
      ctx.fillStyle = color;
      ctx.fillRect(0, y, textureSize, 1);
    }

    // Add ~70 small white star dots randomly placed in upper half
    const rng = mulberry32(777);
    ctx.fillStyle = 'white';
    for (let i = 0; i < 70; i++) {
      const x = rng() * textureSize;
      const y = rng() * textureSize * 0.5; // Only upper half
      const radius = 0.5 + rng() * 1.0;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    domeTexture.update();

    // Create hemisphere dome mesh
    const skybox = MeshBuilder.CreateSphere('skybox', { diameter: 1000, segments: 32 }, this.scene);
    skybox.scaling.y = 0.5; // Make it flatter (dome shape)

    const skyMat = new StandardMaterial('skyMat', this.scene);
    skyMat.emissiveTexture = domeTexture;
    skyMat.backFaceCulling = false;
    skyMat.disableLighting = true;
    skyMat.specularColor = new Color3(0, 0, 0);

    skybox.material = skyMat;
    skybox.infiniteDistance = true;
  }

  private buildGlowLayer(): void {
    const gl = new GlowLayer('glow', this.scene);
    gl.intensity = 0.6;
  }

  /**
   * Floating ember particles distributed across the whole map.
   * Uses loaded particle_ember texture if available, otherwise 1×1 white PNG.
   */
  private buildAmbientParticles(): void {
    const WHITE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    // Try to use loaded ember texture
    const emberTex = this.assets?.textures.get('particle_ember_albedo') ?? null;

    // ── Dust/Fireflies (soft floating particles) ──────────────────────────
    const embers = new ParticleSystem('embers', 250, this.scene);
    embers.particleTexture = emberTex ?? new Texture(WHITE_PNG, this.scene);
    embers.emitter = new Vector3(0, 1, 0);
    embers.minEmitBox = new Vector3(-C.WORLD_SIZE * 0.65, 0, -C.WORLD_SIZE * 0.65);
    embers.maxEmitBox = new Vector3( C.WORLD_SIZE * 0.65, 4,  C.WORLD_SIZE * 0.65);
    embers.color1      = new Color4(0.8, 0.75, 0.6, 0.6);
    embers.color2      = new Color4(0.9, 0.85, 0.7, 0.5);
    embers.colorDead   = new Color4(0.7, 0.65, 0.5, 0.0);
    embers.minSize     = 0.02;
    embers.maxSize     = 0.08;
    embers.minLifeTime = 3;
    embers.maxLifeTime = 6;
    embers.emitRate    = 15;
    embers.direction1  = new Vector3(-0.05, 0.1, -0.05);
    embers.direction2  = new Vector3( 0.05, 0.3,  0.05);
    embers.gravity     = new Vector3(0, -0.01, 0);
    embers.minEmitPower = 0.1;
    embers.maxEmitPower = 0.3;
    embers.updateSpeed  = 0.016;
    embers.blendMode    = ParticleSystem.BLENDMODE_STANDARD;
    embers.start();
    this.emberParticles = embers;

    // ── Ash drift (slow-falling dark flakes) ─────────────────────────
    const ash = new ParticleSystem('ash', 120, this.scene);
    ash.particleTexture = new Texture(WHITE_PNG, this.scene);
    ash.emitter    = new Vector3(0, 12, 0);
    ash.minEmitBox = new Vector3(-C.WORLD_SIZE * 0.5, 0, -C.WORLD_SIZE * 0.5);
    ash.maxEmitBox = new Vector3( C.WORLD_SIZE * 0.5, 2,  C.WORLD_SIZE * 0.5);
    ash.color1     = new Color4(0.25, 0.2, 0.18, 0.7);
    ash.color2     = new Color4(0.18, 0.14, 0.12, 0.5);
    ash.colorDead  = new Color4(0.1, 0.08, 0.06, 0.0);
    ash.minSize    = 0.06;
    ash.maxSize    = 0.22;
    ash.minLifeTime = 8;
    ash.maxLifeTime = 14;
    ash.emitRate   = 12;
    ash.direction1 = new Vector3(-0.3, -0.4, -0.3);
    ash.direction2 = new Vector3( 0.3, -0.1,  0.3);
    ash.gravity    = new Vector3(0, -0.3, 0);
    ash.minEmitPower = 0.1;
    ash.maxEmitPower = 0.5;
    ash.updateSpeed  = 0.014;
    ash.blendMode    = ParticleSystem.BLENDMODE_STANDARD;
    ash.start();
    this.ashParticles = ash;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  MESH HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Create (or retrieve cached) PBR material.
   * Key must be globally unique across all entities.
   */
  private mkMat(
    key: string,
    r: number, g: number, b: number,
    metallic: number, roughness: number,
    er = 0, eg = 0, eb = 0,
  ): PBRMaterial {
    if (this.matCache.has(key)) return this.matCache.get(key)!;
    const mat = new PBRMaterial(key, this.scene);
    mat.albedoColor = new Color3(r, g, b);
    mat.metallic = metallic;
    mat.roughness = roughness;
    if (er || eg || eb) mat.emissiveColor = new Color3(er, eg, eb);
    this.matCache.set(key, mat);
    return mat;
  }

  private mkBox(
    name: string, w: number, h: number, d: number,
    mat: PBRMaterial, parent: TransformNode | Mesh,
    px: number, py: number, pz: number,
    rx = 0, ry = 0, rz = 0,
  ): Mesh {
    const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
    m.parent = parent;
    m.position.set(px, py, pz);
    if (rx || ry || rz) m.rotation.set(rx, ry, rz);
    m.material = mat;
    return m;
  }

  private mkCyl(
    name: string, h: number, dTop: number, dBot: number, tess: number,
    mat: PBRMaterial, parent: TransformNode | Mesh,
    px: number, py: number, pz: number,
    rx = 0, ry = 0, rz = 0,
  ): Mesh {
    const m = MeshBuilder.CreateCylinder(name, { height: h, diameterTop: dTop, diameterBottom: dBot, tessellation: tess }, this.scene);
    m.parent = parent;
    m.position.set(px, py, pz);
    if (rx || ry || rz) m.rotation.set(rx, ry, rz);
    m.material = mat;
    return m;
  }

  private mkSph(
    name: string, diameter: number, segments: number,
    mat: PBRMaterial, parent: TransformNode | Mesh,
    px: number, py: number, pz: number,
  ): Mesh {
    const m = MeshBuilder.CreateSphere(name, { diameter, segments }, this.scene);
    m.parent = parent;
    m.position.set(px, py, pz);
    m.material = mat;
    return m;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  PLAYER MESHES  (N64-style Rama Agent — ~22 parts)
  // ══════════════════════════════════════════════════════════════════════════

  addPlayerMesh(id: number, isLocal: boolean): void {
    if (this.playerMeshes.has(id)) return;
    const root = this._buildPlayerParts(id, isLocal);
    this.playerMeshes.set(id, root);
  }

  private _buildPlayerParts(id: number, isLocal: boolean): TransformNode {
    const n = `p${id}_`;
    const root = new TransformNode(`player_${id}`, this.scene);

    // Check if we have player sprite loaded and can use billboard rendering
    if (this.playerSpriteTexture !== null) {
      const billboardPlane = MeshBuilder.CreatePlane(`${n}billboard`, { size: 1 }, this.scene);
      billboardPlane.parent = root;
      billboardPlane.billboardMode = Mesh.BILLBOARDMODE_Y;
      // Sprites are 512x912 aspect ratio (~0.56), scale: width=1.4, height=2.5
      billboardPlane.scaling.set(1.4, 2.5, 1);
      // Offset Y so sprite bottom sits at feet (root position), not centered at feet
      billboardPlane.position.y = 1.25;

      const billboardMat = new StandardMaterial(`${n}billboardMat`, this.scene);
      billboardMat.diffuseTexture = this.playerSpriteTexture;
      billboardMat.useAlphaFromDiffuseTexture = true;
      billboardMat.emissiveColor = new Color3(0.15, 0.12, 0.1); // subtle self-illumination
      billboardMat.specularColor = new Color3(0, 0, 0); // no specular shine
      billboardMat.backFaceCulling = false;
      billboardPlane.material = billboardMat;

      // T2-6: Add divine aura glow sphere around player
      const auraSphere = MeshBuilder.CreateSphere(`${n}auraSphere`, { diameter: 2.5, segments: 16 }, this.scene);
      auraSphere.parent = root;
      auraSphere.position.y = 1.25; // Center on player
      const auraMat = new StandardMaterial(`${n}auraMat`, this.scene);
      auraMat.alpha = 0.08;
      auraMat.emissiveColor = new Color3(1.0, 0.85, 0.4); // Gold
      auraMat.diffuseColor = new Color3(0, 0, 0); // Transparent diffuse
      auraSphere.material = auraMat;

      return root;
    }

    // ── Palette ──────────────────────────────────────────────────────
    // Local player: deep navy + gold   Remote: teal + silver
    const [ar, ag, ab] = isLocal ? [0.08, 0.18, 0.6] : [0.04, 0.38, 0.28];
    const [gr, gg, gb] = isLocal ? [0.15, 0.65, 1.0] : [0.3, 1.0, 0.5];

    // Flat-colour PBR — textures don't map well onto primitive geometry
    const mArmor = this.mkMat(`${n}armor`, ar, ag, ab, 0.45, 0.5);
    const mGold  = this.mkMat(`${n}gold`,  0.72, 0.55, 0.05, 0.75, 0.3);
    const mDark  = this.mkMat(`${n}dark`,  0.1, 0.1, 0.12, 0.6, 0.5);
    const mSkin  = this.mkMat(`${n}skin`,  0.78, 0.58, 0.42, 0.0, 0.85);
    const mVisor = this.mkMat(`${n}visor`, gr * 0.4, gg * 0.4, gb * 0.4, 0.2, 0.3, gr * 0.7, gg * 0.7, gb * 0.7);
    const mBow   = this.mkMat(`${n}bow`,   0.42, 0.26, 0.08, 0.1, 0.65);

    // ── Boots ─────────────────────────────────────────────────────────
    this.mkBox(`${n}bootL`, 0.22, 0.14, 0.28, mDark, root, -0.12, 0.07, 0.02);
    this.mkBox(`${n}bootR`, 0.22, 0.14, 0.28, mDark, root,  0.12, 0.07, 0.02);

    // ── Shins ─────────────────────────────────────────────────────────
    this.mkBox(`${n}shinL`, 0.17, 0.36, 0.18, mArmor, root, -0.12, 0.33, 0);
    this.mkBox(`${n}shinR`, 0.17, 0.36, 0.18, mArmor, root,  0.12, 0.33, 0);

    // ── Thighs ────────────────────────────────────────────────────────
    this.mkBox(`${n}thighL`, 0.2, 0.38, 0.2, mArmor, root, -0.12, 0.66, 0);
    this.mkBox(`${n}thighR`, 0.2, 0.38, 0.2, mArmor, root,  0.12, 0.66, 0);

    // ── Hips / belt ───────────────────────────────────────────────────
    this.mkBox(`${n}hips`,   0.45, 0.18, 0.24, mArmor, root, 0, 0.88, 0);
    this.mkBox(`${n}belt`,   0.46, 0.06, 0.26, mGold,  root, 0, 0.97, 0);

    // ── Torso ─────────────────────────────────────────────────────────
    const torso = this.mkBox(`${n}torso`, 0.48, 0.52, 0.28, mArmor, root, 0, 1.23, 0);
    this.renderer.shadowGenerator.addShadowCaster(torso);

    // Chest plate (front face of torso)
    this.mkBox(`${n}chest`, 0.42, 0.44, 0.05, mGold,  root, 0,      1.23, -0.165);
    // Back plate
    this.mkBox(`${n}back`,  0.42, 0.44, 0.04, mDark,  root, 0,      1.23,  0.16);

    // ── Pauldrons (shoulder guards) ───────────────────────────────────
    this.mkBox(`${n}shldrL`, 0.18, 0.13, 0.24, mGold, root, -0.35, 1.44, 0);
    this.mkBox(`${n}shldrR`, 0.18, 0.13, 0.24, mGold, root,  0.35, 1.44, 0);

    // ── Upper arms ────────────────────────────────────────────────────
    this.mkBox(`${n}uarmL`, 0.16, 0.32, 0.16, mArmor, root, -0.38, 1.15, 0);
    this.mkBox(`${n}uarmR`, 0.16, 0.32, 0.16, mArmor, root,  0.38, 1.15, 0);

    // ── Forearms ──────────────────────────────────────────────────────
    this.mkBox(`${n}farmL`, 0.13, 0.28, 0.13, mSkin, root, -0.38, 0.85, 0);
    this.mkBox(`${n}farmR`, 0.13, 0.28, 0.13, mSkin, root,  0.38, 0.85, 0);

    // ── Neck ──────────────────────────────────────────────────────────
    this.mkCyl(`${n}neck`, 0.12, 0.14, 0.14, 6, mSkin, root, 0, 1.55, 0);

    // ── Helmet (head) ─────────────────────────────────────────────────
    const head = this.mkBox(`${n}head`, 0.34, 0.31, 0.31, mArmor, root, 0, 1.73, 0);
    this.renderer.shadowGenerator.addShadowCaster(head);

    // Visor strip (emissive glow across front of helmet)
    this.mkBox(`${n}visor`, 0.30, 0.09, 0.03, mVisor, root, 0, 1.73, -0.175);

    // Helmet crest (ridge along top)
    this.mkBox(`${n}crest`, 0.06, 0.11, 0.29, mGold, root, 0, 1.905, 0);

    // ── Bow (left hand, held diagonally) ──────────────────────────────
    const bow = MeshBuilder.CreateTorus(`${n}bow`, { diameter: 0.72, thickness: 0.058, tessellation: 12 }, this.scene);
    bow.parent = root;
    bow.position.set(-0.54, 1.12, -0.06);
    bow.rotation.set(0.12, 0.18, Math.PI / 2);
    bow.material = mBow;

    // Bow string
    this.mkCyl(`${n}bstr`, 0.72, 0.012, 0.012, 4, mDark, root, -0.54, 1.12, -0.06);

    // ── Quiver (cylindrical, on back right) ───────────────────────────
    this.mkCyl(`${n}quiver`, 0.42, 0.085, 0.085, 8, mDark, root, 0.22, 1.13, 0.21, 0, 0, 0.25);

    // T2-6: Add divine aura glow sphere around player
    const auraSphere = MeshBuilder.CreateSphere(`${n}auraSphere`, { diameter: 2.5, segments: 16 }, this.scene);
    auraSphere.parent = root;
    auraSphere.position.y = 1.0; // Center on player torso
    const auraMat = new StandardMaterial(`${n}auraMat`, this.scene);
    auraMat.alpha = 0.08;
    auraMat.emissiveColor = new Color3(1.0, 0.85, 0.4); // Gold
    auraMat.diffuseColor = new Color3(0, 0, 0); // Transparent diffuse
    auraSphere.material = auraMat;

    return root;
  }

  removePlayerMesh(id: number): void {
    const mesh = this.playerMeshes.get(id);
    if (mesh) { mesh.dispose(false, true); this.playerMeshes.delete(id); }
  }

  updatePlayerMesh(state: PlayerState, isLocal: boolean, overrideYaw?: number): void {
    let root = this.playerMeshes.get(state.id);
    if (!root) {
      this.addPlayerMesh(state.id, isLocal);
      root = this.playerMeshes.get(state.id);
      if (!root) return;
    }

    root.position.set(state.pos.x, state.pos.y, state.pos.z);
    root.rotation.y = overrideYaw ?? state.yaw;
    root.rotation.x = state.status === PlayerStatus.Downed ? Math.PI / 2 * 0.8 : 0;

    // Walking animation: bob when moving
    const speed = Math.sqrt(state.vel.x * state.vel.x + state.vel.z * state.vel.z);
    if (speed > 0.5 && state.status === PlayerStatus.Alive) {
      const t = performance.now() / 1000;
      const bobFreq = speed > 8 ? 12 : 7; // faster bob when sprinting
      root.position.y += Math.sin(t * bobFreq) * 0.06;
      root.rotation.z = Math.sin(t * bobFreq * 0.5) * 0.03;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  ENEMY MESHES  (Rakshasa Sentinel — billboard sprites or primitive fallback)
  // ══════════════════════════════════════════════════════════════════════════

  updateEnemyMesh(state: EnemyState): void {
    let root = this.enemyMeshes.get(state.id);
    if (!root) {
      // P2-4: Try to reuse a pooled mesh before building new geometry
      if (this.enemyMeshPool.length > 0) {
        root = this.enemyMeshPool.pop()!;
        root.name = `enemy_${state.id}`;
      } else {
        root = this._buildRakshasaParts(state.id);
      }
      this.enemyMeshes.set(state.id, root);
    }

    if (state.aiState === EnemyAIState.Dead) {
      root.setEnabled(false);
      // P2-4: Return mesh to pool for reuse
      if (this.enemyMeshPool.length < 30) { // Cap pool size
        this.enemyMeshes.delete(state.id);
        this.enemyMeshPool.push(root);
      }
      return;
    }

    root.setEnabled(true);
    root.position.set(state.pos.x, state.pos.y, state.pos.z);
    root.rotation.y = state.yaw;

    // Walking animation: bob and sway when moving (Patrol, Chase, Strafe, Retreat, Flank)
    const isMoving = state.aiState === EnemyAIState.Patrol || state.aiState === EnemyAIState.Chase ||
                      state.aiState === EnemyAIState.Strafe || state.aiState === EnemyAIState.Retreat ||
                      state.aiState === EnemyAIState.Flank;
    if (isMoving) {
      const t = performance.now() / 1000;
      const bobFreq = (state.aiState === EnemyAIState.Chase || state.aiState === EnemyAIState.Flank) ? 10 : 5;
      root.position.y += Math.sin(t * bobFreq + state.id) * 0.08;
      // Slight lateral tilt for walking feel
      root.rotation.z = Math.sin(t * bobFreq * 0.5 + state.id) * 0.04;
    } else {
      root.rotation.z = 0;
    }

    // A-05: Enemy telegraph ground indicators
    if (state.telegraphing) {
      if (!this.telegraphIndicators.has(state.id)) {
        // Create red disc at enemy feet
        const disc = MeshBuilder.CreateDisc(`telegraph_${state.id}`, { radius: 2.5, tessellation: 16 }, this.scene);
        disc.rotation.x = Math.PI / 2;  // Lay flat
        disc.position.y = 0.05;  // Just above ground
        disc.material = this.ensureTelegraphMat();
        this.telegraphIndicators.set(state.id, disc);
      }
      // Update position
      const indicator = this.telegraphIndicators.get(state.id);
      if (indicator) {
        indicator.position.x = state.pos.x;
        indicator.position.z = state.pos.z;
      }
    } else {
      // Remove telegraph indicator if not telegraphing
      const indicator = this.telegraphIndicators.get(state.id);
      if (indicator) {
        indicator.dispose();
        this.telegraphIndicators.delete(state.id);
      }
    }

    // A-06: Maya illusion shimmer
    if (state.isIllusion) {
      const shimmer = 0.4 + Math.sin(performance.now() * 0.004 * Math.PI) * 0.3;
      root.getChildMeshes().forEach(m => { m.visibility = shimmer; });
    } else {
      root.getChildMeshes().forEach(m => { m.visibility = 1.0; });
    }

    // T4-2: Golden Deer visual coloring
    if ((state as any).isGoldenDeer) {
      root.getChildMeshes().forEach(m => {
        if (m.material) {
          if (m.material instanceof PBRMaterial) {
            (m.material as any).albedoColor = new Color3(0.9, 0.75, 0.2);  // Golden color
            (m.material as any).emissiveColor = new Color3(0.4, 0.3, 0.1);  // Golden glow
          } else if (m.material instanceof StandardMaterial) {
            (m.material as any).diffuseColor = new Color3(0.9, 0.75, 0.2);
            (m.material as any).emissiveColor = new Color3(0.4, 0.3, 0.1);
          }
        }
      });
    }

    // A-06: Champion golden nameplate
    if (state.isChampion && !state.isIllusion) {
      if (!this.championPlates.has(state.id)) {
        // Create dynamic texture with "★ CHAMPION" text in gold
        const plateTexture = new DynamicTexture('championPlate_' + state.id, 128, this.scene);
        plateTexture.drawText('★ CHAMPION', 32, 20, 'bold 16px Arial', '#FFD700', 'rgba(0,0,0,0)', true, true);

        // Create billboard plane at Y=3.5 above root
        const plate = MeshBuilder.CreatePlane(`championPlate_${state.id}`, { width: 2.0, height: 0.5 }, this.scene);
        plate.parent = root;
        plate.billboardMode = Mesh.BILLBOARDMODE_Y;
        plate.position.y = 3.5;

        const plateMat = new StandardMaterial(`championPlateMat_${state.id}`, this.scene);
        plateMat.emissiveTexture = plateTexture;
        plateMat.diffuseColor = new Color3(1, 0.84, 0);  // Gold
        plateMat.backFaceCulling = false;
        plate.material = plateMat;

        this.championPlates.set(state.id, plate);
      }
    } else {
      // Dispose champion nameplate if not champion or if illusion
      const plate = this.championPlates.get(state.id);
      if (plate) {
        plate.dispose();
        this.championPlates.delete(state.id);
      }
    }
  }

  private _buildRakshasaParts(id: number): TransformNode {
    const n = `e${id}_`;
    const root = new TransformNode(`enemy_${id}`, this.scene);

    // Resolve type-specific sprite: prefer dedicated rakshasa sprite, fall back to generic
    const enemyType = this.enemyTypes.get(id) || 'soldier';
    const typedSprite = this.enemySpriteTextures[enemyType];
    const fallbackSprite = (id % 2 === 1) ? this.enemySpriteTextures.sprite1 : this.enemySpriteTextures.sprite2;
    const spriteTexture = typedSprite || fallbackSprite;

    if (spriteTexture) {
      // ── Billboard sprite approach ──────────────────────────────────
      const billboardPlane = MeshBuilder.CreatePlane(`${n}billboard`, { size: 1 }, this.scene);
      billboardPlane.parent = root;
      billboardPlane.billboardMode = Mesh.BILLBOARDMODE_Y;

      // Type-specific scaling: brutes are wider + shorter, archers are leaner + taller
      if (enemyType === 'archer') {
        billboardPlane.scaling.set(1.3, 2.8, 1);
      } else if (enemyType === 'brute') {
        billboardPlane.scaling.set(2.0, 2.8, 1);
      } else {
        billboardPlane.scaling.set(1.4, 2.5, 1);
      }

      billboardPlane.position.y = 1.25;

      const billboardMat = new StandardMaterial(`${n}billboardMat`, this.scene);
      billboardMat.diffuseTexture = spriteTexture;
      billboardMat.useAlphaFromDiffuseTexture = true;
      billboardMat.emissiveColor = new Color3(0.12, 0.1, 0.08); // subtle self-illumination
      billboardMat.specularColor = new Color3(0, 0, 0);
      billboardMat.backFaceCulling = false;
      billboardPlane.material = billboardMat;
    } else {
      // ── Fallback: primitive mesh system (original) ──────────────────
      // ── Palette — flat-colour PBR for primitive geometry ─────────────
      const mArmor = this.mkMat(`${n}armor`, 0.28, 0.04, 0.04, 0.45, 0.5);       // dark crimson
      const mDark  = this.mkMat(`${n}dark`,  0.1,  0.09, 0.08, 0.6,  0.4);       // matte black
      const mSkin  = this.mkMat(`${n}skin`,  0.32, 0.42, 0.18, 0.0,  0.85);      // sickly olive
      const mHorn  = this.mkMat(`${n}horn`,  0.55, 0.48, 0.35, 0.4,  0.5);       // bone grey
      const mEye   = this.mkMat(`${n}eye`,   1.0,  0.45, 0.0,  0.0,  0.0, 0.9, 0.35, 0.0); // orange glow
      const mClaw  = this.mkMat(`${n}claw`,  0.15, 0.15, 0.12, 0.5,  0.45);      // dark metal

      // ── Feet / Hooves ─────────────────────────────────────────────────
      this.mkBox(`${n}footL`, 0.24, 0.16, 0.32, mDark, root, -0.14, 0.08, 0.03);
      this.mkBox(`${n}footR`, 0.24, 0.16, 0.32, mDark, root,  0.14, 0.08, 0.03);

      // ── Shins ─────────────────────────────────────────────────────────
      this.mkBox(`${n}shinL`, 0.22, 0.42, 0.22, mSkin,  root, -0.14, 0.37, 0);
      this.mkBox(`${n}shinR`, 0.22, 0.42, 0.22, mSkin,  root,  0.14, 0.37, 0);

      // ── Thighs ────────────────────────────────────────────────────────
      this.mkBox(`${n}thighL`, 0.26, 0.44, 0.26, mArmor, root, -0.14, 0.78, 0);
      this.mkBox(`${n}thighR`, 0.26, 0.44, 0.26, mArmor, root,  0.14, 0.78, 0);

      // ── Waist ─────────────────────────────────────────────────────────
      this.mkBox(`${n}waist`, 0.54, 0.2, 0.32, mArmor, root, 0, 1.08, 0);

      // ── Torso (wide, brutish) ─────────────────────────────────────────
      const torso = this.mkBox(`${n}torso`, 0.68, 0.62, 0.4, mArmor, root, 0, 1.55, 0);
      this.renderer.shadowGenerator.addShadowCaster(torso);

      // Belly plates (horizontal ridges)
      this.mkBox(`${n}plate1`, 0.64, 0.07, 0.08, mDark, root, 0, 1.32, -0.22);
      this.mkBox(`${n}plate2`, 0.64, 0.07, 0.08, mDark, root, 0, 1.55, -0.22);
      this.mkBox(`${n}plate3`, 0.64, 0.07, 0.08, mDark, root, 0, 1.78, -0.22);

      // ── Shoulders (spaulders) ─────────────────────────────────────────
      this.mkCyl(`${n}shldrL`, 0.14, 0.32, 0.32, 8, mArmor, root, -0.5,  1.82, 0, 0, 0, Math.PI / 2);
      this.mkCyl(`${n}shldrR`, 0.14, 0.32, 0.32, 8, mArmor, root,  0.5,  1.82, 0, 0, 0, Math.PI / 2);

      // ── Upper arms ────────────────────────────────────────────────────
      this.mkBox(`${n}uarmL`, 0.22, 0.38, 0.22, mSkin, root, -0.56, 1.47, 0);
      this.mkBox(`${n}uarmR`, 0.22, 0.38, 0.22, mSkin, root,  0.56, 1.47, 0);

      // ── Forearms ──────────────────────────────────────────────────────
      this.mkBox(`${n}farmL`, 0.2, 0.34, 0.2, mSkin, root, -0.56, 1.1, 0);
      this.mkBox(`${n}farmR`, 0.2, 0.34, 0.2, mSkin, root,  0.56, 1.1, 0);

      // ── Claws (3 per hand — simplified as thin wedges) ────────────────
      for (let c = 0; c < 3; c++) {
        const offX = (c - 1) * 0.07;
        this.mkBox(`${n}clawL${c}`, 0.04, 0.18, 0.05, mClaw, root, -0.56 + offX, 0.9, -0.04, -0.4, 0, 0);
        this.mkBox(`${n}clawR${c}`, 0.04, 0.18, 0.05, mClaw, root,  0.56 + offX, 0.9, -0.04, -0.4, 0, 0);
      }

      // ── Neck (thick) ──────────────────────────────────────────────────
      this.mkCyl(`${n}neck`, 0.18, 0.2, 0.24, 6, mSkin, root, 0, 1.96, 0);

      // ── Head ──────────────────────────────────────────────────────────
      const head = this.mkBox(`${n}head`, 0.46, 0.38, 0.38, mArmor, root, 0, 2.24, 0);
      this.renderer.shadowGenerator.addShadowCaster(head);

      // ── 4 glowing eyes (2 rows on front face) ─────────────────────────
      this.mkSph(`${n}eye1`, 0.1, 6, mEye, root, -0.13, 2.30, -0.2);
      this.mkSph(`${n}eye2`, 0.1, 6, mEye, root,  0.13, 2.30, -0.2);
      this.mkSph(`${n}eye3`, 0.09, 6, mEye, root, -0.1,  2.14, -0.2);
      this.mkSph(`${n}eye4`, 0.09, 6, mEye, root,  0.1,  2.14, -0.2);

      // ── Horns (2, curving outward) ────────────────────────────────────
      this.mkCyl(`${n}hornL`, 0.46, 0.04, 0.12, 6, mHorn, root, -0.16, 2.5, 0, 0, 0,  0.55);
      this.mkCyl(`${n}hornR`, 0.46, 0.04, 0.12, 6, mHorn, root,  0.16, 2.5, 0, 0, 0, -0.55);
    }

    return root;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  BOSS MESH  (Ravana Protocol — ~30 parts; 5 heads, 4 arms, aura rings)
  // ══════════════════════════════════════════════════════════════════════════

  updateBossMesh(state: BossState): void {
    if (!this.bossMesh) {
      this.bossMesh = this._buildRavanaParts();
    }

    if (state.phase === BossPhase.Dead) { this.bossMesh.setEnabled(false); return; }

    this.bossMesh.setEnabled(true);
    this.bossMesh.position.set(state.pos.x, state.pos.y, state.pos.z);
    this.bossMesh.rotation.y = state.yaw;

    // Enrage: pulse chest core brighter red
    const core = this.scene.getMeshByName('boss_core');
    if (core?.material instanceof PBRMaterial) {
      core.material.emissiveColor = state.phase === BossPhase.Phase3Enrage
        ? new Color3(1.0, 0.1, 0.05)
        : new Color3(0.4, 0.05, 0.55);
    }
  }

  private _buildRavanaParts(): TransformNode {
    const root = new TransformNode('boss', this.scene);

    // Check if we have boss sprite loaded and can use billboard rendering
    if (this.bossSpriteTexture !== null) {
      const billboardPlane = MeshBuilder.CreatePlane('boss_billboard', { size: 1 }, this.scene);
      billboardPlane.parent = root;
      billboardPlane.billboardMode = Mesh.BILLBOARDMODE_Y;
      billboardPlane.scaling.set(2.2, 4.0, 1);
      billboardPlane.position.y = 2.0; // offset so feet sit at root position

      const billboardMat = new StandardMaterial('boss_billboardMat', this.scene);
      billboardMat.diffuseTexture = this.bossSpriteTexture;
      billboardMat.useAlphaFromDiffuseTexture = true;
      billboardMat.emissiveColor = new Color3(0.15, 0.12, 0.1); // subtle self-illumination
      billboardMat.specularColor = new Color3(0, 0, 0); // no specular shine
      billboardMat.backFaceCulling = false;
      billboardPlane.material = billboardMat;

      return root;
    }

    // ── Palette — flat-colour PBR for primitive geometry ─────────────
    const mBody  = this.mkMat('boss_body',  0.18, 0.04, 0.28, 0.5,  0.4);          // dark void-purple
    const mGold  = this.mkMat('boss_gold',  0.65, 0.5,  0.08, 0.8,  0.25);         // gold rune plates
    const mDark  = this.mkMat('boss_dark',  0.08, 0.06, 0.1,  0.65, 0.4);          // near-black
    const mSkin  = this.mkMat('boss_skin',  0.38, 0.1,  0.18, 0.1,  0.75);         // dark reddish skin
    const mEye   = this.mkMat('boss_eye',   1.0,  0.2,  0.2,  0.0,  0.0, 1.0, 0.15, 0.1);  // red glow
    const mCore  = this.mkMat('boss_core',  0.4,  0.05, 0.55, 0.1,  0.2, 0.4, 0.05, 0.55); // purple glow core
    const mAura  = this.mkMat('boss_aura',  0.6,  0.1,  0.9,  0.0,  0.3, 0.55, 0.08, 0.8); // energy ring
    const mCrown = this.mkMat('boss_crown', 0.8,  0.65, 0.0,  0.85, 0.15);         // bright gold crown

    // ── Massive legs ──────────────────────────────────────────────────
    this.mkBox('boss_footL', 0.4, 0.22, 0.5, mDark, root, -0.28, 0.11, 0.05);
    this.mkBox('boss_footR', 0.4, 0.22, 0.5, mDark, root,  0.28, 0.11, 0.05);

    this.mkBox('boss_shinL', 0.36, 0.6,  0.36, mBody, root, -0.28, 0.52, 0);
    this.mkBox('boss_shinR', 0.36, 0.6,  0.36, mBody, root,  0.28, 0.52, 0);

    this.mkBox('boss_thighL', 0.42, 0.62, 0.42, mBody, root, -0.28, 1.08, 0);
    this.mkBox('boss_thighR', 0.42, 0.62, 0.42, mBody, root,  0.28, 1.08, 0);

    // ── Waist / hips ──────────────────────────────────────────────────
    this.mkBox('boss_waist', 0.82, 0.28, 0.52, mBody, root, 0, 1.46, 0);
    this.mkBox('boss_wbelt', 0.84, 0.08, 0.54, mGold, root, 0, 1.62, 0);  // gold belt

    // ── Massive torso ─────────────────────────────────────────────────
    const torso = this.mkBox('boss_torso', 1.1, 0.9, 0.66, mBody, root, 0, 2.26, 0);
    this.renderer.shadowGenerator.addShadowCaster(torso);

    // Rune chest plates (golden armour lines)
    this.mkBox('boss_runeC', 0.9, 0.78, 0.06, mGold, root, 0,     2.26, -0.36);
    this.mkBox('boss_runeL', 0.1, 0.78, 0.08, mGold, root, -0.32, 2.26, -0.37);
    this.mkBox('boss_runeR', 0.1, 0.78, 0.08, mGold, root,  0.32, 2.26, -0.37);

    // Glowing chest core orb
    const core = this.mkSph('boss_core', 0.38, 8, mCore, root, 0, 2.26, -0.4);
    this.renderer.shadowGenerator.addShadowCaster(core);

    // ── 4 arms: primary pair (high) + secondary pair (lower) ─────────
    //  Primary — upper
    this.mkBox('boss_uarmPL', 0.28, 0.52, 0.28, mSkin, root, -0.82, 2.52, 0);
    this.mkBox('boss_uarmPR', 0.28, 0.52, 0.28, mSkin, root,  0.82, 2.52, 0);
    this.mkBox('boss_farmPL', 0.24, 0.48, 0.24, mSkin, root, -0.82, 1.96, 0);
    this.mkBox('boss_farmPR', 0.24, 0.48, 0.24, mSkin, root,  0.82, 1.96, 0);
    this.mkBox('boss_handPL', 0.26, 0.22, 0.22, mDark, root, -0.82, 1.64, 0);
    this.mkBox('boss_handPR', 0.26, 0.22, 0.22, mDark, root,  0.82, 1.64, 0);

    //  Secondary — lower (angled out more)
    this.mkBox('boss_uarmSL', 0.24, 0.46, 0.24, mSkin, root, -0.7, 2.1, 0);
    this.mkBox('boss_uarmSR', 0.24, 0.46, 0.24, mSkin, root,  0.7, 2.1, 0);
    this.mkBox('boss_farmSL', 0.2,  0.42, 0.2,  mSkin, root, -0.7, 1.6, 0);
    this.mkBox('boss_farmSR', 0.2,  0.42, 0.2,  mSkin, root,  0.7, 1.6, 0);

    // ── Shoulder armour ───────────────────────────────────────────────
    this.mkBox('boss_shldrL', 0.26, 0.18, 0.36, mGold, root, -0.72, 2.78, 0);
    this.mkBox('boss_shldrR', 0.26, 0.18, 0.36, mGold, root,  0.72, 2.78, 0);

    // ── 5 Heads (centre + 2 flanking + 2 outer) ──────────────────────
    // Neck for central head
    this.mkCyl('boss_neckC', 0.26, 0.28, 0.32, 6, mSkin, root, 0, 2.88, 0);
    // Centre head (largest)
    const headC = this.mkBox('boss_headC', 0.62, 0.56, 0.5, mBody, root, 0, 3.32, 0);
    this.renderer.shadowGenerator.addShadowCaster(headC);
    this.mkSph('boss_eyeC1', 0.14, 6, mEye, root, -0.16, 3.36, -0.28);
    this.mkSph('boss_eyeC2', 0.14, 6, mEye, root,  0.16, 3.36, -0.28);

    // Inner flanking heads (y=3.08, x=±0.78)
    this.mkBox('boss_headL1', 0.5, 0.44, 0.4, mBody, root, -0.82, 3.08, 0);
    this.mkSph('boss_eyeL1', 0.12, 6, mEye, root, -0.88, 3.1, -0.22);
    this.mkBox('boss_headR1', 0.5, 0.44, 0.4, mBody, root,  0.82, 3.08, 0);
    this.mkSph('boss_eyeR1', 0.12, 6, mEye, root,  0.88, 3.1, -0.22);

    // Outer flanking heads (y=2.78, x=±1.4, smaller — hinting at more hidden)
    this.mkBox('boss_headL2', 0.38, 0.34, 0.32, mBody, root, -1.38, 2.8, 0);
    this.mkSph('boss_eyeL2', 0.09, 5, mEye, root, -1.38, 2.82, -0.18);
    this.mkBox('boss_headR2', 0.38, 0.34, 0.32, mBody, root,  1.38, 2.8, 0);
    this.mkSph('boss_eyeR2', 0.09, 5, mEye, root,  1.38, 2.82, -0.18);

    // ── Crown (on central head, 5 prongs) ─────────────────────────────
    for (let i = 0; i < 5; i++) {
      const angle = ((Math.PI / 4) * (i - 2));
      const cx = Math.sin(angle) * 0.24;
      const cz = -0.12 - Math.cos(Math.abs(angle)) * 0.05;
      const ch = 0.22 + (i === 2 ? 0.1 : 0);  // centre prong taller
      this.mkCyl(`boss_prong${i}`, ch, 0.03, 0.07, 5, mCrown, root, cx, 3.65, cz);
    }

    // ── Aura torus rings (dark energy) ────────────────────────────────
    const ring1 = MeshBuilder.CreateTorus('boss_ring1', { diameter: 1.6, thickness: 0.1, tessellation: 24 }, this.scene);
    ring1.parent = root;
    ring1.position.set(0, 2.26, 0);
    ring1.rotation.x = Math.PI / 2;
    ring1.material = mAura;

    const ring2 = MeshBuilder.CreateTorus('boss_ring2', { diameter: 2.2, thickness: 0.08, tessellation: 24 }, this.scene);
    ring2.parent = root;
    ring2.position.set(0, 1.7, 0);
    ring2.rotation.set(Math.PI / 6, 0, Math.PI / 4);
    ring2.material = mAura;

    return root;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  PROJECTILES
  // ══════════════════════════════════════════════════════════════════════════

  spawnProjectile(proj: ProjectileState): void {
    if (this.projectileMeshes.has(proj.id)) return;

    // Define projectile properties: size, color, emissive
    let size: number;
    let color: Color3;
    let emissive: Color3;
    let lightIntensity = 0.8;
    let lightRange = 8;

    switch (proj.type) {
      case ProjectileType.Arrow:
        size = 0.25; color = new Color3(0.9, 0.75, 0.3); emissive = new Color3(0.4, 0.35, 0.1); break;
      case ProjectileType.FireArrow:
        size = 0.45; color = new Color3(1.0, 0.4, 0.1); emissive = new Color3(1.0, 0.3, 0.0); break;
      case ProjectileType.ShockwaveArrow:
        size = 0.35; color = new Color3(0.5, 0.9, 1.0); emissive = new Color3(0.3, 0.7, 1.0); break;
      case 5: // VayuAstra (air)
        size = 0.4; color = new Color3(0.5, 0.9, 1.0); emissive = new Color3(0.3, 0.7, 1.0); break;
      case 6: // VarunaAstra (water)
        size = 0.45; color = new Color3(0.1, 0.4, 1.0); emissive = new Color3(0.0, 0.3, 0.9); break;
      case 7: // NagaAstra (serpent)
        size = 0.4; color = new Color3(0.2, 0.9, 0.2); emissive = new Color3(0.1, 0.8, 0.1); break;
      case 8: // BrahmaAstra (divine)
        size = 0.55; color = new Color3(1.0, 0.85, 0.2); emissive = new Color3(1.0, 0.7, 0.0); break;
      case ProjectileType.EnemyProjectile:
        size = 0.3; color = new Color3(0.9, 0.15, 0.1); emissive = new Color3(0.8, 0.1, 0.0); break;
      case 9: // EnemyAgniAstra (enemy fire)
        size = 0.4; color = new Color3(1.0, 0.3, 0.0); emissive = new Color3(0.9, 0.2, 0.0); break;
      case 10: // EnemyVayuAstra (enemy air)
        size = 0.35; color = new Color3(0.6, 0.7, 0.9); emissive = new Color3(0.4, 0.5, 0.7); break;
      case 11: // EnemyNagaAstra (enemy serpent)
        size = 0.35; color = new Color3(0.4, 0.9, 0.3); emissive = new Color3(0.2, 0.8, 0.1); break;
      case ProjectileType.BossProjectile:
        size = 0.45; color = new Color3(0.7, 0.1, 0.6); emissive = new Color3(0.6, 0.05, 0.4); break;
      default:
        size = 0.3; color = new Color3(1, 1, 1); emissive = new Color3(0.5, 0.5, 0.5);
    }

    // Map projectile types to VFX trail texture keys
    const vfxTrailMap: Record<number, string> = {
      [ProjectileType.FireArrow]: 'vfx_agni_trail',
      5: 'vfx_vayu_trail',   // VayuAstra
      6: 'vfx_varuna_trail', // VarunaAstra
      7: 'vfx_naga_trail',   // NagaAstra
      8: 'vfx_brahma_trail', // BrahmaAstra
    };

    const vfxKey = vfxTrailMap[proj.type];
    const vfxTex = vfxKey ? this.vfxTextures.get(vfxKey) : null;

    let mesh: Mesh;

    if (vfxTex) {
      // Use VFX trail sprite billboard for special arrows
      mesh = MeshBuilder.CreatePlane(`proj_${proj.id}`, { size: 1 }, this.scene);
      mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
      mesh.scaling.set(size * 3.5, size * 3.5, 1); // VFX trails are bigger than the sphere
      mesh.position.set(proj.pos.x, proj.pos.y, proj.pos.z);
      const vfxMat = new StandardMaterial(`projMat_${proj.id}`, this.scene);
      vfxMat.diffuseTexture = vfxTex;
      vfxMat.useAlphaFromDiffuseTexture = true;
      vfxMat.emissiveColor = emissive;
      vfxMat.specularColor = new Color3(0, 0, 0);
      vfxMat.backFaceCulling = false;
      vfxMat.disableLighting = true;
      mesh.material = vfxMat;
    } else {
      // Fallback: procedural glow-based sphere
      mesh = MeshBuilder.CreateSphere(`proj_${proj.id}`, { diameter: size * 2, segments: 8 }, this.scene);
      mesh.position.set(proj.pos.x, proj.pos.y, proj.pos.z);
      const mat = new PBRMaterial(`projMat_${proj.id}`, this.scene);
      mat.albedoColor = color;
      mat.emissiveColor = emissive;
      mat.metallic = 0.6;
      mat.roughness = 0.3;
      mesh.material = mat;
    }

    // Add point light to each projectile for glow effect
    const light = new PointLight(`projLight_${proj.id}`, mesh.position.clone(), this.scene);
    light.intensity = lightIntensity;
    light.diffuse = emissive.clone();
    light.range = lightRange;
    light.parent = mesh;

    this.projectileMeshes.set(proj.id, { mesh, vel: { ...proj.vel }, spawnTime: performance.now(), type: proj.type });
  }

  spawnDeathBurst(pos: Vec3): void {
    const WHITE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const burst = new ParticleSystem('deathBurst_' + Date.now(), 12, this.scene);
    burst.particleTexture = new Texture(WHITE_PNG, this.scene);
    burst.emitter = new Vector3(pos.x, pos.y + 1, pos.z);
    burst.minEmitBox = Vector3.Zero();
    burst.maxEmitBox = Vector3.Zero();
    burst.color1 = new Color4(1, 0.3, 0.1, 1);
    burst.color2 = new Color4(0.8, 0.1, 0.05, 1);
    burst.colorDead = new Color4(0.3, 0.05, 0, 0);
    burst.minSize = 0.15;
    burst.maxSize = 0.35;
    burst.minLifeTime = 0.3;
    burst.maxLifeTime = 0.6;
    burst.emitRate = 0;
    burst.manualEmitCount = 12;
    burst.direction1 = new Vector3(-2, 3, -2);
    burst.direction2 = new Vector3(2, 5, 2);
    burst.gravity = new Vector3(0, -15, 0);
    burst.minEmitPower = 3;
    burst.maxEmitPower = 6;
    burst.blendMode = ParticleSystem.BLENDMODE_ADD;
    burst.targetStopDuration = 0.7;
    burst.disposeOnStop = true;
    burst.start();
  }

  flashEnemyHit(enemyId: number): void {
    const root = this.enemyMeshes.get(enemyId);
    if (!root) return;
    const children = root.getChildMeshes();
    for (const child of children) {
      if (child.material instanceof StandardMaterial) {
        const origEmissive = child.material.emissiveColor.clone();
        child.material.emissiveColor = new Color3(1, 0.3, 0.1);
        setTimeout(() => {
          if (child.material instanceof StandardMaterial) {
            child.material.emissiveColor = origEmissive;
          }
        }, 100);
        break; // Just flash the first child (billboard)
      }
    }
  }

  spawnPickup(id: number, pos: Vec3, arrows: number): void {
    // Create a glowing arrow bundle (3-5 thin cylinders bundled together)
    const arrowCount = Math.min(5, Math.max(3, arrows));
    const bundleContainer = new TransformNode(`pickup_${id}`, this.scene);
    bundleContainer.position.set(pos.x, 0.3, pos.z);

    // Arrow shaft material (golden-brown)
    const shaftMat = new StandardMaterial(`arrowShaftMat_${id}`, this.scene);
    shaftMat.diffuseColor = new Color3(0.7, 0.55, 0.2);
    shaftMat.specularColor = new Color3(0.4, 0.3, 0.1);

    // Arrowhead material (golden)
    const headMat = new StandardMaterial(`arrowHeadMat_${id}`, this.scene);
    headMat.emissiveColor = new Color3(1.0, 0.85, 0.2);
    headMat.diffuseColor = new Color3(0.9, 0.75, 0.2);
    headMat.disableLighting = true;

    // Fletching material (brown)
    const fletchMat = new StandardMaterial(`fletchMat_${id}`, this.scene);
    fletchMat.diffuseColor = new Color3(0.5, 0.3, 0.1);
    fletchMat.specularColor = new Color3(0, 0, 0);
    fletchMat.backFaceCulling = false;

    // Build each arrow in the bundle
    for (let i = 0; i < arrowCount; i++) {
      const angleOffset = (Math.PI * 2 / arrowCount) * i;
      const tilt = 0.15 + (i % 2) * 0.1;  // Slight angle variation

      // Shaft (thin cylinder)
      const shaft = MeshBuilder.CreateCylinder(`shaft_${id}_${i}`, {
        height: 0.8,
        diameter: 0.03,
        tessellation: 6
      }, this.scene);
      shaft.parent = bundleContainer;
      shaft.position.set(
        Math.cos(angleOffset) * 0.05,
        0,
        Math.sin(angleOffset) * 0.05
      );
      shaft.rotation.x = tilt;
      shaft.material = shaftMat;

      // Arrowhead (small cone at the tip)
      const head = MeshBuilder.CreateCylinder(`head_${id}_${i}`, {
        diameterTop: 0,
        diameterBottom: 0.03,
        height: 0.12,
        tessellation: 6
      }, this.scene);
      head.parent = bundleContainer;
      head.position.set(
        Math.cos(angleOffset) * 0.05,
        0.46,
        Math.sin(angleOffset) * 0.05
      );
      head.rotation.x = tilt;
      head.material = headMat;

      // Fletching (2 small planes at the back)
      for (let f = 0; f < 2; f++) {
        const fletching = MeshBuilder.CreatePlane(`fletch_${id}_${i}_${f}`, {
          width: 0.04,
          height: 0.15
        }, this.scene);
        fletching.parent = bundleContainer;
        fletching.position.set(
          Math.cos(angleOffset) * 0.05 + (f === 0 ? 0.02 : -0.02),
          -0.38,
          Math.sin(angleOffset) * 0.05
        );
        fletching.rotation.y = f === 0 ? Math.PI / 4 : -Math.PI / 4;
        fletching.rotation.x = tilt;
        fletching.material = fletchMat;
      }
    }

    this.pickupMeshes.set(id, bundleContainer as Mesh);
  }

  removePickup(id: number): void {
    const mesh = this.pickupMeshes.get(id);
    if (mesh) { mesh.dispose(); this.pickupMeshes.delete(id); }
  }

  updatePickups(dt: number): void {
    const now = performance.now() / 1000;
    for (const [id, mesh] of this.pickupMeshes) {
      mesh.position.y = 0.3 + Math.sin(now * 3 + id) * 0.15; // gentle bob
      mesh.rotation.y += dt * 2; // slow spin
    }
  }

  updateProjectiles(dt: number): void {
    const now = performance.now();
    const toRemove: number[] = [];

    // Accumulate time for trail spawn throttling
    this.trailSpawnAccum += dt;
    const spawnTrail = this.trailSpawnAccum >= 0.03; // ~30 trail particles/sec
    if (spawnTrail) this.trailSpawnAccum = 0;

    for (const [id, proj] of this.projectileMeshes) {
      proj.mesh.position.x += proj.vel.x * dt;
      proj.mesh.position.y += proj.vel.y * dt;
      proj.mesh.position.z += proj.vel.z * dt;
      proj.vel.y -= 20 * 0.15 * dt;

      // A-10: Spawn fading trail particle — increase spawn rate for Astra types
      if (spawnTrail && now - proj.spawnTime < 3500) {
        // Astra types: 1 (Agni), 5 (Vayu), 6 (Varuna), 7 (Naga), 8 (Brahma)
        const isAstra = [1, 5, 6, 7, 8].includes(proj.type);
        if (isAstra) {
          // Spawn 2-3 trail particles per frame for denser trails
          this.spawnTrailParticle(proj.mesh.position, proj.type);
          if (Math.random() > 0.4) {
            this.spawnTrailParticle(proj.mesh.position, proj.type);
          }
        } else {
          this.spawnTrailParticle(proj.mesh.position, proj.type);
        }
      }

      if (now - proj.spawnTime > 4000 || proj.mesh.position.y < -1) toRemove.push(id);
    }

    // Fade and remove trail particles
    this.updateTrailParticles(dt);

    for (const id of toRemove) {
      const proj = this.projectileMeshes.get(id);
      if (proj) { proj.mesh.dispose(); this.projectileMeshes.delete(id); }
    }

    // Damage number float & fade
    const dnToRemove: number[] = [];
    for (let i = 0; i < this.damageNumbers.length; i++) {
      const dn = this.damageNumbers[i];
      const age = (now - dn.startTime) / 1000;
      if (age > 1.5) { dn.mesh.dispose(); dnToRemove.push(i); }
      else { dn.mesh.position.y = dn.startY + age * 2; dn.mesh.visibility = 1 - (age / 1.5); }
    }
    for (let i = dnToRemove.length - 1; i >= 0; i--) this.damageNumbers.splice(dnToRemove[i], 1);
  }

  // ── Trail particle system ─────────────────────────────────────────────
  private getTrailColor(type: ProjectileType): [number, number, number] {
    switch (type) {
      case 0: return [0.8, 0.7, 0.3];     // Arrow — golden
      case 1: return [1.0, 0.4, 0.1];     // FireArrow/Agni — orange fire
      case 5: return [0.5, 0.85, 1.0];    // VayuAstra — cyan wind
      case 6: return [0.2, 0.5, 1.0];     // VarunaAstra — blue water
      case 7: return [0.3, 0.9, 0.2];     // NagaAstra — green serpent
      case 8: return [1.0, 0.85, 0.3];    // BrahmaAstra — bright gold
      case 3: return [0.8, 0.2, 0.1];     // EnemyProjectile — red
      case 4: return [0.7, 0.1, 0.5];     // BossProjectile — purple
      case 9: return [1.0, 0.3, 0.0];     // EnemyAgniAstra — orange-red
      case 10: return [0.6, 0.7, 0.9];    // EnemyVayuAstra — pale blue
      case 11: return [0.5, 0.9, 0.3];    // EnemyNagaAstra — lime green
      default: return [1, 1, 1];
    }
  }

  private spawnTrailParticle(pos: Vector3, type: ProjectileType): void {
    // Limit total trail particles for performance
    if (this.trailParticles.length > 150) return;

    const [r, g, b] = this.getTrailColor(type);
    let trail: Mesh;
    let size = 0.6;
    let maxAge = 0.25 + Math.random() * 0.15;
    let drift = 0;

    // A-10: Vary shape and behavior by type
    switch (type) {
      case 1: {
        // Agni (FireArrow) — orange ember particles, larger, upward drift, longer life
        size = 0.8;
        maxAge = 0.4;
        drift = 1.5;  // Upward drift
        trail = MeshBuilder.CreatePlane(`trail_${Math.random()}`, { size }, this.scene);
        break;
      }
      case 5: {
        // Vayu — white distortion streaks, elongated planes, shorter life, fast fade
        trail = MeshBuilder.CreatePlane(`trail_${Math.random()}`, { width: 0.2, height: 0.8 }, this.scene);
        maxAge = 0.15;
        break;
      }
      case 6: {
        // Varuna — blue droplet scatter, smaller, more spread
        size = 0.3;
        maxAge = 0.3;
        trail = MeshBuilder.CreatePlane(`trail_${Math.random()}`, { size }, this.scene);
        break;
      }
      case 7: {
        // Naga — green mist trail, larger, very transparent, slow fade, downward drift
        size = 0.8;
        maxAge = 0.35;
        drift = -0.5;  // Downward drift
        trail = MeshBuilder.CreatePlane(`trail_${Math.random()}`, { size }, this.scene);
        break;
      }
      case 8: {
        // Brahma — golden spiral, largest, brightest emissive
        size = 1.0;
        maxAge = 0.4;
        trail = MeshBuilder.CreatePlane(`trail_${Math.random()}`, { size }, this.scene);
        break;
      }
      default: {
        trail = MeshBuilder.CreatePlane(`trail_${Math.random()}`, { size }, this.scene);
        break;
      }
    }

    trail.position.set(
      pos.x + (Math.random() - 0.5) * (type === 6 ? 0.3 : 0.1),  // More spread for Varuna
      pos.y + (Math.random() - 0.5) * 0.1,
      pos.z + (Math.random() - 0.5) * (type === 6 ? 0.3 : 0.1),
    );
    trail.billboardMode = Mesh.BILLBOARDMODE_ALL;

    const mat = new StandardMaterial(`trailMat_${Math.random()}`, this.scene);
    mat.emissiveColor = new Color3(r, g, b);
    mat.disableLighting = true;

    // A-10: Vary alpha by type
    if (type === 7) {
      mat.alpha = 0.4;  // Naga — very transparent
    } else if (type === 5) {
      mat.alpha = 0.6;  // Vayu — less opaque for distortion effect
    } else {
      mat.alpha = 0.7;
    }

    trail.material = mat;

    this.trailParticles.push({ mesh: trail, age: 0, maxAge, type, drift });
  }

  private updateTrailParticles(dt: number): void {
    const toRemove: number[] = [];
    for (let i = 0; i < this.trailParticles.length; i++) {
      const p = this.trailParticles[i];
      p.age += dt;
      const life = p.age / p.maxAge;
      if (life >= 1) {
        toRemove.push(i);
        continue;
      }

      // A-10: Fade out and shrink — adjust alpha based on initial type alpha
      let initialAlpha = 0.7;
      if (p.type === 7) initialAlpha = 0.4;  // Naga
      else if (p.type === 5) initialAlpha = 0.6;  // Vayu

      const alpha = initialAlpha * (1 - life);
      const scale = 1.0 - life * 0.5;
      if (p.mesh.material instanceof StandardMaterial) {
        p.mesh.material.alpha = alpha;
      }
      p.mesh.scaling.setAll(scale);

      // A-10: Apply per-type drift behavior
      if (p.drift !== undefined && p.drift !== 0) {
        p.mesh.position.y += p.drift * dt;
      }
    }
    // Remove expired particles (iterate backward)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const idx = toRemove[i];
      this.trailParticles[idx].mesh.material?.dispose();
      this.trailParticles[idx].mesh.dispose();
      this.trailParticles.splice(idx, 1);
    }
  }

  showDamageNumber(targetType: DamageTargetType, targetId: number, damage: number): void {
    let pos: Vector3 | null = null;
    if (targetType === DamageTargetType.Player)      pos = this.playerMeshes.get(targetId)?.position.clone() ?? null;
    else if (targetType === DamageTargetType.Enemy)  pos = this.enemyMeshes.get(targetId)?.position.clone() ?? null;
    else if (targetType === DamageTargetType.Boss && this.bossMesh) pos = this.bossMesh.position.clone();

    if (!pos) return;
    pos.y += 2.5 + Math.random() * 0.5;
    pos.x += (Math.random() - 0.5) * 0.5;

    const plane = MeshBuilder.CreatePlane(`dmg_${Date.now()}`, { size: 1 }, this.scene);
    plane.position.copyFrom(pos);
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    const mat = new StandardMaterial(`dmgMat_${Date.now()}`, this.scene);
    mat.emissiveColor = targetType === DamageTargetType.Player ? new Color3(1, 0.2, 0.2) : new Color3(1, 0.8, 0.2);
    mat.disableLighting = true;
    plane.material = mat;
    plane.scaling.setAll(0.5 + (damage / 50) * 0.5);

    this.damageNumbers.push({ mesh: plane, startTime: performance.now(), startY: pos.y });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  ALLY NPCs (non-combatant story characters)
  // ══════════════════════════════════════════════════════════════════════════

  spawnAllyNPC(id: string, name: string, pos: Vec3): void {
    const root = new TransformNode(`ally_${id}`, this.scene);
    root.position.set(pos.x, pos.y, pos.z);

    // Color coding per ally
    const colorMap: Record<string, Color3> = {
      'sugriv': new Color3(0.9, 0.6, 0.1),   // golden orange for monkey kings
      'hanuman': new Color3(1.0, 0.5, 0.0),   // orange
      'angad': new Color3(0.2, 0.8, 0.3),     // green for younger allies
      'lakshman': new Color3(0.2, 0.4, 0.9),  // blue for devotees
    };
    const color = colorMap[id] || new Color3(0.8, 0.8, 0.2);

    // Determine beacon color based on NPC type
    let beaconColor: Color3;
    if (id === 'sugriv' || id === 'hanuman' || id === 'angad') {
      beaconColor = new Color3(0.2, 0.5, 1.0); // Blue for Sugriv/Angad/Hanuman
    } else if (id === 'lakshman') {
      beaconColor = new Color3(0.9, 0.7, 0.2); // Gold for sages/leaders
    } else {
      beaconColor = new Color3(0.2, 0.8, 0.3); // Green for others
    }

    // Create billboard plane for the ally (2.2x3.8)
    const billboard = MeshBuilder.CreatePlane(`ally_billboard_${id}`, { width: 2.2, height: 3.8 }, this.scene);
    billboard.parent = root;
    billboard.position.y = 1.9;
    billboard.billboardMode = Mesh.BILLBOARDMODE_Y;

    // Map NPC id to sprite key (e.g. 'angad_npc' → 'angad')
    const spriteKey = id.replace(/_npc$/, '');
    const spriteTex = this.npcSpriteTextures.get(spriteKey) || this.npcSpriteTextures.get(id);
    const mat = new StandardMaterial(`allyMat_${id}`, this.scene);
    if (spriteTex) {
      // Use the generated sprite texture with transparency
      mat.diffuseTexture = spriteTex;
      mat.useAlphaFromDiffuseTexture = true;
      mat.emissiveColor = new Color3(0.3, 0.3, 0.3); // slight self-illumination
      mat.disableLighting = false;
    } else {
      // Fallback: build a detailed primitive humanoid instead of colored plane
      billboard.dispose(); // Remove the flat billboard
      this.buildHumanoidNPC(root, id, color);
    }
    if (billboard && !billboard.isDisposed()) {
      mat.specularColor = new Color3(0, 0, 0);
      mat.backFaceCulling = false;
      billboard.material = mat;
    }

    // ── BEACON PILLAR (glowing cylinder above NPC) ────────────────────────────
    const beacon = MeshBuilder.CreateCylinder(`beacon_${id}`, { height: 12, diameter: 0.3, tessellation: 16 }, this.scene);
    beacon.parent = root;
    beacon.position.y = 6; // centered lower to not overwhelm sprite
    const beaconMat = new StandardMaterial(`beaconMat_${id}`, this.scene);
    beaconMat.emissiveColor = beaconColor;
    beaconMat.diffuseColor = beaconColor.scale(0.5);
    beaconMat.alpha = 0.12;
    beaconMat.backFaceCulling = false;
    beacon.material = beaconMat;

    // ── FLOATING DIAMOND MARKER (octahedron above NPC head) ────────────────────
    const diamond = MeshBuilder.CreatePolyhedron(`diamond_${id}`, { type: 1, size: 0.25 }, this.scene);
    diamond.parent = root;
    diamond.position.y = 4;
    const diamondMat = new StandardMaterial(`diamondMat_${id}`, this.scene);
    diamondMat.emissiveColor = beaconColor;
    diamondMat.diffuseColor = beaconColor.scale(0.7);
    diamondMat.backFaceCulling = false;
    diamond.material = diamondMat;

    // Name label above head
    const labelPlane = MeshBuilder.CreatePlane(`allyLabel_${id}`, { width: 2.5, height: 0.5 }, this.scene);
    labelPlane.parent = root;
    labelPlane.position.y = 4.5;
    labelPlane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    const labelTex = new DynamicTexture(`allyLabelTex_${id}`, { width: 256, height: 64 }, this.scene, false);
    labelTex.hasAlpha = true;
    const ctx = labelTex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = 'bold 28px sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.textAlign = 'center';
    ctx.fillText(name, 128, 40);
    labelTex.update();
    const labelMat = new StandardMaterial(`allyLabelMat_${id}`, this.scene);
    labelMat.diffuseTexture = labelTex;
    labelMat.useAlphaFromDiffuseTexture = true;
    labelMat.emissiveColor = new Color3(1, 0.85, 0);
    labelMat.disableLighting = true;
    labelMat.backFaceCulling = false;
    labelPlane.material = labelMat;

    // Marker glow (point light) — increased intensity and range
    const light = new PointLight(`allyLight_${id}`, new Vector3(pos.x, pos.y + 2, pos.z), this.scene);
    light.diffuse = color;
    light.intensity = 1.5;
    light.range = 10;

    this.allyNPCMeshes.set(id, root);
  }

  private buildHumanoidNPC(parent: TransformNode, id: string, baseColor: Color3): void {
    const mat = new StandardMaterial(`humanoidMat_${id}`, this.scene);
    mat.diffuseColor = baseColor;
    mat.specularColor = new Color3(0, 0, 0);

    const skinMat = new StandardMaterial(`humanoidSkin_${id}`, this.scene);
    skinMat.diffuseColor = new Color3(0.6, 0.45, 0.3);
    skinMat.specularColor = new Color3(0, 0, 0);

    // ── Torso ────────────────────────────────────────
    const torso = MeshBuilder.CreateBox(`npcTorso_${id}`, { width: 0.7, height: 1.0, depth: 0.4 }, this.scene);
    torso.parent = parent;
    torso.position.y = 1.8;
    torso.material = mat;

    // ── Head ─────────────────────────────────────────
    const head = MeshBuilder.CreateSphere(`npcHead_${id}`, { diameter: 0.45, segments: 8 }, this.scene);
    head.parent = parent;
    head.position.y = 2.6;
    head.material = skinMat;

    // ── Arms (2 cylinders) ──────────────────────────
    for (const side of [-1, 1]) {
      const arm = MeshBuilder.CreateCylinder(`npcArm_${id}_${side}`, { height: 0.9, diameter: 0.18 }, this.scene);
      arm.parent = parent;
      arm.position.set(side * 0.5, 1.7, 0);
      arm.rotation.z = side * 0.15;
      arm.material = mat;
    }

    // ── Legs (2 cylinders) ──────────────────────────
    for (const side of [-1, 1]) {
      const leg = MeshBuilder.CreateCylinder(`npcLeg_${id}_${side}`, { height: 1.0, diameter: 0.22 }, this.scene);
      leg.parent = parent;
      leg.position.set(side * 0.22, 0.7, 0);
      leg.material = mat;
    }

    // ── NPC-specific details ────────────────────────
    if (id === 'sage' || id === 'sage_agastya') {
      // Saffron robes — extend torso with a "robe" box
      const robe = MeshBuilder.CreateBox(`npcRobe_${id}`, { width: 0.85, height: 0.5, depth: 0.5 }, this.scene);
      robe.parent = parent;
      robe.position.y = 1.2;
      const robeMat = new StandardMaterial(`robeMat_${id}`, this.scene);
      robeMat.diffuseColor = new Color3(0.85, 0.5, 0.1);
      robeMat.specularColor = new Color3(0, 0, 0);
      robe.material = robeMat;
      // White beard
      const beard = MeshBuilder.CreateSphere(`npcBeard_${id}`, { diameter: 0.25, segments: 6 }, this.scene);
      beard.parent = parent;
      beard.position.set(0, 2.3, -0.2);
      const beardMat = new StandardMaterial(`beardMat_${id}`, this.scene);
      beardMat.diffuseColor = new Color3(0.9, 0.9, 0.85);
      beardMat.specularColor = new Color3(0, 0, 0);
      beard.material = beardMat;
    } else if (id === 'sugriv' || id === 'angad' || id === 'angad_npc' || id === 'hanuman') {
      // Vanara allies — broader build, golden-brown
      torso.scaling.set(1.2, 1.0, 1.1);
      mat.diffuseColor = new Color3(0.6, 0.4, 0.15);
      // Tail
      const tail = MeshBuilder.CreateCylinder(`npcTail_${id}`, { height: 1.2, diameter: 0.08, arc: 0.5 }, this.scene);
      tail.parent = parent;
      tail.position.set(0, 1.5, 0.35);
      tail.rotation.x = 0.8;
      tail.material = mat;
    } else if (id === 'jatayu' || id === 'sampati') {
      // Bird-like: wider "wing" boxes at shoulders
      for (const side of [-1, 1]) {
        const wing = MeshBuilder.CreateBox(`npcWing_${id}_${side}`, { width: 1.2, height: 0.1, depth: 0.6 }, this.scene);
        wing.parent = parent;
        wing.position.set(side * 0.9, 2.1, 0);
        wing.rotation.z = side * 0.3;
        const wingMat = new StandardMaterial(`wingMat_${id}_${side}`, this.scene);
        wingMat.diffuseColor = new Color3(0.5, 0.45, 0.35);
        wingMat.specularColor = new Color3(0, 0, 0);
        wing.material = wingMat;
      }
    } else if (id === 'vibhishana') {
      // Taller, thinner, pale blue-gray
      torso.scaling.set(0.85, 1.2, 0.85);
      mat.diffuseColor = new Color3(0.5, 0.55, 0.65);
      // Crown/horns
      const horn = MeshBuilder.CreateCylinder(`npcHorn_${id}`, { height: 0.4, diameter: 0.1, diameterTop: 0.02 }, this.scene);
      horn.parent = parent;
      horn.position.y = 2.85;
      const hornMat = new StandardMaterial(`hornMat_${id}`, this.scene);
      hornMat.diffuseColor = new Color3(0.8, 0.7, 0.3);
      hornMat.specularColor = new Color3(0, 0, 0);
      horn.material = hornMat;
    } else if (id === 'lakshman') {
      // Similar to player but green-tinted armor
      const armorMat = new StandardMaterial(`armorMat_${id}`, this.scene);
      armorMat.diffuseColor = new Color3(0.2, 0.5, 0.25);
      armorMat.specularColor = new Color3(0.1, 0.1, 0.1);
      torso.material = armorMat;
      // Shield on left arm
      const shield = MeshBuilder.CreateDisc(`npcShield_${id}`, { radius: 0.3, tessellation: 8 }, this.scene);
      shield.parent = parent;
      shield.position.set(-0.65, 1.8, 0);
      shield.rotation.y = Math.PI / 2;
      shield.material = armorMat;
    }
  }

  removeAllyNPC(id: string): void {
    const root = this.allyNPCMeshes.get(id);
    if (root) { root.dispose(false, true); this.allyNPCMeshes.delete(id); }
  }

  updateNPCBeacons(dt: number): void {
    const now = performance.now() / 1000;
    for (const [id, root] of this.allyNPCMeshes) {
      // Rotate diamond markers
      const diamond = this.scene.getMeshByName(`diamond_${id}`);
      if (diamond) {
        diamond.rotation.x += 1.5 * dt;
        diamond.rotation.y += 1.5 * dt;
      }

      // Pulse beacon cylinder alpha using sin(time * 2)
      const beacon = this.scene.getMeshByName(`beacon_${id}`);
      if (beacon?.material instanceof StandardMaterial) {
        const alphaPulse = 0.10 + Math.sin(now * 2) * 0.04;
        beacon.material.alpha = alphaPulse;
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  COMPANIONS (combat allies that follow the player)
  // ══════════════════════════════════════════════════════════════════════════

  spawnCompanion(id: string, name: string, pos: Vec3): void {
    const root = new TransformNode(`comp_${id}`, this.scene);
    root.position.set(pos.x, pos.y, pos.z);

    const billboard = MeshBuilder.CreatePlane(`comp_billboard_${id}`, { width: 1.4, height: 2.4 }, this.scene);
    billboard.parent = root;
    billboard.position.y = 1.2;
    billboard.billboardMode = Mesh.BILLBOARDMODE_Y;

    const mat = new StandardMaterial(`compMat_${id}`, this.scene);
    const colorMap: Record<string, Color3> = {
      'hanuman': new Color3(1.0, 0.5, 0.0),
      'angad': new Color3(0.2, 0.8, 0.3),
      'lakshman': new Color3(0.2, 0.4, 0.9),
    };
    const color = colorMap[id] || new Color3(0.8, 0.8, 0.2);
    mat.emissiveColor = color.scale(0.5);
    mat.diffuseColor = color;
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;
    billboard.material = mat;

    // Companion name label
    const labelPlane = MeshBuilder.CreatePlane(`compLabel_${id}`, { width: 2.0, height: 0.4 }, this.scene);
    labelPlane.parent = root;
    labelPlane.position.y = 2.8;
    labelPlane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    const labelTex = new DynamicTexture(`compLabelTex_${id}`, { width: 256, height: 64 }, this.scene, false);
    labelTex.hasAlpha = true;
    const ctx2 = labelTex.getContext() as unknown as CanvasRenderingContext2D;
    ctx2.clearRect(0, 0, 256, 64);
    ctx2.font = 'bold 24px sans-serif';
    ctx2.fillStyle = '#90ee90';
    ctx2.textAlign = 'center';
    ctx2.fillText(name, 128, 40);
    labelTex.update();
    const labelMat = new StandardMaterial(`compLabelMat_${id}`, this.scene);
    labelMat.diffuseTexture = labelTex;
    labelMat.useAlphaFromDiffuseTexture = true;
    labelMat.emissiveColor = new Color3(0.5, 1, 0.5);
    labelMat.disableLighting = true;
    labelMat.backFaceCulling = false;
    labelPlane.material = labelMat;

    this.companionMeshes.set(id, root);
  }

  updateCompanion(id: string, pos: Vec3): void {
    const root = this.companionMeshes.get(id);
    if (root) {
      root.position.x = pos.x;
      root.position.y = pos.y;
      root.position.z = pos.z;
    }
  }

  removeCompanion(id: string): void {
    const root = this.companionMeshes.get(id);
    if (root) { root.dispose(false, true); this.companionMeshes.delete(id); }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  MEDITATION EFFECTS
  // ══════════════════════════════════════════════════════════════════════════

  startMeditationEffect(): void {
    this.meditationActive = true;
    // Add a golden point light at the player position
    if (!this.meditationLight) {
      const playerRoot = this.playerMeshes.get(1);
      const pos = playerRoot ? playerRoot.position : Vector3.Zero();
      this.meditationLight = new PointLight('meditationLight', pos.clone(), this.scene);
      this.meditationLight.diffuse = new Color3(1.0, 0.85, 0.3);
      this.meditationLight.intensity = 1.5;
      this.meditationLight.range = 12;
    }
  }

  stopMeditationEffect(): void {
    this.meditationActive = false;
    if (this.meditationLight) {
      this.meditationLight.dispose();
      this.meditationLight = null;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  CHAPTER LANDMARKS (Ramayana-themed procedural structures per chapter)
  // ══════════════════════════════════════════════════════════════════════════

  private buildChapterLandmarks(): void {
    const rng = mulberry32(777); // seeded RNG for deterministic random offsets

    // Ch0: Panchavati — Tutorial
    this.buildChapter0Landmarks(rng, C.CHAPTER_ZONES[0]);

    // Ch1: Dandaka Forest
    this.buildChapter1Landmarks(rng, C.CHAPTER_ZONES[1]);

    // Ch2: Jatayu's Fall
    this.buildChapter2Landmarks(rng, C.CHAPTER_ZONES[2]);

    // Ch3: Kishkindha
    this.buildChapter3Landmarks(rng, C.CHAPTER_ZONES[3]);

    // Ch4: Southern Shore
    this.buildChapter4Landmarks(rng, C.CHAPTER_ZONES[4]);

    // Ch5: Ram Setu Bridge (covered by buildRamSetuBridge, but build adjacent landmarks)
    this.buildChapter5Landmarks(rng, C.CHAPTER_ZONES[5]);

    // Ch6: Lanka Outskirts
    this.buildChapter6Landmarks(rng, C.CHAPTER_ZONES[6]);

    // Ch7: Ravana's Lanka (boss arena already built, ceremonial pillars only)
    this.buildChapter7Landmarks(rng, C.CHAPTER_ZONES[7]);
  }

  private buildChapter0Landmarks(rng: () => number, zone: { x: number; z: number; name: string }): void {
    const centerX = zone.x, centerZ = zone.z;
    const woodColor = new Color3(0.45, 0.32, 0.18);
    const thatchColor = new Color3(0.55, 0.45, 0.22);
    const stoneColor = new Color3(0.5, 0.45, 0.4);
    const warmOrange = new Color3(0.8, 0.4, 0.1);

    // ─── ASHRAM HUT: Thatched-roof shelter with 4 pillars ───
    const hutX = centerX + 8, hutZ = centerZ - 5;
    const hutMat = new StandardMaterial('ch0_hutMat', this.scene);
    hutMat.diffuseColor = woodColor;

    // 4 wooden support pillars
    const pillarPositions = [[-2, -2], [2, -2], [-2, 2], [2, 2]];
    for (let i = 0; i < 4; i++) {
      const [px, pz] = pillarPositions[i];
      const pillar = MeshBuilder.CreateCylinder(`ch0_hutPillar_${i}`, { height: 3.5, diameter: 0.25, tessellation: 8 }, this.scene);
      pillar.position.set(hutX + px, 1.75, hutZ + pz);
      pillar.material = hutMat;
      this.renderer.shadowGenerator.addShadowCaster(pillar);
    }

    // Raised wooden platform floor
    const floor = MeshBuilder.CreateBox('ch0_hutFloor', { width: 5, height: 0.2, depth: 5 }, this.scene);
    floor.position.set(hutX, 0.3, hutZ);
    floor.material = hutMat;
    this.renderer.shadowGenerator.addShadowCaster(floor);

    // Thatched roof (cone)
    const roof = MeshBuilder.CreateCylinder('ch0_hutRoof', {
      height: 2, diameterTop: 0, diameterBottom: 7, tessellation: 4,
    }, this.scene);
    roof.position.set(hutX, 4.5, hutZ);
    roof.rotation.y = Math.PI / 4; // rotate 45 degrees for square shape
    const roofMat = new StandardMaterial('ch0_roofMat', this.scene);
    roofMat.diffuseColor = thatchColor;
    roof.material = roofMat;
    this.renderer.shadowGenerator.addShadowCaster(roof);

    // Cross-beams under roof
    for (let i = 0; i < 2; i++) {
      const beam = MeshBuilder.CreateBox(`ch0_hutBeam_${i}`, { width: i === 0 ? 5 : 0.12, height: 0.12, depth: i === 0 ? 0.12 : 5 }, this.scene);
      beam.position.set(hutX, 3.5, hutZ);
      beam.material = hutMat;
    }

    // Warm interior light inside hut
    const hutLight = new PointLight('ch0_hutLight', new Vector3(hutX, 2.5, hutZ), this.scene);
    hutLight.diffuse = new Color3(1.0, 0.75, 0.4);
    hutLight.intensity = 1.5;
    hutLight.range = 8;

    // ─── SACRED FIRE PIT (Havan Kund) ───
    const fireX = centerX, fireZ = centerZ - 2;

    // Square fire pit base (brick-like)
    const pitBase = MeshBuilder.CreateBox('ch0_firePit', { width: 1.5, height: 0.4, depth: 1.5 }, this.scene);
    pitBase.position.set(fireX, 0.2, fireZ);
    const pitMat = new StandardMaterial('ch0_pitMat', this.scene);
    pitMat.diffuseColor = new Color3(0.6, 0.35, 0.2);
    pitBase.material = pitMat;

    // Inner fire glow
    const fireCore = MeshBuilder.CreateBox('ch0_fireCore', { width: 0.8, height: 0.3, depth: 0.8 }, this.scene);
    fireCore.position.set(fireX, 0.5, fireZ);
    const fireMat = new StandardMaterial('ch0_fireMat', this.scene);
    fireMat.diffuseColor = warmOrange;
    fireMat.emissiveColor = warmOrange;
    fireCore.material = fireMat;

    const fireLight = new PointLight('ch0_fireLight', new Vector3(fireX, 1.5, fireZ), this.scene);
    fireLight.diffuse = new Color3(1.0, 0.6, 0.2);
    fireLight.intensity = 3;
    fireLight.range = 12;

    // T2-5: Add concentric rangoli circle rings at fire pit
    const saffrronOrange = new Color3(1.0, 0.6, 0.2);
    const deepRed = new Color3(0.6, 0.1, 0.05);
    const goldColor = new Color3(1.0, 0.85, 0.4);

    // Ring 1: radius 2.0, thickness 0.08, saffron orange
    const ring1 = MeshBuilder.CreateTorus('ch0_rangoli_ring1', { diameter: 4.0, thickness: 0.08, tessellation: 32 }, this.scene);
    ring1.position.set(fireX, 0.02, fireZ);
    const ring1Mat = new StandardMaterial('ch0_ring1Mat', this.scene);
    ring1Mat.emissiveColor = saffrronOrange;
    ring1Mat.diffuseColor = saffrronOrange;
    ring1.material = ring1Mat;

    // Ring 2: radius 3.0, thickness 0.06, deep red
    const ring2 = MeshBuilder.CreateTorus('ch0_rangoli_ring2', { diameter: 6.0, thickness: 0.06, tessellation: 32 }, this.scene);
    ring2.position.set(fireX, 0.02, fireZ);
    const ring2Mat = new StandardMaterial('ch0_ring2Mat', this.scene);
    ring2Mat.emissiveColor = deepRed;
    ring2Mat.diffuseColor = deepRed;
    ring2.material = ring2Mat;

    // Ring 3: radius 4.0, thickness 0.05, gold
    const ring3 = MeshBuilder.CreateTorus('ch0_rangoli_ring3', { diameter: 8.0, thickness: 0.05, tessellation: 32 }, this.scene);
    ring3.position.set(fireX, 0.02, fireZ);
    const ring3Mat = new StandardMaterial('ch0_ring3Mat', this.scene);
    ring3Mat.emissiveColor = goldColor;
    ring3Mat.diffuseColor = goldColor;
    ring3.material = ring3Mat;

    // ─── MEDITATION CIRCLE (Tapasya spot) ───
    const discRadius = 3;
    const disc = MeshBuilder.CreateDisc('ch0_meditationDisc', { radius: discRadius, tessellation: 32 }, this.scene);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(centerX, 0.05, centerZ + 6);
    const discMat = new StandardMaterial('ch0_discMat', this.scene);
    discMat.diffuseColor = new Color3(0.4, 0.35, 0.28);
    disc.material = discMat;

    // 8 stone boundary markers around meditation circle
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 / 8) * i;
      const stoneX = centerX + Math.cos(angle) * (discRadius + 0.5);
      const stoneZ = (centerZ + 6) + Math.sin(angle) * (discRadius + 0.5);

      const stone = MeshBuilder.CreateCylinder(`ch0_stone_${i}`, { height: 0.6 + rng() * 0.4, diameter: 0.35, tessellation: 6 }, this.scene);
      stone.position.set(stoneX, 0.35, stoneZ);
      const sMat = new StandardMaterial(`ch0_sMat_${i}`, this.scene);
      sMat.diffuseColor = stoneColor;
      stone.material = sMat;
      this.renderer.shadowGenerator.addShadowCaster(stone);
    }

    // ─── TRAINING POSTS (moved beside the ashram) ───
    for (let i = 0; i < 3; i++) {
      const offsetX = (i - 1) * 4;
      const postX = centerX + offsetX - 8;
      const postZ = centerZ;

      const post = MeshBuilder.CreateCylinder(`ch0_post_${i}`, { height: 3, diameter: 0.3, tessellation: 8 }, this.scene);
      post.position.set(postX, 1.5, postZ);
      post.material = hutMat;
      this.renderer.shadowGenerator.addShadowCaster(post);

      const beam = MeshBuilder.CreateBox(`ch0_beam_${i}`, { width: 1.5, height: 0.15, depth: 0.15 }, this.scene);
      beam.position.set(postX, 2.5, postZ);
      beam.material = hutMat;
      this.renderer.shadowGenerator.addShadowCaster(beam);

      // Target disc on post
      const target = MeshBuilder.CreateDisc(`ch0_target_${i}`, { radius: 0.4, tessellation: 16 }, this.scene);
      target.position.set(postX, 1.8, postZ - 0.16);
      const tMat = new StandardMaterial(`ch0_tMat_${i}`, this.scene);
      tMat.diffuseColor = new Color3(0.7, 0.15, 0.1);
      tMat.emissiveColor = new Color3(0.3, 0.05, 0.0);
      target.material = tMat;
    }

    // ─── ASHRAM ENTRANCE GATE (Torana) ───
    const gateX = centerX, gateZ = centerZ - 12;
    const gateMat = new StandardMaterial('ch0_gateMat', this.scene);
    gateMat.diffuseColor = new Color3(0.5, 0.38, 0.22);

    // Two gate pillars
    for (const side of [-1, 1]) {
      const gPillar = MeshBuilder.CreateCylinder(`ch0_gate_${side}`, { height: 4, diameter: 0.35, tessellation: 8 }, this.scene);
      gPillar.position.set(gateX + side * 2.5, 2, gateZ);
      gPillar.material = gateMat;
      this.renderer.shadowGenerator.addShadowCaster(gPillar);
    }

    // Gate crossbar
    const crossbar = MeshBuilder.CreateBox('ch0_gateCross', { width: 5.5, height: 0.3, depth: 0.3 }, this.scene);
    crossbar.position.set(gateX, 4, gateZ);
    crossbar.material = gateMat;
    this.renderer.shadowGenerator.addShadowCaster(crossbar);

    // Gate overhead decoration (small pyramid)
    const gateTop = MeshBuilder.CreateCylinder('ch0_gateTop', {
      height: 1, diameterTop: 0, diameterBottom: 1.5, tessellation: 4,
    }, this.scene);
    gateTop.position.set(gateX, 4.7, gateZ);
    gateTop.rotation.y = Math.PI / 4;
    const gateTopMat = new StandardMaterial('ch0_gateTopMat', this.scene);
    gateTopMat.diffuseColor = warmOrange;
    gateTopMat.emissiveColor = new Color3(0.3, 0.15, 0.05);
    gateTop.material = gateTopMat;
  }

  private buildChapter1Landmarks(rng: () => number, zone: { x: number; z: number; name: string }): void {
    const centerX = zone.x, centerZ = zone.z;

    // 4 ruin pillars: cylinders with moss-green tint
    for (let i = 0; i < 4; i++) {
      const offsetX = (i % 2 === 0 ? -1 : 1) * 6 + (rng() - 0.5) * 2;
      const offsetZ = (Math.floor(i / 2) - 0.5) * 8 + (rng() - 0.5) * 2;
      const pillarX = centerX + offsetX;
      const pillarZ = centerZ + offsetZ;

      const height = 4 + rng() * 3;
      const diameter = 0.8 + rng() * 0.2;
      const pillar = MeshBuilder.CreateCylinder(`ch1_pillar_${i}`, { height, diameter, tessellation: 8 }, this.scene);
      pillar.position.set(pillarX, height / 2, pillarZ);

      const pillarMat = new StandardMaterial(`ch1_pillarMat_${i}`, this.scene);
      pillarMat.diffuseColor = new Color3(0.15, 0.25, 0.1);
      pillar.material = pillarMat;
      this.renderer.shadowGenerator.addShadowCaster(pillar);
    }

    // 2 fallen logs: boxes, dark brown
    for (let i = 0; i < 2; i++) {
      const offsetX = (i === 0 ? -8 : 8) + (rng() - 0.5) * 2;
      const offsetZ = (rng() - 0.5) * 4;
      const logX = centerX + offsetX;
      const logZ = centerZ + offsetZ;

      const logLength = 5 + rng() * 2;
      const log = MeshBuilder.CreateBox(`ch1_log_${i}`, { width: 0.6, height: 0.5, depth: logLength }, this.scene);
      log.position.set(logX, 0.4, logZ);
      log.rotation.z = (rng() - 0.5) * 0.3;

      const logMat = new StandardMaterial(`ch1_logMat_${i}`, this.scene);
      logMat.diffuseColor = new Color3(0.25, 0.15, 0.08);
      log.material = logMat;
      this.renderer.shadowGenerator.addShadowCaster(log);
    }

    // ─── DANDAKA ASHRAM (forest hermitage) ───
    // Ashram is at ASHRAM_POSITIONS[1] = (centerX, centerZ - 2)
    const ashX = centerX, ashZ = centerZ - 2;
    const ch1Wood = new Color3(0.3, 0.22, 0.1);
    const ch1Thatch = new Color3(0.35, 0.38, 0.15); // mossy green thatch
    const ch1Stone = new Color3(0.35, 0.32, 0.28);
    const ch1Warm = new Color3(0.8, 0.4, 0.1);

    // Thatched-roof forest hut with 4 pillars
    const ch1HutX = ashX + 7, ch1HutZ = ashZ - 4;
    const ch1HutMat = new StandardMaterial('ch1_hutMat', this.scene);
    ch1HutMat.diffuseColor = ch1Wood;

    for (let i = 0; i < 4; i++) {
      const [px, pz] = [[-2, -2], [2, -2], [-2, 2], [2, 2]][i];
      const pillar = MeshBuilder.CreateCylinder(`ch1_hutPillar_${i}`, { height: 3.5, diameter: 0.25, tessellation: 8 }, this.scene);
      pillar.position.set(ch1HutX + px, 1.75, ch1HutZ + pz);
      pillar.material = ch1HutMat;
      this.renderer.shadowGenerator.addShadowCaster(pillar);
    }

    const ch1Floor = MeshBuilder.CreateBox('ch1_hutFloor', { width: 5, height: 0.2, depth: 5 }, this.scene);
    ch1Floor.position.set(ch1HutX, 0.3, ch1HutZ);
    ch1Floor.material = ch1HutMat;
    this.renderer.shadowGenerator.addShadowCaster(ch1Floor);

    const ch1Roof = MeshBuilder.CreateCylinder('ch1_hutRoof', {
      height: 2, diameterTop: 0, diameterBottom: 7, tessellation: 4,
    }, this.scene);
    ch1Roof.position.set(ch1HutX, 4.5, ch1HutZ);
    ch1Roof.rotation.y = Math.PI / 4;
    const ch1RoofMat = new StandardMaterial('ch1_roofMat', this.scene);
    ch1RoofMat.diffuseColor = ch1Thatch;
    ch1Roof.material = ch1RoofMat;
    this.renderer.shadowGenerator.addShadowCaster(ch1Roof);

    for (let i = 0; i < 2; i++) {
      const beam = MeshBuilder.CreateBox(`ch1_hutBeam_${i}`, { width: i === 0 ? 5 : 0.12, height: 0.12, depth: i === 0 ? 0.12 : 5 }, this.scene);
      beam.position.set(ch1HutX, 3.5, ch1HutZ);
      beam.material = ch1HutMat;
    }

    const ch1HutLight = new PointLight('ch1_hutLight', new Vector3(ch1HutX, 2.5, ch1HutZ), this.scene);
    ch1HutLight.diffuse = new Color3(1.0, 0.75, 0.4);
    ch1HutLight.intensity = 1.5;
    ch1HutLight.range = 8;

    // Sacred fire pit (Havan Kund)
    const ch1PitBase = MeshBuilder.CreateBox('ch1_firePit', { width: 1.5, height: 0.4, depth: 1.5 }, this.scene);
    ch1PitBase.position.set(ashX, 0.2, ashZ);
    const ch1PitMat = new StandardMaterial('ch1_pitMat', this.scene);
    ch1PitMat.diffuseColor = new Color3(0.6, 0.35, 0.2);
    ch1PitBase.material = ch1PitMat;

    const ch1FireCore = MeshBuilder.CreateBox('ch1_fireCore', { width: 0.8, height: 0.3, depth: 0.8 }, this.scene);
    ch1FireCore.position.set(ashX, 0.5, ashZ);
    const ch1FireMat = new StandardMaterial('ch1_fireMat', this.scene);
    ch1FireMat.diffuseColor = ch1Warm;
    ch1FireMat.emissiveColor = ch1Warm;
    ch1FireCore.material = ch1FireMat;

    const ch1FireLight = new PointLight('ch1_fireLight', new Vector3(ashX, 1.5, ashZ), this.scene);
    ch1FireLight.diffuse = new Color3(1.0, 0.6, 0.2);
    ch1FireLight.intensity = 3;
    ch1FireLight.range = 12;

    // T2-5: Add concentric rangoli circle rings at fire pit
    const saffrronOrange = new Color3(1.0, 0.6, 0.2);
    const deepRed = new Color3(0.6, 0.1, 0.05);
    const goldColor = new Color3(1.0, 0.85, 0.4);

    const ch1Ring1 = MeshBuilder.CreateTorus('ch1_rangoli_ring1', { diameter: 4.0, thickness: 0.08, tessellation: 32 }, this.scene);
    ch1Ring1.position.set(ashX, 0.02, ashZ);
    const ch1Ring1Mat = new StandardMaterial('ch1_ring1Mat', this.scene);
    ch1Ring1Mat.emissiveColor = saffrronOrange;
    ch1Ring1Mat.diffuseColor = saffrronOrange;
    ch1Ring1.material = ch1Ring1Mat;

    const ch1Ring2 = MeshBuilder.CreateTorus('ch1_rangoli_ring2', { diameter: 6.0, thickness: 0.06, tessellation: 32 }, this.scene);
    ch1Ring2.position.set(ashX, 0.02, ashZ);
    const ch1Ring2Mat = new StandardMaterial('ch1_ring2Mat', this.scene);
    ch1Ring2Mat.emissiveColor = deepRed;
    ch1Ring2Mat.diffuseColor = deepRed;
    ch1Ring2.material = ch1Ring2Mat;

    const ch1Ring3 = MeshBuilder.CreateTorus('ch1_rangoli_ring3', { diameter: 8.0, thickness: 0.05, tessellation: 32 }, this.scene);
    ch1Ring3.position.set(ashX, 0.02, ashZ);
    const ch1Ring3Mat = new StandardMaterial('ch1_ring3Mat', this.scene);
    ch1Ring3Mat.emissiveColor = goldColor;
    ch1Ring3Mat.diffuseColor = goldColor;
    ch1Ring3.material = ch1Ring3Mat;

    // Meditation circle with stone boundary markers
    const ch1DiscR = 3;
    const ch1Disc = MeshBuilder.CreateDisc('ch1_meditationDisc', { radius: ch1DiscR, tessellation: 32 }, this.scene);
    ch1Disc.rotation.x = Math.PI / 2;
    ch1Disc.position.set(ashX, 0.05, ashZ + 6);
    const ch1DiscMat = new StandardMaterial('ch1_discMat', this.scene);
    ch1DiscMat.diffuseColor = new Color3(0.25, 0.3, 0.18);
    ch1Disc.material = ch1DiscMat;

    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 / 8) * i;
      const sx = ashX + Math.cos(angle) * (ch1DiscR + 0.5);
      const sz = (ashZ + 6) + Math.sin(angle) * (ch1DiscR + 0.5);
      const stone = MeshBuilder.CreateCylinder(`ch1_stone_${i}`, { height: 0.6 + rng() * 0.4, diameter: 0.35, tessellation: 6 }, this.scene);
      stone.position.set(sx, 0.35, sz);
      const sMat = new StandardMaterial(`ch1_sMat_${i}`, this.scene);
      sMat.diffuseColor = ch1Stone;
      stone.material = sMat;
      this.renderer.shadowGenerator.addShadowCaster(stone);
    }

    // Entrance torana gate (vine-covered forest gate)
    const ch1GateX = ashX, ch1GateZ = ashZ - 12;
    const ch1GateMat = new StandardMaterial('ch1_gateMat', this.scene);
    ch1GateMat.diffuseColor = new Color3(0.35, 0.28, 0.15);

    for (const side of [-1, 1]) {
      const gP = MeshBuilder.CreateCylinder(`ch1_gate_${side}`, { height: 4, diameter: 0.35, tessellation: 8 }, this.scene);
      gP.position.set(ch1GateX + side * 2.5, 2, ch1GateZ);
      gP.material = ch1GateMat;
      this.renderer.shadowGenerator.addShadowCaster(gP);
    }

    const ch1Cross = MeshBuilder.CreateBox('ch1_gateCross', { width: 5.5, height: 0.3, depth: 0.3 }, this.scene);
    ch1Cross.position.set(ch1GateX, 4, ch1GateZ);
    ch1Cross.material = ch1GateMat;
    this.renderer.shadowGenerator.addShadowCaster(ch1Cross);

    const ch1GateTop = MeshBuilder.CreateCylinder('ch1_gateTop', {
      height: 1, diameterTop: 0, diameterBottom: 1.5, tessellation: 4,
    }, this.scene);
    ch1GateTop.position.set(ch1GateX, 4.7, ch1GateZ);
    ch1GateTop.rotation.y = Math.PI / 4;
    const ch1GateTopMat = new StandardMaterial('ch1_gateTopMat', this.scene);
    ch1GateTopMat.diffuseColor = ch1Warm;
    ch1GateTopMat.emissiveColor = new Color3(0.3, 0.15, 0.05);
    ch1GateTop.material = ch1GateTopMat;
  }

  private buildChapter2Landmarks(rng: () => number, zone: { x: number; z: number; name: string }): void {
    const centerX = zone.x, centerZ = zone.z;

    // 4 charred stumps: black cylinders with emissive
    for (let i = 0; i < 4; i++) {
      const offsetX = (i % 2 === 0 ? -1 : 1) * 5 + (rng() - 0.5) * 2;
      const offsetZ = (Math.floor(i / 2) - 0.5) * 6 + (rng() - 0.5) * 2;
      const stumpX = centerX + offsetX;
      const stumpZ = centerZ + offsetZ;

      const height = 1.5 + rng() * 1.5;
      const diameter = 0.5 + rng() * 0.5;
      const stump = MeshBuilder.CreateCylinder(`ch2_stump_${i}`, { height, diameter, tessellation: 8 }, this.scene);
      stump.position.set(stumpX, height / 2, stumpZ);

      const stumpMat = new StandardMaterial(`ch2_stumpMat_${i}`, this.scene);
      stumpMat.diffuseColor = new Color3(0.08, 0.06, 0.05);
      stumpMat.emissiveColor = new Color3(0.02, 0.01, 0.0);
      stump.material = stumpMat;
      this.renderer.shadowGenerator.addShadowCaster(stump);
    }

    // Jatayu's perch: 3 stacked boxes
    const basePerch = MeshBuilder.CreateBox(`ch2_perchBase`, { width: 4, height: 1, depth: 4 }, this.scene);
    basePerch.position.set(centerX, 0.5, centerZ);
    const perchMat = new StandardMaterial(`ch2_perchMat`, this.scene);
    perchMat.diffuseColor = new Color3(0.5, 0.4, 0.3);
    basePerch.material = perchMat;
    this.renderer.shadowGenerator.addShadowCaster(basePerch);

    const midPerch = MeshBuilder.CreateBox(`ch2_perchMid`, { width: 3, height: 1.5, depth: 3 }, this.scene);
    midPerch.position.set(centerX, 1.25, centerZ);
    midPerch.material = perchMat;
    this.renderer.shadowGenerator.addShadowCaster(midPerch);

    const topPerch = MeshBuilder.CreateBox(`ch2_perchTop`, { width: 2, height: 1, depth: 2 }, this.scene);
    topPerch.position.set(centerX, 2.25, centerZ);
    topPerch.material = perchMat;
    this.renderer.shadowGenerator.addShadowCaster(topPerch);

    // 2 battle markers: thin tall boxes, dark red
    for (let i = 0; i < 2; i++) {
      const offsetX = (i === 0 ? -3 : 3) + (rng() - 0.5);
      const markerX = centerX + offsetX;

      const marker = MeshBuilder.CreateBox(`ch2_marker_${i}`, { width: 0.25, height: 2, depth: 0.25 }, this.scene);
      marker.position.set(markerX, 1, centerZ + 4);

      const markerMat = new StandardMaterial(`ch2_markerMat_${i}`, this.scene);
      markerMat.diffuseColor = new Color3(0.5, 0.1, 0.08);
      marker.material = markerMat;
      this.renderer.shadowGenerator.addShadowCaster(marker);
    }

    // 5 debris: small boxes scattered
    for (let i = 0; i < 5; i++) {
      const debrisX = centerX + (rng() - 0.5) * 10;
      const debrisZ = centerZ + (rng() - 0.5) * 10;
      const debrisSize = 0.3 + rng() * 0.2;

      const debris = MeshBuilder.CreateBox(`ch2_debris_${i}`, { width: debrisSize, height: debrisSize, depth: debrisSize }, this.scene);
      debris.position.set(debrisX, debrisSize / 2, debrisZ);

      const debrisMat = new StandardMaterial(`ch2_debrisMat_${i}`, this.scene);
      debrisMat.diffuseColor = new Color3(0.3, 0.2, 0.15);
      debris.material = debrisMat;
      this.renderer.shadowGenerator.addShadowCaster(debris);
    }
  }

  private buildChapter3Landmarks(rng: () => number, zone: { x: number; z: number; name: string }): void {
    const centerX = zone.x, centerZ = zone.z;

    // Cave entrance: 2 tall pillars + horizontal beam
    const pillar1 = MeshBuilder.CreateBox(`ch3_pillar1`, { width: 1.5, height: 8, depth: 1.5 }, this.scene);
    pillar1.position.set(centerX - 2.5, 4, centerZ);
    const pillarMat = new StandardMaterial(`ch3_pillarMat`, this.scene);
    pillarMat.diffuseColor = new Color3(0.4, 0.35, 0.3);
    pillar1.material = pillarMat;
    this.renderer.shadowGenerator.addShadowCaster(pillar1);

    const pillar2 = MeshBuilder.CreateBox(`ch3_pillar2`, { width: 1.5, height: 8, depth: 1.5 }, this.scene);
    pillar2.position.set(centerX + 2.5, 4, centerZ);
    pillar2.material = pillarMat;
    this.renderer.shadowGenerator.addShadowCaster(pillar2);

    const lintel = MeshBuilder.CreateBox(`ch3_lintel`, { width: 6, height: 1, depth: 1.5 }, this.scene);
    lintel.position.set(centerX, 8, centerZ);
    lintel.material = pillarMat;
    this.renderer.shadowGenerator.addShadowCaster(lintel);

    // Rock throne: 3 stacked boxes with golden tint
    const throneBase = MeshBuilder.CreateBox(`ch3_throneBase`, { width: 3, height: 1, depth: 3 }, this.scene);
    throneBase.position.set(centerX, 0.5, centerZ + 8);
    const throneMat = new StandardMaterial(`ch3_throneMat`, this.scene);
    throneMat.diffuseColor = new Color3(0.7, 0.55, 0.2);
    throneBase.material = throneMat;
    this.renderer.shadowGenerator.addShadowCaster(throneBase);

    const throneMid = MeshBuilder.CreateBox(`ch3_throneMid`, { width: 2, height: 1.5, depth: 2 }, this.scene);
    throneMid.position.set(centerX, 1.25, centerZ + 8);
    throneMid.material = throneMat;
    this.renderer.shadowGenerator.addShadowCaster(throneMid);

    const throneTop = MeshBuilder.CreateBox(`ch3_throneTop`, { width: 1.5, height: 0.5, depth: 1.5 }, this.scene);
    throneTop.position.set(centerX, 2.0, centerZ + 8);
    throneTop.material = throneMat;
    this.renderer.shadowGenerator.addShadowCaster(throneTop);

    // 2 mountain walls: large boxes flanking the area
    const wallMat = new StandardMaterial(`ch3_wallMat`, this.scene);
    wallMat.diffuseColor = new Color3(0.42, 0.38, 0.32);

    const wall1 = MeshBuilder.CreateBox(`ch3_wall1`, { width: 8, height: 12, depth: 1.5 }, this.scene);
    wall1.position.set(centerX - 15, 6, centerZ);
    wall1.material = wallMat;
    this.renderer.shadowGenerator.addShadowCaster(wall1);

    const wall2 = MeshBuilder.CreateBox(`ch3_wall2`, { width: 8, height: 12, depth: 1.5 }, this.scene);
    wall2.position.set(centerX + 15, 6, centerZ);
    wall2.material = wallMat;
    this.renderer.shadowGenerator.addShadowCaster(wall2);

    // 3 banner poles: cylinders with colored flag boxes
    for (let i = 0; i < 3; i++) {
      const offsetX = (i - 1) * 5 + (rng() - 0.5) * 1;
      const poleX = centerX + offsetX;

      const pole = MeshBuilder.CreateCylinder(`ch3_pole_${i}`, { height: 5, diameter: 0.15, tessellation: 8 }, this.scene);
      pole.position.set(poleX, 2.5, centerZ - 8);
      const poleMat = new StandardMaterial(`ch3_poleMat_${i}`, this.scene);
      poleMat.diffuseColor = new Color3(0.3, 0.25, 0.2);
      pole.material = poleMat;
      this.renderer.shadowGenerator.addShadowCaster(pole);

      const flag = MeshBuilder.CreateBox(`ch3_flag_${i}`, { width: 0.3, height: 0.6, depth: 0.05 }, this.scene);
      flag.position.set(poleX, 5.2, centerZ - 8);
      const flagMat = new StandardMaterial(`ch3_flagMat_${i}`, this.scene);
      flagMat.diffuseColor = new Color3(1.0, 0.65, 0.2);
      flag.material = flagMat;
      this.renderer.shadowGenerator.addShadowCaster(flag);
    }

    // ─── KISHKINDHA ASHRAM (highland camp) ───
    // Ashram is at ASHRAM_POSITIONS[2] = (centerX, centerZ - 2)
    const ashX = centerX, ashZ = centerZ - 2;
    const ch3Wood = new Color3(0.45, 0.35, 0.2);
    const ch3Thatch = new Color3(0.5, 0.42, 0.18); // dry highland thatch
    const ch3Stone = new Color3(0.5, 0.45, 0.38);
    const ch3Warm = new Color3(0.9, 0.45, 0.1);

    // Highland ashram hut — sturdy stone-and-wood shelter
    const ch3HutX = ashX + 8, ch3HutZ = ashZ - 3;
    const ch3HutMat = new StandardMaterial('ch3_hutMat', this.scene);
    ch3HutMat.diffuseColor = ch3Wood;

    for (let i = 0; i < 4; i++) {
      const [px, pz] = [[-2, -2], [2, -2], [-2, 2], [2, 2]][i];
      const pillar = MeshBuilder.CreateCylinder(`ch3_hutPillar_${i}`, { height: 3.5, diameter: 0.3, tessellation: 8 }, this.scene);
      pillar.position.set(ch3HutX + px, 1.75, ch3HutZ + pz);
      pillar.material = ch3HutMat;
      this.renderer.shadowGenerator.addShadowCaster(pillar);
    }

    const ch3Floor = MeshBuilder.CreateBox('ch3_hutFloor', { width: 5, height: 0.25, depth: 5 }, this.scene);
    ch3Floor.position.set(ch3HutX, 0.35, ch3HutZ);
    ch3Floor.material = ch3HutMat;
    this.renderer.shadowGenerator.addShadowCaster(ch3Floor);

    const ch3Roof = MeshBuilder.CreateCylinder('ch3_hutRoof', {
      height: 2.2, diameterTop: 0, diameterBottom: 7, tessellation: 4,
    }, this.scene);
    ch3Roof.position.set(ch3HutX, 4.6, ch3HutZ);
    ch3Roof.rotation.y = Math.PI / 4;
    const ch3RoofMat = new StandardMaterial('ch3_roofMat', this.scene);
    ch3RoofMat.diffuseColor = ch3Thatch;
    ch3Roof.material = ch3RoofMat;
    this.renderer.shadowGenerator.addShadowCaster(ch3Roof);

    for (let i = 0; i < 2; i++) {
      const beam = MeshBuilder.CreateBox(`ch3_hutBeam_${i}`, { width: i === 0 ? 5 : 0.12, height: 0.12, depth: i === 0 ? 0.12 : 5 }, this.scene);
      beam.position.set(ch3HutX, 3.5, ch3HutZ);
      beam.material = ch3HutMat;
    }

    const ch3HutLight = new PointLight('ch3_hutLight', new Vector3(ch3HutX, 2.5, ch3HutZ), this.scene);
    ch3HutLight.diffuse = new Color3(1.0, 0.8, 0.45);
    ch3HutLight.intensity = 1.5;
    ch3HutLight.range = 8;

    // Sacred fire pit (Havan Kund)
    const ch3PitBase = MeshBuilder.CreateBox('ch3_firePit', { width: 1.5, height: 0.4, depth: 1.5 }, this.scene);
    ch3PitBase.position.set(ashX, 0.2, ashZ);
    const ch3PitMat = new StandardMaterial('ch3_pitMat', this.scene);
    ch3PitMat.diffuseColor = new Color3(0.55, 0.4, 0.25);
    ch3PitBase.material = ch3PitMat;

    const ch3FireCore = MeshBuilder.CreateBox('ch3_fireCore', { width: 0.8, height: 0.3, depth: 0.8 }, this.scene);
    ch3FireCore.position.set(ashX, 0.5, ashZ);
    const ch3FireMat = new StandardMaterial('ch3_fireMat', this.scene);
    ch3FireMat.diffuseColor = ch3Warm;
    ch3FireMat.emissiveColor = ch3Warm;
    ch3FireCore.material = ch3FireMat;

    const ch3FireLight = new PointLight('ch3_fireLight', new Vector3(ashX, 1.5, ashZ), this.scene);
    ch3FireLight.diffuse = new Color3(1.0, 0.6, 0.2);
    ch3FireLight.intensity = 3;
    ch3FireLight.range = 12;

    // T2-5: Add concentric rangoli circle rings at fire pit
    const saffrronOrange = new Color3(1.0, 0.6, 0.2);
    const deepRed = new Color3(0.6, 0.1, 0.05);
    const goldColor = new Color3(1.0, 0.85, 0.4);

    const ch3Ring1 = MeshBuilder.CreateTorus('ch3_rangoli_ring1', { diameter: 4.0, thickness: 0.08, tessellation: 32 }, this.scene);
    ch3Ring1.position.set(ashX, 0.02, ashZ);
    const ch3Ring1Mat = new StandardMaterial('ch3_ring1Mat', this.scene);
    ch3Ring1Mat.emissiveColor = saffrronOrange;
    ch3Ring1Mat.diffuseColor = saffrronOrange;
    ch3Ring1.material = ch3Ring1Mat;

    const ch3Ring2 = MeshBuilder.CreateTorus('ch3_rangoli_ring2', { diameter: 6.0, thickness: 0.06, tessellation: 32 }, this.scene);
    ch3Ring2.position.set(ashX, 0.02, ashZ);
    const ch3Ring2Mat = new StandardMaterial('ch3_ring2Mat', this.scene);
    ch3Ring2Mat.emissiveColor = deepRed;
    ch3Ring2Mat.diffuseColor = deepRed;
    ch3Ring2.material = ch3Ring2Mat;

    const ch3Ring3 = MeshBuilder.CreateTorus('ch3_rangoli_ring3', { diameter: 8.0, thickness: 0.05, tessellation: 32 }, this.scene);
    ch3Ring3.position.set(ashX, 0.02, ashZ);
    const ch3Ring3Mat = new StandardMaterial('ch3_ring3Mat', this.scene);
    ch3Ring3Mat.emissiveColor = goldColor;
    ch3Ring3Mat.diffuseColor = goldColor;
    ch3Ring3.material = ch3Ring3Mat;

    // Meditation circle with stone boundary markers
    const ch3DiscR = 3;
    const ch3Disc = MeshBuilder.CreateDisc('ch3_meditationDisc', { radius: ch3DiscR, tessellation: 32 }, this.scene);
    ch3Disc.rotation.x = Math.PI / 2;
    ch3Disc.position.set(ashX, 0.05, ashZ + 7);
    const ch3DiscMat = new StandardMaterial('ch3_discMat', this.scene);
    ch3DiscMat.diffuseColor = new Color3(0.45, 0.38, 0.28);
    ch3Disc.material = ch3DiscMat;

    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 / 8) * i;
      const sx = ashX + Math.cos(angle) * (ch3DiscR + 0.5);
      const sz = (ashZ + 7) + Math.sin(angle) * (ch3DiscR + 0.5);
      const stone = MeshBuilder.CreateCylinder(`ch3_ashStone_${i}`, { height: 0.7 + rng() * 0.5, diameter: 0.4, tessellation: 6 }, this.scene);
      stone.position.set(sx, 0.4, sz);
      const sMat = new StandardMaterial(`ch3_ashSMat_${i}`, this.scene);
      sMat.diffuseColor = ch3Stone;
      stone.material = sMat;
      this.renderer.shadowGenerator.addShadowCaster(stone);
    }

    // Entrance torana gate (mountain stone gate)
    const ch3GateX = ashX, ch3GateZ = ashZ - 12;
    const ch3GateMat = new StandardMaterial('ch3_ashGateMat', this.scene);
    ch3GateMat.diffuseColor = new Color3(0.48, 0.4, 0.28);

    for (const side of [-1, 1]) {
      const gP = MeshBuilder.CreateCylinder(`ch3_ashGate_${side}`, { height: 4.5, diameter: 0.4, tessellation: 8 }, this.scene);
      gP.position.set(ch3GateX + side * 2.5, 2.25, ch3GateZ);
      gP.material = ch3GateMat;
      this.renderer.shadowGenerator.addShadowCaster(gP);
    }

    const ch3Cross = MeshBuilder.CreateBox('ch3_ashGateCross', { width: 5.5, height: 0.35, depth: 0.35 }, this.scene);
    ch3Cross.position.set(ch3GateX, 4.5, ch3GateZ);
    ch3Cross.material = ch3GateMat;
    this.renderer.shadowGenerator.addShadowCaster(ch3Cross);

    const ch3GateTop = MeshBuilder.CreateCylinder('ch3_ashGateTop', {
      height: 1.2, diameterTop: 0, diameterBottom: 1.8, tessellation: 4,
    }, this.scene);
    ch3GateTop.position.set(ch3GateX, 5.2, ch3GateZ);
    ch3GateTop.rotation.y = Math.PI / 4;
    const ch3GateTopMat = new StandardMaterial('ch3_ashGateTopMat', this.scene);
    ch3GateTopMat.diffuseColor = ch3Warm;
    ch3GateTopMat.emissiveColor = new Color3(0.35, 0.18, 0.05);
    ch3GateTop.material = ch3GateTopMat;
  }

  private buildChapter4Landmarks(rng: () => number, zone: { x: number; z: number; name: string }): void {
    const centerX = zone.x, centerZ = zone.z;

    // 6 coastal boulders: spheres partially buried
    const boulderMat = new StandardMaterial(`ch4_boulderMat`, this.scene);
    boulderMat.diffuseColor = new Color3(0.4, 0.38, 0.35);

    for (let i = 0; i < 6; i++) {
      const offsetX = (i % 3 === 0 ? -1 : (i % 3 === 1 ? 1 : 0)) * 8 + (rng() - 0.5) * 3;
      const offsetZ = (Math.floor(i / 3) - 0.5) * 6 + (rng() - 0.5) * 2;
      const boulderX = centerX + offsetX;
      const boulderZ = centerZ + offsetZ;

      const diameter = 2 + rng() * 1.5;
      const boulder = MeshBuilder.CreateSphere(`ch4_boulder_${i}`, { diameter, segments: 12 }, this.scene);
      boulder.position.set(boulderX, -0.3 + rng() * 0.6, boulderZ);
      boulder.material = boulderMat;
      this.renderer.shadowGenerator.addShadowCaster(boulder);
    }

    // 2 driftwood: angled boxes, lighter brown
    const driftMat = new StandardMaterial(`ch4_driftMat`, this.scene);
    driftMat.diffuseColor = new Color3(0.5, 0.4, 0.3);

    for (let i = 0; i < 2; i++) {
      const offsetX = (i === 0 ? -5 : 5) + (rng() - 0.5) * 2;
      const driftX = centerX + offsetX;
      const driftZ = centerZ + (rng() - 0.5) * 4;

      const drift = MeshBuilder.CreateBox(`ch4_drift_${i}`, { width: 0.5, height: 0.4, depth: 3 }, this.scene);
      drift.position.set(driftX, 0.2, driftZ);
      drift.rotation.z = (rng() - 0.5) * 0.4;
      drift.material = driftMat;
      this.renderer.shadowGenerator.addShadowCaster(drift);
    }

    // Shore marker pole with flag
    const markerPole = MeshBuilder.CreateCylinder(`ch4_markerPole`, { height: 4, diameter: 0.2, tessellation: 8 }, this.scene);
    markerPole.position.set(centerX, 2, centerZ - 6);
    const markerPoleMat = new StandardMaterial(`ch4_markerPoleMat`, this.scene);
    markerPoleMat.diffuseColor = new Color3(0.35, 0.3, 0.25);
    markerPole.material = markerPoleMat;
    this.renderer.shadowGenerator.addShadowCaster(markerPole);

    const markerFlag = MeshBuilder.CreateBox(`ch4_markerFlag`, { width: 0.4, height: 0.7, depth: 0.05 }, this.scene);
    markerFlag.position.set(centerX, 4, centerZ - 6);
    const markerFlagMat = new StandardMaterial(`ch4_markerFlagMat`, this.scene);
    markerFlagMat.diffuseColor = new Color3(1.0, 0.5, 0.1);
    markerFlag.material = markerFlagMat;
    this.renderer.shadowGenerator.addShadowCaster(markerFlag);

    // ─── SOUTHERN SHORE ASHRAM (coastal shelter) ───
    // Ashram is at ASHRAM_POSITIONS[3] = (centerX, centerZ - 2)
    const ashX = centerX, ashZ = centerZ - 2;
    const ch4Wood = new Color3(0.5, 0.4, 0.3); // sun-bleached driftwood
    const ch4Thatch = new Color3(0.6, 0.55, 0.35); // pale sandy thatch
    const ch4Stone = new Color3(0.45, 0.42, 0.38);
    const ch4Warm = new Color3(0.85, 0.5, 0.15);

    // Coastal shelter hut — lighter, open-air feel
    const ch4HutX = ashX + 7, ch4HutZ = ashZ - 3;
    const ch4HutMat = new StandardMaterial('ch4_hutMat', this.scene);
    ch4HutMat.diffuseColor = ch4Wood;

    for (let i = 0; i < 4; i++) {
      const [px, pz] = [[-2, -2], [2, -2], [-2, 2], [2, 2]][i];
      const pillar = MeshBuilder.CreateCylinder(`ch4_hutPillar_${i}`, { height: 3.2, diameter: 0.28, tessellation: 8 }, this.scene);
      pillar.position.set(ch4HutX + px, 1.6, ch4HutZ + pz);
      pillar.material = ch4HutMat;
      this.renderer.shadowGenerator.addShadowCaster(pillar);
    }

    const ch4Floor = MeshBuilder.CreateBox('ch4_hutFloor', { width: 5, height: 0.15, depth: 5 }, this.scene);
    ch4Floor.position.set(ch4HutX, 0.25, ch4HutZ);
    ch4Floor.material = ch4HutMat;
    this.renderer.shadowGenerator.addShadowCaster(ch4Floor);

    const ch4Roof = MeshBuilder.CreateCylinder('ch4_hutRoof', {
      height: 1.8, diameterTop: 0, diameterBottom: 7, tessellation: 4,
    }, this.scene);
    ch4Roof.position.set(ch4HutX, 4.1, ch4HutZ);
    ch4Roof.rotation.y = Math.PI / 4;
    const ch4RoofMat = new StandardMaterial('ch4_roofMat', this.scene);
    ch4RoofMat.diffuseColor = ch4Thatch;
    ch4Roof.material = ch4RoofMat;
    this.renderer.shadowGenerator.addShadowCaster(ch4Roof);

    for (let i = 0; i < 2; i++) {
      const beam = MeshBuilder.CreateBox(`ch4_hutBeam_${i}`, { width: i === 0 ? 5 : 0.12, height: 0.12, depth: i === 0 ? 0.12 : 5 }, this.scene);
      beam.position.set(ch4HutX, 3.2, ch4HutZ);
      beam.material = ch4HutMat;
    }

    const ch4HutLight = new PointLight('ch4_hutLight', new Vector3(ch4HutX, 2.2, ch4HutZ), this.scene);
    ch4HutLight.diffuse = new Color3(1.0, 0.85, 0.55);
    ch4HutLight.intensity = 1.5;
    ch4HutLight.range = 8;

    // Sacred fire pit (Havan Kund) — shore campfire
    const ch4PitBase = MeshBuilder.CreateBox('ch4_firePit', { width: 1.5, height: 0.4, depth: 1.5 }, this.scene);
    ch4PitBase.position.set(ashX, 0.2, ashZ);
    const ch4PitMat = new StandardMaterial('ch4_pitMat', this.scene);
    ch4PitMat.diffuseColor = new Color3(0.55, 0.45, 0.3);
    ch4PitBase.material = ch4PitMat;

    const ch4FireCore = MeshBuilder.CreateBox('ch4_fireCore', { width: 0.8, height: 0.3, depth: 0.8 }, this.scene);
    ch4FireCore.position.set(ashX, 0.5, ashZ);
    const ch4FireMat = new StandardMaterial('ch4_fireMat', this.scene);
    ch4FireMat.diffuseColor = ch4Warm;
    ch4FireMat.emissiveColor = ch4Warm;
    ch4FireCore.material = ch4FireMat;

    const ch4FireLight = new PointLight('ch4_fireLight', new Vector3(ashX, 1.5, ashZ), this.scene);
    ch4FireLight.diffuse = new Color3(1.0, 0.65, 0.25);
    ch4FireLight.intensity = 3;
    ch4FireLight.range = 12;

    // T2-5: Add concentric rangoli circle rings at fire pit
    const saffrronOrange = new Color3(1.0, 0.6, 0.2);
    const deepRed = new Color3(0.6, 0.1, 0.05);
    const goldColor = new Color3(1.0, 0.85, 0.4);

    const ch4Ring1 = MeshBuilder.CreateTorus('ch4_rangoli_ring1', { diameter: 4.0, thickness: 0.08, tessellation: 32 }, this.scene);
    ch4Ring1.position.set(ashX, 0.02, ashZ);
    const ch4Ring1Mat = new StandardMaterial('ch4_ring1Mat', this.scene);
    ch4Ring1Mat.emissiveColor = saffrronOrange;
    ch4Ring1Mat.diffuseColor = saffrronOrange;
    ch4Ring1.material = ch4Ring1Mat;

    const ch4Ring2 = MeshBuilder.CreateTorus('ch4_rangoli_ring2', { diameter: 6.0, thickness: 0.06, tessellation: 32 }, this.scene);
    ch4Ring2.position.set(ashX, 0.02, ashZ);
    const ch4Ring2Mat = new StandardMaterial('ch4_ring2Mat', this.scene);
    ch4Ring2Mat.emissiveColor = deepRed;
    ch4Ring2Mat.diffuseColor = deepRed;
    ch4Ring2.material = ch4Ring2Mat;

    const ch4Ring3 = MeshBuilder.CreateTorus('ch4_rangoli_ring3', { diameter: 8.0, thickness: 0.05, tessellation: 32 }, this.scene);
    ch4Ring3.position.set(ashX, 0.02, ashZ);
    const ch4Ring3Mat = new StandardMaterial('ch4_ring3Mat', this.scene);
    ch4Ring3Mat.emissiveColor = goldColor;
    ch4Ring3Mat.diffuseColor = goldColor;
    ch4Ring3.material = ch4Ring3Mat;

    // Meditation circle with shell/stone markers
    const ch4DiscR = 3;
    const ch4Disc = MeshBuilder.CreateDisc('ch4_meditationDisc', { radius: ch4DiscR, tessellation: 32 }, this.scene);
    ch4Disc.rotation.x = Math.PI / 2;
    ch4Disc.position.set(ashX, 0.05, ashZ + 6);
    const ch4DiscMat = new StandardMaterial('ch4_discMat', this.scene);
    ch4DiscMat.diffuseColor = new Color3(0.55, 0.5, 0.4);
    ch4Disc.material = ch4DiscMat;

    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 / 8) * i;
      const sx = ashX + Math.cos(angle) * (ch4DiscR + 0.5);
      const sz = (ashZ + 6) + Math.sin(angle) * (ch4DiscR + 0.5);
      const stone = MeshBuilder.CreateSphere(`ch4_ashStone_${i}`, { diameter: 0.4 + rng() * 0.3, segments: 6 }, this.scene);
      stone.position.set(sx, 0.25, sz);
      const sMat = new StandardMaterial(`ch4_ashSMat_${i}`, this.scene);
      sMat.diffuseColor = ch4Stone;
      stone.material = sMat;
      this.renderer.shadowGenerator.addShadowCaster(stone);
    }

    // Entrance torana gate (driftwood coastal gate)
    const ch4GateX = ashX, ch4GateZ = ashZ - 12;
    const ch4GateMat = new StandardMaterial('ch4_ashGateMat', this.scene);
    ch4GateMat.diffuseColor = new Color3(0.5, 0.42, 0.3);

    for (const side of [-1, 1]) {
      const gP = MeshBuilder.CreateCylinder(`ch4_ashGate_${side}`, { height: 3.8, diameter: 0.35, tessellation: 8 }, this.scene);
      gP.position.set(ch4GateX + side * 2.5, 1.9, ch4GateZ);
      gP.material = ch4GateMat;
      this.renderer.shadowGenerator.addShadowCaster(gP);
    }

    const ch4Cross = MeshBuilder.CreateBox('ch4_ashGateCross', { width: 5.5, height: 0.3, depth: 0.3 }, this.scene);
    ch4Cross.position.set(ch4GateX, 3.8, ch4GateZ);
    ch4Cross.material = ch4GateMat;
    this.renderer.shadowGenerator.addShadowCaster(ch4Cross);

    const ch4GateTop = MeshBuilder.CreateCylinder('ch4_ashGateTop', {
      height: 0.9, diameterTop: 0, diameterBottom: 1.4, tessellation: 4,
    }, this.scene);
    ch4GateTop.position.set(ch4GateX, 4.35, ch4GateZ);
    ch4GateTop.rotation.y = Math.PI / 4;
    const ch4GateTopMat = new StandardMaterial('ch4_ashGateTopMat', this.scene);
    ch4GateTopMat.diffuseColor = ch4Warm;
    ch4GateTopMat.emissiveColor = new Color3(0.3, 0.2, 0.05);
    ch4GateTop.material = ch4GateTopMat;
  }

  private buildChapter5Landmarks(rng: () => number, zone: { x: number; z: number; name: string }): void {
    // Ram Setu Bridge shrine structures near bridge center
    const centerX = zone.x, centerZ = zone.z;

    // 3 sacred stone pillars at shrine center
    const pillarMat = new StandardMaterial(`ch5_pillarMat`, this.scene);
    pillarMat.diffuseColor = new Color3(0.6, 0.55, 0.45);
    pillarMat.specularColor = new Color3(0.2, 0.2, 0.2);

    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2;
      const px = centerX + Math.cos(angle) * 8;
      const pz = centerZ + Math.sin(angle) * 8;

      const pillar = MeshBuilder.CreateCylinder(`ch5_pillar_${i}`, {
        height: 4,
        diameter: 1.0,
        tessellation: 12
      }, this.scene);
      pillar.position.set(px, 2, pz);
      pillar.material = pillarMat;
      if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(pillar);

      // Top ornament (small sphere)
      const ornament = MeshBuilder.CreateSphere(`ch5_ornament_${i}`, { diameter: 0.5, segments: 6 }, this.scene);
      ornament.position.set(px, 4.3, pz);
      const ornMat = new StandardMaterial(`ch5_ornMat_${i}`, this.scene);
      ornMat.emissiveColor = new Color3(0.8, 0.7, 0.3);
      ornMat.disableLighting = true;
      ornament.material = ornMat;
    }

    // 2 camp tents: angled boxes forming A-shape
    const tentMat = new StandardMaterial(`ch5_tentMat`, this.scene);
    tentMat.diffuseColor = new Color3(0.5, 0.35, 0.2);

    for (let i = 0; i < 2; i++) {
      const tentCenterX = centerX + (i === 0 ? -12 : 12) + (rng() - 0.5) * 2;
      const tentCenterZ = centerZ + (rng() - 0.5) * 4;

      // Left side of tent
      const tentL = MeshBuilder.CreateBox(`ch5_tentL_${i}`, { width: 0.3, height: 2, depth: 2.5 }, this.scene);
      tentL.position.set(tentCenterX - 1, 1, tentCenterZ);
      tentL.rotation.z = Math.PI / 6;
      tentL.material = tentMat;
      if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(tentL);

      // Right side of tent
      const tentR = MeshBuilder.CreateBox(`ch5_tentR_${i}`, { width: 0.3, height: 2, depth: 2.5 }, this.scene);
      tentR.position.set(tentCenterX + 1, 1, tentCenterZ);
      tentR.rotation.z = -Math.PI / 6;
      tentR.material = tentMat;
      if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(tentR);
    }
  }

  private buildChapter6Landmarks(rng: () => number, zone: { x: number; z: number; name: string }): void {
    const centerX = zone.x, centerZ = zone.z;

    // 2 watch towers: dark cylinders with red lights
    const towerMat = new StandardMaterial(`ch6_towerMat`, this.scene);
    towerMat.diffuseColor = new Color3(0.12, 0.08, 0.08);

    for (let i = 0; i < 2; i++) {
      const offsetX = (i === 0 ? -8 : 8) + (rng() - 0.5) * 2;
      const towerX = centerX + offsetX;

      const tower = MeshBuilder.CreateCylinder(`ch6_tower_${i}`, { height: 10, diameter: 2, tessellation: 12 }, this.scene);
      tower.position.set(towerX, 5, centerZ);
      tower.material = towerMat;
      this.renderer.shadowGenerator.addShadowCaster(tower);

      const towerLight = new PointLight(`ch6_towerLight_${i}`, new Vector3(towerX, 9.5, centerZ), this.scene);
      towerLight.diffuse = new Color3(1.0, 0.2, 0.1);
      towerLight.intensity = 1.5;
      towerLight.range = 8;
    }

    // 3 fortress walls: dark boxes with some lower ones for "damaged" effect
    const wallMat = new StandardMaterial(`ch6_wallMat`, this.scene);
    wallMat.diffuseColor = new Color3(0.2, 0.15, 0.1);

    for (let i = 0; i < 3; i++) {
      const offsetX = (i - 1) * 10 + (rng() - 0.5) * 2;
      const wallX = centerX + offsetX;
      const wallHeight = (i === 1 ? 3 : 4);

      const wall = MeshBuilder.CreateBox(`ch6_wall_${i}`, { width: 6, height: wallHeight, depth: 1 }, this.scene);
      wall.position.set(wallX, wallHeight / 2, centerZ - 8);
      wall.material = wallMat;
      this.renderer.shadowGenerator.addShadowCaster(wall);
    }

    // 2 lava channels: long planes with emissive
    const lavaMatBase = new StandardMaterial(`ch6_lavaMat_0`, this.scene);
    lavaMatBase.diffuseColor = new Color3(1.0, 0.4, 0.1);
    lavaMatBase.emissiveColor = new Color3(1.0, 0.3, 0.05);
    lavaMatBase.alpha = 0.7;

    for (let i = 0; i < 2; i++) {
      const offsetZ = (i === 0 ? -4 : 4) + (rng() - 0.5) * 1;
      const lavaChannelZ = centerZ + offsetZ;

      const lavaChannel = MeshBuilder.CreatePlane(`ch6_lavaChannel_${i}`, { width: 1.5, height: 8 }, this.scene);
      lavaChannel.rotation.x = Math.PI / 2;
      lavaChannel.position.set(centerX, 0.01, lavaChannelZ);
      const lavaMat = new StandardMaterial(`ch6_lavaMat_${i}`, this.scene);
      lavaMat.diffuseColor = new Color3(1.0, 0.4, 0.1);
      lavaMat.emissiveColor = new Color3(1.0, 0.3, 0.05);
      lavaMat.alpha = 0.7;
      lavaChannel.material = lavaMat;
    }

    // 2 totems: cylinders with octahedron tops
    const totemPoleMat = new StandardMaterial(`ch6_totemPoleMat`, this.scene);
    totemPoleMat.diffuseColor = new Color3(0.25, 0.15, 0.1);

    for (let i = 0; i < 2; i++) {
      const offsetX = (i === 0 ? -6 : 6) + (rng() - 0.5) * 2;
      const totemX = centerX + offsetX;
      const totemZ = centerZ + 6;

      const totemPole = MeshBuilder.CreateCylinder(`ch6_totemPole_${i}`, { height: 3, diameter: 0.2, tessellation: 8 }, this.scene);
      totemPole.position.set(totemX, 1.5, totemZ);
      totemPole.material = totemPoleMat;
      this.renderer.shadowGenerator.addShadowCaster(totemPole);

      const totemHead = MeshBuilder.CreatePolyhedron(`ch6_totemHead_${i}`, { type: 1, size: 0.5 }, this.scene);
      totemHead.position.set(totemX, 3.2, totemZ);
      const totemHeadMat = new StandardMaterial(`ch6_totemHeadMat_${i}`, this.scene);
      totemHeadMat.diffuseColor = new Color3(0.6, 0.1, 0.08);
      totemHead.material = totemHeadMat;
      this.renderer.shadowGenerator.addShadowCaster(totemHead);
    }

    // ─────────────────────────────────────────────────────────────────
    // T3-2: Lanka Outskirts Fortress Structures
    // ─────────────────────────────────────────────────────────────────

    // 2 massive fortress wall segments: dark stone boxes at flanking sides
    const darkVolcanicMat = new StandardMaterial(`ch6_darkStoneMat`, this.scene);
    darkVolcanicMat.diffuseColor = new Color3(0.2, 0.15, 0.12);

    const wallFlankPositions = [
      { x: centerX - 45, z: centerZ },
      { x: centerX + 45, z: centerZ },
    ];

    for (let i = 0; i < wallFlankPositions.length; i++) {
      const pos = wallFlankPositions[i];
      const wall = MeshBuilder.CreateBox(`ch6_flankWall_${i}`, { width: 40, height: 12, depth: 2 }, this.scene);
      wall.position.set(pos.x, 6, pos.z);
      wall.material = darkVolcanicMat;
      this.renderer.shadowGenerator.addShadowCaster(wall);
    }

    // Fortress gate: 2 tall pillars with heavy crossbar and iron-colored material
    const redAccentMat = new StandardMaterial(`ch6_gateMat`, this.scene);
    redAccentMat.diffuseColor = new Color3(0.35, 0.25, 0.22);
    redAccentMat.emissiveColor = new Color3(0.15, 0.05, 0.03);

    const gateX = [centerX - 6, centerX + 6];
    for (let i = 0; i < gateX.length; i++) {
      const pillar = MeshBuilder.CreateCylinder(`ch6_gatePillar_${i}`, { height: 15, diameter: 2, tessellation: 12 }, this.scene);
      pillar.position.set(gateX[i], 7.5, centerZ + 8);
      pillar.material = redAccentMat;
      this.renderer.shadowGenerator.addShadowCaster(pillar);
    }

    // Heavy crossbar
    const gateBar = MeshBuilder.CreateBox(`ch6_gateBar`, { width: 14, height: 1.5, depth: 1.5 }, this.scene);
    gateBar.position.set(centerX, 14, centerZ + 8);
    gateBar.material = redAccentMat;
    this.renderer.shadowGenerator.addShadowCaster(gateBar);

    // 4 wall-mounted torch braziers: small boxes with orange emissive + PointLights
    const torchBrazierMat = new StandardMaterial(`ch6_torchMat`, this.scene);
    torchBrazierMat.diffuseColor = new Color3(0.3, 0.1, 0.05);
    torchBrazierMat.emissiveColor = new Color3(1.0, 0.5, 0.1);

    const brazierPositions = [
      { x: centerX - 20, z: centerZ, py: 10 },
      { x: centerX + 20, z: centerZ, py: 10 },
      { x: centerX - 6, z: centerZ + 8, py: 13 },
      { x: centerX + 6, z: centerZ + 8, py: 13 },
    ];

    for (let i = 0; i < brazierPositions.length; i++) {
      const pos = brazierPositions[i];
      const brazier = MeshBuilder.CreateBox(`ch6_brazier_${i}`, { width: 0.6, height: 0.6, depth: 0.6 }, this.scene);
      brazier.position.set(pos.x, pos.py, pos.z);
      brazier.material = torchBrazierMat;
      this.renderer.shadowGenerator.addShadowCaster(brazier);

      const light = new PointLight(`ch6_brazierLight_${i}`, new Vector3(pos.x, pos.py + 0.5, pos.z), this.scene);
      light.diffuse = new Color3(1.0, 0.6, 0.2);
      light.intensity = 2;
      light.range = 10;
    }
  }

  private buildChapter7Landmarks(rng: () => number, zone: { x: number; z: number; name: string }): void {
    // Ch7: Ravana's Lanka - 4 ceremonial pillars flanking approach to boss arena
    const centerX = zone.x, centerZ = zone.z;
    const positions = [
      { x: centerX - 15, z: centerZ - 40 },
      { x: centerX + 15, z: centerZ - 40 },
      { x: centerX - 15, z: centerZ - 30 },
      { x: centerX + 15, z: centerZ - 30 },
    ];

    const pillarMat = new StandardMaterial(`ch7_pillarMat`, this.scene);
    pillarMat.diffuseColor = new Color3(0.75, 0.6, 0.15);
    pillarMat.specularColor = new Color3(0.5, 0.5, 0.5);
    pillarMat.emissiveColor = new Color3(0.3, 0.2, 0.05);

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const pillar = MeshBuilder.CreateCylinder(`ch7_ceremonialPillar_${i}`, { height: 8, diameter: 1.2, tessellation: 12 }, this.scene);
      pillar.position.set(pos.x, 4, pos.z);
      pillar.material = pillarMat;
      if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(pillar);
    }

    // ─────────────────────────────────────────────────────────────────
    // T3-2: Lanka Fortress Wall Structures
    // ─────────────────────────────────────────────────────────────────

    // 2 massive fortress wall segments: dark stone boxes
    const stoneMat = new StandardMaterial(`ch7_stoneMat`, this.scene);
    stoneMat.diffuseColor = new Color3(0.2, 0.15, 0.12);

    const wallSegmentPositions = [
      { x: centerX - 50, z: centerZ - 20 },
      { x: centerX + 50, z: centerZ - 20 },
    ];

    for (let i = 0; i < wallSegmentPositions.length; i++) {
      const pos = wallSegmentPositions[i];
      const wall = MeshBuilder.CreateBox(`ch7_fortressWall_${i}`, { width: 40, height: 12, depth: 2 }, this.scene);
      wall.position.set(pos.x, 6, pos.z);
      wall.material = stoneMat;
      if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(wall);
    }

    // Fortress gate: 2 tall pillars with heavy crossbar and iron-colored material
    const ironMat = new StandardMaterial(`ch7_ironMat`, this.scene);
    ironMat.diffuseColor = new Color3(0.35, 0.25, 0.22);
    ironMat.emissiveColor = new Color3(0.15, 0.05, 0.03);

    const gatePillarX = [centerX - 8, centerX + 8];
    for (let i = 0; i < gatePillarX.length; i++) {
      const pillar = MeshBuilder.CreateCylinder(`ch7_gatePillar_${i}`, { height: 15, diameter: 2, tessellation: 12 }, this.scene);
      pillar.position.set(gatePillarX[i], 7.5, centerZ + 5);
      pillar.material = ironMat;
      if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(pillar);
    }

    // Heavy crossbar
    const crossbar = MeshBuilder.CreateBox(`ch7_gateBar`, { width: 18, height: 1.5, depth: 1.5 }, this.scene);
    crossbar.position.set(centerX, 14, centerZ + 5);
    crossbar.material = ironMat;
    if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(crossbar);

    // 4 wall-mounted torch braziers: small boxes with orange emissive + PointLights
    const torchMat = new StandardMaterial(`ch7_torchMat`, this.scene);
    torchMat.diffuseColor = new Color3(0.3, 0.1, 0.05);
    torchMat.emissiveColor = new Color3(1.0, 0.5, 0.1);

    const torchPositions = [
      { x: centerX - 25, z: centerZ - 20, py: 10 },
      { x: centerX + 25, z: centerZ - 20, py: 10 },
      { x: centerX - 8, z: centerZ + 5, py: 13 },
      { x: centerX + 8, z: centerZ + 5, py: 13 },
    ];

    for (let i = 0; i < torchPositions.length; i++) {
      const pos = torchPositions[i];
      const torch = MeshBuilder.CreateBox(`ch7_torchBrazier_${i}`, { width: 0.6, height: 0.6, depth: 0.6 }, this.scene);
      torch.position.set(pos.x, pos.py, pos.z);
      torch.material = torchMat;
      if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(torch);

      const torchLight = new PointLight(`ch7_torchLight_${i}`, new Vector3(pos.x, pos.py + 0.5, pos.z), this.scene);
      torchLight.diffuse = new Color3(1.0, 0.6, 0.2);
      torchLight.intensity = 2;
      torchLight.range = 10;
    }

    // Grand Lanka palace facade behind the boss arena: 3 tiered platforms (stepped pyramid)
    const palaceMat = new StandardMaterial(`ch7_palaceMat`, this.scene);
    palaceMat.diffuseColor = new Color3(0.7, 0.5, 0.15);
    palaceMat.emissiveColor = new Color3(0.3, 0.2, 0.05);

    const palaceBaseZ = centerZ + 20;

    // Base tier
    const palaceBase = MeshBuilder.CreateBox(`ch7_palaceBase`, { width: 30, height: 3, depth: 15 }, this.scene);
    palaceBase.position.set(centerX, 1.5, palaceBaseZ);
    palaceBase.material = palaceMat;
    if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(palaceBase);

    // Middle tier
    const palaceMiddle = MeshBuilder.CreateBox(`ch7_palaceMiddle`, { width: 20, height: 3, depth: 10 }, this.scene);
    palaceMiddle.position.set(centerX, 4.5, palaceBaseZ);
    palaceMiddle.material = palaceMat;
    if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(palaceMiddle);

    // Top tier
    const palaceTop = MeshBuilder.CreateBox(`ch7_palaceTop`, { width: 12, height: 3, depth: 8 }, this.scene);
    palaceTop.position.set(centerX, 7.5, palaceBaseZ);
    palaceTop.material = palaceMat;
    if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(palaceTop);

    // 4 golden demon head totems flanking the arena
    const demonHeadMat = new StandardMaterial(`ch7_demonHeadMat`, this.scene);
    demonHeadMat.diffuseColor = new Color3(0.7, 0.5, 0.15);
    demonHeadMat.emissiveColor = new Color3(0.3, 0.2, 0.05);

    const demonPositions = [
      { x: centerX - 20, z: centerZ },
      { x: centerX + 20, z: centerZ },
      { x: centerX, z: centerZ - 20 },
      { x: centerX, z: centerZ + 20 },
    ];

    for (let i = 0; i < demonPositions.length; i++) {
      const pos = demonPositions[i];

      // Pole (cylinder)
      const pole = MeshBuilder.CreateCylinder(`ch7_demonPole_${i}`, { height: 8, diameter: 0.8, tessellation: 12 }, this.scene);
      pole.position.set(pos.x, 4, pos.z);
      pole.material = demonHeadMat;
      if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(pole);

      // Head (sphere)
      const head = MeshBuilder.CreateSphere(`ch7_demonHead_${i}`, { diameter: 1.5, segments: 16 }, this.scene);
      head.position.set(pos.x, 8.5, pos.z);
      head.material = demonHeadMat;
      if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(head);
    }

    // 2 Lanka war banners: tall poles with red flag boxes
    const bannerPoleMatRed = new StandardMaterial(`ch7_bannerMat`, this.scene);
    bannerPoleMatRed.diffuseColor = new Color3(0.3, 0.1, 0.05);

    const bannerFlagMat = new StandardMaterial(`ch7_flagMat`, this.scene);
    bannerFlagMat.diffuseColor = new Color3(0.9, 0.1, 0.05);
    bannerFlagMat.emissiveColor = new Color3(0.4, 0.05, 0.02);

    const bannerPositions = [
      { x: centerX - 35, z: centerZ },
      { x: centerX + 35, z: centerZ },
    ];

    for (let i = 0; i < bannerPositions.length; i++) {
      const pos = bannerPositions[i];

      // Pole
      const pole = MeshBuilder.CreateCylinder(`ch7_bannerPole_${i}`, { height: 10, diameter: 0.4, tessellation: 8 }, this.scene);
      pole.position.set(pos.x, 5, pos.z);
      pole.material = bannerPoleMatRed;
      if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(pole);

      // Flag
      const flag = MeshBuilder.CreateBox(`ch7_bannerFlag_${i}`, { width: 4, height: 3, depth: 0.3 }, this.scene);
      flag.position.set(pos.x + 2, 8, pos.z);
      flag.material = bannerFlagMat;
      if (this.renderer.shadowGenerator) this.renderer.shadowGenerator.addShadowCaster(flag);
    }

    // ─────────────────────────────────────────────────────────────────
    // T3-3: Lava Geyser Vents (Boss Arena)
    // ─────────────────────────────────────────────────────────────────

    const lavaVentMat = new StandardMaterial(`ch7_lavaVentMat`, this.scene);
    lavaVentMat.diffuseColor = new Color3(0.3, 0.1, 0.05);
    lavaVentMat.emissiveColor = new Color3(0.5, 0.15, 0.05);

    const ventDistance = 12;
    const ventPositions: Vec3[] = [
      { x: C.BOSS_ARENA_CENTER.x + ventDistance, y: 0, z: C.BOSS_ARENA_CENTER.z },
      { x: C.BOSS_ARENA_CENTER.x - ventDistance, y: 0, z: C.BOSS_ARENA_CENTER.z },
      { x: C.BOSS_ARENA_CENTER.x, y: 0, z: C.BOSS_ARENA_CENTER.z + ventDistance },
      { x: C.BOSS_ARENA_CENTER.x, y: 0, z: C.BOSS_ARENA_CENTER.z - ventDistance },
    ];

    for (let i = 0; i < ventPositions.length; i++) {
      const vPos = ventPositions[i];

      // Ground-level circular vent disc
      const vent = MeshBuilder.CreateCylinder(`ch7_lavaVent_${i}`, { height: 0.2, diameter: 3, tessellation: 16 }, this.scene);
      vent.position.set(vPos.x, 0.1, vPos.z);
      vent.material = lavaVentMat;

      // Point light for geyser eruption animation
      const ventLight = new PointLight(`ch7_lavaVentLight_${i}`, new Vector3(vPos.x, 2, vPos.z), this.scene);
      ventLight.diffuse = new Color3(1.0, 0.6, 0.2);
      ventLight.intensity = 0;
      ventLight.range = 6;

      this.lavaVentLights.push(ventLight);
      this.lavaVentPositions.push({ x: vPos.x, y: vPos.y, z: vPos.z });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  WATER FEATURES
  // ══════════════════════════════════════════════════════════════════════════

  // T4-3: Build sacred pillar puzzle meshes
  private buildPuzzlePillars(): void {
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
      for (let i = 0; i < config.positions.length; i++) {
        const pos = config.positions[i];
        const pillarId = `puzzle_ch${config.ch}_${i}`;

        // Create stone cylinder pillar
        const pillar = MeshBuilder.CreateCylinder(pillarId, {
          height: 2.5,
          diameter: 0.5,
          tessellation: 8,
        }, this.scene);
        pillar.position.set(pos.x, 1.25, pos.z);

        // Stone material with blue emissive glow
        const pillarMat = new StandardMaterial(`${pillarId}_mat`, this.scene);
        pillarMat.diffuseColor = new Color3(0.4, 0.4, 0.45);   // Stone grey
        pillarMat.emissiveColor = new Color3(0.1, 0.15, 0.25); // Faint blue glow
        pillarMat.specularColor = new Color3(0.2, 0.2, 0.25);
        pillar.material = pillarMat;
      }
    }
  }

  activatePillar(pillarId: string): void {
    const pillar = this.scene.getMeshByName(pillarId);
    if (pillar && pillar.material instanceof StandardMaterial) {
      // Change to bright gold emissive
      pillar.material.emissiveColor = new Color3(1.0, 0.85, 0.2);
    }
  }

  private buildWaterFeatures(): void {
    // ── Curved River: winding path from Panchavati (spawn) through to Southern Shore ──
    // River flows south along the journey, eventually reaching the ocean
    const riverPath: { x: number; z: number }[] = [
      { x: 15, z: 5 },
      { x: 12, z: -30 },
      { x: 5, z: -70 },
      { x: -10, z: -120 },
      { x: -30, z: -180 },
      { x: -50, z: -250 },
      { x: -40, z: -320 },
      { x: -30, z: -380 },
      { x: 0, z: -440 },
      { x: 50, z: -500 },
    ];

    const riverWidth = 4.5;
    this.riverSegments = []; // Reset river segments array
    for (let i = 0; i < riverPath.length - 1; i++) {
      const p0 = riverPath[i];
      const p1 = riverPath[i + 1];
      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const segLen = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dx, dz);

      const seg = MeshBuilder.CreatePlane(`riverSeg_${i}`, { width: riverWidth, height: segLen + 1.0 }, this.scene);
      seg.rotation.x = Math.PI / 2;
      seg.rotation.y = angle;
      seg.position.set((p0.x + p1.x) / 2, 0.06 + Math.sin(i * 0.7) * 0.03, (p0.z + p1.z) / 2);

      const segMat = new StandardMaterial(`riverSegMat_${i}`, this.scene);
      segMat.diffuseColor = new Color3(0.08, 0.25, 0.5);
      segMat.emissiveColor = new Color3(0.04, 0.12, 0.28);
      segMat.alpha = 0.32 + Math.sin(i * 1.2) * 0.05;
      segMat.backFaceCulling = false;
      seg.material = segMat;

      // Store reference for water animation
      this.riverSegments.push(seg);
    }

    // ── River bank vegetation: small green sphere bushes ──────────────────
    const rng = mulberry32(42);
    for (let i = 0; i < riverPath.length; i++) {
      const p = riverPath[i];
      // 2 bushes per river point (one each side)
      for (const side of [-1, 1]) {
        if (rng() > 0.65) continue; // skip some for natural look
        const bush = MeshBuilder.CreateSphere(`riverBush_${i}_${side}`, { diameter: 0.8 + rng() * 0.6, segments: 6 }, this.scene);
        bush.position.set(p.x + side * (riverWidth * 0.7 + rng() * 1.5), 0.3, p.z + (rng() - 0.5) * 3);
        const bushMat = new StandardMaterial(`riverBushMat_${i}_${side}`, this.scene);
        bushMat.diffuseColor = new Color3(0.1 + rng() * 0.1, 0.35 + rng() * 0.2, 0.08);
        bushMat.specularColor = new Color3(0, 0, 0);
        bush.material = bushMat;
      }
    }

    // ── Lily pads on water surface (~20 lily pads across the longer river) ──
    for (let i = 0; i < 20; i++) {
      const idx = Math.floor(rng() * (riverPath.length - 1));
      const p = riverPath[idx];
      const lily = MeshBuilder.CreateDisc(`lilyPad_${i}`, { radius: 0.25 + rng() * 0.2, tessellation: 8 }, this.scene);
      lily.rotation.x = Math.PI / 2;
      lily.position.set(p.x + (rng() - 0.5) * riverWidth * 0.6, 0.08, p.z + (rng() - 0.5) * 4);
      const lilyMat = new StandardMaterial(`lilyMat_${i}`, this.scene);
      lilyMat.diffuseColor = new Color3(0.15, 0.45, 0.12);
      lilyMat.emissiveColor = new Color3(0.05, 0.15, 0.04);
      lilyMat.backFaceCulling = false;
      lily.material = lilyMat;
    }

    // ── Ocean: large water plane at far south (coastal region at Ch4) ──────
    // Positioned around Southern Shore zone, much larger to fill the gap
    const ocean = MeshBuilder.CreatePlane(`waterOcean`, { width: 300, height: 200 }, this.scene);
    ocean.rotation.x = Math.PI / 2;
    ocean.position.set(-50, 0.04, -550);  // Near southern shore and between bridge/Lanka

    const oceanMat = new StandardMaterial(`oceanMat`, this.scene);
    oceanMat.diffuseColor = new Color3(0.05, 0.15, 0.4);
    oceanMat.emissiveColor = new Color3(0.02, 0.08, 0.22);
    oceanMat.alpha = 0.45;  // Center alpha
    oceanMat.backFaceCulling = false;
    ocean.material = oceanMat;

    // A-07: Add gradient alpha edge — create a second smaller ocean plane on top with higher alpha
    const oceanDepth = MeshBuilder.CreatePlane(`waterOceanDepth`, { width: 280, height: 180 }, this.scene);
    oceanDepth.rotation.x = Math.PI / 2;
    oceanDepth.position.set(-50, 0.045, -550);  // Slightly above
    const oceanDepthMat = new StandardMaterial(`oceanDepthMat`, this.scene);
    oceanDepthMat.diffuseColor = new Color3(0.05, 0.15, 0.4);
    oceanDepthMat.emissiveColor = new Color3(0.02, 0.08, 0.22);
    oceanDepthMat.alpha = 0.55;  // Higher alpha for depth effect
    oceanDepthMat.backFaceCulling = false;
    oceanDepth.material = oceanDepthMat;

    // A-07: Create shoreline foam strip — thin torus around ocean perimeter
    const foamRing = MeshBuilder.CreateTorus(`foamRing`, {
      diameter: 320,  // Slightly larger than ocean
      thickness: 8,
      tessellation: 64
    }, this.scene);
    foamRing.rotation.x = Math.PI / 2;
    foamRing.position.set(-50, 0.07, -550);  // Slightly above water

    const foamMat = new StandardMaterial(`foamMat`, this.scene);
    foamMat.diffuseColor = new Color3(1.0, 1.0, 1.0);  // white foam
    foamMat.emissiveColor = new Color3(1.0, 1.0, 1.0);  // white glow
    foamMat.alpha = 0.4;
    foamMat.backFaceCulling = false;
    foamRing.material = foamMat;
    this.foamMeshes.push(foamRing);

    // A-07: Create additional foam strips along the coastline (elongated planes)
    const coastlinePoints = [
      { x: -50, z: -450 },  // Upper edge
      { x: 100, z: -550 },  // Right edge
      { x: -50, z: -650 },  // Lower edge
      { x: -200, z: -550 }  // Left edge
    ];

    for (let i = 0; i < coastlinePoints.length; i++) {
      const p1 = coastlinePoints[i];
      const p2 = coastlinePoints[(i + 1) % coastlinePoints.length];
      const midX = (p1.x + p2.x) / 2;
      const midZ = (p1.z + p2.z) / 2;
      const dx = p2.x - p1.x;
      const dz = p2.z - p1.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dx, dz);

      const foamStrip = MeshBuilder.CreatePlane(`foamStrip_${i}`, {
        width: 20,
        height: len
      }, this.scene);
      foamStrip.rotation.x = Math.PI / 2;
      foamStrip.rotation.y = angle;
      foamStrip.position.set(midX, 0.07, midZ);
      foamStrip.material = foamMat;
      this.foamMeshes.push(foamStrip);
    }

    // Store reference for water animation
    this.oceanMesh = ocean;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TORCH & CAMPFIRE SYSTEM
  // ══════════════════════════════════════════════════════════════════════════

  setTorchLit(lit: boolean, playerPos: Vec3): void {
    if (lit) {
      if (!this.torchLight) {
        this.torchLight = new PointLight('torchLight', new Vector3(playerPos.x, playerPos.y + 3, playerPos.z), this.scene);
        this.torchLight.diffuse = new Color3(1.0, 0.65, 0.2);
        this.torchLight.intensity = 4.0;
        this.torchLight.range = 18;
      }
      if (!this.torchMesh) {
        if (this.torchFlameSpriteTexture) {
          this.torchMesh = MeshBuilder.CreatePlane('torchFlame', { size: 1 }, this.scene);
          this.torchMesh.billboardMode = Mesh.BILLBOARDMODE_Y;
          this.torchMesh.scaling.set(0.6, 1.2, 1);
          const mat = new StandardMaterial('torchFlameMat', this.scene);
          mat.diffuseTexture = this.torchFlameSpriteTexture;
          mat.useAlphaFromDiffuseTexture = true;
          mat.emissiveColor = new Color3(1.0, 0.5, 0.1);
          mat.specularColor = new Color3(0, 0, 0);
          mat.backFaceCulling = false;
          mat.disableLighting = true;
          this.torchMesh.material = mat;
        } else {
          this.torchMesh = MeshBuilder.CreateSphere('torchFlame', { diameter: 0.3, segments: 6 }, this.scene);
          const mat = new StandardMaterial('torchFlameMat', this.scene);
          mat.emissiveColor = new Color3(1.0, 0.5, 0.1);
          mat.disableLighting = true;
          this.torchMesh.material = mat;
        }
      }
    } else {
      if (this.torchLight) { this.torchLight.dispose(); this.torchLight = null; }
      if (this.torchMesh) { this.torchMesh.dispose(); this.torchMesh = null; }
    }
  }

  updateTorchPosition(playerPos: Vec3): void {
    if (this.torchLight) {
      this.torchLight.position.set(playerPos.x + 0.5, playerPos.y + 3, playerPos.z + 0.5);
      // Flicker effect
      this.torchLight.intensity = 3.5 + Math.random() * 1.0;
    }
    if (this.torchMesh) {
      this.torchMesh.position.set(playerPos.x + 0.5, playerPos.y + 2.8, playerPos.z + 0.5);
    }
  }

  placeCampfire(pos: Vec3): void {
    this.removeCampfire();
    this.campfireLight = new PointLight('campfireLight', new Vector3(pos.x, pos.y + 1.5, pos.z), this.scene);
    this.campfireLight.diffuse = new Color3(1.0, 0.55, 0.15);
    this.campfireLight.intensity = 5.0;
    this.campfireLight.range = 22;

    // Fire visual: sprite billboard or fallback glowing spheres
    if (this.campfireSpriteTexture) {
      this.campfireMesh = MeshBuilder.CreatePlane('campfire', { size: 1 }, this.scene) as Mesh;
      this.campfireMesh.billboardMode = Mesh.BILLBOARDMODE_Y;
      this.campfireMesh.scaling.set(2.0, 2.0, 1);
      this.campfireMesh.position.set(pos.x, pos.y + 1.0, pos.z);
      const mat = new StandardMaterial('campfireMat', this.scene);
      mat.diffuseTexture = this.campfireSpriteTexture;
      mat.useAlphaFromDiffuseTexture = true;
      mat.emissiveColor = new Color3(0.6, 0.3, 0.05);
      mat.specularColor = new Color3(0, 0, 0);
      mat.backFaceCulling = false;
      this.campfireMesh.material = mat;
    } else {
      this.campfireMesh = MeshBuilder.CreateSphere('campfire', { diameter: 0.5, segments: 6 }, this.scene);
      this.campfireMesh.position.set(pos.x, pos.y + 0.4, pos.z);
      const mat = new StandardMaterial('campfireMat', this.scene);
      mat.emissiveColor = new Color3(1.0, 0.4, 0.05);
      mat.disableLighting = true;
      this.campfireMesh.material = mat;
      const flame2 = MeshBuilder.CreateSphere('campflame2', { diameter: 0.3, segments: 6 }, this.scene);
      flame2.parent = this.campfireMesh; flame2.position.y = 0.4; flame2.material = mat;
      const flame3 = MeshBuilder.CreateSphere('campflame3', { diameter: 0.2, segments: 6 }, this.scene);
      flame3.parent = this.campfireMesh; flame3.position.set(0.15, 0.7, 0); flame3.material = mat;
    }
  }

  removeCampfire(): void {
    if (this.campfireLight) { this.campfireLight.dispose(); this.campfireLight = null; }
    if (this.campfireMesh) { this.campfireMesh.dispose(false, true); this.campfireMesh = null; }
  }

  updateCampfireFlicker(): void {
    if (this.campfireLight) {
      this.campfireLight.intensity = 4.5 + Math.random() * 1.5;
    }
  }

  // A-09: Update boss arena visibility based on player distance and chapter
  public updateBossArenaVisibility(playerPos: Vec3, chapter: number): void {
    const c = C.BOSS_ARENA_CENTER;
    const dx = playerPos.x - c.x;
    const dz = playerPos.z - c.z;
    const distToBossArena = Math.sqrt(dx * dx + dz * dz);

    let targetVisibility = 0;

    if (distToBossArena > 150 || chapter < 5) {
      // Fully hidden
      targetVisibility = 0;
    } else if (distToBossArena >= 100 && distToBossArena <= 150 && chapter >= 5) {
      // Silhouette only — low alpha
      targetVisibility = 0.15;
    } else if (distToBossArena < 100 || chapter >= 7) {
      // Fully revealed
      targetVisibility = 1;
    }

    // Apply visibility to all boss arena meshes
    for (const mesh of this.bossArenaMeshes) {
      mesh.visibility = targetVisibility;

      // For silhouette mode, also reduce material alpha
      if (targetVisibility === 0.15 && mesh.material instanceof StandardMaterial) {
        mesh.material.alpha = 0.3;
      } else if (mesh.material instanceof StandardMaterial) {
        // Restore original alpha for fully visible mode
        mesh.material.alpha = 1.0;
      }
    }
  }

  /**
   * Water animation: gently oscillates river alpha, shifts Y positions for flowing effect,
   * and undulates ocean alpha and Y.
   */
  public updateWater(dt: number): void {
    let time = (Date.now() % 10000) / 1000; // Cycle every 10 seconds

    // Animate river segments
    for (let i = 0; i < this.riverSegments.length; i++) {
      const seg = this.riverSegments[i];
      const mat = seg.material as StandardMaterial;

      // Oscillate alpha between 0.28 and 0.42 using sin waves at different phases
      const alphaCycle = 2.0; // seconds per full cycle
      const phase = (i / this.riverSegments.length) * Math.PI * 2; // Stagger by segment
      const alpha = 0.35 + Math.sin(time / alphaCycle * Math.PI * 2 + phase) * 0.07;
      mat.alpha = alpha;

      // Slowly shift Y position for flowing feel (±0.03)
      const yBobAmount = 0.03;
      const yPhase = (i / this.riverSegments.length) * Math.PI * 2;
      const yShift = Math.sin(time * 0.5 + yPhase) * yBobAmount;
      seg.position.y = 0.06 + Math.sin(i * 0.7) * 0.03 + yShift;
    }

    // Animate ocean mesh
    if (this.oceanMesh) {
      const oceanMat = this.oceanMesh.material as StandardMaterial;

      // Slow undulating alpha
      const oceanAlphaCycle = 3.0;
      const oceanAlpha = 0.42 + Math.sin(time / oceanAlphaCycle * Math.PI * 2) * 0.08;
      oceanMat.alpha = oceanAlpha;

      // Subtle Y bob
      const oceanYBob = 0.02;
      this.oceanMesh.position.y = 0.04 + Math.sin(time * 0.3) * oceanYBob;
    }

    // A-07: Animate foam meshes — oscillate slightly in Y and alpha
    for (const foam of this.foamMeshes) {
      const foamMat = foam.material as StandardMaterial;

      // Oscillate alpha to simulate wave foam
      const foamAlphaCycle = 2.5;
      const foamAlpha = 0.35 + Math.sin(time / foamAlphaCycle * Math.PI * 2) * 0.1;
      foamMat.alpha = foamAlpha;

      // Slight Y oscillation
      const foamYBob = 0.03;
      const baseY = 0.07 + Math.sin(time * 0.4) * foamYBob;
      foam.position.y = baseY;
    }
  }

  /**
   * T3-3: Update lava vent lights with pulsing animation
   * Each vent cycles through bright (erupting) and dim (dormant) states
   */
  public updateLavaVents(time: number): void {
    for (let i = 0; i < this.lavaVentLights.length; i++) {
      // Stagger each vent by π/2 offset so they don't all erupt at once
      const phase = (time * 0.001 + i * Math.PI / 2) % (Math.PI * 2);
      const active = Math.sin(phase) > 0.7; // Active ~30% of the time
      this.lavaVentLights[i].intensity = active ? 4 : 0.3;
    }
  }

  /**
   * T3-3: Get lava vent positions for damage checking in LocalSim
   */
  public getLavaVentPositions(): Vec3[] {
    return this.lavaVentPositions;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  WILDLIFE & AMBIENT LIFE
  // ══════════════════════════════════════════════════════════════════════════

  private birds: { mesh: TransformNode; cx: number; cz: number; radius: number; speed: number; angle: number; baseY: number }[] = [];
  private deer: { mesh: TransformNode; pos: Vec3; fleeing: boolean; fleeDir: Vec3; fleeTimer: number }[] = [];

  buildWildlife(): void {
    const rng = mulberry32(7777);

    // ── Flying birds ──────────────────────────────────────────
    for (let i = 0; i < 8; i++) {
      const root = new TransformNode(`bird_${i}`, this.scene);

      if (this.birdSpriteTexture) {
        const bb = MeshBuilder.CreatePlane(`birdBB_${i}`, { size: 1 }, this.scene);
        bb.parent = root;
        bb.billboardMode = Mesh.BILLBOARDMODE_ALL;
        bb.scaling.set(1.8, 1.4, 1); // wider than tall for a bird in flight
        const mat = new StandardMaterial(`birdBBMat_${i}`, this.scene);
        mat.diffuseTexture = this.birdSpriteTexture;
        mat.useAlphaFromDiffuseTexture = true;
        mat.emissiveColor = new Color3(0.05, 0.04, 0.03);
        mat.specularColor = new Color3(0, 0, 0);
        mat.backFaceCulling = false;
        bb.material = mat;
      } else {
        // Fallback: V-shaped wing pair
        const wingL = MeshBuilder.CreatePlane(`birdWingL_${i}`, { width: 0.5, height: 0.2 }, this.scene);
        wingL.parent = root; wingL.position.x = -0.15; wingL.rotation.z = 0.4;
        const wingR = MeshBuilder.CreatePlane(`birdWingR_${i}`, { width: 0.5, height: 0.2 }, this.scene);
        wingR.parent = root; wingR.position.x = 0.15; wingR.rotation.z = -0.4;
        const birdMat = new StandardMaterial(`birdMat_${i}`, this.scene);
        birdMat.diffuseColor = new Color3(0.1, 0.08, 0.06);
        birdMat.emissiveColor = new Color3(0.05, 0.04, 0.03);
        birdMat.backFaceCulling = false;
        wingL.material = birdMat; wingR.material = birdMat;
      }

      const cx = (rng() - 0.5) * 60;
      const cz = -10 - rng() * 50;
      const radius = 8 + rng() * 15;
      const speed = 0.3 + rng() * 0.4;
      const baseY = 14 + rng() * 6;

      this.birds.push({ mesh: root, cx, cz, radius, speed, angle: rng() * Math.PI * 2, baseY });
    }

    // ── Ground animals (deer) ─────────────────────────────────
    for (let i = 0; i < 4; i++) {
      const root = new TransformNode(`deer_${i}`, this.scene);

      if (this.deerSpriteTexture) {
        const bb = MeshBuilder.CreatePlane(`deerBB_${i}`, { size: 1 }, this.scene);
        bb.parent = root;
        bb.billboardMode = Mesh.BILLBOARDMODE_Y;
        bb.scaling.set(1.6, 1.6, 1);
        bb.position.y = 0.8; // feet on ground
        const mat = new StandardMaterial(`deerBBMat_${i}`, this.scene);
        mat.diffuseTexture = this.deerSpriteTexture;
        mat.useAlphaFromDiffuseTexture = true;
        mat.emissiveColor = new Color3(0.08, 0.06, 0.03);
        mat.specularColor = new Color3(0, 0, 0);
        mat.backFaceCulling = false;
        bb.material = mat;
      } else {
        // Fallback: box body + cylinder legs + sphere head
        const deerMat = new StandardMaterial(`deerMat_${i}`, this.scene);
        deerMat.diffuseColor = new Color3(0.45, 0.3, 0.15);
        deerMat.specularColor = new Color3(0, 0, 0);
        const body = MeshBuilder.CreateBox(`deerBody_${i}`, { width: 0.6, height: 0.5, depth: 1.0 }, this.scene);
        body.parent = root; body.position.y = 0.7; body.material = deerMat;
        for (let leg = 0; leg < 4; leg++) {
          const l = MeshBuilder.CreateCylinder(`deerLeg_${i}_${leg}`, { height: 0.5, diameter: 0.08 }, this.scene);
          l.parent = root; l.position.set((leg < 2 ? -0.2 : 0.2), 0.25, (leg % 2 === 0 ? -0.35 : 0.35)); l.material = deerMat;
        }
        const head = MeshBuilder.CreateSphere(`deerHead_${i}`, { diameter: 0.3, segments: 6 }, this.scene);
        head.parent = root; head.position.set(0, 1.0, -0.55); head.material = deerMat;
        const neck = MeshBuilder.CreateCylinder(`deerNeck_${i}`, { height: 0.4, diameter: 0.1 }, this.scene);
        neck.parent = root; neck.position.set(0, 0.9, -0.4); neck.rotation.x = -0.5; neck.material = deerMat;
      }

      const px = -20 + rng() * 40;
      const pz = -15 - rng() * 30;
      root.position.set(px, 0, pz);
      root.rotation.y = rng() * Math.PI * 2;

      this.deer.push({
        mesh: root,
        pos: { x: px, y: 0, z: pz },
        fleeing: false,
        fleeDir: { x: 0, y: 0, z: 0 },
        fleeTimer: 0,
      });
    }
  }

  updateWildlife(dt: number, playerPos: Vec3): void {
    // ── Birds: circle and bob ─────────────────────────────────────
    for (const bird of this.birds) {
      bird.angle += bird.speed * dt;
      const x = bird.cx + Math.cos(bird.angle) * bird.radius;
      const z = bird.cz + Math.sin(bird.angle) * bird.radius;
      const y = bird.baseY + Math.sin(bird.angle * 3) * 1.5; // bob up/down
      bird.mesh.position.set(x, y, z);
      bird.mesh.rotation.y = bird.angle + Math.PI / 2;
      // Wing flap: rotate wing meshes
      const flapAngle = Math.sin(bird.angle * 8) * 0.3;
      const wL = bird.mesh.getChildMeshes()[0];
      const wR = bird.mesh.getChildMeshes()[1];
      if (wL) wL.rotation.z = 0.4 + flapAngle;
      if (wR) wR.rotation.z = -0.4 - flapAngle;
    }

    // ── Deer: graze or flee ──────────────────────────────────────
    for (const d of this.deer) {
      if (d.fleeing) {
        d.fleeTimer -= dt;
        if (d.fleeTimer <= 0) {
          d.fleeing = false;
        } else {
          d.pos.x += d.fleeDir.x * 6 * dt;
          d.pos.z += d.fleeDir.z * 6 * dt;
          d.mesh.position.set(d.pos.x, 0, d.pos.z);
        }
      } else {
        // Check if player is close
        const dx = playerPos.x - d.pos.x;
        const dz = playerPos.z - d.pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 10) {
          // Flee away from player
          d.fleeing = true;
          d.fleeTimer = 3.0;
          const invD = 1 / Math.max(dist, 0.1);
          d.fleeDir = { x: -dx * invD, y: 0, z: -dz * invD };
          d.mesh.rotation.y = Math.atan2(-dx, -dz);
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  CHAPTER BIOME SYSTEM
  // ══════════════════════════════════════════════════════════════════════════

  setChapterBiome(chapter: number): void {
    // A-02: Use stored groundMesh reference or fall back to scene lookup
    let groundMat: PBRMaterial | null = null;
    if (this.groundMesh?.material) {
      groundMat = this.groundMesh.material as PBRMaterial;
    } else {
      const ground = this.scene.getMeshByName('ground_main');
      if (ground?.material) groundMat = ground.material as PBRMaterial;
    }

    // A-02: Define biome color palette per chapter
    const biomeColors: Record<number, [number, number, number]> = {
      0: [0.15, 0.28, 0.1],   // Ch0-1: lush green
      1: [0.15, 0.28, 0.1],   // Ch1: lush green
      2: [0.45, 0.35, 0.2],   // Ch2: arid tan
      3: [0.35, 0.38, 0.3],   // Ch3: gray-green rock
      4: [0.6, 0.55, 0.35],   // Ch4: sand
      5: [0.3, 0.35, 0.4],    // Ch5: ocean blue-gray
      6: [0.55, 0.42, 0.15],  // Ch6-7: golden-scorched (golden Lanka per lore)
      7: [0.55, 0.42, 0.15],  // Ch7: golden-scorched
    };

    // Define biome settings per chapter
    const biomes: Record<number, { groundColor: [number, number, number]; fogColor: [number, number, number]; fogDensity: number; sunColor: [number, number, number]; sunIntensity: number }> = {
      0: { groundColor: [0.15, 0.28, 0.1], fogColor: [0.2, 0.25, 0.15], fogDensity: 0.004, sunColor: [1.0, 0.85, 0.5], sunIntensity: 1.8 }, // Ashram - serene golden morning
      1: { groundColor: [0.14, 0.25, 0.09], fogColor: [0.18, 0.2, 0.1], fogDensity: 0.006, sunColor: [1.0, 0.8, 0.4], sunIntensity: 1.5 }, // Dandaka forest
      2: { groundColor: [0.2, 0.1, 0.06], fogColor: [0.25, 0.1, 0.05], fogDensity: 0.012, sunColor: [1.0, 0.4, 0.2], sunIntensity: 1.0 }, // Scorched
      3: { groundColor: [0.18, 0.15, 0.1], fogColor: [0.2, 0.15, 0.08], fogDensity: 0.006, sunColor: [0.9, 0.7, 0.4], sunIntensity: 1.5 }, // Kishkindha rocky
      4: { groundColor: [0.22, 0.2, 0.14], fogColor: [0.15, 0.18, 0.22], fogDensity: 0.005, sunColor: [0.8, 0.85, 1.0], sunIntensity: 1.3 }, // Shore
      5: { groundColor: [0.12, 0.08, 0.06], fogColor: [0.2, 0.08, 0.04], fogDensity: 0.015, sunColor: [0.9, 0.3, 0.15], sunIntensity: 0.8 }, // Volcanic
      6: { groundColor: [0.12, 0.08, 0.06], fogColor: [0.2, 0.08, 0.04], fogDensity: 0.015, sunColor: [0.9, 0.3, 0.15], sunIntensity: 0.8 },
      7: { groundColor: [0.06, 0.02, 0.08], fogColor: [0.12, 0.04, 0.1], fogDensity: 0.018, sunColor: [0.6, 0.15, 0.4], sunIntensity: 0.6 }, // Lanka dark
    };

    const b = biomes[chapter] ?? biomes[0];
    const biomeColor = biomeColors[chapter] ?? biomeColors[0];

    // A-02: Apply biome color directly to ground material
    if (groundMat) {
      groundMat.albedoColor = new Color3(...biomeColor);
    }

    this.scene.fogColor = new Color3(...b.fogColor);
    this.scene.fogDensity = b.fogDensity;

    // Update directional light (sun)
    const sun = this.scene.getLightByName('sun');
    if (sun && 'diffuse' in sun) {
      (sun as any).diffuse = new Color3(...b.sunColor);
      (sun as any).intensity = b.sunIntensity;
    }

    // Update hemisphere ambient for Ch0 peaceful ashram
    const ambient = this.scene.getLightByName('ambient');
    if (ambient && 'groundColor' in ambient) {
      if (chapter === 0) {
        (ambient as any).diffuse = new Color3(0.75, 0.7, 0.55);   // warm golden upper sky
        (ambient as any).groundColor = new Color3(0.2, 0.25, 0.15); // lush green bounce
        (ambient as any).intensity = 0.75;
        this.scene.clearColor = new Color4(0.15, 0.18, 0.1, 1); // green-tinted dawn sky
      } else if (chapter <= 3) {
        (ambient as any).diffuse = new Color3(0.65, 0.55, 0.45);
        (ambient as any).groundColor = new Color3(0.18, 0.14, 0.22);
        (ambient as any).intensity = 0.62;
        this.scene.clearColor = new Color4(0.06, 0.03, 0.02, 1);
      } else {
        (ambient as any).diffuse = new Color3(0.5, 0.4, 0.35);
        (ambient as any).groundColor = new Color3(0.15, 0.1, 0.2);
        (ambient as any).intensity = 0.55;
        this.scene.clearColor = new Color4(0.04, 0.02, 0.04, 1);
      }
    }

    // Update ambient particle colors per chapter biome
    if (this.emberParticles) {
      if (chapter <= 2) {
        // Forest: warm fireflies
        this.emberParticles.color1 = new Color4(0.4, 0.9, 0.2, 0.8);
        this.emberParticles.color2 = new Color4(0.3, 0.7, 0.1, 0.6);
        this.emberParticles.emitRate = 25;
      } else if (chapter === 3) {
        // Mountains: dust motes
        this.emberParticles.color1 = new Color4(0.6, 0.45, 0.2, 0.7);
        this.emberParticles.color2 = new Color4(0.5, 0.4, 0.25, 0.5);
        this.emberParticles.emitRate = 20;
      } else if (chapter <= 5) {
        // Coast: ocean mist
        this.emberParticles.color1 = new Color4(0.7, 0.8, 0.95, 0.6);
        this.emberParticles.color2 = new Color4(0.5, 0.65, 0.85, 0.4);
        this.emberParticles.emitRate = 30;
      } else {
        // Lanka: intense embers
        this.emberParticles.color1 = new Color4(1.0, 0.25, 0.05, 1.0);
        this.emberParticles.color2 = new Color4(0.9, 0.15, 0.02, 0.85);
        this.emberParticles.emitRate = 50;
      }
    }
    if (this.ashParticles) {
      if (chapter <= 2) {
        this.ashParticles.color1 = new Color4(0.2, 0.35, 0.15, 0.5);
        this.ashParticles.color2 = new Color4(0.15, 0.25, 0.1, 0.3);
      } else if (chapter <= 5) {
        this.ashParticles.color1 = new Color4(0.3, 0.35, 0.4, 0.5);
        this.ashParticles.color2 = new Color4(0.2, 0.25, 0.3, 0.35);
      } else {
        this.ashParticles.color1 = new Color4(0.15, 0.1, 0.08, 0.8);
        this.ashParticles.color2 = new Color4(0.1, 0.07, 0.05, 0.6);
        this.ashParticles.emitRate = 20;
      }
    }
  }
}

// ── Seeded RNG for deterministic tree placement ──────────────────────────────
// A-01: Terrain noise and biome amplitude functions
function terrainNoise(x: number, z: number): number {
  const n1 = Math.sin(x * 0.05) * Math.cos(z * 0.05);
  const n2 = Math.sin(x * 0.13 + 2.7) * Math.cos(z * 0.11 + 1.3) * 0.5;
  return n1 + n2;
}

function biomeAmplitude(z: number): number {
  // Height amplitude varies by chapter zone (z-coordinate)
  if (z > -50) return 2.5;        // Ch0-1: gentle rolling hills
  if (z > -150) return 2.0;       // transition
  if (z > -250) return 3.5;       // Ch2: elevated arid
  if (z > -380) return 4.5;       // Ch3: highland rocky
  if (z > -490) return 0.8;       // Ch4: flat sandy shore
  if (z > -580) return 0.2;       // Ch5: bridge zone flat
  return 3.5;                      // Ch6-7: volcanic ridges
}

function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
