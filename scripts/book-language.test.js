'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const I18n = require('../i18n.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function room() {
  const ui = I18n.create();
  ui.setLocale('en', {}, {});
  const ctx = vm.createContext({ book: null, library: {}, NeoI18n: ui, t: ui.t,
    SPELL_LANGUAGE_NAMES: { 'en-US': 'English', fr: 'French', de: 'German', 'pt-BR': 'Portuguese', el: 'Greek' },
    window: { neo: { writingI18n: async (locale) => ({ locale, dict: { 'Chapter {n}': 'Kapitel {n}' }, base: {} }) } } });
  vm.runInContext(source.slice(source.indexOf('function writingLanguage('), source.indexOf('function quoteStyle(')), ctx);
  return ctx;
}
test('book choice wins, otherwise language follows the library then the interface', () => {
  const ctx = room();
  assert.equal(ctx.writingLanguage(), 'en');
  ctx.library.spellLanguage = 'fr';
  assert.equal(ctx.writingLanguage(), 'fr');
  ctx.book = { writingLanguage: 'de' };
  assert.equal(ctx.writingLanguage(), 'de');
  assert.equal(ctx.writingLanguage({}), 'fr', 'another book does not borrow the open book’s override');
});
test('invalid metadata falls back safely; regional codes are canonicalised', () => {
  const ctx = room();
  ctx.library.spellLanguage = 'fr';
  assert.equal(ctx.writingLanguage({ writingLanguage: '../../file' }), 'fr');
  assert.equal(ctx.writingLanguage({ writingLanguage: 'en-gb' }), 'en-GB');
});
test('book translators do not alter the application translator and are cached', async () => {
  const ctx = room();
  let reads = 0;
  const read = ctx.window.neo.writingI18n;
  ctx.window.neo.writingI18n = async (code) => { reads++; return read(code); };
  ctx.book = { writingLanguage: 'de' };
  await ctx.prepareWritingLanguage(ctx.book);
  await ctx.prepareWritingLanguage(ctx.book);
  assert.equal(ctx.writingText('Chapter {n}', { n: 2 }), 'Kapitel 2');
  assert.equal(ctx.NeoI18n.t('Chapter {n}', { n: 2 }), 'Chapter 2');
  assert.equal(ctx.NeoI18n.getLocale(), 'en');
  assert.equal(reads, 1);
});
test('dictionary selection handles regions, Portuguese and missing dictionaries', () => {
  const ctx = room();
  assert.equal(ctx.writingDictionary('en'), 'en-US');
  assert.equal(ctx.writingDictionary('pt'), 'pt-BR');
  assert.equal(ctx.writingDictionary('de-CH'), 'de');
  assert.equal(ctx.writingDictionary('el'), 'el');
  assert.equal(ctx.writingDictionary('it'), 'en-US');
});
test('independent translation instances retain their own plurals and locale', () => {
  const a = I18n.create(), b = I18n.create();
  a.setLocale('fr', { '{n} words': { one: '{n} mot', other: '{n} mots' } }, {});
  b.setLocale('en', {}, { '{n} words': { one: '{n} word', other: '{n} words' } });
  assert.equal(a.t('{n} words', { n: 2 }), '2 mots');
  assert.equal(b.t('{n} words', { n: 1 }), '1 word');
  assert.equal(a.getLocale(), 'fr');
  assert.equal(b.getLocale(), 'en');
});

test('Pocket uses the shared book-first language rule, including regional fallback', () => {
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'pocket', 'www', 'pocket-bridge.js'), 'utf8');
  const ctx = vm.createContext({ writingLanguage: () => 'fr-CA', lib: () => ({ spellLanguage: 'en-US' }), window: { neo: { i18n: { locale: 'en' } } } });
  vm.runInContext(bridge.slice(bridge.indexOf('function wantedLanguage('), bridge.indexOf('function spellEngine(')), ctx);
  assert.equal(ctx.wantedLanguage({ fr: {}, 'en-US': {} }), 'fr');
  ctx.writingLanguage = () => 'pt';
  assert.equal(ctx.wantedLanguage({ 'pt-BR': {}, 'en-US': {} }), 'pt-BR');
  ctx.writingLanguage = () => 'de';
  assert.equal(ctx.wantedLanguage({ de: {}, 'en-US': {} }), 'de');
});
