import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';

const WS_PATH = '/ws/admin-input';

export { WS_PATH as WS_ADMIN_INPUT_PATH };

export class BrowserAudioSource extends EventEmitter {
  private _server: Server;
  private _adminPassword: string;
  private _wss: WebSocketServer | null;
  private _activeWs: WebSocket | null;
  private _suppress: boolean;

  constructor(server: Server, adminPassword: string) {
    super();
    this._server = server;
    this._adminPassword = adminPassword;
    this._wss = null;
    this._activeWs = null;
    this._suppress = false;
  }

  start(): void {
    if (this._wss) return;
    this._wss = new WebSocketServer({ noServer: true });

    this._wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      if (!this._authorize(req)) {
        ws.close(1008, 'unauthorized');
        return;
      }
      if (this._activeWs && this._activeWs.readyState === 1) {
        ws.close(1008, 'another connection is active');
        return;
      }
      this._activeWs = ws;

      ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
        if (!isBinary) return;
        if (this._suppress) return;
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        this.emit('chunk', buf);
      });

      ws.on('close', () => {
        if (this._activeWs === ws) this._activeWs = null;
      });

      ws.on('error', () => {
        if (this._activeWs === ws) this._activeWs = null;
      });
    });
  }

  private _authorize(req: IncomingMessage): boolean {
    const url = new URL(req.url ?? '/', 'http://localhost');
    return url.searchParams.get('key') === this._adminPassword;
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this._wss!.handleUpgrade(req, socket, head, (ws) => {
      this._wss!.emit('connection', ws, req);
    });
  }

  pause(): void {
    this._suppress = true;
    this.emit('paused');
  }

  resume(): void {
    this._suppress = false;
    this.emit('resumed');
  }

  stop(): void {
    if (this._activeWs) {
      try {
        this._activeWs.close(1000, 'stopped');
      } catch {
        // ignore close errors
      }
      this._activeWs = null;
    }
    this._suppress = false;
    this.emit('stopped');
  }
}
