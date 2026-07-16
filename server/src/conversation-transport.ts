import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { ConversationManager } from './conversation-manager.js';

export const WS_CONVERSATION_PATH = '/ws/conversation';

/**
 * noServer WebSocketServer for the `/ws/conversation` endpoint. Authenticates
 * each upgrade via `?token=` resolved against the ConversationManager, then
 * attaches the participant socket to the room's ConversationSession.
 */
export class ConversationTransport {
  private _manager: ConversationManager;
  private _wss: WebSocketServer;

  constructor(manager: ConversationManager) {
    this._manager = manager;
    this._wss = new WebSocketServer({ noServer: true });
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this._wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      const url = new URL(req.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token');
      const resolved = token && this._manager.resolve(token);
      if (!resolved) {
        ws.close(1008, 'unauthorized');
        return;
      }
      const room = this._manager.getRoom(resolved.roomId);
      if (!room) {
        ws.close(1008, 'room not found');
        return;
      }
      room.session.attachParticipant(resolved.role, ws);
    });
  }
}
