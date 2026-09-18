# NEO Pocket

The Android companion to NEO: open a WIP, write, close. The manuscript editor
is desktop NEO's own code (`app.js` / `styles.css`, copied in at build time),
running in a Capacitor shell with a phone-sized implementation of the
`window.neo` bridge (`www/pocket-bridge.js`). Files live in
`/storage/emulated/0/Documents/NEO Library`, shared with the desktop via
Syncthing — same plain files, no cloud, no accounts.

## Building

Robots build it: push a `pocket-v*` tag (or run the "Build NEO Pocket"
workflow) and download the `neo-pocket-apk` artifact. Sideload onto Android;
grant **All files access** (Settings → Apps → NEO Pocket).

Local builds need Android Studio and: `cd pocket && npm install`, copy
`../app.js` and `../styles.css` into `www/`, `npx cap sync android`, then
build from `android/`.

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
