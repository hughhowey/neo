'use strict';

// sync.js against a CouchDB of its own: a small server in this file that
// answers the way CouchDB 3 does for the calls sync.js makes (opaque
// sequence strings, revisions and 409 conflicts, tombstones a new write may
// stand on, attachments read back as stubs, _local documents, longpoll).
// Two computers are two library folders, each with its own sync.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { after, describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const NeoSync = require(path.join(root, 'sync.js'));
const { createSync, connect, normalizeConfig, mergeJSON, mergeLibrary, validPath } = NeoSync;

// ---------------------------------------------------------------------------
// the server
// ---------------------------------------------------------------------------

function fakeCouch({ user = 'writer', password = 'pages' } = {}) {
  const auth = 'Basic ' + Buffer.from(user + ':' + password).toString('base64');
  const dbs = new Map();
  let waiting = [];
  // CouchDB 3's sequences are opaque strings; a client must not count on them
  const seqStr = (n) => n + '-g1AAAAB' + Buffer.from('seq' + n).toString('base64url');
  const seqNum = (s) => parseInt(String(s), 10) || 0;
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const docJson = (id, d) => {
    if (d.deleted) return { _id: id, _rev: d.rev, _deleted: true };
    const out = { _id: id, _rev: d.rev, ...d.body };
    if (d.attachment) out._attachments = { file: { content_type: d.attachment.type, revpos: 1, digest: 'md5-x', length: d.attachment.data.length, stub: true } };
    return out;
  };
  function write(db, doc) {
    const id = doc._id;
    const cur = db.docs.get(id);
    const conflict = { id, error: 'conflict', reason: 'Document update conflict.' };
    if (cur && !cur.deleted && doc._rev !== cur.rev) return conflict;
    if (cur && cur.deleted && doc._rev && doc._rev !== cur.rev) return conflict;
    if (!cur && doc._rev) return conflict;
    if (doc._deleted && (!cur || cur.deleted)) return { id, error: 'not_found', reason: 'missing' };
    const gen = cur ? parseInt(cur.rev, 10) + 1 : 1;
    const body = { ...doc };
    for (const k of ['_id', '_rev', '_deleted', '_attachments']) delete body[k];
    let attachment = null;
    const a = doc._attachments && doc._attachments.file;
    if (a) attachment = a.stub ? cur && cur.attachment : { type: a.content_type, data: Buffer.from(a.data, 'base64') };
    const rev = gen + '-' + crypto.createHash('md5').update(JSON.stringify(doc) + gen).digest('hex');
    db.seq += 1;
    db.docs.set(id, { rev, deleted: !!doc._deleted, body: doc._deleted ? {} : body, attachment: doc._deleted ? null : attachment, seq: db.seq });
    const wake = waiting;
    waiting = [];
    for (const w of wake) w();
    return { ok: true, id, rev };
  }
  function changes(db, since, includeDocs, limit) {
    const from = since === 'now' ? db.seq : seqNum(since);
    const all = [...db.docs.entries()].filter(([, d]) => d.seq > from).sort((a, b) => a[1].seq - b[1].seq);
    const page = limit ? all.slice(0, limit) : all;
    return {
      results: page.map(([id, d]) => ({
        seq: seqStr(d.seq), id, changes: [{ rev: d.rev }],
        ...(d.deleted ? { deleted: true } : {}),
        ...(includeDocs ? { doc: docJson(id, d) } : {})
      })),
      last_seq: seqStr(page.length ? page[page.length - 1][1].seq : Math.max(from, db.seq)),
      pending: all.length - page.length
    };
  }
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.headers.authorization !== auth) return json(res, 401, { error: 'unauthorized', reason: 'Name or password is incorrect.' });
      const u = new URL(req.url, 'http://couch');
      const segs = u.pathname.split('/').slice(1).filter((s, i) => s || i === 0).map(decodeURIComponent);
      const q = (k) => u.searchParams.get(k);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      if (segs.length === 1 && segs[0] === '') return json(res, 200, { couchdb: 'Welcome', version: '3.3.3' });
      const db = dbs.get(segs[0]);
      if (segs.length === 1) {
        if (req.method === 'PUT') {
          if (db) return json(res, 412, { error: 'file_exists', reason: 'The database could not be created, the file already exists.' });
          dbs.set(segs[0], { seq: 0, docs: new Map(), local: new Map() });
          return json(res, 201, { ok: true });
        }
        if (req.method === 'DELETE') { dbs.delete(segs[0]); return json(res, 200, { ok: true }); }
        if (!db) return json(res, 404, { error: 'not_found', reason: 'Database does not exist.' });
        return json(res, 200, { db_name: segs[0], update_seq: seqStr(db.seq) });
      }
      if (!db) return json(res, 404, { error: 'not_found', reason: 'Database does not exist.' });
      if (segs[1] === '_changes') {
        const limit = q('limit') ? parseInt(q('limit'), 10) : 0;
        const answer = () => json(res, 200, changes(db, q('since') || '0', q('include_docs') === 'true', limit));
        if (q('feed') !== 'longpoll' || changes(db, q('since') || '0', false, 1).results.length) return answer();
        const timer = setTimeout(() => { waiting = waiting.filter((w) => w !== go); answer(); }, parseInt(q('timeout') || '60000', 10));
        const go = () => { clearTimeout(timer); answer(); };
        waiting.push(go);
        return;
      }
      if (segs[1] === '_bulk_docs') return json(res, 201, body.docs.map((d) => write(db, d)));
      if (segs[1] === '_local') {
        const id = segs[2];
        if (req.method === 'PUT') { db.local.set(id, body); return json(res, 201, { ok: true, id: '_local/' + id, rev: '0-1' }); }
        return db.local.has(id) ? json(res, 200, { _id: '_local/' + id, _rev: '0-1', ...db.local.get(id) }) : json(res, 404, { error: 'not_found', reason: 'missing' });
      }
      const d = db.docs.get(segs[1]);
      if (segs[2] === 'file') {
        if (!d || !d.attachment) return json(res, 404, { error: 'not_found', reason: 'Document is missing attachment' });
        res.writeHead(200, { 'Content-Type': d.attachment.type });
        return res.end(d.attachment.data);
      }
      if (!d) return json(res, 404, { error: 'not_found', reason: 'missing' });
      return json(res, d.deleted ? 404 : 200, d.deleted ? { error: 'not_found', reason: 'deleted' } : docJson(segs[1], d));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}`, dbs, close: () => new Promise((resolve) => { for (const w of waiting) w(); server.close(resolve); server.closeAllConnections(); }) });
  }));
}

// ---------------------------------------------------------------------------
// two computers
// ---------------------------------------------------------------------------

function durable(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

const open = [];
function computer(couchUrl, name, { db = 'neo-library', password = 'pages' } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-sync-' + name + '-'));
  const dir = path.join(home, 'NEO Library');
  fs.mkdirSync(dir);
  // the library a first launch makes (ensureLibrary in main.js)
  fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ authorName: '', penNames: [], firstRunDone: false, pageTheme: 'night', shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }] }, null, 2));
  const at = (p) => path.join(dir, ...p.split('/'));
  const dev = {
    dir,
    trashed: [],
    errors: [],
    pulled: [],
    write(p, content) {
      fs.mkdirSync(path.dirname(at(p)), { recursive: true });
      durable(at(p), typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content, null, 2));
    },
    read: (p) => { try { return fs.readFileSync(at(p), 'utf8'); } catch { return null; } },
    json: (p) => JSON.parse(fs.readFileSync(at(p), 'utf8')),
    exists: (p) => fs.existsSync(at(p)),
    remove: (p) => fs.rmSync(at(p), { recursive: true, force: true }),
    stat: (p) => fs.statSync(at(p)),
    // every synced file and what it holds
    files() {
      const out = {};
      const walk = (rel) => {
        for (const name of fs.readdirSync(path.join(dir, ...rel.split('/').filter(Boolean)))) {
          const p = rel + name;
          if (fs.statSync(at(p)).isDirectory()) walk(p + '/');
          else if (validPath(p)) out[p] = fs.readFileSync(at(p)).toString('base64');
        }
      };
      walk('');
      return out;
    }
  };
  dev.sync = createSync({
    config: { url: couchUrl, db, user: 'writer', password, deviceId: name, device: name },
    libraryDir: () => dir,
    stateFile: path.join(home, 'sync-state.json'),
    fetch,
    writeFileDurable: durable,
    trash: async (file) => {
      dev.trashed.push(path.relative(dir, file).split(path.sep).join('/'));
      fs.renameSync(file, path.join(home, 'trash-' + dev.trashed.length));
    },
    logError: (source, err) => dev.errors.push(source + ': ' + ((err && err.message) || err)),
    onPulled: (what) => dev.pulled.push(what)
  });
  open.push(dev.sync);
  return dev;
}

const BOOK = 'book-the-tide-mf3k2-a1b2c';
function shelve(dev, bookIds, extra = {}) {
  dev.write('library.json', { authorName: 'Ada', firstRunDone: true, pageTheme: 'night', shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds }], ...extra });
}
function seedBook(dev, chapters, id = BOOK) {
  dev.write(id + '/book.json', {
    id, title: 'The Tide', author: 'Ada', modified: '2026-10-01T09:00:00.000Z',
    chapterOrder: Object.keys(chapters), chapterTitles: {}, tabNames: { notes: 'Notes', outline: 'Outline' }
  });
  for (const [ch, html] of Object.entries(chapters)) dev.write(id + '/chapters/' + ch + '.html', html);
  dev.write(id + '/notes.html', '<p>Remember the lighthouse.</p>');
  dev.write(id + '/darlings.json', []);
  dev.write(id + '/stickies.json', []);
}
// what the window does when it saves the book: the new meta, a later stamp
function saveMeta(dev, change, id = BOOK) {
  const meta = dev.json(id + '/book.json');
  change(meta);
  meta.modified = new Date(Date.parse(meta.modified) + 60000).toISOString();
  dev.write(id + '/book.json', meta);
}

let couch;
after(async () => {
  for (const s of open) await s.stop();
  if (couch) await couch.close();
});

// ---------------------------------------------------------------------------

describe('merging two versions of a JSON file', () => {
  test('files that never met merge as a union', () => {
    const out = mergeJSON(undefined, { a: 1, list: ['x', 'y'] }, { b: 2, list: ['y', 'z'] });
    assert.deepEqual(out, { a: 1, list: ['x', 'y', 'z'], b: 2 });
  });

  test('a removal on one side stands when the other side left it alone', () => {
    const base = { order: ['c1', 'c2', 'c3'], titles: { c2: 'Two' } };
    const local = { order: ['c1', 'c3'], titles: {} };
    const remote = { order: ['c1', 'c2', 'c3', 'c4'], titles: { c2: 'Two' } };
    assert.deepEqual(mergeJSON(base, local, remote), { order: ['c1', 'c3', 'c4'], titles: {} });
  });

  test('a chapter added on each side keeps its place', () => {
    const base = { chapterOrder: ['a', 'b', 'c'] };
    const local = { chapterOrder: ['a', 'x', 'b', 'c'] };
    const remote = { chapterOrder: ['a', 'b', 'y', 'c'] };
    assert.deepEqual(mergeJSON(base, local, remote).chapterOrder, ['a', 'x', 'b', 'y', 'c']);
  });

  test('removed on one side and edited on the other: the edit stays', () => {
    const base = { looseCards: [{ id: 'lc-1', text: 'a storm' }] };
    const local = { looseCards: [] };
    const remote = { looseCards: [{ id: 'lc-1', text: 'a storm at sea, and a lost ring' }] };
    assert.deepEqual(mergeJSON(base, local, remote).looseCards, remote.looseCards);
  });

  test('text both sides rewrote: one wins, the other is handed over, not lost', () => {
    const lost = [];
    const base = { chapterNotes: { c1: 'She leaves.' } };
    const local = { chapterNotes: { c1: 'She leaves at dawn with the map.' } };
    const remote = { chapterNotes: { c1: 'She stays and burns the letters.' } };
    const out = mergeJSON(base, local, remote, { prefer: 'remote', lost: (s) => lost.push(s) });
    assert.equal(out.chapterNotes.c1, 'She stays and burns the letters.');
    assert.deepEqual(lost, ['She leaves at dawn with the map.']);
  });

  test('lists with ids merge the way comments and Darlings do', () => {
    const base = [{ id: 'd1', text: 'one' }, { id: 'd2', text: 'two' }];
    const local = [{ id: 'd3', text: 'three' }, { id: 'd1', text: 'one' }];
    const remote = [{ id: 'd4', text: 'four' }, { id: 'd1', text: 'one' }, { id: 'd2', text: 'two' }];
    assert.deepEqual(mergeJSON(base, local, remote).map((d) => d.id), ['d4', 'd3', 'd1']);
  });

  test('keys in another order are the same object', () => {
    assert.deepEqual(mergeJSON({ a: 1, b: 2 }, { b: 2, a: 1 }, { a: 1, b: 3 }), { a: 1, b: 3 });
  });

  test('a book moved to two shelves stays on the first', () => {
    const base = { shelves: [{ id: 's1', bookIds: ['b'] }, { id: 's2', bookIds: [] }, { id: 's3', bookIds: [] }] };
    const local = { shelves: [{ id: 's1', bookIds: [] }, { id: 's2', bookIds: ['b'] }, { id: 's3', bookIds: [] }] };
    const remote = { shelves: [{ id: 's1', bookIds: [] }, { id: 's2', bookIds: [] }, { id: 's3', bookIds: ['b'] }] };
    const out = mergeLibrary(base, local, remote, 'local');
    assert.deepEqual(out.shelves.map((s) => s.bookIds), [[], ['b'], []]);
  });

  test('a hostile key is not a prototype', () => {
    const out = mergeJSON(undefined, { a: 1 }, JSON.parse('{"__proto__": {"x": 1}, "b": 2}'));
    assert.equal(out.x, undefined);
    assert.deepEqual(out, { a: 1, b: 2 });
  });
});

describe('what may travel', () => {
  test('library files, and nothing outside them', () => {
    for (const ok of ['library.json', 'book-a/book.json', 'book-a/notes.html', 'book-a/chapters/ch-1.html', 'book-a/cover-123.jpg', 'book-My Novel/darlings.json']) {
      assert.equal(validPath(ok), true, ok);
    }
    for (const bad of ['../x.json', 'book-a/../../x.json', 'book-a/..', '_design/neo', 'Backups/neo-backup.zip', 'book-a/book.json.bak',
      'book-a/book.json.tmp', 'book-a/.DS_Store', 'neo-errors.log', '_catalog.txt', 'book-a/x/y.html', 'book-a/chapters/../../z.html',
      'book-a\\..\\z.html', 'book-a/con:1.html', 'other/book.json', 'book-a/chapters/ch.html/extra']) {
      assert.equal(validPath(bad), false, bad);
    }
  });

  test('the address the writer typed', () => {
    assert.deepEqual(normalizeConfig({ url: 'https://ada:s3cret@couch.example.com:6984/novels' }),
      { url: 'https://couch.example.com:6984', db: 'novels', user: 'ada', password: 's3cret' });
    assert.deepEqual(normalizeConfig({ url: ' https://example.com/couchdb/ ', db: 'neo-library', user: 'ada', password: 'pw' }),
      { url: 'https://example.com/couchdb', db: 'neo-library', user: 'ada', password: 'pw' });
    assert.equal(normalizeConfig({ url: 'http://localhost:5984' }).db, 'neo-library');
    assert.deepEqual(normalizeConfig({ url: 'couch.example.com' }), { error: 'url' });
    assert.deepEqual(normalizeConfig({ url: 'ftp://couch.example.com' }), { error: 'url' });
    assert.deepEqual(normalizeConfig({ url: 'http://localhost:5984', db: 'My Novels' }), { error: 'dbname' });
  });
});

describe('connecting', { concurrency: 1 }, () => {
  test('a wrong password, a database made, something that isn\'t CouchDB, nothing at all', async () => {
    couch = couch || await fakeCouch();
    const bad = await connect({ url: couch.url, db: 'neo-library', user: 'writer', password: 'nope' }, fetch);
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'auth');

    assert.equal(couch.dbs.has('connect-test'), false);
    assert.deepEqual(await connect({ url: couch.url, db: 'connect-test', user: 'writer', password: 'pages' }, fetch), { ok: true });
    assert.equal(couch.dbs.has('connect-test'), true);
    assert.deepEqual(await connect({ url: couch.url, db: 'connect-test', user: 'writer', password: 'pages' }, fetch), { ok: true });

    const web = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<h1>Hello</h1>'); });
    await new Promise((resolve) => web.listen(0, '127.0.0.1', resolve));
    const notCouch = await connect({ url: `http://127.0.0.1:${web.address().port}`, db: 'neo-library', user: 'writer', password: 'pages' }, fetch);
    await new Promise((resolve) => web.close(resolve));
    assert.equal(notCouch.code, 'notcouch');

    const gone = http.createServer();
    await new Promise((resolve) => gone.listen(0, '127.0.0.1', resolve));
    const port = gone.address().port;
    await new Promise((resolve) => gone.close(resolve));
    const nobody = await connect({ url: `http://127.0.0.1:${port}`, db: 'neo-library', user: 'writer', password: 'pages' }, fetch);
    assert.equal(nobody.code, 'unreachable');
  });
});

describe('two computers, one server', { concurrency: 1 }, () => {
  let n = 0;
  // each test its own database, and its own pair of computers
  async function pair() {
    couch = couch || await fakeCouch();
    const db = 'pair-' + (++n);
    await connect({ url: couch.url, db, user: 'writer', password: 'pages' }, fetch);
    return [computer(couch.url, 'a' + n, { db }), computer(couch.url, 'b' + n, { db }), db];
  }

  test('a library goes up from one computer and comes down whole on the other', async () => {
    const [a, b] = await pair();
    shelve(a, [BOOK]);
    seedBook(a, { 'ch-1': '<p>The tide came in.</p>', 'ch-2': '<p>It went out again.</p>' });
    const cover = crypto.randomBytes(3000);
    a.write(BOOK + '/cover-1700000000000.png', cover);
    shelve(b, []); // b's first launch: an empty shelf of its own
    await a.sync.syncNow();
    await b.sync.syncNow();
    await a.sync.syncNow();
    assert.deepEqual(b.files(), a.files());
    assert.deepEqual(fs.readFileSync(path.join(b.dir, BOOK, 'cover-1700000000000.png')), cover);
    assert.deepEqual(b.json('library.json').shelves[0].bookIds, [BOOK]);
    assert.deepEqual(a.errors, []);
    assert.deepEqual(b.errors, []);
    assert.ok(b.pulled.length > 0);
  });

  test('an edit arrives, and nothing that didn\'t change is written again', async () => {
    const [a, b] = await pair();
    shelve(a, [BOOK]);
    seedBook(a, { 'ch-1': '<p>One.</p>', 'ch-2': '<p>Two.</p>' });
    await a.sync.syncNow();
    await b.sync.syncNow();
    const untouched = b.stat(BOOK + '/chapters/ch-2.html');
    a.write(BOOK + '/chapters/ch-1.html', '<p>One, and then some.</p>');
    await a.sync.syncNow();
    await b.sync.syncNow();
    assert.equal(b.read(BOOK + '/chapters/ch-1.html'), '<p>One, and then some.</p>');
    const after2 = b.stat(BOOK + '/chapters/ch-2.html');
    assert.equal(after2.ino, untouched.ino);
    assert.equal(after2.mtimeMs, untouched.mtimeMs);
    // and a quiet look writes nothing at all
    const before = JSON.stringify(Object.fromEntries(Object.keys(b.files()).map((p) => [p, b.stat(p).mtimeMs])));
    await b.sync.syncNow();
    await a.sync.syncNow();
    assert.equal(JSON.stringify(Object.fromEntries(Object.keys(b.files()).map((p) => [p, b.stat(p).mtimeMs]))), before);
  });

  test('the same chapter written on both: both versions, on both computers', async () => {
    const [a, b] = await pair();
    shelve(a, [BOOK]);
    seedBook(a, { 'ch-1': '<p>The boat left.</p>', 'ch-2': '<p>Night.</p>' });
    await a.sync.syncNow();
    await b.sync.syncNow();
    a.write(BOOK + '/chapters/ch-1.html', '<p>The boat left at dawn, heavy with salt.</p>');
    b.write(BOOK + '/chapters/ch-1.html', '<p>The boat left. Nobody waved from the pier.</p>');
    await a.sync.syncNow();
    await b.sync.syncNow();
    await a.sync.syncNow();
    assert.deepEqual(a.files(), b.files());
    const meta = b.json(BOOK + '/book.json');
    assert.equal(meta.chapterOrder.length, 3);
    assert.equal(meta.chapterOrder[0], 'ch-1');
    assert.equal(meta.chapterOrder[2], 'ch-2');
    const twin = meta.chapterOrder[1];
    assert.match(meta.chapterTitles[twin], /from other device/);
    const texts = [b.read(BOOK + '/chapters/ch-1.html'), b.read(BOOK + '/chapters/' + twin + '.html')].sort();
    assert.deepEqual(texts, ['<p>The boat left at dawn, heavy with salt.</p>', '<p>The boat left. Nobody waved from the pier.</p>']);
  });

  test('a chapter that only grew on one side and shrank on the other keeps every word', async () => {
    const [a, b] = await pair();
    shelve(a, [BOOK]);
    seedBook(a, { 'ch-1': '<p>Salt and wind and rope</p>' });
    await a.sync.syncNow();
    await b.sync.syncNow();
    a.write(BOOK + '/chapters/ch-1.html', '<p>Salt and wind and rope and gulls</p>');
    b.write(BOOK + '/chapters/ch-1.html', '<p>Salt and wind</p>');
    await a.sync.syncNow();
    await b.sync.syncNow();
    await a.sync.syncNow();
    for (const dev of [a, b]) {
      assert.equal(dev.read(BOOK + '/chapters/ch-1.html'), '<p>Salt and wind and rope and gulls</p>');
      assert.deepEqual(dev.json(BOOK + '/book.json').chapterOrder, ['ch-1']);
    }
  });

  test('a chapter removed on one computer goes to the other\'s trash', async () => {
    const [a, b] = await pair();
    shelve(a, [BOOK]);
    seedBook(a, { 'ch-1': '<p>One.</p>', 'ch-2': '<p>Two.</p>' });
    await a.sync.syncNow();
    await b.sync.syncNow();
    saveMeta(a, (m) => { m.chapterOrder = ['ch-1']; });
    a.remove(BOOK + '/chapters/ch-2.html');
    await a.sync.syncNow();
    await b.sync.syncNow();
    assert.deepEqual(b.trashed, [BOOK + '/chapters/ch-2.html']);
    assert.equal(b.exists(BOOK + '/chapters/ch-2.html'), false);
    assert.deepEqual(b.json(BOOK + '/book.json').chapterOrder, ['ch-1']);
    assert.deepEqual(a.files(), b.files());
  });

  test('removed on one computer, written on the other: it stays, in its place', async () => {
    const [a, b] = await pair();
    shelve(a, [BOOK]);
    seedBook(a, { 'ch-1': '<p>One.</p>', 'ch-2': '<p>Two.</p>', 'ch-3': '<p>Three.</p>' });
    await a.sync.syncNow();
    await b.sync.syncNow();
    saveMeta(a, (m) => { m.chapterOrder = ['ch-1', 'ch-3']; });
    a.remove(BOOK + '/chapters/ch-2.html');
    b.write(BOOK + '/chapters/ch-2.html', '<p>Two, and the whole storm.</p>');
    await a.sync.syncNow();
    await b.sync.syncNow();
    await a.sync.syncNow();
    assert.deepEqual(b.trashed, []);
    for (const dev of [a, b]) {
      assert.equal(dev.read(BOOK + '/chapters/ch-2.html'), '<p>Two, and the whole storm.</p>');
      assert.deepEqual(dev.json(BOOK + '/book.json').chapterOrder, ['ch-1', 'ch-2', 'ch-3']);
    }
  });

  test('a book trashed on one computer goes to the other\'s trash whole', async () => {
    const [a, b] = await pair();
    shelve(a, [BOOK, 'book-keep-1']);
    seedBook(a, { 'ch-1': '<p>One.</p>' });
    seedBook(a, { 'ch-9': '<p>Kept.</p>' }, 'book-keep-1');
    await a.sync.syncNow();
    await b.sync.syncNow();
    a.remove(BOOK);
    shelve(a, ['book-keep-1']);
    await a.sync.syncNow();
    await b.sync.syncNow();
    assert.deepEqual(b.trashed, [BOOK]);
    assert.equal(b.exists(BOOK), false);
    assert.deepEqual(b.json('library.json').shelves[0].bookIds, ['book-keep-1']);
    assert.deepEqual(a.files(), b.files());
  });

  test('a book trashed on one computer but written in on the other stays whole', async () => {
    const [a, b] = await pair();
    shelve(a, [BOOK]);
    seedBook(a, { 'ch-1': '<p>One.</p>', 'ch-2': '<p>Two.</p>' });
    await a.sync.syncNow();
    await b.sync.syncNow();
    a.remove(BOOK);
    shelve(a, []);
    b.write(BOOK + '/chapters/ch-1.html', '<p>One, written on the train.</p>');
    await a.sync.syncNow();
    await b.sync.syncNow();
    await a.sync.syncNow();
    assert.deepEqual(b.trashed, []);
    for (const dev of [a, b]) {
      assert.equal(dev.read(BOOK + '/chapters/ch-1.html'), '<p>One, written on the train.</p>');
      assert.equal(dev.read(BOOK + '/chapters/ch-2.html'), '<p>Two.</p>');
      assert.equal(dev.json(BOOK + '/book.json').title, 'The Tide');
      // back on a shelf, where it can be seen
      assert.deepEqual(dev.json('library.json').shelves[0].bookIds, [BOOK]);
    }
  });

  test('shelves changed on both computers keep both changes', async () => {
    const [a, b] = await pair();
    shelve(a, [BOOK]);
    seedBook(a, { 'ch-1': '<p>One.</p>' });
    await a.sync.syncNow();
    await b.sync.syncNow();
    const libA = a.json('library.json');
    libA.shelves.push({ id: 'shelf-2', name: 'Drafts', bookIds: [] });
    a.write('library.json', libA);
    const libB = b.json('library.json');
    libB.shelves[0].name = 'The Sea Books';
    libB.pageTheme = 'paper';
    b.write('library.json', libB);
    await a.sync.syncNow();
    await b.sync.syncNow();
    await a.sync.syncNow();
    for (const dev of [a, b]) {
      const lib = dev.json('library.json');
      assert.deepEqual(lib.shelves.map((s) => s.name), ['The Sea Books', 'Drafts']);
      assert.equal(lib.pageTheme, 'paper');
    }
  });

  test('an outline note rewritten on both: the loser waits in Darlings', async () => {
    const [a, b] = await pair();
    shelve(a, [BOOK]);
    seedBook(a, { 'ch-1': '<p>One.</p>' });
    saveMeta(a, (m) => { m.chapterNotes = { 'ch-1': 'She leaves.' }; });
    await a.sync.syncNow();
    await b.sync.syncNow();
    saveMeta(a, (m) => { m.chapterNotes['ch-1'] = 'She leaves at dawn with the map.'; });
    saveMeta(b, (m) => { m.chapterNotes['ch-1'] = 'She stays and burns the letters.'; m.modified = '2027-01-01T00:00:00.000Z'; });
    await a.sync.syncNow();
    await b.sync.syncNow();
    await a.sync.syncNow();
    for (const dev of [a, b]) {
      assert.equal(dev.json(BOOK + '/book.json').chapterNotes['ch-1'], 'She stays and burns the letters.');
      const darlings = dev.json(BOOK + '/darlings.json');
      assert.equal(darlings.length, 1);
      assert.equal(darlings[0].text, 'She leaves at dawn with the map.');
      assert.equal(darlings[0].chapterLabel, 'text changed on two devices');
    }
  });

  test('notes written on both computers sit one after the other', async () => {
    const [a, b] = await pair();
    shelve(a, [BOOK]);
    seedBook(a, { 'ch-1': '<p>One.</p>' });
    await a.sync.syncNow();
    await b.sync.syncNow();
    a.write(BOOK + '/notes.html', '<p>Remember the lighthouse.</p><p>The keeper lies.</p>');
    b.write(BOOK + '/notes.html', '<p>Remember the lighthouse.</p><p>Rename the boat.</p>');
    await a.sync.syncNow();
    await b.sync.syncNow();
    await a.sync.syncNow();
    const notes = a.read(BOOK + '/notes.html');
    assert.equal(notes, b.read(BOOK + '/notes.html'));
    assert.match(notes, /The keeper lies\./);
    assert.match(notes, /Rename the boat\./);
    assert.match(notes, /from other device/);
  });

  test('an empty copy never wipes a chapter that has words', async () => {
    const [a, b] = await pair();
    shelve(a, [BOOK]);
    seedBook(a, { 'ch-1': '<p>Every word of it.</p>' });
    await a.sync.syncNow();
    await b.sync.syncNow();
    a.write(BOOK + '/chapters/ch-1.html', '');
    await a.sync.syncNow();
    await b.sync.syncNow();
    await a.sync.syncNow();
    assert.equal(b.read(BOOK + '/chapters/ch-1.html'), '<p>Every word of it.</p>');
    assert.equal(a.read(BOOK + '/chapters/ch-1.html'), '<p>Every word of it.</p>');
  });

  test('a file iCloud is holding in the cloud is not a deletion', async () => {
    const [a, b] = await pair();
    shelve(a, [BOOK]);
    seedBook(a, { 'ch-1': '<p>One.</p>' });
    await a.sync.syncNow();
    a.remove(BOOK + '/chapters/ch-1.html');
    a.write(BOOK + '/chapters/.ch-1.html.icloud', 'stub');
    await a.sync.syncNow();
    await b.sync.syncNow();
    assert.equal(b.read(BOOK + '/chapters/ch-1.html'), '<p>One.</p>');
  });

  test('a database made anew: the library goes up again, nothing is deleted', async () => {
    const [a, b, db] = await pair();
    shelve(a, [BOOK]);
    seedBook(a, { 'ch-1': '<p>One.</p>' });
    await a.sync.syncNow();
    await b.sync.syncNow();
    couch.dbs.delete(db);
    await connect({ url: couch.url, db, user: 'writer', password: 'pages' }, fetch);
    await b.sync.syncNow();
    await a.sync.syncNow();
    await b.sync.syncNow();
    for (const dev of [a, b]) {
      assert.deepEqual(dev.trashed, []);
      assert.equal(dev.read(BOOK + '/chapters/ch-1.html'), '<p>One.</p>');
      assert.ok(dev.errors.some((e) => /new to this computer/.test(e)));
    }
    assert.ok(couch.dbs.get(db).docs.has(BOOK + '/chapters/ch-1.html'));
    assert.deepEqual(a.files(), b.files());
  });

  test('the server being down is an error to show, then sync carries on', async () => {
    const [a] = await pair();
    shelve(a, [BOOK]);
    seedBook(a, { 'ch-1': '<p>One.</p>' });
    const down = computer(couch.url, 'locked', { db: 'pair-' + n, password: 'wrong' });
    shelve(down, []);
    await down.sync.syncNow();
    assert.equal(down.sync.status().state, 'error');
    assert.equal(down.sync.status().error.code, 'auth');
    await a.sync.syncNow();
    assert.equal(a.sync.status().state, 'idle');
    assert.ok(a.sync.status().lastSync);
  });

  test('started, a computer hears of the other\'s change in moments', async () => {
    const [a, b] = await pair();
    shelve(a, [BOOK]);
    seedBook(a, { 'ch-1': '<p>One.</p>' });
    await a.sync.syncNow();
    await b.sync.syncNow();
    b.sync.start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    a.write(BOOK + '/chapters/ch-1.html', '<p>One, heard at once.</p>');
    await a.sync.syncNow();
    const until = Date.now() + 5000;
    while (b.read(BOOK + '/chapters/ch-1.html') !== '<p>One, heard at once.</p>' && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(b.read(BOOK + '/chapters/ch-1.html'), '<p>One, heard at once.</p>');
    await b.sync.stop();
  });
});

// ---------------------------------------------------------------------------
// main.js: a window's library.json write that missed another computer's change
// ---------------------------------------------------------------------------

describe('library:write after another computer wrote', () => {
  test('the window\'s change and the other computer\'s both stay', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-sync-main-'));
    const handlers = new Map();
    const electron = {
      app: { commandLine: { appendSwitch() {} }, getPath: () => dir, getLocale: () => 'en', requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {} },
      ipcMain: { on() {}, handle: (name, fn) => handlers.set(name, fn) },
      BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
      Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
      dialog: {},
      utilityProcess: { fork: () => ({ on() {}, postMessage() {} }) },
      screen: {}
    };
    const context = vm.createContext({
      require: (name) => (name === 'electron' ? electron : createRequire(path.join(root, 'main.js'))(name)),
      __dirname: root,
      process: { platform: process.platform, on() {} },
      console,
      libraryRoot: dir
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: path.join(root, 'main.js') });
    vm.runInContext('LIBRARY_DIR = libraryRoot; LIBRARY_FILE = require("path").join(libraryRoot, "library.json");', context);
    const call = (name, ...args) => handlers.get(name)(null, ...args);

    const first = { firstRunDone: true, pageTheme: 'night', shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: ['book-a'] }] };
    call('library:write', first);
    const inWindow = call('library:read');
    // another computer's new book arrives on disk
    durable(path.join(dir, 'library.json'), JSON.stringify({ ...first, shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: ['book-a', 'book-b'] }] }));
    // the window, which never saw it, changes the page
    call('library:write', { ...inWindow, pageTheme: 'paper' });
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'library.json'), 'utf8'));
    assert.equal(disk.pageTheme, 'paper');
    assert.deepEqual(disk.shelves[0].bookIds, ['book-a', 'book-b']);
    // once the window has read it, its own write stands as sent
    const seen = call('library:read');
    call('library:write', { ...seen, pageTheme: 'light', shelves: [] });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'library.json'), 'utf8')).shelves, []);
  });
});
