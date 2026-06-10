import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';

export class AudioBroadcaster extends EventEmitter {
  constructor(server) {
    super();
    this.clients = new Map();
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      const clientId = Date.now().toString(36) + Math.random().toString(36).slice(2);
      const clientInfo = { languageCode: null, mode: 'audio', ws };

      this.clients.set(clientId, clientInfo);
      this.emit('clientConnected', { clientId, totalClients: this.clients.size });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'selectLanguage') {
            clientInfo.languageCode = msg.languageCode;
          }
          if (msg.type === 'setMode') {
            clientInfo.mode = msg.mode;
          }
        } catch (e) {
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

  broadcastAudio(languageCode, pcmBuffer) {
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

  broadcastTranscription(languageCode, type, text) {
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

  broadcastStatus(status) {
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

  getClientCount() {
    return this.clients.size;
  }

  getClientsByLanguage() {
    const counts = {};
    for (const [, client] of this.clients) {
      if (client.languageCode) {
        counts[client.languageCode] = (counts[client.languageCode] || 0) + 1;
      }
    }
    return counts;
  }

  close() {
    for (const [, client] of this.clients) {
      client.ws.close();
    }
    this.wss.close();
  }
}
