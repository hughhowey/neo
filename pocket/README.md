# NEO Pocket

The Android and iOS companion to NEO: open a WIP, write, close. The
manuscript editor is desktop NEO's own code (`app.js` / `styles.css`, copied
in at build time), running in a Capacitor shell with a pocket-sized
implementation of the `window.neo` bridge (`www/pocket-bridge.js`). Same
plain files as the desktop, no accounts.

- **Android:** files live in `Documents/NEO Library`, shared with the desktop
  via Syncthing.
- **iOS:** files live in the app's own folder. With iCloud Drive on, that's
  iCloud Drive → NEO Pocket → NEO Library (still local files; Apple carries
  changes in the background), and desktop NEO can point at the same folder
  with File → Library Folder…. With iCloud Drive off, it's On My iPad → NEO
  Pocket. Nothing is required on the desktop side: NEO stays local unless
  the writer chooses that folder.

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
`../app.js`, `../outline-cards.js`, `../covers.js`, `../styles.css`, `../i18n.js` and the `../fonts` and `../locales` folders into `www/`, `npx cap sync android`, then
build from `android/`. Local builds are debug-signed and won't install over a
robot build (or vice versa).

## Building for iOS

Needs Xcode (with the iOS simulator), CocoaPods (`brew install cocoapods`),
and an Apple Developer account for a real device. Then:

    cd pocket && npm install
    cp ../app.js ../outline-cards.js ../covers.js ../styles.css ../i18n.js www/ && cp ../node_modules/jszip/dist/jszip.min.js www/ && cp -R ../fonts ../locales www/
    npx cap sync ios
    npx cap open ios

In Xcode: pick your Team under Signing & Capabilities, add the **iCloud**
capability with **iCloud Documents** ticked and the container
`iCloud.com.hughhowey.neo.pocket`, choose an iPad simulator or a plugged-in
iPad, and press Run. After changing `app.js`, `styles.css` or anything in
`www/`, repeat the `cp` and `npx cap copy ios`, then Run again.

`ios/App/App/LibraryHome.swift` is the one piece of native code: it tells the
bridge where the library folder is (iCloud or on-device) and pulls down files
another device wrote before they're read.

To test with real books in the simulator, run Pocket once, then:

    open "$(xcrun simctl get_app_container booted com.hughhowey.neo.pocket data)/Documents"

and copy a `NEO Library` folder in there (simulators have no iCloud, so this
is the On My iPad path).

## Status — early alpha

Working: bookshelf, opening books, writing (hardware keyboard), autosave to
the shared library, pen-name switching, chapter list via the ☰ button or a
swipe from the left edge, Notes & Comments via a swipe from the right edge.
the ⋯ button for the desktop's Format and View choices (typeface, text
size, drop cap, page, focus, typewriter, poetry) plus Goals. Android's bars
stay hidden (swipe an edge to peek), the back gesture returns to the shelf,
and on Android the on-screen keyboard stays down — long-press ☰ (or use the
⋯ sheet) to summon it. On iPad the keyboard behaves normally and hides
itself when a hardware keyboard is attached.

Punch list, in rough order:
- Verify pocket-v0.1.5 fixed: dead Shelf button + system bars overlapping
  the UI (both were edge-to-edge enforcement; now targeting SDK 35 with
  opt-out) and missing cover art (now served via Capacitor file URLs)
- Stable APK signing key (repo secret) so updates install without
  uninstalling first
- A small settings sheet: page theme, text size (desktop syncs these via
  library.json, but the phone deserves local control)
- On-screen keyboard testing: composition/autocorrect vs. the editor's
  keydown handlers (hardware keyboards work well already)
- Syncthing conflict detection: warn when *.sync-conflict files exist
- Home-screen widget: the bookshelf with real covers, tap a book to write
  (native Android work; the dream feature)

## Not planned

Exports, email, spellcheck pass, and import stay on the desktop. Pocket is
the writing chair, not the cockpit.
