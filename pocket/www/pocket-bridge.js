/* =========================== NEO POCKET =========================== */
/* The window.neo doorway, implemented for Android and iOS. Reads and    */
/* writes the same plain files as desktop NEO, in a NEO Library folder:  */
/* Android: Documents/NEO Library, shared with the Mac via Syncthing.    */
/* iOS: the app's own folder — inside iCloud Drive when the writer has  */
/* it on (so desktop NEO can point at the same folder), else On My iPad. */
/* Desktop-only powers (email, import) stub out                          */
/* quietly; writing never does.                                          */

(function () {
  // The interface language, as in app.js. NeoI18n (i18n.js) loads before this
  // file and app.js chooses the language as it loads, before the writer can
  // see any of these words.
  const t = (s, vars) => (window.NeoI18n ? window.NeoI18n.t(s, vars) : s);
  const FS = () => window.Capacitor.Plugins.Filesystem;
  const DIR = 'DOCUMENTS';
  const ROOT = 'NEO Library';
  const isIOS = () => !!(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'ios');

  // iOS: HOME is the library folder as a file:// URL, found by the little
  // LibraryHome plugin (ios/App/App/LibraryHome.swift); CLOUD says whether
  // that folder lives in iCloud Drive. Android leaves both alone.
  let HOME = null;
  let CLOUD = false;
  const libraryHome = () => (window.Capacitor.registerPlugin ? window.Capacitor.registerPlugin('LibraryHome') : window.Capacitor.Plugins.LibraryHome);
  const ready = (async () => {
    if (!isIOS()) return;
    try {
      const r = await libraryHome().locate();
      HOME = String(r.path).replace(/\/+$/, '');
      CLOUD = !!r.cloud;
      // first launch on a new iPad: the whole library is still in the cloud
      if (CLOUD) await libraryHome().fetch({ wait: 20000 });
    } catch (err) {
      showErrorDetail(t('Could not find the library folder: {error}', { error: String(err && err.message || err) }) +
        '\nplugins the page can see: ' + Object.keys((window.Capacitor && window.Capacitor.Plugins) || {}).join(', '));
    }
  })();

  // library-relative path -> the Filesystem plugin's idea of where that is
  const p = (...parts) => parts.join('/');
  // i18n.js loads first; app.js picks the language before anyone calls this
  const t = (text, vars) => window.NeoI18n.t(text, vars);
  // a paper's own files, as main.js's PAPER_FILE: figures and style.csl
  const PAPER_FILE = /^(?:figure-[a-z0-9]{4,40}\.(?:png|jpe?g|gif|webp|svg)|style\.csl)$/;
  function at(rel) {
    if (HOME) return { path: rel ? HOME + '/' + rel.split('/').map(encodeURIComponent).join('/') : HOME };
    return { path: rel ? ROOT + '/' + rel : ROOT, directory: DIR };
  }

  // iCloud delivers other devices' files as placeholders until asked;
  // ask before reading anything a Mac might have written.
  async function fetchCloud(rel, wait) {
    if (!CLOUD) return;
    try { await libraryHome().fetch({ path: at(rel).path, wait: wait || 8000 }); } catch { /* read anyway */ }
  }

  async function listDir(rel) {
    await ready;
    const ls = await FS().readdir(at(rel));
    return (ls.files || []).map((f) => (f && f.name) || f).filter((n) => !String(n).endsWith('.icloud'));
  }

  async function ensureDir(path) {
    await ready;
    try {
      await FS().mkdir({ ...at(path), recursive: true });
    } catch { /* exists */ }
  }

  async function readText(path) {
    await ready;
    const r = await FS().readFile({ ...at(path), encoding: 'utf8' });
    return r.data;
  }

  // The desktop's rule on the phone too: the new text is written beside the
  // old file and swapped in whole, so a save cut short (the app killed in
  // the background, the battery gone) leaves the old version, never half
  // of the new one. A system that won't do the swap gets a plain write.
  async function writeText(path, data) {
    await ready;
    const tmp = path + '.tmp';
    try {
      await FS().writeFile({ ...at(tmp), data, encoding: 'utf8', recursive: true });
      try {
        const from = at(tmp);
        const to = at(path);
        await FS().rename({ from: from.path, to: to.path, directory: from.directory, toDirectory: to.directory });
        return;
      } catch { /* no swap here: the plain write below */ }
      await FS().writeFile({ ...at(path), data, encoding: 'utf8', recursive: true });
      try { await FS().deleteFile(at(tmp)); } catch { /* fine */ }
    } catch (err) {
      showErrorDetail(t('Could not save {file}: {error}', { file: path, error: String(err && err.message || err) }));
      throw err;
    }
  }

  let permissionHelpShown = false;
  function showPermissionHelp(err) {
    if (permissionHelpShown) return;
    permissionHelpShown = true;
    const bd = document.createElement('div');
    bd.style.cssText = 'position:fixed;inset:0;background:#191919;color:#d6d2c6;z-index:9999;' +
      'display:flex;align-items:center;justify-content:center;padding:40px;text-align:center';
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const why = isIOS()
      ? '<p style="line-height:1.6;margin-top:16px">' + esc(t('Pocket couldn\'t open its NEO Library folder. Force-quit and reopen the app; if it keeps happening, check that iCloud Drive is signed in (Settings → your name → iCloud), or turn it off so Pocket keeps books on the iPad itself.')) + '</p>'
      : '<p style="line-height:1.6;margin-top:16px">' + esc(t('Pocket can see the NEO Library folder but Android is blocking it from reading files that other apps (like Syncthing) created.')) + '</p>' +
        '<p style="line-height:1.6;color:#999;margin-top:12px">' + esc(t('The switch is not on the app\'s own Permissions page. Open Android Settings, search for {setting} (or Apps → Special app access → {setting}), turn it on for NEO Pocket, then come back here.')).split('{setting}').join('<b>' + esc(t('All files access')) + '</b>') + '</p>';
    bd.innerHTML = '<div style="max-width:420px"><h2 style="letter-spacing:5px">NEO POCKET</h2>' + why +
      '<p style="font:12px/1.5 monospace;color:#777;margin-top:20px;word-break:break-word">' + String(err && err.message || err || '') + '</p></div>';
    document.body.appendChild(bd);
  }

  // On a phone there's no easy way to open the log, so show the error itself.
  // Long-press the box to copy it; tap to dismiss.
  function showErrorDetail(msg) {
    try {
      let box = document.getElementById('pocket-error-detail');
      if (!box) {
        box = document.createElement('pre');
        box.id = 'pocket-error-detail';
        box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;max-height:40vh;overflow:auto;' +
          'margin:0;padding:12px;background:#2a1d1d;color:#e8c9c9;font:12px/1.5 monospace;' +
          'white-space:pre-wrap;word-break:break-word;border-radius:8px;z-index:9998;user-select:text';
        box.addEventListener('click', () => box.remove());
        document.body.appendChild(box);
      }
      box.textContent = String(msg).slice(0, 2000) + '\n\n' + t('(tap to dismiss)');
    } catch { /* never let the reporter itself hiccup */ }
  }

  // JSON reads fall back on the copies a write leaves, as on the desktop:
  // the .tmp a write was making when it stopped, then .bak, the last
  // version that read whole. What they recover is put back as the file.
  async function readJSONFile(path, fallback) {
    try { return JSON.parse(await readText(path)); } catch { /* the spares, below */ }
    for (const spare of [path + '.tmp', path + '.bak']) {
      let v;
      try { v = JSON.parse(await readText(spare)); } catch { continue; }
      try { await writeText(path, JSON.stringify(v, null, 2)); } catch { /* still recovered for now */ }
      return v;
    }
    return fallback;
  }

  async function writeJSONFile(path, data) {
    // the version on disk, while it reads whole, becomes the .bak
    try {
      const old = await readText(path);
      JSON.parse(old);
      await FS().writeFile({ ...at(path + '.bak'), data: old, encoding: 'utf8', recursive: true });
    } catch { /* no whole old copy to keep: the write still goes ahead */ }
    await writeText(path, JSON.stringify(data, null, 2));
  }

  // the same rule as main.js chapterDiverged: the disk copy differs from
  // what this device last knew, holds words, and has a word the new text lacks
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

  const bookDir = (bookId) => p(bookId);

  // The honest access test: reading a file another app created. An app can
  // always touch its OWN files without the big permission — which is exactly
  // how a too-gentle test lies about a half-broken setup.
  async function checkAccess() {
    try {
      await ensureDir('');
      let names = [];
      try { names = await listDir(''); } catch { /* fall through to the write test */ }
      if (names.includes('library.json')) {
        await readText(p('library.json')); // the file that matters, whoever made it
      } else {
        await FS().writeFile({ ...at('.pocket-touch'), data: String(Date.now()), encoding: 'utf8', recursive: true });
        try { await FS().deleteFile(at('.pocket-touch')); } catch { /* fine */ }
      }
      return true;
    } catch (err) {
      showPermissionHelp(err);
      return false;
    }
  }

  function slugify(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }

  // Letter in the Americas and the Philippines, A4 elsewhere (as main.js)
  const LETTER = ['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT', 'CR', 'PA', 'DO', 'PR', 'SV', 'HN', 'NI', 'BZ'];
  const region = (() => { try { return new Intl.Locale(navigator.language).maximize().region || ''; } catch { return ''; } })();

  window.neo = {
    paper: LETTER.includes(region) ? 'Letter' : 'A4',
    /* ---------- library ---------- */
    readLibrary: async () => {
      if (!(await checkAccess())) return { authorName: '', penNames: [], firstRunDone: false, shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }] };
      await fetchCloud('library.json', 15000);
      return readJSONFile(p('library.json'), {
        authorName: '', penNames: [], firstRunDone: false, pageTheme: 'night',
        shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
      });
    },
    writeLibrary: async (data) => { await writeJSONFile(p('library.json'), data); return true; },
    libraryPath: async () => {
      // a served URL lets cover art render in the webview
      try {
        await ready;
        if (HOME) return window.Capacitor.convertFileSrc(HOME);
        const u = await FS().getUri({ path: ROOT, directory: DIR });
        return window.Capacitor.convertFileSrc(u.uri);
      } catch { return 'Documents/NEO Library'; }
    },

    /* ---------- books ---------- */
    readBookMeta: async (bookId) => { await fetchCloud(bookId); return readJSONFile(p(bookId, 'book.json'), null); },
    listBooks: async () => {
      const out = [];
      try {
        for (const name of await listDir('')) {
          if (!String(name).startsWith('book-')) continue;
          const m = await readJSONFile(p(name, 'book.json'), null);
          if (m && m.id) out.push({ id: m.id, title: m.title || t('Untitled'), author: m.author || '', modified: m.modified || '', kind: m.kind || '' });
        }
      } catch { /* an empty list is honest enough */ }
      return out;
    },
    writeBookMeta: async (bookId, meta) => {
      meta.modified = new Date().toISOString();
      await writeJSONFile(p(bookId, 'book.json'), meta);
      return meta.modified;
    },
    // app.js asks before re-reading a book: on iCloud, pull down whatever the
    // Mac wrote since (a short wait; the shelf must never hang on the network)
    refreshBook: async (bookId) => { await fetchCloud(bookId, 4000); return true; },
    createBook: async (opts) => {
      const seed = (opts && opts.title) ? slugify(opts.title) : '';
      const id = 'book-' + (seed ? seed + '-' : '') + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      const book = {
        id,
        title: (opts && opts.title) || t('Untitled'),
        subtitle: '',
        author: (opts && opts.author) || '',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        chapterOrder: [],
        coverSeed: Math.floor(Math.random() * 100000),
        lastPosition: null
      };
      await ensureDir(bookDir(id) + '/chapters');
      await writeJSONFile(p(id, 'book.json'), book);
      await writeText(p(id, 'notes.html'), '');
      await writeText(p(id, 'outline.html'), '');
      await writeJSONFile(p(id, 'darlings.json'), []);
      await writeJSONFile(p(id, 'stickies.json'), []);
      return book;
    },
    // a copy of a book: every file in its folder (chapters, notes, covers)
    // read and written into a new folder, then book.json under the new id
    // and title. Spare copies (.bak, .tmp) stay behind; a chapter iCloud
    // hasn't brought down stops the copy rather than leave it out. A
    // half-made copy is removed; the original is only read.
    duplicateBook: async (bookId, title) => {
      await ready;
      await fetchCloud(bookId, 8000);
      const meta = JSON.parse(await readText(p(bookId, 'book.json')));
      const seed = title ? slugify(title) : '';
      const id = 'book-' + (seed ? seed + '-' : '') + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      const files = [];
      const walk = async (rel) => {
        const ls = await FS().readdir(at(p(bookId, rel).replace(/\/$/, '')));
        for (const f of ls.files || []) {
          const name = (f && f.name) || f;
          const sub = rel ? rel + '/' + name : name;
          if (/\.icloud$/.test(name)) throw new Error(t('Some of this book is still downloading from iCloud. Try again in a moment'));
          if (f && f.type === 'directory') await walk(sub);
          else if (!/\.(tmp|bak)$/.test(name) && sub !== 'book.json') files.push(sub);
        }
      };
      try {
        await walk('');
        await ensureDir(p(id, 'chapters'));
        for (const f of files) {
          const r = await FS().readFile(at(p(bookId, f))); // base64: covers are pictures
          await FS().writeFile({ ...at(p(id, f)), data: r.data, recursive: true });
        }
        const now = new Date().toISOString();
        const copy = { ...meta, id, title: title || meta.title, created: now, modified: now };
        delete copy.uuid;
        await writeJSONFile(p(id, 'book.json'), copy);
        return copy;
      } catch (err) {
        try { await FS().rmdir({ ...at(id), recursive: true }); } catch { /* nothing made */ }
        throw err;
      }
    },
    // the folder moves to "Deleted Books" inside the library, where it can
    // be found and moved back (Files on iOS, any file manager on Android);
    // nothing is erased
    deleteBook: async (bookId) => {
      try {
        await ready;
        await ensureDir('Deleted Books');
        let dest = p('Deleted Books', bookId);
        try { await FS().stat(at(dest)); dest += '-' + Date.now().toString(36); } catch { /* free */ }
        const from = at(bookId);
        const to = at(dest);
        await FS().rename({ from: from.path, to: to.path, directory: from.directory, toDirectory: to.directory });
        return true;
      } catch (err) {
        showErrorDetail(t('Could not delete {book}: {error}', { book: bookId, error: String(err && err.message || err) }));
        return false;
      }
    },

    /* ---------- chapters ---------- */
    // {chId: mtime and size}: lets app.js re-read only what changed on disk
    // (the size too: Syncthing and iCloud keep the other device's mtime, and
    // two saves in the same second must not look alike)
    chapterStamps: async (bookId) => {
      const out = {};
      try {
        await ready;
        const ls = await FS().readdir(at(p(bookId, 'chapters')));
        for (const f of ls.files || []) {
          const name = (f && f.name) || String(f);
          if (name.endsWith('.html')) out[name.slice(0, -5)] = ((f && f.mtime) || 0) + ':' + ((f && f.size) || 0);
        }
      } catch { /* no chapters yet */ }
      return out;
    },
    readChapter: async (bookId, chId) => {
      await fetchCloud(p(bookId, 'chapters', chId + '.html'));
      // (a swap the system cut short leaves only the .tmp: the words are there)
      try { return await readText(p(bookId, 'chapters', chId + '.html')); } catch { /* the spare, below */ }
      try { return await readText(p(bookId, 'chapters', chId + '.html.tmp')); } catch { return ''; }
    },
    writeChapter: async (bookId, chId, html, expected) => {
      await ensureDir(bookDir(bookId) + '/chapters');
      const file = p(bookId, 'chapters', chId + '.html');
      if (typeof expected === 'string') {
        let cur = null;
        try { cur = await readText(file); } catch { /* not there */ }
        if (cur !== null && chapterDiverged(cur, expected, html)) return { conflict: cur };
      }
      await writeText(file, html);
      return true;
    },
    deleteChapter: async (bookId, chId) => {
      try { await FS().deleteFile(at(p(bookId, 'chapters', chId + '.html'))); } catch { /* fine */ }
      return true;
    },

    /* ---------- notes / outline / json sidecars ---------- */
    readAux: async (bookId, name) => {
      try { return await readText(p(bookId, name + '.html')); } catch { /* the spare, below */ }
      try { return await readText(p(bookId, name + '.html.tmp')); } catch { return ''; }
    },
    writeAux: async (bookId, name, html) => { await writeText(p(bookId, name + '.html'), html); return true; },
    readJSON: (bookId, name, fallback) => readJSONFile(p(bookId, name + '.json'), fallback),
    writeJSON: async (bookId, name, data) => { await writeJSONFile(p(bookId, name + '.json'), data); return true; },

    /* ---------- a paper's figures and style; DOIs looked up ---------- */
    paperRead: async (bookId, name) => {
      if (!PAPER_FILE.test(name)) throw new Error('Not a paper file: ' + name);
      try { await ready; return (await FS().readFile(at(p(bookId, name)))).data; } catch { return null; }
    },
    paperWrite: async (bookId, name, base64) => {
      if (!PAPER_FILE.test(name)) throw new Error('Not a paper file: ' + name);
      await ready;
      await FS().writeFile({ ...at(p(bookId, name)), data: base64, recursive: true });
      return true;
    },
    // Crossref answers a web view directly; arXiv's DOIs are DataCite's.
    // The words are main.js's (paper:lookup), so they share its translations
    paperLookup: async (doi) => {
      const datacite = /^10\.48550\//.test(doi);
      const service = datacite ? 'DataCite' : 'Crossref';
      const url = datacite
        ? 'https://api.datacite.org/application/vnd.citationstyles.csl+json/' + encodeURIComponent(doi)
        : 'https://api.crossref.org/works/' + encodeURIComponent(doi) + '/transform/application/vnd.citationstyles.csl+json';
      let res;
      try {
        res = await fetch(url);
      } catch (err) {
        throw new Error(t('No connection to {service} ({error})', { service, error: (err && err.message) || String(err) }));
      }
      if (res.status === 404) throw new Error(t('{service} has no record of {doi}', { service, doi }));
      if (!res.ok) throw new Error(t('{service} answered {status}', { service, status: String(res.status) }));
      return res.json();
    },

    /* ---------- API keys & painting: desktop only ---------- */
    hasSecret: async () => false,
    setSecret: async () => false,
    paintCover: async () => { throw new Error('Cover painting happens on the desktop'); },

    /* ---------- covers: shown if present, managed on the Mac ---------- */
    readCover: async (bookId, fname) => {
      try {
        await ready;
        const r = await FS().readFile(at(p(bookId, fname)));
        const ext = fname.split('.').pop().toLowerCase();
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        return { base64: r.data, mime, ext };
      } catch { return null; }
    },
    pickCover: async () => null,
    setCover: async () => null,
    removeCover: async () => true,

    /* ---------- desktop powers, politely absent ---------- */
    // Export: the page builds the file (txt/md/html as text, docx/epub as
    // zip entries); it is written to the app's cache and handed to the
    // system share sheet — AirDrop, Files, Mail, whatever the writer picks.
    exportSave: async ({ format, defaultName, content, zipEntries, print }) => {
      try {
        const Share = window.Capacitor.Plugins.Share;
        if (!Share) throw new Error('Sharing is not available in this build');
        const name = (defaultName || 'book') + '.' + format;
        // A PDF is laid out by the phone's own printing (NeoPdf, in the
        // native projects): Android opens its print screen, where Save as
        // PDF is one of the printers; iOS makes the file and hands it to the
        // share sheet. A book gets the desktop's inch of margin; a script
        // lays out its own pages, on US letter as scripts always are.
        if (format === 'pdf') {
          let pdf = null;
          try { pdf = window.Capacitor.registerPlugin('NeoPdf'); } catch { /* older shell */ }
          if (!pdf) throw new Error(t('This version of Pocket can’t make PDFs yet'));
          const screenplay = print === 'screenplay';
          const html = screenplay ? content : String(content).replace('</head>', '<style>@page { margin: 1in; }</style></head>');
          const region = (navigator.language || '').split('-')[1] || '';
          const letter = screenplay || ['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT', 'CR', 'PA', 'DO', 'PR', 'SV', 'HN', 'NI', 'BZ'].includes(region.toUpperCase());
          const r = await pdf.print({ html, name: defaultName || 'book', letter, screenplay });
          if (r && r.uri) await Share.share({ title: name, url: r.uri });
          return r && r.uri ? name : null; // (Android's print screen speaks for itself)
        }
        let data;
        let encoding = 'utf8';
        if (zipEntries) {
          if (!window.JSZip) throw new Error('Zip support missing');
          const zip = new window.JSZip();
          // same shape main.js zips on the desktop: [{path, content, base64?, store?}]
          for (const e of zipEntries) {
            zip.file(e.path, e.content, { base64: !!e.base64, compression: e.store ? 'STORE' : 'DEFLATE' });
          }
          data = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE', mimeType: 'application/epub+zip' });
          encoding = undefined; // base64 to the plugin
        } else {
          data = content;
        }
        const w = await FS().writeFile({ path: 'exports/' + name, directory: 'CACHE', data, encoding, recursive: true });
        await Share.share({ title: name, url: w.uri });
        return name;
      } catch (err) {
        if (!/cancel/i.test(String(err && err.message || err))) showErrorDetail(t('Export failed: {error}', { error: String(err && err.message || err) }));
        return null;
      }
    },
    emailDraft: async () => ({ ok: false }),
    importFiles: async () => [],
    importPick: async () => [],
    pathForFile: () => null,
    checkForUpdate: async () => ({ error: true }),
    openRelease: async () => true,
    fullscreenEscape: async () => false,
    fullscreenToggle: async () => true,
    spellCheckWords: async (words) => {
      const out = {};
      for (const w of words) out[w] = true; // no checker: nothing is wrong
      if (!(await spellEnsure())) return out;
      spellCatchUp();
      const r = await spellEngine()({ type: 'check', words });
      return r.ok ? r.result : out;
    },
    spellSuggest: async (word) => {
      if (!(await spellEnsure())) return [];
      const r = await spellEngine()({ type: 'suggest', word });
      return r.ok ? r.result : [];
    },
    spellLearn: async (word) => {
      if (typeof word === 'string' && word) {
        spellAdded.add(word);
        if (spellReady) await spellEngine()({ type: 'add', word });
      }
      return true;
    },
    setSpellLanguage: async (code) => spellEnsure(code),
    appVersion: async () => 'Pocket 0.1.0',
    logError: async (msg) => {
      try {
        let prior = '';
        try { prior = await readText(p('neo-errors.log')); } catch { /* first entry */ }
        const line = `[${new Date().toISOString()}] [pocket] ${msg}\n`;
        await writeText(p('neo-errors.log'), (prior + line).slice(-100000));
      } catch { console.error(msg); }
      showErrorDetail(msg);
    },
    // no menu bar in your pocket: the ⋯ sheet (index.html) sends the same
    // messages the desktop menus do, and the tick marks come back here
    onMenu: (fn) => { window.pocketMenu = fn; },
    poetryState: (on) => { window.pocketState.poetry = !!on; },
    flushState: (on) => { window.pocketState.flush = !!on; },
    typewriterState: (on) => { window.pocketState.typewriter = !!on; }
  };
  window.pocketState = { poetry: false, flush: false, typewriter: false };

  // Interface language: the same locales/ files as the desktop, picked by
  // the device's language (regional file over its base, English beneath).
  // Read synchronously here because app.js reads window.neo.i18n as it loads.
  function loadLocale() {
    const want = String(navigator.language || 'en').replace('_', '-');
    const base = want.split('-')[0];
    const get = (code) => {
      try {
        const x = new XMLHttpRequest();
        x.open('GET', 'locales/' + code + '.json', false);
        x.send();
        if (x.responseText && (x.status === 200 || x.status === 0)) return JSON.parse(x.responseText);
      } catch { /* no such language */ }
      return null;
    };
    const english = get('en') || {};
    if (base === 'en') return { locale: 'en', dict: {}, base: english };
    const baseDict = get(base);
    const regional = want !== base ? get(want) : null;
    if (!baseDict && !regional) return { locale: 'en', dict: {}, base: english };
    return { locale: regional ? want : base, dict: { ...(baseDict || {}), ...(regional || {}) }, base: english };
  }
  try { window.neo.i18n = loadLocale(); } catch { /* English it is */ }

  // Spellcheck: desktop NEO's Hunspell and dictionaries (pocket-spell.js),
  // in a web worker so the page never waits on a dictionary. The language
  // is the library's (library.json syncs it from the desktop), else the
  // interface's when NEO has its dictionary, else US English: the same rule
  // as defaultSpellLanguage() in main.js.
  let spellCodes = null;   // { code: label }, from dict/languages.json
  let spellReady = null;   // { language, ok: Promise<boolean> }
  const spellAdded = new Set(); // the writer's own words, given to the checker
  let engine = null;
  window.pocketSpellLanguages = () => spellCodes || {};
  window.pocketSpellLanguage = () => (spellReady ? spellReady.language : spellCodes ? wantedLanguage(spellCodes) : null);

  async function spellLanguages() {
    if (!spellCodes) {
      try { spellCodes = JSON.parse(await (await fetch('dict/languages.json')).text()); } catch { spellCodes = null; return {}; }
    }
    return spellCodes;
  }
  const lib = () => (typeof library !== 'undefined' && library) || {}; // app.js's library.json
  function wantedLanguage(codes) {
    const chosen = lib().spellLanguage;
    if (codes[chosen]) return chosen;
    const ui = String((window.neo.i18n && window.neo.i18n.locale) || 'en');
    if (codes[ui]) return ui;
    if (ui === 'pt' || ui === 'pt-BR') return 'pt-BR';
    const base = ui.split('-')[0];
    return codes[base] ? base : 'en-US';
  }

  function spellEngine() {
    if (engine) return engine;
    // an older web view without module workers: check on the page instead
    let direct = null;
    let queue = Promise.resolve();
    const onPage = (msg) => (queue = queue.then(async () => {
      if (!direct) direct = await import('./pocket-spell.js');
      return direct.handle(msg);
    }).catch((err) => ({ ok: false, error: String(err && err.message || err) })));
    let worker = null;
    try { worker = new Worker('pocket-spell.js', { type: 'module' }); } catch { worker = null; }
    if (!worker) return (engine = onPage);
    const waiting = new Map();
    let seq = 0;
    let broken = false;
    worker.onmessage = (e) => {
      const w = waiting.get(e.data && e.data.id);
      if (w) { waiting.delete(e.data.id); w.done(e.data); }
    };
    worker.onerror = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      broken = true;
      try { worker.terminate(); } catch { /* gone */ }
      for (const w of waiting.values()) onPage(w.msg).then(w.done);
      waiting.clear();
    };
    return (engine = (msg) => broken ? onPage(msg) : new Promise((resolve) => {
      const id = ++seq;
      waiting.set(id, { msg, done: resolve });
      worker.postMessage({ ...msg, id });
    }));
  }

  spellLanguages(); // the list is tiny; the ⋯ sheet wants it at hand

  // load the dictionary the writer wants (or the one asked for), once
  async function spellEnsure(code) {
    const codes = await spellLanguages();
    const language = code || wantedLanguage(codes);
    if (!codes[language]) return false;
    if (spellReady && spellReady.language === language) return spellReady.ok;
    const custom = (lib().customWords || []).filter((w) => typeof w === 'string' && w);
    const ready = {
      language,
      ok: spellEngine()({ type: 'load', language, custom }).then((r) => {
        if (!r.ok) window.neo.logError('spell: ' + language + ' did not load: ' + r.error);
        return !!r.ok;
      })
    };
    spellReady = ready;
    spellAdded.clear();
    for (const w of custom) spellAdded.add(w);
    return ready.ok;
  }

  // words learned on another device since the dictionary loaded
  function spellCatchUp() {
    for (const w of lib().customWords || []) {
      if (typeof w !== 'string' || !w || spellAdded.has(w)) continue;
      spellAdded.add(w);
      spellEngine()({ type: 'add', word: w });
    }
  }

  // No right-click on a phone: with spellcheck on, a tap on an underlined
  // word opens the same suggestions (app.js answers the contextmenu event)
  document.addEventListener('click', (e) => {
    const hl = window.CSS && CSS.highlights && CSS.highlights.get('neo-spell');
    if (!hl || !hl.size || !document.caretRangeFromPoint) return;
    if (!e.target.closest || !e.target.closest('.chapter-body, #aux-editor')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const pos = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!pos) return;
    let hit = false;
    for (const r of hl) {
      try { if (r.isPointInRange(pos.startContainer, pos.startOffset)) { hit = true; break; } } catch { /* stale range */ }
    }
    if (!hit) return;
    e.target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }));
  });

  // iOS puts a shortcuts bar (bold, italic, mic, ⌘ hints) above its keyboard;
  // it covers Pocket's own bar, and NEO has its own idea of formatting
  // the keyboard's colour follows the page theme (body.night comes and goes
  // as the writer switches Night and Paper)
  if (isIOS()) {
    const tellKeyboard = () => { try { libraryHome().setKeyboard({ dark: document.body.classList.contains('night') }); } catch { /* fine */ } };
    document.addEventListener('DOMContentLoaded', () => {
      tellKeyboard();
      new MutationObserver(tellKeyboard).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    });
  }

  // Android: whatever shows around the page (the camera cutout band on a
  // Samsung, the status bar when a swipe peeks it) takes the page's own
  // color — night, paper or light — instead of the phone's white
  if (!isIOS()) {
    let bars = null;
    try { bars = window.Capacitor.registerPlugin('NeoBars'); } catch { /* older shell */ }
    const tellBars = () => {
      if (!bars) return;
      const bg = (el) => getComputedStyle(el).backgroundColor;
      let c = bg(document.body);
      if (!c || c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c)) c = bg(document.documentElement);
      bars.set({ color: c }).catch(() => { /* an older APK without the plugin */ });
    };
    document.addEventListener('DOMContentLoaded', () => {
      tellBars();
      // after a theme change, once any color transition has settled
      new MutationObserver(() => { tellBars(); setTimeout(tellBars, 450); })
        .observe(document.body, { attributes: true, attributeFilter: ['class'] });
    });
  }

  // The keyboard's height becomes a CSS variable, and Pocket's own bar and
  // panes sit above it (pocket.css). iOS is told nothing about resizing;
  // its own attempts left a black band behind when the keyboard went away.
  // Android shrinks the window for its keyboard by itself, so there the
  // variable stays 0: lifting the page again left a keyboard-sized gap (#142).
  document.addEventListener('DOMContentLoaded', () => {
    if (!isIOS()) return;
    try {
      const K = window.Capacitor.Plugins.Keyboard;
      if (!K) return;
      const setKb = (h) => document.documentElement.style.setProperty('--kb', Math.max(0, h || 0) + 'px');
      K.addListener('keyboardWillShow', (info) => setKb(info && info.keyboardHeight));
      K.addListener('keyboardWillHide', () => setKb(0));
    } catch { /* not on this platform */ }
  });

  // Android's on-screen keyboard follows the hardware: down while a physical
  // keyboard is attached (every editable field gets inputmode="none", which
  // keeps the caret and hardware typing but never summons the soft
  // keyboard), up as usual when there isn't one. Long-press ☰ flips it for
  // the moment; plugging a keyboard in or out goes back to following it.
  // iPadOS already hides its keyboard whenever a hardware one is attached,
  // so there the on-screen keyboard behaves normally unless toggled off.
  const EDITABLE = '[contenteditable], input, textarea';
  let hardwareKeyboard = false;
  let flipped = false; // long-press ☰ until the keyboard situation changes
  try { localStorage.removeItem('pocket-soft-keyboard'); } catch { /* the old always-off setting */ }
  const softKeyboardOn = () => isIOS() ? !flipped : (hardwareKeyboard === flipped);
  function applyKeyboardMode(root) {
    const soft = softKeyboardOn();
    const els = root.matches && root.matches(EDITABLE) ? [root] : [];
    (root.querySelectorAll ? [...els, ...root.querySelectorAll(EDITABLE)] : els).forEach((el) => {
      if (soft) el.removeAttribute('inputmode');
      else el.setAttribute('inputmode', 'none');
      // iOS would otherwise autocorrect, capitalise, underline and suggest
      // its way through a manuscript. The page is the writer's alone.
      if (isIOS()) {
        el.setAttribute('autocorrect', 'off');
        el.setAttribute('autocapitalize', 'off');
        el.setAttribute('autocomplete', 'off');
        el.setAttribute('spellcheck', 'false');
      }
    });
  }
  window.pocketSoftKeyboardOn = softKeyboardOn;
  window.pocketToggleSoftKeyboard = () => {
    if (isIOS()) return true; // iOS decides for itself: on screen when no keyboard is attached
    flipped = !flipped;
    applyKeyboardMode(document);
    const on = softKeyboardOn();
    // a field already focused takes the change on its next focus
    const el = document.activeElement;
    if (el && el.matches && el.matches(EDITABLE)) { el.blur(); if (on) setTimeout(() => el.focus(), 50); }
    if (typeof toast === 'function') toast(on ? t('On-screen keyboard on') : t('On-screen keyboard off — long-press ☰ to bring it back'));
    return on;
  };
  // from MainActivity, when a keyboard is connected or disconnected
  window.pocketHardwareKeyboard = (attached) => {
    if (attached === hardwareKeyboard) return;
    hardwareKeyboard = !!attached;
    flipped = false;
    applyKeyboardMode(document);
    const el = document.activeElement;
    if (!hardwareKeyboard && el && el.matches && el.matches(EDITABLE)) { el.blur(); setTimeout(() => el.focus(), 50); }
  };
  if (!isIOS()) {
    try {
      const bars = window.Capacitor.registerPlugin('NeoBars');
      bars.keyboard().then((r) => window.pocketHardwareKeyboard(!!(r && r.hardware))).catch(() => {});
    } catch { /* older shell */ }
  }
  document.addEventListener('DOMContentLoaded', () => {
    applyKeyboardMode(document);
    new MutationObserver((muts) => {
      muts.forEach((m) => {
        m.addedNodes.forEach((n) => { if (n.nodeType === 1) applyKeyboardMode(n); });
        if (m.type === 'attributes' && m.target.nodeType === 1) applyKeyboardMode(m.target);
      });
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable'] });
  });
  document.addEventListener('focusin', (e) => { if (e.target && e.target.matches && e.target.matches(EDITABLE)) applyKeyboardMode(e.target); }, true);

  // Android's back gesture / Esc lands here (see MainActivity). Returns true
  // when the page handled it, false to let Android background the app.
  window.pocketBack = () => {
    try {
      const nav = document.getElementById('nav-pane');
      if (nav && nav.classList.contains('open')) { nav.classList.remove('open'); return true; }
      const side = document.getElementById('side-pane');
      if (side && side.classList.contains('open')) { side.classList.remove('open'); return true; }
      const modal = document.querySelector('.modal-backdrop:not([hidden])');
      if (modal) { modal.hidden = true; return true; }
      const editor = document.getElementById('editor-view');
      if (editor && !editor.hidden && typeof backToShelf === 'function') { backToShelf(); return true; }
    } catch (err) { console.error(err); }
    return false;
  };
})();
