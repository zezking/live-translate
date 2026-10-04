/**
 * Options for constructing a {@link MicCaptureEngine}.
 */
export interface MicCaptureEngineOptions {
  /** URL of the `pcm-capture` AudioWorklet module (e.g. `/pcm-worklet.js`). */
  workletUrl: string;
  /** Called for every 16 kHz 16-bit mono PCM chunk emitted by the worklet. */
  onAudio: (pcm: ArrayBuffer) => void;
}

/**
 * Framework-agnostic microphone capture engine — a port of the v1
 * `public/conversation.js` `startMicCapture` pattern (and `admin.js`
 * `setupBrowserCapture`'s AudioWorklet pipeline) as a reusable class.
 *
 * Captures the mic at **16 kHz** via `getUserMedia` + an `AudioWorkletNode`
 * registered as `pcm-capture` (see `web/public/pcm-worklet.js`), converts to
 * 16-bit PCM inside the worklet, and forwards each binary chunk to `onAudio`.
 *
 * - `start(deviceId?)` acquires the mic, lazily creates the 16 kHz
 *   `AudioContext`, loads the worklet module once, and wires
 *   `source → worklet` with `port.onmessage → onAudio`.
 * - `setDevice(deviceId)` switches the active input without tearing down the
 *   context: stops the old tracks, disconnects the old nodes, and re-acquires.
 * - `stop()` stops the tracks, disconnects the nodes, and closes the context.
 * - `listDevices()` enumerates `audioinput` devices.
 *
 * Browser-only (uses `getUserMedia`, `AudioContext`, `AudioWorkletNode`); there
 * is no automated test — it is manual-verified in Plan 5 with a real browser.
 *
 * No React; safe to use from the conversation page (Plan 5).
 */
export class MicCaptureEngine {
  private readonly _workletUrl: string;
  private readonly _onAudio: (pcm: ArrayBuffer) => void;

  private _ctx: AudioContext | null = null;
  private _stream: MediaStream | null = null;
  private _source: MediaStreamAudioSourceNode | null = null;
  private _worklet: AudioWorkletNode | null = null;
  private _moduleAdded = false;
  private _deviceId: string | undefined;

  constructor(opts: MicCaptureEngineOptions) {
    this._workletUrl = opts.workletUrl;
    this._onAudio = opts.onAudio;
  }

  /** The deviceId currently captured (undefined = default device). */
  get deviceId(): string | undefined {
    return this._deviceId;
  }

  /** Whether capture is currently active (context + stream alive). */
  get active(): boolean {
    return this._ctx !== null && this._stream !== null;
  }

  /**
   * Start capturing the microphone. Lazily creates the 16 kHz `AudioContext`
   * and loads the `pcm-capture` worklet module once (reused across device
   * switches). Call from a user gesture to satisfy browser permission/autoplay
   * policies.
   */
  async start(deviceId?: string): Promise<void> {
    this._deviceId = deviceId;
    await this._ensureContext();
    await this._acquire(deviceId);
  }

  /**
   * Switch the active microphone input without tearing down the context.
   * Stops the old tracks, disconnects the old source/worklet, and re-acquires
   * with the new `deviceId`. Mirrors v1 `startMicCapture`'s re-acquire path.
   */
  async setDevice(deviceId: string): Promise<void> {
    this._deviceId = deviceId;
    // Reuse the existing context; just swap the input stream + graph.
    await this._acquire(deviceId);
  }

  /**
   * Stop capturing: stop the media tracks, disconnect the worklet/source, and
   * close the `AudioContext`. Safe to call when already stopped.
   */
  async stop(): Promise<void> {
    this._teardownGraph();
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }
    if (this._ctx) {
      try {
        await this._ctx.close();
      } catch {
        // Context may already be closed.
      }
      this._ctx = null;
    }
    this._moduleAdded = false;
    this._deviceId = undefined;
  }

  /** Enumerate available microphone inputs (`kind === 'audioinput'`). */
  async listDevices(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  }

  // ---- internals ----

  /**
   * Lazily create the 16 kHz `AudioContext` and load the worklet module once.
   * Reuses an existing context across device switches.
   */
  private async _ensureContext(): Promise<AudioContext> {
    if (this._ctx) return this._ctx;

    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ sampleRate: 16000 });
    this._ctx = ctx;

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Resume can reject without a user gesture; the caller owns that.
      }
    }
    return ctx;
  }

  /**
   * Acquire a mic stream for `deviceId`, build the `source → worklet` graph,
   * and wire `port.onmessage → onAudio`. Any previously built graph is torn
   * down first (old tracks stopped), so this powers both `start` and
   * `setDevice`. The worklet module is added once per context.
   */
  private async _acquire(deviceId?: string): Promise<void> {
    const ctx = this._ctx;
    if (!ctx) throw new Error('MicCaptureEngine._acquire called before _ensureContext');

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    // Stop the previous stream + disconnect its nodes before swapping in.
    this._teardownGraph();
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
    }
    this._stream = stream;

    if (!this._moduleAdded) {
      await ctx.audioWorklet.addModule(this._workletUrl);
      this._moduleAdded = true;
    }

    const source = ctx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(ctx, 'pcm-capture', {
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    source.connect(worklet);
    worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      this._onAudio(e.data);
    };

    this._source = source;
    this._worklet = worklet;
  }

  /** Disconnect the current source/worklet nodes (does not stop tracks). */
  private _teardownGraph(): void {
    if (this._worklet) {
      try {
        this._worklet.port.onmessage = null;
        this._worklet.disconnect();
      } catch {
        // Node may already be disconnected.
      }
      this._worklet = null;
    }
    if (this._source) {
      try {
        this._source.disconnect();
      } catch {
        // Node may already be disconnected.
      }
      this._source = null;
    }
  }
}
