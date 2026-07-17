import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SocketClient } from './socket-client.js';

// Minimal fake WebSocket
function fakeWs() {
  const ws: any = { readyState: 1, sent: [] as any[], listeners: {} as Record<string, Function[]>,
    send(m: any) { this.sent.push(m); }, close() { this.listeners['close']?.forEach((f: any) => f({ code: 1000 })); },
    on(ev: string, fn: Function) { (this.listeners[ev] ??= []).push(fn); } };
  return ws;
}

describe('SocketClient', () => {
  beforeEach(() => vi.useFakeTimers());
  it('dispatches JSON messages to onMessage', () => {
    const msgs: any[] = [];
    let ws: any;
    const c = new SocketClient({ url: 'wss://x', onMessage: (m) => msgs.push(m), WebSocketCtor: (() => { return ws = fakeWs(); }) as any });
    c.connect();
    ws.listeners['open'][0]();
    ws.listeners['message'][0]({ data: JSON.stringify({ type: 'status', state: 'listening', host: true, joiner: true }) });
    expect(msgs[0]).toEqual({ type: 'status', state: 'listening', host: true, joiner: true });
  });
  it('reconnects with backoff on a transient close (not 1008)', () => {
    const factory = vi.fn(() => fakeWs());
    const c = new SocketClient({ url: 'wss://x', onMessage: () => {}, WebSocketCtor: factory as any, reconnectBaseDelay: 1000 });
    c.connect();
    const first = factory.mock.results[0].value;
    first.listeners['open'][0]();
    first.listeners['close'][0]({ code: 1006 });      // transient
    expect(factory).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(999); expect(factory).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);   expect(factory).toHaveBeenCalledTimes(2);  // reconnected after 1000ms
  });
  it('stops + fires onCloseTerminal on 1008 (no reconnect)', () => {
    const factory = vi.fn(() => fakeWs());
    let terminal = false;
    const c = new SocketClient({ url: 'wss://x', onMessage: () => {}, onCloseTerminal: () => { terminal = true; }, WebSocketCtor: factory as any });
    c.connect();
    const first = factory.mock.results[0].value;
    first.listeners['close'][0]({ code: 1008 });
    vi.advanceTimersByTime(60000);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(terminal).toBe(true);
  });
  it('sendAudio sends binary when open', () => {
    let ws: any;
    const c = new SocketClient({ url: 'wss://x', onMessage: () => {}, WebSocketCtor: (() => { return ws = fakeWs(); }) as any });
    c.connect(); ws.listeners['open'][0]();
    c.sendAudio(new ArrayBuffer(8));
    expect(ws.sent[0]).toBeInstanceOf(ArrayBuffer);
  });
  it('fires onOpen when the socket opens', () => {
    let opened = false;
    let ws: any;
    const c = new SocketClient({ url: 'wss://x', onMessage: () => {}, onOpen: () => { opened = true; }, WebSocketCtor: (() => { return ws = fakeWs(); }) as any });
    c.connect();
    ws.listeners['open'][0]();
    expect(opened).toBe(true);
  });
  it('fires onReconnecting on a transient close (before the backoff reconnect)', () => {
    const factory = vi.fn(() => fakeWs());
    let reconnecting = 0;
    const c = new SocketClient({ url: 'wss://x', onMessage: () => {}, onReconnecting: () => { reconnecting++; }, WebSocketCtor: factory as any, reconnectBaseDelay: 1000 });
    c.connect();
    const first = factory.mock.results[0].value;
    first.listeners['open'][0]();
    first.listeners['close'][0]({ code: 1006 }); // transient
    expect(reconnecting).toBe(1);
    vi.advanceTimersByTime(1002); // reconnect fires; open the new socket
    const second = factory.mock.results[1].value;
    second.listeners['open'][0]();
    expect(reconnecting).toBe(1); // onReconnecting not re-fired until another transient close
  });
});
