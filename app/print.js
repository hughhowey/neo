'use strict';

/* ================================================================== */
/*  PRINT BOOK — a paperback for KDP                                   */
/*  File → Export → Paperback for KDP… lays the open book out as a     */
/*  print-ready interior PDF at one of KDP's four common trim sizes,   */
/*  and a cover template sized to its page count. This builds the      */
/*  book's HTML; main.js (print:paperback) lays it out in pages with   */
/*  Paged.js, hyphenates it, sets the inside margin KDP asks for at    */
/*  that page count, and prints both files.                            */
/* ================================================================== */

const PRINT_TRIMS = [
  { id: '5x8', label: '5 × 8 in', mm: '127 × 203 mm', size: 10.5, outside: 0.6, perPage: 250 },
  { id: '5.25x8', label: '5.25 × 8 in', mm: '133 × 203 mm', size: 10.75, outside: 0.6, perPage: 265 },
  { id: '5.5x8.5', label: '5.5 × 8.5 in', mm: '140 × 216 mm', size: 11, outside: 0.65, perPage: 290 },
  { id: '6x9', label: '6 × 9 in', mm: '152 × 229 mm', size: 11.5, outside: 0.75, perPage: 330 }
];
const PRINT_DIMS = { '5x8': [5, 8], '5.25x8': [5.25, 8], '5.5x8.5': [5.5, 8.5], '6x9': [6, 9] };
// a CSS string, for the running heads
// (a "<" as an escape too, so a name can't close the style block it sits in)
const cssString = (s) => '"' + String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/</g, '\\3c ').replace(/[\n\r]+/g, ' ') + '"';

// The book's pages for print: the title page, the copyright page on its
// back, the dedication and epigraph, the contents where the writer put
// one, the story (each chapter on a right-hand page), the pages at the back,
// then the other books by the same name and a note to the reader.
// A chapter heading for the regular PDF and the EPUB, whose headings are set
// in capitals: the writer's own title keeps the case it was typed in, as on
// the page and in the paperback ("CHAPTER 7 — Holston"), in a span the
// stylesheet leaves alone.
function headingOwnCase(ch, esc) {
  const whole = esc(ch.heading || '');
  const own = ch.chId && book ? ((book.chapterTitles || {})[ch.chId] || '').trim() : '';
  if (!own || !ch.heading.endsWith(own)) return whole;
  return esc(ch.heading.slice(0, ch.heading.length - own.length)) + `<span class="own">${esc(own)}</span>`;
}

// The drop cap in the PDFs: a little taller than two lines, so its top
// stands at the tall letters (h, l, d) of the line beside it rather than
// below them, at the shorter capitals'. Chromium counts the sink from the
// cap's own top, so "3" here is what keeps it two lines deep; past about
// 2.3 it takes a third line. scripts/litrpg.e2e.js measures it.
const DROP_CAP_SIZE = '2.15 3';

function buildPrintHtml(d, o) {
  const trim = PRINT_TRIMS.find((x) => x.id === o.trim) || PRINT_TRIMS[0];
  const [W, H] = PRINT_DIMS[trim.id];
  const esc = (s) => escHtml(String(s || ''));
  const cap = (library.fonts || {}).dropcap === 'none' ? '' : exportDropCapFont();
  const year = String(new Date().getFullYear());
  // paragraphs of prose, hyphenated in main.js (class "hy")
  // a footnote sits at the foot of its page (Paged.js's float: footnote).
  // NEO writes both numbers itself, through the whole book: Paged.js's own
  // counter gave every note on a page that page's last number.
  const fnStart = new Map();
  let fnRun = 0;
  for (const sec of d.sections) {
    for (const p of sec.paras) { fnStart.set(p, fnRun); fnRun += ((p.html || '').match(FN_HTML) || []).length; }
  }
  const atFoot = (html, p) => {
    let n = fnStart.has(p) ? fnStart.get(p) : 0;
    return html.replace(FN_HTML, (m, note) => { n += 1; return `<sup class="fncall">${n}</sup><span class="footnote"><span class="fnm">${n}</span>&#8194;${note}</span>`; });
  };
  const prose = (paras, opening) => {
    let first = opening;
    let afterBreak = false;
    return paras.map((p, i) => {
      if (p.sceneBreak) { afterBreak = true; return '<p class="brk">*&#8195;*&#8195;*</p>'; }
      if (p.blank) return '<p class="blank">&#160;</p>';
      const inner = atFoot(p.html.replace(/^<p[^>]*>|<\/p>$/g, ''), p);
      if (p.litrpg) { afterBreak = false; return `<p class="${litrpgClass(paras, i)}">${inner || '&#8203;'}</p>`; }
      if (p.poetry) { afterBreak = false; return `<p class="poetry"${p.align ? ` style="text-align:${p.align}"` : ''}>${inner}</p>`; }
      const cls = ['hy'];
      if (first) cls.push('first');
      if (first && OPENING_DASH.test(p.text)) cls.push('dialogue');
      if (afterBreak || p.flush) cls.push('flush');
      first = false;
      afterBreak = false;
      return `<p class="${cls.join(' ')}"${p.align ? ` style="text-align:${p.align}"` : ''}>${inner}</p>`;
    }).join('\n');
  };
  const lines = (paras) => paras.map((p) => {
    if (p.sceneBreak) return '<p class="brk">*&#8195;*&#8195;*</p>';
    const cls = [isAttribution(p) ? 'attr' : '', p.poetry ? 'poetry' : ''].filter(Boolean).join(' ');
    return `<p${cls ? ` class="${cls}"` : ''}>${atFoot(p.html.replace(/^<p[^>]*>|<\/p>$/g, ''), p)}</p>`;
  }).join('\n');

  let body = '';
  // the title page (page 1, a right-hand page)
  body += `<section class="fm titlepage"><h1>${esc(d.title)}</h1>${d.subtitle ? `<p class="sub">${esc(d.subtitle)}</p>` : ''}<p class="auth">${esc(d.author)}</p></section>`;
  // its back: the copyright page, the writer's own or the standard one
  const own = d.sections.find((s) => s.kind === 'copyright');
  let copy = own ? lines(own.paras) : [
    t('Copyright © {year} {name}', { year, name: d.author }),
    t('All rights reserved.'),
    t('No part of this book may be reproduced in any form or by any electronic or mechanical means, including information storage and retrieval systems, without written permission from the author, except for the use of brief quotations in a book review.'),
    ...(o.fiction ? [t('This is a work of fiction. Names, characters, places, and incidents either are the products of the author’s imagination or are used fictitiously. Any resemblance to actual persons, living or dead, events, or locales is entirely coincidental.')] : [])
  ].map((x) => `<p>${esc(x)}</p>`).join('\n');
  if (o.isbn && !/ISBN/i.test(copy)) copy += `\n<p>ISBN ${esc(o.isbn)}</p>`;
  body += `<section class="fm copyright"><div class="cp">${copy}</div></section>`;
  // the dedication and the epigraph, each on a right-hand page
  for (const s of d.sections.filter((x) => x.kind === 'dedication' || x.kind === 'epigraph')) {
    body += `<section class="fm ${s.kind}">${lines(s.paras)}</section>`;
  }
  // the contents, where the writer put a Contents page
  if (d.contents && d.toc && d.toc.length) {
    // (a part page before the story's first page has no number to show)
    const firstStory = d.sections.find((x) => x.kind === 'chapter');
    const unnumbered = new Set();
    for (const x of d.sections) { if (x === firstStory) break; unnumbered.add(x.num); }
    body += `<nav class="fm toc"><h2 class="toc-hd">${esc(t('Contents'))}</h2><ol>${d.toc.map((e) => `
      <li class="lv${e.level} t-${e.type}${unnumbered.has(e.num) ? ' nonum' : ''}"><a href="#s${e.num}"><span class="toc-t">${esc(e.label)}</span></a></li>`).join('')}</ol></nav>`;
  }
  // the story, then the pages at the back: the note to the reader first
  // (right after the last page, where a reader decides to say something),
  // then the writer's own pages, then the other books. The back starts on a
  // right-hand page; its pages after that run on, with no blank between.
  const backPages = [];
  // page 1 is the story's first page (a prologue or chapter 1): the pages
  // before it aren't counted, every page after it is, blank or not
  let numbered = false;
  for (const s of d.sections) {
    const id = 's' + s.num;
    if (['copyright', 'dedication', 'epigraph'].includes(s.kind)) continue;
    if (s.kind === 'part') {
      body += `<section class="fm part" id="${id}"><h2><span class="pl">${esc(s.heading)}</span>${s.partTitle ? `<span class="pt">${esc(s.partTitle)}</span>` : ''}</h2>${lines(s.paras)}</section>`;
      continue;
    }
    const back = s.kind === 'acknowledgments' || s.kind === 'about';
    if (back) { backPages.push(s); continue; }
    // a chapter's name and its title on lines of their own
    let label = '';
    let title = s.heading || '';
    if (s.chId && chapterKind(s.chId) !== 'unnumbered') {
      const own = ((book.chapterTitles || {})[s.chId] || '').trim();
      if (!(library.exportCustomChapterTitles && own)) { label = chapterName(s.chId); title = own; }
    }
    // a title that only repeats the label ("Chapter 1" under "Chapter One") isn't printed twice
    const word = label.split(/\s+/)[0];
    if (title && word && (title.toLowerCase() === label.toLowerCase() ||
        new RegExp('^' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+([0-9]+|[ivxlcdm]+)\\.?$', 'i').test(title))) title = '';
    // "Chapter 7" over "Holston"; a chapter with no title, or a page at
    // the back, is its one line
    let head = '';
    if (label && title) head = `<p class="ch-num">${esc(label)}</p><h2 class="ch-title">${esc(title)}</h2>`;
    else if (label || title) head = `<h2 class="ch-title ch-only">${esc(label || title)}</h2>`;
    if (head) head = `<header class="ch-head">${head}</header>`;
    const pg1 = !back && !numbered;
    if (pg1) numbered = true;
    body += `<section class="${back ? 'backpage' : 'chapter'}${pg1 ? ' pg1' : ''}" id="${id}">${head}${prose(s.paras, !back && !!head)}</section>`;
  }
  const back = [];
  // a note to the reader: a review, and where to find the writer
  const links = o.links || {};
  const reach = [
    links.website && [t('Website'), links.website],
    links.newsletter && [t('Newsletter'), links.newsletter],
    links.email && [t('Email'), links.email],
    ...String(links.social || '').split('\n').map((x) => x.trim()).filter(Boolean).map((x) => ['', x])
  ].filter(Boolean);
  if (o.review || reach.length) {
    back.push(`<section class="backpage note"><header class="ch-head"><h2 class="ch-title ch-only">${esc(t('Thank You for Reading'))}</h2></header>
      ${o.review ? String(o.reviewWords || t('If you enjoyed {title}, please consider leaving a review on Amazon or Goodreads. Even a line or two helps other readers find the book, and it means a great deal to me.', { title: d.title })).split(/\n+/).map((x) => `<p class="hy flush">${esc(x)}</p>`).join('') : ''}
      ${reach.length ? `<p class="reach-hd">${esc(t('Stay in touch'))}</p>${reach.map(([k, v]) => `<p class="reach">${k ? `<span class="k">${esc(k)}</span> ` : ''}${esc(v)}</p>`).join('')}` : ''}
    </section>`);
  }
  // the writer's acknowledgments and about-the-author pages
  for (const s of backPages) {
    back.push(`<section class="backpage" id="s${s.num}"><header class="ch-head"><h2 class="ch-title ch-only">${esc(s.heading)}</h2></header>${prose(s.paras, false)}</section>`);
  }
  // other books by this name
  if (o.alsoBy && o.alsoBy.length) {
    back.push(`<section class="backpage also"><header class="ch-head"><h2 class="ch-title ch-only">${esc(t('Also by {author}', { author: d.author }))}</h2></header>${o.alsoBy.map((x) => `<p>${esc(x)}</p>`).join('')}</section>`);
  }
  body += back.map((x, i) => (i ? x.replace('class="backpage', 'class="backpage run-on') : x)).join('\n');

  const sz = trim.size;
  return `<!DOCTYPE html>
<html lang="${esc(d.language || writingLanguage())}"><head><meta charset="utf-8"><title>${esc(d.title)}</title>
<style>
${o.fonts || ''}
@page { size: ${W}in ${H}in; margin: 0.7in ${trim.outside}in 0.75in ${trim.outside}in; }
@page :left {
  margin-left: ${trim.outside}in; margin-right: __NEO_GUTTER__;
  @top-center { content: ${cssString(d.author)}; }
  @bottom-left { content: counter(page); }
}
@page :right {
  margin-left: __NEO_GUTTER__; margin-right: ${trim.outside}in;
  @top-center { content: ${cssString(d.title)}; }
  @bottom-right { content: counter(page); }
}
/* a printed book's page numbers sit at the outside corners (left pages at
   the left, right pages at the right), where a thumb flipping through finds them (#392) */
@page { @top-center { font-family: ${exportBodyFont()}; font-size: ${(sz * 0.7).toFixed(2)}pt; letter-spacing: 0.16em; text-transform: uppercase; color: #333; vertical-align: bottom; padding-bottom: 0.18in; }
        @bottom-left { font-family: ${exportBodyFont()}; font-size: ${(sz * 0.82).toFixed(2)}pt; color: #333; vertical-align: top; padding-top: 0.2in; text-align: left; }
        @bottom-right { font-family: ${exportBodyFont()}; font-size: ${(sz * 0.82).toFixed(2)}pt; color: #333; vertical-align: top; padding-top: 0.2in; text-align: right; } }
@page :blank { @top-center { content: none; } @bottom-left { content: none; } @bottom-right { content: none; } }
@page front { @top-center { content: none; } @bottom-left { content: none; } @bottom-right { content: none; } }
@page chapter:first { @top-center { content: none; } }
@page back { @top-center { content: none; } }
html, body { margin: 0; padding: 0; }
body { font-family: ${exportBodyFont()}; font-size: ${sz}pt; line-height: 1.42; color: #000; font-kerning: normal; font-variant-ligatures: common-ligatures; }
p { margin: 0; orphans: 2; widows: 2; }
.fm { page: front; break-before: right; text-align: center; }
.titlepage { padding-top: 1.6in; }
.titlepage h1 { font-size: ${(sz * 2.3).toFixed(1)}pt; line-height: 1.15; font-weight: normal; margin: 0; }
.titlepage .sub { font-style: italic; font-size: ${(sz * 1.15).toFixed(1)}pt; margin-top: 0.18in; }
.titlepage .auth { margin-top: 1.3in; font-size: ${(sz * 0.95).toFixed(1)}pt; letter-spacing: 0.2em; text-transform: uppercase; }
.copyright { break-before: left; text-align: left; height: ${(H - 0.7 - 0.75 - 0.05).toFixed(2)}in; position: relative; }
.copyright .cp { position: absolute; left: 0; right: 0; bottom: 0; font-size: ${(sz * 0.78).toFixed(2)}pt; line-height: 1.5; }
.copyright .cp p { margin: 0 0 0.75em; }
.dedication, .epigraph { padding-top: 1.7in; font-style: italic; }
.dedication p, .epigraph p { margin: 0 0 0.6em; }
.epigraph p.attr { font-style: normal; font-size: 0.9em; letter-spacing: 0.04em; margin-top: 0.8em; }
.toc { text-align: left; padding-top: 0.6in; }
.toc-hd { text-align: center; font-weight: normal; font-size: ${(sz * 1.05).toFixed(1)}pt; letter-spacing: 0.22em; text-transform: uppercase; margin: 0 0 0.45in; }
.toc ol { list-style: none; margin: 0; padding: 0; }
.toc li { margin: 0 0 0.35em; }
.toc li.lv1 { padding-left: 1.2em; }
.toc li.t-part { margin-top: 0.9em; letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.92em; }
.toc a { color: inherit; text-decoration: none; display: flex; }
.toc .toc-t { flex: 1; }
.toc a::after { content: target-counter(attr(href url), page); padding-left: 1em; font-variant-numeric: lining-nums tabular-nums; }
.toc li.nonum a::after { content: none; }
.pg1 { counter-reset: page 1; }
.part { padding-top: 2.1in; }
.part h2 { font-weight: normal; margin: 0 0 0.5in; }
.part .pl { display: block; font-size: ${(sz * 1.05).toFixed(1)}pt; letter-spacing: 0.24em; text-transform: uppercase; }
.part .pt { display: block; font-size: ${(sz * 1.9).toFixed(1)}pt; line-height: 1.2; margin-top: 0.2in; }
.part p { font-style: italic; margin: 0 0.3in 0.6em; }
.chapter { page: chapter; break-before: right; }
.backpage { page: back; break-before: right; }
.backpage.run-on { break-before: page; }
.ch-head { padding-top: 1.35in; margin-bottom: 0.42in; text-align: center; break-after: avoid; }
.ch-num { font-size: ${(sz * 0.95).toFixed(1)}pt; letter-spacing: 0.24em; text-transform: uppercase; margin: 0 0 0.16in; }
.ch-title { font-weight: normal; font-size: ${(sz * 1.6).toFixed(1)}pt; line-height: 1.2; margin: 0; }
.ch-title.ch-only { font-size: ${(sz * 1.35).toFixed(1)}pt; letter-spacing: 0.06em; }
p.hy { text-align: justify; text-indent: 1.5em; hyphens: manual; -webkit-hyphens: manual; text-wrap: pretty; }
p.hy.first, p.hy.flush { text-indent: 0; }
${cap ? `p.first:not(.dialogue)::first-letter { initial-letter: ${DROP_CAP_SIZE}; -webkit-initial-letter: ${DROP_CAP_SIZE}; font-family: ${cap}; padding-right: 0.06em; }` : ''}
p.brk { text-align: center; margin: 0.7em 0; break-after: avoid; letter-spacing: 0.1em; }
p.poetry { margin: 0.5em 1.5em; text-align: left; }
p.poetry + p.poetry { margin-top: 0; }
${litrpgCss('p.litrpg', { size: '0.78em', side: '0.15in', pad: '0.12in', fill: '#ebebeb', line: '#9a9a9a', gap: '1.3em' })}
.backpage p.hy { text-indent: 0; margin-bottom: 0.7em; }
.also p { text-align: center; font-style: italic; margin: 0 0 0.45em; }
.note .reach-hd { margin-top: 1.4em; text-align: center; letter-spacing: 0.18em; text-transform: uppercase; font-size: 0.85em; }
.note .reach { text-align: center; margin-top: 0.35em; }
.note .reach .k { font-variant-caps: all-small-caps; letter-spacing: 0.08em; }
.neo-pad { page: front; break-before: page; height: 1px; }
.footnote { float: footnote; font-size: ${(sz * 0.8).toFixed(2)}pt; line-height: 1.35; text-align: left; text-indent: 0; hyphens: manual; font-style: normal; font-weight: normal; }
.footnote::footnote-marker { content: none; }
::footnote-call { content: none; }
[data-footnote-marker] { list-style: none; }
.fncall { font-size: 0.7em; vertical-align: super; line-height: 0; }
@page { @footnote { border-top: 0.4pt solid #555; padding-top: 0.4em; margin-top: 0.8em; } }
</style></head><body>
${body}
</body></html>`;
}

// File → Export → Paperback for KDP…: the size, the paper, and what goes
// at the back. The choices are kept: the book's with the book, the
// contact details with the name it's written under.
async function printPaperback() {
  if (!book) return;
  if (isScript()) { toast(t('A script exports as a PDF, Fountain or Final Draft; paperbacks are for books')); return; }
  // one at a time: the pages are set in a single window
  if (printPaperback.busy) { toast(t('Still setting the pages of the last paperback…')); return; }
  flushAllSaves();
  const author = currentAuthor();
  const bp = book.print || {};
  const ap = author.print || {};
  const hasDedication = book.chapterOrder.some((c) => chapterKind(c) === 'dedication');
  // the other books written under this name, newest first
  const others = [];
  for (const s of shelvesFor(author.id)) {
    for (const id of s.bookIds) {
      if (id === book.id) continue;
      const m = await shelfMeta(id);
      if (!m || isPageMeta(m) || isScript(m) || isUntitled(m.title)) continue;
      others.push({ id, title: m.title });
    }
  }
  // the Also by list is the writer's own, one title per line: it starts as
  // this name's other books in NEO, and can hold books written before NEO
  const alsoText = typeof ap.alsoByText === 'string' ? ap.alsoByText
    : Array.isArray(ap.alsoBy) ? others.filter((x) => ap.alsoBy.includes(x.id)).map((x) => x.title).join('\n')
      : others.map((x) => x.title).join('\n');
  const reviewDefault = t('If you enjoyed {title}, please consider leaving a review on Amazon or Goodreads. Even a line or two helps other readers find the book, and it means a great deal to me.', { title: book.title });
  const reviewText = ap.reviewText ? ap.reviewText.split('{title}').join(book.title) : reviewDefault;
  const field = (id, label, value, ph = '') => `<label>${label}<input id="${id}" type="text" spellcheck="false" value="${escHtml(value || '').replace(/"/g, '&quot;')}" placeholder="${escHtml(ph).replace(/"/g, '&quot;')}"/></label>`;
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal print-modal" style="width:560px">
      <h2 style="font-size:17px">${t('Paperback for KDP')}</h2>
      <p class="pm-hint">${t('A print-ready interior PDF and a cover template sized to its page count, for Amazon KDP.')}</p>
      <div class="pm-row pm-trims">${PRINT_TRIMS.map((x) => `
        <button type="button" class="fr-choice${(bp.trim || '5.5x8.5') === x.id ? ' sel' : ''}" data-trim="${x.id}"><strong>${x.label}</strong><span>${x.mm}</span></button>`).join('')}
      </div>
      <div class="pm-row">
        <label>${t('Paper')}
          <select id="pm-paper">
            ${[['cream', t('Cream')], ['white', t('White')], ['groundwood', t('Groundwood')]].map(([v, l]) => `<option value="${v}"${(bp.paper || 'cream') === v ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        ${field('pm-isbn', t('ISBN (optional)'), bp.isbn, '979-8-…')}
      </div>
      <label class="pm-check"><input id="pm-fiction" type="checkbox"${bp.fiction !== false ? ' checked' : ''}/> ${t('The standard fiction notice on the copyright page')}</label>
      ${hasDedication ? '' : field('pm-dedication', t('Dedication (optional)'), '', t('For…'))}
      <h3>${t('At the back of the book, for {name}', { name: escHtml(author.name || displayAuthor()) })}</h3>
      <div class="pm-review-row"><label class="pm-check"><input id="pm-review" type="checkbox"${ap.review !== false ? ' checked' : ''}/> ${t('Ask readers for a review')}</label><button type="button" class="pm-edit btn-quiet">${t('Edit wording')}</button></div>
      <textarea id="pm-review-text" rows="3" hidden>${escHtml(reviewText)}</textarea>
      <div class="pm-row">
        ${field('pm-web', t('Website'), ap.website, 'example.com')}
        ${field('pm-news', t('Newsletter'), ap.newsletter, 'example.com/newsletter')}
      </div>
      <div class="pm-row">
        ${field('pm-email', t('Email'), ap.email)}
        <label>${t('Social media, one per line')}<textarea id="pm-social" rows="2" spellcheck="false">${escHtml(ap.social || '')}</textarea></label>
      </div>
      <label class="pm-also">${t('Also by {name}, one title per line', { name: escHtml(author.name || displayAuthor()) })}<textarea id="pm-also" rows="4" spellcheck="false">${escHtml(alsoText)}</textarea></label>
      <div style="text-align:right;margin-top:14px">
        <button class="m-cancel btn-quiet" style="margin-right:10px">${t('Cancel')}</button>
        <button class="m-ok btn-gold">${t('Make PDFs')}</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  bd.querySelector('.pm-edit').onclick = (e) => {
    const ta = bd.querySelector('#pm-review-text');
    ta.hidden = false;
    e.currentTarget.hidden = true;
    ta.focus();
  };
  let trim = bp.trim || '5.5x8.5';
  const selTrim = bd.querySelector('.fr-choice.sel');
  if (selTrim) selTrim.focus({ preventScroll: true });
  for (const b of bd.querySelectorAll('[data-trim]')) {
    b.onclick = () => { trim = b.dataset.trim; b.focus({ preventScroll: true }); bd.querySelectorAll('[data-trim]').forEach((x) => x.classList.toggle('sel', x === b)); };
  }
  const go = await new Promise((resolve) => {
    bd.querySelector('.m-ok').onclick = () => resolve(true);
    bd.querySelector('.m-cancel').onclick = () => resolve(false);
    bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); resolve(false); } });
  });
  const val = (id) => { const el = bd.querySelector('#' + id); return el ? el.value.trim() : ''; };
  const opts = {
    trim,
    paper: val('pm-paper') || 'cream',
    isbn: val('pm-isbn'),
    fiction: bd.querySelector('#pm-fiction').checked,
    review: bd.querySelector('#pm-review').checked,
    links: { website: val('pm-web'), newsletter: val('pm-news'), email: val('pm-email'), social: bd.querySelector('#pm-social').value.trim() },
    alsoByText: bd.querySelector('#pm-also').value.replace(/\r/g, '').split('\n').map((x) => x.trim()).filter(Boolean).join('\n'),
    reviewText: bd.querySelector('#pm-review-text').value.trim(),
    dedication: val('pm-dedication')
  };
  bd.remove();
  if (!go) return;
  // kept for next time
  book.print = { trim: opts.trim, paper: opts.paper, isbn: opts.isbn, fiction: opts.fiction };
  // The wording is kept with the title as a blank, so it fits the next
  // book. Left as it came, it stays what it was (NEO's own wording follows
  // its translations); edited, the book's title where it stands as a whole
  // becomes the blank again.
  let ownWording = ap.reviewText || '';
  if (opts.reviewText && opts.reviewText !== reviewText) {
    const tt = book.title.trim();
    const esc = tt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    ownWording = opts.reviewText === reviewDefault ? ''
      : tt.length > 1 ? opts.reviewText.replace(new RegExp('(^|[^\\p{L}\\p{N}])' + esc + '(?![\\p{L}\\p{N}])', 'gu'), '$1{title}') : opts.reviewText;
  }
  author.print = { review: opts.review, ...opts.links, alsoByText: opts.alsoByText, reviewText: ownWording };
  await saveMeta();
  await writeLibrary(library);
  // a dedication typed here becomes the book's own Dedication page
  if (opts.dedication && !hasDedication) {
    const at = book.chapterOrder.findIndex((c) => !['copyright'].includes(chapterKind(c)));
    const chId = newEntryId();
    book.chapterOrder.splice(at < 0 ? 0 : at, 0, chId);
    setChapterKind(chId, 'dedication');
    chapterHTML[chId] = `<p>${escHtml(opts.dedication)}</p>`;
    await persistChapter(chId);
    await saveMeta();
    renderChapters();
  }
  const d = bookExportData();
  opts.alsoBy = opts.alsoByText ? opts.alsoByText.split('\n') : [];
  opts.reviewWords = opts.reviewText || reviewDefault;
  const words = d.sections.reduce((n, s) => n + s.paras.reduce((m, p) => m + countWords(p.text || ''), 0), 0);
  const per = (PRINT_TRIMS.find((x) => x.id === opts.trim) || PRINT_TRIMS[0]).perPage;
  toast(t('Setting the pages…'), 600000);
  printPaperback.busy = true;
  try {
    const html = buildPrintHtml(d, { ...opts, fonts: await exportFontFaces(d) });
    const r = await window.neo.printPaperback({
      html, trim: opts.trim, paper: opts.paper, language: d.language,
      pagesGuess: Math.round(words / per) + d.sections.length * 1.5 + 8,
      title: d.title, author: d.author,
      defaultName: safeName(d.title) + ' - ' + t('paperback') + ' ' + opts.trim
    });
    if (!r) { toast(t('Not saved')); return; }
    let msg = t('Saved the interior ({pages} pages) and its cover template (spine {spine} in)', { pages: r.pages, spine: r.spine });
    if (r.tooFew) msg += ' · ' + t('KDP needs at least 24 pages');
    if (r.tooMany) msg += ' · ' + t('more pages than KDP prints on this paper');
    toast(msg, 9000);
  } catch (err) {
    window.neo.logError('paperback: ' + (err && err.stack || err));
    toast(t('Couldn’t export: {error}', { error: plainError(err) }), 8000);
  } finally {
    printPaperback.busy = false;
  }
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
  let fnN = 0;
  for (const ch of d.sections) {
    if (ch.heading) out += `${plainHeading(ch).toUpperCase()}\n\n`;
    const notes = [];
    ch.paras.forEach((p, i) => {
      if (p.blank) { out += '\n'; return; } // the blank line the page shows
      // a LitRPG box: its lines one under the other, spaces as typed
      if (p.litrpg) {
        out += p.text + '\n' + (ch.paras[i + 1] && ch.paras[i + 1].litrpg ? '' : '\n');
        return;
      }
      const noted = (p.runs || []).some((r) => r.fn !== undefined);
      const text = noted ? p.runs.map((r) => (r.fn !== undefined ? (notes.push(r.fn), `[${++fnN}]`) : r.text)).join('').trim() : p.text;
      out += p.sceneBreak ? '\n***\n\n' : (p.poetry ? '    ' : '') + text + '\n\n';
    });
    if (notes.length) out += '----------\n' + notes.map((n, i) => `[${fnN - notes.length + i + 1}] ${n}`).join('\n') + '\n\n';
    out += '\n';
  }
  return out;
}

function buildMd(data) {
  const d = data || bookExportData();
  // a title like "Wool *Omnibus*" must not turn into markup (idea: nejcc, #70)
  const mdMeta = (s) => String(s || '').replace(/([\\`*_\[\]#<>])/g, '\\$1');
  // wrap a run in emphasis markers, keeping boundary spaces outside them
  // Markdown has strikethrough; underline goes as HTML, which it allows
  const mdMarks = [{ key: 'b', open: '**', close: '**' }, { key: 'i', open: '*', close: '*' },
    { key: 's', open: '~~', close: '~~' }, { key: 'u', open: '<u>', close: '</u>' }];
  const mdRuns = (runs) => markedRuns(runs, mdMarks, (t) => t.replace(/([\\*_`~])/g, '\\$1'));
  let out = `# ${mdMeta(d.title)}\n\n`;
  if (d.subtitle) out += `*${mdMeta(d.subtitle)}*\n\n`;
  out += `**${t('by {author}', { author: mdMeta(d.author) })}**\n\n`;
  let fnN = 0;
  for (const ch of d.sections) {
    if (ch.heading) out += `\n## ${mdMeta(plainHeading(ch))}\n\n`;
    const notes = [];
    ch.paras.forEach((p, i) => {
      if (p.blank) { out += '&nbsp;\n\n'; return; } // the blank line the page shows
      // a LitRPG box: a fenced block, which keeps its spaces and monospace
      if (p.litrpg) {
        const top = !(ch.paras[i - 1] && ch.paras[i - 1].litrpg);
        const end = !(ch.paras[i + 1] && ch.paras[i + 1].litrpg);
        out += (top ? '```\n' : '') + p.text + '\n' + (end ? '```\n\n' : '');
        return;
      }
      const runs = (p.runs || []).map((r) => (r.fn !== undefined ? (notes.push(r.fn), { text: '\uE001' + (++fnN) + '\uE002' }) : r));
      out += p.sceneBreak ? '\n***\n\n' : (p.poetry ? '> ' : '') + mdRuns(runs).replace(/\uE001(\d+)\uE002/g, '[^$1]') + '\n\n';
    });
    notes.forEach((n, i) => { out += `[^${fnN - notes.length + i + 1}]: ${mdMeta(n)}\n`; });
    if (notes.length) out += '\n';
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
  // a book with LitRPG boxes carries their monospace face too
  const mono = d.sections.some((ch) => ch.paras.some((p) => p.litrpg)) ? LITRPG_FONT : '';
  return embedFontFaces((name, weight, style) => {
    const forBody = name === family && !(style === 'italic' && !(parseInt(weight, 10) >= 600 ? boldItalic : italic));
    const forCap = name === cap && style === 'normal' && parseInt(weight, 10) === 400;
    const forMono = !!mono && name === mono;
    return forBody || forCap || forMono;
  });
}

// One of NEO's own font files, as base64
async function fontBase64(url) {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
// The @font-face rules an export carries (PDF, paperback, manuscript, a
// script's PDF): every face NEO bundles for which pick(name, weight, style)
// says yes, the file inside as data. A face keeps its range and measures,
// so a Russian face never stands in for the Latin one at the Latin one's
// size. A face that won't read is left out; its fallbacks stand in.
async function embedFontFaces(pick) {
  let css = '';
  for (const sheet of document.styleSheets) {
    let rules = [];
    try { rules = [...sheet.cssRules]; } catch { continue; }
    for (const r of rules) {
      if (!(r instanceof CSSFontFaceRule)) continue;
      const name = r.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
      const style = r.style.getPropertyValue('font-style') || 'normal';
      const weight = r.style.getPropertyValue('font-weight') || '400';
      if (!pick(name, weight, style)) continue;
      const src = r.style.getPropertyValue('src').match(/url\(["']?([^"')]+)["']?\)\s*(format\([^)]*\))?/);
      if (!src) continue;
      const fit = ['unicode-range', 'size-adjust', 'ascent-override', 'descent-override', 'line-gap-override']
        .map((k) => r.style.getPropertyValue(k) && ` ${k}: ${r.style.getPropertyValue(k)};`).filter(Boolean).join('');
      try {
        const data = await fontBase64(new URL(src[1], sheet.href || location.href));
        const ext = src[1].split('.').pop().toLowerCase();
        css += `@font-face { font-family: '${name}'; src: url(data:font/${ext};base64,${data}) ${src[2] || ''}; font-weight: ${weight}; font-style: ${style};${fit} }\n`;
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
      if (p.blank) return '<p class="blank">&#160;</p>';
      if (p.litrpg) { afterBreak = false; return `<p class="${litrpgClass(paras, paras.indexOf(p))}">${p.html.replace(/^<p[^>]*>|<\/p>$/g, '') || '&#8203;'}</p>`; }
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
  // In the PDF, page 1 is the story's first page (a prologue or chapter 1):
  // the pages before it aren't counted; after it every page is, though a
  // page like a part's title still shows no number
  const firstStory = d.sections.find((x) => (x.kind || 'chapter') === 'chapter');
  let counting = false;
  let fnN = 0;
  const sectionHtml = (sec) => {
    const { paras, notes } = fnParas(sec.paras, fnN, (note, n) => `<sup class="fnref"><a href="#fn${n}" id="fnr${n}">${n}</a></sup>`);
    const html = sectionBody(notes.length ? { ...sec, paras } : sec);
    if (!notes.length) return html;
    const list = `<aside class="notes">${notes.map((note, i) => `<p id="fn${fnN + i + 1}"><a href="#fnr${fnN + i + 1}">${fnN + i + 1}</a>&#8194;${note}</p>`).join('')}</aside>`;
    fnN += notes.length;
    const at = html.lastIndexOf('</section>');
    return at < 0 ? html + list : html.slice(0, at) + list + html.slice(at);
  };
  const sectionBody = (ch) => {
    const id = 's' + ch.num;
    const h = headTag(ch);
    const kind = ch.kind || 'chapter';
    if (firstStory && ch.num === firstStory.num) counting = true;
    const counted = counting ? ' counted' : '';
    if (kind === 'copyright' || kind === 'dedication' || kind === 'epigraph') {
      return `
    <section class="page ${kind}${counted}" id="${id}"><div class="pg-in">${lines(ch.paras, kind !== 'copyright')}</div></section>`;
    }
    if (kind === 'part') {
      // the separator is there for the PDF's bookmarks ("Part I: Title"),
      // not for the eye
      return `
    <section class="page part${counted}" id="${id}">
      <${h} class="hd"><span class="pl">${escHtml(ch.heading)}</span>${ch.partTitle ? `<span class="sep">: </span><span class="pt">${escHtml(ch.partTitle)}</span>` : ''}</${h}>
      ${lines(ch.paras)}
    </section>`;
    }
    if (kind === 'opener') {
      return `
    <section class="page opener${counted}" id="${id}">
      <${h} class="hd">${escHtml(ch.heading)}</${h}>
      ${ch.subtitle ? `<p class="sub">${escHtml(ch.subtitle)}</p>` : ''}
      ${ch.byline ? `<p class="byline">${escHtml(ch.byline)}</p>` : ''}
    </section>`;
    }
    const back = kind === 'acknowledgments' || kind === 'about';
    return `
    <section class="chapter${back ? ' backpage' : ''}" id="${id}">
      ${ch.heading ? `<${h} class="hd">${headingOwnCase(ch, escHtml)}</${h}>` : ''}
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
      </ol>${firstStory ? `<a class="p1-ref" href="#s${firstStory.num}" data-p1="s${firstStory.num}" aria-hidden="true" tabindex="-1">.</a>` : ''}
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
<html lang="${escHtml(d.language || writingLanguage())}"><head><meta charset="utf-8"><title>${escHtml(d.title)}</title>
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
  .chapter .hd .own { font-variant-caps: normal; letter-spacing: 0.5px; }
  /* set like a printed book: justified, hyphenated in the book's language,
     no line left alone at the top or foot of a page */
  .chapter p { text-indent: 2em; margin: 0; text-align: justify; hyphens: auto; -webkit-hyphens: auto; widows: 2; orphans: 2; }
  .chapter p.poetry { text-align: left; hyphens: manual; -webkit-hyphens: manual; }
  .chapter .hd + p, .chapter .byline + p, .chapter .brk + p, .brk + p, .chapter p.first { text-indent: 0; }
  .chapter p.dialogue { text-indent: 2em; }
  /* the drop cap the page sets, two lines deep in its own face. An initial
     letter, not a float: it stays inside its word, so the PDF's copy,
     search, and screen readers still find "The" where a float leaves "T"
     and "he" (a gap much wider than 4px splits the word again). A browser
     that can't set one gets a raised initial. */
  ${(library.fonts || {}).dropcap === 'none' ? '' : `.chapter p.first:not(.dialogue)::first-letter { -webkit-initial-letter: ${DROP_CAP_SIZE}; initial-letter: ${DROP_CAP_SIZE}; padding-right: 4px; font-family: ${exportDropCapFont()}; }
  @supports not ((initial-letter: 2) or (-webkit-initial-letter: 2)) { .chapter p.first:not(.dialogue)::first-letter { font-size: 1.8em; line-height: 1; padding-right: 0; } }`}
  .chapter .brk, .brk { text-align: center; text-indent: 0 !important; letter-spacing: 8px; color: #888; margin: 2.5em 0; }
  .chapter p.poetry { text-indent: 0; margin: 0 2.5em; }
  .chapter p.flush { text-indent: 0 !important; }
  ${litrpgCss('.chapter p.litrpg', { size: '0.8em', side: '1.5em', pad: '1em', fill: '#ececec', line: '#a0a0a0', gap: '1.1em' })}
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
  /* footnotes: the number links down to the note, which closes its chapter */
  .fnref { font-size: 0.68em; line-height: 0; vertical-align: super; }
  .fnref a, .notes a { color: inherit; text-decoration: none; }
  .notes { margin-top: 2.6em; padding-top: 0.6em; font-size: 10.5pt; line-height: 1.5; text-align: left; position: relative; break-inside: auto; }
  .notes::before { content: ''; position: absolute; top: 0; left: 0; width: 30%; border-top: 1px solid #aaa; }
  .chapter .notes p, .page .notes p { text-indent: 0; text-align: left; margin: 0 0 0.45em; font-style: normal; hyphens: manual; }
  /* printed pages carry their number at the foot; the cover, the title
     page and the pages that aren't chapters don't, the way books do it
     (only the PDF uses these rules) */
  @page { @bottom-center { content: counter(page); font-family: ${exportBodyFont()}; font-size: 9pt; color: #777; } }
  @page front { counter-increment: page 0; @bottom-center { content: none; } }
  @page quiet { @bottom-center { content: none; } }
  .coverpage, .titlepage, .page, .contents { page: front; }
  .page.counted { page: quiet; }
  /* (the link that tells the printer where page 1 is, unseen) */
  .contents .p1-ref { position: absolute; color: transparent; font-size: 1px; text-decoration: none; }
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

// (characters XML 1.0 forbids, pasted in from a PDF or a terminal, come
// out: one of them makes a whole EPUB or Word file unreadable)
const escXml = (s) => String(s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// Walk a paragraph's DOM and emit [{text, b, i}] so docx/epub get real bold/italic.
// In the manuscript an italic inside an italic is emphasis in a poetry
// paragraph (itself one italic), and it is set upright, the typesetter's
// way (flip). Pasted HTML often doubles its italics for nothing; not there.
// Footnotes in the exports (FOOTNOTES): numbered through the whole book, as
// on the page. A paragraph's html carries each marker as runHtml wrote it;
// FN_HTML finds them, its first group the note (attribute-escaped).
const FN_HTML = /<span class="fn" data-note="([^"]*)" contenteditable="false">\u200B<\/span>/g;
// the notes in the sections before this one: where its numbers start
const fnBefore = (d, ch) => d.sections.slice(0, Math.max(0, d.sections.indexOf(ch)))
  .reduce((n, sec) => n + sec.paras.reduce((m, p) => m + ((p.html || '').match(FN_HTML) || []).length, 0), 0);
// a section's paragraphs with each marker swapped for what a format sets
// there; mark(note, n) gets the note (attribute-escaped) and its number
function fnParas(paras, start, mark) {
  const notes = [];
  const out = paras.map((p) => (p.html && p.html.includes('class="fn"')
    ? { ...p, html: p.html.replace(FN_HTML, (m, note) => { notes.push(note); return mark(note, start + notes.length); }) }
    : p));
  return { paras: out, notes };
}

// a run's text in the manuscript's own inline tags
function runHtml(r, esc = escHtml) {
  if (r.br) return '<br>';
  if (r.fn !== undefined) return `<span class="fn" data-note="${escAttr(r.fn)}" contenteditable="false">\u200B</span>`;
  let t = esc(r.text);
  if (r.s) t = '<s>' + t + '</s>';
  if (r.u) t = '<u>' + t + '</u>';
  if (r.i) t = '<i>' + t + '</i>';
  if (r.b) t = '<b>' + t + '</b>';
  return t;
}
// A no-break space the writer put between two words (Dr. Müller, 5 km, a
// space that keeps a dash off the start of a line) stays wherever the text
// goes. The old editing engine planted others, beside a plain space or at
// a line's start or end, to hold doubled spaces open; those turn back into
// plain spaces. Paragraph by paragraph, so a space at the edge of italics
// still sees its neighbours.
function healStrayNbsp(root) {
  let blocks = root.querySelectorAll ? [...root.querySelectorAll('p')] : [];
  if (!blocks.length) blocks = [root];
  let changed = false;
  for (const block of blocks) {
    const nodes = [];
    const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) nodes.push(n);
    const all = nodes.map((x) => x.data).join('');
    if (!all.includes('\u00a0')) continue;
    const open = (c) => c === undefined || /\s/.test(c); // \s takes in no-break spaces too
    let at = 0;
    for (const x of nodes) {
      const d = x.data;
      let out = '';
      for (let i = 0; i < d.length; i++) {
        out += d[i] === '\u00a0' && (open(all[at + i - 1]) || open(all[at + i + 1])) ? ' ' : d[i];
      }
      at += d.length;
      if (out !== d) { x.data = out; changed = true; }
    }
  }
  return changed;
}
// ---- non-breaking marks: the characters a wrap must not break at, and the
// range rule behind the Format menu's Non-Breaking Marks option. The three are
// U+00A0 no-break space, U+202F narrow no-break space and U+2011 no-break
// hyphen; all get the same unobtrusive light gray, the way Word and
// LibreOffice show them — one "this character is special", not a colour code.
// A streak of the same character is one run.
const NB_CHARS = { '\u00a0': 'space', '\u202f': 'narrow', '\u2011': 'hyphen' };
function nonBreakingRuns(text) {
  const runs = [];
  let i = 0;
  while (i < text.length) {
    const kind = NB_CHARS[text[i]];
    if (!kind) { i += 1; continue; }
    let j = i + 1;
    while (j < text.length && text[j] === text[i]) j += 1;
    runs.push({ start: i, end: j, kind });
    i = j;
  }
  return runs;
}

// Soft hyphens (U+00AD) show too while the marks are on: the places a long
// word (Donau|dampf|schiff|fahrt) may be broken by a reader that doesn't
// hyphenate on its own. Mid-line a soft hyphen is zero wide, so a highlight
// has nothing to paint; it gets a patch of the same light gray instead, an
// en space wide and laid over the letters either side, like a space the
// word could open at. Where the line does break there, the patch still
// stands before the hyphen the browser draws, so a soft hyphen at a line's
// end reads differently from a typed one.
const SOFT_HYPHEN = '\u00ad';
function softHyphenOffsets(text) {
  const out = [];
  for (let i = text.indexOf(SOFT_HYPHEN); i !== -1; i = text.indexOf(SOFT_HYPHEN, i + 1)) out.push(i);
  return out;
}
// Where a soft hyphen's mark goes on its sheet: from the box the browser
// gives the character and the sheet's corner. The box is zero wide, mid-line
// and at a break alike (the hyphen drawn there lies outside it), so its left
// edge is the break point whichever way the line runs. The mark is 0.5em
// wide (an en space), centred on that point and laid over the letters
// either side, so the line keeps its length. Its top and height are the
// box's own, the same the gray highlight paints for a no-break space beside
// it, from above the letters to below the baseline. No box (the text isn't
// laid out) means no mark.
const SHY_MARK_WIDTH = 0.5;
function softHyphenTick(rect, origin, em) {
  if (!rect || !(rect.height > 0)) return null;
  const width = em * SHY_MARK_WIDTH;
  return {
    left: rect.left - origin.left - width / 2,
    top: rect.top - origin.top,
    width,
    height: rect.height,
  };
}

// Paints those characters in every open chapter with the CSS Highlight API,
// so the marks never enter the chapter HTML — the same door search,
// spellcheck and focus use. Off means nothing is painted at all.
const NB_MARK_NAME = 'neo-nb-mark';
function paintNonBreakingMarks() {
  queueSoftHyphenTicks();
  if (!(window.CSS && CSS.highlights && window.Highlight)) return;
  CSS.highlights.delete(NB_MARK_NAME);
  if (!nbspMarksEnabled) return;
  const marks = new Highlight();
  for (const body of $$('#chapters .chapter-body')) {
    const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walk.nextNode())) {
      for (const run of nonBreakingRuns(node.data)) {
        const range = document.createRange();
        range.setStart(node, run.start);
        range.setEnd(node, run.end);
        marks.add(range);
      }
    }
  }
  CSS.highlights.set(NB_MARK_NAME, marks);
}
// ---- end of non-breaking marks ----

// The soft hyphens' ticks are drawn in a layer of their own on each sheet,
// beside the chapter's text and never inside it: nothing to save, select or
// put the caret in, and screen readers pass it by. Only the sheets in or near
// view get one, so a long book costs no more than the chapter on screen.
// Anything that can move the words (typing, the page's width, zoom, type
// size, a font arriving, a paragraph's
// alignment, poetry or flush) starts a new pass;
// scrolling only draws the sheets that come into view. One frame at a time.
let shyPass = 0;
let shyFrame = 0;
const shyDrawn = new WeakMap(); // sheet → the pass its ticks were drawn for
function queueSoftHyphenTicks(moved = true) {
  if (moved) shyPass += 1;
  if (shyFrame || (!nbspMarksEnabled && !document.querySelector('.shy-ticks'))) return;
  shyFrame = requestAnimationFrame(drawSoftHyphenTicks);
}
function softHyphenRect(node, i) {
  const range = document.createRange();
  range.setStart(node, i);
  range.setEnd(node, i + 1);
  for (const r of range.getClientRects()) if (r.height > 0) return r;
  range.collapse(true);
  const r = range.getBoundingClientRect();
  return r.height > 0 ? r : null;
}
function drawSoftHyphenTicks() {
  shyFrame = 0;
  const view = $('#paper-scroll').getBoundingClientRect();
  for (const sheet of $$('#chapters .chapter')) {
    const body = sheet.querySelector(':scope > .chapter-body');
    const box = sheet.getBoundingClientRect();
    const near = nbspMarksEnabled && body && !body.hidden && view.height > 0 &&
      box.bottom > view.top - view.height && box.top < view.bottom + view.height;
    let layer = sheet.querySelector(':scope > .shy-ticks');
    if (!near) {
      if (layer) layer.remove();
      shyDrawn.delete(sheet);
      continue;
    }
    if (shyDrawn.get(sheet) === shyPass) continue;
    shyDrawn.set(sheet, shyPass);
    const origin = { left: box.left + sheet.clientLeft, top: box.top + sheet.clientTop };
    const ems = new Map();
    const ticks = document.createDocumentFragment();
    const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walk.nextNode())) {
      if (!node.data.includes(SOFT_HYPHEN)) continue;
      const parent = node.parentElement;
      if (!ems.has(parent)) ems.set(parent, parseFloat(getComputedStyle(parent).fontSize) || 17);
      for (const i of softHyphenOffsets(node.data)) {
        const at = softHyphenTick(softHyphenRect(node, i), origin, ems.get(parent));
        if (!at) continue;
        const tick = document.createElement('span');
        tick.style.left = at.left + 'px';
        tick.style.top = at.top + 'px';
        tick.style.width = at.width + 'px';
        tick.style.height = at.height + 'px';
        ticks.appendChild(tick);
      }
    }
    if (!ticks.childNodes.length) { if (layer) layer.remove(); continue; }
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'shy-ticks';
      layer.setAttribute('aria-hidden', 'true');
      layer.contentEditable = 'false';
      sheet.appendChild(layer);
    }
    layer.replaceChildren(ticks);
  }
}
function paraRuns(pHtml, flip) {
  const holder = document.createElement('template'); // inert: nothing loads or runs
  holder.innerHTML = pHtml;
  healStrayNbsp(holder.content);
  const runs = [];
  const walk = (node, b, i, u, x) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.textContent) runs.push({ text: child.textContent, b, i, u, s: x });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.classList && child.classList.contains('ph-mark')) {
          runs.push({ mark: child.dataset.sid || '' });
          continue;
        }
        // a footnote: its words, no text of its own on the line
        if (child.classList && child.classList.contains('fn')) {
          runs.push({ fn: child.dataset.note || '', text: '' });
          continue;
        }
        const tag = child.tagName;
        // a line break inside a paragraph (a chapter file written elsewhere)
        // stays a break, not two words run together
        if (tag === 'BR') {
          const rest = document.createRange();
          rest.setStartAfter(child);
          rest.setEnd(holder.content, holder.content.childNodes.length);
          if (rest.toString()) runs.push({ br: true, text: '\n', b, i, u, s: x }); // (the empty line's own <br> isn't one)
          continue;
        }
        // the engine writes bold italic as <b style="font-style: italic"> (or
        // the other way round) when ⌘I meets ⌘B: the style counts like a tag
        const st = child.style || {};
        const fw = String(st.fontWeight || '').toLowerCase();
        const it = tag === 'I' || tag === 'EM' || String(st.fontStyle || '').toLowerCase() === 'italic';
        const bo = tag === 'B' || tag === 'STRONG' || fw === 'bold' || parseInt(fw, 10) >= 600;
        // underline and strikethrough: the engine's tags, or a style
        const deco = String(st.textDecoration || st.textDecorationLine || '').toLowerCase();
        const un = tag === 'U' || tag === 'INS' || deco.includes('underline');
        const st2 = tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || deco.includes('line-through');
        walk(child, b || bo, it ? (flip ? !i : true) : i, u || un, x || st2);
      }
    }
  };
  walk(holder.content, false, false, false, false);
  return runs;
}

/* ---------- DOCX ---------- */

// a Word export's footnotes, gathered as docxP meets them (buildDocxEntries)
let docxNotes = null;
function docxP(runs, opts = {}) {
  // the schema wants a paragraph's properties in this order
  const pPr = [];
  if (opts.style) pPr.push(`<w:pStyle w:val="${opts.style}"/>`);
  if (opts.keepNext) pPr.push('<w:keepNext/>');
  if (opts.pageBreak) pPr.push('<w:pageBreakBefore/>');
  if (opts.spaceBefore || opts.spaceAfter) {
    pPr.push(`<w:spacing${opts.spaceBefore ? ` w:before="${opts.spaceBefore}"` : ''}${opts.spaceAfter ? ` w:after="${opts.spaceAfter}"` : ''} w:line="${opts.line || 360}" w:lineRule="auto"/>`);
  }
  if (opts.poetry) pPr.push('<w:ind w:left="720" w:right="720"/>');
  else if (opts.indentLeft) pPr.push(`<w:ind w:left="${opts.indentLeft}"/>`);
  else if (opts.indent) pPr.push('<w:ind w:firstLine="480"/>');
  if (opts.align) pPr.push(`<w:jc w:val="${opts.align}"/>`);
  const rXml = runs.map((r) => {
    if (r.br) return '<w:r><w:br/></w:r>';
    if (r.fn !== undefined) {
      if (!docxNotes) return '';
      docxNotes.push(r.fn);
      return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${docxNotes.length}"/></w:r>`;
    }
    const it = opts.flip ? !r.i : r.i;
    const caps = r.caps !== undefined ? r.caps : opts.caps;
    const size = r.size || opts.size;
    // italic and bold are character styles (Emphasis, Strong), so an editor
    // or typesetter can find and restyle them all at once
    const rStyle = r.b && it ? 'StrongEmphasis' : r.b ? 'Strong' : it ? 'Emphasis' : '';
    // in the order the schema wants them (Word is strict about it)
    const rPr = (rStyle ? `<w:rStyle w:val="${rStyle}"/>` : '')
      + (caps === true ? '<w:caps/>' : caps === false ? '<w:caps w:val="0"/>' : '')
      + (r.s ? '<w:strike/>' : '')
      + (opts.tracking ? `<w:spacing w:val="${opts.tracking}"/>` : '')
      + (size ? `<w:sz w:val="${size}"/>` : '')
      + (r.u ? '<w:u w:val="single"/>' : '');
    return `<w:r>${rPr ? '<w:rPr>' + rPr + '</w:rPr>' : ''}<w:t xml:space="preserve">${escXml(r.text)}</w:t></w:r>`;
  }).join('');
  return `<w:p><w:pPr>${pPr.join('')}</w:pPr>${rXml}</w:p>`;
}

function buildDocxEntries(data) {
  docxNotes = [];
  try { return docxEntriesOf(data); } finally { docxNotes = null; }
}
// Word's footnotes part: the two separators Word expects, then the notes
function docxFootnotesXml(notes) {
  const sep = (id, type, tag) => `<w:footnote w:type="${type}" w:id="${id}"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:${tag}/></w:r></w:p></w:footnote>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${sep(-1, 'separator', 'separator')}${sep(0, 'continuationSeparator', 'continuationSeparator')}${notes.map((n, i) => `<w:footnote w:id="${i + 1}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> ${escXml(n)}</w:t></w:r></w:p></w:footnote>`).join('')}</w:footnotes>`;
}
function docxEntriesOf(data) {
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
  body.push(docxP([{ text: d.title }], { style: 'Title' }));
  if (d.subtitle) body.push(docxP([{ text: d.subtitle }], { style: 'Subtitle' }));
  body.push(docxP([{ text: d.author }], { style: 'Author' }));
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
    // the prose by paragraph style: Body Text (indented), Body Text No
    // Indent (a flush paragraph), Poetry, Scene Break; only a centered or
    // right-set line adds its alignment on top
    ch.paras.forEach((p, i) => {
      if (p.litrpg) {
        // one Word box: lines in a row share the LitRPG style's border and
        // shading, which Word draws as a single box; room above and below it
        const top = !(ch.paras[i - 1] && ch.paras[i - 1].litrpg);
        const end = !(ch.paras[i + 1] && ch.paras[i + 1].litrpg);
        body.push(docxP(paraRuns(p.html), { style: 'LitRPG', keepNext: !end, spaceBefore: top ? 240 : 0, spaceAfter: end ? 240 : 0, line: 240 }));
        return;
      }
      if (p.blank) body.push(docxP([], { style: 'BodyText' }));
      else if (p.sceneBreak) body.push(docxP([{ text: '***' }], { style: 'SceneBreak' }));
      else if (p.poetry) body.push(docxP(paraRuns(p.html), { style: 'Poetry', align: p.align === 'center' || p.align === 'right' ? p.align : '' }));
      else if (p.align === 'center' || p.align === 'right') body.push(docxP(paraRuns(p.html), { style: 'BodyTextNoIndent', align: p.align }));
      else body.push(docxP(paraRuns(p.html), { style: p.flush ? 'BodyTextNoIndent' : 'BodyText' }));
    });
  });
  if (!placed) contents();
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}
<w:sectPr>${(window.neo.paper || 'Letter') === 'A4' ? '<w:pgSz w:w="11906" w:h="16838"/>' : '<w:pgSz w:w="12240" w:h="15840"/>'}<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body></w:document>`;
  // the page's own typeface (on Linux, the bundled face it shows)
  const font = escXml(firstFamily(exportBodyFont()) || 'Georgia');
  const para = (id, name, pPr, next = 'BodyText', rPr = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="${next}"/><w:qFormat/>${pPr ? '<w:pPr>' + pPr + '</w:pPr>' : ''}${rPr ? '<w:rPr>' + rPr + '</w:rPr>' : ''}</w:style>`;
  const chr = (id, name, rPr) => `<w:style w:type="character" w:styleId="${id}"><w:name w:val="${name}"/><w:qFormat/><w:rPr>${rPr}</w:rPr></w:style>`;
  const headingStyle = (n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:uiPriority w:val="9"/><w:qFormat/>
<w:pPr><w:keepNext/><w:pageBreakBefore/><w:spacing w:before="1200"/><w:jc w:val="center"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:caps/><w:sz w:val="28"/></w:rPr></w:style>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${para('BodyText', 'Body Text', '<w:ind w:firstLine="480"/>')}
${para('BodyTextNoIndent', 'Body Text No Indent', '', 'BodyText')}
${para('Poetry', 'Poetry', '<w:ind w:left="720" w:right="720"/>')}
${para('LitRPG', 'LitRPG', LITRPG_DOCX_PPR, 'BodyText', LITRPG_DOCX_RPR)}
${para('SceneBreak', 'Scene Break', '<w:spacing w:before="240"/><w:jc w:val="center"/>', 'BodyText')}
${para('Title', 'Title', '<w:spacing w:before="3000"/><w:jc w:val="center"/>', 'Normal', '<w:b/><w:sz w:val="56"/>')}
${para('Subtitle', 'Subtitle', '<w:jc w:val="center"/>', 'Normal', '<w:i/><w:sz w:val="32"/>')}
${para('Author', 'Author', '<w:spacing w:before="800"/><w:jc w:val="center"/>')}
${[1, 2, 3].map(headingStyle).join('\n')}
${chr('Emphasis', 'Emphasis', '<w:i/>')}
${chr('Strong', 'Strong', '<w:b/>')}
${chr('StrongEmphasis', 'Strong Emphasis', '<w:b/><w:i/>')}
${para('FootnoteText', 'footnote text', '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>', 'FootnoteText', '<w:sz w:val="20"/>')}
${chr('FootnoteReference', 'footnote reference', '<w:vertAlign w:val="superscript"/>')}
</w:styles>`;
  const notes = docxNotes.length ? docxNotes : null;
  return [
    { path: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${notes ? `
<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>` : ''}
</Types>` },
    { path: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>` },
    { path: 'word/_rels/document.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${notes ? `
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>` : ''}
</Relationships>` },
    { path: 'word/document.xml', content: documentXml },
    { path: 'word/styles.xml', content: stylesXml },
    ...(notes ? [{ path: 'word/footnotes.xml', content: docxFootnotesXml(notes) }] : [])
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
  // footnotes: the number is a link a reading app opens as a pop-up note
  let fnN = fnBefore(d, ch);
  const notes = [];
  const xhtmlRuns = (p) => paraRuns(p.html).map((r) => {
    if (r.br) return '<br/>';
    if (p.litrpg && r.text) r = { ...r, text: litrpgSpaces(r.text) };
    if (r.fn !== undefined) {
      notes.push(r.fn);
      fnN += 1;
      return `<sup class="fnref"><a epub:type="noteref" href="#fn${fnN}" id="fnr${fnN}">${fnN}</a></sup>`;
    }
    let t = escXml(r.text);
    if (r.s) t = '<s>' + t + '</s>';
    if (r.u) t = '<u>' + t + '</u>';
    if (r.i) t = '<em>' + t + '</em>';
    if (r.b) t = '<strong>' + t + '</strong>';
    return t;
  }).join('');
  // a page's lines, each set on its own
  const lines = () => ch.paras.map((p, i) => {
    if (p.sceneBreak) return '<p class="brk">* * *</p>';
    if (p.litrpg) return `<p class="${litrpgClass(ch.paras, i)}">${xhtmlRuns(p) || '&#8203;'}</p>`;
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
    const paras = ch.paras.map((p, i) => {
      if (p.sceneBreak) { first = true; return '<p class="brk">* * *</p>'; }
      if (p.blank) return '<p class="blank">&#160;</p>';
      if (p.litrpg) return `<p class="${litrpgClass(ch.paras, i)}">${xhtmlRuns(p) || '&#8203;'}</p>`;
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
    inner = `<section epub:type="${EPUB_TYPES[kind] || ch.role || 'chapter'}">${ch.heading ? `<h1>${headingOwnCase(ch, escXml)}</h1>` : ''}${ch.byline ? `<p class="byline">${escXml(ch.byline)}</p>` : ''}
${paras}
</section>`;
  }
  if (notes.length) {
    const first = fnN - notes.length + 1;
    const asides = notes.map((n, i) => `<aside epub:type="footnote" id="fn${first + i}" class="footnote"><p><a href="#fnr${first + i}">${first + i}</a>&#8194;${escXml(n)}</p></aside>`).join('\n');
    const at = inner.lastIndexOf('</section>');
    inner = inner.slice(0, at) + `<div class="notes">\n${asides}\n</div>\n` + inner.slice(at);
  }
  // the language on the page too, so a reader hyphenates in the right one
  const lang = escXml(d.language || NeoI18n.getLocale());
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
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
  if (!start) throw new Error(t('There’s nothing in this book to export yet'));
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
  // LitRPG boxes bring their monospace face (only the styles they use)
  const monoFonts = await litrpgEpubFonts(d);

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
${monoFonts.map((f, i) => `<item id="font${i + 1}" href="fonts/${f.file}" media-type="font/ttf"/>`).join('\n')}${monoFonts.length ? '\n' : ''}${chItems}
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
    { path: 'OEBPS/style.css', content: `${monoFonts.map((f) => `@font-face { font-family: "${LITRPG_FONT}"; src: url("fonts/${f.file}"); font-weight: ${f.weight}; font-style: ${f.style}; }\n`).join('')}body { font-family: serif; line-height: 1.5; margin: 1em; }
sup.fnref { font-size: 0.7em; line-height: 0; vertical-align: super; }
sup.fnref a, .footnote a { text-decoration: none; }
.notes { margin-top: 2.5em; border-top: 1px solid #999; padding-top: 0.5em; font-size: 0.85em; }
.notes p { text-indent: 0; text-align: left; margin: 0 0 0.4em; }
h1 { text-align: center; font-weight: normal; letter-spacing: 0.2em; text-transform: uppercase; font-size: 1.2em; margin: 3em 0 2em; }
h1 .own { text-transform: none; letter-spacing: 0.03em; }
p { text-indent: 1.2em; margin: 0; text-align: justify; -webkit-hyphens: auto; -epub-hyphens: auto; hyphens: auto; widows: 2; orphans: 2; }
h1, p.brk { -webkit-hyphens: none; -epub-hyphens: none; hyphens: none; }
p.poetry, .dedication p, .epigraph p, .part p, .copyright p { text-align: left; -webkit-hyphens: manual; -epub-hyphens: manual; hyphens: manual; }
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
.opener .sub { text-align: center; text-indent: 0; margin-top: 0.6em; font-style: italic; }
.opener .byline { margin: 3em 0 0; }
nav#toc ol { list-style: none; padding-left: 0; }
nav#toc ol ol { padding-left: 1.5em; }
.titlepage { text-align: center; margin-top: 30%; }
.titlepage h2 { font-size: 2em; margin: 0; }
.titlepage .sub { text-align: center; text-indent: 0; font-style: italic; }
.titlepage .auth { text-align: center; text-indent: 0; margin-top: 4em; letter-spacing: 0.3em; text-transform: uppercase; }
.coverimg { text-align: center; margin: 0; padding: 0; }
.coverimg img { max-width: 100%; max-height: 100%; }
p.litrpg { font-family: "${LITRPG_FONT}", Menlo, Consolas, "Courier New", monospace; font-size: 0.8em; line-height: 1.45; text-indent: 0; text-align: left; -webkit-hyphens: none; -epub-hyphens: none; hyphens: none; white-space: pre-wrap; margin: 0 0.8em; padding: 0 0.6em; background-color: rgba(128, 128, 128, 0.14); border-left: 1px solid rgba(128, 128, 128, 0.6); border-right: 1px solid rgba(128, 128, 128, 0.6); }
p.litrpg.lt-top { margin-top: 1em; padding-top: 0.4em; border-top: 1px solid rgba(128, 128, 128, 0.6); }
p.litrpg.lt-end { margin-bottom: 1em; padding-bottom: 0.4em; border-bottom: 1px solid rgba(128, 128, 128, 0.6); }` },
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
    { path: 'OEBPS/' + coverName, content: coverContent, base64: true },
    ...monoFonts.map((f) => ({ path: 'OEBPS/fonts/' + f.file, content: f.base64, base64: true }))
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
        const p = parasFromHtml(await window.neo.readChapter(m.id, chId), { blanks: true });
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
      const paras = parasFromHtml(await window.neo.readChapter(m.id, chId), { blanks: kind !== 'part' });
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
        if (chTitle) heading = library.exportCustomChapterTitles ? chTitle : heading + ' ' + headingDash() + ' ' + chTitle;
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
// A book exported straight from the shelf: read into the export's view of
// "the open book" for the moment it takes, then put away again. Nothing on
// screen changes, and nothing is saved on its behalf meanwhile (saves and
// looks at the disk stand aside while shelfExport is set).
async function exportFromShelf(bookId, format) {
  if (book || shelfExport) return;
  const meta = await window.neo.readBookMeta(bookId);
  if (!meta || !Array.isArray(meta.chapterOrder)) return;
  const html = {};
  for (const chId of meta.chapterOrder) html[chId] = await window.neo.readChapter(bookId, chId);
  if (book) return; // a book was opened meanwhile
  const hadUuid = !!meta.uuid;
  const keep = { chapterHTML, savedHTML };
  shelfExport = true;
  book = meta;
  chapterHTML = html;
  savedHTML = { ...html };
  try {
    await doExport(format);
  } finally {
    if (book === meta) {
      book = null;
      chapterHTML = keep.chapterHTML;
      savedHTML = keep.savedHTML;
    }
    shelfExport = false;
  }
  // an EPUB's identity is made once and kept, as when exported from inside
  if (!hadUuid && meta.uuid) await writeBookMeta(bookId, meta).catch(() => {});
}

async function doExport(format, chId = null) {
  if (!book) { toast(t('Open a book first')); return; }
  if (format === 'paperback') { await printPaperback(); return; }
  if (format === 'manuscript') { await exportManuscript(); return; }
  // a script leaves as a PDF set the way scripts print, or as Fountain
  if (isScript()) { await spExport(['pdf', 'fdx'].includes(format) ? format : 'fountain'); return; }
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
  // Gmail opens in the browser, which is no help to a writer with no Gmail
  // account (#386): every computer is offered its own mail program too
  const mac = navigator.platform.toLowerCase().includes('mac');
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
          ${mac ? `<button class="fr-choice" data-m="mail">
            <strong>Apple Mail</strong>
            <span>${t('Fully automatic — the PDF is attached and addressed. Just hit send.')}</span>
          </button>` : ''}
          <button class="fr-choice" data-m="mailto">
            <strong>${t('Your mail program')}</strong>
            <span>${t('Opens a new message in the program your computer uses for email. NEO shows you the PDF to attach.')}</span>
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
  const subject = t('NEO draft — {title} — {n} words — {date}', { title: shownTitle(book.title), n: total, date: fmtDate(new Date()) });
  const hash = await manuscriptHash();
  const body = t('Draft snapshot of “{title}” — {n} words.', { title: shownTitle(book.title), n: total }) + '\n'
    + t('Sent from NEO on {date}.', { date: new Date().toLocaleString(NeoI18n.getLocale()) }) + '\n\n'
    + t('SHA-256 fingerprint of the manuscript text:') + `\n${hash}\n\n`
    + (library.emailMethod === 'gmail' || library.emailMethod === 'mailto'
      ? t('The PDF snapshot is in the Finder window NEO just opened — drag it into this email before sending.')
      : t('PDF snapshot attached.'));
  toast(t('Preparing your draft…'));
  const script = isScript();
  const snapshot = script ? null : bookExportData();
  const res = await window.neo.emailDraft({
    to: library.emailAddress,
    subject,
    body,
    // the email snapshot is a provenance record (a script's, as it prints)
    html: script ? await spPdfHtml() : buildHtml(snapshot, { stamp: true, fonts: await exportFontFaces(snapshot) }),
    print: script ? 'screenplay' : undefined,
    defaultName: safeName(book.title),
    method: library.emailMethod
  });
  if (res.method === 'gmail') toast(t('Gmail compose opened — drag in the PDF NEO revealed, then send'), 8000);
  else if (res.method === 'mailto') toast(t('Your mail program opened — attach the PDF NEO revealed, then send'), 8000);
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

// WHAT'S NEW — Help → What's New in NEO…, and once after an update.
// The notes are whats-new.json (newest release first, in English), shipped
// with NEO so they're there offline. A writer who updates sees the notes
// for the releases since the one they last saw, once, at launch: before a
// word is typed, never in the middle of one. A fresh install skips them
// (the welcome is enough), and so does Pocket, which has its own versions,
// and so does NEO run from its folder (npm start, npm run try, the tests).
const WHATS_NEW_SEEN = 'neo.whatsNewSeen';
async function whatsNewNotes() {
  try { return await (await fetch(new URL('whats-new.json', location.href))).json(); } catch { return []; }
}
const versionParts = (v) => String(v || '0').split('.').map((n) => parseInt(n, 10) || 0);
function versionNewer(a, b) {
  const x = versionParts(a); const y = versionParts(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}
async function whatsNewAtLaunch(existing) {
  if (IS_POCKET || !window.neo.appVersion || !window.neo.isPackaged || !window.neo.isPackaged()) return;
  const now = await window.neo.appVersion();
  let seen = null;
  try { seen = localStorage.getItem(WHATS_NEW_SEEN); } catch { /* storage off: show nothing */ return; }
  try { localStorage.setItem(WHATS_NEW_SEEN, now); } catch { /* ignore */ }
  if (!existing || (seen && !versionNewer(now, seen))) return;
  const notes = (await whatsNewNotes()).filter((r) => !versionNewer(r.version, now) && (!seen || versionNewer(r.version, seen)));
  // the first time this runs, after the update that brought it: just this release
  if (notes.length) showWhatsNew(seen ? notes : notes.slice(0, 1));
}
async function showWhatsNew(notes) {
  if (!notes) notes = (await whatsNewNotes()).slice(0, 3);
  if (!notes.length || document.querySelector('.whats-new')) return;
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  const inline = (s) => escHtml(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  bd.innerHTML = `
    <div class="modal whats-new">
      <h2>${t('What’s New in NEO')}</h2>
      <div class="wn-list">${notes.map((r) => `
        <h3>NEO ${escHtml(r.version)}</h3>
        <ul>${(r.items || []).map((it) => `<li>${inline(it)}</li>`).join('')}</ul>`).join('')}
      </div>
      <div style="margin-top:16px;text-align:center">
        <button class="m-ok btn-gold">${t('Back to writing')}</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.querySelector('.m-ok').onclick = close;
  bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  bd.addEventListener('mousedown', (e) => { if (e.target === bd) close(); });
  bd.querySelector('.m-ok').focus();
}

// Text size and the reset travel with page zoom; the menu item and the
// keyboard fallback share this so the two cannot drift.
async function setEditorFontSize(value) {
  // ⌘+ and ⌘− on the shelf make the covers larger and smaller
  if (shelfShowing()) { stepShelfZoom(value); return; }
  // …on the outline's cards, the cards
  if (boardShowing()) { stepCardZoom(value); return; }
  // a script's type is the page's: larger and smaller zoom the page
  if (book && isScript()) {
    setPageZoom(value === 0 ? 1 : tenth(activePageZoom() + (value > 0 ? 0.1 : -0.1)));
    return;
  }
  const cur = library.editorFontSize || 17;
  library.editorFontSize = value === 0 ? 17 : Math.min(EDITOR_SIZE_MAX, Math.max(EDITOR_SIZE_MIN, cur + value));
  if (value === 0) rememberZoom(pageZoomKey(), 1); // ⌘0 resets this mode's pinch zoom too
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
  const WINDOWS = ['stats', 'about', 'emailSettings', 'coverArt', 'reshelve', 'checkUpdate', 'options'];
  if (WINDOWS.includes(msg.type) && document.querySelector('.modal-backdrop:not([hidden])')) {
    if (msg.type === 'checkUpdate' && updateDialog) updateDialog.focus();
    return;
  }
  if (msg.type === 'help') showHelp();
  if (msg.type === 'about') showAbout();
  if (msg.type === 'whatsNew') showWhatsNew();
  if (msg.type === 'checkUpdate') checkForUpdate();
  if (msg.type === 'update') updateMessage(msg);
  if (msg.type === 'export') doExport(msg.format);
  if (msg.type === 'scriptElement' && book && isScript()) spSetElement(msg.value);
  if (msg.type === 'scriptStyle') spToggleStyle(msg.value);
  if (msg.type === 'scriptPageBreak') spTogglePageBreak();
  if (msg.type === 'options') openOptions();
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
  if (msg.type === 'snapshot' && book && !$('#editor-view').hidden) snapshotNow();
  if (msg.type === 'emailSettings') emailSettings();
  if (msg.type === 'find') openSearch();
  if (msg.type === 'spellcheck') toggleSpellcheck();
  if (msg.type === 'spellLanguage') changeSpellLanguage(msg.value);
  if (msg.type === 'reshelve') reshelveBook();
  if (msg.type === 'typewriter') toggleTypewriter();
  if (msg.type === 'nbspMarks') toggleNbspMarks();
  if (msg.type === 'pagedView') togglePaged();
  if (msg.type === 'pageWidth') setPageWidth(msg.value);
  if (msg.type === 'twoPageView') toggleTwoPage();
  if (msg.type === 'pressHold') pressHoldOn = !!msg.value;
  if (msg.type === 'focus') setFocus(msg.value);
  if (msg.type === 'focusCycle') cycleFocus();
  if (msg.type === 'import') importBooks();
  if (msg.type === 'importChapters') importChapters();
  if (msg.type === 'stats') openStats();
  if (msg.type === 'chapterStep') gotoChapter(msg.value);
  if (msg.type === 'writingStyle') {
    library.writingStyle = msg.value;
    await writeLibrary(library);
    if (window.neo.writingStyleState) window.neo.writingStyleState(library.writingStyle);
  }
  if (msg.type === 'coverArt') openCoverArt();
  // a script's lines sit where they print: no alignment, poetry or flush
  if (msg.type === 'align' && !(book && isScript())) {
    applyAlign(msg.value);
  }
  if (msg.type === 'alignBook') alignBookProse(msg.value);
  if (msg.type === 'poetry' && !(book && isScript())) togglePoetry();
  if (msg.type === 'flush' && !(book && isScript())) toggleFlush();
  if (msg.type === 'uiLanguage') {
    // save every open page, then reload the window in the new language
    flushAllSaves();
    try { if (book && !$('#editor-view').hidden) sessionStorage.setItem('neo-reopen', book.id); } catch { /* a nicety */ }
    setTimeout(() => window.neo.reloadForLanguage(), 400);
  }
  if (msg.type === 'uiZoomStep') {
    const next = nextZoomStep(library.uiZoom, msg.value);
    if (next !== snapZoom(library.uiZoom)) {
      library.uiZoom = next;
      await writeLibrary(library);
      applyFonts();
    }
  }
  if (msg.type === 'uiBright') {
    // the tab you're on decides which of the two settings this is
    if (brightAside()) library.uiBrightAside = !document.body.classList.contains('bright');
    else library.uiBright = !document.body.classList.contains('bright');
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

// (set up here, at the end of the file that defines queueSoftHyphenTicks:
// an observer can fire before a later file has loaded)
// the soft hyphens' ticks (non-breaking marks) follow anything that moves the words
new ResizeObserver(() => queueSoftHyphenTicks()).observe($('#chapters'));
$('#paper-scroll').addEventListener('scroll', () => queueSoftHyphenTicks(false), { passive: true });
window.addEventListener('resize', () => queueSoftHyphenTicks());
if (document.fonts) document.fonts.addEventListener('loadingdone', () => queueSoftHyphenTicks());
// a paragraph's alignment, poetry or flush, and the opening paragraph's
// marks, are set on it as attributes: the words move, but nothing is typed
// and no sheet changes size
new MutationObserver((records) => {
  if (records.some((r) => r.target.closest('.chapter-body, .chapter-head') || r.target.matches('.chapter'))) queueSoftHyphenTicks();
}).observe($('#chapters'), { subtree: true, attributes: true, attributeFilter: ['style', 'class', 'dir', 'data-first', 'data-speech'] });
