// Plugins, window half. main.js lists the plugin folders it found at launch
// (plugins-main.js, on window.neo.plugins); this file loads the script of
// each one that is on. The script calls NeoPlugins.register, and its activate(neo) is
// handed one call (apiFor):
//   invoke(channel, payload)  a call to its own main half (plugins-main.js)
// That is no wall. A plugin's script runs in NEO's page, where window.neo,
// NEO's own way to the files, is in reach of any script. So NEO trusts a
// plugin as it trusts its own code, and loads plugins only from inside its
// app folder (plugins-main.js): from plugins/ there and, when NEO is
// not packaged, from the folders named in NEO_PLUGIN_DIRS, which must lie
// inside it too.
//
// app.js calls attach() on its last line, behind window.NeoPlugins, so
// Pocket, which runs app.js without this file, is untouched.

'use strict';

(() => {
  const API_VERSIONS = Object.freeze([1]);

  // One entry per plugin that registered: { id, disposed }
  const registry = new Map();
  // each listed plugin's id, by the URL its script was loaded from (see
  // onScriptError)
  const scriptIds = new Map();
  // this file's own URL, as a script's errors name it
  const hostUrl = document.currentScript && document.currentScript.src;
  let attached = false;

  // the plugins main.js found, each with an id; Pocket and a failed
  // discovery have none
  function listed() {
    const list = window.neo && window.neo.plugins;
    return Array.isArray(list) ? list.filter((m) => m && typeof m.id === 'string' && m.id) : [];
  }

  // A plugin can throw anything, and a Symbol or an object with no prototype
  // has no text form. Logging must not throw.
  function text(what) {
    try {
      return String((what && what.stack) || what);
    } catch {
      return `(a value of type ${typeof what} with no text form)`;
    }
  }

  // The log is written through IPC. If that throws or rejects, the line
  // goes to the console: a failed log must not reach NEO.
  function log(id, what) {
    const line = `plugin ${text(id)}: ${text(what)}`;
    try {
      Promise.resolve(window.neo.logError(line)).catch((err) => console.error(line, err));
    } catch (err) {
      console.error(line, err);
    }
  }

  // A plugin's script that errors on every tick of a timer would add a line
  // to neo-errors.log, a file in the synced library, for each. The first
  // failure is logged, then one a minute at most, with a count of those
  // left out. key is an object standing for a plugin's script.
  const QUIET_MS = 60000;
  const failures = new WeakMap(); // key -> { at, untold }
  function logFailure(id, key, err) {
    const now = performance.now();
    const last = failures.get(key);
    if (last && now - last.at < QUIET_MS) {
      last.untold++;
      return;
    }
    failures.set(key, { at: now, untold: 0 });
    const more = last && last.untold ? `${last.untold} more failures of this plugin's script since its last line; the latest: ` : '';
    log(id, more + text(err));
  }

  // what activate(neo) receives
  function apiFor(entry) {
    return Object.freeze({
      // a call to this plugin's own main half (plugins-main.js), answered
      // by the handler it took for the channel. The id filled in here keeps
      // a plugin from reaching another's half by mistake. It is no wall:
      // every plugin's script runs in this page and can call
      // window.neo.pluginInvoke with any id.
      async invoke(channel, payload) {
        if (entry.disposed) throw madeFor(entry.id, new Error(`plugin ${entry.id} is not active, so it cannot invoke ${channel}`));
        try {
          return await window.neo.pluginInvoke(entry.id, channel, payload);
        } catch (err) {
          // The Error that crosses the bridge belongs to no plugin. One made
          // here, with its message, is this plugin's (see madeFor).
          throw madeFor(entry.id, new Error(err && err.message !== undefined ? err.message : text(err)));
        }
      }
    });
  }

  // A plugin that fails to activate is logged, never shown to the writer,
  // and can call nothing after
  function fail(entry, err) {
    log(entry.id, err);
    entry.disposed = true;
  }

  function register(plugin) {
    const id = plugin && plugin.id;
    const manifest = listed().find((m) => m.id === id);
    const refuse = (why) => log(id, `${why}, so it is not activated`);
    if (!manifest) return refuse('not among the plugins NEO found at launch');
    if (manifest.on === false) return refuse('turned off in settings.json');
    if (plugin.apiVersion !== manifest.apiVersion || !API_VERSIONS.includes(plugin.apiVersion)) {
      return refuse(`apiVersion ${plugin.apiVersion}, where its plugin.json says ${manifest.apiVersion} and this NEO knows ${API_VERSIONS.join(', ')}`);
    }
    if (typeof plugin.activate !== 'function') return refuse('no activate function');
    if (registry.has(id)) return refuse('registered already');
    const entry = { id, disposed: false };
    registry.set(id, entry);
    let result;
    try {
      result = plugin.activate(apiFor(entry));
    } catch (err) {
      fail(entry, err);
      return;
    }
    if (result && typeof result.then === 'function') result.then(null, (err) => fail(entry, err));
  }

  // Runs once, at the end of app.js, once all of NEO is defined: the
  // plugins' scripts go in and run in the order they were listed. One that
  // will not load is logged and skipped.
  function attach() {
    if (attached) return;
    attached = true;
    for (const m of listed()) {
      if (m.on === false) continue;
      const script = document.createElement('script');
      script.src = m.rendererUrl;
      script.async = false;
      scriptIds.set(script.src, m.id);
      // a plugin whose script will not load never registers
      script.onerror = () => log(m.id, `could not load ${m.rendererUrl}`);
      document.body.appendChild(script);
    }
  }

  // The id of the plugin an error comes from, or undefined. An error in a
  // plugin's script is that plugin's. One thrown in this file is the plugin
  // of the first frame of its stack that lies in a plugin's script. Any
  // other is NEO's.
  function pluginOfError(e) {
    if (scriptIds.has(e.filename)) return scriptIds.get(e.filename);
    return hostUrl && e.filename === hostUrl && e.error ? pluginOfStack(e.error.stack) : undefined;
  }

  // The id of the plugin a stack belongs to, or undefined. Its frames that
  // name a script are read from the top: a plugin's script is that plugin's,
  // and this file is the host answering a call, so the stack goes on to the
  // plugin's script below. Any other script before the plugin's (NEO's own
  // code, whether it awaits the plugin or the plugin's call reached it) makes
  // the stack NEO's.
  function pluginOfStack(stack) {
    if (typeof stack !== 'string') return undefined;
    // a frame is "at fn (url:line:col)", "at url:line:col" or, for an
    // anonymous async function, "at async url:line:col"; one that names no
    // script ("at new Promise (<anonymous>)") has no url to give
    const urls = [];
    for (const line of stack.split('\n')) {
      const frame = /^\s*at (?:async )?(?:.*? \()?(.*?):\d+:\d+\)?$/.exec(line);
      if (frame && !frame[1].startsWith('<')) urls.push(frame[1]);
    }
    for (const url of urls) {
      if (scriptIds.has(url)) return scriptIds.get(url);
      if (url !== hostUrl) return undefined;
    }
    return undefined;
  }

  // An error thrown in a plugin's script outside the host's calls, such as
  // from its top level before it registers, or from a timer of its own. It
  // is logged under the plugin's name and goes no further, so NEO's net for
  // errors (app.js, which listens after this file) does not tell the
  // writer. Only the first of a plugin's errors in a minute is logged
  // (logFailure).
  const scriptKeys = new Map(); // plugin id -> the key its script's errors count under
  function logStray(id, err) {
    if (!scriptKeys.has(id)) scriptKeys.set(id, {});
    logFailure(id, scriptKeys.get(id), err);
  }
  function onScriptError(e) {
    const id = pluginOfError(e);
    if (id === undefined) return;
    e.stopImmediatePropagation();
    logStray(id, e.error || `${e.message} @ ${e.filename}:${e.lineno}`);
  }
  window.addEventListener('error', onScriptError);

  // The Errors the host rejects a plugin's invoke with, by the id of the
  // plugin it was called for. A plugin that drops the promise, as in a
  // callback that does not await its invoke, leaves the rejection to the
  // page, where NEO's net would log it every time and tell the writer.
  const reasons = new WeakMap();
  function madeFor(id, err) {
    reasons.set(err, id);
    return err;
  }

  // A rejection nobody handles is a plugin's when the host made it for the
  // plugin, or its stack is the plugin's (pluginOfStack: a callback of its
  // own that throws). It is logged under the plugin's name, with the limit of
  // its script's errors, and goes no further. Any other is NEO's, left to its
  // net.
  function onRejection(e) {
    const reason = e.reason;
    const object = !!reason && (typeof reason === 'object' || typeof reason === 'function');
    const id = object && reasons.has(reason) ? reasons.get(reason) : object ? pluginOfStack(reason.stack) : undefined;
    if (id === undefined) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    logStray(id, reason);
  }
  window.addEventListener('unhandledrejection', onRejection);

  window.NeoPlugins = Object.freeze({ apiVersions: API_VERSIONS, register, attach });
})();
