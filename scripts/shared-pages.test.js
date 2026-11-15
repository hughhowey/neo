'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
function room() {
  const ctx = vm.createContext({
    library: { authors: [{ id: 'a1', name: 'First' }, { id: 'a2', name: 'Second' }], currentAuthorId: 'a2',
      shelves: [{ id: 's1', bookIds: ['b1'] }, { id: 's2', authorId: 'a2', bookIds: ['b2'] }] },
    escHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    // The real paragraph parser and all builders are exercised in the
    // Electron suite; here only the shared-page model and saving rules run.
    parasFromHtml: (html) => html ? [{ html }] : [],
    kindName: (kind) => kind === 'about' ? 'About the Author' : 'Copyright',
    t: (s) => s,
    refreshFromDisk: async () => {},
    writeLibrary: async () => {}
  });
  vm.runInContext(source.slice(source.indexOf('const SHARED_PAGE_KINDS'), source.indexOf('function sharedPagesDialog(')), ctx);
  return ctx;
}
const data = () => ({ title: 'The Book', author: 'First', contents: true, contentsChapters: true,
  sections: [{ kind: 'chapter', num: 1, heading: 'Chapter 1', paras: [{ text: 'Story.' }] }],
  toc: [{ label: 'Chapter 1', num: 1, level: 0, type: 'chapter' }] });

test('shared pages follow shelf ownership rather than the selected pen name', () => {
  const ctx = room();
  assert.equal(ctx.bookPageAuthor({ id: 'b1' }).id, 'a1');
  assert.equal(ctx.bookPageAuthor({ id: 'b2' }).id, 'a2');
  assert.equal(ctx.bookPageAuthor({ id: 'unknown' }), null);
  assert.equal(ctx.bookPageAuthor({}, { authorId: 'a2' }).id, 'a2');
});

test('a library without shared pages exports the same model', () => {
  const ctx = room(), original = data();
  assert.equal(ctx.withSharedBookPages(original, ctx.library.authors[0]), original);
  assert.equal(ctx.withSharedBookPages(original, null), original);
});

test('copyright opens the export, biography ends it, and contents numbers follow both', () => {
  const ctx = room(), original = data();
  const before = plain(original);
  const out = ctx.withSharedBookPages(original, { sharedPages: { copyright: 'Copyright notice', about: 'Biography' } });
  assert.deepEqual(plain(out.sections.map((s) => [s.kind, s.num])), [['copyright', 1], ['chapter', 2], ['about', 3]]);
  assert.equal(out.sections[0].front, true);
  assert.equal(out.sections[2].front, false);
  assert.deepEqual(plain(out.toc.map((s) => [s.type, s.num])), [['chapter', 2], ['page', 3]]);
  assert.deepEqual(original, before, 'the original export model is not modified');
  assert.equal(out.contents, true);
});

test('a book page, even blank, overrides the corresponding shared page', () => {
  const ctx = room(), original = data();
  const author = { sharedPages: { copyright: 'Shared notice', about: 'Shared biography' } };
  assert.equal(ctx.withSharedBookPages(original, author, ['copyright', 'about']), original);
  original.sections.push({ kind: 'about', num: 2, paras: [{ text: 'My biography' }] });
  const out = ctx.withSharedBookPages(original, author);
  assert.equal(out.sections.filter((s) => s.kind === 'about').length, 1);
  assert.equal(out.sections.at(-1).paras[0].text, 'My biography');
});

test('blank shared text adds no page or contents entry', () => {
  const ctx = room(), original = data();
  assert.equal(ctx.withSharedBookPages(original, { sharedPages: { copyright: '  \n', about: '' } }), original);
});

test('placeholders are filled once, escaped as text, and line breaks are retained', () => {
  const ctx = room();
  const html = ctx.sharedPageHtml('{title}\nby {author}\n\nCopyright {year} <script>\n{unknown}', { title: '{author} & Sea', author: 'A < B' });
  assert.equal(html, '<p>{author} &amp; Sea<br>by A &lt; B</p><p>Copyright ' + new Date().getFullYear() + ' &lt;script&gt;<br>{unknown}</p>');
});

test('saving updates just this pen name and keeps previous wording recoverable', async () => {
  const ctx = room();
  ctx.library.authors[0].sharedPages = { about: 'Old biography' };
  const expected = JSON.stringify(ctx.library.authors[0].sharedPages);
  let written;
  ctx.writeLibrary = async (lib) => { written = plain(lib); };
  await ctx.keepSharedPages('a1', { about: 'New biography', copyright: '' }, expected);
  assert.equal(written.authors[0].sharedPages.about, 'New biography');
  assert.equal(written.authors[0].sharedPagesHistory[0].pages.about, 'Old biography');
  assert.equal(written.authors[1].sharedPages, undefined);
});

test('a failed save leaves the previous library in use and propagates the error', async () => {
  const ctx = room(), original = ctx.library;
  ctx.writeLibrary = async () => { throw new Error('disk full'); };
  await assert.rejects(ctx.keepSharedPages('a1', { about: 'New text' }, '{}'), /disk full/);
  assert.equal(ctx.library, original);
  assert.equal(ctx.library.authors[0].sharedPages, undefined);
});

test('an edit read from another device is not overwritten by an older dialog', async () => {
  const ctx = room();
  ctx.refreshFromDisk = async () => { ctx.library.authors[0].sharedPages = { about: 'Other device' }; };
  await assert.rejects(ctx.keepSharedPages('a1', { about: 'Older dialog' }, '{}'), /changed/);
  assert.equal(ctx.library.authors[0].sharedPages.about, 'Other device');
});

test('saving unchanged fields does not write the library or add history', async () => {
  const ctx = room();
  ctx.library.authors[0].sharedPages = { copyright: '', about: 'Same text' };
  ctx.writeLibrary = async () => { throw new Error('unnecessary write'); };
  await ctx.keepSharedPages('a1', { copyright: '', about: 'Same text' }, JSON.stringify(ctx.library.authors[0].sharedPages));
  assert.equal(ctx.library.authors[0].sharedPagesHistory, undefined);
});

test('removing a pen name keeps its shared wording in the remaining name’s history', () => {
  const ctx = room();
  const from = { name: 'Old name', sharedPages: { about: 'Current biography' }, sharedPagesHistory: [{ at: '2026-01-01', pages: { about: 'Earlier biography' } }] };
  const into = { sharedPages: { about: 'Other name’s biography' } };
  ctx.archiveSharedPages(from, into);
  assert.equal(into.sharedPages.about, 'Other name’s biography');
  assert.deepEqual(plain(into.sharedPagesHistory.map((e) => e.pages.about)), ['Earlier biography', 'Current biography']);
  assert.equal(into.sharedPagesHistory[1].name, 'Old name');
});
