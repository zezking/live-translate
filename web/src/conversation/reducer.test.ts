import { describe, it, expect } from 'vitest';
import { conversationReducer, createInitialState } from './reducer.js';

describe('conversationReducer', () => {
  const s = () => createInitialState('host');

  it('groups consecutive same-speaker deltas into one active turn', () => {
    let st = s();
    st = conversationReducer(st, { type: 'delta', speaker: 'host', field: 'original', text: '你好' });
    st = conversationReducer(st, { type: 'delta', speaker: 'host', field: 'original', text: '世界' });
    expect(st.turns).toHaveLength(1);
    expect(st.turns[0]).toMatchObject({ speaker: 'host', original: '你好世界', active: true });
  });

  it('starts a new turn when the speaker changes', () => {
    let st = s();
    st = conversationReducer(st, { type: 'delta', speaker: 'host', field: 'original', text: 'a' });
    st = conversationReducer(st, { type: 'delta', speaker: 'joiner', field: 'translation', text: 'b' });
    expect(st.turns).toHaveLength(2);
    expect(st.turns[0].active).toBe(false); // host finalized when joiner became active
    expect(st.turns[1]).toMatchObject({ speaker: 'joiner', translation: 'b', active: true });
  });

  it('turnEnd finalizes that speaker\'s active turn (next delta = new turn)', () => {
    let st = s();
    st = conversationReducer(st, { type: 'delta', speaker: 'host', field: 'original', text: 'a' });
    st = conversationReducer(st, { type: 'turnEnd', speaker: 'host' });
    expect(st.turns[0].active).toBe(false);
    st = conversationReducer(st, { type: 'delta', speaker: 'host', field: 'original', text: 'b' });
    expect(st.turns).toHaveLength(2);
  });

  it('status: first waiting (partner never joined) → waiting', () => {
    let st = s(); // host
    st = conversationReducer(st, { type: 'status', state: 'waiting', host: true, joiner: false });
    expect(st.status).toBe('waiting');
  });

  it('status: partner joined then left → partnerAway', () => {
    let st = s();
    st = conversationReducer(st, { type: 'status', state: 'listening', host: true, joiner: true });
    st = conversationReducer(st, { type: 'status', state: 'waiting', host: true, joiner: false });
    expect(st.status).toBe('partnerAway');
  });

  it('status: ended → ended', () => {
    let st = s();
    st = conversationReducer(st, { type: 'status', state: 'ended', host: false, joiner: false });
    expect(st.status).toBe('ended');
  });

  it('reconnecting sets status (unless ended); reconnected restores to listening', () => {
    let st = s();
    st = conversationReducer(st, { type: 'status', state: 'listening', host: true, joiner: true });
    st = conversationReducer(st, { type: 'reconnecting' });
    expect(st.status).toBe('reconnecting');
    st = conversationReducer(st, { type: 'reconnected' });
    expect(st.status).toBe('listening');
  });

  it('pause/resume toggle the paused flag without losing server status', () => {
    let st = s();
    st = conversationReducer(st, { type: 'status', state: 'listening', host: true, joiner: true });
    st = conversationReducer(st, { type: 'pause' });
    expect(st.paused).toBe(true);
    expect(st.status).toBe('listening'); // underlying status preserved
    st = conversationReducer(st, { type: 'resume' });
    expect(st.paused).toBe(false);
  });

  it('end sets phase ended + status ended', () => {
    let st = s();
    st = conversationReducer(st, { type: 'end' });
    expect(st.phase).toBe('ended');
    expect(st.status).toBe('ended');
  });

  it('config updates voiceOver/voiceClone', () => {
    let st = s();
    st = conversationReducer(st, { type: 'config', config: { voiceOver: true, voiceClone: false } });
    expect(st.config).toEqual({ voiceOver: true, voiceClone: false });
  });
});
