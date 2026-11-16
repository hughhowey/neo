'use strict';

/* ================================================================== */
/*  POETRY PARAGRAPHS — ⌘⇧Enter (Ctrl+Shift+Enter)                     */
/*  A paragraph pulled in from the margins, italic: a stanza of verse,  */
/*  a quote, a POV name under the chapter heading. One class, one key.  */
/*  FLUSH PARAGRAPHS — ⇧Enter                                          */
/*  Prose with no first-line indent: a report, a list, an email, a     */
/*  sign in the story. ⇧Enter again gives another; Enter is prose.     */
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

// ⌘⇧Enter (Ctrl+Shift+Enter). At the end of a paragraph: a new poetry
// paragraph beneath it. Mid-paragraph: the text after the caret becomes
// one. Inside a poetry paragraph, ⇧Enter or ⌘⇧Enter: another line of it,
// so verse flows. On a *** line: nothing.
function handlePoetry(e, body, chId) {
  if (e.key !== 'Enter' || !e.shiftKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const block = caretBlock(body);
  if (!block) return false;
  const mod = e.metaKey || e.ctrlKey;
  if (!mod && !block.classList.contains('poetry')) return false; // ⇧Enter alone: a flush paragraph
  e.preventDefault();
  // a new poetry paragraph is behind Show More Features; one already there goes on
  if (!featureOn('poetry') && !block.classList.contains('poetry')) return true;
  if (block.classList.contains('scene-break')) return true;

  if (block.classList.contains('poetry')) {
    // the engine's own split keeps the class on the new line, and ⌘Z sees it
    if (block.querySelector('span:not(.ph-mark):not(.fn)')) stripJunkSpans(block);
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
    block.classList.remove('flush');
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

// ⇧Enter. At the end of a paragraph: a flush paragraph beneath it.
// Mid-paragraph: the text after the caret becomes one. At the start of a
// paragraph (or in an empty one): that paragraph goes flush. Inside a flush
// paragraph: another one. On a *** line: nothing.
function handleFlush(e, body, chId) {
  if (e.key !== 'Enter' || !e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const block = caretBlock(body);
  if (!block) return false;
  e.preventDefault();
  if (block.classList.contains('scene-break')) return true;
  if (block.querySelector('span:not(.ph-mark):not(.fn)')) stripJunkSpans(block);
  if (block.classList.contains('flush')) {
    // the engine's own split keeps the class on the new line, and ⌘Z sees it
    document.execCommand('insertParagraph');
    const cur = caretBlock(body);
    if (cur) cur.classList.add('flush');
    syncChapter(body, chId);
    return true;
  }
  const r = sel.getRangeAt(0);
  const head = document.createRange();
  head.selectNodeContents(block);
  try { head.setEnd(r.startContainer, r.startOffset); } catch { return true; }
  if (block.textContent.trim() === '' || head.toString().length === 0) {
    snapshotStructure('flush paragraph');
    block.classList.add('flush');
    syncChapter(body, chId);
    resetNativeUndo();
    breakRun++;
    return true;
  }
  document.execCommand('insertParagraph');
  const cur = caretBlock(body);
  if (cur && cur !== block) cur.classList.add('flush');
  syncChapter(body, chId);
  return true;
}

// Backspace at the very start of a poetry or flush paragraph makes it prose
// again — the second Backspace then merges it upward like any paragraph
function poetryBackspace(e, body, chId) {
  if (e.key !== 'Backspace' || e.metaKey || e.ctrlKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const block = caretBlock(body);
  if (!block || !(block.classList.contains('poetry') || block.classList.contains('flush'))) return false;
  const r = sel.getRangeAt(0);
  const head = document.createRange();
  head.selectNodeContents(block);
  try { head.setEnd(r.startContainer, r.startOffset); } catch { return false; }
  if (head.toString().length !== 0) return false;
  e.preventDefault();
  snapshotStructure('poetry paragraph to prose');
  if (block.classList.contains('poetry')) romanize(block);
  block.classList.remove('poetry', 'flush');
  placeCaret(block, 0);
  syncChapter(body, chId);
  resetNativeUndo();
  breakRun++;
  return true;
}

// Format → Poetry Paragraph / Flush Paragraph: toggles every paragraph the
// selection touches (a paragraph is one or the other, or plain prose)
function togglePoetry() { toggleParaKind('poetry'); }
function toggleFlush() { toggleParaKind('flush'); }
function toggleParaKind(kind) {
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
  snapshotStructure(kind + ' paragraph');
  const on = !ps.every((p) => p.classList.contains(kind));
  for (const p of ps) {
    const wasPoetry = p.classList.contains('poetry');
    p.classList.remove('poetry', 'flush', 'litrpg');
    if (on) p.classList.add(kind);
    if (kind === 'poetry' && on) italicize(p);
    else if (wasPoetry) romanize(p);
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
