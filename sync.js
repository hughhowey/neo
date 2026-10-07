// NEO — sync with a CouchDB server of the writer's own (File → Sync…)
//
// The library stays what it always was: a folder of plain files. Sync keeps
// a copy of each one on a CouchDB server the writer runs, one document per
// file, its id the file's place in the library ("library.json",
// "book-…/chapters/ch-….html"), and brings home what the writer's other
// computers sent there. To the rest of NEO it is one more device writing
// into the folder, like iCloud or Syncthing: the window's own look at the
// disk (refreshFromDisk in app.js) takes in whatever arrives.
//
// What it keeps to, in the order NEO's rules give them:
//  - Words are never discarded. A file both computers changed keeps both: a
//    chapter's other version becomes the chapter after it, notes are set one
//    after the other, JSON is merged key by key with any text that loses put
//    in Darlings. A file the other computer removed goes to the system trash,
//    and only when nothing changed it here.
//  - A file that hasn't changed is never written. What each file held when it
//    last matched the server (its revision and fingerprint) is kept outside
//    the library, so a quiet library costs one small question to the server.
//  - Nothing interrupts. No dialogs from here: trouble waits in File → Sync…
//    and neo-errors.log.
//
// No PouchDB and no database on this side: CouchDB's own HTTP interface,
// through the fetch it is handed (Electron's net.fetch in NEO, which knows
// the computer's certificates and proxy).

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const NeoI18n = require('./i18n.js');
const { t } = NeoI18n;

const FORMAT = 1;             // the document layout below
const PAGE = 500;             // changes asked for at a time
const TICK = 30 * 1000;       // a look both ways, for whatever slipped past
const BATCH_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 4 * 1024 * 1024; // bigger text travels as an attachment

// ---------------------------------------------------------------------------
// Which files travel
// ---------------------------------------------------------------------------

// One name in a path: what libName() in main.js allows, less what Windows
// can't hold, so a mistaken or hostile document id never reaches outside the
// library or makes a file another computer can't open.
function safeSegment(s) {
  if (typeof s !== 'string' || !s || s === '.' || s === '..' || /[\\/<>:"|?*]/.test(s)) return false;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 32) return false;
  return true;
}

// NEO's own files: the text and the cover pictures. Not the .tmp and .bak a
// durable write leaves beside them, not dotfiles (.DS_Store, iCloud's
// stand-ins), not Backups, Exports, the error log or the catalog, which each
// computer keeps for itself.
const SYNCED_FILE = /^[^.].*\.(html|json|png|jpe?g|webp)$/i;
const TEXT_FILE = /\.(html|json)$/i;

// "library.json", "book-x/notes.html" or "book-x/chapters/ch-1.html"
function validPath(p) {
  if (p === 'library.json') return true;
  if (typeof p !== 'string') return false;
  const parts = p.split('/');
  if (parts.length < 2 || parts.length > 3) return false;
  if (!parts.every(safeSegment) || !parts[0].startsWith('book-')) return false;
  if (parts.length === 3 && parts[1] !== 'chapters') return false;
  return SYNCED_FILE.test(parts[parts.length - 1]);
}

// mtime, size and inode: NEO swaps a new file into place on every save, so
// even a save of the same length in the same millisecond reads as new
function stampOf(file) {
  try {
    const st = fs.statSync(file);
    return st.isFile() ? `${st.mtimeMs}:${st.size}:${st.ino}` : null;
  } catch {
    return null;
  }
}

// Every synced file in the library: path → { file, stamp }. `stubs` holds the
// files iCloud is keeping in the cloud just now (".name.icloud"): they are
// there, only not here, and must never read as deleted.
function listLocal(dir) {
  const files = new Map();
  const stubs = new Set();
  const look = (rel, abs) => {
    let names = [];
    try { names = fs.readdirSync(abs); } catch { return; }
    for (const name of names) {
      const stub = /^\.(.+)\.icloud$/.exec(name);
      if (stub) { stubs.add(rel + stub[1]); continue; }
      if (!validPath(rel + name)) continue;
      const file = path.join(abs, name);
      const stamp = stampOf(file);
      if (stamp) files.set(rel + name, { file, stamp });
    }
  };
  look('', dir);
  let books = [];
  try { books = fs.readdirSync(dir).filter((d) => d.startsWith('book-') && safeSegment(d)); } catch { /* no library here */ }
  for (const b of books) {
    look(b + '/', path.join(dir, b));
    look(b + '/chapters/', path.join(dir, b, 'chapters'));
  }
  return { files, stubs };
}

const fingerprint = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function readFile(file) {
  try { return fs.readFileSync(file); } catch { return null; }
}

// Text travels as text, readable in CouchDB's own pages; pictures (and text
// that isn't clean UTF-8, or is too long for one document) as an attachment
function asText(p, buf) {
  if (!TEXT_FILE.test(p) || buf.length > MAX_TEXT) return null;
  const s = buf.toString('utf8');
  return Buffer.from(s, 'utf8').equals(buf) ? s : null;
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', html: 'text/html', json: 'application/json' };
function makeDoc(p, buf, hash, rev, device) {
  const doc = { _id: p, neo: FORMAT, hash, size: buf.length, device: device || '', saved: new Date().toISOString() };
  if (rev) doc._rev = rev;
  const text = asText(p, buf);
  if (text !== null) {
    doc.text = text;
  } else {
    const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
    doc._attachments = { file: { content_type: MIME[ext] || 'application/octet-stream', data: buf.toString('base64') } };
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Two versions of one file
// ---------------------------------------------------------------------------

// The same word rule as chapterDiverged in main.js and wordsBeyond in app.js:
// true when `a` holds a word (or more of one) that `b` doesn't
function wordBag(html) {
  const m = new Map();
  for (const w of String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').split(/\s+/)) if (w) m.set(w, (m.get(w) || 0) + 1);
  return m;
}
function wordsBeyond(a, b) {
  const there = wordBag(b);
  for (const [w, n] of wordBag(a)) if (n > (there.get(w) || 0)) return true;
  return false;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// JSON with its keys in one order: two computers can write the same object
// with its keys listed differently
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : canon(x))).join(',') + ']';
  if (isObj(v)) {
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}
const sameJSON = (a, b) => canon(a) === canon(b);

// Three versions of a JSON file: this computer's (local), the server's
// (remote), and the one both came from (base; undefined for two files that
// never met, which merges as the union of the two). A change made on one side
// only is taken. Where both sides changed:
//  - objects merge key by key;
//  - lists merge item by item (by id, where the items have one): what either
//    side added stays, in its place, and what one side removed while the
//    other left it alone goes;
//  - something removed on one side and changed on the other stays, changed;
//  - otherwise `prefer` ('local' or 'remote') decides, and losing text with
//    words of its own goes to `lost` rather than nowhere.
// `pick` names top-level keys settled whole, by a rule of their own.
function mergeJSON(base, local, remote, opts = {}) {
  const prefer = opts.prefer === 'remote' ? 'remote' : 'local';
  const lost = opts.lost || (() => {});
  const pick = opts.pick || {};
  const key = (e) => (isObj(e) && typeof e.id === 'string' ? 'id:' + e.id : 'v:' + canon(e));
  const merge = (b, l, r, depth, name) => {
    if (sameJSON(l, r)) return l;
    if (sameJSON(b, l)) return r;
    if (sameJSON(b, r)) return l;
    if (l === undefined) return r;
    if (r === undefined) return l;
    if (depth === 1 && Object.prototype.hasOwnProperty.call(pick, name)) return pick[name](l, r);
    if (isObj(l) && isObj(r)) {
      const out = {};
      const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
      for (const k of [...Object.keys(l), ...Object.keys(r).filter((rk) => !own(l, rk))]) {
        if (k === '__proto__') continue; // never a key of NEO's, and never a prototype
        const v = merge(isObj(b) ? b[k] : undefined, l[k], r[k], depth + 1, k);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    if (Array.isArray(l) && Array.isArray(r)) {
      const B = new Map((Array.isArray(b) ? b : []).map((e) => [key(e), e]));
      const R = new Map(r.map((e) => [key(e), e]));
      const out = [];
      const placed = new Set();
      for (const e of l) {
        const k = key(e);
        if (placed.has(k)) continue;
        if (R.has(k)) out.push(merge(B.get(k), e, R.get(k), depth + 1, k));
        else if (B.has(k) && sameJSON(B.get(k), e)) continue; // removed there, untouched here
        else out.push(e); // new here, or changed here while removed there
        placed.add(k);
      }
      r.forEach((e, i) => {
        const k = key(e);
        if (placed.has(k)) return;
        if (B.has(k) && sameJSON(B.get(k), e)) return; // removed here, untouched there
        // after the nearest item before it that's already in place
        let at = 0;
        for (let j = i - 1; j >= 0; j--) {
          const pos = out.findIndex((x) => key(x) === key(r[j]));
          if (pos >= 0) { at = pos + 1; break; }
        }
        out.splice(at, 0, e);
        placed.add(k);
      });
      return out;
    }
    const [win, lose] = prefer === 'remote' ? [r, l] : [l, r];
    if (typeof lose === 'string' && /\s/.test(lose.trim()) && wordsBeyond(lose, typeof win === 'string' ? win : '')) lost(lose);
    return win;
  };
  return merge(base, local, remote, 0, '');
}

// A book stands on one shelf. Two computers that each moved it can leave it
// on two; it stays on the first.
function mergeLibrary(base, local, remote, prefer) {
  const lib = mergeJSON(base, local, remote, { prefer });
  if (!isObj(lib) || !Array.isArray(lib.shelves)) return lib;
  const seen = new Set();
  for (const s of lib.shelves) {
    if (!isObj(s) || !Array.isArray(s.bookIds)) continue;
    s.bookIds = s.bookIds.filter((id) => !seen.has(id) && seen.add(id));
  }
  return lib;
}

// book.json: the side saved last wins where both changed the same thing.
// Where the writer left off is one place, not a blend of two.
function mergeBook(base, local, remote, lost) {
  const newer = (a, b) => String((b && b.modified) || '') > String((a && a.modified) || '');
  return mergeJSON(base, local, remote, {
    prefer: newer(local, remote) ? 'remote' : 'local',
    lost,
    pick: {
      lastPosition: (l, r) => (((r && r.at) || 0) > ((l && l.at) || 0) ? r : l),
      modified: (l, r) => (String(r) > String(l) ? r : l)
    }
  });
}

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const shortTime = () => new Date().toLocaleTimeString(NeoI18n.getLocale(), { hour: 'numeric', minute: '2-digit' });
// a chapter that came from the other computer, titled the way app.js titles
// one found on disk (twinChapterTitle)
const fromOtherDevice = (title) => ((title || '') + ' ' + t('from other device, {time}', { time: shortTime() })).trim();
const newChapterId = () => 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);

// ---------------------------------------------------------------------------
// CouchDB, over HTTP
// ---------------------------------------------------------------------------

// What the writer typed in File → Sync…, as { url, db, user, password }. An
// address that carries a name and password (https://me:pw@host:5984) or the
// database (…:5984/novels) gives them to the fields left blank.
function normalizeConfig(input = {}) {
  let u;
  try { u = new URL(String(input.url || '').trim()); } catch { return { error: 'url' }; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !u.hostname) return { error: 'url' };
  const user = String(input.user || '').trim() || decodeURIComponent(u.username);
  const password = String(input.password || '') || decodeURIComponent(u.password);
  const parts = u.pathname.split('/').filter(Boolean);
  let db = String(input.db || '').trim();
  if (!db && parts.length) db = decodeURIComponent(parts.pop());
  if (!db) db = 'neo-library';
  // CouchDB's own rule for a database's name
  if (!/^[a-z][a-z0-9_$()+/-]*$/.test(db)) return { error: 'dbname' };
  return { url: u.origin + (parts.length ? '/' + parts.join('/') : ''), db, user, password };
}

function couch(config, fetchImpl, stopSignal) {
  const root = String(config.url || '').replace(/\/+$/, '');
  const base = root + '/' + encodeURIComponent(config.db);
  const headers = { Accept: 'application/json' };
  if (config.user) headers.Authorization = 'Basic ' + Buffer.from(config.user + ':' + (config.password || '')).toString('base64');
  const request = async (url, { method = 'GET', body, query, timeout = 60000, raw = false } = {}) => {
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    const signal = stopSignal ? AbortSignal.any([stopSignal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
    const res = await fetchImpl(url + qs, {
      method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal
    });
    if (raw && res.ok) return { status: res.status, ok: true, body: Buffer.from(await res.arrayBuffer()) };
    let data = null;
    try { data = await res.json(); } catch { /* not JSON: not CouchDB, or a proxy's page */ }
    return { status: res.status, ok: res.ok, data };
  };
  return {
    server: (o) => request(root + '/', o),
    db: (p, o) => request(base + p, o),
    doc: (id) => '/' + encodeURIComponent(id)
  };
}

function httpError(r) {
  const reason = r && r.data ? (r.data.reason || r.data.error || '') : '';
  const err = new Error(`CouchDB answered ${r ? r.status : '?'}${reason ? ': ' + reason : ''}`);
  err.code = r && r.status === 401 ? 'auth' : r && r.status === 403 ? 'forbidden' : r && r.status === 404 ? 'nodb' : 'http';
  err.detail = String((r && r.status) || '') + (reason ? ' ' + reason : '');
  return err;
}
// { code, detail } for File → Sync… to put in words (SYNC_TROUBLE in app.js)
function describeError(err) {
  if (err && ['auth', 'forbidden', 'nodb', 'http', 'library'].includes(err.code)) return { code: err.code, detail: err.detail || '' };
  const cause = err && err.cause;
  return { code: 'unreachable', detail: String((cause && (cause.code || cause.message)) || (err && err.message) || err) };
}

// File → Sync…: is there a CouchDB at that address, does it take this name
// and password, and is the database there (made, if not, when the account
// may). Answers { ok: true } or { ok: false, code, detail }.
async function connect(config, fetchImpl) {
  const db = couch(config, fetchImpl);
  try {
    const hello = await db.server({ timeout: 15000 });
    if (hello.status === 401) return { ok: false, ...describeError(httpError(hello)) };
    if (!hello.data || !hello.data.couchdb) return { ok: false, code: 'notcouch', detail: String(hello.status) };
    const info = await db.db('', { timeout: 15000 });
    if (info.status === 404) {
      const made = await db.db('', { method: 'PUT', timeout: 15000 });
      if (!made.ok && made.status !== 412) {
        const e = describeError(httpError(made));
        return { ok: false, code: e.code === 'auth' || e.code === 'forbidden' ? 'nodb' : e.code, detail: e.detail };
      }
    } else if (!info.ok) {
      return { ok: false, ...describeError(httpError(info)) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, ...describeError(err) };
  }
}

// ---------------------------------------------------------------------------
// The sync itself
// ---------------------------------------------------------------------------
//
//   config         { url, db, user, password, deviceId, device }
//   libraryDir     () → the library folder
//   stateFile      this library's bookkeeping, outside the library (losing it
//                  is safe: the next sync is a first one, and a first sync
//                  only adds and merges)
//   fetch          fetch(url, init)
//   writeFileDurable, logError    main.js's own
//   trash          (file) → Promise: the system trash (shell.trashItem)
//   onPulled       ({ library, books }) after files arrived
function createSync(opts) {
  const { config, libraryDir, stateFile, writeFileDurable, trash } = opts;
  const logError = opts.logError || (() => {});
  const onPulled = opts.onPulled || (() => {});
  const stopper = new AbortController();
  const db = couch(config, opts.fetch, stopper.signal);

  let started = false;
  let closed = false;
  let running = null;
  let again = false;
  let timer = null;
  let ticker = null;
  let retryIn = 0;
  let lastLogged = '';
  const pauses = new Set();
  const status = { state: 'idle', lastSync: null, error: null };

  // ---------- bookkeeping ----------
  const freshState = () => ({ since: '0', files: {}, bases: {} });
  function loadState() {
    try {
      const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (isObj(s) && isObj(s.files)) return { since: String(s.since || '0'), files: s.files, bases: isObj(s.bases) ? s.bases : {} };
    } catch { /* none yet, or unreadable: a first sync, which is safe */ }
    return freshState();
  }
  let state = loadState();
  function saveState() {
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      writeFileDurable(stateFile, JSON.stringify(state));
    } catch (err) {
      logError('sync state', err);
    }
  }
  // what a file held at its last revision on the server: the fingerprint
  // (and, for JSON, the text itself: the base of the next merge)
  function record(p, rev, buf, stamp) {
    state.files[p] = { rev, hash: fingerprint(buf), stamp: stamp || null };
    if (p.endsWith('.json')) state.bases[p] = buf.toString('utf8');
    else delete state.bases[p];
  }
  function forget(p) {
    delete state.files[p];
    delete state.bases[p];
  }

  // ---------- the library ----------
  const abs = (p) => path.join(libraryDir(), ...p.split('/'));
  // a library on a drive that isn't there just now (unplugged, a network
  // folder not mounted): nothing is written into the empty mount point, and
  // nothing in it reads as deleted
  const libraryHere = () => fs.existsSync(path.join(libraryDir(), 'library.json'));
  function writeLocal(p, buf) {
    const file = abs(p);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // the version being replaced, while it reads whole, becomes the .bak, as
    // writeJSON does in main.js
    if (p.endsWith('.json')) {
      try {
        JSON.parse(fs.readFileSync(file, 'utf8'));
        fs.copyFileSync(file, file + '.bak');
      } catch { /* nothing whole to keep */ }
    }
    writeFileDurable(file, buf);
    return stampOf(file);
  }
  function readJSONFile(p) {
    try { return JSON.parse(fs.readFileSync(abs(p), 'utf8')); } catch { return undefined; }
  }
  const jsonBuffer = (v) => Buffer.from(JSON.stringify(v, null, 2));

  // ---------- from the server ----------
  async function fetchChange(ch) {
    const p = ch.id;
    if (!validPath(p)) return null; // design documents, or not a library file
    const rev = (ch.doc && ch.doc._rev) || (ch.changes && ch.changes[0] && ch.changes[0].rev);
    const known = state.files[p];
    if (known && known.rev === rev) return null; // ours, back from the server, or already here
    if (ch.deleted) return { p, rev, deleted: true };
    const doc = ch.doc;
    if (!doc || !(doc.neo >= 1)) return null;
    let buf = typeof doc.text === 'string' ? Buffer.from(doc.text, 'utf8') : null;
    if (!buf && doc._attachments && doc._attachments.file) {
      const a = await db.db(db.doc(p) + '/file', { raw: true, query: { rev } });
      if (!a.ok) throw httpError(a);
      buf = a.body;
    }
    if (!buf) return null;
    if (doc.hash && fingerprint(buf) !== doc.hash) {
      logError('sync', new Error(`${p} on the server doesn't match its fingerprint; left as it is here`));
      return null;
    }
    return { p, rev, buf };
  }

  async function pull() {
    let since = state.since || '0';
    let library = null; // library.json waits for the books it lists
    const touched = { library: false, books: new Set(), kept: new Set() };
    for (;;) {
      const r = await db.db('/_changes', { query: { since, include_docs: 'true', limit: String(PAGE) } });
      if (!r.ok || !r.data || !Array.isArray(r.data.results)) throw httpError(r);
      const page = [];
      for (const ch of r.data.results) {
        const item = await fetchChange(ch);
        if (!item) continue;
        if (item.p === 'library.json') library = item;
        else page.push(item);
      }
      if (page.length) await apply(page, touched);
      if (r.data.last_seq !== undefined) since = r.data.last_seq;
      const pending = r.data.pending;
      if (!r.data.results.length || pending === 0 || (pending === undefined && r.data.results.length < PAGE)) break;
    }
    if (library) await apply([library], touched);
    if (touched.kept.size && reshelve([...touched.kept])) touched.library = true;
    // only now: a pull cut short starts again from where it began (what it
    // already took is known by revision, and isn't taken twice)
    if (String(since) !== state.since) {
      state.since = String(since);
      saveState();
    }
    if (touched.library || touched.books.size) onPulled({ library: touched.library, books: [...touched.books] });
  }

  // Everything that came is decided and written in one go, with no waiting
  // in between: the window's own saves (IPC, on this same thread) land
  // before or after, never in the middle of a merge. Only the trash waits,
  // after.
  async function apply(items, touched) {
    const jobs = []; // for the system trash
    try {
      decide(items, touched, jobs);
    } finally {
      saveState();
    }
    for (const job of jobs) await toTrash(job);
    if (jobs.length) saveState();
  }

  function decide(items, touched, jobs) {
    const listings = []; // chapters that must stand in their book's chapter list
    const lostText = new Map(); // bookId → text that lost a merge, for Darlings
    const basesBefore = { ...state.bases }; // each book's chapter list as last synced
    // chapters and notes first, book.json after them, so a chapter list
    // never names a chapter that hasn't arrived
    const rank = (p) => (p.endsWith('/book.json') ? 1 : 0);
    items.sort((a, b) => rank(a.p) - rank(b.p));
    // books the other computer put in the trash
    const goneBooks = new Set(items.filter((it) => it.deleted && it.p.endsWith('/book.json')).map((it) => it.p.split('/')[0]));
    for (const it of items) {
      const bookId = it.p === 'library.json' ? null : it.p.split('/')[0];
      if (it.deleted && goneBooks.has(bookId)) continue; // decided whole, below
      if (decideOne(it, jobs, listings, lostText)) {
        if (bookId) touched.books.add(bookId); else touched.library = true;
      }
    }
    for (const bookId of goneBooks) {
      const kept = decideGoneBook(bookId, jobs);
      if (kept === 'trash') touched.books.add(bookId);
      else if (kept === 'kept') touched.kept.add(bookId);
    }
    for (const [bookId, texts] of lostText) keepInDarlings(bookId, texts);
    listChapters(listings, basesBefore);
  }

  // one file; true when the library changed
  function decideOne(it, jobs, listings, lostText) {
    const { p, rev } = it;
    const file = abs(p);
    const known = state.files[p];
    const here = readFile(file);
    const hereHash = here && fingerprint(here);
    const untouched = !!here && !!known && hereHash === known.hash; // as at the last sync
    const parts = p.split('/');
    const chapter = parts[1] === 'chapters' && p.endsWith('.html');

    if (it.deleted) {
      if (!here) { forget(p); return false; }
      if (untouched) {
        // removed on the other computer, unchanged here: to the trash
        jobs.push({ file, check: [[p, hereHash]] });
        forget(p);
        return true;
      }
      // removed there, changed here: this version stays, and goes back up
      forget(p);
      if (chapter) listings.push({ bookId: parts[0], chId: parts[2].slice(0, -5) });
      return false;
    }

    const there = it.buf;
    if (here && hereHash === fingerprint(there)) {
      record(p, rev, there, stampOf(file));
      return false;
    }
    if (!here || untouched) {
      // An empty copy doesn't wipe words (an empty read must not, in app.js
      // either): this text stays, and goes up
      if (here && p.endsWith('.html') && !there.toString('utf8').replace(/<[^>]*>/g, '').trim() && here.toString('utf8').replace(/<[^>]*>/g, '').trim()) {
        record(p, rev, there, null);
        return false;
      }
      const stamp = writeLocal(p, there);
      record(p, rev, there, stamp);
      // removed here, changed there: back in its book
      if (!here && known && chapter) listings.push({ bookId: parts[0], chId: parts[2].slice(0, -5), retitle: true });
      return true;
    }

    // Changed on both computers. The server's version becomes the base for
    // what this computer sends next; this computer's file becomes the two,
    // together.
    if (p.endsWith('.json')) {
      const lost = [];
      const merged = mergeFile(p, known ? state.bases[p] : undefined, here, there, lost);
      if (lost.length) lostText.set(parts[0], [...(lostText.get(parts[0]) || []), ...lost]);
      const changed = !merged.equals(here);
      record(p, rev, there, null);
      if (changed) writeLocal(p, merged);
      return changed;
    }
    if (p.endsWith('.html')) {
      const a = here.toString('utf8');
      const b = there.toString('utf8');
      record(p, rev, there, null);
      if (!wordsBeyond(b, a)) return false; // theirs has no word this lacks: this stands
      if (!wordsBeyond(a, b)) { // this has no word theirs lacks: theirs stands
        state.files[p].stamp = writeLocal(p, there);
        return true;
      }
      if (chapter) {
        // the other computer's chapter goes in right after this one
        const twinId = newChapterId();
        writeLocal(parts[0] + '/chapters/' + twinId + '.html', there);
        listings.push({ bookId: parts[0], chId: twinId, after: parts[2].slice(0, -5), retitle: true });
      } else {
        // notes and the like: both, one after the other
        writeLocal(p, Buffer.from(a + '<p>' + escHtml(fromOtherDevice('')) + '</p>' + b, 'utf8'));
      }
      return true;
    }
    // a picture changed on both: this computer's stands
    record(p, rev, there, null);
    return false;
  }

  function mergeFile(p, baseText, here, there, lost) {
    const parse = (buf) => { try { return JSON.parse(String(buf)); } catch { return undefined; } };
    const l = parse(here);
    const r = parse(there);
    if (r === undefined) return here; // theirs doesn't read: this stands
    if (l === undefined) return there;
    const b = baseText === undefined ? undefined : parse(baseText);
    let out;
    // two libraries that never met: the server's settings are the ones the
    // writer's other computers already share
    if (p === 'library.json') out = mergeLibrary(b, l, r, b === undefined ? 'remote' : 'local');
    else if (p.endsWith('/book.json')) out = mergeBook(b, l, r, (s) => lost.push(s));
    else if (Array.isArray(l) && Array.isArray(r)) out = mergeJSON(b, l, r); // Darlings, comments
    else return here; // art.json and the like: this computer's stands
    return jsonBuffer(out);
  }

  // The other computer put a whole book in the trash. Unchanged here, it goes
  // to this computer's trash too, as one folder. Changed here at all, it all
  // stays, and goes back up whole, so the book is never left in pieces.
  function decideGoneBook(bookId, jobs) {
    const prefix = bookId + '/';
    const dir = abs(bookId);
    const { files } = listLocal(libraryDir());
    const mine = [...files.keys()].filter((p) => p.startsWith(prefix));
    const check = [];
    let changed = false;
    for (const p of mine) {
      const buf = readFile(files.get(p).file);
      const known = state.files[p];
      const hash = buf && fingerprint(buf);
      if (!known || hash !== known.hash) changed = true;
      check.push([p, hash]);
    }
    for (const p of Object.keys(state.files)) if (p.startsWith(prefix)) forget(p);
    if (!mine.length) return null;
    if (changed) return 'kept';
    jobs.push({ file: dir, check });
    return 'trash';
  }

  // A book kept here that the other computer put in the trash goes back on a
  // shelf (the first), where the writer will see it, on both computers
  function reshelve(bookIds) {
    const lib = readJSONFile('library.json');
    if (!isObj(lib) || !Array.isArray(lib.shelves)) return false;
    const shelf = lib.shelves.find((s) => isObj(s) && Array.isArray(s.bookIds));
    if (!shelf) return false;
    const shelved = new Set(lib.shelves.flatMap((s) => (isObj(s) && Array.isArray(s.bookIds) ? s.bookIds : [])));
    const missing = bookIds.filter((id) => !shelved.has(id) && fs.existsSync(abs(id + '/book.json')));
    if (!missing.length) return false;
    shelf.bookIds.push(...missing);
    writeLocal('library.json', jsonBuffer(lib));
    saveState();
    return true;
  }

  // A file (or a book's folder) the other computer removed. Looked at once
  // more first: anything saved here since stays, and goes back up. If the
  // trash won't take it, it stays too, and goes back up.
  async function toTrash(job) {
    for (const [p, hash] of job.check) {
      const buf = readFile(abs(p));
      if (!buf || fingerprint(buf) !== hash) return;
    }
    try {
      await trash(job.file);
    } catch (err) {
      logError('sync trash', err);
    }
  }

  // Chapters that must stand in their book's list: one from the other
  // computer beside its twin, or one removed on one side and written on the
  // other. A book.json that isn't here is left for rebuildBookMeta in main.js,
  // which finds every chapter file.
  function listChapters(listings, basesBefore) {
    const byBook = new Map();
    for (const l of listings) byBook.set(l.bookId, [...(byBook.get(l.bookId) || []), l]);
    for (const [bookId, list] of byBook) {
      const p = bookId + '/book.json';
      const meta = readJSONFile(p);
      if (!isObj(meta) || !Array.isArray(meta.chapterOrder)) continue;
      const order = meta.chapterOrder;
      let before = [];
      try { before = JSON.parse(basesBefore[p]).chapterOrder || []; } catch { /* never synced */ }
      let changed = false;
      for (const { chId, after, retitle } of list) {
        if (order.includes(chId)) continue;
        // its place: right after its twin, or after whatever stood before it
        // when the two computers last agreed, or at the end
        let at = order.length;
        if (after) {
          if (order.includes(after)) at = order.indexOf(after) + 1;
        } else if (before.includes(chId)) {
          const prev = before.slice(0, before.indexOf(chId)).reverse().find((c) => order.includes(c));
          at = prev ? order.indexOf(prev) + 1 : 0;
        }
        order.splice(at, 0, chId);
        if (retitle) {
          meta.chapterTitles = isObj(meta.chapterTitles) ? meta.chapterTitles : {};
          meta.chapterTitles[chId] = fromOtherDevice(meta.chapterTitles[after || chId]);
        }
        changed = true;
      }
      if (!changed) continue;
      meta.modified = new Date().toISOString();
      writeLocal(p, jsonBuffer(meta));
    }
  }

  // text that lost a merge in book.json (an outline note both computers
  // rewrote, say) is a darling: the writer finds it, and puts it back
  function keepInDarlings(bookId, texts) {
    const p = bookId + '/darlings.json';
    const list = readJSONFile(p);
    const darlings = Array.isArray(list) ? list : [];
    const date = new Date().toISOString();
    darlings.unshift(...texts.map((text, i) => ({
      id: 'd-' + Date.now().toString(36) + 's' + i,
      html: '<p>' + escHtml(text).replace(/\n+/g, '</p><p>') + '</p>',
      text,
      chapterId: null,
      chapterLabel: t('text changed on two devices'),
      date
    })));
    writeLocal(p, jsonBuffer(darlings));
  }

  // ---------- to the server ----------
  // true when the server had moved on for some file (another computer wrote
  // it): a pull settles it, and this goes again
  async function push() {
    if (!libraryHere()) return false;
    const { files, stubs } = listLocal(libraryDir());
    const out = [];
    let restamped = false;
    for (const [p, { file, stamp }] of files) {
      const known = state.files[p];
      if (known && known.stamp === stamp) continue;
      const buf = readFile(file);
      if (!buf) continue;
      const hash = fingerprint(buf);
      if (known && known.hash === hash) { known.stamp = stamp; restamped = true; continue; }
      out.push({ p, buf, stamp, doc: makeDoc(p, buf, hash, known && known.rev, config.device) });
    }
    for (const p of Object.keys(state.files)) {
      if (files.has(p) || stubs.has(p)) continue;
      out.push({ p, gone: true, doc: { _id: p, _rev: state.files[p].rev, _deleted: true } });
    }
    let behind = false;
    for (const batch of batches(out)) {
      const r = await db.db('/_bulk_docs', { method: 'POST', body: { docs: batch.map((x) => x.doc) } });
      if (r.status === 413 && batch.length === 1) {
        logError('sync', new Error(`${batch[0].p} is too large for the server to take`));
        continue;
      }
      if (!r.ok || !Array.isArray(r.data)) throw httpError(r);
      const byId = new Map(r.data.map((res) => [res.id, res]));
      for (const x of batch) {
        const res = byId.get(x.p);
        if (res && res.ok) {
          if (x.gone) forget(x.p); else record(x.p, res.rev, x.buf, x.stamp);
        } else if (res && res.error === 'conflict') {
          behind = true;
        } else {
          logError('sync', new Error(`${x.p} wasn't saved on the server: ${res ? res.error + ' ' + (res.reason || '') : 'no answer'}`));
        }
      }
      saveState();
    }
    if (restamped && !out.length) saveState(); // files touched but not changed: not read again
    return behind;
  }

  function batches(list) {
    const out = [];
    let cur = [];
    let size = 0;
    for (const x of list) {
      const n = x.buf ? x.buf.length * 1.4 : 100;
      if (cur.length && (size + n > BATCH_BYTES || cur.length >= 100)) { out.push(cur); cur = []; size = 0; }
      cur.push(x);
      size += n;
    }
    if (cur.length) out.push(cur);
    return out;
  }

  // A database made anew (the server rebuilt, the database deleted and made
  // again) holds none of what this computer remembers sending. NEO leaves a
  // note of its own there, a _local document, which never travels to another
  // server; when the note is gone, the library syncs afresh, as on the first
  // day, and nothing here reads as deleted.
  async function checkServer() {
    const id = '/_local/' + encodeURIComponent('neo-' + (config.deviceId || 'device'));
    const r = await db.db(id);
    if (r.status === 404) {
      if (state.since !== '0' || Object.keys(state.files).length) {
        logError('sync', new Error('the database on the server is new to this computer; syncing the library afresh'));
        state = freshState();
        saveState();
      }
      const w = await db.db(id, { method: 'PUT', body: { device: config.device || '', first: new Date().toISOString() } });
      if (!w.ok) throw httpError(w);
    } else if (!r.ok) {
      throw httpError(r);
    }
  }

  // ---------- when ----------
  async function cycle() {
    if (!libraryHere()) throw Object.assign(new Error('the library folder isn\'t there'), { code: 'library' });
    status.state = 'syncing';
    await checkServer();
    for (let round = 0; round < 3; round++) {
      await pull();
      if (!(await push())) break;
    }
    status.state = 'idle';
    status.error = null;
    status.lastSync = new Date().toISOString();
  }

  function run() {
    if (closed) return Promise.resolve();
    if (running) { again = true; return running; }
    running = (async () => {
      for (;;) {
        again = false;
        try {
          await cycle();
          retryIn = 0;
          lastLogged = '';
        } catch (err) {
          if (closed) return;
          status.state = 'error';
          status.error = describeError(err);
          // said once in the log, not every half minute
          if (err.message !== lastLogged) { lastLogged = err.message; logError('sync', err); }
          retryIn = Math.min(retryIn ? retryIn * 2 : 15000, 5 * 60 * 1000);
          schedule(retryIn);
          return;
        }
        if (!again || closed) return; // saved again while this ran: once more
      }
    })().finally(() => { running = null; });
    return running;
  }

  function schedule(ms) {
    if (!started) return;
    clearTimeout(timer);
    timer = setTimeout(run, ms);
    if (timer.unref) timer.unref();
  }

  // something was saved here: off it goes, once the saving settles (a
  // server that isn't answering is asked again on its own schedule)
  function nudge(ms = 1500) {
    if (!started || (status.state === 'error' && retryIn)) return;
    schedule(ms);
  }

  function pause(ms) {
    return new Promise((resolve) => {
      const p = { resolve, timer: null };
      p.timer = setTimeout(() => { pauses.delete(p); resolve(); }, ms);
      if (p.timer.unref) p.timer.unref();
      pauses.add(p);
    });
  }

  // The long look: the server answers as soon as anything changes there (or
  // after fifty quiet seconds, to be asked again), so a chapter written on
  // the other computer is here in moments
  async function watch() {
    for (;;) {
      if (!started) return;
      try {
        const r = await db.db('/_changes', { query: { feed: 'longpoll', since: state.since || '0', timeout: '50000', limit: '1' }, timeout: 75000 });
        if (!started) return;
        if (!r.ok) throw httpError(r);
        if (r.data && Array.isArray(r.data.results) && r.data.results.length) {
          const before = state.since;
          await run();
          if (state.since === before && started) await pause(TICK); // nothing taken in: don't spin
        }
      } catch {
        if (!started) return;
        await pause(Math.max(retryIn, 15000));
      }
    }
  }

  function start() {
    if (started || closed) return;
    started = true;
    ticker = setInterval(() => nudge(0), TICK);
    if (ticker.unref) ticker.unref();
    run().then(() => { if (started) watch(); });
  }

  async function stop() {
    started = false;
    closed = true;
    clearTimeout(timer);
    clearInterval(ticker);
    stopper.abort();
    for (const p of pauses) { clearTimeout(p.timer); p.resolve(); }
    pauses.clear();
    if (running) await running.catch(() => {});
  }

  // before quitting (or turning sync off): what this computer saved goes up,
  // if the server answers in time
  async function flush(ms = 4000) {
    if (closed) return;
    await Promise.race([run(), pause(ms)]);
  }

  return {
    start,
    stop,
    nudge,
    flush,
    syncNow: run,
    status: () => ({ ...status })
  };
}

module.exports = {
  createSync,
  connect,
  normalizeConfig,
  mergeJSON,
  mergeLibrary,
  mergeBook,
  sameJSON,
  validPath,
  wordsBeyond
};
