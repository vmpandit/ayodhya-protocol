// ── Ayodhya Protocol: Lanka Reforged ── Gamepad Haptics & Adaptive Triggers ──
// Uses the Gamepad API's vibrationActuator for dual-rumble haptics.
// Provides a library of reusable "motifs" triggered by game events.
// Falls back gracefully when no gamepad or no haptics are available.

export const enum HapticMotif {
  // Combat
  BowDraw,
  BowRelease,
  ArrowHitEnemy,
  ArrowHitBoss,
  PlayerDamaged,
  PlayerDodge,
  ShockwaveBlast,
  FireArrowCast,
  // Movement
  FootstepSoft,
  FootstepHard,
  LandImpact,
  // Boss
  BossAoESlam,
  BossBarrage,
  BossPhaseShift,
  BossDefeated,
  // UI
  UITick,
  UIConfirm,
  GameOver,
}

interface HapticProfile {
  duration: number;       // ms
  weakMagnitude: number;  // 0-1 (high-frequency motor — right)
  strongMagnitude: number; // 0-1 (low-frequency motor — left)
  pulseCount?: number;    // repeated pulses
  pulseGap?: number;      // gap between pulses in ms
}

const HAPTIC_PROFILES: Record<HapticMotif, HapticProfile> = {
  // ── Combat ──────────────────────────────────────────────────
  [HapticMotif.BowDraw]: {
    duration: 600, weakMagnitude: 0.15, strongMagnitude: 0.35,
  },
  [HapticMotif.BowRelease]: {
    duration: 80, weakMagnitude: 0.7, strongMagnitude: 0.9,
  },
  [HapticMotif.ArrowHitEnemy]: {
    duration: 60, weakMagnitude: 0.5, strongMagnitude: 0.3,
  },
  [HapticMotif.ArrowHitBoss]: {
    duration: 100, weakMagnitude: 0.6, strongMagnitude: 0.55,
  },
  [HapticMotif.PlayerDamaged]: {
    duration: 200, weakMagnitude: 0.8, strongMagnitude: 1.0,
  },
  [HapticMotif.PlayerDodge]: {
    duration: 50, weakMagnitude: 0.25, strongMagnitude: 0.1,
  },
  [HapticMotif.ShockwaveBlast]: {
    duration: 250, weakMagnitude: 1.0, strongMagnitude: 1.0,
  },
  [HapticMotif.FireArrowCast]: {
    duration: 150, weakMagnitude: 0.6, strongMagnitude: 0.7,
  },

  // ── Movement ────────────────────────────────────────────────
  [HapticMotif.FootstepSoft]: {
    duration: 25, weakMagnitude: 0.08, strongMagnitude: 0.12,
  },
  [HapticMotif.FootstepHard]: {
    duration: 35, weakMagnitude: 0.15, strongMagnitude: 0.25,
  },
  [HapticMotif.LandImpact]: {
    duration: 80, weakMagnitude: 0.4, strongMagnitude: 0.6,
  },

  // ── Boss ────────────────────────────────────────────────────
  [HapticMotif.BossAoESlam]: {
    duration: 350, weakMagnitude: 0.9, strongMagnitude: 1.0,
  },
  [HapticMotif.BossBarrage]: {
    duration: 100, weakMagnitude: 0.4, strongMagnitude: 0.3,
    pulseCount: 4, pulseGap: 120,
  },
  [HapticMotif.BossPhaseShift]: {
    duration: 500, weakMagnitude: 0.5, strongMagnitude: 0.8,
  },
  [HapticMotif.BossDefeated]: {
    duration: 800, weakMagnitude: 0.7, strongMagnitude: 1.0,
  },

  // ── UI ──────────────────────────────────────────────────────
  [HapticMotif.UITick]: {
    duration: 15, weakMagnitude: 0.12, strongMagnitude: 0.0,
  },
  [HapticMotif.UIConfirm]: {
    duration: 40, weakMagnitude: 0.3, strongMagnitude: 0.2,
  },
  [HapticMotif.GameOver]: {
    duration: 400, weakMagnitude: 0.6, strongMagnitude: 0.9,
  },
};

export class HapticsManager {
  private gamepad: Gamepad | null = null;
  private intensityScale = 1.0;   // 0-1, for accessibility
  private enabled = true;
  private lastBowDrawTime = 0;

  // Footstep cadence tracking
  private footstepTimer = 0;
  private footstepInterval = 0.45; // seconds between footstep ticks

  constructor() {
    // Listen for gamepad connect/disconnect
    window.addEventListener('gamepadconnected', (e) => {
      console.log(`[Haptics] Gamepad connected: ${e.gamepad.id}`);
      this.gamepad = e.gamepad;
    });
    window.addEventListener('gamepaddisconnected', () => {
      console.log('[Haptics] Gamepad disconnected');
      this.gamepad = null;
    });
  }

  /** Call once per frame to refresh the gamepad reference (required by spec) */
  update(dt: number, isMoving: boolean, isSprinting: boolean): void {
    // Refresh gamepad reference (required in Chromium)
    const gamepads = navigator.getGamepads?.();
    if (gamepads) {
      for (const gp of gamepads) {
        if (gp) { this.gamepad = gp; break; }
      }
    }

    // Footstep haptics while moving
    if (isMoving) {
      this.footstepInterval = isSprinting ? 0.3 : 0.45;
      this.footstepTimer += dt;
      if (this.footstepTimer >= this.footstepInterval) {
        this.footstepTimer -= this.footstepInterval;
        this.play(isSprinting ? HapticMotif.FootstepHard : HapticMotif.FootstepSoft);
      }
    } else {
      this.footstepTimer = 0;
    }
  }

  /** Play a haptic motif (non-blocking). */
  play(motif: HapticMotif): void {
    if (!this.enabled || this.intensityScale <= 0) return;
    const profile = HAPTIC_PROFILES[motif];
    if (!profile) return;

    const gp = this.gamepad;
    if (!gp) return;

    // Use vibrationActuator (Chrome/Edge dual-rumble) or hapticActuators (Firefox)
    const actuator = (gp as any).vibrationActuator;
    if (!actuator?.playEffect) return;

    const scale = this.intensityScale;

    if (profile.pulseCount && profile.pulseCount > 1) {
      // Pulsed haptics — fire multiple short bursts
      for (let i = 0; i < profile.pulseCount; i++) {
        setTimeout(() => {
          actuator.playEffect('dual-rumble', {
            startDelay: 0,
            duration: profile.duration,
            weakMagnitude: Math.min(1, profile.weakMagnitude * scale),
            strongMagnitude: Math.min(1, profile.strongMagnitude * scale),
          }).catch(() => {});
        }, i * (profile.duration + (profile.pulseGap || 50)));
      }
    } else {
      actuator.playEffect('dual-rumble', {
        startDelay: 0,
        duration: profile.duration,
        weakMagnitude: Math.min(1, profile.weakMagnitude * scale),
        strongMagnitude: Math.min(1, profile.strongMagnitude * scale),
      }).catch(() => {});
    }
  }

  /** Start a sustained rumble for bow charging (call each frame while holding). */
  playBowDraw(chargePct: number): void {
    if (!this.enabled) return;
    const now = performance.now();
    // Throttle to every 200ms to avoid spamming
    if (now - this.lastBowDrawTime < 200) return;
    this.lastBowDrawTime = now;

    const gp = this.gamepad;
    if (!gp) return;
    const actuator = (gp as any).vibrationActuator;
    if (!actuator?.playEffect) return;

    const scale = this.intensityScale;
    // Ramp up intensity with charge
    const strong = 0.15 + chargePct * 0.45;
    const weak = 0.1 + chargePct * 0.25;

    actuator.playEffect('dual-rumble', {
      startDelay: 0,
      duration: 220,
      weakMagnitude: Math.min(1, weak * scale),
      strongMagnitude: Math.min(1, strong * scale),
    }).catch(() => {});
  }

  /** Stop all vibration immediately. */
  stop(): void {
    const gp = this.gamepad;
    if (!gp) return;
    const actuator = (gp as any).vibrationActuator;
    if (actuator?.reset) actuator.reset().catch(() => {});
  }

  /** Set global intensity scale (0 = off, 1 = full). */
  setIntensity(v: number): void {
    this.intensityScale = Math.max(0, Math.min(1, v));
  }

  /** Toggle haptics on/off entirely. */
  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) this.stop();
  }

  /** Returns true if a gamepad with haptics is connected. */
  get available(): boolean {
    if (!this.gamepad) return false;
    return !!(this.gamepad as any).vibrationActuator;
  }
}
