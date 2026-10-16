// A plugin that drops the promise of an invoke the host refuses, as a
// callback does that does not await it (scripts/plugins.e2e.js). It has no
// main half, so every invoke is refused. No other test uses it, so the quiet
// minute of its log is the test's own. window.__dropperInvoke(times) starts
// that many, and window.__dropperRefused counts those refused.

'use strict';

window.__dropperRefused = 0;

NeoPlugins.register({
  id: 'dropper',
  apiVersion: 1,
  activate(neo) {
    // the promise dropped is the one after finally, which counts the refusal
    window.__dropperInvoke = (times = 1) => {
      for (let i = 0; i < times; i++) setTimeout(() => { neo.invoke('index', i).finally(() => { window.__dropperRefused++; }); }, 0);
    };
  }
});
