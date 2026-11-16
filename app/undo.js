'use strict';

/* ================================================================== */
/*  STRUCTURAL UNDO                                                    */
/*  Typing has the native ⌘Z. This covers the big moves — chapter      */
/*  deletes, replace-all, darlings — with snapshots of the whole       */
/*  structure.                                                         */
/* ================================================================== */

let undoStack = [];
let redoStack = []; // what structural undos took back, newest last

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

// Back where the writer left off, on this device or the other one: the caret
// at its letter, a third of the way down the window. A position from an
// older NEO (the scroll alone) gets the scroll.
function resumePosition(pos) {
  if (!book || !pos || !book.chapterOrder.includes(pos.chapterId)) return false;
  const body = document.querySelector(`.chapter[data-id="${pos.chapterId}"] .chapter-body`);
  if (!body) return false;
  const sc = $('#paper-scroll');
  if (typeof pos.pIdx !== 'number' || !body.isContentEditable) {
    currentChapterId = pos.chapterId;
    sc.scrollTop = pos.scroll || 0;
  } else {
    restoreCaret({ chId: pos.chapterId, pIdx: pos.pIdx, off: pos.off || 0 });
    const sel = window.getSelection();
    if (sel.rangeCount) {
      const r = sel.getRangeAt(0).cloneRange();
      let rect = r.getBoundingClientRect();
      if (!rect.height) {
        const node = r.startContainer.nodeType === Node.ELEMENT_NODE ? r.startContainer : r.startContainer.parentElement;
        if (node) rect = node.getBoundingClientRect();
      }
      sc.scrollTop += rect.top - sc.getBoundingClientRect().top - sc.clientHeight / 3;
    }
  }
  highlightNav();
  updateCounters();
  return true;
}

// When this device last did something to the page: a key, or a tap or click
// in the manuscript. A newer spot from the other device moves the caret only
// if it is newer than that (a scroll or a glance doesn't count).
let lastHereActivity = 0;
document.addEventListener('keydown', () => { lastHereActivity = Date.now(); }, true);
document.addEventListener('pointerdown', (e) => {
  if (e.target && e.target.closest && e.target.closest('#chapters')) lastHereActivity = Date.now();
}, true);

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

// The state right after a structural action, taken just before the first
// edit that follows it (or the next action): undoing the action later puts
// back only what the action changed, never over words typed since.
function sealUndo(snap) {
  if (!snap || snap.after) return;
  snap.after = { chapterHTML: { ...chapterHTML }, darlings: JSON.parse(JSON.stringify(darlings)), stickies: JSON.parse(JSON.stringify(stickies)) };
}
function sealUndoOnEdit() {
  const top = undoStack[undoStack.length - 1];
  if (top && top.armed) sealUndo(top);
}
// how many actions ⌘Z can take back, one after another
const UNDO_DEPTH = 50;
// the book's structure as it stands: what an undo puts back (and what a redo
// is, taken at the moment of the undo)
function captureStructure(label, opts) {
  return {
    armed: false, // the action's own edits, in this same moment, don't seal it
    label,
    rejoin: !!(opts && opts.rejoin),
    outlineFocus: (opts && opts.outlineFocus) || null, // the outline line to return to
    caret: captureCaret(),
    chapterOrder: [...book.chapterOrder],
    chapterKinds: { ...(book.chapterKinds || {}) },
    chapterHTML: { ...chapterHTML },
    chapterTitles: { ...(book.chapterTitles || {}) },
    chapterNotes: { ...(book.chapterNotes || {}) },
    sectionNotes: JSON.parse(JSON.stringify(book.sectionNotes || {})),
    looseCards: JSON.parse(JSON.stringify(book.looseCards || [])),
    sceneNotes: { ...(book.sceneNotes || {}) },
    darlings: JSON.parse(JSON.stringify(darlings)),
    stickies: JSON.parse(JSON.stringify(stickies))
  };
}
function snapshotStructure(label, opts) {
  if (!book) return;
  maybeDailySnapshot();
  sealUndo(undoStack[undoStack.length - 1]);
  const snap = captureStructure(label, opts);
  undoStack.push(snap);
  redoStack = []; // a new action: what was undone before it can't come back over it
  setTimeout(() => { snap.armed = true; }, 30);
  if (undoStack.length > UNDO_DEPTH) undoStack.shift();
}

async function structuralUndo(fromRedo) {
  const snap = undoStack.pop();
  if (!snap || !book) return;
  sealUndo(snap); // nothing typed since: the state now is the action's own
  const forward = captureStructure(fromRedo ? 'undo of a redo' : 'redo'); // the state this undo leaves, for Redo
  const after = snap.after;
  // Chapter by chapter: one the action changed and nothing touched since
  // goes back; one only typed in since keeps its words; one both changed
  // goes back too, and the words written into it since go to Darlings, so
  // the undo never takes away writing that came after it.
  const restored = { ...snap.chapterHTML };
  const displaced = [];
  for (const chId of new Set([...Object.keys(chapterHTML), ...Object.keys(after.chapterHTML)])) {
    const cur = chapterHTML[chId];
    const was = after.chapterHTML[chId];
    if (cur === undefined || cur === was) continue;
    const textOf = (h) => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim();
    if (snap.chapterHTML[chId] !== undefined && snap.chapterHTML[chId] === was) {
      restored[chId] = cur; // the action left this chapter alone
    } else if (textOf(cur) && wordsBeyond(cur, restored[chId] || '')) {
      displaced.push({ chId, html: cur });
    }
  }
  // an action that only changed what a chapter is moved the story's count
  // with no word written or cut, and so does taking it back (#436)
  const kindNow = book.chapterKinds || {};
  const kindsOnly = [...new Set([...Object.keys(kindNow), ...Object.keys(snap.chapterKinds || {})])].some((c) => kindNow[c] !== (snap.chapterKinds || {})[c])
    && book.chapterOrder.length === snap.chapterOrder.length
    && book.chapterOrder.every((c, i) => c === snap.chapterOrder[i])
    && Object.keys(chapterHTML).length === Object.keys(restored).length
    && Object.keys(restored).every((c) => restored[c] === chapterHTML[c]);
  book.chapterOrder = snap.chapterOrder;
  book.chapterKinds = snap.chapterKinds;
  chapterHTML = restored;
  if (kindsOnly) wordsFromDisk();
  for (const { chId, html } of displaced) {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    darlings.unshift({
      id: 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      html,
      text: [...holder.children].map((p) => p.textContent).join('\n\n').slice(0, 2000),
      chapterId: chId,
      chapterLabel: book.chapterTitles && book.chapterTitles[chId] ? book.chapterTitles[chId] : t('Chapter {n}', { n: Math.max(1, snap.chapterOrder.indexOf(chId) + 1) }),
      date: new Date().toISOString()
    });
  }
  book.chapterTitles = snap.chapterTitles;
  book.chapterNotes = snap.chapterNotes;
  book.sectionNotes = snap.sectionNotes;
  book.looseCards = snap.looseCards || [];
  book.sceneNotes = snap.sceneNotes || {};
  // lists likewise: what the action changed goes back, anything added or
  // removed since stays that way (the displaced text above included)
  darlings = mergeSidecar(after.darlings, snap.darlings, darlings, true);
  stickies = mergeSidecar(after.stickies, snap.stickies, stickies, false);
  // resurrect any chapter files the action may have deleted
  for (const chId of book.chapterOrder) {
    await persistChapter(chId, chapterHTML[chId] || '<p><br></p>');
  }
  // (a list that can't be written now stays queued, and is tried again)
  await writeSidecar(book.id, 'darlings', darlings).catch(() => {});
  await writeSidecar(book.id, 'stickies', stickies).catch(() => {});
  await saveMeta();
  currentChapterId = book.chapterOrder.includes(currentChapterId) ? currentChapterId : null;
  renderChapters();
  renderStickies();
  if (currentTab === 'darlings') renderDarlings();
  if (currentTab === 'outline') { renderOutline(snap.outlineFocus || undefined); sidePaneForTab('outline'); }
  updateCounters();
  restoreCaret(snap.caret); // back to work, no announcement
  if (snap.rejoin) rejoinAtCaret();
  resetNativeUndo();
  // an undo that sets writing aside says where it went (#377): a chapter that
  // went back looks, to the writer, like words that vanished
  if (displaced.length) toast(t('Words you wrote since went to Darlings, so nothing is lost'), 8000);
  // what this undo took back can be put back: ⇧⌘Z (Ctrl+Shift+Z, or Ctrl+Y)
  sealUndo(forward);
  (fromRedo ? undoStack : redoStack).push(forward);
  if (undoStack.length > UNDO_DEPTH) undoStack.shift();
  if (redoStack.length > UNDO_DEPTH) redoStack.shift();
}

// Redo of an undo made outside the engine's own history: the state the undo
// left is put back the way an undo puts one back, so it can be undone again
async function structuralRedo() {
  const snap = redoStack.pop();
  if (!snap || !book) return;
  undoStack.push(snap);
  await structuralUndo(true);
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
  if (prev.classList.contains('flush') !== blk.classList.contains('flush')) return;
  if (prev.classList.contains('litrpg') !== blk.classList.contains('litrpg')) return;
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

// ⇧⌘Z (Ctrl+Shift+Z, and Ctrl+Y outside the Mac) puts back what ⌘Z took back
// outside the engine's history. Any typing, anywhere, ends it: a redo never
// lands over writing made after the undo.
document.addEventListener('input', () => { redoStack = []; }, true);
document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  const redo = (e.metaKey || e.ctrlKey) && ((e.shiftKey && key === 'z') || (e.ctrlKey && !e.metaKey && !e.shiftKey && key === 'y' && !IS_MAC));
  if (!redo || $('#editor-view').hidden || !book || !redoStack.length) return;
  e.preventDefault();
  structuralRedo();
}, true);

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
/*  READ ALOUD — ⌘⇧U (Ctrl+Shift+U)                                    */
/*  The computer's own voice reads from the caret, a sentence at a      */
/*  time, each one lit as it's read, on into the chapters after. ⌘⇧U   */
/*  again, Esc or a keystroke stops it, and the caret is left at the    */
/*  sentence it reached, so ⌘⇧U carries on from there. No keys, no      */
/*  cloud: the voices that come with macOS and Windows.                 */
/* ================================================================== */

let reading = null; // { item, gen } while the voice is going
let readGen = 0;

function readVoice() {
  const voices = window.speechSynthesis.getVoices();
  const lang = writingLanguage().toLowerCase();
  const base = lang.split('-')[0];
  const by = (f) => voices.find(f);
  return by((v) => v.lang.toLowerCase().replace('_', '-') === lang && v.default) ||
    by((v) => v.lang.toLowerCase().replace('_', '-') === lang) ||
    by((v) => v.lang.toLowerCase().startsWith(base) && v.localService) ||
    by((v) => v.lang.toLowerCase().startsWith(base)) ||
    by((v) => v.default) || voices[0] || null;
}
async function readVoicesReady() {
  const synth = window.speechSynthesis;
  if (synth.getVoices().length) return true;
  // Some systems (Linux's speech-dispatcher) bring their voices a moment after
  // the first ask: wait for them, up to four seconds, rather than say there are none
  await new Promise((resolve) => {
    let waited = 0;
    const poll = setInterval(() => {
      waited += 100;
      if (synth.getVoices().length || waited >= 4000) { clearInterval(poll); resolve(); }
    }, 100);
    synth.addEventListener('voiceschanged', () => { if (synth.getVoices().length) { clearInterval(poll); resolve(); } }, { once: true });
  });
  return synth.getVoices().length > 0;
}

// The paragraphs to read, from one, in order: the rest of its editor, then
// (in the manuscript) the chapters after it
function readParasFrom(p) {
  const out = [];
  const editor = p.closest('.chapter-body, #aux-editor');
  const ok = (q) => q.tagName === 'P' && !q.classList.contains('scene-break') && !q.classList.contains('ghost');
  const take = (root, from) => {
    let on = !from;
    for (const q of root.querySelectorAll('p')) {
      if (q === from) on = true;
      if (on && ok(q)) out.push(q);
    }
  };
  take(editor, p);
  if (editor.matches('.chapter-body')) {
    const bodies = [...document.querySelectorAll('#chapters .chapter-body')];
    for (const b of bodies.slice(bodies.indexOf(editor) + 1)) take(b, null);
  }
  return out;
}
// a paragraph's sentences, as character spans of its text, from an offset
function readSentences(p, from) {
  const text = p.textContent;
  const spans = [];
  if (window.Intl && Intl.Segmenter) {
    const seg = new Intl.Segmenter(writingLanguage(), { granularity: 'sentence' });
    for (const s of seg.segment(text)) spans.push([s.index, s.index + s.segment.length]);
  } else spans.push([0, text.length]);
  return spans
    .map(([a, b]) => [Math.max(a, from), b])
    .filter(([a, b]) => b > a && text.slice(a, b).trim());
}
function readRange(p, a, b) {
  const s = pointAt(p, a), e = pointAt(p, b);
  if (!s || !e) return null;
  const r = document.createRange();
  r.setStart(s.node, s.offset);
  r.setEnd(e.node, e.offset);
  return r;
}

async function toggleReadAloud() {
  if (reading) { stopReadAloud(true); return; }
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { toast(t('Read aloud needs a voice on this computer')); return; }
  const sel = window.getSelection();
  let el = sel.rangeCount ? sel.anchorNode : null;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  let p = el && el.closest ? el.closest('.chapter-body p, #aux-editor p') : null;
  let from = 0;
  if (p) {
    const pre = document.createRange();
    pre.selectNodeContents(p);
    pre.setEnd(sel.anchorNode, sel.anchorOffset);
    from = pre.toString().length;
  } else {
    // no caret in the text: from the top of the chapter on screen
    const body = currentTab === 'manuscript'
      ? document.querySelector(`.chapter[data-id="${currentChapterId || (book && book.chapterOrder[0])}"] .chapter-body`)
      : $('#aux-editor');
    p = body && body.querySelector('p');
  }
  if (!p) return;
  // (no voice found after the wait: try the system's own default anyway, and
  // say so only if the engine itself answers that it has none)
  await readVoicesReady();
  const paras = readParasFrom(p);
  // start at the beginning of the sentence the caret is in
  const first = readSentences(p, 0).find(([a, b]) => from >= a && from < b);
  if (first) from = first[0];
  const gen = ++readGen;
  reading = { gen, item: null };
  const queue = function* () {
    for (const [n, q] of paras.entries()) {
      for (const [a, b] of readSentences(q, n === 0 && q === p ? from : 0)) yield { p: q, a, b };
    }
  }();
  const voice = readVoice();
  const next = () => {
    if (!reading || reading.gen !== gen) return;
    const { value: item, done } = queue.next();
    if (done || !item.p.isConnected) { stopReadAloud(false); return; }
    reading.item = item;
    const u = new SpeechSynthesisUtterance(item.p.textContent.slice(item.a, item.b).trim());
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = writingLanguage();
    u.onstart = () => {
      if (!reading || reading.gen !== gen) return;
      const r = readRange(item.p, item.a, item.b);
      if (!r || !window.Highlight || !CSS.highlights) return;
      CSS.highlights.set('neo-speak', new Highlight(r));
      // keep the sentence on screen
      const sc = $('#paper-scroll');
      const box = r.getBoundingClientRect();
      const view = sc.getBoundingClientRect();
      if (box.top < view.top + 40 || box.bottom > view.bottom - 60) {
        sc.scrollTop += box.top - view.top - view.height / 3;
      }
    };
    u.onend = () => next();
    u.onerror = (ev) => {
      if (ev.error === 'interrupted' || ev.error === 'canceled') return;
      if (!voice && ['synthesis-unavailable', 'synthesis-failed', 'voice-unavailable', 'language-unavailable'].includes(ev.error)) toast(t('Read aloud needs a voice on this computer'));
      stopReadAloud(false);
    };
    window.speechSynthesis.speak(u);
  };
  window.speechSynthesis.cancel();
  next();
}
// leaveCaret: the writer stopped it, so the caret goes to the sentence reached
function stopReadAloud(leaveCaret) {
  const was = reading;
  reading = null;
  readGen++;
  try { window.speechSynthesis.cancel(); } catch { /* nothing speaking */ }
  if (window.CSS && CSS.highlights) CSS.highlights.delete('neo-speak');
  if (leaveCaret && was && was.item && was.item.p.isConnected) {
    const ed = was.item.p.closest('.chapter-body, #aux-editor');
    const pt = pointAt(was.item.p, was.item.a);
    if (ed && pt) {
      ed.focus({ preventScroll: true });
      const s = window.getSelection();
      s.removeAllRanges();
      const r = document.createRange();
      r.setStart(pt.node, pt.offset);
      r.collapse(true);
      s.addRange(r);
    }
  }
}
document.addEventListener('keydown', (e) => {
  const cmd = e.metaKey || e.ctrlKey;
  // on Linux, Ctrl+Shift+U belongs to the input method (it types a Unicode
  // character by its code), so Read Aloud there is Ctrl+Shift+K (#287)
  if (cmd && e.shiftKey && !e.altKey && keyLetter(e) === (IS_LINUX ? 'k' : 'u')) {
    if (!book || $('#editor-view').hidden || !featureOn('readAloud')) return;
    e.preventDefault();
    e.stopPropagation();
    toggleReadAloud();
    return;
  }
  if (!reading || MODIFIER_KEYS.has(e.key)) return;
  // Esc stops the voice and nothing else; any other key stops it and goes on
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
  stopReadAloud(e.key === 'Escape');
}, true);
