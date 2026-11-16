'use strict';

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
// Stray spans, inline styles, trailing <br>s, and the no-break spaces the
// old engine planted all stop at this door (healStrayNbsp); the writer's
// own no-break spaces go through.
// { blanks: true } (a story's text, for the exports): an empty line on the
// page is a blank line in the book too, one for a run of them, none at the
// chapter's top or end. What NEO shows is what the book gets (#461).
function parasFromHtml(html, { blanks = false } = {}) {
  const holder = document.createElement('div');
  holder.innerHTML = html || '';
  // an unwritten outline section is a ghost paragraph plus the scene break
  // NEO planted for it; neither belongs in a book
  holder.querySelectorAll('p.ghost[data-sec-id]').forEach((g) => {
    const brk = holder.querySelector(`p.scene-break[data-sec-brk="${g.dataset.secId}"]`);
    if (brk) brk.remove();
  });
  holder.querySelectorAll('.darling-anchor, .ph-mark, .ghost').forEach((n) => n.remove());
  const paras = [...holder.querySelectorAll('p')].map((p) => {
    const sceneBreak = p.classList.contains('scene-break');
    // a LitRPG box line: its spaces are the writer's (columns), so they stay
    const litrpg = !sceneBreak && p.classList.contains('litrpg');
    const poetry = !litrpg && p.classList.contains('poetry');
    const flush = !poetry && !litrpg && p.classList.contains('flush');
    const align = litrpg ? '' : (p.style && p.style.textAlign) || '';
    const runs = paraRuns(p.innerHTML, !litrpg).filter((r) => r.text || r.fn !== undefined);
    const inner = runs.map((r) => runHtml(litrpg && r.text ? { ...r, text: litrpgSpaces(r.text) } : r)).join('');
    p.querySelectorAll('.fn').forEach((f) => f.remove());
    healStrayNbsp(p);
    return {
      sceneBreak,
      poetry,
      flush,
      litrpg,
      text: litrpg ? p.textContent.replace(/\s+$/, '') : p.innerText.trim(),
      runs,
      align,
      html: `<p${litrpg ? ' class="litrpg"' : poetry ? ' class="poetry"' : flush ? ' class="flush"' : ''}${align ? ` style="text-align:${align}"` : ''}>${inner}</p>`
    };
  });
  // an empty line inside a box is a blank line in it; at a box's edge, or
  // as the whole box, it's nothing
  const has = (p) => p && (p.sceneBreak || p.text);
  const kept = paras.filter((p, i) => {
    if (has(p)) return true;
    if (!p.litrpg) {
      if (!blanks || p.runs.some((r) => r.fn !== undefined)) return false;
      p.blank = true;
      p.poetry = p.flush = false;
      p.align = '';
      p.html = '<p class="blank">&#160;</p>';
      return true;
    }
    let a = i - 1;
    while (a >= 0 && paras[a].litrpg && !has(paras[a])) a--;
    let b = i + 1;
    while (b < paras.length && paras[b].litrpg && !has(paras[b])) b++;
    return !!(paras[a] && paras[a].litrpg && has(paras[a]) && paras[b] && paras[b].litrpg && has(paras[b]));
  });
  if (!blanks) return kept;
  return kept.filter((p, i) => !p.blank || (i > 0 && i < kept.length - 1 && !kept[i - 1].blank && kept.slice(i + 1).some((q) => !q.blank)));
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
    const paras = parasFromHtml(el ? el.innerHTML : (chapterHTML[chId] || ''), { blanks: STORY_KINDS.includes(kind) });
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

/* ================================================================== */
/*  MANUSCRIPT FORMAT                                                  */
/*  File → Export → Manuscript Format…: the open book the way agents   */
/*  and editors ask for it, as Word or PDF. The pages are              */
/*  manuscript.js's (window.NeoManuscript); this is the dialog, which  */
/*  remembers the writer's contact details (library.manuscript, every  */
/*  book) and the byline and header (book.manuscript, this book), and  */
/*  the book's chapters handed over as runs. Desktop only.             */
/* ================================================================== */

// What a submission carries: the story (chapters, a prologue, an
// epilogue, parts) and an epigraph. The copyright, dedication, contents,
// acknowledgments and about-the-author pages stay out.
function manuscriptSections() {
  const { sections } = exportChapters();
  return sections.filter((s) => s.kind === 'chapter' || s.kind === 'part' || s.kind === 'epigraph').map((s) => ({
    kind: s.kind, heading: s.heading || '', partTitle: s.partTitle || '',
    paras: s.paras.map((p) => ({ sceneBreak: p.sceneBreak, blank: !!p.blank, poetry: p.poetry, flush: p.flush, litrpg: !!p.litrpg, align: p.align, runs: p.runs || [] })),
    words: s.paras.reduce((n, p) => n + (p.sceneBreak ? 0 : countWords(p.text || '')), 0)
  }));
}
// the name on the book, as NEO knows it ("Anonymous", the screen's stand-in
// for no name, is no byline)
function manuscriptByline() {
  const real = (x) => (x && String(x).trim() !== t('Anonymous') ? String(x).trim() : '');
  return real(book.author) || real(library.authorName) || '';
}
// what the dialog starts with, from what was kept
function manuscriptDefaults() {
  const lib = library.manuscript || {};
  const mine = (book && book.manuscript) || {};
  const byline = mine.byline || manuscriptByline();
  return {
    name: lib.name != null ? lib.name : (library.authorName || ''),
    address: lib.address || '', phone: lib.phone || '',
    email: lib.email != null ? lib.email : (library.emailAddress || ''),
    font: lib.font === 'courier' ? 'courier' : 'times',
    end: lib.end !== false,
    byline,
    headerName: mine.headerName || NeoManuscript.surnameOf(byline),
    headerTitle: mine.headerTitle || String(book.title || t('Untitled')).toLocaleUpperCase(writingLanguage())
  };
}
function manuscriptModel(v, sections) {
  const words = sections.reduce((n, s) => n + s.words, 0);
  const shown = NeoManuscript.roundWords(words);
  const chapters = sections.filter((s) => s.kind === 'chapter');
  return {
    title: book.title || t('Untitled'), byline: v.byline, headerName: v.headerName, headerTitle: v.headerTitle,
    contact: { name: v.name, lines: [...String(v.address || '').split(/\r?\n/), v.phone, v.email] },
    wordsText: t('about {n} words', { n: shown.toLocaleString(NeoI18n.getLocale()) }),
    byText: v.byline ? t('by {name}', { name: v.byline }) : '',
    endText: v.end ? t('END') : '',
    font: v.font, paper: window.neo.paper || 'Letter', lang: writingLanguage(),
    // one story with no chapters: the short-story layout
    short: sections.length === 1 && chapters.length === 1 && !chapters[0].heading,
    sections, words
  };
}
// Courier Prime (NEO's own Courier, bundled) goes into the PDF; Times New
// Roman is the computer's own. A story with LitRPG boxes carries Courier
// Prime for them either way.
async function manuscriptFontFaces(font, boxes) {
  if (font !== 'courier' && !boxes) return '';
  return embedFontFaces((name) => name === 'Courier Prime');
}

// The dialog: the contact block, the byline and header, the font, END, and
// the two ways out. Resolves to { values, as: 'docx' | 'pdf' } or null.
function manuscriptDialog(v, words) {
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.id = 'manuscript-dialog';
    // (the values go in from code: a quotation mark in a title can't cut one short)
    const field = (k, label, ph = '', type = 'text') => `<label>${escHtml(label)}<input data-k="${k}" type="${type}" placeholder="${escAttr(ph)}" spellcheck="false" autocomplete="off"></label>`;
    bd.innerHTML = `
      <div class="modal ms-modal" role="dialog" aria-modal="true" aria-labelledby="ms-title">
        <h2 id="ms-title">${escHtml(t('Manuscript Format'))}</h2>
        <p class="ms-lead">${escHtml(t('The way agents and editors ask for it: double-spaced 12 point, one-inch margins, a title page with your details, and your name, the title and the page number at the top of every page.'))}</p>
        <div class="ms-cols">
          <fieldset><legend>${escHtml(t('Your details, for the title page'))}</legend>
            ${field('name', t('Name'), t('Your legal name'))}
            <label>${escHtml(t('Address'))}<textarea data-k="address" rows="2" spellcheck="false" placeholder="${escAttr(t('Street, city, postcode'))}"></textarea></label>
            ${field('phone', t('Phone'))}
            ${field('email', t('Email'), '', 'email')}
          </fieldset>
          <fieldset><legend>${escHtml(t('This book'))}</legend>
            ${field('byline', t('Byline'), t('The name on the book'))}
            ${field('headerName', t('Name in the header'))}
            ${field('headerTitle', t('Title in the header'))}
            <p class="ms-header-eg"></p>
            <div class="ms-font" role="radiogroup" aria-label="${escAttr(t('Font'))}">
              <label class="ms-inline"><input type="radio" name="ms-font" value="times"${v.font !== 'courier' ? ' checked' : ''}> Times New Roman</label>
              <label class="ms-inline"><input type="radio" name="ms-font" value="courier"${v.font === 'courier' ? ' checked' : ''}> Courier</label>
            </div>
            <label class="ms-inline"><input type="checkbox" data-k="end"${v.end ? ' checked' : ''}> ${escHtml(t('“END” after the last line'))}</label>
          </fieldset>
        </div>
        <p class="ms-count">${escHtml(t('{shown} on the title page ({n} counted).', { shown: t('about {n} words', { n: NeoManuscript.roundWords(words).toLocaleString(NeoI18n.getLocale()) }), n: words.toLocaleString(NeoI18n.getLocale()) }))}</p>
        <div class="ms-actions">
          <button class="m-cancel btn-quiet">${escHtml(t('Cancel'))}</button>
          <button class="btn-quiet ms-docx">${escHtml(t('Save as Word (.docx)'))}</button>
          <button class="btn-gold ms-pdf">${escHtml(t('Save as PDF'))}</button>
        </div>
      </div>`;
    bd.querySelectorAll('[data-k]').forEach((el) => { if (el.type === 'checkbox') el.checked = !!v[el.dataset.k]; else el.value = v[el.dataset.k] || ''; });
    const read = () => {
      const out = { ...v };
      bd.querySelectorAll('[data-k]').forEach((el) => { out[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
      out.font = (bd.querySelector('input[name="ms-font"]:checked') || {}).value || 'times';
      return out;
    };
    const eg = () => { bd.querySelector('.ms-header-eg').textContent = t('At the top right: {header}', { header: NeoManuscript.headerText(read()) + '1' }); };
    // the header's name follows the byline until it's been changed by hand
    let nameTouched = v.headerName !== NeoManuscript.surnameOf(v.byline);
    bd.querySelector('[data-k="headerName"]').addEventListener('input', () => { nameTouched = true; });
    bd.querySelector('[data-k="byline"]').addEventListener('input', (e) => {
      if (!nameTouched) bd.querySelector('[data-k="headerName"]').value = NeoManuscript.surnameOf(e.target.value);
    });
    bd.addEventListener('input', eg);
    eg();
    const done = (val) => { bd.remove(); resolve(val); };
    bd.querySelector('.m-cancel').onclick = () => done(null);
    bd.querySelector('.ms-docx').onclick = () => done({ values: read(), as: 'docx' });
    bd.querySelector('.ms-pdf').onclick = () => done({ values: read(), as: 'pdf' });
    bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
    document.body.appendChild(bd);
    const first = bd.querySelector(v.name ? '.ms-pdf' : '[data-k="name"]');
    first.focus();
  });
}

// What was typed is kept: the details for every book, the byline and the
// header for this one (only where they differ from what NEO would choose)
async function manuscriptKeep(v) {
  library.manuscript = { name: v.name, address: v.address, phone: v.phone, email: v.email, font: v.font, end: !!v.end };
  await writeLibrary(library);
  const mine = {};
  if (v.byline && v.byline !== manuscriptByline()) mine.byline = v.byline;
  if (v.headerName && v.headerName !== NeoManuscript.surnameOf(v.byline)) mine.headerName = v.headerName;
  if (v.headerTitle && v.headerTitle !== String(book.title || t('Untitled')).toLocaleUpperCase(writingLanguage())) mine.headerTitle = v.headerTitle;
  const before = JSON.stringify(book.manuscript || {});
  if (Object.keys(mine).length) book.manuscript = mine; else delete book.manuscript;
  if (JSON.stringify(book.manuscript || {}) !== before) await saveMeta();
}

let manuscriptBusy = false;
async function exportManuscript() {
  if (!book) { toast(t('Open a book first')); return; }
  if (isScript()) { toast(t('A script has its own format: Export → PDF.')); return; }
  if (!window.NeoManuscript || manuscriptBusy) return;
  // never over another dialog (the menu stays open under one), never twice
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  flushAllSaves();
  const sections = manuscriptSections();
  if (!sections.some((s) => s.kind === 'chapter' && s.words)) { toast(t('There’s no story to send yet.')); return; }
  manuscriptBusy = true;
  try {
    await manuscriptRun(sections);
  } finally {
    manuscriptBusy = false;
  }
}
async function manuscriptRun(sections) {
  const chosen = await manuscriptDialog(manuscriptDefaults(), sections.reduce((n, s) => n + s.words, 0));
  if (!chosen || !book) return;
  // (remembering is a nicety: a library that can't be written now doesn't stop the export)
  try { await manuscriptKeep(chosen.values); } catch (err) { window.neo.logError('manuscript details: ' + (err && err.stack || err)); }
  const m = manuscriptModel(chosen.values, sections);
  const defaultName = safeName(book.title) + '-' + safeName(t('manuscript'));
  try {
    let saved;
    if (chosen.as === 'docx') {
      saved = await window.neo.exportSave({ format: 'docx', defaultName, zipEntries: NeoManuscript.docxEntries(m) });
    } else {
      toast(t('Setting the pages…'));
      const res = await window.neo.printManuscript({ html: NeoManuscript.html(m, { fontFaces: await manuscriptFontFaces(m.font, (m.sections || []).some((sec) => (sec.paras || []).some((x) => x.litrpg))) }), paper: m.paper, defaultName });
      saved = res && res.file;
      if (saved) toast(t('Exported: {file} ({pages} pages)', { file: saved.split(/[\\/]/).pop(), pages: res.pages }), 6000);
      return;
    }
    if (saved) toast(t('Exported: {file}', { file: saved.split(/[\\/]/).pop() }));
  } catch (err) {
    window.neo.logError('export manuscript: ' + (err && err.stack || err));
    toast(t('Couldn’t export: {error}', { error: plainError(err) }), 8000);
  }
}
