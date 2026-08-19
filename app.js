/* =============================== NEO =============================== */
/* Renderer logic. Talks to disk only through window.neo (preload).   */

'use strict';

// ---------- state ----------
let library = null;          // library.json
let book = null;             // current book.json
let chapterHTML = {};        // chapterId -> html (loaded at open)
let stickies = [];           // [{id, chapterId, text, resolved}]
let darlings = [];           // [{id, html, text, chapterId, chapterLabel, date}]
let currentTab = 'manuscript';
let currentChapterId = null; // chapter the caret/scroll is in
let wordMode = 'book';       // 'book' | 'chapter'
let saveTimers = {};
let hintShown = false;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------- tiny modal helper (Electron has no window.prompt) ----------
function askInput(title, placeholder, value = '') {
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `
      <div class="modal" style="width:380px">
        <h2 style="font-size:16px">${title}</h2>
        <input type="text" spellcheck="false" placeholder="${placeholder}" />
        <div style="text-align:right;margin-top:14px">
          <button class="m-cancel" style="background:none;border:none;color:#888;margin-right:14px">Cancel</button>
          <button class="m-ok" style="background:var(--accent);border:none;border-radius:6px;padding:7px 18px;color:#191919">OK</button>
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

// A list of choices, one click. Resolves the chosen value, or null on cancel.
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
          <button class="m-cancel" style="background:none;border:none;color:#888">Cancel</button>
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

function toast(msg, ms = 4000) {
  const h = $('#hint');
  h.textContent = msg;
  h.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { h.hidden = true; }, ms);
}

const countWords = (text) => (text.trim().match(/\S+/g) || []).length;

// Clean copy of a chapter: no darling anchors, no placeholder marks, no ghost outlines
function cleanChapterEl(id) {
  const el = document.querySelector(`.chapter[data-id="${id}"] .chapter-body`);
  const holder = document.createElement('div');
  holder.innerHTML = el ? el.innerHTML : (chapterHTML[id] || '');
  holder.querySelectorAll('.darling-anchor, .ph-mark, .ghost').forEach((n) => n.remove());
  return holder;
}
const chapterText = (id) => cleanChapterEl(id).innerText;

// Word counts are cached per chapter and only recomputed for the chapter
// being edited — so a 200k-word epic types as fast as a short story.
let wordCache = {};
function chapterWords(chId) {
  if (wordCache[chId] == null) wordCache[chId] = countWords(chapterText(chId));
  return wordCache[chId];
}

/* ================================================================== */
/*  BOOKSHELF                                                          */
/* ================================================================== */

async function loadLibrary() {
  library = await window.neo.readLibrary();
  if (!library.firstRunDone) {
    showFirstRun();
  }
  renderShelves();
}

function showFirstRun() {
  const fr = $('#firstrun');
  fr.hidden = false;
  let picked = { body: 'Georgia', dropcap: 'literary' };

  // Step 1: who are you, and how do you write?
  $$('.fr-choice').forEach((btn) => {
    btn.onclick = () => {
      library.authorName = $('#fr-name').value.trim();
      const pen = $('#fr-pen').value.trim();
      library.penNames = pen ? [pen] : [];
      library.writingStyle = btn.dataset.style;
      $('#fr-step1').hidden = true;
      $('#fr-step2').hidden = false;
      buildFontStep();
    };
  });

  // Step 2: fonts, with a live sample
  function preview() {
    document.documentElement.style.setProperty('--body-font', BODY_FONTS[picked.body]);
    document.documentElement.style.setProperty('--dropcap-font', DROPCAP_FONTS[picked.dropcap]);
  }
  function buildFontStep() {
    const bodyRow = $('#fr-bodyfonts');
    bodyRow.innerHTML = '';
    for (const name of Object.keys(BODY_FONTS)) {
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
    const caps = { literary: 'Literary', fantasy: 'Fantasy', scifi: 'Sci-Fi' };
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
    await window.neo.writeLibrary(library);
    applyFonts();
    fr.hidden = true;
    renderShelves();
  };
}

function displayAuthor() {
  return (library.penNames && library.penNames[0]) || library.authorName || 'Anonymous';
}

async function renderShelves() {
  $('#author-chip').textContent = displayAuthor();
  const wrap = $('#shelves');
  wrap.innerHTML = '';
  // shelves drag by their grip to reorder, with a gold bar showing the landing
  // spot (wired once — renderShelves runs often, listeners must not stack)
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
      renderShelves();
    });
  }

  for (const shelf of library.shelves) {
    const sec = document.createElement('section');
    sec.className = 'shelf';

    const grip = document.createElement('span');
    grip.className = 'shelf-grip';
    grip.textContent = '⠿';
    grip.title = 'Drag to reorder shelves';
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
    label.contentEditable = 'true';
    label.spellcheck = false;
    label.textContent = shelf.name;
    label.addEventListener('blur', async () => {
      shelf.name = label.textContent.trim() || shelf.name;
      label.textContent = shelf.name;
      await window.neo.writeLibrary(library);
    });
    label.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); label.blur(); }
    });
    // right-click a shelf label: publish it as one book, or delete it
    label.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      const choice = await optionModal(`Shelf “${shelf.name}”`, null, [
        {
          label: 'Export shelf as anthology…',
          desc: `Collect ${shelf.bookIds.length ? 'its ' + shelf.bookIds.length : 'the'} work${shelf.bookIds.length === 1 ? '' : 's'}, in shelf order, into a single book with a table of contents.`,
          value: 'anthology'
        },
        { label: 'Delete shelf', desc: 'Books move to another shelf. Nothing is deleted from disk.', danger: true, value: 'del' }
      ]);
      if (choice === 'anthology') {
        await exportShelfAnthology(shelf);
      } else if (choice === 'del') {
        if (library.shelves.length === 1) {
          toast('This is your only shelf — add another before deleting this one');
          return;
        }
        const other = library.shelves.find((s) => s.id !== shelf.id);
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
    // manuscript files straight from Finder — the shelf takes them all
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
        if (e.clientX < r.left + r.width / 2) {
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
        toast('Importing…');
        const results = await window.neo.importFiles(paths);
        if (!results.length) { toast('No .docx, .txt, or .md files in that drop'); return; }
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
      renderShelves();
    });

    for (const bookId of shelf.bookIds) {
      const meta = await window.neo.readBookMeta(bookId);
      if (!meta) continue;
      row.appendChild(bookTile(meta));
    }

    // the blank page — click to begin
    const blank = document.createElement('div');
    blank.className = 'new-book';
    blank.textContent = '+';
    blank.title = 'Start a new book';
    blank.onclick = () => createBookOnShelf(shelf);
    row.appendChild(blank);

    sec.appendChild(label);
    sec.appendChild(row);
    wrap.appendChild(sec);
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

// A cheap, deterministic "cover": two hues drawn from the book's seed.
// Refresh folds in the current word count, so the cover evolves with the text.
function coverHash(meta) {
  const seed = String(meta.coverSeed || meta.id);
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

function coverGradient(meta) {
  const h = coverHash(meta);
  const hue1 = h % 360;
  const hue2 = (hue1 + 40 + (h >> 8) % 140) % 360;
  const angle = 115 + ((h >> 16) % 50);
  return `linear-gradient(${angle}deg, hsl(${hue1}, 55%, 38%) 0%, hsl(${hue2}, 60%, 22%) 100%)`;
}

function bookTile(meta) {
  const el = document.createElement('div');
  el.className = 'book cover cv-serif'; // the house style: Didot, framed
  el.draggable = true;
  el.innerHTML = `
    <div class="b-title"></div>
    <div class="b-author"></div>
    <span class="b-refresh" title="New cover, woven from the current text">&#8635;</span>
    <div class="b-progress" hidden><div></div></div>`;
  el.style.background = coverGradient(meta);
  // ALL CAPS, with each word's initial slightly larger — classic jacket typography
  const titleEl = el.querySelector('.b-title');
  const inner = document.createElement('span');
  inner.className = 'b-tt';
  (meta.title || 'Untitled').split(/\s+/).forEach((word, i) => {
    if (!word) return;
    if (i > 0) inner.appendChild(document.createTextNode(' '));
    const initial = document.createElement('span');
    initial.className = 'ti';
    initial.textContent = word.slice(0, 1).toUpperCase();
    inner.appendChild(initial);
    inner.appendChild(document.createTextNode(word.slice(1).toUpperCase()));
  });
  titleEl.appendChild(inner);
  el.querySelector('.b-author').textContent = meta.author || '';
  el.querySelector('.b-refresh').onclick = async (e) => {
    e.stopPropagation();
    meta.coverSeed = meta.id + ':' + (meta.wordCount || 0) + ':' + Date.now().toString(36);
    await window.neo.writeBookMeta(meta.id, meta);
    el.style.background = coverGradient(meta);
  };
  if (meta.wordGoal > 0) {
    const bar = el.querySelector('.b-progress');
    bar.hidden = false;
    const pct = Math.min(100, Math.round(((meta.wordCount || 0) / meta.wordGoal) * 100));
    bar.firstElementChild.style.width = pct + '%';
  }
  el.title = meta.wordGoal
    ? `${meta.title} — ${(meta.wordCount || 0).toLocaleString()} / ${meta.wordGoal.toLocaleString()} words`
    : meta.title;
  el.onclick = () => openBook(meta.id);
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/x-neo-book', meta.id);
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  el.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    const choice = await optionModal(`“${meta.title}”`, null, [
      { label: 'Set word goal…', desc: 'Adds the subtle progress bar to the cover.', value: 'goal' },
      { label: 'Remove from bookshelf', desc: 'Takes it off your shelves. The files stay safe in your NEO Library folder on disk.', value: 'remove' },
      { label: 'Move to Trash', desc: 'Sends the book folder to your Mac Trash.', danger: true, value: 'trash' }
    ]);
    if (choice === 'goal') {
      const goal = await askInput(`Word count goal for “${meta.title}”`, 'e.g. 80000 — blank removes the goal',
        meta.wordGoal ? String(meta.wordGoal) : '');
      if (goal === null) return;
      meta.wordGoal = parseInt(goal, 10) || 0;
      await window.neo.writeBookMeta(meta.id, meta);
      renderShelves();
    } else if (choice === 'remove') {
      for (const s of library.shelves) s.bookIds = s.bookIds.filter((b) => b !== meta.id);
      await window.neo.writeLibrary(library);
      renderShelves();
      toast(`“${meta.title}” removed from the shelves — its files are still in your NEO Library`);
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

$('#add-shelf-btn').onclick = async () => {
  library.shelves.push({
    id: 'shelf-' + Date.now().toString(36),
    name: 'New Shelf',
    bookIds: []
  });
  await window.neo.writeLibrary(library);
  renderShelves();
};

$('#author-chip').onclick = async () => {
  const name = await askInput('Author name', 'Shown on your title pages', displayAuthor());
  if (name === null) return;
  library.authorName = name || '';
  await window.neo.writeLibrary(library);
  renderShelves();
};

/* ================================================================== */
/*  EDITOR — open / render                                             */
/* ================================================================== */

async function openBook(bookId) {
  book = await window.neo.readBookMeta(bookId);
  if (!book) return;
  currentChapterId = null; // never carry a chapter reference across books
  undoStack = [];
  chapterHTML = {};
  for (const chId of book.chapterOrder) {
    chapterHTML[chId] = await window.neo.readChapter(bookId, chId);
  }
  stickies = await window.neo.readJSON(bookId, 'stickies', []);
  darlings = await window.neo.readJSON(bookId, 'darlings', []);

  $('#bookshelf-view').hidden = true;
  $('#editor-view').hidden = false;
  document.execCommand('defaultParagraphSeparator', false, 'p');

  $('#tp-title').textContent = book.title === 'Untitled' ? '' : book.title;
  $('#tp-subtitle').textContent = book.subtitle || '';
  $('#tp-author').textContent = book.author || 'Anonymous';
  $$('.tab[data-tab="notes"]')[0].textContent = book.tabNames.notes;
  $$('.tab[data-tab="outline"]')[0].textContent = book.tabNames.outline;

  renderChapters();
  renderStickies();
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

  if (!hintShown) {
    hintShown = true;
    setTimeout(() => toast('Enter twice = section break · three times = new chapter · ⌘/ shows everything else', 7000), 800);
  }
}

function renderChapters() {
  const wrap = $('#chapters');
  wrap.innerHTML = '';
  wordCache = {};
  book.chapterTitles = book.chapterTitles || {};
  // a lone chapter is just "the story" — no heading until a second one exists,
  // at which point both appear, numbered (shorts stay clean, novels stay novels)
  const solo = book.chapterOrder.length === 1;
  book.chapterOrder.forEach((chId, i) => {
    const sec = document.createElement('section');
    sec.className = 'chapter sheet' + (solo ? ' solo' : '');
    sec.dataset.id = chId;
    const head = document.createElement('div');
    head.className = 'chapter-head';
    head.title = 'Right-click for chapter options · click after the number to add a title';
    const num = document.createElement('span');
    num.className = 'ch-num';
    num.textContent = 'Chapter ' + (i + 1);
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
      if (e.key === 'Enter') { e.preventDefault(); titleSpan.blur(); }
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
    body.spellcheck = spellOn;
    body.innerHTML = chapterHTML[chId] || '<p><br></p>';
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
      chapterLabel: `deleted Chapter ${index + 1}`,
      date: new Date().toISOString()
    });
    await window.neo.writeJSON(book.id, 'darlings', darlings);
  }
  if (currentChapterId === chId) currentChapterId = null;
  await deleteChapterQuiet(chId);
  if (text) toast('Chapter removed — its words are in Darlings, or ⌘Z to undo');
}

async function chapterMenu(chId, index) {
  const words = countWords(chapterText(chId));
  const choice = await optionModal(
    `Chapter ${index + 1}`,
    words ? `${words.toLocaleString()} words.` : 'This chapter is empty.',
    [{ label: 'Delete chapter', desc: words ? 'Its words move to Darlings, recoverable anytime.' : 'Nothing to save — it just goes.', danger: true, value: 'delete' }]
  );
  if (choice === 'delete') await deleteChapterToDarlings(chId);
}

/* ================================================================== */
/*  EDITOR — typing                                                    */
/* ================================================================== */

function wireChapterBody(body, chId) {
  body.addEventListener('focus', () => { currentChapterId = chId; updateCounters(); highlightNav(); });
  body.addEventListener('input', () => {
    chapterHTML[chId] = body.innerHTML;
    wordCache[chId] = null;
    scheduleChapterSave(chId);
    updateCounters();
    scheduleNavRefresh();
  });
  // paste arrives as clean prose: paragraphs, bold, italic — nothing else.
  // Word/web formatting (fonts, colors, spans) never touches the manuscript.
  body.addEventListener('paste', (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (html) {
      document.execCommand('insertHTML', false, cleanPasteHtml(html));
    } else if (text) {
      const parts = text.replace(/\r/g, '').split(/\n+/).filter((p) => p.trim());
      parts.forEach((p, i) => {
        if (i > 0) document.execCommand('insertParagraph');
        document.execCommand('insertText', false, p.trim());
      });
    }
  });
  // While macOS composes input (dead keys, dictation, some international
  // layouts), our shortcuts stand down completely — intercepting mid-composition
  // keystrokes is how phantom characters get born.
  let composing = false;
  body.addEventListener('compositionstart', () => { composing = true; });
  body.addEventListener('compositionend', () => { composing = false; });
  body.addEventListener('keydown', (e) => {
    if (composing || e.isComposing || e.keyCode === 229) return;
    if (handleEnter(e, body, chId)) return;
    smartKeys(e, body);
  });
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
  // the moment real typing hits a ghost, it becomes prose
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

// Enter once: new paragraph. Enter twice: *** section break.
// Enter three times: new chapter, numbered and drop-capped for you.
function handleEnter(e, body, chId) {
  if (e.key !== 'Enter' || e.shiftKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  let el = sel.anchorNode;
  if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const block = el && el.closest ? el.closest('p') : null;
  if (!block || !body.contains(block)) return false;
  if (block.textContent.trim() !== '') return false; // normal Enter on a real paragraph

  const prev = block.previousElementSibling;

  // Third Enter: the empty paragraph sits right under a *** break — make a chapter
  if (prev && prev.classList.contains('scene-break')) {
    e.preventDefault();
    prev.remove();
    block.remove();
    if (!body.querySelector('p')) body.innerHTML = '<p><br></p>';
    syncChapter(body, chId);
    currentChapterId = chId;
    newChapter();
    return true;
  }

  // Second Enter: empty paragraph (not the chapter's first) becomes a *** break
  if (prev) {
    e.preventDefault();
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
    return true;
  }
  return false;
}

function syncChapter(body, chId) {
  chapterHTML[chId] = body.innerHTML;
  wordCache[chId] = null;
  scheduleChapterSave(chId);
  updateCounters();
  scheduleNavRefresh();
}

// Reduce pasted HTML to what a manuscript is made of: paragraphs, bold, italic.
function cleanPasteHtml(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  holder.querySelectorAll('script,style,meta,link,img,table').forEach((n) => n.remove());
  let blocks = [...holder.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6')];
  if (!blocks.length) blocks = [holder]; // inline-only clipboard
  const out = blocks.map((b) => {
    const inner = paraRuns(b.innerHTML).map((r) => {
      let t = escHtml(r.text);
      if (r.i) t = '<i>' + t + '</i>';
      if (r.b) t = '<b>' + t + '</b>';
      return t;
    }).join('');
    return inner.trim() ? '<p>' + inner + '</p>' : '';
  }).filter(Boolean);
  // single block pastes inline (no forced new paragraph)
  if (out.length === 1) return out[0].slice(3, -4);
  return out.join('');
}

// Em dash, ellipsis, smart quotes — without ever leaving the keyboard.
function smartKeys(e, body) {
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
  if (e.key === '"' || e.key === "'") {
    e.preventDefault();
    const before = prevChars(1);
    const opening = before === '' || /[\s\(\[\{—‘“>]/.test(before);
    const ch = e.key === '"'
      ? (opening ? '“' : '”')
      : (opening ? '‘' : '’');
    document.execCommand('insertText', false, ch);
  }
}

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
  book.title = $('#tp-title').textContent.trim() || 'Untitled';
  scheduleMetaSave();
});
$('#tp-subtitle').addEventListener('input', () => {
  book.subtitle = $('#tp-subtitle').textContent.trim();
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
  if (e.key === 'Escape') {
    if (!$('#searchbar').hidden) closeSearch();
    else if (siloActive) exitSiloAttempt();
    else window.neo.fullscreenEscape().then((exited) => { if (!exited) backToShelf(); });
  }
});

// Escape also exits regular fullscreen from the bookshelf
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !$('#editor-view').hidden) return;
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  if (siloActive) { exitSiloAttempt(); return; }
  window.neo.fullscreenEscape();
});

function createChapterAt(idx) {
  const chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  book.chapterOrder.splice(idx, 0, chId);
  chapterHTML[chId] = '<p><br></p>';
  window.neo.writeChapter(book.id, chId, chapterHTML[chId]);
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
  // derive the chapter from where the caret actually is — never from stale state
  let el = sel.anchorNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const bodyEl = el && el.closest ? el.closest('.chapter-body') : null;
  if (!bodyEl) {
    toast('Click into a chapter first, then ⌘⇧X drops a placeholder');
    return;
  }
  currentChapterId = bodyEl.closest('.chapter').dataset.id;
  const sid = 's-' + Date.now().toString(36);
  const span = document.createElement('span');
  span.className = 'ph-mark';
  span.dataset.sid = sid;
  span.contentEditable = 'false';
  span.textContent = '?';
  const range = sel.getRangeAt(0);
  range.collapse(false);
  range.insertNode(span);
  // park the caret just past the mark and keep writing
  const after = document.createTextNode(' ');
  span.after(after);
  range.setStartAfter(after);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);

  stickies.push({ id: sid, chapterId: currentChapterId, text: '', resolved: false });
  window.neo.writeJSON(book.id, 'stickies', stickies);
  chapterHTML[currentChapterId] = document.querySelector(
    `.chapter[data-id="${currentChapterId}"] .chapter-body`
  ).innerHTML;
  scheduleChapterSave(currentChapterId);
  renderStickies();
  scheduleNavRefresh();
}

function renderStickies() {
  const wrap = $('#sticky-list');
  wrap.innerHTML = '';
  const open = stickies.filter((s) => !s.resolved);
  if (open.length === 0) {
    wrap.innerHTML = `<div class="stickies-empty">No notes yet.<br><br>Hit ⌘⇧X while writing to drop a placeholder — a “come back to this” mark that never breaks your flow.</div>`;
    return;
  }
  for (const s of open) {
    const chIdx = book.chapterOrder.indexOf(s.chapterId);
    const el = document.createElement('div');
    el.className = 'sticky unresolved';
    el.dataset.sid = s.id;
    el.innerHTML = `
      <div class="s-ch">${chIdx >= 0 ? 'Chapter ' + (chIdx + 1) : 'Unplaced'}</div>
      <textarea placeholder="What needs doing here?" spellcheck="false"></textarea>
      <div class="s-actions"><button class="s-go">Go to</button> <button class="s-done">Resolve</button></div>`;
    const ta = el.querySelector('textarea');
    ta.value = s.text;
    ta.addEventListener('input', () => {
      s.text = ta.value;
      clearTimeout(saveTimers.stickies);
      saveTimers.stickies = setTimeout(() => window.neo.writeJSON(book.id, 'stickies', stickies), 600);
    });
    el.querySelector('.s-go').onclick = () => {
      switchTab('manuscript');
      const mark = document.querySelector(`.ph-mark[data-sid="${s.id}"]`);
      if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    el.querySelector('.s-done').onclick = () => resolveSticky(s.id);
    wrap.appendChild(el);
  }
}

function resolveSticky(sid) {
  const mark = document.querySelector(`.ph-mark[data-sid="${sid}"]`);
  if (mark) {
    const chId = mark.closest('.chapter').dataset.id;
    mark.remove();
    chapterHTML[chId] = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`).innerHTML;
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

function renderNav() {
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
    item.innerHTML = `<div class="n-row" title="Drag to reorder chapters"><span class="n-label"></span>
      <span style="display:flex;align-items:center"><span class="n-words">${words.toLocaleString()}</span>${flagged ? '<span class="n-flag" title="Unresolved placeholder"></span>' : ''}</span></div>`;
    item.querySelector('.n-label').textContent = book.chapterOrder.length === 1
      ? (book.title || 'The story')
      : (chTitle ? `${i + 1} · ${chTitle}` : `Chapter ${i + 1}`);

    // the row is the drag handle, so the note below stays freely editable
    const rowEl = item.querySelector('.n-row');
    rowEl.draggable = true;
    rowEl.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-neo-chapter', chId);
      item.classList.add('dragging');
    });
    rowEl.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      const ind = document.querySelector('.nav-drop-ind');
      if (ind) ind.remove();
    });

    // outline your whole book from this panel: a note per chapter
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
  toast('Chapters reordered — ⌘Z to undo');
});

function highlightNav() {
  $$('.nav-item').forEach((el) => el.classList.toggle('current', el.dataset.id === currentChapterId));
}

function scheduleNavRefresh() {
  clearTimeout(saveTimers.nav);
  saveTimers.nav = setTimeout(renderNav, 1200);
}

// hover behavior for both panes
function wireHoverPane(hotzone, pane, isPinnable) {
  hotzone.addEventListener('mouseenter', () => pane.classList.add('open'));
  pane.addEventListener('mouseleave', () => {
    if (isPinnable && pane.dataset.pinned === '1') return;
    pane.classList.remove('open');
  });
}
wireHoverPane($('#nav-hotzone'), $('#nav-pane'), false);
wireHoverPane($('#side-hotzone'), $('#side-pane'), true);

$('#side-pin').onclick = () => {
  const pane = $('#side-pane');
  const pinned = pane.dataset.pinned === '1';
  pane.dataset.pinned = pinned ? '0' : '1';
  $('#side-pin').classList.toggle('pinned', !pinned);
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
    const name = await askInput('Rename tab', 'New tab name', book.tabNames[kind]);
    if (!name) return;
    book.tabNames[kind] = name;
    tab.textContent = name;
    saveMeta();
    // NEO listens: renamed tabs become the default for future books
    library.tabDefaults = library.tabDefaults || {};
    library.tabDefaults[kind] = name;
    window.neo.writeLibrary(library);
  });
});

// Darlings tab is a drop target for selected text
const darlingsTab = $('.tab.darlings');
document.addEventListener('dragstart', (e) => {
  // any text drag inside the manuscript lights up the bottom bar
  if (currentTab === 'manuscript' && e.target.closest && e.target.closest('.chapter-body')) {
    $('#bottombar').classList.add('attn');
  }
});
document.addEventListener('dragend', () => $('#bottombar').classList.remove('attn'));

darlingsTab.addEventListener('dragover', (e) => {
  e.preventDefault();
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

// The one move shared by drag-to-tab and ⌘⇧D: words leave the manuscript
// but are never lost, and an invisible anchor marks the exact spot.
async function moveSelectionToDarlings(html, text) {
  if (!text || !text.trim() || !book) return;
  const sel = window.getSelection();
  const srcChapter = sel.rangeCount
    ? sel.getRangeAt(0).startContainer.parentElement?.closest?.('.chapter')
    : null;
  const chId = srcChapter ? srcChapter.dataset.id : currentChapterId;
  const chIdx = book.chapterOrder.indexOf(chId);
  const did = 'd-' + Date.now().toString(36);

  snapshotStructure('darling');

  if (sel.rangeCount && !sel.isCollapsed) {
    sel.deleteFromDocument();
    const r = sel.getRangeAt(0);
    if (r.startContainer.parentElement?.closest?.('.chapter-body')) {
      const anchor = document.createElement('span');
      anchor.className = 'darling-anchor';
      anchor.dataset.did = did;
      anchor.contentEditable = 'false';
      r.insertNode(anchor);
    }
  }
  if (chId) {
    const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
    if (body) {
      chapterHTML[chId] = body.innerHTML;
      wordCache[chId] = null;
      scheduleChapterSave(chId);
    }
  }

  darlings.unshift({
    id: did,
    html: html || null,
    text: text,
    chapterId: chId || null,
    chapterLabel: chIdx >= 0 ? 'Chapter ' + (chIdx + 1) : 'Manuscript',
    date: new Date().toISOString()
  });
  await window.neo.writeJSON(book.id, 'darlings', darlings);
  updateCounters();
  toast('Saved to Darlings — kill without remorse (⌘Z to undo)');
}

// keyboard route: select a passage, ⌘⇧D, keep writing
function darlingFromKeyboard() {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) {
    toast('Select the passage first, then ⌘⇧D sends it to Darlings');
    return;
  }
  let el = sel.anchorNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  if (!el || !el.closest || !el.closest('.chapter-body')) return;
  const holder = document.createElement('div');
  holder.appendChild(sel.getRangeAt(0).cloneContents());
  moveSelectionToDarlings(holder.innerHTML, sel.toString());
}

function switchTab(name) {
  currentTab = name;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  const paper = $('#paper');
  const aux = $('#aux-paper');
  const auxEditor = $('#aux-editor');
  const dList = $('#darlings-list');
  const oList = $('#outline-list');

  // stash whatever aux content was open
  flushAux();

  if (name === 'manuscript') {
    paper.hidden = false;
    aux.hidden = true;
    return;
  }
  paper.hidden = true;
  aux.hidden = false;
  auxEditor.hidden = true;
  dList.hidden = true;
  oList.hidden = true;

  if (name === 'darlings') {
    $('#aux-title').textContent = 'Darlings';
    dList.hidden = false;
    renderDarlings();
  } else if (name === 'outline') {
    $('#aux-title').textContent = book.tabNames.outline;
    oList.hidden = false;
    if (book.chapterOrder.length === 0) createChapterAt(0);
    renderOutline();
  } else {
    $('#aux-title').textContent = book.tabNames[name] || name;
    auxEditor.hidden = false;
    auxEditor.dataset.kind = name;
    window.neo.readAux(book.id, name).then((html) => {
      auxEditor.innerHTML = html || '';
      auxEditor.focus();
    });
  }
}

/* ================================================================== */
/*  STRUCTURED OUTLINE                                                 */
/*  Chapter lines are the book's real chapters. Section notes become   */
/*  grayed "ghost" paragraphs in the manuscript, ready to be replaced. */
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
  hint.textContent = 'Enter — new chapter (or section, from a section line) · Tab — turn a fresh chapter line into a section · Shift+Tab — turn a section into a chapter · Backspace on an empty line removes it';
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

  txt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
      if (kind === 'chapter') {
        const at = book.chapterOrder.indexOf(chId) + 1;
        const newId = createChapterAt(at);
        renderOutline({ chId: newId });
      } else {
        const list = book.sectionNotes[chId];
        const newSec = { id: 'sec-' + Date.now().toString(36), text: '' };
        list.splice(index + 1, 0, newSec);
        scheduleMetaSave();
        syncGhosts(chId);
        renderOutline({ secId: newSec.id });
      }
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      if (kind !== 'chapter') return;
      const pos = book.chapterOrder.indexOf(chId);
      if (pos === 0) { toast('The first line has to be a chapter'); return; }
      if (countWords(chapterText(chId)) > 0) {
        toast('This chapter already has words in it — only empty chapter lines can become sections');
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
        `Chapter ${i + 1}`,
        words ? `${words.toLocaleString()} words.` : 'This chapter is empty.',
        [{ label: 'Delete chapter', desc: words ? 'Its words move to Darlings, recoverable anytime.' : 'Nothing to save — it just goes.', danger: true, value: 'delete' }]
      );
      if (choice === 'delete') {
        await deleteChapterToDarlings(chId);
        renderOutline();
      }
    } else {
      const choice = await optionModal('Delete this section?', null,
        [{ label: 'Delete section', desc: 'Removes the outline line and its gray ghost from the manuscript. Written prose is never touched.', danger: true, value: 'delete' }]);
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
// Once a ghost has been written over, it belongs to the prose and is left alone.
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
    // written over already? it lives in the prose now — leave it be
    const written = body.querySelector(`p[data-sec-id="${sec.id}"]:not(.ghost)`);
    if (written) continue;
    if (!sec.text) continue;
    // a real section boundary: *** between this ghost and whatever comes before it
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
$('#aux-editor').addEventListener('input', () => { auxDirty = true; scheduleAuxSave(); });
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
    wrap.innerHTML = `<div class="darlings-empty">When a beautiful paragraph is gumming up the works, select it and drag it onto the Darlings tab below.<br>It leaves your manuscript but it is never lost.</div>`;
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
    const when = new Date(d.date).toLocaleDateString();
    meta.innerHTML = `<span>from ${d.chapterLabel} · ${when} · ${countWords(d.text).toLocaleString()} words</span>
      <span><button class="d-restore">Restore</button> <button class="d-del">Delete forever</button></span>`;
    meta.querySelector('.d-restore').onclick = () => restoreDarling(d.id);
    meta.querySelector('.d-del').onclick = async () => {
      snapshotStructure('darling delete');
      // tidy up the invisible anchor this darling left behind
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

  // Preferred: put it back in the exact spot it was cut from
  const anchor = document.querySelector(`.darling-anchor[data-did="${id}"]`);
  if (anchor) {
    const body = anchor.closest('.chapter-body');
    const chId = anchor.closest('.chapter').dataset.id;
    let scrollTo = anchor.closest('p') || anchor;
    if (d.html && /<p[\s>]/i.test(d.html)) {
      // block content: paragraphs go back in after the host paragraph
      const holder = document.createElement('div');
      holder.innerHTML = d.html;
      let ref = anchor.closest('p') || anchor;
      scrollTo = holder.firstElementChild || ref;
      for (const n of [...holder.childNodes]) { ref.after(n); ref = n; }
    } else {
      // inline content: slot it right where the caret was
      const frag = document.createRange().createContextualFragment(d.html || d.text);
      anchor.after(frag);
    }
    anchor.remove();
    syncChapter(body, chId);
    darlings = darlings.filter((x) => x.id !== id);
    await window.neo.writeJSON(book.id, 'darlings', darlings);
    scrollTo.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('Darling restored to its original spot');
    return;
  }

  // Fallback: the spot no longer exists — end of its chapter (or the last one)
  let chId = d.chapterId && book.chapterOrder.includes(d.chapterId)
    ? d.chapterId
    : book.chapterOrder[book.chapterOrder.length - 1];
  if (!chId) { newChapter(); chId = book.chapterOrder[0]; }
  const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  const frag = d.html ? d.html : '<p>' + d.text.replace(/\n+/g, '</p><p>') + '</p>';
  body.insertAdjacentHTML('beforeend', frag);
  chapterHTML[chId] = body.innerHTML;
  scheduleChapterSave(chId);
  darlings = darlings.filter((x) => x.id !== id);
  await window.neo.writeJSON(book.id, 'darlings', darlings);
  focusChapter(chId);
  toast('Original spot is gone — restored to the end of ' + (d.chapterLabel || 'the manuscript'));
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
    wc.textContent = total.toLocaleString() + ' words';
  } else {
    const n = currentChapterId ? chapterWords(currentChapterId) : 0;
    const idx = book.chapterOrder.indexOf(currentChapterId);
    wc.textContent = `ch. ${idx + 1}: ${n.toLocaleString()} words`;
  }
  const pos = $('#pos-counter');
  const idx = book.chapterOrder.indexOf(currentChapterId);
  pos.textContent = book.chapterOrder.length <= 1
    ? '' // a chapterless story needs no chapter locator
    : (idx >= 0
      ? `chapter ${idx + 1} of ${book.chapterOrder.length}`
      : `${book.chapterOrder.length} chapters`);
  // cache for the bookshelf progress bar
  if (book.wordCount !== total) {
    book.wordCount = total;
    scheduleMetaSave();
  }
  trackDailyWords(total);
}

// ---- daily word tracking + goal display ----
const todayStr = () => new Date().toISOString().slice(0, 10);

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
    gc.textContent = `⚡ ${sprintWords.toLocaleString()} / ${sprint.target.toLocaleString()}`;
    if (sprintWords >= sprint.target) {
      sprint.done = true;
      toast(`Sprint complete — ${sprintWords.toLocaleString()} words. Well earned.`, 6000);
    }
  } else {
    const goal = library.dailyGoal || 0;
    gc.textContent = goal
      ? `${wordsToday.toLocaleString()} / ${goal.toLocaleString()} today`
      : `${wordsToday.toLocaleString()} today`;
    gc.classList.toggle('goal-met', goal > 0 && wordsToday >= goal);
  }
}

$('#word-counter').onclick = () => {
  wordMode = wordMode === 'book' ? 'chapter' : 'book';
  updateCounters();
};

// select a passage → the counter quietly reports its size
document.addEventListener('selectionchange', () => {
  if (!book || currentTab !== 'manuscript') return;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) {
    let el = sel.anchorNode;
    if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
    if (el && el.closest && el.closest('.chapter-body')) {
      const n = countWords(sel.toString());
      if (n > 0) {
        $('#word-counter').textContent = n.toLocaleString() + ' selected';
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

function scheduleChapterSave(chId) {
  clearTimeout(saveTimers[chId]);
  saveTimers[chId] = setTimeout(() => {
    window.neo.writeChapter(book.id, chId, chapterHTML[chId] || '');
  }, 800);
}

function scheduleMetaSave() {
  clearTimeout(saveTimers.meta);
  saveTimers.meta = setTimeout(saveMeta, 800);
}
async function saveMeta() {
  if (book) await window.neo.writeBookMeta(book.id, book);
}

function flushAllSaves() {
  if (!book) return;
  // remember where the writer was for next time
  book.lastPosition = {
    chapterId: currentChapterId,
    scroll: $('#paper-scroll').scrollTop
  };
  for (const chId of book.chapterOrder) {
    if (chapterHTML[chId] !== undefined) {
      window.neo.writeChapter(book.id, chId, chapterHTML[chId]);
    }
  }
  flushAux();
  saveMeta();
}

window.addEventListener('beforeunload', flushAllSaves);
// belt and suspenders: flush whenever focus leaves NEO, and every 20 seconds
window.addEventListener('blur', () => { if (book) flushAllSaves(); });
setInterval(() => { if (book) flushAllSaves(); }, 20000);

async function backToShelf() {
  flushAllSaves();
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
/*  structure, restored in one keystroke.                              */
/* ================================================================== */

let undoStack = [];

function snapshotStructure(label) {
  if (!book) return;
  undoStack.push({
    label,
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
    await window.neo.writeChapter(book.id, chId, chapterHTML[chId] || '<p><br></p>');
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
  toast('Undone: ' + snap.label);
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
  if ($('#editor-view').hidden || !book) { toast('Open a book first'); return; }
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
// The caret never leaves the search box — matches are painted, not selected.
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

// only runs when the user asks (Enter / arrows) — never while typing
function gotoMatch(i) {
  const m = searchState.matches;
  if (!m.length) return;
  searchState.idx = ((i % m.length) + m.length) % m.length;
  paintHighlights();
  try {
    const rect = m[searchState.idx].range.getBoundingClientRect();
    $('#paper-scroll').scrollTop += rect.top - window.innerHeight * 0.45;
  } catch { /* range collapsed by an edit; next search rebuilds */ }
  $('#search-count').textContent = `${searchState.idx + 1} of ${m.length}`;
}

function freshSearchIfStale() {
  if (searchState.query !== $('#search-input').value) runSearch();
}

function replaceCurrent() {
  freshSearchIfStale();
  if (!searchState.matches.length) { toast('No matches'); return; }
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

// Every chapter, front to back — position in the book is irrelevant.
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
  toast(n ? `${n} replaced across the whole book — ⌘Z to undo` : '0 replaced');
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
    // Tab is the deliberate hand-off: place the caret at the current match
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
  shelf = shelf || library.shelves[0];
  let ok = 0;
  for (const r of results) {
    if (r.error) { toast(`Couldn't import ${r.name}: ${r.error}`, 6000); continue; }
    const meta = await window.neo.createBook({ author: displayAuthor() });
    meta.title = r.name;
    meta.tabNames = {
      notes: (library.tabDefaults && library.tabDefaults.notes) || 'Notes',
      outline: (library.tabDefaults && library.tabDefaults.outline) || 'Outline'
    };
    let words = 0;
    for (const ch of r.chapters) {
      const chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      const html = ch.map((p) =>
        p.scene ? '<p class="scene-break">***</p>' : `<p>${escHtml(p.text || '')}</p>`
      ).join('') || '<p><br></p>';
      await window.neo.writeChapter(meta.id, chId, html);
      meta.chapterOrder.push(chId);
      for (const p of ch) words += countWords(p.text || '');
    }
    meta.wordCount = words;
    await window.neo.writeBookMeta(meta.id, meta);
    shelf.bookIds.push(meta.id);
    ok++;
  }
  await window.neo.writeLibrary(library);
  if (!$('#bookshelf-view').hidden) renderShelves();
  if (ok) toast(`${ok} book${ok === 1 ? '' : 's'} imported onto “${shelf.name}” — chapters and scene breaks detected`, 6000);
}

async function importBooks() {
  const results = await window.neo.importPick();
  if (results.length) await addImportedBooks(results, library.shelves[0]);
}

$('#import-btn').onclick = importBooks;

/* ================================================================== */
/*  SPELLCHECK PASS + TYPEWRITER SCROLLING                             */
/* ================================================================== */

let spellOn = false;
function toggleSpellcheck() {
  spellOn = !spellOn;
  $$('.chapter-body').forEach((b) => { b.spellcheck = spellOn; });
  $('#aux-editor').spellcheck = spellOn;
  // nudge the engine to (re)evaluate what's on screen
  const active = document.activeElement;
  if (active && active.blur) { active.blur(); if (active.focus) active.focus(); }
  toast(spellOn
    ? 'Spellcheck pass ON — right-click any squiggle for suggestions. ⌘; again when you’re done.'
    : 'Spellcheck off. Back to flow.', 5000);
}

let typewriterEnabled = false;
function toggleTypewriter() {
  typewriterEnabled = !typewriterEnabled;
  library.typewriter = typewriterEnabled;
  window.neo.writeLibrary(library);
  toast(typewriterEnabled ? 'Typewriter scrolling ON — your line stays centered' : 'Typewriter scrolling off');
}

document.addEventListener('selectionchange', () => {
  if (!typewriterEnabled || !book || currentTab !== 'manuscript') return;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return;
  let el = sel.anchorNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  if (!el || !el.closest || !el.closest('.chapter-body')) return;
  requestAnimationFrame(() => {
    try {
      let rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect || (rect.top === 0 && rect.height === 0)) rect = el.getBoundingClientRect();
      const diff = rect.top - window.innerHeight * 0.45;
      if (Math.abs(diff) > 6) $('#paper-scroll').scrollTop += diff;
    } catch { /* selection mid-mutation; skip this frame */ }
  });
});

/* ================================================================== */
/*  THE SILO                                                           */
/*  A fullscreen with no green button and no gestures out. The only    */
/*  exit is typing the confession NEO hands you, word for word.        */
/* ================================================================== */

const SILO_PROMPTS = [
  "I'm a great writer and I'll do another session later, but right now I really need to see a cat video.",
  "Somewhere on the internet, a stranger is wrong, and only I can fix it.",
  "My characters can sit in the dark until I get back from checking my email.",
  "I choose the scroll of doom over the scroll of my own making.",
  "This chapter was almost going somewhere, which is exactly why I must leave now.",
  "My muse stepped out for coffee, so I'm stepping out for the whole afternoon.",
  "I would rather read about writing than actually write.",
  "The refrigerator has news for me and it cannot wait.",
  "I am abandoning my book to research something I will forget in ten minutes.",
  "I promise to think about my plot while watching videos that have nothing to do with it.",
  "The blank page is winning today and I have decided to let it.",
  "I'm leaving my imaginary friends for my imaginary obligations.",
  "Nothing in my inbox is better than this book, but I'm going to go check anyway.",
  "I hereby trade a page of my novel for a peek at the feeds.",
  "My deadline believes in me more than I do right now.",
  "I was one sentence away from brilliance and chose the exit instead.",
  "The story will keep. The snacks, however, are calling.",
  "I am not procrastinating; I am marinating, loudly, elsewhere.",
  "Today's words were hard, so I'm going to go look at pictures instead.",
  "I love my book, but right now I love my phone a little more.",
  "Quitting this session is the plot twist nobody asked for.",
  "I will return to this manuscript older and no wiser.",
  "My protagonist would never give up this easily.",
  "Every minute away from this book is a minute my villain wins.",
  "I typed this whole sentence just to avoid typing a different one.",
  "The cursor blinked at me funny, so I'm leaving.",
  "I could finish this scene, or I could check the weather in cities I will never visit.",
  "Future me has agreed to write these words, and future me is a saint.",
  "I came, I saw, I alt-tabbed."
];

let siloActive = false;
let siloStartCount = 0;

async function enterSilo() {
  await window.neo.setSilo(true);
  siloActive = true;
  siloStartCount = book ? bookWordCount() : 0;
  $('#silo-btn').classList.add('active');
  toast('The hatch is sealed. Nothing exists but the page. (Esc when you want out)', 6000);
}

function exitSiloAttempt() {
  const prompt = SILO_PROMPTS[Math.floor(Math.random() * SILO_PROMPTS.length)];
  const normalize = (s) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[’‘]/g, "'").trim();
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal" style="width:520px">
      <h2 style="font-size:16px">Leaving the Silo?</h2>
      <p>Type this, word for word, and the hatch opens:</p>
      <p style="font-family:Georgia,serif;font-size:15px;font-style:italic;color:var(--accent);line-height:1.6">“${prompt}”</p>
      <input id="silo-input" type="text" spellcheck="false" autocomplete="off" placeholder="Confess…"/>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
        <button class="m-cancel" style="background:var(--accent);border:none;border-radius:6px;padding:7px 16px;color:#191919">Never mind — back to writing</button>
        <button class="m-ok" style="background:none;border:1px solid #3a3a3a;border-radius:6px;padding:7px 18px;color:#666" disabled>Open the hatch</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const input = bd.querySelector('#silo-input');
  const ok = bd.querySelector('.m-ok');
  const cancel = bd.querySelector('.m-cancel');
  input.focus();
  // writing stays the golden path; the hatch only lights up once you've confessed
  const check = () => {
    const good = normalize(input.value) === normalize(prompt);
    ok.disabled = !good;
    input.classList.toggle('match', good);
    if (good) {
      ok.style.cssText = 'background:var(--accent);border:none;border-radius:6px;padding:7px 18px;color:#191919';
      cancel.style.cssText = 'background:none;border:none;color:#888';
    } else {
      ok.style.cssText = 'background:none;border:1px solid #3a3a3a;border-radius:6px;padding:7px 18px;color:#666';
      cancel.style.cssText = 'background:var(--accent);border:none;border-radius:6px;padding:7px 16px;color:#191919';
    }
  };
  input.addEventListener('input', check);
  const leave = async () => {
    if (ok.disabled) return;
    bd.remove();
    await window.neo.setSilo(false);
    siloActive = false;
    $('#silo-btn').classList.remove('active');
    const written = book ? bookWordCount() - siloStartCount : 0;
    toast(written > 0
      ? `Back to the surface — ${written.toLocaleString()} words richer.`
      : 'Back to the surface.');
  };
  ok.onclick = leave;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); leave(); }
    if (e.key === 'Escape') { e.stopPropagation(); bd.remove(); } // no shame in staying
  });
  bd.querySelector('.m-cancel').onclick = () => bd.remove();
}

function toggleSilo() {
  if (siloActive) exitSiloAttempt();
  else enterSilo();
}

$('#silo-btn').onclick = toggleSilo;

/* ================================================================== */
/*  GOALS, SPRINTS, AND THE CHART                                      */
/* ================================================================== */

let sprint = null;

function statsChartSvg() {
  const W = 520, H = 200, PAD = 6;
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    days.push(d.toISOString().slice(0, 10));
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
    <span>30 days ago</span>
    <span style="color:#3d8a6a">▮ daily words</span>
    <span style="color:var(--accent)">— total${goal ? ' · - - goal' : ''}</span>
    <span>today</span>
  </div>`;
}

function openStats() {
  const hasBook = !!book;
  const today = hasBook ? (book.dailyCounts || {})[todayStr()] : null;
  const wordsToday = today ? today.end - today.start : 0;
  const total = hasBook ? bookWordCount() : 0;
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal" style="width:580px">
      <h2 style="font-size:17px">${hasBook ? escHtml(book.title) + ' — progress' : 'Goals & settings'}</h2>
      ${hasBook ? `
      <div class="stats-nums">
        <div><div class="big">${total.toLocaleString()}</div><div class="lbl">total words</div></div>
        <div><div class="big">${wordsToday.toLocaleString()}</div><div class="lbl">today</div></div>
        <div><div class="big">${book.wordGoal ? Math.min(100, Math.round(total / book.wordGoal * 100)) + '%' : '—'}</div><div class="lbl">of book goal</div></div>
      </div>
      ${statsChartSvg()}` : ''}
      <div class="stats-row" style="margin-top:18px">
        <label>Daily goal <input id="st-daily" type="number" min="0" value="${library.dailyGoal || ''}" placeholder="500"/></label>
        ${hasBook ? `<label>Book goal <input id="st-book" type="number" min="0" value="${book.wordGoal || ''}" placeholder="80000"/></label>` : ''}
      </div>
      ${hasBook ? `
      <div class="stats-row">
        <label>Sprint <input id="st-sprint" type="number" min="50" value="${sprint ? sprint.target : 500}"/> words</label>
        <button id="st-sprint-btn">${sprint && !sprint.done ? 'End sprint' : 'Start sprint'}</button>
        <span id="st-sprint-info" class="soft">${sprint && !sprint.done ? 'sprint running…' : 'a small hill to charge up'}</span>
      </div>` : ''}
      <div class="stats-row">
        <label>New books open for a
          <select id="st-style">
            <option value="pantser"${library.writingStyle !== 'plotter' ? ' selected' : ''}>Pantser — straight to the blank page</option>
            <option value="plotter"${library.writingStyle === 'plotter' ? ' selected' : ''}>Plotter — outline first</option>
          </select>
        </label>
      </div>
      <div style="text-align:right;margin-top:14px">
        <button class="m-ok" style="background:var(--accent);border:none;border-radius:6px;padding:7px 18px;color:#191919">Done</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = async () => {
    library.dailyGoal = parseInt(bd.querySelector('#st-daily').value, 10) || 0;
    library.writingStyle = bd.querySelector('#st-style').value;
    if (hasBook) {
      book.wordGoal = parseInt(bd.querySelector('#st-book').value, 10) || 0;
      scheduleMetaSave();
    }
    await window.neo.writeLibrary(library);
    bd.remove();
    if (hasBook) updateCounters();
  };
  bd.querySelector('.m-ok').onclick = close;
  bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  if (hasBook) {
    bd.querySelector('#st-sprint-btn').onclick = () => {
      if (sprint && !sprint.done) {
        const got = bookWordCount() - sprint.startCount;
        toast(`Sprint ended — ${got.toLocaleString()} words in ${Math.round((Date.now() - sprint.startTime) / 60000)} min`);
        sprint = null;
      } else {
        const target = parseInt(bd.querySelector('#st-sprint').value, 10) || 500;
        sprint = { target, startCount: bookWordCount(), startTime: Date.now(), done: false };
        toast(`Sprint started — ${target.toLocaleString()} words. Go.`);
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
  'Baskerville': 'Baskerville, Georgia, serif',
  'Hoefler Text': '"Hoefler Text", Georgia, serif',
  'Iowan Old Style': '"Iowan Old Style", Georgia, serif'
};

function applyFonts() {
  const f = library.fonts || {};
  if (f.body && BODY_FONTS[f.body]) {
    document.documentElement.style.setProperty('--body-font', BODY_FONTS[f.body]);
  }
  if (f.dropcap && DROPCAP_FONTS[f.dropcap]) {
    document.documentElement.style.setProperty('--dropcap-font', DROPCAP_FONTS[f.dropcap]);
  }
  document.body.classList.toggle('night', library.pageTheme === 'night');
  const size = Math.min(22, Math.max(14, library.editorFontSize || 17));
  document.documentElement.style.setProperty('--editor-size', size + 'px');
}

function showHelp() {
  const row = (k, d) => `<span class="hk">${k}</span><span>${d}</span>`;
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal" style="width:560px">
      <h2>NEO Shortcuts</h2>

      <div class="help-sec">Writing</div>
      <div class="help-grid">
        ${row('Enter ×2', 'Section break (***)')}
        ${row('Enter ×3', 'New chapter, auto-numbered')}
        ${row('⌘⇧X', 'Placeholder note — mark it, keep writing')}
        ${row('⌘⇧D', 'Send the selected passage to Darlings')}
        ${row('⌘Z', 'Undo big moves (chapter deletes, replace-all, darlings) when not mid-typing')}
        ${row('-- and ...', 'Become an em dash — and a true ellipsis …')}
        ${row('⌘B · ⌘I', 'Bold, italic. Quotes curl themselves.')}
      </div>

      <div class="help-sec">Getting around</div>
      <div class="help-grid">
        ${row('⌘F', 'Find &amp; replace across the whole book')}
        ${row('Hover edges', 'Left: chapters &amp; outline notes. Right: comments (☉ pins).')}
        ${row('Esc', 'Closes whatever’s open; otherwise back to the shelf')}
      </div>

      <div class="help-sec">Modes</div>
      <div class="help-grid">
        ${row('⌘⇧F', 'Full screen (Esc leaves)')}
        ${row('⌘⇧S', 'The Silo — write your way out')}
        ${row('⌘⇧T', 'Typewriter scrolling')}
        ${row('⌘;', 'Spellcheck pass (right-click squiggles for fixes)')}
      </div>

      <div class="help-sec">Files</div>
      <div class="help-grid">
        ${row('⌘E', 'Email a timestamped draft to yourself')}
        ${row('⌘⇧I', 'Import .docx / .txt / .md manuscripts')}
        ${row('File → Export', 'txt · md · html · pdf · docx · epub')}
      </div>

      <div class="help-sec">Mouse</div>
      <div class="help-grid">
        ${row('Drag text', 'Onto the Darlings tab — saved, never lost')}
        ${row('Right-click', 'Books, shelf names, chapter headings, outline lines')}
        ${row('Drag chapters', 'In the left panel, to reorder — everything renumbers')}
        ${row('Double-click', 'A tab, to rename it')}
        ${row('Click counters', 'Cycle word counts · open goals &amp; sprints')}
      </div>

      <div style="text-align:right;margin-top:18px">
        <button class="m-ok" style="background:var(--accent);border:none;border-radius:6px;padding:7px 18px;color:#191919">Got it</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.querySelector('.m-ok').onclick = close;
  bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  bd.querySelector('.m-ok').focus();
}

/* ================================================================== */
/*  EXPORT + EMAIL                                                     */
/* ================================================================== */

function safeName(s) {
  return (s || 'Untitled').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
}

// Clean paragraphs from any chapter HTML string — export-ready
function parasFromHtml(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html || '';
  holder.querySelectorAll('.darling-anchor, .ph-mark, .ghost').forEach((n) => n.remove());
  return [...holder.querySelectorAll('p')].map((p) => ({
    sceneBreak: p.classList.contains('scene-break'),
    text: p.innerText.trim(),
    html: p.outerHTML
  })).filter((p) => p.sceneBreak || p.text);
}

function exportChapters() {
  // [{num, heading, paras: [{text, sceneBreak, html}]}]
  return book.chapterOrder.map((chId, i) => {
    const el = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
    const paras = parasFromHtml(el ? el.innerHTML : (chapterHTML[chId] || ''));
    const t = (book.chapterTitles || {})[chId];
    // chapterless stories export as continuous text: no heading at all
    const heading = book.chapterOrder.length === 1
      ? ''
      : 'Chapter ' + (i + 1) + (t ? ' — ' + t : '');
    return { num: i + 1, heading, paras };
  });
}

// The open book, packaged for the builders. Every builder takes an optional
// data object in this shape, which is how a shelf becomes an anthology.
function bookExportData() {
  return {
    id: book.id,
    title: book.title,
    subtitle: book.subtitle,
    author: book.author,
    coverSeed: book.coverSeed,
    sections: exportChapters()
  };
}

function buildTxt(data) {
  const d = data || bookExportData();
  let out = `${d.title.toUpperCase()}\n`;
  if (d.subtitle) out += `${d.subtitle}\n`;
  out += `by ${d.author}\n\n\n`;
  for (const ch of d.sections) {
    if (ch.heading) out += `${ch.heading.toUpperCase()}\n\n`;
    for (const p of ch.paras) out += p.sceneBreak ? '\n***\n\n' : p.text + '\n\n';
    out += '\n';
  }
  return out;
}

function buildMd(data) {
  const d = data || bookExportData();
  let out = `# ${d.title}\n\n`;
  if (d.subtitle) out += `*${d.subtitle}*\n\n`;
  out += `**by ${d.author}**\n\n`;
  for (const ch of d.sections) {
    if (ch.heading) out += `\n## ${ch.heading}\n\n`;
    for (const p of ch.paras) out += p.sceneBreak ? '\n\\*\\*\\*\n\n' : p.text + '\n\n';
  }
  return out;
}

function buildHtml(data) {
  const d = data || bookExportData();
  const total = d.sections.reduce((s, ch) => s + ch.paras.reduce((n, p) => n + countWords(p.text || ''), 0), 0);
  const stamp = new Date().toLocaleString();
  const chaptersHtml = d.sections.map((ch) => {
    let first = true;
    const paras = ch.paras.map((p) => {
      if (p.sceneBreak) { first = true; return '<p class="brk">***</p>'; }
      const html = (first && !p.html.includes('class=')) ? p.html.replace('<p', '<p class="first"') : p.html;
      first = false;
      return html;
    }).join('\n');
    return `
    <section class="chapter">
      ${ch.heading ? `<h2>${ch.heading}</h2>` : ''}
      ${paras}
    </section>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${d.title}</title>
<style>
  body { font-family: Georgia, serif; color: #1c1c1c; max-width: 620px; margin: 40px auto; line-height: 1.7; font-size: 13pt; }
  .titlepage { text-align: center; margin: 30vh 0 20vh; page-break-after: always; }
  .titlepage h1 { font-size: 30pt; margin: 0; }
  .titlepage .sub { font-style: italic; color: #555; }
  .titlepage .auth { margin-top: 40px; letter-spacing: 3px; text-transform: uppercase; font-size: 11pt; }
  .chapter { page-break-before: always; }
  .chapter h2 { text-align: center; letter-spacing: 4px; text-transform: uppercase; font-size: 12pt; font-weight: normal; color: #555; margin: 60px 0 40px; }
  .chapter p { text-indent: 2em; margin: 0; }
  .chapter h2 + p, .brk + p, .chapter p.first { text-indent: 0; }
  .chapter h2 + p::first-letter, .chapter p.first::first-letter { font-size: 3em; float: left; line-height: 0.8; padding: 3px 6px 0 0; }
  .brk { text-align: center; text-indent: 0 !important; letter-spacing: 8px; color: #888; margin: 1.5em 0; }
  .prov { margin-top: 80px; text-align: center; color: #999; font-size: 9pt; }
</style></head><body>
<div class="titlepage"><h1>${d.title}</h1>
${d.subtitle ? `<p class="sub">${d.subtitle}</p>` : ''}
<p class="auth">${d.author}</p></div>
${chaptersHtml}
<p class="prov">${total.toLocaleString()} words · exported from NEO on ${stamp}</p>
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
        if (child.textContent) runs.push({ text: child.textContent, b, i });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
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

function makeCoverJpeg(d) {
  // 1600x2560 per KDP's recommended cover dimensions
  const W = 1600, H = 2560;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  // reuse the bookshelf gradient hues
  const seed = String(d.coverSeed || d.id);
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue1 = h % 360, hue2 = (hue1 + 40 + (h >> 8) % 140) % 360;
  const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
  g.addColorStop(0, `hsl(${hue1}, 55%, 38%)`);
  g.addColorStop(1, `hsl(${hue2}, 60%, 22%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // title, wrapped
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 18;
  ctx.font = 'bold 150px Georgia';
  const words = (d.title || 'Untitled').split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > W - 300 && line) { lines.push(line); line = w; }
    else line = test;
  }
  lines.push(line);
  let y = H * 0.32;
  for (const l of lines) { ctx.fillText(l, W / 2, y); y += 175; }
  ctx.font = '72px Georgia';
  ctx.fillText((d.author || '').toUpperCase(), W / 2, H * 0.82);
  return canvas.toDataURL('image/jpeg', 0.86).split(',')[1];
}

function chapterXhtml(ch, d) {
  let first = true;
  const paras = ch.paras.map((p) => {
    if (p.sceneBreak) { first = true; return '<p class="brk">* * *</p>'; }
    const cls = first ? ' class="first"' : '';
    first = false;
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

function buildEpubEntries(data) {
  const d = data || bookExportData();
  const chapters = d.sections;
  const uuid = 'urn:uuid:neo-' + d.id;
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
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
<dc:language>en</dc:language>
<meta property="dcterms:modified">${modified}</meta>
<meta name="cover" content="cover-image"/>
</metadata>
<manifest>
<item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>
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
<itemref idref="nav"/>
${chSpine}
</spine>
<guide>
<reference type="cover" title="Cover" href="cover.xhtml"/>
<reference type="toc" title="Table of Contents" href="nav.xhtml"/>
<reference type="text" title="Beginning" href="ch1.xhtml"/>
</guide>
</package>` },
    { path: 'OEBPS/nav.xhtml', content: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Table of Contents</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><nav epub:type="toc" id="toc"><h1>Contents</h1>
<ol>
<li><a href="title.xhtml">Title Page</a></li>
${navPoints}
</ol></nav>
<nav epub:type="landmarks" hidden=""><ol>
<li><a epub:type="cover" href="cover.xhtml">Cover</a></li>
<li><a epub:type="toc" href="nav.xhtml">Table of Contents</a></li>
<li><a epub:type="bodymatter" href="ch1.xhtml">Beginning</a></li>
</ol></nav>
</body></html>` },
    { path: 'OEBPS/toc.ncx', content: `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${uuid}"/></head>
<docTitle><text>${escXml(d.title)}</text></docTitle>
<navMap>
<navPoint id="titlepage" playOrder="1"><navLabel><text>Title Page</text></navLabel><content src="title.xhtml"/></navPoint>${ncxPoints}
</navMap></ncx>` },
    { path: 'OEBPS/style.css', content: `body { font-family: serif; line-height: 1.5; margin: 1em; }
h1 { text-align: center; font-weight: normal; letter-spacing: 0.2em; text-transform: uppercase; font-size: 1.2em; margin: 3em 0 2em; }
p { text-indent: 1.2em; margin: 0; }
p.first, p.brk + p { text-indent: 0; }
p.brk { text-align: center; text-indent: 0; margin: 1.5em 0; letter-spacing: 0.5em; }
.titlepage { text-align: center; margin-top: 30%; }
.titlepage h2 { font-size: 2em; margin: 0; }
.titlepage .sub { font-style: italic; }
.titlepage .auth { margin-top: 4em; letter-spacing: 0.3em; text-transform: uppercase; }
.coverimg { text-align: center; margin: 0; padding: 0; }
.coverimg img { max-width: 100%; max-height: 100%; }` },
    { path: 'OEBPS/cover.xhtml', content: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Cover</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><div class="coverimg"><img src="cover.jpg" alt="${escXml(d.title)}"/></div></body></html>` },
    { path: 'OEBPS/title.xhtml', content: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${escXml(d.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><div class="titlepage"><h2>${escXml(d.title)}</h2>
${d.subtitle ? `<p class="sub">${escXml(d.subtitle)}</p>` : ''}
<p class="auth">${escXml(d.author)}</p></div></body></html>` },
    { path: 'OEBPS/cover.jpg', content: makeCoverJpeg(d), base64: true }
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
      const t = (meta.chapterTitles || {})[meta.chapterOrder[i]];
      const heading = !multi
        ? meta.title
        : (i === 0 ? meta.title : `${meta.title} — Chapter ${i + 1}${t ? ': ' + t : ''}`);
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
  if (!shelf.bookIds.length) { toast('This shelf has no books on it yet'); return; }
  const title = await askInput('Anthology title', 'Shown on the title page, cover, and metadata', shelf.name);
  if (title === null) return;
  const format = await optionModal('Export the anthology as…', null, [
    { label: 'EPUB', desc: 'For ebook stores — the TOC lists every story.', value: 'epub' },
    { label: 'Word (.docx)', desc: 'For editors — each story starts on a new page.', value: 'docx' },
    { label: 'PDF', desc: 'For reading, sharing, and print.', value: 'pdf' }
  ]);
  if (!format) return;
  toast('Collecting the shelf…');
  const data = await shelfExportData(shelf, title || shelf.name);
  if (!data.sections.length) { toast('No words found on this shelf yet'); return; }
  const defaultName = safeName(data.title);
  let payload;
  if (format === 'docx') payload = { format, defaultName, zipEntries: buildDocxEntries(data) };
  else if (format === 'epub') payload = { format, defaultName, zipEntries: buildEpubEntries(data) };
  else payload = { format: 'pdf', defaultName, content: buildHtml(data) };
  const saved = await window.neo.exportSave(payload);
  if (saved) toast(`Anthology of ${shelf.bookIds.length} works exported: ` + saved.split('/').pop(), 6000);
}

async function doExport(format) {
  if (!book) { toast('Open a book first'); return; }
  flushAllSaves();
  const defaultName = safeName(book.title);
  let payload;
  if (format === 'docx') payload = { format, defaultName, zipEntries: buildDocxEntries() };
  else if (format === 'epub') payload = { format, defaultName, zipEntries: buildEpubEntries() };
  else payload = { format, defaultName, content: format === 'txt' ? buildTxt() : format === 'md' ? buildMd() : buildHtml() };
  const saved = await window.neo.exportSave(payload);
  if (saved) toast('Exported: ' + saved.split('/').pop());
}

function chooseEmailMethod() {
  // Apple Mail only exists on Macs; elsewhere Gmail is the only offer
  if (!navigator.platform.toLowerCase().includes('mac')) return Promise.resolve('gmail');
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `
      <div class="modal" style="width:440px">
        <h2 style="font-size:16px">How should NEO email your drafts?</h2>
        <div class="fr-choices" style="margin-top:14px">
          <button class="fr-choice" data-m="gmail">
            <strong>Gmail</strong>
            <span>Opens a pre-filled compose window in your browser. NEO shows you the PDF to drag into it.</span>
          </button>
          <button class="fr-choice" data-m="mail">
            <strong>Apple Mail</strong>
            <span>Fully automatic — the PDF is attached and addressed. Just hit send.</span>
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
  const addr = await askInput('Email drafts to', 'you@example.com', library.emailAddress || '');
  if (addr === null) return false;
  if (addr) library.emailAddress = addr;
  library.emailMethod = await chooseEmailMethod();
  await window.neo.writeLibrary(library);
  toast('Email settings saved');
  return true;
}

async function manuscriptHash() {
  // SHA-256 of the manuscript text: a fingerprint for your provenance trail
  const text = book.title + '\n' + book.chapterOrder.map((c) => chapterText(c)).join('\n');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function doEmailDraft() {
  if (!book) { toast('Open a book first'); return; }
  flushAllSaves();
  if (!library.emailAddress || !library.emailMethod) {
    const ok = await emailSettings();
    if (!ok) return;
  }
  const total = bookWordCount();
  const subject = `NEO draft — ${book.title} — ${total.toLocaleString()} words — ${new Date().toLocaleDateString()}`;
  const hash = await manuscriptHash();
  const body = `Draft snapshot of "${book.title}" — ${total.toLocaleString()} words.\n`
    + `Sent from NEO on ${new Date().toLocaleString()}.\n\n`
    + `SHA-256 fingerprint of the manuscript text:\n${hash}\n\n`
    + (library.emailMethod === 'gmail'
      ? 'The PDF snapshot is in the Finder window NEO just opened — drag it into this email before sending.'
      : 'PDF snapshot attached.');
  toast('Preparing your draft…');
  const res = await window.neo.emailDraft({
    to: library.emailAddress,
    subject,
    body,
    html: buildHtml(),
    defaultName: safeName(book.title),
    method: library.emailMethod
  });
  if (res.method === 'gmail') toast('Gmail compose opened — drag in the PDF NEO revealed, then send', 8000);
  else if (res.ok) toast('Draft handed to Mail — hit send for your timestamp');
  else toast('Mail unavailable — snapshot saved to your Exports folder instead');
}

window.neo.onMenu(async (msg) => {
  if (msg.type === 'help') showHelp();
  if (msg.type === 'export') doExport(msg.format);
  if (msg.type === 'emailDraft') doEmailDraft();
  if (msg.type === 'emailSettings') emailSettings();
  if (msg.type === 'find') openSearch();
  if (msg.type === 'spellcheck') toggleSpellcheck();
  if (msg.type === 'typewriter') toggleTypewriter();
  if (msg.type === 'import') importBooks();
  if (msg.type === 'silo') toggleSilo();
  if (msg.type === 'stats') openStats();
  if (msg.type === 'pageTheme') {
    library.pageTheme = msg.value;
    await window.neo.writeLibrary(library);
    applyFonts();
    toast(msg.value === 'night' ? 'Night page — easy on midnight eyes' : 'Paper page');
  }
  if (msg.type === 'fontSize') {
    const cur = library.editorFontSize || 17;
    library.editorFontSize = msg.value === 0 ? 17 : Math.min(22, Math.max(14, cur + msg.value));
    await window.neo.writeLibrary(library);
    applyFonts();
  }
  if (msg.type === 'bodyFont') {
    library.fonts = library.fonts || {};
    library.fonts.body = msg.value;
    await window.neo.writeLibrary(library);
    applyFonts();
    toast('Body font: ' + msg.value);
  }
  if (msg.type === 'dropCap') {
    library.fonts = library.fonts || {};
    library.fonts.dropcap = msg.value;
    await window.neo.writeLibrary(library);
    applyFonts();
    const names = { literary: 'Literary', fantasy: 'Fantasy', scifi: 'Sci-Fi' };
    toast('Drop caps: ' + names[msg.value]);
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
    toast('Something hiccuped — your words are safe, and the details were logged');
  }
}
window.addEventListener('error', (e) => reportError(`${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => reportError('Unhandled: ' + (e.reason && e.reason.stack || e.reason)));

/* ================================================================== */

loadLibrary().then(() => {
  applyFonts();
  typewriterEnabled = !!library.typewriter;
});
