'use strict';

// Options → Close quotes as you open them (#270), typed key by key into a
// real NEO: off, a " is one mark as before; on, an opening " brings its
// closing mark along with the caret between, typing " before that mark
// steps over it, Backspace takes an empty pair, ⌘Z takes the pair back in
// one step, and the language's own marks are the ones paired.

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-auto-quotes-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-auto-quotes-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, pageTheme: 'night', spellLanguage: 'en-US',
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
const { editKey } = require('./e2e-keys');

async function type(text) {
  for (const c of text) {
    const keyCode = c === ' ' ? 'Space' : c;
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'char', keyCode: c });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
    await tick(60);
  }
}
async function key(keyCode) {
  wc.sendInputEvent({ type: 'keyDown', keyCode });
  wc.sendInputEvent({ type: 'keyUp', keyCode });
  await tick(80);
}
// one clean paragraph, the caret at its end (or before `before`)
async function page(text, { before = '' } = {}) {
  await js(`(() => {
    // a clean book: no marks from an earlier test for bookQuotes to follow
    for (const id of book.chapterOrder) chapterHTML[id] = '';
    const body = document.querySelector('.chapter-body');
    body.innerHTML = '<p>' + ${JSON.stringify(text + before)} + '</p>';
    body.focus();
    const t = body.firstChild.firstChild;
    const r = document.createRange();
    if (t) r.setStart(t, ${JSON.stringify(text)}.length); else r.setStart(body.firstChild, 0);
    r.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await tick(150);
}
const text = () => js(`document.querySelector('.chapter-body').firstChild.textContent`);
// the paragraph with | where the caret is
const withCaret = () => js(`(() => {
  const p = document.querySelector('.chapter-body').firstChild;
  const s = getSelection();
  const pre = document.createRange();
  pre.selectNodeContents(p);
  pre.setEnd(s.anchorNode, s.anchorOffset);
  const at = pre.toString().length;
  return p.textContent.slice(0, at) + '|' + p.textContent.slice(at);
})()`);
const setting = (on, lang = 'en-US') => js(`(async () => { if (${on}) library.autoCloseQuotes = true; else delete library.autoCloseQuotes; library.spellLanguage = ${JSON.stringify(lang)}; await writeLibrary(library); })()`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('off (as a new library starts): " is one mark, as before', async () => {
  assert.equal(await js('!!library.autoCloseQuotes'), false);
  await page('');
  await type('"Hi,"');
  assert.equal(await text(), '“Hi,”');
});

test('on: " opens a pair with the caret between, and " before the closing mark steps over it', async () => {
  await setting(true);
  await page('');
  await type('"');
  assert.equal(await withCaret(), '“|”');
  await type('Hi,');
  assert.equal(await withCaret(), '“Hi,|”');
  await type('" she said.');
  assert.equal(await withCaret(), '“Hi,” she said.|');
});

test('mid-sentence, after a space', async () => {
  await page('She said ');
  await type('"no"');
  assert.equal(await withCaret(), 'She said “no”|');
});

test('Backspace between an empty pair takes both marks', async () => {
  await page('Then ');
  await type('"');
  assert.equal(await withCaret(), 'Then “|”');
  await key('Backspace');
  assert.equal(await withCaret(), 'Then |');
});

test('⌘Z (Ctrl+Z) takes the pair back in one step', async () => {
  await page('Then ');
  await type('"');
  assert.equal(await text(), 'Then “”');
  await editKey(wc, 'z');
  await tick(150);
  assert.equal(await text(), 'Then ');
});

test('a quote typed before a word opens only: the writer is quoting words already there', async () => {
  await page('He said ', { before: 'never again.' });
  await type('"');
  assert.equal(await withCaret(), 'He said “|never again.');
});

test("' is still an apostrophe, never paired", async () => {
  await page('They ');
  await type("don't");
  assert.equal(await text(), 'They don’t');
});

test('French pairs « » with its narrow spaces, and steps over them', async () => {
  await setting(true, 'fr');
  await page('Il dit ');
  await type('"');
  assert.equal(await withCaret(), 'Il dit « | »');
  await type('non"');
  assert.equal(await withCaret(), 'Il dit « non »|');
});

test('German pairs »…«; Swedish, whose marks are the same both ways, pairs ”…”', async () => {
  await setting(true, 'de');
  await page('');
  await type('"Ja"');
  assert.equal(await withCaret(), '»Ja«|');
  await setting(true, 'sv');
  await page('');
  await type('"Ja"');
  assert.equal(await withCaret(), '”Ja”|');
});

test('Options turns it on and off', async () => {
  await setting(false);
  wc.send('menu', { type: 'options' });
  await tick(500);
  const box = `document.querySelector('.options-modal [data-opt="autoCloseQuotes"]')`;
  assert.equal(await js(`!!${box} && ${box}.checked`), false);
  await js(`${box}.click()`);
  await tick(300);
  assert.equal(await js('library.autoCloseQuotes'), true);
  await js(`${box}.click()`);
  await tick(300);
  assert.equal(await js('library.autoCloseQuotes'), undefined);
  await js(`document.querySelector('.options-modal .m-ok').click()`);
  await tick(200);
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
      await addImportedBooks([{ name: 'Quotes', chapters: [{ title: 'One', paras: [{ text: 'A line.' }] }] }], library.shelves[0]);
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
