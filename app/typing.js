'use strict';

/* ================================================================== */
/*  EDITOR — typing                                                    */
/* ================================================================== */

// a drag that began on NEO's own page (moving words within the book)
let dragFromInside = false;
document.addEventListener('dragstart', () => { dragFromInside = true; }, true);
document.addEventListener('dragend', () => { dragFromInside = false; }, true);
document.addEventListener('drop', () => { setTimeout(() => { dragFromInside = false; }, 0); }, true);

// when a real key last went down (not an input method's 229): the characters
// that follow it by themselves were typed on a key the page already read
let lastRealKeyAt = 0;
if (IS_POCKET) document.addEventListener('keydown', (e) => { if (e.keyCode !== 229 && e.key !== 'Unidentified') lastRealKeyAt = Date.now(); }, true);

// ---- typing style rules: what ⌘B, ⌘I, ⌘U and ⌘⇧S leave at the caret (#430) ----
// Turned on or off with nothing selected, they style only the letters typed
// next, and the engine forgets that as soon as the selection is set again,
// even to the same place. move sets it; whatever it undid is turned back,
// and the commands that had to be run again are returned.
const TYPING_STYLES = ['bold', 'italic', 'underline', 'strikeThrough'];
function keepTypingStyle(doc, move) {
  const was = TYPING_STYLES.map((cmd) => doc.queryCommandState(cmd));
  move();
  const back = TYPING_STYLES.filter((cmd, i) => doc.queryCommandState(cmd) !== was[i]);
  for (const cmd of back) doc.execCommand(cmd);
  return back;
}
// ---- end of typing style rules ----

function wireChapterBody(body, chId) {
  body.addEventListener('focus', () => { currentChapterId = chId; updateCounters(); highlightNav(); });

  // ⌘Z takes back what was typed since the last pause, not a whole page of
  // it: a second of quiet closes the engine's undo run (the caret stays put).
  // Not on a phone, where the keyboard keeps its own run of words in hand.
  let runTimer = null;
  const endTypingRunSoon = () => {
    if (IS_POCKET) return;
    clearTimeout(runTimer);
    runTimer = setTimeout(() => {
      if (composing || document.activeElement !== body) return;
      const sel = window.getSelection();
      if (!sel.rangeCount || !sel.isCollapsed || !body.contains(sel.anchorNode)) return;
      // setting the caret again also drops what ⌘I or ⌘B just turned on or
      // off for the next letters, so they come back with it (#430)
      const sc = $('#paper-scroll');
      const keep = sc.scrollTop;
      if (keepTypingStyle(document, () => sel.collapse(sel.anchorNode, sel.anchorOffset)).length) sc.scrollTop = keep;
    }, 1000);
  };
  body.addEventListener('input', () => {
    sealUndoOnEdit(); // chapterHTML is still the text from before this edit
    breakRun = 0; // fresh typing: ⌘Z belongs to the engine again
    if (isScript()) scriptInput(body);
    markDialogueOpening(body);
    chapterHTML[chId] = captureBody(body);
    wordCache[chId] = null;
    scheduleChapterSave(chId);
    if (nbspMarksEnabled) paintNonBreakingMarks();
    if (spellOn) scheduleSpellRescan(chId, body);
    updateCounters();
    scheduleNavRefresh();
    if (!typewriterEnabled) revealCaret();
    if (body.querySelector('.fn') || body.parentElement.querySelector(':scope > .fn-list')) queueFootnoteList(null);
    endTypingRunSoon();
  });
  // paste without formatting
  body.addEventListener('paste', (e) => {
    // a script's lines keep their elements; a script pasted as text is read
    if (isScript() && spPaste(e, body, chId)) return;
    e.preventDefault();
    insertClip(e.clipboardData);
  });
  // Text dragged in from another app (a browser, Word) is cleaned the same
  // way as a paste, instead of landing with its fonts, colours and links.
  // A drag within NEO's own pages is left to the engine.
  body.addEventListener('drop', (e) => {
    if (dragFromInside || isScript() || !e.dataTransfer || (e.dataTransfer.files && e.dataTransfer.files.length)) return;
    const types = [...(e.dataTransfer.types || [])];
    if (!types.includes('text/html') && !types.includes('text/plain')) return;
    e.preventDefault();
    const at = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (at && body.contains(at.startContainer)) {
      body.focus({ preventScroll: true });
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(at);
    }
    insertClip(e.dataTransfer);
  });
  function insertClip(data) {
    writeOverGhost(); // pasted words over a gray note are prose, like typed ones
    const html = data.getData('text/html');
    const text = data.getData('text/plain');
    // into a LitRPG box: line for line, every space kept
    const into = caretBlock(body);
    if (into && into.classList.contains('litrpg')) { pasteIntoBox(body, chId, html, text); return; }
    // a box copied from NEO stays a box
    if (html && /<p\b[^>]*\bclass="[^"]*\blitrpg\b/.test(html) && pasteBoxesFromNeo(body, chId, html)) {
      reconcileMarks();
      return;
    }
    // hyphens set as dialogue dashes, the same as typing them
    const edges = caretEdges(body);
    const quotes = isScript() ? null : { q: bookQuotes(body), sq: singleQuotes(body) };
    if (html) {
      document.execCommand('insertHTML', false, cleanPasteHtml(html, { style: dashStyle(), quotes, ...edges }));
      // the engine wraps inserted HTML (and its neighbours) in style spans
      if (body.querySelector('span:not(.ph-mark):not(.fn)')) {
        const caret = captureCaret();
        stripJunkSpans(body);
        restoreCaret(caret);
        syncChapter(body, chId); // what's saved is the cleaned paragraph
      }
      reconcileMarks();
    } else if (text) {
      const parts = text.replace(/\r/g, '').split(/\n+/).filter((p) => p.trim());
      parts.forEach((p, i) => {
        if (i > 0) document.execCommand('insertParagraph');
        // the clipboard's own space at either end stays when the paste lands
        // mid-line ("the " + "big " + "dog"), and goes at a paragraph's edge
        const lead = i === 0 && !edges.start && !edges.spaced && /^\s/.test(p) ? ' ' : '';
        const tail = i === parts.length - 1 && !edges.end && !edges.spacedAfter && /\s$/.test(p) ? ' ' : '';
        let line = lead + dialogueDashes(p.trim(), dashStyle(), { start: i > 0 || edges.start, end: i < parts.length - 1 || edges.end, spaced: i === 0 && edges.spaced }) + tail;
        if (quotes) line = incomingQuotes(line, quotes.q, quotes.sq, i === 0 ? edges.before : '');
        // plain text written in Markdown keeps its *italics* and **bold**
        const styled = markdownOff() ? null : markdownInline(line);
        if (styled) {
          document.execCommand('insertHTML', false, styled);
          stripJunkSpans(body); // the engine wraps inserted HTML in style spans
        } else document.execCommand('insertText', false, line);
      });
    }
  }
  // While macOS composes input, shortcuts stand down completely.
  let composing = false;
  body.addEventListener('compositionstart', () => { composing = true; });
  body.addEventListener('compositionend', () => { composing = false; });
  // An Android keyboard (the phone's own, or a Bluetooth one through it) hands
  // the page its characters as input, not as keys: keydown says keyCode 229
  // and no key, so the rules for quotes, dashes and capitals never saw them
  // (#368). Here the same rules run on the character as it arrives. A real
  // key, which they already had, is left alone.
  if (IS_POCKET) {
    body.addEventListener('beforeinput', (e) => {
      if (e.inputType !== 'insertText' || !e.cancelable || composing || !e.data || [...e.data].length !== 1) return;
      if (Date.now() - lastRealKeyAt < 150) return;
      let stopped = false;
      smartKeys({
        key: e.data, code: '', keyCode: 0, isComposing: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
        get defaultPrevented() { return stopped; },
        preventDefault() { stopped = true; e.preventDefault(); },
        stopPropagation() {}
      }, body);
    });
  }
  body.addEventListener('keydown', (e) => {
    // An input method mid-word owns the keys. Its marker (keyCode 229) also
    // rides on Enter with nothing being composed, as on GNOME (Wayland, IBus),
    // where it kept ⇧Enter and ⌘⇧Enter from ever reaching NEO.
    if (composing || e.isComposing || (e.keyCode === 229 && e.key !== 'Enter')) return;
    // count consecutive Enters — the double/triple rhythm works mid-sentence
    if (e.key === 'Enter' && !e.shiftKey) enterRun++;
    else enterRun = 0;
    // ⌘Z right after a break operation undoes the break via the structural
    // stack — the engine's own undo never saw it and would corrupt the page
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && keyLetter(e) === 'z' && breakRun > 0 && undoStack.length) {
      e.preventDefault();
      breakRun--;
      structuralUndo();
      return;
    }
    if (styleKeepScroll(e)) return;
    // a script: its own Enter, Tab and ⌘1–7; no breaks, poetry or chapters
    if (isScript()) {
      if (scriptKey(e, body)) return;
      if (spaceSafeDelete(e, body, chId)) return;
      if (emptyChapterBackspace(e, body, chId)) return;
      if (chapterStartBackspace(e, body, chId)) return;
      if (guardMarkerDelete(e, body, chId)) return;
      smartKeys(e, body);
      return;
    }
    if (litrpgEnter(e, body, chId)) return;
    if (litrpgBackspace(e, body, chId)) return;
    if (handlePoetry(e, body, chId)) return;
    if (handleFlush(e, body, chId)) return;
    if (poetryBackspace(e, body, chId)) return;
    if (sceneBreakDelete(e, body, chId)) return;
    if (spaceSafeDelete(e, body, chId)) return;
    if (emptyChapterBackspace(e, body, chId)) return;
    if (chapterStartBackspace(e, body, chId)) return;
    if (guardMarkerDelete(e, body, chId)) return;
    // "Espere -" then Enter: the dash goes in before the paragraph ends
    if (e.key === 'Enter') dialogueDashKey(e, body);
    if (handleEnter(e, body, chId)) return;
    if (handleTabSpacing(e)) return;
    smartKeys(e, body);
  });
  body.addEventListener('mousedown', () => { enterRun = 0; });
  body.addEventListener('click', (e) => {
    const mark = e.target.closest('.ph-mark');
    if (mark) focusSticky(mark.dataset.sid);
    const fn = e.target.closest('.fn');
    if (fn) openFootnote(fn);
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
  // A line break the engine is about to make on its own is ⇧Enter that the
  // keys above never saw (an input method can carry it past them): it
  // becomes the flush paragraph ⇧Enter makes, or the next line of a poem.
  body.addEventListener('beforeinput', (e) => {
    if (e.inputType !== 'insertLineBreak' || e.defaultPrevented) return;
    if (isScript()) { e.preventDefault(); return; } // a script's lines are its elements
    const key = { key: 'Enter', shiftKey: true, metaKey: false, ctrlKey: false, altKey: false, preventDefault: () => e.preventDefault() };
    if (litrpgEnter(key, body, chId)) return;
    if (!handlePoetry(key, body, chId)) handleFlush(key, body, chId);
  });
  // the moment writing hits a ghost, it becomes prose
  // (it keeps its data-sec-id so the outline knows it's been written)
  const ghostWas = {}; // each ghost's own words, from before it was written over
  // the ghost the caret is in, also when the caret sits between paragraphs
  // (a click in the margin, the arrow keys) rather than in the ghost's text
  function ghostAtCaret() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    const c = r.startContainer;
    const near = c.nodeType === Node.ELEMENT_NODE ? [c.childNodes[r.startOffset], c.childNodes[r.startOffset - 1], c] : [c];
    for (const n of near) {
      const el = n && (n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement);
      const g = el && el.closest ? el.closest('p.ghost') : null;
      if (g && body.contains(g)) return g;
    }
    return null;
  }
  // Writing on a ghost replaces it whole, however the caret got there: a
  // click selects it, and so does any key that types (the arrow keys, Home,
  // a click in the margin leave the caret inside the note's words, and the
  // typing was added to them)
  function selectGhost(ghost) {
    const sel = window.getSelection();
    if (sel.rangeCount && !sel.isCollapsed && sel.toString() === ghost.textContent) return;
    const r = document.createRange();
    r.selectNodeContents(ghost);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  function writeOverGhost() {
    const ghost = ghostAtCaret();
    if (!ghost) return;
    const secId = ghost.dataset.secId;
    if (secId && !(secId in ghostWas)) ghostWas[secId] = ghost.textContent;
    ghost.classList.remove('ghost');
  }
  body.addEventListener('beforeinput', (e) => {
    // undo and redo give words back; they don't write
    if (e.inputType && e.inputType.startsWith('history')) return;
    const ghost = ghostAtCaret();
    if (ghost && e.inputType === 'insertText' && e.cancelable && typeof e.data === 'string') {
      const sel = window.getSelection();
      if (!(sel.rangeCount && !sel.isCollapsed && sel.toString() === ghost.textContent)) {
        // the typed letters take the ghost's place, the caret after them
        e.preventDefault();
        writeOverGhost();
        ghost.textContent = e.data;
        const r = document.createRange();
        r.selectNodeContents(ghost);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
        body.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: e.data }));
        return;
      }
    }
    if (ghost && e.inputType && e.inputType.startsWith('insert')) selectGhost(ghost);
    writeOverGhost();
  });
  // NEO's own typing aids (smart quotes, capitals) write without a
  // beforeinput: a key that types a letter over a ghost selects it whole and
  // makes it prose first (an input method's first key reads Process)
  body.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.isComposing) return;
    const types = (e.key && e.key.length === 1) || e.key === 'Process' || e.keyCode === 229;
    if (!types) return;
    const ghost = ghostAtCaret();
    if (!ghost) return;
    selectGhost(ghost);
    writeOverGhost();
  }, true);
  // …and when undo brings a ghost's words back, the ghost comes back with
  // them: the class isn't part of the engine's undo, so it follows the text
  body.addEventListener('input', (e) => {
    if (!e.inputType || !e.inputType.startsWith('history')) return;
    for (const p of body.querySelectorAll('p[data-sec-id]')) {
      const was = ghostWas[p.dataset.secId];
      if (was !== undefined) p.classList.toggle('ghost', p.textContent === was);
    }
  });
}

// the contents have nothing to type in: going there is only looking
function showEntry(chId) {
  const sec = document.querySelector(`.chapter[data-id="${chId}"]`);
  if (!sec) return;
  if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur();
  sec.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  currentChapterId = chId;
  highlightNav();
  updateCounters();
}

function focusChapterStart(chId) {
  const nb = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  if (!nb) return;
  if (!nb.isContentEditable) { showEntry(chId); return; }
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

// The caret at the last character of a chapter, inside its last paragraph,
// with the view kept where the writer is — not thrown to the chapter's top
function focusChapterEnd(chId, reveal = true) {
  const nb = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  if (!nb) return;
  if (!nb.isContentEditable) { showEntry(chId); return; }
  nb.focus({ preventScroll: true });
  const nr = document.createRange();
  const paras = nb.querySelectorAll('p');
  const last = paras[paras.length - 1];
  if (last) {
    // the last text node that's really editable (skips placeholders and ghosts)
    const walk = document.createTreeWalker(last, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && n.parentElement.isContentEditable
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    let text = null;
    for (let n = walk.nextNode(); n; n = walk.nextNode()) text = n;
    if (text) nr.setStart(text, text.length);
    else nr.setStart(last, 0); // an empty last line: before its <br>
  } else {
    nr.selectNodeContents(nb);
  }
  nr.collapse(true);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(nr);
  currentChapterId = chId;
  highlightNav();
  if (reveal) revealCaret();
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
  const was = caretHeight();
  if (idx > 0) {
    const prev = book.chapterOrder[idx - 1];
    deleteChapterQuiet(chId).then(() => { focusChapterEnd(prev); resetNativeUndo(); keepCaretHeight(was); });
  } else {
    // an empty chapter 1 dissolves too — the caret lands at the top of
    // what just became the new chapter 1
    const next = book.chapterOrder[1];
    deleteChapterQuiet(chId).then(() => { focusChapterStart(next); resetNativeUndo(); keepCaretHeight(was); });
  }
  return true;
}

// ⌘B / ⌘I applied by hand: the engine's native handling scrolls the
// selection "into view" and mis-measures NEO's transformed page column,
// throwing the reader to the top of the screen. Style, don't scroll.
// The letter a shortcut's key stands for: the character it types, so ⌘B
// is B on Dvorak, BÉPO and AZERTY wherever their B sits (#546, #536); on a
// keyboard whose key types no Latin letter (Russian, Greek, Ukrainian), the
// letter at that place on a US keyboard, as the system's own shortcuts do.
function keyLetter(e) {
  const k = String(e.key || '').toLowerCase();
  if (/^[a-z]$/.test(k)) return k;
  return /^Key[A-Z]$/.test(e.code || '') ? e.code.slice(3).toLowerCase() : '';
}
function styleKeepScroll(e) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
  const cmd = e.shiftKey
    ? (keyLetter(e) === 's' ? 'strikeThrough' : null)
    : ({ b: 'bold', i: 'italic', u: 'underline' })[keyLetter(e)];
  if (!cmd) return false;
  e.preventDefault();
  const sc = $('#paper-scroll');
  const keep = sc.scrollTop;
  document.execCommand(cmd);
  sc.scrollTop = keep;
  requestAnimationFrame(() => { sc.scrollTop = keep; });
  return true;
}

// the piece of a chapter's text (one page's worth) nearest a point
function nearestPageText(x, y) {
  let best = null;
  for (const body of document.querySelectorAll('#chapters .chapter-body')) {
    if (!body.isContentEditable) continue;
    for (const rect of body.getClientRects()) {
      const dx = Math.max(rect.left - x, 0, x - rect.right);
      const dy = Math.max(rect.top - y, 0, y - rect.bottom);
      const d = dx * dx + dy * dy;
      if (!best || d < best.d) best = { d, body, rect };
    }
  }
  return best;
}

// A click on the page's empty space puts the caret where it means: below
// the text, at the end of that chapter; in the margin beside a line, on that
// line; above the first line, at the start. Margins, the space under the
// last line, the gaps between chapters and the dark room around the pages
// all count.
function caretFromEmptyClick(e) {
  if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!book || currentTab !== 'manuscript') return;
  const t = e.target;
  if (!t || !t.closest || t.closest('[contenteditable="true"], input, textarea, button, a, .pop-menu, .ph-mark, #title-page')) return;
  if (t.closest('.chapter-head') && t !== t.closest('.chapter-head')) return; // its number and title answer clicks themselves
  if (!(t.matches('.chapter, .chapter-head, #chapters, #paper, #paper-scroll, #editor-view'))) return;
  if (document.body.classList.contains('paged')) {
    // cut into pages: the nearest page's text takes the click, margins and gaps included
    const hit = nearestPageText(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    const { body: pageBody, rect: box } = hit;
    const pageChId = pageBody.closest('.chapter').dataset.id;
    const px = Math.min(Math.max(e.clientX, box.left + 2), box.right - 2);
    const py = Math.min(Math.max(e.clientY, box.top + 2), box.bottom - 2);
    const at = document.caretRangeFromPoint(px, py);
    if (!at || !pageBody.contains(at.startContainer)) { focusChapter(pageChId); return; }
    pageBody.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(at);
    currentChapterId = pageChId;
    highlightNav();
    updateCounters();
    return;
  }
  // the chapter whose page this is, or the one just above a gap
  let sec = t.closest('.chapter');
  if (!sec) {
    for (const c of document.querySelectorAll('#chapters .chapter')) {
      if (c.getBoundingClientRect().top <= e.clientY) sec = c; else break;
    }
  }
  if (!sec) return;
  const body = sec.querySelector('.chapter-body');
  if (!body || !body.isContentEditable) return;
  const box = body.getBoundingClientRect();
  const chId = sec.dataset.id;
  e.preventDefault();
  if (e.clientY < box.top) { focusChapterStart(chId); return; }
  // below the text: the caret at its end, and the page stays where it is
  // (focusChapter's focus() scrolled up to the chapter's top, a page or two
  // on a half-empty sheet, #354)
  if (e.clientY > box.bottom) { focusChapterEnd(chId, false); updateCounters(); return; }
  const x = Math.min(Math.max(e.clientX, box.left + 2), box.right - 2);
  const r = document.caretRangeFromPoint(x, e.clientY);
  if (!r || !body.contains(r.startContainer)) { focusChapterEnd(chId, false); updateCounters(); return; }
  body.focus({ preventScroll: true });
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
  currentChapterId = chId;
  highlightNav();
  updateCounters();
}
$('#editor-view').addEventListener('mousedown', caretFromEmptyClick);

// ⌥⌘↓ / ⌥⌘↑ (Ctrl+Alt on Windows and Linux): the start of the next or the
// previous chapter, without opening the pane
function gotoChapter(step) {
  if (!book || $('#editor-view').hidden || !book.chapterOrder.length) return;
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  if (currentTab !== 'manuscript') switchTab('manuscript');
  const order = book.chapterOrder;
  let at = order.indexOf(currentChapterId);
  if (at < 0) at = step > 0 ? -1 : order.length;
  const to = Math.max(0, Math.min(order.length - 1, at + step));
  if (to === at) return;
  const sec = document.querySelector(`.chapter[data-id="${order[to]}"]`);
  if (!sec) return;
  focusChapterStart(order[to]);
  sec.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
}

// The caret's line on screen, or null when the caret isn't on the page
function caretRect() {
  const sc = $('#paper-scroll');
  const sel = window.getSelection();
  if (!sc || !sel.rangeCount || !sc.contains(sel.anchorNode)) return null;
  const r = sel.getRangeAt(0).cloneRange();
  r.collapse(false);
  const node = r.endContainer.nodeType === Node.ELEMENT_NODE ? r.endContainer : r.endContainer.parentElement;
  // an empty line has no text to measure: its paragraph does. (Asked for a
  // caret's box there, a Mac answered with the line above it, and a line
  // made at the window's foot stayed just out of sight.)
  const line = node && node.closest ? node.closest('p') : null;
  if (line && line.textContent === '') return line.getBoundingClientRect();
  // a letter's box beside the caret, where there is one: a bare caret at
  // the top of a page is measured at the top of its paragraph, on the page
  // before (#453), and on a Mac that sent the typewriter a page away
  if (r.endContainer.nodeType === Node.TEXT_NODE) {
    const t = r.endContainer;
    const at = r.endOffset;
    const ch = document.createRange();
    if (at < t.length && t.data[at] !== '\n') { ch.setStart(t, at); ch.setEnd(t, at + 1); } else if (at > 0) { ch.setStart(t, at - 1); ch.setEnd(t, at); }
    if (!ch.collapsed) {
      const box = [...ch.getClientRects()].pop();
      if (box && box.height) return box;
    }
  }
  const rect = r.getBoundingClientRect();
  if (rect.height) return rect;
  return node ? node.getBoundingClientRect() : null;
}

// A chapter split, merged or taken away redraws the chapters. The writer's
// line stays at the height it had in the window, so the page doesn't jump:
// caretHeight() before the change, keepCaretHeight(it) after.
// (The browser's own scroll anchoring is paused meanwhile: it moves the page
// to make up for what changed above the window, after NEO has already put
// the line back, and the page landed a line or two off.)
function caretHeight() {
  const sc = $('#paper-scroll');
  sc.style.overflowAnchor = 'none';
  clearTimeout(caretHeight.t);
  caretHeight.t = setTimeout(() => { sc.style.overflowAnchor = ''; }, 3000); // (never left off)
  const rect = caretRect();
  return rect ? rect.top - sc.getBoundingClientRect().top : null;
}
function keepCaretHeight(was) {
  const sc = $('#paper-scroll');
  const rect = caretRect();
  if (was != null && rect) sc.scrollTop += rect.top - sc.getBoundingClientRect().top - was;
  // anchoring back on once the page has settled where NEO put it
  clearTimeout(caretHeight.t);
  caretHeight.t = setTimeout(() => { sc.style.overflowAnchor = ''; }, 300);
}

// The caret never types out of sight: an Enter (or anything else) on the
// window's bottom line brings the new line into view, with a little room
// below it. (Typewriter scrolling keeps the line centered on its own.)
// …and again if the chapter's height changes in the moment after: the ***
// line can settle its height a frame or two later (its face arriving, on a
// Mac), which pushed a line made at the window's foot back out of sight
function revealCaretSettled(body) {
  revealCaret();
  if (typeof ResizeObserver !== 'function' || !body) return;
  let first = true;
  const ro = new ResizeObserver(() => {
    if (first) { first = false; return; } // (the observer's own first report)
    if (!typewriterEnabled) revealCaret();
  });
  ro.observe(body);
  setTimeout(() => ro.disconnect(), 600);
}
function revealCaret() {
  const sc = $('#paper-scroll');
  const rect = caretRect();
  if (!rect) return;
  const box = sc.getBoundingClientRect();
  const room = Math.min(48, box.height / 6);
  if (rect.bottom > box.bottom - room) sc.scrollTop += rect.bottom - (box.bottom - room);
  else if (rect.top < box.top + 8) sc.scrollTop -= box.top + 8 - rect.top;
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
  // …and on its first line. Below an empty line, Backspace takes the empty
  // line away and the paragraph moves up to the top of the chapter; it
  // never reaches past it into the chapter above.
  let el = r.startContainer.nodeType === Node.TEXT_NODE ? r.startContainer.parentElement : r.startContainer;
  const block = el && el.closest ? el.closest('p') : null;
  if (block && body.contains(block) && block !== body.firstElementChild) {
    const above = block.previousElementSibling;
    if (!above || above.tagName !== 'P' || above.classList.contains('scene-break') || above.classList.contains('ghost')) return false;
    e.preventDefault();
    snapshotStructure('empty line removed');
    above.remove();
    placeCaret(block, 0);
    syncChapter(body, chId);
    resetNativeUndo();
    breakRun++;
    return true;
  }
  const idx = book.chapterOrder.indexOf(chId);
  if (idx <= 0) return false;
  const prevId = book.chapterOrder[idx - 1];
  const prevBody = document.querySelector(`.chapter[data-id="${prevId}"] .chapter-body`);
  if (!prevBody || chapterKind(prevId) === 'contents') return false;
  const empty = prevBody.innerText.trim() === '';
  // only story runs into story: a page above stays a page
  if (!empty && !(isStory(chId) && isStory(prevId))) return false;
  e.preventDefault();
  if (empty) {
    // empty chapter above: swallow it
    snapshotStructure('empty chapter removed');
    breakRun++;
    const was = caretHeight();
    deleteChapterQuiet(prevId).then(() => { focusChapterStart(chId); resetNativeUndo(); keepCaretHeight(was); });
    return true;
  }
  // chapter with words above: merge this chapter up into it — the inverse
  // of a triple-Enter split, and ⌘Z restores the split
  snapshotStructure('chapters merged');
  const was = caretHeight();
  const prevCount = prevBody.querySelectorAll('p').length;
  const keepScroll = $('#paper-scroll').scrollTop;
  chapterHTML[prevId] = captureBody(prevBody) + captureBody(body);
  persistChapter(prevId);
  for (const s of stickies) if (s.chapterId === chId) s.chapterId = prevId;
  writeSidecar(book.id, 'stickies', stickies);
  for (const d of darlings) if (d.chapterId === chId) d.chapterId = prevId;
  writeSidecar(book.id, 'darlings', darlings);
  foldNotesPage(chId, prevId);
  if (book.sectionNotes && book.sectionNotes[chId]) {
    book.sectionNotes[prevId] = [...(book.sectionNotes[prevId] || []), ...book.sectionNotes[chId]];
    delete book.sectionNotes[chId];
  }
  if (book.chapterTitles) delete book.chapterTitles[chId];
  if (book.chapterNotes) delete book.chapterNotes[chId];
  if (book.chapterKinds) delete book.chapterKinds[chId];
  book.chapterOrder = book.chapterOrder.filter((c) => c !== chId);
  delete chapterHTML[chId];
  clearTimeout(saveTimers[chId]);
  delete saveTimers[chId];
  // on disk, in the order that can't lose a word: the chapter above with
  // both texts first, then book.json without this chapter, and only then
  // this chapter's file. A save that fails stops the sequence there.
  const bookId = book.id;
  (async () => {
    await persistChapter(prevId);
    if (!book || book.id !== bookId) return;
    await saveMeta();
    await window.neo.deleteChapter(bookId, chId);
  })().catch((err) => window.neo.logError('merge: ' + (err && err.message || err)));
  renderChapters();
  renderStickies();
  restoreCaret({ chId: prevId, pIdx: prevCount, off: 0, scroll: keepScroll });
  resetNativeUndo();
  keepCaretHeight(was); // the line stays put as the heading above it goes
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
        // through the engine, so the change is seen (and saved, and undone)
        const del = document.createRange();
        del.setStart(node, r.startOffset - n);
        del.setEnd(node, r.startOffset);
        sel.removeAllRanges();
        sel.addRange(del);
        document.execCommand('delete');
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
    (n.classList.contains('ph-mark') || n.classList.contains('darling-anchor') || n.classList.contains('fn'));

  // Case 0: joining two lines where the upper one ends in a footnote's
  // number. The engine only drops the line's trailing <br> there and leaves
  // the lines apart, so NEO joins them itself.
  const block = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node).closest('.chapter-body > p');
  if (block && !block.classList.contains('scene-break') && !block.classList.contains('ghost')) {
    const edge = document.createRange();
    edge.selectNodeContents(block);
    if (back) edge.setEnd(r.startContainer, r.startOffset); else edge.setStart(r.startContainer, r.startOffset);
    const upper = back ? block.previousElementSibling : block;
    const lower = back ? block : block.nextElementSibling;
    const endsInNote = (p) => {
      let last = p && p.lastChild;
      while (last && ((last.nodeType === Node.TEXT_NODE && !last.textContent) || last.nodeName === 'BR')) last = last.previousSibling;
      return !!(last && last.classList && last.classList.contains('fn'));
    };
    if (edge.toString() === '' && !edge.cloneContents().querySelector('.fn') && upper && lower && upper.tagName === 'P' && lower.tagName === 'P' &&
        !upper.classList.contains('scene-break') && !lower.classList.contains('scene-break') && endsInNote(upper)) {
      e.preventDefault();
      while (upper.lastChild && (upper.lastChild.nodeName === 'BR' || (upper.lastChild.nodeType === Node.TEXT_NODE && !upper.lastChild.textContent))) upper.lastChild.remove();
      const join = document.createRange();
      join.setStartAfter(upper.lastChild);
      join.collapse(true);
      while (lower.firstChild) {
        if (lower.firstChild.nodeName === 'BR' && !lower.firstChild.nextSibling) { lower.firstChild.remove(); continue; }
        upper.appendChild(lower.firstChild);
      }
      lower.remove();
      sel.removeAllRanges();
      sel.addRange(join);
      caretOffFootnote(sel);
      syncChapter(body, chId);
      renderFootnoteList(body);
      return true;
    }
  }

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
    } else if (adjacent.classList.contains('fn')) {
      footnoteToDarlings(adjacent, chId);
      adjacent.remove();
      syncChapter(body, chId);
      renderAllFootnoteLists();
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
  for (const s of [...el.querySelectorAll('span:not(.ph-mark):not(.fn)')]) {
    while (s.firstChild) s.before(s.firstChild);
    s.remove();
  }
  // …and the size, face or colour the engine writes onto bold and italic
  // words when it merges lines: a word kept at an old size ignores ⌘+ and ⌘−
  for (const f of el.querySelectorAll('b[style], i[style], em[style], strong[style], u[style], s[style], strike[style], sub[style], sup[style]')) {
    f.removeAttribute('style');
  }
}

// Enter once: new paragraph. Enter twice: *** section break — wherever the
// caret is, even mid-sentence. Enter three times: the chapter splits here.
let enterRun = 0;
// break operations live outside the engine's undo history; while the most
// recent edits are breaks, ⌘Z routes to NEO's structural undo, one per press
let breakRun = 0;

// was: the caret's height in the window before the *** above it went
function splitChapterAt(body, chId, block, sel, was) {
  // an empty line is no way to start a chapter, or end one: blank lines at
  // the seam stay behind (the new chapter opens on its first words)
  const blank = (p) => p && p.tagName === 'P' && !p.classList.contains('scene-break') && p.textContent.trim() === '' && !p.querySelector('.ph-mark');
  while (blank(block) && block.nextElementSibling) {
    const next = block.nextElementSibling;
    block.remove();
    block = next;
  }
  while (blank(block.previousElementSibling) && block.previousElementSibling.previousElementSibling) block.previousElementSibling.remove();
  const settle = holdDay();
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
  settle();
  focusChapterStart(newId);
  resetNativeUndo();
  // the writer's line stays where it was in the window, the new chapter's
  // heading above it; only a line near the window's top moves down, as far
  // as it takes for the heading to show
  keepCaretHeight(was);
  const sc = $('#paper-scroll');
  const head = document.querySelector(`.chapter[data-id="${newId}"] .chapter-head`).getBoundingClientRect();
  const top = sc.getBoundingClientRect().top + 8;
  if (head.height && head.top < top) sc.scrollTop -= top - head.top;
  revealCaret();
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
  // on a page (a dedication, a part, the copyright) Enter is only a new
  // line: breaks and new chapters belong to the story
  if (!isStory(chId) && !block.classList.contains('poetry')) {
    e.preventDefault();
    enterRun = 0;
    if (block.querySelector('span:not(.ph-mark):not(.fn)')) {
      const caret = captureCaret();
      stripJunkSpans(block);
      restoreCaret(caret);
    }
    document.execCommand('insertParagraph');
    syncChapter(body, chId);
    return true;
  }
  if (block.classList.contains('scene-break')) { e.preventDefault(); return true; } // Enter on a *** line: nothing
  // Enter in a poetry paragraph steps back into prose: an empty line becomes
  // an ordinary paragraph in place; otherwise the line splits and the new
  // paragraph is plain (⇧Enter is how the poem continues)
  if (block.classList.contains('poetry') || block.classList.contains('flush')) {
    e.preventDefault();
    enterRun = 0;
    if (block.textContent.trim() === '') {
      snapshotStructure('poetry paragraph to prose');
      block.classList.remove('poetry', 'flush');
      romanize(block);
      placeCaret(block, 0);
      syncChapter(body, chId);
      resetNativeUndo();
      breakRun++;
      return true;
    }
    const wasPoetry = block.classList.contains('poetry');
    document.execCommand('insertParagraph');
    const cur = caretBlock(body);
    if (cur && cur !== block) {
      cur.classList.remove('poetry', 'flush');
      if (wasPoetry) romanize(cur);
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
        const was = caretHeight();
        prev.remove();
        splitChapterAt(body, chId, block, sel, was);
        return true;
      }
      e.preventDefault();
      // a break made by the full double-Enter gesture un-splits on undo too
      snapshotStructure('section break', { rejoin: enterRun >= 2 });
      if (prev.textContent.trim() === '') {
        // a break is only a break: no alignment or paragraph kind carried
        // over from the paragraph it was made in (a justified one set it left)
        prev.removeAttribute('style');
        prev.className = 'scene-break';
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
      // no input event follows a break made by hand, so the caret is kept in
      // sight here, as typing keeps it: a break near the window's foot pushed
      // the line below it until the next key
      if (!typewriterEnabled) revealCaretSettled(body);
      breakRun++;
      return true;
    }

    // normal Enter — native split so ⌘Z keeps working; junk spans (which
    // make the engine clone whole paragraphs) are stripped first if present
    e.preventDefault();
    caretOffFootnote(sel);
    if (block.querySelector('span:not(.ph-mark):not(.fn)')) {
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
    const was = caretHeight();
    prev.remove();
    splitChapterAt(body, chId, block, sel, was);
    return true;
  }

  // Second Enter at end of flow: the empty paragraph becomes a *** break
  if (prev) {
    e.preventDefault();
    snapshotStructure('section break', { rejoin: enterRun >= 2 });
    // the line under the break is set as the one it was made in, the way
    // Enter carries a paragraph's alignment (a third Enter takes it on into
    // the next chapter); the break itself carries nothing (see above)
    const align = block.style.textAlign;
    block.removeAttribute('style');
    block.className = 'scene-break';
    block.textContent = '***';
    const np = document.createElement('p');
    if (align) np.style.textAlign = align;
    np.innerHTML = '<br>';
    block.after(np);
    const range = document.createRange();
    range.setStart(np, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    syncChapter(body, chId);
    resetNativeUndo();
    if (!typewriterEnabled) revealCaretSettled(body); // (see the break above)
    breakRun++;
    return true;
  }
  return false;
}
