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
vm.runInContext('this.api = { NB_CHARS, nonBreakingRuns };', context);
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
