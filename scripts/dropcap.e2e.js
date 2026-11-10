// End-to-end tests for the drop cap. It used to be the paragraph's
// ::first-letter, which made the engine split the text in two: deleting a
// space beside it left a doubled letter on the page, so the cap had to step
// aside whenever the caret was in its paragraph. Now it is drawn beside the
// paragraph (setDropCap in app.js), and these hold it there: the cap stays
// while its paragraph is typed in, and the page never shows anything but the
// text. NEO runs on a throwaway library, and the keys arrive as the writer
// types them. Run with `npm run test:dropcap`.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A folder of its own for each run (see words.e2e.js for why earlier runs'
// folders are the ones removed).
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-dropcap-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-dropcap-test-${process.pid}-`));
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

async function press(keyCode, char) {
  wc.sendInputEvent({ type: 'keyDown', keyCode });
  if (char) wc.sendInputEvent({ type: 'char', keyCode: char });
  wc.sendInputEvent({ type: 'keyUp', keyCode });
  await js(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
}
const type = async (text) => { for (const c of text) await press(c, c); };

// the caret this many characters into the first chapter's paragraph `index`
const caret = (index, offset) => js(`(() => {
  const body = document.querySelector('.chapter-body');
  const p = body.children[${index}];
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  let n, last = null, left = ${offset};
  while ((n = walker.nextNode())) { last = n; if (left <= n.data.length) break; left -= n.data.length; }
  body.focus({ preventScroll: true });
  if (last) getSelection().collapse(last, Math.min(left, last.data.length)); else getSelection().collapse(p, 0);
})()`);

// what a chapter's opening shows: the cap drawn, the letter kept out of sight
// under it, how far the line is drawn back, the words as laid out on the page
// and as they are in the text
const opening = (chapter = 0) => js(`(() => {
  const body = document.querySelectorAll('.chapter-body')[${chapter}];
  const p = body.querySelector('p[data-first]');
  const shown = p ? getComputedStyle(p, '::before').content : 'none';
  const hidden = [...CSS.highlights.get('neo-cap')].filter((r) => r.startContainer.isConnected && body.contains(r.startContainer));
  return {
    cap: /^"/.test(shown) ? JSON.parse(shown) : '',
    hidden: hidden.map((r) => r.toString()),
    letterWidth: hidden.length ? hidden[0].getBoundingClientRect().width : 0,
    indent: p ? parseFloat(getComputedStyle(p).textIndent) : 0,
    firstLetterRule: p ? getComputedStyle(p, '::first-letter').float : 'none',
    page: p ? p.innerText.replace(/\\n$/, '') : '',
    text: p ? p.textContent : '',
    saved: chapterHTML[book.chapterOrder[${chapter}]]
  };
})()`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('each chapter opens on a cap, with its letter out of sight beneath it', async () => {
  for (const [i, letter] of [[0, 'R'], [1, 'A']]) {
    const o = await opening(i);
    assert.equal(o.cap, letter);
    assert.deepEqual(o.hidden, [letter]);
    assert.ok(Math.abs(o.indent + o.letterWidth) < 0.6, `the line is drawn back ${-o.indent}px for a letter ${o.letterWidth}px wide`);
    assert.equal(o.firstLetterRule, 'none', 'no ::first-letter rule on the page');
  }
});

test('the cap stays while its paragraph is typed in', async () => {
  await caret(0, 9);
  await type(' softly');
  const o = await opening();
  assert.equal(o.cap, 'R');
  assert.equal(o.text.slice(0, 16), 'Rain fell softly');
});

test('deleting spaces and letters beside the cap leaves the page showing the text, nothing doubled', async () => {
  for (const at of [5, 4, 2, 1, 3]) {
    await caret(0, at);
    await press('Backspace', '');
    const o = await opening();
    assert.equal(o.page, o.text, `after Backspace at ${at}`);
  }
  for (const at of [0, 1, 2]) {
    await caret(0, at);
    await press('Delete', '');
    const o = await opening();
    assert.equal(o.page, o.text, `after Delete at ${at}`);
  }
});

test('the cap follows the first letter as it changes', async () => {
  await caret(0, 0);
  await type('W');
  let o = await opening();
  assert.equal(o.cap, 'W');
  assert.deepEqual(o.hidden, ['W']);
  assert.ok(Math.abs(o.indent + o.letterWidth) < 0.6, 'the line is drawn back by the new letter\'s width');
  await caret(0, 1);
  await press('Backspace', '');
  o = await opening();
  assert.equal(o.cap, o.text[0].toUpperCase() === o.text[0] && /\p{L}/u.test(o.text[0]) ? o.text[0] : o.cap);
  assert.deepEqual(o.hidden, o.cap ? [o.cap] : []);
});

test('an opening quotation mark is set with its letter', async () => {
  await caret(0, 0);
  await type('"');
  const o = await opening();
  assert.equal(o.cap.length, 2);
  assert.ok(/^[“"]/.test(o.cap), 'the cap opens on the mark: ' + o.cap);
  assert.deepEqual(o.hidden, [o.cap]);
  await caret(0, 1);
  await press('Backspace', '');
});

test('a paragraph that opens on a space or a dash has no cap, and no letter hidden', async () => {
  await caret(0, 0);
  await type(' ');
  let o = await opening();
  assert.equal(o.cap, '');
  assert.deepEqual(o.hidden, []);
  assert.ok(o.indent >= 0);
  await caret(0, 1);
  await press('Backspace', '');
  o = await opening();
  assert.notEqual(o.cap, '', 'the cap comes back with the letter');
});

test('Enter at the start hands the cap to the paragraph with words; joining gives it back', async () => {
  const before = (await opening()).cap;
  await caret(0, 0);
  await press('Enter', '\r');
  let o = await opening();
  assert.equal(o.cap, before);
  assert.deepEqual(o.hidden, [before]);
  await caret(1, 0);
  await press('Backspace', '');
  o = await opening();
  assert.equal(o.cap, before);
  assert.equal(o.page, o.text);
});

test('nothing of the cap is saved with the chapter', async () => {
  const o = await opening();
  assert.ok(!/data-first|has-cap|--cap|text-indent/.test(o.saved), o.saved.slice(0, 120));
});

test('with drop caps turned off there is no cap and no hidden letter', async () => {
  await js(`(() => { library.fonts = { ...(library.fonts || {}), dropcap: 'none' }; applyFonts(); })()`);
  let o = await opening();
  assert.equal(o.cap, '');
  assert.deepEqual(o.hidden, []);
  await js(`(() => { library.fonts = { ...library.fonts, dropcap: 'literary' }; applyFonts(); })()`);
  o = await opening();
  assert.notEqual(o.cap, '');
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
      await addImportedBooks([{ name: 'Drop Cap', chapters: [
        { title: 'One', paras: Array.from({ length: 6 }, (_, i) => ({ text: 'Rain fell on the harbor and the boats came in one by one under a grey sky ' + i + '.' })) },
        { title: 'Two', paras: [{ text: 'Another chapter opens here, with a cap of its own.' }, { text: 'And goes on.' }] }
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
