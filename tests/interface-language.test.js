const assert = require('node:assert/strict');
const { resolveInterfaceLanguage, getSpellDictionaryConfig, normalizeLegacyShelfName } = require('../interface-language');

assert.equal(resolveInterfaceLanguage({}, 'pt-BR'), 'pt-BR');
assert.equal(resolveInterfaceLanguage({}, 'en-US'), 'pt-BR');
assert.equal(resolveInterfaceLanguage({ interfaceLanguage: 'en' }, 'pt-BR'), 'en');
assert.equal(resolveInterfaceLanguage({ interfaceLanguage: 'pt-BR' }, 'en-US'), 'pt-BR');
assert.deepEqual(getSpellDictionaryConfig('pt-BR'), {
	locale: 'pt-BR',
	trie: 'dict/pt_BR.trie.gz'
});
assert.deepEqual(getSpellDictionaryConfig('en'), { locale: 'en', trie: null });
assert.equal(normalizeLegacyShelfName('Works in Progress'), 'Em andamento');
assert.equal(normalizeLegacyShelfName('New Shelf'), 'Nova biblioteca');

console.log('interface-language tests passed');
