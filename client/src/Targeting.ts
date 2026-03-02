// ── Ayodhya Protocol: Lanka Reforged ── Soft-Lock Targeting System ──
// Each frame, enemy world positions are projected to screen space.
// The nearest enemy within MAX_LOCK_PX of screen centre is "locked".
// The crosshair lerps 25 % of the way toward the lock, and a spinning
// diamond reticle tracks directly on top of the target.

import { Scene, Vector3, Matrix, Viewport } from '@babylonjs/core';
import { EnemyState, BossState, EnemyAIState, BossPhase, Vec3 } from '@shared/types';

export interface TargetInfo {
  worldPos: Vec3;
  screenX: number;
  screenY: number;
}

export class Targeting {
  private scene: Scene;
  private canvas: HTMLCanvasElement;
  private crosshairEl: HTMLElement;
  private reticleEl: HTMLElement;

  private currentTarget: TargetInfo | null = null;

  // Smoothed screen position of the reticle
  private reticleX = 0;
  private reticleY = 0;
  // Smoothed screen position of the crosshair
  private crossX = 0;
  private crossY = 0;
  // Spin angle for the diamond reticle (degrees)
  private rotAngle = 45;

  /** Max pixel radius from screen centre for a target to be lockable */
  private readonly MAX_LOCK_PX = 260;
  /** Lerp speed (higher = snappier tracking) */
  private readonly LERP_SPEED = 12;

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.scene = scene;
    this.canvas = canvas;

    const ch = document.getElementById('crosshair');
    const rt = document.getElementById('targetReticle');
    if (!ch || !rt) throw new Error('Targeting: missing DOM elements #crosshair / #targetReticle');
    this.crosshairEl = ch;
    this.reticleEl = rt;

    // Initialise smoothed positions to screen centre
    this.crossX = canvas.clientWidth / 2;
    this.crossY = canvas.clientHeight / 2;
    this.reticleX = this.crossX;
    this.reticleY = this.crossY;
  }

  /**
   * Call once per frame.
   * Returns the locked TargetInfo or null when nothing is in range.
   */
  update(enemies: EnemyState[], boss: BossState | null, dt: number): TargetInfo | null {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return null;

    const cx = w / 2;
    const cy = h / 2;

    if (!this.scene.activeCamera) return null;

    // Use client (CSS) dimensions so projected coordinates match DOM pixel positions
    const transform = this.scene.getTransformMatrix();
    const viewport = new Viewport(0, 0, w, h);

    let bestDist = this.MAX_LOCK_PX;
    let bestTarget: TargetInfo | null = null;

    // ── Enemies ──────────────────────────────────────────────────────
    for (const e of enemies) {
      if (e.aiState === EnemyAIState.Dead) continue;
      // Aim at chest height (1.0 u above capsule base)
      const wp = new Vector3(e.pos.x, e.pos.y + 1.0, e.pos.z);
      const sp = Vector3.Project(wp, Matrix.Identity(), transform, viewport);
      if (sp.z < 0 || sp.z > 1) continue;          // behind camera / clipped

      const dist = Math.hypot(sp.x - cx, sp.y - cy);
      if (dist < bestDist) {
        bestDist = dist;
        bestTarget = {
          worldPos: { x: e.pos.x, y: e.pos.y + 1.0, z: e.pos.z },
          screenX: sp.x,
          screenY: sp.y,
        };
      }
    }

    // ── Boss ──────────────────────────────────────────────────────────
    if (boss && boss.phase !== BossPhase.Dead && boss.phase !== BossPhase.Idle) {
      const wp = new Vector3(boss.pos.x, boss.pos.y + 2.8, boss.pos.z);
      const sp = Vector3.Project(wp, Matrix.Identity(), transform, viewport);
      if (sp.z >= 0 && sp.z <= 1) {
        const dist = Math.hypot(sp.x - cx, sp.y - cy);
        if (dist < bestDist) {
          bestDist = dist;
          bestTarget = {
            worldPos: { x: boss.pos.x, y: boss.pos.y + 2.8, z: boss.pos.z },
            screenX: sp.x,
            screenY: sp.y,
          };
        }
      }
    }

    this.currentTarget = bestTarget;

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const lf = Math.min(1, dt * this.LERP_SPEED);

    if (bestTarget) {
      // Crosshair drifts 28 % toward the locked target
      this.crossX = lerp(this.crossX, cx + (bestTarget.screenX - cx) * 0.28, lf);
      this.crossY = lerp(this.crossY, cy + (bestTarget.screenY - cy) * 0.28, lf);

      // Reticle tracks directly on the locked target
      this.reticleX = lerp(this.reticleX, bestTarget.screenX, lf);
      this.reticleY = lerp(this.reticleY, bestTarget.screenY, lf);

      // Spin the diamond  (80 °/s)
      this.rotAngle += dt * 80;

      this._applyCrosshair(this.crossX, this.crossY);
      this.reticleEl.style.display = 'block';
      this.reticleEl.style.left = `${this.reticleX}px`;
      this.reticleEl.style.top = `${this.reticleY}px`;
      this.reticleEl.style.transform = `translate(-50%,-50%) rotate(${this.rotAngle}deg)`;
    } else {
      // Ease crosshair back to centre
      this.crossX = lerp(this.crossX, cx, lf);
      this.crossY = lerp(this.crossY, cy, lf);
      this._applyCrosshair(this.crossX, this.crossY);
      this.reticleEl.style.display = 'none';
    }

    return bestTarget;
  }

  /** World position the player should aim toward when locked on. */
  getAimWorldPos(): Vec3 | null {
    return this.currentTarget ? { ...this.currentTarget.worldPos } : null;
  }

  private _applyCrosshair(x: number, y: number): void {
    this.crosshairEl.style.left = `${x}px`;
    this.crosshairEl.style.top = `${y}px`;
    this.crosshairEl.style.transform = 'translate(-50%,-50%)';
  }
}
