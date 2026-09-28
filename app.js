/* =============================== NEO =============================== */

'use strict';

// ---------- interface language (see i18n.js and locales/) ----------
// The English text is the key: t('Cancel') shows the translation when the
// chosen language has one, and the English original otherwise.
(() => {
  const l = (window.neo && window.neo.i18n) || {};
  NeoI18n.setLocale(l.locale || 'en', l.dict || {}, l.base || {});
})();
const { t, fmtNum, fmtDate } = NeoI18n;

// index.html marks its words with data-i18n (text), data-i18n-title,
// data-i18n-placeholder and data-i18n-ph (the empty-field hints)
function applyStaticI18n(root = document) {
  document.documentElement.lang = NeoI18n.getLocale();
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.textContent.replace(/\s+/g, ' ').trim()); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { if (el.title) el.title = t(el.title); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.placeholder); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.dataset.ph = t(el.dataset.ph); });
  // hints that styles.css draws with ::before read these custom properties
  const cssHints = {
    '--ph-add-title': t('add a title'),
    '--ph-write-freely': t('Write freely…'),
    '--ph-ol-chapter': t('What happens in this chapter…'),
    '--ph-ol-section': t('What happens in this section…'),
    '--ph-nav-note': t('What happens here…')
  };
  for (const [name, text] of Object.entries(cssHints)) {
    document.documentElement.style.setProperty(name, JSON.stringify(text));
  }
}
applyStaticI18n();

// Books keep the title they were created with, so "Untitled" may be stored
// in any language: both the English word and the current one count.
// tk() marks a string for translation where it is defined and t() is
// applied later, when it is shown
const tk = (s) => s;

// The Notes and Outline tabs keep their default names in English and show
// them in the current language; a name the writer chose shows as written.
const tabName = (kind) => {
  const n = (book && book.tabNames && book.tabNames[kind]) || (kind === 'notes' ? 'Notes' : kind === 'outline' ? 'Outline' : kind);
  return n === 'Notes' || n === 'Outline' ? t(n) : n;
};

const isUntitled = (s) => !s || s === 'Untitled' || s === t('Untitled');

// ---------- state ----------
let library = null;          // library.json
let book = null;             // current book.json
let chapterHTML = {};        // chapterId -> html (loaded at open)
let savedHTML = {};          // chapterId -> html as last read from / written to disk
let savedMetaSig = '';       // book.json as last read/written, minus the volatile bits
let diskStamps = {};         // chapterId -> file mtime as of the last look at the disk
let stickies = [];           // [{id, chapterId, text, resolved}]
let darlings = [];           // [{id, html, text, chapterId, chapterLabel, date}]
let currentTab = 'manuscript';
let currentChapterId = null; // chapter the caret/scroll is in
let wordMode = 'book';       // 'book' | 'chapter'
let saveTimers = {};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Platform-aware key labels: Macs read ⌘⇧X, everyone else reads Ctrl+Shift+X
const IS_MAC = navigator.platform.toLowerCase().includes('mac');
// a touch screen (Pocket): nothing to hover, no right button
const NO_HOVER = !!(window.matchMedia && window.matchMedia('(hover: none)').matches) || !!window.Capacitor;

// Touch has no right-click: a long press on a book, a shelf name or a chapter
// heading opens the same menu. Not inside the text itself — there a long
// press belongs to the system's own selection handles.
(() => {
  let timer = null;
  let start = null;
  let swallowClick = false;
  let armed = false; // held long enough; the menu opens when the finger lifts
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const target = e.target;
    if (!target.closest) return;
    // shelf names are editable on tap, but a long press on one is a menu
    if (target.closest('[contenteditable="true"], input, textarea')) return;
    if (target.closest('#pocket-chapters')) return;
    const p = e.touches[0];
    start = { x: p.clientX, y: p.clientY, target };
    armed = false;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; armed = true; }, 550);
  }, { passive: true });
  const cancel = () => { clearTimeout(timer); timer = null; armed = false; };
  document.addEventListener('touchmove', (e) => {
    if (!start) return;
    const p = e.touches[0];
    if (Math.hypot(p.clientX - start.x, p.clientY - start.y) > 10) cancel();
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (armed && start) {
      // iOS usually sends no click after a long press; when it does, it
      // comes at once — so the guard lifts itself before the menu's first tap
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 300);
      const { target, x, y } = start;
      setTimeout(() => target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y })), 30);
    }
    cancel();
  }, { passive: true });
  document.addEventListener('touchcancel', cancel, { passive: true });
  // the tap that ends a long press must not also open the book
  document.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
})();
const K = (mac, pc) => (IS_MAC ? mac : pc);
const KZ = K('⌘Z', 'Ctrl+Z');
const KPH = K('⌘⇧X', 'Ctrl+Shift+X');
const KDA = K('⌘⇧D', 'Ctrl+Shift+D');
const KHELP = K('⌘/', 'Ctrl+/');

// Scrollbars stay invisible until you scroll, then fade away again —
// chrome only when needed.
document.addEventListener('scroll', (e) => {
  const el = e.target;
  if (!el || !el.classList) return;
  el.classList.add('show-scrollbar');
  clearTimeout(el._neoSbHide);
  el._neoSbHide = setTimeout(() => el.classList.remove('show-scrollbar'), 750);
}, true);

function askInput(title, placeholder, value = '') {
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `
      <div class="modal" style="width:380px">
        <h2 style="font-size:16px">${title}</h2>
        <input type="text" spellcheck="false" placeholder="${placeholder}" />
        <div style="text-align:right;margin-top:14px">
          <button class="m-cancel btn-quiet" style="margin-right:10px">${t('Cancel')}</button>
          <button class="m-ok btn-gold">${t('OK')}</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    const input = bd.querySelector('input');
    input.value = value;
    input.focus();
    input.select();
    const done = (val) => { bd.remove(); resolve(val); };
    bd.querySelector('.m-ok').onclick = () => done(input.value.trim());
    bd.querySelector('.m-cancel').onclick = () => done(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') done(input.value.trim());
      if (e.key === 'Escape') done(null);
    };
  });
}

// A list of choices, null on cancel.
function optionModal(title, message, options) {
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    const buttons = options.map((o, i) =>
      `<button class="fr-choice" data-i="${i}" style="width:100%;margin-bottom:8px;${o.danger ? 'border-color:#6b3a34' : ''}">
        <strong${o.danger ? ' style="color:#d97b6c"' : ''}>${o.label}</strong>
        ${o.desc ? `<span>${o.desc}</span>` : ''}
      </button>`).join('');
    bd.innerHTML = `
      <div class="modal" style="width:420px">
        <h2 style="font-size:16px">${title}</h2>
        ${message ? `<p>${message}</p>` : ''}
        ${buttons}
        <div style="text-align:right;margin-top:6px">
          <button class="m-cancel btn-quiet">${t('Cancel')}</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    const done = (val) => { bd.remove(); resolve(val); };
    bd.querySelectorAll('.fr-choice').forEach((b) => {
      b.onclick = () => done(options[+b.dataset.i].value);
    });
    bd.querySelector('.m-cancel').onclick = () => done(null);
    bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
  });
}

// A click (or tap) on the dim page around any dialog dismisses it the way
// its own quiet button would — Cancel or Later where there is one, else
// Done/OK. Dialogs that must be answered have neither and stay put.
document.addEventListener('mousedown', (e) => {
  const bd = e.target && e.target.classList && e.target.classList.contains('modal-backdrop') ? e.target : null;
  if (!bd || bd.dataset.stay === '1') return;
  const btn = bd.querySelector('.m-cancel') || bd.querySelector('.m-ok');
  if (btn) btn.click();
});

function toast(msg, ms = 4000) {
  const h = $('#hint');
  h.textContent = msg;
  h.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { h.hidden = true; }, ms);
}

// a word holds at least one letter or digit, so French « » and spaced
// dashes are not counted as words
const countWords = (text) => (text.trim().match(/\S+/g) || []).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

function cleanChapterEl(id) {
  const el = document.querySelector(`.chapter[data-id="${id}"] .chapter-body`);
  const holder = document.createElement('div');
  holder.innerHTML = el ? el.innerHTML : (chapterHTML[id] || '');
  holder.querySelectorAll('.darling-anchor, .ph-mark, .ghost').forEach((n) => n.remove());
  return holder;
}
const chapterText = (id) => cleanChapterEl(id).innerText;

// Word counts are cached per chapter and only recomputed for the chapter being edited.
let wordCache = {};
function chapterWords(chId) {
  if (wordCache[chId] == null) wordCache[chId] = countWords(chapterText(chId));
  return wordCache[chId];
}

/* ================================================================== */
/*  BOOKSHELF                                                          */
/* ================================================================== */

let libraryDirPath = '';

function coverUrl(meta) {
  // Pocket serves the library through a URL; desktop hands a plain path
  if (/^[a-z]+:\/\//.test(libraryDirPath)) {
    return libraryDirPath + '/' + encodeURIComponent(meta.id) + '/' + encodeURIComponent(meta.coverImage);
  }
  const p = (libraryDirPath + '/' + meta.id + '/' + meta.coverImage).replace(/\\/g, '/');
  return encodeURI('file://' + (p.startsWith('/') ? '' : '/') + p);
}

async function loadLibrary() {
  libraryDirPath = await window.neo.libraryPath();
  library = await window.neo.readLibrary();
  if (window.neo.writingStyleState) window.neo.writingStyleState(library.writingStyle);
  if (!library.firstRunDone) {
    showFirstRun();
  }
  renderShelves();
}

function showFirstRun() {
  const fr = $('#firstrun');
  fr.hidden = false;
  let picked = { body: Object.keys(BODY_FONTS)[0] || 'Georgia', dropcap: 'literary' };

  // Step 1: who are you, and how do you write?
  $$('.fr-choice').forEach((btn) => {
    btn.onclick = () => {
      library.authorName = $('#fr-name').value.trim();
      const pen = $('#fr-pen').value.trim();
      library.penNames = pen ? [pen] : [];
      library.writingStyle = btn.dataset.style;
      if (window.neo.writingStyleState) window.neo.writingStyleState(library.writingStyle);
      $('#fr-step1').hidden = true;
      $('#fr-step2').hidden = false;
      buildFontStep();
    };
  });

  // Step 2: fonts, with a WYSIWYG sample
  function preview() {
    document.documentElement.style.setProperty('--body-font', BODY_FONTS[picked.body]);
    document.documentElement.style.setProperty('--dropcap-font', DROPCAP_FONTS[picked.dropcap]);
  }
  function buildFontStep() {
    const bodyRow = $('#fr-bodyfonts');
    bodyRow.innerHTML = '';
    for (const name of BODY_FONT_CHOICES) {
      const b = document.createElement('button');
      b.className = 'fr-font' + (picked.body === name ? ' sel' : '');
      b.textContent = name;
      b.style.fontFamily = BODY_FONTS[name];
      b.onmouseenter = () => { document.documentElement.style.setProperty('--body-font', BODY_FONTS[name]); };
      b.onmouseleave = preview;
      b.onclick = () => {
        picked.body = name;
        buildFontStep();
        preview();
      };
      bodyRow.appendChild(b);
    }
    const capRow = $('#fr-dropcaps');
    capRow.innerHTML = '';
    const caps = { literary: t('Literary'), fantasy: t('Fantasy'), scifi: t('Sci-Fi') };
    for (const key of Object.keys(caps)) {
      const b = document.createElement('button');
      b.className = 'fr-font' + (picked.dropcap === key ? ' sel' : '');
      b.innerHTML = `<span class="fr-cap" style="font-family:${DROPCAP_FONTS[key].replace(/"/g, '&quot;')}">A</span>${caps[key]}`;
      b.onmouseenter = () => { document.documentElement.style.setProperty('--dropcap-font', DROPCAP_FONTS[key]); };
      b.onmouseleave = preview;
      b.onclick = () => {
        picked.dropcap = key;
        buildFontStep();
        preview();
      };
      capRow.appendChild(b);
    }
    preview();
  }

  $('#fr-done').onclick = async () => {
    library.fonts = { body: picked.body, dropcap: picked.dropcap };
    library.firstRunDone = true;
    // the shelf was drawn (and the author record seeded as Anonymous) before
    // the name was typed — carry the name across
    currentAuthor().name = library.authorName || (library.penNames || [])[0] || t('Anonymous');
    await window.neo.writeLibrary(library);
    applyFonts();
    fr.hidden = true;
    renderShelves();
  };
}

// Pen names: each author owns a set of shelves. Books all live in the one
// NEO Library folder on disk regardless of name — switching or deleting a
// pen name never touches files.
function currentAuthor() {
  if (!library.authors || !library.authors.length) {
    library.authors = [{
      id: 'a1',
      name: library.authorName || (library.penNames && library.penNames[0]) || t('Anonymous')
    }];
  }
  return library.authors.find((a) => a.id === library.currentAuthorId) || library.authors[0];
}

function shelvesFor(authorId) {
  const homeId = library.authors[0].id;
  return library.shelves.filter((s) => (s.authorId || homeId) === authorId);
}

function displayAuthor() {
  return currentAuthor().name || t('Anonymous');
}

// Redrawing the shelves used to read every book.json again — eighty files
// through the bridge on Pocket, for a shelf rename. The shelves now keep
// what they last read; any write to a book, and every look at the disk
// (refreshFromDisk), forgets it.
const bookMetaCache = new Map();
async function shelfMeta(bookId) {
  if (bookMetaCache.has(bookId)) return bookMetaCache.get(bookId);
  const meta = await window.neo.readBookMeta(bookId);
  if (meta) bookMetaCache.set(bookId, meta);
  return meta;
}
(() => {
  const write = window.neo.writeBookMeta;
  window.neo.writeBookMeta = (bookId, meta) => { bookMetaCache.delete(bookId); return write(bookId, meta); };
})();

async function renderShelves() {
  await NeoCovers.ready; // display faces, so titles measure true
  const view = $('#bookshelf-view');
  const keepScroll = view.scrollTop; // re-rendering must not move the page
  $('#author-chip').textContent = displayAuthor();
  const wrap = $('#shelves');
  // the new shelves are built off-screen and swapped in whole, so the page
  // never goes blank while books are read from disk — no flash on a drop
  const built = document.createDocumentFragment();
  // shelves drag by their grip to reorder, with a gold bar showing the drop spot
  if (!wrap.dataset.dndWired) {
    wrap.dataset.dndWired = '1';
    wrap.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('application/x-neo-shelf')) return;
    e.preventDefault();
    let ind = wrap.querySelector('.shelf-drop-ind');
    if (!ind) {
      ind = document.createElement('div');
      ind.className = 'shelf-drop-ind';
    }
    let placed = false;
    for (const s of wrap.querySelectorAll('.shelf:not(.dragging)')) {
      const r = s.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        wrap.insertBefore(ind, s);
        placed = true;
        break;
      }
    }
      if (!placed) wrap.appendChild(ind);
    });
    wrap.addEventListener('drop', async (e) => {
      const shelfId = e.dataTransfer.getData('application/x-neo-shelf');
      if (!shelfId) return;
      e.preventDefault();
      const ind = wrap.querySelector('.shelf-drop-ind');
      let index = library.shelves.length;
      if (ind) {
        index = 0;
        for (const c of wrap.children) {
          if (c === ind) break;
          if (c.classList.contains('shelf') && !c.classList.contains('dragging')) index++;
        }
        ind.remove();
      }
      const moving = library.shelves.find((s) => s.id === shelfId);
      if (!moving) return;
      library.shelves = library.shelves.filter((s) => s.id !== shelfId);
      library.shelves.splice(index, 0, moving);
      await window.neo.writeLibrary(library);
      // move the shelf on screen rather than redrawing everything
      const secs = [...wrap.querySelectorAll('.shelf')];
      const movingSec = secs.find((el) => el.dataset.shelfId === shelfId);
      const others = secs.filter((el) => el !== movingSec);
      if (movingSec) wrap.insertBefore(movingSec, others[index] || null);
      else renderShelves();
    });
  }

  for (const shelf of shelvesFor(currentAuthor().id)) {
    const sec = document.createElement('section');
    sec.className = 'shelf';
    sec.dataset.shelfId = shelf.id;

    const grip = document.createElement('span');
    grip.className = 'shelf-grip';
    grip.textContent = '⠿';
    grip.title = t('Drag to reorder shelves');
    grip.draggable = true;
    grip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-neo-shelf', shelf.id);
      sec.classList.add('dragging');
    });
    grip.addEventListener('dragend', () => {
      sec.classList.remove('dragging');
      const ind = document.querySelector('.shelf-drop-ind');
      if (ind) ind.remove();
    });
    sec.appendChild(grip);

    const label = document.createElement('span');
    label.className = 'shelf-label';
    // on a touch screen the name turns editable only when tapped, so a long
    // press (the menu) never wakes the keyboard or selects the text
    label.contentEditable = NO_HOVER ? 'false' : 'true';
    label.spellcheck = false;
    label.textContent = shelf.name;
    label.title = t('Click to rename · right-click to export or delete');
    if (NO_HOVER) {
      label.addEventListener('click', () => {
        if (label.isContentEditable) return;
        label.contentEditable = 'true';
        label.focus();
        const r = document.createRange();
        r.selectNodeContents(label);
        r.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      });
    }
    label.addEventListener('blur', async () => {
      shelf.name = label.textContent.trim() || shelf.name;
      label.textContent = shelf.name;
      if (NO_HOVER) label.contentEditable = 'false';
      await window.neo.writeLibrary(library);
    });
    label.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); label.blur(); }
    });
    // right-click a shelf label: publish it as one book, or delete it
    label.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      const choice = await optionModal(t('Shelf “{name}”', { name: shelf.name }), null, [
        {
          label: t('Export shelf as anthology…'),
          desc: shelf.bookIds.length
            ? t('Collect its {n} works, in shelf order, into a single book with a table of contents.', { n: shelf.bookIds.length })
            : t('Collect the works, in shelf order, into a single book with a table of contents.'),
          value: 'anthology'
        },
        { label: t('Delete shelf'), desc: t('Books move to another shelf. Nothing is deleted from disk.'), danger: true, value: 'del' }
      ]);
      if (choice === 'anthology') {
        await exportShelfAnthology(shelf);
      } else if (choice === 'del') {
        const mine = shelvesFor(currentAuthor().id);
        if (mine.length === 1) {
          toast(t('This is your only shelf — add another before deleting this one'));
          return;
        }
        const other = mine.find((s) => s.id !== shelf.id);
        for (const id of shelf.bookIds) {
          if (!other.bookIds.includes(id)) other.bookIds.push(id);
        }
        library.shelves = library.shelves.filter((s) => s.id !== shelf.id);
        await window.neo.writeLibrary(library);
        renderShelves();
      }
    });
    const row = document.createElement('div');
    row.className = 'shelf-books';
    row.dataset.shelfId = shelf.id;

    // drag targets: reorder within a shelf, move between shelves, or drop
    // manuscript files straight from Finder
    row.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        row.classList.add('drag-over');
        return;
      }
      if (!e.dataTransfer.types.includes('application/x-neo-book')) return;
      e.preventDefault();
      row.classList.add('drag-over');
      const ind = dropIndicator();
      let placed = false;
      for (const t of row.querySelectorAll('.book:not(.dragging)')) {
        const r = t.getBoundingClientRect();
        // cursor above this book's row, or on its row and left of center
        if (e.clientY < r.top || (e.clientY < r.bottom && e.clientX < r.left + r.width / 2)) {
          row.insertBefore(ind, t);
          placed = true;
          break;
        }
      }
      if (!placed) row.insertBefore(ind, row.querySelector('.new-book'));
    });
    row.addEventListener('dragleave', (e) => {
      if (row.contains(e.relatedTarget)) return;
      row.classList.remove('drag-over');
      const ind = document.querySelector('.drop-indicator');
      if (ind && ind.parentElement === row) ind.remove();
    });
    row.addEventListener('drop', async (e) => {
      row.classList.remove('drag-over');
      // files from Finder → import them right onto this shelf
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        e.preventDefault();
        const paths = [...e.dataTransfer.files]
          .map((f) => { try { return window.neo.pathForFile(f); } catch { return null; } })
          .filter(Boolean);
        if (!paths.length) return;
        toast(t('Importing…'));
        const results = await window.neo.importFiles(paths);
        if (!results.length) { toast(t('No .docx, .txt, or .md files in that drop')); return; }
        await addImportedBooks(results, shelf);
        return;
      }
      const bookId = e.dataTransfer.getData('application/x-neo-book');
      if (!bookId) return;
      e.preventDefault();
      // insertion index = how many (non-dragged) books sit before the indicator
      const ind = document.querySelector('.drop-indicator');
      let index = shelf.bookIds.filter((b) => b !== bookId).length;
      if (ind && ind.parentElement === row) {
        index = 0;
        for (const c of row.children) {
          if (c === ind) break;
          if (c.classList.contains('book') && !c.classList.contains('dragging')) index++;
        }
      }
      if (ind) ind.remove();
      for (const s of library.shelves) s.bookIds = s.bookIds.filter((b) => b !== bookId);
      shelf.bookIds.splice(index, 0, bookId);
      await window.neo.writeLibrary(library);
      // slide the tile into place; the shelf itself is not redrawn
      const tile = document.querySelector(`.book[data-book-id="${bookId}"]`);
      if (tile) {
        const others = [...row.querySelectorAll('.book')].filter((b) => b !== tile);
        row.insertBefore(tile, others[index] || row.querySelector('.new-book'));
        tile.classList.remove('dragging');
      } else renderShelves();
    });

    for (const bookId of shelf.bookIds) {
      const meta = await shelfMeta(bookId);
      if (!meta) continue;
      row.appendChild(bookTile(meta));
    }

    // the blank page — click to begin
    const blank = document.createElement('div');
    blank.className = 'new-book';
    blank.textContent = '+';
    blank.title = t('Start a new book');
    blank.onclick = () => createBookOnShelf(shelf);
    row.appendChild(blank);

    sec.appendChild(label);
    sec.appendChild(row);
    built.appendChild(sec);
  }
  wrap.replaceChildren(built);
  view.scrollTop = keepScroll;
}

// single shared drop-position indicator for shelf drags
let _dropInd = null;
function dropIndicator() {
  if (!_dropInd) {
    _dropInd = document.createElement('div');
    _dropInd.className = 'drop-indicator';
  }
  return _dropInd;
}

// Covers are two layers the shelf composites live: art (a seeded abstract,
// an image the writer chose, or one NEO painted from the text) and type.
// See covers.js. Painted art is read once and downsampled to tile size so
// forty books on a shelf cost about as much as forty small PNGs.
const artCache = new Map(); // bookId/file -> { url, canvas }

async function paintedArt(meta) {
  const art = meta.coverArt;
  if (!art || art.status !== 'done' || !art.file) return null;
  const key = meta.id + '/' + art.file;
  if (artCache.has(key)) return artCache.get(key);
  try {
    const data = await window.neo.readCover(meta.id, art.file);
    if (!data) { window.neo.logError('painted cover missing on disk: ' + key); return null; }
    const entry = await NeoCovers.fitImage(key, `data:${data.mime};base64,${data.base64}`);
    if (!entry) { window.neo.logError('painted cover would not decode: ' + key); return null; }
    artCache.set(key, entry);
    return entry;
  } catch (err) {
    window.neo.logError('painted cover: ' + (err && err.stack || err));
    return null;
  }
}

// Which layers a book has to show, and which one is showing. Nothing is
// ever thrown away by switching: the writer's image, NEO's painting, and the
// abstract all stay available, and coverMode just picks one.
const hasPainting = (meta) => !!(meta.coverArt && meta.coverArt.status === 'done' && meta.coverArt.file);
function coverMode(meta) {
  const m = meta.coverMode;
  if (m === 'image' && meta.coverImage) return 'image';
  if (m === 'painted' && hasPainting(meta)) return 'painted';
  if (m === 'abstract') return 'abstract';
  return meta.coverImage ? 'image' : hasPainting(meta) ? 'painted' : 'abstract';
}

function dressTile(el, meta) {
  el.classList.remove('has-cover');
  const mode = coverMode(meta);
  if (mode === 'image') {
    el.classList.add('has-cover');
    el.style.background = `#1d1d1d url("${coverUrl(meta)}") center / cover no-repeat`;
    return;
  }
  el.classList.toggle('cv-painting', !!(meta.coverArt && meta.coverArt.status === 'pending'));
  const token = (el._dressToken = (el._dressToken || 0) + 1);
  // a painting already decoded is drawn straight away; otherwise the
  // abstract shows instantly and the painting replaces it once read.
  // The tile may not be on the page yet when the art arrives, so the only
  // staleness check is whether this tile has been dressed again since.
  const cached = mode === 'painted' && artCache.get(meta.id + '/' + meta.coverArt.file);
  NeoCovers.dress(el, NeoCovers.plan(meta, cached || undefined));
  if (mode !== 'painted' || cached) return;
  paintedArt(meta).then((art) => {
    if (art && el._dressToken === token) NeoCovers.dress(el, NeoCovers.plan(meta, art));
  });
}

function bookTile(meta) {
  const el = document.createElement('div');
  el.className = 'book';
  el.dataset.bookId = meta.id;
  el.draggable = true;
  el.innerHTML = `
    <div class="b-text"><div class="b-title"></div><div class="b-author"></div></div>
    <span class="b-refresh" title="${t('New cover')}">&#8635;</span>
    <div class="b-painting" hidden></div>
    <div class="b-progress" hidden><div></div></div>`;
  el.querySelector('.b-author').textContent = meta.author || '';
  dressTile(el, meta);
  el.querySelector('.b-painting').hidden = !(meta.coverArt && meta.coverArt.status === 'pending');
  el.querySelector('.b-refresh').onclick = async (e) => {
    e.stopPropagation();
    await refreshCover(meta, el);
  };
  if (meta.wordGoal > 0) {
    const bar = el.querySelector('.b-progress');
    bar.hidden = false;
    const pct = Math.min(100, Math.round(((meta.wordCount || 0) / meta.wordGoal) * 100));
    bar.firstElementChild.style.width = pct + '%';
  }
  el.title = meta.wordGoal
    ? t('{title} — {count} / {goal} words', { title: meta.title, count: meta.wordCount || 0, goal: meta.wordGoal })
    : meta.title;
  el.onclick = () => openBook(meta.id);
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/x-neo-book', meta.id);
    // the ghost that rides under the cursor is a faded, smaller cover, held
    // by its top-left corner so it never sits on top of a drop target's label
    el.style.opacity = '0.45';
    el.style.transform = 'scale(0.7)';
    e.dataTransfer.setDragImage(el, 12, 12);
    setTimeout(() => { el.style.opacity = ''; el.style.transform = ''; el.classList.add('dragging'); }, 0);
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  // images dragged from Finder onto a book become its cover;
  // manuscripts dropped here import onto this book's shelf
  el.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  el.addEventListener('drop', async (e) => {
    if (!e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    e.stopPropagation();
    let p = null;
    try { p = window.neo.pathForFile(e.dataTransfer.files[0]); } catch { /* no path */ }
    if (!p) return;
    if (/\.(png|jpe?g|webp)$/i.test(p)) {
      const fname = await window.neo.setCover(meta.id, p);
      if (fname) {
        meta.coverImage = fname;
        meta.coverMode = 'image';
        await window.neo.writeBookMeta(meta.id, meta);
        renderShelves();
      }
    } else if (/\.(docx|txt|md)$/i.test(p)) {
      const homeShelf = library.shelves.find((s) => s.bookIds.includes(meta.id)) || library.shelves[0];
      const results = await window.neo.importFiles([p]);
      if (results.length) await addImportedBooks(results, homeShelf);
    }
  });

  el.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    const options = [];
    // no hover on a touch screen, so the ↻ that lives under the pointer
    // moves into the menu; picking an image file is a desktop affair
    if (NO_HOVER) options.push({ label: t('New cover'), desc: t('Another abstract cover for this book.'), value: 'refresh' });
    else options.push({ label: meta.coverImage ? t('Replace cover art…') : t('Set cover art…'), desc: t('Pick an image (2:3 works best). Or just drag one from Finder onto the book.'), value: 'cover' });
    if (meta.coverImage) {
      options.push({ label: t('Remove cover art'), desc: t('Deletes the image from the book folder. (To just hide it, use the ↻ on the book.)'), danger: true, value: 'uncover' });
    }
    // Pocket has no File menu: export lives here and in the ⋯ sheet
    if (window.Capacitor) options.push({ label: t('Export…'), desc: t('Text, Markdown, HTML, Word or EPUB, through the share sheet.'), value: 'export' });
    options.push(
      { label: t('Set word goal…'), desc: t('Adds the subtle progress bar to the cover.'), value: 'goal' },
      { label: t('Remove from bookshelf'), desc: t('Takes it off your shelves. The files stay safe in your NEO Library folder on disk.'), value: 'remove' },
      window.Capacitor
        ? { label: t('Delete book'), desc: t('Removes the book folder. The Files app keeps it in Recently Deleted for 30 days.'), danger: true, value: 'trash' }
        : {
          label: navigator.platform.toLowerCase().includes('win') ? t('Move to Recycle Bin') : t('Move to Trash'),
          desc: t('Sends the book folder to your system trash, where you can recover it.'),
          danger: true, value: 'trash'
        }
    );
    const choice = await optionModal(`“${meta.title}”`, null, options);
    if (choice === 'refresh') {
      await refreshCover(meta, el);
    } else if (choice === 'export') {
      const fmt = await optionModal(t('Export “{title}”', { title: meta.title }), null, [
        { label: t('Text (.txt)'), value: 'txt' }, { label: t('Markdown (.md)'), value: 'md' }, { label: t('HTML (.html)'), value: 'html' },
        { label: t('Word (.docx)'), value: 'docx' }, { label: t('EPUB (.epub)'), value: 'epub' }
      ]);
      if (!fmt) return;
      await openBook(meta.id);
      await doExport(fmt);
    } else if (choice === 'cover') {
      const src = await window.neo.pickCover();
      if (!src) return;
      const fname = await window.neo.setCover(meta.id, src);
      if (fname) {
        meta.coverImage = fname;
        meta.coverMode = 'image';
        await window.neo.writeBookMeta(meta.id, meta);
        renderShelves();
      }
    } else if (choice === 'uncover') {
      await window.neo.removeCover(meta.id);
      meta.coverImage = null;
      await window.neo.writeBookMeta(meta.id, meta);
      renderShelves();
    } else if (choice === 'goal') {
      const goal = await askInput(t('Word count goal for “{title}”', { title: meta.title }), t('e.g. 80000 — blank removes the goal'),
        meta.wordGoal ? String(meta.wordGoal) : '');
      if (goal === null) return;
      meta.wordGoal = parseInt(goal, 10) || 0;
      await window.neo.writeBookMeta(meta.id, meta);
      renderShelves();
    } else if (choice === 'remove') {
      for (const s of library.shelves) s.bookIds = s.bookIds.filter((b) => b !== meta.id);
      await window.neo.writeLibrary(library);
      renderShelves();
      toast(t('“{title}” removed from the shelves — its files are still in your NEO Library', { title: meta.title }));
    } else if (choice === 'trash') {
      const ok = await window.neo.deleteBook(meta.id, meta.title);
      if (ok) {
        for (const s of library.shelves) s.bookIds = s.bookIds.filter((b) => b !== meta.id);
        await window.neo.writeLibrary(library);
        renderShelves();
      }
    }
  });
  return el;
}

/* ---- painted covers ----
   At a thousand words a story has a shape, so NEO reads it and paints an
   abstract cover to sit under the type. The writer's own cover (coverImage)
   always wins; the abstract is the fallback; painting never blocks typing. */

const PAINT_AT = 1000;
const STALE_PAINT_MS = 10 * 60 * 1000; // a job that never came back

function paintable(meta) {
  if (!meta || meta.coverImage) return false; // the writer's own art is never painted over
  if ((meta.wordCount || 0) < PAINT_AT) return false;
  const art = meta.coverArt;
  if (!art) return true;
  if (art.status === 'pending') return Date.now() - Date.parse(art.at || 0) > STALE_PAINT_MS;
  return false; // done, shelved, or failed: the ↻ on the tile is the way back in
}

function bookPlainText() {
  return book.chapterOrder.map((id) => chapterText(id)).join('\n\n');
}

// Paint the open book, or a book on the shelf (text is read from disk then).
async function requestPaint(meta, text) {
  const provider = coverProvider();
  if (!(await window.neo.hasSecret(provider))) {
    if (!library.coverArtNudged) {
      library.coverArtNudged = true;
      await window.neo.writeLibrary(library);
      toast(t('This story just passed {n} words — add an API key under File → Cover Art… and NEO will paint it a cover.', { n: PAINT_AT }), 8000);
    }
    return;
  }
  meta.coverArt = { status: 'pending', at: new Date().toISOString(), words: meta.wordCount || 0 };
  if (book && book.id === meta.id) scheduleMetaSave();
  else await window.neo.writeBookMeta(meta.id, meta);
  markPainting(meta.id, true);
  if (text == null) {
    const m = await window.neo.readBookMeta(meta.id);
    const parts = [];
    for (const chId of (m && m.chapterOrder) || []) {
      const holder = document.createElement('div');
      holder.innerHTML = await window.neo.readChapter(meta.id, chId);
      holder.querySelectorAll('.darling-anchor, .ph-mark, .ghost').forEach((n) => n.remove());
      parts.push(holder.innerText);
    }
    text = parts.join('\n\n');
  }
  const cs = coverSettings();
  const mine = (cs.models && cs.models[provider]) || {};
  const endpoint = (cs.endpoints && cs.endpoints[provider]) || undefined;
  let res = null;
  try {
    res = await window.neo.paintCover(meta.id, text, { provider, textModel: mine.text, imageModel: mine.image, quality: cs.quality, base: endpoint });
  } catch (err) {
    window.neo.logError('paint request: ' + (err && err.stack || err));
    res = { error: String((err && err.message) || err) };
  }
  // the writer may have moved on — write to whichever copy of the meta is live
  const live = (book && book.id === meta.id) ? book : (await window.neo.readBookMeta(meta.id)) || meta;
  if (res && res.file) {
    live.coverArt = { status: 'done', file: res.file, brief: res.brief, words: meta.wordCount || 0, at: new Date().toISOString() };
    if (!live.coverImage) live.coverMode = 'painted';
    artCache.delete(meta.id + '/' + res.file);
  } else {
    live.coverArt = { status: 'failed', error: (res && res.error) || 'unknown', at: new Date().toISOString() };
    toast(t('NEO couldn’t paint that cover: {error}', { error: live.coverArt.error }), 7000);
  }
  if (live === book) scheduleMetaSave();
  else await window.neo.writeBookMeta(meta.id, live);
  markPainting(meta.id, false);
  if (!$('#bookshelf-view').hidden) renderShelves();
}

// shimmer on the tile while its painting is in flight
function markPainting(bookId, on) {
  for (const el of $$('.book')) {
    if (el.dataset.bookId !== bookId) continue;
    el.classList.toggle('cv-painting', on);
    const sh = el.querySelector('.b-painting');
    if (sh) sh.hidden = !on;
  }
}

// the ↻ on a tile: switch between the covers a book has, re-roll the
// abstract, or paint a fresh one from the text
async function refreshCover(meta, el) {
  const mode = coverMode(meta);
  const enough = (meta.wordCount || 0) >= PAINT_AT;
  const hasKey = await window.neo.hasSecret(coverProvider());
  const options = [];
  if (meta.coverImage && mode !== 'image') options.push({ label: t('Show your cover art'), desc: t('The image you gave this book.'), value: 'image' });
  if (hasPainting(meta) && mode !== 'painted') options.push({ label: t('Show NEO’s painting'), desc: t('The cover painted from the text.'), value: 'painted' });
  if (mode !== 'abstract') options.push({ label: t('Show the abstract'), desc: t('The seeded cover every book starts with.'), value: 'abstract' });
  options.push({ label: t('New type & colours'), desc: mode === 'abstract' ? t('A fresh abstract and a different title style.') : t('Re-sets the title in a different style over the same art.'), value: 'reroll' });
  if (hasKey) {
    options.push(enough
      ? { label: hasPainting(meta) ? t('Paint it again') : t('Paint a cover from the text'), desc: t('NEO reads the manuscript and paints a new cover. About a minute; a few cents.'), value: 'paint' }
      : { label: t('Paint a cover from the text'), desc: t('Once the story passes {n} words.', { n: PAINT_AT }), value: 'nope' });
  }
  // a plain abstract with nothing else to offer just re-rolls
  const choice = options.length === 1 ? 'reroll' : await optionModal(t('Cover for “{title}”', { title: escHtml(meta.title) }), null, options);
  if (!choice || choice === 'nope') return;
  const live = (book && book.id === meta.id) ? book : meta;
  if (choice === 'paint') {
    if (meta.coverArt && meta.coverArt.status === 'pending' && !paintable(meta)) { toast(t('Still painting…')); return; }
    live.coverMode = 'painted';
    requestPaint(live, book && book.id === meta.id ? bookPlainText() : null);
    return;
  }
  if (choice === 'reroll') {
    live.coverSeed = meta.id + ':' + (meta.wordCount || 0) + ':' + Date.now().toString(36);
    if (mode === 'image') live.coverMode = 'abstract';
  } else {
    live.coverMode = choice;
  }
  if (live === book) scheduleMetaSave(); else await window.neo.writeBookMeta(meta.id, live);
  dressTile(el, live);
}

async function createBookOnShelf(shelf) {
  const meta = await window.neo.createBook({ author: displayAuthor() });
  meta.tabNames = {
    notes: (library.tabDefaults && library.tabDefaults.notes) || 'Notes',
    outline: (library.tabDefaults && library.tabDefaults.outline) || 'Outline'
  };
  await window.neo.writeBookMeta(meta.id, meta);
  shelf.bookIds.push(meta.id);
  await window.neo.writeLibrary(library);
  openBook(meta.id);
}

// While dragging a book or shelf, nearing the window's top or bottom edge
// scrolls the bookshelf — faster the deeper into the edge zone you push.
let shelfScrollDir = 0;
let shelfScrollRAF = null;
function shelfAutoScrollStep() {
  if (!shelfScrollDir) { shelfScrollRAF = null; return; }
  $('#bookshelf-view').scrollTop += shelfScrollDir;
  shelfScrollRAF = requestAnimationFrame(shelfAutoScrollStep);
}
{
  const view = $('#bookshelf-view');
  const EDGE = 90;
  view.addEventListener('dragover', (e) => {
    const h = window.innerHeight;
    if (e.clientY < EDGE) shelfScrollDir = -Math.ceil((EDGE - e.clientY) / 5);
    else if (e.clientY > h - EDGE) shelfScrollDir = Math.ceil((e.clientY - (h - EDGE)) / 5);
    else shelfScrollDir = 0;
    if (shelfScrollDir && !shelfScrollRAF) shelfScrollRAF = requestAnimationFrame(shelfAutoScrollStep);
  });
  view.addEventListener('drop', () => { shelfScrollDir = 0; });
  view.addEventListener('dragend', () => { shelfScrollDir = 0; });
  view.addEventListener('dragleave', (e) => { if (!e.relatedTarget) shelfScrollDir = 0; });
}

$('#add-shelf-btn').onclick = async () => {
  library.shelves.push({
    id: 'shelf-' + Date.now().toString(36),
    name: t('New Shelf'),
    bookIds: [],
    authorId: currentAuthor().id
  });
  await window.neo.writeLibrary(library);
  await renderShelves();
  // the new shelf may be below the fold: bring it up, name ready to type over
  const shelves = $$('#shelves .shelf');
  const last = shelves[shelves.length - 1];
  if (last) {
    last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const label = last.querySelector('.shelf-label');
    if (label) setTimeout(() => {
      if (NO_HOVER) { label.click(); return; }
      label.focus();
      const r = document.createRange();
      r.selectNodeContents(label);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }, 350);
  }
};

// Drag a book up to your name: if you write under other names too, a little
// rack of shelves unfolds beneath it, one per pen name, and the book can be
// dropped onto one. It lands on that name's top shelf and takes the name.
// With a single author there is nothing to unfold, so nothing happens.
(() => {
  const chip = $('#author-chip');
  let rack = null;
  let hideTimer = null;
  const otherAuthors = () => (library.authors || []).filter((a) => a.id !== currentAuthor().id);
  const isBookDrag = (e) => e.dataTransfer && e.dataTransfer.types.includes('application/x-neo-book');

  function showRack() {
    if (rack) return;
    const others = otherAuthors();
    if (!others.length) return;
    rack = document.createElement('div');
    rack.id = 'pen-rack';
    for (const a of others) {
      const slot = document.createElement('div');
      slot.className = 'pen-slot';
      slot.textContent = a.name;
      slot.dataset.authorId = a.id;
      slot.addEventListener('dragover', (e) => {
        if (!isBookDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        slot.classList.add('over');
        clearTimeout(hideTimer);
      });
      slot.addEventListener('dragleave', () => slot.classList.remove('over'));
      slot.addEventListener('drop', async (e) => {
        if (!isBookDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const bookId = e.dataTransfer.getData('application/x-neo-book');
        hideRack();
        await moveBookToAuthor(bookId, a.id);
      });
      rack.appendChild(slot);
    }
    const r = chip.getBoundingClientRect();
    rack.style.top = (r.bottom + 8) + 'px';
    // the rack hangs from the name and reaches leftward, so the names on its
    // planks sit well clear of the cover riding under the cursor
    rack.style.right = Math.max(12, window.innerWidth - r.right) + 'px';
    document.body.appendChild(rack);
    requestAnimationFrame(() => rack.classList.add('open'));
  }
  function hideRack() {
    clearTimeout(hideTimer);
    if (rack) { rack.remove(); rack = null; }
  }
  const armHide = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hideRack, 400); };

  chip.addEventListener('dragenter', (e) => { if (isBookDrag(e)) { e.preventDefault(); showRack(); } });
  chip.addEventListener('dragover', (e) => { if (isBookDrag(e)) { e.preventDefault(); clearTimeout(hideTimer); } });
  chip.addEventListener('dragleave', armHide);
  document.addEventListener('dragover', (e) => {
    // leaving both the chip and the rack lets the rack fold away
    if (rack && !rack.contains(e.target) && e.target !== chip) armHide();
  });
  document.addEventListener('dragend', hideRack);
  document.addEventListener('drop', hideRack);
})();

// Esc mid-drag cancels the drag itself (the browser does that). Esc or ⌘Z
// in the seconds after a drop puts the book back where it came from.
let lastShelfMove = null;
async function moveBookToAuthor(bookId, authorId) {
  const target = (library.authors || []).find((a) => a.id === authorId);
  const shelf = target && shelvesFor(target.id)[0];
  if (!shelf) return;
  const meta = await window.neo.readBookMeta(bookId);
  if (!meta) return;
  const from = library.shelves.find((s) => s.bookIds.includes(bookId));
  lastShelfMove = {
    bookId, title: meta.title, author: meta.author,
    shelfId: from ? from.id : null, index: from ? from.bookIds.indexOf(bookId) : 0,
    authorId: currentAuthor().id, at: Date.now()
  };
  for (const s of library.shelves) s.bookIds = s.bookIds.filter((b) => b !== bookId);
  shelf.bookIds.unshift(bookId); // the top shelf, first in line
  meta.author = target.name;
  await window.neo.writeBookMeta(bookId, meta);
  await window.neo.writeLibrary(library);
  renderShelves();
  toast(t('“{title}” now sits on {name}’s top shelf — Esc puts it back', { title: meta.title, name: target.name }), 6000);
}
async function undoShelfMove() {
  const m = lastShelfMove;
  if (!m || Date.now() - m.at > 15000) return false;
  lastShelfMove = null;
  const home = library.shelves.find((s) => s.id === m.shelfId) || shelvesFor(m.authorId)[0] || library.shelves[0];
  for (const s of library.shelves) s.bookIds = s.bookIds.filter((b) => b !== m.bookId);
  home.bookIds.splice(Math.min(m.index, home.bookIds.length), 0, m.bookId);
  const meta = await window.neo.readBookMeta(m.bookId);
  if (meta) { meta.author = m.author; await window.neo.writeBookMeta(m.bookId, meta); }
  await window.neo.writeLibrary(library);
  renderShelves();
  toast(t('“{title}” is back where it was', { title: m.title }));
  return true;
}
document.addEventListener('keydown', (e) => {
  if (!$('#editor-view').hidden || !lastShelfMove) return;
  const undoKey = e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z');
  if (!undoKey) return;
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  e.preventDefault();
  e.stopPropagation();
  undoShelfMove();
}, true);

// File → Reshelve a Book…: a book taken off the shelves is still on disk;
// this puts it back, on the current name's first shelf
async function reshelveBook() {
  const all = await window.neo.listBooks();
  const shelved = new Set(library.shelves.flatMap((s) => s.bookIds));
  const loose = all.filter((b) => !shelved.has(b.id)).sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));
  if (!loose.length) { toast(t('Every book in your library is already on a shelf')); return; }
  const pick = await optionModal(t('Books in your library that aren’t on a shelf'), null,
    loose.map((b) => ({ label: b.title, desc: b.author ? t('by {author}', { author: b.author }) : '', value: b.id })));
  if (!pick) return;
  const shelf = shelvesFor(currentAuthor().id)[0] || library.shelves[0];
  shelf.bookIds.push(pick);
  await window.neo.writeLibrary(library);
  renderShelves();
  toast(t('“{title}” is back on the shelf', { title: loose.find((b) => b.id === pick).title }));
}

$('#author-chip').onclick = async () => {
  const cur = currentAuthor();
  const opts = [];
  for (const a of library.authors) {
    if (a.id !== cur.id) {
      opts.push({ label: t('Write as {name}', { name: a.name }), desc: t('Switch to this name’s shelves'), value: 'sw:' + a.id });
    }
  }
  opts.push({ label: t('Rename {name}', { name: cur.name }), value: 'rename' });
  opts.push({ label: t('Add a pen name…'), desc: t('A separate set of shelves under another name'), value: 'add' });
  if (library.authors.length > 1) {
    opts.push({
      label: t('Remove {name}', { name: cur.name }),
      desc: t('These shelves and books move to your other name. Nothing is deleted from disk.'),
      danger: true, value: 'del'
    });
  }
  const pick = await optionModal(t('Writing as {name}', { name: cur.name }), null, opts);
  if (!pick) return;
  if (pick.startsWith('sw:')) {
    library.currentAuthorId = pick.slice(3);
  } else if (pick === 'rename') {
    const name = await askInput(t('Author name'), t('Shown on your title pages'), cur.name);
    if (name === null) return;
    cur.name = name || cur.name;
    library.authorName = library.authors[0].name; // legacy field follows the first name
  } else if (pick === 'add') {
    const name = await askInput(t('New pen name'), t('Shown on that name’s title pages'), '');
    if (!name) return;
    const a = { id: 'a-' + Date.now().toString(36), name };
    library.authors.push(a);
    library.currentAuthorId = a.id;
    library.shelves.push({
      id: 'shelf-' + Date.now().toString(36),
      name: t('Works in Progress'), bookIds: [], authorId: a.id
    });
  } else if (pick === 'del') {
    const homeId = library.authors[0].id;
    const rest = library.authors.filter((a) => a.id !== cur.id);
    const target = rest[0];
    for (const s of library.shelves) {
      if ((s.authorId || homeId) === cur.id) s.authorId = target.id;
    }
    library.authors = rest;
    library.currentAuthorId = target.id;
    library.authorName = library.authors[0].name;
  }
  await window.neo.writeLibrary(library);
  renderShelves();
};

/* ================================================================== */
/*  EDITOR — open / render                                             */
/* ================================================================== */

async function openBook(bookId) {
  tabPlaces = {}; // a fresh book starts with fresh places
  book = await window.neo.readBookMeta(bookId);
  if (!book) return;
  currentChapterId = null; // never carry a chapter reference across books
  undoStack = [];
  chapterHTML = {};
  savedHTML = {};
  diskStamps = {};
  for (const chId of book.chapterOrder) {
    chapterHTML[chId] = await window.neo.readChapter(bookId, chId);
    savedHTML[chId] = chapterHTML[chId];
  }
  savedMetaSig = metaSig(book); // what disk holds; NEO's own defaults don't count as edits
  stickies = await window.neo.readJSON(bookId, 'stickies', []);
  darlings = await window.neo.readJSON(bookId, 'darlings', []);

  $('#bookshelf-view').hidden = true;
  $('#editor-view').hidden = false;
  document.execCommand('defaultParagraphSeparator', false, 'p');

  $('#tp-title').textContent = isUntitled(book.title) ? '' : book.title;
  $('#tp-subtitle').textContent = book.subtitle || '';
  $('#tp-author').textContent = book.author || t('Anonymous');
  $$('.tab[data-tab="notes"]')[0].textContent = tabName('notes');
  $$('.tab[data-tab="outline"]')[0].textContent = tabName('outline');

  renderChapters();
  renderStickies();
  migrateDarlingAnchors(); // sweep legacy invisible markers out of the prose
  reconcileMarks();        // re-adopt any note marks orphaned by cut/paste
  updateCounters();

  // Plotters land in the outline for a brand-new book
  const isNew = book.chapterOrder.length === 0;
  if (isNew && library.writingStyle === 'plotter') {
    switchTab('outline');
  } else {
    switchTab('manuscript');
    if (isNew) {
      $('#tp-title').focus();
    } else if (book.lastPosition && book.chapterOrder.includes(book.lastPosition.chapterId)) {
      // pick up right where you left off
      currentChapterId = book.lastPosition.chapterId;
      const scroll = book.lastPosition.scroll || 0;
      requestAnimationFrame(() => {
        $('#paper-scroll').scrollTop = scroll;
        highlightNav();
        updateCounters();
      });
    }
  }

  // the Enter hint shows once per library, ever
  if (!library.hintShown) {
    library.hintShown = true;
    window.neo.writeLibrary(library);
    setTimeout(() => toast(t('Enter twice = section break · three times = new chapter · {key} shows everything else', { key: KHELP }), 7000), 800);
  }
}

function renderChapters() {
  const wrap = $('#chapters');
  wrap.innerHTML = '';
  wordCache = {};
  book.chapterTitles = book.chapterTitles || {};
  // a lone chapter is just "the story" — no heading until a second one exists,
  // at which point both appear, numbered in retrospect
  const solo = book.chapterOrder.length === 1;
  book.chapterOrder.forEach((chId, i) => {
    const sec = document.createElement('section');
    sec.className = 'chapter sheet' + (solo ? ' solo' : '');
    sec.dataset.id = chId;
    const head = document.createElement('div');
    head.className = 'chapter-head';
    head.title = t('Right-click for chapter options · click after the number to add a title');
    const num = document.createElement('span');
    num.className = 'ch-num';
    num.textContent = t('Chapter {n}', { n: i + 1 });
    const sep = document.createElement('span');
    sep.className = 'ch-sep';
    sep.textContent = '—';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'ch-title';
    titleSpan.contentEditable = 'true';
    titleSpan.spellcheck = false;
    titleSpan.textContent = book.chapterTitles[chId] || '';
    if (titleSpan.textContent) head.classList.add('has-title');
    titleSpan.addEventListener('input', () => {
      head.classList.toggle('has-title', titleSpan.textContent.trim() !== '');
    });
    titleSpan.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        titleSpan.blur();
        poetryUnderHeading(sec.querySelector('.chapter-body'), chId);
      } else if (e.key === 'Enter') { e.preventDefault(); titleSpan.blur(); }
      e.stopPropagation();
    });
    titleSpan.addEventListener('blur', () => {
      book.chapterTitles[chId] = titleSpan.textContent.trim();
      scheduleMetaSave();
      renderNav();
    });
    head.appendChild(num);
    head.appendChild(sep);
    head.appendChild(titleSpan);
    head.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      chapterMenu(chId, i);
    });
    const body = document.createElement('div');
    body.className = 'chapter-body';
    body.contentEditable = 'true';
    body.spellcheck = false; // NEO runs its own spellcheck pass
    body.innerHTML = chapterHTML[chId] || '<p><br></p>';
    // older marks used a "?" that read as a broken image — normalize to the flag
    body.querySelectorAll('.ph-mark').forEach((m) => { m.textContent = '⚑'; });
    // heal the engine's style-junk spans left by past merges and splits
    stripJunkSpans(body);
    // heal prose that got merged into a scene-break's styled paragraph:
    // real breaks contain only ***, anything else is a stained paragraph
    body.querySelectorAll('p.scene-break').forEach((p) => {
      if (p.textContent.trim() !== '***') {
        p.classList.remove('scene-break');
        p.removeAttribute('style');
      }
    });
    // heal no-break spaces planted in prose by the old engine repair pass
    const tw = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let tn;
    while ((tn = tw.nextNode())) {
      if (tn.data.includes('\u00a0')) tn.data = tn.data.replace(/\u00a0/g, ' ');
    }
    wireChapterBody(body, chId);
    sec.appendChild(head);
    sec.appendChild(body);
    wrap.appendChild(sec);
  });
  renderNav();
}

async function deleteChapterToDarlings(chId) {
  snapshotStructure('chapter delete');
  const index = book.chapterOrder.indexOf(chId);
  const text = chapterText(chId).trim();
  if (text) {
    const bodyEl = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
    darlings.push({
      id: 'd-' + Date.now().toString(36),
      html: bodyEl ? bodyEl.innerHTML : chapterHTML[chId],
      text: text.slice(0, 2000),
      chapterId: null,
      chapterLabel: t('deleted Chapter {n}', { n: index + 1 }),
      date: new Date().toISOString()
    });
    await window.neo.writeJSON(book.id, 'darlings', darlings);
  }
  if (currentChapterId === chId) currentChapterId = null;
  await deleteChapterQuiet(chId);
  if (text) toast(t('Chapter removed — its words are in Darlings, or {key} to undo', { key: KZ }));
}

async function chapterMenu(chId, index) {
  const words = countWords(chapterText(chId));
  const choice = await optionModal(
    t('Chapter {n}', { n: index + 1 }),
    words ? t('{n} words.', { n: words }) : t('This chapter is empty.'),
    [{ label: t('Delete chapter'), desc: words ? t('Its words move to Darlings, recoverable anytime.') : t('Nothing to save — it just goes.'), danger: true, value: 'delete' }]
  );
  if (choice === 'delete') await deleteChapterToDarlings(chId);
}

/* ================================================================== */
/*  EDITOR — typing                                                    */
/* ================================================================== */

function wireChapterBody(body, chId) {
  body.addEventListener('focus', () => { currentChapterId = chId; updateCounters(); highlightNav(); });

  body.addEventListener('input', () => {
    breakRun = 0; // fresh typing: ⌘Z belongs to the engine again
    chapterHTML[chId] = captureBody(body);
    wordCache[chId] = null;
    scheduleChapterSave(chId);
    if (spellOn) scheduleSpellRescan(chId, body);
    updateCounters();
    scheduleNavRefresh();
  });
  // paste without formatting
  body.addEventListener('paste', (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (html) {
      document.execCommand('insertHTML', false, cleanPasteHtml(html));
      reconcileMarks();
    } else if (text) {
      const parts = text.replace(/\r/g, '').split(/\n+/).filter((p) => p.trim());
      parts.forEach((p, i) => {
        if (i > 0) document.execCommand('insertParagraph');
        document.execCommand('insertText', false, p.trim());
      });
    }
  });
  // While macOS composes input, shortcuts stand down completely.
  let composing = false;
  body.addEventListener('compositionstart', () => { composing = true; });
  body.addEventListener('compositionend', () => { composing = false; });
  body.addEventListener('keydown', (e) => {
    if (composing || e.isComposing || e.keyCode === 229) return;
    // count consecutive Enters — the double/triple rhythm works mid-sentence
    if (e.key === 'Enter' && !e.shiftKey) enterRun++;
    else enterRun = 0;
    // ⌘Z right after a break operation undoes the break via the structural
    // stack — the engine's own undo never saw it and would corrupt the page
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === 'KeyZ' && breakRun > 0 && undoStack.length) {
      e.preventDefault();
      breakRun--;
      structuralUndo();
      return;
    }
    // Chromium's selection-delete can duplicate a neighboring character when
    // the selection spans fragmented text nodes. Merging the fragments right
    // before any destructive keystroke.
    if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      const s = window.getSelection();
      const destructive = e.key === 'Backspace' || e.key === 'Delete' ||
        (s && !s.isCollapsed && (e.key.length === 1 || e.key === 'Enter'));
      if (destructive) healSelectionSeams(body);
    }
    if (styleKeepScroll(e)) return;
    if (handlePoetry(e, body, chId)) return;
    if (poetryBackspace(e, body, chId)) return;
    if (sceneBreakDelete(e, body, chId)) return;
    if (spaceSafeDelete(e, body, chId)) return;
    if (emptyChapterBackspace(e, body, chId)) return;
    if (chapterStartBackspace(e, body, chId)) return;
    if (guardMarkerDelete(e, body, chId)) return;
    if (handleEnter(e, body, chId)) return;
    if (handleTabSpacing(e)) return;
    smartKeys(e, body);
  });
  // when the whole chapter loses focus, merge every fragmented text node
  body.addEventListener('blur', () => {
    try { body.normalize(); } catch { /* nothing to merge */ }
  });
  body.addEventListener('mousedown', () => { enterRun = 0; });
  body.addEventListener('click', (e) => {
    const mark = e.target.closest('.ph-mark');
    if (mark) focusSticky(mark.dataset.sid);
    // clicking a ghost outline note selects it, ready to be replaced with prose
    const ghost = e.target.closest('p.ghost');
    if (ghost) {
      const r = document.createRange();
      r.selectNodeContents(ghost);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
  });
  // the moment writing hits a ghost, it becomes prose
  // (it keeps its data-sec-id so the outline knows it's been written)
  body.addEventListener('beforeinput', () => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    let el = sel.anchorNode;
    if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
    const ghost = el && el.closest ? el.closest('p.ghost') : null;
    if (ghost && body.contains(ghost)) {
      ghost.classList.remove('ghost');
    }
  });
}

function focusChapterStart(chId) {
  const nb = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  if (!nb) return;
  nb.focus({ preventScroll: true });
  const nr = document.createRange();
  const first = nb.querySelector('p');
  if (first) nr.setStart(first, 0); // inside the first paragraph, not the container
  else nr.selectNodeContents(nb);
  nr.collapse(true);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(nr);
  currentChapterId = chId;
  highlightNav();
}

// Backspace in an empty chapter deletes it:
function emptyChapterBackspace(e, body, chId) {
  if (e.key !== 'Backspace' || e.metaKey || e.ctrlKey || e.altKey) return false;
  if (body.innerText.trim() !== '') return false; // ghosts count as content
  const idx = book.chapterOrder.indexOf(chId);
  if (idx < 0 || book.chapterOrder.length < 2) return false;
  e.preventDefault();
  snapshotStructure('empty chapter removed');
  breakRun++;
  if (idx > 0) {
    const prev = book.chapterOrder[idx - 1];
    deleteChapterQuiet(chId).then(() => { focusChapter(prev); resetNativeUndo(); });
  } else {
    // an empty chapter 1 dissolves too — the caret lands at the top of
    // what just became the new chapter 1
    const next = book.chapterOrder[1];
    deleteChapterQuiet(chId).then(() => { focusChapterStart(next); resetNativeUndo(); });
  }
  return true;
}

// ⌘B / ⌘I applied by hand: the engine's native handling scrolls the
// selection "into view" and mis-measures NEO's transformed page column,
// throwing the reader to the top of the screen. Style, don't scroll.
function styleKeepScroll(e) {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return false;
  if (e.code !== 'KeyB' && e.code !== 'KeyI') return false;
  e.preventDefault();
  const sc = $('#paper-scroll');
  const keep = sc.scrollTop;
  document.execCommand(e.code === 'KeyB' ? 'bold' : 'italic');
  sc.scrollTop = keep;
  requestAnimationFrame(() => { sc.scrollTop = keep; });
  return true;
}

// Backspace at the very start of a chapter swallows an empty chapter above it
function chapterStartBackspace(e, body, chId) {
  if (e.key !== 'Backspace' || e.metaKey || e.ctrlKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(body);
  try { pre.setEnd(r.startContainer, r.startOffset); } catch { return false; }
  if (pre.toString().length !== 0) return false; // caret isn't at the chapter's first character
  const idx = book.chapterOrder.indexOf(chId);
  if (idx <= 0) return false;
  const prevId = book.chapterOrder[idx - 1];
  const prevBody = document.querySelector(`.chapter[data-id="${prevId}"] .chapter-body`);
  if (!prevBody) return false;
  e.preventDefault();
  if (prevBody.innerText.trim() === '') {
    // empty chapter above: swallow it
    snapshotStructure('empty chapter removed');
    breakRun++;
    deleteChapterQuiet(prevId).then(() => { focusChapterStart(chId); resetNativeUndo(); });
    return true;
  }
  // chapter with words above: merge this chapter up into it — the inverse
  // of a triple-Enter split, and ⌘Z restores the split
  snapshotStructure('chapters merged');
  const prevCount = prevBody.querySelectorAll('p').length;
  const keepScroll = $('#paper-scroll').scrollTop;
  chapterHTML[prevId] = captureBody(prevBody) + captureBody(body);
  persistChapter(prevId);
  for (const s of stickies) if (s.chapterId === chId) s.chapterId = prevId;
  window.neo.writeJSON(book.id, 'stickies', stickies);
  for (const d of darlings) if (d.chapterId === chId) d.chapterId = prevId;
  window.neo.writeJSON(book.id, 'darlings', darlings);
  if (book.sectionNotes && book.sectionNotes[chId]) {
    book.sectionNotes[prevId] = [...(book.sectionNotes[prevId] || []), ...book.sectionNotes[chId]];
    delete book.sectionNotes[chId];
  }
  if (book.chapterTitles) delete book.chapterTitles[chId];
  if (book.chapterNotes) delete book.chapterNotes[chId];
  book.chapterOrder = book.chapterOrder.filter((c) => c !== chId);
  delete chapterHTML[chId];
  window.neo.deleteChapter(book.id, chId);
  saveMeta();
  renderChapters();
  renderStickies();
  restoreCaret({ chId: prevId, pIdx: prevCount, off: 0, scroll: keepScroll });
  resetNativeUndo();
  breakRun++;
  return true;
}

// Tab for spacing:
function handleTabSpacing(e) {
  if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return false;
  e.preventDefault();
  if (!e.shiftKey) {
    document.execCommand('insertText', false, '  ');
    return true;
  }
  // Shift+Tab: remove up to two preceding em spaces
  const sel = window.getSelection();
  if (sel.rangeCount && sel.isCollapsed) {
    const r = sel.getRangeAt(0);
    const node = r.startContainer;
    if (node.nodeType === Node.TEXT_NODE) {
      let n = 0;
      while (n < 2 && r.startOffset - n > 0 &&
             node.textContent[r.startOffset - n - 1] === ' ') n++;
      if (n > 0) {
        const del = document.createRange();
        del.setStart(node, r.startOffset - n);
        del.setEnd(node, r.startOffset);
        del.deleteContents();
      }
    }
  }
  return true;
}

function flatOffset(p, container, offset) {
  // flatten any (container, offset) pair to a character offset in p.textContent
  let n;
  if (container.nodeType !== Node.TEXT_NODE) {
    if (!p.contains(container) && container !== p) return -99;
    let acc = 0;
    for (let i = 0; i < offset && i < container.childNodes.length; i++) {
      acc += container.childNodes[i].textContent.length;
    }
    let before = 0;
    const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    while ((n = w.nextNode())) {
      if (container === p || container.contains(n)) break;
      before += n.textContent.length;
    }
    return (container === p ? 0 : before) + acc;
  }
  let pos = 0;
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  while ((n = walker.nextNode())) {
    if (n === container) return pos + offset;
    pos += n.textContent.length;
  }
  return -1;
}

function flatPoint(p, off) {
  const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  let pos = 0, n;
  while ((n = w.nextNode())) {
    const len = n.textContent.length;
    if (off <= pos + len) return [n, off - pos];
    pos += len;
  }
  return null;
}

// A delete that leaves two plain spaces touching triggers the engine's broken
// whitespace repair, which duplicates a neighboring character. When that exact
// hazard is about to happen, take the right-hand space along with the deletion,
// leaving one clean space. All other deletes stay native.
function spaceSafeDelete(e, body, chId) {
  if (e.key !== 'Backspace' && e.key !== 'Delete') return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const r = sel.getRangeAt(0);
  const elOf = (n) => (n.nodeType === Node.TEXT_NODE ? n.parentElement : n);
  const pA = elOf(r.startContainer)?.closest?.('p');
  const pB = elOf(r.endContainer)?.closest?.('p');
  if (!pA || pA !== pB || !body.contains(pA)) return false;
  const t = pA.textContent;
  let from, to;
  if (sel.isCollapsed) {
    const at = flatOffset(pA, r.startContainer, r.startOffset);
    if (at < 0) return false;
    if (e.key === 'Backspace') { from = at - 1; to = at; } else { from = at; to = at + 1; }
    if (from < 0 || to > t.length) return false;
  } else {
    from = flatOffset(pA, r.startContainer, r.startOffset);
    to = flatOffset(pA, r.endContainer, r.endOffset);
    if (from < 0 || to <= from) return false;
  }
  if (t[from - 1] !== ' ' || t[to] !== ' ') return false;
  let end = to;
  while (t[end] === ' ') end++;
  const a = flatPoint(pA, from), b = flatPoint(pA, end);
  if (!a || !b) return false;
  e.preventDefault();
  const nr = document.createRange();
  nr.setStart(a[0], a[1]); nr.setEnd(b[0], b[1]);
  sel.removeAllRanges(); sel.addRange(nr);
  document.execCommand('insertText', false, '');
  return true;
}

// Merge fragmented text nodes in the paragraph(s) the selection touches,
// so native editing operates on whole text instead of seams.
function healSelectionSeams(body) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  const paraOf = (n) => {
    if (n && n.nodeType === Node.TEXT_NODE) n = n.parentElement;
    return n && n.closest ? n.closest('p') : null;
  };
  const a = paraOf(r.startContainer);
  const b = paraOf(r.endContainer);
  try { if (a && body.contains(a)) a.normalize(); } catch { /* fine */ }
  try { if (b && b !== a && body.contains(b)) b.normalize(); } catch { /* fine */ }
}

// Chromium mangles Backspace/Delete beside non-editable inline elements:
function guardMarkerDelete(e, body, chId) {
  if (e.key !== 'Backspace' && e.key !== 'Delete') return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  const node = r.startContainer;
  const back = e.key === 'Backspace';
  const isMark = (n) => n && n.nodeType === Node.ELEMENT_NODE &&
    (n.classList.contains('ph-mark') || n.classList.contains('darling-anchor'));

  // Case 1: the deletion would cross INTO a marker (caret at a node boundary,
  // marker on the far side) — delete the marker itself, cleanly.
  let adjacent = null;
  if (node.nodeType === Node.TEXT_NODE) {
    if (back && r.startOffset === 0) adjacent = node.previousSibling;
    else if (!back && r.startOffset === node.textContent.length) adjacent = node.nextSibling;
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    adjacent = back ? node.childNodes[r.startOffset - 1] : node.childNodes[r.startOffset];
  }
  if (isMark(adjacent)) {
    e.preventDefault();
    if (adjacent.classList.contains('ph-mark') && adjacent.dataset.sid) {
      resolveSticky(adjacent.dataset.sid); // removes mark + its note, syncs
    } else {
      adjacent.remove();
      syncChapter(body, chId);
    }
    return true;
  }

  // Case 2: deleting a character inside a text node that TOUCHES a marker:
  if (node.nodeType !== Node.TEXT_NODE) return false;
  if (back ? r.startOffset === 0 : r.startOffset >= node.textContent.length) return false;
  if (!isMark(node.previousSibling) && !isMark(node.nextSibling)) return false;

  e.preventDefault();
  const targetOffset = back ? r.startOffset - 1 : r.startOffset;
  const del = document.createRange();
  del.setStart(node, targetOffset);
  del.setEnd(node, targetOffset + 1);
  del.deleteContents();
  const caret = document.createRange();
  caret.setStart(node, targetOffset);
  caret.collapse(true);
  sel.removeAllRanges();
  sel.addRange(caret);
  syncChapter(body, chId);
  return true;
}

// The engine wraps text in style-carrying spans during merges and splits
// ("<span style='text-indent...'>"). They corrupt later edits — unwrap them,
// keeping only NEO's own marks.
function stripJunkSpans(el) {
  for (const s of [...el.querySelectorAll('span:not(.ph-mark)')]) {
    while (s.firstChild) s.before(s.firstChild);
    s.remove();
  }
}

// Enter once: new paragraph. Enter twice: *** section break — wherever the
// caret is, even mid-sentence. Enter three times: the chapter splits here.
let enterRun = 0;
// break operations live outside the engine's undo history; while the most
// recent edits are breaks, ⌘Z routes to NEO's structural undo, one per press
let breakRun = 0;

function splitChapterAt(body, chId, block, sel) {
  const parts = [];
  let n = block;
  while (n) {
    const next = n.nextElementSibling;
    parts.push(n.outerHTML);
    n.remove();
    n = next;
  }
  if (!body.querySelector('p')) body.innerHTML = '<p><br></p>';
  syncChapter(body, chId);
  const idx = book.chapterOrder.indexOf(chId);
  const newId = createChapterAt(idx + 1);
  chapterHTML[newId] = parts.join('') || '<p><br></p>';
  persistChapter(newId);
  renderChapters();
  focusChapterStart(newId);
  resetNativeUndo();
  document.querySelector(`.chapter[data-id="${newId}"] p`).scrollIntoView({ block: 'start' });
  breakRun++;
}

function handleEnter(e, body, chId) {
  if (e.key !== 'Enter' || e.shiftKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  let el = sel.anchorNode;
  if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const block = el && el.closest ? el.closest('p') : null;
  if (!block || !body.contains(block)) return false;
  if (block.classList.contains('scene-break')) { e.preventDefault(); return true; } // Enter on a *** line: nothing
  // Enter in a poetry paragraph steps back into prose: an empty line becomes
  // an ordinary paragraph in place; otherwise the line splits and the new
  // paragraph is plain (⇧Enter is how the poem continues)
  if (block.classList.contains('poetry')) {
    e.preventDefault();
    enterRun = 0;
    if (block.textContent.trim() === '') {
      snapshotStructure('poetry paragraph to prose');
      block.classList.remove('poetry');
      romanize(block);
      placeCaret(block, 0);
      syncChapter(body, chId);
      resetNativeUndo();
      breakRun++;
      return true;
    }
    document.execCommand('insertParagraph');
    const cur = caretBlock(body);
    if (cur && cur !== block) {
      cur.classList.remove('poetry');
      romanize(cur);
      placeCaret(cur, 0);
    }
    syncChapter(body, chId);
    return true;
  }
  const prev = block.previousElementSibling;

  if (block.textContent.trim() !== '') {
    // caret inside a real paragraph — where is it?
    const r = sel.getRangeAt(0);
    const pre = document.createRange();
    pre.selectNodeContents(block);
    try { pre.setEnd(r.startContainer, r.startOffset); } catch { return false; }
    const atStart = pre.toString().length === 0;

    // second/third Enter mid-flow: the caret sits at the start of the text
    // that the previous press pushed down
    if (atStart && enterRun >= 2 && prev) {
      if (prev.classList.contains('scene-break')) {
        // third Enter: everything from here becomes the next chapter
        e.preventDefault();
        snapshotStructure('chapter split');
        prev.remove();
        splitChapterAt(body, chId, block, sel);
        return true;
      }
      e.preventDefault();
      // a break made by the full double-Enter gesture un-splits on undo too
      snapshotStructure('section break', { rejoin: enterRun >= 2 });
      if (prev.textContent.trim() === '') {
        prev.classList.add('scene-break');
        prev.textContent = '***';
      } else {
        const brk = document.createElement('p');
        brk.className = 'scene-break';
        brk.textContent = '***';
        block.before(brk);
      }
      const keep = document.createRange();
      keep.setStart(block, 0);
      keep.collapse(true);
      sel.removeAllRanges();
      sel.addRange(keep);
      syncChapter(body, chId);
      resetNativeUndo();
      breakRun++;
      return true;
    }

    // normal Enter — native split so ⌘Z keeps working; junk spans (which
    // make the engine clone whole paragraphs) are stripped first if present
    e.preventDefault();
    if (block.querySelector('span:not(.ph-mark)')) {
      // Unwrapping moves text nodes, so preserve the caret's text position.
      const caret = captureCaret();
      stripJunkSpans(block);
      restoreCaret(caret);
    }
    document.execCommand('insertParagraph');
    syncChapter(body, chId);
    return true;
  }

  // Third Enter at end of flow: empty paragraph under a *** — chapter splits here
  if (prev && prev.classList.contains('scene-break')) {
    e.preventDefault();
    snapshotStructure('chapter split');
    prev.remove();
    splitChapterAt(body, chId, block, sel);
    return true;
  }

  // Second Enter at end of flow: the empty paragraph becomes a *** break
  if (prev) {
    e.preventDefault();
    snapshotStructure('section break', { rejoin: enterRun >= 2 });
    block.classList.add('scene-break');
    block.textContent = '***';
    const np = document.createElement('p');
    np.innerHTML = '<br>';
    block.after(np);
    const range = document.createRange();
    range.setStart(np, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    syncChapter(body, chId);
    resetNativeUndo();
    breakRun++;
    return true;
  }
  return false;
}

/* ================================================================== */
/*  POETRY PARAGRAPHS — ⇧Enter                                         */
/*  A paragraph pulled in from the margins, italic: a stanza of verse,  */
/*  a quote, a POV name under the chapter heading. One class, one key.  */
/* ================================================================== */

// the paragraph holding the caret, if it belongs to this chapter body
function caretBlock(body) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let el = sel.anchorNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const block = el && el.closest ? el.closest('p') : null;
  return block && body.contains(block) ? block : null;
}

// A poetry paragraph is born italic — real <i> markup, so ⌘I can take it
// off a word — and sheds that default italic when it returns to prose.
function italicize(p) {
  if (p.textContent.trim() === '') { p.innerHTML = '<i><br></i>'; return; }
  const kids = [...p.childNodes].filter((n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent.trim()));
  if (kids.length === 1 && kids[0].nodeType === Node.ELEMENT_NODE && kids[0].tagName === 'I') return;
  const i = document.createElement('i');
  while (p.firstChild) i.appendChild(p.firstChild);
  p.appendChild(i);
}
function romanize(p) {
  const kids = [...p.childNodes].filter((n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent.trim()));
  if (kids.length !== 1 || kids[0].nodeType !== Node.ELEMENT_NODE || kids[0].tagName !== 'I') return;
  const i = kids[0];
  while (i.firstChild) i.before(i.firstChild);
  i.remove();
  if (p.textContent.trim() === '' && !p.querySelector('br')) p.innerHTML = '<br>';
}
// caret at the start of a paragraph's text — inside its italic when it has one
function caretIntoStart(p) {
  const i = p.firstElementChild && p.firstElementChild.tagName === 'I' ? p.firstElementChild : p;
  placeCaret(i, 0);
}

function placeCaret(node, offset) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

// ⇧Enter. At the end of a paragraph: a new poetry paragraph beneath it.
// Mid-paragraph: the text after the caret becomes one. Inside a poetry
// paragraph: another line of it, so verse flows. On a *** line: nothing.
function handlePoetry(e, body, chId) {
  if (e.key !== 'Enter' || !e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const block = caretBlock(body);
  if (!block) return false;
  e.preventDefault();
  if (block.classList.contains('scene-break')) return true;

  if (block.classList.contains('poetry')) {
    // the engine's own split keeps the class on the new line, and ⌘Z sees it
    if (block.querySelector('span:not(.ph-mark)')) stripJunkSpans(block);
    document.execCommand('insertParagraph');
    const cur = caretBlock(body);
    if (cur) {
      cur.classList.add('poetry');
      if (cur.textContent.trim() === '' && !cur.querySelector('i')) { italicize(cur); caretIntoStart(cur); }
    }
    syncChapter(body, chId);
    return true;
  }

  snapshotStructure('poetry paragraph');
  const r = sel.getRangeAt(0);
  const tail = document.createRange();
  tail.selectNodeContents(block);
  try { tail.setStart(r.startContainer, r.startOffset); } catch { return true; }
  const after = tail.toString();
  const empty = block.textContent.trim() === '';
  const atStart = after.length === block.textContent.length;
  if (empty || atStart) {
    // an empty paragraph, or the caret at its very start: the whole paragraph turns to poetry
    block.classList.add('poetry');
    italicize(block);
    caretIntoStart(block);
  } else {
    const line = document.createElement('p');
    line.className = 'poetry';
    if (after.trim() !== '') {
      line.appendChild(tail.extractContents());
      for (const junk of line.querySelectorAll('br')) junk.remove();
      if (!block.textContent.trim()) block.innerHTML = '<br>';
    }
    italicize(line);
    block.after(line);
    caretIntoStart(line);
  }
  syncChapter(body, chId);
  resetNativeUndo();
  breakRun++;
  return true;
}

// Backspace at the very start of a poetry paragraph makes it prose again —
// the second Backspace then merges it upward like any paragraph
function poetryBackspace(e, body, chId) {
  if (e.key !== 'Backspace' || e.metaKey || e.ctrlKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const block = caretBlock(body);
  if (!block || !block.classList.contains('poetry')) return false;
  const r = sel.getRangeAt(0);
  const head = document.createRange();
  head.selectNodeContents(block);
  try { head.setEnd(r.startContainer, r.startOffset); } catch { return false; }
  if (head.toString().length !== 0) return false;
  e.preventDefault();
  snapshotStructure('poetry paragraph to prose');
  block.classList.remove('poetry');
  romanize(block);
  placeCaret(block, 0);
  syncChapter(body, chId);
  resetNativeUndo();
  breakRun++;
  return true;
}

// Format → Poetry Paragraph: toggles every paragraph the selection touches
function togglePoetry() {
  const sel = window.getSelection();
  if (!sel.rangeCount) { toast(t('Click into a paragraph first')); return; }
  const r = sel.getRangeAt(0);
  let el = r.startContainer;
  if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const body = el && el.closest ? el.closest('.chapter-body') : null;
  if (!body) { toast(t('Click into a paragraph first')); return; }
  const chId = body.closest('.chapter').dataset.id;
  const ps = [...body.querySelectorAll('p')].filter(
    (p) => r.intersectsNode(p) && !p.classList.contains('scene-break')
  );
  if (!ps.length) return;
  snapshotStructure('poetry paragraph');
  const on = !ps.every((p) => p.classList.contains('poetry'));
  for (const p of ps) {
    p.classList.toggle('poetry', on);
    if (on) italicize(p); else romanize(p);
  }
  caretIntoStart(ps[0]);
  syncChapter(body, chId);
  resetNativeUndo();
  breakRun++;
}

// ⇧Enter from the chapter title: a poetry paragraph above the opening one
function poetryUnderHeading(body, chId) {
  const line = document.createElement('p');
  line.className = 'poetry';
  italicize(line);
  snapshotStructure('poetry paragraph');
  body.prepend(line);
  body.focus();
  caretIntoStart(line);
  syncChapter(body, chId);
  resetNativeUndo();
  breakRun++;
}

// Backspace just below a *** (or Delete just above one) removes the break
// itself — prose never merges into the break's styled paragraph
function sceneBreakDelete(e, body, chId) {
  if (e.key !== 'Backspace' && e.key !== 'Delete') return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  let el = r.startContainer;
  if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const block = el && el.closest ? el.closest('p') : null;
  if (!block || !body.contains(block)) return false;
  const back = e.key === 'Backspace';
  const edge = document.createRange();
  edge.selectNodeContents(block);
  try {
    if (back) edge.setEnd(r.startContainer, r.startOffset);
    else edge.setStart(r.startContainer, r.startOffset);
  } catch { return false; }
  if (edge.toString().length !== 0) return false; // caret isn't at the block's edge
  const target = back ? block.previousElementSibling : block.nextElementSibling;
  if (!target || !target.classList.contains('scene-break')) return false;
  e.preventDefault();
  snapshotStructure('section break removed');
  target.remove();
  syncChapter(body, chId);
  resetNativeUndo();
  breakRun++;
  return true;
}

// Read a body's HTML for saving:
function captureBody(body) {
  return body.innerHTML;
}

function syncChapter(body, chId) {
  chapterHTML[chId] = captureBody(body);
  wordCache[chId] = null;
  scheduleChapterSave(chId);
  updateCounters();
  scheduleNavRefresh();
}

// Heal text-node fragmentation in each paragraph as the caret leaves it:
let lastCaretPara = null;
let capOffBody = null;
let menuPoetryState = false;
document.addEventListener('selectionchange', () => {
  if (!book || currentTab !== 'manuscript') return;
  const sel = window.getSelection();
  let caretP = null;
  if (sel && sel.rangeCount) {
    let el = sel.anchorNode;
    if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
    const p = el && el.closest ? el.closest('p') : null;
    if (p && p.parentElement && p.parentElement.classList.contains('chapter-body')) caretP = p;
  }
  if (caretP !== lastCaretPara) {
    if (lastCaretPara && lastCaretPara.isConnected) {
      try { lastCaretPara.normalize(); } catch { /* fine */ }
    }
    lastCaretPara = caretP;
  }
  // during a spellcheck pass, each chapter scans as the caret arrives
  if (spellOn && caretP) {
    const ch = caretP.closest('.chapter');
    if (ch) scanSpellingIn(ch.querySelector('.chapter-body'), ch.dataset.id);
  }
  // the drop cap steps aside while the caret is in the first paragraph
  const inPoetry = !!(caretP && caretP.classList.contains('poetry'));
  if (inPoetry !== menuPoetryState && window.neo.poetryState) {
    menuPoetryState = inPoetry;
    window.neo.poetryState(inPoetry);
  }
  const inFirst = caretP && caretP.parentElement &&
    caretP === caretP.parentElement.querySelector('p:not(.poetry)');
  const capBody = inFirst ? caretP.parentElement : null;
  if (capBody !== capOffBody) {
    if (capOffBody && capOffBody.isConnected) capOffBody.classList.remove('cap-off');
    if (capBody) capBody.classList.add('cap-off');
    capOffBody = capBody;
  }
});

// Reduce pasted HTML to what a manuscript is made of: paragraphs, bold,
// italic. Word, Apple Notes, Google Docs and browsers each dress a
// paragraph differently — <p>, <div>, a line break inside a block, styled
// spans — so every block boundary and <br> becomes a paragraph break, and
// styling that only lives in a style attribute is read as bold/italic.
function cleanPasteHtml(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  holder.querySelectorAll('script,style,meta,link,img,table,head,title').forEach((n) => n.remove());
  // Google Docs wraps the whole clipboard in <b style="font-weight:normal">
  holder.querySelectorAll('b, strong').forEach((b) => {
    const w = (b.style && b.style.fontWeight || '').toLowerCase();
    if (w === 'normal' || w === '400') { while (b.firstChild) b.before(b.firstChild); b.remove(); }
  });
  // styled spans: Word's italics and bold often live only in a style attribute
  holder.querySelectorAll('span[style], font[style]').forEach((sp) => {
    const st = sp.style;
    const fw = (st.fontWeight || '').toLowerCase();
    const bold = fw === 'bold' || fw === 'bolder' || parseInt(fw, 10) >= 600;
    const ital = (st.fontStyle || '').toLowerCase() === 'italic';
    if (bold) { const b = document.createElement('b'); while (sp.firstChild) b.appendChild(sp.firstChild); sp.appendChild(b); }
    if (ital) { const i = document.createElement('i'); while (sp.firstChild) i.appendChild(sp.firstChild); sp.appendChild(i); }
  });
  // a break marker at every block edge and every line break
  const BREAK = '\uE000';
  const blocks = 'p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre, section, article, header, footer, tr, dd, dt';
  holder.querySelectorAll(blocks).forEach((b) => {
    b.before(document.createTextNode(BREAK));
    b.after(document.createTextNode(BREAK));
  });
  holder.querySelectorAll('br').forEach((br) => br.replaceWith(document.createTextNode(BREAK)));

  const paras = [[]];
  for (const r of paraRuns(holder.innerHTML)) {
    if (r.mark !== undefined) { paras[paras.length - 1].push(r); continue; }
    const pieces = r.text.split(BREAK);
    pieces.forEach((text, i) => {
      if (i > 0) paras.push([]);
      if (text) paras[paras.length - 1].push({ text, b: r.b, i: r.i });
    });
  }
  const out = paras.map((runs) => {
    // whitespace collapses like HTML's, and each paragraph is trimmed
    runs = runs.map((r) => (r.mark !== undefined ? r : { ...r, text: r.text.replace(/\s+/g, ' ') }));
    const first = runs.find((r) => r.mark === undefined);
    if (first) first.text = first.text.replace(/^\s+/, '');
    const last = [...runs].reverse().find((r) => r.mark === undefined);
    if (last) last.text = last.text.replace(/\s+$/, '');
    const inner = runs.map((r) => {
      if (r.mark !== undefined) {
        // placeholder marks travel with their text; reconcileMarks pairs
        // each one back up with a note after the paste lands
        return r.mark
          ? `<span class="ph-mark" data-sid="${escHtml(r.mark)}" contenteditable="false">⚑</span>`
          : '';
      }
      if (!r.text) return '';
      let t = escHtml(r.text);
      if (r.i) t = '<i>' + t + '</i>';
      if (r.b) t = '<b>' + t + '</b>';
      return t;
    }).join('');
    return inner.replace(/<[^>]+>/g, '').trim() ? '<p>' + inner + '</p>' : '';
  }).filter(Boolean);
  // single block pastes inline (no forced new paragraph)
  if (out.length === 1) return out[0].slice(3, -4);
  return out.join('');
}

// Em dash, ellipsis, smart quotes:
function smartKeys(e, body) {
  // a field can reach smartKeys twice (its own handler and the page-wide
  // one below): the first pass wins
  if (e.defaultPrevented) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.isComposing || e.keyCode === 229) return;

  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);

  const prevChars = (n) => {
    if (!range.collapsed) return '';
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return '';
    return node.textContent.slice(Math.max(0, range.startOffset - n), range.startOffset);
  };

  if (e.key === '-' && prevChars(1) === '-') {
    e.preventDefault();
    document.execCommand('delete');
    document.execCommand('insertText', false, '—'); // —
    return;
  }
  if (e.key === '.' && prevChars(2) === '..') {
    e.preventDefault();
    document.execCommand('delete');
    document.execCommand('delete');
    document.execCommand('insertText', false, '…'); // …
    return;
  }
  const french = frenchTypography();
  // French: a narrow no-break space (U+202F) before ; : ! ? replaces the
  // ordinary space typed ahead of them. (The wider U+00A0 is not used: the
  // editing engine turns it back into a plain space, and NEO heals it away.)
  // Quebec usage (OQLF) keeps the space before the colon only.
  const spaced = french === 'ca' ? /^:$/ : /^[;:!?]$/;
  if (french && spaced.test(e.key) && /^[ \u00a0]$/.test(prevChars(1))) {
    e.preventDefault();
    document.execCommand('delete');
    document.execCommand('insertText', false, '\u202f' + e.key);
    return;
  }
  if (e.key === '"' || e.key === "'") {
    e.preventDefault();
    const before = prevChars(1);
    const opening = before === '' || /[\s\(\[\{—‘“«„>]/.test(before);
    const q = quoteStyle();
    let ch;
    if (e.key === "'") {
      // most languages type ' as an apostrophe only; English and Dutch also
      // open single quotes with it
      ch = q.singles && opening ? '‘' : '’';
    } else {
      ch = opening ? q.open : q.close;
    }
    document.execCommand('insertText', false, ch);
  }
}

// The quotation marks of the language being written: the spellcheck
// language when one is set, otherwise NEO's own language.
const QUOTE_STYLES = {
  en: { open: '“', close: '”', singles: true },
  nl: { open: '“', close: '”', singles: true },
  pt: { open: '“', close: '”', singles: true },          // Brazil
  'pt-PT': { open: '«', close: '»' },
  fr: { open: '«\u202f', close: '\u202f»' },             // narrow no-break spaces inside
  es: { open: '«', close: '»' },                          // RAE: « » first
  it: { open: '«', close: '»' },
  de: { open: '„', close: '“' },
  pl: { open: '„', close: '”' }
};
function writingLanguage() {
  return (library && library.spellLanguage) || NeoI18n.getLocale();
}
function quoteStyle() {
  const code = writingLanguage();
  return QUOTE_STYLES[code] || QUOTE_STYLES[code.split('-')[0]] || QUOTE_STYLES.en;
}

// French typographic rules apply when the book is spellchecked in French,
// or when NEO itself speaks French. Returns false, 'fr', or 'ca' for Quebec
// usage (when the interface is set to Canadian French).
function frenchTypography() {
  if (!writingLanguage().startsWith('fr')) return false;
  return /^fr-CA$/i.test(NeoI18n.getLocale()) ? 'ca' : 'fr';
}

// Titles, outline lines, notes and shelf names get the same typography as
// the manuscript (which calls smartKeys itself). Capture phase, because
// those fields keep their keystrokes from bubbling to the page.
document.addEventListener('keydown', (e) => {
  const el = e.target;
  if (e.defaultPrevented || !el || !el.isContentEditable || el.closest('.chapter-body')) return;
  smartKeys(e, el);
}, true);

// Title page: Enter drops you into Chapter One.
$('#tp-title').addEventListener('keydown', titleEnter);
$('#tp-subtitle').addEventListener('keydown', titleEnter);
function titleEnter(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (book.chapterOrder.length === 0) {
    newChapter();
  } else {
    focusChapter(book.chapterOrder[0]);
  }
}
$('#tp-title').addEventListener('input', () => {
  book.title = $('#tp-title').textContent.trim() || t('Untitled');
  scheduleMetaSave();
});
$('#tp-subtitle').addEventListener('input', () => {
  book.subtitle = $('#tp-subtitle').textContent.trim();
  scheduleMetaSave();
});
// each book can carry its own pen name
$('#tp-author').addEventListener('input', () => {
  book.author = $('#tp-author').textContent.trim();
  scheduleMetaSave();
});

// Global editor shortcuts
document.addEventListener('keydown', (e) => {
  if ($('#editor-view').hidden) return;
  if (document.querySelector('.modal-backdrop:not([hidden])')) return; // visible modals own the keyboard
  const cmd = e.metaKey || e.ctrlKey;
  if (cmd && e.shiftKey && e.code === 'KeyX') {
    e.preventDefault();
    if (currentTab === 'manuscript') insertPlaceholder();
  }
  if (cmd && e.shiftKey && e.code === 'KeyD') {
    e.preventDefault();
    if (currentTab === 'manuscript') darlingFromKeyboard();
  }
  // Ctrl+; is matched by the character, not the key position. On a German
  // QWERTZ keyboard the semicolon is Shift+',' — a combination the menu
  // accelerator cannot name, so Ctrl+; never fired there. Shift is required
  // in this branch because the plain Ctrl+; case belongs to the menu on the
  // layouts that have it; this catches the ones that need Shift to type ';'.
  if (cmd && e.shiftKey && !e.altKey && e.key === ';') {
    e.preventDefault();
    toggleSpellcheck();
  }
  if (e.key === 'Escape') {
    if (!$('#searchbar').hidden) closeSearch();
    else window.neo.fullscreenEscape().then((exited) => { if (!exited) backToShelf(); });
  }
});

// Escape also exits regular fullscreen from the bookshelf
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !$('#editor-view').hidden) return;
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  window.neo.fullscreenEscape();
});

// ⌘Enter (Ctrl+Enter): toggle fullscreen from anywhere
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  e.preventDefault();
  window.neo.fullscreenToggle();
});

function createChapterAt(idx) {
  const chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  book.chapterOrder.splice(idx, 0, chId);
  chapterHTML[chId] = '<p><br></p>';
  persistChapter(chId);
  saveMeta();
  renderChapters();
  return chId;
}

function newChapter() {
  // insert after the chapter you're in; at the end if you're not in one
  const idx = currentChapterId ? book.chapterOrder.indexOf(currentChapterId) + 1 : book.chapterOrder.length;
  const chId = createChapterAt(idx);
  focusChapter(chId);
}

async function deleteChapterQuiet(chId) {
  // a save still queued for this chapter must not resurrect it (nejcc, #70)
  clearTimeout(saveTimers[chId]);
  delete saveTimers[chId];
  book.chapterOrder = book.chapterOrder.filter((c) => c !== chId);
  delete chapterHTML[chId];
  delete wordCache[chId];
  if (book.sectionNotes) delete book.sectionNotes[chId];
  if (book.chapterNotes) delete book.chapterNotes[chId];
  stickies = stickies.filter((s) => s.chapterId !== chId);
  window.neo.writeJSON(book.id, 'stickies', stickies);
  window.neo.deleteChapter(book.id, chId);
  await saveMeta();
  renderChapters();
  renderStickies();
}

function focusChapter(chId) {
  const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  if (!body) return;
  body.focus();
  // caret at the very end
  const range = document.createRange();
  range.selectNodeContents(body);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  body.closest('.chapter').scrollIntoView({ behavior: 'smooth', block: 'start' });
  currentChapterId = chId;
  highlightNav();
}

/* ================================================================== */
/*  PLACEHOLDERS + STICKIES                                            */
/* ================================================================== */

function insertPlaceholder() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  // derive the chapter from where the caret actually is:
  let el = sel.anchorNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const bodyEl = el && el.closest ? el.closest('.chapter-body') : null;
  if (!bodyEl) {
    toast(t('Click into a chapter first, then {key} drops a placeholder', { key: KPH }));
    return;
  }
  currentChapterId = bodyEl.closest('.chapter').dataset.id;
  const sid = 's-' + Date.now().toString(36);
  const span = document.createElement('span');
  span.className = 'ph-mark';
  span.dataset.sid = sid;
  span.contentEditable = 'false';
  span.textContent = '⚑';
  const range = sel.getRangeAt(0);
  range.collapse(false);
  range.insertNode(span);
  // park the caret just past the mark and keep writing
  const after = document.createTextNode(' ');
  span.after(after);
  range.setStartAfter(after);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);

  stickies.push({ id: sid, chapterId: currentChapterId, text: '', resolved: false });
  window.neo.writeJSON(book.id, 'stickies', stickies);
  chapterHTML[currentChapterId] = captureBody(document.querySelector(
    `.chapter[data-id="${currentChapterId}"] .chapter-body`
  ));
  scheduleChapterSave(currentChapterId);
  renderStickies();
  scheduleNavRefresh();
  // the caret lands in the note: type what needs doing, Enter brings you
  // back to the page just past the flag (Shift+Enter for another line)
  const pane = $('#side-pane');
  pane.dataset.autoOpened = pane.classList.contains('open') ? '0' : '1';
  focusSticky(sid);
}

// Back to the manuscript, caret just past the flag. Scrolls only when the
// flag isn't already on screen, and from wherever the page is now.
function returnToMark(sid) {
  if (currentTab !== 'manuscript') switchTab('manuscript');
  const mark = document.querySelector(`.ph-mark[data-sid="${sid}"]`);
  if (!mark) return;
  const bodyEl = mark.closest('.chapter-body');
  const scroller = $('#paper-scroll');
  const r = mark.getBoundingClientRect();
  const sr = scroller.getBoundingClientRect();
  if (r.top < sr.top + 40 || r.bottom > sr.bottom - 40) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (!bodyEl) return;
  currentChapterId = bodyEl.closest('.chapter').dataset.id;
  bodyEl.focus({ preventScroll: true });
  const range = document.createRange();
  const next = mark.nextSibling;
  if (next && next.nodeType === Node.TEXT_NODE) range.setStart(next, Math.min(1, next.textContent.length));
  else range.setStartAfter(mark);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  highlightNav();
}

function renderStickies() {
  const wrap = $('#sticky-list');
  wrap.innerHTML = '';
  const open = stickies.filter((s) => !s.resolved);
  if (open.length === 0) {
    wrap.innerHTML = `<div class="stickies-empty">${t('No notes yet.')}<br><br>${t('Hit {key} while writing to drop a placeholder — a “come back to this” mark that never breaks your flow.', { key: KPH })}</div>`;
    return;
  }
  for (const s of open) {
    const chIdx = book.chapterOrder.indexOf(s.chapterId);
    const el = document.createElement('div');
    el.className = 'sticky unresolved';
    el.dataset.sid = s.id;
    el.innerHTML = `
      <div class="s-ch">${chIdx >= 0 ? t('Chapter {n}', { n: chIdx + 1 }) : t('Unplaced')}</div>
      <textarea placeholder="${t('What needs doing here?')}" spellcheck="false"></textarea>
      <div class="s-actions"><button class="s-go">${t('Go to')}</button><span class="s-sep">·</span><button class="s-done">${t('Resolve')}</button></div>`;
    const ta = el.querySelector('textarea');
    ta.value = s.text;
    ta.addEventListener('input', () => {
      s.text = ta.value;
      clearTimeout(saveTimers.stickies);
      saveTimers.stickies = setTimeout(() => window.neo.writeJSON(book.id, 'stickies', stickies), 600);
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return; // Shift+Enter: another line in the note
      e.preventDefault();
      const pane = $('#side-pane');
      if (pane.dataset.autoOpened === '1' && pane.dataset.pinned !== '1') pane.classList.remove('open');
      pane.dataset.autoOpened = '0';
      returnToMark(s.id);
    });
    el.querySelector('.s-go').onclick = () => returnToMark(s.id);
    el.querySelector('.s-done').onclick = () => resolveSticky(s.id);
    wrap.appendChild(el);
  }
}

// Pair every mark in the manuscript with a note: pasted duplicates get their
// own copy of the note, marks that moved chapters update their red dot, and
// marks orphaned by older versions get a fresh (empty) note instead of dying.
function reconcileMarks() {
  if (!book) return;
  const seen = new Set();
  let changed = false;
  for (const m of document.querySelectorAll('.chapter-body .ph-mark')) {
    let sid = m.dataset.sid;
    if (!sid) continue;
    const chEl = m.closest('.chapter');
    const chId = chEl ? chEl.dataset.id : null;
    const existing = stickies.find((s) => s.id === sid);
    if (seen.has(sid)) {
      const nid = 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5);
      m.dataset.sid = nid;
      stickies.push({ id: nid, chapterId: chId, text: existing ? existing.text : '', resolved: false });
      seen.add(nid);
      changed = true;
      continue;
    }
    if (!existing) {
      stickies.push({ id: sid, chapterId: chId, text: '', resolved: false });
      changed = true;
    } else if (existing.chapterId !== chId) {
      existing.chapterId = chId;
      changed = true;
    }
    seen.add(sid);
  }
  if (changed) {
    window.neo.writeJSON(book.id, 'stickies', stickies);
    renderStickies();
    renderNav();
  }
}

function resolveSticky(sid) {
  const mark = document.querySelector(`.ph-mark[data-sid="${sid}"]`);
  if (mark) {
    const chId = mark.closest('.chapter').dataset.id;
    const prev = mark.previousSibling;
    const next = mark.nextSibling;
    mark.remove();
    // tidy the seam: old flags parked a no-break space after themselves,
    // and removing a flag between two spaces shouldn't leave both
    if (next && next.nodeType === Node.TEXT_NODE) next.data = next.data.replace(/^\u00a0/, ' ');
    if (prev && prev.nodeType === Node.TEXT_NODE) prev.data = prev.data.replace(/\u00a0$/, ' ');
    if (prev && next && prev.nodeType === Node.TEXT_NODE && next.nodeType === Node.TEXT_NODE &&
        / $/.test(prev.data) && /^ /.test(next.data)) {
      next.data = next.data.slice(1);
    }
    const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
    try { body.normalize(); } catch { /* fine */ }
    chapterHTML[chId] = captureBody(body);
    scheduleChapterSave(chId);
  }
  stickies = stickies.filter((s) => s.id !== sid);
  window.neo.writeJSON(book.id, 'stickies', stickies);
  renderStickies();
  scheduleNavRefresh();
}

function focusSticky(sid) {
  $('#side-pane').classList.add('open');
  const el = document.querySelector(`.sticky[data-sid="${sid}"] textarea`);
  if (el) el.focus();
}

/* ================================================================== */
/*  NAV PANE                                                           */
/* ================================================================== */

let chapterDragActive = false;
let navRefreshPending = false;

function renderNav() {
  if (!book) return; // a refresh queued just before the shelf came back
  // Replacing the source row during a native drag can interrupt its lifecycle.
  if (chapterDragActive) { navRefreshPending = true; return; }
  navRefreshPending = false;
  const list = $('#nav-list');
  list.innerHTML = '';
  book.chapterNotes = book.chapterNotes || {};
  book.chapterOrder.forEach((chId, i) => {
    const words = chapterWords(chId);
    const flagged = !!document.querySelector(`.chapter[data-id="${chId}"] .ph-mark`);
    const chTitle = (book.chapterTitles || {})[chId];
    const item = document.createElement('div');
    item.className = 'nav-item' + (chId === currentChapterId ? ' current' : '');
    item.dataset.id = chId;
    item.innerHTML = `<div class="n-row" title="${t('Drag to reorder chapters')}"><span class="n-label"></span>
      <span style="display:flex;align-items:center"><span class="n-words">${fmtNum(words)}</span>${flagged ? `<span class="n-flag" title="${t('Unresolved placeholder')}"></span>` : ''}</span></div>`;
    item.querySelector('.n-label').textContent = book.chapterOrder.length === 1
      ? (book.title || t('The story'))
      : (chTitle ? `${i + 1} · ${chTitle}` : t('Chapter {n}', { n: i + 1 }));

    // the row is the drag handle, so the note below stays freely editable
    const rowEl = item.querySelector('.n-row');
    rowEl.draggable = true;
    rowEl.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-neo-chapter', chId);
      chapterDragActive = true;
      $('#nav-pane').classList.add('open');
      item.classList.add('dragging');
    });
    rowEl.addEventListener('dragend', finishChapterDrag);

    // outline your whole book from this panel:
    const note = document.createElement('div');
    note.className = 'nav-note';
    note.contentEditable = 'true';
    note.spellcheck = false;
    note.textContent = book.chapterNotes[chId] || '';
    note.addEventListener('click', (e) => e.stopPropagation());
    note.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); note.blur(); }
      e.stopPropagation();
    });
    note.addEventListener('blur', () => {
      book.chapterNotes[chId] = note.textContent.trim();
      scheduleMetaSave();
    });
    item.appendChild(note);

    item.onclick = () => {
      switchTab('manuscript');
      focusChapter(chId);
    };
    list.appendChild(item);
  });
}

$('#nav-add').onclick = () => {
  switchTab('manuscript');
  currentChapterId = book.chapterOrder[book.chapterOrder.length - 1] || null;
  newChapter();
};

// drop target for chapter reordering, with a gold line showing the landing spot
const navList = $('#nav-list');
function finishChapterDrag(e) {
  if (!chapterDragActive) return;
  chapterDragActive = false;
  navList.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
  const ind = navList.querySelector('.nav-drop-ind');
  if (ind) ind.remove();
  // Native dragging can temporarily blur the window. Use the release position
  // to keep the pane available after an in-pane drop, even before focus returns.
  const pane = $('#nav-pane');
  const r = pane.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) {
    pane.classList.remove('open');
  }
  if (navRefreshPending) renderNav();
}
// Drop also cleans up if rendering removes the source before dragend bubbles.
// Dragend covers Escape and releases outside a valid drop target.
document.addEventListener('drop', finishChapterDrag);
document.addEventListener('dragend', finishChapterDrag);

function navDropInd() {
  let ind = document.querySelector('.nav-drop-ind');
  if (!ind) {
    ind = document.createElement('div');
    ind.className = 'nav-drop-ind';
  }
  return ind;
}
navList.addEventListener('dragover', (e) => {
  if (!e.dataTransfer.types.includes('application/x-neo-chapter')) return;
  e.preventDefault();
  const ind = navDropInd();
  const items = [...navList.querySelectorAll('.nav-item:not(.dragging)')];
  let placed = false;
  for (const it of items) {
    const r = it.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) {
      navList.insertBefore(ind, it);
      placed = true;
      break;
    }
  }
  if (!placed) navList.appendChild(ind);
});
navList.addEventListener('dragleave', (e) => {
  if (navList.contains(e.relatedTarget)) return;
  const ind = document.querySelector('.nav-drop-ind');
  if (ind) ind.remove();
});
navList.addEventListener('drop', async (e) => {
  const chId = e.dataTransfer.getData('application/x-neo-chapter');
  if (!chId) return;
  e.preventDefault();
  const ind = document.querySelector('.nav-drop-ind');
  let index = book.chapterOrder.filter((c) => c !== chId).length;
  if (ind) {
    index = 0;
    for (const c of navList.children) {
      if (c === ind) break;
      if (c.classList.contains('nav-item') && !c.classList.contains('dragging')) index++;
    }
    ind.remove();
  }
  const from = book.chapterOrder.indexOf(chId);
  if (from === -1) return;
  snapshotStructure('chapter reorder');
  book.chapterOrder = book.chapterOrder.filter((c) => c !== chId);
  book.chapterOrder.splice(index, 0, chId);
  await saveMeta();
  renderChapters(); // renumbers heads and rebuilds the nav
  if (currentTab === 'outline') renderOutline();
});

function highlightNav() {
  $$('.nav-item').forEach((el) => el.classList.toggle('current', el.dataset.id === currentChapterId));
}

function scheduleNavRefresh() {
  clearTimeout(saveTimers.nav);
  saveTimers.nav = setTimeout(renderNav, 1200);
}

// Hover behavior for both side panes:
function wireHoverPane(hotzone, pane, isPinnable) {
  const pinned = () => (isPinnable && pane.dataset.pinned === '1') ||
    (pane.id === 'nav-pane' && chapterDragActive);
  hotzone.addEventListener('mouseenter', (e) => {
    if (e.buttons) return; // dragging something — stand down
    pane.classList.add('open');
  });
  hotzone.addEventListener('mouseleave', (e) => {
    if (pinned()) return;
    if (e.relatedTarget && pane.contains(e.relatedTarget)) return;
    pane.classList.remove('open');
  });
  pane.addEventListener('mouseleave', () => {
    if (pinned()) return;
    pane.classList.remove('open');
  });
}
wireHoverPane($('#nav-hotzone'), $('#nav-pane'), false);
wireHoverPane($('#side-hotzone'), $('#side-pane'), true);

// leaving the window closes unpinned panes (they used to stick open)
function closeUnpinnedPanes() {
  // Wayland can blur the window as a native chapter drag begins.
  if (!chapterDragActive) $('#nav-pane').classList.remove('open');
  if ($('#side-pane').dataset.pinned !== '1') $('#side-pane').classList.remove('open');
}
document.documentElement.addEventListener('mouseleave', closeUnpinnedPanes);
window.addEventListener('blur', closeUnpinnedPanes);

// the wheel scrolls the manuscript even when the pointer floats over the
// dark margins beside the (narrower) page column
$('#editor-view').addEventListener('wheel', (e) => {
  const scroller = $('#paper-scroll');
  if (e.ctrlKey) return; // pinch-zoom gesture, not a scroll
  if (scroller.contains(e.target)) return; // native scrolling handles it
  if ($('#nav-pane').contains(e.target) || $('#side-pane').contains(e.target)) return;
  scroller.scrollTop += e.deltaY;
}, { passive: true });

$('#side-pin').onclick = () => {
  const pane = $('#side-pane');
  const pinned = pane.dataset.pinned === '1';
  pane.dataset.pinned = pinned ? '0' : '1';
  $('#side-pin').classList.toggle('pinned', !pinned);
  $('#editor-view').classList.toggle('side-pinned', !pinned);
  if (!pinned) pane.classList.add('open');
};

/* ================================================================== */
/*  TABS — Manuscript / Notes / Outline / Darlings                     */
/* ================================================================== */

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  tab.addEventListener('dblclick', async () => {
    const kind = tab.dataset.tab;
    if (kind !== 'notes' && kind !== 'outline') return;
    const name = await askInput(t('Rename tab'), t('New tab name'), tabName(kind));
    if (!name) return;
    book.tabNames[kind] = name;
    tab.textContent = name;
    saveMeta();
    // Renamed tabs become the default for future books
    library.tabDefaults = library.tabDefaults || {};
    library.tabDefaults[kind] = name;
    window.neo.writeLibrary(library);
  });
});

// Darlings tab is a drop target for selected text
const darlingsTab = $('.tab.darlings');
// The selection usually collapses by the time a drag lands on the Darlings
// tab, so the range is remembered at dragstart and the cut is made by NEO
// itself (dropEffect 'copy' keeps Chromium from moving the text on its own).
let draggedRange = null;
document.addEventListener('dragstart', (e) => {
  // any text drag inside the manuscript lights up the bottom bar
  if (currentTab === 'manuscript' && e.target.closest && e.target.closest('.chapter-body')) {
    $('#bottombar').classList.add('attn');
    const sel = window.getSelection();
    draggedRange = sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null;
  }
});
document.addEventListener('dragend', () => { $('#bottombar').classList.remove('attn'); draggedRange = null; });

darlingsTab.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  darlingsTab.classList.add('drag-over');
});
darlingsTab.addEventListener('dragleave', () => darlingsTab.classList.remove('drag-over'));
darlingsTab.addEventListener('drop', async (e) => {
  e.preventDefault();
  darlingsTab.classList.remove('drag-over');
  const html = e.dataTransfer.getData('text/html');
  const text = e.dataTransfer.getData('text/plain');
  await moveSelectionToDarlings(html, text);
});

// ---- text-position helpers: darlings remember home by their surrounding
// text, so nothing foreign is left inside the manuscript ----

function bodyPlainText(body) {
  let t = '';
  const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) t += n.textContent;
  return t;
}

function textPosToRange(body, pos) {
  const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let n, acc = 0;
  while ((n = w.nextNode())) {
    const len = n.textContent.length;
    if (acc + len >= pos) {
      const r = document.createRange();
      r.setStart(n, pos - acc);
      r.collapse(true);
      return r;
    }
    acc += len;
  }
  return null;
}

// Where in the chapter does this darling belong?
function findDarlingPosition(body, d) {
  if (d.anchorPrefix == null && d.anchorSuffix == null) return -1;
  const text = bodyPlainText(body);
  const pre = d.anchorPrefix || '';
  const suf = d.anchorSuffix || '';
  let idx = (pre + suf) ? text.indexOf(pre + suf) : -1;
  if (idx !== -1) return idx + pre.length;
  if (pre) {
    idx = text.indexOf(pre);
    if (idx !== -1) return idx + pre.length;
  }
  if (suf) {
    idx = text.indexOf(suf);
    if (idx !== -1) return idx;
  }
  return -1;
}

// The one move shared by drag-to-tab and ⌘⇧D: the cut point is remembered by its surroundings —
// no markers in the WIP itself.
async function moveSelectionToDarlings(html, text) {
  if (!text || !text.trim() || !book) return;
  const sel = window.getSelection();
  // the live selection if it survived the drag, else the one saved at dragstart
  const live = sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0) : null;
  const range = live || draggedRange;
  draggedRange = null;
  const srcChapter = range
    ? range.startContainer.parentElement?.closest?.('.chapter')
    : null;
  const chId = srcChapter ? srcChapter.dataset.id : currentChapterId;
  const chIdx = book.chapterOrder.indexOf(chId);
  const did = 'd-' + Date.now().toString(36);

  snapshotStructure('darling');

  let anchorPrefix = null;
  let anchorSuffix = null;
  if (range) {
    const startNode = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
    const startBlock = startNode && startNode.closest ? startNode.closest('p') : null;
    range.deleteContents();
    // a whole paragraph dragged away leaves its empty shell behind: remove it
    // and park the caret at the end of the paragraph before (or start of after)
    if (startBlock && !startBlock.textContent.trim() && !startBlock.querySelector('span')
        && startBlock.parentElement && startBlock.parentElement.children.length > 1) {
      const prev = startBlock.previousElementSibling;
      const next = startBlock.nextElementSibling;
      startBlock.remove();
      if (prev) { range.selectNodeContents(prev); range.collapse(false); }
      else if (next) { range.selectNodeContents(next); range.collapse(true); }
    }
    sel.removeAllRanges(); sel.addRange(range);
    const r = range;
    const body = r.startContainer.parentElement?.closest?.('.chapter-body');
    if (body) {
      const pre = document.createRange();
      pre.selectNodeContents(body);
      pre.setEnd(r.startContainer, r.startOffset);
      anchorPrefix = pre.toString().slice(-60);
      const post = document.createRange();
      post.selectNodeContents(body);
      post.setStart(r.startContainer, r.startOffset);
      anchorSuffix = post.toString().slice(0, 60);
    }
  }
  if (chId) {
    const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
    if (body) {
      chapterHTML[chId] = captureBody(body);
      wordCache[chId] = null;
      scheduleChapterSave(chId);
    }
  }

  // Chromium's drag html carries inline font/colour/background styles;
  // keep only the prose (paragraphs when the drag spanned more than one)
  let cleanHtml = null;
  if (html) {
    const cleaned = cleanPasteHtml(html);
    cleanHtml = /\n/.test(text.trim()) && !/<p[\s>]/i.test(cleaned) ? '<p>' + cleaned + '</p>' : cleaned;
  }
  darlings.unshift({
    id: did,
    html: cleanHtml,
    text: text,
    chapterId: chId || null,
    chapterLabel: chIdx >= 0 ? t('Chapter {n}', { n: chIdx + 1 }) : t('Manuscript'),
    anchorPrefix,
    anchorSuffix,
    date: new Date().toISOString()
  });
  await window.neo.writeJSON(book.id, 'darlings', darlings);
  updateCounters();
  toast(t('Saved to Darlings — kill without remorse ({key} to undo)', { key: KZ }));
}

// Older versions of NEO planted invisible marker spans at darling cut points,
// which interfered with Chromium's delete handling. On open, convert each one
// into a remembered-context position and remove it:
async function migrateDarlingAnchors() {
  const spans = [...document.querySelectorAll('.darling-anchor')];
  if (!spans.length) return;
  let changed = false;
  for (const span of spans) {
    const body = span.closest('.chapter-body');
    const d = darlings.find((x) => x.id === span.dataset.did);
    if (body && d && d.anchorPrefix == null) {
      const pre = document.createRange();
      pre.selectNodeContents(body);
      pre.setEndBefore(span);
      d.anchorPrefix = pre.toString().slice(-60);
      const post = document.createRange();
      post.selectNodeContents(body);
      post.setStartAfter(span);
      d.anchorSuffix = post.toString().slice(0, 60);
      changed = true;
    }
    const chapter = span.closest('.chapter');
    span.remove();
    if (body && chapter) {
      chapterHTML[chapter.dataset.id] = captureBody(body);
      wordCache[chapter.dataset.id] = null;
      scheduleChapterSave(chapter.dataset.id);
    }
  }
  if (changed) await window.neo.writeJSON(book.id, 'darlings', darlings);
}

// keyboard route: select a passage, ⌘⇧D to move to Darlings
function darlingFromKeyboard() {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) {
    toast(t('Select the passage first, then {key} sends it to Darlings', { key: KDA }));
    return;
  }
  let el = sel.anchorNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  if (!el || !el.closest || !el.closest('.chapter-body')) return;
  const holder = document.createElement('div');
  holder.appendChild(sel.getRangeAt(0).cloneContents());
  moveSelectionToDarlings(holder.innerHTML, sel.toString());
}

// Every tab shares one scroller, so leaving a tab used to lose its place.
// Each tab now remembers where it was — the manuscript keeps its caret as
// well — for as long as the book is open.
let tabPlaces = {};

function switchTab(name) {
  const scroller = $('#paper-scroll');
  if (book && currentTab && currentTab !== name) {
    tabPlaces[currentTab] = currentTab === 'manuscript'
      ? { caret: captureCaret(), scroll: scroller.scrollTop }
      : { scroll: scroller.scrollTop };
  }
  currentTab = name;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  if (spellOn) setTimeout(scanSpellingHere, 0);
  const paper = $('#paper');
  const aux = $('#aux-paper');
  const auxEditor = $('#aux-editor');
  const dList = $('#darlings-list');
  const oList = $('#outline-list');
  const back = tabPlaces[name];
  const returnTo = () => { if (back && typeof back.scroll === 'number') scroller.scrollTop = back.scroll; };

  // stash whatever aux content was open
  flushAux();

  if (name === 'manuscript') {
    paper.hidden = false;
    aux.hidden = true;
    if (back && back.caret) restoreCaret(back.caret); // brings the scroll along
    else returnTo();
    return;
  }
  paper.hidden = true;
  aux.hidden = false;
  auxEditor.hidden = true;
  dList.hidden = true;
  oList.hidden = true;

  if (name === 'darlings') {
    $('#aux-title').textContent = t('Darlings');
    dList.hidden = false;
    renderDarlings();
    returnTo();
  } else if (name === 'outline') {
    $('#aux-title').textContent = tabName('outline');
    oList.hidden = false;
    if (book.chapterOrder.length === 0) createChapterAt(0);
    renderOutline();
    returnTo();
  } else {
    $('#aux-title').textContent = tabName(name);
    auxEditor.hidden = false;
    auxEditor.dataset.kind = name;
    window.neo.readAux(book.id, name).then((html) => {
      auxEditor.innerHTML = html || '';
      auxEditor.focus({ preventScroll: true });
      returnTo();
    });
  }
}

/* ================================================================== */
/*  STRUCTURED OUTLINE                                                 */
/*  Chapter lines are the book's real chapters. Section notes become   */
/*  grayed "ghost" paragraphs in the manuscript                       */
/* ================================================================== */

const secLetter = (i) => String.fromCharCode(65 + (i % 26));

function renderOutline(focusTarget) {
  book.sectionNotes = book.sectionNotes || {};
  book.chapterNotes = book.chapterNotes || {};
  const wrap = $('#outline-list');
  wrap.innerHTML = '';

  book.chapterOrder.forEach((chId, i) => {
    wrap.appendChild(outlineLine('chapter', chId, null, i, String(i + 1),
      book.chapterNotes[chId] || ''));
    (book.sectionNotes[chId] || []).forEach((sec, j) => {
      wrap.appendChild(outlineLine('section', chId, sec.id, j, secLetter(j), sec.text));
    });
  });

  const hint = document.createElement('div');
  hint.className = 'ol-hint';
  hint.textContent = t('Enter — new chapter (or section, from a section line) · Tab — turn a fresh chapter line into a section · Shift+Tab — turn a section into a chapter · Backspace on an empty line removes it');
  wrap.appendChild(hint);

  if (focusTarget) {
    const el = wrap.querySelector(
      focusTarget.secId
        ? `.ol-line[data-sec-id="${focusTarget.secId}"] .ol-text`
        : `.ol-line.ol-chapter[data-ch-id="${focusTarget.chId}"] .ol-text`
    );
    if (el) {
      el.focus();
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
  }
}

function outlineLine(kind, chId, secId, index, label, text) {
  const line = document.createElement('div');
  line.className = 'ol-line ol-' + kind;
  line.dataset.chId = chId;
  if (secId) line.dataset.secId = secId;
  const num = document.createElement('span');
  num.className = 'ol-num';
  num.textContent = label;
  const txt = document.createElement('div');
  txt.className = 'ol-text';
  txt.contentEditable = 'true';
  txt.spellcheck = false;
  txt.textContent = text;

  const save = () => {
    const val = txt.textContent.trim();
    if (kind === 'chapter') {
      book.chapterNotes[chId] = val;
    } else {
      const sec = (book.sectionNotes[chId] || []).find((s) => s.id === secId);
      if (sec) sec.text = val;
    }
    scheduleMetaSave();
  };

  txt.addEventListener('blur', () => {
    save();
    if (kind === 'section') syncGhosts(chId);
    renderNav();
  });

  // Enter at the very start of a line that has text makes the new line
  // ABOVE it (the only way to put something before "A"); anywhere else,
  // below — the way a text editor's outline behaves
  const caretAtStart = () => {
    if (!txt.textContent.trim()) return false;
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return false;
    const r = sel.getRangeAt(0);
    if (!txt.contains(r.startContainer)) return false;
    const head = document.createRange();
    head.selectNodeContents(txt);
    head.setEnd(r.startContainer, r.startOffset);
    return head.toString().length === 0;
  };

  txt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const above = caretAtStart();
      save();
      if (kind === 'chapter') {
        const at = book.chapterOrder.indexOf(chId) + (above ? 0 : 1);
        const newId = createChapterAt(at);
        renderOutline({ chId: newId });
      } else {
        const list = book.sectionNotes[chId];
        const newSec = { id: 'sec-' + Date.now().toString(36), text: '' };
        list.splice(index + (above ? 0 : 1), 0, newSec);
        scheduleMetaSave();
        syncGhosts(chId);
        renderOutline({ secId: newSec.id });
      }
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const lines = [...document.querySelectorAll('.ol-line .ol-text')];
      const next = lines[lines.indexOf(txt) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) {
        next.focus();
        const r = document.createRange();
        r.selectNodeContents(next);
        r.collapse(false);
        const s = window.getSelection();
        s.removeAllRanges(); s.addRange(r);
      }
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      if (kind !== 'chapter') return;
      const pos = book.chapterOrder.indexOf(chId);
      if (pos === 0) { toast(t('The first line has to be a chapter')); return; }
      if (countWords(chapterText(chId)) > 0) {
        toast(t('This chapter already has words in it — only empty chapter lines can become sections'));
        return;
      }
      save();
      const prevCh = book.chapterOrder[pos - 1];
      book.sectionNotes[prevCh] = book.sectionNotes[prevCh] || [];
      const newSec = { id: 'sec-' + Date.now().toString(36), text: txt.textContent.trim() };
      book.sectionNotes[prevCh].push(newSec);
      deleteChapterQuiet(chId).then(() => {
        syncGhosts(prevCh);
        renderOutline({ secId: newSec.id });
      });
    }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      if (kind !== 'section') return;
      save();
      const list = book.sectionNotes[chId];
      const sec = list.find((s) => s.id === secId);
      list.splice(list.indexOf(sec), 1);
      const at = book.chapterOrder.indexOf(chId) + 1;
      const newId = createChapterAt(at);
      book.chapterNotes[newId] = sec.text;
      scheduleMetaSave();
      syncGhosts(chId);
      renderOutline({ chId: newId });
    }
    if (e.key === 'Backspace' && txt.textContent.trim() === '') {
      e.preventDefault();
      if (kind === 'section') {
        const list = book.sectionNotes[chId];
        book.sectionNotes[chId] = list.filter((s) => s.id !== secId);
        scheduleMetaSave();
        syncGhosts(chId);
        renderOutline({ chId });
      } else if (book.chapterOrder.length > 1 && countWords(chapterText(chId)) === 0) {
        const pos = book.chapterOrder.indexOf(chId);
        const prevCh = book.chapterOrder[Math.max(0, pos - 1)];
        deleteChapterQuiet(chId).then(() => renderOutline({ chId: prevCh }));
      }
    }
    e.stopPropagation();
  });

  // right-click any outline line to delete it
  line.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (kind === 'chapter') {
      const i = book.chapterOrder.indexOf(chId);
      const words = countWords(chapterText(chId));
      const choice = await optionModal(
        t('Chapter {n}', { n: i + 1 }),
        words ? t('{n} words.', { n: words }) : t('This chapter is empty.'),
        [{ label: t('Delete chapter'), desc: words ? t('Its words move to Darlings, recoverable anytime.') : t('Nothing to save — it just goes.'), danger: true, value: 'delete' }]
      );
      if (choice === 'delete') {
        await deleteChapterToDarlings(chId);
        renderOutline();
      }
    } else {
      const choice = await optionModal(t('Delete this section?'), null,
        [{ label: t('Delete section'), desc: t('Removes the outline line and its gray ghost from the manuscript. Written prose is never touched.'), danger: true, value: 'delete' }]);
      if (choice === 'delete') {
        book.sectionNotes[chId] = (book.sectionNotes[chId] || []).filter((s) => s.id !== secId);
        scheduleMetaSave();
        syncGhosts(chId);
        renderOutline({ chId });
      }
    }
  });

  line.appendChild(num);
  line.appendChild(txt);
  return line;
}

// Push section notes into the manuscript as gray ghost paragraphs,
// with real *** scene breaks between sections.
// Once a ghost has been written over, it goes away.
function syncGhosts(chId) {
  const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  if (!body) return;
  const list = (book.sectionNotes && book.sectionNotes[chId]) || [];
  const keep = new Set(list.map((s) => s.id));

  const breakFor = (secId) => body.querySelector(`p.scene-break[data-sec-brk="${secId}"]`);

  // 1. Sections deleted from the outline: remove their ghost + its break
  //    (but never touch paragraphs that have been written over)
  body.querySelectorAll('p.ghost[data-sec-id]').forEach((p) => {
    if (!keep.has(p.dataset.secId)) {
      const brk = breakFor(p.dataset.secId);
      if (brk) brk.remove();
      p.remove();
    }
  });

  // 2. Pull all still-ghost paragraphs out, then re-append in outline order
  //    so the ghosts always mirror the outline's sequence
  for (const p of [...body.querySelectorAll('p.ghost[data-sec-id]')]) {
    const brk = breakFor(p.dataset.secId);
    if (brk) brk.remove();
    p.remove();
  }
  for (const sec of list) {
    // written over already? Leave it alone
    const written = body.querySelector(`p[data-sec-id="${sec.id}"]:not(.ghost)`);
    if (written) continue;
    if (!sec.text) continue;
    // *** between this ghost and whatever comes before it
    const hasContent = body.innerText.trim() !== '';
    if (hasContent && !(body.lastElementChild && body.lastElementChild.classList.contains('scene-break'))) {
      const brk = document.createElement('p');
      brk.className = 'scene-break';
      brk.dataset.secBrk = sec.id;
      brk.textContent = '***';
      body.appendChild(brk);
    }
    const p = document.createElement('p');
    p.className = 'ghost';
    p.dataset.secId = sec.id;
    p.textContent = sec.text;
    body.appendChild(p);
  }
  syncChapter(body, chId);
}

let auxDirty = false;
$('#aux-editor').addEventListener('keydown', (e) => { if (styleKeepScroll(e)) return; smartKeys(e, e.currentTarget); });
$('#aux-editor').addEventListener('input', () => {
  auxDirty = true;
  scheduleAuxSave();
  if (spellOn) {
    const key = 'aux-' + ($('#aux-editor').dataset.kind || 'notes');
    scheduleSpellRescan(key, $('#aux-editor'));
  }
});
// notes paste arrives clean, same as the manuscript
$('#aux-editor').addEventListener('paste', (e) => {
  e.preventDefault();
  const html = e.clipboardData.getData('text/html');
  const text = e.clipboardData.getData('text/plain');
  if (html) document.execCommand('insertHTML', false, cleanPasteHtml(html));
  else if (text) document.execCommand('insertText', false, text.replace(/\r/g, ''));
});
function scheduleAuxSave() {
  clearTimeout(saveTimers.aux);
  saveTimers.aux = setTimeout(flushAux, 800);
}
function flushAux() {
  if (!auxDirty || !book) return;
  const kind = $('#aux-editor').dataset.kind;
  if (kind) window.neo.writeAux(book.id, kind, $('#aux-editor').innerHTML);
  auxDirty = false;
}

function renderDarlings() {
  const wrap = $('#darlings-list');
  wrap.innerHTML = '';
  if (darlings.length === 0) {
    wrap.innerHTML = `<div class="darlings-empty">${t('When a beautiful paragraph is gumming up the works, select it and drag it onto the Darlings tab below.')}<br>${t('It leaves your manuscript but it is never lost.')}</div>`;
    return;
  }
  for (const d of darlings) {
    const el = document.createElement('div');
    el.className = 'darling';
    const content = document.createElement('div');
    if (d.html) content.innerHTML = d.html;
    else content.textContent = d.text;
    const meta = document.createElement('div');
    meta.className = 'd-meta';
    const when = fmtDate(d.date);
    meta.innerHTML = `<span>${t('from {label} · {date} · {n} words', { label: d.chapterLabel, date: when, n: countWords(d.text) })}</span>
      <span><button class="d-restore">${t('Restore')}</button> <button class="d-del">${t('Delete forever')}</button></span>`;
    meta.querySelector('.d-restore').onclick = () => restoreDarling(d.id);
    meta.querySelector('.d-del').onclick = async () => {
      snapshotStructure('darling delete');
      // tidy up the invisible anchor the darling left behind
      const anchor = document.querySelector(`.darling-anchor[data-did="${d.id}"]`);
      if (anchor) {
        const body = anchor.closest('.chapter-body');
        const chId = anchor.closest('.chapter').dataset.id;
        anchor.remove();
        syncChapter(body, chId);
      }
      darlings = darlings.filter((x) => x.id !== d.id);
      await window.neo.writeJSON(book.id, 'darlings', darlings);
      renderDarlings();
    };
    el.appendChild(content);
    el.appendChild(meta);
    wrap.appendChild(el);
  }
}

async function restoreDarling(id) {
  const d = darlings.find((x) => x.id === id);
  if (!d) return;
  snapshotStructure('darling restore');
  switchTab('manuscript');

  // Preferred: put it back in the exact spot it was cut from, located by
  // the remembered text surrounding the cut point
  if (d.chapterId && book.chapterOrder.includes(d.chapterId)) {
    const body = document.querySelector(`.chapter[data-id="${d.chapterId}"] .chapter-body`);
    const pos = body ? findDarlingPosition(body, d) : -1;
    if (body && pos !== -1) {
      const at = textPosToRange(body, pos);
      if (at) {
        let scrollTo = at.startContainer.parentElement?.closest?.('p') || body;
        if (d.html && /<p[\s>]/i.test(d.html)) {
          // block content: paragraphs go back in after the host paragraph
          const holder = document.createElement('div');
          holder.innerHTML = d.html;
          let ref = scrollTo === body ? body.lastElementChild : scrollTo;
          scrollTo = holder.firstElementChild || scrollTo;
          for (const n of [...holder.childNodes]) { ref.after(n); ref = n; }
        } else {
          // inline content: slot it right where the caret was
          at.insertNode(document.createRange().createContextualFragment(d.html || d.text));
        }
        syncChapter(body, d.chapterId);
        darlings = darlings.filter((x) => x.id !== id);
        await window.neo.writeJSON(book.id, 'darlings', darlings);
        scrollTo.scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast(t('Darling restored to its original spot'));
        return;
      }
    }
  }

  // Fallback: the spot no longer exists — end of its chapter (or the last one)
  let chId = d.chapterId && book.chapterOrder.includes(d.chapterId)
    ? d.chapterId
    : book.chapterOrder[book.chapterOrder.length - 1];
  if (!chId) { newChapter(); chId = book.chapterOrder[0]; }
  const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  const frag = d.html ? d.html : '<p>' + d.text.replace(/\n+/g, '</p><p>') + '</p>';
  body.insertAdjacentHTML('beforeend', frag);
  chapterHTML[chId] = captureBody(body);
  scheduleChapterSave(chId);
  darlings = darlings.filter((x) => x.id !== id);
  await window.neo.writeJSON(book.id, 'darlings', darlings);
  focusChapter(chId);
  toast(t('Original spot is gone — restored to the end of {label}', { label: d.chapterLabel || t('the manuscript') }));
}

/* ================================================================== */
/*  COUNTERS                                                           */
/* ================================================================== */

function bookWordCount() {
  return book.chapterOrder.reduce((sum, chId) => sum + chapterWords(chId), 0);
}

function updateCounters() {
  if (!book) return;
  const total = bookWordCount();
  const wc = $('#word-counter');
  if (wordMode === 'book') {
    wc.textContent = t('{n} words', { n: total });
  } else {
    const n = currentChapterId ? chapterWords(currentChapterId) : 0;
    const idx = book.chapterOrder.indexOf(currentChapterId);
    wc.textContent = t('ch. {ch}: {n} words', { ch: idx + 1, n });
  }
  const pos = $('#pos-counter');
  const idx = book.chapterOrder.indexOf(currentChapterId);
  pos.textContent = book.chapterOrder.length <= 1
    ? '' // a chapterless story needs no chapter locator
    : (idx >= 0
      ? t('chapter {ch} of {total}', { ch: idx + 1, total: book.chapterOrder.length })
      : t('{n} chapters', { n: book.chapterOrder.length }));
  // cache for the bookshelf progress bar
  if (book.wordCount !== total) {
    // only a true crossing earns a painting — a story that was already long
    // before NEO could paint keeps its abstract until the writer asks
    const before = typeof book.wordCount === 'number' ? book.wordCount : total;
    book.wordCount = total;
    scheduleMetaSave();
    if (before < PAINT_AT && total >= PAINT_AT && !(library.coverArt && library.coverArt.auto === false) && paintable(book)) {
      requestPaint(book, bookPlainText());
    }
  }
  trackDailyWords(total);
}

// ---- daily word tracking + goal display ----
// The writing day follows the writer's own clock, and rolls over at
// library.dayEndsAt (0 = midnight) so a session that runs past midnight
// still counts toward the night it began.
function writingDay(d = new Date()) {
  d = new Date(d);
  if (d.getHours() < (library.dayEndsAt || 0)) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const todayStr = () => writingDay();

function trackDailyWords(total) {
  book.dailyCounts = book.dailyCounts || {};
  const today = todayStr();
  if (!book.dailyCounts[today]) {
    book.dailyCounts[today] = { start: total, end: total };
    scheduleMetaSave();
  } else if (book.dailyCounts[today].end !== total) {
    book.dailyCounts[today].end = total;
  }
  const wordsToday = book.dailyCounts[today].end - book.dailyCounts[today].start;
  const gc = $('#goal-counter');
  if (sprint && !sprint.done) {
    const sprintWords = total - sprint.startCount;
    gc.textContent = `⚡ ${fmtNum(sprintWords)} / ${fmtNum(sprint.target)}`;
    if (sprintWords >= sprint.target) {
      sprint.done = true;
      toast(t('Sprint complete — {n} words. Well earned.', { n: sprintWords }), 6000);
    }
  } else {
    const goal = library.dailyGoal || 0;
    gc.textContent = goal
      ? t('{n} / {goal} today', { n: wordsToday, goal })
      : t('{n} today', { n: wordsToday });
    gc.classList.toggle('goal-met', goal > 0 && wordsToday >= goal);
  }
}

$('#word-counter').onclick = () => {
  wordMode = wordMode === 'book' ? 'chapter' : 'book';
  updateCounters();
};

// select a passage → the counter reports its size
document.addEventListener('selectionchange', () => {
  if (!book || currentTab !== 'manuscript') return;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) {
    let el = sel.anchorNode;
    if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
    if (el && el.closest && el.closest('.chapter-body')) {
      const n = countWords(sel.toString());
      if (n > 0) {
        $('#word-counter').textContent = t('{n} selected', { n });
        return;
      }
    }
  }
  clearTimeout(saveTimers.selcount);
  saveTimers.selcount = setTimeout(() => { if (book) updateCounters(); }, 150);
});

// track which chapter you're scrolled to
$('#paper-scroll').addEventListener('scroll', () => {
  clearTimeout(saveTimers.scroll);
  saveTimers.scroll = setTimeout(() => {
    const mid = window.innerHeight * 0.4;
    let best = null;
    for (const sec of $$('.chapter')) {
      if (sec.getBoundingClientRect().top < mid) best = sec.dataset.id;
    }
    if (best && best !== currentChapterId) {
      currentChapterId = best;
      highlightNav();
      updateCounters();
    }
  }, 120);
});

/* ================================================================== */
/*  SAVING                                                             */
/* ================================================================== */

// One door for chapter writes, so NEO always knows what is on disk. That
// knowledge is what lets it write only what changed (a library shared over
// iCloud or Syncthing must not be re-written every twenty seconds) and, in
// refreshFromDisk, tell another device's edits from its own.
function persistChapter(chId, html) {
  if (!book) return Promise.resolve(false);
  if (html === undefined) html = chapterHTML[chId] || '';
  savedHTML[chId] = html;
  return window.neo.writeChapter(book.id, chId, html);
}

function scheduleChapterSave(chId) {
  clearTimeout(saveTimers[chId]);
  saveTimers[chId] = setTimeout(() => {
    if (!book) return; // the book closed before the timer fired; flushAllSaves already wrote it
    persistChapter(chId);
  }, 800);
}

// book.json minus the parts every device changes constantly, and minus
// empty defaults (NEO fills in chapterTitles: {} and friends after opening;
// the file on disk may not have them yet — same book either way)
function metaSig(m) {
  if (!m) return '';
  const c = {};
  for (const k of Object.keys(m).sort()) {
    if (k === 'lastPosition' || k === 'modified' || k === 'wordCount' || k === 'dailyCounts') continue; // bookkeeping, not the book
    const v = m[k];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'object' && Object.keys(v).length === 0) continue;
    c[k] = v;
  }
  return JSON.stringify(c);
}

function scheduleMetaSave() {
  clearTimeout(saveTimers.meta);
  saveTimers.meta = setTimeout(saveMeta, 800);
}
async function saveMeta() {
  if (!book) return;
  const sig = metaSig(book);
  const stamp = await window.neo.writeBookMeta(book.id, book);
  if (book && typeof stamp === 'string') book.modified = stamp;
  savedMetaSig = sig;
}

function flushAllSaves() {
  if (!book) return;
  // remember where you were for next session
  const pos = { chapterId: currentChapterId, scroll: $('#paper-scroll').scrollTop };
  const moved = !book.lastPosition || book.lastPosition.chapterId !== pos.chapterId ||
    Math.abs((book.lastPosition.scroll || 0) - pos.scroll) > 40;
  book.lastPosition = pos;
  for (const chId of book.chapterOrder) {
    if (chapterHTML[chId] !== undefined && chapterHTML[chId] !== savedHTML[chId]) {
      persistChapter(chId);
    }
  }
  flushAux();
  if (moved || metaSig(book) !== savedMetaSig) saveMeta();
}

/* ================================================================== */
/*  REFRESH — picking up what another device wrote                     */
/*  A library shared over iCloud or Syncthing changes underneath NEO.  */
/*  Whenever NEO comes back into view it looks again: a chapter that   */
/*  changed on disk and not here is simply adopted; one that changed   */
/*  in both places keeps the local text on the page and lands the      */
/*  other device's version in a new chapter right after it, so that    */
/*  nothing is ever lost quietly.                                      */
/* ================================================================== */

let refreshing = false;
async function refreshFromDisk() {
  if (refreshing) return;
  refreshing = true;
  bookMetaCache.clear(); // whatever another device wrote, the next redraw reads
  try {
    if (!book) {
      if (library && !$('#bookshelf-view').hidden) {
        const lib = await window.neo.readLibrary();
        if (lib && lib.firstRunDone && JSON.stringify(lib) !== JSON.stringify(library)) {
          library = lib;
          const shelf = $('#bookshelf-view');
          const keep = shelf.scrollTop;
          await renderShelves();
          shelf.scrollTop = keep;
        }
      }
      return;
    }
    const bookId = book.id;
    if (window.neo.refreshBook) await window.neo.refreshBook(bookId);
    const meta = await window.neo.readBookMeta(bookId);
    if (!book || book.id !== bookId || !meta) return;
    const localDirty = book.chapterOrder.some((c) => chapterHTML[c] !== savedHTML[c]) ||
      metaSig(book) !== savedMetaSig;
    if (metaSig(meta) !== savedMetaSig) {
      if (localDirty) return; // both sides restructured; ours stands, next save wins
      // the other device added, renamed or moved chapters: reopen in place
      const pos = { chapterId: currentChapterId, scroll: $('#paper-scroll').scrollTop };
      const tab = currentTab;
      await openBook(bookId);
      if (tab !== 'manuscript') switchTab(tab);
      requestAnimationFrame(() => {
        if (pos.chapterId && book && book.chapterOrder.includes(pos.chapterId)) currentChapterId = pos.chapterId;
        $('#paper-scroll').scrollTop = pos.scroll;
        highlightNav();
      });
      toast(t('Updated from your other device'));
      return;
    }
    let adopted = 0;
    let conflicts = 0;
    // file times first, so only chapters that changed on disk are re-read
    // (a whole novel crossing the bridge every half minute is a hiccup)
    let stamps = null;
    if (window.neo.chapterStamps) {
      try { stamps = await window.neo.chapterStamps(bookId); } catch { stamps = null; }
      if (!book || book.id !== bookId) return;
    }
    for (const chId of [...book.chapterOrder]) {
      if (stamps) {
        const st = stamps[chId];
        if (st !== undefined && st === diskStamps[chId]) continue;
        diskStamps[chId] = st;
      }
      const disk = await window.neo.readChapter(bookId, chId);
      if (!book || book.id !== bookId) return;
      if (typeof disk !== 'string' || disk === savedHTML[chId]) continue;
      if (disk === '' && savedHTML[chId]) continue; // unreadable or still downloading: not a change
      if (chapterHTML[chId] === savedHTML[chId]) {
        chapterHTML[chId] = disk;
        savedHTML[chId] = disk;
        wordCache[chId] = null;
        adopted++;
      } else {
        savedHTML[chId] = disk; // what's on disk now; our text goes over it on the next save
        const idx = book.chapterOrder.indexOf(chId);
        const twinId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
        book.chapterOrder.splice(idx + 1, 0, twinId);
        book.chapterTitles = book.chapterTitles || {};
        const when = new Date().toLocaleTimeString(NeoI18n.getLocale(), { hour: 'numeric', minute: '2-digit' });
        book.chapterTitles[twinId] = ((book.chapterTitles[chId] || '') + ' ' + t('from other device, {time}', { time: when })).trim();
        chapterHTML[twinId] = disk;
        persistChapter(twinId, disk);
        persistChapter(chId);
        scheduleMetaSave();
        conflicts++;
      }
    }
    if (adopted || conflicts) {
      const caret = captureCaret();
      const keepScroll = $('#paper-scroll').scrollTop;
      renderChapters();
      $('#paper-scroll').scrollTop = keepScroll;
      if (caret) restoreCaret(caret);
      updateCounters();
      scheduleNavRefresh();
      if (conflicts) toast(t('This chapter also changed on another device. That version is saved as the chapter after it.'), 8000);
      else toast(t('Updated from your other device'));
    }
  } catch (err) {
    console.error(err);
  } finally {
    refreshing = false;
  }
}
window.addEventListener('focus', () => setTimeout(refreshFromDisk, 300));
// and a quiet look every half minute while NEO is on screen, for the writer
// who left both machines open
setInterval(() => { if (document.visibilityState === 'visible') refreshFromDisk(); }, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') setTimeout(refreshFromDisk, 300);
  else if (book) flushAllSaves(); // iOS may end a backgrounded app without warning
});

window.addEventListener('beforeunload', flushAllSaves);
// flush whenever focus leaves NEO, and every 20 seconds
window.addEventListener('blur', () => { if (book) flushAllSaves(); });
setInterval(() => { if (book) flushAllSaves(); }, 20000);

async function backToShelf() {
  flushAllSaves();
  tabPlaces = {};
  book = null;
  currentChapterId = null;
  undoStack = [];
  $('#editor-view').hidden = true;
  $('#bookshelf-view').hidden = false;
  renderShelves();
}
$('#back-to-shelf').onclick = backToShelf;

/* ================================================================== */
/*  STRUCTURAL UNDO                                                    */
/*  Typing has the native ⌘Z. This covers the big moves — chapter      */
/*  deletes, replace-all, darlings — with snapshots of the whole       */
/*  structure.                                                         */
/* ================================================================== */

let undoStack = [];

// remember where the caret is — paragraph number plus offset within that
// paragraph, so even a caret in an EMPTY paragraph has an exact address
function captureCaret() {
  try {
    const sel = window.getSelection();
    if (!sel.rangeCount || currentTab !== 'manuscript') return null;
    const r = sel.getRangeAt(0);
    let el = r.startContainer;
    if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
    const bodyEl = el && el.closest ? el.closest('.chapter-body') : null;
    if (!bodyEl) return null;
    const blk = el.closest('p');
    const ps = [...bodyEl.querySelectorAll('p')];
    let off = 0;
    if (blk) {
      const pre = document.createRange();
      pre.selectNodeContents(blk);
      pre.setEnd(r.startContainer, r.startOffset);
      off = pre.toString().length;
    }
    return {
      chId: bodyEl.closest('.chapter').dataset.id,
      pIdx: blk ? ps.indexOf(blk) : 0, // container-level caret: treat as chapter start
      off,
      scroll: $('#paper-scroll').scrollTop
    };
  } catch { return null; }
}

function restoreCaret(caret) {
  if (!caret) return;
  const bodyEl = document.querySelector(`.chapter[data-id="${caret.chId}"] .chapter-body`);
  if (!bodyEl) return;
  bodyEl.focus({ preventScroll: true });
  const sel = window.getSelection();
  const finish = () => {
    currentChapterId = caret.chId;
    if (typeof caret.scroll === 'number') $('#paper-scroll').scrollTop = caret.scroll;
  };
  const ps = [...bodyEl.querySelectorAll('p')];
  const blk = ps[caret.pIdx] || ps[ps.length - 1];
  if (!blk) { finish(); return; }
  const w = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
  let pos = 0, n;
  while ((n = w.nextNode())) {
    if (caret.off <= pos + n.data.length) {
      const r = document.createRange();
      r.setStart(n, caret.off - pos);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      finish();
      return;
    }
    pos += n.data.length;
  }
  // empty paragraph, or offset past its end
  const r = document.createRange();
  r.selectNodeContents(blk);
  r.collapse(caret.off === 0);
  sel.removeAllRanges();
  sel.addRange(r);
  finish();
}

// The engine's undo history must never replay against a document NEO has
// rearranged by hand — clear it whenever such a rearrangement happens.
function resetNativeUndo() {
  const caret = captureCaret();
  if (!caret) return;
  const bodyEl = document.querySelector(`.chapter[data-id="${caret.chId}"] .chapter-body`);
  if (!bodyEl) return;
  bodyEl.contentEditable = 'false';
  bodyEl.contentEditable = 'true';
  restoreCaret(caret);
}

function snapshotStructure(label, opts) {
  if (!book) return;
  undoStack.push({
    label,
    rejoin: !!(opts && opts.rejoin),
    caret: captureCaret(),
    chapterOrder: [...book.chapterOrder],
    chapterHTML: { ...chapterHTML },
    chapterTitles: { ...(book.chapterTitles || {}) },
    chapterNotes: { ...(book.chapterNotes || {}) },
    sectionNotes: JSON.parse(JSON.stringify(book.sectionNotes || {})),
    darlings: JSON.parse(JSON.stringify(darlings)),
    stickies: JSON.parse(JSON.stringify(stickies))
  });
  if (undoStack.length > 10) undoStack.shift();
}

async function structuralUndo() {
  const snap = undoStack.pop();
  if (!snap || !book) return;
  book.chapterOrder = snap.chapterOrder;
  chapterHTML = snap.chapterHTML;
  book.chapterTitles = snap.chapterTitles;
  book.chapterNotes = snap.chapterNotes;
  book.sectionNotes = snap.sectionNotes;
  darlings = snap.darlings;
  stickies = snap.stickies;
  // resurrect any chapter files the action may have deleted
  for (const chId of book.chapterOrder) {
    await persistChapter(chId, chapterHTML[chId] || '<p><br></p>');
  }
  await window.neo.writeJSON(book.id, 'darlings', darlings);
  await window.neo.writeJSON(book.id, 'stickies', stickies);
  await saveMeta();
  currentChapterId = book.chapterOrder.includes(currentChapterId) ? currentChapterId : null;
  renderChapters();
  renderStickies();
  if (currentTab === 'darlings') renderDarlings();
  if (currentTab === 'outline') renderOutline();
  updateCounters();
  restoreCaret(snap.caret); // back to work, no announcement
  if (snap.rejoin) rejoinAtCaret();
  resetNativeUndo();
}

// after undoing a double-Enter break, close the split the gesture made:
// the caret's paragraph flows back into the one above it
function rejoinAtCaret() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let el = sel.anchorNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const blk = el && el.closest ? el.closest('p') : null;
  const body = blk && blk.closest('.chapter-body');
  if (!blk || !body) return;
  const prev = blk.previousElementSibling;
  if (!prev || prev.tagName !== 'P') return;
  if (prev.classList.contains('scene-break') || blk.classList.contains('scene-break')) return;
  if (prev.classList.contains('poetry') !== blk.classList.contains('poetry')) return;
  const chId = body.closest('.chapter').dataset.id;
  const at = prev.textContent.length;
  if (blk.textContent.trim() === '') {
    blk.remove();
  } else {
    for (const junk of blk.querySelectorAll('br')) junk.remove();
    for (const junk of prev.querySelectorAll('br')) junk.remove(); // an empty line's placeholder must not survive the merge
    while (blk.firstChild) prev.appendChild(blk.firstChild);
    blk.remove();
    try { prev.normalize(); } catch { /* fine */ }
  }
  // caret lands at the healed seam
  const w = document.createTreeWalker(prev, NodeFilter.SHOW_TEXT);
  let pos = 0, n, placed = false;
  while ((n = w.nextNode())) {
    if (at <= pos + n.data.length) {
      const r = document.createRange();
      r.setStart(n, at - pos);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      placed = true;
      break;
    }
    pos += n.data.length;
  }
  if (!placed) {
    const r = document.createRange();
    r.selectNodeContents(prev);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  syncChapter(body, chId);
}

document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
  if ($('#editor-view').hidden || !book || !undoStack.length) return;
  const ae = document.activeElement;
  // inside text, ⌘Z belongs to typing; outside it, it belongs to structure
  if (ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
  e.preventDefault();
  structuralUndo();
});

/* ================================================================== */
/*  FIND & REPLACE                                                     */
/* ================================================================== */

let searchState = { matches: [], idx: -1, query: '' };

function openSearch() {
  if ($('#editor-view').hidden || !book) { toast(t('Open a book first')); return; }
  switchTab('manuscript');
  const sel = window.getSelection();
  const preset = sel && !sel.isCollapsed ? sel.toString().slice(0, 80).trim() : '';
  $('#searchbar').hidden = false;
  const inp = $('#search-input');
  if (preset) inp.value = preset;
  inp.focus();
  inp.select();
  runSearch();
}

function closeSearch() {
  $('#searchbar').hidden = true;
  searchState = { matches: [], idx: -1, query: '' };
  if (window.CSS && CSS.highlights) {
    CSS.highlights.delete('neo-search');
    CSS.highlights.delete('neo-search-current');
  }
}

function paintHighlights() {
  if (!window.Highlight || !window.CSS || !CSS.highlights) return;
  const all = new Highlight();
  const cur = new Highlight();
  searchState.matches.forEach((m, i) => {
    (i === searchState.idx ? cur : all).add(m.range);
  });
  CSS.highlights.set('neo-search', all);
  CSS.highlights.set('neo-search-current', cur);
}

// Scan the WHOLE book, first chapter to last, every time.
// Matches are highlighted, not selected.
function runSearch() {
  const q = $('#search-input').value;
  searchState = { matches: [], idx: -1, query: q };
  if (!q) {
    $('#search-count').textContent = '';
    paintHighlights();
    return;
  }
  const ql = q.toLowerCase();
  for (const chId of book.chapterOrder) {
    const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
    if (!body) continue;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const tl = node.textContent.toLowerCase();
      let pos = 0;
      while ((pos = tl.indexOf(ql, pos)) !== -1) {
        const range = document.createRange();
        range.setStart(node, pos);
        range.setEnd(node, pos + q.length);
        searchState.matches.push({ range });
        pos += q.length;
      }
    }
  }
  const n = searchState.matches.length;
  $('#search-count').textContent = n ? `${n} found` : 'none';
  paintHighlights();
}

// only runs when the user asks (Enter / arrows)
function gotoMatch(i) {
  const m = searchState.matches;
  if (!m.length) return;
  searchState.idx = ((i % m.length) + m.length) % m.length;
  paintHighlights();
  try {
    const rect = m[searchState.idx].range.getBoundingClientRect();
    $('#paper-scroll').scrollTop += rect.top - window.innerHeight * 0.45;
  } catch { /* range collapsed by an edit; next search rebuilds */ }
  $('#search-count').textContent = t('{i} of {n}', { i: searchState.idx + 1, n: m.length });
}

function freshSearchIfStale() {
  if (searchState.query !== $('#search-input').value) runSearch();
}

function replaceCurrent() {
  freshSearchIfStale();
  if (!searchState.matches.length) { toast(t('No matches')); return; }
  if (searchState.idx < 0) searchState.idx = 0; // start from the very first match
  const m = searchState.matches[searchState.idx];
  const rep = $('#replace-input').value;
  let chapter = null;
  try {
    chapter = m.range.startContainer.parentElement.closest('.chapter');
    m.range.deleteContents();
    if (rep) m.range.insertNode(document.createTextNode(rep));
  } catch {
    runSearch();
    return;
  }
  if (chapter) syncChapter(chapter.querySelector('.chapter-body'), chapter.dataset.id);
  const oldIdx = searchState.idx;
  runSearch();
  if (searchState.matches.length) gotoMatch(Math.min(oldIdx, searchState.matches.length - 1));
}

// Every chapter, front to back
function replaceAllMatches() {
  const q = $('#search-input').value;
  if (!q) return;
  snapshotStructure('replace all');
  const rep = $('#replace-input').value;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  let n = 0;
  for (const chId of book.chapterOrder) {
    const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
    if (!body) continue;
    const nodes = [];
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    let touched = false;
    for (const nd of nodes) {
      if (nd.textContent.toLowerCase().includes(q.toLowerCase())) {
        nd.textContent = nd.textContent.replace(re, () => { n++; return rep; });
        touched = true;
      }
    }
    if (touched) syncChapter(body, chId);
  }
  if (n === 0) undoStack.pop(); // nothing changed, nothing to undo
  toast(n ? t('{n} replaced across the whole book — {key} to undo', { n, key: KZ }) : t('0 replaced'));
  runSearch();
}

$('#search-input').addEventListener('input', () => {
  clearTimeout(saveTimers.search);
  saveTimers.search = setTimeout(runSearch, 250);
});
$('#search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); freshSearchIfStale(); gotoMatch(searchState.idx + (e.shiftKey ? -1 : 1)); }
  if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); }
  if (e.key === 'Tab' && !e.shiftKey) {
    const m = searchState.matches[Math.max(0, searchState.idx)];
    if (m) {
      e.preventDefault();
      const sel = window.getSelection();
      const r = m.range.cloneRange();
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
      const body = m.range.startContainer.parentElement.closest('.chapter-body');
      if (body) body.focus();
    }
  }
});
$('#replace-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(); }
  if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); }
});
$('#search-next').onclick = () => { freshSearchIfStale(); gotoMatch(searchState.idx + 1); };
$('#search-prev').onclick = () => { freshSearchIfStale(); gotoMatch(searchState.idx - 1); };
$('#replace-one').onclick = replaceCurrent;
$('#replace-all').onclick = replaceAllMatches;
$('#search-close').onclick = closeSearch;

/* ================================================================== */
/*  IMPORT                                                             */
/* ================================================================== */

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Turn parsed manuscripts into books on a shelf — used by the file picker
// and by dropping files from Finder straight onto a shelf.
async function addImportedBooks(results, shelf) {
  shelf = shelf || shelvesFor(currentAuthor().id)[0] || library.shelves[0];
  let ok = 0;
  for (const r of results) {
    if (r.error) { toast(t('Couldn’t import {name}: {error}', { name: r.name, error: r.error }), 6000); continue; }
    // title/byline harvested from the document beat the filename;
    // passing the title in gives the book folder a readable name too
    const meta = await window.neo.createBook({
      author: r.author || displayAuthor(),
      title: r.title || r.name
    });
    meta.title = r.title || r.name;
    meta.tabNames = {
      notes: (library.tabDefaults && library.tabDefaults.notes) || 'Notes',
      outline: (library.tabDefaults && library.tabDefaults.outline) || 'Outline'
    };
    let words = 0;
    meta.chapterTitles = {};
    for (const ch of r.chapters) {
      const chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      const html = ch.paras.map((p) => {
        if (p.scene) return '<p class="scene-break">***</p>';
        let text = escHtml(p.text || '');
        text = text.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
                   .replace(/\*([^*]+)\*/g, '<i>$1</i>')
                   .replace(/_([^_]+)_/g, '<i>$1</i>');
        return `<p>${text}</p>`;
      }).join('') || '<p><br></p>';
      await window.neo.writeChapter(meta.id, chId, html);
      if (ch.title) meta.chapterTitles[chId] = ch.title;
      meta.chapterOrder.push(chId);
      for (const p of ch.paras) words += countWords(p.text || '');
    }
    meta.wordCount = words;
    await window.neo.writeBookMeta(meta.id, meta);
    shelf.bookIds.push(meta.id);
    ok++;
  }
  await window.neo.writeLibrary(library);
  if (!$('#bookshelf-view').hidden) renderShelves();
  if (ok) toast(t('{n} books imported onto “{shelf}” — chapters and scene breaks detected', { n: ok, shelf: shelf.name }), 6000);
}

async function importBooks() {
  const results = await window.neo.importPick();
  if (results.length) await addImportedBooks(results, shelvesFor(currentAuthor().id)[0] || library.shelves[0]);
}

$('#import-btn').onclick = importBooks;

/* ================================================================== */
/*  SPELLCHECK PASS + TYPEWRITER SCROLLING                             */
/* ================================================================== */

/* NEO's own spellcheck pass: a bundled dictionary (via the main process),
   squiggles painted with the CSS Highlight API — the same machinery as
   search — and a right-click menu for suggestions. Chapters scan lazily
   as the caret reaches them. */
let spellOn = false;
let spellScanned = new Set();
let spellRanges = new Map();     // key → [Range]
const spellCache = new Map();    // word → correct?

const spellNorm = (w) => w.replace(/’/g, "'").replace(/^'+|'+$/g, '');

function spellElFor(key) {
  return key.startsWith('aux-')
    ? $('#aux-editor')
    : document.querySelector(`.chapter[data-id="${key}"] .chapter-body`);
}

async function spellScanEl(el, key) {
  if (!el || !spellOn) return;
  spellScanned.add(key);
  const occurrences = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  // letters of any alphabet, with their accents, so French and German
  // words reach the dictionary whole
  const re = /[\p{L}\p{M}'’]+/gu;
  let n;
  while ((n = walker.nextNode())) {
    const p = n.parentElement;
    if (p && p.closest('.scene-break, .ghost, .ph-mark')) continue;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(n.data))) {
      const word = spellNorm(m[0]);
      if (word.length < 2) continue;
      if (/^[\p{Lu}'’]+$/u.test(m[0])) continue; // acronyms and shouting are legal
      occurrences.push({ node: n, start: m.index, end: m.index + m[0].length, word });
    }
  }
  const unknown = [...new Set(occurrences.map((o) => o.word))].filter((w) => !spellCache.has(w));
  if (unknown.length) {
    const res = await window.neo.spellCheckWords(unknown);
    for (const w of unknown) spellCache.set(w, res[w] !== false);
  }
  if (!spellOn) return; // toggled off while we were checking
  const ranges = [];
  for (const o of occurrences) {
    if (spellCache.get(o.word) || !o.node.isConnected) continue;
    try {
      const r = new Range();
      r.setStart(o.node, o.start);
      r.setEnd(o.node, o.end);
      ranges.push(r);
    } catch { /* node changed underneath us */ }
  }
  spellRanges.set(key, ranges);
  rebuildSpellHighlight();
}

function rebuildSpellHighlight() {
  if (!spellOn) return;
  const hl = new Highlight();
  for (const list of spellRanges.values()) for (const r of list) hl.add(r);
  CSS.highlights.set('neo-spell', hl);
}

function scanSpellingIn(el, key) {
  if (!el || spellScanned.has(key)) return;
  spellScanEl(el, key);
}

// scan wherever the writer currently is
function scanSpellingHere() {
  if (currentTab === 'manuscript') {
    const body = currentChapterId && spellElFor(currentChapterId);
    if (body) scanSpellingIn(body, currentChapterId);
  } else {
    scanSpellingIn($('#aux-editor'), 'aux-' + ($('#aux-editor').dataset.kind || 'notes'));
  }
}

function scheduleSpellRescan(key, el) {
  clearTimeout(saveTimers['sp-' + key]);
  saveTimers['sp-' + key] = setTimeout(() => { if (spellOn) spellScanEl(el, key); }, 600);
}

function toggleSpellcheck() {
  spellOn = !spellOn;
  if (spellOn) {
    spellScanned = new Set();
    spellRanges = new Map();
    scanSpellingHere();
  } else {
    CSS.highlights.delete('neo-spell');
    spellRanges = new Map();
    document.querySelector('.spell-menu')?.remove();
  }
  toast(spellOn ? t('Spellcheck on') : t('Spellcheck off'));
}

// Edit → Spellcheck Language: swap the dictionary, remember the choice with
// the library, and re-check whatever is on screen
const SPELL_LANGUAGE_NAMES = {
  'en-US': t('US English'), 'en-GB': t('UK English'), 'en-CA': t('Canadian English'),
  'en-AU': t('Australian English'), fr: t('French'), es: t('Spanish'), de: t('German'),
  nl: t('Dutch'), pl: t('Polish')
};
async function changeSpellLanguage(code) {
  const ok = await window.neo.setSpellLanguage(code);
  if (!ok) { toast(t('That dictionary would not load')); return; }
  library.spellLanguage = code;
  await window.neo.writeLibrary(library);
  spellCache.clear();
  if (spellOn) {
    spellScanned = new Set();
    spellRanges = new Map();
    CSS.highlights.delete('neo-spell');
    scanSpellingHere();
  }
  toast(t('Spellcheck: {lang}', { lang: SPELL_LANGUAGE_NAMES[code] || code }));
}

// right-click a flagged word for suggestions
document.addEventListener('contextmenu', async (e) => {
  if (!spellOn) return;
  const editor = e.target.closest && e.target.closest('.chapter-body, #aux-editor');
  if (!editor) return;
  const pos = document.caretRangeFromPoint(e.clientX, e.clientY);
  if (!pos || pos.startContainer.nodeType !== Node.TEXT_NODE) return;
  const node = pos.startContainer;
  const text = node.data;
  const isW = (c) => /[\p{L}\p{M}'’]/u.test(c);
  let a = pos.startOffset, b = pos.startOffset;
  while (a > 0 && isW(text[a - 1])) a--;
  while (b < text.length && isW(text[b])) b++;
  if (a === b) return;
  const word = spellNorm(text.slice(a, b));
  if (spellCache.get(word) !== false) return; // only flagged words get our menu
  e.preventDefault();
  const chEl = editor.closest ? editor.closest('.chapter') : null;
  const key = editor.id === 'aux-editor'
    ? 'aux-' + (editor.dataset.kind || 'notes')
    : (chEl ? chEl.dataset.id : null);
  const sugg = await window.neo.spellSuggest(word);
  showSpellMenu(e.clientX, e.clientY, word, sugg, {
    replace: (s) => {
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(node, a); r.setEnd(node, b);
      sel.removeAllRanges(); sel.addRange(r);
      document.execCommand('insertText', false, s);
      if (key) spellScanEl(spellElFor(key), key);
    },
    learn: async () => {
      library.customWords = library.customWords || [];
      if (!library.customWords.includes(word)) library.customWords.push(word);
      await window.neo.writeLibrary(library);
      await window.neo.spellLearn(word);
      spellCache.set(word, true);
      for (const k of [...spellScanned]) spellScanEl(spellElFor(k), k);
    }
  });
});

function showSpellMenu(x, y, word, suggestions, actions) {
  document.querySelector('.spell-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'spell-menu';
  if (suggestions.length) {
    for (const s of suggestions) {
      const btn = document.createElement('button');
      btn.textContent = s;
      btn.onclick = () => { menu.remove(); actions.replace(s); };
      menu.appendChild(btn);
    }
  } else {
    const none = document.createElement('button');
    none.textContent = t('No suggestions');
    none.disabled = true;
    menu.appendChild(none);
  }
  const sep = document.createElement('div');
  sep.className = 'sm-sep';
  menu.appendChild(sep);
  const learn = document.createElement('button');
  learn.textContent = t('Add “{word}” to dictionary', { word });
  learn.onclick = () => { menu.remove(); actions.learn(); };
  menu.appendChild(learn);
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - r.width - 10) + 'px';
  menu.style.top = Math.min(y + 4, window.innerHeight - r.height - 10) + 'px';
  const close = (ev) => {
    if (menu.contains(ev.target)) return;
    menu.remove();
    document.removeEventListener('mousedown', close, true);
  };
  document.addEventListener('mousedown', close, true);
}

let typewriterEnabled = false;
// The page needs empty room beneath its last line, or the caret can't be held
// at the centre once the end of the draft scrolls into view (body.typewriter
// deepens #paper's bottom margin; see styles.css).
function applyTypewriter() {
  document.body.classList.toggle('typewriter', typewriterEnabled);
  if (window.neo.typewriterState) window.neo.typewriterState(typewriterEnabled); // the Format menu's tick
}
function toggleTypewriter() {
  typewriterEnabled = !typewriterEnabled;
  library.typewriter = typewriterEnabled;
  window.neo.writeLibrary(library);
  applyTypewriter();
  toast(typewriterEnabled ? t('Typewriter scrolling ON — your line stays centered') : t('Typewriter scrolling off'));
}


// The page follows the caret only while the writer is typing or moving by
// keyboard: a click to think about a sentence leaves the screen exactly as
// it was. The caret has a band of a few lines to move in before the page
// glides (not snaps) to bring it back to the writing height.
let typewriterByKeyboard = false;
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = e.target;
  if (el && el.closest && el.closest('.chapter-body')) typewriterByKeyboard = true;
}, true);
document.addEventListener('mousedown', () => { typewriterByKeyboard = false; }, true);

document.addEventListener('selectionchange', () => {
  if (!typewriterEnabled || !book || currentTab !== 'manuscript' || !typewriterByKeyboard) return;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return;
  let el = sel.anchorNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  if (!el || !el.closest || !el.closest('.chapter-body')) return;
  requestAnimationFrame(() => {
    try {
      let rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect || (rect.top === 0 && rect.height === 0)) rect = el.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 30;
      const diff = rect.top - window.innerHeight * 0.45;
      // a band of about three lines around the writing height
      if (Math.abs(diff) <= lineHeight * 1.5) return;
      const scroller = $('#paper-scroll');
      scroller.scrollTo({ top: scroller.scrollTop + diff, behavior: 'smooth' });
    } catch { /* selection mid-mutation; skip this frame */ }
  });
});

/* ================================================================== */
/*  FOCUS MODE: dim everything but the sentence or paragraph           */
/* ================================================================== */
// Painted with the CSS Custom Highlight API (like search and spellcheck),
// so the manuscript DOM is never touched and nothing leaks into saved HTML.
// also the order ⌘⇧O steps through: off → paragraph → sentence → off
const FOCUS_LEVELS = ['off', 'paragraph', 'sentence'];
const FOCUS_LABELS = { off: tk('Focus mode off'), sentence: tk('Focus: sentence'), paragraph: tk('Focus: paragraph') };
let focusLevel = 'off';

// the View menu's ticks (focus level, page, brighter interface) follow the page
function reportViewState() {
  if (!window.neo.viewState || !library) return;
  window.neo.viewState({ focus: focusLevel, pageTheme: library.pageTheme || 'night', uiBright: !!library.uiBright });
}

function applyFocus() {
  reportViewState();
  document.body.classList.toggle('focus-mode', focusLevel !== 'off');
  if (focusLevel === 'off') {
    if (window.CSS && CSS.highlights) CSS.highlights.delete('neo-focus');
  } else updateFocus();
}
function setFocus(level) {
  if (!FOCUS_LEVELS.includes(level)) return;
  focusLevel = level;
  library.focus = level;
  window.neo.writeLibrary(library);
  applyFocus();
  toast(t(FOCUS_LABELS[level] || ''));
}
function cycleFocus() { setFocus(FOCUS_LEVELS[(FOCUS_LEVELS.indexOf(focusLevel) + 1) % FOCUS_LEVELS.length]); }

// the paragraph (direct <p> child of a chapter body) holding the caret
function focusParagraph() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  let el = sel.focusNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  if (!el || !el.closest) return null;
  const body = el.closest('.chapter-body');
  if (!body) return null;
  let p = el;
  while (p && p.parentElement !== body) p = p.parentElement;
  return p && p.tagName === 'P' ? p : null;
}

// caret position as a character offset into p.textContent
function caretOffsetIn(p) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(p);
  try { r.setEnd(sel.focusNode, sel.focusOffset); } catch { return 0; }
  return r.toString().length;
}

// character offsets within p → a DOM Range over its text nodes
function rangeFromOffsets(p, start, end) {
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  let pos = 0, n, startSet = false;
  while ((n = walker.nextNode())) {
    const len = n.textContent.length;
    if (!startSet && start <= pos + len) { r.setStart(n, start - pos); startSet = true; }
    if (startSet && end <= pos + len) { r.setEnd(n, end - pos); return r; }
    pos += len;
  }
  if (!startSet) return null;
  r.setEndAfter(p.lastChild || p);
  return r;
}

let focusSegmenter = null;
function sentenceRange(p) {
  const text = p.textContent;
  if (!text.trim()) return null;
  const at = caretOffsetIn(p);
  if (!focusSegmenter && window.Intl && Intl.Segmenter) {
    focusSegmenter = new Intl.Segmenter((library.spellLanguage || 'en').split('-')[0], { granularity: 'sentence' });
  }
  if (!focusSegmenter) return null;
  let hit = null, last = null;
  for (const seg of focusSegmenter.segment(text)) {
    last = seg;
    // caret at the very end of a sentence still belongs to it
    if (at >= seg.index && at <= seg.index + seg.segment.length) { hit = seg; if (at < seg.index + seg.segment.length) break; }
  }
  hit = hit || last;
  // trim trailing whitespace so the highlight hugs the words
  const start = hit.index;
  const end = hit.index + hit.segment.replace(/\s+$/, '').length;
  return rangeFromOffsets(p, start, Math.max(end, start));
}

function updateFocus() {
  if (focusLevel === 'off' || !book || currentTab !== 'manuscript') return;
  if (!window.Highlight || !window.CSS || !CSS.highlights) return;
  const p = focusParagraph();
  if (!p) return;   // caret elsewhere (title, panels): keep the last focus
  let r = null;
  if (isBreakPara(p)) r = null;
  else if (focusLevel === 'sentence') r = sentenceRange(p);
  else if (focusLevel === 'paragraph') { r = document.createRange(); r.selectNodeContents(p); }
  if (r) CSS.highlights.set('neo-focus', new Highlight(r));
  else CSS.highlights.delete('neo-focus');
  // highlights can't reach ::first-letter, so the drop cap gets a class
  // on its chapter body (a class on the body itself is never saved)
  document.querySelectorAll('.chapter-body.focus-cap').forEach((b) => b.classList.remove('focus-cap'));
  const body = p.parentElement;
  const first = body.querySelector('p:not(.poetry)'); // the drop cap skips poetry paragraphs
  const firstText = first && document.createTreeWalker(first, NodeFilter.SHOW_TEXT).nextNode();
  if (r && firstText && r.comparePoint(firstText, 0) === 0) body.classList.add('focus-cap');
}
function isBreakPara(p) { return p.classList.contains('scene-break'); }

document.addEventListener('selectionchange', () => {
  if (focusLevel === 'off') return;
  requestAnimationFrame(() => { try { updateFocus(); } catch { /* mid-mutation */ } });
});
document.addEventListener('input', () => {
  if (focusLevel === 'off') return;
  requestAnimationFrame(() => { try { updateFocus(); } catch { /* mid-mutation */ } });
});

/* ================================================================== */
/*  GOALS, SPRINTS, AND THE CHART                                      */
/* ================================================================== */

let sprint = null;

function statsChartSvg() {
  const W = 520, H = 200, PAD = 6;
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(writingDay(d));
  }
  const counts = book.dailyCounts || {};
  const daily = days.map((d) => counts[d] ? Math.max(0, counts[d].end - counts[d].start) : 0);
  // cumulative: carry the last known total forward
  let last = 0;
  const firstKnown = days.find((d) => counts[d]);
  if (firstKnown) last = counts[firstKnown].start;
  const cumulative = days.map((d) => {
    if (counts[d]) last = counts[d].end;
    return last;
  });
  const goal = book.wordGoal || 0;
  const maxC = Math.max(...cumulative, goal, 1);
  const maxD = Math.max(...daily, library.dailyGoal || 0, 1);
  const bw = (W - PAD * 2) / 30;

  const bars = daily.map((v, i) => {
    const h = Math.round((v / maxD) * (H * 0.45));
    return `<rect x="${(PAD + i * bw).toFixed(1)}" y="${H - PAD - h}" width="${(bw - 2).toFixed(1)}" height="${h}" rx="1.5" fill="#3d5a4f"/>`;
  }).join('');
  const line = cumulative.map((v, i) => {
    const x = (PAD + i * bw + bw / 2).toFixed(1);
    const y = (H - PAD - (v / maxC) * (H - PAD * 2 - 20)).toFixed(1);
    return (i === 0 ? 'M' : 'L') + x + ',' + y;
  }).join(' ');
  const goalLine = goal
    ? `<line x1="${PAD}" x2="${W - PAD}" y1="${(H - PAD - (goal / maxC) * (H - PAD * 2 - 20)).toFixed(1)}" y2="${(H - PAD - (goal / maxC) * (H - PAD * 2 - 20)).toFixed(1)}" stroke="#c9a86a" stroke-dasharray="5,4" stroke-width="1" opacity="0.7"/>`
    : '';
  return `<svg id="stats-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    ${bars}
    <path d="${line}" fill="none" stroke="#c9a86a" stroke-width="2"/>
    ${goalLine}
  </svg>
  <div style="display:flex;justify-content:space-between;font-size:10px;color:#666;padding:2px 4px">
    <span>${t('30 days ago')}</span>
    <span style="color:#3d8a6a">▮ ${t('daily words')}</span>
    <span style="color:var(--accent)">— ${t('total')}${goal ? ' · - - ' + t('goal') : ''}</span>
    <span>${t('today')}</span>
  </div>`;
}

/* ================================================================== */
/*  COVER ART SETTINGS (File → Cover Art…)                             */
/* ================================================================== */

// One key per provider. The brief and the painting always come from the
// same provider, so a writer only ever needs one account.
const COVER_PROVIDERS = {
  openai: { name: 'OpenAI', keyHint: 'sk-…', where: tk('platform.openai.com → API keys'), text: 'gpt-5-mini', image: 'gpt-image-1-mini', quality: true, cost: tk('a few cents a picture'), base: 'https://api.openai.com/v1' }
};
// shown in the window, so translated when read
const providerWhere = (p) => t(p.where);
const providerCost = (p) => t(p.cost);
// Key formats change under us, so the only test is "one token, long enough" —
// the provider does the rest.
const looksLikeKey = (k) => /^\S{20,}$/.test(k);
const coverSettings = () => library.coverArt || {};
const coverProvider = () => (COVER_PROVIDERS[coverSettings().provider] ? coverSettings().provider : 'openai');

function openCoverArt() {
  const cs = coverSettings();
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  const provOptions = Object.entries(COVER_PROVIDERS).map(([id, p]) =>
    `<option value="${id}"${coverProvider() === id ? ' selected' : ''}>${p.name}</option>`).join('');
  bd.innerHTML = `
    <div class="modal" style="width:540px">
      <h2 style="font-size:17px">${t('Cover art')}</h2>
      <p>${t('Every book gets a cover on the shelf: an abstract with the title set in type. With an OpenAI key, NEO can also read a story once it passes {n} words and paint a cover from the text. Paintings stay on your shelf — exports never include them.', { n: PAINT_AT })}</p>
      <div class="stats-row">
        <select id="ca-provider" hidden>${provOptions}</select>
        <label class="st-check"><input id="ca-auto" type="checkbox"${cs.auto === false ? '' : ' checked'}/> ${t('paint at {n} words', { n: PAINT_AT })}</label>
      </div>
      <div class="stats-row st-covers">
        <label>${t('API key')} <input id="ca-key" type="password" autocomplete="off" spellcheck="false" style="width:300px"/></label>
      </div>
      <div class="stats-row st-covers">
        <label>${t('Endpoint')} <input id="ca-base" type="text" spellcheck="false" style="width:300px"/></label>
      </div>
      <p class="soft" id="ca-note" style="margin:-6px 0 12px;font-size:12px"></p>
      <details class="st-advanced">
        <summary class="soft">${t('Models')}</summary>
        <div class="stats-row">
          <label>${t('Brief')} <input id="ca-tmodel" type="text" spellcheck="false"/></label>
          <label>${t('Paint')} <input id="ca-imodel" type="text" spellcheck="false"/></label>
          <label id="ca-quality-wrap">${t('Quality')}
            <select id="ca-quality">
              ${['low', 'medium', 'high'].map((q) => `<option value="${q}"${(cs.quality || 'medium') === q ? ' selected' : ''}>${({ low: t('low'), medium: t('medium'), high: t('high') })[q]}</option>`).join('')}
            </select>
          </label>
        </div>
        <p class="soft" style="font-size:12px;margin:0 0 6px">${t('Leave blank for NEO’s defaults. Names drift; if a provider retires one, NEO tries its own list before giving up.')}</p>
      </details>
      <div style="text-align:right;margin-top:14px">
        <button class="m-cancel btn-quiet" style="margin-right:10px">${t('Cancel')}</button>
        <button class="m-ok btn-gold">${t('Save')}</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const sel = bd.querySelector('#ca-provider');
  const key = bd.querySelector('#ca-key');
  const note = bd.querySelector('#ca-note');
  const models = (cs.models || {});
  // per-provider fields: key placeholder, stored model overrides, quality
  const showProvider = async () => {
    const id = sel.value, p = COVER_PROVIDERS[id];
    const custom = (cs.endpoints && cs.endpoints[id]) || '';
    key.value = '';
    key.placeholder = t('{name} key ({hint})', { name: p.name, hint: p.keyHint });
    bd.querySelector('#ca-base').value = custom;
    bd.querySelector('#ca-base').placeholder = p.base;
    bd.querySelector('#ca-tmodel').value = (models[id] && models[id].text) || '';
    bd.querySelector('#ca-tmodel').placeholder = p.text;
    bd.querySelector('#ca-imodel').value = (models[id] && models[id].image) || '';
    bd.querySelector('#ca-imodel').placeholder = p.image;
    bd.querySelector('#ca-quality-wrap').style.display = p.quality ? '' : 'none';
    const has = await window.neo.hasSecret(id);
    if (sel.value !== id) return;
    note.textContent = has
      ? t('A {name} key is saved, encrypted, outside your library folder. Paste a new one to replace it, or type “{remove}” to forget it.', { name: p.name, remove: t('remove') })
        + (custom ? ' ' + t('Painting goes to the endpoint above, not OpenAI.') : '')
      : t('Get a key at {where} ({cost}). It’s stored encrypted on this computer and only ever sent to {name}.', { where: providerWhere(p), cost: providerCost(p), name: custom ? t('the endpoint above') : p.name });
  };
  sel.onchange = showProvider;
  showProvider();
  const done = () => bd.remove();
  bd.querySelector('.m-cancel').onclick = done;
  bd.querySelector('.m-ok').onclick = async () => {
    const id = sel.value, p = COVER_PROVIDERS[id];
    const k = key.value.trim();
    const base = bd.querySelector('#ca-base').value.trim().replace(/\/+$/, '');
    if (base && !/^https?:\/\/\S+$/i.test(base)) { toast(t('That endpoint doesn’t look like a URL — it should start with http:// or https://'), 6000); return; }
    if (k === 'remove' || k === t('remove')) await window.neo.setSecret(id, '');
    else if (k && !looksLikeKey(k)) { toast(t('That doesn’t look like an API key ({name} keys look like {hint}) — not saved', { name: p.name, hint: p.keyHint }), 6000); return; }
    else if (k) await window.neo.setSecret(id, k);
    models[id] = {
      text: bd.querySelector('#ca-tmodel').value.trim() || undefined,
      image: bd.querySelector('#ca-imodel').value.trim() || undefined
    };
    const endpoints = { ...(cs.endpoints || {}) };
    if (base) endpoints[id] = base; else delete endpoints[id];
    library.coverArt = {
      provider: id,
      auto: bd.querySelector('#ca-auto').checked,
      quality: bd.querySelector('#ca-quality').value,
      models,
      endpoints
    };
    await window.neo.writeLibrary(library);
    done();
    if (!(await window.neo.hasSecret(id))) toast(t('Saved. Add a {name} key to start painting.', { name: p.name }), 5000);
  };
  bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } });
  key.focus();
}

// An hour of the day as the writer's language says it: 1 am / 13 h / 13 Uhr
function hourLabel(h) {
  if (h === 0) return t('midnight');
  const loc = NeoI18n.getLocale();
  if (loc.startsWith('en')) {
    if (h === 12) return t('noon');
    return h < 12 ? t('{h} am', { h: String(h) }) : t('{h} pm', { h: String(h - 12) });
  }
  return new Intl.DateTimeFormat(loc, { hour: 'numeric' }).format(new Date(2000, 0, 1, h));
}

function openStats() {
  const hasBook = !!book;
  const today = hasBook ? (book.dailyCounts || {})[todayStr()] : null;
  const wordsToday = today ? today.end - today.start : 0;
  const total = hasBook ? bookWordCount() : 0;
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal" style="width:${hasBook ? 580 : 380}px">
      <h2 style="font-size:17px">${hasBook ? t('{title} — progress', { title: escHtml(book.title) }) : t('Goals')}</h2>
      ${hasBook ? `
      <div class="stats-nums">
        <div><div class="big">${fmtNum(total)}</div><div class="lbl">${t('total words')}</div></div>
        <div><div class="big">${fmtNum(wordsToday)}</div><div class="lbl">${t('today')}</div></div>
        <div><div class="big">${book.wordGoal ? Math.min(100, Math.round(total / book.wordGoal * 100)) + '%' : '—'}</div><div class="lbl">${t('of book goal')}</div></div>
      </div>
      ${statsChartSvg()}` : ''}
      <div class="stats-row stats-goals" style="margin-top:${hasBook ? 18 : 6}px">
        <label>${t('Daily goal')} <input id="st-daily" type="number" min="0" value="${library.dailyGoal || ''}" placeholder="500"/></label>
        ${hasBook ? `<label>${t('Book goal')} <input id="st-book" type="number" min="0" value="${book.wordGoal || ''}" placeholder="80000"/></label>` : ''}
      </div>
      <div class="stats-row stats-goals">
        <label>${t('Day ends at')}
          <select id="st-dayends">
            ${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${(library.dayEndsAt || 0) === h ? ' selected' : ''}>${hourLabel(h)}</option>`).join('')}
          </select>
        </label>
      </div>
      ${hasBook ? `
      <div class="stats-row">
        <label>${t('Sprint')} <input id="st-sprint" type="number" min="50" value="${sprint ? sprint.target : 500}"/> ${t('words')}</label>
        <button id="st-sprint-btn" class="btn-gold">${sprint && !sprint.done ? t('End sprint') : t('Start sprint')}</button>
      </div>` : ''}
      <div style="text-align:right;margin-top:14px">
        <button class="m-ok btn-gold">${t('Done')}</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = async () => {
    library.dailyGoal = parseInt(bd.querySelector('#st-daily').value, 10) || 0;
    library.dayEndsAt = parseInt(bd.querySelector('#st-dayends').value, 10) || 0;
    if (hasBook) {
      book.wordGoal = parseInt(bd.querySelector('#st-book').value, 10) || 0;
      scheduleMetaSave();
    }
    await window.neo.writeLibrary(library);
    bd.remove();
    if (hasBook) updateCounters();
  };
  bd.querySelector('.m-ok').onclick = close;
  // Esc closes from anywhere in the dialog (it takes focus on opening, so
  // the key reaches it even before a field is clicked); so does a click on
  // the dim page around it. Both keep the edits, like Done.
  bd.tabIndex = -1;
  bd.focus();
  bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  if (hasBook) {
    bd.querySelector('#st-sprint-btn').onclick = () => {
      if (sprint && !sprint.done) {
        const got = bookWordCount() - sprint.startCount;
        toast(t('Sprint ended — {n} words in {min} min', { n: got, min: Math.round((Date.now() - sprint.startTime) / 60000) }));
        sprint = null;
      } else {
        const target = parseInt(bd.querySelector('#st-sprint').value, 10) || 500;
        sprint = { target, startCount: bookWordCount(), startTime: Date.now(), done: false };
        toast(t('Sprint started — {n} words. Go.', { n: target }));
      }
      close();
    };
  }
}

$('#goal-counter').onclick = openStats;

/* ================================================================== */
/*  MENU: Help + fonts                                                 */
/* ================================================================== */

const DROPCAP_FONTS = {
  literary: '"Didot", "Bodoni 72", Georgia, serif',
  fantasy: '"Apple Chancery", "Snell Roundhand", cursive',
  scifi: 'Futura, "Avenir Next", "Helvetica Neue", sans-serif'
};
const BODY_FONTS = {
  'Georgia': 'Georgia, "Times New Roman", serif',
  'Palatino': '"Palatino", "Palatino Linotype", serif',
  'Baskerville': 'Baskerville, "Baskerville Old Face", Georgia, serif',
  'Hoefler Text': '"Hoefler Text", Georgia, serif',
  'Iowan Old Style': '"Iowan Old Style", Georgia, serif',
  'Cambria': 'Cambria, Georgia, serif',
  'Constantia': 'Constantia, Georgia, serif'
};

// Hoefler Text and Iowan Old Style ship only with macOS; elsewhere they
// would fall back to Georgia, so offer the fonts Windows actually has.
// Keep in step with bodyFonts in main.js.
const BODY_FONT_CHOICES = IS_MAC
  ? ['Georgia', 'Palatino', 'Baskerville', 'Hoefler Text', 'Iowan Old Style']
  : ['Georgia', 'Palatino', 'Baskerville', 'Cambria', 'Constantia'];

function applyFonts() {
  const f = library.fonts || {};
  if (f.body && typeof f.body === 'string') {
    document.documentElement.style.setProperty('--body-font', bodyFontStack(f.body));
  }
  if (f.dropcap && DROPCAP_FONTS[f.dropcap]) {
    document.documentElement.style.setProperty('--dropcap-font', DROPCAP_FONTS[f.dropcap]);
  }
  document.body.classList.toggle('no-dropcap', f.dropcap === 'none');
  document.body.classList.toggle('night', library.pageTheme === 'night');
  document.body.classList.toggle('bright', !!library.uiBright);
  reportViewState();
  const size = Math.min(22, Math.max(14, library.editorFontSize || 17));
  document.documentElement.style.setProperty('--editor-size', size + 'px');
  const zoom = Math.min(1.6, Math.max(0.75, library.pageZoom || 1));
  document.documentElement.style.setProperty('--page-zoom', zoom);
  updateZoomDisplay();
}

// A built-in choice, or a font the writer picked from their own computer.
// A library opened where that font is missing simply reads in Georgia.
function bodyFontStack(name) {
  return Object.hasOwn(BODY_FONTS, name) ? BODY_FONTS[name] : `"${name.replace(/["\\]/g, '')}", Georgia, serif`;
}

// Format → Body Font → Other Font…: every font installed on this computer,
// each shown in its own face. The panel sits top right, off the undimmed
// page, so hovering previews the font on the writer's own words. Resolves
// to a family name, or null on cancel.
async function pickLocalFont() {
  let families = [];
  try {
    // one entry per style; names starting with "." are the system's hidden fonts
    const faces = await window.queryLocalFonts();
    families = [...new Set(faces.map((f) => f.family))]
      .filter((n) => n && !n.startsWith('.'))
      .sort((a, b) => a.localeCompare(b));
  } catch {}
  if (!families.length) { toast(t('NEO couldn’t read the fonts on this computer')); return null; }
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop font-picker';
    bd.innerHTML = `
      <div class="modal" style="width:320px">
        <h2 style="font-size:16px">${t('Other font')}</h2>
        <p class="font-now" style="font-size:13px;color:var(--muted);margin-bottom:10px"></p>
        <input type="text" spellcheck="false" placeholder="${t('Search {n} installed fonts', { n: families.length })}" />
        <div class="font-list"></div>
        <div style="text-align:right;margin-top:14px">
          <button class="m-cancel btn-quiet">${t('Cancel')}</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    const input = bd.querySelector('input');
    const list = bd.querySelector('.font-list');
    const current = (library.fonts || {}).body || 'Georgia';
    bd.querySelector('.font-now').textContent = t('Now: {font}', { font: current });
    const done = (val) => { bd.remove(); resolve(val); };
    const render = () => {
      const q = input.value.trim().toLowerCase();
      list.innerHTML = '';
      for (const name of families) {
        if (q && !name.toLowerCase().includes(q)) continue;
        const b = document.createElement('button');
        b.className = 'fr-font' + (name === current ? ' sel' : '');
        b.textContent = name;
        b.style.fontFamily = bodyFontStack(name);
        b.onmouseenter = () => { document.documentElement.style.setProperty('--body-font', bodyFontStack(name)); };
        b.onclick = () => done(name);
        list.appendChild(b);
      }
    };
    list.onmouseleave = applyFonts; // back to the saved font
    input.oninput = render;
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && list.firstChild) done(list.firstChild.textContent);
      if (e.key === 'Escape') done(null);
    };
    bd.querySelector('.m-cancel').onclick = () => done(null);
    render();
    const sel = list.querySelector('.sel');
    if (sel) sel.scrollIntoView({ block: 'center' });
    input.focus();
  });
}

// Pinch (trackpad) or Ctrl+scroll: page and text zoom together.
// A pinch arrives as a wheel event with ctrlKey set.
let zoomSaveTimer = null;
function updateZoomDisplay() {
  const el = $('#zoom-level');
  if (el) el.textContent = Math.round((library.pageZoom || 1) * 100) + '%';
}
function setPageZoom(next) {
  next = Math.min(1.6, Math.max(0.75, next));
  if (next === (library.pageZoom || 1)) return;
  library.pageZoom = next;
  document.documentElement.style.setProperty('--page-zoom', next);
  updateZoomDisplay();
  clearTimeout(zoomSaveTimer);
  zoomSaveTimer = setTimeout(() => { window.neo.writeLibrary(library); }, 600);
}
$('#editor-view').addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setPageZoom((library.pageZoom || 1) * Math.exp(-e.deltaY * 0.005));
}, { passive: false });

// zoom control in the bottom bar: buttons, click-to-reset, and scroll
$('#zoom-in').onclick = () => setPageZoom((library.pageZoom || 1) + 0.1);
$('#zoom-out').onclick = () => setPageZoom((library.pageZoom || 1) - 0.1);
$('#zoom-level').onclick = () => setPageZoom(1);
$('#zoom-control').addEventListener('wheel', (e) => {
  e.preventDefault();
  setPageZoom((library.pageZoom || 1) * Math.exp(-e.deltaY * 0.002));
}, { passive: false });

// Format → Align Paragraph: applies to every paragraph the selection touches
function applyAlign(value) {
  if (!book || currentTab !== 'manuscript') { toast(t('Click into a paragraph first')); return; }
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  let el = r.startContainer;
  if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const body = el && el.closest ? el.closest('.chapter-body') : null;
  if (!body) { toast(t('Click into a paragraph first')); return; }
  const chId = body.closest('.chapter').dataset.id;
  const ps = [...body.querySelectorAll('p')].filter(
    (p) => r.intersectsNode(p) && !p.classList.contains('scene-break')
  );
  for (const p of ps) {
    if (value === 'left') p.style.removeProperty('text-align');
    else p.style.textAlign = value;
    if (!p.getAttribute('style')) p.removeAttribute('style');
  }
  syncChapter(body, chId);
}

// Menu accelerators and editor shortcuts, plus NEO's distinct writing gestures.
// Routine text entry, cursor movement and dialog controls are intentionally omitted.
function shortcutSections() {
  return [
    { title: tk('Writing'), rows: [
      [tk('Enter ×2'), tk('Insert a section break')],
      [tk('Enter ×3'), tk('Start a new chapter')],
      [K('⇧Enter', 'Shift+Enter'), tk('Start or continue a poetry paragraph'), tk('Also works from a chapter heading.')],
      [KPH, tk('Insert a placeholder note')],
      [KDA, tk('Move selected text to Darlings')]
    ] },
    { title: tk('Formatting'), rows: [
      [K('⌘B', 'Ctrl+B'), tk('Bold')],
      [K('⌘I', 'Ctrl+I'), tk('Italic')],
      [K('⌘⇧L', 'Ctrl+Shift+L'), tk('Align paragraph left')],
      [K('⌘⇧C', 'Ctrl+Shift+C'), tk('Center paragraph')],
      [K('⌘⇧R', 'Ctrl+Shift+R'), tk('Align paragraph right')],
      [K('⌘⇧J', 'Ctrl+Shift+J'), tk('Justify paragraph')],
      [K('⌘+', 'Ctrl++'), tk('Larger text')],
      [K('⌘−', 'Ctrl+−'), tk('Smaller text')],
      [K('⌘0', 'Ctrl+0'), tk('Reset text size and page zoom')],
      [K(tk('⌃Scroll'), tk('Ctrl+Scroll')), tk('Zoom the page')]
    ] },
    { title: tk('Outline'), rows: [
      ['Tab', tk('Turn a chapter into a section'), tk('Only empty chapters after the first chapter.')],
      [K('⇧Tab', 'Shift+Tab'), tk('Turn a section into a chapter')]
    ] },
    { title: tk('Editing'), rows: [
      [KZ, tk('Undo'), tk('Also undoes recent chapter changes, Darlings moves and Replace All.')],
      [K('⌘⇧Z', /win/i.test(navigator.platform) ? 'Ctrl+Y' : 'Ctrl+Shift+Z'), tk('Redo')],
      [K('⌘X', 'Ctrl+X'), tk('Cut')],
      [K('⌘C', 'Ctrl+C'), tk('Copy')],
      [K('⌘V', 'Ctrl+V'), tk('Paste')],
      [K('⌘⌥⇧V', 'Ctrl+Shift+V'), tk('Paste and match style')],
      [K('⌘A', 'Ctrl+A'), tk('Select all')],
      [K('⌘F', 'Ctrl+F'), tk('Find and replace')],
      [K('⌘;', 'Ctrl+;'), tk('Toggle spellcheck pass')]
    ] },
    { title: tk('App & files'), rows: [
      [KHELP, tk('Keyboard shortcuts')],
      [K('⌘,', 'Ctrl+,'), tk('Goals and writing sprints')],
      [K('⌘⇧I', 'Ctrl+Shift+I'), tk('Import manuscripts')],
      [K('⌘E', 'Ctrl+E'), tk('Email a draft to yourself')]
    ] },
    { title: tk('View & window'), rows: [
      [[K('⌘⇧F', 'Ctrl+Shift+F'), K('⌘Enter', 'Ctrl+Enter')], tk('Toggle full screen')],
      [K('⌘⇧T', 'Ctrl+Shift+T'), tk('Toggle typewriter scrolling')],
      [K('⌘⇧O', 'Ctrl+Shift+O'), tk('Cycle focus mode'), tk('Off → paragraph → sentence → off.')],
      [K('⌘M', 'Ctrl+M'), tk('Minimize window')],
      [K('⌘W', 'Ctrl+W'), tk('Close window')],
      ...(IS_MAC ? [
        ['⌘H', tk('Hide NEO')],
        ['⌘⌥H', tk('Hide other apps')]
      ] : []),
      ...(!/win/i.test(navigator.platform) ? [[K('⌘Q', 'Ctrl+Q'), tk('Quit NEO')]] : [])
    ] }
  ];
}

function showHelp() {
  const existing = $('#keyboard-shortcuts');
  if (existing) { existing.querySelector('.shortcuts-content').focus(); return; }
  const previousFocus = document.activeElement;
  const selection = window.getSelection();
  const previousRange = previousFocus.isContentEditable && selection.rangeCount
    ? selection.getRangeAt(0).cloneRange() : null;
  const bd = document.createElement('div');
  bd.id = 'keyboard-shortcuts';
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal shortcuts-modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
      <header class="shortcuts-header">
        <h2 id="shortcuts-title">${t('Keyboard shortcuts')}</h2>
      </header>
      <div class="shortcuts-content" tabindex="0" role="region" aria-label="${t('Shortcut reference')}"></div>
      <footer class="shortcuts-footer">
        <span>${t(K(tk('⌘ Command · ⇧ Shift · ⌥ Option · ⌃ Control'), tk('Ctrl Control · Shift · Alt')))}</span>
        <button class="m-ok btn-gold">${t('Done')}</button>
      </footer>
    </div>`;
  const keyName = (key) => key.replaceAll('⌘', t('Command') + ' ').replaceAll('⇧', t('Shift') + ' ')
    .replaceAll('⌥', t('Option') + ' ').replaceAll('⌃', t('Control') + ' ').replaceAll('−', '-');
  const content = bd.querySelector('.shortcuts-content');
  const sections = shortcutSections().map((section, index) => `
    <section class="shortcuts-section" style="order:${index}"><h3>${escHtml(t(section.title))}</h3><dl>${section.rows.map(([keys, label, detail]) => `
      <div class="shortcut-row">
        <dt>${escHtml(t(label))}${detail ? `<small>${escHtml(t(detail))}</small>` : ''}</dt>
        <dd>${[keys].flat().map((key) => t(key)).map((key) => `<kbd aria-label="${escHtml(keyName(key))}">${escHtml(key)}</kbd>`).join(`<span class="shortcut-or">${t('or')}</span>`)}</dd>
      </div>`).join('')}</dl></section>`);
  // Keep Writing and Formatting first, with similar amounts of content per column.
  content.innerHTML = [[0, 2, 4, 5], [1, 3]].map((column) => `<div class="shortcuts-column">${
    column.map((index) => sections[index]).join('')
  }</div>`).join('');
  const close = () => {
    document.removeEventListener('keydown', handleKeyDown, true);
    bd.remove();
    if (previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    if (previousRange && previousRange.startContainer.isConnected && previousRange.endContainer.isConnected) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
  };
  bd.querySelector('.m-ok').onclick = close;
  const handleKeyDown = (e) => {
    e.stopPropagation(); // The editor must not handle keys while reading help.
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const controls = [content, bd.querySelector('.m-ok')];
      const index = controls.indexOf(document.activeElement);
      e.preventDefault();
      controls[(index + (e.shiftKey ? controls.length - 1 : 1)) % controls.length].focus();
    }
  };
  document.addEventListener('keydown', handleKeyDown, true);
  document.body.appendChild(bd);
  content.focus();
}

/* ================================================================== */
/*  EXPORT + EMAIL                                                     */
/* ================================================================== */

function safeName(s) {
  return (s || t('Untitled')).replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
}

// Every paragraph is rebuilt from its text runs, so exports carry only
// author-meaningful markup: text, bold, italic, alignment, scene breaks.
// Stray spans, inline styles, trailing <br>s, and no-break spaces all
// stop at this door.
function parasFromHtml(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html || '';
  // an unwritten outline section is a ghost paragraph plus the scene break
  // NEO planted for it; neither belongs in a book
  holder.querySelectorAll('p.ghost[data-sec-id]').forEach((g) => {
    const brk = holder.querySelector(`p.scene-break[data-sec-brk="${g.dataset.secId}"]`);
    if (brk) brk.remove();
  });
  holder.querySelectorAll('.darling-anchor, .ph-mark, .ghost').forEach((n) => n.remove());
  return [...holder.querySelectorAll('p')].map((p) => {
    const sceneBreak = p.classList.contains('scene-break');
    const poetry = p.classList.contains('poetry');
    const align = (p.style && p.style.textAlign) || '';
    const runs = paraRuns(p.innerHTML).filter((r) => r.text);
    const inner = runs.map((r) => {
      let t = escHtml(r.text);
      if (r.i) t = '<i>' + t + '</i>';
      if (r.b) t = '<b>' + t + '</b>';
      return t;
    }).join('');
    return {
      sceneBreak,
      poetry,
      text: p.innerText.replace(/\u00a0/g, ' ').trim(),
      runs,
      align,
      html: `<p${poetry ? ' class="poetry"' : ''}${align ? ` style="text-align:${align}"` : ''}>${inner}</p>`
    };
  }).filter((p) => p.sceneBreak || p.text);
}

function exportChapters() {
  // [{num, heading, paras: [{text, sceneBreak, html}]}]
  return book.chapterOrder.map((chId, i) => {
    const el = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
    const paras = parasFromHtml(el ? el.innerHTML : (chapterHTML[chId] || ''));
    const chTitle = (book.chapterTitles || {})[chId];
    // chapterless stories export as continuous text
    const heading = book.chapterOrder.length === 1
      ? ''
      : library.exportCustomChapterTitles && chTitle
        ? chTitle
        : t('Chapter {n}', { n: i + 1 }) + (chTitle ? ' — ' + chTitle : '');
    return { num: i + 1, heading, paras };
  });
}

// The open book, packaged for the builders. Every builder takes an optional
// data object in this shape, good for anthologies.
function bookExportData() {
  // an EPUB wants a real UUID as its identifier; the book gets one the first
  // time it's exported and keeps it, so re-exports are the same book
  if (!book.uuid) {
    book.uuid = crypto.randomUUID();
    saveMeta();
  }
  return {
    id: book.id,
    uuid: book.uuid,
    title: book.title,
    subtitle: book.subtitle,
    author: book.author || t('Anonymous'), // the screen says so; the files should too
    language: library.spellLanguage || 'en',
    coverSeed: book.coverSeed,
    coverImage: book.coverImage || null,
    sections: exportChapters()
  };
}

function buildTxt(data) {
  const d = data || bookExportData();
  let out = `${d.title.toUpperCase()}\n`;
  if (d.subtitle) out += `${d.subtitle}\n`;
  out += t('by {author}', { author: d.author }) + '\n\n\n';
  for (const ch of d.sections) {
    if (ch.heading) out += `${ch.heading.toUpperCase()}\n\n`;
    for (const p of ch.paras) out += p.sceneBreak ? '\n***\n\n' : (p.poetry ? '    ' : '') + p.text + '\n\n';
    out += '\n';
  }
  return out;
}

function buildMd(data) {
  const d = data || bookExportData();
  // a title like "Wool *Omnibus*" must not turn into markup (idea: nejcc, #70)
  const mdMeta = (s) => String(s || '').replace(/([\\`*_\[\]#<>])/g, '\\$1');
  // wrap a run in emphasis markers, keeping boundary spaces outside them
  const mdRun = (r) => {
    let t = r.text.replace(/([\\*_`])/g, '\\$1');
    const mark = r.b && r.i ? '***' : r.b ? '**' : r.i ? '*' : '';
    if (!mark) return t;
    const lead = t.match(/^\s*/)[0];
    const trail = t.match(/\s*$/)[0];
    const core = t.slice(lead.length, t.length - trail.length);
    return core ? lead + mark + core + mark + trail : t;
  };
  let out = `# ${mdMeta(d.title)}\n\n`;
  if (d.subtitle) out += `*${mdMeta(d.subtitle)}*\n\n`;
  out += `**${t('by {author}', { author: mdMeta(d.author) })}**\n\n`;
  for (const ch of d.sections) {
    if (ch.heading) out += `\n## ${mdMeta(ch.heading)}\n\n`;
    for (const p of ch.paras) {
      out += p.sceneBreak ? '\n***\n\n' : (p.poetry ? '> ' : '') + p.runs.map(mdRun).join('') + '\n\n';
    }
  }
  return out;
}

function buildHtml(data, opts = {}) {
  const d = data || bookExportData();
  const total = d.sections.reduce((s, ch) => s + ch.paras.reduce((n, p) => n + countWords(p.text || ''), 0), 0);
  const stamp = new Date().toLocaleString(NeoI18n.getLocale());
  const chaptersHtml = d.sections.map((ch) => {
    // only the chapter's opening paragraph gets the enlarged initial —
    // scene breaks resume ordinary body text
    let first = true;
    const paras = ch.paras.map((p) => {
      if (p.sceneBreak) return '<p class="brk">***</p>';
      if (p.poetry) return p.html;
      let html = p.html;
      if (first) {
        const h = document.createElement('div');
        h.innerHTML = html;
        if (h.firstElementChild) {
          h.firstElementChild.classList.add('first');
          html = h.innerHTML;
        }
      }
      first = false;
      return html;
    }).join('\n');
    return `
    <section class="chapter">
      ${ch.heading ? `<h2>${escHtml(ch.heading)}</h2>` : ''}
      ${paras}
    </section>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escHtml(d.title)}</title>
<style>
  body { font-family: Georgia, serif; color: #1c1c1c; max-width: 620px; margin: 40px auto; line-height: 1.7; font-size: 13pt; }
  .coverpage { text-align: center; margin: 0 0 40px; page-break-after: always; }
  .coverpage img { display: block; margin: 0 auto; width: 100%; max-width: 620px; max-height: 95vh; object-fit: contain; }
  .titlepage { text-align: center; margin: 30vh 0 20vh; page-break-after: always; }
  .titlepage h1 { font-size: 30pt; margin: 0; }
  .titlepage .sub { font-style: italic; color: #555; }
  .titlepage .auth { margin-top: 40px; letter-spacing: 3px; text-transform: uppercase; font-size: 11pt; }
  .chapter { page-break-before: always; }
  .chapter h2 { text-align: center; letter-spacing: 4px; text-transform: uppercase; font-size: 12pt; font-weight: normal; color: #555; margin: 60px 0 40px; }
  .chapter p { text-indent: 2em; margin: 0; }
  .chapter h2 + p, .brk + p, .chapter p.first { text-indent: 0; }
  /* an in-flow raised initial: stays inside its word for copy, search,
     and screen readers, unlike a floated drop cap */
  ${(library.fonts || {}).dropcap === 'none' ? '' : '.chapter h2 + p:not(.poetry)::first-letter, .chapter p.first::first-letter { font-size: 1.8em; line-height: 1; }'}
  .brk { text-align: center; text-indent: 0 !important; letter-spacing: 8px; color: #888; margin: 2.5em 0; }
  .chapter p.poetry { text-indent: 0; margin: 0 2.5em; }
  .chapter p:not(.poetry) + p.poetry, .chapter h2 + p.poetry { margin-top: 0.9em; }
  .chapter p.poetry + p:not(.poetry) { margin-top: 0.9em; }
  .prov { margin-top: 80px; text-align: center; color: #999; font-size: 9pt; }
</style></head><body>
${opts.cover ? `<div class="coverpage"><img src="data:${opts.cover.mime};base64,${opts.cover.base64}" alt="${t('Cover')}"/></div>` : ''}
<div class="titlepage"><h1>${escHtml(d.title)}</h1>
${d.subtitle ? `<p class="sub">${escHtml(d.subtitle)}</p>` : ''}
<p class="auth">${escHtml(d.author)}</p></div>
${chaptersHtml}
${opts.stamp ? `<p class="prov">${t('{n} words · exported from NEO on {date}', { n: total, date: stamp })}</p>` : ''}
</body></html>`;
}

/* ---------- runs: paragraphs broken into styled text pieces ---------- */

const escXml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// Walk a paragraph's DOM and emit [{text, b, i}] so docx/epub get real bold/italic
function paraRuns(pHtml) {
  const holder = document.createElement('div');
  holder.innerHTML = pHtml;
  const runs = [];
  const walk = (node, b, i) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.textContent) runs.push({ text: child.textContent.replace(/\u00a0/g, ' '), b, i });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.classList && child.classList.contains('ph-mark')) {
          runs.push({ mark: child.dataset.sid || '' });
          continue;
        }
        const tag = child.tagName;
        walk(child, b || tag === 'B' || tag === 'STRONG', i || tag === 'I' || tag === 'EM');
      }
    }
  };
  walk(holder, false, false);
  return runs;
}

/* ---------- DOCX ---------- */

function docxP(runs, opts = {}) {
  const pPr = [];
  if (opts.pageBreak) pPr.push('<w:pageBreakBefore/>');
  if (opts.align) pPr.push(`<w:jc w:val="${opts.align}"/>`);
  if (opts.indent) pPr.push('<w:ind w:firstLine="480"/>');
  if (opts.poetry) pPr.push('<w:ind w:left="720" w:right="720"/>');
  if (opts.spaceBefore) pPr.push(`<w:spacing w:before="${opts.spaceBefore}" w:line="360" w:lineRule="auto"/>`);
  const rXml = runs.map((r) => {
    const rPr = (r.b ? '<w:b/>' : '') + (r.i ? '<w:i/>' : '') + (opts.size ? `<w:sz w:val="${opts.size}"/>` : '');
    return `<w:r>${rPr ? '<w:rPr>' + rPr + '</w:rPr>' : ''}<w:t xml:space="preserve">${escXml(r.text)}</w:t></w:r>`;
  }).join('');
  return `<w:p><w:pPr>${pPr.join('')}</w:pPr>${rXml}</w:p>`;
}

function buildDocxEntries(data) {
  const d = data || bookExportData();
  const body = [];
  // title page
  body.push(docxP([{ text: d.title, b: true }], { align: 'center', spaceBefore: 3000, size: 56 }));
  if (d.subtitle) body.push(docxP([{ text: d.subtitle, i: true }], { align: 'center', size: 32 }));
  body.push(docxP([{ text: d.author }], { align: 'center', spaceBefore: 800 }));
  d.sections.forEach((ch) => {
    if (ch.heading) {
      body.push(docxP([{ text: ch.heading.toUpperCase(), b: false }], { align: 'center', pageBreak: true, spaceBefore: 1200, size: 28 }));
      body.push(docxP([], {}));
    } else {
      body.push(docxP([], { pageBreak: true })); // headingless story still starts fresh
    }
    for (const p of ch.paras) {
      if (p.sceneBreak) body.push(docxP([{ text: '***' }], { align: 'center', spaceBefore: 240 }));
      else if (p.poetry) body.push(docxP(paraRuns(p.html), { align: p.align === 'center' || p.align === 'right' ? p.align : '', poetry: true }));
      else if (p.align === 'center' || p.align === 'right') body.push(docxP(paraRuns(p.html), { align: p.align }));
      else body.push(docxP(paraRuns(p.html), { indent: true }));
    }
  });
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body></w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
</w:styles>`;
  return [
    { path: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>` },
    { path: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>` },
    { path: 'word/_rels/document.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { path: 'word/document.xml', content: documentXml },
    { path: 'word/styles.xml', content: stylesXml }
  ];
}

/* ---------- EPUB (KDP-friendly: EPUB 3, nav + NCX TOC, cover image) ---------- */

// The cover that travels with an export: the writer's own image if they
// gave one, otherwise the shelf's abstract with the title set in type,
// rendered at KDP size. NEO's paintings never leave the shelf.
async function exportCover(d) {
  if (d.coverImage) {
    const c = await window.neo.readCover(d.id, d.coverImage);
    if (c) return { base64: c.base64, mime: c.mime, ext: c.ext };
  }
  await NeoCovers.ready;
  const url = NeoCovers.renderFull(d).toDataURL('image/jpeg', 0.9);
  return { base64: url.split(',')[1], mime: 'image/jpeg', ext: 'jpg' };
}

function chapterXhtml(ch, d) {
  let first = true;
  const paras = ch.paras.map((p) => {
    if (p.sceneBreak) { first = true; return '<p class="brk">* * *</p>'; }
    const classes = [];
    if (p.poetry) classes.push('poetry');
    else if (first) classes.push('first');
    if (p.align === 'center' || p.align === 'right') classes.push(p.align);
    const cls = classes.length ? ` class="${classes.join(' ')}"` : '';
    if (!p.poetry) first = false;
    const inner = paraRuns(p.html).map((r) => {
      let t = escXml(r.text);
      if (r.i) t = '<em>' + t + '</em>';
      if (r.b) t = '<strong>' + t + '</strong>';
      return t;
    }).join('');
    return `<p${cls}>${inner}</p>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${escXml(ch.heading || d.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><section epub:type="chapter">${ch.heading ? `<h1>${escXml(ch.heading)}</h1>` : ''}
${paras}
</section></body></html>`;
}

async function buildEpubEntries(data) {
  const d = data || bookExportData();
  const chapters = d.sections;
  const uuid = 'urn:uuid:' + (d.uuid || crypto.randomUUID());
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  // real cover art when the book has it; the shelf's cover otherwise
  const cover = await exportCover(d);
  const coverName = 'cover.' + cover.ext;
  const coverMime = cover.mime;
  const coverContent = cover.base64;
  const chItems = chapters.map((ch) =>
    `<item id="ch${ch.num}" href="ch${ch.num}.xhtml" media-type="application/xhtml+xml"/>`).join('\n');
  const chSpine = chapters.map((ch) => `<itemref idref="ch${ch.num}"/>`).join('\n');
  const navPoints = chapters.map((ch) => `<li><a href="ch${ch.num}.xhtml">${escXml(ch.heading || d.title)}</a></li>`).join('\n');
  const ncxPoints = chapters.map((ch) => `
<navPoint id="ch${ch.num}" playOrder="${ch.num + 1}"><navLabel><text>${escXml(ch.heading || d.title)}</text></navLabel><content src="ch${ch.num}.xhtml"/></navPoint>`).join('');

  const entries = [
    { path: 'mimetype', content: 'application/epub+zip', store: true },
    { path: 'META-INF/container.xml', content: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>` },
    { path: 'OEBPS/content.opf', content: `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${uuid}</dc:identifier>
<dc:title>${escXml(d.title)}</dc:title>
<dc:creator>${escXml(d.author)}</dc:creator>
<dc:language>${escXml(d.language || NeoI18n.getLocale())}</dc:language>
<meta property="dcterms:modified">${modified}</meta>
<meta name="cover" content="cover-image"/>
</metadata>
<manifest>
<item id="cover-image" href="${coverName}" media-type="${coverMime}" properties="cover-image"/>
<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
<item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${chItems}
</manifest>
<spine toc="ncx">
<itemref idref="cover" linear="no"/>
<itemref idref="titlepage"/>
<itemref idref="nav"${chapters.length === 1 ? ' linear="no"' : ''}/>
${chSpine}
</spine>
<guide>
<reference type="cover" title="${escXml(t('Cover'))}" href="cover.xhtml"/>
<reference type="toc" title="${escXml(t('Table of Contents'))}" href="nav.xhtml"/>
<reference type="text" title="${escXml(t('Beginning'))}" href="ch1.xhtml"/>
</guide>
</package>` },
    { path: 'OEBPS/nav.xhtml', content: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${escXml(t('Table of Contents'))}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><nav epub:type="toc" id="toc"><h1>${escXml(t('Contents'))}</h1>
<ol>
<li><a href="title.xhtml">${escXml(t('Title Page'))}</a></li>
${navPoints}
</ol></nav>
<nav epub:type="landmarks" hidden=""><ol>
<li><a epub:type="cover" href="cover.xhtml">${escXml(t('Cover'))}</a></li>
<li><a epub:type="toc" href="nav.xhtml">${escXml(t('Table of Contents'))}</a></li>
<li><a epub:type="bodymatter" href="ch1.xhtml">${escXml(t('Beginning'))}</a></li>
</ol></nav>
</body></html>` },
    { path: 'OEBPS/toc.ncx', content: `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${uuid}"/></head>
<docTitle><text>${escXml(d.title)}</text></docTitle>
<navMap>
<navPoint id="titlepage" playOrder="1"><navLabel><text>${escXml(t('Title Page'))}</text></navLabel><content src="title.xhtml"/></navPoint>${ncxPoints}
</navMap></ncx>` },
    { path: 'OEBPS/style.css', content: `body { font-family: serif; line-height: 1.5; margin: 1em; }
h1 { text-align: center; font-weight: normal; letter-spacing: 0.2em; text-transform: uppercase; font-size: 1.2em; margin: 3em 0 2em; }
p { text-indent: 1.2em; margin: 0; }
p.first, p.brk + p { text-indent: 0; }
p.center { text-align: center; text-indent: 0; }
p.right { text-align: right; text-indent: 0; }
p.brk { text-align: center; text-indent: 0; margin: 2.5em 0; letter-spacing: 0.5em; }
p.poetry { text-indent: 0; margin: 0 2em; }
p:not(.poetry) + p.poetry, h1 + p.poetry { margin-top: 0.9em; }
p.poetry + p:not(.poetry) { margin-top: 0.9em; }
.titlepage { text-align: center; margin-top: 30%; }
.titlepage h2 { font-size: 2em; margin: 0; }
.titlepage .sub { font-style: italic; }
.titlepage .auth { margin-top: 4em; letter-spacing: 0.3em; text-transform: uppercase; }
.coverimg { text-align: center; margin: 0; padding: 0; }
.coverimg img { max-width: 100%; max-height: 100%; }` },
    { path: 'OEBPS/cover.xhtml', content: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${escXml(t('Cover'))}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><div class="coverimg"><img src="${coverName}" alt="${escXml(d.title)}"/></div></body></html>` },
    { path: 'OEBPS/title.xhtml', content: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${escXml(d.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><div class="titlepage"><h2>${escXml(d.title)}</h2>
${d.subtitle ? `<p class="sub">${escXml(d.subtitle)}</p>` : ''}
<p class="auth">${escXml(d.author)}</p></div></body></html>` },
    { path: 'OEBPS/' + coverName, content: coverContent, base64: true }
  ];
  for (const ch of chapters) {
    entries.push({ path: `OEBPS/ch${ch.num}.xhtml`, content: chapterXhtml(ch, d) });
  }
  return entries;
}

/* ---------- ANTHOLOGY: a whole shelf becomes one book ---------- */

// Read every book on a shelf from disk and merge into export sections.
// Each story's title becomes its TOC entry; multi-chapter works keep
// their chapters as continuation sections.
async function shelfExportData(shelf, anthologyTitle) {
  const sections = [];
  let num = 0;
  for (const bookId of shelf.bookIds) {
    const meta = await window.neo.readBookMeta(bookId);
    if (!meta || !meta.chapterOrder) continue;
    const multi = meta.chapterOrder.length > 1;
    for (let i = 0; i < meta.chapterOrder.length; i++) {
      const html = await window.neo.readChapter(bookId, meta.chapterOrder[i]);
      const paras = parasFromHtml(html);
      if (!paras.length) continue;
      num++;
      const chTitle = (meta.chapterTitles || {})[meta.chapterOrder[i]];
      const heading = !multi
        ? meta.title
        : (i === 0 ? meta.title : `${meta.title} — ${t('Chapter {n}', { n: i + 1 })}${chTitle ? ': ' + chTitle : ''}`);
      sections.push({ num, heading, paras });
    }
  }
  return {
    id: 'shelf-' + shelf.id,
    title: anthologyTitle,
    subtitle: '',
    author: displayAuthor(),
    coverSeed: shelf.id + ':' + anthologyTitle,
    sections
  };
}

async function exportShelfAnthology(shelf) {
  if (!shelf.bookIds.length) { toast(t('This shelf has no books on it yet')); return; }
  const title = await askInput(t('Anthology title'), t('Shown on the title page, cover, and metadata'), shelf.name);
  if (title === null) return;
  const format = await optionModal(t('Export the anthology as…'), null, [
    { label: 'EPUB', desc: t('For ebook stores — the TOC lists every story.'), value: 'epub' },
    { label: 'Word (.docx)', desc: t('For editors — each story starts on a new page.'), value: 'docx' },
    { label: 'PDF', desc: t('For reading, sharing, and print.'), value: 'pdf' }
  ]);
  if (!format) return;
  toast(t('Collecting the shelf…'));
  const data = await shelfExportData(shelf, title || shelf.name);
  if (!data.sections.length) { toast(t('No words found on this shelf yet')); return; }
  const defaultName = safeName(data.title);
  let payload;
  if (format === 'docx') payload = { format, defaultName, zipEntries: buildDocxEntries(data) };
  else if (format === 'epub') payload = { format, defaultName, zipEntries: await buildEpubEntries(data) };
  else payload = { format: 'pdf', defaultName, content: buildHtml(data, { cover: await exportCover(data) }) };
  const saved = await window.neo.exportSave(payload);
  if (saved) toast(t('Anthology of {n} works exported: {file}', { n: shelf.bookIds.length, file: saved.split('/').pop() }), 6000);
}

async function doExport(format) {
  if (!book) { toast(t('Open a book first')); return; }
  flushAllSaves();
  const defaultName = safeName(book.title);
  let payload;
  if (format === 'docx') payload = { format, defaultName, zipEntries: buildDocxEntries() };
  else if (format === 'epub') payload = { format, defaultName, zipEntries: await buildEpubEntries() };
  else if (format === 'txt') payload = { format, defaultName, content: buildTxt() };
  else if (format === 'md') payload = { format, defaultName, content: buildMd() };
  else payload = { format, defaultName, content: buildHtml(null, { cover: await exportCover(bookExportData()) }) };
  const saved = await window.neo.exportSave(payload);
  if (saved) toast(t('Exported: {file}', { file: saved.split('/').pop() }));
}

function chooseEmailMethod() {
  // Apple Mail only exists on Macs; elsewhere Gmail
  if (!navigator.platform.toLowerCase().includes('mac')) return Promise.resolve('gmail');
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `
      <div class="modal" style="width:440px">
        <h2 style="font-size:16px">${t('How should NEO email your drafts?')}</h2>
        <div class="fr-choices" style="margin-top:14px">
          <button class="fr-choice" data-m="gmail">
            <strong>Gmail</strong>
            <span>${t('Opens a pre-filled compose window in your browser. NEO shows you the PDF to drag into it.')}</span>
          </button>
          <button class="fr-choice" data-m="mail">
            <strong>Apple Mail</strong>
            <span>${t('Fully automatic — the PDF is attached and addressed. Just hit send.')}</span>
          </button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    bd.querySelectorAll('.fr-choice').forEach((b) => {
      b.onclick = () => { bd.remove(); resolve(b.dataset.m); };
    });
  });
}

async function emailSettings() {
  const addr = await askInput(t('Email drafts to'), t('you@example.com'), library.emailAddress || '');
  if (addr === null) return false;
  if (addr) library.emailAddress = addr;
  library.emailMethod = await chooseEmailMethod();
  await window.neo.writeLibrary(library);
  toast(t('Email settings saved'));
  return true;
}

async function manuscriptHash() {
  // SHA-256 of the manuscript text: a fingerprint for your provenance trail
  const text = book.title + '\n' + book.chapterOrder.map((c) => chapterText(c)).join('\n');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function doEmailDraft() {
  if (!book) { toast(t('Open a book first')); return; }
  flushAllSaves();
  if (!library.emailAddress || !library.emailMethod) {
    const ok = await emailSettings();
    if (!ok) return;
  }
  const total = bookWordCount();
  const subject = t('NEO draft — {title} — {n} words — {date}', { title: book.title, n: total, date: fmtDate(new Date()) });
  const hash = await manuscriptHash();
  const body = t('Draft snapshot of “{title}” — {n} words.', { title: book.title, n: total }) + '\n'
    + t('Sent from NEO on {date}.', { date: new Date().toLocaleString(NeoI18n.getLocale()) }) + '\n\n'
    + t('SHA-256 fingerprint of the manuscript text:') + `\n${hash}\n\n`
    + (library.emailMethod === 'gmail'
      ? t('The PDF snapshot is in the Finder window NEO just opened — drag it into this email before sending.')
      : t('PDF snapshot attached.'));
  toast(t('Preparing your draft…'));
  const res = await window.neo.emailDraft({
    to: library.emailAddress,
    subject,
    body,
    html: buildHtml(null, { stamp: true }), // the email snapshot is a provenance record
    defaultName: safeName(book.title),
    method: library.emailMethod
  });
  if (res.method === 'gmail') toast(t('Gmail compose opened — drag in the PDF NEO revealed, then send'), 8000);
  else if (res.ok) toast(t('Draft handed to Mail — hit send for your timestamp'));
  else toast(t('Mail unavailable — snapshot saved to your Exports folder instead'));
}

// Help → Check for Update…: on-demand release lookup, only ever runs on a click
let updateDialog = null; // the Check for Update… window, while it's open

function updateDialogBox(res) {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal" style="width:400px">
      <h2 style="font-size:16px">${t('NEO {version} is available', { version: res.latestVersion })}</h2>
      <p class="up-text">${t('You have {version}.', { version: res.currentVersion })}</p>
      <div class="up-bar" hidden><div class="up-fill"></div></div>
      <div style="text-align:right;margin-top:14px">
        <button class="m-cancel btn-quiet" style="margin-right:10px">${t('Later')}</button>
        <button class="m-ok btn-gold"></button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => { bd.remove(); if (updateDialog === bd) updateDialog = null; };
  bd.close = close;
  bd.querySelector('.m-cancel').onclick = close;
  bd.tabIndex = -1;
  bd.focus();
  bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  return bd;
}

// one function draws every state of the dialog, so a message from the
// updater can redraw it whenever it likes
function updateDialogShow(state, info = {}) {
  const bd = updateDialog;
  if (!bd) return;
  const text = bd.querySelector('.up-text');
  const bar = bd.querySelector('.up-bar');
  const fill = bd.querySelector('.up-fill');
  const ok = bd.querySelector('.m-ok');
  const later = bd.querySelector('.m-cancel');
  const mb = (n) => (n / 1048576).toFixed(0);
  later.hidden = false;
  ok.hidden = false;
  bar.hidden = true;
  if (state === 'offer') {
    text.textContent = t('You have {version}.', { version: info.currentVersion });
    ok.textContent = t('Download');
    ok.onclick = () => { updateDialogShow('starting'); window.neo.downloadUpdate(); };
  } else if (state === 'starting') {
    text.textContent = t('Downloading…');
    bar.hidden = false;
    fill.style.width = '0%';
    ok.hidden = true;
  } else if (state === 'downloading') {
    const pct = Math.max(0, Math.min(100, info.percent || 0));
    text.textContent = info.total
      ? t('Downloading… {done} of {total} MB', { done: mb(info.transferred || 0), total: mb(info.total) })
      : t('Downloading…');
    bar.hidden = false;
    fill.style.width = pct.toFixed(1) + '%';
    ok.hidden = true;
  } else if (state === 'ready') {
    text.textContent = t('Downloaded. NEO will save your work and restart.');
    ok.textContent = t('Restart to update');
    ok.onclick = () => { flushAllSaves(); setTimeout(() => window.neo.installUpdate(), 300); };
    ok.focus();
  } else if (state === 'error') {
    text.textContent = t('The update couldn’t be installed from here: {message}', { message: info.message || t('unknown error') })
      + ' ' + t('You can download it from the release page instead.');
    ok.textContent = t('View Release');
    ok.onclick = () => { window.neo.openRelease(); bd.close(); };
  } else if (state === 'release') {
    text.textContent = t('You have {version}.', { version: info.currentVersion });
    ok.textContent = t('View Release');
    ok.onclick = () => { window.neo.openRelease(); bd.close(); };
  }
}

async function checkForUpdate() {
  if (updateDialog) { updateDialog.focus(); return; }
  const res = await window.neo.checkForUpdate();
  if (res.error) { toast(t('Couldn’t check for updates — try again later')); return; }
  if (!res.hasUpdate) { toast(t('You’re on the latest version ({version})', { version: res.currentVersion })); return; }
  updateDialog = updateDialogBox(res);
  if (!res.canInstall) updateDialogShow('release', res);
  else if (res.ready) updateDialogShow('ready', res);
  else updateDialogShow('offer', res);
}

// messages from the updater in the main process
function updateMessage(msg) {
  if (msg.state === 'available') {
    // the quiet startup look: one line, once per version
    if (updateDialog) return;
    try {
      if (localStorage.getItem('neo-update-hinted') === msg.version) return;
      localStorage.setItem('neo-update-hinted', msg.version);
    } catch { /* fine */ }
    toast(t('NEO {version} is available — Help → Check for Update… installs it', { version: msg.version }), 7000);
    return;
  }
  if (!updateDialog) return; // nothing open to report to
  updateDialogShow(msg.state, msg);
}

// Help → About NEO: the version, plainly
async function showAbout() {
  const v = await window.neo.appVersion();
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal" style="width:340px;text-align:center">
      <h2 style="font-size:22px;letter-spacing:6px">NEO</h2>
      <p style="color:#999">${t('Version {version}', { version: v })}</p>
      <p style="font-size:13px;color:#777">${t('A word processor for authors.')}</p>
      <div style="margin-top:16px">
        <button class="m-ok btn-gold">${t('Back to writing')}</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.querySelector('.m-ok').onclick = close;
  bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  bd.querySelector('.m-ok').focus();
}

window.neo.onMenu(async (msg) => {
  if ($('#keyboard-shortcuts') && msg.type !== 'help') return;
  if (msg.type === 'help') showHelp();
  if (msg.type === 'about') showAbout();
  if (msg.type === 'checkUpdate') checkForUpdate();
  if (msg.type === 'update') updateMessage(msg);
  if (msg.type === 'export') doExport(msg.format);
  if (msg.type === 'exportCustomChapterTitles') {
    library.exportCustomChapterTitles = msg.checked;
    await window.neo.writeLibrary(library);
  }
  if (msg.type === 'emailDraft') doEmailDraft();
  if (msg.type === 'emailSettings') emailSettings();
  if (msg.type === 'find') openSearch();
  if (msg.type === 'spellcheck') toggleSpellcheck();
  if (msg.type === 'spellLanguage') changeSpellLanguage(msg.value);
  if (msg.type === 'reshelve') reshelveBook();
  if (msg.type === 'typewriter') toggleTypewriter();
  if (msg.type === 'focus') setFocus(msg.value);
  if (msg.type === 'focusCycle') cycleFocus();
  if (msg.type === 'import') importBooks();
  if (msg.type === 'stats') openStats();
  if (msg.type === 'writingStyle') {
    library.writingStyle = msg.value;
    await window.neo.writeLibrary(library);
    if (window.neo.writingStyleState) window.neo.writingStyleState(library.writingStyle);
  }
  if (msg.type === 'coverArt') openCoverArt();
  if (msg.type === 'align') {
    applyAlign(msg.value);
  }
  if (msg.type === 'poetry') togglePoetry();
  if (msg.type === 'uiLanguage') {
    // save every open page, then reload the window in the new language
    flushAllSaves();
    try { if (book && !$('#editor-view').hidden) sessionStorage.setItem('neo-reopen', book.id); } catch { /* a nicety */ }
    setTimeout(() => window.neo.reloadForLanguage(), 400);
  }
  if (msg.type === 'uiBright') {
    library.uiBright = !library.uiBright;
    await window.neo.writeLibrary(library);
    applyFonts();
  }
  if (msg.type === 'pageTheme') {
    library.pageTheme = msg.value;
    await window.neo.writeLibrary(library);
    applyFonts();
  }
  if (msg.type === 'fontSize') {
    const cur = library.editorFontSize || 17;
    library.editorFontSize = msg.value === 0 ? 17 : Math.min(22, Math.max(14, cur + msg.value));
    if (msg.value === 0) library.pageZoom = 1; // ⌘0 resets pinch zoom too
    await window.neo.writeLibrary(library);
    applyFonts();
  }
  if (msg.type === 'bodyFontPick') {
    const name = await pickLocalFont();
    if (name) {
      library.fonts = library.fonts || {};
      library.fonts.body = name;
      await window.neo.writeLibrary(library);
    }
    applyFonts(); // also undoes a hover preview after Cancel
  }
  if (msg.type === 'bodyFont') {
    library.fonts = library.fonts || {};
    library.fonts.body = msg.value;
    await window.neo.writeLibrary(library);
    applyFonts();
  }
  if (msg.type === 'dropCap') {
    library.fonts = library.fonts || {};
    library.fonts.dropcap = msg.value;
    await window.neo.writeLibrary(library);
    applyFonts();
  }
});

/* ================================================================== */
/*  SAFETY NET — errors get logged, never eaten silently               */
/* ================================================================== */

let errorToastShown = false;
function reportError(msg) {
  window.neo.logError(msg);
  if (!errorToastShown) {
    errorToastShown = true;
    toast(t('Something hiccuped — your words are safe, and the details were logged'));
  }
}
window.addEventListener('error', (e) => reportError(`${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => reportError('Unhandled: ' + (e.reason && e.reason.stack || e.reason)));

/* ================================================================== */
/*  Linux body fonts                                                   */
/*  Georgia, Palatino, Baskerville, Hoefler Text, and Iowan Old Style  */
/*  are not on Linux. The bundled faces below are what the Format menu */
/*  and the first-run picker offer instead. Old libraries still resolve */
/*  the macOS names, but those names stay out of the picker.           */
/* ================================================================== */

const LINUX_BODY_FONTS = {
  'Gelasio': '"Gelasio", Georgia, "Times New Roman", serif',
  'TeX Gyre Pagella': '"TeX Gyre Pagella", Palatino, "Palatino Linotype", serif',
  'Libre Baskerville': '"Libre Baskerville", Baskerville, Georgia, serif',
  'Alegreya': '"Alegreya", "Hoefler Text", Georgia, serif',
  'Source Serif Pro': '"Source Serif Pro", "Iowan Old Style", Georgia, serif'
};

function installLinuxBodyFonts() {
  if (IS_MAC || /win/i.test(navigator.platform)) return;
  const legacy = {
    Georgia: LINUX_BODY_FONTS.Gelasio,
    Palatino: LINUX_BODY_FONTS['TeX Gyre Pagella'],
    Baskerville: LINUX_BODY_FONTS['Libre Baskerville'],
    'Hoefler Text': LINUX_BODY_FONTS.Alegreya,
    'Iowan Old Style': LINUX_BODY_FONTS['Source Serif Pro'],
    Cambria: LINUX_BODY_FONTS['Source Serif Pro'],
    Constantia: LINUX_BODY_FONTS['Libre Baskerville']
  };
  for (const key of Object.keys(BODY_FONTS)) delete BODY_FONTS[key];
  Object.assign(BODY_FONTS, LINUX_BODY_FONTS);
  for (const [key, stack] of Object.entries(legacy)) {
    Object.defineProperty(BODY_FONTS, key, {
      value: stack, enumerable: false, writable: true, configurable: true
    });
  }
  DROPCAP_FONTS.literary = '"Libre Bodoni", "Didot", "Bodoni 72", Georgia, serif';
  DROPCAP_FONTS.fantasy = '"TeX Gyre Chorus", "Apple Chancery", "Snell Roundhand", cursive';
  DROPCAP_FONTS.scifi = '"Jost", Futura, "Avenir Next", "Helvetica Neue", sans-serif';
  // A shared choice list, when the renderer defines one, has to name these
  // bundled faces on Linux rather than fonts the machine does not have.
  if (typeof BODY_FONT_CHOICES !== 'undefined') {
    BODY_FONT_CHOICES.splice(0, BODY_FONT_CHOICES.length, ...Object.keys(LINUX_BODY_FONTS));
  }
}
installLinuxBodyFonts();

/* ================================================================== */

loadLibrary().then(() => {
  applyFonts();
  typewriterEnabled = !!library.typewriter;
  applyTypewriter();
  focusLevel = FOCUS_LEVELS.includes(library.focus) ? library.focus : 'off';
  applyFocus();
});
