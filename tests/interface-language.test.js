const assert = require('node:assert/strict');
const { resolveInterfaceLanguage, getSpellDictionaryConfig, normalizeLegacyShelfName } = require('../interface-language');
const { display, normalize } = require('../shelf-names');

assert.equal(resolveInterfaceLanguage({}, 'pt-BR'), 'pt-BR');
assert.equal(resolveInterfaceLanguage({}, 'en-US'), 'en');
assert.equal(resolveInterfaceLanguage({ interfaceLanguage: 'en' }, 'pt-BR'), 'en');
assert.equal(resolveInterfaceLanguage({ interfaceLanguage: 'pt-BR' }, 'en-US'), 'pt-BR');
assert.deepEqual(getSpellDictionaryConfig('pt-BR'), {
	locale: 'pt-BR',
	trie: 'dict/pt_BR.trie.gz'
});
assert.deepEqual(getSpellDictionaryConfig('en'), { locale: 'en', trie: null });
assert.equal(normalizeLegacyShelfName('Works in Progress'), 'Em andamento');
assert.equal(normalizeLegacyShelfName('New Shelf'), 'Nova biblioteca');
assert.equal(display('Em andamento', 'en'), 'Works in Progress');
assert.equal(display('Nova biblioteca', 'en'), 'New Shelf');
assert.equal(display('Minha estante', 'en'), 'Minha estante');
assert.equal(normalize('Works in Progress'), 'Works in Progress');
assert.equal(normalize('Nova biblioteca'), 'New Shelf');

console.log('interface-language tests passed');
