// End-to-end tests for NEO's features and the Options window: a library from
// before 2.0, the window with every feature off, features turned on and off
// in Options, and the settings that moved there. Run with
// `npm run test:options`.

'use strict';

const { app, BrowserWindow, Menu } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-options-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-options-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const lib = path.join(tmp, 'NEO Library');
fs.mkdirSync(lib);
// a writer from before the switch who uses nothing behind it
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
const onDisk = () => JSON.parse(fs.readFileSync(path.join(lib, 'library.json'), 'utf8'));
const clickTab = async (name) => { await js(`document.querySelector('.tab[data-tab="${name}"]').click()`); await tick(300); };
const menuLabels = () => {
  const out = [];
  const walk = (m) => { for (const i of m.items) { if (i.label) out.push(i.label); if (i.submenu) walk(i.submenu); } };
  walk(Menu.getApplicationMenu());
  return out;
};
const key = (opts) => js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, ${JSON.stringify(opts)})))`);
const shot = async (name) => {
  if (!process.env.NEO_SHOTS) return;
  const img = await wc.capturePage();
  fs.writeFileSync(path.join(process.env.NEO_SHOTS, name + '.png'), img.toPNG());
};
const caretInFirst = () => js(`(() => {
  const id = book.chapterOrder.filter((c) => isStory(c))[0];
  const p = document.querySelector('.chapter[data-id="' + id + '"] .chapter-body p');
  p.closest('.chapter-body').focus();
  const r = document.createRange();
  r.setStart(p.firstChild, 3);
  r.collapse(true);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
  currentChapterId = id;
})()`);
const FEATURE_MENU = ['Focus Mode', 'Manuscript Format…', 'Import Chapters…', 'Poetry Paragraph', 'Show Pages'];
const opt = (sel) => js(`(() => { const el = document.querySelector('.options-modal [data-opt="${sel}"]'); if (!el) return 'missing'; el.click(); return el.checked; })()`);
const openOpts = async () => { wc.send('menu', { type: 'options' }); await tick(400); };
const closeOpts = async () => { await js(`document.querySelector('.options-modal .m-ok').click()`); await tick(200); };

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a library from before 2.0 that used nothing behind the switch starts with every feature off, on disk', async () => {
  assert.equal(await js('Object.values(library.features).some(Boolean)'), false);
  assert.equal(Object.values(onDisk().features).some(Boolean), false);
  assert.equal(onDisk().moreFeatures, undefined);
});

test('the menu bar shows no feature items, and Options… is there', async () => {
  const labels = menuLabels();
  for (const l of FEATURE_MENU) assert.ok(!labels.includes(l), l + ' is hidden');
  for (const l of ['Options…', 'Typewriter Scrolling', 'Paperback for KDP…', 'Goals…']) assert.ok(labels.includes(l), l + ' is there');
  for (const l of ['Show More Features', 'Vim Keys', 'Markdown Emphasis', 'Language', 'Spellcheck Language']) assert.ok(!labels.includes(l), l + ' moved to Options');
});

test('the Outline is the list, with no cards or loose cards', async () => {
  await clickTab('outline');
  assert.equal(await js(`document.getElementById('outline-list').hidden`), false);
  assert.equal(await js(`document.getElementById('outline-views').hidden`), true);
  assert.equal(await js(`document.getElementById('editor-view').classList.contains('board-on')`), false);
  assert.equal(await js(`document.getElementById('editor-view').classList.contains('outline-tab')`), false);
  await shot('simple-outline');
});

test('Notes holds the book\'s page alone', async () => {
  await clickTab('notes');
  assert.equal(await js('notesPage'), 'book');
  assert.deepEqual(await js(`[...document.querySelectorAll('#notes-nav .notes-item')].map((r) => r.dataset.page)`), ['book']);
});

test('a chapter\'s notes page with notes on it stays in reach', async () => {
  const id = await js(`book.chapterOrder.filter((c) => isStory(c))[1]`);
  await js(`notesPeeks[${JSON.stringify(id)}] = 'Kept from before.'; renderNotesNav()`);
  assert.deepEqual(await js(`[...document.querySelectorAll('#notes-nav .notes-item')].map((r) => r.dataset.page)`), ['book', id]);
  await js(`delete notesPeeks[${JSON.stringify(id)}]; renderNotesNav()`);
});

test('the keys of features that are off do nothing: footnote, poetry', async () => {
  await clickTab('manuscript');
  await caretInFirst();
  const before = await js(`document.querySelector('.chapter-body').innerHTML`);
  await key({ key: 'N', code: 'KeyN', metaKey: process.platform === 'darwin', ctrlKey: process.platform !== 'darwin', shiftKey: true });
  await key({ key: 'Enter', code: 'Enter', metaKey: process.platform === 'darwin', ctrlKey: process.platform !== 'darwin', shiftKey: true });
  await tick(100);
  assert.equal(await js(`document.querySelectorAll('.chapter-body .fn, .chapter-body p.poetry').length`), 0);
  assert.equal(await js(`document.querySelector('.chapter-body').innerHTML`), before);
});

test('a footnote the book already holds stays: it shows, opens, edits and exports with Footnotes off', async () => {
  await clickTab('manuscript');
  assert.equal(await js(`featureOn('footnotes')`), false);
  await js(`(() => {
    const p = document.querySelector('.chapter-body > p');
    p.appendChild(footnoteMark('Written before the switch.'));
    syncChapter(p.closest('.chapter-body'), p.closest('.chapter').dataset.id);
  })()`);
  await tick(100);
  assert.equal(await js(`document.querySelectorAll('.chapter-body .fn').length`), 1);
  await js(`document.querySelector('.chapter-body .fn').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await tick(150);
  assert.equal(await js(`!!document.querySelector('.fn-box')`), true, 'a click opens the note');
  await js(`document.querySelector('.fn-box textarea, .fn-box [contenteditable]') && closeFootnote()`);
  await js(`closeFootnote()`);
  const html = await js(`buildHtml(bookExportData(), {})`);
  assert.match(html, /Written before the switch\./, 'the note goes out in the export');
  await js(`(() => { const f = document.querySelector('.chapter-body .fn'); const body = f.closest('.chapter-body'); f.remove(); syncChapter(body, body.closest('.chapter').dataset.id); })()`);
});

test('the shortcuts window lists only what\'s showing', async () => {
  const rows = await js(`bookShortcutSections().flatMap((s) => s.rows.map((r) => r[1]))`);
  assert.ok(rows.includes('Insert a placeholder note'));
  for (const gone of ['Italic, bold, the Markdown way', 'Add a footnote', 'Start or continue a poetry paragraph', 'Read aloud from the cursor', 'Cycle focus mode', 'Center paragraph']) {
    assert.ok(!rows.includes(gone), gone + ' is not listed');
  }
});

test('no cards beside the page', async () => {
  await js(`book.chapterNotes = book.chapterNotes || {}; book.chapterNotes[book.chapterOrder.filter((c) => isStory(c))[0]] = 'A note.'`);
  await caretInFirst();
  await js('sideCardsUpdate(true)');
  assert.equal(await js(`document.getElementById('side-cards').innerHTML`), '');
  await shot('simple-page');
});

test('Markdown asterisks stay asterisks, as simple NEO had them', async () => {
  assert.equal(await js('markdownOff()'), true);
});

// a book's right-click on the shelf: what it offers, then closed again
const bookMenu = async () => {
  await js(`document.getElementById('back-to-shelf').click()`);
  await tick(500);
  await js(`document.querySelector('#shelves .book').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }))`);
  await tick(300);
  await shot('book-menu-' + (await js("featureOn('covers')") ? 'on' : 'off'));
  const cards = await js(`[...document.querySelectorAll('.modal-backdrop:not([hidden]):not(#firstrun) .fr-choice strong')].map((b) => b.textContent)`);
  const small = await js(`[...document.querySelectorAll('.pop-menu [role="menuitem"], .pop-menu button, .popmenu button')].map((b) => b.textContent.trim())`);
  await js(`(document.querySelector('.modal-backdrop:not(#firstrun) .m-cancel') || document.body).click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await tick(200);
  const id = await js('library.shelves[0].bookIds[0]');
  await js(`openBook(${JSON.stringify(id)})`);
  await tick(400);
  return { cards, small };
};

test('a book\'s right-click is the small menu, with the cover menu but no Duplicate or word goal', async () => {
  const { cards, small } = await bookMenu();
  assert.deepEqual(cards, []);
  assert.ok(small.some((l) => l.startsWith('Cover')), small.join(' | '));
  assert.ok(!small.includes('Duplicate'), 'Duplicate is a pen names feature');
  assert.ok(!small.some((l) => l.startsWith('Set word goal')));
});

test('Options: Turn all on brings every feature back, and is kept', async () => {
  await openOpts();
  assert.equal(await js(`!!document.querySelector('.options-modal')`), true);
  const boxes = await js(`[...document.querySelectorAll('.options-modal [data-opt^="feature:"]')].map((b) => b.checked)`);
  assert.ok(boxes.length >= 10 && boxes.every((b) => !b), String(boxes));
  await js(`document.querySelector('.options-modal .opt-all').click()`);
  await tick(400);
  assert.equal(await js(`[...document.querySelectorAll('.options-modal [data-opt^="feature:"]')].every((b) => b.checked)`), true);
  assert.equal(Object.values(onDisk().features).every(Boolean), true);
  assert.equal(await js('vimEnabled'), true);
  await closeOpts();
  const labels = menuLabels();
  for (const l of FEATURE_MENU) assert.ok(labels.includes(l), l + ' is back');
  await js('sideCardsUpdate(true)');
  assert.notEqual(await js(`document.getElementById('side-cards').innerHTML`), '');
  await clickTab('outline');
  assert.equal(await js(`document.getElementById('editor-view').classList.contains('board-on')`), true);
  assert.equal(await js(`document.getElementById('editor-view').classList.contains('outline-tab')`), true);
  await shot('more-outline');
  await clickTab('notes');
  assert.equal(await js(`document.querySelectorAll('#notes-nav .notes-item').length`), 4);
});

test('with the features on, a book\'s right-click has the cover menu and Duplicate, and no word goal', async () => {
  const { cards, small } = await bookMenu();
  assert.deepEqual(cards, []);
  assert.ok(small.some((l) => l.startsWith('Cover')), 'the cover menu: ' + small.join(' | '));
  assert.ok(small.includes('Duplicate'));
  assert.ok(!small.some((l) => l.startsWith('Set word goal')));
  await clickTab('outline');
});

test('one feature off at a time: Outline cards off makes the Outline the list again', async () => {
  await clickTab('outline');
  await openOpts();
  assert.equal(await opt('feature:cards'), false);
  await tick(400);
  assert.equal(onDisk().features.cards, false);
  assert.equal(onDisk().features.vim, true, 'the others stay');
  assert.equal(await js(`document.getElementById('editor-view').classList.contains('board-on')`), false);
  assert.equal(await js(`document.getElementById('outline-list').hidden`), false);
  assert.equal(await opt('feature:vim'), false);
  await tick(300);
  assert.equal(await js('vimEnabled'), false);
  await closeOpts();
});

test('Options settings: Markdown emphasis and the interface size', async () => {
  await openOpts();
  assert.equal(await opt('markdown'), true);
  await tick(200);
  assert.equal(await js('markdownOff()'), false);
  assert.equal(onDisk().markdownOff, undefined);
  await js(`document.querySelector('.options-modal [data-zoom="1"]').click()`);
  await tick(300);
  assert.equal(onDisk().uiZoom, 1.1);
  assert.equal(await js(`document.querySelector('.options-modal .opt-zoom').textContent`), '110%');
  await js(`document.querySelector('.options-modal [data-zoom="0"]').click()`);
  await tick(300);
  assert.equal(onDisk().uiZoom, 1);
  await shot('options-end');
  await js(`document.querySelectorAll('.pop-menu, .popmenu').forEach((m) => m.remove()); document.querySelector('.options-modal .opt-panel').scrollTop = 0`);
  await tick(100);
  await shot('options');
  // Esc closes it
  await js(`document.querySelector('.options-modal').closest('.modal-backdrop').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  assert.equal(await js(`!!document.querySelector('.options-modal')`), false);
});

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    while (!(await js(`typeof library !== 'undefined' && !!library && !!library.features`).catch(() => false))) await tick(50);
    await tick(300);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      const paras = (s) => Array.from({ length: 6 }, () => ({ text: s }));
      await addImportedBooks([{ name: 'The Lantern Year', chapters: [
        { title: 'The Thaw', paras: paras('Ines found the lantern in the ice house.') },
        { title: 'Salt Road', paras: paras('The convoy left at dawn.') },
        { title: 'The Weigh Station', paras: paras('The scale was older than the road.') }
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
