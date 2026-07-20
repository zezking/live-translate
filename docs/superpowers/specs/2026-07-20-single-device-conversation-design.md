# Single-Device Conversation Mode — Design Spec

**Date:** 2026-07-20
**Status:** Approved (brainstorm complete)
**Supersedes:** the two-device (room/QR) conversation flow from Plan 3/5

## Goal

Redesign the v2 conversation mode from **two devices** (host + joiner via QR) to **one shared device** placed between two speakers. The device shows the translated content for both speakers on a single screen. English becomes the default language; the user picks the two languages to translate between.

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Speaker routing (Qwen has no diarization / bidirectional / auto-detect) | **Push-to-talk** — two giant press areas; mic routes to that direction's session while held |
| Replace or coexist with two-device mode | **Replace** — rooms, QR, host/joiner tokens deleted |
| Language defaults | **English ↔ Korean default**; picker offers en / ko / zh / ja / es (native names) |
| Layout | **Single river** (original + translation per turn) on top; **two giant stacked press areas** filling the bottom half |
| Carry-overs | Voice-over toggle, voice cloning (sub-toggle), admin password gate |
| Turn labeling | By language (no name entry) |
| Architecture | **A**: one WS, JSON direction control frames, server holds both Qwen sessions |

## Architecture

One client = one session. The server holds two warm `QwenTranslationSession`s (one per direction) for the chosen pair and routes incoming PCM to the session matching the active push-to-talk direction. The `ActiveSpeakerRouter` (VAD-based dominant-speaker gating) is deleted — explicit PTT replaces it.

```
┌─────────────── browser (/conversation) ───────────────┐
│  admin gate → pair picker → live screen               │
│  PTT press → {direction} frame + binary PCM stream    │
│  useConversation hook: SocketClient + MicCapture +    │
│  Playback engines in refs, pure reducer for state     │
└──────────────┬────────────────────────────────────────┘
               │ WS /ws/conversation (JSON control + binary PCM)
┌──────────────▼────────────────────────────────────────┐
│  DuoSession (server)                                  │
│   ├─ QwenTranslationSession  langA → langB            │
│   └─ QwenTranslationSession  langB → langA            │
│  setDirection(from) routes PCM; per-direction events  │
│  → delta/turnEnd/audio down to the single client      │
└───────────────────────────────────────────────────────┘
```

## Protocol

**WS `/ws/conversation`** (same path, new shape):

Client → server:
- `{type:'start', languages:['en','ko'], voiceOver, voiceClone}` — must be the first frame (timeout, else close 1008)
- `{type:'direction', from:'en'|'ko'}` — PTT press (`from` = language being spoken)
- `{type:'direction', from:null}` — PTT release
- **binary** — 16 kHz 16-bit mono PCM, only while a direction is held (dropped otherwise)

Server → client (same message family as today, `speaker` field dropped):
- `status { state:'ready'|'ended' }`
- `config { voiceOver, voiceClone }` (echo/authoritative)
- `delta { field:'original'|'translation', lang, text }` — `lang` = the language *of the text*; `original` goes to the held direction's source language, `translation` to its target
- `turnEnd { lang }` — `lang` = the **source** language of the finalized turn (i.e. the language that was being spoken). Fired on direction release/switch and on config reset; client finalizes that turn
- `audio { data }` — base64 24 kHz PCM, only when voiceOver
- `error { message }`
- Close **1008** = terminal (bad/absent start frame, session ended) — no reconnect

**REST:**
- `POST /api/conversation/session` `[Bearer admin]` — validates the admin password for page entry → `{ ok: true }`
- `POST /api/conversation/config` `[Bearer admin]` `{ voiceOver?, voiceClone? }` — targets the single session, as approved; the ⋯ sheet calls this (same as today)
- Deleted: `POST /api/conversation/create` and `POST /api/conversation/end` (no rooms to create/end — ending is `stop()` on the WS session)

## Server design

**`server/src/duo-session.ts`** (new, ~150 lines, TDD with stub sessions):
- `constructor({ apiKey, languages:[A,B], config, sessionFactory? })` — two directional sessions via injectable factory (default `QwenTranslationSession`, reused untouched incl. the `response.text.text` fix)
- `start()` — connects both in parallel
- `setDirection(from|null)` — sets active direction; on change emits `turnEnd` for the previous direction's source language; PCM with no direction set is dropped
- `handleAudio(pcm)` — forwards to the active direction's session
- Per direction (source S, target T): `inputTranscription` → `delta{field:'original', lang:S}`; `outputTranscription` → `delta{field:'translation', lang:T}`; `audio` → relayed only when voiceOver
- `setConfig({voiceOver, voiceClone})` — broadcast config; on change, `turnEnd` both + reconnect both sessions (Qwen rejects mid-stream update)
- `stop()` — `status ended`, disconnect both, close client socket
- Per-direction reconnect with exponential backoff, skip on 1008/unauthorized (ported from `ConversationSession`)

**Deleted:** `conversation-session.ts`, `conversation-manager.ts`, `conversation-transport.ts`, `active-speaker-router.ts` (+ their tests), REST `create`/`end`, QR generation, room/host/joiner tokens. `server/src/index.ts` gets the new WS handler (first-frame-`start` enforcement).

## Client design

**Page flow** (`/conversation`): admin password → **language pair picker** (two dropdowns, English ↔ Korean preselected; options en/ko/zh/ja/es shown by native name — English, 한국어, 中文, 日本語, Español; the two picks must differ) → live screen. The pair is fixed for the session's lifetime; to translate a different pair, end the session and start a new one.

**Live screen** (mockup option B — giant press areas):
- **Top: river** (~top half). Each turn: language-colored label (`ENGLISH` terracotta `#c0623a` / `한국어` warm green `#3a7a5a` — color keyed by language, first two of the pair get the two existing colors; zh/ja/es reuse the same two-color scheme by position), the original as the main line, the translation as a grey subtitle beneath — **both visible**, both parties read the same screen. Active turn emphasized.
- **Bottom: two giant stacked press areas** filling the remaining half. Top area labeled in language A (`🎤 Hold to speak English`), bottom in language B (`🎤 한국어로 말하려면 누르세요`). Press-and-hold: `pointerdown` → `direction` frame + mic streaming; `pointerup`/`pointercancel`/`lostpointercapture` → release frame. While held the area floods with its language color, the other dims/disables, and the status line reads `● Listening… (English)`. Release finalizes the turn.
- **⋯ sheet** (existing `ControlsSheet`, minus role logic): voice-over, voice-clone sub-toggle, mic picker, pause/resume, end conversation.
- **States** (existing warm overlays, minus partner-away): connecting, ready, reconnecting ("Catching up…"), paused, ended. `ErrorLine` surfaces mic-blocked/unauthorized/Qwen errors.

**Hook** (`use-conversation.ts`, rewritten): one `SocketClient`, one `MicCaptureEngine`, one `PlaybackEngine` in refs; reducer drives UI. Reducer state: `{ phase:'setup'|'live'|'ended', languages:[A,B], activeDirection:null|A|B, turns, status, paused, config, error }`; `Turn` = `{ id, lang, original, translation, active }` (speaker → lang). New turn starts when a delta arrives for a language whose previous turn was finalized; consecutive same-language deltas append. i18n: page chrome English (joiner-Korean locale logic deleted); press-area labels are native language names regardless of locale.

**Deleted client code:** room/QR onboarding (`OnboardingView` host-waiting screen), role detection from `?token=`, the joiner-Korean locale switch, `StateOverlay` partner-away variant. **Kept:** `AuthContext` (admin gate), `ControlsSheet`/`BottomSheet`, `ErrorLine`, the warm overlay pattern.

## Error handling & edge cases

- Mic denied → `ErrorLine` ("Microphone blocked…"), retry on next press
- Wrong admin password → existing `unauthorized` ErrorLine path
- Qwen session drop → per-direction reconnect; "Catching up…" overlay
- Wrong-button speech (held English, spoke Korean) → garbled/empty transcript; accepted UX edge, no turn deletion
- PTT interrupted (pointercancel / tab backgrounded) → release fires; server finalizes the turn on silence + no direction
- Second finger taps the other area while held → ignored (single active direction)

## Testing

- `DuoSession`: TDD with stub sessions — direction routing, turn boundaries, voice-over gating, config reconnect, 1008 no-reconnect
- Reducer: TDD — turn grouping per language, release finalizes, pause/status/error paths
- Components: pair picker (differing-language validation), press areas (press/release/disabled-other), river lang labels, states
- Hook: typecheck-gated + manual browser verification
- E2E runbook: synthetic-speech pipeline (ko/zh WAV → two WS probe) verifying original + translation deltas per direction against the live API

## Non-goals

Turn deletion/editing, transcript persistence/history, multi-device rooms (deleted), rotated split table view, name entry, auto language detection.

## v1 safety

No changes to v1 (`src/`, `public/`, `test/`, root `package.json`). The v2 server's `/conversation` SPA route and `/assets` mount stay as-is.
