'use strict';

// Loads main.js the way scripts/filesystem.test.js does. Real git, and a
// temporary library only. The writer's NEO Library is never opened.

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const localRequire = createRequire(path.join(root, 'main.js'));
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const JSZip = localRequire('jszip');

// Self-contained identity so CI runners without git user.* still pass.
const TEST_GIT_NAME = 'Neo History Test';
const TEST_GIT_EMAIL = 'neo-history-test@example.com';
const testGitHome = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-history-git-home-'));
const testGitConfig = path.join(testGitHome, 'gitconfig');
fs.writeFileSync(testGitConfig, '[user]\n\tname = ' + TEST_GIT_NAME + '\n\temail = ' + TEST_GIT_EMAIL + '\n');
const blankGitConfig = path.join(testGitHome, 'gitconfig-blank');
fs.writeFileSync(blankGitConfig, '');

const savedGitEnv = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
  GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
  GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL,
  GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME,
  GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL
};

function applyTestGitIdentity() {
  process.env.HOME = testGitHome;
  process.env.USERPROFILE = testGitHome;
  process.env.GIT_CONFIG_GLOBAL = testGitConfig;
  process.env.GIT_CONFIG_SYSTEM = blankGitConfig;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.GIT_AUTHOR_NAME;
  delete process.env.GIT_AUTHOR_EMAIL;
  delete process.env.GIT_COMMITTER_NAME;
  delete process.env.GIT_COMMITTER_EMAIL;
}

function restoreGitEnv(extra) {
  const from = extra || savedGitEnv;
  for (const [key, value] of Object.entries(from)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

applyTestGitIdentity();
process.on('exit', () => {
  restoreGitEnv(savedGitEnv);
  try { fs.rmSync(testGitHome, { recursive: true, force: true }); } catch { /* best effort */ }
});

function loadMain() {
  const handlers = new Map();
  const listeners = new Map();
  const electron = {
    app: {
      commandLine: { appendSwitch() {} },
      getPath: () => os.tmpdir(),
      getLocale: () => 'en',
      getVersion: () => localRequire('./package.json').version,
      requestSingleInstanceLock: () => true,
      whenReady: () => ({ then() {} }),
      on() {}
    },
    ipcMain: {
      on: (name, fn) => listeners.set(name, fn),
      handle: (name, fn) => handlers.set(name, fn)
    },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
    dialog: {},
    // the backup's own process: the real backup-worker.js, as a Node child
    // (history's daily-zip test needs a real zip so it can assert .git is out)
    utilityProcess: {
      fork: (file) => {
        const child = require('node:child_process').fork(file, []);
        return {
          on: (ev, fn) => child.on(ev, ev === 'exit' ? (code) => fn(code || 0) : fn),
          postMessage: (m) => child.send(m),
          kill: () => child.kill()
        };
      }
    },
    screen: {}
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: root,
    process: { platform: process.platform, env: process.env, on() {} },
    console,
    setTimeout,
    clearTimeout,
    libraryRoot: os.tmpdir()
  });
  vm.runInContext(source, context, { filename: path.join(root, 'main.js') });
  return {
    context,
    call: (name, ...args) => handlers.get(name)(null, ...args),
    emit: (name, ...args) => listeners.get(name)(null, ...args),
    pointAt(dir) {
      context.libraryRoot = dir;
      vm.runInContext('LIBRARY_DIR = libraryRoot; LIBRARY_FILE = require("path").join(libraryRoot, "library.json");', context);
    }
  };
}

const main = loadMain();

function tempLibrary() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-library-history-'));
  assert.equal(dir.startsWith(os.tmpdir()), true);
  main.pointAt(dir);
  return dir;
}

function histories() {
  return vm.runInContext('commitHistories()', main.context);
}

function checkpoint(bookId, kind) {
  return vm.runInContext(
    'checkpointBook(' + JSON.stringify(bookId) + ', ' + JSON.stringify(kind) + ')',
    main.context
  );
}

function setTracking(on) {
  const lib = main.call('library:read');
  lib.versionTracking = on;
  main.call('library:write', lib);
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commitCount(dir) {
  return Number(gitOut(dir, ['rev-list', '--count', 'HEAD']));
}

function logIdentity() {
  return vm.runInContext('logGitIdentity()', main.context);
}

function assertHistoryCommit(folder, subject = 'Version history') {
  const version = localRequire('./package.json').version;
  assert.equal(gitOut(folder, ['log', '-1', '--format=%s']), subject);
  assert.equal(gitOut(folder, ['log', '-1', '--format=%an']), TEST_GIT_NAME);
  assert.match(
    gitOut(folder, ['log', '-1', '--format=%b']),
    new RegExp('^Neo-Version: ' + version.replace(/\./g, '\\.') + '$')
  );
}

function resetTrackingState() {
  vm.runInContext('versionTrackingState = false; versionTrackingKnown = false;', main.context);
}

async function withHistoryConsole(fn) {
  const lines = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => {
    const s = args.map(String).join(' ');
    if (s.startsWith('[history]')) lines.push(s);
  };
  console.error = (...args) => {
    const s = args.map(String).join(' ');
    if (s.startsWith('[history]')) lines.push(s);
  };
  try {
    await fn(lines);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return lines;
}

function stamp(file) {
  const st = fs.statSync(file);
  return st.mtimeMs + ':' + st.size;
}

describe('version history', { concurrency: 1 }, () => {
  test('tracking off or absent: a pass creates no .git', async () => {
    const dir = tempLibrary();
    try {
      const absent = main.call('book:create', { title: 'Absent', author: 'Ada' });
      await histories();
      assert.equal(fs.existsSync(path.join(dir, absent.id, '.git')), false);

      const off = main.call('book:create', { title: 'Off', author: 'Ada' });
      setTracking(false);
      fs.mkdirSync(path.join(dir, off.id, '.git'));
      await histories();
      assert.equal(fs.existsSync(path.join(dir, absent.id, '.git')), false);
      assert.equal(fs.existsSync(path.join(dir, off.id, '.git', 'HEAD')), false);
      assert.equal(fs.statSync(path.join(dir, off.id, '.git')).isDirectory(), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('tracking on: first pass commits; second pass with no edits does not', async () => {
    const dir = tempLibrary();
    try {
      const book = main.call('book:create', { title: 'Hello', author: 'Ada' });
      const folder = path.join(dir, book.id);
      setTracking(true);
      const lines = await withHistoryConsole(async () => {
        await histories();
      });
      assert.equal(fs.existsSync(path.join(folder, '.git')), true);
      assert.equal(commitCount(folder), 1);
      assertHistoryCommit(folder, 'Version history — Hello');
      const ignore = fs.readFileSync(path.join(folder, '.gitignore'), 'utf8');
      for (const line of ['*.tmp', '*.bak', '.DS_Store', 'snapshots']) {
        assert.equal(ignore.split(/\r?\n/).includes(line), true);
      }
      const hash = gitOut(folder, ['rev-parse', '--short', 'HEAD']);
      assert.equal(lines.filter((l) => l.includes('checkpoint saved')).length, 1);
      assert.match(lines.join('\n'), new RegExp(
        'checkpoint saved book=' + book.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        ' title="Hello" commit=' + hash
      ));

      const again = await withHistoryConsole(async () => {
        await histories();
      });
      assert.equal(commitCount(folder), 1);
      assert.equal(again.filter((l) => l.includes('checkpoint saved')).length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('startup logs the git identity', async () => {
    const dir = tempLibrary();
    try {
      const lines = await withHistoryConsole(async () => { await logIdentity(); });
      assert.match(
        lines.join('\n'),
        new RegExp(
          'git identity name=' + JSON.stringify(TEST_GIT_NAME).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
          ' email=' + JSON.stringify(TEST_GIT_EMAIL).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        )
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('startup logs when git is missing or has no identity', async () => {
    const dir = tempLibrary();
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-no-git-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-no-git-id-'));
    const blank = path.join(home, 'gitconfig');
    fs.writeFileSync(blank, '');
    const savedPath = process.env.PATH;
    try {
      process.env.PATH = empty;
      let lines = await withHistoryConsole(async () => { await logIdentity(); });
      assert.match(lines.join('\n'), /git not found/);

      process.env.PATH = savedPath;
      process.env.HOME = home;
      process.env.USERPROFILE = home;
      process.env.GIT_CONFIG_GLOBAL = blank;
      process.env.GIT_CONFIG_SYSTEM = blank;
      delete process.env.XDG_CONFIG_HOME;
      delete process.env.GIT_AUTHOR_NAME;
      delete process.env.GIT_AUTHOR_EMAIL;
      delete process.env.GIT_COMMITTER_NAME;
      delete process.env.GIT_COMMITTER_EMAIL;
      lines = await withHistoryConsole(async () => { await logIdentity(); });
      assert.match(lines.join('\n'), /git identity name="" email=""/);
    } finally {
      process.env.PATH = savedPath;
      applyTestGitIdentity();
      fs.rmSync(empty, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('turning tracking on or off prints to the terminal', async () => {
    const dir = tempLibrary();
    try {
      main.call('book:create', { title: 'Hello', author: 'Ada' });
      main.call('book:create', { title: 'Two', author: 'Ada' });
      resetTrackingState();
      const version = localRequire('./package.json').version;
      const lines = await withHistoryConsole(async () => {
        main.emit('versionTracking:state', true);
        main.emit('versionTracking:state', true);
        main.emit('versionTracking:state', false);
      });
      assert.equal(lines.filter((l) => l.includes('version control enabled')).length, 1);
      assert.match(
        lines.join('\n'),
        new RegExp(
          'version control enabled version=' + version.replace(/\./g, '\\.') +
          ' books=2 library=' + dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        )
      );
      assert.match(lines.join('\n'), /version control disabled/);
    } finally {
      resetTrackingState();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a chapter write is a new commit, and the commit does not change that file', async () => {
    const dir = tempLibrary();
    try {
      const book = main.call('book:create', { title: 'Hello', author: 'Ada' });
      const folder = path.join(dir, book.id);
      setTracking(true);
      await withHistoryConsole(async () => { await histories(); });
      const before = commitCount(folder);

      const html = '<p>Once upon a time</p>';
      assert.equal(main.call('chapter:write', book.id, 'c1', html), true);
      const file = path.join(folder, 'chapters', 'c1.html');
      assert.equal(commitCount(folder), before);
      const mark = stamp(file);

      await withHistoryConsole(async () => { await histories(); });
      assert.equal(commitCount(folder), before + 1);
      assert.equal(stamp(file), mark);
      assert.equal(fs.readFileSync(file, 'utf8'), html);
      assertHistoryCommit(folder, 'Version history — Hello');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('missing git logs once and leaves the chapter in place', async () => {
    const dir = tempLibrary();
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-no-git-'));
    const saved = process.env.PATH;
    try {
      const first = main.call('book:create', { title: 'One', author: 'Ada' });
      const second = main.call('book:create', { title: 'Two', author: 'Ada' });
      const html = '<p>The words stay.</p>';
      main.call('chapter:write', first.id, 'c1', html);
      main.call('chapter:write', second.id, 'c1', html);
      setTracking(true);
      process.env.PATH = empty;
      const lines = await withHistoryConsole(async () => { await histories(); });
      const log = fs.readFileSync(path.join(dir, 'neo-errors.log'), 'utf8');
      assert.equal((log.match(/\[history\]/g) || []).length, 1);
      assert.match(log, /ENOENT/);
      assert.equal(lines.some((l) => l.includes('ENOENT')), true);
      for (const book of [first, second]) {
        const file = path.join(dir, book.id, 'chapters', 'c1.html');
        assert.equal(fs.readFileSync(file, 'utf8'), html);
        assert.equal(fs.existsSync(path.join(dir, book.id, '.git')), false);
      }
    } finally {
      process.env.PATH = saved;
      fs.rmSync(empty, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('git with no user identity logs and leaves the chapter in place', async () => {
    const dir = tempLibrary();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-no-git-id-'));
    const blank = path.join(home, 'gitconfig');
    fs.writeFileSync(blank, '');
    try {
      const first = main.call('book:create', { title: 'One', author: 'Ada' });
      const second = main.call('book:create', { title: 'Two', author: 'Ada' });
      const html = '<p>The words stay.</p>';
      main.call('chapter:write', first.id, 'c1', html);
      main.call('chapter:write', second.id, 'c1', html);
      setTracking(true);
      process.env.HOME = home;
      process.env.USERPROFILE = home;
      process.env.GIT_CONFIG_GLOBAL = blank;
      process.env.GIT_CONFIG_SYSTEM = blank;
      delete process.env.XDG_CONFIG_HOME;
      delete process.env.GIT_AUTHOR_NAME;
      delete process.env.GIT_AUTHOR_EMAIL;
      delete process.env.GIT_COMMITTER_NAME;
      delete process.env.GIT_COMMITTER_EMAIL;

      const lines = await withHistoryConsole(async () => { await histories(); });
      const log = fs.readFileSync(path.join(dir, 'neo-errors.log'), 'utf8');
      // one refusal for the whole pass — no per-book git init
      assert.equal((log.match(/\[history\]/g) || []).length, 1);
      assert.match(log, /identity/i);
      assert.equal(lines.some((l) => /identity/i.test(l)), true);
      assert.equal(lines.some((l) => l.includes('checkpoint saved')), false);
      for (const book of [first, second]) {
        const folder = path.join(dir, book.id);
        const file = path.join(folder, 'chapters', 'c1.html');
        assert.equal(fs.readFileSync(file, 'utf8'), html);
        assert.equal(fs.existsSync(path.join(folder, '.git')), false);
      }
    } finally {
      applyTestGitIdentity();
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('prepare refuses without git or identity; warns on a synced path', async () => {
    const dir = tempLibrary();
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-no-git-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-no-git-id-'));
    const blank = path.join(home, 'gitconfig');
    fs.writeFileSync(blank, '');
    const savedPath = process.env.PATH;
    try {
      await withHistoryConsole(async () => {
        let prep = await main.call('versionTracking:prepare');
        assert.equal(prep.ok, true);
        assert.equal(prep.syncWarn, false);

        process.env.PATH = empty;
        prep = await main.call('versionTracking:prepare');
        assert.equal(prep.ok, false);
        assert.equal(prep.reason, 'no-git');

        process.env.PATH = savedPath;
        process.env.HOME = home;
        process.env.USERPROFILE = home;
        process.env.GIT_CONFIG_GLOBAL = blank;
        process.env.GIT_CONFIG_SYSTEM = blank;
        delete process.env.XDG_CONFIG_HOME;
        prep = await main.call('versionTracking:prepare');
        assert.equal(prep.ok, false);
        assert.equal(prep.reason, 'no-identity');

        applyTestGitIdentity();
        const synced = path.join(dir, 'Dropbox', 'NEO Library');
        vm.runInContext('LIBRARY_DIR = ' + JSON.stringify(synced), main.context);
        prep = await main.call('versionTracking:prepare');
        assert.equal(prep.ok, true);
        assert.equal(prep.syncWarn, true);
      });
    } finally {
      process.env.PATH = savedPath;
      applyTestGitIdentity();
      main.pointAt(dir);
      fs.rmSync(empty, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a hung git clears historyRunning', async () => {
    if (process.platform === 'win32') return; // PATH shim is a shell script
    const dir = tempLibrary();
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-slow-git-'));
    fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\nsleep 30\n', { mode: 0o755 });
    const savedPath = process.env.PATH;
    try {
      const book = main.call('book:create', { title: 'Hello', author: 'Ada' });
      setTracking(true);
      vm.runInContext('HISTORY_GIT_TIMEOUT_MS = 200', main.context);
      process.env.PATH = bin + path.delimiter + savedPath;
      await withHistoryConsole(async () => { await histories(); });
      assert.equal(vm.runInContext('historyRunning', main.context), false);
      assert.equal(fs.existsSync(path.join(dir, book.id, '.git')), false);
    } finally {
      process.env.PATH = savedPath;
      vm.runInContext('HISTORY_GIT_TIMEOUT_MS = 60 * 1000', main.context);
      fs.rmSync(bin, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a snapshot checkpoint commits only that book', async () => {
    const dir = tempLibrary();
    try {
      const one = main.call('book:create', { title: 'One', author: 'Ada' });
      const two = main.call('book:create', { title: 'Two', author: 'Ada' });
      const folderOne = path.join(dir, one.id);
      const folderTwo = path.join(dir, two.id);
      setTracking(true);
      await withHistoryConsole(async () => { await histories(); });
      const beforeOne = commitCount(folderOne);
      const beforeTwo = commitCount(folderTwo);

      main.call('chapter:write', one.id, 'c1', '<p>Only the first book.</p>');
      const lines = await withHistoryConsole(async () => { await checkpoint(one.id, 'k'); });
      assert.equal(commitCount(folderOne), beforeOne + 1);
      assert.equal(commitCount(folderTwo), beforeTwo);
      assertHistoryCommit(folderOne, 'Version history: taken by you — One');
      assert.equal(lines.filter((l) => l.includes('checkpoint saved')).length, 1);
      assert.match(lines.join('\n'), new RegExp(
        'book=' + one.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.* kind=k'
      ));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('snapshot kinds name the commit subject', async () => {
    const dir = tempLibrary();
    try {
      const book = main.call('book:create', { title: 'Hello', author: 'Ada' });
      const folder = path.join(dir, book.id);
      setTracking(true);
      await withHistoryConsole(async () => { await histories(); });
      assertHistoryCommit(folder, 'Version history — Hello'); // turn-on / full pass: no kind

      main.call('chapter:write', book.id, 'c1', '<p>Morning.</p>');
      await withHistoryConsole(async () => { await checkpoint(book.id, 'd'); });
      assertHistoryCommit(folder, 'Version history: start of the day — Hello');

      main.call('chapter:write', book.id, 'c1', '<p>Morning. Afternoon.</p>');
      await withHistoryConsole(async () => { await checkpoint(book.id, 'k'); });
      assertHistoryCommit(folder, 'Version history: taken by you — Hello');

      main.call('chapter:write', book.id, 'c1', '<p>Before restore.</p>');
      await withHistoryConsole(async () => { await checkpoint(book.id, 'r'); });
      assertHistoryCommit(folder, 'Version history: before a restore — Hello');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('book inside a library repo commits there, scoped to the book', async () => {
    const dir = tempLibrary();
    try {
      execFileSync('git', ['-c', 'init.defaultBranch=main', 'init'], {
        cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
      });
      const one = main.call('book:create', { title: 'One', author: 'Ada' });
      const two = main.call('book:create', { title: 'Two', author: 'Ada' });
      setTracking(true);
      const lines = await withHistoryConsole(async () => { await histories(); });
      assert.equal(fs.existsSync(path.join(dir, one.id, '.git')), false);
      assert.equal(fs.existsSync(path.join(dir, two.id, '.git')), false);
      assert.equal(fs.existsSync(path.join(dir, '.git')), true);
      assert.ok(commitCount(dir) >= 1);
      assert.match(lines.join('\n'), /repo=/);

      main.call('chapter:write', one.id, 'c1', '<p>Only the first book.</p>');
      await withHistoryConsole(async () => { await checkpoint(one.id, 'k'); });
      assertHistoryCommit(dir, 'Version history: taken by you — One');
      const names = gitOut(dir, ['show', '--name-only', '--format=', 'HEAD'])
        .split('\n').map((s) => s.trim()).filter(Boolean);
      assert.ok(names.length > 0);
      assert.equal(names.every((f) => f === one.id || f.startsWith(one.id + '/')), true);
      assert.equal(names.some((f) => f === two.id || f.startsWith(two.id + '/')), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('home as git toplevel is ignored; book gets its own repo', async () => {
    const dir = tempLibrary();
    try {
      // pretend the library root is $HOME so resolveHistoryRepo refuses it
      execFileSync('git', ['-c', 'init.defaultBranch=main', 'init'], {
        cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
      });
      vm.runInContext(
        'os.homedir = () => ' + JSON.stringify(dir),
        main.context
      );
      const book = main.call('book:create', { title: 'Solo', author: 'Ada' });
      setTracking(true);
      await withHistoryConsole(async () => { await histories(); });
      assert.equal(fs.existsSync(path.join(dir, book.id, '.git')), true);
      assertHistoryCommit(path.join(dir, book.id), 'Version history — Solo');
    } finally {
      vm.runInContext('os.homedir = require("os").homedir', main.context);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // Snapshot can still ask for a checkpoint when the work tree is already
  // clean (e.g. nothing new on disk since the last commit). Expect silence.
  test('a snapshot checkpoint with no git changes does not commit', async () => {
    const dir = tempLibrary();
    try {
      const book = main.call('book:create', { title: 'Hello', author: 'Ada' });
      const folder = path.join(dir, book.id);
      setTracking(true);
      await withHistoryConsole(async () => { await histories(); });
      const before = commitCount(folder);

      const lines = await withHistoryConsole(async () => { await checkpoint(book.id, 'k'); });
      assert.equal(commitCount(folder), before);
      assert.equal(lines.filter((l) => l.includes('checkpoint saved')).length, 0);
      assert.equal(gitOut(folder, ['status', '--porcelain']), '');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('snapshots stay out of the book\'s git', async () => {
    const dir = tempLibrary();
    try {
      const book = main.call('book:create', { title: 'Hello', author: 'Ada' });
      const folder = path.join(dir, book.id);
      setTracking(true);
      await withHistoryConsole(async () => { await histories(); });

      const snapDir = path.join(folder, 'snapshots', '20260101T120000Z-k-1-3-abcd');
      fs.mkdirSync(snapDir, { recursive: true });
      fs.writeFileSync(path.join(snapDir, 'snapshot.json'), '{"v":1}\n');
      main.call('chapter:write', book.id, 'c1', '<p>After a snapshot folder appeared.</p>');

      await withHistoryConsole(async () => { await checkpoint(book.id, 'k'); });
      const tracked = gitOut(folder, ['ls-files']);
      assert.equal(tracked.split('\n').some((f) => f.startsWith('snapshots/')), false);
      const ignore = fs.readFileSync(path.join(folder, '.gitignore'), 'utf8');
      assert.equal(ignore.split(/\r?\n/).includes('snapshots'), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an existing gitignore gains the snapshots line', async () => {
    const dir = tempLibrary();
    try {
      const book = main.call('book:create', { title: 'Hello', author: 'Ada' });
      const folder = path.join(dir, book.id);
      fs.writeFileSync(path.join(folder, '.gitignore'), '*.tmp\n*.bak\n.DS_Store\n');
      setTracking(true);
      await withHistoryConsole(async () => { await histories(); });
      const ignore = fs.readFileSync(path.join(folder, '.gitignore'), 'utf8');
      assert.equal(ignore.split(/\r?\n/).includes('snapshots'), true);
      assert.match(ignore, /\*\.tmp\n\*\.bak\n\.DS_Store\nsnapshots\n/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('checkpoint with tracking off does nothing', async () => {
    const dir = tempLibrary();
    try {
      const book = main.call('book:create', { title: 'Hello', author: 'Ada' });
      setTracking(false);
      await checkpoint(book.id);
      assert.equal(fs.existsSync(path.join(dir, book.id, '.git')), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a pass already running does not start another', async () => {
    const dir = tempLibrary();
    try {
      const book = main.call('book:create', { title: 'Hello', author: 'Ada' });
      setTracking(true);
      vm.runInContext('historyRunning = true', main.context);
      await histories();
      assert.equal(fs.existsSync(path.join(dir, book.id, '.git')), false);
    } finally {
      vm.runInContext('historyRunning = false', main.context);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('daily zip walk has no path containing /.git/', async () => {
    const dir = tempLibrary();
    try {
      const book = main.call('book:create', { title: 'Hello', author: 'Ada' });
      const folder = path.join(dir, book.id);
      setTracking(true);
      await withHistoryConsole(async () => { await histories(); });
      const marker = 'neo-history-marker-do-not-zip';
      fs.writeFileSync(path.join(folder, '.git', marker), marker);
      await vm.runInContext('dailyBackup()', main.context);
      const today = new Date().toISOString().slice(0, 10);
      const zipPath = path.join(dir, 'Backups', `neo-backup-${today}.zip`);
      const buf = fs.readFileSync(zipPath);
      assert.equal(buf.includes(marker), false);
      const zip = await JSZip.loadAsync(buf);
      const names = Object.keys(zip.files);
      assert.equal(names.some((name) => name.includes('/.git/')), false);
      assert.equal(names.some((name) => name.endsWith('book.json')), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
