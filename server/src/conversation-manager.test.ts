import { describe, it, expect } from 'vitest';
import { ConversationManager } from './conversation-manager.js';

describe('ConversationManager', () => {
  it('createRoom mints distinct host and join tokens that resolve to the same room', () => {
    const mgr = new ConversationManager();
    const room = mgr.createRoom({ apiKey: 'key', names: { host: 'A', joiner: 'B' } });

    expect(room.roomId).toBeTruthy();
    expect(room.hostToken).not.toBe(room.joinToken);

    const host = mgr.resolve(room.hostToken);
    const joiner = mgr.resolve(room.joinToken);

    expect(host?.roomId).toBe(room.roomId);
    expect(host?.role).toBe('host');
    expect(joiner?.role).toBe('joiner');
  });

  it('unknown token resolves to null', () => {
    const mgr = new ConversationManager();
    expect(mgr.resolve('nope')).toBeNull();
  });

  it('removeRoom clears both tokens', () => {
    const mgr = new ConversationManager();
    const room = mgr.createRoom({ apiKey: 'key', names: { host: 'A', joiner: 'B' } });

    mgr.removeRoom(room.roomId);

    expect(mgr.resolve(room.hostToken)).toBeNull();
    expect(mgr.resolve(room.joinToken)).toBeNull();
    expect(mgr.getRoom(room.roomId)).toBeNull();
  });
});
