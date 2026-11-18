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
    // the backup's own process: the real backup-worker.js, as a Node child
    utilityProcess: {
      fork: (file) => {
        const child = require('node:child_process').fork(file, [], { env: { ...process.env, NEO_TEST_SPARSE_IS_CLOUD: '1' } });
        return {
          on: (ev, fn) => child.on(ev, ev === 'exit' ? (code) => fn(code || 0) : fn),
          postMessage: (m) => child.send(m),
          kill: () => child.kill()
        };
      }
    },
    screen: {}
  };
  const asked = [];
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: root,
    process: { platform: 'darwin', on() {} },
    console,
    setTimeout,
    clearTimeout,
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

  test('book metadata saves wait for the iCloud file before comparing chapter order', () => {
    const { book, bookDir } = libraryWithBook();
    const file = path.join(bookDir, 'book.json');
    const later = { ...book, chapterOrder: ['ch-aaa', 'ch-bbb'] };
    const backup = fs.readFileSync(file + '.bak', 'utf8');
    const edited = { ...book, title: 'A new title' };
    sendToICloud(file);

    assert.throws(() => main.call('book:writeMeta', book.id, edited, ['ch-aaa']), (err) => err.code === 'ECLOUD');
    assert.equal(fs.statSync(file).blocks, 0);
    assert.equal(fs.readFileSync(file + '.bak', 'utf8'), backup);
    assert.ok(main.asked.includes(file));

    fs.writeFileSync(file, JSON.stringify(later));
    assert.deepEqual(Array.from(main.call('book:writeMeta', book.id, edited, ['ch-aaa']).unseen), ['ch-bbb']);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).chapterOrder, later.chapterOrder);
    const stamp = main.call('book:writeMeta', book.id, { ...edited, chapterOrder: later.chapterOrder }, later.chapterOrder);
    assert.equal(typeof stamp, 'string');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).title, 'A new title');
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
    const zips = fs.readdirSync(path.join(dir, 'Backups')).filter((f) => f.endsWith('.zip'));
    assert.equal(zips.length, 1);
    const JSZip = localRequire('jszip');
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(dir, 'Backups', zips[0])));
    const note = await zip.file('_left-out-of-this-backup.txt').async('string');
    assert.match(note, /ch-aaa\.html \(in iCloud, not on this Mac\)/);
    assert.ok(zip.file(path.basename(bookDir) + '/notes.html'), 'the rest is backed up');
  });

  // a file that never answers (a named pipe: a read of one waits for ever, as
  // a stuck iCloud file does) once held NEO's whole main process, at launch
  test('a file that never answers is left out of the backup, and NEO goes on meanwhile', async () => {
    const { dir, bookDir } = libraryWithBook();
    const stuck = path.join(bookDir, 'stickies.json');
    fs.rmSync(stuck, { force: true });
    require('node:child_process').execFileSync('mkfifo', [stuck]);
    main.run('BACKUP_FILE_LIMIT_MS = 300');
    let ticks = 0;
    const beat = setInterval(() => { ticks++; }, 20);
    const t0 = Date.now();
    await main.run('backupRunning = false; dailyBackup()');
    clearInterval(beat);
    assert.ok(Date.now() - t0 < 10000, 'the backup finished');
    assert.ok(ticks > 5, 'this process kept running while the backup waited');
    const zips = fs.readdirSync(path.join(dir, 'Backups')).filter((f) => f.endsWith('.zip'));
    assert.equal(zips.length, 1);
    const JSZip = localRequire('jszip');
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(dir, 'Backups', zips[0])));
    assert.match(await zip.file('_left-out-of-this-backup.txt').async('string'), /stickies\.json \(not handed over in time\)/);
    assert.ok(zip.file(path.basename(bookDir) + '/book.json'), 'the rest is backed up');
    main.run('BACKUP_FILE_LIMIT_MS = 20000');
  });
});

test('the next flush retries a metadata write that held only a caret move', async () => {
  const app = require('./app-files').appSource();
  const saving = app.slice(app.indexOf('function metaSig('), app.indexOf('/*  SNAPSHOTS'));
  const errors = [];
  let attempts = 0;
  const run = (s) => vm.runInContext(s, ctx);
  const ctx = vm.createContext({
    book: { id: 'b', chapterOrder: [], lastPosition: { chapterId: 'a', pIdx: 0, scroll: 0 } },
    currentChapterId: 'a', currentTab: 'manuscript', captureCaret: () => ({ chId: 'a', pIdx: 1 }),
    shelfExport: false, knownChapters: new Set(), savedOrder: [],
    $: () => ({ scrollTop: 0 }), flushAux() {}, flushStickiesSave() {}, flushSidecars() {},
    window: { neo: { logError: (e) => errors.push(e) } },
    writeBookMeta: async () => {
      if (++attempts === 1) throw new Error('Still in iCloud');
      return 'saved';
    }
  });
  run(saving + '\nlet savedMetaSig = metaSig(book);');
  run("flushAllSaves('tick')");
  await new Promise(setImmediate);
  assert.equal(attempts, 1);
  assert.match(errors[0], /Still in iCloud/);
  run("flushAllSaves('tick')");
  await new Promise(setImmediate);
  assert.equal(attempts, 2, 'the same caret position is retried');
  run("flushAllSaves('tick')");
  assert.equal(attempts, 2, 'the successful retry clears the pending save');
});
