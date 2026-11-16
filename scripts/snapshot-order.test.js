'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const between = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const SECOND = Date.UTC(2026, 10, 15, 12);

function library() {
  const files = {};
  const reads = [];
  const neo = {
    async snapshotList() { return Object.entries(files).reverse().map(([name, data]) => ({ name, files: Object.keys(data) })); },
    async snapshotRead(id, name, file) { reads.push([name, file]); if (!(file in files[name])) throw new Error('unavailable'); return files[name][file]; },
    async snapshotWrite(id, name, file, text) { files[name] ||= {}; if (file in files[name]) return false; files[name][file] = text; return true; },
    async snapshotRemove(id, name) { delete files[name]; },
    logError() {}
  };
  const ctx = vm.createContext({ window: { neo }, snapsCan: () => true, renderSnapList() {}, logSnap(e) { throw e; },
    htmlWords: (html) => html.split(/\s+/).filter(Boolean).length });
  vm.runInContext(between('const SNAP_KEPT', '// (the rules above are plain functions: scripts/snapshots.test.js)') +
    between('let snapCache = null;', '// The first change of a writing day') +
    'let book = { id: "test", title: "Test", chapterOrder: ["a", "b"], chapterTitles: {} };' +
    'this.api = { snapName, loadSnaps, snapHolder, thinSnapshots, takeSnapshot, setTime: (t) => { Date.now = () => t; } };', ctx);
  const add = (at, changed, data, kind = 'k') => {
    const name = ctx.api.snapName(at, kind, changed, 10, 'test' + Object.keys(files).length);
    files[name] = { 'snapshot.json': JSON.stringify({ at: new Date(at).toISOString() }), ...data };
    return name;
  };
  return { ...ctx.api, files, reads, neo, add };
}

test('legacy same-second snapshots reconstruct unchanged chapters after reloading', async () => {
  const lib = library();
  const old = lib.add(SECOND + 100, 5, { 'a.html': 'old a', 'b.html': 'unchanged b' });
  const next = lib.add(SECOND + 900, 1, { 'a.html': 'new a' });
  const list = await lib.loadSnaps('test', true);
  assert.deepEqual(Array.from(list, (s) => s.name), [old, next]);
  assert.equal(lib.snapHolder(list, 1, 'b').name, old);
  assert.equal(lib.snapHolder(list, 1, 'a').name, next);
  assert.equal(lib.files[old]['b.html'], 'unchanged b');
});

test('only tied seconds read metadata; unfinished folders are ignored', async () => {
  const lib = library();
  const first = lib.add(SECOND, 2, { 'a.html': 'a' });
  const second = lib.add(SECOND + 1000, 1, { 'a.html': 'a2' });
  lib.files[lib.snapName(SECOND + 500, 'r', 1, 2, 'partial')] = { 'a.html': 'unfinished' };
  assert.deepEqual(Array.from(await lib.loadSnaps('test', true), (s) => s.name), [first, second]);
  assert.equal(lib.reads.length, 0);
});

test('unreadable or invalid tied metadata still loads, but nothing is thinned', async () => {
  for (const bad of ['{', '{}', '{"at":"invalid"}', JSON.stringify({ at: new Date(SECOND + 2000).toISOString() })]) {
    const lib = library();
    const old = lib.add(SECOND + 100, 2, { 'a.html': 'keep me' }, 'd');
    lib.add(SECOND + 900, 1, { 'a.html': 'next' }, 'd');
    lib.files[old]['snapshot.json'] = bad;
    const list = await lib.loadSnaps('test', true);
    assert.equal(list.length, 2);
    assert.equal(list.uncertain, true);
    await lib.thinSnapshots(lib.neo, 'test', list, SECOND + 40 * 86400000);
    assert.equal(lib.files[old]['a.html'], 'keep me');
  }
});

test('same-millisecond saves and a backwards clock remain ordered after reopening', async () => {
  const lib = library();
  lib.setTime(SECOND + 100);
  const first = await lib.takeSnapshot('k', (c) => c + ' first', {});
  const second = await lib.takeSnapshot('r', (c) => c === 'a' ? 'a second' : 'b first', {});
  lib.setTime(SECOND - 5000);
  const third = await lib.takeSnapshot('k', (c) => c === 'a' ? 'a third' : 'b first', {});
  const list = await lib.loadSnaps('test', true);
  assert.deepEqual(Array.from(list, (s) => s.name), [first.snap.name, second.snap.name, third.snap.name]);
  assert.deepEqual(Array.from(list, (s) => s.at), [SECOND + 100, SECOND + 101, SECOND + 102]);
  assert.equal(lib.snapHolder(list, 2, 'b').name, first.snap.name);
  assert.equal(lib.files[third.snap.name]['b.html'], undefined, 'unchanged chapters are not rewritten');
});

test('thinning same-second snapshots carries unchanged text forward in creation order', async () => {
  const lib = library();
  const old = lib.add(SECOND + 100, 5, { 'a.html': 'old a', 'b.html': 'keep b' }, 'd');
  const next = lib.add(SECOND + 900, 1, { 'a.html': 'new a' }, 'r');
  const list = await lib.loadSnaps('test', true);
  await lib.thinSnapshots(lib.neo, 'test', list, SECOND + 40 * 86400000);
  assert.equal(lib.files[old], undefined);
  assert.equal(lib.files[next]['a.html'], 'new a');
  assert.equal(lib.files[next]['b.html'], 'keep b');
  assert.equal(list.length, 1);
});
