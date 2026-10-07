#!/usr/bin/env node
// NEO translation helper. No dependencies.
//
//   node scripts/i18n.js template      writes locales/_template.json: every
//                                      interface string, ready to translate
//   node scripts/i18n.js check fr      lists what locales/fr.json is missing,
//                                      and what it holds that NEO no longer uses
//   node scripts/i18n.js check fr-CA   the same for a regional file, which
//                                      only holds what differs from fr.json
//
// Strings are found in t('…'), tk('…') and NeoI18n.t('…') calls in the
// JavaScript, and in the data-i18n* attributes of index.html.

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JS_FILES = ['app.js', 'main.js', 'covers.js', 'sync.js'];
const LOCALES = path.join(ROOT, 'locales');

function unescapeJs(s) {
  return s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (m, e) => {
    if (e[0] === 'u') return String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ''), 16));
    if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', '0': '\0' }[e] ?? e;
  });
}

const decodeHtml = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

function collect() {
  const keys = new Map(); // key -> Set(files)
  const add = (k, f) => {
    if (!k) return;
    if (!keys.has(k)) keys.set(k, new Set());
    keys.get(k).add(f);
  };
  const call = /(?<![\w$.])(?:NeoI18n\.)?tk?\(\s*'((?:[^'\\\n]|\\.)*)'/g;
  for (const f of JS_FILES) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(call)) add(unescapeJs(m[1]), f);
  }
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const tag of html.matchAll(/<(\w+)([^>]*)>([^<]*)/g)) {
    const [, , attrs, text] = tag;
    const attr = (name) => (attrs.match(new RegExp('\\s' + name + '="([^"]*)"')) || [])[1];
    if (/\sdata-i18n(\s|>|$)/.test(attrs + ' ')) add(decodeHtml(text), 'index.html');
    if (/\sdata-i18n-title\b/.test(attrs) && attr('title')) add(decodeHtml(attr('title')), 'index.html');
    if (/\sdata-i18n-placeholder\b/.test(attrs) && attr('placeholder')) add(decodeHtml(attr('placeholder')), 'index.html');
    if (/\sdata-i18n-ph\b/.test(attrs) && attr('data-ph')) add(decodeHtml(attr('data-ph')), 'index.html');
    if (attr('data-i18n-label')) add(decodeHtml(attr('data-i18n-label')), 'index.html');
  }
  return keys;
}

const readLocale = (code) => JSON.parse(fs.readFileSync(path.join(LOCALES, code + '.json'), 'utf8'));

const [cmd, code] = process.argv.slice(2);
const keys = collect();

if (cmd === 'template') {
  const out = { _meta: { name: 'Language name in that language', translators: [] } };
  for (const k of [...keys.keys()].sort((a, b) => a.localeCompare(b))) out[k] = '';
  fs.writeFileSync(path.join(LOCALES, '_template.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`locales/_template.json: ${keys.size} strings`);
} else if (cmd === 'check' && code) {
  // a regional file (fr-CA) only holds what differs from its base (fr)
  const own = readLocale(code);
  const baseCode = code.split('-')[0];
  const regional = baseCode !== code;
  const dict = regional ? { ...readLocale(baseCode), ...own } : own;
  const missing = [...keys.keys()].filter((k) => {
    const v = dict[k];
    return !(typeof v === 'string' ? v : v && typeof v === 'object' && v.other);
  });
  const unused = Object.keys(own).filter((k) => k !== '_meta' && !keys.has(k));
  // every {placeholder} of the English must survive the translation
  const vars = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
  const broken = [...keys.keys()].filter((k) => {
    const v = dict[k];
    if (!v) return false;
    const forms = typeof v === 'string' ? [v] : Object.values(v);
    return forms.some((f) => vars(f).replace(/\{n\},?/g, '') !== vars(k).replace(/\{n\},?/g, ''));
  });
  console.log(`${code}: ${keys.size - missing.length}/${keys.size} translated` +
    (regional ? ` (${Object.keys(own).length - 1} regional, the rest from ${baseCode}.json)` : ''));
  if (missing.length) console.log('\nMissing:\n  ' + missing.join('\n  '));
  if (broken.length) console.log('\nPlaceholders differ from the English:\n  ' + broken.join('\n  '));
  if (unused.length) console.log('\nNo longer used:\n  ' + unused.join('\n  '));
  process.exitCode = missing.length || broken.length ? 1 : 0;
} else {
  console.log('usage: node scripts/i18n.js template | check <code>');
}
