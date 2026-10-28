'use strict';

// Snapshot thinning: a chapter the old snapshot can't give back must
// stop the thinning, never become an empty chapter in the next snapshot.
// Covers the main-process handlers (through IPC, and through preload.js's
// forwarding), and thinSnapshots in app.js run against an in-memory library.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const localRequire = createRequire(path.join(root, 'main.js'));

// ---- main.js handlers, as IPC ----
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
    dialog: {},
    utilityProcess: { fork: () => ({ on() {}, postMessage() {} }) },
    screen: {}
  };
  const context = vm.createContext({
    require: (name) => (name === 'electron' ? electron : localRequire(name)),
    __dirname: root,
    process: { platform: process.platform, on() {} },
    console,
    setTimeout,
    libraryRoot: os.tmpdir()
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: path.join(root, 'main.js') });
  return {
    context,
    call: (name, ...args) => handlers.get(name)(null, ...args),
    // a file iCloud has not brought down: the test names them
    setCloudOnly(files) {
      context.cloudFiles = new Set(files);
      vm.runInContext(`
        cloudOnlyAmong = (files) => new Set(files.filter((f) => cloudFiles.has(f)));
        requestDownload = () => {};
        CLOUD_WAIT = 50;
      `, context);
    },
    pointAt(dir) {
      context.libraryRoot = dir;
      vm.runInContext('LIBRARY_DIR = libraryRoot; LIBRARY_FILE = require("path").join(libraryRoot, "library.json");', context);
    }
  };
}

const main = loadMain();

function snapshotWithFiles(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-thin-'));
  main.pointAt(dir);
  const book = main.call('book:create', { title: 'Salt Roads' });
  const snapDir = path.join(dir, book.id, 'snapshots', '20261001T000000Z-d-1-10-aaaa');
  fs.mkdirSync(snapDir, { recursive: true });
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(snapDir, file), text);
  return { bookId: book.id, name: '20261001T000000Z-d-1-10-aaaa', snapDir };
}

describe('snapshot:read reports what it cannot read', { concurrency: 1 }, () => {
  test('a missing chapter file throws, it does not read as an empty chapter', async () => {
    const { bookId, name } = snapshotWithFiles({ 'ch-a.html': '<p>A</p>' });
    assert.throws(() => main.call('snapshot:read', bookId, name, 'ch-missing.html'), /ENOENT/);
  });

  test('a chapter file that is empty reads as empty (legitimately)', () => {
    const { bookId, name } = snapshotWithFiles({ 'ch-a.html': '' });
    assert.equal(main.call('snapshot:read', bookId, name, 'ch-a.html'), '');
  });

  test('a chapter still in iCloud throws ECLOUD after the wait', async () => {
    const { bookId, name, snapDir } = snapshotWithFiles({ 'ch-a.html': '<p>A</p>' });
    main.setCloudOnly([path.join(snapDir, 'ch-a.html')]);
    await assert.rejects(main.call('snapshot:read', bookId, name, 'ch-a.html'), { code: 'ECLOUD' });
  });

  test('a name or file that is not a snapshot file throws', () => {
    const { bookId, name } = snapshotWithFiles({ 'ch-a.html': '<p>A</p>' });
    assert.throws(() => main.call('snapshot:read', bookId, name, '../book.json'), /Invalid/);
    assert.throws(() => main.call('snapshot:read', bookId, '../x', 'ch-a.html'), /Invalid/);
  });
});

describe('preload.js forwards every snapshot argument', () => {
  test('snapshotRead and snapshotWrite pass bookId, name, file and text through', () => {
    const calls = [];
    let api = null;
    const electron = {
      contextBridge: { exposeInMainWorld: (key, value) => { if (key === 'neo') api = value; } },
      ipcRenderer: { sendSync: () => null, invoke: (...args) => { calls.push(args); return Promise.resolve(null); } },
      webUtils: {}
    };
    const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
    vm.runInContext(preload, vm.createContext({ require: (n) => (n === 'electron' ? electron : {}), process: { platform: 'test' } }));
    api.snapshotRead('book-x', '20261001T000000Z-d-1-10-aaaa', 'ch-a.html');
    api.snapshotWrite('book-x', '20261001T000000Z-d-1-10-aaaa', 'ch-a.html', '<p>A</p>');
    assert.deepEqual(calls, [
      ['snapshot:read', 'book-x', '20261001T000000Z-d-1-10-aaaa', 'ch-a.html'],
      ['snapshot:write', 'book-x', '20261001T000000Z-d-1-10-aaaa', 'ch-a.html', '<p>A</p>']
    ]);
  });
});

// ---- thinSnapshots in app.js, against an in-memory library ----
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const appContext = vm.createContext({});
vm.runInContext(app.slice(app.indexOf('const SNAP_KEPT'), app.indexOf('// (the rules above are plain functions: scripts/snapshots.test.js)')), appContext);
vm.runInContext('this.api = { snapHolder, thinSnapshots: typeof thinSnapshots === "function" ? thinSnapshots : () => { throw new Error("thinSnapshots is missing from app.js"); } };', appContext);
const { snapHolder, thinSnapshots } = appContext.api;

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 28);
const OLD = NOW - 40 * DAY;

// an in-memory snapshot library: files[name][file] = text
function fakeNeo(library, faults = {}) {
  const log = [];
  return {
    log,
    async snapshotRead(bookId, name, file) {
      log.push(['read', name, file]);
      if (faults.read && faults.read(name, file)) throw Object.assign(new Error('EACCES: ' + file), { code: 'EACCES' });
      const files = library[name];
      if (!files || !(file in files)) throw Object.assign(new Error('ENOENT: ' + file), { code: 'ENOENT' });
      return files[file];
    },
    async snapshotWrite(bookId, name, file, text) {
      log.push(['write', name, file]);
      if (faults.write && faults.write(name, file)) throw new Error('disk full');
      library[name] = library[name] || {};
      if (file in library[name]) return false; // written once
      library[name][file] = faults.corrupt && faults.corrupt(name, file) ? '' : text;
      return true;
    },
    async snapshotRemove(bookId, name) {
      log.push(['remove', name]);
      delete library[name];
      return true;
    }
  };
}

// snapshots oldest first, as loadSnaps gives them
function snaps(library, specs) {
  return specs.map(([name, at, kind]) => ({
    name,
    at,
    kind,
    files: new Set(Object.keys(library[name] || {}))
  }));
}

const OLD_SNAP = '20260918T000000Z-d-2-20-aaaa';
const NEW_SNAP = '20261020T000000Z-d-1-10-bbbb';
const NEWEST = '20261027T000000Z-k-1-10-cccc';

describe('thinSnapshots copies verified text forward, then removes the source', { concurrency: 1 }, () => {
  test('an empty chapter is copied as empty and the source goes', async () => {
    const library = { [OLD_SNAP]: { 'ch-a.html': '', 'ch-b.html': '<p>B1</p>' }, [NEW_SNAP]: { 'ch-b.html': '<p>B2</p>' }, [NEWEST]: { 'ch-b.html': '<p>B3</p>' } };
    const neo = fakeNeo(library);
    const list = snaps(library, [[OLD_SNAP, OLD, 'd'], [NEW_SNAP, OLD + 20 * DAY, 'd'], [NEWEST, NOW, 'k']]);
    await thinSnapshots(neo, 'book-x', list, NOW);
    assert.equal(library[OLD_SNAP], undefined);
    assert.equal(library[NEW_SNAP]['ch-a.html'], '');
    assert.equal(list.length, 2);
  });

  test('an unreadable chapter aborts before anything is written or removed', async () => {
    const library = { [OLD_SNAP]: { 'ch-a.html': '<p>A1</p>', 'ch-b.html': '<p>B1</p>' }, [NEW_SNAP]: { 'ch-c.html': '<p>C</p>' }, [NEWEST]: {} };
    const neo = fakeNeo(library, { read: (name, file) => name === OLD_SNAP && file === 'ch-b.html' });
    const list = snaps(library, [[OLD_SNAP, OLD, 'd'], [NEW_SNAP, OLD + 20 * DAY, 'd'], [NEWEST, NOW, 'k']]);
    await assert.rejects(thinSnapshots(neo, 'book-x', list, NOW), { code: 'EACCES' });
    assert.ok(library[OLD_SNAP], 'the source snapshot is still there');
    assert.equal(library[OLD_SNAP]['ch-b.html'], '<p>B1</p>');
    assert.equal(library[NEW_SNAP]['ch-b.html'], undefined, 'nothing empty was written forward');
  });

  test('a missing chapter (ENOENT) aborts the thinning', async () => {
    const library = { [OLD_SNAP]: { 'ch-a.html': '<p>A1</p>' }, [NEW_SNAP]: {}, [NEWEST]: {} };
    const list = snaps(library, [[OLD_SNAP, OLD, 'd'], [NEW_SNAP, OLD + 20 * DAY, 'd'], [NEWEST, NOW, 'k']]);
    list[0].files.add('ch-ghost.html'); // listed, but gone from disk
    await assert.rejects(thinSnapshots(fakeNeo(library), 'book-x', list, NOW), { code: 'ENOENT' });
    assert.ok(library[OLD_SNAP]);
  });

  test('a write that throws aborts and keeps the source', async () => {
    const library = { [OLD_SNAP]: { 'ch-a.html': '<p>A1</p>' }, [NEW_SNAP]: {}, [NEWEST]: {} };
    const list = snaps(library, [[OLD_SNAP, OLD, 'd'], [NEW_SNAP, OLD + 20 * DAY, 'd'], [NEWEST, NOW, 'k']]);
    await assert.rejects(thinSnapshots(fakeNeo(library, { write: () => true }), 'book-x', list, NOW), /disk full/);
    assert.ok(library[OLD_SNAP]);
    assert.equal(list.length, 3);
  });

  test('a copy that does not read back intact aborts and keeps the source', async () => {
    const library = { [OLD_SNAP]: { 'ch-a.html': '<p>A1</p>' }, [NEW_SNAP]: {}, [NEWEST]: {} };
    const list = snaps(library, [[OLD_SNAP, OLD, 'd'], [NEW_SNAP, OLD + 20 * DAY, 'd'], [NEWEST, NOW, 'k']]);
    await assert.rejects(thinSnapshots(fakeNeo(library, { corrupt: () => true }), 'book-x', list, NOW), /did not copy/);
    assert.ok(library[OLD_SNAP]);
  });

  test('a next snapshot that already holds a chapter keeps its own version; nothing is compared or overwritten', async () => {
    // the next snapshot's own ch-a (changed since) is the one readers see from there on
    const other = { [OLD_SNAP]: { 'ch-a.html': '<p>A1</p>' }, [NEW_SNAP]: { 'ch-a.html': '<p>own change</p>' }, [NEWEST]: {} };
    const list = snaps(other, [[OLD_SNAP, OLD, 'd'], [NEW_SNAP, OLD + 20 * DAY, 'd'], [NEWEST, NOW, 'k']]);
    await thinSnapshots(fakeNeo(other), 'book-x', list, NOW);
    assert.equal(other[OLD_SNAP], undefined);
    assert.equal(other[NEW_SNAP]['ch-a.html'], '<p>own change</p>');

    const same = { [OLD_SNAP]: { 'ch-a.html': '<p>A1</p>' }, [NEW_SNAP]: { 'ch-a.html': '<p>A1</p>' }, [NEWEST]: {} };
    const list2 = snaps(same, [[OLD_SNAP, OLD, 'd'], [NEW_SNAP, OLD + 20 * DAY, 'd'], [NEWEST, NOW, 'k']]);
    await thinSnapshots(fakeNeo(same), 'book-x', list2, NOW);
    assert.equal(same[OLD_SNAP], undefined, 'a chapter already there lets the source go');
  });

  test('a chapter the next snapshot holds but the listing missed is its own, not compared', async () => {
    const library = { [OLD_SNAP]: { 'ch-a.html': '<p>A1</p>' }, [NEW_SNAP]: { 'ch-a.html': '<p>own</p>' }, [NEWEST]: {} };
    const list = snaps(library, [[OLD_SNAP, OLD, 'd'], [NEW_SNAP, OLD + 20 * DAY, 'd'], [NEWEST, NOW, 'k']]);
    list[1].files.clear(); // another device's file, not in the listing we took
    await thinSnapshots(fakeNeo(library), 'book-x', list, NOW);
    assert.equal(library[OLD_SNAP], undefined);
    assert.equal(library[NEW_SNAP]['ch-a.html'], '<p>own</p>');
  });

  test('an interrupted pass retries safely and every snapshot still reads whole', async () => {
    const library = {
      [OLD_SNAP]: { 'ch-a.html': '<p>A1</p>', 'ch-b.html': '<p>B1</p>', 'ch-c.html': '' },
      [NEW_SNAP]: { 'ch-b.html': '<p>B2</p>' },
      [NEWEST]: { 'ch-a.html': '<p>A3</p>' }
    };
    const list = snaps(library, [[OLD_SNAP, OLD, 'd'], [NEW_SNAP, OLD + 20 * DAY, 'd'], [NEWEST, NOW, 'k']]);
    // first pass dies on ch-b's write, after ch-a has been copied
    let failing = true;
    const flaky = fakeNeo(library, { write: (name, file) => failing && name === NEW_SNAP && file === 'ch-c.html' });
    await assert.rejects(thinSnapshots(flaky, 'book-x', list, NOW), /disk full/);
    assert.ok(library[OLD_SNAP], 'source kept after the interruption');
    assert.equal(library[NEW_SNAP]['ch-a.html'], '<p>A1</p>', 'the copy made so far is intact');
    // retry: the copied file is there and verifies; the rest is copied
    failing = false;
    const retry = snaps(library, [[OLD_SNAP, OLD, 'd'], [NEW_SNAP, OLD + 20 * DAY, 'd'], [NEWEST, NOW, 'k']]);
    await thinSnapshots(flaky, 'book-x', retry, NOW);
    assert.equal(library[OLD_SNAP], undefined);
    // what each snapshot left reads as through snapHolder (the old one's text is what it held)
    const left = snaps(library, [[NEW_SNAP, OLD + 20 * DAY, 'd'], [NEWEST, NOW, 'k']]);
    const read = (i, ch) => {
      const holder = snapHolder(left, i, ch);
      return holder ? library[holder.name][ch + '.html'] : undefined;
    };
    assert.equal(read(0, 'ch-a'), '<p>A1</p>', 'ch-a at the middle snapshot');
    assert.equal(read(0, 'ch-b'), '<p>B2</p>', 'ch-b at the middle snapshot');
    assert.equal(read(0, 'ch-c'), '', 'an empty chapter is still empty, not missing');
    assert.equal(read(1, 'ch-a'), '<p>A3</p>', 'ch-a at the newest');
    assert.equal(read(1, 'ch-b'), '<p>B2</p>', 'ch-b carried from the middle snapshot');
    assert.equal(read(1, 'ch-c'), '', 'ch-c carried as empty');
  });
});
