'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// the typewriter's rules from app.js, on their own
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = app.indexOf('// ---- typewriter rules:');
const to = app.indexOf('// ---- end of typewriter rules ----');
const context = vm.createContext({});
vm.runInContext(app.slice(from, to), context);
vm.runInContext('this.api = { typewriterScrollTarget, strayCaretScroll };', context);
const api = context.api;

// A window 1000 high, the scroller filling it; lines 30 high, so the writing
// height is 450 and the band runs 405 to 495.
const WIN = 1000;
const LINE = 30;
const view = { viewTop: 0, viewBottom: WIN };

test('the page stays while the caret is inside the band, and glides it back from outside', () => {
  assert.equal(api.typewriterScrollTarget(2000, 450, WIN, LINE), null);
  assert.equal(api.typewriterScrollTarget(2000, 495, WIN, LINE), null);
  assert.equal(api.typewriterScrollTarget(2000, 405, WIN, LINE), null);
  assert.equal(api.typewriterScrollTarget(2000, 540, WIN, LINE), 2090, 'two lines low: the page comes up to the caret');
  assert.equal(api.typewriterScrollTarget(2000, 300, WIN, LINE), 1850);
});

// #453: ten letters typed on the first line of a page, in a paragraph that
// began on the page before. After each one Chromium scrolls up to where it
// thinks the caret is, the paragraph's top 158 px above the window, though
// the caret sits at the writing height. Then a frame is painted.
function typeAtPageTop(rule) {
  let scrollTop = 2000;
  let glide = null;
  const caretAt = (st) => 450 - (st - 2000); // the caret's top in the window
  const painted = [];
  for (let i = 0; i < 10; i++) {
    const was = scrollTop;
    scrollTop -= 158; // Chromium's scroll, inside the keystroke
    // the frame: NEO's check, then the typewriter, then the paint
    const back = rule({ was, now: scrollTop, glide, caretTop: caretAt(was), caretBottom: caretAt(was) + 19, ...view });
    if (back !== null) scrollTop = back;
    const top = api.typewriterScrollTarget(scrollTop, caretAt(scrollTop), WIN, LINE);
    painted.push(scrollTop);
    if (top !== null) { glide = top; scrollTop = top; } // the glide, in the frames that follow
  }
  return painted;
}

test('typing at the top of a page holds the page still (#453)', () => {
  const painted = typeAtPageTop(api.strayCaretScroll);
  assert.deepEqual(painted, Array(10).fill(2000), 'the page never moves');
});

test('without the check, every letter bobs the page (#453)', () => {
  const painted = typeAtPageTop(() => null);
  assert.deepEqual(painted, Array(10).fill(1842), 'up 158 px, painted, then glided back');
});

test('the typewriter\'s own glide is left to run', () => {
  const caret = { caretTop: 500, caretBottom: 519, ...view };
  assert.equal(api.strayCaretScroll({ was: 2000, now: 2030, glide: 2090, ...caret }), null, 'down toward its end');
  assert.equal(api.strayCaretScroll({ was: 2000, now: 2090, glide: 2090, ...caret }), null, 'at its end');
  assert.equal(api.strayCaretScroll({ was: 2000, now: 1970, glide: 1850, ...caret }), null, 'up toward its end');
  assert.equal(api.strayCaretScroll({ was: 2000, now: 1842, glide: 2090, ...caret }), 2000, 'the other way is not the glide');
  assert.equal(api.strayCaretScroll({ was: 2000, now: 2300, glide: 2090, ...caret }), 2000, 'nor is past its end');
});

test('a caret out of sight is Chromium\'s to bring into view', () => {
  assert.equal(api.strayCaretScroll({ was: 2000, now: 2600, glide: null, caretTop: 1500, caretBottom: 1519, ...view }), null, 'below the window');
  assert.equal(api.strayCaretScroll({ was: 2000, now: 1700, glide: null, caretTop: -300, caretBottom: -281, ...view }), null, 'above it');
  assert.equal(api.strayCaretScroll({ was: 2000, now: 2010, glide: null, caretTop: 990, caretBottom: 1009, ...view }), null, 'cut by the window\'s foot');
});

test('a page that did not move is left alone', () => {
  assert.equal(api.strayCaretScroll({ was: 2000, now: 2000, glide: null, caretTop: 450, caretBottom: 469, ...view }), null);
});
