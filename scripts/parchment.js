// Parchment's colors are Light's colors, warmed. Light writes many of its
// colors out (a white menu, a gray hint, a black shadow), so a page that
// builds on Light needs its own version of each. This writes them: every
// body.light rule that names a color, as a body.parchment rule with that
// color passed through warm(), into the block between the PARCHMENT
// COLORS markers in styles.css and pocket/www/pocket.css.
//
//   node scripts/parchment.js           rewrite the blocks
//   node scripts/parchment.js --check   only say whether they are current
//
// Run it after changing a body.light rule's color. scripts/parchment.test.js
// fails while a block is out of date.

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const FILES = ['styles.css', 'pocket/www/pocket.css'];
const BEGIN = '/* PARCHMENT COLORS: written by scripts/parchment.js from the body.light rules; run it again after changing one */';
const END = '/* END OF PARCHMENT COLORS */';

// How light a color looks (WCAG relative luminance), and contrast between
// two colors, which is the ratio of (luminance + 0.05).
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// Parchment's colors (its Low light theme), darkest to lightest: the
// warm line every gray of Light lands on.
const RAMP = ['#1e150a', '#3a2c1b', '#4a3a26', '#66523a', '#8a7454', '#cbb48b', '#dbc8a4', '#e6d5b3', '#efe1c4', '#f7eedb']
  .map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
// a color between a and b with this luminance (a darker than b)
function atLum(a, b, L) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (lum(mix(a, b, m)) < L) lo = m; else hi = m; }
  return mix(a, b, (lo + hi) / 2);
}

// Every Light color keeps its contrast with every other: each one's
// (luminance + 0.05) is scaled by the same amount, the one that takes
// Light's room (#efede8) to Parchment's room (#e6d5b3). So a hint is
// exactly as quiet against the room, a pane or a menu as it is in Light,
// and a border as faint. A gray goes onto Parchment's warm line at that
// luminance; a color (Light's gold, red, green) keeps its own hue, warmed,
// at that luminance. In every color the result has blue below red.
const LIGHT_ROOM = lum([0xef, 0xed, 0xe8]);
const K = (lum([0xe6, 0xd5, 0xb3]) + 0.05) / (LIGHT_ROOM + 0.05);
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
function warm(rgb) {
  // (a color darker than the room comes out 2% darker still, so rounding
  // to whole channels never leaves a hint fainter than Light's)
  const k = lum(rgb) < LIGHT_ROOM ? K * 0.98 : K;
  const L = Math.max(lum(RAMP[0]), Math.min(lum(RAMP[RAMP.length - 1]), k * (lum(rgb) + 0.05) - 0.05));
  const gray = Math.max(...rgb) - Math.min(...rgb) < 40; // grays and creams
  let out;
  if (gray) {
    let i = 0;
    while (i < RAMP.length - 2 && lum(RAMP[i + 1]) < L) i++;
    out = atLum(RAMP[i], RAMP[i + 1], L);
  } else {
    // the hue, with a little blue taken out and kept below red
    const [r, g, b] = rgb;
    const tinted = [r, g, Math.min(b * 0.8, r - 12)].map((v) => Math.max(0, v));
    out = lum(tinted) > L ? atLum(RAMP[0], tinted, L) : atLum(tinted, RAMP[RAMP.length - 1], L);
  }
  return out.map(clamp);
}
const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
function parseHex(h) {
  h = h.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
  return { rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)), alpha: h.length === 8 ? h.slice(6) : '' };
}
// every color written out in a value, warmed (var() and keywords stay)
const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+\s*)?\)/g;
function warmValue(value) {
  return value.replace(COLOR, (c) => {
    if (c[0] === '#') { const { rgb, alpha } = parseHex(c); return hex(warm(rgb)) + alpha; }
    const n = c.match(/[\d.]+/g).map(Number);
    const [r, g, b] = warm(n.slice(0, 3));
    return n.length > 3 ? `rgba(${r}, ${g}, ${b}, ${n[3]})` : `rgb(${r}, ${g}, ${b})`;
  });
}
const colorsIn = (value) => value.match(COLOR) || [];

// Rules Light leaves as they are because its page is Paper's page: the
// title page, the chapter head, the cards, the marks on the text. They
// are warmed the same way.
const PAGE = new Set([
  '::highlight(neo-search)', '::highlight(neo-search-current)', '::highlight(neo-speak)', '::highlight(neo-focus)',
  '::highlight(neo-spell)', '::highlight(neo-snap-gone)',
  'body.focus-mode .sheet ::selection',
  '#tp-subtitle', '#tp-author', '[contenteditable][data-ph]:empty::before', '.chapter-head', '.chapter-body p.scene-break',
  '.ph-mark', '#aux-paper h2', '.ol-text:focus', '.ob-text.excerpt', '.darlings-empty',
  '#outline-board', '.ob-cell:focus-visible .ob-card', '.ob-cell.open .ob-card', '.ob-float', '.ob-cell.ob-sel .ob-card',
  '#loose-list .ob-card', '.loose-add',
  '.darling', '.darling .d-meta', '.darling button', '.ns-card.ns-darling',
  '.script-tile .st-brad', '.script-tile .st-hole', '#paper.script #chapters', '.sp-geom > p[data-pg][data-fill]::before',
  '.snap-item:focus-visible', '.snap-band .snap-all', 'body.mac-bar #dragstrip'
]);
// ...and Brighter Interface's rules for Paper's and Light's page, which
// Night answers with its own: all of them
const BRIGHT = /^:where\(body\.bright\)/;
// the same selector for Parchment
function forParchment(sel) {
  if (/\bbody\.light\b/.test(sel)) return sel.replace(/\bbody\.light\b/g, 'body.parchment');
  if (sel.startsWith(':where(body.')) return sel.replace(/^:where\(body\.([\w-]+)\)/, 'body.parchment:where(.$1)');
  if (sel.startsWith('body.')) return sel.replace(/^body\./, 'body.parchment.');
  return 'body.parchment ' + sel;
}

// the body.parchment rules for one stylesheet's body.light rules (and the
// page rules above), in order
function parchmentRules(css) {
  const out = [];
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selectorText, body] of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = selectorText.split(',').map((s) => s.trim()).filter((s) => (/\bbody\.light\b/.test(s) && !/^html:has/.test(s)) || PAGE.has(s) || BRIGHT.test(s));
    if (!selectors.length) continue;
    // (Light's own tokens, on body.light alone, are Parchment's by hand)
    const tokens = selectors.every((sel) => sel === 'body.light');
    const decls = body.split(';').map((d) => d.trim()).filter((d) => d && !(tokens && d.startsWith('--')) && colorsIn(d.slice(d.indexOf(':') + 1)).length);
    if (!decls.length) continue;
    out.push(`${selectors.map(forParchment).join(', ')} { ${decls.map((d) => {
      const at = d.indexOf(':');
      return d.slice(0, at).trim() + ': ' + warmValue(d.slice(at + 1).trim());
    }).join('; ')}; }`);
  }
  return out;
}

// the stylesheet with its block written (or false when it has no markers)
function rewrite(css) {
  const a = css.indexOf(BEGIN);
  const b = css.indexOf(END);
  if (a < 0 || b < a) return false;
  const outside = css.slice(0, a) + css.slice(b + END.length);
  return css.slice(0, a) + BEGIN + '\n' + parchmentRules(outside).join('\n') + '\n' + css.slice(b);
}

module.exports = { PAGE, warm, warmValue, parchmentRules, rewrite, colorsIn, lum, contrast, FILES, BEGIN, END };

if (require.main === module) {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const f of FILES) {
    const file = path.join(root, f);
    const css = fs.readFileSync(file, 'utf8');
    const next = rewrite(css);
    if (next === false) { console.error(`${f}: no PARCHMENT COLORS block`); process.exitCode = 1; continue; }
    if (next === css) { console.log(`${f}: current`); continue; }
    stale++;
    if (check) console.log(`${f}: out of date (node scripts/parchment.js)`);
    else { fs.writeFileSync(file, next); console.log(`${f}: written`); }
  }
  if (check && stale) process.exitCode = 1;
}
