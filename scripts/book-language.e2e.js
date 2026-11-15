'use strict';

// #520: select through the real language menu, switch books, read metadata
// and export files, and exercise the actual dictionary worker.
const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-book-language-'));
const lib = path.join(tmp, 'NEO Library');
fs.mkdirSync(lib);
app.setPath('documents', tmp);
app.setPath('userData', path.join(tmp, 'app'));
fs.writeFileSync(path.join(lib, 'library.json'), JSON.stringify({ firstRunDone: true, moreFeatures: true, spellLanguage: 'en-US', hintShown: true,
  shelves: [{ id: 's1', name: 'Test', bookIds: [] }] }));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) { return loadFile.call(this, path.resolve(__dirname, '..', file), opts); };
require('../main.js');
let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
async function until(check) {
  const end = Date.now() + 30000;
  while (!(await check())) { if (Date.now() > end) throw new Error('Timed out: ' + check); await tick(); }
}
function item(label, items = Menu.getApplicationMenu().items) {
  for (const candidate of items) {
    if (candidate.label === label) return candidate;
    const found = candidate.submenu && item(label, candidate.submenu.items);
    if (found) return found;
  }
  return null;
}
async function pick(label, code) {
  assert.ok(item(label), label + ' exists');
  item(label).click();
  await until(() => js(`writingLanguage() === ${JSON.stringify(code)}`));
  // The menu message runs asynchronously; metadata is the completed-save gate.
  await until(async () => {
    const id = await js('book && book.id');
    const value = JSON.parse(fs.readFileSync(id ? path.join(lib, id, 'book.json') : path.join(lib, 'library.json'), 'utf8'));
    return id ? (label === 'Use library default' ? value.writingLanguage === undefined : value.writingLanguage === code) : value.spellLanguage === code;
  });
  if (await js('!!book')) await until(() => js(`document.getElementById('chapters').lang === ${JSON.stringify(code)}`));
}
async function main() {
  let failed = false;
  try {
    await app.whenReady();
    await until(async () => BrowserWindow.getAllWindows().length);
    const win = BrowserWindow.getAllWindows()[0];
    wc = win.webContents; win.focus();
    await until(() => js('typeof library !== "undefined" && !!library').catch(() => false));
    await js(`addImportedBooks(['German book', 'Default book'].map((name) => ({ name, title: name, chapters: [{ title: 'The beginning', paras: [{ text: 'The "original" words stay as written.' }] }, { title: 'The end', paras: [{ text: 'The last paragraph.' }] }] })), library.shelves[0])`);
    const ids = await js('library.shelves[0].bookIds');
    const metaFile = (id) => path.join(lib, id, 'book.json');
    const chapters = ids.flatMap((id) => fs.readdirSync(path.join(lib, id, 'chapters')).map((name) => {
      const file = path.join(lib, id, 'chapters', name);
      return [file, fs.readFileSync(file, 'utf8'), fs.statSync(file).mtimeMs];
    }));
    await js(`openBook(${JSON.stringify(ids[0])})`);
    assert.ok(item('This book'));
    await pick('Deutsch', 'de');
    assert.equal(JSON.parse(fs.readFileSync(metaFile(ids[0]), 'utf8')).writingLanguage, 'de');
    assert.equal(JSON.parse(fs.readFileSync(path.join(lib, 'library.json'), 'utf8')).spellLanguage, 'en-US');
    assert.equal(await js('NeoI18n.getLocale()'), 'en');
    assert.ok(item('File') && item('Edit'), 'interface menus remain English');
    assert.equal(await js('chapterName(book.chapterOrder[0])'), 'Kapitel 1');
    assert.equal(await js("document.getElementById('chapters').lang"), 'de');
    assert.equal(await js(`typedQuote('"', '', bookQuotes(), singleQuotes(), () => false)`), '»');
    assert.equal((await js("window.neo.spellCheckWords(['Kartoffel'])")).Kartoffel, true);
    console.log('ok menu choice is saved per book, German headings/quotes/dictionary are active, UI and library default stay English');

    const d = await js('bookExportData()');
    assert.equal(d.language, 'de');
    assert.match(d.sections[0].heading, /Kapitel 1/);
    const docx = await js('buildDocxEntries()');
    assert.match(docx.find((e) => e.path === 'word/document.xml').content, /Kapitel 1/);
    assert.match(JSON.stringify(docx), /w:lang[^>]+de/);
    const epub = await js('buildEpubEntries()');
    assert.match(JSON.stringify(epub), /<dc:language>de<\/dc:language>/);
    assert.match(await js('buildHtml()'), /<html lang="de"/);
    const manuscript = await js('manuscriptModel(manuscriptDefaults(), manuscriptSections())');
    assert.equal(manuscript.lang, 'de');
    assert.match(manuscript.wordsText, /Wörter/);
    console.log('ok Word, EPUB and HTML use the book’s language and generated headings');

    await js(`openBook(${JSON.stringify(ids[1])})`);
    assert.equal(await js('writingLanguage()'), 'en-US');
    assert.equal(await js('chapterName(book.chapterOrder[0])'), 'Chapter 1');
    assert.equal((await js("window.neo.spellCheckWords(['Kartoffel'])")).Kartoffel, false);
    assert.equal(await js(`typedQuote('"', '', bookQuotes(), singleQuotes(), () => false)`), '“');
    await js('backToShelf()');
    const anthology = await js('shelfBookData(library.shelves[0])');
    assert.equal(anthology.language, 'en-US');
    assert.match(JSON.stringify(anthology.sections), /Kapitel 1/);
    assert.match(JSON.stringify(anthology.sections), /Chapter 1/);
    assert.equal((await js("window.neo.spellCheckWords(['Kartoffel'])")).Kartoffel, false, 'preparing export headings does not switch the active dictionary');
    console.log('ok a mixed-language shelf retains each book’s headings and the library’s dictionary');
    await js(`openBook(${JSON.stringify(ids[0])})`);
    assert.equal(await js('writingLanguage()'), 'de');
    assert.equal((await js("window.neo.spellCheckWords(['Kartoffel'])")).Kartoffel, true);
    console.log('ok switching and reopening books restores each dictionary, headings and punctuation');

    await js('backToShelf()');
    assert.ok(item('Library default'));
    await pick('Français', 'fr');
    await js(`openBook(${JSON.stringify(ids[0])})`);
    assert.equal(await js('writingLanguage()'), 'de', 'explicit book setting survives default change');
    await pick('Use library default', 'fr');
    assert.equal(JSON.parse(fs.readFileSync(metaFile(ids[0]), 'utf8')).writingLanguage, undefined);
    assert.equal(await js('chapterName(book.chapterOrder[0])'), 'Chapitre 1');
    await js(`openBook(${JSON.stringify(ids[1])})`);
    assert.equal(await js('writingLanguage()'), 'fr');
    assert.equal(await js('NeoI18n.getLocale()'), 'en');
    console.log('ok inherited books follow the library default; a pinned book can return to inheritance');

    await js('flushAllSaves();');
    await js('saveMeta()');
    const remote = JSON.parse(fs.readFileSync(metaFile(ids[1]), 'utf8'));
    remote.writingLanguage = 'de';
    fs.writeFileSync(metaFile(ids[1]), JSON.stringify(remote));
    await js('refreshFromDisk()');
    assert.equal(await js('writingLanguage()'), 'de');
    assert.equal(await js('chapterName(book.chapterOrder[0])'), 'Kapitel 1');
    assert.equal((await js("window.neo.spellCheckWords(['Kartoffel'])")).Kartoffel, true);
    console.log('ok a book language received from another device updates headings and the checker');

    for (const [file, text, mtime] of chapters) {
      assert.equal(fs.readFileSync(file, 'utf8'), text, 'existing manuscript words never converted');
      assert.equal(fs.statSync(file).mtimeMs, mtime, 'language change does not rewrite chapters');
    }
    await assert.rejects(js("window.neo.writingI18n('../../secrets')"));
    assert.equal(await js("writingLanguage({ writingLanguage: '../../bad' })"), 'fr');
    const languages = await js("(async () => { await Promise.all([window.neo.setSpellLanguage('fr'), window.neo.setSpellLanguage('de')]); return window.neo.spellCheckWords(['Kartoffel']); })()");
    assert.equal(languages.Kartoffel, true, 'the latest dictionary request wins');
    console.log('ok chapters retain text/timestamps, invalid locale paths are rejected, dictionary switches stay ordered');
    await js('spellOn = false; bookDictionaryReady = false; toggleSpellcheck()');
    assert.equal(await js('spellOn'), false, 'a failed dictionary load cannot check the book in the previous language');
    await js('bookDictionaryReady = true');
    const beforeFailure = fs.readFileSync(metaFile(ids[1]), 'utf8');
    ipcMain.removeHandler('book:writeMeta');
    ipcMain.handle('book:writeMeta', () => { throw new Error('simulated metadata failure'); });
    await assert.rejects(js("changeSpellLanguage('fr')"), /simulated metadata failure/);
    assert.equal(await js('book.writingLanguage'), 'de');
    assert.equal((await js("window.neo.spellCheckWords(['Kartoffel'])")).Kartoffel, true);
    assert.equal(fs.readFileSync(metaFile(ids[1]), 'utf8'), beforeFailure);
    console.log('ok a failed metadata save restores both the book setting and its dictionary');
  } catch (err) { failed = true; console.error(err); }
  finally { app.exit(failed ? 1 : 0); }
}
main();
