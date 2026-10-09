'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const R = require('../paper/references.js');

const BIB = String.raw`
@string{jn = "Journal of Neuroscience"}
@comment{exported by hand}
@article{smith2020,
  author = {Smith, Jane and van der Berg, Piet and Ng, Ann},
  title = {Neural {DNA} dynamics of inhibition in \textit{Drosophila}},
  journal = jn,
  year = 2020, month = mar,
  volume = {40}, number = {3}, pages = {100--120},
  doi = {https://doi.org/10.1234/JN.2020.1}
}
@book{doe2019,
  author = "John Doe",
  title = "Brains \& Minds",
  publisher = {MIT Press}, address = {Cambridge, MA},
  year = {2019}
}
@inproceedings{li2021,
  author = {Li, Wei and {World Health Organization}},
  title = {G{\"o}del's {\'E}cole},
  booktitle = {Proceedings of NeurIPS},
  year = {2021}
}
@misc{vaswani2017,
  author = {Ashish Vaswani and Noam Shazeer},
  title = {Attention Is All You Need},
  eprint = {1706.03762}, archivePrefix = {arXiv},
  year = {2017}
}
@phdthesis{curie1903, author = {Curie, Marie}, title = {Radioactive substances}, school = {Sorbonne}, year = {1903}}
`;

test('BibTeX: names, macros, months, pages, DOIs and LaTeX accents become CSL JSON', () => {
  const { items, errors } = R.parseBibtex(BIB);
  assert.deepEqual(errors, []);
  assert.equal(items.length, 5);
  const [smith, doe, li, vaswani, curie] = items;
  assert.equal(smith.id, 'smith2020');
  assert.equal(smith.type, 'article-journal');
  assert.deepEqual(smith.author[1], { family: 'Berg', given: 'Piet', 'non-dropping-particle': 'van der' });
  assert.equal(smith.title, 'Neural DNA dynamics of inhibition in Drosophila');
  assert.equal(smith['container-title'], 'Journal of Neuroscience');
  assert.deepEqual(smith.issued, { 'date-parts': [[2020, 3]] });
  assert.equal(smith.page, '100-120');
  assert.equal(smith.DOI, '10.1234/JN.2020.1');
  assert.deepEqual(doe.author, [{ given: 'John', family: 'Doe' }]);
  assert.equal(doe.title, 'Brains & Minds');
  assert.equal(doe['publisher-place'], 'Cambridge, MA');
  assert.equal(li.type, 'paper-conference');
  assert.equal(li['container-title'], 'Proceedings of NeurIPS');
  assert.deepEqual(li.author[1], { literal: 'World Health Organization' });
  assert.equal(li.title, 'Gödel’s École'.replace('’', "'"));
  assert.equal(vaswani.type, 'article');
  assert.equal(vaswani.number, 'arXiv:1706.03762');
  assert.equal(curie.type, 'thesis');
  assert.equal(curie.publisher, 'Sorbonne');
  assert.equal(curie.genre, 'PhD thesis');
});

test('BibTeX round trip keeps keys, names and protected capitals', () => {
  const { items } = R.parseBibtex(BIB);
  const out = R.toBibtex(items);
  assert.match(out, /@article\{smith2020,/);
  assert.match(out, /author = \{Smith, Jane and van der Berg, Piet and Ng, Ann\}/);
  assert.match(out, /title = \{Neural \{DNA\} dynamics of inhibition in \{Drosophila\}\}/);
  assert.match(out, /pages = \{100--120\}/);
  assert.match(out, /title = \{Brains \\& \{Minds\}\}/);
  assert.match(out, /eprint = \{1706.03762\}/);
  const again = R.parseBibtex(out).items;
  assert.deepEqual(again.map((x) => x.id), items.map((x) => x.id));
  assert.equal(again[0].title, items[0].title);
  assert.deepEqual(again[0].author, items[0].author);
});

test('RIS from a publisher’s download button', () => {
  const ris = 'TY  - JOUR\r\nAU  - Smith, Jane\r\nAU  - Doe, John\r\nTI  - A study\r\nT2  - Nature\r\nPY  - 2021/05/04\r\nVL  - 590\r\nSP  - 10\r\nEP  - 15\r\nDO  - 10.1038/xyz\r\nER  - \r\n';
  const { items } = R.parseAny(ris);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'article-journal');
  assert.equal(items[0]['container-title'], 'Nature');
  assert.equal(items[0].page, '10-15');
  assert.deepEqual(items[0].issued, { 'date-parts': [[2021, 5, 4]] });
  assert.equal(R.sniff(ris), 'ris');
  assert.equal(R.sniff('[{"id":"a","type":"book"}]'), 'csl');
  assert.equal(R.sniff('@article{x, title={y}}'), 'bibtex');
  assert.equal(R.sniff('just some words'), null);
});

test('DOIs and arXiv IDs are found in whatever was pasted', () => {
  assert.deepEqual(R.findIdentifier('https://doi.org/10.1038/s41586-020-2649-2'), { type: 'doi', id: '10.1038/s41586-020-2649-2' });
  assert.deepEqual(R.findIdentifier('doi: 10.1000/xyz123.'), { type: 'doi', id: '10.1000/xyz123' });
  assert.deepEqual(R.findIdentifier('2101.00001'), { type: 'arxiv', id: '2101.00001' });
  assert.deepEqual(R.findIdentifier('https://arxiv.org/abs/1706.03762v5'), { type: 'arxiv', id: '1706.03762' });
  assert.equal(R.findIdentifier('smith 2020'), null);
  assert.equal(R.findIdentifier('version 2101.00001 of the code'), null, 'a bare number in prose is not an arXiv ID');
  assert.equal(R.identifierDoi({ type: 'arxiv', id: '1706.03762' }), '10.48550/arXiv.1706.03762');
});

test('keys are made the Better BibTeX way and never collide; merging keeps existing keys', () => {
  const item = { type: 'article-journal', title: 'The Neural Basis of Thought', author: [{ family: 'Müller', given: 'A' }], issued: { 'date-parts': [[2018]] } };
  assert.equal(R.makeKey(item), 'muller2018neural');
  assert.equal(R.makeKey(item, new Set(['muller2018neural'])), 'muller2018neurala');
  const lib = [{ id: 'old', ...item, DOI: '10.1/abc' }];
  const { items, added, updated } = R.mergeReferences(lib, [
    { id: 'whatever', type: 'article-journal', title: 'Changed title', DOI: '10.1/ABC' },
    { type: 'book', title: 'New', author: [{ family: 'Lee' }], issued: { 'date-parts': [[2001]] } },
    { id: 'has space', type: 'book', title: 'Other', author: [{ family: 'Lee' }], issued: { 'date-parts': [[2001]] } }
  ]);
  assert.deepEqual(updated, ['old']);
  assert.equal(items[0].id, 'old');
  assert.equal(items[0].title, 'Changed title');
  assert.deepEqual(added, ['lee2001new', 'lee2001other']);
});

test('the @ picker ranks by first author, then other names, year and title words', () => {
  const lib = R.parseBibtex(BIB).items;
  const rank = (q) => lib.map((it) => [it.id, R.score(it, q)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  assert.deepEqual(rank('smith'), ['smith2020']);
  assert.equal(rank('doe')[0], 'doe2019');
  assert.deepEqual(rank('2017'), ['vaswani2017']);
  assert.deepEqual(rank('attention'), ['vaswani2017']);
  assert.deepEqual(rank('smith 2019'), []);
  assert.equal(rank('').length, 5);
  assert.equal(R.shortLabel(lib[0]), 'Smith et al. 2020');
  assert.equal(R.shortLabel(lib[3]), 'Vaswani & Shazeer 2017');
});

test('a CSL JSON id that is a number, or not a usable key, becomes a key', () => {
  const { items } = R.mergeReferences([], [
    { id: 1, type: 'book', title: 'One', author: [{ family: 'Ng' }], issued: { 'date-parts': [[2001]] } },
    { id: '<img src=x>', type: 'book', title: 'Two', author: [{ family: 'Ng' }], issued: { 'date-parts': [[2002]] } }
  ]);
  assert.deepEqual(items.map((x) => x.id), ['1', 'ng2002two']);
  assert.ok(R.KEY.test('smith2020') && !R.KEY.test('a&b') && !R.KEY.test('x y'));
});

test('a linked file read again as it was updates nothing; only a real change counts', () => {
  const lib = [{ id: 'old', type: 'book', title: 'Brains', author: [{ family: 'Doe', given: 'J' }], issued: { 'date-parts': [[2001]] } }];
  // the same reference, its fields in another order, as a reference manager might write it
  const again = { issued: { 'date-parts': [[2001]] }, author: [{ given: 'J', family: 'Doe' }], title: 'Brains', type: 'book', id: 'old' };
  const same = R.mergeReferences(lib, [again], { keepKeys: true });
  assert.deepEqual(same.updated, []);
  assert.deepEqual(same.added, []);
  assert.deepEqual(same.keys, ['old'], 'the key of what was matched is still given');
  assert.deepEqual(same.items, lib);
  const changed = R.mergeReferences(lib, [{ ...again, title: 'Brains, Revised' }], { keepKeys: true });
  assert.deepEqual(changed.updated, ['old']);
  assert.equal(changed.items[0].title, 'Brains, Revised');
  const byWork = R.mergeReferences(lib, [{ type: 'book', title: 'Brains', issued: { 'date-parts': [[2001]] } }]);
  assert.deepEqual([byWork.updated, byWork.keys], [[], ['old']], 'nothing new in it, matched by title and year');
  const fresh = R.mergeReferences(lib, [{ type: 'book', title: 'New', author: [{ family: 'Lee' }], issued: { 'date-parts': [[2001]] } }]);
  assert.deepEqual([fresh.added, fresh.keys], [['lee2001new'], ['lee2001new']]);
});

test('saving keeps what another device added since, and not what was deleted here', () => {
  const ref = (id) => ({ id, type: 'book', title: 'Title ' + id, issued: { 'date-parts': [[2000]] } });
  const saved = [ref('a'), ref('b'), ref('c')];
  const mine = [ref('a'), ref('c'), ref('d')]; // b deleted here, d added here
  const disk = [ref('a'), ref('b'), ref('c'), ref('e')]; // e added over there
  assert.deepEqual(R.keepTheirs(saved, mine, disk).map((r) => r.id), ['a', 'c', 'd', 'e']);
  assert.equal(R.keepTheirs(saved, mine, saved), mine, 'nothing new there: the list as it was');
  assert.equal(R.keepTheirs(saved, mine, null), mine, 'a file that did not read as a list changes nothing');
  assert.deepEqual(R.keepTheirs([], [], [ref(7), null]).map((r) => r.id), ['7']);
  // the same work under another key there joins the one here, keeping this key
  const there = { ...ref('x'), title: 'Title a' };
  assert.deepEqual(R.keepTheirs(saved, mine, [...disk, there]).map((r) => r.id), ['a', 'c', 'd', 'e']);
});
