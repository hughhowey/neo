// End-to-end tests for papers. NEO runs on a throwaway library; a paper is
// made the way a writer makes one (New Paper on a shelf) and written in with
// real keys: a heading, a sentence, $maths$, a citation picked with @, a
// figure, a table. Then every way out is taken and read back.
// Run with `npm run test:paper`; NEO_SHOTS=<folder> saves a screenshot of
// each step there.

'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-paper-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-paper-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const LIB = path.join(tmp, 'NEO Library');
fs.mkdirSync(LIB);
fs.writeFileSync(path.join(LIB, 'library.json'), JSON.stringify({
  authorName: 'Ada Lovelace', penNames: [], firstRunDone: true, pageTheme: process.env.NEO_THEME || 'paper',
  shelves: [{ id: 'shelf-1', name: 'Papers', bookIds: [] }]
}));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
// exports land in the test folder, no dialog
const OUT = path.join(tmp, 'out');
fs.mkdirSync(OUT);
dialog.showSaveDialog = async (_w, opts) => ({ canceled: false, filePath: path.join(OUT, path.basename(opts.defaultPath)) });
require('../main.js');

const SHOTS = process.env.NEO_SHOTS || '';
let wc;
let shot = 0;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
async function snap(name) {
  if (!SHOTS) return;
  await tick(250);
  const img = await wc.capturePage();
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, `${String(++shot).padStart(2, '0')}-${name}.png`), img.toPNG());
}
async function key(keyCode, modifiers = []) {
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (keyCode.length === 1 && !modifiers.some((m) => m === 'meta' || m === 'control')) wc.sendInputEvent({ type: 'char', keyCode, modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await tick(30);
}
async function type(text) {
  for (const k of text) {
    if (k === '\n') {
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      wc.sendInputEvent({ type: 'char', keyCode: '\r' });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    } else {
      wc.sendInputEvent({ type: 'keyDown', keyCode: k });
      wc.sendInputEvent({ type: 'char', keyCode: k });
      wc.sendInputEvent({ type: 'keyUp', keyCode: k });
    }
    await tick(12);
  }
  await tick(250);
}
const bodyHtml = () => js(`document.querySelector('.chapter-body').innerHTML`);
const saved = async () => {
  await js('flushAllSaves()');
  await tick(400);
  const dir = fs.readdirSync(LIB).find((d) => d.startsWith('book-'));
  const meta = JSON.parse(fs.readFileSync(path.join(LIB, dir, 'book.json'), 'utf8'));
  return { dir: path.join(LIB, dir), meta, html: fs.readFileSync(path.join(LIB, dir, 'chapters', meta.chapterOrder[0] + '.html'), 'utf8') };
};
// the caret at the end of the paper's last paragraph
const caretAtEnd = () => js(`(() => {
  const body = document.querySelector('.chapter-body');
  body.focus();
  const r = document.createRange();
  r.selectNodeContents(body.lastElementChild);
  r.collapse(false);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
})()`);

const BIB = `@article{smith2020neural,
  author = {Smith, Jane and Doe, John and Lee, Ann},
  title = {Neural dynamics of inhibition},
  journal = {Journal of Neuroscience}, year = {2020}, volume = {40}, number = {3}, pages = {100--120},
  doi = {10.1234/jn.2020.1}
}
@book{doe2019brains,
  author = {Doe, John}, title = {Brains and Minds}, publisher = {MIT Press}, year = {2019}
}`;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('New Paper on a shelf makes a paper and opens it on its title page', async () => {
  await js(`createPaperOnShelf(library.shelves[0])`);
  await tick(1500);
  assert.equal(await js('isPaper()'), true);
  assert.equal(await js(`document.activeElement.id`), 'tp-title');
  assert.equal(await js(`document.querySelector('.tab[data-tab="references"]').hidden`), false);
  assert.equal(await js(`document.querySelector('.tab[data-tab="outline"]').hidden`), true);
  // the shape of a paper to start from, each empty section saying what it answers
  assert.deepEqual(await js(`[...document.querySelectorAll('.chapter-body p.h1')].map((h) => h.textContent)`),
    ['Introduction', 'Methods', 'Results', 'Discussion', 'Acknowledgements', 'Data availability', 'Author contributions', 'Competing interests']);
  assert.deepEqual(await js(`[...document.querySelectorAll('.chapter-body p.h1')].map((h) => h.dataset.num || '')`), ['1', '2', '3', '4', '', '', '', ''], 'back matter goes unnumbered');
  assert.match(await js(`document.querySelector('.chapter-body p[data-hint]').dataset.hint`), /^Why, who and when/);
  assert.equal(await js(`document.querySelectorAll('.chapter-body p[data-hint]').length`), 8);
  assert.match(await js(`document.querySelectorAll('.chapter-body p[data-hint]')[5].dataset.hint`), /^Where the data and code are/);
  await type('Inhibition in cortical circuits');
  assert.equal(await js(`document.getElementById('tp-title-count').textContent`), '31 / 100 characters');
  await snap('new-paper');
  const { html } = await saved();
  assert.doesNotMatch(html, /data-hint/, 'the hints are never saved');
  // the rest of these steps write into the Introduction alone
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    while (body.children.length > 2) body.lastElementChild.remove();
    syncChapter(body, body.closest('.chapter').dataset.id);
  })()`);
});

test('the empty abstract shows its six moves; writing it leaves only their names', async () => {
  const shown = () => js(`getComputedStyle(document.querySelector('.tp-abstract-guide')).display`);
  assert.deepEqual(await js(`[...document.querySelectorAll('.tp-abstract-guide b')].map((b) => b.textContent)`),
    ['Status quo', 'Problem', 'Broader solution', 'What we did', 'What we found', 'Implications']);
  assert.equal(await shown(), 'block', 'the scaffold, while the abstract is empty');
  await snap('abstract-empty');
  BrowserWindow.fromWebContents(wc).focus();
  await js(`document.getElementById('tp-abstract').focus()`);
  await type('Cortex keeps excitation and inhibition in balance.');
  assert.equal(await shown(), 'flex', 'only the names, while writing');
  assert.equal(await js(`document.querySelectorAll('.tp-abstract-guide li.done').length`), 1, 'one sentence: the status quo');
  // the workshop's own abstract makes all six moves
  await js(`(() => {
    const a = document.getElementById('tp-abstract');
    a.innerHTML = '<p>Artificial neural networks simplify complex biological circuits into tractable computational models. It is often said that the simplicity of artificial models undermines their applicability to real brain dynamics. Typical efforts to address this mismatch add complexity to increasingly unwieldy models. We instead use simplified cortical cultures derived from human stem cells to compare model and reality. We uncovered surprisingly variable network activity across cultures from families with a common genetic variant. Our research showcases a promising personalised medicine approach for epilepsy.</p>';
    a.dispatchEvent(new Event('input'));
  })()`);
  assert.deepEqual(await js(`[...document.querySelectorAll('.tp-abstract-guide li')].map((l) => l.classList.contains('done'))`), [true, true, true, true, true, true]);
  await snap('abstract-writing');
  await js(`document.getElementById('tp-title').focus()`);
  await tick(100);
  assert.equal(await shown(), 'none', 'gone, once the caret is elsewhere');
  await js(`(() => { const a = document.getElementById('tp-abstract'); a.innerHTML = ''; a.dispatchEvent(new Event('input')); })()`);
});

test('MathJax and citeproc load', async () => {
  for (let i = 0; i < 60 && !(await js('!!(window.MathJax && window.MathJax.tex2svg && window.CSL)')); i++) await tick(200);
  assert.equal(await js('!!(window.MathJax && window.MathJax.tex2svg)'), true);
  // maths is drawn, never a link or a styled element: no \\href, \\class, \\style, \\require
  for (const tex of ['\\href{https://example.com/x}{V}', '\\class{x}{V}', '\\style{color:red}{V}', '\\require{html}\\href{https://example.com}{V}']) {
    assert.equal(await js(`(() => { const s = texSvg(${JSON.stringify(tex)}, false); return s ? s.querySelectorAll('a, [style*="red"]').length : 0; })()`), 0, tex);
  }
  assert.ok(await js(`!!texSvg(${JSON.stringify('\\frac{a}{b}')}, false)`), 'and ordinary maths still draws');
  assert.equal(await js('!!window.CSL'), true);
  assert.equal(await js('typeof window.module'), 'undefined', 'citeproc leaves no module behind');
});

test('references pasted as BibTeX into the References tab', async () => {
  await js(`switchTab('references')`);
  await tick(200);
  await js(`paperImportText(${JSON.stringify(BIB)}, 'test')`);
  await tick(400);
  assert.equal(await js(`document.querySelectorAll('#references-view .rl-row').length`), 2);
  await snap('references-tab');
  const { dir } = await saved();
  const refs = JSON.parse(fs.readFileSync(path.join(dir, 'references.json'), 'utf8'));
  assert.deepEqual(refs.map((r) => r.id), ['smith2020neural', 'doe2019brains']);
  await js(`switchTab('manuscript')`);
  await tick(200);
});

test('typing: a sentence, $maths$, and a citation picked with @', async () => {
  await caretAtEnd();
  await type('Cortex balances excitation and inhibition $E = I$ as shown by @smi');
  assert.equal(await js(`!!document.querySelector('.paper-picker')`), true, 'the picker opens on @');
  assert.match(await js(`document.querySelector('.paper-picker .pp-row.active .pp-main').textContent`), /Smith et al\. 2020/);
  await snap('picker');
  await key('Enter');
  await tick(500);
  const html = await bodyHtml();
  assert.match(html, /<span class="math" contenteditable="false">E = I<\/span>/);
  assert.match(html, /<span class="cite" contenteditable="false" data-cite="\[\{&quot;id&quot;:&quot;smith2020neural&quot;\}\]">\(Smith et al\., 2020\)<\/span>/);
  assert.equal(await js(`!!document.querySelector('.chapter-body .math').shadowRoot.querySelector('svg')`), true, 'the maths is drawn');
  // a second @ right after joins the citation
  await type(' @doe');
  await key('Enter');
  await tick(500);
  assert.match(await js(`document.querySelector('.chapter-body .cite').textContent`), /^\(Doe, 2019; Smith et al\., 2020\)$/);
  await type('.');
  assert.match(await js(`document.querySelector('#paper-refs').textContent`), /Brains and Minds/);
  await snap('cited');
});

test('# makes a section heading, numbered; Enter after it is body text', async () => {
  await type('\n# Methods\nWe recorded from cortex.');
  const html = await bodyHtml();
  assert.match(html, /<p class="h1" data-id="sec-\w+" data-num="2">Methods<\/p><p>We recorded from cortex\.<\/p>/);
  const { html: disk } = await saved();
  assert.doesNotMatch(disk, /data-num/, 'numbers are never saved');
});

test('$$ on its own line makes a numbered display equation', async () => {
  await type('\n$$\\int_0^1 f(x)\\,dx = 1$$\n');
  await tick(300);
  const html = await bodyHtml();
  assert.match(html, /<p class="eq" contenteditable="false" data-id="eq-\w+" data-num="1">\\int_0\^1 f\(x\)\\,dx = 1<\/p>/);
  await type('Then more.');
});

test('a figure, captioned, and a cross-reference to it with @fig', async () => {
  await caretAtEnd();
  // a small plot, drawn the way a figure is made: an image file
  await js(`(async () => {
    const c = new OffscreenCanvas(480, 240);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 480, 240);
    g.strokeStyle = '#345'; g.lineWidth = 3; g.beginPath();
    for (let x = 0; x <= 440; x += 4) g.lineTo(20 + x, 200 - 150 * Math.exp(-((x - 220) ** 2) / 6000));
    g.stroke();
    g.strokeStyle = '#999'; g.lineWidth = 1; g.strokeRect(20, 20, 440, 180);
    const blob = await c.convertToBlob({ type: 'image/png' });
    await paperAddFigure(new File([blob], 'plot.png', { type: 'image/png' }), document.querySelector('.chapter-body'));
  })()`);
  await tick(500);
  await type('Firing rates across layers');
  await key('Enter');
  await type('As @fig');
  assert.match(await js(`document.querySelector('.paper-picker .pp-row.active .pp-main').textContent`), /Figure 1/);
  await key('Enter');
  await type(' shows.');
  const html = await bodyHtml();
  assert.match(html, /<figure class="fig" contenteditable="false" data-id="(fig-\w+)" data-src="figure-\w+\.png" data-num="1"><img alt="" src="blob:[^"]+"><figcaption contenteditable="true" data-num="1">Firing rates across layers<\/figcaption><\/figure>/);
  assert.match(html, /<span class="xref" contenteditable="false" data-ref="fig-\w+">Figure 1<\/span> shows\./);
  const { dir, html: disk } = await saved();
  assert.doesNotMatch(disk, /blob:/);
  const file = /data-src="(figure-\w+\.png)"/.exec(disk)[1];
  assert.ok(fs.existsSync(path.join(dir, file)));
  await snap('figure');
});

test('a table pasted from a spreadsheet', async () => {
  await caretAtEnd();
  await js(`(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Layer\\tRate (Hz)\\nL2/3\\t4.1\\nL5\\t7.9\\n');
    document.querySelector('.chapter-body').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  })()`);
  await tick(300);
  await type('Mean firing rate by layer');
  const html = await bodyHtml();
  assert.match(html, /<figure class="tbl" contenteditable="false" data-id="tab-\w+" data-num="1"><figcaption contenteditable="true" data-num="1">Mean firing rate by layer<\/figcaption><table><tr><th contenteditable="true">Layer<\/th><th contenteditable="true">Rate \(Hz\)<\/th><\/tr><tr><td contenteditable="true">L2\/3<\/td>/);
  await snap('table');
});

test('the authors, abstract and keywords on the title page', async () => {
  await js(`(() => {
    paperMeta().authors = [
      { name: 'Ada Lovelace', affiliations: ['University of London'], email: 'ada@example.org', orcid: '0000-0002-1825-0097', corresponding: true },
      { name: 'Charles Babbage', affiliations: ['University of Cambridge'] }
    ];
    paperShowAuthors();
    const abs = document.getElementById('tp-abstract');
    abs.innerHTML = '<p>We ask how cortex stays balanced. We find that it does.</p>';
    abs.dispatchEvent(new Event('input'));
    const kw = document.getElementById('tp-keywords');
    kw.textContent = 'cortex, inhibition, balance';
    kw.dispatchEvent(new Event('input'));
  })()`);
  await tick(300);
  assert.equal(await js(`document.getElementById('tp-authors').textContent`), 'Ada Lovelace1*, Charles Babbage2');
  assert.equal(await js(`validOrcid('0000-0002-1825-0097')`), true);
  assert.equal(await js(`validOrcid('0000-0002-1825-0098')`), false);
  const { meta } = await saved();
  assert.deepEqual(meta.paper.keywords, ['cortex', 'inhibition', 'balance']);
  assert.equal(meta.author, 'Ada Lovelace & Charles Babbage');
  await js(`document.getElementById('paper-scroll').scrollTop = 0`);
  await snap('title-page');
});

test('⌘Z takes back a citation just picked, leaving what was typed', async () => {
  await caretAtEnd();
  await type(' See @doe');
  await key('Enter');
  await tick(400);
  assert.equal(await js(`document.querySelectorAll('.chapter-body .cite').length`), 2);
  await key('z', [process.platform === 'darwin' ? 'meta' : 'control']);
  await tick(600);
  assert.equal(await js(`document.querySelectorAll('.chapter-body .cite').length`), 1);
  assert.match(await js(`document.querySelector('.chapter-body').lastElementChild.textContent`), /See @doe$/);
  // the @ and what followed go, by hand, as a writer would
  await caretAtEnd();
  for (let i = 0; i < ' See @doe'.length; i++) await key('Backspace');
});

test('a citation, clicked, takes a page and can name its authors', async () => {
  await js(`openCitePop(document.querySelector('.chapter-body .cite'))`);
  await tick(200);
  await snap('cite-pop');
  await js(`(() => {
    const loc = document.querySelector('.cite-pop .cp-loc');
    loc.value = 'p. 12';
    loc.dispatchEvent(new Event('change'));
  })()`);
  await tick(500);
  assert.equal(await js(`document.querySelector('.chapter-body .cite').textContent`), '(Doe, 2019; Smith et al., 2020, p. 12)');
  await js(`(() => {
    const box = document.querySelector('.cite-pop .cp-narrative input');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
  })()`);
  await tick(500);
  assert.equal(await js(`document.querySelector('.chapter-body .cite').textContent`), 'Smith et al. (2020, p. 12); Doe (2019)');
  await js(`(() => {
    const box = document.querySelector('.cite-pop .cp-narrative input');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    const loc = document.querySelector('.cite-pop .cp-loc');
    loc.value = '';
    loc.dispatchEvent(new Event('change'));
    closePaperPop();
  })()`);
  await tick(300);
});

test('maths, clicked, turns into its TeX in the line, drawn live beside it', async () => {
  await js(`editMath(document.querySelector('.chapter-body .math'), { caret: 'end' })`);
  await tick(200);
  assert.equal(await js(`document.querySelector('.chapter-body .math').classList.contains('editing')`), true);
  assert.equal(await js(`document.querySelector('.chapter-body .math').contains(getSelection().anchorNode)`), true, 'the caret is in its TeX');
  for (let i = 0; i < 3; i++) await key('Backspace'); // 'E = I' → 'E '
  await type('\\approx I');
  assert.equal(await js(`texOf(document.querySelector('.chapter-body .math'))`), 'E \\approx I');
  assert.equal(await js(`!!document.querySelector('.chapter-body .math').shadowRoot.querySelector('.pv svg')`), true, 'drawn as it is typed');
  const { html: mid } = await saved();
  assert.match(mid, /<span class="math" contenteditable="false">E \\approx I<\/span>/, 'saved as maths while it is being written');
  await snap('math-inline-edit');
  await key('Enter');
  await tick(300);
  assert.equal(await js(`document.querySelector('.chapter-body .math').classList.contains('editing')`), false);
  assert.equal(await js(`!!document.querySelector('.chapter-body .math').shadowRoot.querySelector('.m svg')`), true);
  // Esc leaves it as it was
  await js(`editMath(document.querySelector('.chapter-body .math'))`);
  await type('xyz');
  await key('Escape');
  await tick(300);
  assert.equal(await js(`document.querySelector('.chapter-body .math').textContent`), 'E \\approx I');
  // and an equation shows its TeX over its drawing
  await js(`editMath(document.querySelector('.chapter-body .eq'))`);
  await tick(200);
  assert.equal(await js(`!!document.querySelector('.chapter-body .eq').shadowRoot.querySelector('.ded .pv svg')`), true);
  await snap('equation-inline-edit');
  await key('Escape');
  await tick(200);
});

test('maths is opened, written and left from the keyboard', async () => {
  const editing = () => js(`(() => { const n = document.querySelector('.chapter-body .editing'); return n ? texOf(n) : null; })()`);
  const line = () => js(`document.querySelector('#kb').innerHTML`);
  // the caret at a place in a paragraph's nth text
  const caretAt = (sel, nth, offset) => js(`(() => {
    const p = document.querySelector(${JSON.stringify(sel)});
    document.querySelector('.chapter-body').focus();
    const t = [...p.childNodes].filter((n) => n.nodeType === 3)[${nth}];
    const r = document.createRange();
    r.setStart(t, ${offset === -1 ? 't.length' : offset});
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await caretAtEnd();
  await key('Enter');
  await js(`document.querySelector('.chapter-body').lastElementChild.id = 'kb'`);
  await type('Gain $x+y$ rises');
  // → beside the maths opens it at its start; Home and End keep to its TeX
  await caretAt('#kb', 0, -1);
  await key('Right');
  assert.equal(await editing(), 'x+y', '→ opens it');
  await type('2');
  await key('End');
  await type('z');
  await key('Home');
  await type('a');
  assert.equal(await editing(), 'a2x+yz');
  // ⌘A takes only the TeX, and typing over it leaves maths, not words
  await key('a', ['meta']);
  await type('k');
  assert.equal(await editing(), 'k');
  await key('Right');
  assert.equal(await editing(), null, '→ at its end steps out');
  await type('!');
  assert.equal(await line(), 'Gain <span class="math" contenteditable="false">k</span>! rises');
  // Backspace after maths opens it rather than take it whole; emptied, it still takes typing
  await key('Backspace'); // the !
  await key('Backspace');
  assert.equal(await editing(), 'k');
  await key('Backspace');
  await type('w');
  assert.equal(await editing(), 'w');
  await key('Left');
  await key('Left');
  assert.equal(await editing(), null, '← at its start steps out');
  // ⌘⇧M at the end of a line: maths that takes what's typed
  await caretAt('#kb', 1, -1);
  await js(`paperInsertEquation()`);
  await type('\\beta');
  await key('Enter');
  assert.equal(await line(), 'Gain <span class="math" contenteditable="false">w</span> rises<span class="math" contenteditable="false">\\beta</span>');
  // an equation: ↑ and ↓ from the lines around it, ⇧Enter for another line of TeX
  await js(`(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('#kb'));
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await key('Enter');
  await type('$$a^2$$\nThen');
  await key('Up');
  assert.equal(await editing(), 'a^2', '↑ from the line under an equation opens it');
  await type('+b^2');
  await key('Enter', ['shift']);
  await type('c');
  assert.equal(await editing(), 'a^2+b^2\nc');
  await key('Down');
  assert.equal(await editing(), null, '↓ from its last line steps out');
  await type('X');
  assert.equal(await js(`document.querySelector('#kb + p.eq + p').textContent`), 'XThen');
  await caretAt('#kb', 1, -1);
  await key('Down');
  assert.equal(await editing(), 'a^2+b^2\nc', '↓ from the line over it opens it');
  await key('Escape');
  const { html } = await saved();
  assert.doesNotMatch(html, /​|spellcheck|editing/, 'nothing of the editing is saved');
  assert.match(html, /<p class="eq" contenteditable="false" data-id="eq-[^"]+">a\^2\+b\^2\nc<\/p>/);
  assert.match(html, /<p id="kb">Gain <span class="math" contenteditable="false">w<\/span> rises<span class="math" contenteditable="false">\\beta<\/span><\/p>/);
  // a line that only starts with $$ stays a line
  await js(`document.querySelector('#kb').textContent = '$$x$$ is the gain'`);
  await caretAt('#kb', 0, -1);
  await key('Enter');
  assert.equal(await js(`document.querySelector('#kb').className`), '');
  // as it was, for the tests after
  await js(`(() => {
    const kb = document.querySelector('#kb');
    while (kb.nextElementSibling) kb.nextElementSibling.remove();
    kb.remove();
    syncChapter(document.querySelector('.chapter-body'), document.querySelector('.chapter').dataset.id);
  })()`);
});

test('figures, tables, citations and sections from the keyboard', async () => {
  const mod = process.platform === 'darwin' ? 'meta' : 'control';
  // where the caret is: in a caption, which cell, which paragraph
  const where = () => js(`(() => {
    const n = getSelection().anchorNode;
    const el = n && (n.nodeType === 3 ? n.parentElement : n);
    return {
      cap: !!(el && el.closest('figcaption')),
      cell: el && el.closest('th, td') ? el.closest('th, td').textContent : null,
      fig: el && el.closest('figure') ? el.closest('figure').className : null,
      text: el && el.closest('p') ? el.closest('p').textContent : null
    };
  })()`);
  const caretIn = (expr, end) => js(`(() => {
    const p = ${expr};
    document.querySelector('.chapter-body').focus();
    const r = document.createRange();
    r.selectNodeContents(p);
    r.collapse(${!end});
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  const fig = `document.querySelector('.chapter-body figure.fig')`;
  const tbl = `document.querySelector('.chapter-body figure.tbl')`;
  // ↓ from the line over a figure: into its caption; Esc: on to the line after it
  await caretIn(`${fig}.previousElementSibling`, true);
  await key('Down');
  assert.deepEqual(await where(), { cap: true, cell: null, fig: 'fig', text: null });
  await key('Escape');
  assert.equal((await where()).text, await js(`${fig}.nextElementSibling.textContent`));
  // Backspace at the start of the line under it steps into the caption; the figure stays
  await key('Backspace');
  assert.equal((await where()).cap, true);
  assert.equal(await js(`document.querySelectorAll('.chapter-body figure.fig').length`), 1);
  await key('Escape');
  // a table: ↓ through its caption, its header, down its column
  await caretIn(`${tbl}.previousElementSibling`, true);
  await key('Down');
  assert.equal((await where()).fig, 'tbl');
  assert.equal((await where()).cap, true);
  await key('Down');
  assert.equal((await where()).cell, 'Layer');
  await key('Down');
  assert.equal((await where()).cell, 'L2/3');
  // ⇧F10: its rows and columns, and back in the cell after
  await key('F10', ['shift']);
  assert.equal(await js(`document.querySelector('.pop-menu .pm-title').textContent`), 'Table');
  const pick = (label) => js(`[...document.querySelectorAll('.pop-menu button')].find((b) => b.textContent === ${JSON.stringify(label)}).focus()`);
  await pick('Insert Row Below');
  await type('\n'); // a button takes Enter as a character
  await tick(100);
  assert.equal(await js(`${tbl}.querySelectorAll('tr').length`), 4);
  assert.equal((await where()).cell, 'L2/3', 'the caret is back in its cell');
  await key('Down');
  await key('F10', ['shift']);
  await pick('Delete Row');
  await type('\n');
  await tick(100);
  assert.equal(await js(`${tbl}.querySelectorAll('tr').length`), 3);
  // ↑ from the line under it: its last cell; Esc: back to that line
  await caretIn(`${tbl}.nextElementSibling`, false);
  await key('Up');
  assert.equal((await where()).cell, '7.9');
  await key('Escape');
  assert.equal((await where()).fig, null);
  // ⇧F10 beside a citation: its pages, typed; Enter is back on the page
  const cite = `document.querySelector('.chapter-body .cite')`;
  const was = await js(`${cite}.dataset.cite`);
  await js(`(() => { document.querySelector('.chapter-body').focus(); caretAfter(${cite}); })()`);
  await key('F10', ['shift']);
  assert.equal(await js(`document.activeElement.className`), 'cp-loc');
  await key('a', [mod]);
  await type('12');
  await key('Enter');
  assert.equal(await js(`!!document.querySelector('.cite-pop')`), false);
  assert.equal(JSON.parse(await js(`${cite}.dataset.cite`))[0].locator, '12');
  assert.equal(await js(`document.activeElement.classList.contains('chapter-body')`), true, 'the caret is back on the page');
  await js(`(async () => { const c = ${cite}; c.dataset.cite = ${JSON.stringify(was)}; syncChapter(c.closest('.chapter-body'), c.closest('.chapter').dataset.id); await paperCiteNow(); })()`);
  // ⌥↑ ⌥↓ in the pane move a section, and the row keeps the keys
  const heads = () => js(`[...document.querySelectorAll('.chapter-body p.h1')].map((h) => h.textContent)`);
  await js(`document.getElementById('nav-pane').classList.add('open'); renderNav()`);
  await tick(200);
  await js(`document.querySelectorAll('#nav-list .paper-sec.ps-h1 .n-row')[1].focus()`);
  await key('Up', ['alt']);
  await tick(200);
  assert.deepEqual(await heads(), ['Methods', 'Introduction']);
  assert.equal(await js(`document.activeElement.querySelector('.n-label').textContent`), 'Methods');
  await key('Down', ['alt']);
  await tick(200);
  assert.deepEqual(await heads(), ['Introduction', 'Methods']);
  await js(`document.getElementById('nav-pane').classList.remove('open')`);
  // a selection that takes a whole table with it: its words go to Darlings
  await caretAtEnd();
  await key('Enter');
  await type('Before');
  await js(`document.querySelector('.chapter-body').lastElementChild.id = 'kb'`);
  await js(`paperInsertTable([['a', 'b'], ['c', 'd']])`);
  await tick(200);
  await js(`(() => {
    const kb = document.querySelector('#kb');
    const r = document.createRange();
    r.setStart(kb.firstChild, 3);
    r.setEnd(kb.nextElementSibling.nextElementSibling, 0);
    document.querySelector('.chapter-body').focus();
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  const kept = await js(`darlings.length`);
  await key('Backspace');
  await tick(300);
  assert.equal(await js(`document.querySelectorAll('.chapter-body figure.tbl').length`), 1);
  assert.equal(await js(`darlings.length`), kept + 1);
  assert.match(await js(`darlings[0].text`), /a\tb\nc\td/);
  await js(`(() => {
    const kb = document.querySelector('#kb');
    while (kb.nextElementSibling) kb.nextElementSibling.remove();
    kb.remove();
    syncChapter(document.querySelector('.chapter-body'), document.querySelector('.chapter').dataset.id);
  })()`);
});

test('/ on a line of its own: a figure, a table, a heading, by a word or a LaTeX name', async () => {
  const rows = () => js(`[...document.querySelectorAll('.paper-picker .pp-main')].map((r) => r.textContent)`);
  await caretAtEnd();
  await key('Enter');
  await js(`document.querySelector('.chapter-body').lastElementChild.id = 'sl'`);
  // a / in a sentence is a /
  await type('and/or');
  assert.equal(await js(`!!document.querySelector('.paper-picker')`), false);
  await key('Enter');
  // nothing by that name: the / stays a /
  await type('/usr');
  assert.equal(await js(`!!document.querySelector('.paper-picker')`), false);
  assert.equal(await js(`document.querySelector('.chapter-body').lastElementChild.textContent`), '/usr');
  await key('Enter');
  await type('/');
  assert.ok((await rows()).includes('Figure…'), 'everything, before a word');
  // a list longer than the room scrolls, and the row the arrows reach stays in view
  const win = BrowserWindow.fromWebContents(wc);
  const [w, h] = win.getSize();
  win.setSize(w, 420);
  await tick(300);
  await js(`pickerUpdate()`);
  const inView = () => js(`(() => {
    const el = document.querySelector('.paper-picker');
    const a = el.querySelector('.pp-row.active').getBoundingClientRect();
    const b = el.getBoundingClientRect();
    return { scrolls: el.scrollHeight > el.clientHeight, inside: a.top >= b.top - 1 && a.bottom <= b.bottom + 1 };
  })()`);
  assert.equal((await inView()).scrolls, true, 'more rows than room');
  for (let i = 0; i < 9; i++) {
    await key('Down');
    assert.equal((await inView()).inside, true, 'the active row, down ' + (i + 1));
  }
  await key('Up');
  assert.equal((await inView()).inside, true);
  win.setSize(w, h);
  await tick(300);
  await type('ref');
  assert.equal((await rows())[0], 'Cross-Reference…', 'LaTeX’s \\ref');
  await key('Escape');
  for (let i = 0; i < 4; i++) await key('Backspace');
  // /includegraphics: a picture picked, as a figure
  const figs = await js(`document.querySelectorAll('.chapter-body figure.fig').length`);
  await js(`window.pickFile = async () => {
    const c = new OffscreenCanvas(60, 40);
    c.getContext('2d').fillRect(0, 0, 60, 40);
    return new File([await c.convertToBlob({ type: 'image/png' })], 'slash.png', { type: 'image/png' });
  }; true`);
  await type('/includeg');
  assert.deepEqual(await rows(), ['Figure…']);
  await key('Enter');
  await tick(600);
  assert.equal(await js(`document.querySelectorAll('.chapter-body figure.fig').length`), figs + 1);
  assert.equal(await js(`document.activeElement.matches('figcaption')`), true, 'the caret in its caption');
  // /tab: a table
  await key('Escape');
  const tables = await js(`document.querySelectorAll('.chapter-body figure.tbl').length`);
  await type('/tab');
  await key('Enter');
  await tick(200);
  assert.equal(await js(`document.querySelectorAll('.chapter-body figure.tbl').length`), tables + 1);
  // /subsection: the line becomes one
  await key('Escape');
  await type('/subs');
  await key('Enter');
  await tick(100);
  await type('Rates');
  assert.match(await js(`document.querySelector('.chapter-body').lastElementChild.outerHTML`), /^<p class="h2"[^>]*>Rates<\/p>$/);
  // as it was, for the tests after
  await js(`(() => {
    const sl = document.querySelector('#sl');
    while (sl.nextElementSibling) sl.nextElementSibling.remove();
    sl.remove();
    syncChapter(document.querySelector('.chapter-body'), document.querySelector('.chapter').dataset.id);
    paperRenumber();
  })()`);
});

test('lists, \\mu and a space, and the paper’s own symbols in a table with their values and sources', async () => {
  await caretAtEnd();
  await key('Enter');
  await js(`document.querySelector('.chapter-body').lastElementChild.id = 'ls'`);
  const items = () => js(`(() => { const out = []; for (let el = document.querySelector('#ls'); el; el = el.nextElementSibling) out.push([el.className, el.dataset.list || '', el.dataset.level || '', el.dataset.num || '', el.textContent]); return out; })()`);
  // - and a space: a bulleted list; Tab nests; Enter on an empty item comes out, then ends it
  await type('- Excitation\nInhibition');
  await key('Tab');
  await type('\nFast\n');
  await type('\n'); // an empty item a level in: a level out
  await type('\n'); // and then out of the list
  await type('1. Record\nModel');
  assert.deepEqual(await items(), [
    ['li', 'ul', '', '', 'Excitation'], ['li', 'ul', '2', '', 'Inhibition'], ['li', 'ul', '2', '', 'Fast'],
    ['li', 'ol', '', '1', 'Record'], ['li', 'ol', '', '2', 'Model']
  ]);
  // Backspace at an item's start: a paragraph again
  await key('Enter');
  await key('Backspace');
  await type('With \\mu and \\leq, a $V_m$');
  assert.match(await js(`document.querySelector('.chapter-body').lastElementChild.innerHTML`), /^With μ and ≤, a <span class="math"/);
  // the maths defined as a symbol: ⇧F10 beside it
  await key('F10', ['shift']);
  const pick = async (label) => {
    await js(`[...document.querySelectorAll('.pop-menu button')].find((b) => b.textContent === ${JSON.stringify(label)}).focus()`);
    await type('\n');
  };
  await pick('Define as a Symbol…');
  await tick(200);
  assert.equal(await js(`document.querySelectorAll('.paper-sym input')[1].value`), 'Vm', 'a name offered from its TeX');
  await js(`(() => {
    const f = document.querySelectorAll('.paper-sym input');
    f[2].value = 'membrane potential'; f[3].value = '−65'; f[4].value = 'mV';
    document.querySelector('.paper-sym select').value = 'parameter';
    document.querySelector('.ps-sources input').focus();
  })()`);
  await type('smith');
  await key('Enter');
  assert.equal(await js(`document.querySelectorAll('.paper-sym .ps-chip').length`), 1);
  await js(`document.querySelector('.paper-sym .m-ok').click()`);
  await tick(400);
  assert.match(await js(`document.querySelector('.chapter-body').lastElementChild.innerHTML`), /<span class="sym" contenteditable="false" data-sym="Vm">V_m<\/span>/);
  // \Vm and a space: the symbol again
  await caretAtEnd();
  await type(' or \\Vm ');
  assert.equal(await js(`document.querySelectorAll('.chapter-body .sym[data-sym="Vm"]').length`), 2);
  // /symbols: the table, its source cited in the paper's style
  await key('Enter');
  await type('/symbols');
  await key('Enter');
  await tick(800);
  const table = () => js(`[...document.querySelector('.chapter-body p.symtab').shadowRoot.querySelectorAll('tr')].map((r) => [...r.children].map((c) => c.textContent.trim()))`);
  const rows = await table();
  assert.deepEqual(rows[0], ['Symbol', 'Meaning', 'Value', 'Unit', 'Source']);
  assert.deepEqual(rows[1].slice(1), ['membrane potential', '−65', 'mV', '(Smith et al., 2020)']);
  await js(`document.querySelector('.chapter-body p.symtab').scrollIntoView({ block: 'center' })`);
  await snap('lists-and-symbols');
  // its definition changed: every use follows, and the table
  await js(`paperSaveSymbols(paper.symbols.map((x) => ({ ...x, tex: 'V_\\\\mathrm{m}' })))`);
  await tick(400);
  assert.deepEqual(await js(`[...document.querySelectorAll('.chapter-body .sym')].map((n) => n.textContent)`), ['V_\\mathrm{m}', 'V_\\mathrm{m}']);
  const { dir, html } = await saved();
  // (the engine copies the test's id="ls" to each new line)
  assert.match(html, /<p(?: id="ls")? class="li" data-list="ul">Excitation<\/p><p(?: id="ls")? class="li" data-list="ul" data-level="2">Inhibition<\/p>/);
  assert.match(html, /<p(?: id="ls")? class="li" data-list="ol">Record<\/p>/, 'numbers are drawn, never saved');
  assert.match(html, /<p class="symtab" contenteditable="false" data-id="symtab-\w+"><\/p>/, 'the table is drawn, never saved');
  const syms = JSON.parse(fs.readFileSync(path.join(dir, 'symbols.json'), 'utf8'));
  assert.deepEqual(syms, [{ id: 'Vm', tex: 'V_\\mathrm{m}', meaning: 'membrane potential', unit: 'mV', value: '−65', kind: 'parameter', table: true, cite: [{ id: 'smith2020neural' }] }]);
  // and in LaTeX: its own command, μ that compiles, the lists, the table
  const tex = await js(`(async () => NeoPaperExport.latex(await paperModel()).find((f) => f.path === 'paper.tex').content)()`);
  assert.match(tex, /\\DeclareRobustCommand\{\\Vm\}/);
  assert.match(tex, /\\Vm\{\}/);
  assert.match(tex, /\\ensuremath\{\\mu\}/);
  assert.match(tex, /\\begin\{itemize\}[\s\S]*\\begin\{itemize\}[\s\S]*\\end\{itemize\}[\s\S]*\\end\{itemize\}/);
  assert.match(tex, /\\begin\{enumerate\}/);
  assert.match(tex, /membrane potential/);
});

test('editing, asked for: the pass and its fixes, first and last sentences, anonymous for review, a talk, references that lack something', async () => {
  await caretAtEnd();
  await key('Enter');
  await js(`document.querySelector('.chapter-body').lastElementChild.id = 'ed'`);
  await type('We built a rig in order to record cells. The cells were recorded by hand. Our method is faster. It worked. It worked well. It ends here.');
  // nothing is marked until the pass is asked for
  assert.equal(await js(`CSS.highlights.has('neo-edit')`), false);
  await js(`paperEditing(true)`);
  await tick(200);
  const flags = () => js(`editingFlags.map(({ range, flag }) => flag.rule + ':' + range.toString())`);
  const before = await flags();
  assert.ok(before.includes('filler:in order to'), before.join(' | '));
  assert.ok(before.some((f) => f.startsWith('passive:were recorded')), before.join(' | '));
  assert.ok(before.some((f) => f.startsWith('compare:')), before.join(' | '));
  await js(`document.querySelector('#ed').scrollIntoView({ block: 'center' })`);
  await snap('editing-pass');
  // ⌘' selects the next; ⇧F10 in it: why, and the fix
  await js(`(() => { const p = document.querySelector('#ed'); const r = document.createRange(); r.setStart(p.firstChild, 0); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
  await js(`paperEditingNext(1)`);
  assert.equal(await js(`getSelection().toString()`), 'in order to');
  await js(`(() => { const s = getSelection(); s.collapseToStart(); s.modify('move', 'forward', 'character'); })()`);
  await key('F10', ['shift']);
  assert.match(await js(`document.querySelector('.pop-menu .pm-title').textContent`), /Filler/);
  await js(`[...document.querySelectorAll('.pop-menu button')].find((b) => /^Change to/.test(b.textContent)).focus()`);
  await type('\n');
  await tick(200);
  assert.match(await js(`document.querySelector('#ed').textContent`), /^We built a rig to record cells\./);
  await js(`paperEditing(false)`);
  assert.equal(await js(`CSS.highlights.has('neo-edit')`), false);
  // first and last sentences: the middle of the paragraph dimmed, nothing in the file
  await js(`paperSkim(true)`);
  const dim = await js(`[...CSS.highlights.get('neo-skim')].map((r) => r.toString())`);
  assert.ok(dim.some((r) => r.startsWith('The cells were recorded') && r.endsWith('It worked well.')), JSON.stringify(dim));
  await snap('first-and-last-sentences');
  await js(`paperSkim(false)`);
  const { html } = await saved();
  assert.doesNotMatch(html, /neo-|highlight/);
  // anonymous for review: the model (and so every way out) without the authors or what names them
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    const h = document.createElement('p'); h.className = 'h1'; h.dataset.id = 'sec-ack'; h.textContent = 'Acknowledgements';
    const p = document.createElement('p'); p.id = 'ack'; p.textContent = 'We thank the Babbage lab.';
    body.append(h, p);
    syncChapter(body, body.closest('.chapter').dataset.id);
  })()`);
  await js(`paperAnonymous(true)`);
  const anon = await js(`(async () => { const m = await paperModel(); return { authors: m.authors.map((a) => a.name), ack: m.blocks.some((b) => /Babbage/.test(JSON.stringify(b.runs || ''))) }; })()`);
  assert.deepEqual(anon, { authors: ['Anonymous'], ack: false });
  assert.equal(await js(`document.getElementById('tp-authors').classList.contains('anon')`), true);
  await js(`paperAnonymous(false)`);
  assert.deepEqual(await js(`(async () => (await paperModel()).authors.map((a) => a.name))()`), ['Ada Lovelace', 'Charles Babbage']);
  // a talk: its outline from the abstract's moves and the figures
  const talk = await js(`(async () => NeoPaperExport.talk(await paperModel({ png: true })).map((f) => f.path + (f.path === 'talk.md' ? '\\n' + f.content : '')))()`);
  const md = talk.find((f) => f.startsWith('talk.md'));
  assert.ok(md && /## /.test(md), talk.join('\n'));
  assert.ok(talk.some((f) => f.startsWith('figures/')), 'its figures');
  // a reference with no year shows it on the References tab
  await js(`(async () => { await paperSaveRefs([...paper.refs, { id: 'noyear', type: 'article-journal', title: 'Undated', author: [{ family: 'Nobody' }] }]); switchTab('references'); })()`);
  await tick(300);
  assert.match(await js(`[...document.querySelectorAll('#references-view .rl-gaps')].map((g) => g.textContent).join('|')`), /no year/);
  await js(`(async () => { await paperSaveRefs(paper.refs.filter((r) => r.id !== 'noyear')); switchTab('manuscript'); })()`);
  await tick(200);
  // as it was, for the tests after
  await js(`(() => {
    const ed = document.querySelector('#ed');
    while (ed.nextElementSibling) ed.nextElementSibling.remove();
    ed.remove();
    syncChapter(document.querySelector('.chapter-body'), document.querySelector('.chapter').dataset.id);
    paperRenumber();
  })()`);
});

test('the command palette: any menu command, what / inserts, and the sections, by a few letters', async () => {
  const rows = () => js(`[...document.querySelectorAll('.palette-row')].map((r) => r.querySelector('.palette-where').textContent + ' › ' + r.querySelector('.palette-what').textContent)`);
  await caretAtEnd();
  await js(`openPalette()`);
  await tick(300);
  assert.equal(await js(`document.activeElement.closest('.palette') !== null`), true, 'the field takes the keys');
  // read from the menus themselves: a paper's Edit → Editing Pass, by a few letters
  await type('ex');
  await snap('command-palette');
  for (let i = 0; i < 2; i++) await key('Backspace');
  await type('edit pass');
  assert.match((await rows())[0], /Editing Pass$/);
  await key('Enter');
  await tick(500);
  assert.equal(await js(`editingOn`), true, 'run as the menu runs it');
  await js(`paperEditing(false)`);
  // what / inserts that no menu has: a list, on the line the caret was on
  await key('Enter');
  await js(`openPalette()`);
  await tick(300);
  await type('bulleted');
  await key('Enter');
  await tick(300);
  assert.equal(await js(`document.querySelector('.chapter-body').lastElementChild.className`), 'li');
  await key('Backspace'); // a paragraph again
  // and a section, by its name: the caret goes there
  await js(`openPalette()`);
  await tick(300);
  await type('methods');
  assert.ok((await rows()).some((r) => /Go to › 2 Methods/.test(r)), (await rows()).join(' | '));
  await js(`(() => { const i = [...document.querySelectorAll('.palette-row')].findIndex((r) => /Methods/.test(r.textContent) && /Go to/.test(r.textContent)); for (let k = 0; k < i; k++) document.querySelector('.palette input').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); })()`);
  await key('Enter');
  await tick(300);
  assert.equal(await js(`getSelection().anchorNode.parentElement.closest('p').textContent`), 'Methods');
  // Esc: back where the writer was, nothing run
  await js(`openPalette()`);
  await tick(200);
  await key('Escape');
  assert.equal(await js(`!!document.querySelector('.palette')`), false);
  assert.equal(await js(`document.activeElement.classList.contains('chapter-body')`), true);
  await js(`(() => { const b = document.querySelector('.chapter-body'); if (!b.lastElementChild.textContent) b.lastElementChild.remove(); syncChapter(b, b.closest('.chapter').dataset.id); })()`);
});

test('the authors dialog and the pane of sections', async () => {
  await js(`paperEditAuthors()`);
  await tick(200);
  assert.equal(await js(`document.querySelectorAll('.paper-authors .pa-row').length`), 2);
  await snap('authors');
  await js(`document.querySelector('.paper-authors .m-cancel').click()`);
  await js(`document.getElementById('nav-pane').classList.add('open'); renderNav()`);
  await tick(300);
  assert.deepEqual(await js(`[...document.querySelectorAll('#nav-list .paper-sec .n-label')].map((n) => n.textContent)`),
    ['Title and abstract', 'Introduction', 'Methods', 'References']);
  await snap('pane');
  await js(`document.getElementById('nav-pane').classList.remove('open')`);
});

test('a section moved in the pane takes everything under it, and the numbers follow', async () => {
  await js(`paperMoveSection(1, 0)`);
  await tick(400);
  assert.deepEqual(await js(`[...document.querySelectorAll('.chapter-body p.h1')].map((h) => h.dataset.num + ' ' + h.textContent)`), ['1 Methods', '2 Introduction']);
  assert.equal(await js(`document.querySelector('.chapter-body').firstElementChild.nextElementSibling.textContent`), 'We recorded from cortex.');
  assert.equal(await js(`document.querySelector('.chapter-body .xref').textContent`), 'Figure 1');
  await key('z', [process.platform === 'darwin' ? 'meta' : 'control']);
  await tick(600);
  assert.deepEqual(await js(`[...document.querySelectorAll('.chapter-body p.h1')].map((h) => h.textContent)`), ['Introduction', 'Methods'], '⌘Z puts it back');
});

test('figure layout: width, text wrapped beside it, a second panel, pinned in place', async () => {
  const fig = `document.querySelector('.chapter-body figure.fig')`;
  // the toolbar shows over a figure the pointer is on
  await js(`${fig}.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
  await tick(150);
  assert.equal(await js(`!document.querySelector('.fig-tools').hidden`), true);
  await snap('figure-toolbar');
  await js(`setFigureLayout(${fig}, { width: '33', wrap: 'right' })`);
  assert.deepEqual(await js(`(() => { const d = ${fig}.dataset; return [d.width, d.wrap]; })()`), ['33', 'right']);
  await js(`setFigureLayout(${fig}, { wrap: '' , width: '100', place: 'H' })`);
  await js(`(async () => {
    const c = new OffscreenCanvas(200, 120);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 200, 120); g.fillStyle = '#c33'; g.fillRect(40, 30, 120, 60);
    await addPanel(${fig}, new File([await c.convertToBlob({ type: 'image/png' })], 'b.png', { type: 'image/png' }));
  })()`);
  await tick(600);
  assert.equal(await js(`${fig}.querySelectorAll(':scope > .panel').length`), 2);
  assert.equal(await js(`${fig}.hasAttribute('data-src')`), false, 'its one picture became panel (a)');
  await js(`(() => { const s = ${fig}.querySelectorAll('.subcap'); s[0].textContent = 'Layer 2/3'; s[1].textContent = 'Layer 5'; const b = document.querySelector('.chapter-body'); syncChapter(b, b.closest('.chapter').dataset.id); })()`);
  const { html } = await saved();
  assert.match(html, /<figure class="fig" contenteditable="false" data-id="fig-\w+" data-place="H"><div class="panel" data-src="figure-\w+\.png"><img alt=""><span class="subcap" contenteditable="true">Layer 2\/3<\/span><\/div><div class="panel" data-src="figure-\w+\.png"><img alt=""><span class="subcap" contenteditable="true">Layer 5<\/span><\/div><figcaption/);
  await js(`document.querySelector('.fig-tools').hidden = true`);
  await js(`${fig}.scrollIntoView({ block: 'center' })`);
  await snap('figure-panels');
});

test('a journal sets the page, the citation style and the LaTeX class; Preview As shows another', async () => {
  await js(`paperMenu({ command: 'journal', value: 'ieee' })`);
  await tick(800);
  assert.equal(await js(`paperMeta().journal`), 'ieee');
  assert.equal(await js(`paperMeta().style`), 'ieee');
  assert.equal(await js(`document.querySelector('.chapter-body .cite').textContent`), '[1], [2]');
  const model = await js(`paperModel().then((m) => ({ journal: m.journal.id, html: NeoPaperExport.html(m, { print: true }), tex: NeoPaperExport.latex(m).find((f) => f.path === 'paper.tex').content }))`);
  assert.equal(model.journal, 'ieee');
  assert.match(model.html, /column-count: 2/);
  assert.match(model.html, /<h2 id="sec-\w+"><span class="num">I\.<\/span> Introduction<\/h2>/);
  assert.match(model.html, /<b>Fig\. 1\.<\/b>/);
  assert.match(model.tex, /\\documentclass\[conference\]\{IEEEtran\}/);
  assert.match(model.tex, /\\IEEEauthorblockN\{Ada Lovelace\}/);
  assert.match(model.tex, /\\bibliographystyle\{IEEEtranN\}/);
  // a preview in another journal's look and citation style leaves the page as it is
  await js(`paperPreview('nature')`);
  for (let i = 0; i < 40 && BrowserWindow.getAllWindows().length < 2; i++) await tick(200);
  const preview = BrowserWindow.getAllWindows().find((w) => w.webContents !== wc);
  assert.ok(preview, 'a preview window opens');
  assert.match(preview.getTitle(), /— Nature$/);
  assert.equal(await js(`document.querySelector('.chapter-body .cite').textContent`), '[1], [2]', 'the page keeps its own style');
  await tick(1500);
  if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'preview-nature.png'), (await preview.webContents.capturePage()).toPNG());
  await js(`paperPreview()`);
  await tick(2500);
  assert.match(preview.getTitle(), /— IEEE \(two-column\)$/);
  // it keeps up with the writing, quietly, and opens where the caret is
  const was = preview.webContents.getURL();
  BrowserWindow.fromWebContents(wc).focus(); // the writer back at the page
  await tick(200);
  await caretAtEnd();
  await type(' More.');
  for (let i = 0; i < 40 && preview.webContents.getURL() === was; i++) await tick(200);
  assert.notEqual(preview.webContents.getURL(), was, 'redrawn after the typing paused');
  assert.match(preview.webContents.getURL(), /#page=\d+$/, 'at the page of the section being written: ' + (await js('paperCaretAnchor()')) + ' ' + preview.webContents.getURL());
  assert.equal(BrowserWindow.getFocusedWindow() && BrowserWindow.getFocusedWindow().webContents, wc, 'the page keeps the focus');
  if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'preview-ieee.png'), (await preview.webContents.capturePage()).toPNG());
  preview.close();
  await js(`paperMenu({ command: 'journal', value: 'preprint' })`);
  await js(`paperMenu({ command: 'style', value: 'apa' })`);
  await tick(800);
});

test('a journal’s limits beside the counts: title, abstract, and the main text in the pane', async () => {
  BrowserWindow.fromWebContents(wc).focus(); // back from the preview window
  await tick(200);
  await js(`paperMenu({ command: 'journal', value: 'nature' })`);
  await tick(800);
  assert.match(await js(`(document.querySelector('.tp-abstract-count') || {}).textContent || 'none'`), /^\d+ \/ 200 words$/);
  await js(`document.getElementById('tp-title').focus()`);
  await tick(100);
  assert.equal(await js(`(document.getElementById('tp-title-count') || {}).textContent || 'none'`), '31 / 90 characters');
  await js(`document.getElementById('nav-pane').classList.add('open'); renderNav()`);
  await tick(200);
  assert.match(await js(`(document.querySelector('#nav-list .paper-limit') || {}).textContent || document.getElementById('nav-list').textContent.slice(0, 200)`), /^\d+ of about 4,300 words for Nature$/);
  await js(`document.getElementById('nav-pane').classList.remove('open')`);
  await js(`paperMenu({ command: 'journal', value: 'preprint' })`);
  await js(`paperMenu({ command: 'style', value: 'apa' })`);
  await tick(800);
});

test('a panel can be referred to on its own: Figure 1b', async () => {
  await caretAtEnd();
  await type(' See @fig');
  const rows = await js(`[...document.querySelectorAll('.paper-picker .pp-main')].map((r) => r.textContent)`);
  assert.ok(rows.includes('Figure 1a') && rows.includes('Figure 1b'), rows.join(', '));
  await key('Down');
  await key('Down');
  await key('Enter');
  await tick(300);
  assert.match(await js(`document.querySelector('.chapter-body').lastElementChild.innerHTML`), /<span class="xref" contenteditable="false" data-ref="fig-\w+-b">Figure 1b<\/span>/);
  await type('.');
});

test('panels set out from the keyboard: so many to a row, one wider, moved, a reference following its picture', async () => {
  const fig = `document.querySelector('.chapter-body figure.fig')`;
  await js(`(async () => {
    const c = new OffscreenCanvas(200, 120);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 200, 120); g.fillStyle = '#36c'; g.fillRect(40, 30, 120, 60);
    await addPanel(${fig}, new File([await c.convertToBlob({ type: 'image/png' })], 'c.png', { type: 'image/png' }));
  })()`);
  await tick(600);
  // the menu for the panel the caret is in, from its sub-caption
  const menuFor = async (letter, ...labels) => {
    await js(`(() => {
      const sub = ${fig}.querySelectorAll(':scope > .panel .subcap')[${letter.charCodeAt(0) - 97}];
      sub.focus();
      const r = document.createRange();
      r.selectNodeContents(sub);
      r.collapse(false);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    })()`);
    await key('F10', ['shift']);
    for (const label of labels) {
      await js(`[...document.querySelectorAll('.pop-menu button')].find((b) => b.textContent === ${JSON.stringify(label)}).focus()`);
      await type('\n');
    }
    await tick(200);
  };
  await menuFor('a', 'Panel Layout…', '2 to a Row');
  assert.equal(await js(`${fig}.dataset.cols`), '2');
  await menuFor('a', 'Panel Layout…', 'Panel (a) Twice as Wide');
  assert.equal(await js(`${fig}.querySelector('.panel').dataset.colspan`), '2');
  // (a) across the row; (b) and (c) side by side under it
  const boxes = await js(`[...${fig}.querySelectorAll(':scope > .panel')].map((p) => { const r = p.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), b: Math.round(r.bottom) }; })`);
  assert.ok(boxes[1].y >= boxes[0].b && boxes[2].y === boxes[1].y, JSON.stringify(boxes));
  assert.ok(Math.abs(boxes[0].w - (boxes[1].w * 2 + (boxes[2].x - boxes[1].x - boxes[1].w))) <= 2, 'twice as wide, and the gap between: ' + JSON.stringify(boxes));
  await snap('panels-in-rows');
  // (b) moved first: the reference to it follows it to (a), and back
  const ref = `[...document.querySelectorAll('.chapter-body .xref')].find((x) => /-[ab]$/.test(x.dataset.ref))`;
  assert.equal(await js(`${ref}.textContent`), 'Figure 1b');
  await menuFor('b', 'Panel Layout…', 'Move Panel (b) Earlier');
  assert.equal(await js(`${fig}.querySelector('.panel .subcap').textContent`), 'Layer 5');
  assert.equal(await js(`${ref}.textContent`), 'Figure 1a');
  await menuFor('a', 'Panel Layout…', 'Move Panel (a) Later');
  assert.equal(await js(`${ref}.textContent`), 'Figure 1b');
  const { html } = await saved();
  assert.match(html, /<figure class="fig" contenteditable="false" data-id="fig-\w+" data-place="H" data-cols="2"><div class="panel" data-src="figure-\w+\.png" data-colspan="2">/);
});

test('Draft for Feedback: the level asked for, on the first page', async () => {
  const before = new Set(fs.readdirSync(OUT));
  await js(`void paperFeedback()`); // it waits on the dialogs, so don't wait on it
  await tick(300);
  await js(`[...document.querySelectorAll('.modal-backdrop')].pop().querySelectorAll('.fr-choice')[1].click()`); // coarse-grained
  await tick(300);
  await js(`[...document.querySelectorAll('.modal-backdrop')].pop().querySelectorAll('.fr-choice')[1].click()`); // Word
  for (let i = 0; i < 40 && fs.readdirSync(OUT).filter((f) => !before.has(f)).length < 1; i++) await tick(200);
  const made = fs.readdirSync(OUT).filter((f) => !before.has(f));
  assert.deepEqual(made, ['Inhibition-in-cortical-circuits-for-feedback.docx']);
  const doc = await (await require('jszip').loadAsync(fs.readFileSync(path.join(OUT, made[0])))).file('word/document.xml').async('string');
  assert.match(doc, /<w:pStyle w:val="FeedbackNote"\/><\/w:pPr><w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">Draft for feedback — /);
  assert.match(doc, /I’m asking for coarse-grained feedback: the structure and the style\./);
  assert.match(doc, /What can be taken away\?/);
  fs.unlinkSync(path.join(OUT, made[0]));
});

test('remove the references the paper doesn’t cite; ⌘Z brings them back', async () => {
  await js(`paperImportText('@book{unused2001, author = {Nobody, A.}, title = {Never Cited}, year = {2001}}', 'test')`);
  await js(`switchTab('references')`);
  await tick(400);
  assert.equal(await js(`paper.refs.length`), 3);
  const tool = `[...document.querySelectorAll('#references-view .rl-tool')].find((b) => /uncited/.test(b.textContent))`;
  assert.equal(await js(`${tool}.textContent`), 'Remove 1 uncited');
  await js(`${tool}.click()`);
  await tick(400);
  assert.deepEqual(await js(`paper.refs.map((r) => r.id)`), ['smith2020neural', 'doe2019brains']);
  await key('z', [process.platform === 'darwin' ? 'meta' : 'control']);
  await tick(400);
  assert.equal(await js(`paper.refs.length`), 3);
  await js(`paperRemoveRefs(paper.refs.filter((r) => r.id === 'unused2001'), 'x')`);
  await js(`switchTab('manuscript')`);
  await tick(300);
});

test('@ finds references in Zotero (here, a stand-in answering as Better BibTeX does)', async () => {
  const http = require('http');
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const q = (JSON.parse(body || '{}').params || [''])[0];
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: /hub/i.test(q) ? [{ citekey: 'hubel1962receptive', type: 'article-journal', title: 'Receptive fields, binocular interaction and functional architecture in the cat’s visual cortex', author: [{ family: 'Hubel', given: 'David H.' }, { family: 'Wiesel', given: 'Torsten N.' }], 'container-title': 'The Journal of Physiology', issued: { 'date-parts': [[1962]] }, DOI: '10.1113/jphysiol.1962.sp006837' }] : [] }));
    });
  });
  const up = await new Promise((resolve) => { server.once('error', () => resolve(false)); server.listen(23119, '127.0.0.1', () => resolve(true)); });
  if (!up) { console.log('  (port 23119 is taken, a real Zotero is running: skipped)'); return; }
  try {
    await js(`picker.zotero.down = 0`); // the @s typed earlier found no Zotero, and it waits a minute before asking again
    await caretAtEnd();
    await type(' Classic work @hube');
    await tick(900);
    await js(`pickerUpdate()`);
    await tick(100);
    assert.match(await js(`document.querySelector('.paper-picker .pp-zotero .pp-main').textContent`), /From Zotero: Hubel & Wiesel 1962/);
    await snap('zotero-picker');
    await js(`(() => { picker.idx = picker.rows.findIndex((r) => r.kind === 'zotero'); return pickerChoose(); })()`);
    await tick(800);
    assert.ok(await js(`paper.refs.some((r) => r.id === 'hubel1962receptive')`), 'added with Zotero’s citation key');
    assert.match(await js(`document.querySelector('.chapter-body').lastElementChild.innerHTML`), /data-cite="\[\{&quot;id&quot;:&quot;hubel1962receptive&quot;\}\]">\(Hubel &amp; Wiesel, 1962\)<\/span>/);
    await type('.');
  } finally {
    server.close();
  }
});

test('a numeric style numbers by first citation', async () => {
  await js(`paperMenu({ command: 'style', value: 'ieee' })`);
  await tick(800);
  assert.equal(await js(`document.querySelector('.chapter-body .cite').textContent`), '[1], [2]');
  assert.match(await js(`document.querySelector('#paper-refs .pr-entry').textContent`), /\[1\]\s*J\. Smith/);
  await js(`paperMenu({ command: 'style', value: 'apa' })`);
  await tick(800);
});

test('every way out', async () => {
  const JSZip = require('jszip');
  for (const format of ['pdf', 'html', 'docx', 'latex', 'pandoc', 'md', 'txt', 'epub', 'bib']) {
    await js(`paperExport(${JSON.stringify(format)})`);
    await tick(300);
  }
  for (let i = 0; i < 60 && fs.readdirSync(OUT).length < 9; i++) await tick(200);
  const files = fs.readdirSync(OUT).sort();
  assert.deepEqual(files.map((f) => path.extname(f)).sort(), ['.bib', '.docx', '.epub', '.html', '.md', '.pdf', '.txt', '.zip', '.zip']);
  const html = fs.readFileSync(path.join(OUT, files.find((f) => f.endsWith('.html'))), 'utf8');
  assert.match(html, /<h1 class="title">Inhibition in cortical circuits<\/h1>/);
  assert.match(html, /\(Doe, 2019; Smith et al\., 2020\)/);
  assert.match(html, /<figure id="fig-\w+" class="multi"><div class="panels"[^>]*><div class="panel" id="fig-\w+-a"[^>]*><img src="data:image\/png;base64,/);
  assert.match(html, /<div class="eq" id="eq-\w+"><span class="eq-body"><svg/);
  assert.match(html, /Smith, J\., Doe, J\., (&amp;|&#38;) Lee, A\. \(2020\)/);
  const pdf = fs.readFileSync(path.join(OUT, files.find((f) => f.endsWith('.pdf'))));
  assert.equal(pdf.slice(0, 4).toString(), '%PDF');
  const latex = await JSZip.loadAsync(fs.readFileSync(path.join(OUT, files.find((f) => /-latex\.zip$/.test(f)))));
  const tex = await latex.file('paper.tex').async('string');
  assert.match(tex, /\\citep\{doe2019brains,smith2020neural\}|\\citep\{smith2020neural,doe2019brains\}/);
  assert.match(tex, /\\section\{Methods\}\\label\{sec:\w+\}/);
  assert.match(tex, /\\\(E \\approx I\\\)/);
  assert.match(tex, /Figure~\\ref\{fig:\w+\}/);
  assert.match(await latex.file('references.bib').async('string'), /@article\{smith2020neural,/);
  assert.ok(Object.keys(latex.files).some((f) => /^figures\/figure-\w+\.png$/.test(f)));
  const md = await JSZip.loadAsync(fs.readFileSync(path.join(OUT, files.find((f) => /-markdown\.zip$/.test(f)))));
  const text = await md.file('paper.md').async('string');
  assert.match(text, /\[@smith2020neural; @doe2019brains\]|\[@doe2019brains; @smith2020neural\]/);
  assert.match(text, /<div id="fig:\w+">/);
  assert.ok(md.file('apa.csl'));
  const docx = await JSZip.loadAsync(fs.readFileSync(path.join(OUT, files.find((f) => f.endsWith('.docx')))));
  const doc = await docx.file('word/document.xml').async('string');
  assert.match(doc, /Neural dynamics of inhibition/);
  assert.ok(Object.keys(docx.files).filter((f) => f.startsWith('word/media/')).length >= 3, 'the figure and the maths are pictures in Word');
  // Word's own equations, not pictures, and a file macOS's reader takes
  assert.match(doc, /<m:oMath>/, 'the maths is a Word equation');
  const { execFileSync } = require('child_process');
  const has = (cmd) => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };
  const docxPath = path.join(OUT, files.find((f) => f.endsWith('.docx')));
  if (has('textutil')) {
    const words = execFileSync('textutil', ['-convert', 'txt', '-stdout', docxPath]).toString();
    assert.match(words, /Inhibition in cortical circuits/);
    assert.match(words, /Figure 1\. Firing rates across layers/);
  }
  const xmlOk = async (zip, test) => {
    if (!has('xmllint')) return;
    for (const name of Object.keys(zip.files).filter(test)) {
      execFileSync('xmllint', ['--noout', '-'], { input: await zip.file(name).async('string') });
    }
  };
  await xmlOk(docx, (n) => /\.(xml|rels)$/.test(n));
  // EPUB: well-formed, the pictures inside it
  const ep = await JSZip.loadAsync(fs.readFileSync(path.join(OUT, files.find((f) => f.endsWith('.epub')))));
  assert.equal(Object.keys(ep.files)[0], 'mimetype');
  assert.match(await ep.file('OEBPS/paper.xhtml').async('string'), /<img src="images\/figure-\w+\.png"/);
  await xmlOk(ep, (n) => /\.(xml|xhtml|opf)$/.test(n));
  // one Markdown file, references and pictures inside; plain text
  const mdOne = fs.readFileSync(path.join(OUT, files.find((f) => f.endsWith('.md'))), 'utf8');
  assert.match(mdOne, /references:\n {2}- \{"[^\n]*"smith2020neural"/);
  assert.match(mdOne, /\]\(data:image\/png;base64,/);
  const txt = fs.readFileSync(path.join(OUT, files.find((f) => f.endsWith('.txt'))), 'utf8');
  assert.match(txt, /^Inhibition in cortical circuits\n/);
  assert.match(txt, /\$E \\approx I\$/);
  // the LaTeX compiles, where there's a TeX to compile it with
  if (has('tectonic')) {
    const dir = path.join(tmp, 'tex');
    for (const [name, f] of Object.entries(latex.files)) {
      if (f.dir) continue;
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), await f.async('nodebuffer'));
    }
    execFileSync('tectonic', ['-X', 'compile', 'paper.tex'], { cwd: dir, stdio: 'ignore' });
    assert.ok(fs.existsSync(path.join(dir, 'paper.pdf')), 'paper.tex compiles');
  }
  if (SHOTS) for (const f of files) fs.copyFileSync(path.join(OUT, f), path.join(SHOTS, f));
});

test('a venue’s LaTeX template: imported, filled by the LaTeX export, anonymous or named, removed', async () => {
  const { execFileSync } = require('child_process');
  const JSZip = require('jszip');
  const fixture = path.join(__dirname, 'fixtures', 'templates', 'neurips');
  // the writer picks its loose files; the trash is the test's own
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: fs.readdirSync(fixture).map((f) => path.join(fixture, f)) });
  require('electron').shell.trashItem = async (p) => fs.rmSync(p, { force: true });
  await js(`paperImportTemplate()`);
  await tick(400);
  const meta = await js(`paperMeta()`);
  assert.equal(meta.journal, 'template');
  assert.equal(meta.template.kind, 'neurips');
  assert.match(meta.template.name, /NeurIPS 2025/);
  const { dir } = await saved();
  assert.ok(fs.existsSync(path.join(dir, 'template.zip')), 'kept beside the paper');
  // the LaTeX export fills it: the venue's preamble and files, the paper's words
  const exportTex = async () => {
    for (const f of fs.readdirSync(OUT)) if (/-latex\.zip$/.test(f)) fs.rmSync(path.join(OUT, f));
    await js(`paperExport('latex')`);
    for (let i = 0; i < 50 && !fs.readdirSync(OUT).some((f) => /-latex\.zip$/.test(f)); i++) await tick(200);
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(OUT, fs.readdirSync(OUT).find((f) => /-latex\.zip$/.test(f)))));
    return { zip, main: await zip.file('neurips_2025.tex').async('string') };
  };
  let { zip, main } = await exportTex();
  assert.ok(zip.file('neurips_2025.sty') && zip.file('references.bib'), Object.keys(zip.files).join(', '));
  assert.match(main, /\\title\{Inhibition in cortical circuits/);
  assert.match(main, /\\bibliography\{references\}/);
  assert.doesNotMatch(main, /Submission of papers to NeurIPS/, 'the venue’s example text left out');
  assert.match(main, /\\usepackage\[preprint\]\{neurips_2025\}/, 'named: the preprint version');
  if ((() => { try { execFileSync('which', ['tectonic'], { stdio: 'ignore' }); return true; } catch { return false; } })()) {
    const out = path.join(tmp, 'tex-neurips');
    for (const [name, f] of Object.entries(zip.files)) {
      if (f.dir) continue;
      fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
      fs.writeFileSync(path.join(out, name), await f.async('nodebuffer'));
    }
    execFileSync('tectonic', ['-X', 'compile', 'neurips_2025.tex'], { cwd: out, stdio: 'ignore' });
    assert.ok(fs.existsSync(path.join(out, 'neurips_2025.pdf')), 'the filled template compiles');
  }
  // anonymous for review: the template's own submission mode
  await js(`paperAnonymous(true)`);
  ({ main } = await exportTex());
  assert.match(main, /\\usepackage\{neurips_2025\}/);
  assert.doesNotMatch(main, /Ada Lovelace/);
  await js(`paperAnonymous(false)`);
  // removed: to the trash, and NEO's own LaTeX again, in the venue's look
  await js(`paperRemoveTemplate()`);
  await tick(300);
  assert.equal(await js(`paperMeta().journal`), 'neurips');
  assert.equal(await js(`!!paperMeta().template`), false);
  assert.equal(fs.existsSync(path.join(dir, 'template.zip')), false);
  await js(`paperMenu({ command: 'journal', value: 'preprint' })`);
  await tick(300);
});

test('the paper reopens as it was left', async () => {
  const { meta } = await saved();
  await js(`backToShelf()`);
  await tick(500);
  await snap('shelf');
  await js(`openBook(${JSON.stringify(meta.id)})`);
  await tick(1500);
  assert.equal(await js(`document.querySelectorAll('#chapters .math, #chapters .eq').length`), 2);
  assert.equal(await js(`[...document.querySelectorAll('#chapters .math, #chapters .eq')].every((n) => n.shadowRoot && n.shadowRoot.querySelector('svg'))`), true);
  assert.match(await js(`document.querySelector('#chapters figure img').src`), /^blob:/);
  assert.equal(await js(`document.querySelector('#chapters .xref').textContent`), 'Figure 1');
  await snap('reopened');
});

test('a paper’s own citation style (style.csl) is used again when it reopens', async () => {
  await js(`(async () => {
    const xml = await window.neo.paperAsset('ieee.csl');
    await window.neo.paperWrite(book.id, 'style.csl', btoa(unescape(encodeURIComponent(xml))));
    paperMeta().style = 'custom';
    paperMeta().customStyleTitle = 'My Journal';
    paper.proc = null;
    await saveMeta();
  })()`);
  const id = await js('book.id');
  await js(`backToShelf()`);
  await tick(400);
  await js(`openBook(${JSON.stringify(id)})`);
  await tick(1500);
  assert.equal(await js(`document.querySelector('#chapters .cite').textContent`), '[1], [2]');
  const { html } = await saved();
  assert.match(html, /<span class="cite"[^>]*>\[1\], \[2\]<\/span>/);
});

app.whenReady().then(async () => {
  for (let i = 0; i < 100 && !BrowserWindow.getAllWindows().length; i++) await tick(50);
  const win = BrowserWindow.getAllWindows()[0];
  wc = win.webContents;
  if (wc.isLoading()) await new Promise((resolve) => wc.once('did-finish-load', resolve));
  win.setSize(1280, 900);
  await tick(800);
  const errors = [];
  wc.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) errors.push(e.message); });
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log('ok -', name);
    } catch (err) {
      failed++;
      console.log('not ok -', name, '\n', err && err.stack || err);
      await snap('FAILED-' + name.slice(0, 30).replace(/\W+/g, '-'));
    }
  }
  if (errors.length) console.log('console errors:\n' + errors.join('\n'));
  console.log(failed ? `${failed} of ${tests.length} failed` : `all ${tests.length} passed`);
  app.exit(failed ? 1 : 0);
});
