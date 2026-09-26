const assert = require('node:assert/strict');
const { resolveInterfaceLanguage, normalizeLegacyShelfName } = require('../interface-language');

assert.equal(resolveInterfaceLanguage({}, 'pt-BR'), 'pt-BR');
assert.equal(resolveInterfaceLanguage({}, 'en-US'), 'pt-BR');
assert.equal(resolveInterfaceLanguage({ interfaceLanguage: 'en' }, 'pt-BR'), 'en');
assert.equal(resolveInterfaceLanguage({ interfaceLanguage: 'pt-BR' }, 'en-US'), 'pt-BR');
assert.equal(normalizeLegacyShelfName('Works in Progress'), 'Em andamento');
assert.equal(normalizeLegacyShelfName('New Shelf'), 'Nova biblioteca');

console.log('interface-language tests passed');
