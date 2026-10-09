'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// what a chapter's page saves (captureBody), run on its own
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(app.slice(app.indexOf('function captureBody('), app.indexOf('// A chapter that opens on a line of dialogue')), context);
vm.runInContext('this.api = { captureBody, dropJunkSpans };', context);
const { captureBody, dropJunkSpans } = context.api;
const saved = (innerHTML) => captureBody({ innerHTML });

test('words joined by a cut or Backspace across paragraphs are saved without the engine\'s spans', () => {
  // what Chromium leaves on the page after a cut that joins two paragraphs
  const page = '<p>Gulls wheeled over the <span style="white-space: normal"><span style="text-indent: 2em;">empty slips.</span></span></p>';
  assert.equal(saved(page), '<p>Gulls wheeled over the empty slips.</p>');
  // …and after Backspace at the start of a *** line, the break's look comes along too
  const brk = '<p>Gulls.<span style="white-space: normal"><span style="color: rgb(125, 119, 104); letter-spacing: 8px; text-align: center; text-indent: 0px;">***</span></span></p>';
  assert.equal(saved(brk), '<p>Gulls.***</p>');
});

test('NEO\'s own placeholder flags stay, and so does everything inside them', () => {
  const page = '<p>She found <span class="ph-mark" data-note="check the date">[TK]</span> in the <span style="font-size: 18px;">drawer</span>.</p>';
  assert.equal(saved(page), '<p>She found <span class="ph-mark" data-note="check the date">[TK]</span> in the drawer.</p>');
  // a flag inside a junk span, and a junk span inside a flag
  assert.equal(dropJunkSpans('<span style="x"><span class="ph-mark">a<span style="y">b</span></span></span>'),
    '<span class="ph-mark">ab</span>');
});

test('a chapter with no spans is saved as it is', () => {
  const page = '<p>The harbor was quiet.</p><p class="scene-break">***</p><p>One was missing.</p>';
  assert.equal(dropJunkSpans(page), page);
  assert.equal(saved(page), page);
});
