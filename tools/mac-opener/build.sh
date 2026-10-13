#!/bin/bash
# Builds dist/DXG-PM-Opener.pkg (D-168). Run on a Mac: osacompile, PlistBuddy, codesign, pkgbuild and
# productbuild are macOS tools. Built in a temporary folder, so the copy made here is never left
# registered with this Mac as the handler for dxgpm-open: links.
set -euo pipefail
cd "$(dirname "$0")"
HERE="$PWD"
WORK="$(mktemp -d)"
LSR=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
APP="$WORK/root/DXG·PM Opener.app"
cleanup() { "$LSR" -u "$APP" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

mkdir -p "$WORK/root" dist
osacompile -o "$APP" main.applescript
cp open.sh "$APP/Contents/Resources/open.sh"
chmod +x "$APP/Contents/Resources/open.sh"
PLIST="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.dxg.pm.opener" "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.dxg.pm.opener" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleName DXG·PM Opener" "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleName string DXG·PM Opener" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string 1.0" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string DXG·PM open link" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string dxgpm-open" "$PLIST"
# Ad-hoc signature: no Apple Developer ID yet (see README).
codesign --force --deep --sign - "$APP"
"$LSR" -u "$APP" >/dev/null 2>&1 || true

mkdir -p "$WORK/scripts" && cp pkg/postinstall "$WORK/scripts/postinstall"
pkgbuild --root "$WORK/root" --identifier com.dxg.pm.opener --version 1.0 \
  --install-location /Applications --scripts "$WORK/scripts" "$WORK/opener.pkg" >/dev/null
productbuild --distribution pkg/distribution.xml --package-path "$WORK" "$HERE/dist/DXG-PM-Opener.pkg" >/dev/null
rm -f dist/DXG-PM-Opener-mac.zip
echo "built dist/DXG-PM-Opener.pkg"
