import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';

const WS_PATH = '/ws/admin-input';

export { WS_PATH as WS_ADMIN_INPUT_PATH };

export class BrowserAudioSource extends EventEmitter {
  constructor(server, adminPassword) {
    super();
    this._server = server;
    this._adminPassword = adminPassword;
    this._wss = null;
    this._activeWs = null;
    this._suppress = false;
  }

  start() {
    if (this._wss) return;
    this._wss = new WebSocketServer({ noServer: true });

    this._wss.on('connection', (ws, req) => {
      if (!this._authorize(req)) {
        ws.close(1008, 'unauthorized');
        return;
      }
      if (this._activeWs && this._activeWs.readyState === 1) {
        ws.close(1008, 'another connection is active');
        return;
      }
      this._activeWs = ws;

      ws.on('message', (data, isBinary) => {
        if (!isBinary) return;
        if (this._suppress) return;
        this.emit('chunk', Buffer.isBuffer(data) ? data : Buffer.from(data));
      });

      ws.on('close', () => {
        if (this._activeWs === ws) this._activeWs = null;
      });

      ws.on('error', () => {
        if (this._activeWs === ws) this._activeWs = null;
      });
    });
  }

  _authorize(req) {
    const url = new URL(req.url, 'http://localhost');
    return url.searchParams.get('key') === this._adminPassword;
  }

  handleUpgrade(req, socket, head) {
    this._wss.handleUpgrade(req, socket, head, (ws) => {
      this._wss.emit('connection', ws, req);
    });
  }

  pause() {
    this._suppress = true;
    this.emit('paused');
  }

  resume() {
    this._suppress = false;
    this.emit('resumed');
  }

  stop() {
    if (this._activeWs) {
      try { this._activeWs.close(1000, 'stopped'); } catch {}
      this._activeWs = null;
    }
    this._suppress = false;
    this.emit('stopped');
  }
}
