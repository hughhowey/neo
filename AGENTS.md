# NEO — notes for agents

NEO is a local word processor for books. It is an Electron app made of plain JavaScript, HTML, and CSS. There is no bundler, no framework, and no compile step. `npm start` runs `electron .`.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before adding a feature. The product is opinionated on purpose. A change that helps someone finish a book belongs here. A change that adds a panel, a prompt, or a dependency usually does not.

## Rules that override convenience

- Nothing interrupts a writer mid-sentence. No popups, no squiggles, no notifications while typing. Spellcheck is off until the writer asks for a pass.
- Controls stay hidden until hover or keyboard focus.
- Words are never discarded. Deleting text, unbinding a shelf, or losing a trash operation must leave the words recoverable (Darlings, a sibling chapter, or the system trash). `book:delete` uses `shell.trashItem`. If trash fails, leave the folder and show it.
- Books are plain files. No database, no proprietary format.
- The renderer never touches the filesystem. Disk access goes through `window.neo` (`preload.js`) to handlers in `main.js`.
- Do not save UI decoration into chapter HTML. Search highlights, spellcheck underlines, and focus dimming use the CSS Highlight API so they stay out of the file.
- Do not rewrite a chapter that has not changed. Libraries are synced with iCloud and Syncthing. A timer that writes every chapter on an interval will fight the other device.

## Papers

A book whose `book.json` says `"format": "paper"` is an academic paper. Right-click (long-press) a shelf's + for New Paper. What the feature is *for* (and the rules a new academic feature is checked against) is in [docs/writing-principles.md](docs/writing-principles.md); read it before adding to it. The feature lives in `paper/`: `paper.js` (the editor: title page, headings, citations, maths, figures, tables, the pane, menus, export glue), `library.js` (the References tab), and three plain modules the tests load in node: `references.js` (BibTeX, RIS and CSL JSON in; BibTeX out; DOIs; keys; the @ picker's ranking), `symbols.js` (LaTeX's names for characters, a paper's symbol definitions: their names, order and sync), `editing.js` (the editing pass's rules), `cite.js` (citeproc-js and the CSL styles in `paper/csl`) `journals.js` (each journal's page, habits, citation style and LaTeX class), `omml.js` (MathJax's MathML as Word equations) and `export.js` (LaTeX, Pandoc Markdown, one-file Markdown, plain text, EPUB, HTML and Word from a plain model of the paper). `app.js` calls in at a handful of hooks, each guarded by `isPaper()`.

- Like a script, the paper is one chapter, so selection runs through it. Headings are `<p class="h1|h2|h3" data-id="sec-…">`; there are no *** breaks and Enter never splits a chapter.
- Citations, cross-references and inline maths are uneditable spans (`.cite` with `data-cite` JSON, `.xref` with `data-ref`, `.math` holding its TeX); a display equation is `<p class="eq">` holding its TeX. Figures and tables are `<figure class="fig|tbl">` with editable captions and cells. The text inside each is saved, so a chapter file reads sensibly on its own.
- Numbers (`data-num`), section hints (`data-hint`), a figure's `blob:` picture and `data-missing` are runtime only; `captureBody` strips them through `paperStrip`. Maths is drawn into a shadow root, which `innerHTML` never serializes.
- Maths is edited in place (`editMath`): the span becomes editable and its shadow root shows the TeX through a `<slot>` beside a live drawing. The caret must sit in the TeX's text node (at an element boundary the engine settles it outside), keys are routed by where the caret is (`mathCaretIn`), not by the event target (the chapter is the editing host), and `paperStrip` saves the editing state as plain maths. While it's edited the TeX starts with a zero-width space (`MATH_HOLD`): without it, empty TeX takes no typing and TeX selected whole is typed over as the span itself. Read TeX with `texOf`, never `textContent`. Arrow keys, Backspace and Delete beside maths open it (`paperStepIn`), and the arrows at its ends close it. An equation being edited loses its `user-select: none`.
- A cross-reference's saved text is in the journal's words (`NeoJournals.refLabel`: Fig. 2, Table 1, Section 3), never the interface language's, so two devices save the same chapter. Headings and equations that arrive without an id get one from their text and place (`paperIdFor`), the same on every device. A citation whose reference isn't in `references.json` (perhaps not synced yet) keeps its saved words and is only marked.
- Lists are paragraphs too: `<p class="li" data-list="ul|ol">`, nested by `data-level` (2, 3); `- `, `* ` or `1. ` at a line's start makes one (`paperListKey`), Tab and ⇧Tab nest, numbers are runtime `data-num` (`paperListNumbers`).
- Symbols are the paper's own notation, in `symbols.json` beside `references.json`: `[{ id, tex, meaning, unit, value, kind: 'parameter'|'variable', table, cite }]`, `id` being the name typed as `\id`. On the page a symbol is `<span class="sym" data-sym="id">` holding its TeX (kept to the definition by `paperSymbolsShown`); one whose definition is gone stays as its maths, marked. `\name` then a space or punctuation (`paperSymbolKey`) becomes a defined symbol, else LaTeX's character for it (`NeoSymbols.TEX_CHARS`: `\mu` → μ), never inside maths; the LaTeX export writes such characters back as commands so pdflatex compiles them. `/symbols` puts `<p class="symtab" data-kind="">` in the paper: empty in the file, the table drawn into its shadow root from the definitions (marked for the table, of its kind, in nomenclature order), its sources cited in reading order with the page's citations (`paperRenderCites`). The References tab has a Symbols view (`drawSymbols` in `library.js`); ⇧F10 beside maths can define one from it.
- `/` on an empty line opens the @ picker's list of things to insert (`INSERT_COMMANDS`: figure, table, equation, citation, cross-reference, headings), found by a word or its LaTeX name (`/includegraphics`, `/section`, `/ref`). Anywhere else a `/` is a slash.
- Editing is asked for, never shown while writing (docs/writing-principles.md, section 5). Edit → Editing Pass runs `NeoEditing.check` (`paper/editing.js`: plain string rules over the paragraphs' text, atoms as U+FFFC) plus `figureOrderFlags` and marks the results with the `neo-edit` highlight; ⌘' steps through them, and a right-click or ⇧F10 on one shows its note (`flag.key` translated with `flag.vars`) and its fix. View → First and Last Sentences dims each paragraph's middle with the `neo-skim` highlight (`NeoEditing.sentences`). Neither changes the file.
- A venue's LaTeX template (NeurIPS, ICML, ICLR, ACL, a workshop's) is imported from Format → Journal → From a LaTeX Template…: `paper:template-import` keeps the cleaned files beside the paper as `template.zip` (`templatePath` drops absolute paths, `..` and zip litter), `NeoTemplate.read` (`paper/template.js`) finds its main `.tex`, kind, review switch and page limit, and that goes in `book.paper.template` with `book.paper.journal` set to `'template'`. The page and Preview take the venue's look (`NeoJournals.templateLook`: ICML, ICLR and ACL beside NeurIPS, else one made from the template's class options); the LaTeX export fills the template (`NeoTemplate.fill`), its preamble and files kept as given, its example text left out. NEO never bundles a venue's files. Removing the template sends `template.zip` to the system trash.
- `book.paper.anonymous` (File → Anonymous for Review) makes `paperModel` leave out the authors, affiliations and the Acknowledgements, Funding and Author contributions sections (`anonymize`), so every preview and export is ready for double-blind review; the page keeps everything and says so under the authors.
- File → Export → Talk Outline is `NeoPaperExport.talk`: `talk.md` for Pandoc, `talk-marp.md` for Marp, and the figures, its narrative from `model.moves` (the abstract's sentences sorted by `abstractMoves`, the same cues as the abstract guide).
- Nothing in a paper needs the pointer. The arrows step into and out of maths, equations, captions and cells (`paperStepIn`, `figureKey`); Shift+F10 or the menu key opens what a click would, for where the caret is (`paperMenuKey`); ⌥↑ ⌥↓ move a section in the pane. A selection that deletes a whole figure or table sends its words to Darlings first.
- A figure is one picture (`data-src` on the figure) or panels (`.panel[data-src]` with a `.subcap` each). Panels sit in one row unless the figure has `data-cols` (1–4 to a row); a panel may be `data-colspan` 2 or 3 wide. `panelRows` in `export.js` gives every export the same widths the page's CSS draws, a row not full centred, and moving or removing a panel relinks the cross-references to it (`relinkPanels`). Its layout is `data-width` (25/33/50/67), `data-wrap` (left/right: text beside it, `wrapfigure`), `data-place` (LaTeX float placement h/t/b/p, or H pinned) and `data-span="page"` (both columns: `figure*`); tables take `data-place` and `data-span` too.
- `book.paper.journal` picks the journal (default `preprint`); choosing one also sets the citation style. File → Preview prints the paper's HTML, in the journal's CSS, through `paper:preview` into a PDF window; Preview As does the same in another journal's look and style, rendering the citations aside (`paperRenderCites`) so the page is untouched. The LaTeX export uses the journal's class; every journal's compiles (checked with tectonic).
- The engine's `insertHTML` puts an uneditable span outside its paragraph at a line's end, so `placeAtom` inserts them by hand, snapshots the structure first and sends ⌘Z to the structural undo. `stripJunkSpans` unwraps every span but NEO's own (`KEPT_SPANS` in `app.js`: placeholders, `.cite`, `.xref`, `.math`, a panel's `.subcap`); add a new span class there.
- References are `references.json` (CSL JSON, the citation key as `id`). Figures are `figure-<id>.<ext>` and a writer's own style is `style.csl`, all in the book folder, read and written through `paper:read` and `paper:write`, which accept only those names. A linked reference file's path lives in `userData/paper-links.json`, per machine (a synced path could name any file on another device); `paper:linked` reads only the path stored there. `paper:lookup` sends a DOI to doi.org, only when the writer asks; Pocket asks Crossref (DataCite for arXiv DOIs) directly. `paper:zotero` asks Zotero on 127.0.0.1 only (Better BibTeX's JSON-RPC `item.search`, else Zotero 7's local API) and backs off for a minute when nothing answers.
- MathJax (`mathjax-full`) and citeproc-js load the first time a paper opens. MathJax runs without its `html`, `require` and `autoload` extensions (no `\href`, `\class`, `\style`), and `texSvg` strips any link from what it draws; only `es5/tex-svg-full.js` is packaged (`build.files`). citeproc is CPAL/AGPL; see `licenses/citeproc`. Styles and locales are CC BY-SA (`licenses/csl`).
- `scripts/paper-*.test.js` test the plain modules (every Word and EPUB part goes through `xmllint` where it's installed); `npm run test:paper` drives a paper end to end in Electron and takes every way out, reading the .docx back with `textutil` and compiling the LaTeX with `tectonic` where they're installed (`NEO_SHOTS=<folder>` saves screenshots and the exports). The EPUB passes W3C EPUBCheck, and Microsoft Word opens the .docx with its equations as Word equations.

## Where the code is

| File | Role |
|---|---|
| `main.js` | Window, menus, every filesystem operation, import parsing, PDF, backups |
| `preload.js` | The entire renderer API, `window.neo` |
| `index.html` | Two views: `#bookshelf-view` and `#editor-view`. CSP is `script-src 'self'` |
| `app.js` | The whole UI, in banner-marked sections. Search for the banner before reading the file |
| `styles.css` | All styling. Tokens are CSS variables at the top |
| `covers.js` | Shelf covers in the window: seeded canvas art plus real title type. `window.NeoCovers` |
| `art.js` | Painted covers in the main process. OpenAI only. Title and author are never sent to the image model |
| `i18n.js` | `t()` / `tk()`, shared by main and the window. English source text is the key |
| `spell-worker.js` | Hunspell WASM, forked with `utilityProcess`. Messages: `load`, `check`, `suggest`, `add` |
| `spell-ro.js` | Romanian diacritics, used by the worker. Does not alter the manuscript |
| `locales/<code>.json` | One language. Regional files (`fr-CA.json`) hold only the strings that differ |
| `paper/` | Papers: see Papers above |
| `pocket/` | Capacitor shell. It does not contain its own editor |
| `print/` | Vendored Paged.js and hyphenation patterns for paperback PDFs |

`app.js` section banners look like `/*  SAVING  */`. Start there: bookshelf, bound shelves, editor open, typing, poetry, screenplays, placeholders, nav, tabs, outline, outline cards, darlings, counters, saving, refresh, structural undo, find, import, spellcheck, focus, goals, export, command palette.

Menus are built in `buildMenu()` in `main.js`. A menu click sends `{ type, ... }` to the window; `app.js` handles it on `window.neo.onMenu`.

The command palette (View → Command Palette…, ⌘⇧P; COMMAND PALETTE in `app.js`) is the menu read back: `commands:list` walks the live application menu and `commands:run` clicks the chosen item, so a new menu item is in the palette by itself and can't drift from it. Add a command to the menu, not to the palette. What has no menu item (a paper's `/` inserts, its sections) comes from `paperPaletteCommands`; a book's chapters are added in `openPalette`.

## Outline cards

The Outline tab shows the book as index cards (OUTLINE CARDS in `app.js`) unless `library.outlineView` is `'list'`. A script's Outline is always cards, one per scene (`scriptScenes`): heading, length in eighths, cast, and a note in `book.sceneNotes`, keyed by `data-scene-id` on the heading line. Dragging a scene card calls `spMoveScene`.

- Cards come from the manuscript, not a separate structure: each chapter is cut at its `p.scene-break` lines (`chapterSegments`). A section that holds a `p[data-sec-id]` belongs to that note in `book.sectionNotes`; the first section to carry an id owns it, because paragraphs split from a written ghost inherit the id. Others show their first line.
- Moving a card moves its paragraphs and *** between chapter bodies, then `syncChapter` and `orderSectionNotes`. Every move takes a `snapshotStructure` first.
- `syncGhosts` leaves a ghost where it stands and places a note the page lacks before the next section that's there. It never reorders ghosts.
- Loose cards are `book.looseCards`, shown in the right-hand pane while the Outline is up. A section card dragged there (or Move to loose cards) goes both ways: a section with writing takes its words along as `card.html`, out of the manuscript and the counts until it's placed again. Chapter cards and a script's scene cards go there too: the card carries the chapter (words, title, notes, kind; `held: 'chapter'`) or the scene's lines (`held: 'scene'`), written to book.json before they leave the page, and comes back whole (a chapter only between chapters). A card's Delete sends held words to Darlings first. A section card's Delete section sends its writing to Darlings (`deleteSectionToDarlings`).
- Several cards at once: ⌘-click (Ctrl-click) toggles a card, Shift-click takes a run, and a drag across empty outline space sweeps (`cardLasso`). The picked cards are `cardSel` (keys from `cardKey`), kept across a redraw and dropped after a move. Delete/Backspace or the right-click menu runs `deleteSelectedCards`: one `snapshotStructure`, the single deletes run quiet, sections and scenes from the last up, and a book keeps at least one chapter.
- `joinChapter` makes a chapter a section of another (List Tab on a chapter line, or a chapter card dropped on the middle of another). It moves the lines, persists the receiving chapter, and only then deletes the emptied one.
- In the List, Enter always makes a chapter and Tab always makes a section.
- On a card made new (`cardEditor.fresh`), Enter with words on it opens the next new card; Enter on an empty one, or Esc, stops. A pasted list (`outlineLines`, `pasteOutline`) becomes one card per line: on a chapter card, top lines are chapters and indented ones their sections.
- A script scene's card note shows in gray on the scene's empty first line (`spSceneNoteGhosts`, a `data-scene-note` screen mark that `captureBody` strips).

Brighter Interface is two settings: `library.uiBright` while writing (and on the shelf), `library.uiBrightAside` on the other tabs, bright unless turned off. `applyBright` picks one on every tab switch.
- The walking note (`walkNoteUpdate`) is an overlay inside `.chapter`, plus a `data-walk` mark on the caret's paragraph that `captureBody` strips. `note.dismissed` hides it for good.

## Screenplays

A book whose `book.json` says `"format": "screenplay"` is a script. Right-click (long-press) a shelf's + for New Script. The SCREENPLAYS section of `app.js` holds the feature; `scripts/screenplay.test.js` tests its rules.

- The whole script is one chapter, so selection and the arrow keys run through every scene. Scenes are found by their headings.
- Each line is a `<p>` whose class is its element: `sp-heading`, `sp-character`, `sp-paren`, `sp-dialogue`, `sp-transition`, `sp-shot`. Action has no class.
- Page breaks, page numbers, (CONT'D) and the gray suggestions come from `data-pg`, `data-fill`, `data-contd` and `data-ghost` marks. `captureBody` strips them. Never save them.
- Lengths in `styles.css` are in em of the script's type (51em = 8.5in, 1em = one 12pt line), so a line wraps the same on screen, in the off-screen measuring room and in the PDF. `spPaginate` places the pages from the line counts.
- `data-newpage` on a line is the writer's own page break (right-click → Page Break Here; Backspace at the line's start removes it). Unlike the screen marks it is saved, and it travels as `===` in Fountain and `StartsNewPage="Yes"` in Final Draft.
- A script's style lives in its `book.json`: `underlineHeadings: true` (Format → Underline Scene Headings) and `contd: false` ((CONT'D) turned off).
- A script exports as a PDF (letter, printed with `print: 'screenplay'`), Fountain or Final Draft (`.fdx`). The book formats don't apply.
- A `.fountain` or `.fdx` file dropped on a shelf or picked with Import becomes a new script. `importFile` in `main.js` only reads the file; `spFromFountain` and `spFromFdx` in `app.js` sort it into elements. Both readers are plain string functions, so the tests cover them (`scripts/fixtures/` holds a Final Draft file written by screenplain, an outside tool).

## Paperbacks for KDP

Export → Paperback for KDP… (also on the shelf's right-click Export) writes a print interior PDF and a cover template PDF beside it. `printPaperback` and `buildPrintHtml` are the PRINT BOOK section of `app.js`; `makePaperback`, `renderPaged` and `kdpCoverHtml` are in `main.js`, behind `print:paperback`.

- Trims are KDP's four most-used: 5×8, 5.25×8, 5.5×8.5, 6×9 (`PRINT_TRIMS` in `app.js`, `KDP_TRIMS` in `main.js`). Paper thickness, page limits and the inside-margin bands (`kdpGutterMin`) come from KDP's help pages; NEO adds a quarter inch to the minimum. If the page count crosses a band, the book is laid out again with the wider margin.
- Pages are set by Paged.js (`print/paged.polyfill.js`, vendored, MIT) in one offscreen window per export. A hidden window stalls its animation frames; a second offscreen window opened right after one closes fails. The window closes when the export ends. One patch in it is marked `NEO:` (a word hyphenated across a page turn broke a letter late).
- Hyphenation is soft hyphens put in by `hyphenateHtml` in `main.js` with TeX patterns (`print/hyphen/`, ISC), because Chromium only hyphenates on macOS. Only `p.hy` prose is touched; names (capitalised words, except in German) and a paragraph's last word stay whole.
- Chromium rounds page sizes to 0.01 in; `exactPageBox` rewrites the MediaBox to the exact size in the same number of bytes.
- The page count is kept even. Chapters open on a right-hand page; blank pages carry no head or number.
- Choices are kept: trim, paper, ISBN and fiction notice in `book.print`; on the pen name, `author.print` holds the back-matter links, `alsoByText` (the writer's own list, one title per line) and `reviewText` (own wording, with `{title}` for the book's title; empty means NEO's translated wording). A dedication typed in the dialog becomes the book's own Dedication page.
- Page 1 is the story's first page (the first `chapter` section, so a prologue). In the paperback that section is `.pg1` and each page's number is set on it after layout. The regular PDF stops counting on `@page front` pages and numbers its contents from the `data-p1` link; pages after page 1 that show no number (a part's title) are `.page.counted`.
- `scripts/print.test.js` covers the margin bands, hyphenation, the page box and the cover's size. Pocket has no paperback export.

## Per device

How NEO looks belongs to each device: `DEVICE_LOOK` in `app.js` (page theme, brightness, zoom, type size, typewriter, focus, counters, outline view, vim keys). Every library write also keeps them in this device's `localStorage`; every library read takes them back from there (`applyDeviceLook`). The library's copy is the last device's, which is what a device new to the library starts with. Zoom is per device and per view: the page per mode, the cards, and the shelf (`neo.shelfZoom`, ⌘+/− and pinch on the shelf), each in `localStorage`; the page moves in tenths. The desktop also keeps its page theme in `settings.json` for the window's color at launch, and `exportFolder` there, so save dialogs open where the last export went.

A book's right-click on the shelf is a small menu (`popMenu`) on the desktop, with the cover's choices one level in; touch keeps the larger cards. Duplicate (`book:duplicate`, and `duplicateBook` in Pocket's bridge) copies the folder under a new id and title.

Pocket makes PDFs through `NeoPdf`, a native plugin in each project: Android opens its print screen (Save as PDF), iOS draws the pages into a file for the share sheet. A script's title can be set bold, underlined or italic as a whole (`book.titleStyle`, ⌘B ⌘U ⌘I on the title page), and keeps it in the PDF, Fountain and Final Draft.

## Processes

```
index.html + app.js  →  preload.js (window.neo)  →  main.js  →  NEO Library
                                                      ↓
                                               spell-worker.js
```

The window is created with `contextIsolation: true` and `nodeIntegration: false`, and never navigates away from `index.html` or opens a window (`will-navigate`, `setWindowOpenHandler` in `createWindow`): `window.neo` would go with any page it showed. Open a link in the browser with `shell.openExternal`. New renderer capabilities are added in three places: an `ipcMain.handle` in `main.js`, a method on `window.neo` in `preload.js`, and the call site in `app.js`.

## Files on disk

Default library: `~/Documents/NEO Library` (`app.getPath('documents')`). **File → Library Folder…** stores another path in `userData/settings.json` and restarts. NEO does not move existing books.

```
NEO Library/
  library.json          shelves, author, pen names, customWords, spellLanguage
  _catalog.txt          regenerated map of folder → title; edits are ignored
  neo-errors.log
  Backups/neo-backup-YYYY-MM-DD.zip    one per day, 14 kept
  Exports/              emailed PDF snapshots
  book-<slug>-<id>/
    book.json           metadata and chapterOrder
    chapters/<id>.html
    notes.html
    outline.html
    darlings.json
    stickies.json
    cover-<ts>.<ext>    writer-chosen image
    art-<ts>.<ext>      painted image, plus art.json
    references.json     a paper's references (CSL JSON); symbols.json its symbols
    template.zip        a paper's venue LaTeX template, when it has one
```

App settings and the cover-art API key live in Electron `userData` (`settings.json`, `secrets.json`), not in the library. The key is encrypted with `safeStorage` when the OS allows it. Do not write secrets into the library.

Every book id, chapter id, and sidecar name passes through `libName()` in `main.js`. It allows one path segment and rejects `.`, `..`, slashes, and null bytes. Keep new files inside that helper.

Every library write goes through `writeFileDurable`: `file.tmp`, fsync, then rename into place, so a power cut can't leave an empty file. `writeJSON` also keeps the last version that read whole as `file.bak`, and `readJSON` falls back on `.tmp`, then `.bak`. A `book.json` lost with no copy is rebuilt from the chapter files (`rebuildBookMeta`). There is no append and no partial chapter update.

`json:write` and `aux:write` will create any single-segment `<name>.json` or `<name>.html` in the book folder. Prefer the existing names unless a new sidecar is actually required.

## Saving and sync

The window holds the open book in memory (`chapterHTML`, `book`, `stickies`, `darlings`) and remembers what it last wrote (`savedHTML`, `savedMetaSig`).

- Chapter and notes edits debounce 800 ms, then write only if the HTML changed and the chapter is still in `chapterOrder`.
- `flushAllSaves` runs every 20 s and on blur, hide, and close. It also stores `lastPosition` in `book.json`. A scroll-only change is not a new position.
- `refreshFromDisk` runs on focus, on visibility, and every 30 s while visible. It compares `mtimeMs:size` stamps and re-reads only changed chapters.
- Unchanged local chapter plus a changed file: adopt the file. If the file only has fewer words, adopt it and keep the displaced text in Darlings.
- Both sides changed: keep the local text on the page and insert the disk text as the next chapter, titled as from the other device.
- Skip a chapter whose write is still in flight. Drop a read that overlapped a local save. An empty read must not wipe a chapter that already has text.
- The same generation check applies to `library.json` on the shelf (`libraryGeneration`, `libraryWritesPending`).

Do not replace this with last-write-wins. The comments in `persistChapter` and `refreshFromDisk` explain cases that look redundant and are not.

## Interface language

Wrap writer-visible strings in `t('English text', { placeholder })`. Use `tk()` for strings translated later, at the point of display. In `index.html`, use `data-i18n`, `data-i18n-title`, `data-i18n-placeholder`, or `data-i18n-ph`.

After adding or changing strings:

```
node scripts/i18n.js template
node scripts/i18n.js check fr
```

`scripts/i18n.js` only scans `app.js`, `main.js`, `covers.js`, `paper/paper.js`, `paper/library.js`, `paper/editing.js` (whose notes are marked with a local `tk`), `index.html`, and Pocket's own `pocket/www/index.html` and `pocket/www/pocket-bridge.js`. A new string in another file will not enter the template until that list includes it. Pocket's page marks its words with the same `data-i18n*` attributes as the desktop's, and its ⋯ sheet and bridge use `t()`.

Details, plural forms, and regional fallback (`fr-CA` → `fr` → English) are in [TRANSLATING.md](TRANSLATING.md). Quotation marks follow the spellcheck language (`QUOTE_STYLES` in `app.js`). Import chapter detection is `CHAPTER_WORDS` in `main.js`. Cover small-words are `CONNECTORS` in `covers.js`.

Italian has no spellcheck dictionary: the only Hunspell package on npm is GPL-3.0-only, and NEO is MIT. Do not add it.

## Pocket

`pocket/` is a Capacitor app that runs the desktop editor. Its bridge (`pocket/www/pocket-bridge.js`) implements `window.neo` against the phone's library folder. Android shares `Documents/NEO Library` via sync. iOS uses the app folder, optionally iCloud, with `LibraryHome.swift` locating that folder.

`scripts/pocket-www.js` (run by CI, and by hand before a local build) copies `app.js`, `covers.js`, `styles.css`, `i18n.js`, `fonts/`, `locales/`, `paper/` with MathJax and citeproc-js, Hunspell's browser build, and the `SPELL_LANGUAGES` dictionaries from `main.js` into `pocket/www/`. Pocket's checker is `pocket/www/pocket-spell.js`, a module worker with the same messages as `spell-worker.js`. A change to those files changes Pocket. Pocket-only behavior belongs in `pocket-bridge.js` or the native projects, not behind a desktop-only branch scattered through `app.js`.

## Commands

```
npm install
npm start
npm test                   # node --test scripts/*.test.js
npm run test:coverage      # node --test --experimental-test-coverage scripts/*.test.js
npm run lint               # oxlint, Electron's standard-style JavaScript rules
npm run test:spellcheck    # node --test scripts/spellcheck.test.js
npm run test:dashes        # node --test scripts/dashes.test.js
npm run test:paper         # a paper written and exported end to end, in Electron
npm run bundle             # Hugh: brings in the newest .bundle from ~/Downloads and pushes main
npm run release            # Hugh: next version (x.y.9 → x.(y+1).0), commit, push, tag (npm run release -- 2.0.0 for another)
npm run package:mac        # macOS build; npm run package calls this
npm run package:linux      # AppImage via electron-builder; also package, package:mac, package:win, package:all
```

Tests use `node:test` and load `app.js` or `spell-worker.js` inside `vm`. They are not run by CI. The only CI check is a Windows smoke test that the packaged exe boots and creates a library (`.github/workflows/build.yml`, on `v*` tags). Pocket builds from `.github/workflows/pocket.yml`.

`node scripts/check-romanian-package.js <Resources dir>` compares a packaged app's dictionaries to the source tree. `node scripts/benchmark-spellcheck.js` times the checker. Neither is an npm script.

## Handing changes to Hugh

Hugh pushes and releases himself and isn't a git user. Hand him work as a git bundle of main..your-branch, built on the latest origin/main, then tell him: save it to Downloads, `npm run bundle`. To ship a desktop release: `npm run release`. Both commands check their footing and stop with a plain sentence instead of half-finishing. Don't give him raw git or npm version steps when these cover it.

## When you change something

- A new filesystem operation needs a handler, a `libName()` boundary, and a `preload.js` method. Match the existing IPC names (`library:`, `book:`, `chapter:`, `aux:`, `json:`, `cover:`).
- A new writer-visible string needs `t()` and a template refresh.
- A new way to remove text needs a recovery path and a sentence in the UI that says where the words went.
- Export formats are assembled in `app.js` and written by `export:save` in `main.js`. EPUB is a zip built in memory. PDF is printed from temporary HTML.
- Errors in the main process are appended to `neo-errors.log` via `logError`. Renderer failures go through `window.neo.logError`. Do not swallow a save failure; `persistChapter` rolls `savedHTML` back so the next flush retries.
