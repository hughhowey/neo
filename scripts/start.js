const { spawn } = require('node:child_process');
const fs = require('node:fs');

const args = ['.', ...process.argv.slice(2)];
const env = { ...process.env };
const wayland = process.platform === 'linux' && (env.WAYLAND_DISPLAY || env.XDG_SESSION_TYPE === 'wayland');
const explicitWayland = args.some((arg) => arg === '--ozone-platform=wayland');

if (wayland && !args.some((arg) => arg.startsWith('--ozone-platform='))) {
  args.push('--ozone-platform=x11');
}

if (wayland && !explicitWayland) {
  const multiarch = { x64: 'x86_64-linux-gnu', arm64: 'aarch64-linux-gnu' }[process.arch];
  const modulePath = [
    '/usr/lib/gtk-3.0/modules/libappmenu-gtk-module.so',
    '/usr/lib64/gtk-3.0/modules/libappmenu-gtk-module.so',
    multiarch && `/usr/lib/${multiarch}/gtk-3.0/modules/libappmenu-gtk-module.so`
  ].filter(Boolean).find(fs.existsSync);

  if (modulePath) {
    const modules = new Set((env.GTK_MODULES || '').split(':').filter(Boolean));
    modules.add('appmenu-gtk-module');
    env.GTK_MODULES = [...modules].join(':');
    env.UBUNTU_MENUPROXY ||= '1';
  }
}

const electron = spawn(require('electron'), args, { env, stdio: 'inherit' });
electron.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
electron.on('exit', (code) => {
  process.exitCode = code ?? 1;
});