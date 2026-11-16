// End-to-end tests for sprints. NEO runs on a throwaway library, a sprint is
// started the way the writer starts one (the word counter, then Start
// sprint), and everything is read off the screen. No test waits ten minutes:
// the sprint's clock is moved to its end instead. Run with `npm run test:sprint`.

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
  const pid = /^neo-sprint-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-sprint-test-${process.pid}-`));
const LIB = path.join(tmp, 'NEO Library');
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(LIB);
fs.writeFileSync(path.join(LIB, 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, moreFeatures: false, pageTheme: 'night',
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
const text = (id) => js(`(document.getElementById(${JSON.stringify(id)}) || {}).textContent || ''`);
const shown = (id) => js(`(() => { const el = document.getElementById(${JSON.stringify(id)}); return !!el && !el.hidden; })()`);
const LATER = /^Last sprint: \d+ words? in \d+ mins? \d+ seconds? \([\d,]+ words\/hr\)$/;
const RESULT = /^Sprint Complete: (\d+) words? in (\d+) mins? (\d+) seconds? \(([\d,]+) words\/hr\)$/;

// NEO_SPRINT_SHOTS=<folder>: a picture of the window at each step
let shots = 0;
async function shot(name) {
  if (!process.env.NEO_SPRINT_SHOTS) return;
  const img = await wc.capturePage();
  fs.writeFileSync(path.join(process.env.NEO_SPRINT_SHOTS, `${String(++shots).padStart(2, '0')}-${name}.png`), img.toPNG());
}

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
  await tick(300);
}
async function openGoals() {
  await js(`document.getElementById('goal-counter').click()`);
  await tick(100);
}
// fill the Goals window's sprint row; nothing is set that the test leaves out
async function choose({ by, minutes, words, chime }) {
  await js(`(() => {
    const set = (id, v) => { if (v !== undefined) document.getElementById(id).value = v; };
    set('st-sprint-by', ${JSON.stringify(by)});
    document.getElementById('st-sprint-by').onchange();
    set('st-sprint-min', ${JSON.stringify(minutes)});
    set('st-sprint', ${JSON.stringify(words)});
    if (${JSON.stringify(chime)} !== undefined) document.getElementById('st-sprint-chime').checked = ${JSON.stringify(chime)};
  })()`);
}
async function pressSprintButton() {
  await js(`document.getElementById('st-sprint-btn').click()`);
  await tick(400); // the window saves the library, then closes
}
// the clock of a running sprint, moved to its last moment
async function runOutTheClock() {
  await js(`sprint.endsAt = Date.now()`);
  await tick(900);
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a first sprint is offered as ten minutes, with the word box unlit', async () => {
  await openGoals();
  await shot('goals');
  assert.equal(await js(`document.getElementById('st-sprint-by').value`), 'time');
  assert.equal(await js(`document.getElementById('st-sprint-min').value`), '10');
  assert.equal(await js(`document.getElementById('st-sprint-min').disabled`), false);
  assert.equal(await js(`document.getElementById('st-sprint').disabled`), true);
  assert.equal(await js(`document.getElementById('st-sprint-chime').checked`), true);
  assert.equal(await text('st-sprint-btn'), 'Start sprint');
});

test('Start sprint puts the words and the time left where today\'s count was', async () => {
  await pressSprintButton();
  assert.match(await text('goal-counter'), /^⚡ 0 · (10:00|9:5\d)$/);
  assert.equal(await text('hint'), '10-minute sprint. Go.');
  await caretAtEnd();
  await type(' one two three');
  assert.match(await text('goal-counter'), /^⚡ 3 · 9:\d\d$/);
  await shot('running');
});

test('the clock counts down without a key being pressed', async () => {
  const before = await text('goal-counter');
  await tick(1600);
  assert.notEqual(await text('goal-counter'), before);
});

test('when the time is up the sprint ends itself and says how it went', async () => {
  await runOutTheClock();
  const said = RESULT.exec(await text('hint'));
  assert.ok(said, 'the result: ' + await text('hint'));
  assert.deepEqual(said.slice(1, 4), ['3', '10', '0']);
  assert.equal(said[4], '18', '3 words in 10 minutes is 18 an hour');
  assert.equal(await js('sprint'), null);
  assert.equal(await text('goal-counter'), '3 today');
  await shot('over');
});

test('Sprint again appears beside the counter, and runs the same sprint', async () => {
  assert.equal(await shown('sprint-again'), true);
  assert.equal(await text('sprint-again'), '⚡ Sprint again');
  assert.match(await js(`document.getElementById('sprint-again').title`), LATER);
  await js(`document.getElementById('sprint-again').click()`);
  await tick(100);
  assert.equal(await shown('sprint-again'), false);
  assert.match(await text('goal-counter'), /^⚡ 0 · (10:00|9:5\d)$/);
  assert.deepEqual(await js(`({ by: sprint.by, minutes: sprint.minutes, chime: sprint.chime })`), { by: 'time', minutes: 10, chime: true });
});

test('End sprint stops it early and reports the time it really ran', async () => {
  await caretAtEnd();
  await type(' four five');
  await openGoals();
  assert.equal(await text('st-sprint-btn'), 'End sprint');
  await pressSprintButton();
  const said = RESULT.exec(await text('hint'));
  assert.ok(said, 'the result: ' + await text('hint'));
  assert.equal(said[1], '2');
  assert.equal(said[2], '0', 'seconds, not the ten minutes it was set for');
  assert.equal(await js('sprint'), null);
});

test('the Goals window shows how the last sprint went', async () => {
  await openGoals();
  assert.match(await text('st-sprint-last'), LATER);
  await shot('goals-after');
  await js(`document.querySelector('.modal-backdrop .m-ok').click()`);
  await tick(300);
});

test('a sprint to a word count ends at the word that reaches it', async () => {
  await openGoals();
  await choose({ by: 'words', words: 4 });
  assert.equal(await js(`document.getElementById('st-sprint-min').disabled`), true);
  assert.equal(await js(`document.getElementById('st-sprint').disabled`), false);
  await pressSprintButton();
  assert.equal(await text('goal-counter'), '⚡ 0 / 4');
  await caretAtEnd();
  await type(' six seven eight');
  assert.equal(await text('goal-counter'), '⚡ 3 / 4');
  assert.notEqual(await js('sprint'), null);
  await type(' nine');
  assert.equal(await js('sprint'), null);
  const said = RESULT.exec(await text('hint'));
  assert.ok(said, 'the result: ' + await text('hint'));
  assert.equal(said[1], '4');
  assert.equal(await text('goal-counter'), '9 today');
});

test('the sprint\'s settings are kept in library.json for next time', async () => {
  await tick(300);
  const lib = JSON.parse(fs.readFileSync(path.join(LIB, 'library.json'), 'utf8'));
  assert.deepEqual(lib.sprint, { by: 'words', minutes: 10, words: 4, chime: true });
});

test('a sprint whose time runs out on the shelf ends without a word', async () => {
  await openGoals();
  await choose({ by: 'time', minutes: 1 });
  await pressSprintButton();
  await js(`backToShelf()`);
  await tick(400);
  await js(`document.getElementById('hint').textContent = ''`);
  await runOutTheClock();
  assert.equal(await js('sprint'), null);
  assert.equal(await text('hint'), '');
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
      await addImportedBooks([{ name: 'Sprint', chapters: [
        { title: 'One', paras: [{ text: 'Rain fell on the harbor.' }] }
      ] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
    })()`);
    await tick(1200); // a first book opens with a hint about Enter; let it come before a sprint says anything
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
