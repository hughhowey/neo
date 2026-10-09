'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const Cite = require('../paper/cite.js');

const dir = path.join(__dirname, '..', 'paper', 'csl');
const style = (id) => fs.readFileSync(path.join(dir, id + '.csl'), 'utf8');
const locales = { 'en-US': fs.readFileSync(path.join(dir, 'locales-en-US.xml'), 'utf8'), 'en-GB': fs.readFileSync(path.join(dir, 'locales-en-GB.xml'), 'utf8') };
const items = [
  { id: 'smith2020a', type: 'article-journal', title: 'First', author: [{ family: 'Smith', given: 'Jane' }], 'container-title': 'J. Neuro', issued: { 'date-parts': [[2020]] } },
  { id: 'smith2020b', type: 'article-journal', title: 'Second', author: [{ family: 'Smith', given: 'Jane' }], 'container-title': 'J. Neuro', issued: { 'date-parts': [[2020]] } },
  { id: 'doe2019', type: 'book', title: 'Brains', author: [{ family: 'Doe', given: 'John' }, { family: 'Roe', given: 'Rick' }, { family: 'Poe', given: 'Pia' }], publisher: 'MIT Press', issued: { 'date-parts': [[2019]] } }
];

test('every style NEO ships loads and sets a citation and a reference list', () => {
  for (const s of Cite.STYLES) {
    const p = Cite.processor({ style: style(s.id), locales, items });
    const { text } = p.render([{ id: 'x', items: [{ id: 'doe2019' }] }]);
    assert.ok(Cite.plain(text.get('x')).length > 0, s.id);
    assert.equal(p.bibliography().entries.length, 1, s.id);
    assert.equal(p.info.numeric, s.numeric, s.id);
  }
});

test('APA: two works by the same author in a year become 2020a and 2020b; a page locator', () => {
  const p = Cite.processor({ style: style('apa'), locales, items });
  const { text } = p.render([
    { id: 'c1', items: [{ id: 'smith2020a', locator: '4', label: 'page' }] },
    { id: 'c2', items: [{ id: 'smith2020b' }, { id: 'doe2019' }] }
  ]);
  assert.equal(Cite.plain(text.get('c1')), '(Smith, 2020a, p. 4)');
  assert.equal(Cite.plain(text.get('c2')), '(Doe et al., 2019; Smith, 2020b)');
  const bib = p.bibliography();
  assert.deepEqual(bib.entries.map((e) => e.id), ['doe2019', 'smith2020a', 'smith2020b']);
  assert.ok(bib.hanging);
});

test('numeric styles number by first appearance and narrative citations name the authors', () => {
  const p = Cite.processor({ style: style('ieee'), locales, items });
  const { text } = p.render([
    { id: 'c1', items: [{ id: 'doe2019' }] },
    { id: 'c2', items: [{ id: 'smith2020a' }], narrative: true },
    { id: 'c3', items: [{ id: 'doe2019' }] }
  ]);
  assert.equal(Cite.plain(text.get('c1')), '[1]');
  assert.equal(Cite.plain(text.get('c2')), 'Smith [2]');
  assert.equal(Cite.plain(text.get('c3')), '[1]');
  assert.deepEqual(p.bibliography().entries.map((e) => e.id), ['doe2019', 'smith2020a']);
  const apa = Cite.processor({ style: style('apa'), locales, items });
  assert.equal(Cite.plain(apa.render([{ id: 'n', items: [{ id: 'doe2019' }], narrative: true }]).text.get('n')), 'Doe et al. (2019)');
});

test('a citation of a reference no longer in the library is reported, not thrown', () => {
  const p = Cite.processor({ style: style('apa'), locales, items });
  const { text, missing } = p.render([{ id: 'c1', items: [{ id: 'gone' }] }, { id: 'c2', items: [{ id: 'doe2019' }, { id: 'gone' }] }]);
  assert.deepEqual(missing, ['gone']);
  assert.equal(text.has('c1'), false);
  assert.equal(Cite.plain(text.get('c2')), '(Doe et al., 2019)');
});

test('locators typed by hand', () => {
  assert.deepEqual(Cite.parseLocator('p. 4'), { label: 'page', locator: '4' });
  assert.deepEqual(Cite.parseLocator('pp. 4-6'), { label: 'page', locator: '4–6' });
  assert.deepEqual(Cite.parseLocator('chap. 3'), { label: 'chapter', locator: '3' });
  assert.deepEqual(Cite.parseLocator('12'), { label: 'page', locator: '12' });
  assert.deepEqual(Cite.parseLocator(''), { label: '', locator: '' });
  const reads = (s) => { const { label, locator } = Cite.parseLocator(s); return label + ' ' + locator; };
  assert.equal(reads('pp. 3–5'), 'page 3–5');
  assert.equal(reads('p4'), 'page 4');
  assert.equal(reads('page 7'), 'page 7');
  assert.equal(reads('chap. 2'), 'chapter 2');
  assert.equal(reads('ch 2'), 'chapter 2');
  assert.equal(reads('sec. 3'), 'section 3');
  assert.equal(reads('§ 3'), 'section 3');
  assert.equal(reads('§3.2'), 'section 3.2');
  assert.equal(reads('s. 4'), 'section 4');
  assert.equal(reads('fig. 2'), 'figure 2');
  assert.equal(reads('Fig. 2b'), 'figure 2b');
  assert.equal(reads('l. 10'), 'line 10');
  assert.equal(reads('ll. 10-12'), 'line 10–12');
  assert.equal(reads('n. 3'), 'note 3');
  assert.equal(reads('vol. 2'), 'volume 2');
  assert.equal(reads('tab. 1'), 'table 1');
  assert.equal(reads('eq. 4'), 'equation 4');
  // a short label is a whole word, never the first letter of a longer one
  assert.equal(reads('para 3'), 'paragraph 3');
  assert.equal(reads('para. 3'), 'paragraph 3');
  assert.equal(reads('paragraph 3'), 'paragraph 3');
  assert.equal(reads('¶ 3'), 'paragraph 3');
  assert.equal(reads('suppl. 2'), 'supplement 2');
  assert.equal(reads('supplement S4'), 'supplement S4');
  assert.equal(reads('lemma 2'), 'page lemma 2');
  assert.equal(reads('note 5'), 'note 5');
  assert.equal(reads('pt. 2'), 'part 2');
  // what the citation pane shows ("label locator") reads back the same
  for (const label of ['chapter', 'section', 'figure', 'table', 'equation', 'supplement', 'paragraph', 'line', 'note', 'column', 'part', 'volume']) {
    assert.equal(reads(label + ' 9'), label + ' 9', label);
  }
  assert.equal(Cite.describeStyle(style('nature')).numeric, true);
  assert.equal(Cite.describeStyle(style('apa')).title, 'APA Style 7th edition');
});

test('an edited reference is set afresh after setItems', () => {
  const p = Cite.processor({ style: style('apa'), locales, items });
  assert.equal(Cite.plain(p.render([{ id: 'a', items: [{ id: 'doe2019' }] }]).text.get('a')), '(Doe et al., 2019)');
  p.setItems(items.map((it) => (it.id === 'doe2019' ? { ...it, issued: { 'date-parts': [[2001]] } } : it)));
  assert.equal(Cite.plain(p.render([{ id: 'a', items: [{ id: 'doe2019' }] }]).text.get('a')), '(Doe et al., 2001)');
});
