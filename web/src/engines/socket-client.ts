import type { ConversationWsMessage } from '@v2/shared';

/**
 * Options for constructing a {@link SocketClient}.
 */
export interface SocketClientOptions {
  /** Full WebSocket URL (e.g. `wss://host/ws/conversation?token=...`). */
  url: string;
  /** Called for every JSON message dispatched from the socket. */
  onMessage: (m: ConversationWsMessage) => void;
  /** Called once when the socket closes terminally (code 1008 or explicit close). No reconnect follows. */
  onCloseTerminal?: () => void;
  /** Called when the socket opens (including after a reconnect). */
  onOpen?: () => void;
  /** Called when a transient close schedules a reconnect (drive a "reconnecting" UI). */
  onReconnecting?: () => void;
  /** Injectable WebSocket constructor (defaults to the global one). Enables fake-timer unit tests. */
  WebSocketCtor?: typeof WebSocket;
  /** Base delay (ms) for the first reconnect; doubles each attempt, capped at 60s. Defaults to 1000. */
  reconnectBaseDelay?: number;
}

/**
 * Framework-agnostic client for the `/ws/conversation` socket.
 *
 * - Connects with `connect()`, dispatches parsed JSON via `onMessage`.
 * - On a transient close, reconnects with exponential backoff (`min(60s, base * 2**(attempts-1))`).
 * - On close code 1008 (room gone / ended) or an explicit `close()`, fires `onCloseTerminal` and stops.
 * - `sendAudio(pcm)` sends raw PCM bytes when the socket is OPEN.
 */
export class SocketClient {
  private readonly opts: SocketClientOptions;
  private readonly _base: number;
  private _ws: WebSocket | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _attempts = 0;
  private _closed = false;

  constructor(opts: SocketClientOptions) {
    this.opts = opts;
    this._base = opts.reconnectBaseDelay ?? 1000;
  }

  /** Open the socket (also used internally for reconnects). No-op after a terminal close. */
  connect(): void {
    if (this._closed) return;
    const ws = this._openSocket();
    this._ws = ws;

    this._attach(ws, 'open', () => {
      if (ws !== this._ws) return; // stale socket
      this._attempts = 0;
      this.opts.onOpen?.();
    });

    this._attach(ws, 'message', (ev: { data: unknown }) => {
      if (ws !== this._ws) return; // stale socket
      try {
        const msg = JSON.parse(ev.data as string) as ConversationWsMessage;
        this.opts.onMessage(msg);
      } catch {
        // Ignore malformed / non-JSON frames.
      }
    });

    this._attach(ws, 'close', (ev: { code: number }) => {
      // 1008 = room gone / ended, or the client called close() -> terminal, no reconnect.
      if (ev.code === 1008 || this._closed) {
        this.opts.onCloseTerminal?.();
        return;
      }
      this._scheduleReconnect();
    });

    this._attach(ws, 'error', () => {
      // A close event always follows an error; reconnect logic lives on close.
    });
  }

  /** Send raw PCM audio bytes. Only sends when the socket is OPEN. */
  sendAudio(pcm: ArrayBuffer): void {
    if (this._ws && this._ws.readyState === 1 /* OPEN */) {
      this._ws.send(pcm);
    }
  }

  /** Close the socket permanently. Fires `onCloseTerminal` (via the close event) and never reconnects. */
  close(): void {
    this._closed = true;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._ws?.close();
  }

  // ---- internals ----

  /**
   * Construct the underlying socket. Native `WebSocket` requires `new`, but the
   * injected test double is an arrow function (cannot be `new`'d) — try/catch bridges both.
   */
  private _openSocket(): WebSocket {
    const Ctor: any = this.opts.WebSocketCtor ?? WebSocket;
    try {
      return new Ctor(this.opts.url);
    } catch {
      return Ctor(this.opts.url);
    }
  }

  /**
   * Attach a handler. Native `WebSocket` uses `addEventListener`; the test double uses `.on`.
   */
  private _attach(ws: any, ev: string, fn: Function): void {
    if (typeof ws.addEventListener === 'function') {
      ws.addEventListener(ev, fn as EventListener);
    } else if (typeof ws.on === 'function') {
      ws.on(ev, fn);
    }
  }

  /** Schedule a reconnect with exponential backoff: `min(60000, base * 2**(attempts-1))`. */
  private _scheduleReconnect(): void {
    this.opts.onReconnecting?.();
    this._attempts += 1;
    const delay = Math.min(60000, this._base * 2 ** (this._attempts - 1));
    this._timer = setTimeout(() => {
      this._timer = null;
      this.connect();
    }, delay);
  }
}
