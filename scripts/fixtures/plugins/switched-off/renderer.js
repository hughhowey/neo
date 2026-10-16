// A plugin that scripts/plugins.e2e.js turns off (pluginsOff in
// settings.json). Its script should never load.

'use strict';

window.__switchedOffRan = true;

NeoPlugins.register({ id: 'switched-off', apiVersion: 1, activate() {} });
