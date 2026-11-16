'use strict';

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
    writeLibrary(library);
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
  breakRun++; // the engine never saw this cut: ⌘Z inside the text must reach the structural stack

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
    chapterLabel: chIdx >= 0 ? chapterName(chId) : t('Manuscript'),
    anchorPrefix,
    anchorSuffix,
    date: new Date().toISOString()
  });
  // Darlings first; the chapter without the passage is saved only once the
  // passage is safe there. If it can't be, the cut is undone.
  const bookId = book.id;
  try {
    await writeSidecar(bookId, 'darlings', darlings);
  } catch {
    delete sidecarPending[bookId + '/darlings'];
    if (book && book.id === bookId) await structuralUndo();
    toast(t('NEO couldn’t save to Darlings, so the passage stays where it was'));
    return;
  }
  if (chId && book && book.id === bookId) scheduleChapterSave(chId);
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
  if (changed) await writeSidecar(book.id, 'darlings', darlings);
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

let auxLoad = 0; // which Notes read is the current one
function switchTab(name) {
  closeCardEditor();
  closeFootnote();
  auxLoad++;
  $('#editor-view').classList.remove('board-on');
  updateZoomDisplay(); // the page's own zoom, not the cards' (#336)
  const scroller = $('#paper-scroll');
  if (book && currentTab && currentTab !== name) {
    tabPlaces[currentTab] = currentTab === 'manuscript'
      ? { caret: captureCaret(), scroll: scroller.scrollTop }
      : { scroll: scroller.scrollTop, page: currentTab === 'notes' ? notesPage : undefined };
  }
  // Notes opens on the chapter being written (on the book's page from a
  // page that isn't a chapter); turning its pages is openNotesPage
  if (book && name === 'notes' && currentTab !== 'notes') {
    notesPage = currentChapterId && notesPageOk(currentChapterId) ? currentChapterId : 'book';
    loadNotesPeeks();
  }
  if (book && !notesPageOk(notesPage)) notesPage = 'book';
  currentTab = name;
  sidePaneForTab(name);
  queueSideCards();
  applyBright();
  $$('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === name);
    t.setAttribute('aria-selected', t.dataset.tab === name ? 'true' : 'false');
  });
  if (spellOn) setTimeout(scanSpellingHere, 0);
  const paper = $('#paper');
  const aux = $('#aux-paper');
  const auxEditor = $('#aux-editor');
  const dList = $('#darlings-list');
  const oList = $('#outline-list');
  const back = name === 'notes' && tabPlaces.notes && tabPlaces.notes.page !== notesPage ? { scroll: 0 } : tabPlaces[name];
  const returnTo = () => { if (back && typeof back.scroll === 'number') scroller.scrollTop = back.scroll; };

  // stash whatever aux content was open
  flushAux();

  // an open Find follows the tab (Notes arrives from disk, so it looks later)
  const findHere = () => { if (!$('#searchbar').hidden) runSearch(); };
  if (name === 'manuscript') {
    paper.hidden = false;
    aux.hidden = true;
    if (back && back.caret) restoreCaret(back.caret); // brings the scroll along
    else returnTo();
    findHere();
    vimRest();
    return;
  }
  paper.hidden = true;
  aux.hidden = false;
  auxEditor.hidden = true;
  dList.hidden = true;
  oList.hidden = true;
  // the outline's cards, their List/Cards switch and their hint belong to the Outline alone
  for (const id of ['#outline-board', '#outline-views', '#outline-board-hint']) { const el = $(id); if (el) el.hidden = true; }

  hideSnapshot();
  if (name === 'darlings') {
    $('#aux-title').textContent = t('Darlings');
    dList.hidden = false;
    renderDarlings();
    renderSnapList();
    returnTo();
    findHere();
  } else if (name === 'outline') {
    $('#aux-title').textContent = tabName('outline');
    oList.hidden = false;
    if (!book.chapterOrder.some((c) => isStory(c))) createChapterAt(storyEnd());
    renderOutline();
    returnTo();
    findHere();
  } else {
    notesHeading();
    auxEditor.hidden = false;
    // The page waits for its text: nothing typed into the old contents
    // while the file is read can be overwritten by it, and a read that
    // comes back after the writer moved on (another tab, another book)
    // lands nowhere.
    const bookId = book.id;
    const load = ++auxLoad;
    const kind = notesKind(notesPage);
    auxEditor.contentEditable = 'false';
    auxEditor.dataset.kind = '';
    auxEditor.dataset.book = '';
    auxEditor.dataset.ph = notesPage === 'book' ? '' : t('Notes for this chapter');
    const pending = auxPending[bookId + '/' + kind];
    (pending ? Promise.resolve(pending.html) : auxRead(bookId, kind)).then((html) => {
      if (load !== auxLoad || !book || book.id !== bookId || currentTab !== name || notesKind(notesPage) !== kind) return;
      auxEditor.innerHTML = html || '';
      auxEditor.dataset.kind = kind;
      auxEditor.dataset.book = bookId;
      auxEditor.contentEditable = 'true';
      auxEditor.focus({ preventScroll: true });
      returnTo();
      findHere();
      vimRest();
    }, (err) => {
      if (load !== auxLoad) return;
      window.neo.logError('notes read: ' + (err && err.message || err));
      toast(t('NEO couldn’t read this page from disk'));
    });
  }
}

/* ================================================================== */
/*  STRUCTURED OUTLINE                                                 */
/*  Chapter lines are the book's real chapters. Section notes become   */
/*  grayed "ghost" paragraphs in the manuscript                       */
/* ================================================================== */

const secLetter = (i) => String.fromCharCode(65 + (i % 26));

/**
 * Where the caret goes after a section is removed from the outline: the end of the section ABOVE it,
 * the way a text editor behaves. Only the first section has no line above it, and then the chapter's
 * own line is where the caret belongs.
 */
function focusAfterSectionRemoved(list, index, chId) {
  const above = index > 0 ? list[index - 1] : undefined;
  return above ? { secId: above.id } : { chId };
}

/** Put the caret at the END of an outline line's text, the way moving down the list does. */
function focusOutlineTextEnd(el) {
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

function renderOutline(focusTarget) {
  // the outline as cards, unless the writer chose the list
  if (showOutlineView()) { renderBoard(); return; }
  const boardHint = $('#outline-board-hint');
  if (boardHint) boardHint.hidden = true;
  book.sectionNotes = book.sectionNotes || {};
  book.chapterNotes = book.chapterNotes || {};
  const wrap = $('#outline-list');
  wrap.innerHTML = '';

  // the story's lines, with each part standing over its chapters (the pages
  // a book carries have nothing to outline)
  book.chapterOrder.forEach((chId, i) => {
    const kind = chapterKind(chId);
    if (kind === 'part') { wrap.appendChild(outlinePartLine(chId)); return; }
    if (!STORY_KINDS.includes(kind)) return;
    wrap.appendChild(outlineLine('chapter', chId, null, i, chapterMark(chId),
      book.chapterNotes[chId] || ''));
    (book.sectionNotes[chId] || []).forEach((sec, j) => {
      wrap.appendChild(outlineLine('section', chId, sec.id, j, secLetter(j), sec.text));
    });
  });

  const hint = document.createElement('div');
  hint.className = 'ol-hint';
  hint.textContent = t('Enter — new chapter · Tab — make it a section, or a new section below one · ⇧Tab — make it a chapter again · Backspace on an empty line removes it');
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

// a part in the outline: its name and title, over the chapters it holds
function outlinePartLine(chId) {
  const line = document.createElement('div');
  line.className = 'ol-line ol-part';
  line.dataset.chId = chId;
  const num = document.createElement('span');
  num.className = 'ol-num';
  num.textContent = chapterMark(chId);
  const name = document.createElement('div');
  name.className = 'ol-part-name';
  const title = partTitleOf(chId);
  name.textContent = chapterName(chId) + (title ? ': ' + title : '');
  line.append(num, name);
  line.addEventListener('contextmenu', (e) => { e.preventDefault(); chapterMenu(chId, e.clientX, e.clientY, line); });
  return line;
}

// the story entry before this one (pages and parts aren't where sections go)
function storyBefore(chId) {
  const order = book.chapterOrder;
  for (let i = order.indexOf(chId) - 1; i >= 0; i--) if (isStory(order[i])) return order[i];
  return null;
}

function outlineLine(kind, chId, secId, index, label, text) {
  const line = document.createElement('div');
  line.className = 'ol-line ol-' + kind;
  line.dataset.chId = chId;
  if (secId) line.dataset.secId = secId;
  const num = document.createElement('span');
  num.className = 'ol-num';
  num.textContent = label;
  if (kind === 'chapter' && chapterKind(chId) !== 'chapter') num.title = chapterName(chId);
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
  // a list pasted (Word, Obsidian, a notes app): a line for each item, as if
  // typed with Enter and Tab. On a chapter's line the top items are chapters
  // and the indented ones their sections; on a section's, each is a section (#348)
  txt.addEventListener('paste', (e) => {
    const items = pastedOutline(e.clipboardData);
    if (items.length < 2) {
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' '));
      return;
    }
    e.preventDefault();
    snapshotStructure('outline paste', { outlineFocus: here() });
    book.sectionNotes = book.sectionNotes || {};
    book.chapterNotes = book.chapterNotes || {};
    document.execCommand('insertText', false, items[0].text);
    save();
    let focus = here();
    const touched = new Set([chId]);
    if (kind === 'section') {
      const list = book.sectionNotes[chId] || (book.sectionNotes[chId] = []);
      let at = list.findIndex((x) => x.id === secId) + 1;
      for (const it of items.slice(1)) {
        const sec = { id: newSectionId(), text: it.text };
        list.splice(at++, 0, sec);
        focus = { secId: sec.id };
      }
    } else {
      let cur = chId; // the chapter the items go after, and their sections into
      let secAt = 0; // under the line pasted on, ahead of the sections it already has
      for (const it of items.slice(1)) {
        if (it.level === 0) {
          const next = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
          book.chapterOrder.splice(book.chapterOrder.indexOf(cur) + 1, 0, next);
          cur = next;
          chapterHTML[cur] = '<p><br></p>';
          book.chapterNotes[cur] = it.text;
          persistChapter(cur);
          secAt = 0;
          focus = { chId: cur };
        } else {
          const list = book.sectionNotes[cur] || (book.sectionNotes[cur] = []);
          const sec = { id: newSectionId(), text: it.text };
          list.splice(secAt++, 0, sec);
          touched.add(cur);
          focus = { secId: sec.id };
        }
      }
    }
    scheduleMetaSave();
    renderChapters();
    for (const c of touched) syncGhosts(c);
    updateCounters();
    renderOutline(focus);
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

  // the line the writer is on, so ⌘Z puts the caret back on it
  const here = () => (secId ? { secId } : { chId });

  txt.addEventListener('keydown', (e) => {
    // Typing in a line is the engine's to undo. Once it has nothing left to
    // undo here, the outline's structure is ours: a line added, removed, or
    // turned into a chapter or a section comes back with ⌘Z. (The engine
    // answers a ⌘Z the moment this handler returns, so a moment later we know
    // whether it had anything to take back in this line.)
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      const top = undoStack[undoStack.length - 1];
      if (top && top.outlineFocus) {
        let engineUndid = false;
        const heard = () => { engineUndid = true; };
        txt.addEventListener('beforeinput', heard, { once: true });
        setTimeout(() => {
          txt.removeEventListener('beforeinput', heard);
          if (!engineUndid && undoStack[undoStack.length - 1] === top) structuralUndo();
        }, 0);
      }
      e.stopPropagation();
      return;
    }
    // Enter: always a new chapter. From a chapter's line it goes right after
    // that chapter (or before it, from the very start of a line with words);
    // from a section's line, after the whole chapter the section is in.
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (e.isComposing || e.keyCode === 229) return;
      const above = kind === 'chapter' && caretAtStart();
      save();
      snapshotStructure('outline new chapter', { outlineFocus: here() });
      const at = book.chapterOrder.indexOf(chId) + (above ? 0 : 1);
      const newId = createChapterAt(at);
      updateCounters();
      renderOutline({ chId: newId });
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const lines = [...document.querySelectorAll('.ol-line .ol-text')];
      const next = lines[lines.indexOf(txt) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) focusOutlineTextEnd(next);
    }
    // Tab: always a section. A section's line makes a new one below it; a
    // chapter's line becomes a section of the chapter above, writing and all
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      save();
      if (kind === 'section') {
        snapshotStructure('outline new section', { outlineFocus: here() });
        const list = book.sectionNotes[chId];
        const newSec = { id: newSectionId(), text: '' };
        list.splice(index + 1, 0, newSec);
        scheduleMetaSave();
        syncGhosts(chId);
        renderOutline({ secId: newSec.id });
        return;
      }
      const prevCh = storyBefore(chId);
      if (!prevCh) { toast(t('The first line has to be a chapter')); return; }
      joinChapter(chId, prevCh).then((secId) => {
        if (currentTab === 'outline') renderOutline(secId ? { secId } : { chId: prevCh });
      });
      return;
    }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      if (kind !== 'section') return;
      save();
      snapshotStructure('outline section to chapter', { outlineFocus: here() });
      const list = book.sectionNotes[chId];
      const from = list.findIndex((s) => s.id === secId);
      // the section and the ones after it leave together, so the book's order
      // holds (B in A B C: B and C make the next chapter, A stays). Sections
      // already written over keep their prose here, so those stay here too.
      const [sec, ...after] = list.splice(from);
      const carry = after.length > 0 && !after.some((s) => sectionWritten(chId, s.id));
      if (!carry) list.push(...after);
      const at = book.chapterOrder.indexOf(chId) + 1;
      const newId = createChapterAt(at);
      book.chapterNotes[newId] = sec.text;
      if (carry) book.sectionNotes[newId] = after;
      scheduleMetaSave();
      syncGhosts(chId);
      if (carry) syncGhosts(newId);
      renderOutline({ chId: newId });
    }
    if (e.key === 'Backspace' && txt.textContent.trim() === '') {
      e.preventDefault();
      if (kind === 'section') {
        snapshotStructure('outline section removed', { outlineFocus: here() });
        const list = book.sectionNotes[chId] || [];
        const focus = focusAfterSectionRemoved(list, index, chId);
        book.sectionNotes[chId] = list.filter((s) => s.id !== secId);
        scheduleMetaSave();
        syncGhosts(chId);
        renderOutline(focus);
      } else if (book.chapterOrder.filter((c) => isStory(c)).length > 1 && countWords(chapterText(chId)) === 0) {
        snapshotStructure('outline chapter removed', { outlineFocus: here() });
        const prevCh = storyBefore(chId) || book.chapterOrder.find((c) => c !== chId && isStory(c));
        deleteChapterQuiet(chId).then(() => renderOutline({ chId: prevCh }));
      }
    }
    e.stopPropagation();
  });

  // right-click any outline line to delete it
  line.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (kind === 'chapter') {
      await chapterMenu(chId, e.clientX, e.clientY, line);
    } else {
      const choice = await optionModal(t('Delete this section?'), null,
        [{ label: t('Delete section'), desc: t('Removes the outline line and its gray ghost from the manuscript. Written prose is never touched.'), danger: true, value: 'delete' }]);
      if (choice === 'delete') {
        snapshotStructure('outline section removed', { outlineFocus: here() });
        const list = book.sectionNotes[chId] || [];
        const focus = focusAfterSectionRemoved(list, index, chId);
        book.sectionNotes[chId] = list.filter((s) => s.id !== secId);
        scheduleMetaSave();
        syncGhosts(chId);
        renderOutline(focus);
      }
    }
  });

  line.appendChild(num);
  line.appendChild(txt);
  return line;
}

// a section whose outline line the writer has written over: prose of their
// own now stands where its gray ghost was
function sectionWritten(chId, secId) {
  return !!document.querySelector(`.chapter[data-id="${chId}"] .chapter-body p[data-sec-id="${secId}"]:not(.ghost)`);
}

// Push section notes into the manuscript as gray ghost paragraphs,
// with real *** scene breaks between sections. A ghost stays where it is
// (the cards can set one between two written sections); a note the page
// doesn't have yet goes in before the next section that's already there,
// else at the end. Once a ghost has been written over, it's prose.
function syncGhosts(chId) {
  const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  if (!body) return;
  const list = (book.sectionNotes && book.sectionNotes[chId]) || [];
  const notes = new Map(list.map((s) => [s.id, s]));

  // 1. a ghost whose note is gone (or emptied) leaves, with the *** made
  //    for it; the rest take their note's words
  for (const p of [...body.querySelectorAll('p.ghost[data-sec-id]')]) {
    const sec = notes.get(p.dataset.secId);
    if (sec && sec.text) {
      if (p.textContent !== sec.text) p.textContent = sec.text;
      continue;
    }
    removeGhost(body, p);
  }

  // 2. a note with no place on the page yet gets one
  list.forEach((sec, i) => {
    if (!sec.text || body.querySelector(`p[data-sec-id="${sec.id}"]`)) return;
    let before = null;
    for (let j = i + 1; j < list.length && !before; j++) {
      const el = body.querySelector(`p[data-sec-id="${list[j].id}"]`);
      if (el) before = segmentStartEl(body, el);
    }
    placeGhost(body, sec, before);
  });
  syncChapter(body, chId);
}

// where the section holding el begins: its *** (or the body's first line)
function segmentStartEl(body, el) {
  let n = el;
  while (n.parentElement && n.parentElement !== body) n = n.parentElement;
  for (let q = n; q; q = q.previousElementSibling) {
    if (q.classList.contains('scene-break')) return q;
    if (!q.previousElementSibling) return q;
  }
  return n;
}

function newSceneBreak(secId) {
  const b = document.createElement('p');
  b.className = 'scene-break';
  if (secId) b.dataset.secBrk = secId;
  b.textContent = '***';
  return b;
}

function placeGhost(body, sec, before) {
  const p = document.createElement('p');
  p.className = 'ghost';
  p.dataset.secId = sec.id;
  p.textContent = sec.text;
  if (before && before.parentElement === body) {
    if (before.classList.contains('scene-break')) {
      body.insertBefore(newSceneBreak(sec.id), before);
      body.insertBefore(p, before);
    } else {
      // the first section of the chapter: the ghost goes ahead of it
      body.insertBefore(p, before);
      body.insertBefore(newSceneBreak(sec.id), before);
    }
    return p;
  }
  const hasContent = body.innerText.trim() !== '';
  if (hasContent && !(body.lastElementChild && body.lastElementChild.classList.contains('scene-break'))) {
    body.appendChild(newSceneBreak(sec.id));
  }
  body.appendChild(p);
  return p;
}

// a ghost leaves, and so does the *** that set it apart
function removeGhost(body, p) {
  const prev = p.previousElementSibling;
  const next = p.nextElementSibling;
  const isBrk = (q) => q && q.classList.contains('scene-break');
  if (isBrk(prev) && (!next || isBrk(next))) prev.remove();
  else if (!prev && isBrk(next)) next.remove();
  p.remove();
  if (!body.firstElementChild) body.innerHTML = '<p><br></p>';
}
