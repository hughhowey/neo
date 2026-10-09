// NEO — how journals set a paper
//
// Each journal is a page and a set of habits: its size and margins, one
// column or two, its typefaces, how it sets the title, the abstract, the
// headings (1 Introduction, I. INTRODUCTION, or unnumbered), its captions
// (Figure 1. or Fig. 1 |), its citation style, and the LaTeX class it
// takes submissions in. NEO uses one to preview a paper as that journal
// would print it, to export the PDF, and to write the LaTeX.
//
// These are faithful approximations of each journal's published layout,
// not the journals' own templates: the LaTeX export uses the real class
// where one is on CTAN, so a submission compiles as the journal expects.
// window.NeoJournals in the editor; require()d by paper/export.js in node.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports && !root.document) module.exports = api;
  else root.NeoJournals = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SERIF = '"Times New Roman", Times, "Liberation Serif", serif';
  const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  const CM = '"Latin Modern Roman", "CMU Serif", "Computer Modern", Georgia, serif';

  // heading numbers: arabic (1, 1.1), roman (I., A., 1)), or none. limits
// are the journal's usual ones for its main article type (title in
// characters, abstract in words or characters, main text in words): a
// guide shown beside the counts, not a rule; each journal's own author
// guidelines have the last word.
  const JOURNALS = [
    {
      id: 'preprint', name: 'Preprint (arXiv)', csl: null, page: 'letter', margin: '1in', columns: 1,
      font: CM, size: '11pt', leading: 1.4, justify: true,
      title: { size: '17pt', align: 'center', font: CM, weight: 700 },
      abstract: 'indented', headings: { numbering: 'arabic', font: CM, upper: false },
      captions: { figure: 'Figure', table: 'Table', sep: '.', font: CM, size: '9.5pt' },
      keywords: 'Keywords', refs: '9.5pt',
      latex: { cls: 'article', opts: '11pt' }
    },
    {
      id: 'nature', name: 'Nature', csl: 'nature', page: 'A4', margin: '0.75in 0.7in', columns: 2, gap: '0.3in',
      font: '"Georgia", "Times New Roman", serif', size: '9pt', leading: 1.35, justify: true,
      title: { size: '22pt', align: 'left', font: SANS, weight: 700 },
      abstract: 'bold', headings: { numbering: 'none', font: SANS, upper: false },
      captions: { figure: 'Fig.', table: 'Table', sep: ' |', font: SANS, size: '7.5pt' },
      keywords: '', refs: '7.5pt', refsFont: SANS,
      latex: { cls: 'article', opts: '10pt' },
      limits: { title: 90, abstract: 200, words: 4300, note: 'Article: summary paragraph about 200 words, main text about 4,300' }
    },
    {
      id: 'science', name: 'Science', csl: 'science', page: 'letter', margin: '0.75in', columns: 2, gap: '0.25in',
      font: SERIF, size: '9.5pt', leading: 1.3, justify: true,
      title: { size: '20pt', align: 'left', font: SANS, weight: 700 },
      abstract: 'bold', headings: { numbering: 'none', font: SANS, upper: false },
      captions: { figure: 'Fig.', table: 'Table', sep: '.', font: SANS, size: '8pt' },
      keywords: '', refs: '8pt',
      latex: { cls: 'article', opts: '10pt' },
      limits: { title: 96, abstract: 125, words: 4500, note: 'Research Article: abstract up to 125 words, main text about 4,500' }
    },
    {
      id: 'pnas', name: 'PNAS', csl: 'pnas', page: 'letter', margin: '0.7in', columns: 2, gap: '0.25in',
      font: SANS, size: '8.5pt', leading: 1.3, justify: true,
      title: { size: '18pt', align: 'left', font: SANS, weight: 700 },
      abstract: 'box', headings: { numbering: 'none', font: SANS, upper: false },
      captions: { figure: 'Fig.', table: 'Table', sep: '.', font: SANS, size: '7.5pt' },
      keywords: 'Keywords', refs: '7pt',
      latex: { cls: 'article', opts: '9pt' },
      limits: { title: 135, abstract: 250, words: 4500, note: 'Research Report: abstract up to 250 words, about six pages' }
    },
    {
      id: 'cell', name: 'Cell Press (Cell, Neuron…)', csl: 'cell', page: 'letter', margin: '0.8in', columns: 2, gap: '0.3in',
      font: SANS, size: '9pt', leading: 1.4, justify: false,
      title: { size: '20pt', align: 'left', font: SANS, weight: 700 },
      abstract: 'heading', headings: { numbering: 'none', font: SANS, upper: true },
      captions: { figure: 'Figure', table: 'Table', sep: '.', font: SANS, size: '8pt' },
      keywords: 'Keywords', refs: '8pt',
      latex: { cls: 'article', opts: '10pt' },
      limits: { title: 120, abstract: 150, note: 'Article: summary up to 150 words, title under 120 characters' }
    },
    {
      id: 'plos', name: 'PLOS', csl: 'plos', page: 'letter', margin: '1in 1in 1in 2.2in', columns: 1,
      font: SANS, size: '10pt', leading: 1.45, justify: false,
      title: { size: '18pt', align: 'left', font: SANS, weight: 700 },
      abstract: 'heading', headings: { numbering: 'none', font: SANS, upper: false },
      captions: { figure: 'Fig', table: 'Table', sep: '.', font: SANS, size: '9pt' },
      keywords: '', refs: '9pt',
      latex: { cls: 'article', opts: '10pt' },
      limits: { title: 250, abstract: 300, note: 'Research Article: abstract up to 300 words' }
    },
    {
      id: 'elife', name: 'eLife', csl: 'elife', page: 'A4', margin: '0.9in', columns: 1,
      font: SANS, size: '10pt', leading: 1.5, justify: false,
      title: { size: '22pt', align: 'left', font: SANS, weight: 700 },
      abstract: 'heading', headings: { numbering: 'none', font: SANS, upper: false },
      captions: { figure: 'Figure', table: 'Table', sep: '.', font: SANS, size: '9pt' },
      keywords: '', refs: '9pt',
      latex: { cls: 'article', opts: '10pt' },
      limits: { abstract: 150, note: 'Research Article: abstract up to 150 words' }
    },
    {
      id: 'ieee', name: 'IEEE (two-column)', csl: 'ieee', page: 'letter', margin: '0.75in 0.625in', columns: 2, gap: '0.2in',
      font: SERIF, size: '10pt', leading: 1.2, justify: true,
      title: { size: '24pt', align: 'center', font: SERIF, weight: 400 },
      abstract: 'inline', headings: { numbering: 'roman', font: SERIF, upper: true, center: true },
      captions: { figure: 'Fig.', table: 'TABLE', sep: '.', font: SERIF, size: '8pt' },
      keywords: 'Index Terms', refs: '8pt',
      latex: { cls: 'IEEEtran', opts: 'conference', bst: 'IEEEtranN' },
      limits: { abstract: 250, note: 'Abstract up to 250 words; conference papers by page count' }
    },
    {
      id: 'acm', name: 'ACM (sigconf)', csl: 'association-for-computing-machinery', page: 'letter', margin: '0.95in 0.75in', columns: 2, gap: '0.33in',
      font: '"Linux Libertine O", "Libertinus Serif", Palatino, serif', size: '9pt', leading: 1.25, justify: true,
      title: { size: '14.4pt', align: 'left', font: SANS, weight: 700 },
      abstract: 'heading', headings: { numbering: 'arabic', font: SANS, upper: true },
      captions: { figure: 'Figure', table: 'Table', sep: ':', font: SANS, size: '8pt' },
      keywords: 'Keywords', refs: '7.5pt',
      latex: { cls: 'acmart', opts: 'sigconf', bst: 'ACM-Reference-Format' },
      limits: { abstract: 250, note: 'Abstract a single paragraph, typically up to 250 words' }
    },
    {
      id: 'neurips', name: 'NeurIPS', csl: 'ieee', page: 'letter', margin: '1in 1.5in', columns: 1,
      font: SERIF, size: '10pt', leading: 1.25, justify: true,
      title: { size: '17pt', align: 'center', font: SERIF, weight: 700, rules: true },
      abstract: 'indented', headings: { numbering: 'arabic', font: SERIF, upper: false },
      captions: { figure: 'Figure', table: 'Table', sep: ':', font: SERIF, size: '9pt' },
      keywords: '', refs: '9pt',
      latex: { cls: 'article', opts: '10pt', textwidth: '5.5in' },
      limits: { abstract: 250, note: 'Abstract one paragraph; main text up to nine pages' }
    },
    // the machine-learning venues: their looks only. Their LaTeX comes from
    // the venue's own template, imported with the paper (paper/template.js);
    // without one, an article set to the same page
    {
      id: 'icml', name: 'ICML', csl: 'apa', page: 'letter', margin: '1in 0.875in', columns: 2, gap: '0.25in',
      font: SERIF, size: '10pt', leading: 1.2, justify: true,
      title: { size: '14pt', align: 'center', font: SERIF, weight: 700, rules: true },
      abstract: 'indented', headings: { numbering: 'arabic', font: SERIF, upper: false },
      captions: { figure: 'Figure', table: 'Table', sep: '.', font: SERIF, size: '9pt' },
      keywords: '', refs: '9pt',
      latex: { cls: 'article', opts: '10pt,twocolumn', textwidth: '6.75in' },
      limits: { abstract: 250, note: 'Abstract one paragraph; main text up to eight pages' }
    },
    {
      id: 'iclr', name: 'ICLR', csl: 'apa', page: 'letter', margin: '1in 1.5in', columns: 1,
      font: SERIF, size: '10pt', leading: 1.25, justify: true,
      title: { size: '17pt', align: 'left', font: SERIF, weight: 700 },
      abstract: 'indented', headings: { numbering: 'arabic', font: SERIF, upper: true },
      captions: { figure: 'Figure', table: 'Table', sep: ':', font: SERIF, size: '9pt' },
      keywords: '', refs: '9pt',
      latex: { cls: 'article', opts: '10pt', textwidth: '5.5in' },
      limits: { abstract: 250, note: 'Abstract one paragraph; main text up to ten pages' }
    },
    {
      id: 'acl', name: 'ACL', csl: 'apa', page: 'A4', margin: '2.5cm', columns: 2, gap: '0.6cm',
      font: SERIF, size: '11pt', leading: 1.2, justify: true,
      title: { size: '15pt', align: 'center', font: SERIF, weight: 700 },
      abstract: 'narrow', headings: { numbering: 'arabic', font: SERIF, upper: false },
      captions: { figure: 'Figure', table: 'Table', sep: ':', font: SERIF, size: '10pt' },
      keywords: '', refs: '10pt',
      latex: { cls: 'article', opts: '11pt,twocolumn,a4paper' },
      limits: { abstract: 200, note: 'Long papers up to eight pages, short papers four' }
    },
    {
      id: 'lncs', name: 'Springer LNCS', csl: 'springer-lecture-notes-in-computer-science', page: '152mm 235mm', margin: '20mm 15mm 22mm', columns: 1,
      font: SERIF, size: '10pt', leading: 1.2, justify: true,
      title: { size: '14pt', align: 'center', font: SERIF, weight: 700 },
      abstract: 'small', headings: { numbering: 'arabic', font: SERIF, upper: false },
      captions: { figure: 'Fig.', table: 'Table', sep: '.', font: SERIF, size: '9pt' },
      keywords: 'Keywords', refs: '9pt',
      latex: { cls: 'llncs', opts: '', bst: 'splncs04' },
      limits: { abstract: 250, note: 'Abstract 150 to 250 words' }
    },
    {
      id: 'elsevier', name: 'Elsevier', csl: 'elsevier-harvard', page: 'A4', margin: '1in', columns: 1,
      font: SERIF, size: '11pt', leading: 1.45, justify: true,
      title: { size: '17pt', align: 'center', font: SERIF, weight: 400 },
      abstract: 'rule', headings: { numbering: 'arabic', font: SERIF, upper: false },
      captions: { figure: 'Figure', table: 'Table', sep: ':', font: SERIF, size: '9.5pt' },
      keywords: 'Keywords', refs: '9.5pt',
      latex: { cls: 'elsarticle', opts: 'preprint,12pt', bst: 'elsarticle-harv' },
      limits: { abstract: 250, note: 'Abstract typically up to 250 words; varies by journal' }
    },
    {
      id: 'aps', name: 'APS (Physical Review)', csl: 'american-physics-society', page: 'letter', margin: '0.75in 0.7in', columns: 2, gap: '0.25in',
      font: CM, size: '10pt', leading: 1.25, justify: true,
      title: { size: '13pt', align: 'center', font: CM, weight: 700 },
      abstract: 'narrow', headings: { numbering: 'roman', font: CM, upper: true, center: true },
      captions: { figure: 'FIG.', table: 'TABLE', sep: '.', font: CM, size: '8.5pt' },
      keywords: '', refs: '8.5pt',
      latex: { cls: 'revtex4-2', opts: 'aps,prl,twocolumn,superscriptaddress', bst: '' },
      limits: { abstractChars: 600, words: 3750, note: 'Letter (PRL): abstract up to 600 characters, about 3,750 words' }
    }
  ];
  const DEFAULT = 'preprint';
  const get = (id) => JOURNALS.find((j) => j.id === id) || JOURNALS[0];

  // 2.1 → "B." for a journal that numbers I., A., 1); arabic stays as it is
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
  function headingNumber(j, num, level) {
    if (!num) return '';
    const n = j.headings.numbering;
    if (n === 'none') return '';
    if (n === 'arabic') return num;
    const last = +String(num).split('.').pop();
    if (level === 1) return (ROMAN[last] || String(last)) + '.';
    if (level === 2) return String.fromCharCode(64 + last) + '.';
    return last + ')';
  }

  // The page, as the journal sets it: CSS for the HTML that becomes the PDF
  function css(j, { double = false } = {}) {
    const head = j.headings;
    const cols = j.columns > 1;
    const abstract = {
      indented: '.abstract { margin: 1.4em 3em 1.2em; font-size: .92em; } .abstract h2 { text-align: center; font-size: 1em; margin: 0 0 .4em; }',
      bold: '.abstract { font-weight: 700; margin: .4em 0 1.4em; font-size: 1.05em; line-height: 1.4; } .abstract h2 { display: none; }',
      box: '.abstract { border: 1px solid #000; padding: .8em 1em; margin: .6em 0 1.4em; font-size: .95em; } .abstract h2 { font-size: 1em; margin: 0 0 .3em; }',
      heading: '.abstract { margin: .6em 0 1.4em; } .abstract h2 { font-family: ' + head.font + '; font-size: 1em; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 .3em; }',
      inline: '.abstract { margin: .4em 0 1em; font-weight: 700; font-size: .9em; } .abstract h2 { display: inline; font-style: italic; font-size: 1em; } .abstract h2::after { content: "—"; } .abstract p { display: inline; }',
      small: '.abstract { margin: 1.2em 2.4em; font-size: .88em; } .abstract h2 { display: inline; font-size: 1em; } .abstract h2::after { content: "."; } .abstract p { display: inline; }',
      rule: '.abstract { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: .6em 0; margin: 1em 0 1.4em; } .abstract h2 { font-size: 1em; font-style: italic; font-weight: 400; margin: 0 0 .3em; }',
      narrow: '.abstract { margin: 1em 4em 1.4em; font-size: .92em; } .abstract h2 { display: none; }'
    }[j.abstract] || '';
    return `
@page { size: ${j.page}; margin: ${j.margin}; }
html { -webkit-print-color-adjust: exact; }
body { font-family: ${j.font}; font-size: ${j.size}; line-height: ${double ? 2 : j.leading}; color: #000; margin: 0; }
header { text-align: ${j.title.align}; margin-bottom: 1em; }
h1.title { font-family: ${j.title.font}; font-size: ${j.title.size}; font-weight: ${j.title.weight}; line-height: 1.2; margin: 0 0 .5em;${j.title.rules ? ' border-top: 3px solid #000; border-bottom: 1px solid #000; padding: .45em 0;' : ''} }
.subtitle { font-style: italic; margin: 0 0 .6em; }
.authors { margin: .4em 0 .2em; font-size: 1.05em; }
.affils { font-size: .82em; line-height: 1.35; }
.orcid { font-size: .7em; color: #a6ce39; font-weight: bold; text-decoration: none; }
${abstract}
.abstract p { text-indent: 0; margin: 0; }
.keywords { margin: 0 0 1.4em; font-size: .9em; text-indent: 0; }
${j.abstract === 'inline' || j.abstract === 'bold' ? '.keywords { font-weight: 700; }' : ''}
main { ${cols ? `column-count: ${j.columns}; column-gap: ${j.gap || '0.25in'}; column-fill: balance;` : ''} }
h2, h3, h4 { font-family: ${head.font}; line-height: 1.25; break-after: avoid; ${head.center ? 'text-align: center;' : ''} }
h2 { font-size: 1.12em; margin: 1.2em 0 .45em; ${head.upper ? `text-transform: uppercase; font-size: ${head.center ? '1em' : '1.02em'}; letter-spacing: .03em; ${head.center ? 'font-weight: 400; font-variant: small-caps;' : ''}` : ''} }
h3 { font-size: 1.02em; margin: 1em 0 .35em; ${head.center ? 'text-align: left; font-style: italic; font-weight: 400;' : ''} }
h4 { font-size: 1em; font-style: italic; margin: .8em 0 .3em; ${head.center ? 'text-align: left;' : ''} }
h2 .num, h3 .num, h4 .num { margin-right: .5em; }
p { margin: 0; text-indent: ${j.justify ? '1.2em' : '0'}; ${j.justify ? 'text-align: justify; hyphens: auto;' : 'margin-bottom: .6em;'} }
h2 + p, h3 + p, h4 + p, figure + p, .eq + p, ul + p, ol + p, table + p, p.flush { text-indent: 0; }
ul, ol { margin: .4em 0 .6em; padding-left: 1.6em; }
li ul, li ol { margin: .2em 0; }
table.symbols { margin: .8em auto; break-inside: avoid; }
table.symbols td:first-child { white-space: nowrap; }
a { color: inherit; text-decoration: none; }
.math svg { vertical-align: middle; }
.eq { display: flex; align-items: center; justify-content: center; position: relative; margin: .7em 0; break-inside: avoid; }
.eq-num { position: absolute; right: 0; }
figure { margin: 1em auto; text-align: center; break-inside: avoid; }
figure img { width: var(--w, 100%); max-width: 100%; height: auto; }
figure.wrap-left, figure.wrap-right { width: var(--w, 50%); margin: .3em 0 .6em; }
figure.wrap-left { float: left; margin-right: 1em; } figure.wrap-right { float: right; margin-left: 1em; }
figure.wrap-left img, figure.wrap-right img { width: 100%; }
figure.multi { width: var(--w, 100%); }
figure .panels { display: flex; gap: 3%; align-items: flex-start; }
figure .panel { flex: 1 1 0; min-width: 0; }
figure .panel img { width: 100%; }
figure .subcap { font-size: .85em; margin-top: .3em; }
figure.span { column-span: all; }
figcaption { text-align: left; font-family: ${j.captions.font}; font-size: ${j.captions.size}; margin-top: .5em; line-height: 1.35; }
figure.table figcaption { margin: 0 0 .4em; ${j.captions.table === 'TABLE' ? 'text-align: center;' : ''} }
table { border-collapse: collapse; margin: 0 auto; font-size: .9em; border-top: 1.2px solid #000; border-bottom: 1.2px solid #000; }
th { border-bottom: .8px solid #000; font-weight: bold; }
th, td { padding: .2em .6em; text-align: left; vertical-align: top; }
.references { ${cols ? '' : 'margin-top: 1.6em;'} font-size: ${j.refs}; line-height: 1.35; ${j.refsFont ? `font-family: ${j.refsFont};` : ''} }
.references h2 { font-size: ${j.size}; }
.references .entry { margin: 0 0 .35em; break-inside: avoid; }
.references.hanging .entry { padding-left: 1.6em; text-indent: -1.6em; }
.references.numeric .csl-entry { display: flex; gap: .5em; }
.references .csl-left-margin { min-width: 2em; }
.references .csl-right-inline { flex: 1; }`;
  }

  // The words for a paper's figures and tables, in a journal's captions (or
  // none's: Figure 1.), and in its sentences: Fig. 2, Table 1, Section 3,
  // Equation (4), where a caption set in capitals (FIG., TABLE) is still
  // Fig. and Table in the text. A cross-reference saved in the chapter says
  // these, the same on every device, whatever language NEO itself speaks.
  const PLAIN_CAPTIONS = { figure: 'Figure', table: 'Table', sep: '.' };
  const journalOf = (j) => (typeof j === 'string' ? get(j) : j);
  function captions(j) {
    j = journalOf(j);
    return j ? j.captions : PLAIN_CAPTIONS;
  }
  // a table's number as its caption sets it: TABLE IV in IEEE's way
  function tableNumber(j, num) {
    j = journalOf(j);
    return j && j.captions.table === 'TABLE' && j.headings.numbering === 'roman' ? headingNumber(j, num, 1).replace(/\.$/, '') : String(num);
  }
  function refWord(j, kind) {
    const c = captions(j);
    const calm = (w) => (w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w);
    return { fig: calm(c.figure), tbl: calm(c.table), sec: 'Section', eq: 'Equation' }[kind] || '';
  }
  function refLabel(j, kind, num) {
    return kind === 'eq' ? `${refWord(j, 'eq')} (${num})` : `${refWord(j, kind)} ${num}`;
  }

  // The look for a paper written to a venue's LaTeX template: the venue's
  // own when NEO knows it, else the preprint's set to the template's
  // columns, type size and paper. Its name is the template's.
  function templateLook(info) {
    if (!info) return null;
    const known = info.look && JOURNALS.find((j) => j.id === info.look);
    const two = info.columns === 2;
    const base = known || {
      ...JOURNALS[0], columns: two ? 2 : 1, gap: '0.25in', margin: two ? '0.75in' : '1in',
      size: /^(9|10|11|12)pt$/.test(info.fontSize || '') ? info.fontSize : '10pt',
      page: info.paper === 'a4' ? 'A4' : 'letter', limits: null
    };
    return { ...base, id: 'template', name: info.name || base.name, latex: { cls: info.cls || 'article', opts: info.clsOpts || '' } };
  }

  return { JOURNALS, DEFAULT, get, headingNumber, css, captions, tableNumber, refWord, refLabel, templateLook };
});
