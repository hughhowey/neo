// End-to-end tests for writing in Danish with an English interface: Dansk
// picked in Edit → Spellcheck Language is saved with the library; a Danish
// "i" (in) stays lowercase and a typed "I" (you) stays as typed, while
// sentences still start with a capital and f.eks. doesn't end one; the
// Danish dictionary underlines a misspelling and nothing else; English keeps
// its "i" → "I". NEO runs on a throwaway library, and the keys arrive as the
// writer types them. Run with `npm run test:danish`.

'use strict';

const { app, BrowserWindow, Menu } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A folder of its own for each run (see words.e2e.js for why earlier runs'
// folders are the ones removed).
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-danish-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-danish-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const libraryFile = path.join(tmp, 'NEO Library', 'library.json');
fs.mkdirSync(path.dirname(libraryFile));
fs.writeFileSync(libraryFile, JSON.stringify({
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
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

async function type(text) {
  for (const c of text) {
    // sendInputEvent has no key name for æ ø å: its keydown arrives with
    // e.key '' (the character itself still comes). A Danish keyboard's
    // keydown says 'æ', so send that one from the page, and the character
    // after it unless the keydown was taken (as autoCapKey takes it).
    if (/[^\x20-\x7e]/.test(c)) {
      await js(`(() => {
        const ev = new KeyboardEvent('keydown', { key: ${JSON.stringify(c)}, bubbles: true, cancelable: true });
        document.activeElement.dispatchEvent(ev);
        if (!ev.defaultPrevented) document.execCommand('insertText', false, ${JSON.stringify(c)});
      })()`);
      await tick(60);
      continue;
    }
    const keyCode = c === ' ' ? 'Space' : c;
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'char', keyCode: c });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
    await tick(60);
  }
}

// the caret at the end of paragraph n
async function caretEnd(n) {
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    body.focus();
    const r = document.createRange();
    r.selectNodeContents(body.children[${n}]);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await tick(200);
}
const para = (n) => js(`document.querySelector('.chapter-body').children[${n}].textContent`);

// Edit → Spellcheck Language → label, clicked the way the menu clicks it
function menuItem(label, items = Menu.getApplicationMenu().items) {
  for (const item of items) {
    if (item.label === label) return item;
    const found = item.submenu && menuItem(label, item.submenu.items);
    if (found) return found;
  }
  return null;
}
async function pickSpellLanguage(label, code) {
  const item = menuItem(label);
  assert.ok(item, `${label} in the menu`);
  item.click();
  for (let i = 0; i < 100 && (await js('library.spellLanguage')) !== code; i++) await tick(50);
  assert.equal(await js('library.spellLanguage'), code);
  await tick(300);
}

// the words the spellchecker underlines in paragraph n, once it has looked
async function underlined(n) {
  await js(`(() => { spellScanned = new Set(); spellCache.clear(); capsRanges.clear(); scanSpellingHere(); })()`);
  let words = [];
  for (let i = 0; i < 60; i++) {
    await tick(100);
    words = await js(`(() => {
      const p = document.querySelector('.chapter-body').children[${n}];
      const hl = CSS.highlights.get('neo-spell');
      return hl ? [...hl].filter((r) => p.contains(r.startContainer)).map((r) => r.toString()) : [];
    })()`);
    if (words.length) break;
  }
  return words;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('Dansk is picked with the interface left in English, and saved with the library', async () => {
  await pickSpellLanguage('Dansk', 'da');
  assert.equal(JSON.parse(fs.readFileSync(libraryFile, 'utf8')).spellLanguage, 'da');
  assert.equal(await js('NeoI18n.getLocale()'), 'en');
  assert.equal(menuItem('Dansk').checked, true);
  assert.equal(menuItem('Spellcheck Language').label, 'Spellcheck Language');
});

test('Danish "i" stays small, a typed "I" stays, sentences still start with a capital', async () => {
  await caretEnd(0);
  await type(' i dag var jeg i byen. vi købte f.eks. æbler, og I er velkomne. æblerne var gode.');
  await tick(200);
  assert.equal(await para(0), 'Det regnede. I dag var jeg i byen. Vi købte f.eks. æbler, og I er velkomne. Æblerne var gode.');
});

test('Danish abbreviations: bl.a. and dvs. go on in lowercase', async () => {
  await caretEnd(1);
  await type(' de solgte bl.a. pærer, dvs. frugt.');
  await tick(200);
  assert.equal(await para(1), 'Hun kom. De solgte bl.a. pærer, dvs. frugt.');
});

test('the Danish dictionary underlines the misspelling, not "i" or æ ø å', async () => {
  await js('toggleSpellcheck()');
  assert.equal(await js('spellOn'), true);
  assert.deepEqual(await underlined(2), ['forfater']);
});

test('English still makes "i" into "I", as typed and in the spellcheck', async () => {
  await pickSpellLanguage('English (US)', 'en-US');
  await caretEnd(3);
  await type(' and i think so.');
  await tick(200);
  assert.equal(await para(3), 'Yes. And I think so.');
  // a Danish "i" read as English is a capital slip again
  assert.ok((await underlined(2)).includes('i'));
  await pickSpellLanguage('Dansk', 'da');
  assert.ok(!(await underlined(2)).includes('i'));
});

/* ---------- runner ---------- */

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    win.setBounds({ width: 1200, height: 800 });
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(300);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      await addImportedBooks([{ name: 'Dansk', chapters: [
        { title: 'Et', paras: [
          { text: 'Det regnede.' },
          { text: 'Hun kom.' },
          { text: 'Hun skrev en bog om kærlighed og æbler i går, men forfater er stavet forkert.' },
          { text: 'Yes.' }
        ] }
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
