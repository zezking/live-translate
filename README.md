# Centre Church Live Translation

AI-powered real-time sermon translation for Centre Church. Replaces the human interpreter + ListenWiFi setup with an automated system that streams translated audio to attendees' phones via a web browser — no app install required.

## Hardware Setup

```
Booth Console (Model 204) → 1/4" TRS → RCA cable → UCA222 USB → MacBook Pro
```

| Component | Purpose |
|-----------|---------|
| Studio Technologies Model 204 | Announcer's console in the translation booth |
| 1/4" TRS to dual RCA cable (male to male) | Carries audio from Model 204 headphone out to UCA222 |
| Behringer UCA222 | USB audio interface — RCA inputs → USB output |
| MacBook Pro | Runs the translation server and streams to attendees |

The Mac captures audio via the UCA222's USB connection. On macOS the device appears as `USB Audio CODEC` (set as the system default input). For forced device selection, set `AUDIO_DEVICE` in `.env`.

## Supported Languages

| Code | Label |
|------|-------|
| `zh-Hans` | 中文 (Mandarin) |
| `ko` | 한국어 (Korean) |
| `pt-BR` | Português (Portuguese) |
| `es` | Español (Spanish) |
| `fa` | فارسی (Farsi) |

Select any combination in the admin panel before starting.

## Translation Providers

The app supports two translation backends, selectable in the admin panel:

| Provider | API Key | Model |
|----------|---------|-------|
| **Gemini** | `GEMINI_API_KEY` | `gemini-3.5-live-translate-preview` |
| **Qwen** | `DASHSCOPE_API_KEY` | `qwen3.5-livetranslate-flash-realtime` |

**Gemini** is recommended for accuracy. **Qwen** supports voice cloning and custom voice selection (configured in the admin panel when Qwen is selected).

Each language opens a separate session. Gemini sessions expire after ~15-30 minutes and are auto-reconnected.

## Setup

### Prerequisites

- Node.js 22+
- sox (`brew install sox`)
- Google AI API key ([Get one](https://aistudio.google.com/apikey))
- Alibaba DashScope API key (optional, for Qwen provider)
- macOS (for CoreAudio capture)

### Install

```bash
npm install
```

### Configure

```bash
cp .env.example .env
```

Edit `.env` with your API keys:

```
GEMINI_API_KEY=your-gemini-key
DASHSCOPE_API_KEY=your-dashscope-key   # optional
PORT=3000
ADMIN_PASSWORD=centrechurch
# AUDIO_DEVICE=USB Audio CODEC        # optional — force a specific input device
```

### Run

```bash
npm start        # production
npm run dev      # development (auto-restart)
```

The server prints three URLs on startup:
- **Admin panel**: `http://localhost:3000/admin` — operator controls
- **Attendee page**: `http://<LAN-IP>:3000` — attendees scan QR and listen
- **Interpreter page**: `http://<LAN-IP>:3000/interpreter` — side-by-side translation text view

### Audio Monitoring

To listen to the USB input through your Mac's speakers (for troubleshooting):

```bash
sox --default-device --rate 16000 --channels 1 -t coreaudio "MacBook Pro Speakers"
```

## Usage (Sunday Service)

1. Connect 1/4" TRS cable from Model 204 headphone out → dual RCA → UCA222 → USB → Mac
2. Run `npm start`
3. Open admin panel, log in with the configured password
4. Select provider (Gemini or Qwen) and target languages
5. Click **START** when the sermon begins
6. Display the QR code on a screen or print handouts — attendees scan and pick their language
7. Click **PAUSE** during worship/music, **RESUME** for the sermon
8. Click **STOP** when the service ends

The admin session persists across page reloads — if you refresh, the running session is restored automatically.

## Project Structure

```
src/
├── server.js                     # Express server, API routes
├── audio-capture.js              # macOS CoreAudio → 100ms PCM chunks
├── gemini-translation-session.js # Gemini Live Translate session
├── qwen-translation-session.js   # Qwen Live Translate session (WebSocket)
├── session-manager.js            # Coordinates parallel translation streams
├── audio-broadcaster.js          # WebSocket → attendee audio routing
├── qr-generator.js               # Auto-generates QR code from LAN IP
└── hotwords.json                 # Translation corpus (religious terminology)
public/
├── attendee.html/css/js          # Attendee page (language selection, audio)
├── admin.html/css/js             # Admin panel (dark theme, operator controls)
└── interpreter.html              # Side-by-side translated text view
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/start` | Admin | Start translation (`{ languages, provider, voiceConfig }`) |
| POST | `/api/pause` | Admin | Pause translation |
| POST | `/api/resume` | Admin | Resume translation |
| POST | `/api/stop` | Admin | Stop translation |
| GET | `/api/status` | — | Current state, stats, attendee count |
| GET | `/api/providers` | — | Available translation providers |
| GET | `/api/languages` | — | Available languages |
| GET | `/api/voices` | — | Qwen voice list |
| GET | `/api/qrcode` | Admin | QR code for attendee URL |
| GET | `/api/audio-level` | Admin | SSE stream — real-time dB meter |
| GET | `/api/key-status` | Admin | API key tier detection |
| WS | `/ws` | — | Audio broadcast to attendee browsers |

## Hotwords

`src/hotwords.json` contains religious terminology translations keyed by target language. When using Qwen, these are sent as a translation corpus to improve accuracy of church-specific terms. Edit this file to add or refine translations.

## Before Production

- [ ] Hardcoded admin password in `.env` — consider a stronger password or env-only config
- [ ] No HTTPS — attendees on public WiFi may see browser warnings for plain `http://`
- [ ] No authentication on attendee/interpreter pages — fine for church, but worth noting
- [ ] Gemini sessions expire after 15-30 min — auto-reconnect works but causes a brief gap
- [ ] Qwen `connections too much` error on free tier — may need rate-limit handling
- [ ] No graceful degradation if one language fails — others continue, but admin sees errors
- [ ] Audio capture uses sox — no fallback on macOS if sox is missing or fails
- [ ] No persistent logs or metrics — useful for debugging service-day issues
- [ ] **Church public WiFi has client isolation** — mobile devices cannot reach the server IP despite sufficient internet speed. Requires a separate local network for attendee devices
- [ ] **Church secured WiFi too slow** — significant translation latency on "Centre Church Translation" secured network. Public WiFi is faster but not reachable from attendee devices

## Network

The church has two WiFi networks:

- **Centre Church Public** — open, fast enough for translation, but has client isolation (devices cannot reach each other)
- **Centre Church Translation** — secured, but internet speed is too slow for real-time translation

Neither network currently satisfies both requirements (internet speed for API calls + local connectivity for attendee devices). This is documented in Before Production above.

## Cost

~$8.80 per 60-min service (4 languages, Gemini paid tier). Free tier available for testing.

| Component | Rate |
|-----------|------|
| Audio input | $0.0053/min |
| Audio output | $0.0315/min |

## Tech Stack

- **Runtime:** Node.js 22+ (ESM)
- **Server:** Express 5
- **Translation:** Gemini 3.5 Live Translate, Qwen 3.5 LiveTranslate Flash
- **SDKs:** `@google/genai`, `ws`
- **Audio capture:** sox via `node-record-lpcm16` (CoreAudio on macOS)
- **Audio broadcast:** WebSocket (`ws`)
- **QR code:** `qrcode`

## License

Private repository.
