'use strict';

/* ================================================================== */
/*  FIND & REPLACE                                                     */
/* ================================================================== */

let searchState = { matches: [], idx: -1, query: '' };
// where the caret was on the page when Find opened, and whether vim's / opened
// it: Esc in the find bar goes back there (see returnFromSearch)
let searchHome = null;
let searchFromVim = false;

// the editable a range sits in: a chapter, the Notes, an outline line
function editableOf(range) {
  const n = range && (range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer);
  return (n && n.closest && n.closest('[contenteditable="true"]')) || null;
}

function openSearch(fromVim = false) {
  if ($('#editor-view').hidden || !book) { toast(t('Open a book first')); return; }
  const sel = window.getSelection();
  const preset = sel && !sel.isCollapsed ? sel.toString().slice(0, 80).trim() : '';
  // ⌘F again from the bar itself keeps the place it first came from
  if (sel && sel.rangeCount && editableOf(sel.getRangeAt(0))) searchHome = sel.getRangeAt(0).cloneRange();
  searchFromVim = fromVim;
  $('#searchbar').hidden = false;
  const inp = $('#search-input');
  if (preset) inp.value = preset;
  inp.focus();
  inp.select();
  runSearch();
}

function closeSearch() {
  $('#searchbar').hidden = true;
  searchState = { matches: [], idx: -1, query: '' };
  searchFromVim = false;
  if (window.CSS && CSS.highlights) {
    CSS.highlights.delete('neo-search');
    CSS.highlights.delete('neo-search-current');
  }
}

// Esc in the find bar. Hiding the bar took the caret with it, so the writer
// was nowhere, and the next Esc closed the book. Now the caret goes back to
// the page: to the match last gone to, or else where it was before Find.
// A search vim's / began goes back to moving, as in vim.
function returnFromSearch() {
  const m = searchState.idx >= 0 && searchState.matches[searchState.idx];
  let r = null;
  if (m && m.range.startContainer.isConnected) { r = m.range.cloneRange(); r.collapse(true); }
  else if (searchHome && searchHome.startContainer.isConnected) r = searchHome.cloneRange();
  const fromVim = searchFromVim;
  closeSearch();
  const ed = editableOf(r);
  if (!ed) return;
  ed.focus({ preventScroll: true });
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
  revealCaret();
  if (fromVim && vimEnabled && vimEditor(ed)) vimSetNav(true);
}

function paintHighlights() {
  if (!window.Highlight || !window.CSS || !CSS.highlights) return;
  const all = new Highlight();
  const cur = new Highlight();
  searchState.matches.forEach((m, i) => {
    (i === searchState.idx ? cur : all).add(m.range);
  });
  CSS.highlights.set('neo-search', all);
  CSS.highlights.set('neo-search-current', cur);
}

// Find searches the tab you're in: the whole manuscript, first chapter to
// last, or the Notes page, the outline's lines, the Darlings. Replace stays
// with the manuscript, where ⌘Z can take a Replace All back.
function searchRoots() {
  if (currentTab === 'manuscript') return book.chapterOrder.map((chId) => document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`));
  if (currentTab === 'outline') return boardShowing() ? $$('#outline-board .ob-text, #loose-list .ob-text') : $$('#outline-list .ol-text');
  if (currentTab === 'darlings') return $$('#darlings-list .darling > :first-child');
  return [$('#aux-editor')];
}

// ---- find's matching: a paragraph is read as one string, so a phrase that
// runs into italic or bold, or a word an import split across runs, is found
// even though its letters sit in several text nodes

// lower case of the same length, so an offset in it is an offset in s
// ('İ' lowers to two characters and is left as it is)
function lowerSameLength(s) {
  const l = s.toLowerCase();
  if (l.length === s.length) return l;
  let out = '';
  for (const c of s) { const lc = c.toLowerCase(); out += lc.length === c.length ? lc : c; }
  return out;
}

// every place q appears in texts read end to end, any case, as
// { from: [node, offset], to: [node, offset] } with to's offset exclusive
function matchSpans(texts, q) {
  const found = [];
  if (!q || !texts.length) return found;
  const ql = lowerSameLength(q);
  const all = lowerSameLength(texts.join(''));
  const starts = [];
  let at = 0;
  for (const t of texts) { starts.push(at); at += t.length; }
  // the node holding the character at i
  const nodeAt = (i) => {
    let n = 0;
    while (n + 1 < starts.length && starts[n + 1] <= i) n++;
    return n;
  };
  let pos = 0;
  while ((pos = all.indexOf(ql, pos)) !== -1) {
    const a = nodeAt(pos);
    const b = nodeAt(pos + q.length - 1);
    found.push({ from: [a, pos - starts[a]], to: [b, pos + q.length - starts[b]] });
    pos += q.length;
  }
  return found;
}
// ---- end of find's matching ----

// a run ends at a paragraph's edge, and around a footnote or placeholder
// flag (contenteditable="false"), so a Replace never deletes one
const FIND_BLOCKS = 'p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, [contenteditable="false"]';

// a root's text nodes, cut into the runs one match may cross: a run ends at
// a paragraph's edge or a line break, never at an <em> or a <strong>
function textRuns(root) {
  const runs = [];
  let run = null;
  let block = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType !== Node.TEXT_NODE) {
      if (node.tagName === 'BR') run = null;
      continue;
    }
    const b = node.parentElement.closest(FIND_BLOCKS);
    if (!run || b !== block) { run = []; runs.push(run); block = b; }
    run.push(node);
  }
  return runs;
}

// every place q appears in the tab, in reading order, any case
function findRanges(q) {
  const found = [];
  if (!q) return found;
  for (const body of searchRoots()) {
    if (!body) continue;
    for (const run of textRuns(body)) {
      for (const m of matchSpans(run.map((n) => n.textContent), q)) {
        const range = document.createRange();
        range.setStart(run[m.from[0]], m.from[1]);
        range.setEnd(run[m.to[0]], m.to[1]);
        found.push(range);
      }
    }
  }
  return found;
}

// Scan the whole tab every time. Matches are highlighted, not selected.
function runSearch() {
  const q = $('#search-input').value;
  searchState = { matches: [], idx: -1, query: q, tab: currentTab };
  $('#searchbar').classList.toggle('find-only', currentTab !== 'manuscript');
  if (!q) {
    $('#search-count').textContent = '';
    paintHighlights();
    return;
  }
  searchState.matches = findRanges(q).map((range) => ({ range }));
  const n = searchState.matches.length;
  $('#search-count').textContent = n ? t('{n} found', { n }) : t('none');
  paintHighlights();
}

// only runs when the user asks (Enter / arrows)
function gotoMatch(i) {
  const m = searchState.matches;
  if (!m.length) return;
  searchState.idx = ((i % m.length) + m.length) % m.length;
  paintHighlights();
  try {
    const rect = m[searchState.idx].range.getBoundingClientRect();
    $('#paper-scroll').scrollTop += rect.top - window.innerHeight * 0.45;
  } catch { /* range collapsed by an edit; next search rebuilds */ }
  $('#search-count').textContent = t('{i} of {n}', { i: searchState.idx + 1, n: m.length });
}

function freshSearchIfStale() {
  if (searchState.query !== $('#search-input').value || searchState.tab !== currentTab) runSearch();
}

// put rep where a match was. A match across formatting takes the formatting
// of its first letter, and an <em> or <strong> it leaves empty goes with it.
function replaceRange(range, rep) {
  const { startContainer: a, startOffset: from, endContainer: b, endOffset: to } = range;
  if (a === b) { a.replaceData(from, to - from, rep); return; }
  const top = range.commonAncestorContainer;
  range.deleteContents();
  a.insertData(from, rep);
  let el = b.parentElement;
  if (!b.data) b.remove();
  while (el && el !== top && !el.textContent && !el.querySelector('br, img')) {
    const up = el.parentElement;
    el.remove();
    el = up;
  }
}

function replaceCurrent() {
  if (currentTab !== 'manuscript') return;
  freshSearchIfStale();
  if (!searchState.matches.length) { toast(t('No matches')); return; }
  if (searchState.idx < 0) searchState.idx = 0; // start from the very first match
  const m = searchState.matches[searchState.idx];
  const rep = $('#replace-input').value;
  // the match may have been edited away by hand since it was found: look
  // again rather than put the replacement where it no longer is
  if (m.range.toString().toLowerCase() !== String(searchState.query || '').toLowerCase()) { runSearch(); return; }
  let chapter = null;
  try {
    chapter = m.range.startContainer.parentElement.closest('.chapter');
    snapshotStructure('replace');
    breakRun++; // the engine never saw this change: ⌘Z goes to NEO's undo
    replaceRange(m.range, rep);
  } catch {
    runSearch();
    return;
  }
  if (chapter) syncChapter(chapter.querySelector('.chapter-body'), chapter.dataset.id);
  const oldIdx = searchState.idx;
  runSearch();
  if (searchState.matches.length) gotoMatch(Math.min(oldIdx, searchState.matches.length - 1));
}

// Every chapter, front to back
function replaceAllMatches() {
  const q = $('#search-input').value;
  if (!q || currentTab !== 'manuscript') return;
  snapshotStructure('replace all');
  const rep = $('#replace-input').value;
  // the matches Find shows, last first, so a replacement never moves one still to come
  const ranges = findRanges(q).reverse();
  const touched = new Set();
  for (const range of ranges) {
    touched.add(range.startContainer.parentElement.closest('.chapter').dataset.id);
    replaceRange(range, rep);
  }
  const n = ranges.length;
  for (const chId of book.chapterOrder) {
    if (touched.has(chId)) syncChapter(document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`), chId);
  }
  if (n === 0) undoStack.pop(); // nothing changed, nothing to undo
  else breakRun++; // ⌘Z from inside the text reaches this undo too
  toast(n ? t('{n} replaced across the whole book — {key} to undo', { n, key: KZ }) : t('0 replaced'));
  runSearch();
}

$('#search-input').addEventListener('input', () => {
  clearTimeout(saveTimers.search);
  saveTimers.search = setTimeout(runSearch, 250);
});
$('#search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); freshSearchIfStale(); gotoMatch(searchState.idx + (e.shiftKey ? -1 : 1)); }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); returnFromSearch(); }
  // Tab (and ⇧Tab) steps between Find and Replace, like any two fields;
  // Esc is the way back into the text, at the match
  if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) findFieldTab(e, '#replace-input');
});
$('#replace-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(); }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); returnFromSearch(); }
  if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) findFieldTab(e, '#search-input');
});
function findFieldTab(e, to) {
  if ($('#searchbar').classList.contains('find-only')) { e.preventDefault(); return; } // no Replace here: Tab stays put
  e.preventDefault();
  const el = $(to);
  el.focus();
  el.select();
}
$('#search-next').onclick = () => { freshSearchIfStale(); gotoMatch(searchState.idx + 1); };
$('#search-prev').onclick = () => { freshSearchIfStale(); gotoMatch(searchState.idx - 1); };
$('#replace-one').onclick = replaceCurrent;
$('#replace-all').onclick = replaceAllMatches;
$('#search-close').onclick = closeSearch;

/* ================================================================== */
/*  IMPORT                                                             */
/* ================================================================== */

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// …and for a value between quotation marks (an attribute)
const escAttr = (s) => escHtml(s).replace(/"/g, '&quot;');

// Turn parsed manuscripts into books on a shelf — used by the file picker
// and by dropping files from Finder straight onto a shelf.
async function addImportedBooks(results, shelf) {
  shelf = shelf || shelvesFor(currentAuthor().id)[0] || library.shelves[0];
  let ok = 0;
  let scripts = 0;
  for (const r of results) {
    if (r.error) { toast(t('Couldn’t import {name}: {error}', { name: r.name, error: r.error }), 6000); continue; }
    if (r.script) {
      if (await importScript(r, shelf)) scripts++;
      else toast(t('Couldn’t import {name}: {error}', { name: r.name, error: t('no script in it') }), 6000);
      continue;
    }
    // title/byline harvested from the document beat the filename;
    // passing the title in gives the book folder a readable name too
    const meta = await window.neo.createBook({
      author: r.author || displayAuthor(),
      title: r.title || r.name
    });
    meta.title = r.title || r.name;
    meta.tabNames = {
      notes: (library.tabDefaults && library.tabDefaults.notes) || 'Notes',
      outline: (library.tabDefaults && library.tabDefaults.outline) || 'Outline'
    };
    let words = 0;
    meta.chapterTitles = {};
    for (const ch of r.chapters) {
      const chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      await window.neo.writeChapter(meta.id, chId, importedChapterHTML(ch));
      if (ch.title) meta.chapterTitles[chId] = ch.title;
      if (ch.role) meta[ch.role] = chId;
      meta.chapterOrder.push(chId);
      for (const p of ch.paras) words += countWords(p.text || '');
    }
    meta.wordCount = words;
    await writeBookMeta(meta.id, meta);
    await placeTitle(shelf, meta.id);
    ok++;
  }
  await writeLibrary(library);
  if (!$('#bookshelf-view').hidden) renderShelves();
  if (ok) toast(t('{n} books imported onto “{shelf}” — chapters and scene breaks detected', { n: ok, shelf: shelf.name }), 6000);
  else if (scripts) toast(t('{n} scripts imported onto “{shelf}”', { n: scripts, shelf: shelf.name }), 6000);
}

// One imported chapter's paragraphs as a chapter body
function importedChapterHTML(ch) {
  return ch.paras.map((p) => {
    if (p.scene) return '<p class="scene-break">***</p>';
    // hyphens set as dialogue dashes, the same as typing them
    return `<p>${importedEmphasis(escHtml(incomingQuotes(dialogueDashes(p.text || '', dashStyle()), bookQuotes(), singleQuotes())))}</p>`;
  }).join('') || '<p><br></p>';
}

// Files brought into the open book as chapters (#178), before the chapter
// `beforeId` (at the end when there is none). The words are new files, so
// nothing already in the book is rewritten. A structural undo takes the
// chapters out again, and the words are still in the files they came from.
async function importChaptersIntoBook(results, beforeId) {
  if (!book || isScript()) return 0;
  const bookId = book.id;
  const adding = [];
  for (const r of results) {
    if (r.error) { toast(t('Couldn’t import {name}: {error}', { name: r.name, error: r.error }), 6000); continue; }
    if (r.script) { toast(t('Couldn’t import {name}: {error}', { name: r.name, error: t('a script can’t become chapters of a book') }), 6000); continue; }
    r.chapters.forEach((ch) => {
      // a file of one chapter is usually named for it: the title its first
      // line gave (the parser harvests it as the book's) names the chapter;
      // in a file of several, that title was the old book's
      const title = ch.title || (r.chapters.length === 1 && r.title) || '';
      adding.push({ title, html: importedChapterHTML(ch) });
    });
  }
  if (!adding.length || !book || book.id !== bookId) return 0;
  snapshotStructure('chapters imported');
  let at = beforeId ? book.chapterOrder.indexOf(beforeId) : -1;
  if (at < 0) at = book.chapterOrder.length;
  const ids = [];
  try {
    for (const a of adding) {
      const chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      chapterHTML[chId] = a.html;
      ids.push(chId);
      // every chapter file is on disk before book.json names it
      await persistChapter(chId);
    }
  } catch (err) {
    window.neo.logError('import chapters: ' + (err && err.message || err));
    for (const chId of ids) delete chapterHTML[chId];
    undoStack.pop();
    toast(t('Couldn’t import the chapters: {error}', { error: String(err && err.message || err) }), 6000);
    return 0;
  }
  if (!book || book.id !== bookId) return 0;
  book.chapterTitles = book.chapterTitles || {};
  adding.forEach((a, i) => { if (a.title) book.chapterTitles[ids[i]] = a.title; });
  book.chapterOrder.splice(at, 0, ...ids);
  await saveMeta();
  renderChapters();
  if (currentTab === 'outline') renderOutline();
  updateCounters();
  toast(t('{n} chapters added to “{title}”', { n: ids.length, title: book.title || '' }), 6000);
  return ids.length;
}

// Files dropped from Finder or Explorer (on the Chapters pane, or the
// Outline) become chapters before `beforeId`
async function importDroppedChapters(files, beforeId) {
  const paths = [...files]
    .map((f) => { try { return window.neo.pathForFile(f); } catch { return null; } })
    .filter((p) => p && /\.(docx|txt|md)$/i.test(p));
  if (!paths.length) { toast(t('No .docx, .txt, or .md files in that drop')); return; }
  const bookId = book.id;
  toast(t('Importing…'));
  const results = await window.neo.importFiles(paths);
  if (book && book.id === bookId) await importChaptersIntoBook(results, beforeId);
}

// File → Import Chapters…: after the chapter you're in, or at the end
async function importChapters() {
  if (!book || isScript() || $('#editor-view').hidden) return;
  const bookId = book.id;
  const results = await window.neo.importPick({ chapters: true });
  if (!results.length || !book || book.id !== bookId) return;
  const at = currentChapterId ? book.chapterOrder.indexOf(currentChapterId) + 1 : book.chapterOrder.length;
  await importChaptersIntoBook(results, book.chapterOrder[at]);
}

// **bold**, *italic* and _italic_ from an imported file, the way Markdown
// reads them: the markers hug a word (so "5 * 3 * 2" stays arithmetic) and
// an underscore inside a word ("file_name") is a letter. A backslash keeps
// the next * _ or \ as itself (a Word file's own asterisks arrive that way).
function importedEmphasis(text) {
  const kept = [];
  text = text.replace(/\\([\\*_])/g, (m, c) => { kept.push(c); return '\uE000' + (kept.length - 1) + '\uE001'; });
  text = text.replace(/\*\*(?=\S)([^*]*?\S)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\p{L}\p{N}])\*(?=[^\s*])([^*]*?[^\s*])?\*(?![*\p{L}\p{N}])/gu, (m, pre, inner) => inner === undefined ? m : `${pre}<i>${inner}</i>`)
    .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_]*?\S)_(?![\p{L}\p{N}_])/gu, '$1<i>$2</i>');
  return text.replace(/\uE000(\d+)\uE001/g, (m, i) => kept[+i]);
}

async function importBooks() {
  const results = await window.neo.importPick();
  if (results.length) await addImportedBooks(results, shelvesFor(currentAuthor().id)[0] || library.shelves[0]);
}

$('#import-btn').onclick = importBooks;
