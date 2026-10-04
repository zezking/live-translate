import type { Action, ConversationState, Turn } from './types.js';

export function createInitialState(): ConversationState {
  return {
    phase: 'setup',
    languages: null,
    activeDirection: null,
    turns: [],
    status: 'connecting',
    paused: false,
    config: { voiceOver: false, voiceClone: false },
    error: null,
  };
}

export function conversationReducer(state: ConversationState, action: Action): ConversationState {
  switch (action.type) {
    case 'setLanguages':
      return { ...state, languages: action.languages };

    case 'setPhase':
      return { ...state, phase: action.phase };

    case 'config':
      return { ...state, config: action.config };

    case 'status':
      if (action.state === 'ended')
        return { ...state, status: 'ended', phase: 'ended', activeDirection: null };
      return { ...state, status: 'ready', phase: 'live' };

    case 'direction': {
      // A second press while one is held is ignored (single active direction).
      if (action.from !== null && state.activeDirection !== null && action.from !== state.activeDirection)
        return state;
      return { ...state, activeDirection: action.from };
    }

    case 'delta': {
      // `text` is the turn field's CURRENT FULL value (a live snapshot), not an
      // incremental delta. We REPLACE the field so a Qwen ASR/translation
      // revision (e.g. "Hello, it is one." -> "Hello.") overwrites instead of
      // concatenating, which would duplicate words in the river.
      const { field, lang, text } = action;
      const turns = state.turns;
      if (field === 'translation') {
        // Set on the most recent turn of the OTHER language (the source
        // utterance) — including an already-finalized turn (translations may
        // lag the release).
        for (let i = turns.length - 1; i >= 0; i--) {
          if (turns[i].lang !== lang) {
            const updated: Turn = { ...turns[i], translation: text };
            return { ...state, turns: [...turns.slice(0, i), updated, ...turns.slice(i + 1)] };
          }
        }
        return state; // no source turn yet — drop
      }
      const last = turns[turns.length - 1];
      if (last && last.lang === lang && last.active) {
        const updated: Turn = { ...last, original: text };
        return { ...state, turns: [...turns.slice(0, -1), updated] };
      }
      if (state.activeDirection === lang) {
        // First snapshot of a fresh press — start a new active turn.
        const fresh: Turn = { id: `${lang}-${turns.length}`, lang, original: text, translation: '', active: true };
        return { ...state, turns: [...turns.map((t) => ({ ...t, active: false })), fresh] };
      }
      // No active direction → late finalization (Qwen emits its final text
      // after release). Update the most recent turn of this language rather
      // than spawning a spurious new one.
      for (let i = turns.length - 1; i >= 0; i--) {
        if (turns[i].lang === lang) {
          const updated: Turn = { ...turns[i], original: text };
          return { ...state, turns: [...turns.slice(0, i), updated, ...turns.slice(i + 1)] };
        }
      }
      // No turn of this language at all — create one.
      const fresh: Turn = { id: `${lang}-${turns.length}`, lang, original: text, translation: '', active: true };
      return { ...state, turns: [...turns.map((t) => ({ ...t, active: false })), fresh] };
    }

    case 'turnEnd':
      return {
        ...state,
        turns: state.turns.map((t) =>
          t.lang === action.lang && t.active ? { ...t, active: false } : t,
        ),
      };

    case 'reconnecting':
      return { ...state, status: state.status === 'ended' ? 'ended' : 'reconnecting' };

    case 'reconnected':
      return { ...state, status: state.status === 'ended' ? 'ended' : 'ready' };

    case 'pause':
      return { ...state, paused: true };

    case 'resume':
      return { ...state, paused: false };

    case 'end':
      return { ...state, phase: 'ended', status: 'ended', paused: false, activeDirection: null };

    case 'error':
      return { ...state, error: action.message };

    case 'clearError':
      return { ...state, error: null };

    default:
      return state;
  }
}
