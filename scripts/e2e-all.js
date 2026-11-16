#!/usr/bin/env node
'use strict';

// npm run test:e2e — every end-to-end test (scripts/*.e2e.js), one after
// another, each in its own NEO on a throwaway library. Prints one line per
// file and stops with a failing exit code if any test failed. On Linux with
// no screen it runs under xvfb-run when that is installed. The robot runs
// this on a Mac for every push (.github/workflows/tests.yml).
//
//   npm run test:e2e                 every file
//   npm run test:e2e -- find litrpg  just those

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
const only = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.e2e.js'))
  .filter((f) => !only.length || only.includes(f.replace('.e2e.js', ''))).sort();
const electron = require('electron'); // the path to the binary, from Node
const headless = process.platform === 'linux' && !process.env.DISPLAY;
const xvfb = headless && spawnSync('sh', ['-c', 'command -v xvfb-run']).status === 0;
const extra = process.platform === 'linux' ? ['--no-sandbox'] : [];

let failed = 0;
for (const f of files) {
  const args = [path.join(dir, f), ...extra];
  const started = Date.now();
  const run = xvfb
    ? spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1920x1200x24', electron, ...args], { encoding: 'utf8', timeout: 600000 })
    : spawnSync(electron, args, { encoding: 'utf8', timeout: 600000 });
  const out = (run.stdout || '') + (run.stderr || '');
  const summary = (out.match(/^\d+ passed, \d+ failed$/m) || [''])[0];
  const ok = run.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f.padEnd(28)} ${summary || (ok ? '' : 'exit ' + run.status + (run.signal ? ' ' + run.signal : ''))}  ${((Date.now() - started) / 1000).toFixed(0)}s`);
  if (!ok) {
    const lines = out.split('\n').filter((l) => /^(FAIL|\s{5}\S)|Error|assert/.test(l)).slice(0, 30);
    console.log(lines.map((l) => '     ' + l).join('\n'));
  }
}
console.log(`\n${files.length - failed} of ${files.length} files passed`);
process.exit(failed ? 1 : 0);
