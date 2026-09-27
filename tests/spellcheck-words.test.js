const assert = require('node:assert/strict');
const { normalize, wordPattern, isAllCaps } = require('../spellcheck-words');

const text = 'Teste de tradução! Português, ação e ação.';
const words = [...text.matchAll(wordPattern())].map(([word]) => word);

assert.deepEqual(words, ['Teste', 'de', 'tradução', 'Português', 'ação', 'e', 'ação']);
assert.equal(normalize('Português'), 'português');
assert.equal(normalize('ação'), 'ação');
assert.equal(isAllCaps('PORTUGUÊS'), true);
assert.equal(isAllCaps('Português'), false);

console.log('spellcheck word tests passed');