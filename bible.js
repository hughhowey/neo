// NEO: the story's cards (characters, the world, pictures), kept under the
// Notes, and what they add to the page (/ in the notes, @ while writing,
// who is in this chapter, renames that reach the text). Kept apart from app.js so the two can change without
// stepping on each other; it loads after app.js and shares its globals
// ($, t, tk, book, library, the save and undo machinery).

// Yes or no, in the same dialog as a name is asked in: Cancel, and the
// action spelled out on the other button. Resolves true or false.
function confirmModal(title, message, okLabel, { danger = false } = {}) {
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `
      <div class="modal" style="width:380px">
        <h2 style="font-size:16px"></h2>
        <p></p>
        <div style="text-align:right;margin-top:14px">
          <button class="m-cancel btn-quiet" style="margin-right:10px"></button>
          <button class="m-ok ${danger ? 'btn-danger' : 'btn-gold'}"></button>
        </div>
      </div>`;
    bd.querySelector('h2').textContent = title;
    bd.querySelector('p').textContent = message;
    bd.querySelector('.m-cancel').textContent = t('Cancel');
    const ok = bd.querySelector('.m-ok');
    ok.textContent = okLabel;
    document.body.appendChild(bd);
    const done = (v) => { bd.remove(); resolve(v); };
    ok.onclick = () => done(true);
    bd.querySelector('.m-cancel').onclick = () => done(false);
    bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } });
    bd.querySelector('.m-cancel').focus();
  });
}

// The whole story in a few paragraphs, above the chapter lines: the first
// thing a planner writes, and shared with a bound book's other parts.
function outlineSynopsis() {
  const box = document.createElement('label');
  box.className = 'ol-synopsis';
  const span = document.createElement('span');
  span.textContent = t('Synopsis');
  const el = document.createElement('textarea');
  el.rows = 1;
  el.spellcheck = false;
  el.placeholder = t('The whole story in a few paragraphs, beginning to end');
  el.value = storyBible().synopsis || '';
  el.addEventListener('input', () => growField(el));
  el.addEventListener('keydown', (e) => e.stopPropagation()); // Enter makes a new line here, not a chapter
  el.addEventListener('change', () => { storyBible().synopsis = el.value.trim(); castChanged(); });
  box.append(span, el);
  requestAnimationFrame(() => growField(el));
  return box;
}

/* ================================================================== */
/*  CHARACTERS                                                         */
/* ================================================================== */
/*  The book keeps a cast: first name, last name, nicknames, a note.   */
/*  The text itself stays plain words. NEO finds the names in it, so   */
/*  a name typed by hand counts as much as one picked after an @, and  */
/*  a rename can reach every page of the book.                         */

const castId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const castFold = (s) => (s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const castKey = (s) => (s || '').replace(/[’‘]/g, "'");

function castList() {
  if (!book) return [];
  if (!Array.isArray(book.characters)) book.characters = [];
  book.characters.forEach(migratePictures);
  return book.characters;
}

function charName(c) {
  return [c.first, c.last].filter(Boolean).join(' ') || (c.nicknames || [])[0] || t('Unnamed');
}

// every way the book may call a character, the full name first
function charForms(c) {
  const out = [];
  const add = (f) => { f = (f || '').trim(); if (f && !out.includes(f)) out.push(f); };
  if (c.first && c.last) add(c.first + ' ' + c.last);
  add(c.first);
  add(c.last);
  (c.nicknames || []).forEach(add);
  return out;
}

// a whole-word pattern for some names; straight and curly apostrophes match alike
function formPattern(forms) {
  const alts = [...forms].sort((a, b) => b.length - a.length)
    .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’‘]/g, "['’‘]"));
  return new RegExp(`(?<![\\p{L}\\p{N}_])(${alts.join('|')})(?![\\p{L}\\p{N}_])`, 'gu');
}

let castMatcherCache = { sig: null, re: null, owner: null };
function castMatcher() {
  const cast = castList();
  const sig = JSON.stringify(cast.map((c) => [c.id, charForms(c)]));
  if (castMatcherCache.sig === sig) return castMatcherCache;
  const owner = new Map();
  for (const c of cast) for (const f of charForms(c)) if (!owner.has(castKey(f))) owner.set(castKey(f), c.id);
  castMatcherCache = { sig, re: owner.size ? formPattern([...owner.keys()]) : null, owner };
  return castMatcherCache;
}

// id -> { n, forms: { form: count } }
function castStats(text) {
  const out = new Map();
  const { re, owner } = castMatcher();
  if (!re || !text) return out;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    const id = owner.get(castKey(m[1]));
    if (!id) continue;
    const s = out.get(id) || { n: 0, forms: {} };
    s.n++;
    s.forms[m[1]] = (s.forms[m[1]] || 0) + 1;
    out.set(id, s);
  }
  return out;
}

// (chapterBodyEl is app.js's own)

// the words of a chapter, a line per paragraph (ghost outline lines left out)
function chapterPlain(chId) {
  let body = chapterBodyEl(chId);
  if (!body) {
    body = document.createElement('div');
    body.innerHTML = chapterHTML[chId] || '';
  }
  const paras = [...body.children];
  if (!paras.length) return body.textContent;
  return paras.filter((p) => !p.classList.contains('ghost')).map((p) => p.textContent).join('\n');
}

/* --- In the Notes & Comments pane: who is in this chapter ---------- */

let castTimer = null;
function scheduleCast() {
  clearTimeout(castTimer);
  castTimer = setTimeout(renderCast, 400);
}

function renderCast() {
  const strip = $('#cast-strip');
  if (!strip) return;
  const cast = book ? castList() : [];
  if (!book || !cast.length || !currentChapterId || !book.chapterOrder.includes(currentChapterId)) {
    strip.hidden = true;
    return;
  }
  const stats = castStats(chapterPlain(currentChapterId));
  strip.hidden = false;
  strip.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'cs-head';
  head.textContent = t('In this chapter');
  strip.appendChild(head);
  const present = cast.filter((c) => stats.get(c.id)).sort((a, b) => stats.get(b.id).n - stats.get(a.id).n);
  if (!present.length) {
    const none = document.createElement('div');
    none.className = 'cs-none';
    none.textContent = t('No character named here yet.');
    strip.appendChild(none);
    return;
  }
  const names = document.createElement('div');
  names.className = 'cs-names';
  for (const c of present) {
    const s = stats.get(c.id);
    const b = document.createElement('button');
    b.className = 'cs-name';
    b.innerHTML = '<span class="cs-label"></span> <span class="cs-count"></span>';
    b.querySelector('.cs-label').textContent = charName(c);
    b.querySelector('.cs-count').textContent = fmtNum(s.n);
    const used = Object.entries(s.forms).map(([f, n]) => `${f} ×${n}`).join(', ');
    b.title = used + '\n' + t('Click to read the card here');
    b.setAttribute('aria-label', `${charName(c)}, ${fmtNum(s.n)}. ${used}`);
    b.classList.toggle('on', castPeek === c.id);
    b.setAttribute('aria-pressed', castPeek === c.id ? 'true' : 'false');
    b.onclick = () => { castPeek = castPeek === c.id ? null : c.id; renderCast(); };
    names.appendChild(b);
  }
  strip.appendChild(names);
  const peeked = castPeek && cast.find((c) => c.id === castPeek);
  if (peeked) strip.appendChild(castPeekCard(peeked));
}

// The card, to read while writing: what the bible holds on this person,
// filled fields only, and the way to the next mention or the full card.
let castPeek = null;
function castPeekCard(c) {
  const box = document.createElement('div');
  box.className = 'cast-peek';
  const head = document.createElement('div');
  head.className = 'cp-head';
  if (c.portrait && canBibleImages()) {
    const img = document.createElement('img');
    img.className = 'cp-portrait';
    img.alt = '';
    loadInto(img, c.portrait);
    head.appendChild(img);
  }
  const who = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'cp-name';
  name.textContent = charName(c);
  who.appendChild(name);
  const facts = [c.role, c.gender, c.age].filter((x) => (x || '').trim());
  const sub = [facts.join(' · '), (c.nicknames || []).join(', ')].filter(Boolean);
  for (const line of sub) {
    const d = document.createElement('div');
    d.className = 'cp-sub';
    d.textContent = line;
    who.appendChild(d);
  }
  head.appendChild(who);
  box.appendChild(head);
  if ((c.note || '').trim()) {
    const n = document.createElement('div');
    n.className = 'cp-note';
    n.textContent = c.note;
    box.appendChild(n);
  }
  for (const [f, label] of CAST_DETAILS.filter(([f]) => !['role', 'gender', 'age'].includes(f))) {
    const v = (c[f] || '').trim();
    if (!v) continue;
    const row = document.createElement('div');
    row.className = 'cp-field';
    const l = document.createElement('div');
    l.className = 'cp-label';
    l.textContent = t(label);
    const tx = document.createElement('div');
    tx.className = 'cp-text';
    tx.textContent = v;
    row.append(l, tx);
    box.appendChild(row);
  }
  const acts = document.createElement('div');
  acts.className = 'cp-actions';
  const next = document.createElement('button');
  next.textContent = t('Next mention');
  next.onclick = () => jumpToCharacter(c.id);
  const open = document.createElement('button');
  open.textContent = openInNotesLabel();
  open.onclick = () => openInNotes(c.id);
  acts.append(next, open);
  box.appendChild(acts);
  return box;
}

// the card, open in full, under the notes (which arrive from disk: the
// card is shown once they are in)
let notesFocus = null;
function openInNotes(id) {
  bibleMore.add(id);
  bibleOpen.add(id);
  notesFocus = id;
  if (currentTab === 'notes') { renderCharacters(); showNotesFocus(); } else switchTab('notes');
}
function showNotesFocus() {
  const id = notesFocus;
  notesFocus = null;
  const card = id && document.querySelector(`#characters-list [data-id="${id}"]`);
  if (!card) return;
  card.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
  card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 1200);
}
const openInNotesLabel = () => t('Open in {tab}', { tab: tabName('notes') });

// the next mention after the caret in the current chapter, round to the top
function jumpToCharacter(id) {
  const c = castList().find((x) => x.id === id);
  const body = currentChapterId && chapterBodyEl(currentChapterId);
  if (!c || !body) return;
  const re = formPattern(charForms(c));
  const sel = window.getSelection();
  let caret = null;
  if (sel.rangeCount && body.contains(sel.anchorNode)) {
    caret = sel.getRangeAt(0).cloneRange();
    caret.collapse(false); // from the end of a selection: a second click moves on
  }
  let first = null;
  let next = null;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode()) && !next) {
    if (node.parentElement.closest('.ghost')) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(node.textContent))) {
      const r = document.createRange();
      r.setStart(node, m.index);
      r.setEnd(node, m.index + m[1].length);
      if (!first) first = r;
      if (!caret || caret.comparePoint(node, m.index) >= 0) { next = r; break; }
    }
  }
  const target = next || first;
  if (!target) return;
  body.focus({ preventScroll: true });
  sel.removeAllRanges();
  sel.addRange(target);
  const rect = target.getBoundingClientRect();
  const sr = $('#paper-scroll').getBoundingClientRect();
  if (rect.top < sr.top + 40 || rect.bottom > sr.bottom - 40) {
    const el = target.startContainer.parentElement;
    el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  }
}

/* --- The Characters tab -------------------------------------------- */

function bookCastStats() {
  const out = new Map();
  book.chapterOrder.forEach((chId) => {
    for (const [id, s] of castStats(chapterPlain(chId))) {
      const o = out.get(id) || { n: 0, chapters: 0, first: null };
      o.n += s.n;
      o.chapters++;
      if (!o.first) o.first = chId;
      out.set(id, o);
    }
  });
  return out;
}

function castMetaText(s) {
  if (!s) return t('Not in the text yet');
  return [
    t('Mentions: {n}', { n: fmtNum(s.n) }),
    t('Chapters: {n}', { n: fmtNum(s.chapters) }),
    t('First appears: {ch}', { ch: chapterName(s.first) })
  ].join(' · ');
}

/* --- The cards, under the notes: characters, then the world ------- */
/*  Only characters are recognized in the text (@, the chapter pane,  */
/*  renames). The world is reference: typed cards to read and fill,   */
/*  folded until opened. / in the notes makes a card.                  */

// The synopsis lives at the top of the Outline now. These older fields show
// under the notes only while they hold words, so nothing written disappears.
const STORY_FIELDS = [
  ['braindump', tk('Braindump'), '', true],
  ['genre', tk('Genre'), '', false],
  ['style', tk('Style'), '', true]
];
const storyShown = () => STORY_FIELDS.filter(([f]) => (storyBible()[f] || '').trim());

// every type of world card: its name, then its fields [key, label, placeholder]
const WORLD_TYPES = {
  place: [tk('Place'), [['description', tk('Description'), ''], ['mood', tk('Atmosphere'), tk('Sounds, smells, light')], ['happens', tk('What happens there'), '']]],
  item: [tk('Item'), [['description', tk('Description'), ''], ['owner', tk('Who owns it'), ''], ['matters', tk('Why it matters'), '']]],
  group: [tk('Group'), [['description', tk('Description'), tk('A family, a clan, a company, a crew…')], ['members', tk('Members'), ''], ['goal', tk('Goal'), '']]],
  clue: [tk('Clue'), [['description', tk('Description'), ''], ['implications', tk('Implications'), tk('What it reveals, and to whom')], ['knows', tk('Who knows'), '']]],
  system: [tk('System'), [['principle', tk('How it works'), tk('Magic, technology, society, religion, and its rules')], ['limits', tk('Limits and cost'), '']]],
  event: [tk('Event'), [['when', tk('When'), ''], ['what', tk('What happened'), ''], ['consequences', tk('Consequences'), '']]],
  other: [tk('Other'), [['description', tk('Description'), '']]]
};

const bibleMore = new Set(); // cards showing all their details (gallery, counts, empty fields)
const bibleOpen = new Set(); // world cards unfolded this session

function worldList() {
  if (!book) return [];
  if (!Array.isArray(book.world)) book.world = [];
  book.world.forEach(migratePictures);
  return book.world;
}
function storyBible() {
  if (!book) return {};
  if (!book.story || typeof book.story !== 'object') book.story = {};
  return book.story;
}
const worldTypeName = (type) => t((WORLD_TYPES[type] || WORLD_TYPES.other)[0]);

function bibleSection(key, title) {
  const sec = document.createElement('section');
  sec.className = 'bible-section';
  sec.dataset.sec = key;
  const h = document.createElement('h3');
  h.className = 'bible-h';
  h.textContent = title;
  sec.appendChild(h);
  return sec;
}

// The rubrics, in the order they stand under the notes. A rubric shows
// once it holds a card; / in the notes makes the first one.
const RUBRICS = [
  ['cast', tk('Characters'), tk('Character')],
  ['place', tk('Places')], ['item', tk('Items')], ['group', tk('Groups')], ['clue', tk('Clues')],
  ['system', tk('Systems')], ['event', tk('Events')], ['other', tk('Miscellaneous')]
];
const rubricCards = (key) => (key === 'cast' ? castList()
  : worldList().filter((w) => (WORLD_TYPES[w.type] ? w.type : 'other') === key));

function renderCharacters(focusId) {
  const wrap = $('#characters-list');
  const scroller = $('#paper-scroll');
  const keep = scroller.scrollTop;
  wrap.innerHTML = '';
  const cast = castList();
  const world = worldList();

  if (!cast.length && !world.length && !storyShown().length) {
    const hint = document.createElement('div');
    hint.className = 'notes-hint';
    hint.textContent = t('Type / for a character, a place, a picture, a heading…');
    wrap.append(hint, notesActions());
    renderNotesToc();
    return;
  }

  if (castPeers.length) {
    const shared = document.createElement('div');
    shared.className = 'cast-shared';
    shared.textContent = t('These cards are shared by every part of this bound book.');
    wrap.appendChild(shared);
  }

  // the older story fields, while they hold words
  if (storyShown().length) {
    const story = bibleSection('story', t('The story'));
    const sc = document.createElement('div');
    sc.className = 'story-card';
    const sb = storyBible();
    for (const [f, label, ph, long] of storyShown()) {
      const field = document.createElement('label');
      field.className = 'cc-field';
      const span = document.createElement('span');
      span.textContent = t(label);
      const el = document.createElement(long ? 'textarea' : 'input');
      el.spellcheck = false;
      el.placeholder = t(ph);
      if (long) { el.rows = 1; el.addEventListener('input', () => growField(el)); }
      el.value = sb[f] || '';
      el.addEventListener('change', () => { storyBible()[f] = el.value.trim(); el.value = storyBible()[f]; castChanged(); });
      field.append(span, el);
      sc.appendChild(field);
    }
    story.appendChild(sc);
    wrap.appendChild(story);
  }

  const stats = cast.length ? bookCastStats() : new Map();
  for (const [key, title] of RUBRICS) {
    const items = rubricCards(key);
    if (!items.length) continue;
    const sec = bibleSection(key, t(title));
    const add = document.createElement('button');
    add.className = 'rubric-add';
    add.textContent = '+';
    const what = key === 'cast' ? t('Character') : worldTypeName(key);
    add.title = t('New card: {type}', { type: what });
    add.setAttribute('aria-label', add.title);
    add.onclick = () => (key === 'cast' ? addCharacter() : addWorld(key));
    sec.querySelector('.bible-h').appendChild(add);
    const list = document.createElement('div');
    list.className = 'bible-cards';
    for (const o of items) list.appendChild(key === 'cast' ? characterCard(o, stats.get(o.id)) : worldCard(o));
    sec.appendChild(list);
    // a world rubric holds one type: reordering moves the card among its own kind
    wireReorder(list, key === 'cast' ? castList : () => worldReorderView(key));
    wrap.appendChild(sec);
  }

  wrap.appendChild(notesActions());

  scroller.scrollTop = keep;
  requestAnimationFrame(() => wrap.querySelectorAll('textarea').forEach(growField));
  renderNotesToc();

  if (focusId) {
    const card = wrap.querySelector(`[data-id="${focusId}"]`);
    const input = card && card.querySelector('input');
    if (input) { input.focus({ preventScroll: true }); card.scrollIntoView({ block: 'center', behavior: scrollBehavior() }); }
  }
}

// at the foot of the notes: bring cards in, send the notes out
function notesActions() {
  const row = document.createElement('div');
  row.className = 'notes-actions';
  const imp = document.createElement('button');
  imp.className = 'cast-import-btn';
  imp.textContent = t('Import cards from another book…');
  imp.onclick = () => importCharacters();
  const exp = document.createElement('button');
  exp.className = 'cast-import-btn';
  exp.textContent = t('Export the notes…');
  exp.onclick = () => exportNotes();
  row.append(imp, exp);
  return row;
}

// reordering inside one world rubric: a view of that type's cards whose
// splices land back in the book's single world list, others left in place
function worldReorderView(key) {
  const all = worldList();
  const mine = rubricCards(key);
  const view = mine.slice();
  view.splice = (...args) => {
    const out = Array.prototype.splice.apply(view, args);
    if (view.length !== mine.length) return out; // the card is in hand, not yet dropped
    const slots = all.map((w, i) => (mine.includes(w) ? i : -1)).filter((i) => i >= 0);
    slots.forEach((slot, j) => { all[slot] = view[j]; });
    return out;
  };
  return view;
}

function worldCard(w) {
  const card = document.createElement('div');
  card.className = 'world-card';
  card.dataset.id = w.id;
  const open = bibleOpen.has(w.id);
  card.classList.toggle('wc-open', open);
  const [, fields] = WORLD_TYPES[w.type] || WORLD_TYPES.other;
  card.innerHTML = `
    <div class="wc-head">
      <span class="drag-grip" aria-hidden="true">⋮⋮</span>
      <button class="wc-fold"></button>
      <input class="wc-name" spellcheck="false" />
      <select class="wc-type"></select>
    </div>
    <div class="wc-summary"></div>
    <div class="wc-body"></div>`;
  const fold = card.querySelector('.wc-fold');
  fold.textContent = open ? '▾' : '▸';
  fold.setAttribute('aria-expanded', open ? 'true' : 'false');
  fold.setAttribute('aria-label', open ? t('Fold') : t('Unfold'));
  fold.onclick = () => {
    if (bibleOpen.has(w.id)) bibleOpen.delete(w.id); else bibleOpen.add(w.id);
    card.replaceWith(worldCard(w));
  };
  const name = card.querySelector('.wc-name');
  name.value = w.name || '';
  name.placeholder = t('Name');
  name.setAttribute('aria-label', t('Name'));
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
  name.addEventListener('change', () => { w.name = name.value.trim(); castChanged(); });
  wirePictureDrop(card, w, 'gallery');
  const type = card.querySelector('.wc-type');
  type.setAttribute('aria-label', t('Type'));
  for (const k of Object.keys(WORLD_TYPES)) {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = worldTypeName(k);
    type.appendChild(o);
  }
  type.value = WORLD_TYPES[w.type] ? w.type : 'other';
  type.onchange = () => { w.type = type.value; castChanged(); bibleOpen.add(w.id); card.replaceWith(worldCard(w)); };

  // folded: the first thing written says what the card is
  const first = [...fields.map((f) => f[0]), 'notes'].map((f) => (w[f] || '').trim()).find(Boolean);
  const summary = card.querySelector('.wc-summary');
  summary.textContent = first ? first.split('\n')[0] : '';
  summary.hidden = open || !first;

  const body = card.querySelector('.wc-body');
  body.hidden = !open;
  if (open) {
    const all = bibleMore.has(w.id);
    for (const [f, label, ph] of [...fields, ['notes', tk('Notes'), tk('Anything else')]]) {
      const field = document.createElement('label');
      field.className = 'cc-field';
      field.hidden = !all && !(w[f] || '').trim();
      const span = document.createElement('span');
      span.textContent = t(label);
      const el = document.createElement('textarea');
      el.rows = 1;
      el.spellcheck = false;
      if (ph) el.placeholder = t(ph);
      el.value = w[f] || '';
      el.addEventListener('input', () => growField(el));
      el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); el.value = w[f] || ''; el.blur(); } });
      el.addEventListener('change', () => { w[f] = el.value.trim(); castChanged(); });
      field.append(span, el);
      body.appendChild(field);
    }
    const meta = document.createElement('div');
    meta.className = 'cc-meta';
    const del = document.createElement('button');
    del.className = 'cc-del';
    del.textContent = t('Delete');
    del.onclick = () => deleteWorld(w);
    const gallery = gallerySection(w);
    if (gallery && all) body.appendChild(gallery);
    const btns = document.createElement('span');
    btns.className = 'cc-buttons';
    const more = document.createElement('button');
    more.className = 'cc-more';
    more.textContent = all ? t('Fewer details') : t('More details');
    more.setAttribute('aria-expanded', all ? 'true' : 'false');
    more.onclick = () => {
      if (all) bibleMore.delete(w.id); else bibleMore.add(w.id);
      const again = worldCard(w);
      card.replaceWith(again);
      const f = again.querySelector('.wc-body .cc-more');
      if (f) f.focus();
    };
    btns.append(more, del);
    meta.append(document.createElement('span'), btns);
    body.appendChild(meta);
    requestAnimationFrame(() => body.querySelectorAll('textarea').forEach(growField));
  }
  return card;
}

function addWorld(type) {
  const w = { id: castId(), type, name: '' };
  worldList().push(w);
  bibleOpen.add(w.id);
  bibleMore.add(w.id);
  castChanged();
  renderCharacters(w.id);
  return w;
}

async function deleteWorld(w) {
  if (!await confirmModal(t('Delete this card?'), t('{name} leaves your notes.', { name: w.name || worldTypeName(w.type) }), t('Delete'), { danger: true })) return;
  snapshotStructure(t('Delete'));
  book.world = worldList().filter((x) => x.id !== w.id);
  book.worldRemoved = [...new Set([...(book.worldRemoved || []), w.id])];
  castChanged();
  renderCharacters();
  toast(t('{name} left your notes, {key} to undo', { name: w.name || worldTypeName(w.type), key: KZ }));
}

/* --- Pictures: a portrait for a character, a gallery for any card -- */
/*  Dropped from the Finder on a card, or picked from a dialog. NEO    */
/*  copies each into the book's own bible/ folder (the book travels    */
/*  whole). A character's portrait sits in a circle at the top; the    */
/*  gallery runs along the bottom of every card.                       */

const bibleImgCache = new Map();
const canBibleImages = () => !!(window.neo && window.neo.bibleSetImage);

// cards made before galleries had one "image": a character's becomes its
// portrait, a world card's the first of its pictures
// fields the lighter cards dropped: their words move, labelled, into a field
// that stayed, so nothing written is ever lost
const MERGED_FIELDS = [
  // [from, to, label] ; a character's looks, manner and past become its written portrait
  ['looks', 'sketch', null], ['traits', 'sketch', null], ['past', 'sketch', null],
  ['within', 'notes', tk('Located in')], ['where', 'notes', tk('Where it is')],
  ['rules', 'notes', tk('Rules')], ['appears', 'notes', tk('Where it appears')]
];
function mergeOldFields(o) {
  for (const [from, to, label] of MERGED_FIELDS) {
    const v = (o[from] || '').trim();
    if (from in o) delete o[from];
    if (!v) continue;
    // a system's rules sit best beside how it works
    const into = from === 'rules' && o.type === 'system' ? 'principle' : to;
    const line = label ? (frenchTypography() ? t(label) + ' : ' : t(label) + ': ') + v : v;
    o[into] = [(o[into] || '').trim(), line].filter(Boolean).join('\n\n');
  }
  return o;
}

function migratePictures(o) {
  if (o) mergeOldFields(o);
  if (!o || !o.image) return o;
  if (o.type) o.images = [o.image, ...(o.images || []).filter((f) => f !== o.image)];
  else if (!o.portrait) o.portrait = o.image;
  delete o.image;
  return o;
}
const galleryOf = (o) => (Array.isArray(o.images) ? o.images : (o.images = []));

async function bibleImageURL(bookId, fname) {
  const key = bookId + ':' + fname;
  if (bibleImgCache.has(key)) return bibleImgCache.get(key);
  const r = window.neo.bibleReadImage ? await window.neo.bibleReadImage(bookId, fname) : null; // NEO Pocket has no pictures yet
  const url = r ? `data:${r.mime};base64,${r.base64}` : null;
  if (url) bibleImgCache.set(key, url);
  return url;
}
function loadInto(img, fname, holder) {
  const opened = book;
  bibleImageURL(book.id, fname).then((url) => {
    if (book !== opened) return;
    if (url) img.src = url; else if (holder) holder.classList.add('missing');
  });
}

const bibleCardName = (o) => (o.type ? (o.name || worldTypeName(o.type)) : charName(o));

// a character's portrait: a circle, or a quiet silhouette waiting for one
function portraitCircle(c) {
  if (!canBibleImages()) return null;
  const b = document.createElement('button');
  b.className = 'bible-portrait' + (c.portrait ? '' : ' empty');
  if (c.portrait) {
    const img = document.createElement('img');
    img.alt = '';
    b.appendChild(img);
    loadInto(img, c.portrait, b);
    b.setAttribute('aria-label', t('Portrait of {name}', { name: charName(c) }));
    b.title = t('Click to enlarge · right-click to replace or remove');
    b.onclick = () => showBibleImage(c, [c.portrait], 0);
  } else {
    b.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="15" r="7"/><path d="M6 36c1.5-8 7-12 14-12s12.5 4 14 12"/></svg>';
    b.setAttribute('aria-label', t('Add a portrait'));
    b.title = t('Add a portrait (or drop a picture here)');
    b.onclick = () => pickBibleImages(c, 'portrait');
  }
  b.addEventListener('contextmenu', async (e) => {
    if (!c.portrait) return;
    e.preventDefault();
    const choice = await popMenu(e.clientX, e.clientY, [
      { label: t('Replace portrait…'), value: 'replace' },
      { label: t('Remove portrait'), value: 'remove', danger: true }
    ], { title: charName(c), from: b });
    if (choice === 'replace') pickBibleImages(c, 'portrait');
    if (choice === 'remove') removeBibleImage(c, c.portrait);
  });
  wirePictureDrop(b, c, 'portrait');
  const wrap = document.createElement('div');
  wrap.className = 'bible-portrait-wrap';
  wrap.appendChild(b);
  if (c.portrait) {
    const x = document.createElement('button');
    x.className = 'bp-remove';
    x.textContent = '×';
    x.setAttribute('aria-label', t('Remove portrait'));
    x.title = t('Remove portrait');
    x.onclick = () => removeBibleImage(c, c.portrait);
    wrap.appendChild(x);
  }
  return wrap;
}

// the pictures along the bottom of a card, and a tile to add more
function galleryRow(o) {
  if (!canBibleImages()) return null;
  const list = galleryOf(o);
  const row = document.createElement('div');
  row.className = 'bible-gallery';
  list.forEach((f, i) => {
    const b = document.createElement('button');
    b.className = 'bg-thumb';
    b.setAttribute('aria-label', t('Picture {n} of {name}', { n: i + 1, name: bibleCardName(o) }));
    b.title = t('Click to enlarge · right-click for more');
    const img = document.createElement('img');
    img.alt = '';
    b.appendChild(img);
    loadInto(img, f, b);
    b.onclick = () => showBibleImage(o, list, i);
    b.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      const items = [];
      if (!o.type) items.push({ label: t('Use as portrait'), value: 'portrait' });
      if (i > 0) items.push({ label: t('Move to the front'), value: 'front' });
      items.push({ label: t('Remove picture'), value: 'remove', danger: true });
      const choice = await popMenu(e.clientX, e.clientY, items, { title: bibleCardName(o), from: b });
      if (choice === 'portrait') { o.portrait = f; castChanged(); renderCharacters(); }
      if (choice === 'front') { list.splice(i, 1); list.unshift(f); castChanged(); renderCharacters(); }
      if (choice === 'remove') removeBibleImage(o, f);
    });
    row.appendChild(b);
  });
  const add = document.createElement('button');
  add.className = 'bg-add';
  add.textContent = '+';
  add.setAttribute('aria-label', t('Add pictures…'));
  add.title = t('Add pictures (or drop them on the card)');
  add.onclick = () => pickBibleImages(o, 'gallery');
  row.appendChild(add);
  return row;
}

// the Gallery field: shown with the card's other details
function gallerySection(o) {
  const row = galleryRow(o);
  if (!row) return null;
  const field = document.createElement('div');
  field.className = 'cc-field cc-gallery';
  const span = document.createElement('span');
  span.textContent = t('Gallery');
  field.append(span, row);
  return field;
}


// files from the Finder: on the portrait circle they become the portrait,
// anywhere else on the card they join the gallery
function wirePictureDrop(el, o, where) {
  if (!canBibleImages()) return;
  const isFile = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  const glow = el.classList.contains('bible-portrait') ? el : el;
  el.addEventListener('dragover', (e) => {
    if (!isFile(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    glow.classList.add('img-over');
  });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) glow.classList.remove('img-over'); });
  el.addEventListener('drop', (e) => {
    if (!isFile(e)) return;
    e.preventDefault();
    e.stopPropagation();
    glow.classList.remove('img-over');
    const paths = [...e.dataTransfer.files].map((f) => { try { return window.neo.pathForFile(f); } catch { return null; } }).filter(Boolean);
    if (paths.length) addBibleImages(o, paths, where);
  });
}

async function addBibleImages(o, paths, where) {
  const opened = book;
  const done = [];
  for (const p of where === 'portrait' ? paths.slice(0, 1) : paths) {
    const fname = await window.neo.bibleSetImage(book.id, p);
    if (book !== opened) return;
    if (fname) done.push(fname);
  }
  if (!done.length) { toast(t('NEO couldn’t read that picture. PNG, JPEG or WebP work.')); return; }
  if (where === 'portrait') o.portrait = done[0];
  else { galleryOf(o).push(...done); bibleMore.add(o.id); bibleOpen.add(o.id); }
  castChanged();
  renderCharacters();
}

async function pickBibleImages(o, where) {
  const picked = await window.neo.biblePickImage(where !== 'portrait');
  const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
  if (paths.length) addBibleImages(o, paths, where);
}

function removeBibleImage(o, fname) {
  snapshotStructure(t('Remove picture'));
  if (o.portrait === fname) delete o.portrait;
  else o.images = galleryOf(o).filter((f) => f !== fname);
  castChanged();
  renderCharacters();
  toast(t('Picture removed, {key} to undo', { key: KZ }));
}

// large, one at a time; ← → walk the gallery, Esc or a click closes
function showBibleImage(o, list, start) {
  if (!list.length) return;
  let i = start;
  const back = document.activeElement;
  const box = document.createElement('div');
  box.className = 'bible-lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', bibleCardName(o));
  box.tabIndex = -1;
  const img = document.createElement('img');
  const cap = document.createElement('div');
  cap.className = 'bl-caption';
  box.append(img, cap);
  const show = () => {
    img.alt = bibleCardName(o);
    img.removeAttribute('src');
    bibleImageURL(book.id, list[i]).then((url) => { if (url) img.src = url; });
    cap.textContent = bibleCardName(o) + (list.length > 1 ? `  ·  ${i + 1} / ${list.length}` : '');
  };
  const close = () => { box.remove(); if (back && back.isConnected) back.focus({ preventScroll: true }); };
  box.onclick = close;
  box.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      i = (i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length;
      show();
      return;
    }
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  show();
  document.body.appendChild(box);
  box.focus();
}

// every picture the cards use (the old single "image" too, until migrated)
const bibleImages = (m) => [...(m.characters || []), ...(m.world || [])]
  .flatMap((x) => [x.portrait, x.image, ...(Array.isArray(x.images) ? x.images : [])]).filter(Boolean);

// and the pictures set among the notes themselves
const notesImages = (html) => [...(html || '').matchAll(/data-img="(img-[\w.-]+)"/g)].map((m) => m[1]);

// oxlint-disable-next-line no-unused-vars -- called from app.js
async function pruneBibleImages() {
  if (!book || !canBibleImages() || !window.neo.biblePruneImages) return;
  const opened = book;
  const notes = await window.neo.readAux(book.id, 'notes');
  if (book !== opened) return;
  await window.neo.biblePruneImages(book.id, [...bibleImages(book), ...notesImages(notes)]);
}

// cards reorder by their grip: drop above or below another card of the same list
function wireReorder(list, getArr) {
  let dragId = null;
  list.querySelectorAll('.drag-grip').forEach((grip) => {
    const card = grip.closest('[data-id]');
    grip.draggable = true;
    grip.title = t('Drag to reorder');
    grip.addEventListener('dragstart', (e) => {
      dragId = card.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-neo-bible', dragId);
      e.dataTransfer.setDragImage(card, 20, 20);
      card.classList.add('dragging');
    });
    grip.addEventListener('dragend', () => { card.classList.remove('dragging'); list.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after')); dragId = null; });
  });
  const target = (e) => {
    const card = e.target.closest && e.target.closest('[data-id]');
    if (!card || card.parentElement !== list || card.dataset.id === dragId) return null;
    const r = card.getBoundingClientRect();
    return { card, after: e.clientY > r.top + r.height / 2 };
  };
  list.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    list.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    const tg = target(e);
    if (tg) tg.card.classList.add(tg.after ? 'drop-after' : 'drop-before');
  });
  list.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const tg = target(e);
    if (!tg) return;
    const arr = getArr();
    const from = arr.findIndex((x) => x.id === dragId);
    if (from < 0) return;
    const [moved] = arr.splice(from, 1);
    let to = arr.findIndex((x) => x.id === tg.card.dataset.id);
    if (tg.after) to++;
    arr.splice(to, 0, moved);
    castChanged();
    renderCharacters();
  });
}

// the fuller card, folded away: [field, label, placeholder, long]
const CAST_DETAILS = [
  ['role', tk('Role'), tk('Protagonist, antagonist, secondary…'), false],
  ['gender', tk('Gender'), '', false],
  ['age', tk('Age'), '', false],
  ['sketch', tk('Written portrait'), tk('Looks, manner, past: what makes them who they are'), true],
  ['want', tk('Want'), tk('What they chase'), true],
  ['need', tk('Need'), tk('What they truly need'), true],
  ['flaw', tk('Flaw'), tk('What holds them back'), true],
  ['ties', tk('Relationships'), tk('Sister of…, rival of…'), true],
  ['notes', tk('Notes'), tk('Anything else'), true]
];

function characterCard(c, s) {
  const card = document.createElement('div');
  card.className = 'cast-card';
  card.dataset.id = c.id;
  card.innerHTML = `
    <span class="drag-grip" aria-hidden="true">⋮⋮</span>
    <div class="cc-row">
      <label class="cc-field"><span>${t('First name')}</span><input data-f="first" spellcheck="false" /></label>
      <label class="cc-field"><span>${t('Last name')}</span><input data-f="last" spellcheck="false" /></label>
    </div>
    <label class="cc-field"><span>${t('Nicknames')}</span><input data-f="nicknames" spellcheck="false" /></label>
    <label class="cc-field"><span>${t('Note')}</span><input data-f="note" spellcheck="false" /></label>
    <div class="cc-details"></div>
    <div class="cc-meta"><span class="cc-stats"></span><span class="cc-buttons"><button class="cc-more" aria-expanded="false"></button><button class="cc-del"></button></span></div>`;
  card.querySelector('[data-f="nicknames"]').placeholder = t('Separated by commas');
  card.querySelector('[data-f="note"]').placeholder = t('A line to remember them by');
  card.querySelector('.cc-stats').textContent = castMetaText(s);

  // role and age share a row; the rest stack. Filled fields always show;
  // "More details" brings out the empty ones.
  const details = card.querySelector('.cc-details');
  const pair = document.createElement('div');
  pair.className = 'cc-row';
  details.appendChild(pair);
  for (const [f, label, ph, long] of CAST_DETAILS) {
    const field = document.createElement('label');
    field.className = 'cc-field cc-detail' + (f === 'age' || f === 'gender' ? ' cc-age' : '');
    field.dataset.f = f;
    const span = document.createElement('span');
    span.textContent = t(label);
    const el = document.createElement(long ? 'textarea' : 'input');
    el.dataset.f = f;
    el.spellcheck = false;
    if (long) el.rows = 1;
    if (ph) el.placeholder = t(ph);
    field.append(span, el);
    (f === 'role' || f === 'age' || f === 'gender' ? pair : details).appendChild(field);
  }
  const more = card.querySelector('.cc-more');
  const showDetails = (all) => {
    card.classList.toggle('cc-open', all);
    if (all) bibleMore.add(c.id); else bibleMore.delete(c.id);
    more.textContent = all ? t('Fewer details') : t('More details');
    more.setAttribute('aria-expanded', all ? 'true' : 'false');
    card.querySelectorAll('.cc-detail').forEach((fd) => {
      fd.hidden = !all && !(c[fd.dataset.f] || '').trim();
    });
    pair.hidden = !all && !(c.role || c.age || c.gender);
    card.querySelectorAll('.cc-gallery, .cc-stats').forEach((x) => { x.hidden = !all; });
    card.querySelectorAll('textarea').forEach(growField);
  };
  more.onclick = () => {
    const open = !card.classList.contains('cc-open');
    showDetails(open);
    if (open) { const first = card.querySelector('.cc-detail:not([hidden]) input, .cc-detail:not([hidden]) textarea'); if (first && !first.value) first.focus(); }
  };

  const del = card.querySelector('.cc-del');
  del.textContent = t('Delete');
  del.onclick = () => deleteCharacter(c);
  const portrait = portraitCircle(c);
  if (portrait) card.insertBefore(portrait, card.querySelector('.cc-row'));
  const gallery = gallerySection(c);
  if (gallery) details.appendChild(gallery);
  wirePictureDrop(card, c, 'gallery');
  card.querySelectorAll('input, textarea').forEach((input) => {
    const f = input.dataset.f;
    const shown = () => (f === 'nicknames' ? (c.nicknames || []).join(', ') : (c[f] || ''));
    input.value = shown();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.tagName === 'INPUT') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); input.value = shown(); input.blur(); }
    });
    if (input.tagName === 'TEXTAREA') input.addEventListener('input', () => growField(input));
    input.addEventListener('change', () => commitCharacterField(c, f, input, shown));
  });
  showDetails(bibleMore.has(c.id));
  requestAnimationFrame(() => card.querySelectorAll('textarea').forEach(growField));
  return card;
}

function growField(el) {
  if (!el.isConnected) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// every change to the cast: saved, shared with a bound book's other parts,
// and shown in the Notes & Comments pane
function castChanged() {
  scheduleMetaSave();
  scheduleCastShare();
  scheduleCast();
}

function addCharacter(fields) {
  const c = { id: castId(), first: '', last: '', nicknames: [], note: '', ...(fields || {}) };
  castList().push(c);
  castChanged();
  if (currentTab === 'notes') renderCharacters(c.id);
  return c;
}

// asked once, then gone; ⌘Z still brings it back
async function deleteCharacter(c) {
  if (!await confirmModal(t('Delete this card?'), t('{name} leaves your notes. The text of the book is not touched.', { name: charName(c) }), t('Delete'), { danger: true })) return;
  snapshotStructure(t('Delete'));
  book.characters = castList().filter((x) => x.id !== c.id);
  // remembered, so a bound part that still has the card doesn't bring it back
  book.castRemoved = [...new Set([...(book.castRemoved || []), c.id])];
  castChanged();
  renderCharacters();
  toast(t('{name} left your notes, {key} to undo', { name: charName(c), key: KZ }));
}

// A changed name can carry the book with it: the writer chooses
async function commitCharacterField(c, f, input, shown) {
  let val = input.value.trim();
  if (f === 'nicknames') val = val.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  const pairs = [];
  if (f === 'first' || f === 'last') {
    if (c[f] && val && c[f] !== val) pairs.push([c[f], val]);
  } else if (f === 'nicknames') {
    const old = c.nicknames || [];
    if (old.length === val.length) old.forEach((o, i) => { if (o !== val[i]) pairs.push([o, val[i]]); });
  }
  const apply = () => { c[f] = val; };

  let choice = 'card';
  if (pairs.length) {
    const counts = await Promise.all(pairs.map(([o]) => countInBook(o)));
    const total = counts.reduce((a, x) => a + x.n, 0);
    if (total) {
      let lines = pairs.map(([o, n], i) => counts[i].n
        ? t('“{old}” → “{new}”: {n} times, in {c} chapters', { old: escapeHTML(o), new: escapeHTML(n), n: fmtNum(counts[i].n), c: fmtNum(counts[i].chapters) })
        : '').filter(Boolean).join('<br>');
      if (counts.some((x) => x.parts)) lines += '<br>' + t('The other parts of this bound book are included.');
      choice = await optionModal(t('Rename in the text too?'), lines, [
        { label: t('Replace everywhere'), desc: t('Chapters, titles, outline and notes. {key} undoes it.', { key: KZ }), value: 'all' },
        { label: t('Only the card'), desc: t('The text stays as it is.'), value: 'card' }
      ]);
    }
  }
  if (!choice) { input.value = shown(); return; }
  if (choice === 'all') {
    await renameInBook(pairs, apply);
    renderCharacters();
    return;
  }
  apply();
  input.value = shown();
  castChanged();
  const card = input.closest('.cast-card');
  if (card) card.querySelector('.cc-stats').textContent = castMetaText(bookCastStats().get(c.id));
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function textNodesOf(root) {
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) out.push(node);
  return out;
}

function countIn(text, re) {
  re.lastIndex = 0;
  return (text.match(re) || []).length;
}

// titles, outline lines and section notes of a book's meta
function metaStrings(m) {
  const out = [];
  for (const k of Object.keys(m.chapterTitles || {})) out.push([m.chapterTitles, k]);
  for (const k of Object.keys(m.chapterNotes || {})) out.push([m.chapterNotes, k]);
  for (const list of Object.values(m.sectionNotes || {})) for (const sec of list) out.push([sec, 'text']);
  return out;
}

// a bound book's other parts, read from disk: meta, chapters, notes
async function readPeer(id) {
  const meta = await window.neo.readBookMeta(id);
  if (!meta) return null;
  const chapters = {};
  for (const chId of meta.chapterOrder || []) chapters[chId] = (await window.neo.readChapter(id, chId)) || '';
  return { id, meta, chapters, notes: (await window.neo.readAux(id, 'notes')) || '' };
}

function plainOf(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  const paras = [...d.children];
  return paras.length ? paras.map((x) => x.textContent).join('\n') : d.textContent;
}

async function countInBook(form) {
  const re = formPattern([form]);
  let n = 0;
  let chapters = 0;
  for (const chId of book.chapterOrder) {
    const k = countIn(chapterPlain(chId), re);
    if (k) { n += k; chapters++; }
  }
  for (const [o, k] of metaStrings(book)) n += countIn(o[k] || '', re);
  flushAux();
  n += countIn(plainOf(await window.neo.readAux(book.id, 'notes')), re);
  let parts = 0;
  for (const id of castPeers) {
    const peer = await readPeer(id);
    if (!peer) continue;
    let hit = 0;
    for (const html of Object.values(peer.chapters)) {
      const k = countIn(plainOf(html), re);
      if (k) { hit += k; chapters++; }
    }
    for (const [o, k] of metaStrings(peer.meta)) hit += countIn(o[k] || '', re);
    hit += countIn(plainOf(peer.notes), re);
    if (hit) { n += hit; parts++; }
  }
  return { n, chapters, parts };
}

async function renameInBook(pairs, mutate) {
  flushAux();
  const notesHTML = (await window.neo.readAux(book.id, 'notes')) || '';
  const peers = [];
  for (const id of castPeers) { const p = await readPeer(id); if (p) peers.push(p); }
  snapshotStructure(t('Rename'));
  const snap = undoStack[undoStack.length - 1];
  snap.auxNotes = notesHTML;
  snap.peers = JSON.parse(JSON.stringify(peers)); // the other parts as they were
  mutate();

  let n = 0;
  const swap = (text, re, to) => text.replace(re, () => { n++; return to; });
  const swapHTML = (html, re, to) => {
    const d = document.createElement('div');
    d.innerHTML = html;
    for (const nd of textNodesOf(d)) { re.lastIndex = 0; if (re.test(nd.textContent)) nd.textContent = swap(nd.textContent, re, to); }
    return d.innerHTML;
  };
  let notes = notesHTML;
  let titlesTouched = false;
  for (const [from, to] of pairs) {
    const re = formPattern([from]);
    const typed = /['’‘]/.test(to) ? to.replace(/'/g, '’') : to;
    for (const chId of book.chapterOrder) {
      const body = chapterBodyEl(chId);
      if (!body) continue;
      body.normalize();
      let touched = false;
      for (const nd of textNodesOf(body)) {
        re.lastIndex = 0;
        if (!re.test(nd.textContent)) continue;
        nd.textContent = swap(nd.textContent, re, typed);
        touched = true;
      }
      if (touched) syncChapter(body, chId);
    }
    for (const [o, k] of metaStrings(book)) {
      const v = swap(o[k] || '', re, typed);
      if (v !== (o[k] || '')) { if (o === book.chapterTitles) titlesTouched = true; o[k] = v; }
    }
    notes = swapHTML(notes, re, typed);
    for (const peer of peers) {
      for (const chId of Object.keys(peer.chapters)) peer.chapters[chId] = swapHTML(peer.chapters[chId], re, typed);
      for (const [o, k] of metaStrings(peer.meta)) o[k] = swap(o[k] || '', re, typed);
      peer.notes = swapHTML(peer.notes, re, typed);
    }
  }
  if (notes !== notesHTML) await window.neo.writeAux(book.id, 'notes', notes);
  const before = new Map(snap.peers.map((p) => [p.id, p]));
  for (const peer of peers) {
    const old = before.get(peer.id);
    for (const chId of Object.keys(peer.chapters)) {
      if (peer.chapters[chId] !== old.chapters[chId]) await window.neo.writeChapter(peer.id, chId, peer.chapters[chId]);
    }
    if (peer.notes !== old.notes) await window.neo.writeAux(peer.id, 'notes', peer.notes);
    for (const k of SHARED_KEYS) if (book[k] !== undefined) peer.meta[k] = JSON.parse(JSON.stringify(book[k]));
    await writeBookMeta(peer.id, peer.meta);
  }
  await saveMeta();
  if (titlesTouched) renderChapters();
  renderNav();
  scheduleCast();
  toast(n ? t('{n} replaced across the whole book — {key} to undo', { n, key: KZ }) : t('0 replaced'));
}

/* --- A bound book's parts share one cast ------------------------- */
/*  Each part keeps a copy in its own book.json (a folder stays whole  */
/*  if it's ever unbound); NEO keeps the copies level. Cards deleted   */
/*  in one part are remembered, so another part can't bring them back. */

let castPeers = [];
let castShareTimer = null;

async function findCastPeers() {
  const shelf = book && shelfOf(book.id);
  if (!isBound(shelf)) return [];
  const out = [];
  for (const id of shelf.bookIds) {
    if (id === book.id) continue;
    const m = await shelfMeta(id);
    if (!m || (isPageMeta(m) && !PAGE_WRITTEN.includes(m.kind))) continue;
    out.push(id);
  }
  return out;
}

// one list merged with the same list from the other parts: by id, then
// by name (the same person or place made twice before binding)
function mergeShared(own, theirs, removed, key) {
  const ids = new Set(own.map((x) => x.id));
  const keys = new Set(own.map(key));
  let changed = false;
  for (const x of theirs || []) {
    if (ids.has(x.id) || removed.has(x.id) || keys.has(key(x))) continue;
    ids.add(x.id);
    keys.add(key(x));
    own.push(JSON.parse(JSON.stringify(x)));
    changed = true;
  }
  const kept = own.filter((x) => !removed.has(x.id));
  return { list: kept, changed: changed || kept.length !== own.length };
}

// oxlint-disable-next-line no-unused-vars -- called from app.js
async function syncCastOnOpen() {
  const opened = book;
  const peers = await findCastPeers();
  if (book !== opened) return;
  castPeers = peers;
  if (!peers.length) return;
  const castGone = new Set(book.castRemoved || []);
  const worldGone = new Set(book.worldRemoved || []);
  const metas = [];
  for (const id of peers) {
    const m = await window.neo.readBookMeta(id);
    if (book !== opened) return;
    if (!m) continue;
    metas.push(m);
    (m.castRemoved || []).forEach((x) => castGone.add(x));
    (m.worldRemoved || []).forEach((x) => worldGone.add(x));
  }
  let changed = false;
  let cast = castList();
  let world = worldList();
  const story = storyBible();
  for (const m of metas) {
    const a = mergeShared(cast, m.characters, castGone, (c) => castFold(charName(c)));
    cast = a.list;
    const b = mergeShared(world, m.world, worldGone, (w) => (w.type || '') + ':' + castFold(w.name || w.id));
    world = b.list;
    changed = changed || a.changed || b.changed;
    for (const [k, v] of Object.entries(m.story || {})) if (v && !story[k]) { story[k] = v; changed = true; }
  }
  book.characters = cast;
  book.world = world;
  // pictures of cards that came from another part
  if (canBibleImages()) {
    for (const f of bibleImages(book)) {
      for (const m of metas) if (await window.neo.bibleCopyImage(m.id, f, book.id)) break;
    }
    if (book !== opened) return;
  }
  if (castGone.size) book.castRemoved = [...castGone];
  if (worldGone.size) book.worldRemoved = [...worldGone];
  if (changed) scheduleMetaSave();
  await shareCast();
  scheduleCast();
  if (currentTab === 'notes') renderCharacters();
}

function scheduleCastShare() {
  clearTimeout(castShareTimer);
  castShareTimer = setTimeout(shareCast, 1000);
}

// what the parts of a bound book hold in common
const SHARED_KEYS = ['characters', 'castRemoved', 'world', 'worldRemoved', 'story'];

async function shareCast() {
  clearTimeout(castShareTimer);
  castShareTimer = null;
  if (!book || !castPeers.length) return;
  castList(); worldList(); storyBible();
  // taken now: the book may close while the parts are being written
  const shared = JSON.parse(JSON.stringify(Object.fromEntries(SHARED_KEYS.map((k) => [k, book[k] || (k === 'story' ? {} : [])]))));
  const from = book.id;
  const pics = bibleImages(shared);
  for (const id of [...castPeers]) {
    if (canBibleImages()) for (const f of pics) await window.neo.bibleCopyImage(from, f, id);
    const m = await window.neo.readBookMeta(id);
    if (!m) continue;
    if (SHARED_KEYS.every((k) => JSON.stringify(m[k] || (k === 'story' ? {} : [])) === JSON.stringify(shared[k]))) continue;
    Object.assign(m, JSON.parse(JSON.stringify(shared)));
    await writeBookMeta(id, m);
  }
}

/* --- Bring characters in from another book (copies) -------------- */

async function importCharacters() {
  const all = (await window.neo.listBooks())
    .filter((b) => b.id !== book.id && !castPeers.includes(b.id) && (!b.kind || PAGE_WRITTEN.includes(b.kind)));
  const sources = [];
  for (const b of all) {
    const m = await window.neo.readBookMeta(b.id);
    const cast = (m && m.characters) || [];
    const world = (m && m.world) || [];
    if (cast.length || world.length) sources.push({ id: b.id, title: m.title || b.title, cast, world });
  }
  if (!sources.length) { toast(t('No other book has cards yet.')); return; }
  const have = new Set(castList().map((c) => castFold(charName(c))));
  const haveW = new Set(worldList().map((w) => (w.type || '') + ':' + castFold(w.name || '')));
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal cast-import" style="width:440px">
      <h2 style="font-size:16px"></h2>
      <p class="ci-hint"></p>
      <div class="ci-list"></div>
      <div style="text-align:right;margin-top:14px">
        <button class="m-cancel btn-quiet" style="margin-right:10px"></button>
        <button class="m-ok btn-gold"></button>
      </div>
    </div>`;
  bd.querySelector('h2').textContent = t('Import from another book');
  bd.querySelector('.ci-hint').textContent = t('They arrive as copies: changing them here leaves the other book as it is.');
  bd.querySelector('.m-cancel').textContent = t('Cancel');
  bd.querySelector('.m-ok').textContent = t('Import');
  const list = bd.querySelector('.ci-list');
  const picks = [];
  for (const src of sources) {
    const h = document.createElement('div');
    h.className = 'ci-book';
    h.textContent = src.title;
    list.appendChild(h);
    const items = [
      ...src.cast.map((c) => ({ c, kind: 'cast', label: charName(c) + ' · ' + (c.role || t('Character')), already: have.has(castFold(charName(c))) })),
      ...src.world.map((c) => ({ c, kind: 'world', label: (c.name || t('Unnamed')) + ' · ' + worldTypeName(c.type), already: haveW.has((c.type || '') + ':' + castFold(c.name || '')) }))
    ];
    for (const { c, kind, label, already } of items) {
      const row = document.createElement('label');
      row.className = 'ci-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.disabled = already;
      const name = document.createElement('span');
      name.textContent = label;
      row.append(box, name);
      if (already) {
        const note = document.createElement('em');
        note.textContent = t('already here');
        row.appendChild(note);
      }
      list.appendChild(row);
      picks.push({ box, c, kind, from: src.id });
    }
  }
  document.body.appendChild(bd);
  const ok = bd.querySelector('.m-ok');
  const close = () => bd.remove();
  bd.querySelector('.m-cancel').onclick = close;
  bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  const first = list.querySelector('input:not([disabled])');
  (first || ok).focus();
  ok.onclick = async () => {
    const chosen = picks.filter((p) => p.box.checked);
    close();
    if (!chosen.length) return;
    for (const { c, kind, from } of chosen) {
      const copy = migratePictures({ ...JSON.parse(JSON.stringify(c)), id: castId() });
      const brings = async (f) => canBibleImages() && await window.neo.bibleCopyImage(from, f, book.id);
      if (copy.portrait && !(await brings(copy.portrait))) delete copy.portrait;
      if (copy.images) { const kept = []; for (const f of copy.images) if (await brings(f)) kept.push(f); copy.images = kept; }
      (kind === 'world' ? worldList() : castList()).push(copy);
    }
    castChanged();
    renderCharacters();
    toast(t('Imported: {n}', { n: fmtNum(chosen.length) }));
  };
}

/* --- The Outline: the synopsis on top, who is in each chapter ------ */

// the cards of the outline (app.js's board) get the synopsis over them too
// oxlint-disable-next-line no-unused-vars -- called from app.js
function bibleBoard() {
  document.querySelectorAll('.ol-synopsis.over-board').forEach((x) => x.remove());
  const board = $('#outline-board');
  if (!board || !book || (typeof isScript === 'function' && isScript())) return;
  const syn = outlineSynopsis();
  syn.classList.add('over-board');
  board.before(syn);
}

// oxlint-disable-next-line no-unused-vars -- called from app.js
function bibleOutline(wrap) {
  document.querySelectorAll('.ol-synopsis.over-board').forEach((x) => x.remove());
  wrap.insertBefore(outlineSynopsis(), wrap.firstChild);
  const cast = castList();
  if (!cast.length) return;
  wrap.querySelectorAll('.ol-line.ol-chapter').forEach((line) => {
    const stats = castStats(chapterPlain(line.dataset.chId));
    const present = cast.filter((c) => stats.get(c.id)).sort((a, b) => stats.get(b.id).n - stats.get(a.id).n);
    if (!present.length) return;
    const row = document.createElement('div');
    row.className = 'ol-cast';
    for (const c of present) {
      const b = document.createElement('button');
      b.className = 'ol-who';
      b.textContent = charName(c);
      b.title = t('Mentions: {n}', { n: fmtNum(stats.get(c.id).n) }) + '\n' + openInNotesLabel();
      b.onclick = () => openInNotes(c.id);
      row.appendChild(b);
    }
    line.after(row);
  });
}

/* --- @ while writing: pick a character, and which of their names --- */

let castPop = null;       // { el, options, index, host }
let castDismissed = null; // the @ the writer sent away with Esc

function castContext() {
  const sel = window.getSelection();
  if (!book || !sel.rangeCount || !sel.isCollapsed) return null;
  const node = sel.anchorNode;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const host = node.parentElement && node.parentElement.closest('.chapter-body, #aux-editor');
  if (!host) return null;
  const before = node.textContent.slice(0, sel.anchorOffset);
  const m = before.match(/(?:^|[^\p{L}\p{N}_@.])@([\p{L}\p{N}'’-]{0,30}(?: [\p{L}\p{N}'’-]{0,30})?)$/u);
  if (!m) return null;
  return { node, at: before.length - m[1].length - 1, end: sel.anchorOffset, query: m[1], host };
}

function castOptions(query) {
  const q = castFold(castKey(query.trim()));
  const options = [];
  let exact = false;
  let shown = 0;
  for (const c of castList()) {
    const forms = charForms(c);
    const hit = forms.findIndex((f) => {
      const ff = castFold(castKey(f));
      return !q || ff.startsWith(q) || ff.split(/[\s'-]+/).some((w) => w.startsWith(q));
    });
    if (hit < 0) continue;
    if (shown++ >= 6) break;
    forms.forEach((form, i) => {
      if (castFold(castKey(form)) === q) exact = true;
      options.push({ kind: 'form', c, form, first: i === 0, best: i === hit });
    });
  }
  if (q && !exact) options.push({ kind: 'create', name: query.trim() });
  return options;
}

function closeCastPop() {
  if (!castPop) return;
  castPop.el.remove();
  castPop.host.removeAttribute('aria-activedescendant');
  castPop = null;
}

function updateCastPop(fromTyping) {
  const ctx = castContext();
  if (!ctx) return closeCastPop();
  if (castDismissed && castDismissed.node === ctx.node && castDismissed.at === ctx.at) return closeCastPop();
  if (!castPop && !fromTyping) return;
  const options = castOptions(ctx.query);
  if (!options.length) return closeCastPop();
  if (castPop && castPop.host !== ctx.host) closeCastPop();

  let el = castPop && castPop.el;
  if (!el) {
    el = document.createElement('div');
    el.id = 'cast-pop';
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-label', t('Characters'));
    el.addEventListener('mousedown', (e) => e.preventDefault()); // the caret stays in the text
    document.body.appendChild(el);
  }
  el.innerHTML = '';
  const index = Math.max(0, options.findIndex((o) => o.best));
  options.forEach((o, i) => {
    if (o.kind === 'form' && o.first) {
      const who = document.createElement('div');
      who.className = 'cp-who';
      who.textContent = charName(o.c);
      el.appendChild(who);
    }
    const opt = document.createElement('div');
    opt.className = 'cp-opt' + (o.kind === 'create' ? ' cp-create' : '');
    opt.id = 'cp-o' + i;
    opt.setAttribute('role', 'option');
    opt.textContent = o.kind === 'create' ? t('Create the character “{name}”', { name: o.name }) : o.form;
    opt.onclick = () => chooseCastOption(i);
    el.appendChild(opt);
  });
  const foot = document.createElement('div');
  foot.className = 'cp-foot';
  foot.textContent = t('Enter to insert · Esc keeps the @');
  el.appendChild(foot);
  castPop = { el, options, index, host: ctx.host };
  markCastOption();

  // under the @, or above it near the bottom of the window
  const r = document.createRange();
  r.setStart(ctx.node, ctx.at);
  r.setEnd(ctx.node, Math.min(ctx.at + 1, ctx.node.length));
  const rect = r.getBoundingClientRect();
  const h = el.offsetHeight;
  const w = el.offsetWidth;
  const top = rect.bottom + 6 + h > window.innerHeight - 44 ? rect.top - h - 6 : rect.bottom + 6;
  el.style.top = Math.max(8, top) + 'px';
  el.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8)) + 'px';
}

function markCastOption() {
  if (!castPop) return;
  castPop.el.querySelectorAll('.cp-opt').forEach((o) => {
    const on = o.id === 'cp-o' + castPop.index;
    o.classList.toggle('on', on);
    o.setAttribute('aria-selected', on ? 'true' : 'false');
    if (on) o.scrollIntoView({ block: 'nearest' });
  });
  castPop.host.setAttribute('aria-activedescendant', 'cp-o' + castPop.index);
}

function chooseCastOption(i) {
  const o = castPop && castPop.options[i];
  const ctx = castContext();
  closeCastPop();
  if (!o || !ctx) return;
  let text;
  if (o.kind === 'create') {
    const words = o.name.split(/\s+/);
    const c = addCharacter({ first: words[0], last: words.slice(1).join(' ') });
    text = o.name;
    toast(t('New character: {name}. Their card is in {tab}.', { name: charName(c), tab: tabName('notes') }));
  } else {
    text = o.form;
  }
  if (/'/.test(text)) text = text.replace(/'/g, '’');
  const r = document.createRange();
  r.setStart(ctx.node, ctx.at);
  r.setEnd(ctx.node, ctx.end);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  document.execCommand('insertText', false, text);
}

// ahead of every other key handler while the list is open
window.addEventListener('keydown', (e) => {
  if (!castPop) return;
  const n = castPop.options.length;
  let handled = true;
  if (e.key === 'ArrowDown') castPop.index = (castPop.index + 1) % n;
  else if (e.key === 'ArrowUp') castPop.index = (castPop.index + n - 1) % n;
  else if (e.key === 'Enter' || e.key === 'Tab') chooseCastOption(castPop.index);
  else if (e.key === 'Escape') {
    const ctx = castContext();
    if (ctx) castDismissed = { node: ctx.node, at: ctx.at };
    closeCastPop();
  } else handled = false;
  if (!handled) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  markCastOption();
}, true);

document.addEventListener('input', (e) => {
  if (e.target && e.target.closest && e.target.closest('.chapter-body, #aux-editor')) updateCastPop(true);
});
document.addEventListener('selectionchange', () => { if (castPop) updateCastPop(false); });
document.addEventListener('focusout', () => setTimeout(() => {
  if (castPop && !castPop.host.contains(document.activeElement)) closeCastPop();
}, 0));
$('#paper-scroll').addEventListener('scroll', closeCastPop, { passive: true });

/* --- The Notes: a contents list, / commands, a little Markdown ---- */
/*  The notes stay free text. Under them, the cards in their rubrics; */
/*  above them, a contents list of the headings and the rubrics.      */
/*  / opens the commands (a card, a picture, a heading, a list).      */

const notesEditor = () => $('#aux-editor');
const inNotes = () => currentTab === 'notes' && notesEditor().dataset.kind === 'notes';

// the notes as they go to disk: a picture keeps its file name, never its pixels
// oxlint-disable-next-line no-unused-vars -- called from app.js
function notesHTML() {
  const ed = notesEditor();
  if (!ed.querySelector('img[data-img]')) return ed.innerHTML;
  const copy = ed.cloneNode(true);
  copy.querySelectorAll('img[data-img]').forEach((img) => img.removeAttribute('src'));
  return copy.innerHTML;
}

function hydrateNotesImages() {
  if (!canBibleImages()) return;
  notesEditor().querySelectorAll('img[data-img]:not([src])').forEach((img) => loadInto(img, img.dataset.img));
}

// switchTab has just put the notes on the page
// oxlint-disable-next-line no-unused-vars -- called from app.js
function notesOpened() {
  $('#characters-list').hidden = false;
  hydrateNotesImages();
  renderCharacters();
  if (notesFocus) setTimeout(showNotesFocus, 0); // after the scroll comes back
}

// the contents: the notes' own headings, then the rubrics
let tocTimer = null;
function renderNotesToc() {
  let toc = $('#notes-toc');
  if (!toc) {
    toc = document.createElement('nav');
    toc.id = 'notes-toc';
    notesEditor().before(toc);
  }
  toc.innerHTML = '';
  const entries = [];
  notesEditor().querySelectorAll('h3, h4').forEach((h) => {
    const label = h.textContent.trim();
    if (label) entries.push({ label, sub: h.tagName === 'H4', el: h });
  });
  $('#characters-list').querySelectorAll('.bible-section').forEach((sec) => {
    const n = sec.querySelectorAll('[data-id]').length;
    const label = sec.querySelector('.bible-h').firstChild.textContent;
    entries.push({ label, count: sec.dataset.sec === 'story' ? 0 : n, el: sec, rubric: true });
  });
  toc.hidden = entries.length < 2;
  if (toc.hidden) return;
  toc.setAttribute('aria-label', t('Contents'));
  const head = document.createElement('div');
  head.className = 'nt-head';
  head.textContent = t('Contents');
  toc.appendChild(head);
  for (const e of entries) {
    const b = document.createElement('button');
    b.className = 'nt-item' + (e.sub ? ' nt-sub' : '') + (e.rubric ? ' nt-rubric' : '');
    b.textContent = e.label;
    if (e.count) {
      const c = document.createElement('span');
      c.className = 'nt-count';
      c.textContent = fmtNum(e.count);
      b.append(' ', c);
    }
    b.onclick = () => e.el.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
    toc.appendChild(b);
  }
}
notesEditor().addEventListener('input', () => {
  if (!inNotes()) return;
  clearTimeout(tocTimer);
  tocTimer = setTimeout(renderNotesToc, 500);
});

// Markdown at the start of a line: # and ## for headings, - or * for a
// list, 1. for a numbered one. Format → Markdown Emphasis turns it off.
const MD_BLOCKS = { '#': ['formatBlock', 'h3'], '##': ['formatBlock', 'h4'], '-': ['insertUnorderedList'], '*': ['insertUnorderedList'], '1.': ['insertOrderedList'] };
notesEditor().addEventListener('keydown', (e) => {
  if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || !inNotes()) return;
  if (library && library.markdownOff) return;
  const ed = notesEditor();
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const start = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  if (!start || start.closest('li, h3, h4')) return;
  let block = start.closest('p, div');
  if (!block || !ed.contains(block) || block === ed) {
    // the first line of the notes sits in the editor itself
    if (range.startContainer !== ed.firstChild) return;
    block = ed;
  }
  const pre = document.createRange();
  pre.setStart(block, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  const cmd = MD_BLOCKS[pre.toString()];
  if (!cmd) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  selectChars(block, 0, pre.toString().length);
  document.execCommand('delete');
  document.execCommand(cmd[0], false, cmd[1]);
  renderNotesToc();
});

// / and a few letters: the commands, filtered as you type
const SLASH_COMMANDS = [
  { key: 'character', label: tk('Character'), group: tk('Cards'), run: () => addCharacter() },
  ...Object.keys(WORLD_TYPES).map((k) => ({ key: k, label: WORLD_TYPES[k][0], group: tk('Cards'), run: () => addWorld(k) })),
  { key: 'image', label: tk('Picture'), group: tk('In the notes'), run: (at) => insertNotesImages(at), when: () => canBibleImages() },
  { key: 'heading', label: tk('Heading'), group: tk('In the notes'), run: () => document.execCommand('formatBlock', false, 'h3') },
  { key: 'subheading', label: tk('Subheading'), group: tk('In the notes'), run: () => document.execCommand('formatBlock', false, 'h4') },
  { key: 'list', label: tk('Bulleted list'), group: tk('In the notes'), run: () => document.execCommand('insertUnorderedList') },
  { key: 'numbered', label: tk('Numbered list'), group: tk('In the notes'), run: () => document.execCommand('insertOrderedList') },
  { key: 'import', label: tk('Import cards from another book…'), group: tk('In the notes'), run: () => importCharacters() },
  { key: 'export', label: tk('Export the notes…'), group: tk('In the notes'), run: () => exportNotes() }
];

let slashPop = null;       // { el, options, index }
let slashDismissed = null; // the / sent away with Esc

function slashContext() {
  const sel = window.getSelection();
  if (!book || !inNotes() || !sel.rangeCount || !sel.isCollapsed) return null;
  const node = sel.anchorNode;
  if (!node || node.nodeType !== Node.TEXT_NODE || !notesEditor().contains(node)) return null;
  const before = node.textContent.slice(0, sel.anchorOffset);
  const m = before.match(/(?:^|\s)\/([\p{L}\p{N}-]{0,24})$/u);
  if (!m) return null;
  return { node, at: before.length - m[1].length - 1, end: sel.anchorOffset, query: m[1] };
}

function slashOptions(query) {
  const q = castFold(query);
  return SLASH_COMMANDS.filter((c) => (!c.when || c.when()) && (!q
    || castFold(t(c.label)).split(/\s+/).some((w) => w.startsWith(q))
    || c.key.startsWith(q)));
}

function closeSlashPop() {
  if (!slashPop) return;
  slashPop.el.remove();
  notesEditor().removeAttribute('aria-activedescendant');
  slashPop = null;
}

function updateSlashPop(fromTyping) {
  const ctx = slashContext();
  if (!ctx) return closeSlashPop();
  if (slashDismissed && slashDismissed.node === ctx.node && slashDismissed.at === ctx.at) return closeSlashPop();
  if (!slashPop && !fromTyping) return;
  const options = slashOptions(ctx.query);
  if (!options.length) return closeSlashPop();
  let el = slashPop && slashPop.el;
  if (!el) {
    el = document.createElement('div');
    el.id = 'slash-pop';
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-label', t('Commands'));
    el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.appendChild(el);
  }
  el.innerHTML = '';
  let group = null;
  options.forEach((o, i) => {
    if (o.group !== group) {
      group = o.group;
      const g = document.createElement('div');
      g.className = 'cp-who';
      g.textContent = t(group);
      el.appendChild(g);
    }
    const opt = document.createElement('div');
    opt.className = 'cp-opt';
    opt.id = 'sp-o' + i;
    opt.setAttribute('role', 'option');
    opt.textContent = t(o.label);
    opt.onclick = () => chooseSlashOption(i);
    el.appendChild(opt);
  });
  const foot = document.createElement('div');
  foot.className = 'cp-foot';
  foot.textContent = t('Enter to choose · Esc keeps the /');
  el.appendChild(foot);
  const index = slashPop ? Math.min(slashPop.index, options.length - 1) : 0;
  slashPop = { el, options, index };
  markSlashOption();
  const r = document.createRange();
  r.setStart(ctx.node, ctx.at);
  r.setEnd(ctx.node, Math.min(ctx.at + 1, ctx.node.length));
  const rect = r.getBoundingClientRect();
  const h = el.offsetHeight;
  const w = el.offsetWidth;
  const top = rect.bottom + 6 + h > window.innerHeight - 44 ? rect.top - h - 6 : rect.bottom + 6;
  el.style.top = Math.max(8, top) + 'px';
  el.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8)) + 'px';
}

function markSlashOption() {
  if (!slashPop) return;
  slashPop.el.querySelectorAll('.cp-opt').forEach((o) => {
    const on = o.id === 'sp-o' + slashPop.index;
    o.classList.toggle('on', on);
    o.setAttribute('aria-selected', on ? 'true' : 'false');
    if (on) o.scrollIntoView({ block: 'nearest' });
  });
  notesEditor().setAttribute('aria-activedescendant', 'sp-o' + slashPop.index);
}

function chooseSlashOption(i) {
  const o = slashPop && slashPop.options[i];
  const ctx = slashContext();
  closeSlashPop();
  if (!o || !ctx) return;
  // the typed command goes (one undo brings it back), then it runs
  const r = document.createRange();
  r.setStart(ctx.node, ctx.at);
  r.setEnd(ctx.node, ctx.end);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  document.execCommand('delete');
  const at = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  o.run(at);
  renderNotesToc();
}

// pictures among the notes: copied into the book like a card's, set where
// the / was, each on its own line
async function insertNotesImages(at) {
  const paths = await window.neo.biblePickImage(true);
  if (!paths || !paths.length || !book) return;
  const names = [];
  for (const p of paths) {
    const f = await window.neo.bibleSetImage(book.id, p);
    if (f) names.push(f);
  }
  if (!names.length) { toast(t('That picture could not be read.')); return; }
  const ed = notesEditor();
  ed.focus({ preventScroll: true });
  if (at && ed.contains(at.startContainer)) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(at);
  }
  document.execCommand('insertHTML', false, names.map((f) => `<div class="note-pic"><img class="note-img" data-img="${f}" alt=""></div>`).join('') + '<div><br></div>');
  hydrateNotesImages();
}

// a picture in the notes opens large, like a card's
notesEditor().addEventListener('dblclick', (e) => {
  const img = e.target.closest && e.target.closest('img[data-img]');
  if (!img || !inNotes()) return;
  const all = [...notesEditor().querySelectorAll('img[data-img]')].map((x) => x.dataset.img);
  showBibleImage({ type: 'note', name: tabName('notes') }, all, Math.max(0, all.indexOf(img.dataset.img)));
});

window.addEventListener('keydown', (e) => {
  if (!slashPop) return;
  const n = slashPop.options.length;
  let handled = true;
  if (e.key === 'ArrowDown') slashPop.index = (slashPop.index + 1) % n;
  else if (e.key === 'ArrowUp') slashPop.index = (slashPop.index + n - 1) % n;
  else if (e.key === 'Enter' || e.key === 'Tab') chooseSlashOption(slashPop.index);
  else if (e.key === 'Escape') {
    const ctx = slashContext();
    if (ctx) slashDismissed = { node: ctx.node, at: ctx.at };
    closeSlashPop();
  } else handled = false;
  if (!handled) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  markSlashOption();
}, true);
notesEditor().addEventListener('input', () => updateSlashPop(true));
document.addEventListener('selectionchange', () => { if (slashPop) updateSlashPop(false); });
notesEditor().addEventListener('blur', () => setTimeout(closeSlashPop, 0));
$('#paper-scroll').addEventListener('scroll', closeSlashPop, { passive: true });

/* --- The notes, exported: Markdown, Word, PDF, web page, plain text */
/*  One shape for every format: the book's title, a contents list,    */
/*  the notes as written (headings, lists, pictures), then the cards  */
/*  rubric by rubric, their filled fields only.                        */

const NOTES_FORMATS = [
  { label: 'Markdown (.md)', desc: tk('Plain text with its headings and lists; the pictures go in an images folder beside it.'), value: 'md' },
  { label: 'Word (.docx)', desc: tk('To edit or share; pictures included.'), value: 'docx' },
  { label: 'PDF (.pdf)', desc: tk('To read or print, with a contents page and bookmarks.'), value: 'pdf' },
  { label: tk('Web Page (.html)'), desc: tk('One file that opens in any browser, pictures included.'), value: 'html' },
  { label: tk('Plain Text (.txt)'), desc: tk('Words only.'), value: 'txt' }
];

// "Role: Heroine" the way the language writes it
function fieldLine(label, value) {
  const pat = t('{label}: {value}');
  const at = pat.indexOf('{value}');
  return { label: pat.slice(0, at).replace('{label}', label), value };
}

// the notes and the cards as a list of blocks
function notesExportModel(root) {
  const blocks = [];
  let para = '';
  const flush = () => {
    const runs = paraRuns(para).filter((r) => r.text);
    if (runs.some((r) => r.text.trim())) blocks.push({ t: 'p', runs });
    para = '';
  };
  const BLOCK = /^(P|DIV|H1|H2|H3|H4|H5|H6|UL|OL|LI|BLOCKQUOTE|PRE|IMG|BR)$/;
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) { para += escHtml(n.textContent); continue; }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = n.tagName;
      if (!BLOCK.test(tag) && !n.querySelector('p, div, h1, h2, h3, h4, ul, ol, img, br')) { para += n.outerHTML; continue; }
      if (tag === 'BR') { flush(); continue; }
      flush();
      if (/^H[1-6]$/.test(tag)) {
        const text = n.textContent.trim();
        if (text) blocks.push({ t: 'h', level: tag === 'H4' || tag === 'H5' || tag === 'H6' ? 2 : 1, text });
      } else if (tag === 'UL' || tag === 'OL') {
        let i = 0;
        for (const li of n.children) {
          if (li.tagName !== 'LI') continue;
          const runs = paraRuns(li.innerHTML).filter((r) => r.text);
          if (runs.some((r) => r.text.trim())) blocks.push({ t: 'li', ordered: tag === 'OL', n: ++i, runs });
        }
      } else if (tag === 'IMG') {
        if (n.dataset.img) blocks.push({ t: 'img', file: n.dataset.img });
      } else {
        walk(n);
        flush();
      }
    }
  };
  walk(root);
  flush();

  const field = (label, v) => {
    const text = Array.isArray(v) ? v.join(', ') : String(v || '').trim();
    if (text) blocks.push({ t: 'field', ...fieldLine(t(label), text) });
  };
  const pictures = (o) => galleryOf(o).forEach((f) => blocks.push({ t: 'img', file: f }));
  if (storyShown().length) {
    blocks.push({ t: 'h', level: 1, text: t('The story') });
    for (const [f, label] of storyShown()) field(label, storyBible()[f]);
  }
  const stats = castList().length ? bookCastStats() : new Map();
  for (const [key, title] of RUBRICS) {
    const items = rubricCards(key);
    if (!items.length) continue;
    blocks.push({ t: 'h', level: 1, text: t(title) });
    for (const o of items) {
      if (key === 'cast') {
        blocks.push({ t: 'h', level: 2, text: charName(o) || t('Unnamed') });
        if (o.portrait) blocks.push({ t: 'img', file: o.portrait, portrait: true });
        field(tk('Nicknames'), o.nicknames);
        field(tk('Note'), o.note);
        for (const [f, label] of CAST_DETAILS) field(label, o[f]);
        pictures(o);
        const s = stats.get(o.id);
        if (s) blocks.push({ t: 'p', runs: [{ text: castMetaText(s), i: true }] });
      } else {
        const [, fields] = WORLD_TYPES[o.type] || WORLD_TYPES.other;
        blocks.push({ t: 'h', level: 2, text: o.name || worldTypeName(o.type) });
        for (const [f, label] of [...fields, ['notes', tk('Notes')]]) field(label, o[f]);
        pictures(o);
      }
    }
  }
  // every heading gets an anchor, unique, for the contents and the links
  // (the Markdown's in the reader's letters, the page's in plain ASCII:
  // a PDF finds its page numbers only by those)
  const seen = new Map();
  blocks.filter((x) => x.t === 'h').forEach((b, i) => { b.hid = 'n' + (i + 1); });
  for (const b of blocks.filter((x) => x.t === 'h')) {
    const slug = b.text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
    const n = seen.get(slug) || 0;
    seen.set(slug, n + 1);
    b.id = n ? `${slug}-${n}` : slug;
  }
  return {
    title: book.title || t('Untitled'),
    subtitle: tabName('notes'),
    author: book.author || '',
    blocks,
    toc: blocks.filter((x) => x.t === 'h')
  };
}

// a picture's bytes and size, for the formats that carry them
async function notesPicture(file) {
  if (!canBibleImages()) return null;
  const r = await window.neo.bibleReadImage(book.id, file);
  if (!r) return null;
  const url = `data:${r.mime};base64,${r.base64}`;
  const size = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 800, h: 600 });
    img.src = url;
  });
  return { ...r, url, ...size };
}

const mdEscape = (s) => String(s).replace(/([\\`*_[\]#<>])/g, '\\$1');
function mdRuns(runs) {
  return runs.map((r) => {
    const tx = r.text.replace(/([\\*_`~[\]<>])/g, '\\$1');
    const mark = r.b && r.i ? '***' : r.b ? '**' : r.i ? '*' : '';
    if (!mark && !r.s && !r.u) return tx;
    const lead = tx.match(/^\s*/)[0];
    const trail = tx.match(/\s*$/)[0];
    let core = tx.slice(lead.length, tx.length - trail.length);
    if (!core) return tx;
    // as the manuscript's Markdown export writes them
    if (r.s) core = '~~' + core + '~~';
    if (r.u) core = '<u>' + core + '</u>';
    return lead + mark + core + mark + trail;
  }).join('');
}

function notesMd(m) {
  let out = `# ${mdEscape(m.title)}\n\n*${mdEscape(m.subtitle)}*\n\n`;
  if (m.toc.length > 1) {
    out += `## ${mdEscape(t('Contents'))}\n\n`;
    for (const h of m.toc) out += `${h.level === 2 ? '  ' : ''}- [${mdEscape(h.text)}](#${h.id})\n`;
    out += '\n';
  }
  let prev = null;
  for (const b of m.blocks) {
    if (prev === 'li' && b.t !== 'li') out += '\n';
    if (b.t === 'h') out += `${b.level === 1 ? '##' : '###'} ${mdEscape(b.text)}\n\n`;
    else if (b.t === 'p') out += mdRuns(b.runs) + '\n\n';
    else if (b.t === 'li') out += (b.ordered ? `${b.n}. ` : '- ') + mdRuns(b.runs) + '\n';
    else if (b.t === 'field') out += `**${mdEscape(b.label.trim())}**${b.label.endsWith(' ') ? ' ' : ''}${mdEscape(b.value).replace(/\n/g, '  \n')}\n\n`;
    else if (b.t === 'img') out += `![](images/${b.file})\n\n`;
    prev = b.t;
  }
  return out.replace(/\n{3,}/g, '\n\n');
}

function notesTxt(m) {
  let out = `${m.title.toUpperCase()}\n${m.subtitle}\n\n\n`;
  let prev = null;
  for (const b of m.blocks) {
    if (prev === 'li' && b.t !== 'li') out += '\n';
    prev = b.t;
    if (b.t === 'h') out += b.level === 1 ? `\n${b.text.toUpperCase()}\n\n` : `${b.text}\n${'-'.repeat(Math.min(40, b.text.length))}\n\n`;
    else if (b.t === 'p') out += b.runs.map((r) => r.text).join('') + '\n\n';
    else if (b.t === 'li') out += (b.ordered ? `${b.n}. ` : '• ') + b.runs.map((r) => r.text).join('') + '\n';
    else if (b.t === 'field') out += b.label + b.value + '\n\n';
  }
  return out.replace(/\n{3,}/g, '\n\n');
}

const htmlRuns = (runs) => runs.map((r) => {
  let s = escHtml(r.text);
  if (r.i) s = `<i>${s}</i>`;
  if (r.b) s = `<b>${s}</b>`;
  if (r.s) s = `<s>${s}</s>`;
  if (r.u) s = `<u>${s}</u>`;
  return s;
}).join('');

async function notesHtml(m) {
  const pics = {};
  for (const b of m.blocks) if (b.t === 'img' && !(b.file in pics)) pics[b.file] = await notesPicture(b.file);
  const body = [];
  let list = null;
  const closeList = () => { if (list) { body.push(`</${list}>`); list = null; } };
  for (const b of m.blocks) {
    const want = b.t === 'li' ? (b.ordered ? 'ol' : 'ul') : null;
    if (list !== want) { closeList(); if (want) { body.push(`<${want}>`); list = want; } }
    if (b.t === 'h') body.push(`<h${b.level + 1} id="${b.hid}">${escHtml(b.text)}</h${b.level + 1}>`);
    else if (b.t === 'p') body.push(`<p>${htmlRuns(b.runs)}</p>`);
    else if (b.t === 'li') body.push(`<li>${htmlRuns(b.runs)}</li>`);
    else if (b.t === 'field') body.push(`<p class="field"><b>${escHtml(b.label.trim())}</b>${b.label.endsWith(' ') ? ' ' : ''}${escHtml(b.value).replace(/\n/g, '<br>')}</p>`);
    else if (b.t === 'img' && pics[b.file]) body.push(`<figure class="${b.portrait ? 'portrait' : 'pic'}"><img src="${pics[b.file].url}" alt=""></figure>`);
  }
  closeList();
  const toc = m.toc.length > 1 ? `<nav class="contents"><h2>${escHtml(t('Contents'))}</h2><ol>${m.toc.map((h) =>
    `<li class="lv${h.level}"><a href="#${h.hid}"><span class="toc-t">${escHtml(h.text)}</span><span class="toc-pg" data-for="${h.hid}"></span></a></li>`).join('')}</ol></nav>` : '';
  return `<!DOCTYPE html>
<html lang="${escHtml(writingLanguage())}"><head><meta charset="utf-8"><title>${escHtml(m.title)} · ${escHtml(m.subtitle)}</title>
<style>
  body { font-family: ${exportBodyFont()}; font-size: 12pt; line-height: 1.55; color: #1c1a17; max-width: 40em; margin: 3em auto; padding: 0 1.5em; }
  header { text-align: center; margin-bottom: 2.5em; }
  header h1 { font-size: 24pt; margin: 0; }
  header .sub { letter-spacing: 3px; text-transform: uppercase; color: #777; font-size: 10pt; margin-top: .5em; }
  .contents h2 { font-size: 11pt; letter-spacing: 2px; text-transform: uppercase; color: #777; font-weight: normal; }
  .contents ol { list-style: none; padding: 0; margin: 0 0 2.5em; }
  .contents li { margin: .2em 0; }
  .contents li.lv2 { margin-left: 1.6em; }
  .contents a { display: flex; color: inherit; text-decoration: none; }
  .contents .toc-t { flex: 1; }
  .contents .toc-pg { width: 3em; text-align: right; font-variant-numeric: tabular-nums; }
  h2 { font-size: 15pt; margin: 1.8em 0 .5em; border-bottom: 1px solid #ddd; padding-bottom: .2em; }
  h3 { font-size: 13pt; margin: 1.4em 0 .4em; }
  p { margin: .4em 0; }
  p.field b { font-weight: 600; }
  figure { margin: .8em 0; page-break-inside: avoid; }
  figure img { max-width: 100%; max-height: 22em; border-radius: 3px; }
  figure.portrait img { width: 7em; height: 7em; object-fit: cover; border-radius: 50%; }
  @media print { body { margin: 0 auto; } h2, h3 { page-break-after: avoid; } }
</style></head><body>
<header><h1>${escHtml(m.title)}</h1><div class="sub">${escHtml(m.subtitle)}</div>${m.author ? `<div class="sub">${escHtml(m.author)}</div>` : ''}</header>
${toc}
${body.join('\n')}
</body></html>`;
}

async function notesDocx(m) {
  const body = [];
  const media = [];
  const P = (runs, opts) => body.push(docxP(runs, opts));
  P([{ text: m.title, b: true }], { align: 'center', spaceBefore: 2400, size: 48 });
  P([{ text: m.subtitle }], { align: 'center', size: 24, caps: true, tracking: 40 });
  if (m.author) P([{ text: m.author }], { align: 'center', spaceBefore: 400 });
  if (m.toc.length > 1) {
    P([{ text: t('Contents') }], { pageBreak: true, size: 22, caps: true, spaceAfter: 240 });
    for (const h of m.toc) P([{ text: h.text }], { indentLeft: h.level === 2 ? 480 : 0 });
  }
  let first = true;
  for (const b of m.blocks) {
    if (b.t === 'h') {
      P([{ text: b.text }], { style: 'Heading' + b.level, pageBreak: first && m.toc.length > 1 });
      first = false;
    } else if (b.t === 'p') P(b.runs, { spaceAfter: 120 });
    else if (b.t === 'li') P([{ text: b.ordered ? `${b.n}.\t` : '•\t' }, ...b.runs], { indentLeft: 360 });
    else if (b.t === 'field') P([{ text: b.label.trim(), b: true }, { text: (b.label.endsWith(' ') ? ' ' : '') }, ...b.value.split('\n').flatMap((line, i) => (i ? [{ br: true }, { text: line }] : [{ text: line }]))], { spaceAfter: 120 });
    else if (b.t === 'img') {
      const pic = await notesPicture(b.file);
      if (!pic) continue;
      const n = media.length + 1;
      const ext = pic.mime === 'image/png' ? 'png' : 'jpg';
      media.push({ n, ext, base64: pic.base64 });
      // at most 6 by 4 inches on the page (a portrait 1.5 inches square)
      const EMU = 914400;
      const scale = b.portrait ? Math.min(1.5 * EMU / pic.w, 1.5 * EMU / pic.h) : Math.min(6 * EMU / pic.w, 4 * EMU / pic.h, 9525);
      const cx = Math.round(pic.w * scale);
      const cy = Math.round(pic.h * scale);
      body.push(`<w:p><w:pPr><w:spacing w:before="120" w:after="120"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}.${ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImg${n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
    }
  }
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${body.join('')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body></w:document>`;
  const headingStyle = (n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>
<w:pPr><w:keepNext/><w:spacing w:before="${n === 1 ? 480 : 300}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${n === 1 ? 32 : 26}"/></w:rPr></w:style>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${[1, 2].map(headingStyle).join('\n')}
</w:styles>`;
  return [
    { path: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="jpg" ContentType="image/jpeg"/>
<Default Extension="png" ContentType="image/png"/>
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
${media.map((x) => `<Relationship Id="rImg${x.n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${x.n}.${x.ext}"/>`).join('\n')}
</Relationships>` },
    { path: 'word/document.xml', content: documentXml },
    { path: 'word/styles.xml', content: stylesXml },
    ...media.map((x) => ({ path: `word/media/image${x.n}.${x.ext}`, content: x.base64, base64: true, store: true }))
  ];
}

async function exportNotes(format) {
  if (!book) { toast(t('Open a book first')); return; }
  if (!format) format = await optionModal(escHtml(t('Export the notes as…')), null, NOTES_FORMATS.map((f) => ({ ...f, label: t(f.label), desc: t(f.desc) })));
  if (!format) return;
  flushAllSaves();
  // the notes as they are on the page, or from disk when another tab is open
  let root;
  if (inNotes()) root = notesEditor().cloneNode(true);
  else {
    root = document.createElement('div');
    root.innerHTML = (await window.neo.readAux(book.id, 'notes')) || '';
  }
  const m = notesExportModel(root);
  if (!m.blocks.length) { toast(t('Nothing in the notes to export yet.')); return; }
  const defaultName = safeName(book.title || t('Untitled')) + '-' + safeName(tabName('notes'));
  try {
    let payload;
    if (format === 'md') payload = { format, defaultName, content: notesMd(m) };
    else if (format === 'txt') payload = { format, defaultName, content: notesTxt(m) };
    else if (format === 'docx') payload = { format, defaultName, zipEntries: await notesDocx(m) };
    else payload = { format, defaultName, content: await notesHtml(m) };
    const saved = await window.neo.exportSave(payload);
    if (!saved) return;
    const pics = m.blocks.filter((b) => b.t === 'img').map((b) => b.file);
    if (format === 'md' && pics.length && window.neo.bibleExportImages) await window.neo.bibleExportImages(book.id, pics, saved);
    toast(t('Exported: {file}', { file: saved.split(/[\\/]/).pop() }));
  } catch (err) {
    window.neo.logError('export notes ' + format + ': ' + (err && err.stack || err));
    toast(t('Couldn’t export: {error}', { error: plainError(err) }), 8000);
  }
}

if (window.neo && window.neo.onMenu) {
  window.neo.onMenu((msg) => { if (msg.type === 'exportNotes') exportNotes(); });
}
