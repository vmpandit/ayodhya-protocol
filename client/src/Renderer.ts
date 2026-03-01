// ── Ayodhya Protocol: Lanka Reforged ── Babylon.js WebGPU Renderer ──

import {
  Engine, WebGPUEngine, Scene, ArcRotateCamera, Vector3, HemisphericLight,
  DirectionalLight, ShadowGenerator, Color3, Color4, FreeCamera,
  DefaultRenderingPipeline, ImageProcessingConfiguration, AbstractEngine,
} from '@babylonjs/core';

export class Renderer {
  public engine!: AbstractEngine;
  public scene!: Scene;
  public camera!: FreeCamera;
  public shadowGenerator!: ShadowGenerator;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init(): Promise<void> {
    // Try WebGPU first, fallback to WebGL
    let engine: AbstractEngine;
    try {
      const webgpuEngine = new WebGPUEngine(this.canvas, {
        adaptToDeviceRatio: true,
        antialias: true,
      });
      await webgpuEngine.initAsync();
      engine = webgpuEngine;
      console.log('[Renderer] WebGPU initialized');
    } catch {
      console.warn('[Renderer] WebGPU not available, falling back to WebGL');
      engine = new Engine(this.canvas, true, {
        adaptToDeviceRatio: true,
      });
    }
    this.engine = engine;

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.05, 0.05, 0.1, 1);
    this.scene.ambientColor = new Color3(0.15, 0.12, 0.1);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.008;
    this.scene.fogColor = new Color3(0.15, 0.1, 0.08);

    // Camera — will be controlled by PlayerController
    this.camera = new FreeCamera('camera', new Vector3(0, 8, -12), this.scene);
    this.camera.minZ = 0.1;
    this.camera.maxZ = 300;
    this.camera.fov = 1.0;
    // Detach default inputs — we control camera manually
    this.camera.detachControl();

    // Ambient light
    const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 0.4;
    ambient.diffuse = new Color3(0.6, 0.55, 0.5);
    ambient.groundColor = new Color3(0.15, 0.1, 0.08);

    // Directional (sun) light with shadows
    const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.3).normalize(), this.scene);
    sun.intensity = 1.2;
    sun.diffuse = new Color3(1, 0.9, 0.7);
    sun.position = new Vector3(30, 50, -30);

    this.shadowGenerator = new ShadowGenerator(2048, sun);
    this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.shadowGenerator.blurKernel = 16;
    this.shadowGenerator.darkness = 0.3;

    // Post-processing pipeline
    const pipeline = new DefaultRenderingPipeline('defaultPipeline', true, this.scene, [this.camera]);
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.7;
    pipeline.bloomWeight = 0.3;
    pipeline.bloomKernel = 64;
    pipeline.bloomScale = 0.5;
    pipeline.imageProcessingEnabled = true;
    pipeline.imageProcessing.toneMappingEnabled = true;
    pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    pipeline.imageProcessing.vignetteEnabled = true;
    pipeline.imageProcessing.vignetteWeight = 1.5;
    pipeline.imageProcessing.exposure = 1.1;

    // Handle resize
    window.addEventListener('resize', () => {
      this.engine.resize();
    });
  }
}
