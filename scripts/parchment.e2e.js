// End-to-end tests for View → Page → Parchment: a warm cream page with
// brown ink, and the whole app warm with it. It is chosen from the real
// menu, the window and the next start take its warm room, and on the shelf,
// the page, the panes, the find bar, the Outline, Darlings, Notes, Options,
// the paperback and manuscript dialogs and a right-click menu every color NEO draws keeps blue below red, none is
// pure white, and every line of text reads at 4.5:1 or is no fainter than
// the same line on Light (the hints are quiet on purpose). Switching pages
// never rewrites a chapter. NEO runs on a throwaway library. Run with
// `npm run test:e2e -- parchment`.

'use strict';

const { app, BrowserWindow, Menu } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A folder of its own for each run (see words.e2e.js for why earlier runs'
// folders are the ones removed).
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-parchment-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-parchment-test-${process.pid}-`));
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

// Every element on screen: each color that has blue at or above red, or is
// pure white; and for each kind of element with text, the lowest contrast
// of what shows (its color over what is behind it, faded by any opacity).
// The covers keep their own art.
const LOOK = `(() => {
  const parse = (c) => {
    if (!c || c === 'none' || c === 'transparent' || c === 'currentcolor') return null;
    let m = c.match(/^rgba?\\(([^)]+)\\)/);
    if (m) { const v = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; }
    m = c.match(/^color\\(srgb ([^)]+)\\)/);
    if (m) { const v = m[1].split(/[ \\/]+/).filter(Boolean).map(Number); return [v[0] * 255, v[1] * 255, v[2] * 255, v.length > 3 ? v[3] : 1]; }
    return 'unknown';
  };
  const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };
  const where = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
  const cold = new Set();
  const contrast = {};
  const check = (el, what, c) => {
    const v = parse(c);
    if (v === null || v[3] === 0) return;
    if (v === 'unknown') { cold.add(where(el) + ' ' + what + ' unread ' + c); return; }
    if (v[2] >= v[0] || (v[0] === 255 && v[1] === 255 && v[2] === 255)) cold.add(where(el) + ' ' + what + ' ' + c);
  };
  const behind = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) { const v = parse(getComputedStyle(e).backgroundColor); if (v && v !== 'unknown' && v[3] > 0) { layers.push(v); if (v[3] === 1) break; } }
    let base = parse(getComputedStyle(document.documentElement).backgroundColor);
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };
  for (const el of document.querySelectorAll('body, body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) continue;
    const r = el.getBoundingClientRect();
    if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) continue;
    if (el.closest('.book')) continue;
    let o = 1;
    for (let e = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity;
    if (o === 0) continue;
    if (el instanceof SVGElement) { check(el, 'fill', cs.fill); check(el, 'stroke', cs.stroke); continue; }
    check(el, 'color', cs.color);
    check(el, 'background', cs.backgroundColor);
    for (const s of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none') check(el, 'border', cs['border' + s + 'Color']);
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) check(el, 'outline', cs.outlineColor);
    for (const sh of cs.boxShadow.match(/(rgba?|color)\\([^)]*\\)/g) || []) check(el, 'shadow', sh);
    for (const ps of ['::before', '::after']) {
      const p = getComputedStyle(el, ps);
      if (p.content !== 'none' && p.content !== 'normal') { check(el, ps + ' color', p.color); check(el, ps + ' background', p.backgroundColor); }
    }
    if (/^(INPUT|TEXTAREA)$/.test(el.tagName)) check(el, 'placeholder', getComputedStyle(el, '::placeholder').color);
    // a checkbox, radio button or slider: the system draws it in its own blue
    // unless the page names a color
    if (el.tagName === 'INPUT' && /^(checkbox|radio|range)$/.test(el.type)) {
      if (cs.accentColor === 'auto') cold.add(where(el) + ' accent-color auto (the system blue)');
      else check(el, 'accent-color', cs.accentColor);
    }
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim()) || /^(INPUT|TEXTAREA)$/.test(el.tagName);
    const fg = parse(cs.color);
    if (!text || !fg || fg === 'unknown') continue;
    const bg = behind(el);
    const shown = over([fg[0], fg[1], fg[2], fg[3] * o], bg);
    const a = lum(shown), b = lum(bg);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const k = where(el);
    if (!(k in contrast) || ratio < contrast[k]) contrast[k] = ratio;
  }
  return { cold: [...cold], contrast };
})()`;

// the views a writer passes through, each looked at once
async function tour() {
  const seen = [];
  const look = async (name) => { await tick(350); await settle(); seen.push({ name, ...(await js(LOOK)) }); };
  await js(`document.getElementById('back-to-shelf').offsetParent && document.getElementById('back-to-shelf').click()`);
  await look('shelf');
  await js(`(async () => {
    await openBook(library.shelves[0].bookIds[0]);
    const p = [...document.querySelectorAll('.chapter-body p')].find((x) => /lighthouse/.test(x.textContent));
    p.closest('.chapter').scrollIntoView({ block: 'start' });
    document.getElementById('hint').hidden = true;
  })()`);
  await look('page');
  await js(`pinPane('nav', true); pinPane('side', true)`);
  await look('panes');
  await js(`pinPane('nav', false); pinPane('side', false); openSearch(); $('#search-input').value = 'the'; runSearch()`);
  await look('find');
  await js(`closeSearch()`);
  for (const tab of ['outline', 'darlings', 'notes', 'manuscript']) {
    await js(`document.querySelector('.tab[data-tab="${tab}"]').click()`);
    await look(tab);
  }
  await js(`void openOptions(); 0`);
  await look('options');
  await js(`document.querySelector('.options-modal').closest('.modal-backdrop').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  // the print and export dialogs
  for (const [name, open, modal] of [['paperback', 'printPaperback()', '.print-modal'], ['manuscript', 'manuscriptDialog(manuscriptDefaults(), 90000)', '.ms-modal']]) {
    await js(`void ${open}; 0`);
    await look(name);
    await js(`(() => { const m = document.querySelector('${modal}'); if (m) m.closest('.modal-backdrop').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return !!m; })()`);
    await tick(200);
  }
  await js(`void popMenu(500, 300, [{ label: 'Open', value: 1 }, { label: 'Ticked', value: 2, checked: true }, { label: 'Off', value: 3, disabled: true }, { label: 'Delete', value: 4, danger: true }], { title: 'Book' }); 0`);
  await look('menu');
  await js(`popMenu.close()`);
  await js(`document.getElementById('back-to-shelf').click()`);
  await tick(300);
  return seen;
}
const lowest = (seen) => {
  const out = {};
  for (const s of seen) for (const [k, v] of Object.entries(s.contrast)) if (!(k in out) || v < out[k]) out[k] = v;
  return out;
};

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
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 650, y: 400 });
    const before = chapterFiles();

    await test('View → Page → Parchment warms the whole app, and the window', async () => {
      await choosePage('Parchment');
      assert.equal(pageItem('Parchment').checked, true);
      assert.equal(pageItem('Night').checked, false);
      assert.equal(await js(`library.pageTheme`), 'parchment');
      assert.deepEqual(await js(`['parchment', 'light', 'night'].map((c) => document.body.classList.contains(c))`), [true, true, false]);
      assert.equal(win.getBackgroundColor().toLowerCase(), '#e6d5b3');
      assert.equal(await js(`getComputedStyle(document.documentElement).backgroundColor`), 'rgb(230, 213, 179)');
    });

    await test('the next start opens on Parchment, in a warm window', async () => {
      await tick(200);
      assert.equal(JSON.parse(fs.readFileSync(path.join(LIB, 'library.json'), 'utf8')).pageTheme, 'parchment');
      assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'app', 'settings.json'), 'utf8')).pageTheme, 'parchment');
    });

    let parchment;
    await test('on the shelf, the page, the panes, the find bar, the tabs, Options, the print dialogs and a menu, blue stays below red, with no pure white', async () => {
      parchment = await tour();
      const cold = parchment.flatMap((s) => s.cold.map((c) => s.name + ': ' + c));
      assert.deepEqual(cold, []);
    });

    await test('the page is cream with brown ink, and the selection amber', async () => {
      await js(`(async () => { await openBook(library.shelves[0].bookIds[0]); const p = [...document.querySelectorAll('.chapter-body p')].find((x) => /lighthouse/.test(x.textContent)); const r = document.createRange(); r.setStart(p.firstChild, 4); r.setEnd(p.firstChild, 14); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
      await tick(400);
      assert.equal(await js(`getComputedStyle(document.querySelector('.sheet')).backgroundColor`), 'rgb(239, 225, 196)');
      assert.equal(await js(`getComputedStyle(document.querySelector('.chapter-body p')).color`), 'rgb(58, 44, 27)');
      assert.equal(await js(`getComputedStyle(document.querySelector('.chapter-body p'), '::selection').backgroundColor`), 'rgba(196, 136, 24, 0.3)');
      await js(`getSelection().removeAllRanges(); document.getElementById('back-to-shelf').click()`);
      await tick(300);
    });

    await test('every line of text reads at 4.5:1, or no fainter than the same line on Light', async () => {
      await choosePage('Light');
      const light = lowest(await tour());
      await choosePage('Parchment');
      const mine = lowest(parchment);
      for (const v of ['paperback', 'manuscript']) assert.ok(parchment.find((x) => x.name === v && Object.keys(x.contrast).length > 5), `the ${v} dialog was seen`);
    const fainter = Object.entries(mine)
        .filter(([k, v]) => v < 4.5 && v + 0.005 < Math.min(4.5, k in light ? light[k] : 4.5))
        .map(([k, v]) => `${k}: ${v.toFixed(2)} (Light ${k in light ? light[k].toFixed(2) : 'none'})`);
      assert.deepEqual(fainter, []);
      assert.ok(Object.keys(mine).length > 40, 'the tour saw the text');
    });

    await test('back to Night, everything is as it was', async () => {
      await choosePage('Night');
      assert.equal(pageItem('Night').checked, true);
      assert.deepEqual(await js(`['parchment', 'light', 'night'].map((c) => document.body.classList.contains(c))`), [false, false, true]);
      assert.equal(win.getBackgroundColor().toLowerCase(), '#191919');
    });

    await test('changing the page never rewrites a chapter', async () => {
      await choosePage('Parchment');
      await choosePage('Paper');
      await choosePage('Light');
      await choosePage('Night');
      await js(`flushAllSaves()`);
      await tick(1200);
      assert.deepEqual(chapterFiles(), before);
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
