// A plugin whose script throws before it registers. The host logs the error
// under the plugin's name without telling the writer (scripts/plugins.e2e.js).

'use strict';

function fail() {
  throw new Error('throws early on purpose');
}
fail();

NeoPlugins.register({ id: 'throws-early', apiVersion: 1, activate() {} });
