'use strict';

// Files brought into an open book as chapters (#178): the window's side
// (app.js, with the disk stubbed out) and File → Import Chapters… in the
// menu, which waits for a book to be open.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');

// ---- the window ----
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const from = app.indexOf('// One imported chapter\'s paragraphs as a chapter body');
const to = app.indexOf('async function importBooks()');
assert.ok(from > 0 && to > from, 'the import-chapters code is where the test expects it');

function room(opts = {}) {
  const log = [];
  const ctx = vm.createContext({
    book: opts.book === undefined ? { id: 'b1', title: 'My Book', chapterOrder: ['c1', 'c2'], chapterTitles: {} } : opts.book,
    chapterHTML: { c1: '<p>one</p>', c2: '<p>two</p>' },
    undoStack: [],
    currentTab: 'manuscript',
    currentChapterId: opts.currentChapterId || null,
    log,
    t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m)),
    toast: (msg) => log.push('toast ' + msg),
    escHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    dialogueDashes: (s) => s,
    dashStyle: () => 'em',
    isScript: () => !!(opts.script),
    snapshotStructure: (label) => { log.push('snapshot ' + label); ctx.undoStack.push({ label }); },
    persistChapter: async (chId) => {
      if (opts.failOn && ctx.chapterHTML[chId] && ctx.chapterHTML[chId].includes(opts.failOn)) throw new Error('disk full');
      log.push('write ' + chId);
    },
    saveMeta: async () => log.push('meta ' + ctx.book.chapterOrder.length),
    renderChapters: () => {},
    renderOutline: () => {},
    updateCounters: () => {},
    $: () => ({ hidden: false }),
    window: { neo: { logError: (m) => log.push('logError ' + m), importPick: async () => opts.picked || [] } }
  });
  vm.runInContext(app.slice(from, to), ctx);
  return ctx;
}
const chapter = (title, ...texts) => ({ title, paras: texts.map((t) => (t === '***' ? { scene: true } : { text: t })) });
const plain = (o) => JSON.parse(JSON.stringify(o));

describe('importing chapters into the open book', () => {
  test('chapters go in before the chapter named, in file order, with their titles', async () => {
    const ctx = room();
    const n = await ctx.importChaptersIntoBook([
      { name: 'a', title: null, chapters: [chapter('First', 'Alpha.'), chapter('', 'Beta.', '***', 'Gamma.')] },
      { name: 'b', title: null, chapters: [chapter('Third', 'Delta.')] }
    ], 'c2');
    assert.equal(n, 3);
    const order = ctx.book.chapterOrder;
    assert.equal(order.length, 5);
    assert.equal(order[0], 'c1');
    assert.equal(order[4], 'c2');
    const added = order.slice(1, 4);
    assert.deepEqual(added.map((id) => ctx.chapterHTML[id]), [
      '<p>Alpha.</p>', '<p>Beta.</p><p class="scene-break">***</p><p>Gamma.</p>', '<p>Delta.</p>'
    ]);
    assert.deepEqual(plain(added.map((id) => ctx.book.chapterTitles[id] || '')), ['First', '', 'Third']);
  });

  test('every chapter file is written before book.json names it, after one undo snapshot', async () => {
    const ctx = room();
    await ctx.importChaptersIntoBook([{ name: 'a', chapters: [chapter('', 'x'), chapter('', 'y')] }], null);
    const log = ctx.log.filter((l) => !l.startsWith('toast'));
    assert.equal(log[0], 'snapshot chapters imported');
    assert.ok(log[1].startsWith('write ') && log[2].startsWith('write '));
    assert.equal(log[3], 'meta 4');
    assert.equal(ctx.undoStack.length, 1);
  });

  test('with no chapter to go before, they go at the end', async () => {
    const ctx = room();
    await ctx.importChaptersIntoBook([{ name: 'a', chapters: [chapter('', 'x')] }], null);
    assert.equal(ctx.book.chapterOrder.slice(0, 2).join(), 'c1,c2');
    assert.equal(ctx.book.chapterOrder.length, 3);
  });

  test('a one-chapter file with no heading takes the title harvested from its first line', async () => {
    const ctx = room();
    await ctx.importChaptersIntoBook([{ name: 'storm', title: 'The Storm', chapters: [chapter('', 'Rain.')] }], null);
    assert.equal(ctx.book.chapterTitles[ctx.book.chapterOrder[2]], 'The Storm');
  });

  test('in a file of several chapters, the harvested title (the old book\'s) names none of them', async () => {
    const ctx = room();
    await ctx.importChaptersIntoBook([{ name: 'old', title: 'OLD NOVEL', chapters: [chapter('', 'a'), chapter('', 'b')] }], null);
    assert.deepEqual(plain(ctx.book.chapterTitles), {});
  });

  test('scripts and unreadable files are reported and left out', async () => {
    const ctx = room();
    const n = await ctx.importChaptersIntoBook([
      { name: 'x.fdx', script: 'fdx', source: '' },
      { name: 'bad.docx', error: 'Not a valid .docx' },
      { name: 'ok', chapters: [chapter('', 'Fine.')] }
    ], null);
    assert.equal(n, 1);
    assert.equal(ctx.log.filter((l) => l.startsWith('toast Couldn’t import')).length, 2);
  });

  test('nothing to add leaves the book and the undo stack alone', async () => {
    const ctx = room();
    assert.equal(await ctx.importChaptersIntoBook([{ name: 'bad', error: 'nope' }], null), 0);
    assert.equal(ctx.book.chapterOrder.length, 2);
    assert.equal(ctx.undoStack.length, 0);
  });

  test('a script open in the window takes no chapters', async () => {
    const ctx = room({ script: true });
    assert.equal(await ctx.importChaptersIntoBook([{ name: 'a', chapters: [chapter('', 'x')] }], null), 0);
    assert.equal(ctx.book.chapterOrder.length, 2);
  });

  test('a failed write leaves book.json as it was and says so', async () => {
    const ctx = room({ failOn: 'Second' });
    const n = await ctx.importChaptersIntoBook([{ name: 'a', chapters: [chapter('', 'First'), chapter('', 'Second')] }], null);
    assert.equal(n, 0);
    assert.deepEqual(plain(ctx.book.chapterOrder), ['c1', 'c2']);
    assert.ok(!ctx.log.some((l) => l.startsWith('meta')));
    assert.ok(ctx.log.some((l) => l.startsWith('toast Couldn’t import the chapters')));
    assert.equal(ctx.undoStack.length, 0);
    assert.deepEqual(Object.keys(ctx.chapterHTML), ['c1', 'c2']);
  });

  test('File → Import Chapters… puts them after the chapter the writer is in', async () => {
    const ctx = room({ currentChapterId: 'c1', picked: [{ name: 'a', chapters: [chapter('', 'x')] }] });
    await ctx.importChapters();
    assert.equal(ctx.book.chapterOrder[0], 'c1');
    assert.equal(ctx.book.chapterOrder[2], 'c2');
    assert.equal(ctx.chapterHTML[ctx.book.chapterOrder[1]], '<p>x</p>');
  });
});

// ---- the menu ----
describe('File → Import Chapters…', () => {
  const localRequire = createRequire(path.join(root, 'main.js'));
  const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const on = new Map();
  const handlers = new Map();
  let menu = null;
  let dialogOpts = null;
  const electron = {
    app: { commandLine: { appendSwitch() {} }, getPath: () => os.tmpdir(), getLocale: () => 'en', requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {} },
    ipcMain: { on: (name, fn) => on.set(name, fn), handle: (name, fn) => handlers.set(name, fn) },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    Menu: { buildFromTemplate: (items) => items, setApplicationMenu: (m) => { menu = m; } },
    dialog: { showMessageBox: () => Promise.resolve({}), showOpenDialog: async (_w, o) => { dialogOpts = o; return { canceled: true, filePaths: [] }; } },
    utilityProcess: { fork: () => ({ on() {}, postMessage() {} }) },
    screen: {}
  };
  vm.runInContext(source, vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: root, process: { platform: process.platform, on() {} }, console
  }), { filename: path.join(root, 'main.js') });
  const item = () => {
    const file = menu.find((m) => m.label === 'File');
    return file.submenu.find((m) => m.label === 'Import Chapters…');
  };

  test('is there and waits for a book, and a script takes none', () => {
    on.get('script:state')(null, { book: true, on: false });
    assert.equal(item().enabled, true);
    on.get('script:state')(null, { book: false, on: false });
    assert.equal(item().enabled, false);
    on.get('script:state')(null, { book: true, on: true, element: 'action' });
    assert.equal(item().enabled, false);
  });

  test('its picker offers prose files only', async () => {
    await handlers.get('import:pick')(null, { chapters: true });
    assert.deepEqual(plain(dialogOpts.filters[0].extensions), ['docx', 'txt', 'md']);
    await handlers.get('import:pick')(null);
    assert.ok(dialogOpts.filters[0].extensions.includes('fountain'));
  });
});
