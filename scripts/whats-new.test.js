'use strict';

// whats-new.json reads, newest first, and the version rule that decides
// what a writer who just updated is shown (WHAT'S NEW in app/print.js)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const src = require('./app-files').appSource();

const ctx = vm.createContext({});
const at = src.indexOf('const versionParts');
vm.runInContext(src.slice(at, src.indexOf('\nasync function whatsNewAtLaunch', at)) + '\nthis.versionNewer = versionNewer;', ctx);

test('versions compare part by part', () => {
  assert.equal(ctx.versionNewer('2.0.0', '1.6.6'), true);
  assert.equal(ctx.versionNewer('1.10.0', '1.9.9'), true);
  assert.equal(ctx.versionNewer('1.6.6', '1.6.6'), false);
  assert.equal(ctx.versionNewer('1.6.5', '1.6.6'), false);
});
test('whats-new.json: releases newest first, each with notes', () => {
  const notes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'whats-new.json'), 'utf8'));
  assert.ok(notes.length);
  for (const r of notes) {
    assert.match(r.version, /^\d+\.\d+\.\d+$/);
    assert.ok(Array.isArray(r.items) && r.items.length, r.version);
  }
  for (let i = 1; i < notes.length; i++) assert.ok(ctx.versionNewer(notes[i - 1].version, notes[i].version), 'newest first');
});
