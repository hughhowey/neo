// End-to-end tests for card colours (#533, #512): a colour picked from a
// card's right-click menu, kept in book.json beside the note, taken back by
// ⌘Z, carried along when the card moves, and shown in the List and on the
// cards beside the page; a script's scenes too.
// Run with `npm run test:card-colours`; NEO_SHOT=<file.png> keeps a picture.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-colour-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-colour-test-${process.pid}-`));
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
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await tick(50); } throw new Error('timed out'); };

// a card on the board: the chapter's (by chapter), or a section's (by its letter)
const CH = (i) => `book.chapterOrder.filter((c) => isStory(c))[${i}]`;
const chapterCell = (i) => `document.querySelector('#outline-board .ob-cell[data-kind="chapter"][data-ch="' + ${CH(i)} + '"]')`;
const sectionCell = (i, letter) => `[...document.querySelectorAll('#outline-board .ob-cell[data-kind="section"][data-ch="' + ${CH(i)} + '"]')].find((c) => c.querySelector('.ob-letter').textContent === '${letter}')`;
const listLine = (i, secLetter) => secLetter
  ? `[...document.querySelectorAll('#outline-list .ol-line.ol-section[data-ch-id="' + ${CH(i)} + '"]')].find((l) => l.querySelector('.ol-num').textContent === '${secLetter}')`
  : `document.querySelector('#outline-list .ol-line.ol-chapter[data-ch-id="' + ${CH(i)} + '"]')`;
// a right-click menu opened by `open`, its colour row read, then a colour picked
const swatches = () => js(`[...document.querySelectorAll('.pop-menu .pm-swatch')].map((b) => b.getAttribute('aria-label') + (b.classList.contains('sel') ? '*' : ''))`);
const openMenu = async (open) => {
  await js(`(() => { ${open}; })()`);
  await until(() => js(`!!document.querySelector('.pop-menu')`));
};
const pick = async (label) => {
  await js(`document.querySelector('.pop-menu .pm-swatch[aria-label="${label}"]').click()`);
  await until(() => js(`!document.querySelector('.pop-menu')`));
  await tick(100);
};
const closeMenu = async () => { await js(`popMenu.close && popMenu.close()`); await tick(50); };
const colourOf = (cellExpr) => js(`(${cellExpr} || {}).dataset ? (${cellExpr}).dataset.color || '' : 'no card'`);
const bookJson = async () => {
  await js(`saveMeta()`);
  await tick(300);
  const id = await js('book.id');
  const folder = fs.readdirSync(lib).find((n) => n.startsWith('book-') && n.endsWith(id));
  assert.ok(folder, 'the book’s folder');
  return JSON.parse(fs.readFileSync(path.join(lib, folder, 'book.json'), 'utf8'));
};
const board = async () => { await js(`library.outlineView = 'cards'; switchTab('outline'); renderOutline()`); await tick(200); };

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a section card’s right-click menu has six colours and No colour; a pick paints the card', async () => {
  await board();
  await openMenu(`cardMenu(${sectionCell(0, 'A')}, 40, 40)`);
  assert.deepEqual(await swatches(), ['No colour*', 'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple']);
  await pick('Blue');
  assert.equal(await colourOf(sectionCell(0, 'A')), 'blue');
  assert.match(await js(`getComputedStyle((${sectionCell(0, 'A')}).querySelector('.ob-card')).backgroundImage`), /gradient/, 'the band across its top');
});

test('a section with no note gets an empty one, carried by its first line, as a first note would', async () => {
  const notes = await js(`JSON.parse(JSON.stringify(book.sectionNotes[${CH(0)}]))`);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].text, '');
  assert.equal(notes[0].color, 'blue');
  assert.equal(await js(`(${sectionCell(0, 'A')}).dataset.sec`), notes[0].id);
  assert.match(await js(`chapterHTML[${CH(0)}]`), new RegExp(`data-sec-id="${notes[0].id}"`));
  // and the card still shows the section's first line, not an empty note
  assert.match(await js(`(${sectionCell(0, 'A')}).querySelector('.ob-text').textContent`), /^“The second scene/);
});

test('the menu marks the colour a card has; No colour takes it off; another replaces it', async () => {
  await openMenu(`cardMenu(${sectionCell(0, 'A')}, 40, 40)`);
  assert.deepEqual((await swatches()).filter((s) => s.endsWith('*')), ['Blue*']);
  await pick('No colour');
  assert.equal(await colourOf(sectionCell(0, 'A')), '');
  assert.equal(await js(`'color' in book.sectionNotes[${CH(0)}][0]`), false);
  await openMenu(`cardMenu(${sectionCell(0, 'A')}, 40, 40)`);
  await pick('Green');
  assert.equal(await colourOf(sectionCell(0, 'A')), 'green');
});

test('a chapter card takes a colour from its menu on the board, but not from the Chapters pane', async () => {
  await openMenu(`cardMenu(${chapterCell(0)}, 40, 40)`);
  assert.equal((await swatches()).length, 7);
  await pick('Red');
  assert.equal(await colourOf(chapterCell(0)), 'red');
  await openMenu(`chapterMenu(${CH(0)}, 40, 40)`);
  assert.deepEqual(await swatches(), [], 'the sidebar’s menu has no colours: nothing there shows them');
  await closeMenu();
  // a loose card too
  await js(`book.looseCards = [{ id: 'lc-idea', text: 'An idea for later' }]; renderLooseCards()`);
  await openMenu(`cardMenu(document.querySelector('#loose-list .ob-cell[data-loose="lc-idea"]'), 40, 40)`);
  await pick('Yellow');
  assert.equal(await colourOf(`document.querySelector('#loose-list .ob-cell[data-loose="lc-idea"]')`), 'yellow');
  assert.match(await js(`getComputedStyle(document.querySelector('#loose-list .ob-cell[data-loose="lc-idea"] .ob-card')).backgroundImage`), /gradient/);
});

test('colours are kept in book.json beside the notes', async () => {
  const meta = await bookJson();
  const ch0 = await js(CH(0));
  assert.deepEqual(meta.chapterColors, { [ch0]: 'red' });
  assert.equal(meta.sectionNotes[ch0][0].color, 'green');
  assert.equal(meta.looseCards.find((c) => c.id === 'lc-idea').color, 'yellow');
});

test('⌘Z takes a colour back, one pick at a time', async () => {
  await js(`structuralUndo()`);
  await tick(300);
  await board();
  assert.equal(await js(`book.looseCards.find((c) => c.id === 'lc-idea').color || ''`), '');
  await js(`structuralUndo()`);
  await tick(300);
  await board();
  assert.equal(await colourOf(chapterCell(0)), '', 'the chapter’s red');
  assert.equal(await js(`'chapterColors' in book`), false, 'an empty map leaves book.json');
  assert.equal(await colourOf(sectionCell(0, 'A')), 'green', 'the pick before stays');
  await openMenu(`cardMenu(${chapterCell(0)}, 40, 40)`);
  await pick('Red');
});

test('a coloured section keeps its colour onto the loose cards and back into another chapter', async () => {
  const segIdx = await js(`Number((${sectionCell(0, 'A')}).dataset.seg)`);
  await js(`writtenSectionToLoose(${CH(0)}, chapterSegments(${CH(0)})[${segIdx}])`);
  await until(() => js(`book.looseCards.some((c) => c.html)`));
  await tick(300);
  const card = await js(`JSON.parse(JSON.stringify(book.looseCards.find((c) => c.html)))`);
  assert.equal(card.color, 'green');
  assert.equal(await colourOf(`document.querySelector('#loose-list .ob-cell[data-loose="${card.id}"]')`), 'green');
  await js(`looseToSection('${card.id}', { ch: ${CH(1)}, before: null })`);
  await tick(300);
  await board();
  const placed = await js(`JSON.parse(JSON.stringify(book.sectionNotes[${CH(1)}] || []))`);
  assert.equal(placed.length, 1);
  assert.equal(placed[0].color, 'green');
  assert.equal(await colourOf(sectionCell(1, 'A')), 'green');
});

test('a coloured section made a chapter gives the chapter its colour', async () => {
  const segIdx = await js(`Number((${sectionCell(1, 'A')}).dataset.seg)`);
  await js(`sectionToChapter(${CH(1)}, ${segIdx})`);
  await tick(300);
  await board();
  assert.equal(await colourOf(chapterCell(2)), 'green');
  assert.equal(await js(`book.chapterColors[${CH(2)}]`), 'green');
});

test('a coloured chapter dropped into another becomes a section of that colour', async () => {
  await js(`joinChapter(${CH(2)}, ${CH(1)})`);
  await tick(400);
  await board();
  assert.equal(await js(`(book.sectionNotes[${CH(1)}] || []).map((s) => s.color || '').join()`), 'green');
  assert.equal(await js(`Object.keys(book.chapterColors).length`), 1, 'the joined chapter’s own colour is gone with it');
});

test('a coloured chapter set aside on a loose card keeps its colour, and brings it back', async () => {
  const chId = await js(CH(1));
  await openMenu(`cardMenu(${chapterCell(1)}, 40, 40)`);
  await pick('Purple');
  await js(`chapterToLoose(${CH(1)})`);
  await until(() => js(`book.looseCards.some((c) => c.held === 'chapter')`));
  await tick(300);
  const card = await js(`JSON.parse(JSON.stringify(book.looseCards.find((c) => c.held === 'chapter')))`);
  assert.equal(card.color, 'purple');
  assert.equal(card.notes[0].color, 'green', 'its sections’ colours go along');
  assert.equal(await colourOf(`document.querySelector('#loose-list .ob-cell[data-loose="${card.id}"]')`), 'purple');
  assert.equal(await js(`book.chapterColors['${chId}'] || ''`), '', 'the chapter’s entry left with it');
  await js(`looseToChapter('${card.id}', 1)`);
  await tick(400);
  await board();
  assert.notEqual(await js(CH(1)), chId);
  assert.equal(await colourOf(chapterCell(1)), 'purple');
  assert.equal(await js(`(book.sectionNotes[${CH(1)}] || []).map((s) => s.color || '').join()`), 'green');
});

test('the List shows the colours by each line’s number, and a section line’s menu sets one', async () => {
  // a second note in chapter 1, for the List to show
  await openMenu(`cardMenu(${sectionCell(0, 'A')}, 40, 40)`);
  await pick('Blue');
  await js(`library.outlineView = 'list'; renderOutline()`);
  await tick(200);
  assert.equal(await colourOf(listLine(0)), 'red');
  assert.equal(await colourOf(listLine(0, 'A')), 'blue');
  assert.equal(await js(`getComputedStyle((${listLine(0)}).querySelector('.ol-num'), '::before').backgroundColor`), 'rgb(207, 90, 78)');
  await openMenu(`(${listLine(0, 'A')}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }))`);
  assert.deepEqual(await js(`[...document.querySelectorAll('.pop-menu button:not(.pm-swatch)')].map((b) => b.textContent)`), ['Delete section…']);
  await pick('Purple');
  assert.equal(await colourOf(listLine(0, 'A')), 'purple');
  await openMenu(`(${listLine(0)}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }))`);
  await pick('Orange');
  assert.equal(await colourOf(listLine(0)), 'orange');
  assert.equal(await js(`book.chapterColors[${CH(0)}]`), 'orange');
  if (process.env.NEO_SHOT_LIST) { await tick(200); fs.writeFileSync(process.env.NEO_SHOT_LIST, (await wc.capturePage()).toPNG()); }
});

test('the cards beside the page wear their colours while writing', async () => {
  await js(`switchTab('manuscript')`);
  await tick(200);
  await js(`(() => {
    const p = document.querySelector('.chapter[data-id="' + ${CH(0)} + '"] .chapter-body p');
    const r = document.createRange(); r.setStart(p.firstChild, 2); r.collapse(true);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    sideCardsUpdate(true);
  })()`);
  await tick(100);
  assert.deepEqual(await js(`[...document.querySelectorAll('#side-cards .side-card')].map((c) => c.dataset.color || '')`), ['orange', 'purple']);
  // a colour changed on the Outline is there on coming back
  await board();
  await openMenu(`cardMenu(${chapterCell(0)}, 40, 40)`);
  await pick('Green');
  await js(`switchTab('manuscript')`);
  await tick(200);
  await js(`sideCardsUpdate()`);
  assert.equal(await js(`document.querySelector('#side-cards .side-card-chapter').dataset.color`), 'green');
});

test('Delete the note takes a written section’s words, and leaves its colour', async () => {
  await board();
  await js(`(() => { const s = book.sectionNotes[${CH(0)}][0]; s.text = 'The storm breaks'; renderBoard(); })()`);
  await tick(100);
  await openMenu(`cardMenu(${sectionCell(0, 'A')}, 40, 40)`);
  await js(`[...document.querySelectorAll('.pop-menu button')].find((b) => b.textContent === 'Delete the note').click()`);
  await tick(300);
  const note = await js(`JSON.parse(JSON.stringify(book.sectionNotes[${CH(0)}][0]))`);
  assert.equal(note.text, '');
  assert.equal(note.color, 'purple');
  assert.equal(await colourOf(sectionCell(0, 'A')), 'purple');
  // with nothing written on it, the note has no words left to delete
  await openMenu(`cardMenu(${sectionCell(0, 'A')}, 40, 40)`);
  assert.equal(await js(`[...document.querySelectorAll('.pop-menu button')].find((b) => b.textContent === 'Delete the note').disabled`), true);
  if (process.env.NEO_SHOT) { await tick(200); fs.writeFileSync(process.env.NEO_SHOT, (await wc.capturePage()).toPNG()); }
  await closeMenu();
});

test('with outline cards turned off, colours still show but no menu offers them', async () => {
  await js(`library.features.cards = false; library.outlineView = 'list'; renderOutline()`);
  await tick(200);
  assert.equal(await colourOf(listLine(0)), 'green');
  await openMenu(`(${listLine(0)}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }))`);
  assert.deepEqual(await swatches(), []);
  await closeMenu();
  // a section line goes straight to its Delete, as before
  await js(`(${listLine(0, 'A')}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }))`);
  await until(() => js(`!!document.querySelector('.modal-backdrop')`));
  assert.equal(await js(`!!document.querySelector('.pop-menu')`), false);
  await js(`document.querySelector('.modal-backdrop .m-cancel, .modal-backdrop .btn-quiet').click()`);
  await tick(200);
  await js(`library.features.cards = true`);
});

test('a script’s scene takes a colour, keeps it on a loose card, and brings it back', async () => {
  await js(`createScriptOnShelf(library.shelves[0])`);
  await until(() => js(`!!book && isScript()`));
  await tick(300);
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    body.innerHTML = '<p class="sp-heading">INT. KITCHEN - DAY</p><p>Ada pours the coffee.</p><p class="sp-heading">EXT. YARD - NIGHT</p><p>The dog barks at nothing.</p>';
    syncChapter(body, book.chapterOrder[0]);
  })()`);
  await board();
  const scene = (n) => `document.querySelectorAll('#outline-board .ob-cell[data-kind="scene"]')[${n}]`;
  await openMenu(`cardMenu(${scene(1)}, 40, 40)`);
  assert.equal((await swatches()).length, 7, 'a script always has its cards, and their colours');
  await pick('Orange');
  assert.equal(await colourOf(scene(1)), 'orange');
  const sid = await js(`(${scene(1)}).dataset.sid`);
  assert.ok(sid, 'the scene got an id');
  assert.equal(await js(`book.sceneNotes['${sid}']`), '');
  assert.equal(await js(`book.sceneColors['${sid}']`), 'orange');
  assert.equal(await js(`document.querySelectorAll('.chapter-body p.sp-heading')[1].dataset.sceneId`), sid);
  await js(`sceneToLoose(${scene(1)})`);
  await until(() => js(`(book.looseCards || []).some((c) => c.held === 'scene')`));
  await tick(300);
  const card = await js(`JSON.parse(JSON.stringify(book.looseCards.find((c) => c.held === 'scene')))`);
  assert.equal(card.color, 'orange');
  assert.equal(await js(`'sceneColors' in book`), false, 'the scene’s own entry left with it');
  await js(`looseToScene('${card.id}', 0)`);
  await tick(300);
  await board();
  assert.equal(await colourOf(scene(0)), 'orange', 'back in, first, and still orange');
  assert.equal(await js(`Object.values(book.sceneColors).join()`), 'orange');
});

/* ---------- runner ---------- */

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    // the window's own errors, in the test's output
    wc.on('console-message', (e, level, msg) => { const m = (e && e.message) || msg; const l = e && e.level !== undefined ? e.level : level; if (l === 'error' || l === 3) console.log('     [window] ' + m); });
    while (!(await js(`typeof library !== 'undefined' && !!library && !!library.features`).catch(() => false))) await tick(50);
    await tick(300);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      library.features.cards = true;
      const p = (text) => ({ text });
      await addImportedBooks([{ name: 'The Lantern Year', chapters: [
        { title: 'The Weigh Station', paras: [p('The scale was older than the road.'), p('The clerk wrote the crate down.'), { scene: true }, p('The second scene opens at the river.'), p('The ferryman was asleep.'), { scene: true }, p('The third scene is the city.')] },
        { title: 'Salt Road', paras: [p('The convoy left at dawn and did not stop until the river.')] }
      ] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
    })()`);
    await tick(500);
    win.focus();
    for (const t of tests) {
      try {
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.message).replace(/\n/g, '\n     '));
        await js(`popMenu.close && popMenu.close()`).catch(() => {});
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
