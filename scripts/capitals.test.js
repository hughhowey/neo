'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// whether a book writes "i" in lowercase (#324), from app.js, run on its own
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(app.slice(app.indexOf('function writesLowercaseI('), app.indexOf('// ⌘Z (Ctrl+Z) right after: the lowercase comes back as typed')), context);

// the chapter on the page (and as last saved), and the book's other chapters
function writesLowercaseI(page, others = [], saved = '') {
  context.book = { chapterOrder: ['here', ...others.map((_, i) => 'ch' + i)] };
  context.chapterHTML = { here: saved, ...Object.fromEntries(others.map((html, i) => ['ch' + i, html])) };
  return context.writesLowercaseI({ textContent: page, closest: () => ({ dataset: { id: 'here' } }) });
}

test('a book that keeps "i" lowercase writes it that way', () => {
  assert.equal(writesLowercaseI('Jeg bor i Oslo.'), true);
  assert.equal(writesLowercaseI('Vi drar i morgen, i alle fall.'), true);
  // the first one put back with ⌘Z, at the end of the line
  assert.equal(writesLowercaseI('Det var stille. Jeg bor i '), true);
});

test('a new book, or one that writes "I", is English', () => {
  assert.equal(writesLowercaseI(''), false);
  assert.equal(writesLowercaseI('Then I saw it, and I ran.'), false);
  // a stray "i" is outnumbered
  assert.equal(writesLowercaseI('Then i went home and I slept, because I was tired.'), false);
});

test('i.e., i’s and a sentence that opens with "I" count for neither', () => {
  assert.equal(writesLowercaseI('Dot the i’s, i.e. be careful, i.e. thorough.'), false);
  assert.equal(writesLowercaseI('Det var stille. I går var jeg i byen.'), true);
});

test('the rest of the book counts too', () => {
  assert.equal(writesLowercaseI('', ['<p>Hun satt i stolen og leste i boka.</p>']), true);
  assert.equal(writesLowercaseI('Han sto i døra.', ['<p>She said I could, and I did, and I left.</p>']), false);
  // the chapter on the page counts as it stands, not as last saved
  assert.equal(writesLowercaseI('Jeg bor i Oslo.', [], '<p>Jeg bor I Oslo, I dag og I morgen.</p>'), true);
});
