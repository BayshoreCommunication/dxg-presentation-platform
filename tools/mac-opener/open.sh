#!/bin/bash
# DXG·PM Opener (D-168): fetch one presentation by its five-minute DXG·PM open link and open it in
# this Mac's default app for it — Keynote, LibreOffice or PowerPoint.
#
# Called by the applet with the whole link: dxgpm-open:https://<site>/api/v1/open/<token>/<name>.pptx
# Anything else is refused: only DXG·PM's open links, only presentation files. The link can be
# triggered by any web page, so this is what keeps it from fetching or opening anything else.
set -u
url="${1#dxgpm-open:}"

case "$url" in
  https://pmp.av-rfpilot.com/api/v1/open/*) ;;
  # Local development only.
  http://localhost:[0-9]*/api/v1/open/* | http://127.0.0.1:[0-9]*/api/v1/open/*) ;;
  *) exit 2 ;;
esac

# The file name is the link's last part, percent-decoded; no folders, no hidden files.
name="${url##*/}"
name="${name%%\?*}"
name="$(printf '%b' "${name//%/\\x}")"
name="${name//\//_}"
name="$(printf '%s' "$name" | sed -E 's/^[.]+//')"
case "$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')" in
  *.pptx | *.ppt | *.ppsx | *.pps | *.potx | *.key | *.pdf) ;;
  *) exit 3 ;;
esac

dir="$HOME/Downloads/DXG-PM"
mkdir -p "$dir" || exit 4
target="$dir/$name"
part="$target.part"
/usr/bin/curl --fail --silent --show-error --location --max-time 600 --output "$part" "$url" || { rm -f "$part"; exit 5; }
mv -f "$part" "$target" || exit 4
/usr/bin/open "$target" || exit 6
