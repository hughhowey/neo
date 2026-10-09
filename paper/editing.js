// NEO — a paper's editing pass
//
// The language rules of docs/writing-principles.md (section 6), and the
// small things a copy editor marks: filler, passive constructions,
// comparisons with no stated basis, long sentences, a repeated word, a
// number touching its unit, a range with a hyphen, an acronym used before
// it's defined, two forms of one word, a sentence that opens with a numeral.
// The window runs the pass only when the writer asks for it (like the
// spellcheck pass), marks what comes back with the CSS Highlight API and
// offers the note and the fix on a right-click. Nothing here runs while the
// writer types.
//
// check(paras, { lang }) → [{ p, start, end, rule, key, vars, note, fix }]
//   paras   the body's paragraphs and list items, in order, headings left
//           out; inline maths, citations and symbols are one U+FFFC each,
//           and no rule matches inside or across one
//   p       the paragraph; start, end the offsets in its string
//   rule    an id in RULES
//   key     the note's English template (TEMPLATES), vars its blanks, and
//           note the two filled in. The window translates key with t(vars).
//   fix     the text for [start, end), or null when only the writer can fix it
// Sorted by paragraph, then offset, and never overlapping. In another
// language than English only the rules that don't read the words run.
//
// sentences(text) → [{ start, end }]: the sentences of one paragraph, in
// order, trailing spaces left out.
//
// Plain string work only: it runs in the window, in Pocket and under
// node's tests alike (window.NeoEditing).

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports && !root.document) module.exports = api;
  else root.NeoEditing = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // tk marks the English the window translates: scripts/i18n.js reads it here
  const tk = (s) => s;
  // each rule's name, in English (the window translates them); the order
  // is the order a flag wins an overlap in, after those with a fix
  const RULES = Object.freeze({
    filler: tk('Filler'),
    passive: tk('Passive voice'),
    compare: tk('Comparison'),
    long: tk('Long sentence'),
    repeat: tk('Repeated word'),
    units: tk('Units'),
    range: tk('Range'),
    acronym: tk('Acronym'),
    variant: tk('One form throughout'),
    numbers: tk('Numerals')
  });
  const ORDER = Object.keys(RULES);
  // the rules that don't read English words
  const NEUTRAL = new Set(['repeat', 'units', 'range', 'acronym', 'numbers']);

  // every note, as the template the window translates
  const NOTE = {
    filler: tk('Filler: “{phrase}” says what “{short}” says.'),
    fillerCut: tk('Filler: “{phrase}” adds nothing the sentence needs.'),
    passive: tk('Passive: who did it? “We …” is usually clearer.'),
    passiveIt: tk('Passive: “{phrase}” hides whose claim it is. Say who: “We show …”, or cite them.'),
    compare: tk('Comparison: compared with what? Say the basis early in the sentence.'),
    long: tk('Long sentence ({n} words): commas first, then see whether two sentences are clearer.'),
    repeat: tk('Repeated word: “{word}” twice.'),
    units: tk('Units: a space between a number and its unit ({fixed}).'),
    range: tk('Ranges take an en dash: {fixed}.'),
    acronymEarly: tk('“{acronym}” is used here before it’s defined (in paragraph {n}).'),
    acronymTwice: tk('“{acronym}” is defined already, in paragraph {n}: the short form will do here.'),
    acronymUnused: tk('“{acronym}” is defined but never used again: the long form alone may read better.'),
    acronymUndefined: tk('“{acronym}” is never defined: spell it out the first time.'),
    // {n} is the count the plural follows
    variant: tk('One form throughout: “{major}” appears {n} times, “{minor}” {m}.'),
    numbers: tk('Sentences don’t start with a numeral: write it out, or turn the sentence.')
  };
  const TEMPLATES = Object.freeze(Object.values(NOTE));

  const fill = (key, vars) => key.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  const flag = (p, start, end, rule, key, vars, fix) =>
    ({ p, start, end, rule, key, vars, note: fill(key, vars), fix: fix == null ? null : fix });

  const B0 = '(?<![\\p{L}\\p{N}])';
  const B1 = '(?![\\p{L}\\p{N}])';
  const lc = (s) => s.toLowerCase();
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const upper = (c) => !!c && c !== c.toLowerCase();
  const asCase = (like, s) => (upper(like.charAt(0)) ? cap(s) : s);
  const set = (s) => new Set(s.trim().split(/\s+/));

  // ---------------------------------------------------------------------
  // Sentences: a stop, then a space and a capital, a digit or an object.
  // Not after an abbreviation a paper writes mid-sentence; No., p. and the
  // like only before a number.
  // ---------------------------------------------------------------------
  const END = /[.!?]+["'”’)\]]*(?=\s+["'“‘([]*([\p{Lu}\p{N}\uFFFC]))/gu;
  const ABBR = /(?:^|[^\p{L}\p{N}.])(?:e\.g|i\.e|et al|cf|vs|approx|ca|[Ff]igs?|[Ee]qs?|[Rr]efs?|[Ss]ecs?|[Tt]abs?|[Ss]uppl|resp|Dr|Prof|Mr|Mrs|Ms|St)\.$/u;
  const ABBR_NUM = /(?:^|[^\p{L}\p{N}.])(?:[Nn]os?|[Vv]ol|pp?|[Cc]h|[Cc]hap)\.$/u;
  const SPACE = /\s/;

  function sentences(text) {
    const s = String(text == null ? '' : text);
    const out = [];
    const push = (a, b) => {
      while (a < b && SPACE.test(s[a])) a++;
      while (b > a && SPACE.test(s[b - 1])) b--;
      if (b > a) out.push({ start: a, end: b });
    };
    let from = 0;
    END.lastIndex = 0;
    let m;
    while ((m = END.exec(s))) {
      const stop = m.index + m[0].length;
      if (m[0][0] === '.' && m[0][1] !== '.') {
        const before = s.slice(Math.max(0, m.index - 8), m.index + 1);
        if (ABBR.test(before) || (/\p{N}/u.test(m[1]) && ABBR_NUM.test(before))) continue;
      }
      push(from, stop);
      from = stop;
    }
    push(from, s.length);
    return out;
  }

  // a word, a number or an object (as non-linear, 5–10, (see, U+FFFC)
  const WORD = /\uFFFC|[\p{L}\p{N}](?:[^\s\uFFFC]*[\p{L}\p{N}])?/gu;
  const countWords = (s) => (s.match(WORD) || []).length;

  // ---------------------------------------------------------------------
  // 1. Filler: [phrase, short form, takes "of" before the, these, our …]
  // ---------------------------------------------------------------------
  const FILLER = [
    ['in order to', 'to'], ['due to the fact that', 'because'], ['owing to the fact that', 'because'],
    ['in spite of the fact that', 'although'], ['despite the fact that', 'although'],
    ['at this point in time', 'now'], ['at the present time', 'now'], ['in the event that', 'if'],
    ['for the purpose of', 'for'], ['with regard to', 'about'], ['with respect to', 'about'],
    ['prior to', 'before'], ['subsequent to', 'after'],
    ['a large number of', 'many', true], ['the vast majority of', 'most', true],
    ['a majority of', 'most', true], ['a small number of', 'a few', true],
    ['is able to', 'can'], ['are able to', 'can'], ['has the ability to', 'can'], ['have the ability to', 'can'],
    ['it is important to note that', ''], ['it should be noted that', ''], ['it is worth noting that', ''],
    ['utilize', 'use'], ['utilizes', 'uses'], ['utilized', 'used'], ['utilizing', 'using'],
    ['utilise', 'use'], ['utilises', 'uses'], ['utilised', 'used'], ['utilising', 'using'],
    ['utilization', 'use'], ['utilisation', 'use'],
    ['in close proximity to', 'near'], ['on a daily basis', 'daily'], ['whether or not', 'whether']
  ];
  const FILLER_BY = new Map(FILLER.map((f) => [f[0], f]));
  const FILLER_RE = new RegExp(B0 + '(?:' + FILLER.map((f) => f[0]).sort((a, b) => b.length - a.length)
    .map((f) => f.replace(/ /g, '\\s+')).join('|') + ')' + B1, 'giu');
  const DETERMINER = /^\s+(?:the|these|those|this|that|our|their|its|his|her|them|us|which|whom|whose|all|both|each)(?![\p{L}\p{N}])/iu;
  // "the derivative with respect to x" is maths, not filler
  const WRT_NEXT = /^\s+(?:(?![aAI](?![\p{L}\p{N}]))\p{L}(?![\p{L}\p{N}])|\uFFFC|\p{Script=Greek}|time(?!\p{L}))/u;
  const WRT_BEFORE = /deriv|differenti|integra|gradient|partial|invarian|symmetr|orthogon|convex|monoton|continuous/i;
  const AFTER_CUT = /^,?\s+/;
  const NEXT_WORD = /^\p{Ll}[\p{L}'’-]*/u;

  function fillers(s, p, out) {
    const found = [];
    FILLER_RE.lastIndex = 0;
    let m;
    while ((m = FILLER_RE.exec(s))) {
      const phrase = lc(m[0]).replace(/\s+/g, ' ');
      const [, short, of] = FILLER_BY.get(phrase);
      const start = m.index;
      let end = start + m[0].length;
      const after = s.slice(end, end + 60);
      if (phrase === 'with respect to' && (WRT_NEXT.test(after) || WRT_BEFORE.test(s.slice(Math.max(0, start - 60), start).split(/[.!?]\s/).pop()))) continue;
      let f;
      if (short === '') {
        // cut it, its comma and the space after; capitalise what now starts the sentence
        const gap = AFTER_CUT.exec(after);
        let fix = '';
        if (gap) {
          end += gap[0].length;
          const next = upper(m[0][0]) && NEXT_WORD.exec(s.slice(end, end + 60));
          if (next) { fix = cap(next[0]); end += next[0].length; }
        }
        f = flag(p, start, end, 'filler', NOTE.fillerCut, { phrase }, fix);
      } else {
        const to = of && DETERMINER.test(after) ? short + ' of' : short;
        f = flag(p, start, end, 'filler', NOTE.filler, { phrase, short: to }, asCase(m[0], to));
      }
      out.push(f);
      found.push(f);
    }
    return found;
  }

  // ---------------------------------------------------------------------
  // 2. Passive: a form of be, perhaps an adverb, then a past participle.
  // One a sentence: the first.
  // ---------------------------------------------------------------------
  const IRREGULAR = set(`
    shown given known seen done made taken found chosen written drawn held kept set put run built sent spent
    brought thought told left lost paid read led met understood begun broken bought caught cut dealt driven
    eaten fallen felt fought forgotten forgiven frozen grown hidden hung heard laid lent meant mistaken
    overcome overtaken overseen overrun undertaken undergone upheld withdrawn proven ridden risen said sought
    sold shaken shut spoken spun split spread stolen stuck struck sworn swept taught torn thrown worn won
    bred fed beaten bent bitten blown flown forbidden foreseen rewritten rebuilt redone retaken shrunk slain
    sung sunk stung sewn sown burnt learnt spelt spilt dreamt leapt dwelt
  `);
  // -ed words that aren't participles after be, or that are only adjectives there
  const NOT_PARTICIPLE = set(`
    indeed need seed speed feed bleed breed creed greed weed steed shed hundred kindred sacred naked wicked
    rugged ragged jagged crooked wretched beloved aged supposed complicated sophisticated detailed advanced
    experienced skilled crowded excited interested tired bored worried pleased delighted devoted dedicated
    distributed balanced biased mixed varied skewed pronounced concerned warranted inclined accustomed
    talented gifted renowned ashamed
  `);
  // un- verbs (the rest of un-…ed is an adjective: unchanged, unbiased)
  const UN_VERBS = set('uncovered unveiled unlocked unpacked unravelled unraveled unloaded unfolded unrolled unwrapped unmasked unified united unionized uninstalled');
  function participle(w) {
    w = lc(w);
    if (IRREGULAR.has(w)) return true;
    if (w.length < 4 || !w.endsWith('ed') || NOT_PARTICIPLE.has(w)) return false;
    return !(w.startsWith('un') && !w.startsWith('under') && !UN_VERBS.has(w));
  }
  const PASSIVE_RE = new RegExp(B0 + '(?:am|is|are|was|were|be|been|being)\\s+(?:(?:not|also|\\p{L}+ly)\\s+)?(\\p{L}+)' + B1, 'giu');
  const PASSIVE_IT = new RegExp(B0 + 'it\\s+(?:is|was|has\\s+been|had\\s+been|(?:can|could|may|might|must|should|will|would)\\s+be)\\s+' +
    '(?:(?:\\p{L}+ly|also|now|often|well)\\s+)?(?:shown|known|believed|thought|suggested|assumed|argued|expected|hypothesi[sz]ed|' +
    'proposed|reported|accepted|established|recogni[sz]ed|understood|agreed|claimed|estimated|predicted|said|felt|noted|observed|' +
    'found|demonstrated|considered|postulated|speculated|conjectured)\\s+that' + B1, 'giu');

  const overlaps = (a, b) => a.start < b.end && b.start < a.end;
  // the sentence an offset falls in
  function sentenceOf(sents, i) {
    let lo = 0, hi = sents.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (i < sents[mid].start) hi = mid - 1;
      else if (i >= sents[mid].end) lo = mid + 1;
      else return mid;
    }
    return -1;
  }

  function passives(s, p, sents, fillersHere, out) {
    const first = new Map();
    const take = (c) => {
      const k = sentenceOf(sents, c.start);
      if (k < 0 || fillersHere.some((f) => overlaps(f, c))) return;
      const was = first.get(k);
      if (!was || c.start < was.start) first.set(k, c);
    };
    let m;
    PASSIVE_IT.lastIndex = 0;
    while ((m = PASSIVE_IT.exec(s))) {
      take({ start: m.index, end: m.index + m[0].length, key: NOTE.passiveIt, vars: { phrase: m[0].replace(/\s+/g, ' ') } });
    }
    PASSIVE_RE.lastIndex = 0;
    while ((m = PASSIVE_RE.exec(s))) {
      if (!participle(m[1])) { PASSIVE_RE.lastIndex = m.index + 2; continue; }
      const c = { start: m.index, end: m.index + m[0].length, key: NOTE.passive, vars: {} };
      // "It is shown that" says more than "is shown"
      if (![...first.values()].some((f) => f.key === NOTE.passiveIt && overlaps(f, c))) take(c);
    }
    for (const c of first.values()) out.push(flag(p, c.start, c.end, 'passive', c.key, c.vars, null));
  }

  // ---------------------------------------------------------------------
  // 3. A comparison with no basis in its sentence. One a sentence.
  // ---------------------------------------------------------------------
  const COMPARE_RE = new RegExp(B0 + '(?:(better|worse|higher|lower|faster|slower|larger|smaller|greater|fewer|improved|' +
    'outperform(?:s|ed|ing)?|superior|inferior)|(more|less)\\s+(\\p{L}+))' + B1, 'giu');
  const BASIS = new RegExp(B0 + '(?:than|compar\\p{L}*|relative(?:ly)?\\s+to|versus|vs|over|against|baselines?|previous(?:ly)?|' +
    'prior|earlier|existing|competing|conventional|traditional|state[\\s-]of[\\s-]the[\\s-]art|the\\s+rest|the\\s+others?|others|' +
    'both|either|unlike|whereas|while|between|among|respectively|controls?|chance|before|after|contrast|instead|rather|' +
    '(?:at|with|for)\\s+(?:higher|lower|larger|smaller|greater|more|less|increasing|decreasing)|increasing|decreasing)' + B1, 'iu');
  const FROM_TO = /(?<!\p{L})from(?!\p{L})[\s\S]*(?<!\p{L})to(?!\p{L})/iu;
  const THE_MORE = /(?<!\p{L})the\s+(?:more|less|better|worse|higher|lower|faster|slower|larger|smaller|greater|fewer)(?!\p{L})[\s\S]*(?<!\p{L})the\s+(?:more|less|better|worse|higher|lower|faster|slower|larger|smaller|greater|fewer)(?!\p{L})/iu;
  // a lower bound, the upper and lower limbs, higher-order: places, not comparisons
  const PLACE_AFTER = /^\s+(?:bounds?|limits?|cases?|panels?|rows?|half|parts?|end|left|right|triangular|limbs?|jaw|lips?|order|layers?|dimensional|dimensions|envelope|quartile|extremit(?:y|ies)|body|back|abdomen|legs?|arms?|scales?|education|plants|vertebrates|primates|mammals|organisms|taxa)(?!\p{L})/iu;
  const NO_BEFORE = /(?<!\p{L})(?:no|any)\s+$/iu;
  const OR_AFTER = /^\s+(?:or|and)\s+(?:more|less)(?!\p{L})/iu;
  const BE_BEFORE = /(?<!\p{L})(?:is|are|was|were|be|been|being|remains?|remained|proved|proves|seems?|seemed|appears?|appeared)\s+$/iu;
  // "to lower the threshold", "to better understand": verbs
  const VERB_BEFORE = /(?<!\p{L})(?:to|we|they|can|could|will|would|may|might|must|should|did|does|do|helps?|helped)\s+$/iu;
  // more + an adjective or adverb (more accurate), not a noun (more data)
  const ADJ = set(`
    accurate appropriate adequate moderate elaborate separate delicate deliberate intricate private robust stable
    complex precise rapid common severe intense diverse prone sparse dense strict broad narrow recent frequent clear
    difficult likely similar important efficient effective sensitive specific reliable consistent modest subtle
    abrupt compact smooth uniform variable flexible stringent realistic general informative expressive selective
    expensive often pronounced detailed advanced sophisticated complicated balanced concentrated localized localised
    restricted constrained correlated connected skewed varied open closed active
  `);
  const ADJ_END = /(?:ive|ous|ful|able|ible|ic|al|ent|ant|ary|ile|ly|lar|iar|near|clear)$/;
  const NOT_ADJ = set(`
    signal material potential total capital metal animal interval rental trial
    traffic music logic plastic fabric topic clinic mechanic epidemic arithmetic magic panic rhetoric graphic public
    patient student agent solvent content percent parent talent event rodent gradient coefficient component
    ingredient client current extent participant variant plant giant servant pollutant reactant mutant implant tenant
    incentive initiative archive motive detective drive five hive olive
    library summary salary dictionary boundary vocabulary glossary anniversary secretary
    file tile profile mile pile smile while percentile quartile textile
    table cable vegetable timetable
    supply family assembly anomaly rally ally jelly belly monopoly reply apply fly only
  `);
  const adjective = (w) => {
    w = lc(w);
    if (ADJ.has(w)) return true;
    return ADJ_END.test(w) && !NOT_ADJ.has(w) && !w.endsWith('ment') && w.length > 3;
  };
  // inside brackets in its sentence
  function bracketed(s, from, i) {
    let depth = 0;
    for (let k = from; k < i; k++) {
      if (s[k] === '(') depth++;
      else if (s[k] === ')' && depth) depth--;
    }
    return depth > 0;
  }

  function compares(s, p, sents, out) {
    const done = new Set();
    const based = new Map();
    COMPARE_RE.lastIndex = 0;
    let m;
    while ((m = COMPARE_RE.exec(s))) {
      const start = m.index, end = start + m[0].length;
      const k = sentenceOf(sents, start);
      if (k < 0 || done.has(k)) continue;
      const sent = sents[k];
      if (!based.has(k)) {
        const text = s.slice(sent.start, sent.end);
        based.set(k, BASIS.test(text) || FROM_TO.test(text) || THE_MORE.test(text));
      }
      if (based.get(k)) { done.add(k); continue; }
      const w = lc(m[1] || m[2]);
      const before = s.slice(Math.max(sent.start, start - 30), start);
      const after = s.slice(end, end + 40);
      if (m[2] && !adjective(m[3])) { COMPARE_RE.lastIndex = start + m[2].length; continue; }
      if (after[0] === '-' || PLACE_AFTER.test(after) || NO_BEFORE.test(before) || OR_AFTER.test(s.slice(start + w.length, end + 40))) continue;
      if ((w === 'superior' || w === 'inferior') && !BE_BEFORE.test(before)) continue;
      if ((w === 'lower' || w === 'better') && VERB_BEFORE.test(before)) continue;
      if (bracketed(s, sent.start, start)) continue;
      done.add(k);
      out.push(flag(p, start, end, 'compare', NOTE.compare, {}, null));
    }
  }

  // ---------------------------------------------------------------------
  // 4. A sentence over 40 words
  // ---------------------------------------------------------------------
  const LONG = 40;
  function longs(s, p, sents, out) {
    for (const x of sents) {
      const n = countWords(s.slice(x.start, x.end));
      if (n > LONG) out.push(flag(p, x.start, x.end, 'long', NOTE.long, { n }, null));
    }
  }

  // ---------------------------------------------------------------------
  // 5. The same word twice (that that and had had are grammar; Bora Bora a name)
  // ---------------------------------------------------------------------
  const REPEAT_RE = new RegExp(B0 + '(\\p{L}+) (\\1)' + B1, 'giu');
  function repeats(s, p, out) {
    REPEAT_RE.lastIndex = 0;
    let m;
    while ((m = REPEAT_RE.exec(s))) {
      const w = lc(m[1]);
      if (w === 'that' || w === 'had' || (upper(m[1][0]) && upper(m[2][0]))) continue;
      out.push(flag(p, m.index, m.index + m[0].length, 'repeat', NOTE.repeat, { word: m[1] }, m[1]));
    }
  }

  // ---------------------------------------------------------------------
  // 6. A number touching its unit (10mV). Not A, M, B, K or N alone (a
  // panel, a million, an isotope), nor %, nor degrees; not the 1990s, and
  // not a figure's panel (Fig. 2g).
  // ---------------------------------------------------------------------
  const UNITS = `
    s ms µs μs ns ps min h Hz kHz MHz GHz V mV µV μV kV mA µA μA nA pA W mW kW MW J kJ eV keV MeV
    Pa kPa MPa g kg mg µg μg ng m km cm mm µm μm nm L mL µL μL mM µM μM nM pM mol mmol µmol μmol
    Ω kΩ MΩ dB bit bits byte bytes kB MB GB TB bp kb Mb kbp Mbp
  `.trim().split(/\s+/).sort((a, b) => b.length - a.length);
  const UNITS_RE = new RegExp('(?<![\\p{L}\\p{N}_.,$£€])(\\d+(?:[.,]\\d+)*)(' + UNITS.join('|') + ')' + B1, 'gu');
  const FIG_BEFORE = /(?:fig(?:ure)?s?\.?|tables?|tab\.|eqs?\.?|equations?|panels?|sections?|sec\.|refs?\.|appendix|supplementary|extended\s+data|steps?|no\.)\s*(?:\(?[A-Za-z]?\d+[A-Za-z]?(?:[–-][A-Za-z]?\d*[A-Za-z]?)?\)?\s*(?:,|and|&|or|to)?\s*)*$/i;
  function units(s, p, out) {
    UNITS_RE.lastIndex = 0;
    let m;
    while ((m = UNITS_RE.exec(s))) {
      const [, num, unit] = m;
      if (unit === 's' && /^\d0$|^\d{3}0$/.test(num)) continue;
      if (unit.length === 1 && s[m.index - 1] === '(' && s[m.index + m[0].length] === ')') continue;
      if (FIG_BEFORE.test(s.slice(Math.max(0, m.index - 60), m.index))) continue;
      const fixed = num + ' ' + unit;
      out.push(flag(p, m.index, m.index + m[0].length, 'units', NOTE.units, { fixed }, fixed));
    }
  }

  // ---------------------------------------------------------------------
  // 7. A range with a hyphen (10-20). Not COVID-19, L2-5, -5, a date
  // (2020-01-15), a phone number or a sum.
  // ---------------------------------------------------------------------
  const RANGE_RE = /(?<![\p{L}\p{N}_.,\-–−+=×*/^$£€])(?<![=<>+×*/^]\s+)(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)(?![\p{L}\p{N}\-–−]|[.,]\d|\s*[=<>+×*/^])/gu;
  function ranges(s, p, out) {
    RANGE_RE.lastIndex = 0;
    let m;
    while ((m = RANGE_RE.exec(s))) {
      const fixed = m[1] + '–' + m[2];
      out.push(flag(p, m.index, m.index + m[0].length, 'range', NOTE.range, { fixed }, fixed));
    }
  }

  // ---------------------------------------------------------------------
  // 8. Acronyms, across the paper. A definition is the long form, then the
  // acronym in brackets, the initials matching (small words skipped, a
  // word giving more than one letter as electroencephalography gives EEG).
  // ---------------------------------------------------------------------
  const ACR_RE = /(?<![\p{L}\p{N}-])([a-z]?[A-Z][A-Z0-9]{1,6})(s?)(?![\p{L}\p{N}])/gu;
  const DEF_RE = /\(([a-z]?[A-Z][A-Z0-9]{1,6})(s?)\)/gu;
  const SMALL = set('of and the for in to a an on with by at from de la le du des der die das und von y del et e');
  const ROMAN = /^(?=[MDCLXVI])M{0,3}(?:C[MD]|D?C{0,3})(?:X[CL]|L?X{0,3})(?:I[XV]|V?I{0,3})$/;
  // what a reader knows without a definition
  const COMMON = set(`
    DNA RNA mRNA tRNA rRNA miRNA cDNA ATP ADP AMP GTP NADH NADPH PCR qPCR MRI fMRI EEG ECG EKG PET CPU GPU TPU RAM ROM
    USB USA UK EU UN WHO NASA NIH NSF ERC PDF URL HTTP HTTPS HTML XML JSON API CSV SQL GPS LED LCD DVD RGB ASCII UTF
    ISO IEEE ACM IUPAC UTC GMT FAQ NATO UNESCO OECD UNICEF CEO IQ AI ML HIV AIDS COVID SARS MERS HPV UV IR TV PC
    GDP BMI ICU SEM ANOVA IQR GABA NMDA AMPA GFP CRISPR MATLAB SPSS SAS GPT BERT
    AND OR NOT XOR NAND NOR IF THEN ELSE TRUE FALSE NULL NONE ALL
  `);
  const subseq = (needle, hay) => {
    let i = 0;
    for (let k = 0; k < hay.length && i < needle.length; k++) if (hay[k] === needle[i]) i++;
    return i === needle.length;
  };
  // how many words, nearest first, spell the letters (0 when they don't)
  function initials(letters, ws) {
    const go = (li, wi) => {
      if (li === 0) return wi;
      if (wi >= ws.length) return 0;
      const w = ws[wi];
      for (let k = li - 1; k >= Math.max(0, li - 4); k--) {
        if (letters[k] !== w[0] || !subseq(letters.slice(k + 1, li), w.slice(1))) continue;
        const r = go(k, wi + 1);
        if (r) return r;
      }
      if ((wi > 0 && SMALL.has(w)) || /^\p{N}+$/u.test(w)) return go(li, wi + 1);
      return 0;
    };
    return go(letters.length, 0);
  }
  const LONG_WORD = /[\p{L}\p{N}]+/gu;
  const HYPHENED = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*-$/u;
  // where the long form before a bracket starts, or -1
  function longFormStart(s, from, paren, acr) {
    const letters = lc(acr).replace(/\P{L}/gu, '');
    const text = s.slice(from, paren);
    if (!/\s$/.test(text) && text) return -1;
    const ws = [];
    LONG_WORD.lastIndex = 0;
    let m;
    while ((m = LONG_WORD.exec(text))) ws.push({ w: lc(m[0]), at: from + m.index });
    const near = ws.slice(-(letters.length * 2 + 4)).reverse();
    if (!near.length || /\S/.test(s.slice(near[0].at + near[0].w.length, paren))) return -1;
    const n = initials(letters, near.map((x) => x.w));
    if (!n) return -1;
    let start = near[n - 1].at;
    const joined = HYPHENED.exec(s.slice(from, start));
    if (joined) start -= joined[0].length;
    return start;
  }

  function acronyms(list, sents, out) {
    const defs = new Map(), uses = new Map();
    const add = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
    list.forEach((s, p) => {
      const parens = [];
      DEF_RE.lastIndex = 0;
      let m;
      while ((m = DEF_RE.exec(s))) {
        const acr = m[1];
        if ((acr.match(/[A-Z]/g) || []).length < 2 || ROMAN.test(acr)) continue;
        const k = sentenceOf(sents[p], m.index);
        const start = longFormStart(s, k < 0 ? 0 : sents[p][k].start, m.index, acr);
        if (start < 0) continue;
        const end = m.index + m[0].length;
        parens.push([m.index, end]);
        add(defs, acr, { p, start, end, paren: m.index, text: acr + m[2] });
      }
      ACR_RE.lastIndex = 0;
      while ((m = ACR_RE.exec(s))) {
        const acr = m[1], at = m.index;
        if ((acr.match(/[A-Z]/g) || []).length < 2 || ROMAN.test(acr)) continue;
        if (parens.some(([a, b]) => at >= a && at < b)) continue;
        add(uses, acr, { p, start: at, end: at + m[0].length });
      }
    });
    const before = (a, b) => a.p < b.p || (a.p === b.p && a.start < b.start);
    for (const [acr, ds] of defs) {
      const us = uses.get(acr) || [];
      const n = ds[0].p + 1;
      if (us.length && before(us[0], ds[0])) {
        const u = us[0];
        out.push(flag(u.p, u.start, u.end, 'acronym', NOTE.acronymEarly, { acronym: acr, n }, null));
      }
      for (const d of ds.slice(1)) out.push(flag(d.p, d.start, d.end, 'acronym', NOTE.acronymTwice, { acronym: acr, n }, d.text));
      if (!us.length && ds.length === 1) {
        // cut the bracket and the space before it: the long form stays
        const d = ds[0], s = list[d.p];
        let start = d.paren;
        while (start > 0 && SPACE.test(s[start - 1])) start--;
        out.push(flag(d.p, start, d.end, 'acronym', NOTE.acronymUnused, { acronym: acr }, ''));
      }
    }
    for (const [acr, us] of uses) {
      if (defs.has(acr) || COMMON.has(acr) || /\d/.test(acr) || (acr.match(/[A-Z]/g) || []).length < 3) continue;
      const u = us[0];
      out.push(flag(u.p, u.start, u.end, 'acronym', NOTE.acronymUndefined, { acronym: acr }, null));
    }
  }

  // ---------------------------------------------------------------------
  // 9. One form throughout: non-linear beside nonlinear, modelling beside
  // modeling. Each pair only where both forms are in the paper; the
  // fewer-used form is flagged (on a tie, the one that came in later).
  // ---------------------------------------------------------------------
  const OUR = /^(col|behavi|fav|lab|neighb|hon|hum|flav|harb|rum|vap|tum|od|endeav|rig|vig|arm|sav|cand|ferv|splend|parl)our(.*)$/;
  const TRE = /^(cent|fib|lit|theat|spect|calib)(re|res|red|ring)$/;
  const TRE_US = { re: 'er', res: 'ers', red: 'ered', ring: 'ering' };
  const LL = /^(model|label|travel|signal|cancel|fuel|level|channel|tunnel|counsel|marshal|total|dial|equal|rival|jewel|funnel|unravel|initial|pedal|libel|shovel|quarrel|barrel|panel)l(ed|ing|er|ers)$/;
  const AE = [['haem', 'hem'], ['anaes', 'anes'], ['paed', 'ped'], ['ischaem', 'ischem'], ['leukaem', 'leukem'],
    ['gynaec', 'gynec'], ['archaeo', 'archeo'], ['palaeo', 'paleo'], ['caesar', 'cesar'], ['diarrhoea', 'diarrhea'],
    ['oesophag', 'esophag'], ['oestr', 'estr'], ['oedem', 'edem'], ['foet', 'fet']];
  const PAIRS = { grey: 'gray', greys: 'grays', sulphur: 'sulfur', aluminium: 'aluminum', ageing: 'aging',
    judgement: 'judgment', judgements: 'judgments', acknowledgement: 'acknowledgment', acknowledgements: 'acknowledgments' };
  // the American spelling of a British one, or null
  function american(w) {
    if (PAIRS[w]) return PAIRS[w];
    let m;
    if ((m = /^(.{2,})is(e|es|ed|ing|er|ers|ation|ations|ational|able)$/.exec(w))) return m[1] + 'iz' + m[2];
    if ((m = /^(.+)ys(e|es|ed|ing|er|ers)$/.exec(w))) return m[1] + 'yz' + m[2];
    if ((m = OUR.exec(w))) return m[1] + 'or' + m[2];
    if ((m = TRE.exec(w))) return m[1] + TRE_US[m[2]];
    if ((m = LL.exec(w))) return m[1] + m[2];
    for (const [gb, us] of AE) if (w.includes(gb)) return w.replace(gb, us);
    return null;
  }
  const PLAIN = /\p{L}+/gu;
  const HYPHEN_PAIR = /(?<![\p{L}\p{N}-])(\p{L}+)-(\p{L}+)(?![\p{L}\p{N}]|-[\p{L}\p{N}])/gu;

  function variants(list, out) {
    const words = new Map(), joins = new Map();
    const add = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
    list.forEach((s, p) => {
      let m;
      PLAIN.lastIndex = 0;
      while ((m = PLAIN.exec(s))) add(words, lc(m[0]), { p, start: m.index, end: m.index + m[0].length, text: m[0] });
      HYPHEN_PAIR.lastIndex = 0;
      while ((m = HYPHEN_PAIR.exec(s))) {
        if (lc(m[1]) === 're' || m[1].length + m[2].length < 6) continue;
        add(joins, lc(m[0]), { p, start: m.index, end: m.index + m[0].length, text: m[0] });
      }
    });
    const pit = (a, b, as, bs) => {
      const later = (x, y) => x[0].p > y[0].p || (x[0].p === y[0].p && x[0].start > y[0].start);
      const aMinor = as.length < bs.length || (as.length === bs.length && later(as, bs));
      const [major, minor, majors, minors] = aMinor ? [b, a, bs, as] : [a, b, as, bs];
      const vars = { major, n: majors.length, minor, m: minors.length };
      for (const o of minors) out.push(flag(o.p, o.start, o.end, 'variant', NOTE.variant, vars, asCase(o.text, major)));
    };
    for (const [hy, hs] of joins) {
      const joined = hy.replace('-', '');
      if (words.has(joined)) pit(hy, joined, hs, words.get(joined));
    }
    for (const [gb, gs] of words) {
      const us = american(gb);
      if (us && us !== gb && words.has(us)) pit(gb, us, gs, words.get(us));
    }
  }

  // ---------------------------------------------------------------------
  // 10. A sentence that opens with a numeral (not 3D, not a list's "1.")
  // ---------------------------------------------------------------------
  const LEADING_NUMBER = /^\d+(?:[.,]\d+)*(?![\p{L}\p{N}])/u;
  function numbers(s, p, sents, out) {
    if (countWords(s) < 4) return;
    for (const x of sents) {
      const m = LEADING_NUMBER.exec(s.slice(x.start, x.end));
      if (!m || !/\p{L}/u.test(s.slice(x.start + m[0].length, x.end))) continue;
      out.push(flag(p, x.start, x.start + m[0].length, 'numbers', NOTE.numbers, {}, null));
    }
  }

  // ---------------------------------------------------------------------
  // Overlaps: a flag with a fix wins, then the earlier rule. A long
  // sentence keeps the parts around what won inside it.
  // ---------------------------------------------------------------------
  const rank = (f) => (f.fix == null ? ORDER.length : 0) + ORDER.indexOf(f.rule);
  const HAS_WORD = /[\p{L}\p{N}\uFFFC]/u;
  function resolve(flags, list) {
    const byP = new Map();
    for (const f of flags) {
      if (!byP.has(f.p)) byP.set(f.p, []);
      byP.get(f.p).push(f);
    }
    const out = [];
    for (const fs of byP.values()) {
      const kept = [];
      for (const f of fs.filter((x) => x.rule !== 'long').sort((a, b) => rank(a) - rank(b) || a.start - b.start)) {
        if (!kept.some((k) => overlaps(k, f))) kept.push(f);
      }
      kept.sort((a, b) => a.start - b.start);
      for (const f of fs.filter((x) => x.rule === 'long')) {
        let from = f.start;
        const pieces = [];
        for (const k of kept) {
          if (k.end <= from || k.start >= f.end) continue;
          if (k.start > from) pieces.push([from, k.start]);
          from = Math.max(from, k.end);
        }
        if (from < f.end) pieces.push([from, f.end]);
        const s = list[f.p];
        for (let [a, b] of pieces) {
          while (a < b && SPACE.test(s[a])) a++;
          while (b > a && SPACE.test(s[b - 1])) b--;
          if (HAS_WORD.test(s.slice(a, b))) out.push({ ...f, start: a, end: b });
        }
      }
      out.push(...kept);
    }
    return out.sort((a, b) => a.p - b.p || a.start - b.start);
  }

  function check(paras, { lang = 'en' } = {}) {
    const en = /^en/i.test(String(lang || 'en'));
    const list = (paras || []).map((s) => String(s == null ? '' : s));
    const sents = list.map(sentences);
    const out = [];
    list.forEach((s, p) => {
      if (en) {
        const fillersHere = fillers(s, p, out);
        passives(s, p, sents[p], fillersHere, out);
        compares(s, p, sents[p], out);
        longs(s, p, sents[p], out);
      }
      repeats(s, p, out);
      units(s, p, out);
      ranges(s, p, out);
      numbers(s, p, sents[p], out);
    });
    acronyms(list, sents, out);
    if (en) variants(list, out);
    return resolve(en ? out : out.filter((f) => NEUTRAL.has(f.rule)), list);
  }

  return { RULES, TEMPLATES, check, sentences };
});
