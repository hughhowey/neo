'use strict';

// The check that a library folder can be saved in (#474): a folder in Dropbox
// or one an antivirus watches may hold the test file for a moment, and a test
// file that can't be deleted after it was written is no sign of a folder
// that can't be saved in. Loads main.js the way library-folder.test.js does,
// with the file system's write and delete made to fail on cue.

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

const refusal = (code) => Object.assign(new Error(code + ': the file is in use'), { code });

// writes: the errors the first writes of the test file fail with, in turn;
// unlinkError: what deleting it fails with
function folder({ writes = [], unlinkError = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-probe-'));
  const log = { writes: 0, unlinks: 0 };
  const fsApi = Object.create(fs);
  fsApi.writeFileSync = (file, data, ...rest) => {
    if (String(file).endsWith('.neo-write-test')) {
      const err = writes[log.writes++];
      if (err) throw err;
    }
    return fs.writeFileSync(file, data, ...rest);
  };
  fsApi.unlinkSync = (file) => {
    if (String(file).endsWith('.neo-write-test')) {
      log.unlinks++;
      if (unlinkError) throw unlinkError;
    }
    return fs.unlinkSync(file);
  };
  const electron = {
    app: { commandLine: { appendSwitch() {} }, getPath: () => os.tmpdir(), getLocale: () => 'en', requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {} },
    ipcMain: { on() {}, handle() {} },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
    dialog: {},
    utilityProcess: { fork: () => ({ on() {}, postMessage() {} }) },
    screen: {}
  };
  const context = vm.createContext({
    require: (name) => (name === 'electron' ? electron : name === 'fs' ? fsApi : localRequire(name)),
    __dirname: root,
    process: { platform: process.platform, on() {} },
    console,
    Atomics,
    SharedArrayBuffer,
    Int32Array,
    dir
  });
  vm.runInContext(source, context, { filename: path.join(root, 'main.js') });
  return { log, writable: () => vm.runInContext('folderWritable(dir)', context), done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

describe('a library folder that can be saved in', { concurrency: 1 }, () => {
  test('a plain folder passes, and the test file is gone', () => {
    const pc = folder();
    try {
      assert.equal(pc.writable(), true);
      assert.equal(pc.log.writes, 1);
    } finally { pc.done(); }
  });

  test('a test file that is written but can\'t be deleted still passes', () => {
    for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
      const pc = folder({ unlinkError: refusal(code) });
      try {
        assert.equal(pc.writable(), true, code);
        assert.equal(pc.log.unlinks, 1);
      } finally { pc.done(); }
    }
  });

  test('a folder that holds the test file for a moment passes on the next try', () => {
    const pc = folder({ writes: [refusal('EBUSY'), refusal('EPERM')] });
    try {
      assert.equal(pc.writable(), true);
      assert.equal(pc.log.writes, 3);
    } finally { pc.done(); }
  });

  test('a folder that keeps refusing is still reported, after three tries', () => {
    const pc = folder({ writes: [refusal('EPERM'), refusal('EPERM'), refusal('EPERM'), refusal('EPERM')] });
    try {
      assert.equal(pc.writable(), false);
      assert.equal(pc.log.writes, 3);
    } finally { pc.done(); }
  });

  test('a folder that can\'t exist is reported at once, with no waiting', () => {
    const pc = folder({ writes: [refusal('ENOSPC')] });
    try {
      assert.equal(pc.writable(), false);
      assert.equal(pc.log.writes, 1);
    } finally { pc.done(); }
  });
});
