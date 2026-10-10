// NEO — main process
// Owns the window and all file-system access. The renderer talks to this
// through the IPC handlers below (see preload.js for the exposed API).

const { app, BrowserWindow, ipcMain, dialog, Menu, MenuItem, utilityProcess, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Buffer } = require('buffer');

// Every disk request from the page passes through here: a write the system
// refuses (see reportBlockedWrite) is explained to the writer, then the error
// goes back to the page as before.
{
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, fn) => handle(channel, (...args) => {
    // a handler's answer keeps its own timing: sync stays sync
    let out;
    // (and any failure lands in the error log, named by its channel, for
    // whatever bug report follows)
    try { out = fn(...args); } catch (err) { reportBlockedWrite(err); logError('ipc ' + channel, err); throw err; }
    if (out && typeof out.then === 'function') out.catch((err) => { reportBlockedWrite(err); logError('ipc ' + channel, err); });
    return out;
  });
}

// macOS Chromium's "smart delete" also removes whitespace around a deleted
// selection, and that pass can duplicate characters. Deletes stay literal.
app.commandLine.appendSwitch('blink-settings', 'smartInsertDeleteEnabled=false');
// Linux: Chromium hears the system's voices (espeak, Piper, RHVoice…) only
// through speech-dispatcher, and only when asked to. Without it Read Aloud
// finds no voice at all (#287).
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-speech-dispatcher');

// ---------------------------------------------------------------------------
// Library location: a folder of plain files the user can inspect, sync, back up.
// ---------------------------------------------------------------------------
// Resolved properly at startup via app.getPath('documents') — this default
// covers any early access and non-redirected setups.
let LIBRARY_DIR = path.join(os.homedir(), 'Documents', 'NEO Library');
let LIBRARY_FILE = path.join(LIBRARY_DIR, 'library.json');

// NEO's few app-level settings (today: a custom library folder) live in the
// system's per-app data folder, since they must exist before the library
// is found. Everything about the writing stays in the library itself.
function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return {}; }
}
function writeSettings(obj) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  // the same whole-or-nothing write as the library: a settings file cut
  // short would forget a chosen library folder
  writeFileDurable(settingsPath(), JSON.stringify(obj, null, 2));
}

// ---------------------------------------------------------------------------
// Interface language: one JSON file per language in locales/ (see i18n.js).
// The choice is app-level, like the library folder, so it lives in
// settings.json. First launch follows the system language when NEO has it.
// ---------------------------------------------------------------------------
const NeoI18n = require('./i18n.js');
const { t } = NeoI18n;
const LOCALES_DIR = path.join(__dirname, 'locales');
let uiLanguage = 'en';

function readLocaleFile(code) {
  if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(code)) return null;
  try { return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, code + '.json'), 'utf8')); } catch { return null; }
}

// Every locales/<code>.json is a language on the menu, named in its own words
function listLanguages() {
  const out = [];
  try {
    for (const f of fs.readdirSync(LOCALES_DIR)) {
      const m = f.match(/^([a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*)\.json$/);
      if (!m) continue;
      const data = readLocaleFile(m[1]);
      if (!data) continue;
      out.push({ code: m[1], name: (data._meta && data._meta.name) || m[1] });
    }
  } catch (err) {
    logError('locales', err);
  }
  if (!out.some((l) => l.code === 'en')) out.push({ code: 'en', name: 'English' });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Codes follow BCP 47 (fr-CA); the POSIX spelling (fr_CA) is accepted too.
// A regional file (fr-CA.json) holds only what differs from its language's
// base file (fr.json): fr-CA falls back to fr, then to English.
const normCode = (c) => String(c || '').replace(/_/g, '-');

function resolveLanguage(wanted) {
  wanted = normCode(wanted);
  const codes = listLanguages().map((l) => l.code);
  const tries = [wanted, wanted && wanted.split('-')[0]].filter(Boolean);
  for (const c of tries) {
    const hit = codes.find((x) => x.toLowerCase() === c.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

// The chosen language's strings: its base language first, then the
// regional file's own wording on top
function localeDict(code) {
  if (code === 'en') return readLocaleFile('en') || {};
  const base = code.split('-')[0];
  const dict = base !== code ? { ...(readLocaleFile(base) || {}) } : {};
  Object.assign(dict, readLocaleFile(code) || {});
  return dict;
}

function loadLanguage(code) {
  uiLanguage = resolveLanguage(code) || 'en';
  const english = readLocaleFile('en') || {};
  const dict = localeDict(uiLanguage);
  NeoI18n.setLocale(uiLanguage, dict, english);
  return { locale: uiLanguage, dict, base: english };
}

function initLanguage() {
  const saved = readSettings().uiLanguage;
  let sys = 'en';
  try { sys = app.getLocale(); } catch { /* early start */ }
  loadLanguage(saved || resolveLanguage(sys) || 'en');
}

// The window asks once, synchronously, before any of its code runs
ipcMain.on('i18n:get', (e) => {
  const english = readLocaleFile('en') || {};
  e.returnValue = { locale: uiLanguage, dict: localeDict(uiLanguage), base: english };
});

// View → Language: save the choice, redraw the menus, and let the window
// save its pages before it reloads in the new language
function setUiLanguage(code) {
  loadLanguage(code);
  const settings = readSettings();
  settings.uiLanguage = uiLanguage;
  writeSettings(settings);
  // no dictionary picked yet: spellcheck moves with the interface
  if (!SPELL_LANGUAGES[chosenSpellLanguage()] && defaultSpellLanguage() !== spellLanguage) {
    spellLanguage = defaultSpellLanguage();
    loadSpellDictionary(spellLanguage);
  }
  try { buildMenu(); } catch (err) { logError('menu', err); }
  sendToWindow({ type: 'uiLanguage', value: uiLanguage });
}

ipcMain.handle('i18n:reload', (e) => {
  e.sender.reload();
  return true;
});

// File → Library Folder…: point NEO at any folder, or back at the default.
// The library is plain files, so the writer moves them; NEO only follows.
async function chooseLibraryFolder() {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const defaultDir = path.join(app.getPath('documents'), 'NEO Library');
  const custom = LIBRARY_DIR !== defaultDir;
  const ask = await dialog.showMessageBox(win, {
    type: 'question',
    message: t('Library folder'),
    detail: t('Your books live in:\n{dir}\n\nChoose another folder and NEO restarts there. Existing books stay where they are — move the files yourself if you want them along.', { dir: LIBRARY_DIR }),
    buttons: custom ? [t('Choose Folder…'), t('Use Default Folder'), t('Cancel')] : [t('Choose Folder…'), t('Cancel')],
    defaultId: 0,
    cancelId: custom ? 2 : 1
  });
  let next = null;
  if (ask.response === 0) {
    const r = await dialog.showOpenDialog(win, {
      title: t('Choose a folder for your NEO library'),
      defaultPath: LIBRARY_DIR,
      properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled || !r.filePaths[0]) return;
    next = r.filePaths[0];
  } else if (custom && ask.response === 1) {
    next = null; // back to the default
  } else {
    return;
  }
  if (next === LIBRARY_DIR) return;
  const settings = readSettings();
  if (next) settings.libraryDir = next; else delete settings.libraryDir;
  writeSettings(settings);
  app.relaunch();
  app.exit(0);
}

// Can NEO write in this folder? Windows' Controlled folder access (Defender's
// ransomware protection) refuses new files in Documents to apps it doesn't
// know, and NEO is one. A small file written and removed tells.
let lastFolderError = null;
function folderWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.neo-write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    lastFolderError = null;
    return true;
  } catch (err) {
    lastFolderError = err;
    logError('library folder not writable: ' + dir, err);
    return false;
  }
}
const isBlockedWrite = (err) => !!err && ['EPERM', 'EACCES', 'EROFS'].includes(err.code);
// a folder that isn't there to write in (not a refusal): a OneDrive folder
// on a computer where OneDrive isn't set up, a drive that's gone
const isMissingFolder = (err) => !!err && ['ENOENT', 'ENOTDIR'].includes(err.code);
function blockedDetail(dir, err) {
  return t('Your books can\'t be saved in:\n{dir}', { dir }) + '\n\n' + (isMissingFolder(err)
    ? t('The folder isn\'t there, or can\'t be reached. A OneDrive folder on a computer where OneDrive isn\'t set up does this. Choose another folder to keep your library in.')
    : process.platform === 'win32'
      ? t('This is usually Windows Security\'s Controlled folder access (Virus & threat protection → Ransomware protection). Allow NEO there, or keep your library in another folder.')
      : t('Check that the folder exists and that NEO may write to it, or keep your library in another folder.'));
}

// Where a first library goes when Documents itself can't hold one. Beside
// Documents, not nowhere: the writer is never left at "Start writing" with
// no way on.
function fallbackLibraryDir() {
  const home = app.getPath('home');
  const spots = [];
  try {
    const docs = path.join(home, 'Documents');
    if (fs.statSync(docs).isDirectory()) spots.push(path.join(docs, 'NEO Library'));
  } catch { /* no plain Documents folder here */ }
  spots.push(path.join(home, 'NEO Library'));
  return spots.find((dir) => dir !== LIBRARY_DIR && folderWritable(dir)) || null;
}
function useLibraryDir(dir) {
  LIBRARY_DIR = dir;
  LIBRARY_FILE = path.join(LIBRARY_DIR, 'library.json');
  // remembered, so a OneDrive that comes back later doesn't swap libraries
  const settings = readSettings();
  settings.libraryDir = LIBRARY_DIR;
  try { writeSettings(settings); } catch (err) { logError('settings', err); }
}
// The writer's own library folder, missing at launch: a drive not plugged
// in, a NAS or cloud folder not mounted yet. Never swapped quietly for the
// default (new books would land there and seem lost when the drive came
// back). Asked once: Try Again once it's there, Choose Folder…, or Continue
// with the default folder for this session only; the choice stays saved.
function isDir(dir) { try { return fs.statSync(dir).isDirectory(); } catch { return false; } }
function awaitChosenLibrary(chosen) {
  const fallback = path.join(app.getPath('documents'), 'NEO Library');
  while (!isDir(chosen)) {
    const r = dialog.showMessageBoxSync({
      type: 'warning',
      message: t('NEO can\'t save in your library folder'),
      detail: blockedDetail(chosen, { code: 'ENOENT' }),
      buttons: [t('Try Again'), t('Choose Folder…'), t('Continue')],
      defaultId: 0,
      cancelId: 2
    });
    if (r === 2) return fallback;
    if (r === 1) {
      const picked = dialog.showOpenDialogSync({
        title: t('Choose a folder for your NEO library'),
        defaultPath: os.homedir(),
        properties: ['openDirectory', 'createDirectory']
      });
      if (picked && picked[0]) { useLibraryDir(picked[0]); return picked[0]; }
    }
  }
  return chosen;
}
// said once, after the window is up, only when it happened
let libraryFallback = null;
function announceLibraryFallback() {
  if (!libraryFallback) return;
  const { to } = libraryFallback;
  libraryFallback = null;
  dialog.showMessageBox({
    type: 'info',
    message: t('NEO is keeping your books in another folder'),
    detail: t('Your Documents folder can\'t be written to, so your books will live in:\n{dir}\n\nFile → Library Folder… changes it.', { dir: to }),
    buttons: [t('OK')]
  }).catch(() => {});
}
// At startup, before any window: a library that can't be written is said
// plainly, once, with a way out — not a hiccup at "Start writing"
function checkLibraryWritable() {
  // (only where it can happen: on Windows, and anywhere before a first
  // library exists; a synced library elsewhere isn't sent a test file
  // every launch)
  if (process.platform !== 'win32' && fs.existsSync(LIBRARY_FILE)) return;
  // A first library that Documents can't hold goes beside it. Never when a
  // library already lives here or the writer picked this folder: their books
  // stay where they are, and the question below is theirs to answer.
  if (!fs.existsSync(LIBRARY_FILE) && !readSettings().libraryDir && !folderWritable(LIBRARY_DIR)) {
    const from = LIBRARY_DIR;
    const spot = fallbackLibraryDir();
    if (spot) {
      useLibraryDir(spot);
      libraryFallback = { from, to: spot };
      return;
    }
  }
  while (!folderWritable(LIBRARY_DIR)) {
    const r = dialog.showMessageBoxSync({
      type: 'warning',
      message: t('NEO can\'t save in your library folder'),
      detail: blockedDetail(LIBRARY_DIR, lastFolderError),
      buttons: [t('Choose Folder…'), t('Try Again'), t('Continue')],
      defaultId: 0,
      cancelId: 2
    });
    if (r === 2) return;
    if (r === 0) {
      const picked = dialog.showOpenDialogSync({
        title: t('Choose a folder for your NEO library'),
        defaultPath: os.homedir(),
        properties: ['openDirectory', 'createDirectory']
      });
      if (!picked || !picked[0]) continue;
      useLibraryDir(picked[0]);
    }
  }
}
// Later on (the protection switched on mid-session), a refused save says so
// once. The words stay on the page; NEO saves them as soon as it may.
let blockedShown = false;
function reportBlockedWrite(err) {
  if (blockedShown || !isBlockedWrite(err)) return;
  // the library's own files only (an export to a protected folder is the
  // export's business)
  const rel = err.path ? path.relative(LIBRARY_DIR, err.path) : '..';
  if (rel.startsWith('..') || path.isAbsolute(rel)) return;
  blockedShown = true;
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const opts = {
    type: 'warning',
    message: t('NEO can\'t save in your library folder'),
    detail: blockedDetail(LIBRARY_DIR, err) + '\n\n' + t('Your words stay on the page until it can.'),
    buttons: [t('OK')]
  };
  (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)).catch(() => {});
}

// A brand-new library starts with one empty shelf. A library.json that has
// gone missing beside its spare copies or its books is not a new library:
// library:read recovers it (from .tmp/.bak, else from the book folders)
// instead of an empty seed hiding every book.
function libraryHasHistory() {
  if (fs.existsSync(LIBRARY_FILE + '.bak') || fs.existsSync(LIBRARY_FILE + '.tmp')) return true;
  try { return fs.readdirSync(LIBRARY_DIR).some((d) => d.startsWith('book-')); } catch { return false; }
}
function ensureLibrary() {
  if (!fs.existsSync(LIBRARY_DIR)) fs.mkdirSync(LIBRARY_DIR, { recursive: true });
  if (!fs.existsSync(LIBRARY_FILE) && !libraryHasHistory()) {
    const seed = {
      authorName: '',
      penNames: [],
      firstRunDone: false,
      pageTheme: 'night',
      shelves: [{ id: 'shelf-1', name: t('Works in Progress'), bookIds: [] }]
    };
    fs.writeFileSync(LIBRARY_FILE, JSON.stringify(seed, null, 2));
  }
}

// Every book, chapter and sidecar name the page sends is one plain name
// inside the library: ".", ".." and path separators never reach the disk.
// Any name NEO ever made passes, and so does a folder named by hand.
function libName(name) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
    throw new Error('Invalid library name');
  }
  return name;
}

function bookDir(bookId) {
  return path.join(LIBRARY_DIR, libName(bookId));
}

// A human-readable map of the library, regenerated on every change:
// which folder is which book, and what shelf it lives on. Sorts to the
// top of the folder so browsing writers can always find their way.
function writeCatalog() {
  try {
    const lib = readJSON(LIBRARY_FILE, { shelves: [] });
    const onShelf = {};
    for (const s of lib.shelves || []) {
      for (const id of s.bookIds) onShelf[id] = s.name;
    }
    const lines = [];
    for (const d of fs.readdirSync(LIBRARY_DIR)) {
      if (!d.startsWith('book-')) continue;
      try {
        const m = JSON.parse(fs.readFileSync(path.join(LIBRARY_DIR, d, 'book.json'), 'utf8'));
        lines.push(`${m.title || t('Untitled')}  —  ${d}  —  ${t('shelf:')} ${onShelf[m.id] || t('(none — removed from shelves)')}`);
      } catch { /* not a valid book folder */ }
    }
    lines.sort((a, b) => a.localeCompare(b));
    const text = t('NEO LIBRARY CATALOG — which folder is which book') + '\n' +
      t('(regenerated automatically; edits here do nothing)') + '\n\n' +
      lines.join('\n') + '\n';
    const file = path.join(LIBRARY_DIR, '_catalog.txt');
    // unchanged, it's left alone: a rewrite on every save is a file for
    // iCloud and Syncthing to send back and forth (and to clash over)
    let old = null;
    try { old = fs.readFileSync(file, 'utf8'); } catch { /* none yet */ }
    if (old !== text) fs.writeFileSync(file, text);
  } catch (err) {
    logError('catalog', err);
  }
}

// Writing that survives the power going out. A new file is written beside
// the old one, pushed all the way to the disk (fsync), and only then swapped
// in. Without the push, a power cut right after the swap can leave the swap
// done and the words not: an empty book.json, and the book gone from its
// shelf (#219). A missing file or an unlucky moment never costs more than
// the last few seconds.
// On Windows the swap is refused while anything else has the file open, even
// for a moment: antivirus looking at what was just written, the search
// indexer, a backup or sync client, a tool reading the library. Wait a beat
// and try again (up to ~0.6 s) before calling the save failed, so a passing
// glance never reaches the writer as "NEO can't save". A folder that really
// refuses writes still fails, and is still explained.
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function renameIntoPlace(from, to) {
  for (let wait = 5; ; wait *= 2) {
    try { return fs.renameSync(from, to); } catch (err) {
      if (process.platform !== 'win32' || wait > 320 || !['EPERM', 'EACCES', 'EBUSY'].includes(err.code)) throw err;
      sleepSync(wait);
    }
  }
}

function writeFileDurable(file, data) {
  const tmp = file + '.tmp';
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const fd = fs.openSync(tmp, 'w');
  try {
    // a write can take less than it was given; keep going until every byte
    // is down, and never swap in a file that's only partly written
    for (let off = 0; off < buf.length;) {
      const n = fs.writeSync(fd, buf, off, buf.length - off);
      if (!(n > 0)) throw Object.assign(new Error('Short write: ' + tmp), { code: 'EIO', path: tmp });
      off += n;
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  renameIntoPlace(tmp, file);
  // the swap itself, on systems that let a folder be pushed too
  if (process.platform !== 'win32') {
    try { const d = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } } catch { /* fine */ }
  }
}

// JSON reads fall back on the copies a write leaves: the .tmp a write was
// making when it stopped, then .bak, the last version that read whole. What
// they recover is put back as the file itself.
function parseJSONFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
}
function readJSON(file, fallback) {
  const main = parseJSONFile(file);
  if (main !== undefined) return main;
  if (!fs.existsSync(file) && !fs.existsSync(file + '.bak') && !fs.existsSync(file + '.tmp')) return fallback;
  for (const spare of [file + '.tmp', file + '.bak']) {
    const v = parseJSONFile(spare);
    if (v === undefined) continue;
    logError('recovered', `${file} was unreadable; restored from ${path.basename(spare)}`);
    try { writeFileDurable(file, JSON.stringify(v, null, 2)); } catch (err) { logError('recover write', err); }
    return v;
  }
  return fallback;
}

function writeJSON(file, data) {
  // the version on disk, while it reads whole, becomes the .bak
  if (parseJSONFile(file) !== undefined) {
    try { fs.copyFileSync(file, file + '.bak'); } catch { /* the write still goes ahead */ }
  }
  writeFileDurable(file, JSON.stringify(data, null, 2));
}

// A book whose book.json is gone for good (and no .bak) still has its
// chapters: the book comes back with them in the order they were made, its
// title from the catalog, rather than vanishing from the shelf.
function rebuildBookMeta(bookId) {
  const dir = bookDir(bookId);
  const chDir = path.join(dir, 'chapters');
  if (!fs.existsSync(chDir)) return null;
  let title = '';
  try {
    const cat = fs.readFileSync(path.join(LIBRARY_DIR, '_catalog.txt'), 'utf8');
    const line = cat.split('\n').find((l) => l.includes('  —  ' + bookId + '  —  '));
    if (line) title = line.split('  —  ')[0].trim();
  } catch { /* no catalog */ }
  const order = fs.readdirSync(chDir).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5)).sort();
  const meta = {
    id: bookId,
    title: title || t('Untitled'),
    subtitle: '', series: '', author: t('Anonymous'), wordGoal: 0,
    created: new Date().toISOString(), modified: new Date().toISOString(),
    chapterOrder: order,
    tabNames: { notes: 'Notes', outline: 'Outline' }
  };
  logError('recovered', `${bookId}/book.json was lost; rebuilt from ${order.length} chapter files`);
  try { writeJSON(path.join(dir, 'book.json'), meta); } catch (err) { logError('recover write', err); }
  return meta;
}

// ---------------------------------------------------------------------------
// IPC — the renderer's whole view of the disk
// ---------------------------------------------------------------------------

ipcMain.handle('library:read', () => {
  ensureLibrary();
  const lib = readJSON(LIBRARY_FILE, null);
  if (lib) return lib;
  // library.json lost with no copy to fall back on: every book in the
  // folder goes onto one shelf, so nothing disappears
  const ids = [];
  try {
    for (const d of fs.readdirSync(LIBRARY_DIR)) {
      if (d.startsWith('book-') && fs.existsSync(path.join(LIBRARY_DIR, d, 'chapters'))) ids.push(d);
    }
  } catch { /* empty */ }
  const seed = { authorName: '', penNames: [], firstRunDone: ids.length > 0, pageTheme: 'night',
    shelves: [{ id: 'shelf-1', name: t('Works in Progress'), bookIds: ids }] };
  logError('recovered', `library.json was lost; ${ids.length} books put back on one shelf`);
  try { writeJSON(LIBRARY_FILE, seed); } catch (err) { logError('recover write', err); }
  return seed;
});

ipcMain.handle('library:write', (_e, data) => {
  ensureLibrary();
  writeJSON(LIBRARY_FILE, data);
  writeCatalog();
  return true;
});

// A book is a folder: book.json + chapters/*.html + notes.html + outline.html + darlings.json
ipcMain.handle('book:create', (_e, meta) => {
  ensureLibrary();
  // folders carry a slug of the title when it's known at creation (imports),
  // so the library reads like a bookshelf in Finder too. Accents come off
  // first, so "Capítulo" reads "capitulo", not "cap-tulo"
  const slug = String(meta.title || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const id = 'book-' + (slug ? slug + '-' : '') +
    Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const dir = bookDir(id);
  fs.mkdirSync(path.join(dir, 'chapters'), { recursive: true });
  const book = {
    id,
    title: meta.title || t('Untitled'),
    subtitle: '',
    series: '',
    author: meta.author || t('Anonymous'),
    wordGoal: 0,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    chapterOrder: [],
    tabNames: { notes: 'Notes', outline: 'Outline' } // shown translated (see tabName in app.js)
  };
  writeJSON(path.join(dir, 'book.json'), book);
  fs.writeFileSync(path.join(dir, 'notes.html'), '');
  fs.writeFileSync(path.join(dir, 'outline.html'), '');
  writeJSON(path.join(dir, 'darlings.json'), []);
  writeJSON(path.join(dir, 'stickies.json'), []);
  return book;
});

// A copy of a book, for a backup or a version to play with: every file in
// its folder (chapters, notes, darlings, covers) written whole into a new
// folder, then its book.json under the new id and title. A half-made copy
// is removed; the original is only ever read.
ipcMain.handle('book:duplicate', (_e, bookId, title) => {
  ensureLibrary();
  const src = bookDir(bookId);
  const meta = readJSON(path.join(src, 'book.json'), null);
  if (!meta) throw new Error('That book could not be read');
  const slug = String(title || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const id = 'book-' + (slug ? slug + '-' : '') +
    Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const dest = bookDir(id);
  // a chapter iCloud hasn't brought down yet would be missing from the copy
  const waiting = (dir) => fs.readdirSync(dir, { withFileTypes: true }).some((e) => (e.isDirectory() ? waiting(path.join(dir, e.name)) : /\.icloud$/.test(e.name)));
  if (waiting(src)) throw new Error('Some of this book is still downloading from iCloud. Try again in a moment');
  const copyDir = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
      // (a write caught halfway, a spare copy, a placeholder: not the book)
      if (/\.(tmp|bak|icloud)$/.test(ent.name) || ent.name === 'book.json') continue;
      const a = path.join(from, ent.name);
      const b = path.join(to, ent.name);
      if (ent.isDirectory()) copyDir(a, b);
      else if (ent.isFile()) writeFileDurable(b, fs.readFileSync(a));
    }
  };
  try {
    copyDir(src, dest);
    const now = new Date().toISOString();
    const copy = { ...meta, id, title: title || meta.title, created: now, modified: now };
    delete copy.uuid; // an ebook store sees a new book
    writeJSON(path.join(dest, 'book.json'), copy);
    writeCatalog();
    return copy;
  } catch (err) {
    logError('duplicate', err);
    try { fs.rmSync(dest, { recursive: true, force: true }); } catch { /* left for the writer */ }
    throw err;
  }
});

// every book folder in the library, shelved or not — for File → Reshelve
ipcMain.handle('library:listBooks', () => {
  const out = [];
  try {
    for (const d of fs.readdirSync(LIBRARY_DIR)) {
      if (!d.startsWith('book-')) continue;
      const m = readJSON(path.join(LIBRARY_DIR, d, 'book.json'), null);
      // the folder is the book: a copied folder ("book-x copy") is its own
      // book, even though the book.json inside still names the original
      if (m && m.id) out.push({ id: d, title: m.title || t('Untitled'), author: m.author || '', modified: m.modified || '', kind: m.kind || '' });
    }
  } catch (err) { logError('listBooks', err); }
  return out;
});

ipcMain.handle('book:readMeta', (_e, bookId) => {
  const dir = bookDir(bookId);
  const meta = readJSON(path.join(dir, 'book.json'), null);
  if (meta) {
    if (meta.id !== bookId) meta.id = bookId; // a copied folder answers to its own name
    return meta;
  }
  // iCloud (on older macOS) holds a file it hasn't downloaded as
  // ".book.json.icloud": the book is there, just not here yet. Rebuilding
  // it would put a bare book.json over the real one.
  if (fs.existsSync(path.join(dir, '.book.json.icloud'))) return null;
  return rebuildBookMeta(bookId);
});

ipcMain.handle('book:writeMeta', (_e, bookId, meta) => {
  meta.modified = new Date().toISOString();
  writeJSON(path.join(bookDir(bookId), 'book.json'), meta);
  writeCatalog();
  return meta.modified;
});

// {chapterId: mtime and size} for a book's chapter files — how refreshFromDisk
// tells what changed without re-reading every chapter. The size is there
// because sync tools hand over the other device's mtime, and on disks that
// keep whole seconds two saves a second apart would otherwise look the same.
ipcMain.handle('chapter:stamps', (_e, bookId) => {
  const out = {};
  try {
    const dir = path.join(bookDir(bookId), 'chapters');
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.html')) continue;
      try {
        const st = fs.statSync(path.join(dir, f));
        out[f.slice(0, -5)] = st.mtimeMs + ':' + st.size;
      } catch { /* vanished */ }
    }
  } catch { /* no chapters folder yet */ }
  return out;
});

ipcMain.handle('chapter:read', (_e, bookId, chapterId) => {
  const file = path.join(bookDir(bookId), 'chapters', libName(chapterId) + '.html');
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
});

// `expected` is the text the window last read or wrote for this chapter.
// When the file holds something else (another device wrote it since, and
// it isn't just an older copy of these words), nothing is written: the
// window is handed that text to keep as its own chapter first, so neither
// version is lost to a save that happened before the next look at the disk.
ipcMain.handle('chapter:write', (_e, bookId, chapterId, html, expected) => {
  const dir = path.join(bookDir(bookId), 'chapters');
  const file = path.join(dir, libName(chapterId) + '.html');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (typeof expected === 'string') {
    let cur = null;
    try { cur = fs.readFileSync(file, 'utf8'); } catch { /* not there: nothing to keep */ }
    if (cur !== null && chapterDiverged(cur, expected, html)) return { conflict: cur };
  }
  writeFileDurable(file, html);
  return true;
});
// shared with Pocket's bridge (same rule): the disk copy differs from what
// this device last knew, holds words, and has a word the new text lacks
function chapterDiverged(cur, expected, html) {
  if (cur === expected || cur === html) return false;
  const bag = (h) => {
    const m = new Map();
    for (const w of String(h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').split(/\s+/)) if (w) m.set(w, (m.get(w) || 0) + 1);
    return m;
  };
  const there = bag(cur);
  if (!there.size) return false;
  const here = bag(html);
  for (const [w, n] of there) if (n > (here.get(w) || 0)) return true;
  return false;
}

ipcMain.handle('chapter:delete', (_e, bookId, chapterId) => {
  const file = path.join(bookDir(bookId), 'chapters', libName(chapterId) + '.html');
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return true;
});

ipcMain.handle('aux:read', (_e, bookId, name) => {
  // name: 'notes' | 'outline'
  const file = path.join(bookDir(bookId), libName(name) + '.html');
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
});

ipcMain.handle('aux:write', (_e, bookId, name, html) => {
  writeFileDurable(path.join(bookDir(bookId), libName(name) + '.html'), html);
  return true;
});

// macOS only: the system dictionary panel for the word selected in the window (#179). Other
// platforms have no equivalent, and the renderer only offers the menu item on darwin.
ipcMain.handle('app:lookUp', (e) => {
  if (process.platform === 'darwin' && e.sender.showDefinitionForSelection) {
    e.sender.showDefinitionForSelection();
  }
  return true;
});

ipcMain.handle('json:read', (_e, bookId, name, fallback) => {
  return readJSON(path.join(bookDir(bookId), libName(name) + '.json'), fallback);
});

ipcMain.handle('json:write', (_e, bookId, name, data) => {
  writeJSON(path.join(bookDir(bookId), libName(name) + '.json'), data);
  return true;
});

ipcMain.handle('book:delete', async (_e, bookId, title) => {
  const win = BrowserWindow.getFocusedWindow();
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: [t('Cancel'), process.platform === 'win32' ? t('Move to Recycle Bin') : t('Move to Trash')],
    defaultId: 0,
    cancelId: 0,
    message: process.platform === 'win32' ? t('Move “{title}” to the Recycle Bin?', { title }) : t('Move “{title}” to the Trash?', { title }),
    detail: t('The book folder goes to your system trash, so you can recover it.')
  });
  if (response === 1) {
    const { shell } = require('electron');
    try {
      await shell.trashItem(bookDir(bookId));
      return true;
    } catch (err) {
      // Some filesystems have no Trash (network mounts, odd drives).
      // Words are never lost: leave the book alone and show the writer where it lives.
      logError('trash', err);
      shell.showItemInFolder(bookDir(bookId));
      dialog.showMessageBox(win, {
        message: t('NEO couldn’t move that folder to the Trash.'),
        detail: t('The book is untouched. Its folder is highlighted so you can deal with it yourself.')
      });
      return false;
    }
  }
  return false;
});

// ---------------------------------------------------------------------------
// Cover art: images live inside the book's folder, so covers travel with
// the library. Timestamped filenames sidestep every caching gremlin.
// ---------------------------------------------------------------------------

const COVER_EXTS = ['png', 'jpg', 'jpeg', 'webp'];

ipcMain.handle('library:path', () => LIBRARY_DIR);

ipcMain.handle('cover:pick', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: t('Choose cover art'),
    properties: ['openFile'],
    filters: [{ name: t('Images'), extensions: COVER_EXTS }]
  });
  return canceled || !filePaths.length ? null : filePaths[0];
});

function clearCovers(dir) {
  for (const f of fs.readdirSync(dir)) {
    if (/^cover-\d+\./.test(f)) fs.unlinkSync(path.join(dir, f));
  }
}

ipcMain.handle('cover:set', (_e, bookId, srcPath) => {
  const ext = path.extname(srcPath).toLowerCase().replace('.', '');
  if (!COVER_EXTS.includes(ext)) return null;
  const dir = bookDir(bookId);
  if (!fs.existsSync(dir)) return null;
  // the new cover is copied in before the old ones go (the picked file may
  // be one of them)
  const fname = 'cover-' + Date.now() + '.' + (ext === 'jpeg' ? 'jpg' : ext);
  fs.copyFileSync(srcPath, path.join(dir, fname));
  for (const f of fs.readdirSync(dir)) {
    if (/^cover-\d+\./.test(f) && f !== fname) fs.unlinkSync(path.join(dir, f));
  }
  return fname;
});

ipcMain.handle('cover:remove', (_e, bookId) => {
  const dir = bookDir(bookId);
  if (fs.existsSync(dir)) clearCovers(dir);
  return true;
});

ipcMain.handle('cover:read', (_e, bookId, fname) => {
  try {
    if (!/^(cover|art)-\d+\.(png|jpg|webp)$/.test(fname)) return null;
    const buf = fs.readFileSync(path.join(bookDir(bookId), fname));
    const ext = path.extname(fname).slice(1);
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return { base64: buf.toString('base64'), mime, ext };
  } catch {
    return null;
  }
});

// ---------------------------------------------------------------------------
// Painted covers: once a story passes a thousand words, NEO reads it and
// paints an abstract cover (art.js). The API key lives encrypted in the
// app's own data folder — never in the library, which gets synced and
// backed up as plain files.
// ---------------------------------------------------------------------------

const SECRETS_FILE = () => path.join(app.getPath('userData'), 'secrets.json');

function readSecret(name) {
  try {
    const { safeStorage } = require('electron');
    const all = readJSON(SECRETS_FILE(), {});
    if (!all[name]) return null;
    if (all[name].enc && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(all[name].value, 'base64'));
    }
    return all[name].value;
  } catch (err) {
    logError('secret', err);
    return null;
  }
}

ipcMain.handle('secret:set', (_e, name, value) => {
  const { safeStorage } = require('electron');
  const all = readJSON(SECRETS_FILE(), {});
  if (!value) {
    delete all[name];
  } else if (safeStorage.isEncryptionAvailable()) {
    all[name] = { enc: true, value: safeStorage.encryptString(String(value)).toString('base64') };
  } else {
    all[name] = { enc: false, value: String(value) };
  }
  writeJSON(SECRETS_FILE(), all);
  return true;
});

ipcMain.handle('secret:has', (_e, name) => !!readSecret(name));

// One painting at a time per book; a second request while one is running
// simply gets the running one's answer.
const paintJobs = new Map();

ipcMain.handle('cover:paint', (_e, bookId, text, options) => {
  if (paintJobs.has(bookId)) return paintJobs.get(bookId);
  const job = (async () => {
    const provider = (options && options.provider) || 'openai';
    const apiKey = readSecret(provider);
    if (!apiKey) return { error: t('No API key for {provider} — add one under File → Cover Art…', { provider }) };
    const dir = bookDir(bookId);
    if (!fs.existsSync(dir)) return { error: t('Book folder is missing') };
    try {
      const art = require('./art.js');
      const out = await art.paintCover({
        provider,
        apiKey,
        text: String(text || ''),
        textModel: options && options.textModel,
        imageModel: options && options.imageModel,
        quality: options && options.quality
      });
      // sweep older paintings; the writer's own cover-*.png files are untouched
      for (const f of fs.readdirSync(dir)) {
        if (/^art-\d+\.(png|jpg|webp)$/.test(f)) fs.unlinkSync(path.join(dir, f));
      }
      const fname = 'art-' + Date.now() + '.' + (out.ext || 'jpg');
      fs.writeFileSync(path.join(dir, fname), out.buffer);
      // the brief sits beside the picture, so a future repaint can start from it
      writeJSON(path.join(dir, 'art.json'), {
        file: fname,
        brief: out.brief,
        provider,
        textModel: out.textModel,
        imageModel: out.imageModel,
        painted: new Date().toISOString()
      });
      return { file: fname, brief: out.brief };
    } catch (err) {
      logError('paint', err);
      return { error: String((err && err.message) || err) };
    }
  })();
  paintJobs.set(bookId, job);
  job.finally(() => paintJobs.delete(bookId));
  return job;
});

// ---------------------------------------------------------------------------
// Fullscreen
// ---------------------------------------------------------------------------

// ⌘Enter / Ctrl+Enter toggles fullscreen
ipcMain.handle('fullscreen:toggle', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.setFullScreen(!win.isFullScreen());
  return true;
});

// Regular fullscreen: Esc walks you out like any civilized app
ipcMain.handle('fullscreen:escape', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && win.isFullScreen()) {
    win.setFullScreen(false);
    return true;
  }
  return false;
});

// ---------------------------------------------------------------------------
// Export + email
// ---------------------------------------------------------------------------

// A script prints on US letter whatever the country (the industry's page),
// with the margins laid out in the page itself
const SCREENPLAY_PRINT = { pageSize: 'Letter', margins: { top: 0, bottom: 0, left: 0, right: 0 }, printBackground: false, preferCSSPageSize: true, generateTaggedPDF: true, generateDocumentOutline: false };
// Letter is a habit of the Americas (and the Philippines); most of the world
// prints A4. The computer's region decides, for the PDF and the Word file
// alike. (A script is Letter everywhere: SCREENPLAY_PRINT.)
const LETTER_COUNTRIES = ['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT', 'CR', 'PA', 'DO', 'PR', 'SV', 'HN', 'NI', 'BZ'];
function paperSize() {
  let cc = '';
  try { cc = app.getLocaleCountryCode() || ''; } catch { /* unknown */ }
  return LETTER_COUNTRIES.includes(cc.toUpperCase()) ? 'Letter' : 'A4';
}
ipcMain.on('paper:get', (e) => { e.returnValue = paperSize(); });

// Exports open where the writer last saved one, on this computer (kept in
// settings.json; the first time, Documents)
function exportFolder() {
  const kept = readSettings().exportFolder;
  try { if (kept && fs.statSync(kept).isDirectory()) return kept; } catch { /* gone: an unplugged drive */ }
  return path.join(os.homedir(), 'Documents');
}
function rememberExportFolder(file) {
  try {
    const dir = path.dirname(file);
    if (readSettings().exportFolder !== dir) writeSettings({ ...readSettings(), exportFolder: dir });
  } catch (err) { logError('settings', err); }
}

async function renderPDF(html, print) {
  // The book reaches the PDF printer as a file, not as a data: URL. A URL
  // stops at 2 MB, and a long novel is bigger than that once it's encoded; a
  // book in Russian or Chinese gets there far sooner, because every letter
  // becomes six to nine characters. Past that the export (and ⌘E) saved
  // nothing at all.
  const tmp = path.join(app.getPath('temp'), `neo-print-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  const options = print === 'screenplay' ? SCREENPLAY_PRINT : {
    pageSize: paperSize(),
    margins: { top: 1, bottom: 1, left: 1, right: 1 },
    printBackground: false,
    // chapter headings become the PDF's bookmarks, for jumping around in
    // Preview or Acrobat, and the text is tagged for screen readers
    generateTaggedPDF: true,
    generateDocumentOutline: true
  };
  try {
    await pdfWin.loadFile(tmp);
    let pdf = await pdfWin.webContents.printToPDF(options);
    // A book's contents page can't know its page numbers until the book has
    // been printed once: read where each entry landed from that printing,
    // write the numbers in, and print again. Each number has a fixed width
    // on the page, so nothing moves between the two printings.
    if (html.includes('class="toc-pg"')) {
      const pages = pdfAnchorPages(pdf);
      // page 1 is the story's first page; the ones before it aren't counted
      const p1 = /data-p1="([A-Za-z0-9_-]+)"/.exec(html);
      const skip = p1 && pages[p1[1]] ? pages[p1[1]] - 1 : 0;
      for (const k of Object.keys(pages)) pages[k] = pages[k] - skip > 0 ? pages[k] - skip : '';
      if (Object.keys(pages).length) {
        await pdfWin.webContents.executeJavaScript(`(() => {
          const pages = ${JSON.stringify(pages)};
          for (const el of document.querySelectorAll('.toc-pg')) el.textContent = pages[el.dataset.for] || '';
        })()`);
        pdf = await pdfWin.webContents.printToPDF(options);
      }
    }
    return pdf;
  } finally {
    pdfWin.destroy();
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
  }
}

// The page each link target starts on (1 for the first page), read from a
// PDF Chromium just printed. Skia writes the file's objects as plain text
// (only page contents are compressed) and lists every linked-to anchor in
// the catalog's /Dests, so the cross-reference table leads straight to them.
// Anything laid out otherwise gives {}, and the contents go without numbers.
function pdfAnchorPages(buf) {
  try {
    const s = buf.toString('latin1');
    const sx = s.lastIndexOf('startxref');
    const xref = parseInt(s.slice(sx + 9, sx + 40).trim(), 10);
    const head = /^xref\s+(\d+)\s+(\d+)\s*?[\r\n]+/.exec(s.slice(xref, xref + 64));
    const root = /\/Root (\d+) 0 R/.exec(s.slice(Math.max(0, sx - 4000), sx));
    if (!head || !root) return {};
    const first = +head[1];
    const count = +head[2];
    const table = xref + head[0].length;
    const obj = (n) => {
      if (n - first < 0 || n - first >= count) return '';
      const at = parseInt(s.substr(table + (n - first) * 20, 10), 10);
      return s.slice(at, s.indexOf('endobj', at));
    };
    const catalog = obj(+root[1]);
    const pagesRef = /\/Pages (\d+) 0 R/.exec(catalog);
    const destsRef = /\/Dests (\d+) 0 R/.exec(catalog);
    if (!pagesRef || !destsRef) return {};
    const order = [];
    const walk = (n, depth) => {
      const o = obj(n);
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(o);
      if (/\/Type\s*\/Pages\b/.test(o) && kids && depth < 32) {
        for (const k of kids[1].matchAll(/(\d+) 0 R/g)) walk(+k[1], depth + 1);
      } else order.push(n);
    };
    walk(+pagesRef[1], 0);
    const index = new Map(order.map((n, i) => [n, i + 1]));
    const out = {};
    for (const m of obj(+destsRef[1]).matchAll(/\/([A-Za-z0-9_.-]+)\s*\[\s*(\d+) 0 R/g)) {
      if (index.has(+m[2])) out[m[1]] = index.get(+m[2]);
    }
    return out;
  } catch {
    return {};
  }
}

// zipEntries: [{path, content, base64?, store?}] — order matters (EPUB mimetype first)
async function buildZip(zipEntries) {
  const JSZip = require('jszip');
  const zip = new JSZip();
  for (const e of zipEntries) {
    zip.file(e.path, e.base64 ? Buffer.from(e.content, 'base64') : e.content, {
      compression: e.store ? 'STORE' : 'DEFLATE'
    });
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    mimeType: 'application/epub+zip'
  });
}

ipcMain.handle('export:save', async (_e, { format, defaultName, content, zipEntries, base64, print }) => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(exportFolder(), defaultName + '.' + format),
    filters: [{ name: format.toUpperCase(), extensions: [format] }]
  });
  if (canceled || !filePath) return null;
  rememberExportFolder(filePath);
  try {
    if (zipEntries) {
      fs.writeFileSync(filePath, await buildZip(zipEntries));
    } else if (base64) {
      // pictures (a saved cover) arrive as base64
      fs.writeFileSync(filePath, Buffer.from(content, 'base64'));
    } else if (format === 'pdf') {
      fs.writeFileSync(filePath, await renderPDF(content, print));
    } else {
      fs.writeFileSync(filePath, content, 'utf8');
    }
  } catch (err) {
    // Main-process export failures used to vanish: the renderer saw a bare
    // rejection and nothing reached neo-errors.log. Log it here, and hand the
    // renderer a sentence it can show the writer.
    logError('export save', err);
    throw new Error('Could not write the file (' + ((err && err.message) || err) + ')');
  }
  return filePath;
});

// ---------------------------------------------------------------------------
// Paperback for KDP: a print-ready interior PDF and a cover template sized
// to it. The window builds the book's HTML (app.js, PRINT BOOK); this lays
// it out in pages with Paged.js (print/), checks it against KDP's rules,
// and prints both files.
// ---------------------------------------------------------------------------

// KDP's trim sizes NEO offers (inches), its paper (spine thickness per page),
// and its minimum inside margin by page count. kdp.amazon.com, Oct 2026.
const KDP_TRIMS = { '5x8': [5, 8], '5.25x8': [5.25, 8], '5.5x8.5': [5.5, 8.5], '6x9': [6, 9] };
const KDP_PAPER = { white: 0.002252, cream: 0.0025, groundwood: 0.00235 };
const KDP_MAX_PAGES = { white: 828, cream: 776, groundwood: 812 };
function kdpGutterMin(pages) {
  return pages <= 150 ? 0.375 : pages <= 300 ? 0.5 : pages <= 500 ? 0.625 : pages <= 700 ? 0.75 : 0.875;
}
// the inside margin NEO sets: KDP's minimum plus a quarter inch, so words
// never run into the fold
function kdpGutter(pages) { return kdpGutterMin(pages) + 0.25; }

// Soft hyphens where the language allows a break, so a justified line
// hyphenates the same on every computer (Chromium hyphenates by itself only
// on a Mac). Never in a capitalised word (names), never fewer than three
// letters either side, and not in a paragraph's last word.
const HYPHEN_LANGS = { en: 'en-us', 'en-gb': 'en-gb', 'en-au': 'en-gb', fr: 'fr', es: 'es', de: 'de-1996', nl: 'nl', pl: 'pl', pt: 'pt', ro: 'ro', ru: 'ru', el: 'el-monoton', hu: 'hu', it: 'it' };
const hyphenators = {};
function hyphenatorFor(lang) {
  const code = String(lang || 'en').toLowerCase();
  const key = HYPHEN_LANGS[code] || HYPHEN_LANGS[code.split('-')[0]];
  if (!key) return null;
  if (!(key in hyphenators)) {
    try {
      const create = require('./print/hyphen/hyphen.js');
      hyphenators[key] = create(require('./print/hyphen/patterns/' + key + '.js'), { hyphenChar: '­', minWordLength: 6 });
    } catch (err) { logError('hyphen ' + key, err); hyphenators[key] = null; }
  }
  return hyphenators[key];
}
function hyphenateWord(word, hy, nouns) {
  // a capital is a name, so the word stays whole; except in German, where
  // every noun has one
  if (!nouns && /^\p{Lu}/u.test(word)) return word;
  const h = hy(word);
  if (h === word) return word;
  let out = '';
  let at = 0; // letters so far
  const letters = word.length;
  for (const ch of h) {
    if (ch === '­') { if (at >= 3 && letters - at >= 3) out += ch; continue; }
    out += ch;
    at++;
  }
  return out;
}
function hyphenateHtml(html, lang) {
  const hy = hyphenatorFor(lang);
  if (!hy) return html;
  const nouns = /^de\b/i.test(String(lang || ''));
  // only the paragraphs app.js marked .hy (prose), text between tags only
  return html.replace(/(<p\b[^>]*\bclass="[^"]*\bhy\b[^"]*"[^>]*>)([\s\S]*?)(<\/p>)/g, (m, open, inner, close) => {
    const parts = inner.split(/(<[^>]+>|&[#\w]+;)/);
    // the last word of the paragraph keeps its hyphens out of the last line
    let lastText = -1;
    parts.forEach((part, i) => { if (i % 2 === 0 && /\p{L}/u.test(part)) lastText = i; });
    return open + parts.map((part, i) => {
      if (i % 2 === 1) return part;
      const words = part.split(/([\p{L}\p{M}]+)/u);
      let lastWord = -1;
      if (i === lastText) words.forEach((w, k) => { if (k % 2 === 1) lastWord = k; });
      return words.map((w, k) => (k % 2 === 1 && k !== lastWord && w.length >= 6 ? hyphenateWord(w, hy, nouns) : w)).join('');
    }).join('') + close;
  });
}

// Lays a book out in pages and prints it. The window must be drawing (an
// offscreen one is): Paged.js steps through animation frames, and a hidden
// window stops them, which would leave the book a page short.
async function renderPaged(html, { width, height, plain = false }) {
  const tmp = path.join(app.getPath('temp'), `neo-paged-${process.pid}-${Date.now()}.html`);
  const paged = plain ? '' : fs.readFileSync(path.join(__dirname, 'print', 'paged.polyfill.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  // (a page drawn as it stands, like the cover template, isn't laid out).
  // Spliced in by position, not by replace(): the library's own code holds
  // "$&"-style sequences and tags of its own.
  const at = (s, tag, last) => (last ? s.lastIndexOf(tag) : s.indexOf(tag));
  const splice = (s, tag, add, last) => { const i = at(s, tag, last); return i < 0 ? s + add : s.slice(0, i) + add + s.slice(i); };
  let page = html;
  // (page 1 is the page that holds .pg1, the story's first: each page's
  // number is set on it outright, which Chromium follows where Paged.js's
  // own counter reset doesn't carry past that page)
  if (plain) {
    page = splice(page, '</body>', '<script>window.__neoPages = 1;</script>', true);
  } else {
    page = splice(page, '</body>', '<script>window.PagedPolyfill.preview().then(() => { const pp = [...document.querySelectorAll(".pagedjs_page")]; const s = pp.findIndex((p) => p.querySelector(".pg1:not([data-split-from])")); if (s >= 0) pp.forEach((p, i) => { p.style.counterReset = "page " + (i >= s ? i - s + 1 : 0); p.style.counterIncrement = "none"; }); window.__neoPages = pp.length; }, (e) => { window.__neoPagedError = String(e && e.stack || e); });</script>', true);
    page = splice(page, '</head>', '<script>window.PagedConfig = { auto: false };</script><script>' + paged + '</script>', false);
  }
  fs.writeFileSync(tmp, page, 'utf8');
  const win = printWindow();
  win.setContentSize(Math.round(width * 96), Math.round(height * 96));
  // a step that never answers (a stuck or crashed page) ends the export, not hangs it
  const within = (ms, p) => {
    let timer;
    const late = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Page layout stopped answering')), ms); });
    return Promise.race([p, late]).finally(() => clearTimeout(timer));
  };
  try {
    await within(60000, win.loadFile(tmp));
    const started = Date.now();
    let pages = 0;
    // a long novel takes Paged.js a while: up to ten minutes before giving up
    while (Date.now() - started < 10 * 60 * 1000) {
      if (win.isDestroyed() || win.webContents.isCrashed()) throw new Error('Page layout stopped');
      const st = await within(60000, win.webContents.executeJavaScript('[window.__neoPages || 0, window.__neoPagedError || ""]'));
      if (st[1]) throw new Error('Page layout failed: ' + st[1].split('\n')[0]);
      if (st[0]) { pages = st[0]; break; }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!pages) throw new Error('Page layout took too long');
    // (the size given outright, not through CSS: Chromium rounds a CSS page
    // to its pixel grid, and KDP checks a cover's size to the hundredth)
    const pdf = await within(120000, win.webContents.printToPDF({
      pageSize: { width, height }, preferCSSPageSize: false, printBackground: true, margins: { marginType: 'none' },
      generateTaggedPDF: false, generateDocumentOutline: false
    }));
    return { pdf: exactPageBox(pdf, width, height), pages };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
  }
}
// Chromium rounds a printed page to the nearest hundredth of an inch; KDP
// wants a cover to the thousandth (11.635 in, not 11.64). The page's box is
// written back exact, in the same number of bytes, so the PDF's index of
// where each object starts stays true.
function exactPageBox(pdf, widthIn, heightIn) {
  const s = pdf.toString('latin1');
  const fit = (value, old) => {
    let out = value.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
    if (out.length > old.length) out = value.toFixed(Math.max(0, old.length - String(Math.floor(value)).length - 1));
    if (out.length > old.length) return old;
    if (out.length < old.length) out = out.includes('.') ? out.padEnd(old.length, '0') : (out + '.').padEnd(old.length, '0');
    return out;
  };
  const fixed = s.replace(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g, (m, w, h) => `/MediaBox [0 0 ${fit(widthIn * 72, w)} ${fit(heightIn * 72, h)}]`);
  return Buffer.from(fixed, 'latin1');
}

// One window does all the laying out of an export (the passes and the
// cover): an offscreen window opened right after another one closed can
// fail to load. It's closed when the export is done, so it never keeps NEO
// running or stands in for the writing window.
let printWin = null;
function closePrintWindow() {
  if (printWin && !printWin.isDestroyed()) printWin.destroy();
  printWin = null;
}
function printWindow() {
  if (!printWin || printWin.isDestroyed()) {
    printWin = new BrowserWindow({
      show: false, width: 600, height: 800,
      webPreferences: { sandbox: true, offscreen: true, backgroundThrottling: false }
    });
  }
  return printWin;
}

// The cover template: the whole wrap (back, spine, front) at KDP's size for
// this page count, with the bleed, the trim, the spine, the safe areas and
// the barcode's place drawn in, each labelled. A designer works on top of it.
function kdpCoverHtml({ trim, paper, pages, title, author }) {
  const [tw, th] = KDP_TRIMS[trim];
  const bleed = 0.125;
  const spine = pages * KDP_PAPER[paper];
  const W = bleed + tw + spine + tw + bleed;
  const H = bleed + th + bleed;
  const inch = (n) => n.toFixed(4) + 'in';
  const box = (x, y, w, h, cls, label = '') => `<div class="${cls}" style="left:${inch(x)};top:${inch(y)};width:${inch(w)};height:${inch(h)}">${label}</div>`;
  const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fmt = (n) => n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  const mm = (n) => (n * 25.4).toFixed(1);
  const backX = bleed;
  const spineX = bleed + tw;
  const frontX = bleed + tw + spine;
  const safe = 0.125;
  const spineText = pages >= 79;
  const paperName = { white: t('white paper'), cream: t('cream paper'), groundwood: t('groundwood paper') }[paper];
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page { size: ${inch(W)} ${inch(H)}; margin: 0; }
html, body { margin: 0; padding: 0; }
body { width: ${inch(W)}; height: ${inch(H)}; position: relative; overflow: hidden; font: 8pt/1.35 -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #1f4f8a; background: #fff; }
div { position: absolute; box-sizing: border-box; }
.bleed { background: #f6d5d5; }
.trim { border: 1px solid #c0392b; background: #fff; }
.spine { background: #eef3fa; border-left: 1px solid #1f4f8a; border-right: 1px solid #1f4f8a; }
.safe { border: 1px dashed #1f4f8a; }
.spinesafe { border-left: 1px dashed #1f4f8a; border-right: 1px dashed #1f4f8a; }
.barcode { background: #fff7d6; border: 1px solid #b7950b; color: #7d6608; display: flex; align-items: center; justify-content: center; text-align: center; padding: 0.08in; }
.lbl { padding: 0.06in; }
.panel { display: flex; align-items: center; justify-content: center; text-align: center; color: #9fb4cf; font-size: 20pt; letter-spacing: 0.12em; }
.info { color: #1f4f8a; }
.vert { writing-mode: vertical-rl; display: flex; align-items: center; justify-content: center; text-align: center; color: #1f4f8a; font-size: 7pt; }
</style></head><body>
${box(0, 0, W, H, 'bleed')}
${box(bleed, bleed, W - 2 * bleed, H - 2 * bleed, 'trim')}
${box(spineX, bleed, spine, th, 'spine')}
${box(backX + safe, bleed + safe, tw - 2 * safe, th - 2 * safe, 'safe')}
${box(frontX + safe, bleed + safe, tw - 2 * safe, th - 2 * safe, 'safe')}
${spine > 0.125 ? box(spineX + 0.0625, bleed + safe, spine - 0.125, th - 2 * safe, 'spinesafe') : ''}
${box(backX, bleed, tw, th, 'panel', esc(t('BACK COVER')))}
${box(frontX, bleed, tw, th, 'panel', esc(t('FRONT COVER')))}
${box(backX + tw - 0.25 - 2, bleed + th - 0.25 - 1.2, 2, 1.2, 'barcode', esc(t('Barcode area (KDP adds it here)')) + '<br>2 × 1.2 in')}
${box(frontX + safe + 0.05, bleed + safe + 0.05, tw - 2 * safe - 0.1, 1.6, 'lbl info', `<b>${esc(title)}</b>${author ? ' · ' + esc(author) : ''}<br>
${esc(t('Full cover: {w} × {h} in ({wmm} × {hmm} mm), bleed included', { w: fmt(W), h: fmt(H), wmm: mm(W), hmm: mm(H) }))}<br>
${esc(t('Trim: {w} × {h} in · {pages} pages · {paper}', { w: fmt(tw), h: fmt(th), pages, paper: paperName }))}<br>
${esc(t('Spine: {s} in ({smm} mm)', { s: fmt(spine), smm: mm(spine) }))}${spineText ? '' : ' · ' + esc(t('under 79 pages: no text on the spine'))}<br>
<span style="color:#c0392b">${esc(t('Pink: bleed, cut off. Red line: trim.'))}</span> ${esc(t('Dashed: keep text inside.'))}<br>
${esc(t('Use this page as a guide layer and hide it before you export your cover: one PDF, at least 300 DPI.'))}</div>`)}
${spine > 0.3 ? box(spineX, bleed, spine, th, 'vert', esc(t('SPINE'))) : ''}
</body></html>`;
}

// The window hands over the book's HTML with the inside margin left as a
// mark (__NEO_GUTTER__), since it depends on the page count. The book is
// laid out, the count checked against the margin it was set with (and laid
// out again if it crossed into another of KDP's bands), evened up to end on
// a left-hand page, then saved with its cover template beside it.
let paperbackBusy = false;
ipcMain.handle('print:paperback', async (_e, job) => {
  // one at a time: they share the print window
  if (paperbackBusy) throw new Error('Another paperback is still being set');
  paperbackBusy = true;
  try {
    return await makePaperback(job);
  } finally {
    paperbackBusy = false;
    closePrintWindow();
  }
});
async function makePaperback({ html, trim, paper, pagesGuess, title, author, defaultName, language }) {
  if (!KDP_TRIMS[trim] || !KDP_PAPER[paper]) throw new Error('Unknown trim size or paper');
  const [tw, th] = KDP_TRIMS[trim];
  const win = BrowserWindow.getFocusedWindow();
  const hyphenated = hyphenateHtml(html, language);
  // The margin only ever widens (a wider one than KDP asks is fine, a
  // narrower one is refused), and the blank page goes in or out to even
  // the count, so this settles in a few passes.
  let gutter = kdpGutter(Math.max(24, pagesGuess || 200));
  let result = null;
  let pad = false;
  let settled = false;
  for (let pass = 0; pass < 10 && !settled; pass++) {
    const page = hyphenated.replace(/__NEO_GUTTER__/g, gutter.toFixed(3) + 'in')
      .replace('</body>', pad ? '<div class="neo-pad"></div></body>' : '</body>');
    result = await renderPaged(page, { width: tw, height: th });
    if (kdpGutter(result.pages) > gutter) gutter = kdpGutter(result.pages);
    // an odd count ends on a right-hand page: one blank page in (or out) evens it
    else if (result.pages % 2 === 1) pad = !pad;
    else settled = true;
  }
  if (!settled) throw new Error('The page count would not settle');
  const pages = result.pages;
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(exportFolder(), defaultName + '.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return null;
  rememberExportFolder(filePath);
  const coverPath = filePath.replace(/\.pdf$/i, '') + ' - ' + t('cover template') + '.pdf';
  try {
    fs.writeFileSync(filePath, result.pdf);
    const cover = kdpCoverHtml({ trim, paper, pages, title, author });
    const [cw, ch] = [0.25 + tw * 2 + pages * KDP_PAPER[paper], th + 0.25];
    fs.writeFileSync(coverPath, (await renderPaged(cover, { width: cw, height: ch, plain: true })).pdf);
  } catch (err) {
    logError('paperback save', err);
    throw new Error('Could not write the file (' + ((err && err.message) || err) + ')');
  }
  return {
    file: filePath, cover: coverPath, pages,
    spine: +(pages * KDP_PAPER[paper]).toFixed(3),
    tooFew: pages < 24, tooMany: pages > KDP_MAX_PAGES[paper]
  };
}

// Writes a timestamped snapshot to the library's Exports folder, then hands it
// to your email — an outside-the-machine paper trail for provenance.
ipcMain.handle('email:draft', async (_e, { to, subject, body, html, defaultName, method, print }) => {
  const { shell } = require('electron');
  const exportsDir = path.join(LIBRARY_DIR, 'Exports');
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(exportsDir, `${defaultName}-${stamp}.pdf`);
  fs.writeFileSync(file, await renderPDF(html, print));

  if (method === 'gmail') {
    // Gmail compose in the browser can't take an attachment from outside,
    // so open the draft pre-filled and reveal the PDF right next to it to drag in.
    const url = 'https://mail.google.com/mail/?view=cm&fs=1'
      + '&to=' + encodeURIComponent(to)
      + '&su=' + encodeURIComponent(subject)
      + '&body=' + encodeURIComponent(body);
    await shell.openExternal(url);
    shell.showItemInFolder(file);
    return { ok: true, method: 'gmail', file };
  }

  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `
    tell application "Mail"
      set msg to make new outgoing message with properties {subject:"${esc(subject)}", content:"${esc(body)}" & return & return, visible:true}
      tell msg to make new to recipient at end of to recipients with properties {address:"${esc(to)}"}
      tell msg to make new attachment with properties {file name:(POSIX file "${esc(file)}")} at after the last paragraph of content
      activate
    end tell`;
  return new Promise((resolve) => {
    require('child_process').execFile('osascript', ['-e', script], (err) => {
      if (err) {
        // Mail not available — at least reveal the snapshot we saved
        shell.showItemInFolder(file);
        resolve({ ok: false, file });
      } else {
        resolve({ ok: true, method: 'mail', file });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Import: .docx / .txt / .md → chapters
// ---------------------------------------------------------------------------

// numeric references too, and &amp; last, so a literal "&lt;" in the text
// stays "&lt;" instead of turning into "<"
const decodeEntities = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return m; } })
  .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return m; } })
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
// a document's own * _ and \ are text, not emphasis: they travel escaped,
// the way Markdown writes them, and the window turns them back into letters
const escapeMarks = (s) => s.replace(/[\\*_]/g, '\\$&');

// Is a formatting tag (<w:b>, <w:i>) present, and is it on? Returns true,
// false (present but switched off — Word writes <w:i w:val="0"/> to cancel
// a style's italics), or undefined when the run says nothing about it.
function docxFormatOn(rpr, tag) {
  const hit = rpr.match(new RegExp('<' + tag + '(?:\\s[^>]*)?/?>'));
  if (!hit) return undefined;
  const val = (hit[0].match(/w:val="([^"]*)"/) || [])[1];
  return val === undefined || /^(true|1|on)$/i.test(val);
}

// Italics and bold don't always sit on the run: a manuscript may carry them
// in a character style ("Emphasis", Scrivener's "Italic") or a paragraph
// style. Read word/styles.xml once into { styleId: { bold, italic } },
// following basedOn so a style built on an italic one stays italic.
function docxStyleFormats(stylesXml) {
  const out = {};
  if (!stylesXml) return out;
  const raw = {};
  for (const m of stylesXml.matchAll(/<w:style\s[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const body = m[2];
    const basedOn = (body.match(/<w:basedOn\s+w:val="([^"]+)"/) || [])[1];
    // only the style's own run properties, not the paragraph-mark ones
    const rpr = (body.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
    // the style's name: always English in the file ("heading 1", "Title"),
    // while its id follows Word's language ("berschrift1", "Titre1")
    const name = (body.match(/<w:name\s+w:val="([^"]*)"/) || [])[1] || '';
    raw[m[1]] = { basedOn, name, bold: docxFormatOn(rpr, 'w:b'), italic: docxFormatOn(rpr, 'w:i') };
  }
  const resolve = (id, depth) => {
    if (out[id]) return out[id];
    const st = raw[id];
    if (!st || depth > 8) return { bold: false, italic: false };
    const base = st.basedOn ? resolve(st.basedOn, depth + 1) : { bold: false, italic: false };
    out[id] = {
      name: st.name,
      bold: st.bold === undefined ? base.bold : st.bold,
      italic: st.italic === undefined ? base.italic : st.italic
    };
    return out[id];
  };
  for (const id of Object.keys(raw)) resolve(id, 0);
  return out;
}

// Convert one Word paragraph's bold/italic XML into markdown text with bold/italic
function docxParagraphToMarkdown(p, styles = {}) {
  const pageBreak = /<w:br [^>]*w:type="page"/.test(p) || /<w:pageBreakBefore/.test(p);
  // Word marks headings with a paragraph style such as <w:pStyle w:val="Heading1"/>.
  // Any heading style (Heading1..9, Heading 1..9, or bare "Heading") starts a new chapter and
  // gives it its title — regardless of locale, the underlying style id is
  // always "Heading*".
  const pStyle = (p.match(/<w:pStyle\s+w:val="([^"]*)"/) || [])[1] || '';
  const sName = (styles[pStyle] && styles[pStyle].name) || '';
  const heading = /^heading\s*\d*$/i.test(pStyle) || /^heading\s*\d*$/i.test(sName);
  // Google Docs exports each of a document's tabs under a "Title"-styled
  // line, and the book's own title page uses the same style: the first one
  // names the book, later ones start chapters (see chapterize)
  const title = /^title$/i.test(pStyle) || /^title$/i.test(sName);
  // what the paragraph's style says, before any run has its say
  const pBase = styles[pStyle] || { bold: false, italic: false };
  const runs = [...p.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)].map((rm) => {
    const r = rm[0];
    const rpr = (r.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
    // the run's text in order: its words, and the tabs, line breaks and
    // no-break hyphens between them (only <w:t> used to count, which ran
    // "red,⏎violets" together into "red,violets")
    const text = [...r.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br(\s[^>]*)?\/>|<w:cr\/>|<w:noBreakHyphen\/>/g)]
      .map((t) => {
        if (t[1] !== undefined) return escapeMarks(decodeEntities(t[1]));
        if (t[0].startsWith('<w:tab')) return ' ';
        if (t[0].startsWith('<w:noBreakHyphen')) return '\u2011';
        if (/w:type="(page|column)"/.test(t[0])) return '';
        return '\n';
      }).join('');
    const rStyle = (rpr.match(/<w:rStyle\s+w:val="([^"]*)"/) || [])[1];
    const rBase = rStyle && styles[rStyle] ? styles[rStyle] : pBase;
    const b = docxFormatOn(rpr, 'w:b');
    const i = docxFormatOn(rpr, 'w:i');
    return { text, bold: b === undefined ? !!rBase.bold : b, italic: i === undefined ? !!rBase.italic : i };
  });
  // make sure **one**"+"**two**" becomes one "**onetwo**", not "**one****two**"
  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.bold === run.bold && last.italic === run.italic) last.text += run.text;
    else merged.push({ ...run });
  }
  // markers hug the words: "** bold **" isn't emphasis to a reader of
  // Markdown, and a run with no words (a tab, a break) gets none at all
  // (each line of a run on its own: the paragraph is cut at its line
  // breaks later, and an italic poem keeps its italics on every line)
  const wrap = (run, piece) => {
    const m = piece.match(/^(\s*)([\s\S]*?)(\s*)$/);
    let t = m[2];
    if (!t) return piece;
    if (run.bold) t = '**' + t + '**';
    if (run.italic) t = '*' + t + '*';
    return m[1] + t + m[3];
  };
  const text = merged.map((run) => run.text.split('\n').map((piece) => wrap(run, piece)).join('\n'))
    .join('').replace(/[ \t]*\n[ \t]*/g, '\n').trim();
  return { text, pageBreak, heading, title };
}

// Headings that are only NEO's own numbering, in the languages NEO speaks
const CHAPTER_WORDS = new RegExp('^(' + [
  'chapter', 'prologue', 'epilogue', 'part',                       // en
  'chapitre', 'épilogue', 'partie',                                // fr
  'capítulo', 'capitulo', 'prólogo', 'prologo', 'epílogo', 'epilogo', 'parte', // es, pt, it
  'capitolo',                                                      // it
  'kapitel', 'prolog', 'epilog', 'teil',                           // de
  'hoofdstuk', 'proloog', 'epiloog', 'deel',                       // nl
  'rozdział', 'rozdzial', 'część', 'czesc',                         // pl
  // ro (prolog, epilog above). A bare "Capitol" only before a number:
  // on its own it is an English word, and "Capitol Hill was quiet." is prose
  'capitol(?=\\s+\\d)', 'capitolul', 'partea',
  'глава', 'пролог', 'эпилог', 'часть',                            // ru
  'κεφάλαιο', 'κεφαλαιο', 'πρόλογος', 'προλογος',
  'επίλογος', 'επιλογος', 'μέρος', 'μερος',
  'ραψωδία', 'ραψωδια',                                             // el
  // hu: the number comes first ("3. fejezet", "II. rész")
  'prológus', 'prologus', 'epilógus', 'epilogus',
  '(?:\\d{1,3}|[ivxlc]{1,7})\\.\\s*(?:fejezet|rész|resz)'
].join('|') + ')(?![\\p{L}\\d])', 'iu');

// A manuscript's own Prologue / Epilogue headings give those chapters their role
const PROLOGUE_WORDS = /^(prologue|prólogo|prologo|prolog|proloog|prológus|prologus)(?![\p{L}\d])/iu;
const EPILOGUE_WORDS = /^(epilogue|épilogue|epílogo|epilogo|epilog|epiloog|epilógus|epilogus)(?![\p{L}\d])/iu;

// A text file in whatever it was saved as: UTF-8 (with or without its
// mark), UTF-16 (Notepad's "Unicode"), or, when it isn't valid UTF-8, the
// Windows code page Word's plain-text export uses
function readTextFile(fp) {
  const buf = fs.readFileSync(fp);
  const { TextDecoder } = require('util');
  if (buf[0] === 0xFF && buf[1] === 0xFE) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xFE && buf[1] === 0xFF) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '');
  } catch {
    // Latin-1 plus the code page's own 0x80–0x9F (curly quotes, dashes, €)
    const cp = '\u20AC\uFFFD\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\uFFFD\u017D\uFFFD' +
      '\uFFFD\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\uFFFD\u017E\u0178';
    return buf.toString('latin1').replace(/[\u0080-\u009F]/g, (c) => cp[c.charCodeAt(0) - 0x80]);
  }
}

async function importFile(fp) {
  const name = path.basename(fp).replace(/\.[^.]+$/, '');
  const ext = path.extname(fp).toLowerCase();
  let paras = [];
  // a script (Fountain, or Final Draft's XML) is read as it stands; the
  // window sorts it into its elements (spFromFountain, spFromFdx in app.js)
  if (ext === '.fountain' || ext === '.fdx') {
    return { name, script: ext.slice(1), source: fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '') };
  }

  if (ext === '.docx') {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(fs.readFileSync(fp));
    const docFile = zip.file('word/document.xml');
    if (!docFile) throw new Error('Not a valid .docx: ' + fp);
    const xml = await docFile.async('string');
    const stylesFile = zip.file('word/styles.xml');
    const styles = docxStyleFormats(stylesFile ? await stylesFile.async('string') : '');
    paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
      .map((m) => docxParagraphToMarkdown(m[0], styles))
      // a line break inside a Word paragraph (a poem, an address) becomes
      // a paragraph of its own: NEO's lines are paragraphs
      .flatMap((p) => !p.text.includes('\n') ? [p]
        : p.text.split('\n').map((text, i) => ({ ...p, text: text.trim(), pageBreak: p.pageBreak && i === 0, heading: p.heading && i === 0, title: p.title && i === 0 })));
  } else {
    const raw = readTextFile(fp);
    // Paragraphs are split on blank lines, unless the file barely has any
    // and puts each paragraph on a line of its own (Word's "Plain Text",
    // Notepad, Scrivener): then every line is a paragraph
    const lines = raw.split(/\r\n|\r|\n/);
    const blanks = lines.filter((l) => !l.trim()).length;
    const filled = lines.length - blanks;
    // (a file hard-wrapped at ~70 columns, Project Gutenberg style, has a
    // blank line between paragraphs: it keeps the blank-line rule)
    const perLine = ext === '.txt' && filled > 3 && blanks <= Math.max(1, filled / 20);
    paras = (perLine ? lines : raw.split(/(?:\r\n|\r|\n)\s*(?:\r\n|\r|\n)/))
      .map((b) => ({ text: (perLine ? b : b.replace(/\s*(?:\r\n|\r|\n)\s*/g, ' ')).trim(), pageBreak: false }))
      .filter((p) => p.text);
  }

  // Chapterize: page breaks and heading lines start new chapters. Headings
  // include "Chapter N" styles plus bare chapter numbers — "7", "VII",
  // "Seven" — which get stripped so NEO's own numbering doesn't duplicate them.
  const SPELLED = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\.?$/i;
  const isNumeralish = (t) => /^\d{1,3}\.?$/.test(t) || /^[IVXLC]{1,7}\.?$/.test(t) || SPELLED.test(t);
  // Bare numbers only count as chapter markers when there's a ladder of them —
  // a story that merely OPENS with "Seven." keeps its seven.
  // a heading set in bold ("**Chapter 1**") is still a heading
  const bare = (t) => String(t || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\\([\\*_])/g, '$1').trim();
  const numeralMode = paras.filter((p) => p.text && isNumeralish(bare(p.text))).length >= 2;
  // A markdown heading: one or more "#" then text — any "size" (depth) counts.
  const isMdHeading = (t) => /^#{1,6}\s+\S/.test(t);
  const mdTitleOf = (t) => t.replace(/^#{1,6}\s*/, '').trim();
  // A heading that is purely NEO's own numbering ("Chapter 2", "Prologue",
  // bare "7") carries no title — NEO numbers chapters itself. A line that
  // only opens with one of those words and reads as a sentence ("Part of me
  // wanted to run.", "Часть денег пропала.") is prose: it stays in the text.
  const readsAsSentence = (t) => /[.!?…][”’"'»)]*$/.test(t) && t.trim().split(/\s+/).length > 2;
  const isNumberedHeading = (t) => (
    (CHAPTER_WORDS.test(t) && t.length < 60 && !readsAsSentence(t)) ||
    (numeralMode && isNumeralish(t))
  );
  const isHeading = (t) => t && (isMdHeading(t) || isNumberedHeading(bare(t)));
  // The chapter title that a heading contributes. Markdown hashes and any
  // emphasis markers are stripped, and pure numbering yields no title.
  const titleOf = (t) => {
    if (isMdHeading(t)) t = mdTitleOf(t);
    t = bare(t).replace(/(^|[^\p{L}\p{N}_])_([^_]+)_(?![\p{L}\p{N}_])/gu, '$1$2');
    return isNumberedHeading(t) ? '' : t;
  };
  const isBreak = (t) => /^\s*([*#•~⁂—–-]\s*){1,7}$/.test(t || '');

  let styledTitle = null; // a Title-styled first line: the book's name
  const chapterize = (usePageBreaks) => {
    const chapters = [];
    let cur = [];
    let curTitle = '';
    let curRole = null;
    let seenProse = false;
    let lastWasHeading = false;
    styledTitle = null;
    const close = () => {
      if (cur.length) chapters.push({ title: curTitle, paras: cur, role: curRole });
      cur = [];
      curTitle = '';
      curRole = null;
    };
    for (const p of paras) {
      const brk = usePageBreaks && p.pageBreak;
      if (!p.text && !brk && !p.heading && !p.title) continue;
      // a Title line before any prose is the book's title, not a chapter's
      if (p.title && !seenProse && styledTitle === null && p.text) { styledTitle = titleOf(p.text); continue; }
      const isH = p.heading || p.title || isHeading(p.text);
      if (brk || isH) {
        // a heading that follows another with no prose between (a Google
        // Docs tab named "Chapter 2" holding a "The Long Way Home" heading)
        // refines the chapter's title instead of opening an empty chapter
        if (isH && lastWasHeading && !cur.length && !brk) {
          const t = titleOf(p.text || '');
          if (t) curTitle = curTitle ? `${curTitle} — ${t}` : t;
          continue;
        }
        close();
      }
      if (isH) {
        const h = (p.text || '').replace(/^#{1,6}\s*/, '').trim();
        curRole = PROLOGUE_WORDS.test(h) ? 'prologue' : EPILOGUE_WORDS.test(h) ? 'epilogue' : null;
        curTitle = titleOf(p.text || ''); lastWasHeading = true; continue;
      } // the heading line is replaced by NEO's numbering
      lastWasHeading = false;
      if (isBreak(p.text)) { cur.push({ scene: true }); continue; }
      if (p.text) { cur.push({ text: p.text }); seenProse = true; }
    }
    close();
    return chapters;
  };

  const countAllWords = (list) =>
    list.reduce((n, ch) => n + ch.paras.reduce((m, p) => m + (p.text ? p.text.trim().split(/\s+/).length : 0), 0), 0);

  // First pass trusts page breaks. Some word processors sprinkle page-break
  // formatting on every paragraph, exploding a story into confetti — if the
  // result is absurd (lots of tiny "chapters"), re-run trusting headings only.
  let chapters = chapterize(true);
  if (chapters.length > 6 && countAllWords(chapters) / chapters.length < 250) {
    chapters = chapterize(false);
  }
  if (!chapters.length) chapters.push({ title: '', paras: [{ text: '' }] });

  // Front matter: a short title line and a "by Author" line belong on the
  // title page, not in the body. Detect, harvest, and remove them.
  let title = styledTitle || null;
  let author = null;
  // letters of any script; NFC because a Mac may hand over the file name
  // decomposed while the text inside is composed
  const norm = (s) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  // "by Jane Doe" — or its equivalent in another language. Those words also
  // open ordinary sentences ("Par une nuit…", "Von Anfang an"), so outside
  // English the rest must look like a name: capitalized words (name
  // particles aside), no sentence punctuation.
  const bylineOf = (s) => {
    const en = s.match(/^by\s+(.{2,60})$/i);
    if (en) return en[1];
    // Romanian "de Ion Creangă" is lowercase on a title page; a capital "De"
    // opens titles ("De Profundis", Dutch "De Eerste Dag") and stays text
    const m = s.match(/^(?:par|por|von|di|door|autor:?|автор:?)\s+(.{2,60})$/iu) || s.match(/^de\s+(.{2,60})$/u);
    if (!m || /[.!?,;…]/.test(m[1])) return null;
    const words = m[1].trim().split(/\s+/);
    const particle = /^(de|da|di|do|dos|das|du|des|del|della|la|le|van|von|der|den|ten|ter|y|e)$/;
    return words.length <= 5 && words.every((w) => /^\p{Lu}/u.test(w) || particle.test(w)) ? m[1] : null;
  };
  const first = chapters[0];
  if (first && first.paras.length) {
    const t0 = (first.paras[0].text || '').trim();
    const t1 = first.paras.length > 1 ? (first.paras[1].text || '').trim() : '';
    const titleish = t0 && t0.length < 90 && !/[.!?]$/.test(t0) && (
      (norm(t0).length > 3 && norm(name).includes(norm(t0))) ||
      !!bylineOf(t1) ||
      (t0 === t0.toUpperCase() && /\p{Lu}.*\p{Lu}/u.test(t0) && t0.length < 60)
    );
    if (titleish) {
      title = bare(t0);
      first.paras.shift();
    }
    const bl = first.paras.length ? bylineOf((first.paras[0].text || '').trim()) : null;
    if (bl) {
      author = bare(bl);
      first.paras.shift();
    }
    if (!first.paras.length) chapters.shift();
    if (!chapters.length) chapters.push({ title: '', paras: [{ text: '' }] });
  }

  // a role only holds in its place: the prologue first, the epilogue last
  chapters.forEach((ch, i) => {
    if ((ch.role === 'prologue' && i !== 0) || (ch.role === 'epilogue' && i !== chapters.length - 1) || chapters.length < 2) ch.role = null;
  });
  if (styledTitle && title === styledTitle) title = bare(title);
  return { name, title, author, chapters };
}

// Same parsing as the picker, but for files dropped from Finder/Explorer
ipcMain.handle('import:files', async (_e, paths) => {
  const out = [];
  for (const fp of paths || []) {
    if (!/\.(docx|txt|md|fountain|fdx)$/i.test(fp)) continue;
    try {
      out.push(await importFile(fp));
    } catch (err) {
      logError('import', err);
      out.push({ name: path.basename(fp), error: String(err.message || err) });
    }
  }
  return out;
});

ipcMain.handle('import:pick', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: t('Bring your manuscripts home'),
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: t('Manuscripts'), extensions: ['docx', 'txt', 'md', 'fountain', 'fdx'] }]
  });
  if (canceled || !filePaths.length) return [];
  const out = [];
  for (const fp of filePaths) {
    try {
      out.push(await importFile(fp));
    } catch (err) {
      logError('import', err);
      out.push({ name: path.basename(fp), error: String(err.message || err) });
    }
  }
  return out;
});

// ---------------------------------------------------------------------------
// Robustness: error log, daily backups, single instance
// ---------------------------------------------------------------------------
const ERROR_LOG = () => path.join(LIBRARY_DIR, 'neo-errors.log');

function logError(source, err) {
  const line = `[${new Date().toISOString()}] [${source}] ${err && err.stack ? err.stack : String(err)}\n`;
  try {
    ensureLibrary();
    fs.appendFileSync(ERROR_LOG(), line);
  } catch {
    // the library can't be written (the very case worth logging): NEO's own
    // app folder takes the line instead
    try { fs.appendFileSync(path.join(app.getPath('userData'), 'neo-errors.log'), line); } catch { /* never let logging crash the app */ }
  }
}

process.on('uncaughtException', (err) => logError('main', err));
process.on('unhandledRejection', (err) => logError('main-promise', err));
ipcMain.handle('log:error', (_e, msg) => logError('renderer', msg));

// One zip of the whole library per day, keeping the last 14. Cheap insurance.
async function dailyBackup() {
  if (backupRunning) return; // one at a time (the hourly look can meet a slow one)
  try {
    ensureLibrary();
    const backupsDir = path.join(LIBRARY_DIR, 'Backups');
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const target = path.join(backupsDir, `neo-backup-${today}.zip`);
    if (fs.existsSync(target)) return;
    backupRunning = true;

    const JSZip = require('jszip');
    const zip = new JSZip();
    const skip = new Set(['Backups', 'Exports']);
    // One file the system won't hand over (in iCloud but not downloaded yet,
    // held by a sync tool) used to throw, and cost the whole day's backup,
    // every day. Now it's left out, named in the zip and in the error log.
    const missed = [];
    const walk = (dir, rel) => {
      let names = [];
      try { names = fs.readdirSync(dir); } catch (err) { missed.push(`${rel || '.'} (${err.code || err.message})`); return; }
      for (const name of names) {
        if (rel === '' && skip.has(name)) continue;
        // only NEO's own things: a library kept in a busy folder (Dropbox,
        // Documents) doesn't zip everything else in there every day
        if (rel === '' && !(name.startsWith('book-') || name.startsWith('library.json') || name === '_catalog.txt')) continue;
        if (name === '.DS_Store' || /^\..+\.icloud$/.test(name)) continue; // Finder litter; iCloud's stand-in for a file not downloaded
        const full = path.join(dir, name);
        const relPath = rel ? rel + '/' + name : name;
        try {
          const stat = fs.statSync(full);
          if (stat.isDirectory()) walk(full, relPath);
          else zip.file(relPath, fs.readFileSync(full));
        } catch (err) {
          missed.push(`${relPath} (${err.code || err.message})`);
        }
      }
    };
    walk(LIBRARY_DIR, '');
    if (missed.length) {
      zip.file('_left-out-of-this-backup.txt', missed.join('\n') + '\n');
      logError('backup', new Error('left out of today\'s backup: ' + missed.join(', ')));
    }
    // written beside its real name and swapped in whole, so a backup cut
    // short never stands in for the day's backup
    const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await JSZip.loadAsync(data); // reads back whole, or it doesn't count
    writeFileDurable(target, data);

    // prune old backups
    const backups = fs.readdirSync(backupsDir).filter((f) => /^neo-backup-.*\.zip$/.test(f)).sort();
    while (backups.length > 14) fs.unlinkSync(path.join(backupsDir, backups.shift()));
  } catch (err) {
    logError('backup', err);
    try { fs.unlinkSync(path.join(LIBRARY_DIR, 'Backups', `neo-backup-${new Date().toISOString().slice(0, 10)}.zip.tmp`)); } catch { /* none */ }
  } finally {
    backupRunning = false;
  }
}
let backupRunning = false;

// ---------------------------------------------------------------------------
// Window
// The window's own color, seen for a moment before the page draws and at the
// edges while it resizes: the room's color, dark or (View → Page → Light) light
function roomColor(theme) { return theme === 'light' ? '#efede8' : '#191919'; }
// (this computer's own page, kept in settings.json as the window reports
// it; the library's, the last device's, until it has one)
function libraryPageTheme() {
  const own = readSettings().pageTheme;
  if (own) return own;
  try { return JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8')).pageTheme || 'night'; } catch { return 'night'; }
}

// ---------------------------------------------------------------------------
function createWindow() {
  // the window comes back the size and place it was left, when that place
  // is still on a screen (a monitor unplugged since gets the default)
  const saved = readSettings().window || {};
  let bounds = { width: 1200, height: 800 };
  if (saved.width >= 800 && saved.height >= 600) {
    bounds = { width: saved.width, height: saved.height };
    if (typeof saved.x === 'number' && typeof saved.y === 'number') {
      const onScreen = screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return saved.x + 100 < a.x + a.width && saved.x + saved.width - 100 > a.x &&
          saved.y + 40 < a.y + a.height && saved.y >= a.y - 20;
      });
      if (onScreen) Object.assign(bounds, { x: saved.x, y: saved.y });
    }
  }
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 700,
    minHeight: 600,
    // the Mac's inset traffic lights. Only there: on Linux any title bar
    // style but the default leaves the window frameless, and on Wayland the
    // menu bar lives in that frame (KDE Plasma showed no menu, and Alt
    // found nothing to show)
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
    backgroundColor: roomColor(libraryPageTheme()),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The engine is available, but every editable element starts with
      // spellcheck="false" — NEO never nags. A spellcheck pass is a
      // deliberate act (Edit → Spellcheck Pass), not a klaxon.
      spellcheck: true
    }
  });
  win.loadFile('index.html');
  // The menu bar follows the real full-screen state, whoever changed it.
  // Electron only puts the bar back after a full screen it entered itself,
  // so once a window manager's own full-screen key had been used (Sway, i3),
  // NEO's toggle left the bar hidden for good. Run a tick later, after
  // Electron's own show/hide, so this has the last word.
  const fullScreenChanged = (full) => setImmediate(() => {
    if (win.isDestroyed()) return;
    win.webContents.send('menu', { type: 'fullScreen', value: full }); // the page's bottom bar too
    if (process.platform === 'darwin') return;
    // full screen hides the bar until Alt brings it up (and it tucks away
    // again after a choice), the way Windows apps do; out of full screen
    // it's always there
    win.setAutoHideMenuBar(full);
    win.setMenuBarVisibility(!full);
  });
  win.on('enter-full-screen', () => fullScreenChanged(true));
  win.on('leave-full-screen', () => fullScreenChanged(false));
  win.webContents.on('did-finish-load', () => { if (win.isFullScreen()) fullScreenChanged(true); });
  const remember = () => {
    clearTimeout(rememberTimer);
    if (win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return;
    try { writeSettings({ ...readSettings(), window: win.getNormalBounds() }); } catch (err) { logError('settings', err); }
  };
  // a drag sends dozens of these a second: the place is written once it settles
  let rememberTimer = null;
  const rememberSoon = () => { clearTimeout(rememberTimer); rememberTimer = setTimeout(remember, 500); };
  win.on('resize', rememberSoon);
  win.on('move', rememberSoon);
  win.on('close', remember);

  // Right-click on text: Cut, Copy, Paste, Select All — and nothing else.
  // Handing macOS the frame (where the selection sits) is what invites it to
  // add Writing Tools, and NEO carries no generative-AI tools, ever, so the
  // frame stays out. NEO's own right-click menus (shelves, covers, chapter
  // headings, flagged words) cancel the event first, so this never comes up
  // over them.
  win.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable && !params.selectionText) return;
    const can = params.editFlags || {};
    const items = [];
    // a line of a script: a page can start there
    const line = scriptContext;
    scriptContext = null;
    if (params.isEditable && line) {
      items.push({ label: line.pageBreak ? t('Remove Page Break') : t('Page Break Here'), click: () => sendToWindow({ type: 'scriptPageBreak' }) }, { type: 'separator' });
    }
    if (params.isEditable) items.push({ role: 'cut', label: t('Cut'), enabled: !!can.canCut });
    items.push({ role: 'copy', label: t('Copy'), enabled: !!can.canCopy });
    if (params.isEditable) items.push({ role: 'paste', label: t('Paste'), enabled: !!can.canPaste });
    items.push({ type: 'separator' }, { role: 'selectAll', label: t('Select All') });
    Menu.buildFromTemplate(items).popup({ window: win });
  });

  // NEO does its own spellchecking (see spell:* handlers) — the engine's
  // checker proved unreliable at scanning existing text, so it stays off
  win.webContents.session.setSpellCheckerEnabled(false);
}

// ---------------------------------------------------------------------------
// Spellcheck: NEO's own bundled Hunspell dictionaries, checked by Hunspell
// itself (WebAssembly, in spell-worker.js), identical
// on every platform. The renderer paints the squiggles and asks for
// suggestions. Edit → Spellcheck Language picks the dictionary; the choice
// lives in library.json so it travels with the writer's books.
// (Languages beyond US English: idea and dictionary set from Zaim Halili.)
// ---------------------------------------------------------------------------
let spellLanguage = 'en-US';
const SPELL_LANGUAGES = {
  'en-US': { label: 'English (US)', pkg: 'dictionary-en-us' },
  'en-GB': { label: 'English (UK)', pkg: 'dictionary-en-gb' },
  'en-CA': { label: 'English (Canada)', pkg: 'dictionary-en-ca' },
  'en-AU': { label: 'English (Australia)', pkg: 'dictionary-en-au' },
  'fr': { label: 'Français', pkg: 'dictionary-fr' },
  'es': { label: 'Español', pkg: 'dictionary-es' },
  'de': { label: 'Deutsch', pkg: 'dictionary-de' },
  'nl': { label: 'Nederlands', pkg: 'dictionary-nl' },
  'pl': { label: 'Polski', pkg: 'dictionary-pl' },
  'pt-BR': { label: 'Português (Brasil)', pkg: 'dictionary-pt' },
  'ro': { label: 'Română', pkg: 'dictionary-ro' },
  'hu': { label: 'Magyar', pkg: 'dictionary-hu' },
  'ru': { label: 'Русский', pkg: 'dictionary-ru' },
  'sv': { label: 'Svenska', pkg: 'dictionary-sv' },
  'el': { label: 'Ελληνικά', pkg: 'dictionary-el' }
};

// The dictionary work runs in a helper process (spell-worker.js), so the
// writing room never waits for a dictionary to load.
let spellChild = null;
let spellSeq = 0;
const spellWaiting = new Map();

let spellLoaded = null; // the language the running helper has loaded
function spellRequest(msg) {
  return new Promise((resolve) => {
    // the helper went away (it crashed, the system reclaimed it): start a
    // new one and load the dictionary again, rather than calling every
    // word right for the rest of the session
    if (!spellChild && msg.type !== 'load' && spellLoaded) {
      const lang = spellLoaded;
      spellLoaded = null;
      loadSpellDictionary(lang).then(() => spellRequest(msg)).then(resolve, () => resolve({ ok: false, error: 'no spell process' }));
      return;
    }
    if (!spellChild) { resolve({ ok: false, error: 'no spell process' }); return; }
    const id = ++spellSeq;
    spellWaiting.set(id, resolve);
    spellChild.postMessage({ ...msg, id });
  });
}

function startSpellProcess() {
  if (spellChild) return;
  try {
    spellChild = utilityProcess.fork(path.join(__dirname, 'spell-worker.js'), [], { serviceName: 'NEO spellcheck' });
    spellChild.on('message', (m) => {
      const done = spellWaiting.get(m.id);
      if (done) { spellWaiting.delete(m.id); done(m); }
    });
    spellChild.on('exit', () => {
      spellChild = null;
      for (const done of spellWaiting.values()) done({ ok: false, error: 'spell process exited' });
      spellWaiting.clear();
    });
  } catch (err) {
    logError('spell', err);
    spellChild = null;
  }
}

// The dictionary packages differ in how they export (callback, ES module),
// so the helper reads their .aff/.dic files directly — the one shape they
// all share. (Not require.resolve: the newer packages seal package.json.)
async function loadSpellDictionary(code) {
  const known = SPELL_LANGUAGES[code] ? code : 'en-US';
  const entry = SPELL_LANGUAGES[known];
  startSpellProcess();
  let custom = [];
  try { custom = readJSON(LIBRARY_FILE, {}).customWords || []; } catch { /* a nicety */ }
  const res = await spellRequest({ type: 'load', language: known, dir: path.join(__dirname, 'node_modules', entry.pkg), custom });
  if (!res.ok) { logError('spell', new Error(res.error || 'dictionary failed to load')); return false; }
  spellLanguage = known;
  spellLoaded = known;
  return true;
}

// One rule for every language: a dictionary picked in Edit → Spellcheck
// Language wins. Until there is one, spellcheck follows the interface
// language when NEO has its dictionary (fr-CA → fr), else US English.
// Nothing is saved on the writer's behalf, so switching the interface back
// takes the dictionary (and the typed quotes) along with it.
function chosenSpellLanguage() {
  const saved = readJSON(LIBRARY_FILE, null);
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved.spellLanguage : undefined;
}

function defaultSpellLanguage() {
  const ui = String(uiLanguage || 'en');
  if (SPELL_LANGUAGES[ui]) return ui;
  // NEO's Portuguese interface is Brazilian; the dictionary is too. The
  // European interface (pt-PT) leaves the choice to the writer.
  if (ui === 'pt' || ui === 'pt-BR') return 'pt-BR';
  const base = ui.split('-')[0];
  return SPELL_LANGUAGES[base] ? base : 'en-US';
}

function initSpell() {
  const chosen = chosenSpellLanguage();
  spellLanguage = SPELL_LANGUAGES[chosen] ? chosen : defaultSpellLanguage();
  loadSpellDictionary(spellLanguage);
}

ipcMain.handle('spell:setLanguage', async (_e, code) => {
  if (!SPELL_LANGUAGES[code]) return false;
  const ok = await loadSpellDictionary(code);
  if (ok) { try { buildMenu(); } catch (err) { logError('menu', err); } }
  return ok;
});

ipcMain.handle('spell:check', async (_e, words) => {
  const res = await spellRequest({ type: 'check', words });
  if (res.ok) return res.result;
  const out = {};
  for (const w of words) out[w] = true; // no checker: nothing is wrong
  return out;
});

ipcMain.handle('spell:suggest', async (_e, word) => {
  const res = await spellRequest({ type: 'suggest', word });
  return res.ok ? res.result : [];
});

ipcMain.handle('spell:learn', async (_e, word) => {
  if (typeof word === 'string') await spellRequest({ type: 'add', word });
  return true;
});

// ---------------------------------------------------------------------------
// Application menu — Help and Format live here, out of the writing room
// ---------------------------------------------------------------------------
function sendToWindow(msg) {
  const w = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (w) w.webContents.send('menu', msg);
}

// the Format menu's ticks: whether the caret is in a poetry paragraph, and
// whether typewriter scrolling is on
let poetryState = false;
let flushState = false;
// A script open in the window: the Format menu offers its elements (the
// keys are the editor's own, ⌘1–⌘7), and Export its two ways out
let scriptState = { on: false, element: null, underline: false, contd: true };
const SCRIPT_ELEMENTS = ['heading', 'action', 'character', 'paren', 'dialogue', 'transition', 'shot'];
// the script line a right-click is on: { pageBreak } (whether it starts a
// page already), or null when the click wasn't on one
let scriptContext = null;
ipcMain.on('script:context', (e, st) => {
  scriptContext = st && typeof st === 'object' ? { pageBreak: !!st.pageBreak } : null;
  e.returnValue = true;
});
ipcMain.on('script:state', (_e, st) => {
  st = st || {};
  const next = { on: !!st.on, element: SCRIPT_ELEMENTS.includes(st.element) ? st.element : null, underline: !!st.underline, contd: st.contd !== false };
  if (next.on === scriptState.on && next.element === scriptState.element && next.underline === scriptState.underline && next.contd === scriptState.contd) return;
  scriptState = next;
  try { buildMenu(); } catch (err) { logError('menu', err); }
});
let typewriterState = false;
ipcMain.on('poetry:state', (_e, on) => {
  on = !!on;
  if (on === poetryState) return;
  poetryState = on;
  try { buildMenu(); } catch (err) { logError('menu', err); }
});
ipcMain.on('flush:state', (_e, on) => {
  on = !!on;
  if (on === flushState) return;
  flushState = on;
  try { buildMenu(); } catch (err) { logError('menu', err); }
});
ipcMain.on('typewriter:state', (_e, on) => {
  on = !!on;
  if (on === typewriterState) return;
  typewriterState = on;
  try { buildMenu(); } catch (err) { logError('menu', err); }
});
// Format → Show Pages, and Two Pages Side by Side (which needs the first)
let pagesState = { paged: false, twoUp: false };
ipcMain.on('pages:state', (_e, st) => {
  st = st || {};
  const next = { paged: !!st.paged, twoUp: !!st.twoUp };
  if (next.paged === pagesState.paged && next.twoUp === pagesState.twoUp) return;
  pagesState = next;
  try { buildMenu(); } catch (err) { logError('menu', err); }
});
// View → Vim Keys shows whether they're on
let vimState = false;
ipcMain.on('vim:state', (_e, on) => {
  on = !!on;
  if (on === vimState) return;
  vimState = on;
  try { buildMenu(); } catch (err) { logError('menu', err); }
});
// View → Interface Size shows its choice
let uiZoomState = 1;
ipcMain.on('uizoom:state', (_e, z) => {
  z = [1, 1.25, 1.5, 2, 2.5, 3].includes(z) ? z : 1;
  if (z === uiZoomState) return;
  uiZoomState = z;
  try { buildMenu(); } catch (err) { logError('menu', err); }
});
// View and Format menu ticks: the focus level, the page, Brighter Interface, and the writing
// format the page is using (body font, drop cap style, paragraph alignment).
let viewState = { focus: 'off', pageTheme: 'night', uiBright: false, bodyFont: '', dropCap: 'literary', align: null };
let keptTheme = null;
ipcMain.on('view:state', (e, st) => {
  st = st || {};
  const next = {
    focus: st.focus || 'off',
    pageTheme: st.pageTheme || 'night',
    uiBright: !!st.uiBright,
    bodyFont: typeof st.bodyFont === 'string' ? st.bodyFont : '',
    dropCap: typeof st.dropCap === 'string' ? st.dropCap : 'literary',
    align: ['left', 'center', 'right', 'justify'].includes(st.align) ? st.align : null
  };
  // this computer's page, for the window's color at the next start
  if (next.pageTheme !== keptTheme) {
    keptTheme = next.pageTheme;
    try { if (readSettings().pageTheme !== keptTheme) writeSettings({ ...readSettings(), pageTheme: keptTheme }); } catch (err) { logError('settings', err); }
  }
  if (JSON.stringify(next) === JSON.stringify(viewState)) return;
  if (next.pageTheme !== viewState.pageTheme) {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && !w.isDestroyed()) w.setBackgroundColor(roomColor(next.pageTheme));
  }
  viewState = next;
  try { buildMenu(); } catch (err) { logError('menu', err); }
});
// File → New Books Open To: the pantser/plotter choice, kept in library.json
let writingStyle = 'pantser';
ipcMain.on('style:state', (_e, style) => {
  style = style === 'plotter' ? 'plotter' : 'pantser';
  if (style === writingStyle) return;
  writingStyle = style;
  try { buildMenu(); } catch (err) { logError('menu', err); }
});

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';
  // macOS and Windows name faces that ship with the OS. Linux has none of
  // them, so the menu names the faces bundled in fonts/ (see styles.css).
  // The Windows list stays the one the renderer already understands.
  const bodyFonts = isMac
    ? ['Georgia', 'Palatino', 'Baskerville', 'Hoefler Text', 'Iowan Old Style', 'Jost', 'iA Writer Quattro']
    : isWin
      ? ['Georgia', 'Palatino', 'Baskerville', 'Cambria', 'Constantia', 'Jost', 'iA Writer Quattro']
      : ['Gelasio', 'TeX Gyre Pagella', 'Libre Baskerville', 'Alegreya', 'Source Serif Pro', 'Jost', 'iA Writer Quattro'];
  const template = [
    // appMenu exists only on macOS — including it on Windows throws,
    // which is exactly what kept NEO from ever opening a window there
    ...(isMac ? [{
      role: 'appMenu',
      submenu: [
        { role: 'about', label: t('About NEO') },
        { type: 'separator' },
        { role: 'services', label: t('Services') },
        { type: 'separator' },
        { role: 'hide', label: t('Hide NEO') },
        { role: 'hideOthers', label: t('Hide Others') },
        { role: 'unhide', label: t('Show All') },
        { type: 'separator' },
        { role: 'quit', label: t('Quit NEO') }
      ]
    }] : []),
    {
      label: t('File'),
      submenu: [
        {
          label: t('Export'),
          submenu: scriptState.on ? [
            { label: 'PDF (.pdf)', click: () => sendToWindow({ type: 'export', format: 'pdf' }) },
            { label: 'Fountain (.fountain)', click: () => sendToWindow({ type: 'export', format: 'fountain' }) },
            { label: 'Final Draft (.fdx)', click: () => sendToWindow({ type: 'export', format: 'fdx' }) }
          ] : [
            { label: t('Plain Text (.txt)'), click: () => sendToWindow({ type: 'export', format: 'txt' }) },
            { label: 'Markdown (.md)', click: () => sendToWindow({ type: 'export', format: 'md' }) },
            { label: t('Web Page (.html)'), click: () => sendToWindow({ type: 'export', format: 'html' }) },
            { label: 'PDF (.pdf)', click: () => sendToWindow({ type: 'export', format: 'pdf' }) },
            { label: 'Word (.docx)', click: () => sendToWindow({ type: 'export', format: 'docx' }) },
            { label: 'EPUB (.epub)', click: () => sendToWindow({ type: 'export', format: 'epub' }) },
            { type: 'separator' },
            { label: t('Paperback for KDP…'), click: () => sendToWindow({ type: 'export', format: 'paperback' }) },
            { type: 'separator' },
            {
              id: 'export-custom-chapter-titles',
              label: t('Chapter Titles Only'),
              type: 'checkbox',
              checked: !!readJSON(LIBRARY_FILE, {}).exportCustomChapterTitles,
              click: (item) => sendToWindow({ type: 'exportCustomChapterTitles', checked: item.checked })
            }
          ]
        },
        { type: 'separator' },
        {
          label: t('Email Draft to Myself'),
          accelerator: 'CmdOrCtrl+E',
          click: () => sendToWindow({ type: 'emailDraft' })
        },
        { label: t('Email Settings…'), click: () => sendToWindow({ type: 'emailSettings' }) },
        { label: t('Cover Art…'), click: () => sendToWindow({ type: 'coverArt' }) },
        {
          label: t('Goals…'),
          accelerator: 'CmdOrCtrl+,',
          click: () => sendToWindow({ type: 'stats' })
        },
        {
          label: t('New Books Open To'),
          submenu: [
            { label: t('Blank Page'), type: 'radio', checked: writingStyle !== 'plotter', click: () => sendToWindow({ type: 'writingStyle', value: 'pantser' }) },
            { label: t('Outline First'), type: 'radio', checked: writingStyle === 'plotter', click: () => sendToWindow({ type: 'writingStyle', value: 'plotter' }) }
          ]
        },
        { type: 'separator' },
        {
          label: t('Import Manuscripts…'),
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => sendToWindow({ type: 'import' })
        },
        { label: t('Reshelve a Book…'), click: () => sendToWindow({ type: 'reshelve' }) },
        { label: t('Library Folder…'), click: () => { chooseLibraryFolder().catch((err) => logError('library folder', err)); } },
        { type: 'separator' },
        ...(isMac ? [{ role: 'close', label: t('Close Window') }] : [{ role: 'quit', label: t('Quit') }])
      ]
    },
    {
      // macOS slips Writing Tools and AutoFill into this menu on its own;
      // hideSystemEditItems() hides them again (see below)
      label: t('Edit'),
      submenu: [
        // standard items carry their own labels, so they follow NEO's language
        { role: 'undo', label: t('Undo') }, { role: 'redo', label: t('Redo') },
        { type: 'separator' },
        { role: 'cut', label: t('Cut') }, { role: 'copy', label: t('Copy') }, { role: 'paste', label: t('Paste') },
        { role: 'pasteAndMatchStyle', label: t('Paste and Match Style') }, { role: 'selectAll', label: t('Select All') },
        { type: 'separator' },
        {
          label: isMac ? t('Find & Replace') : t('Find & Replace').replace(/&/g, '&&'),
          accelerator: 'CmdOrCtrl+F',
          click: () => sendToWindow({ type: 'find' })
        },
        {
          label: t('Spellcheck Pass'),
          accelerator: 'CmdOrCtrl+;',
          // shown, not registered: the window answers the ; character itself
          // (isSpellcheckShortcut). Windows matches an accelerator by key
          // position, so on some layouts this one and ⌘/ landed on the same
          // key and one press did both (#282).
          registerAccelerator: false,
          click: () => sendToWindow({ type: 'spellcheck' })
        },
        {
          label: t('Spellcheck Language'),
          submenu: Object.entries(SPELL_LANGUAGES).map(([code, lang]) => ({
            label: lang.label,
            type: 'radio',
            checked: spellLanguage === code,
            click: () => sendToWindow({ type: 'spellLanguage', value: code })
          }))
        }
      ]
    },
    {
      label: t('Format'),
      submenu: [
        {
          visible: !scriptState.on, // a script is set in Courier Prime
          label: t('Body Font'),
          submenu: [
            // A font the writer picked from their own computer is not in the list, and a radio
            // group with nothing checked shows the first built-in as chosen. Show the font in use
            // (#295).
            ...(viewState.bodyFont && !bodyFonts.includes(viewState.bodyFont)
              ? [{
                  label: viewState.bodyFont,
                  type: 'radio',
                  checked: true,
                  click: () => sendToWindow({ type: 'bodyFont', value: viewState.bodyFont })
                }]
              : []),
            ...bodyFonts.map((f) => ({
              label: f,
              type: 'radio',
              checked: viewState.bodyFont === f,
              click: () => sendToWindow({ type: 'bodyFont', value: f })
            })),
            { type: 'separator' },
            { label: t('Other Font…'), click: () => sendToWindow({ type: 'bodyFontPick' }) }
          ]
        },
        {
          visible: !scriptState.on,
          label: t('Drop Cap Style'),
          submenu: [
            { label: t('Literary'), type: 'radio', checked: viewState.dropCap === 'literary', click: () => sendToWindow({ type: 'dropCap', value: 'literary' }) },
            { label: t('Fantasy'), type: 'radio', checked: viewState.dropCap === 'fantasy', click: () => sendToWindow({ type: 'dropCap', value: 'fantasy' }) },
            { label: t('Sci-Fi'), type: 'radio', checked: viewState.dropCap === 'scifi', click: () => sendToWindow({ type: 'dropCap', value: 'scifi' }) },
            { type: 'separator' },
            { label: t('Off'), type: 'radio', checked: viewState.dropCap === 'none', click: () => sendToWindow({ type: 'dropCap', value: 'none' }) }
          ]
        },
        {
          visible: !scriptState.on, // a script's elements are placed where they print
          label: t('Align Paragraph'),
          submenu: [
            { label: t('Left'), accelerator: 'CmdOrCtrl+Shift+L', type: 'radio', checked: viewState.align === 'left', click: () => sendToWindow({ type: 'align', value: 'left' }) },
            { label: t('Center'), accelerator: 'CmdOrCtrl+Shift+C', type: 'radio', checked: viewState.align === 'center', click: () => sendToWindow({ type: 'align', value: 'center' }) },
            { label: t('Right'), accelerator: 'CmdOrCtrl+Shift+R', type: 'radio', checked: viewState.align === 'right', click: () => sendToWindow({ type: 'align', value: 'right' }) },
            { label: t('Justify'), accelerator: 'CmdOrCtrl+Shift+J', type: 'radio', checked: viewState.align === 'justify', click: () => sendToWindow({ type: 'align', value: 'justify' }) }
          ]
        },
        { type: 'separator' },
        { label: t('Larger Text'), accelerator: 'CmdOrCtrl-Plus', click: () => sendToWindow({ type: 'fontSize', value: 1 }) },
        { label: t('Smaller Text'), accelerator: 'CmdOrCtrl-Minus', click: () => sendToWindow({ type: 'fontSize', value: -1 }) },
        { label: t('Reset Text Size'), accelerator: 'CmdOrCtrl+0', click: () => sendToWindow({ type: 'fontSize', value: 0 }) },
        { type: 'separator', visible: !scriptState.on },
        {
          visible: !scriptState.on, // a script has its own pages
          label: t('Show Pages'),
          type: 'checkbox',
          checked: pagesState.paged,
          click: () => sendToWindow({ type: 'pagedView' })
        },
        {
          visible: !scriptState.on,
          label: t('Two Pages Side by Side'),
          type: 'checkbox',
          checked: pagesState.twoUp,
          enabled: pagesState.paged, // greyed out until the pages are shown
          click: () => sendToWindow({ type: 'twoPageView' })
        },
        { type: 'separator' },
        {
          label: t('Typewriter Scrolling'),
          accelerator: 'CmdOrCtrl+Shift+T',
          type: 'checkbox',
          checked: typewriterState,
          click: () => sendToWindow({ type: 'typewriter' })
        },
        { type: 'separator' },
        // tick when the caret sits in one; the keys are the editor's own
        // (they split or continue a paragraph, which a menu item can't), so
        // they're named here without an accelerator
        // a script's elements stand where a book's paragraph kinds do
        ...(scriptState.on ? [
          [t('Scene Heading'), 'heading'], [t('Action'), 'action'], [t('Character'), 'character'], [t('Parenthetical'), 'paren'],
          [t('Dialogue'), 'dialogue'], [t('Transition'), 'transition'], [t('Shot'), 'shot']
        ].map(([label, value], i) => ({
          label: label + '\t' + (isMac ? '⌘' : 'Ctrl+') + (i + 1),
          type: 'radio',
          checked: scriptState.element === value,
          click: () => sendToWindow({ type: 'scriptElement', value })
        })) : []),
        // the script's own style, kept with that script
        ...(scriptState.on ? [
          { type: 'separator' },
          { label: t('Underline Scene Headings'), type: 'checkbox', checked: scriptState.underline, click: () => sendToWindow({ type: 'scriptStyle', value: 'underline' }) },
          { label: t('(CONT\'D) for a Returning Speaker'), type: 'checkbox', checked: scriptState.contd, click: () => sendToWindow({ type: 'scriptStyle', value: 'contd' }) }
        ] : []),
        {
          visible: !scriptState.on,
          label: t('Flush Paragraph') + '\t' + (isMac ? '⇧Enter' : 'Shift+Enter'),
          type: 'checkbox',
          checked: flushState,
          click: () => sendToWindow({ type: 'flush' })
        },
        {
          visible: !scriptState.on,
          label: t('Poetry Paragraph') + '\t' + (isMac ? '⇧⌘Enter' : 'Ctrl+Shift+Enter'),
          type: 'checkbox',
          checked: poetryState,
          click: () => sendToWindow({ type: 'poetry' })
        },
        { type: 'separator' },
        // *italic* and **bold** as you type or paste; off for writers who
        // keep literal asterisks
        {
          label: t('Markdown Emphasis'),
          type: 'checkbox',
          checked: !readJSON(LIBRARY_FILE, {}).markdownOff,
          click: (item) => sendToWindow({ type: 'markdownEmphasis', checked: item.checked })
        }
      ]
    },
    {
      label: t('View'),
      submenu: [
        {
          label: t('Keyboard Shortcuts…'),
          accelerator: 'CmdOrCtrl+/',
          registerAccelerator: false, // the window answers / and ? itself (isHelpShortcut)
          click: () => sendToWindow({ type: 'help' })
        },
        { type: 'separator' },
        {
          label: t('Full Screen'),
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => {
            const w = BrowserWindow.getFocusedWindow();
            if (w) w.setFullScreen(!w.isFullScreen());
          }
        },
        {
          label: t('Focus Mode'),
          submenu: [
            { label: t('Cycle'), accelerator: 'CmdOrCtrl+Shift+O', click: () => sendToWindow({ type: 'focusCycle' }) },
            { type: 'separator' },
            { label: t('Sentence'), type: 'radio', checked: viewState.focus === 'sentence', click: () => sendToWindow({ type: 'focus', value: 'sentence' }) },
            { label: t('Paragraph'), type: 'radio', checked: viewState.focus === 'paragraph', click: () => sendToWindow({ type: 'focus', value: 'paragraph' }) },
            { label: t('Off'), type: 'radio', checked: viewState.focus === 'off', click: () => sendToWindow({ type: 'focus', value: 'off' }) }
          ]
        },
        {
          label: t('Vim Keys'),
          type: 'checkbox',
          checked: vimState,
          click: () => sendToWindow({ type: 'vim' })
        },
        { type: 'separator' },
        {
          label: t('Page'),
          submenu: [
            { label: t('Night'), type: 'radio', checked: viewState.pageTheme !== 'paper' && viewState.pageTheme !== 'light', click: () => sendToWindow({ type: 'pageTheme', value: 'night' }) },
            { label: t('Paper'), type: 'radio', checked: viewState.pageTheme === 'paper', click: () => sendToWindow({ type: 'pageTheme', value: 'paper' }) },
            // white paper in a light room: the whole app, shelf included
            { label: t('Light'), type: 'radio', checked: viewState.pageTheme === 'light', click: () => sendToWindow({ type: 'pageTheme', value: 'light' }) }
          ]
        },
        {
          label: t('Brighter Interface'),
          type: 'checkbox',
          checked: viewState.uiBright,
          click: () => sendToWindow({ type: 'uiBright' })
        },
        {
          label: t('Interface Size'),
          // as far as the page zoom goes: 300%
          submenu: [1, 1.25, 1.5, 2, 2.5, 3].map((z) => ({
            label: z === 1 ? t('Normal') : new Intl.NumberFormat(uiLanguage || 'en', { style: 'percent' }).format(z),
            type: 'radio',
            checked: uiZoomState === z,
            click: () => sendToWindow({ type: 'uiZoom', value: z })
          }))
        },
        { type: 'separator' },
        {
          label: t('Language'),
          submenu: listLanguages().map((lang) => ({
            label: lang.name,
            type: 'radio',
            checked: uiLanguage === lang.code,
            click: () => setUiLanguage(lang.code)
          }))
        }
      ]
    },
    {
      role: 'windowMenu',
      label: t('Window'),
      submenu: [
        { role: 'minimize', label: t('Minimize') },
        { role: 'zoom', label: t('Zoom') },
        ...(isMac
          ? [{ type: 'separator' }, { role: 'front', label: t('Bring All to Front') }]
          : [{ role: 'close', label: t('Close') }])
      ]
    },
    {
      label: t('Help'),
      submenu: [
        {
          label: t('NEO Shortcuts'),
          click: () => sendToWindow({ type: 'help' })
        },
        { type: 'separator' },
        {
          label: t('About NEO'),
          click: () => sendToWindow({ type: 'about' })
        },
        {
          label: t('Check for Update…'),
          click: () => sendToWindow({ type: 'checkUpdate' })
        }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  editMenuState.edit = null; // the old menu bar is going: forget its Edit menu first
  Menu.setApplicationMenu(menu);
  if (isMac) {
    // macOS adds its items as the menu opens: NEO hears each addition
    // (watchEditMenu) and looks again whenever the menu opens
    const edit = menu.items.find((it) => it.submenu && it.label === t('Edit'));
    if (edit) {
      // NEO's own Edit items in order; null stands for a separator
      editMenuState.index = menu.items.indexOf(edit);
      editMenuState.ours = edit.submenu.items.map((it) => (it.type === 'separator' ? null : menuTitle(it.label)));
      watchEditMenu();
      setImmediate(hideSystemEditItems);
      edit.submenu.on('menu-will-show', hideSystemEditItems);
    }
  }
}

// No generative-AI tools in NEO — not now, not later.
//
// macOS inserts "Writing Tools" (Apple Intelligence) and "AutoFill" into
// any app's Edit menu while the menu is opening, and Electron has no
// switch for either. Deleting them doesn't last (macOS puts them back);
// hiding them does. NEO reaches the real menu through the Objective-C
// runtime (koffi, a small FFI library) and listens for the notice AppKit
// sends whenever an item is added to or changed in a menu. The moment
// anything lands in the Edit menu, NEO walks the menu alongside the one it
// built and hides every item that isn't its own, in any language. Should
// anything here fail, the menu is left as macOS made it: this never stops
// NEO from working.
let objc = null;
function objcRuntime() {
  if (objc) return objc;
  const koffi = require('koffi');
  const lib = koffi.load('/usr/lib/libobjc.A.dylib');
  const NoteIMP = koffi.proto('void NoteIMP(void *self, void *cmd, void *note)');
  objc = {
    koffi,
    NoteIMP,
    cls: lib.func('void *objc_getClass(const char *name)'),
    sel: lib.func('void *sel_registerName(const char *name)'),
    allocClass: lib.func('void *objc_allocateClassPair(void *superclass, const char *name, size_t extra)'),
    registerClass: lib.func('void objc_registerClassPair(void *cls)'),
    addMethod: lib.func('bool class_addMethod(void *cls, void *name, NoteIMP *imp, const char *types)'),
    // objc_msgSend, typed once per shape it is called with
    obj: lib.func('objc_msgSend', 'void *', ['void *', 'void *']),
    objAt: lib.func('objc_msgSend', 'void *', ['void *', 'void *', 'long']),
    objStr: lib.func('objc_msgSend', 'void *', ['void *', 'void *', 'const char *']),
    count: lib.func('objc_msgSend', 'long', ['void *', 'void *']),
    flag: lib.func('objc_msgSend', 'bool', ['void *', 'void *']),
    str: lib.func('objc_msgSend', 'const char *', ['void *', 'void *']),
    setFlag: lib.func('objc_msgSend', 'void', ['void *', 'void *', 'bool']),
    selName: lib.func('const char *sel_getName(void *sel)'),
    actionOf: lib.func('objc_msgSend', 'void *', ['void *', 'void *']),
    observe: lib.func('objc_msgSend', 'void', ['void *', 'void *', 'void *', 'void *', 'void *', 'void *'])
  };
  return objc;
}
const editMenuState = { index: -1, ours: [], edit: null, watching: false, hiding: false };
// macOS drops the & that Electron reads as a keyboard mnemonic ("Find & Replace"
// arrives as "Find  Replace"), so titles are compared without it
const menuTitle = (s) => String(s || '').replace(/&/g, '').replace(/\s+/g, ' ').trim();
// the actions Electron gives the items it builds: never macOS's own
const ELECTRON_ACTIONS = new Set(['itemSelected:', 'undo:', 'redo:', 'cut:', 'copy:', 'paste:', 'pasteAndMatchStyle:', 'selectAll:']);
const addr = (p) => (p ? objc.koffi.address(p) : 0n);
// the Edit menu as AppKit holds it right now
function nativeEditMenu() {
  const o = objcRuntime();
  const S = (name) => o.sel(name);
  const app = o.obj(o.cls('NSApplication'), S('sharedApplication'));
  const bar = app && o.obj(app, S('mainMenu'));
  const i = editMenuState.index;
  if (!bar || i < 0 || i >= o.count(bar, S('numberOfItems'))) return null;
  const item = o.objAt(bar, S('itemAtIndex:'), i);
  return item ? o.obj(item, S('submenu')) : null;
}
// hide what isn't NEO's; returns the menu as seen, for the log
function hideForeignItems(edit) {
  const o = objc;
  const S = (name) => o.sel(name);
  const ours = editMenuState.ours;
  const n = o.count(edit, S('numberOfItems'));
  const seen = [];
  let j = 0; // the next of NEO's own items to find, in order
  for (let i = 0; i < n; i++) {
    const item = o.objAt(edit, S('itemAtIndex:'), i);
    if (!item) continue;
    const sep = o.flag(item, S('isSeparatorItem'));
    const titleObj = sep ? null : o.obj(item, S('title'));
    const title = titleObj ? o.str(titleObj, S('UTF8String')) : '';
    const mine = j < ours.length && (sep ? ours[j] === null : ours[j] === menuTitle(title));
    if (mine) j++;
    else {
      // a safety net: whatever happens to titles, an item Electron made
      // for NEO is never the one hidden
      const act = sep ? null : o.actionOf(item, S('action'));
      const electrons = act && ELECTRON_ACTIONS.has(o.selName(act));
      if (!electrons && !o.flag(item, S('isHidden'))) o.setFlag(item, S('setHidden:'), true);
    }
    seen.push((mine ? '' : '[not NEO\'s] ') + (sep ? '—' : title));
  }
  return seen;
}
function hideSystemEditItems() {
  if (process.platform !== 'darwin' || editMenuState.hiding) return;
  editMenuState.hiding = true;
  try {
    const edit = editMenuState.edit || (editMenuState.edit = nativeEditMenu());
    if (edit) hideForeignItems(edit);
  } catch (err) {
    logError('edit menu', err);
  } finally {
    editMenuState.hiding = false;
  }
}
// a tiny Objective-C class whose one method AppKit calls whenever a menu
// gains or changes an item; it hides foreign items in the Edit menu
function watchEditMenu() {
  if (process.platform !== 'darwin' || editMenuState.watching) return;
  editMenuState.watching = true;
  try {
    const o = objcRuntime();
    const S = (name) => o.sel(name);
    // AppKit calls this for every menu in the app as items come and go
    // (mostly while a menu opens): one lookup, and a pass over the Edit
    // menu only when it's the Edit menu that changed
    const imp = o.koffi.register((_self, _cmd, note) => {
      try {
        if (editMenuState.hiding || !note) return;
        const menu = o.obj(note, S('object'));
        const edit = editMenuState.edit || (editMenuState.edit = nativeEditMenu());
        if (menu && edit && addr(menu) === addr(edit)) hideSystemEditItems();
      } catch (err) {
        logError('edit menu', err);
      }
    }, o.koffi.pointer(o.NoteIMP));
    let cls = o.allocClass(o.cls('NSObject'), 'NEOEditMenuWatcher', 0);
    if (cls) {
      o.addMethod(cls, S('neoMenuChanged:'), imp, 'v@:@');
      o.registerClass(cls);
    } else cls = o.cls('NEOEditMenuWatcher');
    const watcher = o.obj(o.obj(cls, S('alloc')), S('init'));
    const center = o.obj(o.cls('NSNotificationCenter'), S('defaultCenter'));
    for (const name of ['NSMenuDidAddItemNotification', 'NSMenuDidChangeItemNotification']) {
      const nsName = o.objStr(o.cls('NSString'), S('stringWithUTF8String:'), name);
      o.observe(center, S('addObserver:selector:name:object:'), watcher, S('neoMenuChanged:'), nsName, null);
    }
  } catch (err) {
    logError('edit menu', err);
  }
}

// Manual update check (Help → Check for Update…): a direct GitHub Releases
// lookup, separate from the silent auto-updater. Works in dev builds too.
let lastReleaseUrl = null;

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

// toggling at the session level forces the engine to re-scan visible text —
// newer Chromium ignores attribute changes on text it has already looked at
ipcMain.handle('app:version', () => app.getVersion());

// Updating
//
// Packaged builds keep themselves current without being asked: a few seconds
// after launch (and every few hours after that) NEO looks at the latest
// GitHub release, and if it's newer, electron-updater starts downloading it
// straight away, quietly. The new version goes in the next time NEO quits
// and opens again. Help → Check for Update… shows where that stands — most
// often it's already downloaded, and the window offers "Restart to update"
// (the page saves itself first). A build that can't self-update — `npm
// start`, the Windows portable .exe, anything unsigned — falls back to the
// release page on GitHub, as before.
let updater = null;          // electron-updater's autoUpdater, wired once
let updaterReady = false;    // an update is downloaded and waiting
// where the background download stands, so the window can pick it up mid-way
const upd = { state: 'idle', version: '', percent: 0, transferred: 0, total: 0, message: '' };
function getUpdater() {
  if (updater || !app.isPackaged) return updater;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.logger = null;
  autoUpdater.autoDownload = true;       // found it? fetch it — nobody should have to ask
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => {
    Object.assign(upd, { state: 'downloading', version: info && info.version || '', percent: 0, transferred: 0, total: 0, message: '' });
    sendToWindow({ type: 'update', ...upd });
  });
  autoUpdater.on('download-progress', (p) => {
    Object.assign(upd, { state: 'downloading', percent: p.percent, transferred: p.transferred, total: p.total });
    sendToWindow({ type: 'update', ...upd });
  });
  autoUpdater.on('update-downloaded', (info) => {
    updaterReady = true;
    Object.assign(upd, { state: 'ready', percent: 100 });
    if (info && info.version) upd.version = info.version;
    sendToWindow({ type: 'update', ...upd });
  });
  autoUpdater.on('error', (err) => {
    logError('updater', err);
    if (updaterReady) return; // a failed later look doesn't undo a finished download
    Object.assign(upd, { state: 'error', message: String(err && err.message || err) });
    sendToWindow({ type: 'update', ...upd });
  });
  updater = autoUpdater;
  return updater;
}

// one look at GitHub; if something newer is there, the download starts on
// its own (autoDownload). Never twice at once, and not again once it's here.
let updateLook = null;
function lookForUpdate() {
  const u = getUpdater();
  if (!u) return Promise.resolve(null);
  if (updaterReady || upd.state === 'downloading') return Promise.resolve(null);
  if (!updateLook) {
    updateLook = u.checkForUpdates()
      .catch((err) => { logError('updater', err); throw err; })
      .finally(() => { updateLook = null; });
  }
  return updateLook;
}

// what's on GitHub, for the fallback path and the release link
async function latestReleaseFromGitHub() {
  const res = await fetch('https://api.github.com/repos/hughhowey/neo/releases/latest', {
    headers: { 'User-Agent': 'NEO-App' }
  });
  if (!res.ok) throw new Error('GitHub API returned ' + res.status);
  const data = await res.json();
  lastReleaseUrl = data.html_url || null;
  return String(data.tag_name || '').replace(/^v/, '');
}

ipcMain.handle('update:check', async () => {
  const currentVersion = app.getVersion();
  try {
    const u = getUpdater();
    if (u) {
      // already on its way (or already here): just say where it is
      if (!updaterReady && upd.state !== 'downloading') {
        if (upd.state === 'error') upd.state = 'idle'; // asking again is a retry
        const result = await lookForUpdate();
        const v = result && result.updateInfo && result.updateInfo.version || '';
        if (v && compareVersions(v, currentVersion) > 0 && upd.state === 'idle') {
          Object.assign(upd, { state: 'downloading', version: v });
        }
      }
      latestReleaseFromGitHub().catch(() => {}); // the release link, for the fallback button
      const latestVersion = upd.version;
      const hasUpdate = !!latestVersion && compareVersions(latestVersion, currentVersion) > 0;
      return { ...upd, hasUpdate, latestVersion, currentVersion, canInstall: true, ready: updaterReady };
    }
  } catch (err) {
    logError('update', err); // fall through to the plain check
  }
  try {
    const latestVersion = await latestReleaseFromGitHub();
    return {
      hasUpdate: !!latestVersion && compareVersions(latestVersion, currentVersion) > 0,
      latestVersion,
      currentVersion,
      canInstall: false
    };
  } catch (err) {
    logError('update', err);
    return { error: true };
  }
});

ipcMain.handle('update:install', () => {
  const u = getUpdater();
  if (!u || !updaterReady) return false;
  setImmediate(() => u.quitAndInstall(false, true));
  return true;
});

// the renderer may only open the release page fetched above — never arbitrary URLs
ipcMain.handle('update:openRelease', () => {
  if (lastReleaseUrl && /^https:\/\/github\.com\//.test(lastReleaseUrl)) {
    require('electron').shell.openExternal(lastReleaseUrl);
  }
  return true;
});

// Two copies of NEO editing the same library is how words get eaten
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// The background look: a few seconds after launch, every hour after that
// for a writer who leaves NEO open for days, and whenever the computer
// wakes (a laptop lid is how most NEO sessions end and begin). Nothing pops
// up; any failure is logged and swallowed, so an offline machine or an
// unsigned build never notices.
const UPDATE_EVERY = 60 * 60 * 1000;
function checkForUpdates() {
  if (!app.isPackaged) return;
  const look = () => { lookForUpdate().catch(() => { /* logged in lookForUpdate */ }); };
  setTimeout(look, 8000);
  const timer = setInterval(look, UPDATE_EVERY);
  if (timer.unref) timer.unref();
  try {
    // after a wake the network needs a moment
    require('electron').powerMonitor.on('resume', () => setTimeout(look, 15000));
  } catch (err) { logError('updater', err); }
}

app.whenReady().then(() => {
  // Packaged builds get name/icon from electron-builder; this covers `npm start`.
  try {
    const devIcon = path.join(__dirname, 'build', 'icon.png');
    if (process.platform === 'darwin' && fs.existsSync(devIcon)) {
      if (app.dock) app.dock.setIcon(devIcon);
      app.setAboutPanelOptions({
        applicationName: 'NEO',
        applicationVersion: app.getVersion(),
        iconPath: devIcon
      });
    }
  } catch { /* cosmetic only */ }
  // Startup discipline: the window is created first, and every other step is
  // individually guarded so no single failure can leave the app running
  // invisibly with no window.
  try {
    // the real Documents folder (handles OneDrive-redirected Windows setups)
    try {
      LIBRARY_DIR = path.join(app.getPath('documents'), 'NEO Library');
      // …unless the writer chose their own folder (File → Library Folder…)
      const chosen = readSettings().libraryDir;
      if (chosen) LIBRARY_DIR = awaitChosenLibrary(chosen);
      LIBRARY_FILE = path.join(LIBRARY_DIR, 'library.json');
    } catch (err) {
      logError('paths', err);
    }

    // macOS press-and-hold accent picker can open invisibly inside Chromium
    // and re-emit swallowed keys as phantom repeated letters. Within NEO,
    // held keys simply repeat — which is what writers expect anyway.
    if (process.platform === 'darwin') {
      try {
        const { systemPreferences } = require('electron');
        systemPreferences.setUserDefault('ApplePressAndHoldEnabled', 'boolean', false);
        // macOS injects its own items into any menu named "Edit" —
        // these two official switches remove the ones writers can't use here
        systemPreferences.setUserDefault('NSDisabledDictationMenuItem', 'boolean', true);
        systemPreferences.setUserDefault('NSDisabledCharacterPaletteMenuItem', 'boolean', true);
        // AutoFill (contacts, passwords) has no business on a manuscript page
        systemPreferences.setUserDefault('NSAutoFillHeuristicControllerEnabled', 'boolean', false);
        // …and "Enter Full Screen" into the View menu, next to NEO's own
        // Full Screen item (⇧⌘F): one is enough
        systemPreferences.setUserDefault('NSFullScreenMenuItemEverywhere', 'boolean', false);
      } catch (err) {
        logError('prefs', err);
      }
    }

    try { initLanguage(); } catch (err) { logError('language', err); }
    try { checkLibraryWritable(); } catch (err) { logError('library check', err); }
    try { ensureLibrary(); } catch (err) { logError('library', err); }
    createWindow();
    try { announceLibraryFallback(); } catch (err) { logError('library notice', err); }
    try { initSpell(); } catch (err) { logError('spell', err); }
    try { buildMenu(); } catch (err) { logError('menu', err); }
    try { dailyBackup(); } catch (err) { logError('backup', err); }
    // NEO left open for days still makes each day's backup (and retries one
    // that failed); an existing day's zip makes this a no-op
    setInterval(() => { dailyBackup().catch(() => {}); }, 60 * 60 * 1000).unref?.();
    try { checkForUpdates(); } catch (err) { logError('updater', err); }
  } catch (err) {
    // catastrophic: tell the human instead of dying in silence
    logError('startup', err);
    try {
      dialog.showErrorBox(t('NEO failed to start'),
        t('Please report this at github.com/hughhowey/neo/issues:') + '\n\n' + String((err && err.stack) || err));
    } catch { /* nothing left to try */ }
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
