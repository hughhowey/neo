'use strict';

// Issue #506: real renderer paste/import, with a throwaway library.
// Run: npx electron scripts/incoming-quotes.e2e.js
const { app, BrowserWindow, clipboard } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-incoming-quotes-'));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({
  firstRunDone: true, moreFeatures: true, spellLanguage: 'en-us',
  shelves: [{ id: 'shelf-1', name: 'Test', bookIds: [] }]
}));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
async function main() {
  let failed = false;
  try {
    await app.whenReady();
    let win;
    const deadline = Date.now() + 30000;
    while (!(win = BrowserWindow.getAllWindows()[0])) {
      if (Date.now() > deadline) throw new Error('No NEO window');
      await tick();
    }
    const wc = win.webContents;
    win.focus();
    const js = (code) => wc.executeJavaScript(code, true);
    while (!(await js('typeof library !== "undefined" && !!library').catch(() => false))) {
      if (Date.now() > deadline) throw new Error('Library did not load');
      await tick();
    }
    await js(`(async () => {
      await addImportedBooks([{ name: 'Quotes', chapters: [{ title: 'One', paras: [{ text: "'You aren't,' she replied." }] }] }], library.shelves[0]);
      await openBook(library.shelves[0].bookIds.at(-1));
    })()`);
    const expected = '‘You aren’t,’ she replied.';
    assert.equal(await js("document.querySelector('.chapter-body').textContent"), expected);
    console.log('ok import converts quotation marks and apostrophes');
    for (const mode of ['plain', 'html', 'match']) {
      await js(`(() => {
        const body = document.querySelector('.chapter-body');
        body.innerHTML = '<p><br></p>'; body.focus();
        const range = document.createRange(); range.selectNodeContents(body.firstChild); range.collapse(true);
        getSelection().removeAllRanges(); getSelection().addRange(range);
      })()`);
      // A synthetic paste exercises NEO's real handler, without changing
      // the user's clipboard. Match style uses Electron's native command.
      if (mode === 'match') {
        const previous = clipboard.availableFormats().map((format) => [format, clipboard.readBuffer(format)]);
        try {
          clipboard.writeText("'You aren't,' she replied.");
          wc.pasteAndMatchStyle();
          const until = Date.now() + 3000;
          while (!(await js("document.querySelector('.chapter-body').textContent")) && Date.now() < until) await tick();
        } finally {
          clipboard.clear();
          for (const [format, buffer] of previous) clipboard.writeBuffer(format, buffer);
        }
      } else {
        await js(`(() => {
          const data = new DataTransfer();
          data.setData('text/plain', "'You aren't,' she replied.");
          ${mode === 'html' ? `data.setData('text/html', "<p>'You <i>aren't</i>,' she replied.</p>");` : ''}
          document.querySelector('.chapter-body').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        })()`);
      }
      assert.equal(await js("document.querySelector('.chapter-body').textContent"), expected, mode);
      if (mode === 'html') assert.equal(await js("document.querySelector('.chapter-body i').textContent"), 'aren’t');
      await js("document.execCommand('undo')");
      assert.equal(await js("document.querySelector('.chapter-body').textContent"), '', mode + ' undo');
      console.log('ok ' + mode + ' paste and undo');
    }
  } catch (err) {
    failed = true;
    console.error(err);
  } finally { app.exit(failed ? 1 : 0); }
}
main();
