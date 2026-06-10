import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { AudioCapture } from './audio-capture.js';
import { SessionManager } from './session-manager.js';
import { AudioBroadcaster } from './audio-broadcaster.js';
import { generateQRCode, getLocalIP } from './qr-generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'centrechurch';

const apiKey = process.env.GEMINI_API_KEY;
const audioCapture = new AudioCapture();
const sessionManager = new SessionManager(apiKey);
const broadcaster = new AudioBroadcaster(server);
const genAI = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });

let cachedTier = null;

async function detectTier() {
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
  broadcaster.broadcastTranscription(languageCode, type, text);
});

app.get('/api/status', async (req, res) => {
  const stats = sessionManager.getStats();
  const tier = await detectTier();
  res.json({
    ...stats,
    tier,
    estimatedCost: tier === 'free' ? 0 : stats.estimatedCost,
    attendees: broadcaster.getClientCount(),
    attendeesByLanguage: broadcaster.getClientsByLanguage(),
  });
});

app.get('/api/key-status', requireAdmin, async (req, res) => {
  const tier = await detectTier();
  const keyPrefix = apiKey ? apiKey.slice(0, 10) + '...' : 'missing';
  res.json({ tier, keyPrefix });
});

app.get('/api/languages', (req, res) => {
  res.json(SessionManager.LANGUAGES);
});

app.post('/api/ephemeral-token', async (req, res) => {
  const { languageCode } = req.body || {};
  if (!languageCode) {
    return res.status(400).json({ error: 'languageCode required' });
  }

  try {
    const expireTime = new Date(Date.now() + 90 * 60 * 1000).toISOString();
    const token = await genAI.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime: expireTime,
        liveConnectConstraints: {
          model: 'gemini-3.5-live-translate-preview',
          config: {
            responseModalities: ['AUDIO'],
            outputAudioTranscription: {},
            translationConfig: {
              targetLanguageCode: languageCode,
              echoTargetLanguage: false,
            },
          },
        },
        httpOptions: { apiVersion: 'v1alpha' },
      },
    });
    res.json({ token: token.name });
  } catch (err) {
    console.error('Ephemeral token error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/audio-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const handler = (chunk) => {
    res.write(`data: ${chunk.toString('base64')}\n\n`);
  };

  audioCapture.on('chunk', handler);
  req.on('close', () => {
    audioCapture.removeListener('chunk', handler);
  });
});

app.get('/api/qrcode', requireAdmin, async (req, res) => {
  const { url, dataUrl } = await generateQRCode(PORT);
  res.json({ url, dataUrl });
});

app.post('/api/start', requireAdmin, async (req, res) => {
  try {
    const { languages } = req.body || {};
    if (languages) {
      sessionManager.setEnabledLanguages(languages);
    }
    await sessionManager.start();
    audioCapture.start();
    res.json({ status: 'started' });
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
  console.log(`  Press Ctrl+C to stop\n`);
});
