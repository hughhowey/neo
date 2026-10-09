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
