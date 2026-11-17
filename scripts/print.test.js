'use strict';

// Paperback for KDP: the rules main.js holds (KDP's margins and spine, the
// hyphenation, the exact page size). The layout itself runs in Electron.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const localRequire = createRequire(path.join(root, 'main.js'));
const electron = {
  app: { commandLine: { appendSwitch() {} }, getPath: () => os.tmpdir(), getLocale: () => 'en', getLocaleCountryCode: () => 'US', requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {} },
  ipcMain: { on() {}, handle() {} },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
  dialog: {}, utilityProcess: { fork: () => ({ on() {}, postMessage() {} }) }, screen: {}
};
const ctx = vm.createContext({ require: (n) => n === 'electron' ? electron : localRequire(n), __dirname: root, process: { platform: process.platform, on() {} }, console, Buffer });
vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), ctx, { filename: path.join(root, 'main.js') });
const SHY = '­';

describe('paperback', () => {
  test('the inside margin follows KDP’s page-count bands, a quarter inch over the minimum', () => {
    assert.deepEqual([24, 150, 151, 300, 301, 500, 501, 700, 701, 828].map(ctx.kdpGutter),
      [0.625, 0.625, 0.75, 0.75, 0.875, 0.875, 1, 1, 1.125, 1.125]);
  });

  test('soft hyphens in prose only, three letters either side, no names, never the last word', () => {
    const html = '<h2>Extraordinary</h2><p class="hy first">The extraordinary photographs of Washington were remembered</p><p>unconsidered</p>';
    const out = ctx.hyphenateHtml(html, 'en-US');
    assert.ok(out.startsWith('<h2>Extraordinary</h2>'));
    assert.ok(out.endsWith('<p>unconsidered</p>'));
    const p = out.match(/<p class="hy first">(.*?)<\/p>/)[1];
    assert.ok(p.includes('ex' + 'tra' + SHY + 'or' + SHY + 'di' + SHY + 'nary') || p.includes('extra' + SHY), p);
    assert.ok(p.includes('Washington'), 'a name stays whole');
    assert.ok(p.endsWith('remembered'), 'the last word stays whole');
    for (const w of p.split(/\s+/)) {
      const parts = w.split(SHY);
      if (parts.length > 1) { assert.ok(parts[0].length >= 3, w); assert.ok(parts[parts.length - 1].length >= 3, w); }
    }
  });

  test('tags and entities inside a paragraph are left alone', () => {
    const out = ctx.hyphenateHtml('<p class="hy"><i>understanding</i> &amp; extraordinarily careful</p>', 'en');
    assert.match(out, /^<p class="hy"><i>[^<]*­[^<]*<\/i> &amp; /);
  });

  test('German nouns hyphenate, though they all have a capital', () => {
    const out = ctx.hyphenateHtml('<p class="hy">Die Donaudampfschifffahrt fuhr weiter</p>', 'de');
    assert.ok(out.includes(SHY), out);
  });

  test('a language without patterns is left as it is', () => {
    const html = '<p class="hy">something extraordinary</p>';
    assert.equal(ctx.hyphenateHtml(html, 'ja'), html);
  });

  test('the page box is written back exact, in the same number of bytes', () => {
    const pdf = Buffer.from('1 0 obj << /Type /Page /MediaBox [0 0 838.07996 630] >> endobj', 'latin1');
    const out = ctx.exactPageBox(pdf, 11.635, 8.75);
    assert.equal(out.length, pdf.length);
    assert.match(out.toString('latin1'), /\/MediaBox \[0 0 837\.72000 630\]/);
  });

  test('the cover template is the full wrap for the page count, with the spine for the paper', () => {
    const html = ctx.kdpCoverHtml({ trim: '6x9', paper: 'cream', pages: 300, title: 'A & B', author: 'Me' });
    // 0.125 + 6 + 0.75 + 6 + 0.125
    assert.match(html, /@page \{ size: 13\.0000in 9\.2500in;/);
    assert.ok(html.includes('A &amp; B'));
    assert.ok(!html.includes('no text on the spine'));
    assert.ok(ctx.kdpCoverHtml({ trim: '5x8', paper: 'white', pages: 60, title: 'T', author: '' }).includes('no text on the spine'));
  });
});

// The trims the dialog offers (app/print.js) against the ones main.js lays
// out: the British and German sizes of #404 beside KDP's own.
describe('trim sizes', () => {
  const printSource = fs.readFileSync(path.join(root, 'app', 'print.js'), 'utf8');
  const literal = (name) => {
    const m = printSource.match(new RegExp('const ' + name + ' = ([\\[{][\\s\\S]*?\\n[\\]}]);'));
    assert.ok(m, name + ' is in app/print.js');
    return vm.runInNewContext('(' + m[1].replace(/^\s*\/\/.*$/gm, '') + ')', { tk: (s) => s });
  };
  // (each is read in a context of its own: JSON brings it into this one, so they compare)
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const trims = plain(literal('PRINT_TRIMS'));
  const dims = plain(literal('PRINT_DIMS'));
  const kdp = plain(vm.runInContext('KDP_TRIMS', ctx));

  test('every size the dialog offers is one main.js lays out, at the same size', () => {
    assert.deepEqual(trims.map((x) => x.id).sort(), Object.keys(kdp).sort());
    for (const x of trims) {
      assert.deepEqual(dims[x.id], kdp[x.id], x.id);
      assert.ok(x.size > 0 && x.outside >= 0.25 && x.perPage > 0, x.id);
    }
  });

  test('the UK and German sizes are there, to the millimetre', () => {
    const mm = (id) => kdp[id].map((n) => Math.round(n * 25.4 * 10) / 10);
    assert.deepEqual(mm('110x178mm'), [110, 178]);
    assert.deepEqual(mm('120x190mm'), [120, 190]);
    assert.deepEqual(mm('135x216mm'), [135, 216]);
    assert.deepEqual(mm('148x210mm'), [148, 210]);
    // B format (128 × 198) is KDP's own 5.06 × 7.81, so it isn't custom
    assert.deepEqual(mm('5.06x7.81'), [128.5, 198.4]);
    assert.ok(!trims.find((x) => x.id === '5.06x7.81').custom);
  });

  test('every size is one KDP prints, in the band whose page limits NEO uses', () => {
    for (const [id, [w, h]] of Object.entries(kdp)) {
      assert.ok(w >= 4 && h >= 6 && w <= 8.5 && h <= 11.69, id + ' is a size KDP takes');
      assert.ok(w <= 6.12 && h <= 9, id + ' keeps the page limits of 6 × 9 and smaller');
      const t = trims.find((x) => x.id === id);
      assert.equal(!!t.custom, !['5x8', '5.25x8', '5.5x8.5', '6x9', '5.06x7.81'].includes(id), id + ': custom only where KDP has no such standard size');
    }
  });

  test('the cover template takes a metric size', () => {
    // 0.125 + 110 mm + 300 × 0.0025 + 110 mm + 0.125, by 178 mm + 0.25
    const html = ctx.kdpCoverHtml({ trim: '110x178mm', paper: 'cream', pages: 300, title: 'T', author: '' });
    assert.match(html, /@page \{ size: 9\.6614in 7\.2579in;/);
    assert.ok(html.includes('Trim: 4.331 × 7.008 in'), 'the trim is named');
  });

  test('a metric page box is written back to the exact size, the two sides sharing the room', () => {
    const fix = (box) => {
      const pdf = Buffer.from(`/MediaBox [0 0 ${box}]`, 'latin1');
      const out = ctx.exactPageBox(pdf, 110 / 25.4, 178 / 25.4);
      assert.equal(out.length, pdf.length, box + ': the same number of bytes');
      return out.toString('latin1').replace(/^\/MediaBox \[0 0 |\]$/g, '');
    };
    // as Chromium wrote it for 110 × 178 mm: the width a whole number, with no
    // decimals of its own to correct (NEO had left it at 312, 110.07 mm)
    assert.equal(fix('312 504.56693'), '311.81 504.57');
    assert.equal(fix('311.76001 504.72'), '311.811 504.5669');
    // room for no decimals at all: the nearest whole points
    assert.equal(fix('312 505'), '312 505');
    // an inch size is untouched by the sharing
    assert.equal(ctx.exactPageBox(Buffer.from('/MediaBox [0 0 360 576]', 'latin1'), 5, 8).toString('latin1'), '/MediaBox [0 0 360 576]');
  });
});
