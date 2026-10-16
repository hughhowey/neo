'use strict';

// Plugins, main-process half. A plugin is a folder holding a plugin.json; the
// folders sit under plugins/ in the app folder and, outside a packaged app,
// under each comma-separated folder in NEO_PLUGIN_DIRS. This file finds them
// and lists them for the window (plugins:list); the window loads each one's
// script (plugins.js). It takes nothing from
// Electron itself: main.js hands it app, ipcMain and logError through
// wire(), and nothing runs when it is loaded.

const fs = require('fs');
const path = require('path');

// what a plugin.json may hold (validManifest)
const MANIFEST_KEYS = ['id', 'apiVersion', 'renderer', 'main'];
const PLUGIN_ID = /^[a-z][a-z0-9-]{1,31}$/;
const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*\.(js|cjs)$/;
const NEWEST_API = 1; // the newest plugin API this NEO knows (plugins.js has the list)

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const onlyKeys = (o, keys) => Object.keys(o).every((k) => keys.includes(k));
const isFileName = (v) => typeof v === 'string' && FILE_NAME.test(v);
const optionalFile = (v) => v === undefined || isFileName(v);

function validManifest(m) {
  if (!isObject(m) || !onlyKeys(m, MANIFEST_KEYS)) return false;
  if (typeof m.id !== 'string' || !PLUGIN_ID.test(m.id)) return false;
  if (!Number.isInteger(m.apiVersion) || m.apiVersion < 1 || m.apiVersion > NEWEST_API) return false;
  return isFileName(m.renderer) && optionalFile(m.main);
}

// { app, ipcMain, logError, appRoot }, from wire()
let host = null;
let found = null; // discover()'s answer, kept for the life of the process

function wire(deps) {
  host = { ...deps };
  found = null;
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
  });
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
      list.push({ ...manifest, rendererUrl, mainPath: manifest.main ? path.join(folder, manifest.main) : null });
    }
  }
  found = list;
  return found;
}

module.exports = { wire, validManifest, discover };
