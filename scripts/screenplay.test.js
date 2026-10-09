'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// the screenplay rules from app.js, run on their own
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = app.indexOf('// ---- screenplay rules:');
const to = app.indexOf('// ---- end of screenplay rules ----');
const context = vm.createContext({});
vm.runInContext(app.slice(from, to), context);
vm.runInContext(`this.api = { SP_HEAD_RE, SP_AFTER, SP_EMPTY, spLooksLikeCharacter, spLooksLikeTransition,
  spParseHeading, spGhost, spContd, spPaginate, spEighths, spToFountain, spFromFountain, spFountainTitle,
  spRunsFromFountain, spFromFdx, spToFdx };`, context);
const sp = context.api;
const L = (type, text) => ({ type, text });
const plain = (x) => JSON.parse(JSON.stringify(x));

test('INT. and EXT. make a scene heading; a word that starts the same does not', () => {
  for (const s of ['INT. HOUSE', 'ext. beach - day', 'I/E CAR', 'INT./EXT. CAR', 'EST. CITY', 'int house']) assert.ok(sp.SP_HEAD_RE.test(s), s);
  for (const s of ['Interior lights flicker.', 'Internal memo', 'Extra! Extra!', 'Estelle walks in.']) assert.ok(!sp.SP_HEAD_RE.test(s), s);
});

test('a short line in capitals is a character; a shout or a sentence is not', () => {
  for (const s of ['KIM', 'VERNON (V.O.)', 'MRS. HANLON', 'DEPUTY #2', 'KIM (CONT\'D)']) assert.ok(sp.spLooksLikeCharacter(s), s);
  for (const s of ['BOOM!', 'FADE IN:', 'Kim walks in.', 'THE WHOLE BUILDING SHAKES AND THEN STOPS', '', '1984']) assert.ok(!sp.spLooksLikeCharacter(s), s);
  assert.ok(sp.spLooksLikeTransition('CUT TO:'));
  assert.ok(sp.spLooksLikeTransition('FADE OUT.'));
  assert.ok(sp.spLooksLikeTransition('Cut to:'), 'the usual ones as typed (NEO capitalizes the first word)');
  assert.ok(!sp.spLooksLikeTransition('He points to:'));
  assert.ok(!sp.spLooksLikeTransition('FADE IN:'));
});

test('Enter: after a name comes speech, after speech action; empty lines change what they are', () => {
  assert.equal(sp.SP_AFTER.character, 'dialogue');
  assert.equal(sp.SP_AFTER.dialogue, 'action');
  assert.equal(sp.SP_AFTER.heading, 'action');
  assert.equal(sp.SP_AFTER.transition, 'heading');
  // Enter twice after a speech: action, then the next speaker
  assert.equal(sp.SP_EMPTY.action, 'character');
  assert.equal(sp.SP_EMPTY.character, 'action');
});

test('the gray suggestion offers only names and places the script already has', () => {
  const s = [
    L('heading', 'EXT. LEEVILLE MARINA - NIGHT'), L('action', 'Fog.'),
    L('heading', 'INT. HARBOR OFFICE - CONTINUOUS'),
    L('character', 'KIM'), L('dialogue', 'Third night.'),
    L('character', 'VERNON'), L('dialogue', 'Fourth.'),
    L('character', 'KIM'), L('dialogue', 'Not on the chart.'),
    L('action', 'He looks at her.'),
    L('character', '')
  ];
  assert.equal(sp.spGhost(s, 10), 'VERNON', 'an empty name line offers whoever is being answered');
  s[10].text = 'k';
  assert.equal(sp.spGhost(s, 10), 'IM', 'lowercase typing still finds the name');
  s[10].text = 'KIM (V';
  assert.equal(sp.spGhost(s, 10), '.O.)');
  s.push(L('heading', 'INT. H'));
  assert.equal(sp.spGhost(s, 11), 'ARBOR OFFICE');
  s[11].text = 'int. harbor office - n';
  assert.equal(sp.spGhost(s, 11), 'IGHT');
  s[11].text = 'INT. HARBOR OFFICE - C';
  assert.equal(sp.spGhost(s, 11), 'ONTINUOUS');
  s[11].text = 'INT. Q';
  assert.equal(sp.spGhost(s, 11), '', 'nothing invented');
  s.push(L('transition', 'SM'));
  assert.equal(sp.spGhost(s, 12), 'ASH CUT TO:');
  assert.deepEqual(plain(sp.spParseHeading('INT. HARBOR OFFICE - NIGHT')), { prefix: 'INT.', loc: 'HARBOR OFFICE', time: 'NIGHT' });
});

test('(CONT\'D) when the same voice comes back after action, in the same scene', () => {
  const s = [L('character', 'KIM'), L('dialogue', 'One.'), L('action', 'She waits.'), L('character', 'Kim'), L('dialogue', 'Two.')];
  assert.equal(sp.spContd(s, 3), true);
  s[2] = L('character', 'VERNON');
  assert.equal(sp.spContd(s, 3), false, 'someone else spoke');
  assert.equal(sp.spContd([L('character', 'KIM'), L('dialogue', 'One.'), L('character', 'KIM')], 2), false, 'no action between');
  assert.equal(sp.spContd([L('character', 'KIM'), L('heading', 'INT. X'), L('action', 'a'), L('character', 'KIM')], 3), false, 'a new scene');
  assert.equal(sp.spContd([L('character', 'KIM'), L('action', 'a'), L('character', 'KIM (V.O.)')], 2), false, 'an extension of its own');
});

test('pages: 54 lines, a heading never alone at the foot, a speech kept with its speaker', () => {
  const lines = (type, n) => ({ type, lines: n });
  // 1 + 26×(1 blank + 1) = 53 lines; the 28th action needs 2 more
  const many = Array.from({ length: 40 }, () => lines('action', 1));
  const pg = sp.spPaginate(many);
  assert.equal(pg.pages, 2);
  assert.equal(pg.at.findIndex((a) => a.brk), 27);
  assert.equal(pg.at[27].fill, 1);
  assert.equal(pg.at[27].before, 0, 'no blank line at the top of a page');
  const h = [...Array.from({ length: 26 }, () => lines('action', 1)), lines('heading', 1), lines('action', 1)];
  assert.ok(sp.spPaginate(h).at[26].brk, 'the heading goes over with its scene');
  const d = [...Array.from({ length: 26 }, () => lines('action', 1)), lines('character', 1), lines('dialogue', 1), lines('dialogue', 1)];
  assert.ok(sp.spPaginate(d).at[26].brk, 'the speech goes over with its speaker');
  const long = [lines('action', 120), lines('action', 1)];
  assert.equal(sp.spPaginate(long).pages, 3, 'a paragraph longer than a page runs on');
  const two = sp.spPaginate([lines('heading', 1), lines('action', 1), lines('heading', 1), lines('action', 1)]);
  assert.deepEqual(two.at.map((a) => a.before), [0, 1, 2, 1], 'two blank lines above a scene heading, none at the top');
  assert.equal(sp.spEighths(54), 8);
  assert.equal(sp.spEighths(7), 1);
});

test('Fountain out: forced where Fountain would misread a line', () => {
  const out = sp.spToFountain([
    L('heading', 'int. kitchen - day'), L('action', 'KIM ENTERS'), L('character', 'kim'), L('paren', '(quietly)'),
    L('dialogue', 'Hi.'), L('transition', 'cut to:'), L('heading', 'FLASHBACK'), L('transition', 'BACK TO PRESENT'), L('shot', 'close on the bell')
  ], { title: 'No Wind', credit: 'Written by', author: 'Hugh Howey', contact: 'A\nB' });
  assert.equal(out, [
    'Title: No Wind', 'Credit: Written by', 'Author: Hugh Howey', 'Contact:', '    A', '    B', '',
    'INT. KITCHEN - DAY', '', '!KIM ENTERS', '', 'KIM', '(quietly)', 'Hi.', '', 'CUT TO:', '', '.FLASHBACK', '', '>BACK TO PRESENT', '', '!CLOSE ON THE BELL', ''
  ].join('\n'));
});

test('Fountain in: a pasted script comes back as its elements', () => {
  const src = [
    'Title: No Wind', 'Author: Hugh Howey', '',
    'EXT. MARINA - NIGHT', '', 'Fog. A bell rings.', '', 'KIM', '(quietly)', 'Three nights.', '',
    'VERNON ^', 'Four.', '', 'CUT TO:', '', '.FLASHBACK', '', '!LOUD NOISE', '', '[[a note]]', '/* gone */', '# Act One', '= synopsis', '===', '@McCLANE', 'Yippee.'
  ].join('\n');
  assert.deepEqual(plain(sp.spFromFountain(src)), [
    L('heading', 'EXT. MARINA - NIGHT'), L('action', 'Fog. A bell rings.'), L('character', 'KIM'), L('paren', '(quietly)'),
    L('dialogue', 'Three nights.'), L('character', 'VERNON'), L('dialogue', 'Four.'), L('transition', 'CUT TO:'),
    L('heading', 'FLASHBACK'), L('action', 'LOUD NOISE'), { ...L('character', 'McCLANE'), newPage: true }, L('dialogue', 'Yippee.')
  ]);
});

test('page breaks: === in Fountain, StartsNewPage in Final Draft, and a new page in the layout', () => {
  const lines = sp.spFromFountain(['INT. A - DAY', '', 'One.', '', '===', '', 'INT. B - DAY', '', 'Two.'].join('\n'));
  assert.equal(lines[2].newPage, true);
  const out = sp.spToFountain(lines);
  assert.match(out, /One\.\n\n===\n\nINT\. B - DAY/);
  const fdx = sp.spToFdx(lines.map((l) => ({ ...l, runs: [{ text: l.text }] })));
  assert.match(fdx, /<Paragraph Type="Scene Heading" StartsNewPage="Yes">\n\s*<Text>INT\. B - DAY/);
  assert.equal(sp.spFromFdx(fdx).lines[2].newPage, true);
  const pg = sp.spPaginate([{ type: 'heading', lines: 1 }, { type: 'action', lines: 1 }, { type: 'heading', lines: 1, newPage: true }, { type: 'action', lines: 1 }]);
  assert.deepEqual(pg.at.map((a) => a.page), [1, 1, 2, 2]);
});

test('Fountain in: a block\'s lines run on into one paragraph; a PDF\'s page furniture stays out', () => {
  const src = [
    'INT. HARBOR OFFICE - DAWN', '',
    'Gray light. Vernon asleep in his', 'chair. The chain still on the desk.', '',
    '2.', '',
    'KIM (CONT\'D)', 'We should call somebody. The', 'Coast Guard.', '(MORE)', '',
    'CONTINUED:'
  ].join('\n');
  assert.deepEqual(plain(sp.spFromFountain(src)), [
    L('heading', 'INT. HARBOR OFFICE - DAWN'),
    L('action', 'Gray light. Vernon asleep in his chair. The chain still on the desk.'),
    L('character', 'KIM'),
    L('dialogue', 'We should call somebody. The Coast Guard.')
  ]);
});

test('Fountain\'s title page and emphasis', () => {
  const src = 'Title:\n    _**NO WIND**_\nCredit: Written by\nAuthor: Hugh Howey\nDraft date: First Draft\nContact:\n    Kristin Nelson\n    Nelson Literary Agency\n\nEXT. A - DAY';
  assert.deepEqual(plain(sp.spFountainTitle(src)), { title: 'NO WIND', titleStyle: { b: true, u: true }, credit: 'Written by', author: 'Hugh Howey', draft: 'First Draft', contact: 'Kristin Nelson\nNelson Literary Agency' });
  assert.deepEqual(plain(sp.spFountainTitle('EXT. A - DAY')), {});
  const r = (t) => plain(sp.spRunsFromFountain(t)).map((x) => (x.b ? 'B' : '') + (x.i ? 'I' : '') + (x.u ? 'U' : '') + ':' + x.text);
  assert.deepEqual(r('He *really* means it.'), [':He ', 'I:really', ': means it.']);
  assert.deepEqual(r('**Bold** and ***both*** and _under_'), ['B:Bold', ': and ', 'BI:both', ': and ', 'U:under']);
  assert.deepEqual(r('2 * 3 = 6 and snake_case'), [':2 * 3 = 6 and snake_case']);
  assert.deepEqual(r('\\*not italic\\*'), [':*not italic*']);
});

test('Final Draft in: a file screenplain wrote reads the same as the Fountain it came from', () => {
  const fdx = fs.readFileSync(path.join(__dirname, 'fixtures', 'screenplain.fdx'), 'utf8');
  const fountain = fs.readFileSync(path.join(__dirname, 'fixtures', 'screenplain.fountain'), 'utf8');
  const fromFdx = plain(sp.spFromFdx(fdx).lines).map((l) => L(l.type, l.runs.map((x) => x.text).join('')));
  assert.deepEqual(fromFdx, plain(sp.spFromFountain(fountain)));
});

test('Final Draft in: styles, dual dialogue, a title page, (CONT\'D) off the name', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
    <Paragraph Type="Scene Heading" Number="1"><SceneProperties Length="1/8"/><Text>INT. GALLEY - NIGHT</Text></Paragraph>
    <Paragraph Type="Action"><Text>The bell </Text><Text Style="Bold+Italic">rings</Text><Text> &amp; stops.</Text></Paragraph>
    <Paragraph Type="Action"><Text></Text></Paragraph>
    <Paragraph><DualDialogue>
      <Paragraph Type="Character"><Text>KIM (CONT'D)</Text></Paragraph>
      <Paragraph Type="Dialogue"><Text>Now.</Text></Paragraph>
      <Paragraph Type="Character"><Text>VERNON</Text></Paragraph>
      <Paragraph Type="Parenthetical"><Text>quietly</Text></Paragraph>
      <Paragraph Type="Dialogue"><Text>Now.</Text></Paragraph>
    </DualDialogue></Paragraph>
    <Paragraph Type="General"><Text>THE END</Text></Paragraph>
  </Content>
  <TitlePage><Content>
    <Paragraph Alignment="Center"><Text>NO WIND</Text></Paragraph>
    <Paragraph Alignment="Center"><Text>Written by</Text></Paragraph>
    <Paragraph Alignment="Center"><Text>Hugh Howey</Text></Paragraph>
    <Paragraph Alignment="Left"><Text>Nelson Literary</Text></Paragraph>
    <Paragraph Alignment="Right"><Text>Draft 2</Text></Paragraph>
  </Content></TitlePage>
</FinalDraft>`;
  const { lines, title } = plain(sp.spFromFdx(xml));
  assert.deepEqual(lines.map((l) => l.type + ':' + l.runs.map((x) => x.text).join('')), [
    'heading:INT. GALLEY - NIGHT', 'action:The bell rings & stops.', 'character:KIM', 'dialogue:Now.',
    'character:VERNON', 'paren:(quietly)', 'dialogue:Now.', 'action:THE END'
  ]);
  assert.equal(lines[1].runs[1].b && lines[1].runs[1].i, true);
  assert.deepEqual(title, { title: 'NO WIND', credit: 'Written by', author: 'Hugh Howey', contact: 'Nelson Literary', draft: 'Draft 2' });
});

test('Final Draft out, then in again: the same script', () => {
  const run = (text, extra = {}) => ({ text, b: false, i: false, u: false, s: false, ...extra });
  const lines = [
    { type: 'heading', runs: [run('int. galley - night')] },
    { type: 'action', runs: [run('The bell '), run('rings', { i: true }), run(' <loud> & "clear".')] },
    { type: 'character', runs: [run('Kim')] },
    { type: 'paren', runs: [run('(quietly)')] },
    { type: 'dialogue', runs: [run('Now.')] },
    { type: 'transition', runs: [run('cut to:')] },
    { type: 'shot', runs: [run('close on the bell')] }
  ];
  const tp = { title: 'No Wind', credit: 'Written by', author: 'Hugh Howey', draft: 'First Draft', contact: 'Nelson Literary\nDenver' };
  const xml = sp.spToFdx(lines, tp);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8" standalone="no" \?>\n<FinalDraft DocumentType="Script"/);
  assert.match(xml, /<Text Style="Italic">rings<\/Text>/);
  assert.match(xml, /&lt;loud&gt; &amp; &quot;clear&quot;/);
  const back = plain(sp.spFromFdx(xml));
  assert.deepEqual(back.lines.map((l) => l.type + ':' + l.runs.map((x) => x.text).join('')), [
    'heading:INT. GALLEY - NIGHT', 'action:The bell rings <loud> & "clear".', 'character:KIM', 'paren:(quietly)',
    'dialogue:Now.', 'transition:CUT TO:', 'shot:CLOSE ON THE BELL'
  ]);
  assert.deepEqual(back.title, { ...tp, title: 'NO WIND' });
});

test('a bold, underlined title travels through Fountain and Final Draft and comes back', () => {
  const tp = { title: 'No Wind', titleStyle: { b: true, u: true }, credit: 'Written by', author: 'Hugh Howey' };
  const lines = [{ type: 'heading', text: 'EXT. DOCK - DAY', runs: [{ text: 'EXT. DOCK - DAY' }] }];
  const ftn = sp.spToFountain(lines, tp);
  assert.match(ftn, /^Title: _\*\*No Wind\*\*_$/m);
  assert.deepEqual(plain(sp.spFountainTitle(ftn)).titleStyle, { b: true, u: true });
  assert.equal(sp.spFountainTitle(ftn).title, 'No Wind');
  const xml = sp.spToFdx(lines, tp);
  assert.match(xml, /<Text Style="Bold\+Underline">NO WIND<\/Text>/);
  assert.deepEqual(plain(sp.spFromFdx(xml).title.titleStyle), { b: true, u: true });
  // a plain title stays plain, and a mark in the title stays a mark
  assert.match(sp.spToFountain(lines, { title: 'A*B' }), /^Title: A\*B$/m);
  assert.match(sp.spToFountain(lines, { title: 'A*B', titleStyle: { i: true } }), /^Title: \*A\\\*B\*$/m);
  assert.equal(sp.spFountainTitle(sp.spToFountain(lines, { title: 'Plain' })).titleStyle, undefined);
});
