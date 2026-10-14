'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// spPaste, runHtml and paraRuns from app.js, run with the few DOM pieces they
// touch replaced by stubs for flat pasted lines (<p class="sp-...">text</p>)
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const between = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

function setup() {
  const inserted = [];
  const textNode = (text) => ({ nodeType: 3, textContent: text, data: text });
  const context = vm.createContext({
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    NodeFilter: { SHOW_TEXT: 4 },
    DOMParser: class {
      parseFromString(html) {
        const ps = [...html.matchAll(/<p(?: class="([^"]*)")?>(.*?)<\/p>/g)].map((m) => ({
          classList: { contains: (c) => (m[1] || '').split(' ').includes(c) },
          innerHTML: m[2]
        }));
        return { body: { querySelectorAll: () => ps } };
      }
    },
    document: {
      createElement: () => {
        const holder = { content: { childNodes: [] } };
        Object.defineProperty(holder, 'innerHTML', { get: () => '', set: (h) => { holder.content.childNodes = [textNode(h)]; } });
        return holder;
      },
      createTreeWalker: (block) => {
        const nodes = [...block.childNodes];
        return { nextNode: () => nodes.shift() || null };
      },
      execCommand: (_cmd, _ui, html) => { inserted.push(html); }
    },
    stripJunkSpans() {}, syncChapter() {}, spSchedule() {}
  });
  vm.runInContext(between('const SP_TYPES', '\n') + '\n' + between('function spType(', 'function spSetClass('), context);
  vm.runInContext(between('const escHtml', '\n') + '\n' + between('function runHtml(', '// A no-break space'), context);
  vm.runInContext(between('function healStrayNbsp(', '/* ---------- DOCX'), context);
  vm.runInContext(between('function spPaste(', '// Lines joined by a delete'), context);
  vm.runInContext('this.api = { spPaste };', context);
  return { spPaste: context.api.spPaste, inserted };
}

// the lines of an insertHTML string, as [type, text]
const linesOf = (html) => [...html.matchAll(/<p(?: class="sp-(\w+)")?[^>]*>(.*?)<\/p>/g)]
  .map((m) => [m[1] || 'action', m[2].replace(/<[^>]*>/g, '')]);

test('pasting screenplay-classed HTML into a script gives typed screenplay lines and throws nothing', () => {
  const { spPaste, inserted } = setup();
  const html = '<p class="sp-character">ANNA</p><p class="sp-dialogue">Hello there.</p><p>She leaves.</p>';
  let prevented = false;
  const e = {
    clipboardData: { getData: (type) => (type === 'text/html' ? html : '') },
    preventDefault() { prevented = true; }
  };
  const body = { querySelector: () => null, querySelectorAll: () => [] };
  assert.equal(spPaste(e, body, 'ch-test'), true);
  assert.ok(prevented, 'the paste is taken over, so the browser does not paste it a second time');
  assert.equal(inserted.length, 1);
  assert.deepEqual(linesOf(inserted[0]), [['character', 'ANNA'], ['dialogue', 'Hello there.'], ['action', 'She leaves.']]);
});
