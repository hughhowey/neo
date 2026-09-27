'use strict';

const path = require('path');
const { parentPort } = require('node:worker_threads');
const nspell = require('nspell');
const { getSpellDictionaryConfig } = require('./interface-language');

let spellCheckDocumentPromise;
let queue = Promise.resolve();
const learnedWords = new Set();
const hunspellInstances = new Map();
const hunspellPackages = {
  'en-US': 'dictionary-en-us',
  'en-GB': 'dictionary-en-gb',
  'en-CA': 'dictionary-en-ca',
  'en-AU': 'dictionary-en-au',
  fr: 'dictionary-fr',
  es: 'dictionary-es',
  de: 'dictionary-de'
};

function loadHunspell(locale) {
  const key = hunspellPackages[locale] ? locale : 'en-US';
  if (hunspellInstances.has(key)) return Promise.resolve(hunspellInstances.get(key));
  return import(hunspellPackages[key]).then((module) => new Promise((resolve, reject) => {
    const loadDictionary = module.default || module;
    const createSpell = (dictionary) => {
      const spell = nspell(dictionary);
      for (const word of learnedWords) spell.add(word);
      hunspellInstances.set(key, spell);
      resolve(spell);
    };
    if (typeof loadDictionary !== 'function') {
      createSpell(loadDictionary);
      return;
    }
    loadDictionary((err, dictionary) => {
      if (err) { reject(err); return; }
      createSpell(dictionary);
    });
  }));
}

async function spellCheck(text, locale, suggestions = false) {
  const config = getSpellDictionaryConfig(locale);
  if (config.locale !== 'pt-BR') {
    const spell = await loadHunspell(locale);
    return suggestions
      ? spell.suggest(text).slice(0, 6)
      : spell.correct(text);
  }

  spellCheckDocumentPromise ||= import('cspell-lib').then((cspell) => cspell.spellCheckDocument);
  const spellCheckDocument = await spellCheckDocumentPromise;
  const language = 'pt, pt_BR';
  const result = await spellCheckDocument(
    { uri: 'neo-spellcheck.txt', text, languageId: 'plaintext', locale: language },
    { noConfigSearch: true, generateSuggestions: suggestions },
    {
      language,
      words: [...learnedWords],
      dictionaries: ['pt-br'],
      dictionaryDefinitions: [{
        name: 'pt-br',
        path: path.join(__dirname, config.trie),
        description: 'Dicionário VERO de Português do Brasil'
      }]
    }
  );

  if (result.dictionaryErrors && result.dictionaryErrors.size) {
    const errors = [...result.dictionaryErrors.values()].flat().map((err) => err.message);
    throw new Error(errors.join('; ') || 'Could not load spell dictionary');
  }

  return result.issues;
}

async function handle(message) {
  for (const word of message.customWords || message.custom || []) {
    if (typeof word === 'string') learnedWords.add(word.toLowerCase());
  }

  if (message.action === 'check') {
    const words = Array.isArray(message.words) ? message.words : [];
    if (getSpellDictionaryConfig(message.locale).locale !== 'pt-BR') {
      const spell = await loadHunspell(message.locale);
      return Object.fromEntries(words.map((word) => [word, spell.correct(String(word))]));
    }
    const issues = await spellCheck(words.join('\n'), message.locale);
    const incorrect = new Set(issues.map((issue) => String(issue.text).toLowerCase()));
    return Object.fromEntries(words.map((word) => [word, !incorrect.has(String(word).toLowerCase())]));
  }

  if (message.action === 'suggest') {
    if (getSpellDictionaryConfig(message.locale).locale !== 'pt-BR') {
      const spell = await loadHunspell(message.locale);
      return spell.suggest(String(message.word || '')).slice(0, 6);
    }
    const issues = await spellCheck(String(message.word || ''), message.locale, true);
    return issues[0] ? (issues[0].suggestions || []).slice(0, 6) : [];
  }

  if (message.action === 'learn') {
    const word = String(message.word || '').toLowerCase();
    learnedWords.add(word);
    for (const spell of hunspellInstances.values()) spell.add(word);
    return true;
  }

  throw new Error(`Unknown spell action: ${message.action}`);
}

parentPort.on('message', (message) => {
  queue = queue.then(async () => {
    try {
      const result = await handle(message);
      parentPort.postMessage({ id: message.id, result });
    } catch (err) {
      parentPort.postMessage({ id: message.id, error: err.message || String(err) });
    }
  });
});
