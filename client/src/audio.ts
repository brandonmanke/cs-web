// Synthesized sounds (Web Audio, no assets) until the plan's sampled-audio
// milestone. Every weapon gets its own voice out of the same three ingredients:
// a filtered noise crack, a pitched body thump, and a tail. That is enough for
// an AWP and a Glock to be told apart with your eyes shut, which is the point.
//
// Anything that happens at a place in the world goes through a PannerNode.
// Direction is not decoration in a shooter — footsteps behind you are the game
// telling you to turn around, and a mono mixdown throws that away. World units
// are inches, so the distance constants below are tuned in inches too.

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

// cs::Material -> footstep character. A bandpassed noise burst is most of what
// a footstep is; the material only moves where the band sits and how long it
// rings.
const STEPS: Record<number, { cutoff: number; q: number; gain: number; decay: number }> = {
  0: { cutoff: 1500, q: 1.1, gain: 0.34, decay: 0.055 }, // concrete: flat scuff
  1: { cutoff: 900, q: 2.4, gain: 0.36, decay: 0.075 },  // wood: hollow knock
  2: { cutoff: 2700, q: 3.6, gain: 0.30, decay: 0.115 }, // metal: grate ring
  3: { cutoff: 620, q: 0.8, gain: 0.28, decay: 0.09 },   // sand: soft, no edge
};

export const DEFAULT_VOLUME = 0.5;

/** Falloff tuning, in GoldSrc units (1u = 1 inch). */
const REF_DISTANCE = 180;
const MAX_DISTANCE = 6000;
const ROLLOFF = 0.9;

/**
 * Muffling by wall count. Distance alone can't tell you whether the AWP that
 * just went off is down your corridor or through the wall behind you, and in
 * 1.6 that difference is the whole reason you turn one way and not the other.
 * High frequencies are what a wall eats, so a lowpass carries the information
 * and the gain drop only sells it.
 */
const OCCLUSION = [
  { cutoff: 22000, gain: 1.0 },  // clear line
  { cutoff: 1300, gain: 0.55 },  // one wall: dull, still placeable
  { cutoff: 620, gain: 0.30 },   // two: a rumour
  { cutoff: 320, gain: 0.16 },   // three or more: barely there
] as const;

type Point = readonly number[];

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = DEFAULT_VOLUME;
  private occlusion: ((at: Point) => number) | null = null;

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
   * Where the ears are. Called every frame from the camera; a no-op until the
   * context exists, because that can only happen after a user gesture and we
   * are not going to create one just to point it somewhere.
   */
  setListener(pos: Point, forward: Point, up: Point): void {
    const listener = this.ctx?.listener;
    if (!listener) return;
    if (listener.positionX) {
      listener.positionX.value = pos[0]!;
      listener.positionY.value = pos[1]!;
      listener.positionZ.value = pos[2]!;
      listener.forwardX.value = forward[0]!;
      listener.forwardY.value = forward[1]!;
      listener.forwardZ.value = forward[2]!;
      listener.upX.value = up[0]!;
      listener.upY.value = up[1]!;
      listener.upZ.value = up[2]!;
    } else {
      // Safari still only has the deprecated setters.
      listener.setPosition(pos[0]!, pos[1]!, pos[2]!);
      listener.setOrientation(forward[0]!, forward[1]!, forward[2]!, up[0]!, up[1]!, up[2]!);
    }
  }

  /**
   * How many walls stand between the ears and a point. Supplied by the game,
   * which owns the sim and therefore the only ray tracer in the build; without
   * one every sound is treated as being in the open.
   */
  setOcclusionProbe(probe: (at: Point) => number): void {
    this.occlusion = probe;
  }

  /**
   * The node a sound should feed into: the master bus for anything that
   * happens at your own hands, or a panner placed in the world — behind a
   * lowpass if there is geometry in the way — for everything else. The chain is
   * torn down on a timer once the sound has rung out.
   */
  private sink(at: Point | undefined, lifetime: number): AudioNode {
    const master = this.out();
    if (!at) return master;
    const ctx = this.ctx!;
    const panner = ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = REF_DISTANCE;
    panner.maxDistance = MAX_DISTANCE;
    panner.rolloffFactor = ROLLOFF;
    if (panner.positionX) {
      panner.positionX.value = at[0]!;
      panner.positionY.value = at[1]!;
      panner.positionZ.value = at[2]!;
    } else {
      panner.setPosition(at[0]!, at[1]!, at[2]!);
    }

    // Muffle after panning, not before: the wall takes the highs out, the head
    // still gets to say which ear heard what is left.
    const chain: AudioNode[] = [panner];
    const walls = Math.min(this.occlusion?.(at) ?? 0, OCCLUSION.length - 1);
    if (walls > 0) {
      const spec = OCCLUSION[walls]!;
      const muffle = ctx.createBiquadFilter();
      muffle.type = "lowpass";
      muffle.frequency.value = spec.cutoff;
      const gain = ctx.createGain();
      gain.gain.value = spec.gain;
      chain.push(muffle, gain);
    }
    for (let i = 0; i < chain.length - 1; ++i) chain[i]!.connect(chain[i + 1]!);
    chain[chain.length - 1]!.connect(master);

    window.setTimeout(() => {
      for (const node of chain) node.disconnect();
    }, (lifetime + 0.4) * 1000);
    return panner;
  }

  /** One second of white noise, generated once and re-used by every burst. */
  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; ++i) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    }
    return this.noise;
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

  /** `at` places the shot in the world; omit it for the gun in your hands. */
  shot(weapon: number, at?: Point): void {
    const ctx = this.ensure();
    const voice = VOICES[weapon] ?? DEFAULT_VOICE;
    const t = ctx.currentTime;
    const sink = this.sink(at, voice.crack * 1.4);

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(ctx);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(voice.gain * 0.62, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + voice.crack);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(voice.cutoff, t);
    noise.connect(filter).connect(noiseGain).connect(sink);
    noise.start(t, Math.random() * 0.5);
    noise.stop(t + voice.crack);

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(voice.from, t);
    osc.frequency.exponentialRampToValueAtTime(voice.to, t + voice.crack * 0.85);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(voice.gain, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + voice.crack * 1.15);
    osc.connect(oscGain).connect(sink);
    osc.start(t);
    osc.stop(t + voice.crack * 1.2);
  }

  private blip(freq: number, duration: number, gainValue: number,
               type: OscillatorType = "square", delay = 0, at?: Point): void {
    const ctx = this.ensure();
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(this.sink(at, delay + duration));
    osc.start(t);
    osc.stop(t + duration);
  }

  impact(material: number, at?: Point): void {
    const spec = IMPACTS[material] ?? IMPACTS[0]!;
    this.blip(spec.freq * (0.9 + Math.random() * 0.2), spec.decay, spec.gain,
              spec.type, 0, at);
  }

  /**
   * A footfall. `hard` is a landing rather than a stride: same surface, more
   * of it, plus a body thump underneath.
   */
  step(material: number, at: Point | undefined, hard: boolean): void {
    const ctx = this.ensure();
    const spec = STEPS[material] ?? STEPS[0]!;
    const t = ctx.currentTime;
    const decay = spec.decay * (hard ? 1.7 : 1);
    const sink = this.sink(at, decay * 1.2);

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(ctx);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    // Vary the band per step, or a run reads as a metronome.
    band.frequency.setValueAtTime(spec.cutoff * (0.88 + Math.random() * 0.24), t);
    band.Q.setValueAtTime(spec.q, t);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(spec.gain * (hard ? 1.9 : 0.85 + Math.random() * 0.3), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    noise.connect(band).connect(gain).connect(sink);
    noise.start(t, Math.random() * 0.5);
    noise.stop(t + decay);

    if (hard) {
      const thump = ctx.createOscillator();
      thump.type = "sine";
      thump.frequency.setValueAtTime(110, t);
      thump.frequency.exponentialRampToValueAtTime(48, t + decay);
      const thumpGain = ctx.createGain();
      thumpGain.gain.setValueAtTime(0.28, t);
      thumpGain.gain.exponentialRampToValueAtTime(0.001, t + decay);
      thump.connect(thumpGain).connect(sink);
      thump.start(t);
      thump.stop(t + decay * 1.1);
    }
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
