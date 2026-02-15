import { GUNSHOT_DURATION, HIT_SOUND_DURATION, HIT_SOUND_FREQ } from "./constants";

export class AudioManager {
  private ctx: AudioContext | null = null;

  private getCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  resume(): void {
    if (this.ctx?.state === "suspended") this.ctx.resume();
  }

  playGunshot(): void {
    const ctx = this.getCtx();
    const bufferSize = ctx.sampleRate * GUNSHOT_DURATION;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // White noise burst with decay
    for (let i = 0; i < bufferSize; i++) {
      const t = i / bufferSize;
      data[i] = (Math.random() * 2 - 1) * (1 - t) * 0.6;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Low-pass to give it more body
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2000;

    const gain = ctx.createGain();
    gain.gain.value = 0.4;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  }

  playHitSound(): void {
    const ctx = this.getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = HIT_SOUND_FREQ;

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      ctx.currentTime + HIT_SOUND_DURATION
    );

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + HIT_SOUND_DURATION);
  }
}
