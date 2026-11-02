// End-to-end tests for the typographic dash and ellipsis NEO sets as you type
// (-- becomes —, ... becomes …) in a book, and that a script keeps what is
// typed (#460). NEO runs on a throwaway library; each key goes to the page
// as a keydown and, where the page leaves it alone, is typed in as the engine
// would. Run with `npm run test:script-keys`.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A folder of its own for each run (see words.e2e.js for why earlier runs'
// folders are the ones removed).
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-script-keys-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-script-keys-test-${process.pid}-`));
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

// every character as a key the page can answer; one it leaves alone is typed in
const typeKeys = (text) => js(`(() => {
  for (const c of ${JSON.stringify(text)}) {
    const e = new KeyboardEvent('keydown', { key: c, bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(e);
    if (!e.defaultPrevented) document.execCommand('insertText', false, c);
  }
})()`);
// the caret at the end of the last line of the open book
const caretAtEnd = () => js(`(() => {
  const body = document.querySelector('.chapter-body');
  body.focus();
  const r = document.createRange();
  r.selectNodeContents(body.lastElementChild);
  r.collapse(false);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
})()`);
const lastLine = () => js(`document.querySelector('.chapter-body').lastElementChild.textContent`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('in a book, -- and ... become a dash and an ellipsis', async () => {
  await caretAtEnd();
  await typeKeys(' -- and... then');
  assert.equal(await lastLine(), 'Rain fell on the harbor — and… then');
});

test('in a script, -- and ... stay as typed, and so does a spaced hyphen', async () => {
  await js(`(async () => { await backToShelf(); await createScriptOnShelf(library.shelves[0]); })()`);
  await tick(500);
  assert.equal(await js('isScript()'), true);
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    body.innerHTML = '<p class="sp-heading">INT. KITCHEN - DAY</p><p>He waits</p>';
    syncChapter(body, book.chapterOrder[0]);
  })()`);
  await caretAtEnd();
  await typeKeys(' - then -- gone...');
  assert.equal(await lastLine(), 'He waits - then -- gone...');
});

/* ---------- runner ---------- */

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
      await addImportedBooks([{ name: 'Dashes', chapters: [
        { title: 'One', paras: [{ text: 'Rain fell on the harbor' }] }
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
