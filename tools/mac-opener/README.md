# DXG·PM Opener (Mac)

Lets **Open in Keynote** in DXG·PM open a deck straight in the Mac's app for presentations
(Keynote, LibreOffice or PowerPoint — whichever opens `.pptx` on that Mac). See D-168.

## Install on a desk Mac (once)

1. In DXG·PM, on a check-in or a presentation, click **install DXG·PM Opener** (it downloads
   `DXG-PM-Opener.pkg`).
2. Double-click it. Until the package is signed with an Apple Developer ID, the Mac says it can't
   be opened: go to **System Settings → Privacy & Security**, press **Open Anyway**, then **Open**.
3. **Continue → Install** (the Mac's password). It puts DXG·PM Opener in Applications and makes the
   `dxgpm-open:` link known straight away — nothing else to open.
4. Press **Open in Keynote**. The browser asks "Open DXG·PM Opener?" — tick "Always allow" to skip it next time.

Files land in `~/Downloads/DXG-PM/`. To remove it: delete DXG·PM Opener from Applications.

**Without the warning:** sign the app and the package with DXG's Apple Developer ID (Application and
Installer certificates) and notarize the package; then step 2 is just a double-click.
**On every desk at once:** give `DXG-PM-Opener.pkg` to whoever manages the Macs (Jamf, Intune or
another MDM) and it installs with no one at the desk.

## What it accepts

Only DXG·PM's five-minute open links (`https://pmp.av-rfpilot.com/api/v1/open/…`, or `localhost` for
development) and only presentation files (`.pptx .ppt .ppsx .pps .potx .key .pdf`). Any other link is
refused, so a web page can't use it to fetch or open anything else.

## Build

On a Mac: `./build.sh` → `dist/DXG-PM-Opener.pkg` (committed; the API serves it at
`/api/v1/downloads/dxgpm-opener-mac.pkg`). A new production domain must be added to `open.sh` and rebuilt.
