'use strict';

// Pocket has its own copy of the page (pocket/www/index.html). Every element
// app.js looks up by id must be on both pages, or Pocket stops with "Cannot
// set properties of null" where the desktop works (#308).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const ids = (html) => new Set([...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]));
const wanted = new Set([
  ...[...app.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1]),
  ...[...app.matchAll(/getElementById\('([\w-]+)'\)/g)].map((m) => m[1])
]);
const made = new Set([
  ...[...app.matchAll(/\.id = '([\w-]+)'/g)].map((m) => m[1]),
  ...ids(app)
]);

for (const page of ['index.html', 'pocket/www/index.html']) {
  test(`every element app.js finds by id is on ${page}`, () => {
    const have = ids(fs.readFileSync(path.join(root, page), 'utf8'));
    assert.deepEqual([...wanted].filter((id) => !have.has(id) && !made.has(id)), []);
  });
}

// Pocket's page shows the same locales/ files as the desktop, so every word on
// it is marked for translation the same way (data-i18n, data-i18n-title,
// data-i18n-placeholder, data-i18n-ph, data-i18n-label). Its ⋯ sheet, built
// in the page's script, uses t().
test('every word on Pocket\'s page is marked for translation', () => {
  const html = fs.readFileSync(path.join(root, 'pocket/www/index.html'), 'utf8')
    .replace(/<script[\s\S]*?<\/script>/g, '');
  const names = new Set(['NEO', 'NEO Pocket']); // the app's name stays as it is
  const unmarked = [];
  for (const [, tag, attrs, text] of html.matchAll(/<(\w+)([^>]*)>([^<]*)/g)) {
    const words = text.trim();
    if (/\p{L}/u.test(words) && !names.has(words) && !/\sdata-i18n(\s|$)/.test(attrs + ' ')) unmarked.push(`<${tag}> ${words}`);
    if (/\stitle="/.test(attrs) && !/\sdata-i18n-title\b/.test(attrs)) unmarked.push(`<${tag}> title`);
    if (/\splaceholder="/.test(attrs) && !/\sdata-i18n-placeholder\b/.test(attrs)) unmarked.push(`<${tag}> placeholder`);
    if (/\sdata-ph="/.test(attrs) && !/\sdata-i18n-ph\b/.test(attrs)) unmarked.push(`<${tag}> data-ph`);
    if (/\saria-label="/.test(attrs)) unmarked.push(`<${tag}> aria-label (use data-i18n-label)`);
  }
  assert.deepEqual(unmarked, []);
});
