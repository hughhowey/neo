// End-to-end tests for subheadings and block quotes (#484, #206): Format →
// Subheading and Format → Block Quote on the page, Enter and Backspace in
// them, ⌘Z, the drop cap past a subheading, and every export: the PDF and
// web page, the paperback, EPUB, Word (read back by NEO's own import),
// Markdown, plain text and Manuscript Format.
// Run with `npm run test:subheads`; NEO_SHOT=<file.png> keeps a picture.

'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const JSZip = require('jszip');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-subhead-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-subhead-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const lib = path.join(tmp, 'NEO Library');
fs.mkdirSync(lib);
fs.writeFileSync(path.join(lib, 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, moreFeatures: true, pageTheme: 'night',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await tick(100); } throw new Error('timed out'); };
const OUT = process.env.NEO_OUT || path.join(tmp, 'out');
fs.mkdirSync(OUT, { recursive: true });
const saveTo = (name) => { const to = path.join(OUT, name); try { fs.unlinkSync(to); } catch { /* new */ } dialog.showSaveDialog = async () => ({ canceled: false, filePath: to }); return to; };
const exported = async (format, name) => {
  const to = saveTo(name);
  await js(`doExport(${JSON.stringify(format)})`);
  await until(() => fs.existsSync(to) && fs.statSync(to).size > 0, 120000);
  await tick(300);
  return to;
};

const key = async (keyCode, modifiers = []) => {
  for (const type of ['keyDown', 'char', 'keyUp']) {
    if (type === 'char' && (modifiers.length || keyCode.length > 1)) continue;
    wc.sendInputEvent({ type, keyCode, modifiers });
  }
  await tick(150);
};
const type = async (text) => { wc.insertText(text); await tick(120); };
// the first chapter's paragraphs: their classes and words
const body = `document.querySelector('.chapter[data-id="' + book.chapterOrder[0] + '"] .chapter-body')`;
const paras = () => js(`[...${body}.children].map((p) => (p.className ? '[' + p.className + '] ' : '') + p.textContent)`);
// the caret in paragraph n, at offset (or at its end)
const caretAt = (n, offset = null) => js(`(() => {
  const p = ${body}.children[${n}];
  const tn = [...p.childNodes].filter((x) => x.nodeType === 3).pop() || p;
  const r = document.createRange();
  if (tn.nodeType === 3) r.setStart(tn, ${offset === null ? 'tn.length' : offset}); else r.setStart(p, 0);
  r.collapse(true);
  ${body}.focus();
  getSelection().removeAllRanges();
  getSelection().addRange(r);
  currentChapterId = book.chapterOrder[0];
})()`);
const saved = () => js(`(() => { syncChapter(${body}, book.chapterOrder[0]); return chapterHTML[book.chapterOrder[0]]; })()`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('the feature is off in a new library, and its menu items with it', async () => {
  assert.equal(await js(`featureOn('subheads')`), false);
  assert.ok(await js(`FEATURES.some((f) => f.key === 'subheads' && !f.pocket)`));
  await js(`library.features.subheads = true; reportFeatures()`);
  assert.equal(await js(`featureOn('subheads')`), true);
});

test('Format → Subheading makes the caret’s paragraph a subheading, set apart, the prose under it flush', async () => {
  await caretAt(1, 3);
  await js(`toggleSubhead()`);
  await tick(150);
  assert.deepEqual((await paras()).slice(0, 3), ['The ferry crossed at first light.', '[subhead] Late July 1943', 'The convoy left at dawn.']);
  assert.match(await saved(), /<p class="subhead">Late July 1943<\/p>/);
  assert.equal(await js(`getComputedStyle(${body}.children[1]).fontWeight`), '600');
  assert.equal(await js(`getComputedStyle(${body}.children[1]).textIndent`), '0px');
  assert.equal(await js(`getComputedStyle(${body}.children[2]).textIndent`), '0px', 'the line under it starts flush');
  assert.notEqual(await js(`getComputedStyle(${body}.children[3]).textIndent`), '0px', 'the next one is indented again');
});

test('the Format menu ticks Subheading while the caret is in one', async () => {
  await caretAt(1, 2);
  await tick(200);
  const ticks = () => {
    const fmt = require('electron').Menu.getApplicationMenu().items.find((m) => m.label === 'Format');
    const item = (l) => fmt.submenu.items.find((x) => x.label === l);
    return [item('Subheading').checked, item('Block Quote').checked];
  };
  await until(async () => ticks()[0] === true, 3000);
  assert.deepEqual(ticks(), [true, false]);
  await caretAt(0, 2);
  await until(async () => ticks()[0] === false, 3000);
});

test('Enter at a subheading’s end goes on in prose; at its start, a line opens above it', async () => {
  await caretAt(1);
  await key('Return');
  await type('A plain line.');
  assert.deepEqual((await paras()).slice(1, 4), ['[subhead] Late July 1943', 'A plain line.', 'The convoy left at dawn.']);
  await caretAt(1, 0);
  await key('Return');
  assert.deepEqual((await paras()).slice(1, 4), ['', '[subhead] Late July 1943', 'A plain line.'], 'the subheading keeps its words and its kind');
  await key('Backspace'); // the caret stayed in the subheading: Backspace there makes it prose
  assert.equal((await paras())[2], 'Late July 1943');
  await js(`structuralUndo()`);
  await tick(300);
  assert.equal((await paras())[2], '[subhead] Late July 1943', '⌘Z gives the kind back');
  await js(`structuralUndo()`);
  await tick(300);
  assert.deepEqual((await paras()).slice(1, 3), ['[subhead] Late July 1943', 'A plain line.'], 'and takes the line above away');
});

test('Format → Block Quote sets the paragraphs the selection touches as one quote', async () => {
  await js(`(() => {
    const b = ${body};
    const r = document.createRange();
    r.setStart(b.children[3].firstChild, 2);
    r.setEnd(b.children[4].firstChild, 2);
    b.focus(); getSelection().removeAllRanges(); getSelection().addRange(r);
  })()`);
  await js(`toggleQuote()`);
  await tick(150);
  assert.deepEqual((await paras()).slice(3, 6), ['[quote] The convoy left at dawn.', '[quote] It did not stop until the river.', 'The ferryman was asleep.']);
  assert.notEqual(await js(`getComputedStyle(${body}.children[3]).marginLeft`), '0px', 'set in');
  assert.equal(await js(`getComputedStyle(${body}.children[3]).fontStyle`), 'normal', 'upright, not poetry’s italic');
  assert.notEqual(await js(`getComputedStyle(${body}.children[4]).textIndent`), '0px', 'its second paragraph indented, as in a book');
});

test('Enter in a quote is its next paragraph; Enter on an empty one steps out', async () => {
  await caretAt(4);
  await key('Return');
  await type('Nobody spoke.');
  assert.equal((await paras())[5], '[quote] Nobody spoke.');
  await key('Return');
  await key('Return');
  await type('Back in the story.');
  assert.deepEqual((await paras()).slice(5, 8), ['[quote] Nobody spoke.', 'Back in the story.', 'The ferryman was asleep.']);
  // Backspace at a quote paragraph's start makes it prose
  await caretAt(5, 0);
  await key('Backspace');
  assert.equal((await paras())[5], 'Nobody spoke.');
  await js(`structuralUndo()`);
  await tick(300);
  assert.equal((await paras())[5], '[quote] Nobody spoke.');
});

test('Block Quote again takes it off; a page (not the story) refuses both', async () => {
  await caretAt(3, 1);
  await js(`toggleQuote()`);
  await tick(100);
  assert.equal((await paras())[3], 'The convoy left at dawn.', 'the one the caret is in');
  await js(`toggleQuote()`);
  await tick(100);
  assert.equal((await paras())[3], '[quote] The convoy left at dawn.');
  const kinds = await js(`(async () => {
    const id = book.chapterOrder.find((c) => chapterKind(c) === 'dedication');
    const p = document.querySelector('.chapter[data-id="' + id + '"] .chapter-body p');
    const r = document.createRange(); r.setStart(p.firstChild, 1); r.collapse(true);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    toggleSubhead();
    return p.className;
  })()`);
  assert.equal(kinds, '');
});

test('a chapter that opens on a subheading gives its drop cap to the first line of prose', async () => {
  await js(`(() => {
    const b = document.querySelector('.chapter[data-id="' + book.chapterOrder[1] + '"] .chapter-body');
    b.children[0].classList.add('subhead');
    syncChapter(b, book.chapterOrder[1]);
  })()`);
  await tick(200);
  assert.equal(await js(`openingPara(document.querySelector('.chapter[data-id="' + book.chapterOrder[1] + '"] .chapter-body')).textContent`), 'The city rose out of the salt flats.');
  if (process.env.NEO_SHOT) { await js(`document.querySelector('.chapter[data-id="' + book.chapterOrder[0] + '"]').scrollIntoView()`); await tick(300); fs.writeFileSync(process.env.NEO_SHOT, (await wc.capturePage()).toPNG()); }
});

test('the PDF and web page: a heading under the chapter’s, the quote as one block', async () => {
  await js(`flushAllSaves()`);
  const html = await js(`buildHtml(bookExportData())`);
  assert.match(html, /<h3 class="subhead">Late July 1943<\/h3>/);
  assert.match(html, /<p class="quote q-top">The convoy left at dawn\.<\/p>\s*<p class="quote q-cont">It did not stop until the river\.<\/p>\s*<p class="quote q-cont q-end">Nobody spoke\.<\/p>/);
  assert.match(html, /h3\.subhead \+ p \{ text-indent: 0; \}/);
});

test('the paperback: the subheading kept with its lines, the next one flush, the quote hyphenated as prose', async () => {
  const html = await js(`buildPrintHtml(bookExportData(), { trim: '5.5x8.5', paper: 'cream', links: {}, alsoByText: '', reviewText: '', reviewWords: '' })`);
  assert.match(html, /<h3 class="subhead">Late July 1943<\/h3>\s*<p class="hy flush">A plain line\.<\/p>/);
  assert.match(html, /<p class="hy quote q-top">The convoy/);
  assert.match(html, /h3\.subhead \{[^}]*break-after: avoid/);
  // the second chapter's drop cap is on its prose, past the subheading
  assert.match(html, /<h3 class="subhead">The salt flats<\/h3>\s*<p class="hy first[^"]*">The city rose/);
});

test('EPUB: the subheading one level under the chapter, the quote’s paragraphs marked', async () => {
  const entries = await js(`buildEpubEntries(bookExportData()).then((e) => e.map((x) => ({ path: x.path, content: typeof x.content === 'string' ? x.content : '' })))`);
  const ch = entries.filter((e) => /OEBPS\/.*\.xhtml$/.test(e.path)).map((e) => e.content).find((c) => c.includes('Late July 1943'));
  assert.ok(ch, 'the chapter file');
  assert.match(ch, /<h1>[^]*<\/h1>[^]*<h2 class="subhead">Late July 1943<\/h2>\s*<p class="first">A plain line\.<\/p>/);
  assert.match(ch, /<p class="quote q-top">The convoy left at dawn\.<\/p>/);
  const css = entries.find((e) => e.path === 'OEBPS/style.css').content;
  assert.match(css, /h2\.subhead \{/);
  assert.match(css, /p\.quote\.q-cont \{ text-indent: 1\.2em; \}/);
});

test('Word: a Subheading and a Quote style, and NEO’s own import keeps the chapters whole', async () => {
  const to = await exported('docx', 'subheads.docx');
  const zip = await JSZip.loadAsync(fs.readFileSync(to));
  const doc = await zip.file('word/document.xml').async('string');
  const styles = await zip.file('word/styles.xml').async('string');
  assert.match(doc, /<w:pStyle w:val="Subheading"\/>.*?Late July 1943/);
  assert.match(doc, /<w:pStyle w:val="Quote"\/>.*?The convoy left at dawn/);
  assert.match(doc, /<w:pStyle w:val="BodyTextNoIndent"\/><\/w:pPr><w:r><w:t xml:space="preserve">A plain line\./, 'the line under it flush');
  assert.match(styles, /w:styleId="Subheading"[^]*?<w:outlineLvl w:val="3"\/>/);
  assert.match(styles, /w:styleId="Quote"[^]*?<w:contextualSpacing\/>/);
  const back = await js(`window.neo.importFiles([${JSON.stringify(to)}])`);
  const book1 = back[0];
  const titles = book1.chapters.map((c) => c.title);
  assert.ok(!titles.includes('Late July 1943'), 'no chapter starts at a subheading: ' + titles.join(' / '));
  assert.ok(JSON.stringify(book1).includes('Late July 1943'), 'its words are there');
});

test('Markdown, plain text and Manuscript Format', async () => {
  const md = await js(`buildMd(bookExportData())`);
  assert.match(md, /### Late July 1943\n\nA plain line\./);
  assert.match(md, /> The convoy left at dawn\.\n\n> It did not stop/);
  const txt = await js(`buildTxt(bookExportData())`);
  assert.match(txt, /\n {4}The convoy left at dawn\./);
  assert.match(txt, /\nLate July 1943\n\nA plain line\./);
  const ms = await js(`NeoManuscript.html(manuscriptModel(manuscriptDefaults(), manuscriptSections()))`);
  assert.match(ms, /<p class="subhead">Late July 1943<\/p>\s*<p class="flush">A plain line\.<\/p>/);
  assert.match(ms, /<p class="quote">The convoy left at dawn\.<\/p>/);
  const entries = await js(`NeoManuscript.docxEntries(manuscriptModel(manuscriptDefaults(), manuscriptSections())).map((e) => ({ path: e.path, content: typeof e.content === 'string' ? e.content : '' }))`);
  const mdoc = entries.find((e) => e.path === 'word/document.xml').content;
  assert.match(mdoc, /<w:pStyle w:val="Subheading"\/>.*?Late July 1943/);
  assert.match(mdoc, /<w:pStyle w:val="Quote"\/>.*?The convoy left/);
});

if (process.env.NEO_OUT) {
  test('(the PDF and paperback, kept for a look)', async () => {
    await exported('pdf', 'subheads.pdf');
    for (const [name, code] of [['pdf-page', 'buildHtml(bookExportData())'], ['paperback-page', "buildPrintHtml(bookExportData(), { trim: '5.5x8.5', paper: 'cream', links: {}, alsoByText: '', reviewText: '', reviewWords: '' }).replace(/__NEO_GUTTER__/g, '0.75in')"]]) {
      const file = path.join(OUT, name + '.html');
      fs.writeFileSync(file, await js(code));
      const w = new BrowserWindow({ show: false, width: 700, height: 1000, webPreferences: { offscreen: true } });
      await w.loadFile(file);
      await tick(800);
      await w.webContents.executeJavaScript(`(document.querySelector('.subhead') || document.body).scrollIntoView()`);
      await tick(300);
      fs.writeFileSync(path.join(OUT, name + '.png'), (await w.webContents.capturePage()).toPNG());
      w.destroy();
    }
    const to = saveTo('subheads-paperback.pdf');
    await js(`(() => { window.__pb = printPaperback(); })()`);
    await until(() => js(`!!document.querySelector('.modal-backdrop .m-ok')`));
    await js(`document.querySelector('.modal-backdrop .m-ok').click()`);
    await until(() => fs.existsSync(to) && fs.statSync(to).size > 0, 240000);
  });
}

test('with the feature off, the menu items go but what the book holds stays as it is', async () => {
  await js(`library.features.subheads = false; reportFeatures()`);
  await tick(300);
  const fmt = require('electron').Menu.getApplicationMenu().items.find((m) => m.label === 'Format');
  assert.equal(fmt.submenu.items.some((x) => x.label === 'Subheading' || x.label === 'Block Quote'), false);
  assert.equal((await paras())[1], '[subhead] Late July 1943');
  assert.match(await js(`buildHtml(bookExportData())`), /<h3 class="subhead">Late July 1943<\/h3>/);
});

/* ---------- runner ---------- */

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    wc.on('console-message', (e, level, msg) => { const m = (e && e.message) || msg; const l = e && e.level !== undefined ? e.level : level; if (l === 'error' || l === 3) console.log('     [window] ' + m); });
    while (!(await js(`typeof library !== 'undefined' && !!library && !!library.features`).catch(() => false))) await tick(50);
    await tick(300);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      // a library made new has every feature off
      library.features.subheads = false;
      reportFeatures();
      const p = (text) => ({ text });
      await addImportedBooks([{ name: 'The Lantern Year', chapters: [
        { title: 'Deployment', paras: [p('The ferry crossed at first light.'), p('Late July 1943'), p('The convoy left at dawn.'), p('It did not stop until the river.'), p('The ferryman was asleep.')] },
        { title: 'Varga', paras: [p('The salt flats'), p('The city rose out of the salt flats.'), p('All its towers leaned.')] }
      ] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
      // and a dedication page, which takes neither
      const chId = newEntryId();
      book.chapterOrder.unshift(chId);
      setChapterKind(chId, 'dedication');
      chapterHTML[chId] = '<p>For the ferrymen.</p>';
      await persistChapter(chId);
      await saveMeta();
      renderChapters();
    })()`);
    await tick(600);
    // the story's first chapter is chapterOrder[1] now; the tests read the story's
    await js(`(() => { const ded = book.chapterOrder.shift(); book.chapterOrder.push(ded); renderChapters(); })()`);
    await tick(400);
    win.focus();
    for (const t of tests) {
      try {
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.message).replace(/\n/g, '\n     '));
      }
    }
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    app.exit(failed ? 1 : 0);
  }
}
main();
