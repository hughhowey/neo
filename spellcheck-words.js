'use strict';

(function exposeSpellWords(root) {
  const api = {
    normalize(word) {
      return String(word)
        .replace(/’/g, "'")
        .replace(/^'+|'+$/g, '')
        .normalize('NFC')
        .toLowerCase();
    },
    wordPattern() {
      return /[\p{L}\p{M}'’]+/gu;
    },
    isAllCaps(word) {
      return /^[\p{Lu}\p{M}'’]+$/u.test(word);
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NeoSpellWords = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);