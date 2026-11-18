'use strict';

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
      const target = currentTab === 'notes'
        ? $('#notes-nav .notes-item.current') || $('#notes-nav .notes-item') || $('#nav-pin')
        : $('#nav-list .nav-item.current .n-row') || $('#nav-list .n-row') || $('#nav-add');
      openPaneFromKeyboard($('#nav-pane'), target);
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

loadLibrary().then(() => {
  applyLook();
  typewriterEnabled = !!library.typewriter;
  applyTypewriter();
  // the voices load on the first ask, which on Linux can take a moment: ask
  // now, so they are there by the time Read Aloud is (#378)
  try { if (window.speechSynthesis) window.speechSynthesis.getVoices(); } catch { /* none to ask */ }
});

// The look the features and settings govern: at launch, and again whenever
// Options turns a feature on or off. A feature that's off takes NEO's
// defaults and leaves the writer's own choices in the library for its return.
function applyLook() {
  applyFonts(); // the interface size and brightness
  nbspMarksEnabled = !!library.nbspMarks;
  applyNbspMarks();
  applyPageWidth();
  pagedEnabled = featureOn('pages') && !!library.pagedView;
  twoPageEnabled = featureOn('pages') && !!library.twoPageView;
  applyPageZoom(); // the page zoom's range depends on the pages
  applyPaged();
  vimEnabled = featureOn('vim');
  applyVim();
  focusLevel = featureOn('focus') && FOCUS_LEVELS.includes(library.focus) ? library.focus : 'off';
  applyFocus();
}
