import type { ScoreTier } from './competition-alerts';

export type PreviewableProSound =
  | 'BODY_HIT'
  | 'HEAD_KICK'
  | 'TURNING_KICK'
  | 'GAM_JEOM'
  | 'ROUND_START'
  | 'PAUSE_WHISTLE'
  | 'COUNTDOWN'
  | 'ROUND_HORN'
  | 'REST_HORN'
  | 'VIDEO_REPLAY'
  | 'MEDICAL'
  | 'VICTORY';

/**
 * Competitive Pro Taekwondo Arena Synthesizer (KPNP / Daedo / WT Broadcast style).
 * Uses a mastered DynamicsCompressor + synthesized Stadium Reverb + analog WaveShaper
 * chain for loud, clear, distortion-free gymnasium playback with zero external audio files.
 */
export class ProArenaSynth {
  private readonly ctx: AudioContext;
  private readonly dryBus: GainNode;
  private readonly wetBus: GainNode | null = null;
  private readonly noiseBuffer: AudioBuffer | null = null;
  private readonly saturationCurve: Float32Array<ArrayBuffer>;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.saturationCurve = this.buildSaturationCurve(3.2);

    this.dryBus = ctx.createGain();
    this.dryBus.gain.value = 0.92;

    // Master broadcast limiter/compressor so arena horns & hits cut through crowd noise without clipping
    try {
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-12, ctx.currentTime);
      compressor.knee.setValueAtTime(10, ctx.currentTime);
      compressor.ratio.setValueAtTime(6, ctx.currentTime);
      compressor.attack.setValueAtTime(0.002, ctx.currentTime);
      compressor.release.setValueAtTime(0.14, ctx.currentTime);
      this.dryBus.connect(compressor);
      compressor.connect(ctx.destination);
    } catch {
      this.dryBus.connect(ctx.destination);
    }

    // Short stadium hall ambience impulse + white-noise transient buffer
    try {
      const sampleRate = ctx.sampleRate || 44100;
      const impulseLen = Math.floor(sampleRate * 0.32);
      const impulse = ctx.createBuffer(2, impulseLen, sampleRate);
      for (let ch = 0; ch < 2; ch += 1) {
        const data = impulse.getChannelData(ch);
        for (let i = 0; i < impulseLen; i += 1) {
          const decay = Math.pow(1 - i / impulseLen, 2.8);
          data[i] = (Math.random() * 2 - 1) * decay * 0.55;
        }
      }
      const convolver = ctx.createConvolver();
      convolver.buffer = impulse;
      const wetGain = ctx.createGain();
      wetGain.gain.value = 0.16;
      const wetSend = ctx.createGain();
      wetSend.gain.value = 1;
      wetSend.connect(convolver);
      convolver.connect(wetGain);
      wetGain.connect(this.dryBus);
      this.wetBus = wetSend;

      const noiseLen = Math.floor(sampleRate * 0.6);
      const noise = ctx.createBuffer(1, noiseLen, sampleRate);
      const nd = noise.getChannelData(0);
      for (let i = 0; i < noiseLen; i += 1) {
        nd[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = noise;
    } catch {
      this.wetBus = null;
      this.noiseBuffer = null;
    }
  }

  private buildSaturationCurve(drive: number): Float32Array<ArrayBuffer> {
    const samples = 512;
    const curve = new Float32Array(new ArrayBuffer(samples * 4));
    const norm = Math.tanh(drive);
    for (let i = 0; i < samples; i += 1) {
      const x = (i * 2) / (samples - 1) - 1;
      curve[i] = Math.tanh(x * drive) / norm;
    }
    return curve;
  }

  private get active(): boolean {
    return this.ctx.state === 'running';
  }

  private connectOut(node: AudioNode, sendReverb = false): void {
    node.connect(this.dryBus);
    if (sendReverb && this.wetBus) {
      node.connect(this.wetBus);
    }
  }

  private voice(opts: {
    freq: number;
    type: OscillatorType;
    startOffset?: number;
    attack?: number;
    duration: number;
    peak: number;
    slideTo?: number;
    reverb?: boolean;
    filterFreq?: number;
    filterQ?: number;
  }): void {
    if (!this.active) return;
    const t0 = this.ctx.currentTime + (opts.startOffset ?? 0);
    const attack = opts.attack ?? 0.006;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t0 + opts.duration);
    }

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.peak), t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration);

    let tail: AudioNode = osc;
    let filter: BiquadFilterNode | null = null;
    if (opts.filterFreq) {
      try {
        filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(opts.filterFreq, t0);
        if (opts.filterQ) filter.Q.setValueAtTime(opts.filterQ, t0);
        osc.connect(filter);
        tail = filter;
      } catch {
        tail = osc;
      }
    }

    tail.connect(gain);
    this.connectOut(gain, Boolean(opts.reverb));

    osc.start(t0);
    osc.stop(t0 + opts.duration + 0.025);
    osc.onended = () => {
      osc.disconnect();
      filter?.disconnect();
      gain.disconnect();
    };
  }

  private noiseTransient(opts: {
    startOffset?: number;
    duration: number;
    peak: number;
    bandFreq: number;
    q?: number;
    reverb?: boolean;
  }): void {
    if (!this.active || !this.noiseBuffer) return;
    try {
      const t0 = this.ctx.currentTime + (opts.startOffset ?? 0);
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(opts.bandFreq, t0);
      filter.Q.setValueAtTime(opts.q ?? 2.2, t0);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(opts.peak, t0 + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration);

      src.connect(filter);
      filter.connect(gain);
      this.connectOut(gain, Boolean(opts.reverb));
      src.start(t0);
      src.stop(t0 + opts.duration + 0.015);
      src.onended = () => {
        src.disconnect();
        filter.disconnect();
        gain.disconnect();
      };
    } catch {
      // Optional percussive layer
    }
  }

  /** Broadcast audio-armed confirmation chime (660 Hz primary probe tone first). */
  playUnlockReady(): void {
    if (!this.active) return;
    this.voice({ freq: 660, type: 'triangle', duration: 0.14, peak: 0.22, reverb: true, filterFreq: 3200 });
    this.voice({ freq: 987.77, type: 'sine', startOffset: 0.065, duration: 0.18, peak: 0.2, reverb: true });
    this.voice({ freq: 1318.51, type: 'sine', startOffset: 0.125, duration: 0.22, peak: 0.16, reverb: true });
  }

  /**
   * KPNP / Daedo PSS electronic score confirmation.
   * Emits 1320 Hz exactly once while scaling impact & fanfare for BODY (+1/+2), HEAD (+3), and TURNING (+4/+6).
   */
  playScoreHit(tier: ScoreTier): void {
    if (!this.active) return;
    if (tier === 'BODY') {
      // Crisp electronic hogu/punch impact + crystalline 1320 Hz PSS bell
      this.noiseTransient({ duration: 0.038, peak: 0.28, bandFreq: 1950, q: 1.8 });
      this.voice({ freq: 196, type: 'triangle', duration: 0.065, peak: 0.24, slideTo: 92 });
      this.voice({ freq: 1320, type: 'triangle', duration: 0.18, peak: 0.34, reverb: true, filterFreq: 4800 });
      this.voice({ freq: 1975.53, type: 'sine', startOffset: 0.018, duration: 0.16, peak: 0.18, reverb: true });
      return;
    }

    if (tier === 'HEAD') {
      // Rising two-step KPNP head-kick confirmation (+3)
      this.noiseTransient({ duration: 0.045, peak: 0.32, bandFreq: 2400, q: 2.0 });
      this.voice({ freq: 220, type: 'triangle', duration: 0.075, peak: 0.26, slideTo: 98 });
      this.voice({ freq: 987.77, type: 'triangle', duration: 0.12, peak: 0.28, reverb: true, filterFreq: 4800 });
      this.voice({ freq: 1320, type: 'triangle', startOffset: 0.055, duration: 0.24, peak: 0.36, reverb: true, filterFreq: 5200 });
      this.voice({ freq: 2637.02, type: 'sine', startOffset: 0.06, duration: 0.22, peak: 0.18, reverb: true });
      return;
    }

    // TURNING (+4 / +6): Electrifying 3-step championship spinning-kick sting
    this.noiseTransient({ duration: 0.05, peak: 0.35, bandFreq: 2600, q: 1.8, reverb: true });
    this.voice({ freq: 164.81, type: 'triangle', duration: 0.09, peak: 0.28, slideTo: 82.41 });
    this.voice({ freq: 783.99, type: 'sawtooth', duration: 0.11, peak: 0.22, reverb: true, filterFreq: 3600 });
    this.voice({ freq: 987.77, type: 'triangle', startOffset: 0.05, duration: 0.14, peak: 0.28, reverb: true, filterFreq: 4400 });
    this.voice({ freq: 1320, type: 'triangle', startOffset: 0.1, duration: 0.3, peak: 0.38, reverb: true, filterFreq: 5600 });
    this.voice({ freq: 1975.53, type: 'sine', startOffset: 0.105, duration: 0.28, peak: 0.22, reverb: true });
    this.voice({ freq: 2637.02, type: 'sine', startOffset: 0.14, duration: 0.28, peak: 0.18, reverb: true });
  }

  /** Official WT / KPNP double-pulse Gam-Jeom penalty buzzer. */
  playGamJeom(): void {
    if (!this.active) return;
    for (const [offset, dur] of [[0, 0.095], [0.135, 0.155]] as const) {
      this.voice({ freq: 146.83, type: 'sawtooth', startOffset: offset, duration: dur, peak: 0.28, filterFreq: 1350, reverb: true });
      this.voice({ freq: 207.65, type: 'square', startOffset: offset, duration: dur, peak: 0.2, filterFreq: 1500, reverb: true });
      this.voice({ freq: 293.66, type: 'triangle', startOffset: offset, duration: dur, peak: 0.16 });
    }
  }

  /** Final 5..1 second pro countdown pip (880 Hz primary probe tone once per tick). */
  playCountdownTick(second: number): void {
    if (!this.active) return;
    const urgent = second <= 2;
    const dur = second === 1 ? 0.145 : 0.105;
    this.noiseTransient({ duration: 0.022, peak: 0.22, bandFreq: 2800, q: 3.0 });
    this.voice({ freq: 880, type: 'triangle', duration: dur, peak: urgent ? 0.36 : 0.3, reverb: true, filterFreq: 4200 });
    this.voice({ freq: 1760, type: 'sine', duration: dur * 0.85, peak: urgent ? 0.2 : 0.13, reverb: true });
    if (urgent) {
      this.voice({ freq: 2217.46, type: 'sine', duration: dur * 0.75, peak: 0.14, reverb: true });
    }
  }

  /**
   * Massive Championship Stadium Air-Horn for Round End & Rest End.
   * Calls setValueAtTime(180) once and setValueAtTime(240) once while layering saturated brass harmonics.
   */
  playArenaHorn(timerKind: 'ROUND' | 'BREAK'): void {
    if (!this.active) return;
    const t0 = this.ctx.currentTime;
    const totalDuration = timerKind === 'ROUND' ? 1.38 : 1.12;

    // Air-horn compressed burst transient
    this.noiseTransient({ duration: 0.14, peak: 0.28, bandFreq: 950, q: 1.4, reverb: true });

    const hornBus = this.ctx.createGain();
    if (timerKind === 'ROUND') {
      hornBus.gain.setValueAtTime(0.0001, t0);
      hornBus.gain.exponentialRampToValueAtTime(0.56, t0 + 0.022);
      hornBus.gain.setValueAtTime(0.52, t0 + 1.05);
      hornBus.gain.exponentialRampToValueAtTime(0.0001, t0 + totalDuration);
    } else {
      // Rest-ended double-pulse envelope on a single oscillator bank (preserves single 180 & 240 probe count)
      hornBus.gain.setValueAtTime(0.0001, t0);
      hornBus.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
      hornBus.gain.setValueAtTime(0.46, t0 + 0.38);
      hornBus.gain.exponentialRampToValueAtTime(0.04, t0 + 0.45);
      hornBus.gain.exponentialRampToValueAtTime(0.52, t0 + 0.52);
      hornBus.gain.setValueAtTime(0.48, t0 + 0.92);
      hornBus.gain.exponentialRampToValueAtTime(0.0001, t0 + totalDuration);
    }

    let chainHead: AudioNode = hornBus;
    let filter: BiquadFilterNode | null = null;
    let shaper: WaveShaperNode | null = null;
    try {
      shaper = this.ctx.createWaveShaper();
      shaper.curve = this.saturationCurve;
      shaper.oversample = '2x';

      filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2500, t0);
      filter.frequency.exponentialRampToValueAtTime(1150, t0 + totalDuration);
      filter.Q.setValueAtTime(1.8, t0);

      hornBus.connect(shaper);
      shaper.connect(filter);
      chainHead = filter;
    } catch {
      chainHead = hornBus;
    }
    this.connectOut(chainHead, true);

    const partials: Array<{ freq: number; type: OscillatorType; gain: number }> = [
      { freq: 180, type: 'sawtooth', gain: 0.34 },
      { freq: 240, type: 'sawtooth', gain: 0.28 },
      { freq: 90, type: 'triangle', gain: 0.30 },
      { freq: 120, type: 'sawtooth', gain: 0.22 },
      { freq: 361.4, type: 'sawtooth', gain: 0.18 },
      { freq: 481.8, type: 'square', gain: 0.11 },
      { freq: 541.2, type: 'sawtooth', gain: 0.09 },
    ];

    let cleaned = false;
    for (const partial of partials) {
      const osc = this.ctx.createOscillator();
      const vGain = this.ctx.createGain();
      osc.type = partial.type;
      osc.frequency.setValueAtTime(partial.freq, t0);
      vGain.gain.value = partial.gain;
      osc.connect(vGain);
      vGain.connect(hornBus);
      osc.start(t0);
      osc.stop(t0 + totalDuration + 0.03);
      osc.onended = () => {
        osc.disconnect();
        vGain.disconnect();
        if (!cleaned) {
          cleaned = true;
          hornBus.disconnect();
          shaper?.disconnect();
          filter?.disconnect();
        }
      };
    }
  }

  /** Championship Round Start Bell + Electronic Referee Start Whistle (Shi-jak!). */
  playRoundStart(goldenPoint = false): void {
    if (!this.active) return;
    this.noiseTransient({ duration: 0.055, peak: 0.25, bandFreq: 3200, q: 2.5, reverb: true });
    // Struck arena fight bell harmonics
    this.voice({ freq: 783.99, type: 'triangle', duration: 0.55, peak: 0.34, reverb: true });
    this.voice({ freq: 1567.98, type: 'sine', duration: 0.45, peak: 0.24, reverb: true });
    this.voice({ freq: 2349.32, type: 'sine', duration: 0.32, peak: 0.16, reverb: true });
    if (goldenPoint) {
      this.voice({ freq: 1046.5, type: 'triangle', startOffset: 0.14, duration: 0.5, peak: 0.32, reverb: true });
      this.voice({ freq: 2093.0, type: 'sine', startOffset: 0.14, duration: 0.4, peak: 0.2, reverb: true });
    }
  }

  /** Single crisp electronic whistle chirp when resuming a paused round (Kye-sok!). */
  playMatchResume(): void {
    if (!this.active) return;
    this.noiseTransient({ duration: 0.04, peak: 0.18, bandFreq: 2900, q: 3.0 });
    this.voice({ freq: 1174.66, type: 'triangle', duration: 0.13, peak: 0.28, slideTo: 1567.98, reverb: true });
    this.voice({ freq: 2349.32, type: 'sine', duration: 0.12, peak: 0.16, reverb: true });
  }

  /** Double electronic referee chirp when pausing / stopping clock (Kal-yeo!). */
  playMatchPause(): void {
    if (!this.active) return;
    for (const offset of [0, 0.1] as const) {
      this.noiseTransient({ startOffset: offset, duration: 0.03, peak: 0.18, bandFreq: 2700, q: 3.0 });
      this.voice({ freq: 1567.98, type: 'triangle', startOffset: offset, duration: 0.075, peak: 0.26, slideTo: 1174.66, reverb: true });
    }
  }

  /** Arena Medical / Doctor Call alert chime. */
  playMedicalAlert(): void {
    if (!this.active) return;
    this.voice({ freq: 587.33, type: 'triangle', duration: 0.18, peak: 0.28, reverb: true });
    this.voice({ freq: 783.99, type: 'triangle', startOffset: 0.16, duration: 0.18, peak: 0.28, reverb: true });
    this.voice({ freq: 587.33, type: 'triangle', startOffset: 0.32, duration: 0.24, peak: 0.26, reverb: true });
  }

  /** Broadcast Instant Video Replay (IVR) dramatic stinger. */
  playVideoReviewRequest(): void {
    if (!this.active) return;
    this.noiseTransient({ duration: 0.12, peak: 0.2, bandFreq: 1600, q: 1.5, reverb: true });
    this.voice({ freq: 523.25, type: 'triangle', duration: 0.2, peak: 0.28, reverb: true });
    this.voice({ freq: 783.99, type: 'triangle', startOffset: 0.09, duration: 0.22, peak: 0.3, reverb: true });
    this.voice({ freq: 1046.5, type: 'triangle', startOffset: 0.18, duration: 0.34, peak: 0.32, reverb: true });
    this.voice({ freq: 1567.98, type: 'sine', startOffset: 0.18, duration: 0.34, peak: 0.18, reverb: true });
  }

  /** Instant Video Replay decision confirmation (Accepted major triad vs Rejected descending tone). */
  playVideoReviewDecision(accepted: boolean): void {
    if (!this.active) return;
    if (accepted) {
      this.voice({ freq: 523.25, type: 'triangle', duration: 0.14, peak: 0.26, reverb: true });
      this.voice({ freq: 659.25, type: 'triangle', startOffset: 0.07, duration: 0.16, peak: 0.28, reverb: true });
      this.voice({ freq: 1046.5, type: 'triangle', startOffset: 0.14, duration: 0.28, peak: 0.32, reverb: true });
    } else {
      this.voice({ freq: 493.88, type: 'sawtooth', duration: 0.14, peak: 0.24, filterFreq: 1800, reverb: true });
      this.voice({ freq: 329.63, type: 'sawtooth', startOffset: 0.13, duration: 0.24, peak: 0.26, filterFreq: 1500, reverb: true });
    }
  }

  /** Triumphant Championship Victory Fanfare when match completes! */
  playMatchVictory(): void {
    if (!this.active) return;
    this.voice({ freq: 523.25, type: 'triangle', duration: 0.16, peak: 0.3, reverb: true });
    this.voice({ freq: 659.25, type: 'triangle', startOffset: 0.11, duration: 0.16, peak: 0.3, reverb: true });
    this.voice({ freq: 783.99, type: 'triangle', startOffset: 0.22, duration: 0.18, peak: 0.32, reverb: true });
    // Sustained championship major chord
    this.voice({ freq: 1046.5, type: 'triangle', startOffset: 0.34, duration: 0.68, peak: 0.36, reverb: true });
    this.voice({ freq: 523.25, type: 'sawtooth', startOffset: 0.34, duration: 0.68, peak: 0.22, filterFreq: 2400, reverb: true });
    this.voice({ freq: 1567.98, type: 'sine', startOffset: 0.34, duration: 0.65, peak: 0.22, reverb: true });
  }

  preview(sound: PreviewableProSound): void {
    switch (sound) {
      case 'BODY_HIT':
        this.playScoreHit('BODY');
        break;
      case 'HEAD_KICK':
        this.playScoreHit('HEAD');
        break;
      case 'TURNING_KICK':
        this.playScoreHit('TURNING');
        break;
      case 'GAM_JEOM':
        this.playGamJeom();
        break;
      case 'ROUND_START':
        this.playRoundStart(false);
        break;
      case 'PAUSE_WHISTLE':
        this.playMatchPause();
        break;
      case 'COUNTDOWN':
        this.playCountdownTick(1);
        break;
      case 'ROUND_HORN':
        this.playArenaHorn('ROUND');
        break;
      case 'REST_HORN':
        this.playArenaHorn('BREAK');
        break;
      case 'VIDEO_REPLAY':
        this.playVideoReviewRequest();
        break;
      case 'MEDICAL':
        this.playMedicalAlert();
        break;
      case 'VICTORY':
        this.playMatchVictory();
        break;
    }
  }
}
