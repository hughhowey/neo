// End-to-end tests for Zen mode (View → Zen Mode, ⌘⇧H): full screen with
// nothing but the words, and Esc bringing everything back. NEO runs on a
// throwaway library. Run with `npm run test:zen`.

'use strict';

const { app, BrowserWindow, Menu } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A folder of its own for each run (see words.e2e.js for why earlier runs'
// folders are the ones removed).
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-zen-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-zen-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const lib = path.join(tmp, 'NEO Library');
fs.mkdirSync(lib);
fs.writeFileSync(path.join(lib, 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, moreFeatures: true, pageTheme: 'night',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
// run from scripts/, NEO's window would look for scripts/index.html
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let win, wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => tick(900); // full screen takes its time
const shot = async (name) => {
  if (!process.env.NEO_SHOTS) return;
  const img = await wc.capturePage();
  fs.writeFileSync(path.join(process.env.NEO_SHOTS, name + '.png'), img.toPNG());
};
const zenItem = () => {
  let found = null;
  const walk = (m) => { for (const i of m.items) { if (i.label === 'Zen Mode') found = i; if (i.submenu) walk(i.submenu); } };
  walk(Menu.getApplicationMenu());
  return found;
};
const shown = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return !!el && getComputedStyle(el).display !== 'none'; })()`);
const fromMenu = async () => { zenItem().click(); await settle(); };
const esc = async () => {
  await js(`document.querySelector('.chapter-body').focus()`);
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await settle();
};
const openTheBook = () => js(`(async () => {
  const ids = library.shelves[0].bookIds;
  await openBook(ids[ids.length - 1]);
})()`).then(() => tick(400));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('View → Zen Mode is there, on ⌘⇧H, and waits for a book', async () => {
  const item = zenItem();
  assert.ok(item, 'the menu item');
  assert.equal(item.accelerator, 'CmdOrCtrl+Shift+H');
  assert.equal(item.checked, false);
  assert.equal(item.enabled, true);
});

test('Zen hides the bar, the panes and their hover zones, and goes full screen', async () => {
  await fromMenu();
  await shot('zen');
  assert.equal(await js('zenOn'), true);
  assert.equal(win.isFullScreen(), true);
  for (const sel of ['#bottombar', '#nav-pane', '#side-pane', '#nav-hotzone', '#side-hotzone']) {
    assert.equal(await shown(sel), false, sel + ' is gone');
  }
  assert.equal(await js(`getComputedStyle(document.querySelector('.sheet')).boxShadow`), 'none');
  assert.equal(zenItem().checked, true, 'the menu ticks it');
});

test('the words stay as they were: nothing is written into the chapter', async () => {
  const html = await js(`document.querySelector('.chapter-body').innerHTML`);
  assert.ok(!/zen/i.test(html));
});

test('Esc brings everything back, leaves full screen, and keeps the book open', async () => {
  await esc();
  await shot('after');
  assert.equal(await js('zenOn'), false);
  assert.equal(win.isFullScreen(), false);
  assert.equal(await js(`document.getElementById('editor-view').hidden`), false, 'still in the book');
  assert.equal(await shown('#bottombar'), true);
  assert.equal(zenItem().checked, false);
});

test('a pinned pane goes in Zen, the page stands in the middle, and the pane is back after', async () => {
  await js(`pinPane('nav', true)`);
  await tick(300);
  await fromMenu();
  assert.equal(await shown('#nav-pane'), false);
  const off = await js(`(() => {
    const r = document.getElementById('paper').getBoundingClientRect();
    return Math.abs((r.left + r.right) / 2 - innerWidth / 2);
  })()`);
  assert.ok(off < 2, `the page is ${Math.round(off)}px off the middle`);
  await esc();
  assert.equal(await shown('#nav-pane'), true);
  assert.equal(await js(`document.getElementById('nav-pane').dataset.pinned`), '1');
  await js(`pinPane('nav', false)`);
});

test('Zen from full screen leaves full screen as it found it', async () => {
  win.setFullScreen(true);
  await settle();
  await fromMenu();
  assert.equal(await js('zenOn'), true);
  await fromMenu(); // the same keys again
  assert.equal(await js('zenOn'), false);
  assert.equal(win.isFullScreen(), true, 'still full screen');
  win.setFullScreen(false);
  await settle();
});

test('F6 brings the panes and the bar back', async () => {
  await fromMenu();
  await js(`document.querySelector('.chapter-body').focus()`);
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'F6' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'F6' });
  await settle();
  assert.equal(await js('zenOn'), false);
  assert.equal(win.isFullScreen(), false);
});

test('back to the shelf leaves Zen behind', async () => {
  await fromMenu();
  await js('backToShelf()');
  await settle();
  assert.equal(await js('zenOn'), false);
  assert.equal(await js(`document.body.classList.contains('zen')`), false);
  assert.equal(win.isFullScreen(), false);
  assert.equal(zenItem().enabled, false, 'no book, no Zen');
  await openTheBook();
});

test('simple NEO has no Zen, and turning the switch off ends it', async () => {
  await fromMenu();
  await js('setMoreFeatures(false)');
  await settle();
  assert.equal(await js('zenOn'), false);
  assert.equal(zenItem(), null, 'not in simple NEO\'s menu');
  await js('setZen(true)');
  assert.equal(await js('zenOn'), false);
  await js('setMoreFeatures(true)');
  await tick(300);
});

/* ---------- runner ---------- */

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    win.setBounds({ width: 1200, height: 800 });
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(300);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      await addImportedBooks([{ name: 'Zen', chapters: [
        { title: 'One', paras: Array.from({ length: 40 }, (_, i) => ({ text: 'The children were playing while Holston climbed the stairs ' + i + '.' })) }
      ] }], library.shelves[0]);
    })()`);
    await openTheBook();
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
