const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Sandboxed preload cannot require('./i18n'). Main loads the catalogs and
// hands us a snapshot over a synchronous IPC channel.
  const i18nState = ipcRenderer.sendSync('i18n:bootstrap') || {
  locale: 'en', catalog: {}, fallback: {}, bodyFontNames: [], defaultBodyFont: 'Georgia', locales: ['en']
};

function dig(obj, key) {
  return key.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : undefined), obj);
}

function t(key, vars) {
  let str = dig(i18nState.catalog, key);
  if (str == null) str = dig(i18nState.fallback, key);
  if (str == null) str = key;
  if (typeof str !== 'string') return String(str);
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, name) =>
    (vars[name] != null ? String(vars[name]) : '{' + name + '}'));
}

contextBridge.exposeInMainWorld('neo', {
  readLibrary: () => ipcRenderer.invoke('library:read'),
  writeLibrary: (data) => ipcRenderer.invoke('library:write', data),

  createBook: (meta) => ipcRenderer.invoke('book:create', meta),
  readBookMeta: (bookId) => ipcRenderer.invoke('book:readMeta', bookId),
  writeBookMeta: (bookId, meta) => ipcRenderer.invoke('book:writeMeta', bookId, meta),
  deleteBook: (bookId, title) => ipcRenderer.invoke('book:delete', bookId, title),

  readChapter: (bookId, chId) => ipcRenderer.invoke('chapter:read', bookId, chId),
  writeChapter: (bookId, chId, html) => ipcRenderer.invoke('chapter:write', bookId, chId, html),
  deleteChapter: (bookId, chId) => ipcRenderer.invoke('chapter:delete', bookId, chId),

  readAux: (bookId, name) => ipcRenderer.invoke('aux:read', bookId, name),
  writeAux: (bookId, name, html) => ipcRenderer.invoke('aux:write', bookId, name, html),

  readJSON: (bookId, name, fallback) => ipcRenderer.invoke('json:read', bookId, name, fallback),
  writeJSON: (bookId, name, data) => ipcRenderer.invoke('json:write', bookId, name, data),

  exportSave: (payload) => ipcRenderer.invoke('export:save', payload),
  emailDraft: (payload) => ipcRenderer.invoke('email:draft', payload),
  logError: (msg) => ipcRenderer.invoke('log:error', msg),
  importPick: () => ipcRenderer.invoke('import:pick'),
  libraryPath: () => ipcRenderer.invoke('library:path'),
  pickCover: () => ipcRenderer.invoke('cover:pick'),
  setCover: (bookId, srcPath) => ipcRenderer.invoke('cover:set', bookId, srcPath),
  removeCover: (bookId) => ipcRenderer.invoke('cover:remove', bookId),
  readCover: (bookId, fname) => ipcRenderer.invoke('cover:read', bookId, fname),
  importFiles: (paths) => ipcRenderer.invoke('import:files', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  fullscreenEscape: () => ipcRenderer.invoke('fullscreen:escape'),
  fullscreenToggle: () => ipcRenderer.invoke('fullscreen:toggle'),

  // i18n: add locales/<code>.json to ship another language
  locale: i18nState.locale,
  t,
  bodyFontNames: () => i18nState.bodyFontNames.slice(),
  defaultBodyFont: () => i18nState.defaultBodyFont,

  onMenu: (cb) => ipcRenderer.on('menu', (_e, msg) => cb(msg))
});
