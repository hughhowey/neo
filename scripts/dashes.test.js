'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// the dialogue-dash rules from app.js, run on their own
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(app.slice(app.indexOf('const DIALOGUE_DASHES'), app.indexOf('function dashStyle(')), context);
vm.runInContext('this.api = { DIALOGUE_DASHES, dialogueDashes, dialogueDashEdits, dashRuns };', context);
const { DIALOGUE_DASHES, dialogueDashes, dialogueDashEdits, dashRuns } = context.api;

// …and the count that decides which way a quote typed after a dash faces
const quotes = vm.createContext({});
vm.runInContext(app.slice(app.indexOf('function quoteOpenIn('), app.indexOf('// The quotation marks of the language being written')), quotes);
vm.runInContext('this.api = { quoteOpenIn };', quotes);
const { quoteOpenIn } = quotes.api;

const pt = DIALOGUE_DASHES.pt;
const es = DIALOGUE_DASHES.es;
const en = DIALOGUE_DASHES.en;

test('speech opens with the language\'s dash', () => {
  assert.equal(dialogueDashes('- Capitão! Planeta à vista.', pt), '— Capitão! Planeta à vista.');
  assert.equal(dialogueDashes('-Capitão!', pt), '— Capitão!');
  assert.equal(dialogueDashes('- Привет', DIALOGUE_DASHES.ru), '— Привет');
  assert.equal(dialogueDashes('- Hola', es), '—Hola');
  assert.equal(dialogueDashes('-¿Qué?', es), '—¿Qué?');
  // elsewhere the spacing stays as typed
  assert.equal(dialogueDashes('- Hello', en), '— Hello');
  assert.equal(dialogueDashes('-Hello', en), '—Hello');
});

test('a spaced hyphen mid-sentence becomes a dash, spaces as typed', () => {
  assert.equal(dialogueDashes('- Entendido - diz Gini.', pt), '— Entendido — diz Gini.');
  assert.equal(dialogueDashes('- Hola - dijo él.', es), '—Hola — dijo él.');
  assert.equal(dialogueDashes('It was late - too late.', en), 'It was late – too late.');
});

test('a hyphen cut off at the end of speech becomes a dash', () => {
  assert.equal(dialogueDashes('- Espere -', pt), '— Espere —');
  assert.equal(dialogueDashes('"I was just -"', en), '"I was just –"');
  assert.equal(dialogueDashes('“I was just -” she said.', en), '“I was just –” she said.');
  assert.equal(dialogueDashes('Mas eu -, disse ele.', pt), 'Mas eu —, disse ele.');
});

test('hyphens that belong to words stay hyphens', () => {
  for (const s of [
    'Levou o guarda-chuva.',
    'Enoch-17 respondeu.',
    'Pôr-se-ia a caminho.',
    'O pré- e o pós-operatório.',
    'Faz -5 °C lá fora.',
    'O sufixo -mente é comum.',
    '-5 graus, disse o rádio.',
    'Pre- and post-war Europe.',
    'Wait--what?'
  ]) assert.equal(dialogueDashes(s, pt), s, s);
});

test('scene breaks and bare dashes are left alone', () => {
  for (const s of ['-', '- - -', '---', '* * *', '-  -']) assert.equal(dialogueDashes(s, pt), s, s);
});

test('a fragment only knows the edges it has', () => {
  // pasted mid-paragraph: no opening, no end
  assert.equal(dialogueDashes('- olá', pt, { start: false }), '- olá');
  assert.equal(dialogueDashes('espere -', pt, { end: false }), 'espere -');
  // …after a space already on the page
  assert.equal(dialogueDashes('- sim - e saiu', pt, { start: false, spaced: true }), '— sim — e saiu');
  // what was typed so far, and the key that follows
  assert.deepEqual(plain(dialogueDashEdits(' - ', pt, { start: false, end: false })), [{ at: 1, from: '-', to: '—' }]);
  assert.deepEqual(plain(dialogueDashEdits(' -', en, { start: false })), [{ at: 1, from: '-', to: '–' }]);
  assert.deepEqual(plain(dialogueDashEdits(' -"', en, { start: false, end: false })), [{ at: 1, from: '-', to: '–' }]);
  assert.deepEqual(plain(dialogueDashEdits(' -m', pt, { start: false, end: false })), []);
  assert.deepEqual(plain(dialogueDashEdits('- ', pt, { end: false })), []);
  assert.deepEqual(plain(dialogueDashEdits('- O', pt, { end: false })), [{ at: 0, from: '- ', to: '— ' }]);
  assert.deepEqual(plain(dialogueDashEdits('-O', pt, { end: false })), [{ at: 0, from: '-', to: '— ' }]);
  assert.deepEqual(plain(dialogueDashEdits('-5', pt, { end: false })), []);
});

test('pasted bold and italic keep their runs', () => {
  const runs = [{ text: '- ' }, { text: 'Não', i: true }, { mark: 'x' }, { text: ' - disse ela -' }];
  dashRuns(runs, pt, { start: true, end: true });
  assert.deepEqual(runs.map((r) => r.text), ['— ', 'Não', undefined, ' — disse ela —']);
  assert.equal(runs[1].i, true);
});

test('a quote after a dash closes speech that is open, and opens one that is not', () => {
  const en = { open: '“', close: '”' };
  const de = { open: '„', close: '“' };
  const single = { open: '‘', close: '’' };
  // open: the next quote closes it
  assert.equal(quoteOpenIn('“I was just—', en), true);
  assert.equal(quoteOpenIn('He said, “I was just—', en), true);
  assert.equal(quoteOpenIn('“Wait—” he said. “And then—', en), true);
  assert.equal(quoteOpenIn('„Ich war—', de), true);
  assert.equal(quoteOpenIn('‘I wasn’t going to—', single), true);
  // not open: the next quote opens one
  assert.equal(quoteOpenIn('He stopped—', en), false);
  assert.equal(quoteOpenIn('“Hello,” she said—', en), false);
  assert.equal(quoteOpenIn('“Wait—” he said—', en), false);
  assert.equal(quoteOpenIn('She wasn’t sure—', single), false);
});

test('straight quotes pair up in turn, beside curly ones or alone', () => {
  const en = { open: '“', close: '”' };
  // imported or pasted from a plain-text editor
  assert.equal(quoteOpenIn('"I was just—', en, '"'), true);
  assert.equal(quoteOpenIn('He said, "I was just—', en, '"'), true);
  assert.equal(quoteOpenIn('"Wait—" he said. "And then—', en, '"'), true);
  assert.equal(quoteOpenIn('"Wait—" he said—', en, '"'), false);
  assert.equal(quoteOpenIn('"Hello," she said. “I was just—', en, '"'), true);
  assert.equal(quoteOpenIn('“Hello,” she said, "I was just—', en, '"'), true);
  assert.equal(quoteOpenIn('"Hello," she said—', en, '"'), false);
  // a single-quote key has no straight mark to count: ' is mostly an apostrophe
  assert.equal(quoteOpenIn("He didn't know—", { open: '‘', close: '’' }), false);
});

test('Swedish quotes pair identical marks, including speech cut off by a dash', () => {
  const context = vm.createContext({ library: { spellLanguage: 'sv' }, book: null });
  vm.runInContext(app.slice(app.indexOf('const QUOTE_STYLES'), app.indexOf('// A hyphen standing on its own')), context);
  for (const code of ['sv', 'sv-SE']) {
    context.library.spellLanguage = code;
    const style = vm.runInContext('quoteStyle()', context);
    assert.deepEqual(plain(style), { open: '”', close: '”' });
    assert.equal(vm.runInContext('singleQuotes(null)', context), null);
    assert.equal(quoteOpenIn('”Jag skulle just—', style), true);
    assert.equal(quoteOpenIn('”Vänta—” sa hon. ”Och sedan—', style), true);
    assert.equal(quoteOpenIn('”Vänta—” sa hon—', style), false);
    assert.equal(quoteOpenIn('Hon stannade—', style), false);
    assert.equal(quoteOpenIn('"Jag skulle just—', style, '"'), true);
    assert.equal(quoteOpenIn('"Vänta—" sa hon—', style, '"'), false);
    assert.equal(quoteOpenIn('”Hej”, sa hon. "Jag skulle just—', style, '"'), true);
  }
  context.body = { closest: () => ({ textContent: '»Vänta—» sa hon.' }) };
  assert.deepEqual(plain(vm.runInContext('bookQuotes(body)', context)), { open: '»', close: '»' });
  assert.equal(quoteOpenIn('»Jag skulle just—', { open: '»', close: '»' }), true);
  assert.equal(quoteOpenIn('»Vänta—» sa hon—', { open: '»', close: '»' }), false);
  context.library.spellLanguage = 'de';
  assert.deepEqual(plain(vm.runInContext('bookQuotes(body)', context)), { open: '»', close: '«' });
  assert.deepEqual(plain(vm.runInContext('singleQuotes(body)', context)), { open: '›', close: '‹' });
});

// objects made in the vm context compare by value outside it
function plain(v) { return JSON.parse(JSON.stringify(v)); }
