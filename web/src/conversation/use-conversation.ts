import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ConversationWsMessage, Role } from '@v2/shared';
import { SocketClient, PlaybackEngine, MicCaptureEngine } from '@/engines';
import { conversationReducer, createInitialState } from './reducer.js';
import type { ConversationState } from './types.js';

export interface UseConversationOptions {
  /** Host admin password (host flow only). */
  adminKey: string;
  /** Returns the ?token= query value (joiner) or null (host). Injectable for tests. */
  getToken?: () => string | null;
}

export interface UseConversationApi {
  state: ConversationState;
  devices: MediaDeviceInfo[];
  /** Currently selected mic deviceId ('' until the mic starts or the user picks one). */
  selectedDeviceId: string;
  createRoom: (hostName: string, partnerName: string) => Promise<void>;
  joinRoom: () => Promise<void>;
  setVoiceOver: (v: boolean) => void;
  setVoiceClone: (v: boolean) => void;
  setMicDevice: (deviceId: string) => Promise<void>;
  pause: () => void;
  resume: () => void;
  endConversation: () => Promise<void>;
  clearError: () => void;
}

function readToken(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('token');
  } catch {
    return null;
  }
}

function wsUrl(token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws/conversation?token=${token}`;
}

export function useConversation({ adminKey, getToken = readToken }: UseConversationOptions): UseConversationApi {
  const token = getToken();
  const role: Role = token ? 'joiner' : 'host';

  const [state, dispatch] = useReducer(conversationReducer, role, createInitialState);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  // Engine refs (high-frequency / browser state stays out of React state).
  const socketRef = useRef<SocketClient | null>(null);
  const micRef = useRef<MicCaptureEngine | null>(null);
  const playbackRef = useRef<PlaybackEngine | null>(null);
  const stateRef = useRef(state); // latest state for audio-gating without stale closures
  stateRef.current = state;
  const adminKeyRef = useRef(adminKey);
  adminKeyRef.current = adminKey;

  const ensurePlayback = useCallback(async () => {
    if (!playbackRef.current) playbackRef.current = new PlaybackEngine();
    await playbackRef.current.ensureContext();
  }, []);

  const connectSocket = useCallback((tok: string) => {
    socketRef.current?.close();
    const socket = new SocketClient({
      url: wsUrl(tok),
      onMessage: (m: ConversationWsMessage) => {
        switch (m.type) {
          case 'roomInfo':
            dispatch({ type: 'roomInfo', names: m.names });
            break;
          case 'config':
            dispatch({ type: 'config', config: { voiceOver: m.voiceOver, voiceClone: m.voiceClone } });
            break;
          case 'status':
            dispatch({ type: 'status', state: m.state, host: m.host, joiner: m.joiner });
            if (m.state === 'listening') dispatch({ type: 'setPhase', phase: 'live' });
            else if (m.state === 'ended') dispatch({ type: 'end' });
            break;
          case 'delta':
            dispatch({ type: 'delta', speaker: m.speaker, field: m.field, text: m.text });
            break;
          case 'turnEnd':
            dispatch({ type: 'turnEnd', speaker: m.speaker });
            break;
          case 'audio':
            if (!stateRef.current.paused && playbackRef.current) {
              playbackRef.current.queueAudio(m.data);
            }
            break;
        }
      },
      onOpen: () => dispatch({ type: 'reconnected' }),
      onReconnecting: () => dispatch({ type: 'reconnecting' }),
      onCloseTerminal: () => {
        // 1008 = room gone / ended / bad token → treat as ended.
        dispatch({ type: 'end' });
      },
    });
    socketRef.current = socket;
    socket.connect();
  }, []);

  const startMic = useCallback(async (deviceId?: string) => {
    if (!micRef.current) {
      micRef.current = new MicCaptureEngine({
        workletUrl: '/pcm-worklet.js',
        onAudio: (pcm: ArrayBuffer) => {
          if (!stateRef.current.paused) socketRef.current?.sendAudio(pcm);
        },
      });
    }
    try {
      await micRef.current.start(deviceId);
      const list = await micRef.current.listDevices();
      setDevices(list);
      // Default the picker to the active (or first) device unless the user already picked one.
      setSelectedDeviceId((cur) => cur || micRef.current?.deviceId || list[0]?.deviceId || '');
    } catch {
      dispatch({ type: 'error', message: 'mic_blocked' });
    }
  }, []);

  const clearError = useCallback(() => dispatch({ type: 'clearError' }), []);

  // ---- host: create room ----
  const createRoom = useCallback(
    async (hostName: string, partnerName: string) => {
      dispatch({ type: 'clearError' }); // retry clears the old error
      try {
        await ensurePlayback(); // unlock audio on the Begin gesture
        const res = await fetch('/api/conversation/create', {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminKeyRef.current}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostName, partnerName }),
        });
        const data = await res.json();
        if (res.status === 401) {
          dispatch({ type: 'error', message: 'unauthorized' });
          return;
        }
        if (!res.ok) throw new Error(data?.error || 'create failed');
        dispatch({
          type: 'setRoom',
          room: { roomId: data.roomId, hostToken: data.hostToken, joinToken: data.joinToken, joinUrl: data.joinUrl, qrDataUrl: data.qrDataUrl },
        });
        dispatch({ type: 'setPhase', phase: 'waiting' });
        connectSocket(data.hostToken);
        await startMic(); // mic prompt fires on the waiting screen (spec)
      } catch (err) {
        dispatch({ type: 'error', message: (err as Error).message });
      }
    },
    [connectSocket, ensurePlayback, startMic],
  );

  // ---- joiner: join ----
  const joinRoom = useCallback(async () => {
    if (!token) return;
    dispatch({ type: 'clearError' }); // retry clears the old error
    try {
      await ensurePlayback(); // unlock audio on the 참여하기 gesture
      connectSocket(token);
      await startMic();
    } catch (err) {
      dispatch({ type: 'error', message: (err as Error).message });
    }
  }, [token, connectSocket, ensurePlayback, startMic]);

  // ---- host config (voice-over / clone) ----
  const sendConfig = useCallback(
    async (voiceOver: boolean, voiceClone: boolean) => {
      const room = stateRef.current.room;
      if (!room) return;
      dispatch({ type: 'config', config: { voiceOver, voiceClone } }); // optimistic
      try {
        await fetch('/api/conversation/config', {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminKeyRef.current}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: room.roomId, voiceOver, voiceClone }),
        });
      } catch {
        /* server will broadcast the authoritative config back */
      }
    },
    [],
  );
  const setVoiceOver = useCallback((v: boolean) => {
    void sendConfig(v, stateRef.current.config.voiceClone && v);
  }, [sendConfig]);
  const setVoiceClone = useCallback((v: boolean) => {
    void sendConfig(stateRef.current.config.voiceOver, v);
  }, [sendConfig]);

  const setMicDevice = useCallback(async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (micRef.current) await micRef.current.setDevice(deviceId);
  }, []);

  const pause = useCallback(() => {
    dispatch({ type: 'pause' });
    playbackRef.current?.stopAll();
  }, []);
  const resume = useCallback(() => dispatch({ type: 'resume' }), []);

  const endConversation = useCallback(async () => {
    const room = stateRef.current.room;
    try {
      if (room) {
        await fetch('/api/conversation/end', {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminKeyRef.current}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: room.roomId }),
        });
      }
    } catch {
      /* ignore */
    }
    socketRef.current?.close();
    dispatch({ type: 'end' });
  }, []);

  // cleanup engines on unmount
  useEffect(() => {
    return () => {
      socketRef.current?.close();
      void micRef.current?.stop();
      playbackRef.current?.close();
    };
  }, []);

  return { state, devices, selectedDeviceId, createRoom, joinRoom, setVoiceOver, setVoiceClone, setMicDevice, pause, resume, endConversation, clearError };
}
