'use strict';

/* ================================================================== */
/*  LITRPG BOXES — type [[ at the start of a line                      */
/*  The game's own voice on the page: a roll, a level-up, a character  */
/*  sheet. Monospace on gray, every space kept, so columns line up.    */
/*  Lines in a row make one box. No menu item: [[ is the whole door.   */
/* ================================================================== */

// [[ typed at the very start of a paragraph turns it into a box line (the
// brackets go). ⌘Z right after brings the [[ back as typed. Inside a box
// the smart typing stands aside: quotes stay straight, -- stays two
// hyphens, ... three dots, and nothing is capitalized for the writer.
// Returns true when the key is the box's (smartKeys then does nothing).
function litrpgKey(e, body) {
  if (!body.matches || !body.matches('.chapter-body') || body.classList.contains('script-body') || body.closest('#snap-view')) return false;
  const block = caretBlock(body);
  if (!block) return false;
  if (block.classList.contains('litrpg')) return true;
  if (e.key !== '[' || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.keyCode === 229) return false;
  if (block.matches('.scene-break, .ghost, .poetry')) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(block);
  try { pre.setEnd(r.startContainer, r.startOffset); } catch { return false; }
  if (pre.toString() !== '[') return false;
  const chapter = body.closest('.chapter');
  const chId = chapter && chapter.dataset.id;
  if (!chId) return false;
  e.preventDefault();
  // the second [ goes in first, so ⌘Z comes back to the [[ as typed
  document.execCommand('insertText', false, '[');
  syncChapter(body, chId);
  snapshotStructure('litrpg box');
  selectChars(block, 0, 2);
  document.execCommand('delete');
  block.classList.remove('flush');
  block.classList.add('litrpg');
  block.removeAttribute('data-first');
  if (block.textContent === '' && !block.querySelector('br')) block.innerHTML = '<br>';
  placeCaret(block, 0);
  syncChapter(body, chId);
  resetNativeUndo();
  breakRun++;
  return true;
}

// Enter in a box is the box's next line. Enter on the box's last line when
// it's empty closes the box: that line becomes prose. ⇧Enter never closes
// it: a blank line in the box, wherever the caret is. An empty line inside
// a box stays, as a blank line in it.
function litrpgEnter(e, body, chId) {
  if (e.key !== 'Enter' || e.altKey) return false;
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey) return false; // ⌘Enter: full screen
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const block = caretBlock(body);
  if (!block || !block.classList.contains('litrpg')) return false;
  e.preventDefault();
  enterRun = 0;
  const next = block.nextElementSibling;
  const last = !(next && next.classList.contains('litrpg'));
  if (last && block.textContent === '' && !e.shiftKey) {
    snapshotStructure('litrpg box to prose');
    block.classList.remove('litrpg');
    placeCaret(block, 0);
    syncChapter(body, chId);
    resetNativeUndo();
    breakRun++;
    return true;
  }
  if (block.querySelector('span:not(.ph-mark):not(.fn)')) stripJunkSpans(block);
  // the engine's own split, so ⌘Z sees it
  document.execCommand('insertParagraph');
  const cur = caretBlock(body);
  if (cur) {
    cur.classList.remove('poetry', 'flush');
    cur.classList.add('litrpg');
  }
  syncChapter(body, chId);
  return true;
}

// Backspace at the very start of a box's first line takes that line out
// of the box (it becomes prose); further down a box, Backspace joins the
// line to the one above, as anywhere.
function litrpgBackspace(e, body, chId) {
  if (e.key !== 'Backspace' || e.metaKey || e.ctrlKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const block = caretBlock(body);
  if (!block || !block.classList.contains('litrpg')) return false;
  const prev = block.previousElementSibling;
  if (prev && prev.classList.contains('litrpg')) return false;
  const r = sel.getRangeAt(0);
  const head = document.createRange();
  head.selectNodeContents(block);
  try { head.setEnd(r.startContainer, r.startOffset); } catch { return false; }
  if (head.toString().length !== 0) return false;
  e.preventDefault();
  snapshotStructure('litrpg box to prose');
  block.classList.remove('litrpg');
  placeCaret(block, 0);
  syncChapter(body, chId);
  resetNativeUndo();
  breakRun++;
  return true;
}

// the boxes' face: bundled (styles.css) and embedded in the PDF and EPUB.
// Word gets Courier New, which every editor's computer has.
const LITRPG_FONT = 'IBM Plex Mono';
const LITRPG_STACK = "'IBM Plex Mono', Menlo, Consolas, 'Courier New', monospace";
const LITRPG_WORD_FONT = 'Courier New';
// Word's LitRPG paragraph style: a thin gray border all round and a light
// gray fill, single-spaced, pulled in from both margins, in Courier New a
// size down. Paragraphs in a row with the same border are one box in Word,
// LibreOffice and Google Docs alike. An editor can restyle every box at once.
const LITRPG_DOCX_PPR = ['top', 'left', 'bottom', 'right'].reduce((x, side) => x + `<w:${side} w:val="single" w:sz="4" w:space="${side === 'top' || side === 'bottom' ? 4 : 6}" w:color="999999"/>`, '<w:pBdr>') + '</w:pBdr>'
  + '<w:shd w:val="clear" w:color="auto" w:fill="EDEDED"/><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="432" w:right="432"/>';
const LITRPG_DOCX_RPR = `<w:rFonts w:ascii="${LITRPG_WORD_FONT}" w:hAnsi="${LITRPG_WORD_FONT}" w:cs="${LITRPG_WORD_FONT}"/><w:sz w:val="20"/>`;
// The exports' side of a box. A run of spaces keeps its width in every
// reader: each space after the first (and one at a line's start) goes out
// as a no-break space, which no reading app collapses.
function litrpgSpaces(text) {
  return String(text).replace(/(^| ) /g, (m, a) => a + ' ').replace(/(^| ) /g, (m, a) => a + ' ');
}
// The box face's files an EPUB carries: regular always, bold and italic
// only when a box uses them. TrueType, which Kindle and Apple Books both read.
async function litrpgEpubFonts(d) {
  const boxes = d.sections.flatMap((ch) => ch.paras.filter((p) => p.litrpg)).map((p) => paraRuns(p.html));
  if (!boxes.length) return [];
  const runs = boxes.flat().filter((r) => r.text);
  const wanted = [['regular', 400, 'normal', true], ['bold', 700, 'normal', runs.some((r) => r.b && !r.i)],
    ['italic', 400, 'italic', runs.some((r) => r.i && !r.b)], ['bolditalic', 700, 'italic', runs.some((r) => r.b && r.i)]];
  const out = [];
  for (const [name, weight, style, used] of wanted) {
    if (!used) continue;
    try {
      out.push({ file: `IBMPlexMono-${name}.ttf`, base64: await fontBase64(new URL(`fonts/ibm-plex-mono-${name}.ttf`, location.href)), weight, style });
    } catch { /* the reader's own monospace stands in */ }
  }
  return out;
}
// A clipboard's lines, for a box: each paragraph (or line break) one line,
// spaces as they were, tabs as four spaces, no blank lines at either end
function clipBoxLines(html, text) {
  let lines = null;
  if (html) {
    const holder = new DOMParser().parseFromString(html, 'text/html').body;
    holder.querySelectorAll('script,style,meta,link,img,head,title').forEach((n) => n.remove());
    const BLOCK = 'p, div, li, pre, h1, h2, h3, h4, h5, h6, tr, blockquote';
    const leaves = [...holder.querySelectorAll(BLOCK)].filter((b) => !b.querySelector(BLOCK));
    if (leaves.length) {
      lines = [];
      for (const b of leaves) {
        b.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
        lines.push(...b.textContent.split('\n'));
      }
    }
  }
  if (!lines) lines = String(text || '').replace(/\r/g, '').split('\n');
  lines = lines.map((l) => l.replace(/\t/g, '    ').replace(/\s+$/, ''));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines;
}
function pasteIntoBox(body, chId, html, text) {
  const lines = clipBoxLines(html, text);
  lines.forEach((line, i) => {
    if (i > 0) {
      document.execCommand('insertParagraph');
      const cur = caretBlock(body);
      if (cur) { cur.classList.remove('poetry', 'flush'); cur.classList.add('litrpg'); }
    }
    if (line) document.execCommand('insertText', false, line);
  });
  if (body.querySelector('span:not(.ph-mark):not(.fn)')) {
    const caret = captureCaret();
    stripJunkSpans(body);
    restoreCaret(caret);
  }
  syncChapter(body, chId);
}
// NEO's own copied paragraphs with boxes among them: box lines keep their
// class and spaces, the rest is cleaned like any paste. The paragraphs go in
// whole between the two halves of the caret's line (the engine's own paste
// would run the last one into the words after the caret); ⌘Z takes them out.
function pasteBoxesFromNeo(body, chId, html) {
  const holder = new DOMParser().parseFromString(html, 'text/html').body;
  const lines = [...holder.querySelectorAll('p')].map((p) => {
    const box = p.classList.contains('litrpg');
    const runs = paraRuns(p.innerHTML, true).filter((r) => r.text);
    const inner = runs.map((r) => runHtml(r)).join('');
    if (!box && !inner.replace(/<[^>]*>/g, '').trim()) return null;
    const el = document.createElement('p');
    if (box) el.className = 'litrpg';
    el.innerHTML = box ? inner || '<br>' : inner.replace(/^\s+|\s+$/g, '');
    return el;
  }).filter(Boolean);
  if (!lines.length) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  snapshotStructure('paste');
  if (!sel.isCollapsed) document.execCommand('delete');
  const block = caretBlock(body);
  if (!block || block.classList.contains('scene-break')) return false;
  const tail = document.createRange();
  tail.selectNodeContents(block);
  const r = sel.getRangeAt(0);
  tail.setStart(r.startContainer, r.startOffset);
  const after = tail.extractContents();
  let at = block;
  for (const el of lines) { at.after(el); at = el; }
  const rest = document.createElement('p');
  if (block.className) rest.className = block.className;
  rest.appendChild(after);
  if (rest.textContent.trim()) at.after(rest);
  if (!block.textContent.trim()) block.remove();
  const last = lines[lines.length - 1];
  const end = document.createRange();
  end.selectNodeContents(last);
  end.collapse(false);
  sel.removeAllRanges();
  sel.addRange(end);
  syncChapter(body, chId);
  resetNativeUndo();
  breakRun++;
  return true;
}
// a box line's classes in an export: its edges are marked, since a reading
// app may not know :has(), and Paged.js must see where a box starts
function litrpgClass(paras, i) {
  const is = (p) => !!(p && p.litrpg);
  return ['litrpg', is(paras[i - 1]) ? '' : 'lt-top', is(paras[i + 1]) ? '' : 'lt-end'].filter(Boolean).join(' ');
}
// the box as the PDF, the web page and the paperback set it (o: size, side
// margins, padding, gray fill and line, the room above and below)
function litrpgCss(sel, o) {
  return `${sel} { font-family: ${LITRPG_STACK}; font-size: ${o.size}; line-height: 1.5; text-indent: 0 !important; text-align: left !important; hyphens: manual; -webkit-hyphens: manual; white-space: pre-wrap; margin: 0 ${o.side}; padding: 0 ${o.pad}; background: ${o.fill}; border-left: 0.75pt solid ${o.line}; border-right: 0.75pt solid ${o.line}; -webkit-print-color-adjust: exact; print-color-adjust: exact; break-inside: avoid; }
${sel}.lt-top { margin-top: ${o.gap}; padding-top: ${o.edge || '0.45em'}; border-top: 0.75pt solid ${o.line}; }
${sel}.lt-end { margin-bottom: ${o.gap}; padding-bottom: ${o.edge || '0.45em'}; border-bottom: 0.75pt solid ${o.line}; }
${sel}::first-letter { font: inherit; initial-letter: normal; -webkit-initial-letter: normal; padding: 0; }`;
}
