// The window's calls reach main.js only through preload.js; a method that
// drops an argument there never shows up in tests that call main's handlers.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPreload() {
  const calls = [];
  let api = null;
  const ipcRenderer = {
    invoke: (...a) => { calls.push(a); return Promise.resolve(); },
    send: () => {},
    sendSync: () => ({}),
    on: () => {}
  };
  const electron = {
    contextBridge: { exposeInMainWorld: (_n, o) => { api = o; } },
    ipcRenderer,
    webUtils: {}
  };
  const src = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  vm.runInNewContext(src, { require: () => electron, process: { platform: 'test' } });
  return { api, calls };
}

test('writeAux forwards the expected base to aux:write', () => {
  const { api, calls } = loadPreload();
  api.writeAux('b', 'notes', '<p>x</p>', '<p>base</p>');
  assert.deepStrictEqual(calls[0], ['aux:write', 'b', 'notes', '<p>x</p>', '<p>base</p>']);
});

test('writeChapter forwards the expected stamp to chapter:write', () => {
  const { api, calls } = loadPreload();
  api.writeChapter('b', 'c1', '<p>x</p>', 'stamp');
  assert.deepStrictEqual(calls[0], ['chapter:write', 'b', 'c1', '<p>x</p>', 'stamp']);
});
