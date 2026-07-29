# Live Translate — native macOS app

A standalone macOS app (SwiftUI) for real-time, one-way live translation powered by
Qwen's realtime translation WebSocket. Built as the v1 MVP: **stream mode** —
capture speech continuously from a mic, USB audio interface, or a browser/app
window, and show the original + translated text live (duplicate-free), with
optional translated voice-over. There is **no push-to-talk**: the source is
treated as a continuous stream (suited to a live sermon or talk). No server,
no browser, no attendee broadcast (those are parked for a later phase).

## Prerequisites

- macOS 14 (Sonoma) or newer
- Xcode 15+ (command-line tools OK, but Xcode is easiest)
- An Alibaba **DashScope** API key (the Qwen realtime endpoint)

## Build & run

```bash
# 1. Install xcodegen (one time) — generates the .xcodeproj from project.yml
brew install xcodegen

# 2. Generate the project
cd macos
xcodegen generate

# 3. Build & run (Debug)
xcodebuild -project LiveTranslate.xcodeproj \
           -scheme LiveTranslate \
           -configuration Debug build | tail

# 4. Launch the built app
open build/Debug/LiveTranslate.app
```

Or open `LiveTranslate.xcodeproj` in Xcode and hit ⌘R.

## Using it

1. **First launch** → paste your DashScope API key. It’s stored in Keychain.
2. **Setup screen** → choose the two languages, toggle translated voice-over, and
   pick your **input source**: the **Microphone / USB** interface or **Browser / App**
   window (via ScreenCaptureKit — needs Screen Recording permission). Selecting a
   device sets it as the system default input so the app captures from it.
3. **Start interpreter** → the app connects one warm Qwen session (source → target).
4. The app **continuously captures and translates** the source. The transcript shows
   the original and the translation, replacing (not appending) as Qwen revises —
   so text never duplicates.

## Notes / current scope

- **Audio input:** the system default input device. Selecting in the picker sets
  the default; the engine picks it up. (Per-app device binding + system-audio
  loopback are deferred — see the plan.)
- **App Sandbox is OFF** for development so mic + outbound network work with a
  simple TCC prompt. For distribution, re-enable sandbox + entitlements and
  sign/notarize with an Apple Developer ID.
- **Reconnect** on dropped Qwen sessions is not yet implemented (Phase 2).
- **Attendee broadcast / multi-language parallel / broadcast mode** — deferred.

## Layout

```
LiveTranslate/
├── App/            TranslationApp.swift   – @main, window, environment
├── Core/           KeychainStore, AppSettings, Language
├── Audio/          AudioCaptureEngine (→16 kHz Int16), PlaybackEngine (24 kHz),
│                   AudioDevices (Core Audio device enumeration)
├── Qwen/           QwenRealtimeSession     – faithful port of qwen-translation-session.ts
├── Conversation/   StreamTranslator        – one warm session, always-on, replace-not-append
└── Views/          Root, Onboarding, SessionSetup, Interpreter (live captions)
```
