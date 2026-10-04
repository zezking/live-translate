const SAMPLES_PER_CHUNK = 1600;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_CHUNK = SAMPLES_PER_CHUNK * BYTES_PER_SAMPLE;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._carry = new Uint8Array(0);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channel = input[0];

    const int16 = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    const bytes = new Uint8Array(int16.buffer);
    const combined = new Uint8Array(this._carry.length + bytes.length);
    combined.set(this._carry, 0);
    combined.set(bytes, this._carry.length);

    let offset = 0;
    while (offset + BYTES_PER_CHUNK <= combined.length) {
      const chunk = combined.slice(offset, offset + BYTES_PER_CHUNK);
      this.port.postMessage(chunk.buffer, [chunk.buffer]);
      offset += BYTES_PER_CHUNK;
    }
    this._carry = combined.subarray(offset);

    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
