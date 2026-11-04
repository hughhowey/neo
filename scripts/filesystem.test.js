'use strict';

// Loads main.js the way scripts/spellcheck.test.js does: Electron is replaced,
// the real disk functions run, and LIBRARY_DIR points at a temporary folder.
// main.js itself is not edited for these tests.

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
    dialog: {},
    utilityProcess: { fork: () => ({ on() {}, postMessage() {} }) },
    screen: {}
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: root,
    process: { platform: process.platform, on() {} },
    console,
    libraryRoot: os.tmpdir()
  });
  // The string is the file on disk. filename is how Node attributes coverage to it.
  vm.runInContext(source, context, { filename: path.join(root, 'main.js') });
  return {
    context,
    call: (name, ...args) => handlers.get(name)(null, ...args),
    pointAt(dir) {
      context.libraryRoot = dir;
      vm.runInContext('LIBRARY_DIR = libraryRoot; LIBRARY_FILE = require("path").join(libraryRoot, "library.json");', context);
    }
  };
}

const main = loadMain();

function tempLibrary() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-library-fs-'));
  main.pointAt(dir);
  return dir;
}

describe('filesystem', { concurrency: 1 }, () => {
  test('libName accepts one segment and rejects an escape', () => {
    const name = (value) => {
      main.context.probe = value;
      return vm.runInContext('libName(probe)', main.context);
    };
    assert.equal(name('book-hello'), 'book-hello');
    assert.equal(name('chapter 1'), 'chapter 1');
    for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'a\0b']) {
      assert.throws(() => name(bad), /Invalid library name/, JSON.stringify(bad));
    }
  });

  test('book:create writes the folder a new book has today', () => {
    const dir = tempLibrary();
    try {
      const book = main.call('book:create', { title: 'Capítulo', author: 'Ada' });
      assert.match(book.id, /^book-capitulo-[0-9a-z]+-[0-9a-z]{5}$/);
      assert.equal(book.title, 'Capítulo');
      assert.equal(book.author, 'Ada');
      assert.equal(JSON.stringify(book.chapterOrder), '[]');
      const folder = path.join(dir, book.id);
      const meta = JSON.parse(fs.readFileSync(path.join(folder, 'book.json'), 'utf8'));
      assert.equal(meta.id, book.id);
      assert.equal(fs.statSync(path.join(folder, 'chapters')).isDirectory(), true);
      assert.equal(fs.readFileSync(path.join(folder, 'notes.html'), 'utf8'), '');
      assert.equal(fs.readFileSync(path.join(folder, 'outline.html'), 'utf8'), '');
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'darlings.json'), 'utf8')), []);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'stickies.json'), 'utf8')), []);

      const blank = main.call('book:create', { title: '' });
      assert.match(blank.id, /^book-[0-9a-z]+-[0-9a-z]{5}$/);
      assert.equal(blank.title, 'Untitled');
      assert.equal(blank.author, 'Anonymous');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('chapters round-trip, and a missing chapter reads back empty', () => {
    const dir = tempLibrary();
    try {
      const book = main.call('book:create', { title: 'Hello', author: 'Ada' });
      const html = '<p>Once upon a time</p>';
      assert.equal(main.call('chapter:read', book.id, 'c1'), '');
      assert.equal(main.call('chapter:write', book.id, 'c1', html), true);
      assert.equal(main.call('chapter:read', book.id, 'c1'), html);
      const file = path.join(dir, book.id, 'chapters', 'c1.html');
      const st = fs.statSync(file);
      assert.equal(main.call('chapter:stamps', book.id).c1, st.mtimeMs + ':' + st.size);
      assert.equal(main.call('chapter:delete', book.id, 'c1'), true);
      assert.equal(fs.existsSync(file), false);
      assert.equal(main.call('chapter:read', book.id, 'c1'), '');
      assert.equal(main.call('chapter:stamps', book.id).c1, undefined);
      assert.equal(main.call('chapter:delete', book.id, 'missing'), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('notes round-trip, and a JSON replace leaves the whole file and no .tmp', () => {
    const dir = tempLibrary();
    try {
      const book = main.call('book:create', { title: 'Hello', author: 'Ada' });
      assert.equal(main.call('aux:read', book.id, 'notes'), '');
      assert.equal(main.call('aux:write', book.id, 'notes', '<p>margin</p>'), true);
      assert.equal(main.call('aux:read', book.id, 'notes'), '<p>margin</p>');
      assert.equal(fs.readFileSync(path.join(dir, book.id, 'notes.html'), 'utf8'), '<p>margin</p>');

      const data = { kept: ['a line the writer cut'] };
      assert.equal(main.call('json:write', book.id, 'darlings', data), true);
      const file = path.join(dir, book.id, 'darlings.json');
      assert.equal(fs.existsSync(file + '.tmp'), false);
      assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify(data, null, 2));
      assert.equal(JSON.stringify(main.call('json:read', book.id, 'darlings', null)), JSON.stringify(data));
      assert.equal(main.call('json:read', book.id, 'no-such-sidecar', 'fallback'), 'fallback');
      assert.equal(main.call('aux:read', book.id, 'no-such-page'), '');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('library:write regenerates the catalog and drops a hand edit', () => {
    const dir = tempLibrary();
    try {
      const book = main.call('book:create', { title: 'Hello', author: 'Ada' });
      const library = {
        shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [book.id] }]
      };
      assert.equal(main.call('library:write', library), true);
      const catalog = path.join(dir, '_catalog.txt');
      const text = fs.readFileSync(catalog, 'utf8');
      assert.match(text, /NEO LIBRARY CATALOG — which folder is which book/);
      assert.match(text, /regenerated automatically; edits here do nothing/);
      assert.match(text, new RegExp(`Hello  —  ${book.id}  —  shelf: Works in Progress`));

      fs.writeFileSync(catalog, 'a writer edited this file\n');
      main.call('library:write', library);
      const again = fs.readFileSync(catalog, 'utf8');
      assert.equal(again.includes('a writer edited this file'), false);
      assert.match(again, new RegExp(book.id));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a rejected name creates nothing outside the temp library', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-library-fs-'));
    const dir = path.join(rootDir, 'library');
    fs.mkdirSync(dir);
    main.pointAt(dir);
    try {
      const book = main.call('book:create', { title: 'Hello', author: 'Ada' });
      const before = fs.readdirSync(rootDir).sort();
      const chaptersBefore = fs.readdirSync(path.join(dir, book.id, 'chapters'));
      for (const [bookId, chapterId] of [['..', 'c1'], [book.id, '..'], [book.id, 'a/b'], [book.id, 'a\\b'], [book.id, 'a\0b']]) {
        assert.throws(() => main.call('chapter:write', bookId, chapterId, '<p>no</p>'), /Invalid library name/);
      }
      assert.throws(() => main.call('json:write', '..', 'darlings', []), /Invalid library name/);
      assert.throws(() => main.call('aux:write', book.id, '../notes', '<p>no</p>'), /Invalid library name/);
      assert.deepEqual(fs.readdirSync(rootDir).sort(), before);
      assert.deepEqual(fs.readdirSync(path.join(dir, book.id, 'chapters')), chaptersBefore);
      assert.equal(fs.existsSync(path.join(rootDir, 'c1.html')), false);
      assert.equal(JSON.stringify(main.call('chapter:stamps', '..')), '{}');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  // Chapter conflicts: a write whose `expected` is not the disk's current
  // text is refused and the disk text handed back, whatever the change was.
  // the handler's result comes from the vm context, so compare it without the realm check
  const legacy = require('node:assert');
  describe('chapter conflicts', () => {
    const chapterFile = (dir, bookId, id) => path.join(dir, bookId, 'chapters', id + '.html');
    // another device writes the file directly, as sync would
    const remoteWrite = (dir, bookId, id, html) => fs.writeFileSync(chapterFile(dir, bookId, id), html);

    test('the review repro: a stale save keeps the reordered, bold remote text', () => {
      const dir = tempLibrary();
      try {
        const book = main.call('book:create', { title: 'Hello', author: 'Ada' });
        main.call('chapter:write', book.id, 'c1', '<p>red blue</p>');
        const remote = '<p><b>blue</b> red</p>';
        remoteWrite(dir, book.id, 'c1', remote);
        const r = main.call('chapter:write', book.id, 'c1', '<p>red blue green</p>', '<p>red blue</p>');
        legacy.deepEqual(r, { conflict: remote });
        assert.equal(fs.readFileSync(chapterFile(dir, book.id, 'c1'), 'utf8'), remote);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    test('formatting-only and reorder changes on disk are not overwritten', () => {
      const dir = tempLibrary();
      try {
        const book = main.call('book:create', { title: 'Hello', author: 'Ada' });
        const base = '<p>red blue</p>';
        for (const remote of ['<p><i>red</i> blue</p>', '<p>blue red</p>']) {
          main.call('chapter:write', book.id, 'c1', base);
          remoteWrite(dir, book.id, 'c1', remote);
          const r = main.call('chapter:write', book.id, 'c1', '<p>red blue green</p>', base);
          legacy.deepEqual(r, { conflict: remote }, remote);
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    test('a remote deletion is not restored by a stale save that holds the surviving words', () => {
      const dir = tempLibrary();
      try {
        const book = main.call('book:create', { title: 'Hello', author: 'Ada' });
        const base = '<p>red blue green</p>';
        main.call('chapter:write', book.id, 'c1', base);
        // the other device deleted "green"; this device's stale save still has it
        const remote = '<p>red blue</p>';
        remoteWrite(dir, book.id, 'c1', remote);
        const r = main.call('chapter:write', book.id, 'c1', base, base);
        legacy.deepEqual(r, { conflict: remote });
        assert.equal(fs.readFileSync(chapterFile(dir, book.id, 'c1'), 'utf8'), remote);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    test('repeated-word changes are a conflict too', () => {
      const dir = tempLibrary();
      try {
        const book = main.call('book:create', { title: 'Hello', author: 'Ada' });
        main.call('chapter:write', book.id, 'c1', '<p>red red blue</p>');
        remoteWrite(dir, book.id, 'c1', '<p>red blue</p>');
        const r = main.call('chapter:write', book.id, 'c1', '<p>red red blue red</p>', '<p>red red blue</p>');
        legacy.deepEqual(r, { conflict: '<p>red blue</p>' });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    test('an identical or retried write makes no twin', () => {
      const dir = tempLibrary();
      try {
        const book = main.call('book:create', { title: 'Hello', author: 'Ada' });
        const remote = '<p><b>blue</b> red</p>';
        main.call('chapter:write', book.id, 'c1', '<p>red blue</p>');
        remoteWrite(dir, book.id, 'c1', remote);
        // identical: the disk already holds what is being written
        assert.equal(main.call('chapter:write', book.id, 'c1', remote, '<p>red blue</p>'), true);
        // retry after the window kept the disk text: expected is now that text
        remoteWrite(dir, book.id, 'c1', remote);
        legacy.deepEqual(main.call('chapter:write', book.id, 'c1', '<p>red blue green</p>', '<p>red blue</p>'), { conflict: remote });
        assert.equal(main.call('chapter:write', book.id, 'c1', '<p>red blue green</p>', remote), true);
        assert.equal(main.call('chapter:read', book.id, 'c1'), '<p>red blue green</p>');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    test('a disk chapter with no words is not a conflict', () => {
      const dir = tempLibrary();
      try {
        const book = main.call('book:create', { title: 'Hello', author: 'Ada' });
        main.call('chapter:write', book.id, 'c1', '<p><br></p>');
        remoteWrite(dir, book.id, 'c1', '<p><br></p>');
        assert.equal(main.call('chapter:write', book.id, 'c1', '<p>new</p>', '<p>old</p>'), true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
