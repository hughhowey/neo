'use strict';

// The Windows portable .exe is a packaged build, but it must not run
// electron-updater: that downloads the setup program and installs NEO when
// the writer quits (#479). Help → Check for Update… shows the release page
// for it instead, as for `npm start`. Loads main.js the way filesystem.test.js
// does, with electron-updater and GitHub replaced.

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

function build({ portable = false, packaged = true } = {}) {
  const handlers = new Map();
  const seen = { updaterLoaded: 0 };
  const autoUpdater = { on() {}, checkForUpdates: async () => ({ updateInfo: { version: '9.9.9' } }) };
  const electron = {
    app: { isPackaged: packaged, getVersion: () => '1.6.1', commandLine: { appendSwitch() {} }, getPath: () => os.tmpdir(), getLocale: () => 'en', requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {} },
    ipcMain: { on() {}, handle: (name, fn) => handlers.set(name, fn) },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
    dialog: {},
    shell: {},
    utilityProcess: { fork: () => ({ on() {}, postMessage() {} }) },
    screen: {}
  };
  const context = vm.createContext({
    require: (name) => {
      if (name === 'electron') return electron;
      if (name === 'electron-updater') { seen.updaterLoaded++; return { autoUpdater }; }
      return localRequire(name);
    },
    __dirname: root,
    process: { platform: 'win32', env: portable ? { PORTABLE_EXECUTABLE_FILE: 'C:\\Users\\me\\NEO-1.5.0-portable.exe' } : {}, on() {} },
    console,
    fetch: async () => ({ ok: true, json: async () => ({ tag_name: 'v9.9.9', html_url: 'https://github.com/hughhowey/neo/releases/tag/v9.9.9' }) })
  });
  vm.runInContext(source, context, { filename: path.join(root, 'main.js') });
  return { seen, autoUpdater, getUpdater: () => vm.runInContext('getUpdater()', context), holdUpdateForShutdown: () => vm.runInContext('holdUpdateForShutdown()', context), check: () => handlers.get('update:check')() };
}

describe('the portable .exe does not update itself', () => {
  test('a portable build gets no updater, and electron-updater is never loaded', () => {
    const pc = build({ portable: true });
    assert.equal(pc.getUpdater(), null);
    assert.equal(pc.seen.updaterLoaded, 0);
  });

  test('its update check falls back to the release page, with nothing to install', async () => {
    const res = await build({ portable: true }).check();
    assert.equal(res.canInstall, false);
    assert.equal(res.hasUpdate, true);
    assert.equal(res.latestVersion, '9.9.9');
  });

  test('an installed build still updates itself', async () => {
    const pc = build();
    assert.equal(pc.getUpdater(), pc.autoUpdater);
    assert.equal(pc.autoUpdater.autoInstallOnAppQuit, true);
    assert.equal((await pc.check()).canInstall, true);
  });

  test('Windows shutting down leaves a downloaded update for the next quit (#490)', () => {
    const pc = build();
    assert.equal(pc.getUpdater(), pc.autoUpdater);
    pc.holdUpdateForShutdown();
    assert.equal(pc.autoUpdater.autoInstallOnAppQuit, false);
  });

  test('`npm start` (not packaged) still has no updater', () => {
    assert.equal(build({ packaged: false }).getUpdater(), null);
  });
});
