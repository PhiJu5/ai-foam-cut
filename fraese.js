/* fraese.js — Reiter „Fräse": 2D-CAM für eine CNC-Fräse (3 Achsen X/Y/Z) und
 * Maschinensteuerung über GRBL / grblHAL (Web Serial).
 * (Feature „fraese", optional — andere Module rufen nur geschützt.)
 *
 * KONZEPT
 *   Geometrie  : geschlossene/offene 2D-Konturen aus einer DXF-Datei oder aus dem
 *                CAD-Reiter (Auswahl oder alles). Jede Kontur wird ein „Job".
 *   Bearbeitung: je Job eine Operation —
 *                  out    = Außenkontur (Fräser läuft außen an der Kontur entlang)
 *                  in     = Innenkontur / Ausschnitt (Fräser innen)
 *                  on     = auf der Linie (kein Versatz; Gravur, offene Bahnen)
 *                  pocket = Tasche (Fläche innerhalb der Kontur ausräumen)
 *                  drill  = Bohren im Mittelpunkt der Kontur (Kreise)
 *                Werkzeugradius-Korrektur über Polygon-Offset (cadOffsetLoop),
 *                Zustellung in Tiefenschritten, Haltestege (Tabs) an Außen-/Innen-
 *                konturen, Gleich-/Gegenlauf über die Umlaufrichtung.
 *   G-Code     : GRBL-kompatibel (G21 G90 G17, G0/G1, M3 S / M5), Bögen werden
 *                als Polylinien ausgegeben. Kommentare mit ';'.
 *   Maschine   : eigene GRBL-Verbindung (unabhängig vom Heißdraht-Pendant):
 *                DRO X/Y/Z, Handfahrt (XY-Kreuz + Z), Referenzfahrt, Nullpunkt
 *                (XYZ / nur Z / Z-Taster), Spindel, Overrides, Programmlauf mit
 *                Live-Markierung, Konsole, NOT-HALT, $$-Einstellungsfenster.
 *   Vorschau   : Draufsicht (Canvas) mit Konturen, Fräsbahnen (Farbe = Tiefe),
 *                Eilgängen, Haltestegen, Arbeitsraum, Werkzeugmarke; Trockenlauf-
 *                Simulation; beim echten Lauf folgt die Marke der Maschinen-
 *                position.
 *
 * Koordinaten: X rechts, Y nach hinten (Draufsicht), Z hoch; Z=0 = Werkstück-
 * oberkante, Fräsen in negatives Z.
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;
  const { grp, hint, subhead, numRow, boolRow, selectRow, txtRow, mkMini, buildSidebar } = App;
  const $ = s => document.querySelector(s);

  // ---------- Konfiguration (state.cfg.fr*) -------------------------------
  const DEF = {
    frJobs: [],                // [{id,name,pts:[[x,y]..],closed,op,depth,on,part}]
    frParts: [],               // Teile: [{id,name,matId,thk,plate}] — eine Außenkontur + ihre Innenkonturen
    frPlates: [],              // Werkstoffplatten: [{id,name,matId,thk,w,h}]
    frPlateId: '',             // aktive Platte ('' = Teile ohne Platte)
    frPlateW: 300, frPlateH: 200, // Standardgröße neuer Platten mm
    frGap: 6,                  // Abstand zwischen Teilen beim Anordnen mm (zusätzlich zum Fräser-Ø)
    frOver: 0.3,               // Durchbruch-Zugabe: Tiefe = Plattenstärke + Zugabe
    frDrag: true,              // Teile in der Vorschau mit der Maus verschieben
    frOrigin: 'min',           // 'asis' | 'min' | 'center'  (Nullpunkt-Lage)
    frTool: 3,                 // Fräserdurchmesser mm
    frRpm: 12000,              // Spindeldrehzahl
    frFeed: 600,               // Vorschub XY mm/min
    frPlunge: 200,             // Eintauch-Vorschub Z mm/min
    frSafeZ: 5,                // Sicherheitshöhe mm
    frDepth: 5,                // Gesamttiefe mm (positiv)
    frStep: 2,                 // Zustellung je Durchgang mm
    frDir: 'climb',            // 'climb' Gleichlauf | 'conv' Gegenlauf
    frPocketOv: 45,            // Tasche: seitliche Zustellung in % des Durchmessers
    frTabs: 0,                 // Haltestege je Kontur (0 = keine)
    frTabW: 5,                 // Stegbreite mm
    frTabH: 1.5,               // Steghöhe mm (über Tiefe)
    frDrillPeck: 0,            // Bohren: Spanbruchschritt mm (0 = in einem Zug)
    frRetract: true,           // am Ende auf Nullpunkt (XY) zurück
    frEntry: 'plunge',         // Eintauchen: 'plunge' senkrecht | 'ramp' Rampe | 'helix' (Taschen; sonst Rampe)
    frRampAng: 3,              // Rampenwinkel Grad
    frFinish: 0,               // Schlichtaufmaß mm (0 = kein Schlichtdurchgang)
    frArcs: true,              // Kreisbögen als G2/G3 ausgeben
    frSel: -1,                 // markierter Job (Vorschau)
    frMatId: '', frToolId: '', // gewählter Werkstoff / Fräser aus der Datenbank ('' = manuell)
    // Werkstoff-/Fräser-Datenbank (Einstellungen, nicht Projekt)
    frMats: [],                // [{id,name}]
    frTools: [],               // [{id,name,type,dia}]
    frCut: {},                 // { '<matId>|<toolId>': {frRpm,frFeed,frPlunge,frStep,frPocketOv,frDrillPeck,frDir} }
    // Maschine (Einstellungen, nicht Projekt)
    frMaxX: 0, frMaxY: 0, frMaxZ: 0, frMaxFeed: 0,
    frBaud: 115200,
    frProbeThk: 10,            // Dicke des Tastplättchens mm
    frProbeDist: 30,           // max. Tastweg nach unten mm
    frProbeFeed: 60            // Tastvorschub mm/min
  };
  const MACHINE = ['frMaxX', 'frMaxY', 'frMaxZ', 'frMaxFeed', 'frBaud', 'frProbeThk', 'frProbeDist', 'frProbeFeed', 'frMats', 'frTools', 'frCut'];
  // Maschinenwerte gehören zu den Einstellungen (nicht ins Projekt).
  if (Array.isArray(App.MACHINE_KEYS)) MACHINE.forEach(k => { if (App.MACHINE_KEYS.indexOf(k) < 0) App.MACHINE_KEYS.push(k); });
  function C(k) {
    if (state.cfg[k] == null) {
      const d = DEF[k];
      state.cfg[k] = (d && typeof d === 'object') ? JSON.parse(JSON.stringify(d)) : d;
    }
    return state.cfg[k];
  }
  function S(k, v) { state.cfg[k] = v; }
  function jobs() { const a = C('frJobs'); if (!Array.isArray(a)) S('frJobs', []); return C('frJobs'); }
  function parts() { const a = C('frParts'); if (!Array.isArray(a)) S('frParts', []); return C('frParts'); }
  function plates() { const a = C('frPlates'); if (!Array.isArray(a)) S('frPlates', []); return C('frPlates'); }
  function partOf(j) { return j && j.part ? parts().find(p => p.id === j.part) || null : null; }
  function curPlate() { const id = C('frPlateId'); return plates().find(p => p.id === id) || null; }
  // Sichtbar/aktiv = Job eingeschaltet und sein Teil liegt auf der aktiven Platte
  // ('' = Teile ohne Platte). Nur sichtbare Jobs kommen in Vorschau und G-Code.
  function onPlate(j) { const p = partOf(j); return ((p && p.plate) || '') === (C('frPlateId') || ''); }
  function vis(j) { return !!j.on && onPlate(j); }

  // ---------- Werkstoff-/Fräser-Datenbank ------------------------------------
  // Schnittwerte werden je Paar (Werkstoff, Fräser) gespeichert. Ist ein Paar
  // gewählt, werden die Werte in die aktiven frXxx-Felder übernommen und jede
  // Änderung dort landet auch wieder in der Datenbank. Ohne Auswahl = manuell.
  const TOOL_TYPES = [['flat', 'Schaftfräser'], ['single', 'Einschneider'], ['ball', 'Kugelfräser'], ['vbit', 'V-Fräser / Gravierstichel'], ['drill', 'Bohrer'], ['other', 'Sonstiges']];
  const CUT_KEYS = ['frRpm', 'frFeed', 'frPlunge', 'frStep', 'frPocketOv', 'frDrillPeck', 'frDir'];
  let cutFresh = '';   // Schlüssel eines gerade aus den aktuellen Werten neu angelegten DB-Eintrags (Hinweis)
  function dbMats() { const a = C('frMats'); if (!Array.isArray(a)) S('frMats', []); return C('frMats'); }
  function dbTools() { const a = C('frTools'); if (!Array.isArray(a)) S('frTools', []); return C('frTools'); }
  function dbCut() { const o = C('frCut'); if (!o || typeof o !== 'object' || Array.isArray(o)) S('frCut', {}); return C('frCut'); }
  function curMat() { const id = C('frMatId'); return dbMats().find(m => m.id === id) || null; }
  function curTool() { const id = C('frToolId'); return dbTools().find(t => t.id === id) || null; }
  function cutKey() { const m = curMat(), t = curTool(); return (m && t) ? m.id + '|' + t.id : ''; }
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function typeName(ty) { const e = TOOL_TYPES.find(x => x[0] === ty); return T(e ? e[1] : 'Sonstiges'); }
  function toolLabel(t) { return (t.name ? t.name + ' · ' : '') + 'Ø' + (+t.dia || 0) + ' mm · ' + typeName(t.type); }
  function saveDb() { if (typeof App.saveSettings === 'function') try { App.saveSettings(); } catch (e) {} }
  // Nach einer Auswahl: Fräser-Ø und (falls vorhanden) die Schnittwerte des Paars
  // in die aktiven Felder übernehmen. Gibt es für das Paar noch keinen Eintrag,
  // wird er aus den aktuellen Werten angelegt (Startpunkt zum Anpassen).
  function applyDb() {
    const t = curTool(); if (t && +t.dia > 0) S('frTool', +t.dia);
    const k = cutKey(); if (!k) return;
    const db = dbCut(); let e = db[k];
    if (!e) { e = db[k] = {}; CUT_KEYS.forEach(kk => e[kk] = C(kk)); cutFresh = k; }
    else CUT_KEYS.forEach(kk => { if (e[kk] != null) S(kk, e[kk]); });
    saveDb();
  }
  // Schnittwert setzen: aktiv + (bei gewähltem Paar) in der Datenbank.
  function setCut(k, v) {
    S(k, v); const key = cutKey();
    if (key) { const db = dbCut(); (db[key] = db[key] || {})[k] = v; if (cutFresh === key) cutFresh = ''; saveDb(); }
  }
  function addMat() { const m = { id: uid('m'), name: T('Werkstoff') + ' ' + (dbMats().length + 1) }; dbMats().push(m); S('frMatId', m.id); applyDb(); }
  function delMat() {
    const m = curMat(); if (!m) return;
    if (!confirm(T('Werkstoff löschen?') + ' ' + m.name + '\n' + T('Alle Schnittwerte dieses Werkstoffs gehen verloren.'))) return;
    S('frMats', dbMats().filter(x => x.id !== m.id)); const db = dbCut();
    Object.keys(db).forEach(k => { if (k.split('|')[0] === m.id) delete db[k]; });
    S('frMatId', ''); saveDb();
  }
  function addTool() { const t = { id: uid('t'), name: '', type: 'flat', dia: +C('frTool') || 3 }; dbTools().push(t); S('frToolId', t.id); applyDb(); }
  function delTool() {
    const t = curTool(); if (!t) return;
    if (!confirm(T('Fräser löschen?') + ' ' + toolLabel(t) + '\n' + T('Alle Schnittwerte dieses Fräsers gehen verloren.'))) return;
    S('frTools', dbTools().filter(x => x.id !== t.id)); const db = dbCut();
    Object.keys(db).forEach(k => { if (k.split('|')[1] === t.id) delete db[k]; });
    S('frToolId', ''); saveDb();
  }
  const OPS = [['out', 'Außenkontur'], ['in', 'Innenkontur / Ausschnitt'], ['on', 'Auf der Linie'], ['pocket', 'Tasche ausräumen'], ['island', 'Insel (in Tasche stehen lassen)'], ['drill', 'Bohren (Mittelpunkt)']];
  const OP_SHORT = { out: 'außen', in: 'innen', on: 'Linie', pocket: 'Tasche', island: 'Insel', drill: 'Bohr.' };
  const RANK = { drill: 0, island: 1, pocket: 1, in: 2, on: 3, out: 4 };
  let jobSeq = 1;

  // ---------- Geometrie-Helfer ----------------------------------------------
  const polyArea = p => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; } return a / 2; };
  function pointInPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  function pathLen(P, closed) { let L = 0; for (let i = 0; i < P.length - (closed ? 0 : 1); i++) { const q = P[(i + 1) % P.length]; L += Math.hypot(q.x - P[i].x, q.y - P[i].y); } return L; }
  function bboxOf(list) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    list.forEach(p => { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; });
    return isFinite(x0) ? { x0, y0, x1, y1 } : null;
  }
  function dedupe(pts, closed) {
    const out = [];
    pts.forEach(p => { if (!out.length || Math.hypot(p.x - out[out.length - 1].x, p.y - out[out.length - 1].y) > 1e-6) out.push({ x: p.x, y: p.y }); });
    if (closed && out.length > 2 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < 1e-6) out.pop();
    return out;
  }
  // Kreisprüfung: alle Punkte gleich weit vom Schwerpunkt (±2 %).
  function circleInfo(P) {
    if (P.length < 8) return null;
    let cx = 0, cy = 0; P.forEach(p => { cx += p.x; cy += p.y; }); cx /= P.length; cy /= P.length;
    let rMin = Infinity, rMax = 0;
    P.forEach(p => { const r = Math.hypot(p.x - cx, p.y - cy); if (r < rMin) rMin = r; if (r > rMax) rMax = r; });
    if (rMax < 1e-6 || (rMax - rMin) / rMax > 0.02) return null;
    return { cx, cy, r: (rMin + rMax) / 2 };
  }
  // Polygon-Offset über den CAD-Editor (rundet Ecken über Schnittpunkte, ent-
  // fernt Schleifen). d > 0 = nach links der Laufrichtung. Für CCW-Konturen ist
  // links = innen.
  function offsetClosed(P, d) {
    if (!App.cadOffsetLoop) return null;
    const loop = P.map(p => ({ x: p.x, y: p.y })); loop.closed = true;
    const r = App.cadOffsetLoop(loop, d);
    return r && r.length >= 3 ? r.map(p => ({ x: p.x, y: p.y })) : null;
  }
  function ccw(P) { return polyArea(P) >= 0 ? P.slice() : P.slice().reverse(); }

  // ---------- Jobs aus Geometrie --------------------------------------------
  function addJobsFromLoops(loops, label) {
    const J = jobs();
    const closedIdx = [];
    const news = [];
    loops.forEach((loop, i) => {
      const pts = dedupe(loop, loop.closed);
      if (pts.length < 2) return;
      const closed = !!loop.closed && pts.length >= 3;
      const j = { id: jobSeq++, name: loop.jobName || ((loop.name || label || 'Kontur') + ' ' + (i + 1)), pts: pts.map(p => [+p.x.toFixed(4), +p.y.toFixed(4)]), closed, op: closed ? 'out' : 'on', depth: null, on: true };
      news.push(j); if (closed) closedIdx.push(news.length - 1);
    });
    // Verschachtelung: Kontur innerhalb einer anderen -> Innenkontur; kleine Kreise -> Bohren.
    closedIdx.forEach(a => {
      const A = P(news[a]);
      const inside = closedIdx.some(b => b !== a && pointInPoly(A[0], P(news[b])) && Math.abs(polyArea(P(news[b]))) > Math.abs(polyArea(A)));
      if (inside) news[a].op = 'in';
      const ci = circleInfo(A);
      if (ci && ci.r * 2 <= C('frTool') * 1.05) news[a].op = 'drill';
    });
    // Reihenfolge: Bohren, Taschen, Innen, Linie, Außen (Außenkontur zuletzt).
    news.sort((a, b) => RANK[a.op] - RANK[b.op]);
    groupIntoParts(news);
    news.forEach(j => J.push(j));
    return news.length;
  }
  const P = j => j.pts.map(q => ({ x: q[0], y: q[1] }));

  // ---------- Teile (Außenkontur + zugehörige Innenkonturen) ------------------
  // Jede geschlossene Kontur, die in keiner anderen liegt, wird ein Teil; alles,
  // was innerhalb liegt (Löcher, Taschen, Gravurlinien), gehört zu diesem Teil.
  // Offene Konturen außerhalb jeder Fläche werden eigene Teile.
  function groupIntoParts(list) {
    const closed = list.filter(j => j.closed).map(j => ({ j, pts: P(j), area: Math.abs(polyArea(P(j))) }));
    const enclosing = j => {
      const pts = P(j); if (!pts.length) return null;
      const own = j.closed ? Math.abs(polyArea(pts)) : -1;
      let best = null;
      closed.forEach(c => { if (c.j === j || c.area <= own) return; if (pointInPoly(pts[0], c.pts) && (!best || c.area < best.area)) best = c; });
      return best ? best.j : null;
    };
    const root = j => { let cur = j, n = 0; for (;;) { const e = enclosing(cur); if (!e || n++ > 50) return cur; cur = e; } };
    const made = new Map();
    list.forEach(j => {
      const r = root(j);
      if (!made.has(r)) {
        const p = { id: uid('p'), name: r.name || T('Teil'), matId: C('frMatId') || '', thk: null, plate: '' };
        parts().push(p); made.set(r, p);
      }
      j.part = made.get(r).id;
    });
  }
  // Altstände: Jobs ohne Teil nachträglich zu Teilen gruppieren; leere Teile entfernen.
  function ensureParts() {
    const orphans = jobs().filter(j => !j.part || !partOf(j));
    if (orphans.length) groupIntoParts(orphans);
    const used = new Set(jobs().map(j => j.part));
    const pl = parts(); for (let i = pl.length - 1; i >= 0; i--) if (!used.has(pl[i].id)) pl.splice(i, 1);
  }
  const jobsOfPart = id => jobs().filter(j => j.part === id);
  function partBbox(id) { const all = []; jobsOfPart(id).forEach(j => P(j).forEach(p => all.push(p))); return bboxOf(all); }
  function movePart(id, dx, dy) { jobsOfPart(id).forEach(j => { j.pts = j.pts.map(q => [+(q[0] + dx).toFixed(4), +(q[1] + dy).toFixed(4)]); }); }
  // Drehen um den Mittelpunkt des Teils (Grad, mathematisch positiv).
  function rotatePart(id, deg) {
    const b = partBbox(id); if (!b) return;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    jobsOfPart(id).forEach(j => { j.pts = j.pts.map(q => { const x = q[0] - cx, y = q[1] - cy; return [+(cx + x * c - y * s).toFixed(4), +(cy + x * s + y * c).toFixed(4)]; }); });
  }
  // Drehen um einen beliebigen Punkt, ausgehend von gesicherten Ausgangspunkten
  // (für das Maus-Drehen: keine Rundungsdrift bei vielen kleinen Schritten).
  function setPartRotated(id, orig, deg, cx, cy) {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    jobsOfPart(id).forEach(j => { const o = orig.get(j); if (!o) return; j.pts = o.map(q => { const x = q[0] - cx, y = q[1] - cy; return [+(cx + x * c - y * s).toFixed(4), +(cy + x * s + y * c).toFixed(4)]; }); });
  }
  function delPart(id) { S('frJobs', jobs().filter(j => j.part !== id)); S('frParts', parts().filter(p => p.id !== id)); }
  function partKey(p) { return (p.matId || '') + '|' + (p.thk > 0 ? +p.thk : ''); }
  function matName(id) { const m = dbMats().find(x => x.id === id); return m ? (m.name || '?') : ''; }
  function plateLabel(pl) { return (pl.name || T('Platte')) + ' · ' + (matName(pl.matId) || T('ohne Werkstoff')) + (pl.thk > 0 ? ' ' + pl.thk + ' mm' : '') + ' · ' + (+pl.w || 0) + '×' + (+pl.h || 0); }

  // ---------- Anordnen (Nesting) ------------------------------------------------
  // Bottom-Left-Packer über die Umriss-Rechtecke: jedes Teil wird (0°/90°) an die
  // Stelle gelegt, die den geringsten Höhenzuwachs bringt (dann möglichst weit links).
  // Kandidaten sind die Plattenecke sowie rechts neben und oberhalb jedes schon
  // gelegten Teils. Mehrere Sortierungen werden probiert, das dichteste Ergebnis
  // (meiste Teile, kleinste belegte Fläche) gewinnt. Abstand = Fräser-Ø + frGap,
  // Rand = Fräserradius + frGap. Rückgabe: Platzierungen + Rest.
  function nestParts(ids, W, H) {
    const tool = Math.max(0.1, +C('frTool')), gap = Math.max(0, +C('frGap')) + tool, margin = tool / 2 + Math.max(0, +C('frGap'));
    const items = ids.map(id => { const b = partBbox(id); return b ? { id, w: b.x1 - b.x0, h: b.y1 - b.y0 } : null; }).filter(Boolean);
    const usableW = (W > 0 ? W : Infinity) - 2 * margin, usableH = (H > 0 ? H : Infinity) - 2 * margin;
    const EPS = 1e-6;
    const orders = [
      (a, b) => b.w * b.h - a.w * a.h,
      (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h),
      (a, b) => Math.min(b.w, b.h) - Math.min(a.w, a.h) || Math.max(b.w, b.h) - Math.max(a.w, a.h),
      (a, b) => b.w - a.w || b.h - a.h,
      (a, b) => b.h - a.h || b.w - a.w,
    ];
    const pack = list => {
      const placed = [], rest = [], rects = [];
      let usedH = 0, usedW = 0;
      const free = (x, y, w, h) => {
        if (x < -EPS || y < -EPS || x + w > usableW + EPS || y + h > usableH + EPS) return false;
        for (const r of rects) if (x < r.x + r.w + gap - EPS && x + w + gap > r.x + EPS && y < r.y + r.h + gap - EPS && y + h + gap > r.y + EPS) return false;
        return true;
      };
      list.forEach(it => {
        const cands = [[0, 0]];
        rects.forEach(r => { cands.push([r.x + r.w + gap, r.y]); cands.push([r.x, r.y + r.h + gap]); cands.push([r.x + r.w + gap, 0]); cands.push([0, r.y + r.h + gap]); });
        let best = null;
        [[it.w, it.h, 0], [it.h, it.w, 90]].forEach(([w, h, rot]) => {
          if (rot && Math.abs(w - h) < EPS) return;
          cands.forEach(([x, y]) => {
            if (!free(x, y, w, h)) return;
            // Bewertung: belegte Höhe, dann belegte Breite, dann tief/links
            const nh = Math.max(usedH, y + h), nw = Math.max(usedW, x + w);
            const score = nh * 1e6 + nw * 1e3 + y + x * 1e-3;
            if (!best || score < best.score) best = { x, y, w, h, rot, score };
          });
        });
        if (!best) { rest.push(it.id); return; }
        rects.push(best); placed.push({ id: it.id, x: margin + best.x, y: margin + best.y, rot: best.rot });
        usedH = Math.max(usedH, best.y + best.h); usedW = Math.max(usedW, best.x + best.w);
      });
      return { placed, rest, area: usedW * usedH };
    };
    let bestR = null;
    orders.forEach(cmp => {
      const r = pack(items.slice().sort(cmp));
      if (!bestR || r.placed.length > bestR.placed.length || (r.placed.length === bestR.placed.length && r.area < bestR.area - EPS)) bestR = r;
    });
    return { placed: bestR.placed, rest: bestR.rest };
  }
  function applyPlacement(pl) {
    if (pl.rot) rotatePart(pl.id, pl.rot);
    const b = partBbox(pl.id); if (!b) return;
    movePart(pl.id, pl.x - b.x0, pl.y - b.y0);
  }
  // Teile der aktiven Platte (bzw. ohne Platte) neu anordnen.
  function nestActive() {
    ensureParts();
    const pl = curPlate();
    const ids = parts().filter(p => ((p.plate || '') === (C('frPlateId') || ''))).map(p => p.id);
    if (!ids.length) { alert(T('Keine Teile auf dieser Platte.')); return; }
    const W = pl ? +pl.w : +C('frPlateW'), H = pl ? +pl.h : +C('frPlateH');
    const r = nestParts(ids, W, H);
    r.placed.forEach(applyPlacement);
    if (r.rest.length) {
      // Nicht passende Teile rechts neben die Platte legen, damit sie sichtbar bleiben.
      let x = (W > 0 ? W : 0) + 20;
      r.rest.forEach(id => { const b = partBbox(id); if (!b) return; movePart(id, x - b.x0, -b.y0); x += b.x1 - b.x0 + 10; });
      alert(r.rest.length + T(' Teil(e) passen nicht auf die Platte und liegen rechts daneben. Größere Platte wählen oder „Automatisch auf Platten verteilen“.'));
    }
    afterGeom(r.placed.length + T(' Teile angeordnet.'));
  }
  function newPlate(matId, thk, name) {
    const n = plates().length + 1;
    const pl = { id: uid('b'), name: name || (T('Platte') + ' ' + n), matId: matId || '', thk: thk > 0 ? +thk : null, w: +C('frPlateW') || 300, h: +C('frPlateH') || 200 };
    plates().push(pl); return pl;
  }
  // Alle Teile nach Werkstoff + Stärke gruppieren und auf Platten verteilen: vor-
  // handene Platten mit passendem Werkstoff/Stärke werden zuerst gefüllt, danach
  // neue Platten in Standardgröße angelegt, bis alle Teile liegen.
  function distributeAll() {
    ensureParts();
    if (!parts().length) { alert(T('Keine Teile vorhanden.')); return; }
    const groups = {}; parts().forEach(p => (groups[partKey(p)] = groups[partKey(p)] || []).push(p));
    let placedN = 0, first = '';
    Object.keys(groups).forEach(k => {
      const g = groups[k], matId = g[0].matId || '', thk = g[0].thk;
      let rest = g.map(p => p.id);
      const cands = plates().filter(pl => partKey(pl) === k);
      let ci = 0, guard = 0;
      while (rest.length && guard++ < 200) {
        let pl = cands[ci++];
        if (!pl) { pl = newPlate(matId, thk, T('Platte') + ' ' + (plates().length + 1)); cands.push(pl); }
        const r = nestParts(rest, +pl.w, +pl.h);
        if (!r.placed.length) {   // Teil größer als die Platte: trotzdem hier ablegen, Hinweis
          const id = rest.shift(); const p = parts().find(x => x.id === id); p.plate = pl.id;
          const b = partBbox(id); if (b) movePart(id, -b.x0, -b.y0);
          alert(T('Teil „') + p.name + T('“ ist größer als die Platte ') + pl.name + '.');
          continue;
        }
        r.placed.forEach(x => { applyPlacement(x); parts().find(p => p.id === x.id).plate = pl.id; placedN++; });
        rest = r.rest;
        if (!first) first = pl.id;
      }
    });
    if (first) selectPlate(first);
    afterGeom(placedN + T(' Teile auf ') + plates().length + T(' Platte(n) verteilt.'));
  }
  // Platte aktiv schalten: Werkstoff und Frästiefe (Stärke + Zugabe) übernehmen.
  function selectPlate(id) {
    S('frPlateId', id || '');
    const pl = curPlate();
    if (pl) {
      if (pl.matId && dbMats().some(m => m.id === pl.matId)) { S('frMatId', pl.matId); applyDb(); }
      if (pl.thk > 0) S('frDepth', +(+pl.thk + Math.max(0, +C('frOver') || 0)).toFixed(3));
    }
    S('frSel', -1); view = null;
  }
  function delPlate(id) {
    const pl = plates().find(p => p.id === id); if (!pl) return;
    if (!confirm(T('Platte löschen?') + ' ' + pl.name + '\n' + T('Die Teile bleiben erhalten (ohne Platte).'))) return;
    parts().forEach(p => { if (p.plate === id) p.plate = ''; });
    S('frPlates', plates().filter(p => p.id !== id));
    if (C('frPlateId') === id) selectPlate('');
  }

  function importDxfText(text, name) {
    if (!window.Dxf) { alert(T('DXF-Modul nicht verfügbar.')); return; }
    let d; try { d = Dxf.parse(text); } catch (e) { alert(T('DXF konnte nicht gelesen werden: ') + e.message); return; }
    const loops = [];
    d.order.forEach(ln => (d.layers[ln] || []).forEach(l => { const c = l.slice(); c.closed = l.closed; c.name = ln; loops.push(c); }));
    const n = addJobsFromLoops(loops, (name || 'DXF').replace(/\.dxf$/i, ''));
    afterGeom(n + T(' Konturen aus DXF übernommen.'));
  }
  function importDxfFile() {
    const handler = f => { const rd = new FileReader(); rd.onload = () => importDxfText(String(rd.result), f.name); rd.readAsText(f); };
    if (App.loadFileVia) App.loadFileVia({ 'application/dxf': ['.dxf'] }, handler, 'fileFraeseDxf', 'ldDxf');
    else { const inp = document.getElementById('fileFraeseDxf'); if (inp) inp.click(); }
  }
  function importFromCad(selOnly) {
    const d = state.cad; if (!d || !d.layers) { alert(T('Kein CAD-Inhalt vorhanden.')); return; }
    const loops = [];
    const sel = (d.edit && d.edit.sel) || [];
    if (selOnly && !sel.length) { alert(T('Im CAD-Reiter ist nichts ausgewählt.')); return; }
    if (selOnly) sel.forEach(s => { const l = d.layers[s.layer] && d.layers[s.layer][s.idx]; if (l) { const c = l.slice(); c.closed = l.closed; c.name = s.layer; loops.push(c); } });
    else d.order.forEach(ln => { if (d.layerHidden && d.layerHidden[ln]) return; (d.layers[ln] || []).forEach(l => { const c = l.slice(); c.closed = l.closed; c.name = ln; loops.push(c); }); });
    if (!loops.length) { alert(T('Keine Konturen im CAD-Reiter.')); return; }
    const n = addJobsFromLoops(loops, 'CAD');
    afterGeom(n + T(' Konturen aus dem CAD-Reiter übernommen.'));
  }
  // Rippen aus dem Rippendesigner: Umriss je Rippe (Außenkontur) und optional
  // die Holmausschnitte (Innenkontur), im Raster nebeneinander gelegt.
  function importFromRibs(withSpars) {
    if (!App.ribStations || !App.ribOutline) { alert(T('Rippendesigner nicht verfügbar.')); return; }
    if (!App.wing || !App.wing.cuts || !App.wing.cuts.length) { alert(T('Keine Tragfläche/Rippen vorhanden.')); return; }
    const list = (App.ribStations() || {}).list || [];
    if (!list.length) { alert(T('Keine Rippen.')); return; }
    const baked = list.map((st, idx) => {
      const o = App.ribOutline(st);
      const xs = o.pts.map(p => p.x), ys = o.pts.map(p => p.y);
      const minx = Math.min.apply(null, xs), maxx = Math.max.apply(null, xs), miny = Math.min.apply(null, ys), maxy = Math.max.apply(null, ys);
      const spars = [];
      if (withSpars && App.sparAppliesTo) (state.spars || []).forEach(sp => {
        try {
          if (!App.sparAppliesTo(sp, st.seg)) return;
          const fl = App.sparFromLE(sp, st.seg, 'root') + (App.sparFromLE(sp, st.seg, 'tip') - App.sparFromLE(sp, st.seg, 'root')) * st.t;
          const g = App.sparOnProfile(sp, o.pts, null, fl, App.sparYc(sp), st.t < 0.5 ? 'root' : 'tip', App.sparCoreFromSheet(o.pts, App.ribSheet(st, idx)));
          App.sparPolys(g).forEach(pl => spars.push(pl));
        } catch (e) {}
      });
      return { outer: o.pts, spars, w: maxx - minx, h: maxy - miny, minx, miny };
    });
    const cols = Math.max(1, Math.ceil(Math.sqrt(baked.length)));
    const cellW = Math.max.apply(null, baked.map(r => r.w)) + 15, cellH = Math.max.apply(null, baked.map(r => r.h)) + 15;
    const loops = [];
    baked.forEach((r, i) => {
      const ox = (i % cols) * cellW - r.minx, oy = -Math.floor(i / cols) * cellH - r.miny;
      const tr = p => ({ x: p.x + ox, y: p.y + oy });
      const L = r.outer.map(tr); L.closed = true; L.jobName = T('Rippe') + ' ' + (i + 1); loops.push(L);
      r.spars.forEach((sp, k) => { const H = sp.map(tr); H.closed = true; H.jobName = T('Rippe') + ' ' + (i + 1) + ' · ' + T('Holm') + ' ' + (k + 1); loops.push(H); });
    });
    const n = addJobsFromLoops(loops, 'Rippe');
    afterGeom(n + T(' Konturen aus dem Rippendesigner übernommen.'));
  }
  function afterGeom(msg) { view = null; S('frSel', -1); regen(); buildSidebar(); draw(); if (App.toast) App.toast(msg); }
  function clearJobs() { if (!jobs().length || !confirm(T('Alle Konturen/Jobs entfernen?'))) return; S('frJobs', []); S('frParts', []); afterGeom(T('Geleert.')); }

  // Nullpunkt-Verschiebung: Geometrie so verschieben, dass der Nullpunkt an der
  // gewählten Stelle liegt (nur Anzeige/G-Code, die Jobs bleiben unverändert).
  function originShift() {
    if (curPlate()) return { x: 0, y: 0 };   // Platte: Nullpunkt = Plattenecke links unten
    const all = []; jobs().forEach(j => { if (vis(j)) P(j).forEach(p => all.push(p)); });
    const b = bboxOf(all); if (!b) return { x: 0, y: 0 };
    const o = C('frOrigin');
    // „links unten": Nullpunkt an der Ecke der FRÄSBAHN — bei Außenkonturen
    // liegt die Bahn um den Fräserradius außerhalb der Geometrie.
    const r = jobs().some(j => vis(j) && j.op === 'out' && j.closed) ? Math.max(0.1, +C('frTool')) / 2 + Math.max(0, +C('frFinish') || 0) : 0;
    if (o === 'min') return { x: -(b.x0 - r), y: -(b.y0 - r) };
    if (o === 'center') return { x: -(b.x0 + b.x1) / 2, y: -(b.y0 + b.y1) / 2 };
    return { x: 0, y: 0 };
  }

  // ---------- CAM: Bahnen + G-Code ------------------------------------------
  // Ergebnis: { text, lines, segs:[{x0,y0,z0,x1,y1,z1,rapid,line,job}], paths (je Job Bahn-
  // Polygone für die Vorschau), bbox, len, time, warn[] }
  let cam = null;
  function regen() { cam = buildCam(); updateInfo(); }

  // Parameter je Job: eigener Fräser (job.toolId) -> Ø und, falls in der DB
  // vorhanden, die Schnittwerte für (Werkstoff, Fräser); sonst die globalen Werte.
  function jobParams(job) {
    const g = { tool: Math.max(0.1, +C('frTool')), feed: Math.max(1, +C('frFeed')), plunge: Math.max(1, +C('frPlunge')),
      step: Math.max(0.01, +C('frStep')), rpm: Math.max(0, Math.round(+C('frRpm'))), climb: C('frDir') !== 'conv',
      ovPct: (+C('frPocketOv') || 45), peck: Math.max(0, +C('frDrillPeck')), toolId: C('frToolId') || '', toolName: '' };
    const t0 = curTool(); if (t0) g.toolName = toolLabel(t0);
    if (job && job.toolId && job.toolId !== g.toolId) {
      const t = dbTools().find(x => x.id === job.toolId);
      if (t) {
        g.toolId = t.id; g.toolName = toolLabel(t); if (+t.dia > 0) g.tool = +t.dia;
        const m = curMat(), e = m && dbCut()[m.id + '|' + t.id];
        if (e) {
          if (+e.frFeed > 0) g.feed = +e.frFeed; if (+e.frPlunge > 0) g.plunge = +e.frPlunge; if (+e.frStep > 0) g.step = +e.frStep;
          if (e.frRpm != null) g.rpm = Math.max(0, Math.round(+e.frRpm)); if (e.frDir) g.climb = e.frDir !== 'conv';
          if (+e.frPocketOv > 0) g.ovPct = +e.frPocketOv; if (e.frDrillPeck != null) g.peck = Math.max(0, +e.frDrillPeck);
        }
      }
    }
    g.r = g.tool / 2; g.ov = Math.min(0.95, Math.max(0.05, g.ovPct / 100)) * g.tool;
    return g;
  }

  // ---- Kreisbogen-Erkennung (G2/G3) -----------------------------------------
  function circle3(a, b, c) {
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-9) return null;
    const A = a.x * a.x + a.y * a.y, B = b.x * b.x + b.y * b.y, Cc = c.x * c.x + c.y * c.y;
    const ux = (A * (b.y - c.y) + B * (c.y - a.y) + Cc * (a.y - b.y)) / d, uy = (A * (c.x - b.x) + B * (a.x - c.x) + Cc * (b.x - a.x)) / d;
    return { x: ux, y: uy, r: Math.hypot(a.x - ux, a.y - uy) };
  }
  // Punktfolge -> Elemente: {line,from,to} | {arc,from,to,c,cw}. Greedy: ab Punkt i
  // so viele Punkte wie möglich auf einen Kreis (Toleranz tol) legen; mind. 4 Punkte.
  function fitArcs(seq, tol) {
    const out = [], n = seq.length; let i = 0;
    while (i < n - 1) {
      let best = null;
      if (i + 3 < n) {
        for (let j = i + 3; j < n; j++) {
          const c = circle3(seq[i], seq[(i + j) >> 1], seq[j]);
          if (!c || c.r < 0.05 || c.r > 5000) break;
          let ok = true, dir = 0, sweep = 0;
          for (let k = i; k <= j && ok; k++) if (Math.abs(Math.hypot(seq[k].x - c.x, seq[k].y - c.y) - c.r) > tol) ok = false;
          const ang = k => Math.atan2(seq[k].y - c.y, seq[k].x - c.x);
          for (let k = i; k < j && ok; k++) {
            let dd = ang(k + 1) - ang(k); while (dd > Math.PI) dd -= 2 * Math.PI; while (dd < -Math.PI) dd += 2 * Math.PI;
            if (Math.abs(dd) < 1e-9 || Math.abs(dd) > Math.PI / 3) { ok = false; break; }
            // Sehnenhöhe: die Polylinie muss dem Bogen wirklich folgen (sonst würde
            // z. B. ein Quadrat — 4 Ecken auf einem Umkreis — zum Kreis).
            if (c.r * (1 - Math.cos(dd / 2)) > Math.max(tol, 0.5)) { ok = false; break; }
            if (k === i) dir = Math.sign(dd); else if (Math.sign(dd) !== dir) { ok = false; break; }
            sweep += dd;
          }
          if (!ok || Math.abs(sweep) > Math.PI * 1.9) break;
          best = { j, c, cw: dir < 0 };
        }
      }
      if (best) { out.push({ arc: true, from: seq[i], to: seq[best.j], c: best.c, cw: best.cw }); i = best.j; }
      else { out.push({ line: true, from: seq[i], to: seq[i + 1] }); i++; }
    }
    return out;
  }

  // ---- Bogenlängen-Helfer -----------------------------------------------------
  // Teilstück einer Bahn zwischen den Bogenlängen sA..sB (sB > sA; bei
  // geschlossenen Bahnen mit Umlauf). Liefert Punkte inkl. Anfang und Ende.
  function subPath(pts, closed, sA, sB) {
    const seq = closed ? pts.concat([pts[0]]) : pts, L = pathLen(pts, closed), out = [];
    if (L < 1e-9) return [pts[0]];
    const at = s => { if (closed) { s = ((s % L) + L) % L; } else s = Math.max(0, Math.min(L, s)); let acc = 0; for (let i = 0; i < seq.length - 1; i++) { const dl = Math.hypot(seq[i + 1].x - seq[i].x, seq[i + 1].y - seq[i].y); if (s <= acc + dl + 1e-9) { const t = dl ? (s - acc) / dl : 0; return { x: seq[i].x + (seq[i + 1].x - seq[i].x) * t, y: seq[i].y + (seq[i + 1].y - seq[i].y) * t }; } acc += dl; } return seq[seq.length - 1]; };
    out.push(at(sA));
    // Zwischen-Eckpunkte
    let acc = 0;
    const verts = [];
    for (let i = 0; i < seq.length - 1; i++) { verts.push({ s: acc, p: seq[i] }); acc += Math.hypot(seq[i + 1].x - seq[i].x, seq[i + 1].y - seq[i].y); }
    verts.push({ s: acc, p: seq[seq.length - 1] });
    const laps = closed ? Math.ceil((sB - sA) / L) + 1 : 1;
    for (let lap = 0; lap < laps; lap++) for (const v of verts) { const s = v.s + lap * L; if (s > sA + 1e-9 && s < sB - 1e-9) out.push({ x: v.p.x, y: v.p.y }); }
    out.push(at(sB));
    return out;
  }

  // ---- Inseln: Bahn an Polygonen zerschneiden -----------------------------------
  // Zerlegt eine Bahn in Teilstücke, deren Punkte keep(p) erfüllen. Kanten werden an
  // Kreuzungen mit den Polygonen polys geteilt, jedes Teilstück über seinen Mittel-
  // punkt bewertet. Rückgabe: [{pts, closed}].
  function clipPath(pts, closed, polys, keep) {
    const seq = closed ? pts.concat([pts[0]]) : pts, sub = [];
    const cross = App.segCross;
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i], b = seq[i + 1], ts = [0, 1];
      if (cross) polys.forEach(pg => { for (let k = 0; k < pg.length; k++) { const X = cross(a, b, pg[k], pg[(k + 1) % pg.length]); if (X) { const dl = Math.hypot(b.x - a.x, b.y - a.y); if (dl > 1e-9) ts.push(Math.hypot(X.x - a.x, X.y - a.y) / dl); } } });
      ts.sort((u, v) => u - v);
      for (let k = 0; k < ts.length - 1; k++) {
        if (ts[k + 1] - ts[k] < 1e-6) continue;
        const p = { x: a.x + (b.x - a.x) * ts[k], y: a.y + (b.y - a.y) * ts[k] }, q = { x: a.x + (b.x - a.x) * ts[k + 1], y: a.y + (b.y - a.y) * ts[k + 1] };
        sub.push({ p, q, ok: keep({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }) });
      }
    }
    if (sub.every(s => s.ok)) return [{ pts, closed }];
    const pieces = []; let curP = null;
    sub.forEach(s => {
      if (!s.ok) { if (curP) { pieces.push(curP); curP = null; } return; }
      if (!curP) curP = { pts: [s.p, s.q], closed: false }; else curP.pts.push(s.q);
    });
    if (curP) pieces.push(curP);
    // Geschlossen: erstes und letztes Stück hängen über den Umlauf zusammen.
    if (closed && pieces.length > 1 && sub[0].ok && sub[sub.length - 1].ok) { const last = pieces.pop(); pieces[0].pts = last.pts.concat(pieces[0].pts.slice(1)); }
    return pieces.filter(pc => pathLen(pc.pts, false) > 1e-6);
  }

  function buildCam() {
    const J = jobs().filter(vis), sh = originShift();
    const safe = +C('frSafeZ'), depthG = Math.max(0.01, +C('frDepth'));
    const nTabs = Math.max(0, Math.round(+C('frTabs'))), tabW = Math.max(0.1, +C('frTabW')), tabH = Math.max(0, +C('frTabH'));
    const entry = C('frEntry') || 'plunge', rampAng = Math.max(0.5, Math.min(45, +C('frRampAng') || 3)) * Math.PI / 180;
    const fin = Math.max(0, +C('frFinish') || 0), useArcs = C('frArcs') !== false, arcTol = 0.01;
    const out = [], segs = [], paths = [], warn = [];
    const f3 = v => (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
    let cur = { x: 0, y: 0, z: safe }, curLine = 0, curJob = -1, lenCut = 0, lenRapid = 0, tCut = 0;
    const em = s => { out.push(s); curLine = out.length; };
    const move = (x, y, z, rapid, fv) => {
      const d = Math.hypot(x - cur.x, y - cur.y, z - cur.z);
      if (d < 1e-6) return;
      const words = [];
      if (Math.abs(x - cur.x) > 1e-6) words.push('X' + f3(x));
      if (Math.abs(y - cur.y) > 1e-6) words.push('Y' + f3(y));
      if (Math.abs(z - cur.z) > 1e-6) words.push('Z' + f3(z));
      em((rapid ? 'G0 ' : 'G1 ') + words.join(' ') + (rapid ? '' : ' F' + fv));
      segs.push({ x0: cur.x, y0: cur.y, z0: cur.z, x1: x, y1: y, z1: z, rapid, line: curLine, job: curJob });
      if (rapid) lenRapid += d; else { lenCut += d; tCut += d / fv; }
      cur = { x, y, z };
    };
    // Kreisbogen (G2 = im Uhrzeigersinn) mit optionaler Z-Änderung (Helix).
    const arcTo = (to, c, cw, z, fv) => {
      const a0 = Math.atan2(cur.y - c.y, cur.x - c.x), a1 = Math.atan2(to.y - c.y, to.x - c.x);
      let sw = a1 - a0; if (cw) { while (sw > -1e-9) sw -= 2 * Math.PI; } else { while (sw < 1e-9) sw += 2 * Math.PI; }
      const rr = Math.hypot(cur.x - c.x, cur.y - c.y);
      em((cw ? 'G2 ' : 'G3 ') + 'X' + f3(to.x) + ' Y' + f3(to.y) + (Math.abs(z - cur.z) > 1e-6 ? ' Z' + f3(z) : '') + ' I' + f3(c.x - cur.x) + ' J' + f3(c.y - cur.y) + ' F' + fv);
      const steps = Math.max(2, Math.ceil(Math.abs(sw) / (Math.PI / 36))), z0 = cur.z; let px = cur.x, py = cur.y, pz = z0;
      for (let k = 1; k <= steps; k++) {
        const a = a0 + sw * k / steps, x = k === steps ? to.x : c.x + rr * Math.cos(a), y = k === steps ? to.y : c.y + rr * Math.sin(a), zz = z0 + (z - z0) * k / steps;
        segs.push({ x0: px, y0: py, z0: pz, x1: x, y1: y, z1: zz, rapid: false, line: curLine, job: curJob }); px = x; py = y; pz = zz;
      }
      const L = Math.hypot(Math.abs(sw) * rr, z - z0); lenCut += L; tCut += L / fv; cur = { x: to.x, y: to.y, z };
    };
    const rapidTo = (x, y) => { if (cur.z < safe - 1e-6) move(cur.x, cur.y, safe, true); move(x, y, safe, true); };
    // Bahn (Punktfolge, ab aktueller Position) auf Höhe z fahren, Bögen als G2/G3.
    const runSeq = (seq, z, fv, arcs) => {
      if (arcs && useArcs && seq.length >= 4) fitArcs(seq, arcTol).forEach(el => { if (el.arc) arcTo(el.to, el.c, el.cw, z, fv); else move(el.to.x, el.to.y, z, false, fv); });
      else for (let i = 1; i < seq.length; i++) move(seq[i].x, seq[i].y, z, false, fv);
    };

    em('; AI Foam Cut — Fräse / 2D-CAM');
    { const pl = curPlate(); if (pl) em('; ' + T('Platte') + ': ' + plateLabel(pl) + ' mm'); }
    em('; ' + T('Tiefe') + ' ' + depthG + ' mm · ' + T('Sicherheitshöhe') + ' ' + safe + ' mm' + (fin > 0 ? ' · ' + T('Schlichtaufmaß') + ' ' + fin + ' mm' : ''));
    em('G21 G90 G17 G94');
    em('G0 Z' + f3(safe));
    // Werkzeug/Spindel des ersten Jobs
    let curToolId = null, curRpm = -1, toolChanges = 0;
    const islands = J.filter(j => j.op === 'island' && j.closed).map(j => ({ job: j, pts: ccw(P(j).map(p => ({ x: p.x + sh.x, y: p.y + sh.y }))) }));
    const spindle = (p, ji) => {
      if (curToolId !== null && p.toolId !== curToolId) {
        move(cur.x, cur.y, safe, true); em('M5');
        em('M0 ; ' + T('Werkzeugwechsel') + ': ' + (p.toolName || T('Fräser') + ' Ø' + p.tool + ' mm') + ' — ' + T('danach Z antasten und „Fortsetzen"'));
        toolChanges++; curRpm = -1;
      }
      curToolId = p.toolId;
      if (p.rpm > 0 && p.rpm !== curRpm) { em('M3 S' + p.rpm); if (curRpm < 0) em('G4 P2'); curRpm = p.rpm; }
      else if (p.rpm === 0 && curRpm > 0) { em('M5'); curRpm = 0; }
    };

    J.forEach((job, ji) => {
      if (job.op === 'island') return;                 // Inseln werden über die Tasche bearbeitet
      curJob = ji;
      const p = jobParams(job), r = p.r, feed = p.feed, plunge = p.plunge;
      const depth = job.depth != null && job.depth > 0 ? +job.depth : depthG;
      const zs = []; for (let z = -p.step; z > -depth + 1e-6; z -= p.step) zs.push(+z.toFixed(4)); zs.push(-depth);
      let base = P(job).map(p => ({ x: p.x + sh.x, y: p.y + sh.y }));
      em('; --- ' + T('Job') + ' ' + (ji + 1) + ': ' + job.name + ' (' + T(OP_SHORT[job.op] || job.op) + ', Ø' + p.tool + ')');
      spindle(p, ji);
      const jp = { job: ji, rings: [], tabs: [] }; paths.push(jp);

      if (job.op === 'drill') {
        const ci = job.closed ? circleInfo(base) : null;
        let cx, cy; if (ci) { cx = ci.cx; cy = ci.cy; } else { const b = bboxOf(base); cx = (b.x0 + b.x1) / 2; cy = (b.y0 + b.y1) / 2; }
        if (ci && ci.r * 2 > p.tool * 1.05) warn.push(T('Job ') + (ji + 1) + T(': Bohrung Ø') + (ci.r * 2).toFixed(2) + T(' größer als Fräser — als Innenkontur / Tasche fräsen.'));
        rapidTo(cx, cy);
        move(cx, cy, 0.5, true);
        if (p.peck > 0) { for (let z = -p.peck; z > -depth; z -= p.peck) { move(cx, cy, z, false, plunge); move(cx, cy, 0.5, true); move(cx, cy, z + 0.3, true); } }
        move(cx, cy, -depth, false, plunge);
        move(cx, cy, safe, true);
        jp.rings.push({ pts: [{ x: cx, y: cy }], closed: false, drill: true });
        return;
      }

      // Bahnen (Ringe) je Operation: {pts, closed, finish?, d?, helix?}
      let rings = [];
      const dirOut = o => p.climb ? ccw(o).reverse() : ccw(o);    // außen: Gleichlauf = im Uhrzeigersinn
      const dirIn = o => p.climb ? ccw(o) : ccw(o).reverse();
      if (!job.closed || job.op === 'on') {
        rings.push({ pts: base, closed: job.closed });
      } else {
        const cc = ccw(base);                        // CCW: links = innen
        if (job.op === 'out' || job.op === 'in') {
          const sgn = job.op === 'out' ? -1 : 1, dir = job.op === 'out' ? dirOut : dirIn;
          const o = offsetClosed(cc, sgn * (r + fin));
          if (!o) { warn.push(T('Job ') + (ji + 1) + (job.op === 'out' ? T(': Außen-Offset fehlgeschlagen.') : T(': Kontur zu klein für den Fräser (Ø ') + p.tool + ' mm).')); return; }
          rings.push({ pts: dir(o), closed: true });
          if (fin > 0) { const of = offsetClosed(cc, sgn * r); if (of) rings.push({ pts: dir(of), closed: true, finish: true }); }
        } else if (job.op === 'pocket') {
          // Inseln in dieser Tasche (Kontur der Insel liegt innerhalb der Tasche).
          const isl = islands.filter(i => i.job !== job && pointInPoly(i.pts[0], cc));
          // Ringe nach innen, bis der Offset kippt: Fläche muss schrumpfen und
          // alle Punkte müssen innerhalb der Kontur bleiben (sonst Über-Offset).
          const levels = []; let d = r + fin, guard = 0, lastA = Math.abs(polyArea(cc));
          while (guard++ < 400) {
            const o = offsetClosed(cc, d); if (!o) break;
            const A = Math.abs(polyArea(o));
            if (A < 1e-4 || A >= lastA - 1e-6 || o.some(q => !pointInPoly(q, cc))) break;
            levels.push({ d, ring: ccw(o) }); lastA = A; d += p.ov;
          }
          if (!levels.length) { warn.push(T('Job ') + (ji + 1) + T(': Tasche zu klein für den Fräser (Ø ') + p.tool + ' mm).'); return; }
          if (p.ov > r) warn.push(T('Job ') + (ji + 1) + T(': Zustellung > 50 % — es können Reststege in der Tasche bleiben.'));
          // Bei Inseln reicht der innerste Ring nicht bis zur Insel: Ebenen bis zur
          // Insel hin weiterführen (der Taschenring wird dort zerschnitten).
          if (isl.length) { let dd = levels[levels.length - 1].d + p.ov; const maxD = Math.max(r, ...levels.map(l => l.d)) + 4 * p.tool; while (dd < maxD && guard++ < 800) { const o = offsetClosed(cc, dd); if (!o) break; levels.push({ d: dd, ring: ccw(o) }); dd += p.ov; } }
          const mkLevel = (lv, finish) => {
            const pcs = [];
            if (!isl.length) { pcs.push({ pts: lv.ring, closed: true }); }
            else {
              const islOff = isl.map(i => offsetClosed(i.pts, -lv.d)).filter(Boolean);   // Insel nach außen
              const keepP = q => !islOff.some(pg => pointInPoly(q, pg));
              clipPath(lv.ring, true, islOff, keepP).forEach(pc => pcs.push(pc));
              // Ringe um die Inseln (nur innerhalb des Taschenrings, außerhalb anderer Inseln)
              islOff.forEach((pg, k) => {
                const others = islOff.filter((_, kk) => kk !== k);
                clipPath(pg, true, [lv.ring].concat(others), q => pointInPoly(q, lv.ring) && !others.some(o2 => pointInPoly(q, o2))).forEach(pc => pcs.push(pc));
              });
            }
            return pcs.map(pc => ({ pts: pc.closed ? dirIn(pc.pts) : (p.climb ? pc.pts : pc.pts.slice().reverse()), closed: pc.closed, d: lv.d, finish }));
          };
          levels.reverse();                            // von innen nach außen
          levels.forEach((lv, k) => mkLevel(lv, false).forEach(rg => { rg.inner = k < levels.length - 1; rings.push(rg); }));
          if (fin > 0) { const o = offsetClosed(cc, r); if (o) mkLevel({ d: r, ring: ccw(o) }, true).forEach(rg => rings.push(rg)); }
          // Helix-Eintauchen: Kreis um den Startpunkt des innersten Rings, Radius so,
          // dass der Fräser innerhalb des freien Bereichs bleibt.
          if (entry === 'helix' && rings.length && rings[0].closed) { const h = Math.min(r, rings[0].d - r); if (h >= 0.3) rings[0].helix = h; }
        }
      }
      // Haltestege nur an Außen-/Innenkonturen (Teil würde sonst frei werden).
      const useTabs = nTabs > 0 && tabH > 0 && (job.op === 'out' || job.op === 'in');
      const tabZ = -depth + tabH;                     // Steg-Oberkante
      const runRing = (ring, ri) => {
        const pts = ring.pts, closed = ring.closed;
        const seq = closed ? pts.concat([pts[0]]) : pts;
        const L = pathLen(pts, closed);
        if (L < 1e-6) return;
        const zList = ring.finish ? [-depth] : zs;
        // Steg-Intervalle entlang der Bogenlänge.
        let tabInt = [];
        if (useTabs && closed && L > nTabs * tabW * 2) {
          for (let k = 0; k < nTabs; k++) { const c = L * (k + 0.5) / nTabs; tabInt.push([c - tabW / 2, c + tabW / 2]); }
          jp.tabs.push(...tabInt.map(([a, b]) => ({ ring: ri, a, b })));
        }
        let sPos = 0;                                // aktuelle Bogenlängen-Position auf der Bahn (geschlossen)
        zList.forEach((z, zi) => {
          const withTabs = tabInt.length && z < tabZ - 1e-6;
          const start = seq[0];
          const first = zi === 0;
          if (first || !closed) { if (Math.hypot(cur.x - start.x, cur.y - start.y) > 1e-6 || cur.z > 0.01) { rapidTo(start.x, start.y); move(start.x, start.y, 0.5, true); } }
          if (!closed && zi > 0) { move(cur.x, cur.y, safe, true); move(start.x, start.y, safe, true); move(start.x, start.y, 0.5, true); }
          const zAt = s => withTabs && tabInt.some(([a, b]) => s >= a && s <= b) ? tabZ : z;
          // --- Eintauchen ---
          let sStart = 0;                              // Bogenlänge, ab der die Bahn auf Tiefe läuft
          const zFrom = cur.z;
          if (withTabs || entry === 'plunge') {
            move(cur.x, cur.y, zAt(0), false, plunge);
          } else if (entry === 'helix' && ring.helix) {
            // Helix: Kreise um den Startpunkt, je Umlauf um „Zustellung" tiefer.
            const h = ring.helix, c = { x: start.x, y: start.y }, pitch = p.step;
            move(start.x + h, start.y, cur.z, false, feed);
            let zc = cur.z;
            while (zc > z + 1e-6) {
              const zn = Math.max(z, zc - pitch);
              arcTo({ x: start.x - h, y: start.y }, c, !p.climb, zc + (zn - zc) / 2, plunge);
              arcTo({ x: start.x + h, y: start.y }, c, !p.climb, zn, plunge);
              zc = zn;
            }
            arcTo({ x: start.x - h, y: start.y }, c, !p.climb, z, feed);   // Boden ebnen
            arcTo({ x: start.x + h, y: start.y }, c, !p.climb, z, feed);
            move(start.x, start.y, z, false, feed);
          } else {
            // Rampe entlang der Bahn: Länge = Höhe / tan(Winkel). Offene Bahnen,
            // die kürzer als die Rampe sind, werden pendelnd (vor/zurück) abgefahren.
            const need = (zFrom - z) / Math.tan(rampAng);
            let acc = 0, fwd = true, pos = 0;
            const rampSeq = seq => { for (let i = 1; i < seq.length; i++) { acc += Math.hypot(seq[i].x - seq[i - 1].x, seq[i].y - seq[i - 1].y); move(seq[i].x, seq[i].y, zFrom - (zFrom - z) * Math.min(1, acc / need), false, feed); } };
            if (closed) { rampSeq(subPath(pts, true, sPos, sPos + need)); sStart = (sPos + need) % L; }
            else {
              while (acc < need - 1e-9) {
                const rem = need - acc, len = Math.min(L, rem);
                const piece = fwd ? subPath(pts, false, pos, pos + len) : subPath(pts, false, pos - len, pos).reverse();
                rampSeq(piece); pos = fwd ? pos + len : pos - len;
                if (pos >= L - 1e-9) fwd = false; else if (pos <= 1e-9) fwd = true;
              }
              runSeq(subPath(pts, false, 0, pos).reverse(), z, feed, false);   // zurück zum Anfang auf Tiefe
            }
          }
          // --- Bahn auf Tiefe ---
          if (!withTabs) {
            const run = closed ? subPath(pts, true, sStart, sStart + L) : seq;
            runSeq(run, z, feed, true); sPos = sStart;
            return;
          }
          let s = 0;
          for (let i = 0; i < seq.length - 1; i++) {
            const a = seq[i], b = seq[i + 1], dl = Math.hypot(b.x - a.x, b.y - a.y);
            if (dl < 1e-9) continue;
            // Kante in Teilstücke an den Steggrenzen zerlegen.
            const cuts = [0];
            tabInt.forEach(([ta, tb]) => { [ta, tb].forEach(q => { const t = (q - s) / dl; if (t > 1e-6 && t < 1 - 1e-6) cuts.push(t); }); });
            cuts.push(1); cuts.sort((u, v) => u - v);
            for (let k = 0; k < cuts.length - 1; k++) {
              const t1 = cuts[k + 1], tm = (cuts[k] + t1) / 2;
              const zz = zAt(s + tm * dl);
              const px = a.x + (b.x - a.x) * t1, py = a.y + (b.y - a.y) * t1;
              if (Math.abs(zz - cur.z) > 1e-6) move(cur.x, cur.y, zz, false, zz > cur.z ? feed : plunge);
              move(px, py, zz, false, feed);
            }
            s += dl;
          }
        });
        move(cur.x, cur.y, safe, true);
      };
      rings.forEach((ring, ri) => { jp.rings.push(ring); runRing(ring, ri); });
    });
    curJob = -1;
    move(cur.x, cur.y, safe, true);
    if (curRpm > 0) em('M5');
    if (C('frRetract')) move(0, 0, safe, true);
    em('M2');
    const all = []; segs.forEach(s => { all.push({ x: s.x0, y: s.y0 }); all.push({ x: s.x1, y: s.y1 }); });
    const tool0 = J.length ? jobParams(J[0]).tool : +C('frTool');
    return { text: out.join('\n'), lines: out, segs, paths, bbox: bboxOf(all), lenCut, lenRapid, time: tCut + lenRapid / 3000, warn, tool: tool0, safe, depth: depthG, toolChanges };
  }

  function updateInfo() {
    const el = document.getElementById('frInfo'); if (!el) return;
    const J = jobs();
    if (!J.length) { el.innerHTML = T('Keine Geometrie. Links „DXF laden…" oder „Aus CAD übernehmen".'); return; }
    if (!J.some(vis)) { el.innerHTML = T('Keine Teile auf dieser Platte.'); return; }
    const c = cam; if (!c) return;
    const b = c.bbox;
    let h = '<b>' + J.filter(vis).length + ' ' + T('Jobs') + '</b> · ' + c.lines.length + ' ' + T('Zeilen') + '<br>';
    if (b) h += 'X ' + b.x0.toFixed(1) + ' … ' + b.x1.toFixed(1) + ' · Y ' + b.y0.toFixed(1) + ' … ' + b.y1.toFixed(1) + ' mm<br>';
    h += T('Fräsweg') + ' ' + (c.lenCut / 1000).toFixed(2) + ' m · ' + T('ca.') + ' ' + fmtTime(c.time * 60);
    if (c.toolChanges) h += '<br>' + c.toolChanges + ' ' + T('Werkzeugwechsel (M0)');
    if (c.warn.length) h += '<div style="color:#ffb454;margin-top:4px">' + c.warn.map(w => '⚠ ' + w).join('<br>') + '</div>';
    el.innerHTML = h;
  }
  const fmtTime = s => { s = Math.round(s); const m = Math.floor(s / 60); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min ' + (s % 60) + ' s'; };

  // ---------- Vorschau (Canvas, Draufsicht) ---------------------------------
  let canvas = null, ctx = null, view = null;   // view = {sc, ox, oy} Welt->Pixel
  let simPos = null;      // {x,y,z} Werkzeugmarke (Simulation oder Maschine)
  let simRun = null;      // Simulationszustand
  const W2S = (x, y) => [view.ox + x * view.sc, view.oy - y * view.sc];
  function fit() {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect(); if (r.width < 10 || r.height < 10) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!view) fitView(r.width, r.height);
  }
  function fitView(w, h) {
    const all = []; const sh = originShift();
    jobs().forEach(j => { if (vis(j)) P(j).forEach(p => all.push({ x: p.x + sh.x, y: p.y + sh.y })); });
    all.push({ x: 0, y: 0 });
    { const pl = curPlate(); if (pl && +pl.w > 0 && +pl.h > 0) all.push({ x: +pl.w, y: +pl.h }); }
    if (+C('frMaxX') > 0 && +C('frMaxY') > 0) { all.push({ x: +C('frMaxX'), y: +C('frMaxY') }); }
    const b = bboxOf(all) || { x0: -10, y0: -10, x1: 100, y1: 100 };
    const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
    const sc = Math.min((w - 60) / bw, (h - 60) / bh);
    view = { sc, ox: (w - bw * sc) / 2 - b.x0 * sc, oy: (h + bh * sc) / 2 + b.y0 * sc };
  }
  function col(name, fb) { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb; } catch (e) { return fb; } }
  function zColor(z, depth) {
    const t = Math.min(1, Math.max(0, -z / Math.max(0.01, depth)));   // 0 oben .. 1 tief
    const a = [74, 163, 255], b = [255, 180, 84];
    return 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',') + ')';
  }
  // Drehgriff des markierten Teils (Welt-Koordinaten inkl. Nullpunkt-Verschiebung).
  const ROT_R = 7, ROT_OFF = 26;
  let rotInfo = null;
  function rotHandle() {
    if (!view || C('frDrag') === false) return null;
    const j = jobs()[C('frSel')]; if (!j || !j.part || !onPlate(j)) return null;
    const b0 = partBbox(j.part); if (!b0) return null;
    const sh = originShift(), b = { x0: b0.x0 + sh.x, x1: b0.x1 + sh.x, y0: b0.y0 + sh.y, y1: b0.y1 + sh.y };
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    return { part: j.part, b, cx, cy, hx: cx, hy: b.y1 + ROT_OFF / view.sc, sh };
  }
  function draw() {
    if (!canvas || !ctx) return;
    const r = canvas.getBoundingClientRect(), w = r.width, h = r.height;
    if (!view) fitView(w, h);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = col('--panel2', '#1e242c'); ctx.fillRect(0, 0, w, h);
    // Raster 10 mm
    const gridC = col('--line', '#2a323c');
    const step = view.sc >= 4 ? 10 : view.sc >= 0.8 ? 50 : 100;
    ctx.strokeStyle = gridC; ctx.lineWidth = 1;
    const wx0 = (-view.ox) / view.sc, wx1 = (w - view.ox) / view.sc, wy1 = view.oy / view.sc, wy0 = (view.oy - h) / view.sc;
    ctx.beginPath();
    for (let x = Math.floor(wx0 / step) * step; x <= wx1; x += step) { const [px] = W2S(x, 0); ctx.moveTo(px, 0); ctx.lineTo(px, h); }
    for (let y = Math.floor(wy0 / step) * step; y <= wy1; y += step) { const [, py] = W2S(0, y); ctx.moveTo(0, py); ctx.lineTo(w, py); }
    ctx.stroke();
    // Arbeitsraum
    if (+C('frMaxX') > 0 && +C('frMaxY') > 0) {
      const [ax, ay] = W2S(0, +C('frMaxY')), [bx, by] = W2S(+C('frMaxX'), 0);
      ctx.strokeStyle = '#3a4a5a'; ctx.setLineDash([6, 4]); ctx.strokeRect(ax, ay, bx - ax, by - ay); ctx.setLineDash([]);
    }
    // Ursprung
    { const [ox, oy] = W2S(0, 0); ctx.strokeStyle = col('--bad', '#ff6b6b'); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(ox - 10, oy); ctx.lineTo(ox + 10, oy); ctx.moveTo(ox, oy - 10); ctx.lineTo(ox, oy + 10); ctx.stroke(); }
    const sh = originShift(), J = jobs(), sel = C('frSel');
    // Werkstoffplatte
    { const pl = curPlate();
      if (pl && +pl.w > 0 && +pl.h > 0) {
        const [ax, ay] = W2S(0, +pl.h), [bx, by] = W2S(+pl.w, 0);
        ctx.fillStyle = 'rgba(200,170,110,0.07)'; ctx.fillRect(ax, ay, bx - ax, by - ay);
        ctx.strokeStyle = '#a08a5a'; ctx.lineWidth = 1.5; ctx.strokeRect(ax, ay, bx - ax, by - ay);
        ctx.fillStyle = '#a08a5a'; ctx.font = '11px Segoe UI, sans-serif'; ctx.fillText(plateLabel(pl) + ' mm', ax + 4, ay - 4);
      } }
    // Konturen (Geometrie)
    J.forEach((j, i) => {
      if (!onPlate(j)) return;
      const pts = P(j);
      ctx.strokeStyle = !j.on ? '#3b4654' : (i === sel ? '#ffffff' : '#8b98a8');
      ctx.lineWidth = i === sel ? 2 : 1;
      ctx.beginPath();
      pts.forEach((p, k) => { const [x, y] = W2S(p.x + sh.x, p.y + sh.y); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      if (j.closed) ctx.closePath();
      ctx.stroke();
      // Beschriftung
      const b = bboxOf(pts); if (b) { const [lx, ly] = W2S(b.x0 + sh.x, b.y1 + sh.y); ctx.fillStyle = i === sel ? '#fff' : '#8b98a8'; ctx.font = '10px Segoe UI, sans-serif'; ctx.fillText((i + 1) + ' · ' + T(OP_SHORT[j.op] || j.op), lx + 2, ly - 3); }
    });
    // Markiertes Teil: Rahmen + Drehgriff (wie bei einem Bild in Word)
    { const hd = rotHandle(); if (hd) {
        const [ax, ay] = W2S(hd.b.x0, hd.b.y1), [bx, by] = W2S(hd.b.x1, hd.b.y0);
        ctx.strokeStyle = '#7fb2ff'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.strokeRect(ax, ay, bx - ax, by - ay); ctx.setLineDash([]);
        const [tx, ty] = W2S(hd.cx, hd.b.y1), [hx, hy] = W2S(hd.hx, hd.hy);
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.fillStyle = '#1e242c'; ctx.strokeStyle = '#7fb2ff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(hx, hy, ROT_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(hx, hy, ROT_R * 0.5, 0.3 * Math.PI, 1.8 * Math.PI); ctx.stroke();
        if (rotInfo != null) { ctx.fillStyle = '#e6ebf1'; ctx.font = '11px Consolas, monospace'; ctx.fillText(rotInfo.toFixed(1) + '°', hx + ROT_R + 4, hy + 4); }
      } }
    // Bahnen
    if (cam) {
      const depth = cam.depth;
      const upTo = simRun ? simRun.segIdx : cam.segs.length;
      cam.segs.forEach((s, k) => {
        if (k > upTo) return;
        const [x0, y0] = W2S(s.x0, s.y0), [x1, y1] = W2S(s.x1, s.y1);
        if (Math.abs(x1 - x0) + Math.abs(y1 - y0) < 0.3) return;
        if (s.rapid) { ctx.strokeStyle = '#4a5568'; ctx.setLineDash([3, 4]); ctx.lineWidth = 1; }
        else { ctx.strokeStyle = zColor(Math.min(s.z0, s.z1), depth); ctx.setLineDash([]); ctx.lineWidth = Math.max(1, Math.min(6, cam.tool * view.sc)); ctx.globalAlpha = 0.75; }
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.globalAlpha = 1; ctx.setLineDash([]);
      });
      // Haltestege markieren
      cam.paths.forEach(jp => jp.tabs.forEach(tb => {
        const ring = jp.rings[tb.ring]; if (!ring) return;
        const p = ptAtLen(ring.pts, ring.closed, (tb.a + tb.b) / 2); if (!p) return;
        const [x, y] = W2S(p.x, p.y); ctx.fillStyle = '#57d38c'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
      }));
    }
    // Werkzeugmarke
    if (simPos && cam) {
      const [x, y] = W2S(simPos.x, simPos.y);
      const rr = Math.max(3, cam.tool / 2 * view.sc);
      ctx.strokeStyle = simPos.z > 0.01 ? '#57d38c' : '#ff5a3c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - rr - 4, y); ctx.lineTo(x + rr + 4, y); ctx.moveTo(x, y - rr - 4); ctx.lineTo(x, y + rr + 4); ctx.stroke();
      ctx.fillStyle = '#e6ebf1'; ctx.font = '11px Consolas, monospace';
      ctx.fillText('Z ' + simPos.z.toFixed(2), x + rr + 6, y - 6);
    }
    // Legende
    ctx.fillStyle = '#8b98a8'; ctx.font = '10px Segoe UI, sans-serif';
    ctx.fillText(T('Raster') + ' ' + step + ' mm · ' + T('blau = flach, orange = tief · gestrichelt = Eilgang · grün = Haltesteg'), 8, h - 8);
  }
  function ptAtLen(pts, closed, s) {
    const seq = closed ? pts.concat([pts[0]]) : pts;
    for (let i = 0; i < seq.length - 1; i++) { const a = seq[i], b = seq[i + 1], dl = Math.hypot(b.x - a.x, b.y - a.y); if (s <= dl) { const t = dl ? s / dl : 0; return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; } s -= dl; }
    return seq[seq.length - 1] || null;
  }

  // Simulation (Trockenlauf): Werkzeugmarke fährt die Segmente mit Vorschub ab.
  function simStart() {
    if (!cam || !cam.segs.length) return;
    simRun = { segIdx: 0, t: 0, last: performance.now() };
    setSimBtn(true); simTick();
  }
  function simStop() { simRun = null; simPos = null; setSimBtn(false); highlightLine($('#frProgView'), -1); draw(); }
  function setSimBtn(on) { const b = $('#frSimPlay'); if (b) b.textContent = on ? T('⏸ Pause') : T('▶ Simulieren'); }
  function simTick() {
    if (!simRun) return;
    const now = performance.now(), dt = (now - simRun.last) / 1000; simRun.last = now;
    const speed = Math.max(1, +($('#frSimSpeed') && $('#frSimSpeed').value || 10));
    let budget = dt * speed;                             // Sekunden Maschinenzeit
    while (budget > 0 && simRun.segIdx < cam.segs.length) {
      const s = cam.segs[simRun.segIdx];
      const d = Math.hypot(s.x1 - s.x0, s.y1 - s.y0, s.z1 - s.z0);
      const f = s.rapid ? 3000 : (parseFloat((cam.lines[s.line - 1].match(/F(\d+\.?\d*)/) || [])[1]) || C('frFeed'));
      const dur = d / f * 60, rem = dur * (1 - simRun.t);
      if (budget >= rem) { budget -= rem; simRun.segIdx++; simRun.t = 0; }
      else { simRun.t += budget / dur; budget = 0; }
    }
    if (simRun.segIdx >= cam.segs.length) { simPos = { x: cur(cam).x, y: cur(cam).y, z: cur(cam).z }; simRun = null; setSimBtn(false); draw(); return; }
    const s = cam.segs[simRun.segIdx], t = simRun.t;
    simPos = { x: s.x0 + (s.x1 - s.x0) * t, y: s.y0 + (s.y1 - s.y0) * t, z: s.z0 + (s.z1 - s.z0) * t };
    highlightLine($('#frProgView'), s.line - 1);
    draw();
    if (!simPaused) requestAnimationFrame(simTick);
  }
  const cur = c => { const s = c.segs[c.segs.length - 1]; return { x: s.x1, y: s.y1, z: s.z1 }; };
  let simPaused = false;
  function simToggle() {
    if (!simRun) { simPaused = false; simStart(); return; }
    simPaused = !simPaused; setSimBtn(!simPaused);
    if (!simPaused) { simRun.last = performance.now(); simTick(); }
  }

  // ---------- Canvas-Interaktion (Zoom/Pan/Auswahl) ---------------------------
  function bindCanvas() {
    canvas = document.getElementById('cFraese'); if (!canvas) return;
    let drag = null, moved = false;
    canvas.addEventListener('wheel', e => {
      e.preventDefault(); if (!view) return;
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const f = Math.exp(-e.deltaY * 0.0015);
      view.ox = mx - (mx - view.ox) * f; view.oy = my - (my - view.oy) * f; view.sc *= f; draw();
    }, { passive: false });
    // Welt-Koordinaten des Mauszeigers und Trefferprüfung (Kontur in Pixelnähe;
    // sonst die kleinste geschlossene Fläche, die den Punkt enthält).
    const worldAt = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - view.ox) / view.sc, y: (view.oy - (e.clientY - r.top)) / view.sc }; };
    const hitJob = (wx, wy) => {
      const sh = originShift(); let best = -1, bd = 12 / view.sc, bestArea = Infinity;
      jobs().forEach((j, i) => {
        if (!onPlate(j)) return;
        const pts = P(j), seq = j.closed ? pts.concat([pts[0]]) : pts;
        for (let k = 0; k < seq.length - 1; k++) {
          const a = { x: seq[k].x + sh.x, y: seq[k].y + sh.y }, b = { x: seq[k + 1].x + sh.x, y: seq[k + 1].y + sh.y };
          const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
          const t = L2 ? Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / L2)) : 0;
          const d = Math.hypot(wx - (a.x + dx * t), wy - (a.y + dy * t));
          if (d < bd) { bd = d; best = i; }
        }
      });
      if (best >= 0) return best;
      jobs().forEach((j, i) => {
        if (!onPlate(j) || !j.closed) return;
        const pts = P(j).map(p => ({ x: p.x + sh.x, y: p.y + sh.y })), A = Math.abs(polyArea(pts));
        if (pointInPoly({ x: wx, y: wy }, pts) && A < bestArea) { bestArea = A; best = i; }
      });
      return best;
    };
    canvas.addEventListener('mousedown', e => {
      if (e.button !== 0 || !view) return;
      drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy, part: null }; moved = false;
      if (C('frDrag') !== false) {
        const w = worldAt(e), hd = rotHandle();
        if (hd && Math.hypot(w.x - hd.hx, w.y - hd.hy) * view.sc <= ROT_R + 4) {
          // Drehgriff: Drehen um den Teil-Mittelpunkt (Shift = 15°-Raster)
          const orig = new Map(); jobsOfPart(hd.part).forEach(j => orig.set(j, j.pts.map(q => q.slice())));
          drag.rot = { part: hd.part, orig, cx: hd.cx - hd.sh.x, cy: hd.cy - hd.sh.y, wcx: hd.cx, wcy: hd.cy, a0: Math.atan2(w.y - hd.cy, w.x - hd.cx) };
          canvas.style.cursor = 'grabbing'; return;
        }
        const hi = hitJob(w.x, w.y), j = hi >= 0 ? jobs()[hi] : null;
        if (j && j.part) { drag.part = j.part; drag.wx = w.x; drag.wy = w.y; drag.hit = hi; canvas.style.cursor = 'move'; }
      }
    });
    canvas.addEventListener('mousemove', e => {
      if (drag || !view) return;
      const hd = rotHandle(); if (!hd) { if (canvas.style.cursor === 'grab') canvas.style.cursor = ''; return; }
      const w = worldAt(e); canvas.style.cursor = Math.hypot(w.x - hd.hx, w.y - hd.hy) * view.sc <= ROT_R + 4 ? 'grab' : '';
    });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) moved = true;
      if (drag.rot) {
        const R = drag.rot, w = worldAt(e);
        let deg = (Math.atan2(w.y - R.wcy, w.x - R.wcx) - R.a0) * 180 / Math.PI;
        deg = ((deg + 540) % 360) - 180;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        setPartRotated(R.part, R.orig, deg, R.cx, R.cy); rotInfo = deg;
        cam = null; draw(); return;
      }
      if (drag.part) {
        if (!moved) return;
        const w = worldAt(e); movePart(drag.part, w.x - drag.wx, w.y - drag.wy); drag.wx = w.x; drag.wy = w.y;
        if (C('frSel') !== drag.hit) S('frSel', drag.hit);
        cam = null; draw(); return;
      }
      view.ox = drag.ox + (e.clientX - drag.x); view.oy = drag.oy + (e.clientY - drag.y); draw();
    });
    window.addEventListener('mouseup', e => {
      if (!drag) return; const wasDrag = moved, d = drag; drag = null; canvas.style.cursor = '';
      if (d.rot) { rotInfo = null; regen(); buildSidebar(); draw(); return; }
      if (d.part && wasDrag) { S('frSel', d.hit); regen(); buildSidebar(); draw(); return; }
      if (wasDrag || e.target !== canvas) return;
      // Klick: nächste Kontur markieren.
      const w = worldAt(e);
      S('frSel', hitJob(w.x, w.y)); buildSidebar(); draw();
    });
    canvas.addEventListener('dblclick', () => { view = null; fit(); draw(); });
    const vb = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
    vb('frSimPlay', simToggle);
    vb('frSimReset', simStop);
    vb('frFit', () => { view = null; fit(); draw(); });
  }

  // ---------- Programm-Ansicht (Zeilen mit Live-Markierung) -----------------
  let curLn = null;
  function renderProg(pv, lines) {
    curLn = null; if (!pv) return;
    // Demo: Zahlenwerte verdecken (wie im G-Code-Reiter). Gefräst wird das
    // echte Programm — progLines bleibt unangetastet.
    const A = window.App || {};
    const demo = !!(A.demoOn && A.demoOn());
    if (demo && A.demoMaskView) A.demoMaskView(pv, '#' + (pv.id || 'frProgView'));
    const frag = document.createDocumentFragment();
    lines.forEach((ln, i) => {
      const d = document.createElement('div'); d.className = 'gln'; d.dataset.n = i + 1;
      const shown = demo && A.maskGcodeLine ? A.maskGcodeLine(ln) : ln;
      d.textContent = shown.length ? shown : ' '; frag.appendChild(d);
    });
    pv.replaceChildren(frag); pv.scrollTop = 0;
  }
  function highlightLine(pv, idx) {
    if (!pv || !pv.children.length) { curLn = null; return; }
    const ln = idx >= 0 ? pv.children[idx] : null;
    if (ln === curLn) return;
    if (curLn) curLn.classList.remove('cur');
    curLn = ln || null;
    for (let k = 0; k < pv.children.length; k++) pv.children[k].classList.toggle('done', k < idx);
    if (ln) { ln.classList.add('cur'); pv.scrollTop = Math.max(0, ln.offsetTop - pv.clientHeight / 2 + ln.offsetHeight / 2); }
  }

  // ---------- Maschinensteuerung (eigene GRBL-Verbindung) --------------------
  let mg = null;                 // Grbl-Instanz (aus grbl.js exportierte Klasse)
  let progLines = [];            // in die Maschine übernommenes Programm
  let progSegLines = null;       // Zeile -> Segment (für Live-Marke aus CAM)
  let feedOv = 100, spOv = 100;
  const setMap = {};
  const AXES = ['X', 'Y', 'Z'];
  const droVals = {}, limLamps = {};
  function log(txt, cls) { if (mg) mg.onConsole(txt, cls || ''); }
  function needConn() { if (!mg || !mg.connected) { alert(T('Erst mit der Fräse verbinden.')); return false; } return true; }

  const DESC = {
    '0': 'Schrittimpuls, µs', '1': 'Schritt-Idle-Verzögerung, ms', '2': 'Schrittport-Invert-Maske', '3': 'Richtungsport-Invert-Maske',
    '4': 'Step-Enable invertieren', '5': 'Limit-Pins invertieren', '6': 'Probe-Pin invertieren', '10': 'Statusreport-Maske',
    '11': 'Junction-Deviation, mm', '12': 'Arc-Toleranz, mm', '13': 'Report in Zoll', '20': 'Soft-Limits aktiv', '21': 'Hard-Limits aktiv',
    '22': 'Homing aktiv', '23': 'Homing-Richtung-Invert-Maske', '24': 'Homing-Feed, mm/min', '25': 'Homing-Seek, mm/min',
    '26': 'Homing-Entprellung, ms', '27': 'Homing-Pull-off, mm', '30': 'Max. Spindeldrehzahl', '31': 'Min. Spindeldrehzahl', '32': 'Lasermodus aktiv',
    '100': 'Schritte/mm X', '101': 'Schritte/mm Y', '102': 'Schritte/mm Z', '110': 'Max. Rate X, mm/min', '111': 'Max. Rate Y, mm/min', '112': 'Max. Rate Z, mm/min',
    '120': 'Beschleunigung X, mm/s²', '121': 'Beschleunigung Y, mm/s²', '122': 'Beschleunigung Z, mm/s²', '130': 'Max. Verfahrweg X, mm', '131': 'Max. Verfahrweg Y, mm', '132': 'Max. Verfahrweg Z, mm'
  };

  function buildDro() {
    const dro = $('#frDro'); if (!dro) return; dro.innerHTML = '';
    AXES.forEach(ax => {
      const cell = document.createElement('div'); cell.className = 'axis';
      cell.innerHTML = '<div class="ax-name">' + ax + '</div><div class="ax-tower">' + T(ax === 'Z' ? 'hoch' : ax === 'X' ? 'quer' : 'längs') + '</div><div class="val">0.000</div>'
        + '<div class="ax-lim" title="' + T('Endschalter') + ' ' + ax + '"><span class="lim-dot"></span><span class="lim-txt">' + T('Limit') + '</span></div>';
      dro.appendChild(cell); droVals[ax] = cell.querySelector('.val'); limLamps[ax] = cell.querySelector('.ax-lim');
    });
  }
  // Handfahrt: XY-Kreuz + Z-Spalte. Kurz = Schritt, Halten = Dauerfahrt.
  const JOG_HOLD_MS = 250, JOG_CHUNK_S = 0.15, JOG_MIN_CHUNK = 0.5;
  function jogStep(words, sign) {
    const raw = parseFloat($('#frStep').value); if (!isFinite(raw) || raw === 0) return;
    const feed = parseFloat($('#frJogFeed').value) || 500;
    mg.send('$J=G91 G21 ' + words.map(l => l + (raw * sign).toFixed(3)).join(' ') + ' F' + feed);
  }
  async function jogLoop(st, words, sign) {
    while (st.active && mg.connected) {
      const feed = parseFloat($('#frJogFeed').value) || 500;
      const dist = Math.max(feed / 60 * JOG_CHUNK_S, JOG_MIN_CHUNK) * sign;
      const resp = await mg.send('$J=G91 G21 ' + words.map(l => l + dist.toFixed(3)).join(' ') + ' F' + feed, false);
      if (typeof resp === 'string' && resp.startsWith('error')) { st.active = false; break; }
    }
  }
  function attachJog(btn, words, sign) {
    let timer = null; const st = { active: false };
    // Ein Abbruch im pointerdown muss auch das folgende pointerup entwerten:
    // sonst loest dieses mangels laufender Dauerfahrt einen Einzelschritt aus.
    btn.addEventListener('pointerdown', e => { e.preventDefault();
      if (!needConn()) { st.blocked = true; return; }
      if (window.App && App.safetyOk && !App.safetyOk()) { st.blocked = true; return; }   // Sicherheitshinweis (safety.js)
      st.blocked = false;
      st.active = false; timer = setTimeout(() => { st.active = true; jogLoop(st, words, sign); }, JOG_HOLD_MS); });
    btn.addEventListener('pointerup', () => { if (timer) { clearTimeout(timer); timer = null; } if (st.blocked) { st.blocked = false; return; } if (st.active) { st.active = false; mg.jogCancel(); } else jogStep(words, sign); });
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } st.blocked = false; if (st.active) { st.active = false; mg.jogCancel(); } };
    btn.addEventListener('pointerleave', cancel); btn.addEventListener('pointercancel', cancel);
  }
  function buildJog() {
    const host = $('#frJog'); if (!host) return; host.innerHTML = '';
    const mk = (txt, words, sign, cls) => { const b = document.createElement('button'); b.textContent = txt; b.className = 'frjog ' + (cls || ''); attachJog(b, words, sign); return b; };
    const cross = document.createElement('div'); cross.className = 'frjog-cross';
    const cells = [null, mk('Y+', ['Y'], 1), null, mk('X−', ['X'], -1), null, mk('X+', ['X'], 1), null, mk('Y−', ['Y'], -1), null];
    cells.forEach(c => { if (c) cross.appendChild(c); else { const e = document.createElement('div'); cross.appendChild(e); } });
    const zc = document.createElement('div'); zc.className = 'frjog-z';
    zc.appendChild(mk('Z+', ['Z'], 1)); zc.appendChild(mk('Z−', ['Z'], -1));
    const lz = document.createElement('div'); lz.className = 'tw'; lz.textContent = 'Z'; zc.insertBefore(lz, zc.firstChild);
    host.appendChild(cross); host.appendChild(zc);
  }

  function checkLimits(lines) {
    const MX = +C('frMaxX') || 0, MY = +C('frMaxY') || 0, MZ = +C('frMaxZ') || 0, MF = +C('frMaxFeed') || 0;
    const rx = /(?:^|\s)X(-?\d*\.?\d+)/i, ry = /(?:^|\s)Y(-?\d*\.?\d+)/i, rz = /(?:^|\s)Z(-?\d*\.?\d+)/i, rf = /(?:^|\s)F(\d*\.?\d+)/i;
    for (let i = 0; i < lines.length; i++) {
      const code = lines[i].split(';')[0].split('(')[0];
      if (/^\s*(G10|G28|G30|G92|\$)/i.test(code)) continue;
      const mx = rx.exec(code), my = ry.exec(code), mz = rz.exec(code), mf = rf.exec(code);
      if (mx) { const v = parseFloat(mx[1]); if (v < -0.001) return { line: i + 1, axis: 'X', val: v, kind: 'neg' }; if (MX > 0 && v > MX + 0.001) return { line: i + 1, axis: 'X', val: v, limit: MX, kind: 'max' }; }
      if (my) { const v = parseFloat(my[1]); if (v < -0.001) return { line: i + 1, axis: 'Y', val: v, kind: 'neg' }; if (MY > 0 && v > MY + 0.001) return { line: i + 1, axis: 'Y', val: v, limit: MY, kind: 'max' }; }
      if (mz && MZ > 0) { const v = parseFloat(mz[1]); if (v < -MZ - 0.001) return { line: i + 1, axis: 'Z', val: v, limit: MZ, kind: 'depth' }; }
      if (mf && MF > 0) { const v = parseFloat(mf[1]); if (v > MF + 0.001) return { line: i + 1, axis: 'F', val: v, limit: MF, kind: 'feed' }; }
    }
    return null;
  }

  function setProgram(lines, info) {
    progLines = lines;
    $('#frFileInfo').textContent = info;
    renderProg($('#frProgView'), lines);
    $('#frStart').disabled = !lines.length;
    $('#frProg').max = Math.max(1, lines.length); $('#frProg').value = 0;
    $('#frProgText').textContent = '0 / ' + lines.length;
  }
  function useCam() {
    regen();
    if (!cam || !cam.segs.length) { alert(T('Noch kein Fräs-G-Code vorhanden (Geometrie laden).')); return; }
    progSegLines = cam.lines;
    setProgram(cam.lines.slice(), T('CAM') + ' — ' + cam.lines.length + T(' Zeilen'));
    log(T('Programm aus CAM übernommen (') + cam.lines.length + T(' Zeilen).'), 'sys');
  }
  function loadProgFile() {
    const handler = f => { const rd = new FileReader(); rd.onload = () => { const lines = String(rd.result).split(/\r?\n/); progSegLines = null; setProgram(lines, f.name + ' — ' + lines.length + T(' Zeilen')); }; rd.readAsText(f); };
    if (App.loadFileVia) App.loadFileVia({ 'text/plain': ['.gcode', '.nc', '.ngc', '.tap', '.txt'] }, handler, 'fileFraeseGcode', 'ldGcode');
    else { const inp = document.getElementById('fileFraeseGcode'); if (inp) inp.click(); }
  }

  // ---------- $$-Fenster (Fräse) ---------------------------------------------
  function openSettings() { $('#frSettings').classList.add('open'); if (!Object.keys(setMap).length && mg && mg.connected) loadSettings(); else if (!mg || !mg.connected) $('#frSetStatus').textContent = T('Nicht verbunden — erst oben einen Port wählen.'); }
  function closeSettings() { $('#frSettings').classList.remove('open'); }
  function addOrUpdateRow(num, val) {
    $('#frSetEmpty').style.display = 'none';
    let e = setMap[num];
    if (!e) {
      const tr = document.createElement('tr');
      const tdN = document.createElement('td'); tdN.className = 'num'; tdN.textContent = '$' + num;
      const tdD = document.createElement('td'); const dsc = DESC[num] ? T(DESC[num]) : ''; tdD.textContent = dsc || '—'; if (!dsc) tdD.style.color = 'var(--muted)';
      const tdV = document.createElement('td'); const inp = document.createElement('input'); inp.type = 'text'; inp.inputMode = 'decimal';
      tdV.appendChild(window.wrapWithSpinner ? window.wrapWithSpinner(inp, { step: 1 }) : inp);
      tr.append(tdN, tdD, tdV); $('#frSetBody').appendChild(tr);
      e = setMap[num] = { tr, inp, orig: val };
      inp.addEventListener('input', () => tr.classList.toggle('dirty', inp.value !== e.orig));
    }
    e.orig = val; e.inp.value = val; e.tr.classList.remove('dirty'); filterRows();
  }
  async function loadSettings() {
    if (!needConn()) return;
    $('#frSetBody').innerHTML = ''; for (const k in setMap) delete setMap[k];
    $('#frSetStatus').textContent = T('Lade …');
    await mg.send('$$');
    $('#frSetStatus').textContent = Object.keys(setMap).length + T(' Einstellungen geladen.');
  }
  function filterRows() {
    const q = ($('#frSetSearch').value || '').toLowerCase();
    for (const [n, e] of Object.entries(setMap)) { const hay = ('$' + n + ' ' + (DESC[n] ? T(DESC[n]) : '')).toLowerCase(); e.tr.style.display = hay.includes(q) ? '' : 'none'; }
  }

  // ---------- Init der Maschinensteuerung -------------------------------------
  function initMachine() {
    if (!(window.GrblPanel && GrblPanel.Grbl)) { const n = $('#frSerialNote'); if (n) n.textContent = T('GRBL-Modul fehlt.'); return; }
    mg = new GrblPanel.Grbl();
    const consoleEl = $('#frConsole');
    mg.onConsole = (txt, cls) => {
      if (!consoleEl) return;
      const div = document.createElement('div'); if (cls) div.className = cls; div.textContent = txt; consoleEl.appendChild(div);
      while (consoleEl.childElementCount > 400) consoleEl.removeChild(consoleEl.firstChild);
      consoleEl.scrollTop = consoleEl.scrollHeight;
    };
    mg.onStatus = st => {
      mg.lastState = st.state; mg.lastPins = st.pins || '';
      $('#frStateText').textContent = st.state;
      $('#frStateDot').className = 'dot ' + (/Idle|Home|Check/.test(st.state) ? 'idle' : /Run|Jog/.test(st.state) ? 'run' : /Alarm|Door/.test(st.state) ? 'alarm' : '');
      if (st.wco) mg._wco = st.wco;
      let pos = st.pos; if (st.isMPos && mg._wco) pos = st.pos.map((v, i) => v - (mg._wco[i] || 0));
      AXES.forEach((ax, i) => { if (droVals[ax] && !isNaN(pos[i])) droVals[ax].textContent = pos[i].toFixed(3); if (limLamps[ax]) limLamps[ax].classList.toggle('on', (st.pins || '').indexOf(ax) >= 0); });
      const fEl = $('#frFeedText'); if (fEl && st.feed != null && !isNaN(st.feed)) fEl.textContent = T('Geschwindigkeit: ') + Math.round(st.feed) + ' mm/min';
      // Live-Marke: beim echten Lauf folgt die Werkzeugmarke der Maschinenposition.
      if (mg.streaming && !isNaN(pos[0]) && !isNaN(pos[1])) { simPos = { x: pos[0], y: pos[1], z: isNaN(pos[2]) ? 0 : pos[2] }; draw(); }
    };
    mg.onSetting = line => { const m = line.match(/^\$(\d+)=(.*)$/); if (m) addOrUpdateRow(m[1], m[2].trim()); };

    buildDro(); buildJog();
    const stepSel = $('#frStepSel'), stepInp = $('#frStep');
    if (stepSel && stepInp) stepSel.onchange = () => { if (stepSel.value) { stepInp.value = stepSel.value; stepSel.selectedIndex = 0; } };
    const baud = $('#frBaud'); if (baud) { baud.value = String(C('frBaud')); baud.onchange = () => { S('frBaud', parseInt(baud.value, 10)); if (App.saveSettings) App.saveSettings(); }; }
    if (!('serial' in navigator)) $('#frSerialNote').textContent = T('Web Serial fehlt: bitte Chrome/Edge nutzen und die Seite über http://localhost oder als lokale Datei öffnen.');

    $('#frConnect').onclick = async () => {
      if (mg.connected) { await mg.disconnect(); $('#frConnect').textContent = T('Port wählen & verbinden'); $('#frStateText').textContent = T('getrennt'); $('#frStateDot').className = 'dot'; }
      else {
        try { await mg.connect(parseInt($('#frBaud').value, 10)); $('#frConnect').textContent = T('Trennen'); feedOv = spOv = 100; updateOv(); try { await mg.send('$$'); } catch (e) {} }
        catch (e) { log(e.message, 'err'); alert(e.message); }
      }
    };
    $('#frSettingsBtn').onclick = openSettings;
    $('#frSetClose').onclick = closeSettings;
    $('#frSettings').addEventListener('click', e => { if (e.target.id === 'frSettings') closeSettings(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });
    $('#frSetReload').onclick = loadSettings;
    $('#frSetSearch').addEventListener('input', filterRows);
    $('#frSetSave').onclick = async () => {
      if (!needConn()) return;
      const changed = Object.entries(setMap).filter(([, e]) => e.inp.value !== e.orig);
      if (!changed.length) { $('#frSetStatus').textContent = T('Keine Änderungen.'); return; }
      let errs = 0;
      for (const [n, e] of changed) { e.tr.style.outline = ''; const r = await mg.send('$' + n + '=' + e.inp.value.trim().replace(',', '.')); if (r.startsWith('error')) { errs++; e.tr.style.outline = '1px solid var(--bad)'; } }
      $('#frSetStatus').textContent = (changed.length - errs) + T(' gespeichert') + (errs ? ', ' + errs + T(' Fehler') : '') + T('. Aktualisiere …');
      await loadSettings();
    };
    $('#frRawSet').onclick = async () => { if (!needConn()) return; const n = $('#frRawNum').value.trim().replace(/^\$/, ''), v = $('#frRawVal').value.trim(); if (!n) return; await mg.send('$' + n + '=' + v); $('#frRawNum').value = ''; $('#frRawVal').value = ''; loadSettings(); };

    // Spindel
    $('#frSpOn').onclick = () => { if (!needConn()) return;
      if (window.App && App.safetyOk && !App.safetyOk()) return;
      const s = Math.max(0, Math.round(parseFloat($('#frRpm').value) || C('frRpm'))); mg.send('M3 S' + s); };
    $('#frSpOff').onclick = () => { if (!needConn()) return; mg.send('M5'); };
    const rpm = $('#frRpm'); if (rpm) { rpm.value = C('frRpm'); rpm.onchange = () => { setCut('frRpm', parseFloat(rpm.value) || 0); regen(); buildSidebar(); }; }
    // Overrides (Echtzeit-Bytes): Vorschub 0x90 = 100 %, 0x91 +10, 0x92 −10; Spindel 0x99/0x9A/0x9B.
    const ov = (id, byte, fn) => { const b = $(id); if (b) b.onclick = () => { if (!needConn()) return; mg.rt(byte); fn(); updateOv(); }; };
    ov('#frFov100', 0x90, () => feedOv = 100); ov('#frFovUp', 0x91, () => feedOv = Math.min(200, feedOv + 10)); ov('#frFovDn', 0x92, () => feedOv = Math.max(10, feedOv - 10));
    ov('#frSov100', 0x99, () => spOv = 100); ov('#frSovUp', 0x9A, () => spOv = Math.min(200, spOv + 10)); ov('#frSovDn', 0x9B, () => spOv = Math.max(10, spOv - 10));

    // Programm
    $('#frUseCam').onclick = useCam;
    $('#frFileBtn').onclick = loadProgFile;
    const fi = document.getElementById('fileFraeseGcode');
    if (fi) fi.onchange = e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { const lines = String(rd.result).split(/\r?\n/); progSegLines = null; setProgram(lines, f.name + ' — ' + lines.length + T(' Zeilen')); }; rd.readAsText(f); e.target.value = ''; };
    const fd = document.getElementById('fileFraeseDxf');
    if (fd) fd.onchange = e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => importDxfText(String(rd.result), f.name); rd.readAsText(f); e.target.value = ''; };

    const btn = id => $(id);
    const runUi = on => { btn('#frStart').disabled = on; btn('#frPause').disabled = !on; btn('#frStop').disabled = !on; btn('#frAbort').disabled = !on; if (!on) { btn('#frPause').textContent = T('Pause'); btn('#frResume').style.display = 'none'; } };
    $('#frStart').onclick = () => {
      if (!needConn()) return;
      if (mg.streaming || !progLines.length) return;
      const v = checkLimits(progLines);
      if (v) {
        let msg;
        if (v.kind === 'feed') msg = T('Vorschub überschritten: F = ') + v.val.toFixed(0) + T(' mm/min in Zeile ') + v.line + ' ' + T('(max ') + v.limit + T(' mm/min). Fräsen nicht gestartet.');
        else if (v.kind === 'depth') msg = T('Z-Tiefe überschritten: Z = ') + v.val.toFixed(2) + T(' mm in Zeile ') + v.line + ' ' + T('(max ') + v.limit + T(' mm). Fräsen nicht gestartet.');
        else msg = (v.kind === 'neg' ? T('Fahrweg negativ: Achse ') : T('Fahrweg überschritten: Achse ')) + v.axis + ' = ' + v.val.toFixed(1) + ' mm' + T(' in Zeile ') + v.line + (v.limit ? ' (' + T('erlaubt 0 … ') + v.limit + ' mm)' : '') + T('. Fräsen nicht gestartet.');
        log(msg, 'err'); alert(msg); return;
      }
      // Einmaliger Sicherheitshinweis (safety.js) vor der Start-Rückfrage.
      const go = () => {
        if (!confirm(T('Programm starten? Spindel läuft an, die Maschine fährt das Programm ab. Werkstück gespannt, Nullpunkt gesetzt, Fräser frei?'))) return;
        runUi(true); btn('#frGoZero').style.display = 'none';
        simStop(); highlightLine($('#frProgView'), 0);
        mg.onPause = i => { btn('#frResume').style.display = ''; btn('#frPause').disabled = true; log(T('Programmpause (M0) bei Zeile ') + i + T('. „Fortsetzen" drücken.'), 'sys'); };
        mg.stream(progLines,
          (i, total) => { $('#frProg').value = i; $('#frProgText').textContent = i + ' / ' + total; highlightLine($('#frProgView'), i - 1); },
          () => { runUi(false); highlightLine($('#frProgView'), progLines.length); simPos = null; draw(); log(T('Programm fertig.'), 'sys'); });
      };
      if (window.App && App.safetyAck) App.safetyAck(go); else go();
    };
    $('#frPause').onclick = () => { mg.paused = !mg.paused; if (mg.paused) { mg.feedHold(); $('#frPause').textContent = T('Weiter'); } else { mg.resume(); $('#frPause').textContent = T('Pause'); } };
    $('#frResume').onclick = () => { $('#frResume').style.display = 'none'; $('#frPause').disabled = false; $('#frPause').textContent = T('Pause'); mg.paused = false; log(T('Fortsetzen.'), 'sys'); };
    $('#frStop').onclick = () => { mg.streaming = false; mg.paused = false; mg.feedHold(); runUi(false); highlightLine($('#frProgView'), -1); log(T('Programm gestoppt (Feed-Hold). Spindel läuft ggf. weiter — „Spindel AUS" oder Abbruch.'), 'sys'); };
    $('#frAbort').onclick = async () => { runUi(false); await mg.abort(); btn('#frGoZero').style.display = ''; simPos = null; draw(); log(T('Abbruch: Bewegung gestoppt, Puffer geleert, Spindel AUS (Soft-Reset). Zum Zurückfahren „Fahren auf Nullpunkt" drücken.'), 'sys'); };
    // Zurück auf Nullpunkt: erst Z hoch (Sicherheitshöhe), dann XY.
    const goZero = async () => {
      if (!needConn()) return;
      if (window.App && App.safetyOk && !App.safetyOk()) return;
      await mg.send('$X'); await mg.send('M5');
      await mg.send('G90 G0 Z' + (+C('frSafeZ') || 5)); await mg.send('G90 G0 X0 Y0');
      btn('#frGoZero').style.display = 'none'; log(T('Fahre auf Nullpunkt … (erst Z hoch, dann X/Y)'), 'sys');
    };
    $('#frGoZero').onclick = goZero; $('#frGoZero2').onclick = goZero;

    // Konsole / MDI
    const mdi = $('#frMdi'), mdiBtn = $('#frMdiSend');
    const sendMdi = () => { const v = mdi.value.trim(); if (v) { mg.send(v); mdi.value = ''; } };
    mdiBtn.onclick = sendMdi; mdi.addEventListener('keydown', e => { if (e.key === 'Enter') sendMdi(); });

    // Nullpunkt
    $('#frSetZero').onclick = async () => { if (!needConn()) return; await mg.send('G10 L20 P0 X0 Y0 Z0'); log(T('Werkstück-Nullpunkt gesetzt (X0 Y0 Z0).'), 'sys'); };
    $('#frSetZeroXY').onclick = async () => { if (!needConn()) return; await mg.send('G10 L20 P0 X0 Y0'); log(T('X/Y genullt.'), 'sys'); };
    $('#frSetZeroZ').onclick = async () => { if (!needConn()) return; await mg.send('G10 L20 P0 Z0'); log(T('Z genullt (Fräserspitze = Werkstückoberkante).'), 'sys'); };
    // Z-Taster: G38.2 fährt nach unten, bis der Taster schließt; dann Z = Plättchendicke.
    $('#frProbe').onclick = async () => {
      if (!needConn()) return;
      const thk = +C('frProbeThk') || 0, dist = Math.max(1, +C('frProbeDist') || 30), pf = Math.max(1, +C('frProbeFeed') || 60);
      if (!confirm(T('Z-Taster: Der Fräser fährt langsam nach unten (max. ') + dist + T(' mm), bis der Taster Kontakt meldet, und setzt dann Z = ') + thk + T(' mm (Plättchendicke). Taster angeschlossen und unter dem Fräser?'))) return;
      const r = await mg.send('G38.2 Z-' + dist + ' F' + pf);
      if (typeof r === 'string' && r.startsWith('error')) { log(T('Tastvorgang fehlgeschlagen: ') + r, 'err'); return; }
      await new Promise(res => setTimeout(res, 300));
      if (/Alarm/i.test(mg.lastState || '')) { log(T('Kein Kontakt innerhalb des Tastwegs (Alarm). Mit „Alarm quittieren" freigeben.'), 'err'); return; }
      await mg.send('G10 L20 P0 Z' + thk);
      await mg.send('G91 G0 Z' + Math.min(10, +C('frSafeZ') || 5)); await mg.send('G90');
      log(T('Z-Nullpunkt über Taster gesetzt (Plättchen ') + thk + ' mm).', 'sys');
    };
    // Homing / Unlock
    $('#frHome').onclick = async () => {
      if (!needConn()) return;
      if (window.App && App.safetyOk && !App.safetyOk()) return;
      if (!confirm(T('Referenzfahrt starten? Alle Achsen fahren auf ihre Endschalter (Z zuerst). Verfahrweg frei?'))) return;
      $('#frHome').disabled = true; $('#frHomeStop').style.display = '';
      await mg.send('$X'); await mg.send('M5');
      log(T('Referenzfahrt läuft … ($H)'), 'sys');
      const resp = await mg.send('$H');
      if (typeof resp === 'string' && resp.startsWith('error')) log((resp.split(':')[1] || '').trim() === '5' ? T('Homing ist nicht aktiviert. In den GRBL-Einstellungen $22=1 setzen und Endschalter konfigurieren.') : T('Referenzfahrt fehlgeschlagen: ') + resp, 'err');
      else if (resp === 'reset') log(T('Referenzfahrt abgebrochen.'), 'err');
      else { await new Promise(res => setTimeout(res, 400)); log(/Alarm/i.test(mg.lastState || '') ? T('Referenzfahrt fehlgeschlagen (Endschalter nicht erreicht?). Mit $X quittieren und Schalter/Richtung ($23) prüfen.') : T('Referenzfahrt abgeschlossen.'), /Alarm/i.test(mg.lastState || '') ? 'err' : 'sys'); }
      $('#frHome').disabled = false; $('#frHomeStop').style.display = 'none';
    };
    $('#frHomeStop').onclick = async () => { $('#frHomeStop').style.display = 'none'; await mg.abort(); };
    $('#frUnlock').onclick = async () => {
      if (!needConn()) return;
      const inAlarm = /Alarm/i.test(mg.lastState || '');
      if (inAlarm) { mg.streaming = false; mg.paused = false; await mg.rt(0x18); const pend = mg.pending; mg.pending = []; pend.forEach(p => { try { p('reset'); } catch (e) {} }); await new Promise(res => setTimeout(res, 400)); }
      const r = await mg.send('$X');
      if (typeof r === 'string' && r.startsWith('error')) { log(T('Quittieren fehlgeschlagen: ') + r, 'err'); return; }
      log(inAlarm ? T('Alarm quittiert (Soft-Reset + $X). Position ggf. verloren — Referenzfahrt empfohlen.') : T('Alarm/Fehler quittiert ($X).'), 'sys');
      const pins = (mg.lastPins || '').replace(/[PDRH]/g, '');
      if (pins) log(T('Endschalter noch gedrückt (') + pins + T('). Mit Handfahrt vom Schalter wegfahren.'), 'err');
    };
    $('#frEstop').onclick = () => { if (!mg.connected) return; mg.feedHold(); mg.send('M5'); log('!! FEED HOLD + M5', 'err'); };
    updateOv();
  }
  function updateOv() { const f = $('#frFovVal'), s = $('#frSovVal'); if (f) f.textContent = feedOv + ' %'; if (s) s.textContent = spOv + ' %'; }

  // ---------- Export -----------------------------------------------------------
  function saveGcode() {
    regen(); if (!cam || !cam.segs.length) { alert(T('Noch kein Fräs-G-Code vorhanden (Geometrie laden).')); return; }
    const base = ((state.projectName || 'fraese').replace(/[^\w\-]+/g, '_')) || 'fraese';
    if (typeof App.download === 'function') App.download(base + '_fraese.gcode', cam.text, 'text/plain', 'svGcode');
    else if (App.anchorDownload) App.anchorDownload(base + '_fraese.gcode', cam.text, 'text/plain');
  }

  // ---------- Sidebar -----------------------------------------------------------
  function fraeseSidebar(side) {
    const rb = () => { regen(); buildSidebar(); draw(); };
    const rr = () => { regen(); draw(); };
    const J = jobs(), sel = C('frSel');

    // Geometrie / Jobs
    const g = grp(T('Fräse: Geometrie & Jobs') + ' (' + J.length + ')', true, 'fraese');
    hint(g.body, 'Konturen aus einer DXF-Datei, dem CAD-Reiter oder dem Rippendesigner übernehmen. Jede Kontur wird ein Job mit eigener Operation (außen / innen / auf der Linie / Tasche / Insel / Bohren). „Insel" = Kontur innerhalb einer Tasche, die stehen bleibt. Reihenfolge = Bearbeitungsreihenfolge (Außenkontur zuletzt, damit das Teil bis zum Schluss gehalten wird). Jobs mit abweichendem Fräser erzeugen einen Werkzeugwechsel (M0) im Programm.');
    const ib = document.createElement('div'); ib.style.display = 'flex'; ib.style.flexWrap = 'wrap'; ib.style.gap = '4px';
    ib.appendChild(mkMini(T('DXF laden…'), importDxfFile));
    // Die Reiter „CAD-Bearbeitung" und „Rippendesigner" sind abwählbare
    // Funktionen — ihre Übernahme-Schaltflächen nur zeigen, wenn sie da sind.
    if (App.renderCad) {
      ib.appendChild(mkMini(T('CAD: Auswahl'), () => importFromCad(true)));
      ib.appendChild(mkMini(T('CAD: Alles'), () => importFromCad(false)));
    }
    if (App.ribStations) { ib.appendChild(mkMini(T('Rippen'), () => importFromRibs(false))); ib.appendChild(mkMini(T('Rippen + Holme'), () => importFromRibs(true))); }
    ib.appendChild(mkMini(T('Leeren'), clearJobs));
    g.body.appendChild(ib);
    ensureParts();
    const plateNow = curPlate();
    if (!plateNow) selectRow(g.body, 'Nullpunkt', [['min', 'links unten der Geometrie'], ['center', 'Mitte der Geometrie'], ['asis', 'wie gezeichnet (0/0 der Zeichnung)']], () => C('frOrigin'), v => { S('frOrigin', v); view = null; rr(); },
      'Wo der Werkstück-Nullpunkt (X0/Y0) relativ zur Geometrie liegt. Z0 ist immer die Werkstückoberkante.');
    else hint(g.body, T('Aktive Platte: ') + plateLabel(plateNow) + T(' mm. Nullpunkt X0/Y0 = Plattenecke links unten, Z0 = Plattenoberkante. Angezeigt und gefräst werden nur die Teile dieser Platte.'));
    const visIdx = J.map((j, i) => i).filter(i => onPlate(J[i]));
    if (J.length && !visIdx.length) hint(g.body, 'Auf dieser Platte liegen keine Teile — andere Platte wählen (Gruppe „Platten & Anordnung“) oder Teile in der Gruppe „Teile“ zuweisen.');
    if (visIdx.length) {
      const list = document.createElement('div'); list.className = 'frjobs';
      visIdx.forEach(i => {
        const j = J[i];
        const row = document.createElement('div'); row.className = 'frjob' + (i === sel ? ' sel' : '') + (j.on ? '' : ' off');
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!j.on; cb.title = T('Job aktiv'); cb.onchange = () => { j.on = cb.checked; rb(); };
        const nm = document.createElement('span'); nm.className = 'frjob-name'; nm.textContent = (i + 1) + ' · ' + j.name + (j.closed ? '' : ' (' + T('offen') + ')');
        { const pp = partOf(j); nm.title = (pp ? T('Teil') + ': ' + pp.name + ' — ' : '') + T('Klick: in der Vorschau markieren'); }
        nm.onclick = () => { S('frSel', i === sel ? -1 : i); buildSidebar(); draw(); };
        const op = document.createElement('select');
        OPS.forEach(o => { if (!j.closed && (o[0] === 'out' || o[0] === 'in' || o[0] === 'pocket' || o[0] === 'island')) return; const e = document.createElement('option'); e.value = o[0]; e.textContent = T(o[1]); op.appendChild(e); });
        op.value = j.op; op.onchange = () => { j.op = op.value; rr(); };
        const dp = document.createElement('input'); dp.type = 'text'; dp.inputMode = 'decimal'; dp.placeholder = T('Tiefe'); dp.value = j.depth != null ? j.depth : ''; dp.title = T('Eigene Tiefe (mm) — leer = Gesamttiefe');
        dp.style.width = '52px'; dp.onchange = () => { const v = parseFloat(String(dp.value).replace(',', '.')); j.depth = isFinite(v) && v > 0 ? v : null; rr(); };
        const up = mkMini('▲', () => { if (i > 0) { J.splice(i - 1, 0, J.splice(i, 1)[0]); S('frSel', i - 1); rb(); } });
        const dn = mkMini('▼', () => { if (i < J.length - 1) { J.splice(i + 1, 0, J.splice(i, 1)[0]); S('frSel', i + 1); rb(); } });
        const del = mkMini('✕', () => { J.splice(i, 1); S('frSel', -1); ensureParts(); rb(); });
        row.append(cb, nm, op, dp, up, dn, del); list.appendChild(row);
        if (dbTools().length) {
          // Zweite Zeile: eigener Fräser für diesen Job (Werkzeugwechsel per M0 im Programm).
          const r2 = document.createElement('div'); r2.className = 'frjob-tool';
          const ts = document.createElement('select');
          [['', T('Standard-Fräser')]].concat(dbTools().map(t => [t.id, toolLabel(t)])).forEach(o => { const e = document.createElement('option'); e.value = o[0]; e.textContent = o[1]; ts.appendChild(e); });
          ts.value = j.toolId || ''; ts.title = T('Fräser für diesen Job — abweichend vom Standard = Werkzeugwechsel (M0) im Programm');
          ts.onchange = () => { j.toolId = ts.value || undefined; rr(); };
          r2.appendChild(ts); list.appendChild(r2);
        }
      });
      g.body.appendChild(list);
      const sb = document.createElement('div'); sb.style.display = 'flex'; sb.style.flexWrap = 'wrap'; sb.style.gap = '4px';
      sb.appendChild(mkMini(T('Sortieren: innen vor außen'), () => { J.sort((a, b) => RANK[a.op] - RANK[b.op]); S('frSel', -1); rb(); }));
      if (dbTools().length) sb.appendChild(mkMini(T('Sortieren: nach Fräser'), () => { const key = j => j.toolId || C('frToolId') || ''; J.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : RANK[a.op] - RANK[b.op])); S('frSel', -1); rb(); }));
      g.body.appendChild(sb);
      // Lage des markierten Teils: Position (Ecke links unten), Drehen, Spiegeln.
      const selPart = sel >= 0 && J[sel] ? partOf(J[sel]) : null;
      if (selPart) {
        subhead(g.body, T('Teil') + ' „' + selPart.name + '“ ' + T('verschieben'));
        hint(g.body, 'Teile lassen sich in der Vorschau mit der Maus ziehen (alle Konturen des Teils zusammen). Hier die Ecke links unten des Teils genau setzen oder das Teil drehen.');
        const b0 = partBbox(selPart.id) || { x0: 0, y0: 0 };
        numRow(g.body, 'X links (mm)', () => +b0.x0.toFixed(2), v => { const b = partBbox(selPart.id); if (b) movePart(selPart.id, v - b.x0, 0); rr(); }, { step: 1, norender: true });
        numRow(g.body, 'Y unten (mm)', () => +b0.y0.toFixed(2), v => { const b = partBbox(selPart.id); if (b) movePart(selPart.id, 0, v - b.y0); rr(); }, { step: 1, norender: true });
        const pb = document.createElement('div'); pb.style.display = 'flex'; pb.style.flexWrap = 'wrap'; pb.style.gap = '4px';
        pb.appendChild(mkMini('↺ 90°', () => { rotatePart(selPart.id, 90); rb(); }));
        pb.appendChild(mkMini('↻ 90°', () => { rotatePart(selPart.id, -90); rb(); }));
        pb.appendChild(mkMini('180°', () => { rotatePart(selPart.id, 180); rb(); }));
        pb.appendChild(mkMini(T('Drehen…'), () => { App.askText(T('Drehwinkel (°), mathematisch positiv:'), '0').then(a => { const v = parseFloat(String(a || '').replace(',', '.')); if (isFinite(v) && v) { rotatePart(selPart.id, v); rb(); } }); }));
        g.body.appendChild(pb);
      }
    }
    side.appendChild(g.g);

    // Teile: Werkstoff, Stärke und Platte je Teil (Zwischenschritt vor dem Anordnen)
    const PT = parts();
    const tg = grp(T('Fräse: Teile (Werkstoff & Stärke)') + ' (' + PT.length + ')', true, 'fraese', { key: 'frParts' });
    hint(tg.body, 'Jede Außenkontur mit ihren Innenkonturen ist ein Teil. Hier bekommt jedes Teil Werkstoff und Plattenstärke; „Automatisch auf Platten verteilen“ legt dann je Werkstoff/Stärke Werkstoffplatten an und ordnet die Teile platzsparend darauf an. Die Platte kann auch von Hand zugewiesen werden.');
    if (PT.length) {
      const mats2 = dbMats(), pls = plates();
      // Sammel-Zuweisung
      const ab = document.createElement('div'); ab.className = 'frpart frpart-all';
      const am = document.createElement('select'); [['', T('— Werkstoff —')]].concat(mats2.map(m => [m.id, m.name || '?'])).forEach(o => { const e = document.createElement('option'); e.value = o[0]; e.textContent = o[1]; am.appendChild(e); }); am.value = C('frMatId') || '';
      const at = document.createElement('input'); at.type = 'text'; at.inputMode = 'decimal'; at.placeholder = T('Stärke'); at.style.width = '52px'; at.title = T('Plattenstärke (mm)');
      const aa = mkMini(T('Auf alle Teile anwenden'), () => { const v = parseFloat(String(at.value).replace(',', '.')); PT.forEach(p => { p.matId = am.value || ''; if (isFinite(v) && v > 0) p.thk = v; }); rb(); });
      ab.append(am, at, aa); tg.body.appendChild(ab);
      const pl = document.createElement('div'); pl.className = 'frjobs';
      PT.forEach(p => {
        const row = document.createElement('div'); row.className = 'frpart' + (sel >= 0 && J[sel] && J[sel].part === p.id ? ' sel' : '');
        const nm = document.createElement('input'); nm.type = 'text'; nm.value = p.name || ''; nm.className = 'frpart-name'; nm.title = T('Name des Teils'); nm.onchange = () => { p.name = nm.value; };
        nm.onfocus = () => { const i = J.findIndex(j => j.part === p.id); if (i >= 0 && onPlate(J[i])) { S('frSel', i); draw(); } };
        const ms = document.createElement('select'); ms.title = T('Werkstoff');
        [['', mats2.length ? T('— Werkstoff —') : T('— kein Werkstoff angelegt —')]].concat(mats2.map(m => [m.id, m.name || '?'])).forEach(o => { const e = document.createElement('option'); e.value = o[0]; e.textContent = o[1]; ms.appendChild(e); });
        ms.value = p.matId && mats2.some(m => m.id === p.matId) ? p.matId : ''; ms.onchange = () => { p.matId = ms.value; };
        const th = document.createElement('input'); th.type = 'text'; th.inputMode = 'decimal'; th.placeholder = T('Stärke'); th.style.width = '46px'; th.title = T('Plattenstärke (mm)');
        th.value = p.thk > 0 ? p.thk : ''; th.onchange = () => { const v = parseFloat(String(th.value).replace(',', '.')); p.thk = isFinite(v) && v > 0 ? v : null; };
        const ps = document.createElement('select'); ps.title = T('Platte, auf der das Teil liegt');
        [['', T('— keine Platte —')]].concat(pls.map(x => [x.id, x.name || T('Platte')])).forEach(o => { const e = document.createElement('option'); e.value = o[0]; e.textContent = o[1]; ps.appendChild(e); });
        ps.value = p.plate && pls.some(x => x.id === p.plate) ? p.plate : ''; ps.onchange = () => { p.plate = ps.value; S('frSel', -1); view = null; rb(); };
        const del = mkMini('✕', () => { if (!confirm(T('Teil löschen?') + ' ' + p.name)) return; delPart(p.id); S('frSel', -1); rb(); });
        row.append(nm, ms, th, ps, del); pl.appendChild(row);
      });
      tg.body.appendChild(pl);
    }
    side.appendChild(tg.g);

    // Platten & Anordnung
    const pg = grp('Fräse: Platten & Anordnung', true, 'fraese', { key: 'frPlates' });
    hint(pg.body, 'Werkstoffplatten = Rohplatten mit Werkstoff, Stärke und Abmessung. Es wird immer eine Platte bearbeitet: Vorschau und G-Code enthalten nur ihre Teile, Nullpunkt ist die Plattenecke links unten, die Frästiefe ergibt sich aus Stärke + Durchbruch-Zugabe. Teile lassen sich in der Vorschau mit der Maus verschieben und (Drehgriff am markierten Teil) drehen.');
    const pOpts = [['', plates().length ? '— ohne Platte —' : '— noch keine Platte —']].concat(plates().map(x => [x.id, plateLabel(x)]));
    selectRow(pg.body, 'Aktive Platte', pOpts, () => C('frPlateId') || '', v => { selectPlate(v); rb(); });
    const pbb = document.createElement('div'); pbb.style.display = 'flex'; pbb.style.flexWrap = 'wrap'; pbb.style.gap = '4px';
    pbb.appendChild(mkMini(T('Automatisch auf Platten verteilen'), distributeAll));
    pbb.appendChild(mkMini(T('Aktive Platte neu anordnen'), nestActive));
    pbb.appendChild(mkMini(T('Neue Platte'), () => { const np = newPlate(C('frMatId'), null); selectPlate(np.id); rb(); }));
    if (plateNow) pbb.appendChild(mkMini(T('Platte löschen'), () => { delPlate(plateNow.id); rb(); }));
    pg.body.appendChild(pbb);
    if (plateNow) {
      subhead(pg.body, T('Aktive Platte'));
      txtRow(pg.body, 'Name', () => plateNow.name || '', v => { plateNow.name = v; });
      const mOpts2 = [['', dbMats().length ? '— kein Werkstoff —' : '— kein Werkstoff angelegt —']].concat(dbMats().map(m => [m.id, m.name || '?']));
      selectRow(pg.body, 'Werkstoff', mOpts2, () => plateNow.matId || '', v => { plateNow.matId = v; selectPlate(plateNow.id); rb(); });
      numRow(pg.body, 'Stärke (mm)', () => plateNow.thk > 0 ? plateNow.thk : 0, v => { plateNow.thk = v > 0 ? v : null; selectPlate(plateNow.id); rb(); }, { min: 0, step: 0.5, norender: true, hint: 'Plattenstärke. Frästiefe = Stärke + Durchbruch-Zugabe (Gruppe Werkstück).' });
      numRow(pg.body, 'Breite X (mm)', () => +plateNow.w || 0, v => { plateNow.w = v; view = null; rr(); }, { min: 1, norender: true });
      numRow(pg.body, 'Höhe Y (mm)', () => +plateNow.h || 0, v => { plateNow.h = v; view = null; rr(); }, { min: 1, norender: true });
    }
    subhead(pg.body, T('Anordnen'));
    numRow(pg.body, 'Neue Platten: Breite X (mm)', () => C('frPlateW'), v => S('frPlateW', v), { min: 1, norender: true, hint: 'Standardmaß für Platten, die „Automatisch auf Platten verteilen“ oder „Neue Platte“ anlegt.' });
    numRow(pg.body, 'Neue Platten: Höhe Y (mm)', () => C('frPlateH'), v => S('frPlateH', v), { min: 1, norender: true });
    numRow(pg.body, 'Abstand zwischen Teilen (mm)', () => C('frGap'), v => S('frGap', v), { min: 0, step: 0.5, norender: true, hint: 'Freier Steg zwischen den Fräsbahnen benachbarter Teile und zum Plattenrand (der Fräserdurchmesser kommt automatisch dazu).' });
    numRow(pg.body, 'Durchbruch-Zugabe (mm)', () => C('frOver'), v => { S('frOver', v); if (plateNow) selectPlate(plateNow.id); rr(); }, { min: 0, step: 0.1, norender: true, hint: 'Wird beim Aktivieren einer Platte zur Stärke addiert (Frästiefe), damit das Teil sicher durchgefräst wird — Opferplatte unterlegen!' });
    boolRow(pg.body, 'Teile mit der Maus verschieben/drehen', () => C('frDrag') !== false, v => S('frDrag', v), 'Ein: Ziehen an einer Kontur verschiebt das ganze Teil; das markierte Teil hat oben einen Drehgriff (Ziehen = drehen, Shift = 15°-Raster). Ziehen im Leeren verschiebt die Ansicht. Aus: Ziehen verschiebt immer nur die Ansicht.');
    side.appendChild(pg.g);

    // Werkstück und Haltestege: eigene Gruppen oberhalb von „Werkzeug & Schnittwerte"
    const wp = grp('Fräse: Werkstück (Projekt)', true, 'fraese', { key: 'frWork' });
    numRow(wp.body, 'Gesamttiefe (mm)', () => C('frDepth'), v => { S('frDepth', v); rr(); }, { min: 0.01, step: 0.5, norender: true, hint: 'Frästiefe ab Werkstückoberkante (positiv eingeben). Für Durchbrüche etwas mehr als die Materialdicke (Opferplatte!).' });
    numRow(wp.body, 'Sicherheitshöhe Z (mm)', () => C('frSafeZ'), v => { S('frSafeZ', v); rr(); }, { min: 0.5, norender: true, hint: 'Höhe über Z0 für Eilgänge zwischen den Konturen (über Spannmittel!).' });
    side.appendChild(wp.g);
    const wt = grp('Fräse: Haltestege (Tabs)', true, 'fraese', { key: 'frTabs' });
    hint(wt.body, 'Stege, die das Teil beim letzten Durchgang an Außen-/Innenkonturen halten. Werden gleichmäßig über die Kontur verteilt und in der Vorschau grün markiert. 0 = keine Stege.');
    numRow(wt.body, 'Anzahl je Kontur', () => C('frTabs'), v => { S('frTabs', v); rr(); }, { int: true, min: 0, max: 40, norender: true });
    numRow(wt.body, 'Stegbreite (mm)', () => C('frTabW'), v => { S('frTabW', v); rr(); }, { min: 0.5, norender: true });
    numRow(wt.body, 'Steghöhe (mm)', () => C('frTabH'), v => { S('frTabH', v); rr(); }, { min: 0, step: 0.5, norender: true, hint: 'Dicke des stehenbleibenden Materials am Boden (ab Endtiefe nach oben).' });
    side.appendChild(wt.g);

    // Werkzeug & Schnittwerte
    const w = grp('Fräse: Werkzeug & Schnittwerte', true, 'fraese');
    // --- Datenbank: Werkstoff + Fräser wählen -> Schnittwerte kommen aus der DB ---
    subhead(w.body, T('Werkstoff & Fräser (Datenbank)'));
    hint(w.body, 'Werkstoffe und Fräser einmal anlegen; die Schnittwerte werden je Kombination gespeichert (Teil der Einstellungen). Danach genügt die Auswahl von Werkstoff und Fräser. Ohne Auswahl gelten die Werte unten manuell.');
    const mats = dbMats(), tools = dbTools(), mat = curMat(), tool = curTool();
    const mOpts = [['', mats.length ? '— manuell —' : '— kein Werkstoff angelegt —']].concat(mats.map(m => [m.id, m.name || '?']));
    selectRow(w.body, 'Werkstoff', mOpts, () => C('frMatId'), v => { S('frMatId', v); applyDb(); buildSidebar(); regen(); draw(); });
    const mb = document.createElement('div'); mb.style.display = 'flex'; mb.style.flexWrap = 'wrap'; mb.style.gap = '4px';
    mb.appendChild(mkMini(T('Neuer Werkstoff'), () => { addMat(); rb(); }));
    if (mat) mb.appendChild(mkMini(T('Werkstoff löschen'), () => { delMat(); rb(); }));
    w.body.appendChild(mb);
    if (mat) txtRow(w.body, 'Name', () => mat.name || '', v => { mat.name = v; saveDb(); });
    const tOpts = [['', tools.length ? '— manuell —' : '— kein Fräser angelegt —']].concat(tools.map(t => [t.id, toolLabel(t)]));
    selectRow(w.body, 'Fräser', tOpts, () => C('frToolId'), v => { S('frToolId', v); applyDb(); buildSidebar(); regen(); draw(); });
    const tb = document.createElement('div'); tb.style.display = 'flex'; tb.style.flexWrap = 'wrap'; tb.style.gap = '4px';
    tb.appendChild(mkMini(T('Neuer Fräser'), () => { addTool(); rb(); }));
    if (tool) tb.appendChild(mkMini(T('Fräser löschen'), () => { delTool(); rb(); }));
    w.body.appendChild(tb);
    if (tool) {
      txtRow(w.body, 'Bezeichnung', () => tool.name || '', v => { tool.name = v; saveDb(); });
      selectRow(w.body, 'Fräsertyp', TOOL_TYPES, () => tool.type || 'other', v => { tool.type = v; saveDb(); buildSidebar(); });
    }
    // Die zwei wichtigsten Werte direkt im Hauptmenü (ohne Aufklappen erreichbar).
    numRow(w.body, 'Vorschub XY (mm/min)', () => C('frFeed'), v => { setCut('frFeed', v); rr(); }, { min: 1, norender: true });
    numRow(w.body, 'Zustellung je Durchgang (mm)', () => C('frStep'), v => { setCut('frStep', v); rr(); }, { min: 0.01, step: 0.5, norender: true, hint: 'Eintauchtiefe je Fräsgang. Richtwert: halber Fräserdurchmesser bei Holz/Schaum, weniger bei Kunststoff/Alu.' });
    // Weitere Schnittwerte als zuklappbares Untermenü.
    const key = cutKey();
    const sw = grp(key ? T('Schnittwerte') + ': ' + (mat.name || '?') + ' / ' + toolLabel(tool) : 'Schnittwerte (manuell)', false, 'fraese', { key: 'frCut' }); sw.g.classList.add('grp-sub');
    { const body = w.body; w.body = sw.body;
    if (key) {
      hint(w.body, cutFresh === key
        ? 'Für diese Kombination gab es noch keine Werte — sie wurden aus den aktuellen Feldern neu angelegt. Bitte prüfen und anpassen; Änderungen werden in der Datenbank gespeichert.'
        : 'Diese Werte gehören zur gewählten Kombination Werkstoff / Fräser und werden bei jeder Änderung in der Datenbank gespeichert.');
    }
    if (tool) numRow(w.body, 'Fräserdurchmesser (mm)', () => +tool.dia || 0, v => { tool.dia = v; S('frTool', v); saveDb(); rr(); }, { min: 0.1, step: 0.1, norender: true, hint: 'Durchmesser des gewählten Fräsers (wird im Fräser gespeichert). Bestimmt den seitlichen Versatz bei Außen-/Innenkonturen und die Bahnbreite in Taschen.' });
    else numRow(w.body, 'Fräserdurchmesser (mm)', () => C('frTool'), v => { S('frTool', v); rr(); }, { min: 0.1, step: 0.1, norender: true, hint: 'Durchmesser des Fräsers. Bestimmt den seitlichen Versatz bei Außen-/Innenkonturen und die Bahnbreite in Taschen.' });
    numRow(w.body, 'Spindeldrehzahl (1/min)', () => C('frRpm'), v => { setCut('frRpm', v); const r = $('#frRpm'); if (r) r.value = v; rr(); }, { int: true, min: 0, norender: true, hint: 'S-Wert für M3. 0 = keine Spindelbefehle im Programm (z. B. Spindel von Hand geschaltet).' });
    numRow(w.body, 'Eintauch-Vorschub Z (mm/min)', () => C('frPlunge'), v => { setCut('frPlunge', v); rr(); }, { min: 1, norender: true, hint: 'Vorschub beim senkrechten Eintauchen und Bohren — deutlich niedriger als der XY-Vorschub.' });
    selectRow(w.body, 'Fräsrichtung', [['climb', 'Gleichlauf (empfohlen)'], ['conv', 'Gegenlauf']], () => C('frDir'), v => { setCut('frDir', v); rr(); },
      'Gleichlauf: Fräser läuft mit der Vorschubrichtung (rechtsdrehende Spindel: Außenkontur im Uhrzeigersinn) — sauberere Kante, weniger Ausriss. Gegenlauf bei sehr weichem Aufbau oder Spiel in der Mechanik.');
    numRow(w.body, 'Tasche: seitliche Zustellung (%)', () => C('frPocketOv'), v => { setCut('frPocketOv', v); rr(); }, { int: true, min: 5, max: 95, norender: true, hint: 'Abstand der Bahnen in Taschen in Prozent des Fräserdurchmessers (≤ 50 % = keine Reststege).' });
    numRow(w.body, 'Bohren: Spanbruch alle (mm)', () => C('frDrillPeck'), v => { setCut('frDrillPeck', v); rr(); }, { min: 0, step: 0.5, norender: true, hint: '0 = in einem Zug bohren; sonst nach jeweils dieser Tiefe kurz zurückziehen (Späne brechen).' });
    subhead(w.body, T('Eintauchen & Bahn'));
    selectRow(w.body, 'Eintauchen', [['plunge', 'senkrecht (Eintauch-Vorschub)'], ['ramp', 'Rampe entlang der Bahn'], ['helix', 'Helix (Taschen), sonst Rampe']], () => C('frEntry'), v => { S('frEntry', v); rr(); },
      'Rampe: der Fräser taucht schräg entlang der Kontur ein (schont Fräser und Spindel, nötig bei Fräsern ohne Stirnschneide). Helix: in Taschen spiralförmig um den Startpunkt nach unten. Bei Haltestegen wird im letzten Durchgang immer senkrecht eingetaucht.');
    numRow(w.body, 'Rampenwinkel (°)', () => C('frRampAng'), v => { S('frRampAng', v); rr(); }, { min: 0.5, max: 45, step: 0.5, norender: true, hint: 'Neigung der Rampe. Üblich 2–5° bei Alu, bis 10–15° bei Holz/Schaum.' });
    numRow(w.body, 'Schlichtaufmaß (mm)', () => C('frFinish'), v => { S('frFinish', v); rr(); }, { min: 0, step: 0.1, norender: true, hint: '> 0: Schruppen lässt seitlich dieses Aufmaß stehen, danach ein Schlichtdurchgang in voller Tiefe auf Endmaß (saubere Wand). 0 = kein Schlichtdurchgang.' });
    boolRow(w.body, 'Kreisbögen als G2/G3', () => C('frArcs') !== false, v => { S('frArcs', v); rr(); }, 'Erkannte Kreisbögen als G2/G3 ausgeben (kürzeres Programm, ruhigerer Lauf). Aus = alles als Polylinie.');
    body.appendChild(sw.g);
    w.body = body; }
    boolRow(w.body, 'Am Ende auf X0/Y0 zurück', () => C('frRetract'), v => { S('frRetract', v); rr(); });
    side.appendChild(w.g);

    // G-Code
    const x = grp('Fräse: G-Code', true, 'fraese');
    const info = document.createElement('div'); info.className = 'hint'; info.id = 'frGInfo';
    if (cam && cam.segs.length) info.textContent = cam.lines.length + T(' Zeilen · Fräsweg ') + (cam.lenCut / 1000).toFixed(2) + ' m · ' + T('ca.') + ' ' + fmtTime(cam.time * 60);
    else info.textContent = T('Noch kein G-Code (Geometrie laden).');
    x.body.appendChild(info);
    const xb = document.createElement('div'); xb.style.display = 'flex'; xb.style.flexWrap = 'wrap'; xb.style.gap = '4px';
    xb.appendChild(mkMini(T('G-Code speichern…'), saveGcode));
    xb.appendChild(mkMini(T('In Maschine übernehmen'), useCam));
    xb.appendChild(mkMini(T('▶ Simulieren'), simToggle));
    x.body.appendChild(xb);
    hint(x.body, 'GRBL-kompatibel: G21 G90 G17, M3 S / M5, nur G0/G1 (Bögen als Polylinien). Tiefenpässe von oben nach unten, Eilgänge auf Sicherheitshöhe.');
    side.appendChild(x.g);

    // Maschine
    const m = grp('Fräse: Maschine', false, 'fraese');
    hint(m.body, 'Grenzen des Arbeitsraums ab Werkstück-Nullpunkt. Überschreitet ein Programm diese Werte, wird der Start verweigert. 0 = kein Limit. Gehört zu den Einstellungen (nicht zum Projekt).');
    numRow(m.body, 'Max. Fahrweg X (mm)', () => C('frMaxX'), v => { S('frMaxX', v); view = null; draw(); }, { min: 0, norender: true });
    numRow(m.body, 'Max. Fahrweg Y (mm)', () => C('frMaxY'), v => { S('frMaxY', v); view = null; draw(); }, { min: 0, norender: true });
    numRow(m.body, 'Max. Tiefe Z (mm)', () => C('frMaxZ'), v => S('frMaxZ', v), { min: 0, norender: true });
    numRow(m.body, 'Max. Vorschub (mm/min)', () => C('frMaxFeed'), v => S('frMaxFeed', v), { min: 0, norender: true });
    subhead(m.body, T('Z-Taster'));
    numRow(m.body, 'Plättchendicke (mm)', () => C('frProbeThk'), v => S('frProbeThk', v), { min: 0, step: 0.1, norender: true, hint: 'Dicke des Tastplättchens auf dem Werkstück. Nach dem Tasten wird Z = Plättchendicke gesetzt.' });
    numRow(m.body, 'Max. Tastweg (mm)', () => C('frProbeDist'), v => S('frProbeDist', v), { min: 1, norender: true });
    numRow(m.body, 'Tastvorschub (mm/min)', () => C('frProbeFeed'), v => S('frProbeFeed', v), { min: 1, norender: true });
    side.appendChild(m.g);
  }

  // ---------- Lebenszyklus -----------------------------------------------------
  let inited = false;
  function init() { if (inited) return; inited = true; bindCanvas(); initMachine(); }
  function show() { init(); fit(); regen(); draw(); }
  function resize() { if (state.activeTab !== 'fraese') return; fit(); draw(); }
  function refresh() { if (state.activeTab !== 'fraese') return; regen(); draw(); }

  Object.assign(App, { fraeseSidebar });
  window.Fraese = { show, resize, refresh, draw, regen, importDxfText, importFromCad, importFromRibs, useCam, saveGcode, gcode: () => (regen(), cam && cam.text || ''),
    _test: { buildCam, offsetClosed, circleInfo, addJobsFromLoops, checkLimits, jobs, fitArcs, clipPath, subPath, jobParams, dbMats, dbTools, dbCut, addMat, addTool, applyDb, setCut, cutKey, parts, plates, nestParts, nestActive, distributeAll, selectPlate, movePart, rotatePart, partBbox, ensureParts } };
})();
