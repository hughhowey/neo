'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Rule: a chapter's words reach the disk once, however many saves ask for
// them. A book in memory, saved through persistChapter to a disk that notes
// what it is handed and flushed by flushAllSaves; the page's drawing is left out.
const SLICES = [
  ['const diskKnown = {};', '// Another device\'s version of a chapter'],
  ['function scheduleChapterSave(', '// book.json minus the parts'],
  ['function metaSig(', 'function scheduleMetaSave('],
  ['function flushAllSaves(', '/*  SNAPSHOTS']
];
function bookInMemory(chapters) {
  const writes = [];
  const none = () => {};
  const page = vm.createContext({
    window: { neo: {
      writeChapter: async (bookId, chId, html) => { writes.push({ chId, html }); return true; }
    } },
    book: { id: 'b', chapterOrder: Object.keys(chapters) },
    chapterHTML: { ...chapters },
    savedHTML: { ...chapters },
    savedMetaSig: '',
    writing: {},
    saveTimers: {},
    tabPlaces: {},
    currentTab: 'manuscript',
    currentChapterId: null,
    shelfExport: false,
    console,
    setTimeout,
    $: () => ({ scrollTop: 0 }),
    captureCaret: () => null,
    saveMeta: async () => {},
    maybeDailySnapshot: none,
    flushAux: none, flushStickiesSave: none, flushSidecars: none
  });
  for (const [from, to] of SLICES) {
    const at = app.indexOf(from);
    vm.runInContext(app.slice(at, app.indexOf(to, at)), page);
  }
  page.savedMetaSig = page.metaSig(page.book);
  return { page, writes };
}
// every chapter write started so far, to the end
const settled = (page) => vm.runInContext('Promise.all(Object.values(chapterChain))', page);

const F = '<p>First line.</p><p>Second line.</p><p>Third line.</p>';

// The book's timers held by the test: run() runs those due, as 800 ms
// passing would, and says how many ran
function heldTimers(page) {
  const due = new Map();
  let next = 0;
  page.setTimeout = (fn) => { due.set(++next, fn); return next; };
  page.clearTimeout = (id) => { due.delete(id); };
  return { run() { const fns = [...due.values()]; due.clear(); fns.forEach((fn) => fn()); return fns.length; } };
}

// A flush (a blur, the 20 s tick) writes a chapter whose 800 ms save is still
// waiting. That save, come due, has nothing left to write.
test('a save that comes due after a flush wrote its words writes nothing', async () => {
  const { page, writes } = bookInMemory({ x: F });
  const timers = heldTimers(page);
  page.chapterHTML.x = F + '<p>Typed.</p>';
  page.scheduleChapterSave('x');
  page.flushAllSaves();
  await settled(page);
  assert.deepEqual(writes, [{ chId: 'x', html: F + '<p>Typed.</p>' }], 'the flush wrote the words');
  assert.equal(timers.run(), 1, 'the save was still waiting');
  await settled(page);
  assert.deepEqual(writes, [{ chId: 'x', html: F + '<p>Typed.</p>' }]);
});

test('a save that comes due with words typed since the flush writes them', async () => {
  const { page, writes } = bookInMemory({ x: F });
  const timers = heldTimers(page);
  page.chapterHTML.x = F + '<p>Typed.</p>';
  page.scheduleChapterSave('x');
  page.flushAllSaves();
  await settled(page);
  page.chapterHTML.x += '<p>More.</p>';
  page.scheduleChapterSave('x');
  assert.equal(timers.run(), 1);
  await settled(page);
  assert.deepEqual(writes.map((w) => w.html), [F + '<p>Typed.</p>', F + '<p>Typed.</p><p>More.</p>']);
});

// A write still on its way may fail, and savedHTML then goes back to what
// the disk holds: a save that comes due meanwhile queues behind it, so the
// words are tried again at once rather than at the next flush
test('a save that comes due while a write is on its way writes when that write fails', async () => {
  const { page, writes } = bookInMemory({ x: F });
  const timers = heldTimers(page);
  const written = page.window.neo.writeChapter;
  let fail;
  page.window.neo.writeChapter = () => {
    page.window.neo.writeChapter = written;
    return new Promise((resolve, reject) => { fail = reject; });
  };
  page.chapterHTML.x = F + '<p>Typed.</p>';
  page.scheduleChapterSave('x');
  const flushed = page.persistChapter('x').then(() => 'written', () => 'failed');
  assert.equal(page.writing.x, 1, 'the write is on its way');
  assert.equal(timers.run(), 1, 'the save was still waiting');
  await new Promise((resolve) => setImmediate(resolve));
  fail(new Error('the disk refused'));
  assert.equal(await flushed, 'failed');
  await settled(page);
  assert.deepEqual(writes, [{ chId: 'x', html: F + '<p>Typed.</p>' }]);
});
