// ── Ayodhya Protocol: Lanka Reforged ── Web Audio Synthesized SFX ──
// All sounds are procedurally generated — zero external audio files.
// Uses OscillatorNode + GainNode + BiquadFilterNode for each effect.

export const enum SFX {
  BowCharge,
  BowRelease,
  ArrowHit,
  FireArrowCast,
  ShockwaveBlast,
  PlayerDamaged,
  EnemyDeath,
  BossRoar,
  BossAoE,
  BossDefeated,
  Dodge,
  Jump,
  LandImpact,
  UIClick,
  UIStart,
  Victory,
  Defeat,
  Footstep,
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private volume = 0.5;
  private enabled = true;
  private initialized = false;

  constructor() {
    // AudioContext requires user gesture — init on first interaction
    const initOnGesture = () => {
      if (this.initialized) return;
      this.initialized = true;
      try {
        this.ctx = new AudioContext();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.volume;
        this.masterGain.connect(this.ctx.destination);
        console.log('[Audio] AudioContext initialized');
      } catch (e) {
        console.warn('[Audio] Failed to create AudioContext:', e);
      }
      window.removeEventListener('click', initOnGesture);
      window.removeEventListener('touchstart', initOnGesture);
      window.removeEventListener('keydown', initOnGesture);
    };
    window.addEventListener('click', initOnGesture, { once: false });
    window.addEventListener('touchstart', initOnGesture, { once: false });
    window.addEventListener('keydown', initOnGesture, { once: false });
  }

  play(sfx: SFX): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const t = this.ctx.currentTime;
    switch (sfx) {
      case SFX.BowRelease:    this._bowRelease(t); break;
      case SFX.ArrowHit:      this._impact(t, 220, 0.08, 0.3); break;
      case SFX.FireArrowCast: this._swoosh(t, 600, 200, 0.25); break;
      case SFX.ShockwaveBlast: this._explosion(t, 0.4); break;
      case SFX.PlayerDamaged: this._damage(t); break;
      case SFX.EnemyDeath:    this._enemyDeath(t); break;
      case SFX.BossRoar:      this._bossRoar(t); break;
      case SFX.BossAoE:       this._explosion(t, 0.5); break;
      case SFX.BossDefeated:  this._bossDefeated(t); break;
      case SFX.Dodge:         this._swoosh(t, 400, 800, 0.12); break;
      case SFX.Jump:          this._swoosh(t, 200, 500, 0.08); break;
      case SFX.LandImpact:    this._impact(t, 80, 0.06, 0.15); break;
      case SFX.UIClick:       this._tick(t, 1200, 0.04); break;
      case SFX.UIStart:       this._uiStart(t); break;
      case SFX.Victory:       this._victory(t); break;
      case SFX.Defeat:        this._defeat(t); break;
      case SFX.Footstep:      this._footstep(t); break;
      default: break;
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain) this.masterGain.gain.value = this.volume;
  }

  setEnabled(v: boolean): void { this.enabled = v; }

  // ══════════════════════════════════════════════════════════
  //  SYNTH HELPERS
  // ══════════════════════════════════════════════════════════

  private _osc(type: OscillatorType, freq: number, start: number, dur: number): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start(start);
    o.stop(start + dur);
    return o;
  }

  private _gain(vol: number, start: number, dur: number, decay = true): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(vol, start);
    if (decay) g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    return g;
  }

  private _noise(start: number, dur: number, vol: number): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * dur);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * vol;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.start(start);
    src.stop(start + dur);
    return src;
  }

  // ══════════════════════════════════════════════════════════
  //  SOUND DEFINITIONS
  // ══════════════════════════════════════════════════════════

  private _bowRelease(t: number): void {
    const o = this._osc('sawtooth', 180, t, 0.15);
    const g = this._gain(0.2, t, 0.15);
    o.frequency.exponentialRampToValueAtTime(80, t + 0.15);
    o.connect(g).connect(this.masterGain!);

    // Twang
    const tw = this._osc('sine', 1200, t, 0.08);
    const tg = this._gain(0.12, t, 0.08);
    tw.frequency.exponentialRampToValueAtTime(400, t + 0.08);
    tw.connect(tg).connect(this.masterGain!);
  }

  private _impact(t: number, freq: number, dur: number, vol: number): void {
    const o = this._osc('sine', freq, t, dur);
    const g = this._gain(vol, t, dur);
    o.frequency.exponentialRampToValueAtTime(freq * 0.3, t + dur);
    o.connect(g).connect(this.masterGain!);
  }

  private _swoosh(t: number, freqStart: number, freqEnd: number, vol: number): void {
    const n = this._noise(t, 0.12, vol * 0.6);
    const g = this._gain(vol, t, 0.12);
    const f = this.ctx!.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freqStart, t);
    f.frequency.exponentialRampToValueAtTime(freqEnd, t + 0.12);
    f.Q.value = 2;
    n.connect(f).connect(g).connect(this.masterGain!);
  }

  private _explosion(t: number, vol: number): void {
    // Low rumble
    const o = this._osc('sawtooth', 60, t, 0.4);
    const g = this._gain(vol, t, 0.4);
    o.frequency.exponentialRampToValueAtTime(20, t + 0.4);
    o.connect(g).connect(this.masterGain!);

    // Noise burst
    const n = this._noise(t, 0.3, vol * 0.7);
    const ng = this._gain(vol * 0.7, t, 0.3);
    const f = this.ctx!.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2000, t);
    f.frequency.exponentialRampToValueAtTime(100, t + 0.3);
    n.connect(f).connect(ng).connect(this.masterGain!);
  }

  private _damage(t: number): void {
    const o = this._osc('square', 150, t, 0.15);
    const g = this._gain(0.25, t, 0.15);
    o.frequency.setValueAtTime(150, t);
    o.frequency.linearRampToValueAtTime(80, t + 0.15);
    o.connect(g).connect(this.masterGain!);

    // Crunch noise
    const n = this._noise(t, 0.08, 0.3);
    const ng = this._gain(0.2, t, 0.08);
    n.connect(ng).connect(this.masterGain!);
  }

  private _enemyDeath(t: number): void {
    const o = this._osc('sawtooth', 400, t, 0.2);
    const g = this._gain(0.15, t, 0.2);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.2);
    o.connect(g).connect(this.masterGain!);
  }

  private _bossRoar(t: number): void {
    const o1 = this._osc('sawtooth', 80, t, 0.6);
    const g1 = this._gain(0.3, t, 0.6);
    o1.connect(g1).connect(this.masterGain!);

    const o2 = this._osc('square', 120, t + 0.05, 0.5);
    const g2 = this._gain(0.2, t + 0.05, 0.5);
    o2.frequency.exponentialRampToValueAtTime(40, t + 0.55);
    o2.connect(g2).connect(this.masterGain!);
  }

  private _bossDefeated(t: number): void {
    // Descending boom
    const o = this._osc('sawtooth', 200, t, 1.2);
    const g = this._gain(0.35, t, 1.2);
    o.frequency.exponentialRampToValueAtTime(20, t + 1.2);
    o.connect(g).connect(this.masterGain!);

    // Shatter noise
    const n = this._noise(t, 0.5, 0.4);
    const ng = this._gain(0.3, t, 0.5);
    n.connect(ng).connect(this.masterGain!);
  }

  private _tick(t: number, freq: number, vol: number): void {
    const o = this._osc('sine', freq, t, 0.03);
    const g = this._gain(vol, t, 0.03);
    o.connect(g).connect(this.masterGain!);
  }

  private _uiStart(t: number): void {
    // Rising chime
    const notes = [440, 554, 659, 880];
    notes.forEach((freq, i) => {
      const o = this._osc('sine', freq, t + i * 0.08, 0.15);
      const g = this._gain(0.12, t + i * 0.08, 0.15);
      o.connect(g).connect(this.masterGain!);
    });
  }

  private _victory(t: number): void {
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      const o = this._osc('sine', freq, t + i * 0.12, 0.4);
      const g = this._gain(0.15, t + i * 0.12, 0.4);
      o.connect(g).connect(this.masterGain!);
    });
  }

  private _defeat(t: number): void {
    const notes = [440, 370, 311, 261];
    notes.forEach((freq, i) => {
      const o = this._osc('sawtooth', freq, t + i * 0.15, 0.35);
      const g = this._gain(0.12, t + i * 0.15, 0.35);
      o.connect(g).connect(this.masterGain!);
    });
  }

  private _footstep(t: number): void {
    const n = this._noise(t, 0.04, 0.15);
    const g = this._gain(0.06, t, 0.04);
    const f = this.ctx!.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    n.connect(f).connect(g).connect(this.masterGain!);
  }
}
