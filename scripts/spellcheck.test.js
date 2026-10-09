'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const localRequire = createRequire(path.join(root, 'main.js'));
const source = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('Hunspell reads the pinned Romanian dictionary as published', async () => {
  const dir = path.join(root, 'node_modules/dictionary-ro');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))).version, '3.0.0');
  const send = spellWorker();
  assert.equal((await send({ type: 'load', language: 'ro', dir })).ok, true);
  // prefix + suffix sharing a flag: the case nspell needed converting
  const res = await send({ type: 'check', words: ['trebui', 'citi', 'merge', 'reciti', 'recitit'] });
  for (const [word, ok] of Object.entries(res.result)) assert.equal(ok, true, word);
});

test('Hunspell reads the pinned Hungarian dictionary and suggests accents', async () => {
  const dir = path.join(root, 'node_modules/dictionary-hu');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))).version, '1.9.0');
  const send = spellWorker();
  assert.equal((await send({ type: 'load', language: 'hu', dir })).ok, true);
  const good = await send({ type: 'check', words: ['ház', 'házaimban', 'gyönyörű', 'Budapesten', 'íróasztal', 'szerkesztőknek'] });
  for (const [word, ok] of Object.entries(good.result)) assert.equal(ok, true, word);
  const bad = await send({ type: 'check', words: ['gyonyoru', 'haz'] });
  for (const [word, ok] of Object.entries(bad.result)) assert.equal(ok, false, word);
  assert.ok((await send({ type: 'suggest', word: 'gyonyoru' })).result.includes('gyönyörű'));
});

test('the Hungarian dictionary takes every accusative (könyvet, szívet, évet)', async () => {
  const send = spellWorker();
  assert.equal((await send({ type: 'load', language: 'hu', dir: path.join(root, 'node_modules/dictionary-hu') })).ok, true);
  const res = await send({ type: 'check', words: ['könyvet', 'szívet', 'évet', 'kertet', 'almát'] });
  for (const [word, ok] of Object.entries(res.result)) assert.equal(ok, true, word);
});

test('Swedish: accents, inflections, compounds, suggestions and dictionary changes', async () => {
  const send = spellWorker();
  const dir = path.join(root, 'node_modules/dictionary-sv');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))).version, '4.0.0');
  assert.equal((await send({ type: 'load', language: 'sv', dir })).ok, true);
  const good = await send({ type: 'check', words: ['författare', 'böcker', 'huset', 'smörgåsar', 'räksmörgås', 'sjuksköterska', 'överraskning'] });
  for (const [word, ok] of Object.entries(good.result)) assert.equal(ok, true, word);
  const bad = await send({ type: 'check', words: ['förfatatre', 'sjuksköterskka', 'smörgåss'] });
  for (const [word, ok] of Object.entries(bad.result)) assert.equal(ok, false, word);
  assert.ok((await send({ type: 'suggest', word: 'förfatatre' })).result.includes('författare'));
  assert.equal((await send({ type: 'load', language: 'en-US', dir: path.join(root, 'node_modules/dictionary-en-us') })).ok, true);
  assert.equal((await send({ type: 'check', words: ['hello'] })).result.hello, true);
  assert.equal((await send({ type: 'load', language: 'sv', dir })).ok, true);
  assert.equal((await send({ type: 'check', words: ['hello', 'författare'] })).result.hello, false);
  assert.equal((await send({ type: 'check', words: ['författare'] })).result.författare, true);
});

function spellWorker() {
  let handle, reply;
  const context = vm.createContext({
    require: localRequire,
    process: { parentPort: {
      on: (_name, callback) => { handle = callback; },
      postMessage: (message) => { reply = message; }
    } }
  });
  // The string is the file on disk. filename is how Node attributes coverage to it.
  vm.runInContext(source('spell-worker.js'), context, { filename: path.join(root, 'spell-worker.js') });
  let id = 0;
  const waiting = new Map();
  reply = null;
  // the worker answers asynchronously and in order
  context.process.parentPort.postMessage = (message) => {
    const done = waiting.get(message.id);
    waiting.delete(message.id);
    if (done) done(message);
  };
  return (message) => new Promise((resolve) => {
    const n = ++id;
    waiting.set(n, (m) => { assert.equal(m.id, n); resolve(m); });
    handle({ data: { id: n, ...message } });
  });
}

test('worker checks Romanian, suggests, learns and switches languages', async () => {
  const send = spellWorker();
  const load = async (language, pkg, custom = []) => {
    assert.equal((await send({ type: 'load', language, dir: path.join(root, 'node_modules', pkg), custom })).ok, true);
  };
  const check = async (words, expected) => {
    const res = await send({ type: 'check', words });
    assert.equal(res.ok, true);
    assert.deepEqual(Object.keys(res.result), words);
    for (const word of words) assert.equal(res.result[word], expected, word);
  };
  await check(['frgament'], true); // no dictionary yet
  await load('ro', 'dictionary-ro', ['Zorţilă']);
  await check(['Acest', 'fragment', 'ar', 'trebui', 'să', 'fie', 'corect',
    'trebuia', 'trebuit', 'trebuiau', 'citi', 'merge', 'reciti', 'recitit',
    'română', 'școală', 'țară', 'Știință', 'mănâncă', 'învățăm', 'sa',
    'şcoală', 'ţară', 'Ştiinţă', 'Țară'.normalize('NFD'),
    'şcoală'.normalize('NFD'), 'română'.normalize('NFD'),
    'Zorțilă', 'Zorţilă'.normalize('NFD')], true);
  await check(['acset', 'frgament', 'coretc', 'școaală', 'scoala', 'țarra'], false);
  for (const [word, wanted] of [['frgament', 'fragment'], ['coretc', 'corect'],
    ['şcoaală', 'școală'], ['școaală'.normalize('NFD'), 'școală']]) {
    const suggestions = (await send({ type: 'suggest', word })).result;
    assert.ok(suggestions.includes(wanted), word);
    assert.ok(suggestions.length <= 6);
  }
  assert.equal((await send({ type: 'add', word: 'Nerțulică'.normalize('NFD') })).ok, true);
  await check(['Nerțulică', 'Nerţulică', 'Nerţulică'.normalize('NFD')], true);
  assert.equal((await send({ type: 'load', language: 'en-US', dir: '/no-such-neo-dictionary' })).ok, false);
  await check(['şcoală', 'trebui'], true); // failed load keeps the previous dictionary and normalization
  await load('en-US', 'dictionary-en-us', ['Zorţilă']);
  await check(['This', 'sentence', 'should', 'be', 'correct', 'Zorţilă'], true);
  await check(['frgament', 'Zorțilă'], false); // Romanian normalization does not leak into English
  await load('ro', 'dictionary-ro', ['Nerţulică']);
  await check(['Nerțulică', 'Nerţulică'.normalize('NFD'), 'trebui'], true);
});

test('learning a Romanian word removes cached Unicode-variant underlines across editors', async () => {
  const send = spellWorker();
  assert.equal((await send({ type: 'load', language: 'ro', dir: path.join(root, 'node_modules/dictionary-ro') })).ok, true);
  const variants = ['Nerţulică', 'Nerțulică', 'Nerțulică'.normalize('NFD')];
  const makeEditor = (text, id) => {
    const node = { data: text, nodeType: 3, isConnected: true };
    return {
      node, id, dataset: { kind: 'notes' },
      closest: (selector) => selector === '.chapter' ? { dataset: { id } } : editors[id]
    };
  };
  const editors = {
    'ch-test': makeEditor(variants.slice(0, 2).join(' ') + ' frgament', 'ch-test'),
    'aux-editor': makeEditor(variants[2] + ' coretc', 'aux-editor')
  };
  const originalText = Object.values(editors).map((el) => el.node.data);
  let contextmenu, actions, savedLibrary;
  class TextRange {
    setStart(node, offset) { this.node = node; this.start = offset; }
    setEnd(_node, offset) { this.end = offset; }
    toString() { return this.node.data.slice(this.start, this.end); }
  }
  const highlights = new Map();
  const context = vm.createContext({
    document: {
      addEventListener: (name, callback) => { if (name === 'contextmenu') contextmenu = callback; },
      createTreeWalker: (el) => {
        let node = el.node;
        return { nextNode: () => { const next = node; node = null; return next; } };
      },
      querySelector: (selector) => selector.startsWith('.chapter[') ? editors['ch-test'] : null,
      caretRangeFromPoint: () => ({ startContainer: editors['ch-test'].node, startOffset: 2 })
    },
    Node: { TEXT_NODE: 3 }, NodeFilter: { SHOW_TEXT: 4 }, Range: TextRange,
    Highlight: Set, CSS: { highlights },
    $: () => editors['aux-editor'], t: (text) => text, tk: (text) => text, toast() {},
    currentTab: 'manuscript', currentChapterId: 'ch-test', library: {},
    captureMenu: (_x, _y, _word, _suggestions, callbacks) => { actions = callbacks; },
    window: { neo: {
      spellCheckWords: async (words) => (await send({ type: 'check', words })).result,
      spellSuggest: async (word) => (await send({ type: 'suggest', word })).result,
      spellLearn: async (word) => (await send({ type: 'add', word })).ok,
      writeLibrary: async (library) => { savedLibrary = JSON.parse(JSON.stringify(library)); }
    } }
  });
  // app.js saves the library through its own writeLibrary(), which counts
  // writes before handing them to window.neo
  context.writeLibrary = (lib) => context.window.neo.writeLibrary(lib);
  const app = source('app.js');
  // Use the real scanner, cache and context-menu learn callback. Only DOM
  // primitives and IPC transport are replaced; the worker loads Hunspell.
  vm.runInContext(app.slice(app.indexOf('let spellOn = false;'), app.indexOf('let typewriterEnabled = false;')), context);
  vm.runInContext('spellOn = true; showSpellMenu = captureMenu;', context);
  await vm.runInContext('Promise.all([spellScanEl(spellElFor("ch-test"), "ch-test"), spellScanEl(spellElFor("aux-notes"), "aux-notes")])', context);
  const flagged = () => [...highlights.get('neo-spell')].map((range) => range.toString());
  assert.deepEqual(flagged(), [variants[0], variants[1], 'frgament', variants[2], 'coretc']);
  await contextmenu({ target: editors['ch-test'], clientX: 0, clientY: 0, preventDefault() {} });
  assert.ok(actions);
  await actions.learn();
  // The existing learn callback starts asynchronous rescans without awaiting them.
  await new Promise(setImmediate);
  assert.deepEqual(flagged(), ['frgament', 'coretc']);
  assert.deepEqual(savedLibrary.customWords, [variants[0]]);
  assert.deepEqual(Object.values(editors).map((el) => el.node.data), originalText);
  assert.equal(vm.runInContext('spellOn', context), true);
  vm.runInContext('toggleSpellcheck();', context);
  assert.equal(highlights.has('neo-spell'), false);
  vm.runInContext('toggleSpellcheck();', context);
  await new Promise(setImmediate);
  assert.deepEqual(flagged(), ['frgament']);
});

// Run the real main-process startup functions against a temporary library.
// Only Electron's window/worker APIs are replaced; settings and library IO
// use the same code and files as the app.
function mainContext(temp, systemLocale, settings = {}, library = {}, raw = null) {
  fs.writeFileSync(path.join(temp, 'settings.json'), JSON.stringify(settings));
  fs.writeFileSync(path.join(temp, 'library.json'), raw === null ? JSON.stringify(library) : raw);
  const loads = [], handlers = new Map();
  let receive;
  const electron = {
    app: {
      commandLine: { appendSwitch() {} },
      getPath: () => temp,
      getLocale: () => systemLocale,
      requestSingleInstanceLock: () => true,
      whenReady: () => ({ then() {} }),
      on() {}
    },
    ipcMain: { on() {}, handle: (name, fn) => handlers.set(name, fn) },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
    utilityProcess: { fork: () => ({
      on: (name, fn) => { if (name === 'message') receive = fn; },
      postMessage: (message) => {
        loads.push(message);
        queueMicrotask(() => receive({ id: message.id, ok: true }));
      }
    }) }
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: root,
    process: { platform: process.platform, on() {} },
    console,
    temp
  });
  // The string is the file on disk. filename is how Node attributes coverage to it.
  vm.runInContext(source('main.js'), context, { filename: path.join(root, 'main.js') });
  vm.runInContext('LIBRARY_DIR = temp; LIBRARY_FILE = require("path").join(temp, "library.json"); initLanguage(); initSpell();', context);
  return { context, loads, handlers, read: () => JSON.parse(fs.readFileSync(path.join(temp, 'library.json'))) };
}

test('spellcheck follows the interface until a dictionary is picked; nothing is saved for the writer', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-spell-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const fresh = mainContext(temp, 'ro_RO', {}, { authorName: 'Autor', customWords: ['Zorțilă'] });
  assert.equal(fresh.read().spellLanguage, undefined); // not saved on the writer's behalf
  assert.equal(fresh.read().authorName, 'Autor');
  assert.equal(vm.runInContext('spellLanguage', fresh.context), 'ro');
  assert.equal(fresh.loads[0].language, 'ro');
  assert.deepEqual(Array.from(fresh.loads[0].custom), ['Zorțilă']);
  // switching the interface takes a dictionary nobody picked along with it
  vm.runInContext('setUiLanguage("en")', fresh.context);
  assert.equal(vm.runInContext('spellLanguage', fresh.context), 'en-US');
  assert.equal(fresh.loads.length, 2);
  assert.equal(fresh.loads[1].language, 'en-US');
  assert.equal(fresh.read().spellLanguage, undefined);
  await Promise.resolve();

  // the same rule for every language: its own dictionary when NEO has one
  for (const [locale, code] of [['ru_RU', 'ru'], ['fr-CA', 'fr'], ['de', 'de'], ['pl', 'pl'], ['en-US', 'en-US'], ['it', 'en-US'], ['pt-BR', 'pt-BR'], ['pt-PT', 'en-US']]) {
    const ui = mainContext(temp, locale);
    assert.equal(ui.loads[0].language, code, locale);
    assert.equal(ui.read().spellLanguage, undefined);
    await Promise.resolve();
  }

  // a dictionary picked in Edit → Spellcheck Language wins, whatever the interface
  for (const code of ['en-US', 'en-GB', 'fr', 'ro', 'sv']) {
    const explicit = mainContext(temp, 'ro-RO', {}, { spellLanguage: code });
    assert.equal(explicit.loads[0].language, code);
    assert.equal(explicit.read().spellLanguage, code);
    vm.runInContext('setUiLanguage("de")', explicit.context);
    assert.equal(explicit.loads.length, 1);
    await Promise.resolve();
  }

  // a library.json that doesn't parse is never touched
  const broken = '{"shelves": [{"id": "shelf-1", "name": "Mine"';
  const unreadable = mainContext(temp, 'ro_RO', {}, {}, broken);
  assert.equal(fs.readFileSync(path.join(temp, 'library.json'), 'utf8'), broken);
  assert.equal(unreadable.loads[0].language, 'ro');
  await Promise.resolve();
});

test('Brazilian Portuguese: clitics, 1990 reform spellings, hyphenated words', async () => {
  const send = spellWorker();
  const dir = path.join(root, 'node_modules/dictionary-pt');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))).version, '4.0.0');
  assert.equal((await send({ type: 'load', language: 'pt-BR', dir })).ok, true);
  const check = async (words, expected) => {
    const res = await send({ type: 'check', words });
    for (const word of words) assert.equal(res.result[word], expected, word);
  };
  await check(['fazê-lo', 'disse-lhe', 'dir-se-ia', 'amá-lo-ei', 'e-mail', 'guarda-chuva',
    'ideia', 'voo', 'linguiça', 'coração', 'Brasil', 'escrevendo'], true);
  await check(['coracao', 'escrevenddo', 'excessão', 'previlégio'], false);
  assert.ok((await send({ type: 'suggest', word: 'coracao' })).result.includes('coração'));
});

test('hyphenated words: the whole word first, then only the wrong pieces', async () => {
  const send = spellWorker();
  assert.equal((await send({ type: 'load', language: 'en-US', dir: path.join(root, 'node_modules/dictionary-en-us') })).ok, true);
  const node = { data: 'An e-mail, a well-known x-ray, a well-knwon one, and NASA-style flair.', nodeType: 3, isConnected: true };
  const el = { node };
  class TextRange {
    setStart(n, offset) { this.node = n; this.start = offset; }
    setEnd(_n, offset) { this.end = offset; }
    toString() { return this.node.data.slice(this.start, this.end); }
  }
  const highlights = new Map();
  const context = vm.createContext({
    document: {
      addEventListener() {},
      createTreeWalker: () => { let n = node; return { nextNode: () => { const x = n; n = null; return x; } }; }
    },
    NodeFilter: { SHOW_TEXT: 4 }, Range: TextRange, Highlight: Set, CSS: { highlights },
    $: () => null, t: (text) => text, tk: (text) => text, toast() {},
    window: { neo: { spellCheckWords: async (words) => (await send({ type: 'check', words })).result } }
  });
  const app = source('app.js');
  vm.runInContext(app.slice(app.indexOf('let spellOn = false;'), app.indexOf('let typewriterEnabled = false;')), context);
  context.el = el;
  await vm.runInContext('spellOn = true; spellScanEl(el, "ch-test")', context);
  assert.deepEqual([...highlights.get('neo-spell')].map((r) => r.toString()), ['knwon']);
});

test('a hyphenated word underlined whole opens the menu; a stammer is no misspelling', async () => {
  const send = spellWorker();
  assert.equal((await send({ type: 'load', language: 'pt-BR', dir: path.join(root, 'node_modules/dictionary-pt') })).ok, true);
  const node = { data: '— E-eu não sei. N-não. Ch-chega! Ela tinha auto-estima, sim.', nodeType: 3, isConnected: true };
  const editor = { node, id: '', dataset: {}, closest: (selector) => selector === '.chapter' ? { dataset: { id: 'ch-test' } } : editor };
  class TextRange {
    setStart(n, offset) { this.node = n; this.start = offset; }
    setEnd(_n, offset) { this.end = offset; }
    toString() { return this.node.data.slice(this.start, this.end); }
  }
  let contextmenu, menu, selected;
  const highlights = new Map();
  const context = vm.createContext({
    document: {
      addEventListener: (name, callback) => { if (name === 'contextmenu') contextmenu = callback; },
      createTreeWalker: () => { let n = node; return { nextNode: () => { const x = n; n = null; return x; } }; },
      querySelector: () => editor,
      createRange: () => new TextRange(),
      // right-click inside "auto", the first piece of the underlined word
      caretRangeFromPoint: () => ({ startContainer: node, startOffset: node.data.indexOf('auto') + 2 }),
      execCommand: (_cmd, _ui, text) => { node.data = node.data.slice(0, selected.start) + text + node.data.slice(selected.end); }
    },
    Node: { TEXT_NODE: 3 }, NodeFilter: { SHOW_TEXT: 4 }, Range: TextRange, Highlight: Set, CSS: { highlights },
    $: () => null, t: (text) => text, tk: (text) => text, toast() {},
    captureMenu: (_x, _y, word, suggestions, actions) => { menu = { word, suggestions, actions }; },
    window: {
      getSelection: () => ({ removeAllRanges() {}, addRange: (r) => { selected = r; } }),
      neo: {
        spellCheckWords: async (words) => (await send({ type: 'check', words })).result,
        spellSuggest: async (word) => (await send({ type: 'suggest', word })).result
      }
    }
  });
  const app = source('app.js');
  vm.runInContext(app.slice(app.indexOf('let spellOn = false;'), app.indexOf('let typewriterEnabled = false;')), context);
  context.el = editor;
  await vm.runInContext('spellOn = true; showSpellMenu = captureMenu; spellScanEl(el, "ch-test")', context);
  assert.deepEqual([...highlights.get('neo-spell')].map((r) => r.toString()), ['auto-estima']);
  await contextmenu({ target: editor, clientX: 0, clientY: 0, preventDefault() {} });
  assert.equal(menu && menu.word, 'auto-estima');
  assert.ok(menu.suggestions.includes('autoestima'));
  menu.actions.replace('autoestima');
  assert.equal(node.data, '— E-eu não sei. N-não. Ch-chega! Ela tinha autoestima, sim.');
});
