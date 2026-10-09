/* NEO — papers
 *
 * A paper is a book whose book.json says "format": "paper" (right-click a
 * shelf's + for New Paper). It is written the way NEO writes everything —
 * one page, nothing in the way — with what an academic manuscript needs on
 * top: a title page with authors, abstract and keywords; numbered section
 * headings (# , ## , ### or ⌥⌘1–3); citations typed with @ and set in a
 * real citation style; $maths$; figures dropped or pasted in; tables pasted
 * from a spreadsheet; cross-references that keep their numbers; and the
 * reference list, made from what is cited.
 *
 * In the chapter's HTML (plain, readable, saved as it is):
 *   <p class="h1|h2|h3" data-id="sec-…">Heading</p>
 *   <span class="cite" contenteditable="false" data-cite='[{"id":"smith2020","locator":"4"}]'>(Smith, 2020, p. 4)</span>
 *   <span class="xref" contenteditable="false" data-ref="fig-…">Figure 2</span>
 *   <span class="math" contenteditable="false">E = mc^2</span>          (TeX)
 *   <p class="eq" contenteditable="false" data-id="eq-…">\int_0^1 f</p>  (TeX)
 *   <figure class="fig" contenteditable="false" data-id="fig-…" data-src="figure-….png"><img alt="…"><figcaption contenteditable="true">…</figcaption></figure>
 *   <figure class="tbl" contenteditable="false" data-id="tab-…"><figcaption contenteditable="true">…</figcaption><table>…</table></figure>
 * Numbers, the drawn maths (in a shadow root, which is never serialized)
 * and a figure's picture are put on at runtime and never saved.
 *
 * The references live in references.json (CSL JSON); see paper/references.js
 * for reading and writing them, paper/cite.js for setting them in a style,
 * paper/library.js for the References tab and paper/export.js for the ways
 * out. Loaded after app.js, whose globals it uses.
 */

'use strict';

const PAPER_SEL = '.cite, .xref, .math, .sym, .eq, .symtab, .fig, .tbl, .h1, .h2, .h3, .li';
// the pieces in a line that the caret steps over whole
const ATOMS = '.cite, .xref, .math, .sym';
const paper = {
  refs: [],            // the paper's references (CSL JSON), as on disk
  refsSaved: '',       // what references.json held when last read or written
  symbols: [],         // the paper's own notation (symbols.json): see Symbols
  symbolsSaved: '[]',  // what symbols.json held when last read or written
  proc: null,          // the citeproc processor for the current style
  procStyle: null,     // …and which style it was built for
  styleXml: {},        // style XML by id ('custom' is the paper's style.csl)
  locales: null,
  figures: new Map(),  // figure file name → Promise of a blob: URL
  bibliography: null,  // the last reference list, for exports
  citeText: new Map(), // rendered citation by node, for exports
  linkedStamp: null,   // the linked reference file's last-modified time…
  linkedPath: null,    // …and where it is, on this computer (main.js keeps it)
  ready: null          // the scripts a paper needs, loading
};

const paperMeta = () => {
  book.paper = book.paper || {};
  return book.paper;
};
const paperId = (prefix) => prefix + '-' + Math.random().toString(36).slice(2, 10);
// An id for something that came without one (a chapter written elsewhere),
// from what it says and where it stands: every device that opens the paper
// gives it the same one, so none of them saves a chapter the others didn't
function paperIdFor(prefix, text, at) {
  let h = 2166136261;
  for (const c of prefix + '\u0000' + text + '\u0000' + at) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return prefix + '-' + (h >>> 0).toString(36);
}
const paperBodies = () => [...document.querySelectorAll('#chapters .chapter-body')];
const paperHeadings = () => [...document.querySelectorAll('#chapters p.h1, #chapters p.h2, #chapters p.h3')];

/* ------------------------------------------------------------------ */
/*  The scripts a paper needs, fetched the first time one opens       */
/* ------------------------------------------------------------------ */

function paperScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Couldn’t load ' + src));
    document.head.appendChild(s);
  });
}
// node_modules on the desktop; Pocket carries copies (scripts/pocket-www.js)
const PAPER_VENDOR = IS_POCKET
  ? { mathjax: 'paper/vendor/tex-svg-full.js', citeproc: 'paper/vendor/citeproc.js' }
  : { mathjax: 'node_modules/mathjax-full/es5/tex-svg-full.js', citeproc: 'node_modules/citeproc/citeproc_commonjs.js' };

function paperLoad() {
  if (paper.ready) return paper.ready;
  window.MathJax = {
    startup: { typeset: false },
    // no \href, \class, \style or \cssId (MathJax's html extension), and
    // no \require or autoload to bring it back: maths is drawn, never a link
    tex: { packages: { '[+]': ['ams', 'newcommand', 'boldsymbol', 'mathtools', 'physics', 'cancel', 'color', 'braket'], '[-]': ['html', 'require', 'autoload'] } },
    svg: { fontCache: 'none' },
    options: { enableMenu: false }
  };
  // citeproc is a CommonJS file: it ends by setting module.exports, so it
  // gets a module to set while it loads, and the global CSL stays behind
  const citeproc = (async () => {
    window.module = { exports: {} };
    try { await paperScript(PAPER_VENDOR.citeproc); } finally { delete window.module; }
  })();
  const mathjax = paperScript(PAPER_VENDOR.mathjax).then(() => window.MathJax.startup.promise);
  paper.ready = Promise.all([citeproc, mathjax]).catch((err) => {
    window.neo.logError('paper load: ' + (err && err.stack || err));
    paper.ready = null;
    throw err;
  });
  return paper.ready;
}
const mathReady = () => !!(window.MathJax && window.MathJax.tex2svg);

async function paperAsset(name) {
  if (window.neo.paperAsset) return window.neo.paperAsset(name);
  const res = await fetch('paper/csl/' + name);
  if (!res.ok) throw new Error(t('Couldn’t read {file}', { file: name }));
  return res.text();
}

/* ------------------------------------------------------------------ */
/*  Opening a paper                                                   */
/* ------------------------------------------------------------------ */

// From openBook, before the chapters are drawn
async function paperOpen() {
  if (!isPaper()) return;
  const m = paperMeta();
  if (!m.style) m.style = NeoCite.DEFAULT_STYLE;
  paper.refs = await window.neo.readJSON(book.id, 'references', []);
  if (!Array.isArray(paper.refs)) paper.refs = [];
  paper.refsSaved = JSON.stringify(paper.refs);
  paper.symbols = await window.neo.readJSON(book.id, 'symbols', []);
  if (!Array.isArray(paper.symbols)) paper.symbols = [];
  paper.symbolsSaved = JSON.stringify(paper.symbols);
  paper.proc = null;
  paper.procStyle = null;
  editingOn = false;
  skimOn = false;
  editingLeft.clear();
  CSS.highlights.delete('neo-edit');
  CSS.highlights.delete('neo-skim');
  paper.citeText = new Map();
  paper.linkedStamp = null;
  paper.linkedPath = null;
  paper.previewing = null;
  // a paper's own pictures and style are its own: nothing carries over from the last one
  for (const url of paper.figures.values()) url.then((u) => { if (u) URL.revokeObjectURL(u); });
  paper.figures = new Map();
  delete paper.styleXml.custom;
  paper.bibliography = null;
  closePaperPop();
  pickerClose();
  paperLoad().then(() => { if (isPaper()) { paperHydrate(); paperCiteNow(); } }).catch(() => {
    toast(t('The maths and citation styles didn’t load. Restart NEO to try again.'), 8000);
  });
  paperRefreshLinked();
}

// The look of the editor for a paper, or back to a book's (from openBook,
// beside spEditorMode)
function paperEditorMode() {
  const on = isPaper();
  closePaperPop();
  pickerClose();
  $('#paper').classList.toggle('paper-mode', on);
  $('#editor-view').classList.toggle('paper-mode', on);
  $('#nav-pane').classList.toggle('paper', on);
  document.body.classList.toggle('paper-double', on && !!paperMeta().double);
  document.body.classList.toggle('paper-unnumbered', on && paperMeta().numbered === false);
  const tabM = $('.tab[data-tab="manuscript"]');
  if (tabM && on) setText(tabM, t('Paper'));
  const tabO = $('.tab[data-tab="outline"]');
  if (tabO) tabO.hidden = on; // a paper's outline is its headings, in the pane
  paperTab(on);
  paperTitlePage(on);
  paperRefsBlock(on);
  if (on) setText($('#nav-head span'), t('Sections'));
  // the words the page draws itself, in the writer's language
  const words = { '--paper-fig-word': t('Figure'), '--paper-tab-word': t('Table'), '--paper-caption-ph': t('Add a caption') };
  for (const [k, v] of Object.entries(words)) $('#paper').style.setProperty(k, JSON.stringify(v));
  const add = $('#nav-add');
  if (add && on) add.hidden = true;
  paperReportState();
}

// The References tab stands where the Outline does
function paperTab(on) {
  let tab = $('.tab[data-tab="references"]');
  if (!tab && on) {
    tab = document.createElement('div');
    tab.className = 'tab';
    tab.setAttribute('role', 'tab');
    tab.tabIndex = 0;
    tab.dataset.tab = 'references';
    tab.setAttribute('aria-selected', 'false');
    $('.tab[data-tab="outline"]').after(tab);
    tab.addEventListener('click', () => switchTab('references'));
    tab.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab('references'); } });
  }
  if (tab) {
    tab.hidden = !on;
    setText(tab, t('References'));
  }
}

// From renderChapters, once the bodies are on the page
function paperRendered() {
  for (const body of paperBodies()) {
    body.classList.add('paper-body', 'no-cap');
    // a heading's number, a figure's picture: put on at once, saved never
    body.querySelectorAll('p.h1, p.h2, p.h3, p.eq').forEach((p, i) => {
      if (!p.dataset.id) p.dataset.id = paperIdFor(p.classList.contains('eq') ? 'eq' : 'sec', p.textContent, i);
    });
  }
  for (const body of paperBodies()) body.addEventListener('input', paperHintsSoon);
  paperHydrate();
  paperRenumber();
  // each symbol as its definition now says (another device may have changed one)
  paperSymbolsShown();
}

// What the page keeps only on screen (from captureBody)
function paperStrip(html) {
  return html.replace(/ (?:data-num|data-missing|data-state|data-hint)="[^"]*"/g, '').replace(/ src="blob:[^"]*"/g, '')
    // maths being written is saved as maths, without the place its caret holds
    .replace(/<(span|p) class="(math|eq)(?: editing)?"([^>]*)>([^<]*)/g, (_, tag, kind, attrs, tex) =>
      `<${tag} class="${kind}"${attrs.replace(' contenteditable="true"', ' contenteditable="false"').replace(' spellcheck="false"', '')}>${tex.replace(/\u200B/g, '')}`);
}

// Everything a paper adds to the page gets its drawing, wherever it came
// from: typed, pasted, undone, redrawn
const paperWatch = new MutationObserver((records) => {
  if (!book || !isPaper()) return;
  let touched = false;
  const hit = (n) => n.nodeType === 1 && (n.matches(PAPER_SEL) || n.querySelector(PAPER_SEL));
  for (const r of records) {
    for (const n of r.addedNodes) if (hit(n)) touched = true;
    for (const n of r.removedNodes) if (hit(n)) touched = true;
    if (touched) break;
  }
  if (!touched) return;
  paperHydrate();
  paperRenumberSoon();
  paperCiteSoon();
});
paperWatch.observe($('#chapters'), { childList: true, subtree: true });

function paperHydrate(root = $('#chapters')) {
  if (!book || !isPaper()) return;
  for (const n of root.querySelectorAll('.math, .eq, .sym')) drawMath(n);
  for (const n of root.querySelectorAll('p.symtab')) drawSymbolTable(n);
  for (const f of root.querySelectorAll('figure.fig')) loadFigure(f);
  for (const c of root.querySelectorAll('.fig figcaption, .tbl figcaption, .tbl th, .tbl td')) {
    if (c.getAttribute('contenteditable') !== 'true') c.setAttribute('contenteditable', 'true');
  }
}

/* ------------------------------------------------------------------ */
/*  The title page: authors, abstract, keywords                       */
/* ------------------------------------------------------------------ */

function paperTitlePage(on) {
  const page = $('#title-page');
  page.classList.toggle('paper-title', on);
  for (const id of ['tp-authors', 'tp-affils', 'tp-abstract-wrap', 'tp-keywords']) {
    const old = document.getElementById(id);
    if (old) old.remove();
  }
  if (!on) return;
  const m = paperMeta();

  const authors = document.createElement('div');
  authors.id = 'tp-authors';
  authors.tabIndex = 0;
  authors.setAttribute('role', 'button');
  authors.title = t('Click to edit the authors, their affiliations and ORCID iDs');
  const affils = document.createElement('div');
  affils.id = 'tp-affils';
  $('#tp-subtitle').after(authors, affils);
  const edit = () => paperEditAuthors();
  authors.addEventListener('click', edit);
  authors.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit(); } });
  paperShowAuthors();

  const wrap = document.createElement('section');
  wrap.id = 'tp-abstract-wrap';
  wrap.innerHTML = `<h2 class="tp-abstract-head"></h2><div id="tp-abstract" contenteditable="true" spellcheck="false" role="textbox" aria-multiline="true"></div><div class="tp-abstract-count" aria-hidden="true"></div>`;
  wrap.querySelector('.tp-abstract-head').textContent = t('Abstract');
  const abs = wrap.querySelector('#tp-abstract');
  abs.setAttribute('aria-label', t('Abstract'));
  abs.dataset.ph = t('One paragraph, about 200 words, in six moves:');
  abs.innerHTML = paperClean(m.abstract || '');
  wrap.appendChild(abstractGuide(abs));
  page.appendChild(wrap);
  const count = () => {
    const text = (abs.innerText || '').trim();
    const n = countWords(text);
    const j = paperJournal();
    const lim = j.limits || {};
    const el = wrap.querySelector('.tp-abstract-count');
    // against the journal's usual limit, when it has one (docs/writing-principles.md, section 1)
    if (lim.abstractChars) el.textContent = text ? t('{n} / {max} characters', { n: text.length, max: lim.abstractChars }) : '';
    else if (lim.abstract) el.textContent = n ? t('{n} / {max} words', { n, max: lim.abstract }) : '';
    else el.textContent = n ? t('{n} words', { n }) : '';
    el.classList.toggle('over', lim.abstractChars ? text.length > lim.abstractChars : !!lim.abstract && n > lim.abstract);
    el.title = lim.note ? t('Typical for {journal}: {note}', { journal: j.name, note: lim.note }) : '';
    wrap.classList.toggle('empty', !text && !abs.querySelector('.math'));
    paperAbstractMoves(abs, wrap);
  };
  wrap.recount = count;
  count();
  abs.addEventListener('input', () => {
    if (abs.innerHTML === '<br>') abs.innerHTML = '';
    m.abstract = paperClean(abs.innerHTML);
    count();
    scheduleMetaSave();
  });
  abs.addEventListener('focus', () => wrap.classList.add('writing'));
  abs.addEventListener('blur', () => wrap.classList.remove('writing'));
  abs.addEventListener('keydown', (e) => {
    const editing = mathCaretIn();
    if (editing) { mathEditKey(e, editing); return; }
    if (paperStepIn(e, abs)) return;
    if (paperSymbolKey(e, abs)) return;
    paperMathKey(e, abs);
  });
  abs.addEventListener('click', (e) => {
    const n = e.target.closest('.math, .sym');
    if (n && n.matches('.sym')) symbolMenu(e, n); else if (n) editMath(n);
  });
  for (const n of abs.querySelectorAll('.math, .sym')) drawMath(n);

  const kw = document.createElement('div');
  kw.id = 'tp-keywords';
  kw.contentEditable = 'true';
  kw.spellcheck = false;
  kw.setAttribute('role', 'textbox');
  kw.setAttribute('aria-label', t('Keywords'));
  kw.dataset.ph = t('Keywords, separated by commas');
  kw.dataset.label = t('Keywords');
  kw.textContent = (m.keywords || []).join(', ');
  page.appendChild(kw);
  kw.addEventListener('input', () => {
    m.keywords = kw.textContent.split(/[,;]/).map((k) => k.trim()).filter(Boolean);
    scheduleMetaSave();
  });
  kw.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const body = paperBodies()[0];
    if (body) focusChapterStart(body.closest('.chapter').dataset.id);
  });
}

// The six moves of an abstract, in order (docs/writing-principles.md,
// section 3): the abstract is the paper in miniature, so each move is
// marked with the section it previews, in that section's colour. The order
// is also the one Nature's summary paragraph and Springer Nature's editors
// teach: context, the gap, "here we", results, implications. Shown in full
// as the empty abstract's scaffold; while the abstract is being written,
// only their names, faintly, under it; nothing once the caret is elsewhere.
const ABSTRACT_MOVES = [
  [tk('Status quo'), tk('What the field knows, and why it matters. One or two sentences any scientist could follow.'), 'intro'],
  [tk('Problem'), tk('What that leaves unsolved, unknown or wrong. Often begins “However, …”.'), 'intro'],
  [tk('Broader solution'), tk('The kind of approach that would close the gap, in general terms.'), 'intro'],
  [tk('What we did'), tk('This study, specifically. Often begins “Here we …”.'), 'methods'],
  [tk('What we found'), tk('The main results, in two or three sentences. A key number or two, not a table’s worth.'), 'results'],
  [tk('Implications'), tk('What changes because of it, for the field and beyond. Keep it to what the results support.'), 'conclusions']
];
// the sections of a paper and the questions each answers (the same model
// everywhere NEO guides structure)
const PAPER_SECTIONS = {
  intro: { name: tk('Introduction'), asks: tk('Why, who and when: what is known, what is missing, and what this paper does about it.') },
  methods: { name: tk('Methods'), asks: tk('How and where: enough for an expert to do it again.') },
  results: { name: tk('Results'), asks: tk('What you found, and how you know: one finding per paragraph, each leading to the next.') },
  conclusions: { name: tk('Discussion'), asks: tk('Why it matters: what the results mean, where they fall short, and what comes next.') },
  // the back matter journals ask for, unnumbered
  acknowledgements: { name: tk('Acknowledgements'), asks: tk('Who helped, and who paid for it, with grant numbers.'), back: true },
  data: { name: tk('Data availability'), asks: tk('Where the data and code are, and how to get them: a repository and its identifier, or why they can’t be shared.'), back: true },
  contributions: { name: tk('Author contributions'), asks: tk('Who did what, in CRediT’s terms: conceptualisation, methodology, software, investigation, analysis, writing, supervision, funding.'), back: true },
  competing: { name: tk('Competing interests'), asks: tk('Anything that could be seen to bear on the work, or “The authors declare no competing interests.”'), back: true }
};
// a heading for back matter: by its name, in any language NEO writes it in
const BACK_MATTER = /^\s*(acknowledge?ments?|funding|data( and code)? availability|code availability|availability of data|author contributions?|contributions|competing interests?|conflicts? of interests?|declaration of interests?|declarations?|ethics( statement)?|supplementary( information| material)?|supporting information|appendix|appendices)\b/i;
const isBackMatter = (h) => BACK_MATTER.test(h.textContent) || Object.values(PAPER_SECTIONS).some((s) => s.back && h.textContent.trim().toLowerCase() === t(s.name).toLowerCase());
// Which moves the abstract has made so far, read from how its sentences
// open: a guess, shown only as a tick in the faint strip under the abstract
// while it's being written, never a warning
const MOVE_CUES = [
  null, // status quo: the first sentence, whatever it says
  /\b(however|but|yet|although|despite|remains? (unclear|unknown|poorly|elusive|open)|little is known|not (yet )?(known|understood|clear)|lacks?|lacking|limited|limitations?|fails?|unresolved|challeng|problem|gap|undermine|mismatch)/i,
  /\b(could|would|might|requires?|need(s|ed)?|instead|alternative(ly)?|one (way|approach|solution)|in principle|a (promising|natural) (way|approach)|by contrast)\b/i,
  /\b(here,? we|we (\w+ly |instead |also |then |first |now )?(present|propose|develop|introduce|use|used|build|built|design|designed|record|recorded|measure|measured|analy[sz]e|analy[sz]ed|combine|combined|test|tested|train|trained|describe|derive|model|simulate)|this (paper|study|work|article))\b/i,
  /\b(we (\w+ly |also |then |further )?(find|found|show|showed|shown|demonstrate|demonstrated|observe|observed|reveal|revealed|identify|identified|discover|discovered|uncover|uncovered|report)|(results?|data|analys[ie]s) (show|shows|indicate|indicates|suggest|reveal|demonstrate)|(was|were) (sufficient|necessary|associated|correlated|higher|lower))\b/i,
  /\b(implications?|suggests?|paves?|enables?|opens? (up|the)|could be used|promising|showcases?|advanc(e|es|ing)|broad(er|ly)|generali[sz]|future|impact|insights? into|bridge|our (results|findings|work|research|approach)|these (results|findings))\b/i
];
function paperAbstractMoves(abs, wrap) {
  const text = (abs.innerText || '').replace(/\s+/g, ' ').trim();
  const sentences = text ? text.split(/(?<=[.!?])\s+(?=[A-Z“"(])/) : [];
  const items = wrap.querySelectorAll('.tp-abstract-guide li');
  MOVE_CUES.forEach((cue, i) => {
    const done = i === 0 ? sentences.length > 0 : sentences.slice(1).some((s) => cue.test(s));
    if (items[i]) items[i].classList.toggle('done', done);
  });
}

function abstractGuide(abs) {
  const ol = document.createElement('ol');
  ol.className = 'tp-abstract-guide';
  ol.setAttribute('aria-label', t('The six moves of an abstract'));
  for (const [name, what, part] of ABSTRACT_MOVES) {
    const li = document.createElement('li');
    li.className = 'move-' + part;
    li.title = t(what) + ' → ' + t(PAPER_SECTIONS[part].name);
    const b = document.createElement('b');
    b.textContent = t(name);
    const span = document.createElement('span');
    span.textContent = t(what);
    const sec = document.createElement('em');
    sec.textContent = t(PAPER_SECTIONS[part].name);
    li.append(b, span, sec);
    ol.appendChild(li);
  }
  // the scaffold is only a guide: a click on it starts the writing
  ol.addEventListener('mousedown', (e) => {
    if (!ol.closest('.empty')) return;
    e.preventDefault();
    abs.focus();
  });
  return ol;
}

// Only what an abstract is made of: paragraphs, emphasis, sub/superscript, maths
function paperClean(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstChild;
  const out = (node) => [...node.childNodes].map((n) => {
    if (n.nodeType === 3) return escHtml(n.data);
    if (n.nodeType !== 1) return '';
    const tag = n.tagName.toLowerCase();
    if (n.classList.contains('math')) return `<span class="math" contenteditable="false">${escHtml(texOf(n))}</span>`;
    if (n.classList.contains('sym') && /^[A-Za-z]+$/.test(n.dataset.sym || '')) return `<span class="sym" contenteditable="false" data-sym="${n.dataset.sym}">${escHtml(n.textContent)}</span>`;
    if (['i', 'em'].includes(tag)) return `<i>${out(n)}</i>`;
    if (['b', 'strong'].includes(tag)) return `<b>${out(n)}</b>`;
    if (['sub', 'sup'].includes(tag)) return `<${tag}>${out(n)}</${tag}>`;
    if (['p', 'div'].includes(tag)) return `<p>${out(n) || '<br>'}</p>`;
    if (tag === 'br') return '<br>';
    return out(n);
  }).join('');
  const html2 = out(doc);
  return /<p>/.test(html2) || !html2 ? html2 : `<p>${html2}</p>`;
}

// Ada Lovelace¹ ✉, Charles Babbage²  —  ¹ University of London  ² Cambridge
function paperAffiliations(authors) {
  const list = [];
  for (const a of authors) for (const f of a.affiliations || []) if (f && !list.includes(f)) list.push(f);
  return list;
}
const SUPERSCRIPT = (n) => String(n).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
function paperShowAuthors() {
  const el = $('#tp-authors');
  if (!el) return;
  const authors = paperMeta().authors || [];
  const affils = paperAffiliations(authors);
  el.innerHTML = '';
  el.classList.toggle('empty', !authors.length);
  // anonymous for review: still here, said to be left out of what's sent
  el.classList.toggle('anon', !!paperMeta().anonymous);
  if (paperMeta().anonymous) el.dataset.anon = t('Anonymous for review: left out of previews and exports'); else delete el.dataset.anon;
  if (!authors.length) {
    el.textContent = t('Add authors');
  } else {
    authors.forEach((a, i) => {
      if (i) el.append(', ');
      const name = document.createElement('span');
      name.className = 'tp-name';
      name.textContent = a.name;
      el.appendChild(name);
      const marks = (a.affiliations || []).map((f) => affils.indexOf(f) + 1).filter((n) => n > 0);
      if (affils.length > 1 && marks.length) {
        const sup = document.createElement('sup');
        sup.textContent = marks.join(',');
        el.appendChild(sup);
      }
      if (a.corresponding) {
        const sup = document.createElement('sup');
        sup.className = 'tp-corr';
        sup.textContent = '*';
        sup.title = a.email || t('Corresponding author');
        el.appendChild(sup);
      }
    });
  }
  const box = $('#tp-affils');
  if (box) {
    box.innerHTML = '';
    affils.forEach((f, i) => {
      const line = document.createElement('div');
      line.textContent = (affils.length > 1 ? SUPERSCRIPT(i + 1) + ' ' : '') + f;
      box.appendChild(line);
    });
    const corr = authors.find((a) => a.corresponding && a.email);
    if (corr) {
      const line = document.createElement('div');
      line.className = 'tp-corr-line';
      line.textContent = '* ' + t('Correspondence: {email}', { email: corr.email });
      box.appendChild(line);
    }
  }
  // the shelf shows the authors as the book's author
  const names = authors.map((a) => a.name).filter(Boolean);
  const shelfName = names.length > 2 ? names[0] + ' et al.' : names.join(' & ');
  if (shelfName && book.author !== shelfName) { book.author = shelfName; scheduleMetaSave(); }
}

// The authors, one row each: name, affiliations, email, ORCID iD, and who
// takes correspondence. Opened only when the writer clicks the author line.
function paperEditAuthors() {
  const m = paperMeta();
  const rows = (m.authors && m.authors.length ? m.authors : [{ name: displayAuthor() || '', affiliations: [''], corresponding: true }])
    .map((a) => ({ ...a, affiliations: [...(a.affiliations || [])] }));
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `<div class="modal paper-authors" role="dialog" aria-modal="true">
    <h2></h2><div class="pa-rows"></div>
    <button class="pa-add btn-quiet" type="button"></button>
    <datalist id="pa-affil-list"></datalist>
    <div class="pa-foot"><button class="m-cancel btn-quiet" type="button"></button><button class="m-ok btn-gold" type="button"></button></div>
  </div>`;
  bd.querySelector('h2').textContent = t('Authors');
  bd.querySelector('.pa-add').textContent = '+ ' + t('Add an author');
  bd.querySelector('.m-cancel').textContent = t('Cancel');
  bd.querySelector('.m-ok').textContent = t('Done');
  const list = bd.querySelector('.pa-rows');
  const known = () => {
    const dl = bd.querySelector('#pa-affil-list');
    dl.innerHTML = '';
    for (const f of paperAffiliations(rows)) { const o = document.createElement('option'); o.value = f; dl.appendChild(o); }
  };
  const field = (cls, ph, value, onInput, type = 'text') => {
    const input = document.createElement('input');
    input.type = type;
    input.className = cls;
    input.placeholder = ph;
    input.setAttribute('aria-label', ph);
    input.value = value || '';
    input.spellcheck = false;
    input.addEventListener('input', () => onInput(input.value));
    return input;
  };
  const draw = () => {
    list.innerHTML = '';
    rows.forEach((a, i) => {
      const row = document.createElement('div');
      row.className = 'pa-row';
      const left = document.createElement('div');
      left.className = 'pa-main';
      left.appendChild(field('pa-name', t('Name'), a.name, (v) => { a.name = v; }));
      a.affiliations.forEach((f, k) => {
        const aff = field('pa-affil', t('Affiliation'), f, (v) => { a.affiliations[k] = v; known(); });
        aff.setAttribute('list', 'pa-affil-list');
        left.appendChild(aff);
      });
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'pa-more';
      more.textContent = '+ ' + t('another affiliation');
      more.onclick = () => { a.affiliations.push(''); draw(); list.querySelectorAll('.pa-row')[i].querySelectorAll('.pa-affil')[a.affiliations.length - 1].focus(); };
      left.appendChild(more);
      const right = document.createElement('div');
      right.className = 'pa-side';
      right.appendChild(field('pa-email', t('Email'), a.email, (v) => { a.email = v; }, 'email'));
      const orcid = field('pa-orcid', 'ORCID iD (0000-0000-0000-0000)', a.orcid, (v) => {
        a.orcid = v.trim().replace(/^https?:\/\/orcid\.org\//i, '');
        orcid.classList.toggle('bad', !!a.orcid && !validOrcid(a.orcid));
      });
      orcid.classList.toggle('bad', !!a.orcid && !validOrcid(a.orcid));
      right.appendChild(orcid);
      const corr = document.createElement('label');
      corr.className = 'pa-corr';
      corr.innerHTML = '<input type="checkbox"> <span></span>';
      corr.querySelector('span').textContent = t('Corresponding author');
      corr.querySelector('input').checked = !!a.corresponding;
      corr.querySelector('input').onchange = (e) => { a.corresponding = e.target.checked; };
      right.appendChild(corr);
      const tools = document.createElement('div');
      tools.className = 'pa-tools';
      const btn = (label, title, fn, disabled) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.title = title;
        b.setAttribute('aria-label', title);
        b.disabled = !!disabled;
        b.onclick = fn;
        tools.appendChild(b);
      };
      btn('↑', t('Move up'), () => { rows.splice(i - 1, 0, rows.splice(i, 1)[0]); draw(); }, i === 0);
      btn('↓', t('Move down'), () => { rows.splice(i + 1, 0, rows.splice(i, 1)[0]); draw(); }, i === rows.length - 1);
      btn('×', t('Remove'), () => { rows.splice(i, 1); draw(); });
      right.appendChild(tools);
      row.append(left, right);
      list.appendChild(row);
    });
    known();
  };
  draw();
  document.body.appendChild(bd);
  const first = bd.querySelector('.pa-name');
  if (first) first.focus();
  bd.querySelector('.pa-add').onclick = () => {
    rows.push({ name: '', affiliations: [''] });
    draw();
    const names = bd.querySelectorAll('.pa-name');
    names[names.length - 1].focus();
  };
  const close = () => bd.remove();
  bd.querySelector('.m-cancel').onclick = close;
  bd.querySelector('.m-ok').onclick = () => {
    m.authors = rows.map((a) => ({
      name: a.name.trim(),
      affiliations: a.affiliations.map((f) => f.trim()).filter(Boolean),
      ...(a.email && a.email.trim() ? { email: a.email.trim() } : {}),
      ...(a.orcid && validOrcid(a.orcid) ? { orcid: a.orcid } : {}),
      ...(a.corresponding ? { corresponding: true } : {})
    })).filter((a) => a.name);
    paperShowAuthors();
    scheduleMetaSave();
    close();
  };
  bd.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); bd.querySelector('.m-ok').click(); }
  });
}
// the journal the paper is set for
// the journal the paper is set for: a built-in one, or (journal 'template')
// the venue whose LaTeX template it was given
const paperJournal = () => {
  const m = (book && book.paper) || {};
  return (m.journal === 'template' && NeoJournals.templateLook(m.template)) || NeoJournals.get(m.journal || NeoJournals.DEFAULT);
};

// ORCID's own check digit (ISO 7064 11,2)
function validOrcid(id) {
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(id)) return false;
  const digits = id.replace(/-/g, '');
  let total = 0;
  for (let i = 0; i < 15; i++) total = (total + +digits[i]) * 2;
  const check = (12 - (total % 11)) % 11;
  return digits[15] === (check === 10 ? 'X' : String(check));
}

/* ------------------------------------------------------------------ */
/*  Headings and numbers                                              */
/* ------------------------------------------------------------------ */

const HEADINGS = ['h1', 'h2', 'h3'];
const headingOf = (p) => (p && p.classList ? HEADINGS.find((h) => p.classList.contains(h)) || '' : '');

// ⌥⌘1–3 and the Format menu; '' is body text
function paperSetHeading(level, body = null) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let el = sel.anchorNode;
  if (el && el.nodeType === 3) el = el.parentElement;
  body = body || (el && el.closest && el.closest('.chapter-body'));
  const p = el && el.closest && el.closest('p');
  if (!body || !p || !body.contains(p) || p.classList.contains('eq')) return;
  p.classList.remove(...HEADINGS, 'flush', 'poetry');
  if (level) {
    p.classList.add(level);
    if (!p.dataset.id) p.dataset.id = paperId('sec');
    p.removeAttribute('style');
  } else {
    delete p.dataset.id;
  }
  if (!p.getAttribute('class')) p.removeAttribute('class');
  syncChapter(body, body.closest('.chapter').dataset.id);
  paperRenumber();
  paperReportState();
}

let paperRenumberTimer = null;
function paperRenumberSoon() {
  clearTimeout(paperRenumberTimer);
  paperRenumberTimer = setTimeout(paperRenumber, 120);
}

// Headings 1, 1.1, 1.1.1; figures, tables and equations in order; and every
// cross-reference set to the number its target has now
function paperRenumber() {
  if (!book || !isPaper()) return;
  const numbered = paperMeta().numbered !== false;
  // in the journal's words, never the interface's: they're saved in the chapter
  const label = (kind, num) => NeoJournals.refLabel(paperJournal(), kind, num);
  const counts = [0, 0, 0];
  const n = { fig: 0, tbl: 0, eq: 0 };
  const targets = new Map();
  const set = (el, v) => { if (el.dataset.num !== v) el.dataset.num = v; };
  for (const el of document.querySelectorAll('#chapters p.h1, #chapters p.h2, #chapters p.h3, #chapters figure.fig, #chapters figure.tbl, #chapters p.eq')) {
    const level = HEADINGS.indexOf(headingOf(el));
    if (level >= 0 && isBackMatter(el)) {
      // Acknowledgements, Data availability…: never numbered, nor counted
      if (el.dataset.num) delete el.dataset.num;
      targets.set(el.dataset.id, { kind: 'sec', num: '', label: '“' + el.textContent.trim() + '”', el });
      continue;
    }
    if (level >= 0) {
      counts[level]++;
      for (let k = level + 1; k < 3; k++) counts[k] = 0;
      const num = counts.slice(0, level + 1).map((c) => c || 1).join('.');
      if (numbered) set(el, num); else if (el.dataset.num) delete el.dataset.num;
      targets.set(el.dataset.id, { kind: 'sec', num, label: numbered ? label('sec', num) : '“' + el.textContent.trim() + '”', el });
      continue;
    }
    const kind = el.classList.contains('fig') ? 'fig' : el.classList.contains('tbl') ? 'tbl' : 'eq';
    const num = String(++n[kind]);
    set(el, num);
    const cap = el.querySelector('figcaption');
    if (cap) set(cap, num);
    targets.set(el.dataset.id, { kind, num, label: label(kind, num), el });
    // each panel can be referred to on its own: Figure 2b
    if (kind === 'fig') {
      el.querySelectorAll(':scope > .panel').forEach((panel, i) => {
        const pn = num + String.fromCharCode(97 + i);
        targets.set(el.dataset.id + '-' + String.fromCharCode(97 + i), { kind: 'fig', num: pn, label: label('fig', pn), el: panel });
      });
    }
  }
  paper.targets = targets;
  paperListNumbers();
  paperHints();
  for (const x of document.querySelectorAll('#chapters .xref')) {
    const tgt = targets.get(x.dataset.ref);
    const text = tgt ? tgt.label : '??';
    if (x.textContent !== text) x.textContent = text;
    if (tgt) x.removeAttribute('data-missing'); else x.setAttribute('data-missing', '');
  }
  if (currentTab === 'manuscript') scheduleNavRefresh();
}

// An empty section says what it's for: the question its name answers
// (Introduction, Methods, Results, Discussion and their usual synonyms), or
// for any other heading, the rhythm a paragraph keeps. Drawn on the empty
// line under the heading, never saved, gone at the first letter.
const SECTION_NAMES = [
  ['acknowledgements', /acknowledg|funding/i], ['data', /availability/i], ['contributions', /contribution/i], ['competing', /competing|conflict|declaration of interest/i],
  ['intro', /intro|background|motivation/i], ['methods', /method|material|approach|procedure|model|design|setup|data/i],
  ['results', /result|finding|experiment|evaluation/i], ['conclusions', /discuss|conclu|summary|outlook|implication/i]
];
function paperHints() {
  const heads = paperHeadings();
  const keep = new Set();
  heads.forEach((h) => {
    let first = null;
    let empty = true;
    for (let el = h.nextElementSibling; el && !headingOf(el); el = el.nextElementSibling) {
      if (el.matches('figure, p.eq') || el.textContent.trim()) { empty = false; break; }
      if (!first && el.matches('p')) first = el;
    }
    if (!empty || !first) return;
    const named = SECTION_NAMES.find(([, re]) => re.test(h.textContent));
    const hint = named && (h.classList.contains('h1') || PAPER_SECTIONS[named[0]].back) ? t(PAPER_SECTIONS[named[0]].asks)
      : t('Open with what is established, say what this paragraph adds, and close with what it means and where it leads.');
    if (first.dataset.hint !== hint) first.dataset.hint = hint;
    keep.add(first);
  });
  for (const p of document.querySelectorAll('#chapters p[data-hint]')) if (!keep.has(p)) delete p.dataset.hint;
}
let paperHintsTimer = null;
function paperHintsSoon() {
  // gone at the first letter; back, if the section empties, a moment later
  const sel = window.getSelection();
  const at = sel && sel.anchorNode && (sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode);
  const p = at && at.closest && at.closest('p[data-hint]');
  if (p && p.textContent.trim()) delete p.dataset.hint;
  clearTimeout(paperHintsTimer);
  paperHintsTimer = setTimeout(paperHints, 400);
}

// A title's length, while it's edited: a conference gives it about 100
// characters to interest people (docs/writing-principles.md, section 1)
(() => {
  const title = $('#tp-title');
  const show = () => {
    let el = $('#tp-title-count');
    if (!book || !isPaper() || document.activeElement !== title) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'tp-title-count';
      el.setAttribute('aria-hidden', 'true');
      title.after(el);
    }
    const n = title.textContent.trim().length;
    const j = paperJournal();
    const max = (j.limits && j.limits.title) || 100;
    el.textContent = n ? t('{n} / {max} characters', { n, max }) : '';
    el.title = j.limits && j.limits.title ? t('Typical for {journal}', { journal: j.name }) : t('About what a conference gives a title to interest people');
    el.style.top = (title.offsetTop + title.offsetHeight + 2) + 'px';
    el.classList.toggle('long', n > max);
  };
  title.addEventListener('focus', show);
  title.addEventListener('input', show);
  title.addEventListener('blur', show);
})();

// Everything that can be cross-referenced, for the @ picker
function paperTargets() {
  paperRenumber();
  return [...(paper.targets || new Map()).entries()].map(([id, x]) => {
    const cap = x.el.querySelector && x.el.querySelector(':scope > figcaption, :scope > .subcap');
    const text = x.kind === 'sec' ? x.el.textContent.trim() : x.kind === 'eq' ? texOf(x.el).trim() : (cap ? cap.textContent.trim() : '');
    return { id, kind: x.kind, label: x.kind === 'sec' ? t('Section {n}', { n: x.num }) : x.label, text };
  });
}

/* ------------------------------------------------------------------ */
/*  Typing in a paper                                                 */
/* ------------------------------------------------------------------ */

// From the chapter's keydown, ahead of NEO's own keys. true = handled.
function paperKey(e, body, chId) {
  // keys go to the chapter (the editing host); the caret says they're TeX
  const editingMath = mathCaretIn();
  if (editingMath) return mathEditKey(e, editingMath);
  if (pickerKey(e)) return true;
  if (paperMenuKey(e)) return true;
  paperSelectionTakes(e, body);
  if (paperSymbolKey(e, body)) return true;
  if (paperListKey(e, body, chId)) return true;
  if (paperStepIn(e, body)) return true;
  const inIsland = e.target !== body && e.target.closest && e.target.closest('figure');
  if (inIsland) return figureKey(e, body, chId);
  const cmd = e.metaKey || e.ctrlKey;
  // ⌥⌘1–3, ⌥⌘0 (the menu has them too; this works where a menu can't reach).
  // Not AltGr, which arrives as Ctrl+Alt and types }, ² and ³ on many layouts
  if (cmd && e.altKey && !e.shiftKey && !altGraph(e) && /^Digit[0-3]$/.test(e.code || '')) {
    e.preventDefault();
    paperSetHeading(['', 'h1', 'h2', 'h3'][+e.code.slice(5)], body);
    return true;
  }
  // @ and $ typed with ⌥ (a German or Swedish Mac) or AltGr (Windows) are typing
  if (typedChar(e) && e.key === '@') return pickerOpenOnAt(e, body);
  if (typedChar(e) && e.key === '/' && pickerOpenOnSlash(e, body)) return true;
  if (paperMathKey(e, body)) return true;
  if (cmd || e.altKey) return false;
  if (e.key === 'Enter' && !e.shiftKey) return paperEnter(e, body, chId);
  if (e.key === ' ' && paperHashHeading(e, body)) return true;
  return false;
}

// Enter is a new paragraph and only that: a paper has no *** and no
// chapter splits. On a heading, the next line is body text; on a line that
// is only $$…$$, the maths becomes a numbered display equation.
function paperEnter(e, body, chId) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const block = caretBlock(body);
  if (!block) return false;
  e.preventDefault();
  enterRun = 0;
  if (!sel.isCollapsed) document.execCommand('delete');
  const text = block.textContent.trim();
  // the line is $$, its TeX, and $$ (or nothing) after: nothing else
  const display = /^\$\$((?:(?!\$\$)[\s\S])*)(?:\$\$)?$/.exec(text);
  if (display && !headingOf(block) && !block.querySelector(ATOMS)) {
    snapshotStructure('equation');
    const eq = makeDisplayEq(display[1].trim());
    block.replaceWith(eq);
    const after = document.createElement('p');
    after.innerHTML = '<br>';
    eq.after(after);
    placeCaret(after, 0);
    syncChapter(body, chId);
    resetNativeUndo();
    breakRun++;
    if (!display[1].trim()) editMath(eq);
    return true;
  }
  const level = headingOf(block);
  if (level) {
    const r = sel.getRangeAt(0);
    const pre = document.createRange();
    pre.selectNodeContents(block);
    pre.setEnd(r.startContainer, r.startOffset);
    if (!pre.toString().length && text) {
      // at the start of a heading: an empty line opens above it
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      block.before(p);
      syncChapter(body, chId);
      return true;
    }
  }
  if (block.querySelector(JUNK_SPAN)) {
    const caret = captureCaret();
    stripJunkSpans(block);
    restoreCaret(caret);
  }
  document.execCommand('insertParagraph');
  const cur = caretBlock(body);
  if (cur && cur !== block) {
    // the engine copies the paragraph it split, class, id and all
    cur.classList.remove(...HEADINGS);
    delete cur.dataset.id;
    delete cur.dataset.num;
    if (!cur.getAttribute('class')) cur.removeAttribute('class');
  }
  syncChapter(body, chId);
  revealCaret();
  return true;
}

// Lists: each item a paragraph, <p class="li" data-list="ul|ol">, nested
// by data-level (2, 3; none is 1), the way headings are paragraphs too.
// "- " or "* " at the start of a line starts a bulleted list, "1. " a
// numbered one; Enter makes the next item, and on an empty item ends the
// list; Tab and ⇧Tab nest and un-nest; Backspace at an item's start
// un-nests it, then makes it a paragraph again. Numbers are drawn, never saved.
const listLevel = (p) => +(p.dataset.level || 1);
function setListItem(p, list, level) {
  if (!list || level < 1) {
    p.classList.remove('li');
    if (!p.getAttribute('class')) p.removeAttribute('class');
    delete p.dataset.list;
    delete p.dataset.level;
    delete p.dataset.num;
    return;
  }
  p.classList.add('li');
  p.dataset.list = list;
  if (level > 1) p.dataset.level = String(level); else delete p.dataset.level;
}
function paperListKey(e, body, chId) {
  const block = caretBlock(body);
  if (!block || !block.matches('p') || block.closest('figure')) return false;
  const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(block);
  pre.setEnd(r.startContainer, r.startOffset);
  const before = pre.toString();
  const change = (fn) => {
    e.preventDefault();
    snapshotStructure('list');
    const caret = captureCaret();
    fn();
    restoreCaret(caret);
    syncChapter(body, chId);
    resetNativeUndo();
    breakRun++;
    paperRenumber();
    return true;
  };
  // "- ", "* " or "1. " at the start of a paragraph: a list
  if (e.key === ' ' && plain && !e.shiftKey && !block.classList.contains('li') && !headingOf(block) && !block.matches('.eq, .symtab')) {
    const list = /^[-*•]$/.test(before) ? 'ul' : /^\d{1,3}[.)]$/.test(before) ? 'ol' : '';
    if (!list) return false;
    e.preventDefault();
    selectChars(block, 0, before.length);
    document.execCommand('delete');
    return change(() => setListItem(block, list, 1));
  }
  if (!block.classList.contains('li')) return false;
  const level = listLevel(block);
  const list = block.dataset.list;
  const empty = !block.textContent.trim() && !block.querySelector(ATOMS);
  // Tab: a level in (no deeper than one past the item above); ⇧Tab: a level out
  if (e.key === 'Tab' && plain) {
    if (e.shiftKey) return change(() => setListItem(block, level > 1 ? list : '', level - 1));
    const prev = block.previousElementSibling;
    const most = prev && prev.classList.contains('li') ? Math.min(3, listLevel(prev) + 1) : 1;
    if (level >= most) { e.preventDefault(); return true; }
    return change(() => setListItem(block, list, level + 1));
  }
  // Enter on an empty item, or Backspace at an item's start: a level out, then out of the list
  if ((e.key === 'Enter' && plain && !e.shiftKey && empty) || (e.key === 'Backspace' && plain && !e.shiftKey && !before.length)) {
    return change(() => setListItem(block, level > 1 ? list : '', level - 1));
  }
  return false;
}
// the numbers of numbered items, counted through each list and its levels
function paperListNumbers() {
  for (const body of paperBodies()) {
    let counts = [0, 0, 0];
    let lists = ['', '', ''];
    for (const el of body.children) {
      if (!el.matches('p.li')) { counts = [0, 0, 0]; lists = ['', '', '']; continue; }
      const k = Math.min(3, listLevel(el)) - 1;
      for (let d = k + 1; d < 3; d++) { counts[d] = 0; lists[d] = ''; }
      // a list of the other kind at this level starts again
      if (lists[k] !== el.dataset.list) { counts[k] = 0; lists[k] = el.dataset.list; }
      counts[k]++;
      const num = el.dataset.list === 'ol' ? String(counts[k]) : '';
      if ((el.dataset.num || '') !== num) { if (num) el.dataset.num = num; else delete el.dataset.num; }
    }
  }
}

// "# " at the start of a line makes a section heading; ## and ### the levels below
function paperHashHeading(e, body) {
  const block = caretBlock(body);
  if (!block || headingOf(block) || block.classList.contains('eq')) return false;
  const sel = window.getSelection();
  const r = sel.getRangeAt(0);
  if (!r.collapsed) return false;
  const pre = document.createRange();
  pre.selectNodeContents(block);
  pre.setEnd(r.startContainer, r.startOffset);
  const before = pre.toString();
  if (!/^#{1,3}$/.test(before)) return false;
  e.preventDefault();
  selectChars(block, 0, before.length);
  document.execCommand('delete');
  paperSetHeading(HEADINGS[before.length - 1], body);
  return true;
}

// $x^2$: the closing $ turns what's between into maths, the way *…* turns
// italic. Not money: "$5 and $10" stays as typed, and so does a $ after a
// space. ⌘Z right after brings back the dollar signs.
const MATH_INLINE = /(^|[^\\$\p{L}\p{N}])\$([^\s$](?:[^$]*?[^\s$\\])?)$/u;
const altGraph = (e) => !!(e.getModifierState && e.getModifierState('AltGraph'));
const typedChar = (e) => !e.metaKey && (!e.ctrlKey || altGraph(e));
function paperMathKey(e, field) {
  if (e.key !== '$' || !typedChar(e) || (library && library.markdownOff)) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  const start = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
  const block = start && start.closest('p, div');
  if (!block || !field.contains(block) || block.closest('figure') || block.classList.contains('eq')) return false;
  const pre = document.createRange();
  pre.selectNodeContents(block);
  pre.setEnd(r.startContainer, r.startOffset);
  const before = pre.toString();
  const m = MATH_INLINE.exec(before);
  if (!m || /^[\d.,\s–-]+$/.test(m[2])) return false;
  const from = before.length - m[2].length - 1;
  selectChars(block, from, before.length);
  // only plain text between the dollars: not across a citation or a picture
  if (window.getSelection().getRangeAt(0).cloneContents().querySelector('*')) {
    placeCaret(r.startContainer, r.startOffset);
    return false;
  }
  e.preventDefault();
  placeCaret(r.startContainer, r.startOffset);
  document.execCommand('insertText', false, '$');
  selectChars(block, from, before.length + 1);
  const node = placeAtom(window.getSelection().getRangeAt(0), `<span class="math" contenteditable="false">${escHtml(m[2])}</span>`, 'maths');
  if (!field.matches('.chapter-body')) {
    drawMath(node); // the page draws its own; the abstract is drawn here
    field.dispatchEvent(new Event('input'));
  }
  return true;
}

// A citation, cross-reference or maths in place of a range. Placed by hand:
// the engine's insertHTML sets an uneditable span outside its paragraph
// when it lands at the end of a line. In the paper, ⌘Z takes it back
// through NEO's structural undo, the way it takes back a section break.
function placeAtom(range, html, label) {
  const start = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
  const body = start && start.closest('.chapter-body');
  if (body) snapshotStructure(label);
  const holder = document.createElement('span');
  holder.innerHTML = html;
  const node = holder.firstChild;
  range.deleteContents();
  range.insertNode(node);
  // no empty text left beside it, and none of the engine's style spans
  for (const n of [node.previousSibling, node.nextSibling]) if (n && n.nodeType === 3 && !n.data) n.remove();
  if (body) {
    syncChapter(body, body.closest('.chapter').dataset.id);
    // the engine's own undo never saw this: start it afresh, and send ⌘Z to NEO's
    body.contentEditable = 'false';
    body.contentEditable = 'true';
    body.focus({ preventScroll: true });
    breakRun++;
  }
  caretAfter(node);
  return node;
}
// the caret just past a piece the caret can't go into
function caretAfter(node) {
  const r = document.createRange();
  const next = node.nextSibling;
  if (next && next.nodeType === 3) r.setStart(next, 0);
  else r.setStartAfter(node);
  r.collapse(true);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

function makeDisplayEq(tex) {
  const eq = document.createElement('p');
  eq.className = 'eq';
  eq.contentEditable = 'false';
  eq.dataset.id = paperId('eq');
  eq.textContent = tex;
  return eq;
}

/* ------------------------------------------------------------------ */
/*  Maths: drawn by MathJax into a shadow root, edited in place        */
/* ------------------------------------------------------------------ */

const MATH_CSS = `:host{display:inline}:host(.eq){display:block}
.m{display:inline-block;cursor:pointer;border-radius:3px}
.m:hover{background:rgba(201,168,106,.16)}
.d{display:flex;align-items:center;justify-content:center;position:relative;padding:.4em 3em;cursor:pointer}
.d:hover{background:rgba(201,168,106,.12)}
.n{position:absolute;right:0}
.src{font-family:Menlo,Consolas,monospace;font-size:.8em;opacity:.7}
.err{color:#c0392b;font-family:Menlo,Consolas,monospace;font-size:.8em}
mjx-container{display:inline-block}
svg{overflow:visible}
.ied{font-family:Menlo,Consolas,monospace;font-size:.82em;background:rgba(201,168,106,.16);border-radius:3px;padding:1px 3px;outline:none}
.dl{opacity:.45}
:host(.math.editing) .pv{margin-left:.35em;opacity:.75}
.ded{display:flex;flex-direction:column;align-items:stretch;gap:.4em;padding:.5em .8em;border-radius:5px;background:rgba(201,168,106,.10)}
.ded .src{font-family:Menlo,Consolas,monospace;font-size:.8em;white-space:pre-wrap;outline:none}
.ded .pv{display:flex;justify-content:center;min-height:1.5em}
.pv.bad{color:#c0392b;font-style:italic;font-size:.75em}`;

const drawn = new WeakMap(); // node → the TeX (and number) last drawn
function drawMath(node) {
  const display = node.classList.contains('eq');
  const root = node.shadowRoot || node.attachShadow({ mode: 'open' });
  if (node.classList.contains('editing')) {
    // its TeX, editable through the slot, and what it draws, live
    if (drawn.get(node) !== 'editing') {
      drawn.set(node, 'editing');
      root.innerHTML = `<style>${MATH_CSS}</style>` + (display
        ? '<span class="ded"><span class="src"><slot></slot></span><span class="pv"></span></span>'
        : '<span class="ied"><span class="dl">$</span><slot></slot><span class="dl">$</span></span><span class="pv"></span>');
    }
    mathPreview(node);
    return;
  }
  const tex = node.textContent;
  const num = display ? node.dataset.num || '' : '';
  const key = tex + '\u0000' + num + '\u0000' + (mathReady() ? 1 : 0);
  if (node.shadowRoot && drawn.get(node) === key) return;
  drawn.set(node, key);
  const box = document.createElement('span');
  box.className = display ? 'd' : 'm';
  if (!tex.trim()) {
    box.innerHTML = `<span class="src">${escHtml(display ? t('empty equation — click to write it') : '$ $')}</span>`;
  } else if (!mathReady()) {
    box.innerHTML = `<span class="src">${escHtml(display ? tex : '$' + tex + '$')}</span>`;
  } else {
    const svg = texSvg(tex, display);
    if (svg) box.appendChild(svg); else box.innerHTML = `<span class="err">${escHtml(tex)}</span>`;
  }
  if (display) {
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = num ? '(' + num + ')' : '';
    box.appendChild(n);
  }
  root.innerHTML = `<style>${MATH_CSS}</style>`;
  root.appendChild(box);
}
function mathPreview(node) {
  const pv = node.shadowRoot && node.shadowRoot.querySelector('.pv');
  if (!pv) return;
  const tex = texOf(node).trim();
  pv.innerHTML = '';
  pv.classList.remove('bad');
  if (!tex) return;
  if (!mathReady()) { pv.textContent = t('Loading the maths…'); return; }
  const svg = texSvg(tex, node.classList.contains('eq'));
  if (svg) pv.appendChild(svg);
  else { pv.textContent = t('doesn’t parse yet'); pv.classList.add('bad'); }
}
function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight + 2, 240) + 'px';
}
// the drawing follows the TeX as it's typed
document.addEventListener('input', () => {
  const n = mathCaretIn();
  if (!n) return;
  mathHold(n);
  mathPreview(n);
}, true);
// the maths being written, when the caret is in it
function mathCaretIn() {
  if (!mathEditing) return null;
  const sel = window.getSelection();
  return sel && sel.anchorNode && mathEditing.node.contains(sel.anchorNode) ? mathEditing.node : null;
}

// TeX → an <svg>, or null when the TeX doesn't parse. Never a link, even
// if one got past the configuration: a click on maths opens nothing
function texSvg(tex, display) {
  try {
    const out = window.MathJax.tex2svg(tex, { display });
    const svg = out.querySelector('svg');
    if (!svg || out.querySelector('[data-mjx-error]')) return null;
    for (const a of svg.querySelectorAll('a')) a.replaceWith(...a.childNodes);
    for (const r of svg.querySelectorAll('rect[data-hitbox]')) r.remove();
    return svg;
  } catch {
    return null;
  }
}
// re-drawn when its number changes
const eqNumberWatch = new MutationObserver((records) => {
  for (const r of records) if (r.target.classList && r.target.classList.contains('eq')) drawMath(r.target);
});
eqNumberWatch.observe($('#chapters'), { attributes: true, attributeFilter: ['data-num'], subtree: true });

// Maths is edited where it stands: a click, or arrowing into it, turns it
// into its TeX, right there in the line (an equation shows its TeX over a
// live drawing of it), and Enter, Esc, or arrowing out of it turns it back.
// While it's written the light DOM is the TeX itself, shown through a slot;
// paperStrip keeps the editing state out of the saved chapter.
let mathEditing = null; // { node, was }
// The TeX stands behind a zero-width space while it's written. Empty TeX
// has no text for the caret to stand in (what's typed there goes nowhere),
// and TeX selected whole is the span to the engine, which types over the
// span and leaves plain words in the line. The space is never saved.
const MATH_HOLD = '\u200B';
function texOf(node) { return node.textContent.replace(/\u200B/g, ''); }
// a place-holder at the start of the TeX's text, and its text in one piece
function mathHold(node) {
  const text = node.firstChild;
  if (node.childNodes.length !== 1 || text.nodeType !== 3) {
    node.textContent = MATH_HOLD + texOf(node);
    placeCaret(node.firstChild, node.firstChild.length);
  } else if (!text.data.startsWith(MATH_HOLD)) text.insertData(0, MATH_HOLD);
}
// the caret at a place in the TeX, counted without place-holders
function texCaret(node, at, to = at) {
  const text = node.firstChild;
  const offset = (n) => {
    let i = 0;
    for (let k = 0; i < text.length; i++) {
      if (text.data[i] === MATH_HOLD) continue;
      if (k++ === n) break;
    }
    return i;
  };
  const r = document.createRange();
  r.setStart(text, offset(at));
  r.setEnd(text, offset(to));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}
function editMath(node, { caret = 'end' } = {}) {
  if (mathEditing && mathEditing.node === node) return;
  finishMath(true);
  const body = node.closest('.chapter-body');
  if (body) snapshotStructure('maths'); // ⌘Z after: the maths as it was
  mathEditing = { node, was: texOf(node) };
  node.classList.add('editing');
  node.contentEditable = 'true';
  node.spellcheck = false;
  drawMath(node);
  node.focus({ preventScroll: true });
  // the caret in the TeX's own text: at an element boundary the engine
  // would settle it outside the span
  node.textContent = MATH_HOLD + texOf(node);
  const len = texOf(node).length;
  texCaret(node, caret === 'end' ? len : 0, caret === 'start' ? 0 : len);
}
// keep: the TeX as typed; otherwise as it was. Emptied, the maths goes.
// step: the side it was left by (−1 before it, else after it). place:
// false when the caret has already gone somewhere else, and stays there.
function finishMath(keep, { step = 0, place = true } = {}) {
  if (!mathEditing) return;
  const { node, was } = mathEditing;
  mathEditing = null;
  if (!node.isConnected) return;
  const s = window.getSelection();
  const gone = !place && s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
  const display = node.classList.contains('eq');
  let tex = keep ? texOf(node) : was;
  if (!display) tex = tex.replace(/\s*\n\s*/g, ' ');
  tex = tex.trim();
  node.classList.remove('editing');
  node.contentEditable = 'false';
  node.removeAttribute('spellcheck');
  const body = node.closest('.chapter-body');
  const field = body || node.closest('#tp-abstract');
  // where the caret lands: beside the maths, on the side it was left by;
  // an equation's neighbours are the paragraphs around it
  let r = document.createRange();
  let into = null;
  if (!tex) {
    r.setStartBefore(node);
    node.remove();
  } else {
    if (node.textContent !== tex) node.textContent = tex;
    drawMath(node);
    const beside = step < 0 ? node.previousElementSibling : node.nextElementSibling;
    if (display && place && step && beside && beside.matches('figure, p.eq')) {
      // arrowed onto a figure or another equation: on into it, below
      into = beside;
      r = null;
    } else if (display && place) {
      let p = beside;
      if (!p || !p.matches('p:not(.eq)')) {
        p = document.createElement('p');
        p.innerHTML = '<br>';
        if (step < 0) node.before(p); else node.after(p);
      }
      r = step < 0 ? caretAtEnd(p) : caretAtStart(p);
    } else if (step < 0) r.setStartBefore(node);
    else r.setStartAfter(node);
  }
  if (body) {
    syncChapter(body, body.closest('.chapter').dataset.id);
    if (tex !== was) breakRun++; else undoStack.pop(); // nothing changed, nothing to take back
    body.contentEditable = 'false';
    body.contentEditable = 'true';
  }
  // a click or a move that took the caret elsewhere keeps it there
  if (gone && !node.contains(gone.startContainer)) r = field && field.contains(gone.startContainer) ? gone : null;
  if (field && r) {
    field.focus({ preventScroll: true });
    s.removeAllRanges();
    s.addRange(settleCaret(r));
  }
  if (!body && field) field.dispatchEvent(new Event('input'));
  if (into && into.matches('figure')) enterFigure(into, step);
  else if (into) { field.focus({ preventScroll: true }); editMath(into, { caret: step < 0 ? 'end' : 'start' }); }
  paperRenumberSoon();
}
// A caret between two elements, moved into the text beside it: the engine
// keeps a caret in text where it puts it
function settleCaret(r) {
  const c = r.startContainer;
  const o = r.startOffset;
  if (c.nodeType === 1) {
    const after = c.childNodes[o];
    const before = c.childNodes[o - 1];
    if (after && after.nodeType === 3) r.setStart(after, 0);
    else if (before && before.nodeType === 3) r.setStart(before, before.length);
  }
  r.collapse(true);
  return r;
}
function caretAtStart(p) {
  const r = document.createRange();
  r.setStart(p, 0);
  return r;
}
function caretAtEnd(p) {
  const r = document.createRange();
  const last = p.lastChild;
  if (!last || (last.nodeName === 'BR' && p.childNodes.length === 1)) r.setStart(p, 0);
  else if (last.nodeType === 3) r.setStart(last, last.length);
  else r.setStart(p, p.childNodes.length - (last.nodeName === 'BR' ? 1 : 0));
  return r;
}
// Is the caret on the first (dir < 0) or last (dir > 0) line of what's in el?
function caretOnEdgeLine(el, r, dir) {
  const all = document.createRange();
  all.selectNodeContents(el);
  const lines = [...all.getClientRects()].filter((x) => x.height);
  const c = [...r.getClientRects()].find((x) => x.height);
  if (!lines.length || !c) {
    // no box to measure (an empty line): is there anything on that side?
    const side = document.createRange();
    side.selectNodeContents(el);
    if (dir < 0) side.setEnd(r.startContainer, r.startOffset); else side.setStart(r.startContainer, r.startOffset);
    return !side.toString().replace(/\u200B/g, '').length;
  }
  return dir < 0 ? c.top - Math.min(...lines.map((x) => x.top)) < c.height / 2
    : Math.max(...lines.map((x) => x.bottom)) - c.bottom < c.height / 2;
}
// keys while maths is being written
function mathEditKey(e, node) {
  const display = node.classList.contains('eq');
  const cmd = e.metaKey || e.ctrlKey;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishMath(false); return true; }
  if (e.key === 'Enter' && !(display && e.shiftKey)) { e.preventDefault(); finishMath(true); return true; }
  if (e.key === 'Enter') {
    // a line of the equation's TeX: into its text by hand, as the engine
    // would split the equation in two at a typed line end
    e.preventDefault();
    const r = window.getSelection().getRangeAt(0);
    if (r.startContainer !== node.firstChild || r.endContainer !== node.firstChild) return true;
    r.deleteContents();
    const at = r.startOffset;
    // a line end last in the text draws no line: a place-holder gives it one
    node.firstChild.insertData(at, at === node.firstChild.length ? '\n' + MATH_HOLD : '\n');
    placeCaret(node.firstChild, at + 1);
    mathPreview(node);
    return true;
  }
  if (e.key === 'Tab') { e.preventDefault(); finishMath(true, { step: e.shiftKey ? -1 : 1 }); return true; }
  const tex = texOf(node);
  // ⌘A: all of the TeX, not all of the paper
  if (cmd && !e.altKey && !e.shiftKey && (e.code === 'KeyA' || e.key.toLowerCase() === 'a')) {
    e.preventDefault();
    texCaret(node, 0, tex.length);
    return true;
  }
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  if (!sel.isCollapsed) return !cmd;
  const r = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(node);
  pre.setEnd(r.startContainer, r.startOffset);
  const at = pre.toString().replace(/\u200B/g, '').length;
  const len = tex.length;
  const plain = !cmd && !e.altKey && !e.shiftKey;
  // Home and End (⌘← ⌘→ on a Mac) keep to the TeX's line
  const home = (plain && e.key === 'Home') || (IS_MAC && e.metaKey && !e.altKey && !e.shiftKey && e.key === 'ArrowLeft');
  const end = (plain && e.key === 'End') || (IS_MAC && e.metaKey && !e.altKey && !e.shiftKey && e.key === 'ArrowRight');
  if (home || end) {
    e.preventDefault();
    let i = home ? tex.lastIndexOf('\n', at - 1) + 1 : tex.indexOf('\n', at);
    if (i < 0) i = len;
    texCaret(node, i);
    return true;
  }
  if (!plain) return !cmd;
  // arrowing past either end steps out of the maths, and so does deleting
  // past it: the words beside it are the page's, not the TeX's
  if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && at === 0) {
    e.preventDefault();
    finishMath(true, { step: -1 });
    return true;
  }
  if ((e.key === 'ArrowRight' || e.key === 'Delete') && at === len) {
    e.preventDefault();
    finishMath(true, { step: 1 });
    return true;
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const dir = e.key === 'ArrowUp' ? -1 : 1;
    if (display) {
      if (!caretOnEdgeLine(node, r, dir)) return true;
      e.preventDefault();
      finishMath(true, { step: dir });
      return true;
    }
    // in the line, a line up or down is the sentence's: out, then on
    e.preventDefault();
    finishMath(true, { step: dir });
    window.getSelection().modify('move', dir < 0 ? 'backward' : 'forward', 'line');
    return true;
  }
  // anything else is typing TeX: none of the page's typography (curly
  // quotes, -- to a dash, *emphasis*) applies to it
  return true;
}
// Arrowing into maths opens it, the way arrowing past its ends closes it:
// ← or → beside maths in the line, and ← → ↑ ↓ from the lines around an
// equation. A figure or table beside the line is stepped into the same
// way, at its caption or its cells. Backspace after maths and Delete
// before it open it too, and next to a figure they step into its caption:
// no key takes a whole piece of the paper at once.
function paperStepIn(e, field) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
  const back = e.key === 'ArrowLeft' || e.key === 'Backspace';
  const fwd = e.key === 'ArrowRight' || e.key === 'Delete';
  const up = e.key === 'ArrowUp';
  const down = e.key === 'ArrowDown';
  if (!back && !fwd && !up && !down) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  if (!field.contains(r.startContainer)) return false;
  if (back || fwd) {
    const n = nodeBeside(r, back ? -1 : 1);
    if (n && n.matches('.math')) {
      e.preventDefault();
      editMath(n, { caret: back ? 'end' : 'start' });
      return true;
    }
  }
  const start = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
  const block = start && start.closest('p');
  if (!block || !field.contains(block) || block.matches('.eq') || block.closest('figure')) return false;
  const dir = back || up ? -1 : 1;
  const next = dir < 0 ? block.previousElementSibling : block.nextElementSibling;
  if (!next || !next.matches('p.eq, figure')) return false;
  if (!(up || down ? caretOnEdgeLine(block, r, dir) : atBlockEdge(block, r, dir))) return false;
  e.preventDefault();
  // Backspace on an empty line under an equation or a figure: the line goes, into it
  if ((e.key === 'Backspace' || e.key === 'Delete') && !block.textContent.replace(/\u200B/g, '').trim() && !block.querySelector(ATOMS)) {
    block.remove();
    const body = next.closest('.chapter-body');
    if (body) syncChapter(body, body.closest('.chapter').dataset.id);
  }
  if (next.matches('figure')) enterFigure(next, dir);
  else editMath(next, { caret: dir < 0 ? 'end' : 'start' });
  return true;
}

// A figure's or table's own places to write: its captions and cells, in order
const figPlaces = (fig) => [...fig.querySelectorAll('figcaption, .subcap, th, td')];
function caretInto(el, end) {
  el.focus({ preventScroll: true });
  const r = end ? caretAtEnd(el) : caretAtStart(el);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(settleCaret(r));
  revealCaret();
}
// into a figure on the way down or forward (dir > 0) at its first place,
// on the way up or back at its last
function enterFigure(fig, dir) {
  const places = figPlaces(fig);
  const at = dir > 0 ? places[0] : places[places.length - 1];
  if (at) caretInto(at, dir < 0);
}
// out of a figure, to what's before (dir < 0) or after it: a paragraph's
// end or start, an equation, another figure, or a new line to write on
// (always a line, with write: Enter and Esc go on with the writing)
function leaveFigure(fig, dir, { write = false } = {}) {
  const body = fig.closest('.chapter-body');
  let to = dir < 0 ? fig.previousElementSibling : fig.nextElementSibling;
  if (to && to.matches('figure') && !write) { enterFigure(to, dir); return; }
  body.focus({ preventScroll: true });
  if (to && to.matches('p.eq') && !write) { editMath(to, { caret: dir < 0 ? 'end' : 'start' }); return; }
  if (!to || !to.matches('p:not(.eq)')) {
    to = document.createElement('p');
    to.innerHTML = '<br>';
    if (dir < 0) fig.before(to); else fig.after(to);
    syncChapter(body, body.closest('.chapter').dataset.id);
  }
  caretInto(to, dir < 0);
}
// on to the figure's next place to write (or the one before), else out of it
function stepFigure(fig, place, dir) {
  const places = figPlaces(fig);
  const to = places[places.indexOf(place) + dir];
  if (to) caretInto(to, dir < 0); else leaveFigure(fig, dir);
}
// the element right beside a caret, if it stands next to one
function nodeBeside(r, dir) {
  const c = r.startContainer;
  const o = r.startOffset;
  let n;
  if (c.nodeType === 3) {
    if (dir < 0 ? o > 0 : o < c.length) return null;
    n = dir < 0 ? c.previousSibling : c.nextSibling;
  } else n = dir < 0 ? c.childNodes[o - 1] : c.childNodes[o];
  while (n && n.nodeType === 3 && !n.data.length) n = dir < 0 ? n.previousSibling : n.nextSibling;
  return n && n.nodeType === 1 && n.nodeName !== 'BR' ? n : null;
}
// nothing in the paragraph before (dir < 0) or after (dir > 0) the caret
function atBlockEdge(block, r, dir) {
  const side = document.createRange();
  side.selectNodeContents(block);
  if (dir < 0) side.setEnd(r.startContainer, r.startOffset); else side.setStart(r.startContainer, r.startOffset);
  return !side.toString().replace(/\u200B/g, '').length && !side.cloneContents().querySelector(ATOMS);
}
// a click anywhere else, or the window losing the caret, finishes it
document.addEventListener('mousedown', (e) => {
  if (mathEditing && !mathEditing.node.contains(e.target)) finishMath(true, { place: false });
}, true);
document.addEventListener('selectionchange', () => {
  if (!mathEditing) return;
  const sel = window.getSelection();
  // a selection reaching out of the TeX is the page's again
  const out = (n) => n && !mathEditing.node.contains(n);
  if (sel && (out(sel.anchorNode) || out(sel.focusNode))) finishMath(true, { place: false });
});

// ⌘⇧M: maths where the caret is — a display equation on an empty line,
// inline maths in the middle of a sentence
function paperInsertEquation() {
  // in the abstract: maths in the line (it has no numbered equations)
  const sel = window.getSelection();
  const at = sel.rangeCount && sel.anchorNode;
  const abs = at && (at.nodeType === 3 ? at.parentElement : at).closest('#tp-abstract');
  if (abs) {
    const node = placeAtom(sel.getRangeAt(0), `<span class="math" contenteditable="false">${escHtml(sel.isCollapsed ? '' : sel.toString())}</span>`, 'maths');
    drawMath(node);
    editMath(node);
    return;
  }
  const body = paperCaretBody();
  if (!body) return;
  const block = caretBlock(body);
  const chId = body.closest('.chapter').dataset.id;
  if (!block || !block.textContent.trim()) {
    snapshotStructure('equation');
    const eq = makeDisplayEq('');
    if (block) block.replaceWith(eq); else body.appendChild(eq);
    if (!eq.nextElementSibling || !eq.nextElementSibling.matches('p:not(.eq)')) {
      const after = document.createElement('p');
      after.innerHTML = '<br>';
      eq.after(after);
    }
    syncChapter(body, chId);
    resetNativeUndo();
    breakRun++;
    editMath(eq);
    return;
  }
  const selected = sel.isCollapsed ? '' : sel.toString();
  const node = placeAtom(sel.getRangeAt(0), `<span class="math" contenteditable="false">${escHtml(selected)}</span>`, 'maths');
  editMath(node);
}

// The chapter the caret is in, or (from a menu, with the caret elsewhere)
// the paper's own; null with a word to the writer when there's none
function paperCaretBody() {
  if (currentTab !== 'manuscript') switchTab('manuscript');
  const sel = window.getSelection();
  let el = sel && sel.rangeCount ? sel.anchorNode : null;
  if (el && el.nodeType === 3) el = el.parentElement;
  const body = el && el.closest ? el.closest('.chapter-body') : null;
  if (body && !el.closest('figure')) return body;
  toast(t('Click where it should go, in the paper, then try again'));
  return null;
}

/* ------------------------------------------------------------------ */
/*  A small panel under something on the page (maths, a citation)     */
/* ------------------------------------------------------------------ */

let paperPopEl = null;
function paperPop(anchor, cls) {
  closePaperPop();
  const pop = document.createElement('div');
  pop.className = 'paper-pop ' + cls;
  document.body.appendChild(pop);
  paperPopEl = pop;
  const place = () => {
    if (!anchor.isConnected) { closePaperPop(); return; }
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    const below = r.bottom + 8;
    pop.style.top = (below + pop.offsetHeight > window.innerHeight - 8 ? Math.max(8, r.top - pop.offsetHeight - 8) : below) + 'px';
  };
  pop.place = place;
  requestAnimationFrame(place);
  setTimeout(() => {
    const away = (e) => {
      if (!paperPopEl || paperPopEl !== pop) { document.removeEventListener('mousedown', away, true); return; }
      if (pop.contains(e.target)) return;
      document.removeEventListener('mousedown', away, true);
      if (pop.onAway) pop.onAway(); else closePaperPop();
    };
    document.addEventListener('mousedown', away, true);
  }, 0);
  $('#paper-scroll').addEventListener('scroll', place, { passive: true });
  pop.unplace = () => $('#paper-scroll').removeEventListener('scroll', place);
  return pop;
}
function closePaperPop() {
  if (!paperPopEl) return;
  const pop = paperPopEl;
  paperPopEl = null;
  if (pop.unplace) pop.unplace();
  pop.remove();
}

/* ------------------------------------------------------------------ */
/*  Citations and the reference list                                  */
/* ------------------------------------------------------------------ */

const citeData = (node) => {
  try {
    const list = JSON.parse(node.dataset.cite || '[]');
    return Array.isArray(list) ? list.filter((x) => x && typeof x.id === 'string' && NeoReferences.KEY.test(x.id)) : [];
  } catch { return []; }
};
const citeAttr = (items) => escHtml(JSON.stringify(items)).replace(/"/g, '&quot;');
const citeHtml = (items, narrative) => `<span class="cite" contenteditable="false"${narrative ? ' data-narrative=""' : ''} data-cite="${citeAttr(items)}">${escHtml(items.map((x) => '@' + x.id).join('; '))}</span>`;

// The style's XML (shipped, or the paper's own style.csl), or null
async function paperStyleXml(id) {
  if (id === 'custom' && !paper.styleXml.custom) {
    const b64 = await window.neo.paperRead(book.id, 'style.csl');
    if (!b64) return null; // style.csl hasn't arrived from the other device yet
    paper.styleXml.custom = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  }
  if (!paper.styleXml[id]) {
    const known = NeoCite.STYLES.find((s) => s.id === id) || NeoCite.STYLES[0];
    paper.styleXml[id] = await paperAsset(known.file);
  }
  return paper.styleXml[id];
}
async function paperLocales() {
  if (!paper.locales) {
    const [us, gb] = await Promise.all([paperAsset('locales-en-US.xml'), paperAsset('locales-en-GB.xml')]);
    paper.locales = { 'en-US': us, 'en-GB': gb };
  }
  return paper.locales;
}
// Every citation set in a processor's style, and its reference list,
// without touching the page (for a preview in another journal's style)
function paperRenderCites(proc) {
  // in reading order: the page's citations, and a table of symbols' sources where it stands
  const nodes = [];
  const clusters = [];
  for (const n of document.querySelectorAll('#chapters .cite, #chapters p.symtab')) {
    if (n.matches('.cite')) {
      nodes.push(n);
      clusters.push({ key: n, items: citeData(n), narrative: n.hasAttribute('data-narrative') });
    } else {
      for (const sym of symtabRows(n)) {
        const items = (sym.cite || []).filter((x) => x && NeoReferences.KEY.test(x.id));
        if (items.length) clusters.push({ key: symtabKey(n, sym.id), items, narrative: false });
      }
    }
  }
  const out = proc.render(clusters.map((c, i) => ({ id: i, items: c.items, narrative: c.narrative })));
  const text = new Map();
  clusters.forEach((c, i) => {
    const html = out.text.get(i);
    text.set(c.key, html ? paperSafe(html) : '(' + c.items.map((x) => '?' + escHtml(x.id)).join('; ') + ')');
  });
  return { nodes, text, missing: out.missing, order: out.order, bibliography: proc.bibliography() };
}

async function paperProcessor() {
  const m = paperMeta();
  let id = m.style || NeoCite.DEFAULT_STYLE;
  if (paper.proc && paper.procStyle === id) return paper.proc;
  if (!window.CSL) return null;
  await paperLocales();
  let xml = await paperStyleXml(id);
  if (!xml) { id = NeoCite.DEFAULT_STYLE; xml = await paperStyleXml(id); }
  try {
    paper.proc = NeoCite.processor({ style: xml, locales: paper.locales, items: paper.refs });
  } catch (err) {
    window.neo.logError('citation style: ' + (err && err.stack || err));
    toast(t('That citation style didn’t load ({error}); using APA', { error: String(err && err.message || err) }), 8000);
    m.style = NeoCite.DEFAULT_STYLE;
    scheduleMetaSave();
    return paperProcessor();
  }
  paper.procStyle = id;
  return paper.proc;
}

let paperCiteTimer = null;
function paperCiteSoon(ms = 150) {
  clearTimeout(paperCiteTimer);
  paperCiteTimer = setTimeout(paperCiteNow, ms);
}
// Every citation in reading order, set in the paper's style; then the list
let paperCiting = Promise.resolve();
function paperCiteNow() {
  const step = paperCiting.then(async () => {
    if (!book || !isPaper()) return;
    const proc = await paperProcessor();
    if (!proc || !book || !isPaper()) return;
    let out;
    try {
      out = paperRenderCites(proc);
    } catch (err) {
      window.neo.logError('citations: ' + (err && err.stack || err));
      return;
    }
    const touched = new Set();
    paper.citeText = out.text;
    out.nodes.forEach((n) => {
      const missing = citeData(n).filter((x) => out.missing.includes(x.id)).map((x) => x.id);
      const shown = out.text.get(n);
      // a reference not here (perhaps references.json hasn't synced yet)
      // leaves the citation's words as they were saved, only marked
      const keep = missing.length && n.textContent.trim();
      if (!keep && n.innerHTML !== shown) { n.innerHTML = shown; touched.add(n.closest('.chapter-body')); }
      if (missing.length) {
        n.setAttribute('data-missing', '');
        n.dataset.state = t('Not in this paper’s references: {keys}', { keys: missing.join(', ') });
      } else if (n.hasAttribute('data-missing')) {
        n.removeAttribute('data-missing');
        delete n.dataset.state;
      }
    });
    // a citation set afresh is part of what the chapter says: saved with it
    for (const body of touched) if (body) syncChapter(body, body.closest('.chapter').dataset.id);
    // the tables of symbols, their sources set with the rest (drawn, never saved)
    for (const b of document.querySelectorAll('#chapters p.symtab')) drawSymbolTable(b);
    paper.bibliography = out.bibliography;
    paper.cited = out.order;
    paperShowRefs();
    if (currentTab === 'references') paperLibraryRender();
    if (touched.size) paperPreviewSoon();
  });
  // one that fails (a style or locale that didn't read) is the caller's to
  // hear about; the ones after it still run
  paperCiting = step.catch((err) => window.neo.logError('citations: ' + (err && err.stack || err)));
  return step;
}

// The reference list after the last page: made, never typed
function paperRefsBlock(on) {
  let el = $('#paper-refs');
  if (!on) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('section');
    el.id = 'paper-refs';
    el.className = 'sheet';
    $('#chapters').after(el);
  }
  paperShowRefs();
}
function paperShowRefs() {
  const el = $('#paper-refs');
  if (!el) return;
  const bib = paper.bibliography;
  el.innerHTML = '';
  const h = document.createElement('h2');
  h.textContent = t('References');
  el.appendChild(h);
  if (!bib || !bib.entries.length) {
    const p = document.createElement('p');
    p.className = 'pr-empty';
    p.textContent = paper.refs.length
      ? t('Cite with @ and the list makes itself here.')
      : t('Cite with @. Paste a DOI after the @, or add references in the References tab.');
    el.appendChild(p);
    return;
  }
  const list = document.createElement('div');
  list.className = 'pr-list' + (bib.hanging ? ' hanging' : '') + (bib.numeric ? ' numeric' : '');
  for (const e of bib.entries) {
    const row = document.createElement('div');
    row.className = 'pr-entry';
    row.dataset.ref = e.id;
    row.innerHTML = paperSafe(e.html);
    list.appendChild(row);
  }
  el.appendChild(list);
}
// citeproc's HTML, rebuilt from what a citation or a reference can hold:
// emphasis, sub/superscript, citeproc's own csl-* blocks, and links to
// http(s) addresses. Reference data is anyone's (a .bib file, a DOI
// lookup), so nothing else from it reaches the page or an export.
function paperSafe(html, { links = false } = {}) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const out = (node) => [...node.childNodes].map((n) => {
    if (n.nodeType === 3) return escHtml(n.data);
    if (n.nodeType !== 1) return '';
    const tag = n.tagName.toLowerCase();
    const inner = out(n);
    if (['i', 'b', 'sup', 'sub'].includes(tag)) return `<${tag}>${inner}</${tag}>`;
    if (tag === 'em') return `<i>${inner}</i>`;
    if (tag === 'strong') return `<b>${inner}</b>`;
    const cls = /^csl-[\w-]+$/.test(n.className) ? ` class="${n.className}"` : '';
    if (tag === 'div') return `<div${cls}>${inner}</div>`;
    if (tag === 'span') {
      const it = /font-style:\s*italic/.test(n.getAttribute('style') || '');
      return it ? `<i>${inner}</i>` : cls ? `<span${cls}>${inner}</span>` : inner;
    }
    if (tag === 'a') {
      const href = n.getAttribute('href') || '';
      return links && /^https?:\/\//i.test(href) ? `<a href="${escHtml(href).replace(/"/g, '&quot;')}">${inner}</a>` : inner;
    }
    return inner;
  }).join('');
  return out(doc.body.firstChild);
}

/* ---- the @ picker: references to cite, and what can be referred to ---- */

const picker = { el: null, body: null, at: null, mark: '@', rows: [], idx: 0, mode: 'all', busy: false, zotero: { q: '', items: [], timer: null, down: 0 } };

// / on a line of its own: what can go there, found by a word, or by its
// LaTeX name (/includegraphics, /section, /ref). A / anywhere else is a /.
const INSERT_COMMANDS = [
  { id: 'figure', label: tk('Figure…'), what: tk('A picture from a file, numbered, with its caption'), words: ['figure', 'image', 'picture', 'includegraphics', 'graphic', 'photo'] },
  { id: 'table', label: tk('Table'), what: tk('Rows and columns to fill in, numbered, with its caption'), words: ['table', 'tabular'] },
  { id: 'equation', label: tk('Equation'), what: tk('A numbered equation, in TeX'), words: ['equation', 'eq', 'maths', 'math', 'displaymath', 'align'] },
  { id: 'cite', label: tk('Citation…'), what: tk('One of the paper’s references'), words: ['cite', 'citation', 'citep', 'citet', 'reference'] },
  { id: 'xref', label: tk('Cross-Reference…'), what: tk('A section, figure, table or equation, by its number'), words: ['ref', 'cross-reference', 'xref', 'cref', 'autoref', 'eqref'] },
  { id: 'ul', label: tk('Bulleted List'), what: tk('Or type - and a space at the start of a line'), words: ['list', 'bullets', 'itemize', 'ul'] },
  { id: 'ol', label: tk('Numbered List'), what: tk('Or type 1. and a space at the start of a line'), words: ['numbered', 'enumerate', 'ol'] },
  { id: 'symbol', label: tk('Symbol…'), what: tk('A symbol of the paper’s own, defined once: then \\name and a space'), words: ['symbol', 'newcommand', 'notation', 'parameter', 'variable'] },
  { id: 'symbols', label: tk('Table of Symbols'), what: tk('The symbols marked for it, with their meanings, values and sources'), words: ['symbols', 'nomenclature', 'printnomenclature', 'glossary', 'parameters'] },
  { id: 'h1', label: tk('Section Heading'), words: ['section', 'heading', 'h1'] },
  { id: 'h2', label: tk('Subsection Heading'), words: ['subsection', 'h2'] },
  { id: 'h3', label: tk('Subsubsection Heading'), words: ['subsubsection', 'h3'] }
];
function insertCommands(q) {
  q = q.trim().toLowerCase().replace(/^\\/, '');
  // a whole name first (/ref is a cross-reference, not a reference), then by its own word
  const rank = (c) => (c.words.includes(q) ? 0 : c.words[0].startsWith(q) ? 1 : 2);
  return INSERT_COMMANDS.filter((c) => c.words.some((w) => w.startsWith(q))).sort((a, b) => rank(a) - rank(b));
}
async function runInsertCommand(id, body) {
  if (id === 'figure') await paperInsertFigure();
  else if (id === 'table') paperInsertTable();
  else if (id === 'equation') paperInsertEquation();
  else if (id === 'cite' || id === 'xref') paperPickAtCaret(id);
  else if (id === 'symbol') await paperNewSymbolHere();
  else if (id === 'symbols') paperInsertSymbolTable();
  else if (id === 'ul' || id === 'ol') {
    const block = caretBlock(body);
    if (!block) return;
    snapshotStructure('list');
    setListItem(block, id, 1);
    syncChapter(body, body.closest('.chapter').dataset.id);
    paperRenumber();
  } else paperSetHeading(id, body);
}
// The command palette's share of a paper (app.js, COMMAND PALETTE): what /
// inserts that no menu has, and the sections, to go to
function paperPaletteCommands() {
  const inserts = INSERT_COMMANDS.filter((c) => ['ul', 'ol', 'symbol', 'symbols'].includes(c.id)).map((c) => ({
    id: 'insert:' + c.id, label: t(c.label), path: [t('Insert')], accel: '',
    run: async () => { const body = paperCaretBody(); if (body) await runInsertCommand(c.id, body); }
  }));
  const sections = paperHeadings().map((h) => ({
    id: 'goto:' + h.dataset.id, label: [h.dataset.num, h.textContent.trim()].filter(Boolean).join(' '), path: [t('Go to')], goto: true,
    run: () => {
      switchTab('manuscript');
      h.closest('.chapter-body').focus({ preventScroll: true });
      caretInto(h, true);
      h.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    }
  }));
  return [...inserts, ...sections];
}
function pickerOpenOnSlash(e, body) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const block = caretBlock(body);
  if (!block || !block.matches('p') || block.matches('.eq') || headingOf(block) || block.closest('figure')) return false;
  if (block.textContent.trim() || block.querySelector(ATOMS)) return false;
  e.preventDefault();
  document.execCommand('insertText', false, '/');
  pickerOpen(body, 'insert', '/');
  return true;
}

// Zotero's library, searched as the @ is typed (paper:zotero in main.js):
// a moment after the typing pauses, and not again for a minute if Zotero
// isn't there
function pickerZotero(q) {
  const z = picker.zotero;
  if (!window.neo.paperZotero || q.trim().length < 3 || Date.now() < z.down || picker.mode === 'xref') return;
  if (z.q === q) return;
  clearTimeout(z.timer);
  z.timer = setTimeout(async () => {
    let found;
    try { found = await window.neo.paperZotero(q.trim()); } catch { found = null; }
    if (found === null) { z.down = Date.now() + 60000; return; }
    z.q = q;
    // what isn't in the paper's references already
    z.items = (found || []).filter((it) => it && it.title && !paper.refs.some((r) => (it.id && r.id === it.id) || NeoReferences.sameWork(r, it)));
    if (picker.el && pickerQuery() === q) pickerUpdate();
  }, 250);
}

function pickerOpenOnAt(e, body) {
  const sel = window.getSelection();
  if (!sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  const block = caretBlock(body);
  if (!block || block.classList.contains('eq')) return false;
  const pre = document.createRange();
  pre.selectNodeContents(block);
  pre.setEnd(r.startContainer, r.startOffset);
  const before = pre.toString();
  // an @ that starts a word: not the one in an email address
  if (before && !/[\s([{;,"“‘' ]$/.test(before)) return false;
  e.preventDefault();
  document.execCommand('insertText', false, '@');
  pickerOpen(body, 'all');
  return true;
}

function pickerOpen(body, mode, mark = '@') {
  pickerClose();
  const sel = window.getSelection();
  const r = sel.getRangeAt(0);
  if (r.startContainer.nodeType !== 3 || r.startOffset < 1 || r.startContainer.data[r.startOffset - 1] !== mark) return;
  picker.body = body;
  picker.mark = mark;
  picker.at = { node: r.startContainer, offset: r.startOffset - 1 };
  picker.mode = mode;
  picker.idx = 0;
  picker.el = document.createElement('div');
  picker.el.className = 'paper-picker';
  picker.el.setAttribute('role', 'listbox');
  picker.el.addEventListener('mousedown', (e) => e.preventDefault());
  document.body.appendChild(picker.el);
  body.addEventListener('input', pickerUpdate);
  document.addEventListener('selectionchange', pickerFollow);
  pickerUpdate();
}
function pickerClose() {
  if (!picker.el) return;
  picker.el.remove();
  picker.el = null;
  if (picker.body) picker.body.removeEventListener('input', pickerUpdate);
  document.removeEventListener('selectionchange', pickerFollow);
  picker.body = null;
}
// what has been typed after the @ (or /), or null once the caret has left it
function pickerQuery() {
  const { node, offset } = picker.at;
  const sel = window.getSelection();
  if (!node.isConnected || !sel.rangeCount || !sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if (r.startContainer !== node || r.startOffset <= offset || node.data[offset] !== picker.mark) return null;
  const q = node.data.slice(offset + 1, r.startOffset);
  return /\n/.test(q) || q.length > 120 ? null : q;
}
function pickerFollow() {
  if (picker.el && pickerQuery() === null && !picker.busy) pickerClose();
}
function pickerUpdate() {
  if (!picker.el) return;
  const q = pickerQuery();
  if (q === null) { pickerClose(); return; }
  if (picker.mode === 'insert') {
    // nothing by that name: the / was a /
    const found = /\s/.test(q) ? [] : insertCommands(q);
    if (!found.length) { pickerClose(); return; }
    picker.rows = found.map((command) => ({ kind: 'command', command }));
    picker.idx = Math.min(picker.idx, picker.rows.length - 1);
    pickerDraw(q);
    return;
  }
  const rows = [];
  const ident = NeoReferences.findIdentifier(q);
  if (ident && picker.mode !== 'xref') rows.push({ kind: 'lookup', ident });
  const words = q.trim().toLowerCase();
  if (picker.mode !== 'xref' && !ident) {
    paper.refs.map((it) => ({ it, s: NeoReferences.score(it, words) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || NeoReferences.shortLabel(a.it).localeCompare(NeoReferences.shortLabel(b.it)))
      .slice(0, picker.mode === 'cite' ? 8 : 6)
      .forEach((x) => rows.push({ kind: 'ref', item: x.it }));
  }
  if (picker.mode !== 'cite' && !ident) {
    // "fig", "tab", "eq", "sec" narrow it to those
    const kindWord = /^(fig|tab|tbl|eq|sec)\w*:?\s*/.exec(words);
    const want = kindWord ? { fig: 'fig', tab: 'tbl', tbl: 'tbl', eq: 'eq', sec: 'sec' }[kindWord[1]] : null;
    const rest = kindWord ? words.slice(kindWord[0].length) : words;
    paperTargets()
      .filter((x) => (!want || x.kind === want) && (!rest || (x.label + ' ' + x.text).toLowerCase().includes(rest)))
      .slice(0, want || picker.mode === 'xref' ? 10 : 4)
      .forEach((x) => rows.push({ kind: 'label', target: x }));
  }
  // from Zotero, under what the paper already has
  if (picker.mode !== 'xref' && !ident) {
    pickerZotero(q);
    if (picker.zotero.q === q) for (const it of picker.zotero.items.slice(0, 5)) rows.push({ kind: 'zotero', item: it });
  }
  if (!rows.length) {
    // nothing matches, and nothing ever will at this point: the @ is just an @
    if (words.length > 2 && /\s$/.test(q)) { pickerClose(); return; }
    rows.push({ kind: 'hint' });
  }
  picker.rows = rows;
  picker.idx = Math.min(picker.idx, rows.length - 1);
  pickerDraw(q);
}
function pickerDraw(q) {
  const el = picker.el;
  const scrolled = el.scrollTop; // drawn again, the list stays where it was scrolled to
  el.innerHTML = '';
  picker.rows.forEach((row, i) => {
    const item = document.createElement('div');
    item.className = 'pp-row pp-' + row.kind + (i === picker.idx ? ' active' : '');
    item.setAttribute('role', 'option');
    const main = document.createElement('span');
    main.className = 'pp-main';
    const sub = document.createElement('span');
    sub.className = 'pp-sub';
    if (row.kind === 'ref') {
      main.textContent = NeoReferences.shortLabel(row.item);
      sub.textContent = row.item.title || row.item.id;
    } else if (row.kind === 'command') {
      main.textContent = t(row.command.label);
      sub.textContent = row.command.what ? t(row.command.what) : '';
    } else if (row.kind === 'label') {
      main.textContent = row.target.label;
      sub.textContent = row.target.text;
    } else if (row.kind === 'zotero') {
      main.textContent = t('From Zotero: {ref}', { ref: NeoReferences.shortLabel({ ...row.item, id: row.item.id || '' }) });
      sub.textContent = row.item.title || '';
    } else if (row.kind === 'lookup') {
      main.textContent = picker.busy ? t('Looking it up…') : (row.ident.type === 'doi' ? t('Look up DOI {id}', { id: row.ident.id }) : t('Look up arXiv {id}', { id: row.ident.id }));
      sub.textContent = picker.busy ? '' : t('Enter adds it to the references and cites it');
    } else {
      main.textContent = paper.refs.length || picker.mode === 'xref' ? t('Nothing matches “{q}”', { q }) : t('No references yet');
      sub.textContent = picker.mode === 'xref'
        ? t('Headings, figures, tables and equations can be referred to')
        : t('Paste a DOI or arXiv ID after the @, or drop a .bib file on the page · Esc keeps the @');
    }
    item.append(main, sub);
    if (row.kind !== 'hint') item.addEventListener('click', () => { picker.idx = i; pickerChoose(); });
    el.appendChild(item);
  });
  // under the @ (or over it, where there's more room), never taller than
  // that room and never over the line being typed: a long list scrolls,
  // and the row the arrows reach is always in view
  const r = document.createRange();
  r.setStart(picker.at.node, picker.at.offset);
  r.setEnd(picker.at.node, picker.at.offset + 1);
  const box = r.getBoundingClientRect();
  const w = el.offsetWidth;
  el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, box.left - 12)) + 'px';
  el.style.maxHeight = '';
  const below = window.innerHeight - box.bottom - 14;
  const above = box.top - 14;
  const up = el.offsetHeight > below && above > below;
  el.style.maxHeight = Math.max(80, Math.min(el.offsetHeight, up ? above : below)) + 'px';
  el.style.top = (up ? box.top - 6 - el.offsetHeight : box.bottom + 6) + 'px';
  el.scrollTop = scrolled;
  const active = el.children[picker.idx];
  if (active) active.scrollIntoView({ block: 'nearest' });
}
function pickerKey(e) {
  if (!picker.el) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = picker.rows.length;
    picker.idx = (picker.idx + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    pickerDraw(pickerQuery() || '');
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    if (picker.rows[picker.idx] && picker.rows[picker.idx].kind !== 'hint') {
      e.preventDefault();
      pickerChoose();
      return true;
    }
    pickerClose();
    return false;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    pickerClose();
    return true;
  }
  return false;
}
async function pickerChoose() {
  const row = picker.rows[picker.idx];
  if (!row || picker.busy) return;
  if (row.kind === 'lookup') {
    picker.busy = true;
    pickerDraw(pickerQuery() || '');
    let item = null;
    try {
      item = await paperLookup(row.ident);
    } catch (err) {
      toast(t('Couldn’t look that up: {error}', { error: plainError(err) }), 8000);
    } finally {
      picker.busy = false;
    }
    if (!item || !picker.el) { if (picker.el) pickerUpdate(); return; }
    pickerInsert(citeHtml([{ id: item.id }]));
    toast(t('Added to the references: {ref}', { ref: NeoReferences.shortLabel(item) }));
    return;
  }
  if (row.kind === 'command') {
    // the /word goes, and what it names goes in its place
    const q = pickerQuery();
    const { node, offset } = picker.at;
    const body = picker.body;
    pickerClose();
    if (q === null) return;
    const r = document.createRange();
    r.setStart(node, offset);
    r.setEnd(node, offset + 1 + q.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    document.execCommand('delete');
    await runInsertCommand(row.command.id, body);
    return;
  }
  if (row.kind === 'ref') pickerInsert(citeHtml([{ id: row.item.id }]), row.item.id);
  else if (row.kind === 'zotero') {
    // into the paper's references (with Zotero's citation key when it has one), then cited
    const { items, keys } = NeoReferences.mergeReferences(paper.refs, [paperTidyLookup(row.item, row.item.DOI || '')], { keepKeys: !!row.item.id });
    await paperSaveRefs(items);
    const id = keys[0];
    if (id) pickerInsert(citeHtml([{ id }]), id);
  }
  else if (row.kind === 'label') pickerInsert(`<span class="xref" contenteditable="false" data-ref="${escHtml(row.target.id)}">${escHtml(row.target.label)}</span>`);
}
// The @ and what was typed after it become the citation. One right after
// another citation (only a space between) joins it: @smith then @doe is
// (Smith, 2020; Doe, 2019).
function pickerInsert(html, refId) {
  const q = pickerQuery();
  const { node, offset } = picker.at;
  pickerClose();
  if (q === null) return;
  const r = document.createRange();
  r.setStart(node, offset);
  r.setEnd(node, offset + 1 + q.length);
  if (refId) {
    const prev = offset === 0 || /^\s?$/.test(node.data.slice(0, offset)) ? node.previousSibling : null;
    const gap = node.data.slice(0, offset);
    if (prev && prev.nodeType === 1 && prev.classList.contains('cite') && /^ ?$/.test(gap)) {
      const items = citeData(prev);
      if (!items.some((x) => x.id === refId)) items.push({ id: refId });
      r.setStartBefore(prev);
      html = citeHtml(items, prev.hasAttribute('data-narrative'));
    }
  }
  placeAtom(r, html, 'citation');
  paperCiteSoon(0);
  paperRenumberSoon();
}

// Insert → Citation… (⌘⇧K) and Cross-Reference…: the same picker, opened
// on an @ typed for the writer
function paperPickAtCaret(mode) {
  const body = paperCaretBody();
  if (!body) return;
  const sel = window.getSelection();
  if (!sel.isCollapsed) sel.collapseToEnd();
  const block = caretBlock(body);
  const pre = document.createRange();
  if (block) {
    pre.selectNodeContents(block);
    const r = sel.getRangeAt(0);
    pre.setEnd(r.startContainer, r.startOffset);
  }
  const before = block ? pre.toString() : '';
  document.execCommand('insertText', false, (before && !/\s$/.test(before) ? ' ' : '') + '@');
  pickerOpen(body, mode);
}

/* ---- a citation, clicked: pages, prefix, who's named, what's in it ---- */

function openCitePop(node, { keys = false } = {}) {
  const body = node.closest('.chapter-body');
  if (!body) return;
  const pop = paperPop(node, 'cite-pop');
  // Enter or Esc: the panel closes and the caret is back after the citation
  const back = () => {
    closePaperPop();
    if (!node.isConnected) return;
    body.focus({ preventScroll: true });
    caretAfter(node);
  };
  pop.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    back();
  });
  const draw = () => {
    const items = citeData(node);
    pop.innerHTML = '';
    items.forEach((x, i) => {
      const it = paper.refs.find((r) => r.id === x.id);
      const row = document.createElement('div');
      row.className = 'cp-row';
      const name = document.createElement('div');
      name.className = 'cp-name';
      name.textContent = it ? NeoReferences.shortLabel(it) : t('{key} (not in the references)', { key: x.id });
      if (it && it.title) name.title = it.title;
      const fields = document.createElement('div');
      fields.className = 'cp-fields';
      const input = (cls, ph, value, apply) => {
        const el = document.createElement('input');
        el.className = cls;
        el.placeholder = ph;
        el.setAttribute('aria-label', ph);
        el.value = value || '';
        el.spellcheck = false;
        el.addEventListener('change', () => { apply(el.value.trim()); commit(items); });
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') return; // the panel's
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); el.blur(); back(); }
        });
        return el;
      };
      fields.append(
        input('cp-prefix', t('before, e.g. see'), x.prefix, (v) => { if (v) x.prefix = v; else delete x.prefix; }),
        input('cp-loc', t('page, e.g. 12 or pp. 4–6'), x.locator ? (x.label && x.label !== 'page' ? x.label + ' ' : '') + x.locator : '', (v) => {
          const loc = NeoCite.parseLocator(v);
          if (loc.locator) { x.locator = loc.locator; x.label = loc.label; } else { delete x.locator; delete x.label; }
        })
      );
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'cp-del';
      del.textContent = '×';
      del.title = t('Take this reference out of the citation');
      del.setAttribute('aria-label', del.title);
      del.onclick = () => {
        items.splice(i, 1);
        if (!items.length) { closePaperPop(); removeNode(node); return; }
        commit(items);
        draw();
      };
      row.append(name, fields, del);
      pop.appendChild(row);
    });
    const foot = document.createElement('label');
    foot.className = 'cp-narrative';
    foot.innerHTML = '<input type="checkbox"> <span></span>';
    foot.querySelector('span').textContent = t('Name the authors in the sentence: Smith (2020)');
    foot.querySelector('input').checked = node.hasAttribute('data-narrative');
    foot.querySelector('input').onchange = (e) => {
      node.toggleAttribute('data-narrative', e.target.checked);
      commit(citeData(node));
    };
    pop.appendChild(foot);
    const hint = document.createElement('div');
    hint.className = 'cp-hint';
    hint.textContent = t('To cite another work here, type @ right after this citation');
    pop.appendChild(hint);
    if (pop.place) pop.place();
  };
  const commit = (items) => {
    node.dataset.cite = JSON.stringify(items);
    syncChapter(body, body.closest('.chapter').dataset.id);
    paperCiteSoon(0);
  };
  draw();
  // from the keyboard, the caret goes into the panel, at the first page
  if (keys) { const first = pop.querySelector('.cp-loc'); if (first) first.focus(); }
}
// a citation, cross-reference or maths taken out by the writer: ⌘Z brings it back
function removeNode(node) {
  const body = node.closest('.chapter-body');
  if (!body) { node.remove(); return; }
  body.focus({ preventScroll: true });
  const r = document.createRange();
  r.selectNode(node);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  document.execCommand('delete');
}

// a DOI or arXiv ID to a reference in this paper's list (the one already
// there if it is)
async function paperLookup(ident) {
  const doi = NeoReferences.identifierDoi(ident);
  const known = paper.refs.find((r) => r.DOI && r.DOI.toLowerCase() === doi.toLowerCase());
  if (known) return known;
  if (!window.neo.paperLookup) throw new Error(t('looking up needs the desktop app'));
  const csl = await window.neo.paperLookup(doi);
  const item = paperTidyLookup(csl, doi);
  const { items, keys } = NeoReferences.mergeReferences(paper.refs, [item]);
  await paperSaveRefs(items);
  return paper.refs.find((r) => r.id === keys[0]);
}
// doi.org's CSL JSON carries more than a reference needs
function paperTidyLookup(csl, doi) {
  const keep = ['type', 'title', 'author', 'editor', 'container-title', 'collection-title', 'volume', 'issue', 'page',
    'publisher', 'publisher-place', 'issued', 'DOI', 'URL', 'ISBN', 'ISSN', 'edition', 'number', 'genre', 'abstract'];
  const it = {};
  for (const k of keep) if (csl[k] !== undefined && csl[k] !== '' && !(Array.isArray(csl[k]) && !csl[k].length)) it[k] = csl[k];
  for (const k of ['container-title', 'title', 'ISSN', 'ISBN']) if (Array.isArray(it[k])) it[k] = it[k][0];
  if (!it.issued && csl.published) it.issued = csl.published;
  if (!it.issued && csl['published-print']) it.issued = csl['published-print'];
  if (!it.issued && csl['published-online']) it.issued = csl['published-online'];
  if (it.issued && it.issued['date-parts']) it.issued = { 'date-parts': [it.issued['date-parts'][0].filter((x) => x != null)] };
  if (it.DOI || doi) it.DOI = it.DOI || doi;
  // a citation key that came with it (Zotero's), not a DOI or a URL standing in for one
  if (typeof csl.id === 'string' && NeoReferences.KEY.test(csl.id) && /^[A-Za-z][^/]*$/.test(csl.id)) it.id = csl.id;
  if (it.abstract) it.abstract = it.abstract.replace(/<[^>]+>/g, '').trim();
  if (it.type === 'journal-article') it.type = 'article-journal';
  if (it.type === 'posted-content' || /arxiv/i.test(it.DOI)) {
    it.type = 'article';
    if (!it['container-title'] && /arxiv/i.test(it.DOI)) it['container-title'] = 'arXiv';
  }
  if (it.author) {
    it.author = it.author.map((a) => {
      const n = {};
      for (const k of ['family', 'given', 'literal', 'suffix', 'non-dropping-particle', 'dropping-particle']) if (a[k]) n[k] = a[k];
      return n;
    });
  }
  return it;
}

// The references to disk. references.json syncs like the chapters do, so
// what another device added since NEO last read it is kept: a reference
// there and not here comes in (by key) before the write, never lost to it.
let refsWriting = 0;
async function paperSaveRefs(items) {
  const bookId = book.id;
  const disk = await window.neo.readJSON(bookId, 'references', []);
  if (!book || book.id !== bookId) return;
  if (Array.isArray(disk) && JSON.stringify(disk) !== paper.refsSaved) {
    items = NeoReferences.keepTheirs(JSON.parse(paper.refsSaved || '[]'), items, disk);
  }
  paper.refs = items;
  if (paper.proc) paper.proc.setItems(items);
  const json = JSON.stringify(items);
  if (json !== paper.refsSaved) {
    refsWriting++;
    try {
      await window.neo.writeJSON(bookId, 'references', items);
      paper.refsSaved = json;
    } finally {
      refsWriting--;
    }
  }
  paperCiteSoon(0);
}

/* ------------------------------------------------------------------ */
/*  Symbols: the paper's own notation, defined once, used everywhere   */
/* ------------------------------------------------------------------ */

// symbols.json beside references.json: [{ id, tex, meaning, unit, table,
// kind, value, cite }], id being its name (\Vm). On the page a symbol is
// <span class="sym" data-sym="Vm"> holding its TeX, drawn from its
// definition, so a change to it shows everywhere; one whose definition is
// gone keeps the TeX it was saved with, drawn as maths and marked.
const symbolOf = (id) => paper.symbols.find((s) => s.id === id) || null;
const symHtml = (s) => `<span class="sym" contenteditable="false" data-sym="${escHtml(s.id)}">${escHtml(s.tex)}</span>`;
// the TeX a symbol on the page stands for, its definition's when it has one
const symTex = (n) => { const s = symbolOf(n.dataset.sym); return s ? s.tex : texOf(n); };
const KIND_NAMES = { parameter: tk('Parameter'), variable: tk('Variable') };
// why a name won't do, in a sentence (NeoSymbols.validKey's reasons)
const SYMBOL_NAME_WHY = {
  [NeoSymbols.LETTERS_ONLY]: tk('A symbol’s name is letters only, up to 30 of them, as \\Vm'),
  [NeoSymbols.TAKEN]: tk('Another symbol already has that name'),
  [NeoSymbols.LATEX_COMMAND]: tk('LaTeX already has a command of that name; choose another')
};

// To disk, keeping what another device added since NEO last read it
let symbolsWriting = 0;
async function paperSaveSymbols(items) {
  const bookId = book.id;
  const disk = await window.neo.readJSON(bookId, 'symbols', []);
  if (!book || book.id !== bookId) return;
  if (Array.isArray(disk) && JSON.stringify(disk) !== paper.symbolsSaved) items = NeoSymbols.keepTheirs(JSON.parse(paper.symbolsSaved || '[]'), items, disk);
  paper.symbols = items;
  const json = JSON.stringify(items);
  if (json !== paper.symbolsSaved) {
    symbolsWriting++;
    try {
      await window.neo.writeJSON(bookId, 'symbols', items);
      paper.symbolsSaved = json;
    } finally {
      symbolsWriting--;
    }
  }
  paperSymbolsShown();
}
// The page after the definitions change: each symbol's TeX (saved with the
// chapter, so it reads sensibly on its own), its drawing, the tables
function paperSymbolsShown() {
  const touched = new Set();
  for (const n of document.querySelectorAll('#chapters .sym, #tp-abstract .sym')) {
    const s = symbolOf(n.dataset.sym);
    if (s && n.textContent !== s.tex) { n.textContent = s.tex; touched.add(n.closest('.chapter-body, #tp-abstract')); }
    n.toggleAttribute('data-missing', !s);
    drawMath(n);
  }
  for (const f of touched) {
    if (!f) continue;
    if (f.matches('.chapter-body')) syncChapter(f, f.closest('.chapter').dataset.id);
    else f.dispatchEvent(new Event('input'));
  }
  // the tables' sources are citations, set with the rest
  paperCiteSoon(0);
  if (currentTab === 'references') paperLibraryRender();
}

// \mu then a space: μ. \Vm (one of the paper's own) then a space: the
// symbol. The key that ended the name still goes in; ⌘Z right after
// brings the TeX back. Never in maths, which is TeX already.
const SYMBOL_ENDS = [' ', '.', ',', ';', ':', '!', '?', ')', ']', 'Enter'];
function paperSymbolKey(e, field) {
  if (!SYMBOL_ENDS.includes(e.key) || !typedChar(e) || (e.key === 'Enter' && e.shiftKey)) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  const node = r.startContainer;
  if (node.nodeType !== 3 || !field.contains(node) || node.parentElement.closest('.math, .eq, .sym, .cite, .xref')) return false;
  const hit = NeoSymbols.autocorrect(node.data.slice(0, r.startOffset));
  if (!hit) return false;
  const own = symbolOf(hit.name);
  const ch = own ? null : NeoSymbols.charFor(hit.name);
  if (!own && !ch) return false;
  const range = document.createRange();
  range.setStart(node, hit.from);
  range.setEnd(node, r.startOffset);
  if (own) {
    const host = node.parentElement.closest('figcaption, .subcap, th, td');
    const sym = placeAtom(range, symHtml(own), 'symbol');
    drawMath(sym);
    // in a caption or a cell the caret goes back there, where its own words are
    if (host) { host.focus({ preventScroll: true }); caretAfter(sym); }
    if (!field.matches('.chapter-body')) field.dispatchEvent(new Event('input'));
  } else {
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, ch);
  }
  // Enter goes on to be the paragraph's; the rest are typed here
  if (e.key === 'Enter') return false;
  e.preventDefault();
  document.execCommand('insertText', false, e.key);
  return true;
}

// A symbol's definition, new or changed: its name, TeX, meaning, kind,
// value, unit, sources (citations of the paper's references) and whether
// the table of symbols lists it. Resolves with the symbol saved, or null.
function paperEditSymbol(sym = null, { tex = '' } = {}) {
  return new Promise((resolve) => {
    const draft = sym ? { ...sym, cite: [...(sym.cite || [])] } : { id: '', tex, meaning: '', unit: '', value: '', kind: '', table: true, cite: [] };
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal paper-ref paper-sym" role="dialog" aria-modal="true"><h2></h2><div class="ps-preview" aria-hidden="true"></div><div class="pr-grid"></div>
      <div class="pa-foot"><button class="m-cancel btn-quiet" type="button"></button><button class="m-ok btn-gold" type="button"></button></div></div>`;
    bd.querySelector('h2').textContent = sym ? t('Symbol') : t('New Symbol');
    bd.querySelector('.m-cancel').textContent = t('Cancel');
    bd.querySelector('.m-ok').textContent = t('Save');
    const grid = bd.querySelector('.pr-grid');
    const preview = bd.querySelector('.ps-preview');
    const row = (label, el, wide) => {
      const l = document.createElement('label');
      l.className = 'pr-field' + (wide ? ' wide' : '');
      const s = document.createElement('span');
      s.textContent = label;
      l.append(s, el);
      grid.appendChild(l);
      return el;
    };
    const input = (label, value, wide, ph) => {
      const el = document.createElement('input');
      el.spellcheck = false;
      el.value = value || '';
      if (ph) el.placeholder = ph;
      return row(label, el, wide);
    };
    const texIn = input(t('Its TeX'), draft.tex, false, 'V_\\mathrm{m}');
    const idIn = input(t('Its name, typed as \\name'), draft.id, false, 'Vm');
    const meaning = input(t('What it stands for'), draft.meaning, true, t('membrane potential'));
    const kind = document.createElement('select');
    for (const [v, l] of [['', tk('Neither')], ['parameter', KIND_NAMES.parameter], ['variable', KIND_NAMES.variable]]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = t(l);
      kind.appendChild(o);
    }
    kind.value = draft.kind || '';
    row(t('A parameter or a variable'), kind);
    const value = input(t('Its value, if it has one'), draft.value, false, '−65');
    const unit = input(t('Unit'), draft.unit, false, 'mV');
    // sources: the paper's references, by key, the way @ finds them
    const sources = document.createElement('div');
    sources.className = 'ps-sources';
    const chips = document.createElement('span');
    chips.className = 'ps-chips';
    const find = document.createElement('input');
    find.spellcheck = false;
    find.placeholder = t('Type to find a reference');
    find.setAttribute('aria-label', t('Add a source'));
    const found = document.createElement('div');
    found.className = 'ps-found';
    found.setAttribute('role', 'listbox');
    sources.append(chips, find, found);
    row(t('Where its value comes from'), sources, true);
    const table = document.createElement('input');
    table.type = 'checkbox';
    table.checked = draft.table !== false;
    const tl = document.createElement('label');
    tl.className = 'pr-check wide';
    tl.append(table, document.createTextNode(' ' + t('List it in the table of symbols')));
    grid.appendChild(tl);
    const drawChips = () => {
      chips.innerHTML = '';
      draft.cite.forEach((x, i) => {
        const it = paper.refs.find((r) => r.id === x.id);
        const c = document.createElement('button');
        c.type = 'button';
        c.className = 'ps-chip';
        c.textContent = (it ? NeoReferences.shortLabel(it) : '@' + x.id) + ' ×';
        c.title = t('Take this source out');
        c.onclick = () => { draft.cite.splice(i, 1); drawChips(); find.focus(); };
        chips.appendChild(c);
      });
    };
    let hits = [];
    let hit = 0;
    const drawFound = () => {
      const q = find.value.trim().toLowerCase();
      hits = q ? paper.refs.map((it) => ({ it, s: NeoReferences.score(it, q) })).filter((x) => x.s > 0 && !draft.cite.some((c) => c.id === x.it.id))
        .sort((a, b) => b.s - a.s).slice(0, 5).map((x) => x.it) : [];
      hit = Math.min(hit, Math.max(0, hits.length - 1));
      found.innerHTML = '';
      hits.forEach((it, i) => {
        const o = document.createElement('div');
        o.className = 'pp-row' + (i === hit ? ' active' : '');
        o.setAttribute('role', 'option');
        o.textContent = NeoReferences.shortLabel(it) + (it.title ? ' — ' + it.title : '');
        o.onmousedown = (e) => { e.preventDefault(); add(it); };
        found.appendChild(o);
      });
    };
    const add = (it) => { draft.cite.push({ id: it.id }); find.value = ''; drawFound(); drawChips(); find.focus(); };
    find.addEventListener('input', () => { hit = 0; drawFound(); });
    find.addEventListener('keydown', (e) => {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && hits.length) { e.preventDefault(); hit = (hit + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length; drawFound(); }
      else if (e.key === 'Enter' && hits.length) { e.preventDefault(); e.stopPropagation(); add(hits[hit]); }
      else if (e.key === 'Backspace' && !find.value && draft.cite.length) { draft.cite.pop(); drawChips(); }
    });
    drawChips();
    // the symbol drawn as it's written
    const draw = () => {
      preview.innerHTML = '';
      const tex = texIn.value.trim();
      if (!tex) return;
      const svg = mathReady() ? texSvg(tex, false) : null;
      if (svg) preview.appendChild(svg); else preview.textContent = mathReady() ? t('doesn’t parse yet') : tex;
    };
    // a name offered from the TeX (V_\mathrm{m}: Vm), until the writer names it
    const offer = () => { if (!sym && !idIn.dataset.typed) idIn.value = texIn.value.replace(/\\(mathrm|mathit|mathbf|text|operatorname)\b|\\/g, '').replace(/[^A-Za-z]/g, '').slice(0, 12); };
    texIn.addEventListener('input', () => { draw(); offer(); });
    offer();
    idIn.addEventListener('input', () => { idIn.dataset.typed = '1'; });
    draw();
    document.body.appendChild(bd);
    (sym ? meaning : texIn).focus();
    const close = (value) => { bd.remove(); resolve(value); };
    bd.querySelector('.m-cancel').onclick = () => close(null);
    bd.querySelector('.m-ok').onclick = async () => {
      const id = idIn.value.trim().replace(/^\\/, '');
      const why = NeoSymbols.validKey(id, paper.symbols.filter((s) => !sym || s.id !== sym.id).map((s) => s.id));
      if (why) { toast(t(SYMBOL_NAME_WHY[why] || why)); idIn.focus(); return; }
      if (!texIn.value.trim()) { toast(t('A symbol needs its TeX')); texIn.focus(); return; }
      const saved = { id, tex: texIn.value.trim(), meaning: meaning.value.trim(), unit: unit.value.trim(), value: value.value.trim(), kind: kind.value, table: table.checked, cite: draft.cite };
      for (const k of ['meaning', 'unit', 'value', 'kind']) if (!saved[k]) delete saved[k];
      if (!saved.cite.length) delete saved.cite;
      const items = sym ? paper.symbols.map((s) => (s.id === sym.id ? saved : s)) : [...paper.symbols, saved];
      // a new name follows it into the paper
      if (sym && id !== sym.id) for (const n of document.querySelectorAll(`#chapters .sym[data-sym="${CSS.escape(sym.id)}"], #tp-abstract .sym[data-sym="${CSS.escape(sym.id)}"]`)) n.dataset.sym = id;
      close(saved);
      await paperSaveSymbols(items);
    };
    bd.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target !== find && e.target.type !== 'checkbox') { e.preventDefault(); bd.querySelector('.m-ok').click(); }
    });
  });
}

// Maths on the page made a symbol: defined from its TeX, and every piece
// of maths that's the same TeX becomes it too
async function paperDefineSymbol(node) {
  const tex = texOf(node).trim();
  const sym = await paperEditSymbol(null, { tex });
  if (!sym) return;
  const body = node.closest('.chapter-body');
  if (body) snapshotStructure('symbol');
  let n = 0;
  for (const m of document.querySelectorAll('#chapters .math, #tp-abstract .math')) {
    if (texOf(m).trim() !== sym.tex) continue;
    const holder = document.createElement('span');
    holder.innerHTML = symHtml(sym);
    m.replaceWith(holder.firstChild);
    n++;
  }
  for (const b of paperBodies()) syncChapter(b, b.closest('.chapter').dataset.id);
  const abs = $('#tp-abstract');
  if (abs && abs.querySelector('.sym')) abs.dispatchEvent(new Event('input'));
  paperHydrate();
  if (body) { resetNativeUndo(); breakRun++; }
  toast(n === 1 ? t('\\{name} defined — type \\{name} and a space to use it again', { name: sym.id })
    : t('\\{name} defined, and used in the {n} places with that maths — type \\{name} and a space for it', { name: sym.id, n }));
}

// A symbol on the page, clicked (or ⇧F10 beside it)
async function symbolMenu(e, node) {
  const sym = symbolOf(node.dataset.sym);
  const choice = await popMenu(e.clientX, e.clientY, [
    { label: sym ? t('Edit \\{name}…', { name: sym.id }) : t('Define \\{name} Again…', { name: node.dataset.sym }), value: 'edit' },
    { label: t('Back to Plain Maths'), value: 'plain' },
    { label: t('Remove'), value: 'remove', danger: true }
  ], { title: sym && sym.meaning ? sym.meaning : '\\' + node.dataset.sym, from: e.from });
  if (choice === 'edit') {
    if (sym) await paperEditSymbol(sym);
    else {
      const made = await paperEditSymbol(null, { tex: texOf(node) });
      if (made) node.dataset.sym = made.id;
      paperSymbolsShown();
    }
  } else if (choice === 'plain') {
    const body = node.closest('.chapter-body');
    if (body) snapshotStructure('symbol');
    const holder = document.createElement('span');
    holder.innerHTML = `<span class="math" contenteditable="false">${escHtml(symTex(node))}</span>`;
    const m = holder.firstChild;
    node.replaceWith(m);
    drawMath(m);
    if (body) { syncChapter(body, body.closest('.chapter').dataset.id); resetNativeUndo(); breakRun++; }
  } else if (choice === 'remove') removeNode(node);
}
// Maths, clicked from the keyboard (⇧F10) or right-clicked: change it, or make it a symbol
async function mathMenu(e, node) {
  const choice = await popMenu(e.clientX, e.clientY, [
    { label: t('Edit the Maths'), value: 'edit' },
    { label: t('Define as a Symbol…'), value: 'define' }
  ], { title: t('Maths'), from: e.from });
  if (choice === 'edit') editMath(node);
  else if (choice === 'define') await paperDefineSymbol(node);
}

/* ---- the table of symbols: where /symbols puts it ---- */

// <p class="symtab" data-kind="parameter"> holds nothing of its own: the
// table is drawn into its shadow root from symbols.json (those listed, of
// its kind, in the nomenclature's order), so nothing in the chapter changes
// when a definition does
function symtabRows(block) {
  const kind = block.dataset.kind || '';
  return NeoSymbols.sortSymbols(paper.symbols.filter((s) => s.table !== false && (!kind || s.kind === kind)));
}
const SYMTAB_CSS = `:host{display:block}
table{border-collapse:collapse;margin:.4em auto;font-size:.92em;border-top:1.2px solid currentColor;border-bottom:1.2px solid currentColor}
th{font-weight:600;text-align:left;border-bottom:.8px solid currentColor}
th,td{padding:.25em .7em;vertical-align:baseline}
td.s{white-space:nowrap}
.none{text-align:center;opacity:.55;font-style:italic;padding:.6em;border:1px dashed currentColor;border-radius:4px}
mjx-container{display:inline-block}svg{overflow:visible;vertical-align:middle}`;
function drawSymbolTable(block) {
  const root = block.shadowRoot || block.attachShadow({ mode: 'open' });
  const rows = symtabRows(block);
  const kind = block.dataset.kind || '';
  root.innerHTML = `<style>${SYMTAB_CSS}</style>`;
  if (!rows.length) {
    const none = document.createElement('div');
    none.className = 'none';
    none.textContent = kind === 'parameter' ? t('Table of parameters: none yet. Mark a symbol as a parameter on the References tab.')
      : kind === 'variable' ? t('Table of variables: none yet. Mark a symbol as a variable on the References tab.')
      : t('Table of symbols: none yet. Define one from some maths, or on the References tab.');
    root.appendChild(none);
    return;
  }
  const has = (k) => rows.some((s) => k === 'cite' ? s.cite && s.cite.length : s[k]);
  const cols = ['tex', 'meaning', ...['value', 'unit', 'cite'].filter(has)];
  const head = { tex: 'Symbol', meaning: 'Meaning', value: 'Value', unit: 'Unit', cite: 'Source' };
  const tbl = document.createElement('table');
  tbl.innerHTML = `<thead><tr>${cols.map((c) => `<th>${escHtml(head[c])}</th>`).join('')}</tr></thead><tbody></tbody>`;
  for (const s of rows) {
    const tr = document.createElement('tr');
    for (const c of cols) {
      const td = document.createElement('td');
      if (c === 'tex') {
        td.className = 's';
        const svg = mathReady() ? texSvg(s.tex, false) : null;
        if (svg) td.appendChild(svg); else td.textContent = s.tex;
      } else if (c === 'cite') td.innerHTML = (paper.citeText && paper.citeText.get(symtabKey(block, s.id))) || '';
      else td.textContent = s[c] || '';
      tr.appendChild(td);
    }
    tbl.tBodies[0].appendChild(tr);
  }
  root.appendChild(tbl);
}
// a table's sources, among the paper's citations in reading order
const symtabKey = (block, id) => 'symtab:' + (block.dataset.id || '') + ':' + id;
function makeSymbolTable(kind = '') {
  const p = document.createElement('p');
  p.className = 'symtab';
  p.contentEditable = 'false';
  p.dataset.id = paperId('symtab');
  if (kind) p.dataset.kind = kind;
  return p;
}
// /symbols: the table where the caret's line is
function paperInsertSymbolTable() {
  const body = paperCaretBody();
  if (!body) return;
  snapshotStructure('table of symbols');
  const tbl = makeSymbolTable();
  placeBlock(tbl, body);
  syncChapter(body, body.closest('.chapter').dataset.id);
  resetNativeUndo();
  breakRun++;
  drawSymbolTable(tbl);
  paperCiteSoon(0);
  if (!paper.symbols.length) toast(t('Symbols you define show here: select some maths and press ⇧F10, or type /symbol'));
}
// which symbols it lists, or out of the paper (its symbols stay defined)
async function symtabMenu(e, block) {
  const kind = block.dataset.kind || '';
  const choice = await popMenu(e.clientX, e.clientY, [
    { label: t('Every Symbol Marked for the Table'), value: 'k:', checked: !kind },
    { label: t('Only the Parameters'), value: 'k:parameter', checked: kind === 'parameter' },
    { label: t('Only the Variables'), value: 'k:variable', checked: kind === 'variable' },
    '-',
    { label: t('Edit the Symbols…'), value: 'edit' },
    { label: t('Remove the Table'), value: 'remove', danger: true }
  ], { title: t('Table of Symbols'), from: e.from || block });
  if (!choice) return;
  if (choice === 'edit') { libraryView = 'symbols'; switchTab('references'); return; }
  figureChange(block, choice === 'remove' ? 'table of symbols' : 'symbols', () => {
    if (choice === 'remove') block.remove();
    else if (choice === 'k:') delete block.dataset.kind;
    else block.dataset.kind = choice.slice(2);
  });
  if (block.isConnected) drawSymbolTable(block);
  paperCiteSoon(0);
}
// /symbol: a new one, defined and put where the caret is
async function paperNewSymbolHere() {
  const sel = window.getSelection();
  const at = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  const sym = await paperEditSymbol();
  if (!sym || !at || !at.startContainer.isConnected) return;
  const body = at.startContainer.nodeType === 3 ? at.startContainer.parentElement.closest('.chapter-body') : at.startContainer.closest && at.startContainer.closest('.chapter-body');
  if (!body) return;
  body.focus({ preventScroll: true });
  drawMath(placeAtom(at, symHtml(sym), 'symbol'));
}

/* ------------------------------------------------------------------ */
/*  The editing pass and the paragraph check: asked for, never while   */
/*  writing (docs/writing-principles.md, sections 5 and 6)             */
/* ------------------------------------------------------------------ */

// A paragraph's text as the rules read it: a citation, cross-reference,
// maths or symbol is one character (U+FFFC), and each stretch of text
// remembers its node, so what's found becomes a Range on the page
function paperParaText(el) {
  const segs = [];
  let text = '';
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { if (n.data) { segs.push({ node: n, at: text.length, len: n.data.length }); text += n.data; } }
      else if (n.nodeType === 1 && n.matches(ATOMS)) { segs.push({ atom: n, at: text.length, len: 1 }); text += '\uFFFC'; }
      else if (n.nodeType === 1 && !n.matches('.ph-mark')) walk(n);
    }
  };
  walk(el);
  return { el, text, segs };
}
function paraRange(pt, start, end) {
  const find = (i, isEnd) => pt.segs.find((s) => (isEnd ? s.at < i && i <= s.at + s.len : s.at <= i && i < s.at + s.len));
  const a = find(start, false);
  const b = find(end, true);
  if (!a || !b) return null;
  try {
    const r = new Range();
    if (a.node) r.setStart(a.node, start - a.at); else r.setStartBefore(a.atom);
    if (b.node) r.setEnd(b.node, end - b.at); else r.setEndAfter(b.atom);
    return r;
  } catch { return null; }
}
// what the rules read, in the order a reader does: the abstract, then the
// paper's paragraphs, list items and captions (not headings or equations)
const paperProse = () => [...document.querySelectorAll('#tp-abstract > p, #chapters .chapter-body > p:not(.h1):not(.h2):not(.h3):not(.eq):not(.symtab), #chapters figcaption, #chapters .subcap')];

/* ---- First and Last Sentences ---- */

// Each paragraph's first sentence gives its context and its last
// concludes and points on: with the rest dimmed, a gap in that rhythm
// shows at a glance. Drawn with the Highlight API: nothing in the file changes.
let skimOn = false;
function paperSkim(on = !skimOn) {
  skimOn = on;
  paperSkimDraw();
  paperReportState();
  if (on) toast(t('First and last sentences: the rest of each paragraph dimmed, to read its rhythm'));
}
function paperSkimDraw() {
  if (!skimOn || !book || !isPaper()) { CSS.highlights.delete('neo-skim'); return; }
  const hl = new Highlight();
  for (const p of document.querySelectorAll('#chapters .chapter-body > p:not(.h1):not(.h2):not(.h3):not(.eq):not(.symtab):not(.li)')) {
    const pt = paperParaText(p);
    const s = NeoEditing.sentences(pt.text);
    if (s.length < 3) continue;
    const r = paraRange(pt, s[1].start, s[s.length - 2].end);
    if (r) hl.add(r);
  }
  CSS.highlights.set('neo-skim', hl);
}

/* ---- the editing pass ---- */

// Edit → Editing Pass: the language rules (filler, passive, a comparison
// with no basis, long sentences) and what consistency asks (acronyms, one
// spelling throughout, units, ranges, figures referred to in order),
// marked like the spellcheck pass. ⌘' steps through them; a right-click
// (or ⇧F10) says why and offers the fix where there is one.
let editingOn = false;
let editingFlags = []; // [{ range, flag }] in reading order
const editingLeft = new Set(); // what the writer chose to leave, for this session
const flagKey = (flag, text) => flag.rule + '\u0000' + text;
function paperEditing(on = !editingOn) {
  editingOn = on;
  if (on) {
    paperEditingScan();
    const by = new Map();
    for (const { flag } of editingFlags) by.set(flag.rule, (by.get(flag.rule) || 0) + 1);
    const parts = [...by].map(([rule, n]) => `${n} ${t(rule === 'order' ? ORDER_RULE : NeoEditing.RULES[rule] || rule).toLowerCase()}`);
    toast(editingFlags.length
      ? t('Editing pass: {n} to look at ({what}). {key} goes to the next; right-click one for why.', { n: editingFlags.length, what: parts.join(', '), key: IS_MAC ? '⌘\'' : 'Ctrl+\'' })
      : t('Editing pass: nothing to look at'), 8000);
  } else {
    editingFlags = [];
    CSS.highlights.delete('neo-edit');
    toast(t('Editing pass off'));
  }
  paperReportState();
}
function paperEditingScan() {
  if (!editingOn || !book || !isPaper()) return;
  const paras = paperProse().map(paperParaText);
  const found = [];
  for (const flag of NeoEditing.check(paras.map((p) => p.text), { lang: writingLanguage() })) {
    const range = paraRange(paras[flag.p], flag.start, flag.end);
    if (range) found.push({ range, flag });
  }
  found.push(...figureOrderFlags());
  editingFlags = found
    .filter(({ range, flag }) => !editingLeft.has(flagKey(flag, range.toString())))
    .sort((a, b) => a.range.compareBoundaryPoints(Range.START_TO_START, b.range));
  const hl = new Highlight();
  for (const { range } of editingFlags) hl.add(range);
  CSS.highlights.set('neo-edit', hl);
}
let editingTimer = null;
document.addEventListener('input', (e) => {
  const at = e.target && e.target.closest && e.target.closest('#chapters, #tp-abstract');
  if (!at || (!editingOn && !skimOn)) return;
  clearTimeout(editingTimer);
  editingTimer = setTimeout(() => { paperEditingScan(); paperSkimDraw(); }, 700);
}, true);
// Every figure and table referred to in the text, first in the order
// they're numbered (journals ask for it, and readers expect it)
const ORDER_RULE = tk('Figures in order');
function figureOrderFlags() {
  const out = [];
  const xrefs = [...document.querySelectorAll('#chapters .xref')];
  for (const kind of ['fig', 'tbl']) {
    let lastFirst = null;
    let lastLabel = '';
    for (const el of document.querySelectorAll(`#chapters figure.${kind}`)) {
      const id = el.dataset.id;
      const label = (paper.targets && paper.targets.get(id) || {}).label || '';
      const first = xrefs.find((x) => x.dataset.ref === id || (x.dataset.ref || '').startsWith(id + '-'));
      const vars = { what: label, other: lastLabel };
      if (!first) {
        const r = new Range();
        r.selectNodeContents(el.querySelector(':scope > figcaption'));
        out.push({ range: r, flag: { rule: 'order', key: tk('{what} isn’t referred to in the text: say where it comes in.'), vars, fix: null } });
      } else if (lastFirst && first.compareDocumentPosition(lastFirst) & Node.DOCUMENT_POSITION_FOLLOWING) {
        const r = new Range();
        r.selectNode(first);
        out.push({ range: r, flag: { rule: 'order', key: tk('{what} is first referred to before {other}: number them in the order the text first mentions them.'), vars, fix: null } });
      }
      if (first) { lastFirst = first; lastLabel = label; }
    }
  }
  return out;
}
const flagNote = (flag) => t(flag.key || flag.note, flag.vars || {});
// ⌘' and ⌘⇧': the next one after the caret (or before), selected and in view
function paperEditingNext(dir = 1) {
  if (!editingOn) { paperEditing(true); return; }
  paperEditingScan();
  if (!editingFlags.length) { toast(t('Editing pass: nothing to look at')); return; }
  const sel = window.getSelection();
  const here = sel.rangeCount ? sel.getRangeAt(0) : null;
  const after = (r) => !here || r.compareBoundaryPoints(Range.START_TO_END, here) > 0;
  const list = dir > 0 ? editingFlags : [...editingFlags].reverse();
  const next = list.find(({ range }) => (dir > 0 ? after(range) : !here || range.compareBoundaryPoints(Range.END_TO_START, here) < 0)) || list[0];
  const host = next.range.startContainer.parentElement && next.range.startContainer.parentElement.closest('[contenteditable="true"]');
  if (host) host.focus({ preventScroll: true });
  sel.removeAllRanges();
  sel.addRange(next.range.cloneRange());
  (next.range.startContainer.parentElement || next.range.startContainer).scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  // said because it was asked for: the writer pressed the key
  toast(flagNote(next.flag), 6000);
}
// the flag under a point, or the caret
function editingFlagAt(node, offset) {
  if (!editingOn) return null;
  return editingFlags.find(({ range }) => { try { return range.isPointInRange(node, offset) && !range.collapsed; } catch { return false; } }) || null;
}
async function editingMenu(e, hit) {
  const { range, flag } = hit;
  const items = [];
  const was = range.toString();
  if (flag.fix !== null && flag.fix !== undefined) items.push({ label: flag.fix ? t('Change to “{text}”', { text: flag.fix }) : t('Delete “{text}”', { text: was.trim() }), value: 'fix' });
  items.push({ label: t('Leave This One'), value: 'leave' }, { label: t('Next Thing to Look At'), value: 'next' });
  const choice = await popMenu(e.clientX, e.clientY, items, { title: flagNote(flag), from: e.from });
  if (choice === 'fix') {
    const host = range.startContainer.parentElement && range.startContainer.parentElement.closest('[contenteditable="true"]');
    if (host) host.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    if (flag.fix) document.execCommand('insertText', false, flag.fix); else document.execCommand('delete');
    paperEditingScan();
  } else if (choice === 'leave') {
    editingLeft.add(flagKey(flag, was));
    paperEditingScan();
  } else if (choice === 'next') paperEditingNext(1);
}

/* ---- a venue's LaTeX template ---- */

// Format → Journal → From a LaTeX Template…: the venue's zip (or its .tex
// and .sty files), kept beside the paper as template.zip. What NEO reads of
// it (its name, kind, columns, review switch, page limit) goes in book.json;
// the paper is then set for it: the LaTeX export fills the template, and
// the page and Preview take the venue's look.
const TEMPLATE_META = ['name', 'kind', 'look', 'cls', 'clsOpts', 'pkg', 'columns', 'fontSize', 'paper', 'pages', 'from'];
// why a template won't do, in the writer's language (NeoTemplate's reasons)
const TEMPLATE_WHY = {
  [NeoTemplate.NO_FILES]: tk('there are no files in it'),
  [NeoTemplate.NO_MAIN]: tk('none of its files is a main .tex, with \\documentclass and \\begin{document}')
};
const templateWhy = (error) => t(TEMPLATE_WHY[error] || error);
async function paperImportTemplate() {
  if (!window.neo.paperTemplateImport) { toast(t('Templates are imported in NEO on a computer')); return; }
  let got;
  try { got = await window.neo.paperTemplateImport(book.id); } catch (err) { toast(t('Couldn’t read that template: {error}', { error: plainError(err) }), 8000); return; }
  if (!got) return;
  const info = NeoTemplate.read(got.files);
  if (!info.ok) {
    // not a template NEO can fill: its copy goes back out (to the trash)
    await window.neo.paperTemplateRemove(book.id);
    toast(t('That isn’t a LaTeX template NEO can fill: {why}', { why: templateWhy(info.error) }), 9000);
    return;
  }
  const m = paperMeta();
  m.template = { from: got.from };
  for (const k of TEMPLATE_META) if (info[k] !== undefined && info[k] !== null && k !== 'from') m.template[k] = info[k];
  await paperMenu({ type: 'paper', command: 'journal', value: 'template' });
  // its example text (instructions, a checklist) isn't kept: said once, here
  toast(t('{name}: the LaTeX export fills the venue’s template, and the page and Preview take its look.', { name: info.name })
    + (info.pages ? ' ' + t('The template asks for {n} pages at most.', { n: info.pages }) : '')
    + ' ' + t('Its example text isn’t kept: copy into the paper anything the venue requires, such as a checklist.'), 12000);
}
async function paperRemoveTemplate() {
  const m = paperMeta();
  if (!m.template) return;
  const look = m.template.look;
  delete m.template;
  if (m.journal === 'template') { if (look) m.journal = look; else delete m.journal; }
  await window.neo.paperTemplateRemove(book.id);
  await saveMeta();
  paperRenumber();
  renderNav();
  paperReportState();
  toast(t('The template is in your trash; the LaTeX export writes NEO’s own again'), 7000);
}
// its files, read again at export: what's beside the paper now
async function paperTemplateFiles() {
  const got = window.neo.paperTemplate ? await window.neo.paperTemplate(book.id) : null;
  if (!got || !got.files.length) throw new Error(t('the template beside this paper is gone: import it again, or choose a journal'));
  const info = NeoTemplate.read(got.files);
  if (!info.ok) throw new Error(templateWhy(info.error));
  return { info, files: got.files };
}

/* ---- anonymous for review ---- */

// File → Anonymous for Review: for a double-blind submission, every
// preview and export leaves out the authors, their affiliations, and the
// sections that name them (Acknowledgements, Funding, Author
// contributions). The paper itself keeps everything.
function paperAnonymous(on = !paperMeta().anonymous) {
  const m = paperMeta();
  if (on) m.anonymous = true; else delete m.anonymous;
  scheduleMetaSave();
  paperShowAuthors();
  paperReportState();
  toast(on ? t('Anonymous for review: previews and exports leave out the authors, their affiliations, the acknowledgements and the author contributions. The paper keeps them. Look over Data availability for links that name you.')
    : t('Previews and exports name the authors again'), 9000);
}
const NAMES_AUTHORS = /acknowledg|funding|contribution/i;
function anonymize(model) {
  model.authors = [{ name: 'Anonymous', affiliations: [] }];
  model.affiliations = [];
  const out = [];
  let skip = 0; // the level of the section being left out
  for (const b of model.blocks) {
    if (b.type === 'heading') {
      if (skip && b.level <= skip) skip = 0;
      if (!skip && NAMES_AUTHORS.test(NeoPaperExport.runsText(b.runs))) { skip = b.level; continue; }
    }
    if (!skip) out.push(b);
  }
  model.blocks = out;
  model.anonymous = true;
  return model;
}

/* ---- the abstract's moves, for the talk outline ---- */

// Each sentence of the abstract under the move it makes (the same cues as
// the abstract guide), moving forward only: a sentence that makes none
// carries on the one before
const MOVE_NAMES = ['status', 'problem', 'solution', 'did', 'found', 'impact'];
function abstractMoves(text) {
  const sentences = text ? text.split(/(?<=[.!?])\s+(?=[A-Z“"(])/) : [];
  let at = 0;
  return sentences.map((s, i) => {
    if (i > 0) for (let k = Math.max(1, at); k < MOVE_CUES.length; k++) if (MOVE_CUES[k].test(s)) { at = k; break; }
    return { move: MOVE_NAMES[at], text: s };
  });
}

/* ------------------------------------------------------------------ */
/*  Figures: an image dropped, pasted or picked, with its caption      */
/* ------------------------------------------------------------------ */

const FIGURE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const FIGURE_ACCEPT = Object.keys(FIGURE_TYPES).join(',');
// Insert → Figure… and /figure: a picture picked, as a figure where the caret is
async function paperInsertFigure() {
  const body = paperCaretBody();
  if (!body) return;
  const at = caretBlock(body);
  const file = await pickFile(FIGURE_ACCEPT);
  if (file) await paperAddFigure(file, body, at);
}
const FIGURE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

function figureUrl(name) {
  if (!paper.figures.has(name)) {
    paper.figures.set(name, window.neo.paperRead(book.id, name).then((b64) => {
      if (!b64) return null;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return URL.createObjectURL(new Blob([bytes], { type: FIGURE_MIME[name.split('.').pop()] || 'application/octet-stream' }));
    }).catch(() => null));
  }
  return paper.figures.get(name);
}
// What a figure shows: its one picture (data-src on the figure), or one
// per panel (a figure of panels has .panel children, each with its own
// data-src and sub-caption, labelled (a), (b)… in order)
const figureHolders = (fig) => (fig.dataset.src ? [fig] : [...fig.querySelectorAll(':scope > .panel[data-src]')]);
function loadFigure(fig) {
  for (const holder of figureHolders(fig)) {
    const img = holder.querySelector(':scope > img') || holder.insertBefore(document.createElement('img'), holder.firstChild);
    const name = holder.dataset.src;
    if (!name || (img.getAttribute('src') || '').startsWith('blob:')) continue;
    figureUrl(name).then((url) => {
      if (url) { img.src = url; holder.removeAttribute('data-missing'); } else holder.setAttribute('data-missing', '');
    });
  }
}

// An image file into the paper's folder; its name there, or null
async function saveFigureFile(file) {
  const ext = FIGURE_TYPES[file.type];
  if (!ext) { toast(t('A figure can be a PNG, JPEG, GIF, WebP or SVG picture')); return null; }
  if (file.size > 40 * 1024 * 1024) { toast(t('That picture is over 40 MB — save a smaller copy and try again')); return null; }
  const name = `figure-${paperId('x').slice(2)}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let b64 = '';
  for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  try {
    await window.neo.paperWrite(book.id, name, btoa(b64));
  } catch (err) {
    toast(t('Couldn’t save the figure: {error}', { error: plainError(err) }), 8000);
    return null;
  }
  return name;
}

// An image onto the page as a figure, after the caret's paragraph (or in
// place of an empty one)
async function paperAddFigure(file, body, at = null) {
  const name = await saveFigureFile(file);
  if (!name) return;
  const chId = body.closest('.chapter').dataset.id;
  snapshotStructure('figure');
  const fig = document.createElement('figure');
  fig.className = 'fig';
  fig.contentEditable = 'false';
  fig.dataset.id = paperId('fig');
  fig.dataset.src = name;
  const img = document.createElement('img');
  img.alt = '';
  const cap = document.createElement('figcaption');
  cap.contentEditable = 'true';
  fig.append(img, cap);
  placeBlock(fig, body, at);
  syncChapter(body, chId);
  resetNativeUndo();
  breakRun++;
  loadFigure(fig);
  paperRenumber();
  cap.focus();
}

/* ---- panels: (a), (b)… side by side, under one caption ---- */

function makePanel(name, img) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.dataset.src = name;
  const pic = img || document.createElement('img');
  if (!img) pic.alt = '';
  const sub = document.createElement('span');
  sub.className = 'subcap';
  sub.contentEditable = 'true';
  panel.append(pic, sub);
  return panel;
}
// a picture added to a figure becomes its next panel (the figure's one
// picture, if it had one, becoming panel (a))
async function addPanel(fig, file) {
  const name = await saveFigureFile(file);
  if (!name) return;
  figureChange(fig, 'figure panel', () => {
    const cap = fig.querySelector(':scope > figcaption');
    if (fig.dataset.src) {
      const first = makePanel(fig.dataset.src, fig.querySelector(':scope > img'));
      delete fig.dataset.src;
      fig.insertBefore(first, cap);
    }
    fig.insertBefore(makePanel(name), cap);
  });
  loadFigure(fig);
}
async function removePanel(fig, panel) {
  const was = [...fig.querySelectorAll(':scope > .panel')];
  const letter = String.fromCharCode(97 + was.indexOf(panel));
  const sub = panel.querySelector('.subcap').textContent.trim();
  if (sub) await paperToDarlings(sub, t('Figure {n}{letter}', { n: fig.dataset.num || '', letter }));
  figureChange(fig, 'figure panel', () => {
    panel.remove();
    const left = fig.querySelectorAll(':scope > .panel');
    if (left.length === 1) {
      // one picture left: a plain figure again
      const last = left[0];
      fig.dataset.src = last.dataset.src;
      fig.insertBefore(last.querySelector('img'), fig.firstChild);
      const subLeft = last.querySelector('.subcap').textContent.trim();
      if (subLeft) {
        const cap = fig.querySelector(':scope > figcaption');
        cap.textContent = (subLeft + ' ' + cap.textContent).trim();
      }
      last.remove();
      delete fig.dataset.cols;
    }
    relinkPanels(fig, was);
  });
}

// The panels' layout: so many to a row (data-cols on the figure; unset,
// all in one row) and a panel more than one column wide (data-colspan).
// Every export sets them the same way (panelRows in paper/export.js).
const PANEL_COLS = ['1', '2', '3', '4'];
function setPanelLayout(fig, { cols, panel, colspan } = {}) {
  figureChange(fig, 'figure panels', () => {
    if (cols !== undefined) { if (cols) fig.dataset.cols = cols; else delete fig.dataset.cols; }
    if (panel && colspan !== undefined) { if (colspan > 1) panel.dataset.colspan = String(colspan); else delete panel.dataset.colspan; }
  });
}
// A cross-reference to a panel (Figure 2b) names it by its letter: when
// panels move or one goes, each reference follows its picture (to the
// figure itself when its panel is gone). was: the panels as they stood
function relinkPanels(fig, was) {
  const now = [...fig.querySelectorAll(':scope > .panel')];
  const id = fig.dataset.id;
  for (const x of document.querySelectorAll('#chapters .xref')) {
    const m = new RegExp('^' + id + '-([a-z])$').exec(x.dataset.ref || '');
    if (!m) continue;
    const k = now.indexOf(was[m[1].charCodeAt(0) - 97]);
    x.dataset.ref = k >= 0 ? id + '-' + String.fromCharCode(97 + k) : id;
  }
}
function movePanel(fig, panel, dir) {
  const was = [...fig.querySelectorAll(':scope > .panel')];
  const other = dir < 0 ? panel.previousElementSibling : panel.nextElementSibling;
  if (!other || !other.matches('.panel')) return;
  figureChange(fig, 'figure panels', () => {
    if (dir < 0) other.before(panel); else other.after(panel);
    relinkPanels(fig, was);
  });
}
// how many to a row, and for one panel: how wide, and where among the others
async function panelMenu(x, y, fig, panel, from) {
  const panels = [...fig.querySelectorAll(':scope > .panel')];
  const cols = fig.dataset.cols || '';
  const items = [{ label: t('All in One Row'), value: 'cols:', checked: !cols }];
  for (const n of PANEL_COLS) {
    if (+n < panels.length) items.push({ label: n === '1' ? t('One Above Another') : t('{n} to a Row', { n }), value: 'cols:' + n, checked: cols === n });
  }
  if (panel) {
    const i = panels.indexOf(panel);
    const letter = String.fromCharCode(97 + i);
    const span = +(panel.dataset.colspan || 1);
    // as wide as a row can hold, when they're in rows
    const most = cols ? Math.min(3, +cols) : 3;
    items.push('-',
      { label: t('Panel ({letter}) as Wide as the Others', { letter }), value: 'span:1', checked: span === 1 },
      ...(most >= 2 ? [{ label: t('Panel ({letter}) Twice as Wide', { letter }), value: 'span:2', checked: span === 2 }] : []),
      ...(most >= 3 ? [{ label: t('Panel ({letter}) Three Times as Wide', { letter }), value: 'span:3', checked: span === 3 }] : []),
      '-',
      { label: t('Move Panel ({letter}) Earlier', { letter }), value: 'earlier', disabled: i === 0 },
      { label: t('Move Panel ({letter}) Later', { letter }), value: 'later', disabled: i === panels.length - 1 });
  }
  const choice = await popMenu(x, y, items, { title: t('Panels'), from: from || panel || fig });
  if (!choice) return;
  if (choice.startsWith('cols:')) setPanelLayout(fig, { cols: choice.slice(5) });
  else if (choice.startsWith('span:')) setPanelLayout(fig, { panel, colspan: +choice.slice(5) });
  else movePanel(fig, panel, choice === 'earlier' ? -1 : 1);
}

/* ---- layout, as LaTeX lays figures out ---- */

// a figure's layout attributes, checked, for markup rebuilt from a paste
function figureLayoutAttrs(n) {
  const d = n.dataset;
  return (FIGURE_WIDTHS.includes(d.width) && d.width !== '100' ? ` data-width="${d.width}"` : '')
    + (PANEL_COLS.includes(d.cols) ? ` data-cols="${d.cols}"` : '')
    + (['left', 'right'].includes(d.wrap) ? ` data-wrap="${d.wrap}"` : '')
    + (['h', 't', 'b', 'p', 'H'].includes(d.place) ? ` data-place="${d.place}"` : '')
    + (d.span === 'page' ? ' data-span="page"' : '');
}

// width as a share of the text, text wrapped beside it, where a float may
// go ([htbp] by default; h, t, b, p, or H pinned), and across both columns
// of a two-column journal (figure*)
const FIGURE_WIDTHS = ['25', '33', '50', '67', '100'];
const PLACEMENTS = [
  ['', tk('Best place'), tk('Here, or the top or bottom of a page, or a page of figures: wherever it fits [htbp]')],
  ['h', tk('Here, if it fits'), tk('Where it is in the text, else the nearest place it fits [h]')],
  ['t', tk('Top of a page'), tk('At the top of this page or the next [t]')],
  ['b', tk('Bottom of a page'), tk('At the bottom of this page or the next [b]')],
  ['p', tk('A page of figures'), tk('On a page of its own with other figures and tables [p]')],
  ['H', tk('Pinned here'), tk('Exactly where it is in the text, never moved [H]')]
];
function figureChange(el, label, fn) {
  const body = el.closest('.chapter-body');
  snapshotStructure(label);
  fn();
  if (!body) return;
  syncChapter(body, body.closest('.chapter').dataset.id);
  resetNativeUndo();
  breakRun++;
  paperRenumber();
  if (figTools.fig === el) figToolsDraw();
}
function setFigureLayout(el, { width, wrap, place, span } = {}) {
  figureChange(el, 'figure layout', () => {
    if (width !== undefined) { if (width === '100') delete el.dataset.width; else el.dataset.width = width; }
    if (wrap !== undefined) { if (wrap) el.dataset.wrap = wrap; else delete el.dataset.wrap; }
    if (place !== undefined) { if (place) el.dataset.place = place; else delete el.dataset.place; }
    if (span !== undefined) { if (span) el.dataset.span = 'page'; else delete el.dataset.span; }
    // text wraps only beside something narrow enough to leave it room
    if (el.dataset.wrap && (!el.dataset.width || +el.dataset.width > 50)) el.dataset.width = '50';
    if (el.dataset.wrap) { delete el.dataset.span; delete el.dataset.place; }
  });
}
async function placementMenu(x, y, el) {
  const items = [];
  // a figure's width and wrap, as its toolbar has them, for the keyboard
  if (el.matches('figure.fig')) {
    const w = el.dataset.width || '100';
    for (const v of FIGURE_WIDTHS) items.push({ label: t('{n}% of the text width', { n: v }), value: 'w:' + v, checked: w === v });
    items.push('-', { label: t('Text wraps on its right'), value: 'wrap:left', checked: el.dataset.wrap === 'left' },
      { label: t('Text wraps on its left'), value: 'wrap:right', checked: el.dataset.wrap === 'right' }, '-');
  }
  items.push(...PLACEMENTS.map(([v, label, what]) => ({ label: t(label), value: 'p:' + v, checked: (el.dataset.place || '') === v, title: t(what) })));
  items.push('-', { label: t('Across Both Columns'), value: 'span', checked: el.dataset.span === 'page' });
  const choice = await popMenu(x, y, items, { title: t('Where it may go when printed'), from: el });
  if (!choice) return;
  if (choice.startsWith('w:')) setFigureLayout(el, { width: choice.slice(2) });
  else if (choice.startsWith('wrap:')) { const side = choice.slice(5); setFigureLayout(el, { wrap: el.dataset.wrap === side ? '' : side }); }
  else if (choice === 'span') setFigureLayout(el, { span: el.dataset.span !== 'page', wrap: '' });
  else setFigureLayout(el, { place: choice.slice(2), wrap: '' });
}

// the toolbar over a figure, while the pointer is on it (or the caret in it)
const figTools = { el: null, fig: null, panel: null, timer: null };
function figToolsDraw() {
  const fig = figTools.fig;
  if (!fig || !fig.isConnected) { figToolsHide(true); return; }
  if (!figTools.el) {
    figTools.el = document.createElement('div');
    figTools.el.className = 'fig-tools';
    figTools.el.addEventListener('mousedown', (e) => e.preventDefault());
    figTools.el.addEventListener('mouseenter', () => clearTimeout(figTools.timer));
    figTools.el.addEventListener('mouseleave', () => figToolsHide());
    document.body.appendChild(figTools.el);
  }
  const bar = figTools.el;
  bar.innerHTML = '';
  const group = (cls) => { const g = document.createElement('span'); g.className = 'ft-group ' + cls; bar.appendChild(g); return g; };
  const btn = (g, label, title, on, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    if (on) b.classList.add('on');
    b.onclick = fn;
    g.appendChild(b);
    return b;
  };
  if (fig.matches('figure.fig')) {
    const w = fig.dataset.width || '100';
    const widths = group('ft-width');
    for (const v of FIGURE_WIDTHS) btn(widths, v === '100' ? t('Full') : v + '%', t('{n}% of the text width', { n: v }), w === v, () => setFigureLayout(fig, { width: v }));
    const wrap = group('ft-wrap');
    btn(wrap, '◧', t('Text wraps on its right'), fig.dataset.wrap === 'left', () => setFigureLayout(fig, { wrap: fig.dataset.wrap === 'left' ? '' : 'left' }));
    btn(wrap, '◨', t('Text wraps on its left'), fig.dataset.wrap === 'right', () => setFigureLayout(fig, { wrap: fig.dataset.wrap === 'right' ? '' : 'right' }));
  }
  const place = PLACEMENTS.find(([v]) => v === (fig.dataset.place || ''));
  const where = group('ft-place');
  btn(where, (fig.dataset.place === 'H' ? '📌 ' : '') + t(place[1]) + (fig.dataset.span ? ' · ' + t('both columns') : '') + ' ▾', t('Where it may go when printed'), !!fig.dataset.place || !!fig.dataset.span, (e) => {
    const r = e.target.getBoundingClientRect();
    placementMenu(r.left, r.bottom + 4, fig);
  });
  if (fig.matches('figure.fig') && fig.querySelectorAll(':scope > .panel').length > 1) {
    btn(group('ft-panels'), '▦ ' + t('Panels') + ' ▾', t('How the panels are set out: so many to a row, how wide, in what order'), !!fig.dataset.cols, (e) => {
      const r = e.target.getBoundingClientRect();
      panelMenu(r.left, r.bottom + 4, fig, figTools.panel && fig.contains(figTools.panel) ? figTools.panel : null);
    });
  }
  if (fig.matches('figure.fig')) {
    btn(group('ft-panel'), '+ ' + t('Panel'), t('Add a picture beside this one, as panel (b), (c)…'), false, async () => {
      const file = await pickFile(FIGURE_ACCEPT);
      if (file) addPanel(fig, file);
    });
  }
  btn(group('ft-more'), '⋯', t('More'), false, (e) => {
    const r = e.target.getBoundingClientRect();
    (fig.matches('figure.fig') ? figureMenu : (ev, f) => tableMenu(ev, f.querySelector('td, th')))({ clientX: r.left, clientY: r.bottom + 4 }, fig);
  });
  const box = fig.getBoundingClientRect();
  bar.style.left = Math.max(8, Math.min(window.innerWidth - bar.offsetWidth - 8, box.left + box.width / 2 - bar.offsetWidth / 2)) + 'px';
  bar.style.top = Math.max(8, box.top - bar.offsetHeight - 6) + 'px';
  bar.hidden = false;
}
function figToolsShow(fig) {
  clearTimeout(figTools.timer);
  if (figTools.fig !== fig || !figTools.el || figTools.el.hidden) { figTools.fig = fig; figToolsDraw(); }
}
function figToolsHide(now) {
  clearTimeout(figTools.timer);
  const go = () => { if (figTools.el) figTools.el.hidden = true; figTools.fig = null; };
  if (now) go(); else figTools.timer = setTimeout(go, 250);
}
$('#chapters').addEventListener('mouseover', (e) => {
  if (!book || !isPaper() || NO_HOVER) return;
  const fig = e.target.closest && e.target.closest('#chapters figure.fig, #chapters figure.tbl');
  if (!fig) return;
  // the panel last pointed at, or written in, is the one its menu is for
  const panel = e.target.closest('.panel');
  if (panel) figTools.panel = panel;
  figToolsShow(fig);
});
$('#chapters').addEventListener('mouseout', (e) => {
  if (!figTools.fig) return;
  const to = e.relatedTarget;
  if (to && (figTools.fig.contains(to) || (figTools.el && figTools.el.contains(to)))) return;
  figToolsHide();
});
// and while the caret is in its caption or cells: controls show on keyboard focus too
$('#chapters').addEventListener('focusin', (e) => {
  if (!book || !isPaper()) return;
  const fig = e.target.closest && e.target.closest('#chapters figure.fig, #chapters figure.tbl');
  if (!fig) return;
  // the panel last pointed at, or written in, is the one its menu is for
  const panel = e.target.closest('.panel');
  if (panel) figTools.panel = panel;
  figToolsShow(fig);
});
$('#chapters').addEventListener('focusout', (e) => {
  if (!figTools.fig || (e.relatedTarget && figTools.fig.contains(e.relatedTarget))) return;
  if (!figTools.fig.matches(':hover')) figToolsHide();
});
$('#paper-scroll').addEventListener('scroll', () => { if (figTools.fig) figToolsHide(true); }, { passive: true });

// A block (figure, table) goes after the paragraph the caret is in, or in
// place of an empty one; a paragraph follows it, to write on
function placeBlock(el, body, at) {
  const block = at || caretBlock(body);
  if (block && body.contains(block) && block.matches('p') && !block.textContent.trim() && !block.classList.contains('eq')) block.replaceWith(el);
  else if (block && body.contains(block)) block.after(el);
  else body.appendChild(el);
  const next = el.nextElementSibling;
  if (!next || !next.matches('p:not(.eq)') || headingOf(next)) {
    const p = document.createElement('p');
    p.innerHTML = '<br>';
    el.after(p);
  }
}
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

/* ------------------------------------------------------------------ */
/*  Tables: pasted from a spreadsheet, or made empty, edited in place  */
/* ------------------------------------------------------------------ */

function makeTable(rows, header = true) {
  const fig = document.createElement('figure');
  fig.className = 'tbl';
  fig.contentEditable = 'false';
  fig.dataset.id = paperId('tab');
  const cap = document.createElement('figcaption');
  cap.contentEditable = 'true';
  const table = document.createElement('table');
  const width = Math.max(1, ...rows.map((r) => r.length));
  rows.forEach((cells, i) => {
    const tr = document.createElement('tr');
    for (let k = 0; k < width; k++) {
      const c = document.createElement(header && i === 0 ? 'th' : 'td');
      c.contentEditable = 'true';
      c.innerHTML = cells[k] || '';
      tr.appendChild(c);
    }
    table.appendChild(tr);
  });
  fig.append(cap, table);
  return fig;
}
function paperInsertTable(rows = [['', '', ''], ['', '', ''], ['', '', '']], header = true) {
  const body = paperCaretBody();
  if (!body) return;
  snapshotStructure('table');
  const fig = makeTable(rows, header);
  placeBlock(fig, body);
  syncChapter(body, body.closest('.chapter').dataset.id);
  resetNativeUndo();
  breakRun++;
  paperRenumber();
  const first = fig.querySelector('th, td');
  if (first && !first.textContent) placeCaret(first, 0); else fig.querySelector('figcaption').focus();
}
// Cells from the clipboard: an HTML table (Excel, Sheets, Numbers, Word)
// or tab-separated lines; null when it isn't a table
function clipboardTable(html, text) {
  if (html && /<table/i.test(html)) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('table');
    const rows = [...table.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th, td')].map((c) => cellHtml(c)));
    if (rows.length && rows.some((r) => r.length)) return { rows, header: !!table.querySelector('th') || rows.length > 1 };
  }
  if (text && /\t/.test(text) && /\n/.test(text.trim())) {
    const rows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t').map((c) => escHtml(c.trim())));
    if (rows.length > 1 && rows.every((r) => r.length > 1)) return { rows, header: true };
  }
  return null;
}
// a cell's own words, with its italics, bold and sub/superscripts
function cellHtml(cell) {
  const out = (node) => [...node.childNodes].map((n) => {
    if (n.nodeType === 3) return escHtml(n.data.replace(/\s+/g, ' '));
    if (n.nodeType !== 1) return '';
    const tag = n.tagName.toLowerCase();
    const st = n.getAttribute('style') || '';
    let inner = out(n);
    if (tag === 'i' || tag === 'em' || /font-style:\s*italic/.test(st)) inner = `<i>${inner}</i>`;
    if (tag === 'b' || tag === 'strong' || /font-weight:\s*(bold|[6-9]00)/.test(st)) inner = `<b>${inner}</b>`;
    if (tag === 'sub' || tag === 'sup') inner = `<${tag}>${inner}</${tag}>`;
    if (tag === 'br') return ' ';
    return inner;
  }).join('');
  return out(cell).trim();
}

// Keys inside a figure's caption or a table's cells
function figureKey(e, body, chId) {
  const fig = e.target.closest('figure');
  const place = e.target.closest('figcaption, .subcap, th, td');
  const cell = e.target.closest('th, td');
  if (!place) return e.key === 'Tab';
  const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
  if (e.key === 'Tab' && cell) {
    e.preventDefault();
    const cells = [...fig.querySelectorAll('th, td')];
    const i = cells.indexOf(cell) + (e.shiftKey ? -1 : 1);
    if (i >= cells.length) {
      // Tab in the last cell: a new row
      const tr = cell.closest('tr').cloneNode(true);
      for (const c of tr.children) {
        const td = document.createElement('td');
        td.contentEditable = 'true';
        c.replaceWith(td);
      }
      cell.closest('tr').after(tr);
      syncChapter(body, chId);
      caretInto(tr.firstElementChild, false);
      return true;
    }
    if (i < 0) { stepFigure(fig, cell, -1); return true; }
    const r = document.createRange();
    r.selectNodeContents(cells[i]);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    cells[i].focus();
    return true;
  }
  // Tab from a caption: on to the next place to write, or out
  if (e.key === 'Tab') { e.preventDefault(); stepFigure(fig, place, e.shiftKey ? -1 : 1); return true; }
  // Esc: back to the paragraph after it, where the writing goes on
  if (e.key === 'Escape' && plain) { e.preventDefault(); e.stopPropagation(); leaveFigure(fig, 1, { write: true }); return true; }
  // the arrows past a caption's or cell's edge: the next one, or out of the figure
  const sel = window.getSelection();
  if (plain && /^Arrow(Up|Down|Left|Right)$/.test(e.key) && sel.rangeCount && sel.isCollapsed) {
    const r = sel.getRangeAt(0);
    const dir = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1;
    const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
    if (!(vertical ? caretOnEdgeLine(place, r, dir) : atBlockEdge(place, r, dir))) return true;
    e.preventDefault();
    if (vertical && cell) {
      // up and down a table's column, as in a spreadsheet
      const rows = [...fig.querySelectorAll('tr')];
      const tr = cell.closest('tr');
      const row = rows[rows.indexOf(tr) + dir];
      if (row) { caretInto(row.children[Math.min([...tr.children].indexOf(cell), row.children.length - 1)], dir < 0); return true; }
      stepFigure(fig, dir < 0 ? rows[0].firstElementChild : rows[rows.length - 1].lastElementChild, dir);
      return true;
    }
    stepFigure(fig, place, dir);
    return true;
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (cell) {
      // down a row, as in a spreadsheet
      const tr = cell.closest('tr');
      const k = [...tr.children].indexOf(cell);
      const next = tr.nextElementSibling;
      if (next && next.children[k]) { caretInto(next.children[k], false); return true; }
    } else if (place.matches('figcaption') && fig.classList.contains('tbl')) {
      const first = fig.querySelector('th, td');
      if (first) { caretInto(first, false); return true; }
    }
    // out of the figure, to the paragraph after it
    leaveFigure(fig, 1, { write: true });
    return true;
  }
  if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); return true; }
  // a caption and cells are short: no breaks, no chapters, no poetry
  return false;
}

// Words a table or figure takes with it go to Darlings, the way a deleted
// chapter's do, and the writer is told
async function paperToDarlings(text, what) {
  if (!text.trim()) return;
  // newest first, written the way every Darling is (kept, retried, merged with another device's)
  darlings.unshift({
    id: 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    html: text.split('\n').map((l) => `<p>${escHtml(l)}</p>`).join(''),
    text: text.slice(0, 2000),
    chapterId: null,
    chapterLabel: what,
    date: new Date().toISOString()
  });
  await writeSidecar(book.id, 'darlings', darlings);
  toast(t('{what} removed — its words are in Darlings, or {key} to undo', { what, key: KZ }));
}
const cellsText = (cells) => cells.map((c) => c.textContent.trim()).filter(Boolean);
// the words a figure or table holds: its captions, or its caption and rows
function figureWords(fig) {
  const cap = fig.querySelector(':scope > figcaption');
  const lines = fig.matches('figure.tbl')
    ? [cap.textContent, ...[...fig.querySelectorAll('tr')].map((r) => cellsText([...r.children]).join('\t'))]
    : [...[...fig.querySelectorAll(':scope > .panel .subcap')].map((c) => c.textContent), cap.textContent];
  return lines.map((l) => l.trim()).filter(Boolean).join('\n');
}
const figureName = (fig) => (fig.matches('figure.tbl') ? t('Table {n}', { n: fig.dataset.num || '' }) : t('Figure {n}', { n: fig.dataset.num || '' }));
// A selection deleted or typed over that holds a whole figure or table: the
// engine takes it, and its words go to Darlings first (⌘Z brings it back)
function paperSelectionTakes(e, body) {
  const cmd = e.metaKey || e.ctrlKey;
  if (!(e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter' || (e.key.length === 1 && !cmd))) return;
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const r = sel.getRangeAt(0);
  for (const fig of body.querySelectorAll('figure')) {
    if (r.intersectsNode(fig) && !fig.contains(r.startContainer) && !fig.contains(r.endContainer)) paperToDarlings(figureWords(fig), figureName(fig));
  }
}

async function tableMenu(e, cell) {
  const fig = cell.closest('figure.tbl');
  const tr = cell.closest('tr');
  const col = [...tr.children].indexOf(cell);
  const rows = [...fig.querySelectorAll('tr')];
  const hasHeader = !!rows[0].querySelector('th');
  const choice = await popMenu(e.clientX, e.clientY, [
    { label: t('Insert Row Above'), value: 'rowAbove' }, { label: t('Insert Row Below'), value: 'rowBelow' },
    { label: t('Insert Column Left'), value: 'colLeft' }, { label: t('Insert Column Right'), value: 'colRight' },
    '-',
    { label: t('Delete Row'), value: 'rowDel', disabled: rows.length < 2 },
    { label: t('Delete Column'), value: 'colDel', disabled: tr.children.length < 2 },
    '-',
    { label: t('Header Row'), value: 'header', checked: hasHeader },
    { label: t('Placement…'), value: 'place' },
    { label: t('Copy a Reference to This Table'), value: 'xref' },
    '-',
    { label: t('Delete Table'), value: 'delete', danger: true }
  ], { title: t('Table'), from: e.from });
  if (!choice) return;
  const body = fig.closest('.chapter-body');
  const chId = body.closest('.chapter').dataset.id;
  if (choice === 'xref') { copyXref(fig); return; }
  if (choice === 'place') { placementMenu(e.clientX, e.clientY, fig); return; }
  snapshotStructure('table');
  const newCell = (tag) => { const c = document.createElement(tag); c.contentEditable = 'true'; return c; };
  if (choice === 'rowAbove' || choice === 'rowBelow') {
    const row = document.createElement('tr');
    for (let k = 0; k < tr.children.length; k++) row.appendChild(newCell('td'));
    if (choice === 'rowAbove') tr.before(row); else tr.after(row);
  } else if (choice === 'colLeft' || choice === 'colRight') {
    for (const r of rows) {
      const ref = r.children[col];
      const c = newCell(ref && ref.tagName === 'TH' ? 'th' : 'td');
      if (!ref) r.appendChild(c); else if (choice === 'colLeft') ref.before(c); else ref.after(c);
    }
  } else if (choice === 'rowDel') {
    await paperToDarlings(cellsText([...tr.children]).join('\t'), t('A table row'));
    tr.remove();
  } else if (choice === 'colDel') {
    await paperToDarlings(cellsText(rows.map((r) => r.children[col]).filter(Boolean)).join('\n'), t('A table column'));
    for (const r of rows) if (r.children[col]) r.children[col].remove();
  }
  else if (choice === 'header') {
    for (const c of [...rows[0].children]) {
      const n = newCell(hasHeader ? 'td' : 'th');
      n.innerHTML = c.innerHTML;
      c.replaceWith(n);
    }
  } else if (choice === 'delete') {
    await paperToDarlings(figureWords(fig), figureName(fig));
    fig.remove();
  }
  syncChapter(body, chId);
  resetNativeUndo();
  breakRun++;
  paperRenumber();
}

async function figureMenu(e, fig) {
  const panels = [...fig.querySelectorAll(':scope > .panel')];
  const panel = e.target && e.target.closest ? e.target.closest('.panel') : null;
  const items = [
    { label: t('Layout and Placement…'), value: 'place' },
    { label: t('Add a Panel…'), value: 'panel' },
    ...(panels.length > 1 ? [{ label: t('Panel Layout…'), value: 'panels' }] : []),
    ...(panel && panels.length > 1 ? [{ label: t('Remove Panel ({letter})', { letter: String.fromCharCode(97 + panels.indexOf(panel)) }), value: 'unpanel' }] : []),
    '-',
    { label: t('Description for Screen Readers…'), value: 'alt' },
    { label: panel ? t('Replace This Panel’s Picture…') : t('Replace Picture…'), value: 'replace' },
    { label: t('Copy a Reference to This Figure'), value: 'xref' },
    '-',
    { label: t('Delete Figure'), value: 'delete', danger: true }
  ];
  const choice = await popMenu(e.clientX, e.clientY, items, { title: t('Figure {n}', { n: fig.dataset.num || '' }), from: e.from });
  if (!choice) return;
  const body = fig.closest('.chapter-body');
  const chId = body.closest('.chapter').dataset.id;
  if (choice === 'xref') { copyXref(fig); return; }
  if (choice === 'place') { placementMenu(e.clientX, e.clientY, fig); return; }
  if (choice === 'panel') {
    const file = await pickFile(FIGURE_ACCEPT);
    if (file) addPanel(fig, file);
    return;
  }
  if (choice === 'unpanel') { removePanel(fig, panel); return; }
  if (choice === 'panels') { await panelMenu(e.clientX, e.clientY, fig, panel, e.from); return; }
  if (choice === 'alt') {
    const img = (panel || fig).querySelector(':scope > img');
    const v = await askInput(t('Describe the figure'), t('What it shows, for someone who can’t see it'), img.alt || '');
    if (v === null) return;
    img.alt = v;
    syncChapter(body, chId);
    return;
  }
  if (choice === 'replace') {
    const file = await pickFile(FIGURE_ACCEPT);
    if (!file) return;
    const name = await saveFigureFile(file);
    if (!name) return;
    const holder = panel || (fig.dataset.src ? fig : panels[0]);
    figureChange(fig, 'figure', () => {
      holder.dataset.src = name;
      holder.querySelector(':scope > img').removeAttribute('src');
    });
    loadFigure(fig);
    return;
  }
  if (choice === 'delete') {
    // the captions' words go to Darlings; the pictures stay in the paper's folder
    await paperToDarlings(figureWords(fig), figureName(fig));
    figToolsHide(true);
    figureChange(fig, 'figure', () => fig.remove());
  }
}
// A reference to a figure or table, ready to paste anywhere in the paper
function copyXref(el) {
  const tgt = paper.targets && paper.targets.get(el.dataset.id);
  const label = tgt ? tgt.label : '';
  const html = `<span class="xref" contenteditable="false" data-ref="${escHtml(el.dataset.id)}">${escHtml(label)}</span>`;
  const done = () => toast(t('Copied: paste it where the paper mentions {what}', { what: label }));
  if (navigator.clipboard && window.ClipboardItem) {
    navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([label], { type: 'text/plain' }) })]).then(done, () => {});
  }
}

/* ------------------------------------------------------------------ */
/*  Paste and drop                                                    */
/* ------------------------------------------------------------------ */

// From the chapter's paste: a picture becomes a figure; a spreadsheet, a
// table; a paper's own pieces (copied from here) keep what they are; text
// with $maths$ and [@citations] (Markdown, Pandoc) has them made. Anything
// else is left to NEO's own paste. true = handled.
function paperPaste(e, body, chId) {
  if (e.target !== body && e.target.closest && e.target.closest('figure')) {
    // into a caption or a cell: words only
    e.preventDefault();
    document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s*\n\s*/g, ' '));
    return true;
  }
  const files = [...(e.clipboardData.files || [])].filter((f) => FIGURE_TYPES[f.type]);
  const html = e.clipboardData.getData('text/html');
  const text = e.clipboardData.getData('text/plain');
  if (files.length && !(html && /<(p|span|div)\b/i.test(html) && !/<img\b/i.test(html))) {
    e.preventDefault();
    paperAddFigure(files[0], body);
    return true;
  }
  const table = clipboardTable(html, text);
  if (table) {
    e.preventDefault();
    snapshotStructure('table');
    const fig = makeTable(table.rows, table.header);
    placeBlock(fig, body);
    syncChapter(body, chId);
    resetNativeUndo();
    breakRun++;
    paperRenumber();
    fig.querySelector('figcaption').focus();
    return true;
  }
  if (html && /class="(?:cite|xref|math|eq|fig|tbl|h[123])\b/.test(html)) {
    e.preventDefault();
    const clean = paperPasteHtml(html);
    document.execCommand('insertHTML', false, clean);
    stripJunkSpans(body);
    return true;
  }
  if (!html && text && (/\$[^$\s][^$]*\$/.test(text) || /\[@[\w:.#$%&+?<>~/-]+/.test(text))) {
    e.preventDefault();
    const parts = text.replace(/\r/g, '').split(/\n+/).filter((p) => p.trim());
    const out = parts.map((p) => {
      let s = escHtml(p.trim());
      s = s.replace(/\[((?:[^\]]*?@[\w:.#$%&+?<>~/-]+[^\]]*?))\]/g, (m, inner) => {
        const items = inner.split(';').map((bit) => {
          const mm = /^\s*(.*?)\s*@([\w:.#$%&+?<>~/-]+)\s*,?\s*(.*?)\s*$/.exec(bit);
          if (!mm) return null;
          const x = { id: mm[2] };
          if (mm[1]) x.prefix = mm[1];
          const loc = NeoCite.parseLocator(mm[3]);
          if (loc.locator) { x.locator = loc.locator; x.label = loc.label; }
          return x;
        }).filter(Boolean);
        return items.length ? citeHtml(items) : m;
      });
      s = s.replace(/\$\$([^$]+)\$\$/g, (m, tex) => `<span class="math" contenteditable="false">${tex}</span>`);
      s = s.replace(/(^|[^\\$\w])\$([^\s$](?:[^$]*?[^\s$\\])?)\$(?!\d)/g, (m, pre, tex) => `${pre}<span class="math" contenteditable="false">${tex}</span>`);
      return s;
    });
    out.forEach((line, i) => {
      if (i > 0) document.execCommand('insertParagraph');
      document.execCommand('insertHTML', false, line);
    });
    stripJunkSpans(body);
    return true;
  }
  return false;
}
// Pieces copied out of a paper, kept; everything else reduced as NEO reduces it
function paperPasteHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = (node) => [...node.childNodes].map((n) => {
    if (n.nodeType === 3) return escHtml(n.data);
    if (n.nodeType !== 1) return '';
    const tag = n.tagName.toLowerCase();
    const cls = n.classList;
    if (cls.contains('cite')) return citeHtml(citeData(n), n.hasAttribute('data-narrative'));
    if (cls.contains('xref')) return `<span class="xref" contenteditable="false" data-ref="${escHtml(n.dataset.ref || '')}">${escHtml(n.textContent)}</span>`;
    if (cls.contains('math')) return `<span class="math" contenteditable="false">${escHtml(texOf(n))}</span>`;
    // a symbol stays one when this paper defines it (pasted from another, it's its maths)
    if (cls.contains('sym')) return symbolOf(n.dataset.sym) ? symHtml(symbolOf(n.dataset.sym)) : `<span class="math" contenteditable="false">${escHtml(texOf(n))}</span>`;
    if (cls.contains('eq')) return `<p class="eq" contenteditable="false" data-id="${paperId('eq')}">${escHtml(texOf(n))}</p>`;
    if (cls.contains('symtab')) return makeSymbolTable(['parameter', 'variable'].includes(n.dataset.kind) ? n.dataset.kind : '').outerHTML;
    // a figure or a table is made again from its parts: nothing else in
    // the clipboard's markup comes along
    if (tag === 'figure' && cls.contains('tbl')) {
      const rows = [...n.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th, td')].map((c) => cellHtml(c)));
      const fig = makeTable(rows.length ? rows : [['']], !!n.querySelector('tr:first-child th'));
      if (['h', 't', 'b', 'p', 'H'].includes(n.dataset.place)) fig.dataset.place = n.dataset.place;
      if (n.dataset.span === 'page') fig.dataset.span = 'page';
      const cap = n.querySelector('figcaption');
      fig.querySelector('figcaption').innerHTML = cap ? cellHtml(cap) : '';
      return fig.outerHTML;
    }
    if (tag === 'figure' && cls.contains('fig')) {
      const okSrc = (v) => (/^figure-[a-z0-9]{4,40}\.(?:png|jpe?g|gif|webp|svg)$/.test(v || '') ? v : '');
      const alt = (img) => escHtml(img ? img.alt : '').replace(/"/g, '&quot;');
      const cap = n.querySelector(':scope > figcaption');
      const panels = [...n.querySelectorAll(':scope > .panel')].map((p) => `<div class="panel"${okSrc(p.dataset.src) ? ` data-src="${okSrc(p.dataset.src)}"` : ''}${['2', '3'].includes(p.dataset.colspan) ? ` data-colspan="${p.dataset.colspan}"` : ''}><img alt="${alt(p.querySelector('img'))}"><span class="subcap" contenteditable="true">${cellHtml(p.querySelector('.subcap') || document.createElement('i'))}</span></div>`);
      const one = !panels.length && okSrc(n.dataset.src) ? ` data-src="${okSrc(n.dataset.src)}"` : '';
      return `<figure class="fig" contenteditable="false" data-id="${paperId('fig')}"${one}${figureLayoutAttrs(n)}>${panels.length ? panels.join('') : `<img alt="${alt(n.querySelector(':scope > img'))}">`}<figcaption contenteditable="true">${cap ? cellHtml(cap) : ''}</figcaption></figure>`;
    }
    if (tag === 'p') {
      const level = HEADINGS.find((h) => cls.contains(h));
      if (level) return `<p class="${level}" data-id="${paperId('sec')}">${out(n)}</p>`;
      if (cls.contains('li') && ['ul', 'ol'].includes(n.dataset.list)) {
        const deep = ['2', '3'].includes(n.dataset.level) ? ` data-level="${n.dataset.level}"` : '';
        return `<p class="li" data-list="${n.dataset.list}"${deep}>${out(n)}</p>`;
      }
      return `<p>${out(n)}</p>`;
    }
    if (['i', 'em'].includes(tag)) return `<i>${out(n)}</i>`;
    if (['b', 'strong'].includes(tag)) return `<b>${out(n)}</b>`;
    if (['sub', 'sup', 'u', 's'].includes(tag)) return `<${tag}>${out(n)}</${tag}>`;
    if (tag === 'br') return '<br>';
    if (['script', 'style', 'meta', 'title'].includes(tag)) return '';
    return out(n);
  }).join('');
  return out(doc.body);
}

// Pictures and reference files dropped on the page
function paperDragOver(e) {
  if (!book || !isPaper() || currentTab !== 'manuscript') return;
  if ([...e.dataTransfer.items || []].some((i) => i.kind === 'file')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
}
async function paperDrop(e) {
  if (!book || !isPaper() || currentTab !== 'manuscript' || !e.dataTransfer.files.length) return;
  e.preventDefault();
  const files = [...e.dataTransfer.files];
  const refs = files.filter((f) => /\.(bib|ris|json)$/i.test(f.name));
  if (refs.length) { for (const f of refs) await paperImportText(await f.text(), f.name); return; }
  const pics = files.filter((f) => FIGURE_TYPES[f.type]);
  if (!pics.length) { toast(t('Drop a picture (PNG, JPEG, SVG…) for a figure, or a .bib, .ris or CSL JSON file of references')); return; }
  const onFig = e.target.closest && e.target.closest('#chapters figure.fig');
  if (onFig) { for (const f of pics) await addPanel(onFig, f); return; }
  const r = document.caretRangeFromPoint(e.clientX, e.clientY);
  let el = r && r.startContainer;
  if (el && el.nodeType === 3) el = el.parentElement;
  let body = el && el.closest && el.closest('.chapter-body');
  let at = body && el.closest('p, figure');
  if (!body) { body = paperBodies()[paperBodies().length - 1]; at = body && body.lastElementChild; }
  if (!body) return;
  for (const f of pics) await paperAddFigure(f, body, at);
}
$('#paper-scroll').addEventListener('dragover', paperDragOver);
$('#paper-scroll').addEventListener('drop', paperDrop);

/* ------------------------------------------------------------------ */
/*  Clicks on the page's own pieces                                   */
/* ------------------------------------------------------------------ */

$('#chapters').addEventListener('click', (e) => {
  if (!book || !isPaper()) return;
  const node = e.target.closest('.cite, .math, .eq, .xref, .sym, p.symtab');
  if (!node || !node.closest('.chapter-body')) return;
  e.preventDefault();
  if (node.matches('.cite')) openCitePop(node);
  else if (node.matches('.math, .eq')) editMath(node);
  else if (node.matches('.sym')) symbolMenu(e, node);
  else if (node.matches('p.symtab')) symtabMenu(e, node);
  else xrefMenu(e, node);
});
// Shift+F10 (or the menu key): what a click or a right-click opens, for
// where the caret is: a table's rows and columns, a figure's menu, a
// citation's pages, a cross-reference's, the maths beside it
let menuKeyAt = 0;
function paperMenuKey(e) {
  if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey)) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const r = sel.getRangeAt(0);
  const at = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
  if (!at || !at.closest) return false;
  // the menu hangs from what it's for, there being no pointer
  const from = (el) => ({ clientX: 0, clientY: 0, target: el, from: el });
  const tbl = at.closest('figure.tbl');
  const fig = at.closest('figure.fig');
  const beside = [nodeBeside(r, -1), nodeBeside(r, 1)].find((n) => n && n.matches(ATOMS));
  const flagged = editingFlagAt(r.startContainer, r.startOffset);
  let open = null;
  if (flagged) open = () => editingMenu(from(at), flagged);
  else if (tbl) {
    const cell = at.closest('th, td') || tbl.querySelector('th, td');
    open = () => tableMenu(from(cell), cell);
  } else if (fig) open = () => figureMenu(from(at), fig);
  else if (beside && beside.matches('.cite')) open = () => openCitePop(beside, { keys: true });
  else if (beside && beside.matches('.xref')) open = () => xrefMenu(from(beside), beside);
  else if (beside && beside.matches('.sym')) open = () => symbolMenu(from(beside), beside);
  else if (beside) open = () => mathMenu(from(beside), beside);
  if (!open) return false;
  e.preventDefault();
  menuKeyAt = Date.now();
  // when it's done, the caret is back where it was, if nothing else took it
  const place = at.closest('figcaption, .subcap, th, td');
  const was = r.cloneRange();
  Promise.resolve(open()).then(() => {
    if (!place || !place.isConnected || !place.contains(was.startContainer)) return;
    if (document.querySelector('.modal-backdrop:not([hidden]), .pop-menu, .paper-pop')) return;
    place.focus({ preventScroll: true });
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(was);
  });
  return true;
}
$('#chapters').addEventListener('contextmenu', (e) => {
  // the menu key's own, already open
  if (Date.now() - menuKeyAt < 800) { e.preventDefault(); return; }
  if (!book || !isPaper()) return;
  // something the editing pass marked: why, and the fix (not the spellcheck's menu too)
  const pos = editingOn && document.caretRangeFromPoint(e.clientX, e.clientY);
  const hit = pos && editingFlagAt(pos.startContainer, pos.startOffset);
  if (hit) { e.preventDefault(); e.stopPropagation(); editingMenu(e, hit); return; }
  const cell = e.target.closest('figure.tbl th, figure.tbl td, figure.tbl');
  const fig = e.target.closest('figure.fig');
  const math = e.target.closest('.math:not(.editing)');
  if (cell) { e.preventDefault(); tableMenu(e, cell.matches('figure') ? cell.querySelector('td, th') : cell); }
  else if (fig) { e.preventDefault(); figureMenu(e, fig); }
  else if (math) { e.preventDefault(); mathMenu(e, math); }
});
$('#chapters').addEventListener('mousedown', (e) => {
  // a figure's picture is clicked for its menu, not dragged off as a file
  if (book && isPaper() && e.target.matches('figure.fig img')) e.preventDefault();
  if (book && isPaper() && figTools.fig) figToolsHide(true);
});
$('#chapters').addEventListener('click', (e) => {
  if (book && isPaper() && e.target.matches('figure.fig img')) figureMenu(e, e.target.closest('figure'));
});
async function xrefMenu(e, node) {
  const tgt = paper.targets && paper.targets.get(node.dataset.ref);
  const choice = await popMenu(e.clientX, e.clientY, [
    { label: tgt ? t('Go to {what}', { what: tgt.label }) : t('Its target is gone'), value: 'go', disabled: !tgt },
    { label: t('Remove'), value: 'remove', danger: true }
  ], { from: e.from });
  if (choice === 'go' && tgt) {
    tgt.el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    tgt.el.classList.add('flash');
    setTimeout(() => tgt.el.classList.remove('flash'), 1200);
    // and the caret with it, to write there
    const fig = tgt.el.closest('figure');
    if (fig) enterFigure(fig, 1);
    else if (tgt.el.matches('p.eq')) editMath(tgt.el);
    else { tgt.el.closest('.chapter-body').focus({ preventScroll: true }); caretInto(tgt.el, true); }
  } else if (choice === 'remove') removeNode(node);
}

/* ------------------------------------------------------------------ */
/*  The pane: the paper's sections, in order, to jump to or drag       */
/* ------------------------------------------------------------------ */

function renderPaperNav() {
  const list = $('#nav-list');
  list.innerHTML = '';
  setText($('#nav-head span'), t('Sections'));
  const row = (label, num, cls, go, words) => {
    const item = document.createElement('div');
    item.className = 'nav-item paper-sec ' + cls;
    item.innerHTML = '<div class="n-row"><span class="n-num"></span><span class="n-label"></span><span class="n-words"></span></div>';
    item.querySelector('.n-num').textContent = num || '';
    item.querySelector('.n-label').textContent = label;
    item.querySelector('.n-words').textContent = words ? words.toLocaleString() : '';
    item.addEventListener('mousedown', (e) => e.preventDefault());
    item.onclick = go;
    pressable(item.querySelector('.n-row'), [num, label].filter(Boolean).join(' '));
    list.appendChild(item);
    return item;
  };
  row(t('Title and abstract'), '', 'ps-front', () => { $('#title-page').scrollIntoView({ behavior: scrollBehavior(), block: 'start' }); });
  const heads = paperHeadings();
  const caret = caretBlock(document.activeElement && document.activeElement.closest ? document.activeElement.closest('.chapter-body') || $('#chapters') : $('#chapters'));
  heads.forEach((h, i) => {
    const words = sectionWords(h, heads[i + 1]);
    const item = row(h.textContent.trim() || '…', paperMeta().numbered === false ? '' : h.dataset.num, 'ps-' + headingOf(h), () => {
      switchTab('manuscript');
      const body = h.closest('.chapter-body');
      body.focus({ preventScroll: true });
      const r = document.createRange();
      r.selectNodeContents(h);
      r.collapse(false);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      const sc = $('#paper-scroll');
      sc.scrollTop += h.getBoundingClientRect().top - sc.getBoundingClientRect().top - sc.clientHeight / 5;
      if (IS_POCKET && $('#nav-pane').dataset.pinned !== '1') $('#nav-pane').classList.remove('open');
    }, words);
    if (caret && (caret === h || (h.compareDocumentPosition(caret) & Node.DOCUMENT_POSITION_FOLLOWING && (!heads[i + 1] || heads[i + 1].compareDocumentPosition(caret) & Node.DOCUMENT_POSITION_PRECEDING)))) item.classList.add('current');
    const r = item.querySelector('.n-row');
    // ⌥↑ ⌥↓: the section moves past the one beside it, the keyboard's drag
    r.addEventListener('keydown', (e) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      e.stopPropagation();
      paperNudgeSection(h, e.key === 'ArrowUp' ? -1 : 1);
    });
    r.draggable = true;
    r.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-neo-section', String(i));
      item.classList.add('dragging');
    });
    r.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      const ind = list.querySelector('.nav-drop-ind');
      if (ind) ind.remove();
    });
  });
  row(t('References'), '', 'ps-refs', () => { const el = $('#paper-refs'); if (el) el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }); },
    paper.cited ? paper.cited.length : 0);
  // the main text against the journal's usual length, when it has one
  const j = paperJournal();
  if (j.limits && j.limits.words) {
    const words = bookWordCount();
    const foot = document.createElement('div');
    foot.className = 'paper-limit' + (words > j.limits.words ? ' over' : '');
    foot.textContent = t('{n} of about {max} words for {journal}', { n: words.toLocaleString(), max: j.limits.words.toLocaleString(), journal: j.name });
    foot.title = j.limits.note || '';
    list.appendChild(foot);
  }
}
// the words of a section: from its heading to the next one
function sectionWords(h, next) {
  let n = 0;
  for (let el = h.nextElementSibling; el && el !== next; el = el.nextElementSibling) {
    if (headingOf(el)) break;
    if (el.matches('p:not(.eq)')) n += countWords(el.textContent);
  }
  return n;
}
// A section dragged in the pane moves with everything under it
(() => {
  const list = $('#nav-list');
  list.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('application/x-neo-section')) return;
    e.preventDefault();
    const ind = navDropInd();
    let placed = false;
    for (const it of list.querySelectorAll('.paper-sec.ps-h1:not(.dragging), .paper-sec.ps-h2:not(.dragging), .paper-sec.ps-h3:not(.dragging), .paper-sec.ps-refs')) {
      const r = it.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { list.insertBefore(ind, it); placed = true; break; }
    }
    if (!placed) list.appendChild(ind);
  });
  list.addEventListener('drop', (e) => {
    if (!e.dataTransfer.types.includes('application/x-neo-section')) return;
    e.preventDefault();
    const from = +e.dataTransfer.getData('application/x-neo-section');
    const ind = list.querySelector('.nav-drop-ind');
    const before = ind && ind.nextElementSibling;
    const items = [...list.querySelectorAll('.paper-sec.ps-h1, .paper-sec.ps-h2, .paper-sec.ps-h3')];
    const to = before && items.includes(before) ? items.indexOf(before) : items.length;
    if (ind) ind.remove();
    paperMoveSection(from, to);
  });
})();
// A section past its neighbour at its own level, up (dir < 0) or down,
// never out from under the section it's part of
function paperNudgeSection(h, dir) {
  const heads = paperHeadings();
  const level = (el) => HEADINGS.indexOf(headingOf(el));
  const i = heads.indexOf(h);
  const own = level(h);
  // the next heading at its level that way, or −1 past the end of its parent
  const peer = (from) => {
    for (let k = from + dir; k >= 0 && k < heads.length; k += dir) {
      if (level(heads[k]) < own) return -1;
      if (level(heads[k]) === own) return k;
    }
    return -1;
  };
  const k = peer(i);
  if (k < 0) return;
  let to = k;
  if (dir > 0) {
    // down: after all of the neighbour, before whatever follows it
    to = heads.length;
    for (let m = k + 1; m < heads.length; m++) if (level(heads[m]) <= own) { to = m; break; }
  }
  paperMoveSection(i, to);
  renderPaperNav();
  const rows = [...document.querySelectorAll('#nav-list .paper-sec:not(.ps-front):not(.ps-refs) .n-row')];
  const row = rows[paperHeadings().indexOf(h)];
  if (row) row.focus();
}
function paperMoveSection(from, to) {
  const heads = paperHeadings();
  const h = heads[from];
  if (!h || to === from || to === from + 1) return;
  const level = HEADINGS.indexOf(headingOf(h));
  // the section: its heading and everything up to the next heading as big or bigger
  const part = [h];
  for (let el = h.nextElementSibling; el; el = el.nextElementSibling) {
    const l = HEADINGS.indexOf(headingOf(el));
    if (l >= 0 && l <= level) break;
    part.push(el);
  }
  const target = heads[to];
  if (target && part.includes(target)) return;
  snapshotStructure('section moved');
  const body = h.closest('.chapter-body');
  if (target) for (const el of part) target.before(el);
  else for (const el of part) body.appendChild(el);
  syncChapter(body, body.closest('.chapter').dataset.id);
  resetNativeUndo();
  breakRun++;
  paperRenumber();
  renderNav();
  paperCiteSoon(0);
}

/* ------------------------------------------------------------------ */
/*  The shelf: a new paper, and how one looks there                   */
/* ------------------------------------------------------------------ */

async function createPaperOnShelf(shelf) {
  const meta = await window.neo.createBook({ author: displayAuthor() });
  const chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  // the shape of a paper, to start from: each section says what it answers until it's written
  const sections = ['intro', 'methods', 'results', 'conclusions', 'acknowledgements', 'data', 'contributions', 'competing'].map((k) => `<p class="h1" data-id="${paperId('sec')}">${escHtml(t(PAPER_SECTIONS[k].name))}</p><p><br></p>`);
  await window.neo.writeChapter(meta.id, chId, sections.join(''));
  meta.format = 'paper';
  meta.chapterOrder = [chId];
  meta.paper = { style: NeoCite.DEFAULT_STYLE, authors: displayAuthor() ? [{ name: displayAuthor(), affiliations: [], corresponding: true }] : [] };
  meta.tabNames = { notes: (library.tabDefaults && library.tabDefaults.notes) || 'Notes', outline: 'Outline' };
  await writeBookMeta(meta.id, meta);
  await placeTitle(shelf, meta.id);
  await writeLibrary(library);
  await openBook(meta.id);
  $('#tp-title').focus();
}
function paperTile(el, meta) {
  el.classList.add('paper-tile');
  el.innerHTML = `
    <div class="pt-text"><div class="pt-title"></div><div class="pt-author"></div><div class="pt-lines"><i></i><i></i><i></i><i></i></div></div>
    <div class="b-progress" hidden><div></div></div>`;
  const title = isUntitled(meta.title) ? t('Untitled') : meta.title;
  const tEl = el.querySelector('.pt-title');
  tEl.textContent = title;
  tEl.classList.toggle('long', title.length > 40);
  el.querySelector('.pt-author').textContent = meta.author || '';
}

/* ------------------------------------------------------------------ */
/*  Menus and the state they show                                     */
/* ------------------------------------------------------------------ */

function paperReportState() {
  if (!window.neo.paperState) return;
  const on = !!book && isPaper() && !$('#editor-view').hidden;
  const m = on ? paperMeta() : {};
  let heading = '';
  if (on) {
    const sel = window.getSelection();
    let el = sel && sel.rangeCount ? sel.anchorNode : null;
    if (el && el.nodeType === 3) el = el.parentElement;
    heading = headingOf(el && el.closest ? el.closest('p') : null);
  }
  window.neo.paperState({
    on, style: m.style || null, custom: m.customStyleTitle || '', heading,
    numbered: m.numbered !== false, double: !!m.double, linked: !!paper.linkedPath, journal: m.journal || NeoJournals.DEFAULT,
    editing: on && editingOn, skim: on && skimOn, anonymous: !!m.anonymous, template: m.template ? m.template.name : ''
  });
}
document.addEventListener('selectionchange', () => {
  if (!book || !isPaper()) return;
  clearTimeout(paperReportState.t);
  paperReportState.t = setTimeout(paperReportState, 120);
});

async function paperMenu(msg) {
  // (the preview window closing needs no paper open)
  if (msg.command === 'previewClosed') { paper.previewing = null; clearTimeout(paperPreviewTimer); return; }
  if (!book || !isPaper()) { toast(t('Open a paper first')); return; }
  const m = paperMeta();
  const c = msg.command;
  if (c === 'cite') paperPickAtCaret('cite');
  else if (c === 'xref') paperPickAtCaret('xref');
  else if (c === 'templateImport') { await paperImportTemplate(); return; }
  else if (c === 'templateRemove') { await paperRemoveTemplate(); return; }
  else if (c === 'journal') {
    // a journal brings its citation style along; the writer can still pick another
    const j = msg.value === 'template' && m.template ? NeoJournals.templateLook(m.template) : NeoJournals.get(msg.value);
    if (j.id === NeoJournals.DEFAULT) delete m.journal; else m.journal = j.id;
    if (j.csl && m.style !== j.csl) {
      m.style = j.csl;
      paper.proc = null;
      await paperCiteNow();
    }
    await saveMeta();
    // its words in the cross-references (Fig. 2, Figure 2), saved with the paper
    paperRenumber();
    for (const body of paperBodies()) syncChapter(body, body.closest('.chapter').dataset.id);
    const wrap = $('#tp-abstract-wrap');
    if (wrap && wrap.recount) wrap.recount();
    renderNav();
    const st = NeoCite.STYLES.find((x) => x.id === m.style);
    toast(t('Set for {journal}{style}. File → Preview shows it as printed.', { journal: j.name, style: j.csl && st ? t(', with citations in {style}', { style: st.title }) : '' }), 6000);
  } else if (c === 'preview') paperPreview(msg.value);
  else if (c === 'feedback') paperFeedback();
  else if (c === 'equation') paperInsertEquation();
  else if (c === 'table') paperInsertTable();
  else if (c === 'figure') await paperInsertFigure();
  else if (c === 'editing') paperEditing();
  else if (c === 'editingNext') paperEditingNext(msg.value || 1);
  else if (c === 'skim') paperSkim();
  else if (c === 'anonymous') paperAnonymous();
  else if (c === 'heading') {
    if (currentTab !== 'manuscript') return;
    paperSetHeading(msg.value || '');
  } else if (c === 'style') {
    m.style = msg.value;
    paper.proc = null;
    await saveMeta();
    await paperCiteNow();
    const st = NeoCite.STYLES.find((s) => s.id === msg.value);
    toast(t('Citations set in {style}', { style: st ? st.title : m.customStyleTitle || msg.value }));
  } else if (c === 'styleFile') {
    const file = await pickFile('.csl,application/xml,text/xml');
    if (!file) return;
    const xml = await file.text();
    if (!/<style\b[^>]*xmlns="http:\/\/purl\.org\/net\/xbiblio\/csl"/.test(xml)) { toast(t('That isn’t a CSL style file. The Zotero Style Repository has one for almost every journal.'), 8000); return; }
    const info = NeoCite.describeStyle(xml);
    if (info.note) toast(t('“{style}” puts citations in footnotes, which NEO doesn’t make yet: they’ll show in the text', { style: info.title }), 9000);
    await window.neo.paperWrite(book.id, 'style.csl', btoa(unescape(encodeURIComponent(xml))));
    paper.styleXml.custom = xml;
    m.style = 'custom';
    m.customStyleTitle = info.title;
    paper.proc = null;
    await saveMeta();
    await paperCiteNow();
    toast(t('Citations set in {style}', { style: info.title }));
  } else if (c === 'numbered') {
    m.numbered = m.numbered === false;
    if (m.numbered) delete m.numbered;
    document.body.classList.toggle('paper-unnumbered', m.numbered === false);
    paperRenumber();
    renderNav();
    scheduleMetaSave();
  } else if (c === 'double') {
    m.double = !m.double;
    if (!m.double) delete m.double;
    document.body.classList.toggle('paper-double', !!m.double);
    scheduleMetaSave();
  } else if (c === 'importReferences') {
    const file = await pickFile('.bib,.ris,.json,.txt');
    if (file) await paperImportText(await file.text(), file.name);
  } else if (c === 'linkLibrary') paperLinkLibrary();
  else if (c === 'unlinkLibrary') {
    if (window.neo.paperUnlink) await window.neo.paperUnlink(book.id);
    paper.linkedPath = null;
    paper.linkedStamp = null;
    toast(t('Unlinked. The references stay in the paper.'));
  }
  paperReportState();
}

// From refreshFromDisk: references.json written by the other device, and
// the linked reference file, picked up when NEO comes back into view
async function paperRefresh() {
  if (!book || !isPaper() || refsWriting) return;
  const disk = await window.neo.readJSON(book.id, 'references', []);
  if (refsWriting || !book || !isPaper()) return;
  const json = JSON.stringify(disk);
  if (Array.isArray(disk) && json !== paper.refsSaved && JSON.stringify(paper.refs) === paper.refsSaved) {
    paper.refs = disk;
    paper.refsSaved = json;
    if (paper.proc) paper.proc.setItems(disk);
    paperCiteSoon(0);
    if (currentTab === 'references') paperLibraryRender();
  } else if (Array.isArray(disk) && json !== paper.refsSaved) {
    // changed both here and there: what's new there joins what's here
    await paperSaveRefs(paper.refs);
  }
  paperRefreshLinked();
  // the symbols the same way: theirs adopted when nothing changed here
  if (symbolsWriting) return;
  const syms = await window.neo.readJSON(book.id, 'symbols', []);
  if (symbolsWriting || !book || !isPaper() || !Array.isArray(syms)) return;
  const sj = JSON.stringify(syms);
  if (sj === paper.symbolsSaved) return;
  if (JSON.stringify(paper.symbols) === paper.symbolsSaved) {
    paper.symbols = syms;
    paper.symbolsSaved = sj;
    paperSymbolsShown();
  } else await paperSaveSymbols(paper.symbols);
}

/* ------------------------------------------------------------------ */
/*  Export: the page as a plain model, for paper/export.js            */
/* ------------------------------------------------------------------ */

// an SVG (MathJax's, or a figure's) drawn into a PNG, for Word and LaTeX
async function svgToPng(svgText, { exPx = 8, maxW = 1800, scale = 2 } = {}) {
  let s = svgText.replace(/currentColor/g, '#000');
  const doc = new DOMParser().parseFromString(s, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') return null;
  const size = (v) => {
    const m = /^([\d.]+)(ex|px|pt|em)?$/.exec(String(v || '').trim());
    if (!m) return 0;
    return +m[1] * ({ ex: exPx, em: exPx * 2, pt: 4 / 3, px: 1 }[m[2] || 'px']);
  };
  let w = size(svg.getAttribute('width'));
  let h = size(svg.getAttribute('height'));
  const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  if ((!w || !h) && vb.length === 4) { w = w || vb[2]; h = h || vb[3]; }
  if (!w || !h) { w = w || 800; h = h || 600; }
  const depth = (/vertical-align:\s*(-?[\d.]+)ex/.exec(svg.getAttribute('style') || '') || [])[1];
  const k = Math.min(scale, maxW / w);
  svg.setAttribute('width', w * k + 'px');
  svg.setAttribute('height', h * k + 'px');
  s = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(s)));
  try { await img.decode(); } catch { return null; }
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * k);
  canvas.height = Math.ceil(h * k);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return {
    base64: canvas.toDataURL('image/png').split(',')[1],
    w: canvas.width * (scale / k), h: canvas.height * (scale / k),
    depth: depth ? -depth * exPx : 0
  };
}
async function imageSize(mime, base64) {
  const img = new Image();
  img.src = `data:${mime};base64,${base64}`;
  try { await img.decode(); } catch { return { w: 0, h: 0 }; }
  return { w: img.naturalWidth, h: img.naturalHeight };
}

async function paperModel({ png = false, journal = null, style = null } = {}) {
  await paperLoad().catch(() => {});
  await paperCiteNow();
  // in another style (a preview): set aside, the page left as it is
  let aside = null;
  if (style && style !== (paperMeta().style || NeoCite.DEFAULT_STYLE) && window.CSL) {
    const xml = await paperStyleXml(style);
    if (xml) aside = paperRenderCites(NeoCite.processor({ style: xml, locales: await paperLocales(), items: paper.refs }));
  }
  const citeHtmlOf = (n) => (aside ? aside.text.get(n) : paper.citeText.get(n)) || (typeof n === 'string' ? '' : n.innerHTML);
  paperRenumber();
  const m = paperMeta();
  // maths as an SVG drawing (pages, PDF), MathML (Word's own equations) and,
  // where Word or LaTeX can't use those, a PNG
  const mathRun = async (tex, display) => {
    const svg = mathReady() ? texSvg(tex, display) : null;
    const svgText = svg ? new XMLSerializer().serializeToString(svg) : '';
    let mml = '';
    try { if (mathReady() && window.MathJax.tex2mml) mml = window.MathJax.tex2mml(tex, { display }); } catch { /* the picture will do */ }
    return { svg: svgText, mml, png: png && svgText ? await svgToPng(svgText) : null };
  };
  const runsOf = async (node, fmt = {}) => {
    const out = [];
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { if (n.data) out.push({ text: n.data.replace(/ /g, ' '), ...fmt }); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      const cls = n.classList;
      if (cls.contains('ph-mark') || cls.contains('darling-anchor')) continue;
      if (cls.contains('cite')) { out.push({ cite: citeData(n), narrative: n.hasAttribute('data-narrative'), html: paperSafe(citeHtmlOf(n)) }); continue; }
      if (cls.contains('xref')) {
        const tgt = paper.targets && paper.targets.get(n.dataset.ref);
        out.push({ xref: n.dataset.ref, kind: tgt ? tgt.kind : '', num: tgt ? tgt.num : '', label: n.textContent });
        continue;
      }
      if (cls.contains('math')) { out.push({ math: texOf(n), ...(await mathRun(texOf(n), false)) }); continue; }
      // a symbol: maths to every format, its own name to LaTeX (one no longer defined is only its maths)
      if (cls.contains('sym')) { const tex = symTex(n); out.push({ ...(symbolOf(n.dataset.sym) ? { sym: n.dataset.sym } : {}), math: tex, ...(await mathRun(tex, false)) }); continue; }
      if (tag === 'br') { out.push({ text: '\n', ...fmt }); continue; }
      const next = { ...fmt };
      if (tag === 'i' || tag === 'em') next.i = !fmt.i;
      if (tag === 'b' || tag === 'strong') next.b = true;
      if (tag === 'u') next.u = true;
      if (tag === 's' || tag === 'strike') next.s = true;
      if (tag === 'sup') next.sup = true;
      if (tag === 'sub') next.sub = true;
      out.push(...await runsOf(n, next));
    }
    return out;
  };
  const authors = (m.authors || []).filter((a) => a.name);
  const affiliations = paperAffiliations(authors);
  const model = {
    title: isUntitled(book.title) ? '' : book.title,
    subtitle: book.subtitle || '',
    authors: authors.map((a) => ({ ...a, affiliations: (a.affiliations || []).map((f) => affiliations.indexOf(f)).filter((n) => n >= 0) })),
    affiliations,
    abstract: [],
    keywords: m.keywords || [],
    numbered: m.numbered !== false,
    double: !!m.double,
    font: getComputedStyle(paperBodies()[0] || document.body).fontFamily,
    symbols: paper.symbols.map((s) => ({ id: s.id, tex: s.tex })),
    blocks: []
  };
  const abs = document.createElement('div');
  abs.innerHTML = paperClean(m.abstract || '');
  for (const p of abs.querySelectorAll('p')) if (p.textContent.trim()) model.abstract.push(await runsOf(p));
  for (const body of paperBodies()) {
    for (const el of body.children) {
      if (el.matches('p.h1, p.h2, p.h3')) model.blocks.push({ type: 'heading', level: HEADINGS.indexOf(headingOf(el)) + 1, num: el.dataset.num || '', unnumbered: isBackMatter(el), id: el.dataset.id, runs: await runsOf(el) });
      else if (el.matches('p.eq')) model.blocks.push({ type: 'equation', id: el.dataset.id, num: el.dataset.num || '', tex: texOf(el), ...(await mathRun(texOf(el), true)) });
      else if (el.matches('p.li')) model.blocks.push({ type: 'item', list: el.dataset.list === 'ol' ? 'ol' : 'ul', level: Math.min(3, listLevel(el)), runs: await runsOf(el) });
      else if (el.matches('p.symtab')) {
        // the table as it's drawn: its rows, their maths, their sources set in the paper's style
        const rows = [];
        for (const sym of symtabRows(el)) {
          const html = sym.cite && sym.cite.length ? citeHtmlOf(symtabKey(el, sym.id)) : '';
          rows.push({ id: sym.id, tex: sym.tex, meaning: sym.meaning || '', unit: sym.unit || '', value: sym.value || '', kind: sym.kind || '',
            ...(await mathRun(sym.tex, false)), cite: html ? { cite: sym.cite, narrative: false, html: paperSafe(html) } : null });
        }
        model.blocks.push({ type: 'symbols', kind: el.dataset.kind || '', rows });
      }
      else if (el.matches('figure.fig')) {
        // a picture: its file, and for Word and LaTeX a PNG of an SVG, and its size
        const picture = async (holder) => {
          const name = holder.dataset.src || '';
          const base64 = name ? await window.neo.paperRead(book.id, name) : null;
          const mime = FIGURE_MIME[name.split('.').pop()] || 'image/png';
          const pic = { name, mime, base64, alt: (holder.querySelector(':scope > img') || {}).alt || '' };
          if (base64 && mime === 'image/svg+xml' && png) pic.png = await svgToPng(new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))), { scale: 1, maxW: 2000 });
          else if (base64 && png) Object.assign(pic, await imageSize(mime, base64));
          return pic;
        };
        const d = el.dataset;
        const fig = {
          type: 'figure', id: d.id, num: d.num || '', width: d.width ? +d.width : 0, cols: d.cols ? +d.cols : 0,
          wrap: d.wrap || '', place: d.place || '', span: d.span === 'page',
          caption: await runsOf(el.querySelector(':scope > figcaption') || document.createElement('i'))
        };
        const panels = [...el.querySelectorAll(':scope > .panel')];
        if (panels.length) {
          fig.panels = [];
          for (const p of panels) fig.panels.push({ ...(await picture(p)), colspan: +(p.dataset.colspan || 1), sub: await runsOf(p.querySelector('.subcap') || document.createElement('i')) });
          Object.assign(fig, fig.panels[0], { sub: undefined, colspan: undefined });
        } else Object.assign(fig, await picture(el));
        model.blocks.push(fig);
      } else if (el.matches('figure.tbl')) {
        const rows = [];
        for (const tr of el.querySelectorAll('tr')) {
          const row = [];
          for (const c of tr.children) row.push(await runsOf(c));
          rows.push(row);
        }
        model.blocks.push({ type: 'table', id: el.dataset.id, num: el.dataset.num || '', place: el.dataset.place || '', span: el.dataset.span === 'page', caption: await runsOf(el.querySelector('figcaption') || document.createElement('i')), header: !!el.querySelector('tr:first-child th'), rows });
      } else if (el.matches('p') && !el.classList.contains('ghost')) model.blocks.push({ type: 'para', runs: await runsOf(el), flush: el.classList.contains('flush') });
    }
  }
  const cited = new Set(paper.cited || []);
  const proc = paper.proc;
  const st = NeoCite.STYLES.find((s) => s.id === m.style);
  model.style = { id: m.style === 'custom' ? 'style' : m.style, title: st ? st.title : m.customStyleTitle || '', numeric: proc ? proc.info.numeric : !!(st && st.numeric), xml: paper.styleXml[m.style || NeoCite.DEFAULT_STYLE] || '' };
  if (aside) {
    const as = NeoCite.STYLES.find((s) => s.id === style);
    model.style = { id: style, title: as ? as.title : style, numeric: !!(as && as.numeric), xml: paper.styleXml[style] || '' };
  }
  const bib = (aside ? aside.bibliography : paper.bibliography) || { entries: [] };
  model.bibliography = { ...bib, entries: bib.entries.map((e) => ({ id: e.id, html: paperSafe(e.html, { links: true }) })) };
  // the journal sets the page (and, for LaTeX, the class)
  model.journal = journal ? NeoJournals.get(journal) : paperJournal();
  model.references = paper.refs.filter((r) => cited.has(r.id));
  model.bibtex = NeoReferences.toBibtex(model.references);
  // the abstract's sentences by the move each makes (the talk outline's narrative)
  model.moves = abstractMoves(model.abstract.map((p) => NeoPaperExport.runsText(p)).join(' ').replace(/\s+/g, ' ').trim());
  return m.anonymous ? anonymize(model) : model;
}

// File → Export, for a paper (from doExport)
async function paperExport(format) {
  const name = safeName(isUntitled(book.title) ? t('Untitled') : book.title);
  flushAllSaves();
  const note = setTimeout(() => toast(t('Preparing the export…')), 400);
  try {
    let payload;
    if (format === 'bib') {
      if (!paper.refs.length) { toast(t('This paper has no references yet')); return; }
      payload = { format: 'bib', defaultName: name, content: NeoReferences.toBibtex(paper.refs) };
    } else if (format === 'md' || format === 'txt') {
      const model = await paperModel();
      payload = { format, defaultName: name, content: format === 'md' ? NeoPaperExport.markdown(model) : NeoPaperExport.text(model) };
    } else if (format === 'epub') {
      const model = await paperModel({ png: true });
      payload = { format: 'epub', defaultName: name, zipEntries: NeoPaperExport.epub(model, { uuid: 'urn:neo:' + book.id }) };
    } else if (format === 'latex' || format === 'pandoc') {
      const model = await paperModel({ png: true });
      // a venue's template: the LaTeX fills it, with its own files beside
      if (format === 'latex' && paperMeta().journal === 'template') model.template = await paperTemplateFiles();
      payload = { format: 'zip', defaultName: name + (format === 'latex' ? '-latex' : '-markdown'), zipEntries: format === 'latex' ? NeoPaperExport.latex(model) : NeoPaperExport.pandoc(model) };
    } else if (format === 'docx') {
      const model = await paperModel({ png: true });
      payload = { format: 'docx', defaultName: name, zipEntries: NeoPaperExport.docx(model) };
    } else if (format === 'talk') {
      const model = await paperModel({ png: true });
      payload = { format: 'zip', defaultName: name + '-talk', zipEntries: NeoPaperExport.talk(model) };
    } else if (format === 'pdf' || format === 'html') {
      const model = await paperModel();
      payload = { format, defaultName: name, content: NeoPaperExport.html(model, { print: format === 'pdf' }), print: format === 'pdf' ? 'paper' : undefined };
    } else {
      toast(t('A paper exports as PDF, Word, LaTeX, Markdown, EPUB, plain text or a web page'));
      return;
    }
    clearTimeout(note);
    const saved = await window.neo.exportSave(payload);
    if (saved) toast(t('Exported: {file}', { file: saved.split(/[\\/]/).pop() }));
    const missing = document.querySelectorAll('#chapters .cite[data-missing], #chapters .xref[data-missing]').length;
    if (saved && missing) toast(t('Exported, with {n} citations or cross-references that point at nothing (marked ? on the page)', { n: missing }), 8000);
  } catch (err) {
    clearTimeout(note);
    window.neo.logError('paper export: ' + (err && err.stack || err));
    toast(t('Couldn’t export: {error}', { error: plainError(err) }), 8000);
  }
}
// File → Preview (⌥⌘P) and Preview As: the paper as a journal would print
// it, in a window of its own. Only the look changes: the journal set in
// Format → Journal stays as it is.
async function paperPreview(journalId, { quiet = false } = {}) {
  if (!window.neo.paperPreview) { toast(t('Previews are made by the desktop app')); return; }
  const j = NeoJournals.get(journalId || paperMeta().journal || NeoJournals.DEFAULT);
  // the window keeps showing the paper as it's written (paperPreviewSoon)
  paper.previewing = journalId || '';
  const note = quiet ? null : setTimeout(() => toast(t('Setting the paper as {journal}…', { journal: j.name })), 300);
  try {
    // in the journal's own citation style when it has one: for the preview only
    const viewing = journalId && journalId !== (paperMeta().journal || NeoJournals.DEFAULT);
    const model = await paperModel({ journal: j.id, style: viewing && j.csl ? j.csl : null });
    const title = (isUntitled(book.title) ? t('Untitled') : book.title) + ' — ' + j.name;
    await window.neo.paperPreview(NeoPaperExport.html(model, { print: true, anchors: true }), title, { focus: paperCaretAnchor(), quiet });
  } catch (err) {
    window.neo.logError('paper preview: ' + (err && err.stack || err));
    toast(t('Couldn’t make the preview: {error}', { error: plainError(err) }), 8000);
  } finally {
    clearTimeout(note);
  }
}

// File → Draft for Feedback…: the paper as a PDF to comment on, or a Word
// file to track changes in, opening with the kind of feedback it asks for
// (docs/writing-principles.md, section 5): reviewers asked for one level
// give that one, and the writer isn't sent spelling fixes on a draft whose
// argument is still moving.
const FEEDBACK_LEVELS = {
  top: { name: tk('Top-level'), what: tk('The idea and the argument'), items: [tk('Is the idea good, and does it suit where it’s going?'), tk('Is the argument self-consistent and logical?'), tk('Does the story hold: the problem, what was done, what was found, why it matters?')] },
  coarse: { name: tk('Coarse-grained'), what: tk('The structure and the style'), items: [tk('Does the style suit the venue?'), tk('Is every paragraph there for a reason, and do they talk to each other?'), tk('What can be taken away?'), tk('What should be added?')] },
  fine: { name: tk('Fine-grained'), what: tk('The sentences'), items: [tk('Spelling and grammar'), tk('Consistency of terms and style'), tk('Anything that reads awkwardly (marking what’s only a preference)')] }
};
async function paperFeedback() {
  const level = await optionModal(t('What feedback do you want?'), t('Asking for one kind at a time gets better answers. The draft opens with your request.'),
    Object.entries(FEEDBACK_LEVELS).map(([value, l]) => ({ label: t(l.name), desc: t(l.what) + ': ' + l.items.map((i) => t(i)).join(' '), value })));
  if (!level) return;
  const format = await optionModal(t('Send it as'), null, [
    { label: 'PDF', desc: t('To read and comment on'), value: 'pdf' },
    { label: 'Word (.docx)', desc: t('To edit with tracked changes'), value: 'docx' }
  ]);
  if (!format) return;
  const l = FEEDBACK_LEVELS[level];
  const model = await paperModel({ png: format === 'docx' });
  model.feedback = {
    heading: t('Draft for feedback — {date}', { date: new Date().toLocaleDateString(NeoI18n.getLocale(), { year: 'numeric', month: 'long', day: 'numeric' }) }),
    ask: t('I’m asking for {level} feedback: {what}.', { level: t(l.name).toLowerCase(), what: t(l.what).toLowerCase() }),
    items: l.items.map((i) => t(i)),
    note: t('Please leave the other kinds for a later draft.')
  };
  const name = safeName(isUntitled(book.title) ? t('Untitled') : book.title) + '-' + t('for-feedback');
  try {
    const saved = await window.neo.exportSave(format === 'pdf'
      ? { format: 'pdf', defaultName: name, content: NeoPaperExport.html(model, { print: true }), print: 'paper' }
      : { format: 'docx', defaultName: name, zipEntries: NeoPaperExport.docx(model) });
    if (saved) toast(t('Exported: {file}', { file: saved.split(/[\\/]/).pop() }));
  } catch (err) {
    window.neo.logError('feedback draft: ' + (err && err.stack || err));
    toast(t('Couldn’t export: {error}', { error: plainError(err) }), 8000);
  }
}

// The section (or figure, table, equation) the caret is in or just after
function paperCaretAnchor() {
  const sel = window.getSelection();
  let el = sel && sel.rangeCount ? sel.anchorNode : null;
  if (el && el.nodeType === 3) el = el.parentElement;
  const body = el && el.closest ? el.closest('.chapter-body') : null;
  if (!body) return '';
  let block = el;
  while (block && block.parentElement !== body) block = block.parentElement;
  for (let b = block; b; b = b.previousElementSibling) {
    if (b.dataset && b.dataset.id && b.matches('p.h1, p.h2, p.h3, figure, p.eq')) return b.dataset.id;
  }
  return '';
}
// A redraw of an open preview, a few seconds after the writing stops
let paperPreviewTimer = null;
function paperPreviewSoon() {
  if (paper.previewing === undefined || paper.previewing === null || !book || !isPaper()) return;
  clearTimeout(paperPreviewTimer);
  paperPreviewTimer = setTimeout(() => {
    if (paper.previewing !== undefined && paper.previewing !== null && book && isPaper()) paperPreview(paper.previewing, { quiet: true });
  }, 3000);
}
document.addEventListener('input', (e) => {
  if (e.target && e.target.closest && e.target.closest('#paper')) paperPreviewSoon();
}, true);

// The email snapshot of a paper, as it prints
async function paperPrintHtml() {
  return NeoPaperExport.html(await paperModel(), { print: true });
}
