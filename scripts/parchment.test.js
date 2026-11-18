'use strict';

// Parchment's colors (View → Page → Parchment) are Light's colors warmed by
// scripts/parchment.js. These hold the rule that defines the page, blue
// below red in every color and no pure white, and its promise that every
// hint is as clear as it is in Light; and they fail while the written block
// is behind a change to Light (run node scripts/parchment.js).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { warm, rewrite, colorsIn, contrast, lum, FILES, BEGIN, END } = require('./parchment.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const rgbOf = (c) => {
  if (c[0] === '#') {
    let h = c.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  return c.match(/[\d.]+/g).slice(0, 3).map(Number);
};
// the Parchment section of a stylesheet: from its header to the end
const parchmentPart = (css) => css.slice(css.indexOf('body.parchment'));
const colorsOfParchment = (css) => {
  const out = [];
  for (const [, sel, body] of parchmentPart(css).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/body\.parchment/.test(sel)) out.push(...colorsIn(body).map((c) => [sel.trim(), c]));
  }
  return out;
};

test('the written Parchment colors are current with the Light rules', () => {
  for (const f of FILES) {
    const css = read(f);
    assert.ok(css.includes(BEGIN) && css.includes(END), `${f} has its PARCHMENT COLORS block`);
    assert.equal(rewrite(css), css, `${f}: run node scripts/parchment.js`);
  }
});

test('every Parchment color keeps blue below red, and none is pure white', () => {
  for (const f of FILES) {
    for (const [sel, c] of colorsOfParchment(read(f))) {
      const [r, , b] = rgbOf(c);
      assert.ok(b < r, `${f}: ${sel} has ${c}, blue not below red`);
      assert.ok(!(r === 255 && rgbOf(c)[1] === 255 && b === 255), `${f}: ${sel} is pure white`);
    }
  }
});

test('Light\'s room becomes Parchment\'s room, and Light\'s white a cream', () => {
  assert.deepEqual(warm([0xef, 0xed, 0xe8]), [0xe6, 0xd5, 0xb3]);
  const cream = warm([255, 255, 255]);
  assert.ok(cream[2] < cream[0] && cream[0] < 255, `white became ${cream}`);
});

test('every Light color keeps its contrast with the room, a hint never fainter', () => {
  const lightRoom = [0xef, 0xed, 0xe8];
  const room = [0xe6, 0xd5, 0xb3];
  const colors = new Set();
  for (const f of FILES) {
    for (const [, sel, body] of read(f).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/body\.light/.test(sel)) for (const c of colorsIn(body)) colors.add(c);
    }
  }
  assert.ok(colors.size > 50, 'Light names its colors');
  for (const c of colors) {
    const before = rgbOf(c);
    const after = warm(before);
    const was = contrast(before, lightRoom);
    const now = contrast(after, room);
    // darker than the room: as clear or clearer, up to what Parchment's
    // darkest brown allows; lighter: the same within rounding
    if (lum(before) < lum(lightRoom)) assert.ok(now >= Math.min(was, 12.4) - 0.005, `${c}: ${was.toFixed(2)} in Light, ${now.toFixed(2)} in Parchment`);
    else assert.ok(Math.abs(now - was) < 0.02, `${c}: ${was.toFixed(2)} in Light, ${now.toFixed(2)} in Parchment`);
  }
});
