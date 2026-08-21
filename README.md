# NEO

**A distraction-free word processor for authors, by a wannabe author.**

NEO understands from the moment you install it that you are writing *books* and nothing else. No bloat, no distractions, with manuscripts that look like books as you write them.

NEO runs locally. WIPs are saved in plain files on your disk. No accounts or subscriptions. And it's free!

## Download

Get the latest installer from the **[Releases page](../../releases)**:

- **macOS** — download the `.dmg`, open it, drag NEO to Applications.
- **Windows** — download the `.exe` and run it. Or get the setup installer and run that.

## Why NEO?

**The bookshelf** Your library looks like a bookshelf, not a file list. Labeled shelves you organize however you like — by series, by status, by pen name. Progress bars on the covers show how far you are from your word goals. You can drag-and-drop books anywhere. You can also drag shelves around and put cover art on your titles.

**Just a blank page** There's a white page by default or a dark mode (which I now prefer!). Controls fade until you mouse over them. Chapters number and renumber themselves automatically. Drop caps mark chapter openings, because I'm a sucker for drop-caps. Em dashes, true ellipses, and curly quotes sort themselves out as you type. Spellcheck exists only when you invoke it — no more red squiggles mid-sentence triggering your imposter syndrome.

**Enter, Enter, Enter** One Enter: new paragraph. Two: a `***` section break. Three: a new chapter. The goal is to KEEP WRITING.

**Darlings** The writing advice is "kill your darlings" — but I say: *keep the bodies*. Drag any beautiful-but-in-the-way passage onto the Darlings tab. It leaves your manuscript but isn't lost. Darlings restore to the exact spot it came from. More like zombies than darlings.

**Placeholders** Mid-flow and need a name, a fact, a date? ⌘⇧X drops a mark and a sticky note. The left panel shows a red dot on every chapter that you need to get back to. The right panel will list all these to-do items.

**Outlining for plotters** Outline chapters and sections in the Outline tab; section notes appear in the manuscript as gray ghost paragraphs, ready to be overwritten. Pantsers can ignore all of it or learn to draw a freakin' map for the first time. Try it. You might like it!

**Cover Art** Whether you already have a cover in mind, want to whip up something in Canva or Photoshop, or are okay with using AI art either as placeholder or final file, NEO is happy to accept it. Drag your 2:3 ratio art right on the book in your bookshelf. I've always done this as a habit, having the cover art early. Seeing the book inspires me to work on it daily and make it better!

**Goals and momentum** Daily word goals, word sprints, and a NaNoWriMo-style progress chart. Needs more testing, but I think it works okay!

**Exports** EPUB 3 with a proper table of contents built to KDP's guidelines, Word .docx, PDF, HTML, markdown, and plain text. Email a timestamped PDF snapshot to yourself with a SHA-256 fingerprint of the text in the body. Might come in handy someday.

**Import** Bring in existing .docx, .txt, and .md manuscripts; chapters and scene breaks are detected automatically. This is still a bit rough and might require you to tweak things. It will try to grab your title and remove that from the body, and it seems to be working okay.

**Backups** Continuous autosave, daily zip backups kept for two weeks, everything stored as plain files. Set up your NEO library folder on your iCloud if you want for extra safety. You can also email copies of your WIP to yourself with a keystroke: ⌘E.

## Your files

Everything lives in `~/Documents/NEO Library` — one folder per book, chapters as readable HTML, metadata as JSON. Open them in your favorite text editor.

## Building from source (for the eggheads):

Requires [Node.js](https://nodejs.org).

```
git clone https://github.com/hughhowey/neo.git
cd neo
npm install
npm start
```

To build installers: `npm install electron-builder --save-dev`, then `npm run package` (macOS), `npm run package:win` (Windows), or `npm run package:all`. Output lands in `dist/`.

The app is very simple: an Electron shell (`main.js`), a preload bridge (`preload.js`), and a renderer (`app.js` + `styles.css` + `index.html`). If you know JavaScript, you can change NEO. Have at it.

## Roadmap (things I'm dreaming up but may never get to):

Chapter version history · manuscript format for agent submissions (Times New Roman, double-spaced, address block, just to make Kristin Nelson happy) · custom cover art (auto-generated based on the text so far, refreshable if you don't like it. · global end matter that updates every book at once (same for copyright pages, bios, etc).

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Fair warning: NEO is opinionated by design, and bloat killed every writing app I've ever tried. If you want complex, try Scrivener. It really is a great application beloved by many! There are so many wonderful writing apps out there! Nobody needs to use this but me.

## License

[MIT](LICENSE) — free to use, free to modify, free to share.

## Philosophy

If you didn't know, I opened up the Silo universe to fan fiction years ago. And not just to put on fan fiction sites, but you can charge money for the things you write and keep every penny of the income! Lots of incredible Silo Stories out there. But readers are forever looking for more.
