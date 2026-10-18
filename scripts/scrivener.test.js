'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// The Scrivener importer from main.js, run on its own — the same vm trick the
// dialogue-dash test uses. Its three helpers (decodeEntities, escapeMarks,
// CHAPTER_WORDS) live earlier in main.js; we pull each in beside it.
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const slice = (from, to) => main.slice(main.indexOf(from), main.indexOf(to));
const deps =
  slice('const decodeEntities', 'const escapeMarks') +
  slice('const escapeMarks', '// Is a formatting tag') +
  slice('const CHAPTER_WORDS', 'const PROLOGUE_WORDS');
const block = slice('const CP1252', "ipcMain.handle('import:scrivener'");

const context = vm.createContext({ fs, path, String, parseInt, isNaN, Set, RegExp });
vm.runInContext(deps + '\n' + block, context);
vm.runInContext('this.api = { rtfToParagraphs, scrivChapterTitle, scrivenerToBook };', context);
const { rtfToParagraphs, scrivChapterTitle, scrivenerToBook } = context.api;

// importedEmphasis + escHtml from app.js, to prove the Markdown the importer
// writes becomes the <b>/<i> a chapter shows.
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const appCtx = vm.createContext({ String });
vm.runInContext(
  app.slice(app.indexOf('const escHtml'), app.indexOf('const escAttr')) +
  app.slice(app.indexOf('function importedEmphasis'), app.indexOf('async function importBooks')),
  appCtx
);
vm.runInContext('this.api = { escHtml, importedEmphasis };', appCtx);
const { escHtml, importedEmphasis } = appCtx.api;
const toHTML = (md) => importedEmphasis(escHtml(md));

// The parsed objects come from the vm's own realm, so compare by value.
const jeq = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));

test('RTF → paragraphs: emphasis, scene breaks, code page, unicode', () => {
  const rtf = '{\\rtf1\\ansi\\ansicpg1252{\\fonttbl\\f0 Helvetica;}\\f0\\fs24 ' +
    'He said \\i hello\\i0  to her.\\par\n* * *\\par\nShe didn\\\'92t reply.\\par}';
  jeq(rtfToParagraphs(rtf), [
    { text: 'He said *hello* to her.' },
    { scene: true },
    { text: 'She didn’t reply.' }
  ]);

  const bold = '{\\rtf1\\ansi\\fs24 A \\b bold\\b0  word and an em\\u8212?dash.\\par}';
  jeq(rtfToParagraphs(bold), [{ text: 'A **bold** word and an em—dash.' }]);

  // a literal asterisk in prose stays literal (escaped), not emphasis
  const star = '{\\rtf1 5 * 3 = 15\\par}';
  jeq(rtfToParagraphs(star), [{ text: '5 \\* 3 = 15' }]);
  assert.equal(toHTML(rtfToParagraphs(star)[0].text), '5 * 3 = 15');
});

test('emphasis Markdown becomes <b>/<i> through the window', () => {
  assert.equal(toHTML('He said *hello* to her.'), 'He said <i>hello</i> to her.');
  assert.equal(toHTML('A **bold** word and an em—dash.'), 'A <b>bold</b> word and an em—dash.');
});

test('chapter titles drop ordering and bare numbering', () => {
  assert.equal(scrivChapterTitle('01 - The Road'), 'The Road');
  assert.equal(scrivChapterTitle('7.01 Foo'), 'Foo');
  assert.equal(scrivChapterTitle('Chapter 2'), '');
  assert.equal(scrivChapterTitle('VII'), '');
  assert.equal(scrivChapterTitle('The Long Road'), 'The Long Road');
  assert.equal(scrivChapterTitle('1984'), '1984');
});

test('a whole project becomes one book of the Draft folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scriv-'));
  const proj = path.join(dir, 'My Novel.scriv');
  const data = path.join(proj, 'Files', 'Data');
  fs.mkdirSync(path.join(data, 'AAA'), { recursive: true });
  fs.mkdirSync(path.join(data, 'BBB'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'My Novel.scrivx'),
    '<?xml version="1.0"?><ScrivenerProject><Binder>' +
    '<BinderItem UUID="DRAFT" Type="DraftFolder"><Title>Manuscript</Title><Children>' +
    '<BinderItem UUID="AAA" Type="Text"><Title>01 - The Road</Title></BinderItem>' +
    '<BinderItem UUID="BBB" Type="Text"><Title>Chapter 2</Title></BinderItem>' +
    '</Children></BinderItem>' +
    '<BinderItem UUID="RES" Type="ResearchFolder"><Title>Research</Title><Children>' +
    '<BinderItem UUID="CCC" Type="Text"><Title>World notes</Title></BinderItem></Children></BinderItem>' +
    '<BinderItem UUID="TRASH" Type="TrashFolder"><Title>Trash</Title><Children>' +
    '<BinderItem UUID="DDD" Type="Text"><Title>Cut scene</Title></BinderItem></Children></BinderItem>' +
    '</Binder></ScrivenerProject>');
  fs.writeFileSync(path.join(data, 'AAA', 'content.rtf'), '{\\rtf1\\ansi\\fs24 The road was long.\\par}');
  fs.writeFileSync(path.join(data, 'BBB', 'content.rtf'), '{\\rtf1\\ansi\\fs24 It \\i ended\\i0  here.\\par}');

  const book = scrivenerToBook(proj);
  assert.equal(book.title, 'My Novel');
  assert.equal(book.chapters.length, 2, 'only the Draft folder — Research and Trash left out');
  assert.equal(book.chapters[0].title, 'The Road');
  jeq(book.chapters[0].paras, [{ text: 'The road was long.' }]);
  assert.equal(book.chapters[1].title, '');
  jeq(book.chapters[1].paras, [{ text: 'It *ended* here.' }]);

  fs.rmSync(dir, { recursive: true, force: true });
});
