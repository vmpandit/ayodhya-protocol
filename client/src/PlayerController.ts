// ── Ayodhya Protocol: Lanka Reforged ── Player Input & Prediction ──
// Supports both keyboard/mouse and full touch controls (iPhone/mobile).

import { FreeCamera, Vector3 } from '@babylonjs/core';
import { PlayerInput, PlayerState, InputFlag, Vec3, AbilityType, SpecialArrowType } from '@shared/types';
import * as C from '@shared/constants';

interface PendingAbility {
  type: AbilityType;
  dir: Vec3;
}

/** Shortest-path angle interpolation (handles wrapping). */
function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export class PlayerController {
  private canvas: HTMLCanvasElement;
  private camera: FreeCamera;

  // ── Keyboard state ──
  private keys = new Set<string>();
  private rightMouseDown = false;
  private rightMouseDragged = false;

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

  // ── Special arrow system ──
  private selectedSpecialArrow: SpecialArrowType = 0; // 0 = AgniAstra
  private specialArrowCdEnd: { [key in SpecialArrowType]: number } = {
    0: 0, // AgniAstra
    1: 0, // VayuAstra
    2: 0, // VarunaAstra
    3: 0, // NagaAstra
    4: 0, // BrahmaAstra
  };

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

  // ── Mouse position tracking for free-cursor aiming ──
  private mouseScreenX = 0;
  private mouseScreenY = 0;

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

  // ── Mobile tap-to-fire ──
  /** Start time of camera touch for tap detection */
  private cameraTouchStartTime = 0;
  private cameraTouchStartX = 0;
  private cameraTouchStartY = 0;
  /** One-shot aim override from a screen tap (consumed by getAimDirection) */
  private tapAimDir: Vec3 | null = null;

  // ── Free-aim visual yaw (PC) ──
  /** The character mesh facing direction — decoupled from camera yaw */
  private visualYaw = 0;
  /** Last frame's input flags for visual yaw logic */
  private lastInputFlags = 0;

  // ── Meditation & Lakshman choice & Talk & Map ──
  private meditatePressed = false;
  public lakshmanKeyPressed: 'Y' | 'N' | null = null;
  private talkPressed = false;
  private mapTogglePressed = false;

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
      if (e.code === 'KeyQ') this.touchShootTapped = true; // Q = basic arrow (instant)
      if (e.code === 'KeyE') this.tryShockwave();
      if (e.code === 'KeyR') this.reviving = true;
      if (e.code === 'Digit1') this.selectSpecialArrow(0); // AgniAstra
      if (e.code === 'Digit2') this.selectSpecialArrow(1); // VayuAstra
      if (e.code === 'Digit3') this.selectSpecialArrow(2); // VarunaAstra
      if (e.code === 'Digit4') this.selectSpecialArrow(3); // NagaAstra
      if (e.code === 'Digit5') this.selectSpecialArrow(4); // BrahmaAstra
      if (e.code === 'KeyV') this.meditatePressed = true;
      if (e.code === 'KeyF') this.talkPressed = true;
      if (e.code === 'KeyM') this.mapTogglePressed = true;
      if (e.code === 'KeyY') this.lakshmanKeyPressed = 'Y';
      if (e.code === 'KeyN') this.lakshmanKeyPressed = 'N';
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyR') this.reviving = false;
    });

    // Mouse move: track position for free-cursor aiming
    this.canvas.addEventListener('mousemove', (e) => {
      this.mouseScreenX = e.clientX;
      this.mouseScreenY = e.clientY;

      // Pointer-locked mode: mouse always rotates camera (standard FPS)
      if (document.pointerLockElement === this.canvas) {
        this.yaw -= e.movementX * 0.003;
        this.pitch -= e.movementY * 0.003;
        this.pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.pitch));
        // Keep crosshair centered when pointer locked
        this.mouseScreenX = this.canvas.clientWidth / 2;
        this.mouseScreenY = this.canvas.clientHeight / 2;
      } else if (this.rightMouseDown) {
        // Right-click drag rotates camera (fallback for non-locked mode)
        this.yaw -= e.movementX * 0.003;
        this.pitch -= e.movementY * 0.003;
        this.pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.pitch));
        if (Math.abs(e.movementX) > 2 || Math.abs(e.movementY) > 2) {
          this.rightMouseDragged = true;
        }
      }
    });

    // Click canvas to lock pointer (standard FPS camera control)
    this.canvas.addEventListener('click', () => {
      if (!document.pointerLockElement) {
        this.canvas.requestPointerLock();
      }
    });

    // ESC exits pointer lock (handled by browser), track state
    document.addEventListener('pointerlockchange', () => {
      // Update crosshair visibility based on lock state
      const crosshair = document.getElementById('crosshair');
      if (crosshair) {
        if (document.pointerLockElement === this.canvas) {
          crosshair.style.left = '50%';
          crosshair.style.top = '50%';
          crosshair.style.opacity = '1';
        } else {
          // Pointer lock lost (ESC pressed or another reason)
          crosshair.style.opacity = '0.5';
          // Show a note: "Click to resume"
          const note = document.getElementById('pointerLockNote');
          if (note) {
            note.style.display = 'block';
            note.style.opacity = '1';
          }
        }
      }
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        // Only fire if pointer is already locked (otherwise the click was to lock)
        if (document.pointerLockElement === this.canvas) {
          this.touchShootTapped = true; // Left-click = basic arrow
        }
      }
      if (e.button === 2) {
        // Right-click: do NOT request pointer lock, just set flag
        this.rightMouseDown = true;
      }
    });
    this.canvas.addEventListener('mouseup', (e) => {
      if (e.button === 2) {
        this.rightMouseDown = false;
        // Only fire special if we didn't drag much
        if (!this.rightMouseDragged) this.trySpecialArrow();
        this.rightMouseDragged = false;
      }
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1 : -1;
      const newSelect = (this.selectedSpecialArrow + delta + 5) % 5;
      this.selectSpecialArrow(newSelect as SpecialArrowType);
    });
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // On Mac trackpads, two-finger tap fires contextmenu but mousedown/mouseup with button=2 may not fire
      // Treat contextmenu as a right-click for special arrow
      if (!this.rightMouseDragged) {
        this.trySpecialArrow();
      }
    });
  }

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
          // Track tap timing for tap-to-fire
          this.cameraTouchStartTime = performance.now();
          this.cameraTouchStartX = t.clientX;
          this.cameraTouchStartY = t.clientY;
        }
      }
    }, { passive: true });

    // Tap-to-fire: short touch on right side fires toward that screen point
    this.canvas.addEventListener('touchend', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === this.cameraTouchId) {
          const elapsed = performance.now() - this.cameraTouchStartTime;
          const dx = t.clientX - this.cameraTouchStartX;
          const dy = t.clientY - this.cameraTouchStartY;
          const moved = Math.sqrt(dx * dx + dy * dy);
          // Short tap (<300ms, <15px drift) → fire toward that screen point
          if (elapsed < 300 && moved < 15) {
            this.tapAimDir = this.screenPointToAimDir(t.clientX, t.clientY);
            this.touchShootTapped = true;
          }
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

  private selectSpecialArrow(type: SpecialArrowType): void {
    this.selectedSpecialArrow = type;
  }

  private trySpecialArrow(): void {
    const now = performance.now();
    const selectedType = this.selectedSpecialArrow;
    if (now >= this.specialArrowCdEnd[selectedType]) {
      // Map SpecialArrowType (0-4) to AbilityType constants
      const abilityTypeMap: { [key in SpecialArrowType]: AbilityType } = {
        0: AbilityType.FireArrow,
        1: AbilityType.VayuAstra,
        2: AbilityType.VarunaAstra,
        3: AbilityType.NagaAstra,
        4: AbilityType.BrahmaAstra,
      };
      this.pendingAbility = { type: abilityTypeMap[selectedType], dir: this.getAimDirection() };
      // Set cooldown (cooldown values should be defined in constants)
      const cooldownMap: { [key in SpecialArrowType]: number } = {
        0: C.FIRE_ARROW_COOLDOWN_MS,
        1: C.VAYU_ASTRA_COOLDOWN_MS,
        2: C.VARUNA_ASTRA_COOLDOWN_MS,
        3: C.NAGA_ASTRA_COOLDOWN_MS,
        4: C.BRAHMA_ASTRA_COOLDOWN_MS,
      };
      this.specialArrowCdEnd[selectedType] = now + cooldownMap[selectedType];
    }
  }

  /**
   * Convert a screen tap position to an aim direction vector (from the player).
   * Uses the camera's FOV to compute angular offset from screen centre.
   */
  private screenPointToAimDir(sx: number, sy: number): Vec3 {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    const cx = cw / 2;
    const cy = ch / 2;

    const vFov = this.camera.fov;
    const aspect = cw / ch;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

    const yawOffset  = -((sx - cx) / cx) * (hFov / 2);
    const pitchOffset = -((sy - cy) / cy) * (vFov / 2);

    const tapYaw   = this.yaw + yawOffset;
    const tapPitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.pitch + pitchOffset));

    return {
      x: -Math.sin(tapYaw) * Math.cos(tapPitch),
      y:  Math.sin(tapPitch),
      z: -Math.cos(tapYaw) * Math.cos(tapPitch),
    };
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

    if (this.touchShootTapped) {
      flags |= InputFlag.Shoot;
      this.touchShootTapped = false;
    }

    if (this.meditatePressed) {
      flags |= InputFlag.Meditate;
      this.meditatePressed = false;
    }

    if (this.talkPressed) {
      flags |= InputFlag.Talk;
      this.talkPressed = false;
    }

    this.lastInputFlags = flags;
    const input: PlayerInput = { seq: ++this.seq, flags, yaw: this.yaw, pitch: this.pitch, chargeMs: 0, dt, aimDir: this.getAimDirection() };
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
      if (flags & InputFlag.Left)     { targetX += cosY; targetZ -= sinY; }
      if (flags & InputFlag.Right)    { targetX -= cosY; targetZ += sinY; }
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

    // ── Update visual yaw (character facing — decoupled from camera) ──
    this.updateVisualYaw(dt);

    // ── Update crosshair position (free cursor, not locked to center) ──
    const crosshair = document.getElementById('crosshair');
    if (crosshair && !this.isTouch) {
      crosshair.style.left = `${this.mouseScreenX}px`;
      crosshair.style.top = `${this.mouseScreenY}px`;
    }
  }

  /** Called each frame by Game.ts with the current target world position. */
  setTargetLock(worldPos: Vec3 | null, playerPos: Vec3): void {
    this.targetLockPos = worldPos;
    this.localPlayerPos = playerPos;
  }

  private getAimDirection(): Vec3 {
    // ── Mobile tap-to-fire override (consumed once) ──
    if (this.tapAimDir) {
      const dir = this.tapAimDir;
      this.tapAimDir = null;
      return dir;
    }
    if (this.targetLockPos) {
      // Aim toward locked target from player eye height
      const eyeY = this.localPlayerPos.y + 1.35;
      const dx = this.targetLockPos.x - this.localPlayerPos.x;
      const dy = this.targetLockPos.y - eyeY;
      const dz = this.targetLockPos.z - this.localPlayerPos.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len > 0.01) return { x: dx / len, y: dy / len, z: dz / len };
    }
    // Free-cursor aim: compute direction from screen mouse position
    return this.screenPointToAimDir(this.mouseScreenX, this.mouseScreenY);
  }

  consumeAbility(): PendingAbility | null { const a = this.pendingAbility; this.pendingAbility = null; return a; }
  isReviving(): boolean { return this.reviving; }
  getFireArrowCd(): number { return Math.max(0, this.fireArrowCdEnd - performance.now()) / C.FIRE_ARROW_COOLDOWN_MS; }
  getShockwaveCd(): number { return Math.max(0, this.shockwaveCdEnd - performance.now()) / C.SHOCKWAVE_COOLDOWN_MS; }
  getSelectedSpecialArrow(): SpecialArrowType { return this.selectedSpecialArrow; }
  getSpecialCooldown(type: SpecialArrowType): number {
    const cooldownMap: { [key in SpecialArrowType]: number } = {
      0: C.FIRE_ARROW_COOLDOWN_MS,
      1: C.VAYU_ASTRA_COOLDOWN_MS,
      2: C.VARUNA_ASTRA_COOLDOWN_MS,
      3: C.NAGA_ASTRA_COOLDOWN_MS,
      4: C.BRAHMA_ASTRA_COOLDOWN_MS,
    };
    return Math.max(0, this.specialArrowCdEnd[type] - performance.now()) / cooldownMap[type];
  }

  // ══════════════════════════════════════════════
  //  VISUAL YAW (character facing, decoupled from camera)
  // ══════════════════════════════════════════════

  /**
   * Update the visual yaw so the character mesh faces:
   * - Movement direction when moving (WASD / joystick)
   * - Aim direction when right-click held or firing
   * - Current facing when idle (camera can orbit freely)
   */
  private updateVisualYaw(dt: number): void {
    const flags = this.lastInputFlags;
    const isMoving = (flags & (InputFlag.Forward | InputFlag.Backward | InputFlag.Left | InputFlag.Right)) !== 0;
    const isFiring = this.rightMouseDown || (flags & InputFlag.Shoot) !== 0;

    const isSprinting = (flags & InputFlag.Sprint) !== 0;
    if (isFiring || isSprinting) {
      // Snap toward aim direction while right-click held, firing, or sprinting
      this.visualYaw = lerpAngle(this.visualYaw, this.yaw, Math.min(1, dt * 18));
    } else if (isMoving) {
      // Face movement direction
      const sinY = Math.sin(this.yaw);
      const cosY = Math.cos(this.yaw);
      let tx = 0, tz = 0;

      if (this.isTouch && this.joystickActive) {
        tx = -this.joystickDx * cosY - this.joystickDy * sinY;
        tz =  this.joystickDx * sinY - this.joystickDy * cosY;
      } else {
        if (flags & InputFlag.Forward)  { tx -= sinY; tz -= cosY; }
        if (flags & InputFlag.Backward) { tx += sinY; tz += cosY; }
        if (flags & InputFlag.Left)     { tx += cosY; tz -= sinY; }
        if (flags & InputFlag.Right)    { tx -= cosY; tz += sinY; }
      }

      if (tx !== 0 || tz !== 0) {
        const moveAngle = Math.atan2(-tx, -tz);
        this.visualYaw = lerpAngle(this.visualYaw, moveAngle, Math.min(1, dt * 12));
      }
    }
    // Idle → keep current visualYaw (camera can orbit without character spinning)
  }

  /** Character facing yaw for local player mesh (decoupled from camera). */
  getVisualYaw(): number { return this.visualYaw; }

  /** Consume Lakshman choice keypress (Y/N). Returns null if no key pressed. */
  consumeLakshmanKey(): 'Y' | 'N' | null {
    const k = this.lakshmanKeyPressed;
    this.lakshmanKeyPressed = null;
    return k;
  }

  /** Consume Talk keypress. Returns true if F was just pressed. */
  consumeTalkKey(): boolean {
    const pressed = this.talkPressed;
    this.talkPressed = false;
    return pressed;
  }

  /** Consume Map toggle keypress. Returns true if M was just pressed. */
  consumeMapToggle(): boolean {
    const pressed = this.mapTogglePressed;
    this.mapTogglePressed = false;
    return pressed;
  }

  consumeTorchKey(): boolean {
    if (this.keys.has('KeyT')) {
      this.keys.delete('KeyT');
      return true;
    }
    return false;
  }

  consumeCampfireKey(): boolean {
    if (this.keys.has('KeyG')) {
      this.keys.delete('KeyG');
      return true;
    }
    return false;
  }
}
