'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// what ⌘B / ⌘I leave at the caret, kept when the caret is set again (#430)
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = app.indexOf('// ---- typing style rules:');
const to = app.indexOf('// ---- end of typing style rules ----');
const context = vm.createContext({});
vm.runInContext(app.slice(from, to), context);
vm.runInContext('this.api = { TYPING_STYLES, keepTypingStyle };', context);
const { TYPING_STYLES, keepTypingStyle } = context.api;

// The engine as far as these commands go: the caret sits in text styled
// `at`, and a toggle with nothing selected only sets the style the next
// letters get. Setting the selection forgets that, as Chromium does.
function engine(at) {
  const doc = {
    next: null,
    ran: [],
    queryCommandState(cmd) { return doc.next && cmd in doc.next ? doc.next[cmd] : !!at[cmd]; },
    execCommand(cmd) { doc.ran.push(cmd); doc.next = { ...doc.next, [cmd]: !doc.queryCommandState(cmd) }; return true; }
  };
  return doc;
}
const collapse = (doc) => () => { doc.next = null; };

test('italics turned off at the end of italic text stay off when the caret is set again', () => {
  const doc = engine({ italic: true });
  doc.execCommand('italic'); // ⌘I off
  doc.ran = [];
  assert.deepEqual([...keepTypingStyle(doc, collapse(doc))], ['italic']);
  assert.equal(doc.queryCommandState('italic'), false);
  assert.deepEqual(doc.ran, ['italic']);
});

test('italics turned on in plain text stay on', () => {
  const doc = engine({});
  doc.execCommand('italic'); // ⌘I on
  keepTypingStyle(doc, collapse(doc));
  assert.equal(doc.queryCommandState('italic'), true);
});

test('bold, underline and strikethrough are kept the same way, together', () => {
  const doc = engine({ bold: true, italic: true });
  doc.execCommand('bold'); // off
  doc.execCommand('underline'); // on
  doc.execCommand('strikeThrough'); // on
  keepTypingStyle(doc, collapse(doc));
  assert.deepEqual([...TYPING_STYLES].map((c) => doc.queryCommandState(c)), [false, true, true, true]);
});

test('with nothing toggled, setting the caret again runs no command', () => {
  const doc = engine({ italic: true });
  assert.deepEqual([...keepTypingStyle(doc, collapse(doc))], []);
  assert.deepEqual(doc.ran, []);
});

test('a style toggled twice (back where it was) is left alone', () => {
  const doc = engine({});
  doc.execCommand('italic');
  doc.execCommand('italic');
  doc.ran = [];
  keepTypingStyle(doc, collapse(doc));
  assert.deepEqual(doc.ran, []);
  assert.equal(doc.queryCommandState('italic'), false);
});
