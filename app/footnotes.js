'use strict';

/* ================================================================== */
/*  FOOTNOTES                                                          */
/* ================================================================== */
// ⌘⇧N (Ctrl+Shift+N) puts a footnote where the caret is: a small number on
// the page and a box under the line for its words. Enter or Esc goes back
// to the sentence, just past the number; a click on the number opens it
// again. The note is kept on its marker in the chapter's own file
// (<span class="fn" data-note="…">), so it travels with its sentence:
// cut and paste, undo, sync, Darlings, every export. The numbers are the
// page's own count (a CSS counter), one series through the whole book as
// in every export (Paged.js and Word both number that way), and are never
// saved. Under the chapter's last line its notes are listed, for the
// screen only. A marker deleted with its words sends them to Darlings.
const KFN = K('⌘⇧N', 'Ctrl+Shift+N');
const FN_CHAR = '\u200B';
let fnBox = null; // the open note: { el, text, mark, body, chId, p }

// A caret just past a footnote's number, held as a place between nodes, is
// one the engine won't split a line at: it's put at the start of the words
// that follow (or at the end of the line), the same place to the eye.
function caretOffFootnote(sel) {
  if (!sel.rangeCount || !sel.isCollapsed) return;
  const r = sel.getRangeAt(0);
  const node = r.startContainer;
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const before = node.childNodes[r.startOffset - 1];
  if (!before || !before.classList || !before.classList.contains('fn')) return;
  let next = before.nextSibling;
  if (!next || next.nodeType !== Node.TEXT_NODE) {
    next = document.createTextNode('');
    before.after(next);
  }
  const at = document.createRange();
  at.setStart(next, 0);
  at.collapse(true);
  sel.removeAllRanges();
  sel.addRange(at);
}

function footnoteMark(note) {
  const span = document.createElement('span');
  span.className = 'fn';
  span.contentEditable = 'false';
  span.dataset.note = note || '';
  // one invisible character, so the caret has a place on either side of
  // it (an empty marker slid onto the next line at Enter)
  span.textContent = FN_CHAR;
  return span;
}
const footnoteNumber = (mark) => [...document.querySelectorAll('#chapters .chapter-body .fn')].indexOf(mark) + 1 || 1;

function insertFootnote() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let el = sel.anchorNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const body = el && el.closest ? el.closest('.chapter-body') : null;
  const p = body && el.closest('.chapter-body > p');
  if (!body || !p || isScript() || p.classList.contains('ghost') || p.classList.contains('scene-break')) {
    toast(t('Click into a chapter first, then {key} adds a footnote', { key: KFN }));
    return;
  }
  const chId = body.closest('.chapter').dataset.id;
  currentChapterId = chId;
  const range = sel.getRangeAt(0);
  range.collapse(false);
  const mark = footnoteMark('');
  range.insertNode(mark);
  syncChapter(body, chId);
  renderAllFootnoteLists();
  openFootnote(mark);
}

function openFootnote(mark) {
  closeFootnote();
  const body = mark.closest('.chapter-body');
  const p = mark.closest('.chapter-body > p');
  if (!body || !p) return;
  const chId = body.closest('.chapter').dataset.id;
  // cut into pages, a chapter's sheet is in pieces, and the box sits on the paper instead
  const host = document.body.classList.contains('paged') ? $('#paper') : body.closest('.chapter');
  const el = document.createElement('div');
  el.className = 'fn-box';
  el.contentEditable = 'false';
  const num = document.createElement('span');
  num.className = 'fn-num';
  num.textContent = footnoteNumber(mark);
  const text = document.createElement('div');
  text.className = 'fn-text';
  text.contentEditable = 'plaintext-only';
  text.spellcheck = false;
  text.setAttribute('role', 'textbox');
  text.setAttribute('aria-label', t('Footnote {n}', { n: num.textContent }));
  text.dataset.ph = t('Footnote');
  text.textContent = mark.dataset.note || '';
  const hint = document.createElement('span');
  hint.className = 'fn-hint';
  hint.textContent = t('Enter to go back');
  el.append(num, text, hint);
  host.appendChild(el);
  fnBox = { el, text, mark, body, chId, p };
  p.setAttribute('data-fnopen', '');
  placeFootnoteBox();
  text.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFootnote(true); }
  });
  text.addEventListener('input', () => {
    mark.dataset.note = text.textContent.replace(/\s*\n\s*/g, ' ');
    syncChapter(body, chId);
    queueFootnoteList(body);
    placeFootnoteBox();
  });
  text.addEventListener('blur', () => { setTimeout(() => { if (fnBox && fnBox.el === el && !el.contains(document.activeElement)) closeFootnote(false); }, 0); });
  text.focus();
  const r = document.createRange();
  r.selectNodeContents(text);
  r.collapse(false);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(r);
}

function placeFootnoteBox() {
  if (!fnBox || !fnBox.p.isConnected) return;
  const { el, p, body } = fnBox;
  const host = el.parentElement;
  const c = host.getBoundingClientRect();
  const pieces = p.getClientRects();
  const r = pieces.length ? pieces[pieces.length - 1] : p.getBoundingClientRect();
  const b = [...body.getClientRects()].find((x) => r.left >= x.left - 1 && r.right <= x.right + 1 && r.top >= x.top - 1 && r.bottom <= x.bottom + 1) || body.getBoundingClientRect();
  el.style.left = (b.left - c.left) + 'px';
  el.style.width = b.width + 'px';
  body.closest('.chapter').style.setProperty('--fn-h', (el.offsetHeight + 14) + 'px');
  el.style.top = (r.bottom - c.top + 6) + 'px';
}
window.addEventListener('resize', placeFootnoteBox);

// back: the caret goes back into the sentence, just past the number
function closeFootnote(back = false) {
  if (!fnBox) return;
  const { el, mark, body, chId, p } = fnBox;
  fnBox = null;
  el.remove();
  p.removeAttribute('data-fnopen');
  if (!mark.isConnected) return;
  const note = (mark.dataset.note || '').trim();
  mark.dataset.note = note;
  let after = null;
  if (back) {
    after = document.createRange();
    after.setStartAfter(mark);
    after.collapse(true);
  }
  // a note left empty takes its number away with it: nothing was written
  if (!note) {
    if (back) { after.setStartBefore(mark); after.collapse(true); }
    mark.remove();
  }
  syncChapter(body, chId);
  renderAllFootnoteLists();
  if (back) {
    body.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(after);
  }
}

// the chapter's notes, under its last line (screen only)
const fnListQueue = new Set();
function queueFootnoteList(body) {
  // (null: every chapter's, as numbers further on may have moved)
  if (!fnListQueue.size) requestAnimationFrame(() => { if (fnListQueue.has(null)) renderAllFootnoteLists(); else for (const b of fnListQueue) renderFootnoteList(b); fnListQueue.clear(); });
  fnListQueue.add(body);
}
function renderFootnoteList(body) {
  if (!body || !body.isConnected) return;
  // only the manuscript's chapters: a snapshot's page (#snap-view) is a
  // .chapter-body too, and has no notes list (#448)
  const chapter = body.closest('.chapter');
  if (!chapter) return;
  const marks = [...body.querySelectorAll('.fn')];
  let list = chapter.querySelector(':scope > .fn-list');
  if (!marks.length) { if (list) list.remove(); return; }
  if (!list) {
    list = document.createElement('div');
    list.className = 'fn-list';
    list.contentEditable = 'false';
    list.setAttribute('aria-label', t('Footnotes'));
    body.after(list);
  }
  list.innerHTML = '';
  const before = footnoteNumber(marks[0]) - 1;
  marks.forEach((mark, i) => {
    const row = document.createElement('div');
    row.className = 'fn-row';
    row.tabIndex = 0;
    const n = document.createElement('span');
    n.className = 'fn-n';
    n.textContent = before + i + 1;
    const txt = document.createElement('span');
    txt.textContent = mark.dataset.note || '';
    row.append(n, txt);
    const go = () => { mark.scrollIntoView({ behavior: scrollBehavior(), block: 'center' }); openFootnote(mark); };
    row.addEventListener('click', go);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    list.appendChild(row);
  });
}
function renderAllFootnoteLists() {
  for (const body of document.querySelectorAll('.chapter-body')) renderFootnoteList(body);
}

// a marker deleted with Backspace or Delete: its words go to Darlings
function footnoteToDarlings(mark, chId) {
  const note = (mark.dataset.note || '').trim();
  if (!note) return;
  darlings.unshift({
    id: 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    html: '<p>' + escHtml(note) + '</p>',
    text: note.slice(0, 2000),
    chapterId: chId,
    chapterLabel: t('Footnote'),
    date: new Date().toISOString()
  });
  writeSidecar(book.id, 'darlings', darlings);
  toast(t('Footnote removed — its words are in Darlings'));
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
  writeSidecar(book.id, 'stickies', stickies);
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
  if (r.top < sr.top + 40 || r.bottom > sr.bottom - 40) mark.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
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
  // the Notes tab's right-hand pane lists them too (not while it's being typed in)
  if (currentTab === 'notes' && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#notes-side'))) renderNotesSide();
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
      <div class="s-ch">${chIdx >= 0 ? escHtml(stickyChapterLabel(s.chapterId)) : t('Unplaced')}</div>
      <textarea placeholder="${t('What needs doing here?')}" spellcheck="false"></textarea>
      <div class="s-actions"><button class="s-go">${t('Go to')}</button><span class="s-sep">·</span><button class="s-done">${t('Resolve')}</button></div>`;
    const ta = el.querySelector('textarea');
    ta.value = s.text;
    ta.addEventListener('focus', () => markCurrentSticky(s.id));
    ta.addEventListener('input', () => {
      s.text = ta.value;
      scheduleStickiesSave();
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

// A note is saved a moment after the last keystroke. The save belongs to the
// book it was typed in: leaving the book (Esc to the shelf) writes it at once
// instead of letting the timer find no book, which lost the note's text.
function scheduleStickiesSave() {
  if (!book) return;
  const bookId = book.id;
  const list = stickies;
  clearTimeout(saveTimers.stickies);
  saveTimers.stickies = setTimeout(() => {
    delete saveTimers.stickies;
    writeSidecar(bookId, 'stickies', list);
  }, 600);
}

function flushStickiesSave() {
  if (!saveTimers.stickies || !book) return;
  clearTimeout(saveTimers.stickies);
  delete saveTimers.stickies;
  writeSidecar(book.id, 'stickies', stickies);
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
    writeSidecar(book.id, 'stickies', stickies);
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
  writeSidecar(book.id, 'stickies', stickies);
  renderStickies();
  scheduleNavRefresh();
}

// the note being worked on stands out in the pane (#351): the one whose
// mark was just clicked in the text, or whose words are being edited
function markCurrentSticky(sid) {
  for (const s of document.querySelectorAll('.sticky.current')) if (s.dataset.sid !== sid) s.classList.remove('current');
  const el = sid && document.querySelector(`.sticky[data-sid="${sid}"]`);
  if (el) el.classList.add('current');
}

function focusSticky(sid) {
  $('#side-pane').classList.add('open');
  const el = document.querySelector(`.sticky[data-sid="${sid}"] textarea`);
  if (!el) return;
  markCurrentSticky(sid);
  el.closest('.sticky').scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
  el.focus({ preventScroll: true });
}
