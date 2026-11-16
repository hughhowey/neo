'use strict';

// #464: the count saved since the preceding snapshot and the chapter links
// comparing with today's manuscript must identify their different baselines.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-snapshot-comparison-'));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const lib = path.join(tmp, 'NEO Library');
fs.mkdirSync(lib);
fs.writeFileSync(path.join(lib, 'library.json'), JSON.stringify({ firstRunDone: true, moreFeatures: true,
  shelves: [{ id: 's1', name: 'Test', bookIds: [] }] }));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) { return loadFile.call(this, path.resolve(__dirname, '..', file), opts); };
require('../main.js');
const tick = () => new Promise((resolve) => setTimeout(resolve, 40));
let wc;
const js = (code) => wc.executeJavaScript(code, true);
async function until(check) {
  const end = Date.now() + 20000;
  while (!(await check())) { if (Date.now() > end) throw new Error('Timed out'); await tick(); }
}
async function main() {
  let failed = false;
  try {
    await app.whenReady();
    await until(async () => BrowserWindow.getAllWindows().length);
    const win = BrowserWindow.getAllWindows()[0];
    wc = win.webContents;
    await until(() => js('typeof library !== "undefined" && !!library').catch(() => false));
    await js(`(async () => {
      await addImportedBooks([{ name: 'History', chapters: Array.from({ length: 5 }, (_, i) => ({ title: 'Chapter ' + i, paras: [{ text: 'Original words ' + i }] })) }], library.shelves[0]);
      await openBook(library.shelves[0].bookIds[0]);
      window.__realNow = Date.now;
      window.__clock = Date.now();
      Date.now = () => window.__clock;
      window.__first = (await takeSnapshot('k')).snap.name;
      window.__clock += 2000;
      chapterHTML[book.chapterOrder[0]] = '<p>One revised chapter.</p>';
      window.__second = (await takeSnapshot('k')).snap.name;
      window.__clock += 2000;
      book.chapterOrder.forEach((c, i) => { chapterHTML[c] = '<p>Later words ' + i + '</p>'; });
      window.__third = (await takeSnapshot('k')).snap.name;
      Date.now = window.__realNow;
      chapterHTML[book.chapterOrder[0]] = '<p>The newest words.</p>';
      renderChapters();
      switchTab('darlings');
      await showSnapshot(window.__second);
      await renderSnapList();
    })()`);
    assert.match(await js("document.querySelector('#snap-list .snap-item.on .snap-s').textContent"), /1 chapter changed since previous snapshot/);
    assert.equal(await js("document.querySelector('.snap-comparison').textContent"), '5 chapters differ from now');
    assert.equal(await js("document.querySelectorAll('.snap-chapters .snap-ch').length"), 5);
    const disk = await js('snapshotBook(book.id, window.__second)');
    assert.equal(disk.meta.changed.length, 1);
    assert.equal(disk.chapters.length, 5, 'unchanged chapters reconstructed from earlier snapshots');
    console.log('ok one saved chapter and five current differences have separate labels');

    await js('showSnapshot(window.__third);');
    await js('renderSnapList()');
    assert.match(await js("document.querySelector('#snap-list .snap-item.on .snap-s').textContent"), /5 chapters changed since previous snapshot/);
    assert.equal(await js("document.querySelector('.snap-comparison').textContent"), '1 chapter differs from now');
    assert.equal(await js("document.querySelectorAll('.snap-chapters .snap-ch').length"), 1);
    console.log('ok five saved chapters and one current difference stay distinct');

    await js(`(async () => {
      const got = await snapshotBook(book.id, window.__third);
      for (const ch of got.chapters) chapterHTML[ch.chId] = ch.html;
      renderChapters();
      await showSnapshot(window.__third);
      await renderSnapList();
    })()`);
    assert.equal(await js("document.querySelector('.snap-comparison').textContent"), 'Every chapter is the same as now');
    assert.equal(await js("document.querySelectorAll('.snap-chapters .snap-ch').length"), 0);
    console.log('ok a matching manuscript is labelled explicitly with no chapter links');

    await js('showSnapshot(window.__first)');
    await js('renderSnapList()');
    assert.match(await js("document.querySelector('#snap-list .snap-item.on .snap-s').textContent"), /The whole book/);
    assert.equal(await js("document.querySelectorAll('.snap-chapters .snap-ch').length"), 5);
    console.log('ok the initial full snapshot still compares with the current manuscript');
  } catch (err) { failed = true; console.error(err); }
  finally { app.exit(failed ? 1 : 0); }
}
main();
