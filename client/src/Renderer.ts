// ── Ayodhya Protocol: Lanka Reforged ── Babylon.js WebGPU Renderer ──
// Lighting target: "eternal blood dusk" — low orange sun, indigo fill, rich fog.

import {
  Engine, WebGPUEngine, Scene, Vector3, HemisphericLight,
  DirectionalLight, ShadowGenerator, Color3, Color4, FreeCamera,
  DefaultRenderingPipeline, ImageProcessingConfiguration,
  ColorCurves, AbstractEngine,
} from '@babylonjs/core';

export class Renderer {
  public engine!: AbstractEngine;
  public scene!: Scene;
  public camera!: FreeCamera;
  public shadowGenerator!: ShadowGenerator;
  public pipeline!: DefaultRenderingPipeline;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init(): Promise<void> {
    // ── Engine ──────────────────────────────────────────────────────
    let engine: AbstractEngine;
    try {
      const wgpu = new WebGPUEngine(this.canvas, { adaptToDeviceRatio: true, antialias: true });
      await wgpu.initAsync();
      engine = wgpu;
      console.log('[Renderer] WebGPU initialized');
    } catch {
      console.warn('[Renderer] Falling back to WebGL');
      engine = new Engine(this.canvas, true, { adaptToDeviceRatio: true });
    }
    this.engine = engine;

    // ── Scene ───────────────────────────────────────────────────────
    this.scene = new Scene(this.engine);
    // Deep blood-orange sky at the horizon, dark canopy overhead
    this.scene.clearColor = new Color4(0.06, 0.03, 0.02, 1);
    this.scene.ambientColor = new Color3(0.32, 0.22, 0.18);

    // Layered exponential fog — near mist + far haze
    this.scene.fogMode    = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.012;
    this.scene.fogColor   = new Color3(0.22, 0.1, 0.06); // warm ember haze

    // ── Camera ──────────────────────────────────────────────────────
    this.camera       = new FreeCamera('camera', new Vector3(0, 8, -12), this.scene);
    this.camera.minZ  = 0.1;
    this.camera.maxZ  = 280;
    this.camera.fov   = 1.05; // ~60°; PlayerController lerps this per-frame
    this.camera.detachControl();

    // ── Lighting ────────────────────────────────────────────────────
    // Hemisphere — brighter ambient so scene isn't too dark
    const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), this.scene);
    ambient.intensity   = 0.62;
    ambient.diffuse     = new Color3(0.65, 0.55, 0.45);   // warm upper sky
    ambient.groundColor = new Color3(0.18, 0.14, 0.22);   // cool purple bounce

    // Key light — low-angle blood-orange sun (22° elevation, NW)
    const sun = new DirectionalLight('sun',
      new Vector3(-0.65, -0.38, 0.65).normalize(), this.scene);
    sun.intensity = 2.8;
    sun.diffuse   = new Color3(1.0, 0.52, 0.18);          // deep orange
    sun.specular  = new Color3(1.0, 0.55, 0.2);
    sun.position  = new Vector3(40, 60, -40);

    // Fill light — indigo/purple from opposite side (sky fill)
    const fill = new DirectionalLight('fill',
      new Vector3(0.5, -0.5, -0.5).normalize(), this.scene);
    fill.intensity = 0.85;
    fill.diffuse   = new Color3(0.25, 0.2, 0.55);         // indigo fill
    fill.specular  = new Color3(0.0, 0.0, 0.0);           // no specular contribution

    // ── Shadows (key light only) ─────────────────────────────────────
    this.shadowGenerator = new ShadowGenerator(2048, sun);
    this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.shadowGenerator.blurKernel = 20;
    this.shadowGenerator.darkness   = 0.45;               // more contrast

    // ── Post-Processing Pipeline ─────────────────────────────────────
    const pipe = new DefaultRenderingPipeline('pipe', true, this.scene, [this.camera]);
    this.pipeline = pipe;

    // FXAA
    pipe.fxaaEnabled = true;

    // Bloom — emissives punch through
    pipe.bloomEnabled    = true;
    pipe.bloomThreshold  = 0.62;
    pipe.bloomWeight     = 0.45;
    pipe.bloomKernel     = 80;
    pipe.bloomScale      = 0.6;

    // Sharpening
    pipe.sharpenEnabled  = true;
    pipe.sharpen.edgeAmount = 0.4;

    // Chromatic aberration — very subtle lens distortion at edges
    pipe.chromaticAberrationEnabled = true;
    pipe.chromaticAberration.aberrationAmount    = 25;
    pipe.chromaticAberration.radialIntensity     = 0.8;

    // Image processing
    pipe.imageProcessingEnabled = true;
    pipe.imageProcessing.toneMappingEnabled = true;
    pipe.imageProcessing.toneMappingType    = ImageProcessingConfiguration.TONEMAPPING_ACES;
    pipe.imageProcessing.exposure    = 1.65;
    pipe.imageProcessing.contrast    = 1.35;              // punchy contrast

    // Dramatic vignette
    pipe.imageProcessing.vignetteEnabled = true;
    pipe.imageProcessing.vignetteWeight  = 2.2;
    pipe.imageProcessing.vignetteColor   = new Color4(0, 0, 0, 0);

    // Color grade — warm highlights, cool shadows, boosted saturation
    const cc = new ColorCurves();
    cc.globalSaturation    = 18;                          // +18 % saturation overall
    cc.highlightsHue       = 28;                          // amber highlights
    cc.highlightsDensity   = 25;
    cc.highlightsSaturation = 20;
    cc.shadowsHue          = 265;                         // purple shadows
    cc.shadowsDensity      = 35;
    cc.shadowsSaturation   = 30;
    pipe.imageProcessing.colorCurvesEnabled = true;
    pipe.imageProcessing.colorCurves        = cc;

    // ── Resize ──────────────────────────────────────────────────────
    window.addEventListener('resize', () => this.engine.resize());
  }

  /** Update lighting for day/night cycle. t: 0=dawn, 0.25=noon, 0.5=dusk, 0.75=midnight, 1.0=dawn */
  updateTimeOfDay(t: number): void {
    const sun = this.scene.getLightByName('sun') as DirectionalLight | null;
    const fill = this.scene.getLightByName('fill') as DirectionalLight | null;

    if (!sun) return;

    // ── Sun elevation & rotation ────────────────────────────────
    // Sun rises at t=0, peaks at t=0.25, sets at t=0.5, below horizon t=0.5-1.0
    const sunAngle = t * Math.PI * 2; // full rotation
    const elevation = Math.cos(sunAngle) * 0.7; // -0.7 (below) to +0.7 (above)
    const azimuth = Math.sin(sunAngle);
    sun.direction = new Vector3(azimuth * 0.65, -Math.max(elevation, 0.05), 0.65).normalize();
    sun.position = new Vector3(-azimuth * 40, Math.max(elevation * 80, 5), -40);

    // ── Sun color & intensity based on time ─────────────────────
    const isDay = t < 0.5;
    const isDusk = t > 0.35 && t < 0.55;
    const isNight = t >= 0.55;

    if (isNight) {
      // Night: very dim sun, blue moonlight from fill
      sun.intensity = 0.15;
      sun.diffuse = new Color3(0.15, 0.15, 0.25);
      sun.specular = new Color3(0.1, 0.1, 0.15);
      if (fill) {
        fill.intensity = 0.7;
        fill.diffuse = new Color3(0.3, 0.35, 0.55); // pale blue moonlight
      }
      // Dark sky
      this.scene.clearColor = new Color4(0.02, 0.01, 0.04, 1);
      this.scene.fogColor = new Color3(0.04, 0.03, 0.06);
      this.scene.fogDensity = 0.02;
    } else if (isDusk) {
      // Dusk: blood-orange sun, lower intensity
      const duskFactor = (t - 0.35) / 0.2; // 0→1 across dusk
      sun.intensity = 2.2 - duskFactor * 1.8;
      sun.diffuse = new Color3(1.0, 0.4 - duskFactor * 0.25, 0.15);
      sun.specular = new Color3(0.8, 0.3, 0.15);
      if (fill) {
        fill.intensity = 0.6 + duskFactor * 0.2;
        fill.diffuse = new Color3(0.25 + duskFactor * 0.1, 0.2, 0.45 + duskFactor * 0.1);
      }
      this.scene.clearColor = new Color4(0.08 - duskFactor * 0.06, 0.03, 0.02 + duskFactor * 0.02, 1);
      this.scene.fogDensity = 0.012 + duskFactor * 0.008;
    } else if (t < 0.1) {
      // Dawn: golden warm light rising
      const dawnFactor = t / 0.1; // 0→1 across dawn
      sun.intensity = 0.8 + dawnFactor * 1.0;
      sun.diffuse = new Color3(1.0, 0.7 + dawnFactor * 0.15, 0.3 + dawnFactor * 0.15);
      sun.specular = new Color3(1.0, 0.6, 0.25);
      if (fill) {
        fill.intensity = 0.5 + dawnFactor * 0.3;
        fill.diffuse = new Color3(0.2, 0.2, 0.4);
      }
      this.scene.clearColor = new Color4(0.1 + dawnFactor * 0.05, 0.06 + dawnFactor * 0.03, 0.03, 1);
      this.scene.fogDensity = 0.008 - dawnFactor * 0.003;
    } else {
      // Midday: bright neutral-warm light
      const noonFactor = Math.sin((t - 0.1) / 0.25 * Math.PI / 2);
      sun.intensity = 1.8 + noonFactor * 0.8;
      sun.diffuse = new Color3(1.0, 0.85 + noonFactor * 0.1, 0.6 + noonFactor * 0.15);
      sun.specular = new Color3(1.0, 0.85, 0.6);
      if (fill) {
        fill.intensity = 0.7 + noonFactor * 0.15;
        fill.diffuse = new Color3(0.25, 0.25, 0.5);
      }
      this.scene.clearColor = new Color4(0.12, 0.1, 0.06, 1);
      this.scene.fogDensity = 0.005 + (1 - noonFactor) * 0.004;
    }

    // ── Exposure adjustment ─────────────────────────────────────
    if (this.pipeline?.imageProcessingEnabled) {
      this.pipeline.imageProcessing.exposure = isNight ? 1.2 : isDusk ? 1.45 : 1.65;
    }
  }
}
