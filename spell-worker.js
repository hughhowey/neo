// NEO's spellchecker, in its own process. main.js forks this with
// Electron's utilityProcess and talks to it with plain messages: load,
// check, suggest, add.
//
// The engine is Hunspell itself (the checker LibreOffice uses), compiled to
// WebAssembly. It reads the same .aff/.dic files as-is and applies the affix
// rules on lookup instead of expanding every word form into memory up front,
// so even the big dictionaries (French, Portuguese) load in well under a
// second. See notices/hunspell for its license and source.
'use strict';

const fs = require('fs');
const path = require('path');
const { loadModule } = require('@farscrl/hunspell-wasm');
const { normalizeRomanianWord } = require('./spell-ro');

let factory = null;       // the WebAssembly module, loaded once
let spell = null;         // { hunspell, files } for the current language
let normalizeWord = (word) => word;
let mounts = 0;

function reply(msg, extra) {
  process.parentPort.postMessage({ id: msg.id, ...extra });
}

function correct(word) {
  if (!spell || !word) return true;
  return spell.hunspell.spell(normalizeWord(word));
}

async function load(msg) {
  if (!factory) factory = await loadModule();
  const aff = fs.readFileSync(path.join(msg.dir, 'index.aff'));
  const dic = fs.readFileSync(path.join(msg.dir, 'index.dic'));
  const romanian = msg.language === 'ro';
  const normalize = romanian ? normalizeRomanianWord : (word) => word;
  const n = ++mounts;
  const files = [
    factory.mountBuffer(aff, `neo-${n}.aff`),
    factory.mountBuffer(dic, `neo-${n}.dic`)
  ];
  let hunspell;
  try {
    hunspell = factory.create(files[0], files[1]);
  } catch (err) {
    for (const f of files) { try { factory.unmount(f); } catch { /* gone */ } }
    throw err;
  }
  for (const w of msg.custom || []) {
    if (typeof w === 'string' && w) hunspell.addWord(normalize(w));
  }
  // only now let go of the previous language: a failed load keeps it
  const old = spell;
  spell = { hunspell, files };
  normalizeWord = normalize;
  if (old) {
    try { old.hunspell.dispose(); } catch { /* freed */ }
    for (const f of old.files) { try { factory.unmount(f); } catch { /* gone */ } }
  }
}

async function handle(msg) {
  try {
    if (msg.type === 'load') {
      await load(msg);
      reply(msg, { ok: true });
    } else if (msg.type === 'check') {
      const out = {};
      // dictionary still loading: report everything correct rather than crying wolf
      for (const w of msg.words || []) out[w] = correct(w);
      reply(msg, { ok: true, result: out });
    } else if (msg.type === 'suggest') {
      reply(msg, { ok: true, result: spell && msg.word ? spell.hunspell.suggest(normalizeWord(msg.word)).slice(0, 6) : [] });
    } else if (msg.type === 'add') {
      if (spell && typeof msg.word === 'string' && msg.word) spell.hunspell.addWord(normalizeWord(msg.word));
      reply(msg, { ok: true });
    } else {
      reply(msg, { ok: false, error: 'unknown message' });
    }
  } catch (err) {
    reply(msg, { ok: false, error: String(err && err.stack || err) });
  }
}

// One message at a time, in the order they came: a check sent after a load
// is answered by the new dictionary, never by a half-loaded one.
let queue = Promise.resolve();
process.parentPort.on('message', (e) => {
  const msg = e.data || {};
  queue = queue.then(() => handle(msg));
});
