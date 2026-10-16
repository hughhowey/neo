// The main half of a plugin that scripts/plugins.e2e.js turns off. It should
// never start, and so never answers.

'use strict';

exports.started = false;

exports.activate = (host) => {
  exports.started = true;
  host.handle('ping', () => 'pong');
};
