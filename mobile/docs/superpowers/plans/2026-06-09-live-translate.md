# Church Live Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js app that captures live audio from the soundboard, translates it in real-time using Gemini 3.5 Live Translate, and streams translated audio to attendees' phone browsers via WebSocket.

**Architecture:** Express server serves static HTML pages (attendee + admin). Audio is captured from macOS audio input, chunked into 100ms PCM buffers, and sent to 4 parallel Gemini Live Translate sessions (one per language). Translated audio is broadcast via WebSocket to connected attendees. The admin panel controls start/pause/stop.

**Tech Stack:** Node.js, Express, `@google/genai`, `ws` (WebSocket), `qrcode`, HTML/CSS/JS (no framework), `node-record-lpcm16` for audio capture

**Spec:** `docs/superpowers/specs/2026-06-09-live-translate-design.md`

---

## File Structure

```
src/
├── server.js                  # Express server + WebSocket + routes
├── audio-capture.js           # macOS audio input capture → PCM chunks
├── translation-session.js     # Gemini Live Translate session per language
├── session-manager.js         # Manages multiple translation sessions
├── audio-broadcaster.js       # WebSocket broadcast to attendees
├── cost-tracker.js            # Running API cost estimate
├── qr-generator.js            # QR code generation from LAN IP
public/
├── attendee.html              # Attendee language selection + audio player
├── attendee.css               # Attendee page styles (white theme)
├── attendee.js                # WebSocket client + audio playback
├── admin.html                 # Operator control panel
├── admin.css                  # Admin panel styles (dark theme)
├── admin.js                   # Admin controls + audio level + stats
.env.example                   # Template for environment variables
package.json
```

---

### Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `src/`

- [ ] **Step 1: Initialize npm project and install dependencies**

```bash
npm init -y
npm install express @google/genai ws qrcode node-record-lpcm16 dotenv
```

- [ ] **Step 2: Update package.json with start script and type module**

In `package.json`, set:

```json
{
  "type": "module",
  "scripts": {
    "start": "node src/server.js"
  }
}
```

- [ ] **Step 3: Create `.env.example`**

```
GEMINI_API_KEY=your-api-key-here
PORT=3000
```

- [ ] **Step 4: Create `src/` and `public/` directories**

```bash
mkdir -p src public
```

- [ ] **Step 5: Copy `.env.example` to `.env` and verify**

```bash
cp .env.example .env
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: project setup with dependencies"
```

---

### Task 2: Audio Capture Module

**Files:**
- Create: `src/audio-capture.js`

This module captures audio from macOS audio input (3.5mm jack) and emits 100ms PCM chunks suitable for the Gemini API.

- [ ] **Step 1: Create `src/audio-capture.js`**

```javascript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/audio-capture.js
git commit -m "feat: audio capture module with 100ms PCM chunking"
```

---

### Task 3: Gemini Translation Session

**Files:**
- Create: `src/translation-session.js`

Manages a single Gemini Live Translate session for one target language.

- [ ] **Step 1: Create `src/translation-session.js`**

```javascript
import { GoogleGenAI, Modality } from '@google/genai';
import { EventEmitter } from 'events';

export class TranslationSession extends EventEmitter {
  constructor(apiKey, languageCode) {
    super();
    this.apiKey = apiKey;
    this.languageCode = languageCode;
    this.session = null;
    this.isActive = false;
    this.inputMinutes = 0;
    this.outputMinutes = 0;
  }

  async connect() {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });

    this.session = await ai.live.connect({
      model: 'gemini-3.5-live-translate-preview',
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        translationConfig: {
          targetLanguageCode: this.languageCode,
          echoTargetLanguage: false,
        },
      },
      callbacks: {
        onopen: () => {
          this.isActive = true;
          this.emit('connected', this.languageCode);
        },
        onmessage: (message) => {
          const content = message.serverContent;
          if (content?.inputTranscription) {
            this.emit('inputTranscription', content.inputTranscription.text);
          }
          if (content?.outputTranscription) {
            this.emit('outputTranscription', content.outputTranscription.text);
          }
          if (content?.modelTurn?.parts) {
            for (const part of content.modelTurn.parts) {
              if (part.inlineData) {
                const audioBuffer = Buffer.from(part.inlineData.data, 'base64');
                this.outputMinutes += audioBuffer.length / (24000 * 2);
                this.emit('audio', audioBuffer);
              }
            }
          }
        },
        onerror: (e) => {
          this.emit('error', { languageCode: this.languageCode, error: e.message });
        },
        onclose: (e) => {
          this.isActive = false;
          this.emit('closed', { languageCode: this.languageCode, reason: e.reason });
        },
      },
    });
  }

  sendAudio(pcmBuffer) {
    if (!this.session || !this.isActive) return;
    this.inputMinutes += pcmBuffer.length / (16000 * 2);
    this.session.sendRealtimeInput({
      audio: {
        data: pcmBuffer.toString('base64'),
        mimeType: 'audio/pcm;rate=16000',
      },
    });
  }

  async disconnect() {
    if (this.session) {
      this.session.close();
      this.session = null;
      this.isActive = false;
    }
  }

  getUsage() {
    return {
      languageCode: this.languageCode,
      inputMinutes: this.inputMinutes,
      outputMinutes: this.outputMinutes,
    };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/translation-session.js
git commit -m "feat: Gemini translation session module per language"
```

---

### Task 4: Session Manager

**Files:**
- Create: `src/session-manager.js`

Manages multiple translation sessions (one per enabled language), routes audio chunks to all active sessions, and tracks aggregate stats.

- [ ] **Step 1: Create `src/session-manager.js`**

```javascript
import { TranslationSession } from './translation-session.js';
import { EventEmitter } from 'events';

const LANGUAGES = [
  { code: 'zh-Hans', label: '中文 (Mandarin)' },
  { code: 'ko', label: '한국어 (Korean)' },
  { code: 'pt-BR', label: 'Português (Portuguese)' },
  { code: 'es', label: 'Español (Spanish)' },
];

export class SessionManager extends EventEmitter {
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
    this.sessions = new Map();
    this.enabledLanguages = new Set(LANGUAGES.map((l) => l.code));
    this.isRunning = false;
    this.isPaused = false;
    this.startTime = null;
  }

  static get LANGUAGES() {
    return LANGUAGES;
  }

  setEnabledLanguages(codes) {
    this.enabledLanguages = new Set(codes);
  }

  async start() {
    if (this.isRunning) return;

    const promises = [];
    for (const code of this.enabledLanguages) {
      const session = new TranslationSession(this.apiKey, code);

      session.on('audio', (buffer) => {
        this.emit('audio', { languageCode: code, buffer });
      });

      session.on('inputTranscription', (text) => {
        this.emit('transcription', { languageCode: code, type: 'input', text });
      });

      session.on('outputTranscription', (text) => {
        this.emit('transcription', { languageCode: code, type: 'output', text });
      });

      session.on('error', (err) => {
        this.emit('error', err);
      });

      session.on('closed', (info) => {
        this.emit('sessionClosed', info);
      });

      this.sessions.set(code, session);
      promises.push(session.connect());
    }

    await Promise.all(promises);
    this.isRunning = true;
    this.isPaused = false;
    this.startTime = Date.now();
    this.emit('started');
  }

  sendAudio(pcmBuffer) {
    if (!this.isRunning || this.isPaused) return;
    for (const session of this.sessions.values()) {
      session.sendAudio(pcmBuffer);
    }
  }

  pause() {
    this.isPaused = true;
    this.emit('paused');
  }

  resume() {
    this.isPaused = false;
    this.emit('resumed');
  }

  async stop() {
    const promises = [];
    for (const session of this.sessions.values()) {
      promises.push(session.disconnect());
    }
    await Promise.all(promises);
    this.sessions.clear();
    this.isRunning = false;
    this.isPaused = false;
    this.emit('stopped');
  }

  getStats() {
    const sessionUsages = [];
    for (const [code, session] of this.sessions) {
      sessionUsages.push(session.getUsage());
    }
    const totalInput = sessionUsages.reduce((sum, u) => sum + u.inputMinutes, 0);
    const totalOutput = sessionUsages.reduce((sum, u) => sum + u.outputMinutes, 0);
    const elapsed = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;

    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      elapsedSeconds: elapsed,
      activeLanguages: Array.from(this.sessions.keys()),
      totalInputMinutes: totalInput,
      totalOutputMinutes: totalOutput,
      estimatedCost: totalInput * 0.0053 + totalOutput * 0.0315,
    };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/session-manager.js
git commit -m "feat: session manager for multiple translation streams"
```

---

### Task 5: Audio Broadcaster (WebSocket)

**Files:**
- Create: `src/audio-broadcaster.js`

Manages WebSocket connections from attendees. Routes translated audio to attendees based on their selected language.

- [ ] **Step 1: Create `src/audio-broadcaster.js`**

```javascript
import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';

export class AudioBroadcaster extends EventEmitter {
  constructor(server) {
    super();
    this.clients = new Map();
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      const clientId = Date.now().toString(36) + Math.random().toString(36).slice(2);
      const clientInfo = { languageCode: null, ws };

      this.clients.set(clientId, clientInfo);
      this.emit('clientConnected', { clientId, totalClients: this.clients.size });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'selectLanguage') {
            clientInfo.languageCode = msg.languageCode;
          }
        } catch (e) {
          // ignore malformed messages
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        this.emit('clientDisconnected', { clientId, totalClients: this.clients.size });
      });

      ws.on('error', () => {
        this.clients.delete(clientId);
      });
    });
  }

  broadcastAudio(languageCode, pcmBuffer) {
    const base64 = pcmBuffer.toString('base64');
    const message = JSON.stringify({
      type: 'audio',
      languageCode,
      data: base64,
    });

    for (const [, client] of this.clients) {
      if (client.languageCode === languageCode && client.ws.readyState === 1) {
        client.ws.send(message);
      }
    }
  }

  broadcastStatus(status) {
    const message = JSON.stringify({
      type: 'status',
      ...status,
    });

    for (const [, client] of this.clients) {
      if (client.ws.readyState === 1) {
        client.ws.send(message);
      }
    }
  }

  getClientCount() {
    return this.clients.size;
  }

  getClientsByLanguage() {
    const counts = {};
    for (const [, client] of this.clients) {
      if (client.languageCode) {
        counts[client.languageCode] = (counts[client.languageCode] || 0) + 1;
      }
    }
    return counts;
  }

  close() {
    for (const [, client] of this.clients) {
      client.ws.close();
    }
    this.wss.close();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/audio-broadcaster.js
git commit -m "feat: WebSocket audio broadcaster for attendees"
```

---

### Task 6: QR Code Generator

**Files:**
- Create: `src/qr-generator.js`

Generates a QR code PNG data URL from the MacBook's LAN IP address.

- [ ] **Step 1: Create `src/qr-generator.js`**

```javascript
import QRCode from 'qrcode';
import os from 'os';

export async function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

export async function generateQRCode(port = 3000) {
  const ip = await getLocalIP();
  const url = `http://${ip}:${port}`;
  const dataUrl = await QRCode.toDataURL(url, {
    width: 300,
    margin: 2,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
  return { url, dataUrl };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/qr-generator.js
git commit -m "feat: QR code generator from LAN IP"
```

---

### Task 7: Express Server (Main Entry Point)

**Files:**
- Create: `src/server.js`

Main server that ties everything together. Serves static files, handles admin API routes, and wires up audio capture → translation → broadcast.

- [ ] **Step 1: Create `src/server.js`**

```javascript
import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { AudioCapture } from './audio-capture.js';
import { SessionManager } from './session-manager.js';
import { AudioBroadcaster } from './audio-broadcaster.js';
import { generateQRCode, getLocalIP } from './qr-generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

const audioCapture = new AudioCapture();
const sessionManager = new SessionManager(process.env.GEMINI_API_KEY);
const broadcaster = new AudioBroadcaster(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Audio flow: capture → translate → broadcast
audioCapture.on('chunk', (chunk) => {
  sessionManager.sendAudio(chunk);
});

sessionManager.on('audio', ({ languageCode, buffer }) => {
  broadcaster.broadcastAudio(languageCode, buffer);
});

// Admin API routes
app.get('/api/status', (req, res) => {
  const stats = sessionManager.getStats();
  res.json({
    ...stats,
    attendees: broadcaster.getClientCount(),
    attendeesByLanguage: broadcaster.getClientsByLanguage(),
  });
});

app.get('/api/languages', (req, res) => {
  res.json(SessionManager.LANGUAGES);
});

app.get('/api/qrcode', async (req, res) => {
  const { url, dataUrl } = await generateQRCode(PORT);
  res.json({ url, dataUrl });
});

app.post('/api/start', async (req, res) => {
  try {
    const { languages } = req.body;
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

app.post('/api/pause', (req, res) => {
  sessionManager.pause();
  audioCapture.pause();
  broadcaster.broadcastStatus({ state: 'paused' });
  res.json({ status: 'paused' });
});

app.post('/api/resume', (req, res) => {
  sessionManager.resume();
  audioCapture.resume();
  broadcaster.broadcastStatus({ state: 'translating' });
  res.json({ status: 'resumed' });
});

app.post('/api/stop', async (req, res) => {
  try {
    audioCapture.stop();
    await sessionManager.stop();
    broadcaster.broadcastStatus({ state: 'stopped' });
    res.json({ status: 'stopped' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/audio-level', (req, res) => {
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

// Start server
server.listen(PORT, '0.0.0.0', async () => {
  const ip = await getLocalIP();
  console.log(`\n  Live Translate`);
  console.log(`  Admin:  http://localhost:${PORT}/admin`);
  console.log(`  Attend: http://${ip}:${PORT}`);
  console.log(`  Press Ctrl+C to stop\n`);
});
```

- [ ] **Step 2: Commit**

```bash
git add src/server.js
git commit -m "feat: Express server with admin API and audio pipeline"
```

---

### Task 8: Attendee Web Page

**Files:**
- Create: `public/attendee.html`
- Create: `public/attendee.css`
- Create: `public/attendee.js`

The mobile-first page where attendees select a language and listen to translated audio. White theme, clean black and white design per the UI spec.

- [ ] **Step 1: Create `public/attendee.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Live Translate — Live Translation</title>
  <link rel="stylesheet" href="attendee.css">
</head>
<body>
  <div id="app">
    <!-- Language Selection View -->
    <div id="select-view">
      <div class="header">
        <h1 class="title">LIVE TRANSLATE</h1>
        <p class="subtitle">Live Translation</p>
      </div>
      <div class="divider"></div>
      <p class="prompt">Select your language:</p>
      <div id="language-buttons" class="language-list"></div>
      <div class="divider"></div>
      <p class="footer">Live Translate 2025</p>
    </div>

    <!-- Player View -->
    <div id="player-view" class="hidden">
      <h2 id="player-language" class="player-title"></h2>
      <div class="live-indicator">
        <span class="live-dot"></span>
        <span>LIVE</span>
      </div>
      <p id="player-status" class="status-text">Listening...</p>
      <p id="player-timer" class="timer">00:00:00</p>
      <button id="pause-btn" class="pause-btn">Pause</button>
      <div class="volume-control">
        <span class="volume-icon">&#x1F50A;</span>
        <input id="volume-slider" type="range" min="0" max="100" value="80" class="volume-slider">
      </div>
      <button id="change-lang-btn" class="change-lang">&larr; Change Language</button>
      <div class="divider"></div>
      <p class="footer">Live Translate 2025</p>
    </div>
  </div>

  <!-- Reconnect overlay -->
  <div id="reconnect-overlay" class="hidden">
    <p>Reconnecting...</p>
  </div>

  <script src="attendee.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/attendee.css`**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #fff;
  color: #000;
  min-height: 100dvh;
  -webkit-font-smoothing: antialiased;
}

#app {
  max-width: 420px;
  margin: 0 auto;
  padding: 48px 24px 32px;
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}

.hidden {
  display: none !important;
}

.header {
  text-align: center;
  margin-bottom: 32px;
}

.title {
  font-size: 18px;
  letter-spacing: 3px;
  font-weight: 600;
  margin-bottom: 8px;
}

.subtitle {
  font-size: 14px;
  color: #999;
  letter-spacing: 1px;
}

.divider {
  height: 1px;
  background: #E0E0E0;
  margin: 24px 0;
}

.prompt {
  font-size: 14px;
  color: #999;
  margin-bottom: 16px;
}

.language-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lang-btn {
  display: block;
  width: 100%;
  padding: 18px 16px;
  font-size: 16px;
  font-weight: 500;
  text-align: center;
  background: #fff;
  color: #000;
  border: 1px solid #000;
  border-radius: 0;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  -webkit-tap-highlight-color: transparent;
  min-height: 56px;
}

.lang-btn:active {
  background: #000;
  color: #fff;
}

.player-title {
  text-align: center;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 1px;
  margin-bottom: 24px;
}

.live-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 32px;
  font-size: 13px;
  letter-spacing: 2px;
  color: #999;
}

.live-dot {
  width: 8px;
  height: 8px;
  background: #000;
  border-radius: 50%;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.status-text {
  text-align: center;
  font-size: 14px;
  color: #999;
  margin-bottom: 8px;
}

.timer {
  text-align: center;
  font-size: 24px;
  font-weight: 300;
  font-variant-numeric: tabular-nums;
  margin-bottom: 32px;
  letter-spacing: 2px;
}

.pause-btn {
  display: block;
  width: 100%;
  padding: 16px;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 1px;
  background: #fff;
  color: #000;
  border: 1px solid #000;
  cursor: pointer;
  margin-bottom: 24px;
  transition: background 0.15s, color 0.15s;
}

.pause-btn:active {
  background: #000;
  color: #fff;
}

.pause-btn.paused {
  background: #000;
  color: #fff;
}

.volume-control {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 32px;
  padding: 0 8px;
}

.volume-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.volume-slider {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 2px;
  background: #000;
  outline: none;
}

.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  background: #000;
  border-radius: 50%;
  cursor: pointer;
}

.change-lang {
  display: block;
  width: 100%;
  padding: 12px;
  font-size: 13px;
  background: none;
  border: none;
  color: #999;
  cursor: pointer;
  text-align: center;
}

.change-lang:active {
  color: #000;
}

.footer {
  text-align: center;
  font-size: 11px;
  color: #E0E0E0;
  letter-spacing: 1px;
}

#reconnect-overlay {
  position: fixed;
  inset: 0;
  background: rgba(255, 255, 255, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #999;
  letter-spacing: 1px;
  z-index: 100;
}
```

- [ ] **Step 3: Create `public/attendee.js`**

```javascript
(function () {
  const selectView = document.getElementById('select-view');
  const playerView = document.getElementById('player-view');
  const languageButtons = document.getElementById('language-buttons');
  const playerLanguage = document.getElementById('player-language');
  const playerStatus = document.getElementById('player-status');
  const playerTimer = document.getElementById('player-timer');
  const pauseBtn = document.getElementById('pause-btn');
  const volumeSlider = document.getElementById('volume-slider');
  const changeLangBtn = document.getElementById('change-lang-btn');
  const reconnectOverlay = document.getElementById('reconnect-overlay');

  let ws = null;
  let selectedLanguage = null;
  let isPaused = false;
  let audioContext = null;
  let audioQueue = [];
  let isPlaying = false;
  let nextPlayTime = 0;
  let gainNode = null;
  let timerInterval = null;
  let sessionStartTime = null;

  const LANGUAGE_LABELS = {
    'zh-Hans': '中文 (Mandarin)',
    'ko': '한국어 (Korean)',
    'pt-BR': 'Português (Portuguese)',
    'es': 'Español (Spanish)',
  };

  function init() {
    fetch('/api/languages')
      .then((r) => r.json())
      .then((languages) => {
        languageButtons.innerHTML = '';
        languages.forEach((lang) => {
          const btn = document.createElement('button');
          btn.className = 'lang-btn';
          btn.textContent = lang.label;
          btn.addEventListener('click', () => selectLanguage(lang.code, lang.label));
          languageButtons.appendChild(btn);
        });
      });
  }

  function selectLanguage(code, label) {
    selectedLanguage = code;
    playerLanguage.textContent = label;
    selectView.classList.add('hidden');
    playerView.classList.remove('hidden');
    connectWebSocket();
  }

  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.onopen = () => {
      reconnectOverlay.classList.add('hidden');
      ws.send(JSON.stringify({ type: 'selectLanguage', languageCode: selectedLanguage }));
      startAudio();
      startTimer();
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'audio' && !isPaused) {
        queueAudio(msg.data);
      }
      if (msg.type === 'status') {
        if (msg.state === 'paused') {
          playerStatus.textContent = 'Paused';
        } else if (msg.state === 'translating') {
          playerStatus.textContent = 'Listening...';
        } else if (msg.state === 'stopped') {
          playerStatus.textContent = 'Session ended';
        }
      }
    };

    ws.onclose = () => {
      reconnectOverlay.classList.remove('hidden');
      setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = () => {
      reconnectOverlay.classList.remove('hidden');
    };
  }

  function startAudio() {
    if (audioContext) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    gainNode = audioContext.createGain();
    gainNode.connect(audioContext.destination);
    gainNode.gain.value = volumeSlider.value / 100;
    nextPlayTime = audioContext.currentTime;
  }

  function queueAudio(base64Data) {
    if (!audioContext) return;

    const raw = atob(base64Data);
    const pcm = new Int16Array(raw.length / 2);
    for (let i = 0; i < raw.length; i += 2) {
      pcm[i / 2] = (raw.charCodeAt(i + 1) << 8) | raw.charCodeAt(i);
    }

    const float32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
      float32[i] = pcm[i] / 32768;
    }

    const buffer = audioContext.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(gainNode);

    const now = audioContext.currentTime;
    if (nextPlayTime < now) {
      nextPlayTime = now;
    }
    source.start(nextPlayTime);
    nextPlayTime += buffer.duration;
  }

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    sessionStartTime = Date.now();
    timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
      const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
      const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
      const s = String(elapsed % 60).padStart(2, '0');
      playerTimer.textContent = `${h}:${m}:${s}`;
    }, 1000);
  }

  pauseBtn.addEventListener('click', () => {
    isPaused = !isPaused;
    pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
    pauseBtn.classList.toggle('paused', isPaused);
    playerStatus.textContent = isPaused ? 'Paused' : 'Listening...';
  });

  volumeSlider.addEventListener('input', () => {
    if (gainNode) {
      gainNode.gain.value = volumeSlider.value / 100;
    }
  });

  changeLangBtn.addEventListener('click', () => {
    if (ws) ws.close();
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    if (timerInterval) clearInterval(timerInterval);
    isPaused = false;
    pauseBtn.textContent = 'Pause';
    pauseBtn.classList.remove('paused');
    playerView.classList.add('hidden');
    selectView.classList.remove('hidden');
  });

  init();
})();
```

- [ ] **Step 4: Commit**

```bash
git add public/attendee.html public/attendee.css public/attendee.js
git commit -m "feat: attendee web page with language selection and audio player"
```

---

### Task 9: Admin Control Panel

**Files:**
- Create: `public/admin.html`
- Create: `public/admin.css`
- Create: `public/admin.js`

The operator control panel with dark theme, start/pause/stop controls, audio level meter, QR code, and session stats.

- [ ] **Step 1: Create `public/admin.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Live Translate — Live Translation Control</title>
  <link rel="stylesheet" href="admin.css">
</head>
<body>
  <div id="app">
    <div class="header">
      <h1 class="title">LIVE TRANSLATE — Live Translation Control</h1>
    </div>
    <div class="section-divider"></div>

    <div class="section">
      <p class="section-label">Status: <span id="status" class="status-text">Ready</span></p>
    </div>

    <div class="section">
      <p class="section-label">Languages:</p>
      <div id="language-checkboxes" class="language-grid"></div>
    </div>

    <div class="section">
      <p class="section-label">Audio Input:</p>
      <div class="level-meter-container">
        <div id="level-meter" class="level-meter"></div>
        <span id="level-db" class="level-db">-- dB</span>
      </div>
    </div>

    <div class="section-divider"></div>

    <div class="controls">
      <button id="start-btn" class="btn btn-start">START</button>
    </div>
    <div class="controls hidden" id="active-controls">
      <button id="pause-btn" class="btn btn-pause">PAUSE</button>
      <button id="stop-btn" class="btn btn-stop">STOP</button>
    </div>

    <div class="section-divider"></div>

    <div class="stats">
      <div class="stat">
        <span class="stat-label">Attendees</span>
        <span id="stat-attendees" class="stat-value">0</span>
      </div>
      <div class="stat">
        <span class="stat-label">Session</span>
        <span id="stat-timer" class="stat-value">00:00:00</span>
      </div>
      <div class="stat">
        <span class="stat-label">Est. cost</span>
        <span id="stat-cost" class="stat-value">$0.00</span>
      </div>
    </div>

    <div class="section-divider"></div>

    <div class="qr-section">
      <div class="qr-container">
        <img id="qr-image" src="" alt="QR Code">
      </div>
      <div class="qr-info">
        <p id="qr-url" class="qr-url"></p>
        <button id="print-qr-btn" class="btn btn-small">Print</button>
      </div>
    </div>

    <div class="section-divider"></div>
    <p class="footer">Live Translate 2025</p>
  </div>

  <script src="admin.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/admin.css`**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #000;
  color: #fff;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}

#app {
  max-width: 800px;
  margin: 0 auto;
  padding: 32px 40px;
}

.hidden {
  display: none !important;
}

.header {
  margin-bottom: 24px;
}

.title {
  font-size: 16px;
  letter-spacing: 2px;
  font-weight: 600;
}

.section-divider {
  height: 1px;
  background: #333;
  margin: 20px 0;
}

.section {
  margin-bottom: 16px;
}

.section-label {
  font-size: 13px;
  letter-spacing: 1px;
  color: #999;
  margin-bottom: 8px;
}

.status-text {
  color: #fff;
  font-weight: 500;
}

.status-text .status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  background: #fff;
  border-radius: 50%;
  margin-right: 6px;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.language-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.lang-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  cursor: pointer;
}

.lang-checkbox input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: #fff;
}

.level-meter-container {
  display: flex;
  align-items: center;
  gap: 12px;
}

.level-meter {
  flex: 1;
  height: 8px;
  background: #333;
  position: relative;
  overflow: hidden;
}

.level-meter-fill {
  height: 100%;
  background: #fff;
  width: 0%;
  transition: width 0.1s;
}

.level-db {
  font-size: 12px;
  color: #999;
  min-width: 60px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.controls {
  display: flex;
  gap: 16px;
  justify-content: center;
  margin: 20px 0;
}

.btn {
  padding: 14px 32px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 2px;
  border: 1px solid #fff;
  background: #fff;
  color: #000;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.btn:hover {
  background: transparent;
  color: #fff;
}

.btn-pause, .btn-stop {
  background: transparent;
  color: #fff;
}

.btn-pause:hover, .btn-stop:hover {
  background: #fff;
  color: #000;
}

.btn-small {
  padding: 8px 16px;
  font-size: 12px;
  letter-spacing: 1px;
}

.stats {
  display: flex;
  gap: 32px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 11px;
  color: #666;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.stat-value {
  font-size: 20px;
  font-weight: 300;
  font-variant-numeric: tabular-nums;
}

.qr-section {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}

.qr-container {
  background: #fff;
  padding: 12px;
}

.qr-container img {
  display: block;
  width: 180px;
  height: 180px;
}

.qr-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.qr-url {
  font-size: 13px;
  color: #999;
  word-break: break-all;
}

.footer {
  text-align: center;
  font-size: 11px;
  color: #333;
  letter-spacing: 1px;
}
```

- [ ] **Step 3: Create `public/admin.js`**

```javascript
(function () {
  const statusEl = document.getElementById('status');
  const languageCheckboxes = document.getElementById('language-checkboxes');
  const levelMeter = document.getElementById('level-meter');
  const levelDb = document.getElementById('level-db');
  const startBtn = document.getElementById('start-btn');
  const activeControls = document.getElementById('active-controls');
  const pauseBtn = document.getElementById('pause-btn');
  const stopBtn = document.getElementById('stop-btn');
  const statAttendees = document.getElementById('stat-attendees');
  const statTimer = document.getElementById('stat-timer');
  const statCost = document.getElementById('stat-cost');
  const qrImage = document.getElementById('qr-image');
  const qrUrl = document.getElementById('qr-url');
  const printQrBtn = document.getElementById('print-qr-btn');

  let levelEventSource = null;
  let pollInterval = null;

  // Init level meter
  const meterFill = document.createElement('div');
  meterFill.className = 'level-meter-fill';
  levelMeter.appendChild(meterFill);

  function init() {
    loadLanguages();
    loadQRCode();
  }

  async function loadLanguages() {
    const res = await fetch('/api/languages');
    const languages = await res.json();
    languageCheckboxes.innerHTML = '';
    languages.forEach((lang) => {
      const label = document.createElement('label');
      label.className = 'lang-checkbox';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = lang.code;
      checkbox.checked = true;
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(lang.label));
      languageCheckboxes.appendChild(label);
    });
  }

  async function loadQRCode() {
    const res = await fetch('/api/qrcode');
    const data = await res.json();
    qrImage.src = data.dataUrl;
    qrUrl.textContent = data.url;
  }

  function getEnabledLanguages() {
    const checkboxes = languageCheckboxes.querySelectorAll('input[type="checkbox"]');
    return Array.from(checkboxes)
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);
  }

  function setStatus(text, active) {
    if (active) {
      statusEl.innerHTML = `<span class="status-dot"></span>${text}`;
    } else {
      statusEl.textContent = text;
    }
  }

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      const res = await fetch('/api/status');
      const data = await res.json();
      statAttendees.textContent = data.attendees;
      statCost.textContent = '$' + data.estimatedCost.toFixed(2);

      if (data.elapsedSeconds > 0) {
        const h = String(Math.floor(data.elapsedSeconds / 3600)).padStart(2, '0');
        const m = String(Math.floor((data.elapsedSeconds % 3600) / 60)).padStart(2, '0');
        const s = String(Math.floor(data.elapsedSeconds % 60)).padStart(2, '0');
        statTimer.textContent = `${h}:${m}:${s}`;
      }
    }, 1000);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  function startAudioLevel() {
    levelEventSource = new EventSource('/api/audio-level');
    levelEventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const pct = Math.max(0, Math.min(100, ((data.db + 60) / 60) * 100));
      meterFill.style.width = pct + '%';
      levelDb.textContent = data.db.toFixed(0) + ' dB';
    };
  }

  function stopAudioLevel() {
    if (levelEventSource) {
      levelEventSource.close();
      levelEventSource = null;
    }
    meterFill.style.width = '0%';
    levelDb.textContent = '-- dB';
  }

  startBtn.addEventListener('click', async () => {
    const languages = getEnabledLanguages();
    if (languages.length === 0) {
      alert('Please select at least one language.');
      return;
    }
    startBtn.disabled = true;
    startBtn.textContent = 'STARTING...';

    try {
      await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ languages }),
      });

      setStatus('Translating', true);
      startBtn.classList.add('hidden');
      activeControls.classList.remove('hidden');
      startAudioLevel();
      startPolling();
      disableLanguageCheckboxes(true);
    } catch (err) {
      alert('Failed to start: ' + err.message);
      startBtn.disabled = false;
      startBtn.textContent = 'START';
    }
  });

  pauseBtn.addEventListener('click', async () => {
    const isPaused = pauseBtn.textContent === 'RESUME';
    const endpoint = isPaused ? '/api/resume' : '/api/pause';
    await fetch(endpoint, { method: 'POST' });
    pauseBtn.textContent = isPaused ? 'PAUSE' : 'RESUME';
    setStatus(isPaused ? 'Translating' : 'Paused', isPaused);
  });

  stopBtn.addEventListener('click', async () => {
    await fetch('/api/stop', { method: 'POST' });
    setStatus('Ready', false);
    activeControls.classList.add('hidden');
    startBtn.classList.remove('hidden');
    startBtn.disabled = false;
    startBtn.textContent = 'START';
    stopAudioLevel();
    stopPolling();
    statAttendees.textContent = '0';
    statTimer.textContent = '00:00:00';
    statCost.textContent = '$0.00';
    disableLanguageCheckboxes(false);
  });

  printQrBtn.addEventListener('click', () => {
    const url = qrUrl.textContent;
    const win = window.open('', '_blank');
    win.document.write(`
      <html>
        <head><title>QR Code — Live Translate</title>
        <style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;}</style>
        </head>
        <body>
          <img src="${qrImage.src}" style="width:400px;height:400px;">
          <p style="margin-top:24px;font-size:24px;">${url}</p>
          <p style="margin-top:8px;color:#999;">Live Translate — Live Translation</p>
        </body>
      </html>
    `);
    win.document.close();
    win.print();
  });

  function disableLanguageCheckboxes(disabled) {
    const checkboxes = languageCheckboxes.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((cb) => { cb.disabled = disabled; });
  }

  init();
})();
```

- [ ] **Step 4: Commit**

```bash
git add public/admin.html public/admin.css public/admin.js
git commit -m "feat: admin control panel with dark theme"
```

---

### Task 10: Integration Test & Smoke Test

**Files:**
- Modify: `package.json`

Verify the whole system works end-to-end locally. Use a test API key and verify audio capture, translation, and broadcast.

- [ ] **Step 1: Add `.env` with your Gemini API key**

```bash
echo "GEMINI_API_KEY=your-actual-key" > .env
echo "PORT=3000" >> .env
```

- [ ] **Step 2: Add npm scripts for convenience**

Add to `package.json` scripts:

```json
{
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js"
  }
}
```

- [ ] **Step 3: Run the server**

```bash
npm run dev
```

Expected output:
```
  Live Translate
  Admin:  http://localhost:3000/admin
  Attend: http://192.168.x.x:3000
  Press Ctrl+C to stop
```

- [ ] **Step 4: Test attendee page**

Open `http://localhost:3000` in a browser. Verify:
- Language buttons render (Mandarin, Korean, Portuguese, Spanish)
- Clicking a language switches to player view
- Volume slider is visible
- "Change Language" button returns to language selection

- [ ] **Step 5: Test admin panel**

Open `http://localhost:3000/admin` in a browser. Verify:
- Dark theme renders correctly
- Language checkboxes are all checked
- Audio level meter area is visible
- Start/Pause/Stop buttons are present
- QR code is generated and displayed

- [ ] **Step 6: Test full pipeline (requires audio input)**

If a microphone or audio input is available:
1. Click START in admin panel
2. Status changes to "Translating"
3. Audio level meter shows activity
4. In attendee page, select a language
5. Speak into the microphone
6. Verify translated audio plays in the attendee page

- [ ] **Step 7: Verify `.env` is in `.gitignore`**

```bash
git status
```

`.env` should NOT appear in the output.

- [ ] **Step 8: Commit package.json update**

```bash
git add package.json
git commit -m "chore: add dev script with watch mode"
```

- [ ] **Step 9: Push all commits**

```bash
git push origin main
```

---

### Task 11: Update README with Run Instructions

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README with verified setup instructions**

Ensure the README reflects the actual working setup. Update if any steps differ from what was initially written. Add a "Quick Start" section that matches the verified flow.

- [ ] **Step 2: Commit and push**

```bash
git add README.md
git commit -m "docs: update README with verified setup instructions"
git push origin main
```
