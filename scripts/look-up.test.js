'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const { test } = require('node:test');

// the look-up rule from app.js, on its own
const app = require('./app-files').appSource();
const from = app.indexOf('// ---- look up rules:');
const to = app.indexOf('// ---- end of look up rules ----');
const context = vm.createContext({});
vm.runInContext(app.slice(from, to), context);
vm.runInContext('this.api = { lookUpWord, LOOK_UP_MAX_WORD };', context);
const api = context.api;

test('one word is looked up, with surrounding spaces trimmed', () => {
  assert.equal(api.lookUpWord('  thesaurus '), 'thesaurus');
  assert.equal(api.lookUpWord('well-known'), 'well-known');
});

test('nothing is looked up when the selection is empty or a phrase', () => {
  assert.equal(api.lookUpWord(''), null);
  assert.equal(api.lookUpWord('   '), null);
  assert.equal(api.lookUpWord('two words'), null);
});

test('an overlong run of characters is not a word lookup', () => {
  assert.equal(api.lookUpWord('x'.repeat(api.LOOK_UP_MAX_WORD + 1)), null);
});
