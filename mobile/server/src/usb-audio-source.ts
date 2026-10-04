import Recorder from 'node-record-lpcm16';
import { spawn } from 'child_process';
import type { ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';
import { EventEmitter } from 'events';
import type { RecorderInstance, RecordOptions } from 'node-record-lpcm16';

const CHUNK_INTERVAL_MS = 100;
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;
const CHANNELS = 1;
const CHUNK_SIZE = (SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_INTERVAL_MS) / 1000;

function soxCoreAudioDevice(deviceName: string): ChildProcessByStdio<null, Readable, Readable> {
  return spawn(
    'sox',
    [
      '-q',
      '-t',
      'coreaudio',
      deviceName,
      '--rate',
      String(SAMPLE_RATE),
      '--channels',
      String(CHANNELS),
      '--encoding',
      'signed-integer',
      '--bits',
      '16',
      '--type',
      'raw',
      '--no-show-progress',
      '-',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

export class UsbAudioSource extends EventEmitter {
  private _recorder: RecorderInstance | null;
  buffer: Buffer;
  isCapturing: boolean;
  device: string | null;
  private _soxProc: ChildProcessByStdio<null, Readable, Readable> | null;
  private _soxProcPaused: boolean;

  constructor() {
    super();
    this._recorder = null;
    this.buffer = Buffer.alloc(0);
    this.isCapturing = false;
    this.device = process.env.AUDIO_DEVICE || null;
    this._soxProc = null;
    this._soxProcPaused = false;
  }

  start(): void {
    if (this.isCapturing) return;

    this.isCapturing = true;
    this.buffer = Buffer.alloc(0);

    if (this.device && process.platform === 'darwin') {
      this._startCoreAudio();
    } else {
      this._startDefault();
    }

    this.emit('started');
  }

  private _startCoreAudio(): void {
    const cp = soxCoreAudioDevice(this.device!);

    cp.stdout.on('data', (data: Buffer) => this._onData(data));
    cp.stderr.on('data', (d: Buffer) => process.stderr.write(d));
    cp.on('error', (err: Error) => this.emit('error', err));
    cp.on('close', (code: number | null) => {
      if (code !== 0 && code !== null && this.isCapturing) {
        this.emit('error', new Error(`sox exited with code ${code}`));
      }
    });

    this._soxProc = cp;
    this._soxProcPaused = false;
  }

  private _startDefault(): void {
    const opts: RecordOptions = {
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      audioType: 'raw',
    };

    if (this.device) {
      opts.device = this.device;
    }

    this._recorder = Recorder.record(opts);

    this._recorder.stream().on('data', (data: Buffer) => this._onData(data));
    this._recorder.stream().on('error', (err: Error) => this.emit('error', err));
  }

  _onData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.buffer.length >= CHUNK_SIZE) {
      const chunk = this.buffer.subarray(0, CHUNK_SIZE);
      this.buffer = this.buffer.subarray(CHUNK_SIZE);
      this.emit('chunk', chunk);
    }
  }

  stop(): void {
    if (!this.isCapturing) return;
    this.isCapturing = false;

    if (this._soxProc) {
      this._soxProc.kill('SIGTERM');
      this._soxProc = null;
    }
    if (this._recorder) {
      this._recorder.stop();
      this._recorder = null;
    }
    this.emit('stopped');
  }

  pause(): void {
    if (!this.isCapturing) return;
    if (this._soxProc && !this._soxProcPaused) {
      this._soxProc.kill('SIGSTOP');
      this._soxProcPaused = true;
    } else if (this._recorder) {
      this._recorder.pause();
    }
    this.emit('paused');
  }

  resume(): void {
    if (!this.isCapturing) return;
    if (this._soxProc && this._soxProcPaused) {
      this._soxProc.kill('SIGCONT');
      this._soxProcPaused = false;
    } else if (this._recorder) {
      this._recorder.resume();
    }
    this.emit('resumed');
  }
}
