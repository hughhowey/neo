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
