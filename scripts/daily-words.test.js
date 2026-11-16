'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const { test } = require('node:test');

// the rules for today's word count from app.js, on their own (#345)
const app = require('./app-files').appSource();
const from = app.indexOf('// ---- daily words rules:');
const to = app.indexOf('// ---- end of daily words rules ----');
const context = vm.createContext({});
vm.runInContext(app.slice(from, to), context);
vm.runInContext('this.api = { dayWords, nextDayCount, mergeDayCounts };', context);
const { dayWords, nextDayCount, mergeDayCounts } = context.api;
const plain = (o) => JSON.parse(JSON.stringify(o));

test('a new day starts at the story\'s count', () => {
  assert.deepEqual(plain(nextDayCount(undefined, 2060, undefined)), { start: 2060, end: 2060 });
  assert.deepEqual(plain(nextDayCount(undefined, 2061, 2060)), { start: 2061, end: 2061 }, 'the keystroke that crosses midnight starts the new day at nothing');
});

test('typing here counts, and so does cutting, down to zero', () => {
  const day = { start: 1000, end: 1400 };
  assert.equal(dayWords(nextDayCount(day, 1405, 1400)), 405);
  assert.equal(dayWords(nextDayCount(day, 1300, 1400)), 300, 'a cut takes from today');
  const cut = nextDayCount(day, 200, 1400);
  assert.equal(dayWords(cut), 0, 'today never reads below zero');
  assert.equal(dayWords(nextDayCount(cut, 210, 200)), 10, 'what is written after the cut counts in full');
});

test('text read from disk never counts as written today', () => {
  // a chapter still syncing when the book opened arrives: 2,000 words more
  const opened = nextDayCount(undefined, 60, undefined);
  assert.equal(dayWords(nextDayCount(opened, 2060, 2060)), 0);
  // the other device wrote 400 today; the book opens with a chapter missing
  const there = { start: 1660, end: 2060 };
  const short = nextDayCount(there, 60, 60);
  assert.equal(dayWords(short), 400, 'the day keeps what was written there');
  const typed = nextDayCount(short, 61, 60);
  assert.equal(dayWords(typed), 401);
  assert.equal(dayWords(nextDayCount(typed, 2061, 2061)), 401, 'the missing chapter arriving adds nothing');
  // the other device's copy of a chapter, kept beside ours: no words of today
  assert.equal(dayWords(nextDayCount({ start: 1500, end: 1501 }, 3002, 3002)), 1);
});

test('a broken entry reads as nothing written', () => {
  assert.equal(dayWords(undefined), 0);
  assert.equal(dayWords({ start: 'x', end: 5 }), 0);
  assert.equal(dayWords({ start: 10, end: 5 }), 0);
  assert.deepEqual(plain(nextDayCount({ start: null, end: 5 }, 50, 50)), { start: 50, end: 50 });
});

test('another device\'s days: the larger tally of a day wins', () => {
  const ours = { '2026-10-13': { start: 500, end: 900 }, '2026-10-14': { start: 3001, end: 3002 } };
  const theirs = { '2026-10-12': { start: 100, end: 500 }, '2026-10-13': { start: 500, end: 600 }, '2026-10-14': { start: 100, end: 400 } };
  const days = plain(mergeDayCounts(ours, theirs));
  assert.deepEqual(days['2026-10-12'], { start: 100, end: 500 }, 'a day only they have is taken');
  assert.deepEqual(days['2026-10-13'], { start: 500, end: 900 }, 'ours, where we saw more');
  assert.deepEqual(days['2026-10-14'], { start: 2702, end: 3002 }, 'their 300, against our count');
  assert.deepEqual(plain(mergeDayCounts(ours, ours)), plain(ours), 'our own file read back changes nothing');
  assert.deepEqual(plain(mergeDayCounts(ours, null)), plain(ours));
  assert.deepEqual(plain(mergeDayCounts(undefined, { d: { start: 'a', end: 1 } })), {});
});
