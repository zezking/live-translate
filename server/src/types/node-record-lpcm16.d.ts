declare module 'node-record-lpcm16' {
  export interface RecordOptions {
    sampleRate?: number;
    channels?: number;
    threshold?: number;
    thresholdStart?: number;
    thresholdEnd?: number;
    silence?: string;
    verbose?: boolean;
    recordProgram?: string;
    audioType?: string;
  }

  export function record(opts?: RecordOptions): {
    stream(): NodeJS.ReadableStream;
    stop(): void;
    pause(): void;
    resume(): void;
    isPaused(): boolean;
    isRecording(): boolean;
  };
}
