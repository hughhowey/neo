// NEO i18n — shared by main and preload.
// Drop a new locales/<code>.json file to add a language; resolveLocale()
// picks the best match from the system tag (zh-CN → zh, en-US → en, …).

'use strict';

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, 'locales');
const FALLBACK = 'en';

let currentLocale = FALLBACK;
let catalog = {};
let fallbackCatalog = {};

function listLocales() {
  try {
    return fs.readdirSync(LOCALES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
  } catch {
    return [FALLBACK];
  }
}

function loadCatalog(code) {
  const file = path.join(LOCALES_DIR, code + '.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Map BCP-47 / Electron locale tags onto a catalog we ship. */
function resolveLocale(tag) {
  const available = new Set(listLocales());
  if (!available.size) return FALLBACK;
  const raw = String(tag || FALLBACK).toLowerCase().replace(/_/g, '-');
  if (available.has(raw)) return raw;
  const lang = raw.split('-')[0];
  if (available.has(lang)) return lang;
  // zh-Hans / zh-Hant / zh-TW / zh-HK → zh when we only ship one Chinese pack
  if (lang === 'zh' && available.has('zh')) return 'zh';
  return available.has(FALLBACK) ? FALLBACK : [...available][0];
}

/** Prefer an explicit UI preference ('en' / 'zh'); 'system' or empty follows the OS. */
function resolveUiLocale(pref, systemTag) {
  const p = String(pref || 'system').toLowerCase();
  if (p && p !== 'system') return resolveLocale(p);
  return resolveLocale(systemTag);
}

function init(systemTag) {
  fallbackCatalog = loadCatalog(FALLBACK) || {};
  currentLocale = resolveLocale(systemTag);
  catalog = currentLocale === FALLBACK
    ? fallbackCatalog
    : (loadCatalog(currentLocale) || fallbackCatalog);
  return currentLocale;
}

function get(obj, key) {
  return key.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : undefined), obj);
}

/**
 * Translate a dotted key. Optional vars: t('toast.coverSet', { title: '…' })
 * Placeholders use {name} syntax. Missing keys fall back to English, then the key.
 */
function t(key, vars) {
  let str = get(catalog, key);
  if (str == null) str = get(fallbackCatalog, key);
  if (str == null) str = key;
  if (typeof str !== 'string') return String(str);
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, name) =>
    (vars[name] != null ? String(vars[name]) : '{' + name + '}'));
}

function locale() {
  return currentLocale;
}

function is(code) {
  return currentLocale === code || currentLocale.startsWith(code + '-');
}

/** Snapshot for the sandboxed preload (no local require allowed there). */
function bootstrap(platform) {
  return {
    locale: currentLocale,
    catalog,
    fallback: fallbackCatalog,
    bodyFontNames: bodyFontNames(platform),
    defaultBodyFont: defaultBodyFont(platform),
    locales: listLocales()
  };
}

/** Body fonts for Format menu / first-run.
 *  English locales keep the original western-only menu (zero behavior change).
 *  Chinese locales lead with CJK system faces suited to long-form typing. */
function bodyFontNames(platform) {
  const isMac = platform === 'darwin';
  const western = isMac
    ? ['Georgia', 'Palatino', 'Baskerville', 'Hoefler Text', 'Iowan Old Style']
    : ['Georgia', 'Palatino', 'Baskerville', 'Cambria', 'Constantia'];
  if (!is('zh')) return western;
  const cjk = isMac
    ? ['Songti SC', 'Kaiti SC', 'PingFang SC']
    : ['SimSun', 'KaiTi', 'Microsoft YaHei'];
  return cjk.concat(western);
}

function defaultBodyFont(platform) {
  return bodyFontNames(platform)[0];
}

module.exports = {
  init,
  t,
  locale,
  is,
  resolveLocale,
  resolveUiLocale,
  listLocales,
  bodyFontNames,
  defaultBodyFont,
  bootstrap,
  FALLBACK
};
