// End-to-end tests for the Notes tab's pages: the book's and one for each
// chapter, the left pane that turns them and the right pane beside them.
// Run with `npm run test:notes`.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-notes-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-notes-test-${process.pid}-`));
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

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const paneState = () => js(`['nav-pane', 'side-pane'].map((id) => { const p = document.getElementById(id); return id + ':' + (p.classList.contains('open') ? 'open' : 'shut') + '/' + (p.dataset.pinned === '1' ? 'pinned' : '-'); }).join(' ')`);
const move = async (x, y) => { wc.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) }); await tick(120); };
const realClick = async (sel) => {
  const r = await js(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  await move(r.x, r.y);
  for (const type of ['mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 });
  await tick(300);
  return r;
};

test('Notes opens on the chapter being written', async () => {
  await caretIn(1);
  await clickTab('notes');
  assert.equal(await js('notesPage'), await ch(1));
  assert.equal(await js(`document.getElementById('aux-title').textContent`), 'Chapter 2 — Salt Road');
  assert.equal(await js(`document.getElementById('notes-up').hidden`), false);
});

test('a chapter\'s notes are its own file; the book\'s notes.html is left alone', async () => {
  await js(`(() => { const ed = document.getElementById('aux-editor'); ed.focus(); getSelection().selectAllChildren(ed); getSelection().collapseToEnd(); })()`);
  await type('Check the distance to Varga.');
  await save();
  const id = await ch(1);
  assert.match(onDisk(`notes-${id}.html`) || '', /Check the distance to Varga\./);
  assert.doesNotMatch(onDisk('notes.html') || '', /Varga/);
});

test('the left pane lists the book\'s page, then every chapter, the shown one marked', async () => {
  const rows = await js(`[...document.querySelectorAll('#notes-nav .notes-item')].map((r) => r.dataset.page + (r.classList.contains('current') ? '*' : ''))`);
  const ids = await js(`book.chapterOrder.filter((c) => isStory(c))`);
  assert.deepEqual(rows, ['book', ids[0], ids[1] + '*', ids[2]]);
  assert.match(await js(`document.querySelector('#notes-nav .notes-item.current .nav-note').textContent`), /Varga/);
});

test('clicking a chapter in the pane turns the page and stays in Notes', async () => {
  const id = await ch(2);
  await js(`document.querySelector('#notes-nav .notes-item[data-page="${id}"]').click()`);
  await tick(300);
  assert.equal(await js('currentTab'), 'notes');
  assert.equal(await js('notesPage'), id);
  assert.equal(await js(`document.getElementById('aux-editor').innerHTML`), '');
});

test('The Book is the old Notes page, and the way up from a chapter goes there', async () => {
  await js(`document.getElementById('notes-up').click()`);
  await tick(300);
  assert.equal(await js('notesPage'), 'book');
  assert.equal(await js(`document.getElementById('notes-up').hidden`), true);
  await js(`(() => { const ed = document.getElementById('aux-editor'); ed.focus(); })()`);
  await type('The lantern is never explained.');
  await save();
  assert.match(onDisk('notes.html') || '', /never explained/);
});

test('the right pane: the chapter\'s outline note, placeholders and darlings', async () => {
  const id = await ch(1);
  await js(`(() => {
    book.chapterNotes[${JSON.stringify(id)}] = 'The convoy leaves without Teo.';
    stickies.push({ id: 's-test', chapterId: ${JSON.stringify(id)}, text: 'Two days by cart, or three?', resolved: false });
    darlings.unshift({ id: 'd-test', html: '<p>A line cut</p>', text: 'A line cut from here.', chapterId: ${JSON.stringify(id)}, chapterLabel: 'Scene', date: new Date().toISOString() });
  })()`);
  await js(`document.querySelector('#notes-nav .notes-item[data-page="${id}"]').click()`);
  await tick(300);
  assert.equal(await js(`document.querySelector('#side-head .side-title-chnotes').textContent`), 'From this chapter');
  assert.equal(await js(`document.querySelector('#notes-side .ns-outline').textContent`), 'The convoy leaves without Teo.');
  assert.match(await js(`document.getElementById('notes-outline').textContent`), /convoy leaves/);
  const texts = await js(`[...document.querySelectorAll('#notes-side .ns-text')].map((n) => n.textContent)`);
  assert.deepEqual(texts, ['Two days by cart, or three?', 'A line cut from here.']);
});

test('Copy to notes adds the line to the end of the chapter\'s notes', async () => {
  await js(`document.querySelector('#notes-side .ns-darling .s-actions button').click()`);
  await tick(100);
  assert.match(await js(`document.getElementById('aux-editor').lastElementChild.textContent`), /A line cut from here\./);
  await save();
  assert.match(onDisk(`notes-${await ch(1)}.html`) || '', /Varga[\s\S]*A line cut/);
});

test('editing the outline note there changes the chapter\'s outline note', async () => {
  await js(`(() => { const n = document.querySelector('#notes-side .ns-outline'); n.focus(); n.textContent = 'Teo stays behind.'; n.dispatchEvent(new Event('input')); n.blur(); })()`);
  await tick(100);
  assert.equal(await js(`book.chapterNotes[${JSON.stringify(await ch(1))}]`), 'Teo stays behind.');
  assert.match(await js(`document.getElementById('notes-outline').textContent`), /Teo stays behind/);
});

test('screenshot (NEO_SHOT=file.png)', async () => {
  if (!process.env.NEO_SHOT) return;
  await js(`(() => { pinPane('nav', true); pinPane('side', true); })()`);
  await tick(500);
  fs.writeFileSync(process.env.NEO_SHOT, (await wc.capturePage()).toPNG());
  await js(`(() => { document.body.classList.add('light'); })()`);
  await tick(300);
  fs.writeFileSync(process.env.NEO_SHOT.replace(/\.png$/, '-light.png'), (await wc.capturePage()).toPNG());
  await js(`(() => { document.body.classList.remove('light'); pinPane('nav', false); pinPane('side', false); })()`);
});

test('the book\'s page lists every open placeholder', async () => {
  await js(`document.getElementById('notes-up').click()`);
  await tick(300);
  assert.equal(await js(`document.querySelector('#side-head .side-title-chnotes').textContent`), 'Across the book');
  assert.deepEqual(await js(`[...document.querySelectorAll('#notes-side .ns-text')].map((n) => n.textContent)`), ['Two days by cart, or three?']);
});

test('the Manuscript\'s panes are themselves again outside Notes', async () => {
  await clickTab('manuscript');
  assert.equal(await js(`getComputedStyle(document.getElementById('nav-list')).display`), 'block');
  assert.equal(await js(`getComputedStyle(document.getElementById('notes-nav')).display`), 'none');
  assert.equal(await js(`getComputedStyle(document.getElementById('notes-side')).display`), 'none');
  assert.equal(await js(`getComputedStyle(document.getElementById('sticky-list')).display`), 'block');
});

test('a chapter merged up brings its notes to the chapter above', async () => {
  const [a, b] = [await ch(0), await ch(1)];
  await js(`foldNotesPage(${JSON.stringify(b)}, ${JSON.stringify(a)})`);
  await tick(400);
  assert.match(onDisk(`notes-${a}.html`) || '', /Varga/);
  assert.match(onDisk(`notes-${b}.html`) || '', /Varga/); // its own file stays, for ⌘Z
});

test('a chapter deleted takes its notes to Darlings', async () => {
  const id = await ch(1);
  await js(`deleteChapterToDarlings(${JSON.stringify(id)})`);
  await tick(400);
  const d = await js(`darlings.find((x) => /^notes for/.test(x.chapterLabel))`);
  assert.ok(d, 'a darling for the notes');
  assert.match(d.text, /Varga/);
});


// The right pane's pin once sat under the window's drag strip, where a click
// moved the window instead (macOS): neither pane could be kept open there.
test('both panes can be kept open in Notes, with real clicks, through a page turn', async () => {
  await clickTab('notes');
  const w = await js('innerWidth');
  await move(500, 300); await move(4, 300); await move(10, 300);
  await realClick('#nav-pin');
  await move(w - 4, 300); await move(w - 8, 300);
  const r = await realClick('#side-pin');
  assert.equal(await js(`document.elementFromPoint(${Math.round(r.x)}, ${Math.round(r.y)}).id`), 'side-pin');
  assert.ok(r.y - 9 >= 28, 'the pin clears the 28px drag strip');
  await move(w / 2, 300); await move(w / 2 + 20, 320);
  await realClick('#notes-nav .notes-item:last-child');
  await move(w / 2, 300);
  assert.equal(await paneState(), 'nav-pane:open/pinned side-pane:open/pinned');
  await js(`pinPane('nav', false); pinPane('side', false)`);
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
