// ---- WS messages shared across v2 surfaces ----

export interface ConfigMessage { type: 'config'; voiceOver: boolean; voiceClone: boolean }
export interface AudioMessage { type: 'audio'; data: string } // base64 24kHz PCM

export interface TranscriptionMessage { type: 'transcription'; languageCode: string; transcriptionType: 'input' | 'output'; text: string }
export type ChurchWsMessage = TranscriptionMessage | { type: 'audio'; languageCode: string; data: string } | { type: 'status'; state: string };

// ---- Conversation (single-device push-to-talk) WS protocol ----
// Client -> server control frames (JSON text frames; audio is raw binary PCM):

export interface ConversationStartMessage {
  type: 'start';
  languages: [string, string];
  voiceOver: boolean;
  voiceClone: boolean;
}

export interface ConversationDirectionMessage {
  type: 'direction';
  /** Source language being spoken (one of the pair), or null on release. */
  from: string | null;
}

export type ConversationClientMessage = ConversationStartMessage | ConversationDirectionMessage;

// Server -> client (one JSON object per text frame):

export interface StatusMessage { type: 'status'; state: 'ready' | 'ended' }

export interface DeltaMessage {
  type: 'delta';
  field: 'original' | 'translation';
  /** Language of `text` (original -> source lang, translation -> target lang). */
  lang: string;
  text: string;
}

/** `lang` = SOURCE language of the finalized turn. */
export interface TurnEndMessage { type: 'turnEnd'; lang: string }

export interface ErrorMessage { type: 'error'; message: string }

export type ConversationWsMessage =
  | ConfigMessage | StatusMessage | DeltaMessage | TurnEndMessage | AudioMessage | ErrorMessage;

// ---- REST contracts ----

export interface UpdateConfigRequest { voiceOver?: boolean; voiceClone?: boolean }
