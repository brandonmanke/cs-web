// Synthesized sounds (Web Audio, no assets) until the plan's sampled-audio
// milestone. A gunshot is built the way a recorded one is heard: the click of
// the transient, a band of crack, a distorted body thump, the report rolling
// off behind it, and the action cycling. Per-weapon numbers move those five
// layers around, which is enough for an AWP and a Glock to be told apart with
// your eyes shut. Everything shares one generated room reverb and a bus
// compressor, so a firefight glues together instead of clipping.
//
// Anything that happens at a place in the world goes through a PannerNode.
// Direction is not decoration in a shooter — footsteps behind you are the game
// telling you to turn around, and a mono mixdown throws that away. World units
// are inches, so the distance constants below are tuned in inches too.

interface ShotVoice {
  gain: number;
  /** Crack: decay in seconds and the band it sits in. */
  crack: number;
  crackHz: number;
  /** Body thump sweep, Hz, and its decay. */
  from: number;
  to: number;
  body: number;
  /** The report: seconds of lowpassed tail, and its cutoff. */
  tail: number;
  tailHz: number;
  /** Bolt or slide clatter after the shot, 0..1. */
  action: number;
  /** How much of it the room gets. */
  room: number;
}

// Keyed by cs::WeaponId. The knife is a swing, not a shot; see `shot`.
const VOICES: Record<number, ShotVoice> = {
  2: { gain: 0.28, crack: 0.035, crackHz: 1800, from: 260, to: 120, body: 0.05, tail: 0.12, tailHz: 1400, action: 0.5, room: 0.15 },  // USP, suppressed
  3: { gain: 0.42, crack: 0.05, crackHz: 3200, from: 300, to: 90, body: 0.07, tail: 0.22, tailHz: 2600, action: 0.4, room: 0.35 },    // Glock, sharp pop
  4: { gain: 0.6, crack: 0.07, crackHz: 2200, from: 170, to: 42, body: 0.12, tail: 0.38, tailHz: 1700, action: 0.35, room: 0.45 },    // AK, deep
  5: { gain: 0.52, crack: 0.06, crackHz: 3000, from: 210, to: 55, body: 0.09, tail: 0.3, tailHz: 2300, action: 0.3, room: 0.4 },      // M4, tighter
  6: { gain: 0.8, crack: 0.1, crackHz: 1500, from: 120, to: 28, body: 0.22, tail: 0.85, tailHz: 1100, action: 0, room: 0.7 },         // AWP, cannon
  7: { gain: 0.42, crack: 0.045, crackHz: 3600, from: 250, to: 80, body: 0.06, tail: 0.18, tailHz: 2800, action: 0.35, room: 0.3 },   // MP5, snappy
};
const KNIFE = 1;
const AWP = 6;

const DEFAULT_VOICE = VOICES[4]!;

// cs::Material -> impact character: a burst of debris in `band`, and the tone
// the surface itself rings at.
const IMPACTS: Record<number, { freq: number; type: OscillatorType; gain: number; decay: number; band: number }> = {
  0: { freq: 240, type: "square", gain: 0.1, decay: 0.05, band: 2600 },    // concrete: dull knock, grit
  1: { freq: 420, type: "triangle", gain: 0.11, decay: 0.06, band: 1100 }, // wood: hollow, splinter
  2: { freq: 1650, type: "square", gain: 0.09, decay: 0.09, band: 5200 },  // metal: ring
  3: { freq: 180, type: "sine", gain: 0.08, decay: 0.04, band: 700 },      // sand: thud
};
const METAL = 2;
const SAND = 3;
/** Rounds that whine off instead of just stopping: hard surfaces only. */
const RICOCHET_CHANCE = 0.14;

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

/** Seconds of generated room tail, and how loud it comes back. */
const REVERB_SECONDS = 1.3;
const REVERB_RETURN = 0.55;
/** Where in a reload the magazine leaves, seats, and the action cycles. */
const RELOAD_CUES = { out: 0.2, seat: 0.6, rack: 0.75, home: 0.85 } as const;

interface Burst {
  type: BiquadFilterType;
  freq: number;
  q?: number;
  gain: number;
  decay: number;
  /** Sweep the filter here over the decay. */
  to?: number;
}

interface Tone {
  type: OscillatorType;
  from: number;
  to?: number;
  gain: number;
  decay: number;
}

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

const SAMPLE_URLS: Record<string, string> = {
  shot_2: "/assets/audio/usp.mp3",
  shot_3: "/assets/audio/glock.mp3",
  shot_4: "/assets/audio/ak47.mp3",
  shot_5: "/assets/audio/m4a1.mp3",
  shot_6: "/assets/audio/awp.mp3",
  shot_7: "/assets/audio/mp5.mp3",
  reload_rifle: "/assets/audio/reload_rifle.mp3",
  reload_pistol: "/assets/audio/reload_pistol.mp3",
  cock: "/assets/audio/cock.mp3",
  step_stone_1: "/assets/audio/step_stone_1.mp3",
  step_stone_2: "/assets/audio/step_stone_2.mp3",
  step_stone_3: "/assets/audio/step_stone_3.mp3",
  step_sand_1: "/assets/audio/step_sand_1.mp3",
  step_sand_2: "/assets/audio/step_sand_2.mp3",
  step_sand_3: "/assets/audio/step_sand_3.mp3",
};

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private mix: GainNode | null = null;
  private room: GainNode | null = null;
  private readonly driveCurve = Float32Array.from({ length: 257 }, (_, i) => Math.tanh((i / 128 - 1) * 2.5));
  private reloading: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly samples = new Map<string, AudioBuffer>();
  private samplesLoading = false;
  private volume = DEFAULT_VOLUME;
  private occlusion: ((at: Point) => number) | null = null;

  private ensure(): AudioContext {
    if (!this.ctx) {
      const ctx = this.ctx = new AudioContext();
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(ctx.destination);
      // Everything sums here, then a fast compressor keeps ten rifles from clipping.
      const glue = ctx.createDynamicsCompressor();
      glue.threshold.value = -14;
      glue.knee.value = 10;
      glue.ratio.value = 6;
      glue.attack.value = 0.002;
      glue.release.value = 0.12;
      glue.connect(this.master);
      this.mix = ctx.createGain();
      this.mix.connect(glue);
      // One shared room: sounds send into it, it returns to the mix.
      const reverb = ctx.createConvolver();
      reverb.buffer = this.roomImpulse(ctx);
      const back = ctx.createGain();
      back.gain.value = REVERB_RETURN;
      reverb.connect(back).connect(this.mix);
      this.room = ctx.createGain();
      this.room.connect(reverb);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if (!this.samplesLoading) this.loadSamples(this.ctx);
    return this.ctx;
  }

  /** Fetch and decode CC0 firearm, reload, and footstep MP3 samples asynchronously. */
  private loadSamples(ctx: AudioContext): void {
    if (typeof fetch === "undefined") return;
    this.samplesLoading = true;
    for (const [key, url] of Object.entries(SAMPLE_URLS)) {
      void fetch(url)
        .then((res) => (res.ok ? res.arrayBuffer() : null))
        .then((buf) => (buf ? ctx.decodeAudioData(buf) : null))
        .then((decoded) => {
          if (decoded) this.samples.set(key, decoded);
        })
        .catch(() => {});
    }
  }

  private playSample(out: AudioNode, t: number, buffer: AudioBuffer, gainValue: number, rate = 1): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.setValueAtTime(rate, t);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    src.connect(gain).connect(out);
    src.start(t);
  }

  /**
   * Impulse response of a hard-walled industrial room, generated rather than
   * recorded: decaying noise that loses its highs as it goes, a different
   * draw per ear so the tail has width.
   */
  private roomImpulse(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * REVERB_SECONDS);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    const predelay = Math.floor(ctx.sampleRate * 0.012);
    for (let channel = 0; channel < 2; ++channel) {
      const data = buffer.getChannelData(channel);
      let smooth = 0;
      for (let i = predelay; i < length; ++i) {
        const t = (i - predelay) / length;
        // One-pole lowpass whose cutoff falls with time: air and walls eat treble.
        smooth += (Math.random() * 2 - 1 - smooth) * (0.75 - 0.6 * t);
        data[i] = smooth * Math.exp(-5.5 * t);
      }
    }
    return buffer;
  }

  /**
   * Build (or resume) the context from inside a user gesture. Mobile Safari
   * only ever resumes audio in a real tap handler, and the first actual sound
   * is several frames after one.
   */
  unlock(): void {
    this.ensure();
  }

  private out(): AudioNode {
    this.ensure();
    return this.mix!;
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
   * The node a sound should feed into. It reaches the mix directly for anything
   * that happens at your own hands, or through a panner placed in the world —
   * behind a lowpass if there is geometry in the way — for everything else,
   * and sends `wet` of itself to the room. The chain is torn down on a timer
   * once the sound has rung out.
   */
  private sink(at: Point | undefined, lifetime: number, wet = 0): AudioNode {
    const mix = this.out();
    const ctx = this.ctx!;
    const voice = ctx.createGain();
    const chain: AudioNode[] = [voice];
    if (at) {
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
      chain.push(panner);

      // Muffle after panning, not before: the wall takes the highs out, the head
      // still gets to say which ear heard what is left.
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
    }
    for (let i = 0; i < chain.length - 1; ++i) chain[i]!.connect(chain[i + 1]!);
    const last = chain[chain.length - 1]!;
    last.connect(mix);
    if (wet > 0) {
      // Sent after the panner, so a distant shot excites the room less.
      const send = ctx.createGain();
      send.gain.value = wet;
      last.connect(send).connect(this.room!);
      chain.push(send);
    }

    window.setTimeout(() => {
      for (const node of chain) node.disconnect();
    }, (lifetime + 0.4) * 1000);
    return voice;
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

  /** Filtered noise with an exponential decay: cracks, scuffs, debris, tails. */
  private burst(out: AudioNode, t: number, spec: Burst): void {
    const ctx = this.ctx!;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = spec.type;
    filter.frequency.setValueAtTime(spec.freq, t);
    if (spec.to) filter.frequency.exponentialRampToValueAtTime(spec.to, t + spec.decay);
    filter.Q.setValueAtTime(spec.q ?? 0.7, t);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(spec.gain, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + spec.decay);
    noise.connect(filter).connect(gain).connect(out);
    noise.start(t, Math.random() * 0.5);
    noise.stop(t + spec.decay);
  }

  /** A pitched oscillator, optionally swept, with an exponential decay. */
  private tone(out: AudioNode, t: number, spec: Tone): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.from, t);
    if (spec.to) osc.frequency.exponentialRampToValueAtTime(spec.to, t + spec.decay * 0.85);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(spec.gain, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + spec.decay);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + spec.decay * 1.05);
  }

  /** `at` places the shot in the world; omit it for the gun in your hands. */
  shot(weapon: number, at?: Point): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    if (weapon === KNIFE) {
      // A swing: air moving, rising as the blade comes round.
      this.burst(this.sink(at, 0.16), t, { type: "bandpass", freq: 600, to: 1900, q: 1.4, gain: 0.9, decay: 0.14 });
      return;
    }
    const voice = VOICES[weapon] ?? DEFAULT_VOICE;
    const sample = this.samples.get(`shot_${weapon}`);
    const pitch = 0.96 + Math.random() * 0.08;
    if (sample) {
      const sink = this.sink(at, sample.duration + 0.2, voice.room);
      this.playSample(sink, t, sample, voice.gain * 1.15, pitch);
      if (!at && weapon !== AWP) {
        const land = t + 0.34 + Math.random() * 0.16;
        for (let bounce = 0; bounce < 3; ++bounce) {
          this.tone(sink, land + bounce * (0.07 + Math.random() * 0.03), {
            type: "sine", from: 3600 + Math.random() * 1800, gain: 0.028 / (bounce + 1), decay: 0.05,
          });
        }
      }
      return;
    }

    const sink = this.sink(at, Math.max(voice.tail, 0.2), voice.room);
    // No two rounds are loaded alike; without this a spray is a drum machine.
    const g = voice.gain;

    this.burst(sink, t, { type: "highpass", freq: 5000, gain: g * 0.5, decay: 0.006 });
    this.burst(sink, t, { type: "bandpass", freq: voice.crackHz * pitch, q: 0.7, gain: g * 0.9, decay: voice.crack });
    this.burst(sink, t, { type: "lowpass", freq: voice.tailHz, to: voice.tailHz * 0.35, gain: g * 0.34, decay: voice.tail });
    // Soft clip for the body: thump with an edge on it.
    const drive = ctx.createWaveShaper();
    drive.curve = this.driveCurve;
    drive.connect(sink);
    this.tone(drive, t, { type: "triangle", from: voice.from * pitch, to: voice.to, gain: g, decay: voice.body });
    window.setTimeout(() => drive.disconnect(), (voice.body + 0.5) * 1000);

    if (voice.action > 0) {
      // Bolt carrier or slide: back, then home.
      this.burst(sink, t + 0.04, { type: "bandpass", freq: 4200, q: 3, gain: g * 0.22 * voice.action, decay: 0.02 });
      this.burst(sink, t + 0.075, { type: "bandpass", freq: 2600, q: 3, gain: g * 0.18 * voice.action, decay: 0.025 });
    }
    // Brass on the floor — only your own, and not from a bolt action you have not cycled.
    if (!at && weapon !== AWP) {
      const land = t + 0.34 + Math.random() * 0.16;
      for (let bounce = 0; bounce < 3; ++bounce) {
        this.tone(sink, land + bounce * (0.07 + Math.random() * 0.03), {
          type: "sine", from: 3600 + Math.random() * 1800, gain: 0.028 / (bounce + 1), decay: 0.05,
        });
      }
    }
  }

  /**
   * The local reload, cued to the same phases the viewmodel animates: magazine
   * out, magazine seated, action back, action home. Scheduled on the audio
   * clock through its own gain, so a cancelled reload can be cut mid-air.
   */
  reload(weapon: number, seconds: number): void {
    const ctx = this.ensure();
    this.cancelReload();
    const bus = this.reloading = ctx.createGain();
    bus.gain.value = 0.5; // handling noise sits well under a gunshot
    bus.connect(this.out());
    const send = ctx.createGain();
    send.gain.value = 0.12;
    bus.connect(send).connect(this.room!);
    const t = ctx.currentTime;
    const isPistol = weapon === 2 || weapon === 3;
    const reloadSample = this.samples.get(isPistol ? "reload_pistol" : "reload_rifle");
    if (reloadSample) {
      // Scale playback slightly so the mechanical rack lands with the sim countdown.
      const rate = Math.max(0.75, Math.min(1.35, reloadSample.duration / Math.max(0.8, seconds * 0.92)));
      this.playSample(bus, t + 0.08, reloadSample, 0.9, rate);
      window.setTimeout(() => {
        bus.disconnect();
        send.disconnect();
        if (this.reloading === bus) this.reloading = null;
      }, (seconds + 0.5) * 1000);
      return;
    }
    const heavy = weapon === AWP ? 0.8 : isPistol ? 1.5 : 1;
    const out = t + seconds * RELOAD_CUES.out, seat = t + seconds * RELOAD_CUES.seat;
    const rack = t + seconds * RELOAD_CUES.rack, home = t + seconds * RELOAD_CUES.home;
    // Release catch, and the magazine sliding free.
    this.burst(bus, out, { type: "bandpass", freq: 2400 * heavy, q: 4, gain: 0.16, decay: 0.03 });
    this.burst(bus, out + 0.03, { type: "lowpass", freq: 1200, gain: 0.07, decay: 0.09 });
    // Fresh magazine: a knock, then the catch.
    this.tone(bus, seat, { type: "triangle", from: 190 * heavy, to: 95, gain: 0.2, decay: 0.05 });
    this.burst(bus, seat, { type: "bandpass", freq: 1800 * heavy, q: 3, gain: 0.16, decay: 0.035 });
    this.burst(bus, seat + 0.05, { type: "bandpass", freq: 3400 * heavy, q: 5, gain: 0.1, decay: 0.02 });
    // Charging handle back against the spring, then slammed home.
    this.burst(bus, rack, { type: "bandpass", freq: 3000 * heavy, q: 3, gain: 0.15, decay: 0.03 });
    this.burst(bus, rack + 0.02, { type: "highpass", freq: 2500, gain: 0.04, decay: Math.max(0.03, home - rack) });
    this.burst(bus, home, { type: "bandpass", freq: 2200 * heavy, q: 3, gain: 0.2, decay: 0.035 });
    this.tone(bus, home, { type: "triangle", from: 230 * heavy, to: 110, gain: 0.16, decay: 0.045 });
    window.setTimeout(() => {
      bus.disconnect();
      send.disconnect();
      if (this.reloading === bus) this.reloading = null;
    }, (seconds + 0.5) * 1000);
  }

  /** Silence a reload that a weapon switch or a death interrupted. */
  cancelReload(): void {
    this.reloading?.disconnect();
    this.reloading = null;
  }

  /** Drawing a weapon: webbing and cloth, then the hand finding the grip. */
  draw(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime, sink = this.sink(undefined, 0.45);
    const cock = this.samples.get("cock");
    if (cock) {
      this.playSample(sink, t + 0.04, cock, 0.22, 1.15);
      return;
    }
    this.burst(sink, t, { type: "bandpass", freq: 900, to: 2200, q: 0.8, gain: 0.09, decay: 0.16 });
    this.burst(sink, t + 0.14, { type: "bandpass", freq: 2800, q: 4, gain: 0.1, decay: 0.025 });
  }

  private blip(freq: number, duration: number, gainValue: number,
               type: OscillatorType = "square", delay = 0, at?: Point): void {
    const ctx = this.ensure();
    this.tone(this.sink(at, delay + duration), ctx.currentTime + delay,
      { type, from: freq, gain: gainValue, decay: duration });
  }

  impact(material: number, at?: Point): void {
    const ctx = this.ensure();
    const spec = IMPACTS[material] ?? IMPACTS[0]!;
    const t = ctx.currentTime;
    const hard = material !== SAND;
    const whine = hard && Math.random() < RICOCHET_CHANCE;
    const sink = this.sink(at, whine ? 0.4 : spec.decay + 0.1, 0.2);
    this.tone(sink, t, { type: spec.type, from: spec.freq * (0.9 + Math.random() * 0.2), gain: spec.gain, decay: spec.decay });
    // Whatever the round knocked loose.
    this.burst(sink, t, { type: "bandpass", freq: spec.band, q: 1.2, gain: spec.gain * 1.4, decay: spec.decay * 1.6 });
    if (material === METAL) this.tone(sink, t, { type: "sine", from: 3100 + Math.random() * 900, gain: 0.035, decay: 0.22 });
    if (whine) {
      this.tone(sink, t + 0.01, { type: "sine", from: 2400 + Math.random() * 1400, to: 700, gain: 0.05, decay: 0.32 });
    }
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
    const sink = this.sink(at, Math.max(decay * 1.2, 0.2), 0.14);
    const level = spec.gain * (hard ? 2.4 : 1.1 + Math.random() * 0.4);
    // Vary the band per step, or a run reads as a metronome.
    const vary = 0.88 + Math.random() * 0.24;
    const pick = 1 + Math.floor(Math.random() * 3);
    const stepSample = material === 0
      ? this.samples.get(`step_stone_${pick}`)
      : material === SAND
        ? this.samples.get(`step_sand_${pick}`)
        : undefined;
    if (stepSample) {
      this.playSample(sink, t, stepSample, Math.min(1, level * 1.15), vary);
      if (hard) this.tone(sink, t, { type: "sine", from: 110, to: 48, gain: 0.28, decay });
      return;
    }

    // The sole: surface-coloured scuff. The heel: weight arriving under it.
    this.burst(sink, t, { type: "bandpass", freq: spec.cutoff * vary, q: spec.q, gain: level, decay });
    this.tone(sink, t, { type: "sine", from: 105 * vary, to: 58, gain: level * (material === SAND ? 0.3 : 0.55), decay: 0.05 });
    if (material === METAL) {
      // Grating rattles in its frame after the boot has left it.
      this.burst(sink, t + 0.01, { type: "bandpass", freq: 5200 * vary, q: 8, gain: level * 0.3, decay: 0.15 });
      this.tone(sink, t, { type: "triangle", from: 640 * vary, gain: level * 0.12, decay: 0.09 });
    } else if (material === 1) {
      this.tone(sink, t, { type: "triangle", from: 215 * vary, to: 150, gain: level * 0.5, decay: 0.08 }); // plank body
    } else if (material === SAND) {
      this.burst(sink, t + 0.012, { type: "lowpass", freq: 950, gain: level * 0.5, decay: 0.14 }); // crunch
    } else {
      this.burst(sink, t, { type: "highpass", freq: 3200, gain: level * 0.18, decay: 0.022 }); // grit
    }

    if (hard) this.tone(sink, t, { type: "sine", from: 110, to: 48, gain: 0.28, decay });
  }

  hit(): void {
    this.blip(1180, 0.07, 0.14);
  }

  /** Taking a bullet — low and unpleasant, so it can't be mistaken for a hit. */
  hurt(): void {
    this.burst(this.sink(undefined, 0.12), this.ensure().currentTime,
      { type: "lowpass", freq: 320, gain: 0.3, decay: 0.09 });
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
