'use strict';

// #534: whole-book prose alignment, real menu, disk writes, undo and redo.
const { app, BrowserWindow, Menu } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-book-align-'));
const lib = path.join(tmp, 'NEO Library');
fs.mkdirSync(lib);
app.setPath('documents', tmp);
app.setPath('userData', path.join(tmp, 'app'));
fs.writeFileSync(path.join(lib, 'library.json'), JSON.stringify({ firstRunDone: true, moreFeatures: true,
  shelves: [{ id: 's1', name: 'Test', bookIds: [] }] }));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) { return loadFile.call(this, path.resolve(__dirname, '..', file), opts); };
require('../main.js');
let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
async function until(check) {
  const end = Date.now() + 20000;
  while (!(await check())) { if (Date.now() > end) throw new Error('Timed out'); await tick(); }
}
const saved = () => js('(async () => { flushAllSaves(); await Promise.all(Object.values(chapterChain)); await snapChain; })()');
async function main() {
  let failed = false;
  try {
    await app.whenReady();
    await until(async () => BrowserWindow.getAllWindows().length);
    const win = BrowserWindow.getAllWindows()[0];
    wc = win.webContents;
    win.focus();
    await until(() => js('typeof library !== "undefined" && !!library').catch(() => false));
    await js(`(async () => {
      await addImportedBooks([{ name: 'Alignment', chapters: Array.from({ length: 6 }, (_, i) => ({ title: 'One ' + i, paras: [{ text: 'Story words.' }] })) }], library.shelves[0]);
      await openBook(library.shelves[0].bookIds[0]);
      const c = book.chapterOrder;
      chapterHTML[c[0]] = '<p>Plain <i>story</i> text.</p><p class="poetry" style="text-align: center;">A verse.</p><p class="flush">A flush line.</p><p class="scene-break">***</p>';
      chapterHTML[c[1]] = '<p style="text-align: justify;">Already justified.</p>';
      chapterHTML[c[2]] = '<p>Another chapter.</p>';
      setChapterKind(c[3], 'copyright'); chapterHTML[c[3]] = '<p>Copyright notice.</p>';
      setChapterKind(c[4], 'about'); chapterHTML[c[4]] = '<p>My biography.</p>';
      setChapterKind(c[5], 'part'); chapterHTML[c[5]] = '<p style="text-align: center;">Part title.</p>';
      await Promise.all(c.map((id) => persistChapter(id)));
      await saveMeta(); renderChapters();
      undoStack = []; redoStack = [];
      window.__beforeAlign = { ...chapterHTML };
      const body = document.querySelector('.chapter-body'); body.focus();
      const range = document.createRange(); range.setStart(body.querySelector('p').firstChild, 3); range.collapse(true);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      window.__caretBefore = captureCaret();
      updateCounters(); window.__dailyBefore = JSON.stringify(book.dailyCounts || {});
    })()`);
    const ids = await js('book.chapterOrder');
    const bookId = await js('book.id');
    const files = ids.map((id) => path.join(lib, bookId, 'chapters', id + '.html'));
    const original = files.map((file) => ({ text: fs.readFileSync(file, 'utf8'), mtime: fs.statSync(file).mtimeMs }));
    const format = Menu.getApplicationMenu().items.find((i) => i.label === 'Format');
    const menu = format.submenu.items.find((i) => i.label === 'Align Book Prose');
    assert.ok(menu && menu.enabled, 'whole-book menu is available');
    menu.submenu.items.find((i) => i.label === 'Justify').click();
    await until(() => js('undoStack.length === 1'));
    await saved();
    assert.equal(await js('undoStack.length'), 1);
    assert.equal(await js('JSON.stringify(captureCaret()) === JSON.stringify(window.__caretBefore)'), true);
    assert.equal(await js('JSON.stringify(book.dailyCounts || {}) === window.__dailyBefore'), true);
    assert.equal(await js("document.querySelector('.chapter-body p').style.textAlign"), 'justify');
    assert.equal(await js("document.querySelector('.chapter-body i').textContent"), 'story');
    assert.equal(await js("document.querySelector('.chapter-body .poetry').style.textAlign"), 'center');
    assert.equal(await js("document.querySelector('.chapter-body .flush').style.textAlign"), '');
    assert.equal(await js("document.querySelector('.chapter-body .scene-break').style.textAlign"), '');
    for (const i of [1, 3, 4, 5]) {
      assert.equal(fs.readFileSync(files[i], 'utf8'), original[i].text);
      assert.equal(fs.statSync(files[i]).mtimeMs, original[i].mtime, 'unchanged chapter not rewritten');
    }
    console.log('ok real menu aligns prose, preserves formatting, caret and counts, and writes only changed chapters');
    assert.equal(await js("alignBookProse('justify')"), 0);
    assert.equal(await js('undoStack.length'), 1, 'no-op adds no undo entry');
    await js('structuralUndo()');
    await saved();
    for (let i = 0; i < files.length; i++) assert.equal(fs.readFileSync(files[i], 'utf8'), original[i].text);
    console.log('ok one Undo restores the whole book and no-op creates no undo entry');
    await js('structuralRedo()');
    await saved();
    assert.equal(await js("document.querySelector('.chapter-body p').style.textAlign"), 'justify');
    assert.equal(await js("alignBookProse('left')"), 3);
    await saved();
    assert.equal(await js("document.querySelector('.chapter-body p').hasAttribute('style')"), false);
    console.log('ok Redo reapplies alignment and Left removes prose alignment styles');
    await js(`(() => {
      alignBookProse('justify');
      const body = document.querySelector('.chapter-body');
      body.querySelector('p').append(' Later words.');
      body.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' Later words.' }));
    })()`);
    await js('structuralUndo()');
    assert.equal(await js("JSON.stringify(darlings).includes('Later words.')"), true, 'words added after the action stay recoverable');
    console.log('ok Undo protects words written after the alignment action in Darlings');
    const sample = '<p class="ghost">An outline note.</p><p class="poetry">Verse</p><p class="flush">Flush</p><p class="scene-break">***</p>';
    assert.equal(await js(`alignedProseHtml(${JSON.stringify(sample)}, 'justify')`), null);
    await js('library.features.formatting = false');
    assert.equal(await js("alignBookProse('center')"), 0);
    await js("library.features.formatting = true; book.format = 'screenplay'");
    assert.equal(await js("alignBookProse('center')"), 0);
    console.log('ok notes, poetry, flush and breaks stay untouched; simple NEO and scripts stand down');
  } catch (err) { failed = true; console.error(err); }
  finally { app.exit(failed ? 1 : 0); }
}
main();
