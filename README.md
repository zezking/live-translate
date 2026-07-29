# Live Translate

AI-powered real-time translation for live events, services, and meetings. Streams translated audio to attendees' phones via a web browser — no app install required.

## Hardware Setup

```
Audio Source → 1/4" TRS → RCA cable → UCA222 USB → Laptop
```

| Component | Purpose |
|-----------|---------|
| Audio console / mixer | Source audio feed (booth output, line level) |
| 1/4" TRS to dual RCA cable (male to male) | Carries audio from console headphone out to UCA222 |
| Behringer UCA222 | USB audio interface — RCA inputs → USB output |
| Laptop (macOS) | Runs the translation server and streams to attendees |

The Mac captures audio via the UCA222's USB connection. On macOS the device appears as `USB Audio CODEC` (set as the system default input). For forced device selection, set `AUDIO_DEVICE` in `.env`.

## Audio Input Sources

The admin panel can capture audio from three sources (selectable on the admin page):

| Source | What it captures | Platform |
|--------|------------------|----------|
| **USB** (default) | The UCA222 / USB interface via `sox` + CoreAudio — the production setup | macOS only |
| **Browser** | Audio playing in a browser tab (e.g. a YouTube video). The admin clicks START, then picks a Chrome Tab in the picker and ticks "Share tab audio" | Any OS, Chrome/Edge |
| **System** | Full system audio loopback — any app's output. The admin clicks START, then picks Entire Screen and ticks "Share system audio" | Chrome/Edge on macOS |

USB is the production source. Browser and System are intended for quick testing with pre-recorded content and for demos without the hardware setup.

**Browser support for Browser/System modes:**
- Chrome / Edge: fully supported
- Firefox: tab audio works; system audio not supported
- Safari: not supported in v1

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
- macOS (required for USB source; Browser/System sources work on any OS)

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
ADMIN_PASSWORD=your-password
# AUDIO_DEVICE=USB Audio CODEC        # optional — force a specific input device
```

### Run

```bash
npm start        # production
npm run dev      # development (auto-restart)
npm test         # run unit tests
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

## Usage (Live Event)

1. Connect audio cable from console headphone out → dual RCA → UCA222 → USB → Mac
2. Run `npm start`
3. Open admin panel, log in with the configured password
4. Select provider (Gemini or Qwen) and target languages
5. Pick the audio input source (USB / Browser / System) — defaults to USB for live events
6. Click **START** when the event begins
7. Display the QR code on a screen or print handouts — attendees scan and pick their language
8. Click **PAUSE** during breaks/music, **RESUME** to continue
9. Click **STOP** when the event ends

The admin session persists across page reloads — if you refresh, the running session is restored automatically.

## Project Structure

```
src/
├── server.js                     # Express server, API routes
├── usb-audio-source.js           # USB/CoreAudio → 100ms PCM chunks
├── browser-audio-source.js       # WebSocket receiver for browser-captured audio
├── gemini-translation-session.js # Gemini Live Translate session
├── qwen-translation-session.js   # Qwen Live Translate session (WebSocket)
├── session-manager.js            # Coordinates parallel translation streams
├── audio-broadcaster.js          # WebSocket → attendee audio routing
├── qr-generator.js               # Auto-generates QR code from LAN IP
└── hotwords.json                 # Translation corpus (religious terminology)
public/
├── attendee.html/css/js          # Attendee page (language selection, audio)
├── admin.html/css/js             # Admin panel (dark theme, operator controls)
├── pcm-worklet.js                # AudioWorklet processor (Float32 → Int16 PCM)
└── interpreter.html              # Side-by-side translated text view
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/start` | Admin | Start translation (`{ languages, provider, voiceConfig, inputSource }`) |
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
| WS | `/ws/admin-input` | Admin | Browser-captured audio upload (Browser/System source) |

## Hotwords

`src/hotwords.json` contains religious terminology translations keyed by target language. When using Qwen, these are sent as a translation corpus to improve accuracy of specific terms. Edit this file to add or refine translations.

## Before Production

- [ ] Hardcoded admin password in `.env` — consider a stronger password or env-only config
- [ ] No HTTPS — attendees on public WiFi may see browser warnings for plain `http://`
- [ ] No authentication on attendee/interpreter pages — fine for internal use, but worth noting
- [ ] Gemini sessions expire after 15-30 min — auto-reconnect works but causes a brief gap
- [ ] Qwen `connections too much` error on free tier — may need rate-limit handling
- [ ] No graceful degradation if one language fails — others continue, but admin sees errors
- [ ] Audio capture uses sox — no fallback on macOS if sox is missing or fails
- [ ] No persistent logs or metrics — useful for debugging day-of issues
- [ ] **Venue WiFi may have client isolation** — mobile devices may not reach the server IP even with internet access. Requires a dedicated local network for attendee devices

## Cost

~$8.80 per 60-min event (4 languages, Gemini paid tier). Free tier available for testing.

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
