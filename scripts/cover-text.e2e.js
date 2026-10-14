// What a painted cover's brief is written from: the story alone, never the
// copyright, dedication, acknowledgments or about pages (they carry the
// writer's name). Nothing is sent: window.neo.paintCover is caught here.
// Run with `npm run test:cover-text`.

'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-cover-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-cover-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const lib = path.join(tmp, 'NEO Library');
fs.mkdirSync(lib);
fs.writeFileSync(path.join(lib, 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, pageTheme: 'night',
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

// caught on the main side: a key "there", and the text kept instead of sent
const sent = [];
const catchPaint = () => {
  ipcMain.removeHandler('secret:has');
  ipcMain.handle('secret:has', () => true);
  ipcMain.removeHandler('cover:paint');
  ipcMain.handle('cover:paint', (_e, bookId, text) => { sent.push(String(text)); return { error: 'caught' }; });
};
const setUp = () => js(`(async () => {
  const front = createChapterAt(0);
  book.chapterKinds = book.chapterKinds || {};
  book.chapterKinds[front] = 'copyright';
  const back = createChapterAt(book.chapterOrder.length);
  book.chapterKinds[back] = 'about';
  renderChapters();
  const put = (id, text) => { const b = document.querySelector('.chapter[data-id="' + id + '"] .chapter-body'); b.innerHTML = '<p>' + text + '</p>'; syncChapter(b, id); };
  put(front, 'Copyright © 2026 Jane Writer. All rights reserved.');
  put(back, 'Jane Writer lives in Ohio with two dogs.');
  await saveMeta();
  for (const id of book.chapterOrder) await persistChapter(id);
})()`);

test('the open book: only its chapters go into the brief', async () => {
  catchPaint();
  await setUp();
  await js(`requestPaint(book, bookPlainText())`);
  await tick(300);
  const text = sent[0] || '';
  assert.match(text, /The convoy left at dawn\./);
  assert.match(text, /The scale was older than the road\./);
  assert.doesNotMatch(text, /Jane Writer|Copyright|Ohio/);
});

test('a book read from disk: the same', async () => {
  await js(`(async () => { const m = await window.neo.readBookMeta(book.id); await requestPaint(m, null); })()`);
  await tick(300);
  const text = sent[1] || '';
  assert.match(text, /The convoy left at dawn\./);
  assert.doesNotMatch(text, /Jane Writer|Copyright|Ohio/);
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
      const paras = (s) => Array.from({ length: 6 }, () => ({ text: s }));
      await addImportedBooks([{ name: 'The Lantern Year', chapters: [
        { title: 'Salt Road', paras: paras('The convoy left at dawn.') },
        { title: 'The Weigh Station', paras: paras('The scale was older than the road.') }
      ] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
    })()`);
    await tick(400);
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
