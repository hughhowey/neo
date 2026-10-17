'use strict';

// Smart quotes as you type: which mark a typed " or ' becomes, in each
// language's style. The rules from app.js run on their own, and a paragraph
// is typed one key at a time the way the editor does it: the text before
// the caret, the book's marks (bookQuotes) and the quotations still open in
// the paragraph (quoteIsOpen) decide each quote.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const between = (from, to) => app.slice(app.indexOf(from), app.indexOf(to));
const context = vm.createContext({ library: null, book: null, chapterHTML: {}, NeoI18n: { getLocale: () => 'en' } });
vm.runInContext(between('function quoteOpenIn(', '// A hyphen standing on its own'), context);
vm.runInContext('this.api = { typedQuote, quoteOpenIn, bookQuotes, singleQuotes };', context);
const { typedQuote, quoteOpenIn, bookQuotes, singleQuotes } = context.api;

// Type keys into an empty paragraph, writing in lang. chapter: text already in
// the chapter, which tells bookQuotes the marks the book is set in.
function type(lang, keys, chapter = '') {
  context.library = { spellLanguage: lang };
  let text = '';
  for (const key of keys) {
    if (key !== '"' && key !== "'") { text += key; continue; }
    const body = { closest: () => ({ textContent: chapter + ' ' + text }) };
    const isOpen = (q, straight) => quoteOpenIn(text, q, straight);
    text += typedQuote(key, text.slice(-8), key === '"' ? bookQuotes(body) : null, key === "'" ? singleQuotes(body) : null, isOpen);
  }
  return text;
}

const NNBSP = ' ';

// [language, chapter text (the book's marks), keys typed, what the page shows]
const styles = [
  // German novels »…« with ›…‹ inside (#410)
  ['de', '', `"Er sagte 'Hallo.'"`, '»Er sagte ›Hallo.‹«'],
  ['de', '', `"Er sagte 'Hallo'"`, '»Er sagte ›Hallo‹«'],
  ['de', '', `"Er sagte 'Hallo!' und ging."`, '»Er sagte ›Hallo!‹ und ging.«'],
  ['de', '', `"'Hallo', sagte er."`, '»›Hallo‹, sagte er.«'],
  ['de', '', `"'Hallo.'"`, '»›Hallo.‹«'],
  // German „…“ with ‚…‘ inside: a book already set that way keeps it
  ['de', '„Ja“, sagte sie.', `"Er sagte 'Hallo.'"`, '„Er sagte ‚Hallo.‘“'],
  ['de', '„Ja“, sagte sie.', `"'Hallo.'"`, '„‚Hallo.‘“'],
  // Swiss «…» with ‹…› inside
  ['de-CH', '', `"Er sagte 'Hallo.'"`, '«Er sagte ‹Hallo.›»'],
  ['de-CH', '', `"'Hallo.'"`, '«‹Hallo.›»'],
  // a German book set in «…» outside Switzerland
  ['de', '«Ja», sagte sie.', `"Er sagte 'Hallo.'"`, '«Er sagte ‹Hallo.›»'],
  // English, Dutch, Brazilian Portuguese, Korean: “…” with ‘…’ inside
  ['en', '', `"He said 'hello.'"`, '“He said ‘hello.’”'],
  ['en', '', `"'Hello.'"`, '“‘Hello.’”'],
  ['nl', '', `"Hij zei 'hallo.'"`, '“Hij zei ‘hallo.’”'],
  ['pt', '', `"Ele disse 'olá.'"`, '“Ele disse ‘olá.’”'],
  ['ko', '', `"그가 '안녕'"`, '“그가 ‘안녕’”'],
  // French: «  » spaced, the same marks inside
  ['fr', '', `"Il a dit "non""`, `«${NNBSP}Il a dit «${NNBSP}non${NNBSP}»${NNBSP}»`],
  ['fr', '', `"Il a dit "non." Puis rien."`, `«${NNBSP}Il a dit «${NNBSP}non.${NNBSP}» Puis rien.${NNBSP}»`],
  // «…» languages, the inner marks typed by hand: “…”, „…“ (Russian), ‹…›
  ['es', '', `"Dijo “hola”"`, '«Dijo “hola”»'],
  ['it', '', `"Disse “ciao”"`, '«Disse “ciao”»'],
  ['pt-PT', '', `"Ele disse “olá”"`, '«Ele disse “olá”»'],
  ['ru', '', `"Он сказал „привет“"`, '«Он сказал „привет“»'],
  ['el', '', `"Είπε ‹γεια›"`, '«Είπε ‹γεια›»'],
  // „…” languages, «…» or »…« inside, typed by hand
  ['pl', '', `"Powiedział «cześć»"`, '„Powiedział «cześć»”'],
  ['ro', '', `"A spus «salut»"`, '„A spus «salut»”'],
  ['hu', '', `"Azt mondta »szia«"`, '„Azt mondta »szia«”'],
  // Swedish ”…”, and a Swedish book in »…»
  ['sv', '', `"Han sa 'hej'"`, '”Han sa ’hej’”'],
  ['sv', '»Ja» sa hon.', `"Han sa ›hej›"`, '»Han sa ›hej›»']
];

describe('smart quotes: an inner quotation closing right before the outer one (#410)', () => {
  for (const [lang, chapter, keys, want] of styles) {
    test(`${lang}${chapter ? ` (book in ${chapter[0]}…)` : ''}: ${want}`, () => {
      assert.equal(type(lang, keys, chapter), want);
    });
  }
});

describe('smart quotes: what already worked stays', () => {
  const cases = [
    // apostrophes inside and at the end of words
    ['en', '', `"It's late," she said.`, '“It’s late,” she said.'],
    ['en', '', `"Goin' home."`, '“Goin’ home.”'],
    ['de', '', `"Wie geht's?"`, '»Wie geht’s?«'],
    ['de', '', `"Geht's dir gut?", fragte er.`, '»Geht’s dir gut?«, fragte er.'],
    ['de', '„Ja“, sagte sie.', `"So geht's."`, '„So geht’s.“'],
    ['fr', '', `L'homme a dit "oui".`, `L’homme a dit «${NNBSP}oui${NNBSP}».`],
    ['es', '', `"Dijo 'hola'"`, '«Dijo ’hola’»'],
    // speech cut off by a dash closes; after a dash with nothing open, a quote opens
    ['en', '', `"I was just—"`, '“I was just—”'],
    ['en', '', `He stopped—"Wait."`, 'He stopped—“Wait.”'],
    ['de', '', `—"'Halt!' rief er."`, '—»›Halt!‹ rief er.«'],
    // after a bracket, at the start, after a space
    ['en', '', `("Yes")`, '(“Yes”)'],
    ['de', '', `"Ja" und "Nein"`, '»Ja« und »Nein«'],
    // two quotations side by side
    ['en', '', `"One." "Two."`, '“One.” “Two.”']
  ];
  for (const [lang, chapter, keys, want] of cases) {
    test(`${lang}: ${want}`, () => {
      assert.equal(type(lang, keys, chapter), want);
    });
  }
});
