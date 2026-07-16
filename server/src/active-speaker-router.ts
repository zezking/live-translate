type Role = 'host' | 'joiner';
type Dominant = Role | null;

export interface ActiveSpeakerRouterOptions {
  holdMs?: number;
  energyWindow?: number;
  silenceRms?: number;
  staleMs?: number;
  now?: () => number;
}

export function rms(pcm: Buffer): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    const sample = pcm.readInt16LE(i);
    sum += sample * sample;
    count += 1;
  }
  if (count === 0) return 0;
  return Math.sqrt(sum / count);
}

export class ActiveSpeakerRouter {
  holdMs: number;
  energyWindow: number;
  silenceRms: number;
  staleMs: number;
  now: () => number;

  private _energy: Record<Role, number[]>;
  private _lastFed: Record<Role, number>;
  private _dominant: Dominant;
  private _lastSwitch: number;
  private _t: number;

  constructor({
    holdMs = 400,
    energyWindow = 3,
    silenceRms = 300,
    staleMs = 300,
    now = Date.now,
  }: ActiveSpeakerRouterOptions = {}) {
    this.holdMs = holdMs;
    this.energyWindow = energyWindow;
    this.silenceRms = silenceRms;
    this.staleMs = staleMs;
    this.now = now;
    this._energy = { host: [], joiner: [] };
    this._lastFed = { host: 0, joiner: 0 };
    this._dominant = null;
    this._lastSwitch = 0;
    this._t = 0;
  }

  private _avg(role: Role): number {
    if (this._t - this._lastFed[role] > this.staleMs) return 0;
    const arr = this._energy[role];
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  feed(role: Role, pcm: Buffer): Dominant {
    const e = rms(pcm);
    const arr = this._energy[role];
    arr.push(e);
    if (arr.length > this.energyWindow) arr.shift();
    const t = this.now();
    this._t = t;
    this._lastFed[role] = t;

    const hostE = this._avg('host');
    const joinerE = this._avg('joiner');

    let candidate: Dominant;
    if (hostE < this.silenceRms && joinerE < this.silenceRms) candidate = null;
    else if (hostE >= joinerE) candidate = 'host';
    else candidate = 'joiner';

    if (candidate !== this._dominant) {
      if (this._dominant === null || (t - this._lastSwitch) >= this.holdMs) {
        this._dominant = candidate;
        this._lastSwitch = t;
      }
    }
    return this._dominant;
  }

  active(): Dominant {
    return this._dominant;
  }

  reset(): void {
    this._energy = { host: [], joiner: [] };
    this._lastFed = { host: 0, joiner: 0 };
    this._dominant = null;
    this._lastSwitch = 0;
    this._t = 0;
  }
}
