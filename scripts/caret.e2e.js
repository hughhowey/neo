// End-to-end tests for where the page puts the caret after Enter makes a
// break or a chapter. NEO runs on a throwaway library, and the keys arrive
// as the writer types them. Run with `npm run test:caret`.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A folder of its own for each run (see words.e2e.js for why earlier runs'
// folders are the ones removed).
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-caret-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-caret-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, pageTheme: 'night',
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
  await tick(300);
}
const enter = () => press('Enter', '\r');

// the caret at the end of a paragraph, scrolled to sit this far down the window
async function caretLow(index, fraction) {
  await js(`(() => {
    const sc = document.getElementById('paper-scroll');
    const body = document.querySelector('.chapter-body');
    body.focus();
    const p = body.children[${index}];
    sc.scrollTop += p.getBoundingClientRect().bottom - (sc.getBoundingClientRect().top + sc.clientHeight * ${fraction});
    const r = document.createRange();
    r.selectNodeContents(p);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await tick(300);
}

// the caret's line and the window, in the window's coordinates
const where = () => js(`(() => {
  getSelection().rangeCount || document.querySelector('.chapter-body').focus();
  const sc = document.getElementById('paper-scroll');
  const box = sc.getBoundingClientRect();
  const s = getSelection();
  let r = s.getRangeAt(0).getBoundingClientRect();
  if (!r.height) { const n = s.anchorNode; r = (n.nodeType === 1 ? n : n.parentElement).getBoundingClientRect(); }
  const head = (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement).closest('.chapter').querySelector('.chapter-head').getBoundingClientRect();
  return { top: box.top, bottom: box.bottom, caretTop: r.top, caretBottom: r.bottom, headTop: head.top, headBottom: head.bottom };
})()`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a break made at the foot of the window keeps the caret in sight', async () => {
  await caretLow(30, 0.88);
  await enter();
  await enter(); // the empty line becomes ***, and the caret goes below it
  const w = await where();
  assert.ok(w.caretBottom <= w.bottom, `the caret's line ends ${Math.round(w.caretBottom - w.bottom)}px below the window`);
  assert.ok(w.caretTop >= w.top);
});

test('a break made inside a paragraph at the foot of the window keeps the caret in sight', async () => {
  await caretLow(40, 0.9);
  await js(`(() => { const p = document.querySelector('.chapter-body').children[40]; getSelection().collapse(p.firstChild, 10); })()`);
  await enter();
  await enter();
  const w = await where();
  assert.ok(w.caretBottom <= w.bottom, `the caret's line ends ${Math.round(w.caretBottom - w.bottom)}px below the window`);
});

// a line's height, near enough: the window moves less than one line
const LINE = 40;

test('Enter three times leaves the line where it was, the new heading above it', async () => {
  await caretLow(50, 0.6);
  await enter();
  await enter(); // a break: the caret sits on the empty line under it
  const before = await where();
  await enter(); // a new chapter from here
  assert.equal(await js(`book.chapterOrder.length`), 2);
  const w = await where();
  assert.ok(Math.abs(w.caretTop - before.caretTop) < LINE, `the line moved ${Math.round(w.caretTop - before.caretTop)}px`);
  assert.ok(w.headTop >= w.top, `the heading starts ${Math.round(w.top - w.headTop)}px above the window`);
  assert.ok(w.headBottom <= w.caretTop, 'the heading sits above the caret');
});

test('Backspace into the chapter above leaves the line where it was', async () => {
  const before = await where();
  await press('Backspace', '');
  assert.equal(await js(`book.chapterOrder.length`), 1);
  const w = await where();
  assert.ok(Math.abs(w.caretTop - before.caretTop) < LINE, `the line moved ${Math.round(w.caretTop - before.caretTop)}px`);
});

test('a new chapter made near the window\'s top moves down only to show its heading', async () => {
  await caretLow(70, 0.5);
  await enter();
  await enter();
  // the empty line under the break at the window's very top
  await js(`(() => {
    const sc = document.getElementById('paper-scroll');
    sc.scrollTop += getSelection().anchorNode.getBoundingClientRect().top - (sc.getBoundingClientRect().top + 10);
  })()`);
  await tick(100);
  const before = await where();
  await enter();
  const w = await where();
  assert.ok(w.headTop >= w.top, `the heading starts ${Math.round(w.top - w.headTop)}px above the window`);
  assert.ok(w.caretTop - before.caretTop > 1, 'the line moved down to make room');
  assert.ok(w.headTop - w.top < 16, `and further than the heading needs: ${Math.round(w.headTop - w.top)}px`);
});

// A *** line with the caret on it: Backspace or Delete removes the whole
// break, as Backspace just below it does. It never joins the line above as
// three stars of text, and never loses a single star.
async function breakBetween(a, b, at) {
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    body.focus();
    const first = body.children[10];
    first.textContent = ${JSON.stringify(a)};
    const brk = document.createElement('p');
    brk.className = 'scene-break';
    brk.textContent = '***';
    first.after(brk);
    brk.nextElementSibling.textContent = ${JSON.stringify(b)};
    syncChapter(body, body.closest('.chapter').dataset.id); // as if typed: the chapter knows its break
    getSelection().collapse(brk.firstChild, ${at});
  })()`);
  await tick(100);
}
const around = () => js(`(() => {
  const body = document.querySelector('.chapter-body');
  const s = getSelection();
  const p = (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement).closest('p');
  return { first: body.children[10].innerHTML, second: body.children[11].innerHTML, breaks: body.querySelectorAll('p.scene-break').length, caretIn: [...body.children].indexOf(p), caretAt: s.anchorOffset, caretLen: p.textContent.length };
})()`);
const SPOTS = ['before the first *', 'between the first and second *', 'between the second and third *', 'after the last *'];
for (const key of ['Backspace', 'Delete']) for (const at of [0, 1, 2, 3]) {
  test(`${key} with the caret ${SPOTS[at]} removes the whole break`, async () => {
    const breaks = await js(`document.querySelectorAll('.chapter-body p.scene-break').length`);
    await breakBetween('Gulls over the slips.', 'Mara counted the boats.', at);
    await press(key, '');
    const w = await around();
    assert.equal(w.breaks, breaks, 'the break is gone');
    assert.equal(w.first, 'Gulls over the slips.');
    assert.equal(w.second, 'Mara counted the boats.');
    if (key === 'Backspace') assert.deepEqual([w.caretIn, w.caretAt], [10, w.caretLen], 'the caret at the end of the line above');
    else assert.deepEqual([w.caretIn, w.caretAt], [11, 0], 'the caret at the start of the line below');
  });
}

test('⌘Z puts a break removed from its own line back', async () => {
  await breakBetween('Gulls over the slips.', 'Mara counted the boats.', 0);
  await press('Backspace', '');
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'z', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'z', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
  await tick(400);
  const back = await js(`(() => { const c = document.querySelector('.chapter-body').children; return [c[10].textContent, c[11].className, c[11].textContent, c[12].textContent]; })()`);
  assert.deepEqual(back, ['Gulls over the slips.', 'scene-break', '***', 'Mara counted the boats.']);
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
      await addImportedBooks([{ name: 'Caret', chapters: [
        { title: 'One', paras: Array.from({ length: 120 }, (_, i) => ({ text: 'Rain fell on the harbor and the boats came in one by one under a grey sky ' + i + '.' })) }
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
