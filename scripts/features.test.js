'use strict';

// NEO's features and Options: the menu bar with every feature off and on
// (main.js, loaded the way format-menu.test.js does), and how a library from
// before 2.0 is set up (FEATURES & OPTIONS in app/options.js, with the disk
// stubbed out).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');

// ---- the menu bar ----
const localRequire = createRequire(path.join(root, 'main.js'));
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

function menuBar(platform, more, { script = false, features = null } = {}) {
  const listeners = new Map();
  let template = null;
  const electron = {
    app: { commandLine: { appendSwitch() {} }, getPath: () => os.tmpdir(), getLocale: () => 'en', requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {} },
    ipcMain: { on: (name, fn) => listeners.set(name, fn), handle() {} },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    Menu: { buildFromTemplate: (items) => ({ items: [], template: items }), setApplicationMenu: (menu) => { template = menu.template; } },
    dialog: {},
    shell: {},
    utilityProcess: { fork: () => ({ on() {}, postMessage() {} }) },
    screen: {}
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: root,
    process: { platform, on() {} },
    console,
    Buffer,
    setImmediate: (fn) => fn()
  });
  vm.runInContext(source, context, { filename: path.join(root, 'main.js') });
  const library = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-simple-'));
  context.library = library;
  vm.runInContext('LIBRARY_DIR = library; LIBRARY_FILE = require("path").join(library, "library.json");', context);
  try {
    vm.runInContext('buildMenu()', context);
    listeners.get('features:state')(null, features || Object.fromEntries(KEYS.map((k) => [k, more])));
    if (script) listeners.get('script:state')(null, { on: true, book: true, element: 'action' });
  } finally {
    fs.rmSync(library, { recursive: true, force: true });
  }
  return template;
}
function labels(items, out = []) {
  for (const i of items || []) {
    if (typeof i.label === 'string') out.push(i.label);
    labels(i.submenu, out);
  }
  return out;
}
const menu = (template, name) => template.find((m) => m.label === name).submenu;

// the features (FEATURES in app/core.js) and the menu items each one shows
const app = require('./app-files').appSource();
const KEYS = [...app.matchAll(/^\s+\{ key: '(\w+)', label:/gm)].map((m) => m[1]);
const BEHIND = {
  exports: ['Plain Text (.txt)', 'Markdown (.md)', 'Web Page (.html)', 'Manuscript Format…', 'Import Chapters…'],
  covers: ['Cover Art…'],
  penNames: ['Reshelve a Book…'],
  formatting: ['Other Font…', 'Align Paragraph', 'Align Book Prose'],
  pages: ['Show Pages', 'Two Pages Side by Side', 'Page Width'],
  poetry: ['Poetry Paragraph'],
  focus: ['Focus Mode']
};
// settings that moved into Options: never in the menus again
const GONE = ['Show More Features', 'Chapter Titles Only', 'New Books Open To', 'Spellcheck Language', 'Non-Breaking Marks',
  'Markdown Emphasis', 'Vim Keys', 'Interface Size', 'Language', 'Press and hold for accents'];
const ALWAYS = ['PDF (.pdf)', 'Word (.docx)', 'EPUB (.epub)', 'Paperback for KDP…', 'Email Draft to Myself', 'Email Settings…',
  'Take Snapshot', 'Goals…', 'Import Manuscripts…', 'Library Folder…', 'Options…', 'Find & Replace', 'Spellcheck Pass',
  'Body Font', 'Drop Cap Style', 'Larger Text', 'Typewriter Scrolling', 'Flush Paragraph', 'Keyboard Shortcuts…',
  'Full Screen', 'Page', 'Paper', 'Light', 'Brighter Interface'];
const has = (all, l) => all.some((x) => x.replace(/&&/g, '&') === l);

describe('the menu bar follows the features', () => {
  test('the features are the ones the menus know', () => {
    assert.ok(KEYS.length >= 10, KEYS.join(' '));
    for (const k of Object.keys(BEHIND)) assert.ok(KEYS.includes(k), k);
  });
  for (const platform of ['darwin', 'win32', 'linux']) {
    test(`every feature off: their items are hidden, the rest stay (${platform})`, () => {
      const all = labels(menuBar(platform, false));
      for (const l of Object.values(BEHIND).flat()) assert.ok(!has(all, l), `${l} is hidden`);
      for (const l of ALWAYS) assert.ok(has(all, l), `${l} is there`);
      for (const l of GONE) assert.ok(!has(all, l), `${l} lives in Options now`);
    });

    test(`every feature on: every item is there, and the marks never reach Electron (${platform})`, () => {
      const template = menuBar(platform, true);
      const all = labels(template);
      for (const l of [...Object.values(BEHIND).flat(), ...ALWAYS]) assert.ok(has(all, l), `${l} is there`);
      for (const l of GONE) assert.ok(!has(all, l), `${l} lives in Options now`);
      assert.ok(!JSON.stringify(template).includes('"feature"'));
    });

    test(`one feature on shows just its own items (${platform})`, () => {
      for (const [key, items] of Object.entries(BEHIND)) {
        const all = labels(menuBar(platform, false, { features: { [key]: true } }));
        for (const l of items) assert.ok(has(all, l), `${key}: ${l}`);
        for (const [other, rest] of Object.entries(BEHIND)) if (other !== key) for (const l of rest) assert.ok(!has(all, l), `${key} shows ${l}`);
      }
    });
  }

  test('Options… sits in the NEO menu on a Mac, in File elsewhere', () => {
    const mac = menuBar('darwin', false);
    assert.ok(mac[0].submenu.some((i) => i.label === 'Options…'));
    assert.ok(!menu(mac, 'File').some((i) => i.label === 'Options…'));
    assert.ok(menu(menuBar('win32', false), 'File').some((i) => i.label === 'Options…'));
  });

  test('no menu starts or ends with a separator, or has two together', () => {
    for (const more of [false, true]) {
      for (const script of [false, true]) {
        const check = (items, where) => {
          const shown = items.filter((i) => i.visible !== false);
          shown.forEach((i, n) => {
            if (i.type !== 'separator') return;
            assert.ok(n > 0 && n < shown.length - 1, `${where}: a separator at an end`);
            assert.notEqual(shown[n - 1].type, 'separator', `${where}: two separators`);
          });
          for (const i of items) if (Array.isArray(i.submenu)) check(i.submenu, where + ' › ' + i.label);
        };
        for (const top of menuBar('darwin', more, { script })) if (Array.isArray(top.submenu)) check(top.submenu, top.label || top.role);
      }
    }
  });

  test('a script open in simple NEO keeps its own export and elements', () => {
    const template = menuBar('darwin', false, { script: true });
    const exp = Array.from(menu(template, 'File').find((i) => i.label === 'Export').submenu, (i) => i.label);
    assert.deepEqual(exp, ['PDF (.pdf)', 'Fountain (.fountain)', 'Final Draft (.fdx)']);
    assert.ok(labels(menu(template, 'Format')).includes('Scene Heading'));
  });
});

// ---- setting up a library from before 2.0 ----
const from = app.indexOf('async function setupFeatures()');
const to = app.indexOf('async function setFeature(key, on)');
assert.ok(from > 0 && to > from, 'the FEATURES & OPTIONS code is where the test expects it');
const featuresSrc = app.slice(app.indexOf('const FEATURES = ['), app.indexOf('// *italic* and **bold** typed as Markdown'));

function room(library, { metas = {}, key = false, pocket = false } = {}) {
  const log = [];
  const ctx = vm.createContext({
    library,
    log,
    IS_POCKET: pocket,
    tk: (s) => s,
    t: (s) => s,
    toast: (msg) => log.push('toast ' + msg),
    setTimeout: (fn) => fn(),
    isBound: (s) => !!(s && s.binding && s.binding.bound),
    snapZoom: (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : 1),
    NeoI18n: { getLocale: () => 'en' },
    shelfMeta: async (id) => metas[id] || { id },
    isScript: (m) => !!m && m.format === 'screenplay',
    hasPainting: (m) => !!(m.coverArt && m.coverArt.status === 'done' && m.coverArt.file),
    coverProvider: () => 'openai',
    writeLibrary: async () => log.push('write'),
    window: { neo: { hasSecret: async () => key, featuresState: (on) => log.push('menu ' + Object.values(on).filter(Boolean).length) } }
  });
  vm.runInContext(featuresSrc + app.slice(from, to), ctx);
  return ctx;
}
const shelf = (ids, extra = {}) => ({ id: 's1', name: 'Works in Progress', bookIds: ids, ...extra });

const allOn = (lib) => Object.values(lib.features).every(Boolean);
const allOff = (lib) => Object.values(lib.features).every((v) => !v);

describe('a library from before 2.0', () => {
  test('a new writer starts with every feature off', async () => {
    const ctx = room({ shelves: [shelf([])] });
    await ctx.setupFeatures();
    assert.ok(allOff(ctx.library));
    assert.equal(ctx.library.markdownOff, true, 'Markdown typing starts off, as simple NEO had it');
    assert.equal(ctx.library.moreFeatures, undefined);
  });

  test('Show More Features on: every feature on, settings kept, vim only if chosen', async () => {
    const ctx = room({ firstRunDone: true, moreFeatures: true, nbspMarks: true, uiZoom: 1.3, shelves: [] });
    await ctx.setupFeatures();
    const { vim, ...rest } = ctx.library.features;
    assert.equal(vim, false);
    assert.ok(Object.values(rest).every(Boolean));
    assert.equal(ctx.library.nbspMarks, true);
    assert.equal(ctx.library.uiZoom, 1.3);
    assert.equal(ctx.library.markdownOff, undefined, 'Markdown typing stays on for them');
    const withVim = room({ firstRunDone: true, moreFeatures: true, vimKeys: true, shelves: [] });
    await withVim.setupFeatures();
    assert.ok(allOn(withVim.library));
  });

  test('Show More Features off: nothing on, and what simple NEO showed is what they keep', async () => {
    const ctx = room({ firstRunDone: true, moreFeatures: false, vimKeys: true, nbspMarks: true, uiZoom: 1.3, shelves: [] });
    await ctx.setupFeatures();
    assert.ok(allOff(ctx.library));
    assert.equal(ctx.library.markdownOff, true);
    assert.equal(ctx.library.nbspMarks, false);
    assert.equal(ctx.library.uiZoom, 1);
  });

  for (const [what, lib, opts] of [
    ['a script on a shelf', {}, { metas: { b2: { id: 'b2', format: 'screenplay' } } }],
    ['a painted cover', {}, { metas: { b1: { id: 'b1', coverArt: { status: 'done', file: 'art-1.png' } } } }],
    ['a cover-art key', {}, { key: true }],
    ['a second pen name', { authors: [{ id: 'a1' }, { id: 'a2' }] }],
    ['a bound shelf', { shelves: [shelf(['b1'], { binding: { bound: true } })] }],
    ['focus mode', { focus: 'sentence' }],
    ['the pages view', { pagedView: true }],
    ['spellcheck in another language', { spellLanguage: 'fr' }]
  ]) {
    test(`a library from before Show More Features, with ${what}, gets every feature`, async () => {
      const ctx = room({ firstRunDone: true, shelves: [shelf(['b1', 'b2'])], ...lib }, opts || {});
      await ctx.setupFeatures();
      assert.ok(Object.entries(ctx.library.features).every(([k, v]) => k === 'vim' || v));
    });
  }

  test('one using none of it starts with them off', async () => {
    const ctx = room({ firstRunDone: true, shelves: [shelf([])], uiBright: true, spellLanguage: 'en-GB' });
    await ctx.setupFeatures();
    assert.ok(allOff(ctx.library));
  });

  test('a library already set up is left as the writer set it', async () => {
    const ctx = room({ firstRunDone: true, features: { cards: true }, shelves: [] });
    await ctx.setupFeatures();
    assert.deepEqual({ ...ctx.library.features }, { cards: true });
    assert.ok(!ctx.log.includes('write'));
  });

  test('Pocket follows only the features it can show', () => {
    const ctx = room({ features: Object.fromEntries(KEYS.map((k) => [k, true])) }, { pocket: true });
    vm.runInContext('this.featureOn = featureOn; this.FEATURES = FEATURES;', ctx);
    for (const f of ctx.FEATURES) assert.equal(ctx.featureOn(f.key), !!f.pocket, f.key);
  });
});
// ---- Brighter Interface: the writer's choice holds in simple NEO too ----
const brightFrom = app.indexOf('const brightAside = ');
const brightTo = app.indexOf('function applyBright()');
assert.ok(brightFrom > 0 && brightTo > brightFrom, 'the brightness code is where the test expects it');

function brightness(library, { writing = true, system = false } = {}) {
  const ctx = vm.createContext({
    library,
    book: {},
    currentTab: writing ? 'manuscript' : 'outline',
    $: () => ({ hidden: false }),
    SYSTEM_CONTRAST: { matches: system },
    // brightness is the writer's eyes: no feature decides it
    featureOn: () => { throw new Error('brightness asked about a feature'); }
  });
  vm.runInContext(app.slice(brightFrom, brightTo) + '\nthis.brightNow = brightNow;', ctx);
  return ctx.brightNow();
}

describe('Brighter Interface, whatever the features', () => {
  test('what the writer chose while writing is kept', () => {
    assert.equal(brightness({ moreFeatures: false, uiBright: true }), true);
    assert.equal(brightness({ moreFeatures: false, uiBright: false }, { system: true }), false);
  });

  test('left alone it follows the system while writing, and is bright on the other tabs', () => {
    assert.equal(brightness({ moreFeatures: false }), false);
    assert.equal(brightness({ moreFeatures: false }, { system: true }), true);
    assert.equal(brightness({ moreFeatures: false }, { writing: false }), true);
  });

  test('the other tabs have their own choice', () => {
    assert.equal(brightness({ moreFeatures: false, uiBrightAside: false, uiBright: true }, { writing: false }), false);
    assert.equal(brightness({ moreFeatures: false, uiBrightAside: false, uiBright: true }), true);
  });
});
