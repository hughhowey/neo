'use strict';

// NEO's window code, the files of app/ in the order they load. index.html
// and Pocket's page list them in this order (scripts/app-files.test.js
// checks); they share one global scope, as one file did, and each starts
// 'use strict'. A file's code that runs while it loads may only call what
// is already loaded; everything else waits for the writer.
const fs = require('fs');
const path = require('path');

const APP_FILES = [
  'core', 'shelf', 'editor', 'typing', 'paragraphs', 'litrpg', 'typing-rules', 'vim',
  'screenplay', 'footnotes', 'nav', 'tabs', 'cards', 'saving', 'undo', 'find',
  'spellcheck', 'menu', 'options', 'export', 'print', 'startup'
].map((name) => `app/${name}.js`);

// the whole window's source in one string, for tests that pick functions out
function appSource() {
  const root = path.join(__dirname, '..');
  return APP_FILES.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
}

module.exports = { APP_FILES, appSource };
