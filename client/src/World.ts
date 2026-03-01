// ── Ayodhya Protocol: Lanka Reforged ── World Builder & Entity Meshes ──

import {
  MeshBuilder, StandardMaterial, PBRMaterial, Color3, Vector3, Mesh,
  Scene, ShadowGenerator, TransformNode, InstancedMesh,
  ParticleSystem, Texture, Color4, GlowLayer,
} from '@babylonjs/core';
import { Renderer } from './Renderer';
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

export class World {
  private renderer: Renderer;
  private scene: Scene;
  private playerMeshes = new Map<number, TransformNode>();
  private enemyMeshes = new Map<number, TransformNode>();
  private bossMesh: TransformNode | null = null;
  private projectileMeshes = new Map<number, ProjectileMesh>();
  private damageNumbers: { mesh: Mesh; startTime: number; startY: number }[] = [];
  private treeInstances: InstancedMesh[] = [];

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.scene = renderer.scene;
  }

  build(): void {
    this.buildGround();
    this.buildTrees();
    this.buildBossArena();
    this.buildSkybox();
    this.buildGlowLayer();
  }

  private buildGround(): void {
    const ground = MeshBuilder.CreateGround('ground', { width: C.WORLD_SIZE * 2, height: C.WORLD_SIZE * 2, subdivisions: 64 }, this.scene);
    const mat = new PBRMaterial('groundMat', this.scene);
    mat.albedoColor = new Color3(0.12, 0.18, 0.08);
    mat.metallic = 0;
    mat.roughness = 0.95;
    mat.ambientColor = new Color3(0.1, 0.1, 0.1);
    ground.material = mat;
    ground.receiveShadows = true;
  }

  private buildTrees(): void {
    // Base tree mesh (trunk + foliage)
    const trunk = MeshBuilder.CreateCylinder('treeTrunk', { height: 4, diameter: 0.6, tessellation: 8 }, this.scene);
    trunk.position.y = 2;
    const trunkMat = new PBRMaterial('trunkMat', this.scene);
    trunkMat.albedoColor = new Color3(0.35, 0.2, 0.1);
    trunkMat.metallic = 0;
    trunkMat.roughness = 0.9;
    trunk.material = trunkMat;

    const foliage = MeshBuilder.CreateSphere('treeFoliage', { diameter: 3.5, segments: 6 }, this.scene);
    foliage.position.y = 5;
    const foliageMat = new PBRMaterial('foliageMat', this.scene);
    foliageMat.albedoColor = new Color3(0.1, 0.35, 0.08);
    foliageMat.metallic = 0;
    foliageMat.roughness = 0.85;
    foliage.material = foliageMat;

    this.renderer.shadowGenerator.addShadowCaster(trunk);
    this.renderer.shadowGenerator.addShadowCaster(foliage);

    // GPU instancing via Babylon's InstancedMesh
    const rng = mulberry32(42);
    for (let i = 0; i < C.TREE_COUNT; i++) {
      const x = (rng() - 0.5) * C.WORLD_SIZE * 1.6;
      const z = (rng() - 0.5) * C.WORLD_SIZE * 1.6;

      // Skip boss arena area
      const dx = x - C.BOSS_ARENA_CENTER.x;
      const dz = z - C.BOSS_ARENA_CENTER.z;
      if (Math.sqrt(dx * dx + dz * dz) < C.BOSS_ARENA_RADIUS + 5) continue;

      const scale = 0.8 + rng() * 0.6;
      const trunkInst = trunk.createInstance(`trunk_${i}`);
      trunkInst.position.set(x, 2 * scale, z);
      trunkInst.scaling.setAll(scale);

      const foliageInst = foliage.createInstance(`foliage_${i}`);
      foliageInst.position.set(x, 5 * scale, z);
      foliageInst.scaling.setAll(scale);

      this.treeInstances.push(trunkInst, foliageInst);
    }

    // Hide base meshes
    trunk.isVisible = false;
    foliage.isVisible = false;
  }

  private buildBossArena(): void {
    const arena = MeshBuilder.CreateDisc('bossArena', { radius: C.BOSS_ARENA_RADIUS, tessellation: 48 }, this.scene);
    arena.rotation.x = Math.PI / 2;
    arena.position.set(C.BOSS_ARENA_CENTER.x, 0.02, C.BOSS_ARENA_CENTER.z);
    const mat = new PBRMaterial('arenaMat', this.scene);
    mat.albedoColor = new Color3(0.15, 0.05, 0.05);
    mat.metallic = 0.3;
    mat.roughness = 0.7;
    mat.emissiveColor = new Color3(0.08, 0.01, 0.01);
    arena.material = mat;

    // Pillars around arena
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 / 8) * i;
      const x = C.BOSS_ARENA_CENTER.x + Math.cos(angle) * (C.BOSS_ARENA_RADIUS - 1);
      const z = C.BOSS_ARENA_CENTER.z + Math.sin(angle) * (C.BOSS_ARENA_RADIUS - 1);
      const pillar = MeshBuilder.CreateCylinder(`pillar_${i}`, { height: 8, diameter: 1.2, tessellation: 8 }, this.scene);
      pillar.position.set(x, 4, z);
      const pMat = new PBRMaterial(`pillarMat_${i}`, this.scene);
      pMat.albedoColor = new Color3(0.3, 0.25, 0.2);
      pMat.metallic = 0.2;
      pMat.roughness = 0.6;
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
    gl.intensity = 0.5;
  }

  // ── Player Meshes ──
  addPlayerMesh(id: number, isLocal: boolean): void {
    if (this.playerMeshes.has(id)) return;

    const root = new TransformNode(`player_${id}`, this.scene);

    // Body
    const body = MeshBuilder.CreateCapsule(`pBody_${id}`, { height: 1.7, radius: 0.35 }, this.scene);
    body.parent = root;
    body.position.y = 0.85;
    const bodyMat = new PBRMaterial(`pBodyMat_${id}`, this.scene);
    bodyMat.albedoColor = isLocal ? new Color3(0.1, 0.3, 0.8) : new Color3(0.2, 0.7, 0.3);
    bodyMat.metallic = 0.4;
    bodyMat.roughness = 0.5;
    body.material = bodyMat;
    this.renderer.shadowGenerator.addShadowCaster(body);

    // Bow (simple representation)
    const bow = MeshBuilder.CreateTorus(`pBow_${id}`, { diameter: 0.8, thickness: 0.06, tessellation: 16 }, this.scene);
    bow.parent = root;
    bow.position.set(-0.5, 1.2, 0);
    bow.rotation.z = Math.PI / 2;
    const bowMat = new PBRMaterial(`pBowMat_${id}`, this.scene);
    bowMat.albedoColor = new Color3(0.5, 0.3, 0.1);
    bowMat.metallic = 0;
    bowMat.roughness = 0.7;
    bow.material = bowMat;

    this.playerMeshes.set(id, root);
  }

  removePlayerMesh(id: number): void {
    const mesh = this.playerMeshes.get(id);
    if (mesh) {
      mesh.dispose(false, true);
      this.playerMeshes.delete(id);
    }
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

    // Downed visual
    if (state.status === PlayerStatus.Downed) {
      root.rotation.x = Math.PI / 2 * 0.8;
    } else {
      root.rotation.x = 0;
    }
  }

  // ── Enemy Meshes ──
  updateEnemyMesh(state: EnemyState): void {
    let root = this.enemyMeshes.get(state.id);
    if (!root) {
      root = new TransformNode(`enemy_${state.id}`, this.scene);
      const body = MeshBuilder.CreateCapsule(`eBody_${state.id}`, { height: 1.8, radius: 0.45 }, this.scene);
      body.parent = root;
      body.position.y = 0.9;
      const mat = new PBRMaterial(`eBodyMat_${state.id}`, this.scene);
      mat.albedoColor = new Color3(0.6, 0.15, 0.1);
      mat.metallic = 0.3;
      mat.roughness = 0.6;
      mat.emissiveColor = new Color3(0.15, 0.02, 0.02);
      body.material = mat;
      this.renderer.shadowGenerator.addShadowCaster(body);

      // Eyes
      const eye1 = MeshBuilder.CreateSphere(`eEye1_${state.id}`, { diameter: 0.15 }, this.scene);
      eye1.parent = root;
      eye1.position.set(-0.15, 1.6, -0.35);
      const eye2 = MeshBuilder.CreateSphere(`eEye2_${state.id}`, { diameter: 0.15 }, this.scene);
      eye2.parent = root;
      eye2.position.set(0.15, 1.6, -0.35);
      const eyeMat = new StandardMaterial(`eEyeMat_${state.id}`, this.scene);
      eyeMat.emissiveColor = new Color3(1, 0.3, 0);
      eyeMat.disableLighting = true;
      eye1.material = eyeMat;
      eye2.material = eyeMat;

      this.enemyMeshes.set(state.id, root);
    }

    if (state.aiState === EnemyAIState.Dead) {
      root.setEnabled(false);
      return;
    }

    root.setEnabled(true);
    root.position.set(state.pos.x, state.pos.y, state.pos.z);
    root.rotation.y = state.yaw;
  }

  // ── Boss Mesh ──
  updateBossMesh(state: BossState): void {
    if (!this.bossMesh) {
      const root = new TransformNode('boss', this.scene);

      // Main body
      const body = MeshBuilder.CreateCapsule('bossBody', { height: 4, radius: 1.2 }, this.scene);
      body.parent = root;
      body.position.y = 2;
      const mat = new PBRMaterial('bossBodyMat', this.scene);
      mat.albedoColor = new Color3(0.25, 0.05, 0.35);
      mat.metallic = 0.5;
      mat.roughness = 0.4;
      mat.emissiveColor = new Color3(0.1, 0.02, 0.15);
      body.material = mat;
      this.renderer.shadowGenerator.addShadowCaster(body);

      // Crown / horns
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI * 2 / 6) * i;
        const horn = MeshBuilder.CreateCylinder(`bossHorn_${i}`, { height: 1.5, diameterTop: 0.05, diameterBottom: 0.2, tessellation: 6 }, this.scene);
        horn.parent = root;
        horn.position.set(Math.sin(angle) * 0.6, 4.2, Math.cos(angle) * 0.6);
        horn.rotation.z = Math.sin(angle) * 0.3;
        horn.rotation.x = Math.cos(angle) * 0.3;
        const hMat = new PBRMaterial(`bossHornMat_${i}`, this.scene);
        hMat.albedoColor = new Color3(0.4, 0.15, 0);
        hMat.metallic = 0.6;
        hMat.roughness = 0.3;
        hMat.emissiveColor = new Color3(0.15, 0.05, 0);
        horn.material = hMat;
      }

      // Eyes
      const eyePositions = [[-0.4, 3.5, -0.9], [0.4, 3.5, -0.9], [-0.2, 3.2, -1], [0.2, 3.2, -1]];
      for (let i = 0; i < eyePositions.length; i++) {
        const eye = MeshBuilder.CreateSphere(`bossEye_${i}`, { diameter: 0.2 }, this.scene);
        eye.parent = root;
        eye.position.set(eyePositions[i][0], eyePositions[i][1], eyePositions[i][2]);
        const eMat = new StandardMaterial(`bossEyeMat_${i}`, this.scene);
        eMat.emissiveColor = new Color3(1, 0.2, 0.2);
        eMat.disableLighting = true;
        eye.material = eMat;
      }

      this.bossMesh = root;
    }

    if (state.phase === BossPhase.Dead) {
      this.bossMesh.setEnabled(false);
      return;
    }

    this.bossMesh.setEnabled(true);
    this.bossMesh.position.set(state.pos.x, state.pos.y, state.pos.z);
    this.bossMesh.rotation.y = state.yaw;

    // Enrage visual
    const body = this.bossMesh.getChildMeshes()[0];
    if (body && body.material instanceof PBRMaterial) {
      if (state.phase === BossPhase.Phase3Enrage) {
        body.material.emissiveColor = new Color3(0.4, 0.05, 0.05);
      } else {
        body.material.emissiveColor = new Color3(0.1, 0.02, 0.15);
      }
    }
  }

  // ── Projectiles ──
  spawnProjectile(proj: ProjectileState): void {
    if (this.projectileMeshes.has(proj.id)) return;

    let color: Color3;
    let emissive: Color3;
    let size = 0.15;

    switch (proj.type) {
      case ProjectileType.Arrow:
        color = new Color3(0.8, 0.7, 0.3);
        emissive = new Color3(0.3, 0.25, 0.1);
        break;
      case ProjectileType.FireArrow:
        color = new Color3(1, 0.4, 0.1);
        emissive = new Color3(0.8, 0.3, 0);
        size = 0.2;
        break;
      case ProjectileType.ShockwaveArrow:
        color = new Color3(0.3, 0.5, 1);
        emissive = new Color3(0.2, 0.3, 0.8);
        size = 0.25;
        break;
      case ProjectileType.EnemyProjectile:
        color = new Color3(0.8, 0.2, 0.1);
        emissive = new Color3(0.6, 0.1, 0);
        break;
      case ProjectileType.BossProjectile:
        color = new Color3(0.7, 0.1, 0.5);
        emissive = new Color3(0.5, 0.05, 0.3);
        size = 0.3;
        break;
      default:
        color = new Color3(1, 1, 1);
        emissive = new Color3(0.5, 0.5, 0.5);
    }

    const mesh = MeshBuilder.CreateSphere(`proj_${proj.id}`, { diameter: size * 2, segments: 6 }, this.scene);
    mesh.position.set(proj.pos.x, proj.pos.y, proj.pos.z);
    const mat = new PBRMaterial(`projMat_${proj.id}`, this.scene);
    mat.albedoColor = color;
    mat.emissiveColor = emissive;
    mat.metallic = 0.8;
    mat.roughness = 0.2;
    mesh.material = mat;

    this.projectileMeshes.set(proj.id, {
      mesh,
      vel: { ...proj.vel },
      spawnTime: performance.now(),
      type: proj.type,
    });
  }

  updateProjectiles(dt: number): void {
    const now = performance.now();
    const toRemove: number[] = [];

    for (const [id, proj] of this.projectileMeshes) {
      // Client-side extrapolation between snapshots
      proj.mesh.position.x += proj.vel.x * dt;
      proj.mesh.position.y += proj.vel.y * dt;
      proj.mesh.position.z += proj.vel.z * dt;
      proj.vel.y -= 20 * 0.15 * dt; // Match server gravity scale

      // Cleanup old projectiles
      if (now - proj.spawnTime > 4000 || proj.mesh.position.y < -1) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      const proj = this.projectileMeshes.get(id);
      if (proj) {
        proj.mesh.dispose();
        this.projectileMeshes.delete(id);
      }
    }

    // Cleanup damage numbers
    const dnToRemove: number[] = [];
    for (let i = 0; i < this.damageNumbers.length; i++) {
      const dn = this.damageNumbers[i];
      const age = (now - dn.startTime) / 1000;
      if (age > 1.5) {
        dn.mesh.dispose();
        dnToRemove.push(i);
      } else {
        dn.mesh.position.y = dn.startY + age * 2;
        dn.mesh.visibility = 1 - (age / 1.5);
      }
    }
    for (let i = dnToRemove.length - 1; i >= 0; i--) {
      this.damageNumbers.splice(dnToRemove[i], 1);
    }
  }

  showDamageNumber(targetType: DamageTargetType, targetId: number, damage: number): void {
    let pos: Vector3 | null = null;

    if (targetType === DamageTargetType.Player) {
      const mesh = this.playerMeshes.get(targetId);
      if (mesh) pos = mesh.position.clone();
    } else if (targetType === DamageTargetType.Enemy) {
      const mesh = this.enemyMeshes.get(targetId);
      if (mesh) pos = mesh.position.clone();
    } else if (targetType === DamageTargetType.Boss && this.bossMesh) {
      pos = this.bossMesh.position.clone();
    }

    if (!pos) return;

    pos.y += 2.5 + Math.random() * 0.5;
    pos.x += (Math.random() - 0.5) * 0.5;

    // Simple damage number using a small plane with text texture
    const plane = MeshBuilder.CreatePlane(`dmg_${Date.now()}`, { size: 1 }, this.scene);
    plane.position.copyFrom(pos);
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    const mat = new StandardMaterial(`dmgMat_${Date.now()}`, this.scene);
    mat.emissiveColor = targetType === DamageTargetType.Player ? new Color3(1, 0.2, 0.2) : new Color3(1, 0.8, 0.2);
    mat.disableLighting = true;
    mat.alpha = 1;
    plane.material = mat;
    plane.scaling.setAll(0.5 + (damage / 50) * 0.5);

    this.damageNumbers.push({ mesh: plane, startTime: performance.now(), startY: pos.y });
  }
}

// Seeded RNG for consistent tree placement
function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
