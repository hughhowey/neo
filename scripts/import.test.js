'use strict';

// Reading a manuscript in: Word files, plain text and Markdown. The real
// main.js runs in a sandbox the way power-loss.test.js loads it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const localRequire = createRequire(path.join(root, 'main.js'));
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const JSZip = localRequire('jszip');

const handlers = new Map();
const electron = {
  app: { commandLine: { appendSwitch() {} }, getPath: () => os.tmpdir(), getLocale: () => 'en', requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {} },
  ipcMain: { on() {}, handle: (name, fn) => handlers.set(name, fn) },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
  dialog: { showMessageBox: () => Promise.resolve({}) },
  utilityProcess: { fork: () => ({ on() {}, postMessage() {} }) },
  screen: {}
};
vm.runInContext(source, vm.createContext({
  require: (name) => name === 'electron' ? electron : localRequire(name),
  __dirname: root, process: { platform: process.platform, on() {} }, console
}), { filename: path.join(root, 'main.js') });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-import-'));
async function importOne(name, data) {
  const fp = path.join(dir, name);
  fs.writeFileSync(fp, data);
  const [r] = await handlers.get('import:files')(null, [fp]);
  return r;
}
const texts = (r) => JSON.parse(JSON.stringify(r.chapters.map((ch) => ch.paras.map((p) => p.text || (p.scene ? '***' : '')))));

async function docx(paragraphs, styles = '') {
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${paragraphs.join('')}</w:body></w:document>`);
  if (styles) zip.file('word/styles.xml', `<?xml version="1.0"?><w:styles xmlns:w="w">${styles}</w:styles>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('import', () => {
  test('a one-line-per-paragraph .txt keeps its paragraphs and finds its chapters', async () => {
    const r = await importOne('lines.txt', 'Chapter 1\r\nIt was late.\r\nShe left.\r\nChapter 2\r\nMorning came.\r\nThe end.\r\n');
    assert.deepEqual(texts(r), [['It was late.', 'She left.'], ['Morning came.', 'The end.']]);
  });

  test('a Windows-1252 .txt reads its curly quotes and accents', async () => {
    const r = await importOne('cp1252.txt', Buffer.from([0x93, 0x48, 0x69, 0x94, 0x20, 0x97, 0x20, 0x63, 0x61, 0x66, 0xE9]));
    assert.equal(r.chapters[0].paras[0].text, '“Hi” — café');
  });

  test('a UTF-16 .txt reads', async () => {
    const r = await importOne('u16.txt', Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('Hello there.', 'utf16le')]));
    assert.equal(r.chapters[0].paras[0].text, 'Hello there.');
  });

  test('Word: soft returns, tabs and no-break hyphens survive; empty bold runs leave no stray markers', async () => {
    const r = await importOne('w.docx', await docx([
      '<w:p><w:r><w:t>Roses are red,</w:t><w:br/><w:t>violets blue.</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>well</w:t><w:noBreakHyphen/><w:t>known</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:tab/></w:r><w:r><w:t>end</w:t></w:r></w:p>'
    ]));
    assert.deepEqual(texts(r)[0], ['Roses are red,', 'violets blue.', 'well‑known end']);
  });

  test('a hard-wrapped .txt (blank line between paragraphs) keeps whole paragraphs', async () => {
    const para = (n) => Array.from({ length: n }, (_, i) => 'This is wrapped line number ' + i + ' of a long paragraph and').join('\n') + ' it ends.';
    const r = await importOne('wrapped.txt', ['Chapter 1', '', para(5), '', para(6), '', para(5), '', para(7), ''].join('\n'));
    assert.equal(r.chapters[0].paras.length, 4);
  });

  test('Word: an italic poem with line breaks stays italic on every line', async () => {
    const r = await importOne('poem.docx', await docx([
      '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Roses are red,</w:t><w:br/><w:t>violets are blue</w:t></w:r></w:p>'
    ]));
    assert.deepEqual(texts(r)[0], ['*Roses are red,*', '*violets are blue*']);
  });

  test('Word: literal asterisks and underscores travel escaped; numeric entities decode; &amp;lt; stays text', async () => {
    const r = await importOne('lit.docx', await docx([
      '<w:p><w:r><w:t xml:space="preserve">5 * 3 and file_name and &#8220;q&#8221; and &amp;lt;</w:t></w:r></w:p>'
    ]));
    assert.equal(r.chapters[0].paras[0].text, '5 \\* 3 and file\\_name and “q” and &lt;');
  });

  test('Word: a bold "Chapter 2" line is a chapter heading', async () => {
    const r = await importOne('bold.docx', await docx([
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Chapter 1</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>It began.</w:t></w:r></w:p>',
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Chapter 2</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>It ended.</w:t></w:r></w:p>'
    ]));
    assert.deepEqual(texts(r), [['It began.'], ['It ended.']]);
  });

  test('Word in another language: a localized heading style still starts a chapter', async () => {
    const r = await importOne('de.docx', await docx([
      '<w:p><w:pPr><w:pStyle w:val="berschrift1"/></w:pPr><w:r><w:t>Der Anfang</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>Eins.</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:pStyle w:val="berschrift1"/></w:pPr><w:r><w:t>Das Ende</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>Zwei.</w:t></w:r></w:p>'
    ], '<w:style w:type="paragraph" w:styleId="berschrift1"><w:name w:val="heading 1"/></w:style>'));
    assert.deepEqual(JSON.parse(JSON.stringify(r.chapters.map((c) => c.title))), ['Der Anfang', 'Das Ende']);
  });
});
