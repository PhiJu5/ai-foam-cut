// Electron-Hauptprozess - ersetzt launcher.py.
// Aufgaben: Ablaufdatum pruefen, Maschine/Einstellungsdatei waehlen,
// lokalen Server starten, Fenster oeffnen, serielle Ports bereitstellen.
const { app, BrowserWindow, dialog, ipcMain, Menu, shell, clipboard, screen, net } = require('electron');
const path = require('path');
const fs = require('fs');
const CFG = require('./config');
const P = require('./platform');
const { createServer, listenOnFreePort, mimeFor } = require('./server');

const IS_DEV = !app.isPackaged;

// Ordner mit HTML + JS-Modulen (Projektwurzel; gepackt liegt sie in der asar).
const APP_ROOT = path.join(__dirname, '..');
const ICON = P.iconFile(APP_ROOT);              // Windows .ico, Linux .png

// Ordner, in dem die exe liegt - dort liegen die Einstellungsdateien,
// genau wie bei der Python-Variante (exe_dir()).
function exeDir() {
  if (!app.isPackaged) return APP_ROOT;
  // Portable-Build: die exe entpackt sich nach %TEMP% und laeuft von dort, das
  // AppImage haengt sich nach /tmp/.mount_* ein. app.getPath('exe') zeigt also
  // ins Nirgendwo - die Einstellungen waeren nach jedem Start weg. Den ECHTEN
  // Ordner liefert platform.js aus den Umgebungsvariablen der jeweiligen
  // Verpackung (wie exe_dir() in launcher.py).
  const portable = P.portableDir();
  if (portable) return portable;
  return path.dirname(app.getPath('exe'));
}

const state = {
  settingsFile: '', machineName: '',
};
let mainWindow = null;
let server = null;
// Erst wenn das Hauptfenster steht, darf das Schliessen aller Fenster beenden.
let mainWindowReady = false;

// ---------------------------------------------------------------- Ablaufdatum
function checkExpiry() {
  if (!Array.isArray(CFG.EXPIRY) || CFG.EXPIRY.length < 3) return true;   // ohne Ablaufdatum
  const y = CFG.EXPIRY[0], m = CFG.EXPIRY[1], d = CFG.EXPIRY[2];
  const expiry = new Date(y, m - 1, d, 23, 59, 59);
  if (new Date() <= expiry) return true;
  const s = String(d).padStart(2, '0') + '.' + String(m).padStart(2, '0') + '.' + y;
  dialog.showMessageBoxSync({
    type: 'warning',
    title: CFG.APP_NAME + ' - Testversion abgelaufen',
    message: 'Diese Testversion von ' + CFG.APP_NAME + ' ist am ' + s + ' abgelaufen.',
    detail: 'Bitte eine neue Version anfordern.',
  });
  return false;
}

/** Titel des Hauptfensters. */
function windowTitle() {
  if (CFG.EDITION) return CFG.APP_NAME + ' ' + CFG.EDITION;
  return CFG.APP_NAME;
}

// ------------------------------------------------- Einstellungsdateien finden
function labelFor(p) {
  let name = path.basename(p);
  if (name === CFG.SETTINGS_NAME) {
    name = 'Standard';
  } else {
    if (name.toLowerCase().startsWith('hotwing-settings-')) name = name.slice('hotwing-settings-'.length);
    if (name.toLowerCase().endsWith('.json')) name = name.slice(0, -5);
  }
  return { name: name, isNew: !fs.existsSync(p) };
}

function listSettingsFiles() {
  const folder = exeDir();
  const defaultPath = path.join(folder, CFG.SETTINGS_NAME);
  let files = [];
  try {
    files = fs.readdirSync(folder)
      .filter(function (f) { return /^hotwing-settings.*\.json$/i.test(f); })
      .sort()
      .map(function (f) { return path.join(folder, f); });
  } catch (e) { /* Ordner nicht lesbar -> nur Standard anbieten */ }
  if (files.indexOf(defaultPath) < 0) files.unshift(defaultPath);

  let last = null;
  try {
    last = fs.readFileSync(path.join(folder, CFG.LAST_CHOICE_FILE), 'utf-8').trim();
  } catch (e) { /* noch nie gewaehlt */ }

  return {
    folder: folder,
    defaultPath: defaultPath,
    last: last,
    entries: files.map(function (p) {
      const l = labelFor(p);
      return { path: p, label: l.isNew ? l.name + '  (neu)' : l.name, name: l.name };
    }),
  };
}

function rememberChoice(p) {
  try {
    fs.writeFileSync(path.join(exeDir(), CFG.LAST_CHOICE_FILE), p, 'utf-8');
  } catch (e) { /* nicht schlimm - nur Vorauswahl */ }
}

// ------------------------------------------------------- Auswahlfenster Start
function chooseSettingsFile() {
  return new Promise(function (resolve) {
    const data = listSettingsFiles();
    // Der Dialog erscheint IMMER - wie in launcher.py. Auch wenn erst eine
    // Einstellungsdatei existiert, ist er der einzige Weg zu "Neue Maschine...".
    const win = new BrowserWindow({
      width: 520, height: 420, resizable: false, minimizable: false, maximizable: false,
      title: CFG.APP_NAME, autoHideMenuBar: true, show: false, icon: ICON,
      webPreferences: { preload: path.join(__dirname, 'preload-chooser.js'), contextIsolation: true },
    });
    win.setMenu(null);

    let done = false;
    const finish = function (p) {
      if (done) return;
      done = true;
      ipcMain.removeHandler('chooser:list');
      ipcMain.removeHandler('chooser:browse');
      ipcMain.removeAllListeners('chooser:accept');
      const chosen = p || data.defaultPath;
      rememberChoice(chosen);
      if (!win.isDestroyed()) win.destroy();
      resolve(chosen);
    };

    ipcMain.handle('chooser:list', function () { return data; });
    ipcMain.handle('chooser:browse', async function () {
      const r = await dialog.showOpenDialog(win, {
        title: 'Einstellungsdatei waehlen',
        defaultPath: data.folder,
        filters: [{ name: 'JSON-Einstellungen', extensions: ['json'] }],
        properties: ['openFile'],
      });
      return (r.canceled || !r.filePaths.length) ? null : r.filePaths[0];
    });
    ipcMain.on('chooser:accept', function (_e, p) { finish(p); });

    win.on('closed', function () { finish(null); });
    win.loadFile(path.join(__dirname, 'chooser.html'));
    win.once('ready-to-show', function () { win.show(); });
  });
}

// ------------------------------------------------------------- serielle Ports
// Electron bringt keinen Port-Auswahldialog mit (anders als Chrome):
// navigator.serial.requestPort() loest 'select-serial-port' aus, die Auswahl
// muessen wir selbst anzeigen. Siehe grbl.js.
function setupSerial(session, parent) {
  let pending = null;

  session.on('select-serial-port', function (event, portList, _webContents, callback) {
    event.preventDefault();
    if (!portList.length) {
      dialog.showMessageBox(parent, {
        type: 'info', title: CFG.APP_NAME,
        message: 'Kein serieller Anschluss gefunden.',
        detail: 'Steuerung einschalten, USB-Kabel pruefen und ggf. den Treiber installieren.',
      });
      callback('');
      return;
    }
    if (pending) { callback(''); return; }

    const win = new BrowserWindow({
      width: 480, height: 360, parent: parent, modal: true, resizable: false,
      minimizable: false, maximizable: false, title: 'Anschluss waehlen',
      autoHideMenuBar: true, show: false,
      webPreferences: { preload: path.join(__dirname, 'preload-serial.js'), contextIsolation: true },
    });
    win.setMenu(null);

    pending = { win: win, callback: callback, done: false };
    const finish = function (portId) {
      if (!pending || pending.done) return;
      pending.done = true;
      const cb = pending.callback;
      const w = pending.win;
      pending = null;
      ipcMain.removeHandler('serial:list');
      ipcMain.removeAllListeners('serial:pick');
      if (!w.isDestroyed()) w.destroy();
      cb(portId || '');
    };

    ipcMain.handle('serial:list', function () {
      return portList.map(function (p) {
        return {
          portId: p.portId,
          name: p.displayName || p.portName || ('Anschluss ' + p.portId),
          detail: [p.portName, p.vendorId && ('VID ' + p.vendorId), p.productId && ('PID ' + p.productId)]
            .filter(Boolean).join('  -  '),
        };
      });
    });
    ipcMain.on('serial:pick', function (_e, id) { finish(id); });

    win.on('closed', function () { finish(''); });
    win.loadFile(path.join(__dirname, 'serial.html'));
    win.once('ready-to-show', function () { win.show(); });
  });

  // Web-Serial-Berechtigung fuer die eigene Seite erlauben.
  // local-fonts: Reiter „Schriften" liest Systemschriften (queryLocalFonts).
  session.setPermissionCheckHandler(function (_wc, permission) { return permission === 'serial' || permission === 'local-fonts'; });
  session.setDevicePermissionHandler(function (details) { return details.deviceType === 'serial'; });
}

// --------------------------------------------------------------- Hauptfenster
function createMainWindow(startUrl) {
  // Wasserzeichen in der Titelzeile: bei einer personalisierten Ausgabe steht
  // dort, auf wen sie laeuft - auf Bildschirmfotos und in der Taskleiste.
  const win = new BrowserWindow({
    width: 1500, height: 950, show: false,
    title: windowTitle(), icon: ICON,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);
  // Kein Energiesparen/Bildschirm-Aus-Drosseln waehrend die App laeuft.
  try { require('electron').powerSaveBlocker.start('prevent-app-suspension'); } catch (e) {}
  win.maximize();

  guardContentType(win, startUrl);
  setupSerial(win.webContents.session, win);

  // Externe Links (Forum, Hilfe) im echten Browser oeffnen, nicht in der App;
  win.webContents.setWindowOpenHandler(function (d) {
    if (/^(https?|mailto):/i.test(d.url)) shell.openExternal(d.url);
    return { action: 'deny' };
  });

  // Entwicklerwerkzeuge (F12 / Strg+Shift+I).
  if (CFG.DEVTOOLS) {
    win.webContents.on('before-input-event', function (event, input) {
      if (input.type !== 'keyDown') return;
      const isI = String(input.key).toLowerCase() === 'i';
      if (input.key === 'F12' || (input.control && input.shift && isI)) {
        win.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }

  win.loadURL(startUrl);
  win.once('ready-to-show', function () { win.show(); });
  return win;
}

/**
 * Schutz gegen die „Quelltext-Wand": in seltenen Faellen - beobachtet beim
 * ersten Start einer frisch gebauten exe - kommt die Startseite im Fenster
 * nicht als HTML, sondern als reiner Text an. Der Server liefert sie
 * nachweislich mit text/html aus; unterwegs greift dann etwas in die
 * localhost-Verbindung ein (Virenscanner mit Web-Schutz sind dafuer bekannt).
 *
 * Zwei Schichten:
 *  1. Den Content-Type fuer das eigene Fenster aus der Dateiendung
 *     wiederherstellen, falls er fehlt oder auf text/plain steht.
 *  2. Kommt die Seite trotzdem als Text an, EINMAL neu laden (mit frischem
 *     Zeitstempel). Hilft auch das nicht, lieber eine klare Meldung als eine
 *     Seite, die der Nutzer nicht bedienen kann.
 */
function guardContentType(win, startUrl) {
  const origin = startUrl.split('/').slice(0, 3).join('/') + '/';
  const wr = win.webContents.session.webRequest;

  wr.onHeadersReceived({ urls: [origin + '*'] }, function (details, cb) {
    const want = mimeFor(details.url);
    if (!want) { cb({}); return; }
    const h = Object.assign({}, details.responseHeaders);
    // Header-Namen kommen je nach Gegenstelle in beliebiger Schreibweise.
    const key = Object.keys(h).find(k => k.toLowerCase() === 'content-type');
    const has = key ? String(h[key]) : '';
    if (!key || /text\/plain|octet-stream/i.test(has)) {
      if (key) delete h[key];
      h['Content-Type'] = [want];
      cb({ responseHeaders: h });
      return;
    }
    cb({});
  });

  // Kopfzeilen der Startseite merken - landen im Diagnoseprotokoll, falls die
  // Seite trotzdem falsch ankommt.
  let lastHeaders = null;
  wr.onCompleted({ urls: [origin + '*'] }, function (details) {
    if (/\.html(\?|$)/i.test(details.url)) {
      lastHeaders = { url: details.url, status: details.statusCode, headers: details.responseHeaders };
    }
  });

  // Pruefung im Fenster selbst: Content-Type allein reicht nicht - beim
  // Erststart einer frischen exe wurde die Seite schon mit text/html, aber
  // mit sichtbarem <title>/<style> (Kopfbereich als Fliesstext, CSS wirkt)
  // beobachtet. Deshalb zusaetzlich: gibt es #app, und sind title/style
  // unsichtbar wie in einem normalen HTML-Dokument?
  const PROBE = '(' + function () {
    function disp(sel) {
      try { var el = document.querySelector(sel); return el ? getComputedStyle(el).display : '(fehlt)'; }
      catch (e) { return 'err:' + e.message; }
    }
    var r = {
      contentType: document.contentType, compatMode: document.compatMode,
      readyState: document.readyState,
      ns: document.documentElement && document.documentElement.namespaceURI,
      doctype: document.doctype ? document.doctype.name : null,
      hasApp: !!document.getElementById('app'),
      titleDisplay: disp('title'), styleDisplay: disp('style'),
      headKids: document.head ? document.head.children.length : -1,
      bodyKids: document.body ? document.body.children.length : -1,
      bodyText: document.body ? String(document.body.innerText || '').slice(0, 160) : '',
      htmlStart: document.documentElement ? document.documentElement.outerHTML.slice(0, 400) : '',
    };
    r.ok = /html/i.test(String(r.contentType || '')) && r.hasApp
      && r.titleDisplay === 'none' && r.styleDisplay === 'none';
    return r;
  } + ')()';

  function logStartProblem(info, err) {
    try {
      const line = '[' + new Date().toISOString() + '] Startseite fehlerhaft'
        + (err ? ' (' + err + ')' : '') + '\n'
        + JSON.stringify({ startUrl: startUrl, headers: lastHeaders, probe: info }, null, 1) + '\n\n';
      fs.appendFileSync(path.join(exeDir(), 'afc-start.log'), line, 'utf-8');
    } catch (e) {}
  }

  let repaired = false;
  win.webContents.on('did-finish-load', function () {
    win.webContents.executeJavaScript(PROBE, true)
      .then(function (info) {
        if (!info || !info.ok) {
          const what = info ? (info.contentType + ', #app ' + (info.hasApp ? 'ja' : 'nein')
            + ', title ' + info.titleDisplay + ', style ' + info.styleDisplay) : '?';
          logStartProblem(info, null);
          throw new Error(what);
        }
      })
      .catch(function (err) {
        if (repaired) {
          dialog.showErrorBox(CFG.APP_NAME,
            'Die Programmoberflaeche wurde nicht richtig geladen '
            + '(' + err.message + ').\n\n'
            + 'Das passiert, wenn ein Virenscanner sich in die '
            + 'interne Verbindung haengt. Bitte die exe im Virenscanner als Ausnahme '
            + 'eintragen und das Programm neu starten.\n\n'
            + 'Einzelheiten stehen in afc-start.log neben der exe.');
          return;
        }
        repaired = true;
        // Kurz warten: beim Erststart ist die exe gerade erst entpackt, und
        // Virenscanner pruefen die frischen Dateien noch.
        setTimeout(function () {
          if (win.isDestroyed()) return;
          win.loadURL(startUrl.split('?')[0] + '?_=' + Date.now());
        }, 500);
      });
  });
}

// Chromium drosselt Timer/Renderer, sobald das Fenster verdeckt, minimiert
// oder im Hintergrund ist (Windows-Occlusion). Beim Schneiden laeuft das
// G-Code-Streaming im Renderer -> Ruckeln bei kaum CPU-Last. Abschalten.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,IntensiveWakeUpThrottling');

// ------------------------------------------------------------------ Startlauf
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', function () {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async function () {
    if (!checkExpiry()) { app.quit(); return; }


    const settingsFile = await chooseSettingsFile();
    state.settingsFile = settingsFile;
    state.machineName = labelFor(settingsFile).name;

    server = createServer(APP_ROOT, function () { return state; });
    let port;
    try {
      port = await listenOnFreePort(server, CFG.PREFERRED_PORTS);
    } catch (err) {
      dialog.showErrorBox(CFG.APP_NAME, 'Der interne Server konnte nicht gestartet werden.\n\n' + err.message);
      app.quit();
      return;
    }

    // Belegter Wunschport = es laeuft noch eine andere Instanz (z.B. die
    // Python-Variante). Beide schreiben dieselbe Einstellungsdatei - wie in
    // launcher.py wird darauf hingewiesen.
    if (port !== CFG.PREFERRED_PORTS[0]) {
      dialog.showMessageBox({
        type: 'info', title: CFG.APP_NAME,
        message: 'Es laeuft bereits eine andere AI-Foam-Cut-Instanz.',
        detail: 'Diese hier benutzt deshalb Port ' + port + '. Bitte die andere Instanz '
          + 'schliessen - sonst schreiben beide dieselbe Einstellungsdatei.',
      });
    }
    // Zeitstempel wie in launcher.py: erzwingt nach einem Update eine frische
    // Seite, obwohl der Port fest ist. localStorage haengt am Port, nicht an
    // der Query, und bleibt deshalb erhalten.
    const startUrl = 'http://127.0.0.1:' + port + '/' + encodeURIComponent(CFG.HTML_NAME)
      + '?_=' + Date.now();
    if (IS_DEV) console.log('[AI Foam Cut] ' + startUrl);
    mainWindow = createMainWindow(startUrl);
    mainWindowReady = true;
    mainWindow.on('closed', function () { mainWindow = null; });
  });

  app.on('window-all-closed', function () {
    // Waehrend des Starts ist zwischen dem Schliessen des Auswahlfensters und
    // dem Erscheinen des Hauptfensters kurz KEIN Fenster offen. Ohne diese
    // Sperre beendet sich die App genau dort - der Klick auf "Laden" sah dann
    // wie ein Absturz aus.
    if (!mainWindowReady) return;
    if (server) { try { server.close(); } catch (e) {} }
    app.quit();
  });
}
