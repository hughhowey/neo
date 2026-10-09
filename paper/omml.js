// NEO — maths for Word
//
// Word's equations are OMML (Office Math Markup), not pictures: in a .docx
// they can be edited in Word like any equation typed there. MathJax turns
// a paper's TeX into MathML; this turns that MathML into OMML. It covers
// what papers use (fractions, scripts, roots, sums and integrals with
// limits, accents, matrices and aligned rows, fences) and returns null for
// anything it can't do, so the export can fall back to a picture.
// window.NeoOmml in the editor; require()d by paper/export.js in node.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports && !root.document) module.exports = api;
  else root.NeoOmml = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- a small XML reader: MathJax's MathML is regular, so this is enough
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const decode = (s) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#'
    ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1))
    : ENT[e] !== undefined ? ENT[e] : m));
  function parse(xml) {
    const rootNode = { name: '#root', attrs: {}, kids: [] };
    const stack = [rootNode];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(xml))) {
      if (m[5] !== undefined) {
        if (m[5].trim() || stack[stack.length - 1].name === 'mtext') stack[stack.length - 1].kids.push({ text: decode(m[5]) });
        continue;
      }
      if (!m[2]) continue;
      const name = m[2].replace(/^\w+:/, '');
      if (m[1]) {
        while (stack.length > 1 && stack.pop().name !== name) { /* close to the match */ }
        continue;
      }
      const attrs = {};
      m[3].replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (a, k, v1, v2) => { attrs[k.replace(/^\w+:/, '')] = decode(v1 !== undefined ? v1 : v2); });
      const node = { name, attrs, kids: [] };
      stack[stack.length - 1].kids.push(node);
      if (!m[4]) stack.push(node);
    }
    return rootNode;
  }

  // ---- MathML → OMML
  const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const textOf = (n) => (n.text !== undefined ? n.text : n.kids.map(textOf).join(''));
  const els = (n) => n.kids.filter((k) => k.name);
  const NARY = new Set(['∑', '∏', '∐', '∫', '∬', '∭', '∮', '⋃', '⋂', '⋁', '⋀', '⨁', '⨂']);
  class Unsupported extends Error {}

  function run(text, { plain = false, bold = false } = {}) {
    if (!text) return '';
    const sty = bold ? (plain ? 'b' : 'bi') : plain ? 'p' : '';
    return `<m:r>${sty ? `<m:rPr><m:sty m:val="${sty}"/></m:rPr>` : ''}<m:t xml:space="preserve">${xml(text)}</m:t></m:r>`;
  }
  // the operator a node is, if it's a big one (∑, ∫…)
  const naryChar = (n) => {
    if (!n || !n.name) return null;
    if (n.name === 'mo' && NARY.has(textOf(n).trim())) return textOf(n).trim();
    if ((n.name === 'mrow' || n.name === 'mstyle' || n.name === 'TeXAtom') && els(n).length === 1) return naryChar(els(n)[0]);
    return null;
  };
  const arg = (n) => (n ? conv(n) : '');
  const e = (inner) => `<m:e>${inner}</m:e>`;

  // a row: a big operator takes the rest of the row as what it acts on
  function row(kids) {
    let out = '';
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      const chr = bigOp(k);
      if (chr) {
        out += nary(k, chr, row(kids.slice(i + 1)));
        return out;
      }
      out += conv(k);
    }
    return out;
  }
  // ∑ with limits, as msubsup/munderover/msub/msup/munder/mover over the operator
  function bigOp(n) {
    if (!n || !n.name) return null;
    if (['msubsup', 'munderover', 'msub', 'msup', 'munder', 'mover'].includes(n.name)) return naryChar(els(n)[0]);
    return naryChar(n);
  }
  function nary(n, chr, body) {
    const k = els(n);
    let sub = '';
    let sup = '';
    let under = false;
    if (n.name === 'msubsup' || n.name === 'munderover') { sub = arg(k[1]); sup = arg(k[2]); under = n.name === 'munderover'; }
    else if (n.name === 'msub' || n.name === 'munder') { sub = arg(k[1]); under = n.name === 'munder'; }
    else if (n.name === 'msup' || n.name === 'mover') { sup = arg(k[1]); under = n.name === 'mover'; }
    const integral = /[∫∬∭∮]/.test(chr);
    const pr = `<m:naryPr><m:chr m:val="${xml(chr)}"/><m:limLoc m:val="${under && !integral ? 'undOvr' : 'subSup'}"/>${sub ? '' : '<m:subHide m:val="1"/>'}${sup ? '' : '<m:supHide m:val="1"/>'}</m:naryPr>`;
    return `<m:nary>${pr}<m:sub>${sub}</m:sub><m:sup>${sup}</m:sup>${e(body)}</m:nary>`;
  }
  const ACCENTS = new Set(['^', 'ˆ', '~', '˜', '¯', '‾', '→', '⃗', '˙', '¨', '´', '`', 'ˇ', '˘', '̂', '̃', '̄', '̇', '̈']);
  const accentChar = (c) => ({ '^': '̂', 'ˆ': '̂', '~': '̃', '˜': '̃', '¯': '̅', '‾': '̅', '→': '⃗', '⃗': '⃗', '˙': '̇', '¨': '̈', '´': '́', '`': '̀', 'ˇ': '̌', '˘': '̆' }[c] || c);

  function conv(n) {
    if (n.text !== undefined) return run(n.text);
    const k = els(n);
    switch (n.name) {
      case 'math': case 'mrow': case 'mstyle': case 'mpadded': case 'TeXAtom': case 'menclose': case 'merror': case 'mfenced':
        return row(k);
      case 'semantics': return k.length ? conv(k[0]) : '';
      case 'annotation': case 'annotation-xml': case 'mphantom': case 'none': case 'mprescripts': return '';
      case 'mspace': return +String(n.attrs.width || '').replace(/[^\d.]/g, '') > 0.2 ? run(' ', { plain: true }) : '';
      case 'mi': {
        const t = textOf(n);
        const v = n.attrs.mathvariant;
        // a single letter is set italic; a word (sin, log) and mathvariant="normal" upright
        return run(t, { plain: v === 'normal' || (t.length > 1 && v !== 'italic') || v === 'bold', bold: /bold/.test(v || '') });
      }
      case 'mn': return run(textOf(n), { plain: true, bold: /bold/.test(n.attrs.mathvariant || '') });
      case 'mo': return run(textOf(n), { plain: true });
      case 'mtext': case 'ms': return run(textOf(n), { plain: true });
      case 'msup': return `<m:sSup>${e(arg(k[0]))}<m:sup>${arg(k[1])}</m:sup></m:sSup>`;
      case 'msub': return `<m:sSub>${e(arg(k[0]))}<m:sub>${arg(k[1])}</m:sub></m:sSub>`;
      case 'msubsup': return `<m:sSubSup>${e(arg(k[0]))}<m:sub>${arg(k[1])}</m:sub><m:sup>${arg(k[2])}</m:sup></m:sSubSup>`;
      case 'mfrac': {
        const bar = n.attrs.linethickness === '0' || n.attrs.linethickness === '0px';
        return `<m:f>${bar ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : ''}<m:num>${arg(k[0])}</m:num><m:den>${arg(k[1])}</m:den></m:f>`;
      }
      case 'msqrt': return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${e(row(k))}</m:rad>`;
      case 'mroot': return `<m:rad><m:deg>${arg(k[1])}</m:deg>${e(arg(k[0]))}</m:rad>`;
      case 'mover': case 'munder': case 'munderover': {
        const over = n.name === 'mover' ? k[1] : n.name === 'munderover' ? k[2] : null;
        const under = n.name === 'munder' || n.name === 'munderover' ? k[1] : null;
        const overText = over ? textOf(over).trim() : '';
        if (over && !under && over.name === 'mo' && (n.attrs.accent === 'true' || ACCENTS.has(overText))) {
          return `<m:acc><m:accPr><m:chr m:val="${xml(accentChar(overText))}"/></m:accPr>${e(arg(k[0]))}</m:acc>`;
        }
        let out = arg(k[0]);
        if (under) out = `<m:limLow>${e(out)}<m:lim>${arg(under)}</m:lim></m:limLow>`;
        if (over) out = `<m:limUpp>${e(out)}<m:lim>${arg(over)}</m:lim></m:limUpp>`;
        return out;
      }
      case 'mtable': {
        const rows = k.filter((r) => r.name === 'mtr' || r.name === 'mlabeledtr');
        const cols = Math.max(1, ...rows.map((r) => els(r).filter((c) => c.name === 'mtd').length));
        return `<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${cols}"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs></m:mPr>`
          + rows.map((r) => `<m:mr>${els(r).filter((c) => c.name === 'mtd').map((c) => e(row(els(c).length ? els(c) : c.kids))).join('')}</m:mr>`).join('') + '</m:m>';
      }
      case 'mtr': case 'mlabeledtr': case 'mtd': return row(k);
      case 'mmultiscripts': {
        // base with scripts after it; the ones before (prescripts) are left out
        const parts = k.slice(1);
        const cut = parts.findIndex((p) => p.name === 'mprescripts');
        const post = cut < 0 ? parts : parts.slice(0, cut);
        return `<m:sSubSup>${e(arg(k[0]))}<m:sub>${arg(post[0])}</m:sub><m:sup>${arg(post[1])}</m:sup></m:sSubSup>`;
      }
      default:
        throw new Unsupported(n.name);
    }
  }

  // MathML → <m:oMath>…</m:oMath>, or null if anything in it can't be done
  function fromMathml(mathml) {
    try {
      const doc = parse(String(mathml));
      const math = els(doc)[0];
      if (!math) return null;
      const inner = conv(math);
      return inner ? `<m:oMath>${inner}</m:oMath>` : null;
    } catch {
      return null;
    }
  }

  return { fromMathml, parse };
});
