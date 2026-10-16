// Lokaler HTTP-Server - 1:1-Portierung des Handlers aus launcher.py.
// Bewusst beibehalten (statt file:// oder IPC), damit KEINE der 30 JS-Module
// geaendert werden muss: fetch('/__settings__') und fetch('/__machine__')
// funktionieren unveraendert weiter.
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const CFG = require('./config');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.dat': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** Content-Type zu einem Pfad/Dateinamen (leer = unbekannt). Auch der
 *  Hauptprozess benutzt das, um den Header fuer das eigene Fenster notfalls
 *  wiederherzustellen (electron/main.js). */
function mimeFor(name) {
  return MIME[path.extname(String(name || '').split('?')[0]).toLowerCase()] || '';
}

function noCache(res) {
  // Wie in launcher.py: bei festem Port sonst alte Dateien aus dem Cache.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  // Kein MIME-Raten: liefert etwas den Content-Type falsch aus (z. B. ein
  // Virenscanner, der sich in die localhost-Verbindung haengt), soll die Seite
  // hart scheitern statt als Quelltext-Wand zu erscheinen.
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

/** Kurze Klartext-Antwort MIT Content-Type - ohne ihn raet der Browser. */
function sendText(res, text) {
  const buf = Buffer.from(String(text), 'utf-8');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', String(buf.length));
  res.end(buf);
}

/** Systemeigener Speichern-Dialog + direktes Schreiben (/__savefile__). */
// again = schon einmal gewaehlter Pfad: nur solche aus savedPaths (sonst koennte
// die Seite beliebige Dateien schreiben) - fuer Strg+S ohne Dialog.
let saveBusy = Promise.resolve();
const savedPaths = new Set();
function nativeSave(name, data, again) {
  const run = async () => {
    let file = again ? path.normalize(String(again)) : '';
    if (file && !savedPaths.has(file)) file = '';
    if (!file) {
      const { dialog, BrowserWindow } = require('electron');
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
      const ext = path.extname(name).replace(/^\./, '');
      const opts = { defaultPath: name, filters: (ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : []).concat([{ name: '*', extensions: ['*'] }]) };
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return { ok: false, cancel: true };
      file = path.normalize(r.filePath);
    }
    try {
      fs.writeFileSync(file, data);
      if (data.length && fs.statSync(file).size !== data.length) return { ok: false, error: 'size mismatch', path: file };
      savedPaths.add(file);
      return { ok: true, path: file, name: path.basename(file) };
    } catch (e) { return { ok: false, error: String(e && e.message || e), path: file }; }
  };
  const p = saveBusy.then(run, run);   // immer nur ein Dialog
  saveBusy = p.catch(() => {});
  return p;
}

function sendJson(res, data, status) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8');
  res.statusCode = status || 200;
  noCache(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(buf.length));
  res.end(buf);
}

/**
 * @param rootDir  Ordner mit HTML + JS (im gepackten Zustand innerhalb der asar)
 * @param getState () => ({ settingsFile, machineName })
 */
function createServer(rootDir, getState) {
  return http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(url.parse(req.url).pathname || '/');
    } catch (e) {
      res.statusCode = 400; res.end(); return;
    }

    const st = getState();

    if (req.method === 'GET' && pathname === '/__machine__') {
      sendJson(res, JSON.stringify({ name: st.machineName }));
      return;
    }

    if (pathname === '/__settings__') {
      if (req.method === 'GET') {
        fs.readFile(st.settingsFile, (err, data) => {
          if (err) sendJson(res, '', 404);
          else sendJson(res, data);
        });
        return;
      }
      if (req.method === 'POST') {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
          fs.writeFile(st.settingsFile, Buffer.concat(chunks), err => {
            if (err) sendJson(res, '{"ok":false}', 500);
            else sendJson(res, '{"ok":true}');
          });
        });
        req.on('error', () => sendJson(res, '{"ok":false}', 500));
        return;
      }
      res.statusCode = 405; res.end(); return;
    }

    // Rueckfall fuer den Datei-Export: der Browser-Dateizugriff schreibt ueber
    // eine .crswap-Zwischendatei und benennt sie danach um - auf NAS/SMB-
    // Freigaben scheitert das oft. Hier waehlt der Nutzer den Ort im System-
    // dialog, Node schreibt die Datei direkt (wie launcher.py native_save).
    if (pathname === '/__savefile__') {
      if (req.method === 'GET') { sendJson(res, '{"avail":true}'); return; }   // zweiter Schreibweg vorhanden
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        // Nur aus der eigenen Seite (fremde Webseiten duerfen keinen Dialog oeffnen).
        const o = req.headers.origin;
        if (o && o.replace(/^https?:\/\//, '').replace(/\/$/, '') !== String(req.headers.host || '')) { sendJson(res, '{"ok":false}', 403); return; }
        const q = url.parse(req.url, true).query;
        nativeSave(path.basename(String(q.name || 'datei.txt')), Buffer.concat(chunks), q.path)
          .then(r => sendJson(res, JSON.stringify(r)), e => sendJson(res, JSON.stringify({ ok: false, error: String(e && e.message || e) })));
      });
      req.on('error', () => sendJson(res, '{"ok":false}', 500));
      return;
    }

    // Profildatenbank (foildb.js): eine Datei neben der Einstellungsdatei,
    // gemeinsam fuer alle Maschinen-Einstellungsdateien.
    if (pathname === '/__foildb__') {
      const file = path.join(st.settingsFile ? path.dirname(st.settingsFile) : rootDir, 'hotwing-profile.json');
      if (req.method === 'GET') {
        fs.readFile(file, (err, data) => { if (err) sendJson(res, '', 404); else sendJson(res, data); });
        return;
      }
      if (req.method === 'POST') {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
          fs.writeFile(file, Buffer.concat(chunks), err => { if (err) sendJson(res, '{"ok":false}', 500); else sendJson(res, '{"ok":true}'); });
        });
        req.on('error', () => sendJson(res, '{"ok":false}', 500));
        return;
      }
      res.statusCode = 405; res.end(); return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405; res.end(); return;
    }

    // Statische Dateien - nur innerhalb von rootDir (kein Pfad-Ausbruch).
    if (pathname === '/') pathname = '/' + CFG.HTML_NAME;
    const rel = path.normalize(pathname).replace(/^[\\/]+/, '');
    const abs = path.join(rootDir, rel);
    if (!abs.startsWith(rootDir)) { res.statusCode = 403; res.end(); return; }

    const send = (data) => {
      res.statusCode = 200;
      noCache(res);
      res.setHeader('Content-Type', mimeFor(abs) || 'application/octet-stream');
      res.setHeader('Content-Length', String(data.length));
      res.end(req.method === 'HEAD' ? undefined : data);
    };

    fs.readFile(abs, (err, data) => {
      if (err) { res.statusCode = 404; noCache(res); sendText(res, 'Not found'); return; }
      send(data);
    });
  });
}

/** Bindet an 127.0.0.1 - erst die bevorzugten Ports, dann einen freien. */
function listenOnFreePort(server, ports) {
  return new Promise((resolve, reject) => {
    const queue = ports.slice();
    const tryNext = () => {
      const p = queue.length ? queue.shift() : 0;
      const onError = (err) => {
        server.removeListener('error', onError);
        if (err && err.code === 'EADDRINUSE' && (queue.length || p !== 0)) tryNext();
        else reject(err);
      };
      server.once('error', onError);
      server.listen(p, '127.0.0.1', () => {
        server.removeListener('error', onError);
        resolve(server.address().port);
      });
    };
    tryNext();
  });
}

module.exports = { createServer, listenOnFreePort, mimeFor };
