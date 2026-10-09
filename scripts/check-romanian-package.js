'use strict';

// Usage: node scripts/check-romanian-package.js <packaged Resources directory>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const resources = process.argv[2];
if (!resources) throw new Error('Pass the packaged Resources directory');
const root = path.join(__dirname, '..');
const dictionary = path.join(resources, 'app.asar.unpacked/node_modules/dictionary-ro');
for (const file of ['index.aff', 'index.dic', 'license']) {
  assert.deepEqual(fs.readFileSync(path.join(dictionary, file)),
    fs.readFileSync(path.join(root, 'node_modules/dictionary-ro', file)), file);
}
for (const file of ['NOTICE.txt', 'MPL-1.1.txt', 'upstream-license.txt']) {
  assert.deepEqual(fs.readFileSync(path.join(dictionary, file)),
    fs.readFileSync(path.join(root, 'licenses/dictionary-ro', file)), file);
}
for (const file of ['spell-worker.js', 'spell-ro.js']) {
  assert.deepEqual(asar.extractFile(path.join(resources, 'app.asar'), file),
    fs.readFileSync(path.join(root, file)), file);
}
const portuguese = path.join(resources, 'app.asar.unpacked/node_modules/dictionary-pt');
for (const file of ['index.aff', 'index.dic', 'license']) {
  assert.deepEqual(fs.readFileSync(path.join(portuguese, file)),
    fs.readFileSync(path.join(root, 'node_modules/dictionary-pt', file)), file);
}
for (const file of ['NOTICE.txt', 'MPL-2.0.txt', 'upstream-license.txt']) {
  assert.deepEqual(fs.readFileSync(path.join(portuguese, file)),
    fs.readFileSync(path.join(root, 'licenses/dictionary-pt', file)), file);
}
const swedish = path.join(resources, 'app.asar.unpacked/node_modules/dictionary-sv');
for (const file of ['index.aff', 'index.dic', 'license']) {
  assert.deepEqual(fs.readFileSync(path.join(swedish, file)),
    fs.readFileSync(path.join(root, 'node_modules/dictionary-sv', file)), file);
}
for (const file of ['NOTICE.txt', 'LGPL-3.0.txt', 'GPL-3.0.txt', 'upstream-license.txt']) {
  assert.deepEqual(fs.readFileSync(path.join(swedish, file)),
    fs.readFileSync(path.join(root, 'licenses/dictionary-sv', file)), file);
}
for (const file of ['NOTICE.txt', 'MPL-1.1.txt']) {
  assert.deepEqual(fs.readFileSync(path.join(resources, 'licenses/hunspell', file)),
    fs.readFileSync(path.join(root, 'licenses/hunspell', file)), file);
}
console.log('Romanian, Portuguese and Swedish dictionaries, Hunspell and license notices, and worker code verified.');
