import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import type { Server } from 'http';

interface ClientInfo {
  languageCode: string | null;
  mode: 'audio' | 'text';
  ws: WebSocket;
}

interface SelectLanguageMessage {
  type: 'selectLanguage';
  languageCode: string;
}

interface SetModeMessage {
  type: 'setMode';
  mode: 'audio' | 'text';
}

type ClientMessage = SelectLanguageMessage | SetModeMessage;

export class AudioBroadcaster extends EventEmitter {
  clients: Map<string, ClientInfo>;
  wss: WebSocketServer;

  constructor(server: Server) {
    super();
    this.clients = new Map();
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = Date.now().toString(36) + Math.random().toString(36).slice(2);
      const clientInfo: ClientInfo = { languageCode: null, mode: 'audio', ws };

      this.clients.set(clientId, clientInfo);
      this.emit('clientConnected', { clientId, totalClients: this.clients.size });

      ws.on('message', (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString()) as ClientMessage;
          if (msg.type === 'selectLanguage') {
            clientInfo.languageCode = msg.languageCode ?? null;
          } else if (msg.type === 'setMode') {
            clientInfo.mode = msg.mode ?? 'audio';
          }
        } catch {
          // ignore malformed messages
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        this.emit('clientDisconnected', { clientId, totalClients: this.clients.size });
      });

      ws.on('error', () => {
        this.clients.delete(clientId);
      });
    });
  }

  broadcastAudio(languageCode: string, pcmBuffer: Buffer): void {
    const base64 = pcmBuffer.toString('base64');
    const message = JSON.stringify({
      type: 'audio',
      languageCode,
      data: base64,
    });

    for (const [, client] of this.clients) {
      if (client.languageCode === languageCode && client.mode === 'audio' && client.ws.readyState === 1) {
        client.ws.send(message);
      }
    }
  }

  broadcastTranscription(languageCode: string, type: string, text: string): void {
    const message = JSON.stringify({
      type: 'transcription',
      languageCode,
      transcriptionType: type,
      text,
    });

    for (const [, client] of this.clients) {
      if (client.languageCode === languageCode && client.mode === 'text' && client.ws.readyState === 1) {
        client.ws.send(message);
      }
    }
  }

  broadcastStatus(status: Record<string, unknown>): void {
    const message = JSON.stringify({
      type: 'status',
      ...status,
    });

    for (const [, client] of this.clients) {
      if (client.ws.readyState === 1) {
        client.ws.send(message);
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getClientsByLanguage(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [, client] of this.clients) {
      if (client.languageCode) {
        counts[client.languageCode] = (counts[client.languageCode] || 0) + 1;
      }
    }
    return counts;
  }

  close(): void {
    for (const [, client] of this.clients) {
      client.ws.close();
    }
    this.wss.close();
  }
}
