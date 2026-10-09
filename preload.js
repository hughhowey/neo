const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('neo', {
  platform: process.platform,
  // macOS: the system dictionary panel for the selected word (#179)
  lookUpText: () => ipcRenderer.invoke('app:lookUp'),

  readLibrary: () => ipcRenderer.invoke('library:read'),
  writeLibrary: (data) => ipcRenderer.invoke('library:write', data),

  createBook: (meta) => ipcRenderer.invoke('book:create', meta),
  duplicateBook: (bookId, title) => ipcRenderer.invoke('book:duplicate', bookId, title),
  listBooks: () => ipcRenderer.invoke('library:listBooks'),
  readBookMeta: (bookId) => ipcRenderer.invoke('book:readMeta', bookId),
  writeBookMeta: (bookId, meta) => ipcRenderer.invoke('book:writeMeta', bookId, meta),
  deleteBook: (bookId, title) => ipcRenderer.invoke('book:delete', bookId, title),

  readChapter: (bookId, chId) => ipcRenderer.invoke('chapter:read', bookId, chId),
  chapterStamps: (bookId) => ipcRenderer.invoke('chapter:stamps', bookId),
  writeChapter: (bookId, chId, html, expected) => ipcRenderer.invoke('chapter:write', bookId, chId, html, expected),
  deleteChapter: (bookId, chId) => ipcRenderer.invoke('chapter:delete', bookId, chId),

  readAux: (bookId, name) => ipcRenderer.invoke('aux:read', bookId, name),
  writeAux: (bookId, name, html) => ipcRenderer.invoke('aux:write', bookId, name, html),

  readJSON: (bookId, name, fallback) => ipcRenderer.invoke('json:read', bookId, name, fallback),
  writeJSON: (bookId, name, data) => ipcRenderer.invoke('json:write', bookId, name, data),

  exportSave: (payload) => ipcRenderer.invoke('export:save', payload),
  emailDraft: (payload) => ipcRenderer.invoke('email:draft', payload),
  logError: (msg) => ipcRenderer.invoke('log:error', msg),
  importPick: () => ipcRenderer.invoke('import:pick'),
  paperRead: (bookId, name) => ipcRenderer.invoke('paper:read', bookId, name),
  paperWrite: (bookId, name, base64) => ipcRenderer.invoke('paper:write', bookId, name, base64),
  paperAsset: (name) => ipcRenderer.invoke('paper:asset', name),
  paperLookup: (doi) => ipcRenderer.invoke('paper:lookup', doi),
  paperZotero: (q) => ipcRenderer.invoke('paper:zotero', q),
  paperLink: (bookId) => ipcRenderer.invoke('paper:link', bookId),
  paperLinked: (bookId, since) => ipcRenderer.invoke('paper:linked', bookId, since),
  paperUnlink: (bookId) => ipcRenderer.invoke('paper:unlink', bookId),
  paperPreview: (html, title, opts) => ipcRenderer.invoke('paper:preview', html, title, opts),
  libraryPath: () => ipcRenderer.invoke('library:path'),
  pickCover: () => ipcRenderer.invoke('cover:pick'),
  setCover: (bookId, srcPath) => ipcRenderer.invoke('cover:set', bookId, srcPath),
  removeCover: (bookId) => ipcRenderer.invoke('cover:remove', bookId),
  readCover: (bookId, fname) => ipcRenderer.invoke('cover:read', bookId, fname),
  paintCover: (bookId, text, options) => ipcRenderer.invoke('cover:paint', bookId, text, options),
  setSecret: (name, value) => ipcRenderer.invoke('secret:set', name, value),
  hasSecret: (name) => ipcRenderer.invoke('secret:has', name),
  importFiles: (paths) => ipcRenderer.invoke('import:files', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  fullscreenEscape: () => ipcRenderer.invoke('fullscreen:escape'),
  fullscreenToggle: () => ipcRenderer.invoke('fullscreen:toggle'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  spellCheckWords: (words) => ipcRenderer.invoke('spell:check', words),
  spellSuggest: (word) => ipcRenderer.invoke('spell:suggest', word),
  spellLearn: (word) => ipcRenderer.invoke('spell:learn', word),
  setSpellLanguage: (code) => ipcRenderer.invoke('spell:setLanguage', code),
  appVersion: () => ipcRenderer.invoke('app:version'),
  openRelease: () => ipcRenderer.invoke('update:openRelease'),

  poetryState: (on) => ipcRenderer.send('poetry:state', on),
  flushState: (on) => ipcRenderer.send('flush:state', on),
  scriptState: (st) => ipcRenderer.send('script:state', st),
  paperState: (st) => ipcRenderer.send('paper:state', st),
  commands: () => ipcRenderer.invoke('commands:list'),
  runCommand: (id) => ipcRenderer.invoke('commands:run', id),
  paperTemplateImport: (bookId) => ipcRenderer.invoke('paper:template-import', bookId),
  paperTemplate: (bookId) => ipcRenderer.invoke('paper:template', bookId),
  paperTemplateRemove: (bookId) => ipcRenderer.invoke('paper:template-remove', bookId),
  printPaperback: (job) => ipcRenderer.invoke('print:paperback', job),
  // sent (and waited for) as a script line is right-clicked, so the menu
  // that opens next can offer Page Break Here
  scriptContext: (st) => ipcRenderer.sendSync('script:context', st),
  typewriterState: (st) => ipcRenderer.send('typewriter:state', st),
  vimState: (on) => ipcRenderer.send('vim:state', on),
  uiZoomState: (z) => ipcRenderer.send('uizoom:state', z),
  // interface language, fetched once before the page's scripts run
  i18n: ipcRenderer.sendSync('i18n:get'),
  paper: ipcRenderer.sendSync('paper:get'), // 'Letter' or 'A4', from the computer's region
  reloadForLanguage: () => ipcRenderer.invoke('i18n:reload'),

  writingStyleState: (st) => ipcRenderer.send('style:state', st),
  viewState: (st) => ipcRenderer.send('view:state', st),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, msg) => cb(msg))
});
