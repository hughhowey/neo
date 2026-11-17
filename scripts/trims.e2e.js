// End-to-end tests for the paperback's trim sizes (#404): the UK and
// German sizes in the dialog beside KDP's own, the note a custom size
// carries, and a book laid out at 110 × 178 mm with its cover template.
// Run with `npm run test:trims`; NEO_OUT=<folder> keeps the PDFs.

'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-trim-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-trim-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const lib = path.join(tmp, 'NEO Library');
fs.mkdirSync(lib);
fs.writeFileSync(path.join(lib, 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, moreFeatures: true, pageTheme: 'night',
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
const until = async (fn, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await tick(100); } throw new Error('timed out'); };
const OUT = process.env.NEO_OUT || path.join(tmp, 'out');
fs.mkdirSync(OUT, { recursive: true });
const saveTo = (name) => { const to = path.join(OUT, name); try { fs.unlinkSync(to); } catch { /* new */ } dialog.showSaveDialog = async () => ({ canceled: false, filePath: to }); return to; };
const D = `document.querySelector('.modal-backdrop .print-modal')`;
const openDialog = async () => {
  await js(`(() => { window.__pb = printPaperback(); })()`);
  await until(() => js(`!!${D}`));
};
const cancel = async () => { await js(`${D}.querySelector('.m-cancel').click()`); await until(() => js(`!${D}`)); };
const pick = (id) => js(`${D}.querySelector('[data-trim="${id}"]').click()`);
const note = () => js(`(() => { const n = ${D}.querySelector('.pm-custom'); return n.hidden ? null : n.textContent; })()`);
// every page's size in points, from the PDF's MediaBoxes
const pageSizes = (file) => [...fs.readFileSync(file, 'latin1').matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [+m[1], +m[2]]);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('the dialog offers KDP’s sizes on one row and the UK and German ones on the next', async () => {
  await openDialog();
  const rows = await js(`[...${D}.querySelectorAll('.pm-trims')].map((r) => [...r.querySelectorAll('[data-trim]')].map((b) => b.dataset.trim))`);
  assert.deepEqual(rows, [['5x8', '5.25x8', '5.5x8.5', '6x9'], ['110x178mm', '120x190mm', '5.06x7.81', '135x216mm', '148x210mm']]);
  const labels = await js(`[...${D}.querySelectorAll('.pm-trims')[1].querySelectorAll('[data-trim]')].map((b) => b.querySelector('strong').textContent + ' | ' + b.querySelector('span').textContent)`);
  assert.deepEqual(labels, ['110 × 178 mm | UK A format', '120 × 190 mm | Germany', '5.06 × 7.81 in | UK B format', '135 × 216 mm | Demy', '148 × 210 mm | A5']);
  // the default is still 5.5 × 8.5, KDP's own, with no note
  assert.equal(await js(`${D}.querySelector('.fr-choice.sel').dataset.trim`), '5.5x8.5');
  assert.equal(await note(), null);
});

test('a custom size says how to enter it on KDP; KDP’s own sizes don’t', async () => {
  await pick('120x190mm');
  assert.match(await note(), /Select a different size.*120 × 190 mm/);
  if (process.env.NEO_SHOT) { await tick(200); fs.writeFileSync(process.env.NEO_SHOT, (await wc.capturePage()).toPNG()); }
  await pick('5.06x7.81');
  assert.equal(await note(), null, 'B format is KDP’s own 5.06 × 7.81');
  await pick('148x210mm');
  assert.match(await note(), /148 × 210 mm/);
  await pick('6x9');
  assert.equal(await note(), null);
  assert.deepEqual(await js(`[...${D}.querySelectorAll('.fr-choice.sel')].map((b) => b.dataset.trim)`), ['6x9'], 'one size picked across both rows');
  await cancel();
});

test('at 110 × 178 mm the interior and its cover template come out that size, and the size is kept', async () => {
  const to = saveTo('A format.pdf');
  await openDialog();
  await pick('110x178mm');
  await js(`${D}.querySelector('.m-ok').click()`);
  const cover = to.replace(/\.pdf$/, '') + ' - cover template.pdf';
  await until(() => fs.existsSync(cover) && fs.statSync(cover).size > 0, 240000);
  await tick(300);
  const sizes = pageSizes(to);
  assert.ok(sizes.length >= 24, 'a book of pages: ' + sizes.length);
  assert.equal(sizes.length % 2, 0, 'an even count');
  for (const [w, h] of sizes) {
    assert.ok(Math.abs(w - 110 / 25.4 * 72) < 0.01, 'width ' + w);
    assert.ok(Math.abs(h - 178 / 25.4 * 72) < 0.01, 'height ' + h);
  }
  // the wrap: 0.125 + 4.331 + spine + 4.331 + 0.125 wide, 7.008 + 0.25 tall
  const [[cw, ch]] = pageSizes(cover);
  const spine = sizes.length * 0.0025;
  assert.ok(Math.abs(cw / 72 - (0.25 + 2 * 110 / 25.4 + spine)) < 0.02, 'cover width ' + cw);
  assert.ok(Math.abs(ch / 72 - (0.25 + 178 / 25.4)) < 0.02, 'cover height ' + ch);
  assert.equal(await js(`book.print.trim`), '110x178mm');
  await openDialog();
  assert.equal(await js(`${D}.querySelector('.fr-choice.sel').dataset.trim`), '110x178mm', 'picked again next time');
  assert.match(await note(), /110 × 178 mm/);
  await cancel();
});

test('a size NEO no longer knows falls back to 5.5 × 8.5 rather than failing', async () => {
  await js(`(() => { book.print = { ...book.print, trim: '9x12' }; })()`);
  await openDialog();
  // (before, no size was picked, and Make PDFs sent "9x12", which main.js refused)
  assert.deepEqual(await js(`[...${D}.querySelectorAll('.fr-choice.sel')].map((b) => b.dataset.trim)`), ['5.5x8.5']);
  assert.equal(await note(), null);
  await cancel();
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
    // enough of a book for a paperback: KDP wants 24 pages
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      const line = 'The ferry crossed at first light, and the river carried the mist down past the mills, where the wheels had stopped turning years before anyone on the boat was born. ';
      const paras = () => Array.from({ length: 14 }, () => ({ text: line.repeat(3).trim() }));
      await addImportedBooks([{ name: 'The Lantern Year', chapters: Array.from({ length: 6 }, (_, i) => ({ title: 'Crossing ' + (i + 1), paras: paras() })) }], library.shelves[0]);
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
