// Plattform-Unterschiede zwischen Windows, Linux und macOS - an EINER Stelle.
//
// Die Anwendung selbst ist plattformneutral (Chromium + Node). Verschieden
// sind nur drei Dinge, und die stehen hier:
//   1. der Ordner, in dem die portable Ausgabe liegt (dort liegen die
//      Einstellungsdateien) - auf dem Mac der Ordner neben der .app,
//   2. das Programmsymbol (.ico bzw. .png),
//   3. die Menueleiste (macOS braucht eine, sonst gehen Cmd+C/V/Q nicht).
//
// Alles andere - Server, Fenster, serielle Ports - ist auf allen Systemen
// derselbe Code.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';
const IS_MAC = process.platform === 'darwin';

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
 * macOS: siehe macDir().
 */
function portableDir() {
  if (IS_MAC) return macDir();
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

/**
 * macOS: der Ordner, in dem "AI Foam Cut.app" liegt - wie bei exe und
 * AppImage. Drei Faelle, in denen das nicht geht, landen stattdessen in
 * ~/Documents/AI Foam Cut:
 *   - App Translocation: eine heruntergeladene, noch unter Quarantaene
 *     stehende App startet macOS aus einem zufaelligen, schreibgeschuetzten
 *     Ordner (/private/var/folders/.../AppTranslocation/...),
 *   - die App liegt unter /Applications (Einstellungsdateien gehoeren nicht
 *     zwischen die Programme),
 *   - der Ordner ist nicht beschreibbar.
 * Leer ausserhalb einer gepackten .app (Entwicklungsstart).
 */
function macDir() {
  const exe = process.execPath;
  const i = exe.indexOf('.app/Contents/MacOS/');
  if (i < 0) return '';
  const dir = path.dirname(exe.slice(0, i + 4));
  const apps = [path.join(os.homedir(), 'Applications'), '/Applications'];
  const ok = dir.indexOf('/AppTranslocation/') < 0 && apps.indexOf(dir) < 0 && writable(dir);
  if (ok) return dir;
  const docs = path.join(os.homedir(), 'Documents', 'AI Foam Cut');
  try { fs.mkdirSync(docs, { recursive: true }); } catch (e) { /* unten geprueft */ }
  return isDir(docs) ? docs : '';
}

function writable(dir) {
  try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch (e) { return false; }
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

// ----------------------------------------------------------------- Menueleiste
/**
 * macOS: Vorlage fuer Menu.buildFromTemplate(). Ohne Anwendungsmenue gibt es
 * dort weder Cmd+C/V/X/A/Z in Eingabefeldern noch Cmd+Q - unter Windows und
 * Linux bleibt das Menue dagegen ganz weg (null). Reine Daten, damit diese
 * Datei ohne Electron auskommt.
 */
function appMenuTemplate(appName) {
  if (!IS_MAC) return null;
  return [
    { label: appName, submenu: [
      { role: 'about' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ];
}

module.exports = {
  IS_WIN, IS_LINUX, IS_MAC, portableDir, iconFile, appMenuTemplate,
};
