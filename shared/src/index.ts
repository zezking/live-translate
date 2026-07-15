// ---- WS messages shared across v2 surfaces ----

export type Role = 'host' | 'joiner';

export interface RoomInfoMessage { type: 'roomInfo'; names: { host: string; joiner: string } }
export interface ConfigMessage { type: 'config'; voiceOver: boolean; voiceClone: boolean }
export interface StatusMessage { type: 'status'; state: 'waiting' | 'listening' | 'paused' | 'ended'; host: boolean; joiner: boolean }
export interface DeltaMessage { type: 'delta'; speaker: Role; field: 'original' | 'translation'; text: string }
export interface TurnEndMessage { type: 'turnEnd'; speaker: Role }
export interface AudioMessage { type: 'audio'; data: string } // base64 24kHz PCM

export type ConversationWsMessage =
  | RoomInfoMessage | ConfigMessage | StatusMessage
  | DeltaMessage | TurnEndMessage | AudioMessage;

export interface TranscriptionMessage { type: 'transcription'; languageCode: string; transcriptionType: 'input' | 'output'; text: string }
export type ChurchWsMessage = TranscriptionMessage | { type: 'audio'; languageCode: string; data: string } | { type: 'status'; state: string };

// ---- REST contracts ----

export interface CreateRoomRequest { hostName?: string; partnerName?: string; voiceOver?: boolean; voiceClone?: boolean }
export interface CreateRoomResponse { roomId: string; hostToken: string; joinToken: string; joinUrl: string; qrDataUrl: string }
export interface UpdateConfigRequest { roomId: string; voiceOver?: boolean; voiceClone?: boolean }
export interface EndRoomRequest { roomId: string }
