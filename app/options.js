'use strict';

/* ================================================================== */
/*  FEATURES & OPTIONS — NEO → Options… (File → Options… off the Mac)  */
/*  One NEO for everyone. Each feature in FEATURES (app/core.js) is on */
/*  or off for the library; one that's off keeps its menu items, keys  */
/*  and right-click choices out of sight. The settings that used to    */
/*  be ticks in the menus live here too. A new library starts with     */
/*  every feature off; a library from before 2.0 keeps what it had:    */
/*  everything on if Show More Features was on, nothing if it wasn't.  */
/* ================================================================== */

// A library from before: Show More Features (library.moreFeatures) becomes
// the features, and simple NEO's quiet defaults become the settings it
// showed, so nothing appears or goes away on the first launch of 2.0. One
// older still, from before the switch, is judged by what it uses.
async function setupFeatures() {
  if (library.features && typeof library.features === 'object') { reportFeatures(); return; }
  let more = typeof library.moreFeatures === 'boolean' ? library.moreFeatures : false;
  if (typeof library.moreFeatures !== 'boolean' && library.firstRunDone) more = await usedMoreFeatures();
  const features = {};
  for (const f of FEATURES) features[f.key] = more;
  // vim keys were their own tick, on only for writers who chose them
  features.vim = more && !!library.vimKeys;
  library.features = features;
  if (!more) {
    // what simple NEO showed: Markdown typing off, no marks, the standard
    // interface size and page width, focus off
    library.markdownOff = true;
    library.nbspMarks = false;
    library.uiZoom = 1;
  }
  delete library.moreFeatures;
  await writeLibrary(library);
  reportFeatures();
}

// a library from before Show More Features: anything it already uses
async function usedMoreFeatures() {
  const lib = library;
  const lang = (code) => String(code || '').split('-')[0];
  if ((lib.authors || []).length > 1 || (lib.shelves || []).some((s) => isBound(s)) ||
    !!lib.vimKeys || !!lib.nbspMarks || !!lib.pagedView ||
    (!!lib.pageWidth && lib.pageWidth !== 'regular') ||
    (lib.uiZoom !== undefined && snapZoom(lib.uiZoom) !== 1) ||
    (!!lib.focus && lib.focus !== 'off') ||
    !!lib.markdownOff || !!lib.exportCustomChapterTitles ||
    (!!lib.spellLanguage && lang(lib.spellLanguage) !== lang(NeoI18n.getLocale()))) return true;
  for (const s of lib.shelves || []) {
    for (const id of s.bookIds || []) {
      const meta = await shelfMeta(id);
      if (meta && (isScript(meta) || hasPainting(meta))) return true;
    }
  }
  return !!(await window.neo.hasSecret(coverProvider()).catch(() => false));
}

// the menus follow the features (main.js leaves out an item whose feature is off)
function reportFeatures() {
  if (!window.neo.featuresState) return;
  const on = {};
  for (const f of FEATURES) on[f.key] = featureOn(f.key);
  window.neo.featuresState(on);
}

async function setFeature(key, on) {
  if (!FEATURES.some((f) => f.key === key)) return;
  library.features = { ...(library.features || {}), [key]: !!on };
  if (key === 'vim') library.vimKeys = !!on;
  await writeLibrary(library);
  reportFeatures();
  applyLook();
  if (book && !$('#editor-view').hidden) {
    if (currentTab === 'manuscript') queueSideCards();
    else switchTab(currentTab); // the Outline's view, the Notes pages, the right-hand pane
  }
}

// ---- the window ----
let optionsOpen = null;
async function openOptions() {
  if (optionsOpen) { optionsOpen.querySelector('.opt-panel').focus(); return; }
  const langs = window.neo.uiLanguages ? await window.neo.uiLanguages().catch(() => null) : null;
  const pressHoldShown = window.neo.platform === 'darwin' && !!window.neo.setPressHold;
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  optionsOpen = bd;
  const features = FEATURES.filter((f) => !IS_POCKET || f.pocket);
  const check = (id, on, label, desc) => `
    <label class="opt-row">
      <input type="checkbox" data-opt="${id}"${on ? ' checked' : ''}>
      <span><span class="opt-label">${label}</span>${desc ? `<span class="opt-desc">${desc}</span>` : ''}</span>
    </label>`;
  const spellCodes = Object.keys(SPELL_LANGUAGE_NAMES);
  bd.innerHTML = `
    <div class="modal options-modal" role="dialog" aria-modal="true" aria-labelledby="opt-title">
      <h2 id="opt-title">${t('Options')}</h2>
      <div class="opt-panel" tabindex="-1">
        <section>
          <div class="opt-head"><h3>${t('Features')}</h3><button class="opt-all btn-link" type="button"></button></div>
          <p class="opt-note">${t('Turn on what you use. Anything a book already holds always shows.')}</p>
          ${features.map((f) => check('feature:' + f.key, featureOn(f.key), t(f.label), t(IS_POCKET && f.pocketDesc ? f.pocketDesc : f.desc))).join('')}
        </section>
        <section>
          <h3>${t('Writing')}</h3>
          ${check('markdown', !markdownOff(), t('Markdown emphasis'), t('*italic* and **bold** typed as you write become italic and bold.'))}
          ${check('nbspMarks', !!library.nbspMarks, t('Non-breaking marks'), t('Tint the spaces and hyphens that hold a line together.'))}
          ${pressHoldShown ? check('pressHold', !!pressHoldOn, t('Press and hold for accents'), t('Hold a letter for é, ñ, ç and the rest. Off, held keys repeat.')) : ''}
          <label class="opt-row opt-select"><span class="opt-label">${t('New books open to')}</span>
            <select data-opt="writingStyle">
              <option value="pantser"${library.writingStyle !== 'plotter' ? ' selected' : ''}>${t('Blank Page')}</option>
              <option value="plotter"${library.writingStyle === 'plotter' ? ' selected' : ''}>${t('Outline First')}</option>
            </select></label>
          ${featureOn('exports') ? check('chapterTitles', !!library.exportCustomChapterTitles, t('Chapter titles only'), t('Exports show a chapter’s own title without “Chapter 7” before it.')) : ''}
        </section>
        <section>
          <h3>${t('Language and size')}</h3>
          ${langs && langs.list && langs.list.length > 1 ? `<label class="opt-row opt-select"><span class="opt-label">${t('Interface language')}</span>
            <select data-opt="uiLanguage">${langs.list.map((l) => `<option value="${escHtml(l.code)}"${l.code === langs.current ? ' selected' : ''}>${escHtml(l.name)}</option>`).join('')}</select></label>` : ''}
          <label class="opt-row opt-select"><span class="opt-label">${t('Spellcheck language')}</span>
            <select data-opt="spellLanguage">${spellCodes.map((c) => `<option value="${c}"${c === library.spellLanguage ? ' selected' : ''}>${escHtml(SPELL_LANGUAGE_NAMES[c])}</option>`).join('')}</select></label>
          ${IS_POCKET ? '' : `<div class="opt-row opt-select"><span class="opt-label">${t('Interface size')}</span>
            <span class="opt-steps"><button type="button" data-zoom="-1" aria-label="${t('Smaller')}">−</button><span class="opt-zoom"></span><button type="button" data-zoom="1" aria-label="${t('Larger')}">+</button><button type="button" class="btn-link" data-zoom="0">${t('Reset')}</button></span></div>`}
        </section>
      </div>
      <div class="opt-foot"><button class="m-ok btn-gold">${t('Done')}</button></div>
    </div>`;
  document.body.appendChild(bd);
  const allBtn = bd.querySelector('.opt-all');
  const paintAll = () => {
    const all = features.every((f) => featureOn(f.key));
    allBtn.textContent = all ? t('Turn all off') : t('Turn all on');
    for (const f of features) { const box = bd.querySelector(`[data-opt="feature:${f.key}"]`); if (box) box.checked = featureOn(f.key); }
  };
  const paintZoom = () => { const z = bd.querySelector('.opt-zoom'); if (z) z.textContent = new Intl.NumberFormat(NeoI18n.getLocale(), { style: 'percent' }).format(snapZoom(library.uiZoom)); };
  paintAll();
  paintZoom();
  allBtn.onclick = async () => {
    const on = !features.every((f) => featureOn(f.key));
    for (const f of features) library.features = { ...(library.features || {}), [f.key]: on };
    library.vimKeys = !!library.features.vim;
    await writeLibrary(library);
    reportFeatures();
    applyLook();
    paintAll();
    if (book && !$('#editor-view').hidden && currentTab !== 'manuscript') switchTab(currentTab);
  };
  bd.addEventListener('change', async (e) => {
    const opt = e.target.dataset && e.target.dataset.opt;
    if (!opt) return;
    const on = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (opt.startsWith('feature:')) { await setFeature(opt.slice(8), on); paintAll(); return; }
    if (opt === 'markdown') { if (on) delete library.markdownOff; else library.markdownOff = true; await writeLibrary(library); return; }
    if (opt === 'nbspMarks') { if (!!on !== nbspMarksEnabled) toggleNbspMarks(); return; }
    if (opt === 'pressHold') { window.neo.setPressHold(!!on); pressHoldOn = !!on; return; }
    if (opt === 'writingStyle') {
      library.writingStyle = on;
      await writeLibrary(library);
      if (window.neo.writingStyleState) window.neo.writingStyleState(library.writingStyle);
      return;
    }
    if (opt === 'chapterTitles') { library.exportCustomChapterTitles = !!on; await writeLibrary(library); return; }
    if (opt === 'spellLanguage') { await changeSpellLanguage(on); return; }
    if (opt === 'uiLanguage') { close(); window.neo.setUiLanguage(on); }
  });
  bd.addEventListener('click', async (e) => {
    const z = e.target.closest && e.target.closest('[data-zoom]');
    if (!z) return;
    const next = nextZoomStep(library.uiZoom, Number(z.dataset.zoom));
    if (next === snapZoom(library.uiZoom)) return;
    library.uiZoom = next;
    await writeLibrary(library);
    applyFonts();
    paintZoom();
  });
  const close = () => { bd.remove(); optionsOpen = null; };
  bd.querySelector('.m-ok').onclick = close;
  bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  bd.addEventListener('mousedown', (e) => { if (e.target === bd) close(); });
  bd.querySelector('.m-ok').focus();
}
