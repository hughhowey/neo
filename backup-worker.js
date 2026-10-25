// NEO — the day's backup, in a process of its own (main.js: dailyBackup)
//
// The backup reads every file in the library. Done in NEO's main process, one
// file iCloud was slow to hand over (or a sync tool was holding) froze the
// whole app before its window could open, and every day after, because the
// backup runs at launch. Here a read that never comes back holds up only this
// process: each file gets a time limit, one that runs out is left out of the
// zip and named, and main.js ends this process if the whole job overruns.
//
// Message in:  { libraryDir, target, keep, fileLimitMs? }
// Message out: { ok: true, missed: [...], away: [...] } or { ok: false, error }

'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');

const FILE_LIMIT_MS = 20000; // one file: as long as iCloud reasonably takes for a chapter
// (tests: a file with no blocks counts as in iCloud, as their placeholders have no flag)
const SPARSE_IS_CLOUD = process.env.NEO_TEST_SPARSE_IS_CLOUD === '1';
const SF_DATALESS = 0x40000000; // macOS: a file whose words are in iCloud, not on this Mac

// a read with a time limit: the read itself can't be cut short, but the backup
// stops waiting for it (it finishes, or not, on a thread of its own)
function readWithin(file, ms) {
  let timer;
  return Promise.race([
    fsp.readFile(file),
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('took too long'), { code: 'ETIMEDOUT' })), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

// the placeholders among these files (iCloud has their words, this Mac doesn't):
// no blocks for a file with a size, confirmed by the "dataless" flag
function cloudOnlyAmong(files) {
  if (SPARSE_IS_CLOUD) return Promise.resolve(new Set(files));
  if (process.platform !== 'darwin' || !files.length) return Promise.resolve(new Set());
  return new Promise((resolve) => {
    execFile('/usr/bin/stat', ['-f', '%Xf', ...files], { encoding: 'utf8', timeout: 10000, maxBuffer: 1 << 24 }, (err, stdout) => {
      const flags = !err && String(stdout).trim().split('\n');
      // no answer from stat: treat them all as away (the safe side)
      if (!flags || flags.length !== files.length) return resolve(new Set(files));
      resolve(new Set(files.filter((f, i) => parseInt(flags[i], 16) & SF_DATALESS)));
    });
  });
}

// as main.js writes: beside the real name, pushed to the disk, then swapped in
async function writeDurable(file, data) {
  const tmp = file + '.tmp';
  const fh = await fsp.open(tmp, 'w');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, file);
}

async function backup({ libraryDir, target, keep, fileLimitMs = FILE_LIMIT_MS }) {
  const JSZip = require('jszip');
  const zip = new JSZip();
  const missed = [];
  const files = []; // [full, relPath, maybeAway]
  const walk = async (dir, rel) => {
    let names = [];
    try { names = await fsp.readdir(dir); } catch (err) { missed.push(`${rel || '.'} (${err.code || err.message})`); return; }
    for (const name of names) {
      if (rel === '' && (name === 'Backups' || name === 'Exports')) continue;
      // only NEO's own things: a library kept in a busy folder (Dropbox,
      // Documents) doesn't zip everything else in there every day
      if (rel === '' && !(name.startsWith('book-') || name.startsWith('library.json') || name === '_catalog.txt')) continue;
      // a book's snapshots stay out: they're a history of their own
      if (name === 'snapshots' && rel.startsWith('book-') && !rel.includes('/')) continue;
      if (name === '.git') continue; // a book's history stays out of the zip, the way Backups and Exports do
      if (name === '.DS_Store' || /^\..+\.icloud$/.test(name)) continue; // Finder litter; iCloud's stand-in for a file
      const full = path.join(dir, name);
      const relPath = rel ? rel + '/' + name : name;
      try {
        const st = await fsp.stat(full);
        if (st.isDirectory()) await walk(full, relPath);
        else if (st.isFile() || st.isFIFO()) files.push([full, relPath, (process.platform === 'darwin' || SPARSE_IS_CLOUD) && st.size > 0 && st.blocks === 0]);
      } catch (err) {
        missed.push(`${relPath} (${err.code || err.message})`);
      }
    }
  };
  await walk(libraryDir, '');
  // a file still in iCloud is safe up there: it's named, not waited on
  const away = await cloudOnlyAmong(files.filter((f) => f[2]).map((f) => f[0]));
  for (const [full, relPath] of files) {
    if (away.has(full)) { missed.push(`${relPath} (in iCloud, not on this Mac)`); continue; }
    try {
      zip.file(relPath, await readWithin(full, fileLimitMs));
    } catch (err) {
      missed.push(`${relPath} (${err.code === 'ETIMEDOUT' ? 'not handed over in time' : err.code || err.message})`);
    }
  }
  if (missed.length) zip.file('_left-out-of-this-backup.txt', missed.join('\n') + '\n');
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await JSZip.loadAsync(data); // reads back whole, or it doesn't count
  await writeDurable(target, data);
  // the oldest go once there are more than `keep`
  const dir = path.dirname(target);
  const backups = (await fsp.readdir(dir)).filter((f) => /^neo-backup-.*\.zip$/.test(f)).sort();
  while (backups.length > keep) await fsp.unlink(path.join(dir, backups.shift())).catch(() => {});
  return { missed, away: [...away] };
}

// Electron's utility process (parentPort); a plain Node child in the tests
const port = process.parentPort
  ? { on: (fn) => process.parentPort.on('message', (e) => fn(e.data)), send: (m) => process.parentPort.postMessage(m) }
  : { on: (fn) => process.on('message', fn), send: (m) => process.send(m) };
port.on(async (job) => {
  try {
    port.send({ ok: true, ...(await backup(job)) });
  } catch (err) {
    port.send({ ok: false, error: String((err && err.stack) || err) });
  }
});
