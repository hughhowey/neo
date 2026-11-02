// End-to-end tests for word counts. NEO runs on a throwaway library, a book
// comes in the way a dropped manuscript does, and every count is read off
// the screen the way the writer sees it. Run with `npm run test:words`.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A folder of its own for each run. Chromium writes to its profile until
// the process is gone, so a run can't remove its own; it removes those of
// earlier runs whose process has ended instead, leaving any still running.
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-words-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-words-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, moreFeatures: true, pageTheme: 'night',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
// run from scripts/, NEO's window would look for scripts/index.html
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const text = (id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`);

// typed as keys: '\n' is Enter
async function type(keys) {
  for (const k of keys) {
    const keyCode = k === '\n' ? 'Enter' : k;
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'char', keyCode: k === '\n' ? '\r' : k });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
  }
  await tick(300); // the page gets sent keys asynchronously, and counts after them
}

// the caret at the end of the chapter, as a click after its last word leaves it
async function caretAtEnd() {
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    body.focus();
    const r = document.createRange();
    r.selectNodeContents(body.lastElementChild);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await tick(300); // the counters catch up with a moved caret after a moment
}

// 51 paragraphs of five words: 255 words, two manuscript pages. A count
// that runs paragraphs together finds 50 words fewer, and one page.
const PARAS = 51;
const LINE = 'Rain fell on the harbor.';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('the book counter counts every paragraph\'s words', async () => {
  assert.equal(await text('word-counter'), '255 words');
});

test('opening the book keeps the count the import saved', async () => {
  assert.equal(await js('book.wordCount'), 255);
});

test('the chapter counter counts every paragraph\'s words', async () => {
  await caretAtEnd();
  await js(`document.getElementById('word-counter').click()`);
  try {
    assert.match(await text('word-counter'), /: 255 words$/);
  } finally {
    await js(`document.getElementById('word-counter').click()`);
  }
});

test('the page the caret is on counts the words before it', async () => {
  await caretAtEnd();
  await js(`document.getElementById('pos-counter').click()`);
  try {
    assert.equal(await text('pos-counter'), 'page 2 of 2');
  } finally {
    await js(`document.getElementById('pos-counter').click()`);
  }
});

test('a selection across paragraphs counts their words', async () => {
  await caretAtEnd();
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    const r = document.createRange();
    r.selectNodeContents(body);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await tick(300);
  try {
    assert.equal(await text('word-counter'), '255 selected');
  } finally {
    await caretAtEnd();
  }
});

// the double click's first click moves the caret, which asks for a recount
// a moment later; the word the second click selects keeps its count
test('a double-clicked word counts as selected', async () => {
  await caretAtEnd();
  const [x, y] = await js(`(() => {
    const p = document.querySelector('.chapter-body').lastElementChild;
    p.scrollIntoView({ block: 'center' });
    const r = document.createRange();
    r.setStart(p.firstChild, 0);
    r.setEnd(p.firstChild, 4); // Rain
    const box = r.getBoundingClientRect();
    return [Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2)];
  })()`);
  for (const clickCount of [1, 2]) {
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount });
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount });
    await tick(60); // a hand's double click, not one event
  }
  await tick(300);
  try {
    assert.equal(await js('getSelection().toString().trim()'), 'Rain');
    assert.equal(await text('word-counter'), '1 selected');
  } finally {
    await caretAtEnd();
  }
});

test('a paragraph typed after the last one adds its words', async () => {
  await caretAtEnd();
  await type('\nwind off the sea.');
  assert.equal(await js(`document.querySelectorAll('.chapter-body > p').length`), PARAS + 1);
  assert.equal(await text('word-counter'), '259 words');
});

/* ---------- each paragraph's count, kept until it changes ---------- */

// The counter keeps each paragraph's count until the paragraph changes. Each
// edit below is one the kept counts could miss; the count must still match
// the chapter counted whole, the way NEO counted before it kept them.
const COUNT_CHECK = `(() => {
  const body = document.querySelector('.chapter-body');
  const id = body.closest('.chapter').dataset.id;
  const whole = document.createElement('div');
  whole.innerHTML = body.innerHTML;
  whole.querySelectorAll('.darling-anchor, .ph-mark, .ghost').forEach((n) => n.remove());
  whole.querySelectorAll('p, div, br').forEach((e) => e.after('\\n'));
  wordCache[id] = null;
  return { counted: chapterWords(id), whole: countWords(whole.textContent), byParagraph: paragraphWords(body) };
})()`;

// byParagraph false: the chapter is one paragraphs can't be summed for, and
// is counted whole
async function countsMatch(byParagraph = true) {
  const c = await js(COUNT_CHECK);
  assert.equal(c.counted, c.whole);
  assert.equal(c.byParagraph, byParagraph ? c.whole : null);
  return c.counted;
}

async function caretIn(index, offset) {
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    body.focus();
    const p = body.children[${index}];
    p.scrollIntoView({ block: 'center' });
    getSelection().collapse(p.firstChild, ${offset});
  })()`);
  await tick(100);
}

async function key(keyCode, modifiers = []) {
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await tick(300);
}

test('typing in a paragraph recounts it', async () => {
  await caretAtEnd();
  const before = await countsMatch();
  await type(' gulls');
  assert.equal(await countsMatch(), before + 1);
});

test('Enter in the middle of a word makes two words', async () => {
  await caretIn(3, 'Rain fell on the har'.length);
  const before = await countsMatch();
  await type('\n');
  assert.equal(await countsMatch(), before + 1);
});

test('Backspace at the start of a paragraph joins it to the one above', async () => {
  await caretIn(4, 0); // "bor." from the split above
  await key('Backspace');
  await countsMatch();
});

test('a line break inside a word, with no new letter, makes two words', async () => {
  await caretIn(6, 'Rain fell on the har'.length);
  const before = await countsMatch();
  await js(`document.execCommand('insertLineBreak')`);
  assert.equal(await countsMatch(), before + 1);
});

test('italics, a paste and undo keep the count true', async () => {
  await js(`(() => {
    const p = document.querySelector('.chapter-body').children[8];
    const r = document.createRange();
    r.setStart(p.firstChild, 5);
    r.setEnd(p.firstChild, 9);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    document.execCommand('italic');
  })()`);
  await countsMatch();
  await caretIn(10, 4);
  await js(`document.execCommand('insertHTML', false, '<p>one two</p><p>three four five</p>')`);
  await countsMatch();
  for (let i = 0; i < 3; i++) {
    await js(`document.execCommand('undo')`);
    await countsMatch();
  }
});

test('a paragraph turned into a ghost stops counting, and back', async () => {
  const before = await countsMatch();
  await js(`document.querySelector('.chapter-body').children[12].classList.add('ghost')`);
  assert.equal(await countsMatch(), before - 5);
  await js(`document.querySelector('.chapter-body').children[12].classList.remove('ghost')`);
  assert.equal(await countsMatch(), before);
});

test('a placeholder mark inside a word keeps the word whole', async () => {
  const before = await countsMatch();
  await js(`(() => {
    const p = document.querySelector('.chapter-body').children[14];
    const mark = document.createElement('span');
    mark.className = 'ph-mark';
    mark.textContent = '⚑';
    p.firstChild.splitText(2).before(mark);
  })()`);
  assert.equal(await countsMatch(), before);
});

test('a paragraph changed while off the page is counted again', async () => {
  const before = await countsMatch();
  await js(`window.__away = document.querySelector('.chapter-body').children[16]; __away.remove()`);
  await tick(50); // past the moment a removed node is still watched
  await js(`__away.firstChild.appendData(' and two more')`);
  await tick(50);
  await js(`document.querySelector('.chapter-body').children[16].before(__away)`);
  assert.equal(await countsMatch(), before + 3);
});

test('page of pages counts a ghost above the caret, as it always has', async () => {
  await js(`document.getElementById('pos-counter').click()`);
  try {
    await caretIn(20, 4);
    const page = () => js(`(() => {
      const body = document.querySelector('.chapter-body');
      const sel = getSelection();
      const r = document.createRange();
      r.selectNodeContents(body);
      r.setEnd(sel.anchorNode, sel.anchorOffset);
      return [wordsBeforeCaret(body, sel.anchorNode, sel.anchorOffset), countWords(plainText(r.cloneContents()))];
    })()`);
    const [fast, whole] = await page();
    assert.equal(fast, whole);
    await js(`document.querySelector('.chapter-body').children[2].classList.add('ghost')`);
    assert.deepEqual(await page(), [whole, whole]);
    await js(`document.querySelector('.chapter-body').children[2].classList.remove('ghost')`);
  } finally {
    await js(`document.getElementById('pos-counter').click()`);
  }
});

test('Thai, or words loose between paragraphs, count the chapter whole', async () => {
  await js(`document.querySelector('.chapter-body').insertAdjacentHTML('beforeend', '<p>ภาษาไทยง่ายนิดเดียว</p>')`);
  await countsMatch(false);
  await js(`document.querySelector('.chapter-body').lastElementChild.remove()`);
  await js(`document.querySelector('.chapter-body').append('loose words')`);
  await countsMatch(false);
  await js(`document.querySelector('.chapter-body').lastChild.remove()`);
  await countsMatch();
});

test('a thousand random edits keep the count true', async () => {
  const bad = await js(`(async () => {
    const body = document.querySelector('.chapter-body');
    const id = body.closest('.chapter').dataset.id;
    let seed = 7;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const pick = (a) => a[rnd(a.length)];
    const whole = () => {
      const h = document.createElement('div');
      h.innerHTML = body.innerHTML;
      h.querySelectorAll('.darling-anchor, .ph-mark, .ghost').forEach((n) => n.remove());
      h.querySelectorAll('p, div, br').forEach((e) => e.after('\\n'));
      return countWords(h.textContent);
    };
    const texts = (p) => { const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); const out = []; while (w.nextNode()) out.push(w.currentNode); return out; };
    const ops = {
      type(p) { const t = texts(p); if (t.length) { const n = pick(t); n.insertData(rnd(n.length + 1), pick([' ', 'a', 'word ', '. ', ' — '])); } },
      cut(p) { const t = texts(p); if (t.length) { const n = pick(t); const at = rnd(n.length + 1); n.deleteData(at, rnd(6)); } },
      split(p) { const t = texts(p); if (!t.length) return; const n = pick(t); const tail = n.splitText(rnd(n.length + 1)); const q = document.createElement('p'); q.append(tail); p.after(q); },
      join(p) { const q = p.nextElementSibling; if (q && q.tagName === 'P') { p.append(...q.childNodes); q.remove(); } },
      br(p) { const t = texts(p); if (t.length) { const n = pick(t); n.splitText(rnd(n.length + 1)).before(document.createElement('br')); } },
      italic(p) { const t = texts(p); if (t.length) { const n = pick(t); const i = document.createElement('i'); n.before(i); i.append(n); } },
      mark(p) { const t = texts(p); if (t.length) { const n = pick(t); const s = document.createElement('span'); s.className = pick(['ph-mark', 'darling-anchor']); s.textContent = '⚑'; n.splitText(rnd(n.length + 1)).before(s); } },
      ghost(p) { p.classList.toggle('ghost'); },
      unwrap(p) { const m = p.querySelector('i, span'); if (m) m.replaceWith(...m.childNodes); },
      remove(p) { if (body.children.length > 5) p.remove(); },
      move(p) { const q = pick([...body.children]); if (q !== p) q.before(p); },
      rewrite(p) { p.innerHTML = pick(['new words here', 'a<br>b', '<b>bold</b> move', '', 'x <i>y</i>z']); },
      add() { const q = document.createElement('p'); q.textContent = 'fresh line of words'; pick([...body.children]).after(q); },
      normalize(p) { p.normalize(); }
    };
    // page of pages: the words from the chapter's start to a caret, as they stand
    const upTo = (node, offset) => {
      const r = document.createRange();
      r.selectNodeContents(body);
      r.setEnd(node, offset);
      return countWords(plainText(r.cloneContents()));
    };
    const names = Object.keys(ops);
    let summed = 0;
    for (let i = 0; i < 1000; i++) {
      const name = pick(names);
      ops[name](pick([...body.children]));
      if (rnd(3) === 0) await Promise.resolve(); // let the observer report on its own too
      wordCache[id] = null;
      const counted = chapterWords(id);
      const w = whole();
      if (counted !== w) return { i, name, counted, whole: w };
      const t = texts(body);
      if (t.length) {
        const n = pick(t);
        const at = rnd(n.length + 1);
        const fast = wordsBeforeCaret(body, n, at);
        if (fast != null) summed++;
        if (fast != null && fast !== upTo(n, at)) return { i, name, page: true, fast, whole: upTo(n, at) };
      }
    }
    if (summed < 500) return { summed }; // the kept counts must actually be the ones used
    return null;
  })()`);
  assert.equal(bad, null);
});

/* ---------- today's count: words read from disk aren't today's (#345) ---------- */

// The library is synced between two computers. Each book below comes in on
// disk the way the other one leaves it, and today's count is read off the
// screen.
const LIB = path.join(tmp, 'NEO Library');
const many = (n, word) => Array.from({ length: n }, () => word).join(' ');
const folder = (id) => path.join(LIB, fs.readdirSync(LIB).find((d) => d.endsWith(id)));
const bookJson = (id) => JSON.parse(fs.readFileSync(path.join(folder(id), 'book.json'), 'utf8'));
const chapterFile = (id, i) => path.join(folder(id), 'chapters', bookJson(id).chapterOrder[i] + '.html');
const TWO = [{ title: 'One', paras: [{ text: many(60, 'rain') }] }, { title: 'Two', paras: [{ text: many(2000, 'sea') }] }];
async function shelvedBook(name, chapters) {
  return js(`(async () => {
    if (book) await backToShelf();
    await addImportedBooks([{ name: ${JSON.stringify(name)}, chapters: ${JSON.stringify(chapters)} }], library.shelves[0]);
    const ids = library.shelves[0].bookIds;
    return ids[ids.length - 1];
  })()`);
}
async function open(id) {
  await js(`openBook(${JSON.stringify(id)})`);
  await tick(500);
}
async function lookAtDisk() {
  await js(`refreshFromDisk()`);
  await tick(500);
}

test('a chapter still syncing when the book opened adds nothing to today', async () => {
  const id = await shelvedBook('Syncing', TWO);
  const file = chapterFile(id, 1);
  const words = fs.readFileSync(file, 'utf8');
  fs.unlinkSync(file);
  await open(id);
  assert.equal(await text('goal-counter'), '0 today');
  fs.writeFileSync(file, words);
  await lookAtDisk();
  assert.equal(await js('bookWordCount()'), 2060);
  assert.equal(await text('goal-counter'), '0 today');
});

test('words written today on the other computer stay today\'s; a late chapter adds none', async () => {
  const id = await shelvedBook('Two computers', TWO);
  const meta = bookJson(id);
  meta.dailyCounts = { [await js('todayStr()')]: { start: 1660, end: 2060 } }; // 400 written there
  fs.writeFileSync(path.join(folder(id), 'book.json'), JSON.stringify(meta));
  const file = chapterFile(id, 1);
  const words = fs.readFileSync(file, 'utf8');
  fs.unlinkSync(file);
  await open(id);
  assert.equal(await text('goal-counter'), '400 today');
  await tick(3200); // longer than a slow cloud read takes
  await caretAtEnd();
  await type(' gulls');
  assert.equal(await text('goal-counter'), '401 today');
  fs.writeFileSync(file, words);
  await lookAtDisk();
  assert.equal(await text('goal-counter'), '401 today');
});

test('the other computer\'s copy of a chapter, kept beside it, adds nothing to today', async () => {
  const id = await shelvedBook('Both changed', [{ title: 'One', paras: [{ text: many(1200, 'reef') }] }]);
  await open(id);
  await caretAtEnd();
  await type(' gulls');
  fs.writeFileSync(chapterFile(id, 0), '<p>' + many(1200, 'reef') + ' moon</p>');
  await tick(1500); // the save finds their version and keeps it as the next chapter
  assert.equal(await js('book.chapterOrder.length'), 2);
  assert.equal(await text('goal-counter'), '1 today');
});

test('the other computer counting more today is taken in, and typing adds to it', async () => {
  const id = await shelvedBook('Both open', [{ title: 'One', paras: [{ text: many(500, 'dune') }] }]);
  await open(id);
  const meta = bookJson(id);
  meta.dailyCounts = { [await js('todayStr()')]: { start: 100, end: 400 } };
  fs.writeFileSync(path.join(folder(id), 'book.json'), JSON.stringify(meta));
  await lookAtDisk();
  assert.equal(await text('goal-counter'), '300 today');
  await caretAtEnd();
  await type(' gulls');
  assert.equal(await text('goal-counter'), '301 today');
});

// A part isn't the story's words, so making a chapter one takes its words out
// of the count and back makes them count again: neither is writing (#436).
test('a chapter made a part, and back, adds nothing to today', async () => {
  const id = await shelvedBook('Parts', TWO);
  await open(id);
  assert.equal(await text('goal-counter'), '0 today');
  const second = await js('book.chapterOrder[1]');
  const makeIt = (kind) => js(`(async () => {
    const real = window.popMenu;
    window.popMenu = async () => ${JSON.stringify(kind)};
    try { await chapterMenu(${JSON.stringify(second)}, 10, 10); } finally { window.popMenu = real; }
  })()`);
  await makeIt('part');
  assert.equal(await js('bookWordCount()'), 60);
  assert.equal(await text('goal-counter'), '0 today');
  await makeIt('chapter');
  assert.equal(await js('bookWordCount()'), 2060);
  assert.equal(await text('goal-counter'), '0 today');
  // taking the change back (⌘Z) and doing it again (⇧⌘Z) is no writing either
  await makeIt('part');
  await js('structuralUndo()');
  await tick(400);
  assert.equal(await js('bookWordCount()'), 2060);
  assert.equal(await text('goal-counter'), '0 today');
  await js('structuralRedo()');
  await tick(400);
  assert.equal(await js('bookWordCount()'), 60);
  assert.equal(await text('goal-counter'), '0 today');
});

// Words that move from one chapter to another are neither written nor cut:
// a chapter split in two, a card dropped on another chapter, a card made a
// chapter (#471). They leave one chapter a moment before they reach the
// other, and today never goes below zero, so they came back as new writing.
test('words moved between chapters add nothing to today', async () => {
  const lines = (n, w) => Array.from({ length: n }, (_, i) => ({ text: many(100, w + i) }));
  const id = await shelvedBook('Moves', [{ title: 'One', paras: lines(40, 'rain') }, { title: 'Two', paras: [{ text: many(300, 'sea') }] }]);
  await open(id);
  assert.equal(await text('goal-counter'), '0 today');
  await caretAtEnd();
  await type(' gulls');
  const total = await js('bookWordCount()');
  assert.equal(await text('goal-counter'), '1 today');
  // split the first chapter at its twentieth paragraph (what three Enters do)
  await js(`(() => {
    const chId = book.chapterOrder[0];
    const body = document.querySelector('.chapter[data-id="' + chId + '"] .chapter-body');
    const block = body.children[20];
    const sel = getSelection();
    const r = document.createRange();
    r.setStart(block, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    splitChapterAt(body, chId, block, sel, null);
  })()`);
  await tick(500);
  assert.equal(await js('book.chapterOrder.length'), 3);
  assert.equal(await js('bookWordCount()'), total);
  assert.equal(await text('goal-counter'), '1 today');
  // a card of the first chapter dropped on the last, and another made a chapter
  await js(`(() => {
    const [first, , last] = book.chapterOrder;
    const body = document.querySelector('.chapter[data-id="' + first + '"] .chapter-body');
    body.insertBefore(Object.assign(document.createElement('p'), { className: 'scene-break', textContent: '***' }), body.children[10]);
    syncChapter(body, first);
    moveSection(first, 1, { ch: last, before: null });
  })()`);
  await tick(500);
  assert.equal(await js('bookWordCount()'), total);
  assert.equal(await text('goal-counter'), '1 today');
  await js(`sectionToChapter(book.chapterOrder[2], 1)`);
  await tick(500);
  assert.equal(await js('bookWordCount()'), total);
  assert.equal(await text('goal-counter'), '1 today');
  // and what is written after still counts
  await caretAtEnd();
  await type(' wheel');
  assert.equal(await text('goal-counter'), '2 today');
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
      await addImportedBooks([{ name: 'Words', chapters: [
        { title: 'One', paras: Array.from({ length: ${PARAS} }, () => ({ text: ${JSON.stringify(LINE)} })) }
      ] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
    })()`);
    await tick(300);
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
