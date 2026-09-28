# G0-1 test corpus generator

Builds the Room Agent PoC corpus (gate G0-1 / G0-7, plan item A5 in `docs/poc/G0-1_PLAN.md`) into
`tests/fixtures/g0-1/`, and writes `MANIFEST.md` + `manifest.json` (with SHA-256 hashes) there.
The manifest is generated. To change it, edit the `register(...)` calls in `generate.py`, not the file.

## Requirements (macOS build box)

- Python 3.11+ (`/opt/homebrew/bin/python3`)
- ffmpeg with libx264, libx265 and prores_ks (`brew install ffmpeg`)
- LibreOffice (`soffice`), used headless for the `.ppt`/`.pdf` conversions and for verification
- Keynote, only if you use `--keynote`

```bash
cd scripts/g0-1-corpus
/opt/homebrew/bin/python3 -m venv .venv
.venv/bin/pip install python-pptx          # pulls lxml, Pillow, XlsxWriter
.venv/bin/python generate.py               # committed corpus + verification (about 1 min)
.venv/bin/python generate.py --large       # also large/large-deck-80mb.pptx (~85 MB, gitignored)
.venv/bin/python generate.py --keynote     # also keynote-10-slides.key via Keynote (see below)
.venv/bin/python generate.py --no-verify   # skip the python-pptx / LibreOffice re-open checks
```

`.venv/` and `.build/` (intermediate clips, LibreOffice profile, verification output) are gitignored.
The script exits non-zero if a non-corrupt file fails to reopen or the committed corpus goes over 25 MB.

## What is deterministic

Every `.pptx`/`.pptm`, clip, image and `.xlsx` is byte-identical between runs. The generator uses fixed
core-property dates, fixed zip entry dates, bitexact single-threaded ffmpeg and seeded random data.
LibreOffice outputs (`.ppt`, `.pdf`) and the Keynote `.key` embed their own timestamps, so they only
match in content. Their hashes in `manifest.json` change on every run.

## How the tricky files are made

- **Transitions and animations**: hand-written OOXML. The generator writes `p:transition` (fade, push,
  wipe, split, cover, dissolve, zoom, wheel, circle, cut, and `advTm` auto-advance) and a `p:timing` tree
  with mainSeq, click groups and with/after-previous steps. It covers these effects: Appear (preset 1),
  Fade (10), Fly In (2), Spin (8), Fade exit, custom `p:animMotion` paths, and a `mediacall` autoplay. Each
  element is inserted in schema order (`cSld, clrMapOvr, transition, timing, extLst`). LibreOffice parses
  every effect back correctly. PowerPoint still has to confirm them (see the manifest checklist).
- **Linked video**: the video is added with `add_movie`. The generator then rewrites the slide's `video`
  and `media` relationships to `TargetMode="External"`, switches `p14:media` from `r:embed` to `r:link`,
  and deletes the embedded media part. Link targets are relative to the deck's folder, so copy the whole
  folder onto the test machine.
- **Linked OLE and picture**: the generator embeds the object with `add_ole_object`, then turns
  `p:embed` into `p:link updateAutomatic="1"` and changes the relationship to an External `oleObject`.
  The picture's blip changes from `r:embed` to `r:link`.
- **`.pptm`**: the file has the macro-enabled main content type, a `vbaProject` relationship, and a
  `ppt/vbaProject.bin` that is a valid OLE2/CFB container with **no VBA code**. The generator's
  own small CFB writer produces it. The file tests how the agent handles a macro-enabled *file*. It
  does not test working macros. The manifest's TODO covers building a real macro deck in PowerPoint.
- **Corrupted**: four variants, all derived from the 10-slide deck or seeded bytes: truncated to 60%,
  malformed slide XML inside a valid zip, random bytes, and 0 bytes.
- **Fonts**: `a:latin typeface` set to Montserrat (free, OFL), a font name that does not exist, and
  Helvetica Neue (a Mac-only font). None of them is embedded, so PowerPoint substitutes a font when the
  named one is missing. python-pptx cannot make an embedded-font deck, so that one is a Windows TODO.

## Keynote

`--keynote` uses `osascript` to make Keynote open `normal-10-slides-notes.pptx` and save it as
`keynote-10-slides.key`. The first run needs you at the Mac to approve the "Terminal wants to control
Keynote" Automation prompt and to dismiss Keynote's first-launch or import dialogs. Unattended runs time
out after 120 s. If it cannot run, create the file by hand (Keynote › Open the .pptx › File › Save) and
commit it. The manifest lists the file as TODO until it exists.

## Needs the real application

The manifest ends with a checklist: animation fidelity, HEVC/ProRes behaviour, link prompts, the
embedded-font deck, and a real macro deck. Each item has to be done once on the Windows PoC box, and
the results go in `docs/poc/ROOM_AGENT_POC.md`.
