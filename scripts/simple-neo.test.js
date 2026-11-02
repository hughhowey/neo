'use strict';

// Simple NEO and File → Show More Features: the menu bar each way (main.js,
// loaded the way format-menu.test.js does), and how a library from before
// the switch is decided (SIMPLE NEO in app.js, with the disk stubbed out).

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

function menuBar(platform, more, { script = false } = {}) {
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
    listeners.get('more:state')(null, more);
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

// the items behind the switch, and some that simple NEO keeps
const MORE = ['Plain Text (.txt)', 'Markdown (.md)', 'Web Page (.html)', 'Manuscript Format…', 'Chapter Titles Only',
  'Cover Art…', 'New Books Open To', 'Import Chapters…', 'Reshelve a Book…', 'Spellcheck Language', 'Other Font…',
  'Align Paragraph', 'Show Pages', 'Two Pages Side by Side', 'Page Width', 'Non-Breaking Marks', 'Poetry Paragraph',
  'Markdown Emphasis', 'Focus Mode', 'Vim Keys', 'Interface Size', 'Language'];
const SIMPLE = ['PDF (.pdf)', 'Word (.docx)', 'EPUB (.epub)', 'Paperback for KDP…', 'Email Draft to Myself', 'Email Settings…',
  'Take Snapshot', 'Goals…', 'Import Manuscripts…', 'Library Folder…', 'Show More Features', 'Find & Replace', 'Spellcheck Pass',
  'Body Font', 'Drop Cap Style', 'Larger Text', 'Typewriter Scrolling', 'Flush Paragraph', 'Keyboard Shortcuts…',
  'Full Screen', 'Page', 'Paper', 'Light', 'Brighter Interface'];

describe('the menu bar, simple and with Show More Features', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    test(`simple NEO leaves out the items behind the switch (${platform})`, () => {
      const all = labels(menuBar(platform, false));
      for (const l of MORE) assert.ok(!all.includes(l), `${l} is hidden`);
      for (const l of SIMPLE) assert.ok(all.some((x) => x.replace(/&&/g, '&') === l), `${l} is there`);
      const sw = menu(menuBar(platform, false), 'File').find((i) => i.label === 'Show More Features');
      assert.equal(sw.type, 'checkbox');
      assert.equal(sw.checked, false);
    });

    test(`Show More Features brings every item back (${platform})`, () => {
      const template = menuBar(platform, true);
      const all = labels(template);
      for (const l of [...MORE, ...SIMPLE]) assert.ok(all.some((x) => x.replace(/&&/g, '&') === l), `${l} is there`);
      assert.equal(menu(template, 'File').find((i) => i.label === 'Show More Features').checked, true);
      assert.ok(!JSON.stringify(template).includes('"more"'), 'the marks never reach Electron');
    });
  }

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

// ---- deciding a library from before the switch ----
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const from = app.indexOf('function usesMoreFeatures(lib)');
const to = app.indexOf('async function setMoreFeatures(on)');
assert.ok(from > 0 && to > from, 'the SIMPLE NEO code is where the test expects it');

function room(library, { metas = {}, key = false, pocket = false } = {}) {
  const log = [];
  const ctx = vm.createContext({
    library,
    log,
    IS_POCKET: pocket,
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
    writeLibrary: async () => log.push('write ' + ctx.library.moreFeatures),
    moreOn: () => !pocket && !!(ctx.library && ctx.library.moreFeatures),
    window: { neo: { hasSecret: async () => key, moreState: (on) => log.push('menu ' + on) } }
  });
  vm.runInContext(app.slice(from, to), ctx);
  return ctx;
}
const shelf = (ids, extra = {}) => ({ id: 's1', name: 'Works in Progress', bookIds: ids, ...extra });

describe('a library from before Show More Features', () => {
  test('a new writer starts simple, and hears nothing about it', async () => {
    const ctx = room({ shelves: [shelf([])] });
    await ctx.decideMoreFeatures();
    assert.equal(ctx.library.moreFeatures, false);
    assert.deepEqual([...ctx.log], ['write false', 'menu false']);
  });

  test('a writer using none of it goes simple, and is told once where it went', async () => {
    const ctx = room({ firstRunDone: true, authors: [{ id: 'a1' }], shelves: [shelf(['b1', 'b2'])], typewriter: true, editorFontSize: 19 });
    await ctx.decideMoreFeatures();
    assert.equal(ctx.library.moreFeatures, false);
    assert.equal(ctx.log.filter((l) => l.startsWith('toast ')).length, 1);
    assert.ok(ctx.log[0].includes('Show More Features'));
  });

  for (const [what, lib, opts] of [
    ['a script on a shelf', {}, { metas: { b2: { id: 'b2', format: 'screenplay' } } }],
    ['a painted cover', {}, { metas: { b1: { id: 'b1', coverArt: { status: 'done', file: 'art-1.png' } } } }],
    ['a cover-art key', {}, { key: true }],
    ['a second pen name', { authors: [{ id: 'a1' }, { id: 'a2' }] }],
    ['a bound shelf', { shelves: [shelf(['b1'], { binding: { bound: true } })] }],
    ['vim keys', { vimKeys: true }],
    ['focus mode', { focus: 'sentence' }],
    ['the pages view', { pagedView: true }],
    ['a wider page', { pageWidth: 'wide' }],
    ['a larger interface', { uiZoom: 1.3 }],
    ['markdown emphasis turned off', { markdownOff: true }],
    ['spellcheck in another language', { spellLanguage: 'fr' }]
  ]) {
    test(`a writer with ${what} keeps every feature`, async () => {
      const ctx = room({ firstRunDone: true, shelves: [shelf(['b1', 'b2'])], ...lib }, opts || {});
      await ctx.decideMoreFeatures();
      assert.equal(ctx.library.moreFeatures, true);
      assert.ok(!ctx.log.some((l) => l.startsWith('toast ')), 'no notice: nothing went anywhere');
      assert.ok(ctx.log.includes('menu true'));
    });
  }

  test('a brighter interface is simple NEO\'s own choice, no sign of more', async () => {
    for (const lib of [{ uiBright: true }, { uiBright: false }, { uiBrightAside: false }]) {
      const ctx = room({ firstRunDone: true, shelves: [shelf([])], ...lib });
      await ctx.decideMoreFeatures();
      assert.equal(ctx.library.moreFeatures, false, JSON.stringify(lib));
    }
  });

  test('English spellcheck under an English interface is no sign of more', async () => {
    const ctx = room({ firstRunDone: true, shelves: [shelf([])], spellLanguage: 'en-GB', uiZoom: 1, pageWidth: 'regular', focus: 'off' });
    await ctx.decideMoreFeatures();
    assert.equal(ctx.library.moreFeatures, false);
  });

  test('a library already decided is left as the writer set it', async () => {
    const ctx = room({ firstRunDone: true, moreFeatures: false, vimKeys: true, shelves: [] });
    await ctx.decideMoreFeatures();
    assert.equal(ctx.library.moreFeatures, false);
    assert.deepEqual([...ctx.log], ['menu false']);
  });

  test('Pocket is always simple: it decides nothing and writes nothing', async () => {
    const ctx = room({ firstRunDone: true, shelves: [], vimKeys: true }, { pocket: true });
    await ctx.decideMoreFeatures();
    assert.equal(ctx.library.moreFeatures, undefined);
    assert.deepEqual([...ctx.log], ['menu false']);
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
    // simple NEO: nothing here may ask for the switch
    moreOn: () => { throw new Error('brightness asked for Show More Features'); }
  });
  vm.runInContext(app.slice(brightFrom, brightTo) + '\nthis.brightNow = brightNow;', ctx);
  return ctx.brightNow();
}

describe('Brighter Interface in simple NEO', () => {
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
