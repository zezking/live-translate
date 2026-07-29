#!/usr/bin/env bash
#
# Signs LiveTranslate.app with a STABLE code-signing identity so macOS TCC grants
# (Screen Recording) persist across rebuilds. The default Xcode "Sign to Run
# Locally" (ad-hoc) signature changes cdhash on every build, invalidating TCC
# grants and re-prompting every time.
#
# Prefers an Apple Development identity (your login keychain); falls back to a
# self-signed identity created in a dedicated keychain if none is present.
#
# Usage: macos/dev-signing.sh [path/to/LiveTranslate.app]
set -euo pipefail

APP="${1:-/Applications/LiveTranslate.app}"
SELF_KC="$HOME/Library/Keychains/lt-sign.keychain-db"
SELF_KC_PW="lt-dev-sign"
SELF_CN="LiveTranslate Dev"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- pick an identity: prefer Apple Development, else set up self-signed -------
IDENTITY="$(security find-identity -p codesigning -v | grep -m1 -oE 'Apple Development: [^(]+\([A-Z0-9]+\)')"
if [ -z "$IDENTITY" ]; then
  echo "› no Apple Development identity found — creating self-signed one"
  [ -f "$SELF_KC" ] || { security create-keychain -p "$SELF_KC_PW" "$SELF_KC"; security set-keychain-settings -u "$SELF_KC"; }
  security unlock-keychain -p "$SELF_KC_PW" "$SELF_KC" 2>/dev/null || true
  if ! security find-identity -v "$SELF_KC" | grep -q "$SELF_CN"; then
    openssl req -x509 -newkey rsa:2048 -keyout "$WORK/lt.key" -out "$WORK/lt.crt" \
      -days 3650 -nodes -subj "/CN=$SELF_CN" -addext "extendedKeyUsage=codeSigning" 2>/dev/null
    openssl pkcs12 -export -in "$WORK/lt.crt" -inkey "$WORK/lt.key" \
      -out "$WORK/lt.p12" -passout pass:"$SELF_KC_PW" -name "$SELF_CN" \
      -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1
    security import "$WORK/lt.p12" -k "$SELF_KC" -P "$SELF_KC_PW" -T /usr/bin/codesign -T /usr/bin/security
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$SELF_KC_PW" "$SELF_KC"
  fi
  grep -q "$SELF_KC" <(security list-keychains -d user) || security list-keychains -d user -s login.keychain-db "$SELF_KC"
  IDENTITY="$SELF_CN"
fi

echo "› using identity: $IDENTITY"

# --- re-sign the app ----------------------------------------------------------
[ -d "$APP" ] || { echo "✖ app not found: $APP" >&2; exit 1; }
echo "› preserving entitlements"
ENT="$WORK/entitlements.plist"
codesign -d --entitlements :"$ENT" "$APP" 2>/dev/null || true

echo "› re-signing bundle (--deep covers the Xcode 26 debug-dylib stub + dylibs)"
# NOTE: deliberately NO --options runtime. The debug-dylib stub executor uses a
# JIT stub that hardened runtime would kill; TCC persistence doesn't need it.
if [ -s "$ENT" ]; then
  codesign --force --deep --sign "$IDENTITY" --entitlements "$ENT" "$APP"
else
  codesign --force --deep --sign "$IDENTITY" "$APP"
fi

echo "› verifying"
codesign -dv "$APP" 2>&1 | grep -E "Identifier|Authority|TeamIdentifier|Signature|flags" | head
echo "✓ signed with stable identity"
