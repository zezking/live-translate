import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'events';
import {
  ConversationSession,
  type ConversationConfig,
  type ConversationNames,
  type SessionFactory,
  type RouterFactory,
} from './conversation-session.js';

interface RoomData {
  session: ConversationSession;
  tokens: {
    host: string;
    joiner: string;
  };
}

interface TokenResolution {
  roomId: string;
  role: 'host' | 'joiner';
}

export interface CreateRoomOptions {
  apiKey: string;
  sessionFactory?: SessionFactory;
  routerFactory?: RouterFactory;
  names?: ConversationNames;
  config?: Partial<ConversationConfig>;
}

export interface CreateRoomResult {
  roomId: string;
  hostToken: string;
  joinToken: string;
  session: ConversationSession;
}

/**
 * Room registry that mints rooms + host/join tokens and resolves tokens → {room, role}.
 */
export class ConversationManager extends EventEmitter {
  private _rooms = new Map<string, RoomData>(); // roomId -> { session, tokens: { host, joiner } }
  private _tokenToRoom = new Map<string, TokenResolution>(); // token -> { roomId, role }

  /**
   * Create a new conversation room with distinct host and join tokens.
   */
  createRoom({ apiKey, sessionFactory, routerFactory, names, config }: CreateRoomOptions): CreateRoomResult {
    const roomId = randomBytes(6).toString('hex');
    const hostToken = randomBytes(12).toString('hex');
    const joinToken = randomBytes(12).toString('hex');

    const session = new ConversationSession({
      apiKey,
      sessionFactory,
      routerFactory,
      names,
      config,
    });

    // Forward session errors
    session.on('error', (err: unknown) => this.emit('error', err));

    this._rooms.set(roomId, { session, tokens: { host: hostToken, joiner: joinToken } });
    this._tokenToRoom.set(hostToken, { roomId, role: 'host' });
    this._tokenToRoom.set(joinToken, { roomId, role: 'joiner' });

    return { roomId, hostToken, joinToken, session };
  }

  /**
   * Resolve a token to its room and role, or null if unknown.
   */
  resolve(token: string): TokenResolution | null {
    return this._tokenToRoom.get(token) || null;
  }

  /**
   * Get room data by ID, or null if not found.
   */
  getRoom(roomId: string): RoomData | null {
    return this._rooms.get(roomId) || null;
  }

  /**
   * Remove a room and clear its tokens.
   */
  removeRoom(roomId: string): void {
    const room = this._rooms.get(roomId);
    if (!room) return;

    this._tokenToRoom.delete(room.tokens.host);
    this._tokenToRoom.delete(room.tokens.joiner);
    this._rooms.delete(roomId);
  }
}
