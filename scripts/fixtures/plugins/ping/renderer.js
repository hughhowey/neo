// The ping plugin: the smallest plugin with both halves. Once it activates,
// its window half sends a ping to its main half (main.js) and keeps the
// answer on window.__ping, for scripts/plugins.e2e.js to read back.

'use strict';

window.__ping = { activated: false, answer: null, neo: null };

NeoPlugins.register({
  id: 'ping',
  apiVersion: 1,
  async activate(neo) {
    window.__ping.activated = true;
    window.__ping.neo = neo;
    window.__ping.answer = await neo.invoke('ping', 'hello');
  }
});
