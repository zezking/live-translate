# Centre Church Live Translation

AI-powered real-time sermon translation for Centre Church using Google Gemini 3.5 Live Translate.

## Overview

Replaces the human interpreter + ListenWiFi setup with an automated system:

- Captures English audio feed from the soundboard via 3.5mm cable
- Translates in real-time to **Mandarin**, **Korean**, **Portuguese**, and **Spanish**
- Streams translated audio to attendees' phone browsers via WebSocket
- No app install required — scan a QR code and listen

## How It Works

```
Soundboard → 3.5mm cable → MacBook (Node.js server)
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
              Gemini API   Gemini API   Gemini API
              (Mandarin)   (Korean)    (Portuguese, Spanish)
                    │           │           │
                    └───────────┼───────────┘
                                ▼
                        WebSocket broadcast
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
                 Phone       Phone       Phone
              (Mandarin)   (Korean)    (Portuguese/Spanish)
```

## Setup

### Prerequisites

- **Node.js 22+** (required for `--watch` flag in dev mode)
- **sox** — audio capture dependency (`brew install sox`)
- **Google AI API key** — [Get one here](https://aistudio.google.com/apikey)
- **macOS** (for audio input via 3.5mm port)

### Install

```bash
npm install
```

> If `npm install` fails with 403 errors (e.g. behind a GCP mirror), use:
> ```bash
> npm install --registry=https://registry.npmjs.org
> ```

### Configure

```bash
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY
```

### Run

```bash
npm start        # production
npm run dev      # development (auto-restart on file changes)
```

The server prints two URLs on startup:
- **Admin panel**: `http://localhost:3000/admin` — operator controls (start/pause/stop, QR code)
- **Attendee page**: `http://<LAN-IP>:3000` — what attendees open on their phones

### First-Time Smoke Test

1. Start the server with `npm run dev`
2. Open `http://localhost:3000/admin` in a browser — verify the dark theme loads
3. Open `http://localhost:3000` in another tab — verify language buttons appear
4. Click **START** in the admin panel — status should change to "Translating"
5. Click **PAUSE** → **RESUME** → **STOP** to verify the full cycle
6. Play audio into the MacBook's mic input to test translation (optional)

## Usage (Sunday Service)

1. Connect 3.5mm cable from soundboard interpreter output to MacBook audio input
2. Run `npm start`
3. Open admin panel at `http://localhost:3000/admin`
4. Display the QR code on a screen or print it on handouts
5. Select target languages (Mandarin, Korean, Portuguese, Spanish)
6. Click **START** when the sermon begins
7. Attendees scan QR code, pick their language, and listen
8. Click **PAUSE** during worship/music, **RESUME** for the sermon
9. Click **STOP** when the service ends

## Project Structure

```
src/
├── server.js              # Express server, API routes, static files
├── audio-capture.js       # macOS audio input → 100ms PCM chunks
├── translation-session.js # Single Gemini Live Translate session
├── session-manager.js     # Coordinates 4 parallel translation streams
├── audio-broadcaster.js   # WebSocket server, routes audio to attendees
└── qr-generator.js        # Auto-generates QR code from LAN IP
public/
├── attendee.html/css/js   # Attendee page (white theme, language selection)
└── admin.html/css/js      # Admin panel (dark theme, operator controls)
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/start` | Start translation (body: `{languages: ["zh-Hans"]}`) |
| POST | `/api/pause` | Pause translation |
| POST | `/api/resume` | Resume translation |
| POST | `/api/stop` | Stop translation |
| GET | `/api/status` | Current state, stats, attendee count |
| GET | `/api/languages` | Available languages |
| GET | `/api/qrcode` | QR code image for attendee URL |
| GET | `/api/audio-level` | SSE stream of audio input level |

## Tech Stack

- **Runtime:** Node.js (ESM)
- **Server:** Express 5
- **Translation:** Gemini 3.5 Live Translate (`gemini-3.5-live-translate-preview`)
- **SDK:** `@google/genai` v2.8+
- **Audio capture:** `node-record-lpcm16` (requires sox)
- **Audio broadcast:** WebSocket (`ws`)
- **QR code:** `qrcode` npm package
- **Frontend:** Vanilla HTML/CSS/JS, Web Audio API

## Hardware

- MacBook Pro (audio input via 3.5mm port)
- 3.5mm audio cable (~$5)
- Optional: dedicated WiFi router (~$25) for areas with weak church WiFi

## Cost

~$8.80 per service (60 min, 4 languages) at paid tier rates.

| Component | Rate |
|-----------|------|
| Audio input | $0.0053/min |
| Audio output | $0.0315/min |

Free tier available for initial testing.

## License

Private repository.
