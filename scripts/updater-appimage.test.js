'use strict';

// An AppImage updates itself through electron-updater, which keeps the file's
// path only when its name carries no version: NEO-1.6.5.AppImage was replaced
// by NEO-1.6.6.AppImage beside it, and the menu entry or desktop file that
// started the old one found nothing (#258). The release names the AppImages
// without one (NEO-x86_64.AppImage, NEO-arm64.AppImage), so an update goes in
// where the old one was. The names come from electron-builder's own naming,
// and the move from electron-updater's own install code, with the disk and
// the new NEO's launch replaced.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const { expandMacro } = require('app-builder-lib/out/util/macroExpander');
const { Arch, getArtifactArchName } = require('builder-util');
const { AppImageUpdater } = require('electron-updater/out/AppImageUpdater');

// the file names electron-builder gives the release's AppImages
function releaseName(arch) {
  const pattern = pkg.build.appImage && pkg.build.appImage.artifactName;
  assert.ok(pattern, 'build.appImage.artifactName is set');
  const appInfo = { productName: pkg.build.productName, productFilename: pkg.build.productName, version: '1.6.6', buildVersion: '1.6.6', companyName: null, sanitizedProductName: pkg.build.productName };
  return expandMacro(pattern, getArtifactArchName(arch, 'AppImage'), appInfo, { ext: 'AppImage' });
}

// where electron-updater puts the downloaded AppImage when the writer quits
function installedAt(running, downloaded) {
  const moves = [];
  const real = { unlink: fs.unlinkSync, exec: childProcess.execFileSync };
  fs.unlinkSync = () => {};
  childProcess.execFileSync = (cmd, args) => { if (cmd === 'mv') moves.push(args[2]); };
  const before = process.env.APPIMAGE;
  process.env.APPIMAGE = running;
  try {
    const me = { installerPath: downloaded, emit() {}, dispatchError(err) { throw err; }, spawnLog() {} };
    assert.equal(AppImageUpdater.prototype.doInstall.call(me, { isSilent: true, isForceRunAfter: false }), true);
  } finally {
    fs.unlinkSync = real.unlink;
    childProcess.execFileSync = real.exec;
    if (before === undefined) delete process.env.APPIMAGE; else process.env.APPIMAGE = before;
  }
  assert.equal(moves.length, 1);
  return moves[0];
}

test('the release names its AppImages without a version', () => {
  assert.equal(releaseName(Arch.x64), 'NEO-x86_64.AppImage');
  assert.equal(releaseName(Arch.arm64), 'NEO-arm64.AppImage');
  for (const name of [releaseName(Arch.x64), releaseName(Arch.arm64)]) assert.doesNotMatch(name, /\d+\.\d+\.\d+/);
});

test('an update goes in where the running AppImage is, under the same name (#258)', () => {
  const home = '/home/writer/Applications';
  for (const arch of [Arch.x64, Arch.arm64]) {
    const name = releaseName(arch);
    assert.equal(installedAt(path.posix.join(home, name), path.posix.join('/tmp/neo-update', name)), path.posix.join(home, name));
  }
  // a name the writer chose stays too
  assert.equal(installedAt(`${home}/neo`, `/tmp/neo-update/${releaseName(Arch.x64)}`), `${home}/neo`);
});

test('an AppImage from before, with the version in its name, moves once to the lasting name', () => {
  const home = '/home/writer/Applications';
  assert.equal(installedAt(`${home}/NEO-1.6.5.AppImage`, `/tmp/neo-update/${releaseName(Arch.x64)}`), path.join(home, 'NEO-x86_64.AppImage'));
  // (electron-updater joins with the platform's own separator)
  // which is the old behavior this replaces: a new versioned name every time
  assert.equal(installedAt(`${home}/NEO-1.6.5.AppImage`, '/tmp/neo-update/NEO-1.6.6.AppImage'), path.join(home, 'NEO-1.6.6.AppImage'));
});
