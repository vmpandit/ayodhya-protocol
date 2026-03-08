// ── Ayodhya Protocol: Lanka Reforged ── World Builder & Entity Meshes ──
// N64-style flat-colour PBR primitive meshes for all characters.
// Environment uses PBR textures from TextureLoader when available.
// Enemies support billboard sprite rendering with fallback to primitives.

import {
  MeshBuilder, StandardMaterial, PBRMaterial, Color3, Vector3, Mesh,
  Scene, TransformNode, InstancedMesh,
  Texture, Color4, GlowLayer, ParticleSystem, PointLight, DynamicTexture,
  Engine,
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
  private trailParticles: { mesh: Mesh; age: number; maxAge: number }[] = [];
  private trailSpawnAccum = 0;
  private treeInstances: InstancedMesh[] = [];
  private emberParticles: ParticleSystem | null = null;
  private ashParticles: ParticleSystem | null = null;

  /** Shared PBR material cache — keyed by a descriptive string */
  private matCache = new Map<string, PBRMaterial>();

  /** Loaded texture assets from TextureLoader (null = flat-colour fallback) */
  private assets: LoadedAssets | null = null;

  /** Cached enemy sprite textures with white background removed */
  private enemySpriteTextures = {
    sprite1: null as Texture | null,  // sprite_enemy.png (odd IDs)
    sprite2: null as Texture | null,  // sprite_enemy2.png (even IDs)
  };

  private playerSpriteTexture: Texture | null = null;
  private bossSpriteTexture: Texture | null = null;

  /** Cached NPC ally sprite textures keyed by NPC id */
  private npcSpriteTextures = new Map<string, Texture>();

  /** Cached VFX trail textures for special arrow projectiles */
  private vfxTextures = new Map<string, Texture>();

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

  /** Call before build() to enable textured PBR materials */
  setAssets(assets: LoadedAssets): void {
    this.assets = assets;
  }

  async build(): Promise<void> {
    await this.loadEnemySprites();
    this.buildGround();
    this.buildTrees();
    this.buildBossArena();
    this.buildChapterLandmarks();
    this.buildWaterFeatures();
    // Only build fallback skybox if TextureLoader didn't build one
    if (!this.assets) this.buildSkybox();
    this.buildGlowLayer();
    this.buildAmbientParticles();
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
    const ground = MeshBuilder.CreateGround('ground_main', { width: C.WORLD_SIZE * 2, height: C.WORLD_SIZE * 2, subdivisions: 64 }, this.scene);
    const mat = this.getMat('ground_jungle', 'groundMat', 0.12, 0.18, 0.08, 0, 0.95);
    // UV tiling for ground textures
    if (mat.albedoTexture) {
      (mat.albedoTexture as Texture).uScale = 24; (mat.albedoTexture as Texture).vScale = 24;
      if (mat.bumpTexture) { (mat.bumpTexture as Texture).uScale = 24; (mat.bumpTexture as Texture).vScale = 24; }
      if (mat.microSurfaceTexture) { (mat.microSurfaceTexture as Texture).uScale = 24; (mat.microSurfaceTexture as Texture).vScale = 24; }
      if (mat.metallicTexture) { (mat.metallicTexture as Texture).uScale = 24; (mat.metallicTexture as Texture).vScale = 24; }
    }
    mat.ambientColor = new Color3(0.1, 0.1, 0.1);
    ground.material = mat;
    ground.receiveShadows = true;
  }

  private buildTrees(): void {
    const trunk = MeshBuilder.CreateCylinder('treeTrunk', { height: 4, diameter: 0.6, tessellation: 8 }, this.scene);
    trunk.position.y = 2;
    const trunkMat = this.getMat('tree_bark', 'trunkMat', 0.35, 0.2, 0.1, 0, 0.9);
    trunk.material = trunkMat;

    const foliage = MeshBuilder.CreateSphere('treeFoliage', { diameter: 3.5, segments: 6 }, this.scene);
    foliage.position.y = 5;
    const foliageMat = this.getMat('tree_foliage', 'foliageMat', 0.1, 0.35, 0.08, 0, 0.85);
    foliage.material = foliageMat;

    this.renderer.shadowGenerator.addShadowCaster(trunk);
    this.renderer.shadowGenerator.addShadowCaster(foliage);

    const rng = mulberry32(42);
    for (let i = 0; i < C.TREE_COUNT; i++) {
      const x = (rng() - 0.5) * C.WORLD_SIZE * 1.6;
      const z = (rng() - 0.5) * C.WORLD_SIZE * 1.6;
      const dx = x - C.BOSS_ARENA_CENTER.x;
      const dz = z - C.BOSS_ARENA_CENTER.z;
      if (Math.sqrt(dx * dx + dz * dz) < C.BOSS_ARENA_RADIUS + 5) continue;

      const scale = 0.8 + rng() * 0.6;
      const ti = trunk.createInstance(`trunk_${i}`);
      ti.position.set(x, 2 * scale, z);
      ti.scaling.setAll(scale);

      const fi = foliage.createInstance(`foliage_${i}`);
      fi.position.set(x, 5 * scale, z);
      fi.scaling.setAll(scale);

      this.treeInstances.push(ti, fi);
    }

    trunk.isVisible = false;
    foliage.isVisible = false;
  }

  private buildBossArena(): void {
    // ── ELEVATED PLATFORM (main arena disc at y=2.5) ───────────────────────────
    const arena = MeshBuilder.CreateDisc('bossArena', { radius: C.BOSS_ARENA_RADIUS, tessellation: 48 }, this.scene);
    arena.rotation.x = Math.PI / 2;
    arena.position.set(C.BOSS_ARENA_CENTER.x, 2.5, C.BOSS_ARENA_CENTER.z);
    const arenaMatProps = this.getMat('ground_arena', 'arenaMat', 0.1, 0.03, 0.08, 0.4, 0.7, 0.08, 0.01, 0.01);
    if (arenaMatProps.albedoTexture) {
      (arenaMatProps.albedoTexture as Texture).uScale = 4; (arenaMatProps.albedoTexture as Texture).vScale = 4;
      if (arenaMatProps.bumpTexture) { (arenaMatProps.bumpTexture as Texture).uScale = 4; (arenaMatProps.bumpTexture as Texture).vScale = 4; }
      if (arenaMatProps.microSurfaceTexture) { (arenaMatProps.microSurfaceTexture as Texture).uScale = 4; (arenaMatProps.microSurfaceTexture as Texture).vScale = 4; }
      if (arenaMatProps.metallicTexture) { (arenaMatProps.metallicTexture as Texture).uScale = 4; (arenaMatProps.metallicTexture as Texture).vScale = 4; }
    }
    arena.material = arenaMatProps;
    this.renderer.shadowGenerator.addShadowCaster(arena);

    // ── STAIRS/RAMP (5 box steps leading up from south side) ────────────────────
    for (let i = 0; i < 5; i++) {
      const y = 0.5 + i * 0.5;
      const z = C.BOSS_ARENA_CENTER.z + (25 - i * 0.8);
      const step = MeshBuilder.CreateBox(`stair_${i}`, { width: 4, height: 1, depth: 1 }, this.scene);
      step.position.set(C.BOSS_ARENA_CENTER.x, y, z);
      const stepMat = this.getMat('stairs_stone', `stairMat_${i}`, 0.25, 0.2, 0.15, 0.2, 0.65);
      step.material = stepMat;
      this.renderer.shadowGenerator.addShadowCaster(step);
    }

    // ── FORTRESS WALLS (12 segments in a circle with gaps at cardinal directions) ────
    const wallRadius = 22;
    const wallCount = 12;
    const gapAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]; // N, E, S, W
    const isGap = (angle: number): boolean => {
      const angleDeg = (angle * 180) / Math.PI;
      return gapAngles.some(g => Math.abs(((g * 180) / Math.PI) - angleDeg) < 15);
    };

    for (let i = 0; i < wallCount; i++) {
      const angle = (Math.PI * 2 / wallCount) * i;
      if (isGap(angle)) continue; // Skip gaps

      const x = C.BOSS_ARENA_CENTER.x + Math.cos(angle) * wallRadius;
      const z = C.BOSS_ARENA_CENTER.z + Math.sin(angle) * wallRadius;
      const wall = MeshBuilder.CreateBox(`wall_${i}`, { width: 3, height: 8, depth: 0.8 }, this.scene);
      wall.position.set(x, 4, z);
      wall.rotation.y = angle;
      const wallMat = this.getMat('wall_stone', `wallMat_${i}`, 0.2, 0.15, 0.1, 0.3, 0.6);
      wall.material = wallMat;
      this.renderer.shadowGenerator.addShadowCaster(wall);
    }

    // ── 4 TOWERS (at diagonal positions: NE, NW, SE, SW) ───────────────────────
    const diagonalAngles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
    const towerGoldMat = this.getMat('tower_gold', 'towerGoldMat', 0.7, 0.55, 0.1, 0.8, 0.2);
    for (let i = 0; i < diagonalAngles.length; i++) {
      const angle = diagonalAngles[i];
      const x = C.BOSS_ARENA_CENTER.x + Math.cos(angle) * wallRadius;
      const z = C.BOSS_ARENA_CENTER.z + Math.sin(angle) * wallRadius;
      const tower = MeshBuilder.CreateCylinder(`tower_${i}`, { height: 15, diameter: 3, tessellation: 12 }, this.scene);
      tower.position.set(x, 7.5, z);
      tower.material = towerGoldMat;
      this.renderer.shadowGenerator.addShadowCaster(tower);
    }

    // ── THRONE (raised disc at center) ──────────────────────────────────────────
    const throne = MeshBuilder.CreateDisc('throneDisc', { radius: 3, tessellation: 32 }, this.scene);
    throne.rotation.x = Math.PI / 2;
    throne.position.set(C.BOSS_ARENA_CENTER.x, 3.0, C.BOSS_ARENA_CENTER.z);
    const throneMat = this.getMat('throne_gold', 'throneMat', 0.85, 0.7, 0.15, 0.85, 0.15);
    throne.material = throneMat;
    this.renderer.shadowGenerator.addShadowCaster(throne);

    // ── FIRE BOWLS (4 point lights at entry gaps) ──────────────────────────────
    for (let i = 0; i < gapAngles.length; i++) {
      const angle = gapAngles[i];
      const x = C.BOSS_ARENA_CENTER.x + Math.cos(angle) * wallRadius;
      const z = C.BOSS_ARENA_CENTER.z + Math.sin(angle) * wallRadius;
      const fireBowl = new PointLight(`fireBowl_${i}`, new Vector3(x, 6, z), this.scene);
      fireBowl.intensity = 2.0;
      fireBowl.diffuse = new Color3(1.0, 0.5, 0.1);
      fireBowl.range = 12;
    }

    // ── ATMOSPHERIC PURPLE POINT LIGHT (elevated and stronger) ────────────────────
    const arenaLight = new PointLight('arenaLight',
      new Vector3(C.BOSS_ARENA_CENTER.x, 6, C.BOSS_ARENA_CENTER.z), this.scene);
    arenaLight.intensity = 3.0;
    arenaLight.diffuse   = new Color3(0.7, 0.1, 0.9);
    arenaLight.range     = C.BOSS_ARENA_RADIUS * 2.5;
  }

  private buildSkybox(): void {
    const skybox = MeshBuilder.CreateBox('skybox', { size: 500 }, this.scene);
    const skyMat = new StandardMaterial('skyMat', this.scene);
    skyMat.backFaceCulling = false;
    skyMat.disableLighting = true;
    skyMat.diffuseColor = new Color3(0, 0, 0);
    skyMat.specularColor = new Color3(0, 0, 0);
    skyMat.emissiveColor = new Color3(0.02, 0.02, 0.06);
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

    // ── Embers (hot sparks drifting upward) ──────────────────────────
    const embers = new ParticleSystem('embers', 250, this.scene);
    embers.particleTexture = emberTex ?? new Texture(WHITE_PNG, this.scene);
    embers.emitter = new Vector3(0, 1, 0);
    embers.minEmitBox = new Vector3(-C.WORLD_SIZE * 0.65, 0, -C.WORLD_SIZE * 0.65);
    embers.maxEmitBox = new Vector3( C.WORLD_SIZE * 0.65, 4,  C.WORLD_SIZE * 0.65);
    embers.color1      = new Color4(1.0, 0.45, 0.1, 1.0);
    embers.color2      = new Color4(1.0, 0.65, 0.2, 0.85);
    embers.colorDead   = new Color4(0.3, 0.1, 0.05, 0.0);
    embers.minSize     = 0.04;
    embers.maxSize     = 0.13;
    embers.minLifeTime = 3.5;
    embers.maxLifeTime = 7.0;
    embers.emitRate    = 35;
    embers.direction1  = new Vector3(-0.15, 0.7, -0.15);
    embers.direction2  = new Vector3( 0.15, 1.3,  0.15);
    embers.gravity     = new Vector3(0, -0.04, 0);
    embers.minEmitPower = 0.4;
    embers.maxEmitPower = 1.4;
    embers.updateSpeed  = 0.016;
    embers.blendMode    = ParticleSystem.BLENDMODE_ADD;
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
      root = this._buildRakshasaParts(state.id);
      this.enemyMeshes.set(state.id, root);
    }

    if (state.aiState === EnemyAIState.Dead) { root.setEnabled(false); return; }

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
  }

  private _buildRakshasaParts(id: number): TransformNode {
    const n = `e${id}_`;
    const root = new TransformNode(`enemy_${id}`, this.scene);

    // Check if we have sprites loaded and can use billboard rendering
    const useSprites = this.enemySpriteTextures.sprite1 !== null && this.enemySpriteTextures.sprite2 !== null;

    if (useSprites) {
      // ── Billboard sprite approach ──────────────────────────────────
      // Alternate between sprite_enemy.png (odd IDs) and sprite_enemy2.png (even IDs)
      const spriteTexture = (id % 2 === 1) ? this.enemySpriteTextures.sprite1 : this.enemySpriteTextures.sprite2;

      if (spriteTexture) {
        const billboardPlane = MeshBuilder.CreatePlane(`${n}billboard`, { size: 1 }, this.scene);
        billboardPlane.parent = root;
        billboardPlane.billboardMode = Mesh.BILLBOARDMODE_Y;

        // Apply type-specific scaling and positioning
        const enemyType = this.enemyTypes.get(id);
        if (enemyType === 'archer') {
          billboardPlane.scaling.set(1.1, 2.8, 1);
        } else if (enemyType === 'brute') {
          billboardPlane.scaling.set(1.8, 2.2, 1);
        } else {
          // soldier (default)
          billboardPlane.scaling.set(1.4, 2.5, 1);
        }

        billboardPlane.position.y = 1.25; // offset so feet sit at root position

        const billboardMat = new StandardMaterial(`${n}billboardMat`, this.scene);
        billboardMat.diffuseTexture = spriteTexture;
        billboardMat.useAlphaFromDiffuseTexture = true;

        // Apply type-specific tints
        if (enemyType === 'archer') {
          // Green tint for archer
          billboardMat.emissiveColor = new Color3(0.15, 0.35, 0.15);
        } else if (enemyType === 'brute') {
          // Purple tint for brute
          billboardMat.emissiveColor = new Color3(0.35, 0.15, 0.35);
        } else {
          // Default reddish tint for soldier
          billboardMat.emissiveColor = new Color3(0.15, 0.12, 0.1);
        }

        billboardMat.specularColor = new Color3(0, 0, 0); // no specular shine
        billboardMat.backFaceCulling = false;
        billboardPlane.material = billboardMat;
      }
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

    // Create procedural glow-based sphere
    const mesh = MeshBuilder.CreateSphere(`proj_${proj.id}`, { diameter: size * 2, segments: 8 }, this.scene);
    mesh.position.set(proj.pos.x, proj.pos.y, proj.pos.z);
    const mat = new PBRMaterial(`projMat_${proj.id}`, this.scene);
    mat.albedoColor = color;
    mat.emissiveColor = emissive;
    mat.metallic = 0.6;
    mat.roughness = 0.3;
    mesh.material = mat;

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
    // Create a glowing golden arrow bundle on the ground
    const mesh = MeshBuilder.CreateCylinder(`pickup_${id}`, { height: 0.4, diameter: 0.15, tessellation: 6 }, this.scene);
    mesh.position.set(pos.x, 0.3, pos.z);
    mesh.rotation.x = Math.PI / 2; // lay flat
    mesh.rotation.z = Math.random() * Math.PI; // random rotation

    const mat = new StandardMaterial(`pickupMat_${id}`, this.scene);
    mat.emissiveColor = new Color3(1.0, 0.85, 0.2); // golden glow
    mat.diffuseColor = new Color3(0.8, 0.6, 0.1);
    mat.disableLighting = true;
    mesh.material = mat;

    this.pickupMeshes.set(id, mesh);
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

      // Spawn fading trail particle
      if (spawnTrail && now - proj.spawnTime < 3500) {
        this.spawnTrailParticle(proj.mesh.position, proj.type);
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
    const size = 0.6; // Larger trail particles
    const trail = MeshBuilder.CreatePlane(`trail_${Math.random()}`, { size }, this.scene);
    trail.position.set(
      pos.x + (Math.random() - 0.5) * 0.1,
      pos.y + (Math.random() - 0.5) * 0.1,
      pos.z + (Math.random() - 0.5) * 0.1,
    );
    trail.billboardMode = Mesh.BILLBOARDMODE_ALL;

    const mat = new StandardMaterial(`trailMat_${Math.random()}`, this.scene);
    mat.emissiveColor = new Color3(r, g, b);
    mat.disableLighting = true;
    mat.alpha = 0.7;
    trail.material = mat;

    this.trailParticles.push({ mesh: trail, age: 0, maxAge: 0.25 + Math.random() * 0.15 });
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
      // Fade out and shrink
      const alpha = 0.7 * (1 - life);
      const scale = 1.0 - life * 0.5;
      if (p.mesh.material instanceof StandardMaterial) {
        p.mesh.material.alpha = alpha;
      }
      p.mesh.scaling.setAll(scale);
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
      // Fallback to colored plane if sprite not found
      mat.emissiveColor = color.scale(0.6);
      mat.diffuseColor = color;
    }
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;
    billboard.material = mat;

    // ── BEACON PILLAR (glowing cylinder above NPC) ────────────────────────────
    const beacon = MeshBuilder.CreateCylinder(`beacon_${id}`, { height: 20, diameter: 0.6, tessellation: 16 }, this.scene);
    beacon.parent = root;
    beacon.position.y = 10; // centered at height 10
    const beaconMat = new StandardMaterial(`beaconMat_${id}`, this.scene);
    beaconMat.emissiveColor = beaconColor;
    beaconMat.diffuseColor = beaconColor.scale(0.5);
    beaconMat.alpha = 0.3;
    beaconMat.backFaceCulling = false;
    beacon.material = beaconMat;

    // ── FLOATING DIAMOND MARKER (octahedron above NPC head) ────────────────────
    const diamond = MeshBuilder.CreatePolyhedron(`diamond_${id}`, { type: 1, size: 0.4 }, this.scene);
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
    light.intensity = 3.0;
    light.range = 15;

    this.allyNPCMeshes.set(id, root);
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
        const alphaPulse = 0.25 + Math.sin(now * 2) * 0.075;
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

    // Ch0: Vishwamitra's Ashram (center, around 0, 0, -5)
    this.buildChapter0Landmarks(rng);

    // Ch1: Dandaka Forest (center-south, around 0, 0, -25)
    this.buildChapter1Landmarks(rng);

    // Ch2: Panchavati/Jatayu (south, around -20, 0, -55)
    this.buildChapter2Landmarks(rng);

    // Ch3: Kishkindha (southwest, around -55, 0, -65)
    this.buildChapter3Landmarks(rng);

    // Ch4: Southern Shore (far south, around -10, 0, -95)
    this.buildChapter4Landmarks(rng);

    // Ch5: Rama Setu (from (20, 0, -90) toward (45, 0, -60))
    this.buildChapter5Landmarks(rng);

    // Ch6: Lanka Outskirts (east, around 40, 0, 25)
    this.buildChapter6Landmarks(rng);

    // Ch7: Ravana's Palace (boss arena at (50, 0, 50) — ceremonial pillars only)
    this.buildChapter7Landmarks(rng);
  }

  private buildChapter0Landmarks(rng: () => number): void {
    const centerX = 0, centerZ = -5;

    // 3 training posts: cylinders with cross-beams
    for (let i = 0; i < 3; i++) {
      const offsetX = (i - 1) * 4 + (rng() - 0.5) * 1.5;
      const offsetZ = (rng() - 0.5) * 2;
      const postX = centerX + offsetX;
      const postZ = centerZ + offsetZ;

      const post = MeshBuilder.CreateCylinder(`ch0_post_${i}`, { height: 3, diameter: 0.3, tessellation: 8 }, this.scene);
      post.position.set(postX, 1.5, postZ);
      const postMat = new StandardMaterial(`ch0_postMat_${i}`, this.scene);
      postMat.diffuseColor = new Color3(0.45, 0.35, 0.2);
      post.material = postMat;
      this.renderer.shadowGenerator.addShadowCaster(post);

      const beam = MeshBuilder.CreateBox(`ch0_beam_${i}`, { width: 1.5, height: 0.15, depth: 0.15 }, this.scene);
      beam.position.set(postX, 2.5, postZ);
      beam.material = postMat;
      this.renderer.shadowGenerator.addShadowCaster(beam);
    }

    // Meditation circle: flat disc with surrounding stones
    const discRadius = 3;
    const disc = MeshBuilder.CreateDisc(`ch0_meditationDisc`, { radius: discRadius, tessellation: 32 }, this.scene);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(centerX, 0.1, centerZ);
    const discMat = new StandardMaterial(`ch0_discMat`, this.scene);
    discMat.diffuseColor = new Color3(0.35, 0.3, 0.25);
    disc.material = discMat;

    // 6 small stone cylinders around meditation circle
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 / 6) * i;
      const stoneX = centerX + Math.cos(angle) * (discRadius + 1.5);
      const stoneZ = centerZ + Math.sin(angle) * (discRadius + 1.5);

      const stone = MeshBuilder.CreateCylinder(`ch0_stone_${i}`, { height: 0.8, diameter: 0.4, tessellation: 8 }, this.scene);
      stone.position.set(stoneX, 0.4, stoneZ);
      const stoneMat = new StandardMaterial(`ch0_stoneMat_${i}`, this.scene);
      stoneMat.diffuseColor = new Color3(0.5, 0.45, 0.4);
      stone.material = stoneMat;
      this.renderer.shadowGenerator.addShadowCaster(stone);
    }

    // Sacred fire: small box with orange light
    const fireBox = MeshBuilder.CreateBox(`ch0_fireBox`, { width: 0.5, height: 0.3, depth: 0.5 }, this.scene);
    fireBox.position.set(centerX, 0.2, centerZ - 2.5);
    const fireMat = new StandardMaterial(`ch0_fireMat`, this.scene);
    fireMat.diffuseColor = new Color3(0.8, 0.4, 0.1);
    fireMat.emissiveColor = new Color3(0.8, 0.4, 0.1);
    fireBox.material = fireMat;

    const fireLight = new PointLight(`ch0_fireLight`, new Vector3(centerX, 1, centerZ - 2.5), this.scene);
    fireLight.diffuse = new Color3(1.0, 0.6, 0.2);
    fireLight.intensity = 2;
    fireLight.range = 6;
  }

  private buildChapter1Landmarks(rng: () => number): void {
    const centerX = 0, centerZ = -25;

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

    // Campfire: stone torus with orange light
    const torus = MeshBuilder.CreateTorus(`ch1_campfireTorus`, { diameter: 1.6, thickness: 0.15, tessellation: 16 }, this.scene);
    torus.position.set(centerX, 0.1, centerZ);
    const torusMat = new StandardMaterial(`ch1_torusMat`, this.scene);
    torusMat.diffuseColor = new Color3(0.4, 0.35, 0.3);
    torus.material = torusMat;
    this.renderer.shadowGenerator.addShadowCaster(torus);

    const campfireLight = new PointLight(`ch1_campfireLight`, new Vector3(centerX, 1, centerZ), this.scene);
    campfireLight.diffuse = new Color3(1.0, 0.5, 0.1);
    campfireLight.intensity = 1.5;
    campfireLight.range = 8;
  }

  private buildChapter2Landmarks(rng: () => number): void {
    const centerX = -20, centerZ = -55;

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

  private buildChapter3Landmarks(rng: () => number): void {
    const centerX = -55, centerZ = -65;

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
  }

  private buildChapter4Landmarks(rng: () => number): void {
    const centerX = -10, centerZ = -95;

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
  }

  private buildChapter5Landmarks(rng: () => number): void {
    // THE BRIDGE: Rama Setu from (20, 0, -90) toward (42, 0, -62)
    const startX = 20, startZ = -90;
    const endX = 42, endZ = -62;
    const deltaX = endX - startX;
    const deltaZ = endZ - startZ;
    const bridgeLength = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
    const numStones = 12;

    const stoneMat = new StandardMaterial(`ch5_stoneMat`, this.scene);
    stoneMat.diffuseColor = new Color3(0.7, 0.6, 0.35);
    stoneMat.specularColor = new Color3(0.3, 0.3, 0.3);

    for (let i = 0; i < numStones; i++) {
      const t = i / (numStones - 1);
      const stoneX = startX + deltaX * t;
      const stoneZ = startZ + deltaZ * t;

      const stone = MeshBuilder.CreateBox(`ch5_bridgeStone_${i}`, { width: 3, height: 0.8, depth: 3 }, this.scene);
      stone.position.set(stoneX, 0.3, stoneZ);
      stone.material = stoneMat;
      this.renderer.shadowGenerator.addShadowCaster(stone);
    }

    // 3 floating pillars next to bridge
    const pillarMat = new StandardMaterial(`ch5_pillarMat`, this.scene);
    pillarMat.diffuseColor = new Color3(0.5, 0.45, 0.4);

    for (let i = 0; i < 3; i++) {
      const t = 0.2 + i * 0.3;
      const pillarX = startX + deltaX * t + (rng() - 0.5) * 3;
      const pillarZ = startZ + deltaZ * t + (rng() - 0.5) * 3;

      const pillar = MeshBuilder.CreateCylinder(`ch5_pillar_${i}`, { height: 2.5, diameter: 1.2, tessellation: 12 }, this.scene);
      pillar.position.set(pillarX, -0.5, pillarZ);
      pillar.material = pillarMat;
      this.renderer.shadowGenerator.addShadowCaster(pillar);
    }

    // 2 camp tents: angled boxes forming A-shape
    const tentMat = new StandardMaterial(`ch5_tentMat`, this.scene);
    tentMat.diffuseColor = new Color3(0.5, 0.35, 0.2);

    for (let i = 0; i < 2; i++) {
      const tentCenterX = startX + (i === 0 ? -8 : 8) + (rng() - 0.5) * 2;
      const tentCenterZ = startZ + (rng() - 0.5) * 4;

      // Left side of tent
      const tentL = MeshBuilder.CreateBox(`ch5_tentL_${i}`, { width: 0.3, height: 2, depth: 2.5 }, this.scene);
      tentL.position.set(tentCenterX - 1, 1, tentCenterZ);
      tentL.rotation.z = Math.PI / 6;
      tentL.material = tentMat;
      this.renderer.shadowGenerator.addShadowCaster(tentL);

      // Right side of tent
      const tentR = MeshBuilder.CreateBox(`ch5_tentR_${i}`, { width: 0.3, height: 2, depth: 2.5 }, this.scene);
      tentR.position.set(tentCenterX + 1, 1, tentCenterZ);
      tentR.rotation.z = -Math.PI / 6;
      tentR.material = tentMat;
      this.renderer.shadowGenerator.addShadowCaster(tentR);
    }
  }

  private buildChapter6Landmarks(rng: () => number): void {
    const centerX = 40, centerZ = 25;

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
  }

  private buildChapter7Landmarks(rng: () => number): void {
    // Ch7: 4 ceremonial pillars flanking south approach to boss arena
    const positions = [
      { x: 48, z: 38 },
      { x: 52, z: 38 },
      { x: 48, z: 44 },
      { x: 52, z: 44 },
    ];

    const pillarMat = new StandardMaterial(`ch7_pillarMat`, this.scene);
    pillarMat.diffuseColor = new Color3(0.75, 0.6, 0.15);
    pillarMat.specularColor = new Color3(0.5, 0.5, 0.5);

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const pillar = MeshBuilder.CreateCylinder(`ch7_ceremonialPillar_${i}`, { height: 8, diameter: 1.2, tessellation: 12 }, this.scene);
      pillar.position.set(pos.x, 4, pos.z);
      pillar.material = pillarMat;
      this.renderer.shadowGenerator.addShadowCaster(pillar);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  WATER FEATURES
  // ══════════════════════════════════════════════════════════════════════════

  private buildWaterFeatures(): void {
    // River: flowing water across the landscape
    const river = MeshBuilder.CreatePlane(`waterRiver`, { width: 4, height: 60 }, this.scene);
    river.rotation.x = Math.PI / 2;
    river.position.set(10, 0.08, -30);

    const riverMat = new StandardMaterial(`riverMat`, this.scene);
    riverMat.diffuseColor = new Color3(0.1, 0.3, 0.55);
    riverMat.emissiveColor = new Color3(0.05, 0.15, 0.3);
    riverMat.alpha = 0.35;
    riverMat.backFaceCulling = false;
    river.material = riverMat;

    // Ocean: large water plane at far south
    const ocean = MeshBuilder.CreatePlane(`waterOcean`, { width: 120, height: 40 }, this.scene);
    ocean.rotation.x = Math.PI / 2;
    ocean.position.set(0, 0.04, -110);

    const oceanMat = new StandardMaterial(`oceanMat`, this.scene);
    oceanMat.diffuseColor = new Color3(0.05, 0.15, 0.4);
    oceanMat.emissiveColor = new Color3(0.02, 0.08, 0.22);
    oceanMat.alpha = 0.45;
    oceanMat.backFaceCulling = false;
    ocean.material = oceanMat;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  CHAPTER BIOME SYSTEM
  // ══════════════════════════════════════════════════════════════════════════

  setChapterBiome(chapter: number): void {
    // Get the ground mesh
    const ground = this.scene.getMeshByName('ground_main');
    const groundMat = ground?.material as PBRMaterial;

    // Define biome settings per chapter
    const biomes: Record<number, { groundColor: [number, number, number]; fogColor: [number, number, number]; fogDensity: number; sunColor: [number, number, number]; sunIntensity: number }> = {
      0: { groundColor: [0.12, 0.22, 0.08], fogColor: [0.15, 0.12, 0.06], fogDensity: 0.008, sunColor: [1.0, 0.7, 0.3], sunIntensity: 1.2 }, // Dandaka - lush
      1: { groundColor: [0.12, 0.22, 0.08], fogColor: [0.15, 0.12, 0.06], fogDensity: 0.008, sunColor: [1.0, 0.7, 0.3], sunIntensity: 1.2 },
      2: { groundColor: [0.2, 0.1, 0.06], fogColor: [0.25, 0.1, 0.05], fogDensity: 0.012, sunColor: [1.0, 0.4, 0.2], sunIntensity: 1.0 }, // Scorched
      3: { groundColor: [0.18, 0.15, 0.1], fogColor: [0.2, 0.15, 0.08], fogDensity: 0.006, sunColor: [0.9, 0.7, 0.4], sunIntensity: 1.5 }, // Kishkindha rocky
      4: { groundColor: [0.22, 0.2, 0.14], fogColor: [0.15, 0.18, 0.22], fogDensity: 0.005, sunColor: [0.8, 0.85, 1.0], sunIntensity: 1.3 }, // Shore
      5: { groundColor: [0.12, 0.08, 0.06], fogColor: [0.2, 0.08, 0.04], fogDensity: 0.015, sunColor: [0.9, 0.3, 0.15], sunIntensity: 0.8 }, // Volcanic
      6: { groundColor: [0.12, 0.08, 0.06], fogColor: [0.2, 0.08, 0.04], fogDensity: 0.015, sunColor: [0.9, 0.3, 0.15], sunIntensity: 0.8 },
      7: { groundColor: [0.06, 0.02, 0.08], fogColor: [0.12, 0.04, 0.1], fogDensity: 0.018, sunColor: [0.6, 0.15, 0.4], sunIntensity: 0.6 }, // Lanka dark
    };

    const b = biomes[chapter] ?? biomes[0];

    if (groundMat) {
      groundMat.albedoColor = new Color3(...b.groundColor);
    }

    this.scene.fogColor = new Color3(...b.fogColor);
    this.scene.fogDensity = b.fogDensity;

    // Update directional light (sun)
    const sun = this.scene.getLightByName('sun');
    if (sun && 'diffuse' in sun) {
      (sun as any).diffuse = new Color3(...b.sunColor);
      (sun as any).intensity = b.sunIntensity;
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
function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
