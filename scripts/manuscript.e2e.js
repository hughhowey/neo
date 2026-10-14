// End-to-end test for File → Export → Manuscript Format…, on a throwaway
// library: the dialog starts from what NEO knows (the author's name, the
// Email Draft address, the book's byline, the header from them), the
// header's name follows the byline until it's changed by hand, Save as Word
// writes a .docx that NEO's own import reads back, Save as PDF writes the
// pages with the header on every page but the title page, and what was
// typed is kept for next time (the details for every book, the byline for
// this one). Run with `npm run test:manuscript` (under xvfb-run without a
// display).

'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-manuscript-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-manuscript-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const LIB = path.join(tmp, 'NEO Library');
fs.mkdirSync(LIB);
fs.writeFileSync(path.join(LIB, 'library.json'), JSON.stringify({
  authorName: 'Mary Ann Evans', emailAddress: 'mary@example.com', penNames: [], firstRunDone: true, pageTheme: 'night', hintShown: true,
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');
const JSZip = require('jszip');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(cond, ms = 20000) {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('timed out waiting: ' + cond);
    await tick(80);
  }
}
const D = `document.getElementById('manuscript-dialog')`;
const val = (k) => js(`${D}.querySelector('[data-k="${k}"]').value`);
const setVal = (k, v) => js(`(() => { const el = ${D}.querySelector('[data-k="${k}"]'); el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const has = (cmd) => { try { execFileSync(cmd, ['-v'], { stdio: 'ignore' }); return true; } catch (err) { return err.code !== 'ENOENT'; } };
async function shot(name) {
  if (!process.env.NEO_TEST_SHOTS) return;
  const img = await wc.capturePage();
  fs.writeFileSync(path.join(process.env.NEO_TEST_SHOTS, name + '.png'), img.toPNG());
}

const STORY = 'The tide came in over the stones, and the gulls rose. The harbor light turned.';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('the dialog starts from what NEO knows', async () => {
  await js(`(() => { window.__ms = doExport('manuscript'); })()`);
  await until(() => js(`!!${D}`));
  assert.equal(await val('name'), 'Mary Ann Evans');
  assert.equal(await val('email'), 'mary@example.com');
  assert.equal(await val('byline'), 'M. A. Evans');
  assert.equal(await val('headerName'), 'Evans');
  assert.equal(await val('headerTitle'), 'THE CURSE');
  assert.equal(await js(`${D}.querySelector('.ms-header-eg').textContent`), 'At the top right: Evans / THE CURSE / 1');
  assert.match(await js(`${D}.querySelector('.ms-count').textContent`), /^about \d[\d,]* words on the title page \(\d[\d,]* counted\)\.$/);
  assert.equal(await js(`${D}.querySelector('input[name="ms-font"]:checked').value`), 'times');
  assert.equal(await js(`${D}.querySelector('[data-k="end"]').checked`), true);
  // the header's name follows the byline, until it's changed by hand
  await setVal('byline', 'George H. Eliot');
  assert.equal(await val('headerName'), 'Eliot');
  await setVal('headerName', 'GEliot');
  await setVal('byline', 'George Eliot');
  assert.equal(await val('headerName'), 'GEliot');
  await setVal('headerName', 'Eliot');
  await setVal('address', '123 Main Street\nSpringfield, IL 62701');
  await setVal('phone', '(555) 555-0100');
  await shot('manuscript-dialog');
  // Cancel writes nothing and keeps nothing
  await js(`${D}.querySelector('.m-cancel').click()`);
  assert.equal(await js(`!!${D}`), false);
  assert.equal(await js(`library.manuscript === undefined`), true);
});

test('Save as Word: the .docx, which NEO\'s own import reads back', async () => {
  const to = path.join(tmp, 'curse-manuscript.docx');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: to });
  await js(`(() => { window.__ms = doExport('manuscript'); })()`);
  await until(() => js(`!!${D}`));
  await setVal('byline', 'George Eliot');
  await setVal('address', '123 Main Street\nSpringfield, IL 62701');
  await setVal('phone', '(555) 555-0100');
  await js(`${D}.querySelector('.ms-docx').click()`);
  await until(() => fs.existsSync(to) && fs.statSync(to).size > 0);
  await tick(300);
  const zip = await JSZip.loadAsync(fs.readFileSync(to));
  const doc = await zip.file('word/document.xml').async('string');
  const hdr = await zip.file('word/header1.xml').async('string');
  assert.ok(doc.includes('>Mary Ann Evans<'), 'the contact block');
  assert.ok(doc.includes('>123 Main Street<') && doc.includes('>Springfield, IL 62701<') && doc.includes('>(555) 555-0100<') && doc.includes('>mary@example.com<'));
  assert.ok(doc.includes('>by George Eliot<'));
  assert.ok(doc.includes('>THE CURSE<') === false && doc.includes('>The Curse<'), 'the title as written on the title page');
  assert.ok(hdr.includes('Eliot / THE CURSE / '));
  assert.ok(doc.includes('<w:rStyle w:val="Emphasis"/></w:rPr><w:t xml:space="preserve">old</w:t>'), 'italics kept');
  assert.ok(doc.includes('>#<'), 'the scene break');
  assert.ok(!doc.includes('All rights reserved'), 'the copyright page left out');
  assert.ok(doc.includes('>END<'));
  // NEO's own Word import reads it back: the story's words are all there
  const back = await js(`window.neo.importFiles([${JSON.stringify(to)}])`);
  const text = JSON.stringify(back);
  assert.ok(text.includes('The tide came in over the stones'), text.slice(0, 300));
  // kept: the details for every book, the byline for this one
  const lib = JSON.parse(fs.readFileSync(path.join(LIB, 'library.json'), 'utf8'));
  assert.deepEqual(lib.manuscript, { name: 'Mary Ann Evans', address: '123 Main Street\nSpringfield, IL 62701', phone: '(555) 555-0100', email: 'mary@example.com', font: 'times', end: true });
  assert.deepEqual(await js(`book.manuscript`), { byline: 'George Eliot' });
});

test('the next time, it starts where it was left', async () => {
  await js(`(() => { window.__ms = doExport('manuscript'); })()`);
  await until(() => js(`!!${D}`));
  assert.equal(await val('byline'), 'George Eliot');
  assert.equal(await val('headerName'), 'Eliot');
  assert.equal(await val('phone'), '(555) 555-0100');
  assert.equal(await js(`document.activeElement.classList.contains('ms-pdf')`), true, 'with the details there, Save as PDF has the focus');
  await js(`${D}.querySelector('.m-cancel').click()`);
});

test('a title with quotation marks comes through whole; "Anonymous" is no byline; never two dialogs', async () => {
  await js(`book.title = 'The "Real" Curse'; book.manuscript = undefined; window.__author = book.author; book.author = t('Anonymous'); library.authorName = ''`);
  await js(`(() => { window.__ms = doExport('manuscript'); })()`);
  await until(() => js(`!!${D}`));
  assert.equal(await val('headerTitle'), 'THE "REAL" CURSE');
  assert.equal(await val('byline'), '', 'not "Anonymous"');
  // the menu again, under the open dialog: no second one
  await js(`(() => { doExport('manuscript'); })()`);
  await tick(200);
  assert.equal(await js(`document.querySelectorAll('#manuscript-dialog').length`), 1);
  await js(`${D}.querySelector('.m-cancel').click()`);
  await js(`book.title = 'The Curse'; book.author = window.__author; book.manuscript = { byline: 'George Eliot' }; library.authorName = 'Mary Ann Evans'`);
});

test('Save as PDF: the title page, then the story from page 1 under the header', async () => {
  const to = path.join(tmp, 'curse-manuscript.pdf');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: to });
  await js(`(() => { window.__ms = doExport('manuscript'); })()`);
  await until(() => js(`!!${D}`));
  await js(`(() => { ${D}.querySelector('input[name="ms-font"][value="courier"]').checked = true; ${D}.querySelector('.ms-pdf').click(); })()`);
  await until(() => fs.existsSync(to) && fs.statSync(to).size > 0, 120000);
  await until(() => js(`/Exported: curse-manuscript\\.pdf \\(\\d+ pages\\)/.test($('#hint').textContent)`));
  const pages = +(await js(`$('#hint').textContent.match(/\\((\\d+) pages\\)/)[1]`));
  assert.ok(pages >= 4, `${pages} pages`);
  assert.ok(fs.readFileSync(to).subarray(0, 5).toString() === '%PDF-');
  if (has('pdftotext')) {
    const page = (n) => execFileSync('pdftotext', ['-f', String(n), '-l', String(n), '-layout', to, '-']).toString();
    const one = page(1);
    assert.match(one, /Mary Ann Evans\s+about [\d,]+ words/);
    assert.match(one, /The Curse\s+by George Eliot/);
    assert.ok(!/\/ THE CURSE \//.test(one), 'no header on the title page');
    assert.match(page(2), /Eliot \/ THE CURSE \/ 1/);
    assert.match(page(3), /Eliot \/ THE CURSE \/ 2/);
    assert.match(page(2), /Chapter 1/);
    const all = execFileSync('pdftotext', ['-layout', to, '-']).toString();
    assert.ok(all.includes('#') && /\bEND\b/.test(all));
    const fonts = execFileSync('pdffonts', [to]).toString();
    assert.match(fonts, /CourierPrime/, 'Courier Prime set in the file');
    if (process.env.NEO_TEST_SHOTS && has('pdftoppm')) execFileSync('pdftoppm', ['-r', '40', '-png', '-l', '4', to, path.join(process.env.NEO_TEST_SHOTS, 'manuscript-pdf')]);
  } else console.log('     (pdftotext not here: the pages\' text not read back)');
  assert.equal(JSON.parse(fs.readFileSync(path.join(LIB, 'library.json'), 'utf8')).manuscript.font, 'courier');
  let errors = '';
  try { errors = fs.readFileSync(path.join(LIB, 'neo-errors.log'), 'utf8'); } catch { /* none */ }
  assert.equal(errors, '');
});

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(300);
    const md = path.join(tmp, 'curse.md');
    const many = (n) => Array.from({ length: n }, () => STORY).join(' ');
    fs.writeFileSync(md, ['# The Harbor', 'She came back to the old house at dusk.', ...Array.from({ length: 30 }, () => many(3)), '* * *', many(2),
      '# Low Water', ...Array.from({ length: 30 }, () => many(3))].join('\n\n'));
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      const results = await window.neo.importFiles([${JSON.stringify(md)}]);
      await addImportedBooks(results, library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
      book.title = 'The Curse';
      book.author = 'M. A. Evans';
      await saveMeta();
    })()`);
    await tick(800);
    win.focus();
    await js(`(() => {
      const p = document.querySelectorAll('.chapter-body')[0].querySelector('p');
      p.closest('.chapter-body').focus();
      const at = p.firstChild.data.indexOf('old');
      const r = document.createRange();
      r.setStart(p.firstChild, at); r.setEnd(p.firstChild, at + 3);
      getSelection().removeAllRanges(); getSelection().addRange(r);
      document.execCommand('italic');
    })()`);
    await tick(1200);
    for (const t of tests) {
      try {
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.stack || err.message).replace(/\n/g, '\n     '));
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
