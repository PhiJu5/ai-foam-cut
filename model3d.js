/* model3d.js — Reiter „3D-Modell"
 *
 * Lädt STL- (binär + ASCII) und OBJ-Dateien, zeigt das Netz in einer
 * orthografischen Orbit-Ansicht und zerlegt es durch senkrechte Schnittebenen
 * entlang einer wählbaren Achse (X/Y/Z) in einzelne, schneidbare Segmente.
 *
 * Schritt 1 (dieser Stand): Laden, Anzeigen, Zerlegen mit Kappen an den
 * Schnittebenen und STL-Export je Segment. Die Anbindung an die
 * Heißdraht-G-Code-Erzeugung folgt in einem zweiten Schritt.
 *
 * Eigenständiges Modul (wie Sim3D) — window.Model3D. Kein Fremd-3D-Framework;
 * dieselbe 2D-Canvas-Projektion wie die übrige App.
 */
(function () {
  'use strict';

  const T = (s) => (window.I18N ? window.I18N.t(s) : s);
  const AXIS = ['X', 'Y', 'Z'];

  // ---------- Zustand ---------------------------------------------------
  const M = {
    name: '',                 // Dateiname
    verts: null,              // Float32Array, 9 Werte je Dreieck (v0,v1,v2)
    ntri: 0,
    bbox: null,               // {min:[x,y,z], max:[x,y,z]}
    axis: 0,                  // Schnittachse 0=X 1=Y 2=Z
    planes: [],               // Schnittpositionen (Weltkoordinaten) entlang axis
    segs: null,               // [{verts:Float32Array, ntri, lo, hi, bbox}]
    sel: 'all',               // ausgewähltes Segment (Index) oder 'all'
    wire: false,              // Drahtgitter erzwingen
    showPlanes: true,
    pairTowers: false,        // Turmwege (extrapoliert) in der Segmentpaar-Ansicht zeigen (zuschaltbar)
    plateTravel: true,        // Fahrwege des Portals (Verbindungen) in der Platten-Ansicht zeigen (abschaltbar)
    sections: null,           // Cache: Schnittspuren je Ebene [{pos, loops:[[x,y,z]…]}]
    view: '3d',               // '3d' | 'profiles' (2. Fenster: Schnittprofile 2D)
    profiles: null,           // Cache: Schnittprofile je Grenze [{pos, loops:[[u,w]…], idx, n}]
    multiCache: null,         // Cache: sectionMulti-Ergebnisse "axis|pos" → {outer,inners}
    triIndex: null,           // Dreiecks-Index entlang der Achse (macht collectSection sublinear)
    contourMode: 'both',      // Konturen beim Zerlegen: 'both' außen+innen | 'outer' nur außen | 'inner' nur innen
    gapTol: null,             // Netzlücken bis zu dieser Weite überbrücken (null = automatisch, 2 % des Querschnitts)
    cleanCache: null,         // Cache: bereinigte Querschnitte "axis|pos|mode|gap|dichte"
    sectionDensity: 1         // Punktdichte der abgeleiteten Querschnitte (1 = Standard, höher = feiner)
  };

  // ---------- Kamera / Projektion (orthografisch, Orbit) ----------------
  let cam = { yaw: 0.9, pitch: 0.35, zoom: 1.0, px: 0, py: 0 };
  const CAM0 = Object.assign({}, cam);
  let canvas = null, ctx = null, W = 0, H = 0;
  let center = [0, 0, 0], radius = 100;
  let dragging = false, dragMode = '', lastX = 0, lastY = 0, redrawTimer = 0;

  function col(name, fb) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fb;
    } catch (e) { return fb; }
  }

  function rot(n) {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const x1 = n[0] * cy + n[2] * sy, z1 = -n[0] * sy + n[2] * cy;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const y2 = n[1] * cp - z1 * sp, z2 = n[1] * sp + z1 * cp;
    return [x1, y2, z2];
  }
  function toCam(x, y, z) {
    const r = rot([x - center[0], y - center[1], z - center[2]]);
    return { x: r[0], y: r[1], d: r[2] + radius * 3 };
  }
  function scr(x, y, z) {
    const c = toCam(x, y, z);
    const s = 0.42 * Math.min(W, H) / radius * cam.zoom;
    return { x: W / 2 + cam.px + s * c.x, y: H / 2 + cam.py - s * c.y, d: c.d };
  }

  // ---------- Laden ------------------------------------------------------
  // extras: weitere gewählte Dateien (z. B. .bin-Puffer zu einer .gltf).
  async function loadFile(file, extras) {
    if (Array.isArray(file)) {                       // Mehrfachauswahl: Hauptdatei suchen
      const main = file.find(f => /\.(him|gltf|glb|ac|obj|stl)$/i.test(f.name)) || file[0];
      extras = file.filter(f => f !== main); file = main;
    }
    const name = file.name || 'modell';
    const ext = (name.split('.').pop() || '').toLowerCase();
    const mb = (file.size / 1e6).toFixed(1);
    setInfo(T('Lädt ') + name + ' (' + mb + ' MB) …');
    // Ein Frame abwarten, damit die Lade-Anzeige erscheint, bevor der (bei großen
    // Dateien länger blockierende) synchrone Parser läuft.
    await new Promise(r => { let done = false; const go = () => { if (!done) { done = true; r(); } };
      requestAnimationFrame(go); setTimeout(go, 60); });   // Fallback, falls kein Frame kommt (Tab verdeckt)
    let verts;
    try {
      // Flugsimulator-Formate (X-Plane-OBJ, FlightGear-AC3D, glTF/GLB) zuerst;
      // null = kein Simulatorformat (z. B. normales Wavefront-OBJ).
      if (window.SimModel && ext !== 'stl') verts = await SimModel.parse(file, extras);
      if (verts) { /* Simulatormodell */ }
      else if (ext === 'stl') verts = parseSTL(await file.arrayBuffer());
      else if (ext === 'obj') verts = parseOBJ(await file.text());
      else throw new Error(T('Format nicht unterstützt (STL, OBJ, X-Plane-OBJ, AC3D, glTF/GLB).'));
    } catch (err) {
      setInfo(T('Fehler beim Laden: ') + err.message, true);
      return;
    }
    if (!verts || verts.length < 9) { setInfo(T('Keine Dreiecke gefunden.'), true); return; }
    setMesh(verts, name);
  }
  // Netz übernehmen + Standard-Schnittachse/Reset. Bei restore=true bleiben
  // Achse/Ebenen erhalten (werden danach vom Projekt gesetzt).
  function setMesh(verts, name, restore) {
    M.name = name;
    M.verts = verts;
    M.ntri = verts.length / 9;
    M.bbox = computeBBox(verts);
    if (!restore) {
      // Längste Ausdehnung als Standard-Schnittachse (Spannweite).
      const d = [M.bbox.max[0] - M.bbox.min[0], M.bbox.max[1] - M.bbox.min[1], M.bbox.max[2] - M.bbox.min[2]];
      M.axis = d.indexOf(Math.max(d[0], d[1], d[2]));
      M.planes = [];
      M.gapTol = null;
    }
    M.cleanCache = null;
    M.segs = null; M.sections = null; M.profiles = null; M.sel = 'all';
    M.multiCache = null; M.triIndex = null;
    plateSegCache = {}; plateGcMemo = null;
    frameCamera();
    if (window.__model3dRebuildSidebar) window.__model3dRebuildSidebar();
    draw();
    updateInfo();
  }
  // Projekt-Serialisierung: Netz (Base64 der Float32-Rohdaten) + Achse + Ebenen.
  function serialize() {
    if (!M.verts) return null;
    const fa = M.verts instanceof Float32Array ? M.verts : new Float32Array(M.verts);
    let bin = ''; const u8 = new Uint8Array(fa.buffer, fa.byteOffset, fa.byteLength);
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { name: M.name || 'modell', axis: M.axis, planes: (M.planes || []).slice(), sectionDensity: M.sectionDensity, contourMode: contourMode(), gapTol: M.gapTol, verts64: btoa(bin) };
  }
  function deserialize(obj) {
    if (!obj || !obj.verts64) return false;
    const bin = atob(obj.verts64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const verts = new Float32Array(u8.buffer);
    setMesh(verts, obj.name || 'modell', true);
    M.axis = (obj.axis != null) ? obj.axis : M.axis;
    M.planes = Array.isArray(obj.planes) ? obj.planes.slice() : [];
    if (obj.sectionDensity != null && isFinite(obj.sectionDensity)) M.sectionDensity = Math.max(0.2, Math.min(16, obj.sectionDensity));
    M.contourMode = obj.contourMode || 'both';
    M.gapTol = (obj.gapTol != null && isFinite(obj.gapTol)) ? obj.gapTol : null;
    invalidateSections(); draw(); updateInfo();
    if (window.__model3dRebuildSidebar) window.__model3dRebuildSidebar();
    return true;
  }

  // ---- STL (binär oder ASCII) ----
  function parseSTL(buf) {
    const dv = new DataView(buf);
    // Binär erkennen: Dateigröße passt zu 84 + 50*ntri
    if (buf.byteLength >= 84) {
      const n = dv.getUint32(80, true);
      if (buf.byteLength === 84 + n * 50) return parseSTLBinary(dv, n);
    }
    const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(512, buf.byteLength)));
    if (/^\s*solid/i.test(head) && /facet/i.test(head)) return parseSTLAscii(new TextDecoder().decode(buf));
    // Rückfall: als binär versuchen
    if (buf.byteLength >= 84) return parseSTLBinary(dv, dv.getUint32(80, true));
    throw new Error(T('STL nicht lesbar.'));
  }
  function parseSTLBinary(dv, n) {
    const out = new Float32Array(n * 9);
    let o = 84, k = 0;
    for (let i = 0; i < n; i++) {
      o += 12; // Normale überspringen
      for (let v = 0; v < 9; v++) { out[k++] = dv.getFloat32(o, true); o += 4; }
      o += 2; // Attribut-Bytes
    }
    return out;
  }
  function parseSTLAscii(txt) {
    const nums = [];
    // Vollständige Fließkomma-Notation inkl. Vorzeichen und (auch negativem!)
    // Exponent — sonst werden Werte wie „2.23e-01" am „e" abgeschnitten und die
    // Koordinaten verfälscht (Netz zerreißt).
    const N = '(-?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)';
    const re = new RegExp('vertex\\s+' + N + '\\s+' + N + '\\s+' + N, 'g');
    let m;
    while ((m = re.exec(txt))) { nums.push(+m[1], +m[2], +m[3]); }
    return new Float32Array(nums);
  }

  // ---- OBJ (Wavefront, ASCII) ----
  // Nur Geometrie: v-Zeilen (Eckpunkte) + f-Zeilen (Flächen). Indizes der Form
  // „7/2/5" werden auf den Positionsindex reduziert, negative Indizes zählen
  // vom Ende. n-Ecke werden als Fächer trianguliert. Ergebnis wie bei STL:
  // Dreieckssuppe (9 Floats je Dreieck), gemeinsame Ecken werden dupliziert.
  function parseOBJ(txt) {
    const vx = [], out = [];
    const lines = txt.split('\n');
    for (let li = 0; li < lines.length; li++) {
      const s = lines[li];
      const c0 = s.charCodeAt(0), c1 = s.charCodeAt(1);
      if (c0 === 118 /* v */ && (c1 === 32 || c1 === 9)) {
        const p = s.slice(2).trim().split(/\s+/);
        vx.push(+p[0], +p[1], +p[2]);
      } else if (c0 === 102 /* f */ && (c1 === 32 || c1 === 9)) {
        const p = s.slice(2).trim().split(/\s+/);
        const idx = [];
        for (let k = 0; k < p.length; k++) {
          let i = parseInt(p[k], 10);                 // „7/2/5" → 7
          if (!i) continue;
          if (i < 0) i = vx.length / 3 + 1 + i;       // negativ = relativ zum Ende
          const o = (i - 1) * 3;
          if (o >= 0 && o + 2 < vx.length) idx.push(o);
        }
        for (let k = 2; k < idx.length; k++) {
          const a = idx[0], b = idx[k - 1], c = idx[k];
          out.push(vx[a], vx[a + 1], vx[a + 2],
                   vx[b], vx[b + 1], vx[b + 2],
                   vx[c], vx[c + 1], vx[c + 2]);
        }
      }
    }
    if (!out.length) throw new Error(T('OBJ nicht lesbar (keine Flächen gefunden).'));
    return new Float32Array(out);
  }

  // ---------- Geometrie -------------------------------------------------
  function computeBBox(verts) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < verts.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        const v = verts[i + a];
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
      }
    }
    return { min, max };
  }
  function frameCamera() {
    const b = M.bbox;
    center = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    radius = 0.5 * Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) || 100;
    Object.assign(cam, CAM0);
  }

  // Grenzen entlang der Achse: [min, sortierte Ebenen, max]
  function boundaries() {
    const lo = M.bbox.min[M.axis], hi = M.bbox.max[M.axis];
    const ps = M.planes.filter(p => p > lo + 1e-6 && p < hi - 1e-6).slice().sort((a, b) => a - b);
    return [lo, ...ps, hi];
  }
  function sortedPlanes() {
    const lo = M.bbox.min[M.axis], hi = M.bbox.max[M.axis];
    return M.planes.filter(p => p > lo + 1e-6 && p < hi - 1e-6).slice().sort((a, b) => a - b);
  }
  // Schnitt-Namen: S0 = Modellanfang, S1…S(n−1) = Schnittebenen, Sn = Modellende
  // (Reihenfolge entlang der Achse). Segment k liegt zwischen Sk (Seite A) und S(k+1) (Seite B).
  function sectionName(i) { return 'S' + i; }
  function sectionLabel(i) { const b = boundaries(); return sectionName(i) + ' · ' + AXIS[M.axis] + ' = ' + (+b[i]).toFixed(1); }
  // Lage im Raum eines Segments: Achse, Ebenen-Achsen (u,w) und beide Stirnschnitte.
  function sectionInfo(seg) {
    const b = boundaries(); if (seg < 0 || seg >= b.length - 1) return null;
    const ax = M.axis;
    return { axis: ax, axisName: AXIS[ax], u: AXIS[(ax + 1) % 3], w: AXIS[(ax + 2) % 3], seg,
      a: { idx: seg, name: sectionName(seg), pos: b[seg] }, b: { idx: seg + 1, name: sectionName(seg + 1), pos: b[seg + 1] } };
  }
  // Schnittspuren (Konturlinien) des Modells mit jeder gesetzten Ebene berechnen.
  // Ebenen/Achse geändert → Schnitt-Caches verwerfen. Der Dreiecks-Index (M.triIndex)
  // hängt nur an Netz+Achse und prüft seine Achse selbst — bleibt über Ebenenänderungen
  // hinweg gültig und wird nur bei Netz-/Achswechsel neu gebaut.
  function invalidateSections() { M.cleanCache = null; M.triClass = null; M.sections = null; M.segs = null; M.profiles = null; M.multiCache = null; plateSegCache = {}; plateGcMemo = null; }
  // Caches, damit die Platten-Ansicht nicht bei jedem Neuzeichnen (Schwenken/
  // Zoomen/Ziehen) die teure Modell-Schnittberechnung wiederholt. Einmal aus dem
  // 3D-Modell erzeugt, sind die Pfade davon entkoppelt (nur Layout-Änderungen
  // bauen neu). Invalidiert bei Modell-/Achsen-/Ebenen-Änderung.
  let plateSegCache = {};   // seg+optSig -> {towerL,towerR,profA,profB} (Kontur am Ursprung)
  let plateGcMemo = null;   // {key, gc} — komplette Platte, nur bei Layout-Änderung neu
  function ensureSections() {
    if (M.sections || !M.verts) return;
    const ax = M.axis, u = (ax + 1) % 3, w = (ax + 2) % 3, tol = sectionTol();
    M.sections = sortedPlanes().map(pos => ({ pos, loops: collectSection(ax, pos).map(l => simplifyClosed(l, tol, u, w)) }));
  }
  // Schnittprofile an ALLEN Grenzen (Modellanfang, Ebenen, Modellende), in die
  // Ebenen-Koordinaten (u,w) projiziert — lagerichtig zueinander (gleicher
  // Nullpunkt), sodass die Profile übereinanderliegen wie im Modell.
  function ensureProfiles() {
    if (M.profiles || !M.verts) return;
    const ax = M.axis, u = (ax + 1) % 3, w = (ax + 2) % 3, tol = sectionTol();
    const bnd = boundaries();
    M.profiles = bnd.map((pos, i) => {
      const loops = collectSection(ax, pos).map(l => simplifyClosed(l.map(p => [p[u], p[w]]), tol, 0, 1));
      return { pos, loops, idx: i, n: bnd.length };
    });
  }

  // Polygon (Liste [x,y,z]) an einer Achsenebene beschneiden.
  // side=+1 behält coord>=lim, side=-1 behält coord<=lim.
  function clipPoly(poly, axis, side, lim) {
    if (poly.length === 0) return poly;
    const out = [];
    const inside = p => side > 0 ? (p[axis] >= lim) : (p[axis] <= lim);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) {
        const t = (lim - a[axis]) / (b[axis] - a[axis]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
    return out;
  }

  // Querschnitt-Kappe an einer Ebene: Schnittsegmente aller Dreiecke sammeln,
  // zu Schleifen fügen und als Fächer von der Schwerlinie triangulieren.
  // dir = +1: Kappen-Normale zeigt in +Achse, dir = -1 in −Achse.
  // Querschnitt-Schleifen an einer Achsenebene sammeln (Weltkoordinaten [x,y,z]).
  // Dreiecks-Index entlang der Achse: jedes Dreieck in die Bins seines
  // [min,max]-Bereichs einsortieren. Ein Schnitt bei „lim" muss dann nur noch die
  // Dreiecke des zugehörigen Bins prüfen statt aller — O(√Dreiecke) statt O(Dreiecke).
  // Gilt für Netz + Achse; über Ebenenänderungen hinweg gültig.
  function ensureTriIndex(axis) {
    if (M.triIndex && M.triIndex.axis === axis) return M.triIndex;
    const v = M.verts, b = M.bbox;
    const lo = b.min[axis], hi = b.max[axis], span = (hi - lo) || 1;
    const ntri = v.length / 9;
    const nbin = Math.max(16, Math.min(2048, Math.round(Math.sqrt(ntri)) || 16));
    const binW = span / nbin;
    const bins = new Array(nbin); for (let k = 0; k < nbin; k++) bins[k] = [];
    for (let i = 0; i < v.length; i += 9) {
      const a = v[i + axis], c = v[i + 3 + axis], e = v[i + 6 + axis];
      let tmin = a, tmax = a; if (c < tmin) tmin = c; if (c > tmax) tmax = c; if (e < tmin) tmin = e; if (e > tmax) tmax = e;
      let k0 = Math.floor((tmin - lo) / binW), k1 = Math.floor((tmax - lo) / binW);
      if (k0 < 0) k0 = 0; if (k1 >= nbin) k1 = nbin - 1; if (k1 < 0 || k0 >= nbin) continue;
      for (let k = k0; k <= k1; k++) bins[k].push(i);
    }
    return (M.triIndex = { axis, lo, binW, nbin, bins: bins.map(arr => Int32Array.from(arr)) });
  }
  function collectSectionRaw(axis, lim) {
    // Ebene minimal versetzen, falls sie exakt auf einer Vertex-Reihe liegt:
    // Punkte genau in der Ebene erzeugen sonst entartete, zerrissene Segmente.
    // Der Versatz (~Bruchteil der Ausdehnung) ist geometrisch vernachlässigbar,
    // aber größer als die übliche Koordinaten-Streuung im Netz.
    const b = M.bbox;
    const span = b ? (b.max[axis] - b.min[axis]) : 1;
    const mid = b ? (b.min[axis] + b.max[axis]) / 2 : 0;
    lim += (lim <= mid ? 1 : -1) * span * 5e-4;   // immer ins Modellinnere versetzt
    const segsL = [];       // Schnittsegmente [ [x,y,z], [x,y,z] ]
    const v = M.verts;
    // Nur die Dreiecke des zur Schnitthöhe gehörenden Bins prüfen (Index).
    const ix = ensureTriIndex(axis);
    let k = Math.floor((lim - ix.lo) / ix.binW); if (k < 0) k = 0; else if (k >= ix.nbin) k = ix.nbin - 1;
    const cand = ix.bins[k];
    for (let ci = 0; ci < cand.length; ci++) {
      const i = cand[ci];
      const tri = [[v[i], v[i + 1], v[i + 2]], [v[i + 3], v[i + 4], v[i + 5]], [v[i + 6], v[i + 7], v[i + 8]]];
      const pts = [];
      for (let e = 0; e < 3; e++) {
        const a = tri[e], b = tri[(e + 1) % 3];
        const da = a[axis] - lim, db = b[axis] - lim;
        if ((da < 0 && db >= 0) || (da >= 0 && db < 0)) {
          const t = da / (da - db);
          pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
        }
      }
      if (pts.length === 2) segsL.push(pts);
    }
    if (!segsL.length) return [];
    return assembleLoops(segsL);
  }
  // ---- Bereinigter Querschnitt (Außen/Innen) -----------------------------
  // Reale OBJ/STL (Baugruppen aus mehreren Körpern, offene Netze, Spanten im
  // Inneren) liefern an einer Ebene keine sauberen geschlossenen Schleifen,
  // sondern Bruchstücke, Lücken und sich überlappende Konturen. Deshalb wird
  // der Querschnitt über ein Raster topologisch bestimmt:
  //   1) Schnittsegmente als Wände rastern, Lücken bis gapTol schließen
  //      (Wände aufdicken, von außen fluten, Flut wieder zurückwachsen).
  //   2) Freie Innenbereiche per Umlaufzahl (orientierte Segmente aus den
  //      Dreiecksnormalen, 4 Strahlen) als Material oder Hohlraum einstufen.
  //   3) Maske je Konturmodus (außen / außen+innen / nur innen) umranden und
  //      die Randpunkte exakt auf die Netzkanten zurückprojizieren (Ecken aus
  //      gemeinsamen Segmentendpunkten) → maßhaltig; nur Lücken werden gerade überbrückt.
  // M.contourMode: 'both' | 'outer' | 'inner' — wird VOR dem Zerlegen gewählt.
  function contourMode() { const m = M.contourMode; return (m === 'outer' || m === 'inner') ? m : 'both'; }
  function gapTolAuto() {
    const b = M.bbox; if (!b) return 1;
    const u = (M.axis + 1) % 3, w = (M.axis + 2) % 3;
    return 0.02 * Math.max(b.max[u] - b.min[u], b.max[w] - b.min[w]);
  }
  function gapTol() { return (M.gapTol != null && isFinite(M.gapTol) && M.gapTol >= 0) ? M.gapTol : gapTolAuto(); }
  // Rohe, orientierte Schnittsegmente in (u,w): [ax,ay,bx,by], Material links
  // (aus der Dreiecksnormale).
  function rawSectionSegs(axis, lim) {
    const u = (axis + 1) % 3, w = (axis + 2) % 3;
    const v = M.verts, ix = ensureTriIndex(axis), out = [];
    let k = Math.floor((lim - ix.lo) / ix.binW); if (k < 0) k = 0; else if (k >= ix.nbin) k = ix.nbin - 1;
    const cand = ix.bins[k];
    for (let ci = 0; ci < cand.length; ci++) {
      const i = cand[ci], P = [];
      for (let e = 0; e < 3; e++) {
        const a = i + e * 3, b = i + ((e + 1) % 3) * 3;
        const da = v[a + axis] - lim, db = v[b + axis] - lim;
        if ((da < 0 && db >= 0) || (da >= 0 && db < 0)) {
          const t = da / (da - db);
          P.push(v[a + u] + (v[b + u] - v[a + u]) * t, v[a + w] + (v[b + w] - v[a + w]) * t);
        }
      }
      if (P.length !== 4) continue;
      const e1 = [v[i + 3] - v[i], v[i + 4] - v[i + 1], v[i + 5] - v[i + 2]];
      const e2 = [v[i + 6] - v[i], v[i + 7] - v[i + 1], v[i + 8] - v[i + 2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const tu = -n[w], tw = n[u];          // Tangente mit Material links: (−n_w, n_u)
      if ((P[2] - P[0]) * tu + (P[3] - P[1]) * tw < 0) out.push([P[2], P[3], P[0], P[1]]);
      else out.push(P);
    }
    return out;
  }
  // Umlaufzahl eines Punkts bzgl. der orientierten Segmente; Strahl dir 0:+u 1:−u 2:+w 3:−w.
  function windingRay(S, px, py, dir) {
    let wn = 0;
    for (const s of S) {
      let ax, ay, bx, by;   // so gedreht, dass der Strahl nach +x zeigt
      if (dir === 0) { ax = s[0] - px; ay = s[1] - py; bx = s[2] - px; by = s[3] - py; }
      else if (dir === 1) { ax = px - s[0]; ay = py - s[1]; bx = px - s[2]; by = py - s[3]; }
      else if (dir === 2) { ax = s[1] - py; ay = px - s[0]; bx = s[3] - py; by = px - s[2]; }
      else { ax = py - s[1]; ay = s[0] - px; bx = py - s[3]; by = s[2] - px; }
      if ((ay <= 0) !== (by <= 0)) {
        const x = ax + (bx - ax) * (0 - ay) / (by - ay);
        if (x > 0) wn += by > ay ? 1 : -1;
      }
    }
    return wn;
  }
  // Offene Kettenenden (Knotengrad 1 nach Verschweißen) paarweise überbrücken,
  // wenn sie höchstens gapT auseinanderliegen (nächste Paare zuerst). Rückgabe:
  // Brückensegmente [ax,ay,bx,by] — schließen Netzlücken, ohne Kerben zuzuschütten.
  function gapBridges(S, gapT, eps) {
    const inv = 1 / eps, pts = [], deg = [], cell = new Map();
    const weld = (x, y) => {
      const gx = Math.round(x * inv), gy = Math.round(y * inv);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const a = cell.get((gx + dx) + ',' + (gy + dy));
        if (a) for (const k of a) if ((pts[k][0] - x) ** 2 + (pts[k][1] - y) ** 2 <= eps * eps) return k;
      }
      const k = pts.length; pts.push([x, y]); deg.push(0);
      const key = gx + ',' + gy, a = cell.get(key); if (a) a.push(k); else cell.set(key, [k]);
      return k;
    };
    const seen = new Set();
    for (const sg of S) {
      const a = weld(sg[0], sg[1]), b = weld(sg[2], sg[3]);
      if (a === b) continue;
      const ek = a < b ? a + '_' + b : b + '_' + a; if (seen.has(ek)) continue; seen.add(ek);
      deg[a]++; deg[b]++;
    }
    const ends = []; for (let k = 0; k < pts.length; k++) if (deg[k] === 1) ends.push(pts[k]);
    if (ends.length < 2 || ends.length > 4000) return { B: [], open: ends.length };
    const pairs = [], g2 = gapT * gapT;
    for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
      const d = (ends[i][0] - ends[j][0]) ** 2 + (ends[i][1] - ends[j][1]) ** 2;
      if (d <= g2) pairs.push([d, i, j]);
    }
    pairs.sort((p, q) => p[0] - q[0]);
    const used = new Uint8Array(ends.length), out = [];
    for (const [, i, j] of pairs) { if (used[i] || used[j]) continue; used[i] = used[j] = 1; out.push([ends[i][0], ends[i][1], ends[j][0], ends[j][1]]); }
    return { B: out, open: ends.length - 2 * out.length };
  }
  // Rasterklassifikation. Rückgabe {lab,nx,ny,x0,y0,h} oder null (keine geschlossene
  // Fläche); lab 0 = außen, 1 = Material (inkl. Wände), 2 = Hohlraum.
  // S = orientierte Netzsegmente (Umlaufzahl), B = Brücken (nur Wand).
  function sectionRaster(S, B, R) {
    if (!S.length) return null;
    const SB = B.length ? S.concat(B) : S;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of SB) { x0 = Math.min(x0, s[0], s[2]); x1 = Math.max(x1, s[0], s[2]); y0 = Math.min(y0, s[1], s[3]); y1 = Math.max(y1, s[1], s[3]); }
    const ext = Math.max(x1 - x0, y1 - y0, 1e-9), h = ext / R, pad = 3;
    x0 -= pad * h; y0 -= pad * h;
    const nx = Math.ceil((x1 - x0) / h) + pad + 1, ny = Math.ceil((y1 - y0) / h) + pad + 1, N = nx * ny;
    const wall = new Uint8Array(N);
    for (const s of SB) {
      const dx = s[2] - s[0], dy = s[3] - s[1], n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / h * 2));
      for (let k = 0; k <= n; k++) {
        const cx = Math.floor((s[0] + dx * k / n - x0) / h), cy = Math.floor((s[1] + dy * k / n - y0) / h);
        wall[cy * nx + cx] = 1;
      }
    }
    // von außen fluten (4er-Nachbarschaft; Wände sind 8-zusammenhängend → dicht)
    const lab = new Uint8Array(N).fill(1), q = new Int32Array(N); let qh = 0, qt = 0;
    const push = i => { if (lab[i] === 1 && !wall[i]) { lab[i] = 0; q[qt++] = i; } };
    for (let x = 0; x < nx; x++) { push(x); push((ny - 1) * nx + x); }
    for (let y = 0; y < ny; y++) { push(y * nx); push(y * nx + nx - 1); }
    while (qh < qt) { const i = q[qh++], x = i % nx; if (x > 0) push(i - 1); if (x < nx - 1) push(i + 1); if (i >= nx) push(i - nx); if (i < N - nx) push(i + nx); }
    let inner = 0;
    for (let i = 0; i < N; i++) if (lab[i] === 1 && !wall[i]) inner++;
    if (inner < 9) return null;                               // keine geschlossene Fläche
    // Wände zählen nur als Material, wenn Innenraum angrenzt — frei nach außen
    // ragende Flächen (Spanten, Stege, offene Bleche) fallen weg.
    for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
      const i = y * nx + x; if (!wall[i]) continue;
      let ok = 0;
      for (let dy = -1; dy <= 1 && !ok; dy++) for (let dx = -1; dx <= 1; dx++) { const j = i + dy * nx + dx; if (lab[j] === 1 && !wall[j]) { ok = 1; break; } }
      if (!ok) lab[i] = 4;
    }
    for (let i = 0; i < N; i++) if (lab[i] === 4) lab[i] = 0;
    // freie Innenbereiche → Zusammenhangskomponenten → Umlaufzahl
    const seen = new Uint8Array(N);
    for (let s0 = 0; s0 < N; s0++) {
      if (lab[s0] !== 1 || wall[s0] || seen[s0]) continue;
      qh = qt = 0; seen[s0] = 1; q[qt++] = s0;
      while (qh < qt) { const i = q[qh++], x = i % nx;
        if (x > 0) { const j = i - 1; if (!seen[j] && lab[j] === 1 && !wall[j]) { seen[j] = 1; q[qt++] = j; } }
        if (x < nx - 1) { const j = i + 1; if (!seen[j] && lab[j] === 1 && !wall[j]) { seen[j] = 1; q[qt++] = j; } }
        if (i >= nx) { const j = i - nx; if (!seen[j] && lab[j] === 1 && !wall[j]) { seen[j] = 1; q[qt++] = j; } }
        if (i < N - nx) { const j = i + nx; if (!seen[j] && lab[j] === 1 && !wall[j]) { seen[j] = 1; q[qt++] = j; } } }
      if (qt < 9) continue;
      // Hohlraum, wenn ≥3 von 4 Strahlen Umlaufzahl 0 liefern (robust gegen einzelne Spanten/offene Flächen)
      const px = x0 + ((s0 % nx) + 0.5) * h, py = y0 + (Math.floor(s0 / nx) + 0.5) * h;
      let zeros = 0; for (let d = 0; d < 4; d++) if (windingRay(S, px, py, d) === 0) zeros++;
      if (zeros >= 3) for (let t = 0; t < qt; t++) lab[q[t]] = 2;
    }
    return { lab, nx, ny, x0, y0, h, inner };
  }
  // Umrandung einer Binärmaske über Zellkanten; Maske links → außen CCW, Löcher CW.
  function traceMask(mask, nx, ny) {
    const V = nx + 1, next = new Map();
    const inM = (x, y) => x >= 0 && y >= 0 && x < nx && y < ny && mask[y * nx + x];
    const add = (a, b) => { const l = next.get(a); if (l) l.push(b); else next.set(a, [b]); };
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      if (!mask[y * nx + x]) continue;
      const c00 = y * V + x, c10 = c00 + 1, c01 = c00 + V, c11 = c01 + 1;
      if (!inM(x, y - 1)) add(c00, c10);
      if (!inM(x + 1, y)) add(c10, c11);
      if (!inM(x, y + 1)) add(c11, c01);
      if (!inM(x - 1, y)) add(c01, c00);
    }
    const loops = [];
    for (const [s0, l0] of next) {
      while (l0.length) {
        const loop = [s0]; let prev = s0, cur = l0.pop(), guard = 0;
        while (cur !== s0 && guard++ < 4e6) {
          loop.push(cur);
          const l = next.get(cur); if (!l || !l.length) break;
          let k = 0;
          if (l.length > 1) {   // Sattelpunkt: rechts abbiegen (Maske 4-zusammenhängend)
            const dx = (cur % V) - (prev % V), dy = Math.floor(cur / V) - Math.floor(prev / V);
            for (let t = 0; t < l.length; t++) { const ex = (l[t] % V) - (cur % V), ey = Math.floor(l[t] / V) - Math.floor(cur / V); if (dx * ey - dy * ex < 0) { k = t; break; } }
          }
          prev = cur; cur = l.splice(k, 1)[0];
        }
        if (loop.length >= 4) loops.push(loop.map(c => [c % V, Math.floor(c / V)]));
      }
    }
    return loops;
  }
  function segGrid(S, cs) {
    let x0 = Infinity, y0 = Infinity;
    for (const s of S) { x0 = Math.min(x0, s[0], s[2]); y0 = Math.min(y0, s[1], s[3]); }
    const map = new Map();
    S.forEach((s, i) => {
      const gx0 = Math.floor((Math.min(s[0], s[2]) - x0) / cs), gx1 = Math.floor((Math.max(s[0], s[2]) - x0) / cs);
      const gy0 = Math.floor((Math.min(s[1], s[3]) - y0) / cs), gy1 = Math.floor((Math.max(s[1], s[3]) - y0) / cs);
      for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) { const k = x + ',' + y; const a = map.get(k); if (a) a.push(i); else map.set(k, [i]); }
    });
    return { x0, y0, cs, map };
  }
  // Rasterrand exakt auf die Netzkanten projizieren (nächstes Segment im Umkreis),
  // Ecken aus gemeinsamen Segmentendpunkten einfügen, Rückwärtsspitzen entfernen.
  function snapLoop(L, S, grid, rad, h, epsJoin) {
    const near = (px, py) => {
      const gx = Math.floor((px - grid.x0) / grid.cs), gy = Math.floor((py - grid.y0) / grid.cs), gr = Math.ceil(rad / grid.cs);
      let best = -1, bd = rad * rad, bx = px, by = py;
      for (let yy = gy - gr; yy <= gy + gr; yy++) for (let xx = gx - gr; xx <= gx + gr; xx++) {
        const cell = grid.map.get(xx + ',' + yy); if (!cell) continue;
        for (const si of cell) {
          const s = S[si], dx = s[2] - s[0], dy = s[3] - s[1], L2 = dx * dx + dy * dy;
          let t = L2 > 0 ? ((px - s[0]) * dx + (py - s[1]) * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = s[0] + dx * t, qy = s[1] + dy * t, d = (qx - px) ** 2 + (qy - py) ** 2;
          if (d < bd) { bd = d; best = si; bx = qx; by = qy; }
        }
      }
      return { x: bx, y: by, s: best };
    };
    const P = L.map(p => near(p[0], p[1]));
    const e2 = epsJoin * epsJoin;
    const shared = (a, b) => {
      if (a < 0 || b < 0 || a === b) return null;
      const A = S[a], B = S[b];
      for (let i = 0; i < 4; i += 2) for (let j = 0; j < 4; j += 2)
        if ((A[i] - B[j]) ** 2 + (A[i + 1] - B[j + 1]) ** 2 <= e2) return [(A[i] + B[j]) / 2, (A[i + 1] + B[j + 1]) / 2];
      return null;
    };
    const out = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      out.push([a.x, a.y]);
      const c = shared(a.s, b.s); if (c) out.push(c);
    }
    const tiny = (h * 0.02) ** 2;
    let Q = out, changed = true, it = 0;
    while (changed && it++ < 30) {
      changed = false; const R = [];
      for (let i = 0; i < Q.length; i++) {
        const p = Q[i], pr = R.length ? R[R.length - 1] : Q[Q.length - 1], nx = Q[(i + 1) % Q.length];
        if ((p[0] - pr[0]) ** 2 + (p[1] - pr[1]) ** 2 <= tiny) { changed = true; continue; }
        const ax = p[0] - pr[0], ay = p[1] - pr[1], bx = nx[0] - p[0], by = nx[1] - p[1];
        const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
        if (la > 0 && lb > 0 && (ax * bx + ay * by) / (la * lb) < -0.985) { changed = true; continue; }
        R.push(p);
      }
      Q = R; if (Q.length < 3) return [];
    }
    return Q;
  }
  // Douglas-Peucker für geschlossene 2D-Schleife (ohne Punktdeckel).
  function dpClosed2D(P, tol) {
    const n = P.length; if (n <= 4) return P;
    let far = 0, fd = -1;
    for (let i = 1; i < n; i++) { const d = (P[i][0] - P[0][0]) ** 2 + (P[i][1] - P[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
    const keep = new Uint8Array(n); keep[0] = 1; keep[far] = 1;
    dpOpen(P, 0, 1, 0, far, keep, tol * tol); dpOpen(P, 0, 1, far, n, keep, tol * tol);
    const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(P[i]);
    return out.length >= 3 ? out : P;
  }
  // Raster eines Querschnitts mit Lückenüberbrückung. Offene Kettenenden bis
  // gapTol überbrücken; weitere Stufen (×2 … ×16) nur, solange offene Enden
  // bleiben UND die Innenfläche dadurch deutlich wächst (sonst sind die Enden
  // nur frei endende Stege/Spanten). Rückgabe {ra, B, eps} oder null.
  function sliceRaster(S, R) {
    const eps = Math.max(modelDiag() * 1e-6, 1e-9);
    let ra = null, B = [], gt = gapTol();
    for (let k = 0; k < 5; k++, gt *= 2) {
      const br = gapBridges(S, gt, Math.max(eps, gt * 1e-3));
      const r2 = sectionRaster(S, br.B, R);
      if (r2 && (!ra || r2.inner > ra.inner * 1.05)) { ra = r2; B = br.B; }
      else if (ra) break;
      if (!br.open && ra) break;
    }
    return ra ? { ra, B, eps } : null;
  }
  // Mantel-Dreiecke je Konturmodus einstufen (für die Zerlegung): an K Stützschnitten
  // entlang der Achse wird das Raster bestimmt; ein Dreieck gehört zur Außenhaut,
  // wenn nahe seinem Schwerpunkt „außen" liegt, zur Innenhaut bei „Hohlraum",
  // sonst ist es Innenleben (Spanten, verdeckte Bauteile). Rückgabe Uint8Array je
  // Dreieck: 1 = Außenhaut, 2 = Innenhaut, 3 = beides, 0 = Innenleben, 255 = unbekannt.
  function classifyTris() {
    const ax = M.axis, u = (ax + 1) % 3, w = (ax + 2) % 3, v = M.verts, nt = v.length / 9;
    const lo = M.bbox.min[ax], hi = M.bbox.max[ax], span = (hi - lo) || 1;
    const K = 64, R = 256, sl = [];
    for (let k = 0; k < K; k++) {
      const pos = lo + span * (k + 0.5) / K;
      let r = null; try { const S = rawSectionSegs(ax, pos); r = S.length >= 3 ? sliceRaster(S, R) : null; } catch (e) { r = null; }
      sl.push(r && r.ra);
    }
    const cls = new Uint8Array(nt);
    for (let t = 0; t < nt; t++) {
      const i = t * 9;
      const ca = (v[i + ax] + v[i + 3 + ax] + v[i + 6 + ax]) / 3;
      const cu = (v[i + u] + v[i + 3 + u] + v[i + 6 + u]) / 3, cw = (v[i + w] + v[i + 3 + w] + v[i + 6 + w]) / 3;
      let k = Math.floor((ca - lo) / span * K); k = k < 0 ? 0 : k >= K ? K - 1 : k;
      const ra = sl[k]; if (!ra) { cls[t] = 255; continue; }
      const da = Math.abs(ca - (lo + span * (k + 0.5) / K));
      const rr = Math.min(40, 2 + Math.ceil(da * 3 / ra.h));      // Schräglage der Fläche zwischen Stützschnitten
      const cx = Math.floor((cu - ra.x0) / ra.h), cy = Math.floor((cw - ra.y0) / ra.h);
      let c = 0;
      for (let y = cy - rr; y <= cy + rr && c !== 3; y++) {
        if (y < 0 || y >= ra.ny) { c |= 1; continue; }
        for (let x = cx - rr; x <= cx + rr; x++) {
          if (x < 0 || x >= ra.nx) { c |= 1; continue; }
          const l = ra.lab[y * ra.nx + x]; if (l === 0) c |= 1; else if (l === 2) c |= 2;
        }
      }
      cls[t] = c;
    }
    return cls;
  }
  // Bereinigte Schleifen in (u,w) je Konturmodus: [{pts, hole}] (außen CCW, Löcher CW);
  // null → Rückfall auf die rohe Schleifenbildung.
  function cleanSection2D(axis, lim, mode) {
    const S = rawSectionSegs(axis, lim);
    if (S.length < 3) return null;
    const R = Math.round(Math.max(300, Math.min(2400, 900 * Math.sqrt(sectionDensity()))));
    const sl = sliceRaster(S, R);
    if (!sl) return null;
    const ra = sl.ra, B = sl.B, eps = sl.eps;
    const { lab, nx, ny, x0, y0, h } = ra, N = nx * ny;
    const mask = new Uint8Array(N);
    let any = 0;
    for (let i = 0; i < N; i++) {
      const m = mode === 'outer' ? lab[i] !== 0 : mode === 'inner' ? lab[i] === 2 : lab[i] === 1;
      if (m) { mask[i] = 1; any++; }
    }
    if (!any) return mode === 'inner' ? [] : null;
    const SB = B.length ? S.concat(B) : S;
    const grid = segGrid(SB, h * 4), rad = 3 * h, ej = Math.max(eps, h * 0.02);
    const res = [];
    for (const L of traceMask(mask, nx, ny)) {
      const W = L.map(p => [x0 + p[0] * h, y0 + p[1] * h]);
      const a = polyArea2D(W);
      if (Math.abs(a) < 9 * h * h) continue;
      let sn = snapLoop(W, SB, grid, rad, h, ej);
      if (sn.length < 3) continue;
      sn = dpClosed2D(sn, h * 0.03);
      if (sn.length < 3) continue;
      res.push({ pts: sn, hole: a < 0 });
    }
    return res;
  }
  // Querschnitt-Schleifen in Weltkoordinaten [x,y,z] (Achsanteil = lim). Nutzt den
  // bereinigten Querschnitt; nur wenn der scheitert, die rohe Schleifenbildung.
  // Schleifen tragen .hole (Innenkontur).
  function collectSection(axis, lim) {
    const ck = axis + '|' + lim + '|' + contourMode() + '|' + gapTol() + '|' + sectionDensity();
    if (!M.cleanCache) M.cleanCache = new Map();
    if (M.cleanCache.has(ck)) return M.cleanCache.get(ck);
    const u = (axis + 1) % 3, w = (axis + 2) % 3;
    const b = M.bbox, span = b ? (b.max[axis] - b.min[axis]) : 1, mid = b ? (b.min[axis] + b.max[axis]) / 2 : 0;
    const lim2 = lim + (lim <= mid ? 1 : -1) * span * 5e-4;   // minimal ins Modellinnere (Vertex-Reihen)
    let cl = null;
    try { cl = cleanSection2D(axis, lim2, contourMode()); } catch (e) { cl = null; }
    const lift = p2 => { const p = [0, 0, 0]; p[axis] = lim; p[u] = p2[0]; p[w] = p2[1]; return p; };
    let loops;
    if (cl) loops = cl.map(o => { const l = o.pts.map(lift); l.hole = o.hole; return l; });
    else loops = collectSectionRaw(axis, lim);
    if (M.cleanCache.size > 400) M.cleanCache.clear();
    M.cleanCache.set(ck, loops);
    return loops;
  }
  // Kappe an einer Ebene: bereinigte Schleifen (außen + zugehörige Löcher)
  // per earcut triangulieren. dir = +1: Normale in +Achse, −1 in −Achse.
  function buildCap(axis, lim, dir, sink) {
    const loops = collectSection(axis, lim);
    if (!loops.length) return;
    const u = (axis + 1) % 3, w = (axis + 2) % 3;
    const P2 = l => l.map(p => [p[u], p[w]]);
    const outers = [], holes = [];
    for (const l of loops) { if (l.length < 3) continue; const q = P2(l); (l.hole ? holes : outers).push({ l, q, a: Math.abs(polyArea2D(q)) }); }
    const groups = outers.map(o => ({ o, hs: [] }));
    for (const hl of holes) {   // Loch → kleinste umschließende Außenkontur
      let best = null;
      for (const g of groups) if (g.o.a > hl.a && pointInPoly(hl.q[0], g.o.q) && (!best || g.o.a < best.o.a)) best = g;
      if (best) best.hs.push(hl);
    }
    const emit = (a, b, c) => {
      const cr = (b[u] - a[u]) * (c[w] - a[w]) - (b[w] - a[w]) * (c[u] - a[u]);
      if (cr * dir < 0) { const t = b; b = c; c = t; }
      sink.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    };
    for (const g of groups) {
      const rings = [g.o.l].concat(g.hs.map(h => h.l));
      const flat = [].concat(...rings);
      let T = null;
      const EC = window.App && window.App.earcut;
      if (EC) { try { T = EC(rings.map(r => r.map(p => ({ x: p[u], y: p[w] })))); } catch (e) { T = null; } }
      if (T && T.tris.length) { for (const t of T.tris) emit(flat[t[0]], flat[t[1]], flat[t[2]]); continue; }
      // Rückfall: Fächer vom Schwerpunkt (nur Außenkontur)
      const loop = g.o.l, c = [0, 0, 0];
      for (const p of loop) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
      c[0] /= loop.length; c[1] /= loop.length; c[2] /= loop.length; c[axis] = lim;
      for (let i = 0; i < loop.length; i++) emit(c, loop[i], loop[(i + 1) % loop.length]);
    }
  }
  // Schnittsegmente zu Schleifen fügen — mit Toleranz (Vertex-Welding), damit
  // auch STL mit nicht exakt geteilten Ecken geschlossene Konturen ergeben.
  function assembleLoops(segsL) {
    if (!segsL.length) return [];
    const b = M.bbox;
    const diag = b ? Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) : 1;
    const tol = Math.max(diag * 1e-4, 1e-4);
    const inv = 1 / tol, tol2 = tol * tol;
    const cell = new Map();       // "gx,gy,gz" -> [indices]
    const pts = [];               // verschweißte Punkte
    function weld(p) {
      const gx = Math.round(p[0] * inv), gy = Math.round(p[1] * inv), gz = Math.round(p[2] * inv);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const arr = cell.get((gx + dx) + ',' + (gy + dy) + ',' + (gz + dz));
        if (arr) for (const idx of arr) {
          const q = pts[idx];
          if ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2 <= tol2) return idx;
        }
      }
      const idx = pts.length; pts.push(p);
      const k = gx + ',' + gy + ',' + gz;
      const a = cell.get(k); if (a) a.push(idx); else cell.set(k, [idx]);
      return idx;
    }
    const adj = [];               // adj[i] = Nachbarindizes
    const seen = new Set();
    for (const s of segsL) {
      const a = weld(s[0]), c = weld(s[1]);
      if (a === c) continue;
      const ek = a < c ? a + '_' + c : c + '_' + a;
      if (seen.has(ek)) continue; seen.add(ek);
      (adj[a] || (adj[a] = [])).push(c);
      (adj[c] || (adj[c] = [])).push(a);
    }
    const used = new Array(pts.length).fill(false);
    const loops = [];
    for (let start = 0; start < pts.length; start++) {
      if (used[start] || !adj[start]) continue;
      const loop = []; let cur = start, prev = -1, guard = 0;
      while (cur >= 0 && !used[cur] && guard++ < 2e6) {
        used[cur] = true; loop.push(pts[cur]);
        const nb = adj[cur] || []; let nxt = -1;
        for (const n of nb) { if (n !== prev && !used[n]) { nxt = n; break; } }
        if (nxt < 0) { for (const n of nb) { if (n === start && n !== prev) { nxt = -2; break; } } }
        prev = cur; cur = nxt < 0 ? -1 : nxt;
      }
      if (loop.length >= 3) loops.push(loop);
    }
    return loops;
  }

  // ---- Kontur-Decimierung ---------------------------------------------
  // Hochauflösende STL liefern Querschnitte mit tausenden Punkten. Für Anzeige
  // und Profil-/Wegberechnung werden sie auf ein vernünftiges Maß reduziert
  // (Douglas-Peucker in der Schnittebene + harte Obergrenze), ohne die Form
  // sichtbar zu verändern. Die volle Geometrie bleibt fürs Netz/Kappen erhalten.
  function modelDiag() { const b = M.bbox; return b ? Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) : 1; }
  // Punktdichte (M.sectionDensity): höher = feiner. Die DP-Toleranz sinkt mit der
  // Dichte (mehr Punkte bleiben erhalten), die harte Obergrenze steigt entsprechend.
  function sectionDensity() { const d = M.sectionDensity; return (d && isFinite(d)) ? Math.max(0.2, Math.min(16, d)) : 1; }
  function sectionTol() { return Math.max(modelDiag() * 3e-4 / sectionDensity(), 1e-4); }
  function sectionMaxPts() { return Math.max(100, Math.min(6000, Math.round(500 * sectionDensity()))); }
  function perpDist2(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    if (L2 < 1e-12) { const ex = px - ax, ey = py - ay; return ex * ex + ey * ey; }
    let t = ((px - ax) * dx + (py - ay) * dy) / L2; if (t < 0) t = 0; else if (t > 1) t = 1;
    const ex = px - (ax + t * dx), ey = py - (ay + t * dy); return ex * ex + ey * ey;
  }
  // Douglas-Peucker auf dem offenen Indexbereich [i0..i1] eines geschlossenen
  // Rings der Länge n (Indexzugriff modulo n → i1 = n erlaubt den Umlauf).
  function dpOpen(P, u, w, i0, i1, keep, tol2) {
    const n = P.length, stack = [[i0, i1]];
    while (stack.length) {
      const seg = stack.pop(), a = seg[0], b = seg[1];
      if (b - a < 2) continue;
      const ax = P[a % n][u], ay = P[a % n][w], bx = P[b % n][u], by = P[b % n][w];
      let far = -1, fd = tol2;
      for (let i = a + 1; i < b; i++) { const d = perpDist2(P[i % n][u], P[i % n][w], ax, ay, bx, by); if (d > fd) { fd = d; far = i; } }
      if (far >= 0) { keep[far % n] = 1; stack.push([a, far]); stack.push([far, b]); }
    }
  }
  // Geschlossene Kontur vereinfachen; Distanzmaß in den Achsen (ui,wi). Reduziert
  // auf die formtragenden Punkte, hart gedeckelt auf SECTION_MAXPTS.
  function simplifyClosed(P, tol, ui, wi) {
    const n = P.length; if (n <= 6) return P;
    const tol2 = tol * tol;
    let far = 0, fd = -1;
    for (let i = 1; i < n; i++) { const dx = P[i][ui] - P[0][ui], dy = P[i][wi] - P[0][wi], d = dx * dx + dy * dy; if (d > fd) { fd = d; far = i; } }
    const keep = new Uint8Array(n); keep[0] = 1; keep[far] = 1;
    dpOpen(P, ui, wi, 0, far, keep, tol2);
    dpOpen(P, ui, wi, far, n, keep, tol2);
    const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(P[i]);
    if (out.length < 3) return P;
    const maxN = sectionMaxPts();
    if (out.length > maxN) { const dec = [], sf = out.length / maxN; for (let k = 0; k < maxN; k++) dec.push(out[Math.floor(k * sf)]); return dec; }
    return out;
  }

  // Zerlegung ausführen.
  // Segmente berechnen (ohne Seiteneffekte auf Sidebar/Canvas).
  function computeSegments() {
    if (!M.verts) return;
    const ax = M.axis;
    const bnd = boundaries();
    const nseg = bnd.length - 1;
    const sinks = [];
    for (let i = 0; i < nseg; i++) sinks.push([]);
    const v = M.verts, mode = contourMode();
    // Mantel je Konturmodus: außen = Außenhaut, nur innen = Innenhaut (umgedreht,
    // der Hohlraum wird zum Körper), beide = beides. Innenleben (Spanten o. Ä.) fällt weg.
    let cls = null; try { cls = classifyTris(); } catch (e) { cls = null; }
    const want = mode === 'outer' ? 1 : mode === 'inner' ? 2 : 3;
    // 1) Mantelflächen: jedes Dreieck in jede überlappende Scheibe schneiden.
    for (let i = 0; i < v.length; i += 9) {
      if (cls) { const c = cls[i / 9]; if (c !== 255 && !(c & want)) continue; }
      let tri = [[v[i], v[i + 1], v[i + 2]], [v[i + 3], v[i + 4], v[i + 5]], [v[i + 6], v[i + 7], v[i + 8]]];
      if (mode === 'inner') tri = [tri[0], tri[2], tri[1]];
      const tmin = Math.min(tri[0][ax], tri[1][ax], tri[2][ax]);
      const tmax = Math.max(tri[0][ax], tri[1][ax], tri[2][ax]);
      for (let s = 0; s < nseg; s++) {
        const lo = bnd[s], hi = bnd[s + 1];
        if (tmax <= lo || tmin >= hi) continue;
        let poly = tri;
        if (tmin < lo) poly = clipPoly(poly, ax, +1, lo);
        if (tmax > hi) poly = clipPoly(poly, ax, -1, hi);
        for (let k = 1; k + 1 < poly.length; k++) {
          const a = poly[0], b = poly[k], c = poly[k + 1];
          sinks[s].push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
        }
      }
    }
    // 2) Kappen an den inneren Schnittebenen (an beide Nachbarscheiben).
    for (let p = 1; p < bnd.length - 1; p++) {
      const lim = bnd[p];
      buildCap(ax, lim, +1, sinks[p - 1]);   // obere Kappe der unteren Scheibe
      buildCap(ax, lim, -1, sinks[p]);        // untere Kappe der oberen Scheibe
    }
    M.segs = sinks.map((arr, i) => {
      const f = new Float32Array(arr);
      return { verts: f, ntri: f.length / 9, lo: bnd[i], hi: bnd[i + 1], bbox: f.length ? computeBBox(f) : null };
    });
  }
  // Zerlegen inkl. Anzeige-Aktualisierung (aus der Bedienung heraus).
  function segment() {
    computeSegments();
    M.sel = 'all';
    if (window.__model3dRebuildSidebar) window.__model3dRebuildSidebar();
    draw();
  }
  // Stellt sicher, dass eine gültige Segmentierung vorliegt (für G-Code), ohne
  // Sidebar-Neubau — passend zur aktuellen Achse/Ebenen. Rückgabe: Erfolg.
  function ensureSegments() {
    if (!M.verts) return false;
    const need = boundaries().length - 1;
    if (!M.segs || M.segs.length !== need) computeSegments();
    return !!(M.segs && M.segs.length);
  }
  function segCount() { return M.bbox ? boundaries().length - 1 : 0; }
  // Kennwerte je Segment für die Projektübersicht: Länge (mm), Volumen (mm³, Divergenzsatz
  // über das geschlossene Segmentnetz inkl. Kappen), Oberfläche (mm², inkl. Schnittflächen).
  function segStats() {
    if (!ensureSegments()) return [];
    return M.segs.map(sg => {
      const v = sg.verts; let vol = 0, surf = 0;
      for (let i = 0; i < v.length; i += 9) {
        const ax = v[i], ay = v[i + 1], az = v[i + 2], bx = v[i + 3], by = v[i + 4], bz = v[i + 5], cx = v[i + 6], cy = v[i + 7], cz = v[i + 8];
        vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
        const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az;
        surf += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
      }
      return { len: Math.abs(sg.hi - sg.lo), vol: Math.abs(vol) / 6, surf, bbox: sg.bbox };
    });
  }

  function equalSplit(n) {
    if (!M.bbox) return;
    n = Math.max(1, Math.round(n));
    const lo = M.bbox.min[M.axis], hi = M.bbox.max[M.axis];
    M.planes = [];
    for (let i = 1; i < n; i++) M.planes.push(lo + (hi - lo) * i / n);
    invalidateSections();
    draw();   // Ebenen/Schnittspuren sofort anzeigen (nicht erst nach „Zerlegen")
  }

  // ---------- G-Code je Segment (4-Achs-Heißdraht) ----------------------
  // Prinzip wie beim Tragflächenschnitt: der gerade Draht spannt zwischen zwei
  // planaren Stirnprofilen (Regelfläche). Je Segment werden die beiden
  // Querschnitte an seinen Grenzebenen extrahiert, punktweise korrespondiert
  // und synchron abgefahren — linker Turm folgt Profil A, rechter Turm Profil B.
  function polyArea2D(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
    return a / 2;
  }
  function perimClosed(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += Math.hypot(q[0] - p[0], q[1] - p[1]); }
    return s;
  }
  function pointInPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi + 1e-12) + xi)) inside = !inside;
    }
    return inside;
  }
  // Alle Konturen an einer Ebene: größte = Außenkontur, darin liegende = Löcher.
  // Rückgabe: { outer:[[u,w]…], inners:[[[u,w]…]…] } (alle gegen den Uhrzeigersinn).
  // Memo: sectionMulti ist eine reine Funktion von Netz+Achse+Position. Damit die
  // Segmentpaar-Ansicht nicht bei jedem Neuzeichnen (Pan/Zoom) das Netz neu schneidet,
  // wird das Ergebnis je „axis|pos" gecacht. Invalidiert bei Netz-/Achs-/Ebenenänderung.
  function sectionMulti(axis, pos) {
    if (!M.multiCache) M.multiCache = new Map();
    const ck = axis + '|' + pos;
    if (M.multiCache.has(ck)) return M.multiCache.get(ck);
    const res = sectionMultiRaw(axis, pos);
    M.multiCache.set(ck, res);
    return res;
  }
  function sectionMultiRaw(axis, pos) {
    const lo = M.bbox.min[axis], hi = M.bbox.max[axis];
    const eps = Math.max(0.4, (hi - lo) * 0.01);
    let p = pos;
    if (p <= lo + 1e-6) p = lo + eps;
    if (p >= hi - 1e-6) p = hi - eps;
    const loops = collectSection(axis, p);
    if (!loops.length) return null;
    const u = (axis + 1) % 3, w = (axis + 2) % 3, tol = sectionTol();
    let polys = loops.map(lp => simplifyClosed(lp.map(q => [q[u], q[w]]), tol, 0, 1)).filter(pp => pp.length >= 3)
      .map(pp => ({ pts: pp, area: Math.abs(polyArea2D(pp)) })).filter(o => o.area > 1e-2);
    if (!polys.length) return null;
    polys.sort((a, b) => b.area - a.area);
    const outer = polys[0].pts; if (polyArea2D(outer) < 0) outer.reverse();
    const inners = [];
    for (let i = 1; i < polys.length; i++) {
      const pp = polys[i].pts;
      if (pointInPoly(pp[0], outer)) { if (polyArea2D(pp) < 0) pp.reverse(); inners.push(pp); }
    }
    return { outer, inners };
  }
  function centroid2D(pts) { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; }
  // Zwei geschlossene Schleifen korrespondieren: beide auf N abtasten + Start/Umlauf angleichen.
  function correspondLoops(a, b, N) {
    let A = resampleClosed(a, N), B = resampleClosed(b, N); B = alignLoops(A, B); return [A, B];
  }
  // Kombinierten Schnittpfad bauen: erst INNEN (über einen Eindringschlitz vom
  // Außen-Eindringpunkt), dann AUSSEN. entryIdx = Punkt auf der Außenkontur.
  // Eindringschlitz außen → Loch: IMMER exakt senkrecht oder waagerecht (je nach
  // Lage des Eindringpunkts zum Loch). Schnittpunkt einer achsparallelen Linie
  // (feste Koordinate ax = Wert c) mit dem Polygon, nächster Treffer zu Punkt e.
  function axisHit(poly, ax, c, e) {
    const n = poly.length, ay = 1 - ax; let best = null;
    for (let j = 0; j < n; j++) {
      const a = poly[j], b = poly[(j + 1) % n];
      const da = a[ax] - c, db = b[ax] - c;
      if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) continue;
      const t = da / (da - db), y = a[ay] + t * (b[ay] - a[ay]);
      const dist = Math.abs(y - e[ay]);
      if (!best || dist < best.dist) best = { j, t, dist };
    }
    return best;
  }
  // Punkt bei Kante j / Parameter t in BEIDE Konturen (A und B synchron) einfügen → Index.
  function insertOnEdge(PA, PB, j, t) {
    const n = PA.length;
    if (t <= 1e-6) return j;
    if (t >= 1 - 1e-6) return (j + 1) % n;
    const lerp = (a, b) => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    PA.splice(j + 1, 0, lerp(PA[j], PA[(j + 1) % n])); PB.splice(j + 1, 0, lerp(PB[j], PB[(j + 1) % n]));
    return j + 1;
  }
  // Schlitz für ein Loch: Richtung (senkrecht/waagerecht) aus der Lage des
  // Eindringpunkts e zum Loch. Trifft die Linie durch e das Loch, wird der
  // Treffer als Lochpunkt eingefügt. Verfehlt sie das Loch, wird stattdessen
  // die Linie durch den Extrempunkt des Lochs (Richtung Eindringpunkt) genommen
  // und der Eindringpunkt AUSSEN auf diese Flucht verschoben (Punkt in die
  // Außenkontur eingefügt). Rückgabe {inner, outer} (outer = neuer Außen-Index oder null).
  function slitEntry(innA, innB, outA, outB, entryIdx) {
    const e = outA[entryIdx], n = innA.length; if (n < 3) return { inner: 0, outer: null };
    let cx = 0, cy = 0; for (const q of innA) { cx += q[0]; cy += q[1]; } cx /= n; cy /= n;
    const vertical = Math.abs(e[1] - cy) >= Math.abs(e[0] - cx);
    const ax = vertical ? 0 : 1, ay = 1 - ax;
    let hit = axisHit(innA, ax, e[ax], e);
    if (hit) return { inner: insertOnEdge(innA, innB, hit.j, hit.t), outer: null };
    // Linie verfehlt das Loch → Extrempunkt des Lochs Richtung Eindringpunkt.
    const sgn = e[ay] >= (ay ? cy : cx) ? 1 : -1;
    let ext = 0; for (let i = 1; i < n; i++) if (sgn * innA[i][ay] > sgn * innA[ext][ay]) ext = i;
    const c = innA[ext][ax];
    const oh = axisHit(outA, ax, c, innA[ext]);
    if (!oh) return { inner: nearestIdx(innA, e), outer: null };
    // Außen: den Treffer auf der Seite des Eindringpunkts nehmen (gleiche Seite wie e).
    let best = null;
    for (let j = 0; j < outA.length; j++) {
      const a = outA[j], b = outA[(j + 1) % outA.length];
      const da = a[ax] - c, db = b[ax] - c;
      if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) continue;
      const t = da / (da - db), y = a[ay] + t * (b[ay] - a[ay]);
      if (sgn * (y - innA[ext][ay]) <= 0) continue;                  // falsche Seite
      const dist = Math.abs(y - e[ay]) + Math.abs(y - innA[ext][ay]);
      if (!best || dist < best.dist) best = { j, t, dist };
    }
    if (!best) best = oh;
    const oi = insertOnEdge(outA, outB, best.j, best.t);
    return { inner: ext, outer: oi };
  }
  function buildComb(outer, inners, entryIdx, innerEntries) {
    const oe = outer[entryIdx].slice(), comb = [];
    for (let k = 0; k < inners.length; k++) {
      const inn = inners[k], ie = innerEntries[k];
      comb.push(oe.slice());                                   // Eindringpunkt (außen)
      comb.push(inn[ie].slice());                              // Schlitz nach innen
      for (let i = 1; i <= inn.length; i++) comb.push(inn[(ie + i) % inn.length].slice());  // Loch umfahren (Startpunkt steht schon)
      comb.push(oe.slice());                                   // Schlitz zurück nach außen
    }
    for (let i = 0; i <= outer.length; i++) comb.push(outer[(entryIdx + i) % outer.length].slice());   // Außenkontur
    return comb;
  }
  // Geschlossenes Polygon nach Bogenlänge auf N Punkte neu abtasten.
  function resampleClosed(poly, N) {
    const n = poly.length;
    const seglen = [], acc = [0];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      seglen.push(d); total += d; acc.push(total);
    }
    const out = [];
    for (let k = 0; k < N; k++) {
      const s = total * k / N;
      let i = 0; while (i < n && acc[i + 1] < s) i++;
      const t = seglen[i] > 1e-9 ? (s - acc[i]) / seglen[i] : 0;
      const a = poly[i], b = poly[(i + 1) % n];
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return out;
  }
  // Startpunkt/Umlaufrichtung von B an A angleichen (Summe der Punktabstände min.).
  function alignLoops(A, B) {
    const N = A.length;
    function cost(Bx) { let c = 0; for (let i = 0; i < N; i++) c += (A[i][0] - Bx[i][0]) ** 2 + (A[i][1] - Bx[i][1]) ** 2; return c; }
    let best = B, bestC = Infinity;
    for (const rev of [false, true]) {
      const base = rev ? B.slice().reverse() : B;
      for (let r = 0; r < N; r++) {
        const rot = base.slice(r).concat(base.slice(0, r));
        const c = cost(rot);
        if (c < bestC) { bestC = c; best = rot; }
      }
    }
    return best;
  }
  // Polygon um d nach außen versetzen (Abbrand-Ausgleich), Eckennormalen.
  function offsetPoly2D(poly, d) {
    if (!d) return poly;
    const n = poly.length, out = [];
    const ccw = polyArea2D(poly) > 0;
    for (let i = 0; i < n; i++) {
      const p0 = poly[(i - 1 + n) % n], p1 = poly[i], p2 = poly[(i + 1) % n];
      const e1 = [p1[0] - p0[0], p1[1] - p0[1]], e2 = [p2[0] - p1[0], p2[1] - p1[1]];
      const nrm = e => { const L = Math.hypot(e[0], e[1]) || 1; return ccw ? [e[1] / L, -e[0] / L] : [-e[1] / L, e[0] / L]; };
      const n1 = nrm(e1), n2 = nrm(e2);
      let nx = n1[0] + n2[0], ny = n1[1] + n2[1];
      const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
      const cosH = Math.max(0.35, (nx * (n1[0] + n2[0]) + ny * (n1[1] + n2[1])) / 2 + 0.5);
      out.push([p1[0] + nx * d / cosH, p1[1] + ny * d / cosH]);
    }
    return out;
  }
  // Wie offsetPoly2D, aber mit einem Versatz je Punkt (Abbrand lokal variabel).
  function offsetPoly2DVar(poly, gaps) {
    const n = poly.length, out = [];
    const ccw = polyArea2D(poly) > 0;
    for (let i = 0; i < n; i++) {
      const p0 = poly[(i - 1 + n) % n], p1 = poly[i], p2 = poly[(i + 1) % n];
      const e1 = [p1[0] - p0[0], p1[1] - p0[1]], e2 = [p2[0] - p1[0], p2[1] - p1[1]];
      const nrm = e => { const L = Math.hypot(e[0], e[1]) || 1; return ccw ? [e[1] / L, -e[0] / L] : [-e[1] / L, e[0] / L]; };
      const n1 = nrm(e1), n2 = nrm(e2);
      let nx = n1[0] + n2[0], ny = n1[1] + n2[1];
      const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
      const cosH = Math.max(0.35, (nx * (n1[0] + n2[0]) + ny * (n1[1] + n2[1])) / 2 + 0.5);
      const d = gaps[i] || 0;
      out.push([p1[0] + nx * d / cosH, p1[1] + ny * d / cosH]);
    }
    return out;
  }
  // Abbrand bei einer Draht-Geschwindigkeit (lineare Kalibriergerade kerf↔feed).
  // cal.heatVaries (Kalibrierpunkt 3 aktiv): Heizstrom folgt dem Vorschub, der
  // Abbrand bei der Vorgabe cal.feed bleibt = kerfFast; nur lokale Abweichungen
  // folgen der Steigung.
  function kerfAtSpeed(cal, v) {
    const dv = cal.feedFast - cal.feedSlow;
    if (Math.abs(dv) < 1e-6) return Math.max(0, (cal.kerfSlow + cal.kerfFast) / 2);
    const slope = (cal.kerfFast - cal.kerfSlow) / dv;
    if (cal.heatVaries) return Math.max(0, cal.kerfFast + slope * (v - (cal.feed || v)));
    return Math.max(0, cal.kerfSlow + slope * (v - cal.feedSlow));
  }
  // Lokaler Abbrand je Punkt aus der Bahngeschwindigkeit: die längere der beiden
  // Profilseiten läuft mit vollem Vorschub, die kürzere langsamer → mehr Abbrand.
  // Rückgabe: halber Abbrand je Punkt (gA, gB) für den Außenversatz. Analog zu
  // HotWire.speedGaps, aber für geschlossene Konturen.
  function speedGapsClosed(A, B, cal) {
    const n = A.length, F = cal.feed || cal.feedFast || 1;
    const kA = new Array(n), kB = new Array(n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dA = Math.hypot(A[j][0] - A[i][0], A[j][1] - A[i][1]);
      const dB = Math.hypot(B[j][0] - B[i][0], B[j][1] - B[i][1]);
      const md = Math.max(dA, dB) || 1e-9;
      kA[i] = kerfAtSpeed(cal, F * dA / md);
      kB[i] = kerfAtSpeed(cal, F * dB / md);
    }
    const gA = new Array(n), gB = new Array(n);
    let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = (i - 1 + n) % n;
      const ka = (kA[p] + kA[i]) / 2, kb = (kB[p] + kB[i]) / 2;
      gA[i] = ka / 2; gB[i] = kb / 2;
      aMin = Math.min(aMin, ka); aMax = Math.max(aMax, ka);
      bMin = Math.min(bMin, kb); bMax = Math.max(bMax, kb);
    }
    return { gA, gB, info: { aMin, aMax, bMin, bMax } };
  }

  // Liefert die fertigen Schnittkonturen eines Segments in Maschinenkoordinaten
  // (h waagerecht, v senkrecht): Querschnitt → resample → Abbrand → Richtung →
  // Anfahrpunkt. Bei vorhandener Bearbeitung (opt.edits[seg]) werden die
  // bearbeiteten Konturen direkt verwendet (eingefroren, kein Abbrand/Start neu).
  //   Rückgabe: { A, B (Schnittspur), rawA, rawB (Sollkontur), kerfInfo, edited }
  // Abbrand auf ein korrespondiertes Schleifenpaar anwenden. sign=+1 außen
  // (nach außen versetzt), sign=−1 innen (Loch nach innen → kleiner).
  function kerfApply(A, B, o, sign) {
    if (o.kerfMode === 'speed' && o.cal) {
      const sg = speedGapsClosed(A, B, o.cal);
      const rA = offsetPoly2DVar(A, sg.gA.map(g => g * sign)), rB = offsetPoly2DVar(B, sg.gB.map(g => g * sign));
      // Voller Spalt je Punkt (für die Anzeige „Abbrand in wahrer Dicke").
      rA.kk = sg.gA.map(g => 2 * g); rB.kk = sg.gB.map(g => 2 * g);
      return { A: rA, B: rB, info: { mode: 'speed', info: sg.info } };
    } else if (o.kerfMode === 'ratio' && o.cal) {
      const pA = perimClosed(A), pB = perimClosed(B), F = o.cal.feed || o.feed || 1, md = Math.max(pA, pB) || 1;
      const kA = kerfAtSpeed(o.cal, F * pA / md), kB = kerfAtSpeed(o.cal, F * pB / md);
      const rA = offsetPoly2D(A, sign * kA / 2), rB = offsetPoly2D(B, sign * kB / 2);
      if (rA !== A) rA.k0 = kA; if (rB !== B) rB.k0 = kB;   // Spalt dieser Schleife (Anzeige)
      return { A: rA, B: rB, info: { mode: 'ratio', kA, kB } };
    } else if (o.kerf > 0) {
      const rA = offsetPoly2D(A, sign * o.kerf / 2), rB = offsetPoly2D(B, sign * o.kerf / 2);
      rA.k0 = rB.k0 = o.kerf;
      return { A: rA, B: rB, info: null };
    }
    return { A: A.map(p => p.slice()), B: B.map(p => p.slice()), info: null };
  }
  // Voller Abbrand (Schnittspalt, mm) je Stirnfläche A/B für die Anzeige „Abbrand in
  // wahrer Dicke", wo kein Wert je Punkt vorliegt (bearbeitete Bahn, Platte):
  // Verhältnis/konstant exakt, Bahngeschwindigkeit als Mittel der lokalen Werte.
  function kerfPairOf(info, o) {
    if (info && info.mode === 'speed' && info.info) return { A: (info.info.aMin + info.info.aMax) / 2, B: (info.info.bMin + info.info.bMax) / 2 };
    if (info && info.mode === 'ratio') return { A: info.kA, B: info.kB };
    const k = (o && o.kerf > 0) ? o.kerf : ((info && info.mode === 'edit' && o && o.cal) ? kerfAtSpeed(o.cal, o.cal.feed || o.feed || 0) : 0);
    return { A: k, B: k };
  }
  // Schnitt des Strahls (Schwerpunkt, Winkel deg) mit der Kontur: äußerster
  // Treffer, dann nächstliegender Konturpunkt. Ohne Treffer: kleinste Winkelabweichung.
  function rayEntryIdx(P, deg) {
    const n = P.length; if (!n) return 0;
    const c = centroid2D(P), a = (isFinite(deg) ? deg : 90) * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
    let bt = -Infinity, hit = null;
    for (let i = 0; i < n; i++) {
      const p = P[i], q = P[(i + 1) % n], ex = q[0] - p[0], ey = q[1] - p[1];
      const den = dx * ey - dy * ex; if (Math.abs(den) < 1e-12) continue;
      const wx = p[0] - c[0], wy = p[1] - c[1];
      const t = (wx * ey - wy * ex) / den, u = (wx * dy - wy * dx) / den;
      if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9 && t > bt) { bt = t; hit = [p[0] + ex * u, p[1] + ey * u]; }
    }
    if (hit) return nearestIdx(P, hit);
    let bi = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const vx = P[i][0] - c[0], vy = P[i][1] - c[1]; const d = Math.abs(Math.atan2(vx * dy - vy * dx, vx * dx + vy * dy)); if (d < bd) { bd = d; bi = i; } }
    return bi;
  }
  // Winkel (Grad) eines Konturpunkts vom Schwerpunkt aus gesehen (für Klick-Auswahl).
  function angleOfPoint(P, pt) { const c = centroid2D(P); return Math.atan2(pt[1] - c[1], pt[0] - c[0]) * 180 / Math.PI; }
  function nearestIdx(pts, ref) { let bi = 0, bd = Infinity; for (let i = 0; i < pts.length; i++) { const d = (pts[i][0] - ref[0]) ** 2 + (pts[i][1] - ref[1]) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; }
  function cutPaths(segIndex, opt) {
    if (!M.segs || !M.segs[segIndex]) return null;
    const o = Object.assign({ N: 160, kerf: 0, kerfMode: 'ratio', cal: null, feed: 220,
      swap: false, flip: false, start: 'auto', startPt: null, startAng: 90, reverse: false, edits: null }, opt || {});
    const ax = M.axis, s = M.segs[segIndex];
    const mA = sectionMulti(ax, s.lo), mB = sectionMulti(ax, s.hi);
    if (!mA || !mB) return null;
    const map = p => { let h = p[0], v = p[1]; if (o.swap) { const t = h; h = v; v = t; } if (o.flip) h = -h; return [h, v]; };
    const N = Math.max(8, Math.min(2000, Math.max(o.N | 0, mA.outer.length, mB.outer.length)));
    let [oA, oB] = correspondLoops(mA.outer, mB.outer, N); oA = oA.map(map); oB = oB.map(map);
    // Innenkonturen (Löcher) paaren + korrespondieren. Fehlt auf EINER Stirnfläche
    // ein Loch (die Kavität endet vor der Fläche), wird ein entarteter kleiner Kreis
    // am Schwerpunkt genutzt → das Loch läuft konisch aus, statt zu verschwinden.
    let innersA = [], innersB = [];
    const cA = mA.inners.map(centroid2D), cB = mB.inners.map(centroid2D), usedB = new Set();
    const degen = c => { const r = 0.3, o6 = []; for (let k = 0; k < 6; k++) { const a = k / 6 * 2 * Math.PI; o6.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } return o6; };
    const pushPair = (la, lb) => { const Ni = Math.max(8, Math.min(1000, Math.max(o.N | 0, la.length, lb.length))); const [iA, iB] = correspondLoops(la, lb, Ni); innersA.push(iA.map(map)); innersB.push(iB.map(map)); };
    // von der größeren Seite aus paaren (nächster Schwerpunkt)
    const order = mA.inners.map((inn, i) => i).sort((x, y) => Math.abs(polyArea2D(mA.inners[y])) - Math.abs(polyArea2D(mA.inners[x])));
    for (const i of order) {
      let best = -1, bd = Infinity;
      for (let j = 0; j < mB.inners.length; j++) { if (usedB.has(j)) continue; const d = (cA[i][0] - cB[j][0]) ** 2 + (cA[i][1] - cB[j][1]) ** 2; if (d < bd) { bd = d; best = j; } }
      if (best >= 0) { usedB.add(best); pushPair(mA.inners[i], mB.inners[best]); }
      else pushPair(mA.inners[i], degen(cA[i]));      // A-Loch ohne B-Partner → B entartet
    }
    for (let j = 0; j < mB.inners.length; j++) if (!usedB.has(j)) pushPair(degen(cB[j]), mB.inners[j]);  // B-Loch ohne A-Partner
    const hollow = innersA.length > 0;

    const ed = o.edits && o.edits[segIndex];
    if (ed && ed.A && ed.B && ed.A.length === ed.B.length) {
      return { A: ed.A.map(p => p.slice()), B: ed.B.map(p => p.slice()),
        rawOuterA: oA, rawOuterB: oB, rawInnersA: innersA, rawInnersB: innersB,
        cutOuterA: oA, cutOuterB: oB, cutInnersA: innersA, cutInnersB: innersB,
        hollow, entryIdx: 0, entry: oA[0], kerfInfo: { mode: 'edit' }, edited: true, seg: segIndex, lo: s.lo, hi: s.hi };
    }

    // Abbrand: Außen nach außen, Innen nach innen.
    const ko = kerfApply(oA, oB, o, +1);
    let cutOuterA = ko.A, cutOuterB = ko.B, kerfInfo = ko.info;
    const cutInnersA = [], cutInnersB = [];
    for (let k = 0; k < innersA.length; k++) { const ki = kerfApply(innersA[k], innersB[k], o, -1); cutInnersA.push(ki.A); cutInnersB.push(ki.B); }
    // Richtung umkehren.
    if (o.reverse) { cutOuterA.reverse(); cutOuterB.reverse(); oA.reverse(); oB.reverse();
      for (let k = 0; k < innersA.length; k++) { cutInnersA[k].reverse(); cutInnersB[k].reverse(); innersA[k].reverse(); innersB[k].reverse(); }
      [cutOuterA, cutOuterB].concat(cutInnersA, cutInnersB).forEach(l => { if (l.kk) l.kk.reverse(); }); }
    // Eindringpunkt (auf der Außenkontur): per Klick (custom) oder Lage.
    // „angle": Strahl vom Profilschwerpunkt unter festem Winkel (0° = hinten/+h,
    // 90° = oben) → bei JEDEM Segment dieselbe relative Stelle am Umfang, sodass der
    // Eindringschlitz beim Zusammensetzen der Teile als Ausrichtmarke dient.
    let entryIdx = 0;
    if (o.start === 'angle') entryIdx = rayEntryIdx(cutOuterA, o.startAng);
    else if (o.start === 'custom' && o.startPt) entryIdx = nearestIdx(cutOuterA, o.startPt);
    else { const pick = { rear: p => p[0], front: p => -p[0], top: p => p[1], bottom: p => -p[1] }[o.start];
      if (pick) { let bv = -Infinity; for (let i = 0; i < cutOuterA.length; i++) { const val = pick(cutOuterA[i]); if (val > bv) { bv = val; entryIdx = i; } } } }
    // Kombinierter Schnittpfad: INNEN zuerst (über Eindringschlitz), dann AUSSEN.
    let A, B, innerEntries = [];
    if (hollow) {
      for (let k = 0; k < cutInnersA.length; k++) {
        const r = slitEntry(cutInnersA[k], cutInnersB[k], cutOuterA, cutOuterB, entryIdx);
        innerEntries.push(r.inner);
        if (r.outer != null) entryIdx = r.outer;   // Eindringpunkt außen auf die Flucht gelegt
      }
      A = buildComb(cutOuterA, cutInnersA, entryIdx, innerEntries);
      B = buildComb(cutOuterB, cutInnersB, entryIdx, innerEntries);
    } else {
      const rot = a => entryIdx > 0 ? a.slice(entryIdx).concat(a.slice(0, entryIdx)) : a;
      A = rot(cutOuterA); B = rot(cutOuterB);
    }
    return { A, B, rawOuterA: oA, rawOuterB: oB, rawInnersA: innersA, rawInnersB: innersB,
      cutOuterA, cutOuterB, cutInnersA, cutInnersB,
      hollow, entryIdx, innerEntries, entry: cutOuterA[entryIdx], kerfInfo, edited: false, seg: segIndex, lo: s.lo, hi: s.hi };
  }

  // Bahnen (Türme, Profile) eines Segments samt Bewegungsliste. opt: Achsbuchstaben, Vorschub, Abbrand,
  // Sicherheitshöhe, Nachkommastellen, Punktzahl, Achsentausch/-spiegel.
  // Vorschub je Bahnsegment wie in den anderen Generatoren: F gilt für das
  // schnellere Portal; es wird so gewählt, dass das WERKSTÜCK (schnellere
  // Plattenfläche A/B) mit `feed` läuft — gedeckelt auf maxFeed. Rückgabe:
  // F + Kommentar mit Portal- und Werkstückgeschwindigkeit (mm/min).
  function feedNote(o, l0, l1, r0, r1, a0, a1, b0, b1) {
    const dL = Math.hypot(l1[0] - l0[0], l1[1] - l0[1]), dR = Math.hypot(r1[0] - r0[0], r1[1] - r0[1]);
    const dA = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]), dB = Math.hypot(b1[0] - b0[0], b1[1] - b0[1]);
    const dMax = Math.max(dL, dR), dW = Math.max(dA, dB);
    const cap = v => (o.maxFeed > 0 ? Math.min(v, o.maxFeed) : v);
    const F = (dW > 0.02 && dMax > 1e-6) ? cap(o.feed * dMax / dW) : cap(o.feed);
    const vL = dMax > 1e-6 ? dL * F / dMax : F, vR = dMax > 1e-6 ? dR * F / dMax : F;
    const vW = dMax > 1e-6 ? dW * F / dMax : F;
    return { F, vL, vR, vW };   // Text (Portal …) macht model3d_gcode.js daraus
  }
  function buildSegmentPaths(segIndex, opt) {
    if (!M.segs || !M.segs[segIndex]) return null;
    const o = Object.assign({
      axX: 'X', axY: 'Y', axU: 'Z', axV: 'A', feed: 220, rapid: 800, kerf: 0,
      heat: 0, safe: 20, prec: 3, N: 160, swap: false, flip: false, closeLoop: true,
      start: 'auto', leadIn: 0, blockX: 0, blockY: 0, blockZ: null,
      kerfMode: 'ratio', cal: null
    }, opt || {});
    const ax = M.axis;
    const s = M.segs[segIndex];
    const cp = cutPaths(segIndex, o);
    if (!cp) return null;
    let A = cp.A, B = cp.B;
    const kerfInfo = cp.kerfInfo;

    // --- Spannweite = Ebenenabstand des Segments -----------------------
    // Die Segmentdicke (Abstand seiner beiden Schnittebenen) wird aus den
    // Grenzen übernommen. Der Schaumblock dieser Dicke liegt mittig zwischen
    // den Türmen (z = 0 … Maschinenbreite); die Turmbahnen werden so
    // EXTRAPOLIERT, dass der gerade Draht an den Blockflächen exakt Profil A
    // (nahe Turm links) bzw. Profil B (nahe Turm rechts) erzeugt. Genau wie
    // beim Tragflächenschnitt (Wurzel/Außen-Extrapolation auf die Turmebenen).
    const span = Math.max(1, Math.abs(s.hi - s.lo));
    const mw = Math.max(span, o.machineWidth || 900);
    // Spannweiten-Lage im Portal: „Blocklage am Nullpunkt" → blockZ (Abstand der
    // nahen Blockfläche vom linken Turm). Ohne Angabe mittig zwischen den Türmen.
    const bz = (o.blockZ == null) ? (mw - span) / 2
      : Math.max(0, Math.min(o.blockZ, Math.max(0, mw - span)));
    const zA = bz, zB = bz + span;                   // Blockflächen (A bei zA, B bei zB)
    const tA = zA / mw, den = span / mw;             // tB − tA = span/mw
    const towerL = [], towerR = [];
    for (let i = 0; i < A.length; i++) {
      const dh = B[i][0] - A[i][0], dv = B[i][1] - A[i][1];
      const Lh = A[i][0] - dh * tA / den, Lv = A[i][1] - dv * tA / den;
      towerL.push([Lh, Lv]);
      towerR.push([Lh + dh / den, Lv + dv / den]);
    }
    // Anfahren: waagerechter Ein-/Ausfahrweg. Der Draht fährt in einem Abstand
    // `leadIn` (mm) neben dem Block senkrecht herunter und dann WAAGERECHT in den
    // Anfahrpunkt ein — Richtung nach außen (vom Profilschwerpunkt weg).
    const lead = Math.max(0, o.leadIn || 0);
    let mh = 0; for (const p of A) mh += p[0]; mh /= A.length || 1;
    const dir = (A[0][0] - mh) >= 0 ? 1 : -1;
    const loff = dir * lead;                          // waagerechter Versatz (in h)

    // Blocklage am Nullpunkt (wie in den anderen Reitern): der Block (umschließt
    // beide Stirnprofile) sitzt mit seiner unteren/rückwärtigen Kante bei
    // (blockX, blockY) über dem Maschinennullpunkt. Alle Koordinaten entsprechend
    // verschieben. Die Türme dürfen (Extrapolation) darüber hinausragen.
    const blockX = o.blockX || 0, blockY = o.blockY || 0;
    let bMinH = Infinity, bMinV = Infinity;
    for (const p of A.concat(B)) { if (p[0] < bMinH) bMinH = p[0]; if (p[1] < bMinV) bMinV = p[1]; }
    const offH = blockX - bMinH, offV = blockY - bMinV;
    const sh = (arr) => arr.map(p => [p[0] + offH, p[1] + offV]);
    const L = sh(towerL), R = sh(towerR); A = sh(A); B = sh(B);
    M.rule = { seg: segIndex };

    const P = o.prec;
    const f = x => (+x).toFixed(P);
    // Bewegungen als DATEN (Achswerte bereits formatiert, k = Art der Fahrt). Den
    // G-Code-Text daraus macht erst model3d_gcode.js (Funktion „G-Code-Erzeugung",
    // abwählbar) — hier entstehen nur Bahnen für Anzeige, Platte und Simulation.
    const moves = [];
    const mv = mm => moves.push(mm);
    const rapid = o.rapid.toFixed(0), feedS = o.feed.toFixed(0);
    const meta = { seg: segIndex, nseg: M.segs.length, name: M.name, axis: AXIS[ax], N: A.length,
      kerfInfo, kerf: o.kerf, span, mw, heat: o.heat };
    // Am Nullpunkt (0,0) beginnen. Anfahren: IMMER zuerst SENKRECHT von Null hoch
    // auf Eintrittshöhe, dann WAAGERECHT in den Eindringpunkt. Der Anfahrabstand
    // (0 = aus) teilt nur den letzten waagerechten Anteil in Eilgang + Schnitt.
    const pathL = [], pathR = [];
    const step = (l, r) => { pathL.push(l.slice()); pathR.push(r.slice()); };
    mv({ x: '0', y: '0', u: '0', v: '0', F: rapid, k: 'start' });
    step([0, 0], [0, 0]);
    const L0 = L[0], R0 = R[0];
    mv({ y: f(L0[1]), v: f(R0[1]), F: rapid, k: 'up' });
    step([0, L0[1]], [0, R0[1]]);
    if (lead > 0) {
      mv({ x: f(L0[0] - loff), u: f(R0[0] - loff), F: rapid, k: 'lead', lead });
      step([L0[0] - loff, L0[1]], [R0[0] - loff, R0[1]]);
    }
    mv({ x: f(L0[0]), u: f(R0[0]), F: feedS, k: 'enter' });
    step([L0[0], L0[1]], [R0[0], R0[1]]);
    for (let i = 1; i < L.length; i++) {
      const fn = feedNote(o, L[i - 1], L[i], R[i - 1], R[i], A[i - 1], A[i], B[i - 1], B[i]);
      mv({ x: f(L[i][0]), y: f(L[i][1]), u: f(R[i][0]), v: f(R[i][1]), F: fn.F.toFixed(0), k: 'cut', spd: fn });
      step(L[i], R[i]);
    }
    if (o.closeLoop) {
      const n1 = L.length - 1, fn = feedNote(o, L[n1], L0, R[n1], R0, A[n1], A[0], B[n1], B[0]);
      mv({ x: f(L0[0]), y: f(L0[1]), u: f(R0[0]), v: f(R0[1]), F: fn.F.toFixed(0), k: 'close', spd: fn }); step(L0, R0); }
    mv({ x: '0', u: '0', F: rapid, k: 'backX' }); step([0, L0[1]], [0, R0[1]]);   // davor: Draht aus (M5)
    mv({ y: '0', v: '0', F: rapid, k: 'backY' }); step([0, 0], [0, 0]);
    // Sollkontur (ohne Abbrand) im selben Rahmen — für die Anzeige „Querschnitt vs. Schnittspur".
    const rawA = sh(cp.rawOuterA || []), rawB = sh(cp.rawOuterB || []);
    const rawInA = (cp.rawInnersA || []).map(sh), rawInB = (cp.rawInnersB || []).map(sh);
    return { moves, meta, opt: o, N: A.length, points: A.length, profA: A, profB: B,
      rawA, rawB, rawInA, rawInB,
      towerL: L, towerR: R, pathL, pathR, offH, offV, span, zA, zB, mw, seg: segIndex };
  }

  // Segment-Dicke (= Ebenenabstand) eines Segments.
  function segSpan(seg) { const s = M.segs && M.segs[seg]; return s ? Math.max(1, Math.abs(s.hi - s.lo)) : 0; }

  // Platte: mehrere gleich dicke Segmente (gleicher Ebenenabstand) in EINEM
  // Programm aus einer Platte schneiden. Die Türme spannen den echten
  // MASCHINEN-Turmabstand (o.machineWidth) — die Turmbahnen werden extrapoliert,
  // sodass der Draht an den Plattenflächen exakt Profil A/B erzeugt. Das Layout
  // (Footprint, Verbindungen, Kollision) nutzt die PROFILE (Plattenmaße), nicht
  // die extrapolierten Türme. Verbindungen laufen kollisionsfrei durch Freiraum.
  // placements: [{seg, dh, dv}]; opt wie mgOpt (+ plateConnEdits).
  function buildPlatePaths(placements, opt) {
    if (!placements || !placements.length) return null;
    const o = Object.assign({ axX: 'X', axY: 'Y', axU: 'Z', axV: 'A', feed: 220, rapid: 800, prec: 3, machineWidth: 900 }, opt || {});
    const span0 = segSpan(placements[0].seg);
    const mw = Math.max(span0, o.machineWidth || 900);   // echter Maschinen-Turmabstand
    // Signatur der geometrie-relevanten Optionen (inkl. Maschinenbreite/Blocklage,
    // da diese die Turm-Extrapolation bestimmen).
    const segSig = JSON.stringify([o.N, o.swap, o.flip, o.start, o.startPt, o.startAng, o.reverse,
      o.kerfMode, o.kerf, o.cal, o.edits, o.machineWidth, o.blockZ]);
    // pro Stück: Profile (Plattenfläche A/B) + extrapolierte Türme. Kontur am
    // Ursprung je Segment gecacht (teure Modell-Schnitte nur einmal).
    const pieces = [];
    for (const pl of placements) {
      const ck = pl.seg + '|' + segSig;
      let base = plateSegCache[ck];
      if (base === undefined) {
        const r = buildSegmentPaths(pl.seg, Object.assign({}, o, { blockX: 0, blockY: 0, machineWidth: o.machineWidth || 900, leadIn: 0 }));
        base = plateSegCache[ck] = r ? { towerL: r.towerL, towerR: r.towerR, profA: r.profA, profB: r.profB,
          rawA: r.rawA, rawB: r.rawB, rawInA: r.rawInA, rawInB: r.rawInB, zA: r.zA, zB: r.zB, mw: r.mw,
          kp: kerfPairOf(r.meta && r.meta.kerfInfo, r.opt) } : null;
      }
      if (!base) continue;
      const r = base;
      const sh = p => [p[0] + pl.dh, p[1] + pl.dv];
      const L = r.towerL.map(sh), R = r.towerR.map(sh);
      const PA = r.profA.map(sh), PB = r.profB.map(sh);   // Plattenflächen (Footprint) = Schnittspur (abbrandkompensiert)
      const RA = (r.rawA || []).map(sh), RB = (r.rawB || []).map(sh);   // Sollkontur (Querschnitt ohne Abbrand)
      const RIA = (r.rawInA || []).map(l => l.map(sh)), RIB = (r.rawInB || []).map(l => l.map(sh));
      let bb = [Infinity, Infinity, -Infinity, -Infinity];
      for (const p of PA.concat(PB)) { bb[0] = Math.min(bb[0], p[0]); bb[1] = Math.min(bb[1], p[1]); bb[2] = Math.max(bb[2], p[0]); bb[3] = Math.max(bb[3], p[1]); }
      pieces.push({ L, R, PA, PB, RA, RB, RIA, RIB, entry: [L[0].slice(), R[0].slice()], entryP: PA[0].slice(), bb, seg: pl.seg, dh: pl.dh, dv: pl.dv, zA: r.zA, zB: r.zB, kp: r.kp });
    }
    if (!pieces.length) return null;
    // von oben nach unten: Reihe = gleiche Oberkante (±2 mm), darin links → rechts.
    pieces.sort((a, b) => (Math.abs(a.bb[3] - b.bb[3]) > 2 ? (b.bb[3] - a.bb[3]) : (a.dh - b.dh)) || (b.entryP[1] - a.entryP[1]));
    const P = o.prec, f = x => (+x).toFixed(P);
    const moves = [], pathL = [], pathR = [], conns = [];   // Bewegungen als Daten (Text: model3d_gcode.js)
    const mv = mm => moves.push(mm);
    const rapid = o.rapid.toFixed(0), feedS = o.feed.toFixed(0);
    const step = (l, r) => { pathL.push(l.slice()); pathR.push(r.slice()); };

    // ---- Kollisionsfreier Verbindungs-Router --------------------------
    // Die Verbindungswege dürfen NIE durch ein (geschnittenes) Segment und
    // NIE durch sich selbst laufen. Dazu wird der Draht ausschließlich durch
    // den freien Raum ZWISCHEN/UM die Stück-Bounding-Boxen geführt (A* auf
    // einem groben Freiraum-Gitter, danach per Sichtlinie geglättet).
    const gap = Math.max(o.plateGap || 12, 8);
    const mInfl = Math.min(gap * 0.25, 2.5);           // Sicherheitsrand um Stücke
    const rects = pieces.map(pc => [pc.bb[0] - mInfl, pc.bb[1] - mInfl, pc.bb[2] + mInfl, pc.bb[3] + mInfl]);
    let ax0 = 0, ay0 = 0, ax1 = 0, ay1 = 0;            // Nullpunkt (0,0) stets einschließen
    for (const b of pieces) { ax0 = Math.min(ax0, b.bb[0]); ay0 = Math.min(ay0, b.bb[1]); ax1 = Math.max(ax1, b.bb[2]); ay1 = Math.max(ay1, b.bb[3]); }
    const pad = gap + 6;
    const area = [ax0 - pad, ay0 - pad, ax1 + pad, ay1 + pad];
    // Gitterschrittweite: fein wie bisher, aber die Gesamt-Zellzahl gedeckelt,
    // damit sehr große Platten den A* nicht sprengen (früher unbegrenzt → O(Zellen²)).
    let stp = Math.max(1.5, Math.min(gap * 0.4, 4));
    const AW = area[2] - area[0], AH = area[3] - area[1], MAXCELLS = 160000;
    if ((AW / stp + 1) * (AH / stp + 1) > MAXCELLS) stp = Math.sqrt(AW * AH / MAXCELLS);
    const inR = (x, y) => { for (const r of rects) if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]) return true; return false; };
    const segHit = (a, b) => { const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (stp * 0.5))); for (let i = 0; i <= n; i++) { const t = i / n; if (inR(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return true; } return false; };
    // ---- Belegungs-Grid: EINMAL rastern, dann O(1)-Lookup statt Rechteck-Scan --
    const nx = Math.max(1, Math.round(AW / stp)), ny = Math.max(1, Math.round(AH / stp)), NX1 = nx + 1;
    const N = NX1 * (ny + 1);
    const occ = new Uint8Array(N);
    const wpt = (cx, cy) => [area[0] + cx * stp, area[1] + cy * stp];
    const idx = (a, b) => b * NX1 + a;
    for (const r of rects) {
      let cx0 = Math.ceil((r[0] - area[0]) / stp), cx1 = Math.floor((r[2] - area[0]) / stp);
      let cy0 = Math.ceil((r[1] - area[1]) / stp), cy1 = Math.floor((r[3] - area[1]) / stp);
      if (cx0 < 0) cx0 = 0; if (cy0 < 0) cy0 = 0; if (cx1 > nx) cx1 = nx; if (cy1 > ny) cy1 = ny;
      for (let cy = cy0; cy <= cy1; cy++) { const row = cy * NX1; for (let cx = cx0; cx <= cx1; cx++) occ[row + cx] = 1; }
    }
    const freeCell = (a, b) => a >= 0 && b >= 0 && a <= nx && b <= ny && !occ[idx(a, b)];
    const toCell = p => [Math.min(nx, Math.max(0, Math.round((p[0] - area[0]) / stp))), Math.min(ny, Math.max(0, Math.round((p[1] - area[1]) / stp)))];
    const nearestFree = c => { if (freeCell(c[0], c[1])) return c; for (let r = 1; r < 200; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; if (freeCell(c[0] + dx, c[1] + dy)) return [c[0] + dx, c[1] + dy]; } return c; };
    // Wiederverwendete A*-Puffer (einmal alloziert, je route() zurückgesetzt).
    const gArr = new Float32Array(N), came = new Int32Array(N);
    // Binär-Min-Heap (Schlüssel f) statt linearer Min-Suche über die Open-Liste.
    const hf = [], ha = [], hb = [], hd = [];
    const hswap = (i, j) => { let t = hf[i]; hf[i] = hf[j]; hf[j] = t; t = ha[i]; ha[i] = ha[j]; ha[j] = t;
      t = hb[i]; hb[i] = hb[j]; hb[j] = t; t = hd[i]; hd[i] = hd[j]; hd[j] = t; };
    const hpush = (f, a, b, d) => { let i = hf.length; hf.push(f); ha.push(a); hb.push(b); hd.push(d);
      while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= hf[i]) break; hswap(p, i); i = p; } };
    const hpop = () => { const n = hf.length - 1, out = { f: hf[0], a: ha[0], b: hb[0], d: hd[0] };
      hf[0] = hf[n]; ha[0] = ha[n]; hb[0] = hb[n]; hd[0] = hd[n]; hf.pop(); ha.pop(); hb.pop(); hd.pop();
      let i = 0; const m = hf.length; for (;;) { let l = 2 * i + 1, r = l + 1, s = i;
        if (l < m && hf[l] < hf[s]) s = l; if (r < m && hf[r] < hf[s]) s = r; if (s === i) break; hswap(s, i); i = s; } return out; };
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const dcost = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
    // Anfahrpunkt: vom Eintritt aus nach AUSSEN (weg vom Schwerpunkt) bis der
    // Punkt frei ist — so beginnt/endet die Verbindung immer im Freiraum.
    const approach = (e, bb) => {
      let dx = e[0] - (bb[0] + bb[2]) / 2, dy = e[1] - (bb[1] + bb[3]) / 2; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      let p = [e[0], e[1]];
      for (let k = 1; k < 400; k++) { p = [e[0] + dx * stp * k, e[1] + dy * stp * k]; if (!inR(p[0], p[1])) return p; }
      return p;
    };
    const route = (from, to) => {
      const sc = nearestFree(toCell(from)), gc = nearestFree(toCell(to));
      const gA = gc[0], gB = gc[1], h = (a, b) => Math.hypot(a - gA, b - gB);
      gArr.fill(Infinity); came.fill(-1); hf.length = ha.length = hb.length = hd.length = 0;
      const si = idx(sc[0], sc[1]); gArr[si] = 0; hpush(h(sc[0], sc[1]), sc[0], sc[1], -1);
      let found = false, guard = 0;
      while (hf.length && guard++ < 400000) {
        const cur = hpop(), ca = cur.a, cb = cur.b, ci = idx(ca, cb);
        if (ca === gA && cb === gB) { found = true; break; }
        if (cur.f - h(ca, cb) > gArr[ci] + 1e-6) continue;   // veralteter Heap-Eintrag
        for (let d = 0; d < 8; d++) { const na = ca + dirs[d][0], nb = cb + dirs[d][1];
          if (na < 0 || nb < 0 || na > nx || nb > ny) continue; const ni = idx(na, nb); if (occ[ni]) continue;
          if (d >= 4 && (occ[idx(ca, nb)] || occ[idx(na, cb)])) continue;   // Diagonale: keine Ecke schneiden
          const ng = gArr[ci] + dcost[d] + (cur.d >= 0 && cur.d !== d ? 0.15 : 0);
          if (ng < gArr[ni]) { gArr[ni] = ng; came[ni] = ci; hpush(ng + h(na, nb), na, nb, d); }
        }
      }
      if (!found) return [from.slice(), to.slice()];
      const cells = []; let ci = idx(gA, gB);
      while (ci >= 0) { const b = (ci / NX1) | 0; cells.push([ci - b * NX1, b]); ci = came[ci]; }
      cells.reverse();
      let pts = cells.map(c => wpt(c[0], c[1])); pts.unshift(from.slice()); pts.push(to.slice());
      // Sichtlinien-Glättung: möglichst gerade, aber nie durch ein Stück.
      const outp = [pts[0]]; let i = 0;
      while (i < pts.length - 1) { let j = pts.length - 1; for (; j > i + 1; j--) if (!segHit(pts[i], pts[j])) break; outp.push(pts[j]); i = j; }
      return outp;
    };
    const emitTravel = (poly, label) => {
      for (let i = 1; i < poly.length; i++) { const q = poly[i];
        mv(Object.assign({ x: f(q[0]), y: f(q[1]), u: f(q[0]), v: f(q[1]), F: rapid, k: 'travel' }, (i === 1 && label) ? label : {}));
        step([q[0], q[1]], [q[0], q[1]]);
      }
    };

    mv({ x: '0', y: '0', u: '0', v: '0', F: rapid, k: 'start' }); step([0, 0], [0, 0]);
    // Verbindungs-Stützpunkte (Interior) je Verbindung: automatisch (Router) oder
    // manuell überschrieben (o.plateConnEdits[idx] = [[x,y],…]).
    const cEdits = o.plateConnEdits || {};
    const interiorFor = (idx, from, to) => {
      const e = cEdits[idx];
      if (e && e.length !== undefined) return { pts: e.map(p => [p[0], p[1]]), edited: true };
      const rp = route(from, to);                 // [from,…,to]
      return { pts: rp.slice(1, rp.length - 1), edited: false };
    };
    let cur = [0, 0];
    for (let pi = 0; pi < pieces.length; pi++) {
      const pc = pieces[pi], eL = pc.entry[0], eR = pc.entry[1];
      // Anfahren im Plattenraum (Footprint) — der Draht bleibt bis zum Einfahren
      // senkrecht (beide Türme auf demselben (h,v)); erst „einfahren" kippt ihn auf
      // die extrapolierten Turmpositionen (Profil A/B an den Plattenflächen).
      const appr = approach(pc.entryP, pc.bb);
      const iv = interiorFor(pi, cur, appr);
      const full = [cur.slice()].concat(iv.pts, [appr.slice()]);
      emitTravel(full, { k: 'conn', seg: pc.seg + 1, edited: iv.edited });
      conns.push({ idx: pi, cur: cur.slice(), appr: appr.slice(), entry: pc.entryP.slice(), interior: iv.pts.map(p => p.slice()), path: full.concat([pc.entryP.slice()]), edited: iv.edited });
      // einfahren (Anfahrpunkt → extrapolierte Türme; Draht kippt auf Profil A/B)
      mv({ x: f(eL[0]), y: f(eL[1]), u: f(eR[0]), v: f(eR[1]), F: feedS, k: 'enter', seg: pc.seg + 1 }); step([eL[0], eL[1]], [eR[0], eR[1]]);
      for (let i = 1; i < pc.L.length; i++) {
        const fn = feedNote(o, pc.L[i - 1], pc.L[i], pc.R[i - 1], pc.R[i], pc.PA[i - 1], pc.PA[i], pc.PB[i - 1], pc.PB[i]);
        mv({ x: f(pc.L[i][0]), y: f(pc.L[i][1]), u: f(pc.R[i][0]), v: f(pc.R[i][1]), F: fn.F.toFixed(0), k: 'cut', spd: fn }); step(pc.L[i], pc.R[i]); }
      { const n1 = pc.L.length - 1, fn = feedNote(o, pc.L[n1], eL, pc.R[n1], eR, pc.PA[n1], pc.PA[0], pc.PB[n1], pc.PB[0]);
        mv({ x: f(eL[0]), y: f(eL[1]), u: f(eR[0]), v: f(eR[1]), F: fn.F.toFixed(0), k: 'close', spd: fn }); step(eL, eR); }
      // heraus in den Freiraum (Anfahrpunkt), damit die nächste Verbindung frei startet
      mv({ x: f(appr[0]), y: f(appr[1]), u: f(appr[0]), v: f(appr[1]), F: rapid, k: 'out' }); step([appr[0], appr[1]], [appr[0], appr[1]]);
      cur = [appr[0], appr[1]];
    }
    // Rückweg zum Nullpunkt (ebenfalls als Verbindung editierbar, idx = Anzahl Stücke).
    const ivEnd = interiorFor(pieces.length, cur, [0, 0]);
    const fullEnd = [cur.slice()].concat(ivEnd.pts, [[0, 0]]);
    emitTravel(fullEnd, { k: 'connEnd', edited: ivEnd.edited });
    conns.push({ idx: pieces.length, cur: cur.slice(), appr: [0, 0], entry: null, interior: ivEnd.pts.map(p => p.slice()), path: fullEnd.slice(), edited: ivEnd.edited });
    mv({ x: '0', y: '0', u: '0', v: '0', F: rapid, k: 'end' }); step([0, 0], [0, 0]);
    // Bounding-Box aller Stücke (Platte).
    let bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const pc of pieces) { bb[0] = Math.min(bb[0], pc.bb[0]); bb[1] = Math.min(bb[1], pc.bb[1]); bb[2] = Math.max(bb[2], pc.bb[2]); bb[3] = Math.max(bb[3], pc.bb[3]); }
    return { moves, meta: { n: pieces.length, span: span0, bb }, opt: o, pathL, pathR, pieces, conns, span: span0, mw, plateBox: bb };
  }
  // Layout: gleich dicke Segmente platzsparend in Reihen legen. Zwei Arten:
  //  * 'grid'    — festes Raster: je Reihe `cols` Stücke (bisheriges Verhalten).
  //  * 'pyramid' — unten MEHR Stücke als oben und die GRÖSSEREN unten: die
  //                unterste Reihe bekommt `cols` Stücke, jede Reihe darüber eine
  //                weniger (mindestens 1). Die Stücke werden nach Breite absteigend
  //                sortiert und von unten nach oben verteilt, die Reihen mittig
  //                ausgerichtet — das gibt einen standsicheren, schmal auslaufenden
  //                Stapel und kurze Wege.
  // In beiden Fällen sind die Stücke einer Reihe oben bündig (gleiche Eintrittshöhe)
  // und die zurückgegebene Reihenfolge läuft von der obersten Reihe nach unten, damit
  // reihenweise von oben nach unten geschnitten wird.
  // `arrange`: {mode:'grid'|'pyramid', order:[segId,…]} — `order` ist die vom Nutzer
  // festgelegte Belegung (erster Eintrag = unten links); fehlt sie, entscheidet die Größe.
  function plateLayout(segIds, cols, gapH, gapV, opt, arrange) {
    if (!segIds.length) return [];
    const sizes = segIds.map(seg => {
      const r = buildSegmentPaths(seg, Object.assign({}, opt, { blockX: 0, blockY: 0, machineWidth: segSpan(seg), leadIn: 0 }));
      if (!r) return { seg, w: 1, h: 1 };
      let bb = [Infinity, Infinity, -Infinity, -Infinity];
      for (const p of r.profA.concat(r.profB)) { bb[0] = Math.min(bb[0], p[0]); bb[1] = Math.min(bb[1], p[1]); bb[2] = Math.max(bb[2], p[0]); bb[3] = Math.max(bb[3], p[1]); }
      return { seg, w: bb[2] - bb[0], h: bb[3] - bb[1] };
    });
    const n = sizes.length, C = Math.max(1, cols | 0);
    const a = arrange || {};
    const rows = [];          // Reihen von OBEN nach unten
    if (a.mode === 'pyramid') {
      // Belegung: vorgegebene Reihenfolge (erster Eintrag unten links) oder
      // automatisch nach Stückbreite absteigend — die größeren Stücke nach unten.
      const byId = {}; sizes.forEach(s => byId[s.seg] = s);
      let ord;
      if (a.order && a.order.length) {
        ord = a.order.filter(i => byId[i]).map(i => byId[i]);
        sizes.forEach(s => { if (ord.indexOf(s) < 0) ord.push(s); });
      } else ord = sizes.slice().sort((x, y) => (y.w * y.h) - (x.w * x.h));
      // Reihenbelegung von UNTEN: C, C-1, C-2, … (mindestens 1) bis alle verteilt sind.
      const counts = []; let left = n, k = C;
      while (left > 0) { const t = Math.min(k, left); counts.push(t); left -= t; k = Math.max(1, k - 1); }
      let i = 0;
      const bottomUp = counts.map(t => ord.slice(i, i += t));   // [unterste, …, oberste]
      for (let r = bottomUp.length - 1; r >= 0; r--) rows.push(bottomUp[r]);
    } else {
      for (let i = 0; i < n; i += C) rows.push(sizes.slice(i, i + C));
    }
    // Reihenbreiten (für die mittige Ausrichtung der Pyramide).
    const rowW = rows.map(r => r.reduce((s, x) => s + x.w, 0) + gapH * (r.length - 1));
    const maxW = Math.max.apply(null, rowW);
    // Gesamthöhe → Reihen von oben nach unten stapeln (unten ein Rand gapV).
    let totalH = gapV;
    for (const r of rows) totalH += Math.max.apply(null, r.map(x => x.h)) + gapV;
    const place = [];
    let top = totalH;
    rows.forEach((r, ri) => {
      const rh = Math.max.apply(null, r.map(x => x.h));
      let x = a.mode === 'pyramid' ? gapH + (maxW - rowW[ri]) / 2 : gapH;
      for (const sz of r) { place.push({ seg: sz.seg, dh: x, dv: top - sz.h }); x += sz.w + gapH; }
      top -= rh + gapV;
    });
    return place;
  }

  // ---------- STL-Export ------------------------------------------------
  function faceNormal(v, o) {
    const ax = v[o + 3] - v[o], ay = v[o + 4] - v[o + 1], az = v[o + 5] - v[o + 2];
    const bx = v[o + 6] - v[o], by = v[o + 7] - v[o + 1], bz = v[o + 8] - v[o + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }
  function toBinarySTL(verts) {
    const n = verts.length / 9;
    const buf = new ArrayBuffer(84 + n * 50);
    const dv = new DataView(buf);
    dv.setUint32(80, n, true);
    let o = 84;
    for (let i = 0; i < verts.length; i += 9) {
      const nm = faceNormal(verts, i);
      dv.setFloat32(o, nm[0], true); dv.setFloat32(o + 4, nm[1], true); dv.setFloat32(o + 8, nm[2], true);
      o += 12;
      for (let k = 0; k < 9; k++) { dv.setFloat32(o, verts[i + k], true); o += 4; }
      dv.setUint16(o, 0, true); o += 2;
    }
    return buf;
  }
  function exportSTL(verts, name) {
    if (!verts || !verts.length) return;
    const buf = toBinarySTL(verts);
    // Explorer-Speichern-Dialog (Startordner „3D-Segmente exportieren", Einstellungen);
    // reiner Browser-Download nur ohne File-System-Access-API.
    if (window.App && typeof App.download === 'function') { App.download(name, buf, 'model/stl', 'svStl'); return; }
    if (window.App && App.demoSaveBlocked && App.demoSaveBlocked()) return;   // Kern-Demo
    const blob = new Blob([buf], { type: 'model/stl' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function baseName() { return (M.name || 'modell').replace(/\.[^.]+$/, ''); }
  function exportSegment(i) {
    if (!M.segs || !M.segs[i]) return;
    exportSTL(M.segs[i].verts, baseName() + '_seg' + (i + 1) + '.stl');
  }
  function exportAll() {
    if (!M.segs) return;
    M.segs.forEach((s, i) => { if (s.ntri) exportSegment(i); });
  }

  // ---------- Rendering -------------------------------------------------
  const LIGHT = (() => { const l = [-0.35, 0.55, 0.75]; const n = Math.hypot(...l); return l.map(x => x / n); })();
  // Halbvektor (Blinn-Phong) im Kameraraum: Blickrichtung zeigt zur Kamera = (0,0,-1).
  // Konstant, da LIGHT relativ zum Betrachter fix ist (Kopflicht) — einmal vorberechnet.
  const HALF = (() => { const h = [LIGHT[0], LIGHT[1], LIGHT[2] - 1]; const n = Math.hypot(...h) || 1; return h.map(x => x / n); })();

  function fit() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    glFit();
  }

  // ---------- WebGL2-Renderer (volle Auflösung, GPU) ---------------------
  // Eine zweite Canvas liegt HINTER der 2D-Canvas und zeichnet nur das Netz
  // (Flächen/Drahtgitter) — ohne Ausdünnung, mit Z-Buffer statt Maler-Sortierung.
  // Alles Übrige (Box, Ebenen, Schnittspuren, Badges, 2D-Ansichten) bleibt auf
  // der 2D-Canvas darüber. Ohne WebGL2 greift der alte Canvas-2D-Pfad.
  let glc = null, gl = null, glProg = null, glLoc = null, glVao = null;
  const glBufs = new Map();     // Float32Array → {buf, n, used}
  let glTried = false;

  function glInit() {
    if (glTried || !canvas) return;
    glTried = true;
    try {
      glc = document.createElement('canvas');
      glc.id = 'cModelGL';
      glc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
      canvas.parentNode.insertBefore(glc, canvas);
      gl = glc.getContext('webgl2', { antialias: true, alpha: false, depth: true });
      if (!gl) throw new Error('no webgl2');
      const VS = `#version 300 es
        in vec3 aPos;
        uniform vec3 uCenter; uniform float uYaw; uniform float uPitch; uniform vec4 uProj; // sx, sy, ox, oy
        uniform float uZScale;
        out vec3 vCam; out vec3 vBary;
        void main(){
          vec3 p = aPos - uCenter;
          float cy = cos(uYaw), sy = sin(uYaw), cp = cos(uPitch), sp = sin(uPitch);
          float x1 = p.x*cy + p.z*sy, z1 = -p.x*sy + p.z*cy;
          float y2 = p.y*cp - z1*sp,  z2 = p.y*sp + z1*cp;
          vCam = vec3(x1, y2, z2);
          int k = gl_VertexID - 3*(gl_VertexID/3);
          vBary = vec3(k==0?1.0:0.0, k==1?1.0:0.0, k==2?1.0:0.0);
          gl_Position = vec4(uProj.z + uProj.x*x1, uProj.w + uProj.y*y2, z2*uZScale, 1.0);
        }`;
      const FS = `#version 300 es
        precision highp float;
        in vec3 vCam; in vec3 vBary;
        uniform vec3 uHSL; uniform vec3 uLight; uniform vec3 uHalf; uniform int uWire;
        out vec4 o;
        vec3 hsl2rgb(float h, float s, float l){
          float c = (1.0 - abs(2.0*l - 1.0)) * s;
          float hp = h/60.0; float x = c*(1.0 - abs(mod(hp,2.0)-1.0));
          vec3 r = hp<1.0?vec3(c,x,0):hp<2.0?vec3(x,c,0):hp<3.0?vec3(0,c,x):hp<4.0?vec3(0,x,c):hp<5.0?vec3(x,0,c):vec3(c,0,x);
          return r + (l - c*0.5);
        }
        void main(){
          vec3 n = normalize(cross(dFdx(vCam), dFdy(vCam)));
          if (n.z > 0.0) n = -n;                       // zur Kamera drehen (beidseitig flach)
          float lam = max(0.0, dot(n, uLight));
          float sp = max(0.0, dot(n, uHalf)); float spec = sp*sp; spec *= spec;
          float shade = 0.34 + 0.62*lam;
          float l = min(96.0, uHSL.z*shade + spec*20.0);
          vec3 rgb = hsl2rgb(uHSL.x, uHSL.y/100.0, l/100.0);
          if (uWire == 1) {
            vec3 d = fwidth(vBary);
            vec3 a = smoothstep(vec3(0.0), d*1.2, vBary);
            float e = min(min(a.x, a.y), a.z);
            if (e > 0.6) discard;
            rgb = hsl2rgb(uHSL.x, uHSL.y/100.0, uHSL.z/100.0);
          }
          o = vec4(rgb, 1.0);
        }`;
      const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      glProg = gl.createProgram();
      gl.attachShader(glProg, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(glProg, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(glProg);
      if (!gl.getProgramParameter(glProg, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glProg));
      glLoc = {};
      for (const u of ['uCenter', 'uYaw', 'uPitch', 'uProj', 'uZScale', 'uHSL', 'uLight', 'uHalf', 'uWire']) glLoc[u] = gl.getUniformLocation(glProg, u);
      glLoc.aPos = gl.getAttribLocation(glProg, 'aPos');
      glVao = gl.createVertexArray();
      glc.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; glBufs.clear(); }, false);
    } catch (e) {
      gl = null;
      if (glc && glc.parentNode) glc.parentNode.removeChild(glc);
      glc = null;
    }
  }
  function glFit() {
    if (!glTried) glInit();
    if (!gl || !glc) return;
    glc.width = canvas.width; glc.height = canvas.height;
  }
  function glActive() { return !!gl && M.view === '3d'; }
  // Hintergrundfarbe (CSS-Variable, beliebiges Format) → [r,g,b] 0..1 via 2D-Canvas-Normalisierung.
  function cssRGB(c) {
    try {
      ctx.fillStyle = c; const n = ctx.fillStyle;
      let m = /^#([0-9a-f]{6})$/i.exec(n);
      if (m) return [parseInt(m[1].slice(0, 2), 16) / 255, parseInt(m[1].slice(2, 4), 16) / 255, parseInt(m[1].slice(4, 6), 16) / 255];
      m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(n);
      if (m) return [m[1] / 255, m[2] / 255, m[3] / 255];
    } catch (e) {}
    return [0.043, 0.055, 0.07];
  }
  function glBuffer(arr) {
    let b = glBufs.get(arr);
    if (b) { b.used = true; return b; }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    b = { buf, n: Math.floor(arr.length / 3), used: true };
    glBufs.set(arr, b);
    return b;
  }
  function glClearScene() {
    if (!gl) return;
    const bg = cssRGB(col('--bg', '#0b0e12'));
    gl.viewport(0, 0, glc.width, glc.height);
    gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }
  function glDraw(sources, wire) {
    glClearScene();
    for (const b of glBufs.values()) b.used = false;
    gl.useProgram(glProg);
    gl.bindVertexArray(glVao);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    // Projektion exakt wie scr(): x = W/2 + px + s*cx ; y = H/2 + py - s*cy
    const s = 0.42 * Math.min(W, H) / radius * cam.zoom;
    gl.uniform4f(glLoc.uProj, 2 * s / W, 2 * s / H, 2 * cam.px / W, -2 * cam.py / H);
    gl.uniform1f(glLoc.uZScale, 1 / (radius * 2.5));   // Tiefe: kleiner = näher (Kamera schaut in +z)
    gl.uniform3f(glLoc.uCenter, center[0], center[1], center[2]);
    gl.uniform1f(glLoc.uYaw, cam.yaw); gl.uniform1f(glLoc.uPitch, cam.pitch);
    gl.uniform3f(glLoc.uLight, LIGHT[0], LIGHT[1], LIGHT[2]);
    gl.uniform3f(glLoc.uHalf, HALF[0], HALF[1], HALF[2]);
    gl.uniform1i(glLoc.uWire, wire ? 1 : 0);
    for (const src of sources) {
      const b = glBuffer(src.verts);
      const c = hslParts(src.base);
      gl.uniform3f(glLoc.uHSL, c.h, c.s, c.l);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
      gl.enableVertexAttribArray(glLoc.aPos);
      gl.vertexAttribPointer(glLoc.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, b.n);
    }
    gl.bindVertexArray(null);
    // Verwaiste Puffer (altes Netz / alte Segmente) freigeben.
    for (const [k, b] of glBufs) if (!b.used) { gl.deleteBuffer(b.buf); glBufs.delete(k); }
  }

  function segColor(i, sat) {
    const h = (i * 47) % 360;
    return 'hsl(' + h + ',' + (sat || 55) + '%,58%)';
  }

  // Zeichenquelle: bei Zerlegung die Segmente, sonst das Rohnetz.
  function drawSources() {
    if (M.segs) {
      return M.segs.map((s, i) => ({ verts: s.verts, base: segColor(i), idx: i }))
        .filter(s => M.sel === 'all' || s.idx === M.sel);
    }
    if (M.verts) return [{ verts: M.verts, base: col('--accent', '#4aa3ff'), idx: -1 }];
    return [];
  }

  // Feste Obergrenze gezeichneter Flächen — unabhängig von der Netzgröße. Die
  // volle Geometrie (M.verts / Segmente) bleibt für Zerlegung und G-Code erhalten;
  // nur die Darstellung wird ausgedünnt, sonst blockiert ein großes STL den
  // Main-Thread (Millionen Dreiecke pro Bild).
  const FACE_BUDGET = 30000;
  let lastStep = 1;

  function draw() {
    if (!ctx) fit();
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    const useGL = glActive();
    if (useGL) {
      // 2D-Canvas bleibt transparent — Hintergrund + Netz liefert die GL-Canvas darunter.
      if (glc) glc.style.visibility = 'visible';
      if (!M.verts) { glClearScene(); return; }
    } else {
      if (glc) glc.style.visibility = 'hidden';
      ctx.fillStyle = col('--bg', '#0b0e12');
      ctx.fillRect(0, 0, W, H);
      if (!M.verts) return;
    }

    if (M.view === 'profiles') { drawProfiles2D(); return; }
    if (M.view === 'pairs') { drawPairs(); return; }
    if (M.view === 'plate') { drawPlate(); return; }

    const sources = drawSources();
    if (useGL) {
      // Volle Geometrie auf der GPU — keine Ausdünnung, auch beim Drehen schattiert.
      glDraw(sources, !!M.wire);
      lastStep = 1;
      drawBBox();
      if (M.showPlanes) drawPlanes();
      if (!dragging) drawSections();
      drawAxisBadge();
      return;
    }
    drawBBox();
    const total = totalTris(sources);
    const budget = dragging ? 13000 : FACE_BUDGET;        // beim Drehen gröber
    const step = Math.max(1, Math.ceil(total / budget));  // jede step-te Fläche
    lastStep = step;
    const wire = M.wire || dragging;                      // beim Drehen Drahtgitter (schnell)

    if (wire) {
      for (const src of sources) drawWire(src.verts, src.base, step);
    } else {
      drawShaded(sources, step);
    }
    if (M.showPlanes) drawPlanes();
    if (!dragging) drawSections();     // Schnittspuren auf den Ebenen
    drawAxisBadge();
    if (step > 1) drawSimpleNote(step);
  }
  // Konturlinien (plines) der Modell-Schnitte mit jeder Ebene zeichnen.
  function drawSections() {
    if (!M.planes.length) return;
    ensureSections();
    if (!M.sections) return;
    ctx.strokeStyle = col('--good', '#57d38c'); ctx.lineWidth = 2; ctx.setLineDash([]);
    for (const sec of M.sections) {
      for (const loop of sec.loops) {
        if (loop.length < 2) continue;
        ctx.beginPath();
        for (let i = 0; i < loop.length; i++) {
          const p = scr(loop[i][0], loop[i][1], loop[i][2]);
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath(); ctx.stroke();
      }
    }
  }
  function totalTris(sources) { let n = 0; for (const s of sources) n += s.verts.length / 9; return n; }

  function drawShaded(sources, step) {
    const st = (step || 1) * 9;
    // Sichtbare Flächen (ausgedünnt) sammeln, nach Tiefe sortieren (Maler).
    const faces = [];
    for (const src of sources) {
      const v = src.verts, base = hslParts(src.base);
      for (let i = 0; i < v.length; i += st) {
        const nm = faceNormal(v, i);
        const nc = rot(nm);
        // Backface-Culling: abgewandte Flächen (Normale zeigt von der Kamera weg)
        // gar nicht erst projizieren/zeichnen — halbiert die Füllungen (schneller)
        // und verhindert, dass Rückseiten durch den Maleralgorithmus durchscheinen.
        if (nc[2] > 0.02) continue;
        const p0 = scr(v[i], v[i + 1], v[i + 2]);
        const p1 = scr(v[i + 3], v[i + 4], v[i + 5]);
        const p2 = scr(v[i + 6], v[i + 7], v[i + 8]);
        // Diffus (Kopflicht) + Ambient-Grundhelligkeit + dezentes Specular-Highlight.
        const lam = Math.max(0, nc[0] * LIGHT[0] + nc[1] * LIGHT[1] + nc[2] * LIGHT[2]);
        const sp = Math.max(0, nc[0] * HALF[0] + nc[1] * HALF[1] + nc[2] * HALF[2]);
        const spec = sp * sp; const spec4 = spec * spec;   // ~pow(.,4) — weiche Glanzstelle
        const shade = 0.34 + 0.62 * lam;
        faces.push({ p0, p1, p2, d: (p0.d + p1.d + p2.d) / 3, base, shade, spec: spec4 });
      }
    }
    faces.sort((a, b) => b.d - a.d);
    ctx.lineJoin = 'round';
    for (const f of faces) {
      let l = f.base.l * f.shade + f.spec * 20;   // Glanz hebt die Helligkeit leicht an
      if (l > 96) l = 96;
      ctx.fillStyle = ctx.strokeStyle = 'hsl(' + f.base.h + ',' + f.base.s + '%,' + Math.round(l) + '%)';
      ctx.beginPath();
      ctx.moveTo(f.p0.x, f.p0.y); ctx.lineTo(f.p1.x, f.p1.y); ctx.lineTo(f.p2.x, f.p2.y); ctx.closePath();
      // Naht-Schließen: gleichfarbige 1px-Kontur deckt subpixelige Fugen zwischen
      // benachbarten Dreiecken ab (sonst blitzt der Hintergrund durch).
      ctx.lineWidth = 1; ctx.fill(); ctx.stroke();
    }
  }
  function hslParts(c) {
    const m = /hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/.exec(c);
    if (m) return { h: +m[1], s: +m[2], l: +m[3] };
    return { h: 205, s: 70, l: 60 };
  }
  function drawWire(v, color, step) {
    const st = (step || 1) * 9;
    ctx.strokeStyle = color; ctx.lineWidth = 0.6; ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (let i = 0; i < v.length; i += st) {
      const p0 = scr(v[i], v[i + 1], v[i + 2]);
      const p1 = scr(v[i + 3], v[i + 4], v[i + 5]);
      const p2 = scr(v[i + 6], v[i + 7], v[i + 8]);
      ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.closePath();
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  function drawSimpleNote(step) {
    ctx.font = '11px Segoe UI'; ctx.fillStyle = col('--muted', '#8b98a8');
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText(T('vereinfachte Vorschau (1/') + step + T(' der Flächen)'), W - 12, H - 10);
    ctx.textAlign = 'left';
  }

  // ---------- 2. Fenster: Schnittprofile (2D, lagerichtig) --------------
  let p2 = { zoom: 1, px: 0, py: 0 };
  function profColor(i, n) {
    const h = n > 1 ? 205 - 170 * (i / (n - 1)) : 205;   // Anfang blau → Ende orange
    return 'hsl(' + Math.round((h + 360) % 360) + ',70%,58%)';
  }
  function drawProfiles2D() {
    ensureProfiles();
    const profs = M.profiles || [];
    const ax = M.axis, u = (ax + 1) % 3, w = (ax + 2) % 3;
    // Gemeinsame Bounding-Box aller Profile (lagerichtig, gleicher Nullpunkt).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pr of profs) for (const loop of pr.loops) for (const p of loop) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    if (!isFinite(minX)) {
      ctx.fillStyle = col('--muted', '#8b98a8'); ctx.font = '13px Segoe UI';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(T('Keine Schnittprofile — Ebenen im 3D-Modell setzen.'), W / 2, H / 2);
      ctx.textAlign = 'left'; return;
    }
    const bw = (maxX - minX) || 1, bh = (maxY - minY) || 1;
    const pad = 56;
    const base = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
    const sc = base * p2.zoom;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const tx = x => W / 2 + p2.px + (x - cx) * sc;
    const ty = y => H / 2 + p2.py - (y - cy) * sc;    // w-Achse nach oben

    // Gitter + Achsen durch den Nullpunkt (u=0, w=0).
    ctx.strokeStyle = col('--line', '#2a323c'); ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(tx(0), 0); ctx.lineTo(tx(0), H); ctx.moveTo(0, ty(0)); ctx.lineTo(W, ty(0)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = col('--muted', '#8b98a8'); ctx.font = '11px Segoe UI';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(AXIS[u] + ' →', W - 24, ty(0) + 4);
    ctx.fillText('↑ ' + AXIS[w], tx(0) + 4, 6);

    // Profile lagerichtig übereinander.
    for (const pr of profs) {
      const color = profColor(pr.idx, pr.n);
      ctx.strokeStyle = color; ctx.lineWidth = (pr.idx === 0 || pr.idx === pr.n - 1) ? 2.2 : 1.6;
      for (const loop of pr.loops) {
        if (loop.length < 2) continue;
        ctx.beginPath();
        for (let i = 0; i < loop.length; i++) { const X = tx(loop[i][0]), Y = ty(loop[i][1]); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }
        ctx.closePath(); ctx.stroke();
      }
      // Name am höchsten Punkt des Profils
      let top = null; for (const loop of pr.loops) for (const p of loop) if (!top || p[1] > top[1]) top = p;
      if (top) { ctx.fillStyle = color; ctx.font = 'bold 11px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(sectionName(pr.idx), tx(top[0]) + (pr.idx - (pr.n - 1) / 2) * 16, ty(top[1]) - 3); ctx.textAlign = 'left'; }
    }

    // Titel + Legende (Ebenenlage entlang der Schnittachse).
    ctx.fillStyle = col('--txt', '#e6ebf1'); ctx.font = '12px Segoe UI'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(T('Schnittprofile (lagerichtig) — Ebene ⊥ ') + AXIS[ax], 12, 10);
    let ly = 30;
    for (const pr of profs) {
      ctx.strokeStyle = profColor(pr.idx, pr.n); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(12, ly + 6); ctx.lineTo(30, ly + 6); ctx.stroke();
      ctx.fillStyle = col('--muted', '#8b98a8'); ctx.font = '11px Segoe UI';
      const tag = pr.idx === 0 ? T(' (Anfang)') : (pr.idx === pr.n - 1 ? T(' (Ende)') : '');
      ctx.fillText(sectionName(pr.idx) + tag, 36, ly);
      ly += 16;
    }
    ctx.fillStyle = col('--muted', '#8b98a8'); ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.font = '11px Segoe UI';
    ctx.fillText(T('Rad = Zoom · Ziehen = Verschieben · Doppelklick = zurück'), W - 12, H - 10);
    ctx.textAlign = 'left';
  }
  function resetProfileView() { p2 = { zoom: 1, px: 0, py: 0 }; }

  // ---------- 3. Fenster: Segmentpaar + Schnittspur ---------------------
  let pairX = null;          // Transform + aktuelle Schnittspur (für Interaktion)
  let pairEdit = false;      // Punkte-Bearbeiten aktiv
  let pairDrag = null;       // {which:'A'|'B', idx} beim Ziehen
  // Bildschirm → Ebenen-Koordinate (Maschinenrahmen h,v).
  function pairInv(mx, my) {
    if (!pairX) return null;
    return [(mx - W / 2 - pairX.px) / pairX.sc + pairX.cx,
            (H / 2 + pairX.py - my) / pairX.sc + pairX.cy];
  }
  function pairScreen(p) { return { x: W / 2 + pairX.px + (p[0] - pairX.cx) * pairX.sc, y: H / 2 + pairX.py - (p[1] - pairX.cy) * pairX.sc }; }
  // Nächsten Schnittspur-Punkt zur Maus finden (Bildschirmabstand).
  function pairNearest(mx, my) {
    if (!pairX) return null;
    let best = null, bd = 12 * 12;
    for (const which of ['cutA', 'cutB']) {
      const P = pairX[which];
      for (let i = 0; i < P.length; i++) {
        const s = pairScreen(P[i]); const d = (s.x - mx) ** 2 + (s.y - my) ** 2;
        if (d < bd) { bd = d; best = { which: which === 'cutA' ? 'A' : 'B', idx: i }; }
      }
    }
    return best;
  }
  // Nächster Punkt auf Schnittspur A (ohne Schwelle) — für „Startpunkt setzen".
  // Nächster Punkt auf der Außenkontur (Eindring-/Startpunkt) → dessen Koordinate.
  function nearestOuterPt(mx, my) {
    if (!pairX || !pairX.outer) return null;
    let best = 0, bd = Infinity;
    for (let i = 0; i < pairX.outer.length; i++) {
      const s = pairScreen(pairX.outer[i]); const d = (s.x - mx) ** 2 + (s.y - my) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return pairX.outer[best];
  }
  function pairApply(patch) { if (typeof window !== 'undefined' && window.__model3dPairApply) window.__model3dPairApply(patch); }
  function pairProv() { return (typeof window !== 'undefined' && window.__model3dPairProvider) ? window.__model3dPairProvider() : { seg: 0, opt: {} }; }
  // Einen Schnittspur-Punkt verschieben (friert die Spur beim ersten Mal ein).
  function pairMovePoint(which, idx, pt) {
    const pv = pairProv(), seg = pairX.seg;
    const edits = Object.assign({}, (pv.opt && pv.opt.edits) || {});
    if (!edits[seg]) edits[seg] = { A: pairX.cutA.map(p => p.slice()), B: pairX.cutB.map(p => p.slice()) };
    else edits[seg] = { A: edits[seg].A.map(p => p.slice()), B: edits[seg].B.map(p => p.slice()) };
    if (edits[seg][which][idx]) { edits[seg][which][idx] = pt; pairApply({ edits }); }
  }
  function setPairEdit(on) { pairEdit = !!on; draw(); }

  // Für ein Segment: seine beiden Stirnprofile (das „Paar") mit dem
  // abbrandkompensierten Schnittweg (Schnittspur), analog zu Kern-/Negativ-Design.
  function pairData(segIndex, o) {
    const cp = cutPaths(segIndex, o);
    if (!cp) return null;
    return { outerA: cp.rawOuterA, outerB: cp.rawOuterB, innersA: cp.rawInnersA, innersB: cp.rawInnersB,
      cutOuterA: cp.cutOuterA, cutOuterB: cp.cutOuterB, cutInnersA: cp.cutInnersA, cutInnersB: cp.cutInnersB,
      A: cp.A, B: cp.B, hollow: cp.hollow, entry: cp.entry, innerEntries: cp.innerEntries || [], edited: cp.edited,
      seg: segIndex, lo: cp.lo, hi: cp.hi, kp: kerfPairOf(cp.kerfInfo, Object.assign({ kerf: 0 }, o || {})) };
  }
  function drawPairs() {
    ensureSegments();     // bei Bedarf automatisch zerlegen (passend zu Achse/Ebenen)
    const prov = (typeof window !== 'undefined' && window.__model3dPairProvider) ? window.__model3dPairProvider() : { seg: 0, opt: {} };
    const nseg = M.segs ? M.segs.length : 0;
    const seg = Math.max(0, Math.min(prov.seg || 0, nseg - 1));
    const d = nseg ? pairData(seg, prov.opt || {}) : null;
    if (!d) {
      ctx.fillStyle = col('--muted', '#8b98a8'); ctx.font = '13px Segoe UI';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(nseg ? T('Querschnitt nicht ermittelbar.') : T('Erst zerlegen — dann Segmentpaar anzeigen.'), W / 2, H / 2);
      ctx.textAlign = 'left'; return;
    }
    const ax = M.axis;
    // Vollständiger Drahtpfad (beide Türme) + Nullpunkt in Maschinenkoordinaten,
    // in den Ansichtsrahmen der Schnittspur gebracht (machine − Blockversatz).
    const showTowers = M.pairTowers === true;
    let pathLp = null, pathRp = null, org = null;
    let gc = null; if (showTowers) { try { gc = buildSegmentPaths(seg, prov.opt || {}); } catch (e) { gc = null; } }
    if (gc && gc.pathL) {
      const oH = gc.offH || 0, oV = gc.offV || 0;
      pathLp = gc.pathL.map(p => [p[0] - oH, p[1] - oV]);
      pathRp = gc.pathR.map(p => [p[0] - oH, p[1] - oV]);
      org = [-oH, -oV];
    }
    // Blockgrenzen = Bounding-Box der Außen-Schnittspur.
    let bxmin = Infinity, bymin = Infinity, bxmax = -Infinity, bymax = -Infinity;
    for (const p of d.cutOuterA.concat(d.cutOuterB)) { bxmin = Math.min(bxmin, p[0]); bymin = Math.min(bymin, p[1]); bxmax = Math.max(bxmax, p[0]); bymax = Math.max(bymax, p[1]); }
    const all = d.A.concat(d.B);
    if (pathLp) { all.push.apply(all, pathLp); all.push.apply(all, pathRp); all.push(org); }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of all) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
    const bw = (maxX - minX) || 1, bh = (maxY - minY) || 1, pad = 56;
    const sc = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh) * p2.zoom;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const tx = x => W / 2 + p2.px + (x - cx) * sc;
    const ty = y => H / 2 + p2.py - (y - cy) * sc;
    // Transform + Punkte für Interaktion (Startpunkt setzen / Punkte verschieben).
    pairX = { seg, cx, cy, sc, px: p2.px, py: p2.py, cutA: d.A, cutB: d.B, outer: d.cutOuterA, edited: d.edited };
    // Achsenkreuz
    ctx.strokeStyle = col('--line', '#2a323c'); ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(tx(0), 0); ctx.lineTo(tx(0), H); ctx.moveTo(0, ty(0)); ctx.lineTo(W, ty(0)); ctx.stroke();
    ctx.setLineDash([]);
    const loop = (P, color, wd, dash) => {
      ctx.strokeStyle = color; ctx.lineWidth = wd; if (dash) ctx.setLineDash(dash); else ctx.setLineDash([]);
      ctx.beginPath();
      for (let i = 0; i < P.length; i++) { const X = tx(P[i][0]), Y = ty(P[i][1]); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }
      ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    };
    const polyline = (P, color, wd, dash) => {
      ctx.strokeStyle = color; ctx.lineWidth = wd; if (dash) ctx.setLineDash(dash); else ctx.setLineDash([]);
      ctx.beginPath();
      for (let i = 0; i < P.length; i++) { const X = tx(P[i][0]), Y = ty(P[i][1]); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }
      ctx.stroke(); ctx.setLineDash([]);
    };
    // Blockgrenzen (Rechteck) — das Werkstück umschließt die Schnittspur.
    if (isFinite(bxmin)) {
      ctx.strokeStyle = col('--muted', '#8b98a8'); ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
      ctx.strokeRect(tx(bxmin), ty(bymax), (bxmax - bxmin) * sc, (bymax - bymin) * sc);
      ctx.setLineDash([]);
    }
    // Kompletter Drahtpfad ab Nullpunkt: linker/rechter Turm (Kontrolle der Wege).
    if (pathLp) {
      polyline(pathLp, 'rgba(74,163,255,.55)', 1);      // Turm links
      polyline(pathRp, 'rgba(255,180,84,.55)', 1);      // Turm rechts
      // Nullpunkt (Maschinen-Null).
      const o = org; const ox = tx(o[0]), oy = ty(o[1]);
      ctx.strokeStyle = col('--bad', '#ff6b6b'); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(ox - 9, oy); ctx.lineTo(ox + 9, oy); ctx.moveTo(ox, oy - 9); ctx.lineTo(ox, oy + 9); ctx.stroke();
      ctx.fillStyle = col('--bad', '#ff6b6b'); ctx.font = '11px Segoe UI'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(T('Null (0,0)'), ox + 11, oy - 4);
    }
    // Sollkontur (blass) — Außen und Löcher.
    loop(d.outerA, col('--accent', '#4aa3ff'), 1); loop(d.outerB, col('--accent2', '#ffb454'), 1);
    for (const inn of d.innersA) loop(inn, col('--accent', '#4aa3ff'), 1);
    for (const inn of d.innersB) loop(inn, col('--accent2', '#ffb454'), 1);
    // Abbrand in wahrer Dicke: Band in Schnittspaltbreite unter die Schnittspur (A und
    // B getrennt überblendet; Spalt je Punkt .kk, sonst Stirnflächen-Wert d.kp).
    if (window.App && App.kerfBand && App.kerfTrueOn && App.kerfTrueOn('model')) {
      const VB = { s: sc, X: tx, Y: ty }, wc = col('--wire', '#ff5a3c');
      const bl = (loops, k) => loops.map(l => ({ pts: l, kk: l.kk, k: l.k0 != null ? l.k0 : k }));
      if (d.edited) { App.kerfBand(ctx, VB, [d.A], { view: 'model', k: d.kp.A, color: wc }); App.kerfBand(ctx, VB, [d.B], { view: 'model', k: d.kp.B, color: wc }); }
      else {
        App.kerfBand(ctx, VB, bl([d.cutOuterA].concat(d.cutInnersA), d.kp.A), { view: 'model', close: true, color: wc });
        App.kerfBand(ctx, VB, bl([d.cutOuterB].concat(d.cutInnersB), d.kp.B), { view: 'model', close: true, color: wc });
      }
    }
    // Schnittspur (kräftig). Bearbeitet → der eingefrorene Pfad; sonst Außen/Löcher.
    if (d.edited) {
      polyline(d.A, col('--wire', '#ff5a3c'), 1.8); polyline(d.B, col('--wire', '#ff5a3c'), 1.8, [6, 4]);
    } else {
      loop(d.cutOuterA, col('--wire', '#ff5a3c'), 1.8); loop(d.cutOuterB, col('--wire', '#ff5a3c'), 1.8, [6, 4]);
      for (const inn of d.cutInnersA) loop(inn, col('--wire', '#ff5a3c'), 1.8);
      for (const inn of d.cutInnersB) loop(inn, col('--wire', '#ff5a3c'), 1.8, [6, 4]);
    }
    // Eindringschlitz (außen → Loch), falls hohl.
    if (d.hollow && d.cutInnersA.length && !d.edited) {
      ctx.strokeStyle = col('--good', '#57d38c'); ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
      for (let k = 0; k < d.cutInnersA.length; k++) { const inn = d.cutInnersA[k]; const ie = (d.innerEntries && d.innerEntries[k] != null) ? d.innerEntries[k] : nearestIdx(inn, d.entry); ctx.beginPath(); ctx.moveTo(tx(d.entry[0]), ty(d.entry[1])); ctx.lineTo(tx(inn[ie][0]), ty(inn[ie][1])); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    // Bearbeitungspunkte (wenn Bearbeiten aktiv) — auf dem Schnittpfad.
    if (pairEdit) {
      ctx.fillStyle = col('--wire', '#ff5a3c');
      for (const P of [d.A, d.B]) for (const p of P) { ctx.beginPath(); ctx.arc(tx(p[0]), ty(p[1]), 2.4, 0, 6.3); ctx.fill(); }
    }
    // Eindringpunkt/Startpunkt + Richtung (Pfeil in den ersten Schnittzug).
    const s0 = d.entry, s1 = d.A[Math.min(1, d.A.length - 1)];
    const sx = tx(s0[0]), sy = ty(s0[1]);
    ctx.fillStyle = col('--good', '#57d38c'); ctx.beginPath(); ctx.arc(sx, sy, 5, 0, 6.3); ctx.fill();
    const ang = Math.atan2(ty(s1[1]) - sy, tx(s1[0]) - sx);
    ctx.strokeStyle = col('--good', '#57d38c'); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 22 * Math.cos(ang), sy + 22 * Math.sin(ang)); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx + 22 * Math.cos(ang), sy + 22 * Math.sin(ang));
    ctx.lineTo(sx + 14 * Math.cos(ang - 0.4), sy + 14 * Math.sin(ang - 0.4));
    ctx.lineTo(sx + 14 * Math.cos(ang + 0.4), sy + 14 * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fillStyle = col('--good', '#57d38c'); ctx.fill();
    // Titel + Legende
    ctx.fillStyle = col('--txt', '#e6ebf1'); ctx.font = '12px Segoe UI'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(T('Segmentpaar ') + (seg + 1) + '/' + nseg + ' — A = ' + sectionName(seg) + ', B = ' + sectionName(seg + 1)
      + (d.hollow ? T('  · hohl (innen zuerst)') : '') + (d.edited ? T('  · bearbeitet') : ''), 12, 10);
    const leg = [[col('--accent', '#4aa3ff'), T('Sollkontur A (außen/Loch)') + ' · ' + sectionName(seg)], [col('--accent2', '#ffb454'), T('Sollkontur B') + ' · ' + sectionName(seg + 1)],
      [col('--wire', '#ff5a3c'), T('Schnittspur (A —, B ┄)')],
      [col('--good', '#57d38c'), d.hollow ? T('Eindringpunkt + Schlitz') : T('Startpunkt + Richtung')],
      [col('--muted', '#8b98a8'), T('Blockgrenzen')]];
    if (pathLp) { leg.push(['rgba(74,163,255,.55)', T('Turmweg links/rechts')], [col('--bad', '#ff6b6b'), T('Nullpunkt (0,0)')]); }
    let ly = 30;
    for (const [c, label] of leg) {
      ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(12, ly + 6); ctx.lineTo(30, ly + 6); ctx.stroke();
      ctx.fillStyle = col('--muted', '#8b98a8'); ctx.font = '11px Segoe UI'; ctx.fillText(label, 36, ly); ly += 16;
    }
    ctx.fillStyle = col('--muted', '#8b98a8'); ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.font = '11px Segoe UI';
    ctx.fillText(pairEdit ? T('Punkt ziehen = verschieben · Doppelklick = zurücksetzen')
      : (d.hollow ? T('Klick = Eindringpunkt (außen) setzen · Rad = Zoom · Ziehen = Verschieben')
        : T('Klick = Startpunkt setzen · Rad = Zoom · Ziehen = Verschieben')), W - 12, H - 10);
    ctx.textAlign = 'left';
  }

  // ---------- 4. Fenster: Platte (mehrere Segmente anordnen) ------------
  let plateX = null;       // Transform + Stücke/Verbindungen (für Interaktion)
  let plateDrag = null;    // {type:'piece'|'chan', idx, grab:[dh,dv]|x0}
  let plateDragPreview = null; // leichtgewichtige Live-Vorschau beim Ziehen (kein Rebuild)
  let plateEdit = false;   // Bearbeitungsmodus aktiv (sonst nur Ansicht/Pan)
  let plateEditMode = 'pieces'; // 'pieces' = Segmente verschieben, 'conns' = Verbindungspfad bearbeiten
  function setPlateEdit(on) { plateEdit = !!on; if (M.view === 'plate') draw(); }
  function setPlateEditMode(m) { plateEditMode = (m === 'pieces') ? 'pieces' : 'conns'; if (M.view === 'plate') draw(); }
  function platePv() { return (typeof window !== 'undefined' && window.__model3dPlateProvider) ? window.__model3dPlateProvider() : { placements: [], opt: {} }; }
  function plateApply(patch) { if (typeof window !== 'undefined' && window.__model3dPlateApply) window.__model3dPlateApply(patch); }
  function drawPlate() {
    ensureSegments();
    const prov = platePv();
    const pls = prov.placements || [];
    if (!pls.length) {
      ctx.fillStyle = col('--muted', '#8b98a8'); ctx.font = '13px Segoe UI';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(T('Keine Platten-Auswahl — im Menü „Platte / Stapeln" Segmente wählen.'), W / 2, H / 2);
      ctx.textAlign = 'left'; return;
    }
    // Memo: nur bei Layout-Änderung (Auswahl/Positionen/Optionen) neu bauen —
    // Schwenken/Zoomen ändert nur die Ansichts-Transformation, nicht die Pfade.
    const memoKey = JSON.stringify(pls.map(p => [p.seg, p.dh, p.dv]))
      + '|' + JSON.stringify([(prov.opt || {}).N, (prov.opt || {}).kerfMode, (prov.opt || {}).kerf, (prov.opt || {}).plateGap, (prov.opt || {}).machineWidth, (prov.opt || {}).blockZ,
        (prov.opt || {}).start, (prov.opt || {}).startPt, (prov.opt || {}).startAng, (prov.opt || {}).reverse, (prov.opt || {}).swap, (prov.opt || {}).flip, (prov.opt || {}).edits])
      + '|' + JSON.stringify((prov.opt || {}).plateConnEdits || {});
    let gc = null;
    if (plateGcMemo && plateGcMemo.key === memoKey) gc = plateGcMemo.gc;
    else { try { gc = buildPlatePaths(pls, prov.opt || {}); } catch (e) { gc = null; } plateGcMemo = gc ? { key: memoKey, gc } : null; }
    if (!gc) { ctx.fillStyle = col('--bad', '#ff6b6b'); ctx.textAlign = 'center'; ctx.fillText(T('Platte nicht erzeugbar.'), W / 2, H / 2); ctx.textAlign = 'left'; return; }
    // Fit über Plattenmaße (Footprint) + Verbindungspfade + Nullpunkt (NICHT die
    // extrapolierten Türme — die ragen weit über die Platte hinaus).
    // Fahrwege des Portals (Verbindungen) nur auf Wunsch — beim Bearbeiten der
    // Verbindungen aber immer sichtbar.
    const connsActive = plateEdit && plateEditMode === 'conns';
    const showTravel = M.plateTravel !== false || connsActive;
    const all = [[0, 0]];
    for (const pc of gc.pieces) { all.push([pc.bb[0], pc.bb[1]], [pc.bb[2], pc.bb[3]]); }
    if (showTravel) for (const cn of gc.conns) for (const p of cn.path) all.push(p);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of all) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
    const bw = (maxX - minX) || 1, bh = (maxY - minY) || 1, pad = 56;
    const sc = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh) * p2.zoom;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const tx = x => W / 2 + p2.px + (x - cx) * sc;
    const ty = y => H / 2 + p2.py - (y - cy) * sc;
    plateX = { cx, cy, sc, px: p2.px, py: p2.py, pieces: gc.pieces, conns: gc.conns };
    // Achsenkreuz + Nullpunkt
    ctx.strokeStyle = col('--line', '#2a323c'); ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(tx(0), 0); ctx.lineTo(tx(0), H); ctx.moveTo(0, ty(0)); ctx.lineTo(W, ty(0)); ctx.stroke(); ctx.setLineDash([]);
    // Verbindungswege — grün gestrichelt; im Verbindungs-Editiermodus mit Griffpunkten.
    const dpv = plateDragPreview;   // Live-Vorschau (Stück-Offset oder Verbindungspunkt)
    for (const cn of (showTravel ? (gc.conns || []) : [])) {
      // Beim Ziehen eines Verbindungspunkts: interior[j] → path[1+j] lokal ersetzen
      // (gc bleibt unangetastet, kein Rebuild).
      const cvOv = (dpv && dpv.type === 'cvert' && cn.idx === dpv.idx) ? dpv : null;
      const pv = i => (cvOv && i === 1 + cvOv.j) ? cvOv.pt : (cn.path || [])[i];
      const pth = cn.path || [];
      ctx.strokeStyle = cn.edited ? col('--accent2', '#ffb454') : col('--good', '#57d38c');
      ctx.lineWidth = connsActive ? 2.4 : 2; ctx.setLineDash([6, 4]); ctx.beginPath();
      for (let i = 0; i < pth.length; i++) { const q = pv(i), X = tx(q[0]), Y = ty(q[1]); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }
      ctx.stroke(); ctx.setLineDash([]);
      if (connsActive) {
        // Endpunkte (fix) klein, Interior-Stützpunkte groß + Ring (ziehen/löschen).
        ctx.fillStyle = col('--muted', '#8b98a8');
        ctx.beginPath(); ctx.arc(tx(cn.cur[0]), ty(cn.cur[1]), 3, 0, 6.3); ctx.fill();
        ctx.beginPath(); ctx.arc(tx(cn.appr[0]), ty(cn.appr[1]), 3, 0, 6.3); ctx.fill();
        for (let j = 0; j < cn.interior.length; j++) {
          const p = (cvOv && j === cvOv.j) ? cvOv.pt : cn.interior[j];
          ctx.fillStyle = col('--good', '#57d38c'); ctx.beginPath(); ctx.arc(tx(p[0]), ty(p[1]), 6, 0, 6.3); ctx.fill();
          ctx.strokeStyle = '#04121f'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(tx(p[0]), ty(p[1]), 6, 0, 6.3); ctx.stroke();
        }
      }
    }
    // Stücke: Blockrechteck + Schnittkontur (Turm-L-Pfad) + Nummer.
    const piecesActive = plateEdit && plateEditMode === 'pieces';
    for (let k = 0; k < gc.pieces.length; k++) {
      const pc = gc.pieces[k], color = segColor(pc.seg);
      // Beim Ziehen dieses Stücks: Kontur/Box lokal um (ox,oy) versetzt zeichnen.
      const po = (dpv && dpv.type === 'piece' && dpv.seg === pc.seg) ? dpv : null;
      const ox = po ? po.ox : 0, oy = po ? po.oy : 0;
      if (piecesActive) {   // aktives Ziel hervorheben (Move-Cursor-Hinweis)
        ctx.fillStyle = 'rgba(74,163,255,.10)';
        ctx.fillRect(tx(pc.bb[0] + ox), ty(pc.bb[3] + oy), (pc.bb[2] - pc.bb[0]) * sc, (pc.bb[3] - pc.bb[1]) * sc);
      }
      ctx.strokeStyle = piecesActive ? col('--accent', '#4aa3ff') : col('--muted', '#8b98a8'); ctx.lineWidth = piecesActive ? 1.4 : 1; ctx.setLineDash([4, 3]);
      ctx.strokeRect(tx(pc.bb[0] + ox), ty(pc.bb[3] + oy), (pc.bb[2] - pc.bb[0]) * sc, (pc.bb[3] - pc.bb[1]) * sc); ctx.setLineDash([]);
      // Plattenkonturen = Profil A UND Profil B (beide Plattenflächen), nicht die
      // extrapolierten Türme. B halbtransparent/dünner, damit A erkennbar bleibt.
      const drawOutline = (outline, lw, alpha) => {
        if (!outline || !outline.length) return;
        ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
        for (let i = 0; i < outline.length; i++) { const X = tx(outline[i][0] + ox), Y = ty(outline[i][1] + oy); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }
        ctx.stroke(); ctx.restore();
      };
      // Querschnitte (Sollkontur, Segmentfarbe): A kräftig, B blasser; Löcher mit.
      const hasRaw = pc.RA && pc.RA.length;
      if (hasRaw) {
        drawOutline(pc.RB, 1.1, 0.55); for (const inn of (pc.RIB || [])) drawOutline(inn, 1.1, 0.55);
        drawOutline(pc.RA, 1.6, 1);    for (const inn of (pc.RIA || [])) drawOutline(inn, 1.6, 1);
      }
      // Schnittspur = wo der Draht am Querschnitt wirklich fährt (abbrandkompensiert),
      // A durchgezogen, B gestrichelt (wie in der Segmentpaar-Ansicht).
      const drawCut = (path, dash, alpha) => {
        if (!path || !path.length) return;
        ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = col('--wire', '#ff5a3c'); ctx.lineWidth = 1.4;
        ctx.setLineDash(dash || []); ctx.beginPath();
        for (let i = 0; i < path.length; i++) { const X = tx(path[i][0] + ox), Y = ty(path[i][1] + oy); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }
        ctx.stroke(); ctx.restore();
      };
      // Abbrand in wahrer Dicke: Band (Spalt je Stirnfläche) unter die Schnittspur.
      if (hasRaw && pc.kp && window.App && App.kerfBand && App.kerfTrueOn && App.kerfTrueOn('model')) {
        const VB = { s: sc, X: x => tx(x + ox), Y: y => ty(y + oy) }, wc = col('--wire', '#ff5a3c');
        App.kerfBand(ctx, VB, [pc.PB || pc.R], { view: 'model', k: pc.kp.B, color: wc, alpha: 0.7 });
        App.kerfBand(ctx, VB, [pc.PA || pc.L], { view: 'model', k: pc.kp.A, color: wc });
      }
      if (hasRaw) { drawCut(pc.PB || pc.R, [5, 3], 0.7); drawCut(pc.PA || pc.L, null, 1); }
      else { drawOutline(pc.PB || pc.R, 1.1, 0.55); drawOutline(pc.PA || pc.L, 1.6, 1); }
      ctx.fillStyle = col('--txt', '#e6ebf1'); ctx.font = '12px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('#' + (pc.seg + 1) + ' · ' + sectionName(pc.seg) + '–' + sectionName(pc.seg + 1), tx((pc.bb[0] + pc.bb[2]) / 2 + ox), ty((pc.bb[1] + pc.bb[3]) / 2 + oy));
    }
    // Nullpunkt
    const ox = tx(0), oy = ty(0);
    ctx.strokeStyle = col('--bad', '#ff6b6b'); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(ox - 9, oy); ctx.lineTo(ox + 9, oy); ctx.moveTo(ox, oy - 9); ctx.lineTo(ox, oy + 9); ctx.stroke();
    ctx.fillStyle = col('--bad', '#ff6b6b'); ctx.font = '11px Segoe UI'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(T('Null (0,0)'), ox + 11, oy - 4);
    // Titel + Hinweis
    ctx.fillStyle = col('--txt', '#e6ebf1'); ctx.font = '12px Segoe UI'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(T('Platte — ') + gc.pieces.length + T(' Segmente · Dicke ') + gc.span.toFixed(1) + ' mm', 12, 10);
    // Statuszeile.
    ctx.fillStyle = col('--muted', '#8b98a8'); ctx.font = '11px Segoe UI'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(showTravel ? T('Verbindungen automatisch kollisionsfrei (grün); manuell bearbeitet = orange.')
                            : T('Querschnitte (Segmentfarbe) + Schnittspur (rot, abbrandkompensiert) · Fahrwege ausgeblendet („Fahrwege anzeigen").'), 12, 28);
    if (plateEdit) {
      ctx.fillStyle = col('--accent', '#4aa3ff');
      ctx.fillText(plateEditMode === 'conns' ? T('● Bearbeiten: Verbindungspfad (Punkte ziehen/hinzufügen/löschen)')
                                             : T('● Bearbeiten: Segmente ziehen'), 12, 44);
    }
    ctx.fillStyle = col('--muted', '#8b98a8'); ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.font = '11px Segoe UI';
    ctx.fillText(plateEdit ? (plateEditMode === 'conns'
                    ? T('Punkt ziehen = verschieben · auf Linie klicken = Punkt einfügen · Doppelklick = löschen')
                    : T('Stück ziehen = verschieben · Rad = Zoom'))
                           : T('Im Menü Bearbeitung wählen · Rad = Zoom · Ziehen = schwenken'), W - 12, H - 10);
    ctx.textAlign = 'left';
  }
  function plateInvScreen(mx, my) { if (!plateX) return null; return [(mx - W / 2 - plateX.px) / plateX.sc + plateX.cx, (H / 2 + plateX.py - my) / plateX.sc + plateX.cy]; }
  const plateSX = w => W / 2 + plateX.px + (w[0] - plateX.cx) * plateX.sc;
  const plateSY = w => H / 2 + plateX.py - (w[1] - plateX.cy) * plateX.sc;
  // Abstand Punkt→Strecke (Bildschirm) für „Punkt einfügen".
  function distToSeg(px, py, a, b) {
    const ax = plateSX(a), ay = plateSY(a), bx = plateSX(b), by = plateSY(b);
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / l2; t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  // Hit-Test: im Verbindungsmodus Stützpunkt/Linie, sonst Stück.
  function plateHit(mx, my) {
    if (!plateX || !plateEdit) return null;   // nur im Bearbeitungsmodus anfassbar
    if (plateEditMode === 'conns') {
      // 1) vorhandenen Stützpunkt greifen (Ziehen)
      for (const cn of plateX.conns) for (let j = 0; j < cn.interior.length; j++) {
        if (Math.hypot(mx - plateSX(cn.interior[j]), my - plateSY(cn.interior[j])) < 10)
          return { type: 'cvert', idx: cn.idx, j };
      }
      // 2) auf einem Verbindungssegment (cur..appr-Bereich) → neuen Punkt einfügen
      for (const cn of plateX.conns) {
        const chain = [cn.cur].concat(cn.interior, [cn.appr]);   // Endstück (appr→entry) nicht editierbar
        for (let s = 0; s < chain.length - 1; s++) {
          if (distToSeg(mx, my, chain[s], chain[s + 1]) < 6)
            return { type: 'cins', idx: cn.idx, at: s, world: plateInvScreen(mx, my) };
        }
      }
      return null;
    }
    // Segmente verschieben
    const p = plateInvScreen(mx, my);
    for (let k = 0; k < plateX.pieces.length; k++) {
      const bb = plateX.pieces[k].bb;
      if (p[0] >= bb[0] && p[0] <= bb[2] && p[1] >= bb[1] && p[1] <= bb[3]) return { type: 'piece', idx: k, seg: plateX.pieces[k].seg, dh: plateX.pieces[k].dh, dv: plateX.pieces[k].dv, grab: p };
    }
    return null;
  }
  // Interior-Punkte einer Verbindung (für Bearbeitung), aus plateX.
  function plateConnInterior(idx) { const cn = (plateX.conns || []).find(c => c.idx === idx); return cn ? cn.interior.map(p => p.slice()) : []; }

  function drawBBox() {
    const b = M.bbox; if (!b) return;
    const c = [[b.min[0], b.min[1], b.min[2]], [b.max[0], b.min[1], b.min[2]],
      [b.max[0], b.max[1], b.min[2]], [b.min[0], b.max[1], b.min[2]],
      [b.min[0], b.min[1], b.max[2]], [b.max[0], b.min[1], b.max[2]],
      [b.max[0], b.max[1], b.max[2]], [b.min[0], b.max[1], b.max[2]]];
    const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    ctx.strokeStyle = col('--line', '#2a323c'); ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (const e of E) { const a = scr(...c[e[0]]), z = scr(...c[e[1]]); ctx.moveTo(a.x, a.y); ctx.lineTo(z.x, z.y); }
    ctx.stroke(); ctx.setLineDash([]);
  }

  function drawPlanes() {
    const b = M.bbox, ax = M.axis; if (!b) return;
    const u = (ax + 1) % 3, w = (ax + 2) % 3;
    ctx.setLineDash([]);
    for (const p of boundaries().slice(1, -1)) {
      const corners = [];
      const c00 = []; c00[ax] = p; c00[u] = b.min[u]; c00[w] = b.min[w];
      const c10 = []; c10[ax] = p; c10[u] = b.max[u]; c10[w] = b.min[w];
      const c11 = []; c11[ax] = p; c11[u] = b.max[u]; c11[w] = b.max[w];
      const c01 = []; c01[ax] = p; c01[u] = b.min[u]; c01[w] = b.max[w];
      for (const c of [c00, c10, c11, c01]) corners.push(scr(c[0], c[1], c[2]));
      ctx.fillStyle = 'rgba(255,180,84,0.14)';
      ctx.strokeStyle = col('--accent2', '#ffb454'); ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // Namen aller Schnitte (inkl. Modellanfang/-ende) an der oberen Kante
    const bn = boundaries();
    ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    bn.forEach((p, i) => {
      const c = []; c[ax] = p; c[u] = (b.min[u] + b.max[u]) / 2; c[w] = b.max[w];
      const q = scr(c[0], c[1], c[2]);
      ctx.fillStyle = (i === 0 || i === bn.length - 1) ? col('--muted', '#8b98a8') : col('--accent2', '#ffb454');
      ctx.fillText(sectionName(i), q.x, q.y - 3);
    });
    ctx.textAlign = 'left';
  }

  function drawAxisBadge() {
    ctx.font = '11px Segoe UI'; ctx.fillStyle = col('--muted', '#8b98a8');
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(T('Schnittachse: ') + AXIS[M.axis], 12, H - 10);
  }

  function scheduleFull() { clearTimeout(redrawTimer); redrawTimer = setTimeout(draw, 60); }

  // ---------- Interaktion ----------------------------------------------
  let pairMoved = false;
  function bindCanvas() {
    if (window.ViewCube) ViewCube.attach({ canvas: () => canvas, get: () => cam, set: (y, p) => { cam.yaw = y; cam.pitch = p; }, redraw: () => draw(), rot: ViewCube.ROT_STD, k: [-0.01, -0.01],
      labels: { '+x': '+X', '-x': '−X', '+y': 'Oben', '-y': 'Unten', '+z': 'Vorne', '-z': 'Hinten' } });
    canvas.addEventListener('mousedown', e => {
      // Segmentpaar-Ansicht: Punkt ziehen (Bearbeiten) hat Vorrang vor Verschieben.
      if (M.view === 'pairs') {
        const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
        if (pairEdit) { const hit = pairNearest(mx, my); if (hit) { pairDrag = hit; return; } }
        pairMoved = false;
      }
      // Platten-Ansicht: Stück verschieben oder Verbindungs-Stützpunkt bearbeiten.
      if (M.view === 'plate') {
        const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
        const hit = plateHit(mx, my);
        if (hit && hit.type === 'cins') {   // neuen Stützpunkt auf der Linie einfügen und gleich ziehen
          const inter = plateConnInterior(hit.idx); inter.splice(hit.at, 0, [hit.world[0], hit.world[1]]);
          plateApply({ conn: { idx: hit.idx, points: inter } });
          plateDrag = { type: 'cvert', idx: hit.idx, j: hit.at }; return;
        }
        if (hit) { plateDrag = hit; return; }
      }
      dragging = true; dragMode = e.shiftKey ? 'pan' : 'orbit';
      lastX = e.clientX; lastY = e.clientY;
    });
    window.addEventListener('mousemove', e => {
      if (pairDrag && M.view === 'pairs') {
        const r = canvas.getBoundingClientRect();
        const mp = pairInv(e.clientX - r.left, e.clientY - r.top);
        if (mp) pairMovePoint(pairDrag.which, pairDrag.idx, mp);
        return;
      }
      if (plateDrag && M.view === 'plate') {
        const r = canvas.getBoundingClientRect();
        const mp = plateInvScreen(e.clientX - r.left, e.clientY - r.top);
        if (mp) {
          // Leichtgewichtige Vorschau: nur einen Offset/Punkt merken und lokal neu
          // zeichnen. Die teure Platten-Neuberechnung (buildPlatePaths) und der
          // App-Rebuild (render) laufen erst einmalig beim Loslassen (mouseup).
          if (plateDrag.type === 'piece') {
            plateDragPreview = { type: 'piece', seg: plateDrag.seg,
              ox: mp[0] - plateDrag.grab[0], oy: mp[1] - plateDrag.grab[1] };
          } else if (plateDrag.type === 'cvert') {
            plateDragPreview = { type: 'cvert', idx: plateDrag.idx, j: plateDrag.j,
              pt: [Math.round(mp[0] * 10) / 10, Math.round(mp[1] * 10) / 10] };
          }
          draw();
        }
        return;
      }
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (M.view === 'profiles' || M.view === 'pairs' || M.view === 'plate') { if (dx || dy) pairMoved = true; p2.px += dx; p2.py += dy; draw(); return; }
      if (dragMode === 'pan') { cam.px += dx; cam.py += dy; }
      else {
        cam.yaw -= dx * 0.01 * (Math.cos(cam.pitch) < 0 ? -1 : 1);   // invertiert (wie Simulator-Bedienung)
        cam.pitch -= dy * 0.01;   // keine Kipp-Begrenzung
      }
      draw();
    });
    window.addEventListener('mouseup', e => {
      if (pairDrag) { pairDrag = null; draw(); return; }
      if (plateDrag) {
        // Vorschau jetzt einmalig festschreiben → genau ein Rebuild statt pro Move.
        const pd = plateDrag, pv = plateDragPreview;
        plateDrag = null; plateDragPreview = null;
        if (pv && pv.type === 'piece') {
          plateApply({ pos: { seg: pd.seg, dh: Math.round((pd.dh + pv.ox) * 10) / 10, dv: Math.round((pd.dv + pv.oy) * 10) / 10 } });
        } else if (pv && pv.type === 'cvert') {
          const inter = plateConnInterior(pd.idx);
          if (inter[pd.j]) { inter[pd.j] = pv.pt; plateApply({ conn: { idx: pd.idx, points: inter } }); }
        } else { draw(); }
        return;
      }
      if (dragging) {
        dragging = false;
        // Segmentpaar, kein Bearbeiten, echter Klick (kein Ziehen) →
        // Eindring-/Startpunkt auf der Außenkontur setzen.
        if (M.view === 'pairs' && !pairEdit && !pairMoved && pairX) {
          const r = canvas.getBoundingClientRect();
          const pt = nearestOuterPt(e.clientX - r.left, e.clientY - r.top);
          if (pt) pairApply({ start: 'angle', startAng: Math.round(angleOfPoint(pairX.outer, pt) * 10) / 10, startPt: pt.slice() });
        }
        draw();
      }
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      if (M.view === 'profiles' || M.view === 'pairs' || M.view === 'plate') {
        p2.zoom = Math.max(0.1, Math.min(40, p2.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
        draw(); return;
      }
      cam.zoom *= e.deltaY < 0 ? 1.1 : 1 / 1.1;
      cam.zoom = Math.max(0.05, Math.min(400, cam.zoom));
      scheduleFull(); dragging = true; draw(); dragging = false;
    }, { passive: false });
    canvas.addEventListener('dblclick', e => {
      // Platte + Verbindungsmodus: Doppelklick auf Stützpunkt = löschen.
      if (M.view === 'plate' && plateEdit && plateEditMode === 'conns' && plateX) {
        const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
        for (const cn of plateX.conns) for (let j = 0; j < cn.interior.length; j++) {
          if (Math.hypot(mx - plateSX(cn.interior[j]), my - plateSY(cn.interior[j])) < 10) {
            const inter = plateConnInterior(cn.idx); inter.splice(j, 1);
            plateApply({ conn: { idx: cn.idx, points: inter } }); return;
          }
        }
      }
      if (M.view === 'profiles' || M.view === 'pairs' || M.view === 'plate') { resetProfileView(); draw(); return; }
      if (M.bbox) frameCamera(); draw();
    });
  }

  function setStdView(which) {
    if (which === 'top') { cam.yaw = 0; cam.pitch = Math.PI / 2 - 0.001; }
    else if (which === 'front') { cam.yaw = 0; cam.pitch = 0; }
    else if (which === 'side') { cam.yaw = Math.PI / 2; cam.pitch = 0; }
    else { cam.yaw = CAM0.yaw; cam.pitch = CAM0.pitch; }
    cam.px = 0; cam.py = 0; draw();
  }

  // ---------- Info-Anzeige ---------------------------------------------
  function setInfo(txt, err) {
    const el = document.getElementById('modelInfo');
    if (el) { el.textContent = txt; el.style.color = err ? 'var(--bad)' : ''; }
  }
  function updateInfo() {
    if (!M.verts) { setInfo(T('Keine Datei geladen. STL/OBJ laden.')); return; }
    const b = M.bbox;
    const dim = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map(x => x.toFixed(1)).join(' × ');
    const nseg = M.segs ? M.segs.length : 0;
    setInfo(M.name + ' · ' + M.ntri.toLocaleString() + ' ' + T('Dreiecke') + ' · ' + dim + ' mm'
      + (nseg ? ' · ' + nseg + ' ' + T('Segmente') : ''));
  }

  // ---------- Öffentliche API ------------------------------------------
  function init(opt) {
    canvas = document.getElementById(opt.canvasId);
    if (!canvas) return;
    fit(); bindCanvas();
    // Bedienleiste (auf dem Canvas)
    wireBar();
    draw();
  }
  function wireBar() {
    const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    // 3D-Standardansichten wechseln automatisch zurück in den 3D-Modus.
    bind('m3dTop', () => { M.view = '3d'; syncViewToggle(); setStdView('top'); });
    bind('m3dSide', () => { M.view = '3d'; syncViewToggle(); setStdView('side'); });
    bind('m3dFront', () => { M.view = '3d'; syncViewToggle(); setStdView('front'); });
    bind('m3dIso', () => { M.view = '3d'; syncViewToggle(); setStdView('iso'); });
    const wc = document.getElementById('m3dWire');
    if (wc) wc.onchange = () => { M.wire = wc.checked; draw(); };
    const pc = document.getElementById('m3dPlanes');
    if (pc) pc.onchange = () => { M.showPlanes = pc.checked; draw(); };
    bind('m3dViewToggle', () => { setView(M.view === 'profiles' ? '3d' : 'profiles'); });
    bind('m3dViewPairs', () => { setView(M.view === 'pairs' ? '3d' : 'pairs'); });
    bind('m3dViewPlate', () => { setView(M.view === 'plate' ? '3d' : 'plate'); });
    syncViewToggle();
  }
  function syncViewToggle() {
    const b = document.getElementById('m3dViewToggle');
    if (b) { b.textContent = T(M.view === 'profiles' ? '▦ 3D-Ansicht' : '▦ Schnittprofile'); b.classList.toggle('primary', M.view === 'profiles'); }
    const p = document.getElementById('m3dViewPairs');
    if (p) { p.textContent = T(M.view === 'pairs' ? '◫ 3D-Ansicht' : '◫ Segmentpaar'); p.classList.toggle('primary', M.view === 'pairs'); }
    const q = document.getElementById('m3dViewPlate');
    if (q) { q.textContent = T(M.view === 'plate' ? '▤ 3D-Ansicht' : '▤ Platte'); q.classList.toggle('primary', M.view === 'plate'); }
  }
  function setView(v) {
    M.view = (v === 'profiles' || v === 'pairs' || v === 'plate') ? v : '3d';
    if (M.view !== '3d') resetProfileView();
    syncViewToggle(); draw();
  }
  // Neuzeichnen anstoßen (z. B. wenn sich Segment/Parameter des Paars ändern).
  function refresh() { if (M.view === 'pairs' || M.view === 'profiles' || M.view === 'plate') draw(); }
  function resize() { fit(); draw(); }
  function show() { fit(); updateInfo(); draw(); }

  window.Model3D = {
    init, resize, show, draw,
    loadFile, segment, equalSplit, exportSegment, exportAll,
    buildSegmentPaths, baseName, ensureSegments, segCount, segStats,
    buildPlatePaths, plateLayout, segSpan,
    pairData, cutPaths, sectionName, sectionLabel, sectionInfo,   // Segmentpaar-/Schnittspur-Daten (z.B. CAD-Import)
    state: M,
    setAxis(a) { if (a !== M.axis) { M.axis = a; M.planes = []; invalidateSections(); draw(); } },
    addPlane(v) { if (M.bbox && isFinite(v)) { M.planes.push(v); invalidateSections(); draw(); } },
    // Ebene an Index i (in M.planes) auf Wert v setzen — auf Modellbereich begrenzt.
    setPlaneIndex(i, v) { if (M.bbox && M.planes[i] != null && isFinite(v)) { const lo = M.bbox.min[M.axis], hi = M.bbox.max[M.axis]; M.planes[i] = Math.max(lo + 0.01, Math.min(hi - 0.01, v)); invalidateSections(); draw(); } },
    planeIndexOf(v) { return M.planes.findIndex(x => Math.abs(x - v) < 1e-9); },
    removePlane(i) { M.planes.splice(i, 1); invalidateSections(); draw(); },
    clearPlanes() { M.planes = []; invalidateSections(); draw(); },
    // Modell komplett verwerfen (Neu-Projekt): Netz + Ebenen + Caches leeren,
    // Ansicht zurücksetzen. Zeichnet die leere Vorschau.
    reset() {
      M.verts = null; M.ntri = 0; M.bbox = null; M.name = '';
      M.planes = []; M.axis = 0; M.sel = 'all';
      M.segs = null; M.sections = null; M.profiles = null;
      M.multiCache = null; M.triIndex = null; M.cleanCache = null; M.gapTol = null;
      plateSegCache = {}; plateGcMemo = null;
      if (window.__model3dRebuildSidebar) window.__model3dRebuildSidebar();
      try { draw(); } catch (e) {}
      try { updateInfo(); } catch (e) {}
    },
    select(i) { M.sel = i; draw(); },
    setView, getView: () => M.view, refresh,
    serialize, deserialize,
    setPairEdit, isPairEdit: () => pairEdit, pairInfo: () => pairX,
    setPairTowers(on) { M.pairTowers = !!on; if (M.view === 'pairs') draw(); }, isPairTowers: () => M.pairTowers === true,
    setPlateTravel(on) { M.plateTravel = !!on; if (M.view === 'plate') draw(); }, isPlateTravel: () => M.plateTravel !== false,
    setSectionDensity(v) {
      const d = Math.max(0.2, Math.min(16, +v || 1)); if (d === M.sectionDensity) return;
      M.sectionDensity = d;
      // Nur die dichteabhängigen Schnitt-Caches verwerfen — die Mesh-Zerlegung
      // (M.segs) hängt nicht an der Punktdichte und bleibt erhalten.
      M.multiCache = null; M.sections = null; M.profiles = null;
      plateSegCache = {}; plateGcMemo = null;
      draw();
    }, getSectionDensity: () => M.sectionDensity || 1,
    setPlateEdit, isPlateEdit: () => plateEdit, setPlateEditMode, getPlateEditMode: () => plateEditMode,
    updateInfo, boundaries, hasModel: () => !!M.verts,
    // Konturmodus + Lückenweite: nur VOR dem Zerlegen änderbar (danach gesperrt,
    // bis die Zerlegung aufgehoben wird).
    isSegmented: () => !!(M.segs && M.segs.length),
    unsegment() { invalidateSections(); M.sel = 'all'; draw(); },
    getContourMode: contourMode,
    setContourMode(m) { if (M.segs && M.segs.length) return false; M.contourMode = (m === 'outer' || m === 'inner') ? m : 'both'; invalidateSections(); draw(); return true; },
    getGapTol: gapTol, getGapTolAuto: gapTolAuto, isGapTolAuto: () => M.gapTol == null,
    setGapTol(v) { if (M.segs && M.segs.length) return false; M.gapTol = (v == null || !isFinite(v)) ? null : Math.max(0, v); invalidateSections(); draw(); return true; }
  };
})();
