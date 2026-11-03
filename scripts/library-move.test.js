'use strict';

// File → Library Folder… moves the books along: into NEO Pocket's folder in
// iCloud Drive with one button, or into any folder the writer picks. The real
// main.js runs in a sandbox against temporary folders.

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

function book(lib, id, words = 'The stairs went down.') {
  fs.mkdirSync(path.join(lib, id, 'chapters'), { recursive: true });
  fs.writeFileSync(path.join(lib, id, 'book.json'), JSON.stringify({ id, title: id, chapterOrder: ['ch-1'] }));
  fs.writeFileSync(path.join(lib, id, 'chapters', 'ch-1.html'), `<p>${words}</p>`);
}

// a Mac: a home with a library in Documents and, if `pocket`, NEO Pocket's
// iCloud folder (with the iPad's own library in it, if `ipad`)
function mac({ pocket = true, ipad = false, answers = [0], firstRun = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-library-move-'));
  const home = path.join(base, 'home');
  const userData = path.join(base, 'userData');
  const docs = path.join(home, 'Documents');
  const lib = path.join(docs, 'NEO Library');
  fs.mkdirSync(userData, { recursive: true });
  book(lib, 'book-wool-1');
  book(lib, 'book-shift-2');
  fs.writeFileSync(path.join(lib, 'library.json'), JSON.stringify({
    authorName: 'Hugh Howey', penNames: [], firstRunDone: !firstRun,
    authors: [{ id: 'a1', name: 'Hugh Howey' }],
    shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: ['book-wool-1'] }, { id: 'shelf-mac', name: 'Silo', bookIds: ['book-shift-2'] }]
  }));
  const cloudDocs = path.join(home, 'Library', 'Mobile Documents', 'iCloud~com~hughhowey~neo~pocket', 'Documents');
  const cloud = path.join(cloudDocs, 'NEO Library');
  if (pocket) fs.mkdirSync(cloudDocs, { recursive: true });
  if (ipad) {
    book(cloud, 'book-pocket-3', 'Written on the iPad.');
    fs.writeFileSync(path.join(cloud, 'library.json'), JSON.stringify({
      authorName: '', penNames: [], firstRunDone: true, authors: [{ id: 'a1', name: 'Anonymous' }],
      shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: ['book-pocket-3'] }]
    }));
  }
  const shown = [];
  const trashed = [];
  const opened = [];
  const handlers = new Map();
  const did = { relaunch: 0, exit: 0 };
  const queue = [...answers];
  const electron = {
    app: {
      commandLine: { appendSwitch() {} },
      getPath: (name) => ({ home, userData, documents: docs })[name] || os.tmpdir(),
      getLocale: () => 'en',
      requestSingleInstanceLock: () => true,
      whenReady: () => ({ then() {} }),
      on() {},
      relaunch: () => { did.relaunch++; },
      exit: () => { did.exit++; }
    },
    ipcMain: { on() {}, handle: (name, fn) => handlers.set(name, fn) },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
    dialog: {
      showMessageBoxSync: () => 0,
      showMessageBox: (...a) => { shown.push(a[a.length - 1]); return Promise.resolve({ response: queue.length ? queue.shift() : 0 }); },
      showOpenDialog: () => Promise.resolve({ canceled: false, filePaths: [path.join(home, 'Dropbox', 'NEO')] })
    },
    shell: { trashItem: async (p) => { trashed.push(p); fs.rmSync(p, { recursive: true, force: true }); }, openExternal: async (u) => { opened.push(u); } },
    utilityProcess: { fork: () => ({ on() {}, postMessage() {} }) },
    screen: {}
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: root,
    process: { platform: 'darwin', on() {}, env: {} },
    console,
    setTimeout,
    startDir: lib
  });
  vm.runInContext(source, context, { filename: path.join(root, 'main.js') });
  vm.runInContext('LIBRARY_DIR = startDir; LIBRARY_FILE = require("path").join(startDir, "library.json");', context);
  const run = (code) => vm.runInContext(code, context);
  return {
    base, home, lib, cloud, shown, trashed, opened, did, run,
    call: (name, ...args) => handlers.get(name)(null, ...args),
    plain: (code) => JSON.parse(run(`JSON.stringify(${code})`)),
    settings: () => { try { return JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')); } catch { return {}; } },
    library: (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'library.json'), 'utf8')),
    done: () => fs.rmSync(base, { recursive: true, force: true })
  };
}

describe('moving the library', { concurrency: 1 }, () => {
  test('two libraries become one: shared shelves keep every book, the rest join', () => {
    const m = mac({ pocket: false });
    try {
      // (values from the sandbox are made plain, so they compare as this file's own)
      const merged = JSON.parse(m.run(`JSON.stringify(mergeLibraries(${JSON.stringify({
        authorName: '', penNames: ['A'], firstRunDone: true, authors: [{ id: 'a1', name: 'Anonymous' }],
        shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: ['b3'] }]
      })}, ${JSON.stringify({
        authorName: 'Hugh Howey', penNames: ['B'], authors: [{ id: 'a1', name: 'Hugh Howey' }, { id: 'a2', name: 'Margo Pruett' }],
        shelves: [{ id: 'shelf-1', name: 'Mine', bookIds: ['b1', 'b3'] }, { id: 'shelf-2', name: 'Silo', bookIds: ['b2'], authorId: 'a2' }]
      })}))`));
      assert.deepEqual(merged.shelves.map((s) => [s.id, s.name, s.bookIds]), [['shelf-1', 'Works in Progress', ['b3', 'b1']], ['shelf-2', 'Silo', ['b2']]]);
      assert.equal(merged.shelves[1].authorId, 'a2');
      assert.deepEqual(merged.authors.map((a) => a.name), ['Hugh Howey', 'Margo Pruett']);
      assert.deepEqual([...merged.penNames], ['A', 'B']);
      assert.equal(merged.authorName, 'Hugh Howey');
    } finally {
      m.done();
    }
  });

  test('Use iCloud Drive moves every book into NEO Pocket\'s folder, beside the iPad\'s, and restarts there', async () => {
    const m = mac({ ipad: true });
    try {
      await m.run('chooseLibraryFolder()');
      assert.equal(m.shown[0].buttons[0], 'Use iCloud Drive');
      for (const id of ['book-wool-1', 'book-shift-2', 'book-pocket-3']) assert.ok(fs.existsSync(path.join(m.cloud, id, 'chapters', 'ch-1.html')), id);
      assert.equal(fs.readFileSync(path.join(m.cloud, 'book-pocket-3', 'chapters', 'ch-1.html'), 'utf8'), '<p>Written on the iPad.</p>');
      const lib = m.library(m.cloud);
      assert.deepEqual(lib.shelves.find((s) => s.id === 'shelf-1').bookIds, ['book-pocket-3', 'book-wool-1']);
      assert.deepEqual(lib.shelves.find((s) => s.id === 'shelf-mac').bookIds, ['book-shift-2']);
      assert.equal(lib.authors[0].name, 'Hugh Howey');
      assert.deepEqual(m.trashed, [m.lib]);                 // the old folder goes to the Trash, not away
      assert.equal(m.settings().libraryDir, m.cloud);
      assert.deepEqual(m.did, { relaunch: 1, exit: 1 });
    } finally {
      m.done();
    }
  });

  test('with no NEO Pocket folder on this Mac, there is no iCloud button', async () => {
    const m = mac({ pocket: false, answers: [1] });
    try {
      await m.run('chooseLibraryFolder()');
      assert.deepEqual([...m.shown[0].buttons], ['Choose Folder…', 'Cancel']);
      assert.equal(m.trashed.length, 0);
    } finally {
      m.done();
    }
  });

  test('a folder the writer picks asks first, and Move Books brings them along', async () => {
    const m = mac({ pocket: false, answers: [0, 0] }); // Choose Folder…, then Move Books
    try {
      await m.run('chooseLibraryFolder()');
      const dropbox = path.join(m.home, 'Dropbox', 'NEO');
      assert.equal(m.shown[1].message, 'Bring your books along?');
      assert.ok(fs.existsSync(path.join(dropbox, 'book-wool-1', 'book.json')));
      assert.ok(fs.existsSync(path.join(dropbox, 'library.json')));
      assert.equal(m.settings().libraryDir, dropbox);
    } finally {
      m.done();
    }
  });

  test('Leave Them switches without touching the books', async () => {
    const m = mac({ pocket: false, answers: [0, 1] });
    try {
      await m.run('chooseLibraryFolder()');
      assert.ok(fs.existsSync(path.join(m.lib, 'book-wool-1')));
      assert.equal(fs.existsSync(path.join(m.home, 'Dropbox', 'NEO', 'book-wool-1')), false);
      assert.equal(m.trashed.length, 0);
      assert.equal(m.settings().libraryDir, path.join(m.home, 'Dropbox', 'NEO'));
    } finally {
      m.done();
    }
  });

  test('a copy that fails part way leaves both folders as they were', () => {
    const m = mac({ ipad: true });
    const real = fs.cpSync;
    let n = 0;
    fs.cpSync = (...a) => { if (++n === 2) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); return real(...a); };
    try {
      assert.throws(() => m.run('moveLibrary(LIBRARY_DIR, ' + JSON.stringify(m.cloud) + ')'), /disk full/);
      assert.deepEqual(fs.readdirSync(m.cloud).sort(), ['book-pocket-3', 'library.json']);
      assert.deepEqual(m.library(m.cloud).shelves[0].bookIds, ['book-pocket-3']);
      assert.ok(fs.existsSync(path.join(m.lib, 'book-wool-1')) && fs.existsSync(path.join(m.lib, 'book-shift-2')));
    } finally {
      fs.cpSync = real;
      m.done();
    }
  });

  test('NEO asks once when NEO Pocket\'s folder is on this Mac, and Not Now is remembered', async () => {
    const m = mac({ answers: [1] });
    try {
      await m.run('askAboutPocket()');
      assert.equal(m.shown.length, 1);
      assert.equal(m.shown[0].message, 'Share this library with NEO Pocket?');
      assert.deepEqual([...m.shown[0].buttons], ['Use iCloud Drive', 'Not Now']);
      assert.equal(m.settings().pocketAsked, true);
      assert.ok(fs.existsSync(path.join(m.lib, 'book-wool-1')));   // nothing moved
      await m.run('askAboutPocket()');
      assert.equal(m.shown.length, 1);                            // and never again
    } finally {
      m.done();
    }
  });

  test('Use iCloud Drive in that question moves the books and restarts there', async () => {
    const m = mac({ ipad: true, answers: [0] });
    try {
      await m.run('askAboutPocket()');
      assert.ok(fs.existsSync(path.join(m.cloud, 'book-wool-1')) && fs.existsSync(path.join(m.cloud, 'book-pocket-3')));
      assert.equal(m.settings().libraryDir, m.cloud);
      assert.deepEqual(m.did, { relaunch: 1, exit: 1 });
    } finally {
      m.done();
    }
  });

  test('no question without NEO Pocket\'s folder, or during a first run, which asks on its welcome screen', async () => {
    for (const opts of [{ pocket: false }, { firstRun: true }]) {
      const m = mac(opts);
      try {
        await m.run('askAboutPocket()');
        assert.equal(m.shown.length, 0);
      } finally {
        m.done();
      }
    }
  });

  test('Help → NEO for iPad and iPhone… offers the App Store, and Use iCloud Drive once the folder is here', async () => {
    const m = mac({ answers: [1] }); // Get NEO Pocket
    try {
      await m.run('showPocketInfo()');
      assert.equal(m.shown[0].message, 'NEO for iPad and iPhone');
      assert.deepEqual([...m.shown[0].buttons], ['Use iCloud Drive', 'Get NEO Pocket', 'OK']);
      assert.deepEqual([...m.opened], ['https://apps.apple.com/app/id6816721843']);
      assert.ok(fs.existsSync(path.join(m.lib, 'book-wool-1')));
    } finally {
      m.done();
    }
    const n = mac({ pocket: false, answers: [1] }); // OK
    try {
      await n.run('showPocketInfo()');
      assert.deepEqual([...n.shown[0].buttons], ['Get NEO Pocket', 'OK']);
      assert.match(n.shown[0].detail, /Open NEO Pocket once/);
      assert.equal(n.opened.length, 0);
    } finally {
      n.done();
    }
  });

  test('the welcome screen can open the books NEO Pocket keeps in iCloud Drive', async () => {
    const m = mac({ ipad: true, firstRun: true });
    try {
      fs.rmSync(m.lib, { recursive: true, force: true }); // a fresh install: nothing here yet
      assert.deepEqual(m.plain('null') === null && JSON.parse(JSON.stringify(m.call('library:pocket'))), { offer: true, books: true });
      await m.call('library:usePocket');
      assert.equal(m.settings().libraryDir, m.cloud);
      assert.equal(m.trashed.length, 0);                          // nothing to move, nothing thrown away
      assert.deepEqual(m.did, { relaunch: 1, exit: 1 });
    } finally {
      m.done();
    }
  });
});
