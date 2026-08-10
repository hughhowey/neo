# Contributing to NEO

Thanks for wanting to make NEO better. A few notes before you dive in.

## The philosophy

NEO exists because every writing app its author loved was eventually ruined by bloat. So the bar for new features is not "would this be cool?" but "does this help a working author write, finish, and publish books?" Features that pass might get in. Features that don't stay out, even when they're clever. This is not design-by-committee, and pull requests that add preference panels, toolbars, or seventeen ways to configure the same thing will be lovingly declined.

Good territory: anything on the roadmap in the README, bug fixes, performance, accessibility, better import/export fidelity, and platform polish (especially Windows and Linux, which I haven't tested much).

## How the code works

No frameworks, just four files:

- `main.js` — the Electron main process: window, menus, file system, import/export plumbing, backups.
- `preload.js` — the bridge between renderer and main. Every capability the UI has is listed here.
- `app.js` — the entire UI: bookshelf, editor, outline, search, goals, the Silo. Organized in commented sections.
- `styles.css` — all styling, with CSS variables for the palette at the top.

Books are folders of plain files in `~/Documents/NEO Library` (or your OS 'Documents' convention): `book.json` for metadata, `chapters/*.html` for text, JSON files for darlings/stickies.

## Ground rules for the writing experience

1. **Nothing interrupts a writer mid-sentence.** No popups, no squiggles, no notifications while typing.
2. **UI stays invisible until hovered.** The book is the interface.
3. **Words are never lost.** Any feature that removes text must route it somewhere recoverable.
4. **Plain files.** No databases, no proprietary formats. Future-proof, please!

## Practical bits

- Run from source: `npm install && npm start` (needs Node.js).
- Keep PRs focused — one feature or fix each.
- Describe the writer-facing behavior in your PR, not just the code. Think like an author, not a programmer!
- Bug reports: please include your OS, what you did, what happened, and the tail of `~/Documents/NEO Library/neo-errors.log` if it's a crash.
