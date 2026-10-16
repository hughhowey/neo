'use strict';

// Plugins, main-process half. A plugin is a folder holding a plugin.json; the
// folders sit under plugins/ in the app folder and, outside a packaged app,
// under each comma-separated folder in NEO_PLUGIN_DIRS. This file finds them,
// lists them for the window (plugins:list), where plugins.js loads each
// one's script, and starts the main half of each plugin that has one (its
// manifest's main): an activate(host) that answers the plugin's own window
// half (plugin:invoke). A plugin named in pluginsOff in settings.json is
// listed but off: its script is never loaded and its main half never
// starts. The setting is read once, at launch. This file takes nothing from
// Electron itself: main.js hands it app, ipcMain, logError and the settings
// through wire(), and nothing runs when it is loaded.

const fs = require('fs');
const path = require('path');

// what a plugin.json may hold (validManifest)
const MANIFEST_KEYS = ['id', 'apiVersion', 'title', 'description', 'renderer', 'main'];
const PLUGIN_ID = /^[a-z][a-z0-9-]{1,31}$/;
const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*\.(js|cjs)$/;
const MAX_TITLE = 64;
const MAX_DESCRIPTION = 280;
const NEWEST_API = 1; // the newest plugin API this NEO knows (plugins.js has the list)
// how long a main half's activate may take to settle (start)
const ACTIVATE_MS = 10000;
// how long the main halves wait for a window to ask for its plugin list
const ASK_MS = 5000;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const onlyKeys = (o, keys) => Object.keys(o).every((k) => keys.includes(k));
const isFileName = (v) => typeof v === 'string' && FILE_NAME.test(v);
const optionalFile = (v) => v === undefined || isFileName(v);
// a length counts code points, not UTF-16 units
const optionalText = (v, max) => v === undefined || (typeof v === 'string' && v.length > 0 && [...v].length <= max);

function validManifest(m) {
  if (!isObject(m) || !onlyKeys(m, MANIFEST_KEYS)) return false;
  if (typeof m.id !== 'string' || !PLUGIN_ID.test(m.id)) return false;
  if (!Number.isInteger(m.apiVersion) || m.apiVersion < 1 || m.apiVersion > NEWEST_API) return false;
  if (!optionalText(m.title, MAX_TITLE) || !optionalText(m.description, MAX_DESCRIPTION)) return false;
  return isFileName(m.renderer) && optionalFile(m.main);
}

// { app, ipcMain, logError, appRoot, readSettings }, from wire(), and, where a test
// needs another, activateMs (ACTIVATE_MS) and defer (see holdUntilAsked)
let host = null;
let found = null; // discover()'s answer, kept for the life of the process
// Each started main half by plugin id: { id, ready, failed, timedOut,
// handlers }. ready settles once its activate has, or its time limit has
// passed, and never rejects; handlers maps a channel to a function.
let mains = new Map();

function wire(deps) {
  host = { ...deps, activateMs: deps.activateMs ?? ACTIVATE_MS, defer: deps.defer ?? holdUntilAsked };
  found = null;
  mains = new Map();
  waiting = [];
  released = false;
  clearTimeout(askTimer);
  askTimer = null;
  failures = new WeakMap();
  // a plugin's window half calls its own main half (neo.invoke in plugins.js)
  host.ipcMain.handle('plugin:invoke', (_e, id, channel, payload) => answer(id, channel, payload));
  // the window asks once, synchronously, before any of its code runs, and
  // waits until it has an answer, so a throw here would hang it. It gets no
  // mainPath: the window never touches the disk, so it needs no paths on it
  host.ipcMain.on('plugins:list', (e) => {
    try {
      e.returnValue = discover().map(({ mainPath, ...listed }) => listed);
    } catch (err) {
      host.logError('plugins', err);
      e.returnValue = [];
    }
    // this is the last of the window's sendSync calls at load (preload.js),
    // and its answer is sent when this listener returns: the main halves
    // start on the next turn
    setImmediate(release);
  });
}

// The main halves start once the window has its plugin list, not before: a
// main entry's require, or the part of an activate before its first await,
// is plugin code of any length, and the window's preload waits on its
// sendSync answers, so all of it runs after them. A window that never asks
// (its preload failed to load) must not leave the main halves, and the
// invokes waiting on them, stuck: ASK_MS after the first is held, they start
// all the same.
let waiting = []; // the starts held back, until release()
let released = false;
let askTimer = null;
function holdUntilAsked(go) {
  if (released) {
    go();
    return;
  }
  waiting.push(go);
  if (!askTimer) {
    askTimer = setTimeout(release, ASK_MS);
    askTimer.unref();
  }
}

// once, however many windows ask
function release() {
  if (released) return;
  released = true;
  clearTimeout(askTimer);
  for (const go of waiting.splice(0)) go();
}

function skip(folder, why) {
  host.logError('plugins ' + folder, why);
}

// index.html loads a plugin's files by URLs relative to the app folder, and
// the page's CSP ('self') holds only inside that folder
function outsideApp(rel) {
  return path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep);
}

// Why p may not be used, or null: a path is followed through every link in
// it (a symlink, or a junction on Windows) to where it really leads, and
// that must lie inside the app folder's own real path. A path that will not
// resolve is refused with the error that says so, except one that is not
// there: it leads nowhere, and whoever needs the file logs its absence (the
// window, for a script that will not load).
function refusal(realApp, p, what) {
  let resolved;
  try {
    resolved = fs.realpathSync.native(p);
  } catch (err) {
    return err.code === 'ENOENT' ? null : err;
  }
  return outsideApp(path.relative(realApp, resolved)) ? `skipped: ${what} leads outside the app folder, to ${resolved}` : null;
}

function urlOf(rel, folderName, file) {
  const segments = rel ? rel.split(path.sep) : [];
  return [...segments, folderName, file].map(encodeURIComponent).join('/');
}

// NEO_PLUGIN_DIRS is for development: a packaged app reads only plugins/
// The ids settings.json turns off. A pluginsOff that is no list of ids is
// logged and turns nothing off: a hand-edited setting gone wrong must not
// leave the writer without plugins they rely on, nor be silent.
function switchedOff() {
  const off = host.readSettings().pluginsOff;
  if (off === undefined) return new Set();
  if (Array.isArray(off) && off.every((id) => typeof id === 'string')) return new Set(off);
  host.logError('plugins', `pluginsOff in settings.json is not a list of plugin ids, so every plugin stays on: ${JSON.stringify(off)}`);
  return new Set();
}

function extraRoots() {
  const { app, appRoot } = host;
  if (app.isPackaged || !process.env.NEO_PLUGIN_DIRS) return [];
  return process.env.NEO_PLUGIN_DIRS.split(',').map((dir) => dir.trim()).filter(Boolean)
    .map((dir) => path.resolve(appRoot, dir));
}

function discover() {
  if (found) return found;
  const { appRoot } = host;
  let realApp;
  try {
    realApp = fs.realpathSync.native(appRoot);
  } catch (err) {
    skip(appRoot, err);
    found = [];
    return found;
  }
  const off = switchedOff();
  const bundled = path.join(appRoot, 'plugins');
  const byId = new Map();
  const list = [];
  for (const root of [bundled, ...extraRoots()]) {
    // path.relative compares without regard to case on Windows
    const rel = path.relative(appRoot, root);
    if (outsideApp(rel)) { skip(root, 'skipped: outside the app folder'); continue; }
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (err) {
      // an app without bundled plugins has no plugins/ folder at all
      if (!(err.code === 'ENOENT' && root === bundled)) skip(root, err);
      continue;
    }
    const rootRefusal = refusal(realApp, root, 'the folder');
    if (rootRefusal) { skip(root, rootRefusal); continue; }
    // a link (a symlink, or a junction on Windows) can lead outside the app
    // folder, so it is refused like a root outside it
    for (const e of entries) if (e.isSymbolicLink()) skip(path.join(root, e.name), 'skipped: a link, which can lead outside the app folder');
    for (const name of entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
      const folder = path.join(root, name);
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(path.join(folder, 'plugin.json'), 'utf8'));
      } catch (err) { skip(folder, err); continue; }
      if (isObject(manifest) && Number.isInteger(manifest.apiVersion) && manifest.apiVersion > NEWEST_API) {
        // a newer API may add to the manifest too, so the rest is not judged
        skip(folder, `skipped: needs plugin API ${manifest.apiVersion}, and this NEO knows up to ${NEWEST_API}`);
        continue;
      }
      if (!validManifest(manifest)) { skip(folder, 'skipped: plugin.json does not match the manifest format'); continue; }
      if (byId.has(manifest.id)) { skip(folder, `skipped: the id "${manifest.id}" is already used by ${byId.get(manifest.id)}`); continue; }
      let rendererUrl;
      try {
        // encodeURIComponent throws URIError on a name holding a lone surrogate
        rendererUrl = urlOf(rel, name, manifest.renderer);
      } catch (err) { skip(folder, err); continue; }
      // a link anywhere in the folder's path, or in the script the page
      // loads from it, could lead out (the main entry is checked where it
      // is required)
      const folderRefusal = refusal(realApp, folder, 'the plugin folder')
        || refusal(realApp, path.join(folder, manifest.renderer), 'its renderer');
      if (folderRefusal) { skip(folder, folderRefusal); continue; }
      byId.set(manifest.id, folder);
      list.push({ ...manifest, rendererUrl, on: !off.has(manifest.id), mainPath: manifest.main ? path.join(folder, manifest.main) : null });
    }
  }
  found = list;
  return found;
}

// A plugin's main half: what its activate(host) receives and the IPC it
// answers. plugin:invoke routes on the id the window sends, and nothing
// checks that the caller is that plugin: every plugin's script runs in the
// page beside NEO's own, and any of them can call window.neo.pluginInvoke
// with another plugin's id. The id keeps a plugin from reaching another's
// half by mistake, not on purpose, so every installed plugin is trusted with
// every main half.

const CHANNEL = /^[a-z][a-z0-9.-]{0,63}$/;
const LOG_LEVELS = ['error', 'warn', 'info', 'debug'];

// What a plugin threw or passed, as one piece of text: an error's stack,
// else JSON. A plugin can throw anything, and a Symbol or an object with no
// prototype has no text form; the line must still be written.
function textOf(what) {
  try {
    if (what && what.stack) return String(what.stack);
    if (typeof what === 'string') return what;
    const json = JSON.stringify(what);
    return json === undefined ? String(what) : json;
  } catch {
    return `(a value of type ${typeof what} with no text form)`;
  }
}

// the short text of what a plugin threw: an error's message, else textOf
function messageOf(what) {
  try {
    if (what && typeof what.message === 'string') return what.message;
  } catch { /* a message that throws when read: textOf copes */ }
  return textOf(what);
}

// A handler that fails every time it is called would add a line to
// neo-errors.log, a file in the synced library written on the main thread,
// on every call. Its first failure is logged, then one a minute at most,
// with a count of those left out, as plugins.js does in the window. One
// function that serves two channels has a minute for each.
const QUIET_MS = 60000;
let failures = new WeakMap(); // handler -> Map of channel -> { at, untold }
function logFailure(entry, fn, doing, err) {
  const now = performance.now();
  if (!failures.has(fn)) failures.set(fn, new Map());
  const byDoing = failures.get(fn);
  const last = byDoing.get(doing);
  if (last && now - last.at < QUIET_MS) {
    last.untold++;
    return;
  }
  byDoing.set(doing, { at: now, untold: 0 });
  const more = last && last.untold ? `${last.untold} more failures of this handler since its last line; the latest: ` : '';
  host.logError(`plugin ${entry.id}: ${doing}`, more + textOf(err));
}

// what activate(host) receives
function apiFor(entry) {
  const { id } = entry;
  return Object.freeze({
    id,
    // answers neo.invoke(channel, payload) from this plugin's window half
    handle(channel, fn) {
      if (typeof channel !== 'string' || !CHANNEL.test(channel)) {
        throw new TypeError(`handle: ${textOf(channel)} is not a channel name (${CHANNEL})`);
      }
      if (typeof fn !== 'function') throw new TypeError(`handle('${channel}') needs a function`);
      if (entry.handlers.has(channel)) throw new TypeError(`handle: '${channel}' has a handler already`);
      if (!entry.failed) entry.handlers.set(channel, fn);
    },
    // neo-errors.log sits in the synced library, so only what went wrong
    // goes there; info and debug go to the console
    log(level, message, data) {
      if (!LOG_LEVELS.includes(level)) throw new TypeError(`log: no level is called ${textOf(level)}; there are ${LOG_LEVELS.join(', ')}`);
      const line = textOf(message) + (data === undefined ? '' : ' ' + textOf(data));
      if (level === 'error' || level === 'warn') host.logError(`plugin ${id}: ${level}`, line);
      else console.log(`[plugin ${id}: ${level}] ${line}`);
    }
  });
}

// A main half that fails to start loses whatever it registered, and the
// error goes to the log; NEO and the other plugins carry on
function fail(entry, err) {
  // once only: an activate that fails after its time limit has been reported
  if (entry.failed) return;
  entry.failed = true;
  entry.handlers.clear();
  host.logError(`plugin ${entry.id}: activate`, textOf(err));
}

// The file a main entry will be required from, or why it may not be. require
// follows what it is given: a link, a main.js.js beside a missing main.js,
// a package.json in a folder named main.js. So the path is resolved here,
// must be a file inside the app folder, and is the path that is required.
function realMain(mainPath) {
  const real = fs.realpathSync.native(mainPath);
  if (outsideApp(path.relative(fs.realpathSync.native(host.appRoot), real))) {
    throw new Error(`its main entry leads outside the app folder, to ${real}`);
  }
  if (!fs.statSync(real).isFile()) throw new Error(`its main entry is not a file: ${real}`);
  return real;
}

// An activate that awaits what never comes would leave its plugin's invokes
// waiting for ever, and the log silent. Past activateMs it counts as failed:
// logged once, and its pending and later invokes are refused, even if it
// settles after all.
function start(entry, mainPath) {
  let result;
  let async;
  try {
    const exported = require(realMain(mainPath));
    if (!exported || typeof exported.activate !== 'function') throw new TypeError(`${mainPath} has no activate function`);
    result = exported.activate(apiFor(entry));
    async = !!result && typeof result.then === 'function';
  } catch (err) {
    fail(entry, err);
    return Promise.resolve();
  }
  if (!async) return Promise.resolve();
  const limit = host.activateMs;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      entry.timedOut = true;
      fail(entry, `did not finish activating within ${limit / 1000} s, so its invokes are refused`);
      resolve();
    }, limit);
    timer.unref();
    Promise.resolve(result).then(() => {}, (err) => fail(entry, err)).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// Registers the main half of each plugin that has one, once, and starts it
// when the window has its plugin list (host.defer; see holdUntilAsked). None
// is awaited: an activate that returns a promise runs on while NEO starts.
// An invoke that comes before a main half has started waits for it, as for
// one still activating.
function activateMains() {
  for (const m of discover()) {
    if (!m.on || !m.mainPath || mains.has(m.id)) continue;
    const entry = { id: m.id, ready: null, failed: false, timedOut: false, handlers: new Map() };
    mains.set(m.id, entry);
    entry.ready = new Promise((resolve) => host.defer(() => resolve(start(entry, m.mainPath))));
  }
}

// plugin:invoke: waits until the plugin's main half has started, then
// hands the payload to the handler it took for the channel. A handler's
// error is logged here (see logFailure for how often) and goes back to the
// window as a rejection naming the plugin and the channel (see answer).
async function invoke(id, channel, payload) {
  if (typeof channel !== 'string' || !CHANNEL.test(channel)) throw new TypeError(`${textOf(channel)} is not a channel name`);
  const entry = mains.get(id);
  if (!entry && discover().some((m) => m.id === id && !m.on)) throw new Error(`plugin ${id} is turned off in settings.json, so nothing answers ${channel}`);
  if (!entry) throw new Error(`no plugin called ${textOf(id)} has a main half to answer ${channel}`);
  await entry.ready;
  if (entry.failed) throw new Error(`plugin ${entry.id} ${entry.timedOut ? 'did not finish activating' : 'failed to start its main half'}, so nothing answers ${channel}`);
  const fn = entry.handlers.get(channel);
  if (!fn) throw new Error(`plugin ${entry.id} has no handler for ${channel}`);
  try {
    // Electron clones the answer on its way to the window; one it cannot
    // clone (a function, a Promise inside an object) would leave the invoke
    // waiting for ever, with only the console to say why. Cloned here, it
    // fails as a failure of the handler.
    return structuredClone(await fn(payload));
  } catch (err) {
    logFailure(entry, fn, `invoke ${channel}`, err);
    throw new Error(`plugin ${entry.id}: ${channel} failed: ${messageOf(err)}`);
  }
}

// What plugin:invoke sends back is { result } or { error }, never a
// rejection: main.js logs every rejected handler again and, for an EPERM,
// EACCES or EROFS inside the library, tells the writer NEO can't save, and
// a plugin's failure is neither a refused save nor main.js's to log.
// preload.js turns { error } back into the rejection. A refusal (a name
// that is no channel, a plugin with no main half, a channel with no
// handler) is not logged here either: it rejects to the caller. A caller
// that drops the promise leaves an unhandled rejection in the window, where
// plugins.js logs it under the plugin's name, at most once a minute, and
// tells the writer nothing.
async function answer(id, channel, payload) {
  try {
    return { result: await invoke(id, channel, payload) };
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = { wire, validManifest, discover, activateMains };
