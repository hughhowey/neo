// A plugin that throws while it activates. The host logs the error and never
// lets it call its main half; NEO carries on (scripts/plugins.e2e.js).

'use strict';

window.__broken = { neo: null };

NeoPlugins.register({
  id: 'broken',
  apiVersion: 1,
  activate(neo) {
    window.__broken.neo = neo;
    throw new Error('broken on purpose');
  }
});
