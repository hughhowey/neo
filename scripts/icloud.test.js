'use strict';

// Files iCloud has taken off a Mac ("Optimize Mac Storage") are placeholders:
// a read waits on iCloud, forever when iCloud is stuck, and NEO froze at
// launch with no window. The real main.js runs against a temporary library,
// with iCloud played by the test: a "placeholder" is a sparse file (a size and
// no blocks on disk, as a placeholder looks), and "downloading" one writes its
// words in.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const localRequire = createRequire(path.join(root, 'main.js'));
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

function loadMain() {
  const handlers = new Map();
  const electron = {
    app: {
      commandLine: { appendSwitch() {} },
      getPath: () => os.tmpdir(),
      getLocale: () => 'en',
      requestSingleInstanceLock: () => true,
      whenReady: () => ({ then() {} }),
      on() {}
    },
    ipcMain: { on() {}, handle: (name, fn) => handlers.set(name, fn) },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
    dialog: { showMessageBox: () => Promise.resolve({}) },
    utilityProcess: { fork: () => ({ on() {}, postMessage() {} }) },
    screen: {}
  };
  const asked = [];
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: root,
    process: { platform: 'darwin', on() {} },
    console,
    setTimeout,
    libraryRoot: os.tmpdir(),
    asked,
    arrivals: new Map() // file → words iCloud brings down when asked
  });
  vm.runInContext(source, context, { filename: path.join(root, 'main.js') });
  // a placeholder is a file with a size and no blocks; asking for one brings
  // its words down a moment later, if iCloud has them to give
  vm.runInContext(`
    cloudOnlyAmong = (files) => new Set(files.filter((f) => {
      try { const st = fs.statSync(f); return st.size > 0 && st.blocks === 0; } catch { return false; }
    }));
    requestDownload = (files) => {
      for (const f of files) {
        asked.push(f);
        if (arrivals.has(f)) setTimeout(() => fs.writeFileSync(f, arrivals.get(f)), 50);
      }
    };
    CLOUD_WAIT = 600;
  `, context);
  return {
    context,
    asked,
    call: (name, ...args) => handlers.get(name)(null, ...args),
    run: (code) => vm.runInContext(code, context),
    pointAt(dir) {
      context.libraryRoot = dir;
      vm.runInContext('LIBRARY_DIR = libraryRoot; LIBRARY_FILE = require("path").join(libraryRoot, "library.json");', context);
    }
  };
}

const main = loadMain();

// a placeholder for `file`: the same size, no words on this Mac
function sendToICloud(file) {
  const size = fs.statSync(file).size;
  fs.rmSync(file);
  fs.closeSync(fs.openSync(file, 'w'));
  fs.truncateSync(file, size);
  assert.equal(fs.statSync(file).blocks, 0, 'this disk makes sparse files');
}

function libraryWithBook() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-icloud-'));
  main.pointAt(dir);
  const lib = main.call('library:read');
  const book = main.call('book:create', { title: 'Salt Roads' });
  main.call('chapter:write', book.id, 'ch-aaa', '<p>The harbor was empty.</p>');
  book.chapterOrder = ['ch-aaa'];
  main.call('book:writeMeta', book.id, book);
  main.call('book:writeMeta', book.id, book); // a .bak, as a real library has
  main.call('aux:write', book.id, 'notes', '<p>Ferry at dawn.</p>');
  lib.firstRunDone = true;
  lib.shelves[0].bookIds.push(book.id);
  main.call('library:write', lib);
  main.call('library:write', lib);
  return { dir, book, bookDir: path.join(dir, book.id) };
}

describe('files still in iCloud', { concurrency: 1 }, () => {
  test('everything on this Mac: reads answer at once, as before', () => {
    const { book } = libraryWithBook();
    assert.equal(main.call('chapter:read', book.id, 'ch-aaa'), '<p>The harbor was empty.</p>');
    assert.equal(main.call('book:readMeta', book.id).title, 'Salt Roads');
  });

  test('a chapter in iCloud is waited for without holding NEO up, then read', async () => {
    const { book, bookDir } = libraryWithBook();
    const file = path.join(bookDir, 'chapters', 'ch-aaa.html');
    const words = fs.readFileSync(file, 'utf8');
    sendToICloud(file);
    main.context.arrivals.set(file, words);
    const answer = main.call('chapter:read', book.id, 'ch-aaa');
    assert.ok(answer instanceof Promise || typeof answer.then === 'function', 'not read on the spot');
    assert.equal(await answer, words);
    assert.ok(main.asked.includes(file), 'iCloud was asked for it');
  });

  test('library.json in iCloud arrives and the shelf is read', async () => {
    const { dir, book } = libraryWithBook();
    const file = path.join(dir, 'library.json');
    const words = fs.readFileSync(file, 'utf8');
    sendToICloud(file);
    main.context.arrivals.set(file, words);
    const lib = await main.call('library:read');
    assert.ok(lib.shelves[0].bookIds.includes(book.id));
  });

  test('library.json iCloud never sends: an error, and no new shelf written over it', async () => {
    const { dir } = libraryWithBook();
    const file = path.join(dir, 'library.json');
    sendToICloud(file);
    await assert.rejects(Promise.resolve(main.call('library:read')), (err) => err.code === 'ECLOUD');
    assert.equal(fs.statSync(file).blocks, 0, 'left as it was');
  });

  test('book.json iCloud never sends: the book waits, never rebuilt or rolled back to .bak', async () => {
    const { book, bookDir } = libraryWithBook();
    const file = path.join(bookDir, 'book.json');
    sendToICloud(file);
    assert.equal(await main.call('book:readMeta', book.id), null);
    assert.equal(fs.statSync(file).blocks, 0, 'not written over');
  });

  test('a save never goes over a chapter or notes still in iCloud', () => {
    const { book, bookDir } = libraryWithBook();
    const ch = path.join(bookDir, 'chapters', 'ch-aaa.html');
    const notes = path.join(bookDir, 'notes.html');
    sendToICloud(ch);
    sendToICloud(notes);
    assert.throws(() => main.call('chapter:write', book.id, 'ch-aaa', '<p>new</p>', ''), (err) => err.code === 'ECLOUD');
    assert.throws(() => main.call('aux:write', book.id, 'notes', '<p>new</p>'), (err) => err.code === 'ECLOUD');
    assert.equal(fs.statSync(ch).blocks, 0);
    assert.equal(fs.statSync(notes).blocks, 0);
  });

  test("the daily backup leaves out what's in iCloud and says so, instead of waiting on it", async () => {
    const { dir, bookDir } = libraryWithBook();
    sendToICloud(path.join(bookDir, 'chapters', 'ch-aaa.html'));
    await main.run('backupRunning = false; dailyBackup()');
    const zips = fs.readdirSync(path.join(dir, 'Backups'));
    assert.equal(zips.length, 1);
    const JSZip = localRequire('jszip');
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(dir, 'Backups', zips[0])));
    const note = await zip.file('_left-out-of-this-backup.txt').async('string');
    assert.match(note, /ch-aaa\.html \(in iCloud, not on this Mac\)/);
    assert.ok(zip.file(path.basename(bookDir) + '/notes.html'), 'the rest is backed up');
  });
});
