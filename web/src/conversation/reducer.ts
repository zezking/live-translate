import type { Role } from '@v2/shared';
import type { Action, ConversationState, Turn } from './types.js';

export function createInitialState(role: Role): ConversationState {
  return {
    phase: 'onboarding',
    role,
    names: { host: '', joiner: '' },
    turns: [],
    status: 'waiting',
    paused: false,
    partnerEverJoined: false,
    config: { voiceOver: false, voiceClone: false },
    room: null,
    error: null,
  };
}

export function conversationReducer(state: ConversationState, action: Action): ConversationState {
  switch (action.type) {
    case 'setPhase':
      return { ...state, phase: action.phase };

    case 'roomInfo':
      return { ...state, names: action.names };

    case 'setRoom':
      return { ...state, room: action.room };

    case 'config':
      return { ...state, config: action.config };

    case 'status': {
      const partnerConnected = state.role === 'host' ? action.joiner : action.host;
      const partnerEverJoined = state.partnerEverJoined || partnerConnected;
      let status: ConversationState['status'];
      if (action.state === 'ended') status = 'ended';
      else if (action.state === 'listening') status = 'listening';
      else status = partnerEverJoined && !partnerConnected ? 'partnerAway' : 'waiting';
      return { ...state, status, partnerEverJoined };
    }

    case 'delta': {
      const { speaker, field, text } = action;
      const turns = state.turns;
      const last = turns[turns.length - 1];
      if (last && last.speaker === speaker && last.active) {
        const updated: Turn = { ...last, active: true };
        if (field === 'original') updated.original = last.original + text;
        else updated.translation = last.translation + text;
        return { ...state, turns: [...turns.slice(0, -1), updated] };
      }
      const fresh: Turn = { id: `${speaker}-${turns.length}`, speaker, original: '', translation: '', active: true };
      if (field === 'original') fresh.original = text;
      else fresh.translation = text;
      return { ...state, turns: [...turns.map((t) => ({ ...t, active: false })), fresh] };
    }

    case 'turnEnd':
      return {
        ...state,
        turns: state.turns.map((t) =>
          t.speaker === action.speaker && t.active ? { ...t, active: false } : t,
        ),
      };

    case 'reconnecting':
      return { ...state, status: state.status === 'ended' ? 'ended' : 'reconnecting' };

    case 'reconnected':
      return { ...state, status: state.status === 'ended' ? 'ended' : 'listening' };

    case 'pause':
      return { ...state, paused: true };

    case 'resume':
      return { ...state, paused: false };

    case 'end':
      return { ...state, phase: 'ended', status: 'ended', paused: false };

    case 'error':
      return { ...state, error: action.message };

    case 'clearError':
      return { ...state, error: null };

    default:
      return state;
  }
}
