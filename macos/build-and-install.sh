#!/usr/bin/env bash
# Dev-deploy LiveTranslate.app: build (Debug) → stable-identity re-sign →
# install to ~/Applications → relaunch. Implements the flow documented in
# macos/README.md ("xcodebuild → dev-signing.sh → ditto to ~/Applications →
# relaunch") so the Screen Recording TCC grant survives rebuilds.
#
# Usage: macos/build-and-install.sh [destination-dir]   (default: ~/Applications)
set -euo pipefail

DEST="${1:-$HOME/Applications}"
ROOT="$(git rev-parse --show-toplevel)"
MACOS="$ROOT/macos"
APP_NAME="LiveTranslate.app"
BUILT="$MACOS/build/Build/Products/Debug/$APP_NAME"
INSTALLED="$DEST/$APP_NAME"

cd "$MACOS"

# Regenerate the .xcodeproj only when project.yml changed since last generation.
if [ ! -f LiveTranslate.xcodeproj/project.pbxproj ] || [ project.yml -nt LiveTranslate.xcodeproj/project.pbxproj ]; then
  echo "› xcodegen generate (project.yml newer than .xcodeproj)"
  xcodegen generate
fi

echo "› xcodebuild (Debug, incremental via -derivedDataPath build)"
# tail keeps agent output short; pipefail still propagates the xcodebuild status.
xcodebuild -project LiveTranslate.xcodeproj -scheme LiveTranslate \
  -configuration Debug -derivedDataPath build build 2>&1 | tail -40

[ -d "$BUILT" ] || { echo "✖ build did not produce $BUILT" >&2; exit 1; }

echo "› re-signing with stable identity (preserves the TCC grant)"
./dev-signing.sh "$BUILT"

# Quit the running instance so the bundle can be replaced cleanly.
osascript -e 'tell application "LiveTranslate" to quit' 2>/dev/null || true
sleep 1
pkill -x LiveTranslate 2>/dev/null || true

echo "› installing to $INSTALLED"
mkdir -p "$DEST"
rm -rf "$INSTALLED"
ditto "$BUILT" "$INSTALLED"

echo "› launching"
open "$INSTALLED"
echo "✓ LiveTranslate installed to $INSTALLED"
