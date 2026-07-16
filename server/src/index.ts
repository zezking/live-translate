import { createServer as createHttps } from 'https';
import { createServer as createHttp, type Server as HttpServer, type IncomingMessage } from 'http';
import { existsSync, readFileSync } from 'fs';
import type { Duplex } from 'stream';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { env } from './env.js';
import { UsbAudioSource } from './usb-audio-source.js';
import { BrowserAudioSource, WS_ADMIN_INPUT_PATH } from './browser-audio-source.js';
import { SessionManager } from './session-manager.js';
import { QwenTranslationSession, type VoiceConfig } from './qwen-translation-session.js';
import { AudioBroadcaster } from './audio-broadcaster.js';
import { generateQRCode, generateQRCodeForUrl, getLocalIP } from './qr-generator.js';
import { ConversationManager } from './conversation-manager.js';
import { ConversationTransport, WS_CONVERSATION_PATH } from './conversation-transport.js';
import type { ConversationSession } from './conversation-session.js';
import { healthRouter } from './routes/health.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- HTTPS / HTTP server -------------------------------------------------
const keyPath = path.join(env.CERT_DIR, 'key.pem');
const certPath = path.join(env.CERT_DIR, 'cert.pem');
const useTls = existsSync(keyPath) && existsSync(certPath);

const app = express();
// `server` is created before the broadcaster / browser-audio-source so they
// can attach their WebSocket servers to it. We annotate as HttpServer so the
// https.Server | http.Server union stays assignable to the module constructors.
const server: HttpServer = useTls
  ? createHttps({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, app)
  : createHttp(app);

const { ADMIN_PASSWORD, PORT } = env;
const apiKeys = env.apiKeys;

// --- active audio source -------------------------------------------------
type AudioSource = UsbAudioSource | BrowserAudioSource;
let activeSource: AudioSource;
let activeInputSource: string | null = null;

// --- core modules --------------------------------------------------------
const sessionManager = new SessionManager();
const broadcaster = new AudioBroadcaster(server);
const browserAudioSource = new BrowserAudioSource(server, ADMIN_PASSWORD);
browserAudioSource.start();

const conversationManager = new ConversationManager();
const conversationTransport = new ConversationTransport(conversationManager);

// --- manual WS-upgrade routing ------------------------------------------
// ws v8 aborts non-matching paths, which destroys the socket before other WSS
// instances can handle it. Capture the broadcaster's '/ws' listener(s), remove
// all upgrade listeners, then re-add a single router that dispatches by path:
//   /ws/admin-input -> BrowserAudioSource
//   everything else -> the previously-captured listeners (broadcaster /ws)
const existingUpgradeListeners = server.listeners('upgrade').slice();
server.removeAllListeners('upgrade');
server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (pathname === WS_ADMIN_INPUT_PATH) {
    browserAudioSource.handleUpgrade(req, socket, head);
  } else if (pathname === WS_CONVERSATION_PATH) {
    conversationTransport.handleUpgrade(req, socket, head);
  } else {
    for (const listener of existingUpgradeListeners) {
      listener.call(server, req, socket, head);
    }
  }
});

function createSource(inputSource: string | null): AudioSource | null {
  if (inputSource === 'usb' || !inputSource) return new UsbAudioSource();
  if (inputSource === 'browser' || inputSource === 'system') {
    return browserAudioSource;
  }
  return null;
}

activeSource = createSource('usb')!;
activeSource.on('chunk', (chunk: Buffer) => sessionManager.sendAudio(chunk));

// --- gemini tier detection ----------------------------------------------
let cachedTier: string | null = null;

async function detectGeminiTier(): Promise<string> {
  const apiKey = apiKeys.gemini;
  if (!apiKey) return 'missing';
  if (cachedTier !== null) return cachedTier;
  try {
    const ai = new GoogleGenAI({ apiKey });
    await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: 'hi',
    });
    cachedTier = 'paid';
  } catch (err) {
    const msg = (err as Error).message || '';
    if (msg.includes('free_tier')) {
      cachedTier = 'free';
    } else if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
      cachedTier = 'free';
    } else if (msg.includes('PERMISSION_DENIED') || msg.includes('403')) {
      cachedTier = 'unknown';
    } else {
      cachedTier = 'paid';
    }
  }
  return cachedTier;
}

// --- express middleware + static + page routes --------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', '..', 'public')));
app.use('/api/health', healthRouter);

const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
  const auth = req.headers.authorization;
  if (auth === `Bearer ${ADMIN_PASSWORD}`) {
    next();
    return;
  }
  if (req.query.key === ADMIN_PASSWORD) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized' });
};

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'attendee.html'));
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'admin.html'));
});

app.get('/interpreter', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'interpreter.html'));
});

app.get('/conversation', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'conversation.html'));
});

// --- session manager -> broadcaster wiring ------------------------------
sessionManager.on('audio', ({ languageCode, buffer }) => {
  broadcaster.broadcastAudio(languageCode, buffer);
});

sessionManager.on('transcription', ({ languageCode, type, text }) => {
  broadcaster.broadcastTranscription(languageCode, type, text);
});

sessionManager.on('error', ({ languageCode, error }) => {
  const msg =
    typeof error === 'object' && error !== null
      ? (error.error || error.message || JSON.stringify(error))
      : error;
  console.error(`[${languageCode}] error: ${msg}`);
});

sessionManager.on('sessionClosed', ({ languageCode, reason }) => {
  console.error(`[${languageCode}] session closed: ${reason}`);
});

// --- API routes ----------------------------------------------------------
app.get('/api/status', async (_req, res) => {
  const stats = sessionManager.getStats();
  let tier: string | null = null;
  if (stats.provider === 'gemini' || (!stats.provider && apiKeys.gemini)) {
    tier = await detectGeminiTier();
  }
  res.json({
    ...stats,
    tier,
    estimatedCost: tier === 'free' ? 0 : stats.estimatedCost,
    attendees: broadcaster.getClientCount(),
    attendeesByLanguage: broadcaster.getClientsByLanguage(),
    inputSource: stats.isRunning ? activeInputSource : null,
  });
});

app.get('/api/providers', (_req, res) => {
  const providers: { id: string; label: string }[] = [];
  if (apiKeys.gemini) {
    providers.push({ id: 'gemini', label: 'Gemini Live Translate' });
  }
  if (apiKeys.qwen) {
    providers.push({ id: 'qwen', label: 'Qwen Live Translate' });
  }
  res.json({ providers, default: providers.length > 0 ? providers[0].id : null });
});

app.get('/api/key-status', requireAdmin, async (_req, res) => {
  const result: { keys: Record<string, string>; tier?: string } = { keys: {} };
  if (apiKeys.gemini) {
    result.keys.gemini = apiKeys.gemini.slice(0, 10) + '...';
    result.tier = await detectGeminiTier();
  }
  if (apiKeys.qwen) {
    result.keys.qwen = apiKeys.qwen.slice(0, 10) + '...';
  }
  res.json(result);
});

app.get('/api/languages', (_req, res) => {
  res.json(SessionManager.LANGUAGES);
});

app.get('/api/voices', (_req, res) => {
  res.json(QwenTranslationSession.VOICE_LIST);
});

app.get('/api/qrcode', requireAdmin, async (_req, res) => {
  const { url, dataUrl } = await generateQRCode(PORT);
  res.json({ url, dataUrl });
});

app.post('/api/start', requireAdmin, async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      languages?: string[];
      provider?: string;
      voiceConfig?: VoiceConfig;
      inputSource?: string;
    };
    const { languages, provider, voiceConfig, inputSource } = body;
    if (inputSource && !['usb', 'browser', 'system'].includes(inputSource)) {
      res.status(400).json({ error: `Invalid inputSource: ${inputSource}` });
      return;
    }
    const effectiveSource = inputSource || 'usb';

    const newSource = createSource(effectiveSource);
    if (!newSource) {
      res.status(400).json({ error: `Invalid inputSource: ${effectiveSource}` });
      return;
    }

    if (activeSource) {
      activeSource.removeAllListeners('chunk');
      activeSource.stop();
    }

    activeSource = newSource;
    activeInputSource = effectiveSource;
    activeSource.on('chunk', (chunk: Buffer) => sessionManager.sendAudio(chunk));

    if (languages) {
      sessionManager.setEnabledLanguages(languages);
    }
    const selectedProvider = provider || (apiKeys.gemini ? 'gemini' : 'qwen');
    activeSource.start();
    try {
      await sessionManager.start(apiKeys as unknown as Record<string, string>, selectedProvider, voiceConfig || {});
    } catch (err) {
      activeSource.stop();
      throw err;
    }
    res.json({ status: 'started', provider: selectedProvider, inputSource: effectiveSource });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/pause', requireAdmin, (_req, res) => {
  sessionManager.pause();
  activeSource.pause();
  broadcaster.broadcastStatus({ state: 'paused' });
  res.json({ status: 'paused' });
});

app.post('/api/resume', requireAdmin, (_req, res) => {
  sessionManager.resume();
  activeSource.resume();
  broadcaster.broadcastStatus({ state: 'translating' });
  res.json({ status: 'resumed' });
});

app.post('/api/stop', requireAdmin, async (_req, res) => {
  try {
    activeSource.stop();
    activeSource = createSource('usb')!;
    activeSource.on('chunk', (chunk: Buffer) => sessionManager.sendAudio(chunk));
    activeInputSource = null;
    await sessionManager.stop();
    broadcaster.broadcastStatus({ state: 'stopped' });
    res.json({ status: 'stopped' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/audio-level', requireAdmin, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const handler = (chunk: Buffer): void => {
    let sum = 0;
    for (let i = 0; i < chunk.length; i += 2) {
      const sample = chunk.readInt16LE(i);
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / (chunk.length / 2));
    const db = 20 * Math.log10(Math.max(rms / 32768, 1e-10));
    res.write(`data: ${JSON.stringify({ db, rms })}\n\n`);
  };

  activeSource.on('chunk', handler);
  req.on('close', () => {
    activeSource.removeListener('chunk', handler);
  });
});

// --- conversation routes -------------------------------------------------
app.post('/api/conversation/create', requireAdmin, async (req, res) => {
  let roomId: string | undefined;
  let session: ConversationSession | undefined;
  try {
    const { hostName, partnerName, voiceOver, voiceClone } = (req.body ?? {}) as {
      hostName?: string;
      partnerName?: string;
      voiceOver?: boolean;
      voiceClone?: boolean;
    };
    const apiKey = apiKeys.qwen;
    if (!apiKey) {
      res.status(400).json({ error: 'No Qwen API key configured (DASHSCOPE_API_KEY)' });
      return;
    }
    const created = conversationManager.createRoom({
      apiKey,
      names: { host: hostName || 'You', joiner: partnerName || 'Partner' },
      config: { voiceOver: !!voiceOver, voiceClone: !!voiceClone },
    });
    roomId = created.roomId;
    session = created.session;
    await session.start();
    const ip = await getLocalIP();
    const joinUrl = `${req.protocol}://${ip}:${PORT}/conversation?token=${created.joinToken}`;
    const qrDataUrl = await generateQRCodeForUrl(joinUrl);
    res.json({ roomId, hostToken: created.hostToken, joinToken: created.joinToken, joinUrl, qrDataUrl });
  } catch (err) {
    try {
      if (session) await session.stop();
    } catch {
      /* ignore cleanup error */
    }
    if (roomId) conversationManager.removeRoom(roomId);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/conversation/config', requireAdmin, async (req, res) => {
  const { roomId, voiceOver, voiceClone } = (req.body ?? {}) as {
    roomId: string;
    voiceOver?: boolean;
    voiceClone?: boolean;
  };
  const room = conversationManager.getRoom(roomId);
  if (!room) {
    res.status(404).json({ error: 'room not found' });
    return;
  }
  await room.session.setConfig({ voiceOver, voiceClone });
  res.json({ ok: true });
});

app.post('/api/conversation/end', requireAdmin, async (req, res) => {
  const { roomId } = (req.body ?? {}) as { roomId: string };
  const room = conversationManager.getRoom(roomId);
  if (!room) {
    res.status(404).json({ error: 'room not found' });
    return;
  }
  await room.session.stop();
  conversationManager.removeRoom(roomId);
  res.json({ ok: true });
});

conversationManager.on('error', ({ role, error }: { role: string; error: unknown }) => {
  const msg =
    typeof error === 'object' && error !== null
      ? ((error as Record<string, unknown>).error || (error as Error).message || JSON.stringify(error))
      : error;
  console.error(`[conversation:${role}] error: ${msg}`);
});

// --- boot ----------------------------------------------------------------
server.listen(PORT, '0.0.0.0', async () => {
  const ip = await getLocalIP();
  const scheme = useTls ? 'https' : 'http';
  console.log(`\n  Centre Church Live Translation (v2)`);
  console.log(`  Admin:       ${scheme}://localhost:${PORT}/admin`);
  console.log(`  Attendee:    ${scheme}://${ip}:${PORT}`);
  console.log(`  Interpreter: ${scheme}://${ip}:${PORT}/interpreter`);
  const providers = [apiKeys.gemini && 'gemini', apiKeys.qwen && 'qwen'].filter(Boolean).join(', ');
  console.log(`  Providers:   ${providers || 'none'}`);
  console.log(`  Press Ctrl+C to stop\n`);
});
