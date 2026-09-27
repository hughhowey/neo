'use strict';

const fs = require('fs');
const path = require('path');
const { parentPort } = require('node:worker_threads');
const nspell = require('nspell');
const { getSpellDictionaryConfig } = require('./interface-language');

let spell = null;
let spellCheckDocumentPromise;
let queue = Promise.resolve();
const learnedWords = new Set();

async function spellCheck(text, locale, suggestions = false) {
  spellCheckDocumentPromise ||= import('cspell-lib').then((cspell) => cspell.spellCheckDocument);
  const spellCheckDocument = await spellCheckDocumentPromise;
  const config = getSpellDictionaryConfig(locale);
  const isPortuguese = config.locale === 'pt-BR';
  const language = isPortuguese ? 'pt, pt_BR' : 'en-US';
  const result = await spellCheckDocument(
    { uri: 'neo-spellcheck.txt', text, languageId: 'plaintext', locale: language },
    { noConfigSearch: true, generateSuggestions: suggestions },
    {
      language,
      words: [...learnedWords],
      ...(isPortuguese ? {
        dictionaries: ['pt-br'],
        dictionaryDefinitions: [{
          name: 'pt-br',
          path: path.join(__dirname, config.trie),
          description: 'Dicionário VERO de Português do Brasil'
        }]
      } : {})
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

  if (message.action === 'load' || message.type === 'load') {
    const dir = message.dir || path.join(__dirname, 'node_modules', 'dictionary-en-us');
    const dict = {
      aff: fs.readFileSync(path.join(dir, 'index.aff')),
      dic: fs.readFileSync(path.join(dir, 'index.dic'))
    };
    const next = nspell(dict);
    for (const w of message.custom || message.customWords || []) next.add(w);
    spell = next;
    return true;
  }

  if (message.action === 'check' || message.type === 'check') {
    const words = Array.isArray(message.words) ? message.words : [];
    if (message.type === 'check') {
      const out = {};
      for (const word of words) out[word] = spell ? spell.correct(word) : true;
      return out;
    }

    const issues = await spellCheck(words.join('\n'), message.locale);
    const incorrect = new Set(issues.map((issue) => String(issue.text).toLowerCase()));
    return Object.fromEntries(words.map((word) => [word, !incorrect.has(String(word).toLowerCase())]));
  }

  if (message.action === 'suggest' || message.type === 'suggest') {
    if (message.type === 'suggest') {
      return spell ? spell.suggest(message.word).slice(0, 6) : [];
    }
    const issues = await spellCheck(String(message.word || ''), message.locale, true);
    return issues[0] ? (issues[0].suggestions || []).slice(0, 6) : [];
  }

  if (message.action === 'learn' || message.type === 'add') {
    if (message.type === 'add') {
      if (spell && typeof message.word === 'string') spell.add(message.word);
      return true;
    }
    learnedWords.add(String(message.word || '').toLowerCase());
    return true;
  }

  throw new Error(`Unknown spell action: ${message.action || message.type}`);
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
