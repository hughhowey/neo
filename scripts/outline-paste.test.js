'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const { test } = require('node:test');

// a pasted list as Outline items (#348): outlineLines from app.js, run on its own
const app = require('./app-files').appSource();
const context = vm.createContext({});
vm.runInContext(app.slice(app.indexOf('function outlineLines('), app.indexOf('// The same list from the HTML')), context);
const lines = (raw) => JSON.parse(JSON.stringify(vm.runInContext('outlineLines', context)(raw))).map((x) => x.level + ' ' + x.text);

test('Obsidian and Markdown: bullets, tabs, checkboxes, headings', () => {
  assert.deepEqual(lines('- Act One\n\t- The call\n\t- [ ] She refuses\n- Act Two\n    - [x] Midpoint\n## Act Three\n'),
    ['0 Act One', '1 The call', '1 She refuses', '0 Act Two', '1 Midpoint', '0 Act Three']);
});

test('Word\'s plain text: its deeper bullets are "o" and "§" before a tab', () => {
  assert.deepEqual(lines('•\tOpening\no\tArrival\n§\tDetail\n•\tClosing'), ['0 Opening', '1 Arrival', '1 Detail', '0 Closing']);
  // a line that only starts with the letter o stays whole
  assert.deepEqual(lines('o my love\nonly this'), ['0 o my love', '0 only this']);
});

test('numbers and letters', () => {
  assert.deepEqual(lines('1. One\n  a) Part\n2) Two'), ['0 One', '1 Part', '0 Two']);
});
