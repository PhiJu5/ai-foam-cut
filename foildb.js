/* foildb.js — Reiter „Profildatenbank": alle jemals geladenen Profile an einem Ort.
 *
 * Jedes Profil, das irgendwo im Programm aus einer Datei gelesen wird (.dat/.bez,
 * DXF/SVG-Kontur, XFLR5-Projekt, Beispielprofile der Auslegung …), landet
 * automatisch hier — dazu werden Airfoil.parseDat/parseBez beim Laden dieses
 * Moduls umhüllt; kein anderes Modul muss davon wissen. Gleiche Konturen
 * (Hash der normierten Punkte) werden nur einmal aufgenommen.
 *
 * Im Reiter: Liste mit Suche/Gruppenfilter, Vergleich mehrerer Profile
 * übereinander (Kennwerte-Tabelle), Bearbeitung (Name, Notiz, Gruppen, Dicke/
 * Wölbung/Endleiste/Punktzahl — Rechenkern aus profedit.js), Einsetzen in die
 * aktive Tragfläche, .dat-Export. Gruppen sind frei benennbar; ein Profil kann in
 * mehreren Gruppen liegen. Die Gruppen erscheinen als Aufklappmenü im
 * Tragflächendesigner (Profilwahl je Rippe) und in der Auslegung.
 *
 * Speicherung: maschinenweit, NICHT im Projekt — Datei `hotwing-profile.json`
 * neben der Einstellungsdatei (Endpunkt /__foildb__ in launcher.py, electron/
 * server.js), im reinen Browser localStorage. Projekte bleiben unabhängig: die
 * Rippenprofile stehen weiterhin komplett im Projekt.
 *
 * Abwählbare Funktion (features.json: „foildb"): andere Module rufen Namen von
 * hier nur geschützt auf (window.FoilDB && …, App.foildbSidebar && …). Ohne das
 * Modul läuft alles wie bisher — nur ohne Datenbank.
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const state = App.state;
  const $ = id => document.getElementById(id);
  const toast = m => (App.toast ? App.toast(m) : void 0);

  const LS_KEY = 'hotwing.foildb.v1';
  const ENDPOINT = '/__foildb__';
  const KFM_NAME = /^\s*(KFm|Knickplatte|Platte)/i;   // Namen aus dem KFm-Gestalter (kfm.js)
  const COLORS = ['#4aa3ff', '#ff8c42', '#57d38c', '#e85d9b', '#ffd166', '#9b7bff', '#37c9d6', '#c0c0c0'];

  // ==================================================================
  //  1. Datenbank + Persistenz
  // ==================================================================
  // profiles: {id, name, pts:[[x,y]…], key, file, src, added, groups:[gid…], note}
  // keepTE (optional): Stufen-/Plattenprofil — die dicke Endleiste gehört zur Form und
  //   wird beim Einsetzen nicht geschlossen (closeLoadedTE in profedit.js achtet darauf).
  // groups:   {id, name}
  let db = { v: 1, autoAdd: true, profiles: [], groups: [] };
  let fileOk = false;        // Endpunkt (Datei neben der exe) erreichbar
  let loadDone = false;
  let saveTimer = null;
  const metricCache = new Map();

  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clonePts = pts => pts.map(q => [+(+q[0]).toFixed(6), +(+q[1]).toFixed(6)]);
  const toProf = (rec) => { const p = rec.pts.map(q => ({ x: q[0], y: q[1] })); p.name = rec.name; if (rec.keepTE) { p.keepTE = true; p.keepAlign = true; } return p; };

  // Kennung einer Kontur: unabhängig von Punktzahl/-verteilung (Resampling auf
  // feste Punkte, 4 Nachkommastellen) — gleiche Profile aus verschiedenen
  // Dateien fallen zusammen.
  function keyOf(prof) {
    try {
      const P = Airfoil.resample(prof, 81);
      let h = 5381;
      const s = P.map(q => q.x.toFixed(4) + ',' + q.y.toFixed(4)).join(';');
      for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
      return 'k' + (h >>> 0).toString(36) + P.length;
    } catch (e) { return null; }
  }
  function sane(d) {
    const out = { v: 1, autoAdd: true, profiles: [], groups: [] };
    if (!d || typeof d !== 'object') return out;
    if (d.autoAdd === false) out.autoAdd = false;
    (Array.isArray(d.groups) ? d.groups : []).forEach(g => {
      if (g && g.id && g.name != null) out.groups.push({ id: String(g.id), name: String(g.name) });
    });
    const gids = new Set(out.groups.map(g => g.id));
    (Array.isArray(d.profiles) ? d.profiles : []).forEach(p => {
      if (!p || !Array.isArray(p.pts) || p.pts.length < 5) return;
      const pts = p.pts.filter(q => Array.isArray(q) && q.length >= 2 && isFinite(q[0]) && isFinite(q[1]));
      if (pts.length < 5) return;
      out.profiles.push({
        id: String(p.id || uid('p')), name: String(p.name || 'Profil'), pts: clonePts(pts),
        key: p.key || null, file: p.file || '', src: p.src || '', added: +p.added || Date.now(),
        groups: (Array.isArray(p.groups) ? p.groups : []).map(String).filter(g => gids.has(g)),
        note: String(p.note || '')
      });
      if (p.keepTE) out.profiles[out.profiles.length - 1].keepTE = true;
    });
    out.profiles.forEach(p => { if (!p.key) p.key = keyOf(toProf(p)); });
    return out;
  }
  // Zwei Stände zusammenführen (Datei gewinnt bei gleicher Kennung).
  function merge(a, b) {
    const out = sane(a);
    const bb = sane(b);
    const gByName = new Map(out.groups.map(g => [g.name, g.id]));
    const gMap = {};
    bb.groups.forEach(g => {
      if (out.groups.some(x => x.id === g.id)) { gMap[g.id] = g.id; return; }
      if (gByName.has(g.name)) { gMap[g.id] = gByName.get(g.name); return; }
      out.groups.push(g); gMap[g.id] = g.id;
    });
    bb.profiles.forEach(p => {
      const hit = out.profiles.find(x => x.key && x.key === p.key) || out.profiles.find(x => x.id === p.id);
      p.groups = p.groups.map(g => gMap[g]).filter(Boolean);
      if (!hit) { out.profiles.push(p); return; }
      p.groups.forEach(g => { if (hit.groups.indexOf(g) < 0) hit.groups.push(g); });
      if (!hit.note && p.note) hit.note = p.note;
    });
    return out;
  }
  function readLocal() {
    try { const s = localStorage.getItem(LS_KEY); if (s) return JSON.parse(s); } catch (e) {}
    return null;
  }
  async function load() {
    let fromFile = null;
    if (typeof fetch === 'function') {
      try {
        const r = await fetch(ENDPOINT, { cache: 'no-store' });
        if (r.ok) { fileOk = true; const t = await r.text(); if (t.trim()) fromFile = JSON.parse(t); }
        else if (r.status === 404) fileOk = true;      // Endpunkt da, Datei noch leer
      } catch (e) { fileOk = false; }
    }
    const local = readLocal();
    // Während des (asynchronen) Ladens bereits aufgenommene Profile behalten.
    const pending = db.profiles.length ? db : null;
    db = fromFile ? merge(fromFile, local) : sane(local);
    if (pending) db = merge(db, pending);
    loadDone = true;
    metricCache.clear();
    if (fromFile || pending) save();
    refreshPickers();                  // Seitenleiste wurde evtl. schon vor dem Laden gebaut
    if (state.activeTab === 'foildb') draw();
  }
  function save() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const json = JSON.stringify(db);
      try { localStorage.setItem(LS_KEY, json); } catch (e) { /* Kontingent voll: Datei bleibt */ }
      if (fileOk && loadDone && typeof fetch === 'function')
        fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json }).catch(() => {});
    }, 300);
  }

  // ---- Zugriff ------------------------------------------------------------
  const list = () => db.profiles.slice();
  const get = id => db.profiles.find(p => p.id === id) || null;
  const groups = () => db.groups.slice();
  const profile = id => { const r = get(id); return r ? toProf(r) : null; };
  const groupName = gid => { const g = db.groups.find(x => x.id === gid); return g ? g.name : ''; };

  // Profil aufnehmen. opts: {name, file, src, groups, keepTE}. Gleiche Kontur → vorhandener
  // Eintrag (Name/Datei werden ergänzt, falls dort nur der Platzhalter steht).
  function add(prof, opts) {
    opts = opts || {};
    if (!prof || prof.length < 5 || !window.Airfoil) return null;
    let p = prof;
    // Stufen-/Plattenprofile: Ausrichtung behalten (Grundplatte = 0°, siehe Airfoil.normalize)
    try { p = Airfoil.normalize(prof.map(q => ({ x: q.x, y: q.y })), { keepAlign: !!(opts.keepTE || prof.keepAlign) }); } catch (e) { return null; }
    const key = keyOf(p);
    const generic = n => !n || /^Profil(\s*\(.*\))?$/i.test(String(n).trim());
    let name = String(opts.name || prof.name || '').trim();
    if (generic(name) && opts.file) name = String(opts.file).replace(/\.[^.]+$/, '');
    if (!name) name = 'Profil';
    // Gleiche Kontur: gleiche Kennung — oder (Stufenprofile: die Kennung kippt an den
    // senkrechten Stufen schon durch Rundung der .dat) punktweise gleiche Koordinaten.
    const hit = db.profiles.find(x => x.key === key)
      || db.profiles.find(x => x.pts.length === p.length && x.pts.every((q, i) => Math.abs(q[0] - p[i].x) < 2e-5 && Math.abs(q[1] - p[i].y) < 2e-5));
    if (hit) {
      if (generic(hit.name) && !generic(name)) hit.name = name;
      if (!hit.file && opts.file) hit.file = String(opts.file);
      if (opts.keepTE) hit.keepTE = true;
      (opts.groups || []).forEach(g => { if (hit.groups.indexOf(g) < 0) hit.groups.push(g); });
      save();
      return hit.id;
    }
    const rec = { id: uid('p'), name, pts: clonePts(p.map(q => [q.x, q.y])), key,
      file: String(opts.file || ''), src: String(opts.src || 'load'), added: Date.now(),
      groups: (opts.groups || []).slice(), note: '' };
    if (opts.keepTE) rec.keepTE = true;
    db.profiles.push(rec);
    save(); refreshPickers();
    if (state.activeTab === 'foildb') draw();
    return rec.id;
  }
  function remove(id) {
    const i = db.profiles.findIndex(p => p.id === id);
    if (i < 0) return;
    db.profiles.splice(i, 1); metricCache.delete(id);
    U.cmp.delete(id); if (U.sel === id) U.sel = null;
    save();
  }
  function addGroup(name) {
    name = String(name || '').trim(); if (!name) return null;
    const ex = db.groups.find(g => g.name === name); if (ex) return ex.id;
    const g = { id: uid('g'), name }; db.groups.push(g); save(); return g.id;
  }
  function renameGroup(gid, name) { const g = db.groups.find(x => x.id === gid); if (g && String(name).trim()) { g.name = String(name).trim(); save(); } }
  function removeGroup(gid) {
    db.groups = db.groups.filter(g => g.id !== gid);
    db.profiles.forEach(p => { p.groups = p.groups.filter(g => g !== gid); });
    if (U.group === gid) U.group = 'all';
    save();
  }
  function setGroups(id, gids) { const p = get(id); if (p) { p.groups = gids.slice(); save(); } }
  function assignGroup(recs, gid, on) {
    recs.forEach(p => { const i = p.groups.indexOf(gid); if (on && i < 0) p.groups.push(gid); if (!on && i >= 0) p.groups.splice(i, 1); });
    save();
  }
  // Nach Anlegen/Umbenennen/Löschen einer Gruppe: Gruppenfilter im Reiter, Liste,
  // Seitenleiste (Gruppen verwalten) und alle lebenden Aufklappmenüs sofort nachziehen.
  function groupsChanged() {
    fillGroupSelect(); drawList(); drawTable(); refreshPickers();
    if (state.activeTab === 'foildb' && App.buildSidebar) App.buildSidebar();
  }

  // ---- Automatische Aufnahme: Airfoil.parseDat/parseBez umhüllen ------------
  (function hookAirfoil() {
    if (!window.Airfoil) return;
    // .dat aus dem KFm-Gestalter beim Einlesen nicht drehen (Platte bleibt bei 0°)
    Airfoil.keepAlignName = n => KFM_NAME.test(n);
    ['parseDat', 'parseBez'].forEach(fn => {
      const orig = Airfoil[fn]; if (typeof orig !== 'function') return;
      Airfoil[fn] = function (text) {
        const p = orig.apply(this, arguments);
        // Stufen-/Plattenprofile aus dem Gestalter (auch als .dat von einem anderen
        // Rechner): dicke Endleiste beim Einsetzen stehen lassen.
        const kfm = KFM_NAME.test(String(p && p.name || ''));
        if (db.autoAdd) { try { const r = get(add(p, { src: fn === 'parseBez' ? 'bez' : 'dat', keepTE: kfm })); if (r && r.keepTE) p.keepTE = true; } catch (e) {} }
        else if (kfm) p.keepTE = true;
        else { try { const k = keyOf(Airfoil.normalize(p.map(q => ({ x: q.x, y: q.y })))); if (db.profiles.some(x => x.keepTE && x.key === k)) p.keepTE = true; } catch (e) {} }
        return p;
      };
    });
  })();

  // ==================================================================
  //  2. Kennwerte
  // ==================================================================
  // Dicke/Wölbung/Endleiste in Sehnenanteilen; nach dem Resampling (201 Punkte,
  // Nase bei Index 100) liegen Ober-/Unterseite paarweise (i, N-1-i).
  function metrics(rec) {
    if (metricCache.has(rec.id)) return metricCache.get(rec.id);
    const m = metricsOf(toProf(rec)); m.n = rec.pts.length;
    metricCache.set(rec.id, m); return m;
  }
  function metricsOf(prof) {
    const P = Airfoil.resample(prof, 201), N = P.length, iLE = 100;
    let th = 0, thX = 0, cam = 0, camX = 0, leR = 0;
    for (let i = 0; i < iLE; i++) {
      const a = P[i], b = P[N - 1 - i];
      const t = a.y - b.y, mx = (a.x + b.x) / 2, c = (a.y + b.y) / 2;
      if (t > th) { th = t; thX = mx; }
      if (Math.abs(c) > Math.abs(cam)) { cam = c; camX = mx; }
    }
    // Nasenradius: Kreis durch drei Punkte um die Nase (grobe Kennzahl).
    try {
      const a = P[iLE - 3], b = P[iLE], c = P[iLE + 3];
      const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
      if (Math.abs(d) > 1e-12) {
        const ux = ((a.x * a.x + a.y * a.y) * (b.y - c.y) + (b.x * b.x + b.y * b.y) * (c.y - a.y) + (c.x * c.x + c.y * c.y) * (a.y - b.y)) / d;
        const uy = ((a.x * a.x + a.y * a.y) * (c.x - b.x) + (b.x * b.x + b.y * b.y) * (a.x - c.x) + (c.x * c.x + c.y * c.y) * (b.x - a.x)) / d;
        leR = Math.hypot(a.x - ux, a.y - uy);
      }
    } catch (e) {}
    const te = Math.abs(P[0].y - P[N - 1].y);
    return { thick: th, thickX: thX, cam, camX, te, leR, n: prof.length };
  }
  const pct = (v, d) => (v * 100).toFixed(d == null ? 1 : d) + ' %';

  // ==================================================================
  //  3. Ansicht (Reiter)
  // ==================================================================
  const U = { sel: null, cmp: new Set(), filter: '', group: 'all', sort: 'name', edit: null, kfm: null,
    view: { zoom: 1, px: 0, py: 0 }, drag: null };
  let wired = false;

  function visible() {
    const f = U.filter.trim().toLowerCase();
    let arr = db.profiles.filter(p => {
      if (U.group === 'none' && p.groups.length) return false;
      if (U.group !== 'all' && U.group !== 'none' && p.groups.indexOf(U.group) < 0) return false;
      if (f && (p.name + ' ' + p.file + ' ' + p.note).toLowerCase().indexOf(f) < 0) return false;
      return true;
    });
    const key = { name: p => p.name.toLowerCase(), added: p => -p.added, thick: p => -metrics(p).thick, cam: p => -metrics(p).cam };
    const k = key[U.sort] || key.name;
    arr.sort((a, b) => { const x = k(a), y = k(b); return x < y ? -1 : x > y ? 1 : 0; });
    return arr;
  }
  function thumb(rec, w, h, col) {
    const pad = 2, sc = (w - 2 * pad);
    const pts = rec.pts.map(p => (pad + p[0] * sc).toFixed(1) + ',' + (h / 2 - p[1] * sc).toFixed(1)).join(' ');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '"><polyline points="' + pts + '" fill="none" stroke="' + (col || 'var(--txt)') + '" stroke-width="0.9"/></svg>';
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cmpColor = id => { const arr = [...U.cmp]; const i = arr.indexOf(id); return i < 0 ? null : COLORS[i % COLORS.length]; };

  function drawList() {
    const box = $('fdbList'); if (!box) return;
    const arr = visible();
    const cnt = $('fdbCount'); if (cnt) cnt.textContent = arr.length + ' / ' + db.profiles.length;
    if (!db.profiles.length) {
      box.innerHTML = '<div class="fdb-hint">' + T('Noch keine Profile. Alles, was du im Programm lädst (.dat/.bez, DXF/SVG-Kontur, XFLR5-Projekt), landet automatisch hier — oder über „Profile importieren…" in der Seitenleiste.') + '</div>';
      return;
    }
    if (!arr.length) { box.innerHTML = '<div class="fdb-hint">' + T('Kein Profil passt zu Suche/Gruppe.') + '</div>'; return; }
    box.innerHTML = arr.map(p => {
      const m = metrics(p), col = cmpColor(p.id);
      const gs = p.groups.map(g => '<span class="fdb-chip">' + esc(groupName(g)) + '</span>').join('');
      return '<div class="fdb-row' + (U.sel === p.id ? ' sel' : '') + '" data-id="' + p.id + '">' +
        '<input type="checkbox" data-cmp="' + p.id + '"' + (col ? ' checked' : '') + ' title="' + T('Vergleichen') + '">' +
        thumb(p, 60, 24, col) +
        '<div class="fdb-info"><div class="fdb-name" title="' + esc(p.file || p.name) + '">' + esc(p.name) + '</div>' +
        '<div class="fdb-meta">t ' + pct(m.thick) + ' @ ' + Math.round(m.thickX * 100) + ' % · f ' + pct(m.cam, 2) + ' @ ' + Math.round(m.camX * 100) + ' % · ' + m.n + ' ' + T('Pkt.') + '</div>' +
        (gs ? '<div class="fdb-chips">' + gs + '</div>' : '') + '</div></div>';
    }).join('');
    box.querySelectorAll('.fdb-row').forEach(r => r.addEventListener('click', e => {
      if (e.target && e.target.dataset && e.target.dataset.cmp) return;
      select(r.dataset.id);
    }));
    box.querySelectorAll('[data-cmp]').forEach(c => c.addEventListener('change', e => {
      const id = e.target.dataset.cmp;
      if (e.target.checked) U.cmp.add(id); else U.cmp.delete(id);
      drawList(); drawCanvas(); drawDetail();   // Gruppen-Block gilt für alle angehakten
    }));
  }
  function select(id) {
    if (U.sel === id && !U.kfm) return;
    U.sel = id; U.edit = null; U.kfm = null;
    drawList(); drawCanvas(); drawDetail();
  }

  // ---- Vergleichsbild -------------------------------------------------------
  function drawCanvas() {
    const cv = $('cFoilDb'); if (!cv) return;
    const box = cv.parentElement, dpr = window.devicePixelRatio || 1;
    const W = box.clientWidth, H = box.clientHeight; if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const cssVar = (n, fb) => (getComputedStyle(document.documentElement).getPropertyValue(n) || '').trim() || fb;
    const txtCol = cssVar('--txt', '#ddd'), accCol = cssVar('--accent2', '#ff8c42');
    const items = [];
    [...U.cmp].forEach((id, i) => { const r = get(id); if (r) items.push({ pts: toProf(r), col: COLORS[i % COLORS.length], name: r.name, w: 1.4 }); });
    if (U.sel && !U.cmp.has(U.sel)) { const r = get(U.sel); if (r) items.push({ pts: toProf(r), col: txtCol, name: r.name, w: 1.6 }); }
    if (U.kfm && U.kfm.preview) items.push({ pts: U.kfm.preview, col: accCol, name: U.kfm.preview.name + ' — ' + T('Entwurf'), w: 1.8 });
    else if (U.edit && U.edit.preview) items.push({ pts: U.edit.preview, col: accCol, name: T('Vorschau (bearbeitet)'), w: 1.4, dash: [5, 4] });
    const pad = 30, v = U.view;
    const sc = (W - 2 * pad) * v.zoom, ox = pad + v.px, oy = H / 2 + v.py;
    const X = x => ox + x * sc, Y = y => oy - y * sc;
    // Sehne + Raster
    g.strokeStyle = 'rgba(128,128,128,.35)'; g.lineWidth = 1; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(1), Y(0)); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(128,128,128,.7)'; g.font = '10px ' + (getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace');
    for (let i = 0; i <= 10; i++) {
      const x = X(i / 10); g.fillRect(x, Y(0) - 3, 1, 6);
      if (i % 2 === 0) g.fillText((i * 10) + '%', x - 8, Y(0) + 14);
    }
    if (!items.length) {
      g.fillStyle = 'rgba(128,128,128,.8)'; g.font = '12px sans-serif';
      g.fillText(T('Profil in der Liste anklicken; Häkchen = mehrere übereinander vergleichen.'), pad, 24);
      return;
    }
    items.forEach(it => {
      g.strokeStyle = it.col; g.lineWidth = it.w; g.setLineDash(it.dash || []);
      g.beginPath();
      it.pts.forEach((p, i) => { const x = X(p.x), y = Y(p.y); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke(); g.setLineDash([]);
    });
    // Legende
    let ly = 34;                       // unter der Kopfzeile der Ansicht
    g.font = '11px sans-serif';
    items.forEach(it => {
      g.fillStyle = it.col; g.fillRect(pad, ly - 8, 14, 3);
      g.fillStyle = txtCol;
      g.fillText(it.name, pad + 20, ly); ly += 15;
    });
  }
  function wireCanvas() {
    const cv = $('cFoilDb'); if (!cv || cv.dataset.wired) return; cv.dataset.wired = '1';
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const v = U.view, r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15, W = r.width, pad = 30;
      // Zoom um den Mauszeiger
      const sc0 = (W - 2 * pad) * v.zoom, ox0 = pad + v.px, oy0 = r.height / 2 + v.py;
      const wx = (mx - ox0) / sc0, wy = (oy0 - my) / sc0;
      v.zoom = Math.max(0.2, Math.min(40, v.zoom * f));
      const sc1 = (W - 2 * pad) * v.zoom;
      v.px = mx - pad - wx * sc1; v.py = my - r.height / 2 + wy * sc1;
      drawCanvas();
    }, { passive: false });
    cv.addEventListener('mousedown', e => { U.drag = { x: e.clientX, y: e.clientY, px: U.view.px, py: U.view.py }; });
    window.addEventListener('mousemove', e => { if (!U.drag) return; U.view.px = U.drag.px + e.clientX - U.drag.x; U.view.py = U.drag.py + e.clientY - U.drag.y; drawCanvas(); });
    window.addEventListener('mouseup', () => { U.drag = null; });
    cv.addEventListener('dblclick', () => { U.view = { zoom: 1, px: 0, py: 0 }; drawCanvas(); });
    if (window.ResizeObserver) new ResizeObserver(() => drawCanvas()).observe(cv.parentElement);
  }

  // ---- Kennwerte-Tabelle der verglichenen Profile ----------------------------
  function drawTable() {
    const box = $('fdbTable'); if (!box) return;
    const ids = [...U.cmp]; if (U.sel && ids.indexOf(U.sel) < 0) ids.push(U.sel);
    const recs = ids.map(get).filter(Boolean);
    box.style.display = ''; box.style.flexDirection = ''; box.style.gap = ''; box.style.paddingBottom = '';
    if (!recs.length || U.kfm) { box.innerHTML = ''; return; }
    const rows = [
      [T('Max. Dicke'), r => pct(metrics(r).thick)], [T('Dickenrücklage'), r => pct(metrics(r).thickX, 0)],
      [T('Max. Wölbung'), r => pct(metrics(r).cam, 2)], [T('Wölbungsrücklage'), r => pct(metrics(r).camX, 0)],
      [T('Endleistendicke'), r => pct(metrics(r).te, 2)], [T('Nasenradius'), r => pct(metrics(r).leR, 2)],
      [T('Punkte'), r => String(r.pts.length)], [T('Gruppen'), r => r.groups.map(groupName).join(', ') || '—'],
      [T('Quelle'), r => esc(r.file || (r.src === 'kfm' ? T('KFm-Gestalter') : r.src === 'naca' ? 'NACA' : r.src === 'wing' ? T('Tragfläche') : T('geladen')))]
    ];
    box.innerHTML = '<table class="fdb-tbl"><thead><tr><th></th>' + recs.map(r => {
      const col = cmpColor(r.id) || 'var(--txt)';
      return '<th><span class="fdb-dot" style="background:' + col + '"></span>' + esc(r.name) + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows.map(rw => '<tr><td>' + rw[0] + '</td>' + recs.map(r => '<td>' + rw[1](r) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  }

  // ---- Detail / Bearbeitung ---------------------------------------------------
  function drawDetail() {
    const box = $('fdbDetail'); if (!box) return;
    if (U.kfm) { drawKfm(box); drawTable(); kfmPolarPanel(); return; }
    const r = get(U.sel);
    if (!r) { box.innerHTML = '<div class="fdb-hint">' + T('Kein Profil gewählt.') + '</div>'; drawTable(); return; }
    const m = metrics(r);
    box.textContent = '';
    const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
    const field = (label, el, unit) => { const f = mk('div', 'fdb-field'); f.appendChild(mk('label', null, T(label))); f.appendChild(el); if (unit) f.appendChild(mk('span', 'u', unit)); box.appendChild(f); return el; };
    const num = (val, step, min, max) => { const i = document.createElement('input'); i.type = 'number'; i.value = val; i.step = step; if (min != null) i.min = min; if (max != null) i.max = max; return i; };

    // Kopf: Name, Datei, Notiz
    box.appendChild(mk('div', 'gh', T('Profil')));
    { const i = document.createElement('input'); i.type = 'text'; i.value = r.name; i.style.width = '100%';
      i.onchange = () => { r.name = i.value.trim() || 'Profil'; save(); drawList(); drawCanvas(); drawTable(); };
      field('Name', i); }
    if (r.file) { const f = mk('div', 'fdb-hint'); f.textContent = T('Datei') + ': ' + r.file + ' · ' + new Date(r.added).toLocaleDateString(); box.appendChild(f); }
    { const ta = document.createElement('textarea'); ta.rows = 2; ta.value = r.note; ta.placeholder = T('Notiz (Verwendung, Quelle, Erfahrungen …)');
      ta.onchange = () => { r.note = ta.value; save(); }; ta.style.width = '100%'; box.appendChild(ta); }

    // Gruppen — Mehrfachauswahl: die Zuordnung gilt für das gewählte Profil UND
    // alle in der Liste angehakten Profile auf einmal. Haken teils gesetzt =
    // nur ein Teil der Profile liegt in der Gruppe.
    const targetsG = [...new Set([r.id, ...U.cmp])].map(get).filter(Boolean);
    box.appendChild(mk('div', 'gh', T('Gruppen') + (targetsG.length > 1 ? ' · ' + targetsG.length + ' ' + T('Profile') : '')));
    if (targetsG.length > 1) box.appendChild(mk('div', 'fdb-hint', T('Zuordnung gilt für alle angehakten Profile: ') + targetsG.map(p => p.name).join(', ')));
    { const wrap = mk('div', 'fdb-groups');
      if (!db.groups.length) wrap.appendChild(mk('span', 'fdb-hint', T('Noch keine Gruppen — unten anlegen.')));
      db.groups.forEach(g => {
        const l = mk('label'); const c = document.createElement('input'); c.type = 'checkbox';
        const n = targetsG.filter(p => p.groups.indexOf(g.id) >= 0).length;
        c.checked = n === targetsG.length; c.indeterminate = n > 0 && n < targetsG.length;
        c.onchange = () => { assignGroup(targetsG, g.id, c.checked); drawDetail(); drawList(); drawTable(); refreshPickers(); };
        l.appendChild(c); l.appendChild(document.createTextNode(' ' + g.name)); wrap.appendChild(l);
      });
      box.appendChild(wrap);
      const row = mk('div', 'fdb-btns');
      const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = T('Neue Gruppe (z. B. „Thermik", „Speed", „Leitwerk")'); inp.style.flex = '1';
      const b = mk('button', null, T('+ Gruppe'));
      const go = () => { const gid = addGroup(inp.value); if (!gid) return; assignGroup(targetsG, gid, true); inp.value = ''; groupsChanged(); drawDetail(); };
      b.onclick = go; inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
      row.appendChild(inp); row.appendChild(b); box.appendChild(row); }

    // Bearbeitung
    box.appendChild(mk('div', 'gh', T('Bearbeiten')));
    if (!U.edit) U.edit = { base: toProf(r), n: r.pts.length, thick: +(m.thick * 100).toFixed(2), cam: +(m.cam * 100).toFixed(2), te: +(m.te * 100).toFixed(2), preview: null };
    const E = U.edit;
    const canEdit = !!(App.scaleThickCam && App.thickenTE);
    const upd = () => { E.preview = computeEdit(E); drawCanvas(); };
    field('Punktzahl', num(E.n, 1, 20, 600)).onchange = function () { E.n = Math.max(20, Math.min(600, this.value | 0)); upd(); };
    field('Max. Dicke', num(E.thick, 0.1, 1, 60), '%').onchange = function () { E.thick = +this.value; upd(); };
    field('Max. Wölbung', num(E.cam, 0.05, -20, 20), '%').onchange = function () { E.cam = +this.value; upd(); };
    field('Endleistendicke', num(E.te, 0.05, 0, 10), '%').onchange = function () { E.te = +this.value; upd(); };
    { const h = mk('div', 'fdb-hint', T('Dicken- und Wölbungsverteilung werden proportional skaliert (Rechenkern der Profilbearbeitung); die Endleiste durch Drehen der Ober-/Unterseite um die Nase. Werte in % der Sehne. Vorschau gestrichelt im Bild.'));
      if (!canEdit) h.textContent = T('Profilbearbeitung (profedit.js) fehlt in diesem Build — nur Punktzahl änderbar.');
      box.appendChild(h); }
    { const row = mk('div', 'fdb-btns');
      const b1 = mk('button', null, T('Übernehmen')); b1.title = T('Dieses Profil in der Datenbank mit der Bearbeitung überschreiben');
      b1.onclick = () => { const p = computeEdit(E); if (!p) return; r.pts = clonePts(p.map(q => [q.x, q.y])); r.key = keyOf(p); metricCache.delete(r.id); U.edit = null; save(); drawList(); drawDetail(); drawCanvas(); };
      const b2 = mk('button', null, T('Als Kopie speichern')); b2.title = T('Bearbeitung als neues Profil anlegen, das Original bleibt');
      b2.onclick = () => { const p = computeEdit(E); if (!p) return; const nm = window.prompt(T('Name des neuen Profils:'), r.name + ' mod'); if (nm == null) return;
        const rec = { id: uid('p'), name: nm.trim() || (r.name + ' mod'), pts: clonePts(p.map(q => [q.x, q.y])), key: keyOf(p), file: '', src: 'edit', added: Date.now(), groups: r.groups.slice(), note: T('abgeleitet von ') + r.name };
        if (r.keepTE) rec.keepTE = true;
        db.profiles.push(rec); save(); U.edit = null; select(rec.id); };
      const b3 = mk('button', null, T('Zurücksetzen')); b3.onclick = () => { U.edit = null; drawDetail(); drawCanvas(); };
      row.appendChild(b1); row.appendChild(b2); row.appendChild(b3); box.appendChild(row); }

    // Polaren (Rechenkern des Reiters „Aerodynamik“: NeuralFoil / 2D-Windkanal)
    box.appendChild(mk('div', 'gh', T('Polaren')));
    if (window.Aero && Aero.openFoilView && (window.NeuralFoil || (App.aeroXfoil && App.aeroXfoil.ready()))) {
      const row = mk('div', 'fdb-btns');
      const ids = [...U.cmp]; if (ids.indexOf(r.id) < 0) ids.unshift(r.id);
      const b = mk('button', 'primary', T('▶ Profilpolaren rechnen …'));
      b.title = T('cl(α), Polare, Gleitzahl, cm, Umschlag je Re-Zahl — für dieses Profil und alle zum Vergleich angehakten (NeuralFoil bzw. 2D-Windkanal, CSV-Export)');
      b.onclick = () => openPolars();
      row.appendChild(b); box.appendChild(row);
      box.appendChild(mk('div', 'fdb-hint', ids.length > 1 ? T('Gerechnet werden: ') + ids.map(i => (get(i) || {}).name).filter(Boolean).join(', ') : T('Nur dieses Profil — für mehrere Kurven weitere Profile zum Vergleich anhaken.')));
    } else box.appendChild(mk('div', 'fdb-hint', T('Polarenrechnung braucht die Funktion „Aerodynamik“ (NeuralFoil / 2D-Windkanal) — in diesem Build nicht enthalten.')));

    // Verwenden
    box.appendChild(mk('div', 'gh', T('Verwenden')));
    { const row = mk('div', 'fdb-btns');
      const sel = document.createElement('select');
      targets().forEach(t => { const o = document.createElement('option'); o.value = String(t.id); o.textContent = t.label; sel.appendChild(o); });
      const b = mk('button', 'primary', T('In Tragfläche einsetzen'));
      b.onclick = () => { applyToTarget(toProf(r), sel.value === 'root' ? { type: 'root' } : { type: 'seg', idx: +sel.value }); toast(T('Profil eingesetzt: ') + r.name); };
      row.appendChild(sel); row.appendChild(b); box.appendChild(row);
      const row2 = mk('div', 'fdb-btns');
      const bd = mk('button', null, T('.dat exportieren…')); bd.onclick = () => exportDat(r);
      const bx = mk('button', null, T('Löschen')); bx.style.color = 'var(--bad)';
      bx.onclick = () => { if (!window.confirm(T('Profil aus der Datenbank löschen?') + '\n' + r.name)) return; remove(r.id); drawList(); drawDetail(); drawCanvas(); refreshPickers(); };
      row2.appendChild(bd); row2.appendChild(bx); box.appendChild(row2); }
    drawTable();
  }
  // ---- Gestalter für Stufenprofile (KFm) und Platten-/Knickprofile -------------
  // Rechenkern in kfm.js; hier nur die Eingabemaske (ersetzt die Detailspalte,
  // solange U.kfm gesetzt ist) — der Entwurf läuft live im Vergleichsbild mit.
  let kfmLast = null;                // zuletzt geschlossener Entwurf (wieder öffnen)
  function openKfm() {
    if (!window.KFm) { window.alert(T('Der KFm-Gestalter (kfm.js) fehlt in diesem Build.')); return; }
    if (!U.kfm) U.kfm = kfmLast || { P: KFm.defaults('kfm2'), name: '', chord: 200, preview: null };
    kfmUpdate(); drawDetail();
  }
  function kfmProfile() {
    const K = U.kfm; if (!K) return null;
    try {
      const p = Airfoil.normalize(KFm.build(K.P), { keepAlign: true });   // Grundplatte = 0°, Nase zählt nicht
      p.name = K.name.trim() || KFm.autoName(K.P);
      return p;
    } catch (e) { return null; }
  }
  function kfmUpdate() { if (!U.kfm) return; U.kfm.preview = kfmProfile(); drawCanvas(); kfmPolarSoon(); }

  // Live-Polare zum Entwurf (NeuralFoil aus dem Reiter „Aerodynamik"): läuft nach
  // jeder Änderung kurz verzögert mit; die vorige Kurve bleibt gestrichelt zum
  // Vergleich stehen. Ohne NeuralFoil im Build bleibt der Abschnitt weg.
  const kfmNF = () => !!(window.NeuralFoil && NeuralFoil.ready && NeuralFoil.ready());
  const kfmXF = () => (App.aeroXfoil && App.aeroXfoil.ready()) ? App.aeroXfoil : null;
  let kfmPolT = 0, kfmPolRun = 0;
  // Rechner der Live-Polare: K.calc 'nf' (NeuralFoil, sofort) oder 'xfoil'
  // (echtes xfoil.exe, einige Sekunden — asynchron, veraltete Ergebnisse verworfen)
  function kfmPolarSoon() {
    const K = U.kfm; if (!K || !(kfmNF() || kfmXF())) return;
    clearTimeout(kfmPolT);
    if (K.calc === 'xfoil' && kfmXF()) {
      kfmPolT = setTimeout(async () => {
        if (U.kfm !== K || !K.preview) return;
        const id = ++kfmPolRun, Re = K.re || 1e5;
        const a0 = K.a0 != null ? K.a0 : -6, a1 = K.a1 != null ? K.a1 : 16;
        K.polBusy = true; kfmPolarDraw();
        const X = kfmXF();
        const res = await X.run([{ prof: K.preview, name: 'KFm', Re, ncrit: 9, a0: Math.min(a0, a1), a1: Math.max(a0, a1), da: K.da || 0.5 }]);
        if (id !== kfmPolRun || U.kfm !== K) return;
        const r = res && res[0] ? X.polarOf(res[0]) : null;
        K.opPt = null;
        if (r && isFinite(K.aOp)) {           // Betriebspunkt: zwischen den Polarpunkten über α
          const P = r.pts;
          for (let i = 0; i < P.length - 1; i++) if (K.aOp >= P[i].alpha && K.aOp <= P[i + 1].alpha) {
            const t = (K.aOp - P[i].alpha) / ((P[i + 1].alpha - P[i].alpha) || 1), L = (k) => P[i][k] + (P[i + 1][k] - P[i][k]) * t;
            K.opPt = { alpha: K.aOp, cl: L('cl'), cd: L('cd'), cm: L('cm'), xtrU: L('xtrU'), xtrL: L('xtrL') }; break;
          }
        }
        K.polBusy = false;
        if (K.pol && K.pol.pts && K.pol.pts.length) K.polPrev = K.pol;
        K.pol = r && r.pts && r.pts.length ? r : null;
        kfmPolarDraw(); kfmCmp(K);
      }, 600);
      return;
    }
    if (!kfmNF()) return;
    kfmPolT = setTimeout(() => {
      if (U.kfm !== K || !K.preview) return;
      // α bezieht sich auf die waagrechte Grundplatte (NeuralFoil rechnet intern zur Sehne gedreht)
      // α-Bereich und optionaler Betriebspunkt aus dem Polarfeld (K.a0/a1/da/aOp)
      let r = null; K.opPt = null;
      try {
        const m = NeuralFoil.build(K.preview), Re = K.re || 1e5;
        if (m) {
          const a0 = K.a0 != null ? K.a0 : -6, a1 = K.a1 != null ? K.a1 : 16;
          r = m.polar({ Re, a0: Math.min(a0, a1), a1: Math.max(a0, a1), da: K.da || 0.5 });
          if (isFinite(K.aOp)) K.opPt = m.run(K.aOp, Re);
        }
      } catch (e) { r = null; }
      if (K.pol && K.pol.pts && K.pol.pts.length) K.polPrev = K.pol;
      K.pol = r && r.pts && r.pts.length ? r : null;
      kfmPolarDraw(); kfmCmp(K);
    }, 150);
  }
  // Vergleich NeuralFoil ↔ XFOIL (K.cmp): derselbe Entwurf mit der anderen
  // Methode als K.polCmp (gestrichelt in der Entwurfsfarbe)
  let kfmCmpRun = 0;
  async function kfmCmp(K) {
    const id = ++kfmCmpRun;
    if (!K.cmp || !K.preview || !K.pol) { K.polCmp = null; return; }
    const other = K.calc === 'xfoil' && kfmXF() ? 'nf' : 'xfoil';
    const Re = K.re || 1e5, a0 = K.a0 != null ? K.a0 : -6, a1 = K.a1 != null ? K.a1 : 16;
    let r = null;
    if (other === 'nf') {
      try { const m = kfmNF() ? NeuralFoil.build(K.preview) : null; r = m ? m.polar({ Re, a0: Math.min(a0, a1), a1: Math.max(a0, a1), da: K.da || 0.5 }) : null; } catch (e) { r = null; }
    } else {
      const X = kfmXF(); if (!X) { K.polCmp = null; K.polCmpWhy = App.aeroXfoil ? App.aeroXfoil.why() : ''; kfmPolarDraw(); return; }
      const res = await X.run([{ prof: K.preview, name: 'KFm', Re, ncrit: 9, a0: Math.min(a0, a1), a1: Math.max(a0, a1), da: K.da || 0.5 }]);
      if (id !== kfmCmpRun || U.kfm !== K) return;
      r = res && res[0] ? X.polarOf(res[0]) : null;
    }
    K.polCmp = r && r.pts && r.pts.length ? r : null; K.polCmpName = other === 'nf' ? 'NeuralFoil' : 'XFOIL'; K.polCmpWhy = '';
    kfmPolarDraw();
  }
  // Polaren-Feld rechts neben der Eingabemaske (statt der Kennwert-Tabelle).
  // Polaren-Feld rechts neben der Eingabemaske (statt der Kennwert-Tabelle).
  // Diagramme wie im Reiter „Aerodynamik" (Aero.drawChart): je Feld wählbar,
  // Rad = Zoom um den Zeiger, Ziehen = Achse strecken/stauchen, Shift-/Rechts-
  // Ziehen = verschieben, Doppelklick = alles, Legende = Kurve ein/aus.
  const KFM_CH = [
    { id: 'pol', title: 'Polare cl über cd', xlab: 'cd', ylab: 'cl', fx: q => q.cd, fy: q => q.cl },
    { id: 'cla', title: 'cl über α', xlab: 'α (°)', ylab: 'cl', fx: q => q.alpha, fy: q => q.cl },
    { id: 'gz', title: 'Gleitzahl cl/cd über α', xlab: 'α (°)', ylab: 'cl/cd', fx: q => q.alpha, fy: q => q.cl / q.cd },
    { id: 'gzcl', title: 'Gleitzahl cl/cd über cl', xlab: 'cl', ylab: 'cl/cd', fx: q => q.cl, fy: q => q.cl / q.cd },
    { id: 'sz', title: 'Steigzahl cl¹·⁵/cd über cl', xlab: 'cl', ylab: 'cl¹·⁵/cd', fx: q => q.cl, fy: q => q.cl > 0 ? Math.pow(q.cl, 1.5) / q.cd : NaN },
    { id: 'cd', title: 'cd über α', xlab: 'α (°)', ylab: 'cd', fx: q => q.alpha, fy: q => q.cd },
    { id: 'cm', title: 'cm über α', xlab: 'α (°)', ylab: 'cm', fx: q => q.alpha, fy: q => q.cm },
    { id: 'xtr', title: 'Umschlag x/c über α (oben/unten)', xlab: 'α (°)', ylab: 'x/c', fx: q => q.alpha, fy: q => q.xtrU, fy2: q => q.xtrL }
  ];
  const KFM_SNAP_COL = ['#4fc3f7', '#81c784', '#ba68c8', '#e57373', '#fff176', '#4db6ac', '#f06292', '#a1887f'];
  const kfmCharts = () => !!(window.Aero && Aero.drawChart && Aero.chartRange);
  let kfmPolRO = false;
  function kfmPolarPanel() {
    const box = $('fdbTable'), K = U.kfm; if (!box || !K) return;
    box.textContent = ''; K.polSlots = null;
    if (!(kfmNF() || kfmXF()) || !kfmCharts()) return;
    if (!Array.isArray(K.polCh)) K.polCh = ['pol', 'cla', 'gz', 'cm'];
    if (!K.polN) K.polN = 2;
    if (!K.polHide) K.polHide = new Set();
    const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
    const selStyle = 'padding:2px 6px;border-radius:6px;border:1px solid rgba(128,128,128,.45);background:var(--bg2,#0c0f13);color:var(--txt,#e6e6e6);font-size:12px';
    box.style.display = 'flex'; box.style.flexDirection = 'column'; box.style.gap = '6px'; box.style.paddingBottom = '10px';
    const head = mk('div', 'fdb-btns'); head.style.alignItems = 'center';
    head.appendChild(mk('b', null, T('Polare (live)')));
    head.appendChild(mk('span', 'fdb-hint', T('Re-Zahl')));
    const re = document.createElement('input'); re.type = 'text'; re.value = fmtRe(K.re || 1e5); re.style.width = '96px'; re.title = T('k = Tausend, M = Million (z. B. 150k)');
    re.onchange = () => { const v = Math.max(20000, Math.min(3e6, parseRe(re.value) || 1e5)); re.value = fmtRe(v); K.re = v; K.polPrev = null; kfmPolarSoon(); };
    head.appendChild(re);
    if (App.aeroXfoil) {                      // Rechner wählbar; fehlt XFOIL, rechnet NeuralFoil (Grund im Tooltip)
      const sc = document.createElement('select'); sc.style.cssText = selStyle;
      [['nf', 'NeuralFoil'], ['xfoil', kfmXF() ? 'XFOIL' : T('XFOIL (nicht verfügbar)')]].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sc.appendChild(o); });
      sc.value = K.calc === 'xfoil' ? 'xfoil' : 'nf';
      sc.title = T('Rechner der Live-Polare: NeuralFoil sofort, XFOIL braucht einige Sekunden je Änderung') + (kfmXF() || !App.aeroXfoil ? '' : ' — ' + App.aeroXfoil.why());
      sc.onchange = () => { K.calc = sc.value; K.polPrev = null; kfmPolarSoon(); };
      head.appendChild(sc);
      const cl = document.createElement('label'); cl.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-size:12px;cursor:pointer';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!K.cmp;
      cb.onchange = () => { K.cmp = cb.checked; if (!K.cmp) { K.polCmp = null; kfmPolarDraw(); } else kfmCmp(K); };
      cl.title = T('Den Entwurf zusätzlich mit der anderen Methode rechnen (NeuralFoil ↔ XFOIL) — gestrichelt in der Entwurfsfarbe');
      cl.appendChild(cb); cl.appendChild(document.createTextNode(T('Vergleich')));
      head.appendChild(cl);
    }
    // α-Bereich der Polare (von/bis/Schritt) und ein einzelner Betriebspunkt
    const aNum = (val, step, w, set, ph) => { const i = document.createElement('input'); i.type = 'number'; i.step = step; i.style.width = w;
      if (val != null && isFinite(val)) i.value = val; if (ph) i.placeholder = ph;
      i.onchange = () => { const v = i.value === '' ? null : +i.value; if (v != null && !isFinite(v)) return; set(v); kfmPolarSoon(); }; return i; };
    const aRow = mk('span'); aRow.style.cssText = 'display:inline-flex;align-items:center;gap:4px';
    aRow.title = T('Anstellwinkel bezogen auf die waagrechte Grundplatte. Hinter dem Abriss bricht die Rechnung früher ab (Netz zu unsicher); steigt cl am Ende noch, wird bis zu 8° weiter gerechnet.');
    aRow.appendChild(mk('span', 'fdb-hint', T('α von')));
    aRow.appendChild(aNum(K.a0 != null ? K.a0 : -6, 0.5, '54px', v => { K.a0 = v == null ? -6 : Math.max(-20, Math.min(30, v)); K.polPrev = null; }));
    aRow.appendChild(mk('span', 'fdb-hint', T('bis')));
    aRow.appendChild(aNum(K.a1 != null ? K.a1 : 16, 0.5, '54px', v => { K.a1 = v == null ? 16 : Math.max(-20, Math.min(30, v)); K.polPrev = null; }));
    aRow.appendChild(mk('span', 'fdb-hint', T('Schritt')));
    aRow.appendChild(aNum(K.da || 0.5, 0.1, '48px', v => { K.da = v == null ? 0.5 : Math.max(0.1, Math.min(5, v)); K.polPrev = null; }));
    aRow.appendChild(mk('span', 'fdb-hint', '° · ' + T('Punkt bei α')));
    const op = aNum(K.aOp, 0.5, '54px', v => { K.aOp = v == null ? NaN : Math.max(-20, Math.min(30, v)); }, '—');
    op.title = T('Werte für genau diesen Anstellwinkel anzeigen (leer = aus)');
    aRow.appendChild(op); aRow.appendChild(mk('span', 'fdb-hint', '°'));
    head.appendChild(aRow);
    head.appendChild(mk('span', 'fdb-hint', T('Diagramme')));
    const nSel = document.createElement('select'); nSel.style.cssText = selStyle;
    [1, 2, 3, 4].forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; nSel.appendChild(o); });
    nSel.value = K.polN; nSel.onchange = () => { K.polN = +nSel.value; kfmPolarPanel(); };
    head.appendChild(nSel);
    // Zwischenstände: aktuelle Polare samt Entwurfsmaßen von Hand merken; sie
    // bleiben als eigene Kurven zum Vergleich stehen (bis zu 8).
    if (!K.polSnaps) K.polSnaps = [];
    const bSnap = mk('button', null, T('📌 Zwischenstand merken'));
    bSnap.title = T('Aktuelle Polare als Vergleichskurve behalten (mit den Maßen des Entwurfs, wieder herstellbar)');
    bSnap.disabled = !K.pol || K.polSnaps.length >= 8;
    bSnap.onclick = () => {
      if (!K.pol) return;
      const used = new Set(K.polSnaps.map(s => s.color));
      const color = KFM_SNAP_COL.find(c => !used.has(c)) || KFM_SNAP_COL[0];
      const nm = (K.name.trim() || KFm.autoName(K.P)) + ' · Re ' + Math.round(K.pol.Re / 1000) + 'k';
      K.polSnaps.push({ name: nm, pol: K.pol, P: JSON.parse(JSON.stringify(K.P)), color, on: true });
      kfmPolarPanel();
    };
    head.appendChild(bSnap); K.polSnapBtn = bSnap;
    box.appendChild(head);
    const grid = mk('div'); grid.style.cssText = 'flex:1;min-height:0;display:grid;gap:8px;grid-auto-rows:minmax(110px,1fr)';
    box.appendChild(grid); K.polGrid = grid;
    K.polSlots = [];
    for (let i = 0; i < K.polN; i++) {
      const cell = mk('div'); cell.style.cssText = 'display:flex;flex-direction:column;min-height:0;min-width:0';
      const cs = document.createElement('select'); cs.style.cssText = selStyle + ';align-self:flex-start;margin-bottom:2px';
      KFM_CH.forEach(d => { const o = document.createElement('option'); o.value = d.id; o.textContent = T(d.title); cs.appendChild(o); });
      cs.value = K.polCh[i] || KFM_CH[i % KFM_CH.length].id; K.polCh[i] = cs.value;
      const host = mk('div'); host.style.cssText = 'flex:1;position:relative;min-height:90px;border:1px solid rgba(128,128,128,.3);border-radius:6px';
      const c = document.createElement('canvas'); c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;cursor:crosshair';
      host.appendChild(c); cell.appendChild(cs); cell.appendChild(host); grid.appendChild(cell);
      const slot = { c, rng: null, map: null, cur: null, auto: null };
      cs.onchange = () => { K.polCh[i] = cs.value; slot.rng = null; kfmSlotDraw(slot, i); };
      kfmSlotEvents(slot, i);
      K.polSlots.push(slot);
    }
    if (K.polSnaps.length) {
      const list = mk('div'); list.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px';
      K.polSnaps.forEach((sn, j) => {
        const it = mk('label'); it.style.cssText = 'display:flex;align-items:center;gap:4px;white-space:nowrap';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = sn.on !== false;
        cb.onchange = () => { sn.on = cb.checked; kfmPolarDraw(); };
        const sw = mk('span'); sw.style.cssText = 'display:inline-block;width:18px;border-top:2.5px solid ' + sn.color;
        const tx = mk('span', null, sn.name);
        const rs = mk('button', null, '↺'); rs.title = T('Maße dieses Zwischenstands in den Entwurf übernehmen');
        rs.style.cssText = 'padding:0 6px;font-size:11px';
        rs.onclick = e => { e.preventDefault(); K.P = JSON.parse(JSON.stringify(sn.P)); drawDetail(); kfmUpdate(); };
        const del = mk('button', null, '✕'); del.title = T('Zwischenstand entfernen');
        del.style.cssText = 'padding:0 6px;font-size:11px';
        del.onclick = e => { e.preventDefault(); K.polSnaps.splice(j, 1); kfmPolarPanel(); };
        it.appendChild(cb); it.appendChild(sw); it.appendChild(tx); it.appendChild(rs); it.appendChild(del);
        list.appendChild(it);
      });
      box.insertBefore(list, grid);
    }
    K.polInfo = mk('div', 'fdb-hint'); box.appendChild(K.polInfo);
    // Bedienhinweis und NeuralFoil-Hinweis als Tooltip (ⓘ), damit die Diagramme Platz haben.
    K.polInfo.title = T('Rechnet bei jeder Änderung mit (NeuralFoil, Ncrit 9). Das Netz sieht die Stufen über eine glatte Ersatzkontur — gut zum Vergleichen der Varianten, die Absolutwerte bei scharfen Stufen nur als Schätzung nehmen.');
    const tip = mk('span', 'fdb-hint', 'ⓘ'); tip.style.cursor = 'help';
    tip.title = T('Rad = Zoom · Ziehen = Achse strecken/stauchen (waagerecht X, senkrecht Y) · Shift- oder Rechts-Ziehen = verschieben · Doppelklick = alles · Legende = Kurve ein/aus.') + ' — ' + K.polInfo.title;
    head.appendChild(tip);
    K.polSlots.forEach(sl => { sl.c.title = T('Rad = Zoom · Ziehen = Achse strecken/stauchen (waagerecht X, senkrecht Y) · Shift- oder Rechts-Ziehen = verschieben · Doppelklick = alles · Legende = Kurve ein/aus.'); });
    if (!kfmPolRO) { kfmPolRO = true; window.addEventListener('resize', () => kfmPolarDraw()); if (window.ResizeObserver) new ResizeObserver(() => kfmPolarDraw()).observe(box); }
    setTimeout(kfmPolarDraw, 0);
  }
  // Kurven eines Diagramms: aktueller Entwurf + gestrichelt der vorige Stand.
  function kfmSeries(D) {
    const K = U.kfm;
    const acc = (getComputedStyle(document.documentElement).getPropertyValue('--accent2') || '').trim() || '#ff8c42', out = [];
    const add = (r, name, color, dash) => {
      if (!r || !r.pts) return;
      out.push({ name: D.fy2 ? name + ' ' + T('oben') : name, color, dash, pts: r.pts.map(q => [D.fx(q), D.fy(q)]) });
      if (D.fy2) out.push({ name: name + ' ' + T('unten'), color, dash: 'dot', pts: r.pts.map(q => [D.fx(q), D.fy2(q)]) });
    };
    add(K.pol, T('Entwurf') + (K.polCmp ? ' · ' + (K.calc === 'xfoil' && kfmXF() ? 'XFOIL' : 'NeuralFoil') : ''), acc, null);
    if (K.cmp && K.polCmp) add(K.polCmp, T('Entwurf') + ' · ' + K.polCmpName, acc, [7, 4]);
    add(K.polPrev, T('vorher'), '#8a8f98', true);
    (K.polSnaps || []).forEach((sn, j) => { if (sn.on !== false) add(sn.pol, (j + 1) + ': ' + sn.name, sn.color, null); });
    out.forEach(s => { if (K.polHide.has(D.id + '|' + s.name)) s.hidden = true; });
    return out;
  }
  function kfmSlotDraw(slot, i) {
    const K = U.kfm; if (!K || !slot.c.isConnected) return;
    const D = KFM_CH.find(d => d.id === K.polCh[i]) || KFM_CH[0];
    const g = slot.c.getContext('2d');
    const ser = K.pol ? kfmSeries(D) : [];
    const auto = ser.length && window.Aero ? Aero.chartRange(ser) : null;
    if (!auto) {
      const dpr = window.devicePixelRatio || 1, W = slot.c.clientWidth, H = slot.c.clientHeight;
      slot.c.width = W * dpr; slot.c.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H); g.fillStyle = 'rgba(128,128,128,.9)'; g.font = '11px system-ui';
      g.fillText(K.preview ? T('Keine Polare — Netz unsicher für diese Form.') : '…', 10, 20); slot.map = null; slot.auto = null; return;
    }
    if (D.id === 'pol') auto.x0 = Math.min(auto.x0, 0);
    slot.auto = auto;
    const r = slot.rng || auto;
    slot.map = window.Aero && Aero.drawChart(slot.c, '', T(D.xlab), T(D.ylab), ser, { grid: true, xr: [r.x0, r.x1], yr: [r.y0, r.y1] });
    const m = slot.map, cur = slot.cur;
    // Betriebspunkt (α aus dem Feld „Punkt bei α“) als Ring markieren
    if (m && K.opPt && isFinite(K.opPt.cl)) {
      const ys = [D.fy(K.opPt)].concat(D.fy2 ? [D.fy2(K.opPt)] : []), vx = D.fx(K.opPt);
      const px = m.mL + (vx - m.x0) / (m.x1 - m.x0) * (m.W - m.mL - m.mR);
      ys.forEach(vy => {
        const py = m.H - m.mB - (vy - m.y0) / (m.y1 - m.y0) * (m.H - m.mT - m.mB);
        if (!isFinite(px) || !isFinite(py) || px < m.mL || px > m.W - m.mR || py < m.mT || py > m.H - m.mB) return;
        g.strokeStyle = (getComputedStyle(document.documentElement).getPropertyValue('--txt') || '').trim() || '#fff'; g.lineWidth = 2;
        g.beginPath(); g.arc(px, py, 5, 0, 2 * Math.PI); g.stroke(); g.lineWidth = 1;
      });
    }
    if (!m || !cur || cur.mx < m.mL || cur.mx > m.W - m.mR || cur.my < m.mT || cur.my > m.H - m.mB) return;
    const fx = m.x0 + (cur.mx - m.mL) / (m.W - m.mL - m.mR) * (m.x1 - m.x0), fy = m.y0 + (m.H - m.mB - cur.my) / (m.H - m.mT - m.mB) * (m.y1 - m.y0);
    const f = v => { const a = Math.abs(v); return a >= 100 ? v.toFixed(0) : a >= 1 ? v.toFixed(2) : v.toFixed(4); };
    const txt = (getComputedStyle(document.documentElement).getPropertyValue('--txt') || '').trim() || '#ccc';
    g.strokeStyle = txt; g.globalAlpha = 0.4; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(cur.mx, m.mT); g.lineTo(cur.mx, m.H - m.mB); g.stroke();
    g.beginPath(); g.moveTo(m.mL, cur.my); g.lineTo(m.W - m.mR, cur.my); g.stroke();
    g.setLineDash([]); g.globalAlpha = 1;
    const lbl = f(fx) + ' / ' + f(fy); g.font = '11px system-ui';
    const w = g.measureText(lbl).width + 10, bx = Math.min(cur.mx + 12, m.W - m.mR - w), by = Math.max(cur.my - 22, m.mT + 2);
    g.fillStyle = 'rgba(20,24,30,.9)'; g.fillRect(bx, by, w, 17);
    g.fillStyle = txt; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(lbl, bx + 5, by + 8.5);
  }
  function kfmSlotEvents(slot, i) {
    const c = slot.c;
    const rngNow = () => slot.rng || slot.auto;
    const toData = (mx, my) => { const m = slot.map, r = rngNow();
      return [r.x0 + (mx - m.mL) / (m.W - m.mL - m.mR) * (r.x1 - r.x0), r.y0 + (m.H - m.mB - my) / (m.H - m.mT - m.mB) * (r.y1 - r.y0)]; };
    c.addEventListener('wheel', e => {
      if (!slot.map) return; e.preventDefault();
      const b = c.getBoundingClientRect(), d = toData(e.clientX - b.left, e.clientY - b.top), r = rngNow();
      const k = e.deltaY < 0 ? 0.8 : 1.25;
      slot.rng = { x0: d[0] + (r.x0 - d[0]) * k, x1: d[0] + (r.x1 - d[0]) * k, y0: d[1] + (r.y0 - d[1]) * k, y1: d[1] + (r.y1 - d[1]) * k };
      kfmSlotDraw(slot, i);
    }, { passive: false });
    let drag = null, moved = false;
    c.oncontextmenu = e => e.preventDefault();
    c.onmousedown = e => {
      if (!slot.map) return;
      const b = c.getBoundingClientRect(), d = toData(e.clientX - b.left, e.clientY - b.top);
      drag = { x: e.clientX, y: e.clientY, r: Object.assign({}, rngNow()), pan: e.shiftKey || e.button === 2, fx: d[0], fy: d[1] }; moved = false;
      const up = () => { drag = null; window.removeEventListener('mouseup', up); };
      window.addEventListener('mouseup', up);
    };
    c.onmousemove = e => {
      const b = c.getBoundingClientRect(); slot.cur = { mx: e.clientX - b.left, my: e.clientY - b.top };
      if (drag && slot.map) {
        if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) moved = true;
        const m = slot.map, R = drag.r;
        if (drag.pan) {
          const dx = (e.clientX - drag.x) * (R.x1 - R.x0) / (m.W - m.mL - m.mR), dy = (e.clientY - drag.y) * (R.y1 - R.y0) / (m.H - m.mT - m.mB);
          slot.rng = { x0: R.x0 - dx, x1: R.x1 - dx, y0: R.y0 + dy, y1: R.y1 + dy };
        } else {
          const kx = Math.exp((e.clientX - drag.x) / 180), ky = Math.exp(-(e.clientY - drag.y) / 180);
          slot.rng = { x0: drag.fx + (R.x0 - drag.fx) / kx, x1: drag.fx + (R.x1 - drag.fx) / kx, y0: drag.fy + (R.y0 - drag.fy) / ky, y1: drag.fy + (R.y1 - drag.fy) / ky };
        }
      }
      kfmSlotDraw(slot, i);
    };
    c.onmouseleave = () => { slot.cur = null; kfmSlotDraw(slot, i); };
    c.ondblclick = () => { slot.rng = null; kfmSlotDraw(slot, i); };
    c.onclick = e => {                              // Legende: Kurve ein/aus
      if (moved || !slot.map || !slot.map.legend) return;
      const b = c.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top;
      const hit = slot.map.legend.find(L => mx >= L.x0 && mx <= L.x1 && my >= L.y0 && my <= L.y1); if (!hit) return;
      const K = U.kfm, D = KFM_CH.find(d => d.id === K.polCh[i]) || KFM_CH[0], s = kfmSeries(D)[hit.i]; if (!s) return;
      const key = D.id + '|' + s.name;
      if (K.polHide.has(key)) K.polHide.delete(key); else K.polHide.add(key);
      kfmSlotDraw(slot, i);
    };
  }
  function kfmPolarDraw() {
    const K = U.kfm; if (!K || !K.polSlots) return;
    if (K.polGrid) K.polGrid.style.gridTemplateColumns = K.polGrid.clientWidth >= 620 && K.polN > 1 ? '1fr 1fr' : '1fr';
    K.polSlots.forEach((s, i) => kfmSlotDraw(s, i));
    if (K.polSnapBtn) K.polSnapBtn.disabled = !K.pol || (K.polSnaps || []).length >= 8;
    if (K.polInfo) {
      if (!K.pol) { K.polInfo.textContent = ''; return; }
      let best = K.pol.pts[0], cdMin = Infinity;
      K.pol.pts.forEach(q => { if (q.cl / q.cd > best.cl / best.cd) best = q; cdMin = Math.min(cdMin, q.cd); });
      K.polInfo.textContent = 'Re ' + Math.round(K.pol.Re) + ' · cl max ' + (isFinite(K.pol.clmax) ? K.pol.clmax.toFixed(2) : '–') + ' (α ' + (+K.pol.alphaMax).toFixed(1) + '°) · '
        + T('beste Gleitzahl ') + (best.cl / best.cd).toFixed(1) + ' (cl ' + best.cl.toFixed(2) + ', α ' + best.alpha.toFixed(1) + '°) · cd min ' + cdMin.toFixed(4)
        + (K.polPrev ? ' — ' + T('gestrichelt: vorheriger Stand') : '')
        + (K.cmp && K.polCmp ? ' — ' + T('lang gestrichelt (Entwurfsfarbe):') + ' ' + K.polCmpName
          + ' · cl max ' + (isFinite(K.polCmp.clmax) ? K.polCmp.clmax.toFixed(2) : '–') : '')
        + (K.cmp && K.polCmpWhy ? ' — ' + K.polCmpWhy : '');
      const o = K.opPt;
      if (o && isFinite(o.cl)) K.polInfo.textContent += ' ' + T('bei α ') + (+o.alpha).toFixed(1) + '°: cl ' + o.cl.toFixed(3) + ' · cd ' + o.cd.toFixed(4)
        + ' · cl/cd ' + (o.cl / o.cd).toFixed(1) + ' · cm ' + o.cm.toFixed(3) + (o.conf < 0.6 ? ' (' + T('unsicher') + ')' : '');
    }
  }
  function kfmStore() {
    const p = kfmProfile(); if (!p) return null;
    const r = get(add(p, { name: p.name, src: 'kfm', keepTE: true }));
    if (r && !r.note) { r.note = T('Erzeugt im KFm-Gestalter'); save(); }
    return r;
  }
  function drawKfm(box) {
    const K = U.kfm, P = K.P;
    box.textContent = '';
    const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
    const field = (label, el, unit) => { const f = mk('div', 'fdb-field'); f.appendChild(mk('label', null, T(label))); f.appendChild(el); if (unit) f.appendChild(mk('span', 'u', unit)); box.appendChild(f); return el; };
    const redo = () => { drawKfm(box); kfmUpdate(); };
    const num = (val, step, min, max, set) => { const i = document.createElement('input'); i.type = 'number'; i.value = val; i.step = step; i.min = min; i.max = max;
      i.onchange = () => { const v = +i.value; if (!isFinite(v)) return; const c = Math.max(min, Math.min(max, v)); if (c !== v) i.value = c; set(c); showInfo(); kfmUpdate(); }; return i; };
    const sel = (opts, val, set) => { const s = document.createElement('select');
      opts.forEach(o => { const e = document.createElement('option'); e.value = o[0]; e.textContent = T(o[1]); s.appendChild(e); });
      s.value = val; s.onchange = () => { set(s.value); redo(); }; return s; };
    const info = mk('div', 'fdb-hint');
    const nameInp = document.createElement('input');
    const showInfo = () => {
      const I = KFm.info(K.P), mm = v => (v * K.chord).toFixed(1) + ' mm';
      info.textContent = T('Gesamtdicke vorn: ') + pct(I.total) + ' · ' + T('Grundplatte: ') + pct(I.base) + ' · ' + T('Endleiste: ') + pct(I.te)
        + ' — ' + T('bei Sehne ') + K.chord + ' mm: ' + mm(I.total) + ' / ' + mm(I.base) + ' / ' + mm(I.te);
      nameInp.placeholder = KFm.autoName(K.P);
    };

    box.appendChild(mk('div', 'gh', T('Stufenprofil (KFm) / Knickprofil gestalten')));
    box.appendChild(mk('div', 'fdb-hint', T('Aufbau wie beim Bauen aus Platten: Grundplatte über die ganze Sehne, darauf oder darunter Lagen von der Nase bis zur Stufe. Maße in % der Sehne. Der Entwurf erscheint oben im Bild.')));
    field('Vorlage', sel(KFm.PRESETS.map(p => [p.id, p.label]), P.preset, v => { K.P = Object.assign(KFm.defaults(v), { nose: P.nose, noseLen: P.noseLen, noseLenB: P.noseLenB, noseTip: P.noseTip, noseTipPct: P.noseTipPct, teLen: P.teLen, teThick: P.teThick }); }));
    nameInp.type = 'text'; nameInp.value = K.name; nameInp.onchange = () => { K.name = nameInp.value; kfmUpdate(); };
    nameInp.title = T('Leer = Name aus den Maßen');
    field('Name', nameInp);
    field('Dicke der Grundplatte', num(P.t0, 0.1, 0.3, 30, v => { P.t0 = v; }), '%');
    field('Nase', sel([['round', 'rund (Halbkreis)'], ['ellipse', 'elliptisch'], ['wedge', 'spitz (Keil)']], P.nose, v => { P.nose = v; }));
    if (P.noseLenB == null) P.noseLenB = P.noseLen;
    if (P.noseTip == null) P.noseTip = 'mid';
    if (P.noseTipPct == null) P.noseTipPct = 50;
    field('Nasenspitze', sel([['mid', 'mittig — Rundung symmetrisch'], ['plate', 'auf Mitte der Grundplatte'], ['free', 'frei (Höhe wählen)']], P.noseTip, v => { P.noseTip = v; }))
      .title = T('Höhe der Nasenspitze. Mittig: Rundung oben und unten gleich groß, auch bei Stufen nur auf einer Seite. Auf Mitte der Grundplatte: Rundung je Seite so hoch wie die Lagen dort. Frei: Höhe in % der Nasendicke. Die Ausrichtung hängt nicht davon ab — die Grundplatte liegt immer bei 0° Anstellwinkel.');
    if (P.noseTip === 'free') field('Höhe der Nasenspitze', num(P.noseTipPct, 1, 0, 100, v => { P.noseTipPct = v; }), '%').title = T('0 = an der Unterseite, 50 = Mitte, 100 = an der Oberseite (bezogen auf die Dicke an der Nase)');
    if (P.nose !== 'round') {
      field('Nasenlänge oben', num(P.noseLen, 0.5, 0.2, 40, v => { P.noseLen = v; }), '%');
      field('Nasenlänge unten', num(P.noseLenB, 0.5, 0.2, 40, v => { P.noseLenB = v; }), '%');
    }

    // Stufen
    box.appendChild(mk('div', 'gh', T('Stufen')));
    if (!P.steps.length) box.appendChild(mk('div', 'fdb-hint', T('Keine Stufe — ebene Platte.')));
    P.steps.forEach((s, i) => {
      const row = mk('div', 'fdb-btns'); row.style.alignItems = 'center';
      const sd = sel([['top', 'oben'], ['bot', 'unten'], ['both', 'oben + unten']], s.side, v => { s.side = v; });
      const a = num(s.pos, 1, 5, 95, v => { s.pos = v; }); a.title = T('Lage der Stufe von der Nase (% der Sehne)'); a.style.width = '64px';
      const h = num(s.h, 0.1, 0.1, 30, v => { s.h = v; }); h.title = T('Stufenhöhe = Dicke der Lage (% der Sehne)'); h.style.width = '64px';
      const x = mk('button', null, '✕'); x.title = T('Stufe entfernen'); x.onclick = () => { P.steps.splice(i, 1); redo(); };
      row.appendChild(sd); row.appendChild(mk('span', 'fdb-hint', T('bei'))); row.appendChild(a); row.appendChild(mk('span', 'fdb-hint', '% · ' + T('Höhe'))); row.appendChild(h); row.appendChild(mk('span', 'fdb-hint', '%')); row.appendChild(x);
      box.appendChild(row);
    });
    { const row = mk('div', 'fdb-btns'); const b = mk('button', null, T('+ Stufe'));
      // Neue Stufe hinter die letzte setzen (halber Weg zur Endleiste), gleiche Seite
      // und Höhe — sonst läge sie auf der ersten und wäre nicht als eigene zu sehen.
      b.onclick = () => {
        const last = P.steps.reduce((m, s) => (+s.pos > +m.pos ? s : m), { pos: 0, side: 'top', h: P.t0 });
        const pos = P.steps.length ? Math.min(95, Math.round(+last.pos + (100 - last.pos) / 2)) : 50;
        P.steps.push({ side: last.side, pos, h: +last.h || P.t0 }); redo(); };
      b.disabled = P.steps.length >= 8; row.appendChild(b);
      // Alle Stufen auf „oben + unten" stellen (gleiche Lagen wie oben, gespiegelt).
      const bs = mk('button', null, T('Alle symmetrisch')); bs.title = T('Jede Stufe oben und unten gleich (oben + unten an derselben Stelle)');
      bs.onclick = () => { const seen = new Set(); P.steps = P.steps.filter(s => { const k = s.pos + '/' + s.h; if (seen.has(k)) return false; seen.add(k); return true; }).map(s => Object.assign(s, { side: 'both' })); redo(); };
      bs.disabled = !P.steps.length || P.steps.every(s => s.side === 'both'); row.appendChild(bs);
      box.appendChild(row); }

    // Knicke
    box.appendChild(mk('div', 'gh', T('Knicke (Knickplatte)')));
    P.kinks.forEach((k, i) => {
      const row = mk('div', 'fdb-btns'); row.style.alignItems = 'center';
      const a = num(k.pos, 1, 1, 99, v => { k.pos = v; }); a.title = T('Lage des Knicks von der Nase (% der Sehne)'); a.style.width = '64px';
      const w = num(k.ang, 0.5, -45, 45, v => { k.ang = v; }); w.title = T('Knickwinkel: positiv = hinterer Teil nach unten (Wölbung), negativ = nach oben (S-Schlag)'); w.style.width = '64px';
      const x = mk('button', null, '✕'); x.title = T('Knick entfernen'); x.onclick = () => { P.kinks.splice(i, 1); redo(); };
      row.appendChild(mk('span', 'fdb-hint', T('bei'))); row.appendChild(a); row.appendChild(mk('span', 'fdb-hint', '% · ' + T('Winkel'))); row.appendChild(w); row.appendChild(mk('span', 'fdb-hint', '°')); row.appendChild(x);
      box.appendChild(row);
    });
    { const row = mk('div', 'fdb-btns'); const b = mk('button', null, T('+ Knick'));
      b.onclick = () => { P.kinks.push({ pos: P.kinks.length ? 75 : 30, ang: P.kinks.length ? -3 : 5 }); redo(); };
      b.disabled = P.kinks.length >= 4; row.appendChild(b); box.appendChild(row); }

    // Endleiste
    box.appendChild(mk('div', 'gh', T('Endleiste')));
    field('Anschärfen über', num(P.teLen, 1, 0, 60, v => { P.teLen = v; }), '%').title = T('Länge, über die die Platte zur Endleiste hin dünner wird (0 = volle Plattendicke bis hinten)');
    field('Dicke an der Endleiste', num(P.teThick, 0.1, 0, 30, v => { P.teThick = v; }), '%').title = T('Gilt nur mit Anschärfen > 0');
    field('Sehne für die mm-Anzeige', num(K.chord, 10, 10, 5000, v => { K.chord = v; }), 'mm');
    box.appendChild(info); showInfo();

    // Speichern
    box.appendChild(mk('div', 'gh', T('Speichern')));
    { const row = mk('div', 'fdb-btns');
      const b1 = mk('button', 'primary', T('In Datenbank speichern')); b1.title = T('Profil in die Profildatenbank legen — sofort im Tragflächendesigner und in der Auslegung wählbar');
      b1.onclick = () => { const r = kfmStore(); if (!r) return; toast(T('Profil gespeichert: ') + r.name); kfmLast = U.kfm; select(r.id); };
      const b2 = mk('button', null, T('.dat speichern…')); b2.title = T('Als .dat-Datei speichern (Selig-Format) und zugleich in die Datenbank legen');
      b2.onclick = () => { const r = kfmStore(); if (!r) return; exportDat(r); drawList(); };
      const b3 = mk('button', null, T('Schließen')); b3.onclick = () => { kfmLast = U.kfm; kfmLast.preview = null; U.kfm = null; drawDetail(); drawCanvas(); };
      row.appendChild(b1); row.appendChild(b2); row.appendChild(b3); box.appendChild(row); }
    box.appendChild(mk('div', 'fdb-hint', T('Die Stufen bleiben beim Einsetzen als Ecken erhalten; die dicke Endleiste wird bei diesen Profilen nicht geschlossen. Für scharfe Stufen im Schnitt die Punktzahl des Profils eher hoch wählen (200 und mehr).')));
  }
  // Polaren-Ansicht des Aerodynamik-Reiters über diesem Reiter öffnen — mit dem
  // gewählten Profil und allen zum Vergleich angehakten.
  function openPolars() {
    if (!(window.Aero && Aero.openFoilView)) return;
    // Alle Datenbankprofile stehen in den Reihen zur Wahl; gewähltes + angehakte
    // Profile werden als Reihen vorbelegt (erste = Hauptreihe).
    const ids = [...U.cmp]; if (U.sel && ids.indexOf(U.sel) < 0) ids.unshift(U.sel);
    const all = db.profiles.slice().sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1);
    const profs = all.map(r => ({ prof: toProf(r), name: r.name }));
    const rows = ids.map(id => all.findIndex(r => r.id === id)).filter(i => i >= 0);
    if (!profs.length) return;
    window.Aero.openFoilView({ host: $('foildbView'), profs, rows: rows.length ? rows : [0] });
  }
  function computeEdit(E) {
    try {
      let p = Airfoil.resample(E.base, Math.max(20, Math.min(600, E.n | 0)) | 1);   // ungerade: Nase mittig
      if (App.scaleThickCam && App.thickenTE) {
        const m = metricsOf(p);
        const ts = m.thick > 1e-6 ? (E.thick / 100) / m.thick : 1;
        const cs = Math.abs(m.cam) > 1e-6 ? (E.cam / 100) / m.cam : 1;
        if (Math.abs(ts - 1) > 1e-6 || Math.abs(cs - 1) > 1e-6) p = App.scaleThickCam(p, ts, cs);
        p = App.thickenTE(p, Math.max(0, E.te / 100));
      }
      p.name = E.base.name; return p;
    } catch (e) { return null; }
  }
  // Ziele im Tragflächendesigner (Wurzel + Segment-Außenprofile der aktiven Tragfläche).
  function targets() {
    const t = [{ id: 'root', label: T('Wurzelprofil') }];
    (state.segments || []).forEach((s, i) => t.push({ id: i, label: 'Segment ' + (i + 1) + T(' (außen)') }));
    return t;
  }
  // Wie processDat in filesys.js: Endleiste schließen, Original als Editier-Basis.
  function applyToTarget(prof, t) {
    const orig = prof.map(q => ({ x: q.x, y: q.y })); orig.name = prof.name;
    const closed = App.closeLoadedTE ? App.closeLoadedTE(prof) : prof;
    closed.name = prof.name;
    const tid = t.type === 'root' ? 'root' : t.idx;
    if (state.profBase) state.profBase[String(tid)] = orig;
    const h = t.type === 'root' ? state.root : state.segments[t.idx];
    if (h) { h.profile = closed; h.strak = false; h.foilMix = null; h.foilName = ''; }   // ersetzt Strak/Import-Zuordnung
    if (App.buildSidebar) App.buildSidebar(); if (App.render) App.render();
  }
  function exportDat(r) {
    const body = r.pts.map(q => q[0].toFixed(6) + '  ' + q[1].toFixed(6)).join('\n');
    const base = r.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'profil';
    if (App.exportViaPicker) App.exportViaPicker(base + '.dat', r.name + '\n' + body + '\n', 'text/plain', 'svDat');
    else if (App.anchorDownload) App.anchorDownload(base + '.dat', r.name + '\n' + body + '\n', 'text/plain', 'svDat');
  }

  // ---- Reiter aufbauen ----------------------------------------------------------
  function wire() {
    if (wired) return; wired = true;
    const f = $('fdbFilter'); if (f) f.oninput = () => { U.filter = f.value; drawList(); };
    const s = $('fdbSort'); if (s) s.onchange = () => { U.sort = s.value; drawList(); };
    const g = $('fdbGroup'); if (g) g.onchange = () => { U.group = g.value; drawList(); };
    const c = $('fdbCmpClear'); if (c) c.onclick = () => { U.cmp.clear(); drawList(); drawCanvas(); drawDetail(); };
    const a = $('fdbCmpAll'); if (a) a.onclick = () => { visible().forEach(p => U.cmp.add(p.id)); drawList(); drawCanvas(); drawDetail(); };
    wireCanvas();
  }
  function fillGroupSelect() {
    const g = $('fdbGroup'); if (!g) return;
    const cur = U.group; g.textContent = '';
    const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; g.appendChild(o); };
    add('all', T('Alle Gruppen')); add('none', T('Ohne Gruppe'));
    db.groups.forEach(x => add(x.id, x.name));
    g.value = [...g.options].some(o => o.value === cur) ? cur : 'all'; U.group = g.value;
  }
  function draw() { wire(); fillGroupSelect(); drawList(); drawCanvas(); drawDetail(); }
  function show() { draw(); requestAnimationFrame(drawCanvas); }

  // ==================================================================
  //  4. Seitenleiste (Import, NACA, Gruppen, Datenbank-Datei)
  // ==================================================================
  function foildbSidebar(side) {
    const { grp, hint, boolRow } = App;
    const TAB = 'foildb';
    const g = grp('Profildatenbank', true, TAB, { key: 'fdb_main' });
    hint(g.body, 'Sammelt jedes Profil, das im Programm geladen wird (Tragflächendesigner, Auslegung, Aerodynamik, Formenbau, Rumpf, XFLR5-Import …). Die Gruppen erscheinen als Aufklappmenü bei der Profilwahl im Tragflächendesigner und in der Auslegung. Gespeichert maschinenweit — nicht im Projekt.');
    const btn = (t, fn, tip) => { const b = document.createElement('button'); b.textContent = T(t); if (tip) b.title = T(tip); b.onclick = fn; g.body.appendChild(b); return b; };
    btn('Profile importieren… (.dat/.bez)', importFiles, 'Mehrere Dateien auf einmal — Explorer-Dialog');
    btn('NACA-Profil anlegen…', () => {
      const code = window.prompt(T('NACA-4-Ziffern-Code (z. B. 2412):'), '2412'); if (!code) return;
      if (!/^\d{4}$/.test(code.trim())) { window.alert(T('Bitte vier Ziffern eingeben.')); return; }
      const p = Airfoil.naca4(code.trim(), 120); const id = add(p, { name: 'NACA ' + code.trim(), src: 'naca' });
      if (id) { select(id); draw(); }
    });
    if (window.KFm) btn('KFm-/Knickprofil gestalten…', openKfm, 'Stufenprofile (KFm1–KFm4, freie Stufen) und Platten-/Knickprofile aus Maßen aufbauen, in der Datenbank und als .dat speichern');
    btn('Profile der aktiven Tragfläche aufnehmen', () => {
      let n = 0;
      const put = (p, nm) => { if (p && p.length > 4) { const id = add(p, { name: p.name || nm, src: 'wing' }); if (id) n++; } };
      put(state.root && state.root.profile, T('Wurzelprofil'));
      (state.segments || []).forEach((s, i) => put(s.profile, 'Segment ' + (i + 1)));
      toast(T('Aufgenommen/aktualisiert: ') + n); draw();
    }, 'Wurzel- und Segmentprofile der aktiven Tragfläche in die Datenbank legen (bereits vorhandene Konturen werden nicht doppelt angelegt).');
    boolRow(g.body, 'Geladene Profile automatisch aufnehmen', () => db.autoAdd !== false, v => { db.autoAdd = !!v; save(); },
      'Aus: nur noch „Profile importieren…" und „aufnehmen" legen Einträge an.');
    { const info = document.createElement('div'); info.className = 'hint';
      info.textContent = T('Einträge: ') + db.profiles.length + ' · ' + T('Gruppen: ') + db.groups.length + ' · '
        + (fileOk ? T('Datei hotwing-profile.json neben der Einstellungsdatei') : T('nur Browser-Speicher (keine exe/Electron-Umgebung)'));
      g.body.appendChild(info); }
    side.appendChild(g.g);

    const gg = grp('Gruppen verwalten', false, TAB, { key: 'fdb_groups' });
    hint(gg.body, 'Freie Gruppen nach eigenen Kriterien (Einsatz, Dicke, Hersteller …). Ein Profil kann in mehreren Gruppen liegen — Zuordnung im Reiter beim jeweiligen Profil.');
    if (!db.groups.length) hint(gg.body, 'Noch keine Gruppen.');
    db.groups.forEach(x => {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:4px;align-items:center;margin:2px 0';
      const i = document.createElement('input'); i.type = 'text'; i.value = x.name; i.style.flex = '1';
      i.onchange = () => { renameGroup(x.id, i.value); groupsChanged(); drawDetail(); };
      const n = document.createElement('span'); n.className = 'hint'; n.textContent = db.profiles.filter(p => p.groups.indexOf(x.id) >= 0).length;
      const d = document.createElement('button'); d.textContent = '✕'; d.style.color = 'var(--bad)'; d.title = T('Gruppe löschen (Profile bleiben)');
      d.onclick = () => { if (window.confirm(T('Gruppe löschen? Die Profile bleiben erhalten.') + '\n' + x.name)) { removeGroup(x.id); groupsChanged(); drawDetail(); } };
      row.appendChild(i); row.appendChild(n); row.appendChild(d); gg.body.appendChild(row);
    });
    { const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:4px;margin-top:4px';
      const i = document.createElement('input'); i.type = 'text'; i.placeholder = T('Neue Gruppe'); i.style.flex = '1';
      const b = document.createElement('button'); b.textContent = '+';
      const go = () => { if (addGroup(i.value)) { groupsChanged(); drawDetail(); } };
      b.onclick = go; i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
      row.appendChild(i); row.appendChild(b); gg.body.appendChild(row); }
    side.appendChild(gg.g);

    const gf = grp('Datenbank-Datei', false, TAB, { key: 'fdb_file' });
    hint(gf.body, 'Die gesamte Datenbank als JSON sichern oder auf einem anderen Rechner einspielen (wird zusammengeführt, nichts geht verloren).');
    { const b = document.createElement('button'); b.textContent = T('Datenbank exportieren (JSON)…');
      b.onclick = () => { const txt = JSON.stringify(db, null, 1); if (App.exportViaPicker) App.exportViaPicker('hotwing-profile.json', txt, 'application/json', 'svSettings'); else App.anchorDownload('hotwing-profile.json', txt, 'application/json'); };
      gf.body.appendChild(b); }
    { const b = document.createElement('button'); b.textContent = T('Datenbank importieren (JSON)…');
      b.onclick = () => pickFiles('.json', files => {
        files.forEach(f => { try { db = merge(db, JSON.parse(f.text)); } catch (e) { window.alert(T('Keine gültige Datenbank-Datei: ') + f.name); } });
        metricCache.clear(); save(); groupsChanged(); drawCanvas(); drawDetail();
      });
      gf.body.appendChild(b); }
    side.appendChild(gf.g);
  }
  // Mehrere Textdateien wählen (Explorer-Dialog, sonst Datei-Input).
  async function pickFiles(ext, cb) {
    const exts = ext.split(',');
    if (window.showOpenFilePicker) {
      try {
        const opts = { multiple: true, types: [{ description: T('Dateien'), accept: { 'text/plain': exts } }] };
        if (App.pickerOpts) Object.assign(opts, App.pickerOpts('ldDat', exts[0]));
        const hs = await window.showOpenFilePicker(opts);
        if (App.markDirUsed) App.markDirUsed('ldDat', exts[0]);
        const out = []; for (const h of hs) { const f = await h.getFile(); out.push({ name: f.name, text: await f.text() }); }
        cb(out); return;
      } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.accept = ext; inp.style.display = 'none';
    inp.onchange = async () => { const out = []; for (const f of inp.files) out.push({ name: f.name, text: await f.text() }); inp.remove(); cb(out); };
    document.body.appendChild(inp); inp.click();
  }
  function importFiles() {
    pickFiles('.dat,.bez,.txt,.cor', files => {
      let n = 0, last = null; const errs = [];
      files.forEach(f => {
        try {
          const p = window.Airfoil.parseDat(f.text);        // (Hook nimmt es schon auf …)
          const id = add(p, { file: f.name, src: 'dat' });   // … hier kommt der Dateiname dazu
          if (id) { n++; last = id; }
        } catch (e) { errs.push(f.name); }
      });
      toast(T('Profile importiert: ') + n + (errs.length ? ' · ' + T('nicht lesbar: ') + errs.join(', ') : ''));
      if (last) U.sel = last;
      App.buildSidebar(); draw();
    });
  }

  // ==================================================================
  //  5. Aufklappmenü für andere Reiter (Tragflächendesigner, Auslegung)
  // ==================================================================
  // Optionen mit Gruppen als <optgroup>; Wert = Profil-id. Rückgabe true, wenn
  // es überhaupt Einträge gibt.
  function fillSelect(sel, opts) {
    opts = opts || {};
    sel.textContent = '';
    const o0 = document.createElement('option'); o0.value = ''; o0.textContent = opts.placeholder || ('— ' + T('aus Profildatenbank wählen') + ' —'); sel.appendChild(o0);
    if (!db.profiles.length) { const o = document.createElement('option'); o.value = ''; o.disabled = true; o.textContent = T('(Datenbank leer)'); sel.appendChild(o); return false; }
    const byName = (a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    const put = (label, arr) => {
      if (!arr.length) return;
      const og = document.createElement('optgroup'); og.label = label;
      arr.slice().sort(byName).forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name + ' (' + pct(metrics(p).thick) + ')'; og.appendChild(o); });
      sel.appendChild(og);
    };
    db.groups.forEach(g => put(g.name, db.profiles.filter(p => p.groups.indexOf(g.id) >= 0)));
    put(db.groups.length ? T('Ohne Gruppe') : T('Alle Profile'), db.profiles.filter(p => !db.groups.length || !p.groups.length));
    return true;
  }
  const pickers = new Set();     // lebende <select>, die bei Änderungen neu gefüllt werden
  function refreshPickers() { pickers.forEach(s => { if (!s.isConnected) { pickers.delete(s); return; } fillSelect(s, s._fdbOpts); }); }
  // Zeile für die Seitenleiste des Tragflächendesigners (profilePicker in
  // sidebar.js): Auswahl setzt das Profil sofort in die Rippe.
  function pickerRow(body, importKey) {
    const row = document.createElement('div'); row.className = 'row full';
    const sel = document.createElement('select'); sel.style.width = '100%';
    sel._fdbOpts = {}; fillSelect(sel, sel._fdbOpts); pickers.add(sel);
    sel.title = T('Profil aus der Profildatenbank einsetzen (Gruppen = Aufklappmenü-Abschnitte)');
    sel.onchange = () => {
      const p = profile(sel.value); if (!p) return;
      applyToTarget(p, importKey.type === 'root' ? { type: 'root' } : { type: 'seg', idx: importKey.idx });
    };
    row.appendChild(sel); body.appendChild(row);
    return sel;
  }

  // ---- Start ----------------------------------------------------------------
  load();

  Object.assign(App, { foildbSidebar, foildbPickerRow: pickerRow });
  window.FoilDB = { show, refresh: draw, add, remove, get, list, groups, profile, groupName, addGroup, fillSelect, pickerRow, metrics: metricsOf, applyToTarget, select, openKfm,
    _test: { db: () => db, keyOf, merge, sane } };
})();
