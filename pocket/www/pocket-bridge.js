/* =========================== NEO POCKET =========================== */
/* The window.neo doorway, implemented for Android. Reads and writes    */
/* the same plain files as desktop NEO, in Documents/NEO Library —      */
/* shared with the Mac via Syncthing. Desktop-only powers (export,      */
/* email, spellcheck, import) stub out quietly; writing never does.     */

(function () {
  const FS = () => window.Capacitor.Plugins.Filesystem;
  const DIR = 'DOCUMENTS';
  const ROOT = 'NEO Library';

  const p = (...parts) => [ROOT, ...parts].join('/');

  async function ensureDir(path) {
    try {
      await FS().mkdir({ path, directory: DIR, recursive: true });
    } catch { /* exists */ }
  }

  async function readText(path) {
    const r = await FS().readFile({ path, directory: DIR, encoding: 'utf8' });
    return r.data;
  }

  async function writeText(path, data) {
    try {
      await FS().writeFile({ path, directory: DIR, data, encoding: 'utf8', recursive: true });
    } catch (err) {
      showPermissionHelp();
      throw err;
    }
  }

  let permissionHelpShown = false;
  function showPermissionHelp() {
    if (permissionHelpShown) return;
    permissionHelpShown = true;
    const bd = document.createElement('div');
    bd.style.cssText = 'position:fixed;inset:0;background:#191919;color:#d6d2c6;z-index:9999;' +
      'display:flex;align-items:center;justify-content:center;padding:40px;text-align:center';
    bd.innerHTML = '<div style="max-width:420px"><h2 style="letter-spacing:5px">NEO POCKET</h2>' +
      '<p style="line-height:1.6;margin-top:16px">Pocket can see the NEO Library folder but Android is blocking it from reading files that other apps (like Syncthing) created.</p>' +
      '<p style="line-height:1.6;color:#999;margin-top:12px">The switch is not on the app\'s own Permissions page. Open Android Settings, search for <b>All files access</b> (or Apps → Special app access → All files access), turn it on for NEO Pocket, then come back here.</p></div>';
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
      box.textContent = String(msg).slice(0, 2000) + '\n\n(tap to dismiss)';
    } catch { /* never let the reporter itself hiccup */ }
  }

  async function readJSONFile(path, fallback) {
    try { return JSON.parse(await readText(path)); } catch { return fallback; }
  }

  async function writeJSONFile(path, data) {
    await writeText(path, JSON.stringify(data, null, 2));
  }

  const bookDir = (bookId) => p(bookId);

  // The honest access test: reading a file another app created. An app can
  // always touch its OWN files without the big permission — which is exactly
  // how a too-gentle test lies about a half-broken setup.
  async function checkAccess() {
    try {
      await ensureDir(ROOT);
      let names = [];
      try {
        const ls = await FS().readdir({ path: ROOT, directory: DIR });
        names = (ls.files || []).map((f) => (f && f.name) || f);
      } catch { /* fall through to the write test */ }
      if (names.includes('library.json')) {
        await readText(p('library.json')); // the file that matters, whoever made it
      } else {
        await FS().writeFile({ path: p('.pocket-touch'), directory: DIR, data: String(Date.now()), encoding: 'utf8', recursive: true });
        try { await FS().deleteFile({ path: p('.pocket-touch'), directory: DIR }); } catch { /* fine */ }
      }
      return true;
    } catch (err) {
      showPermissionHelp();
      return false;
    }
  }

  function slugify(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }

  window.neo = {
    /* ---------- library ---------- */
    readLibrary: async () => {
      if (!(await checkAccess())) return { authorName: '', penNames: [], firstRunDone: false, shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }] };
      return readJSONFile(p('library.json'), {
        authorName: '', penNames: [], firstRunDone: false, pageTheme: 'night',
        shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
      });
    },
    writeLibrary: async (data) => { await writeJSONFile(p('library.json'), data); return true; },
    libraryPath: async () => {
      // a served URL lets cover art render in the webview
      try {
        const u = await FS().getUri({ path: ROOT, directory: DIR });
        return window.Capacitor.convertFileSrc(u.uri);
      } catch { return 'Documents/NEO Library'; }
    },

    /* ---------- books ---------- */
    readBookMeta: (bookId) => readJSONFile(p(bookId, 'book.json'), null),
    writeBookMeta: async (bookId, meta) => {
      meta.modified = new Date().toISOString();
      await writeJSONFile(p(bookId, 'book.json'), meta);
      return true;
    },
    createBook: async (opts) => {
      const seed = (opts && opts.title) ? slugify(opts.title) : '';
      const id = 'book-' + (seed ? seed + '-' : '') + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      const book = {
        id,
        title: (opts && opts.title) || 'Untitled',
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
    deleteBook: async () => false, // manage the shelves from your Mac

    /* ---------- chapters ---------- */
    readChapter: async (bookId, chId) => {
      try { return await readText(p(bookId, 'chapters', chId + '.html')); } catch { return ''; }
    },
    writeChapter: async (bookId, chId, html) => {
      await ensureDir(bookDir(bookId) + '/chapters');
      await writeText(p(bookId, 'chapters', chId + '.html'), html);
      return true;
    },
    deleteChapter: async (bookId, chId) => {
      try { await FS().deleteFile({ path: p(bookId, 'chapters', chId + '.html'), directory: DIR }); } catch { /* fine */ }
      return true;
    },

    /* ---------- notes / outline / json sidecars ---------- */
    readAux: async (bookId, name) => {
      try { return await readText(p(bookId, name + '.html')); } catch { return ''; }
    },
    writeAux: async (bookId, name, html) => { await writeText(p(bookId, name + '.html'), html); return true; },
    readJSON: (bookId, name, fallback) => readJSONFile(p(bookId, name + '.json'), fallback),
    writeJSON: async (bookId, name, data) => { await writeJSONFile(p(bookId, name + '.json'), data); return true; },

    /* ---------- covers: shown if present, managed on the Mac ---------- */
    readCover: async (bookId, fname) => {
      try {
        const r = await FS().readFile({ path: p(bookId, fname), directory: DIR });
        const ext = fname.split('.').pop().toLowerCase();
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        return { base64: r.data, mime, ext };
      } catch { return null; }
    },
    pickCover: async () => null,
    setCover: async () => null,
    removeCover: async () => true,

    /* ---------- desktop powers, politely absent ---------- */
    exportSave: async () => null,
    emailDraft: async () => ({ ok: false }),
    importFiles: async () => [],
    importPick: async () => [],
    pathForFile: () => null,
    checkForUpdate: async () => ({ error: true }),
    openRelease: async () => true,
    fullscreenEscape: async () => false,
    fullscreenToggle: async () => true,
    spellCheckWords: async (words) => { const o = {}; for (const w of words) o[w] = true; return o; },
    spellSuggest: async () => [],
    spellLearn: async () => true,
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
    onMenu: () => { /* no menu bar in your pocket */ }
  };

  // Pocket is written on a real keyboard, so Android's on-screen one stays
  // down: every editable field gets inputmode="none", which keeps the caret
  // and hardware typing but never summons the soft keyboard. Long-press the
  // ☰ button to bring it back for an emergency (and again to send it away).
  const EDITABLE = '[contenteditable], input, textarea';
  let softKeyboard = false;
  try { softKeyboard = localStorage.getItem('pocket-soft-keyboard') === 'on'; } catch { /* fine */ }
  function applyKeyboardMode(root) {
    const els = root.matches && root.matches(EDITABLE) ? [root] : [];
    (root.querySelectorAll ? [...els, ...root.querySelectorAll(EDITABLE)] : els).forEach((el) => {
      if (softKeyboard) el.removeAttribute('inputmode');
      else el.setAttribute('inputmode', 'none');
    });
  }
  window.pocketToggleSoftKeyboard = () => {
    softKeyboard = !softKeyboard;
    try { localStorage.setItem('pocket-soft-keyboard', softKeyboard ? 'on' : 'off'); } catch { /* fine */ }
    applyKeyboardMode(document);
    if (softKeyboard && document.activeElement) { document.activeElement.blur(); }
    if (typeof toast === 'function') toast(softKeyboard ? 'On-screen keyboard on' : 'On-screen keyboard off — long-press ☰ to bring it back');
    return softKeyboard;
  };
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
