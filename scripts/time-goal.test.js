'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// the clock, the readable duration, and the span the stopwatch credits, run
// on their own (they are the whole arithmetic of the daily time goal)
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(app.slice(app.indexOf('// ---- time-goal helpers'), app.indexOf('// ---- end time-goal helpers')), context);
vm.runInContext('this.api = { TIME_GRACE_MS, writingSpanMs, fmtClock };', context);
const { TIME_GRACE_MS, writingSpanMs, fmtClock } = context.api;

// the chart's model — what the bars and the line plot, in words or time
const chart = vm.createContext({});
vm.runInContext(app.slice(app.indexOf('function chartModel'), app.indexOf('function statsChartSvg')), chart);
vm.runInContext('this.api = { chartModel };', chart);
const { chartModel } = chart.api;

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

test('the chart plots daily words against the book goal', () => {
  const days = ['2026-10-01', '2026-10-02', '2026-10-03'];
  const book = {
    dailyCounts: {
      '2026-10-01': { start: 100, end: 180 }, // 80 words
      '2026-10-03': { start: 180, end: 260 }  // 80 words, a gap on the 2nd
    },
    wordGoal: 1000
  };
  const m = chartModel(book, { dailyGoal: 500 }, days, false);
  assert.deepEqual(m.daily, [80, 0, 80]);
  assert.equal(m.goal, 1000);
  assert.equal(m.maxD, Math.max(80, 0, 80, 500, 1000));
});

test('the chart plots daily minutes against the time goal', () => {
  const days = ['2026-10-01', '2026-10-02'];
  const book = { dailyTime: { '2026-10-01': 3600, '2026-10-02': 1800 }, dailyCounts: {} };
  const m = chartModel(book, { dailyTimeGoal: 30 }, days, true);
  assert.deepEqual(m.daily, [60, 30]);
  assert.equal(m.goal, 30);
  assert.equal(m.maxD, 60);
});

test('both modes carry the same shape: daily bars and one goal', () => {
  const days = ['2026-10-01', '2026-10-02'];
  const book = { dailyCounts: { '2026-10-01': { start: 0, end: 10 } }, dailyTime: { '2026-10-01': 600 },
    wordGoal: 80000 };
  const w = chartModel(book, { dailyGoal: 500 }, days, false);
  const tm = chartModel(book, { dailyTimeGoal: 30 }, days, true);
  for (const m of [w, tm]) {
    assert.deepEqual(Object.keys(m).sort(), ['daily', 'goal', 'maxD']);
    assert.equal(m.cumulative, undefined);
    assert.equal(m.maxC, undefined);
  }
  assert.equal(w.goal, 80000);   // words measure against the book goal
  assert.equal(tm.goal, 30);     // time measures against the time goal
});

test('an empty book charts as flat lines, never a crash', () => {
  const days = ['2026-10-01', '2026-10-02'];
  const m = chartModel({}, {}, days, false);
  assert.deepEqual(m.daily, [0, 0]);
  assert.equal(m.goal, 0);
  assert.equal(m.maxD, 1);
  const mt = chartModel({}, {}, days, true);
  assert.deepEqual(mt.daily, [0, 0]);
  assert.equal(mt.maxD, 1);
});

test('a day with no words or minutes draws no bar', () => {
  // the guard lives in statsChartSvg, which needs the DOM; the arithmetic it
  // depends on is here, so a zero day must map to a height of zero
  const days = ['2026-10-01', '2026-10-02', '2026-10-03'];
  for (const useTime of [false, true]) {
    const m = chartModel({ dailyCounts: {}, dailyTime: {} }, { dailyTimeGoal: 30, dailyGoal: 500 }, days, useTime);
    const heights = m.daily.map((v) => Math.round((v / m.maxD) * 90));
    assert.deepEqual(heights, [0, 0, 0]);
  }
});
