'use strict';

// Fresh processes, warm filesystem cache. Run with:
// node scripts/benchmark-spellcheck.js
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const SAMPLES = {
  'en-US': { pkg: 'dictionary-en-us', good: 'sentence', typo: 'sentnce' },
  'fr': { pkg: 'dictionary-fr', good: 'français', typo: 'franssais' },
  'pt-BR': { pkg: 'dictionary-pt', good: 'fazê-lo', typo: 'coracao' },
  'ro': { pkg: 'dictionary-ro', good: 'trebui', typo: 'frgament' },
  'hu': { pkg: 'dictionary-hu', good: 'házaimban', typo: 'gyonyoru' },
  'ru': { pkg: 'dictionary-ru', good: 'привет', typo: 'привт' }
};

const variant = process.argv[2];
if (!variant) {
  for (let trial = 1; trial <= 3; trial++) {
    for (const name of Object.keys(SAMPLES)) {
      const child = spawnSync(process.execPath, [__filename, name], { encoding: 'utf8', timeout: 60000 });
      if (child.status !== 0) throw new Error(child.stderr || String(child.error || 'benchmark failed'));
      console.log(JSON.stringify({ trial, ...JSON.parse(child.stdout) }));
    }
  }
} else {
  (async () => {
    const { loadModule, HUNSPELL_VERSION } = require('@farscrl/hunspell-wasm');
    const s = SAMPLES[variant];
    const dir = path.join(__dirname, '..', 'node_modules', s.pkg);
    const start = performance.now();
    const factory = await loadModule();
    const moduleMs = performance.now() - start;
    const spell = factory.create(
      factory.mountBuffer(fs.readFileSync(path.join(dir, 'index.aff')), 'b.aff'),
      factory.mountBuffer(fs.readFileSync(path.join(dir, 'index.dic')), 'b.dic'));
    const loadMs = performance.now() - start;
    const checkStart = performance.now();
    for (let i = 0; i < 10000; i++) spell.spell(i % 2 ? s.good : s.typo);
    const check10kMs = performance.now() - checkStart;
    const suggestStart = performance.now();
    const suggestions = spell.suggest(s.typo).slice(0, 6);
    console.log(JSON.stringify({
      variant, hunspell: HUNSPELL_VERSION, node: process.version, arch: process.arch,
      moduleMs, loadMs, check10kMs, suggestMs: performance.now() - suggestStart,
      maxRssMiB: process.resourceUsage().maxRSS / 1024,
      sampleCorrect: spell.spell(s.good), suggestions
    }));
  })().catch((err) => { console.error(err); process.exit(1); });
}
