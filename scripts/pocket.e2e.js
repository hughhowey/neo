// NEO Pocket's own page (pocket/www/index.html) in a phone-sized window, with
// a stand-in for Capacitor's Filesystem plugin that keeps the library in a
// temporary folder. It checks what only Pocket does: it opens with no
// uncaught error, Options lists only the features Pocket has, and the ⋯ sheet
// follows the features. Run with `npm run test:e2e -- pocket`.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
require('./pocket-www.js'); // the shared editor, copied into pocket/www as the robot build does

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-pocket-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
const lib = path.join(tmp, 'docs', 'NEO Library');
fs.mkdirSync(lib, { recursive: true });
const ALL = { cards: true, notesPages: true, poetry: true, footnotes: true, formatting: true, penNames: true, covers: true, pages: true, focus: true, readAloud: true, vim: false, exports: true };
fs.writeFileSync(path.join(lib, 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, pageTheme: 'night', features: ALL,
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));

// Capacitor, as much of it as the bridge uses: Filesystem over a real folder
const preload = path.join(tmp, 'capacitor-stand-in.js');
fs.writeFileSync(preload, `
const fs = require('fs');
const path = require('path');
const base = ${JSON.stringify(path.join(tmp, 'docs'))};
const cache = ${JSON.stringify(path.join(tmp, 'cache'))};
const real = (o) => path.join(o.directory === 'CACHE' ? cache : base, o.path || '');
const gone = () => new Error('File does not exist');
const Filesystem = {
  async readdir(o) { const d = real(o); if (!fs.existsSync(d)) throw gone(); return { files: fs.readdirSync(d).map((name) => { const s = fs.statSync(path.join(d, name)); return { name, type: s.isDirectory() ? 'directory' : 'file', size: s.size, mtime: s.mtimeMs }; }) }; },
  async mkdir(o) { fs.mkdirSync(real(o), { recursive: !!o.recursive }); },
  async readFile(o) { const f = real(o); if (!fs.existsSync(f)) throw gone(); return { data: fs.readFileSync(f, o.encoding ? 'utf8' : 'base64') }; },
  async writeFile(o) { const f = real(o); if (o.recursive) fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, o.data, o.encoding ? 'utf8' : 'base64'); return { uri: 'file://' + f }; },
  async deleteFile(o) { const f = real(o); if (!fs.existsSync(f)) throw gone(); fs.rmSync(f); },
  async rename(o) { fs.renameSync(real({ path: o.from, directory: o.directory }), real({ path: o.to, directory: o.toDirectory || o.directory })); },
  async rmdir(o) { fs.rmSync(real(o), { recursive: !!o.recursive, force: true }); },
  async stat(o) { const f = real(o); if (!fs.existsSync(f)) throw gone(); const s = fs.statSync(f); return { type: s.isDirectory() ? 'directory' : 'file', size: s.size, mtime: s.mtimeMs, uri: 'file://' + f }; },
  async getUri(o) { return { uri: 'file://' + real(o) }; }
};
window.pocketShared = [];
window.Capacitor = {
  getPlatform: () => 'android',
  isNativePlatform: () => true,
  Plugins: { Filesystem, Share: { share: async (o) => { window.pocketShared.push(o.title); } } },
  registerPlugin: (name) => new Proxy({}, { get: () => async () => { throw new Error(name + ' is not in this test'); } })
};
`);

const errors = [];
app.on('web-contents-created', (_e, contents) => {
  contents.on('console-message', (...args) => {
    const msg = typeof args[0] === 'object' && args[0] && 'message' in args[0] ? args[0].message : args[2];
    if (/Uncaught|is not defined|before initialization/.test(String(msg))) errors.push(String(msg));
  });
});

const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
let js;
let failed = 0;
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); } catch (err) { failed++; console.log('FAIL ' + name + '\n     ' + String(err && err.stack || err).split('\n').slice(0, 6).join('\n     ')); }
}
const until = async (code, what) => {
  for (let i = 0; i < 150; i++) { if (await js(code).catch(() => false)) return; await tick(50); }
  throw new Error('waited for ' + what);
};
const openSheet = async () => {
  await js(`document.getElementById('pocket-menu').hidden || document.getElementById('pocket-more').click()`);
  await js(`document.getElementById('pocket-more').click()`);
  await tick(150);
  return js(`document.getElementById('pocket-menu-sheet').innerText`);
};

async function main() {
  await app.whenReady();
  try {
    const win = new BrowserWindow({ width: 412, height: 860, show: false, webPreferences: { preload, contextIsolation: false, nodeIntegration: false, sandbox: false } });
    js = (code) => win.webContents.executeJavaScript(code, true);
    await win.loadFile(path.join(root, 'pocket', 'www', 'index.html'));
    await until(`typeof library !== 'undefined' && !!library && !!library.features`, 'the library');
    await tick(500);
    await js(`(async () => {
      await addImportedBooks([{ name: 'Pocket Test', chapters: [{ title: 'One', paras: [{ text: 'A line of words to set the page.' }] }] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
    })()`);
    await until(`!document.getElementById('editor-view').hidden`, 'the book');
    await tick(600);

    await test('Pocket opens the shelf and a book with no uncaught error', async () => {
      assert.deepEqual(errors, []);
    });

    await test('Pocket keeps the desktop-only features off even when the library has them on', async () => {
      const on = await js(`FEATURES.filter((f) => featureOn(f.key)).map((f) => f.key)`);
      assert.deepEqual(on.sort(), ['cards', 'exports', 'footnotes', 'notesPages', 'penNames', 'poetry']);
    });

    await test('the ⋯ sheet shows Poetry, the extra exports and Options while those are on', async () => {
      const text = await openSheet();
      assert.match(text, /Poetry paragraph/);
      assert.match(text, /Markdown/);
      assert.match(text, /HTML/);
      assert.match(text, /Options…/);
    });

    await test('Options… in the sheet opens Options, with only Pocket\'s features and no interface size', async () => {
      await js(`[...document.querySelectorAll('#pocket-menu-sheet button')].find((b) => b.textContent === 'Options…').click()`);
      await until(`!!document.querySelector('.options-modal')`, 'Options');
      const boxes = await js(`[...document.querySelectorAll('.options-modal [data-opt^="feature:"]')].map((b) => b.dataset.opt.slice(8))`);
      assert.deepEqual(boxes.sort(), ['cards', 'exports', 'footnotes', 'notesPages', 'penNames', 'poetry', 'vim']);
      assert.equal(await js(`!!document.querySelector('.options-modal [data-zoom]')`), false);
      assert.equal(await js(`document.getElementById('pocket-menu').hidden`), true);
      assert.match(await js(`document.querySelector('.options-modal').innerText`), /Plain text, Markdown and web page, beside Word and EPUB\./);
    });

    await test('turning Poetry and More exports off in Options takes them out of the sheet', async () => {
      for (const key of ['poetry', 'exports']) {
        await js(`(() => { const b = document.querySelector('.options-modal [data-opt="feature:${key}"]'); b.checked = false; b.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await tick(150);
      }
      await js(`document.querySelector('.options-modal .m-ok').click()`);
      const text = await openSheet();
      assert.doesNotMatch(text, /Poetry paragraph/);
      assert.doesNotMatch(text, /Markdown/);
      assert.match(text, /Word/);
      const saved = JSON.parse(fs.readFileSync(path.join(lib, 'library.json'), 'utf8'));
      assert.equal(saved.features.poetry, false);
      assert.equal(saved.features.exports, false);
      assert.equal(saved.features.pages, true, 'a desktop feature Pocket doesn\'t show stays as the desktop left it');
    });

    await test('Turn all on in Options on Pocket leaves the desktop-only features as they were', async () => {
      await js(`document.querySelector('[data-act="close"]') && document.querySelector('[data-act="close"]').click()`);
      await js(`openOptions()`);
      await until(`!!document.querySelector('.options-modal')`, 'Options');
      await js(`document.querySelector('.options-modal .opt-all').click()`);
      await tick(200);
      const saved = JSON.parse(fs.readFileSync(path.join(lib, 'library.json'), 'utf8'));
      assert.equal(saved.features.poetry, true);
      assert.equal(saved.features.vim, true);
      assert.equal(saved.features.covers, true);
      await js(`document.querySelector('.options-modal .opt-all').click()`); // all off
      await tick(200);
      const off = JSON.parse(fs.readFileSync(path.join(lib, 'library.json'), 'utf8'));
      assert.equal(off.features.poetry, false);
      assert.equal(off.features.covers, true, 'covers is the desktop\'s, untouched by Pocket');
      await js(`document.querySelector('.options-modal .m-ok').click()`);
    });

    await test('with the features on, Pocket\'s Outline shows cards, and a footnote and vim keys work', async () => {
      await js(`(async () => { library.features = { ...library.features, cards: true, notesPages: true, footnotes: true, vim: true }; await writeLibrary(library); reportFeatures(); applyLook(); })()`);
      await js(`switchTab('outline')`);
      await tick(400);
      assert.equal(await js(`!!document.querySelector('#outline-board') && !document.querySelector('#outline-board').hidden`), true, 'the cards board shows');
      await js(`switchTab('manuscript')`);
      await tick(300);
      const before = await js(`document.querySelectorAll('.chapter-body span.fn').length`);
      await js(`(() => { const p = document.querySelector('.chapter-body > p'); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); insertFootnote(); })()`);
      await tick(300);
      assert.ok(await js(`document.querySelectorAll('.chapter-body span.fn').length`) > before, 'a footnote mark went in');
      assert.equal(await js(`vimEnabled`), true);
      await js(`document.activeElement && document.activeElement.blur && document.activeElement.blur()`);
      assert.deepEqual(errors, []);
    });

    await test('a book still opens cleanly after all that', async () => {
      assert.deepEqual(errors, []);
    });
    console.log(`\n${passed} passed, ${failed} failed`);
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    app.exit(failed ? 1 : 0);
  }
}
main();
