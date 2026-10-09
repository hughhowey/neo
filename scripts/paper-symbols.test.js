'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const S = require('../paper/symbols.js');

test('\\name before the caret: only where a word starts, known or not', () => {
  assert.deepEqual(S.autocorrect('a \\mu'), { name: 'mu', from: 2 });
  assert.deepEqual(S.autocorrect('\\alpha'), { name: 'alpha', from: 0 });
  assert.deepEqual(S.autocorrect('(\\alpha'), { name: 'alpha', from: 1 });
  assert.deepEqual(S.autocorrect('“\\Vm'), { name: 'Vm', from: 1 });
  assert.deepEqual(S.autocorrect('so \\notacommand'), { name: 'notacommand', from: 3 }, 'the caller decides what it is');
  assert.equal(S.autocorrect('x\\mu'), null, 'not the start of a word');
  assert.equal(S.autocorrect('\\\\mu'), null, 'a TeX line break, then mu');
  assert.equal(S.autocorrect('a \\mu '), null);
  assert.equal(S.autocorrect('a \\'), null);
  assert.equal(S.autocorrect(''), null);
});

test('TeX names as characters, and characters back as TeX pdflatex can set', () => {
  assert.equal(S.charFor('mu'), 'μ');
  assert.equal(S.charFor('epsilon'), 'ϵ');
  assert.equal(S.charFor('varepsilon'), 'ε');
  assert.equal(S.charFor('phi'), 'ϕ');
  assert.equal(S.charFor('varphi'), 'φ');
  assert.equal(S.charFor('leq'), '≤');
  assert.equal(S.charFor('AA'), 'Å');
  assert.equal(S.charFor('Alpha'), null, 'no capital that is a Latin letter');
  assert.equal(S.charFor('constructor'), null);
  assert.equal(S.texText('μ'), '\\ensuremath{\\mu}');
  assert.equal(S.texText('µ'), '\\ensuremath{\\mu}', 'the micro sign too');
  assert.equal(S.texText('10°'), '10\\textdegree{}');
  assert.equal(S.texText('5‰, 3 Å, a†'), '5\\textperthousand{}, 3 \\AA{}, a\\dag{}');
  assert.equal(S.texText('x ≤ y ≠ z'), 'x \\ensuremath{\\leq} y \\ensuremath{\\neq} z', 'the first name for a character');
  assert.equal(S.texText('ε'), '\\ensuremath{\\varepsilon}');
  assert.equal(S.texText('√2'), '\\ensuremath{\\surd}2');
  assert.equal(S.texText('−65 mV'), '\\ensuremath{-}65\\,mV');
  assert.equal(S.texText('plain text, Ünïcode'), 'plain text, Ünïcode', 'what pdflatex sets is left alone');
  for (const [name, c] of Object.entries(S.TEX_CHARS)) {
    assert.match(name, /^[A-Za-z]+$/);
    assert.notEqual(S.texText(c), c, `${name}: ${c} becomes TeX`);
  }
});

test('a symbol’s name: letters only, not taken, not a LaTeX command', () => {
  assert.equal(S.validKey('Vm', []), '');
  assert.equal(S.validKey('tauE', [{ id: 'Vm' }]), '');
  assert.equal(S.validKey('V m', []), S.LETTERS_ONLY);
  assert.equal(S.validKey('V1', []), S.LETTERS_ONLY);
  assert.equal(S.validKey('', []), S.LETTERS_ONLY);
  assert.equal(S.validKey('a'.repeat(31), []), S.LETTERS_ONLY);
  assert.equal(S.validKey('Vm', [{ id: 'Vm' }]), S.TAKEN);
  assert.equal(S.validKey('Vm', ['gL', 'Vm']), S.TAKEN);
  assert.equal(S.validKey('mu', []), S.LATEX_COMMAND);
  assert.equal(S.validKey('section', []), S.LATEX_COMMAND);
  assert.equal(S.validKey('S', []), S.LATEX_COMMAND);
  assert.equal(S.validKey('frac', []), S.LATEX_COMMAND);
  assert.deepEqual([S.LETTERS_ONLY, S.TAKEN, S.LATEX_COMMAND], ['letters only', 'already a symbol', 'a LaTeX command']);
  assert.deepEqual(S.KINDS, ['parameter', 'variable']);
});

test('symbols sort as a nomenclature: Latin, then Greek in its order, lowercase first', () => {
  const tex = (list) => S.sortSymbols(list.map((t) => ({ tex: t }))).map((s) => s.tex);
  assert.deepEqual(tex(['V_\\mathrm{m}', 'a', '\\tau_m', '\\Delta t', 'A', '\\alpha']),
    ['a', 'A', 'V_\\mathrm{m}', '\\alpha', '\\Delta t', '\\tau_m']);
  assert.deepEqual(tex(['g_\\mathrm{L}', '\\hat{\\theta}', 'g_\\mathrm{E}', '\\partial', '\\mathbf{W}', '\\delta']),
    ['g_\\mathrm{E}', 'g_\\mathrm{L}', '\\mathbf{W}', '\\delta', '\\hat{\\theta}', '\\partial'], 'by the glyph set, then the rest; anything else last');
  assert.deepEqual(tex(['\\varepsilon', '\\beta', 'μ', '\\epsilon']), ['\\beta', '\\varepsilon', '\\epsilon', 'μ'], 'variants sort as their letter; stable');
  const list = [{ tex: 'b' }, { tex: 'a' }];
  S.sortSymbols(list);
  assert.equal(list[0].tex, 'b', 'a copy, sorted');
});

test('saving keeps the symbols another device added since, and not one deleted here', () => {
  const sym = (id) => ({ id, tex: id, meaning: '', unit: '', table: true, kind: '', value: '', cite: [] });
  const saved = [sym('a'), sym('b'), sym('c')];
  const mine = [sym('a'), sym('c'), sym('d')]; // b deleted here, d added here
  const disk = [sym('a'), sym('b'), sym('c'), sym('e')]; // e added over there
  assert.deepEqual(S.keepTheirs(saved, mine, disk).map((s) => s.id), ['a', 'c', 'd', 'e']);
  assert.equal(S.keepTheirs(saved, mine, saved), mine, 'nothing new there: the list as it was');
  assert.equal(S.keepTheirs(saved, mine, null), mine, 'a file that did not read as a list changes nothing');
  assert.deepEqual(S.keepTheirs([], [], [sym('x'), null, {}]).map((s) => s.id), ['x']);
});
