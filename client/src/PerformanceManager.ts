// ── Ayodhya Protocol: Lanka Reforged ── FPS Monitor & Dynamic Quality ──
// Monitors frame times and toggles quality levels to maintain target FPS.
// Also provides particle throttling and update-rate decimation helpers.

import { Scene, DefaultRenderingPipeline, ShadowGenerator, ParticleSystem } from '@babylonjs/core';

export const enum QualityLevel {
  Ultra = 0,
  High = 1,
  Medium = 2,
  Low = 3,
}

const QUALITY_NAMES: Record<QualityLevel, string> = {
  [QualityLevel.Ultra]: 'ULTRA',
  [QualityLevel.High]: 'HIGH',
  [QualityLevel.Medium]: 'MEDIUM',
  [QualityLevel.Low]: 'LOW',
};

interface QualityPreset {
  shadowMapSize: number;
  shadowBlurKernel: number;
  bloomEnabled: boolean;
  bloomKernel: number;
  sharpenEnabled: boolean;
  chromaticAberrationEnabled: boolean;
  fxaaEnabled: boolean;
  particleRateMult: number;     // multiplier on emitRate
  maxParticleSystems: number;   // max active particle systems
}

const PRESETS: Record<QualityLevel, QualityPreset> = {
  [QualityLevel.Ultra]: {
    shadowMapSize: 2048, shadowBlurKernel: 20,
    bloomEnabled: true, bloomKernel: 80,
    sharpenEnabled: true, chromaticAberrationEnabled: true, fxaaEnabled: true,
    particleRateMult: 1.0, maxParticleSystems: 999,
  },
  [QualityLevel.High]: {
    shadowMapSize: 1024, shadowBlurKernel: 16,
    bloomEnabled: true, bloomKernel: 48,
    sharpenEnabled: true, chromaticAberrationEnabled: false, fxaaEnabled: true,
    particleRateMult: 0.75, maxParticleSystems: 999,
  },
  [QualityLevel.Medium]: {
    shadowMapSize: 512, shadowBlurKernel: 8,
    bloomEnabled: true, bloomKernel: 32,
    sharpenEnabled: false, chromaticAberrationEnabled: false, fxaaEnabled: true,
    particleRateMult: 0.5, maxParticleSystems: 4,
  },
  [QualityLevel.Low]: {
    shadowMapSize: 256, shadowBlurKernel: 4,
    bloomEnabled: false, bloomKernel: 0,
    sharpenEnabled: false, chromaticAberrationEnabled: false, fxaaEnabled: false,
    particleRateMult: 0.25, maxParticleSystems: 2,
  },
};

export class PerformanceManager {
  private scene: Scene;
  private pipeline: DefaultRenderingPipeline | null = null;
  private shadowGen: ShadowGenerator | null = null;

  // ── FPS tracking ──────────────────────────────────────────
  private frameTimes: number[] = [];
  private readonly SAMPLE_COUNT = 60;    // rolling window
  private readonly TARGET_FPS = 55;       // slight headroom below 60
  private readonly CRITICAL_FPS = 35;
  private fps = 60;
  private avgFrameMs = 16.6;

  // ── Quality control ───────────────────────────────────────
  private currentLevel: QualityLevel = QualityLevel.Ultra;
  private lastQualityChange = 0;
  private readonly COOLDOWN_MS = 3000;   // wait 3s between quality changes
  private manualOverride = false;        // if user picks a level, stop auto

  // ── FPS display ───────────────────────────────────────────
  private fpsEl: HTMLElement | null = null;
  private fpsUpdateTimer = 0;

  // ── Base particle emit rates (saved on first apply) ───────
  private baseEmitRates = new Map<string, number>();

  constructor(scene: Scene) {
    this.scene = scene;
    this.fpsEl = document.getElementById('fpsCounter');
  }

  /** Call once after renderer sets up pipeline and shadows */
  attachPipeline(pipeline: DefaultRenderingPipeline, shadowGen: ShadowGenerator): void {
    this.pipeline = pipeline;
    this.shadowGen = shadowGen;

    // Snapshot base emit rates for all particle systems
    for (const ps of this.scene.particleSystems) {
      if (ps instanceof ParticleSystem) {
        this.baseEmitRates.set(ps.name, ps.emitRate);
      }
    }
  }

  /** Call every frame with raw delta time (seconds). */
  update(dt: number): void {
    const ms = dt * 1000;
    this.frameTimes.push(ms);
    if (this.frameTimes.length > this.SAMPLE_COUNT) this.frameTimes.shift();

    // Compute rolling average
    const sum = this.frameTimes.reduce((a, b) => a + b, 0);
    this.avgFrameMs = sum / this.frameTimes.length;
    this.fps = Math.round(1000 / this.avgFrameMs);

    // Update FPS display (throttled to 4× per second)
    this.fpsUpdateTimer += dt;
    if (this.fpsUpdateTimer >= 0.25) {
      this.fpsUpdateTimer = 0;
      if (this.fpsEl) {
        this.fpsEl.textContent = `${this.fps} FPS`;
        this.fpsEl.style.color = this.fps >= 55 ? '#4eff4e' : this.fps >= 40 ? '#ffcc00' : '#ff4444';
      }
    }

    // Auto quality adjustment
    if (!this.manualOverride) {
      const now = performance.now();
      if (now - this.lastQualityChange >= this.COOLDOWN_MS) {
        if (this.fps < this.CRITICAL_FPS && this.currentLevel < QualityLevel.Low) {
          this.setQuality(this.currentLevel + 1 as QualityLevel);
          this.lastQualityChange = now;
        } else if (this.fps < this.TARGET_FPS && this.currentLevel < QualityLevel.Low) {
          this.setQuality(this.currentLevel + 1 as QualityLevel);
          this.lastQualityChange = now;
        } else if (this.fps >= 58 && this.currentLevel > QualityLevel.Ultra) {
          // Recover quality when headroom exists (conservative — need sustained 58+)
          if (this.frameTimes.length >= this.SAMPLE_COUNT) {
            this.setQuality(this.currentLevel - 1 as QualityLevel);
            this.lastQualityChange = now;
          }
        }
      }
    }
  }

  /** Apply a quality preset. */
  setQuality(level: QualityLevel): void {
    this.currentLevel = level;
    const p = PRESETS[level];

    if (this.pipeline) {
      this.pipeline.bloomEnabled = p.bloomEnabled;
      if (p.bloomEnabled) this.pipeline.bloomKernel = p.bloomKernel;
      this.pipeline.sharpenEnabled = p.sharpenEnabled;
      this.pipeline.chromaticAberrationEnabled = p.chromaticAberrationEnabled;
      this.pipeline.fxaaEnabled = p.fxaaEnabled;
    }

    if (this.shadowGen) {
      this.shadowGen.getShadowMap()!.refreshRate = level >= QualityLevel.Low ? 2 : 1;
      this.shadowGen.blurKernel = p.shadowBlurKernel;
    }

    // Throttle particle systems
    for (const ps of this.scene.particleSystems) {
      if (ps instanceof ParticleSystem) {
        const base = this.baseEmitRates.get(ps.name) ?? ps.emitRate;
        ps.emitRate = Math.max(1, Math.round(base * p.particleRateMult));
      }
    }

    console.log(`[Perf] Quality → ${QUALITY_NAMES[level]} (FPS: ${this.fps})`);
  }

  /** Force a manual quality level (disables auto-scaling). */
  forceQuality(level: QualityLevel): void {
    this.manualOverride = true;
    this.setQuality(level);
  }

  /** Re-enable automatic quality scaling. */
  enableAutoQuality(): void {
    this.manualOverride = false;
  }

  /** Should AI updates run this frame? Returns false to skip (decimation). */
  shouldUpdateAI(frameIndex: number): boolean {
    // At Low quality, only update AI every other frame
    if (this.currentLevel >= QualityLevel.Low) return (frameIndex & 1) === 0;
    return true;
  }

  /** Should projectile physics run at full rate? */
  shouldUpdateProjectiles(): boolean {
    // Always — projectiles are gameplay-critical
    return true;
  }

  get level(): QualityLevel { return this.currentLevel; }
  get currentFps(): number { return this.fps; }
  get qualityName(): string { return QUALITY_NAMES[this.currentLevel]; }
}
