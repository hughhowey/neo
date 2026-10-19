'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// the alignment a new chapter opens in (#426), from app.js on its own
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = app.indexOf('// ---- carried alignment rules:');
const to = app.indexOf('// ---- end of carried alignment rules ----');
const context = vm.createContext({});
vm.runInContext(app.slice(from, to), context);
vm.runInContext('this.api = { chapterAlign, newChapterHtml };', context);
const { chapterAlign, newChapterHtml } = context.api;

const J = (text) => `<p style="text-align: justify;">${text}</p>`;
const EMPTY = '<p><br></p>';

test('a chapter reads as the alignment most of its prose is set in', () => {
  assert.equal(chapterAlign(J('Rain fell.') + J('The boats came in.')), 'justify');
  assert.equal(chapterAlign('<p>Rain fell.</p><p>The boats came in.</p>'), '');
  // a centered line at the end (a sign-off, a letter's close) doesn't set the chapter
  assert.equal(chapterAlign(J('Rain fell.') + J('The boats came in.') + '<p style="text-align: center;">THE END</p>'), 'justify');
  // a tie goes to the later paragraph
  assert.equal(chapterAlign('<p>Rain fell.</p>' + J('The boats came in.')), 'justify');
  assert.equal(chapterAlign(J('Rain fell.') + '<p>The boats came in.</p>'), '');
});

test('breaks, ghosts, poetry, flush lines, script lines and empty lines don\'t count', () => {
  const page = J('Rain fell.')
    + '<p class="scene-break">***</p>'
    + '<p class="ghost" data-sec-id="s1">the storm</p>'
    + '<p class="poetry">a line</p><p class="poetry">another</p>'
    + '<p class="flush">Dear Mara,</p>'
    + '<p class="sp-dialogue">Hello.</p>'
    + '<p><br></p><p> &nbsp;</p><p><b></b></p>';
  assert.equal(chapterAlign(page), 'justify');
  assert.equal(chapterAlign(EMPTY), null, 'no prose yet');
  assert.equal(chapterAlign(''), null);
  assert.equal(chapterAlign(undefined), null);
});

test('an alignment NEO never sets reads as left', () => {
  assert.equal(chapterAlign('<p style="text-align: left;">Rain.</p>'), '');
  assert.equal(chapterAlign('<p style="text-align: start;">Rain.</p>'), '');
  assert.equal(chapterAlign('<p style="text-align: right;">Rain.</p>'), 'right');
});

test('a new chapter opens set as the nearest story with words in it', () => {
  const html = {
    ded: '<p style="text-align: center;">For Mara</p>',
    one: J('Rain fell.') + J('The boats came in.'),
    two: '<p>Left on purpose.</p>',
    blank: EMPTY
  };
  const story = (c) => c !== 'ded';
  const at = (order, i) => newChapterHtml(order, i, (c) => html[c], story);
  assert.equal(at(['ded', 'one'], 2), '<p style="text-align: justify;"><br></p>');
  // an empty chapter in between is passed over
  assert.equal(at(['one', 'blank'], 2), '<p style="text-align: justify;"><br></p>');
  // the chapter just before wins over one further back
  assert.equal(at(['one', 'two'], 2), EMPTY);
  assert.equal(at(['two', 'one'], 2), '<p style="text-align: justify;"><br></p>');
  // a new first chapter looks at the chapters after it; the dedication never counts
  assert.equal(at(['ded', 'one'], 1), '<p style="text-align: justify;"><br></p>');
  assert.equal(at(['ded'], 1), EMPTY);
  assert.equal(at([], 0), EMPTY);
});
