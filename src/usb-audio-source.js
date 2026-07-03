import Recorder from 'node-record-lpcm16';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);

const CHUNK_INTERVAL_MS = 100;
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;
const CHANNELS = 1;
const CHUNK_SIZE = (SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_INTERVAL_MS) / 1000;

function soxCoreAudioDevice(deviceName) {
  return spawn('sox', [
    '-q',
    '-t', 'coreaudio', deviceName,
    '--rate', String(SAMPLE_RATE),
    '--channels', String(CHANNELS),
    '--encoding', 'signed-integer',
    '--bits', '16',
    '--type', 'raw',
    '--no-show-progress',
    '-',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
}

export class UsbAudioSource extends EventEmitter {
  constructor() {
    super();
    this.recorder = null;
    this.buffer = Buffer.alloc(0);
    this.isCapturing = false;
    this.device = process.env.AUDIO_DEVICE || null;
    this._soxProc = null;
    this._soxProcPaused = false;
  }

  start() {
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

  _startCoreAudio() {
    const cp = soxCoreAudioDevice(this.device);

    cp.stdout.on('data', (data) => this._onData(data));
    cp.stderr.on('data', (d) => process.stderr.write(d));
    cp.on('error', (err) => this.emit('error', err));
    cp.on('close', (code) => {
      if (code !== 0 && code !== null && this.isCapturing) {
        this.emit('error', new Error(`sox exited with code ${code}`));
      }
    });

    this._soxProc = cp;
    this._soxProcPaused = false;
  }

  _startDefault() {
    const opts = {
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      audioType: 'raw',
    };

    if (this.device) {
      opts.device = this.device;
    }

    this.recorder = Recorder.record(opts);

    this.recorder.stream().on('data', (data) => this._onData(data));
    this.recorder.stream().on('error', (err) => this.emit('error', err));
  }

  _onData(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.buffer.length >= CHUNK_SIZE) {
      const chunk = this.buffer.subarray(0, CHUNK_SIZE);
      this.buffer = this.buffer.subarray(CHUNK_SIZE);
      this.emit('chunk', chunk);
    }
  }

  stop() {
    if (!this.isCapturing) return;
    this.isCapturing = false;

    if (this._soxProc) {
      this._soxProc.kill('SIGTERM');
      this._soxProc = null;
    }
    if (this.recorder) {
      this.recorder.stop();
      this.recorder = null;
    }
    this.emit('stopped');
  }

  pause() {
    if (!this.isCapturing) return;
    if (this._soxProc && !this._soxProcPaused) {
      this._soxProc.kill('SIGSTOP');
      this._soxProcPaused = true;
    } else if (this.recorder) {
      this.recorder.pause();
    }
    this.emit('paused');
  }

  resume() {
    if (!this.isCapturing) return;
    if (this._soxProc && this._soxProcPaused) {
      this._soxProc.kill('SIGCONT');
      this._soxProcPaused = false;
    } else if (this.recorder) {
      this.recorder.resume();
    }
    this.emit('resumed');
  }
}
