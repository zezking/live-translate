# Church Live Translation

AI-powered real-time sermon translation for Center Church using Google Gemini 3.5 Live Translate.

## Overview

Replaces the human interpreter + ListenWiFi setup with an automated system:

- Captures English audio feed from the soundboard
- Translates in real-time to Mandarin, Korean, Portuguese, and Spanish
- Streams translated audio to attendees' phone browsers
- No app install required — just scan a QR code and listen

## Setup

### Prerequisites

- Node.js 18+
- Google AI API key ([Get one here](https://aistudio.google.com/apikey))
- macOS (for audio input support)

### Install

```bash
npm install
```

### Configure

```bash
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY
```

### Run

```bash
npm start
```

Open `http://localhost:3000/admin` for the operator control panel.

## Tech Stack

- **Runtime:** Node.js
- **Translation:** Gemini 3.5 Live Translate (`gemini-3.5-live-translate-preview`)
- **SDK:** `@google/genai`
- **Audio broadcast:** WebSocket
- **Frontend:** HTML/CSS/JS

## Hardware

- MacBook Pro (audio input via 3.5mm)
- 3.5mm audio cable (~$5)
- Optional dedicated WiFi router (~$25)

## Cost

~$8.80 per service (60 min, 4 languages) at paid tier rates. Free tier available for testing.

## License

Private repository.
