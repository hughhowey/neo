// End-to-end tests for the Pages view (Format → Show Pages, Two Pages Side
// by Side): the chapters cut into pages the shape of a sheet of paper. NEO
// runs on a throwaway library. Run with `npm run test:pages`.

'use strict';

const { app, BrowserWindow, Menu } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A folder of its own for each run (see words.e2e.js for why earlier runs'
// folders are the ones removed).
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-pages-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-pages-test-${process.pid}-`));
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
const tick = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
const SHOTS = process.env.NEO_SHOTS; // a folder to leave screenshots in, for looking at
const shot = async (name) => { if (SHOTS) fs.writeFileSync(path.join(SHOTS, name + '.png'), (await wc.capturePage()).toPNG()); };

// the pieces each chapter's text is in, in the window's coordinates
const pages = () => js(`(() => [...document.querySelectorAll('#chapters .chapter')].map((sec) => {
  const body = sec.querySelector('.chapter-body');
  const r = (x) => [Math.round(x.left), Math.round(x.top), Math.round(x.width), Math.round(x.height)];
  return {
    kind: sec.className,
    text: body ? [...body.getClientRects()].map(r) : [],
    sheet: [...sec.getClientRects()].map(r),
    pgN: sec.style.getPropertyValue('--pg-n')
  };
}))()`);
const flags = () => js(`({ paged: document.body.classList.contains('paged'), two: document.body.classList.contains('pages-two') })`);
const menuItem = (label) => {
  const find = (items) => { for (const it of items) { if (it.label === label) return it; if (it.submenu) { const f = find(it.submenu.items); if (f) return f; } } return null; };
  return find(Menu.getApplicationMenu().items);
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('the manuscript starts as one long sheet per chapter', async () => {
  assert.deepEqual(await flags(), { paged: false, two: false });
  const ch = await pages();
  assert.equal(ch[0].sheet.length, 1);
  assert.equal(menuItem('Show Pages').checked, false);
  assert.equal(menuItem('Two Pages Side by Side').enabled, false, 'greyed out until the pages are shown');
});

test('Show Pages cuts a chapter into pages of one height with a gap between', async () => {
  await js(`togglePaged()`);
  await tick(300);
  assert.deepEqual(await flags(), { paged: true, two: false });
  const ch = await pages();
  const sheet = ch[0].sheet;
  assert.ok(sheet.length >= 3, `the first chapter is ${sheet.length} pages`);
  const h = sheet[0][3];
  const w = sheet[0][2];
  assert.ok(Math.abs(h / w - 1.4142) < 0.01, `a page is ${w} × ${h}`);
  for (let i = 0; i < sheet.length; i++) {
    assert.ok(Math.abs(sheet[i][3] - h) <= 1, `page ${i + 1} is ${sheet[i][3]} high, not ${h}: the last page is a whole page too`);
    assert.equal(sheet[i][0], sheet[0][0], 'one column of pages');
    if (i) assert.ok(sheet[i][1] - (sheet[i - 1][1] + h) > 10, 'a gap between pages');
  }
  assert.equal(ch[0].text.length, sheet.length, 'no page without text');
  await shot('pages-one');
});

test('the menu shows the tick, and Two Pages Side by Side is available', async () => {
  await tick(300);
  assert.equal(menuItem('Show Pages').checked, true);
  assert.equal(menuItem('Two Pages Side by Side').enabled, true);
});

test('every chapter starts on a fresh page', async () => {
  const ch = await pages();
  const second = ch[1];
  const firstEnd = ch[0].sheet[ch[0].sheet.length - 1];
  assert.ok(second.sheet[0][1] >= firstEnd[1] + firstEnd[3], 'the second chapter starts below the first one\'s last page');
});

test('text stays inside its page', async () => {
  const ch = await pages();
  ch[0].text.forEach((t, i) => {
    const s = ch[0].sheet[i];
    assert.ok(t[1] >= s[1] && t[1] + t[3] <= s[1] + s[3], `page ${i + 1}'s text sticks out of the page`);
    assert.ok(t[0] > s[0] && t[0] + t[2] < s[0] + s[2], `page ${i + 1}'s text reaches its margins`);
  });
});

test('typing past the end of a page makes another, and deleting takes it away', async () => {
  const before = (await pages())[0].sheet.length;
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    for (let i = 0; i < 30; i++) { const p = document.createElement('p'); p.textContent = 'More rain on the harbor, and the boats came in one by one under a grey sky ' + i + '.'; body.append(p); }
  })()`);
  await tick(200);
  const grown = (await pages())[0];
  assert.ok(grown.sheet.length > before, `still ${grown.sheet.length} pages`);
  assert.equal(grown.pgN, String(grown.sheet.length));
  await js(`(() => { const body = document.querySelector('.chapter-body'); for (let i = 0; i < 30; i++) body.lastElementChild.remove(); })()`);
  await tick(200);
  const back = (await pages())[0];
  assert.equal(back.sheet.length, before, 'the extra page goes when its text does');
});

async function key(keyCode) {
  wc.sendInputEvent({ type: 'keyDown', keyCode });
  wc.sendInputEvent({ type: 'keyUp', keyCode });
  await tick(300);
}
const caretTop = () => js(`getSelection().getRangeAt(0).getBoundingClientRect().top`);
const pageTextTop = (i) => js(`[...document.querySelector('.chapter-body').getClientRects()][${i}].top`);

test('the arrow keys carry the caret from the foot of one page to the next, and back', async () => {
  // the caret on the last line of the first page, in view
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    body.focus();
    const first = [...body.getClientRects()][0];
    const last = [...body.children].filter((p) => p.getClientRects()[0].top < first.top + first.height - 40).pop();
    const r = document.createRange(); r.selectNodeContents(last); r.collapse(false);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    const sc = document.getElementById('paper-scroll');
    sc.scrollTop += last.getBoundingClientRect().top - 300;
  })()`);
  await tick(300);
  await key('Down');
  assert.ok(await caretTop() >= (await pageTextTop(1)) - 2, 'ArrowDown stays on the first page');
  await key('Up');
  assert.ok(await caretTop() < (await pageTextTop(1)), 'ArrowUp stays on the second page');
});

test('Two Pages Side by Side puts pages in pairs once two fit the window', async () => {
  await js(`toggleTwoPage()`);
  await tick(300);
  const f = await flags();
  assert.equal(f.paged, true);
  // the window is 1700 wide: two fit at 100%
  assert.equal(f.two, true, 'two pages to a row');
  const ch = await pages();
  const s = ch[0].sheet;
  assert.ok(s[1][0] > s[0][0] + s[0][2], 'the second page is beside the first');
  assert.equal(s[1][1], s[0][1], 'on the same row');
  assert.equal(s[2][0], s[0][0], 'the third page is under the first');
  assert.equal(menuItem('Two Pages Side by Side').checked, true);
  await shot('pages-two');
});

test('zoomed in until two do not fit, one page to a row again', async () => {
  await js(`setPageZoom(2)`);
  await tick(300);
  assert.equal((await flags()).two, false);
  await js(`setPageZoom(1)`);
  await tick(300);
  assert.equal((await flags()).two, true);
});

test('the page can be zoomed out to 40% in the Pages view, and no further', async () => {
  await js(`setPageZoom(0.1)`);
  await tick(300);
  assert.equal(await js(`activePageZoom()`), 0.4);
  await shot('pages-zoomed-out');
  await js(`setPageZoom(1)`);
  await tick(300);
});

test('Two Pages Side by Side greys out when the pages are hidden, and keeps its tick', async () => {
  await js(`togglePaged()`);
  await tick(300);
  assert.deepEqual(await flags(), { paged: false, two: false });
  assert.equal(menuItem('Two Pages Side by Side').enabled, false);
  assert.equal(menuItem('Two Pages Side by Side').checked, true, 'it comes back as it was');
  const ch = await pages();
  assert.equal(ch[0].sheet.length, 1, 'one long sheet again');
  await js(`togglePaged()`);
  await tick(300);
  assert.equal((await flags()).two, true);
});

test('the page zoom comes back to 75% at the least when the pages are hidden', async () => {
  await js(`setPageZoom(0.4)`);
  await tick(200);
  await js(`togglePaged()`);
  await tick(200);
  assert.equal(await js(`activePageZoom()`), 0.75);
  await js(`togglePaged()`);
  await tick(200);
  assert.equal(await js(`activePageZoom()`), 0.4, 'and 40% again with them');
  await js(`setPageZoom(1)`);
  await tick(200);
});

test('a click in a page\'s margin puts the caret in that page\'s text', async () => {
  const hit = await js(`(() => {
    const body = document.querySelector('.chapter-body');
    const rects = [...body.getClientRects()];
    const sec = body.closest('.chapter');
    const sheets = [...sec.getClientRects()];
    return { x: sheets[1].left + 8, y: rects[1].top + rects[1].height / 2, top: rects[1].top, bottom: rects[1].top + rects[1].height };
  })()`);
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(hit.x), y: Math.round(hit.y), button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(hit.x), y: Math.round(hit.y), button: 'left', clickCount: 1 });
  await tick(300);
  const caret = await js(`(() => { const r = getSelection().getRangeAt(0).getBoundingClientRect(); return [r.top, r.bottom]; })()`);
  assert.ok(caret[0] >= hit.top - 40 && caret[1] <= hit.bottom + 40, `the caret is at ${caret}, not on the second page (${hit.top}–${hit.bottom})`);
});

/* ---------- runner ---------- */

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    win.setBounds({ width: 1700, height: 1000 });
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(300);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      await addImportedBooks([{ name: 'Pages', chapters: [
        { title: 'One', paras: Array.from({ length: 90 }, (_, i) => ({ text: 'Rain fell on the harbor and the boats came in one by one under a grey sky, and Mara counted every one of them as it passed the light ' + i + '.' })) },
        { title: 'Two', paras: Array.from({ length: 40 }, (_, i) => ({ text: 'The next morning the harbor was quiet and the water lay flat and bright between the slips ' + i + '.' })) }
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
