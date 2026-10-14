'use strict';

// The Format menu's paragraph kinds show their keys in the menu's own
// shortcut column (#372). A tab in the label lines them up on no platform:
// macOS printed it as text beside the name. The keys stay the editor's own,
// so the accelerators are shown, not registered, and a press of them that
// reaches the menu anyway (macOS) is left to the page. Loads main.js the way
// filesystem.test.js does, once per platform.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const localRequire = createRequire(path.join(root, 'main.js'));
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

function menuOn(platform, { script = false } = {}) {
  const listeners = new Map();
  let template = null;
  const sent = [];
  let builds = 0;
  const electron = {
    app: { commandLine: { appendSwitch() {} }, getPath: () => os.tmpdir(), getLocale: () => 'en', requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {} },
    ipcMain: { on: (name, fn) => listeners.set(name, fn), handle() {} },
    BrowserWindow: { getFocusedWindow: () => ({ webContents: { send: (_ch, msg) => sent.push(msg.type) } }), getAllWindows: () => [] },
    // a built menu with no items: macOS's Edit menu watch has nothing to hold
    Menu: { buildFromTemplate: (items) => ({ items: [], template: items }), setApplicationMenu: (menu) => { builds++; template = menu.template; } },
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
  const library = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-format-menu-'));
  context.library = library;
  vm.runInContext('LIBRARY_DIR = library; LIBRARY_FILE = require("path").join(library, "library.json");', context);
  try {
    if (script) listeners.get('script:state')(null, { on: true, book: true, element: 'action' });
    else vm.runInContext('buildMenu()', context);
  } finally {
    fs.rmSync(library, { recursive: true, force: true });
  }
  template.sent = sent;
  template.builds = () => builds;
  return template;
}

const format = (template) => template.find((m) => m.label === 'Format').submenu;
const item = (items, label) => items.find((i) => i.label === label);
function labels(items, out = []) {
  for (const i of items || []) {
    if (typeof i.label === 'string') out.push(i.label);
    labels(i.submenu, out);
  }
  return out;
}

describe('Format menu: the paragraph kinds show their keys as shortcuts', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    test(`Flush and Poetry Paragraph carry their keys, shown not registered (${platform})`, () => {
      const items = format(menuOn(platform));
      const flush = item(items, 'Flush Paragraph');
      const poetry = item(items, 'Poetry Paragraph');
      assert.ok(flush && poetry, 'both are named without the key in the label');
      assert.equal(flush.accelerator, 'Shift+Enter');
      assert.equal(poetry.accelerator, 'CmdOrCtrl+Shift+Enter');
      // the editor answers both keys itself; a registered one would take
      // them from the page on Windows and Linux
      assert.equal(flush.registerAccelerator, false);
      assert.equal(poetry.registerAccelerator, false);
    });

    test(`a script's elements carry ⌘1–⌘7 (Ctrl+1–7), shown not registered (${platform})`, () => {
      const items = format(menuOn(platform, { script: true }));
      const elements = ['Scene Heading', 'Action', 'Character', 'Parenthetical', 'Dialogue', 'Transition', 'Shot'];
      elements.forEach((label, i) => {
        const el = item(items, label);
        assert.ok(el, label);
        assert.equal(el.accelerator, 'CmdOrCtrl+' + (i + 1));
        assert.equal(el.registerAccelerator, false);
      });
      assert.equal(item(items, 'Action').checked, true);
    });

    test(`no menu label carries its shortcut as text (${platform})`, () => {
      for (const template of [menuOn(platform), menuOn(platform, { script: true })]) {
        for (const label of labels(template)) assert.ok(!label.includes('\t'), JSON.stringify(label));
      }
    });
  }

  // what Electron hands a click: a mouse click, Return in the open menu, or
  // the item's key equivalent (macOS), with the keys held
  const mouse = { triggeredByAccelerator: false };
  const menuReturn = { triggeredByAccelerator: true, shiftKey: false, metaKey: false, ctrlKey: false };
  const cmd = (platform) => platform === 'darwin' ? { metaKey: true } : { ctrlKey: true };

  for (const platform of ['darwin', 'win32', 'linux']) {
    test(`a click or Return in the menu runs the item; the item's own keys are the page's (${platform})`, () => {
      const template = menuOn(platform);
      const items = format(template);
      const flush = item(items, 'Flush Paragraph');
      const poetry = item(items, 'Poetry Paragraph');
      flush.click(flush, null, mouse);
      poetry.click(poetry, null, menuReturn);
      assert.deepEqual(template.sent, ['flush', 'poetry']);
      const before = template.builds();
      flush.click(flush, null, { triggeredByAccelerator: true, shiftKey: true });
      poetry.click(poetry, null, { triggeredByAccelerator: true, shiftKey: true, ...cmd(platform) });
      assert.deepEqual(template.sent, ['flush', 'poetry'], 'the page already answered ⇧Enter and ⌘⇧Enter');
      // the menu is drawn again, so a tick the press flipped is put back
      assert.equal(template.builds(), before + 2);
    });

    test(`a script element's own key is the page's too (${platform})`, () => {
      const template = menuOn(platform, { script: true });
      const dialogue = item(format(template), 'Dialogue');
      dialogue.click(dialogue, null, mouse);
      dialogue.click(dialogue, null, { triggeredByAccelerator: true, ...cmd(platform) });
      assert.deepEqual(template.sent, ['scriptElement']);
    });
  }
});
