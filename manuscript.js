'use strict';

// STANDARD MANUSCRIPT FORMAT: a book written out the way agents
// and editors ask for it (William Shunn's "proper manuscript format",
// novel version). A title page with the writer's contact details and a
// rounded word count; then the story double-spaced in 12-point Times New
// Roman or Courier, one-inch margins, every paragraph indented half an
// inch, each chapter on a new page a third of the way down, "#" for scene
// breaks, and "Surname / TITLE / page" at the top right of every page but
// the title page. A single story with no chapters gets the short-story
// layout: the title halfway down page 1 and the text starting under it.
//
// Plain JavaScript that also runs in Node (the tests). It knows nothing
// of NEO: the window hands it a model and gets back a .docx's parts (for
// export:save) or one HTML page (laid out by Paged.js in main.js and
// printed as the PDF).
//
//   model = {
//     title, byline, headerName, headerTitle,
//     contact: { name, lines: [address lines, phone, email] },
//     wordsText,            "about 90,000 words", already in the writer's language
//     byText,               "by Pen Name"
//     endText,              "END", or '' for none
//     font: 'times' | 'courier', paper: 'Letter' | 'A4', lang: 'en-US',
//     short: true when it's one story with no chapters,
//     sections: [{ kind: 'chapter' | 'part' | 'epigraph', heading, partTitle,
//                  paras: [{ sceneBreak, poetry, flush, align,
//                            runs: [{ text, b, i, u, s, br } | { fn: note }] }] }]
//   }

(function (root) {
  const FONTS = {
    times: { docx: 'Times New Roman', css: '"Times New Roman", Tinos, "Liberation Serif", Times, serif' },
    courier: { docx: 'Courier New', css: '"Courier Prime", "Courier New", Cousine, "Liberation Mono", Courier, monospace' }
  };
  const PAPER = { Letter: { w: 12240, h: 15840, css: '8.5in 11in', in: [8.5, 11] }, A4: { w: 11906, h: 16838, css: '210mm 297mm', in: [8.2677, 11.6929] } };
  const fontOf = (m) => FONTS[m.font] || FONTS.times;
  const paperOf = (m) => PAPER[m.paper] || PAPER.Letter;

  // A word count as a manuscript gives it: to the nearest thousand from ten
  // thousand words up (a novel), to the nearest hundred below that (a short
  // piece), never rounded to nothing
  function roundWords(n) {
    n = Math.max(0, Math.round(Number(n) || 0));
    if (n >= 10000) return Math.round(n / 1000) * 1000;
    if (n >= 100) return Math.max(100, Math.round(n / 100) * 100);
    return n;
  }

  // The surname for the header: the last word of the name, past a suffix
  // ("Jr.", "III") and anything in brackets
  const SUFFIX = /^(jr|sr|ii|iii|iv|v|phd|md|esq)\.?$/i;
  function surnameOf(name) {
    const words = String(name || '').replace(/\([^)]*\)/g, ' ').replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
    while (words.length > 1 && SUFFIX.test(words[words.length - 1])) words.pop();
    return words.length ? words[words.length - 1] : '';
  }

  // The header's words, before the page number: "Shunn / TITLE / "
  function headerText(m) {
    return [m.headerName, m.headerTitle].map((x) => String(x || '').trim()).filter(Boolean).join(' / ') + ' / ';
  }

  /* ---------------- .docx ---------------- */

  const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // characters XML 1.0 can't carry at all (controls other than tab and
    // the line ends, and the two non-characters)
    .split('').filter((c) => { const n = c.charCodeAt(0); return (n >= 32 || n === 9 || n === 10 || n === 13) && n !== 0xfffe && n !== 0xffff; }).join('');
  const TWIP = 1440; // to the inch
  const DOUBLE = 480; // 240ths of a line

  // the footnotes met while the story is set (docxEntries), numbered in order
  let notes = null;
  function runsXml(runs) {
    return (runs || []).map((r) => {
      if (r.br) return '<w:r><w:br/></w:r>';
      if (r.fn !== undefined) {
        if (!notes) return '';
        notes.push(r.fn);
        return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${notes.length}"/></w:r>`;
      }
      if (r.tab) return '<w:r><w:tab/></w:r>';
      const style = r.b && r.i ? 'StrongEmphasis' : r.b ? 'Strong' : r.i ? 'Emphasis' : '';
      const rPr = (style ? `<w:rStyle w:val="${style}"/>` : '') + (r.s ? '<w:strike/>' : '') + (r.u ? '<w:u w:val="single"/>' : '');
      return `<w:r>${rPr ? '<w:rPr>' + rPr + '</w:rPr>' : ''}<w:t xml:space="preserve">${escXml(r.text)}</w:t></w:r>`;
    }).join('');
  }
  // one paragraph; the schema wants its properties in this order
  function p(runs, o = {}) {
    const pPr = [];
    if (o.style) pPr.push(`<w:pStyle w:val="${o.style}"/>`);
    if (o.keepNext) pPr.push('<w:keepNext/>');
    if (o.pageBreak) pPr.push('<w:pageBreakBefore/>');
    if (o.tabs) pPr.push(`<w:tabs>${o.tabs}</w:tabs>`);
    if (o.before != null || o.after != null || o.line != null) {
      pPr.push(`<w:spacing${o.before != null ? ` w:before="${o.before}"` : ''}${o.after != null ? ` w:after="${o.after}"` : ''}${o.line != null ? ` w:line="${o.line}" w:lineRule="auto"` : ''}/>`);
    }
    if (o.ind) pPr.push(o.ind);
    if (o.align) pPr.push(`<w:jc w:val="${o.align}"/>`);
    if (o.sectPr) pPr.push(o.sectPr);
    return `<w:p>${pPr.length ? '<w:pPr>' + pPr.join('') + '</w:pPr>' : ''}${runsXml(runs)}</w:p>`;
  }
  const plainRun = (text) => [{ text }];

  // The page a section is set on: one-inch margins, the header half an
  // inch from the top
  function sectPr(m, { header = null, firstHeader = null, restart = false, titlePg = false } = {}) {
    const pp = paperOf(m);
    return '<w:sectPr>'
      + (header ? `<w:headerReference w:type="default" r:id="${header}"/>` : '')
      + (firstHeader ? `<w:headerReference w:type="first" r:id="${firstHeader}"/>` : '')
      + '<w:type w:val="nextPage"/>'
      + `<w:pgSz w:w="${pp.w}" w:h="${pp.h}"/>`
      + `<w:pgMar w:top="${TWIP}" w:right="${TWIP}" w:bottom="${TWIP}" w:left="${TWIP}" w:header="${TWIP / 2}" w:footer="${TWIP / 2}" w:gutter="0"/>`
      + (restart ? '<w:pgNumType w:start="1"/>' : '')
      + (titlePg ? '<w:titlePg/>' : '')
      + '</w:sectPr>';
  }

  // The title page's lines: the contact block single-spaced at the top
  // left with the word count on its first line at the right, then the
  // title and byline about halfway down
  function titleBlock(m, { sect = '' } = {}) {
    const pp = paperOf(m);
    const right = pp.w - 2 * TWIP;
    const lines = [m.contact && m.contact.name, ...((m.contact && m.contact.lines) || [])].map((x) => String(x || '').trim()).filter(Boolean);
    if (!lines.length) lines.push('');
    const out = lines.map((line, i) => (i === 0
      ? p([{ text: line }, { tab: true }, { text: m.wordsText || '' }], { style: 'Contact', tabs: `<w:tab w:val="right" w:pos="${right}"/>` })
      : p(plainRun(line), { style: 'Contact' })));
    // about halfway down the page: what's left of the top half after the contact lines
    const before = Math.max(TWIP, Math.round((pp.h / 2 - TWIP) - lines.length * 240 - 2 * DOUBLE));
    out.push(p(plainRun(m.title || ''), { style: 'ManuscriptTitle', before }));
    if (m.byText) out.push(p(plainRun(m.byText), { style: 'Byline', sectPr: sect }));
    else if (sect) out.push(p([], { sectPr: sect }));
    return out;
  }

  // The story's paragraphs. The first block of the story's own pages
  // doesn't break (its section, or the title above it, already did).
  function storyBlocks(m) {
    const out = [];
    let first = true;
    const third = Math.round(paperOf(m).h / 3 - TWIP);
    for (const sec of m.sections || []) {
      const brk = !first || !!sec.pageBreak;
      if (sec.kind === 'part') {
        out.push(p(plainRun(sec.heading || ''), { style: 'PartHeading', pageBreak: brk, before: third }));
        if (sec.partTitle) out.push(p(plainRun(sec.partTitle), { style: 'PartHeading' }));
        for (const x of sec.paras || []) if (!x.sceneBreak) out.push(p(x.runs, { style: 'Centered' }));
      } else if (sec.kind === 'epigraph') {
        (sec.paras || []).forEach((x, i) => { if (!x.sceneBreak) out.push(p(x.runs, { style: 'Centered', pageBreak: brk && i === 0, before: i === 0 ? third : null })); });
      } else {
        if (sec.heading) out.push(p(plainRun(sec.heading), { style: 'ChapterHeading', pageBreak: brk, before: third }));
        // an untitled chapter's first line starts its page (no empty line above it)
        let lead = !sec.heading && brk;
        for (const x of sec.paras || []) {
          const pageBreak = lead;
          lead = false;
          if (x.sceneBreak) out.push(p(plainRun('#'), { style: 'SceneBreak', pageBreak }));
          else if (x.poetry) out.push(p(x.runs, { style: 'Poetry', pageBreak, align: x.align === 'center' || x.align === 'right' ? x.align : '' }));
          else if (x.align === 'center' || x.align === 'right') out.push(p(x.runs, { style: 'Centered', pageBreak, align: x.align === 'right' ? 'right' : '' }));
          else out.push(p(x.runs, { style: x.flush ? 'ManuscriptNoIndent' : 'Manuscript', pageBreak }));
        }
        if (lead) out.push(p([], { pageBreak: true }));
      }
      first = false;
    }
    if (m.endText) out.push(p(plainRun(m.endText), { style: 'End' }));
    return out;
  }

  function headerXml(m, empty) {
    const fld = (type, extra = '') => `<w:r><w:fldChar w:fldCharType="${type}"/>${extra}</w:r>`;
    const body = empty ? '<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr></w:p>'
      : '<w:p><w:pPr><w:pStyle w:val="Header"/><w:jc w:val="right"/></w:pPr>'
        + `<w:r><w:t xml:space="preserve">${escXml(headerText(m))}</w:t></w:r>`
        + fld('begin') + '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' + fld('separate') + '<w:r><w:t>1</w:t></w:r>' + fld('end')
        + '</w:p>';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${body}</w:hdr>`;
  }

  function stylesXml(m) {
    const f = escXml(fontOf(m).docx);
    const lang = escXml(m.lang || 'en-US');
    const para = (id, name, pPr, rPr = '', next = 'Manuscript') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="${next}"/><w:qFormat/>${pPr ? '<w:pPr>' + pPr + '</w:pPr>' : ''}${rPr ? '<w:rPr>' + rPr + '</w:rPr>' : ''}</w:style>`;
    const chr = (id, name, rPr) => `<w:style w:type="character" w:styleId="${id}"><w:name w:val="${name}"/><w:qFormat/><w:rPr>${rPr}</w:rPr></w:style>`;
    const single = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="${lang}"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:widowControl w:val="0"/><w:spacing w:before="0" w:after="0" w:line="${DOUBLE}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${para('Manuscript', 'Manuscript Text', `<w:ind w:firstLine="${TWIP / 2}"/>`)}
${para('ManuscriptNoIndent', 'Manuscript Text No Indent', '')}
${para('Poetry', 'Poetry', `<w:ind w:left="${TWIP / 2}" w:right="${TWIP / 2}"/>`)}
${para('Centered', 'Centered', '<w:jc w:val="center"/>')}
${para('SceneBreak', 'Scene Break', '<w:jc w:val="center"/>')}
${para('ChapterHeading', 'Chapter Heading', `<w:keepNext/><w:spacing w:after="${DOUBLE}"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/>`)}
${para('PartHeading', 'Part Heading', '<w:keepNext/><w:jc w:val="center"/><w:outlineLvl w:val="0"/>')}
${para('End', 'End', `<w:spacing w:before="${DOUBLE}"/><w:jc w:val="center"/>`)}
${para('Contact', 'Contact Details', single, '', 'Contact')}
${para('ManuscriptTitle', 'Manuscript Title', '<w:keepNext/><w:jc w:val="center"/>', '', 'Byline')}
${para('Byline', 'Byline', '<w:jc w:val="center"/>')}
${para('Header', 'Header', single, '', 'Header')}
${chr('Emphasis', 'Emphasis', '<w:i/>')}
${chr('Strong', 'Strong', '<w:b/>')}
${chr('StrongEmphasis', 'Strong Emphasis', '<w:b/><w:i/>')}
${para('FootnoteText', 'footnote text', single, '', 'FootnoteText')}
${chr('FootnoteReference', 'footnote reference', '<w:vertAlign w:val="superscript"/>')}
</w:styles>`;
  }

  // Word's own current mode (without this it opens in Compatibility Mode)
  const SETTINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

  // The .docx's parts, for export:save's zip. A novel: the title page is
  // its own section with no header, the story the next one, numbered from
  // 1 under the header. A short story: one section, the header from page 2.
  // Word's footnotes part: the two separators Word expects, then the notes
  function footnotesXml(list) {
    const sep = (id, type) => `<w:footnote w:type="${type}" w:id="${id}"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:${type}/></w:r></w:p></w:footnote>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${sep(-1, 'separator')}${sep(0, 'continuationSeparator')}${list.map((n, i) => `<w:footnote w:id="${i + 1}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> ${escXml(n)}</w:t></w:r></w:p></w:footnote>`).join('')}</w:footnotes>`;
  }

  function docxEntries(m) {
    notes = [];
    try { return docxParts(m); } finally { notes = null; }
  }
  function docxParts(m) {
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    let body;
    if (m.short) {
      const story = storyBlocks(m);
      body = [...titleBlock(m), p([], {}), ...story].join('') + sectPr(m, { header: 'rId2', firstHeader: 'rId3', titlePg: true });
    } else {
      // the title page's section ends on its last paragraph
      body = [...titleBlock(m, { sect: sectPr(m) }), ...storyBlocks(m)].join('') + sectPr(m, { header: 'rId2', restart: true });
    }
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${body}</w:body></w:document>`;
    const headers = [{ id: 'rId2', file: 'header1.xml', empty: false }, ...(m.short ? [{ id: 'rId3', file: 'header2.xml', empty: true }] : [])];
    const noted = notes.length ? notes.slice() : null;
    return [
      { path: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
${headers.map((h) => `<Override PartName="/word/${h.file}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`).join('\n')}${noted ? `
<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>` : ''}
</Types>` },
      { path: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>` },
      { path: 'word/_rels/document.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
${headers.map((h) => `<Relationship Id="${h.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="${h.file}"/>`).join('\n')}${noted ? `
<Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>` : ''}
</Relationships>` },
      { path: 'word/document.xml', content: documentXml },
      { path: 'word/styles.xml', content: stylesXml(m) },
      { path: 'word/settings.xml', content: SETTINGS },
      ...headers.map((h) => ({ path: 'word/' + h.file, content: headerXml(m, h.empty) })),
      ...(noted ? [{ path: 'word/footnotes.xml', content: footnotesXml(noted) }] : [])
    ];
  }

  /* ---------------- HTML for the PDF ---------------- */

  const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // a CSS string (a "<" escaped too, so nothing can close the style block)
  const cssString = (s) => '"' + String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/</g, '\\3c ').replace(/[\n\r]+/g, ' ') + '"';
  function runsHtml(runs) {
    return (runs || []).map((r) => {
      if (r.br) return '<br>';
      // a footnote: Paged.js sets it at the foot of its page
      if (r.fn !== undefined) return `<span class="footnote">${escHtml(r.fn)}</span>`;
      let t = escHtml(r.text);
      if (r.s) t = '<s>' + t + '</s>';
      if (r.u) t = '<u>' + t + '</u>';
      if (r.i) t = '<i>' + t + '</i>';
      if (r.b) t = '<b>' + t + '</b>';
      return t;
    }).join('');
  }

  // One page of HTML for Paged.js: the header in the page's top-right
  // margin box. main.js's renderPaged numbers pages from the one holding
  // .pg1 (the story's first page; for a short story, the title page).
  // fontFaces: @font-face rules the window embeds (Courier Prime).
  function html(m, { fontFaces = '' } = {}) {
    const pp = paperOf(m);
    const lines = [m.contact && m.contact.name, ...((m.contact && m.contact.lines) || [])].map((x) => String(x || '').trim()).filter(Boolean);
    const contact = `<div class="contact"><div class="row1"><span>${escHtml(lines[0] || '')}</span><span>${escHtml(m.wordsText || '')}</span></div>${lines.slice(1).map((l) => `<div>${escHtml(l)}</div>`).join('')}</div>`;
    const titleTop = `calc(${pp.in[1] / 2 - 1}in - ${lines.length * 1.2}em - 4em)`;
    const story = [];
    let first = true;
    for (const sec of m.sections || []) {
      const cls = [first && !m.short ? 'pg1' : '', !first || sec.pageBreak ? 'newpage' : ''].filter(Boolean).join(' ');
      if (sec.kind === 'part') {
        story.push(`<section class="part ${cls}"><h2>${escHtml(sec.heading || '')}${sec.partTitle ? `<br>${escHtml(sec.partTitle)}` : ''}</h2>${(sec.paras || []).filter((x) => !x.sceneBreak).map((x) => `<p class="c">${runsHtml(x.runs)}</p>`).join('')}</section>`);
      } else if (sec.kind === 'epigraph') {
        story.push(`<section class="epigraph ${cls}">${(sec.paras || []).filter((x) => !x.sceneBreak).map((x) => `<p class="c">${runsHtml(x.runs)}</p>`).join('')}</section>`);
      } else {
        const paras = (sec.paras || []).map((x) => {
          if (x.sceneBreak) return '<p class="brk">#</p>';
          const c = x.poetry ? 'poetry' : x.align === 'center' ? 'c' : x.align === 'right' ? 'r' : x.flush ? 'flush' : '';
          return `<p${c ? ` class="${c}"` : ''}>${runsHtml(x.runs)}</p>`;
        }).join('\n');
        story.push(`<section class="chapter ${cls}${sec.heading ? '' : ' plain'}">${sec.heading ? `<h2>${escHtml(sec.heading)}</h2>` : ''}${paras}</section>`);
      }
      first = false;
    }
    if (m.endText) story.push(`<p class="end">${escHtml(m.endText)}</p>`);
    const font = fontOf(m).css;
    return `<!DOCTYPE html><html lang="${escHtml(m.lang || 'en')}"><head><meta charset="utf-8"><title>${escHtml(m.title || '')}</title><style>
${fontFaces}
@page { size: ${pp.css}; margin: 1in;
  @top-right { content: ${cssString(headerText(m))} counter(page); font-family: ${font}; font-size: 12pt; vertical-align: middle; }
}
@page titlepage { @top-right { content: none; } }
${m.short ? '@page :first { @top-right { content: none; } }' : ''}
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { font-family: ${font}; font-size: 12pt; line-height: 2; }
.titlepage { ${m.short ? '' : 'page: titlepage; break-after: page;'} }
.contact { line-height: 1.2; }
.contact .row1 { display: flex; justify-content: space-between; gap: 2em; }
.mtitle { margin: ${titleTop} 0 0; text-align: center; }
.byline { margin: 0; text-align: center; }
${m.short ? '.titlepage + .chapter, .titlepage + section { margin-top: 2em; }' : ''}
p { margin: 0; text-indent: 0.5in; orphans: 1; widows: 1; }
p.flush, p.c, p.r, p.brk, p.end, p.poetry { text-indent: 0; }
p.c, p.brk, p.end { text-align: center; }
p.r { text-align: right; }
p.poetry { margin: 0 0.5in; }
p.end { margin-top: 2em; }
section.newpage { break-before: page; }
h2 { font: inherit; font-weight: normal; text-align: center; margin: calc(${pp.in[1] / 3 - 1}in) 0 2em; break-after: avoid; }
.part h2 { margin-bottom: 0; }
.epigraph { padding-top: calc(${pp.in[1] / 3 - 1}in); }
b { font-weight: bold; }
.footnote { float: footnote; font-size: 10pt; line-height: 1.2; text-indent: 0; text-align: left; font-style: normal; font-weight: normal; }
.footnote::footnote-marker { content: counter(footnote) ". "; }
::footnote-call { font-size: 0.7em; vertical-align: super; line-height: 0; }
@page { @footnote { border-top: 0.5pt solid #000; padding-top: 0.5em; margin-top: 1em; } }
</style></head><body>
<section class="titlepage${m.short ? ' pg1' : ''}">${contact}<p class="mtitle c">${escHtml(m.title || '')}</p>${m.byText ? `<p class="byline c">${escHtml(m.byText)}</p>` : ''}</section>
${story.join('\n')}
</body></html>`;
  }

  const api = { roundWords, surnameOf, headerText, docxEntries, html, FONTS, PAPER };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoManuscript = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
