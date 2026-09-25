// Startet den Electron-Server-Handler eigenstaendig (ohne Fenster/Lizenz),
// damit die App exakt wie in der exe gerendert werden kann (inkl. /__settings__).
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { createServer, listenOnFreePort } = require(path.join(ROOT, 'electron', 'server.js'));
const state = {
  machineName: 'Testmaschine',
  settingsFile: path.join(ROOT, 'dist', 'hotwing-settings.json'),
  license: null, demo: null, moduleKey: null,
  codes: function () { return {}; },
};
const server = createServer(ROOT, () => state);
listenOnFreePort(server, [58743, 58744, 58745, 58746]).then(p => {
  console.log('EXE-SERVER listening on http://127.0.0.1:' + p);
}).catch(e => { console.error(e); process.exit(1); });
