'use strict';

// Times the write handlers a save uses, then keeps saving for 30 seconds
// (or the seconds passed as the first argument). Run with:
// npm run test:load
// npm run test:load -- 60
// Ceilings live in scripts/save-checkpoint.json. This file reads that
// checkpoint and does not rewrite it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');

const root = path.join(__dirname, '..');
const localRequire = createRequire(path.join(root, 'main.js'));
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const checkpointPath = path.join(__dirname, 'save-checkpoint.json');

const WARMUP = 1;
const SAMPLES = 20;
const LONG_BYTES = 200 * 1024;
const LOAD_CHAPTERS = 40;
const LOAD_SECONDS = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 30;

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

function longChapterHtml() {
  const paragraph = '<p>' + 'The river kept the words of the book. '.repeat(12) + '</p>\n';
  let html = '';
  while (Buffer.byteLength(html) < LONG_BYTES) html += paragraph;
  return html;
}

function timeCall(run) {
  const start = performance.now();
  const result = run();
  const ms = performance.now() - start;
  if (result && typeof result.then === 'function') {
    throw new Error('timed handler returned a promise');
  }
  return ms;
}

function warmMax(run, onSample) {
  for (let i = 0; i < WARMUP; i++) run();
  let max = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const ms = timeCall(run);
    if (ms > max) max = ms;
    onSample();
  }
  return max;
}

function formatMs(ms) {
  return ms.toFixed(3);
}

function readCheckpoint() {
  if (!fs.existsSync(checkpointPath)) {
    console.error('scripts/save-checkpoint.json is missing');
    return null;
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  } catch (err) {
    console.error('scripts/save-checkpoint.json could not be read: ' + err.message);
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    console.error('scripts/save-checkpoint.json could not be read: expected an object of ceilings');
    return null;
  }
  return data;
}

function checkCeiling(name, max, checkpoint) {
  const ceiling = checkpoint[name];
  if (typeof ceiling !== 'number' || !Number.isFinite(ceiling)) {
    console.error(name + ' has no ceiling in scripts/save-checkpoint.json');
    return false;
  }
  if (max > ceiling) {
    console.error(name + ' max ' + formatMs(max) + ' ms exceeds ceiling ' + ceiling + ' ms');
    return false;
  }
  return true;
}

function sustainedLoad(loaded, book, shortHtml, longHtml, notesHtml, bookJson) {
  const names = ['chapter:write short', 'chapter:write long', 'json:write', 'aux:write'];
  const max = {};
  const count = {};
  for (const name of names) {
    max[name] = 0;
    count[name] = 0;
  }
  const started = performance.now();
  const deadline = started + LOAD_SECONDS * 1000;
  let i = 0;
  let drawn = false;
  const paint = () => {
    if (drawn) process.stdout.write('\x1b[' + names.length + 'A');
    for (const name of names) {
      const dots = '.'.repeat(Math.floor(count[name] / 10000));
      process.stdout.write('\x1b[2Kload ' + name + ' ' + dots + '\n');
    }
    drawn = true;
  };
  const mark = (name) => {
    count[name]++;
    if (count[name] % 10000 === 0) paint();
  };
  paint();
  while (performance.now() < deadline) {
    const chapterIndex = i % LOAD_CHAPTERS;
    const long = chapterIndex % 10 === 0;
    const name = long ? 'chapter:write long' : 'chapter:write short';
    const html = long ? longHtml : shortHtml;
    const ms = timeCall(() => loaded.call('chapter:write', book.id, 'load-' + chapterIndex, html));
    if (ms > max[name]) max[name] = ms;
    mark(name);
    if (i % LOAD_CHAPTERS === 0) {
      const jsonMs = timeCall(() => loaded.call('json:write', book.id, 'book', bookJson));
      const auxMs = timeCall(() => loaded.call('aux:write', book.id, 'notes', notesHtml));
      if (jsonMs > max['json:write']) max['json:write'] = jsonMs;
      if (auxMs > max['aux:write']) max['aux:write'] = auxMs;
      mark('json:write');
      mark('aux:write');
    }
    i++;
  }
  paint();
  return { max, count, elapsed: performance.now() - started, writes: i };
}

function main() {
  const checkpoint = readCheckpoint();
  if (!checkpoint) {
    process.exitCode = 1;
    return;
  }

  console.log('testing for ' + LOAD_SECONDS + 's');
  const loaded = loadMain();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-library-save-'));
  let failed = false;
  try {
    loaded.pointAt(dir);
    const book = loaded.call('book:create', { title: 'Hello', author: 'Ada' });
    const shortHtml = '<p>Once upon a time there was a river, and the river kept the words.</p>';
    const longHtml = longChapterHtml();
    const notesHtml = '<p>A short note in the margin.</p>';
    const bookJson = {
      id: book.id,
      title: 'Hello',
      subtitle: '',
      series: '',
      author: 'Ada',
      wordGoal: 0,
      created: '2026-10-02T00:00:00.000Z',
      modified: '2026-10-02T00:00:00.000Z',
      chapterOrder: ['c-short', 'c-long'],
      tabNames: { notes: 'Notes', outline: 'Outline' }
    };
    const operations = [
      {
        name: 'chapter:write short',
        run: () => loaded.call('chapter:write', book.id, 'c-short', shortHtml)
      },
      {
        name: 'chapter:write long',
        run: () => loaded.call('chapter:write', book.id, 'c-long', longHtml)
      },
      {
        name: 'json:write',
        run: () => loaded.call('json:write', book.id, 'book', bookJson)
      },
      {
        name: 'aux:write',
        run: () => loaded.call('aux:write', book.id, 'notes', notesHtml)
      }
    ];

    for (const op of operations) {
      process.stdout.write(op.name + ' ');
      const max = warmMax(op.run, () => process.stdout.write('.'));
      process.stdout.write('  max ' + formatMs(max) + ' ms  ceiling ' + checkpoint[op.name] + ' ms\n');
      if (!checkCeiling(op.name, max, checkpoint)) failed = true;
    }

    const load = sustainedLoad(loaded, book, shortHtml, longHtml, notesHtml, bookJson);
    console.log('load ' + (load.elapsed / 1000).toFixed(1) + 's  chapter writes ' + load.writes);
    for (const name of ['chapter:write short', 'chapter:write long', 'json:write', 'aux:write']) {
      console.log('load ' + name + '  n=' + load.count[name] + '  max ' + formatMs(load.max[name]) + ' ms  ceiling ' + checkpoint[name] + ' ms');
      if (!checkCeiling(name, load.max[name], checkpoint)) failed = true;
    }
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    failed = true;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (failed) process.exitCode = 1;
}

main();
