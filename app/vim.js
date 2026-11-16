'use strict';

/* ------------------------------------------------------------------ */
/*  Vim keys (View → Vim Keys, off unless chosen)                      */
/*                                                                      */
/*  The small part of vim that writers use to move around a page. Esc   */
/*  puts the page in moving mode (the caret turns gold), and a book     */
/*  opens in it; letters then                                           */
/*  move instead of type, and i, a, o and friends go back to writing.   */
/*  Esc while moving stays put, as in vim. Keys with ⌘ or Ctrl keep     */
/*  their usual jobs, so none of NEO's shortcuts change.                */
/*                                                                      */
/*    h j k l   left, down, up, right      w b e   by word              */
/*    0 ^ $     start / end of the line    ( )     by sentence          */
/*    { }       by paragraph               gg G    top / end of chapter */
/*    [[ ]]     previous / next chapter    Ctrl-d Ctrl-u  half a screen */
/*    i a I A   write here / after / at the start / at the end of line   */
/*    o O       new paragraph below / above                             */
/*    v         select: motions stretch it, y copies, d or x cuts       */
/*    x         delete the letter under the caret                       */
/*    /         find (Esc goes back to moving, at the match)            */
/*    n N       next / previous match    a number first repeats: 3w     */
/* ------------------------------------------------------------------ */
let vimEnabled = false;
let vimNav = false;        // moving, not typing
let vimVisual = false;     // v: motions stretch the selection
let vimCount = '';
let vimPending = '';       // the g of gg, the [ of [[
function applyVim() {
  if (!vimEnabled) { vimNav = false; vimVisual = false; }
  document.body.classList.toggle('vim-nav', vimNav);
  if (window.neo.vimState) window.neo.vimState(vimEnabled); // the View menu's tick
}
const vimEditor = (el) => el && el.closest && el.closest('.chapter-body, #aux-editor');
// With vim keys on, the page rests in moving mode, as vim starts: a book
// opens that way, and so does the Manuscript or Notes tab when you come back
// to it (#257). i, a or o to write. A click, a title's Enter or the window
// coming back to the front leave the mode as it was.
function vimRest() {
  if (vimEnabled && vimEditor(document.activeElement)) vimSetNav(true);
}
function vimSetNav(on) {
  vimNav = on;
  vimVisual = false;
  vimCount = '';
  vimPending = '';
  if (!on) { const s = window.getSelection(); if (s.rangeCount && !s.isCollapsed) s.collapseToEnd(); }
  applyVim();
}
// the paragraph the caret is in, and the text on either side of it there
function vimBlock() {
  const s = window.getSelection();
  if (!s.rangeCount) return null;
  let n = s.focusNode;
  if (n && n.nodeType === Node.TEXT_NODE) n = n.parentElement;
  const p = n && n.closest && n.closest('p, li, div.chapter-body, #aux-editor');
  return p || null;
}
function vimAround() {
  const s = window.getSelection();
  const block = vimBlock();
  if (!block || !s.rangeCount) return { before: '', after: '' };
  const r = document.createRange();
  r.selectNodeContents(block);
  const b = r.cloneRange();
  b.setEnd(s.focusNode, s.focusOffset);
  const a = r.cloneRange();
  a.setStart(s.focusNode, s.focusOffset);
  return { before: b.toString(), after: a.toString() };
}
const vimClass = (c) => (!c || /\s/.test(c) ? 0 : /[\p{L}\p{M}\p{N}_'’]/u.test(c) ? 1 : 2);
function vimMove(dir, unit, times = 1) {
  const s = window.getSelection();
  for (let i = 0; i < times; i++) s.modify(vimVisual ? 'extend' : 'move', dir, unit);
}
// w, b, e as vim counts them: letters, then punctuation, are words; space isn't
function vimWord(key) {
  const { before, after } = vimAround();
  const chars = [...(key === 'b' ? before : after)];
  let n = 0;
  if (key === 'w') {
    const start = vimClass(chars[0]);
    while (n < chars.length && start && vimClass(chars[n]) === start) n++;
    while (n < chars.length && vimClass(chars[n]) === 0) n++;
    if (n >= chars.length) { vimMove('forward', 'paragraphboundary'); vimMove('forward', 'character'); return; }
  } else if (key === 'e') {
    n = 1;
    while (n < chars.length && vimClass(chars[n]) === 0) n++;
    const cls = vimClass(chars[n]);
    while (n + 1 < chars.length && vimClass(chars[n + 1]) === cls) n++;
    if (n >= chars.length) { vimMove('forward', 'paragraphboundary'); return; }
  } else {
    chars.reverse();
    while (n < chars.length && vimClass(chars[n]) === 0) n++;
    const cls = vimClass(chars[n]);
    while (n < chars.length && cls && vimClass(chars[n]) === cls) n++;
    if (!chars.length) { vimMove('backward', 'character'); vimMove('backward', 'paragraphboundary'); return; }
  }
  vimMove(key === 'b' ? 'backward' : 'forward', 'character', n);
}
// a line or paragraph move that can't go further steps into the next chapter
function vimLine(dir, unit) {
  const s = window.getSelection();
  const at = s.rangeCount ? [s.focusNode, s.focusOffset] : null;
  vimMove(dir, unit);
  if (vimVisual || !at || s.focusNode !== at[0] || s.focusOffset !== at[1]) return;
  const ed = vimEditor(document.activeElement);
  if (!ed || !ed.classList.contains('chapter-body')) return;
  const order = book.chapterOrder;
  const i = order.indexOf(currentChapterId) + (dir === 'forward' ? 1 : -1);
  if (i < 0 || i >= order.length) return;
  if (dir === 'forward') focusChapterStart(order[i]);
  else {
    const nb = document.querySelector(`.chapter[data-id="${order[i]}"] .chapter-body`);
    if (!nb || !nb.isContentEditable) return;
    nb.focus({ preventScroll: true });
    const r = document.createRange();
    r.selectNodeContents(nb);
    r.collapse(false);
    s.removeAllRanges();
    s.addRange(r);
    currentChapterId = order[i];
    highlightNav();
  }
  revealCaret();
}
// vim's selections take in the letter under the caret, too
function vimInclusive() {
  const s = window.getSelection();
  if (!s.rangeCount || s.isCollapsed) return;
  const r = document.createRange();
  r.setStart(s.anchorNode, s.anchorOffset);
  r.setEnd(s.focusNode, s.focusOffset);
  if (!r.collapsed) s.modify('extend', 'forward', 'character'); // anchor first: a forward selection
}
function vimHalfPage(dir) {
  const sc = $('#paper-scroll');
  if (!sc || currentTab !== 'manuscript') return;
  const box = sc.getBoundingClientRect();
  sc.scrollTop += dir * sc.clientHeight / 2;
  // the caret follows to the same place on the screen
  const r = document.caretRangeFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  const ed = r && vimEditor(r.startContainer.nodeType === Node.TEXT_NODE ? r.startContainer.parentElement : r.startContainer);
  if (!ed) return;
  ed.focus({ preventScroll: true });
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}
// n and N: the next or previous place the last search found, from the caret,
// round to the top (or bottom) when the tab runs out, as vim does
function vimSearchAgain(dir, times = 1) {
  const s = window.getSelection();
  const found = findRanges($('#search-input').value);
  if (!found.length || !s.rangeCount) return;
  const here = s.getRangeAt(0);
  // the first match past the caret (or the last one before it)
  let i = dir > 0
    ? found.findIndex((r) => r.compareBoundaryPoints(Range.START_TO_START, here) > 0)
    : found.findLastIndex((r) => r.compareBoundaryPoints(Range.START_TO_START, here) < 0);
  if (i < 0) i = dir > 0 ? 0 : found.length - 1;
  i = (((i + dir * (times - 1)) % found.length) + found.length) % found.length;
  const r = found[i];
  const ed = editableOf(r);
  if (!ed) return;
  if (vimVisual && ed.contains(s.anchorNode)) { s.extend(r.startContainer, r.startOffset); return; }
  if (document.activeElement !== ed) ed.focus({ preventScroll: true });
  r.collapse(true);
  s.removeAllRanges();
  s.addRange(r);
}
// Moving, a key counts by where it sits on the keyboard, named as on a US
// one, whatever layout is on: on Russian or Greek the key under the right
// index finger is still j, and Shift+4 is still $. A dead key, and a key an
// input method takes (Process), count by their place too.
const VIM_US = {
  Space: [' ', ' '], Minus: ['-', '_'], Equal: ['=', '+'], BracketLeft: ['[', '{'], BracketRight: [']', '}'],
  Backslash: ['\\', '|'], Semicolon: [';', ':'], Quote: ["'", '"'], Backquote: ['`', '~'],
  Comma: [',', '<'], Period: ['.', '>'], Slash: ['/', '?']
};
for (const c of 'abcdefghijklmnopqrstuvwxyz') VIM_US['Key' + c.toUpperCase()] = [c, c.toUpperCase()];
[...')!@#$%^&*('].forEach((shifted, d) => { VIM_US['Digit' + d] = [String(d), shifted]; });
function vimKeyOf(e) {
  const us = VIM_US[e.code];
  if (!us || (e.key.length > 1 && e.key !== 'Dead' && e.key !== 'Process')) return e.key;
  const caps = /^Key/.test(e.code) && e.getModifierState('CapsLock');
  return us[e.shiftKey !== caps ? 1 : 0];
}
function vimKey(e) {
  const k = vimKeyOf(e);
  // counts: 3w, 12j (a 0 on its own is the start of the line)
  if (/^[0-9]$/.test(k) && (k !== '0' || vimCount)) { vimCount += k; return; }
  const times = Math.max(1, Math.min(999, parseInt(vimCount || '1', 10)));
  vimCount = '';
  const pending = vimPending;
  vimPending = '';
  if (pending === 'g') { if (k === 'g') vimMove('backward', 'documentboundary'); revealCaret(); return; }
  if (pending === '[' || pending === ']') {
    if (k === pending) gotoChapter(k === ']' ? times : -times);
    return;
  }
  const back = 'backward', fwd = 'forward';
  switch (k) {
    case 'h': case 'Backspace': vimMove(back, 'character', times); break;
    case 'l': case ' ': vimMove(fwd, 'character', times); break;
    case 'j': case 'Enter': for (let i = 0; i < times; i++) vimLine(fwd, 'line'); break;
    case 'k': for (let i = 0; i < times; i++) vimLine(back, 'line'); break;
    case 'w': case 'b': case 'e': for (let i = 0; i < times; i++) vimWord(k); break;
    case '0': case '^': vimMove(back, 'lineboundary'); break;
    case '$': vimMove(fwd, 'lineboundary'); break;
    case '(': vimMove(back, 'sentence', times); break;
    case ')': vimMove(fwd, 'sentence', times); break;
    case '{': for (let i = 0; i < times; i++) vimLine(back, 'paragraph'); break;
    case '}': for (let i = 0; i < times; i++) vimLine(fwd, 'paragraph'); break;
    case 'G': vimMove(fwd, 'documentboundary'); break;
    case 'g': case '[': case ']': vimPending = k; return;
    case 'v': {
      vimVisual = !vimVisual;
      if (!vimVisual) window.getSelection().collapseToEnd();
      break;
    }
    case 'y':
      if (vimVisual) { vimInclusive(); document.execCommand('copy'); vimVisual = false; window.getSelection().collapseToStart(); }
      break;
    case 'd': case 'x': case 'Delete':
      if (vimVisual) { vimInclusive(); document.execCommand('cut'); vimVisual = false; }
      else if (k !== 'd') for (let i = 0; i < times; i++) document.execCommand('forwardDelete');
      break;
    case 'i': vimSetNav(false); break;
    case 'a': vimSetNav(false); vimMove(fwd, 'character'); break;
    case 'I': vimSetNav(false); vimMove(back, 'lineboundary'); break;
    case 'A': vimSetNav(false); vimMove(fwd, 'lineboundary'); break;
    case 'o': vimSetNav(false); vimMove(fwd, 'paragraphboundary'); document.execCommand('insertParagraph'); break;
    case 'O':
      vimSetNav(false);
      vimMove(back, 'paragraphboundary');
      document.execCommand('insertParagraph');
      vimMove(back, 'character');
      break;
    case '/': vimSetNav(false); openSearch(true); return;
    case 'n': case 'N': vimSearchAgain(k === 'n' ? 1 : -1, times); break;
    default: return;
  }
  revealCaret();
}
// first in line for keys in the page and the notes, ahead of NEO's own
// typing rules, and only while vim keys are on
window.addEventListener('keydown', (e) => {
  if (!vimEnabled) return;
  const ed = vimEditor(e.target);
  if (!ed) { if (vimNav) vimSetNav(false); return; }
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  if (!vimNav) {
    if (e.isComposing || e.keyCode === 229) return; // an input method's, while writing
    // Esc while writing: start moving
    if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      vimSetNav(true);
    }
    return;
  }
  if (e.key === 'Escape') {
    // vim hands press Esc out of habit: here it only lets go of a selection
    // or a half-typed command, and never sends the book back to the shelf
    e.preventDefault();
    e.stopPropagation();
    if (vimVisual) window.getSelection().collapseToEnd();
    vimVisual = false;
    vimCount = '';
    vimPending = '';
    return;
  }
  const k = vimKeyOf(e);
  // Ctrl-d / Ctrl-u move half a screen; other modified keys keep their jobs
  if (e.ctrlKey && !e.metaKey && !e.altKey && (k === 'd' || k === 'u')) {
    e.preventDefault();
    e.stopPropagation();
    vimHalfPage(k === 'd' ? 1 : -1);
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey || e.getModifierState('AltGraph')) return;
  // arrows, Home, End, Page Up and Down still move as they always do
  if (k.length > 1 && k !== 'Enter' && k !== 'Backspace' && k !== 'Delete' && k !== 'Tab') return;
  e.preventDefault();
  e.stopPropagation();
  if (ed.classList.contains('chapter-body')) typewriterByKeyboard = true; // typewriter scrolling follows
  vimKey(e);
}, true);
// a click into the page, or the window losing focus, leaves the mode as it was;
// leaving the page for a title or the notes' own fields lets it go
document.addEventListener('focusin', (e) => {
  if (vimNav && !vimEditor(e.target)) vimSetNav(false);
});
// Moving, nothing a keyboard types lands in the text. What ⌥ or AltGr makes
// is refused. A dead key or an input method reaches the page after the
// system has begun composing with it, which can't be refused, so the
// composition is ended as soon as it starts (moving the focus away and
// back commits it and resets the composer), and its text comes back out.
document.addEventListener('beforeinput', (e) => {
  if (vimNav && vimEditor(e.target) && e.inputType === 'insertText') e.preventDefault();
}, true);
document.addEventListener('compositionstart', (e) => {
  const ed = vimNav && vimEditor(e.target);
  const s = window.getSelection();
  if (!ed || !s.rangeCount) return;
  const at = s.getRangeAt(0).cloneRange();
  const before = ed.innerHTML;
  // setting the selection ends the engine's typing run, so the composed
  // text is an undo step of its own and not part of the last x
  s.removeAllRanges();
  s.addRange(at);
  setTimeout(() => {
    if (document.activeElement !== ed) return;
    ed.blur();
    ed.focus({ preventScroll: true });
    if (ed.innerHTML !== before) document.execCommand('undo');
    s.removeAllRanges();
    s.addRange(at);
  }, 0);
}, true);

// Escape also exits regular fullscreen from the bookshelf
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !$('#editor-view').hidden) return;
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  window.neo.fullscreenEscape();
});

// ---- full screen keys: ⌘Enter (Ctrl+Enter) everywhere, and F11 off the Mac,
// where most programs use it (on a Mac, F11 shows the desktop)
function isFullScreenKey(e, mac) {
  if (e.key === 'F11') return !mac && !e.repeat && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
  return e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey;
}
// ---- end of full screen keys ----

// toggle fullscreen from anywhere
document.addEventListener('keydown', (e) => {
  if (!isFullScreenKey(e, IS_MAC)) return;
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  e.preventDefault();
  window.neo.fullscreenToggle();
});

// ---- carried alignment rules: a new chapter opens set as the story is (#426) ----
// The alignment most of a chapter's prose is set in: '' for left (NEO's
// default), null for a chapter with no prose yet. Breaks, outline ghosts,
// poetry, flush lines, script lines and empty lines don't count. A tie goes
// to the later paragraph.
function chapterAlign(html) {
  const count = {};
  let best = null;
  for (const m of String(html || '').matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
    const cls = (/\bclass="([^"]*)"/.exec(m[1]) || [])[1] || '';
    if (/(^|\s)(scene-break|ghost|poetry|flush|litrpg|sp-[\w-]+)(\s|$)/.test(cls)) continue;
    if (!m[2].replace(/<[^>]*>|&nbsp;|\s/g, '')) continue;
    let a = (/text-align:\s*([a-z]+)/.exec(m[1]) || [])[1] || '';
    if (!['center', 'right', 'justify'].includes(a)) a = '';
    count[a] = (count[a] || 0) + 1;
    if (best === null || count[a] >= count[best]) best = a;
  }
  return best;
}
// A new chapter's empty first line, set the way the nearest story with
// words in it is: the chapters before it first, then the ones after (a new
// first chapter). Pages such as a dedication or a part are passed over.
function newChapterHtml(order, at, htmlOf, story) {
  for (const c of [...order.slice(0, at).reverse(), ...order.slice(at)]) {
    const a = story(c) ? chapterAlign(htmlOf(c)) : null;
    if (a !== null) return a ? `<p style="text-align: ${a};"><br></p>` : '<p><br></p>';
  }
  return '<p><br></p>';
}
// ---- end of carried alignment rules ----

function createChapterAt(idx) {
  const chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  // (from the order as it stands, before the new chapter joins it)
  const first = isScript() ? '<p><br></p>' : newChapterHtml(book.chapterOrder, idx, (c) => chapterHTML[c], (c) => isStory(c));
  book.chapterOrder.splice(idx, 0, chId);
  chapterHTML[chId] = first;
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
  if (book.chapterKinds) delete book.chapterKinds[chId];
  stickies = stickies.filter((s) => s.chapterId !== chId);
  writeSidecar(book.id, 'stickies', stickies);
  const bookId = book.id;
  renderChapters();
  renderStickies();
  // book.json lets go of the chapter before its file goes
  await saveMeta();
  if (book && book.id === bookId) await window.neo.deleteChapter(bookId, chId);
}

function focusChapter(chId) {
  const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  if (!body) return;
  if (!body.isContentEditable) { showEntry(chId); return; }
  body.focus();
  // caret at the very end
  const range = document.createRange();
  range.selectNodeContents(body);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  body.closest('.chapter').scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  currentChapterId = chId;
  highlightNav();
}
