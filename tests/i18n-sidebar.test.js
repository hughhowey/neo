const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class FakeElement {
  constructor(className = '', attributes = {}, childNodes = []) {
    this.nodeType = 1;
    this.className = className;
    this.attributes = new Map(Object.entries(attributes));
    this.childNodes = childNodes;
  }

  matches(selector) {
    return selector === '.nav-note' && this.className.split(/\s+/).includes('nav-note');
  }

  closest(selector) {
    return selector.includes('[contenteditable="true"]') && this.matches('.nav-note') ? this : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
}

const noteText = { nodeType: 3, nodeValue: 'Minha anotação', parentElement: null };
const note = new FakeElement('nav-note', {
  contenteditable: 'true',
  'data-ph': 'What happens here…'
}, [noteText]);
noteText.parentElement = note;
const arrowText = { nodeType: 3, nodeValue: '⇦ ', parentElement: null };
const shelfText = { nodeType: 3, nodeValue: 'Shelf', parentElement: null };
const backButton = new FakeElement('', { title: 'Back to your bookshelf' }, [arrowText, shelfText]);
arrowText.parentElement = backButton;
shelfText.parentElement = backButton;
const addShelfText = { nodeType: 3, nodeValue: '+ Shelf', parentElement: null };
const addShelfButton = new FakeElement('', { title: 'Add a shelf' }, [addShelfText]);
addShelfText.parentElement = addShelfButton;
const body = new FakeElement('', {}, [note, backButton, addShelfButton]);
const context = {
  Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
  document: { body, documentElement: {} },
  window: {},
  MutationObserver: class {
    observe() {}
  }
};

vm.runInNewContext(fs.readFileSync(require.resolve('../i18n'), 'utf8'), context);

context.window.neoI18n.setLocale('pt-BR');
assert.equal(note.getAttribute('data-ph'), 'O que acontece aqui…');
assert.equal(noteText.nodeValue, 'Minha anotação');
assert.equal(shelfText.nodeValue, 'Prateleira');
assert.equal(backButton.getAttribute('title'), 'Voltar à prateleira');
assert.equal(addShelfText.nodeValue, '+ Prateleira');
assert.equal(addShelfButton.getAttribute('title'), 'Adicionar prateleira');

context.window.neoI18n.setLocale('en');
assert.equal(note.getAttribute('data-ph'), 'What happens here…');
assert.equal(noteText.nodeValue, 'Minha anotação');
assert.equal(shelfText.nodeValue, 'Shelf');
assert.equal(backButton.getAttribute('title'), 'Back to your bookshelf');
assert.equal(addShelfText.nodeValue, '+ Shelf');
assert.equal(addShelfButton.getAttribute('title'), 'Add a shelf');

console.log('interface toggle localization tests passed');