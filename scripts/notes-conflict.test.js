'use strict';

// The window's notes and outline saves (app.js, between `const auxPending`
// and the sidecar section) run for real inside vm, with the page and the
// bridge stubbed. Covers the base each save is checked against, one save of a
// page at a time, and a clean page taking the other device's words.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const from = appSrc.indexOf('const auxPending = {};');
const to = appSrc.indexOf('// The same promise for the JSON beside a book');
if (from < 0 || to <= from) throw new Error('app.js: the notes save block moved; update this test');
const block = appSrc.slice(from, to);

const deferred = () => { let resolve; const promise = new Promise((_resolve) => { resolve = _resolve; }); return { promise, resolve }; };
const settle = () => new Promise((resolve) => setImmediate(resolve));

function harness() {
  const ed = { dataset: { book: '', kind: '' }, innerHTML: '' };
  const toasts = [];
  const neo = {
    calls: [],
    writeAux(bookId, kind, html, expected) {
      const d = deferred();
      neo.calls.push({ bookId, kind, html, expected, done: d });
      return d.promise;
    },
    readAux: () => Promise.resolve(neo.disk),
    disk: '',
    logError() {},
  };
  const context = vm.createContext({
    $: () => ed,
    t: (s) => s,
    toast: (msg) => toasts.push(msg),
    book: { id: 'b1' },
    window: { neo },
    console,
  });
  const api = vm.runInContext(
    `let auxDirty = false;\n${block}\n({ flushAux, refreshOpenAux, auxPending, auxBase, auxSeq, setDirty(v) { auxDirty = v; } })`,
    context,
  );
  return { ed, neo, api, toasts };
}

test('1. a second save waits for the first, and is checked against what the first left on disk', async () => {
  const { ed, neo, api } = harness();
  ed.dataset = { book: 'b1', kind: 'notes' };
  api.auxBase['b1/notes'] = '<p>a</p>';
  api.setDirty(true);
  ed.innerHTML = '<p>b</p>';
  api.flushAux();
  api.setDirty(true);
  ed.innerHTML = '<p>c</p>';
  api.flushAux();
  await settle();
  assert.equal(neo.calls.length, 1, 'the second save is not sent while the first is out');
  assert.equal(neo.calls[0].expected, '<p>a</p>');
  neo.calls[0].done.resolve(true);
  await settle();
  assert.equal(neo.calls.length, 2);
  assert.equal(neo.calls[1].html, '<p>c</p>');
  assert.equal(neo.calls[1].expected, '<p>b</p>', 'the base is what the first save wrote');
  neo.calls[1].done.resolve(true);
  await settle();
  assert.deepEqual(Object.keys(api.auxPending), []);
});

test('2. a clean page refreshes from the disk; a page with words waiting does not', async () => {
  const { ed, neo, api } = harness();
  ed.dataset = { book: 'b1', kind: 'outline' };
  api.auxBase['b1/outline'] = '<p>one</p>';
  ed.innerHTML = '<p>one</p>';
  neo.disk = '<p>one</p><p>from the other device</p>';
  await api.refreshOpenAux();
  assert.equal(ed.innerHTML, '<p>one</p><p>from the other device</p>');
  assert.equal(api.auxBase['b1/outline'], '<p>one</p><p>from the other device</p>');

  api.setDirty(true);
  ed.innerHTML = '<p>typed here</p>';
  neo.disk = '<p>newer from the other device</p>';
  await api.refreshOpenAux();
  assert.equal(ed.innerHTML, '<p>typed here</p>');
});

test('3. a read that was out while a save landed does not set the base back', async () => {
  const { ed, neo, api } = harness();
  ed.dataset = { book: 'b1', kind: 'notes' };
  api.auxBase['b1/notes'] = '<p>old</p>';
  ed.innerHTML = '<p>old</p>';
  const slow = deferred();
  neo.readAux = () => slow.promise;
  const refresh = api.refreshOpenAux();
  api.setDirty(true);
  ed.innerHTML = '<p>mine</p>';
  api.flushAux();
  await settle();
  neo.calls[0].done.resolve(true);
  await settle();
  assert.equal(api.auxBase['b1/notes'], '<p>mine</p>');
  slow.resolve('<p>old</p>');
  await refresh;
  assert.equal(api.auxBase['b1/notes'], '<p>mine</p>');
  assert.equal(ed.innerHTML, '<p>mine</p>');
});
