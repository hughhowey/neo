'use strict';

// Dictionaries the writer adds (#280): an .aff and .dic pair, or a
// LibreOffice extension (.oxt) holding them, read into UTF-8 under their
// language, and checked by the same Hunspell helper as NEO's own. Loads
// main.js the way library-folder.test.js does.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const localRequire = createRequire(path.join(root, 'main.js'));
const JSZip = localRequire('jszip');

function loadMain({ spellProcess } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-dictionary-'));
  const userData = path.join(base, 'userData');
  fs.mkdirSync(userData);
  const electron = {
    app: {
      commandLine: { appendSwitch() {} },
      getPath: (name) => (name === 'userData' ? userData : base),
      getLocale: () => 'en',
      requestSingleInstanceLock: () => true,
      whenReady: () => ({ then() {} }),
      on() {}
    },
    ipcMain: { on() {}, handle() {} },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
    dialog: {},
    utilityProcess: { fork: () => spellProcess || ({ on() {}, postMessage() {} }) },
    screen: {}
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: root,
    process: { platform: process.platform, on() {} },
    console,
    TextDecoder,
    Intl,
    Buffer
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: path.join(root, 'main.js') });
  return { base, userData, run: (code) => vm.runInContext(code, context), context };
}

// A small Italian dictionary in ISO-8859-15, as many LibreOffice ones are
const AFF = 'SET ISO8859-15\nTRY aeiouàèéìòù\n\nSFX S Y 1\nSFX S o i o\n';
const DIC = '3\ncittà\nperché\nlibro/S\n';
const latin9 = (s) => Buffer.from(s, 'latin1');

function folderWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-dictionary-files-'));
  for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), data);
  return dir;
}

// the spell helper, run in-process as spellcheck.test.js does
function spellWorker() {
  let handle;
  const waiting = new Map();
  const context = vm.createContext({
    require: localRequire,
    process: { parentPort: { on: (_n, cb) => { handle = cb; }, postMessage: (m) => { const done = waiting.get(m.id); waiting.delete(m.id); if (done) done(m); } } }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'spell-worker.js'), 'utf8'), context, { filename: path.join(root, 'spell-worker.js') });
  let id = 0;
  return (message) => new Promise((resolve) => { const n = ++id; waiting.set(n, resolve); handle({ data: { id: n, ...message } }); });
}

// the spell helper as main.js's own forked process, so addDictionary loads for real
function spellProcess() {
  let handle;
  const listeners = {};
  const context = vm.createContext({
    require: localRequire,
    process: { parentPort: { on: (_n, cb) => { handle = cb; }, postMessage: (message) => listeners.message(message) } }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'spell-worker.js'), 'utf8'), context, { filename: path.join(root, 'spell-worker.js') });
  return { on: (name, callback) => { listeners[name] = callback; }, postMessage: (message) => handle({ data: message }) };
}

// A Chromium .dic_delta: more words in UTF-8, no count line, often with a
// byte order mark and Windows line endings
const EN_AFF = 'SET UTF-8\nSFX S Y 1\nSFX S 0 s .\nSFX D Y 1\nSFX D 0 ed .\n';
const EN_DIC = '2\nwalk/S\ncolour\n';
const EN_DELTA = '\ufeffwalk/D\r\n\r\nNEOword\r\n';

describe('dictionaries the writer adds', () => {
  test('an ISO-8859-15 pair is read into UTF-8, under the language its name gives', async () => {
    const neo = loadMain();
    const dir = folderWith({ 'it_IT.aff': latin9(AFF), 'it_IT.dic': latin9(DIC) });
    neo.context.picked = path.join(dir, 'it_IT.dic');
    const [d] = await neo.run('dictionariesFromFile(picked)');
    assert.equal(d.code, 'it-IT');
    const aff = d.aff.toString();
    assert.match(aff, /^SET UTF-8\nFLAG UTF-8$/m);
    assert.doesNotMatch(aff, /ISO8859/);
    assert.match(aff, /TRY aeiouàèéìòù/);
    assert.equal(d.dic.toString(), DIC);
  });

  test('Hunspell checks the converted dictionary, accents and affixes included', async () => {
    const neo = loadMain();
    neo.context.aff = latin9(AFF);
    neo.context.dic = latin9(DIC);
    const d = neo.run('dictionaryFromPair("it_IT", aff, dic)');
    const dir = folderWith({ 'index.aff': d.aff, 'index.dic': d.dic });
    const send = spellWorker();
    assert.equal((await send({ type: 'load', language: d.code, dir })).ok, true);
    const res = (await send({ type: 'check', words: ['città', 'perché', 'libro', 'libri', 'citta', 'perche'] })).result;
    assert.deepEqual({ ...res }, { città: true, perché: true, libro: true, libri: true, citta: false, perche: false });
    assert.ok((await send({ type: 'suggest', word: 'citta' })).result.includes('città'));
  });

  test('flags, a missing SET, a byte order mark and a UTF-8 .aff with raw bytes all check as Hunspell reads them', async () => {
    const neo = loadMain();
    const checks = async (aff, dic, words) => {
      neo.context.aff = aff;
      neo.context.dic = dic;
      const d = neo.run('dictionaryFromPair("it_IT", aff, dic)');
      const send = spellWorker();
      assert.equal((await send({ type: 'load', language: d.code, dir: folderWith({ 'index.aff': d.aff, 'index.dic': d.dic }) })).ok, true);
      return { ...(await send({ type: 'check', words })).result };
    };
    // é and è as flags share a first byte in UTF-8: each must keep its own rule
    assert.deepEqual(await checks(
      latin9('SET ISO8859-1\nSFX é Y 1\nSFX é o i o\nSFX è Y 1\nSFX è o a o\n'), latin9('2\nlibro/é\ngatto/è\n'),
      ['libri', 'libra', 'gatta', 'gatti']), { libri: true, libra: false, gatta: true, gatti: false });
    // no SET: Hunspell's own default, ISO-8859-1
    assert.deepEqual(await checks(latin9('SFX S Y 1\nSFX S o i o\n'), latin9('2\ncittà\nlibro/S\n'), ['città', 'libri']), { città: true, libri: true });
    // a byte order mark before SET on the first line
    assert.deepEqual(await checks(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), latin9(AFF)]), latin9(DIC), ['perché', 'libri']), { perché: true, libri: true });
    // a UTF-8 .aff whose flag aliases aren't UTF-8 (like the Hungarian one) is kept as it is
    const raw = Buffer.concat([Buffer.from('SET UTF-8\nAF 1\nAF '), Buffer.from([0xd2, 0x53]), Buffer.from('\nSFX S Y 1\nSFX S o i o\n')]);
    assert.deepEqual(await checks(raw, Buffer.from('2\nlibro/1\ncittà\n'), ['libri', 'città']), { libri: true, città: true });
    neo.context.aff = raw;
    assert.ok(neo.run('dictionaryFromPair("hu_HU", aff, Buffer.from("1\\nház\\n")).aff').equals(raw));
  });

  test('the .aff\'s LANG line names the language before the file name does', () => {
    const neo = loadMain();
    neo.context.aff = Buffer.from('SET UTF-8\nLANG pt_PT\n');
    neo.context.dic = Buffer.from('1\nolá\n');
    assert.equal(neo.run('dictionaryFromPair("dicionario", aff, dic).code'), 'pt-PT');
    neo.context.aff = Buffer.from('SET UTF-8\n');
    assert.equal(neo.run('dictionaryFromPair("de_AT_frami", aff, dic).code'), 'de-AT');
    assert.equal(neo.run('dictionaryFromPair("it", aff, dic).code'), 'it');
    // no SET line: UTF-8 is said, so Hunspell doesn't guess
    neo.context.aff = Buffer.from('TRY abc\n');
    assert.match(neo.run('dictionaryFromPair("it", aff, dic).aff.toString()'), /^SET UTF-8\nTRY abc/);
  });

  test('a LibreOffice extension: its dictionary, not its hyphenation or thesaurus', async () => {
    const neo = loadMain();
    const zip = new JSZip();
    zip.file('dictionaries/it_IT.aff', latin9(AFF));
    zip.file('dictionaries/it_IT.dic', latin9(DIC));
    zip.file('dictionaries/hyph_it_IT.dic', 'ISO8859-1\nLEFTHYPHENMIN 2\n');
    zip.file('dictionaries/th_it_IT_v2.dat', 'UTF-8\n');
    zip.file('description.xml', '<description/>');
    const dir = folderWith({ 'dict-it.oxt': await zip.generateAsync({ type: 'nodebuffer' }) });
    neo.context.picked = path.join(dir, 'dict-it.oxt');
    const found = await neo.run('dictionariesFromFile(picked)');
    assert.deepEqual([...found.map((d) => d.code)], ['it-IT']);
    assert.equal(found[0].dic.toString(), DIC);
  });

  test('what isn\'t a dictionary is refused, saying why', async () => {
    const neo = loadMain();
    const refused = async (files, pick) => {
      neo.context.picked = path.join(folderWith(files), pick);
      try { await neo.run('dictionariesFromFile(picked)'); } catch (err) { return err.message; }
      return null;
    };
    assert.equal(await refused({ 'en_US.dic': DIC }, 'en_US.dic'), 'NEO couldn’t find en_US.aff next to en_US.dic. A dictionary is two files with the same name in the same folder, or a single LibreOffice extension (.oxt).');
    assert.match(await refused({ 'en_US.aff': 'SET UTF-8\n' }, 'en_US.aff'), /^NEO couldn’t find en_US\.dic next to en_US\.aff\./);
    assert.match(await refused({ 'notes.txt': 'hello' }, 'notes.txt'), /two files with the same name, one ending \.aff and one \.dic/);
    assert.match(await refused({ 'words.aff': 'SET UTF-8\n', 'words.dic': '1\nciao\n' }, 'words.aff'), /couldn't tell which language/);
    assert.match(await refused({ 'it_IT.aff': 'SET KLINGON-1\n', 'it_IT.dic': '1\nciao\n' }, 'it_IT.aff'), /character set NEO can't read \(KLINGON-1\)/);
    assert.match(await refused({ 'it_IT.aff': 'SET UTF-8\n', 'it_IT.dic': Buffer.from([0x31, 0x0a, 0xff, 0xfe, 0x0a]) }, 'it_IT.dic'), /aren't in the character set it names/);
    assert.match(await refused({ 'it_IT.aff': 'SET UTF-8\n', 'it_IT.dic': 'ciao\n' }, 'it_IT.dic'), /isn't a Hunspell dictionary/);
    const zip = new JSZip();
    zip.file('README.txt', 'hello');
    assert.match(await refused({ 'x.oxt': await zip.generateAsync({ type: 'nodebuffer' }) }, 'x.oxt'), /no spelling dictionary in it/);
  });

  test('an added dictionary is found by its folder, and one named like a bundled language is used instead of it', () => {
    const neo = loadMain();
    const added = path.join(neo.userData, 'dictionaries');
    for (const code of ['it-IT', 'fr']) {
      fs.mkdirSync(path.join(added, code), { recursive: true });
      for (const f of ['index.aff', 'index.dic']) fs.writeFileSync(path.join(added, code, f), 'x');
    }
    fs.mkdirSync(path.join(added, 'half-made'), { recursive: true }); // not a language, nothing in it
    fs.mkdirSync(path.join(added, 'es'), { recursive: true }); // .aff and .dic missing
    assert.deepEqual(Object.keys(neo.run('addedDictionaries()')).sort(), ['fr', 'it-IT']);
    assert.equal(neo.run('spellDir("it-IT")'), path.join(added, 'it-IT'));
    assert.equal(neo.run('spellDir("fr")'), path.join(added, 'fr'));
    assert.equal(neo.run('spellDir("es")'), path.join(root, 'node_modules', 'dictionary-es'));
    assert.equal(neo.run('spellDir("xx")'), null);
    assert.equal(neo.run('languageLabel("it-IT")'), 'Italiano (Italia)');
    assert.equal(neo.run('languageLabel("es")'), 'Español');
  });

  test('Add a Dictionary… says what to pick before the file picker opens', async () => {
    const neo = loadMain();
    const shown = [];
    neo.context.answer = 1; // Cancel
    neo.context.shown = shown;
    neo.run(`dialog.showMessageBox = async (_w, box) => { shown.push(box); return { response: answer }; };
      dialog.showOpenDialog = async () => { shown.push('picker'); return { canceled: true, filePaths: [] }; };`);
    await neo.run('addDictionary()');
    assert.equal(shown.length, 1);
    assert.match(shown[0].detail, /LibreOffice extension \(\.oxt\)/);
    assert.deepEqual([...shown[0].buttons], ['Choose a File…', 'Cancel']);
    neo.context.answer = 0; // Choose a File…
    await neo.run('addDictionary()');
    assert.equal(shown[2], 'picker');
  });

  test('a .dic_delta beside the pair joins the .dic, whichever of the three is picked', async () => {
    const neo = loadMain();
    const dir = folderWith({ 'en_US.aff': EN_AFF, 'en_US.dic': EN_DIC, 'en_US.dic_delta': EN_DELTA });
    for (const picked of ['en_US.aff', 'en_US.dic', 'en_US.dic_delta']) {
      neo.context.picked = path.join(dir, picked);
      const [d] = await neo.run('dictionariesFromFile(picked)');
      assert.equal(d.dic.toString(), '4\nwalk/S\ncolour\nwalk/D\nNEOword\n', picked);
    }
    const [d] = await neo.run('dictionariesFromFile(picked)');
    const send = spellWorker();
    assert.equal((await send({ type: 'load', language: d.code, dir: folderWith({ 'index.aff': d.aff, 'index.dic': d.dic }) })).ok, true);
    // a word in both keeps the flags of both
    const res = (await send({ type: 'check', words: ['walk', 'walks', 'walked', 'NEOword', 'colour', 'colours'] })).result;
    assert.deepEqual({ ...res }, { walk: true, walks: true, walked: true, NEOword: true, colour: true, colours: false });
  });

  test('a .dic_delta: alone, not UTF-8, beside an 8-bit dictionary, inside or beside a LibreOffice extension', async () => {
    const neo = loadMain();
    const read = async (files, pick) => {
      neo.context.picked = path.join(folderWith(files), pick);
      try { return await neo.run('dictionariesFromFile(picked)'); } catch (err) { return err.message; }
    };
    assert.match(await read({ 'en_US.dic_delta': EN_DELTA }, 'en_US.dic_delta'), /^NEO couldn’t find en_US\.aff next to en_US\.dic_delta\./);
    assert.match(await read({ 'en_US.dic': EN_DIC, 'en_US.dic_delta': EN_DELTA }, 'en_US.dic_delta'), /^NEO couldn’t find en_US\.aff next to/);
    // not UTF-8: the dictionary comes in without it, and says which it left out
    const [notUtf8] = await read({ 'en_US.aff': EN_AFF, 'en_US.dic': EN_DIC, 'en_US.dic_delta': latin9('caffè\n') }, 'en_US.aff');
    assert.equal(notUtf8.dic.toString(), EN_DIC);
    assert.deepEqual([...notUtf8.deltasNotUtf8], ['en_US.dic_delta']);
    assert.deepEqual([...notUtf8.deltasBeside], []);
    // the same name, ignoring case and - against _ (Chromium's hu-HU, LibreOffice's hu_HU)
    const [dashed] = await read({ 'en_US.aff': EN_AFF, 'en_US.dic': EN_DIC, 'EN-us.dic_delta': EN_DELTA }, 'EN-us.dic_delta');
    assert.equal(dashed.dic.toString(), '4\nwalk/S\ncolour\nwalk/D\nNEOword\n');
    assert.deepEqual([...dashed.deltasBeside], ['EN-us.dic_delta']);
    const [other] = await read({ 'en_US.aff': EN_AFF, 'en_US.dic': EN_DIC, 'words.dic_delta': EN_DELTA }, 'en_US.aff');
    assert.equal(other.dic.toString(), EN_DIC);
    assert.deepEqual([...other.deltasBeside], []);
    // an 8-bit dictionary's flags, written in the UTF-8 delta, still apply
    const [eight] = await read({ 'it_IT.aff': latin9('SET ISO8859-1\nSFX é Y 1\nSFX é o i o\n'), 'it_IT.dic': latin9('1\nlibro/é\n'), 'it_IT.dic_delta': 'gatto/é\ncittà\n' }, 'it_IT.dic');
    const send = spellWorker();
    assert.equal((await send({ type: 'load', language: eight.code, dir: folderWith({ 'index.aff': eight.aff, 'index.dic': eight.dic }) })).ok, true);
    assert.deepEqual({ ...(await send({ type: 'check', words: ['libri', 'gatti', 'città'] })).result }, { libri: true, gatti: true, città: true });
    const zip = new JSZip();
    zip.file('dictionaries/en_US.aff', EN_AFF);
    zip.file('dictionaries/en_US.dic', EN_DIC);
    zip.file('dictionaries/en_US.dic_delta', EN_DELTA);
    const [packed] = await read({ 'dict-en.oxt': await zip.generateAsync({ type: 'nodebuffer' }) }, 'dict-en.oxt');
    assert.equal(packed.dic.toString(), '4\nwalk/S\ncolour\nwalk/D\nNEOword\n');
    // a delta beside the .oxt, named like the dictionary inside it
    const bare = new JSZip();
    bare.file('dictionaries/en_US.aff', EN_AFF);
    bare.file('dictionaries/en_US.dic', EN_DIC);
    const bareOxt = await bare.generateAsync({ type: 'nodebuffer' });
    const [beside] = await read({ 'dict-en.oxt': bareOxt, 'en_US.dic_delta': EN_DELTA }, 'dict-en.oxt');
    assert.equal(beside.dic.toString(), '4\nwalk/S\ncolour\nwalk/D\nNEOword\n');
    // the delta picked: the .oxt beside it holds its dictionary
    const picked = await read({ 'dict-en.oxt': bareOxt, 'en_US.dic_delta': EN_DELTA }, 'en_US.dic_delta');
    assert.deepEqual([...picked.map((dictionary) => dictionary.code)], ['en-US']);
    assert.equal(picked[0].dic.toString(), '4\nwalk/S\ncolour\nwalk/D\nNEOword\n');
    assert.match(await read({ 'dict-en.oxt': bareOxt, 'fr_FR.dic_delta': EN_DELTA }, 'fr_FR.dic_delta'), /^NEO couldn’t find fr_FR\.aff next to fr_FR\.dic_delta\./);
    // one in another folder of the .oxt, and one beside it: both join
    const both = new JSZip();
    both.file('dictionaries/en_US.aff', EN_AFF);
    both.file('dictionaries/en_US.dic', EN_DIC);
    both.file('extra/en_US.dic_delta', '\ufeffinsideword\n');
    const [joined] = await read({ 'dict-en.oxt': await both.generateAsync({ type: 'nodebuffer' }), 'en_US.dic_delta': '\ufeffbesideword\n' }, 'dict-en.oxt');
    assert.equal(joined.dic.toString(), '4\nwalk/S\ncolour\ninsideword\nbesideword\n');
  });

  test('adding a language again replaces it, delta and all, and its words are checked at once', async () => {
    const neo = loadMain({ spellProcess: spellProcess() });
    neo.context.picks = [];
    neo.run(`dialog.showMessageBox = async () => ({ response: 0 });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picks.shift()] });`);
    const add = async (files) => {
      neo.context.picks.push(path.join(folderWith(files), 'en_US.dic'));
      await neo.run('addDictionary()');
      return { ...(await neo.run('spellRequest({ type: "check", words: ["NEOword", "otherword", "walked"] })')).result };
    };
    const added = path.join(neo.userData, 'dictionaries', 'en-US');
    assert.deepEqual(await add({ 'en_US.aff': EN_AFF, 'en_US.dic': EN_DIC, 'en_US.dic_delta': EN_DELTA }), { NEOword: true, otherword: false, walked: true });
    assert.deepEqual(await add({ 'en_US.aff': EN_AFF, 'en_US.dic': EN_DIC, 'en_US.dic_delta': 'otherword\n' }), { NEOword: false, otherword: true, walked: false });
    assert.deepEqual(await add({ 'en_US.aff': EN_AFF, 'en_US.dic': EN_DIC }), { NEOword: false, otherword: false, walked: false });
    assert.deepEqual(fs.readdirSync(added).sort(), ['index.aff', 'index.dic']);
    assert.equal(fs.readFileSync(path.join(added, 'index.dic'), 'utf8'), EN_DIC);
  });

  test('a .dic_delta left out is named: one that matched no dictionary, with the name it needs, and one not in UTF-8', async () => {
    const neo = loadMain({ spellProcess: spellProcess() });
    neo.context.picks = [];
    neo.context.shown = [];
    neo.run(`dialog.showMessageBox = async (_w, box) => { shown.push(box.message); return { response: 0 }; };
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picks.shift()] });`);
    const add = async (files, pick) => {
      neo.context.shown.length = 0;
      neo.context.picks.push(path.join(folderWith(files), pick));
      await neo.run('addDictionary()');
      return neo.context.shown.slice(1); // after the window that says what to pick
    };
    const bare = new JSZip();
    bare.file('en_US.aff', EN_AFF);
    bare.file('en_US.dic', EN_DIC);
    const oxt = await bare.generateAsync({ type: 'nodebuffer' });
    assert.deepEqual(await add({ 'dict-en.oxt': oxt, 'dict-en.dic_delta': EN_DELTA }, 'dict-en.oxt'), ['dict-en.dic_delta wasn’t used. A .dic_delta joins a dictionary when it’s named like it: en_US.dic_delta.']);
    assert.deepEqual(await add({ 'dict-en.oxt': oxt, 'en-US.dic_delta': EN_DELTA }, 'dict-en.oxt'), []);
    assert.deepEqual(await add({ 'en_US.aff': EN_AFF, 'en_US.dic': EN_DIC }, 'en_US.aff'), []);
    assert.deepEqual(await add({ 'en_US.aff': EN_AFF, 'en_US.dic': EN_DIC, 'en_US.dic_delta': latin9('caffè\n') }, 'en_US.aff'), ['en_US.dic_delta wasn’t used: it isn’t in UTF-8.']);
    assert.equal(fs.readFileSync(path.join(neo.userData, 'dictionaries', 'en-US', 'index.dic'), 'utf8'), EN_DIC);
  });
});
