// NEO: the Outline as index cards. The same outline as the list (chapters,
// their notes, their sections), laid out as cards to move around: moving a
// chapter's card moves the chapter in the book, moving a section's card
// moves the section, to another chapter if need be. Kept apart from app.js
// so the two can change without stepping on each other; it loads after
// app.js and shares its globals ($, t, tk, book, the outline and undo
// machinery). The view is the book's own choice: book.outlineView.

const outlineCardsOn = () => !!(book && book.outlineView === 'cards');

// List | Index cards, at the top of the Outline (quiet until the pointer or
// the keyboard comes near, like NEO's other controls)
function outlineViewSwitch(wrap) {
  const bar = document.createElement('div');
  bar.className = 'oc-switch';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', t('Outline view'));
  for (const [value, label] of [['list', tk('List')], ['cards', tk('Index cards')]]) {
    const b = document.createElement('button');
    b.textContent = t(label);
    const on = (value === 'cards') === outlineCardsOn();
    b.className = on ? 'on' : '';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.onclick = () => {
      if (on) return;
      book.outlineView = value === 'cards' ? 'cards' : undefined;
      if (!book.outlineView) delete book.outlineView;
      scheduleMetaSave();
      renderOutline();
      const again = document.querySelector(`.oc-switch button:nth-child(${value === 'cards' ? 2 : 1})`);
      if (again) again.focus();
    };
    bar.appendChild(b);
  }
  wrap.insertBefore(bar, wrap.firstChild);
}

// renderOutline asks first: the cards, when the book shows them
// oxlint-disable-next-line no-unused-vars -- called from app.js
function renderOutlineCards(focusTarget) {
  if (!outlineCardsOn()) return false;
  book.sectionNotes = book.sectionNotes || {};
  book.chapterNotes = book.chapterNotes || {};
  const wrap = $('#outline-list');
  const scroller = $('#paper-scroll');
  const keep = scroller.scrollTop;
  wrap.innerHTML = '';
  wrap.classList.add('oc-mode');

  const board = document.createElement('div');
  board.className = 'oc-board';
  let grid = null;
  const newGrid = () => { grid = document.createElement('div'); grid.className = 'oc-grid'; board.appendChild(grid); };
  newGrid();
  for (const chId of book.chapterOrder) {
    const kind = chapterKind(chId);
    if (kind === 'part') {
      board.appendChild(cardsPartBand(chId));
      newGrid();
      continue;
    }
    if (!STORY_KINDS.includes(kind)) continue;
    grid.appendChild(chapterCard(chId));
  }
  const add = document.createElement('button');
  add.className = 'oc-card oc-add-card';
  add.textContent = '+ ' + t('New chapter');
  add.onclick = () => {
    snapshotStructure('outline new chapter', { outlineFocus: null });
    const chId = createChapterAt(storyEnd());
    renderOutline();
    focusCardText(`.oc-card[data-ch-id="${chId}"] .oc-note`);
  };
  grid.appendChild(add);
  board.querySelectorAll('.oc-grid').forEach((g) => { if (!g.children.length) g.remove(); });
  wrap.appendChild(board);
  wireCardDrops(board);

  // the synopsis on top, when the story's cards are here too (bible.js)
  if (typeof bibleOutline === 'function') bibleOutline(wrap);
  outlineViewSwitch(wrap);

  const hint = document.createElement('div');
  hint.className = 'ol-hint';
  hint.textContent = t('Drag a card to move it: a chapter moves in the book, a section to wherever you drop it. Double-click a chapter to open it. Alt and the arrows move from the keyboard.');
  wrap.appendChild(hint);

  scroller.scrollTop = keep;
  if (focusTarget) {
    focusCardText(focusTarget.secId
      ? `.oc-sec[data-sec-id="${focusTarget.secId}"] .oc-sec-text`
      : `.oc-card[data-ch-id="${focusTarget.chId}"] .oc-note`);
  }
  return true;
}

function focusCardText(selector) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
  el.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
}

function cardsPartBand(chId) {
  const band = document.createElement('div');
  band.className = 'oc-part';
  band.dataset.chId = chId;
  const title = partTitleOf(chId);
  band.textContent = chapterName(chId) + (title ? ': ' + title : '');
  band.addEventListener('contextmenu', (e) => { e.preventDefault(); chapterMenu(chId, e.clientX, e.clientY, band); });
  return band;
}

// a line of text on a card: saved on leaving it, Enter leaves it, Esc puts
// back what was there
function cardText(el, text, ph, onSave) {
  el.contentEditable = 'true';
  el.spellcheck = false;
  el.textContent = text;
  el.dataset.ph = ph;
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); el.textContent = text; el.blur(); }
    e.stopPropagation();
  });
  el.addEventListener('blur', () => {
    const val = el.textContent.trim();
    if (val === text) return;
    text = val;
    onSave(val);
  });
  // a plain paste: these lines hold words, not formatting
  el.addEventListener('paste', (e) => {
    e.preventDefault();
    document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s*\n\s*/g, ' '));
  });
}

function chapterCard(chId) {
  const card = document.createElement('article');
  card.className = 'oc-card';
  card.dataset.chId = chId;

  const head = document.createElement('header');
  head.className = 'oc-head';
  head.draggable = true;
  head.tabIndex = 0;
  head.setAttribute('role', 'button');
  head.title = t('Drag to move · double-click to open');
  const num = document.createElement('span');
  num.className = 'oc-num';
  num.textContent = chapterMark(chId);
  const name = document.createElement('span');
  name.className = 'oc-title';
  name.textContent = chapterHeading(chId) || chapterName(chId);
  const words = document.createElement('span');
  words.className = 'oc-words';
  const n = chapterWords(chId);
  words.textContent = n ? t('{n} words', { n }) : '';
  head.append(num, name, words);
  head.setAttribute('aria-label', `${name.textContent}. ${t('Drag to move · double-click to open')}`);
  const open = () => { switchTab('manuscript'); focusChapter(chId); };
  head.addEventListener('dblclick', open);
  head.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); open(); return; }
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      nudgeChapter(chId, e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
    }
  });
  head.addEventListener('contextmenu', (e) => { e.preventDefault(); chapterMenu(chId, e.clientX, e.clientY, card); });
  card.appendChild(head);

  const note = document.createElement('div');
  note.className = 'oc-note';
  cardText(note, book.chapterNotes[chId] || '', t('What happens in this chapter…'), (val) => {
    book.chapterNotes[chId] = val;
    scheduleMetaSave();
    renderNav();
  });
  card.appendChild(note);

  const secs = document.createElement('div');
  secs.className = 'oc-secs';
  (book.sectionNotes[chId] || []).forEach((sec, j) => secs.appendChild(sectionCard(chId, sec, j)));
  card.appendChild(secs);

  const foot = document.createElement('div');
  foot.className = 'oc-foot';
  const addSec = document.createElement('button');
  addSec.className = 'oc-add-sec';
  addSec.textContent = '+ ' + t('Section');
  addSec.onclick = () => {
    snapshotStructure('outline new section', { outlineFocus: { chId } });
    const sec = { id: 'sec-' + Date.now().toString(36), text: '' };
    (book.sectionNotes[chId] = book.sectionNotes[chId] || []).push(sec);
    scheduleMetaSave();
    renderOutline({ secId: sec.id });
  };
  foot.appendChild(addSec);
  // who is in the chapter, when the story's cards are here too (bible.js)
  if (typeof castList === 'function' && typeof castStats === 'function') {
    const stats = castStats(chapterPlain(chId));
    const present = castList().filter((c) => stats.get(c.id)).sort((a, b) => stats.get(b.id).n - stats.get(a.id).n);
    if (present.length) {
      const who = document.createElement('div');
      who.className = 'oc-cast';
      for (const c of present.slice(0, 6)) {
        const b = document.createElement('button');
        b.className = 'ol-who';
        b.textContent = charName(c);
        b.onclick = () => openInNotes(c.id);
        who.appendChild(b);
      }
      foot.appendChild(who);
    }
  }
  card.appendChild(foot);
  return card;
}

function sectionCard(chId, sec, index) {
  const el = document.createElement('div');
  el.className = 'oc-sec';
  el.dataset.secId = sec.id;
  el.dataset.chId = chId;
  const written = sectionWritten(chId, sec.id);
  el.classList.toggle('oc-written', written);
  const grip = document.createElement('span');
  grip.className = 'oc-letter';
  grip.textContent = secLetter(index);
  grip.draggable = true;
  grip.title = written ? t('Already written in the manuscript: it stays where its text is.') : t('Drag to move');
  const text = document.createElement('span');
  text.className = 'oc-sec-text';
  cardText(text, sec.text || '', t('A scene…'), (val) => {
    sec.text = val;
    scheduleMetaSave();
    syncGhosts(chId);
  });
  text.addEventListener('keydown', (e) => {
    if (!e.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const list = book.sectionNotes[chId];
      const i = list.indexOf(sec) + (e.key === 'ArrowUp' ? -1 : 1);
      if (i >= 0 && i < list.length) moveSection(chId, sec.id, chId, i);
    } else {
      const chapters = book.chapterOrder.filter((c) => isStory(c));
      const to = chapters[chapters.indexOf(chId) + (e.key === 'ArrowLeft' ? -1 : 1)];
      if (to) moveSection(chId, sec.id, to, e.key === 'ArrowLeft' ? (book.sectionNotes[to] || []).length : 0);
    }
  });
  el.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    const choice = await optionModal(t('Delete this section?'), null,
      [{ label: t('Delete section'), desc: t('Removes the outline line and its gray ghost from the manuscript. Written prose is never touched.'), danger: true, value: 'delete' }]);
    if (choice !== 'delete') return;
    snapshotStructure('outline section removed', { outlineFocus: { chId } });
    book.sectionNotes[chId] = (book.sectionNotes[chId] || []).filter((s) => s.id !== sec.id);
    scheduleMetaSave();
    syncGhosts(chId);
    renderOutline();
  });
  el.append(grip, text);
  return el;
}

// a chapter, one place along among the story's chapters (from the keyboard)
function nudgeChapter(chId, step) {
  const chapters = book.chapterOrder.filter((c) => isStory(c));
  const other = chapters[chapters.indexOf(chId) + step];
  if (!other) return;
  moveChapter(chId, other, step > 0);
  const head = document.querySelector(`.oc-card[data-ch-id="${chId}"] .oc-head`);
  if (head) head.focus();
}

// chId goes just before (or after) target in the book: a chapter card, or a
// part's band (after it: the part's first chapter)
function moveChapter(chId, target, after) {
  if (chId === target) return;
  const order = book.chapterOrder.filter((c) => c !== chId);
  const at = order.indexOf(target);
  if (at < 0) return;
  snapshotStructure('chapter reorder');
  order.splice(at + (after ? 1 : 0), 0, chId);
  book.chapterOrder = order;
  saveMeta();
  renderChapters(); // renumbers heads and rebuilds the nav
  renderOutline();
}

// a section to another place, in its chapter or another one; one already
// written over stays with its prose
function moveSection(fromCh, secId, toCh, index) {
  if (sectionWritten(fromCh, secId)) {
    toast(t('Already written in the manuscript: it stays where its text is.'));
    return;
  }
  const from = book.sectionNotes[fromCh] || [];
  const i = from.findIndex((s) => s.id === secId);
  if (i < 0) return;
  if (fromCh === toCh && (index === i || index === i + 1)) return;
  snapshotStructure('outline section moved', { outlineFocus: { secId } });
  const [sec] = from.splice(i, 1);
  const to = (book.sectionNotes[toCh] = book.sectionNotes[toCh] || []);
  to.splice(fromCh === toCh && index > i ? index - 1 : index, 0, sec);
  scheduleMetaSave();
  syncGhosts(fromCh);
  if (toCh !== fromCh) syncGhosts(toCh);
  renderOutline({ secId });
}

// dragging: a chapter by its head, a section by its letter
function wireCardDrops(board) {
  let drag = null; // { kind: 'chapter', chId } or { kind: 'section', chId, secId }
  const clear = () => board.querySelectorAll('.oc-drop-before, .oc-drop-after, .oc-drop-in').forEach((x) => x.classList.remove('oc-drop-before', 'oc-drop-after', 'oc-drop-in'));
  board.addEventListener('dragstart', (e) => {
    const head = e.target.closest && e.target.closest('.oc-head');
    const grip = e.target.closest && e.target.closest('.oc-letter');
    if (head) {
      drag = { kind: 'chapter', chId: head.closest('.oc-card').dataset.chId };
      e.dataTransfer.setDragImage(head.closest('.oc-card'), 24, 16);
    } else if (grip) {
      const s = grip.closest('.oc-sec');
      drag = { kind: 'section', chId: s.dataset.chId, secId: s.dataset.secId };
      e.dataTransfer.setDragImage(s, 12, 12);
    } else return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-neo-card', drag.kind);
    board.classList.add('oc-dragging-' + drag.kind);
  });
  board.addEventListener('dragend', () => { clear(); drag = null; board.classList.remove('oc-dragging-chapter', 'oc-dragging-section'); });
  // where the drop would land
  const spot = (e) => {
    if (!drag) return null;
    if (drag.kind === 'chapter') {
      const band = e.target.closest('.oc-part');
      if (band) return { el: band, target: band.dataset.chId, after: true, cls: 'oc-drop-after' };
      const card = e.target.closest('.oc-card:not(.oc-add-card)');
      if (!card || card.dataset.chId === drag.chId) return null;
      const r = card.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      return { el: card, target: card.dataset.chId, after, cls: after ? 'oc-drop-after' : 'oc-drop-before' };
    }
    const sec = e.target.closest('.oc-sec');
    if (sec) {
      const r = sec.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      const list = book.sectionNotes[sec.dataset.chId] || [];
      const i = list.findIndex((s) => s.id === sec.dataset.secId);
      return { el: sec, toCh: sec.dataset.chId, index: i + (after ? 1 : 0), cls: after ? 'oc-drop-after' : 'oc-drop-before' };
    }
    const card = e.target.closest('.oc-card:not(.oc-add-card)');
    if (!card) return null;
    return { el: card, toCh: card.dataset.chId, index: (book.sectionNotes[card.dataset.chId] || []).length, cls: 'oc-drop-in' };
  };
  board.addEventListener('dragover', (e) => {
    const s = spot(e);
    clear();
    if (!s) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    s.el.classList.add(s.cls);
  });
  board.addEventListener('drop', (e) => {
    const s = spot(e);
    const d = drag;
    clear();
    if (!s || !d) return;
    e.preventDefault();
    if (d.kind === 'chapter') moveChapter(d.chId, s.target, s.after);
    else moveSection(d.chId, d.secId, s.toCh, s.index);
  });
}
