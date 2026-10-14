// End-to-end tests for footnotes: ⌘⇧N, the box under the line, the list at
// the chapter's end, and the marker kept through typing, paste and delete.
// Run with `npm run test:footnotes`.

'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const JSZip = require('jszip');
const { execFileSync } = require('child_process');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-fn-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-fn-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const lib = path.join(tmp, 'NEO Library');
fs.mkdirSync(lib);
fs.writeFileSync(path.join(lib, 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, pageTheme: 'night',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const bookDir = () => path.join(lib, fs.readdirSync(lib).find((n) => n.startsWith('book-')));
const onDisk = (name) => { try { return fs.readFileSync(path.join(bookDir(), name), 'utf8'); } catch { return null; } };
const ch = (i) => js(`book.chapterOrder.filter((c) => isStory(c))[${i}]`);
const caretIn = (i) => js(`(() => {
  const id = book.chapterOrder.filter((c) => isStory(c))[${i}];
  const p = document.querySelector('.chapter[data-id="' + id + '"] .chapter-body p');
  const r = document.createRange();
  r.setStart(p.firstChild, 3);
  r.collapse(true);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
  currentChapterId = id;
})()`);
const clickTab = async (name) => { await js(`document.querySelector('.tab[data-tab="${name}"]').click()`); await tick(300); };
const type = async (text) => { wc.insertText(text); await tick(100); };
const save = async () => { await js('flushAux()'); await tick(300); };


const MOD = process.platform === 'darwin' ? 'meta' : 'control';
const key = async (keyCode, modifiers = []) => {
  for (const type of ['keyDown', 'char', 'keyUp']) {
    if (type === 'char' && (modifiers.length || keyCode.length > 1)) continue;
    wc.sendInputEvent({ type, keyCode, modifiers });
  }
  await tick(150);
};
const caretAt = (para, offset) => js(`(() => {
  const p = document.querySelectorAll('.chapter-body')[0].children[${para}];
  const r = document.createRange();
  const tn = [...p.childNodes].find((n) => n.nodeType === 3);
  r.setStart(tn, ${offset});
  r.collapse(true);
  p.closest('.chapter-body').focus();
  getSelection().removeAllRanges();
  getSelection().addRange(r);
})()`);
const html0 = () => js(`chapterHTML[book.chapterOrder[0]]`);
const until = async (fn, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await tick(100); } throw new Error('timed out'); };
const has = (cmd) => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };
const OUT = process.env.NEO_OUT || path.join(tmp, 'out');
fs.mkdirSync(OUT, { recursive: true });
const saveTo = (name) => { const to = path.join(OUT, name); try { fs.unlinkSync(to); } catch { /* new */ } dialog.showSaveDialog = async () => ({ canceled: false, filePath: to }); return to; };
const exported = async (format, name) => {
  const to = saveTo(name);
  await js(`doExport(${JSON.stringify(format)})`);
  await until(() => fs.existsSync(to) && fs.statSync(to).size > 0, 120000);
  await tick(300);
  return to;
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

let words = 0;
test('⌘⇧N puts a number at the caret and opens the box under the line', async () => {
  words = await js(`countWords(chapterText(book.chapterOrder[0]))`);
  await caretAt(0, 'The scale was older'.length);
  await key('N', [MOD, 'shift']);
  assert.equal(await js(`document.querySelectorAll('.chapter-body .fn').length`), 1);
  assert.equal(await js(`!!document.querySelector('.fn-box') && document.activeElement.classList.contains('fn-text')`), true);
  assert.equal(await js(`document.querySelector('.fn-box .fn-num').textContent`), '1');
});

test('what is typed in the box is the note, saved in the chapter', async () => {
  wc.insertText('Tally clerks recorded weight in stone.');
  await tick(200);
  assert.match(await html0(), /<span class="fn" contenteditable="false" data-note="Tally clerks recorded weight in stone\."><\/span>|data-note="Tally clerks recorded weight in stone\."/);
});

test('Enter goes back to the sentence, just past the number', async () => {
  await key('Return');
  assert.equal(await js(`!!document.querySelector('.fn-box')`), false);
  const at = await js(`(() => { const s = getSelection(); const n = s.anchorNode; const kids = [...n.childNodes || []]; return n.nodeType === 1 ? (kids[s.anchorOffset - 1] || {}).className : 'text:' + (n.previousSibling || {}).className; })()`);
  assert.match(at, /fn/);
  wc.insertText(' ');
  await tick(100);
  assert.equal(await js(`document.querySelectorAll('.chapter-body .fn').length`), 1);
});

test('the chapter lists its notes under the last line', async () => {
  assert.deepEqual(await js(`[...document.querySelectorAll('.fn-list .fn-row')].map((r) => r.textContent)`), ['1Tally clerks recorded weight in stone.']);
});

test('the number counts no words', async () => {
  assert.equal(await js(`countWords(chapterText(book.chapterOrder[0]))`), words);
});

test('a second note earlier in the chapter takes number 1, and the list follows', async () => {
  await caretAt(0, 3);
  await key('N', [MOD, 'shift']);
  wc.insertText('Kessick Cross is invented.');
  await tick(150);
  await key('Return');
  assert.deepEqual(await js(`[...document.querySelectorAll('.fn-list .fn-row')].map((r) => r.textContent)`), ['1Kessick Cross is invented.', '2Tally clerks recorded weight in stone.']);
});

test('clicking a number opens its note again', async () => {
  await js(`document.querySelectorAll('.chapter-body .fn')[1].click()`);
  await tick(150);
  assert.equal(await js(`document.querySelector('.fn-box .fn-text').textContent`), 'Tally clerks recorded weight in stone.');
  assert.equal(await js(`document.querySelector('.fn-box .fn-num').textContent`), '2');
  await key('Escape');
  assert.equal(await js(`!!document.querySelector('.fn-box')`), false);
});

test('a note left empty takes its number away', async () => {
  await caretAt(1, 4);
  await key('N', [MOD, 'shift']);
  await key('Escape');
  assert.equal(await js(`document.querySelectorAll('.chapter-body .fn').length`), 2);
});

test('Enter splitting the line, and Backspace joining it again, keep the note', async () => {
  // just past the first number
  await js(`(() => { const m = document.querySelector('.chapter-body .fn'); m.closest('.chapter-body').focus(); const r = document.createRange(); r.setStartAfter(m); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
  await tick(1200);
  const count = () => js(`document.querySelectorAll('.chapter-body')[0].children.length`);
  const n = await count();
  await key('Return');
  assert.equal(await count(), n + 1, 'Enter made a new line');
  assert.match(await js(`document.querySelector('.chapter-body .fn').closest('p').textContent`), /^The\u200B$/);
  await key('Backspace');
  assert.equal(await count(), n, 'Backspace joined them');
  assert.equal(await js(`document.querySelectorAll('.chapter-body .fn').length`), 2);
  assert.match(await js(`document.querySelector('.chapter-body .fn').closest('p').textContent`), /^The\u200B scale/);
  assert.match(await html0(), /data-note="Kessick Cross is invented\."/);
});

test('copied and pasted, a footnote keeps its words', async () => {
  const out = await js(`cleanPasteHtml('<p>One <span class="fn" contenteditable="false" data-note="A &quot;quoted&quot; note"></span>two</p>')`);
  assert.match(out, /<span class="fn" data-note="A &quot;quoted&quot; note" contenteditable="false">\u200B<\/span>/);
});

test('Backspace on a number removes it and keeps its words in Darlings', async () => {
  await js(`(() => { const m = document.querySelectorAll('.chapter-body .fn')[1]; const r = document.createRange(); r.setStartAfter(m); r.collapse(true); m.closest('.chapter-body').focus(); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
  await key('Backspace');
  assert.equal(await js(`document.querySelectorAll('.chapter-body .fn').length`), 1);
  assert.equal(await js(`darlings[0].text`), 'Tally clerks recorded weight in stone.');
});

test('on disk, the chapter holds the marker and its note', async () => {
  await js(`flushAllSaves()`);
  await tick(600);
  const dir = path.join(bookDir(), 'chapters');
  const file = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).find((h) => h.includes('class="fn"'));
  assert.ok(file, 'a chapter file with a footnote');
  assert.match(file, /data-note="Kessick Cross is invented\."/);
  assert.doesNotMatch(file, /data-fnopen/);
});

test('exports: two chapters, a note in each (one with & < > " in it)', async () => {
  await js(`(() => {
    for (const b of document.querySelectorAll('.chapter-body')) for (const f of [...b.querySelectorAll('.fn')]) f.remove();
    const put = (i, before, note, after) => {
      const b = document.querySelectorAll('.chapter-body')[i];
      const p = [...b.querySelectorAll('p')].find((x) => x.textContent.trim());
      p.textContent = before;
      p.appendChild(footnoteMark(note));
      p.append(after);
      syncChapter(b, b.closest('.chapter').dataset.id);
    };
    put(0, 'The scale was older than the road.', 'Weights in "stone" & pounds <1894>.', ' The clerk wrote the crate down.');
    put(1, 'The convoy left at dawn.', 'Dawn, by the station clock.', '');
    renderAllFootnoteLists();
  })()`);
  assert.deepEqual(await js(`[...document.querySelectorAll('.fn-list .fn-n')].map((n) => n.textContent)`), ['1', '2']);
});

test('Text: [1] in the line, the notes under each chapter', async () => {
  const txt = fs.readFileSync(await exported('txt', 'fn.txt'), 'utf8');
  assert.match(txt, /older than the road\.\[1\] The clerk/);
  assert.match(txt, /\[1\] Weights in "stone" & pounds <1894>\./);
  assert.match(txt, /at dawn\.\[2\]/);
  assert.match(txt, /\[2\] Dawn, by the station clock\./);
  assert.doesNotMatch(txt, /\u200B/);
});

test('Markdown: [^1] and its definition', async () => {
  const md = fs.readFileSync(await exported('md', 'fn.md'), 'utf8');
  assert.match(md, /older than the road\.\[\^1\] The clerk/);
  assert.match(md, /\[\^1\]: Weights in "stone" & pounds \\<1894\\>\./);
  assert.match(md, /\[\^2\]: Dawn, by the station clock\./);
});

test('Web page: the number links to the note at the chapter\'s end', async () => {
  const html = fs.readFileSync(await exported('html', 'fn.html'), 'utf8');
  assert.match(html, /road\.<sup class="fnref"><a href="#fn1" id="fnr1">1<\/a><\/sup>/);
  assert.match(html, /<aside class="notes"><p id="fn1"><a href="#fnr1">1<\/a>&#8194;Weights in &quot;stone&quot; &amp; pounds &lt;1894&gt;\.<\/p><\/aside>/);
  assert.match(html, /<p id="fn2">/);
  assert.doesNotMatch(html, /class="fn"/);
});

test('Word: real footnotes, numbered through the book', async () => {
  const to = await exported('docx', 'fn.docx');
  const zip = await JSZip.loadAsync(fs.readFileSync(to));
  const doc = await zip.file('word/document.xml').async('string');
  const notes = await zip.file('word/footnotes.xml').async('string');
  assert.match(doc, /<w:footnoteReference w:id="1"\/>/);
  assert.match(doc, /<w:footnoteReference w:id="2"\/>/);
  assert.match(notes, /Weights in &quot;stone&quot; &amp; pounds &lt;1894&gt;\./);
  assert.match(await zip.file('word/_rels/document.xml.rels').async('string'), /footnotes\.xml/);
  assert.match(await zip.file('[Content_Types].xml').async('string'), /footnotes\+xml/);
  if (has('pandoc')) {
    const plain = execFileSync('pandoc', ['-t', 'plain', to]).toString();
    assert.match(plain, /road\.\[1\]/);
    assert.match(plain, /\[1\] Weights in "stone" & pounds <1894>\./);
  }
});

test('EPUB: pop-up notes', async () => {
  const to = await exported('epub', 'fn.epub');
  const zip = await JSZip.loadAsync(fs.readFileSync(to));
  const pages = await Promise.all(Object.keys(zip.files).filter((f) => f.endsWith('.xhtml')).map((f) => zip.file(f).async('string')));
  const all = pages.join('\n');
  assert.match(all, /<a epub:type="noteref" href="#fn1" id="fnr1">1<\/a>/);
  assert.match(all, /<aside epub:type="footnote" id="fn1" class="footnote"><p><a href="#fnr1">1<\/a>&#8194;Weights in &quot;stone&quot; &amp; pounds &lt;1894&gt;\.<\/p><\/aside>/);
  assert.match(all, /id="fn2"/);
  for (const page of pages) {
    const ok = await js(`!new DOMParser().parseFromString(${JSON.stringify(page)}, 'application/xhtml+xml').querySelector('parsererror')`);
    assert.ok(ok, 'well-formed XHTML');
  }
  if (has('pandoc')) assert.match(execFileSync('pandoc', ['-t', 'plain', to]).toString(), /Weights in "stone"/);
});

test('PDF: the notes close their chapters', async () => {
  const to = await exported('pdf', 'fn.pdf');
  assert.ok(fs.statSync(to).size > 1000);
  if (has('pdftotext')) assert.match(execFileSync('pdftotext', [to, '-']).toString(), /Weights in "stone" & pounds <1894>/);
});

test('Manuscript format: Word footnotes and a PDF with notes at the foot of the page', async () => {
  const D = `document.getElementById('manuscript-dialog')`;
  let to = saveTo('fn-manuscript.docx');
  await js(`(() => { window.__ms = doExport('manuscript'); })()`);
  await until(() => js(`!!${D}`));
  await js(`${D}.querySelector('.ms-docx').click()`);
  await until(() => fs.existsSync(to) && fs.statSync(to).size > 0);
  await tick(300);
  const zip = await JSZip.loadAsync(fs.readFileSync(to));
  assert.match(await zip.file('word/document.xml').async('string'), /<w:footnoteReference w:id="2"\/>/);
  assert.match(await zip.file('word/footnotes.xml').async('string'), /Dawn, by the station clock\./);
  to = saveTo('fn-manuscript.pdf');
  await js(`(() => { window.__ms = doExport('manuscript'); })()`);
  await until(() => js(`!!${D}`));
  await js(`${D}.querySelector('.ms-pdf').click()`);
  await until(() => fs.existsSync(to) && fs.statSync(to).size > 0, 120000);
  if (has('pdftotext')) assert.match(execFileSync('pdftotext', [to, '-']).toString(), /Dawn, by the station clock/);
});

test('Paperback: the notes at the foot of their pages', async () => {
  const to = saveTo('fn-paperback.pdf');
  await js(`(() => { window.__pb = printPaperback(); })()`);
  await until(() => js(`!!document.querySelector('.modal-backdrop .m-ok')`));
  await js(`document.querySelector('.modal-backdrop .m-ok').click()`);
  await until(() => fs.existsSync(to) && fs.statSync(to).size > 0, 240000);
  if (has('pdftotext')) assert.match(execFileSync('pdftotext', [to, '-']).toString(), /Weights in "stone" & pounds <1894>/);
});

test('screenshot', async () => {
  await js(`(() => { const b = document.querySelectorAll('.chapter-body')[0]; const ps = [...b.querySelectorAll('p')].filter((p) => p.textContent.trim()); const add = (p, i) => { const tn = [...p.childNodes].filter((n) => n.nodeType === 3).pop(); const r = document.createRange(); r.setStart(tn, i); r.insertNode(footnoteMark('x')); }; add(ps[2], 34); add(ps[3], 3);
  })()`);
  await tick(200);
  await caretAt(4, 5);
  await key('N', [MOD, 'shift']);
  wc.insertText('A third note, open.');
  await tick(300);
  const img = await wc.capturePage();
  if (process.env.NEO_SHOT) fs.writeFileSync(process.env.NEO_SHOT, img.toPNG());
  await key('Return');
});

/* ---------- runner ---------- */

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(300);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      const paras = (s) => Array.from({ length: 6 }, () => ({ text: s }));
      await addImportedBooks([{ name: 'The Lantern Year', chapters: [
        { title: 'The Weigh Station', paras: paras('The scale was older than the road. The clerk wrote the crate down at four stone and nine, then wrote it again.') },
        { title: 'Salt Road', paras: paras('The convoy left at dawn.') }
      ] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
    })()`);
    await tick(400);
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
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    app.exit(failed ? 1 : 0);
  }
}
main();
