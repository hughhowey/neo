// End-to-end tests for View → Page → E-Ink: black on white for e-ink
// screens. It is chosen from the real menu, the window and the next start
// take its white room, and on the shelf, the page, the panes, the find bar,
// the Outline, Darlings, Options and a right-click menu every element NEO
// draws is pure black, pure white or clear: no gray, color, shadow, fade or
// movement. The controls still wait for the pointer. Switching pages never
// rewrites a chapter. NEO runs on a throwaway library. Run with
// `npm run test:e2e -- eink`.

'use strict';

const { app, BrowserWindow, Menu } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A folder of its own for each run (see words.e2e.js for why earlier runs'
// folders are the ones removed).
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-eink-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-eink-test-${process.pid}-`));
const LIB = path.join(tmp, 'NEO Library');
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(LIB);
fs.writeFileSync(path.join(LIB, 'library.json'), JSON.stringify({
  authorName: 'Ada Writer', penNames: [], firstRunDone: true, pageTheme: 'night',
  features: { cards: true, notesPages: true, poetry: true, footnotes: true, formatting: true, penNames: true, covers: true, pages: true, focus: true, readAloud: true, vim: false, exports: true },
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
// run from scripts/, NEO's window would look for scripts/index.html
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let win, js;
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); } catch (err) { failed++; console.log('FAIL ' + name + '\n     ' + String(err && err.stack || err).split('\n').slice(0, 8).join('\n     ')); }
}
const settle = () => js(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
const pageItem = (label) => Menu.getApplicationMenu().items.find((i) => i.label === 'View')
  .submenu.items.find((i) => i.label === 'Page').submenu.items.find((i) => i.label === label);
const choosePage = async (label) => { pageItem(label).click(); await tick(300); await settle(); };
const pointAt = async (x, y) => { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) }); await tick(120); await settle(); };

// Every element on screen: what isn't black, white or clear, and any shadow,
// transition, animation or partial opacity. A cover's art is left to its
// filter, which must take the hue out.
const FOUND = `(() => {
  const plain = (c) => !c || c === 'none' || c === 'transparent' || c === 'rgb(0, 0, 0)' || c === 'rgb(255, 255, 255)' || /^rgba\\(\\d+, \\d+, \\d+, 0\\)$/.test(c);
  const found = new Set();
  const where = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
  const look = (el, cs, ps) => {
    const at = where(el) + ps;
    if (!plain(cs.backgroundColor)) found.add(at + ' background ' + cs.backgroundColor);
    for (const s of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none' && !plain(cs['border' + s + 'Color'])) found.add(at + ' border ' + cs['border' + s + 'Color']);
    }
    if (cs.boxShadow !== 'none') found.add(at + ' box-shadow');
    if (cs.textShadow !== 'none') found.add(at + ' text-shadow');
    if (cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0)) found.add(at + ' transition');
    if (cs.animationName !== 'none') found.add(at + ' animation');
  };
  for (const el of document.querySelectorAll('body, body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) continue;
    const r = el.getBoundingClientRect();
    if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) continue;
    let o = 1;
    for (let e = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity;
    if (o === 0) continue;
    if (el.closest('.book')) {
      if (el.classList.contains('book') && !/grayscale\\(1\\)/.test(cs.filter)) found.add(where(el) + ' cover in color');
      if (cs.boxShadow !== 'none') found.add(where(el) + ' box-shadow');
      continue;
    }
    if (o < 1) found.add(where(el) + ' opacity ' + o.toFixed(2));
    if (el instanceof SVGElement) {
      if (!plain(cs.fill)) found.add(where(el) + ' fill ' + cs.fill);
      if (!plain(cs.stroke)) found.add(where(el) + ' stroke ' + cs.stroke);
      continue;
    }
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim()) || /^(INPUT|TEXTAREA)$/.test(el.tagName);
    if (text && !plain(cs.color)) found.add(where(el) + ' color ' + cs.color);
    if (/^(INPUT|TEXTAREA)$/.test(el.tagName) && !plain(getComputedStyle(el, '::placeholder').color)) found.add(where(el) + ' placeholder');
    look(el, cs, '');
    for (const ps of ['::before', '::after']) {
      const p = getComputedStyle(el, ps);
      if (p.content !== 'none' && p.content !== 'normal') {
        if (!plain(p.color)) found.add(where(el) + ps + ' color ' + p.color);
        look(el, p, ps);
      }
    }
  }
  return [...found];
})()`;
const onlyBlackAndWhite = async () => assert.deepEqual(await js(FOUND), []);

// each chapter file's text, to show a change of page never writes one
const chapterFiles = () => {
  const out = {};
  for (const dir of fs.readdirSync(LIB).filter((d) => d.startsWith('book-'))) {
    const chapters = path.join(LIB, dir, 'chapters');
    for (const f of fs.readdirSync(chapters)) out[dir + '/' + f] = fs.readFileSync(path.join(chapters, f), 'utf8');
  }
  return out;
};

async function main() {
  await app.whenReady();
  try {
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    js = (code) => win.webContents.executeJavaScript(code, true);
    while (!(await js(`typeof library !== 'undefined' && !!library && !!library.features`).catch(() => false))) await tick(50);
    win.setBounds({ width: 1300, height: 820 });
    await tick(600);
    await js(`(async () => {
      await addImportedBooks([
        { name: 'The Lamp at Dusk', chapters: [
          { title: 'One', paras: [{ text: 'The lighthouse keeper had not spoken to anyone in eleven days.' }, { text: 'She climbed the stairs at dusk.' }, { text: '***' }, { text: 'When the boat came, it came without lights.' }] },
          { title: 'Two', paras: [{ text: 'Morning came grey over the water.' }] }] },
        { name: 'Salt and Iron', chapters: [{ title: 'One', paras: [{ text: 'A line.' }] }] }
      ], library.shelves[0]);
      document.getElementById('hint').hidden = true;
    })()`);
    await tick(800);
    const [W, H] = win.getContentSize();
    const before = chapterFiles();

    await test('View → Page → E-Ink turns the whole app black on white, and the window white', async () => {
      await choosePage('E-Ink');
      assert.equal(pageItem('E-Ink').checked, true);
      assert.equal(pageItem('Night').checked, false);
      assert.equal(await js(`library.pageTheme`), 'eink');
      assert.deepEqual(await js(`['eink', 'light', 'night'].map((c) => document.body.classList.contains(c))`), [true, true, false]);
      assert.equal(win.getBackgroundColor().toLowerCase(), '#ffffff');
      assert.equal(await js(`getComputedStyle(document.documentElement).backgroundColor`), 'rgb(255, 255, 255)');
    });

    await test('the next start opens on E-Ink, in a white window', async () => {
      await tick(200);
      assert.equal(JSON.parse(fs.readFileSync(path.join(LIB, 'library.json'), 'utf8')).pageTheme, 'eink');
      assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'app', 'settings.json'), 'utf8')).pageTheme, 'eink');
    });

    await test('the shelf is black and white, the covers in grays', async () => {
      await pointAt(W / 2, H / 2);
      await onlyBlackAndWhite();
    });

    await test('the page is black and white: text, drop cap, page edge and selection', async () => {
      await js(`(async () => {
        await openBook(library.shelves[0].bookIds[0]);
        const p = [...document.querySelectorAll('.chapter-body p')].find((x) => /lighthouse/.test(x.textContent));
        p.closest('.chapter').scrollIntoView({ block: 'start' });
        const r = document.createRange(); r.setStart(p.firstChild, 4); r.setEnd(p.firstChild, 14);
        getSelection().removeAllRanges(); getSelection().addRange(r);
      })()`);
      await tick(600);
      await onlyBlackAndWhite();
      assert.equal(await js(`getComputedStyle(document.querySelector('.sheet')).borderTopColor`), 'rgb(0, 0, 0)');
      assert.deepEqual(await js(`(() => { const s = getComputedStyle(document.querySelector('.chapter-body p'), '::selection'); return [s.backgroundColor, s.color]; })()`), ['rgb(0, 0, 0)', 'rgb(255, 255, 255)']);
    });

    await test('the bottom bar stays out of sight until the pointer reaches it, then shows at once', async () => {
      await pointAt(W / 2, H / 2);
      assert.equal(await js(`getComputedStyle(document.getElementById('bottombar')).opacity`), '0');
      await pointAt(40, H - 15);
      assert.equal(await js(`getComputedStyle(document.getElementById('bottombar')).opacity`), '1');
      await onlyBlackAndWhite();
      await pointAt(W / 2, H / 2);
    });

    await test('the panes, the find bar, the Outline, Darlings, Options and a menu are black and white', async () => {
      await js(`getSelection().removeAllRanges(); pinPane('nav', true); pinPane('side', true)`);
      await tick(300);
      await onlyBlackAndWhite();
      await js(`pinPane('nav', false); pinPane('side', false); openSearch(); $('#search-input').value = 'the'; runSearch()`);
      await tick(300);
      await onlyBlackAndWhite();
      await js(`closeSearch()`);
      for (const tab of ['outline', 'darlings', 'notes', 'manuscript']) {
        await js(`document.querySelector('.tab[data-tab="${tab}"]').click()`);
        await tick(400);
        await onlyBlackAndWhite();
      }
      await js(`void openOptions(); 0`);
      await tick(400);
      await onlyBlackAndWhite();
      await js(`document.querySelector('.options-modal').closest('.modal-backdrop').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await js(`void popMenu(500, 300, [{ label: 'Open', value: 1 }, { label: 'Ticked', value: 2, checked: true }, { label: 'Delete', value: 3, danger: true }], { title: 'Book' }); 0`);
      await tick(200);
      await onlyBlackAndWhite();
      const first = await js(`(() => { const b = document.querySelector('.pop-menu button').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
      await pointAt(first[0], first[1]);
      assert.equal(await js(`getComputedStyle(document.querySelector('.pop-menu button')).backgroundColor`), 'rgb(0, 0, 0)');
      await onlyBlackAndWhite();
      await js(`popMenu.close()`);
    });

    await test('NEO scrolls in one jump on E-Ink, and the caret holds still', async () => {
      assert.equal(await js(`scrollBehavior()`), 'auto');
      assert.equal(await js(`getComputedStyle(document.querySelector('.chapter-body')).caretAnimation`), 'manual');
      assert.equal(await js(`getComputedStyle(document.querySelector('.chapter-body')).caretColor`), 'rgb(0, 0, 0)');
    });

    await test('back to Night, everything is as it was', async () => {
      await choosePage('Night');
      assert.equal(pageItem('Night').checked, true);
      assert.deepEqual(await js(`['eink', 'light', 'night'].map((c) => document.body.classList.contains(c))`), [false, false, true]);
      assert.equal(win.getBackgroundColor().toLowerCase(), '#191919');
      assert.equal(await js(`getComputedStyle(document.querySelector('.sheet')).backgroundColor`), 'rgb(35, 34, 33)');
    });

    await test('changing the page never rewrites a chapter', async () => {
      await choosePage('E-Ink');
      await choosePage('Paper');
      await choosePage('Light');
      await choosePage('Night');
      await js(`flushAllSaves()`);
      await tick(1200);
      assert.deepEqual(chapterFiles(), before);
    });

    // the color on screen at a point (the window's own pixels, BGRA)
    const pixel = async (x, y) => {
      const b = (await win.webContents.capturePage({ x: Math.round(x), y: Math.round(y), width: 1, height: 1 })).toBitmap();
      return b[2] === 255 && b[1] === 255 && b[0] === 255 ? 'white' : b[2] === 0 && b[1] === 0 && b[0] === 0 ? 'black' : `rgb(${b[2]}, ${b[1]}, ${b[0]})`;
    };
    // the caret into the paragraph holding `word`
    const caretAt = async (word) => {
      await js(`(() => {
        const p = [...document.querySelectorAll('.chapter-body p')].find((x) => x.textContent.includes(${JSON.stringify(word)}));
        p.closest('.chapter-body').focus({ preventScroll: true });
        const r = document.createRange(); r.setStart(p.firstChild, 2); r.collapse(true);
        getSelection().removeAllRanges(); getSelection().addRange(r);
      })()`);
      await tick(250);
      await settle();
    };
    // where the sheet's left and right edges cross the middle of a paragraph
    const edgesBeside = (word) => js(`(() => {
      const p = [...document.querySelectorAll('.chapter-body p')].find((x) => x.textContent.includes(${JSON.stringify(word)}));
      const pr = p.getBoundingClientRect();
      const s = p.closest('.sheet').getBoundingClientRect();
      return { left: s.left + 0.5, right: s.right - 0.5, y: pr.top + pr.height / 2 };
    })()`);
    const edgeColors = async (word) => { const e = await edgesBeside(word); return [await pixel(e.left, e.y), await pixel(e.right, e.y)]; };

    await test('focus mode on E-Ink: the page edge breaks off beside the paragraph in focus, and only there', async () => {
      await choosePage('E-Ink');
      await js(`document.querySelector('.tab[data-tab="manuscript"]').click()`);
      await tick(300);
      await js(`(() => { const p = [...document.querySelectorAll('.chapter-body p')].find((x) => /lighthouse/.test(x.textContent)); p.closest('.chapter').scrollIntoView({ block: 'start' }); setFocus('paragraph'); document.getElementById('hint').hidden = true; })()`);
      await caretAt('stairs');
      assert.deepEqual(await edgeColors('stairs'), ['white', 'white']);
      assert.deepEqual(await edgeColors('lighthouse'), ['black', 'black']);
      assert.deepEqual(await edgeColors('boat'), ['black', 'black']);
      // every word stays full black: no paragraph is dimmed
      assert.deepEqual(await js(`[...document.querySelectorAll('.chapter-body p')].map((p) => getComputedStyle(p).color).filter((c) => c !== 'rgb(0, 0, 0)')`), []);
      await onlyBlackAndWhite();
    });

    await test('the break moves with the caret, follows a sentence, and goes when focus mode does', async () => {
      await caretAt('boat');
      assert.deepEqual(await edgeColors('boat'), ['white', 'white']);
      assert.deepEqual(await edgeColors('stairs'), ['black', 'black']);
      await js(`setFocus('sentence')`);
      await caretAt('lighthouse');
      assert.deepEqual(await edgeColors('lighthouse'), ['white', 'white']);
      assert.equal(await js(`document.querySelectorAll('#focus-gaps span').length`), 2);
      await js(`setFocus('off')`);
      await tick(200);
      assert.deepEqual(await edgeColors('lighthouse'), ['black', 'black']);
    });

    await test('the break is on each page a paragraph reaches in the Pages view', async () => {
      const long = Array.from({ length: 70 }, (_, i) => `Sentence ${i + 1} of the long night watch went on and on.`).join(' ');
      await js(`(() => {
        const p = [...document.querySelectorAll('.chapter-body p')].find((x) => /stairs/.test(x.textContent));
        p.textContent = ${JSON.stringify(long)};
        p.dispatchEvent(new InputEvent('input', { bubbles: true }));
      })()`);
      await js(`togglePaged()`);
      await tick(900);
      await js(`setFocus('paragraph')`);
      await caretAt('Sentence 1 ');
      const pages = await js(`(() => {
        const p = [...document.querySelectorAll('.chapter-body p')].find((x) => /Sentence 1 /.test(x.textContent));
        const r = document.createRange(); r.selectNodeContents(p);
        const lines = [...r.getClientRects()];
        return [...p.closest('.sheet').getClientRects()].filter((f) => lines.some((l) => l.top >= f.top - 1 && l.bottom <= f.bottom + 1 && l.left >= f.left - 1 && l.right <= f.right + 1)).length;
      })()`);
      assert.ok(pages >= 2, 'the paragraph runs onto ' + pages + ' page(s)');
      assert.equal(await js(`document.querySelectorAll('#focus-gaps span').length`), pages * 2);
      await js(`togglePaged(); setFocus('off')`);
    });
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    console.log(`\n${passed} passed, ${failed} failed`);
    app.exit(failed ? 1 : 0);
  }
}
main();
