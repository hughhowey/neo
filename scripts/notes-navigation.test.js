'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const localesPath = path.join(root, 'locales');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const from = app.indexOf('// ---- notes back target:');
const to = app.indexOf('// ---- end notes back target ----');
const context = vm.createContext({});
vm.runInContext(app.slice(from, to), context);
vm.runInContext('this.api = { notesBackTarget };', context);
const { notesBackTarget } = context.api;

const i18n = require('../i18n.js');
i18n.setLocale('pt', require('../locales/pt.json'), require('../locales/en.json'));

test('a chapter notes page returns to the book notes page', () => {
  assert.equal(notesBackTarget('chapter-1', 'book', () => true), 'book');
});

test('the book notes page returns to the previous chapter notes page', () => {
  assert.equal(notesBackTarget('book', 'chapter-1', (page) => page === 'chapter-1'), 'chapter-1');
});

test('the book notes page has no return target when there is no previous chapter page', () => {
  assert.equal(notesBackTarget('book', 'book', () => true), null);
});

test('the book notes page ignores an unavailable previous chapter page', () => {
  assert.equal(notesBackTarget('book', 'deleted-chapter', () => false), null);
});

test('General notes is translated into Brazilian Portuguese', () => {
  assert.equal(i18n.t('General notes'), 'Notas gerais');
});

test('Chapter notes is translated into Brazilian Portuguese', () => {
  assert.equal(i18n.t('Chapter notes'), 'Notas do capítulo');
});

test('General notes is translated in every supported locale', () => {
  const localeFiles = fs.readdirSync(localesPath).filter((file) => /^[a-z]{2}(?:-[A-Z]{2})?\.json$/.test(file));
  for (const file of localeFiles) {
    const code = path.basename(file, '.json');
    if (code === 'en') continue;
    const locale = require(path.join(localesPath, file));
    const baseCode = code.split('-')[0];
    const base = baseCode === code ? {} : require(path.join(localesPath, baseCode + '.json'));
    const translation = { ...base, ...locale }['General notes'];
    assert.ok(translation && translation !== 'General notes', `${code} must translate General notes`);
  }
});
