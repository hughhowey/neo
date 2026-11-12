# Contributing to NEO

Thanks for wanting to make NEO better. A few notes before you dive in.

## The philosophy

NEO exists because every writing app was eventually ruined by bloat. The bar for new features is not "would this be cool?" but "does this help a working author write, finish, and publish books?"

Good territory: bug fixes, performance, accessibility, better import/export precision, and platform polish (especially Windows and Linux, which I haven't tested much).

## How the code works

- `main.js` — the Electron main process: window, menus, file system, import/export, backups.
- `preload.js` — the bridge. Every capability the UI has is listed here.
- `app.js` — the entire UI: bookshelf, editor, outline, search, goals.
- `styles.css` — all styling, with CSS variables at the top.

Books are folders of plain files in `~/Documents/NEO Library`: `book.json` for metadata, `chapters/*.html` for text, JSON files for darlings/stickies.

## Ground rules

1. **Nothing interrupts a writer mid-sentence.** No popups, no squiggles, no notifications while typing.
2. **UI stays invisible until hovered.** 
3. **Words are never lost.** Any feature that removes text must route it somewhere recoverable.
4. **Plain files.** No databases, no proprietary formats. Future-proof, please!

## Practical bits

- Run from source: `npm install && npm start` (needs Node.js).
- Keep PRs focused — one feature or fix each.
- Describe the writer-facing behavior in your PR, not just the code. Think like an author, not a programmer!
- Bug reports: please include your OS, what you did, what happened, and the tail of `~/Documents/NEO Library/neo-errors.log` if it's a crash.

## Licenses and third-party files

NEO is MIT. Its licensing is written down the [REUSE](https://reuse.software/spec-3.3/) way, so a person or a tool can read who owns each file and under which license, without a header in every file:

- `REUSE.toml` at the top says every file is NEO's, MIT, unless a `REUSE.toml` nearer to the file says otherwise. `dictionaries/<code>/`, `notices/<package>/`, `fonts/`, `print/` and `pocket/android/` each have their own, naming the upstream copyright and the SPDX license expression. All use `precedence = "closest"`: the nearest one wins, and a file's own SPDX lines win over both.
- `LICENSES/` holds the full text of every license named, as `<SPDX id>.txt`. `LicenseRef-…` files are texts with no SPDX id.
- A dictionary's notice and license texts also sit beside its data (`NOTICE.txt`, `MPL-1.1.txt`, …), because they ship in the app with it. `notices/<package>/` holds them for dictionaries NEO takes from npm. Electron-builder's `extraResources` puts them in the packaged app, and `scripts/pocket-www.js` copies them into Pocket's `dict/<code>/`.

Bringing in something you didn't write (a dictionary, a font, a vendored script):

1. Check the license allows NEO to ship it beside MIT code. Pocket goes through the App Store, where GPL-only data is a known problem. Ask Hugh first. `dictionary-de` (GPL-2.0 or GPL-3.0) is shipped today, and that question is still open.
2. Add an `[[annotations]]` table to the nearest `REUSE.toml`, or start one in the new folder with `path = "**"`. Give the upstream `SPDX-FileCopyrightText` and the license as upstream offers it, all options included (`GPL-2.0-only OR LGPL-2.1-only OR MPL-1.1`). If NEO picks one option, say so in the `NOTICE.txt`, not in the expression.
3. A new license id: `reuse download <SPDX id>` puts its text in `LICENSES/`.
4. If it ships in the app, put its notice and license text beside it, and make sure the build carries them (`files` in a local dictionary's `package.json`, `extraResources`, `pocket-www.js`).
5. Run the check.

When you update a vendored file, check that the upstream license hasn't changed, and update the version and years in its `REUSE.toml` and `NOTICE.txt`. When you remove one, remove its table, and its text in `LICENSES/` if nothing else uses it.

The check, which must say the project is compliant:

```
npm run lint:reuse          # reuse lint
reuse spdx -o neo.spdx      # every file's copyright and license, as an SPDX document
```

Install reuse with `brew install reuse`, `apt install reuse` or `pipx install reuse`. In a sandbox that can't open sockets, use `reuse --no-multiprocessing lint`. REUSE covers the repository only, not what npm installs into `node_modules`. For those packages, their `package.json` license fields are the record (`npm sbom`).
