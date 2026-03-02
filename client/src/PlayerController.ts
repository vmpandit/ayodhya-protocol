// ── Ayodhya Protocol: Lanka Reforged ── Player Input & Prediction ──
// Supports both keyboard/mouse and full touch controls (iPhone/mobile).

import { FreeCamera, Vector3 } from '@babylonjs/core';
import { PlayerInput, PlayerState, InputFlag, Vec3, AbilityType } from '@shared/types';
import * as C from '@shared/constants';

interface PendingAbility {
  type: AbilityType;
  dir: Vec3;
}

export class PlayerController {
  private canvas: HTMLCanvasElement;
  private camera: FreeCamera;

  // ── Keyboard state ──
  private keys = new Set<string>();
  private mouseDown = false;
  private chargeStart = 0;

  // ── Shared state ──
  private yaw = 0;
  private pitch = 0;
  private seq = 0;
  private pendingInputs: PlayerInput[] = [];
  private predictedPos: Vec3 = { x: 0, y: 1, z: 0 };
  private predictedVelY = 0;
  private pendingAbility: PendingAbility | null = null;
  private fireArrowCdEnd = 0;
  private shockwaveCdEnd = 0;
  private reviving = false;

  // ── Soft-lock targeting ──
  private targetLockPos: Vec3 | null = null;
  private localPlayerPos: Vec3 = { x: 0, y: 0, z: 0 };

  // ── Smooth movement velocity (used for client-side prediction feel) ──
  private moveVelX = 0;
  private moveVelZ = 0;

  // ── Camera shake ──
  private shakeAmount = 0;
  private readonly SHAKE_DECAY = 9;

  // ── Camera ──
  private cameraDistance = 12;
  private cameraHeight = 5;
  private cameraSmoothPos = new Vector3(0, 5, -12);

  // ── Touch state ──
  public readonly isTouch: boolean;
  private joystickActive = false;
  private joystickTouchId = -1;
  private joystickOriginX = 0;
  private joystickOriginY = 0;
  private joystickDx = 0;
  private joystickDy = 0;
  private cameraTouchId = -1;
  private cameraTouchLastX = 0;
  private cameraTouchLastY = 0;
  private touchFlags = 0;
  private touchShootTapped = false;

  constructor(canvas: HTMLCanvasElement, camera: FreeCamera) {
    this.canvas = canvas;
    this.camera = camera;
    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    this.bindKeyboardEvents();
    if (this.isTouch) {
      this.bindTouchEvents();
      document.getElementById('touchControls')?.classList.add('visible');
      this.cameraDistance = 8;
      this.cameraHeight = 3.5;
    }
  }

  // ══════════════════════════════════════════════
  //  KEYBOARD + MOUSE
  // ══════════════════════════════════════════════
  private bindKeyboardEvents(): void {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyQ') this.tryFireArrow();
      if (e.code === 'KeyE') this.tryShockwave();
      if (e.code === 'KeyR') this.reviving = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyR') this.reviving = false;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouseDown = true; this.chargeStart = performance.now(); }
    });
    this.canvas.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === this.canvas) {
        document.addEventListener('mousemove', this.onMouseMove);
      } else {
        document.removeEventListener('mousemove', this.onMouseMove);
      }
    });
  }

  private onMouseMove = (e: MouseEvent): void => {
    const sensitivity = 0.002;
    this.yaw -= e.movementX * sensitivity;
    this.pitch -= e.movementY * sensitivity;
    this.pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.pitch));
  };

  // ══════════════════════════════════════════════
  //  TOUCH
  // ══════════════════════════════════════════════
  private bindTouchEvents(): void {
    const joystickZone = document.getElementById('joystickZone')!;
    const joystickKnob = document.getElementById('joystickKnob')!;
    const maxR = 50;

    joystickZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this.joystickActive = true;
      this.joystickTouchId = t.identifier;
      const rect = joystickZone.getBoundingClientRect();
      this.joystickOriginX = rect.left + rect.width / 2;
      this.joystickOriginY = rect.top + rect.height / 2;
      this.joystickDx = 0;
      this.joystickDy = 0;
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === this.joystickTouchId) {
          let dx = t.clientX - this.joystickOriginX;
          let dy = t.clientY - this.joystickOriginY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > maxR) { dx = (dx / dist) * maxR; dy = (dy / dist) * maxR; }
          this.joystickDx = dx / maxR;
          this.joystickDy = dy / maxR;
          joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        }
        if (t.identifier === this.cameraTouchId) {
          const dx = t.clientX - this.cameraTouchLastX;
          const dy = t.clientY - this.cameraTouchLastY;
          this.cameraTouchLastX = t.clientX;
          this.cameraTouchLastY = t.clientY;
          this.yaw -= dx * 0.005;
          this.pitch -= dy * 0.005;
          this.pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.pitch));
        }
      }
    }, { passive: false });

    window.addEventListener('touchend', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === this.joystickTouchId) {
          this.joystickActive = false;
          this.joystickTouchId = -1;
          this.joystickDx = 0;
          this.joystickDy = 0;
          joystickKnob.style.transform = 'translate(-50%, -50%)';
        }
        if (t.identifier === this.cameraTouchId) {
          this.cameraTouchId = -1;
        }
      }
    });

    // Camera look: any touch on the canvas (right area)
    this.canvas.addEventListener('touchstart', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.clientX > window.innerWidth * 0.35 && this.cameraTouchId === -1) {
          this.cameraTouchId = t.identifier;
          this.cameraTouchLastX = t.clientX;
          this.cameraTouchLastY = t.clientY;
        }
      }
    }, { passive: true });

    // Action buttons
    this.bindTouchButton('btnShoot', () => { this.touchShootTapped = true; });
    this.bindTouchButton('btnJump', () => { this.touchFlags |= InputFlag.Jump; }, () => { this.touchFlags &= ~InputFlag.Jump; });
    this.bindTouchButton('btnDodge', () => { this.touchFlags |= InputFlag.Dodge; }, () => { this.touchFlags &= ~InputFlag.Dodge; });
    this.bindTouchButton('btnSprint', () => { this.touchFlags |= InputFlag.Sprint; }, () => { this.touchFlags &= ~InputFlag.Sprint; });
    this.bindTouchButton('btnFire', () => { this.tryFireArrow(); });
    this.bindTouchButton('btnShockwave', () => { this.tryShockwave(); });
  }

  private bindTouchButton(id: string, onDown: () => void, onUp?: () => void): void {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation(); onDown();
      el.style.opacity = '0.6';
    }, { passive: false });
    el.addEventListener('touchend', (e) => {
      e.preventDefault(); e.stopPropagation(); if (onUp) onUp();
      el.style.opacity = '1';
    }, { passive: false });
    el.addEventListener('touchcancel', () => { if (onUp) onUp(); el.style.opacity = '1'; });
  }

  // ══════════════════════════════════════════════
  //  ABILITIES
  // ══════════════════════════════════════════════
  private tryFireArrow(): void {
    const now = performance.now();
    if (now >= this.fireArrowCdEnd) {
      this.pendingAbility = { type: AbilityType.FireArrow, dir: this.getAimDirection() };
      this.fireArrowCdEnd = now + C.FIRE_ARROW_COOLDOWN_MS;
    }
  }

  private tryShockwave(): void {
    const now = performance.now();
    if (now >= this.shockwaveCdEnd) {
      this.pendingAbility = { type: AbilityType.Shockwave, dir: this.getAimDirection() };
      this.shockwaveCdEnd = now + C.SHOCKWAVE_COOLDOWN_MS;
    }
  }

  // ══════════════════════════════════════════════
  //  INPUT FRAME
  // ══════════════════════════════════════════════
  getInput(dt: number): PlayerInput | null {
    let flags = 0;

    if (this.isTouch) {
      const dz = 0.15;
      if (this.joystickActive) {
        if (this.joystickDy < -dz) flags |= InputFlag.Forward;
        if (this.joystickDy > dz) flags |= InputFlag.Backward;
        if (this.joystickDx < -dz) flags |= InputFlag.Left;
        if (this.joystickDx > dz) flags |= InputFlag.Right;
      }
      flags |= this.touchFlags;
    } else {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) flags |= InputFlag.Forward;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) flags |= InputFlag.Backward;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) flags |= InputFlag.Left;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) flags |= InputFlag.Right;
      if (this.keys.has('Space')) flags |= InputFlag.Jump;
      if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) flags |= InputFlag.Sprint;
      if (this.keys.has('ControlLeft') || this.keys.has('KeyC')) flags |= InputFlag.Dodge;
    }

    let chargeMs = 0;
    if (this.touchShootTapped) {
      chargeMs = C.BOW_MAX_CHARGE_MS * 0.6;
      flags |= InputFlag.Shoot;
      this.touchShootTapped = false;
    }
    if (!this.mouseDown && this.chargeStart > 0) {
      chargeMs = Math.min(C.BOW_MAX_CHARGE_MS, performance.now() - this.chargeStart);
      if (chargeMs >= C.BOW_MIN_CHARGE_MS) flags |= InputFlag.Shoot;
      this.chargeStart = 0;
    }

    const input: PlayerInput = { seq: ++this.seq, flags, yaw: this.yaw, pitch: this.pitch, chargeMs, dt };
    this.pendingInputs.push(input);
    return input;
  }

  // ══════════════════════════════════════════════
  //  PREDICTION
  // ══════════════════════════════════════════════
  predict(input: PlayerInput): void {
    const flags = input.flags;
    const sinY = Math.sin(input.yaw);
    const cosY = Math.cos(input.yaw);

    let targetX = 0, targetZ = 0;
    if (this.isTouch && this.joystickActive) {
      targetX = -this.joystickDx * cosY - this.joystickDy * sinY;
      targetZ = this.joystickDx * sinY - this.joystickDy * cosY;
    } else {
      if (flags & InputFlag.Forward)  { targetX -= sinY; targetZ -= cosY; }
      if (flags & InputFlag.Backward) { targetX += sinY; targetZ += cosY; }
      if (flags & InputFlag.Left)     { targetX -= cosY; targetZ += sinY; }
      if (flags & InputFlag.Right)    { targetX += cosY; targetZ -= sinY; }
      const len = Math.sqrt(targetX * targetX + targetZ * targetZ);
      if (len > 0) { targetX /= len; targetZ /= len; }
    }

    let speed = C.PLAYER_SPEED;
    if (flags & InputFlag.Sprint) speed *= C.SPRINT_MULTIPLIER;

    // Smooth acceleration / deceleration — gives movement a physical weight
    const accel  = flags & InputFlag.Sprint ? 16 : 13;
    const decel  = 11;
    const hasInput = targetX !== 0 || targetZ !== 0;
    const lf = Math.min(1, input.dt * (hasInput ? accel : decel));
    this.moveVelX += (targetX * speed - this.moveVelX) * lf;
    this.moveVelZ += (targetZ * speed - this.moveVelZ) * lf;

    this.predictedPos.x += this.moveVelX * input.dt;
    this.predictedPos.z += this.moveVelZ * input.dt;
  }

  reconcile(serverState: PlayerState): void {
    this.pendingInputs = this.pendingInputs.filter(i => i.seq > serverState.lastProcessedSeq);
    this.predictedPos = { ...serverState.pos };
    this.predictedVelY = serverState.vel.y;
    // Reset smoothed velocity so re-replayed inputs build it from scratch
    this.moveVelX = 0;
    this.moveVelZ = 0;
    for (const input of this.pendingInputs) this.predict(input);
  }

  /** Trigger a camera shake of the given intensity (world units). */
  triggerShake(intensity: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, intensity);
  }

  updateCamera(playerState: PlayerState, dt: number): void {
    this.reconcile(playerState);

    const targetX = this.predictedPos.x;
    const targetY = this.predictedPos.y + 1.5;
    const targetZ = this.predictedPos.z;

    const camX = targetX + Math.sin(this.yaw) * this.cameraDistance * Math.cos(this.pitch * 0.5);
    const camY = targetY + this.cameraHeight + Math.sin(-this.pitch) * this.cameraDistance * 0.3;
    const camZ = targetZ + Math.cos(this.yaw) * this.cameraDistance * Math.cos(this.pitch * 0.5);

    const smoothing = 1 - Math.pow(0.001, dt);
    this.cameraSmoothPos.x += (camX - this.cameraSmoothPos.x) * smoothing;
    this.cameraSmoothPos.y += (camY - this.cameraSmoothPos.y) * smoothing;
    this.cameraSmoothPos.z += (camZ - this.cameraSmoothPos.z) * smoothing;

    this.camera.position.copyFrom(this.cameraSmoothPos);

    // ── Camera shake (decays exponentially) ──────────────────────────
    if (this.shakeAmount > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmount;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmount * 0.4;
      this.camera.position.z += (Math.random() - 0.5) * this.shakeAmount;
      this.shakeAmount *= Math.max(0, 1 - dt * this.SHAKE_DECAY);
      if (this.shakeAmount < 0.002) this.shakeAmount = 0;
    }

    // ── FOV: narrow when target-locked (aim-down-sight feel) ─────────
    const targetFov = this.targetLockPos ? 0.88 : 1.05;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 5);

    this.camera.setTarget(new Vector3(targetX, targetY, targetZ));

    // Charge ring (desktop only)
    const chargeRing = document.getElementById('chargeRing')!;
    if (this.mouseDown && this.chargeStart > 0) {
      const elapsed = performance.now() - this.chargeStart;
      const pct = Math.min(1, elapsed / C.BOW_MAX_CHARGE_MS);
      chargeRing.classList.add('active');
      chargeRing.style.transform = `translate(-50%, -50%) rotate(${pct * 360}deg)`;
      chargeRing.style.borderTopColor = pct >= 1 ? '#ff4444' : '#ffd700';
    } else {
      chargeRing.classList.remove('active');
    }
  }

  /** Called each frame by Game.ts with the current target world position. */
  setTargetLock(worldPos: Vec3 | null, playerPos: Vec3): void {
    this.targetLockPos = worldPos;
    this.localPlayerPos = playerPos;
  }

  private getAimDirection(): Vec3 {
    if (this.targetLockPos) {
      // Aim toward locked target from player eye height
      const eyeY = this.localPlayerPos.y + 1.35;
      const dx = this.targetLockPos.x - this.localPlayerPos.x;
      const dy = this.targetLockPos.y - eyeY;
      const dz = this.targetLockPos.z - this.localPlayerPos.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len > 0.01) return { x: dx / len, y: dy / len, z: dz / len };
    }
    // No lock — use yaw/pitch from mouse/touch
    return {
      x: -Math.sin(this.yaw) * Math.cos(this.pitch),
      y: Math.sin(this.pitch),
      z: -Math.cos(this.yaw) * Math.cos(this.pitch),
    };
  }

  consumeAbility(): PendingAbility | null { const a = this.pendingAbility; this.pendingAbility = null; return a; }
  isReviving(): boolean { return this.reviving; }
  getFireArrowCd(): number { return Math.max(0, this.fireArrowCdEnd - performance.now()) / C.FIRE_ARROW_COOLDOWN_MS; }
  getShockwaveCd(): number { return Math.max(0, this.shockwaveCdEnd - performance.now()) / C.SHOCKWAVE_COOLDOWN_MS; }
}
