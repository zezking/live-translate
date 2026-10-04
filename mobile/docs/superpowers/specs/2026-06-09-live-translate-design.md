# Church AI Live Translation Service — Design Spec

**Date:** 2026-06-09
**Status:** Approved

## Problem

Live Translate currently uses a human interpreter + ListenWiFi setup for live speech translation. Attendees connect to a dedicated WiFi network and listen to a human interpreter who translates the speech in real-time. This is labor-intensive, limited to one language at a time, and depends on interpreter availability.

## Solution

Replace the human interpreter with AI-powered real-time translation using Google Gemini 3.5 Live Translate. A Node.js app runs on a MacBook Pro at the sound booth, captures the English audio feed from the soundboard, sends it to the Gemini API, and streams translated audio to attendees' phone browsers.

## Architecture

```
Soundboard 3.5mm out ──► MacBook Pro (Node.js app)
                              │
                              ├─ Audio capture layer
                              ├─ Gemini 3.5 Live Translate API (4 parallel streams)
                              ├─ WebSocket broadcast to attendees
                              └─ Control panel (operator UI)
                              │
                     Church WiFi or Dedicated WiFi
                              │
                 ┌────────────┼────────────┐
                 ▼            ▼            ▼
           Attendee      Attendee     Attendee
           (Mandarin)    (Korean)     (Spanish)
           Phone browser Phone browser Phone browser
```

## Languages

Source: **English**

Target languages:
1. Chinese (Mandarin)
2. Korean
3. Portuguese
4. Spanish

## Hardware

| Item | Cost | Notes |
|------|------|-------|
| MacBook Pro (existing) | $0 | Operator laptop at sound booth |
| 3.5mm audio cable | ~$5 | Soundboard booth output → MacBook audio input |
| Optional dedicated WiFi router | ~$25 | TP-Link or similar, if church WiFi is unreliable |
| **Total** | **$5-$30** | |

Audio connection: 3.5mm cable from interpreter booth's audio jack directly into MacBook Pro (Nov 2023, 14-inch). The MacBook's combined audio port supports input — no USB interface needed.

## Software Components

### Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js |
| Gemini SDK | `@google/genai` npm package |
| Audio capture | macOS audio input (16-bit PCM, 16kHz, mono, little-endian) |
| Translation | Gemini 3.5 Live Translate (`gemini-3.5-live-translate-preview`) |
| Audio output from API | 16-bit PCM, 24kHz, mono, little-endian |
| Audio broadcast | WebSocket + MediaSource API |
| Frontend | HTML/CSS/JS (no framework) |
| QR code generation | `qrcode` npm package |

### Gemini Live Translate API Details

**Model:** `gemini-3.5-live-translate-preview`

**SDK usage:**
```javascript
import { GoogleGenAI, Modality } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const session = await ai.live.connect({
  model: 'gemini-3.5-live-translate-preview',
  config: {
    responseModalities: [Modality.AUDIO],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    translationConfig: {
      targetLanguageCode: 'zh-Hans', // BCP-47 code
      echoTargetLanguage: false,     // stay silent when input is already target language
    },
  },
  callbacks: {
    onmessage: (message) => {
      // message.serverContent.modelTurn.parts[].inlineData.data = base64 PCM audio
      // message.serverContent.inputTranscription.text = source transcript
      // message.serverContent.outputTranscription.text = translated transcript
    },
    onerror: (e) => { /* handle error */ },
    onclose: (e) => { /* handle close */ },
  },
});

// Send audio chunks (100ms of 16kHz PCM = 1600 bytes per chunk)
session.sendRealtimeInput({
  audio: {
    data: pcmBuffer.toString('base64'),
    mimeType: 'audio/pcm;rate=16000',
  },
});
```

**Audio format requirements:**
- Input: Raw 16-bit PCM at 16kHz (mono, little-endian)
- Output: Raw 16-bit PCM at 24kHz (mono, little-endian)
- Chunk size: 100ms (1600 bytes per chunk at 16kHz)

**Target language BCP-47 codes:**
| Language | Code |
|----------|------|
| Chinese (Mandarin, Simplified) | `zh-Hans` |
| Korean | `ko` |
| Portuguese (Brazil) | `pt-BR` |
| Spanish | `es` |

**Built-in features:**
- Background noise/music filtering — model filters noise and music to produce clean speech
- Input/output transcripts available via `inputAudioTranscription` and `outputAudioTranscription`
- `echoTargetLanguage` — when false (recommended), model stays silent if input is already in target language

**Ephemeral tokens (v1alpha):**
For future enhancement — can generate ephemeral tokens so attendee browsers connect directly to Gemini API without exposing the API key. Currently out of scope; server proxies all audio.

### 1. Control Panel (Operator — localhost:3000/admin)

Served on the MacBook. The operator (a volunteer) uses this during the service.

Features:
- **Start** — begins audio capture and starts streaming to Gemini API
- **Pause** — mutes translation during music (safety net; model also filters background music automatically)
- **Resume** — resumes translation
- **Stop** — ends the session
- Language selector — checkboxes for which languages to translate
- Audio level meter — visual indicator that the audio feed is working
- Status indicators — connected, translating, error states
- QR code display — auto-generated based on current IP, printable or displayable on screen
- Session timer — elapsed time
- Cost estimate — running estimate of API usage

### 2. Attendee Web Page (phone browser)

Simple, mobile-friendly page. No app install required.

Features:
- Landing page with language buttons: Mandarin | Korean | Portuguese | Spanish
- Tap language → audio plays through earbuds immediately
- Play/Pause button
- Volume control
- Auto-reconnect if connection drops
- Clean, minimal UI — accessible to non-tech-savvy users

### Data Flow

1. Soundboard outputs English audio via 3.5mm → MacBook audio input
2. Node.js app captures audio stream
3. For each enabled language, app opens a streaming session with Gemini 3.5 Live Translate API
4. Gemini returns translated audio in real-time
5. Translated audio streams via WebSocket to connected attendees
6. Attendee's browser plays audio through MediaSource API

## API Cost (Gemini 3.5 Live Translate)

**Model:** `gemini-3.5-live-translate-preview`

| | Rate | Per service (60 min, 4 languages) |
|--|------|-----------------------------------|
| Input (audio) | $0.0053/min | 240 min × $0.0053 = $1.27 |
| Output (audio) | $0.0315/min | 240 min × $0.0315 = $7.56 |
| **Total** | | **~$8.80 per service** |

Free tier available — start on free tier for initial testing.

Weekly (1 service): ~$8.80
Yearly (52 services): ~$458

## Operator Flow (Sunday Morning)

1. Arrive at sound booth
2. Plug 3.5mm cable from booth output into MacBook
3. Open browser → `localhost:3000/admin`
4. Confirm audio level meter shows input
5. Select languages for today's service
6. Display QR code on screen or print signs for attendees
7. Hit **Start** when speech begins
8. Hit **Pause** during songs
9. Hit **Resume** when speaking resumes
10. Hit **Stop** at end of service

## Attendee Flow

1. Connect phone to church WiFi (or dedicated WiFi)
2. Scan QR code or open displayed URL
3. See language selection page
4. Tap their language
5. Audio plays through earbuds — done

## Error Handling

| Scenario | Response |
|----------|----------|
| Audio feed cuts out | Operator sees "No audio" warning, checks cable |
| Gemini API disconnects | Auto-reconnect with exponential backoff, operator sees status |
| Attendee loses connection | Auto-reconnect, audio resumes from current point |
| Wrong audio level | Operator sees level meter, adjusts at soundboard |
| API rate limit/quota hit | Graceful degradation, operator notified with error message |
| MacBook sleeps | Prevent sleep while app is running |

## QR Code

- Auto-generated at app startup based on MacBook's current LAN IP
- URL format: `http://<ip>:3000`
- QR code displayed on control panel for printing or screen display
- `qrcode` npm package generates both on-screen and downloadable PNG

## WiFi Options

Two modes supported — same codebase:

1. **Church WiFi mode** — attendees connect to existing church WiFi, access the MacBook's IP
2. **Dedicated WiFi mode** — a cheap router creates a separate network, no internet dependency for local access (still needs internet for Gemini API)

## UI Design

### Design Principles

Inspired by [Live Translate's website](https://changeme.ca/) — clean, modern, minimal. Classic black and white with strong typography. No unnecessary decoration.

**Design language:**
- **Colors:** Black (#000), White (#FFF), subtle grays (#F5F5F5, #E0E0E0, #999)
- **Typography:** System font stack (San Francisco on macOS/iOS, Segoe UI on Windows, sans-serif fallback)
- **Style:** Generous whitespace, large tap targets, bold headings, thin borders
- **Accents:** No color accents — purely monochrome
- **Animations:** Subtle fade transitions only, nothing flashy

### Attendee Page (`http://<ip>:3000`)

```
┌─────────────────────────────────┐
│                                 │
│        LIVE TRANSLATE            │
│      Live Translation           │
│                                 │
│  ─────────────────────────────  │
│                                 │
│  Select your language:          │
│                                 │
│  ┌─────────────────────────┐    │
│  │      中文 (Mandarin)     │    │
│  └─────────────────────────┘    │
│                                 │
│  ┌─────────────────────────┐    │
│  │      한국어 (Korean)     │    │
│  └─────────────────────────┘    │
│                                 │
│  ┌─────────────────────────┐    │
│  │   Português (Portuguese) │    │
│  └─────────────────────────┘    │
│                                 │
│  ┌─────────────────────────┐    │
│  │     Español (Spanish)    │    │
│  └─────────────────────────┘    │
│                                 │
│  ─────────────────────────────  │
│       Live Translate 2025        │
│                                 │
└─────────────────────────────────┘
```

**After selecting a language — player view:**

```
┌─────────────────────────────────┐
│                                 │
│        中文 (Mandarin)          │
│                                 │
│         ● LIVE                  │
│                                 │
│      ━━━━━━━━━━━━━━━━━         │
│      Listening... 00:32:15      │
│                                 │
│      [ ▮▮ Pause ]               │
│                                 │
│     🔊 ━━━━━━━━━━━━            │
│         Volume                  │
│                                 │
│  [ ← Change Language ]          │
│                                 │
│  ─────────────────────────────  │
│       Live Translate 2025        │
│                                 │
└─────────────────────────────────┘
```

**Attendee page details:**
- White background, black text
- Language buttons: full-width, black border, large tap target (min 56px height)
- Active language: black background, white text (inverted)
- "LIVE" indicator: small pulsing dot + text
- Timer showing elapsed time
- Play/Pause button: simple outlined circle with icon
- Volume slider: thin black track
- "Change Language" link: small text at bottom
- Footer: subtle gray text "Live Translate 2025"
- Auto-reconnect indicator shown briefly if connection drops: "Reconnecting..." in gray

### Operator Control Panel (`localhost:3000/admin`)

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  LIVE TRANSLATE — Live Translation Control    [⚙ Setup]   │
│  ═══════════════════════════════════════════════════════  │
│                                                          │
│  Status: ● Ready                                         │
│                                                          │
│  Languages:                                              │
│  [✓] 中文 (Mandarin)    [✓] 한국어 (Korean)              │
│  [✓] Português          [✓] Español                     │
│                                                          │
│  Audio Input:                                            │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━  ████░░░░  (-24 dB)          │
│                                                          │
│  ═══════════════════════════════════════════════════════  │
│                                                          │
│       [ ▶ START ]                                        │
│                                                          │
│  ═══════════════════════════════════════════════════════  │
│                                                          │
│  Attendees: 0                                            │
│  Session: 00:00:00                                       │
│  Est. cost: $0.00                                        │
│                                                          │
│  ┌─────────────────────────────┐                          │
│  │                             │   QR Code                │
│  │      ██  ██  ██  ██        │   http://192.168.1.50     │
│  │      ██  ██  ██  ██        │   [Print] [Display]       │
│  │      ██  ██  ██  ██        │                           │
│  └─────────────────────────────┘                          │
│                                                          │
│  ─────────────────────────────────────────────────────── │
│       Live Translate 2025                                 │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Operator panel (during active session):**

```
│  Status: ● Translating                                   │
│                                                          │
│  ═══════════════════════════════════════════════════════  │
│                                                          │
│  [ ⏸ PAUSE ]           [ ⏹ STOP ]                       │
│                                                          │
│  ═══════════════════════════════════════════════════════  │
│                                                          │
│  Attendees: 23                                           │
│  Session: 00:45:12                                       │
│  Est. cost: $6.62                                        │
```

**Operator panel details:**
- Dark theme (black background, white text) — for low-light sound booth environment
- Thin white borders separating sections
- Start button: white background, black text, large
- Pause button: white outlined, black text
- Stop button: white outlined, smaller
- Audio level meter: horizontal bar, real-time, white fill on dark background
- Status indicator: white pulsing dot when active
- QR code: displayed inline, with Print and Display buttons
- Stats section: attendee count, session timer, running cost estimate
- All controls large and easy to click (not touch-optimized — this is used with a trackpad/mouse)

### Responsive Behavior

- **Attendee page** is mobile-first, designed for phone browsers (375px-428px width)
- **Operator panel** is designed for laptop screen (MacBook 14", ~1512px wide)
- No need for tablet or desktop attendee layouts — phones are the primary device

## Success Criteria

- Translation latency under 5 seconds from speech to translated audio output
- Clear, intelligible translated audio in all 4 languages
- 20-50 concurrent attendees can listen simultaneously without buffering
- One volunteer can operate the system with minimal training
- Total hardware cost under $30 (excluding existing MacBook)
- API cost under $10 per service

## Out of Scope (Future Considerations)

- Text/caption display mode
- Bidirectional translation
- Remote/online attendee streaming
- Recording/archiving translated audio
- Music auto-detection
- Native mobile app
