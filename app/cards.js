'use strict';

/* ================================================================== */
/*  OUTLINE CARDS                                                      */
/*  The outline as index cards, set like a page: they read left to    */
/*  right, line after line, so any shape of book fills the window. A   */
/*  chapter starts at its numeral, and its cards share a mat, rounded  */
/*  where the chapter starts and ends and cut square where it wraps.   */
/*  Parts start a fresh line. Sections are the manuscript's own: every */
/*  *** makes one, outlined or not, and a card shows its note or else  */
/*  the section's first line, in quotes. Dragging a card moves the     */
/*  writing with it (⌘Z puts it back). Loose cards, ideas that don't   */
/*  have a chapter yet, wait in the right-hand pane (book.looseCards). */
/*  A script's cards are its scenes (book.sceneNotes holds their notes). */
/* ================================================================== */

// (simple NEO's Outline is the list; the cards are behind Show More Features)
const outlineCardsOn = () => !!book && (isScript() || (featureOn('cards') && (library.outlineView || 'cards') === 'cards'));
const chapterBodyEl = (chId) => document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
const newSectionId = () => 'sec-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

// A chapter cut at its *** lines. Each piece: its *** (none for the first),
// its paragraphs, the outline note it belongs to (if any), and what's on it.
// A paragraph split from a written ghost carries the ghost's id along, so
// only the first piece to hold an id is that note's.
function chapterSegments(chId) {
  const body = chapterBodyEl(chId);
  if (!body) return [];
  const segs = [];
  let cur = { brk: null, ps: [] };
  for (const el of body.children) {
    if (el.classList.contains('scene-break')) { segs.push(cur); cur = { brk: el, ps: [] }; }
    else cur.ps.push(el);
  }
  segs.push(cur);
  const notes = new Set(((book.sectionNotes || {})[chId] || []).map((s) => s.id));
  const claimed = new Set();
  for (const seg of segs) {
    const tagged = seg.ps.find((p) => p.dataset && notes.has(p.dataset.secId) && !claimed.has(p.dataset.secId));
    seg.id = tagged ? tagged.dataset.secId : null;
    if (seg.id) claimed.add(seg.id);
    const prose = seg.ps.filter((p) => !p.classList.contains('ghost'));
    seg.words = countWords(prose.map((p) => p.textContent).join('\n'));
    seg.first = prose.map((p) => p.textContent.replace(/\s+/g, ' ').trim()).find(Boolean) || '';
    seg.flag = seg.ps.some((p) => p.querySelector && p.querySelector('.ph-mark'));
  }
  return segs;
}

// the note a section has, if it has one
const sectionNote = (chId, secId) => ((book.sectionNotes || {})[chId] || []).find((s) => s.id === secId) || null;

// keep a chapter's notes in the order their sections stand on the page
// (a note with no place yet keeps to the end)
function orderSectionNotes(chId) {
  const list = (book.sectionNotes || {})[chId];
  if (!list) return;
  const ids = chapterSegments(chId).map((s) => s.id).filter(Boolean);
  const placed = ids.map((id) => list.find((s) => s.id === id)).filter(Boolean);
  book.sectionNotes[chId] = placed.concat(list.filter((s) => !ids.includes(s.id)));
}

// Zoom is per mode and per device. Novel and script keep their own page zoom, and the outline's
// cards keep their own; none of them travel in library.json, so a phone never inherits the zoom a
// desktop set. `library.pageZoom` / `library.cardZoom` stay as the fallback for devices that have
// not chosen yet, which keeps an existing zoom as the default.
const PAGE_ZOOM_RANGE = { min: 0.75, max: 3 };
// The Pages view (Format → Show Pages) lets the page shrink further, so that
// two fit side by side in a window of any size
const PAGES_ZOOM_MIN = 0.4;
let pagedEnabled = false;
let twoPageEnabled = false;
let pagesQueued = false;
const pagesDirty = new Set();
const pagesOn = () => pagedEnabled && !isScript();
const pageZoomRange = () => ({ min: pagesOn() ? PAGES_ZOOM_MIN : PAGE_ZOOM_RANGE.min, max: PAGE_ZOOM_RANGE.max });
const CARD_ZOOM_RANGE = { min: 0.55, max: 1.5 };
const CARD_ZOOM_KEY = 'neo.cardZoom';
const pageZoomKey = () => 'neo.pageZoom.' + (isScript() ? 'script' : 'novel');

/** The stored zoom, or the fallback, always inside the range. Split out so a test can hold it. */
function resolveStoredZoom(raw, fallback, min, max) {
  const value = raw === null || raw === '' ? NaN : Number(raw);
  const chosen = Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, chosen));
}

function readStoredZoom(key, fallback, range) {
  let raw = null;
  try { raw = localStorage.getItem(key); } catch { /* storage can be off */ }
  return resolveStoredZoom(raw, fallback || 1, range.min, range.max);
}

function rememberZoom(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* storage can be off */ }
}

// ---- zoom rules: the interface size steps by a tenth, 90% to 300% ----
// One rule for every reader: the View menu's commands, the message they send,
// and a size an older NEO saved between steps (1.25 lands on 1.3). A direction
// of 0 resets to 100%.
const UI_ZOOM_RANGE = { min: 0.9, max: 3 };
function snapZoom(value, fallback = 1) {
  const n = value === null || value === '' ? NaN : Number(value);
  const base = Number.isFinite(n) ? n : fallback;
  return Math.round(Math.min(UI_ZOOM_RANGE.max, Math.max(UI_ZOOM_RANGE.min, base)) * 10) / 10;
}
function nextZoomStep(current, direction) {
  if (direction === 0) return 1;
  return snapZoom(snapZoom(current) + (direction > 0 ? 0.1 : -0.1));
}
// ---- end of zoom rules ----

const activePageZoom = () => readStoredZoom(pageZoomKey(), library.pageZoom || 1, pageZoomRange());
function applyPageZoom() {
  document.documentElement.style.setProperty('--page-zoom', activePageZoom());
  updateZoomDisplay();
  fitSpread();
  queuePages(true);
}

// ---- Pages view (Format → Show Pages, Two Pages Side by Side) ----
// The chapters can be shown as separate pages, like a word processor's. The
// text is the same text: styles.css cuts #chapters into page-high columns.
// This side decides when that applies (never for a script, which has pages
// of its own), when two pages fit side by side, and how many pages each
// chapter runs to, so that its last page is a whole page too.
const PAGES_GAP = 28; // px between pages at 100%: styles.css --pg-gap-base

// Format → Page Width: the page's width (and its side margins, which give back
// their room as it widens), for a writer who wants more words to a line (#375).
// Per device, like the zoom.
const PAGE_WIDTHS = { regular: { f: 1, pad: 72 }, wide: { f: 1.25, pad: 56 }, wider: { f: 1.5, pad: 40 } };
function applyPageWidth() {
  const key = featureOn('pages') && PAGE_WIDTHS[library.pageWidth] ? library.pageWidth : 'regular';
  const w = PAGE_WIDTHS[key];
  document.documentElement.style.setProperty('--page-wf', w.f);
  document.documentElement.style.setProperty('--page-pad-x', w.pad + 'px');
  if (window.neo.pageWidthState) window.neo.pageWidthState(key);
  fitSpread();
  queuePages(true);
}
function setPageWidth(value) {
  if (!PAGE_WIDTHS[value] || value === (library.pageWidth || 'regular')) return;
  keepReadingPlace(() => { library.pageWidth = value; applyPageWidth(); });
  writeLibrary(library);
}

function applyPaged() {
  fitSpread();
  if (window.neo.pagesState) window.neo.pagesState({ paged: pagedEnabled, twoUp: twoPageEnabled }); // the Format menu's ticks
  queuePages(true);
}

// the width of a page at 100%, as styles.css has it (it follows the window)
function pageWidthPx() {
  let probe = $('#pg-probe');
  if (!probe) {
    probe = document.createElement('div');
    probe.id = 'pg-probe';
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;height:0;width:var(--page-w)';
    document.body.appendChild(probe);
  }
  return probe.offsetWidth;
}

// The pages are shown for a book (not a script) when the writer has them on,
// and two to a row once two fit the window at this zoom
function fitSpread() {
  document.body.classList.toggle('paged', pagesOn());
  let two = false;
  if (pagesOn() && twoPageEnabled) {
    const view = $('#editor-view');
    const room = view.hidden ? 0 : view.clientWidth * 0.94;
    two = (2 * pageWidthPx() + PAGES_GAP) * activePageZoom() + 24 <= room;
  }
  document.body.classList.toggle('pages-two', two);
}

function queuePages(all, sec) {
  if (all) pagesDirty.add('*');
  else if (sec) pagesDirty.add(sec);
  if (pagesQueued) return;
  pagesQueued = true;
  requestAnimationFrame(() => { pagesQueued = false; fitPages(); });
}

// A chapter's last page is cut short where its words end, and a page the
// words don't fill should still be a page: tell each chapter how many it
// runs to (the pieces its text is in), and styles.css sets its height to that.
function fitPages() {
  const all = pagesDirty.has('*');
  const todo = all ? $$('#chapters .chapter') : [...pagesDirty];
  pagesDirty.clear();
  if (!document.body.classList.contains('paged')) return;
  for (const sec of todo) {
    if (!sec.isConnected) continue;
    const text = sec.querySelector('.chapter-body:not([hidden])') || sec.querySelector('.toc-list');
    const n = text ? Math.max(1, text.getClientRects().length) : 1;
    if (sec.dataset.pg !== String(n)) {
      sec.dataset.pg = n;
      sec.style.setProperty('--pg-n', n);
    }
  }
}
new MutationObserver((records) => {
  if (!document.body.classList.contains('paged')) return;
  for (const r of records) {
    const el = r.target.nodeType === Node.ELEMENT_NODE ? r.target : r.target.parentElement;
    const sec = el && el.closest ? el.closest('.chapter') : null;
    if (sec) queuePages(false, sec); else queuePages(true);
  }
}).observe($('#chapters'), { childList: true, characterData: true, subtree: true });
new ResizeObserver(() => { fitSpread(); queuePages(true); }).observe($('#editor-view'));
window.addEventListener('resize', () => { fitSpread(); queuePages(true); });
if (document.fonts) document.fonts.addEventListener('loadingdone', () => queuePages(true));

function togglePaged() {
  pagedEnabled = !pagedEnabled;
  library.pagedView = pagedEnabled;
  writeLibrary(library);
  keepReadingPlace(() => { applyPageZoom(); applyPaged(); });
}
function toggleTwoPage() {
  if (!pagedEnabled) return; // greyed out in the menu until the pages are shown
  twoPageEnabled = !twoPageEnabled;
  library.twoPageView = twoPageEnabled;
  writeLibrary(library);
  keepReadingPlace(() => applyPaged());
  if (twoPageEnabled && !document.body.classList.contains('pages-two')) toast(t('Zoom out until two pages fit side by side'));
}

function cardZoom() { return readStoredZoom(CARD_ZOOM_KEY, library.cardZoom || 1, CARD_ZOOM_RANGE); }

// The shelf has a size of its own (#336): bigger covers without the page's
// type growing. ⌘+ and ⌘− (Ctrl), a pinch or Ctrl-scroll, and ⌘0 on the
// shelf, in steps of a tenth, kept on this device.
const SHELF_ZOOM_KEY = 'neo.shelfZoom';
const SHELF_ZOOM_RANGE = { min: 0.8, max: 2 };
const shelfZoom = () => readStoredZoom(SHELF_ZOOM_KEY, 1, SHELF_ZOOM_RANGE);
const shelfShowing = () => !$('#bookshelf-view').hidden;
function applyShelfZoom() {
  const z = shelfZoom();
  document.documentElement.style.setProperty('--shelf-zoom', z);
}
function stepShelfZoom(dir) {
  const now = shelfZoom();
  const next = dir === 0 ? 1 : Math.min(SHELF_ZOOM_RANGE.max, Math.max(SHELF_ZOOM_RANGE.min, Math.round((now + dir * 0.1) * 10) / 10));
  if (next === now) return;
  rememberZoom(SHELF_ZOOM_KEY, next);
  applyShelfZoom();
}
// a page zoom moves in tenths, so it reads 110%, 120%, never 121%
const tenth = (z) => Math.round(z * 10) / 10;
const CARD_ZOOMS = [0.55, 0.7, 0.85, 1, 1.15, 1.3, 1.5];
function stepCardZoom(dir) {
  const now = cardZoom();
  let next = now;
  if (dir === 0) next = 1;
  else if (dir > 0) next = CARD_ZOOMS.find((z) => z > now + 0.001) || now;
  else next = [...CARD_ZOOMS].reverse().find((z) => z < now - 0.001) || now;
  if (next === now) return;
  rememberZoom(CARD_ZOOM_KEY, next);
  renderBoard();
  updateZoomDisplay();
}

// ---- the board ----

function outlineBoard() {
  let board = $('#outline-board');
  if (board) return board;
  board = document.createElement('div');
  board.id = 'outline-board';
  board.hidden = true;
  board.setAttribute('role', 'list');
  board.setAttribute('aria-label', t('Outline cards'));
  $('#outline-list').after(board);
  board.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.ob-cell');
    if (!cell || e.button !== 0 || cell.classList.contains('open')) return;
    if (e.target.closest('button')) return;
    cardPress(e, { kind: cell.dataset.kind, cell });
  });
  // a sweep starts anywhere on the outline page that isn't a card or a control
  $('#paper-scroll').addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.pointerType !== 'mouse' || !boardShowing()) return;
    if (e.target.closest('.ob-cell, button, a, input, textarea, select, [contenteditable="true"], .ob-add, #outline-list')) return;
    cardLasso(e);
  });
  board.addEventListener('contextmenu', (e) => {
    const cell = e.target.closest('.ob-cell');
    if (!cell || cell.classList.contains('open')) return;
    e.preventDefault();
    if (NO_HOVER) return; // a long press is the menu there (cardPress)
    cardMenu(cell, e.clientX, e.clientY);
  });
  board.addEventListener('keydown', (e) => {
    const cell = e.target.closest && e.target.closest('.ob-cell');
    if (!cell || cell.classList.contains('open')) return;
    if (e.key === 'Enter' && e.altKey) { e.preventDefault(); newCardAfter(cell); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCard(cell); }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); cardMenu(cell, 0, 0); }
    else if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      const cells = [...board.querySelectorAll('.ob-cell')];
      const i = cells.indexOf(cell);
      let next = null;
      if (e.key === 'ArrowRight') next = cells[i + 1];
      else if (e.key === 'ArrowLeft') next = cells[i - 1];
      else {
        // the card above or below: the nearest one in the next line
        const r = cell.getBoundingClientRect();
        const down = e.key === 'ArrowDown';
        let best = Infinity;
        for (const c of cells) {
          const q = c.getBoundingClientRect();
          if (down ? q.top <= r.top + 4 : q.top >= r.top - 4) continue;
          const d = Math.abs(q.top - r.top) * 4 + Math.abs(q.left - r.left);
          if (d < best) { best = d; next = c; }
        }
      }
      if (next) { next.focus(); next.scrollIntoView({ block: 'nearest' }); }
    }
  });
  return board;
}

function viewSwitch() {
  let sw = $('#outline-views');
  if (sw) return sw;
  sw = document.createElement('div');
  sw.id = 'outline-views';
  sw.setAttribute('role', 'group');
  sw.setAttribute('aria-label', t('Outline view'));
  for (const [value, label] of [['list', t('List')], ['cards', t('Cards')]]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.view = value;
    b.textContent = label;
    b.onclick = () => {
      if ((library.outlineView || 'cards') === value) return;
      closeCardEditor();
      library.outlineView = value;
      writeLibrary(library);
      renderOutline();
    };
    sw.appendChild(b);
  }
  $('#aux-title').after(sw);
  return sw;
}

// called by renderOutline: shows the list or the board
function showOutlineView() {
  const sw = viewSwitch();
  const cards = outlineCardsOn();
  sw.hidden = !book || isScript() || !featureOn('cards'); // a script has only the cards
  for (const b of sw.querySelectorAll('button')) {
    const on = b.dataset.view === (cards ? 'cards' : 'list');
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  $('#outline-list').hidden = cards;
  outlineBoard().hidden = !cards;
  $('#editor-view').classList.toggle('board-on', cards);
  updateZoomDisplay();
  return cards;
}

function renderBoard() {
  const board = outlineBoard();
  if (!book) return;
  requestAnimationFrame(showCardSelection);
  closeCardEditor(true);
  board.innerHTML = '';
  const z = cardZoom();
  board.style.setProperty('--cz', z);
  board.classList.toggle('tiles', z < 0.8);
  board.classList.remove('script-board');
  if (isScript()) { renderScriptBoard(board); boardAddCard(board); boardHint(board); return; }
  const solo = soloStory();
  for (const chId of book.chapterOrder) {
    const kind = chapterKind(chId);
    if (kind === 'part') { board.appendChild(boardPartRow(chId)); continue; }
    if (!STORY_KINDS.includes(kind)) continue;
    const segs = chapterSegments(chId);
    const opening = segs[0] && !segs[0].id ? segs[0] : null;
    const run = [chapterCard(chId, opening, solo === chId)];
    let letter = 0;
    segs.forEach((seg, i) => {
      if (seg === opening) return;
      run.push(sectionCard(chId, seg, i, letter++));
    });
    // notes the page doesn't hold yet (written but emptied, or just made)
    const onPage = new Set(segs.map((s) => s.id).filter(Boolean));
    for (const sec of (book.sectionNotes || {})[chId] || []) {
      if (onPage.has(sec.id)) continue;
      run.push(sectionCard(chId, { id: sec.id, ps: [], words: 0, first: '', flag: false, virtual: true }, -1, letter++));
    }
    run.forEach((cell, i) => {
      if (i === 0) cell.classList.add('first');
      if (i === run.length - 1) cell.classList.add('last');
      board.appendChild(cell);
    });
  }
  boardAddCard(board);
  boardHint(board);
}

function boardHint(board) {
  let hint = $('#outline-board-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'outline-board-hint';
    hint.className = 'ol-hint';
    board.after(hint);
  }
  hint.hidden = false;
  hint.textContent = NO_HOVER
    ? t('Tap a card to write on it · hold a card to move it · hold and let go for more · + adds a card')
    : isScript()
      ? t('Click a card to write on it · drag it to move the scene · right-click for more · + adds a scene')
      : t('Click a card to write on it · drag it to move it, writing and all · right-click for more · + adds a card');
}

function boardPartRow(chId) {
  const row = document.createElement('div');
  row.className = 'ob-part';
  row.setAttribute('role', 'heading');
  row.setAttribute('aria-level', '3');
  const title = partTitleOf(chId);
  const label = document.createElement('span');
  label.textContent = chapterName(chId) + (title ? ' · ' + title : '');
  const rule = document.createElement('span');
  rule.className = 'ob-rule';
  row.append(label, rule);
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); chapterMenu(chId, e.clientX, e.clientY, row); });
  return row;
}

function cardCell(kind, chId) {
  const cell = document.createElement('div');
  cell.className = 'ob-cell';
  cell.dataset.kind = kind;
  cell.dataset.ch = chId;
  cell.tabIndex = 0;
  cell.setAttribute('role', 'listitem');
  const card = document.createElement('div');
  card.className = 'ob-card ob-' + kind;
  cell.appendChild(card);
  if (kind !== 'loose') {
    // a + on the seam after the card: a new card right there
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'ob-plus';
    plus.textContent = '+';
    plus.title = kind === 'scene' ? t('New scene after this one') : t('New card after this one');
    plus.setAttribute('aria-label', plus.title);
    plus.tabIndex = -1; // the keyboard has ⌥Enter
    plus.addEventListener('click', (e) => { e.stopPropagation(); if (!cell.dataset.new) newCardAfter(cell); });
    cell.appendChild(plus);
  }
  return { cell, card };
}

// the last place on the board: a new chapter (or scene) at the end
function boardAddCard(board) {
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'ob-add';
  const script = isScript();
  add.textContent = script ? t('+ Scene') : t('+ Chapter');
  add.addEventListener('click', () => {
    if (script) {
      const cells = [...board.querySelectorAll('.ob-cell[data-kind="scene"]')];
      const last = cells[cells.length - 1];
      if (last) { newCardAfter(last); return; }
      const fresh = sceneCard({ k: -1, s: { p: null }, id: null, slug: '', eighths: 0, cast: [], first: '' });
      fresh.dataset.new = '1';
      fresh.dataset.after = '-1';
      add.before(fresh);
      openCard(fresh, { fresh: true });
      return;
    }
    newChapterCard(storyEnd());
  });
  board.appendChild(add);
}

const cardWords = (n) => (n ? t('{n} words', { n: n.toLocaleString() }) : '');
const quoted = (s) => '“' + (s.length > 220 ? s.slice(0, 220).trim() + '…' : s) + '”';

function chapterCard(chId, opening, solo) {
  const { cell, card } = cardCell('chapter', chId);
  const kind = chapterKind(chId);
  const head = document.createElement('div');
  head.className = 'ob-head';
  const mark = document.createElement('span');
  mark.className = 'ob-mark';
  if (solo) { mark.textContent = t('The story'); mark.classList.add('ob-word'); }
  else if (kind === 'chapter') mark.textContent = String(chapterNumber(chId));
  else { mark.textContent = chapterName(chId); mark.classList.add('ob-word'); }
  const words = document.createElement('span');
  words.className = 'ob-words';
  const n = countWords(chapterText(chId));
  words.textContent = cardWords(n);
  head.append(mark, words);
  if (chapterHasFlag(chId)) head.appendChild(cardFlag());
  const text = document.createElement('div');
  text.className = 'ob-text';
  card.append(head, text);
  cell.dataset.excerpt = opening && opening.first ? quoted(opening.first) : '';
  fillCardText(cell, (book.chapterNotes || {})[chId] || '');
  cell.setAttribute('aria-label', (solo ? t('The story') : chapterName(chId)) + '. ' + text.textContent);
  return cell;
}

function sectionCard(chId, seg, segIdx, letterIdx) {
  const { cell, card } = cardCell('section', chId);
  cell.dataset.seg = String(segIdx);
  if (seg.id) cell.dataset.sec = seg.id;
  if (seg.virtual) cell.dataset.virtual = '1';
  const note = seg.id ? sectionNote(chId, seg.id) : null;
  const head = document.createElement('div');
  head.className = 'ob-head';
  const letter = document.createElement('span');
  letter.className = 'ob-letter';
  letter.textContent = secLetter(letterIdx);
  head.appendChild(letter);
  if (seg.flag) head.appendChild(cardFlag());
  const text = document.createElement('div');
  text.className = 'ob-text';
  const foot = document.createElement('div');
  foot.className = 'ob-foot';
  foot.textContent = seg.words ? cardWords(seg.words) : t('not written yet');
  card.append(head, text, foot);
  card.classList.toggle('unwritten', !seg.words);
  cell.dataset.written = seg.words ? '1' : '';
  cell.dataset.excerpt = seg.first ? quoted(seg.first) : '';
  fillCardText(cell, note ? note.text : '');
  cell.setAttribute('aria-label', t('Section {letter}', { letter: letter.textContent }) + '. ' + text.textContent + '. ' + foot.textContent);
  return cell;
}

// a card shows its note; with none, the section's first line, in quotes
function fillCardText(cell, note) {
  const text = cell.querySelector('.ob-text');
  text.classList.remove('excerpt', 'empty');
  if (note) text.textContent = note;
  else if (cell.dataset.excerpt) { text.textContent = cell.dataset.excerpt; text.classList.add('excerpt'); }
  else {
    text.textContent = cell.dataset.kind === 'chapter' ? t('What happens in this chapter…') : cell.dataset.kind === 'scene' ? t('What happens in this scene…') : t('What happens in this section…');
    text.classList.add('empty');
  }
}

function cardFlag() {
  const f = document.createElement('span');
  f.className = 'ob-flag';
  f.title = t('Unresolved placeholder');
  return f;
}
function chapterHasFlag(chId) {
  const body = chapterBodyEl(chId);
  return !!(body && body.querySelector('.ph-mark'));
}

// ---- writing on a card ----

let cardEditor = null; // { cell, text, before }

function openCard(cell, { fresh = false } = {}) {
  closeCardEditor();
  const text = cell.querySelector('.ob-text');
  const note = cardNoteOf(cell);
  cell.classList.add('open');
  // a card near the right edge opens toward the left
  const board = outlineBoard();
  const r = cell.getBoundingClientRect();
  const b = board.getBoundingClientRect();
  cell.classList.toggle('open-left', r.left + r.width * 2 > b.right + 4);
  text.classList.remove('excerpt', 'empty');
  text.textContent = note;
  // the page's own first line stays in view above the note, so opening a
  // card never looks like it wiped what was on it
  if (cell.dataset.excerpt && cell.dataset.kind !== 'loose') {
    const from = document.createElement('div');
    from.className = 'ob-from';
    from.textContent = cell.dataset.excerpt;
    text.before(from);
    text.dataset.ph = t('Write a note…');
  } else {
    text.dataset.ph = cell.dataset.kind === 'chapter' ? t('What happens in this chapter…') : cell.dataset.kind === 'scene' ? t('What happens in this scene…') : cell.dataset.kind === 'loose' ? t('Write a note…') : t('What happens in this section…');
  }
  text.contentEditable = 'true';
  text.spellcheck = false;
  text.setAttribute('role', 'textbox');
  // a scene's heading can be set right on its card
  const slug = cell.querySelector('.ob-slug');
  if (slug) {
    slug.contentEditable = 'true';
    slug.spellcheck = false;
    slug.setAttribute('role', 'textbox');
    slug.addEventListener('keydown', slugKeys);
    if (!slug.textContent.trim()) slug.textContent = '';
  }
  // the way to the page, and what Enter does
  const tools = document.createElement('div');
  tools.className = 'ob-tools';
  if (!cell.dataset.new && !cell.dataset.virtual) {
    const go = document.createElement('button');
    go.className = 'ob-go';
    go.type = 'button';
    go.textContent = t('Go to the page');
    go.addEventListener('mousedown', (e) => e.preventDefault()); // keep the note's focus until we leave
    go.onclick = () => { const c = cardEditor && cardEditor.cell; closeCardEditor(); if (c) goToCard(c); };
    tools.appendChild(go);
  }
  if (cell.dataset.kind !== 'loose') {
    const more = document.createElement('button');
    more.type = 'button';
    more.textContent = cell.dataset.kind === 'scene' ? t('New scene') : t('New card');
    more.addEventListener('mousedown', (e) => e.preventDefault());
    more.onclick = () => { const c = cardEditor && cardEditor.cell; if (c) newCardAfter(c); };
    tools.appendChild(more);
  }
  const tip = document.createElement('span');
  tip.textContent = fresh && cell.dataset.kind !== 'loose'
    ? t('Enter: another new card · Enter on an empty card, or Esc: done')
    : t('Enter: done · Tab: next card · {key}: new card', { key: K('⌥Enter', 'Alt+Enter') });
  tools.appendChild(tip);
  cell.querySelector('.ob-card').appendChild(tools);
  cardEditor = { cell, text, slug, before: note, slugBefore: slug ? slug.textContent : null, fresh };
  text.addEventListener('keydown', cardKeys);
  text.addEventListener('blur', cardBlur);
  text.addEventListener('paste', (e) => {
    e.preventDefault();
    const raw = e.clipboardData.getData('text/plain') || '';
    const items = pastedOutline(e.clipboardData);
    // a list (from Word, Obsidian, a notes app): one card per line (#348)
    if (items.length > 1) { pasteOutline(items); return; }
    document.execCommand('insertText', false, raw.replace(/\s+/g, ' '));
  });
  const first = slug && fresh ? slug : text;
  first.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(first);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  cell.scrollIntoView({ block: 'nearest' });
}

function cardNoteOf(cell) {
  if (cell.dataset.new) return '';
  const chId = cell.dataset.ch;
  if (cell.dataset.kind === 'chapter') return (book.chapterNotes || {})[chId] || '';
  if (cell.dataset.kind === 'loose') return (book.looseCards || []).find((c) => c.id === cell.dataset.loose)?.text || '';
  if (cell.dataset.kind === 'scene') return (cell.dataset.sid && (book.sceneNotes || {})[cell.dataset.sid]) || '';
  const note = cell.dataset.sec ? sectionNote(chId, cell.dataset.sec) : null;
  return note ? note.text : '';
}

function cardBlur() {
  // the window losing focus isn't the writer leaving the card
  setTimeout(() => {
    if (!cardEditor || !document.hasFocus()) return;
    if (cardEditor.cell.contains(document.activeElement) && document.activeElement.isContentEditable) return;
    closeCardEditor();
  }, 0);
}

// save what's on the open card and put it down
function closeCardEditor(quiet = false) {
  const ed = cardEditor;
  if (!ed) return;
  cardEditor = null;
  const { cell, text, slug } = ed;
  text.removeEventListener('keydown', cardKeys);
  text.removeEventListener('blur', cardBlur);
  text.contentEditable = 'false';
  text.removeAttribute('role');
  cell.classList.remove('open', 'open-left');
  cell.querySelector('.ob-tools')?.remove();
  cell.querySelector('.ob-from')?.remove();
  const val = text.textContent.replace(/\s+/g, ' ').trim();
  if (slug) {
    slug.removeEventListener('keydown', slugKeys);
    slug.removeEventListener('blur', cardBlur);
    slug.contentEditable = 'false';
    slug.removeAttribute('role');
    const sv = slug.textContent.replace(/\s+/g, ' ').trim();
    if (!quiet || val !== ed.before || sv !== ed.slugBefore) saveSceneCard(cell, val, sv);
    if (cell.isConnected && cell.dataset.new) cell.remove();
    else if (cell.isConnected) { fillCardText(cell, val); renderBoardLater(); }
    return;
  }
  if (!quiet || val !== ed.before) saveCard(cell, val);
  if (!cell.isConnected) return;
  if (cell.dataset.new && !val) { cell.remove(); return; }
  if (cell.dataset.kind !== 'loose') fillCardText(cell, cardNoteOf(cell));
}

function saveCard(cell, val) {
  if (!book) return;
  const chId = cell.dataset.ch;
  const kind = cell.dataset.kind;
  if (kind === 'loose') { saveLooseCard(cell.dataset.loose, val); return; }
  if (kind === 'chapter') {
    book.chapterNotes = book.chapterNotes || {};
    if ((book.chapterNotes[chId] || '') === val) return;
    book.chapterNotes[chId] = val;
    scheduleMetaSave();
    scheduleNavRefresh();
    return;
  }
  book.sectionNotes = book.sectionNotes || {};
  const list = book.sectionNotes[chId] = book.sectionNotes[chId] || [];
  if (cell.dataset.new) {
    if (!val) return;
    // a new card: a gray ghost on the page, after the card it came from
    const sec = { id: newSectionId(), text: val };
    const body = chapterBodyEl(chId);
    if (!body) return;
    const segs = chapterSegments(chId);
    const after = Number(cell.dataset.after);
    const next = segs[after + 1];
    list.push(sec);
    placeGhost(body, sec, next ? (next.brk || next.ps[0]) : null);
    orderSectionNotes(chId);
    syncChapter(body, chId);
    scheduleMetaSave();
    delete cell.dataset.new;
    cell.dataset.sec = sec.id;
    reindexChapterCards(chId);
    return;
  }
  if (cell.dataset.sec) {
    const sec = list.find((s) => s.id === cell.dataset.sec);
    if (!sec || sec.text === val) return;
    sec.text = val;
    scheduleMetaSave();
    syncGhosts(chId);
    return;
  }
  if (!val) return;
  // a section written without an outline gets its first note: its first
  // line of prose carries the note's id from now on
  const seg = chapterSegments(chId)[Number(cell.dataset.seg)];
  const anchor = seg && seg.ps.find((p) => !p.classList.contains('ghost'));
  if (!anchor) return;
  const sec = { id: newSectionId(), text: val };
  anchor.dataset.secId = sec.id;
  list.push(sec);
  orderSectionNotes(chId);
  syncChapter(chapterBodyEl(chId), chId);
  scheduleMetaSave();
  cell.dataset.sec = sec.id;
}

// after a card is set on the page, the chapter's cards learn their places
// (and letters) again, without redrawing the board under the writer's hand
function reindexChapterCards(chId) {
  const segs = chapterSegments(chId);
  const placed = segs.filter((sg, i) => !(i === 0 && !sg.id));
  const cells = [...outlineBoard().querySelectorAll(`.ob-cell[data-kind="section"][data-ch="${chId}"]`)];
  let k = 0;
  let letter = 0;
  for (const cell of cells) {
    if (!cell.dataset.new) cell.querySelector('.ob-letter').textContent = secLetter(letter++);
    if (cell.dataset.new || cell.dataset.virtual) continue;
    const seg = placed[k++];
    if (seg) cell.dataset.seg = String(segs.indexOf(seg));
  }
}

function cardKeys(e) {
  const ed = cardEditor;
  if (!ed) return;
  const { cell, text } = ed;
  e.stopPropagation();
  if (e.key === 'Escape') {
    e.preventDefault();
    closeCardEditor();
    if (cell.isConnected) cell.focus();
    return;
  }
  if (e.isComposing || e.keyCode === 229) return;
  // Enter on a new card with words on it: on to another new card, so an
  // outline can be typed straight through; Enter on an empty one stops
  // there (the way a list's empty bullet does), and so does Esc (#334)
  if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && ed.fresh &&
      cell.dataset.kind !== 'loose' && (text.textContent.trim() || (ed.slug && ed.slug.textContent.trim()))) {
    e.preventDefault();
    newCardAfter(cell);
    return;
  }
  // Enter: the card is done (and stays where the keyboard is)
  if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    closeCardEditor();
    if (cell.isConnected) cell.focus();
    else renderBoardFocus(cell);
    return;
  }
  // Tab and ⇧Tab: on to the next card, or back to the one before
  if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    const list = cell.closest('#loose-list') || outlineBoard();
    const cells = [...list.querySelectorAll('.ob-cell')];
    const at = cells.indexOf(cell);
    const ahead = e.shiftKey ? cells.slice(0, at).reverse() : cells.slice(at + 1);
    closeCardEditor();
    const next = ahead.find((c) => c.isConnected);
    if (next) openCard(next);
    else if (cell.isConnected) cell.focus();
    return;
  }
  // ⌥Enter (Alt+Enter): a new card after this one; on an empty new card,
  // a new chapter instead (the manuscript's Enter, Enter)
  if (e.key === 'Enter' && e.altKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    const empty = !text.textContent.trim();
    if (empty && cell.dataset.new && cell.dataset.kind === 'section') {
      const chId = cell.dataset.ch;
      cardEditor = null;
      cell.remove();
      newChapterCard(book.chapterOrder.indexOf(chId) + 1);
      return;
    }
    if (cell.dataset.kind === 'loose') { closeCardEditor(); addLooseCard(); return; }
    newCardAfter(cell);
    return;
  }
  if (e.key === 'Backspace' && !text.textContent) {
    e.preventDefault();
    if (cell.dataset.new) {
      const prev = cell.previousElementSibling;
      cardEditor = null;
      cell.remove();
      if (prev && prev.classList.contains('ob-cell')) openCard(prev);
      return;
    }
    if (cell.dataset.kind === 'loose') { cardEditor = null; removeLooseCard(cell.dataset.loose); return; }
    if (cell.dataset.kind === 'section' && cell.dataset.sec && !cell.dataset.written) {
      const chId = cell.dataset.ch;
      cardEditor = null;
      deleteSectionNote(chId, cell.dataset.sec);
    }
  }
}

// A pasted list, one item a line: bullets (-, *, •), numbers (1. 2)) and
// letters (a.) come off, blank lines go. A line indented more than the
// list's least indented ones is a level down. (#348)
// A list as plain text, one item a line. Its marks go: bullets (Word's
// second and third levels arrive as "o" and "§" before a tab), numbers and
// letters, Markdown's headings and checkboxes (Obsidian). An item indented
// past the least indented, or under one of Word's deeper bullets, is a level
// down.
function outlineLines(raw) {
  const items = [];
  for (const line of String(raw).replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^([ \t]*)(?:([-*+•◦▪‣·–—])\s+|([o§])\t+|\d{1,3}[.)]\s+|[a-zA-Z][.)]\s+|#{1,6}\s+)?(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
    const words = (m ? m[4] : line).replace(/\s+/g, ' ').trim();
    if (!words) continue;
    const deep = !!m && (!!m[3] || /^[◦▪]$/.test(m[2] || ''));
    items.push({ indent: (m ? m[1] : '').replace(/\t/g, '    ').length + (deep ? 1000 : 0), text: words });
  }
  return outlineLevels(items);
}
function outlineLevels(items) {
  const least = items.length ? Math.min(...items.map((x) => x.indent)) : 0;
  for (const x of items) x.level = x.indent > least ? 1 : 0;
  return items;
}
// The same list from the HTML a word processor or a web page puts on the
// clipboard beside the text, where the levels are real: nested <ul>/<ol>, or
// Word's own list paragraphs (mso-list … level2). Fewer than two items: none.
function outlineFromHtml(html) {
  if (!html || !/<li[\s>]|mso-list/i.test(html)) return [];
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const root = tpl.content;
  const items = [];
  const lis = [...root.querySelectorAll('li')];
  if (lis.length) {
    for (const li of lis) {
      const copy = li.cloneNode(true);
      copy.querySelectorAll('ul, ol').forEach((x) => x.remove());
      const text = copy.textContent.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      let depth = 0;
      for (let a = li.parentElement; a; a = a.parentElement) if (a.tagName === 'UL' || a.tagName === 'OL') depth++;
      items.push({ indent: depth, text });
    }
  } else {
    for (const p of root.querySelectorAll('p')) {
      const m = /mso-list:\s*\S+\s+level(\d+)/i.exec(p.getAttribute('style') || '');
      const copy = p.cloneNode(true);
      copy.querySelectorAll('[style*="mso-list:Ignore" i], [style*="mso-list: Ignore" i]').forEach((x) => x.remove());
      const text = copy.textContent.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      items.push({ indent: m ? +m[1] : 0, text });
    }
  }
  return items.length > 1 ? outlineLevels(items) : [];
}
// what was pasted, as a list: the HTML's levels when it has them, else the text's
function pastedOutline(data) {
  const fromHtml = outlineFromHtml(data.getData('text/html'));
  return fromHtml.length > 1 ? fromHtml : outlineLines(data.getData('text/plain') || '');
}

// The list's first line goes on the open card, and each line after it on a
// new card of its own, as if typed with Enter. On a chapter card the top
// lines are chapters and the indented ones their sections; on a section,
// scene or loose card, every line is another of the same.
function pasteOutline(items) {
  const ed = cardEditor;
  if (!ed) return;
  const kind = ed.cell.dataset.kind;
  document.execCommand('insertText', false, items[0].text);
  for (const it of items.slice(1)) {
    const cur = cardEditor && cardEditor.cell;
    if (!cur || !cur.isConnected) break;
    if (kind === 'loose') { closeCardEditor(); addLooseCard(); }
    else if (kind === 'chapter' && it.level === 0) {
      const chId = cur.dataset.ch;
      closeCardEditor();
      newChapterCard(book.chapterOrder.indexOf(chId) + 1);
    } else newCardAfter(cur);
    const next = cardEditor;
    if (!next || next.cell === cur) break;
    next.text.focus();
    next.text.textContent = it.text;
    const r = document.createRange();
    r.selectNodeContents(next.text);
    r.collapse(false);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(r);
  }
}

// a new card after this one, open to write on
function newCardAfter(cell) {
  closeCardEditor();
  if (!cell.isConnected) return;
  const fresh = makeNewCardAfter(cell, cell.dataset.ch);
  if (fresh) openCard(fresh, { fresh: true });
}

// a new chapter at this place in the book, its card open to write on
function newChapterCard(at) {
  closeCardEditor();
  snapshotStructure('card new chapter');
  const newId = createChapterAt(at);
  updateCounters();
  renderBoard();
  const nc = outlineBoard().querySelector(`.ob-cell[data-kind="chapter"][data-ch="${newId}"]`);
  if (nc) openCard(nc, { fresh: true });
}

// after a redraw, the keyboard goes back to the card it was on
function renderBoardFocus(cell) {
  const sel = cell.dataset.sec ? `.ob-cell[data-sec="${cell.dataset.sec}"]` : cell.dataset.kind === 'chapter' ? `.ob-cell[data-kind="chapter"][data-ch="${cell.dataset.ch}"]` : null;
  setTimeout(() => { const c = sel && outlineBoard().querySelector(sel); if (c) c.focus(); }, 150);
}

// in a scene's heading: Enter or Tab moves on to the note
function slugKeys(e) {
  e.stopPropagation();
  if (e.key === 'Escape') { e.preventDefault(); const c = cardEditor && cardEditor.cell; closeCardEditor(); if (c && c.isConnected) c.focus(); return; }
  if ((e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) || (e.key === 'Tab' && !e.shiftKey)) {
    e.preventDefault();
    const text = cardEditor && cardEditor.text;
    if (!text) return;
    text.focus();
    const r = document.createRange();
    r.selectNodeContents(text);
    r.collapse(false);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(r);
  }
}

// once a scene card is put down, the board takes in what changed
let boardLater = null;
function renderBoardLater() {
  clearTimeout(boardLater);
  boardLater = setTimeout(() => {
    if (!cardEditor && !cardDrag && currentTab === 'outline' && boardShowing()) renderBoard();
  }, 120);
}

// a blank card right after this one, in its chapter
function makeNewCardAfter(cell, chId) {
  if (!cell.isConnected) return null;
  if (cell.dataset.kind === 'scene') {
    const fresh = sceneCard({ k: -1, s: { p: null }, id: null, slug: '', eighths: 0, cast: [], first: '' });
    fresh.dataset.new = '1';
    fresh.dataset.after = cell.dataset.scene;
    fresh.querySelector('.ob-letter').textContent = '+';
    cell.after(fresh);
    return fresh;
  }
  const segs = chapterSegments(chId);
  let after;
  if (cell.dataset.kind === 'chapter') after = segs[0] && !segs[0].id ? 0 : -1;
  else if (cell.dataset.virtual || Number(cell.dataset.seg) < 0) after = segs.length - 1;
  else after = Number(cell.dataset.seg);
  const fresh = sectionCard(chId, { id: null, ps: [], words: 0, first: '', flag: false }, -1, 0);
  fresh.dataset.new = '1';
  fresh.dataset.after = String(after);
  fresh.querySelector('.ob-letter').textContent = '+';
  // it joins the chapter's mat
  cell.classList.remove('last');
  fresh.classList.add('last');
  let spot = cell;
  // a chapter card's new card goes before its first section
  if (cell.dataset.kind === 'chapter') spot = cell;
  spot.after(fresh);
  // if it landed mid-chapter, it isn't the end of the mat
  const n = fresh.nextElementSibling;
  if (n && n.classList.contains('ob-cell') && n.dataset.ch === chId) fresh.classList.remove('last');
  return fresh;
}

function deleteSectionNote(chId, secId) {
  snapshotStructure('card removed');
  book.sectionNotes[chId] = (book.sectionNotes[chId] || []).filter((s) => s.id !== secId);
  scheduleMetaSave();
  syncGhosts(chId);
  renderBoard();
}

// the card's place in the manuscript
function goToCard(cell) {
  if (cell.dataset.kind === 'scene') { goToScene(cell); return; }
  const chId = cell.dataset.ch;
  switchTab('manuscript');
  if (cell.dataset.kind === 'chapter') { goToChapterTop(chId); return; }
  goToSegment(chId, chapterSegments(chId)[Number(cell.dataset.seg)]);
}
function goToChapterTop(chId) {
  focusChapterStart(chId);
  document.querySelector(`.chapter[data-id="${chId}"]`)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
}
// the caret at a section's first line (a gray ghost selected, ready to be
// written over), scrolled into view
function goToSegment(chId, seg) {
  const p = seg && seg.ps[0];
  const body = chapterBodyEl(chId);
  if (!p || !body) { focusChapterStart(chId); return; }
  body.focus({ preventScroll: true });
  const r = document.createRange();
  if (p.classList.contains('ghost')) r.selectNodeContents(p); // ready to be written over
  else { r.setStart(p, 0); r.collapse(true); }
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  currentChapterId = chId;
  highlightNav();
  p.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
}

async function cardMenu(cell, x, y) {
  if (cardSel.size > 1 && cardSel.has(cardKey(cell))) {
    const v = await popMenu(x, y, [{ label: t('Delete {n} cards', { n: cardSel.size }), value: 'delete', danger: true }], { from: cell });
    if (v === 'delete') await deleteSelectedCards();
    return;
  }
  const chId = cell.dataset.ch;
  if (cell.dataset.kind === 'chapter') { await chapterMenu(chId, x, y, cell); return; }
  if (cell.dataset.kind === 'loose') {
    const v = await popMenu(x, y, [{ label: t('Delete card'), value: 'delete', danger: true }], { from: cell });
    if (v === 'delete') removeLooseCard(cell.dataset.loose);
    return;
  }
  if (cell.dataset.new) return;
  if (cell.dataset.kind === 'scene') {
    const v = await popMenu(x, y, [
      { label: t('Go to the page'), value: 'go' },
      '-',
      { label: t('Delete the note'), value: 'delete', disabled: !cell.dataset.sid },
      { label: t('Delete scene'), value: 'deleteScene', danger: true }
    ], { from: cell });
    if (v === 'go') goToScene(cell);
    else if (v === 'deleteScene') await deleteSceneToDarlings(cell);
    else if (v === 'delete') {
      snapshotStructure('scene note removed');
      delete book.sceneNotes[cell.dataset.sid];
      scheduleMetaSave();
      renderBoard();
    }
    return;
  }
  const linked = !!cell.dataset.sec;
  const written = !!cell.dataset.written;
  const choice = await popMenu(x, y, [
    { label: t('Go to the page'), value: 'go', disabled: !!cell.dataset.virtual },
    { label: t('Make it a chapter'), value: 'chapter', disabled: !!cell.dataset.virtual },
    { label: t('Move to loose cards'), value: 'loose', disabled: !written && !linked },
    '-',
    { label: t('Delete the note'), value: 'delete', disabled: !linked },
    { label: t('Delete section'), value: 'deleteSection', danger: true, disabled: !!cell.dataset.virtual || (!written && !linked) }
  ], { from: cell });
  if (choice === 'go') goToCard(cell);
  else if (choice === 'chapter') sectionToChapter(chId, Number(cell.dataset.seg));
  else if (choice === 'loose') sectionToLoose(chId, Number(cell.dataset.seg), cell.dataset.virtual ? cell.dataset.sec : null);
  else if (choice === 'delete') {
    deleteSectionNote(chId, cell.dataset.sec);
    if (written) toast(t('The note is gone; the writing stays on the page'));
  } else if (choice === 'deleteSection') await deleteSectionToDarlings(chId, Number(cell.dataset.seg));
}

// A section card's Delete: its writing leaves the manuscript for Darlings
// (saved there before the chapter is), its note goes, and ⌘Z puts it back
async function deleteSectionToDarlings(chId, segIdx, quiet = false) {
  const body = chapterBodyEl(chId);
  const seg = chapterSegments(chId)[segIdx];
  if (!body || !seg) return;
  if (!quiet) snapshotStructure('section delete');
  const prose = seg.ps.filter((p) => !p.classList.contains('ghost'));
  if (seg.words) {
    const holder = document.createElement('div');
    for (const p of prose) holder.appendChild(p.cloneNode(true));
    for (const p of holder.querySelectorAll('[data-sec-id]')) p.removeAttribute('data-sec-id');
    darlings.unshift({
      id: 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      html: captureBody(holder),
      text: prose.map((p) => p.textContent).join('\n').slice(0, 2000),
      chapterId: chId,
      chapterLabel: chapterName(chId),
      date: new Date().toISOString()
    });
    try {
      await writeSidecar(book.id, 'darlings', darlings);
    } catch {
      darlings.shift();
      toast(t('NEO couldn’t save to Darlings, so the section stays where it was'));
      return;
    }
    renderDarlings();
  }
  liftSegment(body, seg);
  if (seg.id) book.sectionNotes[chId] = (book.sectionNotes[chId] || []).filter((s) => s.id !== seg.id);
  orderSectionNotes(chId);
  syncChapter(body, chId);
  clearTimeout(saveTimers[chId]);
  persistChapter(chId).then(() => saveMeta())
    .catch((err) => window.neo.logError('section delete: ' + (err && err.message || err)));
  renderBoard();
  updateCounters();
  if (seg.words && !quiet) toast(t('Section removed — its words are in Darlings, or {key} to undo', { key: KZ }));
}

// ---- moving cards ----

// lift a section out of its chapter: its *** and its lines
function liftSegment(body, seg) {
  if (seg.brk) seg.brk.remove();
  for (const p of seg.ps) p.remove();
  // the chapter's first section left: the next one's *** would open the chapter
  if (!seg.brk) {
    const f = body.firstElementChild;
    if (f && f.classList.contains('scene-break')) f.remove();
  }
  if (!body.firstElementChild) body.innerHTML = '<p><br></p>';
}

// set lines down in a chapter, before a section (or at the end)
function setSegmentDown(body, ps, brk, target) {
  const blank = !body.innerText.trim() && !body.querySelector('.scene-break, .ghost, .ph-mark');
  if (!target && blank) {
    body.innerHTML = '';
    for (const p of ps) body.appendChild(p);
    return;
  }
  const tBrk = target && target.brk && target.brk.isConnected ? target.brk : null;
  const tFirst = target && target.ps.find((p) => p.isConnected);
  if (tBrk) {
    body.insertBefore(brk || newSceneBreak(), tBrk);
    for (const p of ps) body.insertBefore(p, tBrk);
    return;
  }
  if (tFirst) {
    // ahead of the chapter's first section
    for (const p of ps) body.insertBefore(p, tFirst);
    body.insertBefore(brk || newSceneBreak(), tFirst);
    return;
  }
  if (!(body.lastElementChild && body.lastElementChild.classList.contains('scene-break'))) body.appendChild(brk || newSceneBreak());
  for (const p of ps) body.appendChild(p);
}

// placeholders keep their sticky notes pointed at the chapter they're in
function repointStickies(ps, chId) {
  let changed = false;
  for (const p of ps) {
    for (const m of p.querySelectorAll ? p.querySelectorAll('.ph-mark') : []) {
      const s = stickies.find((x) => x.id === m.dataset.sid);
      if (s && s.chapterId !== chId) { s.chapterId = chId; changed = true; }
    }
  }
  if (changed) { writeSidecar(book.id, 'stickies', stickies); renderStickies(); }
}

// to = { ch, before }: before is a section's index in that chapter, or null for the end
function moveSection(fromCh, segIdx, to) {
  const fromBody = chapterBodyEl(fromCh);
  const toBody = chapterBodyEl(to.ch);
  if (!fromBody || !toBody) return;
  const fromSegs = chapterSegments(fromCh);
  const seg = fromSegs[segIdx];
  if (!seg) return;
  const toSegs = fromCh === to.ch ? fromSegs : chapterSegments(to.ch);
  const target = to.before == null ? null : toSegs[to.before] || null;
  if (target === seg) return;
  if (fromCh === to.ch && (to.before === segIdx + 1 || (to.before == null && segIdx === fromSegs.length - 1))) return;
  snapshotStructure('card moved');
  const settle = holdDay();
  liftSegment(fromBody, seg);
  setSegmentDown(toBody, seg.ps, seg.brk, target);
  if (seg.id && fromCh !== to.ch) {
    const from = book.sectionNotes[fromCh] || [];
    const note = from.find((s) => s.id === seg.id);
    book.sectionNotes[fromCh] = from.filter((s) => s.id !== seg.id);
    if (note) (book.sectionNotes[to.ch] = book.sectionNotes[to.ch] || []).push(note);
  }
  orderSectionNotes(fromCh);
  if (fromCh !== to.ch) orderSectionNotes(to.ch);
  syncChapter(fromBody, fromCh);
  if (fromCh !== to.ch) {
    syncChapter(toBody, to.ch);
    // the chapter it lands in is saved before the one it left, so a save
    // that fails never leaves the section in neither
    clearTimeout(saveTimers[fromCh]);
    clearTimeout(saveTimers[to.ch]);
    persistChapter(to.ch).then(() => persistChapter(fromCh))
      .catch((err) => window.neo.logError('move section: ' + (err && err.message || err)));
  }
  repointStickies(seg.ps, to.ch);
  scheduleMetaSave();
  updateCounters();
  settle();
}

function moveChapterCard(chId, index) {
  const from = book.chapterOrder.indexOf(chId);
  if (from === -1 || index === from || index === from + 1) return;
  snapshotStructure('chapter reorder');
  const order = book.chapterOrder.filter((c) => c !== chId);
  order.splice(index > from ? index - 1 : index, 0, chId);
  book.chapterOrder = order;
  saveMeta();
  renderChapters();
}

// a section on its own becomes the next chapter: its writing, and its note
// as the chapter's
function sectionToChapter(chId, segIdx) {
  const body = chapterBodyEl(chId);
  const seg = chapterSegments(chId)[segIdx];
  if (!body || !seg) return;
  snapshotStructure('card to chapter');
  const settle = holdDay();
  liftSegment(body, seg);
  syncChapter(body, chId);
  const note = seg.id ? sectionNote(chId, seg.id) : null;
  if (seg.id) book.sectionNotes[chId] = book.sectionNotes[chId].filter((s) => s.id !== seg.id);
  const prose = seg.ps.filter((p) => !p.classList.contains('ghost'));
  for (const p of prose) delete p.dataset.secId;
  const html = prose.length ? prose.map((p) => p.outerHTML).join('') : '<p><br></p>';
  const newId = newEntryId();
  book.chapterOrder.splice(book.chapterOrder.indexOf(chId) + 1, 0, newId);
  chapterHTML[newId] = html;
  book.chapterNotes = book.chapterNotes || {};
  if (note && note.text) book.chapterNotes[newId] = note.text;
  for (const s of stickies) if (prose.some((p) => p.querySelector(`.ph-mark[data-sid="${s.id}"]`))) s.chapterId = newId;
  writeSidecar(book.id, 'stickies', stickies);
  // the new chapter's file, then book.json naming it, and only then the
  // chapter it came out of: a failed save never leaves the words nowhere
  clearTimeout(saveTimers[chId]);
  persistChapter(newId, html).then(() => saveMeta()).then(() => persistChapter(chId))
    .catch((err) => window.neo.logError('section to chapter: ' + (err && err.message || err)));
  renderChapters();
  renderStickies();
  updateCounters();
  settle();
  if (currentTab === 'outline') renderOutline();
}

// A card set aside for later. A note alone becomes a loose card; a section
// with writing takes its words along on the card (book.looseCards keeps them
// as html), out of the manuscript and the counts until it's dragged back.
function sectionToLoose(chId, segIdx, virtualSec) {
  if (virtualSec) {
    const note = sectionNote(chId, virtualSec);
    if (!note) return;
    snapshotStructure('card to loose');
    book.sectionNotes[chId] = book.sectionNotes[chId].filter((s) => s.id !== virtualSec);
    (book.looseCards = book.looseCards || []).push({ id: 'lc-' + Date.now().toString(36), text: note.text });
    scheduleMetaSave();
    renderLooseCards();
    renderBoard();
    return;
  }
  const seg = chapterSegments(chId)[segIdx];
  if (!seg) return;
  if (seg.words) { writtenSectionToLoose(chId, seg); return; }
  const note = seg.id ? sectionNote(chId, seg.id) : null;
  if (!note) return;
  snapshotStructure('card to loose');
  book.sectionNotes[chId] = book.sectionNotes[chId].filter((s) => s.id !== seg.id);
  (book.looseCards = book.looseCards || []).push({ id: 'lc-' + Date.now().toString(36), text: note.text });
  scheduleMetaSave();
  syncGhosts(chId);
  renderLooseCards();
  renderBoard();
}

async function writtenSectionToLoose(chId, seg) {
  if (seg.flag) { toast(t('That section has a placeholder in it. Drag it to another chapter instead.')); return; }
  const body = chapterBodyEl(chId);
  if (!body) return;
  snapshotStructure('card to loose');
  const note = seg.id ? sectionNote(chId, seg.id) : null;
  const holder = document.createElement('div');
  for (const p of seg.ps) if (!p.classList.contains('ghost')) holder.appendChild(p.cloneNode(true));
  for (const p of holder.querySelectorAll('[data-sec-id]')) p.removeAttribute('data-sec-id');
  const card = { id: 'lc-' + Date.now().toString(36), text: note ? note.text : '', html: captureBody(holder), words: seg.words };
  (book.looseCards = book.looseCards || []).push(card);
  // the card that holds the words is on disk before the chapter loses them
  let stamp = null;
  try { stamp = await writeBookMeta(book.id, book); } catch (err) { window.neo.logError('section to loose: ' + (err && err.message || err)); }
  if (typeof stamp !== 'string') {
    book.looseCards = book.looseCards.filter((c) => c !== card);
    toast(t('NEO couldn’t save the card, so the section stays where it was'));
    return;
  }
  book.modified = stamp;
  liftSegment(body, seg);
  if (seg.id) book.sectionNotes[chId] = book.sectionNotes[chId].filter((s) => s.id !== seg.id);
  orderSectionNotes(chId);
  syncChapter(body, chId);
  clearTimeout(saveTimers[chId]);
  saveMeta().then(() => persistChapter(chId))
    .catch((err) => window.neo.logError('section to loose: ' + (err && err.message || err)));
  renderLooseCards();
  renderBoard();
  updateCounters();
  toast(t('Its words went with it, onto the loose card. Drag it back onto the board to put them in again.'), 6000);
}

function looseToSection(looseId, to) {
  const card = (book.looseCards || []).find((c) => c.id === looseId);
  const body = chapterBodyEl(to.ch);
  if (!card || !body) return;
  snapshotStructure('loose card placed');
  book.looseCards = book.looseCards.filter((c) => c.id !== looseId);
  const sec = { id: newSectionId(), text: card.text };
  const target = to.before == null ? null : chapterSegments(to.ch)[to.before];
  if (card.html) {
    // a card that holds writing: its words go back in as a section
    const holder = document.createElement('div');
    holder.innerHTML = card.html;
    const ps = [...holder.children];
    if (ps.length) {
      if (sec.text) {
        ps[0].dataset.secId = sec.id;
        (book.sectionNotes[to.ch] = book.sectionNotes[to.ch] || []).push(sec);
      }
      setSegmentDown(body, ps, null, target);
    }
    orderSectionNotes(to.ch);
    syncChapter(body, to.ch);
    // the chapter with the words is saved before the card leaves book.json
    clearTimeout(saveTimers[to.ch]);
    persistChapter(to.ch).then(() => saveMeta())
      .catch((err) => window.neo.logError('loose to section: ' + (err && err.message || err)));
    renderLooseCards();
    updateCounters();
    return;
  }
  (book.sectionNotes[to.ch] = book.sectionNotes[to.ch] || []).push(sec);
  if (sec.text) placeGhost(body, sec, target ? (target.brk || target.ps[0]) : null);
  orderSectionNotes(to.ch);
  syncChapter(body, to.ch);
  scheduleMetaSave();
  renderLooseCards();
}

// ---- one chapter becomes a section of another ----
// Tab on a chapter's line in the List, or a chapter card dropped on the
// middle of another: the chapter's writing goes to the end of the other
// one, after a ***, its note (or its title) becomes that section's note,
// and its own sections come along. Nothing is lost; ⌘Z puts it back.
// Resolves to the new section's id, or null when it can't be done.
async function joinChapter(chId, intoCh) {
  if (!book || !intoCh || chId === intoCh) return null;
  if (!isStory(chId) || !isStory(intoCh)) { toast(t('Only chapters can become sections')); return null; }
  const from = chapterBodyEl(chId);
  const into = chapterBodyEl(intoCh);
  if (!from || !into) return null;
  closeCardEditor();
  snapshotStructure('chapter joined', { outlineFocus: { chId } });
  book.sectionNotes = book.sectionNotes || {};
  const notes = book.sectionNotes[intoCh] = book.sectionNotes[intoCh] || [];
  const sec = { id: newSectionId(), text: ((book.chapterNotes || {})[chId] || '').trim() || ((book.chapterTitles || {})[chId] || '').trim() };
  // what the chapter holds (a chapter of one empty line holds nothing)
  const kids = [...from.children];
  const hasLines = kids.some((el) => el.textContent.trim() || el.querySelector('.ph-mark'));
  const moving = hasLines ? kids : [];
  const intoBlank = !into.innerText.trim() && !into.querySelector('.scene-break, .ghost, .ph-mark');
  if (hasLines) {
    if (intoBlank) into.innerHTML = '';
    else if (!(into.lastElementChild && into.lastElementChild.classList.contains('scene-break'))) into.appendChild(newSceneBreak(sec.id));
    // a chapter that opened with a *** keeps just the one
    if (moving[0].classList.contains('scene-break') && into.lastElementChild && into.lastElementChild.classList.contains('scene-break')) moving.shift().remove();
    for (const el of moving) into.appendChild(el);
    // the chapter's opening carries the new section's note; an opening
    // that's only outline gets the note as a ghost of its own
    const opening = moving[0] && !moving[0].classList.contains('scene-break') && !moving[0].classList.contains('ghost') ? moving[0] : null;
    if (opening) opening.dataset.secId = sec.id;
    else if (sec.text && moving[0]) placeGhost(into, sec, moving[0]);
    repointStickies(moving, intoCh);
  }
  notes.push(sec);
  for (const n of book.sectionNotes[chId] || []) notes.push(n);
  delete book.sectionNotes[chId];
  if (!hasLines && sec.text) placeGhost(into, sec, null);
  orderSectionNotes(intoCh);
  syncChapter(into, intoCh);
  // the words are safe in the other chapter before this one's file goes
  try { await persistChapter(intoCh); } catch (err) { window.neo.logError('join: ' + (err && err.message || err)); return null; }
  if (book.chapterTitles) delete book.chapterTitles[chId];
  await foldNotesPage(chId, intoCh);
  await deleteChapterQuiet(chId);
  updateCounters();
  return sec.id;
}

// ---- dragging (pointer events, so a finger works the same as a mouse) ----

let cardDrag = null;
document.addEventListener('touchmove', (e) => { if (cardDrag && cardDrag.live) e.preventDefault(); }, { passive: false });

function cardPress(e, src) {
  const touch = e.pointerType !== 'mouse';
  const pick = e.shiftKey ? 'range' : (IS_MAC ? e.metaKey : e.ctrlKey) ? 'toggle' : null;
  const st = { src, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, live: false, held: false, timer: null, float: null, target: null };
  cardDrag = st;
  const finish = () => {
    clearTimeout(st.timer);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', esc, true);
    endCardDrag(st);
    if (cardDrag === st) cardDrag = null;
  };
  const move = (ev) => {
    st.x = ev.clientX;
    st.y = ev.clientY;
    const far = Math.hypot(st.x - st.x0, st.y - st.y0);
    if (!st.live) {
      if (touch && !st.held) { if (far > 8) finish(); return; } // a scroll, not a press
      if (!touch && far < 5) return;
      beginCardDrag(st);
    }
    dragOver(st);
  };
  const up = () => {
    const { live, held } = st;
    const target = st.target;
    finish();
    if (live) { dropCard(st.src, target); return; }
    // a press that went nowhere: a click (or, held on a touch screen, the menu)
    const cell = st.src.cell;
    if (held) cardMenu(cell, st.x, st.y);
    else if (pick) selectCard(cell, pick);
    else { clearCardSelection(); openCard(cell); }
  };
  const cancel = () => finish();
  const esc = (ev) => { if (ev.key === 'Escape' && st.live) { ev.preventDefault(); ev.stopPropagation(); st.target = null; finish(); } };
  if (touch) st.timer = setTimeout(() => { st.held = true; if (navigator.vibrate) try { navigator.vibrate(10); } catch { /* fine */ } }, 380);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', esc, true);
}

// ---- several cards at once ----
// ⌘-click (Ctrl-click) adds a card to the selection or takes it out,
// Shift-click takes the run from the last one picked, and a drag across the
// board's empty space sweeps up every card it touches. Delete (or the
// right-click menu) removes them together: their writing goes to Darlings,
// and one ⌘Z brings them all back. A plain click, or Esc, lets go.
let cardSel = new Set();
let cardSelAnchor = null;
function cardKey(cell) {
  const d = cell.dataset;
  if (d.kind === 'loose') return 'l|' + d.loose;
  if (d.kind === 'scene') return 'n|' + d.scene;
  if (d.kind === 'chapter') return 'c|' + d.ch;
  return 's|' + d.ch + '|' + (d.seg || '') + '|' + (d.virtual ? d.sec : '');
}
const selectableCells = () => $$('#outline-board .ob-cell:not([data-new]), #loose-list .ob-cell');
function showCardSelection() {
  for (const c of selectableCells()) c.classList.toggle('ob-sel', cardSel.has(cardKey(c)));
}
function clearCardSelection() {
  if (!cardSel.size) return;
  cardSel = new Set();
  cardSelAnchor = null;
  showCardSelection();
}
function selectCard(cell, how) {
  closeCardEditor();
  const key = cardKey(cell);
  if (how === 'range' && cardSelAnchor) {
    const cells = selectableCells();
    const a = cells.findIndex((c) => cardKey(c) === cardSelAnchor);
    const b = cells.indexOf(cell);
    if (a >= 0 && b >= 0) for (const c of cells.slice(Math.min(a, b), Math.max(a, b) + 1)) cardSel.add(cardKey(c));
    else cardSel.add(key);
  } else if (cardSel.has(key)) cardSel.delete(key);
  else cardSel.add(key);
  cardSelAnchor = key;
  showCardSelection();
}
function cardLasso(e) {
  const x0 = e.clientX;
  const y0 = e.clientY;
  const keep = e.shiftKey || e.metaKey || e.ctrlKey ? new Set(cardSel) : new Set();
  let box = null;
  const move = (ev) => {
    if (!box) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      closeCardEditor();
      box = document.createElement('div');
      box.className = 'ob-lasso';
      document.body.appendChild(box);
      document.body.classList.add('ob-lassoing');
    }
    ev.preventDefault();
    const ts = window.getSelection();
    if (ts && !ts.isCollapsed) ts.removeAllRanges(); // a sweep, not a text selection
    const l = Math.min(x0, ev.clientX), t0 = Math.min(y0, ev.clientY);
    const r = Math.max(x0, ev.clientX), b = Math.max(y0, ev.clientY);
    Object.assign(box.style, { left: l + 'px', top: t0 + 'px', width: (r - l) + 'px', height: (b - t0) + 'px' });
    cardSel = new Set(keep);
    for (const c of $$('#outline-board .ob-cell:not([data-new])')) {
      const q = c.querySelector('.ob-card').getBoundingClientRect();
      if (q.right > l && q.left < r && q.bottom > t0 && q.top < b) cardSel.add(cardKey(c));
    }
    showCardSelection();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    document.body.classList.remove('ob-lassoing');
    if (box) box.remove();
    else clearCardSelection(); // a click on the empty board lets go
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
// Delete or Backspace with cards picked (not while writing on one)
document.addEventListener('keydown', (e) => {
  if (!cardSel.size || !book || currentTab !== 'outline') return;
  if (e.target && e.target.closest && e.target.closest('[contenteditable="true"], input, textarea')) return;
  if (e.key === 'Escape') { clearCardSelection(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelectedCards(); }
});

async function deleteSelectedCards() {
  const cells = selectableCells().filter((c) => cardSel.has(cardKey(c)));
  clearCardSelection();
  if (!cells.length || !book) return;
  snapshotStructure('cards delete');
  const chapters = new Set(cells.filter((c) => c.dataset.kind === 'chapter').map((c) => c.dataset.ch));
  // a book keeps at least one chapter of its story
  const stories = book.chapterOrder.filter((c) => isStory(c));
  if (stories.length && stories.every((c) => chapters.has(c))) chapters.delete(stories[0]);
  // sections from the last up, so the ones before keep their places; none
  // from a chapter that's going whole
  const sections = cells.filter((c) => c.dataset.kind === 'section' && !chapters.has(c.dataset.ch))
    .sort((a, b) => Number(b.dataset.seg || -1) - Number(a.dataset.seg || -1));
  for (const c of sections) {
    if (c.dataset.virtual) deleteSectionNote(c.dataset.ch, c.dataset.sec);
    else await deleteSectionToDarlings(c.dataset.ch, Number(c.dataset.seg), true);
  }
  const scenes = cells.filter((c) => c.dataset.kind === 'scene').sort((a, b) => Number(b.dataset.scene) - Number(a.dataset.scene));
  for (const c of scenes) await deleteSceneToDarlings(c, true);
  for (const chId of chapters) await deleteChapterToDarlings(chId, true);
  for (const c of cells.filter((x) => x.dataset.kind === 'loose')) await removeLooseCard(c.dataset.loose, true);
  renderLooseCards();
  if (currentTab === 'outline') renderOutline();
  updateCounters();
  toast(t('{n} cards removed — their writing is in Darlings, or {key} to undo', { n: cells.length, key: KZ }), 6000);
}

function beginCardDrag(st) {
  st.live = true;
  closeCardEditor();
  const card = st.src.cell.querySelector('.ob-card');
  const r = card.getBoundingClientRect();
  const float = card.cloneNode(true);
  float.classList.add('ob-float');
  float.style.width = r.width + 'px';
  float.style.height = r.height + 'px';
  st.dx = st.x0 - r.left;
  st.dy = st.y0 - r.top;
  document.body.appendChild(float);
  st.float = float;
  st.src.cell.classList.add('ob-lifted');
  document.body.classList.add('ob-dragging');
  // the loose pane opens to take a card
  const c = st.src.cell;
  if ((st.src.kind === 'section' && (c.dataset.written || c.dataset.sec)) || st.src.kind === 'scene' ||
      (st.src.kind === 'chapter' && canSetChapterAside(c.dataset.ch))) $('#side-pane').classList.add('drop-ready');
}

function endCardDrag(st) {
  if (st.float) st.float.remove();
  st.src.cell.classList.remove('ob-lifted');
  document.body.classList.remove('ob-dragging');
  $('#side-pane').classList.remove('drop-ready', 'drop-over');
  $('#ob-caret')?.remove();
  $('#ob-join-tip')?.remove();
  for (const c of $$('.ob-cell.ob-join')) c.classList.remove('ob-join');
  clearInterval(st.scroller);
}

function dragOver(st) {
  st.float.style.left = (st.x - st.dx) + 'px';
  st.float.style.top = (st.y - st.dy) + 'px';
  // the right edge opens the loose cards for a card that can go there
  const pane = $('#side-pane');
  if (pane.classList.contains('drop-ready') && st.x > window.innerWidth - 36) pane.classList.add('open');
  st.target = dragTarget(st);
  showDropCaret(st.target);
  // near the top or bottom: the board scrolls
  const sc = $('#paper-scroll');
  const r = sc.getBoundingClientRect();
  const edge = st.y < r.top + 50 ? -1 : st.y > r.bottom - 50 ? 1 : 0;
  clearInterval(st.scroller);
  if (edge) st.scroller = setInterval(() => { sc.scrollTop += edge * 14; st.target = dragTarget(st); showDropCaret(st.target); }, 30);
}

// the card under the pointer, or the nearest one in its line
function nearestCard(cells, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const c of cells) {
    const r = c.getBoundingClientRect();
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const d = dy * 3 + dx;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// where a card would land: { cell, side } on the board, or the loose pane
function dragTarget(st) {
  // a loose card holding a whole chapter goes back in as a chapter
  const kind = st.src.kind === 'loose' && st.src.cell.dataset.held === 'chapter' ? 'chapter' : st.src.kind;
  const pane = $('#side-pane');
  const pr = pane.getBoundingClientRect();
  const overPane = pane.classList.contains('open') && st.x >= pr.left && st.x <= pr.right && st.y >= pr.top && st.y <= pr.bottom;
  pane.classList.toggle('drop-over', overPane && pane.classList.contains('drop-ready'));
  if (overPane) return pane.classList.contains('drop-ready') ? { loose: true } : null;
  const cells = [...outlineBoard().querySelectorAll('.ob-cell:not(.ob-lifted):not([data-new])')];
  if (!cells.length) return null;
  let best = nearestCard(cells, st.x, st.y);
  const r = best.getBoundingClientRect();
  // over the middle of a chapter card: into that chapter (a chapter joins
  // it as a section; a section or loose card goes to its end)
  const middle = st.x > r.left + r.width * 0.25 && st.x < r.right - r.width * 0.25 && st.y >= r.top && st.y <= r.bottom;
  if (middle && best.dataset.kind === 'chapter' && (kind === 'section' || kind === 'loose' || (kind === 'chapter' && st.src.kind === 'chapter' && best.dataset.ch !== st.src.cell.dataset.ch))) {
    return { cell: best, side: 'into' };
  }
  let side = st.x < r.left + r.width / 2 ? 'before' : 'after';
  // a chapter goes in only between chapters
  if (kind === 'chapter') {
    if (best.dataset.kind !== 'chapter' || side === 'after') {
      // after this card's chapter
      const run = cells.filter((c) => c.dataset.ch === best.dataset.ch);
      best = run[run.length - 1];
      side = 'after';
    }
  }
  return { cell: best, side };
}

function showDropCaret(target) {
  let caret = $('#ob-caret');
  for (const c of $$('.ob-cell.ob-join')) if (!target || c !== target.cell || target.side !== 'into') c.classList.remove('ob-join');
  let tip = $('#ob-join-tip');
  if (target && target.side === 'into') {
    if (caret) caret.remove();
    target.cell.classList.add('ob-join');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'ob-join-tip';
      document.body.appendChild(tip);
    }
    const name = chapterName(target.cell.dataset.ch);
    tip.textContent = cardDrag && cardDrag.src.kind === 'chapter'
      ? t('becomes a section of {chapter}', { chapter: name })
      : t('goes to the end of {chapter}', { chapter: name });
    const r = target.cell.getBoundingClientRect();
    tip.style.left = (r.left + 8) + 'px';
    tip.style.top = (r.bottom + 4) + 'px';
    return;
  }
  if (tip) tip.remove();
  if (!target || !target.cell) { if (caret) caret.remove(); return; }
  if (!caret) {
    caret = document.createElement('div');
    caret.id = 'ob-caret';
    document.body.appendChild(caret);
  }
  const r = target.cell.getBoundingClientRect();
  caret.style.left = (target.side === 'before' ? r.left - 2 : r.right - 1) + 'px';
  caret.style.top = (r.top + 6) + 'px';
  caret.style.height = Math.max(10, r.height - 12) + 'px';
}

// ---- files dropped on the Outline ----
// A document from Finder or Explorer goes in as chapters between chapters:
// before a chapter card (or List line) when it's dropped on that card's left
// half (the line's top half), otherwise after the chapter the card is in.
// The caret is the card drag's own.
const chapterAfter = (chId) => book.chapterOrder[book.chapterOrder.indexOf(chId) + 1] || null;
function outlineFileTarget(x, y) {
  if (boardShowing()) {
    const cells = [...outlineBoard().querySelectorAll('.ob-cell:not([data-new])')];
    if (!cells.length) return { beforeId: null };
    const best = nearestCard(cells, x, y);
    const r = best.getBoundingClientRect();
    if (best.dataset.kind === 'chapter' && x < r.left + r.width / 2) return { cell: best, side: 'before', beforeId: best.dataset.ch };
    const run = cells.filter((c) => c.dataset.ch === best.dataset.ch);
    return { cell: run[run.length - 1], side: 'after', beforeId: chapterAfter(best.dataset.ch) };
  }
  const lines = $$('#outline-list .ol-line');
  if (!lines.length) return { beforeId: null };
  let best = lines[lines.length - 1];
  for (const l of lines) if (y < l.getBoundingClientRect().bottom) { best = l; break; }
  const r = best.getBoundingClientRect();
  if (!best.classList.contains('ol-section') && y < r.top + r.height / 2) return { line: best, side: 'before', beforeId: best.dataset.chId };
  const run = lines.filter((l) => l.dataset.chId === best.dataset.chId);
  return { line: run[run.length - 1], side: 'after', beforeId: chapterAfter(best.dataset.chId) };
}
function showFileCaret(target) {
  if (!target || (!target.cell && !target.line)) { $('#ob-caret')?.remove(); return; }
  if (target.cell) { showDropCaret(target); $('#ob-caret').style.width = ''; return; }
  // the List: a line across, above or below the chapter's lines
  showDropCaret(null);
  const caret = document.createElement('div');
  caret.id = 'ob-caret';
  document.body.appendChild(caret);
  const r = target.line.getBoundingClientRect();
  caret.style.left = r.left + 'px';
  caret.style.width = r.width + 'px';
  caret.style.height = '3px';
  caret.style.top = (target.side === 'before' ? r.top - 2 : r.bottom - 1) + 'px';
}
const outlineFileDrag = (e) => currentTab === 'outline' && navFileDrag(e);
$('#paper-scroll').addEventListener('dragover', (e) => {
  if (!outlineFileDrag(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  showFileCaret(outlineFileTarget(e.clientX, e.clientY));
});
$('#paper-scroll').addEventListener('dragleave', (e) => {
  if (e.relatedTarget && $('#paper-scroll').contains(e.relatedTarget)) return;
  if (outlineFileDrag(e)) showFileCaret(null);
});
$('#paper-scroll').addEventListener('drop', async (e) => {
  if (!outlineFileDrag(e) || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
  e.preventDefault();
  const target = outlineFileTarget(e.clientX, e.clientY);
  showFileCaret(null);
  await importDroppedChapters(e.dataTransfer.files, target.beforeId);
});

function dropCard(src, target) {
  if (!target || !book) return;
  clearCardSelection(); // the cards picked may stand elsewhere after a move
  const cell = src.cell;
  if (target.loose) {
    if (src.kind === 'section') sectionToLoose(cell.dataset.ch, Number(cell.dataset.seg), cell.dataset.virtual ? cell.dataset.sec : null);
    else if (src.kind === 'chapter') chapterToLoose(cell.dataset.ch);
    else if (src.kind === 'scene') sceneToLoose(cell);
    return;
  }
  const tc = target.cell;
  // a card holding a chapter: a chapter again, before or after the one it's dropped by
  if (src.kind === 'loose' && cell.dataset.held === 'chapter') {
    const at = book.chapterOrder.indexOf(tc.dataset.ch);
    if (at < 0) return;
    looseToChapter(cell.dataset.loose, at + (tc.dataset.kind === 'chapter' && target.side === 'before' ? 0 : 1));
    renderBoard();
    return;
  }
  if (target.side === 'into') {
    const into = tc.dataset.ch;
    if (src.kind === 'chapter') { joinChapter(cell.dataset.ch, into).then(() => { if (currentTab === 'outline') renderBoard(); }); return; }
    if (src.kind === 'loose') looseToSection(cell.dataset.loose, { ch: into, before: null });
    else if (cell.dataset.virtual) moveVirtualNote(cell.dataset.ch, cell.dataset.sec, into);
    else moveSection(cell.dataset.ch, Number(cell.dataset.seg), { ch: into, before: null });
    renderBoard();
    return;
  }
  if (tc.dataset.kind === 'scene') {
    const idx = Number(tc.dataset.scene);
    const to = target.side === 'before' ? idx : idx + 1;
    if (src.kind === 'scene') spMoveScene(Number(cell.dataset.scene), to);
    else if (src.kind === 'loose') looseToScene(cell.dataset.loose, to);
    renderBoard();
    return;
  }
  if (src.kind === 'chapter') {
    const at = book.chapterOrder.indexOf(tc.dataset.ch) + (target.side === 'after' ? 1 : 0);
    moveChapterCard(cell.dataset.ch, at);
    renderBoard();
    return;
  }
  // a section (or a loose card): which chapter, and before which section
  let to;
  if (tc.dataset.kind === 'chapter') {
    if (target.side === 'after') to = { ch: tc.dataset.ch, before: firstSectionIndex(tc.dataset.ch) };
    else {
      const prev = storyBefore(tc.dataset.ch);
      to = prev ? { ch: prev, before: null } : { ch: tc.dataset.ch, before: firstSectionIndex(tc.dataset.ch) };
    }
  } else {
    const idx = Number(tc.dataset.seg);
    if (target.side === 'before') to = { ch: tc.dataset.ch, before: idx >= 0 ? idx : null };
    else {
      const segs = chapterSegments(tc.dataset.ch);
      to = { ch: tc.dataset.ch, before: idx >= 0 && idx + 1 < segs.length ? idx + 1 : null };
    }
  }
  if (src.kind === 'loose') looseToSection(cell.dataset.loose, to);
  else if (cell.dataset.virtual) {
    // a note that isn't on the page yet just changes chapters
    moveVirtualNote(cell.dataset.ch, cell.dataset.sec, to.ch);
  } else moveSection(cell.dataset.ch, Number(cell.dataset.seg), to);
  renderBoard();
}

function firstSectionIndex(chId) {
  const segs = chapterSegments(chId);
  const i = segs[0] && !segs[0].id ? 1 : 0;
  return i < segs.length ? i : null;
}

function moveVirtualNote(fromCh, secId, toCh) {
  if (fromCh === toCh) return;
  snapshotStructure('card moved');
  const note = sectionNote(fromCh, secId);
  book.sectionNotes[fromCh] = book.sectionNotes[fromCh].filter((s) => s.id !== secId);
  if (note) (book.sectionNotes[toCh] = book.sectionNotes[toCh] || []).push(note);
  scheduleMetaSave();
}

// ---- a script's board: every scene a card ----
// A scene is its heading and the lines under it (spLayout.scenes). Its card
// shows the heading, how long it runs in eighths of a page, who's in it, and
// the writer's note (book.sceneNotes, keyed by an id on the heading line;
// the first heading to carry an id owns it), or else its first line of
// action. Dragging a card moves the scene, as dragging it in the pane does.

const newSceneId = () => 'sc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

// the scene's lines, heading first
function sceneNodes(s) {
  const nodes = [s.p];
  for (let n = s.p.nextElementSibling; n && !(n.tagName === 'P' && spType(n) === 'heading'); n = n.nextElementSibling) nodes.push(n);
  return nodes;
}

function scriptScenes() {
  spRepaginate();
  const notes = book.sceneNotes || {};
  const claimed = new Set();
  return (spLayout.scenes || []).filter((s) => s.p.isConnected).map((s, k) => {
    const nodes = sceneNodes(s);
    let id = s.p.dataset.sceneId || null;
    if (id && (claimed.has(id) || !(id in notes))) id = null;
    if (id) claimed.add(id);
    const cast = [];
    for (const n of nodes) {
      if (spType(n) !== 'character') continue;
      const name = n.textContent.replace(/\(.*?\)/g, '').replace(/\^$/, '').trim().toUpperCase();
      if (name && !cast.includes(name)) cast.push(name);
    }
    const action = nodes.slice(1).find((n) => spType(n) === 'action' && n.textContent.trim());
    return { k, s, id, slug: s.slug, eighths: spEighths(s.lines), cast, first: action ? action.textContent.replace(/\s+/g, ' ').trim() : '' };
  });
}

function renderScriptBoard(board) {
  board.classList.add('script-board');
  rescueSceneNotes();
  for (const sc of scriptScenes()) board.appendChild(sceneCard(sc));
}

// A note whose heading is gone from the page (its scene cut away, or its
// line made into something else) goes to the loose cards, not nowhere
function rescueSceneNotes() {
  const notes = book.sceneNotes || {};
  const ids = Object.keys(notes);
  if (!ids.length) return;
  const ps = spParas();
  if (!ps.length) return; // the page isn't up yet
  const onPage = new Set(ps.filter((p) => spType(p) === 'heading').map((p) => p.dataset.sceneId).filter(Boolean));
  let moved = false;
  for (const id of ids) {
    if (onPage.has(id)) continue;
    if (String(notes[id] || '').trim()) (book.looseCards = book.looseCards || []).push({ id: 'lc-' + id, text: notes[id] });
    delete notes[id];
    moved = true;
  }
  if (moved) { scheduleMetaSave(); renderLooseCards(); }
}

function sceneCard(sc) {
  const { cell, card } = cardCell('scene', spChapterOf(sc.s.p) || '');
  cell.dataset.scene = String(sc.k);
  if (sc.id) cell.dataset.sid = sc.id;
  const head = document.createElement('div');
  head.className = 'ob-head';
  const num = document.createElement('span');
  num.className = 'ob-letter';
  num.textContent = String(sc.k + 1);
  const len = document.createElement('span');
  len.className = 'ob-words';
  len.textContent = sc.eighths ? spEighthsText(sc.eighths) : '';
  head.append(num, len);
  const slug = document.createElement('div');
  slug.className = 'ob-slug';
  slug.textContent = sc.slug;
  slug.dataset.ph = t('INT. PLACE - DAY');
  const text = document.createElement('div');
  text.className = 'ob-text';
  const foot = document.createElement('div');
  foot.className = 'ob-foot';
  foot.textContent = sc.cast.join(' · ');
  card.append(head, slug, text, foot);
  cell.dataset.excerpt = sc.first ? quoted(sc.first) : '';
  fillCardText(cell, sc.id ? book.sceneNotes[sc.id] : '');
  cell.setAttribute('aria-label', t('Scene {n}', { n: sc.k + 1 }) + '. ' + (sc.slug || '') + '. ' + text.textContent);
  return cell;
}

// the scene a card stands for, as the page has it now
function sceneOfCell(cell) {
  return scriptScenes()[Number(cell.dataset.scene)] || null;
}

// a new scene, after scene k (-1: before the first), with its heading and an
// empty line of action under it
function insertScene(k, slug) {
  const scenes = scriptScenes();
  const h = document.createElement('p');
  h.className = 'sp-heading';
  if (slug) h.textContent = slug; else h.appendChild(document.createElement('br'));
  const a = document.createElement('p');
  a.appendChild(document.createElement('br'));
  let body;
  if (k < 0 && scenes[0]) {
    body = spBodyOf(scenes[0].s.p);
    scenes[0].s.p.before(h, a);
  } else if (scenes[k]) {
    const nodes = sceneNodes(scenes[k].s);
    body = spBodyOf(scenes[k].s.p);
    nodes[nodes.length - 1].after(h, a);
  } else {
    const bodies = spBodies();
    body = bodies[bodies.length - 1];
    if (!body) return null;
    const last = body.lastElementChild;
    // an empty last line becomes the heading's place
    if (last && !last.textContent.trim() && spType(last) === 'action' && body.children.length > 1) last.remove();
    body.append(h, a);
  }
  syncChapter(body, body.closest('.chapter').dataset.id);
  breakRun++;
  spRepaginate();
  return h;
}

function saveSceneCard(cell, note, slug) {
  if (cell.dataset.new) {
    if (!note && !slug) return;
    snapshotStructure('scene added');
    if (slug) slug = slug.replace(/\s[–—]\s/g, ' - ');
    const h = insertScene(Number(cell.dataset.after), slug);
    if (!h) return;
    delete cell.dataset.new;
    cell.dataset.scene = String((spLayout.scenes || []).findIndex((x) => x.p === h));
    if (note) {
      const id = newSceneId();
      (book.sceneNotes = book.sceneNotes || {})[id] = note;
      h.dataset.sceneId = id;
      syncChapter(spBodyOf(h), spChapterOf(h));
      scheduleMetaSave();
    }
    renderNav();
    return;
  }
  const sc = sceneOfCell(cell);
  if (!sc) return;
  const h = sc.s.p;
  // a heading keeps its plain hyphens (the card's typing makes dashes of them)
  if (slug) slug = slug.replace(/\s[–—]\s/g, ' - ');
  let changed = false;
  if (slug !== null && slug !== sc.slug) {
    h.textContent = slug;
    if (!slug) h.appendChild(document.createElement('br'));
    changed = true;
  }
  const had = sc.id ? book.sceneNotes[sc.id] : '';
  if (note !== had) {
    book.sceneNotes = book.sceneNotes || {};
    let id = sc.id;
    if (!id) {
      if (!note) return;
      id = newSceneId();
      h.dataset.sceneId = id;
      changed = true;
    }
    book.sceneNotes[id] = note;
    scheduleMetaSave();
  }
  if (changed) {
    syncChapter(spBodyOf(h), spChapterOf(h));
    spRepaginate();
    renderNav();
  }
}

function looseToScene(looseId, before) {
  const card = (book.looseCards || []).find((c) => c.id === looseId);
  if (!card) return;
  if (card.html) { heldSceneBack(card, before); return; }
  snapshotStructure('loose card placed');
  book.looseCards = book.looseCards.filter((c) => c.id !== looseId);
  const h = insertScene(before - 1, '');
  if (h && card.text) {
    const id = newSceneId();
    (book.sceneNotes = book.sceneNotes || {})[id] = card.text;
    h.dataset.sceneId = id;
    syncChapter(spBodyOf(h), spChapterOf(h));
  }
  scheduleMetaSave();
  renderLooseCards();
  renderNav();
}

function goToScene(cell) {
  const sc = sceneOfCell(cell);
  switchTab('manuscript');
  if (sc) goToSceneHeading(sc.s.p);
}
function goToSceneHeading(p) {
  spBodyOf(p).focus({ preventScroll: true });
  spCaretToEnd(p);
  spLastPara = p;
  const scr = $('#paper-scroll');
  scr.scrollTop += p.getBoundingClientRect().top - scr.getBoundingClientRect().top - scr.clientHeight / 4;
  updateCounters();
}

// ---- loose cards: the right-hand pane, while the outline is up ----

function looseList() {
  let list = $('#loose-list');
  if (list) return list;
  const head = $('#side-head > span');
  if (head) {
    head.classList.add('side-title-notes');
    const alt = document.createElement('span');
    alt.className = 'side-title-loose';
    alt.textContent = t('Loose cards');
    head.after(alt);
  }
  list = document.createElement('div');
  list.id = 'loose-list';
  $('#sticky-list').after(list);
  list.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.ob-cell');
    if (!cell || e.button !== 0 || cell.classList.contains('open') || e.target.closest('button')) return;
    cardPress(e, { kind: 'loose', cell });
  });
  list.addEventListener('contextmenu', (e) => {
    const cell = e.target.closest('.ob-cell');
    if (!cell) return;
    e.preventDefault();
    if (!NO_HOVER) cardMenu(cell, e.clientX, e.clientY);
  });
  list.addEventListener('keydown', (e) => {
    const cell = e.target.closest && e.target.closest('.ob-cell');
    if (!cell || cell.classList.contains('open')) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCard(cell); }
  });
  return list;
}

function renderLooseCards() {
  const list = looseList();
  list.innerHTML = '';
  if (!book) return;
  for (const c of book.looseCards || []) {
    const { cell, card } = cardCell('loose', '');
    cell.dataset.loose = c.id;
    const text = document.createElement('div');
    text.className = 'ob-text';
    text.textContent = c.text;
    card.appendChild(text);
    if (c.html) {
      // the words it holds: its opening line, and how many
      const holder = document.createElement('div');
      holder.innerHTML = c.html;
      const first = [...holder.children].map((x) => x.textContent).join(' ').replace(/\s+/g, ' ').trim();
      if (!c.text) text.textContent = c.title || (first.length > 120 ? first.slice(0, 117) + '…' : first);
      const n = document.createElement('div');
      n.className = 'ob-held';
      n.textContent = t('{n} words', { n: (c.words || countWords(holder.textContent)).toLocaleString() });
      card.appendChild(n);
      cell.dataset.held = c.held || 'section';
    }
    list.appendChild(cell);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'loose-add';
  add.textContent = t('+ card');
  add.onclick = () => addLooseCard();
  if (featureOn('cards') || isScript()) list.appendChild(add);
  if (!(book.looseCards || []).length) {
    const tip = document.createElement('div');
    tip.className = 'loose-tip';
    tip.textContent = t('Ideas without a chapter yet. Drag one onto the board when it finds its place.');
    list.appendChild(tip);
  }
}

function addLooseCard() {
  if (!book) return;
  const id = 'lc-' + Date.now().toString(36);
  (book.looseCards = book.looseCards || []).push({ id, text: '' });
  renderLooseCards();
  const cell = looseList().querySelector(`.ob-cell[data-loose="${id}"]`);
  if (cell) openCard(cell);
}

function saveLooseCard(id, val) {
  const cards = book.looseCards || [];
  const c = cards.find((x) => x.id === id);
  if (!c) return;
  // an emptied note takes the card away, unless the card holds writing
  if (!val && !c.html) { book.looseCards = cards.filter((x) => x.id !== id); scheduleMetaSave(); setTimeout(renderLooseCards, 0); return; }
  if (c.text === val) return;
  c.text = val;
  scheduleMetaSave();
}

async function removeLooseCard(id, quiet = false) {
  const card = (book.looseCards || []).find((x) => x.id === id);
  if (!card) return;
  // words on the card go to Darlings first; the card goes only once they're safe there
  if (card.html) {
    const holder = document.createElement('div');
    holder.innerHTML = card.html;
    darlings.unshift({
      id: 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      html: card.html,
      text: [...holder.children].map((x) => x.textContent).join('\n'),
      chapterId: null,
      chapterLabel: t('Loose cards'),
      date: new Date().toISOString()
    });
    try {
      await writeSidecar(book.id, 'darlings', darlings);
    } catch {
      darlings.shift();
      toast(t('NEO couldn’t save to Darlings, so the card stays'));
      return;
    }
    renderDarlings();
    if (!quiet) toast(t('The card’s words are in Darlings'));
  }
  if (!quiet) snapshotStructure('loose card removed');
  book.looseCards = (book.looseCards || []).filter((x) => x.id !== id);
  scheduleMetaSave();
  renderLooseCards();
}

// ---- whole chapters and scenes set aside as loose cards ----
// The card carries the writing (as html) and what belongs to it, and is
// written to book.json before the chapter or the scene leaves the page, so
// the words are always somewhere on disk. Placed again, it comes back whole.

// a chapter of the story that isn't the book's only one
function canSetChapterAside(chId) {
  return !!chId && isStory(chId) && book.chapterOrder.filter((c) => isStory(c)).length > 1;
}

// book.json with the card in it, or the card taken back out and false
async function saveHeldCard(card) {
  let stamp = null;
  try { stamp = await writeBookMeta(book.id, book); } catch (err) { window.neo.logError('loose card: ' + (err && err.message || err)); }
  if (typeof stamp !== 'string') {
    book.looseCards = (book.looseCards || []).filter((c) => c !== card);
    toast(t('NEO couldn’t save the card, so the writing stays where it was'));
    return false;
  }
  book.modified = stamp;
  savedMetaSig = metaSig(book);
  return true;
}

async function chapterToLoose(chId) {
  if (!canSetChapterAside(chId)) return;
  const body = chapterBodyEl(chId);
  if (body && body.querySelector('.ph-mark')) { toast(t('That chapter has a placeholder in it. Move the placeholder first.')); return; }
  snapshotStructure('card to loose');
  if (body) syncChapter(body, chId);
  const kind = chapterKind(chId);
  const card = {
    id: 'lc-' + Date.now().toString(36),
    held: 'chapter',
    title: (book.chapterTitles || {})[chId] || '',
    text: (book.chapterNotes || {})[chId] || '',
    html: chapterHTML[chId] || '',
    notes: JSON.parse(JSON.stringify((book.sectionNotes || {})[chId] || [])),
    words: chapterWords(chId)
  };
  if (kind !== 'chapter') card.kind = kind;
  (book.looseCards = book.looseCards || []).push(card);
  if (!(await saveHeldCard(card))) return;
  if (book.chapterTitles) delete book.chapterTitles[chId];
  if (currentChapterId === chId) currentChapterId = null;
  await deleteChapterQuiet(chId);
  renderLooseCards();
  if (currentTab === 'outline') renderBoard();
  updateCounters();
  toast(t('The chapter is on a loose card, its words with it. Drag it back between two chapters to put it in again.'), 6000);
}

function looseToChapter(looseId, index) {
  const card = (book.looseCards || []).find((c) => c.id === looseId);
  if (!card) return;
  snapshotStructure('loose card placed');
  const chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  book.chapterOrder.splice(Math.max(0, Math.min(index, book.chapterOrder.length)), 0, chId);
  chapterHTML[chId] = card.html || '<p><br></p>';
  if (card.title) (book.chapterTitles = book.chapterTitles || {})[chId] = card.title;
  if (card.text) (book.chapterNotes = book.chapterNotes || {})[chId] = card.text;
  if (card.notes && card.notes.length) (book.sectionNotes = book.sectionNotes || {})[chId] = card.notes;
  if (card.kind) setChapterKind(chId, card.kind);
  book.looseCards = book.looseCards.filter((c) => c.id !== looseId);
  // the chapter's file is written before book.json lets the card go
  persistChapter(chId).then(() => saveMeta())
    .catch((err) => window.neo.logError('loose to chapter: ' + (err && err.message || err)));
  renderChapters();
  renderLooseCards();
  updateCounters();
}

async function sceneToLoose(cell) {
  const sc = sceneOfCell(cell);
  if (!sc || !sc.s.p.isConnected) return;
  const nodes = sceneNodes(sc.s);
  const body = spBodyOf(sc.s.p);
  const chId = body.closest('.chapter').dataset.id;
  snapshotStructure('card to loose');
  const holder = document.createElement('div');
  for (const n of nodes) holder.appendChild(n.cloneNode(true));
  const head = holder.firstElementChild;
  if (head) head.removeAttribute('data-scene-id');
  const card = {
    id: 'lc-' + Date.now().toString(36),
    held: 'scene',
    text: (cell.dataset.sid && (book.sceneNotes || {})[cell.dataset.sid]) || '',
    html: captureBody(holder),
    words: countWords(nodes.map((n) => n.textContent).join('\n'))
  };
  (book.looseCards = book.looseCards || []).push(card);
  if (!(await saveHeldCard(card))) return;
  for (const n of nodes) n.remove();
  if (!body.querySelector('p')) body.innerHTML = '<p><br></p>';
  if (cell.dataset.sid && book.sceneNotes) delete book.sceneNotes[cell.dataset.sid];
  syncChapter(body, chId);
  clearTimeout(saveTimers[chId]);
  persistChapter(chId).then(() => saveMeta())
    .catch((err) => window.neo.logError('scene to loose: ' + (err && err.message || err)));
  breakRun++;
  spRepaginate();
  renderNav();
  renderLooseCards();
  renderBoard();
  updateCounters();
  toast(t('The scene is on a loose card, its lines with it. Drag it back onto the board to put it in again.'), 6000);
}

// a card holding a scene's lines: back in before scene `before` (or at the end)
function heldSceneBack(card, before) {
  const scenes = scriptScenes();
  const target = scenes[before] && scenes[before].s.p.isConnected ? scenes[before].s.p : null;
  const dest = target ? spBodyOf(target) : spBodies()[spBodies().length - 1];
  if (!dest) return;
  snapshotStructure('loose card placed');
  const holder = document.createElement('div');
  holder.innerHTML = card.html;
  const nodes = [...holder.children];
  if (!nodes.length) return;
  // an empty script's one blank line gives way
  if (!dest.textContent.trim() && dest.children.length === 1) dest.innerHTML = '';
  if (card.text) {
    const id = newSceneId();
    (book.sceneNotes = book.sceneNotes || {})[id] = card.text;
    nodes[0].dataset.sceneId = id;
  }
  for (const n of nodes) { if (target) target.before(n); else dest.appendChild(n); }
  book.looseCards = book.looseCards.filter((c) => c.id !== card.id);
  const chId = dest.closest('.chapter').dataset.id;
  syncChapter(dest, chId);
  clearTimeout(saveTimers[chId]);
  persistChapter(chId).then(() => saveMeta())
    .catch((err) => window.neo.logError('loose to scene: ' + (err && err.message || err)));
  breakRun++;
  spRepaginate();
  renderNav();
  renderLooseCards();
  updateCounters();
}

// the right-hand pane holds loose cards while the Outline is up (there are
// no placeholders to show there)
function sidePaneForTab(name) {
  const notes = name === 'notes' && !!book;
  $('#editor-view').classList.toggle('notes-tab', notes);
  if (notes) { renderNotesNav(); renderNotesSide(); }
  // loose cards are behind Show More Features; a book that has some keeps them in view
  const outline = name === 'outline' && !!book && (featureOn('cards') || isScript() || !!(book.looseCards || []).length);
  $('#editor-view').classList.toggle('outline-tab', outline);
  if (outline) renderLooseCards();
  // on Darlings the pane holds the book's snapshots, and stays open
  const was = $('#editor-view').classList.contains('darlings-tab');
  const dar = name === 'darlings' && !!book && snapsCan() && !IS_POCKET; // (Pocket's own list: later)
  $('#editor-view').classList.toggle('darlings-tab', dar);
  if (dar) { snapList(); $('#side-pane').classList.add('open'); }
  else if (was && $('#side-pane').dataset.pinned !== '1') $('#side-pane').classList.remove('open');
}

// ---- the note walks ahead ----
// Writing over a section's gray ghost used to take the note away with the
// first key. Now, while the caret is in a section that has an outline note,
// the note rides one line below the paragraph being written: faint, out of
// the text (it's never saved or exported), with a quiet Dismiss. Leave the
// section and it waits; come back and it's there, until it's dismissed.
let walkEl = null;
let walkP = null;
let walkQueued = false;

// the outline note of the section holding p (the first section to carry an
// id is its owner: lines split from a written ghost carry the id along)
function sectionIdAt(body, p) {
  const chId = body.closest('.chapter')?.dataset.id;
  const notes = new Set(((book.sectionNotes || {})[chId] || []).map((s) => s.id));
  const claimed = new Set();
  let id = null;
  let mine = false;
  let ghost = false;
  for (const el of body.children) {
    if (el.classList.contains('scene-break')) {
      if (mine) break;
      if (id) claimed.add(id);
      id = null;
      ghost = false;
      continue;
    }
    if (!id && el.dataset && notes.has(el.dataset.secId) && !claimed.has(el.dataset.secId)) id = el.dataset.secId;
    if (el.classList.contains('ghost')) ghost = true;
    if (el === p) mine = true;
  }
  return mine && !ghost ? { chId, id } : null;
}

function hideWalkNote() {
  // (a paragraph split from the one holding the room takes the mark along)
  for (const q of document.querySelectorAll('.chapter-body p[data-walk]')) q.removeAttribute('data-walk');
  if (walkEl) walkEl.remove();
  walkEl = null;
  walkP = null;
}

// ---- the cards beside the page (#340) ----
// While writing, the top of the right-hand pane holds the Outline's cards for
// where the caret is: the chapter's card and its sections' (the one the caret
// is in marked), or in a script the scene's. They're the same notes the
// Outline shows, and they stay here after the gray ghost on the page has
// been written over. Typed on here, they change there too.
let sideCardsKey = '';
let sideCardsQueued = false;
function sideCardsBox() {
  let box = $('#side-cards');
  if (box) return box;
  box = document.createElement('div');
  box.id = 'side-cards';
  $('#side-head').before(box);
  return box;
}
// the section (by its note's id) holding p, ghost or written
function sectionOf(body, p) {
  const chId = body.closest('.chapter')?.dataset.id;
  const notes = new Set(((book.sectionNotes || {})[chId] || []).map((s) => s.id));
  const claimed = new Set();
  let id = null;
  for (const el of body.children) {
    if (el.classList.contains('scene-break')) {
      if (id) claimed.add(id);
      id = null;
      if (el === p) return null;
      continue;
    }
    if (!id && el.dataset && notes.has(el.dataset.secId) && !claimed.has(el.dataset.secId)) id = el.dataset.secId;
    if (el === p) return id;
  }
  return null;
}
function queueSideCards() {
  if (sideCardsQueued) return;
  sideCardsQueued = true;
  requestAnimationFrame(() => { sideCardsQueued = false; sideCardsUpdate(); });
}
function sideCardsUpdate(force) {
  const box = sideCardsBox();
  // (the cards beside the page are behind Show More Features)
  if (!book || currentTab !== 'manuscript' || !featureOn('cards')) { if (sideCardsKey) { box.innerHTML = ''; sideCardsKey = ''; } return; }
  if (box.contains(document.activeElement)) return; // being typed on
  const sel = window.getSelection();
  let el = sel.rangeCount ? sel.anchorNode : null;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const p = el && el.closest ? el.closest('.chapter-body > p') : null;
  const body = p ? p.parentElement : null;
  const chId = body ? body.closest('.chapter').dataset.id : currentChapterId;
  let key = '';
  let cards = [];
  if (chId && isScript()) {
    // the scene: its heading, at or above the caret
    let h = p;
    while (h && !h.classList.contains('sp-heading')) h = h.previousElementSibling;
    if (h) {
      // (a scene gets its id with its first note, here as on the Outline)
      const sid = h.dataset.sceneId || '';
      key = 'scene:' + (sid || [...body.querySelectorAll('p.sp-heading')].indexOf(h)) + ':' + h.textContent;
      cards = [{ kind: 'scene', id: sid, head: h, label: h.textContent.trim() || t('Scene'), text: (book.sceneNotes || {})[sid] || '', current: false }];
    }
  } else if (chId && book.chapterOrder.includes(chId) && isStory(chId)) {
    const secId = body ? sectionOf(body, p) : null;
    const secs = (book.sectionNotes || {})[chId] || [];
    key = 'ch:' + chId + ':' + (secId || '') + ':' + secs.length;
    cards = [{ kind: 'chapter', id: chId, label: (book.chapterTitles || {})[chId] || chapterName(chId), text: (book.chapterNotes || {})[chId] || '', current: false },
      ...secs.map((s, i) => ({ kind: 'section', id: s.id, chId, label: t('Section {letter}', { letter: secLetter(i) }), text: s.text || '', current: s.id === secId }))];
  }
  if (key === sideCardsKey && !force) return;
  sideCardsKey = key;
  box.innerHTML = '';
  if (cards.length) {
    const title = document.createElement('div');
    title.className = 'side-cards-title';
    title.textContent = isScript() ? t('Scene cards') : t('Cards');
    box.appendChild(title);
  }
  for (const c of cards) {
    const card = document.createElement('div');
    card.className = 'side-card side-card-' + c.kind + (c.current ? ' current' : '');
    const head = document.createElement('div');
    head.className = 'side-card-head';
    head.textContent = c.label;
    // the card's name takes the caret to the top of its place on the page (#367)
    head.tabIndex = 0;
    head.setAttribute('role', 'button');
    head.title = t('Go to the page');
    const go = () => {
      if (c.kind === 'chapter') goToChapterTop(c.id);
      else if (c.kind === 'section') goToSegment(c.chId, chapterSegments(c.chId).find((s) => s.id === c.id));
      else if (c.head.isConnected) goToSceneHeading(c.head);
    };
    head.addEventListener('click', go);
    head.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      go();
    });
    const ta = document.createElement('textarea');
    ta.spellcheck = false;
    ta.rows = 1;
    ta.value = c.text;
    ta.placeholder = c.kind === 'chapter' ? t('What happens in this chapter?') : c.kind === 'scene' ? t('What happens in this scene?') : t('What happens in this section?');
    ta.setAttribute('aria-label', c.label);
    const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    ta.addEventListener('input', () => {
      const val = ta.value.trim();
      if (c.kind === 'chapter') book.chapterNotes[c.id] = val;
      else if (c.kind === 'scene') {
        book.sceneNotes = book.sceneNotes || {};
        if (!c.id && val && c.head.isConnected) {
          c.id = newSceneId();
          c.head.dataset.sceneId = c.id;
          syncChapter(spBodyOf(c.head), spChapterOf(c.head));
        }
        if (c.id) { if (val) book.sceneNotes[c.id] = val; else delete book.sceneNotes[c.id]; }
      }
      else { const s = (book.sectionNotes[c.chId] || []).find((x) => x.id === c.id); if (s) s.text = val; }
      scheduleMetaSave();
      fit();
    });
    ta.addEventListener('blur', () => {
      if (c.kind === 'section') syncGhosts(c.chId);
      if (c.kind === 'scene') spSchedule();
      renderNav();
    });
    ta.addEventListener('keydown', (e) => {
      // Esc (or Enter without Shift) goes back to the page
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey && !e.isComposing)) {
        e.preventDefault();
        e.stopPropagation();
        ta.blur();
        focusPage();
      }
    });
    card.append(head, ta);
    box.appendChild(card);
    requestAnimationFrame(fit);
  }
}
document.addEventListener('selectionchange', queueSideCards);
// the pane coming into view shows the cards as they are now (the Outline may
// have changed them since)
$('#side-hotzone').addEventListener('mouseenter', () => sideCardsUpdate(true));

function walkNoteUpdate() {
  walkQueued = false;
  if (!book || currentTab !== 'manuscript' || isScript()) { hideWalkNote(); return; }
  const sel = window.getSelection();
  let el = sel.rangeCount ? sel.anchorNode : null;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const p = el && el.closest ? el.closest('.chapter-body > p') : null;
  const body = p && p.parentElement;
  if (!p || p.classList.contains('ghost') || p.classList.contains('scene-break')) { hideWalkNote(); return; }
  const at = sectionIdAt(body, p);
  const note = at && at.id ? sectionNote(at.chId, at.id) : null;
  if (!note || !note.text || note.dismissed) { hideWalkNote(); return; }
  const chapter = body.closest('.chapter');
  // cut into pages, a chapter's sheet is in pieces, and the note sits on the paper instead
  const host = document.body.classList.contains('paged') ? $('#paper') : chapter;
  if (!walkEl || !walkEl.isConnected || walkEl.parentElement !== host || walkEl.dataset.sec !== note.id) {
    hideWalkNote();
    walkEl = document.createElement('div');
    walkEl.className = 'walk-note';
    walkEl.contentEditable = 'false';
    walkEl.dataset.sec = note.id;
    walkEl.dataset.ch = at.chId;
    const text = document.createElement('span');
    text.className = 'wn-text';
    text.textContent = note.text;
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'wn-dismiss';
    dismiss.textContent = t('Dismiss');
    dismiss.title = t('Put this outline note away for this section (it stays on its card)');
    dismiss.addEventListener('mousedown', (e) => e.preventDefault()); // the caret stays where it is
    dismiss.addEventListener('click', () => {
      const n = sectionNote(walkEl.dataset.ch, walkEl.dataset.sec);
      if (n) { n.dismissed = true; scheduleMetaSave(); }
      hideWalkNote();
    });
    walkEl.append(text, dismiss);
    host.appendChild(walkEl);
  }
  if (walkP !== p) {
    for (const q of body.querySelectorAll('p[data-walk]')) if (q !== p) q.removeAttribute('data-walk');
    walkP = p;
    p.setAttribute('data-walk', '');
  }
  placeWalkNote();
}

function placeWalkNote() {
  if (!walkEl || !walkP || !walkP.isConnected) return;
  const host = walkEl.parentElement; // the chapter, or the paper when it is cut into pages
  const body = walkP.parentElement;
  const c = host.getBoundingClientRect();
  // a paragraph can run over a page break: the note goes under its last piece, in that page's column
  const pieces = walkP.getClientRects();
  const p = pieces.length ? pieces[pieces.length - 1] : walkP.getBoundingClientRect();
  const b = [...body.getClientRects()].find((r) => p.left >= r.left - 1 && p.right <= r.right + 1 && p.top >= r.top - 1 && p.bottom <= r.bottom + 1) || body.getBoundingClientRect();
  walkEl.style.left = (b.left - c.left) + 'px';
  walkEl.style.width = b.width + 'px';
  walkP.closest('.chapter').style.setProperty('--walk-h', (walkEl.offsetHeight + 8) + 'px');
  walkEl.style.top = (p.bottom - c.top + 2) + 'px';
}

function queueWalkNote() {
  if (walkQueued) return;
  walkQueued = true;
  requestAnimationFrame(walkNoteUpdate);
}
document.addEventListener('selectionchange', queueWalkNote);
document.addEventListener('input', (e) => { if (e.target && e.target.closest && e.target.closest('.chapter-body')) queueWalkNote(); }, true);
window.addEventListener('resize', queueWalkNote);

let auxDirty = false;
$('#aux-editor').addEventListener('keydown', (e) => { if (styleKeepScroll(e)) return; smartKeys(e, e.currentTarget); });
$('#aux-editor').addEventListener('input', () => {
  auxDirty = true;
  scheduleAuxSave();
  notesTyped();
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
// Notes waiting for the disk, by book and page. An entry leaves only once
// that exact text is saved; a refused save stays here, is tried again on
// the next flush, and is what the page shows if the writer comes back to it
// before then (not the older file).
const auxPending = {};
// The disk text each page was last read or written as (by book and page): the
// base a save is checked against, as chapter:write checks its own. A refresh
// compares with it too. auxSeq counts the writes, so a read that was out
// while one landed does not set the base back to older text.
const auxBase = {};
const auxSeq = {};
// one page's saves go to the disk one at a time, each with the base the one
// before it left; a newer text waiting behind an older one is never sent first
const auxQueue = {};
function auxRead(bookId, kind) {
  const key = bookId + '/' + kind;
  const seq = auxSeq[key] || 0;
  return window.neo.readAux(bookId, kind).then((html) => {
    if ((auxSeq[key] || 0) === seq) auxBase[key] = html;
    return html;
  });
}
function flushAux() {
  const ed = $('#aux-editor');
  if (auxDirty && ed.dataset.kind && ed.dataset.book) {
    const key = ed.dataset.book + '/' + ed.dataset.kind;
    auxPending[key] = { bookId: ed.dataset.book, kind: ed.dataset.kind, html: ed.innerHTML, inFlight: false };
    auxDirty = false;
  }
  for (const key of Object.keys(auxPending)) {
    const job = auxPending[key];
    if (job.inFlight) continue;
    job.inFlight = true;
    const run = (auxQueue[key] || Promise.resolve()).then(() => saveAuxJob(key, job));
    auxQueue[key] = run.catch(() => {});
    run.catch((err) => {
      job.inFlight = false;
      window.neo.logError('notes save: ' + (err && err.message || err));
    });
  }
}
function saveAuxJob(key, job) {
  return window.neo.writeAux(job.bookId, job.kind, job.html, auxBase[key]).then((r) => {
    auxBase[key] = job.html;
    auxSeq[key] = (auxSeq[key] || 0) + 1;
    if (auxPending[key] === job) delete auxPending[key];
    // another device's words for this page were in the way: they are kept beside it
    if (r && r.kept) toast(t('This page also changed on another device. That version is kept beside it as {file}.', { file: r.kept }), 8000);
  });
}
// An open notes or outline page that nothing has been typed on since it was
// read takes what another device saved. A page with words waiting keeps them;
// its save keeps the other device's version (see aux:write).
async function refreshOpenAux() {
  const ed = $('#aux-editor');
  const bookId = ed.dataset.book;
  const kind = ed.dataset.kind;
  if (!bookId || !kind || !book || book.id !== bookId) return;
  const key = bookId + '/' + kind;
  if (auxDirty || auxPending[key] || auxBase[key] === undefined) return;
  const seq = auxSeq[key] || 0;
  const html = await window.neo.readAux(bookId, kind);
  if (ed.dataset.book !== bookId || ed.dataset.kind !== kind || auxDirty || auxPending[key]) return;
  if ((auxSeq[key] || 0) !== seq || html === auxBase[key]) return;
  auxBase[key] = html;
  ed.innerHTML = html;
}

// The same promise for the JSON beside a book (comments, Darlings): the
// newest list for each file is kept until it is on disk, and a refused
// write is tried again on the next flush instead of being forgotten.
const sidecarPending = {};
// what each sidecar held when this device last read or wrote it: the base a
// change from another device is told apart from a change made here
const sidecarBase = {};
// Both devices changed a list (comments, Darlings): every entry either side
// added stays, an entry either side removed (and the other left alone) goes,
// and an entry both kept keeps this device's version.
function mergeSidecar(base, local, remote, newestFirst) {
  const key = (e) => (e && e.id) || JSON.stringify(e);
  const B = new Map(base.map((e) => [key(e), JSON.stringify(e)]));
  const L = new Set(local.map(key));
  const R = new Map(remote.map((e) => [key(e), e]));
  const out = local.filter((e) => R.has(key(e)) || !B.has(key(e)) || B.get(key(e)) !== JSON.stringify(e));
  const added = remote.filter((e) => !L.has(key(e)) && !B.has(key(e)));
  return newestFirst ? [...added, ...out] : [...out, ...added];
}
function writeSidecar(bookId, name, data) {
  const key = bookId + '/' + name;
  const job = { bookId, name, data, inFlight: false };
  sidecarPending[key] = job;
  return runSidecar(key, job);
}
function runSidecar(key, job) {
  job.inFlight = true;
  const json = JSON.stringify(job.data);
  return Promise.resolve().then(() => window.neo.writeJSON(job.bookId, job.name, job.data)).then((r) => {
    if (sidecarPending[key] === job) delete sidecarPending[key];
    sidecarBase[key] = json;
    return r;
  }, (err) => {
    job.inFlight = false;
    window.neo.logError('save ' + job.name + ': ' + (err && err.message || err));
    throw err;
  });
}
function flushSidecars() {
  for (const key of Object.keys(sidecarPending)) {
    const job = sidecarPending[key];
    if (!job.inFlight) runSidecar(key, job).catch(() => {});
  }
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
      await writeSidecar(book.id, 'darlings', darlings);
      renderDarlings();
    };
    el.appendChild(content);
    el.appendChild(meta);
    wrap.appendChild(el);
  }
}

async function savedBeforeLettingGo(chId) {
  clearTimeout(saveTimers[chId]);
  try {
    await persistChapter(chId);
    return true;
  } catch {
    toast(t('NEO couldn’t save the chapter, so the passage stays in Darlings too'));
    return false;
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
        // the chapter holding it again is saved before Darlings lets it go
        if (!(await savedBeforeLettingGo(d.chapterId))) return;
        darlings = darlings.filter((x) => x.id !== id);
        await writeSidecar(book.id, 'darlings', darlings);
        scrollTo.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
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
  if (!(await savedBeforeLettingGo(chId))) return;
  darlings = darlings.filter((x) => x.id !== id);
  await writeSidecar(book.id, 'darlings', darlings);
  focusChapter(chId);
  toast(t('Original spot is gone — restored to the end of {label}', { label: d.chapterLabel || t('the manuscript') }));
}
