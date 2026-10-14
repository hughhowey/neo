'use strict';

// Email Draft to Myself, the way out of the browser (#386): the computer's own
// mail program opens with the draft written, and the PDF is shown beside it.
// Loads main.js the way filesystem.test.js does, with the PDF printer and
// Electron's shell replaced.

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

function computer({ openFails = false } = {}) {
  const handlers = new Map();
  const seen = { opened: [], shown: [] };
  const electron = {
    app: { commandLine: { appendSwitch() {} }, getPath: () => os.tmpdir(), getLocale: () => 'en', requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {} },
    ipcMain: { on() {}, handle: (name, fn) => handlers.set(name, fn) },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
    dialog: {},
    shell: {
      openExternal: async (url) => { if (openFails) throw new Error('no handler for mailto:'); seen.opened.push(url); },
      showItemInFolder: (file) => seen.shown.push(file)
    },
    utilityProcess: { fork: () => ({ on() {}, postMessage() {} }) },
    screen: {}
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: root,
    process: { platform: process.platform, on() {} },
    console,
    Buffer
  });
  vm.runInContext(source, context, { filename: path.join(root, 'main.js') });
  const library = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-email-'));
  context.library = library;
  vm.runInContext('LIBRARY_DIR = library; LIBRARY_FILE = require("path").join(library, "library.json"); renderPDF = async () => Buffer.from("%PDF-test");', context);
  const draft = (extra) => handlers.get('email:draft')(null, {
    to: 'me@example.com', subject: 'NEO draft — My Book — 1,200 words', body: 'Line one.\nLine two & more.', html: '<p>x</p>', defaultName: 'My-Book', ...extra
  });
  return { seen, draft, library, done: () => fs.rmSync(library, { recursive: true, force: true }) };
}

describe('Email Draft to Myself: the computer\'s own mail program', () => {
  test('a mailto: link opens with the address, subject and body, and the PDF is shown', async () => {
    const pc = computer();
    try {
      const res = await pc.draft({ method: 'mailto' });
      assert.equal(res.ok, true);
      assert.equal(res.method, 'mailto');
      assert.equal(pc.seen.opened.length, 1);
      const url = new URL(pc.seen.opened[0]);
      assert.equal(url.protocol, 'mailto:');
      assert.equal(decodeURIComponent(url.pathname), 'me@example.com');
      assert.equal(url.searchParams.get('subject'), 'NEO draft — My Book — 1,200 words');
      assert.equal(url.searchParams.get('body'), 'Line one.\nLine two & more.');
      // the snapshot is on disk in Exports, and shown to be attached
      assert.equal(pc.seen.shown.length, 1);
      assert.equal(path.dirname(pc.seen.shown[0]), path.join(pc.library, 'Exports'));
      assert.equal(fs.readFileSync(pc.seen.shown[0], 'utf8'), '%PDF-test');
    } finally {
      pc.done();
    }
  });

  test('Gmail still opens Gmail, and not a mailto: link', async () => {
    const pc = computer();
    try {
      const res = await pc.draft({ method: 'gmail' });
      assert.equal(res.method, 'gmail');
      assert.match(pc.seen.opened[0], /^https:\/\/mail\.google\.com\/mail\/\?view=cm/);
    } finally {
      pc.done();
    }
  });

  test('a computer with no mail program says no and keeps the snapshot', async () => {
    const pc = computer({ openFails: true });
    try {
      const res = await pc.draft({ method: 'mailto' });
      assert.equal(res.ok, false);
      assert.equal(pc.seen.shown.length, 1, 'the snapshot is shown, so the draft is not lost');
      assert.ok(fs.existsSync(res.file));
    } finally {
      pc.done();
    }
  });
});
