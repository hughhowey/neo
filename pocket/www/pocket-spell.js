/* NEO Pocket's spellchecker: the same Hunspell and the same dictionaries
   as desktop NEO (spell-worker.js there), in a web worker so the page never
   waits on a dictionary. scripts/pocket-www.js puts Hunspell's browser build
   in hunspell/ and the dictionaries in dict/<code>/.

   Messages, answered in the order they come: load { language, custom },
   check { words }, suggest { word }, add { word }. */

import { loadModule } from './hunspell/index.js';

let factory = null;
let spell = null; // { hunspell, files, language }
let normalizeWord = (word) => word;
let mounts = 0;

// Romanian: accept the old cedilla letters and decomposed accents
// (spell-ro.js on desktop)
const romanian = (word) => word.normalize('NFC').replace(/[şţŞŢ]/g, (c) =>
  ({ 'ş': 'ș', 'ţ': 'ț', 'Ş': 'Ș', 'Ţ': 'Ț' })[c]);

async function bytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ': ' + res.status);
  return new Uint8Array(await res.arrayBuffer());
}

async function load(msg) {
  if (!factory) factory = await loadModule();
  const dir = new URL('./dict/' + encodeURIComponent(msg.language) + '/', import.meta.url);
  const [aff, dic] = await Promise.all([bytes(new URL('index.aff', dir)), bytes(new URL('index.dic', dir))]);
  const normalize = msg.language === 'ro' ? romanian : (word) => word;
  const n = ++mounts;
  const files = [factory.mountBuffer(aff, `neo-${n}.aff`), factory.mountBuffer(dic, `neo-${n}.dic`)];
  let hunspell;
  try {
    hunspell = factory.create(files[0], files[1]);
  } catch (err) {
    for (const f of files) { try { factory.unmount(f); } catch { /* gone */ } }
    throw err;
  }
  for (const w of msg.custom || []) if (typeof w === 'string' && w) hunspell.addWord(normalize(w));
  // let go of the old language only once the new one is in
  const old = spell;
  spell = { hunspell, files, language: msg.language };
  normalizeWord = normalize;
  if (old) {
    try { old.hunspell.dispose(); } catch { /* freed */ }
    for (const f of old.files) { try { factory.unmount(f); } catch { /* gone */ } }
  }
}

export async function handle(msg) {
  try {
    if (msg.type === 'load') {
      await load(msg);
      return { ok: true };
    }
    if (msg.type === 'check') {
      const out = {};
      for (const w of msg.words || []) out[w] = !spell || !w ? true : spell.hunspell.spell(normalizeWord(w));
      return { ok: true, result: out };
    }
    if (msg.type === 'suggest') {
      return { ok: true, result: spell && msg.word ? spell.hunspell.suggest(normalizeWord(msg.word)).slice(0, 6) : [] };
    }
    if (msg.type === 'add') {
      if (spell && typeof msg.word === 'string' && msg.word) spell.hunspell.addWord(normalizeWord(msg.word));
      return { ok: true };
    }
    return { ok: false, error: 'unknown message' };
  } catch (err) {
    return { ok: false, error: String(err && err.stack || err) };
  }
}

// As a worker: one message at a time, in order, so a check sent after a
// load is answered by the new dictionary
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  let queue = Promise.resolve();
  self.onmessage = (e) => {
    const msg = e.data || {};
    queue = queue.then(async () => self.postMessage({ id: msg.id, ...(await handle(msg)) }));
  };
}
