/* =============================== NEO =============================== */

'use strict';

// ---------- interface language (see i18n.js and locales/) ----------
// The English text is the key: t('Cancel') shows the translation when the
// chosen language has one, and the English original otherwise.
(() => {
  const l = (window.neo && window.neo.i18n) || {};
  NeoI18n.setLocale(l.locale || 'en', l.dict || {}, l.base || {});
})();
const { t, fmtNum, fmtDate } = NeoI18n;

// index.html marks its words with data-i18n (text), data-i18n-title,
// data-i18n-placeholder and data-i18n-ph (the empty-field hints)
function applyStaticI18n(root = document) {
  document.documentElement.lang = NeoI18n.getLocale();
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.textContent.replace(/\s+/g, ' ').trim()); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { if (el.title) el.title = t(el.title); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.placeholder); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.dataset.ph = t(el.dataset.ph); });
  // names for screen readers, where a symbol or a placeholder is all the eye gets
  root.querySelectorAll('[data-i18n-label]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nLabel)); });
  // hints that styles.css draws with ::before read these custom properties
  const cssHints = {
    '--ph-add-title': t('add a title'),
    '--ph-write-freely': t('Write freely…'),
    '--ph-ol-chapter': t('What happens in this chapter…'),
    '--ph-ol-section': t('What happens in this section…'),
    '--ph-nav-note': t('What happens here…')
  };
  for (const [name, text] of Object.entries(cssHints)) {
    document.documentElement.style.setProperty(name, JSON.stringify(text));
  }
}
applyStaticI18n();

// Books keep the title they were created with, so "Untitled" may be stored
// in any language: both the English word and the current one count.
// tk() marks a string for translation where it is defined and t() is
// applied later, when it is shown
const tk = (s) => s;

// The Notes and Outline tabs keep their default names in English and show
// them in the current language; a name the writer chose shows as written.
const tabName = (kind) => {
  const n = (book && book.tabNames && book.tabNames[kind]) || (kind === 'notes' ? 'Notes' : kind === 'outline' ? 'Outline' : kind);
  return n === 'Notes' || n === 'Outline' ? t(n) : n;
};

// What each entry in the Chapters pane is. Every entry is a chapter unless
// the writer makes it something else (right-click its box, or add one with
// the faint + between boxes): a page a published book carries, a part, a
// prologue or an epilogue. book.chapterKinds holds the ones that aren't
// chapters. Chapters are numbered; parts are numbered on their own; the rest
// go by their names. An unnumbered chapter is a chapter that goes by its
// title alone and stays out of the count — a run of named chapters before
// the numbering starts, say. Prologues, epilogues and chapters (numbered or
// not) are the story: they count toward the words. book.restartNumbering
// starts the chapter count again at 1 after every part.
const CHAPTER_KINDS = ['copyright', 'dedication', 'epigraph', 'contents', 'prologue', 'part', 'chapter', 'unnumbered', 'epilogue', 'acknowledgments', 'about'];
const STORY_KINDS = ['chapter', 'unnumbered', 'prologue', 'epilogue'];
// what comes after the story, where a new chapter never goes
const BACK_KINDS = ['epilogue', 'acknowledgments', 'about'];
function chapterKind(chId, meta = book) {
  const k = meta && meta.chapterKinds && meta.chapterKinds[chId];
  if (k && CHAPTER_KINDS.includes(k)) return k;
  // NEO 1.0 kept a prologue and an epilogue as roles of the first and last
  // chapters (a book not opened since reads that way until it is)
  const order = (meta && meta.chapterOrder) || [];
  if (order.length >= 2) {
    if (meta.prologue === chId && order[0] === chId) return 'prologue';
    if (meta.epilogue === chId && order[order.length - 1] === chId) return 'epilogue';
  }
  return 'chapter';
}
const isStory = (chId, meta = book) => STORY_KINDS.includes(chapterKind(chId, meta));
// a prologue or an epilogue: story that stands outside the numbering
function chapterRole(chId, meta = book) {
  const k = chapterKind(chId, meta);
  return k === 'prologue' || k === 'epilogue' ? k : null;
}
// a chapter's number counts chapters only; a part's, parts only
function kindCount(chId, kind, meta = book) {
  let n = 0;
  for (const c of meta.chapterOrder) {
    const k = chapterKind(c, meta);
    if (k === kind) n++;
    // numbering that restarts with each part
    else if (kind === 'chapter' && k === 'part' && meta.restartNumbering) n = 0;
    if (c === chId) break;
  }
  return n;
}
const chapterNumber = (chId, meta = book) => kindCount(chId, 'chapter', meta);
function chapterName(chId, meta = book) {
  const k = chapterKind(chId, meta);
  if (k === 'chapter') return t('Chapter {n}', { n: chapterNumber(chId, meta) });
  if (k === 'part') return partLabel(kindCount(chId, 'part', meta));
  // an unnumbered chapter is its title
  if (k === 'unnumbered') return ((meta.chapterTitles || {})[chId] || '').trim() || t('Untitled');
  return kindName(k);
}
// a chapter's heading as the reader sees it: its name, then any title —
// once, for an unnumbered chapter, whose name is its title
function chapterHeading(chId, meta = book, sep = ' — ') {
  const title = ((meta.chapterTitles || {})[chId] || '').trim();
  const k = chapterKind(chId, meta);
  if (k === 'unnumbered') return title;
  if (!title) return chapterName(chId, meta);
  return library.exportCustomChapterTitles ? title : chapterName(chId, meta) + sep + title;
}
function kindName(kind) {
  if (kind === 'chapter') return t('Chapter');
  if (kind === 'unnumbered') return t('Unnumbered Chapter');
  if (kind === 'contents') return t('Contents');
  return pageKindName(kind);
}
// where there's only room for a number: a chapter's, a part's in roman
// numerals, and a fleuron for the rest
function chapterMark(chId, meta = book) {
  const k = chapterKind(chId, meta);
  if (k === 'chapter') return String(chapterNumber(chId, meta));
  if (k === 'part') return roman(kindCount(chId, 'part', meta));
  return '❦';
}
// how many numbered chapters the book has — or, when numbering restarts
// with each part, how many share chId's part
function numberedChapters(meta = book, chId = null) {
  let n = 0, total = 0, found = false;
  for (const c of meta.chapterOrder) {
    const k = chapterKind(c, meta);
    if (k === 'part' && meta.restartNumbering && chId) {
      if (found) break;
      n = 0;
    }
    if (c === chId) found = true;
    if (k === 'chapter') { n++; total++; }
  }
  return chId && meta.restartNumbering ? n : total;
}
// A story of one chapter is just "the story": no heading, no number, until a
// second chapter (or a prologue, an epilogue or a part) joins it. The pages
// around it don't count.
function soloStory(meta = book) {
  const story = meta.chapterOrder.filter((c) => isStory(c, meta) || chapterKind(c, meta) === 'part');
  return story.length === 1 && chapterKind(story[0], meta) === 'chapter' ? story[0] : null;
}
// NEO 1.0's roles become kinds the first time a book opens here, and a kind
// whose entry is gone is let go
function settleChapterKinds() {
  let changed = false;
  for (const role of ['prologue', 'epilogue']) {
    if (!(role in book)) continue;
    const id = book[role];
    if (chapterKind(id) === role) (book.chapterKinds = book.chapterKinds || {})[id] = role;
    delete book[role];
    changed = true;
  }
  for (const id of Object.keys(book.chapterKinds || {})) {
    const k = book.chapterKinds[id];
    if (!book.chapterOrder.includes(id) || k === 'chapter' || !CHAPTER_KINDS.includes(k)) {
      delete book.chapterKinds[id];
      changed = true;
    }
  }
  if (changed) scheduleMetaSave();
}
function setChapterKind(chId, kind) {
  book.chapterKinds = book.chapterKinds || {};
  if (kind === 'chapter') delete book.chapterKinds[chId];
  else book.chapterKinds[chId] = kind;
}

const isUntitled = (s) => !s || s === 'Untitled' || s === t('Untitled');

// ---------- state ----------
let library = null;          // library.json
let book = null;             // current book.json
let chapterHTML = {};        // chapterId -> html (loaded at open)
let savedHTML = {};          // chapterId -> html as last read from / written to disk
let savedMetaSig = '';       // book.json as last read/written, minus the volatile bits
let diskStamps = {};         // chapterId -> file mtime as of the last look at the disk
let writing = {};            // chapterId -> chapter writes still on their way to disk
let stickies = [];           // [{id, chapterId, text, resolved}]
let darlings = [];           // [{id, html, text, chapterId, chapterLabel, date}]
let currentTab = 'manuscript';
let currentChapterId = null; // chapter the caret/scroll is in
let wordMode = 'book';       // 'book' | 'chapter'
let saveTimers = {};

// Every library.json write from this window goes through here. A look at the
// disk (refreshFromDisk) can then tell its own writes from another device's:
// a read that a write here crossed, or that finished while one was still on
// its way, is older than the library in memory and must not replace it.
let libraryGeneration = 0;
let libraryWritesPending = 0;
function writeLibrary(lib = library) {
  libraryGeneration++;
  libraryWritesPending++;
  return new Promise((resolve) => resolve(window.neo.writeLibrary(lib)))
    .finally(() => { libraryWritesPending--; });
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Platform-aware key labels: Macs read ⌘⇧X, everyone else reads Ctrl+Shift+X
const IS_MAC = navigator.platform.toLowerCase().includes('mac');
// a touch screen (Pocket): nothing to hover, no right button
const NO_HOVER = !!(window.matchMedia && window.matchMedia('(hover: none)').matches) || !!window.Capacitor;
// NEO Pocket (the Android and iOS shell)
const IS_POCKET = !!window.Capacitor;

// Touch has no right-click: a long press on a book, a shelf name or a chapter
// heading opens the same menu. Not inside the text itself — there a long
// press belongs to the system's own selection handles.
(() => {
  let timer = null;
  let start = null;
  let swallowClick = false;
  let armed = false; // held long enough; the menu opens when the finger lifts
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const target = e.target;
    if (!target.closest) return;
    // shelf names are editable on tap, but a long press on one is a menu
    if (target.closest('[contenteditable="true"], input, textarea')) return;
    if (target.closest('#pocket-chapters')) return;
    const p = e.touches[0];
    start = { x: p.clientX, y: p.clientY, target };
    armed = false;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; armed = true; }, 550);
  }, { passive: true });
  const cancel = () => { clearTimeout(timer); timer = null; armed = false; };
  document.addEventListener('touchmove', (e) => {
    if (!start) return;
    const p = e.touches[0];
    if (Math.hypot(p.clientX - start.x, p.clientY - start.y) > 10) cancel();
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (armed && start) {
      // iOS usually sends no click after a long press; when it does, it
      // comes at once — so the guard lifts itself before the menu's first tap
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 300);
      const { target, x, y } = start;
      setTimeout(() => target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y })), 30);
    }
    cancel();
  }, { passive: true });
  document.addEventListener('touchcancel', cancel, { passive: true });
  // the tap that ends a long press must not also open the book
  document.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
})();
const K = (mac, pc) => (IS_MAC ? mac : pc);
const KZ = K('⌘Z', 'Ctrl+Z');
const KPH = K('⌘⇧X', 'Ctrl+Shift+X');
const KDA = K('⌘⇧D', 'Ctrl+Shift+D');
const KHELP = K('⌘/', 'Ctrl+/');

// Scrollbars stay invisible until you scroll, then fade away again —
// chrome only when needed.
document.addEventListener('scroll', (e) => {
  const el = e.target;
  if (!el || !el.classList) return;
  el.classList.add('show-scrollbar');
  clearTimeout(el._neoSbHide);
  el._neoSbHide = setTimeout(() => el.classList.remove('show-scrollbar'), 750);
}, true);

function askInput(title, placeholder, value = '') {
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `
      <div class="modal" style="width:380px">
        <h2 style="font-size:16px">${title}</h2>
        <input type="text" spellcheck="false" placeholder="${placeholder}" />
        <div style="text-align:right;margin-top:14px">
          <button class="m-cancel btn-quiet" style="margin-right:10px">${t('Cancel')}</button>
          <button class="m-ok btn-gold">${t('OK')}</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    const input = bd.querySelector('input');
    input.value = value;
    input.focus();
    input.select();
    const done = (val) => { bd.remove(); resolve(val); };
    bd.querySelector('.m-ok').onclick = () => done(input.value.trim());
    bd.querySelector('.m-cancel').onclick = () => done(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') done(input.value.trim());
      // the prompt is gone by the time Esc bubbles up, so without this the
      // editor's own Esc would close the book too
      if (e.key === 'Escape') { e.stopPropagation(); done(null); }
    };
  });
}

// A list of choices, null on cancel.
function optionModal(title, message, options) {
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    const buttons = options.map((o, i) =>
      `<button class="fr-choice${o.danger ? ' danger' : ''}" data-i="${i}" style="width:100%;margin-bottom:8px">
        <strong>${o.label}</strong>
        ${o.desc ? `<span>${o.desc}</span>` : ''}
      </button>`).join('');
    bd.innerHTML = `
      <div class="modal" style="width:420px">
        <h2 style="font-size:16px">${title}</h2>
        ${message ? `<p>${message}</p>` : ''}
        ${buttons}
        <div style="text-align:right;margin-top:6px">
          <button class="m-cancel btn-quiet">${t('Cancel')}</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    const done = (val) => { bd.remove(); resolve(val); };
    bd.querySelectorAll('.fr-choice').forEach((b) => {
      b.onclick = () => done(options[+b.dataset.i].value);
    });
    bd.querySelector('.m-cancel').onclick = () => done(null);
    bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
  });
}

// A small menu at the pointer, the way a right-click menu opens: items are
// {label, value, checked, disabled, danger} or '-' for a line between them.
// Resolves to the chosen value, or null. Arrow keys, Enter and Esc work.
function popMenu(x, y, items, { title = '', from = null } = {}) {
  if (popMenu.close) popMenu.close(); // one at a time
  return new Promise((resolve) => {
    const menu = document.createElement('div');
    menu.className = 'pop-menu';
    menu.setAttribute('role', 'menu');
    if (title) {
      const h = document.createElement('div');
      h.className = 'pm-title';
      h.textContent = title;
      menu.setAttribute('aria-label', title);
      menu.appendChild(h);
    }
    for (const it of items) {
      if (it === '-') {
        const sep = document.createElement('div');
        sep.className = 'pm-sep';
        menu.appendChild(sep);
        continue;
      }
      const b = document.createElement('button');
      b.setAttribute('role', it.checked !== undefined ? 'menuitemradio' : 'menuitem');
      if (it.checked !== undefined) b.setAttribute('aria-checked', it.checked ? 'true' : 'false');
      b.className = (it.checked ? 'on' : '') + (it.danger ? ' danger' : '');
      b.textContent = it.label;
      b.disabled = !!it.disabled;
      b.tabIndex = -1;
      b.onclick = () => done(it.value);
      b.onmouseenter = () => { if (!b.disabled) b.focus({ preventScroll: true }); };
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    // opened from the keyboard (no pointer), it hangs from the thing it's for
    if ((!x && !y) && from) {
      const r = from.getBoundingClientRect();
      x = r.left + 12;
      y = r.bottom;
    }
    const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1;
    const w = menu.offsetWidth * zoom;
    const h = menu.offsetHeight * zoom;
    const left = Math.max(4, Math.min(x, window.innerWidth - w - 4));
    const top = y + h > window.innerHeight - 4 ? Math.max(4, y - h) : y;
    menu.style.left = left / zoom + 'px';
    menu.style.top = top / zoom + 'px';
    const back = document.activeElement;
    const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
    const done = (value) => {
      if (!menu.isConnected) return;
      menu.remove();
      popMenu.close = null;
      document.removeEventListener('mousedown', outside, true);
      window.removeEventListener('blur', cancel);
      // the Chapters pane it kept open closes if the pointer has left it
      const nav = $('#nav-pane');
      if (nav && nav.dataset.pinned !== '1' && !nav.matches(':hover')) nav.classList.remove('open');
      if (value === null && back && back.isConnected && back.focus) back.focus({ preventScroll: true });
      resolve(value);
    };
    const cancel = () => done(null);
    popMenu.close = cancel;
    const outside = (e) => { if (!menu.contains(e.target)) done(null); };
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('blur', cancel);
    menu.addEventListener('keydown', (e) => {
      const at = buttons.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = buttons[(at + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length];
        if (next) next.focus();
      } else if (e.key === 'Tab') e.preventDefault();
      e.stopPropagation();
    });
    (buttons.find((b) => b.classList.contains('on')) || buttons[0] || menu).focus({ preventScroll: true });
  });
}

// A click (or tap) on the dim page around any dialog dismisses it the way
// its own quiet button would — Cancel or Later where there is one, else
// Done/OK. Dialogs that must be answered have neither and stay put.
document.addEventListener('mousedown', (e) => {
  const bd = e.target && e.target.classList && e.target.classList.contains('modal-backdrop') ? e.target : null;
  if (!bd || bd.dataset.stay === '1') return;
  const btn = bd.querySelector('.m-cancel') || bd.querySelector('.m-ok');
  if (btn) btn.click();
});

function toast(msg, ms = 4000) {
  const h = $('#hint');
  h.textContent = msg;
  h.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { h.hidden = true; }, ms);
}

// Scripts that do not separate words with spaces: a whitespace count reports
// one "word" for a whole sentence, so word goals and statistics read far too
// low. Intl.Segmenter knows their boundaries; the same API already runs the
// focus mode (see sentenceRange), and one segmenter is kept per script.
const SEGMENTED_SCRIPTS = [
  { lang: 'th', chars: /[\u0E00-\u0E7F]/ }, // Thai
  { lang: 'lo', chars: /[\u0E80-\u0EFF]/ }, // Lao
  { lang: 'my', chars: /[\u1000-\u109F]/ }, // Myanmar
  { lang: 'km', chars: /[\u1780-\u17FF]/ }  // Khmer
];
let wordSegmenter = null;
let wordSegmenterLang = '';

// a word holds at least one letter or digit, so French « » and spaced
// dashes are not counted as words
function countWords(text) {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  if (window.Intl && Intl.Segmenter) {
    const script = SEGMENTED_SCRIPTS.find((s) => s.chars.test(trimmed));
    if (script) {
      if (wordSegmenterLang !== script.lang) {
        wordSegmenter = new Intl.Segmenter(script.lang, { granularity: 'word' });
        wordSegmenterLang = script.lang;
      }
      let words = 0;
      for (const part of wordSegmenter.segment(trimmed)) if (part.isWordLike) words += 1;
      return words;
    }
  }
  return (trimmed.match(/\S+/g) || []).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function cleanChapterEl(id) {
  const el = document.querySelector(`.chapter[data-id="${id}"] .chapter-body`);
  const holder = document.createElement('div');
  holder.innerHTML = el ? el.innerHTML : (chapterHTML[id] || '');
  holder.querySelectorAll('.darling-anchor, .ph-mark, .ghost').forEach((n) => n.remove());
  return holder;
}
// Text a line to each paragraph. innerText does that only for what is laid
// out on screen: of a copy held aside, like the one above, it runs one
// paragraph's last word into the next one's first ("end.Next"), and the two
// count as one word. A range's toString runs them together the same way.
function plainText(root) {
  root.querySelectorAll('p, div, br').forEach((el) => el.after('\n'));
  return root.textContent;
}
const chapterText = (id) => plainText(cleanChapterEl(id));

// Word counts are cached per chapter and only recomputed for the chapter being edited.
let wordCache = {};
function chapterWords(chId) {
  if (wordCache[chId] == null) wordCache[chId] = countWords(chapterText(chId));
  return wordCache[chId];
}

/* ================================================================== */
/*  BOOKSHELF                                                          */
/* ================================================================== */

let libraryDirPath = '';

function coverUrl(meta) {
  // Pocket serves the library through a URL; desktop hands a plain path
  if (/^[a-z]+:\/\//.test(libraryDirPath)) {
    return libraryDirPath + '/' + encodeURIComponent(meta.id) + '/' + encodeURIComponent(meta.coverImage);
  }
  const p = (libraryDirPath + '/' + meta.id + '/' + meta.coverImage).replace(/\\/g, '/');
  return encodeURI('file://' + (p.startsWith('/') ? '' : '/') + p);
}

async function loadLibrary() {
  libraryDirPath = await window.neo.libraryPath();
  library = await window.neo.readLibrary();
  if (window.neo.writingStyleState) window.neo.writingStyleState(library.writingStyle);
  if (!library.firstRunDone) {
    showFirstRun();
  }
  renderShelves();
}

function showFirstRun() {
  const fr = $('#firstrun');
  fr.hidden = false;
  let picked = { body: Object.keys(BODY_FONTS)[0] || 'Georgia', dropcap: 'literary' };

  // Step 1: who are you, and how do you write?
  $$('.fr-choice').forEach((btn) => {
    btn.onclick = () => {
      library.authorName = $('#fr-name').value.trim();
      const pen = $('#fr-pen').value.trim();
      library.penNames = pen ? [pen] : [];
      library.writingStyle = btn.dataset.style;
      if (window.neo.writingStyleState) window.neo.writingStyleState(library.writingStyle);
      $('#fr-step1').hidden = true;
      $('#fr-step2').hidden = false;
      buildFontStep();
    };
  });

  // Step 2: fonts, with a WYSIWYG sample
  function preview() {
    document.documentElement.style.setProperty('--body-font', BODY_FONTS[picked.body]);
    document.documentElement.style.setProperty('--dropcap-font', DROPCAP_FONTS[picked.dropcap]);
  }
  function buildFontStep() {
    const bodyRow = $('#fr-bodyfonts');
    bodyRow.innerHTML = '';
    for (const name of BODY_FONT_CHOICES) {
      const b = document.createElement('button');
      b.className = 'fr-font' + (picked.body === name ? ' sel' : '');
      b.textContent = name;
      b.style.fontFamily = BODY_FONTS[name];
      b.onmouseenter = () => { document.documentElement.style.setProperty('--body-font', BODY_FONTS[name]); };
      b.onmouseleave = preview;
      b.onclick = () => {
        picked.body = name;
        buildFontStep();
        preview();
      };
      bodyRow.appendChild(b);
    }
    const capRow = $('#fr-dropcaps');
    capRow.innerHTML = '';
    const caps = { literary: t('Literary'), fantasy: t('Fantasy'), scifi: t('Sci-Fi') };
    // an A of the alphabet the sample is written in, so each button shows
    // the drop cap the writer will get (Cyrillic letters come from other faces)
    const capA = /\p{Script=Cyrillic}/u.test($('#fr-sample-text').textContent) ? 'А' : 'A';
    for (const key of Object.keys(caps)) {
      const b = document.createElement('button');
      b.className = 'fr-font' + (picked.dropcap === key ? ' sel' : '');
      b.innerHTML = `<span class="fr-cap" style="font-family:${DROPCAP_FONTS[key].replace(/"/g, '&quot;')}">${capA}</span>${caps[key]}`;
      b.onmouseenter = () => { document.documentElement.style.setProperty('--dropcap-font', DROPCAP_FONTS[key]); };
      b.onmouseleave = preview;
      b.onclick = () => {
        picked.dropcap = key;
        buildFontStep();
        preview();
      };
      capRow.appendChild(b);
    }
    preview();
  }

  $('#fr-done').onclick = async () => {
    library.fonts = { body: picked.body, dropcap: picked.dropcap };
    library.firstRunDone = true;
    // the shelf was drawn (and the author record seeded as Anonymous) before
    // the name was typed — carry the name across
    currentAuthor().name = library.authorName || (library.penNames || [])[0] || t('Anonymous');
    await writeLibrary(library);
    applyFonts();
    fr.hidden = true;
    renderShelves();
  };
}

// Pen names: each author owns a set of shelves. Books all live in the one
// NEO Library folder on disk regardless of name — switching or deleting a
// pen name never touches files.
function currentAuthor() {
  if (!library.authors || !library.authors.length) {
    library.authors = [{
      id: 'a1',
      name: library.authorName || (library.penNames && library.penNames[0]) || t('Anonymous')
    }];
  }
  return library.authors.find((a) => a.id === library.currentAuthorId) || library.authors[0];
}

function shelvesFor(authorId) {
  const homeId = library.authors[0].id;
  return library.shelves.filter((s) => (s.authorId || homeId) === authorId);
}

function displayAuthor() {
  return currentAuthor().name || t('Anonymous');
}

// Redrawing the shelves used to read every book.json again — eighty files
// through the bridge on Pocket, for a shelf rename. The shelves now keep
// what they last read; any write to a book, and every look at the disk
// (refreshFromDisk), forgets it.
const bookMetaCache = new Map();
async function shelfMeta(bookId) {
  if (bookMetaCache.has(bookId)) return bookMetaCache.get(bookId);
  const meta = await window.neo.readBookMeta(bookId);
  if (meta) bookMetaCache.set(bookId, meta);
  return meta;
}
// Saves a book's meta and drops the cached copy. This used to be done by
// replacing window.neo.writeBookMeta, but on desktop that object is
// read-only, so the assignment threw and app.js stopped loading.
function writeBookMeta(bookId, meta) {
  bookMetaCache.delete(bookId);
  return window.neo.writeBookMeta(bookId, meta);
}

async function renderShelves() {
  await NeoCovers.ready; // display faces, so titles measure true
  const view = $('#bookshelf-view');
  const keepScroll = view.scrollTop; // re-rendering must not move the page
  $('#author-chip').textContent = displayAuthor();
  const wrap = $('#shelves');
  // the new shelves are built off-screen and swapped in whole, so the page
  // never goes blank while books are read from disk — no flash on a drop
  const built = document.createDocumentFragment();
  // shelves drag by their grip to reorder, with a gold bar showing the drop spot
  if (!wrap.dataset.dndWired) {
    wrap.dataset.dndWired = '1';
    wrap.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('application/x-neo-shelf')) return;
    e.preventDefault();
    let ind = wrap.querySelector('.shelf-drop-ind');
    if (!ind) {
      ind = document.createElement('div');
      ind.className = 'shelf-drop-ind';
    }
    let placed = false;
    for (const s of wrap.querySelectorAll('.shelf:not(.dragging)')) {
      const r = s.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        wrap.insertBefore(ind, s);
        placed = true;
        break;
      }
    }
      if (!placed) wrap.appendChild(ind);
    });
    wrap.addEventListener('drop', async (e) => {
      const shelfId = e.dataTransfer.getData('application/x-neo-shelf');
      if (!shelfId) return;
      e.preventDefault();
      const ind = wrap.querySelector('.shelf-drop-ind');
      let index = library.shelves.length;
      if (ind) {
        index = 0;
        for (const c of wrap.children) {
          if (c === ind) break;
          if (c.classList.contains('shelf') && !c.classList.contains('dragging')) index++;
        }
        ind.remove();
      }
      const moving = library.shelves.find((s) => s.id === shelfId);
      if (!moving) return;
      library.shelves = library.shelves.filter((s) => s.id !== shelfId);
      library.shelves.splice(index, 0, moving);
      await writeLibrary(library);
      // move the shelf on screen rather than redrawing everything
      const secs = [...wrap.querySelectorAll('.shelf')];
      const movingSec = secs.find((el) => el.dataset.shelfId === shelfId);
      const others = secs.filter((el) => el !== movingSec);
      if (movingSec) wrap.insertBefore(movingSec, others[index] || null);
      else renderShelves();
    });
  }

  for (const shelf of shelvesFor(currentAuthor().id)) {
    const sec = document.createElement('section');
    sec.className = 'shelf';
    sec.dataset.shelfId = shelf.id;
    if (isBound(shelf)) sec.classList.add('bound');
    if (shelf.id === justBoundId) { sec.classList.add('just-bound'); justBoundId = null; }

    const grip = document.createElement('span');
    grip.className = 'shelf-grip';
    grip.textContent = '⠿';
    grip.title = t('Drag to reorder shelves');
    grip.draggable = true;
    grip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-neo-shelf', shelf.id);
      sec.classList.add('dragging');
    });
    grip.addEventListener('dragend', () => {
      sec.classList.remove('dragging');
      const ind = document.querySelector('.shelf-drop-ind');
      if (ind) ind.remove();
    });
    sec.appendChild(grip);

    const label = document.createElement('span');
    label.className = 'shelf-label';
    // on a touch screen the name turns editable only when tapped, so a long
    // press (the menu) never wakes the keyboard or selects the text
    label.contentEditable = NO_HOVER ? 'false' : 'true';
    label.spellcheck = false;
    label.textContent = shelf.name;
    label.title = t('Click to rename · right-click to export or delete');
    if (NO_HOVER) {
      label.addEventListener('click', () => {
        if (label.isContentEditable) return;
        label.contentEditable = 'true';
        label.focus();
        const r = document.createRange();
        r.selectNodeContents(label);
        r.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      });
    }
    label.addEventListener('blur', async () => {
      const before = shelf.name;
      shelf.name = label.textContent.trim() || shelf.name;
      label.textContent = shelf.name;
      if (NO_HOVER) label.contentEditable = 'false';
      await writeLibrary(library);
      // a bound shelf's name is its book's title: the cover follows it
      if (isBound(shelf) && shelf.name !== before) { await syncCoverTitle(shelf); renderShelves(); }
    });
    label.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); label.blur(); }
    });
    // right-click a shelf label: bind it into one book, publish it as an
    // anthology, or delete it (a bound shelf has a menu of its own)
    label.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      if (isBound(shelf)) { await boundShelfMenu(shelf); return; }
      const choice = await optionModal(escHtml(t('Shelf “{name}”', { name: shelf.name })), null, [
        {
          label: t('Bind into one book'),
          desc: t('Its titles become one book, with a cover, front and back pages, and one table of contents.'),
          value: 'bind'
        },
        {
          label: t('Export shelf as anthology…'),
          desc: shelf.bookIds.length
            ? t('Collect its {n} works, in shelf order, into a single book with a table of contents.', { n: shelf.bookIds.length })
            : t('Collect the works, in shelf order, into a single book with a table of contents.'),
          value: 'anthology'
        },
        { label: t('Delete shelf'), desc: t('Books move to another shelf. Nothing is deleted from disk.'), danger: true, value: 'del' }
      ]);
      if (choice === 'bind') {
        await bindShelf(shelf);
      } else if (choice === 'anthology') {
        await exportShelfAnthology(shelf);
      } else if (choice === 'del') {
        const mine = shelvesFor(currentAuthor().id);
        if (mine.length === 1) {
          toast(t('This is your only shelf — add another before deleting this one'));
          return;
        }
        const other = mine.find((s) => s.id !== shelf.id);
        for (const id of shelf.bookIds) {
          if (isPageMeta(await shelfMeta(id))) continue; // a bound book's pages stay in the library folder
          if (!other.bookIds.includes(id)) await placeTitle(other, id);
        }
        library.shelves = library.shelves.filter((s) => s.id !== shelf.id);
        await writeLibrary(library);
        renderShelves();
      }
    });
    const row = document.createElement('div');
    row.className = 'shelf-books';
    row.dataset.shelfId = shelf.id;

    // drag targets: reorder within a shelf, move between shelves, or drop
    // manuscript files straight from Finder
    row.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        row.classList.add('drag-over');
        return;
      }
      if (!e.dataTransfer.types.includes('application/x-neo-book')) return;
      e.preventDefault();
      row.classList.add('drag-over');
      const ind = dropIndicator();
      let placed = false;
      for (const t of row.querySelectorAll('.book:not(.dragging)')) {
        const r = t.getBoundingClientRect();
        // cursor above this book's row, or on its row and left of center
        if (e.clientY < r.top || (e.clientY < r.bottom && e.clientX < r.left + r.width / 2)) {
          row.insertBefore(ind, t);
          placed = true;
          break;
        }
      }
      if (!placed) row.insertBefore(ind, row.querySelector('.new-book'));
    });
    row.addEventListener('dragleave', (e) => {
      if (row.contains(e.relatedTarget)) return;
      row.classList.remove('drag-over');
      const ind = document.querySelector('.drop-indicator');
      if (ind && ind.parentElement === row) ind.remove();
    });
    row.addEventListener('drop', async (e) => {
      row.classList.remove('drag-over');
      // files from Finder → import them right onto this shelf
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        e.preventDefault();
        const paths = [...e.dataTransfer.files]
          .map((f) => { try { return window.neo.pathForFile(f); } catch { return null; } })
          .filter(Boolean);
        if (!paths.length) return;
        toast(t('Importing…'));
        const results = await window.neo.importFiles(paths);
        if (!results.length) { toast(t('No .docx, .txt, or .md files in that drop')); return; }
        await addImportedBooks(results, shelf);
        return;
      }
      const bookId = e.dataTransfer.getData('application/x-neo-book');
      if (!bookId) return;
      e.preventDefault();
      // insertion index = how many (non-dragged) books sit before the indicator
      const ind = document.querySelector('.drop-indicator');
      let index = shelf.bookIds.filter((b) => b !== bookId).length;
      if (ind && ind.parentElement === row) {
        index = 0;
        for (const c of row.children) {
          if (c === ind) break;
          if (c.classList.contains('book') && !c.classList.contains('dragging')) index++;
        }
      }
      if (ind) ind.remove();
      const fromShelf = shelfOf(bookId);
      if (isBound(shelf)) {
        if (isPageMeta(await shelfMeta(bookId))) return; // a page keeps its place
        const { start, end } = await bodyRange(shelf, bookId);
        index = Math.min(Math.max(index, start), end);
      }
      for (const s of library.shelves) s.bookIds = s.bookIds.filter((b) => b !== bookId);
      shelf.bookIds.splice(index, 0, bookId);
      await writeLibrary(library);
      if (isBound(shelf) || isBound(fromShelf)) { renderShelves(); return; }
      // slide the tile into place; the shelf itself is not redrawn
      const tile = document.querySelector(`.book[data-book-id="${bookId}"]`);
      if (tile) {
        const others = [...row.querySelectorAll('.book')].filter((b) => b !== tile);
        row.insertBefore(tile, others[index] || row.querySelector('.new-book'));
        tile.classList.remove('dragging');
      } else renderShelves();
    });

    // the blank page — click to begin
    const blank = document.createElement('div');
    blank.className = 'new-book';
    blank.textContent = '+';
    blank.title = t('Start a new book');
    blank.onclick = () => createBookOnShelf(shelf);
    pressable(blank, t('Start a new book'));

    if (isBound(shelf)) {
      await renderBoundRow(shelf, row, blank);
      // the tiles of a shelf just bound settle in one after another
      if (sec.classList.contains('just-bound')) [...row.children].forEach((el, i) => el.style.setProperty('--i', i));
    } else {
      for (const bookId of shelf.bookIds) {
        const meta = await shelfMeta(bookId);
        if (!meta || isPageMeta(meta)) continue;
        row.appendChild(bookTile(meta));
      }
      row.appendChild(blank);
    }

    sec.appendChild(label);
    if (isBound(shelf)) {
      const mark = document.createElement('span');
      mark.className = 'shelf-bound-mark';
      mark.textContent = t('one book');
      sec.appendChild(mark);
    }
    sec.appendChild(row);
    built.appendChild(sec);
  }
  wrap.replaceChildren(built);
  view.scrollTop = keepScroll;
  fitBoundShelves();
}

// A bound shelf, measured once it's on screen: the thread under it runs as
// far as its books do, and a page's name too long for its spine (some
// languages have long ones) is set smaller until it fits
function fitBoundShelves() {
  for (const row of document.querySelectorAll('.shelf.bound .shelf-books')) {
    const last = row.lastElementChild;
    const box = row.getBoundingClientRect();
    if (!last || !box.width) continue;
    const zoom = box.width / row.offsetWidth; // the Interface Size zoom
    row.style.setProperty('--stitch', Math.ceil((last.getBoundingClientRect().right - box.left) / zoom) + 'px');
    for (const l of row.querySelectorAll('.pt-label')) {
      l.style.fontSize = '';
      l.style.letterSpacing = '';
      const room = l.clientHeight;
      const need = l.scrollHeight;
      if (!room || need <= room + 1) continue;
      const cs = getComputedStyle(l);
      const k = room / need;
      l.style.fontSize = Math.max(6.5, parseFloat(cs.fontSize) * k).toFixed(2) + 'px';
      l.style.letterSpacing = ((parseFloat(cs.letterSpacing) || 0) * k).toFixed(2) + 'px';
    }
  }
}
window.addEventListener('resize', () => {
  clearTimeout(fitBoundShelves.t);
  fitBoundShelves.t = setTimeout(fitBoundShelves, 120);
});

/* ================================================================== */
/*  BOUND SHELVES — a shelf that is one book                           */
/*  Right-click a shelf's name → Bind into one book. Its titles stay   */
/*  ordinary books to write in. A cover and the pages a published book */
/*  carries (copyright, dedication, epigraph, parts, acknowledgments,  */
/*  about the author) join them as small books of their own: plain     */
/*  folders like every other, so backups, sync and Pocket carry them.  */
/*  Hovering a bound shelf shows each missing page, faint, in its      */
/*  place; a click adds it and opens it as the page it will print as.  */
/*  Unbinding tucks the pages away (shelf.binding.parked) until the    */
/*  next binding. Nothing is ever deleted by binding or unbinding.     */
/* ================================================================== */

const PAGE_FRONT = ['copyright', 'dedication', 'epigraph'];
const PAGE_BACK = ['acknowledgments', 'about'];
// A book's own prologue and epilogue, when it has them: story, written in
// the editor like any title, standing before the first part and after the
// last. (A single book's first or last chapter can take the role too.)
const PAGE_WRITTEN = ['prologue', 'epilogue'];
// the order each end of a bound shelf keeps
const PAGE_LEAD = ['cover', ...PAGE_FRONT, 'prologue'];
const PAGE_TAIL = ['epilogue', ...PAGE_BACK];
const PAGE_KINDS = [...PAGE_LEAD, 'part', ...PAGE_TAIL];
const isPageMeta = (m) => !!(m && PAGE_KINDS.includes(m.kind));
const isBound = (shelf) => !!(shelf && shelf.binding && shelf.binding.bound);
const shelfOf = (bookId) => library.shelves.find((s) => s.bookIds.includes(bookId));

function pageKindName(kind) {
  return {
    cover: t('Cover'),
    copyright: t('Copyright'),
    dedication: t('Dedication'),
    epigraph: t('Epigraph'),
    prologue: t('Prologue'),
    part: t('Part'),
    epilogue: t('Epilogue'),
    acknowledgments: t('Acknowledgments'),
    about: t('About the Author')
  }[kind] || kind;
}

// Part I, Part II …: roman numerals read the same in every language
function roman(n) {
  const r = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of r) while (n >= v) { out += s; n -= v; }
  return out;
}
const partLabel = (n) => t('Part {n}', { n: roman(n) });

// the name a bound book goes out under: the pen name that owns the shelf
function shelfAuthorName(shelf) {
  const all = library.authors || [];
  const a = all.find((x) => x.id === shelf.authorId) || all[0];
  return (a && a.name) || t('Anonymous');
}

// a new page starts with what every such page says, where that's knowable
const PAGE_STARTERS = {
  copyright: (shelf) =>
    `<p>${escHtml(t('Copyright © {year} {name}', { year: String(new Date().getFullYear()), name: shelfAuthorName(shelf) }))}</p>` +
    `<p>${escHtml(t('All rights reserved.'))}</p>`
};

async function createPageBook(shelf, kind) {
  const written = PAGE_WRITTEN.includes(kind);
  // a prologue opens in the editor as "Prologue", under the book's name
  const title = kind === 'cover' || written ? (written ? pageKindName(kind) : shelf.name) : pageKindName(kind) + ' — ' + shelf.name;
  const meta = await window.neo.createBook({ author: shelfAuthorName(shelf), title });
  meta.title = title;
  meta.kind = kind;
  meta.shelfId = shelf.id; // which bound book it belongs to, for anyone reading the folder
  if (written) {
    meta.subtitle = shelf.name;
    meta.tabNames = {
      notes: (library.tabDefaults && library.tabDefaults.notes) || 'Notes',
      outline: (library.tabDefaults && library.tabDefaults.outline) || 'Outline'
    };
  }
  if (kind === 'cover') {
    meta.coverSeed = 'bound:' + shelf.id;
    meta.chapterOrder = [];
  } else {
    const chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    await window.neo.writeChapter(meta.id, chId, PAGE_STARTERS[kind] ? PAGE_STARTERS[kind](shelf) : '<p><br></p>');
    meta.chapterOrder = [chId];
  }
  await writeBookMeta(meta.id, meta);
  return meta;
}

// Where titles may sit on a bound shelf: after the cover and front pages,
// before the back pages (indexes into bookIds, without skipId)
async function bodyRange(shelf, skipId) {
  const ids = shelf.bookIds.filter((b) => b !== skipId);
  const kinds = [];
  for (const id of ids) {
    const m = await shelfMeta(id);
    kinds.push((m && m.kind) || '');
  }
  let start = 0;
  while (start < ids.length && PAGE_LEAD.includes(kinds[start])) start++;
  let end = ids.length;
  while (end > start && PAGE_TAIL.includes(kinds[end - 1])) end--;
  return { start, end };
}

// Put a title on a shelf: last in line (or first), which on a bound shelf
// means the end (or start) of its body, never after the back pages
async function placeTitle(shelf, bookId, atStart) {
  shelf.bookIds = shelf.bookIds.filter((b) => b !== bookId);
  if (!isBound(shelf)) {
    if (atStart) shelf.bookIds.unshift(bookId); else shelf.bookIds.push(bookId);
    return;
  }
  const { start, end } = await bodyRange(shelf);
  shelf.bookIds.splice(atStart ? start : end, 0, bookId);
}

let justBoundId = null; // the shelf whose binding the next drawing shows
async function bindShelf(shelf) {
  shelf.binding = Object.assign({ numbering: 'through', parked: [] }, shelf.binding || {}, { bound: true });
  restoreParked(shelf);
  let cover = null;
  for (const id of shelf.bookIds) {
    const m = await shelfMeta(id);
    if (m && m.kind === 'cover') { cover = m; break; }
  }
  if (!cover) {
    cover = await createPageBook(shelf, 'cover');
    shelf.bookIds.unshift(cover.id);
  } else if (cover.title !== shelf.name) {
    cover.title = shelf.name;
    await writeBookMeta(cover.id, cover);
  }
  await writeLibrary(library);
  justBoundId = shelf.id;
  await renderShelves();
  toast(t('“{name}” is bound into one book', { name: shelf.name }));
}

// the pages come back where they were: the cover and front pages lead, a
// part page returns before the title it opened, the back pages close
function restoreParked(shelf) {
  const parked = (shelf.binding && shelf.binding.parked) || [];
  if (!parked.length) return;
  const front = parked.filter((p) => PAGE_LEAD.includes(p.kind))
    .sort((a, b) => PAGE_LEAD.indexOf(a.kind) - PAGE_LEAD.indexOf(b.kind));
  const back = parked.filter((p) => PAGE_TAIL.includes(p.kind))
    .sort((a, b) => PAGE_TAIL.indexOf(a.kind) - PAGE_TAIL.indexOf(b.kind));
  const body = shelf.bookIds.filter((id) => !parked.some((p) => p.id === id));
  for (const p of parked.filter((x) => x.kind === 'part')) {
    const at = p.before ? body.indexOf(p.before) : -1;
    if (at >= 0) body.splice(at, 0, p.id); else body.push(p.id);
  }
  shelf.bookIds = [...front.map((p) => p.id), ...body, ...back.map((p) => p.id)];
  shelf.binding.parked = [];
}

async function unbindShelf(shelf) {
  const ids = [...shelf.bookIds];
  const metas = [];
  for (const id of ids) metas.push(await shelfMeta(id));
  const parked = [];
  const titles = [];
  ids.forEach((id, i) => {
    const m = metas[i];
    if (!isPageMeta(m)) { titles.push(id); return; }
    // a part page remembers the title it opens
    let before = null;
    if (m.kind === 'part') {
      for (let j = i + 1; j < ids.length; j++) {
        if (metas[j] && !isPageMeta(metas[j])) { before = ids[j]; break; }
      }
    }
    parked.push({ id, kind: m.kind, before });
  });
  shelf.bookIds = titles;
  shelf.binding = Object.assign({}, shelf.binding, { bound: false, parked });
  await writeLibrary(library);
  await renderShelves();
  toast(t('Unbound. Its pages wait for the next binding.'));
}

// the shelf's name is the book's title, so a rename reaches the cover too
async function syncCoverTitle(shelf) {
  for (const id of shelf.bookIds) {
    const m = await shelfMeta(id);
    if (m && m.kind === 'cover') {
      if (m.title !== shelf.name) { m.title = shelf.name; await writeBookMeta(m.id, m); }
      return;
    }
  }
}

/* ---------- a bound shelf, drawn ---------- */

async function renderBoundRow(shelf, row, blank) {
  const items = [];
  for (const id of shelf.bookIds) {
    const m = await shelfMeta(id);
    if (m) items.push(m);
  }
  let f = 0;
  while (f < items.length && PAGE_LEAD.includes(items[f].kind)) f++;
  let b = items.length;
  while (b > f && PAGE_TAIL.includes(items[b - 1].kind)) b--;
  const front = items.slice(0, f);
  const body = items.slice(f, b);
  const back = items.slice(b);
  const cover = front.find((m) => m.kind === 'cover');
  if (cover) row.appendChild(boundCoverTile(shelf, cover));
  const offer = missingPages(body);
  appendPageZone(row, shelf, front.filter((m) => m.kind !== 'cover'), [...PAGE_FRONT, 'prologue'], offer);
  let parts = 0;
  body.forEach((m, i) => {
    if (m.kind === 'part') {
      parts += 1;
      row.appendChild(pageTile(shelf, m, partLabel(parts)));
      return;
    }
    if (isPageMeta(m)) { row.appendChild(pageTile(shelf, m, pageKindName(m.kind))); return; }
    const prev = body[i - 1];
    if (!NO_HOVER && !(prev && prev.kind === 'part')) row.appendChild(partSeam(shelf, m.id));
    row.appendChild(bookTile(m));
  });
  row.appendChild(blank);
  appendPageZone(row, shelf, back, PAGE_TAIL, offer);
}

// Which pages a bound book could still take. A book of one title whose
// first chapter is already its prologue isn't offered another (nor one
// whose last chapter is its epilogue).
function missingPages(body) {
  const titles = body.filter((m) => !isPageMeta(m));
  const lone = titles.length === 1 ? titles[0] : null;
  const own = (role) => !!lone && (lone.chapterOrder || []).some((c) => chapterRole(c, lone) === role);
  return (kind) => !(PAGE_WRITTEN.includes(kind) && own(kind));
}

// the pages of one end of the book, each in its place, with a faint
// stand-in (shown on hover) wherever one could be added
function appendPageZone(row, shelf, have, kinds, offer) {
  const left = [...have];
  for (const k of kinds) {
    const i = left.findIndex((m) => m.kind === k);
    if (i >= 0) row.appendChild(pageTile(shelf, left.splice(i, 1)[0], pageKindName(k)));
    else if (!NO_HOVER && offer(k)) row.appendChild(ghostPage(shelf, k));
  }
  for (const m of left) row.appendChild(pageTile(shelf, m, pageKindName(m.kind)));
}

function boundCoverTile(shelf, meta) {
  // the cover wears the shelf's name, whatever its folder was first called
  const shown = Object.assign({}, meta, { title: shelf.name, author: meta.author || shelfAuthorName(shelf) });
  const el = bookTile(shown, { cover: shelf });
  el.classList.add('bound-cover');
  el.draggable = false;
  return el;
}

// a page's name runs up its spine; a long one is set smaller to fit
const spineFit = (label) => (label.length > 17 ? ' longer' : label.length > 12 ? ' long' : '');

function pageTile(shelf, meta, label) {
  const el = document.createElement('div');
  el.className = 'book page-tile kind-' + meta.kind + spineFit(label);
  el.dataset.bookId = meta.id;
  el.draggable = false;
  const span = document.createElement('span');
  span.className = 'pt-label';
  span.textContent = label;
  el.appendChild(span);
  el.title = label;
  el.onclick = () => openPage(shelf, meta, label);
  pressable(el, label);
  el.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const choice = await optionModal(escHtml(label), null, [
      { label: t('Open'), value: 'open' },
      {
        label: t('Remove page'),
        desc: window.Capacitor
          ? t('Removes the book folder. The Files app keeps it in Recently Deleted for 30 days.')
          : t('Sends the page to your system trash, where you can recover it.'),
        danger: true, value: 'remove'
      }
    ]);
    if (choice === 'open') openPage(shelf, meta, label);
    else if (choice === 'remove' && await window.neo.deleteBook(meta.id, label)) {
      shelf.bookIds = shelf.bookIds.filter((b) => b !== meta.id);
      await writeLibrary(library);
      renderShelves();
    }
  });
  return el;
}

function ghostPage(shelf, kind) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'ghost-page' + spineFit(pageKindName(kind));
  el.innerHTML = '<span class="gp-plus" aria-hidden="true">+</span><span class="pt-label"></span>';
  el.querySelector('.pt-label').textContent = pageKindName(kind);
  el.title = pageKindName(kind);
  el.setAttribute('aria-label', pageKindName(kind));
  el.onclick = () => addPage(shelf, kind);
  return el;
}

function partSeam(shelf, beforeId) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'part-seam';
  el.title = t('Start a part here');
  el.setAttribute('aria-label', t('Start a part here'));
  el.innerHTML = '<span class="ps-line"></span><span class="ps-plus">+</span>';
  el.onclick = () => addPage(shelf, 'part', beforeId);
  return el;
}

// A new page goes where books put it: front pages after the cover in their
// usual order, back pages at the end in theirs, a part before its title
async function addPage(shelf, kind, beforeId) {
  const meta = await createPageBook(shelf, kind);
  const ids = shelf.bookIds;
  let at = ids.length;
  if (kind === 'part') {
    at = beforeId ? ids.indexOf(beforeId) : -1;
    if (at < 0) at = (await bodyRange(shelf)).end;
  } else if (PAGE_LEAD.includes(kind)) {
    at = 0;
    for (let i = 0; i < ids.length; i++) {
      const m = await shelfMeta(ids[i]);
      const k = m && m.kind;
      if (PAGE_LEAD.includes(k) && PAGE_LEAD.indexOf(k) < PAGE_LEAD.indexOf(kind)) at = i + 1;
      else break;
    }
  } else {
    for (let i = ids.length - 1; i >= 0; i--) {
      const m = await shelfMeta(ids[i]);
      const k = m && m.kind;
      if (PAGE_TAIL.includes(k) && PAGE_TAIL.indexOf(k) > PAGE_TAIL.indexOf(kind)) at = i;
      else break;
    }
  }
  ids.splice(at, 0, meta.id);
  await writeLibrary(library);
  await renderShelves();
  let label = pageKindName(kind);
  if (kind === 'part') {
    let n = 0;
    for (const id of shelf.bookIds) {
      const m = await shelfMeta(id);
      if (m && m.kind === 'part') n += 1;
      if (id === meta.id) break;
    }
    label = partLabel(n);
  }
  openPage(shelf, meta, label);
}

// A prologue or an epilogue is story: it opens in the editor, ready to
// write in. Every other page opens as the sheet it will print on.
async function openPage(shelf, meta, label) {
  if (!PAGE_WRITTEN.includes(meta.kind)) { openPageSheet(shelf, meta, label); return; }
  await openBook(meta.id);
  // a first visit starts at the top of the page, under its title
  if (book && book.id === meta.id && !book.lastPosition && book.chapterOrder[0]) focusChapterStart(book.chapterOrder[0]);
}

/* ---------- a page, open as it will print ---------- */

const PAGE_PLACEHOLDERS = {
  dedication: () => t('For…'),
  epigraph: () => '…',
  part: () => t('Title')
};

// Whatever the editing engine left, a page is stored as NEO's plain
// paragraphs: loose text and <div>s become <p>s, stray <br>s go
function normalizePageBody(body) {
  let cur = null;
  for (const node of [...body.childNodes]) {
    if (node.nodeType === 1 && /^(P|DIV|H[1-6]|BLOCKQUOTE|LI|UL|OL)$/.test(node.tagName)) {
      cur = null;
      if (node.tagName !== 'P') {
        const p = document.createElement('p');
        while (node.firstChild) p.appendChild(node.firstChild);
        node.replaceWith(p);
      }
      continue;
    }
    const blank = (node.nodeType === 3 && !node.textContent.trim()) || (node.nodeType === 1 && node.tagName === 'BR');
    if (!cur && blank) { node.remove(); continue; }
    if (!cur) {
      cur = document.createElement('p');
      body.insertBefore(cur, node);
    }
    cur.appendChild(node);
  }
  if (!body.querySelector('p')) body.innerHTML = '<p><br></p>';
}

function sheetBackdrop(kind, label, inner) {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop page-sheet-backdrop';
  bd.innerHTML = `
    <div class="page-sheet" role="dialog" aria-modal="true">
      <div class="ps-bar"><span class="ps-name"></span><button class="m-ok ps-done">${t('Done')}</button></div>
      <div class="ps-paper kind-${kind}">${inner}</div>
    </div>`;
  bd.querySelector('.ps-name').textContent = label;
  bd.querySelector('.page-sheet').setAttribute('aria-label', label);
  return bd;
}

// the lines of a page that say who said the lines above them (a dash first)
const ATTRIBUTED_PAGES = ['dedication', 'epigraph', 'part'];

async function openPageSheet(shelf, meta, label) {
  const live = (await window.neo.readBookMeta(meta.id)) || meta;
  let chId = (live.chapterOrder || [])[0];
  if (!chId) {
    chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    live.chapterOrder = [chId];
    await writeBookMeta(live.id, live);
  }
  const html = await window.neo.readChapter(live.id, chId);
  const bd = sheetBackdrop(live.kind, label, '<div class="ps-label" hidden></div><div class="ps-body" contenteditable="true" role="textbox" aria-multiline="true"></div>');
  const lab = bd.querySelector('.ps-label');
  if (live.kind === 'part') { lab.hidden = false; lab.textContent = label; }
  if (PAGE_BACK.includes(live.kind)) { lab.hidden = false; lab.textContent = pageKindName(live.kind); }
  const body = bd.querySelector('.ps-body');
  body.setAttribute('aria-label', label);
  body.innerHTML = html && html.trim() ? html : '<p><br></p>';
  if (PAGE_PLACEHOLDERS[live.kind]) body.dataset.ph = PAGE_PLACEHOLDERS[live.kind]();
  // the page shows what it will print: a line that opens with a dash is set
  // as the name of whoever said the lines above it
  const settle = () => {
    body.classList.toggle('empty', !body.textContent.trim());
    if (!ATTRIBUTED_PAGES.includes(live.kind)) return;
    for (const p of body.querySelectorAll('p')) p.toggleAttribute('data-attr', isAttribution({ text: p.textContent.trim() }));
  };
  settle();
  let timer = null;
  let saved = body.innerHTML;
  const save = async () => {
    clearTimeout(timer);
    timer = null;
    normalizePageBody(body);
    const out = body.cloneNode(true);
    out.querySelectorAll('[data-attr]').forEach((p) => p.removeAttribute('data-attr'));
    if (out.innerHTML === saved) return;
    saved = out.innerHTML;
    await window.neo.writeChapter(live.id, chId, saved);
  };
  body.addEventListener('input', () => {
    settle();
    clearTimeout(timer);
    timer = setTimeout(save, 600);
  });
  body.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (pasted) document.execCommand('insertHTML', false, cleanPasteHtml(pasted));
    else if (text) {
      text.replace(/\r/g, '').split(/\n+/).filter((p) => p.trim()).forEach((p, i) => {
        if (i > 0) document.execCommand('insertParagraph');
        document.execCommand('insertText', false, p.trim());
      });
    }
  });
  document.body.appendChild(bd);
  document.execCommand('defaultParagraphSeparator', false, 'p');
  const close = async () => {
    if (!bd.isConnected) return;
    await save();
    bd.remove();
  };
  bd.querySelector('.ps-done').onclick = close;
  bd.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  // the caret waits at the end of whatever the page already says
  body.focus();
  caretToEnd(body.lastElementChild || body);
}

function caretToEnd(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

// The cover opens to the title page: the book's title (the shelf's name),
// a subtitle, and the name it goes out under. One line each; Enter moves on.
async function openTitlePage(shelf, coverMeta) {
  const live = (await window.neo.readBookMeta(coverMeta.id)) || coverMeta;
  const bd = sheetBackdrop('title', t('Title Page'), `
    <div class="tp-field tp-t" contenteditable="true" role="textbox" spellcheck="false"></div>
    <div class="tp-field tp-s" contenteditable="true" role="textbox" spellcheck="false"></div>
    <div class="tp-field tp-a" contenteditable="true" role="textbox" spellcheck="false"></div>`);
  const fields = ['.tp-t', '.tp-s', '.tp-a'].map((s) => bd.querySelector(s));
  const [ti, su, au] = fields;
  const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
  [[ti, shelf.name, t('Title')], [su, live.subtitle || '', t('Subtitle')], [au, live.author || shelfAuthorName(shelf), t('Author')]]
    .forEach(([el, value, name]) => {
      el.textContent = value;
      el.dataset.ph = name;
      el.setAttribute('aria-label', name);
    });
  const close = async () => {
    if (!bd.isConnected) return;
    bd.remove();
    const title = text(ti) || shelf.name;
    const subtitle = text(su);
    const author = text(au) || shelfAuthorName(shelf);
    if (title === shelf.name && subtitle === (live.subtitle || '') && author === (live.author || '')) return;
    shelf.name = title;
    live.title = title;
    live.subtitle = subtitle;
    live.author = author;
    await writeBookMeta(live.id, live);
    await writeLibrary(library);
    renderShelves();
  };
  for (const f of fields) {
    // an emptied line shows its name again
    f.addEventListener('input', () => { if (!f.textContent) f.innerHTML = ''; });
    f.addEventListener('paste', (e) => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\s+/g, ' '));
    });
    f.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const next = fields[fields.indexOf(f) + 1];
      if (next) { next.focus(); caretToEnd(next); } else close();
    });
  }
  document.body.appendChild(bd);
  bd.querySelector('.ps-done').onclick = close;
  bd.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  ti.focus();
  const r = document.createRange();
  r.selectNodeContents(ti);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

/* ---------- the bound shelf's own menu (right-click its name) ---------- */

async function boundShelfMenu(shelf) {
  const through = (shelf.binding.numbering || 'through') !== 'restart';
  const options = [
    { label: t('Export the book…'), desc: t('EPUB, Word or PDF, with its cover, its pages and one table of contents.'), value: 'export' },
    {
      label: (through ? '✓ ' : '') + t('Number chapters straight through'),
      desc: through ? t('Each title picks up where the one before it left off.') : t('Each title starts again at Chapter 1.'),
      value: 'numbering'
    },
    { label: t('Unbind'), desc: t('A shelf of separate titles again. Its pages wait for the next binding.'), value: 'unbind' }
  ];
  // a touch screen has no hover to show the pages it could still have
  const missing = [];
  if (NO_HOVER) {
    const have = new Set();
    const body = [];
    for (const id of shelf.bookIds) {
      const m = await shelfMeta(id);
      if (isPageMeta(m)) have.add(m.kind);
      else if (m) body.push(m);
    }
    const offer = missingPages(body);
    missing.push(...[...PAGE_FRONT, 'prologue', 'epilogue', ...PAGE_BACK].filter((k) => !have.has(k) && offer(k)));
    if (missing.length) options.splice(1, 0, { label: t('Add a page…'), value: 'page' });
  }
  const choice = await optionModal(escHtml(t('“{name}” · one book', { name: shelf.name })), null, options);
  if (choice === 'export') {
    await exportBoundBook(shelf);
  } else if (choice === 'page') {
    const kind = await optionModal(t('Add a page…'), null, missing.map((k) => ({ label: pageKindName(k), value: k })));
    if (kind) await addPage(shelf, kind);
  } else if (choice === 'numbering') {
    shelf.binding.numbering = through ? 'restart' : 'through';
    await writeLibrary(library);
    toast(through ? t('Each title starts again at Chapter 1') : t('Chapters are numbered straight through'));
  } else if (choice === 'unbind') {
    await unbindShelf(shelf);
  }
}

// single shared drop-position indicator for shelf drags
let _dropInd = null;
function dropIndicator() {
  if (!_dropInd) {
    _dropInd = document.createElement('div');
    _dropInd.className = 'drop-indicator';
  }
  return _dropInd;
}

// Covers are two layers the shelf composites live: art (a seeded abstract,
// an image the writer chose, or one NEO painted from the text) and type.
// See covers.js. Painted art is read once and downsampled to tile size so
// forty books on a shelf cost about as much as forty small PNGs.
const artCache = new Map(); // bookId/file -> { url, canvas }

async function paintedArt(meta) {
  const art = meta.coverArt;
  if (!art || art.status !== 'done' || !art.file) return null;
  const key = meta.id + '/' + art.file;
  if (artCache.has(key)) return artCache.get(key);
  try {
    const data = await window.neo.readCover(meta.id, art.file);
    if (!data) { window.neo.logError('painted cover missing on disk: ' + key); return null; }
    const entry = await NeoCovers.fitImage(key, `data:${data.mime};base64,${data.base64}`);
    if (!entry) { window.neo.logError('painted cover would not decode: ' + key); return null; }
    artCache.set(key, entry);
    return entry;
  } catch (err) {
    window.neo.logError('painted cover: ' + (err && err.stack || err));
    return null;
  }
}

// Which layers a book has to show, and which one is showing. Nothing is
// ever thrown away by switching: the writer's image, NEO's painting, and the
// abstract all stay available, and coverMode just picks one.
const hasPainting = (meta) => !!(meta.coverArt && meta.coverArt.status === 'done' && meta.coverArt.file);
function coverMode(meta) {
  const m = meta.coverMode;
  if (m === 'image' && meta.coverImage) return 'image';
  if (m === 'painted' && hasPainting(meta)) return 'painted';
  if (m === 'abstract') return 'abstract';
  return meta.coverImage ? 'image' : hasPainting(meta) ? 'painted' : 'abstract';
}

function dressTile(el, meta) {
  el.classList.remove('has-cover');
  const mode = coverMode(meta);
  if (mode === 'image') {
    el.classList.add('has-cover');
    el.style.background = `#1d1d1d url("${coverUrl(meta)}") center / cover no-repeat`;
    return;
  }
  el.classList.toggle('cv-painting', !!(meta.coverArt && meta.coverArt.status === 'pending'));
  const token = (el._dressToken = (el._dressToken || 0) + 1);
  // a painting already decoded is drawn straight away; otherwise the
  // abstract shows instantly and the painting replaces it once read.
  // The tile may not be on the page yet when the art arrives, so the only
  // staleness check is whether this tile has been dressed again since.
  const cached = mode === 'painted' && artCache.get(meta.id + '/' + meta.coverArt.file);
  NeoCovers.dress(el, NeoCovers.plan(meta, cached || undefined));
  if (mode !== 'painted' || cached) return;
  paintedArt(meta).then((art) => {
    if (art && el._dressToken === token) NeoCovers.dress(el, NeoCovers.plan(meta, art));
  });
}

function bookTile(meta, opts = {}) {
  const el = document.createElement('div');
  el.className = 'book';
  el.dataset.bookId = meta.id;
  el.draggable = true;
  el.innerHTML = `
    <div class="b-text"><div class="b-title"></div><div class="b-author"></div></div>
    <span class="b-refresh" title="${t('New cover')}">&#8635;</span>
    <div class="b-painting" hidden></div>
    <div class="b-progress" hidden><div></div></div>`;
  el.querySelector('.b-author').textContent = meta.author || '';
  dressTile(el, meta);
  el.querySelector('.b-painting').hidden = !(meta.coverArt && meta.coverArt.status === 'pending');
  el.querySelector('.b-refresh').onclick = async (e) => {
    e.stopPropagation();
    await refreshCover(meta, el);
  };
  if (meta.wordGoal > 0) {
    const bar = el.querySelector('.b-progress');
    bar.hidden = false;
    const pct = Math.min(100, Math.round(((meta.wordCount || 0) / meta.wordGoal) * 100));
    bar.firstElementChild.style.width = pct + '%';
  }
  el.title = meta.wordGoal
    ? t('{title} — {count} / {goal} words', { title: meta.title, count: meta.wordCount || 0, goal: meta.wordGoal })
    : meta.title;
  el.onclick = () => (opts.cover ? openTitlePage(opts.cover, meta) : openBook(meta.id));
  pressable(el, [el.title, meta.author ? t('by {author}', { author: meta.author }) : ''].filter(Boolean).join(', '));
  el.querySelector('.b-refresh').setAttribute('aria-hidden', 'true'); // the book's right-click menu offers the same
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/x-neo-book', meta.id);
    // the ghost that rides under the cursor is a faded, smaller cover, held
    // by its top-left corner so it never sits on top of a drop target's label
    el.style.opacity = '0.45';
    el.style.transform = 'scale(0.7)';
    e.dataTransfer.setDragImage(el, 12, 12);
    setTimeout(() => { el.style.opacity = ''; el.style.transform = ''; el.classList.add('dragging'); }, 0);
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  // images dragged from Finder onto a book become its cover;
  // manuscripts dropped here import onto this book's shelf
  el.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  el.addEventListener('drop', async (e) => {
    if (!e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    e.stopPropagation();
    let p = null;
    try { p = window.neo.pathForFile(e.dataTransfer.files[0]); } catch { /* no path */ }
    if (!p) return;
    if (/\.(png|jpe?g|webp)$/i.test(p)) {
      const fname = await window.neo.setCover(meta.id, p);
      if (fname) {
        meta.coverImage = fname;
        meta.coverMode = 'image';
        await writeBookMeta(meta.id, meta);
        renderShelves();
      }
    } else if (/\.(docx|txt|md)$/i.test(p)) {
      const homeShelf = library.shelves.find((s) => s.bookIds.includes(meta.id)) || library.shelves[0];
      const results = await window.neo.importFiles([p]);
      if (results.length) await addImportedBooks(results, homeShelf);
    }
  });

  el.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (opts.cover) { await boundCoverMenu(opts.cover, meta, el); return; }
    const options = [];
    // on a bound shelf, a title can open a new part of the book
    const home = shelfOf(meta.id);
    if (isBound(home)) {
      const at = home.bookIds.indexOf(meta.id);
      const prev = at > 0 ? bookMetaCache.get(home.bookIds[at - 1]) : null;
      if (!(prev && prev.kind === 'part')) {
        options.push({ label: t('Start a part here'), desc: t('A part page goes in before “{title}”.', { title: escHtml(meta.title) }), value: 'part' });
      }
    }
    // no hover on a touch screen, so the ↻ that lives under the pointer
    // moves into the menu; picking an image file is a desktop affair
    if (NO_HOVER) options.push({ label: t('New cover'), desc: t('Another abstract cover for this book.'), value: 'refresh' });
    else options.push({ label: meta.coverImage ? t('Replace cover art…') : t('Set cover art…'), desc: t('Pick an image (2:3 works best). Or just drag one from Finder onto the book.'), value: 'cover' });
    if (meta.coverImage) {
      options.push({ label: t('Remove cover art'), desc: t('Deletes the image from the book folder. (To just hide it, use the ↻ on the book.)'), danger: true, value: 'uncover' });
    }
    // Pocket has no File menu: export lives here and in the ⋯ sheet
    if (window.Capacitor) options.push({ label: t('Export…'), desc: t('Text, Markdown, HTML, Word or EPUB, through the share sheet.'), value: 'export' });
    options.push(
      // the ↻ on the cover, for the keyboard and screen readers
      { label: t('New cover'), value: 'refresh' },
      { label: t('Set word goal…'), desc: t('Adds the subtle progress bar to the cover.'), value: 'goal' },
      { label: t('Remove from bookshelf'), desc: t('Takes it off your shelves. The files stay safe in your NEO Library folder on disk.'), value: 'remove' },
      window.Capacitor
        ? { label: t('Delete book'), desc: t('Removes the book folder. The Files app keeps it in Recently Deleted for 30 days.'), danger: true, value: 'trash' }
        : {
          label: navigator.platform.toLowerCase().includes('win') ? t('Move to Recycle Bin') : t('Move to Trash'),
          desc: t('Sends the book folder to your system trash, where you can recover it.'),
          danger: true, value: 'trash'
        }
    );
    const choice = await optionModal(`“${escHtml(meta.title)}”`, null, options);
    if (choice === 'part') {
      await addPage(home, 'part', meta.id);
    } else if (choice === 'refresh') {
      await refreshCover(meta, el);
    } else if (choice === 'export') {
      const fmt = await optionModal(t('Export “{title}”', { title: meta.title }), null, [
        { label: t('Text (.txt)'), value: 'txt' }, { label: t('Markdown (.md)'), value: 'md' }, { label: t('HTML (.html)'), value: 'html' },
        { label: t('Word (.docx)'), value: 'docx' }, { label: t('EPUB (.epub)'), value: 'epub' }
      ]);
      if (!fmt) return;
      await openBook(meta.id);
      await doExport(fmt);
    } else if (choice === 'cover') {
      const src = await window.neo.pickCover();
      if (!src) return;
      const fname = await window.neo.setCover(meta.id, src);
      if (fname) {
        meta.coverImage = fname;
        meta.coverMode = 'image';
        await writeBookMeta(meta.id, meta);
        renderShelves();
      }
    } else if (choice === 'refresh') {
      await refreshCover(meta, el);
    } else if (choice === 'uncover') {
      await window.neo.removeCover(meta.id);
      meta.coverImage = null;
      await writeBookMeta(meta.id, meta);
      renderShelves();
    } else if (choice === 'goal') {
      const goal = await askInput(t('Word count goal for “{title}”', { title: meta.title }), t('e.g. 80000 — blank removes the goal'),
        meta.wordGoal ? String(meta.wordGoal) : '');
      if (goal === null) return;
      meta.wordGoal = parseInt(goal, 10) || 0;
      await writeBookMeta(meta.id, meta);
      renderShelves();
    } else if (choice === 'remove') {
      for (const s of library.shelves) s.bookIds = s.bookIds.filter((b) => b !== meta.id);
      await writeLibrary(library);
      renderShelves();
      toast(t('“{title}” removed from the shelves — its files are still in your NEO Library', { title: meta.title }));
    } else if (choice === 'trash') {
      const ok = await window.neo.deleteBook(meta.id, meta.title);
      if (ok) {
        for (const s of library.shelves) s.bookIds = s.bookIds.filter((b) => b !== meta.id);
        await writeLibrary(library);
        renderShelves();
      }
    }
  });
  return el;
}

/* ---- painted covers ----
   At a thousand words a story has a shape, so NEO reads it and paints an
   abstract cover to sit under the type. The writer's own cover (coverImage)
   always wins; the abstract is the fallback; painting never blocks typing. */

const PAINT_AT = 1000;
const STALE_PAINT_MS = 10 * 60 * 1000; // a job that never came back

function paintable(meta) {
  if (!meta || meta.coverImage) return false; // the writer's own art is never painted over
  if (meta.kind) return false; // a bound book's pages show no cover of their own
  if ((meta.wordCount || 0) < PAINT_AT) return false;
  const art = meta.coverArt;
  if (!art) return true;
  if (art.status === 'pending') return Date.now() - Date.parse(art.at || 0) > STALE_PAINT_MS;
  return false; // done, shelved, or failed: the ↻ on the tile is the way back in
}

function bookPlainText() {
  return book.chapterOrder.map((id) => chapterText(id)).join('\n\n');
}

// Paint the open book, or a book on the shelf (text is read from disk then).
async function requestPaint(meta, text) {
  const provider = coverProvider();
  if (!(await window.neo.hasSecret(provider))) {
    if (!library.coverArtNudged) {
      library.coverArtNudged = true;
      await writeLibrary(library);
      toast(t('This story just passed {n} words — add an API key under File → Cover Art… and NEO will paint it a cover.', { n: PAINT_AT }), 8000);
    }
    return;
  }
  meta.coverArt = { status: 'pending', at: new Date().toISOString(), words: meta.wordCount || 0 };
  if (book && book.id === meta.id) scheduleMetaSave();
  else await writeBookMeta(meta.id, meta);
  markPainting(meta.id, true);
  if (text == null) {
    const m = await window.neo.readBookMeta(meta.id);
    const parts = [];
    for (const chId of (m && m.chapterOrder) || []) {
      const holder = document.createElement('div');
      holder.innerHTML = await window.neo.readChapter(meta.id, chId);
      holder.querySelectorAll('.darling-anchor, .ph-mark, .ghost').forEach((n) => n.remove());
      parts.push(holder.innerText);
    }
    text = parts.join('\n\n');
  }
  const cs = coverSettings();
  const mine = (cs.models && cs.models[provider]) || {};
  let res = null;
  try {
    res = await window.neo.paintCover(meta.id, text, { provider, textModel: mine.text, imageModel: mine.image, quality: cs.quality });
  } catch (err) {
    window.neo.logError('paint request: ' + (err && err.stack || err));
    res = { error: String((err && err.message) || err) };
  }
  // the writer may have moved on — write to whichever copy of the meta is live
  const live = (book && book.id === meta.id) ? book : (await window.neo.readBookMeta(meta.id)) || meta;
  if (res && res.file) {
    live.coverArt = { status: 'done', file: res.file, brief: res.brief, words: meta.wordCount || 0, at: new Date().toISOString() };
    if (!live.coverImage) live.coverMode = 'painted';
    artCache.delete(meta.id + '/' + res.file);
  } else {
    live.coverArt = { status: 'failed', error: (res && res.error) || 'unknown', at: new Date().toISOString() };
    toast(t('NEO couldn’t paint that cover: {error}', { error: live.coverArt.error }), 7000);
  }
  if (live === book) scheduleMetaSave();
  else await writeBookMeta(meta.id, live);
  markPainting(meta.id, false);
  if (!$('#bookshelf-view').hidden) renderShelves();
}

// shimmer on the tile while its painting is in flight
function markPainting(bookId, on) {
  for (const el of $$('.book')) {
    if (el.dataset.bookId !== bookId) continue;
    el.classList.toggle('cv-painting', on);
    const sh = el.querySelector('.b-painting');
    if (sh) sh.hidden = !on;
  }
}

// the ↻ on a tile: switch between the covers a book has, re-roll the
// abstract, or paint a fresh one from the text
async function refreshCover(meta, el) {
  const mode = coverMode(meta);
  const enough = (meta.wordCount || 0) >= PAINT_AT;
  // a bound book's cover has no text of its own to paint from
  const hasKey = meta.kind !== 'cover' && await window.neo.hasSecret(coverProvider());
  const options = [];
  if (meta.coverImage && mode !== 'image') options.push({ label: t('Show your cover art'), desc: t('The image you gave this book.'), value: 'image' });
  if (hasPainting(meta) && mode !== 'painted') options.push({ label: t('Show NEO’s painting'), desc: t('The cover painted from the text.'), value: 'painted' });
  if (mode !== 'abstract') options.push({ label: t('Show the abstract'), desc: t('The seeded cover every book starts with.'), value: 'abstract' });
  options.push({ label: t('New type & colours'), desc: mode === 'abstract' ? t('A fresh abstract and a different title style.') : t('Re-sets the title in a different style over the same art.'), value: 'reroll' });
  if (hasKey) {
    options.push(enough
      ? { label: hasPainting(meta) ? t('Paint it again') : t('Paint a cover from the text'), desc: t('NEO reads the manuscript and paints a new cover. About a minute; a few cents.'), value: 'paint' }
      : { label: t('Paint a cover from the text'), desc: t('Once the story passes {n} words.', { n: PAINT_AT }), value: 'nope' });
  }
  // a plain abstract with nothing else to offer just re-rolls
  const choice = options.length === 1 ? 'reroll' : await optionModal(t('Cover for “{title}”', { title: escHtml(meta.title) }), null, options);
  if (!choice || choice === 'nope') return;
  const live = (book && book.id === meta.id) ? book : meta;
  if (choice === 'paint') {
    if (meta.coverArt && meta.coverArt.status === 'pending' && !paintable(meta)) { toast(t('Still painting…')); return; }
    live.coverMode = 'painted';
    requestPaint(live, book && book.id === meta.id ? bookPlainText() : null);
    return;
  }
  if (choice === 'reroll') {
    live.coverSeed = meta.id + ':' + (meta.wordCount || 0) + ':' + Date.now().toString(36);
    if (mode === 'image') live.coverMode = 'abstract';
  } else {
    live.coverMode = choice;
  }
  if (live === book) scheduleMetaSave(); else await writeBookMeta(meta.id, live);
  dressTile(el, live);
}

async function createBookOnShelf(shelf) {
  const meta = await window.neo.createBook({ author: displayAuthor() });
  meta.tabNames = {
    notes: (library.tabDefaults && library.tabDefaults.notes) || 'Notes',
    outline: (library.tabDefaults && library.tabDefaults.outline) || 'Outline'
  };
  await writeBookMeta(meta.id, meta);
  await placeTitle(shelf, meta.id);
  await writeLibrary(library);
  openBook(meta.id);
}

// While dragging a book or shelf, nearing the window's top or bottom edge
// scrolls the bookshelf — faster the deeper into the edge zone you push.
let shelfScrollDir = 0;
let shelfScrollRAF = null;
function shelfAutoScrollStep() {
  if (!shelfScrollDir) { shelfScrollRAF = null; return; }
  $('#bookshelf-view').scrollTop += shelfScrollDir;
  shelfScrollRAF = requestAnimationFrame(shelfAutoScrollStep);
}
{
  const view = $('#bookshelf-view');
  const EDGE = 90;
  view.addEventListener('dragover', (e) => {
    const h = window.innerHeight;
    if (e.clientY < EDGE) shelfScrollDir = -Math.ceil((EDGE - e.clientY) / 5);
    else if (e.clientY > h - EDGE) shelfScrollDir = Math.ceil((e.clientY - (h - EDGE)) / 5);
    else shelfScrollDir = 0;
    if (shelfScrollDir && !shelfScrollRAF) shelfScrollRAF = requestAnimationFrame(shelfAutoScrollStep);
  });
  view.addEventListener('drop', () => { shelfScrollDir = 0; });
  view.addEventListener('dragend', () => { shelfScrollDir = 0; });
  view.addEventListener('dragleave', (e) => { if (!e.relatedTarget) shelfScrollDir = 0; });
}

$('#add-shelf-btn').onclick = async () => {
  library.shelves.push({
    id: 'shelf-' + Date.now().toString(36),
    name: t('New Shelf'),
    bookIds: [],
    authorId: currentAuthor().id
  });
  await writeLibrary(library);
  await renderShelves();
  // the new shelf may be below the fold: bring it up, name ready to type over
  const shelves = $$('#shelves .shelf');
  const last = shelves[shelves.length - 1];
  if (last) {
    last.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    const label = last.querySelector('.shelf-label');
    if (label) setTimeout(() => {
      if (NO_HOVER) { label.click(); return; }
      label.focus();
      const r = document.createRange();
      r.selectNodeContents(label); // selected: typing replaces "New Shelf"
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }, 350);
  }
};

// Drag a book up to your name: if you write under other names too, a little
// rack of shelves unfolds beneath it, one per pen name, and the book can be
// dropped onto one. It lands on that name's top shelf and takes the name.
// With a single author there is nothing to unfold, so nothing happens.
(() => {
  const chip = $('#author-chip');
  let rack = null;
  let hideTimer = null;
  const otherAuthors = () => (library.authors || []).filter((a) => a.id !== currentAuthor().id);
  const isBookDrag = (e) => e.dataTransfer && e.dataTransfer.types.includes('application/x-neo-book');

  function showRack() {
    if (rack) return;
    const others = otherAuthors();
    if (!others.length) return;
    rack = document.createElement('div');
    rack.id = 'pen-rack';
    for (const a of others) {
      const slot = document.createElement('div');
      slot.className = 'pen-slot';
      slot.textContent = a.name;
      slot.dataset.authorId = a.id;
      slot.addEventListener('dragover', (e) => {
        if (!isBookDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        slot.classList.add('over');
        clearTimeout(hideTimer);
      });
      slot.addEventListener('dragleave', () => slot.classList.remove('over'));
      slot.addEventListener('drop', async (e) => {
        if (!isBookDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const bookId = e.dataTransfer.getData('application/x-neo-book');
        hideRack();
        await moveBookToAuthor(bookId, a.id);
      });
      rack.appendChild(slot);
    }
    const r = chip.getBoundingClientRect();
    rack.style.top = (r.bottom + 8) + 'px';
    // the rack hangs from the name and reaches leftward, so the names on its
    // planks sit well clear of the cover riding under the cursor
    rack.style.right = Math.max(12, window.innerWidth - r.right) + 'px';
    document.body.appendChild(rack);
    requestAnimationFrame(() => rack.classList.add('open'));
  }
  function hideRack() {
    clearTimeout(hideTimer);
    if (rack) { rack.remove(); rack = null; }
  }
  const armHide = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hideRack, 400); };

  chip.addEventListener('dragenter', (e) => { if (isBookDrag(e)) { e.preventDefault(); showRack(); } });
  chip.addEventListener('dragover', (e) => { if (isBookDrag(e)) { e.preventDefault(); clearTimeout(hideTimer); } });
  chip.addEventListener('dragleave', armHide);
  document.addEventListener('dragover', (e) => {
    // leaving both the chip and the rack lets the rack fold away
    if (rack && !rack.contains(e.target) && e.target !== chip) armHide();
  });
  document.addEventListener('dragend', hideRack);
  document.addEventListener('drop', hideRack);
})();

// Esc mid-drag cancels the drag itself (the browser does that). Esc or ⌘Z
// in the seconds after a drop puts the book back where it came from.
let lastShelfMove = null;
async function moveBookToAuthor(bookId, authorId) {
  const target = (library.authors || []).find((a) => a.id === authorId);
  const shelf = target && shelvesFor(target.id)[0];
  if (!shelf) return;
  const meta = await window.neo.readBookMeta(bookId);
  if (!meta) return;
  const from = library.shelves.find((s) => s.bookIds.includes(bookId));
  lastShelfMove = {
    bookId, title: meta.title, author: meta.author,
    shelfId: from ? from.id : null, index: from ? from.bookIds.indexOf(bookId) : 0,
    authorId: currentAuthor().id, at: Date.now()
  };
  for (const s of library.shelves) s.bookIds = s.bookIds.filter((b) => b !== bookId);
  await placeTitle(shelf, bookId, true); // the top shelf, first in line
  meta.author = target.name;
  await writeBookMeta(bookId, meta);
  await writeLibrary(library);
  renderShelves();
  toast(t('“{title}” now sits on {name}’s top shelf — Esc puts it back', { title: meta.title, name: target.name }), 6000);
}
async function undoShelfMove() {
  const m = lastShelfMove;
  if (!m || Date.now() - m.at > 15000) return false;
  lastShelfMove = null;
  const home = library.shelves.find((s) => s.id === m.shelfId) || shelvesFor(m.authorId)[0] || library.shelves[0];
  for (const s of library.shelves) s.bookIds = s.bookIds.filter((b) => b !== m.bookId);
  home.bookIds.splice(Math.min(m.index, home.bookIds.length), 0, m.bookId);
  const meta = await window.neo.readBookMeta(m.bookId);
  if (meta) { meta.author = m.author; await writeBookMeta(m.bookId, meta); }
  await writeLibrary(library);
  renderShelves();
  toast(t('“{title}” is back where it was', { title: m.title }));
  return true;
}
document.addEventListener('keydown', (e) => {
  if (!$('#editor-view').hidden || !lastShelfMove) return;
  const undoKey = e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z');
  if (!undoKey) return;
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  e.preventDefault();
  e.stopPropagation();
  undoShelfMove();
}, true);

// File → Reshelve a Book…: a book taken off the shelves is still on disk;
// this puts it back, on the current name's first shelf
async function reshelveBook() {
  const all = await window.neo.listBooks();
  const shelved = new Set(library.shelves.flatMap((s) => [...s.bookIds, ...((s.binding && s.binding.parked) || []).map((p) => p.id)]));
  // a bound book's pages aren't books to write in
  const loose = all.filter((b) => !shelved.has(b.id) && !b.kind).sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));
  if (!loose.length) { toast(t('Every book in your library is already on a shelf')); return; }
  const pick = await optionModal(t('Books in your library that aren’t on a shelf'), null,
    loose.map((b) => ({ label: b.title, desc: b.author ? t('by {author}', { author: b.author }) : '', value: b.id })));
  if (!pick) return;
  const shelf = shelvesFor(currentAuthor().id)[0] || library.shelves[0];
  await placeTitle(shelf, pick);
  await writeLibrary(library);
  renderShelves();
  toast(t('“{title}” is back on the shelf', { title: loose.find((b) => b.id === pick).title }));
}

$('#author-chip').onclick = async () => {
  const cur = currentAuthor();
  const opts = [];
  for (const a of library.authors) {
    if (a.id !== cur.id) {
      opts.push({ label: t('Write as {name}', { name: a.name }), desc: t('Switch to this name’s shelves'), value: 'sw:' + a.id });
    }
  }
  opts.push({ label: t('Rename {name}', { name: cur.name }), value: 'rename' });
  opts.push({ label: t('Add a pen name…'), desc: t('A separate set of shelves under another name'), value: 'add' });
  if (library.authors.length > 1) {
    opts.push({
      label: t('Remove {name}', { name: cur.name }),
      desc: t('These shelves and books move to your other name. Nothing is deleted from disk.'),
      danger: true, value: 'del'
    });
  }
  const pick = await optionModal(t('Writing as {name}', { name: cur.name }), null, opts);
  if (!pick) return;
  if (pick.startsWith('sw:')) {
    library.currentAuthorId = pick.slice(3);
  } else if (pick === 'rename') {
    const name = await askInput(t('Author name'), t('Shown on your title pages'), cur.name);
    if (name === null) return;
    cur.name = name || cur.name;
    library.authorName = library.authors[0].name; // legacy field follows the first name
  } else if (pick === 'add') {
    const name = await askInput(t('New pen name'), t('Shown on that name’s title pages'), '');
    if (!name) return;
    const a = { id: 'a-' + Date.now().toString(36), name };
    library.authors.push(a);
    library.currentAuthorId = a.id;
    library.shelves.push({
      id: 'shelf-' + Date.now().toString(36),
      name: t('Works in Progress'), bookIds: [], authorId: a.id
    });
  } else if (pick === 'del') {
    const homeId = library.authors[0].id;
    const rest = library.authors.filter((a) => a.id !== cur.id);
    const target = rest[0];
    for (const s of library.shelves) {
      if ((s.authorId || homeId) === cur.id) s.authorId = target.id;
    }
    library.authors = rest;
    library.currentAuthorId = target.id;
    library.authorName = library.authors[0].name;
  }
  await writeLibrary(library);
  renderShelves();
};

/* ================================================================== */
/*  EDITOR — open / render                                             */
/* ================================================================== */

async function openBook(bookId) {
  tabPlaces = {}; // a fresh book starts with fresh places
  book = await window.neo.readBookMeta(bookId);
  if (!book) return;
  currentChapterId = null; // never carry a chapter reference across books
  undoStack = [];
  chapterHTML = {};
  savedHTML = {};
  diskStamps = {};
  for (const chId of book.chapterOrder) {
    chapterHTML[chId] = await window.neo.readChapter(bookId, chId);
    savedHTML[chId] = chapterHTML[chId];
  }
  savedMetaSig = metaSig(book); // what disk holds; NEO's own defaults don't count as edits
  stickies = await window.neo.readJSON(bookId, 'stickies', []);
  darlings = await window.neo.readJSON(bookId, 'darlings', []);

  $('#bookshelf-view').hidden = true;
  $('#editor-view').hidden = false;
  document.execCommand('defaultParagraphSeparator', false, 'p');

  $('#tp-title').textContent = isUntitled(book.title) ? '' : book.title;
  $('#tp-subtitle').textContent = book.subtitle || '';
  $('#tp-author').textContent = book.author || t('Anonymous');
  $$('.tab[data-tab="notes"]')[0].textContent = tabName('notes');
  $$('.tab[data-tab="outline"]')[0].textContent = tabName('outline');

  renderChapters();
  renderStickies();
  migrateDarlingAnchors(); // sweep legacy invisible markers out of the prose
  reconcileMarks();        // re-adopt any note marks orphaned by cut/paste
  updateCounters();
  timeMark = Date.now();   // a fresh book starts the stopwatch from here
  lastWriteActivity = 0;
  ensureTimeTimer();

  // Plotters land in the outline for a brand-new book
  const isNew = book.chapterOrder.length === 0;
  if (isNew && library.writingStyle === 'plotter') {
    switchTab('outline');
  } else {
    switchTab('manuscript');
    if (isNew) {
      $('#tp-title').focus();
    } else if (book.lastPosition && book.chapterOrder.includes(book.lastPosition.chapterId)) {
      // pick up right where you left off — here, or on the other device
      currentChapterId = book.lastPosition.chapterId;
      const pos = book.lastPosition;
      requestAnimationFrame(() => resumePosition(pos));
    }
  }

  // the Enter hint shows once per library, ever
  if (!library.hintShown) {
    library.hintShown = true;
    writeLibrary(library);
    setTimeout(() => toast(t('Enter twice = section break · three times = new chapter · {key} shows everything else', { key: KHELP }), 7000), 800);
  }
}

// the pages that show a faint word until they have their own
const PAGE_PROMPTS = { dedication: () => t('For…'), epigraph: () => '…', part: () => t('Title') };

function renderChapters() {
  const wrap = $('#chapters');
  wrap.innerHTML = '';
  wordCache = {};
  book.chapterTitles = book.chapterTitles || {};
  settleChapterKinds();
  // a lone chapter is just "the story" — no heading until a second one exists,
  // at which point both appear, numbered in retrospect
  const solo = soloStory();
  book.chapterOrder.forEach((chId) => {
    const kind = chapterKind(chId);
    const story = STORY_KINDS.includes(kind);
    const sec = document.createElement('section');
    sec.className = `chapter sheet kind-${kind}` + (chId === solo ? ' solo' : '') + (story ? '' : ' bookpage');
    sec.dataset.id = chId;
    const role = chapterRole(chId);
    if (role) sec.classList.add(role);
    const head = document.createElement('div');
    head.className = 'chapter-head';
    if (kind === 'unnumbered') head.classList.add('no-number');
    head.id = 'ch-head-' + chId;
    const num = document.createElement('span');
    num.className = 'ch-num';
    num.textContent = chapterName(chId);
    head.appendChild(num);
    if (story) {
      head.title = t('Right-click for chapter options · click after the number to add a title');
      const sep = document.createElement('span');
      sep.className = 'ch-sep';
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = '—';
      const titleSpan = document.createElement('span');
      titleSpan.className = 'ch-title';
      titleSpan.contentEditable = 'true';
      titleSpan.spellcheck = false;
      titleSpan.textContent = book.chapterTitles[chId] || '';
      if (titleSpan.textContent) head.classList.add('has-title');
      titleSpan.addEventListener('input', () => {
        head.classList.toggle('has-title', titleSpan.textContent.trim() !== '');
      });
      titleSpan.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          titleSpan.blur();
          poetryUnderHeading(sec.querySelector('.chapter-body'), chId);
        } else if (e.key === 'Enter') { e.preventDefault(); titleSpan.blur(); }
        e.stopPropagation();
      });
      titleSpan.addEventListener('blur', () => {
        book.chapterTitles[chId] = titleSpan.textContent.trim();
        scheduleMetaSave();
        renderNav();
      });
      head.appendChild(sep);
      head.appendChild(titleSpan);
    }
    head.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      chapterMenu(chId, e.clientX, e.clientY);
    });
    const body = document.createElement('div');
    body.className = 'chapter-body';
    sec.appendChild(head);
    sec.appendChild(body);
    wrap.appendChild(sec);
    if (kind === 'contents') {
      // the contents are the book's own shape, kept up to date: nothing to type
      body.hidden = true;
      const list = document.createElement('ol');
      list.className = 'toc-list';
      sec.appendChild(list);
      return;
    }
    body.contentEditable = 'true';
    // screen readers name each chapter by its heading (a lone chapter by the book)
    body.setAttribute('role', 'textbox');
    body.setAttribute('aria-multiline', 'true');
    if (chId === solo) body.setAttribute('aria-label', book.title || t('The story'));
    else body.setAttribute('aria-labelledby', head.id);
    body.spellcheck = false; // NEO runs its own spellcheck pass
    if (!story) body.classList.add('no-cap');
    body.innerHTML = chapterHTML[chId] || '<p><br></p>';
    markDialogueOpening(body);
    if (PAGE_PROMPTS[kind]) {
      body.dataset.ph = PAGE_PROMPTS[kind]();
      const blank = () => body.classList.toggle('blank', !body.textContent.trim());
      blank();
      body.addEventListener('input', blank);
    }
    // a line that opens with a dash is set as the name of whoever said the
    // lines above it, as it will print
    if (ATTRIBUTED_PAGES.includes(kind)) {
      const settle = () => {
        for (const p of body.querySelectorAll('p')) {
          const attr = isAttribution({ text: p.textContent.trim() });
          if (p.hasAttribute('data-attr') !== attr) p.toggleAttribute('data-attr', attr);
        }
      };
      settle();
      body.addEventListener('input', settle);
    }
    // older marks used a "?" that read as a broken image — normalize to the flag
    body.querySelectorAll('.ph-mark').forEach((m) => { m.textContent = '⚑'; });
    // heal the engine's style-junk spans left by past merges and splits
    stripJunkSpans(body);
    // heal prose that got merged into a scene-break's styled paragraph:
    // real breaks contain only ***, anything else is a stained paragraph
    body.querySelectorAll('p.scene-break').forEach((p) => {
      if (p.textContent.trim() !== '***') {
        p.classList.remove('scene-break');
        p.removeAttribute('style');
      }
    });
    // heal no-break spaces planted in prose by the old engine repair pass
    const tw = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let tn;
    while ((tn = tw.nextNode())) {
      if (tn.data.includes('\u00a0')) tn.data = tn.data.replace(/\u00a0/g, ' ');
    }
    wireChapterBody(body, chId);
  });
  renderNav();
}

async function deleteChapterToDarlings(chId) {
  snapshotStructure('chapter delete');
  const kind = chapterKind(chId);
  const name = chapterName(chId);
  const index = book.chapterOrder.indexOf(chId);
  const text = chapterText(chId).trim();
  if (text) {
    const bodyEl = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
    darlings.push({
      id: 'd-' + Date.now().toString(36),
      html: bodyEl ? bodyEl.innerHTML : chapterHTML[chId],
      text: text.slice(0, 2000),
      chapterId: null,
      chapterLabel: chapterKind(chId) !== 'chapter' ? chapterName(chId) : t('deleted Chapter {n}', { n: chapterNumber(chId) }),
      date: new Date().toISOString()
    });
    await window.neo.writeJSON(book.id, 'darlings', darlings);
  }
  if (currentChapterId === chId) currentChapterId = null;
  await deleteChapterQuiet(chId);
  if (text) {
    toast(kind === 'chapter'
      ? t('Chapter removed — its words are in Darlings, or {key} to undo', { key: KZ })
      : t('{name} removed — its words are in Darlings, or {key} to undo', { name, key: KZ }));
  }
}

// Right-click a chapter's box in the Chapters pane, its heading, or its
// line in the outline: what it is (a chapter, a part, one of the pages a
// book carries), or Delete. Resolves to the choice once it's made.
async function chapterMenu(chId, x = 0, y = 0, from = null) {
  const kind = chapterKind(chId);
  const words = countWords(chapterText(chId));
  const otherContents = book.chapterOrder.some((c) => c !== chId && chapterKind(c) === 'contents');
  const items = CHAPTER_KINDS.map((k) => ({
    label: kindName(k),
    value: k,
    checked: k === kind,
    // one contents per book, and never over words: it would hide them
    disabled: k === 'contents' && k !== kind && (otherContents || words > 0)
  }));
  // any piece of the story can leave on its own — to a beta reader, an
  // editor, a magazine — in any format the book can
  if (STORY_KINDS.includes(kind) && words > 0) items.push('-', { label: t('Export Chapter…'), value: 'export' });
  // one switch for the whole book, where the parts are: count chapters
  // from 1 again after each part
  if (kind === 'part') {
    items.push('-', { label: t('Restart Chapter Numbers at Each Part'), value: 'restart', checked: !!book.restartNumbering });
  }
  items.push('-', { label: t('Delete'), value: 'delete', danger: true });
  const choice = await popMenu(x, y, items, { title: chapterName(chId), from: from || document.querySelector(`.nav-item[data-id="${chId}"] .n-row`) });
  if (!choice || choice === kind) return null;
  if (choice === 'export') {
    const formats = [
      { label: t('Text (.txt)'), value: 'txt' }, { label: t('Markdown (.md)'), value: 'md' }, { label: t('HTML (.html)'), value: 'html' },
      // PDF is made by the desktop app; Pocket shares the others
      ...(window.Capacitor ? [] : [{ label: 'PDF (.pdf)', value: 'pdf' }]),
      { label: t('Word (.docx)'), value: 'docx' }, { label: t('EPUB (.epub)'), value: 'epub' }
    ];
    const fmt = await optionModal(t('Export “{title}”', { title: chapterHeading(chId) || chapterName(chId) }), null, formats);
    if (fmt) await doExport(fmt, chId);
    return null;
  }
  if (choice === 'restart') {
    if (book.restartNumbering) delete book.restartNumbering;
    else book.restartNumbering = true;
    await saveMeta();
    renderChapters();
    if (currentTab === 'outline') renderOutline();
    updateCounters();
    return choice;
  }
  if (choice === 'delete') {
    await deleteChapterToDarlings(chId);
    if (currentTab === 'outline') renderOutline();
    return choice;
  }
  snapshotStructure('chapter kind');
  setChapterKind(chId, choice);
  // a copyright page starts with what every copyright page says
  if (choice === 'copyright' && !chapterText(chId).trim()) {
    chapterHTML[chId] = copyrightStarter();
    persistChapter(chId);
  }
  await saveMeta();
  renderChapters();
  if (currentTab === 'outline') renderOutline();
  updateCounters();
  return choice;
}

// Copyright © 2026 Hugh Howey / All rights reserved.
function copyrightStarter() {
  const name = (book && book.author) || library.authorName || t('Anonymous');
  return `<p>${escHtml(t('Copyright © {year} {name}', { year: String(new Date().getFullYear()), name }))}</p>`
    + `<p>${escHtml(t('All rights reserved.'))}</p>`;
}

/* ================================================================== */
/*  EDITOR — typing                                                    */
/* ================================================================== */

function wireChapterBody(body, chId) {
  body.addEventListener('focus', () => { currentChapterId = chId; updateCounters(); highlightNav(); });

  body.addEventListener('input', () => {
    breakRun = 0; // fresh typing: ⌘Z belongs to the engine again
    markDialogueOpening(body);
    chapterHTML[chId] = captureBody(body);
    wordCache[chId] = null;
    scheduleChapterSave(chId);
    if (spellOn) scheduleSpellRescan(chId, body);
    updateCounters();
    scheduleNavRefresh();
    if (!typewriterEnabled) revealCaret();
  });
  // paste without formatting
  body.addEventListener('paste', (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    // hyphens set as dialogue dashes, the same as typing them
    const edges = caretEdges(body);
    if (html) {
      document.execCommand('insertHTML', false, cleanPasteHtml(html, { style: dashStyle(), ...edges }));
      reconcileMarks();
    } else if (text) {
      const parts = text.replace(/\r/g, '').split(/\n+/).filter((p) => p.trim());
      parts.forEach((p, i) => {
        if (i > 0) document.execCommand('insertParagraph');
        const line = dialogueDashes(p.trim(), dashStyle(), { start: i > 0 || edges.start, end: i < parts.length - 1 || edges.end, spaced: i === 0 && edges.spaced });
        // plain text written in Markdown keeps its *italics* and **bold**
        const styled = library && library.markdownOff ? null : markdownInline(line);
        if (styled) {
          document.execCommand('insertHTML', false, styled);
          stripJunkSpans(body); // the engine wraps inserted HTML in style spans
        } else document.execCommand('insertText', false, line);
      });
    }
  });
  // While macOS composes input, shortcuts stand down completely.
  let composing = false;
  body.addEventListener('compositionstart', () => { composing = true; });
  body.addEventListener('compositionend', () => { composing = false; });
  body.addEventListener('keydown', (e) => {
    if (composing || e.isComposing || e.keyCode === 229) return;
    // count consecutive Enters — the double/triple rhythm works mid-sentence
    if (e.key === 'Enter' && !e.shiftKey) enterRun++;
    else enterRun = 0;
    // ⌘Z right after a break operation undoes the break via the structural
    // stack — the engine's own undo never saw it and would corrupt the page
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === 'KeyZ' && breakRun > 0 && undoStack.length) {
      e.preventDefault();
      breakRun--;
      structuralUndo();
      return;
    }
    // Chromium's selection-delete can duplicate a neighboring character when
    // the selection spans fragmented text nodes. Merging the fragments right
    // before any destructive keystroke.
    if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      const s = window.getSelection();
      const destructive = e.key === 'Backspace' || e.key === 'Delete' ||
        (s && !s.isCollapsed && (e.key.length === 1 || e.key === 'Enter'));
      if (destructive) healSelectionSeams(body);
    }
    if (styleKeepScroll(e)) return;
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
  // when the whole chapter loses focus, merge every fragmented text node
  body.addEventListener('blur', () => {
    try { body.normalize(); } catch { /* nothing to merge */ }
  });
  body.addEventListener('mousedown', () => { enterRun = 0; });
  body.addEventListener('click', (e) => {
    const mark = e.target.closest('.ph-mark');
    if (mark) focusSticky(mark.dataset.sid);
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
  // the moment writing hits a ghost, it becomes prose
  // (it keeps its data-sec-id so the outline knows it's been written)
  body.addEventListener('beforeinput', () => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    let el = sel.anchorNode;
    if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
    const ghost = el && el.closest ? el.closest('p.ghost') : null;
    if (ghost && body.contains(ghost)) {
      ghost.classList.remove('ghost');
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
function focusChapterEnd(chId) {
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
  revealCaret();
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
  if (idx > 0) {
    const prev = book.chapterOrder[idx - 1];
    deleteChapterQuiet(chId).then(() => { focusChapterEnd(prev); resetNativeUndo(); });
  } else {
    // an empty chapter 1 dissolves too — the caret lands at the top of
    // what just became the new chapter 1
    const next = book.chapterOrder[1];
    deleteChapterQuiet(chId).then(() => { focusChapterStart(next); resetNativeUndo(); });
  }
  return true;
}

// ⌘B / ⌘I applied by hand: the engine's native handling scrolls the
// selection "into view" and mis-measures NEO's transformed page column,
// throwing the reader to the top of the screen. Style, don't scroll.
function styleKeepScroll(e) {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return false;
  if (e.code !== 'KeyB' && e.code !== 'KeyI') return false;
  e.preventDefault();
  const sc = $('#paper-scroll');
  const keep = sc.scrollTop;
  document.execCommand(e.code === 'KeyB' ? 'bold' : 'italic');
  sc.scrollTop = keep;
  requestAnimationFrame(() => { sc.scrollTop = keep; });
  return true;
}

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

// The caret never types out of sight: an Enter (or anything else) on the
// window's bottom line brings the new line into view, with a little room
// below it. (Typewriter scrolling keeps the line centered on its own.)
function revealCaret() {
  const sc = $('#paper-scroll');
  const sel = window.getSelection();
  if (!sc || !sel.rangeCount || !sc.contains(sel.anchorNode)) return;
  const r = sel.getRangeAt(0).cloneRange();
  r.collapse(false);
  let rect = r.getBoundingClientRect();
  if (!rect.height) {
    // an empty line has no text to measure: its paragraph does
    const node = r.endContainer.nodeType === Node.ELEMENT_NODE ? r.endContainer : r.endContainer.parentElement;
    if (!node) return;
    rect = node.getBoundingClientRect();
  }
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
    deleteChapterQuiet(prevId).then(() => { focusChapterStart(chId); resetNativeUndo(); });
    return true;
  }
  // chapter with words above: merge this chapter up into it — the inverse
  // of a triple-Enter split, and ⌘Z restores the split
  snapshotStructure('chapters merged');
  const prevCount = prevBody.querySelectorAll('p').length;
  const keepScroll = $('#paper-scroll').scrollTop;
  chapterHTML[prevId] = captureBody(prevBody) + captureBody(body);
  persistChapter(prevId);
  for (const s of stickies) if (s.chapterId === chId) s.chapterId = prevId;
  window.neo.writeJSON(book.id, 'stickies', stickies);
  for (const d of darlings) if (d.chapterId === chId) d.chapterId = prevId;
  window.neo.writeJSON(book.id, 'darlings', darlings);
  if (book.sectionNotes && book.sectionNotes[chId]) {
    book.sectionNotes[prevId] = [...(book.sectionNotes[prevId] || []), ...book.sectionNotes[chId]];
    delete book.sectionNotes[chId];
  }
  if (book.chapterTitles) delete book.chapterTitles[chId];
  if (book.chapterNotes) delete book.chapterNotes[chId];
  if (book.chapterKinds) delete book.chapterKinds[chId];
  book.chapterOrder = book.chapterOrder.filter((c) => c !== chId);
  delete chapterHTML[chId];
  window.neo.deleteChapter(book.id, chId);
  saveMeta();
  renderChapters();
  renderStickies();
  restoreCaret({ chId: prevId, pIdx: prevCount, off: 0, scroll: keepScroll });
  resetNativeUndo();
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
        const del = document.createRange();
        del.setStart(node, r.startOffset - n);
        del.setEnd(node, r.startOffset);
        del.deleteContents();
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

// Merge fragmented text nodes in the paragraph(s) the selection touches,
// so native editing operates on whole text instead of seams.
function healSelectionSeams(body) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  const paraOf = (n) => {
    if (n && n.nodeType === Node.TEXT_NODE) n = n.parentElement;
    return n && n.closest ? n.closest('p') : null;
  };
  const a = paraOf(r.startContainer);
  const b = paraOf(r.endContainer);
  try { if (a && body.contains(a)) a.normalize(); } catch { /* fine */ }
  try { if (b && b !== a && body.contains(b)) b.normalize(); } catch { /* fine */ }
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
    (n.classList.contains('ph-mark') || n.classList.contains('darling-anchor'));

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
  for (const s of [...el.querySelectorAll('span:not(.ph-mark)')]) {
    while (s.firstChild) s.before(s.firstChild);
    s.remove();
  }
}

// Enter once: new paragraph. Enter twice: *** section break — wherever the
// caret is, even mid-sentence. Enter three times: the chapter splits here.
let enterRun = 0;
// break operations live outside the engine's undo history; while the most
// recent edits are breaks, ⌘Z routes to NEO's structural undo, one per press
let breakRun = 0;

function splitChapterAt(body, chId, block, sel) {
  // an empty line is no way to start a chapter, or end one: blank lines at
  // the seam stay behind (the new chapter opens on its first words)
  const blank = (p) => p && p.tagName === 'P' && !p.classList.contains('scene-break') && p.textContent.trim() === '' && !p.querySelector('.ph-mark');
  while (blank(block) && block.nextElementSibling) {
    const next = block.nextElementSibling;
    block.remove();
    block = next;
  }
  while (blank(block.previousElementSibling) && block.previousElementSibling.previousElementSibling) block.previousElementSibling.remove();
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
  focusChapterStart(newId);
  resetNativeUndo();
  document.querySelector(`.chapter[data-id="${newId}"] p`).scrollIntoView({ block: 'start' });
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
    if (block.querySelector('span:not(.ph-mark)')) {
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
        prev.remove();
        splitChapterAt(body, chId, block, sel);
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
      breakRun++;
      return true;
    }

    // normal Enter — native split so ⌘Z keeps working; junk spans (which
    // make the engine clone whole paragraphs) are stripped first if present
    e.preventDefault();
    if (block.querySelector('span:not(.ph-mark)')) {
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
    prev.remove();
    splitChapterAt(body, chId, block, sel);
    return true;
  }

  // Second Enter at end of flow: the empty paragraph becomes a *** break
  if (prev) {
    e.preventDefault();
    snapshotStructure('section break', { rejoin: enterRun >= 2 });
    block.removeAttribute('style'); // (see above: a break carries nothing over)
    block.className = 'scene-break';
    block.textContent = '***';
    const np = document.createElement('p');
    np.innerHTML = '<br>';
    block.after(np);
    const range = document.createRange();
    range.setStart(np, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    syncChapter(body, chId);
    resetNativeUndo();
    breakRun++;
    return true;
  }
  return false;
}

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
  if (block.classList.contains('scene-break')) return true;

  if (block.classList.contains('poetry')) {
    // the engine's own split keeps the class on the new line, and ⌘Z sees it
    if (block.querySelector('span:not(.ph-mark)')) stripJunkSpans(block);
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
  if (block.querySelector('span:not(.ph-mark)')) stripJunkSpans(block);
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
    p.classList.remove('poetry', 'flush');
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

// Backspace just below a *** (or Delete just above one) removes the break
// itself — prose never merges into the break's styled paragraph
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
  return body.innerHTML.replace(/<p\b[^>]*>/g, (tag) => tag.replace(/ data-(?:attr|speech|first)=""/g, ''));
}

// A chapter that opens on a line of dialogue sets no drop cap: the dash
// itself would be the letter enlarged. That line, and one that follows a
// scene break, keep their indent where prose is set flush, so the speech
// lines up with the lines that answer it. The marks are never saved.
const OPENING_DASH = /^\s*[-‐‑‒–—―]/;
// A chapter's opening paragraph — the one with the drop cap and no indent —
// is its first paragraph with words in it, past a blank line or a *** at the
// top (the exports skip those too). Poetry stands apart. In an empty
// chapter it's the paragraph waiting for the first word. Marked data-first,
// for the screen only.
function openingPara(body) {
  const ps = [...body.children].filter((p) => p.tagName === 'P' && !p.classList.contains('poetry') && !p.classList.contains('scene-break') && !p.classList.contains('ghost'));
  return ps.find((p) => p.textContent.trim() !== '') || ps[0] || null;
}
function markDialogueOpening(body) {
  const first = openingPara(body);
  for (const p of body.querySelectorAll('p[data-first]')) if (p !== first) p.removeAttribute('data-first');
  if (first && !first.hasAttribute('data-first')) first.setAttribute('data-first', '');
  body.classList.toggle('opens-dialogue', !!first && OPENING_DASH.test(first.textContent));
  for (const p of body.querySelectorAll('p[data-speech]')) if (!p.matches('.scene-break + p')) p.removeAttribute('data-speech');
  for (const p of body.querySelectorAll('p.scene-break + p')) {
    const speech = OPENING_DASH.test(p.textContent);
    if (p.hasAttribute('data-speech') !== speech) p.toggleAttribute('data-speech', speech);
  }
}

function syncChapter(body, chId) {
  markDialogueOpening(body);
  chapterHTML[chId] = captureBody(body);
  wordCache[chId] = null;
  scheduleChapterSave(chId);
  updateCounters();
  scheduleNavRefresh();
}

// Heal text-node fragmentation in each paragraph as the caret leaves it:
let lastCaretPara = null;
let capOffBody = null;
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
  if (caretP !== lastCaretPara) {
    if (lastCaretPara && lastCaretPara.isConnected) {
      try { lastCaretPara.normalize(); } catch { /* fine */ }
    }
    lastCaretPara = caretP;
  }
  // during a spellcheck pass, each chapter scans as the caret arrives
  if (spellOn && caretP) {
    const ch = caretP.closest('.chapter');
    if (ch) scanSpellingIn(ch.querySelector('.chapter-body'), ch.dataset.id);
  }
  // the drop cap steps aside while the caret is in the first paragraph
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
  const inFirst = caretP && caretP.parentElement &&
    caretP.hasAttribute('data-first');
  const capBody = inFirst ? caretP.parentElement : null;
  if (capBody !== capOffBody) {
    if (capOffBody && capOffBody.isConnected) capOffBody.classList.remove('cap-off');
    if (capBody) capBody.classList.add('cap-off');
    capOffBody = capBody;
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
  return { start: !before.trim(), end: !post.toString().trim(), spaced: /\s$/.test(before) };
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
  holder.querySelectorAll('script,style,meta,link,img,table,head,title').forEach((n) => n.remove());
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
  });
  // a break marker at every block edge and every line break
  const BREAK = '\uE000';
  const blocks = 'p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre, section, article, header, footer, tr, dd, dt';
  holder.querySelectorAll(blocks).forEach((b) => {
    b.before(document.createTextNode(BREAK));
    b.after(document.createTextNode(BREAK));
  });
  holder.querySelectorAll('br').forEach((br) => br.replaceWith(document.createTextNode(BREAK)));

  const paras = [[]];
  for (const r of paraRuns(holder.innerHTML)) {
    if (r.mark !== undefined) { paras[paras.length - 1].push(r); continue; }
    const pieces = r.text.split(BREAK);
    pieces.forEach((text, i) => {
      if (i > 0) paras.push([]);
      if (text) paras[paras.length - 1].push({ text, b: r.b, i: r.i });
    });
  }
  const filled = paras.map((runs) => runs.some((r) => r.mark === undefined && r.text.trim()));
  const out = paras.map((runs, n) => {
    // whitespace collapses like HTML's, and each paragraph is trimmed
    runs = runs.map((r) => (r.mark !== undefined ? r : { ...r, text: r.text.replace(/\s+/g, ' ') }));
    const first = runs.find((r) => r.mark === undefined);
    if (first) first.text = first.text.replace(/^\s+/, '');
    const last = [...runs].reverse().find((r) => r.mark === undefined);
    if (last) last.text = last.text.replace(/\s+$/, '');
    if (dashes) {
      dashRuns(runs, dashes.style, {
        start: n !== filled.indexOf(true) || dashes.start,
        end: n !== filled.lastIndexOf(true) || dashes.end,
        spaced: n === filled.indexOf(true) && dashes.spaced
      });
    }
    const inner = runs.map((r) => {
      if (r.mark !== undefined) {
        // placeholder marks travel with their text; reconcileMarks pairs
        // each one back up with a note after the paste lands
        return r.mark
          ? `<span class="ph-mark" data-sid="${escHtml(r.mark)}" contenteditable="false">⚑</span>`
          : '';
      }
      if (!r.text) return '';
      let t = escHtml(r.text);
      if (r.i) t = '<i>' + t + '</i>';
      if (r.b) t = '<b>' + t + '</b>';
      return t;
    }).join('');
    return inner.replace(/<[^>]+>/g, '').trim() ? '<p>' + inner + '</p>' : '';
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
function markdownEmphasis(e, body, range) {
  if (library && library.markdownOff) return false;
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
  return html === before ? null : html;
}
// ⌘Z (Ctrl+Z) right after: the styling goes and the marks come back as typed
document.addEventListener('keydown', (e) => {
  if (MODIFIER_KEYS.has(e.key)) return; // the ⌘ or Ctrl of ⌘Z, on its way
  const just = mdJustSet;
  mdJustSet = null;
  if (!just || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.code !== 'KeyZ') return;
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
  const key = e.key === 'Enter' ? '' : e.key;
  if (key.length > 1) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return;
  const start = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  let block = start && start.closest('p, div, li');
  if (!block || !body.contains(block)) block = body;
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
  if (!just || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.code !== 'KeyZ' || !just.block.isConnected) return;
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
function autoCapKey(e, body) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.keyCode === 229) return;
  if (e.key.length !== 1 || !body.matches('.chapter-body')) return;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.getRangeAt(0).collapsed) return;
  const range = sel.getRangeAt(0);
  const start = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  const block = start && start.closest('p');
  if (!block || !body.contains(block) || block.matches('.poetry, .scene-break')) return;
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
  if (!just || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.code !== 'KeyZ' || !just.block.isConnected) return;
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
  if (e.key === '-' && prevChars(1) === '-') {
    e.preventDefault();
    replaceBefore(1, '—'); // —
    return;
  }
  if (e.key === '.' && prevChars(2) === '..') {
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
    const before = prevChars(1);
    const q = e.key === '"' ? bookQuotes(body) : quoteStyle();
    let opening = before === '' || /[\s\(\[\{‘“«„>]/.test(before);
    // after a dash, a quote usually closes speech that was cut off ("I was
    // just—"); it opens one only when no quotation is open in the paragraph
    if (before === '—' || before === '–') opening = !quoteIsOpen(range, e.key === '"' ? q : { open: '‘', close: '’' }, e.key === '"' ? '"' : '');
    let ch;
    if (e.key === "'") {
      // most languages type ' as an apostrophe only; English and Dutch also
      // open single quotes with it
      ch = q.singles && opening ? '‘' : '’';
    } else {
      ch = opening ? q.open : q.close;
    }
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
    else if (c === open && open !== close) depth++;
    else if (c === close) {
      if (close === '’' && /\p{L}/u.test(text[i - 1] || '') && /\p{L}/u.test(text[i + 1] || '')) continue;
      depth = Math.max(0, depth - 1);
    }
  }
  return depth > 0 || straights % 2 === 1;
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
  de: { open: '„', close: '“' },
  pl: { open: '„', close: '”' },
  ro: { open: '„', close: '”' },
  ru: { open: '«', close: '»' },
  el: { open: '«', close: '»' }
};
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
    return { '»': n(/»(?=[\p{L}\p{N}])/gu), '«': own === '«' ? 0 : n(/«(?=[\p{L}\p{N}])/gu), own: n(new RegExp(own + '\\s?(?=[\\p{L}\\p{N}])', 'gu')) };
  };
  const body = el && el.closest ? el.closest('.chapter-body') : null;
  let c = opens(body ? body.textContent : '');
  if (!c['»'] && !c['«'] && !c.own && book) c = opens(book.chapterOrder.map((id) => chapterHTML[id] || '').join(' '));
  if (c['»'] > c.own && c['»'] >= c['«']) return { open: '»', close: '«' };
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
function titleEnter(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  // into the story, past any pages that come before it
  const first = book.chapterOrder.find((c) => isStory(c));
  if (first) focusChapter(first);
  else focusChapter(createChapterAt(storyEnd()));
}
$('#tp-title').addEventListener('input', () => {
  book.title = $('#tp-title').textContent.trim() || t('Untitled');
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
  if (e.shiftKey && e.key === ';') return true;
  return e.code === 'Semicolon' && e.key !== ';';
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
  if ($('#editor-view').hidden) return;
  if (document.querySelector('.modal-backdrop:not([hidden])')) return; // visible modals own the keyboard
  const cmd = e.metaKey || e.ctrlKey;
  if (cmd && e.shiftKey && e.code === 'KeyX') {
    e.preventDefault();
    if (currentTab === 'manuscript') insertPlaceholder();
  }
  if (cmd && e.shiftKey && e.code === 'KeyD') {
    e.preventDefault();
    if (currentTab === 'manuscript') darlingFromKeyboard();
  }
  if (isSpellcheckShortcut(e)) {
    e.preventDefault();
    toggleSpellcheck();
  }
  // The text-size pair keeps the menu's own keys on the layouts where they
  // match, and takes over by character where they do not (`+` is Shift+1 on
  // Swiss German, so CmdOrCtrl-Plus never fires there).
  if (isLargerTextShortcut(e)) {
    e.preventDefault();
    void setEditorFontSize(1);
  }
  if (isSmallerTextShortcut(e)) {
    e.preventDefault();
    void setEditorFontSize(-1);
  }
  if (e.key === 'Escape') {
    if (!$('#searchbar').hidden) closeSearch();
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
window.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const cmd = IS_POCKET ? (e.metaKey !== e.ctrlKey) : (IS_MAC ? e.metaKey : e.ctrlKey);
  if (!cmd || !e.altKey || e.shiftKey) return;
  if ($('#editor-view').hidden || document.querySelector('.modal-backdrop:not([hidden])')) return;
  e.preventDefault();
  e.stopPropagation();
  gotoChapter(e.key === 'ArrowDown' ? 1 : -1);
}, true);

/* ------------------------------------------------------------------ */
/*  Vim keys (View → Vim Keys, off unless chosen)                      */
/*                                                                      */
/*  The small part of vim that writers use to move around a page. Esc   */
/*  puts the page in moving mode (the caret turns gold); letters then   */
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
/*    /         find                     a number first repeats: 3w     */
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
function toggleVim() {
  vimEnabled = !vimEnabled;
  library.vimKeys = vimEnabled;
  writeLibrary(library);
  applyVim();
  toast(vimEnabled ? t('Vim keys on — Esc to move, i to write') : t('Vim keys off'));
}
const vimEditor = (el) => el && el.closest && el.closest('.chapter-body, #aux-editor');
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
    case '/': vimSetNav(false); openSearch(); return;
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

// ⌘Enter (Ctrl+Enter): toggle fullscreen from anywhere
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  e.preventDefault();
  window.neo.fullscreenToggle();
});

function createChapterAt(idx) {
  const chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  book.chapterOrder.splice(idx, 0, chId);
  chapterHTML[chId] = '<p><br></p>';
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
  window.neo.writeJSON(book.id, 'stickies', stickies);
  window.neo.deleteChapter(book.id, chId);
  await saveMeta();
  renderChapters();
  renderStickies();
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
  window.neo.writeJSON(book.id, 'stickies', stickies);
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
      <div class="s-ch">${chIdx >= 0 ? chapterName(s.chapterId) : t('Unplaced')}</div>
      <textarea placeholder="${t('What needs doing here?')}" spellcheck="false"></textarea>
      <div class="s-actions"><button class="s-go">${t('Go to')}</button><span class="s-sep">·</span><button class="s-done">${t('Resolve')}</button></div>`;
    const ta = el.querySelector('textarea');
    ta.value = s.text;
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
    window.neo.writeJSON(bookId, 'stickies', list);
  }, 600);
}

function flushStickiesSave() {
  if (!saveTimers.stickies || !book) return;
  clearTimeout(saveTimers.stickies);
  delete saveTimers.stickies;
  window.neo.writeJSON(book.id, 'stickies', stickies);
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
    window.neo.writeJSON(book.id, 'stickies', stickies);
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
  window.neo.writeJSON(book.id, 'stickies', stickies);
  renderStickies();
  scheduleNavRefresh();
}

function focusSticky(sid) {
  $('#side-pane').classList.add('open');
  const el = document.querySelector(`.sticky[data-sid="${sid}"] textarea`);
  if (el) el.focus();
}

/* ================================================================== */
/*  NAV PANE                                                           */
/* ================================================================== */

let chapterDragActive = false;
let navRefreshPending = false;

function renderNav() {
  if (!book) return; // a refresh queued just before the shelf came back
  // Replacing the source row during a native drag can interrupt its lifecycle.
  if (chapterDragActive) { navRefreshPending = true; return; }
  navRefreshPending = false;
  const list = $('#nav-list');
  // a keyboard user on a chapter row keeps their place through the rebuild
  const focusedRow = document.activeElement && document.activeElement.classList.contains('n-row') &&
    document.activeElement.matches(':focus-visible') ? document.activeElement.closest('.nav-item').dataset.id : null;
  list.innerHTML = '';
  book.chapterNotes = book.chapterNotes || {};
  const solo = soloStory();
  // the book from top to bottom: a faint + between the boxes (and above and
  // below them) adds a chapter, a part or a page right there
  const gap = (at) => {
    const g = document.createElement('div');
    g.className = 'nav-gap';
    const plus = document.createElement('button');
    plus.className = 'ng-plus';
    plus.tabIndex = -1;
    plus.textContent = '+';
    plus.setAttribute('aria-label', t('Add'));
    const add = (e) => { e.preventDefault(); e.stopPropagation(); addEntryMenu(at, e.clientX, e.clientY, plus); };
    plus.addEventListener('click', add);
    plus.addEventListener('contextmenu', add);
    g.appendChild(plus);
    return g;
  };
  let inPart = false;
  book.chapterOrder.forEach((chId, i) => {
    const kind = chapterKind(chId);
    const story = STORY_KINDS.includes(kind);
    // a part gathers what follows it, up to the next part or the back of the book
    if (kind === 'part') inPart = true;
    else if (BACK_KINDS.includes(kind)) inPart = false;
    const words = story ? chapterWords(chId) : 0;
    const flagged = !!document.querySelector(`.chapter[data-id="${chId}"] .ph-mark`);
    const chTitle = story ? (book.chapterTitles || {})[chId] : '';
    const item = document.createElement('div');
    item.className = `nav-item kind-${kind}` + (story ? '' : ' nav-page') + (inPart && kind !== 'part' ? ' in-part' : '') +
      (chId === currentChapterId ? ' current' : '') + (chId === justAddedEntry ? ' just-added' : '');
    item.dataset.id = chId;
    item.innerHTML = `<div class="n-row" title="${t('Drag to reorder chapters')}"><span class="n-label"></span>
      <span style="display:flex;align-items:center">${story ? `<span class="n-words">${fmtNum(words)}</span>` : ''}${flagged ? `<span class="n-flag" title="${t('Unresolved placeholder')}"></span>` : ''}</span></div>`;
    item.querySelector('.n-label').textContent = chId === solo
      ? (book.title || t('The story'))
      : (chTitle ? `${chapterMark(chId)} · ${chTitle}` : chapterName(chId));

    // the row is the drag handle, so the note below stays freely editable
    const rowEl = item.querySelector('.n-row');
    rowEl.draggable = true;
    rowEl.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-neo-chapter', chId);
      chapterDragActive = true;
      $('#nav-pane').classList.add('open');
      item.classList.add('dragging');
    });
    rowEl.addEventListener('dragend', finishChapterDrag);
    // right-click: what it is, or Delete
    item.addEventListener('contextmenu', (e) => {
      if (IS_POCKET) { e.preventDefault(); return; } // on a phone this pane is for hopping
      if (e.target.closest('.nav-note[contenteditable="true"]')) return; // the note's own text menu
      e.preventDefault();
      chapterMenu(chId, e.clientX, e.clientY, rowEl);
    });

    if (story && IS_POCKET) {
      // on a phone this pane is for hopping: a tap anywhere on the box
      // goes there. The note is read here and written in the Outline.
      const note = document.createElement('div');
      note.className = 'nav-note nav-note-ro';
      note.textContent = book.chapterNotes[chId] || '';
      item.appendChild(note);
    } else if (story) {
      // outline your whole book from this panel:
      const note = document.createElement('div');
      note.className = 'nav-note';
      note.contentEditable = 'true';
      note.spellcheck = false;
      note.textContent = book.chapterNotes[chId] || '';
      note.setAttribute('role', 'textbox');
      note.setAttribute('aria-label', t('Outline note'));
      note.setAttribute('aria-placeholder', t('What happens here…'));
      note.addEventListener('click', (e) => e.stopPropagation());
      note.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); note.blur(); }
        e.stopPropagation();
      });
      note.addEventListener('blur', () => {
        book.chapterNotes[chId] = note.textContent.trim();
        scheduleMetaSave();
      });
      item.appendChild(note);
    } else if (kind !== 'contents') {
      // a page shows the start of what it says
      const peek = document.createElement('div');
      peek.className = 'nav-note nav-peek';
      peek.textContent = entryPeek(chId);
      if (!peek.textContent && PAGE_PROMPTS[kind]) { peek.dataset.ph = PAGE_PROMPTS[kind](); peek.classList.add('blank'); }
      item.appendChild(peek);
    }

    item.onclick = () => {
      switchTab('manuscript');
      if (IS_POCKET) {
        // the top of the chapter, and the pane steps aside for the page
        const sec = document.querySelector(`.chapter[data-id="${chId}"]`);
        focusChapterStart(chId);
        if (sec) sec.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
        if ($('#nav-pane').dataset.pinned !== '1') $('#nav-pane').classList.remove('open');
        return;
      }
      focusChapter(chId);
    };
    // from the keyboard, the row is the chapter's button (F6 reaches the pane)
    pressable(rowEl, [
      item.querySelector('.n-label').textContent,
      story ? t('{n} words', { n: words }) : '',
      flagged ? t('Unresolved placeholder') : ''
    ].filter(Boolean).join(', '));
    list.appendChild(gap(i));
    list.appendChild(item);
    if (chId === focusedRow) rowEl.focus({ preventScroll: true });
  });
  list.appendChild(gap(book.chapterOrder.length));
  justAddedEntry = null;
  renderContentsLists();
}

// the first words of a page, for its box in the Chapters pane
function entryPeek(chId) {
  const el = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  const holder = document.createElement('template');
  holder.innerHTML = el ? el.innerHTML : (chapterHTML[chId] || '');
  const first = [...holder.content.querySelectorAll('p:not(.ghost):not(.scene-break)')].map((p) => p.textContent.trim()).find(Boolean);
  return first || '';
}

// The + between two boxes: which kind, then it's there, in place
let justAddedEntry = null;
async function addEntryMenu(at, x, y, from) {
  const hasContents = book.chapterOrder.some((c) => chapterKind(c) === 'contents');
  const kind = await popMenu(x, y, CHAPTER_KINDS.map((k) => ({ label: kindName(k), value: k, disabled: k === 'contents' && hasContents })), { from });
  if (!kind) return;
  addEntry(at, kind);
}
function addEntry(at, kind) {
  switchTab('manuscript');
  snapshotStructure('add ' + kind);
  const chId = newEntryId();
  justAddedEntry = chId;
  book.chapterOrder.splice(at, 0, chId);
  setChapterKind(chId, kind);
  chapterHTML[chId] = kind === 'copyright' ? copyrightStarter() : '<p><br></p>';
  persistChapter(chId);
  saveMeta();
  renderChapters();
  // the new page is ready to write on (the contents, to look at)
  if (kind === 'copyright') focusChapter(chId); else focusChapterStart(chId);
  document.querySelector(`.chapter[data-id="${chId}"]`).scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  updateCounters();
  if (currentTab === 'outline') renderOutline();
  return chId;
}
const newEntryId = () => 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);

// The contents, in the manuscript: the parts, the chapters and the pages at
// the back, as the reader will find them, each one a way there
function bookContents(meta = book) {
  const solo = soloStory(meta);
  const out = [];
  let inPart = false;
  for (const chId of meta.chapterOrder) {
    const kind = chapterKind(chId, meta);
    if (kind === 'part') inPart = true;
    else if (BACK_KINDS.includes(kind)) inPart = false;
    if (['copyright', 'dedication', 'epigraph', 'contents'].includes(kind) || chId === solo) continue;
    let label = STORY_KINDS.includes(kind) ? chapterHeading(chId, meta) || chapterName(chId, meta) : chapterName(chId, meta);
    if (kind === 'part') {
      const partTitle = partTitleOf(chId);
      if (partTitle) label += ': ' + partTitle;
    }
    out.push({ chId, label, type: kind === 'part' ? 'part' : STORY_KINDS.includes(kind) ? 'chapter' : 'page', level: inPart && kind !== 'part' ? 1 : 0 });
  }
  return out;
}
// a part's title is the first line of its page (what follows is its quote)
function partTitleOf(chId) {
  const el = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  const paras = parasFromHtml(el ? el.innerHTML : (chapterHTML[chId] || ''));
  return paras[0] && !paras[0].sceneBreak && !isAttribution(paras[0]) ? paras[0].text : '';
}
function renderContentsLists() {
  const lists = $$('#chapters .toc-list');
  if (!lists.length) return;
  const entries = bookContents();
  for (const list of lists) {
    list.innerHTML = '';
    for (const e of entries) {
      const li = document.createElement('li');
      li.className = `t-${e.type} lv${e.level}`;
      li.textContent = e.label;
      li.onclick = () => focusChapterStart(e.chId);
      list.appendChild(li);
    }
  }
}

// A new chapter goes at the end of the story: after the last chapter, and
// before an epilogue and the pages at the back
function storyEnd() {
  const order = book.chapterOrder;
  const last = order.map((c) => chapterKind(c)).lastIndexOf('chapter');
  if (last >= 0) return last + 1;
  let at = order.length;
  while (at > 0 && BACK_KINDS.includes(chapterKind(order[at - 1]))) at--;
  return at;
}
$('#nav-add').onclick = () => {
  switchTab('manuscript');
  focusChapter(createChapterAt(storyEnd()));
};

// drop target for chapter reordering, with a gold line showing the landing spot
const navList = $('#nav-list');
// the + on the seam nearest the pointer, when it's near one (the pane
// listens, so the seams above the first box and below the last wake too)
$('#nav-pane').addEventListener('mousemove', (e) => {
  if (chapterDragActive || e.buttons) return;
  let near = null;
  let best = 9;
  for (const g of navList.querySelectorAll('.nav-gap')) {
    const d = Math.abs(e.clientY - g.getBoundingClientRect().top);
    if (d < best) { best = d; near = g; }
  }
  for (const g of navList.querySelectorAll('.nav-gap')) g.classList.toggle('near', g === near);
});
$('#nav-pane').addEventListener('mouseleave', () => {
  navList.querySelectorAll('.nav-gap.near').forEach((g) => g.classList.remove('near'));
});
function finishChapterDrag(e) {
  if (!chapterDragActive) return;
  chapterDragActive = false;
  navList.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
  const ind = navList.querySelector('.nav-drop-ind');
  if (ind) ind.remove();
  // Native dragging can temporarily blur the window. Use the release position
  // to keep the pane available after an in-pane drop, even before focus returns.
  const pane = $('#nav-pane');
  const r = pane.getBoundingClientRect();
  if (pane.dataset.pinned !== '1' && (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom)) {
    pane.classList.remove('open');
  }
  if (navRefreshPending) renderNav();
}
// Drop also cleans up if rendering removes the source before dragend bubbles.
// Dragend covers Escape and releases outside a valid drop target.
document.addEventListener('drop', finishChapterDrag);
document.addEventListener('dragend', finishChapterDrag);

function navDropInd() {
  let ind = document.querySelector('.nav-drop-ind');
  if (!ind) {
    ind = document.createElement('div');
    ind.className = 'nav-drop-ind';
  }
  return ind;
}
navList.addEventListener('dragover', (e) => {
  if (!e.dataTransfer.types.includes('application/x-neo-chapter')) return;
  e.preventDefault();
  const ind = navDropInd();
  const items = [...navList.querySelectorAll('.nav-item:not(.dragging)')];
  let placed = false;
  for (const it of items) {
    const r = it.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) {
      navList.insertBefore(ind, it);
      placed = true;
      break;
    }
  }
  if (!placed) navList.appendChild(ind);
});
navList.addEventListener('dragleave', (e) => {
  if (navList.contains(e.relatedTarget)) return;
  const ind = document.querySelector('.nav-drop-ind');
  if (ind) ind.remove();
});
navList.addEventListener('drop', async (e) => {
  const chId = e.dataTransfer.getData('application/x-neo-chapter');
  if (!chId) return;
  e.preventDefault();
  const ind = document.querySelector('.nav-drop-ind');
  let index = book.chapterOrder.filter((c) => c !== chId).length;
  if (ind) {
    index = 0;
    for (const c of navList.children) {
      if (c === ind) break;
      if (c.classList.contains('nav-item') && !c.classList.contains('dragging')) index++;
    }
    ind.remove();
  }
  const from = book.chapterOrder.indexOf(chId);
  if (from === -1) return;
  snapshotStructure('chapter reorder');
  book.chapterOrder = book.chapterOrder.filter((c) => c !== chId);
  book.chapterOrder.splice(index, 0, chId);
  await saveMeta();
  renderChapters(); // renumbers heads and rebuilds the nav
  if (currentTab === 'outline') renderOutline();
});

function highlightNav() {
  $$('.nav-item').forEach((el) => el.classList.toggle('current', el.dataset.id === currentChapterId));
}

function scheduleNavRefresh() {
  clearTimeout(saveTimers.nav);
  saveTimers.nav = setTimeout(renderNav, 1200);
}

// Hover behavior for both side panes:
function wireHoverPane(hotzone, pane, isPinnable) {
  // (a menu opened from the Chapters pane keeps it open while it's up)
  const pinned = () => (isPinnable && pane.dataset.pinned === '1') ||
    (pane.id === 'nav-pane' && (chapterDragActive || !!document.querySelector('.pop-menu')));
  hotzone.addEventListener('mouseenter', (e) => {
    if (e.buttons) return; // dragging something — stand down
    pane.classList.add('open');
  });
  hotzone.addEventListener('mouseleave', (e) => {
    if (pinned()) return;
    if (e.relatedTarget && pane.contains(e.relatedTarget)) return;
    pane.classList.remove('open');
  });
  pane.addEventListener('mouseleave', () => {
    if (pinned()) return;
    pane.classList.remove('open');
  });
}
wireHoverPane($('#nav-hotzone'), $('#nav-pane'), true);
wireHoverPane($('#side-hotzone'), $('#side-pane'), true);

// leaving the window closes unpinned panes (they used to stick open)
function closeUnpinnedPanes() {
  // Wayland can blur the window as a native chapter drag begins.
  if (!chapterDragActive && $('#nav-pane').dataset.pinned !== '1') $('#nav-pane').classList.remove('open');
  if ($('#side-pane').dataset.pinned !== '1') $('#side-pane').classList.remove('open');
}
document.documentElement.addEventListener('mouseleave', closeUnpinnedPanes);
window.addEventListener('blur', closeUnpinnedPanes);

// the wheel scrolls the manuscript even when the pointer floats over the
// dark margins beside the (narrower) page column
$('#editor-view').addEventListener('wheel', (e) => {
  const scroller = $('#paper-scroll');
  if (e.ctrlKey) return; // pinch-zoom gesture, not a scroll
  if (scroller.contains(e.target)) return; // native scrolling handles it
  if ($('#nav-pane').contains(e.target) || $('#side-pane').contains(e.target)) return;
  scroller.scrollTop += e.deltaY;
}, { passive: true });

// Keep Open, on either pane: the page moves over to make room, and the
// choice stays for next time (on this computer)
function pinPane(side, on) {
  const pane = $(side === 'nav' ? '#nav-pane' : '#side-pane');
  const pin = $(side === 'nav' ? '#nav-pin' : '#side-pin');
  pane.dataset.pinned = on ? '1' : '0';
  pin.classList.toggle('pinned', on);
  pin.setAttribute('aria-pressed', on ? 'true' : 'false');
  $('#editor-view').classList.toggle(side + '-pinned', on);
  if (on) pane.classList.add('open');
  try {
    const kept = JSON.parse(localStorage.getItem('neo-pinned-panes') || '{}');
    kept[side] = on;
    localStorage.setItem('neo-pinned-panes', JSON.stringify(kept));
  } catch { /* fine: it just won't be remembered */ }
}
$('#side-pin').onclick = () => pinPane('side', $('#side-pane').dataset.pinned !== '1');
$('#nav-pin').onclick = () => pinPane('nav', $('#nav-pane').dataset.pinned !== '1');
if (!NO_HOVER) {
  try {
    const kept = JSON.parse(localStorage.getItem('neo-pinned-panes') || '{}');
    if (kept.nav) pinPane('nav', true);
    if (kept.side) pinPane('side', true);
  } catch { /* nothing kept */ }
}

/* ================================================================== */
/*  TABS — Manuscript / Notes / Outline / Darlings                     */
/* ================================================================== */

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  tab.addEventListener('dblclick', async () => {
    const kind = tab.dataset.tab;
    if (kind !== 'notes' && kind !== 'outline') return;
    const name = await askInput(t('Rename tab'), t('New tab name'), tabName(kind));
    if (!name) return;
    book.tabNames[kind] = name;
    tab.textContent = name;
    saveMeta();
    // Renamed tabs become the default for future books
    library.tabDefaults = library.tabDefaults || {};
    library.tabDefaults[kind] = name;
    writeLibrary(library);
  });
});

// Darlings tab is a drop target for selected text
const darlingsTab = $('.tab.darlings');
// The selection usually collapses by the time a drag lands on the Darlings
// tab, so the range is remembered at dragstart and the cut is made by NEO
// itself (dropEffect 'copy' keeps Chromium from moving the text on its own).
let draggedRange = null;
document.addEventListener('dragstart', (e) => {
  // any text drag inside the manuscript lights up the bottom bar
  if (currentTab === 'manuscript' && e.target.closest && e.target.closest('.chapter-body')) {
    $('#bottombar').classList.add('attn');
    const sel = window.getSelection();
    draggedRange = sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null;
  }
});
document.addEventListener('dragend', () => { $('#bottombar').classList.remove('attn'); draggedRange = null; });

darlingsTab.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  darlingsTab.classList.add('drag-over');
});
darlingsTab.addEventListener('dragleave', () => darlingsTab.classList.remove('drag-over'));
darlingsTab.addEventListener('drop', async (e) => {
  e.preventDefault();
  darlingsTab.classList.remove('drag-over');
  const html = e.dataTransfer.getData('text/html');
  const text = e.dataTransfer.getData('text/plain');
  await moveSelectionToDarlings(html, text);
});

// ---- text-position helpers: darlings remember home by their surrounding
// text, so nothing foreign is left inside the manuscript ----

function bodyPlainText(body) {
  let t = '';
  const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) t += n.textContent;
  return t;
}

function textPosToRange(body, pos) {
  const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let n, acc = 0;
  while ((n = w.nextNode())) {
    const len = n.textContent.length;
    if (acc + len >= pos) {
      const r = document.createRange();
      r.setStart(n, pos - acc);
      r.collapse(true);
      return r;
    }
    acc += len;
  }
  return null;
}

// Where in the chapter does this darling belong?
function findDarlingPosition(body, d) {
  if (d.anchorPrefix == null && d.anchorSuffix == null) return -1;
  const text = bodyPlainText(body);
  const pre = d.anchorPrefix || '';
  const suf = d.anchorSuffix || '';
  let idx = (pre + suf) ? text.indexOf(pre + suf) : -1;
  if (idx !== -1) return idx + pre.length;
  if (pre) {
    idx = text.indexOf(pre);
    if (idx !== -1) return idx + pre.length;
  }
  if (suf) {
    idx = text.indexOf(suf);
    if (idx !== -1) return idx;
  }
  return -1;
}

// The one move shared by drag-to-tab and ⌘⇧D: the cut point is remembered by its surroundings —
// no markers in the WIP itself.
async function moveSelectionToDarlings(html, text) {
  if (!text || !text.trim() || !book) return;
  const sel = window.getSelection();
  // the live selection if it survived the drag, else the one saved at dragstart
  const live = sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0) : null;
  const range = live || draggedRange;
  draggedRange = null;
  const srcChapter = range
    ? range.startContainer.parentElement?.closest?.('.chapter')
    : null;
  const chId = srcChapter ? srcChapter.dataset.id : currentChapterId;
  const chIdx = book.chapterOrder.indexOf(chId);
  const did = 'd-' + Date.now().toString(36);

  snapshotStructure('darling');
  breakRun++; // the engine never saw this cut: ⌘Z inside the text must reach the structural stack

  let anchorPrefix = null;
  let anchorSuffix = null;
  if (range) {
    const startNode = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
    const startBlock = startNode && startNode.closest ? startNode.closest('p') : null;
    range.deleteContents();
    // a whole paragraph dragged away leaves its empty shell behind: remove it
    // and park the caret at the end of the paragraph before (or start of after)
    if (startBlock && !startBlock.textContent.trim() && !startBlock.querySelector('span')
        && startBlock.parentElement && startBlock.parentElement.children.length > 1) {
      const prev = startBlock.previousElementSibling;
      const next = startBlock.nextElementSibling;
      startBlock.remove();
      if (prev) { range.selectNodeContents(prev); range.collapse(false); }
      else if (next) { range.selectNodeContents(next); range.collapse(true); }
    }
    sel.removeAllRanges(); sel.addRange(range);
    const r = range;
    const body = r.startContainer.parentElement?.closest?.('.chapter-body');
    if (body) {
      const pre = document.createRange();
      pre.selectNodeContents(body);
      pre.setEnd(r.startContainer, r.startOffset);
      anchorPrefix = pre.toString().slice(-60);
      const post = document.createRange();
      post.selectNodeContents(body);
      post.setStart(r.startContainer, r.startOffset);
      anchorSuffix = post.toString().slice(0, 60);
    }
  }
  if (chId) {
    const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
    if (body) {
      chapterHTML[chId] = captureBody(body);
      wordCache[chId] = null;
      scheduleChapterSave(chId);
    }
  }

  // Chromium's drag html carries inline font/colour/background styles;
  // keep only the prose (paragraphs when the drag spanned more than one)
  let cleanHtml = null;
  if (html) {
    const cleaned = cleanPasteHtml(html);
    cleanHtml = /\n/.test(text.trim()) && !/<p[\s>]/i.test(cleaned) ? '<p>' + cleaned + '</p>' : cleaned;
  }
  darlings.unshift({
    id: did,
    html: cleanHtml,
    text: text,
    chapterId: chId || null,
    chapterLabel: chIdx >= 0 ? chapterName(chId) : t('Manuscript'),
    anchorPrefix,
    anchorSuffix,
    date: new Date().toISOString()
  });
  await window.neo.writeJSON(book.id, 'darlings', darlings);
  updateCounters();
  toast(t('Saved to Darlings — kill without remorse ({key} to undo)', { key: KZ }));
}

// Older versions of NEO planted invisible marker spans at darling cut points,
// which interfered with Chromium's delete handling. On open, convert each one
// into a remembered-context position and remove it:
async function migrateDarlingAnchors() {
  const spans = [...document.querySelectorAll('.darling-anchor')];
  if (!spans.length) return;
  let changed = false;
  for (const span of spans) {
    const body = span.closest('.chapter-body');
    const d = darlings.find((x) => x.id === span.dataset.did);
    if (body && d && d.anchorPrefix == null) {
      const pre = document.createRange();
      pre.selectNodeContents(body);
      pre.setEndBefore(span);
      d.anchorPrefix = pre.toString().slice(-60);
      const post = document.createRange();
      post.selectNodeContents(body);
      post.setStartAfter(span);
      d.anchorSuffix = post.toString().slice(0, 60);
      changed = true;
    }
    const chapter = span.closest('.chapter');
    span.remove();
    if (body && chapter) {
      chapterHTML[chapter.dataset.id] = captureBody(body);
      wordCache[chapter.dataset.id] = null;
      scheduleChapterSave(chapter.dataset.id);
    }
  }
  if (changed) await window.neo.writeJSON(book.id, 'darlings', darlings);
}

// keyboard route: select a passage, ⌘⇧D to move to Darlings
function darlingFromKeyboard() {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) {
    toast(t('Select the passage first, then {key} sends it to Darlings', { key: KDA }));
    return;
  }
  let el = sel.anchorNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  if (!el || !el.closest || !el.closest('.chapter-body')) return;
  const holder = document.createElement('div');
  holder.appendChild(sel.getRangeAt(0).cloneContents());
  moveSelectionToDarlings(holder.innerHTML, sel.toString());
}

// Every tab shares one scroller, so leaving a tab used to lose its place.
// Each tab now remembers where it was — the manuscript keeps its caret as
// well — for as long as the book is open.
let tabPlaces = {};

function switchTab(name) {
  const scroller = $('#paper-scroll');
  if (book && currentTab && currentTab !== name) {
    tabPlaces[currentTab] = currentTab === 'manuscript'
      ? { caret: captureCaret(), scroll: scroller.scrollTop }
      : { scroll: scroller.scrollTop };
  }
  currentTab = name;
  $$('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === name);
    t.setAttribute('aria-selected', t.dataset.tab === name ? 'true' : 'false');
  });
  if (spellOn) setTimeout(scanSpellingHere, 0);
  const paper = $('#paper');
  const aux = $('#aux-paper');
  const auxEditor = $('#aux-editor');
  const dList = $('#darlings-list');
  const oList = $('#outline-list');
  const back = tabPlaces[name];
  const returnTo = () => { if (back && typeof back.scroll === 'number') scroller.scrollTop = back.scroll; };

  // stash whatever aux content was open
  flushAux();

  // an open Find follows the tab (Notes arrives from disk, so it looks later)
  const findHere = () => { if (!$('#searchbar').hidden) runSearch(); };
  if (name === 'manuscript') {
    paper.hidden = false;
    aux.hidden = true;
    if (back && back.caret) restoreCaret(back.caret); // brings the scroll along
    else returnTo();
    findHere();
    return;
  }
  paper.hidden = true;
  aux.hidden = false;
  auxEditor.hidden = true;
  dList.hidden = true;
  oList.hidden = true;

  if (name === 'darlings') {
    $('#aux-title').textContent = t('Darlings');
    dList.hidden = false;
    renderDarlings();
    returnTo();
    findHere();
  } else if (name === 'outline') {
    $('#aux-title').textContent = tabName('outline');
    oList.hidden = false;
    if (!book.chapterOrder.some((c) => isStory(c))) createChapterAt(storyEnd());
    renderOutline();
    returnTo();
    findHere();
  } else {
    $('#aux-title').textContent = tabName(name);
    auxEditor.hidden = false;
    auxEditor.dataset.kind = name;
    window.neo.readAux(book.id, name).then((html) => {
      auxEditor.innerHTML = html || '';
      auxEditor.focus({ preventScroll: true });
      returnTo();
      findHere();
    });
  }
}

/* ================================================================== */
/*  STRUCTURED OUTLINE                                                 */
/*  Chapter lines are the book's real chapters. Section notes become   */
/*  grayed "ghost" paragraphs in the manuscript                       */
/* ================================================================== */

const secLetter = (i) => String.fromCharCode(65 + (i % 26));

/**
 * Where the caret goes after a section is removed from the outline: the end of the section ABOVE it,
 * the way a text editor behaves. Only the first section has no line above it, and then the chapter's
 * own line is where the caret belongs.
 */
function focusAfterSectionRemoved(list, index, chId) {
  const above = index > 0 ? list[index - 1] : undefined;
  return above ? { secId: above.id } : { chId };
}

function renderOutline(focusTarget) {
  book.sectionNotes = book.sectionNotes || {};
  book.chapterNotes = book.chapterNotes || {};
  const wrap = $('#outline-list');
  wrap.innerHTML = '';

  // the story's lines, with each part standing over its chapters (the pages
  // a book carries have nothing to outline)
  book.chapterOrder.forEach((chId, i) => {
    const kind = chapterKind(chId);
    if (kind === 'part') { wrap.appendChild(outlinePartLine(chId)); return; }
    if (!STORY_KINDS.includes(kind)) return;
    wrap.appendChild(outlineLine('chapter', chId, null, i, chapterMark(chId),
      book.chapterNotes[chId] || ''));
    (book.sectionNotes[chId] || []).forEach((sec, j) => {
      wrap.appendChild(outlineLine('section', chId, sec.id, j, secLetter(j), sec.text));
    });
  });

  const hint = document.createElement('div');
  hint.className = 'ol-hint';
  hint.textContent = t('Enter — new chapter (or section, from a section line) · Tab — turn a fresh chapter line into a section · Shift+Tab — turn a section into a chapter · Backspace on an empty line removes it');
  wrap.appendChild(hint);

  if (focusTarget) {
    const el = wrap.querySelector(
      focusTarget.secId
        ? `.ol-line[data-sec-id="${focusTarget.secId}"] .ol-text`
        : `.ol-line.ol-chapter[data-ch-id="${focusTarget.chId}"] .ol-text`
    );
    if (el) {
      el.focus();
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
  }
}

// a part in the outline: its name and title, over the chapters it holds
function outlinePartLine(chId) {
  const line = document.createElement('div');
  line.className = 'ol-line ol-part';
  line.dataset.chId = chId;
  const num = document.createElement('span');
  num.className = 'ol-num';
  num.textContent = chapterMark(chId);
  const name = document.createElement('div');
  name.className = 'ol-part-name';
  const title = partTitleOf(chId);
  name.textContent = chapterName(chId) + (title ? ': ' + title : '');
  line.append(num, name);
  line.addEventListener('contextmenu', (e) => { e.preventDefault(); chapterMenu(chId, e.clientX, e.clientY, line); });
  return line;
}

// the story entry before this one (pages and parts aren't where sections go)
function storyBefore(chId) {
  const order = book.chapterOrder;
  for (let i = order.indexOf(chId) - 1; i >= 0; i--) if (isStory(order[i])) return order[i];
  return null;
}

function outlineLine(kind, chId, secId, index, label, text) {
  const line = document.createElement('div');
  line.className = 'ol-line ol-' + kind;
  line.dataset.chId = chId;
  if (secId) line.dataset.secId = secId;
  const num = document.createElement('span');
  num.className = 'ol-num';
  num.textContent = label;
  if (kind === 'chapter' && chapterKind(chId) !== 'chapter') num.title = chapterName(chId);
  const txt = document.createElement('div');
  txt.className = 'ol-text';
  txt.contentEditable = 'true';
  txt.spellcheck = false;
  txt.textContent = text;

  const save = () => {
    const val = txt.textContent.trim();
    if (kind === 'chapter') {
      book.chapterNotes[chId] = val;
    } else {
      const sec = (book.sectionNotes[chId] || []).find((s) => s.id === secId);
      if (sec) sec.text = val;
    }
    scheduleMetaSave();
  };

  txt.addEventListener('blur', () => {
    save();
    if (kind === 'section') syncGhosts(chId);
    renderNav();
  });

  // Enter at the very start of a line that has text makes the new line
  // ABOVE it (the only way to put something before "A"); anywhere else,
  // below — the way a text editor's outline behaves
  const caretAtStart = () => {
    if (!txt.textContent.trim()) return false;
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return false;
    const r = sel.getRangeAt(0);
    if (!txt.contains(r.startContainer)) return false;
    const head = document.createRange();
    head.selectNodeContents(txt);
    head.setEnd(r.startContainer, r.startOffset);
    return head.toString().length === 0;
  };

  txt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const above = caretAtStart();
      save();
      if (kind === 'chapter') {
        const at = book.chapterOrder.indexOf(chId) + (above ? 0 : 1);
        const newId = createChapterAt(at);
        renderOutline({ chId: newId });
      } else {
        const list = book.sectionNotes[chId];
        const newSec = { id: 'sec-' + Date.now().toString(36), text: '' };
        list.splice(index + (above ? 0 : 1), 0, newSec);
        scheduleMetaSave();
        syncGhosts(chId);
        renderOutline({ secId: newSec.id });
      }
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const lines = [...document.querySelectorAll('.ol-line .ol-text')];
      const next = lines[lines.indexOf(txt) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) {
        next.focus();
        const r = document.createRange();
        r.selectNodeContents(next);
        r.collapse(false);
        const s = window.getSelection();
        s.removeAllRanges(); s.addRange(r);
      }
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      if (kind !== 'chapter') return;
      const prevCh = storyBefore(chId);
      if (!prevCh) { toast(t('The first line has to be a chapter')); return; }
      if (countWords(chapterText(chId)) > 0) {
        toast(t('This chapter already has words in it — only empty chapter lines can become sections'));
        return;
      }
      save();
      book.sectionNotes[prevCh] = book.sectionNotes[prevCh] || [];
      const newSec = { id: 'sec-' + Date.now().toString(36), text: txt.textContent.trim() };
      book.sectionNotes[prevCh].push(newSec);
      deleteChapterQuiet(chId).then(() => {
        syncGhosts(prevCh);
        renderOutline({ secId: newSec.id });
      });
    }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      if (kind !== 'section') return;
      save();
      const list = book.sectionNotes[chId];
      const sec = list.find((s) => s.id === secId);
      list.splice(list.indexOf(sec), 1);
      const at = book.chapterOrder.indexOf(chId) + 1;
      const newId = createChapterAt(at);
      book.chapterNotes[newId] = sec.text;
      scheduleMetaSave();
      syncGhosts(chId);
      renderOutline({ chId: newId });
    }
    if (e.key === 'Backspace' && txt.textContent.trim() === '') {
      e.preventDefault();
      if (kind === 'section') {
        const list = book.sectionNotes[chId] || [];
        const focus = focusAfterSectionRemoved(list, index, chId);
        book.sectionNotes[chId] = list.filter((s) => s.id !== secId);
        scheduleMetaSave();
        syncGhosts(chId);
        renderOutline(focus);
      } else if (book.chapterOrder.filter((c) => isStory(c)).length > 1 && countWords(chapterText(chId)) === 0) {
        const prevCh = storyBefore(chId) || book.chapterOrder.find((c) => c !== chId && isStory(c));
        deleteChapterQuiet(chId).then(() => renderOutline({ chId: prevCh }));
      }
    }
    e.stopPropagation();
  });

  // right-click any outline line to delete it
  line.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (kind === 'chapter') {
      await chapterMenu(chId, e.clientX, e.clientY, line);
    } else {
      const choice = await optionModal(t('Delete this section?'), null,
        [{ label: t('Delete section'), desc: t('Removes the outline line and its gray ghost from the manuscript. Written prose is never touched.'), danger: true, value: 'delete' }]);
      if (choice === 'delete') {
        const list = book.sectionNotes[chId] || [];
        const focus = focusAfterSectionRemoved(list, index, chId);
        book.sectionNotes[chId] = list.filter((s) => s.id !== secId);
        scheduleMetaSave();
        syncGhosts(chId);
        renderOutline(focus);
      }
    }
  });

  line.appendChild(num);
  line.appendChild(txt);
  return line;
}

// Push section notes into the manuscript as gray ghost paragraphs,
// with real *** scene breaks between sections.
// Once a ghost has been written over, it goes away.
function syncGhosts(chId) {
  const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  if (!body) return;
  const list = (book.sectionNotes && book.sectionNotes[chId]) || [];
  const keep = new Set(list.map((s) => s.id));

  const breakFor = (secId) => body.querySelector(`p.scene-break[data-sec-brk="${secId}"]`);

  // 1. Sections deleted from the outline: remove their ghost + its break
  //    (but never touch paragraphs that have been written over)
  body.querySelectorAll('p.ghost[data-sec-id]').forEach((p) => {
    if (!keep.has(p.dataset.secId)) {
      const brk = breakFor(p.dataset.secId);
      if (brk) brk.remove();
      p.remove();
    }
  });

  // 2. Pull all still-ghost paragraphs out, then re-append in outline order
  //    so the ghosts always mirror the outline's sequence
  for (const p of [...body.querySelectorAll('p.ghost[data-sec-id]')]) {
    const brk = breakFor(p.dataset.secId);
    if (brk) brk.remove();
    p.remove();
  }
  for (const sec of list) {
    // written over already? Leave it alone
    const written = body.querySelector(`p[data-sec-id="${sec.id}"]:not(.ghost)`);
    if (written) continue;
    if (!sec.text) continue;
    // *** between this ghost and whatever comes before it
    const hasContent = body.innerText.trim() !== '';
    if (hasContent && !(body.lastElementChild && body.lastElementChild.classList.contains('scene-break'))) {
      const brk = document.createElement('p');
      brk.className = 'scene-break';
      brk.dataset.secBrk = sec.id;
      brk.textContent = '***';
      body.appendChild(brk);
    }
    const p = document.createElement('p');
    p.className = 'ghost';
    p.dataset.secId = sec.id;
    p.textContent = sec.text;
    body.appendChild(p);
  }
  syncChapter(body, chId);
}

let auxDirty = false;
$('#aux-editor').addEventListener('keydown', (e) => { if (styleKeepScroll(e)) return; smartKeys(e, e.currentTarget); });
$('#aux-editor').addEventListener('input', () => {
  auxDirty = true;
  scheduleAuxSave();
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
function flushAux() {
  if (!auxDirty || !book) return;
  const kind = $('#aux-editor').dataset.kind;
  if (kind) window.neo.writeAux(book.id, kind, $('#aux-editor').innerHTML);
  auxDirty = false;
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
      await window.neo.writeJSON(book.id, 'darlings', darlings);
      renderDarlings();
    };
    el.appendChild(content);
    el.appendChild(meta);
    wrap.appendChild(el);
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
        darlings = darlings.filter((x) => x.id !== id);
        await window.neo.writeJSON(book.id, 'darlings', darlings);
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
  scheduleChapterSave(chId);
  darlings = darlings.filter((x) => x.id !== id);
  await window.neo.writeJSON(book.id, 'darlings', darlings);
  focusChapter(chId);
  toast(t('Original spot is gone — restored to the end of {label}', { label: d.chapterLabel || t('the manuscript') }));
}

/* ================================================================== */
/*  COUNTERS                                                           */
/* ================================================================== */

// the story's words: the pages a book carries don't count
function bookWordCount() {
  return book.chapterOrder.reduce((sum, chId) => sum + (isStory(chId) ? chapterWords(chId) : 0), 0);
}

function updateCounters() {
  if (!book) return;
  const total = bookWordCount();
  const wc = $('#word-counter');
  if (wordMode === 'book') wc.textContent = t('{n} words', { n: total });
  const cur = book.chapterOrder.includes(currentChapterId) ? currentChapterId : null;
  const solo = soloStory();
  if (wordMode !== 'book') {
    const n = cur ? chapterWords(cur) : 0;
    wc.textContent = cur && chapterKind(cur) !== 'chapter'
      ? t('{name}: {n} words', { name: chapterName(cur), n })
      : t('ch. {ch}: {n} words', { ch: cur ? chapterNumber(cur) : 0, n });
  }
  const pos = $('#pos-counter');
  pos.textContent = library.posMode === 'page'
    ? (cur ? t('page {p} of {total}', { p: currentPage(cur), total: pageCount(total) }) : t('{n} pages', { n: pageCount(total) }))
    : !cur
    ? (numberedChapters() > 1 ? t('{n} chapters', { n: numberedChapters() }) : '')
    : cur === solo
      ? '' // a chapterless story needs no chapter locator
      : chapterKind(cur) !== 'chapter'
        ? chapterName(cur)
        : t('chapter {ch} of {total}', { ch: chapterNumber(cur), total: numberedChapters(book, cur) });
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

// ---- time-goal helpers (pure: a clock face, a readable duration, and the
// span the stopwatch credits) ----
const TIME_TICK_MS = 1000;
const TIME_GRACE_MS = 120000; // two minutes of thinking still counts

// The span from the last mark up to now, but never past the grace window
// after the last touch. A closed form like this is exact whatever the tick
// size, so a throttled or delayed timer can't drift or dump a sleep into the
// day — and a pause of mind stops the watch on its own.
function writingSpanMs(now, mark, lastActivity, grace = TIME_GRACE_MS) {
  const end = Math.min(now, (lastActivity || now) + grace);
  return Math.max(0, end - mark);
}

// A stopwatch face: mm:ss, or h:mm:ss past an hour.
function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
// ---- end time-goal helpers ----

// ---- daily time tracking ----
// A stopwatch that pauses itself. It runs while the editor is on screen and
// the window is in front, and it keeps counting for a short grace after the
// last keystroke or click. Time is stored per book, beside the day's word
// counts, and never touches a word goal.
let lastWriteActivity = 0;
let timeMark = 0;       // the last instant already credited
let timeDirty = false;  // seconds changed since the last save
let timeTimer = null;   // the 1s live tick; only while a time goal is set

function writingTimeActive() {
  return !!book && !$('#editor-view').hidden &&
    document.visibilityState === 'visible' && document.hasFocus();
}

function timeToday() {
  return (book && book.dailyTime && book.dailyTime[todayStr()]) || 0;
}

// Credit the span since the last mark. Callers only call this while the page
// is live — or once, as the window is leaving, to catch the last word.
function creditWritingTime(now = Date.now()) {
  if (!book) { timeMark = now; return 0; }
  if (!timeMark) { timeMark = now; return 0; }
  const got = writingSpanMs(now, timeMark, lastWriteActivity);
  timeMark = now;
  if (got <= 0) return 0;
  book.dailyTime = book.dailyTime || {};
  const day = todayStr();
  book.dailyTime[day] = (book.dailyTime[day] || 0) + got / 1000;
  timeDirty = true;
  return got;
}

// The live tick exists only to keep a time goal's clock moving. Time is still
// credited on the regular saves when no goal is set, so history is there if a
// goal is added later.
function ensureTimeTimer() {
  const want = !!book && !$('#editor-view').hidden && (library.dailyTimeGoal || 0) > 0;
  if (want && !timeTimer) {
    if (!timeMark) timeMark = Date.now();
    timeTimer = setInterval(() => {
      if (writingTimeActive()) { creditWritingTime(); renderGoalCounter(); }
      else timeMark = Date.now();
    }, TIME_TICK_MS);
  } else if (!want && timeTimer) {
    clearInterval(timeTimer);
    timeTimer = null;
  }
}
function stopTimeTimer() {
  if (timeTimer) { clearInterval(timeTimer); timeTimer = null; }
}

// A key, or a click in the editor, keeps the stopwatch alive — where the
// writer is working, not necessarily which pane.
document.addEventListener('keydown', () => { lastWriteActivity = Date.now(); }, true);
document.addEventListener('pointerdown', (e) => {
  if (e.target && e.target.closest && e.target.closest('#editor-view')) lastWriteActivity = Date.now();
}, true);

// The bottom counter: the day's words exactly as before, with the day's
// time appended only once a time goal is set.
function renderGoalCounter() {
  if (!book) return;
  const gc = $('#goal-counter');
  const today = (book.dailyCounts || {})[todayStr()];
  const wordsToday = today ? Math.max(0, today.end - today.start) : 0;
  if (sprint && !sprint.done) {
    const sprintWords = bookWordCount() - sprint.startCount;
    gc.textContent = `⚡ ${fmtNum(sprintWords)} / ${fmtNum(sprint.target)}`;
    if (sprintWords >= sprint.target) {
      sprint.done = true;
      toast(t('Sprint complete — {n} words. Well earned.', { n: sprintWords }), 6000);
    }
    return;
  }
  const goal = library.dailyGoal || 0;
  const words = goal
    ? t('{n} / {goal} today', { n: wordsToday, goal })
    : t('{n} today', { n: wordsToday });
  const goalSec = (library.dailyTimeGoal || 0) * 60;
  if (goalSec > 0) {
    const secs = timeToday();
    // the word text in the writer's language, then a language-neutral clock
    gc.textContent = words + ' · ' + fmtClock(secs) + ' / ' + fmtClock(goalSec);
    gc.classList.toggle('goal-met', secs >= goalSec);
  } else {
    gc.textContent = words;
    gc.classList.toggle('goal-met', goal > 0 && wordsToday >= goal);
  }
}

function trackDailyWords(total) {
  book.dailyCounts = book.dailyCounts || {};
  const today = todayStr();
  if (!book.dailyCounts[today]) {
    book.dailyCounts[today] = { start: total, end: total };
    scheduleMetaSave();
  } else if (book.dailyCounts[today].end !== total) {
    book.dailyCounts[today].end = total;
  }
  // Cutting is writing too: words cut below where the day began move the
  // day's start down with them, so today never reads below zero, and what's
  // written after the cut counts in full. (Cut what you wrote today, and
  // today is smaller: that part is honest.)
  if (total < book.dailyCounts[today].start) {
    book.dailyCounts[today].start = total;
    scheduleMetaSave();
  }
  if (sprint && total < sprint.startCount) sprint.startCount = total;
  renderGoalCounter();
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
    const r = document.createRange();
    r.selectNodeContents(body);
    r.setEnd(sel.anchorNode, sel.anchorOffset);
    before += countWords(plainText(r.cloneContents()));
  }
  return Math.min(pageCount(bookWordCount()), Math.floor(before / WORDS_PER_PAGE) + 1);
}
// click: chapter of chapters ↔ page of pages
$('#pos-counter').onclick = () => {
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
        $('#word-counter').textContent = t('{n} selected', { n });
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
function persistChapter(chId, html) {
  if (!book) return Promise.resolve(false);
  if (html === undefined) html = chapterHTML[chId] || '';
  const before = savedHTML[chId];
  savedHTML[chId] = html;
  writing[chId] = (writing[chId] || 0) + 1;
  return new Promise((resolve) => resolve(window.neo.writeChapter(book.id, chId, html))).catch((err) => {
    // It never reached the disk. Book it as unsaved again, so the next flush
    // tries once more, and so a look at the disk can't take the old file
    // for news and put it back on the page.
    if (savedHTML[chId] === html) savedHTML[chId] = before;
    throw err;
  }).finally(() => { writing[chId]--; });
}

function scheduleChapterSave(chId) {
  clearTimeout(saveTimers[chId]);
  const bookId = book && book.id;
  saveTimers[chId] = setTimeout(() => {
    if (!book) return; // the book closed before the timer fired; flushAllSaves already wrote it
    // another book is open, or the chapter was deleted or merged into the one
    // above while this save waited: its words are already where they belong,
    // and writing now would only leave an empty stray file in chapters/
    if (book.id !== bookId || !book.chapterOrder.includes(chId)) return;
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
    if (k === 'lastPosition' || k === 'modified' || k === 'wordCount' || k === 'dailyCounts' || k === 'dailyTime') continue; // bookkeeping, not the book
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
async function saveMeta() {
  if (!book) return;
  const sig = metaSig(book);
  timeDirty = false; // this write carries the day's time; new seconds set it again
  const stamp = await writeBookMeta(book.id, book);
  if (book && typeof stamp === 'string') book.modified = stamp;
  savedMetaSig = sig;
}

function flushAllSaves(e) {
  if (!book) return;
  if (writingTimeActive()) creditWritingTime();
  // remember where you were, for next session and for the other device:
  // the chapter, the paragraph and the letter (the same place on any
  // screen) plus the scroll (this screen's). `at` changes only when the
  // caret does, so a device that merely scrolled never calls the other
  // one back to an old spot.
  const prev = book.lastPosition || {};
  const caret = captureCaret();
  const spot = caret
    ? { chapterId: caret.chId, pIdx: caret.pIdx, off: caret.off }
    : prev.chapterId === currentChapterId ? { chapterId: prev.chapterId, pIdx: prev.pIdx, off: prev.off } : { chapterId: currentChapterId };
  const scroll = $('#paper-scroll').scrollTop;
  const newSpot = spot.chapterId !== prev.chapterId || spot.pIdx !== prev.pIdx;
  const newLetter = newSpot || spot.off !== prev.off;
  // the regular tick while writing saves a new paragraph; leaving NEO (a
  // blur, the app going to the background, closing) saves the exact letter
  const moved = newSpot || (e !== 'tick' && newLetter) || Math.abs((prev.scroll || 0) - scroll) > 40;
  if (moved) book.lastPosition = { ...spot, scroll, at: newLetter ? Date.now() : (prev.at || Date.now()) };
  for (const chId of book.chapterOrder) {
    if (chapterHTML[chId] !== undefined && chapterHTML[chId] !== savedHTML[chId]) {
      persistChapter(chId);
    }
  }
  flushAux();
  flushStickiesSave();
  if (moved || timeDirty || metaSig(book) !== savedMetaSig) saveMeta();
}

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

let refreshing = false;
async function refreshFromDisk() {
  if (refreshing) return;
  refreshing = true;
  bookMetaCache.clear(); // whatever another device wrote, the next redraw reads
  try {
    if (!book) {
      if (library && !$('#bookshelf-view').hidden) {
        const gen = libraryGeneration;
        const lib = await window.neo.readLibrary();
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
    let side = null;
    if (theirs) {
      for (const chId of meta.chapterOrder) {
        if (chapterHTML[chId] !== undefined) continue;
        incoming[chId] = await window.neo.readChapter(bookId, chId);
        if (!book || book.id !== bookId) return;
      }
      side = {
        stickies: await window.neo.readJSON(bookId, 'stickies', stickies),
        darlings: await window.neo.readJSON(bookId, 'darlings', darlings)
      };
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

    // Then decide it all in one go: nothing waits from here to the page.
    let restructured = false;
    if (theirs && metaSig(book) === sigHere) {
      // The other device added, renamed or moved chapters. Whichever
      // book.json stands, no chapter holding words is dropped: theirs keeps
      // the chapters with unsaved words here, and ours (when this device
      // restructured too and hasn't saved yet) takes in the chapters they wrote.
      const order = [...(mine ? book.chapterOrder : meta.chapterOrder)];
      const other = mine ? meta.chapterOrder : book.chapterOrder;
      other.forEach((chId, i) => {
        if (order.includes(chId)) return;
        if (mine ? !/[^\s]/.test(String(incoming[chId] || '').replace(/<[^>]*>/g, '')) : chapterHTML[chId] === savedHTML[chId]) return;
        const prev = other.slice(0, i).reverse().find((c) => order.includes(c));
        order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, chId);
      });
      if (!mine || order.length !== book.chapterOrder.length) {
        for (const chId of order) {
          if (!(chId in incoming)) continue;
          chapterHTML[chId] = incoming[chId];
          savedHTML[chId] = incoming[chId];
        }
        if (mine) {
          book.chapterOrder = order;
        } else {
          book = { ...meta, chapterOrder: order, lastPosition: book.lastPosition };
          savedMetaSig = metaSig(meta);
          stickies = side.stickies;
          darlings = side.darlings;
        }
        if (metaSig(book) !== savedMetaSig) scheduleMetaSave();
        if (!book.chapterOrder.includes(currentChapterId)) currentChapterId = null;
        undoStack = []; // snapshots of the old structure must not replay over the new one
        restructured = true;
      }
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
        wordCache[chId] = null;
        adopted++;
      } else {
        savedHTML[chId] = disk; // what's on disk now; our text goes over it on the next save
        const idx = book.chapterOrder.indexOf(chId);
        const twinId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
        book.chapterOrder.splice(idx + 1, 0, twinId);
        book.chapterTitles = book.chapterTitles || {};
        const when = new Date().toLocaleTimeString(NeoI18n.getLocale(), { hour: 'numeric', minute: '2-digit' });
        book.chapterTitles[twinId] = ((book.chapterTitles[chId] || '') + ' ' + t('from other device, {time}', { time: when })).trim();
        chapterHTML[twinId] = disk;
        persistChapter(twinId, disk);
        persistChapter(chId);
        scheduleMetaSave();
        conflicts++;
      }
    }
    if (restructured || adopted || conflicts) {
      const caret = captureCaret();
      const keepScroll = $('#paper-scroll').scrollTop;
      renderChapters();
      $('#paper-scroll').scrollTop = keepScroll;
      if (caret) restoreCaret(caret);
      if (restructured) {
        const show = (el, text) => { if (el.textContent !== text) el.textContent = text; };
        show($('#tp-title'), isUntitled(book.title) ? '' : book.title);
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
        window.neo.writeJSON(bookId, 'darlings', darlings);
      }
      if (currentTab === 'darlings' && (restructured || replaced.length)) renderDarlings();
      if (conflicts) toast(t('This chapter also changed on another device. That version is saved as the chapter after it.'), 8000);
      else if (replaced.length) toast(t('Updated from your other device — the text it replaced is in Darlings'), 8000);
      else toast(t('Updated from your other device'));
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
window.addEventListener('focus', () => { timeMark = Date.now(); setTimeout(refreshFromDisk, 300); });
// and a quiet look every half minute while NEO is on screen, for the writer
// who left both machines open
setInterval(() => { if (document.visibilityState === 'visible') refreshFromDisk(); }, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') setTimeout(refreshFromDisk, 300);
  else if (book) { creditWritingTime(); flushAllSaves(); } // iOS may end a backgrounded app without warning
});

window.addEventListener('beforeunload', () => { if (book) creditWritingTime(); flushAllSaves(); });
// flush whenever focus leaves NEO, and every 20 seconds
window.addEventListener('blur', () => { if (book) { creditWritingTime(); flushAllSaves(); } });
setInterval(() => { if (book) flushAllSaves('tick'); }, 20000);

async function backToShelf() {
  creditWritingTime(); // catch the last words before the editor goes away
  stopTimeTimer();
  timeMark = 0;
  flushAllSaves();
  tabPlaces = {};
  book = null;
  currentChapterId = null;
  undoStack = [];
  $('#editor-view').hidden = true;
  $('#bookshelf-view').hidden = false;
  renderShelves();
}
$('#back-to-shelf').onclick = backToShelf;

/* ================================================================== */
/*  STRUCTURAL UNDO                                                    */
/*  Typing has the native ⌘Z. This covers the big moves — chapter      */
/*  deletes, replace-all, darlings — with snapshots of the whole       */
/*  structure.                                                         */
/* ================================================================== */

let undoStack = [];

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

function snapshotStructure(label, opts) {
  if (!book) return;
  undoStack.push({
    label,
    rejoin: !!(opts && opts.rejoin),
    caret: captureCaret(),
    chapterOrder: [...book.chapterOrder],
    chapterKinds: { ...(book.chapterKinds || {}) },
    chapterHTML: { ...chapterHTML },
    chapterTitles: { ...(book.chapterTitles || {}) },
    chapterNotes: { ...(book.chapterNotes || {}) },
    sectionNotes: JSON.parse(JSON.stringify(book.sectionNotes || {})),
    darlings: JSON.parse(JSON.stringify(darlings)),
    stickies: JSON.parse(JSON.stringify(stickies))
  });
  if (undoStack.length > 10) undoStack.shift();
}

async function structuralUndo() {
  const snap = undoStack.pop();
  if (!snap || !book) return;
  book.chapterOrder = snap.chapterOrder;
  book.chapterKinds = snap.chapterKinds;
  chapterHTML = snap.chapterHTML;
  book.chapterTitles = snap.chapterTitles;
  book.chapterNotes = snap.chapterNotes;
  book.sectionNotes = snap.sectionNotes;
  darlings = snap.darlings;
  stickies = snap.stickies;
  // resurrect any chapter files the action may have deleted
  for (const chId of book.chapterOrder) {
    await persistChapter(chId, chapterHTML[chId] || '<p><br></p>');
  }
  await window.neo.writeJSON(book.id, 'darlings', darlings);
  await window.neo.writeJSON(book.id, 'stickies', stickies);
  await saveMeta();
  currentChapterId = book.chapterOrder.includes(currentChapterId) ? currentChapterId : null;
  renderChapters();
  renderStickies();
  if (currentTab === 'darlings') renderDarlings();
  if (currentTab === 'outline') renderOutline();
  updateCounters();
  restoreCaret(snap.caret); // back to work, no announcement
  if (snap.rejoin) rejoinAtCaret();
  resetNativeUndo();
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
/*  FIND & REPLACE                                                     */
/* ================================================================== */

let searchState = { matches: [], idx: -1, query: '' };

function openSearch() {
  if ($('#editor-view').hidden || !book) { toast(t('Open a book first')); return; }
  const sel = window.getSelection();
  const preset = sel && !sel.isCollapsed ? sel.toString().slice(0, 80).trim() : '';
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
  if (window.CSS && CSS.highlights) {
    CSS.highlights.delete('neo-search');
    CSS.highlights.delete('neo-search-current');
  }
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
  if (currentTab === 'outline') return $$('#outline-list .ol-text');
  if (currentTab === 'darlings') return $$('#darlings-list .darling > :first-child');
  return [$('#aux-editor')];
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
  const ql = q.toLowerCase();
  for (const body of searchRoots()) {
    if (!body) continue;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const tl = node.textContent.toLowerCase();
      let pos = 0;
      while ((pos = tl.indexOf(ql, pos)) !== -1) {
        const range = document.createRange();
        range.setStart(node, pos);
        range.setEnd(node, pos + q.length);
        searchState.matches.push({ range });
        pos += q.length;
      }
    }
  }
  const n = searchState.matches.length;
  $('#search-count').textContent = n ? `${n} found` : 'none';
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

function replaceCurrent() {
  if (currentTab !== 'manuscript') return;
  freshSearchIfStale();
  if (!searchState.matches.length) { toast(t('No matches')); return; }
  if (searchState.idx < 0) searchState.idx = 0; // start from the very first match
  const m = searchState.matches[searchState.idx];
  const rep = $('#replace-input').value;
  let chapter = null;
  try {
    chapter = m.range.startContainer.parentElement.closest('.chapter');
    m.range.deleteContents();
    if (rep) m.range.insertNode(document.createTextNode(rep));
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
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  let n = 0;
  for (const chId of book.chapterOrder) {
    const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
    if (!body) continue;
    const nodes = [];
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    let touched = false;
    for (const nd of nodes) {
      if (nd.textContent.toLowerCase().includes(q.toLowerCase())) {
        nd.textContent = nd.textContent.replace(re, () => { n++; return rep; });
        touched = true;
      }
    }
    if (touched) syncChapter(body, chId);
  }
  if (n === 0) undoStack.pop(); // nothing changed, nothing to undo
  toast(n ? t('{n} replaced across the whole book — {key} to undo', { n, key: KZ }) : t('0 replaced'));
  runSearch();
}

$('#search-input').addEventListener('input', () => {
  clearTimeout(saveTimers.search);
  saveTimers.search = setTimeout(runSearch, 250);
});
$('#search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); freshSearchIfStale(); gotoMatch(searchState.idx + (e.shiftKey ? -1 : 1)); }
  if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); }
  if (e.key === 'Tab' && !e.shiftKey) {
    const m = searchState.matches[Math.max(0, searchState.idx)];
    if (m) {
      e.preventDefault();
      const sel = window.getSelection();
      const r = m.range.cloneRange();
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
      const body = m.range.startContainer.parentElement.closest('[contenteditable="true"]');
      if (body) body.focus();
    }
  }
});
$('#replace-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(); }
  if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); }
});
$('#search-next').onclick = () => { freshSearchIfStale(); gotoMatch(searchState.idx + 1); };
$('#search-prev').onclick = () => { freshSearchIfStale(); gotoMatch(searchState.idx - 1); };
$('#replace-one').onclick = replaceCurrent;
$('#replace-all').onclick = replaceAllMatches;
$('#search-close').onclick = closeSearch;

/* ================================================================== */
/*  IMPORT                                                             */
/* ================================================================== */

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Turn parsed manuscripts into books on a shelf — used by the file picker
// and by dropping files from Finder straight onto a shelf.
async function addImportedBooks(results, shelf) {
  shelf = shelf || shelvesFor(currentAuthor().id)[0] || library.shelves[0];
  let ok = 0;
  for (const r of results) {
    if (r.error) { toast(t('Couldn’t import {name}: {error}', { name: r.name, error: r.error }), 6000); continue; }
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
      const html = ch.paras.map((p) => {
        if (p.scene) return '<p class="scene-break">***</p>';
        // hyphens set as dialogue dashes, the same as typing them
        let text = escHtml(dialogueDashes(p.text || '', dashStyle()));
        text = text.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
                   .replace(/\*([^*]+)\*/g, '<i>$1</i>')
                   .replace(/_([^_]+)_/g, '<i>$1</i>');
        return `<p>${text}</p>`;
      }).join('') || '<p><br></p>';
      await window.neo.writeChapter(meta.id, chId, html);
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
}

async function importBooks() {
  const results = await window.neo.importPick();
  if (results.length) await addImportedBooks(results, shelvesFor(currentAuthor().id)[0] || library.shelves[0]);
}

$('#import-btn').onclick = importBooks;

/* ================================================================== */
/*  SPELLCHECK PASS + TYPEWRITER SCROLLING                             */
/* ================================================================== */

/* NEO's own spellcheck pass: a bundled dictionary (via the main process),
   squiggles painted with the CSS Highlight API — the same machinery as
   search — and a right-click menu for suggestions. Chapters scan lazily
   as the caret reaches them. */
let spellOn = false;
let spellScanned = new Set();
let spellRanges = new Map();     // key → [Range]
const spellCache = new Map();    // word → correct?

const spellNorm = (w) => w.replace(/’/g, "'").replace(/^'+|'+$/g, '');

function spellElFor(key) {
  return key.startsWith('aux-')
    ? $('#aux-editor')
    : document.querySelector(`.chapter[data-id="${key}"] .chapter-body`);
}

async function spellScanEl(el, key) {
  if (!el || !spellOn) return;
  spellScanned.add(key);
  const occurrences = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  // letters of any alphabet, with their accents, so French and German
  // words reach the dictionary whole — hyphenated ones too (e-mail,
  // well-known, fazê-lo, dir-se-ia): the dictionary judges the whole word,
  // and only when it says no are the pieces underlined one by one
  const re = /[\p{L}\p{M}'’]+(?:-[\p{L}\p{M}'’]+)*/gu;
  const piece = /[\p{L}\p{M}'’]+/gu;
  const legal = (raw) => /^[\p{Lu}'’]+$/u.test(raw); // acronyms and shouting are legal
  // a stammer (E-eu, N-não, Wh-what): each short piece starts the next, and
  // only the word it lands on is judged
  const bare = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const stammers = (bits) => bits.length > 1 && bits.slice(0, -1).every((s, i) => s.length <= 3 && bare(bits[i + 1]).startsWith(bare(s)));
  let n;
  while ((n = walker.nextNode())) {
    const p = n.parentElement;
    if (p && p.closest('.scene-break, .ghost, .ph-mark')) continue;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(n.data))) {
      const stammer = stammers(m[0].split('-'));
      const parts = [];
      piece.lastIndex = 0;
      let q;
      while ((q = piece.exec(m[0]))) {
        const word = spellNorm(q[0]);
        if (word.length < 2 || legal(q[0])) continue;
        if (stammer && q.index + q[0].length < m[0].length) continue;
        parts.push({ start: m.index + q.index, end: m.index + q.index + q[0].length, word });
      }
      if (!parts.length) continue;
      const whole = m[0].includes('-') && !stammer && !legal(m[0].replace(/-/g, '')) ? spellNorm(m[0]) : null;
      occurrences.push({ node: n, start: m.index, end: m.index + m[0].length, whole, parts });
    }
  }
  const words = new Set();
  for (const o of occurrences) {
    if (o.whole) words.add(o.whole);
    for (const pt of o.parts) words.add(pt.word);
  }
  const unknown = [...words].filter((w) => !spellCache.has(w));
  if (unknown.length) {
    const res = await window.neo.spellCheckWords(unknown);
    for (const w of unknown) spellCache.set(w, res[w] !== false);
  }
  if (!spellOn) return; // toggled off while we were checking
  const ranges = [];
  const mark = (node, start, end) => {
    try {
      const r = new Range();
      r.setStart(node, start);
      r.setEnd(node, end);
      ranges.push(r);
    } catch { /* node changed underneath us */ }
  };
  for (const o of occurrences) {
    if (!o.node.isConnected) continue;
    if (o.whole && spellCache.get(o.whole)) continue;
    const wrong = o.parts.filter((pt) => !spellCache.get(pt.word));
    if (wrong.length) for (const pt of wrong) mark(o.node, pt.start, pt.end);
    else if (o.whole) mark(o.node, o.start, o.end); // every piece fine, the whole not
  }
  const caps = capitalSlips(el);
  for (const r of caps) ranges.push(r);
  capsRanges.set(key, caps);
  spellRanges.set(key, ranges);
  rebuildSpellHighlight();
}

// Capitals the dictionary can't see, since it takes any word in lowercase:
// a sentence that starts small, and, in English, "i" for "I". Underlined
// like a misspelling; right-click offers the capital. Manuscript prose only
// (notes are the writer's scratch paper, and poetry sets its own case).
// Mid-paragraph, only a full stop ends a sentence: "Oh! how lovely",
// "— Quanto falta? — perguntou ele" and "…and then" are the writer's.
const capsRanges = new Map(); // key → [Range]
const CAPS_ABBREV = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'vs', 'etc', 'e.g', 'i.e', 'cf', 'approx', 'no', 'vol', 'pp', 'p', 'fig', 'ca', 'mt', 'ft', 'lt', 'sgt', 'capt', 'col', 'gen', 'prof', 'rev', 'hon', 'inc', 'ltd', 'co', 'ave', 'a.m', 'p.m', 'sra', 'sr', 'srta', 'dra', 'av', 'ex', 'z.b', 'bzw', 'ggf', 'usw', 'm', 'mme', 'mlle']);
function capitalSlips(el) {
  const out = [];
  if (typeof el.matches !== 'function' || !el.matches('.chapter-body')) return out;
  const english = /^en\b/.test(writingLanguage());
  for (const p of el.querySelectorAll('p:not(.poetry):not(.scene-break)')) {
    // the paragraph's text, and which node holds each stretch of it
    const segs = [];
    let text = '';
    const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.parentElement && n.parentElement.closest('.ghost, .ph-mark')) continue;
      segs.push({ node: n, at: text.length });
      text += n.data;
    }
    if (!text.trim()) continue;
    const seen = new Set();
    const mark = (i) => {
      if (seen.has(i)) return;
      seen.add(i);
      let s = segs[0];
      for (const g of segs) if (g.at <= i) s = g; else break;
      try {
        const r = new Range();
        r.setStart(s.node, i - s.at);
        r.setEnd(s.node, i - s.at + 1);
        out.push(r);
      } catch { /* changed underneath us */ }
    };
    // the paragraph's first letter, past opening quotes, brackets and dashes
    const lead = text.match(/^[\s"'“‘„«»(\[¿¡—–-]*/)[0].length;
    if (/\p{Ll}/u.test(text[lead] || '') && !/^\p{Ll}\./u.test(text.slice(lead, lead + 2))) mark(lead);
    // a letter after a full stop (not an ellipsis or an abbreviation)
    const stop = /(?<!\.)\.\s+["'“‘„«(\[]?(\p{Ll})/gu;
    let m;
    while ((m = stop.exec(text))) {
      const before = text.slice(0, m.index).match(/([\p{L}.]+)$/u);
      const word = before ? before[1].toLowerCase() : '';
      if (CAPS_ABBREV.has(word) || /^\p{L}$/u.test(word)) continue; // Mr. smith, J. r. r.
      mark(m.index + m[0].length - 1);
    }
    // English "i", "i'm", "i'd" … standing alone (not "i.e." or "(i)")
    if (english) {
      const eye = /(?<![\p{L}\p{M}\d'’.(-])i(?![\p{L}\p{M}\d.)-])(?!['’](?![mdv]|ll|re))/gu;
      while ((m = eye.exec(text))) mark(m.index);
    }
  }
  return out;
}

function rebuildSpellHighlight() {
  if (!spellOn) return;
  const hl = new Highlight();
  for (const list of spellRanges.values()) for (const r of list) hl.add(r);
  CSS.highlights.set('neo-spell', hl);
}

function scanSpellingIn(el, key) {
  if (!el || spellScanned.has(key)) return;
  spellScanEl(el, key);
}

// scan wherever the writer currently is
function scanSpellingHere() {
  if (currentTab === 'manuscript') {
    const body = currentChapterId && spellElFor(currentChapterId);
    if (body) scanSpellingIn(body, currentChapterId);
  } else {
    scanSpellingIn($('#aux-editor'), 'aux-' + ($('#aux-editor').dataset.kind || 'notes'));
  }
}

function scheduleSpellRescan(key, el) {
  clearTimeout(saveTimers['sp-' + key]);
  saveTimers['sp-' + key] = setTimeout(() => { if (spellOn) spellScanEl(el, key); }, 600);
}

function toggleSpellcheck() {
  spellOn = !spellOn;
  if (spellOn) {
    spellScanned = new Set();
    spellRanges = new Map();
    capsRanges.clear();
    scanSpellingHere();
  } else {
    CSS.highlights.delete('neo-spell');
    spellRanges = new Map();
    capsRanges.clear();
    document.querySelector('.spell-menu')?.remove();
  }
  toast(spellOn ? t('Spellcheck on') : t('Spellcheck off'));
}

// Edit → Spellcheck Language: swap the dictionary, remember the choice with
// the library, and re-check whatever is on screen
const SPELL_LANGUAGE_NAMES = {
  'en-US': t('US English'), 'en-GB': t('UK English'), 'en-CA': t('Canadian English'),
  'en-AU': t('Australian English'), fr: t('French'), es: t('Spanish'), de: t('German'),
  nl: t('Dutch'), pl: t('Polish'), 'pt-BR': t('Brazilian Portuguese'), ro: t('Romanian'), ru: t('Russian')
};
async function changeSpellLanguage(code) {
  const ok = await window.neo.setSpellLanguage(code);
  if (!ok) { toast(t('That dictionary would not load')); return; }
  library.spellLanguage = code;
  await writeLibrary(library);
  spellCache.clear();
  if (spellOn) {
    spellScanned = new Set();
    spellRanges = new Map();
    capsRanges.clear();
    CSS.highlights.delete('neo-spell');
    scanSpellingHere();
  }
  toast(t('Spellcheck: {lang}', { lang: SPELL_LANGUAGE_NAMES[code] || code }));
}

// right-click a flagged word for suggestions
document.addEventListener('contextmenu', async (e) => {
  if (!spellOn) return;
  const editor = e.target.closest && e.target.closest('.chapter-body, #aux-editor');
  if (!editor) return;
  const pos = document.caretRangeFromPoint(e.clientX, e.clientY);
  if (!pos || pos.startContainer.nodeType !== Node.TEXT_NODE) return;
  const node = pos.startContainer;
  const text = node.data;
  // a capital slip (see capitalSlips): the letter's capital, and nothing to learn
  let ws = pos.startOffset;
  while (ws > 0 && /[\p{L}\p{M}]/u.test(text[ws - 1])) ws--;
  for (const list of capsRanges.values()) {
    const hit = list.find((r) => r.startContainer === node && r.startOffset === ws);
    if (!hit) continue;
    e.preventDefault();
    const at = hit.startOffset;
    const upper = text[at].toLocaleUpperCase(writingLanguage());
    const chEl = editor.closest('.chapter');
    showSpellMenu(e.clientX, e.clientY, text[at], [upper], {
      replace: (s) => {
        const sel = window.getSelection();
        const r = document.createRange();
        r.setStart(node, at); r.setEnd(node, at + 1);
        sel.removeAllRanges(); sel.addRange(r);
        document.execCommand('insertText', false, s);
        if (chEl) spellScanEl(spellElFor(chEl.dataset.id), chEl.dataset.id);
      }
    });
    return;
  }
  const isW = (c) => /[\p{L}\p{M}'’]/u.test(c);
  let a = pos.startOffset, b = pos.startOffset;
  while (a > 0 && isW(text[a - 1])) a--;
  while (b < text.length && isW(text[b])) b++;
  if (a === b) return;
  let word = spellNorm(text.slice(a, b));
  if (spellCache.get(word) !== false) {
    // …or a hyphenated word underlined whole: every piece is a word, the
    // whole isn't (see spellScanEl)
    let wa = a, wb = b;
    while (text[wa - 1] === '-' && isW(text[wa - 2] || '')) { wa--; while (wa > 0 && isW(text[wa - 1])) wa--; }
    while (text[wb] === '-' && isW(text[wb + 1] || '')) { wb++; while (wb < text.length && isW(text[wb])) wb++; }
    const whole = spellNorm(text.slice(wa, wb));
    if (whole === word || spellCache.get(whole) !== false) return; // only flagged words get our menu
    if (text.slice(wa, wb).split('-').some((w) => spellCache.get(spellNorm(w)) === false)) return;
    a = wa; b = wb; word = whole;
  }
  e.preventDefault();
  const chEl = editor.closest ? editor.closest('.chapter') : null;
  const key = editor.id === 'aux-editor'
    ? 'aux-' + (editor.dataset.kind || 'notes')
    : (chEl ? chEl.dataset.id : null);
  const sugg = await window.neo.spellSuggest(word);
  showSpellMenu(e.clientX, e.clientY, word, sugg, {
    replace: (s) => {
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(node, a); r.setEnd(node, b);
      sel.removeAllRanges(); sel.addRange(r);
      document.execCommand('insertText', false, s);
      if (key) spellScanEl(spellElFor(key), key);
    },
    learn: async () => {
      library.customWords = library.customWords || [];
      if (!library.customWords.includes(word)) library.customWords.push(word);
      await writeLibrary(library);
      await window.neo.spellLearn(word);
      // Learning also accepts equivalent Unicode spellings. Recheck cached
      // failures so those variants lose their underlines in every editor.
      spellCache.clear();
      spellCache.set(word, true);
      for (const k of [...spellScanned]) spellScanEl(spellElFor(k), k);
    }
  });
});

function showSpellMenu(x, y, word, suggestions, actions) {
  document.querySelector('.spell-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'spell-menu';
  if (suggestions.length) {
    for (const s of suggestions) {
      const btn = document.createElement('button');
      btn.textContent = s;
      btn.onclick = () => { menu.remove(); actions.replace(s); };
      menu.appendChild(btn);
    }
  } else {
    const none = document.createElement('button');
    none.textContent = t('No suggestions');
    none.disabled = true;
    menu.appendChild(none);
  }
  if (actions.learn) {
    const sep = document.createElement('div');
    sep.className = 'sm-sep';
    menu.appendChild(sep);
    const learn = document.createElement('button');
    learn.textContent = t('Add “{word}” to dictionary', { word });
    learn.onclick = () => { menu.remove(); actions.learn(); };
    menu.appendChild(learn);
  }
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - r.width - 10) + 'px';
  menu.style.top = Math.min(y + 4, window.innerHeight - r.height - 10) + 'px';
  const close = (ev) => {
    if (menu.contains(ev.target)) return;
    menu.remove();
    document.removeEventListener('mousedown', close, true);
  };
  document.addEventListener('mousedown', close, true);
}

let typewriterEnabled = false;
// The page needs empty room beneath its last line, or the caret can't be held
// at the centre once the end of the draft scrolls into view (body.typewriter
// deepens #paper's bottom margin; see styles.css). Only as much as the last
// page's own blank paper doesn't already give: a page that is mostly blank
// needs none, and a fixed 60vh left an empty scroll under it from line one.
function applyTypewriter() {
  document.body.classList.toggle('typewriter', typewriterEnabled);
  if (window.neo.typewriterState) window.neo.typewriterState(typewriterEnabled); // the Format menu's tick
  typewriterRoom();
}
function typewriterRoom() {
  const paper = $('#paper');
  const bodies = $$('#chapters .chapter-body');
  const last = bodies[bodies.length - 1];
  if (!typewriterEnabled || !last || paper.hidden) return;
  const line = parseFloat(getComputedStyle(last).lineHeight) || 30;
  // the last line must be able to rise to the writing height (45% of the
  // window, as in the selectionchange handler below)
  const below = paper.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom;
  const room = $('#paper-scroll').clientHeight - window.innerHeight * 0.45 - below + line;
  paper.style.setProperty('--typewriter-room', Math.max(120, Math.ceil(room)) + 'px');
}
new ResizeObserver(() => typewriterRoom()).observe($('#chapters'));
window.addEventListener('resize', typewriterRoom);
function toggleTypewriter() {
  typewriterEnabled = !typewriterEnabled;
  library.typewriter = typewriterEnabled;
  writeLibrary(library);
  applyTypewriter();
  toast(typewriterEnabled ? t('Typewriter scrolling ON — your line stays centered') : t('Typewriter scrolling off'));
}


// The page follows the caret only while the writer is typing or moving by
// keyboard: a click to think about a sentence leaves the screen exactly as
// it was. The caret has a band of a few lines to move in before the page
// glides (not snaps) to bring it back to the writing height.
let typewriterByKeyboard = false;
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = e.target;
  if (el && el.closest && el.closest('.chapter-body')) typewriterByKeyboard = true;
}, true);
document.addEventListener('mousedown', () => { typewriterByKeyboard = false; }, true);

document.addEventListener('selectionchange', () => {
  if (!typewriterEnabled || !book || currentTab !== 'manuscript' || !typewriterByKeyboard) return;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return;
  let el = sel.anchorNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  if (!el || !el.closest || !el.closest('.chapter-body')) return;
  requestAnimationFrame(() => {
    try {
      let rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect || (rect.top === 0 && rect.height === 0)) rect = el.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 30;
      const diff = rect.top - window.innerHeight * 0.45;
      // a band of about three lines around the writing height
      if (Math.abs(diff) <= lineHeight * 1.5) return;
      const scroller = $('#paper-scroll');
      scroller.scrollTo({ top: scroller.scrollTop + diff, behavior: scrollBehavior() });
    } catch { /* selection mid-mutation; skip this frame */ }
  });
});

/* ================================================================== */
/*  FOCUS MODE: dim everything but the sentence or paragraph           */
/* ================================================================== */
// Painted with the CSS Custom Highlight API (like search and spellcheck),
// so the manuscript DOM is never touched and nothing leaks into saved HTML.
// also the order ⌘⇧O steps through: off → paragraph → sentence → off
const FOCUS_LEVELS = ['off', 'paragraph', 'sentence'];
const FOCUS_LABELS = { off: tk('Focus mode off'), sentence: tk('Focus: sentence'), paragraph: tk('Focus: paragraph') };
let focusLevel = 'off';

// the View menu's ticks (focus level, page, brighter interface) follow the page
function reportViewState() {
  if (!window.neo.viewState || !library) return;
  window.neo.viewState({ focus: focusLevel, pageTheme: library.pageTheme || 'night', uiBright: document.body.classList.contains('bright') });
}

function applyFocus() {
  reportViewState();
  document.body.classList.toggle('focus-mode', focusLevel !== 'off');
  if (focusLevel === 'off') {
    if (window.CSS && CSS.highlights) CSS.highlights.delete('neo-focus');
  } else updateFocus();
}
function setFocus(level) {
  if (!FOCUS_LEVELS.includes(level)) return;
  focusLevel = level;
  library.focus = level;
  writeLibrary(library);
  applyFocus();
  toast(t(FOCUS_LABELS[level] || ''));
}
function cycleFocus() { setFocus(FOCUS_LEVELS[(FOCUS_LEVELS.indexOf(focusLevel) + 1) % FOCUS_LEVELS.length]); }

// the paragraph (direct <p> child of a chapter body) holding the caret
function focusParagraph() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  let el = sel.focusNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  if (!el || !el.closest) return null;
  const body = el.closest('.chapter-body');
  if (!body) return null;
  let p = el;
  while (p && p.parentElement !== body) p = p.parentElement;
  return p && p.tagName === 'P' ? p : null;
}

// caret position as a character offset into p.textContent
function caretOffsetIn(p) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(p);
  try { r.setEnd(sel.focusNode, sel.focusOffset); } catch { return 0; }
  return r.toString().length;
}

// character offsets within p → a DOM Range over its text nodes
function rangeFromOffsets(p, start, end) {
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  let pos = 0, n, startSet = false;
  while ((n = walker.nextNode())) {
    const len = n.textContent.length;
    if (!startSet && start <= pos + len) { r.setStart(n, start - pos); startSet = true; }
    if (startSet && end <= pos + len) { r.setEnd(n, end - pos); return r; }
    pos += len;
  }
  if (!startSet) return null;
  r.setEndAfter(p.lastChild || p);
  return r;
}

let focusSegmenter = null;
function sentenceRange(p) {
  const text = p.textContent;
  if (!text.trim()) return null;
  const at = caretOffsetIn(p);
  if (!focusSegmenter && window.Intl && Intl.Segmenter) {
    focusSegmenter = new Intl.Segmenter((library.spellLanguage || 'en').split('-')[0], { granularity: 'sentence' });
  }
  if (!focusSegmenter) return null;
  let hit = null, last = null;
  for (const seg of focusSegmenter.segment(text)) {
    last = seg;
    // caret at the very end of a sentence still belongs to it
    if (at >= seg.index && at <= seg.index + seg.segment.length) { hit = seg; if (at < seg.index + seg.segment.length) break; }
  }
  hit = hit || last;
  // trim trailing whitespace so the highlight hugs the words
  const start = hit.index;
  const end = hit.index + hit.segment.replace(/\s+$/, '').length;
  return rangeFromOffsets(p, start, Math.max(end, start));
}

function updateFocus() {
  if (focusLevel === 'off' || !book || currentTab !== 'manuscript') return;
  if (!window.Highlight || !window.CSS || !CSS.highlights) return;
  const p = focusParagraph();
  if (!p) return;   // caret elsewhere (title, panels): keep the last focus
  let r = null;
  if (isBreakPara(p)) r = null;
  else if (focusLevel === 'sentence') r = sentenceRange(p);
  else if (focusLevel === 'paragraph') { r = document.createRange(); r.selectNodeContents(p); }
  if (r) CSS.highlights.set('neo-focus', new Highlight(r));
  else CSS.highlights.delete('neo-focus');
  // highlights can't reach ::first-letter, so the drop cap gets a class
  // on its chapter body (a class on the body itself is never saved)
  document.querySelectorAll('.chapter-body.focus-cap').forEach((b) => b.classList.remove('focus-cap'));
  const body = p.parentElement;
  const first = body.querySelector('p[data-first]'); // the paragraph with the drop cap (openingPara)
  const firstText = first && document.createTreeWalker(first, NodeFilter.SHOW_TEXT).nextNode();
  if (r && firstText && r.comparePoint(firstText, 0) === 0) body.classList.add('focus-cap');
}
function isBreakPara(p) { return p.classList.contains('scene-break'); }

document.addEventListener('selectionchange', () => {
  if (focusLevel === 'off') return;
  requestAnimationFrame(() => { try { updateFocus(); } catch { /* mid-mutation */ } });
});
document.addEventListener('input', () => {
  if (focusLevel === 'off') return;
  requestAnimationFrame(() => { try { updateFocus(); } catch { /* mid-mutation */ } });
});

/* ================================================================== */
/*  GOALS, SPRINTS, AND THE CHART                                      */
/* ================================================================== */

let sprint = null;
let chartMode = 'words'; // what the 30-day chart plots: words or time

function chartModel(book, library, days, useTime) {
  const counts = (book && book.dailyCounts) || {};
  const times = (book && book.dailyTime) || {};
  const daily = days.map((d) => {
    if (useTime) return (times[d] || 0) / 60;
    return counts[d] ? Math.max(0, counts[d].end - counts[d].start) : 0;
  });
  const goal = useTime ? ((library && library.dailyTimeGoal) || 0) : ((book && book.wordGoal) || 0);
  const model = { daily, goal };
  if (useTime) {
    model.maxC = 1;
  } else {
    // cumulative: carry the last known total forward
    let last = 0;
    const firstKnown = days.find((d) => counts[d]);
    if (firstKnown) last = counts[firstKnown].start;
    model.cumulative = days.map((d) => {
      if (counts[d]) last = counts[d].end;
      return last;
    });
    model.maxC = Math.max(...model.cumulative, goal, 1);
  }
  model.maxD = Math.max(...daily, goal, useTime ? 1 : ((library && library.dailyGoal) || 0), 1);
  return model;
}

function statsChartSvg() {
  const W = 520, H = 200, PAD = 6;
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(writingDay(d));
  }
  const time = chartMode === 'time';
  const { daily, cumulative, goal, maxC, maxD } = chartModel(book, library, days, time);
  const bw = (W - PAD * 2) / 30;

  const bars = daily.map((v, i) => {
    const h = Math.round((v / maxD) * (H * 0.45));
    return `<rect x="${(PAD + i * bw).toFixed(1)}" y="${H - PAD - h}" width="${(bw - 2).toFixed(1)}" height="${h}" rx="1.5" fill="#3d5a4f"/>`;
  }).join('');
  const line = cumulative ? cumulative.map((v, i) => {
    const x = (PAD + i * bw + bw / 2).toFixed(1);
    const y = (H - PAD - (v / maxC) * (H - PAD * 2 - 20)).toFixed(1);
    return (i === 0 ? 'M' : 'L') + x + ',' + y;
  }).join(' ') : '';
  const goalLine = goal
    ? `<line x1="${PAD}" x2="${W - PAD}" y1="${(H - PAD - (goal / maxD) * (H - PAD * 2 - 20)).toFixed(1)}" y2="${(H - PAD - (goal / maxD) * (H - PAD * 2 - 20)).toFixed(1)}" stroke="#c9a86a" stroke-dasharray="5,4" stroke-width="1" opacity="0.7"/>`
    : '';
  const label = time ? t('Time written over the last 30 days') : t('Words written over the last 30 days');
  return `<svg id="stats-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escHtml(label).replace(/"/g, '&quot;')}">
    ${bars}
    ${line ? `<path d="${line}" fill="none" stroke="#c9a86a" stroke-width="2"/>` : ''}
    ${goalLine}
  </svg>
  <div class="stats-legend">
    <span>${t('30 days ago')}</span>
    <span class="sl-daily">▮ ${time ? t('daily time') : t('daily words')}</span>
    <span style="color:var(--accent)">${time ? t('daily goal') : t('total')}${goal ? ' · - - ' + t('goal') : ''}</span>
    <span>${t('today')}</span>
  </div>`;
}

/* ================================================================== */
/*  COVER ART SETTINGS (File → Cover Art…)                             */
/* ================================================================== */

// One key per provider. The brief and the painting always come from the
// same provider, so a writer only ever needs one account.
const COVER_PROVIDERS = {
  openai: { name: 'OpenAI', keyHint: 'sk-…', where: tk('platform.openai.com → API keys'), text: 'gpt-5-mini', image: 'gpt-image-1-mini', quality: true, cost: tk('a few cents a picture') }
};
// shown in the window, so translated when read
const providerWhere = (p) => t(p.where);
const providerCost = (p) => t(p.cost);
// Key formats change under us, so the only test is "one token, long enough" —
// the provider does the rest.
const looksLikeKey = (k) => /^\S{20,}$/.test(k);
const coverSettings = () => library.coverArt || {};
const coverProvider = () => (COVER_PROVIDERS[coverSettings().provider] ? coverSettings().provider : 'openai');

function openCoverArt() {
  const cs = coverSettings();
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  const provOptions = Object.entries(COVER_PROVIDERS).map(([id, p]) =>
    `<option value="${id}"${coverProvider() === id ? ' selected' : ''}>${p.name}</option>`).join('');
  bd.innerHTML = `
    <div class="modal" style="width:540px">
      <h2 style="font-size:17px">${t('Cover art')}</h2>
      <p>${t('Every book gets a cover on the shelf: an abstract with the title set in type. With an OpenAI key, NEO can also read a story once it passes {n} words and paint a cover from the text. Paintings stay on your shelf — exports never include them.', { n: PAINT_AT })}</p>
      <div class="stats-row">
        <select id="ca-provider" hidden>${provOptions}</select>
        <label class="st-check"><input id="ca-auto" type="checkbox"${cs.auto === false ? '' : ' checked'}/> ${t('paint at {n} words', { n: PAINT_AT })}</label>
      </div>
      <div class="stats-row st-covers">
        <label>${t('API key')} <input id="ca-key" type="password" autocomplete="off" spellcheck="false" style="width:300px"/></label>
      </div>
      <p class="soft" id="ca-note" style="margin:-6px 0 12px;font-size:12px"></p>
      <details class="st-advanced">
        <summary class="soft">${t('Models')}</summary>
        <div class="stats-row">
          <label>${t('Brief')} <input id="ca-tmodel" type="text" spellcheck="false"/></label>
          <label>${t('Paint')} <input id="ca-imodel" type="text" spellcheck="false"/></label>
          <label id="ca-quality-wrap">${t('Quality')}
            <select id="ca-quality">
              ${['low', 'medium', 'high'].map((q) => `<option value="${q}"${(cs.quality || 'medium') === q ? ' selected' : ''}>${({ low: t('low'), medium: t('medium'), high: t('high') })[q]}</option>`).join('')}
            </select>
          </label>
        </div>
        <p class="soft" style="font-size:12px;margin:0 0 6px">${t('Leave blank for NEO’s defaults. Names drift; if a provider retires one, NEO tries its own list before giving up.')}</p>
      </details>
      <div style="text-align:right;margin-top:14px">
        <button class="m-cancel btn-quiet" style="margin-right:10px">${t('Cancel')}</button>
        <button class="m-ok btn-gold">${t('Save')}</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const sel = bd.querySelector('#ca-provider');
  const key = bd.querySelector('#ca-key');
  const note = bd.querySelector('#ca-note');
  const models = (cs.models || {});
  // per-provider fields: key placeholder, stored model overrides, quality
  const showProvider = async () => {
    const id = sel.value, p = COVER_PROVIDERS[id];
    key.value = '';
    key.placeholder = t('{name} key ({hint})', { name: p.name, hint: p.keyHint });
    bd.querySelector('#ca-tmodel').value = (models[id] && models[id].text) || '';
    bd.querySelector('#ca-tmodel').placeholder = p.text;
    bd.querySelector('#ca-imodel').value = (models[id] && models[id].image) || '';
    bd.querySelector('#ca-imodel').placeholder = p.image;
    bd.querySelector('#ca-quality-wrap').style.display = p.quality ? '' : 'none';
    const has = await window.neo.hasSecret(id);
    if (sel.value !== id) return;
    note.textContent = has
      ? t('A {name} key is saved, encrypted, outside your library folder. Paste a new one to replace it, or type “{remove}” to forget it.', { name: p.name, remove: t('remove') })
      : t('Get a key at {where} ({cost}). It’s stored encrypted on this computer and only ever sent to {name}.', { where: providerWhere(p), cost: providerCost(p), name: p.name });
  };
  sel.onchange = showProvider;
  showProvider();
  const done = () => bd.remove();
  bd.querySelector('.m-cancel').onclick = done;
  bd.querySelector('.m-ok').onclick = async () => {
    const id = sel.value, p = COVER_PROVIDERS[id];
    const k = key.value.trim();
    if (k === 'remove' || k === t('remove')) await window.neo.setSecret(id, '');
    else if (k && !looksLikeKey(k)) { toast(t('That doesn’t look like an API key ({name} keys look like {hint}) — not saved', { name: p.name, hint: p.keyHint }), 6000); return; }
    else if (k) await window.neo.setSecret(id, k);
    models[id] = {
      text: bd.querySelector('#ca-tmodel').value.trim() || undefined,
      image: bd.querySelector('#ca-imodel').value.trim() || undefined
    };
    library.coverArt = {
      provider: id,
      auto: bd.querySelector('#ca-auto').checked,
      quality: bd.querySelector('#ca-quality').value,
      models
    };
    await writeLibrary(library);
    done();
    if (!(await window.neo.hasSecret(id))) toast(t('Saved. Add a {name} key to start painting.', { name: p.name }), 5000);
  };
  bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } });
  key.focus();
}

// An hour of the day as the writer's language says it: 1 am / 13 h / 13 Uhr,
// or 13:00 where the language's hour is a bare number
function hourLabel(h) {
  if (h === 0) return t('midnight');
  const loc = NeoI18n.getLocale();
  if (loc.startsWith('en')) {
    if (h === 12) return t('noon');
    return h < 12 ? t('{h} am', { h: String(h) }) : t('{h} pm', { h: String(h - 12) });
  }
  const at = new Date(2000, 0, 1, h);
  const hour = new Intl.DateTimeFormat(loc, { hour: 'numeric' }).format(at);
  return /^\d+$/.test(hour) ? new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit' }).format(at) : hour;
}

function openStats() {
  const hasBook = !!book;
  const today = hasBook ? (book.dailyCounts || {})[todayStr()] : null;
  const wordsToday = today ? Math.max(0, today.end - today.start) : 0;
  const total = hasBook ? bookWordCount() : 0;
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal" style="width:${hasBook ? 580 : 380}px">
      <h2 style="font-size:17px">${hasBook ? t('{title} — progress', { title: escHtml(book.title) }) : t('Goals')}</h2>
      ${hasBook ? `
      <div class="stats-nums">
        <div><div class="big">${fmtNum(total)}</div><div class="lbl">${t('total words')}</div></div>
        <div><div class="big">${fmtNum(wordsToday)}</div><div class="lbl">${t('today')}</div></div>
        <div><div class="big">${book.wordGoal ? Math.min(100, Math.round(total / book.wordGoal * 100)) + '%' : '—'}</div><div class="lbl">${t('of book goal')}</div></div>
        ${(library.dailyTimeGoal || 0) > 0 ? `<div><div class="big">${fmtClock(timeToday())}</div><div class="lbl">${t('time today')}</div></div>` : ''}
      </div>
      <div class="stats-row chart-toggle">
        <div id="chart-switch" class="seg" role="tablist" aria-label="${t('Chart')}">
          <button type="button" class="seg-btn${chartMode === 'words' ? ' on' : ''}" data-mode="words" role="tab" aria-selected="${chartMode === 'words'}">${t('Words')}</button>
          <button type="button" class="seg-btn${chartMode === 'time' ? ' on' : ''}" data-mode="time" role="tab" aria-selected="${chartMode === 'time'}">${t('Time')}</button>
        </div>
      </div>
      <div id="stats-chart-wrap">${statsChartSvg()}</div>` : ''}
      <div class="stats-row stats-goals" style="margin-top:${hasBook ? 18 : 6}px">
        <label>${t('Daily goal')} <input id="st-daily" type="number" min="0" value="${library.dailyGoal || ''}" placeholder="500"/></label>
        <label>${t('Daily time goal (minutes)')} <input id="st-timegoal" type="number" min="0" value="${library.dailyTimeGoal || ''}" placeholder="30"/></label>
        ${hasBook ? `<label>${t('Book goal')} <input id="st-book" type="number" min="0" value="${book.wordGoal || ''}" placeholder="80000"/></label>` : ''}
      </div>
      <div class="stats-row stats-goals">
        <label>${t('Day ends at')}
          <select id="st-dayends">
            ${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${(library.dayEndsAt || 0) === h ? ' selected' : ''}>${hourLabel(h)}</option>`).join('')}
          </select>
        </label>
      </div>
      ${hasBook ? `
      <div class="stats-row stats-goals">
        <label>${t('Sprint')} <input id="st-sprint" type="number" min="50" value="${sprint ? sprint.target : 500}"/> ${t('words')}</label>
        <button id="st-sprint-btn" class="btn-gold" style="align-self: center;">${sprint && !sprint.done ? t('End sprint') : t('Start sprint')}</button>
      </div>` : ''}
      <div style="text-align:right;margin-top:14px">
        <button class="m-ok btn-gold">${t('Done')}</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = async () => {
    library.dailyGoal = parseInt(bd.querySelector('#st-daily').value, 10) || 0;
    library.dailyTimeGoal = parseInt(bd.querySelector('#st-timegoal').value, 10) || 0;
    library.dayEndsAt = parseInt(bd.querySelector('#st-dayends').value, 10) || 0;
    if (hasBook) {
      book.wordGoal = parseInt(bd.querySelector('#st-book').value, 10) || 0;
      scheduleMetaSave();
    }
    await writeLibrary(library);
    bd.remove();
    ensureTimeTimer();
    if (hasBook) updateCounters();
  };
  bd.querySelector('.m-ok').onclick = close;
  // Esc closes from anywhere in the dialog (it takes focus on opening, so
  // the key reaches it even before a field is clicked); so does a click on
  // the dim page around it. Both keep the edits, like Done.
  bd.tabIndex = -1;
  bd.focus();
  bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  if (hasBook) {
    bd.querySelector('#st-sprint-btn').onclick = () => {
      if (sprint && !sprint.done) {
        const got = bookWordCount() - sprint.startCount;
        toast(t('Sprint ended — {n} words in {min} min', { n: got, min: Math.round((Date.now() - sprint.startTime) / 60000) }));
        sprint = null;
      } else {
        const target = parseInt(bd.querySelector('#st-sprint').value, 10) || 500;
        sprint = { target, startCount: bookWordCount(), startTime: Date.now(), done: false };
        toast(t('Sprint started — {n} words. Go.', { n: target }));
      }
      close();
    };
  }
  // the chart's Words / Time switch redraws only what it changes
  const sw = bd.querySelector('#chart-switch');
  if (sw) sw.onclick = (e) => {
    const btn = e.target.closest('[data-mode]');
    if (btn && btn.dataset.mode !== chartMode) {
      chartMode = btn.dataset.mode;
      for (const b of sw.querySelectorAll('.seg-btn')) {
        const on = b.dataset.mode === chartMode;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
      }
      bd.querySelector('#stats-chart-wrap').innerHTML = statsChartSvg();
    }
  };
}

$('#goal-counter').onclick = openStats;

/* ================================================================== */
/*  MENU: Help + fonts                                                 */
/* ================================================================== */

const DROPCAP_FONTS = {
  literary: '"Didot", "Bodoni 72", Georgia, serif',
  fantasy: '"Apple Chancery", "Snell Roundhand", cursive',
  scifi: 'Futura, "Avenir Next", "Helvetica Neue", sans-serif'
};
const BODY_FONTS = {
  'Georgia': 'Georgia, "Times New Roman", serif',
  'Palatino': '"Palatino", "Palatino Linotype", serif',
  'Baskerville': 'Baskerville, "Baskerville Old Face", Georgia, serif',
  'Hoefler Text': '"Hoefler Text", Georgia, serif',
  'Iowan Old Style': '"Iowan Old Style", Georgia, serif',
  'Cambria': 'Cambria, Georgia, serif',
  'Constantia': 'Constantia, Georgia, serif',
  // a sans-serif for those who write in one (bundled, so it's the same everywhere)
  'Jost': '"Jost", "Avenir Next", "Helvetica Neue", Arial, sans-serif',
  // iA Writer's own face, bundled too (SIL Open Font License)
  'iA Writer Quattro': '"iA Writer Quattro", "Helvetica Neue", Arial, sans-serif'
};

// Hoefler Text and Iowan Old Style ship only with macOS; elsewhere they
// would fall back to Georgia, so offer the fonts Windows actually has.
// Keep in step with bodyFonts in main.js.
const BODY_FONT_CHOICES = IS_MAC
  ? ['Georgia', 'Palatino', 'Baskerville', 'Hoefler Text', 'Iowan Old Style', 'Jost', 'iA Writer Quattro']
  : ['Georgia', 'Palatino', 'Baskerville', 'Cambria', 'Constantia', 'Jost', 'iA Writer Quattro'];

function applyFonts() {
  const f = library.fonts || {};
  if (f.body && typeof f.body === 'string') {
    document.documentElement.style.setProperty('--body-font', bodyFontStack(f.body));
  }
  if (f.dropcap && DROPCAP_FONTS[f.dropcap]) {
    document.documentElement.style.setProperty('--dropcap-font', DROPCAP_FONTS[f.dropcap]);
  }
  document.body.classList.toggle('no-dropcap', f.dropcap === 'none');
  document.body.classList.toggle('night', library.pageTheme === 'night');
  // Light: the paper page in a light room, the whole app with it
  document.body.classList.toggle('light', library.pageTheme === 'light');
  // the system's "Increase contrast" turns it on too, until the writer
  // chooses in the View menu
  document.body.classList.toggle('bright', library.uiBright === undefined ? SYSTEM_CONTRAST.matches : !!library.uiBright);
  reportViewState();
  // View → Interface Size: everything but the page
  const uiZoom = [1, 1.25, 1.5, 2, 2.5, 3].includes(library.uiZoom) ? library.uiZoom : 1;
  document.documentElement.style.setProperty('--ui-zoom', uiZoom);
  document.documentElement.classList.toggle('ui-zoomed', uiZoom > 1);
  if (window.neo.uiZoomState) window.neo.uiZoomState(uiZoom);
  const size = Math.min(22, Math.max(14, library.editorFontSize || 17));
  document.documentElement.style.setProperty('--editor-size', size + 'px');
  const zoom = Math.min(3, Math.max(0.75, library.pageZoom || 1));
  document.documentElement.style.setProperty('--page-zoom', zoom);
  updateZoomDisplay();
}

// A built-in choice, or a font the writer picked from their own computer.
// A library opened where that font is missing simply reads in Georgia.
function bodyFontStack(name) {
  return Object.hasOwn(BODY_FONTS, name) ? BODY_FONTS[name] : `"${name.replace(/["\\]/g, '')}", Georgia, serif`;
}

// Format → Body Font → Other Font…: every font installed on this computer,
// each shown in its own face. The panel sits top right, off the undimmed
// page, so hovering previews the font on the writer's own words. Resolves
// to a family name, or null on cancel.
async function pickLocalFont() {
  let families = [];
  try {
    // one entry per style; names starting with "." are the system's hidden fonts
    const faces = await window.queryLocalFonts();
    families = [...new Set(faces.map((f) => f.family))]
      .filter((n) => n && !n.startsWith('.'))
      .sort((a, b) => a.localeCompare(b));
  } catch {}
  if (!families.length) { toast(t('NEO couldn’t read the fonts on this computer')); return null; }
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop font-picker';
    bd.innerHTML = `
      <div class="modal" style="width:320px">
        <h2 style="font-size:16px">${t('Other font')}</h2>
        <p class="font-now" style="font-size:13px;color:var(--muted);margin-bottom:10px"></p>
        <input type="text" spellcheck="false" placeholder="${t('Search {n} installed fonts', { n: families.length })}" />
        <div class="font-list"></div>
        <div style="text-align:right;margin-top:14px">
          <button class="m-cancel btn-quiet">${t('Cancel')}</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    const input = bd.querySelector('input');
    const list = bd.querySelector('.font-list');
    const current = (library.fonts || {}).body || 'Georgia';
    bd.querySelector('.font-now').textContent = t('Now: {font}', { font: current });
    const done = (val) => { bd.remove(); resolve(val); };
    const render = () => {
      const q = input.value.trim().toLowerCase();
      list.innerHTML = '';
      for (const name of families) {
        if (q && !name.toLowerCase().includes(q)) continue;
        const b = document.createElement('button');
        b.className = 'fr-font' + (name === current ? ' sel' : '');
        b.textContent = name;
        b.style.fontFamily = bodyFontStack(name);
        b.onmouseenter = () => { document.documentElement.style.setProperty('--body-font', bodyFontStack(name)); };
        b.onclick = () => done(name);
        list.appendChild(b);
      }
    };
    list.onmouseleave = applyFonts; // back to the saved font
    input.oninput = render;
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && list.firstChild) done(list.firstChild.textContent);
      if (e.key === 'Escape') { e.stopPropagation(); done(null); } // as in askInput
    };
    bd.querySelector('.m-cancel').onclick = () => done(null);
    render();
    const sel = list.querySelector('.sel');
    if (sel) sel.scrollIntoView({ block: 'center' });
    input.focus();
  });
}

// Pinch (trackpad) or Ctrl+scroll: page and text zoom together.
// A pinch arrives as a wheel event with ctrlKey set.
let zoomSaveTimer = null;
function updateZoomDisplay() {
  const el = $('#zoom-level');
  if (el) el.textContent = Math.round((library.pageZoom || 1) * 100) + '%';
}
// Zooming or resizing the text reflows the whole book, and the same scroll
// offset lands somewhere else. Pin a spot in the text first: the caret if
// it's on screen, otherwise the point being pinched, otherwise the middle
// of the page. Then scroll it back to where it was.
function keepReadingPlace(change, at) {
  const sc = $('#paper-scroll');
  if (!sc || $('#editor-view').hidden) { change(); return; }
  const box = sc.getBoundingClientRect();
  const topOf = (r) => {
    const rect = r.getBoundingClientRect();
    if (rect.height) return rect.top;
    const el = r.startContainer.nodeType === Node.ELEMENT_NODE ? r.startContainer : r.startContainer.parentElement;
    return el ? el.getBoundingClientRect().top : null; // an empty line has no text to measure
  };
  let anchor = null;
  const sel = window.getSelection();
  if (!at && sel.rangeCount && sc.contains(sel.anchorNode)) {
    const caret = sel.getRangeAt(0).cloneRange();
    caret.collapse(true);
    const y = topOf(caret);
    if (y !== null && y >= box.top && y <= box.bottom) anchor = caret;
  }
  if (!anchor) {
    const x = Math.min(box.right - 1, Math.max(box.left + 1, at ? at.x : box.left + box.width / 2));
    const y = Math.min(box.bottom - 1, Math.max(box.top + 1, at ? at.y : box.top + box.height / 2));
    const r = document.caretRangeFromPoint(x, y);
    if (r && sc.contains(r.startContainer)) anchor = r;
  }
  const before = anchor && topOf(anchor);
  change();
  if (before === null || before === undefined) return;
  const after = topOf(anchor); // reads the new layout
  if (after !== null) sc.scrollTop += after - before;
}

function setPageZoom(next, at) {
  // up to 300%: on a large monitor 160% still read small. The page itself
  // never grows past the window (max-width in styles.css), only the type does.
  next = Math.min(3, Math.max(0.75, next));
  if (next === (library.pageZoom || 1)) return;
  library.pageZoom = next;
  keepReadingPlace(() => document.documentElement.style.setProperty('--page-zoom', next), at);
  updateZoomDisplay();
  clearTimeout(zoomSaveTimer);
  zoomSaveTimer = setTimeout(() => { writeLibrary(library); }, 600);
}
$('#editor-view').addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setPageZoom((library.pageZoom || 1) * Math.exp(-e.deltaY * 0.005), { x: e.clientX, y: e.clientY });
}, { passive: false });

// zoom control in the bottom bar: buttons, click-to-reset, and scroll
$('#zoom-in').onclick = () => setPageZoom((library.pageZoom || 1) + 0.1);
$('#zoom-out').onclick = () => setPageZoom((library.pageZoom || 1) - 0.1);
$('#zoom-level').onclick = () => setPageZoom(1);
$('#zoom-control').addEventListener('wheel', (e) => {
  e.preventDefault();
  setPageZoom((library.pageZoom || 1) * Math.exp(-e.deltaY * 0.002));
}, { passive: false });

// Format → Align Paragraph: applies to every paragraph the selection touches
function applyAlign(value) {
  if (!book || currentTab !== 'manuscript') { toast(t('Click into a paragraph first')); return; }
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  let el = r.startContainer;
  if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const body = el && el.closest ? el.closest('.chapter-body') : null;
  if (!body) { toast(t('Click into a paragraph first')); return; }
  const chId = body.closest('.chapter').dataset.id;
  const ps = [...body.querySelectorAll('p')].filter(
    (p) => r.intersectsNode(p) && !p.classList.contains('scene-break')
  );
  for (const p of ps) {
    if (value === 'left') p.style.removeProperty('text-align');
    else p.style.textAlign = value;
    if (!p.getAttribute('style')) p.removeAttribute('style');
  }
  syncChapter(body, chId);
}

// Menu accelerators and editor shortcuts, plus NEO's distinct writing gestures.
// Routine text entry, cursor movement and dialog controls are intentionally omitted.
function shortcutSections() {
  return [
    { title: tk('Writing'), rows: [
      [tk('Enter ×2'), tk('Insert a section break')],
      [tk('Enter ×3'), tk('Start a new chapter')],
      [K('⇧Enter', 'Shift+Enter'), tk('A paragraph with no indent'), tk('Again for another; Enter goes back to prose.')],
      [K('⌘⇧Enter', 'Ctrl+Shift+Enter'), tk('Start or continue a poetry paragraph'), tk('Also works from a chapter heading.')],
      [KPH, tk('Insert a placeholder note')],
      [KDA, tk('Move selected text to Darlings')]
    ] },
    { title: tk('Formatting'), rows: [
      [['*…*', '**…**', '***…***'], tk('Italic, bold, the Markdown way'), tk('Typed around a word (or pasted). Undo right after keeps the asterisks. Format → Markdown Emphasis turns it off.')],
      [K('⌘⇧L', 'Ctrl+Shift+L'), tk('Align paragraph left')],
      [K('⌘⇧C', 'Ctrl+Shift+C'), tk('Center paragraph')],
      [K('⌘⇧R', 'Ctrl+Shift+R'), tk('Align paragraph right')],
      [K('⌘⇧J', 'Ctrl+Shift+J'), tk('Justify paragraph')],
      [K('⌘+', 'Ctrl++'), tk('Larger text')],
      [K('⌘−', 'Ctrl+−'), tk('Smaller text')],
      [K('⌘0', 'Ctrl+0'), tk('Reset text size and page zoom')]
    ] },
    { title: tk('Outline'), rows: [
      ['Tab', tk('Turn a chapter into a section'), tk('Only empty chapters after the first chapter.')],
      [K('⇧Tab', 'Shift+Tab'), tk('Turn a section into a chapter')]
    ] },
    { title: tk('Editing'), rows: [
      [K('⌘⌥⇧V', 'Ctrl+Shift+V'), tk('Paste and match style')],
      [K('⌘F', 'Ctrl+F'), tk('Find and replace')],
      [K('⌘;', 'Ctrl+;'), tk('Toggle spellcheck pass')]
    ] },
    { title: tk('App & files'), rows: [
      [KHELP, tk('Keyboard shortcuts')],
      [K('⌘,', 'Ctrl+,'), tk('Goals and writing sprints')],
      [K('⌘⇧I', 'Ctrl+Shift+I'), tk('Import manuscripts')],
      [K('⌘E', 'Ctrl+E'), tk('Email a draft to yourself')]
    ] },
    { title: tk('View & window'), rows: [
      [[K('⌘⇧F', 'Ctrl+Shift+F'), K('⌘Enter', 'Ctrl+Enter')], tk('Toggle full screen')],
      [K('⌘⇧T', 'Ctrl+Shift+T'), tk('Toggle typewriter scrolling')],
      [K('⌘⇧O', 'Ctrl+Shift+O'), tk('Cycle focus mode'), tk('Off → paragraph → sentence → off.')],
      [K('⌥⌘↓', 'Ctrl+Alt+↓'), tk('Go to the next chapter')],
      [K('⌥⌘↑', 'Ctrl+Alt+↑'), tk('Go to the previous chapter')],
      [['F6', K('⌃Tab', 'Ctrl+Tab')], tk('Move between the page, the chapters, the notes and the bottom bar'), tk('Add Shift to go back. Esc returns to the page. On the shelf: the books, then the header.')],
      ...(IS_MAC ? [
        ['⌘H', tk('Hide NEO')],
        ['⌘⌥H', tk('Hide other apps')]
      ] : [])
    ] },
    // only for writers who turned them on (View → Vim Keys)
    ...(vimEnabled ? [{ title: tk('Vim keys'), rows: [
      ['Esc', tk('Stop writing and move around the page'), tk('i, a or o goes back to writing.')],
      ['h j k l', tk('Left, down, up, right')],
      ['w b e', tk('Next word, previous word, end of word')],
      ['0 $', tk('Start or end of the line')],
      ['( )', tk('Previous or next sentence')],
      ['{ }', tk('Previous or next paragraph')],
      ['gg G', tk('Top or end of the chapter')],
      ['[[ ]]', tk('Previous or next chapter')],
      [K('⌃d ⌃u', 'Ctrl+d Ctrl+u'), tk('Down or up half a screen')],
      ['i a I A', tk('Write here, after, at the start or end of the line')],
      ['o O', tk('Write in a new paragraph below or above')],
      ['v', tk('Select'), tk('Move to stretch it, then y to copy or d to cut.')],
      ['x', tk('Delete the letter under the caret')],
      ['/', tk('Find')]
    ] }] : [])
  ];
}

function showHelp() {
  const existing = $('#keyboard-shortcuts');
  if (existing) { existing.querySelector('.shortcuts-content').focus(); return; }
  const previousFocus = document.activeElement;
  const selection = window.getSelection();
  const previousRange = previousFocus.isContentEditable && selection.rangeCount
    ? selection.getRangeAt(0).cloneRange() : null;
  const bd = document.createElement('div');
  bd.id = 'keyboard-shortcuts';
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal shortcuts-modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
      <header class="shortcuts-header">
        <h2 id="shortcuts-title">${t('Keyboard shortcuts')}</h2>
      </header>
      <div class="shortcuts-content" tabindex="0" role="region" aria-label="${t('Shortcut reference')}"></div>
      <footer class="shortcuts-footer" role="none">
        <span>${t(K(tk('⌘ Command · ⇧ Shift · ⌥ Option · ⌃ Control'), tk('Ctrl Control · Shift · Alt')))}</span>
        <button class="m-ok btn-gold">${t('Done')}</button>
      </footer>
    </div>`;
  const keyName = (key) => key.replaceAll('⌘', t('Command') + ' ').replaceAll('⇧', t('Shift') + ' ')
    .replaceAll('⌥', t('Option') + ' ').replaceAll('⌃', t('Control') + ' ').replaceAll('−', '-');
  const content = bd.querySelector('.shortcuts-content');
  const sections = shortcutSections().map((section, index) => `
    <section class="shortcuts-section" style="order:${index}"><h3>${escHtml(t(section.title))}</h3><dl>${section.rows.map(([keys, label, detail]) => `
      <div class="shortcut-row">
        <dt>${escHtml(t(label))}${detail ? `<small>${escHtml(t(detail))}</small>` : ''}</dt>
        <dd>${[keys].flat().map((key) => t(key)).map((key) => `<kbd aria-label="${escHtml(keyName(key))}">${escHtml(key)}</kbd>`).join(`<span class="shortcut-or">${t('or')}</span>`)}</dd>
      </div>`).join('')}</dl></section>`);
  // Keep Writing and Formatting first, with similar amounts of content per column.
  // Vim keys, there only while they're on, runs across both below them.
  content.innerHTML = [[0, 2, 4, 5], [1, 3]].map((column) => `<div class="shortcuts-column">${
    column.map((index) => sections[index]).join('')
  }</div>`).join('') + (sections[6] ? `<div class="shortcuts-wide">${sections[6]}</div>` : '');
  const close = () => {
    document.removeEventListener('keydown', handleKeyDown, true);
    bd.remove();
    if (previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    if (previousRange && previousRange.startContainer.isConnected && previousRange.endContainer.isConnected) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
  };
  bd.querySelector('.m-ok').onclick = close;
  const handleKeyDown = (e) => {
    e.stopPropagation(); // The editor must not handle keys while reading help.
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const controls = [content, bd.querySelector('.m-ok')];
      const index = controls.indexOf(document.activeElement);
      e.preventDefault();
      controls[(index + (e.shiftKey ? controls.length - 1 : 1)) % controls.length].focus();
    }
  };
  document.addEventListener('keydown', handleKeyDown, true);
  document.body.appendChild(bd);
  content.focus();
}

/* ================================================================== */
/*  EXPORT + EMAIL                                                     */
/* ================================================================== */

// letters of every script stay (a Russian title keeps its name), only
// punctuation goes
function safeName(s) {
  const clean = (x) => x.replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, '').trim().replace(/\s+/g, '-');
  return clean(s || '') || clean(t('Untitled'));
}

// Every paragraph is rebuilt from its text runs, so exports carry only
// author-meaningful markup: text, bold, italic, alignment, scene breaks.
// Stray spans, inline styles, trailing <br>s, and no-break spaces all
// stop at this door.
function parasFromHtml(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html || '';
  // an unwritten outline section is a ghost paragraph plus the scene break
  // NEO planted for it; neither belongs in a book
  holder.querySelectorAll('p.ghost[data-sec-id]').forEach((g) => {
    const brk = holder.querySelector(`p.scene-break[data-sec-brk="${g.dataset.secId}"]`);
    if (brk) brk.remove();
  });
  holder.querySelectorAll('.darling-anchor, .ph-mark, .ghost').forEach((n) => n.remove());
  return [...holder.querySelectorAll('p')].map((p) => {
    const sceneBreak = p.classList.contains('scene-break');
    const poetry = p.classList.contains('poetry');
    const flush = !poetry && p.classList.contains('flush');
    const align = (p.style && p.style.textAlign) || '';
    const runs = paraRuns(p.innerHTML, true).filter((r) => r.text);
    const inner = runs.map((r) => {
      let t = escHtml(r.text);
      if (r.i) t = '<i>' + t + '</i>';
      if (r.b) t = '<b>' + t + '</b>';
      return t;
    }).join('');
    return {
      sceneBreak,
      poetry,
      flush,
      text: p.innerText.replace(/\u00a0/g, ' ').trim(),
      runs,
      align,
      html: `<p${poetry ? ' class="poetry"' : flush ? ' class="flush"' : ''}${align ? ` style="text-align:${align}"` : ''}>${inner}</p>`
    };
  }).filter((p) => p.sceneBreak || p.text);
}

// The book's entries as the builders lay them out. Chapters, a prologue and
// an epilogue are prose under their headings; a part is a page of its own
// (its first line its title); the pages a book carries are set the way books
// set them, and one left blank stays out. `toc` is the table of contents.
// The Contents entry, when the book has one, is where a printed contents
// page goes: what comes before it is the front of the book. Without one,
// the front is the copyright, dedication and epigraph that open the book.
const FRONT_PAGES = ['copyright', 'dedication', 'epigraph'];
function exportChapters() {
  const solo = soloStory();
  const sections = [];
  const toc = [];
  const push = (sec) => { sec.num = sections.length + 1; sections.push(sec); return sec; };
  let parts = 0;
  let inPart = false;
  let contentsAt = -1;
  for (const chId of book.chapterOrder) {
    const kind = chapterKind(chId);
    if (kind === 'part') { parts += 1; inPart = true; } else if (BACK_KINDS.includes(kind)) inPart = false;
    if (kind === 'contents') { if (contentsAt < 0) contentsAt = sections.length; continue; }
    const el = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
    const paras = parasFromHtml(el ? el.innerHTML : (chapterHTML[chId] || ''));
    if (FRONT_PAGES.includes(kind)) {
      if (paras.length) push({ kind, heading: '', label: kindName(kind), level: 0, paras });
      continue;
    }
    if (kind === 'acknowledgments' || kind === 'about') {
      if (!paras.length) continue;
      const sec = push({ kind, heading: kindName(kind), level: 0, paras });
      toc.push({ label: sec.heading, num: sec.num, level: 0, type: 'page' });
      continue;
    }
    if (kind === 'part') {
      // the page's first line is the part's title; what follows, a quote or a verse
      const titled = !!(paras[0] && !paras[0].sceneBreak && !isAttribution(paras[0]));
      const partTitle = titled ? paras[0].text : '';
      const sec = push({ kind: 'part', heading: partLabel(parts), partTitle, level: 0, paras: titled ? paras.slice(1) : paras });
      toc.push({ label: partTitle ? sec.heading + ': ' + partTitle : sec.heading, num: sec.num, level: 0, type: 'part' });
      continue;
    }
    // the story: chapterless stories export as continuous text
    const heading = chId === solo ? '' : chapterHeading(chId);
    const level = inPart ? 1 : 0;
    const sec = push({ kind: 'chapter', heading, paras, role: chapterRole(chId) || '', level, chId });
    toc.push({ label: heading || book.title, num: sec.num, level, type: 'chapter' });
  }
  if (contentsAt >= 0) sections.forEach((sec, i) => { sec.front = i < contentsAt; });
  else for (const sec of sections) { if (!FRONT_PAGES.includes(sec.kind)) break; sec.front = true; }
  return { sections, toc, contents: contentsAt >= 0 };
}

// The open book, packaged for the builders. Every builder takes an optional
// data object in this shape, good for anthologies.
function bookExportData() {
  // an EPUB wants a real UUID as its identifier; the book gets one the first
  // time it's exported and keeps it, so re-exports are the same book
  if (!book.uuid) {
    book.uuid = crypto.randomUUID();
    saveMeta();
  }
  const { sections, toc, contents } = exportChapters();
  return {
    id: book.id,
    uuid: book.uuid,
    title: book.title,
    subtitle: book.subtitle,
    author: book.author || t('Anonymous'), // the screen says so; the files should too
    language: writingLanguage(),
    coverSeed: book.coverSeed,
    coverImage: book.coverImage || null,
    sections,
    toc,
    // a printed contents page only where the writer put one; it lists the
    // chapters too (a book of books lists its titles instead)
    contents,
    contentsChapters: true
  };
}

// One chapter, on its own: the book's title page, then that chapter, headed
// as it is in the book (Chapter 7 — Holston). No cover image in a web page
// or PDF; an EPUB keeps the book's cover, since e-readers expect one.
function chapterExportData(chId) {
  const d = bookExportData();
  const sec = d.sections.find((s) => s.kind === 'chapter' && s.chId === chId);
  if (!sec) return null;
  Object.assign(sec, { num: 1, level: 0, front: false });
  return {
    ...d,
    sections: [sec],
    toc: [{ label: sec.heading || d.title, num: 1, level: 0, type: 'chapter' }],
    contents: false,
    chapterOnly: sec.heading || chapterName(chId)
  };
}

// a heading as plain text: a part's name with its title
const plainHeading = (ch) => (ch.partTitle ? `${ch.heading}: ${ch.partTitle}` : ch.heading);

function buildTxt(data) {
  const d = data || bookExportData();
  let out = `${d.title.toUpperCase()}\n`;
  if (d.subtitle) out += `${d.subtitle}\n`;
  out += t('by {author}', { author: d.author }) + '\n\n\n';
  for (const ch of d.sections) {
    if (ch.heading) out += `${plainHeading(ch).toUpperCase()}\n\n`;
    for (const p of ch.paras) out += p.sceneBreak ? '\n***\n\n' : (p.poetry ? '    ' : '') + p.text + '\n\n';
    out += '\n';
  }
  return out;
}

function buildMd(data) {
  const d = data || bookExportData();
  // a title like "Wool *Omnibus*" must not turn into markup (idea: nejcc, #70)
  const mdMeta = (s) => String(s || '').replace(/([\\`*_\[\]#<>])/g, '\\$1');
  // wrap a run in emphasis markers, keeping boundary spaces outside them
  const mdRun = (r) => {
    let t = r.text.replace(/([\\*_`])/g, '\\$1');
    const mark = r.b && r.i ? '***' : r.b ? '**' : r.i ? '*' : '';
    if (!mark) return t;
    const lead = t.match(/^\s*/)[0];
    const trail = t.match(/\s*$/)[0];
    const core = t.slice(lead.length, t.length - trail.length);
    return core ? lead + mark + core + mark + trail : t;
  };
  let out = `# ${mdMeta(d.title)}\n\n`;
  if (d.subtitle) out += `*${mdMeta(d.subtitle)}*\n\n`;
  out += `**${t('by {author}', { author: mdMeta(d.author) })}**\n\n`;
  for (const ch of d.sections) {
    if (ch.heading) out += `\n## ${mdMeta(plainHeading(ch))}\n\n`;
    for (const p of ch.paras) {
      out += p.sceneBreak ? '\n***\n\n' : (p.poetry ? '> ' : '') + p.runs.map(mdRun).join('') + '\n\n';
    }
  }
  return out;
}

// The Web Page and PDF read in the page's own typeface. A face NEO ships
// (the @font-face rules in styles.css, the body fonts on Linux) travels
// inside the file, so the PDF matches the page on any machine; a font the
// computer has goes by name, with the same fallbacks as the page.
const exportBodyFont = () => (getComputedStyle(document.documentElement).getPropertyValue('--body-font').trim() || 'Georgia, serif').replace(/[<>{};]/g, '');
// the drop cap too: its face is the page's, bundled or the computer's
const exportDropCapFont = () => (getComputedStyle(document.documentElement).getPropertyValue('--dropcap-font').trim() || 'Georgia, serif').replace(/[<>{};]/g, '');
const firstFamily = (stack) => stack.split(',')[0].trim().replace(/^["']|["']$/g, '');
async function exportFontFaces(d) {
  const family = firstFamily(exportBodyFont());
  // the drop cap sets one letter, upright and regular
  const cap = (library.fonts || {}).dropcap === 'none' ? '' : firstFamily(exportDropCapFont());
  const text = d.sections.map((ch) => ch.paras.map((p) => p.html).join('')).join('');
  // (the title is always bold; a dedication, an epigraph, a part's lines
  // and a title's subtitle are set in italic)
  const italic = !!d.subtitle || /<i[\s>]/.test(text)
    || d.sections.some((ch) => ['dedication', 'epigraph', 'part'].includes(ch.kind) || ch.subtitle);
  const boldItalic = italic && /<b[\s>]/.test(text);
  let css = '';
  for (const sheet of document.styleSheets) {
    let rules = [];
    try { rules = [...sheet.cssRules]; } catch { continue; }
    for (const r of rules) {
      if (!(r instanceof CSSFontFaceRule)) continue;
      const name = r.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
      const style = r.style.getPropertyValue('font-style') || 'normal';
      const weight = r.style.getPropertyValue('font-weight') || '400';
      const forBody = name === family && !(style === 'italic' && !(parseInt(weight, 10) >= 600 ? boldItalic : italic));
      const forCap = name === cap && style === 'normal' && parseInt(weight, 10) === 400;
      if (!forBody && !forCap) continue;
      const src = r.style.getPropertyValue('src').match(/url\(["']?([^"')]+)["']?\)\s*(format\([^)]*\))?/);
      if (!src) continue;
      // a Russian face keeps its range and its measures, or it would stand
      // in for the Latin one at the Latin one's size
      const fit = ['unicode-range', 'size-adjust', 'ascent-override', 'descent-override', 'line-gap-override']
        .map((k) => r.style.getPropertyValue(k) && ` ${k}: ${r.style.getPropertyValue(k)};`).filter(Boolean).join('');
      try {
        const bytes = new Uint8Array(await (await fetch(new URL(src[1], sheet.href || location.href))).arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        const ext = src[1].split('.').pop().toLowerCase();
        css += `@font-face { font-family: '${name}'; src: url(data:font/${ext};base64,${btoa(bin)}) ${src[2] || ''}; font-weight: ${weight}; font-style: ${style};${fit} }\n`;
      } catch { /* the name still stands, with its fallbacks */ }
    }
  }
  return css;
}

// The pages of a book that aren't chapters, set the way books set them.
// A line that opens with a dash says who said the lines above it.
const isAttribution = (p) => /^(?:[—–]|--?\s)/.test(p.text || '');
// a section's heading level follows the contents: a part, the titles in
// it, their chapters (a single book's chapters are all level 0)
const headTag = (ch) => 'h' + Math.min(6, 2 + (ch.level || 0));

function buildHtml(data, opts = {}) {
  const d = data || bookExportData();
  const total = d.sections.filter((ch) => (ch.kind || 'chapter') === 'chapter')
    .reduce((s, ch) => s + ch.paras.reduce((n, p) => n + countWords(p.text || ''), 0), 0);
  const stamp = new Date().toLocaleString(NeoI18n.getLocale());
  // a chapter's text: only its opening paragraph gets the enlarged initial,
  // scene breaks resume ordinary body text
  const prose = (paras, initial) => {
    let first = initial;
    let afterBreak = false; // a story's line of speech after *** keeps its indent
    return paras.map((p) => {
      if (p.sceneBreak) { afterBreak = initial; return '<p class="brk">***</p>'; }
      if (p.poetry) { afterBreak = false; return p.html; }
      let html = p.html;
      if (first || afterBreak) {
        const h = document.createElement('div');
        h.innerHTML = html;
        if (h.firstElementChild) {
          if (first) h.firstElementChild.classList.add('first');
          if (OPENING_DASH.test(h.textContent)) h.firstElementChild.classList.add('dialogue');
          html = h.innerHTML;
        }
      }
      first = false;
      afterBreak = false;
      return html;
    }).join('\n');
  };
  // a page's lines, each set on its own
  const lines = (paras, attrs = true) => paras.map((p) => {
    if (p.sceneBreak) return '<p class="brk">***</p>';
    const cls = [attrs && isAttribution(p) ? 'attr' : '', p.poetry ? 'poetry' : ''].filter(Boolean).join(' ');
    return `<p${cls ? ` class="${cls}"` : ''}${p.align ? ` style="text-align:${p.align}"` : ''}>${p.html.replace(/^<p[^>]*>|<\/p>$/g, '')}</p>`;
  }).join('\n');
  const sectionHtml = (ch) => {
    const id = 's' + ch.num;
    const h = headTag(ch);
    const kind = ch.kind || 'chapter';
    if (kind === 'copyright' || kind === 'dedication' || kind === 'epigraph') {
      return `
    <section class="page ${kind}" id="${id}"><div class="pg-in">${lines(ch.paras, kind !== 'copyright')}</div></section>`;
    }
    if (kind === 'part') {
      // the separator is there for the PDF's bookmarks ("Part I: Title"),
      // not for the eye
      return `
    <section class="page part" id="${id}">
      <${h} class="hd"><span class="pl">${escHtml(ch.heading)}</span>${ch.partTitle ? `<span class="sep">: </span><span class="pt">${escHtml(ch.partTitle)}</span>` : ''}</${h}>
      ${lines(ch.paras)}
    </section>`;
    }
    if (kind === 'opener') {
      return `
    <section class="page opener" id="${id}">
      <${h} class="hd">${escHtml(ch.heading)}</${h}>
      ${ch.subtitle ? `<p class="sub">${escHtml(ch.subtitle)}</p>` : ''}
      ${ch.byline ? `<p class="byline">${escHtml(ch.byline)}</p>` : ''}
    </section>`;
    }
    const back = kind === 'acknowledgments' || kind === 'about';
    return `
    <section class="chapter${back ? ' backpage' : ''}" id="${id}">
      ${ch.heading ? `<${h} class="hd">${escHtml(ch.heading)}</${h}>` : ''}
      ${ch.byline ? `<p class="byline">${escHtml(ch.byline)}</p>` : ''}
      ${prose(ch.paras, !back)}
    </section>`;
  };
  // Contents: the parts, the titles and the pages at the back. The page
  // numbers are filled in by the PDF printer (main.js), which prints the
  // book once to learn where everything landed.
  const contents = d.contents && d.toc && d.toc.length ? `
    <nav class="contents">
      <h2 class="hd">${escHtml(t('Contents'))}</h2>
      <ol>${d.toc.filter((e) => d.contentsChapters || e.type !== 'chapter').map((e) => `
        <li class="lv${e.level} t-${e.type}"><a href="#s${e.num}"><span class="toc-t">${escHtml(e.label)}</span><span class="toc-pg" data-for="s${e.num}"></span></a></li>`).join('')}
      </ol>
    </nav>` : '';
  // the contents follow the pages at the front of the book
  let body = '';
  let placed = !contents;
  for (const ch of d.sections) {
    if (!placed && !ch.front) { body += contents; placed = true; }
    body += sectionHtml(ch);
  }
  if (!placed) body += contents;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escHtml(d.title)}</title>
<style>
  ${opts.fonts || ''}
  body { font-family: ${exportBodyFont()}; color: #1c1c1c; max-width: 620px; margin: 40px auto; line-height: 1.7; font-size: 13pt; }
  .coverpage { text-align: center; margin: 0 0 40px; page-break-after: always; }
  .coverpage img { display: block; margin: 0 auto; width: 100%; max-width: 620px; max-height: 95vh; object-fit: contain; }
  .titlepage { text-align: center; margin: 30vh 0 20vh; page-break-after: always; }
  .titlepage h1 { font-size: 30pt; margin: 0; }
  .titlepage .sub { font-style: italic; color: #555; }
  .titlepage .auth { margin-top: 40px; letter-spacing: 3px; text-transform: uppercase; font-size: 11pt; }
  .chapter { page-break-before: always; }
  /* headings in small capitals rather than capitals, so the PDF's bookmarks
     read "Chapter 3", not "CHAPTER 3" */
  .chapter .hd, .contents .hd { text-align: center; letter-spacing: 4px; font-variant-caps: all-small-caps; font-variant-numeric: oldstyle-nums; font-size: 17pt; font-weight: normal; color: #555; margin: 54px 0 36px; }
  .chapter p { text-indent: 2em; margin: 0; }
  .chapter .hd + p, .chapter .byline + p, .brk + p, .chapter p.first { text-indent: 0; }
  .chapter p.dialogue { text-indent: 2em; }
  /* the drop cap the page sets, two lines deep in its own face. An initial
     letter, not a float: it stays inside its word, so the PDF's copy,
     search, and screen readers still find "The" where a float leaves "T"
     and "he" (a gap much wider than 4px splits the word again). A browser
     that can't set one gets a raised initial. */
  ${(library.fonts || {}).dropcap === 'none' ? '' : `.chapter p.first:not(.dialogue)::first-letter { -webkit-initial-letter: 2; initial-letter: 2; padding-right: 4px; font-family: ${exportDropCapFont()}; }
  @supports not ((initial-letter: 2) or (-webkit-initial-letter: 2)) { .chapter p.first:not(.dialogue)::first-letter { font-size: 1.8em; line-height: 1; padding-right: 0; } }`}
  .brk { text-align: center; text-indent: 0 !important; letter-spacing: 8px; color: #888; margin: 2.5em 0; }
  .chapter p.poetry { text-indent: 0; margin: 0 2.5em; }
  .chapter p.flush { text-indent: 0 !important; }
  .chapter p:not(.poetry) + p.poetry, .chapter .hd + p.poetry { margin-top: 0.9em; }
  .chapter p.poetry + p:not(.poetry) { margin-top: 0.9em; }
  .chapter p.byline { text-align: center; margin: -24px 0 40px; letter-spacing: 3px; text-transform: uppercase; font-size: 10pt; color: #555; }
  /* the pages that aren't chapters */
  .page { page-break-before: always; text-align: center; }
  .page p { margin: 0 0 0.5em; }
  .page p.poetry { margin: 0 0 0.2em; }
  .page p.attr { font-style: normal; font-size: 10pt; letter-spacing: 1px; margin-top: 1.2em; }
  .page .brk { margin: 1.2em 0; }
  .copyright { min-height: 98vh; display: flex; flex-direction: column; justify-content: flex-end; text-align: left; font-size: 9pt; line-height: 1.6; color: #333; }
  .copyright p { margin: 0 0 0.9em; }
  .dedication { padding-top: 26vh; font-style: italic; }
  .epigraph { padding-top: 24vh; margin: 0 3em; font-style: italic; }
  .part { padding-top: 28vh; }
  .part .hd { font-weight: normal; margin: 0 0 2.4em; }
  .part .pl { display: block; font-size: 15.5pt; letter-spacing: 5px; font-variant-caps: all-small-caps; color: #555; }
  .part .sep { color: transparent; font-size: 1px; line-height: 0; white-space: pre; }
  .part .pt { display: block; font-size: 24pt; line-height: 1.25; margin-top: 14px; }
  .part p { font-style: italic; margin-left: 3em; margin-right: 3em; }
  .dedication i, .epigraph i, .part p i { font-style: normal; }
  .opener { padding-top: 28vh; }
  .opener .hd { font-size: 26pt; font-weight: normal; line-height: 1.25; margin: 0; }
  .opener .sub { font-style: italic; color: #555; margin-top: 12px; }
  .opener .byline { margin-top: 40px; letter-spacing: 3px; text-transform: uppercase; font-size: 10pt; }
  .contents { page-break-before: always; }
  .contents ol { list-style: none; margin: 0 1.5em; padding: 0; }
  .contents li { margin: 0.3em 0; }
  .contents a { display: flex; align-items: baseline; color: inherit; text-decoration: none; }
  .contents .toc-t { flex: 1; }
  .contents .toc-pg { flex: none; width: 3em; text-align: right; font-size: 13pt; font-variant-numeric: lining-nums tabular-nums; }
  .contents li.lv1 { margin-left: 1.6em; }
  .contents li.lv2 { margin-left: 3.2em; }
  .contents li.t-part { margin-top: 1.1em; font-size: 15pt; line-height: 1.5; letter-spacing: 2px; font-variant-caps: all-small-caps; }
  .contents li:not(.t-page) + li.t-page { margin-top: 1.2em; }
  .prov { margin-top: 80px; text-align: center; color: #999; font-size: 9pt; }
  /* printed pages carry their number at the foot; the cover, the title
     page and the pages that aren't chapters don't, the way books do it
     (only the PDF uses these rules) */
  @page { @bottom-center { content: counter(page); font-family: ${exportBodyFont()}; font-size: 9pt; color: #777; } }
  @page front { @bottom-center { content: none; } }
  .coverpage, .titlepage, .page, .contents { page: front; }
</style></head><body>
${opts.cover ? `<div class="coverpage"><img src="data:${opts.cover.mime};base64,${opts.cover.base64}" alt="${t('Cover')}"/></div>` : ''}
<div class="titlepage"><h1>${escHtml(d.title)}</h1>
${d.subtitle ? `<p class="sub">${escHtml(d.subtitle)}</p>` : ''}
<p class="auth">${escHtml(d.author)}</p></div>
${body}
${opts.stamp ? `<p class="prov">${t('{n} words · exported from NEO on {date}', { n: total, date: stamp })}</p>` : ''}
</body></html>`;
}

/* ---------- runs: paragraphs broken into styled text pieces ---------- */

const escXml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// Walk a paragraph's DOM and emit [{text, b, i}] so docx/epub get real bold/italic.
// In the manuscript an italic inside an italic is emphasis in a poetry
// paragraph (itself one italic), and it is set upright, the typesetter's
// way (flip). Pasted HTML often doubles its italics for nothing; not there.
function paraRuns(pHtml, flip) {
  const holder = document.createElement('template'); // inert: nothing loads or runs
  holder.innerHTML = pHtml;
  const runs = [];
  const walk = (node, b, i) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.textContent) runs.push({ text: child.textContent.replace(/\u00a0/g, ' '), b, i });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.classList && child.classList.contains('ph-mark')) {
          runs.push({ mark: child.dataset.sid || '' });
          continue;
        }
        const tag = child.tagName;
        // the engine writes bold italic as <b style="font-style: italic"> (or
        // the other way round) when ⌘I meets ⌘B: the style counts like a tag
        const st = child.style || {};
        const fw = String(st.fontWeight || '').toLowerCase();
        const it = tag === 'I' || tag === 'EM' || String(st.fontStyle || '').toLowerCase() === 'italic';
        const bo = tag === 'B' || tag === 'STRONG' || fw === 'bold' || parseInt(fw, 10) >= 600;
        walk(child, b || bo, it ? (flip ? !i : true) : i);
      }
    }
  };
  walk(holder.content, false, false);
  return runs;
}

/* ---------- DOCX ---------- */

function docxP(runs, opts = {}) {
  // the schema wants a paragraph's properties in this order
  const pPr = [];
  if (opts.style) pPr.push(`<w:pStyle w:val="${opts.style}"/>`);
  if (opts.keepNext) pPr.push('<w:keepNext/>');
  if (opts.pageBreak) pPr.push('<w:pageBreakBefore/>');
  if (opts.spaceBefore || opts.spaceAfter) {
    pPr.push(`<w:spacing${opts.spaceBefore ? ` w:before="${opts.spaceBefore}"` : ''}${opts.spaceAfter ? ` w:after="${opts.spaceAfter}"` : ''} w:line="360" w:lineRule="auto"/>`);
  }
  if (opts.poetry) pPr.push('<w:ind w:left="720" w:right="720"/>');
  else if (opts.indentLeft) pPr.push(`<w:ind w:left="${opts.indentLeft}"/>`);
  else if (opts.indent) pPr.push('<w:ind w:firstLine="480"/>');
  if (opts.align) pPr.push(`<w:jc w:val="${opts.align}"/>`);
  const rXml = runs.map((r) => {
    if (r.br) return '<w:r><w:br/></w:r>';
    const it = opts.flip ? !r.i : r.i;
    const caps = r.caps !== undefined ? r.caps : opts.caps;
    const size = r.size || opts.size;
    const rPr = (r.b ? '<w:b/>' : '') + (it ? '<w:i/>' : '')
      + (caps === true ? '<w:caps/>' : caps === false ? '<w:caps w:val="0"/>' : '')
      + (opts.tracking ? `<w:spacing w:val="${opts.tracking}"/>` : '')
      + (size ? `<w:sz w:val="${size}"/>` : '');
    return `<w:r>${rPr ? '<w:rPr>' + rPr + '</w:rPr>' : ''}<w:t xml:space="preserve">${escXml(r.text)}</w:t></w:r>`;
  }).join('');
  return `<w:p><w:pPr>${pPr.join('')}</w:pPr>${rXml}</w:p>`;
}

function buildDocxEntries(data) {
  const d = data || bookExportData();
  const body = [];
  // headings carry Word's own heading styles, so the navigation pane and a
  // table of contents inserted in Word both see the book's shape
  const heading = (ch) => 'Heading' + Math.min(3, 1 + (ch.level || 0));
  // a page's lines: centered, upright where the page is italic
  const pageLines = (paras, italic, first) => paras.forEach((p, i) => {
    const lead = i === 0 ? first : {};
    if (p.sceneBreak) { body.push(docxP([{ text: '***' }], Object.assign({ align: 'center' }, lead))); return; }
    const attr = isAttribution(p);
    body.push(docxP(paraRuns(p.html), Object.assign({ align: 'center', flip: italic && !attr, size: attr ? 20 : undefined, spaceBefore: attr ? 240 : 0 }, lead)));
  });
  // title page
  body.push(docxP([{ text: d.title, b: true }], { align: 'center', spaceBefore: 3000, size: 56 }));
  if (d.subtitle) body.push(docxP([{ text: d.subtitle, i: true }], { align: 'center', size: 32 }));
  body.push(docxP([{ text: d.author }], { align: 'center', spaceBefore: 800 }));
  const contents = () => {
    body.push(docxP([{ text: t('Contents') }], { align: 'center', pageBreak: true, spaceBefore: 1200, size: 28, caps: true }));
    body.push(docxP([], {}));
    for (const e of d.toc.filter((x) => d.contentsChapters || x.type !== 'chapter')) {
      body.push(docxP([{ text: e.label }], { indentLeft: 480 * e.level, spaceBefore: e.type === 'part' ? 240 : 0, caps: e.type === 'part' }));
    }
  };
  let placed = !(d.contents && d.toc && d.toc.length);
  d.sections.forEach((ch) => {
    if (!placed && !ch.front) { contents(); placed = true; }
    const kind = ch.kind || 'chapter';
    if (kind === 'copyright') {
      ch.paras.forEach((p, i) => body.push(docxP(p.sceneBreak ? [] : paraRuns(p.html), { pageBreak: i === 0, spaceBefore: i === 0 ? 6000 : 0, spaceAfter: 120, size: 18 })));
      return;
    }
    if (kind === 'dedication' || kind === 'epigraph') {
      pageLines(ch.paras, true, { pageBreak: true, spaceBefore: kind === 'dedication' ? 3600 : 3200 });
      return;
    }
    if (kind === 'part') {
      const runs = [{ text: ch.heading }];
      if (ch.partTitle) runs.push({ br: true }, { br: true }, { text: ch.partTitle, caps: false, size: 48 });
      body.push(docxP(runs, { style: heading(ch), spaceBefore: 3600, spaceAfter: 480 }));
      pageLines(ch.paras, true, {});
      return;
    }
    if (kind === 'opener') {
      body.push(docxP([{ text: ch.heading, caps: false, size: 44 }], { style: heading(ch), spaceBefore: 3600 }));
      if (ch.subtitle) body.push(docxP([{ text: ch.subtitle, i: true }], { align: 'center', size: 28 }));
      if (ch.byline) body.push(docxP([{ text: ch.byline }], { align: 'center', spaceBefore: 600, size: 20, caps: true }));
      return;
    }
    if (ch.heading) {
      body.push(docxP([{ text: ch.heading }], { style: heading(ch) }));
      if (ch.byline) body.push(docxP([{ text: ch.byline }], { align: 'center', size: 20, caps: true }));
      body.push(docxP([], {}));
    } else {
      body.push(docxP([], { pageBreak: true })); // headingless story still starts fresh
    }
    for (const p of ch.paras) {
      if (p.sceneBreak) body.push(docxP([{ text: '***' }], { align: 'center', spaceBefore: 240 }));
      else if (p.poetry) body.push(docxP(paraRuns(p.html), { align: p.align === 'center' || p.align === 'right' ? p.align : '', poetry: true }));
      else if (p.align === 'center' || p.align === 'right') body.push(docxP(paraRuns(p.html), { align: p.align }));
      else body.push(docxP(paraRuns(p.html), { indent: !p.flush }));
    }
  });
  if (!placed) contents();
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body></w:document>`;
  const headingStyle = (n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>
<w:pPr><w:keepNext/><w:pageBreakBefore/><w:spacing w:before="1200"/><w:jc w:val="center"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:caps/><w:sz w:val="28"/></w:rPr></w:style>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${[1, 2, 3].map(headingStyle).join('\n')}
</w:styles>`;
  return [
    { path: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>` },
    { path: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>` },
    { path: 'word/_rels/document.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { path: 'word/document.xml', content: documentXml },
    { path: 'word/styles.xml', content: stylesXml }
  ];
}

/* ---------- EPUB (KDP-friendly: EPUB 3, nav + NCX TOC, cover image) ---------- */

// The cover that travels with an export: the writer's own image if they
// gave one, otherwise the shelf's abstract with the title set in type,
// rendered at KDP size. NEO's paintings never leave the shelf.
async function exportCover(d) {
  if (d.coverImage) {
    const c = await window.neo.readCover(d.id, d.coverImage);
    if (c) return { base64: c.base64, mime: c.mime, ext: c.ext };
  }
  await NeoCovers.ready;
  const url = NeoCovers.renderFull(d).toDataURL('image/jpeg', 0.9);
  return { base64: url.split(',')[1], mime: 'image/jpeg', ext: 'jpg' };
}

// what each kind of section is, in the EPUB's own words
const EPUB_TYPES = {
  copyright: 'copyright-page', dedication: 'dedication', epigraph: 'epigraph', part: 'part',
  opener: 'volume', acknowledgments: 'acknowledgments', about: 'backmatter'
};

function chapterXhtml(ch, d) {
  const kind = ch.kind || 'chapter';
  const xhtmlRuns = (p) => paraRuns(p.html).map((r) => {
    let t = escXml(r.text);
    if (r.i) t = '<em>' + t + '</em>';
    if (r.b) t = '<strong>' + t + '</strong>';
    return t;
  }).join('');
  // a page's lines, each set on its own
  const lines = () => ch.paras.map((p) => {
    if (p.sceneBreak) return '<p class="brk">* * *</p>';
    const cls = [kind !== 'copyright' && isAttribution(p) ? 'attr' : '', p.poetry ? 'poetry' : '', p.align === 'center' || p.align === 'right' ? p.align : ''].filter(Boolean);
    return `<p${cls.length ? ` class="${cls.join(' ')}"` : ''}>${xhtmlRuns(p)}</p>`;
  }).join('\n');
  let inner;
  if (kind === 'copyright' || kind === 'dedication' || kind === 'epigraph') {
    inner = `<section epub:type="${EPUB_TYPES[kind]}" class="${kind}">
${lines()}
</section>`;
  } else if (kind === 'part') {
    inner = `<section epub:type="part" class="part"><h1><span class="pl">${escXml(ch.heading)}</span>${ch.partTitle ? `<span class="pt">${escXml(ch.partTitle)}</span>` : ''}</h1>
${lines()}
</section>`;
  } else if (kind === 'opener') {
    inner = `<section epub:type="volume" class="opener"><h1>${escXml(ch.heading)}</h1>
${ch.subtitle ? `<p class="sub">${escXml(ch.subtitle)}</p>` : ''}${ch.byline ? `<p class="byline">${escXml(ch.byline)}</p>` : ''}
</section>`;
  } else {
    let first = true;
    const paras = ch.paras.map((p) => {
      if (p.sceneBreak) { first = true; return '<p class="brk">* * *</p>'; }
      const classes = [];
      if (p.poetry) classes.push('poetry');
      else if (p.flush) classes.push('flush');
      else if (first) {
        classes.push('first');
        // speech keeps its indent, in line with the lines that answer it
        if (OPENING_DASH.test(p.text || '')) classes.push('dialogue');
      }
      if (p.align === 'center' || p.align === 'right') classes.push(p.align);
      const cls = classes.length ? ` class="${classes.join(' ')}"` : '';
      if (!p.poetry) first = false;
      return `<p${cls}>${xhtmlRuns(p)}</p>`;
    }).join('\n');
    inner = `<section epub:type="${EPUB_TYPES[kind] || ch.role || 'chapter'}">${ch.heading ? `<h1>${escXml(ch.heading)}</h1>` : ''}${ch.byline ? `<p class="byline">${escXml(ch.byline)}</p>` : ''}
${paras}
</section>`;
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${escXml(ch.heading || ch.label || d.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>${inner}</body></html>`;
}

async function buildEpubEntries(data) {
  const d = data || bookExportData();
  const chapters = d.sections;
  const uuid = 'urn:uuid:' + (d.uuid || crypto.randomUUID());
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  // real cover art when the book has it; the shelf's cover otherwise
  const cover = await exportCover(d);
  const coverName = 'cover.' + cover.ext;
  const coverMime = cover.mime;
  const coverContent = cover.base64;
  // the pages at the front come before the contents in reading order
  const front = chapters.filter((ch) => ch.front);
  const rest = chapters.filter((ch) => !ch.front);
  const start = rest[0] || chapters[0];
  const chItems = chapters.map((ch) =>
    `<item id="ch${ch.num}" href="ch${ch.num}.xhtml" media-type="application/xhtml+xml"/>`).join('\n');
  const spineOf = (list) => list.map((ch) => `<itemref idref="ch${ch.num}"/>`).join('\n');
  // one entry per section for a single book; a book of books nests its
  // chapters under their titles and its titles under their parts
  const toc = tocTree(d.toc || chapters.map((ch) => ({ label: ch.heading || d.title, num: ch.num, level: 0 })));
  const navList = (nodes) => nodes.map((n) => `<li><a href="ch${n.e.num}.xhtml">${escXml(n.e.label)}</a>${n.children.length ? `
<ol>
${navList(n.children)}
</ol>` : ''}</li>`).join('\n');
  let playOrder = 1; // the title page is first
  const ncxPoints = (nodes) => nodes.map((n) => {
    playOrder += 1;
    return `
<navPoint id="ch${n.e.num}" playOrder="${playOrder}"><navLabel><text>${escXml(n.e.label)}</text></navLabel><content src="ch${n.e.num}.xhtml"/>${ncxPoints(n.children)}</navPoint>`;
  }).join('');
  const entryCount = (nodes) => nodes.reduce((n, x) => n + 1 + entryCount(x.children), 0);

  const entries = [
    { path: 'mimetype', content: 'application/epub+zip', store: true },
    { path: 'META-INF/container.xml', content: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>` },
    { path: 'OEBPS/content.opf', content: `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${uuid}</dc:identifier>
<dc:title>${escXml(d.title)}</dc:title>
<dc:creator>${escXml(d.author)}</dc:creator>
<dc:language>${escXml(d.language || NeoI18n.getLocale())}</dc:language>
<meta property="dcterms:modified">${modified}</meta>
<meta name="cover" content="cover-image"/>
</metadata>
<manifest>
<item id="cover-image" href="${coverName}" media-type="${coverMime}" properties="cover-image"/>
<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
<item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${chItems}
</manifest>
<spine toc="ncx">
<itemref idref="cover" linear="no"/>
<itemref idref="titlepage"/>
${front.length ? spineOf(front) + '\n' : ''}<itemref idref="nav"${entryCount(toc) <= 1 ? ' linear="no"' : ''}/>
${spineOf(rest)}
</spine>
<guide>
<reference type="cover" title="${escXml(t('Cover'))}" href="cover.xhtml"/>
<reference type="toc" title="${escXml(t('Table of Contents'))}" href="nav.xhtml"/>
<reference type="text" title="${escXml(t('Beginning'))}" href="ch${start.num}.xhtml"/>
</guide>
</package>` },
    { path: 'OEBPS/nav.xhtml', content: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${escXml(t('Table of Contents'))}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><nav epub:type="toc" id="toc"><h1>${escXml(t('Contents'))}</h1>
<ol>
<li><a href="title.xhtml">${escXml(t('Title Page'))}</a></li>
${navList(toc)}
</ol></nav>
<nav epub:type="landmarks" hidden=""><ol>
<li><a epub:type="cover" href="cover.xhtml">${escXml(t('Cover'))}</a></li>
<li><a epub:type="toc" href="nav.xhtml">${escXml(t('Table of Contents'))}</a></li>
<li><a epub:type="bodymatter" href="ch${start.num}.xhtml">${escXml(t('Beginning'))}</a></li>
</ol></nav>
</body></html>` },
    { path: 'OEBPS/toc.ncx', content: `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${uuid}"/></head>
<docTitle><text>${escXml(d.title)}</text></docTitle>
<navMap>
<navPoint id="titlepage" playOrder="1"><navLabel><text>${escXml(t('Title Page'))}</text></navLabel><content src="title.xhtml"/></navPoint>${ncxPoints(toc)}
</navMap></ncx>` },
    { path: 'OEBPS/style.css', content: `body { font-family: serif; line-height: 1.5; margin: 1em; }
h1 { text-align: center; font-weight: normal; letter-spacing: 0.2em; text-transform: uppercase; font-size: 1.2em; margin: 3em 0 2em; }
p { text-indent: 1.2em; margin: 0; }
p.first, p.brk + p, p.byline + p { text-indent: 0; }
p.first.dialogue:not(.center):not(.right) { text-indent: 1.2em; }
p.center { text-align: center; text-indent: 0; }
p.right { text-align: right; text-indent: 0; }
p.brk { text-align: center; text-indent: 0; margin: 2.5em 0; letter-spacing: 0.5em; }
p.poetry { text-indent: 0; margin: 0 2em; }
p.flush { text-indent: 0 !important; }
p:not(.poetry) + p.poetry, h1 + p.poetry { margin-top: 0.9em; }
p.poetry + p:not(.poetry) { margin-top: 0.9em; }
p.byline { text-align: center; text-indent: 0; letter-spacing: 0.2em; text-transform: uppercase; font-size: 0.8em; margin: -1em 0 2em; }
.copyright { margin-top: 40%; font-size: 0.8em; line-height: 1.5; }
.copyright p { text-indent: 0; margin: 0 0 0.9em; }
.dedication, .epigraph, .part, .opener { text-align: center; margin-top: 30%; }
.epigraph { margin-left: 2em; margin-right: 2em; }
.dedication p, .epigraph p, .part p { text-indent: 0; margin: 0 0 0.5em; font-style: italic; }
.dedication em, .epigraph em, .part p em { font-style: normal; }
.dedication p.poetry, .epigraph p.poetry, .part p.poetry { margin: 0 0 0.2em; }
p.attr { font-style: normal; font-size: 0.85em; letter-spacing: 0.05em; margin-top: 1em; }
.part h1 { margin: 0 0 2em; }
.part .pl { display: block; }
.part .pt { display: block; margin-top: 0.8em; font-size: 1.6em; letter-spacing: 0; text-transform: none; }
.opener h1 { margin: 0; font-size: 1.8em; letter-spacing: 0.02em; text-transform: none; }
.opener .sub { text-indent: 0; margin-top: 0.6em; font-style: italic; }
.opener .byline { margin: 3em 0 0; }
nav#toc ol { list-style: none; padding-left: 0; }
nav#toc ol ol { padding-left: 1.5em; }
.titlepage { text-align: center; margin-top: 30%; }
.titlepage h2 { font-size: 2em; margin: 0; }
.titlepage .sub { font-style: italic; }
.titlepage .auth { margin-top: 4em; letter-spacing: 0.3em; text-transform: uppercase; }
.coverimg { text-align: center; margin: 0; padding: 0; }
.coverimg img { max-width: 100%; max-height: 100%; }` },
    { path: 'OEBPS/cover.xhtml', content: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${escXml(t('Cover'))}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><div class="coverimg"><img src="${coverName}" alt="${escXml(d.title)}"/></div></body></html>` },
    { path: 'OEBPS/title.xhtml', content: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${escXml(d.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><div class="titlepage"><h2>${escXml(d.title)}</h2>
${d.subtitle ? `<p class="sub">${escXml(d.subtitle)}</p>` : ''}
<p class="auth">${escXml(d.author)}</p></div></body></html>` },
    { path: 'OEBPS/' + coverName, content: coverContent, base64: true }
  ];
  for (const ch of chapters) {
    entries.push({ path: `OEBPS/ch${ch.num}.xhtml`, content: chapterXhtml(ch, d) });
  }
  return entries;
}

/* ---------- A BOOK OF BOOKS: a bound shelf, or a shelf as an anthology ---------- */

// Read a shelf from disk into export sections, in shelf order. Each section
// has a kind the builders lay out: 'copyright', 'dedication', 'epigraph'
// (front pages), 'part', 'opener' (a title's own first page), 'chapter',
// 'acknowledgments', 'about' (back pages). `toc` is the table of contents:
// {label, num (the section), level, type: part | title | chapter | page}.
// A bound shelf brings its cover and pages and numbers its chapters its own
// way; an unbound shelf is read as an anthology: titles only, each one's
// chapters counted from 1.
async function shelfBookData(shelf, opts = {}) {
  const bound = !!opts.bound;
  const through = bound && ((shelf.binding && shelf.binding.numbering) || 'through') !== 'restart';
  const metas = [];
  for (const id of shelf.bookIds) {
    const m = await window.neo.readBookMeta(id);
    if (m && (bound || !isPageMeta(m))) metas.push(m);
  }
  const cover = metas.find((m) => m.kind === 'cover') || null;
  const author = (cover && cover.author) || shelfAuthorName(shelf);
  const titles = metas.filter((m) => !isPageMeta(m));
  const single = titles.length === 1;
  const pageParas = async (m) => parasFromHtml(m.chapterOrder && m.chapterOrder[0]
    ? await window.neo.readChapter(m.id, m.chapterOrder[0]) : '');
  const sections = [];
  const toc = [];
  const push = (s) => { s.num = sections.length + 1; sections.push(s); return s; };
  let n = 0; // the chapter count
  let parts = 0;
  let inPart = false;
  for (const m of metas) {
    if (m.kind === 'cover') continue;
    if (PAGE_FRONT.includes(m.kind) || PAGE_BACK.includes(m.kind)) {
      const paras = await pageParas(m);
      if (!paras.length) continue; // a page left blank stays out of the book
      const back = PAGE_BACK.includes(m.kind);
      const s = push({ kind: m.kind, front: !back, heading: back ? pageKindName(m.kind) : '', label: pageKindName(m.kind), level: 0, paras });
      if (back) {
        toc.push({ label: s.heading, num: s.num, level: 0, type: 'page' });
        inPart = false;
      }
      continue;
    }
    if (m.kind === 'part') {
      parts += 1;
      const all = await pageParas(m);
      // the page's first line is the part's title; what follows, a quote or a verse
      const titled = !!(all[0] && !all[0].sceneBreak && !isAttribution(all[0]));
      const partTitle = titled ? all[0].text : '';
      const s = push({ kind: 'part', heading: partLabel(parts), partTitle, level: 0, paras: titled ? all.slice(1) : all });
      toc.push({ label: partTitle ? s.heading + ': ' + partTitle : s.heading, num: s.num, level: 0, type: 'part' });
      inPart = true;
      continue;
    }
    if (PAGE_WRITTEN.includes(m.kind)) {
      // the book's own prologue or epilogue: one unnumbered section (any
      // chapters the writer gave it run on, a scene break between them)
      const paras = [];
      for (const chId of m.chapterOrder || []) {
        const p = parasFromHtml(await window.neo.readChapter(m.id, chId));
        if (!p.length) continue;
        if (paras.length) paras.push({ sceneBreak: true, poetry: false, text: '', runs: [], align: '', html: '' });
        paras.push(...p);
      }
      if (!paras.length) continue;
      const heading = isUntitled(m.title) ? pageKindName(m.kind) : m.title.trim();
      const s = push({ kind: 'chapter', role: m.kind, heading, level: 0, paras });
      toc.push({ label: heading, num: s.num, level: 0, type: 'title' });
      inPart = false;
      continue;
    }
    // a title and its chapters: its story and its parts. The pages it
    // carries as a book of its own (its copyright, its dedication…) stay
    // with it; the bound book has pages of its own.
    if (!through) n = 0;
    const level = inPart ? 1 : 0;
    const chapters = [];
    for (const chId of m.chapterOrder || []) {
      const kind = chapterKind(chId, m);
      if (!STORY_KINDS.includes(kind) && kind !== 'part') continue;
      const paras = parasFromHtml(await window.neo.readChapter(m.id, chId));
      if (paras.length || kind === 'part') chapters.push({ chId, kind, paras });
    }
    while (chapters.length && chapters[chapters.length - 1].kind === 'part') chapters.pop();
    if (!chapters.length) continue;
    const byline = m.author && m.author !== author ? m.author : '';
    if (single && chapters.length === 1) {
      push({ kind: 'chapter', heading: '', paras: chapters[0].paras });
      continue;
    }
    if (chapters.length === 1) {
      // one chapter is one section, headed by the title's own name and left
      // out of the count: a prologue, an interlude, a short story
      const s = push({ kind: 'chapter', heading: m.title, byline, level, paras: chapters[0].paras });
      toc.push({ label: m.title, num: s.num, level, type: 'title' });
      continue;
    }
    let chLevel = level;
    if (!single) {
      const s = push({ kind: 'opener', heading: m.title, subtitle: m.subtitle || '', byline, level, paras: [] });
      toc.push({ label: m.title, num: s.num, level, type: 'title' });
      chLevel = level + 1;
    }
    // a title's own parts stand over the chapters that follow them
    let titleParts = 0;
    let underPart = false;
    for (const c of chapters) {
      if (c.kind === 'part') {
        titleParts += 1;
        if (m.restartNumbering) n = 0; // this title numbers its chapters part by part
        const titled = !!(c.paras[0] && !c.paras[0].sceneBreak && !isAttribution(c.paras[0]));
        const partTitle = titled ? c.paras[0].text : '';
        const s = push({ kind: 'part', heading: partLabel(titleParts), partTitle, level: chLevel, paras: titled ? c.paras.slice(1) : c.paras });
        toc.push({ label: partTitle ? s.heading + ': ' + partTitle : s.heading, num: s.num, level: chLevel, type: 'part' });
        underPart = true;
        continue;
      }
      const role = chapterRole(c.chId, m);
      if (role === 'epilogue') underPart = false;
      const chTitle = (m.chapterTitles || {})[c.chId];
      let heading;
      if (c.kind === 'unnumbered') heading = chTitle || '';
      else {
        if (role) heading = role === 'prologue' ? t('Prologue') : t('Epilogue');
        else { n += 1; heading = t('Chapter {n}', { n }); }
        if (chTitle) heading = library.exportCustomChapterTitles ? chTitle : heading + ' — ' + chTitle;
      }
      const lv = underPart ? chLevel + 1 : chLevel;
      const s = push({ kind: 'chapter', heading, level: lv, paras: c.paras, role: role || '' });
      toc.push({ label: heading, num: s.num, level: lv, type: 'chapter' });
    }
  }
  // an EPUB wants one identity per book: a bound book keeps the first it gets
  let uuid = null;
  if (bound) {
    if (!shelf.binding.uuid) {
      shelf.binding.uuid = crypto.randomUUID();
      await writeLibrary(library);
    }
    uuid = shelf.binding.uuid;
  }
  const title = opts.title || shelf.name;
  return {
    id: cover && cover.coverImage ? cover.id : 'shelf-' + shelf.id,
    uuid,
    title,
    subtitle: (cover && cover.subtitle) || '',
    author,
    language: writingLanguage(),
    coverSeed: cover ? cover.coverSeed : shelf.id + ':' + title,
    coverImage: (cover && cover.coverImage) || null,
    sections,
    toc,
    // a contents page in print for a book of several titles, or for one
    // title that has a Contents page of its own (which lists its chapters)
    contents: titles.length > 1 || (single && (titles[0].chapterOrder || []).some((c) => chapterKind(c, titles[0]) === 'contents')),
    contentsChapters: single
  };
}

async function shelfPayload(data, format) {
  const defaultName = safeName(data.title);
  if (format === 'docx') return { format, defaultName, zipEntries: buildDocxEntries(data) };
  if (format === 'epub') return { format, defaultName, zipEntries: await buildEpubEntries(data) };
  return { format: 'pdf', defaultName, content: buildHtml(data, { cover: await exportCover(data), fonts: await exportFontFaces(data) }) };
}

function shelfFormats() {
  return [
    { label: 'EPUB', desc: t('For ebook stores — the TOC lists every story.'), value: 'epub' },
    { label: 'Word (.docx)', desc: t('For editors — each story starts on a new page.'), value: 'docx' },
    { label: 'PDF', desc: t('For reading, sharing, and print.'), value: 'pdf' }
  ];
}

async function exportShelfAnthology(shelf) {
  if (!shelf.bookIds.length) { toast(t('This shelf has no books on it yet')); return; }
  const title = await askInput(t('Anthology title'), t('Shown on the title page, cover, and metadata'), shelf.name);
  if (title === null) return;
  const format = await optionModal(t('Export the anthology as…'), null, shelfFormats());
  if (!format) return;
  toast(t('Collecting the shelf…'));
  try {
    const data = await shelfBookData(shelf, { title: title || shelf.name });
    if (!data.sections.length) { toast(t('No words found on this shelf yet')); return; }
    const saved = await window.neo.exportSave(await shelfPayload(data, format));
    if (saved) toast(t('Anthology of {n} works exported: {file}', { n: shelf.bookIds.length, file: saved.split('/').pop() }), 6000);
  } catch (err) {
    window.neo.logError('export anthology: ' + (err && err.stack || err));
    toast(t('Couldn’t export the anthology: {error}', { error: plainError(err) }), 8000);
  }
}

// A bound shelf goes out as the book it is: no questions but the format
async function exportBoundBook(shelf) {
  const format = await optionModal(escHtml(t('Export “{title}”', { title: shelf.name })), null, shelfFormats());
  if (!format) return;
  toast(t('Collecting the shelf…'));
  try {
    const data = await shelfBookData(shelf, { bound: true });
    if (!data.sections.length) { toast(t('No words found on this shelf yet')); return; }
    const saved = await window.neo.exportSave(await shelfPayload(data, format));
    if (saved) toast(t('Exported: {file}', { file: saved.split('/').pop() }));
  } catch (err) {
    window.neo.logError('export bound book: ' + (err && err.stack || err));
    toast(t('Couldn’t export: {error}', { error: plainError(err) }), 8000);
  }
}

// Right-click a bound book's cover: its art, and the book's own choices
async function boundCoverMenu(shelf, meta, el) {
  const options = [];
  if (!NO_HOVER) {
    options.push({ label: meta.coverImage ? t('Replace cover art…') : t('Set cover art…'), desc: t('Pick an image (2:3 works best). Or just drag one from Finder onto the book.'), value: 'cover' });
  }
  if (meta.coverImage) {
    options.push({ label: t('Remove cover art'), desc: t('Deletes the image from the book folder. (To just hide it, use the ↻ on the book.)'), danger: true, value: 'uncover' });
  }
  options.push(
    { label: t('New cover'), value: 'refresh' },
    { label: t('Export the book…'), desc: t('EPUB, Word or PDF, with its cover, its pages and one table of contents.'), value: 'export' },
    { label: t('Unbind'), desc: t('A shelf of separate titles again. Its pages wait for the next binding.'), value: 'unbind' }
  );
  const choice = await optionModal(escHtml(t('“{name}” · one book', { name: shelf.name })), null, options);
  if (choice === 'cover') {
    const src = await window.neo.pickCover();
    if (!src) return;
    const fname = await window.neo.setCover(meta.id, src);
    if (!fname) return;
    const live = (await window.neo.readBookMeta(meta.id)) || meta;
    live.coverImage = fname;
    live.coverMode = 'image';
    await writeBookMeta(meta.id, live);
    renderShelves();
  } else if (choice === 'uncover') {
    await window.neo.removeCover(meta.id);
    const live = (await window.neo.readBookMeta(meta.id)) || meta;
    live.coverImage = null;
    await writeBookMeta(meta.id, live);
    renderShelves();
  } else if (choice === 'refresh') {
    await refreshCover(meta, el);
  } else if (choice === 'export') {
    await exportBoundBook(shelf);
  } else if (choice === 'unbind') {
    await unbindShelf(shelf);
  }
}

// flat {level} entries into a tree, for the EPUB's nested contents
function tocTree(entries) {
  const root = { children: [] };
  const stack = [root];
  for (const e of entries) {
    const level = Math.max(0, Math.min(e.level, stack.length - 1));
    stack.length = level + 1;
    const node = { e, children: [] };
    stack[level].children.push(node);
    stack.push(node);
  }
  return root.children;
}


// What went wrong, in the words a writer can use: Electron wraps a failure in
// the main process as "Error invoking remote method 'export:save': Error: …"
function plainError(err) {
  return String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '');
}

// the whole book, or with chId just that chapter
async function doExport(format, chId = null) {
  if (!book) { toast(t('Open a book first')); return; }
  flushAllSaves();
  const one = chId ? chapterExportData(chId) : null;
  if (chId && !one) return;
  const data = one || undefined;
  const defaultName = safeName(book.title) + (one ? '-' + safeName(one.chapterOnly) : '');
  try {
    let payload;
    if (format === 'docx') payload = { format, defaultName, zipEntries: buildDocxEntries(data) };
    else if (format === 'epub') payload = { format, defaultName, zipEntries: await buildEpubEntries(data) };
    else if (format === 'txt') payload = { format, defaultName, content: buildTxt(data) };
    else if (format === 'md') payload = { format, defaultName, content: buildMd(data) };
    else {
      const d = data || bookExportData();
      payload = { format, defaultName, content: buildHtml(d, { cover: one ? null : await exportCover(d), fonts: await exportFontFaces(d) }) };
    }
    const saved = await window.neo.exportSave(payload);
    if (saved) toast(t('Exported: {file}', { file: saved.split('/').pop() }));
  } catch (err) {
    // An export that saves nothing must never be silent: name the failure,
    // and put the stack in the error log for whatever bug report follows.
    window.neo.logError('export ' + format + ': ' + (err && err.stack || err));
    toast(t('Couldn’t export: {error}', { error: plainError(err) }), 8000);
  }
}

function chooseEmailMethod() {
  // Apple Mail only exists on Macs; elsewhere Gmail
  if (!navigator.platform.toLowerCase().includes('mac')) return Promise.resolve('gmail');
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `
      <div class="modal" style="width:440px">
        <h2 style="font-size:16px">${t('How should NEO email your drafts?')}</h2>
        <div class="fr-choices" style="margin-top:14px">
          <button class="fr-choice" data-m="gmail">
            <strong>Gmail</strong>
            <span>${t('Opens a pre-filled compose window in your browser. NEO shows you the PDF to drag into it.')}</span>
          </button>
          <button class="fr-choice" data-m="mail">
            <strong>Apple Mail</strong>
            <span>${t('Fully automatic — the PDF is attached and addressed. Just hit send.')}</span>
          </button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    bd.querySelectorAll('.fr-choice').forEach((b) => {
      b.onclick = () => { bd.remove(); resolve(b.dataset.m); };
    });
  });
}

async function emailSettings() {
  const addr = await askInput(t('Email drafts to'), t('you@example.com'), library.emailAddress || '');
  if (addr === null) return false;
  if (addr) library.emailAddress = addr;
  library.emailMethod = await chooseEmailMethod();
  await writeLibrary(library);
  toast(t('Email settings saved'));
  return true;
}

async function manuscriptHash() {
  // SHA-256 of the manuscript text: a fingerprint for your provenance trail
  const text = book.title + '\n' + book.chapterOrder.map((c) => chapterText(c)).join('\n');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function doEmailDraft() {
  if (!book) { toast(t('Open a book first')); return; }
  flushAllSaves();
  if (!library.emailAddress || !library.emailMethod) {
    const ok = await emailSettings();
    if (!ok) return;
  }
  const total = bookWordCount();
  const subject = t('NEO draft — {title} — {n} words — {date}', { title: book.title, n: total, date: fmtDate(new Date()) });
  const hash = await manuscriptHash();
  const body = t('Draft snapshot of “{title}” — {n} words.', { title: book.title, n: total }) + '\n'
    + t('Sent from NEO on {date}.', { date: new Date().toLocaleString(NeoI18n.getLocale()) }) + '\n\n'
    + t('SHA-256 fingerprint of the manuscript text:') + `\n${hash}\n\n`
    + (library.emailMethod === 'gmail'
      ? t('The PDF snapshot is in the Finder window NEO just opened — drag it into this email before sending.')
      : t('PDF snapshot attached.'));
  toast(t('Preparing your draft…'));
  const snapshot = bookExportData();
  const res = await window.neo.emailDraft({
    to: library.emailAddress,
    subject,
    body,
    html: buildHtml(snapshot, { stamp: true, fonts: await exportFontFaces(snapshot) }), // the email snapshot is a provenance record
    defaultName: safeName(book.title),
    method: library.emailMethod
  });
  if (res.method === 'gmail') toast(t('Gmail compose opened — drag in the PDF NEO revealed, then send'), 8000);
  else if (res.ok) toast(t('Draft handed to Mail — hit send for your timestamp'));
  else toast(t('Mail unavailable — snapshot saved to your Exports folder instead'));
}

// Help → Check for Update…: on-demand release lookup, only ever runs on a click
let updateDialog = null; // the Check for Update… window, while it's open

function updateDialogBox(res) {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal" style="width:400px">
      <h2 style="font-size:16px">${t('NEO {version} is available', { version: res.latestVersion })}</h2>
      <p class="up-text">${t('You have {version}.', { version: res.currentVersion })}</p>
      <div class="up-bar" hidden><div class="up-fill"></div></div>
      <div style="text-align:right;margin-top:14px">
        <button class="m-cancel btn-quiet" style="margin-right:10px">${t('Later')}</button>
        <button class="m-ok btn-gold"></button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => { bd.remove(); if (updateDialog === bd) updateDialog = null; };
  bd.close = close;
  bd.querySelector('.m-cancel').onclick = close;
  bd.tabIndex = -1;
  bd.focus();
  bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  return bd;
}

// one function draws every state of the dialog, so a message from the
// updater can redraw it whenever it likes
function updateDialogShow(state, info = {}) {
  const bd = updateDialog;
  if (!bd) return;
  const text = bd.querySelector('.up-text');
  const bar = bd.querySelector('.up-bar');
  const fill = bd.querySelector('.up-fill');
  const ok = bd.querySelector('.m-ok');
  const later = bd.querySelector('.m-cancel');
  const mb = (n) => (n / 1048576).toFixed(0);
  later.hidden = false;
  ok.hidden = false;
  bar.hidden = true;
  if (state === 'downloading') {
    const pct = Math.max(0, Math.min(100, info.percent || 0));
    text.textContent = info.total
      ? t('Downloading… {done} of {total} MB', { done: mb(info.transferred || 0), total: mb(info.total) })
      : t('Downloading…');
    bar.hidden = false;
    fill.style.width = pct.toFixed(1) + '%';
    ok.hidden = true;
  } else if (state === 'ready') {
    text.textContent = t('Downloaded. NEO will save your work and restart.');
    ok.textContent = t('Restart to update');
    ok.onclick = () => { flushAllSaves(); setTimeout(() => window.neo.installUpdate(), 300); };
    ok.focus();
  } else if (state === 'error') {
    text.textContent = t('The update couldn’t be installed from here: {message}', { message: info.message || t('unknown error') })
      + ' ' + t('You can download it from the release page instead.');
    ok.textContent = t('View Release');
    ok.onclick = () => { window.neo.openRelease(); bd.close(); };
  } else if (state === 'release') {
    text.textContent = t('You have {version}.', { version: info.currentVersion });
    ok.textContent = t('View Release');
    ok.onclick = () => { window.neo.openRelease(); bd.close(); };
  }
}

async function checkForUpdate() {
  if (updateDialog) { updateDialog.focus(); return; }
  const res = await window.neo.checkForUpdate();
  // the answer comes in a window, like an update does: a line at the foot
  // of the screen was too easy to miss
  if (res.error) { updateNotice(t('Couldn’t check for updates — try again later')); return; }
  if (!res.hasUpdate) { updateNotice(t('NEO is up to date'), t('You have {version}.', { version: res.currentVersion })); return; }
  // NEO has been fetching it in the background since it was found: show
  // where that download is — usually done, with "Restart to update"
  updateDialog = updateDialogBox(res);
  if (!res.canInstall) updateDialogShow('release', res);
  else if (res.ready) updateDialogShow('ready', res);
  else if (res.state === 'error') updateDialogShow('error', res);
  else updateDialogShow('downloading', res);
}

function updateNotice(title, line) {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal" style="width:400px" role="dialog" aria-modal="true">
      <h2 style="font-size:16px"></h2>
      <p class="up-text" hidden></p>
      <div style="text-align:right;margin-top:14px"><button class="m-ok btn-gold">${t('OK')}</button></div>
    </div>`;
  bd.querySelector('h2').textContent = title;
  if (line) { bd.querySelector('.up-text').hidden = false; bd.querySelector('.up-text').textContent = line; }
  document.body.appendChild(bd);
  const close = () => { bd.remove(); if (updateDialog === bd) updateDialog = null; };
  bd.close = close;
  bd.querySelector('.m-ok').onclick = close;
  bd.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  updateDialog = bd; // asking again while it's open just brings it forward
  bd.querySelector('.m-ok').focus();
}

// messages from the updater in the main process
// (the download itself is silent: they only matter while the window is open)
function updateMessage(msg) {
  if (!updateDialog || !updateDialog.querySelector('.up-bar')) return; // nothing open to report to
  updateDialogShow(msg.state, msg);
}

// Help → About NEO: the version, plainly
async function showAbout() {
  const v = await window.neo.appVersion();
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal" style="width:340px;text-align:center">
      <h2 style="font-size:22px;letter-spacing:6px">NEO</h2>
      <p class="about-version">${t('Version {version}', { version: v })}</p>
      <p class="about-line">${t('A word processor for authors.')}</p>
      <div style="margin-top:16px">
        <button class="m-ok btn-gold">${t('Back to writing')}</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.querySelector('.m-ok').onclick = close;
  bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  bd.querySelector('.m-ok').focus();
}

// Text size and the reset travel with page zoom; the menu item and the
// keyboard fallback share this so the two cannot drift.
async function setEditorFontSize(value) {
  const cur = library.editorFontSize || 17;
  library.editorFontSize = value === 0 ? 17 : Math.min(22, Math.max(14, cur + value));
  if (value === 0) library.pageZoom = 1; // ⌘0 resets pinch zoom too
  await writeLibrary(library);
  keepReadingPlace(applyFonts);
}

window.neo.onMenu(async (msg) => {
  // full screen and focus mode together hide the bottom bar until hovered
  // (styles.css); the window says when it goes in and out, whatever is open
  if (msg.type === 'fullScreen') { document.body.classList.toggle('full-screen', !!msg.value); return; }
  if ($('#keyboard-shortcuts') && msg.type !== 'help') return;
  // a window the menu opens (⌘, for Goals, say) never stacks on one that's
  // already open: pressing it again used to pile up overlays
  const WINDOWS = ['stats', 'about', 'emailSettings', 'coverArt', 'reshelve', 'checkUpdate'];
  if (WINDOWS.includes(msg.type) && document.querySelector('.modal-backdrop:not([hidden])')) {
    if (msg.type === 'checkUpdate' && updateDialog) updateDialog.focus();
    return;
  }
  if (msg.type === 'help') showHelp();
  if (msg.type === 'about') showAbout();
  if (msg.type === 'checkUpdate') checkForUpdate();
  if (msg.type === 'update') updateMessage(msg);
  if (msg.type === 'export') doExport(msg.format);
  if (msg.type === 'markdownEmphasis') {
    if (msg.checked) delete library.markdownOff; else library.markdownOff = true;
    await writeLibrary(library);
    toast(msg.checked ? t('Markdown emphasis on: *italic*, **bold**') : t('Markdown emphasis off: asterisks stay asterisks'));
  }
  if (msg.type === 'exportCustomChapterTitles') {
    library.exportCustomChapterTitles = msg.checked;
    await writeLibrary(library);
  }
  if (msg.type === 'emailDraft') doEmailDraft();
  if (msg.type === 'emailSettings') emailSettings();
  if (msg.type === 'find') openSearch();
  if (msg.type === 'spellcheck') toggleSpellcheck();
  if (msg.type === 'spellLanguage') changeSpellLanguage(msg.value);
  if (msg.type === 'reshelve') reshelveBook();
  if (msg.type === 'typewriter') toggleTypewriter();
  if (msg.type === 'vim') toggleVim();
  if (msg.type === 'focus') setFocus(msg.value);
  if (msg.type === 'focusCycle') cycleFocus();
  if (msg.type === 'import') importBooks();
  if (msg.type === 'stats') openStats();
  if (msg.type === 'chapterStep') gotoChapter(msg.value);
  if (msg.type === 'writingStyle') {
    library.writingStyle = msg.value;
    await writeLibrary(library);
    if (window.neo.writingStyleState) window.neo.writingStyleState(library.writingStyle);
  }
  if (msg.type === 'coverArt') openCoverArt();
  if (msg.type === 'align') {
    applyAlign(msg.value);
  }
  if (msg.type === 'poetry') togglePoetry();
  if (msg.type === 'flush') toggleFlush();
  if (msg.type === 'uiLanguage') {
    // save every open page, then reload the window in the new language
    flushAllSaves();
    try { if (book && !$('#editor-view').hidden) sessionStorage.setItem('neo-reopen', book.id); } catch { /* a nicety */ }
    setTimeout(() => window.neo.reloadForLanguage(), 400);
  }
  if (msg.type === 'uiZoom') {
    library.uiZoom = msg.value;
    await writeLibrary(library);
    applyFonts();
  }
  if (msg.type === 'uiBright') {
    library.uiBright = !document.body.classList.contains('bright');
    await writeLibrary(library);
    applyFonts();
  }
  if (msg.type === 'pageTheme') {
    library.pageTheme = msg.value;
    await writeLibrary(library);
    applyFonts();
  }
  if (msg.type === 'fontSize') {
    await setEditorFontSize(msg.value);
  }
  if (msg.type === 'bodyFontPick') {
    const name = await pickLocalFont();
    if (name) {
      library.fonts = library.fonts || {};
      library.fonts.body = name;
      await writeLibrary(library);
    }
    applyFonts(); // also undoes a hover preview after Cancel
  }
  if (msg.type === 'bodyFont') {
    library.fonts = library.fonts || {};
    library.fonts.body = msg.value;
    await writeLibrary(library);
    applyFonts();
  }
  if (msg.type === 'dropCap') {
    library.fonts = library.fonts || {};
    library.fonts.dropcap = msg.value;
    await writeLibrary(library);
    applyFonts();
  }
});

/* ================================================================== */
/*  SAFETY NET — errors get logged, never eaten silently               */
/* ================================================================== */

let errorToastShown = false;
function reportError(msg) {
  window.neo.logError(msg);
  if (!errorToastShown) {
    errorToastShown = true;
    toast(t('Something hiccuped — your words are safe, and the details were logged'));
  }
}
window.addEventListener('error', (e) => reportError(`${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => reportError('Unhandled: ' + (e.reason && e.reason.stack || e.reason)));

/* ================================================================== */
/*  Linux body fonts                                                   */
/*  Georgia, Palatino, Baskerville, Hoefler Text, and Iowan Old Style  */
/*  are not on Linux. The bundled faces below are what the Format menu */
/*  and the first-run picker offer instead. Old libraries still resolve */
/*  the macOS names, but those names stay out of the picker.           */
/* ================================================================== */

const LINUX_BODY_FONTS = {
  'Gelasio': '"Gelasio", Georgia, "Times New Roman", serif',
  'TeX Gyre Pagella': '"TeX Gyre Pagella", Palatino, "Palatino Linotype", serif',
  'Libre Baskerville': '"Libre Baskerville", Baskerville, Georgia, serif',
  'Alegreya': '"Alegreya", "Hoefler Text", Georgia, serif',
  'Source Serif Pro': '"Source Serif Pro", "Iowan Old Style", Georgia, serif',
  'Jost': '"Jost", "Avenir Next", "Helvetica Neue", Arial, sans-serif',
  'iA Writer Quattro': '"iA Writer Quattro", "Helvetica Neue", Arial, sans-serif'
};

function installLinuxBodyFonts() {
  if (IS_MAC || /win/i.test(navigator.platform)) return;
  const legacy = {
    Georgia: LINUX_BODY_FONTS.Gelasio,
    Palatino: LINUX_BODY_FONTS['TeX Gyre Pagella'],
    Baskerville: LINUX_BODY_FONTS['Libre Baskerville'],
    'Hoefler Text': LINUX_BODY_FONTS.Alegreya,
    'Iowan Old Style': LINUX_BODY_FONTS['Source Serif Pro'],
    Cambria: LINUX_BODY_FONTS['Source Serif Pro'],
    Constantia: LINUX_BODY_FONTS['Libre Baskerville']
  };
  for (const key of Object.keys(BODY_FONTS)) delete BODY_FONTS[key];
  Object.assign(BODY_FONTS, LINUX_BODY_FONTS);
  for (const [key, stack] of Object.entries(legacy)) {
    Object.defineProperty(BODY_FONTS, key, {
      value: stack, enumerable: false, writable: true, configurable: true
    });
  }
  DROPCAP_FONTS.literary = '"Libre Bodoni", "Didot", "Bodoni 72", Georgia, serif';
  DROPCAP_FONTS.fantasy = '"TeX Gyre Chorus", "Apple Chancery", "Snell Roundhand", cursive';
  DROPCAP_FONTS.scifi = '"Jost", Futura, "Avenir Next", "Helvetica Neue", sans-serif';
  // A shared choice list, when the renderer defines one, has to name these
  // bundled faces on Linux rather than fonts the machine does not have.
  if (typeof BODY_FONT_CHOICES !== 'undefined') {
    BODY_FONT_CHOICES.splice(0, BODY_FONT_CHOICES.length, ...Object.keys(LINUX_BODY_FONTS));
  }
}
installLinuxBodyFonts();

/* ================================================================== */
/*  ACCESSIBILITY: keyboard, screen readers, system settings           */
/* ================================================================== */
// NEO stays quiet by design; these make the quiet parts reachable. The
// system's own settings decide the rest: "Increase contrast" turns on the
// Brighter Interface, "Reduce motion" stills the fades and slides.

const SYSTEM_CONTRAST = window.matchMedia('(prefers-contrast: more)');
const SYSTEM_STILL = window.matchMedia('(prefers-reduced-motion: reduce)');
SYSTEM_CONTRAST.addEventListener('change', () => applyFonts());
function scrollBehavior() { return SYSTEM_STILL.matches ? 'auto' : 'smooth'; }

// Something clickable that isn't a <button>: Tab reaches it, Enter or Space
// presses it, and a screen reader hears its name.
function pressable(el, label) {
  el.tabIndex = 0;
  if (!el.getAttribute('role')) el.setAttribute('role', 'button');
  if (label) el.setAttribute('aria-label', label);
  el.addEventListener('keydown', (e) => {
    if (e.target !== el || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
  });
}
for (const id of ['#author-chip', '#goal-counter', '#word-counter', '#pos-counter', '#zoom-level']) pressable($(id));

// The mouse leaves nothing focused in the quiet chrome, as before these were
// focusable: after a click on a book, a chapter row, a tab, a counter or a
// button there, the writer's next keys don't press it again, wake the bottom
// bar or slide a pane open. (Text fields keep focus; they always show it.)
document.addEventListener('mouseup', () => {
  const el = document.activeElement;
  if (!el || el === document.body || el.matches(':focus-visible') || el.closest('.modal-backdrop')) return;
  if (el.closest('#bottombar, #nav-pane, #side-pane, #shelf-header, #shelves')) el.blur();
}, true);

// the tabs: Enter or Space opens one, ← → move along the row
$$('.tab').forEach((tab, i, all) => {
  tab.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tab.click(); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length].focus();
    }
  });
});

// Dialogs: announced as dialogs, keyboard focus moves inside (so Esc and
// Enter reach them) and comes back to where it was when they close.
let focusBeforeDialog = null;
document.addEventListener('focusin', (e) => {
  if (e.target.closest('.modal-backdrop')) return;
  // only what the keyboard reached gets focus back when a dialog closes; after
  // a click, the next Space the writer types must not press that control again
  focusBeforeDialog = e.target.matches(':focus-visible') ? e.target : null;
}, true);
function dialogify(bd) {
  const box = bd.querySelector('.modal');
  if (!box || box.getAttribute('role')) return;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  const h = box.querySelector('h2');
  if (h) {
    h.id = h.id || 'dlg-' + Math.random().toString(36).slice(2, 9);
    box.setAttribute('aria-labelledby', h.id);
  }
  bd._returnFocus = focusBeforeDialog;
  requestAnimationFrame(() => {
    if (bd.hidden || bd.contains(document.activeElement)) return;
    const first = box.querySelector('input:not([type=hidden]), select, textarea, .m-ok, button, [tabindex="0"]');
    if (first) first.focus({ preventScroll: true });
  });
}
new MutationObserver((muts) => {
  for (const m of muts) {
    m.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.classList.contains('modal-backdrop')) dialogify(n); });
    m.removedNodes.forEach((n) => {
      const back = n._returnFocus;
      if (!back || !back.isConnected || back.isContentEditable) return; // the page restores its own caret
      if (document.activeElement && document.activeElement !== document.body) return;
      back.focus({ preventScroll: true });
    });
  }
}).observe(document.body, { childList: true });
$$('.modal-backdrop').forEach(dialogify);

// F6 walks the regions a mouse finds by hovering: the page, the chapters
// pane, the notes pane, the bottom bar. ⇧F6 walks back; Esc returns to
// the page from any of them. A pane opened this way closes when the
// keyboard leaves it, unless it is pinned.
let pagePlace = null; // where the caret was when the keyboard left the page
$('#paper-scroll').addEventListener('focusout', (e) => {
  if ($('#paper-scroll').contains(e.relatedTarget)) return;
  const sel = window.getSelection();
  if (sel.rangeCount && e.target.isContentEditable) pagePlace = { el: e.target, range: sel.getRangeAt(0).cloneRange() };
});
function focusPage() {
  if (pagePlace && pagePlace.el.isConnected && !pagePlace.el.closest('[hidden]')) {
    pagePlace.el.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(pagePlace.range);
    return;
  }
  if (currentTab === 'manuscript' && book && book.chapterOrder.length) {
    focusChapter(currentChapterId || book.chapterOrder[0]);
    return;
  }
  const aux = $('#aux-paper');
  const target = aux.querySelector('[contenteditable="true"]:not([hidden] *), button');
  if (target) target.focus();
}
function openPaneFromKeyboard(pane, first) {
  if (!pane.classList.contains('open')) { pane.classList.add('open'); pane.dataset.kbd = '1'; }
  if (first) first.focus();
}
for (const pane of [$('#nav-pane'), $('#side-pane')]) {
  pane.addEventListener('focusout', (e) => {
    if (pane.contains(e.relatedTarget) || pane.dataset.kbd !== '1') return;
    // a list rebuilt under the keyboard hands focus straight back: wait a beat
    setTimeout(() => {
      if (pane.contains(document.activeElement) || pane.dataset.kbd !== '1') return;
      pane.dataset.kbd = '0';
      if (pane.dataset.pinned !== '1' && !chapterDragActive) pane.classList.remove('open');
    }, 0);
  });
}
const REGIONS = [
  { box: () => $('#paper-scroll'), enter: focusPage },
  {
    box: () => $('#nav-pane'),
    enter: () => {
      const rows = $$('#nav-list .n-row');
      const cur = $('#nav-list .nav-item.current .n-row');
      openPaneFromKeyboard($('#nav-pane'), cur || rows[0] || $('#nav-add'));
    }
  },
  {
    box: () => $('#side-pane'),
    enter: () => openPaneFromKeyboard($('#side-pane'), $('#sticky-list textarea') || $('#side-pin'))
  },
  { box: () => $('#bottombar'), enter: () => ($('.tab.active') || $('#back-to-shelf')).focus() }
];
// F6, or ⌃Tab: on a Mac the F-keys drive brightness and sound unless fn is
// held, so F6 alone would do nothing there.
const regionKey = (e) => e.key === 'F6' || (e.key === 'Tab' && e.ctrlKey && !e.metaKey && !e.altKey);
// On the shelf: the books, then the header (author, Import, + Shelf).
const SHELF_REGIONS = [
  { box: () => $('#shelves'), enter: () => { const b = $('#shelves .book') || $('#shelves .new-book'); if (b) b.focus(); } },
  { box: () => $('#shelf-header'), enter: () => $('#author-chip').focus() }
];
document.addEventListener('keydown', (e) => {
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  if ($('#editor-view').hidden) {
    if (!regionKey(e)) return;
    e.preventDefault();
    const at = SHELF_REGIONS.findIndex((r) => r.box().contains(document.activeElement));
    SHELF_REGIONS[at < 0 ? 0 : (at + 1) % SHELF_REGIONS.length].enter();
    return;
  }
  const here = REGIONS.findIndex((r) => r.box().contains(document.activeElement));
  if (regionKey(e)) {
    e.preventDefault();
    // from nowhere in particular (a book just opened), forward starts at the page
    if (here < 0) { REGIONS[e.shiftKey ? REGIONS.length - 1 : 0].enter(); return; }
    REGIONS[(here + (e.shiftKey ? REGIONS.length - 1 : 1)) % REGIONS.length].enter();
    return;
  }
  // Esc from a pane or the bottom bar: back to the words, not to the shelf
  if (e.key === 'Escape' && !e.isComposing && here > 0 && $('#searchbar').hidden) {
    e.preventDefault();
    e.stopPropagation();
    focusPage();
  }
}, true);
// up and down the chapter list
$('#nav-list').addEventListener('keydown', (e) => {
  if (!e.target.classList.contains('n-row') || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
  e.preventDefault();
  const rows = $$('#nav-list .n-row');
  const i = rows.indexOf(e.target) + (e.key === 'ArrowDown' ? 1 : -1);
  if (rows[i]) rows[i].focus();
});

/* ================================================================== */

loadLibrary().then(() => {
  applyFonts();
  typewriterEnabled = !!library.typewriter;
  applyTypewriter();
  vimEnabled = !!library.vimKeys;
  applyVim();
  focusLevel = FOCUS_LEVELS.includes(library.focus) ? library.focus : 'off';
  applyFocus();
});
