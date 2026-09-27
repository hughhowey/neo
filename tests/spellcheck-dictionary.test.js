const assert = require('node:assert/strict');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

function request(worker, id, action, locale, data = {}) {
  return new Promise((resolve, reject) => {
    const onMessage = (message) => {
      if (message.id !== id) return;
      worker.off('message', onMessage);
      if (message.error) reject(new Error(message.error));
      else resolve(message.result);
    };
    worker.on('message', onMessage);
    worker.postMessage({ id, action, locale, ...data });
  });
}

async function run() {
  const { spellCheckDocument } = await import('cspell-lib');
  const dictionaryResult = await spellCheckDocument(
    {
      uri: 'spellcheck-dictionary-test.txt',
      text: 'biblioteca português capítulo tradução bibliotca',
      languageId: 'plaintext',
      locale: 'pt, pt_BR'
    },
    { noConfigSearch: true, generateSuggestions: true },
    {
      language: 'pt, pt_BR',
      dictionaries: ['pt-br'],
      dictionaryDefinitions: [{
        name: 'pt-br',
        path: path.join(__dirname, '..', 'dict', 'pt_BR.trie.gz')
      }]
    }
  );
  assert.deepEqual(dictionaryResult.issues.map((issue) => issue.text), ['bibliotca']);
  assert.ok(dictionaryResult.issues[0].suggestions.includes('biblioteca'));

  const worker = new Worker(path.join(__dirname, '..', 'spell-worker.js'));
  try {
    const portuguese = await request(worker, 1, 'check', 'pt-BR', {
      words: ['teste', 'biblioteca', 'português', 'capítulo', 'tradução', 'bibliotca', 'wait']
    });
    assert.deepEqual(portuguese, {
      teste: true,
      biblioteca: true,
      português: true,
      capítulo: true,
      tradução: true,
      bibliotca: false,
      wait: false
    });

    const suggestions = await request(worker, 2, 'suggest', 'pt-BR', { word: 'bibliotca' });
    assert.ok(suggestions.includes('biblioteca'));

    const english = await request(worker, 3, 'check', 'en', {
      words: ['the', 'writer', 'biblioteca']
    });
    assert.deepEqual(english, { the: true, writer: true, biblioteca: false });

    const localeWords = [
      ['en-GB', 'colour'],
      ['en-CA', 'colour'],
      ['en-AU', 'colour'],
      ['fr', 'bonjour'],
      ['es', 'hola'],
      ['de', 'hallo']
    ];
    for (const [index, [locale, word]] of localeWords.entries()) {
      const checked = await request(worker, index + 4, 'check', locale, { words: [word] });
      assert.deepEqual(checked, { [word]: true }, `${locale} should accept ${word}`);
    }

    await request(worker, 10, 'learn', 'pt-BR', { word: 'meuNeologismo' });
    const learned = await request(worker, 11, 'check', 'pt-BR', { words: ['meuNeologismo'] });
    assert.deepEqual(learned, { meuNeologismo: true });
    console.log('spellcheck dictionary tests passed');
  } finally {
    await worker.terminate();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});