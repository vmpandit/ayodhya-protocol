// ── Ayodhya Protocol: Lanka Reforged ── World Builder & Entity Meshes ──
// Characters render as billboard sprites when sprite PNGs are present in
// textures/ (sprite_player.png, sprite_enemy.png, sprite_boss.png).
// Falls back to N64-style flat-colour PBR primitive meshes if not found.

import {
  MeshBuilder, StandardMaterial, PBRMaterial, Color3, Vector3, Mesh,
  Scene, ShadowGenerator, TransformNode, InstancedMesh,
  Texture, Color4, GlowLayer, ParticleSystem, PointLight,
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
  private damageNumbers: { mesh: Mesh; startTime: number; startY: number }[] = [];
  private treeInstances: InstancedMesh[] = [];

  /** Shared PBR material cache — keyed by a descriptive string */
  private matCache = new Map<string, PBRMaterial>();

  /** Loaded texture assets from TextureLoader (null = flat-colour fallback) */
  private assets: LoadedAssets | null = null;

  /** Billboard sprite textures — loaded lazily on first character spawn */
  private spritePlayer: Texture | null = null;
  private spriteEnemy:  Texture | null = null;
  private spriteBoss:   Texture | null = null;
  private spritesChecked = false;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.scene = renderer.scene;
  }

  /** Call before build() to enable textured PBR materials */
  setAssets(assets: LoadedAssets): void {
    this.assets = assets;
  }

  /** Attempt to load sprite PNGs once. Uses HEAD requests to check existence first. */
  private loadSpritesIfNeeded(): void {
    if (this.spritesChecked) return;
    this.spritesChecked = true;

    const tryLoad = (path: string, setter: (t: Texture) => void): void => {
      fetch(path, { method: 'HEAD' })
        .then(r => {
          if (!r.ok) return;
          const t = new Texture(path, this.scene, false, true);
          t.hasAlpha = true;
          setter(t);
        })
        .catch(() => { /* file not present — use primitive fallback */ });
    };

    tryLoad('textures/sprite_player.png', t => {
      this.spritePlayer = t;
      // Rebuild any player meshes already on screen
      for (const [id, root] of this.playerMeshes) {
        const isLocal = root.name === `player_${id}`;
        root.dispose(false, true);
        this.playerMeshes.delete(id);
        this.addPlayerMesh(id, isLocal);
      }
    });
    tryLoad('textures/sprite_enemy.png', t => {
      this.spriteEnemy = t;
      for (const [id, root] of this.enemyMeshes) {
        root.dispose(false, true);
        this.enemyMeshes.delete(id);
      }
    });
    tryLoad('textures/sprite_boss.png', t => {
      this.spriteBoss = t;
      if (this.bossMesh) { this.bossMesh.dispose(false, true); this.bossMesh = null; }
    });
  }

  /**
   * Build a camera-facing billboard plane for a character.
   * The plane is white+unlit so the sprite texture colours show true.
   * @param name  mesh name
   * @param tex   sprite texture
   * @param w     world-space width
   * @param h     world-space height
   * @param root  parent TransformNode
   */
  private mkBillboard(
    name: string, tex: Texture,
    w: number, h: number,
    root: TransformNode,
  ): Mesh {
    const plane = MeshBuilder.CreatePlane(name, { width: w, height: h }, this.scene);
    plane.parent = root;
    plane.position.y = h / 2;            // pivot at feet
    plane.billboardMode = Mesh.BILLBOARDMODE_Y; // rotate only around Y (stays upright)
    const mat = new StandardMaterial(`${name}_mat`, this.scene);
    mat.diffuseTexture  = tex;
    mat.emissiveColor   = new Color3(1, 1, 1);  // unlit — full brightness
    mat.disableLighting = true;
    mat.useAlphaFromDiffuseTexture = true;
    mat.backFaceCulling = false;          // visible from all angles
    plane.material = mat;
    return plane;
  }

  build(): void {
    // Pre-load sprite textures so they're ready before first character spawn
    this.loadSpritesIfNeeded();
    this.buildGround();
    this.buildTrees();
    this.buildBossArena();
    // Only build fallback skybox if TextureLoader didn't build one
    if (!this.assets) this.buildSkybox();
    this.buildGlowLayer();
    this.buildAmbientParticles();
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
    const ground = MeshBuilder.CreateGround('ground', { width: C.WORLD_SIZE * 2, height: C.WORLD_SIZE * 2, subdivisions: 64 }, this.scene);
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
    const arena = MeshBuilder.CreateDisc('bossArena', { radius: C.BOSS_ARENA_RADIUS, tessellation: 48 }, this.scene);
    arena.rotation.x = Math.PI / 2;
    arena.position.set(C.BOSS_ARENA_CENTER.x, 0.02, C.BOSS_ARENA_CENTER.z);
    const mat = this.getMat('ground_arena', 'arenaMat', 0.15, 0.05, 0.05, 0.3, 0.7, 0.08, 0.01, 0.01);
    // UV tiling for arena
    if (mat.albedoTexture) {
      (mat.albedoTexture as Texture).uScale = 4; (mat.albedoTexture as Texture).vScale = 4;
      if (mat.bumpTexture) { (mat.bumpTexture as Texture).uScale = 4; (mat.bumpTexture as Texture).vScale = 4; }
      if (mat.microSurfaceTexture) { (mat.microSurfaceTexture as Texture).uScale = 4; (mat.microSurfaceTexture as Texture).vScale = 4; }
      if (mat.metallicTexture) { (mat.metallicTexture as Texture).uScale = 4; (mat.metallicTexture as Texture).vScale = 4; }
    }
    arena.material = mat;

    // Arena point light — purple dread glow from the centre
    const arenaLight = new PointLight('arenaLight',
      new Vector3(C.BOSS_ARENA_CENTER.x, 3, C.BOSS_ARENA_CENTER.z), this.scene);
    arenaLight.intensity = 1.8;
    arenaLight.diffuse   = new Color3(0.7, 0.1, 0.9);
    arenaLight.specular  = new Color3(0.4, 0.05, 0.6);
    arenaLight.range     = C.BOSS_ARENA_RADIUS * 2.2;

    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 / 8) * i;
      const x = C.BOSS_ARENA_CENTER.x + Math.cos(angle) * (C.BOSS_ARENA_RADIUS - 1);
      const z = C.BOSS_ARENA_CENTER.z + Math.sin(angle) * (C.BOSS_ARENA_RADIUS - 1);
      const pillar = MeshBuilder.CreateCylinder(`pillar_${i}`, { height: 8, diameter: 1.2, tessellation: 8 }, this.scene);
      pillar.position.set(x, 4, z);
      const pMat = this.getMat('pillar_stone', `pillarMat_${i}`, 0.3, 0.25, 0.2, 0.2, 0.6);
      pillar.material = pMat;
      this.renderer.shadowGenerator.addShadowCaster(pillar);
    }
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

    // ── Sprite billboard (if sprite_player.png is present) ────────────
    this.loadSpritesIfNeeded();
    if (this.spritePlayer) {
      this.mkBillboard(`${n}sprite`, this.spritePlayer, 1.1, 2.0, root);
      // Tint remote players slightly green so they're distinguishable
      if (!isLocal) {
        const plane = root.getChildMeshes()[0];
        if (plane?.material instanceof StandardMaterial) {
          plane.material.emissiveColor = new Color3(0.6, 1.0, 0.6);
        }
      }
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

  updatePlayerMesh(state: PlayerState, isLocal: boolean): void {
    let root = this.playerMeshes.get(state.id);
    if (!root) {
      this.addPlayerMesh(state.id, isLocal);
      root = this.playerMeshes.get(state.id);
      if (!root) return;
    }

    root.position.set(state.pos.x, state.pos.y, state.pos.z);
    root.rotation.y = state.yaw;
    root.rotation.x = state.status === PlayerStatus.Downed ? Math.PI / 2 * 0.8 : 0;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  ENEMY MESHES  (Rakshasa Sentinel — ~20 parts)
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
  }

  private _buildRakshasaParts(id: number): TransformNode {
    const n = `e${id}_`;
    const root = new TransformNode(`enemy_${id}`, this.scene);

    // ── Sprite billboard (if sprite_enemy.png is present) ─────────────
    this.loadSpritesIfNeeded();
    if (this.spriteEnemy) {
      this.mkBillboard(`${n}sprite`, this.spriteEnemy, 1.2, 2.6, root);
      return root;
    }

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

    // ── Sprite billboard (if sprite_boss.png is present) ──────────────
    this.loadSpritesIfNeeded();
    if (this.spriteBoss) {
      this.mkBillboard('boss_sprite', this.spriteBoss, 3.0, 4.5, root);
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

    let color: Color3;
    let emissive: Color3;
    let size = 0.15;

    switch (proj.type) {
      case ProjectileType.Arrow:        color = new Color3(0.8, 0.7, 0.3); emissive = new Color3(0.3, 0.25, 0.1); break;
      case ProjectileType.FireArrow:    color = new Color3(1, 0.4, 0.1);   emissive = new Color3(0.8, 0.3, 0);    size = 0.2; break;
      case ProjectileType.ShockwaveArrow: color = new Color3(0.3, 0.5, 1); emissive = new Color3(0.2, 0.3, 0.8); size = 0.25; break;
      case ProjectileType.EnemyProjectile: color = new Color3(0.8, 0.2, 0.1); emissive = new Color3(0.6, 0.1, 0); break;
      case ProjectileType.BossProjectile:  color = new Color3(0.7, 0.1, 0.5); emissive = new Color3(0.5, 0.05, 0.3); size = 0.3; break;
      default: color = new Color3(1, 1, 1); emissive = new Color3(0.5, 0.5, 0.5);
    }

    const mesh = MeshBuilder.CreateSphere(`proj_${proj.id}`, { diameter: size * 2, segments: 6 }, this.scene);
    mesh.position.set(proj.pos.x, proj.pos.y, proj.pos.z);
    const mat = new PBRMaterial(`projMat_${proj.id}`, this.scene);
    mat.albedoColor = color;
    mat.emissiveColor = emissive;
    mat.metallic = 0.8;
    mat.roughness = 0.2;
    mesh.material = mat;

    this.projectileMeshes.set(proj.id, { mesh, vel: { ...proj.vel }, spawnTime: performance.now(), type: proj.type });
  }

  updateProjectiles(dt: number): void {
    const now = performance.now();
    const toRemove: number[] = [];

    for (const [id, proj] of this.projectileMeshes) {
      proj.mesh.position.x += proj.vel.x * dt;
      proj.mesh.position.y += proj.vel.y * dt;
      proj.mesh.position.z += proj.vel.z * dt;
      proj.vel.y -= 20 * 0.15 * dt;

      if (now - proj.spawnTime > 4000 || proj.mesh.position.y < -1) toRemove.push(id);
    }

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
