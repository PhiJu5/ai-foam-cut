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
  const COLORS = ['#4aa3ff', '#ff8c42', '#57d38c', '#e85d9b', '#ffd166', '#9b7bff', '#37c9d6', '#c0c0c0'];

  // ==================================================================
  //  1. Datenbank + Persistenz
  // ==================================================================
  // profiles: {id, name, pts:[[x,y]…], key, file, src, added, groups:[gid…], note}
  // groups:   {id, name}
  let db = { v: 1, autoAdd: true, profiles: [], groups: [] };
  let fileOk = false;        // Endpunkt (Datei neben der exe) erreichbar
  let loadDone = false;
  let saveTimer = null;
  const metricCache = new Map();

  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clonePts = pts => pts.map(q => [+(+q[0]).toFixed(6), +(+q[1]).toFixed(6)]);
  const toProf = (rec) => { const p = rec.pts.map(q => ({ x: q[0], y: q[1] })); p.name = rec.name; return p; };

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

  // Profil aufnehmen. opts: {name, file, src, groups}. Gleiche Kontur → vorhandener
  // Eintrag (Name/Datei werden ergänzt, falls dort nur der Platzhalter steht).
  function add(prof, opts) {
    opts = opts || {};
    if (!prof || prof.length < 5 || !window.Airfoil) return null;
    let p = prof;
    try { p = Airfoil.normalize(prof.map(q => ({ x: q.x, y: q.y }))); } catch (e) { return null; }
    const key = keyOf(p);
    const generic = n => !n || /^Profil(\s*\(.*\))?$/i.test(String(n).trim());
    let name = String(opts.name || prof.name || '').trim();
    if (generic(name) && opts.file) name = String(opts.file).replace(/\.[^.]+$/, '');
    if (!name) name = 'Profil';
    const hit = db.profiles.find(x => x.key === key);
    if (hit) {
      if (generic(hit.name) && !generic(name)) hit.name = name;
      if (!hit.file && opts.file) hit.file = String(opts.file);
      (opts.groups || []).forEach(g => { if (hit.groups.indexOf(g) < 0) hit.groups.push(g); });
      save();
      return hit.id;
    }
    const rec = { id: uid('p'), name, pts: clonePts(p.map(q => [q.x, q.y])), key,
      file: String(opts.file || ''), src: String(opts.src || 'load'), added: Date.now(),
      groups: (opts.groups || []).slice(), note: '' };
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
    ['parseDat', 'parseBez'].forEach(fn => {
      const orig = Airfoil[fn]; if (typeof orig !== 'function') return;
      Airfoil[fn] = function (text) {
        const p = orig.apply(this, arguments);
        if (db.autoAdd) { try { add(p, { src: fn === 'parseBez' ? 'bez' : 'dat' }); } catch (e) {} }
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
  const U = { sel: null, cmp: new Set(), filter: '', group: 'all', sort: 'name', edit: null,
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
    if (U.sel === id) return;
    U.sel = id; U.edit = null;
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
    const cssVar = (n, fb) => (getComputedStyle(document.body).getPropertyValue(n) || '').trim() || fb;
    const txtCol = cssVar('--txt', '#ddd'), accCol = cssVar('--accent2', '#ff8c42');
    const items = [];
    [...U.cmp].forEach((id, i) => { const r = get(id); if (r) items.push({ pts: toProf(r), col: COLORS[i % COLORS.length], name: r.name, w: 1.4 }); });
    if (U.sel && !U.cmp.has(U.sel)) { const r = get(U.sel); if (r) items.push({ pts: toProf(r), col: txtCol, name: r.name, w: 1.6 }); }
    if (U.edit && U.edit.preview) items.push({ pts: U.edit.preview, col: accCol, name: T('Vorschau (bearbeitet)'), w: 1.4, dash: [5, 4] });
    const pad = 30, v = U.view;
    const sc = (W - 2 * pad) * v.zoom, ox = pad + v.px, oy = H / 2 + v.py;
    const X = x => ox + x * sc, Y = y => oy - y * sc;
    // Sehne + Raster
    g.strokeStyle = 'rgba(128,128,128,.35)'; g.lineWidth = 1; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(1), Y(0)); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(128,128,128,.7)'; g.font = '10px ' + (getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace');
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
    if (!recs.length) { box.innerHTML = ''; return; }
    const rows = [
      [T('Max. Dicke'), r => pct(metrics(r).thick)], [T('Dickenrücklage'), r => pct(metrics(r).thickX, 0)],
      [T('Max. Wölbung'), r => pct(metrics(r).cam, 2)], [T('Wölbungsrücklage'), r => pct(metrics(r).camX, 0)],
      [T('Endleistendicke'), r => pct(metrics(r).te, 2)], [T('Nasenradius'), r => pct(metrics(r).leR, 2)],
      [T('Punkte'), r => String(r.pts.length)], [T('Gruppen'), r => r.groups.map(groupName).join(', ') || '—'],
      [T('Quelle'), r => esc(r.file || (r.src === 'naca' ? 'NACA' : r.src === 'wing' ? T('Tragfläche') : T('geladen')))]
    ];
    box.innerHTML = '<table class="fdb-tbl"><thead><tr><th></th>' + recs.map(r => {
      const col = cmpColor(r.id) || 'var(--txt)';
      return '<th><span class="fdb-dot" style="background:' + col + '"></span>' + esc(r.name) + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows.map(rw => '<tr><td>' + rw[0] + '</td>' + recs.map(r => '<td>' + rw[1](r) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  }

  // ---- Detail / Bearbeitung ---------------------------------------------------
  function drawDetail() {
    const box = $('fdbDetail'); if (!box) return;
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
        db.profiles.push(rec); save(); U.edit = null; select(rec.id); };
      const b3 = mk('button', null, T('Zurücksetzen')); b3.onclick = () => { U.edit = null; drawDetail(); drawCanvas(); };
      row.appendChild(b1); row.appendChild(b2); row.appendChild(b3); box.appendChild(row); }

    // Polaren (Rechenkern des Reiters „Aerodynamik“: NeuralFoil / 2D-Windkanal)
    box.appendChild(mk('div', 'gh', T('Polaren')));
    if (window.Aero && Aero.openFoilView && (window.Foil2D || window.NeuralFoil)) {
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
    if (t.type === 'root') state.root.profile = closed; else if (state.segments[t.idx]) state.segments[t.idx].profile = closed;
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
  window.FoilDB = { show, refresh: draw, add, remove, get, list, groups, profile, groupName, addGroup, fillSelect, pickerRow, metrics: metricsOf, applyToTarget, select,
    _test: { db: () => db, keyOf, merge, sane } };
})();
