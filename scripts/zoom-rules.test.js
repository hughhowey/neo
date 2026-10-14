'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// the interface zoom rule from app.js, on its own
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = app.indexOf('// ---- zoom rules:');
const to = app.indexOf('// ---- end of zoom rules ----');
const context = vm.createContext({});
vm.runInContext(app.slice(from, to), context);
vm.runInContext('this.api = { UI_ZOOM_RANGE, snapZoom, nextZoomStep };', context);
const api = context.api;

test('the interface zoom steps by a tenth', () => {
  assert.equal(api.nextZoomStep(1, 1), 1.1);
  assert.equal(api.nextZoomStep(1.1, 1), 1.2);
  assert.equal(api.nextZoomStep(1, -1), 0.9);
  assert.equal(api.nextZoomStep(1.25, -1), 1.2, 'an old value between steps lands on a tenth');
});

test('the interface zoom stops at 90% and 300%', () => {
  assert.equal(api.nextZoomStep(api.UI_ZOOM_RANGE.min, -1), api.UI_ZOOM_RANGE.min);
  assert.equal(api.nextZoomStep(api.UI_ZOOM_RANGE.max, 1), api.UI_ZOOM_RANGE.max);
});

test('direction 0 resets to 100%, and a missing value reads 100%', () => {
  assert.equal(api.nextZoomStep(2.5, 0), 1);
  assert.equal(api.snapZoom(undefined), 1);
  assert.equal(api.snapZoom(''), 1);
  assert.equal(api.snapZoom(1.25), 1.3);
  assert.equal(api.snapZoom(4), 3);
});
