'use strict';

// Standard manuscript format (manuscript.js), without a window: the word
// count's rounding, the header's surname, the .docx's parts (well formed,
// the title page its own section with no header, the story numbered from 1
// under "Surname / TITLE / page"; a short story in one section with the
// header from page 2) and the PDF's HTML (the header in the page's margin
// box, none on the title page). The pages themselves are looked at in
// manuscript.e2e.js.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const M = require('../manuscript.js');

const para = (text, o = {}) => ({ runs: [{ text }], ...o });
const model = (o = {}) => ({
  title: 'The Curse', byline: 'Mary Ann Evans', headerName: 'Evans', headerTitle: 'THE CURSE',
  contact: { name: 'Mary Ann Evans', lines: ['123 Main Street', 'Springfield, IL 62701', 'mary@example.com'] },
  wordsText: 'about 90,000 words', byText: 'by Mary Ann Evans', endText: 'END', font: 'times', paper: 'Letter', lang: 'en-US', short: false,
  sections: [
    { kind: 'chapter', heading: 'Chapter 1 — The Harbor', paras: [{ runs: [{ text: 'She came back to the ' }, { text: 'old', i: true }, { text: ' house & the <sea>.' }] }, { sceneBreak: true }, para('After.', { flush: true })] },
    { kind: 'part', heading: 'Part Two', partTitle: 'The Fall', paras: [] },
    { kind: 'chapter', heading: 'Chapter 2', paras: [para('Verse.', { poetry: true }), para('Centered.', { align: 'center' })] }
  ],
  ...o
});
const part = (entries, path) => entries.find((e) => e.path === path).content;
// every tag opened is closed, in order (enough to catch a broken part)
function wellFormed(xml) {
  const stack = [];
  const body = xml.replace(/^<\?xml[^>]*\?>/, '');
  for (const m of body.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) { assert.equal(stack.pop(), m[2], 'closes what it opened'); } else stack.push(m[2]);
  }
  assert.deepEqual(stack, [], 'nothing left open');
  assert.ok(!/[<>](?![/\w?!])/.test(body.replace(/<[^>]*>/g, '')), 'no stray brackets in the text');
}

test('the word count, rounded the way manuscripts give it', () => {
  assert.equal(M.roundWords(89612), 90000);
  assert.equal(M.roundWords(10499), 10000);
  assert.equal(M.roundWords(9950), 10000);
  assert.equal(M.roundWords(4321), 4300);
  assert.equal(M.roundWords(149), 100);
  assert.equal(M.roundWords(60), 60);
  assert.equal(M.roundWords(-5), 0);
  assert.equal(M.roundWords('x'), 0);
});

test('the surname for the header', () => {
  assert.equal(M.surnameOf('Mary Ann Evans'), 'Evans');
  assert.equal(M.surnameOf('  Ursula K. Le Guin '), 'Guin');
  assert.equal(M.surnameOf('Martin Luther King, Jr.'), 'King');
  assert.equal(M.surnameOf('John Smith III'), 'Smith');
  assert.equal(M.surnameOf('Cher'), 'Cher');
  assert.equal(M.surnameOf('Jane Doe (pen name)'), 'Doe');
  assert.equal(M.surnameOf(''), '');
  assert.equal(M.headerText(model()), 'Evans / THE CURSE / ');
  assert.equal(M.headerText(model({ headerName: '' })), 'THE CURSE / ');
});

test('a novel\'s .docx: well formed, the title page its own section, the story numbered from 1', () => {
  const e = M.docxEntries(model());
  assert.deepEqual(e.map((x) => x.path), ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml', 'word/settings.xml', 'word/header1.xml']);
  assert.ok(part(e, 'word/settings.xml').includes('w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"'), 'not Compatibility Mode');
  for (const x of e) wellFormed(x.content);
  const doc = part(e, 'word/document.xml');
  // two sections: the title page's (no header), then the story's
  const sects = [...doc.matchAll(/<w:sectPr>[\s\S]*?<\/w:sectPr>/g)].map((x) => x[0]);
  assert.equal(sects.length, 2);
  assert.ok(!sects[0].includes('headerReference'));
  assert.ok(sects[1].includes('<w:headerReference w:type="default" r:id="rId2"/>'));
  assert.ok(sects[1].includes('<w:pgNumType w:start="1"/>'));
  // one-inch margins, the header half an inch down, Letter paper
  assert.ok(sects[1].includes('<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720"'));
  assert.ok(sects[1].includes('<w:pgSz w:w="12240" w:h="15840"/>'));
  // the title page: contact, the word count tabbed to the right, the title, the byline
  assert.match(doc, /Mary Ann Evans<\/w:t><\/w:r><w:r><w:tab\/><\/w:r><w:r><w:t xml:space="preserve">about 90,000 words/);
  assert.ok(doc.includes('<w:t xml:space="preserve">by Mary Ann Evans</w:t>'));
  // the text: escaped, italics as a style, the scene break a #, END at the close
  assert.ok(doc.includes('house &amp; the &lt;sea&gt;.'));
  assert.ok(doc.includes('<w:rStyle w:val="Emphasis"/></w:rPr><w:t xml:space="preserve">old</w:t>'));
  assert.ok(doc.includes('<w:pStyle w:val="SceneBreak"/></w:pPr><w:r><w:t xml:space="preserve">#</w:t>'));
  assert.ok(doc.trim().endsWith('</w:sectPr></w:body></w:document>'));
  assert.ok(doc.lastIndexOf('>END<') > doc.lastIndexOf('Centered.'));
  // the first chapter doesn't break (its section did); the part and the next chapter do
  const heads = [...doc.matchAll(/<w:p><w:pPr><w:pStyle w:val="(ChapterHeading|PartHeading)"\/>(<w:pageBreakBefore\/>)?/g)].map((x) => [x[1], !!x[2]]);
  assert.deepEqual(heads, [['ChapterHeading', false], ['PartHeading', true], ['PartHeading', false], ['ChapterHeading', true]]);
  // the header: the words, then Word's own page number
  const hdr = part(e, 'word/header1.xml');
  assert.ok(hdr.includes('Evans / THE CURSE / </w:t>'));
  assert.ok(hdr.includes('<w:instrText xml:space="preserve"> PAGE </w:instrText>'));
  // the styles: double-spaced 12 point Times, indented half an inch
  const st = part(e, 'word/styles.xml');
  assert.ok(st.includes('<w:rFonts w:ascii="Times New Roman"'));
  assert.ok(st.includes('<w:sz w:val="24"/>'));
  assert.ok(st.includes('w:line="480" w:lineRule="auto"'));
  assert.ok(st.includes('<w:ind w:firstLine="720"/>'));
  assert.ok(st.includes('<w:lang w:val="en-US"/>'));
});

test('a short story\'s .docx: one section, the header from page 2', () => {
  const e = M.docxEntries(model({ short: true, sections: [{ kind: 'chapter', heading: '', paras: [para('Once.')] }] }));
  for (const x of e) wellFormed(x.content);
  const doc = part(e, 'word/document.xml');
  const sects = [...doc.matchAll(/<w:sectPr>[\s\S]*?<\/w:sectPr>/g)].map((x) => x[0]);
  assert.equal(sects.length, 1);
  assert.ok(sects[0].includes('<w:titlePg/>'));
  assert.ok(sects[0].includes('w:type="first" r:id="rId3"'));
  assert.ok(!part(e, 'word/header2.xml').includes('PAGE'), 'the first page\'s header is empty');
  assert.ok(doc.indexOf('Once.') > doc.indexOf('by Mary Ann Evans'), 'the text starts under the title');
});

test('Courier, A4, and no END when it\'s off', () => {
  const e = M.docxEntries(model({ font: 'courier', paper: 'A4', endText: '' }));
  assert.ok(part(e, 'word/styles.xml').includes('w:ascii="Courier New"'));
  assert.ok(part(e, 'word/document.xml').includes('<w:pgSz w:w="11906" w:h="16838"/>'));
  assert.ok(!part(e, 'word/document.xml').includes('>END<'));
});

test('the PDF\'s page: the header in the margin box, none on the title page', () => {
  const h = M.html(model({ headerName: 'O"Brien', title: 'A <b>bold</b> title' }));
  assert.match(h, /@top-right \{ content: "O\\"Brien \/ THE CURSE \/ " counter\(page\);/);
  assert.match(h, /@page titlepage \{ @top-right \{ content: none; \} \}/);
  assert.ok(h.includes('<section class="titlepage">'));
  assert.ok(h.includes('<p class="mtitle c">A &lt;b&gt;bold&lt;/b&gt; title</p>'), 'the title is text');
  // the story's first page is page 1
  assert.ok(h.includes('<section class="chapter pg1">'));
  assert.equal((h.match(/class="[^"]*\bpg1\b/g) || []).length, 1);
  assert.ok(h.includes('<p class="brk">#</p>'));
  assert.ok(h.includes('<i>old</i>'));
  assert.ok(h.includes('<p class="end">END</p>'));
  // a short story: page 1 is the title page, its header left off
  const s = M.html(model({ short: true }));
  assert.ok(s.includes('<section class="titlepage pg1">'));
  assert.ok(s.includes('@page :first { @top-right { content: none; } }'));
  // nothing in a name can close the style block
  assert.ok(!M.html(model({ headerName: '</style><script>x()</script>' })).includes('</style><script>'));
});

test('an untitled chapter in a novel: its first line starts the page, no empty line above', () => {
  const doc = part(M.docxEntries(model({ sections: [
    { kind: 'chapter', heading: 'Chapter 1', paras: [para('One.')] },
    { kind: 'chapter', heading: '', paras: [para('Two starts here.')] }
  ] })), 'word/document.xml');
  assert.ok(doc.includes('<w:pStyle w:val="Manuscript"/><w:pageBreakBefore/></w:pPr><w:r><w:t xml:space="preserve">Two starts here.'));
  assert.ok(!doc.includes('<w:p><w:pPr><w:pageBreakBefore/></w:pPr></w:p>'), 'no empty paragraph for the break');
});
