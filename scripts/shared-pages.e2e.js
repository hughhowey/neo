'use strict';

// Shared pages through the actual dialog, library files and export writers.
// Run: npx electron scripts/shared-pages.e2e.js
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const JSZip = require('jszip');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-shared-pages-'));
const lib = path.join(tmp, 'NEO Library');
fs.mkdirSync(lib);
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.writeFileSync(path.join(lib, 'library.json'), JSON.stringify({
  authorName: 'A Writer', authors: [{ id: 'a1', name: 'A Writer' }],
  firstRunDone: true, features: { penNames: true }, hintShown: true,
  shelves: [{ id: 's1', name: 'Books', bookIds: [] }]
}));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
dialog.showSaveDialog = async (_win, opts) => ({ canceled: false, filePath: path.join(tmp, path.basename(opts.defaultPath)) });
require('../main.js');
let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
async function until(check) {
  const end = Date.now() + 30000;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('Timed out: ' + check);
    await tick();
  }
}
const D = "document.getElementById('shared-pages-dialog')";
async function openDialog() {
  await js(`(() => { window.__sharedDialog = sharedPagesDialog('a1'); })()`);
  await until(() => js(`!!${D}`));
}
const fill = (kind, text) => js(`${D}.querySelector('[data-kind="${kind}"]').value = ${JSON.stringify(text)}`);
async function save() {
  await js(`${D}.querySelector('.m-save').click()`);
  await until(() => js(`!${D}`));
}
const tests = [];
const test = (name, run) => tests.push({ name, run });
let ids, originalChapters;
function chapterFiles() {
  return ids.flatMap((id) => fs.readdirSync(path.join(lib, id, 'chapters')).filter((n) => n.endsWith('.html'))
    .map((n) => { const file = path.join(lib, id, 'chapters', n); return [file, fs.readFileSync(file, 'utf8'), fs.statSync(file).mtimeMs]; }));
}

test('the author menu offers shared pages only with Pen names turned on', async () => {
  for (const more of [false, true]) {
    await js(`library.features = { ...library.features, penNames: ${more} }; document.getElementById('author-chip').click()`);
    await until(() => js("!!document.querySelector('.modal-backdrop')"));
    assert.equal(await js("[...document.querySelectorAll('.fr-choice')].some((b) => b.textContent.includes('Shared book pages'))"), more);
    await js("document.querySelector('.modal-backdrop .m-cancel').click()");
  }
});

test('the dialog saves plain text safely, with a labelled and focused editor', async () => {
  await openDialog();
  assert.equal(await js(`document.activeElement === ${D}.querySelector('textarea')`), true);
  assert.equal(await js(`${D}.querySelector('[role="dialog"]').getAttribute('aria-labelledby')`), 'shared-pages-title');
  await fill('copyright', 'Copyright {year} {author}\n\nAll rights reserved for {title}.');
  await fill('about', 'A Writer lives near the sea & writes <stories>.');
  if (process.env.NEO_TEST_SHOTS) {
    fs.mkdirSync(process.env.NEO_TEST_SHOTS, { recursive: true });
    await js('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(process.env.NEO_TEST_SHOTS, 'shared-pages-dialog.png'), (await wc.capturePage()).resize({ width: 1200 }).toPNG());
  }
  await save();
  const disk = JSON.parse(fs.readFileSync(path.join(lib, 'library.json'), 'utf8'));
  assert.equal(disk.authors[0].sharedPages.about, 'A Writer lives near the sea & writes <stories>.');
});

test('Word, EPUB, HTML, text and Markdown use shared pages with correct contents targets', async () => {
  await js(`openBook(${JSON.stringify(ids[0])})`);
  const d = await js('bookExportData()');
  assert.deepEqual(d.sections.map((s) => s.kind), ['copyright', 'chapter', 'about']);
  assert.deepEqual(d.toc.map((e) => e.num), [2, 3]);
  assert.match(d.sections[0].paras.map((p) => p.text).join(' '), /All rights reserved for First Book/);
  assert.match(d.sections[2].paras[0].text, /sea & writes <stories>/);
  for (const format of ['docx', 'epub', 'html', 'txt', 'md']) {
    await js(`doExport(${JSON.stringify(format)})`);
    const file = path.join(tmp, 'First-Book.' + format);
    assert.ok(fs.existsSync(file), format + ' saved');
    if (format === 'docx' || format === 'epub') {
      const zip = await JSZip.loadAsync(fs.readFileSync(file));
      const parts = await Promise.all(Object.values(zip.files).filter((f) => !f.dir && /\.(xml|xhtml)$/.test(f.name)).map((f) => f.async('string')));
      const content = parts.join('\n');
      assert.match(content, /All rights reserved for First Book/);
      assert.match(content, /sea &amp; writes &lt;stories&gt;/);
      if (format === 'epub') assert.match(content, /About the Author/);
    } else {
      const content = fs.readFileSync(file, 'utf8');
      assert.match(content, /All rights reserved for First Book/);
      assert.match(content, /A Writer lives near the sea/);
    }
  }
});

test('the actual PDF writer includes both shared pages', async () => {
  await js("doExport('pdf')");
  const file = path.join(tmp, 'First-Book.pdf');
  assert.ok(fs.existsSync(file), 'PDF saved');
  const text = execFileSync('pdftotext', [file, '-'], { encoding: 'utf8' });
  assert.match(text, /All rights reserved for First Book/);
  assert.match(text, /A Writer lives near the sea/);
});

test('manuscript and chapter-only exports omit shared book pages', async () => {
  const sections = await js('manuscriptSections()');
  assert.ok(!JSON.stringify(sections).includes('All rights reserved'));
  assert.ok(!JSON.stringify(sections).includes('lives near the sea'));
  const d = await js('chapterExportData(book.chapterOrder[0])');
  assert.deepEqual(d.sections.map((s) => s.kind), ['chapter']);
});

test('changing shared wording updates both books without rewriting their chapters', async () => {
  await js('backToShelf()');
  await openDialog();
  await fill('about', 'The revised shared biography.');
  await save();
  for (const id of ids) {
    await js(`openBook(${JSON.stringify(id)})`);
    const d = await js('bookExportData()');
    assert.equal(d.sections.at(-1).paras[0].text, 'The revised shared biography.');
    assert.ok(d.sections[0].paras.some((p) => p.text.includes(d.title)), 'title placeholder is this book’s');
  }
  assert.deepEqual(chapterFiles(), originalChapters);
});

test('a shelf anthology uses its pen name’s defaults once with correct contents numbers', async () => {
  const d = await js('shelfBookData(library.shelves[0])');
  assert.equal(d.sections.filter((s) => s.kind === 'copyright').length, 1);
  assert.equal(d.sections.filter((s) => s.kind === 'about').length, 1);
  for (const entry of d.toc) assert.ok(d.sections[entry.num - 1], 'valid contents target');
  assert.match(d.sections[0].paras.map((p) => p.text).join(' '), /All rights reserved for Books/);
});

test('an existing page overrides the shared text; an empty page suppresses it', async () => {
  await js(`openBook(${JSON.stringify(ids[0])})`);
  await js(`(() => {
    const about = addEntry(book.chapterOrder.length, 'about');
    chapterHTML[about] = '<p>Only this book’s biography.</p>';
    persistChapter(about); renderChapters();
    addEntry(0, 'copyright');
    const copyright = book.chapterOrder[0];
    chapterHTML[copyright] = '<p><br></p>'; persistChapter(copyright); renderChapters();
  })()`);
  const d = await js('bookExportData()');
  assert.equal(d.sections.filter((s) => s.kind === 'copyright').length, 0);
  assert.equal(d.sections.filter((s) => s.kind === 'about').length, 1);
  assert.equal(d.sections.at(-1).paras[0].text, 'Only this book’s biography.');
});

test('another pen name’s book does not inherit the selected author’s pages', async () => {
  await js(`(async () => {
    await backToShelf();
    library.authors.push({ id: 'a2', name: 'Other Writer', sharedPages: { about: 'Other Writer’s biography.' } });
    library.shelves[0].bookIds = [${JSON.stringify(ids[0])}];
    library.shelves.push({ id: 's2', name: 'Other Books', authorId: 'a2', bookIds: [${JSON.stringify(ids[1])}] });
    await writeLibrary(library);
    await openBook(${JSON.stringify(ids[1])});
  })()`);
  const d = await js('bookExportData()');
  assert.equal(d.sections.at(-1).paras[0].text, 'Other Writer’s biography.');
  assert.ok(!d.sections.some((s) => s.kind === 'copyright'));
});

test('previous wording survives reload and can be restored through the dialog', async () => {
  await js('backToShelf();');
  await js('loadLibrary()');
  await openDialog();
  assert.equal(await js(`${D}.querySelector('.shared-history').hidden`), false);
  await js(`${D}.querySelector('select').value = '0'; ${D}.querySelector('select').dispatchEvent(new Event('change'))`);
  assert.equal(await js(`${D}.querySelector('[data-kind="about"]').value`), 'A Writer lives near the sea & writes <stories>.');
  await save();
  const disk = JSON.parse(fs.readFileSync(path.join(lib, 'library.json'), 'utf8'));
  assert.equal(disk.authors[0].sharedPagesHistory.at(-1).pages.about, 'The revised shared biography.');
});

test('a failed save keeps the dialog’s words and leaves stored pages unchanged', async () => {
  await openDialog();
  await fill('about', 'Words waiting for disk space.');
  ipcMain.removeHandler('library:write');
  ipcMain.handle('library:write', () => { throw new Error('simulated disk full'); });
  const previous = fs.readFileSync(path.join(lib, 'library.json'), 'utf8');
  await js(`${D}.querySelector('.m-save').click()`);
  await until(() => js(`!${D}.querySelector('.shared-error').hidden`));
  assert.equal(await js(`${D}.querySelector('[data-kind="about"]').value`), 'Words waiting for disk space.');
  assert.match(await js(`${D}.querySelector('.shared-error').textContent`), /simulated disk full/);
  assert.equal(fs.readFileSync(path.join(lib, 'library.json'), 'utf8'), previous);
  await js(`${D}.querySelector('.m-cancel').click()`);
});

async function main() {
  let failed = 0;
  try {
    await app.whenReady();
    await until(async () => BrowserWindow.getAllWindows().length > 0);
    const win = BrowserWindow.getAllWindows()[0];
    wc = win.webContents;
    win.setBounds({ width: 1200, height: 900 });
    await until(() => js('typeof library !== "undefined" && !!library').catch(() => false));
    await js(`addImportedBooks(['First Book', 'Second Book'].map((title) => ({ name: title, title, chapters: [{ title: 'One', paras: [{ text: 'The harbor was quiet. The gulls rose over the sea.' }] }] })), library.shelves[0])`);
    ids = await js('library.shelves[0].bookIds');
    originalChapters = chapterFiles();
    for (const t of tests) {
      try { await t.run(); console.log('ok ' + t.name); }
      catch (err) { failed++; console.error('FAIL ' + t.name + '\n' + err.stack); }
    }
    console.log(`${tests.length - failed} passed, ${failed} failed; files: ${tmp}`);
  } catch (err) { failed++; console.error(err); }
  finally { app.exit(failed ? 1 : 0); }
}
main();
