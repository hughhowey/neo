'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const E = require('../paper/editing.js');

const OBJ = '￼';
// each flag as [paragraph, rule, the text it covers, fix]
const flags = (paras, opts) => E.check(paras, opts).map((f) => [f.p, f.rule, paras[f.p].slice(f.start, f.end), f.fix]);
const of = (paras, rule, opts) => flags(paras, opts).filter((f) => f[1] === rule).map((f) => f.slice(2));
// what the paragraph reads once every fix is taken
const fixed = (s) => {
  let out = s;
  for (const f of E.check([s]).filter((x) => x.fix != null).reverse()) out = out.slice(0, f.start) + f.fix + out.slice(f.end);
  return out;
};

test('sentences: in order, end to end, abbreviations and objects kept inside', () => {
  const s = 'See Fig. 2 and e.g. the data of Smith et al. The end. 5 rats died! Then ' + OBJ + ' holds. No. 5 was it.  ';
  const got = E.sentences(s).map((x) => s.slice(x.start, x.end));
  assert.deepEqual(got, [
    'See Fig. 2 and e.g. the data of Smith et al. The end.',
    '5 rats died!',
    'Then ' + OBJ + ' holds.',
    'No. 5 was it.'
  ]);
  const t = '  One sentence. ' + OBJ + ' starts the next? “Quoted.” (Bracketed.) Done';
  const xs = E.sentences(t);
  assert.deepEqual(xs.map((x) => t.slice(x.start, x.end)), ['One sentence.', OBJ + ' starts the next?', '“Quoted.”', '(Bracketed.)', 'Done']);
  for (let i = 1; i < xs.length; i++) {
    assert.ok(xs[i].start >= xs[i - 1].end, 'no overlap');
    assert.match(t.slice(xs[i - 1].end, xs[i].start), /^\s+$/, 'only spaces between');
  }
  const u = 'p < 0.05 and 1.5 mm, i.e. Smith, approx. 5 cells, vs. Jones, cf. Eq. 3.';
  assert.deepEqual(E.sentences(u), [{ start: 0, end: u.length }]);
  assert.deepEqual(E.sentences(''), []);
  assert.deepEqual(E.sentences('   '), []);
});

test('filler: the short form, case kept at a sentence start', () => {
  assert.deepEqual(of(['In order to test it, we waited. We waited in order to see.'], 'filler'), [['In order to', 'To'], ['in order to', 'to']]);
  assert.equal(fixed('In order to test this we used a large number of cells.'), 'To test this we used many cells.');
  assert.equal(fixed('A majority of the cells and the vast majority of animals died.'), 'Most of the cells and most animals died.');
  assert.equal(fixed('Due to the fact that it rained, we utilized whether or not it helped prior to the test.'),
    'Because it rained, we used whether it helped before the test.');
  const [f] = E.check(['We left in order to eat.']);
  assert.equal(f.key, 'Filler: “{phrase}” says what “{short}” says.');
  assert.deepEqual(f.vars, { phrase: 'in order to', short: 'to' });
  assert.equal(f.note, 'Filler: “in order to” says what “to” says.');
});

test('filler: a phrase that says nothing goes, and the sentence still reads', () => {
  assert.equal(fixed('It is important to note that the effect held.'), 'The effect held.');
  assert.equal(fixed('Cells died. It should be noted that, in rats, they lived.'), 'Cells died. In rats, they lived.');
  assert.equal(fixed('Moreover, it is worth noting that the effect held.'), 'Moreover, the effect held.');
  assert.equal(fixed('It is important to note that ' + OBJ + ' holds.'), OBJ + ' holds.');
});

test('filler: "with respect to" in maths is left alone', () => {
  assert.deepEqual(of(['The derivative with respect to x is small.'], 'filler'), []);
  assert.deepEqual(of(['We differentiate the loss with respect to the weights.'], 'filler'), []);
  assert.deepEqual(of(['Take it with respect to ' + OBJ + ' and with respect to time.'], 'filler'), []);
  assert.deepEqual(of(['The derivative is zero. With respect to the controls, nothing changed.'], 'filler'), [['With respect to', 'About']]);
});

test('passive: be and a participle, one a sentence, no fix', () => {
  assert.deepEqual(of(['Results are shown in Fig. 2. The cells were carefully washed and then were dried.'], 'passive'),
    [['are shown', null], ['were carefully washed', null]]);
  assert.deepEqual(of(['The model is based on data.'], 'passive'), [['is based', null]]);
  const [f] = E.check(['It has been shown that cells divide.']);
  assert.equal(f.rule, 'passive');
  assert.equal(f.note, 'Passive: “It has been shown that” hides whose claim it is. Say who: “We show …”, or cite them.');
  for (const s of ['We are interested in it.', 'The effect is indeed small.', 'It is supposed to work.', 'The result is unchanged.',
    'The data are normally distributed.', 'This is red.', 'We show that cells divide.']) {
    assert.deepEqual(of([s], 'passive'), [], s);
  }
  // "it should be noted that" is filler, which has the fix, and the sentence's real passive is still found
  assert.deepEqual(flags(['It should be noted that the cells were fixed.']).map((f) => f[1]), ['filler', 'passive']);
});

test('comparison: a comparative with no basis in its sentence', () => {
  assert.deepEqual(of(['Our model performed better. It was more accurate. The response was larger.'], 'compare'),
    [['better', null], ['more accurate', null], ['larger', null]]);
  for (const s of [
    'Our model is better than theirs.', 'It was faster compared with the baseline.', 'Accuracy was higher relative to chance.',
    'There were more than five.', 'It is no more accurate.', 'The more data, the better the fit.', 'A lower bound holds.',
    'Higher-order terms vanish.', 'The superior colliculus fires.', 'We need more data.', 'It ran (faster on the second day) well.',
    'We sought to better understand it.', 'It was larger in mutants versus wild type.', 'It rose from 5 to 7 and was higher.',
    'Both were larger.', 'Responses were faster at higher temperatures.'
  ]) assert.deepEqual(of([s], 'compare'), [], s);
  assert.deepEqual(of(['The method is superior.'], 'compare'), [['superior', null]]);
});

test('long sentence: over 40 words, an object counting as one, kept around what wins inside it', () => {
  const words = (n) => Array.from({ length: n }, (_, i) => 'word' + i).join(' ');
  assert.deepEqual(of([words(40) + '.'], 'long'), []);
  const [f] = E.check([words(40) + ' ' + OBJ + '.']);
  assert.equal(f.rule, 'long');
  assert.deepEqual(f.vars, { n: 41 });
  assert.equal(f.note, 'Long sentence (41 words): commas first, then see whether two sentences are clearer.');
  const s = 'Short one. Then ' + words(20) + ' in order to ' + words(20) + '.';
  const got = flags([s]);
  assert.deepEqual(got.map((x) => x[1]), ['long', 'filler', 'long']);
  assert.equal(got[0][2], 'Then ' + words(20));
  assert.equal(got[2][2], words(20) + '.');
});

test('repeated word: fixed to one; "that that", "had had" and names left', () => {
  assert.deepEqual(of(['The the cell was in in the dish.'], 'repeat'), [['The the', 'The'], ['in in', 'in']]);
  assert.deepEqual(of(['He said that that was so, and she had had enough. Bora Bora is far. The ' + OBJ + ' the end.'], 'repeat'), []);
  assert.deepEqual(of(['the\nthe and the  the'], 'repeat'), [], 'one space only');
});

test('units: a space between a number and its unit', () => {
  assert.deepEqual(of(['It lasted 5ms at 10mV, 2.5µM and 1,000Hz; then 3 s.'], 'units'),
    [['5ms', '5 ms'], ['10mV', '10 mV'], ['2.5µM', '2.5 µM'], ['1,000Hz', '1,000 Hz']]);
  for (const s of ['H2O in 3D over 5G with L5 cells.', 'In the 1990s and 50s.', 'See Fig. 2g and Figs. 3h, 4m.', '1M parameters, 5A, 300K, 20%, 20°C.',
    '10 mV is fine.', 'CA1 and V1 and mp3.']) {
    assert.deepEqual(of([s], 'units'), [], s);
  }
});

test('range: an en dash between numbers, but not in names, dates or sums', () => {
  assert.deepEqual(of(['From 10-20 cells in 1990-2000, 5-10 ms and 0.5-1.5 mm.'], 'range'),
    [['10-20', '10–20'], ['1990-2000', '1990–2000'], ['5-10', '5–10'], ['0.5-1.5', '0.5–1.5']]);
  for (const s of ['COVID-19 and L2-5 and L2/3.', 'It fell to -5 and on 2020-01-15.', 'Call 555-123-4567.', 'Then x = 5-3 here.', 'A 2-3-fold rise.']) {
    assert.deepEqual(of([s], 'range'), [], s);
  }
});

test('acronyms: used early, defined twice, never used, never defined', () => {
  const paras = [
    'TMS works well.',
    'We used transcranial magnetic stimulation (TMS) on rats. TMS was safe.',
    'Transcranial magnetic stimulation (TMS) again, then long-term potentiation (LTP).',
    'The XYZ data and the ABC data were odd; ABC again.',
    'Volume II and DNA and CO2 and the BRCA1 gene, with electroencephalography (EEG) and EEG.'
  ];
  const got = E.check(paras).filter((f) => f.rule === 'acronym');
  assert.deepEqual(got.map((f) => [f.p, paras[f.p].slice(f.start, f.end), f.fix]), [
    [0, 'TMS', null],
    [2, 'Transcranial magnetic stimulation (TMS)', 'TMS'],
    [2, ' (LTP)', ''],
    [3, 'XYZ', null],
    [3, 'ABC', null]
  ]);
  assert.equal(got[0].note, '“TMS” is used here before it’s defined (in paragraph 2).');
  assert.equal(got[1].note, '“TMS” is defined already, in paragraph 2: the short form will do here.');
  assert.equal(got[2].note, '“LTP” is defined but never used again: the long form alone may read better.');
  assert.equal(got[3].note, '“XYZ” is never defined: spell it out the first time.');
  assert.deepEqual(got[3].vars, { acronym: 'XYZ' });
  // initials that don't match aren't a definition; a plural defines and uses the singular
  assert.deepEqual(of(['The results (ABC) held.', 'Convolutional neural networks (CNNs) work. A CNN is deep.'], 'acronym'), [['ABC', null]]);
});

test('one form throughout: hyphenation and British or American spelling', () => {
  const paras = ['A nonlinear fit, a nonlinear model and a Non-linear term.', 'The colour, the color and the color; modelling and modeling.'];
  const got = E.check(paras).filter((f) => f.rule === 'variant');
  assert.deepEqual(got.map((f) => [f.p, paras[f.p].slice(f.start, f.end), f.fix]), [
    [0, 'Non-linear', 'Nonlinear'],
    [1, 'colour', 'color'],
    [1, 'modeling', 'modelling']
  ]);
  assert.equal(got[0].note, 'One form throughout: “nonlinear” appears 2 times, “non-linear” 1.');
  assert.deepEqual(got[0].vars, { major: 'nonlinear', n: 2, minor: 'non-linear', m: 1 });
  assert.equal(got[2].vars.major, 'modelling', 'a tie: the later form is flagged');
  for (const s of ['We advise you to revise, otherwise exercise.', 'Recover and re-cover.', 'Well known and well-known.', 'Analyse it.']) {
    assert.deepEqual(of([s], 'variant'), [], s);
  }
});

test('numerals: a sentence that opens with one', () => {
  assert.deepEqual(of(['We used rats. 5 died on day 2. 3D printing helped.'], 'numbers'), [['5', null]]);
  assert.deepEqual(of(['5 rats died.'], 'numbers'), [], 'too short to judge');
  assert.deepEqual(of(['1. Then we went home.'], 'numbers'), [], 'a list number');
  assert.deepEqual(of(['5ms later the cells died.'], 'numbers'), [], 'the units fix wins');
});

test('objects: nothing matches inside or across one', () => {
  const s = 'in ' + OBJ + ' order to the ' + OBJ + ' the 5' + OBJ + 'ms and 10-' + OBJ + ' and is ' + OBJ + ' shown.';
  assert.deepEqual(E.check([s]), []);
  const t = 'In order to ' + OBJ + ', the the ' + OBJ + ' 10mV.';
  assert.deepEqual(flags([t]).map((f) => f[2]), ['In order to', 'the the', '10mV']);
});

test('overlaps: a fix wins, then the earlier rule', () => {
  // passive and comparison on one word: the earlier rule
  assert.deepEqual(flags(['The method was improved.']).map((f) => [f[1], f[2]]), [['passive', 'was improved']]);
  // filler (a fix) over the passive inside it
  assert.deepEqual(flags(['It should be noted that it fell.']).map((f) => f[1]), ['filler']);
  // a hyphen beside a unit isn't a range, and the unit is still fixed
  assert.deepEqual(flags(['We waited. 5-10ms later it fell.']).map((f) => [f[1], f[2]]), [['numbers', '5'], ['units', '10ms']]);
});

test('another language: only the rules that don\'t read the words', () => {
  const paras = ['In order to test it, results were shown to be better. Die die Katze 10mV, 5-10 ms, XYZ.'];
  assert.deepEqual([...new Set(flags(paras, { lang: 'de' }).map((f) => f[1]))].sort(), ['acronym', 'range', 'repeat', 'units']);
  assert.ok(flags(paras, { lang: 'en-GB' }).some((f) => f[1] === 'filler'));
});

test('names and templates for the window', () => {
  assert.equal(E.RULES.passive, 'Passive voice');
  assert.equal(Object.keys(E.RULES).length, 10);
  assert.ok(Object.isFrozen(E.TEMPLATES));
  const paras = ['In order to see it, it is important to note that results were shown. Ours was better. The the 5ms, 1-2.',
    'We used TMS. 10 rats died at once. A nonlinear and non-linear fit, colour and color. ' + Array(45).fill('word').join(' ') + '.'];
  for (const f of E.check(paras)) {
    assert.ok(E.TEMPLATES.includes(f.key), f.key);
    assert.equal(f.note, f.key.replace(/\{(\w+)\}/g, (m, k) => String(f.vars[k])));
    assert.ok(f.rule in E.RULES);
  }
});

test('a 10,000-word paper checks quickly', () => {
  const pool = [
    'In order to test the model, we recorded from 12 cells at 5ms intervals.',
    'The responses were shown to be larger, and it is important to note that the effect persisted for 10-20 trials.',
    'We used transcranial magnetic stimulation (TMS) and the TMS pulses were brief.',
    'A nonlinear fit to the data outperformed the linear model compared with the baseline.',
    'Neurons in layer 5 fire more frequently than those in layer 2/3 under the same conditions.',
    'The the colour of the stain was analysed with ' + OBJ + ' as described previously ' + OBJ + '.'
  ];
  const paras = [];
  let n = 0;
  for (let i = 0; n < 10000; i++) {
    const para = [];
    for (let k = 0; k < 6; k++) para.push(pool[(i * 7 + k * 3) % pool.length]);
    const s = para.join(' ');
    n += s.split(/\s+/).length;
    paras.push(s);
  }
  E.check(paras);
  const t0 = process.hrtime.bigint();
  const out = E.check(paras);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(out.length > 0);
  assert.ok(ms < 150, `${ms.toFixed(1)} ms`);
});
