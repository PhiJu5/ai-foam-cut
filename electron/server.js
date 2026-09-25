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
