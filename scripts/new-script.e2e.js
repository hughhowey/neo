// End-to-end tests for starting a script in simple NEO (Show More Features
// off): a right-click on the shelf's + offers New Script (#494, #504), and a
// script page the browser left with no line comes back to one, so Return
// works again (#502). Run with `npm run test:new-script`.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-new-script-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-new-script-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, moreFeatures: false, pageTheme: 'night',
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

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('simple NEO: right-click on the shelf\'s + offers New Script, and it makes one', async () => {
  assert.equal(await js('moreOn()'), false);
  await js(`(() => {
    const plus = document.querySelector('.new-book');
    const r = plus.getBoundingClientRect();
    plus.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 5, clientY: r.y + 5 }));
  })()`);
  await tick(200);
  const labels = await js(`[...document.querySelectorAll('.pop-menu button')].map((b) => b.textContent)`);
  assert.deepEqual(labels, ['New Book', 'New Script']);
  await js(`[...document.querySelectorAll('.pop-menu button')].find((b) => b.textContent === 'New Script').click()`);
  await tick(800);
  assert.equal(await js('!!book && isScript()'), true);
});

test('a script page left with bare text and a <br> heals into a line, and Return works', async () => {
  await js(`(() => {
    const body = document.querySelector('.chapter-body.script-body');
    body.innerHTML = 'INT. LIVING ROOM - NIGHT.<br>';
    body.focus();
    const r = document.createRange();
    r.setStart(body.firstChild, body.firstChild.length);
    r.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    body.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '.' }));
  })()`);
  await tick(100);
  const lines = await js(`[...document.querySelector('.chapter-body.script-body').children].map((p) => p.tagName + ':' + p.textContent)`);
  assert.deepEqual(lines, ['P:INT. LIVING ROOM - NIGHT.']);
  const before = await js(`document.querySelector('.chapter-body.script-body').children.length`);
  await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
  await tick(100);
  const after = await js(`document.querySelector('.chapter-body.script-body').children.length`);
  assert.equal(after, before + 1, 'Return adds a line');
});

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    win.setBounds({ width: 1200, height: 800 });
    while (!(await js(`typeof library !== 'undefined' && !!library && !!document.querySelector('.new-book')`).catch(() => false))) await tick(50);
    await tick(300);
    await js(`document.getElementById('firstrun').hidden = true`);
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
