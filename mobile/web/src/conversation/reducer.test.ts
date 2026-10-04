import { describe, it, expect } from 'vitest';
import { conversationReducer, createInitialState } from './reducer.js';

describe('conversationReducer (single-device)', () => {
  const s = () => createInitialState();

  it('replaces the active turn original with the latest full value (not append)', () => {
    let st = s();
    st = conversationReducer(st, { type: 'delta', field: 'original', lang: 'en', text: 'How' });
    st = conversationReducer(st, { type: 'delta', field: 'original', lang: 'en', text: 'How are you' });
    expect(st.turns).toHaveLength(1);
    expect(st.turns[0]).toMatchObject({ lang: 'en', original: 'How are you', active: true });
  });

  it('a revision overwrites instead of duplicating', () => {
    // Qwen revises: "Hello, it is one." -> "Hello." The river must show the
    // revised value, NOT "Hello, it is one.Hello." (the old append bug).
    let st = s();
    st = conversationReducer(st, { type: 'delta', field: 'original', lang: 'en', text: 'Hello, it is one.' });
    st = conversationReducer(st, { type: 'delta', field: 'original', lang: 'en', text: 'Hello.' });
    expect(st.turns).toHaveLength(1);
    expect(st.turns[0].original).toBe('Hello.');
  });

  it('translation sets the most recent turn of the OTHER language', () => {
    let st = s();
    st = conversationReducer(st, { type: 'delta', field: 'original', lang: 'en', text: 'hello' });
    st = conversationReducer(st, { type: 'delta', field: 'translation', lang: 'ko', text: '안녕' });
    expect(st.turns).toHaveLength(1);
    expect(st.turns[0].translation).toBe('안녕');
  });

  it('a new language starts a new turn and finalizes the previous', () => {
    let st = s();
    st = conversationReducer(st, { type: 'delta', field: 'original', lang: 'en', text: 'a' });
    st = conversationReducer(st, { type: 'delta', field: 'original', lang: 'ko', text: '가' });
    expect(st.turns).toHaveLength(2);
    expect(st.turns[0].active).toBe(false);
    expect(st.turns[1]).toMatchObject({ lang: 'ko', active: true });
  });

  it('turnEnd finalizes that language’s turn; a late translation still lands on it', () => {
    let st = s();
    st = conversationReducer(st, { type: 'direction', from: 'en' });
    st = conversationReducer(st, { type: 'delta', field: 'original', lang: 'en', text: 'a' });
    st = conversationReducer(st, { type: 'turnEnd', lang: 'en' });
    expect(st.turns[0].active).toBe(false);
    st = conversationReducer(st, { type: 'delta', field: 'translation', lang: 'ko', text: '가' });
    expect(st.turns[0].translation).toBe('가'); // late translation still lands on the turn
    // a fresh press + snapshot starts a new turn
    st = conversationReducer(st, { type: 'direction', from: null });
    st = conversationReducer(st, { type: 'direction', from: 'en' });
    st = conversationReducer(st, { type: 'delta', field: 'original', lang: 'en', text: 'b' });
    expect(st.turns).toHaveLength(2);
  });

  it('a late original revision after release updates the finalized turn (end-boundary capture)', () => {
    // Qwen often emits its final, corrected text ~200-500ms after the user
    // releases. After release (activeDirection cleared) the late snapshot must
    // update the just-finalized turn, not spawn a spurious new turn.
    let st = s();
    st = conversationReducer(st, { type: 'direction', from: 'en' });
    st = conversationReducer(st, { type: 'delta', field: 'original', lang: 'en', text: 'Hello, it is' });
    st = conversationReducer(st, { type: 'turnEnd', lang: 'en' });
    st = conversationReducer(st, { type: 'direction', from: null }); // release
    st = conversationReducer(st, { type: 'delta', field: 'original', lang: 'en', text: 'Hello. It is wonderful.' });
    expect(st.turns).toHaveLength(1); // no spurious new turn
    expect(st.turns[0].original).toBe('Hello. It is wonderful.');
  });

  it('a new press of the same language starts a fresh turn (not a late-revision update)', () => {
    let st = s();
    st = conversationReducer(st, { type: 'direction', from: 'en' });
    st = conversationReducer(st, { type: 'delta', field: 'original', lang: 'en', text: 'first' });
    st = conversationReducer(st, { type: 'turnEnd', lang: 'en' });
    st = conversationReducer(st, { type: 'direction', from: null });
    st = conversationReducer(st, { type: 'direction', from: 'en' }); // new press
    st = conversationReducer(st, { type: 'delta', field: 'original', lang: 'en', text: 'second' });
    expect(st.turns).toHaveLength(2);
    expect(st.turns[0].original).toBe('first');
    expect(st.turns[1].original).toBe('second');
  });

  it('direction: a second press while one is held is ignored; release clears', () => {
    let st = s();
    st = conversationReducer(st, { type: 'direction', from: 'en' });
    st = conversationReducer(st, { type: 'direction', from: 'ko' });
    expect(st.activeDirection).toBe('en');
    st = conversationReducer(st, { type: 'direction', from: null });
    expect(st.activeDirection).toBeNull();
  });

  it('status ready → live; status ended → ended + direction cleared', () => {
    let st = s();
    st = conversationReducer(st, { type: 'direction', from: 'en' });
    st = conversationReducer(st, { type: 'status', state: 'ready' });
    expect(st.phase).toBe('live');
    expect(st.status).toBe('ready');
    st = conversationReducer(st, { type: 'status', state: 'ended' });
    expect(st.phase).toBe('ended');
    expect(st.activeDirection).toBeNull();
  });

  it('reconnecting/reconnected preserve ended', () => {
    let st = s();
    st = conversationReducer(st, { type: 'status', state: 'ready' });
    st = conversationReducer(st, { type: 'reconnecting' });
    expect(st.status).toBe('reconnecting');
    st = conversationReducer(st, { type: 'reconnected' });
    expect(st.status).toBe('ready');
    st = conversationReducer(st, { type: 'end' });
    st = conversationReducer(st, { type: 'reconnecting' });
    expect(st.status).toBe('ended');
  });

  it('pause/resume, config, error/clearError', () => {
    let st = s();
    st = conversationReducer(st, { type: 'pause' });
    expect(st.paused).toBe(true);
    st = conversationReducer(st, { type: 'resume' });
    expect(st.paused).toBe(false);
    st = conversationReducer(st, { type: 'config', config: { voiceOver: true, voiceClone: true } });
    expect(st.config).toEqual({ voiceOver: true, voiceClone: true });
    st = conversationReducer(st, { type: 'error', message: 'mic_blocked' });
    expect(st.error).toBe('mic_blocked');
    st = conversationReducer(st, { type: 'clearError' });
    expect(st.error).toBeNull();
  });
});
