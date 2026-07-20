export type Phase = 'setup' | 'connecting' | 'live' | 'ended';

/** Connection/session status. `paused` is a separate client flag. */
export type StatusKind = 'connecting' | 'ready' | 'reconnecting' | 'ended';

export interface Turn {
  id: string;
  /** Source language of this turn (the language that was spoken). */
  lang: string;
  original: string;
  translation: string;
  /** Currently spoken turn — emphasized in the river. */
  active: boolean;
}

export interface DuoConfigState {
  voiceOver: boolean;
  voiceClone: boolean;
}

export interface ConversationState {
  phase: Phase;
  /** Chosen pair [A, B]; null until setup completes. */
  languages: [string, string] | null;
  /** Source language currently held (push-to-talk), or null. */
  activeDirection: string | null;
  turns: Turn[];
  status: StatusKind;
  paused: boolean;
  config: DuoConfigState;
  error: string | null;
}

export type Action =
  | { type: 'setLanguages'; languages: [string, string] }
  | { type: 'setPhase'; phase: Phase }
  | { type: 'config'; config: DuoConfigState }
  | { type: 'status'; state: 'ready' | 'ended' }
  | { type: 'direction'; from: string | null }
  | { type: 'delta'; field: 'original' | 'translation'; lang: string; text: string }
  | { type: 'turnEnd'; lang: string }
  | { type: 'reconnecting' }
  | { type: 'reconnected' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'end' }
  | { type: 'error'; message: string }
  | { type: 'clearError' };
