'use strict';

/* ================================================================== */
/*  TYPING RULES — scene breaks, the opening line, paste, emphasis,    */
/*  capitals, quotes and dashes                                        */
/* ================================================================== */

// Backspace just below a *** (or Delete just above one) removes the break
// itself — prose never merges into the break's styled paragraph. With the
// caret on the *** line itself, either key removes the whole break too: a
// break is one thing, so it never joins the line above as three stars of
// text, and never loses one star at a time.
function sceneBreakDelete(e, body, chId) {
  if (e.key !== 'Backspace' && e.key !== 'Delete') return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  let el = r.startContainer;
  if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const block = el && el.closest ? el.closest('p') : null;
  if (!block || !body.contains(block)) return false;
  const back = e.key === 'Backspace';
  if (block.classList.contains('scene-break')) {
    // the caret goes where the key was heading: the end of the line above
    // (Backspace) or the start of the line below (Delete), or the other one
    // when there's nothing that way
    const above = block.previousElementSibling;
    const below = block.nextElementSibling;
    e.preventDefault();
    snapshotStructure('section break removed');
    block.remove();
    if (back && above) caretToEnd(above);
    else if (below) caretIntoStart(below);
    else if (above) caretToEnd(above);
    syncChapter(body, chId);
    resetNativeUndo();
    breakRun++;
    return true;
  }
  const edge = document.createRange();
  edge.selectNodeContents(block);
  try {
    if (back) edge.setEnd(r.startContainer, r.startOffset);
    else edge.setStart(r.startContainer, r.startOffset);
  } catch { return false; }
  if (edge.toString().length !== 0) return false; // caret isn't at the block's edge
  const target = back ? block.previousElementSibling : block.nextElementSibling;
  if (!target || !target.classList.contains('scene-break')) return false;
  e.preventDefault();
  snapshotStructure('section break removed');
  target.remove();
  syncChapter(body, chId);
  resetNativeUndo();
  breakRun++;
  return true;
}

// Read a body's HTML for saving:
function captureBody(body) {
  // (a page marks the lines that say who said it, and a chapter the speech
  // after a scene break, for the screen only)
  // (and a script's page breaks, (CONT'D) and suggestions)
  return dropJunkSpans(body.innerHTML).replace(/<(b|i|em|strong|u|s|strike|sub|sup)\s+style="[^"]*"/g, '<$1').replace(/<p\b[^>]*>/g, (tag) => tag.replace(/ data-(?:attr|speech|first|walk|fnopen)=""/g, '')
    .replace(/ data-(?:pg|fill|contd|ghost|ghost-empty|sp-paste|scene-note)(?:="[^"]*")?/g, ''));
}

// The engine's style spans (stripJunkSpans), left out of what's saved. A
// cut, Backspace or Delete across paragraphs wraps the words it joins in
// them (the indent and white-space of the paragraph they came from); taken
// off the page there and then, they'd break ⌘Z, which puts back what the
// engine itself took away. So the page keeps them until the chapter is next
// opened, and the file never has them. NEO's own spans (placeholder flags)
// stay.
function dropJunkSpans(html) {
  if (html.indexOf('<span') < 0) return html;
  const junk = [];
  return html.replace(/<span\b[^>]*>|<\/span>/g, (tag) => {
    if (tag[1] === '/') return junk.pop() ? '' : tag;
    const drop = !/\sclass="[^"]*\b(?:ph-mark|fn)\b/.test(tag);
    junk.push(drop);
    return drop ? '' : tag;
  });
}

// A chapter that opens on a line of dialogue sets no drop cap: the dash
// itself would be the letter enlarged. That line, and one that follows a
// scene break, keep their indent where prose is set flush, so the speech
// lines up with the lines that answer it. The marks are never saved.
const OPENING_DASH = /^\s*[-‐‑‒–—―]/;
// A chapter's opening paragraph — the one with the drop cap and no indent —
// is its first paragraph with words in it, past a blank line or a *** at the
// top (the exports skip those too). Poetry and LitRPG boxes stand apart. In an empty
// chapter it's the paragraph waiting for the first word. Marked data-first,
// for the screen only.
function openingPara(body) {
  const ps = [...body.children].filter((p) => p.tagName === 'P' && !p.classList.contains('poetry') && !p.classList.contains('litrpg') && !p.classList.contains('scene-break') && !p.classList.contains('ghost'));
  return ps.find((p) => p.textContent.trim() !== '') || ps[0] || null;
}
function markDialogueOpening(body) {
  // the engine, joining or emptying paragraphs, writes the indent a paragraph
  // had at that moment onto it for good (the opening one's most of all). The
  // indent is the stylesheet's to give; an alignment the writer chose stays.
  for (const p of body.querySelectorAll(':scope > p[style*="text-indent"]')) {
    p.style.removeProperty('text-indent');
    if (!p.getAttribute('style')) p.removeAttribute('style');
  }
  const first = openingPara(body);
  for (const p of body.querySelectorAll('p[data-first]')) if (p !== first) p.removeAttribute('data-first');
  if (first && !first.hasAttribute('data-first')) first.setAttribute('data-first', '');
  body.classList.toggle('opens-dialogue', !!first && OPENING_DASH.test(first.textContent));
  for (const p of body.querySelectorAll('p[data-speech]')) if (!p.matches('.scene-break + p')) p.removeAttribute('data-speech');
  for (const p of body.querySelectorAll('p.scene-break + p')) {
    const speech = OPENING_DASH.test(p.textContent);
    if (p.hasAttribute('data-speech') !== speech) p.toggleAttribute('data-speech', speech);
  }
  setDropCap(body, first);
}

// THE DROP CAP is a letter NEO draws beside the opening paragraph (that
// paragraph's ::before, its letter and width handed over in --cap and --cap-w
// on the chapter body, which is never saved). It is not a ::first-letter:
// that makes the engine split the paragraph's text in two behind the scenes,
// and typing or deleting beside the split left doubled letters on the page,
// so for a long time the cap had to step aside whenever the caret was in its
// paragraph. Now the words are one plain run of text to edit. The real first
// letter is still there, unseen (the neo-cap highlight paints it clear) and
// drawn back under the cap by its own width, so the line starts where it
// always did.
const capHidden = window.Highlight && window.CSS && CSS.highlights ? new Highlight() : null;
if (capHidden) {
  capHidden.priority = 50; // over the focus, search and spelling highlights: none of them may ink it in
  CSS.highlights.set('neo-cap', capHidden);
}
const capState = new WeakMap(); // chapter body → { range, cap, sig }
const capWidths = new Map(); // what a letter measures, in em, when its chapter isn't laid out
const CAP_LEAD = /^[\p{Ps}\p{Pi}\p{Pf}\p{Pe}\p{Po}]*/u; // an opening quote or ¿ is set with its letter
const capSegmenter = window.Intl && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

// The letter (with any mark that opens it) a paragraph's text begins with;
// '' when it begins with a space or with nothing a cap can be made of
function capOf(text) {
  const lead = CAP_LEAD.exec(text)[0];
  const rest = text.slice(lead.length);
  if (!rest) return '';
  const g = capSegmenter ? capSegmenter.segment(rest)[Symbol.iterator]().next().value.segment : String.fromCodePoint(rest.codePointAt(0));
  return /[\p{L}\p{N}]/u.test(g) ? lead + g : '';
}

// Where the paragraph's words begin: its first text nodes, in order. A flag
// or a footnote number standing before the first word means no cap.
function capOpening(p) {
  const nodes = [];
  let text = '';
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && n.matches(UNCOUNTED) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  });
  // (a rejected element's subtree is skipped; one that takes up room ends the search)
  for (let n = p.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === Node.ELEMENT_NODE && n.matches('.ph-mark, .fn')) return null;
    if (n.nodeType !== Node.ELEMENT_NODE || !n.matches(UNCOUNTED)) break;
  }
  let n;
  while (text.length < 16 && (n = walker.nextNode())) {
    // a line break before the first word: the letter isn't on the first line to be tucked away
    if (n.nodeName === 'BR' && !text) return null;
    if (n.nodeType !== Node.TEXT_NODE || !n.data) continue;
    nodes.push(n);
    text += n.data;
  }
  return nodes.length ? { nodes, text } : null;
}

function clearDropCap(body) {
  const st = capState.get(body);
  if (!st) return;
  if (capHidden) capHidden.delete(st.range);
  capState.delete(body);
  body.classList.remove('has-cap');
  body.style.removeProperty('--cap');
  body.style.removeProperty('--cap-w');
  if (!body.getAttribute('style')) body.removeAttribute('style');
}

// `remeasure`: the type changed (a font chosen, or one that just arrived)
function setDropCap(body, first, remeasure = false) {
  const open = capHidden && first && !body.classList.contains('no-cap') && !body.classList.contains('opens-dialogue') &&
    !document.body.classList.contains('no-dropcap') && capOpening(first);
  const cap = open ? capOf(open.text) : '';
  if (!cap) { clearDropCap(body); return; }
  // the cap's own letters, from the paragraph's first character on
  let left = cap.length;
  let end = open.nodes[0];
  let endAt = 0;
  for (const n of open.nodes) {
    end = n;
    endAt = Math.min(left, n.data.length);
    left -= endAt;
    if (!left) break;
  }
  // how the letter is set where it stands (in an italic, say) decides its width
  // (and the letter after it: a pair like "To" is set closer than "Th")
  let sig = cap + '~' + open.text.slice(cap.length, cap.length + 2);
  for (const n of open.nodes) {
    // (the engine's own spans carry their weight and slant in a style)
    for (let el = n.parentElement; el && el !== first; el = el.parentElement) sig += '>' + el.tagName + (el.getAttribute('style') || '');
    if (n === end) break;
    sig += '|';
  }
  let st = capState.get(body);
  if (!st) {
    st = { range: document.createRange(), cap: '', sig: '' };
    capState.set(body, st);
    if (capHidden.size > 400) for (const r of [...capHidden]) if (!r.startContainer.isConnected) capHidden.delete(r); // chapters since redrawn
  }
  const r = st.range;
  if (r.startContainer !== open.nodes[0] || r.startOffset !== 0 || r.endContainer !== end || r.endOffset !== endAt) {
    r.setStart(open.nodes[0], 0);
    r.setEnd(end, endAt);
  }
  if (!capHidden.has(r)) capHidden.add(r);
  if (st.cap !== cap) body.style.setProperty('--cap', JSON.stringify(cap));
  if (!body.classList.contains('has-cap')) body.classList.add('has-cap');
  if (st.sig !== sig || remeasure) {
    const host = open.nodes[0].parentElement;
    const cs = getComputedStyle(host);
    const size = parseFloat(cs.fontSize) || 17;
    // as laid out on the page; from the font's own figures while the chapter isn't on screen
    let w = r.getBoundingClientRect().width / size;
    if (!w) {
      const font = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
      const key = font + '|' + cap;
      if (remeasure || !capWidths.has(key)) {
        const ctx = (setDropCap.canvas || (setDropCap.canvas = document.createElement('canvas'))).getContext('2d');
        ctx.font = font;
        capWidths.set(key, ctx.measureText(cap).width / size);
      }
      w = capWidths.get(key);
      sig = ''; // measured for real the next time it's looked at
    }
    body.style.setProperty('--cap-w', w.toFixed(4) + 'em');
  }
  st.cap = cap;
  st.sig = sig;
  queueCapCheck(body);
}

// The letter's width also turns on things no key above can name: whether the
// engine has just joined two runs of text, so that "AT" is now set as a pair.
// So once the page has settled after an edit the width is read again, as laid
// out, and put right if it's off (a pixel, when it is).
const capChecks = new Set();
let capCheckFrame = 0;
function queueCapCheck(body) {
  capChecks.add(body);
  if (capCheckFrame) return;
  capCheckFrame = requestAnimationFrame(() => {
    capCheckFrame = 0;
    const bodies = [...capChecks];
    capChecks.clear();
    const found = [];
    for (const body of bodies) {
      const st = capState.get(body);
      if (!st || !body.isConnected || !st.range.startContainer.isConnected) continue;
      const w = st.range.getBoundingClientRect().width;
      const size = w && parseFloat(getComputedStyle(st.range.startContainer.parentElement).fontSize);
      if (w && size) found.push([body, (w / size).toFixed(4) + 'em']);
    }
    for (const [body, em] of found) if (body.style.getPropertyValue('--cap-w') !== em) body.style.setProperty('--cap-w', em);
  });
}

// every chapter's cap, looked at again (the cap turned on or off, a new font)
function refreshDropCaps(remeasure = false) {
  for (const body of document.querySelectorAll('#chapters .chapter-body')) {
    const first = body.querySelector(':scope > p[data-first]');
    if (first) setDropCap(body, first, remeasure); else clearDropCap(body);
  }
}
if (document.fonts) document.fonts.addEventListener('loadingdone', () => refreshDropCaps(true));
// Words copied, cut or dragged out to another program take the paragraph's
// look with them, and the opening paragraph's would carry the little pull
// back that tucks its letter under the cap: in Word or an email, a first
// line hanging out to the left. For the moment the copy is made, that
// paragraph is set flush (nothing is drawn in between).
for (const type of ['copy', 'cut', 'dragstart']) {
  document.addEventListener(type, () => {
    document.body.classList.add('cap-copying');
    setTimeout(() => document.body.classList.remove('cap-copying'), 0);
  }, true);
}
// In focus mode selected text is given its full ink back, and the unseen
// letter with it. While a selection takes that letter in, the cap stands on a
// patch of the page's own colour, over it (cap-sel, styles.css).
document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  const r = focusLevel !== 'off' && sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0) : null;
  if (!r && !document.querySelector('#chapters .chapter-body.cap-sel')) return;
  for (const body of document.querySelectorAll('#chapters .chapter-body.has-cap, #chapters .chapter-body.cap-sel')) {
    const st = capState.get(body);
    const over = !!(r && st && st.range.startContainer.isConnected && r.isPointInRange(st.range.startContainer, 0));
    if (body.classList.contains('cap-sel') !== over) body.classList.toggle('cap-sel', over);
  }
});

function syncChapter(body, chId) {
  markDialogueOpening(body);
  chapterHTML[chId] = captureBody(body);
  wordCache[chId] = null;
  scheduleChapterSave(chId);
  updateCounters();
  scheduleNavRefresh();
}

// Text nodes are never merged behind the engine's back (by normalize()):
// its undo history points at the nodes, so ⌘Z after a cut footnote put the
// words back without the number once the caret had moved on (#477). The
// character duplication those merges were for (0.3.7): Electron 43 has no
// such issue.
let menuPoetryState = false;
let menuFlushState = false;
document.addEventListener('selectionchange', () => {
  if (!book || currentTab !== 'manuscript') return;
  const sel = window.getSelection();
  let caretP = null;
  if (sel && sel.rangeCount) {
    let el = sel.anchorNode;
    if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
    const p = el && el.closest ? el.closest('p') : null;
    if (p && p.parentElement && p.parentElement.classList.contains('chapter-body')) caretP = p;
  }
  // a script: the element in the pane, the suggestion at the caret
  if (isScript()) {
    if (caretP) spLastPara = caretP;
    spRefreshGhost();
    spShowElement();
    spHighlightScene();
  }
  // during a spellcheck pass, each chapter scans as the caret arrives
  if (spellOn && caretP) {
    const ch = caretP.closest('.chapter');
    if (ch) scanSpellingIn(ch.querySelector('.chapter-body'), ch.dataset.id);
  }
  const inPoetry = !!(caretP && caretP.classList.contains('poetry'));
  if (inPoetry !== menuPoetryState && window.neo.poetryState) {
    menuPoetryState = inPoetry;
    window.neo.poetryState(inPoetry);
  }
  const inFlush = !!(caretP && caretP.classList.contains('flush'));
  if (inFlush !== menuFlushState && window.neo.flushState) {
    menuFlushState = inFlush;
    window.neo.flushState(inFlush);
  }
});

// Does the caret sit at the start or the end of its paragraph, or after a
// space? What's pasted there opens or ends the paragraph only if so.
function caretEdges(body) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return { start: true, end: true };
  const range = sel.getRangeAt(0);
  const node = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  const block = node && node.closest('p, div, li');
  if (!block || !body.contains(block)) return { start: true, end: true };
  const pre = document.createRange();
  pre.selectNodeContents(block);
  pre.setEnd(range.startContainer, range.startOffset);
  const post = document.createRange();
  post.selectNodeContents(block);
  post.setStart(range.endContainer, range.endOffset);
  const before = pre.toString();
  const after = post.toString();
  return { start: !before.trim(), end: !after.trim(), spaced: /\s$/.test(before), spacedAfter: /^\s/.test(after), before };
}

// Reduce pasted HTML to what a manuscript is made of: paragraphs, bold,
// italic. Word, Apple Notes, Google Docs and browsers each dress a
// paragraph differently — <p>, <div>, a line break inside a block, styled
// spans — so every block boundary and <br> becomes a paragraph break, and
// styling that only lives in a style attribute is read as bold/italic.
// dashes: { style, ...caretEdges } sets dialogue dashes, for the manuscript.
function cleanPasteHtml(html, dashes) {
  // parsed off to the side: nothing in a clipboard loads or runs
  const holder = new DOMParser().parseFromString(html, 'text/html').body;
  holder.querySelectorAll('script,style,meta,link,img,head,title').forEach((n) => n.remove());
  // Google Docs wraps the whole clipboard in <b style="font-weight:normal">
  holder.querySelectorAll('b, strong').forEach((b) => {
    const w = (b.style && b.style.fontWeight || '').toLowerCase();
    if (w === 'normal' || w === '400') { while (b.firstChild) b.before(b.firstChild); b.remove(); }
  });
  // styled spans: Word's italics and bold often live only in a style attribute
  holder.querySelectorAll('span[style], font[style]').forEach((sp) => {
    const st = sp.style;
    const fw = (st.fontWeight || '').toLowerCase();
    const bold = fw === 'bold' || fw === 'bolder' || parseInt(fw, 10) >= 600;
    const ital = (st.fontStyle || '').toLowerCase() === 'italic';
    if (bold) { const b = document.createElement('b'); while (sp.firstChild) b.appendChild(sp.firstChild); sp.appendChild(b); }
    if (ital) { const i = document.createElement('i'); while (sp.firstChild) i.appendChild(sp.firstChild); sp.appendChild(i); }
    // (underline and strikethrough in a style are read by paraRuns)
  });
  // a break marker at every block edge and every line break
  const BREAK = '\uE000';
  // (a table's cells are paragraphs too: a letter or a sign set in a table
  // keeps its words)
  const blocks = 'p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre, section, article, header, footer, tr, td, th, dd, dt, caption';
  holder.querySelectorAll(blocks).forEach((b) => {
    b.before(document.createTextNode(BREAK));
    b.after(document.createTextNode(BREAK));
  });
  holder.querySelectorAll('br').forEach((br) => br.replaceWith(document.createTextNode(BREAK)));

  const paras = [[]];
  for (const r of paraRuns(holder.innerHTML)) {
    if (r.mark !== undefined || r.fn !== undefined) { paras[paras.length - 1].push(r); continue; }
    const pieces = r.text.split(BREAK);
    pieces.forEach((text, i) => {
      if (i > 0) paras.push([]);
      if (text) paras[paras.length - 1].push({ text, b: r.b, i: r.i, u: r.u, s: r.s });
    });
  }
  const filled = paras.map((runs) => runs.some((r) => r.mark === undefined && r.fn === undefined && r.text.trim()));
  const out = paras.map((runs, n) => {
    // whitespace collapses like HTML's, and each paragraph is trimmed
    runs = runs.map((r) => (r.mark !== undefined || r.fn !== undefined ? r : { ...r, text: r.text.replace(/\s+/g, ' ') }));
    // (one space is kept where the clipboard's words meet the line's own,
    // mid-line: "the " + "big" + " dog" doesn't fuse into "thebigdog")
    const first = runs.find((r) => r.mark === undefined && r.fn === undefined);
    const keepLead = dashes && n === filled.indexOf(true) && !dashes.start && !dashes.spaced;
    const keepTail = dashes && n === filled.lastIndexOf(true) && !dashes.end && !dashes.spacedAfter;
    if (first) first.text = first.text.replace(/^\s+/, keepLead && /^\s/.test(first.text) ? ' ' : '');
    const last = [...runs].reverse().find((r) => r.mark === undefined && r.fn === undefined);
    if (last) last.text = last.text.replace(/\s+$/, keepTail && /\s$/.test(last.text) ? ' ' : '');
    if (dashes) {
      dashRuns(runs, dashes.style, {
        start: n !== filled.indexOf(true) || dashes.start,
        end: n !== filled.lastIndexOf(true) || dashes.end,
        spaced: n === filled.indexOf(true) && dashes.spaced
      });
      if (dashes.quotes) quoteRuns(runs, dashes.quotes.q, dashes.quotes.sq, n === filled.indexOf(true) ? dashes.before : '');
    }
    const inner = runs.map((r) => {
      if (r.fn !== undefined) return runHtml(r);
      if (r.mark !== undefined) {
        // placeholder marks travel with their text; reconcileMarks pairs
        // each one back up with a note after the paste lands
        return r.mark
          ? `<span class="ph-mark" data-sid="${escHtml(r.mark)}" contenteditable="false">⚑</span>`
          : '';
      }
      if (!r.text) return '';
      return runHtml(r);
    }).join('');
    return inner.replace(/<[^>]+>/g, '').trim() || inner.includes('class="fn"') ? '<p>' + inner + '</p>' : '';
  }).filter(Boolean);
  // single block pastes inline (no forced new paragraph)
  if (out.length === 1) return out[0].slice(3, -4);
  return out.join('');
}

// Em dash, ellipsis, smart quotes:
// Markdown emphasis, for writers whose fingers already know it: typing the
// closing * of *word* sets it in italic, the closing ** of **word** in bold
// (_word_ and __word__ too). Only in the manuscript and Notes, only when the
// marks hug a word the way Markdown wants them to, so 2 * 3, f***, a lone
// footnote * or a snake_case name stay as typed. ⌘Z right after gives the
// marks back as plain characters.
const escRe = (c) => c.replace(/\*/g, '\\*');
// Which emphasis the typed mark closes, if any, from the paragraph's text
// before the caret: ***word*** (bold italic), **word**, *word*. Nested
// emphasis is fine: **a *b* c** and *a **b** c* both close.
function mdEmphasisMatch(before, mark) {
  const m = escRe(mark);
  const edge = `(^|[^\\p{L}\\p{N}${m}\\\\])`;
  const inner = `(?!\\s|${m})(.*?[^\\s\\\\])`;
  const tries = [
    { open: 3, part: 2, bold: true, italic: true },
    { open: 2, part: 1, bold: true, italic: false },
    { open: 1, part: 0, bold: false, italic: true }
  ];
  for (const t of tries) {
    const r = before.match(new RegExp(`${edge}${m.repeat(t.open)}${inner}${m.repeat(t.part)}$`, 'u'));
    // the inner text must not end on the mark itself (that is a longer mark
    // still being typed), nor hold an emphasis opened but not yet closed
    // (in *a **b the next * closes **b, not *a)
    if (r && !r[2].endsWith(mark) && !(t.part === 0 && before.endsWith(mark)) && balancedRuns(r[2], mark)) {
      return { ...t, inner: r[2], start: before.length - (r[0].length - r[1].length) };
    }
  }
  return null;
}
function balancedRuns(text, mark) {
  const counts = {};
  for (const run of text.match(new RegExp(escRe(mark) + '+', 'g')) || []) counts[run.length] = (counts[run.length] || 0) + 1;
  return Object.values(counts).every((n) => n % 2 === 0);
}
// character offset within el → a (text node, offset) point
function pointAt(el, offset) {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n; let left = offset; let last = null;
  while ((n = walk.nextNode())) {
    if (left <= n.textContent.length) return { node: n, offset: left };
    left -= n.textContent.length;
    last = n;
  }
  return last ? { node: last, offset: last.textContent.length } : { node: el, offset: 0 };
}
function selectChars(el, from, to) {
  const a = pointAt(el, from); const b = pointAt(el, to);
  const r = document.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(b.node, b.offset);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}
let mdJustSet = null; // what was just turned into styling, for ⌘Z
// ~~struck~~ as it's typed: the second closing ~ strikes the words through
function markdownStrike(e, body, range) {
  if (markdownOff()) return false;
  if (e.key !== '~' || !range.collapsed) return false;
  if (!body.matches || !body.matches('.chapter-body, #aux-editor')) return false;
  const start = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  const block = (start && start.closest('p, div, li')) || body;
  if (!body.contains(block)) return false;
  const pre = document.createRange();
  pre.setStart(block, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  const before = pre.toString();
  const m = before.match(/(^|[^~\\])~~(?![\s~])(.*?[^\s\\~])~$/u);
  if (!m) return false;
  e.preventDefault();
  const end = before.length;
  const at = end - m[0].length + m[1].length; // where the opening ~~ sits
  let steps = 0;
  selectChars(block, end - 1, end); document.execCommand('delete'); steps++;
  selectChars(block, at, at + 2); document.execCommand('delete'); steps++;
  const innerEnd = end - 3;
  selectChars(block, at, innerEnd);
  if (!document.queryCommandState('strikeThrough')) { document.execCommand('strikeThrough'); steps++; }
  selectChars(block, innerEnd, innerEnd);
  if (document.queryCommandState('strikeThrough')) document.execCommand('strikeThrough');
  mdJustSet = { steps, key: e.key, block, end: innerEnd + 3 };
  return true;
}
function markdownEmphasis(e, body, range) {
  if (markdownStrike(e, body, range)) return true;
  if (markdownOff()) return false;
  if (e.key !== '*' && e.key !== '_') return false;
  if (!body.matches || !body.matches('.chapter-body, #aux-editor')) return false;
  if (!range.collapsed) return false;
  const start = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  const block = (start && start.closest('p, div, li')) || body;
  if (!body.contains(block)) return false;
  const pre = document.createRange();
  pre.setStart(block, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  const before = pre.toString();
  const hit = mdEmphasisMatch(before, e.key);
  if (!hit) return false;
  e.preventDefault();
  let steps = 0;
  const end = before.length;
  // the part of the closing mark already typed, then the opening mark
  if (hit.part) { selectChars(block, end - hit.part, end); document.execCommand('delete'); steps++; }
  selectChars(block, hit.start, hit.start + hit.open);
  document.execCommand('delete'); steps++;
  // the words between them get the styling ⌘B and ⌘I give
  const innerEnd = end - hit.part - hit.open;
  const cmds = [hit.italic && 'italic', hit.bold && 'bold'].filter(Boolean);
  for (const cmd of cmds) {
    selectChars(block, hit.start, innerEnd);
    if (!document.queryCommandState(cmd)) { document.execCommand(cmd); steps++; }
  }
  selectChars(block, innerEnd, innerEnd);
  // what comes next is typed plain again
  for (const cmd of cmds) if (document.queryCommandState(cmd)) document.execCommand(cmd);
  mdJustSet = { steps, key: e.key, block, end };
  return true;
}
// a key pressed on its own on the way to a shortcut
const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Shift', 'Alt', 'AltGraph', 'CapsLock', 'OS']);
// A pasted line of Markdown as HTML with <b> and <i>, or null when it has
// no emphasis (so ordinary text keeps pasting as text). Same rules as typing.
function markdownInline(line) {
  const edge = '(^|[^\\p{L}\\p{N}*_\\\\])';
  const tail = '(?![\\p{L}\\p{N}])';
  let html = escHtml(line);
  const before = html;
  html = html.replace(new RegExp(`${edge}(\\*\\*\\*|___)(?!\\s)(.+?)(?<![\\s\\\\])\\2${tail}`, 'gu'), '$1<b><i>$3</i></b>');
  html = html.replace(new RegExp(`${edge}(\\*\\*|__)(?!\\s)(.+?)(?<![\\s\\\\])\\2${tail}`, 'gu'), '$1<b>$3</b>');
  html = html.replace(new RegExp(`${edge}(\\*|_)(?![\\s*_])(.+?)(?<![\\s\\\\*_])\\2${tail}`, 'gu'), '$1<i>$3</i>');
  html = html.replace(/(^|[^~\\])~~(?![\s~])(.+?)(?<![\s\\~])~~(?!~)/gu, '$1<s>$2</s>');
  return html === before ? null : html;
}
// ⌘Z (Ctrl+Z) right after: the styling goes and the marks come back as typed
document.addEventListener('keydown', (e) => {
  if (MODIFIER_KEYS.has(e.key)) return; // the ⌘ or Ctrl of ⌘Z, on its way
  const just = mdJustSet;
  mdJustSet = null;
  if (!just || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || keyLetter(e) !== 'z') return;
  e.preventDefault();
  e.stopPropagation();
  for (let i = 0; i < just.steps; i++) document.execCommand('undo');
  // the text is back as it was typed; the mark that was about to close it goes in
  if (just.block.isConnected) selectChars(just.block, just.end, just.end);
  document.execCommand('insertText', false, just.key);
}, true);

// Dialogue dashes as you type (see dialogueDashEdits): a hyphen turns once
// the key after it shows what it is. The key then goes on as usual, so a
// quote after the dash still opens or closes. The opening dash is the
// manuscript's only: Notes and Outline keep their "- " lists.
let dashJustSet = null; // the dash just set, for ⌘Z
function dialogueDashKey(e, body) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.keyCode === 229) return;
  if (body.classList.contains('script-body')) return; // a script keeps the hyphens it is typed with (#460)
  const key = e.key === 'Enter' ? '' : e.key;
  if (key.length > 1) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return;
  const start = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  let block = start && start.closest('p, div, li');
  if (!block || !body.contains(block)) block = body;
  // a script's headings, names and transitions keep their hyphens (INT. HOUSE - DAY)
  if (block.matches('.sp-heading, .sp-character, .sp-transition, .sp-shot')) return;
  const pre = document.createRange();
  pre.setStart(block, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  const before = pre.toString();
  // the hyphen opening the paragraph, or the one just behind the caret
  let from;
  if (/^-\s*$/.test(before) && body.matches('.chapter-body')) from = 0;
  else if (/\s-$/.test(before)) from = before.length - 2;
  else return;
  const edit = dialogueDashEdits(before.slice(from) + key, dashStyle(), { start: from === 0, end: !key })[0];
  if (!edit) return;
  const at = from + edit.at;
  selectChars(block, at, at + edit.from.length);
  document.execCommand('insertText', false, edit.to);
  if (key) dashJustSet = { block, at, was: edit.from, to: edit.to, key };
}
// ⌘Z (Ctrl+Z) right after: the hyphen comes back as typed
document.addEventListener('keydown', (e) => {
  if (MODIFIER_KEYS.has(e.key)) return; // the ⌘ or Ctrl of ⌘Z, on its way
  const just = dashJustSet;
  dashJustSet = null;
  if (!just || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || keyLetter(e) !== 'z' || !just.block.isConnected) return;
  e.preventDefault();
  e.stopPropagation();
  selectChars(just.block, just.at, just.at + just.to.length);
  document.execCommand('insertText', false, just.was);
  const caret = just.at + just.was.length + just.key.length;
  selectChars(just.block, caret, caret);
}, true);

// Swap the last n typed characters for text. They are selected and typed
// over, so the new text takes their styling: deleting them first leaves the
// caret in whatever sits before them, and after an italic word the dash
// (and everything typed after it) would come out italic.
function replaceBefore(n, text) {
  const sel = window.getSelection();
  for (let i = 0; i < n; i++) sel.modify('extend', 'backward', 'character');
  document.execCommand('insertText', false, text);
}

// Capitals as you type, in the manuscript: a sentence's first letter (at a
// paragraph's start, or after a full stop that isn't an ellipsis or an
// abbreviation; the same rules as capitalSlips) and, in English, "i" on its
// own. ⌘Z (Ctrl+Z) right after keeps the lowercase. Poetry is left alone.
let capJustSet = null; // the capital just set, for ⌘Z
// macOS press-and-hold (View → Press and hold for accents): the held letter
// must reach the system untouched, so a sentence's first letter is typed as it
// is and capitalised at the next key, whether it stayed or the picker made é.
let pressHoldOn = false;
try { pressHoldOn = !!(window.neo && window.neo.pressHold && window.neo.pressHold()); } catch (_) { /* not on a Mac */ }
let capPending = null; // { block, at } a letter waiting for its capital
function capPendingResolve(body) {
  const p = capPending;
  capPending = null;
  if (!p || !p.block.isConnected || !body.contains(p.block)) return;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.getRangeAt(0).collapsed) return;
  const range = sel.getRangeAt(0);
  if (!p.block.contains(range.startContainer)) return;
  const pre = document.createRange();
  pre.setStart(p.block, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  const caret = pre.toString().length;
  if (caret <= p.at) return;
  selectChars(p.block, p.at, p.at + 1);
  const was = window.getSelection().toString();
  const to = was.toLocaleUpperCase(writingLanguage());
  if (was && to !== was && was !== was.toLocaleUpperCase(writingLanguage()) && /\p{L}/u.test(was)) {
    document.execCommand('insertText', false, to);
    capJustSet = { block: p.block, at: p.at, was, to, key: '' };
  }
  selectChars(p.block, caret, caret);
}
function autoCapKey(e, body) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.keyCode === 229) return;
  if (pressHoldOn) {
    if (e.repeat) return;
    if (capPending && !MODIFIER_KEYS.has(e.key)) capPendingResolve(body);
  }
  if (e.key.length !== 1 || !body.matches('.chapter-body')) return;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.getRangeAt(0).collapsed) return;
  const range = sel.getRangeAt(0);
  const start = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  const block = start && start.closest('p');
  if (!block || !body.contains(block) || block.matches('.poetry, .litrpg, .scene-break, .sp-paren')) return;
  const pre = document.createRange();
  pre.setStart(block, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  const before = pre.toString();
  const lang = writingLanguage();
  // a lowercase letter where a sentence starts
  if (e.key !== e.key.toLocaleUpperCase(lang) && /\p{L}/u.test(e.key)) {
    let starts = /^[\s"'“‘„«»(\[¿¡—–-]*$/.test(before);
    if (!starts && /(?<!\.)\.\s+["'“‘„«(\[]?$/.test(before)) {
      const word = (before.replace(/\.\s+["'“‘„«(\[]?$/, '.').match(/([\p{L}.]+)\.$/u) || [])[1] || '';
      starts = !CAPS_ABBREV.has(word.toLowerCase()) && !/^\p{L}$/u.test(word);
    }
    if (!starts) return;
    if (pressHoldOn) { capPending = { block, at: before.length }; return; }
    e.preventDefault();
    const to = e.key.toLocaleUpperCase(lang);
    document.execCommand('insertText', false, to);
    capJustSet = { block, at: before.length, was: e.key, to, key: '' };
    return;
  }
  // English: "i" standing alone becomes "I" once the next key shows it is
  // a word (a space, punctuation, an apostrophe), and the key goes on as usual
  if (/^en\b/.test(lang) && /^[\s,;:!?'’")”\]—–-]$/.test(e.key) && /(?:^|[^\p{L}\p{M}\d'’.(-])i$/u.test(before)) {
    const at = before.length - 1;
    selectChars(block, at, at + 1);
    document.execCommand('insertText', false, 'I');
    capJustSet = { block, at, was: 'i', to: 'I', key: e.key };
  }
}
// ⌘Z (Ctrl+Z) right after: the lowercase comes back as typed
document.addEventListener('keydown', (e) => {
  if (MODIFIER_KEYS.has(e.key)) return; // the ⌘ or Ctrl of ⌘Z, on its way
  const just = capJustSet;
  capJustSet = null;
  if (!just || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || keyLetter(e) !== 'z' || !just.block.isConnected) return;
  e.preventDefault();
  e.stopPropagation();
  selectChars(just.block, just.at, just.at + 1);
  document.execCommand('insertText', false, just.was);
  // a key typed after the "i" stays, with the caret past it
  const caret = just.at + 1 + just.key.length;
  selectChars(just.block, caret, caret);
}, true);

function smartKeys(e, body) {
  // a field can reach smartKeys twice (its own handler and the page-wide
  // one below): the first pass wins
  if (e.defaultPrevented) return;
  if (litrpgKey(e, body)) return;
  dialogueDashKey(e, body);
  autoCapKey(e, body);
  if (e.defaultPrevented) return;
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

  if (markdownEmphasis(e, body, range)) return;
  // German sets its dash as an en dash – like this –, so there -- makes
  // one, and a third hyphen the em dash (#286). A script keeps -- and ...
  // as typed: that is how a screenplay writes a dash and a trailing off
  // (and how Final Draft and Fountain read them, #460)
  const german = writingLanguage().toLowerCase().startsWith('de');
  const script = body.classList.contains('script-body');
  if (!script && e.key === '-' && prevChars(1) === '-') {
    e.preventDefault();
    replaceBefore(1, german ? '–' : '—');
    return;
  }
  if (!script && german && e.key === '-' && prevChars(1) === '–') {
    e.preventDefault();
    replaceBefore(1, '—');
    return;
  }
  if (!script && e.key === '.' && prevChars(2) === '..') {
    e.preventDefault();
    replaceBefore(2, '…'); // …
    return;
  }
  const french = frenchTypography();
  // French: a narrow no-break space (U+202F) before ; : ! ? replaces the
  // ordinary space typed ahead of them. (The wider U+00A0 is not used: the
  // editing engine turns it back into a plain space, and NEO heals it away.)
  // Quebec usage (OQLF) keeps the space before the colon only.
  const spaced = french === 'ca' ? /^:$/ : /^[;:!?]$/;
  if (french && spaced.test(e.key) && /^[ \u00a0]$/.test(prevChars(1))) {
    e.preventDefault();
    document.execCommand('delete');
    document.execCommand('insertText', false, '\u202f' + e.key);
    return;
  }
  if (e.key === '"' || e.key === "'") {
    e.preventDefault();
    const double = e.key === '"';
    const ch = typedQuote(e.key, prevChars(8), double ? bookQuotes(body) : null, double ? null : singleQuotes(body),
      (q, straight) => quoteIsOpen(range, q, straight));
    document.execCommand('insertText', false, ch);
  }
}

// Is a quotation open at the caret, in the paragraph so far?
function quoteIsOpen(range, q, straight) {
  let el = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  const block = el && el.closest ? el.closest('p, div') : null;
  if (!block) return false;
  const pre = document.createRange();
  pre.selectNodeContents(block);
  try { pre.setEnd(range.startContainer, range.startOffset); } catch { return false; }
  return quoteOpenIn(pre.toString(), q, straight);
}
// The count itself: opening marks against closing ones; an apostrophe (’
// between two letters) is no quote. Straight marks ("), which text imported
// or pasted from a plain-text editor arrives with, have no side of their
// own: they pair up in turn, so an odd one out is an open quotation.
function quoteOpenIn(text, q, straight = '') {
  const open = q.open.trim();
  const close = q.close.trim();
  let depth = 0;
  let straights = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (straight && c === straight) straights++;
    else if (c === open && open === close) depth = depth ? 0 : 1;
    else if (c === open) depth++;
    else if (c === close) {
      if (close === '’' && /\p{L}/u.test(text[i - 1] || '') && /\p{L}/u.test(text[i + 1] || '')) continue;
      depth = Math.max(0, depth - 1);
    }
  }
  return depth > 0 || straights % 2 === 1;
}

// What a typed " or ' becomes. before: the text just before the caret (in
// its text node); q: the double marks, sq: the single ones (null where '
// is only an apostrophe); isOpen(marks, straight): is a quotation in those
// marks open in the paragraph so far (quoteIsOpen).
function typedQuote(key, before, q, sq, isOpen) {
  const last = before.slice(-1);
  let opening = quoteOpensAfter(before);
  // after a dash, a quote usually closes speech that was cut off ("I was
  // just—"); it opens one only when no quotation is open in the paragraph
  if (last === '—' || last === '–') opening = !isOpen(key === '"' ? q : { open: '‘', close: '’' }, key === '"' ? '"' : '');
  if (key === '"') return opening ? q.open : q.close;
  // most languages type ' as an apostrophe only; English, Dutch and
  // German also open (and German closes) single quotes with it
  if (!sq) return '’';
  if (opening) return sq.open;
  // German's closing mark isn't its apostrophe: it closes only a single
  // quotation that is open in the paragraph
  if (sq.close !== '’' && isOpen(sq, '')) return sq.close;
  return '’';
}
// Does a quote typed after this text open one? At the start, after a space
// or a bracket, or after an opening mark (»› and „‚ nest), it does. But
// ‘ “ « » › ‹ open in some languages and close in others: German »…›…‹«
// and „…‚…‘“ close with the marks English and Swiss writing open with. So
// a run of them faces the way the text before it says: after a word or
// its punctuation (or French's narrow space before »), they closed a
// quotation, and the quote typed next closes the one around it (#410).
function quoteOpensAfter(before) {
  let i = before.length;
  while (i > 0 && /[‘“«»›‹]/.test(before[i - 1])) i--;
  if (i === before.length) return before === '' || /[\s([{„‚>]/.test(before[i - 1]);
  return !/[\p{L}\p{N}\p{M}.,;:!?…)\]}’”\u202f]/u.test(before[i - 1] || '');
}

// Incoming prose follows the same rules as typing. Existing typographic
// marks stay as written, and the paragraph before a paste supplies context.
function incomingQuotes(text, q, sq, before = '') {
  let out = '';
  for (const key of text) {
    if (key !== '"' && key !== "'") { out += key; continue; }
    const prefix = before + out;
    out += typedQuote(key, prefix, q, sq, (marks, straight) => quoteOpenIn(prefix, marks, straight));
  }
  return out;
}
// Keep quotation context across bold/italic runs without changing their
// markup or touching a footnote or placeholder's metadata.
function quoteRuns(runs, q, sq, before = '') {
  for (const run of runs) {
    if (typeof run.text !== 'string' || run.mark !== undefined || run.fn !== undefined) continue;
    run.text = incomingQuotes(run.text, q, sq, before);
    before += run.text;
  }
}

// The quotation marks of the language being written: the spellcheck
// language when one is set, otherwise NEO's own language.
const QUOTE_STYLES = {
  en: { open: '“', close: '”', singles: true },
  nl: { open: '“', close: '”', singles: true },
  pt: { open: '“', close: '”', singles: true },          // Brazil
  'pt-PT': { open: '«', close: '»' },
  fr: { open: '«\u202f', close: '\u202f»' },             // narrow no-break spaces inside
  es: { open: '«', close: '»' },                          // RAE: « » first
  it: { open: '«', close: '»' },
  de: { open: '»', close: '«' },                          // novels: »…« (#353); a book in „…“ keeps it (bookQuotes)
  'de-CH': { open: '«', close: '»' },                     // Swiss: «…»
  pl: { open: '„', close: '”' },
  ro: { open: '„', close: '”' },
  ru: { open: '«', close: '»' },
  uk: { open: '«', close: '»' },
  el: { open: '«', close: '»' },
  hu: { open: '„', close: '”' },
  sv: { open: '”', close: '”' },
  da: { open: '»', close: '«' },                          // »…« (or „…“, kept by bookQuotes)
  ko: { open: '“', close: '”', singles: true }            // ‘…’ inside, as in English
};
// The single quotation marks, where ' types them: English and Dutch ‘…’;
// German ‚…‘, or ›…‹ in a book set in »…«, or ‹…› in Swiss «…» (#286).
// Elsewhere ' is an apostrophe only.
function singleQuotes(el) {
  const q = quoteStyle();
  if (q.singles) return { open: '‘', close: '’' };
  if (!writingLanguage().toLowerCase().startsWith('de')) return null;
  const d = bookQuotes(el).open.trim();
  if (d === '»') return { open: '›', close: '‹' };
  if (d === '«') return { open: '‹', close: '›' };
  return { open: '‚', close: '‘' };
}
function writingLanguage() {
  return (library && library.spellLanguage) || NeoI18n.getLocale();
}
function quoteStyle() {
  const code = writingLanguage();
  return QUOTE_STYLES[code] || QUOTE_STYLES[code.split('-')[0]] || QUOTE_STYLES.en;
}
// …unless the book has settled on guillemets its language doesn't use:
// German novels often set »…« where the language says „…“, Swiss writing
// «…». Whichever mark opens the most quotes wins — in this chapter, or in
// the book when the chapter has none yet — so a » typed by hand once is
// enough to carry on in that style.
function bookQuotes(el) {
  const q = quoteStyle();
  const opens = (text) => {
    const n = (re) => (text.match(re) || []).length;
    const own = q.open.trim();
    return { '»': own === '»' ? 0 : n(/»(?=[\p{L}\p{N}])/gu), '«': own === '«' ? 0 : n(/«(?=[\p{L}\p{N}])/gu), '„': own === '„' ? 0 : n(/„(?=[\p{L}\p{N}])/gu), own: n(new RegExp(own + '\\s?(?=[\\p{L}\\p{N}])', 'gu')) };
  };
  const body = el && el.closest ? el.closest('.chapter-body') : null;
  // paragraph by paragraph: one ending in » and the next starting with a
  // letter don't make an opening »
  const text = !body ? '' : body.children ? [...body.children].map((p) => p.textContent).join('\n') : body.textContent;
  let c = opens(text);
  if (!c['»'] && !c['«'] && !c['„'] && !c.own && book) c = opens(book.chapterOrder.map((id) => chapterHTML[id] || '').join(' '));
  // a German or Danish book already written in „…“ keeps its marks
  if (c['„'] > c.own && c['„'] >= c['»'] && c['„'] >= c['«'] && /^(de|da)\b/i.test(writingLanguage())) return { open: '„', close: '“' };
  if (c['»'] > c.own && c['»'] >= c['«']) return { open: '»', close: writingLanguage().split('-')[0] === 'sv' ? '»' : '«' };
  if (c['«'] > c.own && c['«'] > c['»']) return { open: '«', close: '»' };
  return q;
}

// A hyphen standing on its own is a dash the keyboard didn't have. At the
// start of a paragraph it opens speech, spaced the way the language sets
// dialogue (— Olá, —Hola; elsewhere as typed). After a space, with a space,
// a closing quote, punctuation or the paragraph's end behind it, it becomes
// the language's dash and the spaces stay as typed. Hyphens in words
// (guarda-chuva), suspended ones (pré- e pós-), and those before a digit
// (-5) or a suffix (-mente) stay hyphens.
const DIALOGUE_DASHES = {
  pt: { open: '—', space: ' ', mid: '—' },   // — Olá — diz ela.
  ru: { open: '—', space: ' ', mid: '—' },
  uk: { open: '—', space: ' ', mid: '—' },
  hu: { open: '–', space: ' ', mid: '–' },   // – Szia – mondta.
  es: { open: '—', space: '', mid: '—' },    // —Hola —dijo él—.
  en: { open: '—', mid: '–' }                // and every other language: word – word
};
const DASH_OPEN = /^-(?:(\s+)(?=[^\s-])|(?=[^\s\d-]))/u;
// (a quote typed right after the hyphen closes whatever comes next)
const DASH_MID = /(?<=\s)-(?=["'“”‘’«»„]*(?:[\s.,;:!?…)\]]|$)|["'“”‘’«»„]+\uE000)/gu;
// The changes, as { at, from, to }. start / end: whether the text begins or
// ends its paragraph (a fragment pasted mid-sentence does neither); spaced:
// whether a space comes before it.
function dialogueDashEdits(text, style, { start = true, end = true, spaced = false } = {}) {
  // a scene break, or a paragraph of nothing but dashes
  if (start && end && /^[\s*#•~⁂—–-]*$/.test(text)) return [];
  const edits = [];
  const open = start && text.match(DASH_OPEN);
  if (open) edits.push({ at: 0, from: open[0], to: style.open + (style.space !== undefined ? style.space : open[1] || '') });
  // past the end of a fragment, anything could follow
  const lead = !start && spaced ? ' ' : '';
  const probe = lead + text + (end ? '' : '\uE000');
  for (const m of probe.matchAll(DASH_MID)) edits.push({ at: m.index - lead.length, from: '-', to: style.mid });
  return edits;
}
function dialogueDashes(text, style, edges) {
  return dialogueDashEdits(text, style, edges).reduceRight(
    (s, e) => s.slice(0, e.at) + e.to + s.slice(e.at + e.from.length), text);
}
// The same across a pasted paragraph's runs of bold and italic: each change
// lands in the run that holds it
function dashRuns(runs, style, edges) {
  const texts = runs.filter((r) => r.mark === undefined);
  const edits = dialogueDashEdits(texts.map((r) => r.text).join(''), style, edges);
  for (const e of edits.reverse()) {
    let pos = 0;
    for (const r of texts) {
      if (e.at >= pos && e.at + e.from.length <= pos + r.text.length) {
        r.text = r.text.slice(0, e.at - pos) + e.to + r.text.slice(e.at - pos + e.from.length);
        break;
      }
      pos += r.text.length;
    }
  }
}
function dashStyle() {
  const code = writingLanguage();
  return DIALOGUE_DASHES[code] || DIALOGUE_DASHES[code.split('-')[0]] || DIALOGUE_DASHES.en;
}

// French typographic rules apply when the book is spellchecked in French,
// or when NEO itself speaks French. Returns false, 'fr', or 'ca' for Quebec
// usage (when the interface is set to Canadian French).
function frenchTypography() {
  if (!writingLanguage().startsWith('fr')) return false;
  return /^fr-CA$/i.test(NeoI18n.getLocale()) ? 'ca' : 'fr';
}

// ⌥⌘→ / ⌥⌘← (Ctrl+Alt on Windows and Linux): the next or previous tab,
// Manuscript → Notes → Outline → Darlings, round again. Caught here, like the
// chapter keys, so no menu accelerator flashes the menu or takes AltGr input.
function goToTab(name) {
  if (!book || $('#editor-view').hidden || name === currentTab) return;
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  switchTab(name);
}
const TAB_ORDER = ['manuscript', 'notes', 'outline', 'darlings'];
window.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const cmd = IS_POCKET ? (e.metaKey !== e.ctrlKey) : (IS_MAC ? e.metaKey : e.ctrlKey);
  if (!cmd || !e.altKey || e.shiftKey || e.isComposing) return;
  if ($('#editor-view').hidden || document.querySelector('.modal-backdrop:not([hidden])')) return;
  e.preventDefault();
  e.stopPropagation();
  const step = e.key === 'ArrowRight' ? 1 : TAB_ORDER.length - 1;
  goToTab(TAB_ORDER[(TAB_ORDER.indexOf(currentTab) + step) % TAB_ORDER.length]);
}, true);

// Titles, outline lines, notes and shelf names get the same typography as
// the manuscript (which calls smartKeys itself). Capture phase, because
// those fields keep their keystrokes from bubbling to the page.
document.addEventListener('keydown', (e) => {
  const el = e.target;
  if (e.defaultPrevented || !el || !el.isContentEditable || el.closest('.chapter-body')) return;
  smartKeys(e, el);
}, true);

// Title page: Enter drops you into Chapter One.
$('#tp-title').addEventListener('keydown', titleEnter);
$('#tp-subtitle').addEventListener('keydown', titleEnter);
// the author's line too: a new book's first page used to wait for a trip
// to the Outline when Enter came from here
$('#tp-author').addEventListener('keydown', titleEnter);
function titleEnter(e) {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  // into the story, past any pages that come before it
  const first = book.chapterOrder.find((c) => isStory(c));
  if (first) focusChapter(first);
  else focusChapter(createChapterAt(storyEnd()));
}
// A script's title is set in bold, underline or italic as a whole (⌘B, ⌘U,
// ⌘I on the title page), kept as book.titleStyle and carried into the PDF,
// Fountain and Final Draft. A book's title page is designed by its exports.
$('#tp-title').addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
  const k = ({ b: 'b', u: 'u', i: 'i' })[keyLetter(e)];
  if (!k) return;
  e.preventDefault();
  if (!book || !isScript()) return;
  const st = { ...(book.titleStyle || {}) };
  if (st[k]) delete st[k]; else st[k] = true;
  if (Object.keys(st).length) book.titleStyle = st; else delete book.titleStyle;
  showTitleStyle();
  scheduleMetaSave();
}, true);
function showTitleStyle() {
  const st = (book && isScript() && book.titleStyle) || {};
  const el = $('#tp-title');
  el.classList.toggle('tp-b', !!st.b);
  el.classList.toggle('tp-u', !!st.u);
  el.classList.toggle('tp-i', !!st.i);
}
$('#tp-title').addEventListener('input', () => {
  book.title = $('#tp-title').textContent.trim() || t('Untitled');
  showWindowTitle();
  scheduleMetaSave();
});
$('#tp-subtitle').addEventListener('input', () => {
  book.subtitle = $('#tp-subtitle').textContent.trim();
  scheduleMetaSave();
});
// each book can carry its own pen name
$('#tp-author').addEventListener('input', () => {
  book.author = $('#tp-author').textContent.trim();
  scheduleMetaSave();
});

// Which logical shortcut a keyboard event means.
//
// Matched by the CHARACTER the key types, not the position it sits at: the help
// overlay names characters (⌘/), and a character is what a menu accelerator can
// name. A physical fallback catches the layouts where that character needs a
// modifier the accelerator cannot spell — on Swiss German `/` is Shift+7 and
// `;` is Shift+`,`, and on German `ö` sits on the `;` key — and every fallback
// skips the character the menu already handles, so one press fires one action.
function isSpellcheckShortcut(e) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
  // the menu shows ⌘; but leaves the key to the window (main.js), so the
  // character itself, Shift or not, is the shortcut
  if (e.key === ';') return true;
  return e.code === 'Semicolon' && ![';', ':', '/', '?'].includes(e.key);
}
function isLargerTextShortcut(e) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
  return e.key === '+' || e.key === '=' || e.code === 'NumpadAdd';
}
function isSmallerTextShortcut(e) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
  return e.key === '-' || e.code === 'NumpadSubtract';
}
function isHelpShortcut(e) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
  return e.key === '/' || e.key === '?';
}

// Global editor shortcuts
document.addEventListener('keydown', (e) => {
  if (document.querySelector('.modal-backdrop:not([hidden])')) return; // visible modals own the keyboard
  // The text-size pair keeps the menu's own keys on the layouts where they
  // match, and takes over by character where they do not (`+` is Shift+1 on
  // Swiss German, so CmdOrCtrl-Plus never fires there). It stands before the
  // editor check: on the shelf the same keys size the covers (#364).
  if (isLargerTextShortcut(e) || isSmallerTextShortcut(e)) {
    e.preventDefault();
    void setEditorFontSize(isLargerTextShortcut(e) ? 1 : -1);
    return;
  }
  if ($('#editor-view').hidden) return;
  const cmd = e.metaKey || e.ctrlKey;
  if (cmd && e.shiftKey && keyLetter(e) === 'x') {
    e.preventDefault();
    if (currentTab === 'manuscript') insertPlaceholder();
  }
  if (cmd && e.shiftKey && keyLetter(e) === 'd') {
    e.preventDefault();
    if (currentTab === 'manuscript') darlingFromKeyboard();
  }
  if (cmd && e.shiftKey && !e.altKey && keyLetter(e) === 'n') {
    e.preventDefault();
    if (currentTab === 'manuscript' && !fnBox && featureOn('footnotes')) insertFootnote();
  }
  // ⌘S takes a snapshot of the book (SNAPSHOTS)
  if (cmd && !e.altKey && !e.shiftKey && keyLetter(e) === 's') {
    e.preventDefault();
    snapshotNow();
  }
  if (isSpellcheckShortcut(e)) {
    e.preventDefault();
    toggleSpellcheck();
  }
  if (e.key === 'Escape') {
    // an input method's Esc cancels its own composition, nothing more
    if (e.isComposing || e.keyCode === 229) return;
    // an open spelling menu closes; the book stays open
    const spellMenu = document.querySelector('.spell-menu');
    if (spellMenu) { e.preventDefault(); spellMenu.remove(); return; }
    // from the find bar's buttons too (the arrows take the focus when
    // clicked): back to the page. Typing on the page with the bar still
    // open, Esc only closes the bar and leaves the caret where it is.
    const inBar = !document.activeElement || document.activeElement === document.body || $('#searchbar').contains(document.activeElement);
    if (!$('#searchbar').hidden) { if (inBar) returnFromSearch(); else closeSearch(); }
    else window.neo.fullscreenEscape().then((exited) => { if (!exited) backToShelf(); });
  }
});

// The help character works on every layout, editor or shelf: ⌘/ needs Shift+7
// on Swiss German, which the bare-character accelerator cannot name, so the
// renderer catches the character the layout produced.
document.addEventListener('keydown', (e) => {
  if (!isHelpShortcut(e)) return;
  e.preventDefault();
  showHelp();
});

// ⌥⌘↓ / ⌥⌘↑ (Ctrl+Alt on Windows and Linux): next or previous chapter.
// No menu item carries these any more, so the window catches them itself —
// first, before the page or the outline can read them as plain arrows.
// Pocket takes both: a keyboard paired with a phone or an iPad may be a
// Mac's (⌘ arrives as Meta) or a PC's (Ctrl).
// Off the Mac, Ctrl+Page Down / Ctrl+Page Up do the same: GNOME keeps
// Ctrl+Alt+↑↓ for switching workspaces, so NEO never hears them there, and
// some Windows graphics drivers turn the screen with them (#254).
window.addEventListener('keydown', (e) => {
  const arrows = e.key === 'ArrowDown' || e.key === 'ArrowUp';
  const pages = e.key === 'PageDown' || e.key === 'PageUp';
  if (!arrows && !pages) return;
  const cmd = IS_POCKET ? (e.metaKey !== e.ctrlKey) : (IS_MAC ? e.metaKey : e.ctrlKey);
  if (arrows && (!cmd || !e.altKey || e.shiftKey)) return;
  if (pages && ((IS_MAC && !IS_POCKET) || !e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)) return;
  if ($('#editor-view').hidden || document.querySelector('.modal-backdrop:not([hidden])')) return;
  e.preventDefault();
  e.stopPropagation();
  gotoChapter(e.key === 'ArrowDown' || e.key === 'PageDown' ? 1 : -1);
}, true);
