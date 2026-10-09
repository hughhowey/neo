// NEO — a paper's symbols
//
// Two things a scientist types all day. In prose, \mu and a space becomes μ
// (TEX_CHARS, autocorrect), and the LaTeX export turns μ back into \mu so
// pdflatex can set it (texText). And a paper's own notation: \Vm for
// V_\mathrm{m}, with its meaning, its unit, a value and where the value
// came from, kept in symbols.json beside the chapters and listed, sorted
// the way nomenclature lists run, in a table of symbols.
//
// A symbol: { id, tex, meaning, unit, table, kind, value, cite }
//   id       its macro name (Vm for \Vm): letters only
//   tex      its TeX (V_\mathrm{m})
//   meaning, unit, value   plain text
//   table    listed in the table of symbols
//   kind     'parameter', 'variable' or '' (neither)
//   cite     the references it comes from: [{ id, locator, label, prefix, suffix }]
//
// Plain string work only: it runs in the window, in Pocket and under
// node's tests alike (window.NeoSymbols).

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports && !root.document) module.exports = api;
  else root.NeoSymbols = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------
  // \name → the character. Every name is a LaTeX command: the kernel's,
  // or amssymb's (varkappa nexists varnothing therefore because checkmark
  // square lesssim gtrsim leqslant geqslant), gensymb's (degree), or the
  // permil package's (permil). The export writes each back as the command
  // pdflatex already has (TEXT below, else \ensuremath{\name}).
  // ---------------------------------------------------------------------
  const TEX_CHARS = Object.freeze({
    // Greek, lowercase (\epsilon is the lunate ϵ, \varepsilon the ε a Greek keyboard types)
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
    theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', varkappa: 'ϰ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
    pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ',
    phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    // Greek, uppercase: only those that aren't Latin letters
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
    Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    // operators and relations
    pm: '±', mp: '∓', times: '×', div: '÷', cdot: '⋅', ast: '∗', star: '⋆', circ: '∘', bullet: '∙',
    otimes: '⊗', oplus: '⊕', odot: '⊙', setminus: '∖',
    leq: '≤', le: '≤', geq: '≥', ge: '≥', leqslant: '⩽', geqslant: '⩾', neq: '≠', ne: '≠',
    approx: '≈', simeq: '≃', cong: '≅', equiv: '≡', sim: '∼', propto: '∝', ll: '≪', gg: '≫',
    lesssim: '≲', gtrsim: '≳', prec: '≺', succ: '≻', mid: '∣', perp: '⊥', parallel: '∥',
    // calculus and the like
    infty: '∞', partial: '∂', nabla: '∇', sum: '∑', prod: '∏', int: '∫', oint: '∮', sqrt: '√',
    degree: '°', prime: '′', ell: 'ℓ', hbar: 'ℏ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', wp: '℘',
    // sets and logic
    emptyset: '∅', varnothing: '∅', in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃',
    subseteq: '⊆', supseteq: '⊇', cup: '∪', cap: '∩', wedge: '∧', vee: '∨', neg: '¬',
    forall: '∀', exists: '∃', nexists: '∄', therefore: '∴', because: '∵', vdash: '⊢', models: '⊨',
    // arrows
    to: '→', rightarrow: '→', gets: '←', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒',
    Leftarrow: '⇐', Leftrightarrow: '⇔', implies: '⟹', iff: '⟺', mapsto: '↦', uparrow: '↑',
    downarrow: '↓', updownarrow: '↕', longrightarrow: '⟶', longleftarrow: '⟵', rightleftharpoons: '⇌',
    // geometry, brackets, dots
    angle: '∠', triangle: '△', square: '□', langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋',
    lceil: '⌈', rceil: '⌉', ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱',
    // in the text
    dagger: '†', ddagger: '‡', AA: 'Å', permil: '‰', checkmark: '✓'
  });

  // the characters the export writes in text mode, and those that need
  // another command than the name that types them
  const TEXT = { '°': '\\textdegree{}', '‰': '\\textperthousand{}', 'Å': '\\AA{}', '†': '\\dag{}', '‡': '\\ddag{}', '…': '\\ldots{}' };
  const MATH = { '√': '\\surd', '′': '{}^{\\prime}', '✓': '\\checkmark' };
  // characters no name types that pdflatex can't set either
  const EXTRA = {
    '\u00b5': '\\mu', '\u2126': '\\Omega', '\u2212': '-', '\u03bf': 'o',
    ...Object.fromEntries([...'ΑΒΕΖΗΙΚΜΝΟΡΤΧ'].map((c, i) => [c, `\\mathrm{${'ABEZHIKMNOPTX'[i]}}`]))
  };
  // the ångström sign, and thin spaces (−65\u2009mV)
  const TEXT_EXTRA = { '\u212b': '\\AA{}', '\u2009': '\\,', '\u202f': '\\,' };

  // each character's command: the first name to type it
  const COMMAND = {};
  for (const [name, c] of Object.entries(TEX_CHARS)) {
    if (COMMAND[c]) continue;
    COMMAND[c] = TEXT[c] || `\\ensuremath{${MATH[c] || '\\' + name}}`;
  }
  for (const [c, cmd] of Object.entries(EXTRA)) COMMAND[c] = `\\ensuremath{${cmd}}`;
  Object.assign(COMMAND, TEXT_EXTRA);
  const COMMAND_RE = new RegExp('[' + Object.keys(COMMAND).join('').replace(/[\]\\^-]/g, '\\$&') + ']', 'g');

  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const charFor = (name) => (own(TEX_CHARS, name) ? TEX_CHARS[name] : null);

  // The text before the caret ends in \name, the backslash starting a word
  // (at the start, or after a space or an opening bracket or quote, and not
  // \\): { name, from } where from is the backslash. Known or not: the
  // caller decides (a paper's own symbol, or TEX_CHARS).
  function autocorrect(before) {
    const m = /(^|[\s([{"'“‘«])\\([A-Za-z]+)$/.exec(String(before || ''));
    return m ? { name: m[2], from: m.index + m[1].length } : null;
  }

  // Text for pdflatex (inputenc utf8 sets no Greek and few symbols): each
  // character above as its command. The caller has already escaped the rest.
  const texText = (s) => String(s).replace(COMMAND_RE, (c) => COMMAND[c]);

  // ---------------------------------------------------------------------
  // A paper's own symbols
  // ---------------------------------------------------------------------
  const KINDS = ['parameter', 'variable'];
  // why a name won't do, in English (the window translates them)
  const LETTERS_ONLY = 'letters only';
  const TAKEN = 'already a symbol';
  const LATEX_COMMAND = 'a LaTeX command';
  // names a paper can't redefine without breaking the document: TeX's
  // primitives, LaTeX's and amsmath's commands and environments, what the
  // export and the journal classes use, MathJax's extensions, and the
  // letters LaTeX sets accents and special characters with
  const RESERVED = new Set(`
    begin end section subsection subsubsection paragraph subparagraph chapter part appendix
    label ref eqref pageref autoref nameref cref Cref cite citep citet citealp citealt citeauthor citeyear nocite
    bibliography bibliographystyle bibitem bibinfo natexlab url urlprefix doi eprint href hyperref hypersetup texorpdfstring phantomsection
    item itemize enumerate description caption subcaption captionsetup
    text textbf textit textrm textsf texttt textsc textup textsl textnormal textsuperscript textsubscript
    textbackslash textasciitilde textasciicircum textdegree textperthousand textmu textbullet textendash textemdash
    emph underline normalfont bfseries itshape rmfamily sffamily ttfamily bf it rm sf tt sc sl em up md
    tiny scriptsize footnotesize small normalsize large Large LARGE huge Huge
    mathrm mathbf mathit mathsf mathtt mathcal mathbb mathfrak mathscr mathnormal boldsymbol bm pmb operatorname
    frac dfrac tfrac cfrac genfrac binom dbinom tbinom sqrt left right middle big Big bigg Bigg bigl bigr Bigl Bigr biggl biggr
    hat widehat bar overline vec dot ddot dddot tilde widetilde check breve acute grave mathring
    overrightarrow overleftarrow underbrace overbrace overset underset stackrel xrightarrow xleftarrow substack sideset
    bigcup bigcap bigoplus bigotimes bigodot bigvee bigwedge biguplus bigsqcup coprod iint iiint
    sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh coth exp log ln lg lim liminf limsup
    max min sup inf det dim ker hom arg deg gcd Pr bmod pmod mod
    lbrace rbrace lvert rvert lVert rVert vert Vert backslash colon not
    displaystyle textstyle scriptstyle scriptscriptstyle limits nolimits mathop mathrel mathbin mathord mathopen mathclose mathpunct mathinner
    phantom hphantom vphantom smash strut mathstrut quad qquad enspace thinspace negthinspace
    tag nonumber notag intertext
    par newline linebreak pagebreak nopagebreak newpage clearpage cleardoublepage
    smallskip medskip bigskip hspace vspace hfill vfill hfil vfil hss vss
    linewidth textwidth columnwidth textheight paperwidth paperheight baselineskip parindent parskip fill
    centering raggedright raggedleft noindent indent
    includegraphics graphicspath hline cline toprule midrule bottomrule cmidrule addlinespace multicolumn multirow tabularnewline arraybackslash
    title author date maketitle thanks and affil affiliation institution institute inst country email ead orcid orcidID
    abstract keywords keyword sep authorrunning titlerunning settopmatter setcopyright today
    footnote footnotemark footnotetext marginpar
    figurename tablename refname abstractname contentsname thepage thefigure thetable theequation thesection
    tableofcontents listoffigures listoftables
    document figure table tabular tabularx array equation align gather multline split flalign alignat
    center flushleft flushright quote quotation verse minipage cases matrix pmatrix bmatrix vmatrix Vmatrix
    wrapfigure subfigure frontmatter thebibliography proof theorem lemma
    usepackage documentclass RequirePackage input include newcommand renewcommand providecommand
    newenvironment renewenvironment DeclareRobustCommand DeclareMathOperator ensuremath protect makeatletter makeatother
    doublespacing singlespacing onehalfspacing
    def gdef edef xdef let futurelet global long outer relax if fi else or ifx ifnum ifdim ifcase ifodd unless
    expandafter noexpand csname endcsname the number romannumeral string meaning uppercase lowercase
    begingroup endgroup bgroup egroup afterassignment aftergroup ignorespaces unskip unkern unpenalty
    box copy setbox hbox vbox vtop vcenter unhbox unvbox mbox makebox fbox framebox raisebox parbox rule
    lower raise moveleft moveright kern hskip vskip mkern mskip penalty nobreak allowbreak space
    hrule vrule halign valign noalign omit span cr crcr over above atop choose eqno leqno
    count dimen skip toks advance multiply divide catcode char chardef mathchar mathchardef accent mathaccent
    delimiter radical fam font fontname mark insert vadjust special write read message immediate openin openout
    closein closeout endinput jobname show showthe day month year time mag dp ht wd
    color textcolor colorbox require unicode class cssId style
    S P L O H c d b u v t i j o l r k a aa ae AE oe OE ss SS dh DH th TH ng NG dj DJ
  `.trim().split(/\s+/));

  const idOf = (s) => (s && typeof s === 'object' ? s.id : s);
  // '' when id will do as the macro name of a new symbol, else the reason.
  // existing: the paper's other symbols (or their ids)
  function validKey(id, existing) {
    id = String(id == null ? '' : id);
    if (!/^[A-Za-z]{1,30}$/.test(id)) return LETTERS_ONLY;
    if ((existing || []).some((s) => idOf(s) === id)) return TAKEN;
    if (own(TEX_CHARS, id) || RESERVED.has(id)) return LATEX_COMMAND;
    return '';
  }

  // The order a nomenclature runs in: Latin letters, then Greek in its own
  // order, then anything else; each letter lowercase before uppercase; by
  // the first glyph the TeX sets (V_\mathrm{m} → V, \tau_m → τ, \hat{\theta}
  // → θ), then by the rest of the TeX.
  const GREEK = 'αβγδεζηθικλμνξοπρστυφχψω';
  const GREEK_VARIANT = { 'ϵ': 'ε', 'ϑ': 'θ', 'ϰ': 'κ', 'ϖ': 'π', 'ϱ': 'ρ', 'ς': 'σ', 'ϕ': 'φ', 'µ': 'μ' };
  function firstGlyph(tex) {
    let s = String(tex || '');
    for (;;) {
      s = s.replace(/^[\s{]+/, '');
      const cmd = /^\\([A-Za-z]+)\s*/.exec(s);
      if (!cmd) break;
      // \mathrm{, \hat{ and their kind set what follows
      if (charFor(cmd[1]) === null) { s = s.slice(cmd[0].length); continue; }
      return { glyph: charFor(cmd[1]), rest: s.slice(cmd[0].length) };
    }
    const c = [...s][0] || '';
    return { glyph: c, rest: s.slice(c.length) };
  }
  function sortKey(sym) {
    const { glyph, rest } = firstGlyph(sym && sym.tex);
    const lower = glyph.toLowerCase();
    const upper = glyph !== lower ? 1 : 0;
    if (/^[a-z]$/.test(lower)) return [0, lower.charCodeAt(0) - 97, upper, rest];
    const g = GREEK.indexOf(GREEK_VARIANT[lower] || lower);
    if (g >= 0) return [1, g, upper, rest];
    return [2, glyph.codePointAt(0) || 0, upper, rest];
  }
  function sortSymbols(list) {
    const keyed = (list || []).map((s, i) => ({ s, i, k: sortKey(s) }));
    keyed.sort((a, b) => {
      for (let n = 0; n < 4; n++) if (a.k[n] !== b.k[n]) return a.k[n] < b.k[n] ? -1 : 1;
      return a.i - b.i;
    });
    return keyed.map((x) => x.s);
  }

  // symbols.json as this window last read or wrote it (saved), as it is
  // here (mine), and as it is on disk now: mine, plus every symbol another
  // device has added since. One deleted here stays deleted.
  function keepTheirs(saved, mine, disk) {
    if (!Array.isArray(disk)) return mine;
    const known = new Set([...(saved || []), ...mine].filter(Boolean).map((s) => String(s.id)));
    const theirs = disk.filter((s) => s && s.id && !known.has(String(s.id)));
    return theirs.length ? [...mine, ...theirs] : mine;
  }

  return {
    TEX_CHARS, KINDS, LETTERS_ONLY, TAKEN, LATEX_COMMAND, RESERVED,
    autocorrect, charFor, texText, validKey, sortSymbols, keepTheirs
  };
});
