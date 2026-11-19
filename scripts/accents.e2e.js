// End-to-end tests for holding a letter for its accents off the Mac
// (Options → Press and hold for accents, #579): the strip of accented letters,
// the keys and clicks that pick one, and the keys that leave it. NEO runs on
// a throwaway library, and the keys arrive as a held key sends them: one
// press, then repeats. On a Mac the system's own picker does the work, so
// there the test sets it aside and checks NEO's strip all the same. Run with
// `npm run test:accents` (`OUT=<folder>` keeps a picture of the strip).

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A folder of its own for each run (see words.e2e.js for why earlier runs'
// folders are the ones removed).
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-accents-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-accents-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'app'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'app', 'settings.json'), JSON.stringify({ pressAndHold: true }));
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
const { editKey } = require('./e2e-keys');

const keyCodeOf = (c) => (c === ' ' ? 'Space' : c);
async function press(c) {
  wc.sendInputEvent({ type: 'keyDown', keyCode: keyCodeOf(c) });
  wc.sendInputEvent({ type: 'char', keyCode: c });
  wc.sendInputEvent({ type: 'keyUp', keyCode: keyCodeOf(c) });
  await tick(60);
}
async function type(text) { for (const c of text) await press(c); }
// a letter held down: its press, then the repeats a keyboard sends
async function hold(c, repeats = 4) {
  wc.sendInputEvent({ type: 'keyDown', keyCode: c });
  wc.sendInputEvent({ type: 'char', keyCode: c });
  await tick(60);
  for (let i = 0; i < repeats; i++) {
    wc.sendInputEvent({ type: 'keyDown', keyCode: c, modifiers: ['isAutoRepeat'] });
    wc.sendInputEvent({ type: 'char', keyCode: c, modifiers: ['isAutoRepeat'] });
    await tick(40);
  }
  wc.sendInputEvent({ type: 'keyUp', keyCode: c });
  await tick(80);
}
async function key(keyCode) {
  wc.sendInputEvent({ type: 'keyDown', keyCode });
  wc.sendInputEvent({ type: 'keyUp', keyCode });
  await tick(80);
}

// the caret at the end of paragraph n
async function caretEnd(n) {
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    body.focus();
    const r = document.createRange();
    r.selectNodeContents(body.children[${n}]);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await tick(150);
}
const para = (n) => js(`document.querySelector('.chapter-body').children[${n}].textContent`);
const strip = () => js(`(() => {
  const el = document.querySelector('.accent-pick');
  return el ? [...el.querySelectorAll('.ap-ch')].map((s) => s.textContent).join('') : null;
})()`);

// OUT=<folder> keeps a picture of the strip over the page
async function picture(name) {
  const r = await js(`(() => {
    const b = document.querySelector('.accent-pick').getBoundingClientRect();
    return { x: Math.max(0, Math.round(b.left - 160)), y: Math.max(0, Math.round(b.top - 40)), width: Math.round(b.width + 320), height: Math.round(b.height + 110) };
  })()`);
  fs.mkdirSync(process.env.OUT, { recursive: true });
  fs.writeFileSync(path.join(process.env.OUT, name), (await wc.capturePage(r)).toPNG());
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let n = 0; // a fresh paragraph for each test

test('holding e shows its accents; 2 takes é', async () => {
  await caretEnd(n);
  await type(' caf');
  await hold('e');
  assert.equal(await strip(), 'èéêëēėęě');
  if (process.env.OUT) { wc.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 }); await tick(100); await picture('accents.png'); }
  assert.equal(await para(n), 'Rain fell 0 cafe', 'the held key typed one e, not a row of them');
  await key('2');
  assert.equal(await strip(), null);
  assert.equal(await para(n), 'Rain fell 0 café');
  await type(' noir');
  assert.equal(await para(n), 'Rain fell 0 café noir');
});

test('at a sentence start the capital gets capital accents', async () => {
  await caretEnd(++n);
  await type('. ');
  await hold('e');
  assert.equal(await strip(), 'ÈÉÊËĒĖĘĚ');
  await key('2');
  assert.equal(await para(n), 'Rain fell 1. É');
});

test('← → and Enter pick, and Enter adds no new line', async () => {
  await caretEnd(++n);
  await type(' ma');
  await hold('n');
  await key('Right');
  await key('Right');
  await key('Left');
  assert.equal(await js(`document.querySelector('.accent-pick button.on .ap-ch').textContent`), 'ñ');
  await key('Return');
  assert.equal(await para(n), 'Rain fell 2 mañ');
  assert.equal(await js(`document.querySelector('.chapter-body').children[${n + 1}].textContent`), 'Rain fell 3');
});

test('a click picks, and the caret stays in the page', async () => {
  await caretEnd(++n);
  await type(' gar');
  await hold('c');
  await js(`document.querySelectorAll('.accent-pick button')[0].click()`);
  await tick(80);
  await type('on');
  assert.equal(await para(n), 'Rain fell 3 garçon');
});

test('Esc keeps the letter; the next key is typed as usual', async () => {
  await caretEnd(++n);
  await type(' ');
  await hold('o');
  await key('Escape');
  assert.equal(await strip(), null);
  await type('k');
  assert.equal(await para(n), 'Rain fell 4 ok');
  await type(' ');
  await hold('a');
  await type('h');
  assert.equal(await strip(), null);
  assert.equal(await para(n), 'Rain fell 4 ok ah', 'another key closes the strip and goes in');
});

test('a letter with no accents still repeats', async () => {
  await caretEnd(++n);
  await type(' h');
  await hold('m', 3);
  assert.equal(await strip(), null);
  assert.equal(await para(n), 'Rain fell 5 hmmmm');
});

test('⌘Z (Ctrl+Z) after a pick brings the letter back', async () => {
  await caretEnd(++n);
  await type(' na');
  await hold('i');
  await key('2');
  assert.equal(await para(n), 'Rain fell 6 naï');
  await editKey(wc, 'z');
  await tick(200);
  assert.equal(await para(n), 'Rain fell 6 nai');
});

test('in the other fields too (titles, notes, cards)', async () => {
  // they reach the typing rules through the page-wide handler, as this one does
  await js(`(() => {
    const el = document.createElement('div');
    el.id = 'accent-probe';
    el.contentEditable = 'true';
    el.textContent = 'Chapter';
    document.body.appendChild(el);
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await tick(150);
  await type(' Caf');
  await hold('e');
  await key('2');
  assert.equal(await js(`document.getElementById('accent-probe').textContent`), 'Chapter Café');
  await js(`document.getElementById('accent-probe').remove()`);
});

test('turned off in Options, held keys repeat', async () => {
  await js(`openOptions()`);
  await tick(300);
  assert.equal(await js(`!!document.querySelector('[data-opt="pressHold"]')`), true, 'the switch is in Options');
  await js(`(() => { const b = document.querySelector('[data-opt="pressHold"]'); b.click(); })()`);
  await tick(200);
  await js(`document.querySelector('.options-modal .m-ok').click()`);
  await tick(300);
  await caretEnd(++n);
  await type(' ');
  await hold('e', 2);
  assert.equal(await strip(), null);
  assert.equal(await para(n), 'Rain fell 7 eee');
  const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'app', 'settings.json'), 'utf8'));
  assert.equal(saved.pressAndHold, false);
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
    // a Mac hands a held key to its own picker; here NEO's strip is the one tested
    if (process.platform === 'darwin') await js(`systemAccentPicker = () => false; true`);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      await addImportedBooks([{ name: 'Accents', chapters: [
        { title: 'One', paras: Array.from({ length: 12 }, (_, i) => ({ text: 'Rain fell ' + i })) }
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
