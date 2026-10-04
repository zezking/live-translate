# Live Translate — Brand

Clean, minimal app identity for the translation app.

## Files

| File | What it is |
|------|------------|
| `logo.svg` | Primary **app icon** — a die-cut speech bubble with an audio waveform knocked out, on an azure→indigo gradient squircle (macOS tile proportions, corner ≈ 22.3%). |
| `wordmark.svg` | Horizontal **icon + wordmark** lockup for web, splash screens, README headers, decks. |

## Concept

A white speech bubble with a five-bar audio waveform cut out of it — **live spoken
word**, instantly readable at small sizes. The waveform's gradient (showing through
the cut-out) carries the color, keeping the mark crisp and premium. Neutral and
secular enough for any context, distinct enough to own.

## Using it

- **macOS app icon:** rasterize `logo.svg` to the standard iconset
  (`icon_{16,32,64,128,256,512,1024}{,@2x}.png`), then
  `iconutil -c icns iconset.iconset` → `AppIcon.icns`. The OS applies the squircle
  mask, but the built-in rounded background also reads correctly as a standalone tile.
- **Web:** drop the SVG in directly; it scales without rasterizing.
- Colors live in `<defs>` — change the three `#cc-bg` stops to retheme in one place.
