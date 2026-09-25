// Plattform-Unterschiede zwischen Windows und Linux - an EINER Stelle.
//
// Die Anwendung selbst ist plattformneutral (Chromium + Node). Verschieden
// sind nur zwei Dinge, und die stehen hier:
//   1. der Ordner, in dem die portable Ausgabe liegt (dort liegen die
//      Einstellungsdateien),
//   2. das Programmsymbol (.ico bzw. .png).
//
// Alles andere - Server, Fenster, serielle Ports - ist auf beiden Systemen
// derselbe Code.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';

// ------------------------------------------------------- Ordner der Ausgabe
/**
 * Ordner, in dem die portable Ausgabe wirklich liegt - dorthin gehoeren
 * Einstellungen. Leer, wenn es keine portable Ausgabe ist
 * (dann entscheidet der Aufrufer, siehe exeDir() in main.js).
 *
 * Windows: die Portable-exe entpackt sich nach %TEMP%; electron-builder legt
 * den echten Ordner in PORTABLE_EXECUTABLE_DIR ab.
 * Linux: das AppImage haengt sich nach /tmp/.mount_* ein; APPIMAGE zeigt auf
 * die AppImage-Datei selbst, OWD auf den Ordner, aus dem gestartet wurde.
 */
function portableDir() {
  const win = process.env.PORTABLE_EXECUTABLE_DIR;
  if (win && isDir(win)) return win;
  const img = process.env.APPIMAGE;
  if (img) {
    const d = path.dirname(img);
    if (isDir(d)) return d;
  }
  const owd = process.env.OWD;                 // AppImage: Start-Arbeitsordner
  if (owd && isDir(owd)) return owd;
  return '';
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

// ----------------------------------------------------------- Benutzer-Ablagen
function envDir(name, fallback) {
  const v = process.env[name];
  return v && path.isAbsolute(v) ? v : fallback;
}

// --------------------------------------------------------------------- Symbol
/** Programmsymbol fuer die Fenster. Windows nimmt die .ico, Linux ein PNG. */
function iconFile(appRoot) {
  const name = IS_WIN ? 'icon.ico' : 'icon-256.png';
  const p = path.join(appRoot, 'icon', name);
  if (fs.existsSync(p)) return p;
  const alt = path.join(appRoot, 'icon', IS_WIN ? 'icon-256.png' : 'icon.ico');
  return fs.existsSync(alt) ? alt : p;
}

module.exports = {
  IS_WIN, IS_LINUX, portableDir, iconFile,
};
