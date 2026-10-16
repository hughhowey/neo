// The ping plugin's main-process half: ping answers with a pong and what it
// was sent. The host it was handed is kept, so scripts/plugins-main.test.js
// and scripts/plugins.e2e.js can add channels to it as a plugin would.

'use strict';

exports.host = null;

exports.activate = (host) => {
  exports.host = host;
  host.handle('ping', (payload) => ({ pong: payload }));
  host.handle('fail', () => { throw new Error('failed on purpose'); });
};
