'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
app.disableHardwareAcceleration();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-project-search-'));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({ firstRunDone: true, features: { projectSearch: true, cards: true, notesPages: true },
  shelves: [{ id: 'shelf-1', name: 'Tests', bookIds: [] }] }));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) { return loadFile.call(this, path.resolve(__dirname, '..', file), opts); };
let failBookNotes = false;
let notesReads = 0;
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, channel !== 'aux:read' ? listener : (...args) => {
  notesReads++;
  if (failBookNotes && args[2] === 'notes') throw new Error('simulated unreadable note file');
  return listener(...args);
});
require('../main.js');
const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const search = (q) => js(`(async () => { $('#search-input').value = ${JSON.stringify(q)}; await runSearch(); return projectSearchMatches.map((m) => ({ kind: m.source.kind, text: m.text, label: m.source.label })); })()`);
const go = (kind) => js(`gotoProjectMatch(projectSearchMatches.findIndex((m) => m.source.kind === ${JSON.stringify(kind)}))`);
const scope = (value) => js(`$('#search-scope').value = ${JSON.stringify(value)}; runSearch()`);
const seed = () => js(`(async () => {
  switchTab('manuscript'); closeSearch(); library.features = { ...library.features, projectSearch: true };
  $('#search-scope').value = 'tab'; $('#search-input').value = '';
  window.testCh = book.chapterOrder.find((c) => isStory(c));
  window.testBook = book.id;
  book.chapterTitles[testCh] = 'Lantern heading';
  book.chapterNotes = { [testCh]: 'Lantern chapter plan' };
  book.sectionNotes = { [testCh]: [{ id: 'sec-lantern', text: 'Lantern section plan' }] };
  book.looseCards = [{ id: 'loose-lantern', text: 'Lantern loose plan' }];
  darlings = [{ id: 'darling-lantern', text: 'Lantern discarded passage', html: '<p>Lantern discarded passage</p>', chapterLabel: 'First', date: new Date().toISOString() }];
  chapterHTML[testCh] = '<p>She raised the <em>Lan</em>tern slowly.</p><p>Other words.</p>';
  await persistChapter(testCh); await saveMeta();
  await window.neo.writeAux(book.id, 'notes', '<p>Lantern book research</p>');
  await window.neo.writeAux(book.id, notesKind(testCh), '<p>Lantern chapter research</p>');
  renderChapters(); openSearch(); $('#search-scope').value = 'project';
})()`);

test('one search finds manuscript, headings, both note pages, outline notes, loose cards and Darlings', async () => {
  await seed();
  const found = await search('lantern');
  assert.deepEqual(found.map((m) => m.kind).sort(), ['darling', 'loose', 'manuscript', 'notes', 'notes', 'outline', 'section', 'title'].sort());
  assert.equal(found.find((m) => m.kind === 'manuscript').text, 'She raised the Lantern slowly.');
  assert.equal(await js('document.querySelectorAll(".project-search-result").length'), 8);
});

test('results navigate and highlight every source without changing the book', async () => {
  const original = await js('chapterHTML[testCh]');
  for (const kind of ['manuscript', 'title', 'notes', 'outline', 'section', 'loose', 'darling']) {
    await go(kind);
    assert.equal(await js('projectReturnRange?.toString().toLowerCase()'), 'lantern', kind);
    assert.equal(await js('document.getElementById("project-search-results").hidden'), true);
    assert.equal(await js('currentTab'), ['manuscript', 'title'].includes(kind) ? 'manuscript' : kind === 'notes' ? 'notes' : kind === 'darling' ? 'darlings' : 'outline');
  }
  assert.equal(await js('chapterHTML[testCh]'), original);
  await js('document.getElementById("project-search-toggle").click()');
  assert.equal(await js('document.getElementById("project-search-results").hidden'), false);
  await js(`gotoProjectMatch(projectSearchMatches.findIndex((m) => m.source.kind === 'notes' && m.source.page === testCh))`);
  assert.equal(await js('notesPage'), await js('testCh'));
});

test('next/previous keep the project scope after navigating across tabs; Esc returns to a note match', async () => {
  await search('lantern');
  await go('manuscript');
  const before = await js('searchState.idx');
  await js('freshSearchIfStale(); gotoMatch(searchState.idx + 1)');
  assert.equal(await js('searchState.idx'), before + 1);
  await go('notes');
  await js('returnFromSearch()');
  assert.equal(await js('document.activeElement.id'), 'aux-editor');
  assert.equal(await js('window.getSelection().anchorNode.parentElement.closest("#aux-editor").id'), 'aux-editor');
});

test('current unsaved notes are searched, and notes are cached only for the search session', async () => {
  await seed();
  await search('lantern'); await go('notes');
  await js(`$('#aux-editor').innerHTML = '<p>Unsaved Observatory research</p>'; auxDirty = true;`);
  assert.equal((await search('observatory')).length, 1);
  await js(`switchTab('manuscript')`);
  assert.equal((await search('observatory')).length, 1);
});

test('project search cannot replace; current-tab Find/Replace still works and undoes', async () => {
  await seed(); await search('lantern');
  await js(`switchTab('manuscript'); $('#replace-input').value = 'WRONG'; replaceCurrent(); replaceAllMatches();`);
  assert.match(await js('chapterHTML[testCh]'), /Lan<\/em>tern/);
  await scope('tab');
  await js(`$('#search-input').value = 'Lantern'; runSearch(); $('#replace-input').value = 'Candle'; replaceAllMatches()`);
  assert.match(await js('chapterHTML[testCh]'), /Candle/);
  await js('structuralUndo()');
  assert.match(await js('chapterHTML[testCh]'), /Lan<\/em>tern/);
});

test('plain-text snippets are safe and phrase matching respects formatting and paragraph boundaries', async () => {
  await seed();
  await js(`book.chapterNotes[testCh] = '<img src=x onerror=alert(1)> Lantern'; chapterBodyEl(testCh).innerHTML = '<p>Lan<em>tern</em> phrase</p><p>split</p><p>boundary</p>';`);
  assert.equal((await search('Lantern phrase')).length, 1);
  assert.equal((await search('splitboundary')).length, 0);
  await search('lantern');
  assert.equal(await js('document.querySelectorAll("#project-search-results img").length'), 0);
  assert.equal(await js('document.querySelectorAll("#project-search-results mark").length > 0'), true);
});

test('the outline card just edited is included before its delayed blur save', async () => {
  await seed();
  await js(`switchTab('outline'); openCard(document.querySelector('.ob-cell[data-kind="chapter"]')); cardEditor.text.textContent = 'Uncommitted constellation plan'; openSearch();`);
  const found = await search('constellation');
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'outline');
  assert.equal(await js('book.chapterNotes[testCh]'), 'Uncommitted constellation plan');
});

test('a failed note read reports incomplete results and can be retried', async () => {
  await seed();
  failBookNotes = true;
  try {
    assert.equal((await search('lantern')).length, 7);
    assert.match(await js('document.getElementById("project-search-results").textContent'), /Some notes could not/);
  } finally { failBookNotes = false; }
  assert.equal((await search('lantern')).length, 8);
});

test('Enter waits for pending project results, and repeated queries reuse note reads', async () => {
  await seed();
  const before = notesReads;
  await js(`$('#search-input').value = 'lantern'; runSearch(); $('#search-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));`);
  await tick(300);
  assert.equal(await js('searchState.idx'), 0);
  assert.equal(await js('projectReturnRange.toString().toLowerCase()'), 'lantern');
  assert.equal(notesReads - before, 2);
  await search('research');
  assert.equal(notesReads - before, 2);
});

test('late search results cannot replace a newer query or reopen a closed search', async () => {
  await seed();
  await js(`window.realProjectSources = projectSources; projectSources = async (id) => {
    const got = await realProjectSources(id); await new Promise((resolve) => setTimeout(resolve, 100)); return got;
  }; $('#search-input').value = 'lantern'; window.oldSearch = runSearch(); $('#search-input').value = 'absent'; window.newSearch = runSearch();`);
  await js('Promise.all([oldSearch, newSearch])');
  assert.equal(await js('projectSearchMatches.length'), 0);
  assert.equal(await js('document.getElementById("search-count").textContent'), 'none');
  await js(`$('#search-input').value = 'lantern'; window.oldSearch = runSearch(); closeSearch()`);
  await js('oldSearch');
  assert.equal(await js('document.getElementById("project-search-results").hidden'), true);
  assert.equal(await js('projectSearchMatches.length'), 0);
  await js('projectSources = realProjectSources; undefined');
});

test('result lists are bounded and turning the feature off immediately returns to tab scope', async () => {
  await seed();
  await js(`chapterBodyEl(testCh).innerHTML = '<p>' + 'many '.repeat(250) + '</p>'`);
  await search('many');
  assert.equal(await js('document.querySelectorAll(".project-search-result").length'), 200);
  assert.match(await js('document.getElementById("project-search-results").textContent'), /Showing the first 200/);
  await js("setFeature('projectSearch', false)");
  assert.equal(await js('document.getElementById("search-scope").hidden'), true);
  assert.equal(await js('document.getElementById("project-search-results").hidden'), true);
  assert.equal(await js('projectSearchOn()'), false);
  await js("setFeature('projectSearch', true)");
});

test('closing one book clears search results before another book opens', async () => {
  await seed(); await search('lantern');
  await js(`(async () => { await backToShelf(); await addImportedBooks([{ name: 'Other book', chapters: [{ title: 'Other', paras: [{ text: 'Unrelated text' }] }] }], library.shelves[0]); await openBook(library.shelves[0].bookIds.at(-1)); openSearch(); $('#search-scope').value = 'project'; })()`);
  assert.equal((await search('lantern')).length, 0);
  await js(`(async () => { await backToShelf(); await openBook(testBook); })()`);
});

(async () => {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick();
    wc = win.webContents; win.show(); win.focus();
    while (!(await js('typeof library !== "undefined" && !!library').catch(() => false))) await tick();
    await js(`(async () => { await addImportedBooks([{ name: 'Search book', chapters: [{ title: 'First', paras: [{ text: 'First.' }] }] }], library.shelves[0]); await openBook(library.shelves[0].bookIds.at(-1)); })()`);
    for (const t of tests) {
      try {
        await t.fn(); console.log('ok ' + t.name);
        if (t === tests[0] && process.env.NEO_TEST_SHOTS) {
          await tick(400); wc.debugger.attach('1.3');
          const shot = await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: false });
          wc.debugger.detach(); fs.mkdirSync(process.env.NEO_TEST_SHOTS, { recursive: true });
          fs.writeFileSync(path.join(process.env.NEO_TEST_SHOTS, 'project-search.png'), Buffer.from(shot.data, 'base64'));
        }
      } catch (err) { failed++; console.error('FAIL ' + t.name + '\n' + err.stack); }
    }
    console.log(`${tests.length - failed} passed, ${failed} failed`);
  } catch (err) { failed++; console.error(err); }
  finally { app.exit(failed ? 1 : 0); }
})();
