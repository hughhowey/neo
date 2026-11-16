'use strict';

/* ================================================================== */
/*  EDITOR — open / render                                             */
/* ================================================================== */

let openGeneration = 0;
async function openBook(bookId) {
  // a book being exported from the shelf finishes first (it borrows the
  // open book's place for the moment it takes)
  while (shelfExport) await new Promise((r) => setTimeout(r, 50));
  // Everything is read first and only then becomes the open book, so a
  // second book opened while this one loads (a double click, a slow cloud
  // read) never ends up with a mix of the two.
  const gen = ++openGeneration;
  const meta = await window.neo.readBookMeta(bookId);
  if (!meta || gen !== openGeneration) return;
  const html = {};
  for (const chId of meta.chapterOrder) {
    html[chId] = await window.neo.readChapter(bookId, chId);
    if (gen !== openGeneration) return;
  }
  const sideStickies = await window.neo.readJSON(bookId, 'stickies', []);
  const sideDarlings = await window.neo.readJSON(bookId, 'darlings', []);
  if (gen !== openGeneration) return;
  tabPlaces = {}; // a fresh book starts with fresh places
  book = meta;
  showWindowTitle();
  forgetSnapshots();
  forgetSpelling();
  sideCardsKey = '';
  currentChapterId = null; // never carry a chapter reference across books
  undoStack = []; redoStack = [];
  chapterHTML = html;
  savedHTML = { ...html };
  for (const chId of Object.keys(html)) knowDisk(bookId, chId, html[chId]);
  diskStamps = {};
  savedMetaSig = metaSig(book); // what disk holds; NEO's own defaults don't count as edits
  knownChapters = new Set(book.chapterOrder);
  savedOrder = [...book.chapterOrder];
  stickies = sideStickies;
  darlings = sideDarlings;
  sidecarBase[bookId + '/stickies'] = JSON.stringify(stickies);
  sidecarBase[bookId + '/darlings'] = JSON.stringify(darlings);

  $('#bookshelf-view').hidden = true;
  $('#editor-view').hidden = false;
  applyBright();
  document.execCommand('defaultParagraphSeparator', false, 'p');

  $('#tp-title').textContent = isUntitled(book.title) ? '' : book.title;
  showTitleStyle();
  $('#tp-subtitle').textContent = book.subtitle || '';
  $('#tp-author').textContent = book.author || t('Anonymous');
  $$('.tab[data-tab="notes"]')[0].textContent = tabName('notes');
  $$('.tab[data-tab="outline"]')[0].textContent = tabName('outline');
  spEditorMode(); // a script, or a book

  renderChapters();
  wordsFromDisk(); // what the book holds is not today's writing (#345)
  renderStickies();
  migrateDarlingAnchors(); // sweep legacy invisible markers out of the prose
  reconcileMarks();        // re-adopt any note marks orphaned by cut/paste
  updateCounters();

  // Plotters land in the outline for a brand-new book
  const isNew = book.chapterOrder.length === 0;
  // a new script opens on its title page (it has no outline to open to)
  const newScript = isScript() && isUntitled(book.title) && !bookWordCount();
  if (isNew && library.writingStyle === 'plotter' && !isScript()) {
    switchTab('outline');
  } else {
    switchTab('manuscript');
    if (isNew || newScript) {
      $('#tp-title').focus();
    } else if (book.lastPosition && book.chapterOrder.includes(book.lastPosition.chapterId)) {
      // pick up right where you left off — here, or on the other device
      currentChapterId = book.lastPosition.chapterId;
      const pos = book.lastPosition;
      requestAnimationFrame(() => {
        resumePosition(pos);
        vimRest();
        // closed on the Outline, Notes or Darlings: it opens there again, at
        // the same scroll (the manuscript keeps its own place underneath)
        if (['outline', 'notes', 'darlings'].includes(pos.tab) && book && book.id === bookId) {
          tabPlaces[pos.tab] = { scroll: pos.tabScroll || 0 };
          switchTab(pos.tab);
        }
      });
    }
  }

  // the Enter hint shows once per library, ever
  if (!library.hintShown && !isScript()) {
    library.hintShown = true;
    writeLibrary(library);
    setTimeout(() => toast(t('Enter twice = section break · three times = new chapter · {key} shows everything else', { key: KHELP }), 7000), 800);
  }
  spReportState();
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
      sep.textContent = headingDash();
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
        if (e.isComposing || e.keyCode === 229) { e.stopPropagation(); return; } // an input method's Enter confirms its word
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
    if (chId === solo) body.setAttribute('aria-label', book.title ? shownTitle(book.title) : t('The story'));
    else body.setAttribute('aria-labelledby', head.id);
    body.spellcheck = false; // NEO runs its own spellcheck pass
    if (!story) body.classList.add('no-cap');
    // a script's lines are set as they print (styles.css, SCREENPLAYS)
    if (isScript()) body.classList.add('script-body', $('#paper').classList.contains('narrow') ? 'sp-narrow' : 'sp-geom', 'no-cap');
    body.innerHTML = chapterHTML[chId] || '<p><br></p>';
    // a script saved with its last line element deleted comes back from disk
    // as bare text with no lines at all — Return and Tab do nothing on it and
    // every restart keeps it that way. Wrap the stray text into one line
    // again, as a heading when it reads like one (INT./EXT.), else as action,
    // the way the same typing is set in a script that works
    if (isScript() && !body.querySelector('p') && body.textContent.trim()) {
      const line = document.createElement('p');
      line.innerHTML = body.innerHTML;
      body.innerHTML = '';
      body.appendChild(line);
      if (SP_HEAD_RE.test(line.textContent)) line.classList.add('sp-heading');
    }
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
    // heal the no-break spaces the old engine repair pass planted (the
    // writer's own, Dr. Müller and 5 km, stay)
    healStrayNbsp(body);
    wireChapterBody(body, chId);
  });
  if (nbspMarksEnabled) paintNonBreakingMarks();
  if (isScript()) {
    // the pages are counted before the pane lists the scenes; again once
    // Courier Prime has arrived, in case the first count was in another face
    spRepaginate();
    if (document.fonts) document.fonts.load('1em "Courier Prime"').then(() => spSchedule(0)).catch(() => {});
  }
  applyPaged();
  renderAllFootnoteLists();
  renderNav();
}

async function deleteChapterToDarlings(chId, quiet = false) {
  if (!quiet) snapshotStructure('chapter delete');
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
    await writeSidecar(book.id, 'darlings', darlings);
  }
  const noted = isStory(chId) && await notesPageToDarlings(chId, kind === 'chapter' ? t('deleted Chapter {n}', { n: chapterNumber(chId) }) : name);
  if (noted) await writeSidecar(book.id, 'darlings', darlings);
  if (currentChapterId === chId) currentChapterId = null;
  await deleteChapterQuiet(chId);
  if (text && !quiet) {
    toast(kind === 'chapter'
      ? t('Chapter removed — its words are in Darlings, or {key} to undo', { key: KZ })
      : t('{name} removed — its words are in Darlings, or {key} to undo', { name, key: KZ }));
  } else if (noted && !quiet) {
    toast(t('Chapter removed — its notes are in Darlings, or {key} to undo', { key: KZ }));
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
      ...(moreOn() ? [{ label: t('Text (.txt)'), value: 'txt' }, { label: t('Markdown (.md)'), value: 'md' }, { label: t('HTML (.html)'), value: 'html' }] : []),
      { label: 'PDF (.pdf)', value: 'pdf' },
      { label: t('Word (.docx)'), value: 'docx' }, { label: t('EPUB (.epub)'), value: 'epub' }
    ];
    const fmt = await optionModal(t('Export “{title}”', { title: escHtml(chapterHeading(chId) || chapterName(chId)) }), null, formats);
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
  // a part or a page leaves the story's count, and a chapter coming back
  // joins it again: no word was written or cut, so today doesn't move (#436)
  wordsFromDisk();
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
