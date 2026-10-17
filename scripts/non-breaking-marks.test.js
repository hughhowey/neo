'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// the non-breaking mark rules from app.js, on their own
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = app.indexOf('// ---- non-breaking marks:');
const to = app.indexOf('// ---- end of non-breaking marks ----');
const context = vm.createContext({});
vm.runInContext(app.slice(from, to), context);
vm.runInContext('this.api = { NB_CHARS, nonBreakingRuns, SOFT_HYPHEN, softHyphenOffsets, softHyphenTick, SHY_MARK_WIDTH };', context);
const api = context.api;

// the runs come out of another realm, so they are compared as JSON
const runs = (text) => JSON.stringify(api.nonBreakingRuns(text));

test('the three characters map to their own kinds', () => {
  assert.equal(api.NB_CHARS['\u00a0'], 'space');
  assert.equal(api.NB_CHARS['\u202f'], 'narrow');
  assert.equal(api.NB_CHARS['\u2011'], 'hyphen');
});

test('plain text has no non-breaking runs', () => {
  assert.equal(runs('Dr. Müller and 5 km'), '[]');
});

test('a no-break space is found, and a streak of them is one run', () => {
  assert.equal(runs('Dr.\u00a0Müller'), JSON.stringify([{ start: 3, end: 4, kind: 'space' }]));
  assert.equal(runs('a\u00a0\u00a0\u00a0b'), JSON.stringify([{ start: 1, end: 4, kind: 'space' }]));
});

test('the narrow no-break space and the no-break hyphen are their own kinds', () => {
  assert.equal(runs('5\u202fkm'), JSON.stringify([{ start: 1, end: 2, kind: 'narrow' }]));
  assert.equal(runs('n\u2011th'), JSON.stringify([{ start: 1, end: 2, kind: 'hyphen' }]));
});

test('runs keep their order and do not merge across different characters', () => {
  assert.equal(
    runs('a\u00a0b\u202fc\u00a0\u202fd'),
    JSON.stringify([
      { start: 1, end: 2, kind: 'space' },
      { start: 3, end: 4, kind: 'narrow' },
      { start: 5, end: 6, kind: 'space' },
      { start: 6, end: 7, kind: 'narrow' },
    ]),
  );
});

// soft hyphens: found by offset, kept out of the gray runs, and each given a
// mark centred on its left edge

const offsets = (text) => JSON.stringify(api.softHyphenOffsets(text));

test('the soft hyphen is U+00AD', () => {
  assert.equal(api.SOFT_HYPHEN, '\u00ad');
});

test('plain text has no soft hyphens', () => {
  assert.equal(offsets('Donaudampfschifffahrt'), '[]');
  assert.equal(offsets(''), '[]');
});

test('every soft hyphen is found, in order, including at the edges', () => {
  assert.equal(offsets('Donau\u00addampf\u00adschiff\u00adfahrt'), '[5,11,18]');
  assert.equal(offsets('\u00adab\u00ad'), '[0,3]');
  assert.equal(offsets('a\u00ad\u00adb'), '[1,2]');
});

test('soft hyphens are not non-breaking runs, and the runs still show beside them', () => {
  assert.equal(runs('Donau\u00addampf'), '[]');
  assert.equal(
    runs('Dr.\u00a0Donau\u00adschiff'),
    JSON.stringify([{ start: 3, end: 4, kind: 'space' }]),
  );
});

const tick = (rect, origin, em) => JSON.stringify(api.softHyphenTick(rect, origin, em));

test('the mark is 0.28em wide', () => {
  assert.equal(api.SHY_MARK_WIDTH, 0.28);
});

test('mid-line: a zero-wide soft hyphen gets a 0.28em by 0.9em mark centred on it and on its line', () => {
  assert.equal(
    tick({ left: 300, top: 220, width: 0, height: 36 }, { left: 100, top: 20 }, 30),
    JSON.stringify({ left: 195.8, top: 204.5, width: 8.4, height: 27 }),
  );
});

test('the mark keeps its centre on the break point at any type size', () => {
  for (const em of [12, 17, 20, 34]) {
    const at = api.softHyphenTick({ left: 300, top: 220, width: 0, height: em * 1.2 }, { left: 100, top: 20 }, em);
    assert.ok(Math.abs(at.left + at.width / 2 - 200) < 1e-9);
    assert.ok(Math.abs(at.width - em * 0.28) < 1e-9);
    assert.ok(Math.abs(at.top + at.height / 2 - (200 + em * 0.6)) < 1e-9);
  }
});

test('at a line break: the mark is centred on the box\'s left edge, where the word breaks', () => {
  assert.equal(
    tick({ left: 640, top: 420, width: 0, height: 36 }, { left: 100, top: 20 }, 30),
    JSON.stringify({ left: 535.8, top: 404.5, width: 8.4, height: 27 }),
  );
});

test('no box, or a box with no height, draws no mark', () => {
  assert.equal(api.softHyphenTick(null, { left: 0, top: 0 }, 17), null);
  assert.equal(api.softHyphenTick({ left: 5, top: 5, width: 0, height: 0 }, { left: 0, top: 0 }, 17), null);
});
