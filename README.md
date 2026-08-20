# NEO

**A distraction-free word processor for authors, by a wannabe author.**

NEO understands from the moment you install it that you are writing *books* — not blog posts, not school reports, not slide decks. It was designed by an annoyed novelist who tried every writing app on the market and decided to build the one he actually wanted. No bloat, less confusion, no distractions, with manuscripts that look like books (because they will be)!

NEO runs entirely on your machine. Your words live in plain, readable files on your own disk. No accounts or subscription. And it's free!

## Download

Grab the latest installer from the **[Releases page](../../releases)**:

- **macOS** — download the `.dmg`, open it, drag NEO to Applications.
- **Windows** — download the `.exe` and run it. Or get the setup installer and run that.

## What makes NEO different

**The bookshelf.** Your library looks like a bookshelf, not a file list. Labeled shelves you organize however you like — by series, by status, by pen name. Progress bars on the covers show how far you are from your word goals. You can drag-and-drop books anywhere. You can also drag shelves around and put cover art on your titles.

**A page, and not much else.** There's a white page by default or a dark mode (which I now prefer!). Controls fade until you reach for them. Chapters number and renumber themselves automatically. Drop caps mark chapter openings, because I'm a sucker for drop-caps. Em dashes, true ellipses, and curly quotes sort themselves out as you type. Spellcheck exists only as a deliberate pass you invoke when *you're* ready — never a red squiggle mid-sentence triggering your imposter syndrome.

**Enter, Enter, Enter.** One Enter: new paragraph. Two: a `***` section break. Three: a new chapter. The goal is to KEEP WRITING.

**Darlings.** The old writing advice is "kill your darlings" — but NEO says: *keep the bodies*. Drag any beautiful-but-in-the-way passage onto the Darlings tab. It leaves your manuscript but is never lost, and restores to the exact spot it came from. More like zombies than darlings, amirite?!

**Placeholders.** Mid-flow and need a name, a fact, a date? ⌘⇧X drops a mark and a sticky note, and you keep writing. The left panel shows a red dot on every chapter that you need to get back to.

**Outlining that becomes the book.** Outline chapters and sections in the Outline tab; section notes appear in the manuscript as gray ghost paragraphs, ready to be overwritten. Pantsers can ignore all of it or learn to draw a freakin' map for the first time. Try it. You might like it!

**Cover Art.** Whether you already have a cover in mind, want to whip up something in Canva or Photoshop, or are okay with using AI art either as placeholder or final file, NEO is happy to accept it all. Drag your 2:3 ratio art right on the book in your bookshelf. I've always done this as a habit, having the cover art early. Seeing the book inspires me to work on it daily and make it better!

**Goals and momentum.** Daily word goals, word sprints, and a NaNoWriMo-style progress chart. Needs more testing, but I think it works okay!

**Real exports.** EPUB 3 with a proper table of contents built to KDP's guidelines, Word .docx, PDF, HTML, markdown, and plain text. Email a timestamped PDF snapshot to yourself with a SHA-256 fingerprint of the text in the body. Might come in handy someday.

**Import.** Bring in existing .docx, .txt, and .md manuscripts; chapters and scene breaks are detected automatically. This is still a bit rough and might require you to tweak things. NEO is more intended for new projects than importing, but I did this so I can play around with some old stories in a new environment.

**Safety net.** Continuous autosave, daily zip backups kept for two weeks, everything stored as plain files. Set up your NEO library folder on your iCloud if you want.

## Your files are yours

Everything lives in `~/Documents/NEO Library` — a folder per book, chapters as readable HTML, metadata as JSON. Open them in any text editor.

## Building from source (for the eggheads):

Requires [Node.js](https://nodejs.org).

```
git clone https://github.com/hughhowey/neo.git
cd neo
npm install
npm start
```

To build installers: `npm install electron-builder --save-dev`, then `npm run package` (macOS), `npm run package:win` (Windows), or `npm run package:all`. Output lands in `dist/`.

The app is deliberately simple: an Electron shell (`main.js`), a preload bridge (`preload.js`), and a single-file renderer (`app.js` + `styles.css` + `index.html`). If you can read JavaScript, you can change NEO. Have at it. Build me a better mousetrap.

## Roadmap (things I'm dreaming up but may never get to):

Chapter version history · manuscript format for agent submissions (Times New Roman, double-spaced, address block, just to make Kristin Nelson happy) · custom cover art (auto-generated based on the text so far, refreshable if you don't like it. Not intended for publication, just to make the bookshelf purty) · global end matter that updates every book at once (same for copyright pages, bios, etc) · submission tracking · auto-updates.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Fair warning from the project's founding principle: NEO is opinionated by design, and bloat killed every writing app I've ever tried. If you want complex, try Scrivener. It really is a great application beloved by many! There are so many wonderful writing apps out there! Nobody needs to use this but me.

## License

[MIT](LICENSE) — free to use, free to modify, free to share. Now go write.

## Philosophy

If you didn't know, I opened up the Silo universe to fan fiction years ago. And not just to put on fan fiction sites, but you can charge money for the things you write and keep every penny of the income! Lots of incredible Silo Stories out there. But readers are forever looking for more.
