// End-to-end tests for Find and Replace on a chapter whose words are split
// across text nodes by italic, bold or an import's runs.
// Run with `npm run test:find`.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-find-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-find-test-${process.pid}-`));
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

// the first chapter's page, set by hand
const PAGE = '<p>She read <em>The Hunger</em> Games twice.</p>' +
  '<p>Hun<em>ger</em> came <strong>back at</strong> night.</p>' +
  '<p>He slept</p>' +
  '<p>at noon, the hunger gone.</p>';
const setPage = (html) => js(`(() => {
  const chId = book.chapterOrder.filter((c) => isStory(c))[0];
  const body = document.querySelector('.chapter[data-id="' + chId + '"] .chapter-body');
  body.innerHTML = ${JSON.stringify(html)};
  syncChapter(body, chId);
})()`);
const page = () => js(`document.querySelector('.chapter[data-id="' + book.chapterOrder.filter((c) => isStory(c))[0] + '"] .chapter-body').innerHTML.replace(' data-first=""', '')`);
const found = (q) => js(`(() => { $('#search-input').value = ${JSON.stringify(q)}; runSearch(); return searchState.matches.map((m) => m.range.toString()); })()`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('Find finds a word or phrase wherever italic, bold or a split run cuts it', async () => {
  await setPage(PAGE);
  assert.deepEqual(await found('The Hunger Games'), ['The Hunger Games']);
  assert.deepEqual(await found('hunger'), ['Hunger', 'Hunger', 'hunger']);
  assert.deepEqual(await found('came back at night'), ['came back at night']);
});

test('Find never joins two paragraphs into one match', async () => {
  await setPage(PAGE);
  assert.deepEqual(await found('slept at'), []);
  assert.deepEqual(await found('sleptat'), []);
});

test('a match never runs through a footnote or a placeholder flag, so Replace cannot delete one', async () => {
  const flagged = '<p>She found <span class="ph-mark" data-sid="s1" contenteditable="false">⚑</span> the key.</p>';
  await setPage(flagged);
  assert.deepEqual(await found('found ⚑ the'), []);
  assert.deepEqual(await found('⚑'), ['⚑']);
});

test('Replace All replaces every match Find shows, and leaves no empty italic behind', async () => {
  await setPage(PAGE);
  assert.equal((await found('hunger')).length, 3);
  await js(`$('#replace-input').value = 'thirst'; replaceAllMatches()`);
  assert.equal(await page(),
    '<p>She read <em>The thirst</em> Games twice.</p>' +
    '<p>thirst came <strong>back at</strong> night.</p>' +
    '<p>He slept</p>' +
    '<p>at noon, the thirst gone.</p>');
  assert.deepEqual(await found('hunger'), []);
  // ⌘Z takes the whole Replace All back
  await js('structuralUndo()');
  assert.equal(await page(), PAGE);
});

test('Replace on one match that crosses formatting replaces just that match', async () => {
  await setPage(PAGE);
  assert.equal((await found('back at night')).length, 1);
  await js(`$('#replace-input').value = 'home by dark'; searchState.idx = 0; replaceCurrent()`);
  assert.equal(await page(),
    '<p>She read <em>The Hunger</em> Games twice.</p>' +
    '<p>Hun<em>ger</em> came <strong>home by dark</strong>.</p>' +
    '<p>He slept</p>' +
    '<p>at noon, the hunger gone.</p>');
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
      await addImportedBooks([{ name: 'The Lantern Year', chapters: [
        { title: 'The Thaw', paras: [{ text: 'Ines found the lantern in the ice house.' }] },
        { title: 'Salt Road', paras: [{ text: 'The convoy left at dawn.' }] }
      ] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
      openSearch();
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
