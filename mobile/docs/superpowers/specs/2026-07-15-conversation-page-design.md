# v2 Conversation Page — Design Spec

**Date:** 2026-07-15
**Status:** Approved (visual mockups reviewed in brainstorming session)
**Builds on:** v2 foundation (Plan 1) + church-mode backend TS port (Plan 2)
**Mockups:** `.superpowers/brainstorm/51663-1784173998/content/` (`transcript-metaphor.html`, `live-view-chrome.html`, `onboarding-storyboard.html`, `controls-and-states.html`)

## Overview

The v2 conversation page lets two people hold a bilingual conversation through two phones — each captures its mic, streams it to the server, and shows a live translated transcript in its own language, with optional voice-over of the translation into the listener's earbuds.

**North star: warm, calm, human.** It should feel like a real conversation, not a tool — minimal chrome, generous breathing room, honest copy, the warm-&-human aesthetic carrying the emotional tone. (Chosen over "effortless clarity" / "frictionless" / "trustworthy" as the primary lens.)

Visual language is the **warm-&-human** system from Plan 1: stone neutrals, terracotta `#c0623a` accent, `0.75rem` radius, system + Korean-capable font stack, `:lang(ko) { line-height: 1.6 }`, shadcn/ui components.

Plan 3 implements this spec: the conversation **frontend** (React+TS, engine layer) **and** porting the conversation **backend** to TypeScript.

## Users & setup

- **Host** (e.g. you, Mandarin-speaking) opens `/conversation` on their phone.
- **Joiner** (e.g. your father-in-law, Korean-speaking) scans a QR / opens a link on their phone.
- Same room; each wears earbuds (a Bluetooth headset-with-mic is ideal: close mic + in-ear playback, no feedback). Same-room cross-talk is handled by the server-side **active-speaker router** (only the dominant mic feeds its session; the other pauses).

## Screens

### 1. Onboarding (host → joiner)

A three-screen, low-friction entry. No settings up front — voice-over/cloning live *in* the conversation now.

- **Host begins** (`/conversation`, no token): warm welcome — title *Conversation*, subtitle *"A few words, and we'll translate."* Two name fields (Your name / Partner's name) + a terracotta **Begin** button.
- **Host shows the code**: on Begin, the host enters a waiting screen — *"Show this to **{partner}**"* + a QR + a gentle pulsing *"Waiting for {partner}…"*. The mic permission prompt fires here.
- **Joiner joins** (`/conversation?token=…`, Korean UI): *"대화"* / *"{host} 님이 초대했어요"* + a **참여하기** button. Tapping fires the mic prompt, then straight into the live view.

Pairing mechanics (ported from v1 conversation-mode): host calls `/api/conversation/create` (admin-authed) → gets `hostToken` + `joinToken` + a QR encoding the join URL. Both connect over `/ws/conversation?token=…` (token-authed).

### 2. Live conversation (the centerpiece)

- **Flowing river transcript.** One continuous vertical stream — **no chat boxes**. Each turn is a colored speaker label (host = terracotta `#c0623a`; joiner = warm green `#3a7a5a`) followed by the text in the **local viewer's language**: your own turns show your original; your partner's turns show the translation, with the other language as a small grey subtitle below. Generous line-height (especially for Hangul). Auto-scrolls to the latest; older turns scroll up naturally.
- **Active-speaker emphasis.** The current speaker's latest turn renders slightly larger with a brighter, weighted label — so it's effortless to follow whose turn it is, **without re-introducing boxes** (no color flashes, no boxing).
- **Pure chrome.** The conversation fills the screen. Up top: a faint status line (*"● Listening…"* / *"듣는 중…"*) + a discreet voice-over icon and a **⋯** button. **No persistent control bar** — the screen is almost entirely the conversation.
- **Monolingual per device.** Host reads Mandarin throughout; joiner reads Korean. The server routes each Qwen session's input-transcription back to its own device (own turn) and its output-translation to the *other* device (their turn), per the v1 design.

### 3. Controls sheet (⋯)

A calm **bottom sheet** (river dimmed behind it):

- **Voice-over** toggle (default **off**).
- **Voice cloning** sub-toggle — only enabled when voice-over is on (default **off**).
- **Microphone** — device picker (phone mic / Bluetooth).
- **Pause**.
- **End conversation**.

Voice-over/clone are **host-global** (host sets them; they apply to both sessions). Toggling **reconnects** the sessions with the new config — Qwen rejects mid-stream `session.update`, so config changes go via reconnect (established in v1). The joiner doesn't see voice-over/clone (host-only).

### 4. States (warm, honest copy — never alarming)

- **Waiting for partner** (host): *"Waiting for {partner}…"* + QR (onboarding screen 2).
- **Partner away**: *"{partner} stepped away… we'll pick up when they're back."* Gentle; auto-resumes on reconnect.
- **Reconnecting** (rate-limit / session drop): *"Catching up… translation resumes in a moment."* The exponential backoff recovers automatically; no scary error.
- **Paused**: *"Paused. Tap to resume."*
- **Ended**: a quiet, warm close + a way back to start another conversation.

## Interaction details

- **Mic capture** at 16 kHz PCM (AudioWorklet) streams up over the WS; **translated audio** (24 kHz PCM) plays in the listener's earbuds when voice-over is on (gapless scheduling).
- **Turn boundaries**: the server emits `turnEnd` on active-speaker switch; the client finalizes the current river segment and starts the next.
- **Resilience**: the client WS auto-reconnects (using the room token) on transient drops, but **stops** on a 1008 (room gone / ended). The engines own the AudioContext + WS lifecycle and clean up on unmount.

## Visual design

Warm-&-human (Plan 1): stone neutrals, terracotta `#c0623a` (host label + primary actions), `0.75rem` radius, system + Korean-capable font stack, `:lang(ko)` line-height 1.6. shadcn/ui components: Button (Begin / 참여하기 / End), Input + Label (names), Switch (voice-over / clone toggles), Sheet (the ⋯ controls), Card. Joiner UI localized to Korean; host in English.

## Technical design

### Frontend (`web/`)

- **TS engine layer** (framework-agnostic, unit-testable in Vitest — mirrors the server-side engine split; holds the high-frequency audio/WS state in refs, never React state):
  - `SocketClient` — the conversation WS: token auth, reconnect-with-backoff, JSON message dispatch (roomInfo / config / status / delta / turnEnd / audio).
  - `MicCaptureEngine` — `getUserMedia` (echoCancellation/noiseSuppression/autoGainControl) + 16 kHz AudioWorklet (`pcm-capture`) + device switching + binary upload.
  - `PlaybackEngine` — 24 kHz PCM gapless playback (port v1 `attendee.js` `queueAudio` / `stopAllAudio`).
  - Composed by a `useConversation()` hook that binds engine state to React: `useReducer` for the river/status/config; a tiny `AuthContext` for the host admin token. No global store.
- **Components**: `OnboardingView` (host setup + QR/waiting + joiner welcome), `RiverTranscript` (+ `RiverTurn`), `ControlsSheet`, `StatusLine`, `ReconnectOverlay`. Single route `/conversation`; role detected from `?token=` (joiner → Korean) vs none (host → English setup).
- **i18n**: react-i18next (or a small context) for en/ko strings — port v1's `i18n.js` table.

### Backend (`server/`)

Port the conversation backend from `feat/conversation-mode` to TypeScript in `server/src/`:
- `active-speaker-router.ts`, `conversation-session.ts`, `conversation-manager.ts`, `conversation-transport.ts` — port from JS; reuse the fixes already applied to the church-mode port (cumulative-text dedup is in the Qwen session port; the conversation-session reconnect mirrors the SessionManager backoff).
- Wire `/api/conversation/create|config|end` + the `/ws/conversation` (token-authed) WS endpoint + the `/conversation` route into `server/src/index.ts`, alongside the church-mode server from Plan 2.
- Reuse the ported `QwenTranslationSession` / `GeminiTranslationSession` + the cert/ HTTPS + the manual upgrade-routing pattern.

### Protocol

WS down-messages + REST contracts are defined in `@v2/shared` (Plan 1): `ConversationWsMessage` (roomInfo, config, status, delta, turnEnd, audio) + `CreateRoom`/`UpdateConfig`/`EndRoom` types. The server imports them via `import type` only (erased at compile → no runtime dep on the `.ts`-source shared package).

## Scope (Plan 3)

- **Frontend:** the full conversation page — all screens, states, the engine layer, components, warm-&-human styling, en/ko.
- **Backend:** port the conversation cluster to TS + wire the conversation endpoints/WS/route into the v2 server.
- **Reuses:** v2 foundation (Plan 1), the warm-&-human design system, the ported church-mode backend (Plan 2), `@v2/shared` types.

## Out of scope

- attendee / interpreter / admin surfaces (Plan 4+).
- Church-mode (done in Plan 2).
- New translation providers (Qwen / Gemini only).
- Conversation history / recording.
- Dark mode (tokens support it later; not in this spec).
