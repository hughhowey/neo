'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// the clock, the readable duration, and the span the stopwatch credits, run
// on their own (they are the whole arithmetic of the daily time goal)
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const context = vm.createContext({
  // the slice uses t() only for fmtDuration's units; placeholders are enough
  t: (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)) : s)
});
vm.runInContext(app.slice(app.indexOf('// ---- time-goal helpers'), app.indexOf('// ---- end time-goal helpers')), context);
vm.runInContext('this.api = { TIME_GRACE_MS, writingSpanMs, fmtClock, fmtDuration };', context);
const { TIME_GRACE_MS, writingSpanMs, fmtClock, fmtDuration } = context.api;

test('the clock face is mm:ss, and h:mm:ss past an hour', () => {
  assert.equal(fmtClock(0), '0:00');
  assert.equal(fmtClock(5), '0:05');
  assert.equal(fmtClock(65), '1:05');
  assert.equal(fmtClock(599), '9:59');
  assert.equal(fmtClock(3599), '59:59');
  assert.equal(fmtClock(3600), '1:00:00');
  assert.equal(fmtClock(3660), '1:01:00');
  // never negative, whatever a clock skew hands us
  assert.equal(fmtClock(-10), '0:00');
});

test('a duration reads the way a sentence does', () => {
  assert.equal(fmtDuration(0), '0 sec');
  assert.equal(fmtDuration(45), '45 sec');
  assert.equal(fmtDuration(60), '1 min');
  assert.equal(fmtDuration(90), '1 min');
  assert.equal(fmtDuration(3540), '59 min');
  assert.equal(fmtDuration(3600), '1 h 00 min');
  assert.equal(fmtDuration(3660), '1 h 01 min');
  assert.equal(fmtDuration(7200), '2 h 00 min');
  assert.equal(fmtDuration(-5), '0 sec');
});

test('an active second is credited in full', () => {
  // wrote a moment ago: the tick from mark to now counts
  assert.equal(writingSpanMs(10000, 9000, 10000), 1000);
  // touching the page right now, whatever the grace
  assert.equal(writingSpanMs(50000, 49000, 50000, 120000), 1000);
});

test('the grace tail is counted, then the watch stops', () => {
  // last touch 15s ago, mark 30s back: everything since the mark is within grace
  assert.equal(writingSpanMs(130000, 100000, 115000, 120000), 30000);
  // last touch long past its grace: nothing new is credited
  assert.equal(writingSpanMs(1000000, 1000000, 100000, 120000), 0);
});

test('a delayed tick can never dump idle time into the day', () => {
  // the timer slept: last touch was 2s after the mark, but the span stops at
  // the grace window, not at "now"
  assert.equal(writingSpanMs(10000000, 1000, 2000, 120000), 121000);
  // and an untouched page (no activity ever) credits nothing
  assert.equal(writingSpanMs(100000, 100000, 0, 120000), 0);
});

test('the grace window is the two minutes NEO promises', () => {
  assert.equal(TIME_GRACE_MS, 120000);
});
