'use strict';

/* ================================================================== */
/*  NAV PANE                                                           */
/* ================================================================== */

let chapterDragActive = false;
let navRefreshPending = false;

function renderNav() {
  if (!book) return; // a refresh queued just before the shelf came back
  // Replacing the source row during a native drag can interrupt its lifecycle.
  if (chapterDragActive) { navRefreshPending = true; return; }
  // a chapter note being written in the pane isn't pulled out from under
  // the writer: the pane catches up when they leave the note
  const editingNote = document.activeElement && document.activeElement.closest && document.activeElement.closest('#nav-list .nav-note[contenteditable="true"]');
  if (editingNote) {
    navRefreshPending = true;
    if (!editingNote.dataset.catchUp) {
      editingNote.dataset.catchUp = '1';
      editingNote.addEventListener('blur', () => { setTimeout(() => { if (navRefreshPending) renderNav(); }, 0); }, { once: true });
    }
    return;
  }
  navRefreshPending = false;
  if (isScript()) { renderScriptNav(); return; }
  const list = $('#nav-list');
  // a keyboard user on a chapter row keeps their place through the rebuild
  const focusedRow = document.activeElement && document.activeElement.classList.contains('n-row') &&
    document.activeElement.matches(':focus-visible') ? document.activeElement.closest('.nav-item').dataset.id : null;
  list.innerHTML = '';
  book.chapterNotes = book.chapterNotes || {};
  const solo = soloStory();
  // the book from top to bottom: a faint + between the boxes (and above and
  // below them) adds a chapter, a part or a page right there
  const gap = (at) => {
    const g = document.createElement('div');
    g.className = 'nav-gap';
    const plus = document.createElement('button');
    plus.className = 'ng-plus';
    plus.tabIndex = -1;
    plus.textContent = '+';
    plus.setAttribute('aria-label', t('Add'));
    const add = (e) => { e.preventDefault(); e.stopPropagation(); addEntryMenu(at, e.clientX, e.clientY, plus); };
    plus.addEventListener('click', add);
    plus.addEventListener('contextmenu', add);
    g.appendChild(plus);
    return g;
  };
  let inPart = false;
  book.chapterOrder.forEach((chId, i) => {
    const kind = chapterKind(chId);
    const story = STORY_KINDS.includes(kind);
    // a part gathers what follows it, up to the next part or the back of the book
    if (kind === 'part') inPart = true;
    else if (BACK_KINDS.includes(kind)) inPart = false;
    const words = story ? chapterWords(chId) : 0;
    const flagged = !!document.querySelector(`.chapter[data-id="${chId}"] .ph-mark`);
    const chTitle = story ? (book.chapterTitles || {})[chId] : '';
    const item = document.createElement('div');
    item.className = `nav-item kind-${kind}` + (story ? '' : ' nav-page') + (inPart && kind !== 'part' ? ' in-part' : '') +
      (chId === currentChapterId ? ' current' : '') + (chId === justAddedEntry ? ' just-added' : '');
    item.dataset.id = chId;
    item.innerHTML = `<div class="n-row" title="${t('Drag to reorder chapters')}"><span class="n-label"></span>
      <span style="display:flex;align-items:center">${story ? `<span class="n-words">${fmtNum(words)}</span>` : ''}${flagged ? `<span class="n-flag" title="${t('Unresolved placeholder')}"></span>` : ''}</span></div>`;
    item.querySelector('.n-label').textContent = chId === solo
      ? (book.title ? shownTitle(book.title) : t('The story'))
      : (chTitle ? `${chapterMark(chId)} · ${chTitle}` : chapterName(chId));

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
    // right-click: what it is, or Delete
    item.addEventListener('contextmenu', (e) => {
      if (IS_POCKET) { e.preventDefault(); return; } // on a phone this pane is for hopping
      if (e.target.closest('.nav-note[contenteditable="true"]')) return; // the note's own text menu
      e.preventDefault();
      chapterMenu(chId, e.clientX, e.clientY, rowEl);
    });

    if (story && IS_POCKET) {
      // on a phone this pane is for hopping: a tap anywhere on the box
      // goes there. The note is read here and written in the Outline.
      const note = document.createElement('div');
      note.className = 'nav-note nav-note-ro';
      note.textContent = book.chapterNotes[chId] || '';
      item.appendChild(note);
    } else if (story) {
      // outline your whole book from this panel:
      const note = document.createElement('div');
      note.className = 'nav-note';
      note.contentEditable = 'true';
      note.spellcheck = false;
      note.textContent = book.chapterNotes[chId] || '';
      note.setAttribute('role', 'textbox');
      note.setAttribute('aria-label', t('Outline note'));
      note.setAttribute('aria-placeholder', t('What happens here…'));
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
    } else if (kind !== 'contents') {
      // a page shows the start of what it says
      const peek = document.createElement('div');
      peek.className = 'nav-note nav-peek';
      peek.textContent = entryPeek(chId);
      if (!peek.textContent && PAGE_PROMPTS[kind]) { peek.dataset.ph = PAGE_PROMPTS[kind](); peek.classList.add('blank'); }
      item.appendChild(peek);
    }

    item.onclick = () => {
      switchTab('manuscript');
      if (IS_POCKET) {
        // the top of the chapter, and the pane steps aside for the page
        const sec = document.querySelector(`.chapter[data-id="${chId}"]`);
        focusChapterStart(chId);
        if (sec) sec.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
        if ($('#nav-pane').dataset.pinned !== '1') $('#nav-pane').classList.remove('open');
        return;
      }
      focusChapter(chId);
    };
    // from the keyboard, the row is the chapter's button (F6 reaches the pane)
    pressable(rowEl, [
      item.querySelector('.n-label').textContent,
      story ? t('{n} words', { n: words }) : '',
      flagged ? t('Unresolved placeholder') : ''
    ].filter(Boolean).join(', '));
    list.appendChild(gap(i));
    list.appendChild(item);
    if (chId === focusedRow) rowEl.focus({ preventScroll: true });
  });
  list.appendChild(gap(book.chapterOrder.length));
  justAddedEntry = null;
  renderContentsLists();
}

// the first words of a page, for its box in the Chapters pane
function entryPeek(chId) {
  const el = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  const holder = document.createElement('template');
  holder.innerHTML = el ? el.innerHTML : (chapterHTML[chId] || '');
  const first = [...holder.content.querySelectorAll('p:not(.ghost):not(.scene-break)')].map((p) => p.textContent.trim()).find(Boolean);
  return first || '';
}

// The + between two boxes: which kind, then it's there, in place
let justAddedEntry = null;
async function addEntryMenu(at, x, y, from) {
  const hasContents = book.chapterOrder.some((c) => chapterKind(c) === 'contents');
  const kind = await popMenu(x, y, CHAPTER_KINDS.map((k) => ({ label: kindName(k), value: k, disabled: k === 'contents' && hasContents })), { from });
  if (!kind) return;
  addEntry(at, kind);
}
function addEntry(at, kind) {
  switchTab('manuscript');
  snapshotStructure('add ' + kind);
  const chId = newEntryId();
  justAddedEntry = chId;
  book.chapterOrder.splice(at, 0, chId);
  setChapterKind(chId, kind);
  chapterHTML[chId] = kind === 'copyright' ? copyrightStarter() : '<p><br></p>';
  persistChapter(chId);
  saveMeta();
  renderChapters();
  // the new page is ready to write on (the contents, to look at)
  if (kind === 'copyright') focusChapter(chId); else focusChapterStart(chId);
  document.querySelector(`.chapter[data-id="${chId}"]`).scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  updateCounters();
  if (currentTab === 'outline') renderOutline();
  return chId;
}
const newEntryId = () => 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);

// The contents, in the manuscript: the parts, the chapters and the pages at
// the back, as the reader will find them, each one a way there
function bookContents(meta = book) {
  const solo = soloStory(meta);
  const out = [];
  let inPart = false;
  for (const chId of meta.chapterOrder) {
    const kind = chapterKind(chId, meta);
    if (kind === 'part') inPart = true;
    else if (BACK_KINDS.includes(kind)) inPart = false;
    if (['copyright', 'dedication', 'epigraph', 'contents'].includes(kind) || chId === solo) continue;
    let label = STORY_KINDS.includes(kind) ? chapterHeading(chId, meta) || chapterName(chId, meta) : chapterName(chId, meta);
    if (kind === 'part') {
      const partTitle = partTitleOf(chId);
      if (partTitle) label += ': ' + partTitle;
    }
    out.push({ chId, label, type: kind === 'part' ? 'part' : STORY_KINDS.includes(kind) ? 'chapter' : 'page', level: inPart && kind !== 'part' ? 1 : 0 });
  }
  return out;
}
// a part's title is the first line of its page (what follows is its quote)
function partTitleOf(chId) {
  const el = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  const paras = parasFromHtml(el ? el.innerHTML : (chapterHTML[chId] || ''));
  return paras[0] && !paras[0].sceneBreak && !isAttribution(paras[0]) ? paras[0].text : '';
}
function renderContentsLists() {
  const lists = $$('#chapters .toc-list');
  if (!lists.length) return;
  const entries = bookContents();
  for (const list of lists) {
    list.innerHTML = '';
    for (const e of entries) {
      const li = document.createElement('li');
      li.className = `t-${e.type} lv${e.level}`;
      li.textContent = e.label;
      // a line takes you to its page: the caret at its start, and the page in view
      li.onclick = () => {
        focusChapterStart(e.chId);
        const sec = document.querySelector(`.chapter[data-id="${e.chId}"]`);
        if (sec) sec.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
      };
      list.appendChild(li);
    }
  }
}

// A new chapter goes at the end of the story: after the last chapter, and
// before an epilogue and the pages at the back
function storyEnd() {
  const order = book.chapterOrder;
  const last = order.map((c) => chapterKind(c)).lastIndexOf('chapter');
  if (last >= 0) return last + 1;
  let at = order.length;
  while (at > 0 && BACK_KINDS.includes(chapterKind(order[at - 1]))) at--;
  return at;
}
$('#nav-add').onclick = () => {
  switchTab('manuscript');
  focusChapter(createChapterAt(storyEnd()));
};

// drop target for chapter reordering, with a gold line showing the landing spot
const navList = $('#nav-list');
// the + on the seam nearest the pointer, when it's near one (the pane
// listens, so the seams above the first box and below the last wake too)
$('#nav-pane').addEventListener('mousemove', (e) => {
  if (chapterDragActive || e.buttons) return;
  let near = null;
  let best = 9;
  for (const g of navList.querySelectorAll('.nav-gap')) {
    const d = Math.abs(e.clientY - g.getBoundingClientRect().top);
    if (d < best) { best = d; near = g; }
  }
  for (const g of navList.querySelectorAll('.nav-gap')) g.classList.toggle('near', g === near);
});
$('#nav-pane').addEventListener('mouseleave', () => {
  navList.querySelectorAll('.nav-gap.near').forEach((g) => g.classList.remove('near'));
});
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
  if (pane.dataset.pinned !== '1' && (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom)) {
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
// files from Finder dropped on the pane become chapters where they land
// (documents dropped in as chapters are behind Show More Features)
const navFileDrag = (e) => e.dataTransfer.types.includes('Files') && !!book && !isScript() && featureOn('exports');
navList.addEventListener('dragover', (e) => {
  if (!e.dataTransfer.types.includes('application/x-neo-chapter') && !navFileDrag(e)) return;
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
  if (e.dataTransfer.files && e.dataTransfer.files.length && navFileDrag(e)) {
    e.preventDefault();
    const ind = document.querySelector('.nav-drop-ind');
    let next = ind ? ind.nextElementSibling : null;
    while (next && !next.classList.contains('nav-item')) next = next.nextElementSibling;
    if (ind) ind.remove();
    await importDroppedChapters(e.dataTransfer.files, next ? next.dataset.id : null);
    return;
  }
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
  // (a menu opened from the Chapters pane keeps it open while it's up)
  const pinned = () => (isPinnable && pane.dataset.pinned === '1') ||
    (pane.id === 'nav-pane' && (chapterDragActive || !!document.querySelector('.pop-menu'))) ||
    (pane.id === 'side-pane' && $('#editor-view').classList.contains('darlings-tab')); // the snapshots stay
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
wireHoverPane($('#nav-hotzone'), $('#nav-pane'), true);
// a drag from Finder fires no mouseenter: files over the hot zone open the
// Chapters pane, so they can be dropped between chapters
$('#nav-hotzone').addEventListener('dragenter', (e) => {
  if (navFileDrag(e)) $('#nav-pane').classList.add('open');
});
$('#nav-pane').addEventListener('dragleave', (e) => {
  const pane = $('#nav-pane');
  if (!navFileDrag(e) || pane.dataset.pinned === '1') return;
  if (e.relatedTarget && (pane.contains(e.relatedTarget) || e.relatedTarget.id === 'nav-hotzone')) return;
  pane.classList.remove('open');
});
wireHoverPane($('#side-hotzone'), $('#side-pane'), true);

// leaving the window closes unpinned panes (they used to stick open)
function closeUnpinnedPanes() {
  // Wayland can blur the window as a native chapter drag begins.
  if (!chapterDragActive && $('#nav-pane').dataset.pinned !== '1') $('#nav-pane').classList.remove('open');
  if ($('#side-pane').dataset.pinned !== '1' && !$('#editor-view').classList.contains('darlings-tab')) $('#side-pane').classList.remove('open');
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

// Keep Open, on either pane: the page moves over to make room, and the
// choice stays for next time (on this computer)
function pinPane(side, on, key = side) {
  const pane = $(side === 'nav' ? '#nav-pane' : '#side-pane');
  const pin = $(side === 'nav' ? '#nav-pin' : '#side-pin');
  pane.dataset.pinned = on ? '1' : '0';
  pin.classList.toggle('pinned', on);
  pin.setAttribute('aria-pressed', on ? 'true' : 'false');
  $('#editor-view').classList.toggle(side + '-pinned', on);
  if (on) pane.classList.add('open');
  try {
    const kept = JSON.parse(localStorage.getItem('neo-pinned-panes') || '{}');
    kept[key] = on;
    localStorage.setItem('neo-pinned-panes', JSON.stringify(kept));
  } catch { /* fine: it just won't be remembered */ }
}
$('#side-pin').onclick = () => pinPane('side', $('#side-pane').dataset.pinned !== '1');
$('#nav-pin').onclick = () => pinPane('nav', $('#nav-pane').dataset.pinned !== '1', book && isScript() ? 'scriptNav' : 'nav');
if (!NO_HOVER) {
  try {
    const kept = JSON.parse(localStorage.getItem('neo-pinned-panes') || '{}');
    if (kept.nav) pinPane('nav', true);
    if (kept.side) pinPane('side', true);
  } catch { /* nothing kept */ }
}

/* ================================================================== */
/*  NOTES PAGES — the book's, and one for each chapter                 */
/* ================================================================== */
// The Notes tab holds a page for the whole book (notes.html, as it always
// has) and one for each chapter (notes-<chapter id>.html, on disk once
// something's written there). It opens on the chapter being written. The
// left pane lists the pages in the book's order and only turns them; the
// right one shows what the manuscript already knows about the chapter on
// the page: its outline note, its open placeholders, the darlings cut from
// it. Only "Go to" there leaves the tab.
let notesPage = 'book';
let notesPeeks = {}; // page → its text, for the left pane
let notesPeeksBook = '';
const notesKind = (page) => (page === 'book' ? 'notes' : 'notes-' + page);
// a chapter's own page is behind Show More Features; one with notes on it
// already stays open to the writer
const notesPageOk = (page) => page === 'book' || (!!book && book.chapterOrder.includes(page) && isStory(page) && (featureOn('notesPages') || !!notesPeeks[page]));

// what a page holds: the text waiting to be saved, else the file
function readNotesPage(bookId, page) {
  const pending = auxPending[bookId + '/' + notesKind(page)];
  return pending ? Promise.resolve(pending.html) : auxRead(bookId, notesKind(page));
}
const htmlText = (html) => {
  const d = document.createElement('template');
  d.innerHTML = html || '';
  d.content.querySelectorAll('p, div, li, br').forEach((n) => n.after('\n'));
  return (d.content.textContent || '').split('\n').map((s) => s.trim()).filter(Boolean).join('\n');
};

// the pane's peeks, read once each time the tab opens (a missing page reads as '')
function loadNotesPeeks() {
  if (!book) return;
  const bookId = book.id;
  const pages = ['book', ...book.chapterOrder.filter((c) => isStory(c))];
  Promise.all(pages.map((p) => readNotesPage(bookId, p).then((h) => htmlText(h), () => ''))).then((texts) => {
    if (!book || book.id !== bookId) return;
    notesPeeks = {};
    // the page open now goes by what's on it (it may have been typed on
    // while the others were read)
    const ed = $('#aux-editor');
    const open = currentTab === 'notes' && ed.dataset.kind === notesKind(notesPage) ? htmlText(ed.innerHTML) : null;
    pages.forEach((p, i) => {
      const text = p === notesPage && open !== null ? open : texts[i];
      if (p === 'book') notesPeeksBook = text; else notesPeeks[p] = text;
    });
    if (currentTab === 'notes') renderNotesNav();
  });
}

function notesLabel(chId) {
  const chTitle = (book.chapterTitles || {})[chId];
  if (chId === soloStory()) return book.title ? shownTitle(book.title) : t('The story');
  return chTitle && chapterKind(chId) !== 'unnumbered' ? `${chapterMark(chId)} · ${chTitle}` : stickyChapterLabel(chId);
}

function notesNavList() {
  let list = $('#notes-nav');
  if (list) return list;
  const head = $('#nav-head > span');
  if (head && !$('#nav-head .nav-title-notes')) {
    head.classList.add('nav-title-chapters');
    const alt = document.createElement('span');
    alt.className = 'nav-title-notes';
    head.after(alt);
  }
  list = document.createElement('div');
  list.id = 'notes-nav';
  $('#nav-list').after(list);
  return list;
}

function renderNotesNav() {
  if (!book) return;
  const list = notesNavList();
  $('#nav-head .nav-title-notes').textContent = tabName('notes');
  list.innerHTML = '';
  const words = (s) => (s ? countWords(s) : 0);
  const row = (page, label, text) => {
    const item = document.createElement('div');
    item.className = 'nav-item notes-item' + (page === notesPage ? ' current' : '') + (page === 'book' ? ' notes-book' : '');
    item.dataset.page = page;
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    const n = words(text);
    item.innerHTML = `<div class="n-row"><span class="n-label"></span><span style="display:flex;align-items:center">${n ? `<span class="n-words">${fmtNum(n)}</span>` : ''}</span></div><div class="nav-note nav-note-ro"></div>`;
    item.querySelector('.n-label').textContent = label;
    if (page !== 'book' && page === currentChapterId) {
      const dot = document.createElement('span');
      dot.className = 'notes-here';
      dot.title = t('The chapter you’re writing');
      item.querySelector('.n-label').after(dot);
    }
    const peek = item.querySelector('.nav-note');
    if (text) peek.textContent = text.replace(/\n/g, ' ');
    else { peek.classList.add('blank'); peek.dataset.ph = t('No notes yet'); }
    const go = () => {
      openNotesPage(page);
      // on a phone the pane steps aside for the page
      if (IS_POCKET && $('#nav-pane').dataset.pinned !== '1') $('#nav-pane').classList.remove('open');
    };
    item.addEventListener('click', go);
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    list.appendChild(item);
  };
  row('book', t('The Book'), notesPeeksBook);
  // simple NEO lists only the chapter pages that have notes on them
  const shown = (chId) => featureOn('notesPages') || !!notesPeeks[chId];
  if (!book.chapterOrder.some((c) => isStory(c) && shown(c))) return;
  const sep = document.createElement('div');
  sep.className = 'notes-sep';
  list.appendChild(sep);
  let parts = 0;
  for (const chId of book.chapterOrder) {
    const kind = chapterKind(chId);
    if (kind === 'part' && featureOn('notesPages')) {
      parts += 1;
      const p = document.createElement('div');
      p.className = 'notes-part';
      const title = chapterText(chId).split('\n').map((s) => s.trim()).find(Boolean) || '';
      p.textContent = title ? `${partLabel(parts)} · ${title}` : partLabel(parts);
      list.appendChild(p);
      continue;
    }
    if (!isStory(chId) || !shown(chId)) continue;
    row(chId, notesLabel(chId), notesPeeks[chId] || '');
  }
}

// turn to another page without leaving the tab
function openNotesPage(page) {
  if (!book || !notesPageOk(page)) page = 'book';
  if (currentTab === 'notes' && page === notesPage) return;
  if (currentTab === 'notes') tabPlaces.notes = { scroll: $('#paper-scroll').scrollTop, page: notesPage };
  notesPage = page;
  if (currentTab === 'notes') switchTab('notes');
}

// the page's heading: the book's page as it always was; a chapter's names
// the chapter, with a way back up to the book's and its outline note below
function notesHeading() {
  const aux = $('#aux-paper');
  let up = $('#notes-up');
  let line = $('#notes-outline');
  if (!up) {
    up = document.createElement('button');
    up.id = 'notes-up';
    up.addEventListener('click', () => openNotesPage('book'));
    $('#aux-title').before(up);
    line = document.createElement('p');
    line.id = 'notes-outline';
    $('#aux-title').after(line);
  }
  const chapter = notesPage !== 'book';
  up.hidden = !chapter;
  up.textContent = '‹ ' + t('The Book');
  $('#aux-title').textContent = chapter ? (notesPage === soloStory() ? notesLabel(notesPage) : chapterHeading(notesPage) || notesLabel(notesPage)) : tabName('notes');
  aux.classList.toggle('notes-chapter', chapter);
  notesOutlineLine();
}
function notesOutlineLine() {
  const line = $('#notes-outline');
  if (!line) return;
  const note = notesPage !== 'book' && currentTab === 'notes' ? ((book.chapterNotes || {})[notesPage] || '').trim() : '';
  line.hidden = !note;
  line.innerHTML = '';
  if (!note) return;
  const b = document.createElement('b');
  b.textContent = tabName('outline');
  line.append(b, document.createTextNode(note));
}

function notesSideList() {
  let list = $('#notes-side');
  if (list) return list;
  const head = $('#side-head > span');
  if (head && !$('#side-head .side-title-chnotes')) {
    head.classList.add('side-title-notes');
    const alt = document.createElement('span');
    alt.className = 'side-title-chnotes';
    head.after(alt);
  }
  list = document.createElement('div');
  list.id = 'notes-side';
  $('#sticky-list').after(list);
  return list;
}

// a line of text from the manuscript, added to the end of the page
function copyToNotes(text) {
  const ed = $('#aux-editor');
  if (currentTab !== 'notes' || ed.contentEditable !== 'true') return;
  const p = document.createElement('p');
  p.textContent = text;
  const last = ed.lastElementChild;
  if (last && last.tagName === 'P' && !last.textContent.trim()) last.replaceWith(p);
  else ed.appendChild(p);
  auxDirty = true;
  scheduleAuxSave();
  notesTyped();
  p.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' });
  toast(t('Added to the end of these notes'));
}

function renderNotesSide() {
  if (!book || currentTab !== 'notes') return;
  const list = notesSideList();
  const chapter = notesPage !== 'book';
  $('#side-head .side-title-chnotes').textContent = chapter ? t('From this chapter') : t('Across the book');
  list.innerHTML = '';
  const label = (text, count) => {
    const l = document.createElement('div');
    l.className = 'ns-label';
    l.innerHTML = '<span></span><span></span>';
    l.firstChild.textContent = text;
    l.lastChild.textContent = count ? String(count) : '';
    list.appendChild(l);
  };
  const empty = (text) => {
    const e = document.createElement('div');
    e.className = 'ns-empty';
    e.textContent = text;
    list.appendChild(e);
  };
  const card = (cls, text, actions, meta) => {
    const c = document.createElement('div');
    c.className = 'sticky ns-card ' + cls;
    if (meta) {
      const m = document.createElement('div');
      m.className = 's-ch';
      m.textContent = meta;
      c.appendChild(m);
    }
    const body = document.createElement('div');
    body.className = 'ns-text';
    body.textContent = text;
    c.appendChild(body);
    const acts = document.createElement('div');
    acts.className = 's-actions';
    actions.forEach(([name, fn], i) => {
      if (i) { const s = document.createElement('span'); s.className = 's-sep'; s.textContent = '·'; acts.appendChild(s); }
      const b = document.createElement('button');
      b.textContent = name;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      acts.appendChild(b);
    });
    c.appendChild(acts);
    list.appendChild(c);
  };
  const goTo = (sid) => [t('Go to') + ' ↗', () => returnToMark(sid)];
  const open = stickies.filter((s) => !s.resolved && book.chapterOrder.includes(s.chapterId));

  if (!chapter) {
    label(t('Open placeholders'), open.length);
    if (!open.length) empty(t('None open.'));
    const order = (s) => book.chapterOrder.indexOf(s.chapterId);
    for (const s of [...open].sort((a, b) => order(a) - order(b))) {
      const acts = [goTo(s.id)];
      if (isStory(s.chapterId)) acts.unshift([t('Chapter notes'), () => openNotesPage(s.chapterId)]);
      card('unresolved', s.text || t('(no words yet)'), acts, stickyChapterLabel(s.chapterId));
    }
    return;
  }

  // the outline note: the same one the Outline and the Chapters pane show
  label(t('Outline note'));
  const oc = document.createElement('div');
  oc.className = 'sticky ns-card';
  const note = document.createElement('div');
  note.className = 'ns-outline';
  note.contentEditable = 'true';
  note.spellcheck = false;
  note.setAttribute('role', 'textbox');
  note.setAttribute('aria-label', t('Outline note'));
  note.dataset.ph = t('What happens here…');
  const chId = notesPage;
  note.textContent = (book.chapterNotes || {})[chId] || '';
  note.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); note.blur(); }
    e.stopPropagation();
  });
  note.addEventListener('input', () => {
    book.chapterNotes = book.chapterNotes || {};
    book.chapterNotes[chId] = note.textContent.trim();
    if (chId === notesPage) notesOutlineLine();
  });
  note.addEventListener('blur', () => {
    book.chapterNotes = book.chapterNotes || {};
    book.chapterNotes[chId] = note.textContent.trim();
    scheduleMetaSave();
    scheduleNavRefresh();
  });
  oc.appendChild(note);
  list.appendChild(oc);

  const here = open.filter((s) => s.chapterId === chId);
  label(t('Placeholders'), here.length);
  if (!here.length) empty(t('None open.'));
  for (const s of here) {
    card('unresolved', s.text || t('(no words yet)'), [[t('Copy to notes'), () => copyToNotes(s.text)], goTo(s.id)].filter((a, i) => i || s.text));
  }

  const cut = darlings.filter((d) => d.chapterId === chId && d.text);
  label(t('Darlings from here'), cut.length);
  if (!cut.length) empty(t('Nothing cut from this chapter.'));
  for (const d of cut) card('ns-darling', d.text, [[t('Copy to notes'), () => copyToNotes(d.text)]]);
}

// typing on a page keeps its peek in the pane up to date
let notesTypedQueued = false;
function notesTyped() {
  const ed = $('#aux-editor');
  if (currentTab !== 'notes' || !ed.dataset.kind || !ed.dataset.kind.startsWith('notes')) return;
  if (notesTypedQueued) return;
  notesTypedQueued = true;
  setTimeout(() => {
    notesTypedQueued = false;
    if (currentTab !== 'notes') return;
    const text = htmlText(ed.innerHTML);
    if (notesPage === 'book') notesPeeksBook = text; else notesPeeks[notesPage] = text;
    if (!document.activeElement || !document.activeElement.closest('#notes-nav')) renderNotesNav();
  }, 400);
}

// a chapter folded into another (merged up, or joined in the Outline)
// brings its notes page along, at the end of the other's. Its own file
// stays where it is, so ⌘Z gives the chapter back with its notes.
async function foldNotesPage(fromId, intoId) {
  if (!book) return;
  const bookId = book.id;
  try {
    const [from, into] = await Promise.all([readNotesPage(bookId, fromId), readNotesPage(bookId, intoId)]);
    if (!htmlText(from)) return;
    const html = (into || '') + from;
    const key = bookId + '/' + notesKind(intoId);
    auxPending[key] = { bookId, kind: notesKind(intoId), html, inFlight: false };
    flushAux();
    if (book && book.id === bookId) notesPeeks[intoId] = htmlText(html);
  } catch (err) {
    window.neo.logError('notes fold: ' + (err && err.message || err));
  }
}

// a chapter deleted takes its notes page to Darlings, like its words
async function notesPageToDarlings(chId, label) {
  try {
    const html = await readNotesPage(book.id, chId);
    const text = htmlText(html);
    if (!text) return false;
    darlings.push({
      id: 'd-' + Date.now().toString(36) + 'n',
      html,
      text: text.slice(0, 2000),
      chapterId: null,
      chapterLabel: t('notes for {name}', { name: label }),
      date: new Date().toISOString()
    });
    return true;
  } catch { return false; }
}
