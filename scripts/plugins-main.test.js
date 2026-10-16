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
const { after, afterEach, before, describe, test } = require('node:test');

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

// preload.js in a vm, with ipcRenderer.invoke answered by call(channel,
// ...args): window.neo as the page gets it. A main half's answer crosses
// IPC here as it does in Electron, so a test sees what a plugin would.
function windowNeo(call) {
  let neo = null;
  const electron = {
    contextBridge: { exposeInMainWorld: (_name, api) => { neo = api; } },
    ipcRenderer: { sendSync: () => [], invoke: async (...args) => call(...args), send() {}, on() {} },
    webUtils: {}
  };
  const context = vm.createContext({ require: () => electron, process: { platform: process.platform } });
  vm.runInContext(fs.readFileSync(path.join(root, 'preload.js'), 'utf8'), context, { filename: 'preload.js' });
  return neo;
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

    // require follows what it is given: through a link, to a main.js.js beside
    // a missing main.js, into a folder named main.js by its package.json.
    // start() checks the file require will load, and requires that path.
    const ran = 'neoOutsideMainRan';
    afterEach(() => { delete globalThis[ran]; });
    function outsideMain() {
      const file = path.join(tempFolder(), 'outside.cjs');
      fs.writeFileSync(file, `globalThis.${ran} = true; exports.activate = () => {};`);
      return file;
    }

    test('a main entry that is a link leading outside the app folder is never required: its main half fails and is logged, and the next still starts', async (t) => {
      const app = appFolder({ 'plugins/a-sly': plugin('sly', { main: 'main.cjs' }), 'plugins/b-good': plugin('good', { main: 'main.cjs' }) });
      fs.writeFileSync(path.join(app, 'plugins', 'b-good', 'main.cjs'), 'exports.activate = (host) => host.handle("echo", (p) => p);');
      if (!link(t, outsideMain(), path.join(app, 'plugins', 'a-sly', 'main.cjs'), 'file')) return;
      const { logs } = wire({ appRoot: app });
      assert.deepEqual(ids(), ['sly', 'good']);
      plugins.activateMains();
      assert.equal(globalThis[ran], undefined, 'the file outside was not run');
      assert.equal(logs.length, 1, logs.join('\n'));
      assert.match(logs[0], /^\[plugin sly: activate\] .*main entry.*outside the app folder/);
    });

    test('a main.js.js link to a file outside is not what a missing main.js becomes', (t) => {
      const app = appFolder({ 'plugins/odd': plugin('odd', { main: 'main.js' }) });
      if (!link(t, outsideMain(), path.join(app, 'plugins', 'odd', 'main.js.js'), 'file')) return;
      const { logs } = wire({ appRoot: app });
      plugins.activateMains();
      assert.equal(globalThis[ran], undefined, 'the file outside was not run');
      assert.equal(logs.length, 1, logs.join('\n'));
      assert.match(logs[0], /^\[plugin odd: activate\] .*ENOENT/);
    });

    test('a main entry that is a folder is never required, whatever its package.json names', () => {
      const app = appFolder({ 'plugins/pkg': plugin('pkg', { main: 'main.js' }) });
      const folder = path.join(app, 'plugins', 'pkg', 'main.js');
      fs.mkdirSync(folder);
      fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ main: outsideMain() }));
      const { logs } = wire({ appRoot: app });
      plugins.activateMains();
      assert.equal(globalThis[ran], undefined, 'the file outside was not run');
      assert.equal(logs.length, 1, logs.join('\n'));
      assert.match(logs[0], /^\[plugin pkg: activate\] .*main entry is not a file/);
    });

    test('a main entry that is not there leads nowhere: its plugin is listed, and activate logs the absence', () => {
      const app = appFolder({ 'plugins/hollow': plugin('hollow', { main: 'main.cjs' }) });
      const { logs } = wire({ appRoot: app });
      assert.deepEqual(ids(), ['hollow']);
      assert.deepEqual(logs, []);
      plugins.activateMains();
      assert.equal(logs.length, 1, logs.join('\n'));
      assert.match(logs[0], /^\[plugin hollow: activate\] /);
    });

    test('a main entry that is a link to nothing is not followed: activate logs it, and no file outside is required', (t) => {
      const app = appFolder({ 'plugins/dangling': plugin('dangling', { main: 'main.cjs' }) });
      if (!link(t, path.join(tempFolder(), 'gone.cjs'), path.join(app, 'plugins', 'dangling', 'main.cjs'), 'file')) return;
      const { logs } = wire({ appRoot: app });
      assert.deepEqual(ids(), ['dangling']);
      plugins.activateMains();
      assert.equal(logs.length, 1, logs.join('\n'));
      assert.match(logs[0], /^\[plugin dangling: activate\] /);
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

describe('a plugin\'s main half', { concurrency: 1 }, () => {
  // a temporary app folder with a plugin for each id, whose main.cjs holds
  // the source given
  function withMains(sources) {
    const app = appFolder(Object.fromEntries(Object.keys(sources)
      .map((id) => [`plugins/${id}`, plugin(id, { main: 'main.cjs' })])));
    for (const [id, source] of Object.entries(sources)) fs.writeFileSync(path.join(app, 'plugins', id, 'main.cjs'), source);
    return app;
  }
  const mainOf = (app, id) => require(path.join(app, 'plugins', id, 'main.cjs'));
  // a main half that keeps the host it is handed, for the test to use
  const keeper = 'exports.activate = (host) => { exports.host = host; };';
  const invoke = (handlers, ...args) => windowNeo((channel, ...rest) => handlers.get(channel)({}, ...rest)).pluginInvoke(...args);
  // a promise's handlers have run, and so has anything set on setImmediate
  const turn = () => new Promise((resolve) => setImmediate(resolve));

  test('invoke reaches the ping plugin\'s main half and resolves its answer', async () => {
    const { handlers } = wire({ dirs: fixtures });
    plugins.activateMains();
    assert.deepEqual(await invoke(handlers, 'ping', 'ping', { a: 1 }), { pong: { a: 1 } });
    assert.deepEqual(await invoke(handlers, 'ping', 'ping'), { pong: undefined });
  });

  test('an answer that looks like a failure is still an answer', async () => {
    const app = withMains({ echo: "exports.activate = (host) => host.handle('echo', (payload) => payload);" });
    const { handlers } = wire({ appRoot: app });
    plugins.activateMains();
    assert.deepEqual(await invoke(handlers, 'echo', 'echo', { error: 'not a failure' }), { error: 'not a failure' });
    assert.equal(await invoke(handlers, 'echo', 'echo'), undefined);
  });

  test('an invoke sent before a slow activate ends waits for it, then resolves', async () => {
    const app = withMains({
      slow: [
        'let open;',
        'exports.opened = new Promise((resolve) => { open = resolve; });',
        'exports.open = () => open();',
        "exports.activate = async (host) => { await exports.opened; host.handle('echo', (payload) => payload); };"
      ].join('\n')
    });
    const { handlers } = wire({ appRoot: app });
    plugins.activateMains(); // returns while slow's activate still waits
    let answered = false;
    const answer = invoke(handlers, 'slow', 'echo', { a: 1 }).finally(() => { answered = true; });
    await turn();
    assert.equal(answered, false, 'no answer while activate is still running');
    mainOf(app, 'slow').open();
    assert.deepEqual(await answer, { a: 1 });
  });

  test('a plugin with no main half, a channel its half never took, or a name that is no channel rejects naming the channel', async () => {
    const { handlers } = wire({ dirs: fixtures });
    plugins.activateMains();
    await assert.rejects(invoke(handlers, 'other', 'ping'), /\bping\b/);
    await assert.rejects(invoke(handlers, 'broken', 'ping'), /\bping\b/); // a window half alone
    await assert.rejects(invoke(handlers, 'ping', 'nope'), /\bnope\b/);
    await assert.rejects(invoke(handlers, 'ping', 'Ping Me'), /Ping Me/);
  });

  // main.js logs and explains every rejection of an ipcMain.handle; a plugin's
  // failure is neither a refused write nor main.js's to log, so it goes back
  // as an answer that the window turns into the rejection
  test('a handler that throws rejects the invoke with an Error naming the plugin and the channel, and is logged once with its stack', async () => {
    const { handlers, logs } = wire({ dirs: fixtures });
    plugins.activateMains();
    await assert.rejects(invoke(handlers, 'ping', 'fail'), (err) => {
      assert.equal(err.constructor.name, 'Error');
      assert.match(err.message, /\bping\b.*\bfail\b.*failed on purpose/);
      return true;
    });
    assert.equal(logs.length, 1, logs.join('\n'));
    assert.match(logs[0], /^\[plugin ping: invoke fail\] Error: failed on purpose\n\s+at /);
  });

  test('a handler that rejects or throws what is no Error still rejects the invoke with a message', async () => {
    const app = withMains({
      odd: [
        'exports.activate = (host) => {',
        "  host.handle('text', () => { throw 'plain text'; });",
        "  host.handle('nothing', async () => { throw undefined; });",
        "  host.handle('bare', () => { throw Object.create(null); });",
        '};'
      ].join('\n')
    });
    const { handlers, logs } = wire({ appRoot: app });
    plugins.activateMains();
    await assert.rejects(invoke(handlers, 'odd', 'text'), /\bodd\b.*\btext\b.*plain text/);
    await assert.rejects(invoke(handlers, 'odd', 'nothing'), /\bodd\b.*\bnothing\b/);
    await assert.rejects(invoke(handlers, 'odd', 'bare'), /\bodd\b.*\bbare\b/);
    assert.equal(logs.length, 3, logs.join('\n'));
  });

  // Electron sends an answer by structured clone. One it cannot clone (a
  // function, a Promise inside an object) leaves the window's invoke
  // waiting for ever, and the failure goes to the console, not the log.
  test('a handler whose answer cannot be cloned rejects the invoke and is logged, as any failure of its handler is', async () => {
    const app = withMains({
      odd: [
        'exports.activate = (host) => {',
        "  host.handle('fn', () => () => 1);",
        "  host.handle('promised', async () => ({ later: new Promise(() => {}) }));",
        "  host.handle('plain', () => ({ list: [1, 2], when: new Date(0), none: undefined }));",
        '};'
      ].join('\n')
    });
    const { handlers, logs } = wire({ appRoot: app });
    plugins.activateMains();
    await assert.rejects(invoke(handlers, 'odd', 'fn'), /\bodd\b.*\bfn\b.*could not be cloned/);
    await assert.rejects(invoke(handlers, 'odd', 'promised'), /\bodd\b.*\bpromised\b.*could not be cloned/);
    assert.equal(logs.length, 2, logs.join('\n'));
    assert.match(logs[0], /^\[plugin odd: invoke fn\] /);
    assert.match(logs[1], /^\[plugin odd: invoke promised\] /);
    const plain = await invoke(handlers, 'odd', 'plain');
    assert.deepEqual(plain.list, [1, 2]);
    assert.equal(plain.when.getTime(), 0);
    assert.equal(logs.length, 2);
  });

  test('a main half that throws in activate, rejects, will not load or has no activate is logged, and the next still loads', async () => {
    const app = withMains({
      'a-throws': "exports.activate = (host) => { host.handle('echo', (p) => p); throw new Error('thrown in activate'); };",
      'b-rejects': "exports.activate = async (host) => { host.handle('echo', (p) => p); throw new Error('rejected in activate'); };",
      'c-unloadable': 'this is not JavaScript',
      'd-inert': 'exports.answer = 42;',
      'e-good': "exports.activate = (host) => host.handle('echo', (p) => p);"
    });
    const { handlers, logs } = wire({ appRoot: app });
    plugins.activateMains();
    assert.equal(await invoke(handlers, 'e-good', 'echo', 7), 7);
    // a half that failed answers nothing, not even what it took before it failed
    for (const id of ['a-throws', 'b-rejects', 'c-unloadable', 'd-inert']) {
      await assert.rejects(invoke(handlers, id, 'echo'), new RegExp(`${id}\\b.*\\becho\\b`), id);
    }
    const line = (id) => logs.find((l) => l.startsWith(`[plugin ${id}: activate]`)) || `nothing logged for ${id}`;
    assert.match(line('a-throws'), /\] Error: thrown in activate\n\s+at /);
    assert.match(line('b-rejects'), /\] Error: rejected in activate\n\s+at /);
    assert.match(line('c-unloadable'), /SyntaxError: /);
    assert.match(line('d-inert'), /TypeError: .*no activate function/);
    assert.equal(logs.length, 4, logs.join('\n'));
  });

  // an activate that awaits what never comes (a file watcher's ready event,
  // say) would leave its plugin's invokes waiting for ever, and nothing in
  // neo-errors.log to say why
  describe('an activate that does not settle', () => {
    // each main half's activate waits for exports.open(), as a test says
    const gated = (body = '') => [
      'let open;',
      'exports.opened = new Promise((resolve) => { open = resolve; });',
      'exports.open = () => open();',
      `exports.activate = async (host) => { host.handle('echo', (p) => p); await exports.opened; ${body} };`
    ].join('\n');
    // how an invoke stands a turn later: answered, refused or still waiting
    // (which is the fault under test, so it must not hang the test)
    const outcome = (promise) => Promise.race([
      promise.then((value) => ({ value }), (error) => ({ error })),
      turn().then(() => ({ waiting: true }))
    ]);
    async function refused(promise, pattern) {
      const out = await outcome(promise);
      assert.ok(out.error, out.waiting ? 'the invoke is left waiting' : `the invoke is answered with ${out.value}`);
      assert.match(out.error.message, pattern);
    }

    test('is logged once after 10 s, and its pending and later invokes reject saying so', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const app = withMains({ stuck: gated() });
      const { handlers, logs } = wire({ appRoot: app });
      plugins.activateMains();
      const pending = invoke(handlers, 'stuck', 'echo', 1);
      t.mock.timers.tick(9999);
      assert.deepEqual(await outcome(pending), { waiting: true }, 'nothing is refused inside 10 s');
      assert.deepEqual(logs, []);
      t.mock.timers.tick(1);
      await refused(pending, /\bstuck\b.*did not finish activating.*\becho\b/);
      assert.equal(logs.length, 1, logs.join('\n'));
      assert.match(logs[0], /^\[plugin stuck: activate\] .*did not finish activating within 10 s/);
      await refused(invoke(handlers, 'stuck', 'echo', 2), /\bstuck\b.*did not finish activating.*\becho\b/);
      assert.equal(logs.length, 1, 'later invokes add nothing to the log');
    });

    test('stays refused, and says nothing more, when it settles late or fails late', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const app = withMains({ slow: gated(), doomed: gated("throw new Error('failed late');") });
      const { handlers, logs } = wire({ appRoot: app });
      plugins.activateMains();
      t.mock.timers.tick(10000);
      await turn();
      assert.equal(logs.length, 2, logs.join('\n'));
      mainOf(app, 'slow').open();
      mainOf(app, 'doomed').open();
      await turn();
      for (const id of ['slow', 'doomed']) await refused(invoke(handlers, id, 'echo'), /did not finish activating/);
      assert.equal(logs.length, 2, logs.join('\n'));
    });

    test('is no matter when it settles in time: the plugin answers, and the limit never logs', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const app = withMains({ prompt: gated(), sync: "exports.activate = (host) => host.handle('echo', (p) => p);" });
      const { handlers, logs } = wire({ appRoot: app });
      plugins.activateMains();
      t.mock.timers.tick(9999);
      mainOf(app, 'prompt').open();
      assert.equal(await invoke(handlers, 'prompt', 'echo', 3), 3);
      assert.equal(await invoke(handlers, 'sync', 'echo', 4), 4);
      t.mock.timers.tick(60000);
      await turn();
      assert.deepEqual(logs, []);
      assert.equal(await invoke(handlers, 'prompt', 'echo', 5), 5);
    });

    test('has the limit that wire is given', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const app = withMains({ stuck: gated() });
      const { handlers, logs } = wire({ appRoot: app, activateMs: 500 });
      plugins.activateMains();
      t.mock.timers.tick(499);
      await turn();
      assert.deepEqual(logs, []);
      t.mock.timers.tick(1);
      await refused(invoke(handlers, 'stuck', 'echo'), /did not finish activating/);
      assert.match(logs[0], /did not finish activating within 0\.5 s/);
    });
  });

  // The window's preload asks main.js three things with sendSync, plugins:list
  // the last, and the window waits for the answers. A main entry's require
  // and the start of its activate run plugin code of any length, so no main
  // half starts before the window has its plugin list.
  test('a main half does not start until the window has its plugin list, and an invoke sent before waits for it', async () => {
    const app = withMains({ later: "let n = 0; exports.activate = (host) => { exports.starts = ++n; host.handle('echo', (p) => p); };" });
    const { handlers, logs } = wire({ appRoot: app, defer: null });
    plugins.activateMains();
    plugins.activateMains();
    const answer = invoke(handlers, 'later', 'echo', 7);
    await turn();
    assert.equal(mainOf(app, 'later').starts, undefined, 'activate has not run');
    const event = {};
    handlers.get('plugins:list')(event);
    assert.deepEqual(event.returnValue.map((m) => m.id), ['later']);
    assert.equal(mainOf(app, 'later').starts, undefined, 'nor while the list is being answered');
    assert.equal(await answer, 7);
    // a second window asking starts nothing again
    handlers.get('plugins:list')({});
    await turn();
    assert.equal(mainOf(app, 'later').starts, 1);
    assert.deepEqual(logs, []);
  });

  test('activateMains starts each main half once, however often it runs', async () => {
    const app = withMains({ once: "let n = 0; exports.activate = (host) => { n++; host.handle('count', () => n); };" });
    const { handlers } = wire({ appRoot: app });
    plugins.activateMains();
    plugins.activateMains();
    assert.equal(await invoke(handlers, 'once', 'count'), 1);
  });

  test('handle refuses a name that is no channel, a handler that is not a function, and a channel already taken', async () => {
    const app = withMains({ keeper });
    const { handlers } = wire({ appRoot: app });
    plugins.activateMains();
    const { host } = mainOf(app, 'keeper');
    host.handle('index.rebuild-2', () => 'first');
    host.handle('x'.repeat(64), () => 'longest');
    for (const bad of ['Index', '2nd', '-x', '', 'x'.repeat(65), 'a/b', 'a b', 7, null]) {
      assert.throws(() => host.handle(bad, () => 'no'), TypeError, String(bad));
    }
    assert.throws(() => host.handle('later', 'not a function'), TypeError);
    assert.throws(() => host.handle('index.rebuild-2', () => 'second'), TypeError);
    assert.equal(await invoke(handlers, 'keeper', 'index.rebuild-2'), 'first');
    assert.equal(await invoke(handlers, 'keeper', 'x'.repeat(64)), 'longest');
  });

  test('the host a main half is handed is its id, handle and log, and nothing else', () => {
    const app = withMains({ keeper });
    wire({ appRoot: app });
    plugins.activateMains();
    const { host } = mainOf(app, 'keeper');
    assert.deepEqual(Object.keys(host).sort(), ['handle', 'id', 'log']);
    assert.equal(host.id, 'keeper');
    assert.ok(Object.isFrozen(host));
  });

  test('log writes errors and warnings to the error log under the plugin\'s name, the rest to the console, and refuses a level it does not know', (t) => {
    const app = withMains({ keeper });
    const { logs } = wire({ appRoot: app });
    plugins.activateMains();
    const { host } = mainOf(app, 'keeper');
    const printed = [];
    t.mock.method(console, 'log', (line) => printed.push(line));
    host.log('error', 'the index is unreadable', new Error('index cut short'));
    host.log('warn', 'slow rebuild', { ms: 1200 });
    host.log('info', 'indexed', { chapters: 3 });
    host.log('debug', 'looked');
    assert.throws(() => host.log('loud', 'shouted'), TypeError);
    assert.equal(logs.length, 2, logs.join('\n'));
    assert.match(logs[0], /^\[plugin keeper: error\] the index is unreadable Error: index cut short\n\s+at /);
    assert.equal(logs[1], '[plugin keeper: warn] slow rebuild {"ms":1200}');
    assert.deepEqual(printed, ['[plugin keeper: info] indexed {"chapters":3}', '[plugin keeper: debug] looked']);
  });

  // a window half that invokes on every keystroke calls its handler as
  // often, and every line goes into neo-errors.log, a file in the synced
  // library
  test('a handler that fails every time is logged once, then at most once a minute with a count, and every invoke still rejects', async (t) => {
    const clock = { now: 0 };
    t.mock.method(performance, 'now', () => clock.now);
    const app = withMains({ keeper });
    const { handlers, logs } = wire({ appRoot: app });
    plugins.activateMains();
    const { host } = mainOf(app, 'keeper');
    host.handle('throws', () => { throw new Error('throws every time'); });
    host.handle('rejects', async () => { throw new Error('rejects every time'); });
    const calls = async (n) => {
      for (let i = 0; i < n; i++) {
        await assert.rejects(invoke(handlers, 'keeper', 'throws'), /\bkeeper\b.*\bthrows\b.*throws every time/);
        await assert.rejects(invoke(handlers, 'keeper', 'rejects'), /\bkeeper\b.*\brejects\b.*rejects every time/);
      }
    };
    await calls(100);
    assert.equal(logs.length, 2, 'the first failure of each handler');
    assert.match(logs[0], /^\[plugin keeper: invoke throws\] Error: throws every time\n\s+at /);
    assert.match(logs[1], /^\[plugin keeper: invoke rejects\] Error: rejects every time\n\s+at /);
    clock.now += 59999;
    await calls(10);
    assert.equal(logs.length, 2);
    clock.now += 1;
    await calls(1);
    assert.equal(logs.length, 4);
    assert.match(logs[2], /^\[plugin keeper: invoke throws\] 109 more failures of this handler since its last line; the latest: Error: throws every time\n\s+at /);
    assert.match(logs[3], /^\[plugin keeper: invoke rejects\] 109 more failures of this handler since its last line; the latest: Error: rejects every time\n\s+at /);
    // a minute with none, and the next is logged as a first
    clock.now += 60000;
    await calls(1);
    assert.equal(logs.length, 6);
    assert.match(logs[4], /^\[plugin keeper: invoke throws\] Error: throws every time\n/);
  });

  test('one function that handles two channels is logged for each, once a minute, as a failure of each', async (t) => {
    const clock = { now: 0 };
    t.mock.method(performance, 'now', () => clock.now);
    const app = withMains({ keeper });
    const { handlers, logs } = wire({ appRoot: app });
    plugins.activateMains();
    const { host } = mainOf(app, 'keeper');
    const shared = () => { throw new Error('shared fails'); };
    host.handle('first', shared);
    host.handle('second', shared);
    for (let i = 0; i < 5; i++) {
      await assert.rejects(invoke(handlers, 'keeper', 'first'), /shared fails/);
      await assert.rejects(invoke(handlers, 'keeper', 'second'), /shared fails/);
    }
    assert.equal(logs.length, 2, 'the first failure on each channel');
    assert.match(logs[0], /^\[plugin keeper: invoke first\] Error: shared fails\n/);
    assert.match(logs[1], /^\[plugin keeper: invoke second\] Error: shared fails\n/);
    clock.now += 60000;
    await assert.rejects(invoke(handlers, 'keeper', 'second'), /shared fails/);
    assert.equal(logs.length, 3);
    assert.match(logs[2], /^\[plugin keeper: invoke second\] 4 more failures of this handler since its last line; the latest: Error: shared fails\n/);
  });
});

describe('main.js and the plugins\' main halves', { concurrency: 1 }, () => {
  let appDir = null; // main.js's own folder: a temporary one with the fixture plugins
  let pingMain = null;
  let profile = null;
  let main = null;
  const library = () => path.join(profile, 'documents', 'NEO Library');
  const errorLog = () => {
    try { return fs.readFileSync(path.join(library(), 'neo-errors.log'), 'utf8'); } catch { return ''; }
  };
  const turn = () => new Promise((resolve) => setImmediate(resolve));

  before(() => {
    appDir = fixtureApp(fs.mkdtempSync(path.join(os.tmpdir(), 'neo-plugins-app-')));
    pingMain = path.join(appDir, fixtures, 'ping', 'main.js');
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-plugins-main-'));
    fs.mkdirSync(path.join(profile, 'userData'));
    // read once, by the first test's ready()
    process.env.NEO_PLUGIN_DIRS = fixtures;
    main = loadMain(profile, appDir);
  });
  after(() => {
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(appDir, { recursive: true, force: true });
  });

  // The window's preload asks main.js three things synchronously (sendSync)
  // and the window waits for the answers; plugins:list is the last. Plugin
  // code of any length must run after them, not in the startup callback.
  test('the startup callback returns before any plugin code runs, and the main halves start a turn after the window has its plugin list', async (t) => {
    const order = [];
    const ping = require(pingMain);
    const activate = ping.activate;
    t.mock.method(ping, 'activate', (host) => { order.push('activate ping'); return activate(host); });
    main.ready(order);
    assert.equal(order[0], 'createWindow');
    assert.ok(order.length > 1, 'the rest of the startup ran');
    await turn();
    await turn();
    assert.ok(!order.includes('activate ping'), 'no plugin code runs before the window asks for its plugin list');
    const listed = main.ask('plugins:list');
    assert.ok(listed.some((m) => m.id === 'ping'), 'the list holds the ping plugin');
    assert.ok(listed.every((m) => !('mainPath' in m)), 'and no path on disk');
    assert.ok(!order.includes('activate ping'), 'none runs while the list is being answered');
    await turn();
    assert.equal(order.at(-1), 'activate ping');
    const neo = windowNeo((channel, ...args) => main.call(channel, ...args));
    assert.deepEqual(await neo.pluginInvoke('ping', 'ping', 'hello'), { pong: 'hello' });
    assert.doesNotMatch(errorLog(), /\b(startup|plugins)\b/);
  });

  // main.js wraps every ipcMain.handle: a rejection is logged under the
  // channel, and a refused write inside the library (EPERM, EACCES, EROFS)
  // opens a dialog saying NEO can't save. A plugin that writes a file of its
  // own in the library can fail so, with the writer's chapter already saved.
  test('a handler that fails logs once and opens no dialog, though its error looks like a refused write in the library', async () => {
    const { host } = require(pingMain);
    host.handle('refused', () => {
      throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM', path: path.join(library(), 'ping.json') });
    });
    const neo = windowNeo((channel, ...args) => main.call(channel, ...args));
    const before = errorLog();
    const errors = await Promise.all(['refused', 'fail'].map((channel) => neo.pluginInvoke('ping', channel).then(() => null, (err) => err)));
    await turn();
    assert.deepEqual(main.dialogs, [], 'no dialog');
    const added = errorLog().slice(before.length);
    assert.deepEqual(added.match(/^\[[^\]]+\] \[[^\]]+\]/gm).map((line) => line.replace(/^\[[^\]]+\] /, '')),
      ['[plugin ping: invoke refused]', '[plugin ping: invoke fail]']);
    assert.match(errors[0] && errors[0].message, /\bping\b.*\brefused\b.*EPERM/);
    assert.match(errors[1] && errors[1].message, /\bping\b.*\bfail\b.*failed on purpose/);
  });
});

describe('main halves when no window asks for the plugin list', { concurrency: 1 }, () => {
  const turn = () => new Promise((resolve) => setImmediate(resolve));

  // a window whose preload failed to load never asks, and nothing may wait
  // on it for ever
  test('they start 5 s after startup all the same, and an invoke sent before waits for that', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    process.env.NEO_PLUGIN_DIRS = fixtures;
    const appDir = fixtureApp();
    const profile = tempFolder();
    fs.mkdirSync(path.join(profile, 'userData'));
    const ping = require(path.join(appDir, fixtures, 'ping', 'main.js'));
    const order = [];
    const activate = ping.activate;
    t.mock.method(ping, 'activate', (host) => { order.push('activate ping'); return activate(host); });
    const main = loadMain(profile, appDir);
    main.ready(order);
    await turn();
    t.mock.timers.tick(4999);
    await turn();
    assert.ok(!order.includes('activate ping'), 'not before the time is up');
    const neo = windowNeo((channel, ...args) => main.call(channel, ...args));
    const answer = neo.pluginInvoke('ping', 'ping', 3);
    t.mock.timers.tick(1);
    assert.deepEqual(await answer, { pong: 3 });
    assert.equal(order.at(-1), 'activate ping');
    // the window that asks late starts nothing twice
    main.ask('plugins:list');
    await turn();
    assert.equal(order.filter((name) => name === 'activate ping').length, 1);
  });
});
