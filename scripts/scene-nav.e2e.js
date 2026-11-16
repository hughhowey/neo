'use strict';

const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-scene-nav-'));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({ firstRunDone: true, features: { sceneNav: true },
  shelves: [{ id: 'shelf-1', name: 'Tests', bookIds: [] }] }));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) { return loadFile.call(this, path.resolve(__dirname, '..', file), opts); };
require('../main.js');
const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const html = '<p>Alpha <em>first</em>.</p><p class="scene-break">***</p>' +
  '<p data-sec-id="sec-b">Beta <strong>second</strong> <span class="ph-mark" data-sid="flag-b" contenteditable="false">⚑</span>.</p>' +
  '<p class="scene-break">***</p><p>Gamma third.</p>';
const seed = () => js(`(async () => {
  const ids = book.chapterOrder.filter((c) => isStory(c));
  window.testCh = ids[0]; window.otherCh = ids[1];
  book.sectionNotes = { [testCh]: [{ id: 'sec-b', text: '<img src=x> Beta plan' }] };
  stickies = [{ id: 'flag-b', chapterId: testCh, text: 'Keep this fact' }];
  chapterHTML[testCh] = ${JSON.stringify(html)};
  chapterHTML[otherCh] = '<p>Destination.</p>';
  for (const c of [testCh, otherCh]) await persistChapter(c);
  await saveMeta();
  renderChapters(); renderNav();
  $('#nav-pane').classList.add('open'); $('#nav-pane').dataset.pinned = '1';
  window.originalHTML = chapterHTML[testCh];
})()`);
const texts = () => js('chapterSegments(testCh).map((s) => s.first)');

test('nested rows use notes/opening words, preserve literal text, and omit single-scene chapters', async () => {
  await seed();
  const got = await js(`({ labels: [...document.querySelectorAll('.nav-item[data-id="' + testCh + '"] .nav-scene-label')].map((e) => e.textContent),
    other: document.querySelectorAll('.nav-item[data-id="' + otherCh + '"] .nav-scene').length,
    images: document.querySelectorAll('.nav-scenes img').length })`);
  assert.deepEqual(got.labels, ['Alpha first.', '<img src=x> Beta plan', 'Gamma third.']);
  assert.equal(got.other, 0); assert.equal(got.images, 0);
});

test('click and keyboard activation reach the scene without saving navigation into prose', async () => {
  await js(`document.querySelector('.nav-scene[data-seg="1"]').click()`);
  assert.equal(await js(`window.getSelection().anchorNode.closest('p').textContent`), 'Beta second ⚑.');
  assert.equal(await js('chapterHTML[testCh]'), await js('originalHTML'));
  wc.getOwnerBrowserWindow().focus();
  wc.focus();
  await js(`document.querySelector('.nav-scene[data-seg="2"]').focus()`);
  await tick();
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  wc.sendInputEvent({ type: 'char', keyCode: '\r' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await tick();
  assert.equal(await js(`window.getSelection().anchorNode.closest('p').textContent`), 'Gamma third.');
});

test('Alt+Up reorders once; undo retains markup, outline ownership and placeholders', async () => {
  await js(`document.querySelector('.nav-scene[data-seg="1"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }))`);
  assert.deepEqual(await texts(), ['Beta second ⚑.', 'Alpha first.', 'Gamma third.']);
  assert.equal(await js('document.activeElement.dataset.seg'), '0');
  await js('structuralUndo()');
  assert.equal(await js('chapterHTML[testCh]'), await js('originalHTML'));
  assert.equal(await js('book.sectionNotes[testCh][0].id'), 'sec-b');
  assert.equal(await js('stickies[0].chapterId'), await js('testCh'));
});

test('Alt+Down moves to the end and boundary moves do not add undo entries', async () => {
  await seed();
  await js(`document.querySelector('.nav-scene[data-seg="1"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }))`);
  assert.deepEqual(await texts(), ['Alpha first.', 'Gamma third.', 'Beta second ⚑.']);
  const before = await js('undoStack.length');
  await js(`document.querySelector('.nav-scene[data-seg="2"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }))`);
  assert.equal(await js('undoStack.length'), before);
  await js('structuralUndo()');
});

test('native drag handlers move scenes between chapters with their notes and flags; undo recovers', async () => {
  await seed();
  await js(`(() => {
    const row = document.querySelector('.nav-scene[data-seg="1"]');
    const dt = new DataTransfer();
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    renderNav();
    if (!row.isConnected) throw new Error('drag source replaced');
    const target = document.querySelector('.nav-item[data-id="' + otherCh + '"] .n-row');
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  })()`);
  assert.deepEqual(await texts(), ['Alpha first.', 'Gamma third.']);
  assert.equal(await js('chapterSegments(otherCh).at(-1).first'), 'Beta second ⚑.');
  assert.equal(await js('book.sectionNotes[otherCh][0].id'), 'sec-b');
  assert.equal(await js('stickies[0].chapterId'), await js('otherCh'));
  assert.equal(await js('chapterDragActive'), false);
  assert.equal(await js('!!document.querySelector(".nav-drop-ind")'), false);
  await js('structuralUndo()');
  assert.equal(await js('chapterHTML[testCh]'), await js('originalHTML'));
});

test('right-click chapter picker offers a keyboard-accessible alternative to dragging', async () => {
  await seed();
  await js(`document.querySelector('.nav-scene[data-seg="1"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`);
  assert.equal(await js(`document.querySelector('.pop-menu').getAttribute('aria-label')`), 'Move scene to chapter');
  await js(`document.querySelector('.pop-menu button').click()`);
  await tick();
  assert.equal(await js('chapterSegments(otherCh).at(-1).first'), 'Beta second ⚑.');
  await js('structuralUndo()');
});

test('dropping above another scene reorders within a chapter and drag cancellation cleans up', async () => {
  await seed();
  await js(`(() => {
    const row = document.querySelector('.nav-scene[data-seg="2"]');
    const dt = new DataTransfer();
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const target = document.querySelector('.nav-scene[data-seg="0"]');
    const y = target.getBoundingClientRect().top + 1;
    target.dispatchEvent(new DragEvent('dragover', { clientY: y, bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { clientY: y, bubbles: true, cancelable: true, dataTransfer: dt }));
  })()`);
  assert.deepEqual(await texts(), ['Gamma third.', 'Alpha first.', 'Beta second ⚑.']);
  await js('structuralUndo()');
  const count = await js('undoStack.length');
  await js(`(() => {
    const row = document.querySelector('.nav-scene[data-seg="1"]');
    const dt = new DataTransfer();
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  })()`);
  assert.equal(await js('chapterDragActive'), false);
  assert.equal(await js('undoStack.length'), count);
});

test('empty scenes have labels, and simple mode hides rows immediately without changing text', async () => {
  await seed();
  await js(`chapterHTML[testCh] += '<p class="scene-break">***</p><p><br></p>'; renderChapters(); renderNav()`);
  assert.equal(await js(`document.querySelector('.nav-scene[data-seg="3"] .nav-scene-label').textContent`), 'Scene 4');
  const before = await js('chapterHTML[testCh]');
  await js('setMoreFeatures(false)');
  assert.equal(await js('document.querySelectorAll(".nav-scene").length'), 0);
  assert.equal(await js('chapterHTML[testCh]'), before);
  await js('setMoreFeatures(true)');
  assert.equal(await js('document.querySelectorAll(".nav-scene").length'), 4);
});

test('scene moves persist through reopening the book', async () => {
  await seed();
  await js(`document.querySelector('.nav-scene[data-seg="1"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }))`);
  await js(`(async () => { await persistChapter(testCh); await saveMeta(); const id = book.id; await backToShelf(); await openBook(id); })()`);
  assert.deepEqual(await texts(), ['Beta second ⚑.', 'Alpha first.', 'Gamma third.']);
});

(async () => {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick();
    wc = win.webContents;
    win.show(); win.focus();
    while (!(await js('typeof library !== "undefined" && !!library').catch(() => false))) await tick();
    await js(`(async () => {
      await addImportedBooks([{ name: 'Scenes', chapters: [
        { title: 'First', paras: [{ text: 'First.' }] }, { title: 'Second', paras: [{ text: 'Second.' }] }
      ] }], library.shelves[0]); await openBook(library.shelves[0].bookIds.at(-1));
    })()`);
    for (const t of tests) {
      try {
        await t.fn(); console.log('ok ' + t.name);
        if (t === tests[0] && process.env.NEO_TEST_SHOTS) {
          await tick(400);
          fs.mkdirSync(process.env.NEO_TEST_SHOTS, { recursive: true });
          wc.debugger.attach('1.3');
          const shot = await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: false });
          wc.debugger.detach();
          fs.writeFileSync(path.join(process.env.NEO_TEST_SHOTS, 'scene-nav.png'), Buffer.from(shot.data, 'base64'));
        }
      }
      catch (err) { failed++; console.error('FAIL ' + t.name + '\n' + err.stack); }
    }
    console.log(`${tests.length - failed} passed, ${failed} failed`);
  } catch (err) { failed++; console.error(err); }
  finally { app.exit(failed ? 1 : 0); }
})();
