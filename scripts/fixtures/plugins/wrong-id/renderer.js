// A plugin that registers under another id than its plugin.json gives. The
// host refuses it (scripts/plugins.e2e.js).

'use strict';

NeoPlugins.register({ id: 'some-other-id', apiVersion: 1, activate() {} });
