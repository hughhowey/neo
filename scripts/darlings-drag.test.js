'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// the selection grace window from app.js, on its own
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = app.indexOf('// ---- darlings drag rules:');
const to = app.indexOf('// ---- end of darlings drag rules ----');
const context = vm.createContext({});
vm.runInContext(app.slice(from, to), context);
vm.runInContext('this.api = { keepsSelectionForDrag, DRAG_KEEP_SELECTION_MS };', context);
const api = context.api;

test('a just-made selection is kept for the drag window', () => {
  // selected at t=1000, mousedown at t=1500: a drag starting from it must not collapse it
  assert.ok(api.keepsSelectionForDrag(false, 1000, 1500));
});

test('an old selection collapses on click as before', () => {
  assert.ok(!api.keepsSelectionForDrag(false, 1000, 1000 + api.DRAG_KEEP_SELECTION_MS + 1));
});

test('a collapsed selection is never kept', () => {
  assert.ok(!api.keepsSelectionForDrag(true, 1000, 1000));
});
