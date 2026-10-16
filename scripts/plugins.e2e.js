// End-to-end tests for the plugin host (plugins.js and plugins-main.js), on
// a throwaway library, with the fixture plugins in scripts/fixtures/plugins:
// ping sends a ping to its main half as it activates; broken throws while it
// activates; throws-early throws before it registers; wrong-id registers
// under another id; missing-script has no script at all; and dropper drops
// the invokes the host refuses.
// Run with `npm run test:plugins`.

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
  const pid = /^neo-plugins-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-plugins-test-${process.pid}-`));
const LIBRARY = path.join(tmp, 'NEO Library');
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(LIBRARY);
// hintShown: the once-per-library Enter hint would otherwise fill #hint
fs.writeFileSync(path.join(LIBRARY, 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, moreFeatures: true, pageTheme: 'night', hintShown: true,
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
// the fixture plugins, found the way a developer's own would be
process.env.NEO_PLUGIN_DIRS = 'scripts/fixtures/plugins';
// everything the window writes to its console, where Chromium reports a
// script the CSP refused
const consoleLines = [];
app.on('web-contents-created', (_e, contents) => {
  contents.on('console-message', (e) => consoleLines.push(String(e.message)));
});
// run from scripts/, NEO's window would look for scripts/index.html
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const str = JSON.stringify;

// the book imported in main(), { id, chapters }
let owls;
// #hint as the plugins left it at launch, before anything else spoke
let hintAtLaunch;

const errorLog = () => {
  try { return fs.readFileSync(path.join(LIBRARY, 'neo-errors.log'), 'utf8'); } catch { return ''; }
};
// the window logs through IPC, so a line lands a moment after it is sent
async function logWith(text) {
  for (let i = 0; i < 60 && !errorLog().includes(text); i++) await tick(50);
  return errorLog();
}
const chapterFile = (bookId, chId) => fs.readFileSync(path.join(LIBRARY, bookId, 'chapters', chId + '.html'), 'utf8');

// typed as keys
async function type(keys) {
  for (const k of keys) {
    wc.sendInputEvent({ type: 'keyDown', keyCode: k });
    wc.sendInputEvent({ type: 'char', keyCode: k });
    wc.sendInputEvent({ type: 'keyUp', keyCode: k });
  }
  await tick(300);
}

// the caret at the end of a chapter, as a click after its last word leaves it
async function caretAtEnd(chId) {
  await js(`(() => {
    const body = document.querySelector('.chapter[data-id="${chId}"] .chapter-body');
    body.focus();
    const r = document.createRange();
    r.selectNodeContents(body.lastElementChild);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await tick(100);
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('the ping plugin activates, and its main half answers its ping', async () => {
  assert.notEqual(await js('typeof window.__ping'), 'undefined', 'window.__ping is undefined: the ping plugin never loaded');
  assert.equal(await js('window.__ping.activated'), true);
  assert.deepEqual(await js('window.__ping.answer'), { pong: 'hello' });
});

test('refusals', async () => {
  await js(`(() => {
    window.__refused = [];
    NeoPlugins.register({ id: 'stranger', apiVersion: 1, activate() { window.__refused.push('stranger'); } });
    NeoPlugins.register({ id: 'ping', apiVersion: 99, activate() { window.__refused.push('ping'); } });
  })()`);
  const log = await logWith('plugin ping:');
  assert.match(log, /plugin stranger: .*not activated/);
  assert.match(log, /plugin ping: apiVersion 99\b.*not activated/);
  assert.deepEqual(await js('window.__refused'), []);
});

test('a plugin whose script does not load is logged and the rest carry on', async () => {
  const log = await logWith('plugin missing-script:');
  assert.match(log, /plugin missing-script: .*scripts\/fixtures\/plugins\/missing-script\/renderer\.js/);
  assert.equal(await js('window.__ping.activated'), true);
});

test('a plugin that throws while it activates is logged, invokes nothing, and writing goes on', async () => {
  assert.equal(hintAtLaunch, '', 'nothing was shown to the writer');
  const log = await logWith('plugin broken:');
  assert.match(log, /plugin broken: Error: broken on purpose\r?\n\s+at /);
  assert.match(await js(`window.__broken.neo.invoke('ping').then(() => 'answered', (err) => err.message)`), /\bbroken\b.*not active/);
  await js(`openBook(${str(owls.id)})`);
  await tick(300);
  await caretAtEnd(owls.chapters[0]);
  await type('Fox');
  await tick(1500);
  assert.match(chapterFile(owls.id, owls.chapters[0]), /Fox/);
  assert.equal(await js('errorToastShown'), false, 'nothing was shown to the writer');
});

// A script that throws before it registers never becomes a plugin: its
// error is logged under its name, and NEO's own net for errors, which
// would tell the writer, does not hear of it
test('a plugin whose script throws before it registers is logged under its name and not shown', async () => {
  const log = await logWith('plugin throws-early:');
  assert.match(log, /plugin throws-early: Error: throws early on purpose\r?\n\s+at /);
  assert.doesNotMatch(log, /Uncaught Error: throws early/);
  assert.equal(await js('errorToastShown'), false, 'nothing was shown to the writer');
});

test('a plugin whose script registers under another id is refused under that id', async () => {
  const log = await logWith('plugin some-other-id:');
  assert.match(log, /plugin some-other-id: not among the plugins NEO found at launch, so it is not activated/);
});

test('a main half\'s failure rejects the window\'s invoke naming the plugin and the channel, is logged once and opens no dialog', async () => {
  // the ping plugin's main half runs in this process, so the test can add to it
  const { host } = require('./fixtures/plugins/ping/main.js');
  host.handle('refused', () => {
    // what a plugin's own write in the library looks like when the system refuses it
    throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM', path: path.join(LIBRARY, 'ping.json') });
  });
  // an answer Electron cannot clone (a function) once left the invoke waiting for ever
  host.handle('unclonable', () => () => 1);
  const { dialog } = require('electron');
  const { showMessageBox } = dialog;
  const shown = [];
  dialog.showMessageBox = async (...args) => { shown.push(args); return {}; };
  const before = errorLog();
  try {
    const answers = await js(`Promise.all(['ping', 'fail', 'refused', 'unclonable'].map((channel) => Promise.race([
      window.__ping.neo.invoke(channel, 'sent').then((answer) => ({ answer }), (err) => ({ isError: err instanceof Error, message: err.message })),
      new Promise((resolve) => setTimeout(() => resolve({ waiting: true }), 3000))
    ])))`);
    assert.deepEqual(answers[0], { answer: { pong: 'sent' } });
    assert.equal(answers[1].isError, true);
    assert.match(answers[1].message, /\bping\b.*\bfail\b.*failed on purpose/);
    assert.match(answers[2].message, /\bping\b.*\brefused\b.*EPERM/);
    assert.match(answers[3].message, /\bping\b.*\bunclonable\b.*could not be cloned/, 'the invoke is rejected, not left waiting');
  } finally {
    dialog.showMessageBox = showMessageBox;
  }
  assert.deepEqual(shown, [], 'no dialog');
  const added = errorLog().slice(before.length);
  assert.equal(added.match(/\[plugin ping: invoke (fail|refused|unclonable)\]/g).length, 3, added);
  assert.doesNotMatch(added, /\[ipc plugin:invoke\]/);
});

// A promise a plugin drops, and that rejects, reaches the page as an
// unhandled rejection. NEO's net would log "Unhandled:" for each and tell
// the writer. The host credits the rejection to the plugin, and it is
// logged under its name, once a minute. The dropper plugin is used by no
// other test, so its quiet minute is this test's own: its first refusal is
// logged, and the other nineteen only counted.
test('an invoke a plugin does not await, and that is refused, is logged under the plugin and not shown', async () => {
  await js('window.__dropperInvoke(20)');
  for (let i = 0; i < 100 && (await js('window.__dropperRefused')) < 20; i++) await tick(50);
  assert.equal(await js('window.__dropperRefused'), 20, 'all twenty were refused');
  await tick(500); // the page reports a dropped rejection a turn later; the log is written through IPC
  assert.doesNotMatch(errorLog(), /Unhandled:/);
  assert.equal(errorLog().split('has a main half to answer index').length - 1, 1, 'one line for twenty refusals');
  assert.match(errorLog(), /\] \[renderer\] plugin dropper: Error: no plugin called dropper has a main half to answer index\r?\n\s+at /);
  assert.equal(await js('errorToastShown'), false, 'nothing was shown to the writer');
});

test('CSP', async () => {
  const refused = () => consoleLines.filter((line) => /Content Security Policy/i.test(line));
  assert.deepEqual(refused(), []);
  // the check can fail: an inline script is refused, and the console says so
  await js(`(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__inline = true';
    document.body.appendChild(s);
  })()`);
  await tick(300);
  assert.equal(await js('window.__inline'), undefined);
  assert.ok(refused().length > 0, 'the console reports the refused inline script');
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
    // the plugin scripts load after app.js; without a host they never do
    for (let i = 0; i < 100 && !(await js('!!(window.__ping && window.__ping.answer)')); i++) await tick(50);
    await tick(300);
    hintAtLaunch = await js(`document.getElementById('hint').textContent`);
    owls = await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      await addImportedBooks([
        { name: 'Owls', chapters: [{ title: 'One', paras: [{ text: 'One paragraph.' }, { text: 'Rain fell on the harbor.' }] }] }
      ], library.shelves[0]);
      const id = library.shelves[0].bookIds[0];
      const meta = await window.neo.readBookMeta(id);
      return { id, chapters: meta.chapterOrder };
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
