#!/usr/bin/env node
'use strict';

// node scripts/pocket-www.js
//
// Fills pocket/www with what NEO Pocket shares with desktop NEO: the editor
// (app.js, covers.js, styles.css, i18n.js, fonts, locales), JSZip, and the
// spellchecker (Hunspell's browser build plus the same dictionaries desktop
// NEO bundles). The robot build runs this; so does a local Android or iOS
// build, before `npx cap sync`.

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const www = path.join(root, 'pocket', 'www');
const mods = path.join(root, 'node_modules');

const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};
const copyDir = (from, to) => {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
};

for (const f of ['app.js', 'covers.js', 'styles.css', 'i18n.js']) copy(path.join(root, f), path.join(www, f));
copy(path.join(mods, 'jszip', 'dist', 'jszip.min.js'), path.join(www, 'jszip.min.js'));
copyDir(path.join(root, 'fonts'), path.join(www, 'fonts'));
copyDir(path.join(root, 'locales'), path.join(www, 'locales'));

// Hunspell. The package finds its browser build through an import map
// (#hunspell-glue) that a phone's web view doesn't have, so point it at the
// file directly. Saved as .js: the phones serve .mjs with no JavaScript type,
// and a module refuses to load without one.
const hun = path.join(mods, '@farscrl', 'hunspell-wasm', 'dist');
const spellDir = path.join(www, 'hunspell');
fs.rmSync(spellDir, { recursive: true, force: true });
fs.mkdirSync(spellDir, { recursive: true });
const index = fs.readFileSync(path.join(hun, 'index.mjs'), 'utf8')
  .replace(/\/\/# sourceMappingURL=.*$/m, '');
if (!index.includes('import("#hunspell-glue")')) throw new Error('hunspell-wasm changed shape: index.mjs no longer imports #hunspell-glue');
fs.writeFileSync(path.join(spellDir, 'index.js'), index.replace('import("#hunspell-glue")', 'import("./hunspell.web.js")'));
copy(path.join(hun, 'lib', 'hunspell.web.mjs'), path.join(spellDir, 'hunspell.web.js'));

// The dictionaries: the list desktop NEO offers (SPELL_LANGUAGES in main.js)
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const block = main.match(/const SPELL_LANGUAGES = \{([\s\S]*?)\n\};/);
if (!block) throw new Error('SPELL_LANGUAGES not found in main.js');
const langs = {};
const labels = {};
for (const m of block[1].matchAll(/'([\w-]+)': \{ label: '([^']*)', pkg: '(dictionary-[\w-]+)' \}/g)) { langs[m[1]] = m[3]; labels[m[1]] = m[2]; }
if (!langs['en-US']) throw new Error('SPELL_LANGUAGES has no en-US');
// Greek's dictionary is nearly half the download on its own: left out of
// Pocket until someone asks for it
for (const code of ['el']) { delete langs[code]; delete labels[code]; }
const dictDir = path.join(www, 'dict');
fs.rmSync(dictDir, { recursive: true, force: true });
for (const [code, pkg] of Object.entries(langs)) {
  for (const f of ['index.aff', 'index.dic']) copy(path.join(mods, pkg, f), path.join(dictDir, code, f));
  if (code === 'sv') {
    for (const f of fs.readdirSync(path.join(root, 'licenses', pkg))) copy(path.join(root, 'licenses', pkg, f), path.join(dictDir, code, f));
  }
}
fs.writeFileSync(path.join(dictDir, 'languages.json'), JSON.stringify(labels) + '\n');

console.log(`pocket/www is ready (${Object.keys(langs).length} dictionaries).`);
