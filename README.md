# NEO

**A distraction-free word processor for authors, by a wannabe author.**

NEO understands from the moment you install it that you are writing *books* and nothing else. No bloat, no distractions, with manuscripts that look like books as you write them.

NEO runs locally. WIPs are saved in plain files on your disk. No accounts or subscriptions. And it's free!

## Download

Get the latest installer from the **[Releases page](../../releases)**:

- **macOS** — download the `.dmg` for older Intel machines or the arm64 file for Mac silicon. Open it and drag NEO to Applications.
- **Windows** — get `NEO-Setup` (the installer, which keeps itself up to date) and run it, or the `portable` `.exe`, which runs without installing.

  Your library lives in `Documents\NEO Library`. If OneDrive backs up your Documents folder, that puts your books in OneDrive too; File → Library Folder… moves the library anywhere you like. If Windows Security's *Controlled folder access* is on, Windows won't let NEO save in Documents: NEO says so when it starts, and you can allow NEO there or pick another folder.
- **Linux** — download the `.AppImage`, make it executable, and run it:

  ```
  chmod +x NEO-*.AppImage
  ./NEO-*.AppImage
  ```

  If it complains about a sandbox (common on Ubuntu 24.04 and newer), run it as `./NEO-*.AppImage --no-sandbox`. Your library lives in `~/Documents/NEO Library`; File → Library Folder… moves it anywhere you like.

## Why NEO?

**The bookshelf** 

Your library looks like a bookshelf, not a file list. Labeled shelves you organize however you like — by series, by status, by pen name. Progress bars on the covers show how far you are from your word goals. You can drag-and-drop books anywhere. You can also drag shelves around and put cover art on your titles.

**Just a blank page** 

There's a white page by default or a dark mode (which I now prefer!). Controls fade until you mouse over them. Chapters number and renumber themselves automatically. Drop caps mark chapter openings, because I'm a sucker for drop-caps. Em dashes, true ellipses, and curly quotes sort themselves out as you type. Spellcheck exists only when you invoke it — no more red squiggles mid-sentence triggering your imposter syndrome.

**Enter, Enter, Enter** 

One Enter: new paragraph. Two: a `***` section break. Three: a new chapter. The goal is to KEEP WRITING.

Right-click the first chapter's heading to make it a prologue, or the last one's to make it an epilogue: they step out of the numbering, and everything renumbers.

**Darlings** 

The writing advice is "kill your darlings" — but I say: *keep the bodies*. Drag any beautiful-but-in-the-way passage onto the Darlings tab. It leaves your manuscript but isn't lost. Darlings restore to the exact spot it came from. More like zombies than darlings.

**Placeholders** 

Mid-flow and need a name, a fact, a date? ⌘⇧X drops a mark and a sticky note. The left panel shows a red dot on every chapter that you need to get back to. The right panel will list all these to-do items.

**Outlining with index cards** 

The Outline tab lays your book out as index cards, set like a page: they read left to right, line after line, so forty short chapters or a story of thirty scenes both fill the window. Each chapter starts at its big numeral, with its sections following on the same mat. Click a card and write a few lines on it. A section's note shows up in the manuscript as a gray ghost paragraph, and once you start writing, it rides one line below your words until you dismiss it. Drag a card to move it and the writing moves with it (⌘Z puts it back). Pantsers get cards too: every chapter and every *** section is already a card, showing its first line until you give it a note. Ideas without a home wait on loose cards in the right-hand panel. ⌘− shrinks the cards until a whole novel fits on one screen, and the old list is one click away. Pantsers can ignore all of it or learn to draw a freakin' map for the first time. Try it. You might like it!

**Cover Art** 

Every book gets a cover! New books are dressed in a seeded abstract (six art styles, six type templates, typefaces bundled with NEO) so no two stories on the shelf look alike. Once a story passes 1,000 words, NEO can read it and paint an abstract cover from the text. This is a bit more work but totally worth it. Get an OpenAI API key from their website and paste it into **File → Cover Art…**. The art is generated in the background for about a penny a picture. (These are not meant for publication, just writing inspiration!) The API key is stored encrypted in NEO's own settings, never in your library folder. The title and author are always set in real type on top, so the lettering is never left to a gen-AI model. The ↻ on any book re-rolls its type and colors, or paints it again. And you can always switch back and forth from the seeded modern look to the painted variety.

**Goals and momentum** 

Daily word goals, word sprints, and a NaNoWriMo-style progress chart. Needs more testing, but I think it works okay!

**A shelf can become one book** 

Right-click a shelf's name and choose **Bind into one book** for an omnibus, a trilogy, or a story collection. Hover over the bound shelf and the pages a published book carries show up faintly in their places: copyright, dedication, epigraph, prologue, epilogue, acknowledgments, about the author. A small + before each title starts a Part. Click a page and type it the way it will print; a prologue or epilogue opens in the editor like any story. The export is one EPUB, Word file, or PDF with a single cover and one table of contents, and chapters can number straight through the whole book. Unbind any time. Nothing is lost.

**Screenplays, too!**

A lot of you have asked for this feature, so here it is! Right-click the + on any shelf and choose **New Script**. Scripts sit on the same shelves as your books, on white card stock with two brass brads. Inside, the page is set the way it will print: Courier Prime, pages, page numbers, a proper title page.

You never have to pick a formatting element. Start a line with INT. or EXT. and it's a scene heading. Type a name in capitals, hit Enter, and the next line is dialogue. Hit Enter twice after a speech and you're on the next speaker, with whoever is being answered already there in gray. Tab or Enter fills it in. ⌘1 through ⌘7 will let you pick an element yourself, the same keys Final Draft uses. The left panel lists your scenes and how long each one runs, in eighths of a page. Drag a scene to move it. (CONT'D) happens automatically. The Outline tab lays every scene out as an index card: its heading, its length, who's in it, and a note you can write on it. Drag the cards to restructure the script, or start a script as a stack of cards and write it from there.

Export an industry-format PDF, or a Fountain or Final Draft (.fdx) file. Drop a .fountain or .fdx file on a shelf to import a script. Notes, Darlings, placeholders, sprints, and NEO Pocket all work the same as they do for books.

**Academic papers**

Right-click the + on a shelf and choose **New Paper**. The title page holds the title, the authors (click them for affiliations, email and ORCID iDs), the abstract with its word count, and keywords. The empty abstract lays out the six moves a good one makes (status quo, the problem with it, the broader solution, what you did, what you found, what it means), and while you write it they stay underneath as a faint reminder, each ticked once a sentence makes it. Counts sit beside the title, the abstract and (in the left panel) the main text, against the usual limits of the journal you're writing for. A new paper starts as Introduction, Methods, Results and Discussion plus the back matter journals ask for, each empty section saying what it's for. Type `#` at the start of a line for a numbered section, `##` and `###` for the levels below.

Type `@` to cite: a few letters of an author, a year or a title word find the reference, and Enter cites it. With Zotero open, `@` searches your Zotero library too, and citing from it adds the reference to the paper. `@` again right after joins the same citation. Paste a DOI or an arXiv ID after the `@` and NEO looks it up, adds it to the paper's references and cites it. Click a citation to add a page number, a "see", or to name the authors in the sentence. The reference list sets itself at the end, in APA, Chicago, Harvard, MLA, IEEE, Vancouver, Nature or AMA (Format → Citation Style), or any journal's style from the Zotero Style Repository. The References tab takes BibTeX, RIS and CSL JSON from Zotero, Mendeley, EndNote or a publisher's download button, and can link the .bib file Zotero's Better BibTeX keeps up to date.

`$x^2$` is maths, and a line of `$$…$$` is a numbered equation (TeX, drawn by MathJax); click either to edit its TeX right there in the line, drawn live as you type. Drop or paste a picture for a numbered figure, and drop another onto it for panels (a), (b). Hover a figure to set its width, wrap text beside it, or say where it may go when printed, as LaTeX does (here, top, bottom, a page of its own, or pinned exactly in place). Paste from a spreadsheet for a table. `@fig`, `@tab`, `@eq` and `@sec` refer to them, and the numbers follow when things move. The left panel lists the sections; drag one to move it, subsections and all.

Format → Journal sets the paper for Nature, Science, PNAS, Cell Press, PLOS, eLife, IEEE, ACM, NeurIPS, Springer LNCS, Elsevier or Physical Review, with that journal's citation style. File → Preview (⌥⌘P) shows the paper as the journal prints it, and keeps up as you write, opening at the page you're working on; Preview As shows it in any other journal's layout. File → Draft for Feedback sends a PDF or Word copy that opens by asking for the kind of feedback you want: top-level, coarse-grained or fine-grained. A paper exports as a PDF; a Word file whose equations are Word's own (editable there), laid out for the journal; LaTeX that opens in Overleaf as it is (in the journal's own class, with a references.bib); Markdown, as one file with its references and pictures inside it or as a folder for Pandoc and Quarto; EPUB; plain text; or a web page.

**Exports** 

EPUB 3 with a proper table of contents built to KDP's guidelines, Word .docx, PDF with page numbers and bookmarks, HTML, markdown, and plain text. Email a timestamped PDF snapshot to yourself with a SHA-256 fingerprint of the text in the body. Might come in handy someday.

**Import** 

Bring in existing .docx, .txt, and .md manuscripts; chapters and scene breaks are detected automatically. This is still a bit rough and might require you to tweak things. It will try to grab your title and remove that from the body, and it seems to be working okay.

**Backups** 

Continuous autosave, daily zip backups kept for two weeks, everything stored as plain files. Set up your NEO library folder on your iCloud if you want for extra safety. You can also email copies of your WIP to yourself with a keystroke: ⌘E.

## Your files

Everything lives in `~/Documents/NEO Library` — one folder per book, chapters as readable HTML, metadata as JSON. Open them in your favorite text editor.

## Languages

NEO speaks English, French, Spanish, Portuguese, German, Italian, Dutch, Polish, Romanian and Russian. Pick one under **View → Language**; on first launch NEO follows your system language when it has it. Adding a language is a single file, no programming needed: see [TRANSLATING.md](TRANSLATING.md).

## Building from source (for the eggheads):

Requires [Node.js](https://nodejs.org).

```
git clone https://github.com/hughhowey/neo.git
cd neo
npm install
npm start
```

**View → Keyboard Shortcuts…** opens the shortcut reference. You can also press `Cmd+/` on macOS or `Ctrl+/` on Windows and Linux, or use **Help → NEO Shortcuts**.

To build installers: `npm install electron-builder --save-dev`, then `npm run package` (macOS, also `npm run package:mac`), `npm run package:win` (Windows), or `npm run package:all`. Output lands in `dist/`.

The app is very simple: an Electron shell (`main.js`), a preload bridge (`preload.js`), and a renderer (`app.js` + `styles.css` + `index.html`). If you know JavaScript, you can change NEO. Have at it.

## Roadmap (things I'm dreaming up but may never get to):

Chapter version history · manuscript format for agent submissions (Times New Roman, double-spaced, address block, just to make Kristin Nelson happy) · global end matter that updates every book at once (same for copyright pages, bios, etc).

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Fair warning: NEO is opinionated by design, and bloat killed every writing app I've ever tried. If you want complex, try Scrivener. It really is a great application beloved by many! There are so many wonderful writing apps out there! Nobody needs to use this but me.

## License

[MIT](LICENSE) — free to use, free to modify, free to share.

## Philosophy

If you didn't know, I opened up the Silo universe to fan fiction years ago. And not just to put on fan fiction sites, but you can charge money for the things you write and keep every penny of the income! Lots of incredible Silo Stories out there. But readers are forever looking for more.
