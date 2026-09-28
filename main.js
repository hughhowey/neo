// NEO — main process
// Owns the window and all file-system access. The renderer talks to this
// through the IPC handlers below (see preload.js for the exposed API).

const { app, BrowserWindow, ipcMain, dialog, Menu, MenuItem, utilityProcess, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// macOS Chromium's "smart delete" also removes whitespace around a deleted
// selection, and that pass can duplicate characters. Deletes stay literal.
app.commandLine.appendSwitch('blink-settings', 'smartInsertDeleteEnabled=false');

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
  fs.writeFileSync(settingsPath(), JSON.stringify(obj, null, 2));
}

// File → Library Folder…: point NEO at any folder, or back at the default.
// The library is plain files, so the writer moves them; NEO only follows.
async function chooseLibraryFolder() {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const defaultDir = path.join(app.getPath('documents'), 'NEO Library');
  const custom = LIBRARY_DIR !== defaultDir;
  const ask = await dialog.showMessageBox(win, {
    type: 'question',
    message: 'Library folder',
    detail: `Your books live in:\n${LIBRARY_DIR}\n\nChoose another folder and NEO restarts there. Existing books stay where they are — move the files yourself if you want them along.`,
    buttons: custom ? ['Choose Folder…', 'Use Default Folder', 'Cancel'] : ['Choose Folder…', 'Cancel'],
    defaultId: 0,
    cancelId: custom ? 2 : 1
  });
  let next = null;
  if (ask.response === 0) {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose a folder for your NEO library',
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

function ensureLibrary() {
  if (!fs.existsSync(LIBRARY_DIR)) fs.mkdirSync(LIBRARY_DIR, { recursive: true });
  if (!fs.existsSync(LIBRARY_FILE)) {
    const seed = {
      authorName: '',
      penNames: [],
      firstRunDone: false,
      pageTheme: 'night',
      shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
    };
    fs.writeFileSync(LIBRARY_FILE, JSON.stringify(seed, null, 2));
  }
}

function bookDir(bookId) {
  return path.join(LIBRARY_DIR, bookId);
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
        lines.push(`${m.title || 'Untitled'}  —  ${d}  —  shelf: ${onShelf[m.id] || '(none — removed from shelves)'}`);
      } catch { /* not a valid book folder */ }
    }
    lines.sort((a, b) => a.localeCompare(b));
    fs.writeFileSync(path.join(LIBRARY_DIR, '_catalog.txt'),
      'NEO LIBRARY CATALOG — which folder is which book\n' +
      '(regenerated automatically; edits here do nothing)\n\n' +
      lines.join('\n') + '\n');
  } catch (err) {
    logError('catalog', err);
  }
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file); // atomic-ish: never leave a half-written file
}

// ---------------------------------------------------------------------------
// IPC — the renderer's whole view of the disk
// ---------------------------------------------------------------------------

ipcMain.handle('library:read', () => {
  ensureLibrary();
  return readJSON(LIBRARY_FILE, null);
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
  // so the library reads like a bookshelf in Finder too
  const slug = String(meta.title || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const id = 'book-' + (slug ? slug + '-' : '') +
    Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const dir = bookDir(id);
  fs.mkdirSync(path.join(dir, 'chapters'), { recursive: true });
  const book = {
    id,
    title: meta.title || 'Untitled',
    subtitle: '',
    series: '',
    author: meta.author || 'Anonymous',
    wordGoal: 0,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    chapterOrder: [],
    tabNames: { notes: 'Notes', outline: 'Outline' }
  };
  writeJSON(path.join(dir, 'book.json'), book);
  fs.writeFileSync(path.join(dir, 'notes.html'), '');
  fs.writeFileSync(path.join(dir, 'outline.html'), '');
  writeJSON(path.join(dir, 'darlings.json'), []);
  writeJSON(path.join(dir, 'stickies.json'), []);
  return book;
});

// every book folder in the library, shelved or not — for File → Reshelve
ipcMain.handle('library:listBooks', () => {
  const out = [];
  try {
    for (const d of fs.readdirSync(LIBRARY_DIR)) {
      if (!d.startsWith('book-')) continue;
      const m = readJSON(path.join(LIBRARY_DIR, d, 'book.json'), null);
      if (m && m.id) out.push({ id: m.id, title: m.title || 'Untitled', author: m.author || '', modified: m.modified || '' });
    }
  } catch (err) { logError('listBooks', err); }
  return out;
});

ipcMain.handle('book:readMeta', (_e, bookId) => {
  return readJSON(path.join(bookDir(bookId), 'book.json'), null);
});

ipcMain.handle('book:writeMeta', (_e, bookId, meta) => {
  meta.modified = new Date().toISOString();
  writeJSON(path.join(bookDir(bookId), 'book.json'), meta);
  writeCatalog();
  return meta.modified;
});

ipcMain.handle('chapter:read', (_e, bookId, chapterId) => {
  const file = path.join(bookDir(bookId), 'chapters', chapterId + '.html');
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
});

ipcMain.handle('chapter:write', (_e, bookId, chapterId, html) => {
  const dir = path.join(bookDir(bookId), 'chapters');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, chapterId + '.html'), html);
  return true;
});

ipcMain.handle('chapter:delete', (_e, bookId, chapterId) => {
  const file = path.join(bookDir(bookId), 'chapters', chapterId + '.html');
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return true;
});

ipcMain.handle('aux:read', (_e, bookId, name) => {
  // name: 'notes' | 'outline'
  const file = path.join(bookDir(bookId), name + '.html');
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
});

ipcMain.handle('aux:write', (_e, bookId, name, html) => {
  fs.writeFileSync(path.join(bookDir(bookId), name + '.html'), html);
  return true;
});

ipcMain.handle('json:read', (_e, bookId, name, fallback) => {
  return readJSON(path.join(bookDir(bookId), name + '.json'), fallback);
});

ipcMain.handle('json:write', (_e, bookId, name, data) => {
  writeJSON(path.join(bookDir(bookId), name + '.json'), data);
  return true;
});

ipcMain.handle('book:delete', async (_e, bookId, title) => {
  const win = BrowserWindow.getFocusedWindow();
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Cancel', process.platform === 'win32' ? 'Move to Recycle Bin' : 'Move to Trash'],
    defaultId: 0,
    cancelId: 0,
    message: `Move “${title}” to the ${process.platform === 'win32' ? 'Recycle Bin' : 'Trash'}?`,
    detail: 'The book folder goes to your system trash, so you can recover it.'
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
        message: 'NEO couldn’t move that folder to the Trash.',
        detail: 'The book is untouched. Its folder is highlighted so you can deal with it yourself.'
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
    title: 'Choose cover art',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: COVER_EXTS }]
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
  clearCovers(dir);
  const fname = 'cover-' + Date.now() + '.' + (ext === 'jpeg' ? 'jpg' : ext);
  fs.copyFileSync(srcPath, path.join(dir, fname));
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
    if (!apiKey) return { error: 'No API key for ' + provider + ' — add one under File → Cover Art…' };
    const dir = bookDir(bookId);
    if (!fs.existsSync(dir)) return { error: 'Book folder is missing' };
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

async function renderPDF(html) {
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  // Letter is a North American habit; most of the world prints A4.
  const letterCountries = ['US', 'CA', 'MX', 'PH'];
  try {
    await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    return await pdfWin.webContents.printToPDF({
      pageSize: letterCountries.includes(app.getLocaleCountryCode()) ? 'Letter' : 'A4',
      margins: { top: 1, bottom: 1, left: 1, right: 1 },
      printBackground: false
    });
  } finally {
    pdfWin.destroy();
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

ipcMain.handle('export:save', async (_e, { format, defaultName, content, zipEntries }) => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(os.homedir(), 'Documents', defaultName + '.' + format),
    filters: [{ name: format.toUpperCase(), extensions: [format] }]
  });
  if (canceled || !filePath) return null;
  if (zipEntries) {
    fs.writeFileSync(filePath, await buildZip(zipEntries));
  } else if (format === 'pdf') {
    fs.writeFileSync(filePath, await renderPDF(content));
  } else {
    fs.writeFileSync(filePath, content, 'utf8');
  }
  return filePath;
});

// Writes a timestamped snapshot to the library's Exports folder, then hands it
// to your email — an outside-the-machine paper trail for provenance.
ipcMain.handle('email:draft', async (_e, { to, subject, body, html, defaultName, method }) => {
  const { shell } = require('electron');
  const exportsDir = path.join(LIBRARY_DIR, 'Exports');
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(exportsDir, `${defaultName}-${stamp}.pdf`);
  fs.writeFileSync(file, await renderPDF(html));

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

const decodeEntities = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'");

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
    raw[m[1]] = { basedOn, bold: docxFormatOn(rpr, 'w:b'), italic: docxFormatOn(rpr, 'w:i') };
  }
  const resolve = (id, depth) => {
    if (out[id]) return out[id];
    const st = raw[id];
    if (!st || depth > 8) return { bold: false, italic: false };
    const base = st.basedOn ? resolve(st.basedOn, depth + 1) : { bold: false, italic: false };
    out[id] = {
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
  // Any heading style (Heading1..9, or bare "Heading") starts a new chapter and
  // gives it its title — regardless of locale, the underlying style id is
  // always "Heading*".
  const pStyle = (p.match(/<w:pStyle\s+w:val="([^"]*)"/) || [])[1] || '';
  const heading = /^heading\d*$/i.test(pStyle);
  // Google Docs exports each of a document's tabs under a "Title"-styled
  // line, and the book's own title page uses the same style: the first one
  // names the book, later ones start chapters (see chapterize)
  const title = /^title$/i.test(pStyle);
  // what the paragraph's style says, before any run has its say
  const pBase = styles[pStyle] || { bold: false, italic: false };
  const runs = [...p.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)].map((rm) => {
    const r = rm[0];
    const rpr = (r.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
    const text = [...r.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((t) => decodeEntities(t[1])).join('');
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
  const text = merged.map((run) => {
    let t = run.text;
    if (run.bold) t = '**' + t + '**';
    if (run.italic) t = '*' + t + '*';
    return t;
  }).join('').trim();
  return { text, pageBreak, heading, title };
}

async function importFile(fp) {
  const name = path.basename(fp).replace(/\.[^.]+$/, '');
  const ext = path.extname(fp).toLowerCase();
  let paras = [];

  if (ext === '.docx') {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(fs.readFileSync(fp));
    const docFile = zip.file('word/document.xml');
    if (!docFile) throw new Error('Not a valid .docx: ' + fp);
    const xml = await docFile.async('string');
    const stylesFile = zip.file('word/styles.xml');
    const styles = docxStyleFormats(stylesFile ? await stylesFile.async('string') : '');
    paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
      .map((m) => docxParagraphToMarkdown(m[0], styles));
  } else {
    const raw = fs.readFileSync(fp, 'utf8');
    paras = raw.split(/\r?\n\s*\r?\n/)
      .map((b) => ({ text: b.replace(/\s*\r?\n\s*/g, ' ').trim(), pageBreak: false }))
      .filter((p) => p.text);
  }

  // Chapterize: page breaks and heading lines start new chapters. Headings
  // include "Chapter N" styles plus bare chapter numbers — "7", "VII",
  // "Seven" — which get stripped so NEO's own numbering doesn't duplicate them.
  const SPELLED = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\.?$/i;
  const isNumeralish = (t) => /^\d{1,3}\.?$/.test(t) || /^[IVXLC]{1,7}\.?$/.test(t) || SPELLED.test(t);
  // Bare numbers only count as chapter markers when there's a ladder of them —
  // a story that merely OPENS with "Seven." keeps its seven.
  const numeralMode = paras.filter((p) => p.text && isNumeralish(p.text.trim())).length >= 2;
  // A markdown heading: one or more "#" then text — any "size" (depth) counts.
  const isMdHeading = (t) => /^#{1,6}\s+\S/.test(t);
  const mdTitleOf = (t) => t.replace(/^#{1,6}\s*/, '').trim();
  // A heading that is purely NEO's own numbering ("Chapter 2", "Prologue",
  // bare "7") carries no title — NEO numbers chapters itself.
  const isNumberedHeading = (t) => (
    (/^(chapter|prologue|epilogue|part)\b/i.test(t) && t.length < 60) ||
    (numeralMode && isNumeralish(t))
  );
  const isHeading = (t) => t && (isMdHeading(t) || isNumberedHeading(t));
  // The chapter title that a heading contributes. Markdown hashes and any
  // emphasis markers are stripped, and pure numbering yields no title.
  const titleOf = (t) => {
    if (isMdHeading(t)) t = mdTitleOf(t);
    t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/_([^_]+)_/g, '$1');
    return isNumberedHeading(t) ? '' : t;
  };
  const isBreak = (t) => /^\s*([*#•~⁂—–-]\s*){1,7}$/.test(t || '');

  let styledTitle = null; // a Title-styled first line: the book's name
  const chapterize = (usePageBreaks) => {
    const chapters = [];
    let cur = [];
    let curTitle = '';
    let seenProse = false;
    let lastWasHeading = false;
    styledTitle = null;
    const close = () => {
      if (cur.length) chapters.push({ title: curTitle, paras: cur });
      cur = [];
      curTitle = '';
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
      if (isH) { curTitle = titleOf(p.text || ''); lastWasHeading = true; continue; } // the heading line is replaced by NEO's numbering
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
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const first = chapters[0];
  if (first && first.paras.length) {
    const t0 = (first.paras[0].text || '').trim();
    const t1 = first.paras.length > 1 ? (first.paras[1].text || '').trim() : '';
    const titleish = t0 && t0.length < 90 && !/[.!?]$/.test(t0) && (
      (norm(t0).length > 3 && norm(name).includes(norm(t0))) ||
      /^by\s+\S/i.test(t1) ||
      (t0 === t0.toUpperCase() && /[A-Z].*[A-Z]/.test(t0) && t0.length < 60)
    );
    if (titleish) {
      title = t0;
      first.paras.shift();
    }
    const bl = first.paras.length ? (first.paras[0].text || '').trim().match(/^by\s+(.{2,60})$/i) : null;
    if (bl) {
      author = bl[1].trim();
      first.paras.shift();
    }
    if (!first.paras.length) chapters.shift();
    if (!chapters.length) chapters.push({ title: '', paras: [{ text: '' }] });
  }

  return { name, title, author, chapters };
}

// Same parsing as the picker, but for files dropped from Finder/Explorer
ipcMain.handle('import:files', async (_e, paths) => {
  const out = [];
  for (const fp of paths || []) {
    if (!/\.(docx|txt|md)$/i.test(fp)) continue;
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
    title: 'Bring your manuscripts home',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Manuscripts', extensions: ['docx', 'txt', 'md'] }]
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
  try {
    ensureLibrary();
    const line = `[${new Date().toISOString()}] [${source}] ${err && err.stack ? err.stack : String(err)}\n`;
    fs.appendFileSync(ERROR_LOG(), line);
  } catch { /* never let logging crash the app */ }
}

process.on('uncaughtException', (err) => logError('main', err));
process.on('unhandledRejection', (err) => logError('main-promise', err));
ipcMain.handle('log:error', (_e, msg) => logError('renderer', msg));

// One zip of the whole library per day, keeping the last 14. Cheap insurance.
async function dailyBackup() {
  try {
    ensureLibrary();
    const backupsDir = path.join(LIBRARY_DIR, 'Backups');
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const target = path.join(backupsDir, `neo-backup-${today}.zip`);
    if (fs.existsSync(target)) return;

    const JSZip = require('jszip');
    const zip = new JSZip();
    const skip = new Set(['Backups', 'Exports']);
    const walk = (dir, rel) => {
      for (const name of fs.readdirSync(dir)) {
        if (rel === '' && skip.has(name)) continue;
        const full = path.join(dir, name);
        const relPath = rel ? rel + '/' + name : name;
        const stat = fs.statSync(full);
        if (stat.isDirectory()) walk(full, relPath);
        else zip.file(relPath, fs.readFileSync(full));
      }
    };
    walk(LIBRARY_DIR, '');
    fs.writeFileSync(target, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

    // prune old backups
    const backups = fs.readdirSync(backupsDir).filter((f) => f.startsWith('neo-backup-')).sort();
    while (backups.length > 14) fs.unlinkSync(path.join(backupsDir, backups.shift()));
  } catch (err) {
    logError('backup', err);
  }
}

// ---------------------------------------------------------------------------
// Window
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
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#191919',
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
  const remember = () => {
    if (win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return;
    writeSettings({ ...readSettings(), window: win.getNormalBounds() });
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('close', remember);

  // NEO does its own spellchecking (see spell:* handlers) — the engine's
  // checker proved unreliable at scanning existing text, so it stays off
  win.webContents.session.setSpellCheckerEnabled(false);
}

// ---------------------------------------------------------------------------
// Spellcheck: NEO's own bundled Hunspell dictionaries via nspell, identical
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
  'fr': { label: 'French', pkg: 'dictionary-fr' },
  'es': { label: 'Spanish', pkg: 'dictionary-es' },
  'de': { label: 'German', pkg: 'dictionary-de' }
};

// The dictionary work runs in a helper process (spell-worker.js): parsing
// French takes seconds, and the writing room must never wait for it.
let spellChild = null;
let spellSeq = 0;
const spellWaiting = new Map();

function spellRequest(msg) {
  return new Promise((resolve) => {
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
  const res = await spellRequest({ type: 'load', dir: path.join(__dirname, 'node_modules', entry.pkg), custom });
  if (!res.ok) { logError('spell', new Error(res.error || 'dictionary failed to load')); return false; }
  spellLanguage = known;
  return true;
}

function initSpell() {
  let code = 'en-US';
  try { code = readJSON(LIBRARY_FILE, {}).spellLanguage || 'en-US'; } catch { /* fresh library */ }
  loadSpellDictionary(code);
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
let typewriterState = false;
ipcMain.on('poetry:state', (_e, on) => {
  on = !!on;
  if (on === poetryState) return;
  poetryState = on;
  try { buildMenu(); } catch (err) { logError('menu', err); }
});
ipcMain.on('typewriter:state', (_e, on) => {
  on = !!on;
  if (on === typewriterState) return;
  typewriterState = on;
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
    ? ['Georgia', 'Palatino', 'Baskerville', 'Hoefler Text', 'Iowan Old Style']
    : isWin
      ? ['Georgia', 'Palatino', 'Baskerville', 'Cambria', 'Constantia']
      : ['Gelasio', 'TeX Gyre Pagella', 'Libre Baskerville', 'Alegreya', 'Source Serif Pro'];
  const template = [
    // appMenu exists only on macOS — including it on Windows throws,
    // which is exactly what kept NEO from ever opening a window there
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Export',
          submenu: [
            { label: 'Plain Text (.txt)', click: () => sendToWindow({ type: 'export', format: 'txt' }) },
            { label: 'Markdown (.md)', click: () => sendToWindow({ type: 'export', format: 'md' }) },
            { label: 'Web Page (.html)', click: () => sendToWindow({ type: 'export', format: 'html' }) },
            { label: 'PDF (.pdf)', click: () => sendToWindow({ type: 'export', format: 'pdf' }) },
            { label: 'Word (.docx)', click: () => sendToWindow({ type: 'export', format: 'docx' }) },
            { label: 'EPUB (.epub)', click: () => sendToWindow({ type: 'export', format: 'epub' }) }
          ]
        },
        { type: 'separator' },
        {
          label: 'Email Draft to Myself',
          accelerator: 'CmdOrCtrl+E',
          click: () => sendToWindow({ type: 'emailDraft' })
        },
        { label: 'Email Settings…', click: () => sendToWindow({ type: 'emailSettings' }) },
        { label: 'Cover Art…', click: () => sendToWindow({ type: 'coverArt' }) },
        {
          label: 'Goals…',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendToWindow({ type: 'stats' })
        },
        {
          label: 'New Books Open To',
          submenu: [
            { label: 'Blank Page', type: 'radio', checked: writingStyle !== 'plotter', click: () => sendToWindow({ type: 'writingStyle', value: 'pantser' }) },
            { label: 'Outline First', type: 'radio', checked: writingStyle === 'plotter', click: () => sendToWindow({ type: 'writingStyle', value: 'plotter' }) }
          ]
        },
        { type: 'separator' },
        {
          label: 'Import Manuscripts…',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => sendToWindow({ type: 'import' })
        },
        { label: 'Reshelve a Book…', click: () => sendToWindow({ type: 'reshelve' }) },
        { label: 'Library Folder…', click: () => { chooseLibraryFolder().catch((err) => logError('library folder', err)); } },
        { type: 'separator' },
        ...(isMac ? [{ role: 'close' }] : [{ role: 'quit' }])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'pasteAndMatchStyle' }, { role: 'selectAll' },
        { type: 'separator' },
        {
          label: isMac ? 'Find & Replace' : 'Find && Replace',
          accelerator: 'CmdOrCtrl+F',
          click: () => sendToWindow({ type: 'find' })
        },
        {
          label: 'Spellcheck Pass',
          accelerator: 'CmdOrCtrl+;',
          click: () => sendToWindow({ type: 'spellcheck' })
        },
        {
          label: 'Spellcheck Language',
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
      label: 'Format',
      submenu: [
        {
          label: 'Body Font',
          submenu: [
            ...bodyFonts.map((f) => ({
              label: f,
              click: () => sendToWindow({ type: 'bodyFont', value: f })
            })),
            { type: 'separator' },
            { label: 'Other Font…', click: () => sendToWindow({ type: 'bodyFontPick' }) }
          ]
        },
        {
          label: 'Drop Cap Style',
          submenu: [
            { label: 'Literary', click: () => sendToWindow({ type: 'dropCap', value: 'literary' }) },
            { label: 'Fantasy', click: () => sendToWindow({ type: 'dropCap', value: 'fantasy' }) },
            { label: 'Sci-Fi', click: () => sendToWindow({ type: 'dropCap', value: 'scifi' }) },
            { type: 'separator' },
            { label: 'Off', click: () => sendToWindow({ type: 'dropCap', value: 'none' }) }
          ]
        },
        {
          label: 'Align Paragraph',
          submenu: [
            { label: 'Left', accelerator: 'CmdOrCtrl+Shift+L', click: () => sendToWindow({ type: 'align', value: 'left' }) },
            { label: 'Center', accelerator: 'CmdOrCtrl+Shift+C', click: () => sendToWindow({ type: 'align', value: 'center' }) },
            { label: 'Right', accelerator: 'CmdOrCtrl+Shift+R', click: () => sendToWindow({ type: 'align', value: 'right' }) },
            { label: 'Justify', accelerator: 'CmdOrCtrl+Shift+J', click: () => sendToWindow({ type: 'align', value: 'justify' }) }
          ]
        },
        { type: 'separator' },
        { label: 'Larger Text', accelerator: 'CmdOrCtrl-Plus', click: () => sendToWindow({ type: 'fontSize', value: 1 }) },
        { label: 'Smaller Text', accelerator: 'CmdOrCtrl-Minus', click: () => sendToWindow({ type: 'fontSize', value: -1 }) },
        { label: 'Reset Text Size', accelerator: 'CmdOrCtrl+0', click: () => sendToWindow({ type: 'fontSize', value: 0 }) },
        { type: 'separator' },
        {
          label: 'Typewriter Scrolling',
          accelerator: 'CmdOrCtrl+Shift+T',
          type: 'checkbox',
          checked: typewriterState,
          click: () => sendToWindow({ type: 'typewriter' })
        },
        { type: 'separator' },
        // ticks when the caret sits in a poetry paragraph; ⇧Enter is the
        // editor's own key, so no accelerator here
        {
          label: 'Poetry Paragraph\t⇧Enter',
          type: 'checkbox',
          checked: poetryState,
          click: () => sendToWindow({ type: 'poetry' })
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Full Screen',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => {
            const w = BrowserWindow.getFocusedWindow();
            if (w) w.setFullScreen(!w.isFullScreen());
          }
        },
        {
          label: 'Focus Mode',
          submenu: [
            { label: 'Cycle', accelerator: 'CmdOrCtrl+Shift+O', click: () => sendToWindow({ type: 'focusCycle' }) },
            { type: 'separator' },
            { label: 'Sentence', click: () => sendToWindow({ type: 'focus', value: 'sentence' }) },
            { label: 'Paragraph', click: () => sendToWindow({ type: 'focus', value: 'paragraph' }) },
            { label: 'Off', click: () => sendToWindow({ type: 'focus', value: 'off' }) }
          ]
        },
        { type: 'separator' },
        {
          label: 'Page',
          submenu: [
            { label: 'Night', click: () => sendToWindow({ type: 'pageTheme', value: 'night' }) },
            { label: 'Paper', click: () => sendToWindow({ type: 'pageTheme', value: 'paper' }) }
          ]
        },
        {
          label: 'Brighter Interface',
          click: () => sendToWindow({ type: 'uiBright' })
        }
      ]
    },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        {
          label: 'NEO Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => sendToWindow({ type: 'help' })
        },
        { type: 'separator' },
        {
          label: 'About NEO',
          click: () => sendToWindow({ type: 'about' })
        },
        {
          label: 'Check for Update…',
          click: () => sendToWindow({ type: 'checkUpdate' })
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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

ipcMain.handle('update:check', async () => {
  try {
    const res = await fetch('https://api.github.com/repos/hughhowey/neo/releases/latest', {
      headers: { 'User-Agent': 'NEO-App' }
    });
    if (!res.ok) throw new Error('GitHub API returned ' + res.status);
    const data = await res.json();
    const latestVersion = String(data.tag_name || '').replace(/^v/, '');
    const currentVersion = app.getVersion();
    lastReleaseUrl = data.html_url || null;
    return {
      hasUpdate: !!latestVersion && compareVersions(latestVersion, currentVersion) > 0,
      latestVersion,
      currentVersion
    };
  } catch (err) {
    logError('update', err);
    return { error: true };
  }
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

// Auto-update from GitHub releases. Deliberately defensive: any failure is
// logged and swallowed, so an unsigned build or offline machine never notices.
// (macOS auto-update only works once the app is code-signed.)
function checkForUpdates() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.logger = null;
    autoUpdater.on('error', (err) => logError('updater', err));
    autoUpdater.checkForUpdatesAndNotify().catch((err) => logError('updater', err));
  } catch (err) {
    logError('updater', err);
  }
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
      if (chosen && fs.existsSync(chosen) && fs.statSync(chosen).isDirectory()) LIBRARY_DIR = chosen;
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
        // …and "Enter Full Screen" into the View menu, next to NEO's own
        // Full Screen item (⇧⌘F): one is enough
        systemPreferences.setUserDefault('NSFullScreenMenuItemEverywhere', 'boolean', false);
      } catch (err) {
        logError('prefs', err);
      }
    }

    try { ensureLibrary(); } catch (err) { logError('library', err); }
    createWindow();
    try { initSpell(); } catch (err) { logError('spell', err); }
    try { buildMenu(); } catch (err) { logError('menu', err); }
    try { dailyBackup(); } catch (err) { logError('backup', err); }
    try { checkForUpdates(); } catch (err) { logError('updater', err); }
  } catch (err) {
    // catastrophic: tell the human instead of dying in silence
    logError('startup', err);
    try {
      dialog.showErrorBox('NEO failed to start',
        'Please report this at github.com/hughhowey/neo/issues:\n\n' + String((err && err.stack) || err));
    } catch { /* nothing left to try */ }
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
