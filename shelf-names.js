'use strict';

const defaults = new Map([
  ['Works in Progress', 'Em andamento'],
  ['Em andamento', 'Em andamento'],
  ['New Shelf', 'Nova biblioteca'],
  ['Nova biblioteca', 'Nova biblioteca']
]);

function display(name, locale = 'pt-BR') {
  const key = defaults.get(name);
  if (!key) return name;
  if (locale === 'en') {
    return key === 'Em andamento' ? 'Works in Progress' : 'New Shelf';
  }
  return key;
}

function normalize(name) {
  if (name === 'Works in Progress' || name === 'Em andamento') return 'Works in Progress';
  if (name === 'New Shelf' || name === 'Nova biblioteca') return 'New Shelf';
  return name;
}

const api = { display, normalize };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.NeoShelfNames = api;
