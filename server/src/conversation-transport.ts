import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { DuoSession, type SessionFactory, type DuoConfig } from './duo-session.js';

export const WS_CONVERSATION_PATH = '/ws/conversation';

export interface ConversationTransportOptions {
  apiKey: string;
  sessionFactory?: SessionFactory;
  /** Max wait for the first `start` frame before closing 1008. Default 5000. */
  startTimeoutMs?: number;
}

interface Live {
  session: DuoSession;
  ws: WebSocket;
}

function isValidStart(msg: unknown): msg is { type: 'start'; languages: [string, string]; voiceOver: boolean; voiceClone: boolean } {
  const m = msg as { type?: unknown; languages?: unknown };
  return (
    m?.type === 'start' &&
    Array.isArray(m.languages) &&
    m.languages.length === 2 &&
    typeof m.languages[0] === 'string' && m.languages[0].length > 0 &&
    typeof m.languages[1] === 'string' && m.languages[1].length > 0 &&
    m.languages[0] !== m.languages[1]
  );
}

/**
 * noServer WebSocketServer for `/ws/conversation` — single-device mode.
 * The first text frame must be `start` (within startTimeoutMs); a DuoSession is
 * created for that pair. One live session at a time: a new `start` replaces it.
 */
export class ConversationTransport {
  private _apiKey: string;
  private _sessionFactory?: SessionFactory;
  private _startTimeoutMs: number;
  private _wss: WebSocketServer;
  private _live: Live | null = null;

  constructor({ apiKey, sessionFactory, startTimeoutMs = 5000 }: ConversationTransportOptions) {
    this._apiKey = apiKey;
    this._sessionFactory = sessionFactory;
    this._startTimeoutMs = startTimeoutMs;
    this._wss = new WebSocketServer({ noServer: true });
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this._wss.handleUpgrade(req, socket, head, (ws: WebSocket) => this._onConnection(ws));
  }

  /** Applies a config change to the live session. Returns false when no session is live. */
  async setConfig(cfg: Partial<DuoConfig>): Promise<boolean> {
    if (!this._live) return false;
    await this._live.session.setConfig(cfg);
    return true;
  }

  private _onConnection(ws: WebSocket): void {
    ws.on('error', (err) => {
      console.error('[conversation] ws error:', err instanceof Error ? err.message : err);
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) ws.close(1008, 'start required');
    }, this._startTimeoutMs);
    ws.on('close', () => clearTimeout(timeout));

    ws.on('message', (data: unknown, isBinary: boolean) => {
      if (started) {
        if (isBinary) {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          this._live?.session.handleAudio(buf);
          return;
        }
        let msg: { type?: unknown; from?: unknown };
        try {
          msg = JSON.parse(String(data));
        } catch {
          return; // ignore non-JSON text frames
        }
        if (msg.type === 'direction') {
          this._live?.session.setDirection(typeof msg.from === 'string' ? msg.from : null);
        }
        return;
      }

      // First frame must be a valid `start`.
      if (isBinary) return;
      let msg: unknown;
      try {
        msg = JSON.parse(String(data));
      } catch {
        ws.close(1008, 'bad start');
        return;
      }
      if (!isValidStart(msg)) {
        ws.close(1008, 'bad start');
        return;
      }
      started = true;
      clearTimeout(timeout);

      // One live session: replace any previous one.
      if (this._live) {
        const old = this._live;
        this._live = null;
        void old.session.stop();
        old.ws.close(1008, 'session replaced');
      }

      const session = new DuoSession({
        apiKey: this._apiKey,
        languages: [msg.languages[0], msg.languages[1]],
        config: { voiceOver: !!msg.voiceOver, voiceClone: !!msg.voiceClone },
        sessionFactory: this._sessionFactory,
      });
      session.on('error', ({ direction, error }: { direction: string; error: unknown }) => {
        console.error(`[duo:${direction}] error:`, error instanceof Error ? error.message : error);
      });
      session.attach({
        send: (m) => {
          if (ws.readyState === 1) ws.send(JSON.stringify(m));
        },
      });
      this._live = { session, ws };
      session
        .start()
        .then(() => {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'status', state: 'ready' }));
        })
        .catch((err: unknown) => {
          if (ws.readyState === 1)
            ws.send(JSON.stringify({ type: 'error', message: (err as Error)?.message ?? String(err) }));
        });
      ws.on('close', () => {
        if (this._live?.ws === ws) {
          this._live = null;
          void session.stop();
        }
      });
    });
  }
}
