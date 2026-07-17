// Synthesized sounds (Web Audio, no assets) until the plan's sampled-audio milestone.

export class GameAudio {
  private ctx: AudioContext | null = null;

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  shot(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    // Noise crack
    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.09, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; ++i) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.22));
    }
    noise.buffer = buffer;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.34, t);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(3600, t);
    noise.connect(filter).connect(noiseGain).connect(ctx.destination);
    noise.start(t);
    // Low thump
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(52, t + 0.08);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.5, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.11);
  }

  private blip(freq: number, duration: number, gainValue: number, type: OscillatorType = "square"): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }

  hit(): void {
    this.blip(1180, 0.07, 0.14);
  }

  kill(): void {
    this.blip(880, 0.07, 0.16);
    setTimeout(() => this.blip(1320, 0.1, 0.16), 55);
  }

  dry(): void {
    this.blip(2200, 0.03, 0.1, "sawtooth");
  }
}
