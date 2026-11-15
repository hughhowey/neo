'use strict';

// Real filesystem/renderer regression: rapid incremental snapshots, reopen,
// restore, and undo. The user's library is never opened.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-snapshot-order-'));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({ firstRunDone: true, moreFeatures: true,
  shelves: [{ id: 'shelf-1', name: 'Tests', bookIds: [] }] }));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) { return loadFile.call(this, path.resolve(__dirname, '..', file), opts); };
require('../main.js');
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

(async () => {
  await app.whenReady();
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick();
    const js = (code) => win.webContents.executeJavaScript(code, true);
    while (!(await js('typeof library !== "undefined" && !!library').catch(() => false))) await tick();
    await js(`(async () => {
      await addImportedBooks([{ name: 'Rapid saves', chapters: [
        { title: 'First', paras: [{ text: 'Original first chapter.' }] },
        { title: 'Second', paras: [{ text: 'Unchanged second chapter.' }] }
      ] }], library.shelves[0]);
      await openBook(library.shelves[0].bookIds.at(-1));
      const realNow = Date.now;
      Date.now = () => Date.UTC(2026, 10, 15, 12, 0, 0, 100);
      try {
        window.testIds = book.chapterOrder.filter((c) => isStory(c));
        window.testOriginal = testIds.map((c) => chapterHTML[c]);
        window.testFirst = (await takeSnapshot('k')).snap.name;
        chapterHTML[testIds[0]] = '<p>Changed first chapter.</p>';
        window.testSecond = (await takeSnapshot('k')).snap.name;
      } finally { Date.now = realNow; }
      await persistChapter(testIds[0]);
      const id = book.id;
      await backToShelf();
      await openBook(id);
    })()`);
    const got = await js(`(async () => {
      const list = await loadSnaps(book.id, true);
      const saved = await snapshotBook(book.id, testSecond);
      return { order: list.filter((s) => [testFirst, testSecond].includes(s.name)).map((s) => s.name),
        expected: [testFirst, testSecond], chapters: saved.chapters.filter((c) => testIds.includes(c.chId)).map((c) => c.html), original: testOriginal };
    })()`);
    assert.deepEqual(got.order, got.expected);
    assert.equal(got.chapters[0], '<p>Changed first chapter.</p>');
    assert.equal(got.chapters[1], got.original[1]);
    console.log('ok rapid incremental snapshots reconstruct both chapters after reopening');
    await js(`(async () => { switchTab('darlings'); await showSnapshot(testFirst); await restoreSnapshot(null); })()`);
    assert.deepEqual(await js('testIds.map((c) => chapterHTML[c])'), got.original);
    console.log('ok whole-book restore retains unchanged chapter');
    await js('structuralUndo()');
    assert.equal(await js('chapterHTML[testIds[0]]'), '<p>Changed first chapter.</p>');
    assert.equal(await js('chapterHTML[testIds[1]]'), got.original[1]);
    console.log('ok undo restores later writing');
    app.exit(0);
  } catch (err) { console.error(err); app.exit(1); }
})();
