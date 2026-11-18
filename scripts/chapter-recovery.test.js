'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const { test } = require('node:test');
const source = require('./app-files').appSource();
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const before = '<p>Old text.</p>';
const here = '<p>Local text.</p>';
const there = '<p>Remote text.</p>';
const noop = () => {};

function harness() {
  const disk = { a: there };
  let meta = { id: 'b', chapterOrder: ['a'] };
  const toasts = [];
  const errors = [];
  const snapshot = (m) => JSON.parse(JSON.stringify(m));
  const ctx = vm.createContext({
    book: { id: 'b', chapterOrder: ['a'] }, chapterHTML: { a: here }, savedHTML: { a: before },
    savedOrder: ['a'], writing: {}, diskStamps: {}, savedMetaSig: '',
    sidecarPending: {}, saveTimers: {}, bookMetaCache: new Map(), knownChapters: new Set(['a']),
    todayStr: () => 'today', mergeDayCounts: () => ({}), dayWords: () => 0,
    NeoI18n: { getLocale: () => 'en' }, t: (s) => s,
    refreshOpenAux: async () => {}, captureCaret: () => null, $: () => ({ scrollTop: 0 }),
    renderChapters: noop, wordsFromDisk: noop, updateCounters: noop,
    scheduleNavRefresh: noop, currentTab: 'manuscript', toast: (s) => toasts.push(s),
    window: { neo: {} }, console: { error: (e) => errors.push(e) },
    setTimeout: () => 1, clearTimeout: noop,
  });
  const neo = ctx.window.neo;
  neo.readBookMeta = async () => snapshot(meta);
  neo.readChapter = async (_b, c) => disk[c];
  neo.readJSON = async () => null;
  neo.logError = (e) => errors.push(e);
  neo.writeChapter = async (_b, c, html, expected) => {
    if (c !== 'a' && neo.fail === 'chapter') throw new Error('sibling write failed');
    if (disk[c] !== undefined && expected !== undefined && expected !== disk[c] && disk[c] !== html) {
      return { conflict: disk[c] };
    }
    disk[c] = html;
    return true;
  };
  ctx.writeBookMeta = async (_b, m) => {
    if (neo.fail === 'metadata') throw new Error('metadata write failed');
    meta = snapshot(m);
    return 'saved';
  };
  vm.runInContext(section('let shelfExport = false', 'function scheduleChapterSave') +
    section('function metaSig', 'function flushAllSaves') +
    section('function wordsBeyond', "window.addEventListener('focus'") +
    "knowDisk('b', 'a', savedHTML.a); savedMetaSig = metaSig(book);", ctx);
  return { disk, neo, errors, toasts, readMeta: () => meta, run: (s) => vm.runInContext(s, ctx) };
}

for (const failure of ['chapter', 'metadata']) {
  test(`refresh keeps the disk revision when writing the recovery ${failure} fails`, async () => {
    const h = harness();
    h.neo.fail = failure;
    await h.run('refreshFromDisk()');
    await new Promise(setImmediate);
    assert.equal(h.disk.a, there);
    assert.equal(h.toasts.length, 0);
    const previous = Object.keys(h.disk).filter((id) => id !== 'a');
    h.neo.fail = null;
    await h.run("persistChapter('a')");
    const [original, twin] = h.readMeta().chapterOrder;
    assert.equal(original, 'a');
    assert.equal(h.readMeta().chapterOrder.length, 2);
    assert.equal(h.disk[original], here);
    assert.equal(h.disk[twin], there);
    if (previous.length) assert.deepEqual(previous, [twin], 'the retry reuses the recovery file');
  });
}
