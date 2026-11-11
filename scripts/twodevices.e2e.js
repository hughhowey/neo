// End-to-end tests for two devices writing in one library (a Mac and an iPad
// on iCloud, say). book.json holds the list of a book's chapters and is saved
// whole; a device that saved it without having seen the other's new chapter
// used to drop that chapter from the book, its words left in a file no list
// named (#526). NEO runs on a throwaway library and the "other device" is
// played by writing its files into the book's folder, the way a sync does.
// Run with `npm run test:twodevices`.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A folder of its own for each run (see words.e2e.js for why earlier runs'
// folders are the ones removed).
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-twodevices-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-twodevices-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, moreFeatures: true, pageTheme: 'night',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
// run from scripts/, NEO's window would look for scripts/index.html
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

const lib = path.join(tmp, 'NEO Library');
let dir; // the book's folder
const readMeta = () => JSON.parse(fs.readFileSync(path.join(dir, 'book.json'), 'utf8'));
// the other device's book.json lands (a sync hands the file over whole)
const theirBook = (meta) => fs.writeFileSync(path.join(dir, 'book.json'), JSON.stringify({ ...meta, modified: new Date(Date.now() + 1000).toISOString() }, null, 2));
const theirChapter = (id, text) => fs.writeFileSync(path.join(dir, 'chapters', id + '.html'), `<p>${text}</p>`);
const look = async () => { await js(`refreshFromDisk()`); await tick(400); };
const saved = async () => { await js(`flushAllSaves()`); await tick(700); };
const page = () => js(`document.getElementById('chapters').textContent`);
const order = () => js(`book.chapterOrder`);
async function typeKeys(text) {
  for (const c of text) {
    wc.sendInputEvent({ type: 'keyDown', keyCode: c });
    wc.sendInputEvent({ type: 'char', keyCode: c });
    wc.sendInputEvent({ type: 'keyUp', keyCode: c });
  }
  await tick(150);
}
// the caret at the end of this chapter
const caretIn = (index) => js(`(() => {
  const body = document.querySelectorAll('.chapter-body')[${index}];
  body.focus({ preventScroll: true });
  const r = document.createRange();
  r.selectNodeContents(body.lastElementChild);
  r.collapse(false);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
})()`);
// a chapter added here, with words, saved
async function addChapterHere(text) {
  await js(`document.getElementById('nav-add').click()`);
  await tick(300);
  await js(`(() => { const b = [...document.querySelectorAll('.chapter-body')].pop(); b.focus(); document.execCommand('insertText', false, ${JSON.stringify(text)}); })()`);
  await tick(1200);
  await saved();
  const ids = await order();
  return ids[ids.length - 1];
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('the other device\'s new chapter survives this device typing before it has looked', async () => {
  dir = path.join(lib, await js(`book.id`));
  const meta = readMeta();
  theirChapter('ch-theirs1', 'IPADONE a chapter written on the other device.');
  theirBook({ ...meta, chapterOrder: [...meta.chapterOrder, 'ch-theirs1'] });
  await caretIn(0);
  await typeKeys(' and more');
  await tick(1800); // the save that follows a pause in typing
  assert.ok(readMeta().chapterOrder.includes('ch-theirs1'), 'book.json still lists their chapter');
  assert.ok((await page()).includes('IPADONE'), 'and it is on the page');
  assert.ok(/and more/i.test(await page()), 'with the words typed here');
});

test('both devices add a chapter while apart: neither is dropped, whichever book.json stands', async () => {
  const before = readMeta(); // what the other device holds
  const mine = await addChapterHere('MACWORDS a chapter written here while the other device was away.');
  theirChapter('ch-theirs2', 'IPADTWO written there meanwhile.');
  theirBook({ ...before, chapterOrder: [...before.chapterOrder, 'ch-theirs2'] });
  await look();
  const text = await page();
  assert.ok(text.includes('MACWORDS'), 'the chapter written here is still in the book');
  assert.ok(text.includes('IPADTWO'), 'and so is theirs');
  await saved();
  const meta = readMeta();
  assert.ok(meta.chapterOrder.includes(mine) && meta.chapterOrder.includes('ch-theirs2'), 'book.json lists both');
  assert.ok(!(meta.removedChapters || []).includes(mine));
});

test('a chapter kept that way keeps its title', async () => {
  const before = readMeta();
  const mine = await addChapterHere('TITLED words.');
  await js(`(() => { book.chapterTitles[${JSON.stringify(mine)}] = 'The Kept One'; })()`);
  await js(`saveMeta()`); await tick(500);
  theirBook(before);
  await look();
  assert.equal(await js(`book.chapterTitles[${JSON.stringify(mine)}]`), 'The Kept One');
  assert.ok((await order()).includes(mine));
  await saved();
});

test('a chapter the other device deleted goes (it says so), though its file is still on the way out', async () => {
  const meta = readMeta();
  const gone = meta.chapterOrder[meta.chapterOrder.length - 1];
  theirBook({ ...meta, chapterOrder: meta.chapterOrder.filter((c) => c !== gone), removedChapters: [...(meta.removedChapters || []), gone] });
  await look();
  assert.ok(!(await order()).includes(gone), 'out of the book here too');
  assert.ok(!(await page()).includes('TITLED'));
  await saved();
  assert.ok(!readMeta().chapterOrder.includes(gone));
});

test('a chapter deleted by an older NEO on the other device (no word of it, the file gone) goes too', async () => {
  const mine = await addChapterHere('OLDSTYLE words.');
  const meta = readMeta();
  fs.unlinkSync(path.join(dir, 'chapters', mine + '.html'));
  const theirs = { ...meta, chapterOrder: meta.chapterOrder.filter((c) => c !== mine) };
  delete theirs.removedChapters;
  theirBook(theirs);
  await look();
  assert.ok(!(await order()).includes(mine));
});

test('a chapter deleted here is named in book.json, and a list written before that doesn\'t bring it back', async () => {
  const mine = await addChapterHere('DELETEME words.');
  const stale = readMeta(); // the other device's copy, from before the delete
  await js(`deleteChapterQuiet(${JSON.stringify(mine)})`);
  await tick(900);
  const meta = readMeta();
  assert.ok(!meta.chapterOrder.includes(mine));
  assert.ok((meta.removedChapters || []).includes(mine), 'named as taken out');
  assert.ok(!fs.existsSync(path.join(dir, 'chapters', mine + '.html')));
  theirBook({ ...stale, chapterTitles: { ...(stale.chapterTitles || {}), [stale.chapterOrder[0]]: 'Renamed There' } });
  await look();
  assert.ok(!(await order()).includes(mine), 'it stays out');
  assert.ok(!(await page()).includes('DELETEME'));
});

test('ordinary saves go through: typing still writes book.json', async () => {
  await saved();
  const before = readMeta().modified;
  await caretIn(0);
  await typeKeys(' three new words');
  await tick(1800);
  const meta = readMeta();
  assert.notEqual(meta.modified, before);
  assert.equal(meta.wordCount, await js(`bookWordCount()`));
});

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    win.setBounds({ width: 1200, height: 800 });
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(300);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      await addImportedBooks([{ name: 'Two Devices', chapters: [
        { title: 'One', paras: [{ text: 'The first chapter, as both devices know it.' }] },
        { title: 'Two', paras: [{ text: 'The second chapter, as both devices know it.' }] }
      ] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
    })()`);
    await tick(300);
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
