# Live Translate

Real-time AI speech translation. This repo now centers on the **native macOS app** —
the other apps live under `mobile/` and are archived (no longer actively developed).

| Path | What it is | Status |
|------|------------|--------|
| [`macos/`](macos/README.md) | Native SwiftUI app: continuous one-way live translation (sermons/talks) via Qwen realtime — original + translated captions, sticky note, optional voice-over | **Active — main codebase** |
| [`mobile/`](mobile/README.md) | Web apps: v1 Express server streaming translations to attendees' phones, and the v2 React conversation SPA | **Archived** — tag `mobile-archive-2026-10-04` |

## macOS app (primary)

```bash
brew install xcodegen        # once
cd macos
xcodegen generate
xcodebuild -project LiveTranslate.xcodeproj -scheme LiveTranslate -configuration Debug build | tail
open build/Build/Products/Debug/LiveTranslate.app
```

See [`macos/README.md`](macos/README.md) for usage (DashScope API key, input sources,
dev signing) and current scope.

## Mobile/web apps (archived)

Everything Node-based moved to `mobile/`. From that folder the old commands still work:

```bash
cd mobile
npm install                  # npmrc mirror auth may be needed — see AGENTS.md
npm run dev                  # v1 server
npm run dev:server           # v2 backend (:4000)
npm run dev:web              # v2 web (:5173)
npm run build:v2 && npm run test:v2
```

Details: [`mobile/README.md`](mobile/README.md).
