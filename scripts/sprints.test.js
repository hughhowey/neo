'use strict';

// The sprint history rules from app.js, on their own: what a finished sprint
// records (book.sprints), and what the Sprints view of the chart draws from
// those records — one segment per sprint on its day, the rest outside one.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = app.indexOf('// ---- sprint history rules:');
const to = app.indexOf('// ---- end of sprint history rules ----');
assert.ok(from > 0 && to > from, 'the sprint rules are where the test expects them');
const context = vm.createContext({});
vm.runInContext(app.slice(from, to), context);
vm.runInContext('this.api = { pushSprint, sprintBars, SPRINT_CAP };', context);
const { pushSprint, sprintBars, SPRINT_CAP } = context.api;
const plain = (o) => JSON.parse(JSON.stringify(o));

const rec = (day, words, start, target = 500) => ({ day, target, words, start, end: start + 60000, ms: 0 });

test('a finished sprint joins the list, oldest out at the cap', () => {
  let list = pushSprint(pushSprint([], rec('2026-11-01', 480, 1000)), rec('2026-11-02', 520, 2000));
  assert.equal(list.length, 2);
  assert.equal(list[0].start, 1000, 'ordered by when they started');
  for (let i = 0; i < SPRINT_CAP + 5; i++) list = pushSprint(list, rec('2026-11-03', 100 + i, 3000 + i));
  assert.equal(list.length, SPRINT_CAP, 'the list never grows past the cap');
  assert.equal(list.some((s) => s.start === 1000), false, 'the oldest went first');
  assert.equal(list[list.length - 1].start, 3000 + SPRINT_CAP + 4, 'the newest stays');
});

test('each day shows its sprints and the rest of the day outside them', () => {
  const days = ['2026-11-01', '2026-11-02', '2026-11-03'];
  const sprints = [
    rec('2026-11-01', 200, 200), // out of order on purpose
    rec('2026-11-01', 300, 100),
    rec('2026-11-03', 150, 300)
  ];
  const bars = plain(sprintBars(days, sprints, [800, 400, 0]));
  assert.deepEqual(bars[0], { segs: [300, 200], outside: 300 }, 'segments in time order, the rest of the day outside');
  assert.deepEqual(bars[1], { segs: [], outside: 400 }, 'a day without sprints is all outside');
  assert.deepEqual(bars[2], { segs: [150], outside: 0 }, 'sprint words fill the day');
});

test('a day that lost words never reads negative, and junk records read as nothing', () => {
  const days = ['2026-11-01', '2026-11-02'];
  const sprints = [rec('2026-11-01', 900, 100), { ...rec('2026-11-02', 0, 200), words: 'x' }];
  const bars = plain(sprintBars(days, sprints, [500, 300]));
  assert.deepEqual(bars[0], { segs: [900], outside: 0 }, 'more sprint words than the day holds: the day caps it');
  assert.deepEqual(bars[1], { segs: [0], outside: 300 }, 'a broken record reads as nothing');
});

test('no sprints at all leaves every day as it was written', () => {
  const days = ['2026-11-01', '2026-11-02'];
  assert.deepEqual(plain(sprintBars(days, [], [120, 0])), [
    { segs: [], outside: 120 },
    { segs: [], outside: 0 }
  ]);
});

test('old stopwatch records count as outside sprint segments', () => {
  const days = ['2026-11-01'];
  const oldWatch = rec('2026-11-01', 120, 100, 0);
  assert.deepEqual(plain(sprintBars(days, [oldWatch], [500])), [
    { segs: [], outside: 500 }
  ]);
});
