// ── Ayodhya Protocol: Lanka Reforged ── Safe PBR Texture Loader ──
// Reads textures/manifest.json and builds PBRMaterial instances keyed by
// target_mesh_name. Each texture loads independently — failures fall back
// gracefully instead of white-screening the entire game.

import {
  Scene, PBRMaterial, Texture, Color3,
  StandardMaterial, MeshBuilder,
} from '@babylonjs/core';

interface ManifestEntry {
  filename: string;
  resolution: string;
  map_type: 'albedo' | 'normal' | 'roughness' | 'metallic' | 'emissive';
  color_space: 'sRGB' | 'linear';
  tiling: boolean;
  target_mesh_name: string;
}

/**
 * Holds all loaded PBR materials + special standalone textures.
 * Materials are keyed by manifest target_mesh_name.
 */
export interface LoadedAssets {
  /** PBR materials grouped by target_mesh_name (e.g. "player_armor") */
  materials: Map<string, PBRMaterial>;
  /** Standalone textures that aren't PBR materials (particles, UI, skybox) */
  textures: Map<string, Texture>;
}

const TEXTURE_BASE = 'textures/';

/** Default dark colours for each mesh — used when albedo texture is missing. */
const FALLBACK_COLORS: Record<string, [number, number, number]> = {
  ground_jungle:       [0.12, 0.10, 0.06],
  ground_arena:        [0.18, 0.14, 0.10],
  ground_transition:   [0.14, 0.11, 0.08],
  pillar_stone:        [0.22, 0.18, 0.14],
  tree_bark:           [0.16, 0.10, 0.06],
  tree_foliage:        [0.06, 0.14, 0.04],
  player_armor:        [0.15, 0.20, 0.35],
  player_gold_trim:    [0.55, 0.40, 0.10],
  player_visor:        [0.05, 0.15, 0.30],
  enemy_rakshasa:      [0.30, 0.08, 0.08],
  enemy_eye:           [0.60, 0.10, 0.05],
  boss_ravana:         [0.25, 0.05, 0.05],
  bow_weapon:          [0.35, 0.25, 0.10],
};

export class TextureLoader {
  private scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * Load a single texture, returning null on failure instead of throwing.
   */
  private _loadTextureSafe(path: string, tiling: boolean, isSRGB: boolean): Texture | null {
    try {
      const tex = new Texture(path, this.scene, !tiling);
      tex.gammaSpace = isSRGB;
      return tex;
    } catch (e) {
      console.warn(`[TextureLoader] Failed to load ${path}:`, e);
      return null;
    }
  }

  /**
   * Fetch manifest.json, create all PBR materials with graceful per-texture
   * fallback, and return them. Also applies the skybox.
   */
  async loadAll(): Promise<LoadedAssets> {
    let manifest: ManifestEntry[];
    try {
      const resp = await fetch(`${TEXTURE_BASE}manifest.json`);
      manifest = await resp.json();
    } catch (e) {
      console.warn('[TextureLoader] Failed to fetch manifest.json:', e);
      return { materials: new Map(), textures: new Map() };
    }

    const materials = new Map<string, PBRMaterial>();
    const textures = new Map<string, Texture>();

    // Names that shouldn't become PBR materials
    const standaloneNames = new Set([
      'skybox_dusk', 'projectile_arrow_trail', 'projectile_fire_arrow_trail',
      'particle_ember', 'ui_crosshair', 'ui_target_reticle', 'ui_damage_vignette',
      'vfx_agni_trail', 'vfx_vayu_trail', 'vfx_varuna_trail', 'vfx_naga_trail', 'vfx_brahma_trail',
    ]);

    let loaded = 0;
    let failed = 0;

    for (const entry of manifest) {
      const path = `${TEXTURE_BASE}${entry.filename}`;

      // ── Standalone textures (particles, UI, skybox) ─────────
      if (standaloneNames.has(entry.target_mesh_name)) {
        const tex = this._loadTextureSafe(path, entry.tiling, entry.color_space === 'sRGB');
        if (tex) {
          textures.set(entry.filename.replace('.png', ''), tex);
          loaded++;
        } else {
          failed++;
        }
        continue;
      }

      // ── PBR material assembly ──────────────────────────────
      if (!materials.has(entry.target_mesh_name)) {
        const mat = new PBRMaterial(`tex_${entry.target_mesh_name}`, this.scene);
        // CRITICAL: Use dark fallback colour instead of white — prevents white-screen
        const fb = FALLBACK_COLORS[entry.target_mesh_name] || [0.15, 0.12, 0.10];
        mat.albedoColor = new Color3(fb[0], fb[1], fb[2]);
        materials.set(entry.target_mesh_name, mat);
      }
      const pbr = materials.get(entry.target_mesh_name)!;
      const tex = this._loadTextureSafe(path, entry.tiling, entry.color_space === 'sRGB');

      if (!tex) {
        failed++;
        continue;
      }
      loaded++;

      switch (entry.map_type) {
        case 'albedo':
          pbr.albedoTexture = tex;
          // If albedo loaded successfully, set color to white so texture drives it
          pbr.albedoColor = new Color3(1, 1, 1);
          break;
        case 'normal':
          pbr.bumpTexture = tex;
          pbr.forceNormalForward = true;
          break;
        case 'roughness':
          pbr.microSurfaceTexture = tex;
          pbr.useMicroSurfaceFromReflectivityMapAlpha = false;
          break;
        case 'metallic':
          pbr.metallicTexture = tex;
          break;
        case 'emissive':
          pbr.emissiveTexture = tex;
          pbr.emissiveColor = Color3.White();
          break;
      }
    }

    // ── Skybox — equirectangular dome ──────────────────────────
    this._buildSkybox();

    console.log(`[TextureLoader] ${loaded} textures loaded, ${failed} failed (graceful fallback)`);
    return { materials, textures };
  }

  private _buildSkybox(): void {
    // Use a sphere instead of cube + EquiRectangularCubeTexture to avoid
    // WebGPU mip-level validation errors with cube textures.
    const skybox = MeshBuilder.CreateSphere('skyBox', { diameter: 1000, segments: 32 }, this.scene);
    const skyMat = new StandardMaterial('skyBoxMat', this.scene);
    skyMat.backFaceCulling = false;
    skyMat.disableLighting = true;
    skyMat.diffuseColor = new Color3(0, 0, 0);
    skyMat.specularColor = new Color3(0, 0, 0);

    try {
      const tex = new Texture(`${TEXTURE_BASE}skybox_dusk_albedo.png`, this.scene);
      tex.vScale = -1; // Flip vertically so panorama renders correctly on inside of sphere
      skyMat.emissiveTexture = tex;
    } catch (e) {
      console.warn('[TextureLoader] Skybox texture failed, using fallback:', e);
      skyMat.emissiveColor = new Color3(0.02, 0.02, 0.06);
    }

    skybox.material = skyMat;
    skybox.infiniteDistance = true;
  }
}
