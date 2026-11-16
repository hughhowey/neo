'use strict';

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
  applyShelfZoom();
  library = applyDeviceLook(await window.neo.readLibrary());
  // A first shelf is named in the language NEO had when it was made. If the
  // writer never renamed it, it follows a change of language.
  const DEFAULT_SHELF = 'Works in Progress';
  const own = t(DEFAULT_SHELF);
  // (each writing name has a first shelf of its own, made the same way)
  const untouched = (library.shelves || []).filter((s) => s.name === DEFAULT_SHELF && own !== DEFAULT_SHELF);
  for (const s of untouched) s.name = own;
  if (untouched.length) await writeLibrary(library);
  await setupFeatures();
  if (window.neo.writingStyleState) window.neo.writingStyleState(library.writingStyle);
  const existing = !!library.firstRunDone;
  if (!existing) {
    showFirstRun();
  }
  renderShelves();
  whatsNewAtLaunch(existing);
}

function showFirstRun() {
  const fr = $('#firstrun');
  fr.hidden = false;
  // a Mac where NEO Pocket already keeps books in iCloud Drive: open those
  // instead of starting a new library (NEO restarts in that folder)
  if (window.neo.pocketLibrary) {
    window.neo.pocketLibrary().then((p) => {
      if (!p || !p.offer) return;
      $('#fr-pocket').hidden = false;
      $('#fr-pocket-btn').onclick = () => { window.neo.usePocketLibrary(); };
    }).catch(() => {});
  }
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
    // an A of the alphabet the sample is written in, so each button shows
    // the drop cap the writer will get (Cyrillic letters come from other faces)
    const capA = /\p{Script=Cyrillic}/u.test($('#fr-sample-text').textContent) ? 'А' : 'A';
    for (const key of Object.keys(caps)) {
      const b = document.createElement('button');
      b.className = 'fr-font' + (picked.dropcap === key ? ' sel' : '');
      b.innerHTML = `<span class="fr-cap" style="font-family:${DROPCAP_FONTS[key].replace(/"/g, '&quot;')}">${capA}</span>${caps[key]}`;
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
    // a library that can't be written must not leave the writer at a button
    // that does nothing: say so, and keep the page ready for another try
    const note = $('#fr-error');
    try {
      await writeLibrary(library);
    } catch (err) {
      library.firstRunDone = false;
      window.neo.logError('first run: ' + ((err && err.message) || err));
      note.textContent = t('NEO can\'t save in {dir}. File → Library Folder… lets you choose a folder it can write to; then press Start writing again.', { dir: libraryDirPath });
      note.hidden = false;
      return;
    }
    note.hidden = true;
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
// Saves a book's meta and drops the cached copy. This used to be done by
// replacing window.neo.writeBookMeta, but on desktop that object is
// read-only, so the assignment threw and app.js stopped loading.
function writeBookMeta(bookId, meta, known) {
  bookMetaCache.delete(bookId);
  return window.neo.writeBookMeta(bookId, meta, known);
}

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
      await writeLibrary(library);
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
    if (isBound(shelf)) sec.classList.add('bound');
    if (shelf.id === justBoundId) { sec.classList.add('just-bound'); justBoundId = null; }

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
      const before = shelf.name;
      shelf.name = label.textContent.trim() || shelf.name;
      label.textContent = shelf.name;
      if (NO_HOVER) label.contentEditable = 'false';
      await writeLibrary(library);
      // a bound shelf's name is its book's title: the cover follows it
      if (isBound(shelf) && shelf.name !== before) { await syncCoverTitle(shelf); renderShelves(); }
    });
    label.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); label.blur(); }
    });
    // right-click a shelf label: bind it into one book, publish it as an
    // anthology, or delete it (a bound shelf has a menu of its own)
    label.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      if (isBound(shelf)) { await boundShelfMenu(shelf); return; }
      const choice = await optionModal(escHtml(t('Shelf “{name}”', { name: shelf.name })), null, [
        ...(featureOn('penNames') ? [{
          label: t('Bind into one book'),
          desc: t('Its titles become one book, with a cover, front and back pages, and one table of contents.'),
          value: 'bind'
        },
        {
          label: t('Export shelf as anthology…'),
          desc: shelf.bookIds.length
            ? t('Collect its {n} works, in shelf order, into a single book with a table of contents.', { n: shelf.bookIds.length })
            : t('Collect the works, in shelf order, into a single book with a table of contents.'),
          value: 'anthology'
        }] : []),
        { label: t('Delete shelf'), desc: t('Books move to another shelf. Nothing is deleted from disk.'), danger: true, value: 'del' }
      ]);
      if (choice === 'bind') {
        await bindShelf(shelf);
      } else if (choice === 'anthology') {
        await exportShelfAnthology(shelf);
      } else if (choice === 'del') {
        const mine = shelvesFor(currentAuthor().id);
        if (mine.length === 1) {
          toast(t('This is your only shelf — add another before deleting this one'));
          return;
        }
        const other = mine.find((s) => s.id !== shelf.id);
        for (const id of shelf.bookIds) {
          if (isPageMeta(await shelfMeta(id))) continue; // a bound book's pages stay in the library folder
          if (!other.bookIds.includes(id)) await placeTitle(other, id);
        }
        library.shelves = library.shelves.filter((s) => s.id !== shelf.id);
        await writeLibrary(library);
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
      const fromShelf = shelfOf(bookId);
      if (isBound(shelf)) {
        if (isPageMeta(await shelfMeta(bookId))) return; // a page keeps its place
        const { start, end } = await bodyRange(shelf, bookId);
        index = Math.min(Math.max(index, start), end);
      }
      for (const s of library.shelves) s.bookIds = s.bookIds.filter((b) => b !== bookId);
      shelf.bookIds.splice(index, 0, bookId);
      await writeLibrary(library);
      if (isBound(shelf) || isBound(fromShelf)) { renderShelves(); return; }
      // slide the tile into place; the shelf itself is not redrawn
      const tile = document.querySelector(`.book[data-book-id="${bookId}"]`);
      if (tile) {
        const others = [...row.querySelectorAll('.book')].filter((b) => b !== tile);
        row.insertBefore(tile, others[index] || row.querySelector('.new-book'));
        tile.classList.remove('dragging');
      } else renderShelves();
    });

    // the blank page — click to begin
    const blank = document.createElement('div');
    blank.className = 'new-book';
    blank.textContent = '+';
    blank.title = t('Start a new book');
    blank.onclick = () => createBookOnShelf(shelf);
    pressable(blank, t('Start a new book'));
    // right-click (a long press on a phone): a book or a script — in simple
    // NEO and on Pocket too, so a writer who looks for scripts finds them
    // where they'd look (#494, #504)
    if (!isBound(shelf)) {
      blank.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const pick = await popMenu(e.clientX, e.clientY, [
          { label: t('New Book'), value: 'book' },
          { label: t('New Script'), value: 'script' }
        ], { from: blank });
        if (pick === 'book') createBookOnShelf(shelf);
        else if (pick === 'script') createScriptOnShelf(shelf);
      });
    }

    if (isBound(shelf)) {
      await renderBoundRow(shelf, row, blank);
      // the tiles of a shelf just bound settle in one after another
      if (sec.classList.contains('just-bound')) [...row.children].forEach((el, i) => el.style.setProperty('--i', i));
    } else {
      for (const bookId of shelf.bookIds) {
        const meta = await shelfMeta(bookId);
        if (!meta || isPageMeta(meta)) continue;
        row.appendChild(bookTile(meta));
      }
      row.appendChild(blank);
    }

    sec.appendChild(label);
    if (isBound(shelf)) {
      const mark = document.createElement('span');
      mark.className = 'shelf-bound-mark';
      mark.textContent = t('one book');
      sec.appendChild(mark);
    }
    sec.appendChild(row);
    built.appendChild(sec);
  }
  wrap.replaceChildren(built);
  view.scrollTop = keepScroll;
  fitBoundShelves();
}

// A bound shelf, measured once it's on screen: the thread under it runs as
// far as its books do, and a page's name too long for its spine (some
// languages have long ones) is set smaller until it fits
function fitBoundShelves() {
  for (const row of document.querySelectorAll('.shelf.bound .shelf-books')) {
    const last = row.lastElementChild;
    const box = row.getBoundingClientRect();
    if (!last || !box.width) continue;
    const zoom = box.width / row.offsetWidth; // the Interface Size zoom
    row.style.setProperty('--stitch', Math.ceil((last.getBoundingClientRect().right - box.left) / zoom) + 'px');
    for (const l of row.querySelectorAll('.pt-label')) {
      l.style.fontSize = '';
      l.style.letterSpacing = '';
      const room = l.clientHeight;
      const need = l.scrollHeight;
      if (!room || need <= room + 1) continue;
      const cs = getComputedStyle(l);
      const k = room / need;
      l.style.fontSize = Math.max(6.5, parseFloat(cs.fontSize) * k).toFixed(2) + 'px';
      l.style.letterSpacing = ((parseFloat(cs.letterSpacing) || 0) * k).toFixed(2) + 'px';
    }
  }
}
window.addEventListener('resize', () => {
  clearTimeout(fitBoundShelves.t);
  fitBoundShelves.t = setTimeout(fitBoundShelves, 120);
});

/* ================================================================== */
/*  BOUND SHELVES — a shelf that is one book                           */
/*  Right-click a shelf's name → Bind into one book. Its titles stay   */
/*  ordinary books to write in. A cover and the pages a published book */
/*  carries (copyright, dedication, epigraph, parts, acknowledgments,  */
/*  about the author) join them as small books of their own: plain     */
/*  folders like every other, so backups, sync and Pocket carry them.  */
/*  Hovering a bound shelf shows each missing page, faint, in its      */
/*  place; a click adds it and opens it as the page it will print as.  */
/*  Unbinding tucks the pages away (shelf.binding.parked) until the    */
/*  next binding. Nothing is ever deleted by binding or unbinding.     */
/* ================================================================== */

const PAGE_FRONT = ['copyright', 'dedication', 'epigraph'];
const PAGE_BACK = ['acknowledgments', 'about'];
// A book's own prologue and epilogue, when it has them: story, written in
// the editor like any title, standing before the first part and after the
// last. (A single book's first or last chapter can take the role too.)
const PAGE_WRITTEN = ['prologue', 'epilogue'];
// the order each end of a bound shelf keeps
const PAGE_LEAD = ['cover', ...PAGE_FRONT, 'prologue'];
const PAGE_TAIL = ['epilogue', ...PAGE_BACK];
const PAGE_KINDS = [...PAGE_LEAD, 'part', ...PAGE_TAIL];
const isPageMeta = (m) => !!(m && PAGE_KINDS.includes(m.kind));
const isBound = (shelf) => !!(shelf && shelf.binding && shelf.binding.bound);
const shelfOf = (bookId) => library.shelves.find((s) => s.bookIds.includes(bookId));

function pageKindName(kind) {
  return {
    cover: t('Cover'),
    copyright: t('Copyright'),
    dedication: t('Dedication'),
    epigraph: t('Epigraph'),
    prologue: t('Prologue'),
    part: t('Part'),
    epilogue: t('Epilogue'),
    acknowledgments: t('Acknowledgments'),
    about: t('About the Author')
  }[kind] || kind;
}

// Part I, Part II …: roman numerals read the same in every language
function roman(n) {
  const r = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of r) while (n >= v) { out += s; n -= v; }
  return out;
}
const partLabel = (n) => t('Part {n}', { n: roman(n) });

// the name a bound book goes out under: the pen name that owns the shelf
function shelfAuthorName(shelf) {
  const all = library.authors || [];
  const a = all.find((x) => x.id === shelf.authorId) || all[0];
  return (a && a.name) || t('Anonymous');
}

// a new page starts with what every such page says, where that's knowable
const PAGE_STARTERS = {
  copyright: (shelf) =>
    `<p>${escHtml(t('Copyright © {year} {name}', { year: String(new Date().getFullYear()), name: shelfAuthorName(shelf) }))}</p>` +
    `<p>${escHtml(t('All rights reserved.'))}</p>`
};

async function createPageBook(shelf, kind) {
  const written = PAGE_WRITTEN.includes(kind);
  // a prologue opens in the editor as "Prologue", under the book's name
  const title = kind === 'cover' || written ? (written ? pageKindName(kind) : shelf.name) : pageKindName(kind) + ' — ' + shelf.name;
  const meta = await window.neo.createBook({ author: shelfAuthorName(shelf), title });
  meta.title = title;
  meta.kind = kind;
  meta.shelfId = shelf.id; // which bound book it belongs to, for anyone reading the folder
  if (written) {
    meta.subtitle = shelf.name;
    meta.tabNames = {
      notes: (library.tabDefaults && library.tabDefaults.notes) || 'Notes',
      outline: (library.tabDefaults && library.tabDefaults.outline) || 'Outline'
    };
  }
  if (kind === 'cover') {
    meta.coverSeed = 'bound:' + shelf.id;
    meta.chapterOrder = [];
  } else {
    const chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    await window.neo.writeChapter(meta.id, chId, PAGE_STARTERS[kind] ? PAGE_STARTERS[kind](shelf) : '<p><br></p>');
    meta.chapterOrder = [chId];
  }
  await writeBookMeta(meta.id, meta);
  return meta;
}

// Where titles may sit on a bound shelf: after the cover and front pages,
// before the back pages (indexes into bookIds, without skipId)
async function bodyRange(shelf, skipId) {
  const ids = shelf.bookIds.filter((b) => b !== skipId);
  const kinds = [];
  for (const id of ids) {
    const m = await shelfMeta(id);
    kinds.push((m && m.kind) || '');
  }
  let start = 0;
  while (start < ids.length && PAGE_LEAD.includes(kinds[start])) start++;
  let end = ids.length;
  while (end > start && PAGE_TAIL.includes(kinds[end - 1])) end--;
  return { start, end };
}

// Put a title on a shelf: last in line (or first), which on a bound shelf
// means the end (or start) of its body, never after the back pages
async function placeTitle(shelf, bookId, atStart) {
  shelf.bookIds = shelf.bookIds.filter((b) => b !== bookId);
  if (!isBound(shelf)) {
    if (atStart) shelf.bookIds.unshift(bookId); else shelf.bookIds.push(bookId);
    return;
  }
  const { start, end } = await bodyRange(shelf);
  shelf.bookIds.splice(atStart ? start : end, 0, bookId);
}

let justBoundId = null; // the shelf whose binding the next drawing shows
async function bindShelf(shelf) {
  shelf.binding = Object.assign({ numbering: 'through', parked: [] }, shelf.binding || {}, { bound: true });
  restoreParked(shelf);
  let cover = null;
  for (const id of shelf.bookIds) {
    const m = await shelfMeta(id);
    if (m && m.kind === 'cover') { cover = m; break; }
  }
  if (!cover) {
    cover = await createPageBook(shelf, 'cover');
    shelf.bookIds.unshift(cover.id);
  } else if (cover.title !== shelf.name) {
    cover.title = shelf.name;
    await writeBookMeta(cover.id, cover);
  }
  await writeLibrary(library);
  justBoundId = shelf.id;
  await renderShelves();
  toast(t('“{name}” is bound into one book', { name: shelf.name }));
}

// the pages come back where they were: the cover and front pages lead, a
// part page returns before the title it opened, the back pages close
function restoreParked(shelf) {
  const parked = (shelf.binding && shelf.binding.parked) || [];
  if (!parked.length) return;
  const front = parked.filter((p) => PAGE_LEAD.includes(p.kind))
    .sort((a, b) => PAGE_LEAD.indexOf(a.kind) - PAGE_LEAD.indexOf(b.kind));
  const back = parked.filter((p) => PAGE_TAIL.includes(p.kind))
    .sort((a, b) => PAGE_TAIL.indexOf(a.kind) - PAGE_TAIL.indexOf(b.kind));
  const body = shelf.bookIds.filter((id) => !parked.some((p) => p.id === id));
  for (const p of parked.filter((x) => x.kind === 'part')) {
    const at = p.before ? body.indexOf(p.before) : -1;
    if (at >= 0) body.splice(at, 0, p.id); else body.push(p.id);
  }
  shelf.bookIds = [...front.map((p) => p.id), ...body, ...back.map((p) => p.id)];
  shelf.binding.parked = [];
}

async function unbindShelf(shelf) {
  const ids = [...shelf.bookIds];
  const metas = [];
  for (const id of ids) metas.push(await shelfMeta(id));
  const parked = [];
  const titles = [];
  ids.forEach((id, i) => {
    const m = metas[i];
    if (!isPageMeta(m)) { titles.push(id); return; }
    // a part page remembers the title it opens
    let before = null;
    if (m.kind === 'part') {
      for (let j = i + 1; j < ids.length; j++) {
        if (metas[j] && !isPageMeta(metas[j])) { before = ids[j]; break; }
      }
    }
    parked.push({ id, kind: m.kind, before });
  });
  shelf.bookIds = titles;
  shelf.binding = Object.assign({}, shelf.binding, { bound: false, parked });
  await writeLibrary(library);
  await renderShelves();
  toast(t('Unbound. Its pages wait for the next binding.'));
}

// the shelf's name is the book's title, so a rename reaches the cover too
async function syncCoverTitle(shelf) {
  for (const id of shelf.bookIds) {
    const m = await shelfMeta(id);
    if (m && m.kind === 'cover') {
      if (m.title !== shelf.name) { m.title = shelf.name; await writeBookMeta(m.id, m); }
      return;
    }
  }
}

/* ---------- a bound shelf, drawn ---------- */

async function renderBoundRow(shelf, row, blank) {
  const items = [];
  for (const id of shelf.bookIds) {
    const m = await shelfMeta(id);
    if (m) items.push(m);
  }
  let f = 0;
  while (f < items.length && PAGE_LEAD.includes(items[f].kind)) f++;
  let b = items.length;
  while (b > f && PAGE_TAIL.includes(items[b - 1].kind)) b--;
  const front = items.slice(0, f);
  const body = items.slice(f, b);
  const back = items.slice(b);
  const cover = front.find((m) => m.kind === 'cover');
  if (cover) row.appendChild(boundCoverTile(shelf, cover));
  const offer = missingPages(body);
  appendPageZone(row, shelf, front.filter((m) => m.kind !== 'cover'), [...PAGE_FRONT, 'prologue'], offer);
  let parts = 0;
  body.forEach((m, i) => {
    if (m.kind === 'part') {
      parts += 1;
      row.appendChild(pageTile(shelf, m, partLabel(parts)));
      return;
    }
    if (isPageMeta(m)) { row.appendChild(pageTile(shelf, m, pageKindName(m.kind))); return; }
    const prev = body[i - 1];
    if (!NO_HOVER && !(prev && prev.kind === 'part')) row.appendChild(partSeam(shelf, m.id));
    row.appendChild(bookTile(m));
  });
  row.appendChild(blank);
  appendPageZone(row, shelf, back, PAGE_TAIL, offer);
}

// Which pages a bound book could still take. A book of one title whose
// first chapter is already its prologue isn't offered another (nor one
// whose last chapter is its epilogue).
function missingPages(body) {
  const titles = body.filter((m) => !isPageMeta(m));
  const lone = titles.length === 1 ? titles[0] : null;
  const own = (role) => !!lone && (lone.chapterOrder || []).some((c) => chapterRole(c, lone) === role);
  return (kind) => !(PAGE_WRITTEN.includes(kind) && own(kind));
}

// the pages of one end of the book, each in its place, with a faint
// stand-in (shown on hover) wherever one could be added
function appendPageZone(row, shelf, have, kinds, offer) {
  const left = [...have];
  for (const k of kinds) {
    const i = left.findIndex((m) => m.kind === k);
    if (i >= 0) row.appendChild(pageTile(shelf, left.splice(i, 1)[0], pageKindName(k)));
    else if (!NO_HOVER && offer(k)) row.appendChild(ghostPage(shelf, k));
  }
  for (const m of left) row.appendChild(pageTile(shelf, m, pageKindName(m.kind)));
}

function boundCoverTile(shelf, meta) {
  // the cover wears the shelf's name, whatever its folder was first called
  const shown = Object.assign({}, meta, { title: shelf.name, author: meta.author || shelfAuthorName(shelf) });
  const el = bookTile(shown, { cover: shelf });
  el.classList.add('bound-cover');
  el.draggable = false;
  return el;
}

// a page's name runs up its spine; a long one is set smaller to fit
const spineFit = (label) => (label.length > 17 ? ' longer' : label.length > 12 ? ' long' : '');

function pageTile(shelf, meta, label) {
  const el = document.createElement('div');
  el.className = 'book page-tile kind-' + meta.kind + spineFit(label);
  el.dataset.bookId = meta.id;
  el.draggable = false;
  const span = document.createElement('span');
  span.className = 'pt-label';
  span.textContent = label;
  el.appendChild(span);
  el.title = label;
  el.onclick = () => openPage(shelf, meta, label);
  pressable(el, label);
  el.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const choice = await optionModal(escHtml(label), null, [
      { label: t('Open'), value: 'open' },
      {
        label: t('Remove page'),
        desc: window.Capacitor
          ? t('Moves the book folder to Deleted Books in your NEO Library, where you can recover it.')
          : t('Sends the page to your system trash, where you can recover it.'),
        danger: true, value: 'remove'
      }
    ]);
    if (choice === 'open') openPage(shelf, meta, label);
    else if (choice === 'remove' && await window.neo.deleteBook(meta.id, label)) {
      shelf.bookIds = shelf.bookIds.filter((b) => b !== meta.id);
      await writeLibrary(library);
      renderShelves();
    }
  });
  return el;
}

function ghostPage(shelf, kind) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'ghost-page' + spineFit(pageKindName(kind));
  el.innerHTML = '<span class="gp-plus" aria-hidden="true">+</span><span class="pt-label"></span>';
  el.querySelector('.pt-label').textContent = pageKindName(kind);
  el.title = pageKindName(kind);
  el.setAttribute('aria-label', pageKindName(kind));
  el.onclick = () => addPage(shelf, kind);
  return el;
}

function partSeam(shelf, beforeId) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'part-seam';
  el.title = t('Start a part here');
  el.setAttribute('aria-label', t('Start a part here'));
  el.innerHTML = '<span class="ps-line"></span><span class="ps-plus">+</span>';
  el.onclick = () => addPage(shelf, 'part', beforeId);
  return el;
}

// A new page goes where books put it: front pages after the cover in their
// usual order, back pages at the end in theirs, a part before its title
async function addPage(shelf, kind, beforeId) {
  const meta = await createPageBook(shelf, kind);
  const ids = shelf.bookIds;
  let at = ids.length;
  if (kind === 'part') {
    at = beforeId ? ids.indexOf(beforeId) : -1;
    if (at < 0) at = (await bodyRange(shelf)).end;
  } else if (PAGE_LEAD.includes(kind)) {
    at = 0;
    for (let i = 0; i < ids.length; i++) {
      const m = await shelfMeta(ids[i]);
      const k = m && m.kind;
      if (PAGE_LEAD.includes(k) && PAGE_LEAD.indexOf(k) < PAGE_LEAD.indexOf(kind)) at = i + 1;
      else break;
    }
  } else {
    for (let i = ids.length - 1; i >= 0; i--) {
      const m = await shelfMeta(ids[i]);
      const k = m && m.kind;
      if (PAGE_TAIL.includes(k) && PAGE_TAIL.indexOf(k) > PAGE_TAIL.indexOf(kind)) at = i;
      else break;
    }
  }
  ids.splice(at, 0, meta.id);
  await writeLibrary(library);
  await renderShelves();
  let label = pageKindName(kind);
  if (kind === 'part') {
    let n = 0;
    for (const id of shelf.bookIds) {
      const m = await shelfMeta(id);
      if (m && m.kind === 'part') n += 1;
      if (id === meta.id) break;
    }
    label = partLabel(n);
  }
  openPage(shelf, meta, label);
}

// A prologue or an epilogue is story: it opens in the editor, ready to
// write in. Every other page opens as the sheet it will print on.
async function openPage(shelf, meta, label) {
  if (!PAGE_WRITTEN.includes(meta.kind)) { openPageSheet(shelf, meta, label); return; }
  await openBook(meta.id);
  // a first visit starts at the top of the page, under its title
  if (book && book.id === meta.id && !book.lastPosition && book.chapterOrder[0]) focusChapterStart(book.chapterOrder[0]);
}

/* ---------- a page, open as it will print ---------- */

const PAGE_PLACEHOLDERS = {
  dedication: () => t('For…'),
  epigraph: () => '…',
  part: () => t('Title')
};

// Whatever the editing engine left, a page is stored as NEO's plain
// paragraphs: loose text and <div>s become <p>s, stray <br>s go
function normalizePageBody(body) {
  let cur = null;
  for (const node of [...body.childNodes]) {
    if (node.nodeType === 1 && /^(P|DIV|H[1-6]|BLOCKQUOTE|LI|UL|OL)$/.test(node.tagName)) {
      cur = null;
      if (node.tagName !== 'P') {
        const p = document.createElement('p');
        while (node.firstChild) p.appendChild(node.firstChild);
        node.replaceWith(p);
      }
      continue;
    }
    const blank = (node.nodeType === 3 && !node.textContent.trim()) || (node.nodeType === 1 && node.tagName === 'BR');
    if (!cur && blank) { node.remove(); continue; }
    if (!cur) {
      cur = document.createElement('p');
      body.insertBefore(cur, node);
    }
    cur.appendChild(node);
  }
  if (!body.querySelector('p')) body.innerHTML = '<p><br></p>';
}

function sheetBackdrop(kind, label, inner) {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop page-sheet-backdrop';
  bd.innerHTML = `
    <div class="page-sheet" role="dialog" aria-modal="true">
      <div class="ps-bar"><span class="ps-name"></span><button class="m-ok ps-done">${t('Done')}</button></div>
      <div class="ps-paper kind-${kind}">${inner}</div>
    </div>`;
  bd.querySelector('.ps-name').textContent = label;
  bd.querySelector('.page-sheet').setAttribute('aria-label', label);
  return bd;
}

// the lines of a page that say who said the lines above them (a dash first)
const ATTRIBUTED_PAGES = ['dedication', 'epigraph', 'part'];

async function openPageSheet(shelf, meta, label) {
  const live = (await window.neo.readBookMeta(meta.id)) || meta;
  let chId = (live.chapterOrder || [])[0];
  if (!chId) {
    chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    live.chapterOrder = [chId];
    await writeBookMeta(live.id, live);
  }
  const html = await window.neo.readChapter(live.id, chId);
  const bd = sheetBackdrop(live.kind, label, '<div class="ps-label" hidden></div><div class="ps-body" contenteditable="true" role="textbox" aria-multiline="true"></div>');
  const lab = bd.querySelector('.ps-label');
  if (live.kind === 'part') { lab.hidden = false; lab.textContent = label; }
  if (PAGE_BACK.includes(live.kind)) { lab.hidden = false; lab.textContent = pageKindName(live.kind); }
  const body = bd.querySelector('.ps-body');
  body.setAttribute('aria-label', label);
  body.innerHTML = html && html.trim() ? html : '<p><br></p>';
  if (PAGE_PLACEHOLDERS[live.kind]) body.dataset.ph = PAGE_PLACEHOLDERS[live.kind]();
  // the page shows what it will print: a line that opens with a dash is set
  // as the name of whoever said the lines above it
  const settle = () => {
    body.classList.toggle('empty', !body.textContent.trim());
    if (!ATTRIBUTED_PAGES.includes(live.kind)) return;
    for (const p of body.querySelectorAll('p')) p.toggleAttribute('data-attr', isAttribution({ text: p.textContent.trim() }));
  };
  settle();
  let timer = null;
  let saved = body.innerHTML;
  const save = async () => {
    clearTimeout(timer);
    timer = null;
    normalizePageBody(body);
    const out = body.cloneNode(true);
    out.querySelectorAll('[data-attr]').forEach((p) => p.removeAttribute('data-attr'));
    if (out.innerHTML === saved) return;
    saved = out.innerHTML;
    await window.neo.writeChapter(live.id, chId, saved);
  };
  body.addEventListener('input', () => {
    settle();
    clearTimeout(timer);
    timer = setTimeout(save, 600);
  });
  body.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (pasted) document.execCommand('insertHTML', false, cleanPasteHtml(pasted));
    else if (text) {
      text.replace(/\r/g, '').split(/\n+/).filter((p) => p.trim()).forEach((p, i) => {
        if (i > 0) document.execCommand('insertParagraph');
        document.execCommand('insertText', false, p.trim());
      });
    }
  });
  document.body.appendChild(bd);
  document.execCommand('defaultParagraphSeparator', false, 'p');
  const close = async () => {
    if (!bd.isConnected) return;
    await save();
    bd.remove();
  };
  bd.querySelector('.ps-done').onclick = close;
  bd.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  // the caret waits at the end of whatever the page already says
  body.focus();
  caretToEnd(body.lastElementChild || body);
}

function caretToEnd(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

// The cover opens to the title page: the book's title (the shelf's name),
// a subtitle, and the name it goes out under. One line each; Enter moves on.
async function openTitlePage(shelf, coverMeta) {
  const live = (await window.neo.readBookMeta(coverMeta.id)) || coverMeta;
  const bd = sheetBackdrop('title', t('Title Page'), `
    <div class="tp-field tp-t" contenteditable="true" role="textbox" spellcheck="false"></div>
    <div class="tp-field tp-s" contenteditable="true" role="textbox" spellcheck="false"></div>
    <div class="tp-field tp-a" contenteditable="true" role="textbox" spellcheck="false"></div>`);
  const fields = ['.tp-t', '.tp-s', '.tp-a'].map((s) => bd.querySelector(s));
  const [ti, su, au] = fields;
  const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
  [[ti, shelf.name, t('Title')], [su, live.subtitle || '', t('Subtitle')], [au, live.author || shelfAuthorName(shelf), t('Author')]]
    .forEach(([el, value, name]) => {
      el.textContent = value;
      el.dataset.ph = name;
      el.setAttribute('aria-label', name);
    });
  const close = async () => {
    if (!bd.isConnected) return;
    bd.remove();
    const title = text(ti) || shelf.name;
    const subtitle = text(su);
    const author = text(au) || shelfAuthorName(shelf);
    if (title === shelf.name && subtitle === (live.subtitle || '') && author === (live.author || '')) return;
    shelf.name = title;
    live.title = title;
    live.subtitle = subtitle;
    live.author = author;
    await writeBookMeta(live.id, live);
    await writeLibrary(library);
    renderShelves();
  };
  for (const f of fields) {
    // an emptied line shows its name again
    f.addEventListener('input', () => { if (!f.textContent) f.innerHTML = ''; });
    f.addEventListener('paste', (e) => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\s+/g, ' '));
    });
    f.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const next = fields[fields.indexOf(f) + 1];
      if (next) { next.focus(); caretToEnd(next); } else close();
    });
  }
  document.body.appendChild(bd);
  bd.querySelector('.ps-done').onclick = close;
  bd.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  ti.focus();
  const r = document.createRange();
  r.selectNodeContents(ti);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

/* ---------- the bound shelf's own menu (right-click its name) ---------- */

async function boundShelfMenu(shelf) {
  const through = (shelf.binding.numbering || 'through') !== 'restart';
  const options = [
    { label: t('Export the book…'), desc: t('EPUB, Word or PDF, with its cover, its pages and one table of contents.'), value: 'export' },
    {
      label: (through ? '✓ ' : '') + t('Number chapters straight through'),
      desc: through ? t('Each title picks up where the one before it left off.') : t('Each title starts again at Chapter 1.'),
      value: 'numbering'
    },
    { label: t('Unbind'), desc: t('A shelf of separate titles again. Its pages wait for the next binding.'), value: 'unbind' }
  ];
  // a touch screen has no hover to show the pages it could still have
  const missing = [];
  if (NO_HOVER) {
    const have = new Set();
    const body = [];
    for (const id of shelf.bookIds) {
      const m = await shelfMeta(id);
      if (isPageMeta(m)) have.add(m.kind);
      else if (m) body.push(m);
    }
    const offer = missingPages(body);
    missing.push(...[...PAGE_FRONT, 'prologue', 'epilogue', ...PAGE_BACK].filter((k) => !have.has(k) && offer(k)));
    if (missing.length) options.splice(1, 0, { label: t('Add a page…'), value: 'page' });
  }
  const choice = await optionModal(escHtml(t('“{name}” · one book', { name: shelf.name })), null, options);
  if (choice === 'export') {
    await exportBoundBook(shelf);
  } else if (choice === 'page') {
    const kind = await optionModal(t('Add a page…'), null, missing.map((k) => ({ label: pageKindName(k), value: k })));
    if (kind) await addPage(shelf, kind);
  } else if (choice === 'numbering') {
    shelf.binding.numbering = through ? 'restart' : 'through';
    await writeLibrary(library);
    toast(through ? t('Each title starts again at Chapter 1') : t('Chapters are numbered straight through'));
  } else if (choice === 'unbind') {
    await unbindShelf(shelf);
  }
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
  if (isScript(meta)) return; // a script wears its card (scriptTile)
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

function bookTile(meta, opts = {}) {
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
  if (isScript(meta)) scriptTile(el, meta);
  else {
    dressTile(el, meta);
    el.querySelector('.b-painting').hidden = !(meta.coverArt && meta.coverArt.status === 'pending');
    el.querySelector('.b-refresh').onclick = async (e) => {
      e.stopPropagation();
      await refreshCover(meta, el);
    };
  }
  if (meta.wordGoal > 0) {
    const bar = el.querySelector('.b-progress');
    bar.hidden = false;
    const pct = Math.min(100, Math.round(((meta.wordCount || 0) / meta.wordGoal) * 100));
    bar.firstElementChild.style.width = pct + '%';
  }
  el.title = meta.wordGoal
    ? t('{title} — {count} / {goal} words', { title: shownTitle(meta.title), count: meta.wordCount || 0, goal: meta.wordGoal })
    : shownTitle(meta.title);
  el.onclick = () => (opts.cover ? openTitlePage(opts.cover, meta) : openBook(meta.id));
  pressable(el, [el.title, meta.author ? t('by {author}', { author: meta.author }) : ''].filter(Boolean).join(', '));
  const refresh = el.querySelector('.b-refresh');
  if (refresh) refresh.setAttribute('aria-hidden', 'true'); // the book's right-click menu offers the same
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
    if (/\.(png|jpe?g|webp)$/i.test(p) && !isScript(meta)) {
      const fname = await window.neo.setCover(meta.id, p);
      if (fname) {
        meta.coverImage = fname;
        meta.coverMode = 'image';
        await writeBookMeta(meta.id, meta);
        renderShelves();
      }
    } else if (/\.(docx|txt|md|fountain|fdx)$/i.test(p)) {
      const homeShelf = library.shelves.find((s) => s.bookIds.includes(meta.id)) || library.shelves[0];
      const results = await window.neo.importFiles([p]);
      if (results.length) await addImportedBooks(results, homeShelf);
    }
  });

  el.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (opts.cover) { await boundCoverMenu(opts.cover, meta, el); return; }
    // on a bound shelf, a title can open a new part of the book
    const home = shelfOf(meta.id);
    let startPart = false;
    if (isBound(home)) {
      const at = home.bookIds.indexOf(meta.id);
      const prev = at > 0 ? bookMetaCache.get(home.bookIds[at - 1]) : null;
      startPart = !(prev && prev.kind === 'part');
    }
    const script = isScript(meta);
    const trashLabel = window.Capacitor ? t('Delete book')
      : navigator.platform.toLowerCase().includes('win') ? t('Move to Recycle Bin') : t('Move to Trash');
    const canCopy = !!window.neo.duplicateBook && !isPageMeta(meta) && featureOn('penNames');
    // the cover's own choices, gathered in one place
    const coverItems = script ? [] : [
      ...(NO_HOVER ? [] : [{ label: meta.coverImage ? t('Replace cover art…') : t('Set cover art…'), value: 'cover' }]),
      { label: t('New cover'), value: 'refresh' },
      ...(!window.Capacitor ? [{ label: t('Save cover as image…'), value: 'saveCover' }] : []),
      ...(meta.coverImage ? ['-', { label: t('Remove cover art'), value: 'uncover', danger: true }] : [])
    ];
    let choice;
    // (a book's word goal is set in Goals, inside the book)
    if (NO_HOVER || window.Capacitor) {
      // a touch screen, and simple NEO: the larger cards, each saying what it
      // does. Simple NEO has no cover menu: art is dragged onto the book, and
      // New cover and Remove cover art stand with the rest.
      const options = [];
      if (startPart) options.push({ label: t('Start a part here'), desc: t('A part page goes in before “{title}”.', { title: escHtml(shownTitle(meta.title)) }), value: 'part' });
      options.push(window.Capacitor
        ? { label: t('Export…'), desc: script ? t('PDF, Fountain or Final Draft, through the share sheet.') : featureOn('exports') ? t('Text, Markdown, HTML, PDF, Word or EPUB, through the share sheet.') : t('PDF, Word or EPUB, through the share sheet.'), value: 'export' }
        : { label: t('Export…'), desc: script || featureOn('exports') || isPageMeta(meta) ? '' : t('PDF, Word, EPUB, or a paperback for KDP.'), value: 'export' });
      if (canCopy) options.push({ label: t('Duplicate'), desc: t('A copy of the whole book on this shelf, to keep as a backup or try another version.'), value: 'duplicate' });
      if (coverItems.length && featureOn('covers')) options.push({ label: t('Cover'), desc: t('A new cover, your own art, or a saved image.'), value: 'coverMenu' });
      else if (coverItems.length) {
        options.push({ label: t('New cover'), desc: t('A fresh abstract and a different title style.'), value: 'refresh' });
        if (meta.coverImage) options.push({ label: t('Remove cover art'), desc: t('Deletes the image from the book folder. (To just hide it, use the ↻ on the book.)'), danger: true, value: 'uncover' });
      }
      options.push(
        { label: t('Remove from bookshelf'), desc: t('Takes it off your shelves. The files stay safe in your NEO Library folder on disk.'), value: 'remove' },
        { label: trashLabel, desc: window.Capacitor ? t('Moves the book folder to Deleted Books in your NEO Library, where you can recover it.') : t('Sends the book folder to your system trash, where you can recover it.'), danger: true, value: 'trash' }
      );
      choice = await optionModal(t('“{title}”', { title: escHtml(shownTitle(meta.title)) }), null, options);
      if (choice === 'coverMenu') choice = await optionModal(t('Cover'), null, coverItems.filter((x) => x !== '-'));
    } else {
      // the desktop: a small menu at the pointer, the cover's choices one level in
      const items = [];
      if (startPart) items.push({ label: t('Start a part here'), value: 'part' }, '-');
      items.push({ label: t('Export…'), value: 'export' });
      if (canCopy) items.push({ label: t('Duplicate'), value: 'duplicate' });
      if (coverItems.length) items.push({ label: t('Cover') + '  ›', value: 'coverMenu' });
      items.push('-', { label: t('Remove from bookshelf'), value: 'remove' }, { label: trashLabel, value: 'trash', danger: true });
      const x = e.clientX;
      const y = e.clientY;
      choice = await popMenu(x, y, items, { title: shownTitle(meta.title), from: el });
      if (choice === 'coverMenu') choice = await popMenu(x, y, coverItems, { title: t('Cover'), from: el });
    }
    if (choice === 'part') {
      await addPage(home, 'part', meta.id);
    } else if (choice === 'duplicate') {
      await duplicateBook(meta);
    } else if (choice === 'refresh') {
      await refreshCover(meta, el);
    } else if (choice === 'export' && script) {
      const fmt = await optionModal(t('Export “{title}”', { title: escHtml(shownTitle(meta.title)) }), null, [
        { label: 'PDF (.pdf)', value: 'pdf' },
        { label: 'Fountain (.fountain)', value: 'fountain' }, { label: 'Final Draft (.fdx)', value: 'fdx' }
      ]);
      if (!fmt) return;
      await openBook(meta.id);
      await doExport(fmt);
    } else if (choice === 'export') {
      const fmt = await optionModal(t('Export “{title}”', { title: escHtml(shownTitle(meta.title)) }), null, [
        ...(featureOn('exports') ? [{ label: t('Text (.txt)'), value: 'txt' }, { label: t('Markdown (.md)'), value: 'md' }, { label: t('HTML (.html)'), value: 'html' }] : []),
        { label: 'PDF (.pdf)', value: 'pdf' },
        { label: t('Word (.docx)'), value: 'docx' }, { label: t('EPUB (.epub)'), value: 'epub' },
        ...(window.Capacitor || isPageMeta(meta) ? [] : [{ label: t('Paperback for KDP…'), value: 'paperback' }])
      ]);
      if (!fmt) return;
      if (window.Capacitor || fmt === 'paperback') {
        await openBook(meta.id);
        await doExport(fmt);
      } else {
        await exportFromShelf(meta.id, fmt);
      }
    } else if (choice === 'cover') {
      const src = await window.neo.pickCover();
      if (!src) return;
      const fname = await window.neo.setCover(meta.id, src);
      if (fname) {
        meta.coverImage = fname;
        meta.coverMode = 'image';
        await writeBookMeta(meta.id, meta);
        renderShelves();
      }
    } else if (choice === 'refresh') {
      await refreshCover(meta, el);
    } else if (choice === 'saveCover') {
      await saveCoverImage(meta);
    } else if (choice === 'uncover') {
      await window.neo.removeCover(meta.id);
      meta.coverImage = null;
      await writeBookMeta(meta.id, meta);
      renderShelves();
    } else if (choice === 'remove') {
      for (const s of library.shelves) s.bookIds = s.bookIds.filter((b) => b !== meta.id);
      await writeLibrary(library);
      renderShelves();
      toast(t('“{title}” removed from the shelves — its files are still in your NEO Library', { title: shownTitle(meta.title) }));
    } else if (choice === 'trash') {
      const ok = await window.neo.deleteBook(meta.id, meta.title);
      if (ok) {
        for (const s of library.shelves) s.bookIds = s.bookIds.filter((b) => b !== meta.id);
        await writeLibrary(library);
        renderShelves();
      }
    }
  });
  return el;
}

// A copy of the whole book beside it on the shelf, titled as a copy; the
// writer renames it (or keeps it as a backup). The open book's unsaved
// words go to disk first, so the copy has them.
async function duplicateBook(meta) {
  if (book && book.id === meta.id) {
    await Promise.all(book.chapterOrder.filter((c) => chapterHTML[c] !== undefined && chapterHTML[c] !== savedHTML[c]).map((c) => persistChapter(c)));
    flushAllSaves();
    await saveMeta();
    await new Promise((resolve) => setTimeout(resolve, 300)); // notes and sidecars, written alongside
  }
  let copy;
  try {
    copy = await window.neo.duplicateBook(meta.id, t('{title} (copy)', { title: meta.title }));
  } catch (err) {
    window.neo.logError('duplicate: ' + (err && err.stack || err));
    toast(t('Couldn’t copy the book: {error}', { error: plainError(err) }), 8000);
    return;
  }
  bookMetaCache.set(copy.id, copy);
  // beside the original; a title in a bound book gets its copy on a shelf
  // of its own, so the bound book doesn't print the story twice
  let shelf = library.shelves.find((x) => x.bookIds.includes(meta.id)) || library.shelves[0];
  if (isBound(shelf)) {
    const bound = shelf;
    shelf = library.shelves.find((x) => !isBound(x) && x.authorId === bound.authorId) || library.shelves.find((x) => !isBound(x));
    if (!shelf) {
      shelf = { id: 'shelf-' + Date.now().toString(36), name: t('Copies'), bookIds: [], ...(bound.authorId ? { authorId: bound.authorId } : {}) };
      library.shelves.push(shelf);
    }
    shelf.bookIds.push(copy.id);
  } else shelf.bookIds.splice(shelf.bookIds.indexOf(meta.id) + 1, 0, copy.id);
  await writeLibrary(library);
  renderShelves();
  toast(t('Made a copy: “{title}”', { title: copy.title }));
}

// The cover as a picture file: the writer's own image just as they gave it;
// otherwise the abstract at full size (1600×2560, KDP's ratio) with the
// title and author set on it. A painted cover never leaves NEO, here as in
// the exports, so a book showing one saves its abstract.
async function saveCoverImage(meta) {
  const defaultName = safeName(meta.title) + '-cover';
  let payload = null;
  if (coverMode(meta) === 'image') {
    const c = await window.neo.readCover(meta.id, meta.coverImage);
    if (c) payload = { format: c.ext, defaultName, content: c.base64, base64: true };
  }
  if (!payload) {
    await NeoCovers.ready;
    // JPEG: what KDP asks for, and a tenth the size of a PNG of all that grain
    const url = NeoCovers.renderFull(meta, {}).toDataURL('image/jpeg', 0.92);
    payload = { format: 'jpg', defaultName, content: url.split(',')[1], base64: true };
  }
  const saved = await window.neo.exportSave(payload);
  if (saved) toast(t('Saved: {file}', { file: saved.split(/[\\/]/).pop() }));
}

/* ---- painted covers ----
   At a thousand words a story has a shape, so NEO reads it and paints an
   abstract cover to sit under the type. The writer's own cover (coverImage)
   always wins; the abstract is the fallback; painting never blocks typing. */

const PAINT_AT = 1000;
const STALE_PAINT_MS = 10 * 60 * 1000; // a job that never came back

function paintable(meta) {
  if (!meta || meta.coverImage) return false; // the writer's own art is never painted over
  if (isScript(meta)) return false; // a script is card stock
  if (meta.kind) return false; // a bound book's pages show no cover of their own
  if ((meta.wordCount || 0) < PAINT_AT) return false;
  const art = meta.coverArt;
  if (!art) return true;
  if (art.status === 'pending') return Date.now() - Date.parse(art.at || 0) > STALE_PAINT_MS;
  return false; // done, shelved, or failed: the ↻ on the tile is the way back in
}

// What a painting reads: the story alone (its chapters, prologue and
// epilogue). The copyright, dedication, acknowledgments and about pages
// carry the writer's name and the book's, and stay on this computer.
function bookPlainText() {
  return book.chapterOrder.filter((id) => isStory(id)).map((id) => chapterText(id)).join('\n\n');
}

// Paint the open book, or a book on the shelf (text is read from disk then).
async function requestPaint(meta, text) {
  const provider = coverProvider();
  if (!(await window.neo.hasSecret(provider))) {
    if (!library.coverArtNudged) {
      library.coverArtNudged = true;
      await writeLibrary(library);
      toast(t('This story just passed {n} words — add an API key under File → Cover Art… and NEO will paint it a cover.', { n: PAINT_AT }), 8000);
    }
    return;
  }
  meta.coverArt = { status: 'pending', at: new Date().toISOString(), words: meta.wordCount || 0 };
  if (book && book.id === meta.id) scheduleMetaSave();
  else await writeBookMeta(meta.id, meta);
  markPainting(meta.id, true);
  if (text == null) {
    const m = await window.neo.readBookMeta(meta.id);
    const parts = [];
    for (const chId of (m && m.chapterOrder) || []) {
      if (!isStory(chId, m)) continue; // (the story alone, as bookPlainText)
      const holder = document.createElement('div');
      holder.innerHTML = await window.neo.readChapter(meta.id, chId);
      holder.querySelectorAll(UNCOUNTED).forEach((n) => n.remove());
      parts.push(holder.innerText);
    }
    text = parts.join('\n\n');
  }
  const cs = coverSettings();
  const mine = (cs.models && cs.models[provider]) || {};
  let res = null;
  try {
    res = await window.neo.paintCover(meta.id, text, { provider, textModel: mine.text, imageModel: mine.image, quality: cs.quality });
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
  else await writeBookMeta(meta.id, live);
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
  // a bound book's cover has no text of its own to paint from
  // (painting is behind Show More Features; a painting already made still shows)
  const hasKey = meta.kind !== 'cover' && featureOn('covers') && await window.neo.hasSecret(coverProvider());
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
  const choice = options.length === 1 ? 'reroll' : await optionModal(t('Cover for “{title}”', { title: escHtml(shownTitle(meta.title)) }), null, options);
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
  if (live === book) scheduleMetaSave(); else await writeBookMeta(meta.id, live);
  dressTile(el, live);
}

async function createBookOnShelf(shelf) {
  const meta = await window.neo.createBook({ author: displayAuthor() });
  meta.tabNames = {
    notes: (library.tabDefaults && library.tabDefaults.notes) || 'Notes',
    outline: (library.tabDefaults && library.tabDefaults.outline) || 'Outline'
  };
  await writeBookMeta(meta.id, meta);
  await placeTitle(shelf, meta.id);
  await writeLibrary(library);
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
  await writeLibrary(library);
  await renderShelves();
  // the new shelf may be below the fold: bring it up, name ready to type over
  const shelves = $$('#shelves .shelf');
  const last = shelves[shelves.length - 1];
  if (last) {
    last.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    const label = last.querySelector('.shelf-label');
    if (label) setTimeout(() => {
      if (NO_HOVER) { label.click(); return; }
      label.focus();
      const r = document.createRange();
      r.selectNodeContents(label); // selected: typing replaces "New Shelf"
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
  await placeTitle(shelf, bookId, true); // the top shelf, first in line
  meta.author = target.name;
  await writeBookMeta(bookId, meta);
  await writeLibrary(library);
  renderShelves();
  toast(t('“{title}” now sits on {name}’s top shelf — Esc puts it back', { title: shownTitle(meta.title), name: target.name }), 6000);
}
async function undoShelfMove() {
  const m = lastShelfMove;
  if (!m || Date.now() - m.at > 15000) return false;
  lastShelfMove = null;
  const home = library.shelves.find((s) => s.id === m.shelfId) || shelvesFor(m.authorId)[0] || library.shelves[0];
  for (const s of library.shelves) s.bookIds = s.bookIds.filter((b) => b !== m.bookId);
  home.bookIds.splice(Math.min(m.index, home.bookIds.length), 0, m.bookId);
  const meta = await window.neo.readBookMeta(m.bookId);
  if (meta) { meta.author = m.author; await writeBookMeta(m.bookId, meta); }
  await writeLibrary(library);
  renderShelves();
  toast(t('“{title}” is back where it was', { title: shownTitle(m.title) }));
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
  const shelved = new Set(library.shelves.flatMap((s) => [...s.bookIds, ...((s.binding && s.binding.parked) || []).map((p) => p.id)]));
  // a bound book's pages aren't books to write in
  const loose = all.filter((b) => !shelved.has(b.id) && !b.kind).sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));
  if (!loose.length) { toast(t('Every book in your library is already on a shelf')); return; }
  const pick = await optionModal(t('Books in your library that aren’t on a shelf'), null,
    loose.map((b) => ({ label: escHtml(b.title), desc: b.author ? escHtml(t('by {author}', { author: b.author })) : '', value: b.id })));
  if (!pick) return;
  const shelf = shelvesFor(currentAuthor().id)[0] || library.shelves[0];
  await placeTitle(shelf, pick);
  await writeLibrary(library);
  renderShelves();
  toast(t('“{title}” is back on the shelf', { title: loose.find((b) => b.id === pick).title }));
}

$('#author-chip').onclick = async () => {
  const cur = currentAuthor();
  const opts = [];
  for (const a of library.authors) {
    if (a.id !== cur.id) {
      opts.push({ label: t('Write as {name}', { name: escHtml(a.name) }), desc: t('Switch to this name’s shelves'), value: 'sw:' + a.id });
    }
  }
  opts.push({ label: t('Rename {name}', { name: escHtml(cur.name) }), value: 'rename' });
  // a second name is behind Show More Features; names already made stay reachable
  if (featureOn('penNames')) opts.push({ label: t('Add a pen name…'), desc: t('A separate set of shelves under another name'), value: 'add' });
  if (library.authors.length > 1) {
    opts.push({
      label: t('Remove {name}', { name: escHtml(cur.name) }),
      desc: t('These shelves and books move to your other name. Nothing is deleted from disk.'),
      danger: true, value: 'del'
    });
  }
  const pick = await optionModal(t('Writing as {name}', { name: escHtml(cur.name) }), null, opts);
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
  await writeLibrary(library);
  renderShelves();
};
