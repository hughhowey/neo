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
  authorName: '', penNames: [], firstRunDone: true, pageTheme: 'night',
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
