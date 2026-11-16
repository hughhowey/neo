// End-to-end tests for LitRPG boxes: [[ typed at the start of a line makes
// the paragraph a box line (monospace on gray, every space kept); Enter goes
// on in the box, Enter on its empty last line ends it; the drop cap passes a
// box by; and every export carries the box. NEO runs on a throwaway library,
// and the keys arrive as the writer types them. Run with `npm run test:litrpg`
// (OUT=<folder> keeps the exported files for a look).

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-litrpg-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-litrpg-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({
  authorName: 'Test Writer', penNames: [], firstRunDone: true, moreFeatures: true, pageTheme: process.env.THEME || 'night',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

const OUT = process.env.OUT || '';
let wc;
let win;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const MOD = process.platform === 'darwin' ? 'meta' : 'control';

async function press(keyCode, char, modifiers = []) {
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (char) wc.sendInputEvent({ type: 'char', keyCode: char, modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await js(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
}
const type = async (text) => { for (const c of text) await press(c === ' ' ? 'Space' : c, c); };

// the caret this many characters into paragraph `index` of chapter `ch`
const caret = (index, offset, ch = 0) => js(`(() => {
  const body = document.querySelectorAll('.chapter-body')[${ch}];
  const p = body.children[${index}];
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  let n, last = null, left = ${offset};
  while ((n = walker.nextNode())) { last = n; if (left <= n.data.length) break; left -= n.data.length; }
  body.focus({ preventScroll: true });
  if (last) getSelection().collapse(last, Math.min(left, last.data.length)); else getSelection().collapse(p, 0);
})()`);
const paras = (ch = 0) => js(`[...document.querySelectorAll('.chapter-body')[${ch}].children].map((p) => ({ cls: p.className, text: p.textContent, first: p.hasAttribute('data-first') }))`);
const saved = (ch = 0) => js(`chapterHTML[book.chapterOrder[${ch}]]`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('[[ at the start of an empty line makes a box line, and the brackets go', async () => {
  // chapter one: an empty line above the opening paragraph
  await caret(0, 0);
  await press('Enter', '\r');
  await caret(0, 0);
  await type('[[');
  const ps = await paras();
  assert.equal(ps[0].cls, 'litrpg');
  assert.equal(ps[0].text, '');
  assert.match(await saved(), /^<p class="litrpg">/);
});

test('undo right after brings back the [[ as typed', async () => {
  await press('z', 'z', [MOD]);
  await tick(150);
  let ps = await paras();
  assert.equal(ps[0].cls, '');
  assert.equal(ps[0].text, '[[');
  // and again, for the rest
  await caret(0, 2);
  await press('Backspace', '');
  await press('Backspace', '');
  await type('[[');
  ps = await paras();
  assert.equal(ps[0].cls, 'litrpg');
});

test('in a box: spaces stay, quotes stay straight, -- and ... stay, nothing capitalized', async () => {
  await type('level up! "str"  -- ...');
  const ps = await paras();
  assert.equal(ps[0].text, 'level up! "str"  -- ...');
});

test('Enter goes on in the box; columns keep their spaces', async () => {
  await press('Enter', '\r');
  await type('STR      14');
  await press('Enter', '\r');
  await type('DEX       9');
  await press('Enter', '\r', ['shift']);
  await type('  LUCK    3');
  const ps = await paras();
  assert.deepEqual(ps.slice(0, 4).map((p) => p.cls), ['litrpg', 'litrpg', 'litrpg', 'litrpg']);
  assert.equal(ps[1].text, 'STR      14');
  assert.equal(ps[3].text, '  LUCK    3');
  assert.ok((await saved()).includes('STR      14'), 'the spaces are saved as typed');
});

test('the box is monospace, gray, with no indent; one box for the run of lines', async () => {
  const st = await js(`(() => {
    const ps = [...document.querySelectorAll('.chapter-body')[0].children].slice(0, 4);
    const cs = ps.map((p) => getComputedStyle(p));
    return { font: cs[0].fontFamily, indent: cs.map((c) => c.textIndent), bg: cs[0].backgroundColor,
      top: cs.map((c) => c.borderTopWidth), bottom: cs.map((c) => c.borderBottomWidth),
      widths: [ps[1], ps[2]].map((p) => { const r = document.createRange(); r.setStart(p.firstChild, 0); r.setEnd(p.firstChild, 3); return r.getBoundingClientRect().width; }),
      loaded: document.fonts.check('14px "IBM Plex Mono"') };
  })()`);
  assert.match(st.font, /IBM Plex Mono/);
  assert.ok(st.loaded, 'the bundled face is there');
  assert.deepEqual(st.indent, ['0px', '0px', '0px', '0px']);
  assert.notEqual(st.bg, 'rgba(0, 0, 0, 0)');
  assert.deepEqual(st.top, ['1px', '0px', '0px', '0px']);
  assert.deepEqual(st.bottom, ['0px', '0px', '0px', '1px']);
  assert.ok(Math.abs(st.widths[0] - st.widths[1]) < 0.01, 'STR and DEX are the same width: ' + st.widths);
});

test('the drop cap passes the box by: the first prose paragraph has it', async () => {
  const ps = await paras();
  assert.ok(!ps[0].first);
  assert.ok(ps[4].first, 'the paragraph under the box opens the chapter');
  assert.ok(!/data-first/.test(await saved()));
});

test('Enter on an empty last line ends the box; that line is prose', async () => {
  await press('Enter', '\r');
  let ps = await paras();
  assert.equal(ps[4].cls, 'litrpg');
  await press('Enter', '\r');
  ps = await paras();
  assert.equal(ps[4].cls, '');
  assert.equal(ps[4].text, '');
  await type('Prose again');
  ps = await paras();
  assert.equal(ps[4].text, 'Prose again');
  assert.equal(ps[4].cls, '');
});

test('an empty line inside a box stays in it', async () => {
  await caret(1, 0);
  await press('Enter', '\r');
  const ps = await paras();
  assert.deepEqual(ps.slice(0, 5).map((p) => p.cls), ['litrpg', 'litrpg', 'litrpg', 'litrpg', 'litrpg']);
  assert.equal(ps[1].text, '');
});

test('a box mid-section, right after a scene break', async () => {
  // chapter two: line 0, ***, line 2
  await caret(2, 0, 1);
  await press('Enter', '\r');
  await caret(2, 0, 1);
  await type('[[');
  await type('ROLL: d20 = 17');
  const ps = await paras(1);
  assert.equal(ps[1].cls, 'scene-break');
  assert.equal(ps[2].cls, 'litrpg');
  assert.equal(ps[3].cls, '');
});

test('Backspace at the start of a box takes that line out of it', async () => {
  await caret(2, 0, 1);
  await press('Backspace', '');
  let ps = await paras(1);
  assert.equal(ps[2].cls, '');
  assert.equal(ps[2].text, 'ROLL: d20 = 17');
  await press('z', 'z', [MOD]);
  await tick(150);
  ps = await paras(1);
  assert.equal(ps[2].cls, 'litrpg');
});

test('[[ further into a line is just brackets', async () => {
  await caret(0, 3, 1);
  await type('[[');
  const ps = await paras(1);
  assert.equal(ps[0].cls, '');
  assert.ok(ps[0].text.includes('[['));
  await press('Backspace', '');
  await press('Backspace', '');
});

test('text pasted into a box keeps its lines and spaces', async () => {
  await caret(2, 14, 1);
  await js(`(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '\\nHP   [#####     ] 50/100\\n\\tMP   12\\n');
    document.querySelectorAll('.chapter-body')[1].dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  })()`);
  const ps = await paras(1);
  assert.deepEqual(ps.slice(2, 4).map((p) => p.text), ['ROLL: d20 = 17HP   [#####     ] 50/100', '    MP   12']);
  assert.deepEqual(ps.slice(2, 4).map((p) => p.cls), ['litrpg', 'litrpg']);
});

test('a box copied from NEO is pasted as a box', async () => {
  await caret(4, 0, 1);
  await js(`(() => {
    const dt = new DataTransfer();
    dt.setData('text/html', '<p class="litrpg" style="font-family: x">SKILL  Lockpick</p><p class="litrpg">  RANK   2</p>');
    dt.setData('text/plain', 'SKILL  Lockpick\\n\\n  RANK   2');
    document.querySelectorAll('.chapter-body')[1].dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  })()`);
  const ps = await paras(1);
  const at = ps.findIndex((p) => p.text === 'SKILL  Lockpick');
  assert.ok(at > 0, JSON.stringify(ps));
  assert.equal(ps[at].cls, 'litrpg');
  assert.equal(ps[at + 1].text, '  RANK   2');
  assert.equal(ps[at + 1].cls, 'litrpg');
  assert.equal(ps[at + 2].cls, '', 'the line the caret was on goes on below, as prose');
  assert.ok(ps[at + 2].text.length > 0);
  await press('z', 'z', [MOD]);
  await tick(150);
  assert.ok(!(await paras(1)).some((p) => p.text === 'SKILL  Lockpick'), 'undo takes the paste back out');
});

test('Word: one LitRPG style, Courier New, shaded and bordered; spaces kept', async () => {
  const doc = await js(`(() => { const e = buildDocxEntries(); return { doc: e.find((x) => x.path === 'word/document.xml').content, styles: e.find((x) => x.path === 'word/styles.xml').content }; })()`);
  assert.match(doc.styles, /w:styleId="LitRPG"[\s\S]*?<w:pBdr>[\s\S]*?<w:shd [^>]*w:fill="EDEDED"[\s\S]*?Courier New/);
  const boxes = doc.doc.match(/<w:p><w:pPr><w:pStyle w:val="LitRPG"\/>[\s\S]*?<\/w:p>/g) || [];
  assert.ok(boxes.length >= 7, 'box lines: ' + boxes.length);
  assert.ok(doc.doc.includes('<w:t xml:space="preserve">STR      14</w:t>'));
  assert.ok(doc.doc.includes('<w:t xml:space="preserve">  LUCK    3</w:t>'));
  // the box's first line has room above, its last below; the blank line stays
  assert.match(boxes[0], /w:before="240"/);
  assert.ok(boxes.some((b) => !/<w:r>/.test(b)), 'the empty line inside the box');
  if (OUT) fs.writeFileSync(path.join(OUT, 'litrpg-docx.json'), JSON.stringify(await js('buildDocxEntries()')));
});

test('Manuscript Format: the boxes in both files', async () => {
  const m = await js(`(() => {
    const model = { title: 'T', contact: { name: 'A B', lines: [] }, wordsText: 'about 100 words', byText: 'by A B', endText: 'END', font: 'times', paper: 'Letter', lang: 'en-US', short: false, headerName: 'B', headerTitle: 'T', sections: manuscriptSections() };
    const e = NeoManuscript.docxEntries(model);
    return { doc: e.find((x) => x.path === 'word/document.xml').content, styles: e.find((x) => x.path === 'word/styles.xml').content, html: NeoManuscript.html(model), model };
  })()`);
  if (OUT) fs.writeFileSync(path.join(OUT, 'litrpg-manuscript.html'), m.html);
  assert.match(m.styles, /w:styleId="LitRPG"/);
  assert.ok(m.doc.includes('<w:pStyle w:val="LitRPG"/>'));
  assert.ok(m.doc.includes('STR      14'));
  assert.match(m.html, /<p class="litrpg lt-top">level up!/);
  assert.ok(m.html.includes('STR \u00a0 \u00a0 \u00a014'), 'spaces held open in the PDF');
  if (OUT) fs.writeFileSync(path.join(OUT, 'litrpg-manuscript.json'), JSON.stringify(m.model));
});

test('PDF / web page: the box, its edges, the face embedded', async () => {
  const html = await js(`(async () => buildHtml(bookExportData(), { fonts: await exportFontFaces(bookExportData()) }))()`);
  assert.match(html, /<p class="litrpg lt-top">level up!/);
  assert.match(html, /<p class="litrpg lt-end">/);
  assert.match(html, /font-family: 'IBM Plex Mono'; src: url\(data:font\/ttf/);
  assert.match(html, /\.chapter p\.litrpg \{ font-family: 'IBM Plex Mono'/);
  // the first prose paragraph still opens on the cap
  assert.match(html, /<p class="first">Prose again/);
  if (OUT) fs.writeFileSync(path.join(OUT, 'litrpg-book.html'), html);
});

test('the KDP paperback interior sets the box too', async () => {
  const html = await js(`buildPrintHtml(bookExportData(), { trim: PRINT_TRIMS[0].id, fonts: '' })`);
  assert.match(html, /<p class="litrpg lt-top">level up!/);
  assert.match(html, /p\.litrpg \{ font-family: 'IBM Plex Mono'/);
  assert.match(html, /<p class="hy first">Prose again/);
});

test('EPUB: classes, styles and the font files', async () => {
  const e = await js(`(async () => (await buildEpubEntries()).map((x) => ({ path: x.path, content: x.base64 ? x.content.length : x.content })))()`);
  const ch1 = e.find((x) => x.path === 'OEBPS/ch1.xhtml').content;
  const opf = e.find((x) => x.path === 'OEBPS/content.opf').content;
  const css = e.find((x) => x.path === 'OEBPS/style.css').content;
  if (OUT) fs.writeFileSync(path.join(OUT, 'litrpg-ch1.xhtml'), ch1);
  assert.match(ch1, /<p class="litrpg lt-top">level up!/);
  assert.ok(ch1.includes('STR \u00a0 \u00a0 \u00a014'));
  assert.match(ch1, /<p class="first">Prose again/);
  assert.match(opf, /<item id="font1" href="fonts\/IBMPlexMono-regular.ttf" media-type="font\/ttf"\/>/);
  assert.ok(e.some((x) => x.path === 'OEBPS/fonts/IBMPlexMono-regular.ttf' && x.content > 10000));
  assert.match(css, /@font-face \{ font-family: "IBM Plex Mono"/);
  assert.match(css, /p\.litrpg \{/);
  if (OUT) {
    const full = await js('buildEpubEntries()');
    fs.writeFileSync(path.join(OUT, 'litrpg-epub.json'), JSON.stringify(full));
  }
});

test('Plain text and Markdown', async () => {
  const txt = await js('buildTxt()');
  assert.ok(txt.includes('level up! "str"  -- ...\n\nSTR      14\nDEX       9\n  LUCK    3\n\n'), txt.slice(0, 300));
  const md = await js('buildMd()');
  assert.ok(md.includes('```\nlevel up! "str"  -- ...\n\nSTR      14\n'), md.slice(0, 300));
});

test('a book without boxes carries no box face', async () => {
  const none = await js(`(async () => {
    const d = bookExportData();
    for (const s of d.sections) s.paras = s.paras.filter((p) => !p.litrpg);
    return { css: await exportFontFaces(d), fonts: (await buildEpubEntries(d)).filter((x) => /fonts\\//.test(x.path)).length };
  })()`);
  assert.ok(!/IBM Plex Mono/.test(none.css));
  assert.equal(none.fonts, 0);
});

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    win.setBounds({ width: 1200, height: 800 });
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(300);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      await addImportedBooks([{ name: 'Dump Stat', chapters: [
        { title: 'One', paras: Array.from({ length: 4 }, (_, i) => ({ text: 'Rain fell on the harbor and the boats came in one by one under a grey sky ' + i + '.' })) },
        { title: 'Two', paras: [{ text: 'Another chapter opens here.' }, { text: '***' }, { text: 'And goes on after the break.' }, { text: 'One more line.' }, { text: 'And the last.' }] }
      ] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
    })()`);
    await tick(400);
    // the second chapter's *** is a real scene break
    await js(`(() => { const b = document.querySelectorAll('.chapter-body')[1]; const p = b.children[1]; if (p.textContent.trim() === '***') p.className = 'scene-break'; syncChapter(b, book.chapterOrder[1]); })()`);
    win.focus();
    for (const t of tests) {
      try {
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.message).replace(/\n/g, '\n     '));
      }
    }
    if (OUT) {
      await js(`document.querySelector('.chapter-body').scrollIntoView()`);
      await tick(300);
      fs.writeFileSync(path.join(OUT, `litrpg-page-${process.env.THEME || 'night'}.png`), (await wc.capturePage()).toPNG());
    }
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    app.exit(failed ? 1 : 0);
  }
}
main();
