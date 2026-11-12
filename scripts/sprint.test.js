'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// the rules for a sprint from app.js, on their own
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = app.indexOf('// ---- sprint rules:');
const to = app.indexOf('// ---- end of sprint rules ----');
const context = vm.createContext({});
vm.runInContext(app.slice(from, to), context);
vm.runInContext('this.api = { sprintSettings, sprintOver, sprintRate, sprintSpan, sprintClock };', context);
const { sprintSettings, sprintOver, sprintRate, sprintSpan, sprintClock } = context.api;
const plain = (o) => JSON.parse(JSON.stringify(o));

test('a first sprint is ten minutes, with a chime', () => {
  assert.deepEqual(plain(sprintSettings(undefined)), { by: 'time', minutes: 10, words: 500, chime: true });
  assert.deepEqual(plain(sprintSettings('nonsense')), { by: 'time', minutes: 10, words: 500, chime: true });
});

test('the writer\'s choices are kept, and a broken one falls back', () => {
  assert.deepEqual(plain(sprintSettings({ by: 'words', minutes: '25', words: 750, chime: false })),
    { by: 'words', minutes: 25, words: 750, chime: false });
  const odd = plain(sprintSettings({ by: 'sideways', minutes: 0, words: -3 }));
  assert.deepEqual(odd, { by: 'time', minutes: 10, words: 500, chime: true });
  assert.equal(sprintSettings({ minutes: '' }).minutes, 10, 'an emptied box');
  assert.equal(sprintSettings({ minutes: 100000 }).minutes, 600, 'ten hours at most');
});

test('a timed sprint ends with its clock, whatever was written', () => {
  const sp = { by: 'time', target: 500, startCount: 1000, endsAt: 600000 };
  assert.equal(sprintOver(sp, 9000, 599999), false);
  assert.equal(sprintOver(sp, 1000, 600000), true);
});

test('a sprint to a word count ends at the word that reaches it, however long it takes', () => {
  const sp = { by: 'words', target: 500, startCount: 1000, endsAt: 600000 };
  assert.equal(sprintOver(sp, 1499, 9999999), false);
  assert.equal(sprintOver(sp, 1500, 1), true);
});

test('speed is words an hour at the sprint\'s pace', () => {
  assert.equal(sprintRate(402, 600000), 2412);
  assert.equal(sprintRate(500, 30 * 60000), 1000);
  assert.equal(sprintRate(0, 600000), 0);
  assert.equal(sprintRate(50, 0), 0, 'no time passed: no speed, not infinity');
});

test('the length of a sprint reads in minutes and seconds', () => {
  assert.deepEqual(plain(sprintSpan(600000)), { min: 10, sec: 0 });
  assert.deepEqual(plain(sprintSpan(754400)), { min: 12, sec: 34 });
  assert.deepEqual(plain(sprintSpan(-5)), { min: 0, sec: 0 });
});

test('the clock counts down, and reads 0:00 only when the time is gone', () => {
  assert.equal(sprintClock(600000), '10:00');
  assert.equal(sprintClock(599001), '10:00');
  assert.equal(sprintClock(462000), '7:42');
  assert.equal(sprintClock(1), '0:01');
  assert.equal(sprintClock(0), '0:00');
  assert.equal(sprintClock(-800), '0:00');
});
