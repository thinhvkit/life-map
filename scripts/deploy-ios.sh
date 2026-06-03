#!/usr/bin/env bash
# Fast on-device Release deploy via xcodebuild directly (skips the
# react-native run-ios wrapper: no scheme/destination enumeration, and the
# launch step won't fail the whole run when the phone is locked).
# Reuses the default DerivedData so native compile stays fully incremental.
#
# Usage: scripts/deploy-ios.sh [UDID]
set -euo pipefail

UDID="${1:-00008110-00163D360C09801E}"
WORKSPACE="ios/LifeMap.xcworkspace"
SCHEME="LifeMap"
BUNDLE_ID="com.thinhvo.lifemap"

echo "▶︎ Building LifeMap (Release, incremental) for $UDID …"
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination "id=$UDID" \
  -allowProvisioningUpdates \
  -quiet \
  build

APP="$(find "$HOME/Library/Developer/Xcode/DerivedData/LifeMap-"*/Build/Products/Release-iphoneos -maxdepth 1 -name 'LifeMap.app' 2>/dev/null | head -1)"
if [ -z "$APP" ]; then
  echo "✗ Could not locate built LifeMap.app" >&2
  exit 1
fi

echo "▶︎ Installing $APP …"
xcrun devicectl device install app --device "$UDID" "$APP"

echo "▶︎ Launching $BUNDLE_ID …"
if xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" 2>/dev/null; then
  echo "✓ Launched."
else
  echo "• Installed, but launch failed (device likely locked). Unlock and tap the app."
fi
