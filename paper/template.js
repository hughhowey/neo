// NEO — a venue's LaTeX template
//
// Conferences and workshops (NeurIPS, ICML, ICLR, ACL…) hand out a zip: a
// main .tex, the venue's style package (.sty) or class (.cls), often a
// .bst, sometimes math_commands.tex and a logo. A writer imports it into a
// paper; NEO keeps it beside the paper as template.zip, and from then on
// the LaTeX export fills that template with the paper instead of NEO's own
// preamble. NEO never ships a venue's files: the writer brings them.
//
//   read(files)                 → what the template is (below)
//   fill(tpl, files, parts, { anonymous })
//                               → the main .tex, filled with the paper
//   layout(tpl, files)          → { main, files }: its files at their paths
//                                 beside the main .tex
//   pageLimit(tex), venueName(id), stripComments(tex): pieces of read
//
// files: [{ path, text }] as in the zip; text for .tex .sty .cls .bst .cfg
// .clo .def .bbx .cbx .bib, none for pictures and PDFs (base64 instead,
// where the caller has it).
//
// read's analysis:
//   { ok, error, main, name, kind, cls, clsOpts, pkg, pkgOpts, bst, natbib,
//     columns, fontSize, paper, review, pages, look }
//   kind     'neurips' | 'icml' | 'iclr' | 'acl' | 'generic': the author
//            block and the review switch
//   review   { via: 'option', anonymous, named } (the venue package's
//            options), { via: 'command', named } (\iclrfinalcopy), or null
//   pages    the page limit the main .tex states, else null
//   look     the NEO journal look to preview it in, else null
//
// parts (made from the paper by NeoPaperExport, all of it TeX already):
//   { title, subtitle, authors: [{ name, affiliations: [n], email, corresponding }],
//     affiliations: [text], abstract, keywords: [text], preamble: [lines], body,
//     needs: { graphicx, booktabs, subcaption, float, wrapfig, tabularx }, numeric }
//
// Plain string work only: it runs in the window, in Pocket and under
// node's tests alike (window.NeoTemplate).

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports && !root.document) module.exports = api;
  else root.NeoTemplate = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KINDS = ['neurips', 'icml', 'iclr', 'acl', 'generic'];
  // why a zip won't do, in English (the window translates them)
  const NO_FILES = 'no files in the template';
  const NO_MAIN = 'no main .tex: a .tex file with \\documentclass and \\begin{document}';
  const ERRORS = [NO_FILES, NO_MAIN];

  // ---------------------------------------------------------------------
  // Reading TeX: comments, groups, commands
  // ---------------------------------------------------------------------
  // a % that starts a comment: not \%, but \\% (a line break, then a comment)
  const escaped = (s, i) => { let n = 0; while (i - n - 1 >= 0 && s[i - n - 1] === '\\') n++; return n % 2 === 1; };
  // The text with its comments blanked out, character for character, so a
  // place found in it is the same place in the text as written
  function mask(s) {
    s = String(s || '');
    let out = '';
    let from = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== '%' || escaped(s, i)) continue;
      const end = s.indexOf('\n', i);
      const stop = end < 0 ? s.length : end;
      out += s.slice(from, i) + ' '.repeat(stop - i);
      from = i = stop;
    }
    return out + s.slice(from);
  }
  const stripComments = (s) => mask(s).replace(/[ \t]+$/gm, '');
  // from an opening brace (or bracket) to just past its partner; -1 if it has none
  function group(s, i) {
    const [open, close] = s[i] === '[' ? ['[', ']'] : ['{', '}'];
    let depth = 0;
    for (let k = i; k < s.length; k++) {
      const c = s[k];
      if ((c === '{' || c === '}') && escaped(s, k)) continue;
      // inside [..] only braces nest: [a={b]}] is one option
      if (open === '[' && c === '{') { const e = group(s, k); if (e < 0) return -1; k = e - 1; continue; }
      if (c === open) depth++;
      else if (c === close && --depth === 0) return k + 1;
    }
    return -1;
  }
  // every \name[opt]{arg} in the (masked) text: { start, end, opt, arg },
  // end past as many more {…} as it takes (\icmlsetsymbol{equal}{*}: two)
  function commands(s, name, count = 1) {
    const out = [];
    const re = new RegExp(`\\\\${name}(?![A-Za-z@])\\*?`, 'g');
    let m;
    while ((m = re.exec(s))) {
      if (escaped(s, m.index)) continue;
      let k = m.index + m[0].length;
      const skip = () => { while (/\s/.test(s[k] || '')) k++; };
      skip();
      let opt = null;
      if (s[k] === '[') { const e = group(s, k); if (e < 0) continue; opt = s.slice(k + 1, e - 1); k = e; skip(); }
      if (s[k] !== '{') { out.push({ start: m.index, end: k, opt, arg: null }); continue; }
      let e = group(s, k);
      if (e < 0) continue;
      const arg = s.slice(k + 1, e - 1);
      for (let n = 1; n < count; n++) {
        k = e;
        skip();
        const more = s[k] === '{' ? group(s, k) : -1;
        if (more < 0) break;
        e = more;
      }
      out.push({ start: m.index, end: e, opt, arg });
      re.lastIndex = e;
    }
    return out;
  }
  // \newcommand{\title}…, \def\title…: a definition, not a use
  const defining = (s, i) => /\\(?:(?:re)?newcommand|providecommand|DeclareRobustCommand|[gex]?def|let)\*?\s*\{?\s*$/.test(s.slice(Math.max(0, i - 40), i));
  const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  // the packages a text loads: [{ start, end, opt, names }]
  const loads = (s) => [...commands(s, 'usepackage'), ...commands(s, 'RequirePackage')].filter((c) => c.arg !== null)
    .map((c) => ({ ...c, names: list(c.arg) })).sort((a, b) => a.start - b.start);
  const docStart = (s) => { const m = /\\begin\s*\{document\}/.exec(s); return m ? m.index : -1; };

  // ---------------------------------------------------------------------
  // Paths in the zip
  // ---------------------------------------------------------------------
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  // the Mac's resource forks and folder notes travel in zips; they aren't the template
  const junk = (p) => /(^|\/)__MACOSX\//.test(p) || /(^|\/)\._/.test(p) || /(^|\/)\.DS_Store$/.test(p) || /\/$/.test(p);
  const base = (p) => norm(p).split('/').pop();
  const dir = (p) => { const s = norm(p).split('/'); s.pop(); return s.join('/'); };
  const stem = (p) => base(p).replace(/\.[^.]+$/, '');
  // one that could write outside the folder: absolute, or with a .. in it
  const unsafe = (p) => /^\//.test(p) || /^[A-Za-z]:/.test(p) || p.split('/').some((x) => x === '..');
  const textOf = (files, p) => { const f = (files || []).find((x) => norm(x.path) === p); return f && typeof f.text === 'string' ? f.text : ''; };
  // a file found by its name alone (icml2025.sty), wherever it sits
  const named = (files, name) => (files || []).find((x) => base(x.path) === name);
  const textNamed = (files, name) => { const f = named(files, name); return f && typeof f.text === 'string' ? f.text : ''; };

  // ---------------------------------------------------------------------
  // Names and kinds
  // ---------------------------------------------------------------------
  const KIND_OF = [[/^(neurips|nips)/, 'neurips'], [/^icml/, 'icml'], [/^iclr/, 'iclr'], [/^(acl|naacl|emnlp|eacl|aacl)(?![a-z])/, 'acl']];
  const kindOf = (id) => { const k = KIND_OF.find(([re]) => re.test(String(id || '').toLowerCase())); return k ? k[1] : 'generic'; };
  // venues that aren't simply capitals
  const VENUES = { neurips: 'NeurIPS', nips: 'NeurIPS', corl: 'CoRL', colm: 'COLM', automl: 'AutoML', midl: 'MIDL', aistats: 'AISTATS' };
  // the words of a file name that say nothing about the venue
  const NOISE = new Set(['conference', 'conf', 'style', 'styles', 'template', 'latex', 'natbib', 'main', 'paper', 'example', 'submission', 'files', 'master', 'final', 'sty', 'cls', 'tex']);
  // neurips_2025 → NeurIPS 2025, icml2025 → ICML 2025, iclr2025_conference
  // → ICLR 2025, acl_natbib → ACL, aaai25 → AAAI 2025
  function venueName(id) {
    const words = String(id || '').replace(/\.(sty|cls|tex)$/i, '').split(/[_\-\s.]+/).flatMap((w) => w.match(/[A-Za-z]+|\d+/g) || []);
    const at = words.findIndex((w) => /^[A-Za-z]+$/.test(w) && !NOISE.has(w.toLowerCase()));
    if (at < 0) return '';
    const w = words[at];
    const venue = VENUES[w.toLowerCase()] || (w === w.toLowerCase() ? (w.length <= 7 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)) : w);
    // the year: four digits anywhere, or two right after the venue
    const four = words.find((x) => /^(19|20)\d\d$/.test(x));
    const two = /^\d\d$/.test(words[at + 1] || '') ? '20' + words[at + 1] : '';
    return [venue, four || two].filter(Boolean).join(' ');
  }
  // a file name as words: my_workshop_paper.tex → My workshop paper
  const tidy = (p) => { const s = stem(p).replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : ''; };
  // the classes every TeX has: no venue's name
  const STANDARD_CLASSES = new Set(['article', 'report', 'book', 'amsart', 'scrartcl', 'memoir', 'extarticle']);
  // packages a venue's zip often carries that are not the venue's style
  const COMMON_STY = new Set(['fancyhdr', 'natbib', 'algorithm', 'algorithmic', 'algorithmicx', 'algpseudocode', 'times', 'hyperref', 'url', 'eso-pic', 'everyshi', 'microtype', 'subfigure', 'subfig', 'caption', 'subcaption', 'geometry', 'xcolor', 'color', 'graphicx', 'amsmath', 'amssymb', 'booktabs', 'lineno', 'forloop']);

  // How each kind switches between the anonymous and the named version.
  // NeurIPS: no option is anonymous; 'preprint' names the authors with no
  // venue footer, and 'final' is the camera-ready (taken when the template
  // already asks for it). ICML: 'accepted'. ACL: 'review' against 'final'
  // (or 'preprint'). ICLR: the \iclrfinalcopy command.
  const KIND_REVIEW = {
    neurips: { anonymous: '', named: ['preprint', 'final'] },
    icml: { anonymous: '', named: ['accepted'] },
    acl: { anonymous: 'review', named: ['final', 'preprint'] }
  };
  // every option that is about the review, dropped before the one wanted is set
  const REVIEW_WORDS = new Set(['review', 'anonymous', 'submission', 'blind', 'final', 'accepted', 'camera', 'cameraready', 'preprint']);
  function reviewOf(kind, given, venue) {
    const declared = (o) => new RegExp(`\\\\DeclareOption\\s*\\{${o}\\}`).test(venue);
    // a \…finalcopy command the style defines (ICLR's, older ACL styles')
    const cmd = /\\(?:def|(?:re)?newcommand\s*\{?|providecommand\s*\{?)\s*\\([A-Za-z]*finalcopy)(?![A-Za-z])/.exec(venue);
    if (kind === 'iclr') return { via: 'command', named: '\\' + (cmd ? cmd[1] : 'iclrfinalcopy') };
    const known = KIND_REVIEW[kind];
    if (known && !(kind === 'acl' && venue && !declared('review') && cmd)) {
      return { via: 'option', anonymous: known.anonymous, named: known.named.find((o) => given.includes(o)) || known.named[0] };
    }
    if (cmd) return { via: 'command', named: '\\' + cmd[1] };
    // another venue's style: what its options say
    const anonymous = ['review', 'anonymous', 'submission', 'blind'].find(declared) || '';
    const named = ['final', 'accepted', 'camera', 'cameraready'].find(declared) || '';
    return anonymous || named ? { via: 'option', anonymous, named } : null;
  }

  // "limited to 8 pages", "up to {\bf nine} pages", "page limit of 4",
  // "at most $8$ pages", "strict upper limit of 10 pages": the first such
  const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
  const N = `(\\d{1,2}|${Object.keys(NUMBERS).join('|')})(?:\\s*\\(\\d{1,2}\\))?`;
  const PAGE_LIMITS = [
    new RegExp(`\\b(?:limited|restricted|fitted|up|confined)\\s+to\\s+${N}\\s+(?:[a-z]+\\s+){0,2}?pages?\\b`, 'gi'),
    new RegExp(`\\b(?:at\\s+most|maximum\\s+of|no\\s+more\\s+than|not\\s+exceed|exceed|limit\\s+of)\\s+${N}\\s+(?:[a-z]+\\s+){0,2}?pages?\\b`, 'gi'),
    new RegExp(`\\bpage\\s+limit\\s+(?:is|of)\\s+${N}\\b`, 'gi'),
    new RegExp(`\\b${N}\\s+pages?\\s+(?:of\\s+(?:content|text|main\\s+text)|long|maximum)\\b`, 'gi'),
    new RegExp(`\\b${N}[-\\s]page\\s+limit\\b`, 'gi')
  ];
  function pageLimit(tex) {
    // the words as they read: \bf, braces, ~ and $ gone
    const s = String(tex || '').replace(/\\[A-Za-z]+\*?/g, ' ').replace(/[{}$%~]/g, ' ').replace(/\s+/g, ' ');
    let best = null;
    for (const re of PAGE_LIMITS) {
      re.lastIndex = 0;
      const m = re.exec(s);
      if (m && (!best || m.index < best.index)) best = { index: m.index, n: m[1].toLowerCase() };
    }
    if (!best) return null;
    const n = NUMBERS[best.n] || parseInt(best.n, 10);
    return n > 0 ? n : null;
  }

  // ---------------------------------------------------------------------
  // read: what the template is
  // ---------------------------------------------------------------------
  function read(files) {
    files = (files || []).filter((f) => f && f.path && !junk(norm(f.path)));
    const fail = (error) => ({ ok: false, error, main: null, name: '', kind: 'generic', cls: null, clsOpts: '', pkg: null, pkgOpts: '', bst: null, natbib: false, columns: 1, fontSize: '10pt', paper: 'letter', review: null, pages: null, look: null });
    if (!files.length) return fail(NO_FILES);
    const paths = files.map((f) => norm(f.path));
    const sty = new Set(paths.filter((p) => /\.sty$/i.test(p)).map(stem));
    // the main .tex: \documentclass and \begin{document}, uncommented
    const mains = files.filter((f) => /\.tex$/i.test(f.path) && typeof f.text === 'string').map((f) => {
      const s = mask(f.text);
      if (!/\\documentclass\b/.test(s) || docStart(s) < 0) return null;
      const p = norm(f.path);
      const own = loads(s.slice(0, docStart(s))).some((l) => l.names.some((n) => sty.has(n)));
      // pdflatex compiles NEO's LaTeX: a LuaLaTeX or XeLaTeX version is the second choice
      const usual = /main|paper|template|example|conference|submission|latex/i.test(base(p)) && !/(lua|xe)latex/i.test(base(p));
      return { p, text: f.text, s, score: [own ? 0 : 1, usual ? 0 : 1, p.length] };
    }).filter(Boolean);
    if (!mains.length) return fail(NO_MAIN);
    mains.sort((a, b) => a.score[0] - b.score[0] || a.score[1] - b.score[1] || a.score[2] - b.score[2] || (a.p < b.p ? -1 : 1));
    const main = mains[0];
    const pre = main.s.slice(0, docStart(main.s));
    const dc = commands(pre, 'documentclass').find((c) => c.arg !== null);
    const cls = dc ? dc.arg.trim() : 'article';
    const clsOpts = dc && dc.opt ? dc.opt.trim() : '';
    // the venue's package: the one main loads from the zip, a venue's by
    // name first, then any that isn't a common package
    const used = loads(pre).flatMap((l) => l.names.map((n) => ({ n, opt: l.opt })));
    const inZip = used.filter((u) => sty.has(u.n));
    const pick = inZip.find((u) => kindOf(u.n) !== 'generic') || inZip.find((u) => !COMMON_STY.has(u.n)) || null;
    const pkg = pick ? pick.n : null;
    const pkgOpts = pick && pick.opt ? pick.opt.trim() : '';
    const clsFile = named(files, cls + '.cls');
    const venue = mask([pkg ? textNamed(files, pkg + '.sty') : '', textNamed(files, cls + '.cls')].join('\n'));
    const kind = kindOf(pkg || (clsFile ? cls : ''));
    const name = (pkg && venueName(pkg)) || (clsFile || !STANDARD_CLASSES.has(cls) ? venueName(cls) : '') || tidy(main.p);
    const bstOf = (s) => { const c = commands(s, 'bibliographystyle').find((x) => x.arg); return c ? c.arg.trim() : null; };
    const bst = bstOf(main.s) || bstOf(venue);
    const natbibIn = (s) => loads(s).some((l) => l.names.includes('natbib'));
    const natbib = natbibIn(pre) || (natbibIn(venue) && !list(pkgOpts).includes('nonatbib'));
    const columns = list(clsOpts).includes('twocolumn') || /\\twocolumn(?![A-Za-z])/.test(venue) || /\\twocolumn(?![A-Za-z])/.test(pre) ? 2 : 1;
    const pt = /(\d+(?:\.\d+)?)pt/.exec(clsOpts);
    const sizeText = clsOpts + '\n' + pre + '\n' + venue;
    const paper = /\ba4paper\b|\\paperwidth\s*=?\s*\{?\s*210\s*mm/.test(sizeText) && !list(clsOpts).includes('letterpaper') ? 'a4' : 'letter';
    return {
      ok: true, error: '', main: main.p, name, kind, cls, clsOpts, pkg, pkgOpts, bst, natbib, columns,
      fontSize: pt ? pt[1] + 'pt' : '10pt', paper,
      review: reviewOf(kind, list(pkgOpts), venue),
      pages: pageLimit(main.text),
      look: kind === 'generic' ? null : kind
    };
  }

  // ---------------------------------------------------------------------
  // fill: the template's preamble, the paper's content
  // ---------------------------------------------------------------------
  // the title block's commands, which the paper's own replace
  const TITLE_BLOCK = ['title', 'author', 'date', 'icmltitlerunning', 'titlerunning', 'authorrunning', 'runningtitle', 'runningauthor',
    'shorttitle', 'shortauthors', 'affil', 'affiliation', 'address', 'email', 'institute', 'keywords'];
  // cut [start, end) out of the text, and the line with it when nothing else is on it
  function cut(s, start, end) {
    const lineStart = s.lastIndexOf('\n', start - 1) + 1;
    const nl = s.indexOf('\n', end);
    const lineEnd = nl < 0 ? s.length : nl;
    if (!s.slice(lineStart, start).trim() && !mask(s.slice(end, lineEnd)).trim()) return s.slice(0, lineStart) + s.slice(Math.min(s.length, lineEnd + 1));
    return s.slice(0, start) + s.slice(end);
  }
  function dropTitleBlock(pre) {
    for (const name of TITLE_BLOCK) {
      const found = commands(mask(pre), name).filter((c) => c.arg !== null && !defining(mask(pre), c.start));
      for (const c of found.reverse()) pre = cut(pre, c.start, c.end);
    }
    return pre;
  }
  // the venue package loaded with the options for this version
  function setReview(pre, tpl, anonymous) {
    const r = tpl.review;
    if (!r) return pre;
    if (r.via === 'command') {
      const cmd = r.named.replace(/^\\/, '');
      for (const c of commands(mask(pre), cmd).reverse()) if (!defining(mask(pre), c.start)) pre = cut(pre, c.start, c.start + cmd.length + 1);
      return anonymous ? pre : pre.replace(/\s*$/, '') + `\n${r.named} % the named version\n`;
    }
    const l = loads(mask(pre)).find((x) => x.names.includes(tpl.pkg));
    if (!l) return pre;
    const want = anonymous ? r.anonymous : r.named;
    const opts = [...list(l.opt).filter((o) => !REVIEW_WORDS.has(o)), ...(want ? [want] : [])];
    const cmd = /^\\RequirePackage/.test(pre.slice(l.start)) ? 'RequirePackage' : 'usepackage';
    const others = l.names.filter((n) => n !== tpl.pkg);
    const line = `\\${cmd}${opts.length ? `[${opts.join(',')}]` : ''}{${tpl.pkg}}` + (others.length ? `\n\\${cmd}${l.opt ? `[${l.opt}]` : ''}{${others.join(',')}}` : '');
    return pre.slice(0, l.start) + line + pre.slice(l.end);
  }
  // the template's subfigure (or subfig) is for its example text, and
  // clashes with subcaption, which the paper's panels need
  function dropClashes(pre, needs) {
    if (!needs || !needs.subcaption) return pre;
    for (const l of loads(mask(pre)).reverse()) {
      const keep = l.names.filter((n) => n !== 'subfigure' && n !== 'subfig');
      if (keep.length === l.names.length) continue;
      const left = `% ${pre.slice(l.start, l.end)} (left out by NEO: the paper's panels use subcaption)`;
      pre = pre.slice(0, l.start) + (keep.length ? pre.slice(l.start, l.end).replace(/\{[^{}]*\}$/, `{${keep.join(',')}}`) + '\n' : '') + left + pre.slice(l.end);
    }
    return pre;
  }
  // Each guarded, so it can never clash with what the template loads.
  // Alternatives that would clash count as loaded (newtxmath brings its own
  // symbols, so amssymb would redefine them).
  const GUARDS = [
    { pkg: 'amsmath' },
    { pkg: 'amssymb', also: ['newtxmath', 'newpxmath', 'stix2', 'unicode-math'] },
    { pkg: 'graphicx', need: 'graphicx' },
    { pkg: 'booktabs', need: 'booktabs' },
    { pkg: 'subcaption', need: 'subcaption' },
    { pkg: 'float', need: 'float' },
    { pkg: 'wrapfig', need: 'wrapfig' },
    { pkg: 'tabularx', need: 'tabularx' }
  ];
  const guard = (names, line) => names.reduceRight((inner, n) => `\\@ifpackageloaded{${n}}{}{${inner}}`, line);
  // a .bst that sets natbib's author–year citations (\bibitem[Name(Year)]{key})
  function authorYearBst(bst, files) {
    if (!bst) return true;
    const text = textNamed(files, bst + '.bst');
    if (text) return /\\bibitem\[/.test(text);
    return /nat|^apa|apalike|chicago|agsm|dcu|kluwer|named/i.test(bst);
  }
  const anonymousAuthor = 'Anonymous Author(s)';
  function fill(tpl, files, parts, { anonymous = false } = {}) {
    parts = parts || {};
    const text = textOf(files, tpl.main);
    const at = docStart(mask(text));
    let pre = at < 0 ? text : text.slice(0, at);
    pre = dropTitleBlock(pre);
    pre = setReview(pre, tpl, anonymous);
    pre = dropClashes(pre, parts.needs);
    const body = at < 0 ? '' : mask(text.slice(at));
    const venue = mask([tpl.pkg ? textNamed(files, tpl.pkg + '.sty') : '', textNamed(files, tpl.cls + '.cls')].join('\n'));
    const needs = parts.needs || {};
    const lines = [`% Filled by NEO from ${tpl.name || 'a venue'}'s template: its preamble kept, its example text left out.`, pre.replace(/\s*$/, ''), ''];
    // what the paper needs that the template doesn't load
    const guards = GUARDS.filter((g) => !g.need || needs[g.need]).map((g) => guard([g.pkg, ...(g.also || [])], `\\usepackage{${g.pkg}}`));
    // natbib's \citep and \citet: the template's natbib as it is; else
    // NEO's, in numbers unless the .bst sets author and year
    const numbers = parts.numeric || !authorYearBst(tpl.bst, files);
    guards.push(guard(['natbib'], numbers ? '\\usepackage[numbers,square,sort&compress]{natbib}' : '\\usepackage[round]{natbib}'));
    lines.push('% What the paper needs that the template doesn\'t load', '\\makeatletter', ...guards, '\\makeatother');
    if (parts.preamble && parts.preamble.length) lines.push('', '% The paper\'s symbols', ...parts.preamble);
    lines.push('');
    const title = (parts.title || '') + (parts.subtitle ? ': ' + parts.subtitle : '');
    const affs = parts.affiliations || [];
    const authors = anonymous ? [{ name: anonymousAuthor, affiliations: [] }] : (parts.authors || []);
    if (tpl.kind === 'icml') {
      lines.push('\\begin{document}', '', '\\twocolumn[', `\\icmltitle{${title}}`, '');
      // the template's own symbols for its authors (equal contribution) stay
      const symbols = commands(body, 'icmlsetsymbol', 2).map((c) => text.slice(at + c.start, at + c.end));
      if (symbols.length) lines.push(...symbols, '');
      // an author with no affiliation still takes one: ICML numbers each
      const label = (n) => 'aff' + (n + 1);
      const listed = anonymous ? [{ name: anonymousAuthor, labels: ['anon'] }] : authors.map((a) => ({ ...a, labels: (a.affiliations || []).length ? a.affiliations.map(label) : ['none'] }));
      lines.push('\\begin{icmlauthorlist}', ...listed.map((a) => `\\icmlauthor{${a.name}}{${a.labels.join(',')}}`), '\\end{icmlauthorlist}', '');
      if (anonymous) lines.push('\\icmlaffiliation{anon}{Anonymous Institution}');
      else {
        affs.forEach((f, i) => { if (listed.some((a) => a.labels.includes(label(i)))) lines.push(`\\icmlaffiliation{${label(i)}}{${f}}`); });
        if (listed.some((a) => a.labels.includes('none'))) lines.push('\\icmlaffiliation{none}{}');
      }
      const corr = anonymous ? [] : authors.filter((a) => a.corresponding && a.email);
      const writeTo = corr.length ? corr : authors.filter((a) => a.email).slice(0, 1);
      if (writeTo.length) lines.push('', ...writeTo.map((a) => `\\icmlcorrespondingauthor{${a.name}}{${a.email}}`));
      if (parts.keywords && parts.keywords.length) lines.push('', `\\icmlkeywords{${parts.keywords.join(', ')}}`);
      const skip = /\\vskip\s*([\d.]+\s*(?:in|pt|cm|mm|em))\s*\]/.exec(body);
      lines.push('', `\\vskip ${skip ? skip[1].replace(/\s+/g, '') : '0.3in'}`, ']', '', '\\printAffiliationsAndNotice{}', '');
    } else {
      // NeurIPS, ICLR and ACL set authors side by side with \And; LaTeX's own \and elsewhere
      const and = tpl.kind === 'generic' ? '\\and' : '\\And';
      const who = authors.map((a) => [a.name, ...(a.affiliations || []).map((n) => affs[n]).filter(Boolean), ...(a.email ? [`\\texttt{${a.email}}`] : [])].join(' \\\\\n  '));
      lines.push(`\\title{${title}}`, '', `\\author{${who.length ? '%\n  ' + who.join(`\n  ${and}\n  `) + '\n' : ''}}`);
      if (tpl.kind === 'generic') lines.push('\\date{}');
      lines.push('', '\\begin{document}', '', '\\maketitle', '');
    }
    if (parts.abstract) lines.push('\\begin{abstract}', parts.abstract, '\\end{abstract}', '');
    if (parts.body) lines.push(String(parts.body).replace(/\s*$/, ''), '');
    // the template's .bst; none when its preamble or style already sets one
    const bstSet = commands(mask(pre), 'bibliographystyle').length || commands(venue, 'bibliographystyle').length;
    if (!bstSet) lines.push(`\\bibliographystyle{${tpl.bst || (numbers ? 'unsrtnat' : 'plainnat')}}`);
    lines.push('\\bibliography{references}', '', '\\end{document}', '');
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------
  // layout: the template's files beside its main .tex
  // ---------------------------------------------------------------------
  // Paths are taken from the main .tex's folder (a zip often holds one
  // folder, "ICLR 2025 Template/"); what's outside it, or could write
  // outside it, is left out, and the Mac's zip litter with it.
  function layout(tpl, files) {
    const root = dir(tpl.main || '');
    const rel = (p) => (root ? (p.startsWith(root + '/') ? p.slice(root.length + 1) : null) : p);
    const out = [];
    for (const f of files || []) {
      const p = norm(f && f.path);
      if (!p || junk(p) || unsafe(p) || p === tpl.main) continue;
      const r = rel(p);
      if (!r || unsafe(r)) continue;
      if (typeof f.text === 'string') out.push({ path: r, text: f.text });
      else if (f.base64) out.push({ path: r, base64: f.base64 });
    }
    return { main: rel(norm(tpl.main)) || base(tpl.main), files: out };
  }

  return { KINDS, NO_FILES, NO_MAIN, ERRORS, read, fill, layout, stripComments, pageLimit, venueName };
});
