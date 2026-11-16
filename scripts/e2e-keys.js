'use strict';

// The edit keys as a Mac has them. There ⌘X, ⌘C, ⌘V, ⌘A, ⌘Z and ⇧⌘Z are the
// Edit menu's: the window sees the keydown first, and if nothing in it calls
// preventDefault, the menu's role runs (webContents.cut() and the rest).
// A key sent with sendInputEvent never reaches the menu, so on a Mac a test
// that only sends the key cuts and undoes nothing. Elsewhere Chromium itself
// answers Ctrl+X and Ctrl+Z, and the key is all there is.

const ROLES = { x: 'cut', c: 'copy', v: 'paste', a: 'selectAll', z: 'undo' };

async function editKey(wc, letter, { shift = false } = {}) {
  const mac = process.platform === 'darwin';
  const modifiers = [mac ? 'meta' : 'control', ...(shift ? ['shift'] : [])];
  const keyCode = letter.toUpperCase();
  if (mac) {
    await wc.executeJavaScript(`(() => {
      if (window.__editKeyWatch) return;
      window.__editKeyWatch = true;
      // on the window, bubbling: after every handler of NEO's
      window.addEventListener('keydown', (e) => { window.__editKeyPrevented = e.defaultPrevented; });
    })()`, true);
    await wc.executeJavaScript('window.__editKeyPrevented = null', true);
  }
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  if (!mac) return;
  await new Promise((resolve) => setTimeout(resolve, 30));
  const prevented = await wc.executeJavaScript('window.__editKeyPrevented', true);
  if (prevented) return;
  const role = letter.toLowerCase() === 'z' && shift ? 'redo' : ROLES[letter.toLowerCase()];
  if (role) wc[role]();
}

module.exports = { editKey };
