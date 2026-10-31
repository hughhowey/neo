'use strict';

// Which + a shelf shows. The rule is blankTileKind in app.js, run on its own.
// The hover wash is the stylesheet: Book's tint is clipped so it does not
// paint the Script band that sits on top of that button.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const from = app.indexOf('// ---- blank tile ----');
const to = app.indexOf('// ---- end of blank tile ----');
const context = vm.createContext({});
vm.runInContext(app.slice(from, to), context);
const blankTileKind = context.blankTileKind;

describe('blank tile', () => {
  test('the shelf + is a split, a long-press menu, or a plain book', () => {
    // bound, more features, hover → kind
    const rows = [
      [false, true, true, 'split'],
      [false, true, false, 'menu'],
      [false, false, true, 'plain'],
      [false, false, false, 'plain'],
      [true, true, true, 'plain'],
      [true, true, false, 'plain'],
      [true, false, true, 'plain'],
      [true, false, false, 'plain']
    ];
    for (const [bound, more, hover, kind] of rows) {
      assert.equal(blankTileKind(bound, more, hover), kind, `bound ${bound}, more ${more}, hover ${hover}`);
    }
  });

  test('a hover on Book does not tint the Script band', () => {
    const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
    const book = css.slice(css.indexOf('.new-book.nb-split .nb-book:hover {'), css.indexOf('.new-book.nb-split .nb-script:hover'));
    const script = css.slice(css.indexOf('.new-book.nb-split .nb-script:hover'), css.indexOf('.new-book.nb-split .nb-book:focus-visible'));
    assert.match(book, /background-clip:\s*content-box/, 'the book wash stops above Script');
    assert.match(script, /background:/);
    assert.doesNotMatch(script, /background-clip/, 'Script keeps its own wash');
  });
});
