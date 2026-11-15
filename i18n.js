// NEO — interface translations
//
// One tiny helper shared by the main process (require) and the window
// (window.NeoI18n). The English text itself is the key, so the code stays
// readable and a missing translation simply shows the English original:
//
//   t('Sprint complete — {n} words. Well earned.', { n: 1200 })
//
// A language is one file, locales/<code>.json, mapping each English string
// to its translation. Plural-sensitive strings may map to an object keyed by
// Intl.PluralRules categories ("one", "few", "many", "other"…), chosen by
// the {n} variable:
//
//   "{n} words": { "one": "{n} mot", "other": "{n} mots" }
//
// "_meta" in each file gives the language's own name for the Language menu.
// Numbers passed as variables are formatted for the language (1 200 in
// French, 1,200 in English). Pass a string to keep a number raw.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoI18n = api;
})(typeof self !== 'undefined' ? self : this, function createI18n() {
  let locale = 'en';
  let dict = {};      // the chosen language
  let base = {};      // locales/en.json: English plurals and overrides
  let plural = new Intl.PluralRules('en');
  let numFmt = new Intl.NumberFormat('en');

  function setLocale(code, translations, english) {
    locale = code || 'en';
    dict = translations || {};
    base = english || {};
    try { plural = new Intl.PluralRules(locale); } catch { plural = new Intl.PluralRules('en'); }
    try { numFmt = new Intl.NumberFormat(locale); } catch { numFmt = new Intl.NumberFormat('en'); }
  }

  function pick(entry, vars) {
    if (entry && typeof entry === 'object') {
      const n = vars && typeof vars.n === 'number' ? vars.n : 0;
      return entry[plural.select(n)] || entry.other || null;
    }
    return typeof entry === 'string' && entry ? entry : null;
  }

  function fill(str, vars) {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, (m, k) => {
      if (!(k in vars)) return m;
      const v = vars[k];
      return typeof v === 'number' ? numFmt.format(v) : String(v);
    });
  }

  function t(key, vars) {
    let str = pick(dict[key], vars);
    if (str == null) {
      // English plurals live in en.json; the key is the last word
      const savedPlural = plural;
      if (locale !== 'en') plural = new Intl.PluralRules('en');
      str = pick(base[key], vars);
      plural = savedPlural;
    }
    if (str == null) str = key;
    return fill(str, vars);
  }

  const fmtNum = (n) => numFmt.format(n || 0);
  const fmtDate = (d, opts) => new Date(d).toLocaleDateString(locale, opts);
  const getLocale = () => locale;

  return { setLocale, t, fmtNum, fmtDate, getLocale, create: createI18n };
});
