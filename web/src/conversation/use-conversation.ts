import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ConversationWsMessage } from '@v2/shared';
import { SocketClient, PlaybackEngine, MicCaptureEngine } from '@/engines';
import { conversationReducer, createInitialState } from './reducer.js';
import type { ConversationState } from './types.js';

export interface UseConversationOptions {
  adminKey: string;
}

export interface UseConversationApi {
  state: ConversationState;
  devices: MediaDeviceInfo[];
  selectedDeviceId: string;
  begin: (languages: [string, string]) => Promise<void>;
  press: (lang: string) => void;
  release: () => void;
  setVoiceOver: (v: boolean) => void;
  setVoiceClone: (v: boolean) => void;
  setMicDevice: (deviceId: string) => Promise<void>;
  pause: () => void;
  resume: () => void;
  endConversation: () => Promise<void>;
  clearError: () => void;
}

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws/conversation`;
}

export function useConversation({ adminKey }: UseConversationOptions): UseConversationApi {
  const [state, dispatch] = useReducer(conversationReducer, undefined, createInitialState);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  const socketRef = useRef<SocketClient | null>(null);
  const micRef = useRef<MicCaptureEngine | null>(null);
  const playbackRef = useRef<PlaybackEngine | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const adminKeyRef = useRef(adminKey);
  adminKeyRef.current = adminKey;

  const ensurePlayback = useCallback(async () => {
    if (!playbackRef.current) playbackRef.current = new PlaybackEngine();
    await playbackRef.current.ensureContext();
  }, []);

  const startMic = useCallback(async (deviceId?: string) => {
    if (!micRef.current) {
      micRef.current = new MicCaptureEngine({
        workletUrl: '/pcm-worklet.js',
        onAudio: (pcm: ArrayBuffer) => {
          // Only stream while a direction is held and not paused.
          if (stateRef.current.activeDirection && !stateRef.current.paused) {
            socketRef.current?.sendAudio(pcm);
          }
        },
      });
    }
    try {
      await micRef.current.start(deviceId);
      const list = await micRef.current.listDevices();
      setDevices(list);
      setSelectedDeviceId((cur) => cur || micRef.current?.deviceId || list[0]?.deviceId || '');
    } catch {
      dispatch({ type: 'error', message: 'mic_blocked' });
    }
  }, []);

  // ---- begin: validate admin, then connect + start ----
  const begin = useCallback(
    async (languages: [string, string]) => {
      dispatch({ type: 'clearError' });
      try {
        const res = await fetch('/api/conversation/session', {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminKeyRef.current}` },
        });
        if (!res.ok) {
          dispatch({ type: 'error', message: 'unauthorized' });
          return;
        }
      } catch {
        dispatch({ type: 'error', message: 'unauthorized' });
        return;
      }
      dispatch({ type: 'setLanguages', languages });
      dispatch({ type: 'setPhase', phase: 'connecting' });
      try {
        await ensurePlayback(); // unlock audio on the Begin gesture
      } catch {
        // AudioContext blocked (autoplay policy / mic permission) — surface a
        // mic_blocked error and abort before connecting. Without this, phase
        // stays 'connecting' with no recovery path.
        dispatch({ type: 'error', message: 'mic_blocked' });
        return;
      }

      socketRef.current?.close();
      const socket = new SocketClient({
        url: wsUrl(),
        onMessage: (m: ConversationWsMessage) => {
          switch (m.type) {
            case 'config':
              dispatch({ type: 'config', config: { voiceOver: m.voiceOver, voiceClone: m.voiceClone } });
              break;
            case 'status':
              dispatch({ type: 'status', state: m.state });
              break;
            case 'delta':
              dispatch({ type: 'delta', field: m.field, lang: m.lang, text: m.text });
              break;
            case 'turnEnd':
              dispatch({ type: 'turnEnd', lang: m.lang });
              break;
            case 'audio':
              if (!stateRef.current.paused && playbackRef.current) playbackRef.current.queueAudio(m.data);
              break;
            case 'error':
              dispatch({ type: 'error', message: m.message });
              break;
          }
        },
        onOpen: () => {
          // (Re)start the session on every open, including reconnects.
          socket.sendJson({
            type: 'start',
            languages,
            voiceOver: stateRef.current.config.voiceOver,
            voiceClone: stateRef.current.config.voiceClone,
          });
          dispatch({ type: 'reconnected' });
        },
        onReconnecting: () => {
          dispatch({ type: 'reconnecting' });
          // Clear any held PTT direction: the server drops direction on
          // reconnect (the re-sent start frame carries none), so audio would
          // be silently dropped until the next press. The user re-presses to
          // resume — safe and simple.
          dispatch({ type: 'direction', from: null });
        },
        onCloseTerminal: () => dispatch({ type: 'end' }),
      });
      socketRef.current = socket;
      socket.connect();
      await startMic(); // mic prompt fires during connect
    },
    [ensurePlayback, startMic],
  );

  // ---- push-to-talk ----
  const press = useCallback((lang: string) => {
    if (stateRef.current.activeDirection) return; // single active direction
    dispatch({ type: 'direction', from: lang });
    socketRef.current?.sendJson({ type: 'direction', from: lang });
  }, []);

  const release = useCallback(() => {
    if (!stateRef.current.activeDirection) return;
    dispatch({ type: 'direction', from: null });
    socketRef.current?.sendJson({ type: 'direction', from: null });
  }, []);

  // ---- config (voice-over / clone) ----
  const sendConfig = useCallback(async (voiceOver: boolean, voiceClone: boolean) => {
    dispatch({ type: 'config', config: { voiceOver, voiceClone } }); // optimistic
    try {
      await fetch('/api/conversation/config', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminKeyRef.current}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceOver, voiceClone }),
      });
    } catch {
      /* server broadcasts the authoritative config back */
    }
  }, []);
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
    dispatch({ type: 'end' });
    socketRef.current?.close(); // server stops the session on socket close
  }, []);

  const clearError = useCallback(() => dispatch({ type: 'clearError' }), []);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
      void micRef.current?.stop();
      playbackRef.current?.close();
    };
  }, []);

  return {
    state, devices, selectedDeviceId,
    begin, press, release,
    setVoiceOver, setVoiceClone, setMicDevice,
    pause, resume, endConversation, clearError,
  };
}
