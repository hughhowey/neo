// NEO — citations and the reference list, set in a citation style
//
// citeproc-js (the processor inside Zotero and Mendeley) does the setting,
// from a CSL style: the eight below ship with NEO, and any journal's .csl
// file from the Zotero Style Repository can be added to a paper. This file
// is the seam between NEO's citations and citeproc: it hands over every
// citation in reading order (so numbers, "et al." and 2020a/2020b come out
// right) and gives back each citation's text and the reference list.
// window.NeoCite in the editor; require()d by the tests.

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports && !root.document) module.exports = api;
  else root.NeoCite = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  // the styles NEO carries, in the order the Format menu lists them
  const STYLES = [
    { id: 'apa', title: 'APA 7th', file: 'apa.csl', numeric: false },
    { id: 'chicago-author-date', title: 'Chicago (author-date)', file: 'chicago-author-date.csl', numeric: false },
    { id: 'harvard-cite-them-right', title: 'Harvard', file: 'harvard-cite-them-right.csl', numeric: false },
    { id: 'modern-language-association', title: 'MLA 9th', file: 'modern-language-association.csl', numeric: false },
    { id: 'ieee', title: 'IEEE', file: 'ieee.csl', numeric: true },
    { id: 'elsevier-vancouver', title: 'Vancouver', file: 'elsevier-vancouver.csl', numeric: true },
    { id: 'nature', title: 'Nature', file: 'nature.csl', numeric: true },
    { id: 'american-medical-association', title: 'AMA', file: 'american-medical-association.csl', numeric: true },
    // a journal's own, chosen with the journal (Format → Journal)
    { id: 'science', title: 'Science', file: 'science.csl', numeric: true, journal: true },
    { id: 'pnas', title: 'PNAS', file: 'pnas.csl', numeric: true, journal: true },
    { id: 'cell', title: 'Cell Press', file: 'cell.csl', numeric: true, journal: true },
    { id: 'plos', title: 'PLOS', file: 'plos.csl', numeric: true, journal: true },
    { id: 'elife', title: 'eLife', file: 'elife.csl', numeric: false, journal: true },
    { id: 'association-for-computing-machinery', title: 'ACM', file: 'association-for-computing-machinery.csl', numeric: true, journal: true },
    { id: 'springer-lecture-notes-in-computer-science', title: 'Springer LNCS', file: 'springer-lecture-notes-in-computer-science.csl', numeric: true, journal: true },
    { id: 'elsevier-harvard', title: 'Elsevier (Harvard)', file: 'elsevier-harvard.csl', numeric: false, journal: true },
    { id: 'american-physics-society', title: 'APS', file: 'american-physics-society.csl', numeric: true, journal: true }
  ];
  const DEFAULT_STYLE = 'apa';

  const CSL = () => root.CSL || (typeof require === 'function' ? require('citeproc') : null);

  // A style's own name and whether it numbers its citations, read from the XML
  function describeStyle(xml) {
    const title = (/<title>([^<]*)<\/title>/.exec(xml) || [])[1] || 'Custom style';
    const format = (/citation-format="([^"]+)"/.exec(xml) || [])[1] || 'author-date';
    const locale = (/default-locale="([^"]+)"/.exec(xml) || [])[1] || '';
    return { title: title.replace(/&amp;/g, '&'), numeric: format === 'numeric', note: format === 'note', locale };
  }

  // markup gone, entities read (citeproc writes &#38; &#60; and friends)
  const plain = (html) => String(html).replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&#x([\da-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, '\u00a0').replace(/&amp;/g, '&');

  // processor({ style, locales, items }) — style is CSL XML; locales maps
  // 'en-US' (and others a style asks for) to locale XML; items are CSL JSON.
  function processor({ style, locales, items, lang = 'en-US' }) {
    const Engine = CSL().Engine;
    let byId = new Map(items.map((it) => [it.id, it]));
    const sys = {
      retrieveLocale: (code) => locales[code] || locales[String(code).slice(0, 2) === 'en' ? 'en-US' : code] || locales['en-US'],
      retrieveItem: (id) => byId.get(id)
    };
    const info = describeStyle(style);
    const engine = new Engine(sys, style, info.locale || lang);
    engine.opt.development_extensions.wrap_url_and_doi = true;

    // clusters: [{ id, items: [{ id, locator, label, prefix, suffix }], narrative }]
    // in reading order. Unknown ids are left out of what citeproc sees and
    // reported back, so a citation of a deleted reference shows as missing.
    function render(clusters) {
      const missing = new Set();
      const known = (c) => c.items.filter((x) => { if (byId.has(x.id)) return true; missing.add(x.id); return false; });
      const order = [];
      for (const c of clusters) for (const x of known(c)) if (!order.includes(x.id)) order.push(x.id);
      engine.updateItems(order);
      const citations = [];
      const live = clusters.filter((c) => known(c).length);
      live.forEach((c, n) => {
        citations.push({
          citationID: 'c' + n,
          citationItems: known(c).map((x) => citeItem(x)),
          properties: { noteIndex: 0 }
        });
      });
      const text = new Map();
      if (citations.length) {
        const out = engine.rebuildProcessorState(citations, 'html');
        for (const [cid, , html] of out) text.set(live[+cid.slice(1)].id, html);
      }
      // a narrative citation is "Smith et al. (2020)" or "Smith et al. [3]":
      // the names, then the citation with the names left out
      for (const c of live) {
        if (!c.narrative) continue;
        const parts = known(c).map((x) => {
          const names = engine.makeCitationCluster([{ id: x.id, 'author-only': true }]);
          const rest = engine.makeCitationCluster([{ ...citeItem(x), 'suppress-author': true }]);
          const who = (/NO_PRINTED_FORM/.test(names) ? '' : plain(names).trim()) || authorsOf(byId.get(x.id));
          return who && who !== plain(rest).trim() ? `${escHtml(who)} ${rest}` : rest;
        });
        text.set(c.id, parts.join('; '));
      }
      return { text, missing: [...missing], order };
    }

    function bibliography() {
      const out = engine.makeBibliography();
      if (!out) return { entries: [], hanging: false, numeric: info.numeric };
      const [params, entries] = out;
      return {
        entries: entries.map((html, n) => ({ id: params.entry_ids[n][0], html: html.trim() })),
        hanging: !!params.hangingindent,
        numeric: info.numeric || params['second-field-align'] === 'flush',
        lineSpacing: params.linespacing || 1
      };
    }

    // a changed library, without building the style again
    function setItems(next) { byId = new Map(next.map((it) => [it.id, it])); engine.updateItems([]); }

    return { render, bibliography, setItems, info };
  }

  function citeItem(x) {
    const it = { id: x.id };
    if (x.locator) { it.locator = x.locator; it.label = x.label || 'page'; }
    if (x.prefix) it.prefix = x.prefix + ' ';
    if (x.suffix) it.suffix = ', ' + x.suffix;
    return it;
  }
  function authorsOf(it) {
    const names = ((it && (it.author || it.editor)) || []).map((a) => a.family || a.literal || '');
    if (!names.length) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' and ' + names[1];
    return names[0] + ' et al.';
  }
  const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // "p. 4", "pp. 4–6", "chap. 3", "sec. 2": what a locator typed by hand
  // means. Returns { label, locator }. A label is a whole word, cut short
  // or not, then a full stop, a space or the number itself: "para 3" is a
  // paragraph and "suppl. 2" a supplement, not page "ara 3" or section
  // "uppl. 2". Each label's own name is here too, as the citation pane
  // shows it ("paragraph 3"), so what it shows reads back the same.
  const LABELS = [
    ['page', 'pages|page|pp|p'], ['chapter', 'chapters|chapter|chaps|chap|chs|ch'],
    ['section', 'sections|section|sects|sect|secs|sec|§§|§|s'], ['figure', 'figures|figure|figs|fig'],
    ['table', 'tables|table|tabs|tab|tbl'], ['equation', 'equations|equation|eqns|eqn|eqs|eq'],
    ['supplement', 'supplement|suppl|supp'], ['paragraph', 'paragraphs|paragraph|paras|para|¶¶|¶'],
    ['line', 'lines|line|ll|l'], ['note', 'notes|note|nn|n'], ['column', 'columns|column|cols|col'],
    ['part', 'parts|part|pts|pt'], ['volume', 'volumes|volume|vols|vol']
  ].map(([label, words]) => [label, new RegExp('^(?:' + words + ')(?:\\.\\s*|\\s+|(?=\\d))', 'i')]);
  function parseLocator(s) {
    const text = String(s || '').trim();
    if (!text) return { label: '', locator: '' };
    for (const [label, re] of LABELS) if (re.test(text)) return { label, locator: text.replace(re, '').replace(/-/g, '–') };
    return { label: 'page', locator: text.replace(/-/g, '–') };
  }

  return { STYLES, DEFAULT_STYLE, processor, describeStyle, parseLocator, plain };
});
