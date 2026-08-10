const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('neo', {
  platform: process.platform, // 'darwin' | 'win32' | 'linux'

  readLibrary: () => ipcRenderer.invoke('library:read'),
  writeLibrary: (data) => ipcRenderer.invoke('library:write', data),
  libraryPath: () => ipcRenderer.invoke('library:path'),

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
  setSilo: (on) => ipcRenderer.invoke('silo:set', on),
  fullscreenEscape: () => ipcRenderer.invoke('fullscreen:escape'),

  onMenu: (cb) => ipcRenderer.on('menu', (_e, msg) => cb(msg))
});
