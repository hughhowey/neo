'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// the keys that toggle full screen from the window, from app.js on their own
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = app.indexOf('// ---- full screen keys:');
const to = app.indexOf('// ---- end of full screen keys ----');
const context = vm.createContext({});
vm.runInContext(app.slice(from, to), context);
vm.runInContext('this.api = { isFullScreenKey };', context);
const { isFullScreenKey } = context.api;

const key = (k, mods = {}) => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, repeat: false, ...mods });

test('F11 toggles full screen on Windows and Linux', () => {
  assert.equal(isFullScreenKey(key('F11'), false), true);
});

test('F11 is left to macOS, which shows the desktop with it', () => {
  assert.equal(isFullScreenKey(key('F11'), true), false);
});

test('F11 held down toggles once, not over and over', () => {
  assert.equal(isFullScreenKey(key('F11', { repeat: true }), false), false);
});

test('F11 with a modifier is not the full screen key', () => {
  for (const mod of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
    assert.equal(isFullScreenKey(key('F11', { [mod]: true }), false), false, mod);
  }
});

test('⌘Enter and Ctrl+Enter still toggle full screen everywhere', () => {
  for (const mac of [true, false]) {
    assert.equal(isFullScreenKey(key('Enter', { metaKey: true }), mac), true);
    assert.equal(isFullScreenKey(key('Enter', { ctrlKey: true }), mac), true);
    assert.equal(isFullScreenKey(key('Enter', { ctrlKey: true, shiftKey: true }), mac), false);
    assert.equal(isFullScreenKey(key('Enter'), mac), false);
  }
});

test('other keys do not toggle full screen', () => {
  assert.equal(isFullScreenKey(key('F10'), false), false);
  assert.equal(isFullScreenKey(key('f'), false), false);
});
