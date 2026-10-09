// NEO — a paper's references
//
// A paper keeps its references in references.json beside its chapters: an
// array of CSL JSON items (the format Zotero, Mendeley, Pandoc and every
// citation style speak), each with a citation key as its id. This file
// reads what academics bring (BibTeX, RIS, CSL JSON), writes BibTeX back out
// for LaTeX, finds DOIs and arXiv IDs in pasted text, and ranks references
// for the @ picker. Plain string work only: it runs in the window, in Pocket
// and under node's tests alike (window.NeoReferences).

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoReferences = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------
  // LaTeX → Unicode, for the text inside BibTeX fields
  // ---------------------------------------------------------------------
  const ACCENTS = {
    "'": '\u0301', '`': '\u0300', '^': '\u0302', '"': '\u0308', '~': '\u0303', '=': '\u0304',
    '.': '\u0307', 'u': '\u0306', 'v': '\u030C', 'H': '\u030B', 'c': '\u0327', 'k': '\u0328',
    'r': '\u030A', 'd': '\u0323', 'b': '\u0331'
  };
  const SYMBOLS = {
    ss: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł',
    i: 'ı', j: 'ȷ', dh: 'ð', DH: 'Ð', th: 'þ', TH: 'Þ', ng: 'ŋ', NG: 'Ŋ',
    textendash: '–', textemdash: '—', textquoteleft: '‘', textquoteright: '’',
    textquotedblleft: '“', textquotedblright: '”', textellipsis: '…', ldots: '…', dots: '…',
    textregistered: '®', texttrademark: '™', copyright: '©', S: '§', P: '¶', textdegree: '°',
    textbackslash: '\\', textasciitilde: '~', textunderscore: '_', textbar: '|', textless: '<', textgreater: '>',
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', kappa: 'κ', lambda: 'λ', mu: 'μ',
    pi: 'π', sigma: 'σ', tau: 'τ', theta: 'θ', omega: 'ω', Delta: 'Δ', Gamma: 'Γ', Omega: 'Ω'
  };

  function latexToUnicode(s) {
    if (!s) return '';
    let out = String(s);
    // \'{e}  \'e  {\'e}  \c{c}
    out = out.replace(/\\([`'^"~=.uvHckrdb])\s*(?:\{\\?([A-Za-z])\}|\\?([A-Za-z]))/g, (m, acc, a, b) => {
      let base = a || b;
      if (base === 'i') base = 'i'; // \'{\i} and \'i both mean í
      return (base + ACCENTS[acc]).normalize('NFC');
    });
    out = out.replace(/\\([`'^"~=.])\{\}/g, (m, acc) => acc);
    out = out.replace(/\\([A-Za-z]+)\b\s?(\{\})?/g, (m, name) => (name in SYMBOLS ? SYMBOLS[name] : m));
    out = out.replace(/\\([&%$#_{}])/g, '$1');
    out = out.replace(/---/g, '—').replace(/--/g, '–').replace(/``/g, '“').replace(/''/g, '”');
    out = out.replace(/(^|[^\\])~/g, '$1\u00a0');
    // what's left of formatting commands: \emph{x} \textit{x} \textbf{x} → x
    out = out.replace(/\\(?:emph|textit|textbf|textsc|textrm|textsf|texttt|mathrm|mbox|url|href\{[^}]*\})\s*/g, '');
    out = out.replace(/[{}]/g, '');
    return out.replace(/\s+/g, ' ').trim();
  }

  // ---------------------------------------------------------------------
  // BibTeX
  // ---------------------------------------------------------------------
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const BIB_TYPES = {
    article: 'article-journal', book: 'book', booklet: 'pamphlet', inbook: 'chapter', incollection: 'chapter',
    inproceedings: 'paper-conference', conference: 'paper-conference', proceedings: 'book', manual: 'report',
    mastersthesis: 'thesis', phdthesis: 'thesis', thesis: 'thesis', techreport: 'report', report: 'report',
    unpublished: 'manuscript', online: 'webpage', electronic: 'webpage', www: 'webpage', dataset: 'dataset',
    software: 'software', misc: 'document'
  };

  // Split a BibTeX file into its raw entries: @type{ ... } with braces counted
  function bibEntries(text) {
    const out = [];
    let i = 0;
    while ((i = text.indexOf('@', i)) !== -1) {
      const head = /^@\s*([A-Za-z]+)\s*([{(])/.exec(text.slice(i, i + 64));
      if (!head) { i++; continue; }
      const open = head[2];
      const close = open === '{' ? '}' : ')';
      let depth = 0;
      let j = i + head[0].length - 1;
      let inQuote = false;
      for (; j < text.length; j++) {
        const c = text[j];
        if (c === '\\') { j++; continue; }
        if (c === '"' && depth === 1 && open === '{') inQuote = !inQuote;
        if (inQuote) continue;
        if (c === open || (c === '{' && open === '(')) depth++;
        else if (c === close || (c === '}' && open === '(')) { depth--; if (depth === 0) break; }
      }
      out.push({ type: head[1].toLowerCase(), body: text.slice(i + head[0].length, j), at: i });
      i = j + 1;
    }
    return out;
  }

  // field = {value} # "value" # macro # 2020, ...
  function bibFields(body, strings) {
    const fields = {};
    let i = 0;
    const skip = () => { while (i < body.length && /[\s,]/.test(body[i])) i++; };
    const readValue = () => {
      let value = '';
      for (;;) {
        while (i < body.length && /\s/.test(body[i])) i++;
        const c = body[i];
        if (c === '{') {
          let depth = 0;
          const start = i;
          for (; i < body.length; i++) {
            if (body[i] === '\\') { i++; continue; }
            if (body[i] === '{') depth++;
            else if (body[i] === '}') { depth--; if (depth === 0) { i++; break; } }
          }
          value += body.slice(start + 1, i - 1);
        } else if (c === '"') {
          const start = ++i;
          let depth = 0;
          for (; i < body.length; i++) {
            if (body[i] === '\\') { i++; continue; }
            if (body[i] === '{') depth++;
            else if (body[i] === '}') depth--;
            else if (body[i] === '"' && depth === 0) break;
          }
          value += body.slice(start, i);
          i++;
        } else {
          const m = /^[^\s,#}]+/.exec(body.slice(i));
          if (!m) break;
          i += m[0].length;
          const word = m[0];
          // a number, an @string macro, or a month (jan) left for dateFrom
          value += strings[word.toLowerCase()] !== undefined ? strings[word.toLowerCase()] : word;
        }
        while (i < body.length && /\s/.test(body[i])) i++;
        if (body[i] === '#') { i++; continue; }
        break;
      }
      return value;
    };
    for (;;) {
      skip();
      const m = /^([A-Za-z][\w\-:.+]*)\s*=/.exec(body.slice(i));
      if (!m) break;
      i += m[0].length;
      fields[m[1].toLowerCase()] = readValue();
    }
    return fields;
  }

  // "Last, First and First von Last and {Corporate Name}"
  function splitTopLevel(s, sep) {
    const parts = [];
    let depth = 0;
    let cur = '';
    const re = new RegExp('^' + sep, 'i');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      if (depth === 0 && re.test(s.slice(i))) {
        const m = re.exec(s.slice(i));
        parts.push(cur);
        cur = '';
        i += m[0].length - 1;
        continue;
      }
      cur += c;
    }
    parts.push(cur);
    return parts.map((p) => p.trim()).filter(Boolean);
  }

  function parseName(raw) {
    const s = raw.trim();
    if (/^\{.*\}$/.test(s) && !/^\{[^{}]*\}\s*\S/.test(s.slice(1, -1))) return { literal: latexToUnicode(s) };
    const parts = splitTopLevel(s, ',');
    if (parts.length >= 2) {
      const name = { family: latexToUnicode(parts[0]), given: latexToUnicode(parts[parts.length - 1]) };
      if (parts.length === 3) name.suffix = latexToUnicode(parts[1]);
      const particle = /^((?:[a-z]+\s+)+)(.*)$/.exec(name.family);
      if (particle && particle[2]) { name['non-dropping-particle'] = particle[1].trim(); name.family = particle[2]; }
      return name;
    }
    const words = splitTopLevel(s, '\\s+');
    if (words.length === 1) return { family: latexToUnicode(words[0]) };
    // von part: lowercase words before the last name
    const k = words.length - 1;
    let v = -1;
    for (let w = 1; w < words.length - 1; w++) if (/^[a-z]/.test(words[w])) { v = w; break; }
    if (v > 0) {
      let e = v;
      while (e + 1 < k && /^[a-z]/.test(words[e + 1])) e++;
      return {
        given: latexToUnicode(words.slice(0, v).join(' ')),
        'non-dropping-particle': latexToUnicode(words.slice(v, e + 1).join(' ')),
        family: latexToUnicode(words.slice(e + 1).join(' '))
      };
    }
    return { given: latexToUnicode(words.slice(0, k).join(' ')), family: latexToUnicode(words[k]) };
  }

  function parseNames(value) {
    return splitTopLevel(value, '\\s+and\\s+').filter((n) => n.toLowerCase() !== 'others').map(parseName);
  }

  function dateFrom(fields) {
    const raw = fields.date || '';
    let m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(raw);
    if (m) return { 'date-parts': [[+m[1], ...(m[2] ? [+m[2]] : []), ...(m[3] ? [+m[3]] : [])]] };
    m = /(\d{4})/.exec(fields.year || '');
    if (!m) return null;
    const parts = [+m[1]];
    const mon = (fields.month || '').toLowerCase().trim();
    const month = MONTHS[mon.slice(0, 3)] || (/^\d{1,2}$/.test(mon) ? +mon : 0);
    if (month) parts.push(month);
    return { 'date-parts': [parts] };
  }

  function bibToCsl(type, key, f) {
    const item = { id: key, type: BIB_TYPES[type] || 'document' };
    const text = (name) => (f[name] !== undefined ? latexToUnicode(f[name]) : undefined);
    const set = (to, value) => { if (value !== undefined && value !== '') item[to] = value; };
    set('title', text('title'));
    if (f.author) item.author = parseNames(f.author);
    if (f.editor) item.editor = parseNames(f.editor);
    if (type === 'incollection' || type === 'inproceedings' || type === 'conference' || type === 'inbook') set('container-title', text('booktitle') || text('journal'));
    else set('container-title', text('journal') || text('journaltitle') || text('booktitle'));
    set('collection-title', text('series'));
    set('volume', text('volume'));
    set('issue', text('number') || text('issue'));
    set('page', f.pages !== undefined ? latexToUnicode(f.pages).replace(/\s*[–—-]+\s*/g, '-') : undefined);
    set('publisher', text('publisher') || text('school') || text('institution') || text('organization'));
    set('publisher-place', text('address') || text('location'));
    set('edition', text('edition'));
    const date = dateFrom(f);
    if (date) item.issued = date;
    if (f.doi) item.DOI = cleanDoi(f.doi);
    set('URL', f.url ? f.url.trim() : undefined);
    set('ISBN', text('isbn'));
    set('ISSN', text('issn'));
    set('abstract', text('abstract'));
    set('note', text('note'));
    if (type === 'phdthesis') item.genre = 'PhD thesis';
    if (type === 'mastersthesis') item.genre = 'Master’s thesis';
    const eprint = f.eprint && (/arxiv/i.test(f.archiveprefix || f.eprinttype || '') || /^\d{4}\.\d{4,5}/.test(f.eprint));
    if (eprint) {
      set('number', 'arXiv:' + f.eprint.trim());
      if (!item['container-title']) item['container-title'] = 'arXiv';
      if (item.type === 'document') item.type = 'article';
    }
    if (item.type === 'document' && item.URL && !item['container-title']) item.type = 'webpage';
    if (f.urldate) { const d = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(f.urldate); if (d) item.accessed = { 'date-parts': [[+d[1], +d[2], +d[3]]] }; }
    return item;
  }

  function parseBibtex(text) {
    const items = [];
    const errors = [];
    const strings = {};
    for (const e of bibEntries(String(text || ''))) {
      if (e.type === 'comment' || e.type === 'preamble') continue;
      if (e.type === 'string') {
        Object.assign(strings, bibFields(e.body, strings));
        continue;
      }
      const comma = e.body.indexOf(',');
      const key = (comma < 0 ? e.body : e.body.slice(0, comma)).trim();
      if (!key) { errors.push('An entry without a key was skipped'); continue; }
      try {
        items.push(bibToCsl(e.type, key, bibFields(comma < 0 ? '' : e.body.slice(comma + 1), strings)));
      } catch (err) {
        errors.push(key + ': ' + err.message);
      }
    }
    return { items, errors };
  }

  // BibTeX out, for LaTeX: the same keys the paper cites with
  const CSL_TO_BIB = {
    'article-journal': 'article', article: 'article', 'article-magazine': 'article', 'article-newspaper': 'article',
    book: 'book', chapter: 'incollection', 'paper-conference': 'inproceedings', thesis: 'phdthesis',
    report: 'techreport', manuscript: 'unpublished', webpage: 'misc', dataset: 'misc', software: 'misc'
  };
  function bibEscape(s) {
    return String(s).replace(/\\/g, '\\textbackslash{}').replace(/([&%$#_])/g, '\\$1').replace(/~/g, '\\textasciitilde{}').replace(/\u00a0/g, '~');
  }
  // keep capitals a style would otherwise lowercase: DNA, McDonald, arXiv,
  // and a capital past the title's first word (a name: in Drosophila)
  const protectCaps = (s) => bibEscape(s).replace(/[^\s{}]*[A-Z][^\s{}]*/g, (word, at) =>
    (/[A-Z]/.test(word.slice(1)) || at > 0 ? '{' + word + '}' : word));
  function bibName(n) {
    if (n.literal) return '{' + bibEscape(n.literal) + '}';
    const family = [n['non-dropping-particle'], n.family].filter(Boolean).join(' ');
    return [family, n.suffix, n.given].filter((x) => x !== undefined && x !== '').map(bibEscape).join(', ');
  }
  function toBibtex(items) {
    return items.map((it) => {
      let type = CSL_TO_BIB[it.type] || 'misc';
      if (it.type === 'thesis' && /master/i.test(it.genre || '')) type = 'mastersthesis';
      const f = [];
      const add = (k, v) => { if (v !== undefined && v !== null && String(v).trim() !== '') f.push(`  ${k} = {${v}}`); };
      if (it.author) add('author', it.author.map(bibName).join(' and '));
      if (it.editor) add('editor', it.editor.map(bibName).join(' and '));
      if (it.title) add('title', protectCaps(it.title));
      const container = it['container-title'];
      if (container) add(type === 'article' ? 'journal' : (type === 'incollection' || type === 'inproceedings') ? 'booktitle' : 'howpublished', bibEscape(container));
      add('series', it['collection-title'] && bibEscape(it['collection-title']));
      add('volume', it.volume);
      add('number', it.issue);
      add('pages', it.page && String(it.page).replace(/-/g, '--'));
      const pub = it.publisher && bibEscape(it.publisher);
      add(type === 'phdthesis' || type === 'mastersthesis' ? 'school' : type === 'techreport' ? 'institution' : 'publisher', pub);
      add('address', it['publisher-place'] && bibEscape(it['publisher-place']));
      add('edition', it.edition);
      const year = yearOf(it);
      if (year) add('year', year);
      add('doi', it.DOI);
      add('url', it.URL);
      add('isbn', it.ISBN);
      const arxiv = /arXiv:(\S+)/i.exec(it.number || '');
      if (arxiv) { add('eprint', arxiv[1]); add('archiveprefix', 'arXiv'); }
      add('note', it.note && bibEscape(it.note));
      return `@${type}{${it.id},\n${f.join(',\n')}\n}`;
    }).join('\n\n') + '\n';
  }

  // ---------------------------------------------------------------------
  // RIS (EndNote, Web of Science, most publisher download buttons)
  // ---------------------------------------------------------------------
  const RIS_TYPES = {
    JOUR: 'article-journal', JFULL: 'article-journal', EJOUR: 'article-journal', MGZN: 'article-magazine', NEWS: 'article-newspaper',
    BOOK: 'book', EBOOK: 'book', CHAP: 'chapter', ECHAP: 'chapter', CONF: 'paper-conference', CPAPER: 'paper-conference',
    THES: 'thesis', RPRT: 'report', UNPB: 'manuscript', ELEC: 'webpage', WEB: 'webpage', DATA: 'dataset', COMP: 'software'
  };
  function parseRis(text) {
    const items = [];
    let cur = null;
    for (const line of String(text || '').split(/\r?\n/)) {
      const m = /^([A-Z][A-Z0-9]) {2}-\s?(.*)$/.exec(line);
      if (!m) continue;
      const [, tag, value] = m;
      const v = value.trim();
      if (tag === 'TY') { cur = { type: RIS_TYPES[v] || 'document', _au: [], _ed: [], _kw: [] }; continue; }
      if (!cur) continue;
      if (tag === 'ER') {
        const it = { type: cur.type };
        for (const k of Object.keys(cur)) if (!k.startsWith('_')) it[k] = cur[k];
        if (cur._au.length) it.author = cur._au;
        if (cur._ed.length) it.editor = cur._ed;
        if (cur._kw.length) it.keyword = cur._kw.join(', ');
        if (cur._sp) it.page = cur._sp + (cur._ep ? '-' + cur._ep : '');
        items.push(it);
        cur = null;
        continue;
      }
      const name = (s) => {
        const [family, given, suffix] = s.split(',').map((x) => x.trim());
        return given ? { family, given, ...(suffix ? { suffix } : {}) } : { literal: family };
      };
      if (tag === 'AU' || tag === 'A1') cur._au.push(name(v));
      else if (tag === 'A2' || tag === 'ED') cur._ed.push(name(v));
      else if (tag === 'TI' || tag === 'T1') cur.title = v;
      else if (tag === 'T2' || tag === 'JO' || tag === 'JF' || tag === 'JA' || tag === 'BT') { if (!cur['container-title'] || tag === 'T2' || tag === 'JF') cur['container-title'] = v; }
      else if (tag === 'VL') cur.volume = v;
      else if (tag === 'IS') cur.issue = v;
      else if (tag === 'SP') cur._sp = v;
      else if (tag === 'EP') cur._ep = v;
      else if (tag === 'PY' || tag === 'Y1' || tag === 'DA') {
        const d = /(\d{4})(?:[/-](\d{1,2}))?(?:[/-](\d{1,2}))?/.exec(v);
        if (d && (!cur.issued || tag === 'DA')) cur.issued = { 'date-parts': [[+d[1], ...(d[2] ? [+d[2]] : []), ...(d[3] ? [+d[3]] : [])]] };
      }
      else if (tag === 'PB') cur.publisher = v;
      else if (tag === 'CY') cur['publisher-place'] = v;
      else if (tag === 'DO') cur.DOI = cleanDoi(v);
      else if (tag === 'UR' && !cur.URL) cur.URL = v;
      else if (tag === 'SN') cur[/^\d{4}-?\d{3}[\dX]$/i.test(v) ? 'ISSN' : 'ISBN'] = v;
      else if (tag === 'AB' || tag === 'N2') cur.abstract = v;
      else if (tag === 'KW') cur._kw.push(v);
    }
    return { items, errors: [] };
  }

  // ---------------------------------------------------------------------
  // Any file or clipboard full of references
  // ---------------------------------------------------------------------
  function parseCslJson(text) {
    let data = JSON.parse(text);
    if (data && !Array.isArray(data)) data = data.items || [data];
    return { items: data.filter((x) => x && typeof x === 'object'), errors: [] };
  }

  // What kind of text is this? 'bibtex', 'ris', 'csl' or null
  function sniff(text) {
    const s = String(text || '').trim();
    if (/^[[{]/.test(s)) { try { JSON.parse(s); return 'csl'; } catch { /* not JSON */ } }
    if (/^TY {2}-/m.test(s)) return 'ris';
    if (/@\s*[A-Za-z]+\s*[{(]\s*[^,\s]+\s*,/.test(s)) return 'bibtex';
    return null;
  }

  function parseAny(text) {
    const kind = sniff(text);
    let out = { items: [], errors: [] };
    if (kind === 'csl') out = parseCslJson(text);
    else if (kind === 'ris') out = parseRis(text);
    else if (kind === 'bibtex') out = parseBibtex(text);
    out.kind = kind;
    return out;
  }

  // ---------------------------------------------------------------------
  // Identifiers in pasted text: DOIs and arXiv IDs
  // ---------------------------------------------------------------------
  function cleanDoi(s) {
    return String(s).trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '').replace(/[.,;]+$/, '');
  }
  function findIdentifier(s) {
    const text = String(s || '').trim();
    let m = /(?:doi\.org\/|doi:\s*)?(10\.\d{4,9}\/[^\s"<>]+)/i.exec(text);
    if (m) return { type: 'doi', id: cleanDoi(m[1]) };
    m = /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*)?\b(\d{4}\.\d{4,5})(v\d+)?\b/i.exec(text);
    if (m && (/arxiv/i.test(text) || /^\d{4}\.\d{4,5}(v\d+)?$/.test(text))) return { type: 'arxiv', id: m[1] };
    m = /arxiv\.org\/(?:abs|pdf)\/([a-z-]+(?:\.[A-Z]{2})?\/\d{7})/i.exec(text);
    if (m) return { type: 'arxiv', id: m[1] };
    return null;
  }
  // arXiv's DOIs are registered with DataCite, so one lookup serves both
  const identifierDoi = (ident) => (ident.type === 'arxiv' ? '10.48550/arXiv.' + ident.id : ident.id);

  // ---------------------------------------------------------------------
  // Keys, the library, and the @ picker
  // ---------------------------------------------------------------------
  const yearOf = (it) => {
    const d = it && it.issued;
    if (d && d['date-parts'] && d['date-parts'][0] && d['date-parts'][0][0]) return String(d['date-parts'][0][0]);
    if (d && d.raw) { const m = /\d{4}/.exec(d.raw); if (m) return m[0]; }
    if (d && d.literal) { const m = /\d{4}/.exec(d.literal); if (m) return m[0]; }
    return '';
  };
  const firstFamily = (it) => {
    const a = (it.author && it.author[0]) || (it.editor && it.editor[0]);
    return a ? (a.family || a.literal || '') : '';
  };
  const ascii = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/[øØ]/g, 'o').replace(/[æÆ]/g, 'ae').replace(/[łŁ]/g, 'l');
  const STOP = new Set(['a', 'an', 'the', 'on', 'of', 'in', 'for', 'and', 'to', 'with', 'from', 'at', 'by', 'is', 'are', 'how', 'what', 'why', 'when', 'do', 'does']);

  // smith2020neural, the way Better BibTeX names them; unique within taken
  function makeKey(item, taken = new Set()) {
    const family = ascii(firstFamily(item)).toLowerCase().replace(/[^a-z]/g, '') || 'anon';
    const year = yearOf(item) || 'nd';
    const word = ascii(item.title || '').toLowerCase().split(/[^a-z0-9]+/).find((w) => w && !STOP.has(w)) || '';
    const base = family + year + word;
    let key = base;
    for (let n = 0; taken.has(key); n++) key = base + String.fromCharCode(97 + (n % 26)) + (n >= 26 ? Math.floor(n / 26) : '');
    return key;
  }

  const normTitle = (s) => ascii(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const sameWork = (a, b) => (a.DOI && b.DOI ? a.DOI.toLowerCase() === b.DOI.toLowerCase()
    : !!a.title && normTitle(a.title) === normTitle(b.title) && yearOf(a) === yearOf(b));

  // a citation key: one word, nothing BibTeX or HTML would read as markup
  const KEY = /^[^\s,{}#%~\\"'@<>&]+$/;

  // Bring new items into the library. A work already there (same DOI, or
  // same title and year) is refreshed in place and keeps its key, so the
  // citations in the paper still find it. Returns the merged list, what
  // changed (a work already there and read again as it was is not
  // updated), and the key each incoming item has in the list, in order.
  function mergeReferences(library, incoming, { keepKeys = false } = {}) {
    const items = library.map((x) => ({ ...x }));
    const taken = new Set(items.map((x) => x.id));
    const added = [];
    const updated = [];
    const keys = [];
    for (const raw of incoming) {
      const it = { ...raw };
      if (it.id !== undefined && it.id !== null) it.id = String(it.id);
      const at = items.findIndex((x) => (keepKeys && it.id && x.id === it.id) || sameWork(x, it));
      if (at >= 0) {
        const id = items[at].id;
        const next = { ...items[at], ...it, id };
        if (!sameContent(items[at], next)) { items[at] = next; updated.push(id); }
        keys.push(id);
        continue;
      }
      if (!it.id || taken.has(it.id) || !KEY.test(it.id)) it.id = makeKey(it, taken);
      taken.add(it.id);
      items.push(it);
      added.push(it.id);
      keys.push(it.id);
    }
    return { items, added, updated, keys };
  }
  // the same fields and values, whatever order the keys came in
  const sorted = (v) => (Array.isArray(v) ? v.map(sorted)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
  const sameContent = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

  // references.json as this window is about to write it (mine), against the
  // file as it was last written here (saved) and as it is now (disk): a
  // reference another device added since comes in by key, so the write
  // doesn't lose it. One that's on disk and was in saved but not in mine
  // was deleted here, and stays deleted.
  function keepTheirs(saved, mine, disk) {
    if (!Array.isArray(disk)) return mine;
    const known = new Set([...(saved || []), ...mine].filter(Boolean).map((r) => String(r.id)));
    const theirs = disk.filter((r) => r && !known.has(String(r.id)));
    return theirs.length ? mergeReferences(mine, theirs, { keepKeys: true }).items : mine;
  }

  function authorsText(it) {
    const names = (it.author || it.editor || []).map((a) => a.family || a.literal || '').filter(Boolean);
    if (!names.length) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' & ' + names[1];
    return names[0] + ' et al.';
  }
  // "Smith et al. 2020", for lists and the picker
  const shortLabel = (it) => [authorsText(it) || (it.title || it.id), yearOf(it)].filter(Boolean).join(' ');

  // How well does a reference answer what was typed after @? 0 = not at all.
  // Every word typed must appear somewhere: a name, the year, the title, the
  // journal or the key.
  function score(it, query) {
    const q = ascii(query).toLowerCase().trim();
    if (!q) return 1;
    const names = (it.author || it.editor || []).map((a) => ascii(a.family || a.literal || '').toLowerCase());
    const title = ascii(it.title || '').toLowerCase();
    const hay = [it.id.toLowerCase(), names.join(' '), yearOf(it), title, ascii(it['container-title'] || '').toLowerCase()].join(' ');
    let total = 0;
    for (const word of q.split(/\s+/)) {
      if (!hay.includes(word)) return 0;
      if (it.id.toLowerCase().startsWith(word)) total += 6;
      if (names[0] && names[0].startsWith(word)) total += 5;
      else if (names.some((n) => n.startsWith(word))) total += 3;
      if (yearOf(it) === word) total += 3;
      if (new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(title)) total += 2;
      total += 1;
    }
    return total;
  }

  return {
    latexToUnicode, parseBibtex, parseRis, parseCslJson, parseAny, sniff, toBibtex,
    findIdentifier, identifierDoi, cleanDoi, makeKey, mergeReferences, keepTheirs, sameWork, KEY,
    yearOf, shortLabel, authorsText, score
  };
});
