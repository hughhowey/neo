'use strict';

// The window's files (scripts/app-files.js) load in one order everywhere,
// and each keeps the strict mode the single app.js had.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { APP_FILES } = require('./app-files');

const root = path.join(__dirname, '..');
for (const page of ['index.html', 'pocket/www/index.html']) {
  test(`${page} loads the window's files in order`, () => {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const listed = [...html.matchAll(/<script src="(app\/[^"]+)"><\/script>/g)].map((m) => m[1]);
    assert.deepEqual(listed, APP_FILES);
  });
}
test('every file in app/ is listed, and each is strict', () => {
  const onDisk = fs.readdirSync(path.join(root, 'app')).filter((f) => f.endsWith('.js')).map((f) => 'app/' + f).sort();
  assert.deepEqual(onDisk, [...APP_FILES].sort());
  for (const f of APP_FILES) assert.match(fs.readFileSync(path.join(root, f), 'utf8'), /^(\/\*.*\*\/\s*)?'use strict';/, f);
});
test('every function the window declares is used somewhere (lint can no longer tell)', () => {
  const { appSource } = require('./app-files');
  const src = appSource();
  const others = ['index.html', 'pocket/www/index.html', 'pocket/www/pocket-bridge.js', 'main.js', 'preload.js']
    .map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  const names = [...src.matchAll(/^(?:async )?function (\w+)\(/gm)].map((m) => m[1]);
  const unused = names.filter((n) => {
    const re = new RegExp('\\b' + n + '\\b', 'g');
    return (src.match(re) || []).length + (others.match(re) || []).length < 2;
  });
  assert.deepEqual(unused, []);
});
