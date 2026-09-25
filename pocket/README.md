# NEO Pocket

The Android companion to NEO: open a WIP, write, close. The manuscript editor
is desktop NEO's own code (`app.js` / `styles.css`, copied in at build time),
running in a Capacitor shell with a phone-sized implementation of the
`window.neo` bridge (`www/pocket-bridge.js`). Files live in
`/storage/emulated/0/Documents/NEO Library`, shared with the desktop via
Syncthing — same plain files, no cloud, no accounts.

## Building

Robots build it. Every push to `main` that touches `pocket/`, `app.js`, or
`styles.css` produces a fresh, signed APK and drops it on the rolling
**pocket-latest** pre-release:

    https://github.com/hughhowey/neo/releases/download/pocket-latest/neo-pocket.apk

Bookmark that on the phone. Tap it, open the download, and it installs over
the previous build — same signing key every time, so no uninstalling and no
lost settings. The build takes about five minutes after the push. Pushing a
`pocket-v*` tag additionally publishes a numbered release for that version.

The signing key lives in two repo secrets (`POCKET_KEYSTORE_BASE64`,
`POCKET_KEYSTORE_PASSWORD`). If they ever change, the phone will need one
uninstall/reinstall.

First install only: sideload, then grant **All files access**
(Settings → Apps → NEO Pocket).

Local builds need Android Studio and: `cd pocket && npm install`, copy
`../app.js` and `../styles.css` into `www/`, `npx cap sync android`, then
build from `android/`. Local builds are debug-signed and won't install over a
robot build (or vice versa).

## Status — early alpha

Working: bookshelf, opening books, writing (hardware keyboard), autosave to
the shared library, pen-name switching, chapter list via the ☰ button.

Punch list, in rough order:
- Verify pocket-v0.1.5 fixed: dead Shelf button + system bars overlapping
  the UI (both were edge-to-edge enforcement; now targeting SDK 35 with
  opt-out) and missing cover art (now served via Capacitor file URLs)
- Stable APK signing key (repo secret) so updates install without
  uninstalling first
- A small settings sheet: page theme, text size (desktop syncs these via
  library.json, but the phone deserves local control)
- Bundle open-licensed fonts — Android lacks Georgia/Palatino/etc., so the
  typeface picker currently changes nothing here
- On-screen keyboard testing: composition/autocorrect vs. the editor's
  keydown handlers (hardware keyboards work well already)
- Syncthing conflict detection: warn when *.sync-conflict files exist
- Home-screen widget: the bookshelf with real covers, tap a book to write
  (native Android work; the dream feature)

## Not planned

Exports, email, spellcheck pass, and import stay on the desktop. Pocket is
the writing chair, not the cockpit.
