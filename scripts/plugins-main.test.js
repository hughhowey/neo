'use strict';

// plugins-main.js finds plugin folders (each with a plugin.json), lists them
// for the window and starts each one's main half. It takes Electron's app
// and ipcMain from wire(), so these tests hand it stand-ins and, where a
// case needs folders of its own, a temporary app folder. Some tests load
// main.js the way filesystem.test.js does, to see the window's list and the
// main halves wired up.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { after, afterEach, describe, test } = require('node:test');

const plugins = require('../plugins-main.js');

const root = path.join(__dirname, '..');
const fixtures = 'scripts/fixtures/plugins';
const envDirs = process.env.NEO_PLUGIN_DIRS;
const made = [];

afterEach(() => {
  if (envDirs === undefined) delete process.env.NEO_PLUGIN_DIRS;
  else process.env.NEO_PLUGIN_DIRS = envDirs;
  while (made.length) fs.rmSync(made.pop(), { recursive: true, force: true });
});

// The checkout's own plugins/ holds whatever has been installed there. A
// test that discovers it activates that, and then passes or fails on what
// happens to be in it. Every read of that folder is noted, and the file
// fails if there was one: tests use a temporary app folder.
const ownPlugins = path.join(root, 'plugins');
const ownReads = [];
const readdirSync = fs.readdirSync;
fs.readdirSync = function (dir, ...rest) {
  const rel = path.relative(ownPlugins, path.resolve(String(dir)));
  if (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)) ownReads.push(String(dir));
  return readdirSync.call(this, dir, ...rest);
};
after(() => {
  fs.readdirSync = readdirSync;
  assert.deepEqual(ownReads, [], 'a test discovered the worktree\'s own plugins/ folder');
});

// wires the module to stand-ins; dirs becomes NEO_PLUGIN_DIRS. Electron's
// folders sit in the app folder (by default a temporary one that holds the
// fixture plugins)
function wire({
  appRoot = fixtureApp(), isPackaged = false, dirs,
  app = { isPackaged, getPath: (name) => path.join(appRoot, name) },
  activateMs,
  // plugins-main.js starts each main half a turn after activateMains; the
  // tests start theirs at once unless a test passes null for its own way
  defer = (run) => run()
} = {}) {
  if (dirs === undefined) delete process.env.NEO_PLUGIN_DIRS;
  else process.env.NEO_PLUGIN_DIRS = dirs;
  const logs = [];
  const handlers = new Map();
  plugins.wire({
    app,
    ipcMain: { on: (channel, fn) => handlers.set(channel, fn), handle: (channel, fn) => handlers.set(channel, fn) },
    logError: (source, err) => logs.push(`[${source}] ${err && err.stack ? err.stack : String(err)}`),
    appRoot,
    defer,
    ...(activateMs === undefined ? {} : { activateMs })
  });
  return { logs, handlers, appRoot };
}

function tempFolder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-plugins-'));
  made.push(dir);
  return dir;
}

function addPlugin(dir, rel, manifest) {
  fs.mkdirSync(path.join(dir, rel), { recursive: true });
  fs.writeFileSync(path.join(dir, rel, 'plugin.json'), JSON.stringify(manifest));
}

// a temporary app folder with a plugin.json in each named folder
function appFolder(manifests) {
  const dir = tempFolder();
  for (const [rel, manifest] of Object.entries(manifests)) addPlugin(dir, rel, manifest);
  return dir;
}

// an app folder (a new temporary one, unless given) holding a copy of the
// fixture plugins, where the worktree's own plugins/ cannot be found;
// locales/ is there, empty, for main.js, which reads it from its own folder
function fixtureApp(dir = tempFolder()) {
  fs.cpSync(path.join(root, fixtures), path.join(dir, fixtures), { recursive: true });
  fs.mkdirSync(path.join(dir, 'locales'));
  return dir;
}

const plugin = (id, extra) => ({ id, apiVersion: 1, renderer: 'renderer.js', ...extra });
const ids = () => plugins.discover().map((m) => m.id);
const find = (id) => plugins.discover().find((m) => m.id === id);

describe('plugin discovery', { concurrency: 1 }, () => {
  test('the ping plugin is listed with its renderer URL relative to the app folder, on every platform', () => {
    const { appRoot } = wire({ dirs: fixtures });
    const ping = find('ping');
    assert.ok(ping, 'ping is listed');
    assert.equal(ping.rendererUrl, 'scripts/fixtures/plugins/ping/renderer.js');
    assert.equal(ping.mainPath, path.join(appRoot, fixtures, 'ping', 'main.js'));
  });

  test('a main entry gets an absolute path, and a plugin without one none', () => {
    const app = appFolder({ 'plugins/full': plugin('full', { main: 'main.cjs' }), 'plugins/window-only': plugin('window-only') });
    wire({ appRoot: app });
    assert.equal(find('full').rendererUrl, 'plugins/full/renderer.js');
    assert.equal(find('full').mainPath, path.join(app, 'plugins', 'full', 'main.cjs'));
    assert.ok(path.isAbsolute(find('full').mainPath));
    assert.equal(find('window-only').mainPath, null);
  });

  test('a manifest that fails the checks, or repeats an id, is skipped and logged with its folder', () => {
    const app = appFolder({
      'plugins/a-good': plugin('good'),
      'plugins/bad-id': plugin('Bad'),
      'plugins/traversal': plugin('traversal', { renderer: '../x.js' }),
      'plugins/api-zero': plugin('api-zero', { apiVersion: 0 }),
      'plugins/no-renderer': { id: 'no-renderer', apiVersion: 1 },
      'plugins/unknown-key': plugin('unknown-key', { style: 'style.css' }),
      'plugins/twin-1': plugin('twin'),
      'plugins/twin-2': plugin('twin')
    });
    const { logs } = wire({ appRoot: app });
    assert.deepEqual(ids(), ['good', 'twin']);
    assert.equal(find('twin').rendererUrl, 'plugins/twin-1/renderer.js'); // the first one stays
    for (const name of ['bad-id', 'traversal', 'api-zero', 'no-renderer', 'unknown-key', 'twin-2']) {
      const folder = path.join(app, 'plugins', name);
      assert.ok(logs.some((line) => line.includes(folder)), `${name} is logged`);
    }
  });

  // a newer API may well add to the manifest too, so the rest of such a
  // manifest is not judged
  test('a manifest for a newer plugin API than this NEO knows is refused with a reason that names both versions', () => {
    const app = appFolder({
      'plugins/ahead': plugin('ahead', { apiVersion: 2 }),
      'plugins/far-ahead': plugin('far-ahead', { apiVersion: 12, newKey: true }),
      'plugins/zero': plugin('zero', { apiVersion: 0 }),
      'plugins/fraction': plugin('fraction', { apiVersion: 0.5 }),
      'plugins/text': plugin('text', { apiVersion: '1' }),
      'plugins/current': plugin('current', { apiVersion: 1 })
    });
    const { logs } = wire({ appRoot: app });
    assert.deepEqual(ids(), ['current']);
    assert.equal(logs.length, 5, logs.join('\n'));
    const line = (name) => logs.find((l) => l.includes(path.join(app, 'plugins', name))) || `nothing logged for ${name}`;
    assert.match(line('ahead'), /needs plugin API 2\b.*\bthis NEO knows up to 1\b/);
    assert.match(line('far-ahead'), /needs plugin API 12\b.*\bthis NEO knows up to 1\b/);
    for (const name of ['zero', 'fraction', 'text']) assert.match(line(name), /does not match the manifest format/, name);
  });

  test('a root on another drive is refused and logged', { skip: process.platform !== 'win32' && 'drive letters are Windows only' }, () => {
    const app = appFolder({});
    const other = (/^z/i.test(app) ? 'Y:' : 'Z:') + '\\plugins';
    const { logs } = wire({ appRoot: app, dirs: other });
    assert.deepEqual(ids(), []);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /outside the app folder/);
    assert.ok(logs[0].includes(other));
  });

  test('a root outside the app folder is refused and logged', () => {
    const app = appFolder({});
    const elsewhere = path.join(tempFolder(), 'elsewhere');
    addPlugin(elsewhere, 'out', plugin('out'));
    for (const dirs of [elsewhere, path.relative(app, elsewhere), '..']) {
      const { logs } = wire({ appRoot: app, dirs });
      assert.deepEqual(ids(), [], dirs);
      assert.equal(logs.length, 1, dirs);
      assert.ok(logs[0].includes(path.resolve(app, dirs)), dirs);
    }
  });

  test('a root folder named ..x inside the app folder is accepted', () => {
    const app = appFolder({ '..x/inside': plugin('inside') });
    const { logs } = wire({ appRoot: app, dirs: '..x' });
    assert.deepEqual(ids(), ['inside']);
    assert.equal(find('inside').rendererUrl, '..x/inside/renderer.js');
    assert.deepEqual(logs, []);
  });

  test('the app folder is matched regardless of case on Windows', { skip: process.platform !== 'win32' && 'Windows paths only' }, () => {
    const app = fixtureApp();
    const shouted = app.toUpperCase() === app ? app.toLowerCase() : app.toUpperCase();
    wire({ appRoot: app, dirs: path.join(shouted, fixtures) });
    assert.equal(find('ping').rendererUrl, 'scripts/fixtures/plugins/ping/renderer.js');
  });

  test('NEO_PLUGIN_DIRS is ignored in a packaged app', () => {
    wire({ isPackaged: true, dirs: fixtures });
    assert.equal(find('ping'), undefined);
  });

  test('an app with no plugins/ folder lists none and logs nothing', () => {
    const { logs } = wire({ appRoot: tempFolder() });
    assert.deepEqual(ids(), []);
    assert.deepEqual(logs, []);
  });

  test('discover reads the folders once', () => {
    const app = appFolder({ 'plugins/first': plugin('first') });
    const { handlers } = wire({ appRoot: app });
    const list = plugins.discover();
    addPlugin(app, 'plugins/second', plugin('second'));
    assert.equal(plugins.discover(), list);
    assert.deepEqual(list.map((m) => m.id), ['first']);
    const event = {};
    handlers.get('plugins:list')(event);
    assert.deepEqual(event.returnValue, list.map(({ mainPath, ...listed }) => listed));
  });

  test('the window gets each plugin without its main path, which discover keeps', () => {
    const app = appFolder({ 'plugins/full': plugin('full', { main: 'main.cjs' }) });
    const { handlers } = wire({ appRoot: app });
    const event = {};
    handlers.get('plugins:list')(event);
    assert.deepEqual(event.returnValue.map((m) => m.id), ['full']);
    assert.equal(event.returnValue[0].rendererUrl, 'plugins/full/renderer.js');
    assert.ok(!('mainPath' in event.returnValue[0]), 'the window never sees a path on disk');
    assert.equal(find('full').mainPath, path.join(app, 'plugins', 'full', 'main.cjs'));
  });

  test('plugins:list answers [] and logs the stack when discovery throws', () => {
    // the window waits on this answer (sendSync), so a throw must not escape
    const app = { get isPackaged() { throw new Error('discovery broke'); } };
    const { logs, handlers } = wire({ appRoot: appFolder({}), app });
    const event = {};
    handlers.get('plugins:list')(event);
    assert.deepEqual(event.returnValue, []);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /discovery broke\n\s+at /);
  });

  test('a folder whose name cannot go in a URL is skipped and logged with its folder', (t) => {
    // a lone surrogate makes encodeURIComponent throw; a real disk hands Node
    // such a name only rarely, so the folder listing is stood in for
    const app = appFolder({ 'plugins/good': plugin('good') });
    const bundled = path.join(app, 'plugins');
    const odd = path.join(bundled, 'odd\uD800');
    const { readdirSync, readFileSync } = fs;
    t.mock.method(fs, 'readdirSync', (dir, options) => dir === bundled
      ? [...readdirSync(dir, options), { name: path.basename(odd), isDirectory: () => true, isSymbolicLink: () => false }]
      : readdirSync(dir, options));
    t.mock.method(fs, 'readFileSync', (file, ...rest) => file === path.join(odd, 'plugin.json')
      ? JSON.stringify(plugin('odd'))
      : readFileSync(file, ...rest));
    const { logs } = wire({ appRoot: app });
    assert.deepEqual(ids(), ['good']);
    assert.ok(logs.some((line) => line.includes(odd) && line.includes('URIError')), 'the odd folder is logged');
  });

  test('a plugin folder that is a link is skipped and logged with its folder', (t) => {
    // a link can lead outside the app folder, where 'self' no longer holds
    const app = appFolder({ 'plugins/real': plugin('real') });
    const target = path.join(tempFolder(), 'linked');
    addPlugin(target, '.', plugin('linked'));
    const link = path.join(app, 'plugins', 'linked');
    try {
      fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (err) {
      t.skip(`this system refused the link: ${err.code}`);
      return;
    }
    const { logs } = wire({ appRoot: app });
    assert.deepEqual(ids(), ['real']);
    assert.ok(logs.some((line) => line.includes(link)), 'the link is logged');
  });

  // readdir, readFile and require all follow a link, wherever in a path it
  // sits, so what is checked is where each path really leads
  describe('a link further up or down than a plugin folder', () => {
    const dirLink = process.platform === 'win32' ? 'junction' : 'dir';
    function link(t, target, at, type = dirLink) {
      try {
        fs.symlinkSync(target, at, type);
        return true;
      } catch (err) {
        t.skip(`this system refused the link: ${err.code}`);
        return false;
      }
    }
    const real = (p) => fs.realpathSync.native(p);

    test('a plugin root that is a link leading outside the app folder is refused and logged', (t) => {
      const app = appFolder({});
      const elsewhere = tempFolder();
      addPlugin(elsewhere, 'out', plugin('out'));
      if (!link(t, elsewhere, path.join(app, 'dev'))) return;
      const { logs } = wire({ appRoot: app, dirs: 'dev' });
      assert.deepEqual(ids(), []);
      assert.equal(logs.length, 1, logs.join('\n'));
      assert.match(logs[0], /outside the app folder/);
      assert.ok(logs[0].includes(path.join(app, 'dev')), 'the root is named');
      assert.ok(logs[0].includes(real(elsewhere)), 'and where it leads');
    });

    test('plugins/ itself a link leading outside the app folder is refused and logged', (t) => {
      const app = appFolder({});
      const elsewhere = tempFolder();
      addPlugin(elsewhere, 'out', plugin('out'));
      if (!link(t, elsewhere, path.join(app, 'plugins'))) return;
      const { logs } = wire({ appRoot: app });
      assert.deepEqual(ids(), []);
      assert.equal(logs.length, 1, logs.join('\n'));
      assert.match(logs[0], /outside the app folder/);
      assert.ok(logs[0].includes(path.join(app, 'plugins')));
    });

    // the page loads a plugin's script by URL, and Chromium's answer to a
    // link in the way differs by platform, so the rule is NEO's
    test('a renderer that is a link leading outside the app folder refuses its plugin, and is logged', (t) => {
      const app = appFolder({ 'plugins/a-script': plugin('script'), 'plugins/b-fine': plugin('fine') });
      const elsewhere = tempFolder();
      fs.writeFileSync(path.join(elsewhere, 'outside.js'), '');
      fs.writeFileSync(path.join(app, 'plugins', 'b-fine', 'renderer.js'), '');
      if (!link(t, path.join(elsewhere, 'outside.js'), path.join(app, 'plugins', 'a-script', 'renderer.js'), 'file')) return;
      const { logs } = wire({ appRoot: app });
      assert.deepEqual(ids(), ['fine']);
      assert.equal(logs.length, 1, logs.join('\n'));
      assert.ok(logs[0].includes(path.join(app, 'plugins', 'a-script')));
      assert.match(logs[0], /its renderer leads outside the app folder/);
    });

    test('a renderer that is not there leads nowhere: the plugin is listed, and the window logs the script that will not load', () => {
      const app = appFolder({ 'plugins/bare': plugin('bare') });
      const { logs } = wire({ appRoot: app });
      assert.deepEqual(ids(), ['bare']);
      assert.deepEqual(logs, []);
    });

    test('a plugin folder that resolves outside the app folder, by whatever means, is refused and logged', (t) => {
      const app = appFolder({ 'plugins/odd': plugin('odd'), 'plugins/fine': plugin('fine') });
      const folder = path.join(app, 'plugins', 'odd');
      const elsewhere = tempFolder();
      const { native } = fs.realpathSync;
      t.mock.method(fs.realpathSync, 'native', (p, ...rest) => p === folder ? elsewhere : native(p, ...rest));
      const { logs } = wire({ appRoot: app });
      assert.deepEqual(ids(), ['fine']);
      assert.equal(logs.length, 1, logs.join('\n'));
      assert.match(logs[0], /outside the app folder/);
      assert.ok(logs[0].includes(folder));
    });

    test('an app folder reached through a link is no reason to refuse its plugins', (t) => {
      const app = appFolder({ 'plugins/full': plugin('full', { main: 'main.cjs' }) });
      fs.writeFileSync(path.join(app, 'plugins', 'full', 'main.cjs'), 'exports.activate = () => {};');
      const through = path.join(tempFolder(), 'app');
      if (!link(t, app, through)) return;
      const { logs } = wire({ appRoot: through });
      assert.deepEqual(ids(), ['full']);
      assert.deepEqual(logs, []);
    });
  });
});

// main.js in a vm, as filesystem.test.js loads it, on the profile folder
// and app folder given. ready() runs what main.js does once Electron is
// ready, with the window, the menu, the spellchecker, the backup and the
// updater stood in for; ask() is a window's sendSync to a listener main.js
// registered with ipcMain.on. Loading main.js wires plugins-main.js anew,
// so only the last one loaded works.
function loadMain(profile, appDir) {
  const handlers = new Map();
  const listeners = new Map();
  const dialogs = [];
  let whenReady = null;
  const electron = {
    app: {
      isPackaged: false,
      commandLine: { appendSwitch() {} },
      getPath: (name) => path.join(profile, name),
      getLocale: () => 'en',
      requestSingleInstanceLock: () => true,
      whenReady: () => ({ then: (fn) => { whenReady = fn; } }),
      on() {}
    },
    ipcMain: { on: (channel, fn) => listeners.set(channel, fn), handle: (channel, fn) => handlers.set(channel, fn) },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
    dialog: { showMessageBox: async (...args) => { dialogs.push(args); return {}; } },
    utilityProcess: { fork: () => ({ on() {}, postMessage() {} }) },
    screen: {}
  };
  const localRequire = createRequire(path.join(root, 'main.js'));
  const libraryRoot = path.join(profile, 'documents', 'NEO Library');
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: appDir,
    process: { platform: process.platform, on() {} },
    console,
    setInterval: () => ({}),
    // startup schedules the iCloud fetch; nothing here waits for it
    setTimeout: () => ({ unref() {} }),
    libraryRoot
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: path.join(root, 'main.js') });
  // nothing is logged into the real Documents folder before ready() moves the library
  vm.runInContext('LIBRARY_DIR = libraryRoot; LIBRARY_FILE = require("path").join(libraryRoot, "library.json");', context);
  return {
    dialogs,
    call: (channel, ...args) => handlers.get(channel)(null, ...args),
    ask(channel) {
      const event = {};
      listeners.get(channel)(event);
      return event.returnValue;
    },
    ready(order) {
      for (const name of ['createWindow', 'announceLibraryFallback', 'initSpell', 'buildMenu', 'dailyBackup', 'checkForUpdates']) {
        context[name] = () => { order.push(name); };
      }
      whenReady();
    }
  };
}

describe('main.js and the plugin list', { concurrency: 1 }, () => {
  test('main.js answers plugins:list with the plugins it found', () => {
    process.env.NEO_PLUGIN_DIRS = fixtures;
    const profile = tempFolder();
    const main = loadMain(profile, fixtureApp());
    const listed = main.ask('plugins:list');
    assert.ok(listed.some((m) => m.id === 'ping'), 'the window hears of the ping plugin');
    assert.ok(listed.every((m) => !('mainPath' in m)));
  });
});
