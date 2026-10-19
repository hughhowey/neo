// End-to-end tests for ⌘I and ⌘B (Ctrl+I, Ctrl+B) with nothing selected:
// turned on or off at the caret, they hold for the words typed next, however
// long the writer stops to think in between (#430). NEO runs on a throwaway
// library, and the keys arrive as the writer types them. Run with
// `npm run test:emphasis`.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A folder of its own for each run (see words.e2e.js for why earlier runs'
// folders are the ones removed).
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-emphasis-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-emphasis-test-${process.pid}-`));
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
const MOD = process.platform === 'darwin' ? 'meta' : 'control';

async function type(text) {
  for (const c of text) {
    const keyCode = c === ' ' ? 'Space' : c;
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'char', keyCode: c });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
    await tick(60);
  }
}
async function chord(keyCode) {
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers: [MOD] });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers: [MOD] });
  await tick(60);
}
// longer than the second of quiet that closes a run of typing for ⌘Z
const THINK = 1600;

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
  await tick(200);
}
const para = (n) => js(`document.querySelector('.chapter-body').children[${n}].innerHTML`);
const scrollTop = () => js(`document.getElementById('paper-scroll').scrollTop`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

for (const [key, tag] of [['i', 'i'], ['b', 'b']]) {
  const name = key === 'i' ? 'italics' : 'bold';

  test(`${name} turned off at the end of new words stay off after a pause`, async () => {
    await caretEnd(key === 'i' ? 0 : 1);
    await type(' ');
    await chord(key);
    await type('slanted');
    await chord(key);
    const top = await scrollTop();
    await tick(THINK);
    assert.equal(await scrollTop(), top, 'the page held still through the pause');
    await type(' after');
    await tick(200);
    assert.match(await para(key === 'i' ? 0 : 1), new RegExp(`<${tag}>slanted</${tag}> after$`));
  });

  test(`${name} turned on stay on after a pause`, async () => {
    await caretEnd(key === 'i' ? 2 : 3);
    await type(' ');
    await chord(key);
    await tick(THINK);
    await type('slanted');
    await chord(key);
    await type(' after');
    await tick(200);
    assert.match(await para(key === 'i' ? 2 : 3), new RegExp(`<${tag}>slanted</${tag}> after$`));
  });

  test(`${name} on and off without a pause`, async () => {
    await caretEnd(key === 'i' ? 4 : 5);
    await type(' ');
    await chord(key);
    await type('slanted');
    await chord(key);
    await type(' after');
    await tick(200);
    assert.match(await para(key === 'i' ? 4 : 5), new RegExp(`<${tag}>slanted</${tag}> after$`));
  });
}

test('the pause still closes a run of typing for undo', async () => {
  await caretEnd(6);
  await type(' first');
  await tick(THINK);
  await chord('i');
  await type(' second');
  await tick(200);
  await js(`document.execCommand('undo')`);
  await tick(300);
  assert.equal(await para(6), 'Rain fell on the harbor 6 and first');
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
      await addImportedBooks([{ name: 'Emphasis', chapters: [
        { title: 'One', paras: Array.from({ length: 12 }, (_, i) => ({ text: 'Rain fell on the harbor ' + i + ' and' })) }
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
