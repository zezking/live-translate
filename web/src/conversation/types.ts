import type { Role } from '@v2/shared';

export type Locale = 'en' | 'ko';
export type Phase = 'onboarding' | 'waiting' | 'live' | 'ended';

/** Server/connection-derived status. `paused` is a separate client flag. */
export type StatusKind = 'waiting' | 'listening' | 'partnerAway' | 'reconnecting' | 'ended';

export interface Turn {
  id: string;
  speaker: Role;
  original: string;
  translation: string;
  /** Currently speaking → emphasized in the river. At most one active turn. */
  active: boolean;
}

export interface ConversationConfig {
  voiceOver: boolean;
  voiceClone: boolean;
}

export interface RoomData {
  roomId: string;
  hostToken: string;
  joinToken: string;
  joinUrl: string;
  qrDataUrl: string;
}

export interface ConversationState {
  phase: Phase;
  role: Role;
  names: { host: string; joiner: string };
  turns: Turn[];
  status: StatusKind;
  paused: boolean;
  /** Has the partner ever connected (distinguishes first-wait from partner-away)? */
  partnerEverJoined: boolean;
  config: ConversationConfig;
  room: RoomData | null;
  error: string | null;
}

export type Action =
  | { type: 'setPhase'; phase: Phase }
  | { type: 'roomInfo'; names: { host: string; joiner: string } }
  | { type: 'setRoom'; room: RoomData }
  | { type: 'config'; config: ConversationConfig }
  | { type: 'status'; state: 'waiting' | 'listening' | 'paused' | 'ended'; host: boolean; joiner: boolean }
  | { type: 'delta'; speaker: Role; field: 'original' | 'translation'; text: string }
  | { type: 'turnEnd'; speaker: Role }
  | { type: 'reconnecting' }
  | { type: 'reconnected' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'end' }
  | { type: 'error'; message: string }
  | { type: 'clearError' };
