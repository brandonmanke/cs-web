// Synthesized sounds (Web Audio, no assets) until the plan's sampled-audio
// milestone. Every weapon gets its own voice out of the same three ingredients:
// a filtered noise crack, a pitched body thump, and a tail. That is enough for
// an AWP and a Glock to be told apart with your eyes shut, which is the point.

interface ShotVoice {
  /** Noise burst length, seconds — the crack. */
  crack: number;
  /** Lowpass cutoff on the noise; lower reads as bigger and further away. */
  cutoff: number;
  /** Body oscillator sweep, Hz. */
  from: number;
  to: number;
  gain: number;
}

// Keyed by cs::WeaponId.
const VOICES: Record<number, ShotVoice> = {
  1: { crack: 0.05, cutoff: 5200, from: 320, to: 180, gain: 0.20 }, // knife swing
  2: { crack: 0.06, cutoff: 2400, from: 190, to: 70, gain: 0.30 },  // USP, suppressed
  3: { crack: 0.07, cutoff: 4200, from: 240, to: 90, gain: 0.38 },  // Glock
  4: { crack: 0.11, cutoff: 3400, from: 150, to: 46, gain: 0.55 },  // AK, deep
  5: { crack: 0.09, cutoff: 4000, from: 175, to: 58, gain: 0.48 },  // M4, tighter
  6: { crack: 0.17, cutoff: 2600, from: 110, to: 32, gain: 0.70 },  // AWP, cannon
  7: { crack: 0.07, cutoff: 4600, from: 210, to: 76, gain: 0.40 },  // MP5, snappy
};

const DEFAULT_VOICE = VOICES[4]!;

// cs::Material -> impact character.
const IMPACTS: Record<number, { freq: number; type: OscillatorType; gain: number; decay: number }> = {
  0: { freq: 240, type: "square", gain: 0.10, decay: 0.05 },   // concrete: dull knock
  1: { freq: 420, type: "triangle", gain: 0.11, decay: 0.06 }, // wood: hollow
  2: { freq: 1650, type: "square", gain: 0.09, decay: 0.09 },  // metal: ring
  3: { freq: 180, type: "sine", gain: 0.08, decay: 0.04 },     // sand: thud
};

export const DEFAULT_VOLUME = 0.5;

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = DEFAULT_VOLUME;

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private out(): AudioNode {
    this.ensure();
    return this.master!;
  }

  /**
   * Volume is stored even before the AudioContext exists: the context can only
   * be created after a user gesture, but the menu slider can move before that.
   */
  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master) this.master.gain.value = this.volume;
  }

  getVolume(): number {
    return this.volume;
  }

  /**
   * `attenuation` scales the whole voice, which is how a shot fired across the
   * map by a bot ends up quieter than the one in your hands. Not true 3D audio
   * — that is a PLAN.md M-polish item — but distance has to count for
   * something once there are nine other guns in the room.
   */
  shot(weapon: number, attenuation = 1): void {
    const ctx = this.ensure();
    const base = VOICES[weapon] ?? DEFAULT_VOICE;
    const voice = attenuation === 1
      ? base
      : { ...base, gain: base.gain * attenuation, cutoff: base.cutoff * (0.45 + 0.55 * attenuation) };
    const t = ctx.currentTime;

    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * voice.crack), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; ++i) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.22));
    }
    noise.buffer = buffer;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(voice.gain * 0.62, t);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(voice.cutoff, t);
    noise.connect(filter).connect(noiseGain).connect(this.out());
    noise.start(t);

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(voice.from, t);
    osc.frequency.exponentialRampToValueAtTime(voice.to, t + voice.crack * 0.85);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(voice.gain, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + voice.crack * 1.15);
    osc.connect(oscGain).connect(this.out());
    osc.start(t);
    osc.stop(t + voice.crack * 1.2);
  }

  private blip(freq: number, duration: number, gainValue: number,
               type: OscillatorType = "square", delay = 0): void {
    const ctx = this.ensure();
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(this.out());
    osc.start(t);
    osc.stop(t + duration);
  }

  impact(material: number, attenuation = 1): void {
    const spec = IMPACTS[material] ?? IMPACTS[0]!;
    this.blip(spec.freq * (0.9 + Math.random() * 0.2), spec.decay,
              spec.gain * attenuation, spec.type);
  }

  hit(): void {
    this.blip(1180, 0.07, 0.14);
  }

  /** Taking a bullet — low and unpleasant, so it can't be mistaken for a hit. */
  hurt(): void {
    this.blip(190, 0.16, 0.22, "sawtooth");
    this.blip(120, 0.22, 0.16, "triangle", 0.03);
  }

  kill(): void {
    // Scheduled on the audio clock, not setTimeout, so it can't jitter.
    this.blip(880, 0.07, 0.16);
    this.blip(1320, 0.1, 0.16, "square", 0.055);
  }

  dry(): void {
    this.blip(2200, 0.03, 0.1, "sawtooth");
  }
}
