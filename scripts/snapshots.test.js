'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// the snapshot rules from app.js (SNAPSHOTS), run on their own
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(app.slice(app.indexOf('const SNAP_KEPT'), app.indexOf('// (the rules above are plain functions: scripts/snapshots.test.js)')), context);
vm.runInContext('this.api = { snapName, parseSnapName, textHash, snapsToThin, snapHolder, wordsGone };', context);
const { snapName, parseSnapName, textHash, snapsToThin, snapHolder, wordsGone } = context.api;
const plain = (v) => JSON.parse(JSON.stringify(v));
const DAY = 86400000;

test('a snapshot\'s name says when, what kind, how much changed and the words', () => {
  const at = Date.UTC(2026, 9, 9, 12, 14, 7);
  const name = snapName(at, 'k', 3, 84210.4, 'x7q2');
  assert.equal(name, '20261009T121407Z-k-3-84210-x7q2');
  assert.deepEqual(plain(parseSnapName(name)), { name, at, kind: 'k', changed: 3, words: 84210 });
  assert.match(name, /^[A-Za-z0-9-]+$/); // main.js's own check
  for (const bad of ['snapshot.json', '..', '20261009T121407Z-k-3-x7q2', '20261009T121407Z-K-3-1-a']) assert.equal(parseSnapName(bad), null, bad);
});

test('the fingerprint tells texts apart', () => {
  assert.equal(textHash('<p>Wren pushed.</p>'), textHash('<p>Wren pushed.</p>'));
  assert.notEqual(textHash('<p>Wren pushed.</p>'), textHash('<p>Wren pulled.</p>'));
  assert.notEqual(textHash(''), textHash(' '));
});

test('NEO\'s own snapshots go after a month; ⌘S ones and the newest stay', () => {
  const now = Date.UTC(2026, 9, 9);
  const s = (daysAgo, kind) => ({ name: kind + daysAgo, at: now - daysAgo * DAY, kind });
  const snaps = [s(90, 'd'), s(60, 'k'), s(45, 'r'), s(29, 'd'), s(1, 'd')];
  assert.deepEqual(plain(snapsToThin(snaps, now)).sort(), ['d90', 'r45']);
  // the newest stays even when it's old
  assert.deepEqual(plain(snapsToThin([s(90, 'd')], now)), []);
});

test('a chapter\'s text at a snapshot is in the newest snapshot holding it', () => {
  const snaps = [
    { name: 'a', files: new Set(['c1.html', 'c2.html', 'snapshot.json']) },
    { name: 'b', files: new Set(['c2.html', 'snapshot.json']) },
    { name: 'c', files: new Set(['snapshot.json']) }
  ];
  assert.equal(snapHolder(snaps, 2, 'c1').name, 'a');
  assert.equal(snapHolder(snaps, 2, 'c2').name, 'b');
  assert.equal(snapHolder(snaps, 0, 'c2').name, 'a');
  assert.equal(snapHolder(snaps, 2, 'c3'), null);
});

test('marked: the words a snapshot has that the chapter no longer does', () => {
  const old = [
    'The hatch would not give.',
    'She counted the rungs on the way down. Forty-one.',
    'Below, someone was singing, not a song she knew.',
    ''
  ];
  const cur = [
    'The hatch would not give.',
    'Below, someone was singing. Not a song she knew.'
  ];
  const gone = plain(wordsGone(old, cur));
  assert.equal(gone[0], null, 'still there word for word');
  assert.equal(gone[1], 'all', 'no twin today: gone whole');
  assert.deepEqual(gone[2], [3, 4], '"singing," and "not" changed');
  assert.equal(gone[3], null, 'an empty line is never marked');
  assert.deepEqual(plain(wordsGone(['a b c'], ['a b c d e'])), [null]);
});

// #448: the snapshot on the page and the list belong to the open book
const between = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));
function snapPane() {
  const el = (html) => ({ hidden: false, innerHTML: html });
  const els = { '#snap-view': el('<section class="snap-chapter">…</section>'), '#snap-list': el('<button class="snap-item">9:13 AM</button>') };
  const highlights = new Map([['neo-snap-gone', {}]]);
  const CSS = { highlights };
  const ctx = vm.createContext({ $: (sel) => els[sel] || null, CSS, window: { CSS } });
  vm.runInContext('let snapShown = { name: "20261009T121407Z-k-3-84210-x7q2" }; let snapCache = { bookId: "book-one", snaps: [] };\n' +
    between('// the snapshot on the page goes, and its marks with it', 'function snapList() {') +
    'this.api = { hideSnapshot, forgetSnapshots, state: () => ({ snapShown, snapCache }) };', ctx);
  return { ...ctx.api, els, highlights };
}

test('another tab hides the snapshot on the page; the list stays for the book', () => {
  const pane = snapPane();
  pane.hideSnapshot();
  assert.equal(pane.state().snapShown, null);
  assert.equal(pane.els['#snap-view'].hidden, true);
  assert.equal(pane.els['#snap-view'].innerHTML, '');
  assert.equal(pane.highlights.has('neo-snap-gone'), false);
  assert.match(pane.els['#snap-list'].innerHTML, /snap-item/);
  assert.equal(pane.state().snapCache.bookId, 'book-one');
});

test('a book that closes takes its snapshots along: page, list and cache', () => {
  const pane = snapPane();
  pane.forgetSnapshots();
  assert.equal(pane.state().snapShown, null);
  assert.equal(pane.state().snapCache, null);
  assert.equal(pane.els['#snap-view'].hidden, true);
  assert.equal(pane.els['#snap-view'].innerHTML, '');
  assert.equal(pane.els['#snap-list'].innerHTML, '');
  assert.equal(pane.highlights.has('neo-snap-gone'), false);
  // openBook and backToShelf both do it
  for (const fn of ['async function openBook(', 'async function backToShelf(']) {
    assert.match(between(fn, '\n}\n'), /forgetSnapshots\(\)/, fn);
  }
});

test('the footnote lists pass over a snapshot\'s page: opening another book doesn\'t stop there', () => {
  // a snapshot's chapters are .chapter-body too, but sit in #snap-view, not in a .chapter
  const snapBody = { isConnected: true, closest: () => null, querySelectorAll: () => [{ dataset: { note: 'a note' } }] };
  let removed = false;
  const chapter = { querySelector: () => ({ remove: () => { removed = true; } }) };
  const pageBody = { isConnected: true, closest: (sel) => (sel === '.chapter' ? chapter : null), querySelectorAll: () => [] };
  const ctx = vm.createContext({ document: { querySelectorAll: () => [snapBody, pageBody] } });
  vm.runInContext(between('function renderFootnoteList(', '// a marker deleted with Backspace or Delete') + 'this.renderAllFootnoteLists = renderAllFootnoteLists;', ctx);
  assert.doesNotThrow(() => ctx.renderAllFootnoteLists());
  assert.equal(removed, true, 'the manuscript\'s chapter after it is still seen to (its stale list goes)');
});
