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
    device?: string;
  }

  export interface RecorderInstance {
    stream(): NodeJS.ReadableStream;
    stop(): void;
    pause(): void;
    resume(): void;
    isPaused(): boolean;
    isRecording(): boolean;
  }

  export function record(opts?: RecordOptions): RecorderInstance;

  // CJS interop: `module.exports = { record }`, so the ESM default import
  // (`import Recorder from 'node-record-lpcm16'`) yields the namespace object
  // whose `.record` method v1's usb-audio-source uses.
  const _default: { record: typeof record };
  export default _default;
}
