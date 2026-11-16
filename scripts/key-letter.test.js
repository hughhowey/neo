'use strict';

// keyLetter (app.js): a shortcut's letter is the character its key types
// (Dvorak, BÉPO, AZERTY), or its US place when the key types no Latin letter
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const at = source.indexOf('function keyLetter(e)');
const ctx = vm.createContext({});
vm.runInContext(source.slice(at, source.indexOf('\n}\n', at) + 2) + 'this.keyLetter = keyLetter;', ctx);

test('the character typed decides, wherever the key sits', () => {
  assert.equal(ctx.keyLetter({ key: 'x', code: 'KeyB' }), 'x'); // Dvorak's X sits on QWERTY's B
  assert.equal(ctx.keyLetter({ key: 'B', code: 'KeyN' }), 'b'); // shifted
  assert.equal(ctx.keyLetter({ key: 'z', code: 'KeyW' }), 'z'); // AZERTY
});
test('a key that types no Latin letter falls back to its US place', () => {
  assert.equal(ctx.keyLetter({ key: 'и', code: 'KeyB' }), 'b'); // Russian
  assert.equal(ctx.keyLetter({ key: 'ζ', code: 'KeyZ' }), 'z'); // Greek
  assert.equal(ctx.keyLetter({ key: 'Enter', code: 'Enter' }), '');
  assert.equal(ctx.keyLetter({ key: '1', code: 'Digit1' }), '');
});
