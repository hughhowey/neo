'use strict';

// A venue's LaTeX template read and filled (paper/template.js). The
// fixtures are skeletons of the NeurIPS, ICML, ICLR and ACL templates with
// stand-in style files: none of the venues' own files are in the repo.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const NT = require('../paper/template.js');

const FIXTURES = path.join(__dirname, 'fixtures', 'templates');
// a fixture as the window hands it over: [{ path, text }], under a folder if given
const load = (kind, folder = '') => fs.readdirSync(path.join(FIXTURES, kind)).sort()
  .map((n) => ({ path: folder + n, text: fs.readFileSync(path.join(FIXTURES, kind, n), 'utf8') }));

// the paper, as NeoPaperExport hands it over: TeX already
const parts = (more = {}) => ({
  title: 'Balance \\& control', subtitle: '',
  authors: [
    { name: 'Ada Lovelace', affiliations: [0], email: 'ada@example.org', corresponding: true },
    { name: 'Charles Babbage', affiliations: [1] }
  ],
  affiliations: ['University of London', 'University of Cambridge'],
  abstract: 'We ask \\(x_1\\).',
  keywords: ['cortex', 'inhibition'],
  preamble: ['\\DeclareRobustCommand{\\Vm}{\\ensuremath{V_\\mathrm{m}}}'],
  body: '\\section{Introduction}\\label{sec:ab12}\n\nAs \\citet{smith2020} found.\n',
  needs: { graphicx: true, booktabs: true },
  numeric: false,
  ...more
});
const fillOf = (kind, opts, more) => { const files = load(kind); return NT.fill(NT.read(files), files, parts(more), opts); };
const preamble = (tex) => tex.slice(0, tex.indexOf('\\begin{document}'));

test('read: the NeurIPS template', () => {
  const t = NT.read(load('neurips'));
  assert.equal(t.ok, true);
  assert.equal(t.main, 'neurips_2025.tex');
  assert.equal(t.name, 'NeurIPS 2025');
  assert.equal(t.kind, 'neurips');
  assert.equal(t.cls, 'article');
  assert.equal(t.pkg, 'neurips_2025');
  assert.equal(t.pkgOpts, '');
  assert.equal(t.bst, null, 'its references are written by hand');
  assert.equal(t.natbib, true, 'the style loads natbib');
  assert.equal(t.columns, 1);
  assert.equal(t.fontSize, '10pt');
  assert.equal(t.paper, 'letter');
  assert.deepEqual(t.review, { via: 'option', anonymous: '', named: 'preprint' });
  assert.equal(t.pages, 9, '"up to {\\bf nine} pages"');
  assert.equal(t.look, 'neurips');
});

test('read: the ICML template', () => {
  const t = NT.read(load('icml'));
  assert.equal(t.main, 'example_paper.tex');
  assert.equal(t.name, 'ICML 2025');
  assert.equal(t.kind, 'icml');
  assert.equal(t.pkg, 'icml2025');
  assert.equal(t.bst, 'plainnat');
  assert.equal(t.natbib, true);
  assert.equal(t.columns, 2, 'the style sets \\twocolumn');
  assert.deepEqual(t.review, { via: 'option', anonymous: '', named: 'accepted' });
  assert.equal(t.pages, 8);
  assert.equal(t.look, 'icml');
});

test('read: the ICLR template, in a folder, with the Mac\'s zip litter', () => {
  const files = [...load('iclr', 'ICLR 2025 Template/'), { path: '__MACOSX/ICLR 2025 Template/._iclr2025_conference.tex', text: '\\documentclass{x}\\begin{document}' }, { path: 'ICLR 2025 Template/.DS_Store' }];
  const t = NT.read(files);
  assert.equal(t.main, 'ICLR 2025 Template/iclr2025_conference.tex');
  assert.equal(t.name, 'ICLR 2025');
  assert.equal(t.kind, 'iclr');
  assert.equal(t.pkg, 'iclr2025_conference', 'not times, in the same \\usepackage');
  assert.equal(t.bst, 'plainnat');
  assert.equal(t.natbib, true);
  assert.equal(t.columns, 1);
  assert.deepEqual(t.review, { via: 'command', named: '\\iclrfinalcopy' });
  assert.equal(t.pages, 10, '"a strict upper limit of 10 pages"');
});

test('read: the ACL template, its LuaLaTeX version passed over', () => {
  const t = NT.read(load('acl'));
  assert.equal(t.main, 'acl_latex.tex');
  assert.equal(t.name, 'ACL');
  assert.equal(t.kind, 'acl');
  assert.equal(t.clsOpts, '11pt');
  assert.equal(t.pkgOpts, 'review');
  assert.equal(t.bst, 'plainnat', 'set by the style');
  assert.equal(t.fontSize, '11pt');
  assert.equal(t.paper, 'a4');
  assert.equal(t.columns, 2);
  assert.deepEqual(t.review, { via: 'option', anonymous: 'review', named: 'final' });
  assert.equal(t.pages, null, 'the main .tex states none: never guessed');
});

test('read: another venue\'s style, a bare article, two documents, and zips that are no template', () => {
  const tmlr = [
    { path: 'main.tex', text: '\\documentclass[10pt]{article}\n\\usepackage{tmlr}\n\\usepackage{amsmath}\n\\title{T}\n\\begin{document}\n\\maketitle\nSubmissions are limited to 12 pages of main text.\n\\bibliography{main}\n\\bibliographystyle{tmlr}\n\\end{document}\n' },
    { path: 'tmlr.sty', text: '\\DeclareOption{accepted}{\\def\\@accepted{}}\n\\DeclareOption{preprint}{}\n\\ProcessOptions\\relax\n\\RequirePackage[round]{natbib}\n' },
    { path: 'tmlr.bst', text: 'FUNCTION {output.bibitem} { "\\bibitem[" write$ }' },
    { path: 'logo.pdf', base64: 'JVBERi0=' }
  ];
  const t = NT.read(tmlr);
  assert.equal(t.kind, 'generic');
  assert.equal(t.name, 'TMLR');
  assert.equal(t.pkg, 'tmlr');
  assert.equal(t.bst, 'tmlr');
  assert.equal(t.natbib, true);
  assert.deepEqual(t.review, { via: 'option', anonymous: '', named: 'accepted' }, 'what its options say');
  assert.equal(t.pages, 12);
  assert.equal(t.look, null);
  // no style of its own: named for its file, no review switch
  const bare = NT.read([{ path: 'my_workshop.tex', text: '\\documentclass[a4paper,twocolumn,11pt]{article}\n\\begin{document}\nHi.\n\\end{document}' }]);
  assert.equal(bare.name, 'My workshop');
  assert.equal(bare.review, null);
  assert.equal(bare.columns, 2);
  assert.equal(bare.fontSize, '11pt');
  assert.equal(bare.paper, 'a4');
  // two documents: the one that loads the zip's style
  const two = NT.read([
    { path: 'aaa.tex', text: '\\documentclass{article}\n\\begin{document}\nA sample.\n\\end{document}' },
    { path: 'zzz_long_name.tex', text: '\\documentclass{article}\n\\usepackage[final]{venue}\n\\begin{document}\n\\input{intro}\n\\end{document}' },
    { path: 'intro.tex', text: '\\section{Intro}' },
    { path: 'venue.sty', text: '\\DeclareOption{final}{}\\DeclareOption{review}{}' }
  ]);
  assert.equal(two.main, 'zzz_long_name.tex');
  assert.deepEqual(two.review, { via: 'option', anonymous: 'review', named: 'final' });
  // none that loads it: a usual name, then the shortest path
  assert.equal(NT.read([
    { path: 'a/b/main.tex', text: '\\documentclass{article}\\begin{document}\\end{document}' },
    { path: 'x.tex', text: '\\documentclass{article}\\begin{document}\\end{document}' }
  ]).main, 'a/b/main.tex');
  // commented out is not there
  const none = NT.read([{ path: 'a.tex', text: '% \\documentclass{article}\n\\begin{document}\n' }, { path: 'b.sty', text: '' }]);
  assert.equal(none.ok, false);
  assert.equal(none.error, NT.NO_MAIN);
  assert.equal(NT.read([]).error, NT.NO_FILES);
  assert.deepEqual(NT.ERRORS, [NT.NO_FILES, NT.NO_MAIN]);
  assert.deepEqual(NT.KINDS, ['neurips', 'icml', 'iclr', 'acl', 'generic']);
});

test('names and page limits', () => {
  const names = { neurips_2025: 'NeurIPS 2025', nips_2017: 'NeurIPS 2017', icml2025: 'ICML 2025', iclr2025_conference: 'ICLR 2025', acl: 'ACL', acl_natbib: 'ACL', aaai25: 'AAAI 2025', cvpr: 'CVPR', naacl2019: 'NAACL 2019', colm2024_conference: 'COLM 2024', IEEEtran: 'IEEEtran' };
  for (const [id, name] of Object.entries(names)) assert.equal(NT.venueName(id), name, id);
  const limits = {
    'Papers are limited to 8 pages.': 8,
    'up to eight (8) pages of content': 8,
    'The page limit is 4, plus references.': 4,
    'The main body must be at most $8$ pages long.': 8,
    'no more than ten pages': 10,
    'A 6-page limit applies.': 6,
    '% Submissions: 9 pages of content, excluding references': 9,
    'See page 3 of the guide.': null,
    'One additional page is allowed.': null
  };
  for (const [s, n] of Object.entries(limits)) assert.equal(NT.pageLimit(s), n, s);
});

test('fill NeurIPS: the title block before \\begin{document}, \\And, the review switch both ways', () => {
  const named = fillOf('neurips');
  assert.match(named, /^% Filled by NEO from NeurIPS 2025's template: its preamble kept, its example text left out\.\n\\documentclass\{article\}/);
  assert.match(named, /\n\\usepackage\[preprint\]\{neurips_2025\}\n/);
  assert.doesNotMatch(preamble(named), /Formatting Instructions|Hippocampus/, 'the template\'s title and authors are gone');
  assert.match(named, /\\title\{Balance \\& control\}\n\n\\author\{%\n {2}Ada Lovelace \\\\\n {2}University of London \\\\\n {2}\\texttt\{ada@example\.org\}\n {2}\\And\n {2}Charles Babbage \\\\\n {2}University of Cambridge\n\}\n\n\\begin\{document\}\n\n\\maketitle\n\n\\begin\{abstract\}\nWe ask \\\(x_1\\\)\.\n\\end\{abstract\}\n\n\\section\{Introduction\}/);
  assert.match(named, /\\usepackage\{microtype\} {6}% microtypography/, 'the rest of the preamble as written');
  assert.match(named, /% used to separate the names and addresses of multiple authors: \\And and \\AND\./, 'its comments too');
  assert.doesNotMatch(named, /Submission of papers|Alexander/, 'the example text is left out');
  assert.match(named, /\\makeatletter\n\\@ifpackageloaded\{amsmath\}\{\}\{\\usepackage\{amsmath\}\}\n/);
  assert.match(named, /\\@ifpackageloaded\{graphicx\}\{\}\{\\usepackage\{graphicx\}\}\n\\@ifpackageloaded\{booktabs\}\{\}\{\\usepackage\{booktabs\}\}\n\\@ifpackageloaded\{natbib\}\{\}\{\\usepackage\[round\]\{natbib\}\}\n\\makeatother/);
  assert.doesNotMatch(named, /\{subcaption\}|\{wrapfig\}/, 'only what the paper needs');
  assert.match(named, /% The paper's symbols\n\\DeclareRobustCommand\{\\Vm\}/);
  assert.match(named, /As \\citet\{smith2020\} found\.\n\n\\bibliographystyle\{plainnat\}\n\\bibliography\{references\}\n\n\\end\{document\}\n$/);
  const anonymous = fillOf('neurips', { anonymous: true });
  assert.match(anonymous, /\n\\usepackage\{neurips_2025\}\n/);
  assert.match(anonymous, /\\author\{%\n {2}Anonymous Author\(s\)\n\}/);
  assert.doesNotMatch(anonymous, /Lovelace|London|ada@/);
  // camera-ready: the template's own [final] stays; its track option always does
  const files = load('neurips').map((f) => (f.path === 'neurips_2025.tex' ? { ...f, text: f.text.replace('\\usepackage{neurips_2025}', '\\usepackage[main, final]{neurips_2025}') } : f));
  const t = NT.read(files);
  assert.equal(t.review.named, 'final');
  assert.match(NT.fill(t, files, parts()), /\n\\usepackage\[main,final\]\{neurips_2025\}\n/);
  assert.match(NT.fill(t, files, parts(), { anonymous: true }), /\n\\usepackage\[main\]\{neurips_2025\}\n/);
  // numbered citations: natbib's numbers, where NEO loads it
  assert.match(fillOf('neurips', {}, { numeric: true }), /\\usepackage\[numbers,square,sort&compress\]\{natbib\}[\s\S]*\\bibliographystyle\{unsrtnat\}/);
});

test('fill ICML: the header in \\twocolumn[…], affiliations by label, its symbols kept, anonymous or accepted', () => {
  const named = fillOf('icml', {}, { needs: { graphicx: true, subcaption: true } });
  assert.match(named, /\n\\usepackage\[accepted\]\{icml2025\}\n/);
  assert.doesNotMatch(named, /\\icmltitlerunning\{/, 'the running title was the template\'s');
  assert.match(named, /\\begin\{document\}\n\n\\twocolumn\[\n\\icmltitle\{Balance \\& control\}\n\n\\icmlsetsymbol\{equal\}\{\*\}\n\n\\begin\{icmlauthorlist\}\n\\icmlauthor\{Ada Lovelace\}\{aff1\}\n\\icmlauthor\{Charles Babbage\}\{aff2\}\n\\end\{icmlauthorlist\}\n\n\\icmlaffiliation\{aff1\}\{University of London\}\n\\icmlaffiliation\{aff2\}\{University of Cambridge\}\n\n\\icmlcorrespondingauthor\{Ada Lovelace\}\{ada@example\.org\}\n\n\\icmlkeywords\{cortex, inhibition\}\n\n\\vskip 0\.3in\n\]\n\n\\printAffiliationsAndNotice\{\}\n\n\\begin\{abstract\}/);
  assert.doesNotMatch(named, /\\maketitle/);
  assert.match(named, /\n% \\usepackage\{subfigure\} \(left out by NEO: the paper's panels use subcaption\)\n/);
  assert.match(named, /\\@ifpackageloaded\{subcaption\}\{\}\{\\usepackage\{subcaption\}\}/);
  assert.equal((named.match(/\\bibliographystyle\{plainnat\}/g) || []).length, 1, 'the template\'s .bst, once');
  assert.doesNotMatch(named, /Firstname|Electronic Submission|\\appendix|example_paper\}/);
  const anonymous = fillOf('icml', { anonymous: true });
  assert.match(anonymous, /\n\\usepackage\{icml2025\}\n/);
  assert.match(anonymous, /\\begin\{icmlauthorlist\}\n\\icmlauthor\{Anonymous Author\(s\)\}\{anon\}\n\\end\{icmlauthorlist\}\n\n\\icmlaffiliation\{anon\}\{Anonymous Institution\}\n/);
  assert.doesNotMatch(anonymous, /Lovelace|London|icmlcorrespondingauthor/);
  assert.match(anonymous, /\n\\usepackage\{subfigure\}\n/, 'no panels: the template\'s packages as they were');
});

test('fill ICLR: \\iclrfinalcopy added or taken out, math_commands kept', () => {
  const named = fillOf('iclr');
  assert.match(named, /\\usepackage\{iclr2025_conference,times\}\n\n% Optional math commands[^\n]*\n\\input\{math_commands\.tex\}/);
  assert.match(named, /%\\iclrfinalcopy % Uncomment for camera-ready version, but NOT for submission\.\n\\iclrfinalcopy % the named version\n/);
  assert.match(named, /\\author\{%\n {2}Ada Lovelace \\\\\n {2}University of London \\\\\n {2}\\texttt\{ada@example\.org\}\n {2}\\And\n/);
  assert.doesNotMatch(preamble(named), /Hippocampus|Formatting Instructions/);
  const anonymous = fillOf('iclr', { anonymous: true });
  assert.doesNotMatch(anonymous, /^\\iclrfinalcopy/m);
  // one the template left in is taken out
  const files = load('iclr').map((f) => (f.path === 'iclr2025_conference.tex' ? { ...f, text: f.text.replace('%\\iclrfinalcopy', '\\iclrfinalcopy') } : f));
  assert.doesNotMatch(NT.fill(NT.read(files), files, parts(), { anonymous: true }), /^\\iclrfinalcopy/m);
  assert.equal((NT.fill(NT.read(files), files, parts()).match(/^\\iclrfinalcopy/gm) || []).length, 1);
});

test('fill ACL: [review] and [final], no second \\bibliographystyle', () => {
  const named = fillOf('acl');
  assert.match(named, /\n\\usepackage\[final\]\{acl\}\n/);
  assert.match(named, /\\texttt\{ada@example\.org\}\n {2}\\And\n {2}Charles Babbage/);
  assert.doesNotMatch(named, /\\bibliographystyle/, 'the style sets it');
  assert.match(named, /\\bibliography\{references\}/);
  assert.doesNotMatch(named, /\{custom\}|Limitations|First Author/);
  assert.match(fillOf('acl', { anonymous: true }), /\n\\usepackage\[review\]\{acl\}\n/);
});

test('fill another venue: \\and, \\date{}, comments and definitions left alone', () => {
  const files = [{ path: 'w.tex', text: [
    '\\documentclass{article}',
    '\\usepackage{workshop}',
    '% \\title{Not this one}',
    '\\renewcommand{\\author}[1]{\\gdef\\@author{#1}}',
    '\\title[Short]{The example {title}} % the title',
    '\\author{A \\and B}',
    '\\date{\\today}',
    '\\bibliographystyle{abbrv}',
    '\\begin{document}',
    '\\maketitle',
    'Example text.',
    '\\end{document}'
  ].join('\n') }, { path: 'workshop.sty', text: '' }];
  const t = NT.read(files);
  assert.equal(t.kind, 'generic');
  assert.equal(t.name, 'Workshop', 'a long word is a name, not an acronym');
  const tex = NT.fill(t, files, parts());
  assert.match(tex, /% \\title\{Not this one\}/);
  assert.match(tex, /\\renewcommand\{\\author\}\[1\]\{\\gdef\\@author\{#1\}\}/);
  assert.doesNotMatch(tex, /example \{title\}|A \\and B|\\today/);
  assert.match(tex, /\\author\{%\n {2}Ada Lovelace \\\\\n {2}University of London \\\\\n {2}\\texttt\{ada@example\.org\}\n {2}\\and\n {2}Charles Babbage/);
  assert.match(tex, /\n\\date\{\}\n/);
  // abbrv sets numbers: NEO's natbib in numbers, and no second style
  assert.match(tex, /\\usepackage\[numbers,square,sort&compress\]\{natbib\}/);
  assert.equal((tex.match(/\\bibliographystyle/g) || []).length, 1);
  assert.doesNotMatch(tex, /Example text/);
});

test('layout: paths from the main .tex\'s folder; litter, escapes and outsiders left out', () => {
  const files = [
    ...load('iclr', 'T/'),
    { path: 'T/logo.png', base64: 'AAAA' },
    { path: 'T/../evil.sty', text: 'x' },
    { path: '/etc/passwd', text: 'x' },
    { path: 'elsewhere/x.sty', text: 'x' },
    { path: '__MACOSX/T/._logo.png', base64: 'AAAA' }
  ];
  const { main, files: out } = NT.layout(NT.read(files), files);
  assert.equal(main, 'iclr2025_conference.tex');
  assert.deepEqual(out.map((f) => f.path), ['iclr2025_conference.bib', 'iclr2025_conference.sty', 'math_commands.tex', 'logo.png']);
  assert.deepEqual(out.find((f) => f.path === 'logo.png'), { path: 'logo.png', base64: 'AAAA' });
  assert.equal(NT.stripComments('a % b\n\\% c % d\n'), 'a\n\\% c\n');
});
