import Recorder from 'node-record-lpcm16';
import { EventEmitter } from 'events';

const CHUNK_INTERVAL_MS = 100;
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;
const CHANNELS = 1;
const CHUNK_SIZE = (SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_INTERVAL_MS) / 1000;

export class AudioCapture extends EventEmitter {
  constructor() {
    super();
    this.recorder = null;
    this.buffer = Buffer.alloc(0);
    this.isCapturing = false;
  }

  start() {
    if (this.isCapturing) return;

    this.recorder = Recorder.record({
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      audioType: 'raw',
    });

    this.isCapturing = true;
    this.buffer = Buffer.alloc(0);

    this.recorder.stream().on('data', (data) => {
      this.buffer = Buffer.concat([this.buffer, data]);
      while (this.buffer.length >= CHUNK_SIZE) {
        const chunk = this.buffer.subarray(0, CHUNK_SIZE);
        this.buffer = this.buffer.subarray(CHUNK_SIZE);
        this.emit('chunk', chunk);
      }
    });

    this.recorder.stream().on('error', (err) => {
      this.emit('error', err);
    });

    this.emit('started');
  }

  stop() {
    if (!this.isCapturing) return;
    this.isCapturing = false;
    if (this.recorder) {
      this.recorder.stop();
      this.recorder = null;
    }
    this.emit('stopped');
  }

  pause() {
    if (this.recorder && this.isCapturing) {
      this.recorder.pause();
      this.emit('paused');
    }
  }

  resume() {
    if (this.recorder && this.isCapturing) {
      this.recorder.resume();
      this.emit('resumed');
    }
  }
}
