/**
 * Options for constructing a {@link PlaybackEngine}.
 */
export interface PlaybackEngineOptions {
  /**
   * Injectable `AudioContext` constructor. Defaults to the global
   * `AudioContext`. Inject a fake to unit-test the scheduler without real audio.
   */
  AudioContextCtor?: typeof AudioContext;
  /** PCM sample rate of the queued chunks. Defaults to 24000 (24 kHz). */
  sampleRate?: number;
}

/**
 * Framework-agnostic 24 kHz gapless PCM playback engine — a port of the v1
 * `public/attendee.js` `queueAudio` / `stopAllAudio` scheduler, as a reusable
 * class with an injectable `AudioContextCtor` so the scheduling logic is
 * unit-testable with a fake AudioContext.
 *
 * - `ensureContext()` lazily creates the `AudioContext` (call from a user gesture).
 * - `queueAudio(base64)` decodes base64 → Int16 → Float32, creates a buffer at
 *   `sampleRate`, and schedules it gaplessly via `nextPlayTime`.
 * - `stopAll()` stops every active source and resets `nextPlayTime`.
 *
 * No React; safe to use from the conversation page (Plan 5) and the church attendee.
 */
export class PlaybackEngine {
  private readonly _AudioContextCtor: typeof AudioContext | undefined;
  private readonly _sampleRate: number;
  private _ctx: AudioContext | null = null;
  private _gain: GainNode | null = null;
  private _nextPlayTime = 0;
  private _activeSources: AudioBufferSourceNode[] = [];

  constructor(opts?: PlaybackEngineOptions) {
    this._AudioContextCtor = opts?.AudioContextCtor;
    this._sampleRate = opts?.sampleRate ?? 24000;
  }

  /**
   * Lazily create (and resume) the AudioContext + a master gain node, returning
   * the context. Subsequent calls reuse the same context. Call from a user
   * gesture (Plan 5) to satisfy browser autoplay policies.
   */
  async ensureContext(): Promise<AudioContext> {
    if (this._ctx) return this._ctx;

    const Ctor: any = this._AudioContextCtor ?? AudioContext;
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ sampleRate: this._sampleRate }) as AudioContext;
    } catch {
      // Injectable doubles may be arrow functions (cannot be `new`-ed).
      ctx = Ctor({ sampleRate: this._sampleRate }) as AudioContext;
    }
    this._ctx = ctx;

    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    this._gain = gain;

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    return ctx;
  }

  /**
   * Decode a base64-encoded 16-bit PCM chunk and schedule it gaplessly after
   * any previously queued chunk. Mirrors v1 `queueAudio`. If the context is
   * suspended, resumes it and skips this chunk (as v1 does).
   */
  queueAudio(base64: string): void {
    const ctx = this._ctx;
    if (!ctx) return;

    // Guard: if suspended, resume and skip this chunk (v1 behaviour).
    if (ctx.state === 'suspended') {
      void ctx.resume();
      return;
    }

    // base64 → raw bytes → Int16 (little-endian) → Float32 [-1, 1].
    const raw = atob(base64);
    const pcm = new Int16Array(raw.length / 2);
    for (let i = 0; i < raw.length; i += 2) {
      pcm[i / 2] = (raw.charCodeAt(i + 1) << 8) | raw.charCodeAt(i);
    }
    const float32 = new Float32Array(pcm.length);
    for (let j = 0; j < pcm.length; j++) {
      float32[j] = pcm[j] / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, this._sampleRate);
    buffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this._gain!);
    source.onended = () => {
      const idx = this._activeSources.indexOf(source);
      if (idx > -1) this._activeSources.splice(idx, 1);
    };
    this._activeSources.push(source);

    // Gapless scheduling: if we've fallen behind, restart from now.
    const now = ctx.currentTime;
    if (this._nextPlayTime < now) {
      this._nextPlayTime = now;
    }
    source.start(this._nextPlayTime);
    this._nextPlayTime += buffer.duration;
  }

  /**
   * Stop every active source immediately and reset `nextPlayTime` to the
   * context's current time, so the next `queueAudio` plays right away.
   * Mirrors v1 `stopAllAudio`.
   */
  stopAll(): void {
    for (let i = this._activeSources.length - 1; i >= 0; i--) {
      try {
        this._activeSources[i].stop();
      } catch {
        // Source may have already ended/stopped.
      }
    }
    this._activeSources = [];
    this._nextPlayTime = this._ctx ? this._ctx.currentTime : 0;
  }

  /** Set the master playback volume (0..1+). Safe before context exists. */
  setVolume(v: number): void {
    if (this._gain) this._gain.gain.value = v;
  }

  /** Close and release the underlying AudioContext. */
  close(): void {
    this.stopAll();
    this._ctx?.close();
    this._ctx = null;
    this._gain = null;
  }
}
