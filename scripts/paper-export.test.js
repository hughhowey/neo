'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const X = require('../paper/export.js');

const T = (text, f = {}) => ({ text, ...f });
const model = () => ({
  title: 'Balance & control in 100% of cortex',
  subtitle: '',
  authors: [
    { name: 'Ada Lovelace', affiliations: [0], email: 'ada@example.org', orcid: '0000-0002-1825-0097', corresponding: true },
    { name: 'Charles Babbage', affiliations: [1] }
  ],
  affiliations: ['University of London', 'University of Cambridge'],
  abstract: [[T('We ask '), { math: 'x_1' }, T('.')]],
  keywords: ['cortex', 'inhibition'],
  numbered: true,
  double: false,
  style: { id: 'apa', title: 'APA 7th', numeric: false, xml: '<style/>' },
  bibtex: '@article{smith2020,\n  title = {T}\n}\n',
  bibliography: { entries: [{ id: 'smith2020', html: '<div class="csl-entry">Smith, J. (2020). <i>T</i>.</div>' }], hanging: true, numeric: false },
  blocks: [
    { type: 'heading', level: 1, num: '1', id: 'sec-ab12', runs: [T('Introduction')] },
    { type: 'para', runs: [T('Costs $5 & rise_'), T('fast', { i: true }), T(' '), { cite: [{ id: 'smith2020', locator: '4', label: 'page' }], html: '(Smith, 2020, p. 4)' }, T(', as '), { xref: 'fig-cd34', kind: 'fig', num: '1', label: 'Figure 1' }, T(' and '), { xref: 'eq-ef56', kind: 'eq', num: '1', label: 'Equation (1)' }, T(' show.')] },
    { type: 'para', runs: [{ cite: [{ id: 'smith2020' }, { id: 'doe2019' }], narrative: true, html: 'Smith (2020); Doe (2019)' }, T(' argue.')] },
    { type: 'para', runs: [{ cite: [{ id: 'a', prefix: 'see' }, { id: 'b', locator: '2–3' }], html: '(see A; B, pp. 2–3)' }] },
    { type: 'para', runs: [{ cite: [{ id: 'a', locator: '1' }, { id: 'b', locator: '9' }], html: '(A, p. 1; B, p. 9)' }] },
    { type: 'heading', level: 2, num: '1.1', id: 'sec-gh78', runs: [T('Model')] },
    { type: 'equation', id: 'eq-ef56', num: '1', tex: 'a = b \\\\ c = d', svg: '<svg/>' },
    { type: 'figure', id: 'fig-cd34', num: '1', name: 'figure-cd34.png', mime: 'image/png', base64: 'AAAA', width: 50, alt: 'A plot', w: 400, h: 200, caption: [T('Rates')] },
    { type: 'table', id: 'tab-ij90', num: '1', caption: [T('Means')], header: true, rows: [[[T('Layer')], [T('Rate')]], [[T('L5')], [T('7.9')]]] }
  ]
});

test('LaTeX: natbib citations, labels, escapes, floats and the bibliography', () => {
  const files = X.latex(model());
  const tex = files.find((f) => f.path === 'paper.tex').content;
  assert.match(tex, /\\title\{Balance \\& control in 100\\% of cortex\}/);
  assert.match(tex, /\\author\[1\]\{Ada Lovelace\\thanks\{Correspondence: \\href\{mailto:ada@example\.org\}/);
  assert.match(tex, /\\affil\[2\]\{University of Cambridge\}/);
  assert.match(tex, /\\begin\{abstract\}\nWe ask \\\(x_1\\\)\.\n\\end\{abstract\}/);
  assert.match(tex, /Costs \\\$5 \\& rise\\_\\emph\{fast\} \\citep\[p\.~4\]\{smith2020\}, as Figure~\\ref\{fig:cd34\} and Equation~\\eqref\{eq:ef56\} show\./);
  assert.match(tex, /\\citet\{smith2020\}; \\citet\{doe2019\} argue\./);
  assert.match(tex, /\\citep\[see\]\[pp\.~2–3\]\{a,b\}/, 'one note before and one after the group: \\citep takes them');
  assert.match(tex, /\(\\citealp\[p\.~1\]\{a\}; \\citealp\[p\.~9\]\{b\}\)/, 'a page for each: one \\citealp each');
  assert.match(tex, /\\section\{Introduction\}\\label\{sec:ab12\}/);
  assert.match(tex, /\\subsection\{Model\}\\label\{sec:gh78\}/);
  assert.match(tex, /\\begin\{equation\}\n\\begin\{split\}\na = b \\\\ c = d\n\\end\{split\}\n\\label\{eq:ef56\}/);
  assert.match(tex, /\\includegraphics\[width=0\.50\\linewidth\]\{figures\/figure-cd34\.png\}\n\\caption\{Rates\}\n\\label\{fig:cd34\}/);
  assert.match(tex, /\\begin\{tabular\}\{ll\}\n\\toprule\nLayer & Rate \\\\\n\\midrule\nL5 & 7\.9 \\\\\n\\bottomrule/);
  assert.match(tex, /\\bibliographystyle\{plainnat\}\n\\bibliography\{references\}/);
  assert.ok(files.some((f) => f.path === 'figures/figure-cd34.png' && f.base64));
  assert.equal(files.find((f) => f.path === 'references.bib').content, model().bibtex);
  const unnumbered = X.latex({ ...model(), numbered: false, style: { numeric: true } }).find((f) => f.path === 'paper.tex').content;
  assert.match(unnumbered, /\\section\*\{Introduction\}/);
  assert.match(unnumbered, /\\usepackage\[numbers,square,sort&compress\]\{natbib\}/);
  assert.match(unnumbered, /\\bibliographystyle\{unsrtnat\}/);
});

test('Pandoc Markdown: [@key], pandoc-crossref labels, YAML front matter and the style', () => {
  const files = X.pandoc(model());
  const md = files.find((f) => f.path === 'paper.md').content;
  assert.match(md, /^---\ntitle: "Balance & control in 100% of cortex"\nauthor:\n {2}- name: "Ada Lovelace"\n {4}affiliation: "University of London"\n {4}email: "ada@example\.org"\n {4}orcid: "0000-0002-1825-0097"\n {4}corresponding: true/);
  assert.match(md, /abstract: \|\n {2}We ask \$x_1\$\./);
  assert.match(md, /bibliography: references\.bib\ncsl: apa\.csl/);
  assert.match(md, /# Introduction \{#sec:ab12\}/);
  assert.match(md, /Costs \\\$5 & rise\\_\*fast\* \[@smith2020, p\. 4\], as @fig:cd34 and @eq:ef56 show\./);
  assert.match(md, /@smith2020; @doe2019 argue\./);
  assert.match(md, /\[see @a; @b, p\. 2–3\]/);
  assert.match(md, /\$\$\na = b \\\\ c = d\n\$\$ \{#eq:ef56\}/);
  assert.match(md, /!\[Rates\]\(figures\/figure-cd34\.png\)\{#fig:cd34 width=50%\}/);
  assert.match(md, /\| Layer \| Rate \|\n\| --- \| --- \|\n\| L5 \| 7\.9 \|\n\n: Means \{#tbl:ij90\}/);
  assert.ok(files.some((f) => f.path === 'apa.csl'));
});

test('HTML: the paper as one page, with numbers, links and the reference list', () => {
  const html = X.html(model());
  assert.match(html, /<h1 class="title">Balance &amp; control in 100% of cortex<\/h1>/);
  assert.match(html, /<span class="author">Ada Lovelace<sup>1<\/sup><sup>\*<\/sup> <a class="orcid" href="https:\/\/orcid\.org\/0000-0002-1825-0097"/);
  assert.match(html, /<h2 id="sec-ab12"><span class="num">1<\/span> Introduction<\/h2>/);
  assert.match(html, /<h3 id="sec-gh78"><span class="num">1\.1<\/span> Model<\/h3>/);
  assert.match(html, /<span class="cite"><a href="#ref-smith2020">\(Smith, 2020, p\. 4\)<\/a><\/span>/);
  assert.match(html, /<a class="xref" href="#fig-cd34">Figure 1<\/a>/);
  assert.match(html, /<figure id="fig-cd34" style="--w:50%"><img src="data:image\/png;base64,AAAA" alt="A plot"><figcaption><b>Figure 1\.<\/b> Rates<\/figcaption><\/figure>/);
  assert.match(html, /<div class="entry" id="ref-smith2020">/);
  assert.match(X.html(model(), { print: true }), /font-size: 11pt/);
});

test('Word: styles, bookmarks for cross-references, pictures, a table and page numbers', () => {
  const files = X.docx(model());
  const doc = files.find((f) => f.path === 'word/document.xml').content;
  assert.match(doc, /<w:pStyle w:val="Title"\/><\/w:pPr><w:r><w:t xml:space="preserve">Balance &amp; control in 100% of cortex<\/w:t>/);
  assert.match(doc, /<w:pStyle w:val="Heading1"\/><\/w:pPr><w:bookmarkStart w:id="\d+" w:name="_sec_ab12"\/><w:r><w:t xml:space="preserve">1<\/w:t><\/w:r><w:r><w:tab\/><\/w:r>/);
  assert.match(doc, /<w:hyperlink w:anchor="_fig_cd34"><w:r><w:t xml:space="preserve">Figure 1<\/w:t><\/w:r><\/w:hyperlink>/);
  assert.match(doc, /<w:r><w:rPr><w:i\/><\/w:rPr><w:t xml:space="preserve">fast<\/w:t><\/w:r>/);
  assert.match(doc, /\(Smith, 2020, p\. 4\)/);
  assert.match(doc, /<w:tbl>/);
  assert.match(doc, /<w:pStyle w:val="Bibliography"\/>/);
  assert.match(doc, /<w:footerReference w:type="default" r:id="rIdFooter"\/>/);
  assert.ok(files.some((f) => f.path === 'word/media/image1.png'));
  assert.match(files.find((f) => f.path === 'word/_rels/document.xml.rels').content, /Target="media\/image1\.png"/);
  assert.match(files.find((f) => f.path === 'word/styles.xml').content, /w:styleId="FirstParagraph"><w:name w:val="First Paragraph"\/><w:basedOn w:val="BodyText"\/>/);
  // the first paragraph under a heading is set flush, the next indented
  const after = doc.split('_sec_ab12')[1];
  assert.ok(after.indexOf('FirstParagraph') < after.indexOf('BodyText'));
});

test('citeproc HTML becomes Word runs; numbered entries keep their number and a tab', () => {
  assert.deepEqual(X.htmlToRuns('Smith, J. (2020). <i>T</i>. A &#38; B.'), [
    { text: 'Smith, J. (2020). ', i: false, b: false, sup: false, sub: false },
    { text: 'T', i: true, b: false, sup: false, sub: false },
    { text: '. A & B.', i: false, b: false, sup: false, sub: false }
  ]);
  const runs = X.htmlToRuns('<div class="csl-entry"><div class="csl-left-margin">[1]</div><div class="csl-right-inline">J. Smith</div></div>');
  assert.equal(runs.map((r) => r.text).join(''), '[1]\tJ. Smith');
  assert.equal(X.crossId('tab-ij90'), 'tbl:ij90');
  assert.equal(X.texEsc('50% & $x_1$ {a} ~ ^'), '50\\% \\& \\$x\\_1\\$ \\{a\\} \\textasciitilde{} \\textasciicircum{}');
});

test('edge cases: align as written, line breaks in cells and the abstract, entities in references', () => {
  const m = model();
  m.blocks = [
    { type: 'equation', id: 'eq-aa11', num: '1', tex: '\\begin{align} a &= b \\\\ c &= d \\end{align}' },
    { type: 'table', id: 'tab-bb22', num: '1', caption: [T('Two\nlines')], header: false, rows: [[[T('a\n\nb')]]] }
  ];
  m.abstract = [[T('line one\nline two: x')]];
  const tex = X.latex(m).find((f) => f.path === 'paper.tex').content;
  assert.match(tex, /\\begin\{align\} a &= b \\\\ c &= d \\label\{eq:aa11\}\n\\end\{align\}/);
  assert.doesNotMatch(tex, /\\begin\{equation\}\n\\begin\{align\}/);
  assert.match(tex, /\\caption\{Two lines\}/);
  assert.match(tex, /\na b \\\\\n/);
  const md = X.pandoc(m).find((f) => f.path === 'paper.md').content;
  assert.match(md, /abstract: \|\n {2}line one\n {2}line two: x\n/);
  assert.equal(X.htmlToRuns('p &#60; 0.05 &#38; more').map((r) => r.text).join(''), 'p < 0.05 & more');
});

test('figure layout: placement, both columns, wrapped text and panels, as LaTeX lays them out', () => {
  const m = model();
  const pic = (name) => ({ name, mime: 'image/png', base64: 'AAAA', w: 100, h: 50 });
  m.blocks = [
    { type: 'figure', id: 'fig-p1', num: '1', place: 'H', caption: [T('Pinned')], ...pic('figure-a.png') },
    { type: 'figure', id: 'fig-p2', num: '2', span: true, place: 'H', caption: [T('Wide')], ...pic('figure-b.png') },
    { type: 'figure', id: 'fig-p3', num: '3', wrap: 'right', width: 33, caption: [T('Beside')], ...pic('figure-c.png') },
    { type: 'figure', id: 'fig-p4', num: '4', width: 100, caption: [T('Both')], ...pic('figure-d.png'),
      panels: [{ ...pic('figure-d.png'), sub: [T('Before')] }, { ...pic('figure-e.png'), sub: [T('After')] }] },
    { type: 'table', id: 'tab-t1', num: '1', span: true, place: 't', caption: [T('T')], header: true, rows: [[[T('a')]]] }
  ];
  const files = X.latex(m);
  const tex = files.find((f) => f.path === 'paper.tex').content;
  assert.match(tex, /\\usepackage\{subcaption\}\n\\usepackage\{float\}\n\\usepackage\{wrapfig\}/);
  assert.match(tex, /\\begin\{figure\}\[H\]\n\\centering\n\\includegraphics\[width=\\linewidth\]\{figures\/figure-a\.png\}/);
  assert.match(tex, /\\begin\{figure\*\}\[tp\][\s\S]*?\\end\{figure\*\}/, 'a figure across both columns takes no [H]');
  assert.match(tex, /\\begin\{wrapfigure\}\{r\}\{0\.33\\linewidth\}\n\\centering\n\\includegraphics\[width=\\linewidth\]\{figures\/figure-c\.png\}/);
  assert.match(tex, /\\begin\{subfigure\}\[t\]\{0\.485\\linewidth\}\n\\centering\n\\includegraphics\[width=\\linewidth\]\{figures\/figure-d\.png\}\n\\caption\{Before\}\n\\label\{fig:p4-a\}\n\\end\{subfigure\}\\hspace\{0\.030\\linewidth\}\n\\begin\{subfigure\}/);
  assert.match(tex, /\\caption\{After\}\n\\label\{fig:p4-b\}\n\\end\{subfigure\}%\n\\caption\{Both\}/);
  assert.match(tex, /\\begin\{table\*\}\[t\][\s\S]*?\\end\{table\*\}/);
  assert.deepEqual(files.filter((f) => f.path.startsWith('figures/')).map((f) => f.path),
    ['figures/figure-a.png', 'figures/figure-b.png', 'figures/figure-c.png', 'figures/figure-d.png', 'figures/figure-e.png']);
  const md = X.pandoc(m).find((f) => f.path === 'paper.md').content;
  assert.match(md, /\{#fig:p1 fig-pos="H"\}/);
  assert.match(md, /<div id="fig:p4">\n!\[Before\]\(figures\/figure-d\.png\)\{#fig:p4-a width=48%\}\n!\[After\]\(figures\/figure-e\.png\)\{#fig:p4-b width=48%\}\n\nBoth\n<\/div>/);
  const html = X.html(m);
  assert.match(html, /<figure id="fig-p3" class="wrap-right" style="--w:33%">/);
  assert.match(html, /<figure id="fig-p4" class="multi" style="--w:100%"><div class="panels" style="[^"]*"><div class="panel" id="fig-p4-a" style="flex:0 0 48\.40%"><img[^>]+><div class="subcap"><b>\(a\)<\/b> Before<\/div>/);
  assert.match(html, /<figure class="table span" id="tab-t1">/);
  const doc = X.docx(m).find((f) => f.path === 'word/document.xml').content;
  assert.match(doc, /Figure 4\. <\/w:t><\/w:r><w:bookmarkEnd w:id="\d+"\/><w:r><w:t xml:space="preserve">Both<\/w:t><\/w:r><w:r><w:t xml:space="preserve"> <\/w:t><\/w:r><w:bookmarkStart w:id="\d+" w:name="_fig_p4_a"\/><w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">\(a\) <\/w:t>/, 'panel (a) can be linked to');
});

test('panels in rows: so many to a row, a panel two columns wide, the same in every format', () => {
  const m = model();
  const pic = (name, more) => ({ name, mime: 'image/png', base64: 'AAAA', w: 100, h: 50, ...more });
  // (a) across the first row, (b) and (c) under it; two columns to a row
  m.blocks = [{ type: 'figure', id: 'fig-g', num: '1', cols: 2, caption: [T('Grid')], ...pic('figure-a.png'),
    panels: [pic('figure-a.png', { colspan: 2, sub: [T('Wide')] }), pic('figure-b.png', { sub: [T('Left')] }), pic('figure-c.png', { sub: [T('Right')] })] }];
  const { rows, units } = X.panelRows(m.blocks[0]);
  assert.equal(units, 2);
  assert.deepEqual(rows.map((r) => r.map((x) => x.i)), [[0], [1, 2]]);
  assert.equal(rows[0][0].share, 1, 'a panel as wide as the row is the whole figure');
  assert.ok(Math.abs(rows[1][0].share - 0.485) < 1e-9);
  // three to a row when unset: all in one row; a span past the row starts the next
  assert.deepEqual(X.panelRows({ panels: [pic('a'), pic('b'), pic('c')] }).rows.map((r) => r.length), [3]);
  assert.deepEqual(X.panelRows({ cols: 2, panels: [pic('a'), pic('b', { colspan: 2 }), pic('c')] }).rows.map((r) => r.map((x) => x.i)), [[0], [1], [2]]);
  const tex = X.latex(m).find((f) => f.path === 'paper.tex').content;
  assert.match(tex, /\\begin\{subfigure\}\[t\]\{1\.000\\linewidth\}[\s\S]*?\\label\{fig:g-a\}\n\\end\{subfigure\}%\n\n\\medskip\n\\begin\{subfigure\}\[t\]\{0\.485\\linewidth\}/, 'a row, then the next');
  const md = X.pandoc(m).find((f) => f.path === 'paper.md').content;
  assert.match(md, /\{#fig:g-a width=100%\}\n\n!\[Left\]\(figures\/figure-b\.png\)\{#fig:g-b width=48%\}\n!\[Right\]/, 'a paragraph to a row');
  const html = X.html(m);
  assert.match(html, /<div class="panel" id="fig-g-a" style="flex:0 0 99\.90%">[\s\S]*<div class="panel" id="fig-g-b" style="flex:0 0 48\.40%">/);
  const doc = X.docx(m).find((f) => f.path === 'word/document.xml').content;
  assert.equal((doc.match(/<w:pStyle w:val="Figure"\/>/g) || []).length, 2, 'a paragraph of pictures to a row');
});

// every XML part well-formed, by xmllint (macOS and most Linux have it)
const { execFileSync } = require('node:child_process');
const xmllint = (() => { try { execFileSync('xmllint', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
function wellFormed(entries) {
  if (!xmllint) return;
  for (const e of entries) {
    if (e.base64 || !/\.(xml|rels|xhtml|opf)$/.test(e.path)) continue;
    try { execFileSync('xmllint', ['--noout', '-'], { input: e.content, stdio: ['pipe', 'ignore', 'pipe'] }); }
    catch (err) { assert.fail(`${e.path} is not well-formed XML: ${String(err.stderr)}`); }
  }
}

test('Word: maths as Word equations (OMML) when MathML is there, and every part well-formed', () => {
  const m = model();
  m.blocks[1].runs.push({ math: 'x^2', mml: '<math xmlns="http://www.w3.org/1998/Math/MathML"><msup><mi>x</mi><mn>2</mn></msup></math>' });
  m.blocks[6].mml = '<math display="block"><mi>a</mi><mo>=</mo><mi>b</mi></math>';
  const files = X.docx(m);
  const doc = files.find((f) => f.path === 'word/document.xml').content;
  assert.match(doc, /xmlns:m="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/math"/);
  assert.match(doc, /<m:oMath><m:sSup><m:e><m:r><m:t xml:space="preserve">x<\/m:t><\/m:r><\/m:e><m:sup>/);
  assert.match(doc, /<w:bookmarkStart w:id="\d+" w:name="_eq_ef56"\/><m:oMathPara><m:oMathParaPr><m:jc m:val="center"\/><\/m:oMathParaPr><m:oMath>.*<\/m:oMath><\/m:oMathPara><w:bookmarkEnd w:id="\d+"\/><\/w:p><\/w:tc><w:tc>.*\(1\)<\/w:t>/, 'a display equation, numbered on the right');
  wellFormed(files);
});

test('Word follows the journal: its page, two columns after the front matter, its words and numbers', () => {
  const m = { ...model(), journal: require('../paper/journals.js').get('ieee') };
  const files = X.docx(m);
  const doc = files.find((f) => f.path === 'word/document.xml').content;
  assert.match(doc, /<w:sectPr><w:type w:val="continuous"\/><w:pgSz w:w="12240" w:h="15840"\/><w:pgMar w:top="1080" w:right="900" w:bottom="1080" w:left="900"[^>]*\/><w:cols w:num="1"/, 'the front matter in one column');
  assert.match(doc, /<w:cols w:num="2" w:space="288"\/><\/w:sectPr><\/w:body>/, 'the paper in two');
  assert.match(doc, /<w:t xml:space="preserve">I\.<\/w:t><\/w:r><w:r><w:tab\/><\/w:r><w:r><w:t xml:space="preserve">INTRODUCTION<\/w:t>/);
  assert.match(doc, /TABLE I\. /);
  assert.match(doc, /Fig\. 1\. /);
  assert.match(doc, /Index Terms: /);
  assert.match(files.find((f) => f.path === 'word/styles.xml').content, /w:ascii="Times New Roman"[^>]*\/><w:sz w:val="20"\/>/);
  wellFormed(files);
});

test('one Markdown file: the references in its front matter, the pictures inside it', () => {
  const m = model();
  m.references = [{ id: 'smith2020', type: 'article-journal', title: 'T', author: [{ family: 'Smith' }] }];
  const md = X.markdown(m);
  assert.doesNotMatch(md, /bibliography:/);
  assert.match(md, /references:\n {2}- \{"id":"smith2020","type":"article-journal","title":"T","author":\[\{"family":"Smith"\}\]\}\n/);
  assert.match(md, /!\[Rates\]\(data:image\/png;base64,AAAA\)\{#fig:cd34 width=50%\}/);
  assert.doesNotMatch(md, /csl: /, 'no style file to point at');
});

test('plain text: headings underlined, citations as set, maths as TeX, a table in columns, the references', () => {
  const s = X.text(model());
  assert.match(s, /^Balance & control in 100% of cortex\n\nAda Lovelace \[1\]\*, Charles Babbage \[2\]\n\[1\] University of London/);
  assert.match(s, /ABSTRACT\n\nWe ask \$x_1\$\./);
  assert.match(s, /1 Introduction\n=+\n/);
  assert.match(s, /\(Smith, 2020, p\. 4\), as Figure 1 and\nEquation \(1\) show\.|\(Smith, 2020, p\. 4\), as Figure 1 and Equation \(1\)\s+show\./);
  assert.match(s, /\[Figure 1: Rates\]/);
  assert.match(s, /Layer {2}Rate\n-{5} {2}-{4}\nL5 {5}7\.9/);
  assert.match(s, /REFERENCES\n\nSmith, J\. \(2020\)\. T\./);
});

test('EPUB 3: mimetype first and stored, the paper as XHTML, its pictures as files, every part well-formed', () => {
  const m = model();
  m.blocks[6].svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1ex" height="1ex"><path d="M0 0"/></svg>';
  const files = X.epub(m, { uuid: 'urn:uuid:test', modified: '2026-01-01T00:00:00Z' });
  assert.deepEqual(files[0], { path: 'mimetype', content: 'application/epub+zip', store: true });
  const page = files.find((f) => f.path === 'OEBPS/paper.xhtml').content;
  assert.match(page, /<img src="images\/figure-cd34\.png" alt="A plot"\/>/);
  assert.match(page, /<h2 id="sec-ab12"><span class="num">1<\/span> Introduction<\/h2>/);
  const opf = files.find((f) => f.path === 'OEBPS/content.opf').content;
  assert.match(opf, /<item id="paper" href="paper\.xhtml" media-type="application\/xhtml\+xml" properties="svg"\/>/);
  assert.match(opf, /<item id="img0" href="images\/figure-cd34\.png" media-type="image\/png"\/>/);
  assert.match(files.find((f) => f.path === 'OEBPS/nav.xhtml').content, /<a href="paper\.xhtml#sec-ab12">Introduction<\/a>/);
  assert.ok(files.some((f) => f.path === 'OEBPS/images/figure-cd34.png' && f.base64));
  wellFormed(files);
});

test('back matter (Acknowledgements, Data availability…) is unnumbered in every format', () => {
  const m = model();
  m.blocks.push({ type: 'heading', level: 1, num: '', unnumbered: true, id: 'sec-back1', runs: [T('Acknowledgements')] }, { type: 'para', runs: [T('Thanks.')] });
  assert.match(X.latex(m).find((f) => f.path === 'paper.tex').content, /\\section\*\{Acknowledgements\}\\label\{sec:back1\}/);
  assert.match(X.pandoc(m).find((f) => f.path === 'paper.md').content, /# Acknowledgements \{#sec:back1 \.unnumbered\}/);
  assert.match(X.html(m), /<h2 id="sec-back1">Acknowledgements<\/h2>/);
  assert.match(X.docx(m).find((f) => f.path === 'word/document.xml').content, /w:name="_sec_back1"\/><w:r><w:t xml:space="preserve">Acknowledgements<\/w:t>/);
  assert.match(X.text(m), /\nAcknowledgements\n=+\n/);
});

// lists, a paper's own symbols, Unicode symbols in the text and the table of symbols
const symbolModel = () => {
  const m = model();
  m.symbols = [{ id: 'Vm', tex: 'V_\\mathrm{m}' }, { id: 'tauE', tex: '\\tau_\\mathrm{E}' }];
  const smith = { cite: [{ id: 'smith2020' }], narrative: false, html: '(Smith, 2020)' };
  m.blocks = [
    { type: 'heading', level: 1, num: '1', id: 'sec-ab12', runs: [T('Methods')] },
    { type: 'para', runs: [T('The potential '), { sym: 'Vm', math: 'V_\\mathrm{m}', svg: '<svg class="vm"/>', mml: '<math><msub><mi>V</mi><mi mathvariant="normal">m</mi></msub></math>' }, T(' rose by 5 μV ≤ 10° in 3 ms.')] },
    { type: 'item', list: 'ul', level: 1, runs: [T('first')] },
    { type: 'item', list: 'ul', level: 2, runs: [T('nested')] },
    { type: 'item', list: 'ul', level: 1, runs: [T('second')] },
    { type: 'item', list: 'ol', level: 1, runs: [T('one')] },
    { type: 'item', list: 'ol', level: 1, runs: [T('two')] },
    { type: 'para', runs: [T('After.')] },
    { type: 'symbols', kind: '', rows: [
      { id: 'Vm', tex: 'V_\\mathrm{m}', meaning: 'membrane potential', unit: 'mV', value: '−65', kind: 'variable', svg: '<svg class="vm"/>', cite: smith },
      { id: 'tauE', tex: '\\tau_\\mathrm{E}', meaning: 'excitatory time constant', unit: 'ms', value: '', kind: 'parameter', cite: null }
    ] },
    { type: 'item', list: 'ol', level: 1, runs: [T('again')] }
  ];
  return m;
};

test('lists and symbols in LaTeX: \\Vm defined once, lists nested, μ set, the table of symbols', () => {
  const tex = X.latex(symbolModel()).find((f) => f.path === 'paper.tex').content;
  assert.match(tex, /\\DeclareRobustCommand\{\\Vm\}\{\\ensuremath\{V_\\mathrm\{m\}\}\}\n\\DeclareRobustCommand\{\\tauE\}\{\\ensuremath\{\\tau_\\mathrm\{E\}\}\}\n[\s\S]*\\begin\{document\}/);
  assert.match(tex, /The potential \\Vm\{\} rose by 5 \\ensuremath\{\\mu\}V \\ensuremath\{\\leq\} 10\\textdegree\{\} in 3 ms\./);
  assert.match(tex, /\\begin\{itemize\}\n {2}\\item first\n {2}\\begin\{itemize\}\n {4}\\item nested\n {2}\\end\{itemize\}\n {2}\\item second\n\\end\{itemize\}\n\\begin\{enumerate\}\n {2}\\item one\n {2}\\item two\n\\end\{enumerate\}\nAfter\./);
  assert.match(tex, /\\usepackage\{tabularx\}/);
  assert.match(tex, /\\begin\{tabularx\}\{\\linewidth\}\{@\{\}l>\{\\raggedright\\arraybackslash\}Xll>\{\\raggedright\\arraybackslash\}X@\{\}\}\n\\toprule\nSymbol & Meaning & Value & Unit & Source \\\\\n\\midrule\n\\Vm\{\} & membrane potential & \\ensuremath\{-\}65 & mV & \\citep\{smith2020\} \\\\\n\\tauE\{\} & excitatory time constant & {2}& ms & {2}\\\\\n\\bottomrule\n\\end\{tabularx\}/);
  assert.match(tex, /\\begin\{enumerate\}\n {2}\\item again\n\\end\{enumerate\}\n\n\\bibliographystyle/, 'a list at the end is closed');
  // no value, unit or source: no column for it
  const m = symbolModel();
  m.blocks[8].rows = m.blocks[8].rows.map((r) => ({ ...r, value: '', unit: '', cite: null }));
  assert.match(X.latex(m).find((f) => f.path === 'paper.tex').content, /\{@\{\}l>\{\\raggedright\\arraybackslash\}X@\{\}\}\n\\toprule\nSymbol & Meaning \\\\/);
});

test('lists and symbols in Pandoc Markdown, HTML and plain text', () => {
  const md = X.pandoc(symbolModel()).find((f) => f.path === 'paper.md').content;
  assert.match(md, /The potential \$V_\\mathrm\{m\}\$ rose by 5 μV ≤ 10° in 3 ms\./);
  assert.match(md, /\n\n- first\n {4}- nested\n- second\n\n1\. one\n1\. two\n\nAfter\.\n\n/);
  assert.match(md, /\| Symbol \| Meaning \| Value \| Unit \| Source \|\n\| --- \| --- \| --- \| --- \| --- \|\n\| \$V_\\mathrm\{m\}\$ \| membrane potential \| −65 \| mV \| \[@smith2020\] \|\n\| \$\\tau_\\mathrm\{E\}\$ \| excitatory time constant \| {2}\| ms \| {2}\|/);
  const html = X.html(symbolModel());
  assert.match(html, /The potential <span class="math"><svg class="vm"\/><\/span> rose/);
  assert.match(html, /<ul><li>first\n<ul><li>nested\n<\/li><\/ul><\/li><li>second\n<\/li><\/ul><ol><li>one\n<\/li><li>two\n<\/li><\/ol>\n<p>After\.<\/p>/, 'the nested list inside its item');
  assert.match(html, /<table class="symbols"><thead><tr><th>Symbol<\/th><th>Meaning<\/th><th>Value<\/th><th>Unit<\/th><th>Source<\/th><\/tr><\/thead><tbody><tr><td><span class="math"><svg class="vm"\/><\/span><\/td><td>membrane potential<\/td><td>−65<\/td><td>mV<\/td><td><span class="cite"><a href="#ref-smith2020">\(Smith, 2020\)<\/a><\/span><\/td><\/tr>/);
  assert.match(html, /<ol><li>again\n<\/li><\/ol>/);
  const s = X.text(symbolModel());
  assert.match(s, /\n• first\n {2}• nested\n• second\n\n1\. one\n2\. two\n\nAfter\.\n/);
  assert.match(s, /Symbol {13}Meaning {19}Value {2}Unit {2}Source\n-{17} {2}-{24} {2}-{5} {2}-{4} {2}-{13}\n\$V_\\mathrm\{m\}\$ {5}membrane potential {8}−65 {4}mV {4}\(Smith, 2020\)\n/);
  assert.match(s, /\n1\. again\n/, 'a new list counts from 1');
});

test('lists and symbols in Word: real lists, each numbered one from 1, the table of symbols, well-formed', () => {
  const files = X.docx(symbolModel());
  const doc = files.find((f) => f.path === 'word/document.xml').content;
  const item = (lvl, num, text) => new RegExp(`<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${num}"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t>`);
  assert.match(doc, item(0, 1, 'first'));
  assert.match(doc, item(1, 2, 'nested'));
  assert.match(doc, item(0, 1, 'second'));
  assert.match(doc, item(0, 3, 'one'));
  assert.match(doc, item(0, 3, 'two'));
  assert.match(doc, item(0, 4, 'again'));
  const numbering = files.find((f) => f.path === 'word/numbering.xml').content;
  assert.match(numbering, /<w:abstractNum w:abstractNumId="0">.*<w:numFmt w:val="bullet"\/>/);
  assert.match(numbering, /<w:abstractNum w:abstractNumId="1">.*<w:numFmt w:val="decimal"\/><w:lvlText w:val="%1\."\/>/);
  assert.match(numbering, /<w:num w:numId="4"><w:abstractNumId w:val="1"\/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"\/>/);
  assert.match(files.find((f) => f.path === 'word/_rels/document.xml.rels').content, /relationships\/numbering" Target="numbering\.xml"/);
  assert.match(files.find((f) => f.path === '[Content_Types].xml').content, /PartName="\/word\/numbering\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.numbering\+xml"/);
  assert.match(doc, /<m:oMath><m:sSub>/, 'the symbol in the text as a Word equation');
  assert.match(doc, /<w:t xml:space="preserve">Symbol<\/w:t>.*<w:t xml:space="preserve">Source<\/w:t>.*<w:t xml:space="preserve">membrane potential<\/w:t>.*<w:t xml:space="preserve">−65<\/w:t>.*\(Smith, 2020\)/);
  wellFormed(files);
  assert.ok(!X.docx(model()).some((f) => f.path === 'word/numbering.xml'), 'no lists, no numbering part');
  const ep = X.epub(symbolModel(), { uuid: 'urn:uuid:test', modified: '2026-01-01T00:00:00Z' });
  assert.match(ep.find((f) => f.path === 'OEBPS/paper.xhtml').content, /<ul><li>first\n<ul><li>nested/);
  wellFormed(ep);
});

// the LaTeX compiles, where there's a TeX to compile it with
const tectonic = (() => { try { execFileSync('which', ['tectonic'], { stdio: 'ignore' }); return true; } catch { return false; } })();
test('lists and symbols: the LaTeX compiles', { skip: !tectonic && 'tectonic is not installed' }, () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'neo-symbols-'));
  try {
    const m = symbolModel();
    m.blocks.push({ type: 'para', runs: [T(Object.values(require('../paper/symbols.js').TEX_CHARS).join(' ') + ' µ −')] });
    for (const f of X.latex(m)) {
      fs.mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true });
      fs.writeFileSync(path.join(dir, f.path), f.base64 ? Buffer.from(f.content, 'base64') : f.content);
    }
    execFileSync('tectonic', ['-X', 'compile', 'paper.tex'], { cwd: dir, stdio: 'ignore' });
    assert.ok(fs.existsSync(path.join(dir, 'paper.pdf')), 'paper.tex compiles');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// a talk: the abstract's moves as the story, a slide to a figure titled with its question
const talkModel = () => {
  const m = model();
  const pic = (name, more) => ({ name, mime: 'image/png', base64: 'AAAA', w: 400, h: 200, ...more });
  m.subtitle = 'A study';
  m.moves = [
    { move: 'status', text: 'Cortex balances excitation and inhibition.' },
    { move: 'problem', text: 'Nobody knows how it holds under load.' },
    { move: 'problem', text: 'Models assume it is fixed.' },
    { move: 'solution', text: 'Tracking both at once would tell.' },
    { move: 'did', text: 'We recorded 200 neurons in mouse V1.' },
    { move: 'found', text: 'Inhibition tracks excitation within 5 ms.' },
    { move: 'impact', text: 'Balance is dynamic, not set.' }
  ];
  m.blocks = [
    { type: 'heading', level: 1, num: '1', id: 'sec-a1', runs: [T('Introduction')] },
    { type: 'para', runs: [T('Words.')] },
    { type: 'heading', level: 1, num: '2', id: 'sec-a2', runs: [T('Materials and methods')] },
    { type: 'heading', level: 2, num: '2.1', id: 'sec-a3', runs: [T('Recordings')] },
    { type: 'heading', level: 2, num: '2.2', id: 'sec-a4', runs: [T('A model of '), { math: 'V_m' }] },
    { type: 'heading', level: 1, num: '3', id: 'sec-a5', runs: [T('Results')] },
    { type: 'heading', level: 2, num: '3.1', id: 'sec-a6', runs: [T('Not a method')] },
    { type: 'figure', id: 'fig-t1', num: '1', ...pic('figure-a.png'),
      caption: [T('Rates rise with load, as in Fig. 2 of '), { cite: [{ id: 'smith2020' }], narrative: true, html: 'Smith (2020)' }, T('. Inhibition follows within 5 ms. Grey: '), { math: '\\pm 1\\sigma' }, T('.')],
      panels: [pic('figure-a.png', { sub: [T('Before')] }), pic('figure-b.png', { sub: [T('After')] }), pic('figure-c.png', { sub: [T('Ratio')] })] },
    { type: 'figure', id: 'fig-t2', num: '2', ...pic('figure-d.png'), caption: [T('Does inhibition track excitation? Yes, at every load.')] }
  ];
  return m;
};
const slideTitles = (md) => [...md.matchAll(/^## (.*)$/gm)].map((x) => x[1]);

test('talk: front matter, the moves in order, a slide to a figure, notes, columns for panels, the figures and a README', () => {
  const files = X.talk(talkModel(), { date: '2026-10-07' });
  const md = files.find((f) => f.path === 'talk.md').content;
  assert.match(md, /^---\ntitle: "Balance & control in 100% of cortex"\nsubtitle: "A study"\nauthor:\n {2}- "Ada Lovelace"\n {2}- "Charles Babbage"\ninstitute: "University of London; University of Cambridge"\ndate: "2026-10-07"\n---\n\n## Why it matters/);
  assert.deepEqual(slideTitles(md), ['Why it matters', 'What we did', 'Figure 1: Rates rise with load, as in Fig. 2 of Smith (2020)', 'Does inhibition track excitation?', 'What we found', 'What it means', 'Thank you']);
  assert.equal(md.split('\n\n---\n\n## ').length, 7, 'a rule before every slide but the first');
  assert.match(md, /## Why it matters\n\nCortex balances excitation and inhibition\.\n\n- Nobody knows how it holds under load\.\n- Models assume it is fixed\.\n- Tracking both at once would tell\.\n\n::: notes\nNext: What we did\n:::/);
  assert.match(md, /## What we did\n\nWe recorded 200 neurons in mouse V1\.\n\n- Recordings\n- A model of \$V_m\$\n\n/, 'the Methods sections, not the Results');
  assert.doesNotMatch(md, /Not a method/);
  assert.match(md, /::: notes\nAsk the question this figure answers, then show the answer: Inhibition follows within 5 ms\.\n\nGrey: \$\\pm 1\\sigma\$\.\n\nNext: Does inhibition track excitation\?\n:::/);
  // the panels in two columns, read across; each panel's words above it
  assert.match(md, /:::: columns\n::: \{\.column width="48%"\}\n\*\*\(a\)\*\* Before\n\n!\[\]\(figures\/figure-a\.png\)\{height=30%\}\n\n\*\*\(c\)\*\* Ratio\n\n!\[\]\(figures\/figure-c\.png\)\{height=30%\}\n:::\n::: \{\.column width="48%"\}\n\*\*\(b\)\*\* After\n\n!\[\]\(figures\/figure-b\.png\)\{height=30%\}\n:::\n::::/);
  // a caption that asks its question is the title as it is
  assert.match(md, /## Does inhibition track excitation\?\n\n!\[\]\(figures\/figure-d\.png\)\{height=70%\}\n\n::: notes\nYes, at every load\.\n\nNext: What we found\n:::/);
  assert.match(md, /## What we found\n\n- Inhibition tracks excitation within 5 ms\./);
  assert.match(md, /## What it means\n\n- Balance is dynamic, not set\./);
  assert.match(md, /## Thank you\n\n\*Balance & control in 100% of cortex\*\n\nada\\@example\.org\n$/);
  assert.doesNotMatch(md, /\[@/, 'citations as set: a talk has no reference list');
  // Marp: the title as a slide, notes as comments, panels in rows
  const marp = files.find((f) => f.path === 'talk-marp.md').content;
  assert.match(marp, /^---\nmarp: true\npaginate: true\ntitle: "Balance & control in 100% of cortex"\nauthor: "Ada Lovelace, Charles Babbage"\n---\n\n# Balance & control in 100% of cortex\n\nA study\n\nAda Lovelace, Charles Babbage\n\nUniversity of London; University of Cambridge\n\n2026-10-07\n\n---\n\n## Why it matters/);
  assert.deepEqual(slideTitles(marp), slideTitles(md));
  assert.match(marp, /!\[w:320\]\(figures\/figure-a\.png\) !\[w:320\]\(figures\/figure-b\.png\)\n\n\*\*\(a\)\*\* Before · \*\*\(b\)\*\* After\n\n!\[w:320\]\(figures\/figure-c\.png\)/);
  assert.match(marp, /<!--\nAsk the question this figure answers, then show the answer: Inhibition follows within 5 ms\./);
  assert.doesNotMatch(marp, /:::/);
  assert.deepEqual(files.filter((f) => f.path.startsWith('figures/')).map((f) => f.path), ['figures/figure-a.png', 'figures/figure-b.png', 'figures/figure-c.png', 'figures/figure-d.png']);
  assert.ok(files.filter((f) => f.path.startsWith('figures/')).every((f) => f.base64));
  assert.match(files.find((f) => f.path === 'README.txt').content, /pandoc talk\.md -o talk\.pptx[\s\S]*marp-cli talk-marp\.md/);
});

test('talk: a caption of one sentence, or none, still asks for its result', () => {
  const m = talkModel();
  m.blocks = [
    { type: 'figure', id: 'fig-u1', num: '1', name: 'figure-u1.png', mime: 'image/png', base64: 'AAAA', caption: [T('Spikes per second.')] },
    { type: 'figure', id: 'fig-u2', num: '2', name: 'figure-u2.png', mime: 'image/png', caption: [] }
  ];
  const md = X.talk(m, { date: 'today' }).find((f) => f.path === 'talk.md').content;
  assert.match(md, /## Figure 1: Spikes per second\n\n!\[\]\(figures\/figure-u1\.png\)\{height=70%\}\n\n::: notes\nAsk the question this figure answers, then show the answer: its one main result\./);
  assert.match(md, /## Figure 2\n\n::: notes\n/, 'no picture yet: no broken link');
});

test('talk without moves: the abstract opens, the paper\'s sections say what comes', () => {
  const m = talkModel();
  delete m.moves;
  const md = X.talk(m, { date: 'today' }).find((f) => f.path === 'talk.md').content;
  assert.deepEqual(slideTitles(md), ['In brief', 'Outline', 'What we did', 'Figure 1: Rates rise with load, as in Fig. 2 of Smith (2020)', 'Does inhibition track excitation?', 'Thank you']);
  assert.match(md, /## In brief\n\nWe ask \$x_1\$\.\n/);
  assert.match(md, /## Outline\n\n- Introduction\n- Materials and methods\n- Results\n/);
  assert.match(md, /## What we did\n\n- Recordings\n- A model of \$V_m\$\n/);
  // nothing to say about a part: no slide for it
  const bare = X.talk({ ...model(), abstract: [], blocks: [], moves: [{ move: 'found', text: 'It works.' }] }, { date: 'today' }).find((f) => f.path === 'talk.md').content;
  assert.deepEqual(slideTitles(bare), ['What we found', 'Thank you']);
});

// Pandoc makes the slides, where it's installed
const pandocBin = (() => { try { execFileSync('which', ['pandoc'], { stdio: 'ignore' }); return true; } catch { return false; } })();
test('talk: Pandoc makes PowerPoint and Beamer slides of it', { skip: !pandocBin && 'pandoc is not installed' }, () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'neo-talk-'));
  try {
    // a real picture: a 1 × 1 PNG
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
    const m = talkModel();
    for (const b of m.blocks.filter((x) => x.type === 'figure')) for (const p of [b, ...(b.panels || [])]) p.base64 = png;
    for (const f of X.talk(m, { date: '2026-10-07' })) {
      fs.mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true });
      fs.writeFileSync(path.join(dir, f.path), f.base64 ? Buffer.from(f.content, 'base64') : f.content);
    }
    execFileSync('pandoc', ['talk.md', '-o', 'talk.pptx'], { cwd: dir, stdio: 'ignore' });
    assert.ok(fs.statSync(path.join(dir, 'talk.pptx')).size > 0, 'talk.pptx');
    const beamer = execFileSync('pandoc', ['talk.md', '-t', 'beamer'], { cwd: dir }).toString();
    assert.equal((beamer.match(/\\begin\{frame\}/g) || []).length, 7, 'a frame a slide, and none for the rules between them');
    assert.match(beamer, /\\begin\{columns\}/);
    assert.match(beamer, /\\note\{/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// a venue's template, imported with the paper: its files, its main .tex filled
const NT = require('../paper/template.js');
const { readdirSync, readFileSync } = require('node:fs');
const TEMPLATES = require('node:path').join(__dirname, 'fixtures', 'templates');
const templateFiles = (kind, folder = '') => readdirSync(`${TEMPLATES}/${kind}`).sort()
  .map((n) => ({ path: folder + n, text: readFileSync(`${TEMPLATES}/${kind}/${n}`, 'utf8') }));
const withTemplate = (m, kind, extra = [], folder = '') => {
  const files = [...templateFiles(kind, folder), ...extra];
  return { ...m, template: { info: NT.read(files), files } };
};

test('LaTeX in a venue\'s template: its files, the filled main .tex, the references and figures; nothing escapes', () => {
  const m = withTemplate(model(), 'iclr', [
    { path: 'T/logo.png', base64: 'AAAA' },
    { path: 'T/../evil.sty', text: 'x' },
    { path: '/abs.sty', text: 'x' },
    { path: 'T/references.bib', text: '@misc{theirs}' },
    { path: 'T/figures/figure-cd34.png', base64: 'BBBB' },
    { path: 'T/README.txt', text: 'theirs' }
  ], 'T/');
  const files = X.latex(m);
  assert.deepEqual(files.map((f) => f.path), ['iclr2025_conference.bib', 'iclr2025_conference.sty', 'math_commands.tex', 'logo.png',
    'iclr2025_conference.tex', 'references.bib', 'README.txt', 'figures/figure-cd34.png']);
  assert.ok(!files.some((f) => f.path === 'paper.tex'));
  assert.deepEqual(files.find((f) => f.path === 'logo.png'), { path: 'logo.png', content: 'AAAA', base64: true });
  assert.equal(files.find((f) => f.path === 'references.bib').content, model().bibtex, 'NEO\'s references, not the template\'s');
  assert.equal(files.find((f) => f.path === 'figures/figure-cd34.png').content, 'AAAA');
  assert.equal(files.find((f) => f.path === 'math_commands.tex').content, templateFiles('iclr').find((f) => f.path === 'math_commands.tex').text);
  const tex = files.find((f) => f.path === 'iclr2025_conference.tex').content;
  assert.match(tex, /^% Filled by NEO from ICLR 2025's template/);
  assert.match(tex, /\\title\{Balance \\& control in 100\\% of cortex\}/);
  assert.match(tex, /\\texttt\{ada@example\.org\}\n {2}\\And\n {2}Charles Babbage \\\\\n {2}University of Cambridge/);
  assert.match(tex, /\\iclrfinalcopy % the named version/);
  assert.match(tex, /\\begin\{abstract\}\nWe ask \\\(x_1\\\)\.\n\\end\{abstract\}\n\n\\section\{Introduction\}\\label\{sec:ab12\}/);
  assert.match(tex, /Costs \\\$5 \\& rise\\_\\emph\{fast\} \\citep\[p\.~4\]\{smith2020\}/, 'the same body as NEO\'s own preamble takes');
  assert.match(tex, /\\@ifpackageloaded\{graphicx\}\{\}\{\\usepackage\{graphicx\}\}/);
  assert.match(tex, /\\bibliographystyle\{plainnat\}\n\\bibliography\{references\}\n\n\\end\{document\}\n$/);
  assert.match(files.find((f) => f.path === 'README.txt').content, /ICLR 2025's own template, filled by NEO[\s\S]*example text[\s\S]*pdflatex iclr2025_conference, bibtex iclr2025_conference/);
  // anonymous for review: the window says so, the template hides the names
  const anon = X.latex({ ...m, anonymous: true }).find((f) => f.path === 'iclr2025_conference.tex').content;
  assert.doesNotMatch(anon, /^\\iclrfinalcopy/m);
  assert.doesNotMatch(anon, /Lovelace/);
  // the body is NEO's own, under either preamble
  const own = X.latex(model()).find((f) => f.path === 'paper.tex').content;
  const body = (s) => s.slice(s.indexOf('\\section{Introduction}'), s.indexOf('\\bibliographystyle'));
  assert.equal(body(tex), body(own));
  // a template that isn't one: NEO's own preamble
  assert.ok(X.latex({ ...model(), template: { info: NT.read([]), files: [] } }).some((f) => f.path === 'paper.tex'));
});

test('LaTeX in each venue\'s template compiles, anonymous and named', { skip: !tectonic && 'tectonic is not installed' }, () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  for (const kind of ['neurips', 'icml', 'iclr', 'acl']) {
    for (const anonymous of [true, false]) {
      const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), `neo-${kind}-`));
      try {
        // the lot: symbols, lists, citations, an equation, a table, a figure and one of panels
        const m = symbolModel();
        m.blocks.push(...model().blocks.slice(1), { type: 'figure', id: 'fig-p4', num: '2', caption: [T('Both')], name: 'figure-d.png', mime: 'image/png',
          panels: [{ name: 'figure-d.png', mime: 'image/png', sub: [T('Before')] }, { name: 'figure-e.png', mime: 'image/png', sub: [T('After')] }] });
        for (const b of m.blocks) if (b.type === 'figure') for (const p of [b, ...(b.panels || [])]) p.base64 = png;
        const files = X.latex({ ...withTemplate(m, kind), anonymous });
        for (const f of files) {
          fs.mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true });
          fs.writeFileSync(path.join(dir, f.path), f.base64 ? Buffer.from(f.content, 'base64') : f.content);
        }
        const main = NT.layout(NT.read(templateFiles(kind)), templateFiles(kind)).main;
        execFileSync('tectonic', ['-X', 'compile', main], { cwd: dir, stdio: 'ignore' });
        assert.ok(fs.existsSync(path.join(dir, main.replace(/\.tex$/, '.pdf'))), `${kind}${anonymous ? ', anonymous,' : ''} compiles`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
});
