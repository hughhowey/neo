'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Find's matching from app.js, on its own: a paragraph's text nodes in, the
// places the query appears out, as [node, offset] pairs a Range can take
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = app.indexOf('// ---- find\'s matching:');
const to = app.indexOf('// ---- end of find\'s matching ----');
const context = vm.createContext({});
vm.runInContext(app.slice(from, to), context);
vm.runInContext('this.api = { matchSpans };', context);
const { matchSpans } = context.api;

// the spans come out of another realm, so they are compared as JSON
const spans = (texts, q) => JSON.parse(JSON.stringify(matchSpans(texts, q)));

test('a word inside one text node is found, every time it appears, in any case', () => {
  assert.deepEqual(spans(['Salt and SALT and salt'], 'salt'), [
    { from: [0, 0], to: [0, 4] },
    { from: [0, 9], to: [0, 13] },
    { from: [0, 18], to: [0, 22] }
  ]);
});

test('a phrase that runs into italic or bold is found', () => {
  // <p>She read <em>The Hunger</em> Games.</p>
  assert.deepEqual(spans(['She read ', 'The Hunger', ' Games.'], 'read the hunger games'), [
    { from: [0, 4], to: [2, 6] }
  ]);
  // <p><strong>Never</strong> again.</p>
  assert.deepEqual(spans(['Never', ' again.'], 'never again'), [
    { from: [0, 0], to: [1, 6] }
  ]);
});

test('a word split across formatting runs is found', () => {
  // what a .docx import can leave: <em>Hun</em><em>ger</em>
  assert.deepEqual(spans(['Hun', 'ger'], 'hunger'), [{ from: [0, 0], to: [1, 3] }]);
});

test('a match starts in the node holding its first letter and ends in the node holding its last', () => {
  // no span opens at the very end of one node or closes at the very start of the next
  assert.deepEqual(spans(['salt', 'road'], 'road'), [{ from: [1, 0], to: [1, 4] }]);
  assert.deepEqual(spans(['salt', 'road'], 'salt'), [{ from: [0, 0], to: [0, 4] }]);
});

test('a letter whose lower case is longer does not shift the matches after it', () => {
  // 'İ'.toLowerCase() is two characters long
  assert.deepEqual(spans(['İstanbul ', 'cat'], 'cat'), [{ from: [1, 0], to: [1, 3] }]);
  assert.deepEqual(spans(['İstanbul CAT'], 'cat'), [{ from: [0, 9], to: [0, 12] }]);
});

test('nothing to look for finds nothing', () => {
  assert.deepEqual(spans(['Salt road'], ''), []);
  assert.deepEqual(spans([], 'salt'), []);
  assert.deepEqual(spans(['Salt road'], 'pepper'), []);
});
