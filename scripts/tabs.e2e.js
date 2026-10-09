// End-to-end tests for the ⌥⌘←/→ tab keys, on a throwaway library.
// Run with `npm run test:tabs`.

'use strict';

const { app, BrowserWindow, Menu } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A folder of its own for each run. Chromium writes to its profile until
// the process is gone, so a run can't remove its own; it removes those of
// earlier runs whose process has ended instead, leaving any still running.
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-tabs-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-tabs-test-${process.pid}-`));
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
const tab = () => js('currentTab');
const MOD = process.platform === 'darwin' ? 'meta' : 'control';
const OTHER = MOD === 'meta' ? 'control' : 'meta';
// Ctrl/Cmd+Alt+arrow goes to the page; Electron's menu is not involved
const press = async (key, modifiers = [MOD, 'alt']) => {
  for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode: key, modifiers });
  await tick(300);
};
const RIGHT = 'Right';
const LEFT = 'Left';
const caretInChapter = () => js(`(() => {
  const ps = document.querySelectorAll('.chapter-body > p');
  const r = document.createRange();
  r.setStart(ps[5].firstChild, 4);
  r.collapse(true);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
})()`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('→ walks Manuscript, Notes, Outline, Darlings, then round to Manuscript', async () => {
  for (const name of ['notes', 'outline', 'darlings', 'manuscript']) {
    await press(RIGHT);
    assert.equal(await tab(), name);
  }
});

test('← walks back, round from Manuscript to Darlings', async () => {
  for (const name of ['darlings', 'outline', 'notes', 'manuscript']) {
    await press(LEFT);
    assert.equal(await tab(), name);
  }
});

test('the other platform\'s modifier, or a missing Alt or an extra Shift, does nothing', async () => {
  await press(RIGHT, [OTHER, 'alt']);
  await press(RIGHT, [MOD]);
  await press(RIGHT, [MOD, 'alt', 'shift']);
  assert.equal(await tab(), 'manuscript');
});

test('a tab swap does not redraw the tab you stay on', async () => {
  await press(LEFT); // Darlings
  await js(`window.__renders = 0; const f = renderDarlings; renderDarlings = () => { window.__renders++; return f(); }; 0`);
  await press(LEFT); // Outline
  await press(RIGHT); // Darlings again: one draw
  assert.equal(await js('window.__renders'), 1);
  await press(RIGHT); // Manuscript
  assert.equal(await tab(), 'manuscript');
});

test('the cursor comes back to where it was in the manuscript', async () => {
  await caretInChapter();
  await tick(100);
  await press(RIGHT);
  await press(LEFT);
  assert.equal(await js(`(() => {
    const s = getSelection();
    const p = s.anchorNode && (s.anchorNode.parentElement || s.anchorNode).closest('p');
    return [...document.querySelectorAll('.chapter-body > p')].indexOf(p) + ':' + s.anchorOffset;
  })()`), '5:4');
});

test('an open dialog blocks the shortcut', async () => {
  await js(`(() => { const d = document.createElement('div'); d.className = 'modal-backdrop'; d.id = 'tab-test-modal'; document.body.appendChild(d); })()`);
  await press(RIGHT);
  await js(`document.getElementById('tab-test-modal').remove()`);
  assert.equal(await tab(), 'manuscript');
});

test('the shelf ignores the shortcut', async () => {
  await js(`document.getElementById('editor-view').hidden = true`);
  await press(RIGHT);
  await js(`document.getElementById('editor-view').hidden = false`);
  assert.equal(await tab(), 'manuscript');
});

test('View → Go to has the four tabs and no key of its own', async () => {
  const view = Menu.getApplicationMenu().items.find((i) => i.label === 'View');
  const goTo = view.submenu.items.find((i) => i.label === 'Go to');
  assert.deepEqual(goTo.submenu.items.map((i) => i.label), ['Manuscript', 'Notes', 'Outline', 'Darlings']);
  assert.ok(goTo.submenu.items.every((i) => !i.accelerator));
});

test('the menu items switch tabs', async () => {
  const view = Menu.getApplicationMenu().items.find((i) => i.label === 'View');
  const goTo = view.submenu.items.find((i) => i.label === 'Go to');
  goTo.submenu.items[3].click();
  await tick(300);
  assert.equal(await tab(), 'darlings');
  goTo.submenu.items[0].click();
  await tick(300);
  assert.equal(await tab(), 'manuscript');
});

/* ---------- runner ---------- */

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(300);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      await addImportedBooks([{ name: 'Tabs', chapters: [
        { title: 'One', paras: Array.from({ length: 12 }, () => ({ text: 'Rain fell on the harbor.' })) }
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
