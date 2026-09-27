'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-pt-br-dict-'));
const tool = path.join(root, 'node_modules', '@cspell', 'cspell-tools', 'bin.mjs');

try {
  for (const name of ['pt_BR.aff', 'pt_BR.dic']) {
    const source = fs.readFileSync(path.join(root, 'dict', name));
    let text = source.toString('latin1');
    if (name.endsWith('.aff')) text = text.replace(/^SET ISO8859-1/m, 'SET UTF-8');
    fs.writeFileSync(path.join(tempDir, name), text, 'utf8');
  }

  const result = spawnSync(process.execPath, [tool, 'compile-trie', path.join(tempDir, 'pt_BR.dic')], {
    cwd: tempDir,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`cspell-tools exited with status ${result.status}`);

  fs.copyFileSync(path.join(tempDir, 'pt_BR.trie.gz'), path.join(root, 'dict', 'pt_BR.trie.gz'));
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
