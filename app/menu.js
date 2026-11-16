'use strict';

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
  refreshDropCaps(true);
  document.body.classList.toggle('night', library.pageTheme === 'night');
  // Light: the paper page in a light room, the whole app with it
  document.body.classList.toggle('light', library.pageTheme === 'light');
  // the system's "Increase contrast" turns it on too, until the writer
  // chooses in the View menu
  applyBright();
  // View → Interface Size: everything but the page, in tenths (#364)
  const uiZoom = snapZoom(library.uiZoom);
  document.documentElement.style.setProperty('--ui-zoom', uiZoom);
  document.documentElement.classList.toggle('ui-zoomed', uiZoom > 1);
  if (window.neo.uiZoomState) window.neo.uiZoomState(uiZoom);
  const size = Math.min(EDITOR_SIZE_MAX, Math.max(EDITOR_SIZE_MIN, library.editorFontSize || 17));
  document.documentElement.style.setProperty('--editor-size', size + 'px');
  applyPageZoom();
  queueSoftHyphenTicks(); // another face can wrap the same lines differently
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
function updateZoomDisplay() {
  const el = $('#zoom-level');
  // on the outline's cards, the zoom is the cards' size
  const z = boardShowing() ? cardZoom() : activePageZoom();
  if (el) el.textContent = Math.round(z * 100) + '%';
}
const boardShowing = () => !!book && currentTab === 'outline' && $('#editor-view').classList.contains('board-on');
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
  // never grows past the window (max-width in styles.css), only the type does;
  // in the Pages view a page keeps its shape, and a window too small for it scrolls.
  const range = pageZoomRange();
  next = Math.min(range.max, Math.max(range.min, next));
  if (next === activePageZoom()) return;
  rememberZoom(pageZoomKey(), next);
  keepReadingPlace(() => {
    document.documentElement.style.setProperty('--page-zoom', next);
    fitSpread(); // two pages to a row, or back to one
    queuePages(true);
  }, at);
  updateZoomDisplay();
}
let cardWheel = 0;
let pageWheel = 0;
$('#editor-view').addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  if (boardShowing()) {
    // a pinch steps the cards a size at a time
    cardWheel += e.deltaY;
    if (Math.abs(cardWheel) > 40) { stepCardZoom(cardWheel < 0 ? 1 : -1); cardWheel = 0; }
    return;
  }
  // …and the page a tenth at a time (#336: a smooth pinch left it at 101%)
  pageWheel += e.deltaY;
  if (Math.abs(pageWheel) > 40) {
    setPageZoom(tenth(activePageZoom() + (pageWheel < 0 ? 0.1 : -0.1)), { x: e.clientX, y: e.clientY });
    pageWheel = 0;
  }
}, { passive: false });
let shelfWheel = 0;
$('#bookshelf-view').addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  shelfWheel += e.deltaY;
  if (Math.abs(shelfWheel) > 40) { stepShelfZoom(shelfWheel < 0 ? 1 : -1); shelfWheel = 0; }
}, { passive: false });

// zoom control in the bottom bar: buttons, click-to-reset, and scroll
$('#zoom-in').onclick = () => (boardShowing() ? stepCardZoom(1) : setPageZoom(tenth(activePageZoom() + 0.1)));
$('#zoom-out').onclick = () => (boardShowing() ? stepCardZoom(-1) : setPageZoom(tenth(activePageZoom() - 0.1)));
$('#zoom-level').onclick = () => (boardShowing() ? stepCardZoom(0) : setPageZoom(1));
$('#zoom-control').addEventListener('wheel', (e) => {
  e.preventDefault();
  if (boardShowing()) {
    cardWheel += e.deltaY;
    if (Math.abs(cardWheel) > 40) { stepCardZoom(cardWheel < 0 ? 1 : -1); cardWheel = 0; }
    return;
  }
  setPageZoom(activePageZoom() * Math.exp(-e.deltaY * 0.002));
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
  reportViewState(); // the Format menu's alignment tick
}

// Format → Align Book Prose: one structural undo, with special pages and
// deliberately formatted poetry/flush lines left as they were.
function alignedProseHtml(html, value) {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  let changed = false;
  for (const p of holder.querySelectorAll(':scope > p')) {
    if (p.matches('.scene-break, .ghost, .poetry, .flush, .litrpg') || [...p.classList].some((c) => c.startsWith('sp-'))) continue;
    const target = value === 'left' ? '' : value;
    if (p.style.textAlign === target) continue;
    if (target) p.style.textAlign = target;
    else p.style.removeProperty('text-align');
    if (!p.getAttribute('style')) p.removeAttribute('style');
    changed = true;
  }
  return changed ? captureBody(holder) : null;
}
function alignBookProse(value) {
  if (!featureOn('formatting') || !book || isScript() || !['left', 'center', 'right', 'justify'].includes(value)) return 0;
  const changes = [];
  for (const chId of book.chapterOrder) {
    if (!STORY_KINDS.includes(chapterKind(chId))) continue;
    const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
    const html = body ? captureBody(body) : chapterHTML[chId];
    if (typeof html !== 'string') continue; // a chapter still arriving from sync
    const next = alignedProseHtml(html, value);
    if (next !== null) changes.push([chId, next]);
  }
  if (!changes.length) return 0;
  if (currentTab !== 'manuscript') switchTab('manuscript');
  const caret = captureCaret();
  const keepScroll = $('#paper-scroll').scrollTop;
  const releaseDay = holdDay();
  snapshotStructure('book alignment');
  for (const [chId, html] of changes) {
    chapterHTML[chId] = html;
    wordCache[chId] = null;
    scheduleChapterSave(chId);
  }
  renderChapters();
  restoreCaret(caret);
  $('#paper-scroll').scrollTop = keepScroll;
  releaseDay();
  sealUndo(undoStack[undoStack.length - 1]);
  resetNativeUndo();
  reportViewState();
  return changes.length;
}

// Menu accelerators and editor shortcuts, plus NEO's distinct writing gestures.
// Routine text entry, cursor movement and dialog controls are intentionally omitted.
function shortcutSections() {
  // with a script open, its keys come first, in place of a book's
  if (book && isScript()) {
    const sections = bookShortcutSections();
    sections[0] = { title: tk('Writing a script'), rows: [
      [tk('Enter'), tk('The next line: a speech after a name, action after a speech'), tk('On an empty line, Enter changes what it is: action becomes a character, so Enter twice after a speech brings in the next speaker. Enter again takes the gray name.')],
      ['Tab', tk('Take the gray suggestion, or step to the next element'), tk('In a speech, Tab trades dialogue and parenthetical. Shift+Tab steps back.')],
      ['→', tk('Take the gray suggestion')],
      [K('⌘1–⌘7', 'Ctrl+1–Ctrl+7'), tk('Scene heading, action, character, parenthetical, dialogue, transition, shot')],
      [['INT.', 'EXT.'], tk('At the start of a line: a scene heading')],
      [KPH, tk('Insert a placeholder note')],
      [KDA, tk('Move selected text to Darlings')]
    ] };
    return sections;
  }
  return bookShortcutSections();
}
function bookShortcutSections() {
  // a feature's keys show while the feature is on (Options)
  const on = featureOn;
  return [
    { title: tk('Writing'), rows: [
      [tk('Enter ×2'), tk('Insert a section break')],
      [tk('Enter ×3'), tk('Start a new chapter')],
      [K('⇧Enter', 'Shift+Enter'), tk('A paragraph with no indent'), tk('Again for another; Enter goes back to prose.')],
      ...(on('poetry') ? [[K('⌘⇧Enter', 'Ctrl+Shift+Enter'), tk('Start or continue a poetry paragraph'), tk('Also works from a chapter heading.')]] : []),
      [['[['], tk('At the start of a line: a LitRPG box'), tk('For rolls, stats and system messages. Enter on an empty last line ends the box; ⇧Enter adds a blank line inside it.')],
      [KPH, tk('Insert a placeholder note')],
      ...(on('footnotes') ? [[KFN, tk('Add a footnote'), tk('Type the note, then Enter to go back to writing. Click its number to change it.')]] : []),
      [KDA, tk('Move selected text to Darlings')],
      ...(on('readAloud') ? [[K('⌘⇧U', IS_LINUX ? 'Ctrl+Shift+K' : 'Ctrl+Shift+U'), tk('Read aloud from the cursor'), tk('Again, Esc or any key stops it. Uses your computer’s own voice.')]] : [])
    ] },
    { title: tk('Formatting'), rows: [
      ...(!markdownOff() ? [[['*…*', '**…**', '***…***'], tk('Italic, bold, the Markdown way'), tk('Typed around a word (or pasted). Undo right after keeps the asterisks. Options turns it off.')]] : []),
      [K('⌘U', 'Ctrl+U'), tk('Underline')],
      [K('⌘⇧S', 'Ctrl+Shift+S'), tk('Strikethrough'), !markdownOff() ? tk('Or ~~…~~ around the words.') : undefined],
      ...(on('formatting') ? [
        [K('⌘⇧L', 'Ctrl+Shift+L'), tk('Align paragraph left')],
        [K('⌘⇧C', 'Ctrl+Shift+C'), tk('Center paragraph')],
        [K('⌘⇧R', 'Ctrl+Shift+R'), tk('Align paragraph right')],
        [K('⌘⇧J', 'Ctrl+Shift+J'), tk('Justify paragraph')]
      ] : []),
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
      [K('⌘S', 'Ctrl+S'), tk('Take a snapshot of the book'), tk('NEO saves as you type; a snapshot keeps the book as it stands now. They’re on the Darlings tab.')],
      [K('⌘,', 'Ctrl+,'), tk('Goals and writing sprints')],
      [K('⌘⇧I', 'Ctrl+Shift+I'), tk('Import manuscripts')],
      [K('⌘E', 'Ctrl+E'), tk('Email a draft to yourself')]
    ] },
    { title: tk('View & window'), rows: [
      [[K('⌘⇧F', 'Ctrl+Shift+F'), K('⌘Enter', 'Ctrl+Enter'), ...(IS_MAC ? [] : ['F11'])], tk('Toggle full screen')],
      [K('⌘⇧T', 'Ctrl+Shift+T'), tk('Toggle typewriter scrolling')],
      ...(on('focus') ? [[K('⌘⇧O', 'Ctrl+Shift+O'), tk('Cycle focus mode'), tk('Off → paragraph → sentence → off.')]] : []),
      [IS_MAC ? '⌥⌘↓' : ['Ctrl+Alt+↓', 'Ctrl+Page Down'], tk('Go to the next chapter')],
      [IS_MAC ? '⌥⌘↑' : ['Ctrl+Alt+↑', 'Ctrl+Page Up'], tk('Go to the previous chapter')],
      [K('⌥⌘→', 'Ctrl+Alt+→'), tk('Go to the next tab'), tk('Manuscript, Notes, Outline, Darlings, then round again.')],
      [K('⌥⌘←', 'Ctrl+Alt+←'), tk('Go to the previous tab')],
      [['F6', K('⌃Tab', 'Ctrl+Tab')], tk('Move between the page, the chapters, the notes and the bottom bar'), tk('Add Shift to go back. Esc returns to the page. On the shelf: the books, then the header.')],
      ...(IS_MAC ? [
        ['⌘H', tk('Hide NEO')],
        ['⌘⌥H', tk('Hide other apps')]
      ] : [])
    ] },
    // only for writers who turned them on (Options)
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
      ['/', tk('Find')],
      ['n N', tk('Next or previous match')]
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
