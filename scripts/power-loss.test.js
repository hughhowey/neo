'use strict';

// A power cut while NEO saves (#219). The real main.js runs against a
// temporary library; each test leaves a file the way an interrupted write
// can, and checks that the book is still there when NEO next reads it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { describe, test } = require('node:test');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const localRequire = createRequire(path.join(root, 'main.js'));
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

function loadMain() {
  const handlers = new Map();
  const warnings = [];
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
    dialog: { showMessageBox: (opts) => { warnings.push(opts.message); return Promise.resolve({}); } },
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
  vm.runInContext(source, context, { filename: path.join(root, 'main.js') });
  return {
    warnings,
    call: (name, ...args) => handlers.get(name)(null, ...args),
    pointAt(dir) {
      context.libraryRoot = dir;
      vm.runInContext('LIBRARY_DIR = libraryRoot; LIBRARY_FILE = require("path").join(libraryRoot, "library.json");', context);
    }
  };
}

const main = loadMain();

// a library with one book, saved twice (so a .bak exists), on its shelf
function libraryWithBook() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-power-'));
  main.pointAt(dir);
  const lib = main.call('library:read');
  const book = main.call('book:create', { title: 'The Long Night' });
  main.call('chapter:write', book.id, 'ch-aaa', '<p>First chapter.</p>');
  main.call('chapter:write', book.id, 'ch-bbb', '<p>Second chapter.</p>');
  book.chapterOrder = ['ch-aaa', 'ch-bbb'];
  main.call('book:writeMeta', book.id, book);
  book.lastPosition = { chapterId: 'ch-bbb', scroll: 10 };
  main.call('book:writeMeta', book.id, book);
  lib.firstRunDone = true;
  lib.shelves[0].bookIds.push(book.id);
  main.call('library:write', lib);
  main.call('library:write', lib);
  return { dir, book, bookDir: path.join(dir, book.id) };
}

describe('power loss', { concurrency: 1 }, () => {
  test('an emptied book.json comes back from its .bak', () => {
    const { book, bookDir } = libraryWithBook();
    fs.writeFileSync(path.join(bookDir, 'book.json'), '');
    const meta = main.call('book:readMeta', book.id);
    assert.equal(meta.title, 'The Long Night');
    assert.deepEqual([...meta.chapterOrder], ['ch-aaa', 'ch-bbb']);
    // and the file itself is whole again
    assert.equal(JSON.parse(fs.readFileSync(path.join(bookDir, 'book.json'), 'utf8')).title, 'The Long Night');
  });

  test('a half-written book.json is read from the .tmp it left', () => {
    const { book, bookDir } = libraryWithBook();
    const whole = fs.readFileSync(path.join(bookDir, 'book.json'), 'utf8');
    fs.writeFileSync(path.join(bookDir, 'book.json.tmp'), whole);
    fs.writeFileSync(path.join(bookDir, 'book.json'), whole.slice(0, 20));
    assert.equal(main.call('book:readMeta', book.id).title, 'The Long Night');
  });

  test('with book.json and its copies all gone, the book is rebuilt from its chapters', () => {
    const { book, bookDir } = libraryWithBook();
    for (const f of ['book.json', 'book.json.bak', 'book.json.tmp']) fs.rmSync(path.join(bookDir, f), { force: true });
    fs.writeFileSync(path.join(bookDir, 'book.json'), '\0\0\0');
    const meta = main.call('book:readMeta', book.id);
    assert.equal(meta.id, book.id);
    assert.equal(meta.title, 'The Long Night'); // from the catalog
    assert.deepEqual([...meta.chapterOrder], ['ch-aaa', 'ch-bbb']);
    // and it is still on the shelf
    assert.ok(main.call('library:read').shelves[0].bookIds.includes(book.id));
  });

  test('an emptied library.json comes back from its .bak', () => {
    const { dir, book } = libraryWithBook();
    fs.writeFileSync(path.join(dir, 'library.json'), '');
    assert.ok(main.call('library:read').shelves[0].bookIds.includes(book.id));
  });

  test('library.json gone with no copy: every book goes back on a shelf', () => {
    const { dir, book } = libraryWithBook();
    fs.rmSync(path.join(dir, 'library.json.bak'));
    fs.writeFileSync(path.join(dir, 'library.json'), '{"shel');
    const lib = main.call('library:read');
    assert.ok(lib.shelves[0].bookIds.includes(book.id));
    assert.equal(lib.firstRunDone, true);
  });

  test('a chapter save leaves no .tmp behind and the old text is never truncated in place', () => {
    const { book, bookDir } = libraryWithBook();
    main.call('chapter:write', book.id, 'ch-aaa', '<p>Rewritten.</p>');
    const files = fs.readdirSync(path.join(bookDir, 'chapters'));
    assert.deepEqual(files.sort(), ['ch-aaa.html', 'ch-bbb.html']);
    assert.equal(main.call('chapter:read', book.id, 'ch-aaa'), '<p>Rewritten.</p>');
  });

  test('a missing JSON sidecar still reads as its fallback', () => {
    const { book } = libraryWithBook();
    assert.deepEqual([...main.call('json:read', book.id, 'nothing-here', ['x'])], ['x']);
  });
});

// Another program holding a file open for a moment, as antivirus, the search
// indexer or a backup tool does. Resolves once the file is open; the program
// lets go after ms.
function holdOpen(file, ms) {
  const holder = `const fs = require('fs'); const fd = fs.openSync(process.argv[1], 'r'); console.log('open'); setTimeout(() => fs.closeSync(fd), ${ms});`;
  const child = spawn(process.execPath, ['-e', holder, file]);
  const exited = new Promise((resolve) => child.on('exit', resolve));
  return new Promise((resolve) => child.stdout.once('data', () => resolve({ exited })));
}

describe('another program has the file open (Windows)', { concurrency: 1, skip: process.platform !== 'win32' }, () => {
  // in this order: the warning shows once a session, so the moment's hold
  // must not have used it up
  test('held for a moment: the save waits and lands, and the writer is told nothing', async () => {
    const { book, bookDir } = libraryWithBook();
    const held = await holdOpen(path.join(bookDir, 'chapters', 'ch-aaa.html'), 100);
    main.call('chapter:write', book.id, 'ch-aaa', '<p>Saved past the hold.</p>');
    await held.exited;
    assert.equal(main.call('chapter:read', book.id, 'ch-aaa'), '<p>Saved past the hold.</p>');
    assert.deepEqual(fs.readdirSync(path.join(bookDir, 'chapters')).sort(), ['ch-aaa.html', 'ch-bbb.html']);
    assert.deepEqual(main.warnings, []);
  });

  test('held and not let go: the save still fails, is explained, and the chapter is untouched', async () => {
    const { book, bookDir } = libraryWithBook();
    const held = await holdOpen(path.join(bookDir, 'chapters', 'ch-aaa.html'), 3000);
    assert.throws(() => main.call('chapter:write', book.id, 'ch-aaa', '<p>Never lands.</p>'), { code: 'EPERM' });
    await held.exited;
    assert.equal(main.call('chapter:read', book.id, 'ch-aaa'), '<p>First chapter.</p>');
    assert.equal(main.warnings.length, 1);
  });
});
