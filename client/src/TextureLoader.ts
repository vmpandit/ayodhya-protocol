// ── Ayodhya Protocol: Lanka Reforged ── PBR Texture Loader ──
// Reads textures/manifest.json and builds PBRMaterial instances keyed by
// target_mesh_name. Environment textures (skybox, particles, UI) are
// stored separately for manual wiring.

import {
  Scene, PBRMaterial, Texture, Color3,
  StandardMaterial, MeshBuilder, EquiRectangularCubeTexture,
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

export class TextureLoader {
  private scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * Fetch manifest.json, create all PBR materials, and return them.
   * Also applies the skybox equirectangular dome.
   */
  async loadAll(): Promise<LoadedAssets> {
    const resp = await fetch(`${TEXTURE_BASE}manifest.json`);
    const manifest: ManifestEntry[] = await resp.json();

    const materials = new Map<string, PBRMaterial>();
    const textures = new Map<string, Texture>();

    // Names that shouldn't become PBR materials
    const standaloneNames = new Set([
      'skybox_dusk', 'projectile_arrow_trail', 'projectile_fire_arrow_trail',
      'particle_ember', 'ui_crosshair', 'ui_target_reticle', 'ui_damage_vignette',
    ]);

    for (const entry of manifest) {
      const path = `${TEXTURE_BASE}${entry.filename}`;

      // ── Standalone textures (particles, UI, skybox) ─────────
      if (standaloneNames.has(entry.target_mesh_name)) {
        const tex = new Texture(path, this.scene, !entry.tiling);
        tex.gammaSpace = entry.color_space === 'sRGB';
        textures.set(entry.filename.replace('.png', ''), tex);
        continue;
      }

      // ── PBR material assembly ──────────────────────────────
      if (!materials.has(entry.target_mesh_name)) {
        const mat = new PBRMaterial(`tex_${entry.target_mesh_name}`, this.scene);
        // Default: leave albedoColor at white so texture drives it fully
        mat.albedoColor = new Color3(1, 1, 1);
        materials.set(entry.target_mesh_name, mat);
      }
      const pbr = materials.get(entry.target_mesh_name)!;
      const tex = new Texture(path, this.scene, !entry.tiling);
      tex.gammaSpace = entry.color_space === 'sRGB';

      switch (entry.map_type) {
        case 'albedo':
          pbr.albedoTexture = tex;
          break;
        case 'normal':
          pbr.bumpTexture = tex;
          pbr.forceNormalForward = true; // OpenGL tangent-space
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

    console.log(`[TextureLoader] Loaded ${materials.size} materials, ${textures.size} standalone textures`);
    return { materials, textures };
  }

  private _buildSkybox(): void {
    const skybox = MeshBuilder.CreateBox('skyBox', { size: 1000 }, this.scene);
    const skyMat = new StandardMaterial('skyBoxMat', this.scene);
    skyMat.backFaceCulling = false;
    skyMat.disableLighting = true;
    skyMat.diffuseColor = new Color3(0, 0, 0);
    skyMat.specularColor = new Color3(0, 0, 0);

    try {
      skyMat.reflectionTexture = new EquiRectangularCubeTexture(
        `${TEXTURE_BASE}skybox_dusk_albedo.png`, this.scene, 512,
      );
      skyMat.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;
    } catch (e) {
      // Fallback: dark emissive skybox if equirectangular fails
      console.warn('[TextureLoader] Equirectangular skybox failed, using fallback:', e);
      skyMat.emissiveColor = new Color3(0.02, 0.02, 0.06);
    }

    skybox.material = skyMat;
    skybox.infiniteDistance = true;
  }
}
