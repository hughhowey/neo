'use strict';

/* ================================================================== */
/*  COUNTERS                                                           */
/* ================================================================== */

// the story's words: the pages a book carries don't count
function bookWordCount() {
  return book.chapterOrder.reduce((sum, chId) => sum + (isStory(chId) ? chapterWords(chId) : 0), 0);
}

function updateCounters() {
  if (!book) return;
  // a script is one long chapter: its words are counted when the typing
  // pauses, not at every key
  if (isScript() && !updateCounters.now) {
    clearTimeout(updateCounters.t);
    updateCounters.t = setTimeout(() => {
      updateCounters.now = true;
      try { updateCounters(); } finally { updateCounters.now = false; }
    }, 250);
    return;
  }
  const total = bookWordCount();
  const wc = $('#word-counter');
  if (isScript()) spCounters();
  else updateBookCounters(total, wc);
  // cache for the bookshelf progress bar
  if (book.wordCount !== total) {
    // only a true crossing earns a painting — a story that was already long
    // before NEO could paint keeps its abstract until the writer asks
    const before = typeof book.wordCount === 'number' ? book.wordCount : total;
    book.wordCount = total;
    scheduleMetaSave();
    if (before < PAINT_AT && total >= PAINT_AT && !(library.coverArt && library.coverArt.auto === false) && paintable(book)) {
      requestPaint(book, bookPlainText());
    }
  }
  trackDailyWords(total);
}
function updateBookCounters(total, wc) {
  if (wordMode === 'book') setText(wc, t('{n} words', { n: total }));
  const cur = book.chapterOrder.includes(currentChapterId) ? currentChapterId : null;
  const solo = soloStory();
  if (wordMode !== 'book') {
    const n = cur ? chapterWords(cur) : 0;
    setText(wc, cur && chapterKind(cur) !== 'chapter'
      ? t('{name}: {n} words', { name: chapterName(cur), n })
      : t('ch. {ch}: {n} words', { ch: cur ? chapterNumber(cur) : 0, n }));
  }
  const pos = $('#pos-counter');
  setText(pos, library.posMode === 'page'
    ? (cur ? t('page {p} of {total}', { p: currentPage(cur), total: pageCount(total) }) : t('{n} pages', { n: pageCount(total) }))
    : !cur
    ? (numberedChapters() > 1 ? t('{n} chapters', { n: numberedChapters() }) : '')
    : cur === solo
      ? '' // a chapterless story needs no chapter locator
      : chapterKind(cur) !== 'chapter'
        ? chapterName(cur)
        : t('chapter {ch} of {total}', { ch: chapterNumber(cur), total: numberedChapters(book, cur) }));
}

// ---- daily word tracking + goal display ----
// The writing day follows the writer's own clock, and rolls over at
// library.dayEndsAt (0 = midnight) so a session that runs past midnight
// still counts toward the night it began.
function writingDay(d = new Date()) {
  d = new Date(d);
  if (d.getHours() < (library.dayEndsAt || 0)) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const todayStr = () => writingDay();

// ---- daily words rules: what today's count is made of (#345) ----
// A writing day's entry in book.json is { start, end }: end is the story's
// count when last seen, and end − start the words written that day. Typing
// and cutting here move that tally. Text read from disk does not: the book
// opening, a chapter that was still syncing when it did, another device's
// chapters taken in, its version of a chapter kept beside ours. For those
// the start moves with the count, so the day keeps exactly what it had.
// Plain functions of the numbers (scripts/daily-words.test.js).
const dayWords = (e) => (e && Number.isFinite(e.start) && Number.isFinite(e.end) ? Math.max(0, e.end - e.start) : 0);
// the day's entry once the story's count is `total`. `seen` is the count
// the entry last saw on this page, so total − seen is the writer's own
// typing or cutting; undefined when there's nothing of theirs to add (the
// count came from disk). Cutting is writing too, but today never goes
// below zero, and what's written after the cut counts in full.
function nextDayCount(entry, total, seen) {
  if (!entry) return { start: total, end: total };
  let words = dayWords(entry);
  if (typeof seen === 'number') words = Math.max(0, words + total - seen);
  return { start: total - words, end: total };
}
// another device's days, from its book.json: a day it saw more written in
// keeps that tally, against this device's own count
function mergeDayCounts(ours, theirs) {
  const out = { ...(ours || {}) };
  if (!theirs || typeof theirs !== 'object') return out;
  for (const [day, e] of Object.entries(theirs)) {
    if (!e || !Number.isFinite(e.start) || !Number.isFinite(e.end)) continue;
    const mine = out[day];
    if (!mine || !Number.isFinite(mine.end)) out[day] = { start: e.start, end: e.end };
    else if (dayWords(e) > dayWords(mine)) out[day] = { start: mine.end - dayWords(e), end: mine.end };
  }
  return out;
}
// ---- end of daily words rules ----

// the story's count that today's entry last saw, and for which book
let daySeen = null;
// Text just came in from disk and is on the page: whatever it changed in
// the count isn't the writer's typing. Called once the page holds it, and
// before anything can count it as typed.
function wordsFromDisk() {
  if (!book) return;
  const total = bookWordCount();
  if (daySeen && daySeen.bookId === book.id && sprint && sprint.bookId === book.id) sprint.startCount += total - daySeen.total;
  daySeen = { bookId: book.id, total };
}
// Words moved from one chapter to another (a chapter split in two, a card
// dropped on another chapter) are neither written nor cut. They leave one
// chapter a moment before they reach the other, and today never goes below
// zero, so counted as they happen they would come back as new writing (#471).
// Call this before the move; the function it returns, once the words have
// settled, puts the day back as it was.
function holdDay() {
  const today = todayStr();
  const day = book.dailyCounts && book.dailyCounts[today] ? { ...book.dailyCounts[today] } : null;
  const total = bookWordCount();
  const run = sprint && sprint.bookId === book.id ? { sprint, start: sprint.startCount } : null; // a sprint's count dips the same way
  return () => {
    if (!book || bookWordCount() !== total) return; // words really were written or cut
    book.dailyCounts = book.dailyCounts || {};
    book.dailyCounts[today] = day || { start: total, end: total };
    daySeen = { bookId: book.id, total };
    if (run && sprint === run.sprint) sprint.startCount = run.start;
    updateCounters();
  };
}
function trackDailyWords(total) {
  book.dailyCounts = book.dailyCounts || {};
  const today = todayStr();
  const was = book.dailyCounts[today];
  const seen = daySeen && daySeen.bookId === book.id ? daySeen.total : undefined;
  const now = nextDayCount(was, total, seen);
  daySeen = { bookId: book.id, total };
  book.dailyCounts[today] = now;
  // a new day, or the writer's cut moving where it began, is saved now; the
  // rest goes with the next save
  if (!was || (seen !== undefined && total !== seen && now.start !== was.start)) scheduleMetaSave();
  if (sprint && sprint.bookId !== book.id) sprint = null; // a sprint belongs to the book it began in
  if (sprint && total < sprint.startCount) sprint.startCount = total;
  const wordsToday = Math.max(0, book.dailyCounts[today].end - book.dailyCounts[today].start);
  const gc = $('#goal-counter');
  if (sprint && !sprint.done) {
    const sprintWords = total - sprint.startCount;
    setText(gc, `⚡ ${fmtNum(sprintWords)} / ${fmtNum(sprint.target)}`);
    if (sprintWords >= sprint.target) {
      sprint.done = true;
      toast(t('Sprint complete — {n} words. Well earned.', { n: sprintWords }), 6000);
    }
  } else {
    const goal = library.dailyGoal || 0;
    setText(gc, goal
      ? t('{n} / {goal} today', { n: wordsToday, goal })
      : t('{n} today', { n: wordsToday }));
    gc.classList.toggle('goal-met', goal > 0 && wordsToday >= goal);
  }
}

// Pages, the way a manuscript counts them: 250 words to a page. The page
// the caret is on counts the story's words before it.
const WORDS_PER_PAGE = 250;
const pageCount = (words) => Math.max(1, Math.ceil(words / WORDS_PER_PAGE));
function currentPage(cur) {
  let before = 0;
  for (const chId of book.chapterOrder) {
    if (chId === cur) break;
    if (isStory(chId)) before += chapterWords(chId);
  }
  const sel = window.getSelection();
  const body = document.querySelector(`.chapter[data-id="${cur}"] .chapter-body`);
  if (isStory(cur) && body && sel.rangeCount && body.contains(sel.anchorNode)) {
    let n = wordsBeforeCaret(body, sel.anchorNode, sel.anchorOffset);
    if (n == null) {
      const r = document.createRange();
      r.selectNodeContents(body);
      r.setEnd(sel.anchorNode, sel.anchorOffset);
      n = countWords(plainText(r.cloneContents()));
    }
    before += n;
  }
  return Math.min(pageCount(bookWordCount()), Math.floor(before / WORDS_PER_PAGE) + 1);
}
// click: chapter of chapters ↔ page of pages
$('#pos-counter').onclick = () => {
  // a script's counter goes page ↔ scene
  if (book && isScript()) { spPosScene = !spPosScene; updateCounters(); return; }
  library.posMode = library.posMode === 'page' ? 'chapter' : 'page';
  writeLibrary(library);
  updateCounters();
};

$('#word-counter').onclick = () => {
  wordMode = wordMode === 'book' ? 'chapter' : 'book';
  updateCounters();
};

// select a passage → the counter reports its size
document.addEventListener('selectionchange', () => {
  if (!book || currentTab !== 'manuscript') return;
  // the recount a click asked for would cover the count of the word a
  // double click goes on to select
  clearTimeout(saveTimers.selcount);
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) {
    let el = sel.anchorNode;
    if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
    if (el && el.closest && el.closest('.chapter-body')) {
      const n = countWords(sel.toString());
      if (n > 0) {
        setText($('#word-counter'), t('{n} selected', { n }));
        return;
      }
    }
  }
  saveTimers.selcount = setTimeout(() => { if (book) updateCounters(); }, 150);
});

// track which chapter you're scrolled to
$('#paper-scroll').addEventListener('scroll', () => {
  clearTimeout(saveTimers.scroll);
  saveTimers.scroll = setTimeout(() => {
    const mid = window.innerHeight * 0.4;
    let best = null;
    for (const sec of $$('.chapter')) {
      if (sec.getBoundingClientRect().top < mid) best = sec.dataset.id;
    }
    if (best && best !== currentChapterId) {
      currentChapterId = best;
      highlightNav();
      updateCounters();
    }
  }, 120);
});

/* ================================================================== */
/*  SAVING                                                             */
/* ================================================================== */

// One door for chapter writes, so NEO always knows what is on disk. That
// knowledge is what lets it write only what changed (a library shared over
// iCloud or Syncthing must not be re-written every twenty seconds) and, in
// refreshFromDisk, tell another device's edits from its own.
let shelfExport = false; // see exportFromShelf
// What this device last knew to be in each chapter file (read, written, or
// found there), by book: the `expected` a save hands the disk. Only a write
// that landed changes it, so a save that failed, or one still on its way,
// is never taken for another device's.
const diskKnown = {};
const knowDisk = (bookId, chId, html) => { diskKnown[bookId + '/' + chId] = html; };
// One write at a time per chapter, in the order they were asked for
const chapterChain = {};
function persistChapter(chId, html) {
  if (!book) return Promise.resolve(false);
  if (html === undefined) html = chapterHTML[chId] || '';
  const bookId = book.id;
  const key = bookId + '/' + chId;
  savedHTML[chId] = html;
  writing[chId] = (writing[chId] || 0) + 1;
  // the disk is told what this device last knew of the chapter: if another
  // device wrote it since, the write stops and hands that text back, which
  // is kept as its own chapter before this device's words go on
  const run = async () => {
    let r = await window.neo.writeChapter(bookId, chId, html, diskKnown[key]);
    for (let tries = 0; r && typeof r.conflict === 'string' && tries < 3; tries++) {
      knowDisk(bookId, chId, r.conflict);
      if (worthKeeping(bookId, chId, r.conflict, html)) await keepOtherDeviceVersion(bookId, chId, r.conflict);
      r = await window.neo.writeChapter(bookId, chId, html, r.conflict);
    }
    if (r && typeof r.conflict === 'string') throw new Error('chapter keeps changing on disk');
    knowDisk(bookId, chId, html);
    return r;
  };
  const p = (chapterChain[key] || Promise.resolve()).catch(() => {}).then(run);
  chapterChain[key] = p;
  return p.catch((err) => {
    // It never reached the disk. Book it as unsaved again (what the disk
    // holds), so the next flush tries once more, and so a look at the disk
    // can't take the old file for news and put it back on the page.
    if (book && book.id === bookId && savedHTML[chId] === html) savedHTML[chId] = diskKnown[key];
    throw err;
  }).finally(() => {
    writing[chId]--;
    if (chapterChain[key] === p) delete chapterChain[key];
  });
}

// Is the copy on disk worth a chapter of its own? Only when it holds a word
// the page doesn't. A sync tool can put this device's own older save back
// over a newer one (iCloud does, when a file is saved faster than it can
// upload): that copy has nothing the page lacks, and keeping it as another
// chapter at every save filled one book with ninety copies of a chapter.
// Nor is a copy kept twice: one already in the book is enough.
function worthKeeping(bookId, chId, disk, mine) {
  if (!wordsBeyond(disk, mine)) return false;
  if (book && book.id === bookId && book.chapterOrder.some((c) => c !== chId && chapterHTML[c] === disk)) return false;
  return true;
}

// Another device's version of a chapter, found on disk when this device
// went to save its own (or on a look at the disk): it becomes the chapter
// right after, titled to say where it came from. Works for a book that has
// since been closed too, straight on disk.
function twinChapterTitle(title) {
  const when = new Date().toLocaleTimeString(NeoI18n.getLocale(), { hour: 'numeric', minute: '2-digit' });
  return ((title || '') + ' ' + t('from other device, {time}', { time: when })).trim();
}
async function keepOtherDeviceVersion(bookId, chId, disk) {
  const twinId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  if (book && book.id === bookId) {
    const idx = book.chapterOrder.indexOf(chId);
    book.chapterOrder.splice(idx < 0 ? book.chapterOrder.length : idx + 1, 0, twinId);
    book.chapterTitles = book.chapterTitles || {};
    book.chapterTitles[twinId] = twinChapterTitle(book.chapterTitles[chId]);
    chapterHTML[twinId] = disk;
    wordsFromDisk(); // the other device's copy is not today's writing (#345)
    await persistChapter(twinId, disk);
    await saveMeta();
    const caret = captureCaret();
    const keepScroll = $('#paper-scroll').scrollTop;
    renderChapters();
    $('#paper-scroll').scrollTop = keepScroll;
    if (caret) restoreCaret(caret);
    updateCounters();
    scheduleNavRefresh();
    toast(t('This chapter also changed on another device. That version is saved as the chapter after it.'), 8000);
    return;
  }
  await window.neo.writeChapter(bookId, twinId, disk);
  const meta = await window.neo.readBookMeta(bookId);
  if (!meta || !Array.isArray(meta.chapterOrder)) return;
  const idx = meta.chapterOrder.indexOf(chId);
  meta.chapterOrder.splice(idx < 0 ? meta.chapterOrder.length : idx + 1, 0, twinId);
  meta.chapterTitles = meta.chapterTitles || {};
  meta.chapterTitles[twinId] = twinChapterTitle(meta.chapterTitles[chId]);
  await writeBookMeta(bookId, meta);
}

function scheduleChapterSave(chId) {
  maybeDailySnapshot(); // SNAPSHOTS: the first change of the day keeps the day's start
  clearTimeout(saveTimers[chId]);
  const bookId = book && book.id;
  saveTimers[chId] = setTimeout(() => {
    if (!book) return; // the book closed before the timer fired; flushAllSaves already wrote it
    // another book is open, or the chapter was deleted or merged into the one
    // above while this save waited: its words are already where they belong,
    // and writing now would only leave an empty stray file in chapters/
    if (book.id !== bookId || !book.chapterOrder.includes(chId)) return;
    // a flush (a blur, the 20 s tick) wrote these words while this save
    // waited; a write still on its way may yet fail, so this one queues behind it
    if (!writing[chId] && chapterHTML[chId] === savedHTML[chId]) return;
    persistChapter(chId);
  }, 800);
}

// book.json minus the parts every device changes constantly, and minus
// empty defaults (NEO fills in chapterTitles: {} and friends after opening;
// the file on disk may not have them yet — same book either way)
function metaSig(m) {
  if (!m) return '';
  const c = {};
  for (const k of Object.keys(m).sort()) {
    if (k === 'lastPosition' || k === 'modified' || k === 'wordCount' || k === 'dailyCounts') continue; // bookkeeping, not the book
    const v = m[k];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'object' && Object.keys(v).length === 0) continue;
    c[k] = v;
  }
  return JSON.stringify(c);
}

function scheduleMetaSave() {
  clearTimeout(saveTimers.meta);
  saveTimers.meta = setTimeout(saveMeta, 800);
}
// Chapters taken out of the book here since book.json was last saved are
// named in it, so another device can tell "deleted there" from "never heard
// of there" (see knownChapters). One put back is no longer named.
function noteRemovedChapters() {
  const here = new Set(book.chapterOrder);
  let list = (Array.isArray(book.removedChapters) ? book.removedChapters : []).filter((c) => !here.has(c));
  for (const c of savedOrder) if (!here.has(c) && !list.includes(c)) list.push(c);
  if (list.length > 400) list = list.slice(-400);
  if (list.length) book.removedChapters = list; else delete book.removedChapters;
}

async function saveMeta(again) {
  if (!book || shelfExport) return;
  const bookId = book.id;
  noteRemovedChapters();
  for (const c of book.chapterOrder) knownChapters.add(c);
  const sig = metaSig(book);
  const order = [...book.chapterOrder];
  const stamp = await writeBookMeta(bookId, book, [...knownChapters]);
  // the answer belongs to the book that was saved; another one may be open now
  if (!book || book.id !== bookId) return;
  if (stamp && Array.isArray(stamp.unseen)) {
    // another device added a chapter since this one last looked: nothing was
    // written. Take the chapter in, then save (once; the next save tries again)
    if (again) return;
    await refreshFromDisk();
    if (book && book.id === bookId) await saveMeta(true);
    return;
  }
  if (typeof stamp === 'string') book.modified = stamp;
  savedMetaSig = sig;
  savedOrder = order;
}

function flushAllSaves(e) {
  if (!book || shelfExport) return;
  // remember where you were, for next session and for the other device:
  // the chapter, the paragraph and the letter (the same place on any
  // screen) plus the scroll (this screen's). `at` changes only when the
  // caret does, so a device that merely scrolled never calls the other
  // one back to an old spot.
  const prev = book.lastPosition || {};
  // On another tab, the manuscript's place is the one it had when you left
  // it (tabPlaces): the Notes page's scroll is not a place in the book.
  const writing = currentTab === 'manuscript';
  const kept = !writing ? tabPlaces.manuscript : null;
  const caret = writing ? captureCaret() : (kept && kept.caret) || null;
  const spot = caret
    ? { chapterId: caret.chId, pIdx: caret.pIdx, off: caret.off }
    : (!writing || prev.chapterId === currentChapterId) && prev.chapterId ? { chapterId: prev.chapterId, pIdx: prev.pIdx, off: prev.off } : { chapterId: currentChapterId };
  const scroll = writing ? $('#paper-scroll').scrollTop : kept && typeof kept.scroll === 'number' ? kept.scroll : (prev.scroll || 0);
  // …and the tab you were on, with its own scroll, so the book opens there
  const tab = currentTab || 'manuscript';
  const tabScroll = writing ? undefined : $('#paper-scroll').scrollTop;
  const newSpot = spot.chapterId !== prev.chapterId || spot.pIdx !== prev.pIdx;
  const newLetter = newSpot || spot.off !== prev.off;
  // the regular tick while writing saves a new paragraph; leaving NEO (a
  // blur, the app going to the background, closing) saves the exact letter
  const newTab = tab !== (prev.tab || 'manuscript') || (!writing && Math.abs((prev.tabScroll || 0) - tabScroll) > 40);
  const moved = newSpot || newTab || (e !== 'tick' && newLetter) || Math.abs((prev.scroll || 0) - scroll) > 40;
  if (moved) {
    book.lastPosition = { ...spot, scroll, at: newLetter ? Date.now() : (prev.at || Date.now()), tab };
    if (!writing) book.lastPosition.tabScroll = tabScroll;
  }
  for (const chId of book.chapterOrder) {
    if (chapterHTML[chId] !== undefined && chapterHTML[chId] !== savedHTML[chId]) {
      persistChapter(chId);
    }
  }
  flushAux();
  flushStickiesSave();
  flushSidecars();
  if (moved || metaSig(book) !== savedMetaSig) saveMeta();
}

/* ================================================================== */
/*  SNAPSHOTS                                                          */
/* ================================================================== */

// ⌘S takes a snapshot of the book: the chapters that changed since the last
// snapshot, plus the book's shape (order, titles, kinds) and a fingerprint of
// every chapter. NEO takes one on its own before the first change of each
// writing day. They're listed in the right-hand pane on the Darlings tab;
// picking one shows the book as it was, read-only, with what has gone since
// marked, and brings a chapter or the whole book back.
//
// book-…/snapshots/<name>/  one folder per snapshot, its files written once
// (main.js, Pocket's bridge): <chapterId>.html for each chapter that changed,
// then snapshot.json, last, so a folder without it is still being written.
// A chapter's text at a snapshot is in the newest snapshot at or before it
// that holds the file. The name carries what the list shows:
//   20261009T121400Z-k-3-84210-x7q2   when (UTC) · kind · chapters changed · words
// k: taken with ⌘S (kept until deleted) · d: the start of a writing day ·
// r: just before a snapshot was brought back. NEO's own (d, r) go after 30
// days; a snapshot that goes hands its chapters on to the next one first.
const SNAP_KEPT = 'k';
const SNAP_KEEP_DAYS = 30;
function snapName(ms, kind, changed, words, rand = Math.random().toString(36).slice(2, 6)) {
  const when = new Date(ms).toISOString().replace(/[-:]/g, '').slice(0, 15);
  return `${when}Z-${kind}-${Math.max(0, changed | 0)}-${Math.max(0, Math.round(words) || 0)}-${String(rand).replace(/[^a-z0-9]/g, '') || 'x'}`;
}
function parseSnapName(name) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-([a-z])-(\d+)-(\d+)-[a-z0-9]+$/.exec(name);
  if (!m) return null;
  return { name, at: Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]), kind: m[7], changed: +m[8], words: +m[9] };
}
// a short fingerprint of a chapter's text (cyrb53): equal text, equal print
function textHash(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ':' + str.length;
}
// NEO's own snapshots older than a month go, by their names alone (so every
// device picks the same ones); ⌘S snapshots and the newest one stay
function snapsToThin(snaps, now) {
  const newest = snaps.reduce((a, s) => (!a || s.at > a.at ? s : a), null);
  return snaps.filter((s) => s !== newest && s.kind !== SNAP_KEPT && now - s.at > SNAP_KEEP_DAYS * 86400000).map((s) => s.name);
}
// Hands each thinned snapshot's chapters on to the next one, then removes it.
// A chapter the next snapshot lacks is read from the old one (a read that
// fails throws; an empty chapter is '' and goes on as ''), written, and read
// back to match before anything is removed. A next snapshot that already has
// a chapter keeps its own version, which is what readers see from there on.
// Any failure stops the pass with the source still in place, so the next
// snapshot tries again.
async function thinSnapshots(neo, bookId, snaps, now) {
  if (snaps.uncertain) return; // see loadSnaps
  for (const gone of snapsToThin(snaps, now)) {
    const i = snaps.findIndex((s) => s.name === gone);
    const next = snaps[i + 1];
    if (i < 0 || !next) continue;
    for (const f of snaps[i].files) {
      if (!f.endsWith('.html') || next.files.has(f)) continue;
      const text = await neo.snapshotRead(bookId, snaps[i].name, f);
      if ((await neo.snapshotWrite(bookId, next.name, f, text)) === false) { next.files.add(f); continue; } // already there: its own
      const copy = await neo.snapshotRead(bookId, next.name, f);
      if (copy !== text) throw new Error(`snapshot thinning: ${f} did not copy to ${next.name} intact`);
      next.files.add(f);
    }
    await neo.snapshotRemove(bookId, gone);
    snaps.splice(i, 1);
  }
}
// where a chapter's text at snapshots[i] is: the newest snapshot at or
// before it holding the file (snapshots oldest first, each with `files`)
function snapHolder(snaps, i, chId) {
  for (let k = i; k >= 0; k--) if (snaps[k].files.has(chId + '.html')) return snaps[k];
  return null;
}
// Which words of an older text the chapter no longer has, paragraph by
// paragraph. A paragraph still there word for word is left alone; one with
// no near twin today is gone whole; one rewritten is compared word by word
// with today's paragraph that shares the most words with it.
// → for each old paragraph: null (still there), 'all', or its gone words' places
function wordsGone(oldParas, curParas) {
  const words = (s) => String(s).split(/\s+/).filter(Boolean);
  const curWords = curParas.map(words);
  const here = new Set(curWords.map((w) => w.join(' ')));
  const curSets = curWords.map((w) => new Set(w));
  return oldParas.map((text) => {
    const w = words(text);
    if (!w.length || here.has(w.join(' '))) return null;
    const mine = new Set(w);
    let best = -1;
    let bestScore = 0;
    curSets.forEach((set, i) => {
      let shared = 0;
      for (const x of mine) if (set.has(x)) shared++;
      const score = shared / Math.max(mine.size, set.size);
      if (score > bestScore) { bestScore = score; best = i; }
    });
    if (best < 0 || bestScore < 0.4) return 'all';
    const b = curWords[best];
    const n = w.length;
    const m = b.length;
    if (n * m > 4e6) return 'all';
    // the longest run of words the two share, in order; the rest is gone
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) L[i][j] = w[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
    const gone = [];
    for (let i = 0, j = 0; i < n;) {
      if (j < m && w[i] === b[j]) { i++; j++; } else if (j < m && L[i][j + 1] >= L[i + 1][j]) j++;
      else { gone.push(i); i++; }
    }
    return gone.length ? gone : null;
  });
}
// (the rules above are plain functions: scripts/snapshots.test.js)

// a chapter's saved HTML as an inert copy (a <template> loads no images)
function snapHolderEl(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html || '';
  tpl.content.querySelectorAll(UNCOUNTED).forEach((n) => n.remove());
  return tpl.content;
}
const htmlWords = (html) => countWords(plainText(snapHolderEl(html)));
const htmlParas = (html) => [...snapHolderEl(html).children].map((p) => p.textContent);
const snapsCan = () => !!(window.neo && window.neo.snapshotWrite);
const logSnap = (err) => window.neo.logError('snapshot: ' + ((err && err.message) || err));

// The book's snapshots, oldest first: { name, at, kind, changed, words, files: Set }.
// Only finished ones (snapshot.json written).
let snapCache = null;
async function loadSnaps(bookId, fresh) {
  if (!fresh && snapCache && snapCache.bookId === bookId) return snapCache.snaps;
  const raw = await window.neo.snapshotList(bookId);
  const snaps = [];
  for (const r of raw || []) {
    const s = parseSnapName(r.name);
    if (!s || !r.files.includes('snapshot.json')) continue;
    s.files = new Set(r.files);
    snaps.push(s);
  }
  // Folder names have second precision. Their count/kind/random suffix is
  // not creation order: tied names need the milliseconds already in the
  // commit file, or an incremental chapter can end up before its source.
  const seconds = new Map();
  for (const s of snaps) seconds.set(s.at, (seconds.get(s.at) || 0) + 1);
  // A commit file that can't be read (or a time that doesn't fit its
  // folder) keeps the folder's second, and the list is marked uncertain:
  // the book still takes new snapshots, but nothing is thinned (thinning
  // carries words forward in order, so it waits for an order it can trust).
  let uncertain = false;
  for (const s of snaps) {
    if (seconds.get(s.at) < 2) continue;
    try {
      const meta = JSON.parse(await window.neo.snapshotRead(bookId, s.name, 'snapshot.json'));
      const at = Date.parse(meta.at);
      if (!Number.isFinite(at) || Math.floor(at / 1000) !== s.at / 1000) { uncertain = true; continue; }
      s.at = at;
      s.meta = meta;
    } catch (err) {
      uncertain = true;
      window.neo.logError('snapshot time ' + s.name + ': ' + (err && err.message || err));
    }
  }
  if (uncertain) snaps.uncertain = true;
  snaps.sort((a, b) => a.at - b.at || (a.name < b.name ? -1 : 1));
  snapCache = { bookId, snaps };
  return snaps;
}
async function snapMeta(bookId, s) {
  if (!s.meta) {
    try { s.meta = JSON.parse(await window.neo.snapshotRead(bookId, s.name, 'snapshot.json')); } catch { s.meta = null; }
  }
  return s.meta;
}

// Takes a snapshot of the open book. `htmlOf` gives each chapter's text (by
// default what's on the page). Resolves to { snap, same } — same: nothing
// had changed since the last snapshot, so none was taken.
let snapChain = Promise.resolve();
function takeSnapshot(kind, htmlOf = (c) => chapterHTML[c] || '', { ifNoneToday = false } = {}) {
  const run = () => takeSnapshotNow(kind, htmlOf, { ifNoneToday });
  const p = snapChain.catch(() => {}).then(run);
  snapChain = p;
  return p;
}
async function takeSnapshotNow(kind, htmlOf, { ifNoneToday }) {
  if (!book || !snapsCan()) return null;
  const bookId = book.id;
  const order = [...book.chapterOrder];
  const titles = { ...(book.chapterTitles || {}) };
  const kinds = { ...(book.chapterKinds || {}) };
  const texts = {};
  for (const c of order) texts[c] = htmlOf(c);
  const snaps = await loadSnaps(bookId);
  const wallTime = Date.now();
  if (ifNoneToday && snaps.some((s) => new Date(s.at).toDateString() === new Date(wallTime).toDateString())) return null;
  const last = snaps[snaps.length - 1] || null;
  const lastMeta = last ? await snapMeta(bookId, last) : null;
  // Serialized snapshots must remain ordered even in the same millisecond
  // or when the device clock moves backwards.
  const lastTime = lastMeta && Date.parse(lastMeta.at);
  const now = Number.isFinite(lastTime) ? Math.max(wallTime, lastTime + 1) : wallTime;
  const hashes = {};
  const words = {};
  const changed = [];
  let total = 0;
  for (const c of order) {
    hashes[c] = textHash(texts[c]);
    words[c] = htmlWords(texts[c]);
    total += words[c];
    const known = lastMeta && lastMeta.hashes && lastMeta.hashes[c] === hashes[c] && snapHolder(snaps, snaps.length - 1, c);
    if (!known) changed.push(c);
  }
  if (!total && !lastMeta && kind !== SNAP_KEPT) return null; // nothing written yet
  const sameShape = lastMeta && JSON.stringify(lastMeta.chapterOrder) === JSON.stringify(order) &&
    order.every((c) => (lastMeta.chapterTitles || {})[c] === titles[c] && (lastMeta.chapterKinds || {})[c] === kinds[c]);
  if (!changed.length && sameShape && (kind !== SNAP_KEPT || last.kind === SNAP_KEPT)) return { snap: last, same: true };
  const name = snapName(now, kind, changed.length, total);
  for (const c of changed) await window.neo.snapshotWrite(bookId, name, c + '.html', texts[c]);
  const meta = { v: 1, at: new Date(now).toISOString(), kind, title: book.title || '', chapterOrder: order, chapterTitles: titles, chapterKinds: kinds, hashes, words, changed, total };
  await window.neo.snapshotWrite(bookId, name, 'snapshot.json', JSON.stringify(meta, null, 1));
  const snap = parseSnapName(name);
  snap.at = now;
  snap.files = new Set([...changed.map((c) => c + '.html'), 'snapshot.json']);
  snap.meta = meta;
  snaps.push(snap);
  // NEO's own old ones go, each handing its chapters on to the next first. A
  // failure leaves them where they are; the next snapshot tries again.
  try {
    await thinSnapshots(window.neo, bookId, snaps, now);
  } catch (err) {
    logSnap(err);
  }
  renderSnapList();
  return { snap, same: false };
}

// The first change of a writing day keeps the book as the day found it
// (what's on disk: savedHTML, before this change reaches it)
const snapDay = {};
function maybeDailySnapshot() {
  if (!book || !snapsCan() || shelfExport) return;
  const today = new Date().toDateString();
  if (snapDay[book.id] === today) return;
  snapDay[book.id] = today;
  takeSnapshot('d', (c) => (typeof savedHTML[c] === 'string' ? savedHTML[c] : chapterHTML[c] || ''), { ifNoneToday: true }).catch(logSnap);
}

// ⌘S
async function snapshotNow() {
  if (!book || !snapsCan()) return;
  try {
    const r = await takeSnapshot(SNAP_KEPT);
    if (!r) return;
    const time = snapTime(r.snap.at);
    if (r.same) { toast(t('Nothing has changed since your last snapshot ({time}).', { time }), 3500); return; }
    const first = (await loadSnaps(book.id)).length === 1;
    toast(first ? t('Snapshot taken, {time}: the whole book. It’s on the Darlings tab.', { time })
      : t('Snapshot taken, {time}: {n} chapters changed. It’s on the Darlings tab.', { time, n: r.snap.changed }), 4000);
  } catch (err) {
    logSnap(err);
    toast(t('NEO couldn’t take a snapshot. Your book itself is saved as usual.'), 6000);
  }
}

const snapTime = (at) => new Date(at).toLocaleTimeString(NeoI18n.getLocale(), { hour: 'numeric', minute: '2-digit' });
function snapWhen(at) {
  const d = new Date(at);
  const today = new Date();
  const time = snapTime(at);
  if (d.toDateString() === today.toDateString()) return t('today at {time}', { time });
  if (d.toDateString() === new Date(today.getTime() - 86400000).toDateString()) return t('yesterday at {time}', { time });
  return d.toLocaleDateString(NeoI18n.getLocale(), { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' }) + ', ' + time;
}
function snapWhy(kind) {
  if (kind === SNAP_KEPT) return t('Taken by you');
  if (kind === 'd') return t('Start of the day');
  if (kind === 'r') return t('Before a restore');
  return '';
}

// ---- the list: the right-hand pane, while Darlings is up ----
let snapShown = null; // the snapshot on the page, or null for the darlings
// the snapshot on the page goes, and its marks with it
function hideSnapshot() {
  snapShown = null;
  if (window.CSS && CSS.highlights) CSS.highlights.delete('neo-snap-gone');
  const v = $('#snap-view');
  if (v) { v.hidden = true; v.innerHTML = ''; }
}
// a book that closes takes its snapshots along: the one on the page and
// the list, so the next book never shows them (#448)
function forgetSnapshots() {
  hideSnapshot();
  snapCache = null;
  const list = $('#snap-list');
  if (list) list.innerHTML = '';
}
function snapList() {
  let list = $('#snap-list');
  if (list) return list;
  const head = $('#side-head > span');
  if (head && !$('#side-head .side-title-snaps')) {
    head.classList.add('side-title-notes');
    const alt = document.createElement('span');
    alt.className = 'side-title-snaps';
    alt.textContent = t('Snapshots');
    head.after(alt);
  }
  list = document.createElement('div');
  list.id = 'snap-list';
  list.setAttribute('role', 'listbox');
  $('#sticky-list').after(list);
  return list;
}
async function renderSnapList() {
  if (!book || currentTab !== 'darlings') return;
  const list = snapList();
  const bookId = book.id;
  let snaps = [];
  try { snaps = await loadSnaps(bookId); } catch (err) { logSnap(err); }
  if (!book || book.id !== bookId) return;
  list.innerHTML = '';
  const item = (cls, title, sub, on, onClick) => {
    const b = document.createElement('button');
    b.className = 'snap-item ' + cls + (on ? ' on' : '');
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.innerHTML = '<span class="snap-dot" aria-hidden="true"></span><span class="snap-line"><span class="snap-t"></span><span class="snap-s"></span></span>';
    b.querySelector('.snap-t').textContent = title;
    b.querySelector('.snap-s').textContent = sub;
    b.onclick = onClick;
    list.appendChild(b);
    return b;
  };
  item('snap-darlings', t('Darlings'), t('{n} darlings', { n: darlings.length }), !snapShown, () => showDarlingsAgain());
  if (!snaps.length) {
    const p = document.createElement('p');
    p.className = 'snap-empty';
    p.textContent = IS_MAC ? t('Press ⌘S to take a snapshot of your book. It costs only the chapters that changed.')
      : t('Press Ctrl+S to take a snapshot of your book. It costs only the chapters that changed.');
    list.appendChild(p);
    return;
  }
  let lastGroup = '';
  const today = new Date().toDateString();
  const yest = new Date(Date.now() - 86400000).toDateString();
  for (let i = snaps.length - 1; i >= 0; i--) {
    const s = snaps[i];
    const d = new Date(s.at).toDateString();
    const group = d === today ? t('Today') : d === yest ? t('Yesterday') : t('Earlier');
    if (group !== lastGroup) {
      const g = document.createElement('div');
      g.className = 'snap-group';
      g.textContent = group;
      list.appendChild(g);
      lastGroup = group;
    }
    const when = group === t('Earlier') ? new Date(s.at).toLocaleDateString(NeoI18n.getLocale(), { month: 'short', day: 'numeric' }) + ', ' + snapTime(s.at) : snapTime(s.at);
    const what = i === 0 ? t('The whole book') : s.changed ? t('{n} chapters changed since previous snapshot', { n: s.changed }) : t('No chapters changed since previous snapshot');
    const on = snapShown && snapShown.name === s.name;
    const b = item(s.kind === SNAP_KEPT ? 'snap-k' : 'snap-a', when, snapWhy(s.kind) + ' · ' + what, on, () => showSnapshot(s.name));
    b.title = t('{n} words', { n: s.words });
    if (on && snapShown.diff) {
      // the chapters that differ from today, to jump to
      const sub = document.createElement('div');
      sub.className = 'snap-chapters';
      const compared = document.createElement('span');
      compared.className = 'snap-comparison';
      compared.textContent = snapShown.diff.length ? t('{n} chapters differ from now', { n: snapShown.diff.length }) : t('Every chapter is the same as now');
      sub.appendChild(compared);
      for (const c of snapShown.diff) {
        const a = document.createElement('button');
        a.className = 'snap-ch';
        a.textContent = c.label;
        a.onclick = () => { const el = document.querySelector(`#snap-view .snap-chapter[data-id="${c.chId}"]`); if (el) el.scrollIntoView({ block: 'start', behavior: scrollBehavior() }); };
        sub.appendChild(a);
      }
      list.appendChild(sub);
    }
  }
}

// ---- the page: the book as it was ----
function snapView() {
  let v = $('#snap-view');
  if (v) return v;
  v = document.createElement('div');
  v.id = 'snap-view';
  v.hidden = true;
  $('#darlings-list').after(v);
  // a passage picked from an old snapshot can go to Darlings
  v.addEventListener('contextmenu', async (e) => {
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed && v.contains(sel.anchorNode) ? sel.toString().trim() : '';
    if (!text) return;
    e.preventDefault();
    const range = sel.getRangeAt(0).cloneRange();
    const choice = await popMenu(e.clientX, e.clientY, [
      { label: t('Copy'), value: 'copy' },
      { label: t('Set Aside as a Darling'), value: 'darling' }
    ]);
    if (choice === 'copy') document.execCommand('copy');
    if (choice === 'darling') snapToDarling(range, text);
  });
  return v;
}

async function snapToDarling(range, text) {
  if (!book) return;
  const holder = document.createElement('div');
  holder.appendChild(range.cloneContents());
  const chEl = range.startContainer.parentElement && range.startContainer.parentElement.closest('.snap-chapter');
  const html = [...holder.querySelectorAll('p')].length ? holder.innerHTML : '<p>' + escHtml(text) + '</p>';
  darlings.unshift({
    id: 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    html,
    text: text.slice(0, 2000),
    chapterId: chEl ? chEl.dataset.id : '',
    chapterLabel: chEl ? chEl.dataset.label : t('a snapshot'),
    date: new Date().toISOString()
  });
  await writeSidecar(book.id, 'darlings', darlings);
  renderSnapList();
  toast(t('Set aside in Darlings.'), 2500);
}

function showDarlingsAgain() {
  hideSnapshot();
  if (currentTab !== 'darlings') return;
  $('#aux-title').textContent = t('Darlings');
  $('#darlings-list').hidden = false;
  renderDarlings();
  renderSnapList();
  $('#paper-scroll').scrollTop = 0;
}

// the snapshot's book, chapter by chapter: [{ chId, html }] in its order
async function snapshotBook(bookId, name) {
  const snaps = await loadSnaps(bookId, true);
  const i = snaps.findIndex((s) => s.name === name);
  if (i < 0) return null;
  const meta = await snapMeta(bookId, snaps[i]);
  if (!meta) return null;
  const chapters = [];
  for (const chId of meta.chapterOrder) {
    const at = snapHolder(snaps, i, chId);
    chapters.push({ chId, html: at ? await window.neo.snapshotRead(bookId, at.name, chId + '.html') : '' });
  }
  return { snap: snaps[i], meta, chapters };
}

async function showSnapshot(name) {
  if (!book) return;
  const bookId = book.id;
  const got = await snapshotBook(bookId, name).catch((err) => { logSnap(err); return null; });
  if (!book || book.id !== bookId || currentTab !== 'darlings') return;
  if (!got) { toast(t('NEO couldn’t read that snapshot.')); return; }
  const { snap, meta, chapters } = got;
  const shape = { ...book, chapterOrder: meta.chapterOrder, chapterTitles: meta.chapterTitles || {}, chapterKinds: meta.chapterKinds || {} };
  const label = (chId) => chapterHeading(chId, shape) || chapterName(chId, shape);
  const v = snapView();
  $('#darlings-list').hidden = true;
  $('#aux-title').textContent = t('Your book as it was');
  v.hidden = false;
  v.innerHTML = '';
  if (window.CSS && CSS.highlights) CSS.highlights.delete('neo-snap-gone');
  // which chapters differ from the book today
  const diff = [];
  for (const ch of chapters) {
    const now = book.chapterOrder.includes(ch.chId) ? (chapterHTML[ch.chId] || '') : null;
    ch.now = now;
    ch.same = now !== null && textHash(now) === textHash(ch.html);
    if (!ch.same) diff.push({ chId: ch.chId, label: label(ch.chId) });
  }
  const extra = book.chapterOrder.filter((c) => !meta.chapterOrder.includes(c)).length;
  snapShown = { name, snap, meta, chapters, diff };

  const band = document.createElement('div');
  band.className = 'snap-band';
  band.innerHTML = '<div class="snap-band-what"><span class="snap-band-when"></span><span class="snap-band-sub"></span></div><div class="snap-band-do"><button class="snap-back"></button><button class="snap-all"></button></div>';
  band.querySelector('.snap-band-when').textContent = t('Your book {when}', { when: snapWhen(snap.at) });
  band.querySelector('.snap-band-sub').textContent = (diff.length ? t('{n} chapters differ from now', { n: diff.length }) : t('Every chapter is the same as now'))
    + (extra ? ' · ' + t('{n} chapters added since', { n: extra }) : '');
  band.querySelector('.snap-back').textContent = t('Back to Darlings');
  band.querySelector('.snap-back').onclick = showDarlingsAgain;
  const all = band.querySelector('.snap-all');
  all.textContent = t('Restore Whole Book');
  all.disabled = !diff.length && !extra && JSON.stringify(meta.chapterOrder) === JSON.stringify(book.chapterOrder);
  all.onclick = () => restoreSnapshot(null);
  v.appendChild(band);

  const ranges = [];
  for (const ch of chapters) {
    const sec = document.createElement('section');
    sec.className = 'snap-chapter' + (ch.same ? ' same' : '');
    sec.dataset.id = ch.chId;
    sec.dataset.label = label(ch.chId);
    const head = document.createElement('div');
    head.className = 'snap-head';
    const h = document.createElement('h3');
    h.textContent = label(ch.chId);
    head.appendChild(h);
    const tag = document.createElement('span');
    tag.className = 'snap-tag';
    tag.textContent = ch.same ? t('Same as now') : ch.now === null ? t('No longer in the book') : t('Differs from now');
    head.appendChild(tag);
    if (!ch.same) {
      const b = document.createElement('button');
      b.className = 'snap-one';
      b.textContent = t('Restore This Chapter');
      b.onclick = () => restoreSnapshot(ch.chId);
      head.appendChild(b);
    }
    sec.appendChild(head);
    const body = document.createElement('div');
    body.className = 'chapter-body snap-body';
    if (isScript()) body.classList.add('sp-geom');
    body.appendChild(snapHolderEl(ch.html));
    sec.appendChild(body);
    v.appendChild(sec);
    if (ch.same) continue;
    const paras = [...body.children];
    if (ch.now === null) { paras.forEach((p) => p.classList.add('snap-gone')); continue; }
    const gone = wordsGone(paras.map((p) => p.textContent), htmlParas(ch.now));
    paras.forEach((p, k) => {
      const g = gone[k];
      if (!g) return;
      if (g === 'all') { p.classList.add('snap-gone'); return; }
      ranges.push(...wordRanges(p, new Set(g)));
    });
  }
  if (ranges.length && window.CSS && CSS.highlights && window.Highlight) CSS.highlights.set('neo-snap-gone', new Highlight(...ranges));
  renderSnapList();
  // to the first chapter that differs
  const first = diff.length && v.querySelector(`.snap-chapter[data-id="${diff[0].chId}"]`);
  if (first) first.scrollIntoView({ block: 'start' });
  else $('#paper-scroll').scrollTop = 0;
}

// ranges over the words of p at the given places (its text nodes end to end)
function wordRanges(p, at) {
  const nodes = [];
  let full = '';
  const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) { nodes.push({ n, from: full.length }); full += n.data; }
  const spot = (pos) => {
    let k = nodes.length - 1;
    while (k > 0 && nodes[k].from > pos) k--;
    return [nodes[k].n, Math.min(pos - nodes[k].from, nodes[k].n.data.length)];
  };
  const out = [];
  let w = 0;
  for (const m of full.matchAll(/\S+/g)) {
    if (at.has(w)) {
      const r = document.createRange();
      r.setStart(...spot(m.index));
      r.setEnd(...spot(m.index + m[0].length));
      out.push(r);
    }
    w++;
  }
  return out;
}

// A chapter (chId) or the whole book (null) as the shown snapshot had it.
// The book as it stands is snapshotted first, and ⌘Z undoes the restore.
async function restoreSnapshot(chId) {
  const shown = snapShown;
  if (!book || !shown) return;
  try {
    await takeSnapshot('r');
  } catch (err) {
    logSnap(err); // never replace words that couldn't be kept
    toast(t('NEO couldn’t snapshot the book as it is now, so nothing was changed.'), 6000);
    return;
  }
  const { meta, chapters, snap } = shown;
  const byId = Object.fromEntries(chapters.map((c) => [c.chId, c.html]));
  snapshotStructure('snapshot');
  book.chapterTitles = book.chapterTitles || {};
  book.chapterKinds = book.chapterKinds || {};
  let gone = [];
  if (chId) {
    if (!book.chapterOrder.includes(chId)) {
      // back where it stood: after the nearest chapter before it that's still here
      const before = meta.chapterOrder.slice(0, meta.chapterOrder.indexOf(chId)).reverse().find((c) => book.chapterOrder.includes(c));
      book.chapterOrder.splice(before ? book.chapterOrder.indexOf(before) + 1 : 0, 0, chId);
      if ((meta.chapterTitles || {})[chId]) book.chapterTitles[chId] = meta.chapterTitles[chId];
      if ((meta.chapterKinds || {})[chId]) book.chapterKinds[chId] = meta.chapterKinds[chId];
    }
    chapterHTML[chId] = byId[chId];
  } else {
    gone = book.chapterOrder.filter((c) => !meta.chapterOrder.includes(c));
    book.chapterOrder = [...meta.chapterOrder];
    for (const c of book.chapterOrder) {
      chapterHTML[c] = byId[c];
      if ((meta.chapterTitles || {})[c] !== undefined) book.chapterTitles[c] = meta.chapterTitles[c]; else delete book.chapterTitles[c];
      if ((meta.chapterKinds || {})[c] !== undefined) book.chapterKinds[c] = meta.chapterKinds[c]; else delete book.chapterKinds[c];
    }
  }
  wordCache = {};
  for (const c of chId ? [chId] : book.chapterOrder) await persistChapter(c);
  await saveMeta();
  // chapters added since: out of the book, their words in the snapshot just taken
  for (const c of gone) { delete chapterHTML[c]; await window.neo.deleteChapter(book.id, c); }
  showDarlingsAgain();
  switchTab('manuscript');
  renderChapters();
  const el = chId && document.querySelector(`.chapter[data-id="${chId}"]`);
  if (el) { el.scrollIntoView({ block: 'start' }); focusChapterStart(chId); breakRun = 1; } // ⌘Z, before any typing, undoes it
  else $('#paper-scroll').scrollTop = 0;
  updateCounters();
  scheduleNavRefresh();
  const undo = IS_MAC ? '⌘Z' : 'Ctrl+Z';
  toast(chId ? t('Chapter restored from {when}. {undo} undoes it; the text it replaced is in a snapshot too.', { when: snapWhen(snap.at), undo })
    : t('Book restored from {when}. {undo} undoes it; the book as it was is in a snapshot too.', { when: snapWhen(snap.at), undo }), 7000);
}

// Esc on a snapshot goes back to the darlings (first, before the editor's
// own Esc, which would close the book)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.isComposing || !snapShown || currentTab !== 'darlings') return;
  if (document.querySelector('.modal-backdrop:not([hidden]), .pop-menu') || !$('#searchbar').hidden) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  showDarlingsAgain();
}, true);

/* ================================================================== */
/*  REFRESH — picking up what another device wrote                     */
/*  A library shared over iCloud or Syncthing changes underneath NEO.  */
/*  Whenever NEO comes back into view it looks again: a chapter that   */
/*  changed on disk and not here is simply adopted; one that changed   */
/*  in both places keeps the local text on the page and lands the      */
/*  other device's version in a new chapter right after it, so that    */
/*  nothing is ever lost quietly.                                      */
/* ================================================================== */

// True when the disk copy of a chapter has no word the page lacks, but the
// page has words it lacks: an older copy, not an edit made somewhere else.
function onlyDrops(page, disk) {
  const bag = (html) => {
    const m = new Map();
    for (const w of String(html || '').replace(/<[^>]*>/g, ' ').split(/\s+/)) if (w) m.set(w, (m.get(w) || 0) + 1);
    return m;
  };
  const here = bag(page);
  const there = bag(disk);
  for (const [w, n] of there) if (n > (here.get(w) || 0)) return false;
  for (const [w, n] of here) if (n > (there.get(w) || 0)) return true;
  return false;
}

// True when `a` holds a word (or more of one) that `b` doesn't
function wordsBeyond(a, b) {
  const bag = (html) => {
    const m = new Map();
    for (const w of String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').split(/\s+/)) if (w) m.set(w, (m.get(w) || 0) + 1);
    return m;
  };
  const there = bag(b);
  for (const [w, n] of bag(a)) if (n > (there.get(w) || 0)) return true;
  return false;
}

let refreshing = false;
async function refreshFromDisk() {
  if (refreshing || shelfExport) return;
  refreshing = true;
  bookMetaCache.clear(); // whatever another device wrote, the next redraw reads
  refreshOpenAux().catch((err) => window.neo.logError('notes refresh: ' + (err && err.message || err)));
  try {
    if (!book) {
      if (library && !$('#bookshelf-view').hidden) {
        const gen = libraryGeneration;
        const lib = applyDeviceLook(await window.neo.readLibrary());
        // a change made here while that read was out (a new shelf, a rename)
        // is newer than what came back: taking it would undo the change,
        // and the next save would make that stick. Look again next time.
        if (gen !== libraryGeneration || libraryWritesPending) return;
        if (lib && lib.firstRunDone && JSON.stringify(lib) !== JSON.stringify(library)) {
          library = lib;
          const shelf = $('#bookshelf-view');
          const keep = shelf.scrollTop;
          await renderShelves();
          shelf.scrollTop = keep;
        }
      }
      return;
    }
    const bookId = book.id;
    const previousWritingLanguage = writingLanguage();
    if (window.neo.refreshBook) await window.neo.refreshBook(bookId);
    const meta = await window.neo.readBookMeta(bookId);
    if (!book || book.id !== bookId || !meta) return;

    // First read everything that changed; the page is left alone until it is
    // all in. (Deciding chapter by chapter between reads let a keystroke land
    // on a page that no longer matched what NEO held, and reopening the book
    // for a new book.json dropped whatever was typed while it loaded.)
    const theirs = metaSig(meta) !== savedMetaSig && Array.isArray(meta.chapterOrder);
    const sigHere = metaSig(book);
    const mine = sigHere !== savedMetaSig; // restructured here too, not saved yet
    const incoming = {}; // chapters new to this device
    if (theirs) {
      for (const chId of meta.chapterOrder) {
        if (chapterHTML[chId] !== undefined) continue;
        incoming[chId] = await window.neo.readChapter(bookId, chId);
        if (!book || book.id !== bookId) return;
      }
    }
    // file times first, so only chapters that changed on disk are re-read
    // (a whole novel crossing the bridge every half minute is a hiccup)
    let stamps = null;
    if (window.neo.chapterStamps) {
      try { stamps = await window.neo.chapterStamps(bookId); } catch { stamps = null; }
    }
    const fresh = [];
    for (const chId of [...book.chapterOrder]) {
      if (writing[chId]) continue; // a save of ours is on its way: the file is ours, not news
      const st = stamps ? stamps[chId] : undefined;
      if (st !== undefined && st === diskStamps[chId]) continue;
      const before = savedHTML[chId];
      const disk = await window.neo.readChapter(bookId, chId);
      if (!book || book.id !== bookId) return;
      fresh.push({ chId, st, before, disk });
    }
    if (!book || book.id !== bookId) return;
    // Comments and Darlings are looked at every time, on their own: another
    // device can change them without touching book.json
    const sides = {};
    for (const name of ['stickies', 'darlings']) {
      const key = bookId + '/' + name;
      if (sidecarPending[key] || (name === 'stickies' && saveTimers.stickies)) continue; // ours is on its way
      const remote = await window.neo.readJSON(bookId, name, null);
      if (!book || book.id !== bookId) return;
      if (Array.isArray(remote)) sides[name] = remote;
    }

    // Then decide it all in one go: nothing waits from here to the page.
    let restructured = false;
    // the days as this device counted them, and as the other one did (#345)
    const today = todayStr();
    const days = mergeDayCounts(book.dailyCounts, meta.dailyCounts);
    const dayMoved = dayWords(days[today]) !== dayWords((book.dailyCounts || {})[today]);
    if (theirs && metaSig(book) === sigHere) {
      // The other device added, renamed or moved chapters. Whichever
      // book.json stands, no chapter holding words is dropped: theirs keeps
      // the chapters with unsaved words here, and ours (when this device
      // restructured too and hasn't saved yet) takes in the chapters they wrote.
      const hasWords = (h) => /[^\s]/.test(String(h || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' '));
      const theirRemoved = new Set(Array.isArray(meta.removedChapters) ? meta.removedChapters : []);
      const myRemoved = new Set(Array.isArray(book.removedChapters) ? book.removedChapters : []);
      // (a chapter taken out here, its file gone, that a book.json written
      // before it heard of that still lists: it stays out)
      const order = mine ? [...book.chapterOrder] : meta.chapterOrder.filter((c) => !(myRemoved.has(c) && chapterHTML[c] === undefined && !hasWords(incoming[c])));
      const other = mine ? meta.chapterOrder : book.chapterOrder;
      const kept = []; // chapters of this device's that their book.json doesn't list, and stay
      other.forEach((chId, i) => {
        if (order.includes(chId)) return;
        if (mine) {
          if (!hasWords(incoming[chId])) return;
        } else if (chapterHTML[chId] === savedHTML[chId]) {
          // Saved here, and not in their list. They took it out (they say
          // so, or its file is gone from the disk): it goes. Otherwise their
          // book.json was written without ever having heard of it (both
          // devices added a chapter while apart, or an older NEO saved over
          // the list): a chapter with words in it stays in the book.
          if (!hasWords(chapterHTML[chId]) || theirRemoved.has(chId) || (stamps && stamps[chId] === undefined)) return;
        }
        if (!mine) kept.push(chId);
        const prev = other.slice(0, i).reverse().find((c) => order.includes(c));
        order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, chId);
      });
      if (!mine || order.length !== book.chapterOrder.length) {
        for (const chId of order) {
          if (!(chId in incoming)) continue;
          chapterHTML[chId] = incoming[chId];
          savedHTML[chId] = incoming[chId];
          knowDisk(bookId, chId, incoming[chId]);
        }
        if (mine) {
          book.chapterOrder = order;
          // what they took out stays named, with what this device took out
          const removed = [...new Set([...myRemoved, ...theirRemoved])].filter((c) => !order.includes(c));
          if (removed.length) book.removedChapters = removed; else delete book.removedChapters;
        } else {
          const was = book;
          book = { ...meta, chapterOrder: order, lastPosition: book.lastPosition, dailyCounts: book.dailyCounts };
          // a chapter kept keeps its name, its kind and its notes
          for (const chId of kept) {
            for (const key of ['chapterTitles', 'chapterKinds', 'chapterNotes', 'sectionNotes', 'sceneNotes']) {
              if (!was[key] || was[key][chId] === undefined) continue;
              book[key] = { ...(book[key] || {}), [chId]: was[key][chId] };
            }
          }
          if (Array.isArray(book.removedChapters)) {
            book.removedChapters = book.removedChapters.filter((c) => !order.includes(c));
            if (!book.removedChapters.length) delete book.removedChapters;
          }
          savedMetaSig = metaSig(meta);
          savedOrder = [...meta.chapterOrder];
        }
        if (metaSig(book) !== savedMetaSig) scheduleMetaSave();
        if (!book.chapterOrder.includes(currentChapterId)) currentChapterId = null;
        undoStack = []; redoStack = []; // snapshots of the old structure must not replay over the new one
        restructured = true;
      }
    }
    // their list has been looked at, whatever was made of it
    if (Array.isArray(meta.chapterOrder)) for (const chId of meta.chapterOrder) knownChapters.add(chId);
    book.dailyCounts = days;
    let sideChanged = false;
    for (const name of Object.keys(sides)) {
      const key = bookId + '/' + name;
      if (sidecarPending[key] || (name === 'stickies' && saveTimers.stickies)) continue;
      const remote = sides[name];
      const rj = JSON.stringify(remote);
      const base = sidecarBase[key];
      if (rj === base) continue;
      const local = name === 'stickies' ? stickies : darlings;
      const next = JSON.stringify(local) === base || base === undefined
        ? remote
        : mergeSidecar(JSON.parse(base), local, remote, name === 'darlings');
      sidecarBase[key] = rj;
      if (name === 'stickies') stickies = next; else darlings = next;
      if (JSON.stringify(next) !== rj) writeSidecar(bookId, name, next).catch(() => {});
      sideChanged = true;
    }
    if (sideChanged) {
      renderStickies();
      if (currentTab === 'darlings') renderDarlings();
    }
    let adopted = 0;
    let conflicts = 0;
    const replaced = []; // page text a disk copy would otherwise have taken away
    for (const { chId, st, before, disk } of fresh) {
      if (!book.chapterOrder.includes(chId)) continue;
      // A save of ours crossed this read, so what came back can be older
      // than the page. Taking it put the old text back on the page, and the
      // next save made that stick. Look again next time.
      if (writing[chId] || savedHTML[chId] !== before) continue;
      if (typeof disk !== 'string') continue;
      if (disk === '' && savedHTML[chId]) continue; // unreadable or still downloading: not a change
      if (stamps) diskStamps[chId] = st; // seen; a file not read stays on the list
      if (disk === savedHTML[chId]) continue;
      if (chapterHTML[chId] === savedHTML[chId]) {
        // A copy with nothing new in it, only fewer words, is an older copy
        // coming back (or text cut on the other device): the page's version
        // goes to Darlings instead of nowhere.
        if (onlyDrops(chapterHTML[chId], disk)) {
          const holder = document.createElement('div');
          holder.innerHTML = chapterHTML[chId];
          replaced.push({
            id: 'd-' + Date.now().toString(36) + replaced.length,
            html: chapterHTML[chId],
            text: [...holder.children].map((p) => p.textContent).join('\n\n').slice(0, 2000),
            chapterId: chId,
            chapterLabel: t('Chapter {n}', { n: book.chapterOrder.indexOf(chId) + 1 }),
            date: new Date().toISOString()
          });
        }
        chapterHTML[chId] = disk;
        savedHTML[chId] = disk;
        knowDisk(bookId, chId, disk);
        wordCache[chId] = null;
        adopted++;
      } else if (!worthKeeping(bookId, chId, disk, chapterHTML[chId])) {
        // an older copy (see worthKeeping): the page's words go over it
        savedHTML[chId] = disk;
        knowDisk(bookId, chId, disk);
        persistChapter(chId);
      } else {
        savedHTML[chId] = disk; // what's on disk now; our text goes over it on the next save
        knowDisk(bookId, chId, disk);
        const idx = book.chapterOrder.indexOf(chId);
        const twinId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
        book.chapterOrder.splice(idx + 1, 0, twinId);
        book.chapterTitles = book.chapterTitles || {};
        book.chapterTitles[twinId] = twinChapterTitle(book.chapterTitles[chId]);
        chapterHTML[twinId] = disk;
        persistChapter(twinId, disk);
        persistChapter(chId);
        scheduleMetaSave();
        conflicts++;
      }
    }
    if (writingLanguage() !== previousWritingLanguage) {
      const target = book;
      await prepareWritingLanguage(target);
      if (book !== target) return;
      bookDictionaryReady = await window.neo.setSpellLanguage(writingDictionary(writingLanguage()));
      if (book !== target) return;
      focusSegmenter = null;
      spellCache.clear();
      spellScanned = new Set();
      spellRanges = new Map();
      capsRanges.clear();
      if (window.CSS && CSS.highlights) CSS.highlights.delete('neo-spell');
    }
    if (restructured || adopted || conflicts) {
      const caret = captureCaret();
      const keepScroll = $('#paper-scroll').scrollTop;
      renderChapters();
      wordsFromDisk(); // the words that came in were written elsewhere, or before today (#345)
      $('#paper-scroll').scrollTop = keepScroll;
      if (caret) restoreCaret(caret);
      if (spellOn && writingLanguage() !== previousWritingLanguage) scanSpellingHere();
      if (restructured) {
        const show = (el, text) => { if (el.textContent !== text) el.textContent = text; };
        show($('#tp-title'), isUntitled(book.title) ? '' : book.title);
        showTitleStyle();
        show($('#tp-subtitle'), book.subtitle || '');
        show($('#tp-author'), book.author || t('Anonymous'));
        $$('.tab[data-tab="notes"]')[0].textContent = tabName('notes');
        $$('.tab[data-tab="outline"]')[0].textContent = tabName('outline');
        renderStickies();
        if (currentTab === 'outline') renderOutline();
      }
      updateCounters();
      scheduleNavRefresh();
      if (replaced.length) {
        darlings.unshift(...replaced);
        writeSidecar(bookId, 'darlings', darlings);
      }
      if (currentTab === 'darlings' && (restructured || replaced.length)) renderDarlings();
      if (conflicts) toast(t('This chapter also changed on another device. That version is saved as the chapter after it.'), 8000);
      else if (replaced.length) toast(t('Updated from your other device — the text it replaced is in Darlings'), 8000);
      else toast(t('Updated from your other device'));
    } else if (dayMoved) {
      updateCounters();
    }

    // The writer moved on to the other device since last touching this one:
    // the caret goes where they left off there. (Its chapter's words may
    // still be crossing over; the spot waits a little for its paragraph.)
    const there = meta.lastPosition;
    const here = book.lastPosition || {};
    if (there && typeof there.at === 'number' && there.at > (here.at || 0) && there.at > lastHereActivity &&
        currentTab === 'manuscript' && !document.querySelector('.modal-backdrop:not([hidden])') &&
        book.chapterOrder.includes(there.chapterId)) {
      const body = document.querySelector(`.chapter[data-id="${there.chapterId}"] .chapter-body`);
      const arrived = body && (typeof there.pIdx !== 'number' || body.querySelectorAll('p').length > there.pIdx);
      if ((arrived || Date.now() - there.at > 120000) && resumePosition(there)) {
        book.lastPosition = { ...there, scroll: $('#paper-scroll').scrollTop };
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    refreshing = false;
  }
}
window.addEventListener('focus', () => setTimeout(refreshFromDisk, 300));
// and a quiet look every half minute while NEO is on screen, for the writer
// who left both machines open
setInterval(() => { if (document.visibilityState === 'visible') refreshFromDisk(); }, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') setTimeout(refreshFromDisk, 300);
  else if (book) flushAllSaves(); // iOS may end a backgrounded app without warning
});

window.addEventListener('beforeunload', flushAllSaves);
// flush whenever focus leaves NEO, and every 20 seconds
window.addEventListener('blur', () => { if (book) flushAllSaves(); });
setInterval(() => { if (book) flushAllSaves('tick'); }, 20000);

async function backToShelf() {
  if (reading) stopReadAloud(false);
  flushAllSaves();
  tabPlaces = {};
  book = null;
  showWindowTitle();
  forgetSnapshots();
  sideCardsKey = '';
  if ($('#side-cards')) $('#side-cards').innerHTML = '';
  currentChapterId = null;
  undoStack = []; redoStack = [];
  $('#editor-view').hidden = true;
  $('#bookshelf-view').hidden = false;
  applyBright();
  spEditorMode(); // a script's pane, page and title page go
  spReportState();
  renderShelves();
  await prepareWritingLanguage(null);
  if (!book) await window.neo.setSpellLanguage(writingDictionary(writingLanguage(null)));
}
$('#back-to-shelf').onclick = backToShelf;
