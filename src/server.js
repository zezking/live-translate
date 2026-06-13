import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { AudioCapture } from './audio-capture.js';
import { SessionManager } from './session-manager.js';
import { QwenTranslationSession } from './qwen-translation-session.js';
import { AudioBroadcaster } from './audio-broadcaster.js';
import { generateQRCode, getLocalIP } from './qr-generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'centrechurch';

const apiKeys = {
  gemini: process.env.GEMINI_API_KEY,
  qwen: process.env.DASHSCOPE_API_KEY,
};

const audioCapture = new AudioCapture();
const sessionManager = new SessionManager();
const broadcaster = new AudioBroadcaster(server);

let cachedTier = null;

async function detectGeminiTier() {
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
    const msg = err.message || '';
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

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const requireAdmin = (req, res, next) => {
  const auth = req.headers.authorization;
  if (auth === `Bearer ${ADMIN_PASSWORD}`) return next();
  if (req.query.key === ADMIN_PASSWORD) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'attendee.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.get('/interpreter', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'interpreter.html'));
});

audioCapture.on('chunk', (chunk) => {
  sessionManager.sendAudio(chunk);
});

sessionManager.on('audio', ({ languageCode, buffer }) => {
  broadcaster.broadcastAudio(languageCode, buffer);
});

sessionManager.on('transcription', ({ languageCode, type, text }) => {
  broadcaster.sendTranscription({ languageCode, type, text });
});

sessionManager.on('error', ({ languageCode, error }) => {
  console.error(`[${languageCode}] Qwen error: ${error}`);
});

sessionManager.on('sessionClosed', ({ languageCode, reason }) => {
  console.error(`[${languageCode}] session closed: ${reason}`);
});

app.get('/api/status', async (req, res) => {
  const stats = sessionManager.getStats();
  let tier = null;
  if (stats.provider === 'gemini' || (!stats.provider && apiKeys.gemini)) {
    tier = await detectGeminiTier();
  }
  res.json({
    ...stats,
    tier,
    estimatedCost: tier === 'free' ? 0 : stats.estimatedCost,
    attendees: broadcaster.getClientCount(),
    attendeesByLanguage: broadcaster.getClientsByLanguage(),
  });
});

app.get('/api/providers', (req, res) => {
  const providers = [];
  if (apiKeys.gemini) {
    providers.push({ id: 'gemini', label: 'Gemini Live Translate' });
  }
  if (apiKeys.qwen) {
    providers.push({ id: 'qwen', label: 'Qwen Live Translate' });
  }
  res.json({ providers, default: providers.length > 0 ? providers[0].id : null });
});

app.get('/api/key-status', requireAdmin, async (req, res) => {
  const result = { keys: {} };
  if (apiKeys.gemini) {
    result.keys.gemini = apiKeys.gemini.slice(0, 10) + '...';
    result.tier = await detectGeminiTier();
  }
  if (apiKeys.qwen) {
    result.keys.qwen = apiKeys.qwen.slice(0, 10) + '...';
  }
  res.json(result);
});

app.get('/api/languages', (req, res) => {
  res.json(SessionManager.LANGUAGES);
});

app.get('/api/voices', (req, res) => {
  res.json(QwenTranslationSession.VOICE_LIST);
});

app.get('/api/qrcode', requireAdmin, async (req, res) => {
  const { url, dataUrl } = await generateQRCode(PORT);
  res.json({ url, dataUrl });
});

app.post('/api/start', requireAdmin, async (req, res) => {
  try {
    const { languages, provider, voiceConfig } = req.body || {};
    if (languages) {
      sessionManager.setEnabledLanguages(languages);
    }
    const selectedProvider = provider || (apiKeys.gemini ? 'gemini' : 'qwen');
    await sessionManager.start(apiKeys, selectedProvider, voiceConfig || {});
    audioCapture.start();
    res.json({ status: 'started', provider: selectedProvider });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pause', requireAdmin, (req, res) => {
  sessionManager.pause();
  audioCapture.pause();
  broadcaster.broadcastStatus({ state: 'paused' });
  res.json({ status: 'paused' });
});

app.post('/api/resume', requireAdmin, (req, res) => {
  sessionManager.resume();
  audioCapture.resume();
  broadcaster.broadcastStatus({ state: 'translating' });
  res.json({ status: 'resumed' });
});

app.post('/api/stop', requireAdmin, async (req, res) => {
  try {
    audioCapture.stop();
    await sessionManager.stop();
    broadcaster.broadcastStatus({ state: 'stopped' });
    res.json({ status: 'stopped' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/audio-level', requireAdmin, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const handler = (chunk) => {
    let sum = 0;
    for (let i = 0; i < chunk.length; i += 2) {
      const sample = chunk.readInt16LE(i);
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / (chunk.length / 2));
    const db = 20 * Math.log10(Math.max(rms / 32768, 1e-10));
    res.write(`data: ${JSON.stringify({ db, rms })}\n\n`);
  };

  audioCapture.on('chunk', handler);
  req.on('close', () => {
    audioCapture.removeListener('chunk', handler);
  });
});

server.listen(PORT, '0.0.0.0', async () => {
  const ip = await getLocalIP();
  console.log(`\n  Centre Church Live Translation`);
  console.log(`  Admin:       http://localhost:${PORT}/admin`);
  console.log(`  Attendee:    http://${ip}:${PORT}`);
  console.log(`  Interpreter: http://${ip}:${PORT}/interpreter`);
  console.log(`  Providers:   ${[apiKeys.gemini && 'gemini', apiKeys.qwen && 'qwen'].filter(Boolean).join(', ') || 'none'}`);
  console.log(`  Press Ctrl+C to stop\n`);
});
