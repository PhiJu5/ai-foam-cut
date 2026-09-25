/* rumpf.js — Reiter „Rumpf": Rumpfkonstruktion aus Bezier-Splines mit Tangenten
 * (Seitenansicht, Draufsicht, Spanten). Feature „rumpf", optional — andere
 * Module rufen nur geschützt.
 *
 * KONZEPT (seit 2026-09-07: Splines mit wenigen Stützpunkten, alle über
 * Tangenten bearbeitbar; vorher: NURBS-Interpolation durch viele Punkte)
 *   1. Eingabe = Stationen entlang der Rumpflänge X. Je Station:
 *        Seitenansicht : Oberkante (top) und Unterkante (bot) in Y
 *        Draufsicht    : halbe Breite (w) in Z
 *        Spant         : Knoten der halben Querschnittskurve (rechte Seite,
 *                        von der Oberkante zur Unterkante), normiert
 *                        (y: 0 = Unterkante .. 1 = Oberkante, z: 1 = halbe
 *                        Breite), jeder Knoten mit ein-/auslaufender Tangente.
 *                        Standard = Kreisbögen (3 Knoten: oben, breiteste
 *                        Stelle, unten); Knoten lassen sich hinzufügen (Hügel,
 *                        Ecken) — die Tangenten machen daraus Eier usw.
 *      Die Längslinien (Oberkante, Unterkante, Breite) sind zusammengesetzte
 *      kubische Bezier-Kurven durch die Stationen; die Tangenten je Station
 *      sind automatisch (Catmull-Rom) oder vom Nutzer gezogen. Die Nase ist
 *      kein Punkt, sondern eine (kleine) erste Station mit eigenem Querschnitt,
 *      der als Deckel geschlossen wird; Breite 0 am Heck = Messerkante.
 *   2. Fläche = Loft: an jeder Stelle x wird der Spant aus top(x), bot(x),
 *      w(x) und den in x weich überblendeten (Catmull-Rom) Knoten/Tangenten
 *      aller Stationen gebildet. Jeder Schnitt x = const ist damit exakt eben
 *      und die Silhouetten folgen genau den gezeichneten Splines.
 *   3. Auswertung: Abtastung (Gitter u × x) -> Spiegelung -> geschlossenes
 *      Dreiecksnetz -> STL; Spant an beliebiger X-Lage exakt aus der
 *      Beschreibung -> DXF.
 *
 * Koordinaten wie im Programm: X = Rumpflänge (Nase 0 -> Heck), Y = hoch,
 * Z = seitlich (nur die rechte Hälfte wird modelliert, Z >= 0).
 * Station: { x, top, bot, w, fix: ''|'lock'|'circle', nodes: [{y,z,i:[dy,dz],o:[dy,dz]}],
 *            tan: { top|bot|w: { i:[dx,dv], o:[dx,dv] } } }   (i = einlaufend, o = auslaufend;
 *            Bezier-Griffe = Punkt + Vektor; fehlend = automatisch)
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;
  const { grp, hint, subhead, numRow, boolRow, selectRow, mkMini, buildSidebar } = App;
  const KAPPA = 0.5523;   // Bezier-Kreisbogen (Viertelkreis)
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;

  // ---------- Spantknoten -------------------------------------------------------
  // Kreisbögen: 3 Knoten, breiteste Stelle bei normierter Höhe m.
  function circleNodes(m) {
    m = clamp(+m || 0.5, 0.05, 0.95);
    return [
      { y: 1, z: 0, i: [0, 0], o: [0, KAPPA] },
      { y: m, z: 1, i: [KAPPA * (1 - m), 0], o: [-KAPPA * m, 0] },
      { y: 0, z: 0, i: [0, KAPPA], o: [0, 0] }
    ];
  }
  // ---------- Vorlagen ------------------------------------------------------------
  // [x, top, bot, w, m (breiteste Stelle normiert), tan]
  function tpl(rows) { return rows.map(r => ({ x: r[0], top: r[1], bot: r[2], w: r[3], fix: '', nodes: circleNodes(r[4] == null ? 0.5 : r[4]), tan: r[5] || {} })); }
  const TPL = {
    segler: () => tpl([
      [0, -4, -12, 5, 0.5, { top: { o: [3, 14] }, bot: { o: [3, -14] }, w: { o: [3, 12] } }],
      [30, 14, -30, 17, 0.55],
      [110, 40, -50, 34, 0.5],
      [250, 58, -58, 44, 0.5],
      [450, 44, -38, 32, 0.5],
      [700, 18, -8, 12, 0.55],
      [1100, 8, 2, 0, 0.5]
    ]),
    motor: () => tpl([
      [0, 24, -24, 24, 0.5, { top: { o: [4, 8] }, bot: { o: [4, -8] }, w: { o: [4, 6] } }],
      [60, 36, -38, 34, 0.5],
      [200, 50, -44, 40, 0.45],
      [400, 40, -40, 32, 0.5],
      [650, 22, -20, 16, 0.5],
      [900, 10, -6, 6, 0.5]
    ])
  };

  // ---------- Konfiguration (state.cfg.rumpf*) ------------------------------
  const DEF = {
    rumpfSt: null,             // Stationen (Array) — null = Vorlage Segler
    rumpfNu: 32,               // Abtastung: Schritte um den Halbspant
    rumpfNv: 160,              // Abtastung: Schritte in Längsrichtung
    rumpfView: '3d',           // '3d' | 'side' | 'top' | 'sec'
    rumpfSel: 0,               // ausgewählte Station
    rumpfCutX: 300,            // Schnittansicht: X-Lage (mm)
    rumpfUp: 'z',              // STL: 'z' hoch (Druck/Fräse) | 'y' wie im Programm
    rumpfShowSt: true,         // Stationskurven in 3D anzeigen
    rumpfShowTan: false,       // Tangenten aller Stationen (statt nur der gewählten) zeigen
    rumpfImgOp: 55,            // Hintergrundbild: Deckkraft %
    rumpfImgSide: null,        // { len, x, y, flip } Bildmaßstab/Lage Seitenansicht (Bilddaten nur im RAM)
    rumpfImgTop: null,
    rumpfImgFront: null,       // Vorderansicht / Spant (Z/Y)
    // Anbauten (je Spant in die Rumpfkontur eingerechnet, siehe „Anbauten" unten)
    rumpfWing: { on: false, src: 'wing', prof: null, xLE: 250, yLE: 20, chord: 0, alpha: 2, z: 0, R: 12, lf: 40, lb: 30 },
    rumpfFin: { on: false, xLE: 0, y0Auto: true, y0: 0, cr: 180, h: 220, angLE: 30, angTE: 8, angTip: 0, leR: 60,
      srcR: 'naca', thkR: 9, profR: null, srcT: 'naca', thkT: 8, profT: null, R: 10, tipRound: 20 },
    rumpfRender: 'fine',       // 3D: 'fine' WebGL glatt + Glanz | 'flat' WebGL flach | 'wire' Drahtmodell | '2d' Canvas-2D (ohne WebGL)
    rumpfShowWing: true,       // Tragfläche aus dem Tragflächendesign am Anschluss zeigen (nur Anzeige)
    rumpfColBody: '#3d7ea6', rumpfColFin: '#b07fd0', rumpfColAtt: '#5fb87f', rumpfColWing: '#c98a3a'
  };
  function C(k) {
    if (state.cfg[k] == null) {
      const d = DEF[k];
      state.cfg[k] = (d && typeof d === 'object') ? JSON.parse(JSON.stringify(d)) : d;
      if (k === 'rumpfSt') state.cfg[k] = TPL.segler();
    }
    return state.cfg[k];
  }
  function S(k, v) { state.cfg[k] = v; }
  // Altstände (Superellipse nT/nB, freie Form shape, yw) in Knoten überführen.
  function norm(s) {
    s.x = +s.x || 0; s.top = +s.top || 0; s.bot = +s.bot || 0; s.w = Math.max(0, +s.w || 0);
    if (!Array.isArray(s.nodes) || s.nodes.length < 2) { const h = s.top - s.bot; s.nodes = circleNodes(h > 0 && s.yw != null ? (s.yw - s.bot) / h : 0.5); }
    if (s.fix === 'shape' || (s.fix !== 'lock' && s.fix !== 'circle')) s.fix = '';
    if (!s.tan || typeof s.tan !== 'object') s.tan = {};
    s.xfix = !!s.xfix;
    delete s.nT; delete s.nB; delete s.shape; delete s.yw;
    return s;
  }
  function stations() {
    let a = C('rumpfSt');
    if (!Array.isArray(a) || !a.length) { S('rumpfSt', TPL.segler()); a = C('rumpfSt'); }
    a.forEach(norm);
    return a;
  }
  function sortedSt() { return stations().slice().sort((a, b) => a.x - b.x); }
  const IMG_KEY = { side: 'rumpfImgSide', top: 'rumpfImgTop', sec: 'rumpfImgFront' };
  function selIdx() { const st = stations(); return Math.min(Math.max(0, Math.round(C('rumpfSel'))), st.length - 1); }
  let selNode = 1;   // gewählter Knoten der gewählten Station (Spantansicht)

  // Breiteste Stelle: Knoten mit größtem z (normiert 1).
  function widestIdx(s) { let k = 0; for (let j = 1; j < s.nodes.length; j++) if (s.nodes[j].z > s.nodes[k].z + 1e-9) k = j; return k; }
  function ywOf(s) { return s.bot + s.nodes[widestIdx(s)].y * (s.top - s.bot); }
  function setYw(s, v) {
    if (s.fix === 'circle') { const r = (s.top - s.bot) / 2; s.top = r2(v + r); s.bot = r2(v - r); return; }
    if (s.fix === 'lock') return;
    const h = s.top - s.bot, k = widestIdx(s); if (!(h > 0) || k === 0 || k === s.nodes.length - 1) return;
    s.nodes[k].y = clamp((v - s.bot) / h, 0.02, 0.98);
  }

  // ---------- Bezier-Grundlagen ------------------------------------------------------
  function bez2(P, t) {
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0], a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1]];
  }
  function bez1(p0, p1, p2, p3, t) { const u = 1 - t; return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3; }
  // Parameter t zu x (x(t) monoton, da Griffe im Intervall liegen).
  function solveT(P, x) { let lo = 0, hi = 1; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (bez2(P, m)[0] < x) lo = m; else hi = m; } return (lo + hi) / 2; }
  // de Casteljau: Teilung bei t. Liefert die beiden Teilkurven.
  function splitBez(P, t) {
    const L = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const P01 = L(P[0], P[1]), P12 = L(P[1], P[2]), P23 = L(P[2], P[3]), P012 = L(P01, P12), P123 = L(P12, P23), M = L(P012, P123);
    return [[P[0], P01, P012, M], [M, P123, P23, P[3]]];
  }

  // ---------- Längslinien (top / bot / w über x) ----------------------------------------
  function lval(s, key) { return key === 'w' ? s.w : s[key]; }
  function tanAuto(sts, j, key) {
    const s = sts[j], p = sts[j - 1], n = sts[j + 1], v = lval(s, key);
    let i = [0, 0], o = [0, 0];
    if (p && n) { const D = (n.x - p.x) || 1, dv = lval(n, key) - lval(p, key); o = [(n.x - s.x) / 3, dv * (n.x - s.x) / D / 3]; i = [-(s.x - p.x) / 3, -dv * (s.x - p.x) / D / 3]; }
    else if (n) o = [(n.x - s.x) / 3, (lval(n, key) - v) / 3];
    else if (p) i = [-(s.x - p.x) / 3, -(v - lval(p, key)) / 3];
    return { i, o };
  }
  // Tangente (Bezier-Griffvektoren) einer Station: explizit oder automatisch. Kreis: Breite folgt Ober-/Unterkante.
  function tanOf(sts, j, key) {
    const s = sts[j];
    if (s.fix === 'circle' && key === 'w') {
      const a = tanOf(sts, j, 'top'), b = tanOf(sts, j, 'bot');
      return { i: [(a.i[0] + b.i[0]) / 2, (a.i[1] - b.i[1]) / 2], o: [(a.o[0] + b.o[0]) / 2, (a.o[1] - b.o[1]) / 2], explicit: a.explicit || b.explicit };
    }
    const a = tanAuto(sts, j, key), t = (s.tan && s.tan[key]) || {};
    return { i: Array.isArray(t.i) ? t.i.slice() : a.i, o: Array.isArray(t.o) ? t.o.slice() : a.o, explicit: !!(t.i || t.o) };
  }
  function lineSegs(sts, key) {
    const segs = [];
    for (let j = 0; j + 1 < sts.length; j++) {
      const a = sts[j], b = sts[j + 1], D = b.x - a.x, ta = tanOf(sts, j, key), tb = tanOf(sts, j + 1, key);
      const o = [clamp(ta.o[0], 0, D), ta.o[1]], i = [clamp(tb.i[0], -D, 0), tb.i[1]];
      const va = lval(a, key), vb = lval(b, key);
      segs.push({ x0: a.x, x1: b.x, P: [[a.x, va], [a.x + o[0], va + o[1]], [b.x + i[0], vb + i[1]], [b.x, vb]] });
    }
    return segs;
  }
  function segAt(segs, x) { let sg = segs[0]; for (const g of segs) { sg = g; if (x <= g.x1) break; } return sg; }
  function lineAt(segs, x) {
    if (!segs.length) return 0;
    const sg = segAt(segs, x);
    if (x <= sg.x0) return sg.P[0][1]; if (x >= sg.x1) return sg.P[3][1];
    return bez2(sg.P, solveT(sg.P, x))[1];
  }
  function linePts(segs, N) { const out = []; for (const sg of segs) for (let k = (out.length ? 1 : 0); k <= N; k++) out.push(bez2(sg.P, k / N)); return out; }

  // ---------- Spantkurve (Knoten -> Punkte) --------------------------------------------
  // nodes: {y,z,i,o} (normiert oder physisch). Liefert [[y,z], ...], perSeg Punkte je Segment.
  function polyOf(nodes, perSeg) {
    const out = [[nodes[0].y, nodes[0].z]];
    for (let k = 0; k + 1 < nodes.length; k++) {
      const a = nodes[k], b = nodes[k + 1];
      const P = [[a.y, a.z], [a.y + a.o[0], a.z + a.o[1]], [b.y + b.i[0], b.z + b.i[1]], [b.y, b.z]];
      for (let q = 1; q <= perSeg; q++) out.push(bez2(P, q / perSeg));
    }
    return out;
  }
  function segP(a, b) { return [[a.y, a.z], [a.y + a.o[0], a.z + a.o[1]], [b.y + b.i[0], b.z + b.i[1]], [b.y, b.z]]; }
  // Knoten einfügen: Segment k bei t teilen (Form bleibt exakt).
  function splitSeg(nodes, k, t) {
    const a = nodes[k], b = nodes[k + 1], [A, B] = splitBez(segP(a, b), t), M = A[3];
    a.o = [A[1][0] - A[0][0], A[1][1] - A[0][1]];
    b.i = [B[2][0] - B[3][0], B[2][1] - B[3][1]];
    nodes.splice(k + 1, 0, { y: M[0], z: M[1], i: [A[2][0] - M[0], A[2][1] - M[1]], o: [B[1][0] - M[0], B[1][1] - M[1]] });
    return nodes;
  }
  function longestSeg(nodes) { let k = 0, best = -1; for (let j = 0; j + 1 < nodes.length; j++) { const d = Math.hypot(nodes[j + 1].y - nodes[j].y, nodes[j + 1].z - nodes[j].z); if (d > best) { best = d; k = j; } } return k; }
  // Nach Formänderung: größtes z der Kurve = 1 (halbe Breite bleibt die Breite).
  function normalizeShape(s) {
    const P = polyOf(s.nodes, 16); let zm = 0; for (const q of P) zm = Math.max(zm, q[1]);
    if (zm > 1e-9 && Math.abs(zm - 1) > 1e-6) { for (const n of s.nodes) { n.z /= zm; n.i[1] /= zm; n.o[1] /= zm; } s.w = r2(s.w * zm); }
    for (const n of s.nodes) n.z = Math.max(0, n.z);
  }
  // Tangenten je Knoten glätten (ein-/auslaufend gleiche Richtung, Längen bleiben).
  function smoothNodes(s) {
    const n = s.nodes.length;
    s.nodes.forEach((q, k) => {
      if (k === 0) { q.o = [0, Math.max(0.01, Math.hypot(q.o[0], q.o[1]))]; return; }
      if (k === n - 1) { q.i = [0, Math.max(0.01, Math.hypot(q.i[0], q.i[1]))]; return; }
      const d = [q.o[0] - q.i[0], q.o[1] - q.i[1]], L = Math.hypot(d[0], d[1]); if (L < 1e-9) return;
      const li = Math.hypot(q.i[0], q.i[1]), lo = Math.hypot(q.o[0], q.o[1]);
      q.i = [-d[0] / L * li, -d[1] / L * li]; q.o = [d[0] / L * lo, d[1] / L * lo];
    });
  }
  // Alle Stationen auf gleiche Knotenzahl bringen (Kopien; Teilung des längsten Segments).
  function unify(sts) {
    const N = Math.max(...sts.map(s => s.nodes.length));
    return sts.map(s => { const nd = JSON.parse(JSON.stringify(s.nodes)); while (nd.length < N) splitSeg(nd, longestSeg(nd), 0.5); return nd; });
  }
  const flat = nd => { const a = []; for (const q of nd) a.push(q.y, q.z, q.i[0], q.i[1], q.o[0], q.o[1]); return a; };
  const unflat = a => { const nd = []; for (let k = 0; k < a.length; k += 6) nd.push({ y: a[k], z: Math.max(0, a[k + 1]), i: [a[k + 2], a[k + 3]], o: [a[k + 4], a[k + 5]] }); return nd; };

  // ---------- Anbauten: Tragflächenübergang & Seitenleitwerk ------------------------------
  // Beide werden je Schnitt x = const in den Halbspant (Polylinie [[y,z],…] von oben nach
  // unten, z >= 0) eingerechnet: Anbaukontur ∪ Rumpfkontur, konkave Ecken mit Radius R
  // verrundet (Hohlkehle). Weil jeder Schnitt eben bleibt, gehen STL und DXF-Spanten
  // unverändert. Seglertypisch: die Wurzelrippe wird als ebene „Anformung" bis Z = zf aus
  // dem Rumpf herausgezogen (Fläche stößt an eine ebene Fläche), davor/dahinter läuft die
  // Anformung mit Smoothstep in die Rumpfflanke aus; das Seitenleitwerk ist ein Loft von
  // Wurzel- zu Spitzenprofil mit Pfeilung, Randbogen und Rückenflosse (Dorsal) am Fuß.
  function WG() { const w = C('rumpfWing'), d = DEF.rumpfWing; for (const k in d) if (w[k] === undefined) w[k] = d[k]; return w; }
  function FN() {
    const f = C('rumpfFin'), d = DEF.rumpfFin;
    // Altstand (Pfeilung/Spitzentiefe/Rückenflosse in mm) -> Winkel und Übergangsradius
    if (f.angLE === undefined && f.sweep !== undefined) {
      const h = Math.max(1, +f.h || 1), sw = +f.sweep || 0, ct = +f.ct || 0, cr = +f.cr || 1;
      f.angLE = r1(Math.atan2(sw, h) * 180 / Math.PI); f.angTE = r1(Math.atan2(sw + ct - cr, h) * 180 / Math.PI); f.angTip = 0; f.leR = Math.max(0, +f.dorsal || 0);
    }
    delete f.sweep; delete f.ct; delete f.dorsal;
    for (const k in d) if (f[k] === undefined) f[k] = d[k];
    return f;
  }
  const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  // Normiertes Profil ({x,y}, x 0..1) -> Ober-/Unterseite und halbe Dicke als Funktion von u.
  function profFn(pts) {
    if (!Array.isArray(pts) || pts.length < 4) return null;
    let iLE = 0; for (let i = 1; i < pts.length; i++) if (pts[i].x < pts[iLE].x) iLE = i;
    const A = pts.slice(0, iLE + 1), B = pts.slice(iLE);
    const my = a => a.reduce((s, p) => s + p.y, 0) / (a.length || 1);
    let up = A, lo = B; if (my(A) < my(B)) { up = B; lo = A; }
    const sx = a => a.slice().sort((p, q) => p.x - q.x); up = sx(up); lo = sx(lo);
    if (up.length < 2 || lo.length < 2) return null;
    const at = (a, u) => {
      if (u <= a[0].x) return a[0].y; if (u >= a[a.length - 1].x) return a[a.length - 1].y;
      let l = 0, h = a.length - 1; while (h - l > 1) { const m = (l + h) >> 1; if (a[m].x <= u) l = m; else h = m; }
      const d = a[h].x - a[l].x; return d > 1e-12 ? a[l].y + (a[h].y - a[l].y) * (u - a[l].x) / d : a[l].y;
    };
    return { up: u => at(up, u), lo: u => at(lo, u), t: u => Math.max(0, (at(up, u) - at(lo, u)) / 2) };
  }
  // Rumpfkontur: äußerster Schnittpunkt mit der Waagrechten y (null = keiner).
  function crossY(P, y) {
    let best = null;
    for (let k = 0; k + 1 < P.length; k++) {
      const a = P[k], b = P[k + 1]; if (a[0] === b[0] || (y - a[0]) * (y - b[0]) > 0) continue;
      const t = (y - a[0]) / (b[0] - a[0]), z = a[1] + (b[1] - a[1]) * t;
      if (!best || z > best.z) best = { y, z, k, t };
    }
    return best;
  }
  function distPoly(P, c) {
    let best = null;
    for (let k = 0; k + 1 < P.length; k++) {
      const a = P[k], b = P[k + 1], dy = b[0] - a[0], dz = b[1] - a[1], L2 = dy * dy + dz * dz;
      const t = L2 > 1e-12 ? clamp(((c[0] - a[0]) * dy + (c[1] - a[1]) * dz) / L2, 0, 1) : 0;
      const y = a[0] + dy * t, z = a[1] + dz * t, d = Math.hypot(c[0] - y, c[1] - z);
      if (!best || d < best.d) best = { d, y, z, k, t };
    }
    return best;
  }
  // Hohlkehle: Kreismittelpunkte cen(s) = { c:[y,z], q:[y,z] } laufen von der Ecke (s = 0) entlang der
  // Anbaukontur weg (q = Berührpunkt auf dem Anbau, c = q + R·Normale). Gesucht ist die erste Lage
  // mit Abstand R zur Rumpfkontur -> Kreis berührt beide. Liefert { T (auf Rumpf), q, c, s } oder null.
  function solveFillet(P, cen, R) {
    if (!(R > 0.05) || !P || P.length < 2) return null;
    const N = 40, d0 = distPoly(P, cen(0).c);
    if (!d0 || d0.d >= R) return null;
    let prev = 0;
    for (let i = 1; i <= N; i++) {
      const s = i / N;
      if (distPoly(P, cen(s).c).d >= R) {
        let lo = prev, hi = s;
        for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (distPoly(P, cen(m).c).d >= R) hi = m; else lo = m; }
        const g = cen(hi); return { T: distPoly(P, g.c), q: g.q, c: g.c, s: hi };
      }
      prev = s;
    }
    return null;
  }
  function arcPts(c, R, from, to, n) {
    const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]), a1 = Math.atan2(to[1] - c[1], to[0] - c[0]);
    let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const out = []; for (let i = 0; i <= n; i++) { const a = a0 + d * i / n; out.push([c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)]); }
    return out;
  }
  const cutBefore = (P, T) => P.slice(0, T.k + 1).concat([[T.y, T.z]]);
  const cutAfter = (P, T) => [[T.y, T.z]].concat(P.slice(T.k + 1));
  const NACA = {};
  function nacaProf(thk) { const t = clamp(Math.round(+thk || 9), 1, 40); return NACA[t] || (NACA[t] = Airfoil.naca4('00' + String(t).padStart(2, '0'), 80)); }

  // --- Tragflächenübergang
  function wingProf(w) {
    if (w.src === 'dat') return w.prof && w.prof.pts ? profFn(w.prof.pts) : null;
    return profFn(state.root && state.root.profile);
  }
  function wingGeom(m) {
    const w = WG(); if (!w.on) return null;
    const pf = wingProf(w); if (!pf) return null;
    const chord = +w.chord > 0 ? +w.chord : (state.root && +state.root.chord) || 200;
    const xLE = +w.xLE || 0;
    let zf = +w.z;
    if (!(zf > 0)) { let wm = 0; for (let i = 0; i <= 20; i++) wm = Math.max(wm, lineAt(m.L.w, xLE + chord * i / 20)); zf = wm + 15; }
    return { pf, chord, xLE, yLE: +w.yLE || 0, tanA: Math.tan((+w.alpha || 0) * Math.PI / 180), zf, R: Math.max(0, +w.R || 0), lf: Math.max(0, +w.lf || 0), lb: Math.max(0, +w.lb || 0), name: w.src === 'dat' ? (w.prof && w.prof.name) : (state.root && state.root.profile && state.root.profile.name) };
  }
  // Ober-/Unterkante des Wurzelprofils bei x (Y, mit Einstellwinkel um die Nase gekippt).
  function wingYs(g, x) {
    const dx = clamp(x - g.xLE, 0, g.chord), u = dx / g.chord;
    return { yu: g.yLE + g.chord * g.pf.up(u) - dx * g.tanA, yl: g.yLE + g.chord * g.pf.lo(u) - dx * g.tanA };
  }
  // Punkte tragen als 3. Wert die Herkunft (0 Rumpf, 1 Leitwerk, 2 Anformung) für die Farbgebung.
  function wingHalf(g, x, P) {
    if (!g || !P || P.length < 2) return P;
    const xa = g.xLE - g.lf, xb = g.xLE + g.chord + g.lb; if (x < xa || x > xb) return P;
    let s = 1;
    if (x < g.xLE) s = g.lf > 0 ? smooth((x - xa) / g.lf) : 1; else if (x > g.xLE + g.chord) s = g.lb > 0 ? smooth((xb - x) / g.lb) : 1;
    if (s <= 1e-6) return P;
    const { yu, yl } = wingYs(g, x), top = P[0][0], bot = P[P.length - 1][0];
    if (yl >= top || yu <= bot) return P;
    // Breiteste Stelle des Rumpfs im Höhenbereich der Rippe: Die Anlage-Ebene liegt immer außerhalb
    // des Rumpfs (zf >= zb) — sonst schneidet sie Kerben; beim Ausblenden (s -> 0) zieht sich die
    // Anformung samt Höhe auf diesen Punkt zusammen, so bleibt der Übergang stetig und tangential.
    let zb = -1, ym = (yu + yl) / 2;
    for (const q of P) if (q[0] <= yu && q[0] >= yl && q[1] > zb) { zb = q[1]; ym = q[0]; }
    for (const c of [crossY(P, Math.min(yu, top - 1e-6)), crossY(P, Math.max(yl, bot + 1e-6))]) if (c && c.z > zb) { zb = c.z; ym = c.y; }
    if (zb < 0) return P;
    const yuS = ym + s * (yu - ym), ylS = ym + s * (yl - ym), zf = zb + s * (Math.max(g.zf, zb + 0.5) - zb), R = g.R * s, A = 2;
    if (zf <= zb + 0.02 || yuS - ylS < 0.05) return P;
    const cu = yuS < top ? crossY(P, yuS) : null, cl = ylS > bot ? crossY(P, ylS) : null;
    const tagA = q => [q[0], q[1], A];
    let up, lo;
    if (!cu) up = [[yuS, 0, A], [yuS, zf, A]];
    else {
      const f = solveFillet(P, t => { const z = cu.z + t * (zf - cu.z); return { c: [yuS + R, z], q: [yuS, z] }; }, R);
      up = f ? cutBefore(P, f.T).concat(arcPts(f.c, R, [f.T.y, f.T.z], f.q, 8).slice(1).map(tagA), [[yuS, zf, A]]) : cutBefore(P, cu).concat([[yuS, zf, A]]);
    }
    if (!cl) lo = [[ylS, zf, A], [ylS, 0, A]];
    else {
      const f = solveFillet(P, t => { const z = cl.z + t * (zf - cl.z); return { c: [ylS - R, z], q: [ylS, z] }; }, R);
      lo = f ? [[ylS, zf, A]].concat(arcPts(f.c, R, f.q, [f.T.y, f.T.z], 8).slice(0, -1).map(tagA), cutAfter(P, f.T)) : [[ylS, zf, A]].concat(cutAfter(P, cl));
    }
    return up.concat(lo);
  }

  // --- Seitenleitwerk. Seitenansicht: Nasenleiste = Gerade (Winkel zur Senkrechten), die unten mit
  //     einem Radius tangential in die Rumpfoberkante einläuft; Endleiste = Gerade (Winkel);
  //     Abschluss oben = Gerade (Winkel zur Waagrechten) vom Nasenleisten-Ende bis zur Endleiste.
  function finProf(src, thk, prof) { return src === 'dat' && prof && prof.pts ? profFn(prof.pts) : profFn(nacaProf(thk)); }
  function finGeom(m) {
    const f = FN(); if (!f.on) return null;
    const pr = finProf(f.srcR, f.thkR, f.profR), pt = finProf(f.srcT, f.thkT, f.profT); if (!pr || !pt) return null;
    const cr = Math.max(1, +f.cr || 1), h = Math.max(1, +f.h || 1);
    const xLE = +f.xLE > 0 ? +f.xLE : m.x1 - cr;
    let y0 = +f.y0 || 0;
    if (f.y0Auto) { const xm = clamp(xLE + cr / 2, m.x0, m.x1); y0 = (lineAt(m.L.top, xm) + lineAt(m.L.bot, xm)) / 2; }
    const rad = (a, lim) => clamp(+a || 0, -lim, lim) * Math.PI / 180;
    const tL = Math.tan(rad(f.angLE, 80)), tT = Math.tan(rad(f.angTE, 80)), tP = Math.tan(rad(f.angTip, 60));
    const g = { pr, pt, cr, h, xLE, y0, tL, tT, tP, cosP: 1 / Math.hypot(1, tP), leR: Math.max(0, +f.leR || 0), R: Math.max(0, +f.R || 0), tipRound: Math.max(0, +f.tipRound || 0), fil: null };
    // Spitze: Ende der Nasenleiste bei y0 + h; Abschlussgerade bis zur Endleiste
    g.xPT = xLE + tL * h; g.yPT = y0 + h;
    const den = 1 - tP * tT;
    g.yT = Math.abs(den) > 1e-6 ? (g.yPT + tP * (xLE + cr - g.xPT - tT * y0)) / den : g.yPT;
    g.yT = clamp(g.yT, y0 + 1, y0 + 3 * h);
    g.xT = xLE + cr + tT * (g.yT - y0); g.ct = Math.hypot(g.xT - g.xPT, g.yT - g.yPT); g.yMax = Math.max(g.yPT, g.yT);
    // Übergangsradius Nasenleiste -> Rumpfoberkante (Ebene X/Y): Kreis tangential an Gerade und Oberkante
    if (g.leR > 0.05) {
      const leX = y => xLE + tL * (y - y0), gy = y => lineAt(m.L.top, clamp(leX(y), m.x0, m.x1)) - y;
      if (gy(y0) > 0 && gy(g.yPT) < 0) {
        let lo = y0, hi = g.yPT; for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (gy(mid) > 0) lo = mid; else hi = mid; }
        const yF = (lo + hi) / 2, F = [leX(yF), yF];
        if (F[0] > m.x0 + 1e-6 && F[0] < m.x1 - 1e-6) {
          const nL = Math.hypot(tL, 1), dL = [tL / nL, 1 / nL], nn = [-1 / nL, tL / nL], Lmax = Math.max(h, 4 * g.leR);
          const xa = Math.max(m.x0, F[0] - Lmax - 2 * g.leR), xb = Math.min(m.x1, F[0] + g.leR), Ptop = [];
          for (let i = 0; i <= 120; i++) { const xx = xa + (xb - xa) * i / 120; Ptop.push([xx, lineAt(m.L.top, xx)]); }
          const fl = solveFillet(Ptop, s => { const q = [F[0] + dL[0] * s * Lmax, F[1] + dL[1] * s * Lmax]; return { q, c: [q[0] + nn[0] * g.leR, q[1] + nn[1] * g.leR] }; }, g.leR);
          if (fl) g.fil = { c: fl.c, q: fl.q, T: [fl.T.y, fl.T.z], R: g.leR, F };
        }
      }
    }
    let xs = Infinity, xe = -Infinity;
    for (let i = 0; i <= 40; i++) { const y = y0 + (g.yMax - y0) * i / 40; xs = Math.min(xs, finLEx(g, y)); }
    xe = Math.max(finTEx(g, y0), g.xT, g.xPT);
    g.xs = xs; g.xe = xe;
    return g;
  }
  // X der Nasenleiste in Höhe y (Gerade, darunter der Übergangsbogen, darunter senkrecht am Bogenanfang).
  function finLEx(g, y) {
    const f = g.fil;
    if (f) {
      if (y >= f.q[1]) return g.xLE + g.tL * (y - g.y0);
      if (y <= f.T[1]) return f.T[0];
      return f.c[0] + Math.sqrt(Math.max(0, f.R * f.R - (y - f.c[1]) * (y - f.c[1])));
    }
    return g.xLE + g.tL * (y - g.y0);
  }
  function finTEx(g, y) { return g.xLE + g.cr + g.tT * (y - g.y0); }
  // Oberer Abschluss bei x (vor dem Nasenleisten-Ende begrenzt die Nasenleiste selbst).
  function finTop(g, x) { return x <= g.xPT ? g.yPT : g.yPT + g.tP * (x - g.xPT); }
  // Halbe Dicke des Leitwerks bei (x, y); -1 = außerhalb des Grundrisses.
  function finT(g, x, y) {
    if (y < g.y0 || y > finTop(g, x)) return -1;
    const le = finLEx(g, y), te = finTEx(g, y), c = te - le; if (!(c > 1e-6)) return -1;
    const u = (x - le) / c; if (u < 0 || u > 1) return -1;
    const f = g.fil;
    if (f && y <= f.T[1] && y > f.c[1] - f.R) { const s = Math.sqrt(Math.max(0, f.R * f.R - (y - f.c[1]) * (y - f.c[1]))); if (x > f.c[0] - s && x < f.c[0] + s) return -1; }   // im Übergangskreis = Luft
    const s = clamp((y - g.y0) / g.h, 0, 1), cn = Math.max(1e-6, te - (g.xLE + g.tL * (y - g.y0)));
    let t = cn * ((1 - s) * g.pr.t(u) + s * g.pt.t(u));
    if (g.tipRound > 0) { const d = (finTop(g, x) - y) * g.cosP; if (d < g.tipRound) { const q = (g.tipRound - d) / g.tipRound; t *= Math.sqrt(Math.max(0, 1 - q * q)); } }
    return t;
  }
  // Hohlkehle zwischen Rumpf P und einer Anbau-Flanke (Polylinie): Kreismittelpunkt wandert vom
  // Rumpfkontakt (Anfang der Flanke bei fromStart, sonst Ende) entlang der Flanke, bis er Abstand R hat.
  function flankFillet(P, flank, R, fromStart) {
    const L = flank.length - 1; if (L < 1 || !(R > 0.05)) return null;
    const at = s => { const p = fromStart ? s * L : (1 - s) * L, i = Math.min(L - 1, Math.max(0, Math.floor(p))), tt = p - i, A = flank[i], B = flank[i + 1]; return { i, y: A[0] + (B[0] - A[0]) * tt, z: A[1] + (B[1] - A[1]) * tt }; };
    const f = solveFillet(P, s => { const q = at(s); return { c: [q.y, q.z + R], q: [q.y, q.z] }; }, R);
    if (!f) return null;
    f.i = at(f.s).i; return f;
  }
  function finHalf(g, x, P) {
    if (!g) return P;
    const yTop = Math.min(finTop(g, x), g.yMax), N = 64, F = 1;
    if (!(yTop > g.y0)) return P;
    const tagF = q => [q[0], q[1], F];
    // Umriss des Leitwerks bei x von oben nach unten (erster Punkt exakt auf dem Rand per Bisektion)
    const samp = []; for (let i = N; i >= 0; i--) { const y = g.y0 + (yTop - g.y0) * i / N; samp.push([y, finT(g, x, y)]); }
    let iFirst = -1; for (let i = 0; i < samp.length; i++) if (samp[i][1] >= 0) { iFirst = i; break; }
    if (iFirst < 0) return P;
    const out = [];
    if (iFirst > 0) { let lo = samp[iFirst][0], hi = samp[iFirst - 1][0]; for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (finT(g, x, mid) >= 0) lo = mid; else hi = mid; } out.push([lo, 0, F], [lo, Math.max(0, finT(g, x, lo)), F]); }
    else out.push([samp[0][0], 0, F]);
    let reachedFoot = true;
    for (let i = iFirst; i < samp.length; i++) { if (samp[i][1] < 0) { reachedFoot = false; break; } out.push([samp[i][0], samp[i][1], F]); }
    if (!P || P.length < 2) { const e = out[out.length - 1]; out.push([e[0], 0, F]); return out; }
    const top = P[0][0], bot = P[P.length - 1][0];
    // Unter dem Leitwerksfuß mit konstanter Dicke weiter bis zur Rumpfunterkante (Leitwerksträger).
    if (reachedFoot && g.y0 > bot) { const n = 24, e = out[out.length - 1]; for (let i = 1; i <= n; i++) out.push([e[0] + (bot - e[0]) * i / n, e[1], F]); }
    const inside = q => { if (q[0] > top + 1e-9) return false; if (q[0] < bot - 1e-9) return true; const c = crossY(P, q[0]); return !!c && q[1] < c.z; };
    // Sichtbare Flanke: vom Austritt aus dem Rumpf (E) bis zum Wiedereintritt (B)
    let i0 = -1; for (let i = 0; i < out.length; i++) if (!inside(out[i])) { i0 = i; break; }
    if (i0 < 0) return P;
    let i1 = -1; for (let i = i0 + 1; i < out.length; i++) if (inside(out[i])) { i1 = i; break; }
    const bis = (a, b) => { for (let k = 0; k < 20; k++) { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, F]; if (inside(m)) a = m; else b = m; } return b; };
    const E = i0 > 0 ? bis(out[i0 - 1], out[i0]) : null, B = i1 > 0 ? bis(out[i1], out[i1 - 1]) : null;
    const flank = out.slice(i0, i1 > 0 ? i1 : out.length); if (E) flank.unshift(E); if (B) flank.push(B);
    const fh = E ? flankFillet(P, flank, g.R, true) : null;
    let ft = B ? flankFillet(P, flank, g.R, false) : null;
    if (fh && ft && fh.i + 1 > ft.i) ft = null;
    const a0 = E ? (fh ? fh.i + 1 : 1) : 0, a1 = B ? (ft ? ft.i + 1 : flank.length - 1) : flank.length;
    let res = [];
    if (E) {
      if (fh) res = cutBefore(P, fh.T).concat(arcPts(fh.c, g.R, [fh.T.y, fh.T.z], fh.q, 8).slice(1).map(tagF));
      else { const cE = crossY(P, Math.min(E[0], top)); res = cE ? cutBefore(P, cE) : [P[0]]; }
    }
    res = res.concat(flank.slice(a0, Math.max(a0, a1)).map(tagF));
    if (B) {
      if (ft) res = res.concat([tagF(ft.q)], arcPts(ft.c, g.R, ft.q, [ft.T.y, ft.T.z], 8).slice(1).map(tagF), cutAfter(P, ft.T));
      else { const cB = crossY(P, Math.max(B[0], bot)); res = res.concat([tagF(B)], cB ? cutAfter(P, cB) : [P[P.length - 1]]); }
    } else { const e = res[res.length - 1]; res.push([e[0], 0, F]); }
    return res;
  }
  // Ring gleichmäßig nach Bogenlänge auf K Punkte abtasten (Herkunft = größere der beiden Segmentenden).
  // Gleiche Punktzahl je Spant mit stetiger Parametrisierung -> saubere Dreiecke zwischen den Spanten.
  function resampleRing(P, K) {
    const n = P.length, cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const L = cum[n - 1], out = [];
    if (!(L > 1e-9)) { for (let k = 0; k < K; k++) out.push([P[0][0], P[0][1], P[0][2] || 0]); return out; }
    let j = 0;
    for (let k = 0; k < K; k++) {
      const s = L * k / (K - 1); while (j < n - 2 && cum[j + 1] < s) j++;
      const d = cum[j + 1] - cum[j], t = d > 1e-12 ? clamp((s - cum[j]) / d, 0, 1) : 0, A = P[j], B = P[j + 1];
      out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, Math.max(A[2] || 0, B[2] || 0)]);
    }
    return out;
  }
  // Halbspant bei x inkl. Anbauten: [[y,z,tag],…] von oben nach unten (erster/letzter Punkt z = 0).
  function halfAt(m, x) {
    let P = null;
    if (x >= m.x0 - 1e-9 && x <= m.x1 + 1e-9) P = polyOf(secParams(m, x).nodes, m.perSeg).map(q => [q[0], q[1] > 0 ? q[1] : 0, 0]);
    if (m.wing) P = wingHalf(m.wing, x, P);
    if (m.fin) P = finHalf(m.fin, x, P);
    if (!P || P.length < 2) { const y = P && P.length ? P[0][0] : lineAt(m.L.top, clamp(x, m.x0, m.x1)); P = [[y, 0, 0], [y, 0, 0]]; }
    return P;
  }
  // Tragfläche aus dem Tragflächendesign (nur Anzeige): Wurzelrippe an der Wurzelrippen-Ebene des
  // Übergangs, gleiche Tiefe/Einstellwinkel wie die Anformung, beide Seiten gespiegelt.
  function wingMesh(m) {
    const g = m.wing; if (!g || !C('rumpfShowWing')) return null;
    const Wg = App.wing; if (!Wg || !Wg.stations || Wg.stations.length < 2 || !state.root) return null;
    const sc = g.chord / (+state.root.chord || g.chord), flip = state.cfg && state.cfg.flipY ? -1 : 1;
    const rings = [];
    for (const st of Wg.stations) {
      if (!st || !st.pts || st.pts.length < 3) return null;
      const pts = st.pts.map(p => [p.x * sc, (p.y + (st.yRise || 0)) * flip * sc]);
      let area = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p[0] * q[1] - q[0] * p[1]; }
      if (area < 0) pts.reverse();
      const f = pts[0], l = pts[pts.length - 1]; if (Math.hypot(f[0] - l[0], f[1] - l[1]) > 1e-6) pts.push(f.slice());
      rings.push({ pts, z: (st.z || 0) * sc });
    }
    const K = rings[0].pts.length; if (rings.some(r => r.pts.length !== K)) return null;
    const G = [];
    for (let a = 0; a < K; a++) G.push(rings.map(r => { const p = r.pts[a]; return [g.xLE + p[0], g.yLE + p[1] - p[0] * g.tanA, g.zf + r.z]; }));
    return meshFromGrid(G, { mirror: true, closedU: true, tagAll: 3 });
  }

  // ---------- Modell ------------------------------------------------------------------
  let model = null;   // { st, L, MA, MI, MO, G, mesh, bounds, err, ntri, vol, perSeg, wing, fin, xs, xe }
  function prepare(st) {
    const L = { top: lineSegs(st, 'top'), bot: lineSegs(st, 'bot'), w: lineSegs(st, 'w') };
    const MA = unify(st).map(flat), M = st.length, MI = [], MO = [];
    for (let j = 0; j < M; j++) {
      const A = MA[j], p = st[j - 1], n = st[j + 1], s = st[j], I = new Array(A.length).fill(0), O = new Array(A.length).fill(0);
      for (let q = 0; q < A.length; q++) {
        if (p && n) { const D = (n.x - p.x) || 1, d = MA[j + 1][q] - MA[j - 1][q]; O[q] = d * (n.x - s.x) / D / 3; I[q] = -d * (s.x - p.x) / D / 3; }
        else if (n) O[q] = (MA[j + 1][q] - A[q]) / 3;
        else if (p) I[q] = -(A[q] - MA[j - 1][q]) / 3;
      }
      MI.push(I); MO.push(O);
    }
    return { L, MA, MI, MO, nn: MA[0].length / 6 };
  }
  // Normierte Knoten an der Stelle x (Überblendung der Stationen).
  function morphAt(m, x) {
    const st = m.st; let j = 0; while (j + 2 < st.length && x > st[j + 1].x) j++;
    const a = st[j], b = st[j + 1], D = (b.x - a.x) || 1, t = clamp((x - a.x) / D, 0, 1);
    const A = m.MA[j], B = m.MA[j + 1], O = m.MO[j], I = m.MI[j + 1], out = new Array(A.length);
    for (let q = 0; q < A.length; q++) out[q] = bez1(A[q], A[q] + O[q], B[q] + I[q], B[q], t);
    return unflat(out);
  }
  // Physischer Spant an der Stelle x.
  function secParams(m, x) {
    const top = lineAt(m.L.top, x), bot = lineAt(m.L.bot, x), w = Math.max(0, lineAt(m.L.w, x)), h = top - bot;
    const nodes = morphAt(m, x).map(q => ({ y: bot + q.y * h, z: Math.max(0, q.z * w), i: [q.i[0] * h, q.i[1] * w], o: [q.o[0] * h, q.o[1] * w] }));
    return { x, top, bot, w, h, nodes };
  }
  function secHalf(m, x) { return halfAt(m, x).map(q => [x, q[0], q[1]]); }
  function build() {
    const st = sortedSt();
    model = { st };
    try {
      if (st.length < 2) throw new Error(T('Mindestens zwei Stationen nötig.'));
      const x0 = st[0].x, x1 = st[st.length - 1].x;
      if (!(x1 - x0 > 1e-9)) throw new Error(T('Rumpf hat keine Ausdehnung.'));
      Object.assign(model, prepare(st), { x0, x1, xs: x0, xe: x1 });
      const Nu = Math.max(6, Math.round(C('rumpfNu'))), Nv = Math.max(8, Math.round(C('rumpfNv')));
      model.perSeg = Math.max(2, Math.round(Nu / (model.nn - 1)));
      model.wing = wingGeom(model); model.fin = finGeom(model);
      if (model.fin) { model.xs = Math.min(x0, model.fin.xs); model.xe = Math.max(x1, model.fin.xe); }
      const rings = []; let K = 0;
      for (let b = 0; b <= Nv; b++) { const r = halfAt(model, model.xs + (model.xe - model.xs) * b / Nv); rings.push(r); K = Math.max(K, r.length); }
      K = Math.min(600, Math.max(2 * Nu, K));
      const G = [], TG = []; for (let a = 0; a < K; a++) { G.push(new Array(Nv + 1)); TG.push(new Array(Nv + 1)); }
      for (let b = 0; b <= Nv; b++) {
        const x = model.xs + (model.xe - model.xs) * b / Nv, P = resampleRing(rings[b], K);
        for (let a = 0; a < K; a++) { G[a][b] = [x, P[a][0], P[a][1] > 0 ? P[a][1] : 0]; TG[a][b] = P[a][2] || 0; }
      }
      const mesh = meshFromGrid(G, { mirror: true, seam: true, tags: TG });
      Object.assign(model, { G, mesh, bounds: meshBounds(mesh), ntri: mesh.ntri, vol: meshVolume(mesh) });
      try { model.wingMesh = wingMesh(model); } catch (e) { console.warn('Rumpf: Tragfläche nicht darstellbar', e); model.wingMesh = null; }
    } catch (e) { console.error(e); model.err = e.message; }
    return model;
  }

  // ---------- Dreiecksnetz -------------------------------------------------------------
  // Aus dem Gitter G[a][b] (a um den Spant, b längs): Lage/geglättete Normale/Herkunft je Gitterpunkt
  // (für WebGL, indiziert), Kantenliste für das Drahtmodell und die flache 9-Werte-Liste je Dreieck
  // (STL, Volumen, Canvas-2D). Normalen aus den Gitter-Ableitungen (du × dv, nach außen); am
  // Symmetrie-Saum (seam) über die Spiegelung, bei geschlossenen Ringen (closedU) umlaufend.
  // mirror: Spiegelung z -> -z als zweite Hälfte (Rumpf) bzw. zweite Tragfläche. Offene Enden werden gedeckelt.
  function meshFromGrid(G, opt) {
    opt = opt || {};
    const K = G.length, Nv = G[0].length, mirror = !!opt.mirror, seam = !!opt.seam, closedU = !!opt.closedU, TG = opt.tags, tagAll = opt.tagAll || 0;
    const sides = mirror ? 2 : 1, nV = K * Nv, pos = [], nrm = [], tag = [], idx = [], lines = [];
    const vid = (s, a, b) => s * nV + a * Nv + b;
    for (let s = 0; s < sides; s++) {
      const sg = s ? -1 : 1;
      for (let a = 0; a < K; a++) for (let b = 0; b < Nv; b++) {
        const p = G[a][b];
        let du;
        if (seam && a === 0) du = [0, 0, 2 * G[1][b][2]];
        else if (seam && a === K - 1) du = [0, 0, -2 * G[K - 2][b][2]];
        else { const ap = a > 0 ? a - 1 : (closedU ? K - 2 : 0), an = a < K - 1 ? a + 1 : (closedU ? 1 : K - 1), A = G[ap][b], Bq = G[an][b]; du = [Bq[0] - A[0], Bq[1] - A[1], Bq[2] - A[2]]; }
        const bp = Math.max(0, b - 1), bn = Math.min(Nv - 1, b + 1), Pb = G[a][bp], Pn = G[a][bn], dv = [Pn[0] - Pb[0], Pn[1] - Pb[1], Pn[2] - Pb[2]];
        let nx = du[1] * dv[2] - du[2] * dv[1], ny = du[2] * dv[0] - du[0] * dv[2], nz = du[0] * dv[1] - du[1] * dv[0];
        const L = Math.hypot(nx, ny, nz);
        if (L > 1e-12) { nx /= L; ny /= L; nz /= L; } else { nx = 0; ny = 0; nz = 1; }
        pos.push(p[0], p[1], sg * p[2]); nrm.push(nx, ny, sg * nz); tag.push(TG ? TG[a][b] : tagAll);
      }
      for (let a = 0; a + 1 < K; a++) for (let b = 0; b + 1 < Nv; b++) {
        const i00 = vid(s, a, b), i10 = vid(s, a + 1, b), i01 = vid(s, a, b + 1), i11 = vid(s, a + 1, b + 1);
        if (sg > 0) idx.push(i00, i11, i01, i00, i10, i11); else idx.push(i00, i01, i11, i00, i11, i10);
      }
      const sb = Math.max(1, Math.round(Nv / 48)), sa = Math.max(1, Math.round(K / 28));
      for (let b = 0; b < Nv; b += sb) for (let a = 0; a + 1 < K; a++) lines.push(vid(s, a, b), vid(s, a + 1, b));
      if ((Nv - 1) % sb) for (let a = 0; a + 1 < K; a++) lines.push(vid(s, a, Nv - 1), vid(s, a + 1, Nv - 1));
      for (let a = 0; a < K; a += sa) for (let b = 0; b + 1 < Nv; b++) lines.push(vid(s, a, b), vid(s, a, b + 1));
    }
    // Deckel: Ring des Endes fächern; Normale = Längsrichtung nach außen (Vorzeichen per Test)
    const cap = (b, dir) => {
      const rings = [];
      if (seam) {
        const r = []; for (let a = 0; a < K; a++) r.push(G[a][b]);
        if (mirror) for (let a = K - 2; a >= 1; a--) { const q = G[a][b]; r.push([q[0], q[1], -q[2]]); }
        rings.push(r);
      } else {
        for (let s = 0; s < sides; s++) { const r = []; for (let a = 0; a < (closedU ? K - 1 : K); a++) { const q = G[a][b]; r.push(s ? [q[0], q[1], -q[2]] : q); } rings.push(r); }
      }
      for (const ring of rings) {
        const n = ring.length; if (n < 3) continue;
        const c = [0, 0, 0]; for (const q of ring) { c[0] += q[0]; c[1] += q[1]; c[2] += q[2]; } c[0] /= n; c[1] /= n; c[2] /= n;
        let ax = 0, ay = 0, az = 0;
        for (let i = 0; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n], e1 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], e2 = [q[0] - c[0], q[1] - c[1], q[2] - c[2]]; ax += e1[1] * e2[2] - e1[2] * e2[1]; ay += e1[2] * e2[0] - e1[0] * e2[2]; az += e1[0] * e2[1] - e1[1] * e2[0]; }
        const A = Math.hypot(ax, ay, az); if (A < 1e-3) continue;
        const flip = (ax * dir[0] + ay * dir[1] + az * dir[2]) < 0, nn = flip ? [-ax / A, -ay / A, -az / A] : [ax / A, ay / A, az / A];
        const base = pos.length / 3, tg = TG ? TG[0][b] : tagAll;
        pos.push(c[0], c[1], c[2]); nrm.push(nn[0], nn[1], nn[2]); tag.push(tg);
        for (const q of ring) { pos.push(q[0], q[1], q[2]); nrm.push(nn[0], nn[1], nn[2]); tag.push(tg); }
        for (let i = 0; i < n; i++) { const j = (i + 1) % n; if (flip) idx.push(base, base + 1 + j, base + 1 + i); else idx.push(base, base + 1 + i, base + 1 + j); }
      }
    };
    const d0 = [G[0][1][0] - G[0][0][0], G[0][1][1] - G[0][0][1], G[0][1][2] - G[0][0][2]], d1 = [G[0][Nv - 1][0] - G[0][Nv - 2][0], G[0][Nv - 1][1] - G[0][Nv - 2][1], G[0][Nv - 1][2] - G[0][Nv - 2][2]];
    cap(0, [-d0[0], -d0[1], -d0[2]]); cap(Nv - 1, d1);
    // Flache Dreiecksliste (ohne entartete Dreiecke) + Herkunft je Dreieck
    const v = [], ft = [];
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
      if (Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) < 1e-9) continue;
      v.push(pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2], pos[c], pos[c + 1], pos[c + 2]); ft.push(Math.max(tag[idx[i]], tag[idx[i + 1]], tag[idx[i + 2]]));
    }
    return { v: new Float32Array(v), ft: new Uint8Array(ft), pos: new Float32Array(pos), nrm: new Float32Array(nrm), tag: new Float32Array(tag), idx: new Uint32Array(idx), lines: new Uint32Array(lines), ntri: v.length / 9 };
  }
  function meshBounds(mesh) {
    const v = mesh.v, mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { if (v[i + k] < mn[k]) mn[k] = v[i + k]; if (v[i + k] > mx[k]) mx[k] = v[i + k]; }
    if (!isFinite(mn[0])) return { mn: [0, 0, 0], mx: [1, 1, 1] };
    return { mn, mx };
  }
  function meshVolume(mesh) {
    const v = mesh.v; let s = 0;
    for (let i = 0; i < v.length; i += 9) s += v[i] * (v[i + 4] * v[i + 8] - v[i + 5] * v[i + 7]) - v[i + 1] * (v[i + 3] * v[i + 8] - v[i + 5] * v[i + 6]) + v[i + 2] * (v[i + 3] * v[i + 7] - v[i + 4] * v[i + 6]);
    return Math.abs(s) / 6;
  }

  // ---------- Schnitt X = const (exakt aus der Beschreibung) ------------------------------
  function sectionAt(x) {
    if (!model || !model.G) return [];
    if (x < model.xs - 1e-9 || x > model.xe + 1e-9) return [];
    const P = halfAt(model, x), loop = [];
    for (const q of P) loop.push([x, q[0], Math.max(0, q[1])]);
    for (let k = P.length - 2; k >= 1; k--) loop.push([x, P[k][0], -Math.max(0, P[k][1])]);
    return [loop];
  }
  function loopArea(L) { let a = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; a += p[2] * q[1] - q[2] * p[1]; } return Math.abs(a) / 2; }

  // ---------- Export -----------------------------------------------------------
  function toBinarySTL(verts) {
    const n = Math.floor(verts.length / 9);
    const buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
    const hdr = 'AI Foam Cut Rumpf'; for (let i = 0; i < 80; i++) dv.setUint8(i, i < hdr.length ? hdr.charCodeAt(i) : 0);
    dv.setUint32(80, n, true);
    let o = 84;
    for (let i = 0; i < n * 9; i += 9) {
      const ux = verts[i + 3] - verts[i], uy = verts[i + 4] - verts[i + 1], uz = verts[i + 5] - verts[i + 2];
      const vx = verts[i + 6] - verts[i], vy = verts[i + 7] - verts[i + 1], vz = verts[i + 8] - verts[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
      dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true); o += 12;
      for (let k = 0; k < 9; k++) { dv.setFloat32(o, verts[i + k], true); o += 4; }
      dv.setUint16(o, 0, true); o += 2;
    }
    return buf;
  }
  function projBase() { return ((state.projectName || 'rumpf').replace(/[^\w\-]+/g, '_')) || 'rumpf'; }
  function saveFile(name, data, mime, which) {
    if (typeof App.download === 'function') App.download(name, data, mime, which);
    else if (App.anchorDownload) App.anchorDownload(name, data, mime);
  }
  function exportStl() {
    if (!model || !model.mesh) build(); if (!model || !model.mesh) return;
    let v = model.mesh.v;
    if (C('rumpfUp') === 'z') { const o = new Float32Array(v.length); for (let i = 0; i < v.length; i += 3) { o[i] = v[i]; o[i + 1] = -v[i + 2]; o[i + 2] = v[i + 1]; } v = o; }
    const mn = [Infinity, Infinity, Infinity]; for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) mn[k] = Math.min(mn[k], v[i + k]);
    const o = new Float32Array(v.length); for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) o[i + k] = v[i + k] - mn[k];
    saveFile(projBase() + '_rumpf.stl', toBinarySTL(o), 'model/stl', 'svStl');
  }
  function dxfText(loops) {
    const L = ['0', 'SECTION', '2', 'ENTITIES'];
    for (const lp of loops) {
      L.push('0', 'LWPOLYLINE', '8', 'SPANT', '90', String(lp.length), '70', '1');
      for (const q of lp) L.push('10', q[0].toFixed(4), '20', q[1].toFixed(4));
    }
    L.push('0', 'ENDSEC', '0', 'EOF');
    return L.join('\n');
  }
  function exportSectionDxf() {
    if (!model || !model.mesh) build(); if (!model || !model.mesh) return;
    const x = +C('rumpfCutX') || 0, loops = sectionAt(x).filter(L => loopArea(L) > 1e-6).map(L => L.map(q => [q[2], q[1]]));
    if (!loops.length) { alert(T('Schnittebene trifft den Rumpf nicht.')); return; }
    saveFile(projBase() + '_spant_x' + Math.round(x) + '.dxf', dxfText(loops), 'application/dxf', 'svDxf');
  }
  function exportAllSectionsDxf() {
    if (!model || !model.mesh) build(); if (!model || !model.mesh) return;
    const all = [];
    let off = 0;
    for (const s of model.st) {
      const loops = sectionAt(s.x).filter(L => loopArea(L) > 1e-6); if (!loops.length) continue;
      let w = 0; for (const L of loops) for (const q of L) w = Math.max(w, Math.abs(q[2]));
      for (const L of loops) all.push(L.map(q => [q[2] + off + w, q[1]]));
      off += 2 * w + 20;
    }
    if (!all.length) { alert(T('Keine Spanten.')); return; }
    saveFile(projBase() + '_spanten.dxf', dxfText(all), 'application/dxf', 'svDxf');
  }

  // ---------- Vorschau ---------------------------------------------------------------
  let canvas = null, ctx = null, W = 0, H = 0;
  let cam = { yaw: 0.9, pitch: 0.35, zoom: 1, px: 0, py: 0 };
  const CAM0 = Object.assign({}, cam);
  let cam2 = { side: { zoom: 1, px: 0, py: 0 }, top: { zoom: 1, px: 0, py: 0 }, sec: { zoom: 1, px: 0, py: 0 } };
  let center = [0, 0, 0], radius = 100;
  let dragging = false, dragMode = '', lastX = 0, lastY = 0, bound = false, hot = null, dragH = null, dragCtrl = false;
  const LIGHT = (() => { const l = [-0.35, 0.55, 0.75]; const n = Math.hypot(...l); return l.map(x => x / n); })();
  const img = { side: null, top: null, sec: null };   // Image-Objekte (nur RAM)
  function rot(n) {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const x1 = n[0] * cy + n[2] * sy, z1 = -n[0] * sy + n[2] * cy;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    return [x1, n[1] * cp - z1 * sp, n[1] * sp + z1 * cp];
  }
  function scr(x, y, z) {
    const r = rot([x - center[0], y - center[1], z - center[2]]);
    const s = 0.42 * Math.min(W, H) / radius * cam.zoom;
    return { x: W / 2 + cam.px + s * r[0], y: H / 2 + cam.py - s * r[1], d: r[2] };
  }
  function fit() {
    canvas = document.getElementById('cRumpf'); if (!canvas) return false;
    const dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
    ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!bound) bindCanvas();
    return true;
  }
  function col(name, fb) { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb; } catch (e) { return fb; } }
  function setInfo(html, bad) { const el = document.getElementById('rumpfInfo'); if (el) { el.innerHTML = html; el.style.color = bad ? '#f88' : ''; } }
  const COL_KEYS = ['rumpfColBody', 'rumpfColFin', 'rumpfColAtt', 'rumpfColWing'];
  function hexRGB(h) { const m = /^#([0-9a-f]{6})$/i.exec(h || ''); return m ? [parseInt(m[1].slice(0, 2), 16) / 255, parseInt(m[1].slice(2, 4), 16) / 255, parseInt(m[1].slice(4, 6), 16) / 255] : [0.4, 0.5, 0.6]; }
  function colOf(k) { const v = C(COL_KEYS[k]); return /^#[0-9a-f]{6}$/i.test(v || '') ? v : DEF[COL_KEYS[k]]; }
  function renderMode() { const m = C('rumpfRender'); return m === 'flat' || m === 'wire' || m === '2d' ? m : 'fine'; }
  function cssRGB(c) {
    try {
      ctx.fillStyle = c; const n = ctx.fillStyle; let m = /^#([0-9a-f]{6})$/i.exec(n);
      if (m) return hexRGB(n);
      m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(n); if (m) return [m[1] / 255, m[2] / 255, m[3] / 255];
    } catch (e) {}
    return [0.06, 0.07, 0.09];
  }
  // Canvas-2D-Rückfall: Dreiecke tiefensortiert (Maler-Algorithmus), Farbe nach Herkunft.
  function drawShaded(mesh) {
    const faces = [], v = mesh.v, ft = mesh.ft, cols = [0, 1, 2, 3].map(k => hexRGB(colOf(k)).map(c => Math.round(c * 255)));
    for (let i = 0, t = 0; i < v.length; i += 9, t++) {
      const ux = v[i + 3] - v[i], uy = v[i + 4] - v[i + 1], uz = v[i + 5] - v[i + 2];
      const vx = v[i + 6] - v[i], vy = v[i + 7] - v[i + 1], vz = v[i + 8] - v[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
      let nc = rot([nx, ny, nz]); if (nc[2] > 0) nc = [-nc[0], -nc[1], -nc[2]];
      const lam = Math.max(0, nc[0] * LIGHT[0] + nc[1] * LIGHT[1] + nc[2] * LIGHT[2]);
      const p0 = scr(v[i], v[i + 1], v[i + 2]), p1 = scr(v[i + 3], v[i + 4], v[i + 5]), p2 = scr(v[i + 6], v[i + 7], v[i + 8]);
      faces.push({ p: [p0, p1, p2], d: (p0.d + p1.d + p2.d) / 3, l: 0.3 + 0.7 * lam, c: cols[ft ? ft[t] : 0] || cols[0] });
    }
    faces.sort((a, b) => b.d - a.d);
    ctx.lineJoin = 'round'; ctx.lineWidth = 1;
    for (const f of faces) {
      ctx.beginPath(); f.p.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle = 'rgb(' + Math.min(255, Math.round(f.c[0] * f.l)) + ',' + Math.min(255, Math.round(f.c[1] * f.l)) + ',' + Math.min(255, Math.round(f.c[2] * f.l)) + ')'; ctx.fill(); ctx.stroke();
    }
  }
  /* WebGL2-Darstellung (wie im Formenbau): eigene Canvas hinter der 2D-Canvas; die 2D-Canvas wird im
   * 3D-Modus durchsichtig und trägt nur Stationskurven/Achsen. Glatte Normalen kommen aus dem Gitter
   * (meshFromGrid), ohne teures Nachbarschafts-Suchen -> auch beim Ziehen flüssig. Modi: fein (glatt +
   * Glanz), flach, Drahtmodell (verdeckte Kanten durch hintergrundfarbene Flächen ausgeblendet). */
  let glc = null, gl = null, glP = null, glL = null, glVao = null, glTried = false;
  const glBufs = new Map();   // mesh -> { vbo, ibo, lbo, n, nl, used }
  const HALF = (() => { const h = [LIGHT[0], LIGHT[1], LIGHT[2] - 1]; const n = Math.hypot(...h) || 1; return h.map(x => x / n); })();
  function glInit() {
    if (glTried || !canvas) return; glTried = true;
    try {
      glc = document.createElement('canvas'); glc.id = 'cRumpfGL';
      glc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
      canvas.parentNode.insertBefore(glc, canvas);
      gl = glc.getContext('webgl2', { antialias: true, alpha: false, depth: true });
      if (!gl) throw new Error('no webgl2');
      const VS = `#version 300 es
        in vec3 aPos; in vec3 aNrm; in float aTag;
        uniform vec3 uCenter; uniform float uYaw; uniform float uPitch; uniform vec4 uProj; uniform float uZScale;
        out vec3 vCam; out vec3 vNrm; flat out int vTag;
        vec3 rot(vec3 p){ float cy = cos(uYaw), sy = sin(uYaw), cp = cos(uPitch), sp = sin(uPitch);
          float x1 = p.x*cy + p.z*sy, z1 = -p.x*sy + p.z*cy; return vec3(x1, p.y*cp - z1*sp, p.y*sp + z1*cp); }
        void main(){
          vec3 c = rot(aPos - uCenter); vCam = c; vNrm = rot(aNrm); vTag = int(aTag + 0.5);
          gl_Position = vec4(uProj.z + uProj.x*c.x, uProj.w + uProj.y*c.y, c.z*uZScale, 1.0);
        }`;
      const FS = `#version 300 es
        precision highp float;
        in vec3 vCam; in vec3 vNrm; flat in int vTag;
        uniform vec3 uCol[4]; uniform vec3 uLight; uniform vec3 uHalf; uniform int uSmooth; uniform int uSpec; uniform int uWire; uniform vec3 uBg;
        out vec4 o;
        void main(){
          vec3 col = uCol[vTag < 1 ? 0 : (vTag == 1 ? 1 : (vTag == 2 ? 2 : 3))];
          if (uWire == 2) { o = vec4(uBg, 1.0); return; }
          if (uWire == 1) { o = vec4(min(vec3(1.0), col * 1.25 + 0.08), 1.0); return; }
          vec3 nf = normalize(cross(dFdx(vCam), dFdy(vCam)));
          vec3 n = uSmooth == 1 ? normalize(vNrm) : nf;
          if (uSmooth == 1 && dot(n, nf) < 0.0) n = -n;
          if (n.z > 0.0) n = -n;
          float lam = max(0.0, dot(n, uLight));
          vec3 rgb = col * (0.30 + 0.70*lam);
          if (uSpec == 1) { float sp = max(0.0, dot(n, uHalf)); sp = pow(sp, 28.0); rgb += sp * 0.28; }
          o = vec4(min(rgb, vec3(1.0)), 1.0);
        }`;
      const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
      glP = gl.createProgram(); gl.attachShader(glP, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(glP, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(glP);
      if (!gl.getProgramParameter(glP, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glP));
      glL = {};
      for (const u of ['uCenter', 'uYaw', 'uPitch', 'uProj', 'uZScale', 'uCol', 'uLight', 'uHalf', 'uSmooth', 'uSpec', 'uWire', 'uBg']) glL[u] = gl.getUniformLocation(glP, u);
      glL.aPos = gl.getAttribLocation(glP, 'aPos'); glL.aNrm = gl.getAttribLocation(glP, 'aNrm'); glL.aTag = gl.getAttribLocation(glP, 'aTag');
      glVao = gl.createVertexArray();
      glc.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; glBufs.clear(); }, false);
    } catch (e) {
      console.warn('Rumpf: WebGL2 nicht verfügbar, Canvas-2D-Darstellung:', e && e.message);
      gl = null; if (glc && glc.parentNode) glc.parentNode.removeChild(glc); glc = null;
    }
  }
  function glActive() { if (renderMode() === '2d') return false; if (!glTried) glInit(); return !!gl; }
  function glFit() {
    if (!gl || !glc) return;
    const dpr = window.devicePixelRatio || 1, w = Math.max(1, Math.round(W * dpr)), h = Math.max(1, Math.round(H * dpr));
    if (glc.width !== w || glc.height !== h) { glc.width = w; glc.height = h; }
  }
  function glMesh(mesh) {
    let b = glBufs.get(mesh); if (b) { b.used = true; return b; }
    const n = mesh.pos.length / 3, out = new Float32Array(n * 7);
    for (let i = 0; i < n; i++) { const q = i * 7; out[q] = mesh.pos[i * 3]; out[q + 1] = mesh.pos[i * 3 + 1]; out[q + 2] = mesh.pos[i * 3 + 2]; out[q + 3] = mesh.nrm[i * 3]; out[q + 4] = mesh.nrm[i * 3 + 1]; out[q + 5] = mesh.nrm[i * 3 + 2]; out[q + 6] = mesh.tag[i]; }
    const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, out, gl.STATIC_DRAW);
    const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STATIC_DRAW);
    const lbo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lbo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.lines, gl.STATIC_DRAW);
    b = { vbo, ibo, lbo, n: mesh.idx.length, nl: mesh.lines.length, used: true }; glBufs.set(mesh, b); return b;
  }
  function glDraw(meshes) {
    glFit();
    const bg = cssRGB(col('--bg', '#0f1216')), mode = renderMode();
    gl.viewport(0, 0, glc.width, glc.height);
    gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    for (const b of glBufs.values()) b.used = false;
    gl.useProgram(glP); gl.bindVertexArray(glVao);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    const s = 0.42 * Math.min(W, H) / radius * cam.zoom;
    gl.uniform4f(glL.uProj, 2 * s / W, 2 * s / H, 2 * cam.px / W, -2 * cam.py / H);
    gl.uniform1f(glL.uZScale, 1 / (radius * 3));
    gl.uniform3f(glL.uCenter, center[0], center[1], center[2]);
    gl.uniform1f(glL.uYaw, cam.yaw); gl.uniform1f(glL.uPitch, cam.pitch);
    gl.uniform3f(glL.uLight, LIGHT[0], LIGHT[1], LIGHT[2]); gl.uniform3f(glL.uHalf, HALF[0], HALF[1], HALF[2]); gl.uniform3f(glL.uBg, bg[0], bg[1], bg[2]);
    const cols = []; for (let k = 0; k < 4; k++) cols.push(...hexRGB(colOf(k)));
    gl.uniform3fv(glL.uCol, new Float32Array(cols));
    gl.uniform1i(glL.uSmooth, mode === 'fine' ? 1 : 0); gl.uniform1i(glL.uSpec, mode === 'fine' ? 1 : 0);
    const bind = b => { gl.bindBuffer(gl.ARRAY_BUFFER, b.vbo); gl.enableVertexAttribArray(glL.aPos); gl.vertexAttribPointer(glL.aPos, 3, gl.FLOAT, false, 28, 0); gl.enableVertexAttribArray(glL.aNrm); gl.vertexAttribPointer(glL.aNrm, 3, gl.FLOAT, false, 28, 12); gl.enableVertexAttribArray(glL.aTag); gl.vertexAttribPointer(glL.aTag, 1, gl.FLOAT, false, 28, 24); };
    const bufs = meshes.map(glMesh);
    if (mode === 'wire') {
      gl.uniform1i(glL.uWire, 2); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 2);
      for (const b of bufs) { bind(b); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.ibo); gl.drawElements(gl.TRIANGLES, b.n, gl.UNSIGNED_INT, 0); }
      gl.disable(gl.POLYGON_OFFSET_FILL); gl.uniform1i(glL.uWire, 1);
      for (const b of bufs) { bind(b); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.lbo); gl.drawElements(gl.LINES, b.nl, gl.UNSIGNED_INT, 0); }
    } else {
      gl.uniform1i(glL.uWire, 0);
      for (const b of bufs) { bind(b); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.ibo); gl.drawElements(gl.TRIANGLES, b.n, gl.UNSIGNED_INT, 0); }
    }
    gl.bindVertexArray(null);
    for (const [k, b] of glBufs) if (!b.used) { gl.deleteBuffer(b.vbo); gl.deleteBuffer(b.ibo); gl.deleteBuffer(b.lbo); glBufs.delete(k); }
  }
  function glHide() { if (glc) glc.style.display = 'none'; }
  function drawAxes() {
    const L = radius * 0.35, o = [center[0] - radius * 0.9, center[1] - radius * 0.6, center[2] - radius * 0.2];
    ctx.font = '11px system-ui'; ctx.lineWidth = 1.5; ctx.strokeStyle = ctx.fillStyle = col('--muted', '#8aa');
    for (const a of [[1, 0, 0, 'X'], [0, 1, 0, 'Y'], [0, 0, 1, 'Z']]) {
      const p0 = scr(o[0], o[1], o[2]), p1 = scr(o[0] + a[0] * L, o[1] + a[1] * L, o[2] + a[2] * L);
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); ctx.fillText(a[3], p1.x + 3, p1.y - 3);
    }
  }
  function draw3d() {
    ctx.fillStyle = col('--bg', '#0f1216'); ctx.fillRect(0, 0, W, H);
    if (!model || !model.mesh) { glHide(); setInfo(model && model.err ? model.err : T('Kein Rumpf.'), true); return; }
    let { mn, mx } = model.bounds;
    const meshes = [model.mesh]; if (model.wingMesh) { meshes.push(model.wingMesh); const b = meshBounds(model.wingMesh); mn = mn.map((v, k) => Math.min(v, b.mn[k])); mx = mx.map((v, k) => Math.max(v, b.mx[k])); }
    center = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    radius = Math.max(1, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2);
    if (glActive()) { glc.style.display = ''; glDraw(meshes); ctx.clearRect(0, 0, W, H); }
    else { glHide(); for (const m of meshes) drawShaded(m); }
    if (C('rumpfShowSt')) {
      ctx.strokeStyle = 'rgba(255,210,120,.85)'; ctx.lineWidth = 1.2;
      for (const s of model.st) {
        const pts = secHalf(model, s.x);
        for (const sg of [1, -1]) { ctx.beginPath(); pts.forEach((q, i) => { const p = scr(q[0], q[1], sg * q[2]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); }
      }
    }
    drawAxes();
    setInfo(infoText());
  }
  function infoText() {
    const { mn, mx } = model.bounds;
    const dim = k => (mx[k] - mn[k]).toFixed(1);
    return T('Loft-Fläche aus Bezier-Splines') + ' · ' + model.st.length + ' ' + T('Stationen') + ' · ' + model.nn + ' ' + T('Knoten je Halbspant')
      + '<br>' + Math.round(model.ntri) + ' ' + T('Dreiecke') + ' · ' + dim(0) + ' × ' + dim(1) + ' × ' + dim(2) + ' mm'
      + ' · ' + T('Volumen') + ' ' + (model.vol / 1000).toFixed(1) + ' cm³'
      + (model.wingMesh ? ' · ' + T('Tragfläche (nur Anzeige)') + ' ' + Math.round(model.wingMesh.ntri) + ' ' + T('Dreiecke') : '');
  }

  // ---- 2D-Ansichten (Seite: X/Y, Draufsicht: X/Z, Spant: Z/Y) ----------------------
  let xf2 = null;   // aktuelle 2D-Abbildung { P(u,v), inv(x,y), sc }
  function view2dBase(kind) {
    const b = model && model.bounds ? model.bounds : { mn: [0, -50, -50], mx: [1000, 50, 50] };
    let u0, u1, v0, v1;
    if (kind === 'side') { u0 = b.mn[0]; u1 = b.mx[0]; v0 = b.mn[1]; v1 = b.mx[1]; }
    else if (kind === 'top') { u0 = b.mn[0]; u1 = b.mx[0]; v0 = b.mn[2]; v1 = b.mx[2]; }
    else { u0 = b.mn[2]; u1 = b.mx[2]; v0 = b.mn[1]; v1 = b.mx[1]; }
    const c2 = cam2[kind];
    const sc = Math.min((W - 140) / ((u1 - u0) || 1), (H - 140) / ((v1 - v0) || 1)) * c2.zoom;
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    xf2 = { sc, P: (u, v) => ({ x: W / 2 + c2.px + (u - cu) * sc, y: H / 2 + c2.py - (v - cv) * sc }), inv: (x, y) => [cu + (x - W / 2 - c2.px) / sc, cv - (y - H / 2 - c2.py) / sc] };
    return xf2;
  }
  function grid2d(xf, u0, u1, v0, v1) {
    const g = (st, colr) => {
      ctx.strokeStyle = colr; ctx.lineWidth = 1; ctx.beginPath();
      for (let u = Math.floor(u0 / st) * st; u <= u1; u += st) { const a = xf.P(u, v0), b = xf.P(u, v1); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      for (let v = Math.floor(v0 / st) * st; v <= v1; v += st) { const a = xf.P(u0, v), b = xf.P(u1, v); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke();
    };
    if (xf.sc * 10 > 6) g(10, 'rgba(128,160,180,.07)'); g(50, 'rgba(128,160,180,.16)');
  }
  function drawImg(kind, xf) {
    const im = img[kind], cfg = C(IMG_KEY[kind]);
    if (!im || !cfg) return;
    const mmpp = cfg.len > 0 ? cfg.len / im.width : 1;
    const a = xf.P(cfg.x, cfg.y), wpx = im.width * mmpp * xf.sc, hpx = im.height * mmpp * xf.sc;
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, (+C('rumpfImgOp') || 0) / 100));
    if (cfg.flip) { ctx.translate(a.x, a.y + hpx); ctx.scale(1, -1); ctx.drawImage(im, 0, 0, wpx, hpx); }
    else ctx.drawImage(im, a.x, a.y, wpx, hpx);
    ctx.restore();
  }
  // Dickenlinie (Y der breitesten Stelle über x) aus dem Gitter.
  // Nur der reine Rumpf (ohne Anbauten), damit Anformung/Leitwerk die Linie nicht verfälschen.
  function widLine() {
    const Nv = Math.max(8, Math.round(C('rumpfNv'))), wid = [];
    for (let b = 0; b <= Nv; b++) {
      const x = model.x0 + (model.x1 - model.x0) * b / Nv, P = polyOf(secParams(model, x).nodes, model.perSeg);
      let best = P[0]; for (const q of P) if (q[1] > best[1]) best = q;
      wid.push([x, best[0], best[1]]);
    }
    return wid;
  }
  const HANDLE_R = 6;
  // Griffe: Stationswerte (Kreis), Dickenlinie (Raute), Tangentengriffe (Quadrat, tan: 'i'|'o').
  function handles(kind) {
    const st = stations(), sts = sortedSt(), sel = selIdx(), all = !!C('rumpfShowTan'), out = [];
    const tanH = (s, i, key, u, v) => {
      const j = sts.indexOf(s), t = tanOf(sts, j, key), locked = s.fix === 'circle' && key === 'w';
      if (j > 0) out.push({ i, key, tan: 'i', u: u + t.i[0], v: v + t.i[1], pu: u, pv: v, locked });
      if (j < sts.length - 1) out.push({ i, key, tan: 'o', u: u + t.o[0], v: v + t.o[1], pu: u, pv: v, locked });
    };
    st.forEach((s, i) => {
      const showT = all || i === sel;
      if (kind === 'side') {
        out.push({ i, key: 'top', u: s.x, v: s.top }); out.push({ i, key: 'bot', u: s.x, v: s.bot });
        out.push({ i, key: 'yw', u: s.x, v: ywOf(s), dia: true, locked: s.fix === 'lock' });
        if (showT) { tanH(s, i, 'top', s.x, s.top); tanH(s, i, 'bot', s.x, s.bot); }
      } else if (kind === 'top') {
        out.push({ i, key: 'w', u: s.x, v: s.w });
        if (showT) tanH(s, i, 'w', s.x, s.w);
      }
    });
    if (kind === 'sec') {
      const s = st[sel], h = s.top - s.bot, kw = widestIdx(s), n = s.nodes.length, locked = !!s.fix;
      s.nodes.forEach((q, k) => {
        const y = s.bot + q.y * h, z = q.z * s.w;
        out.push({ i: sel, key: 'sec', k, u: z, v: y, dia: k === kw, locked, node: true });
        if (k > 0) out.push({ i: sel, key: 'sec', k, tan: 'i', u: z + q.i[1] * s.w, v: y + q.i[0] * h, pu: z, pv: y, locked });
        if (k < n - 1) out.push({ i: sel, key: 'sec', k, tan: 'o', u: z + q.o[1] * s.w, v: y + q.o[0] * h, pu: z, pv: y, locked });
      });
    }
    return out;
  }
  const sameH = (a, b) => !!a === !!b && (!a || (a.i === b.i && a.key === b.key && a.k === b.k && a.tan === b.tan));
  function draw2d(kind) {
    ctx.fillStyle = col('--bg', '#0f1216'); ctx.fillRect(0, 0, W, H);
    const xf = view2dBase(kind);
    const b = model && model.bounds ? model.bounds : null;
    if (b) { const iu = kind === 'side' || kind === 'top' ? 0 : 2, iv = kind === 'top' ? 2 : 1; grid2d(xf, b.mn[iu] - 100, b.mx[iu] + 100, b.mn[iv] - 100, b.mx[iv] + 100); }
    drawImg(kind, xf);
    const sel = selIdx(), st = stations();
    if (model && model.G) {
      const line = (pts, iv, colr, wdt, mirror) => {
        ctx.strokeStyle = colr; ctx.lineWidth = wdt; ctx.beginPath();
        pts.forEach((q, i) => { const p = xf.P(q[0], q[iv]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke();
        if (mirror) { ctx.beginPath(); pts.forEach((q, i) => { const p = xf.P(q[0], -q[iv]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); }
      };
      const stLines = (lo, hi) => {
        for (const s of model.st) { const i = st.indexOf(s); const a = xf.P(s.x, lo(s)), c = xf.P(s.x, hi(s)); ctx.strokeStyle = i === sel ? 'rgba(255,120,120,.9)' : 'rgba(180,200,220,.35)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke(); ctx.setLineDash([]); }
      };
      if (kind === 'side') {
        line(linePts(model.L.top, 24), 1, '#4fc3f7', 2); line(linePts(model.L.bot, 24), 1, '#4fc3f7', 2);
        line(widLine(), 1, 'rgba(255,190,80,.7)', 1);
        stLines(s => s.bot - 10, s => s.top + 10);
        drawAttach('side', xf);
      } else if (kind === 'top') {
        line(linePts(model.L.w, 24), 1, '#4fc3f7', 2, true);
        const a = xf.P(model.bounds.mn[0], 0), c = xf.P(model.bounds.mx[0], 0); ctx.strokeStyle = 'rgba(180,200,220,.4)'; ctx.setLineDash([8, 4]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke(); ctx.setLineDash([]);
        stLines(s => -s.w - 10, s => s.w + 10);
        drawAttach('top', xf);
      } else {
        // Spant: alle Stationsspanten blass, gewählte rot, Schnitt bei rumpfCutX blau
        ctx.lineWidth = 1;
        for (const s of model.st) {
          const pts = secHalf(model, s.x); ctx.strokeStyle = st.indexOf(s) === sel ? 'rgba(255,120,120,.8)' : 'rgba(180,200,220,.25)';
          for (const sg of [1, -1]) { ctx.beginPath(); pts.forEach((q, i) => { const p = xf.P(sg * q[2], q[1]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); }
        }
        const x = +C('rumpfCutX') || 0, loops = sectionAt(x);
        ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 2.2;
        for (const Lp of loops) { ctx.beginPath(); Lp.forEach((q, i) => { const p = xf.P(q[2], q[1]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath(); ctx.stroke(); ctx.fillStyle = 'rgba(79,195,247,.15)'; ctx.fill(); }
        let txt = T('Spant bei X =') + ' ' + x.toFixed(1) + ' mm';
        if (loops.length) {
          let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
          for (const Lp of loops) for (const q of Lp) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]); }
          txt += ' · ' + (z1 - z0).toFixed(1) + ' × ' + (y1 - y0).toFixed(1) + ' mm · ' + T('Fläche') + ' ' + (loops.reduce((a, Lp) => a + loopArea(Lp), 0) / 100).toFixed(2) + ' cm²';
        } else txt += ' · ' + T('Schnittebene trifft den Rumpf nicht.');
        const ss = st[sel];
        txt += '<br>' + T('Station') + ' ' + (sel + 1) + ' (' + T('rot') + '): ' + (ss.fix === 'circle' ? T('Kreis') : ss.fix === 'lock' ? T('Form fixiert') : T('frei')) + ' · ' + ss.nodes.length + ' ' + T('Knoten')
          + ' · ' + T('Dickenlinie bei Y =') + ' ' + ywOf(ss).toFixed(1) + ' mm';
        txt += '<br><span style="opacity:.7">' + T('Knoten (Kreis, Raute = breiteste Stelle) und Tangentengriffe (Quadrat) der roten Station ziehen · Strg+Ziehen = Tangente einseitig (Ecke) · Doppelklick auf die Kurve = Knoten einfügen · Pfeiltasten = Schnittlage · Alt+Ziehen/Rad = Bild') + '</span>';
        setInfo(txt);
      }
    }
    if (kind === 'sec') {
      const ss = st[sel], yw = ywOf(ss), a = xf.P(-ss.w - 15, yw), c = xf.P(ss.w + 15, yw);
      ctx.strokeStyle = 'rgba(255,190,80,.6)'; ctx.lineWidth = 1; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke(); ctx.setLineDash([]);
    }
    // Griffe
    const hs = handles(kind);
    for (const h of hs) {
      if (!h.tan) continue;
      const p = xf.P(h.u, h.v), q = xf.P(h.pu, h.pv);
      ctx.strokeStyle = 'rgba(140,220,160,.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    for (const h of hs) {
      const p = xf.P(h.u, h.v), isSel = h.i === sel, isHot = sameH(hot, h);
      const isSelNode = kind === 'sec' && h.node && h.k === selNode;
      ctx.fillStyle = isHot ? '#fff' : h.locked ? 'rgba(150,160,170,.9)' : h.tan ? 'rgba(140,220,160,.95)' : (h.key === 'yw' || h.dia) ? 'rgba(255,190,80,.95)' : isSel ? '#ff8a8a' : '#ffd27a';
      ctx.strokeStyle = isSelNode ? '#fff' : 'rgba(0,0,0,.6)'; ctx.lineWidth = isSelNode ? 1.5 : 1;
      ctx.beginPath();
      if (h.tan) ctx.rect(p.x - 3.5, p.y - 3.5, 7, 7);
      else if (h.dia) { ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x + 5, p.y); ctx.lineTo(p.x, p.y + 5); ctx.lineTo(p.x - 5, p.y); ctx.closePath(); }
      else ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      if (kind === 'sec' && !h.tan) { const pm = xf.P(-h.u, h.v); ctx.beginPath(); ctx.arc(pm.x, pm.y, 2.5, 0, Math.PI * 2); ctx.fill(); }
    }
    if (kind !== 'sec') {
      const s = st[sel];
      let txt = (kind === 'side' ? T('Seitenansicht') : T('Draufsicht')) + ' · ' + T('Station') + ' ' + (sel + 1) + ': X = ' + s.x.toFixed(1) + ' mm';
      if (kind === 'side') txt += ' · ' + T('oben') + ' ' + s.top.toFixed(1) + ' · ' + T('unten') + ' ' + s.bot.toFixed(1) + ' · ' + T('breiteste Stelle bei') + ' ' + ywOf(s).toFixed(1);
      else txt += ' · ' + T('halbe Breite') + ' ' + s.w.toFixed(1) + ' mm';
      txt += '<br><span style="opacity:.7">' + T('Griff ziehen = Wert ändern (waagrecht = X der Station) · Quadrat = Tangente (Strg = einseitig, Ecke) · Klick = Station wählen · Doppelklick auf freie Fläche = Station einfügen · Alt+Ziehen = Bild schieben · Alt+Rad = Bild skalieren') + '</span>';
      if (model && model.err) txt += '<br><span style="color:#f88">' + model.err + '</span>';
      setInfo(txt);
    }
    drawAxes2d(kind);
  }
  // Anbauten in Seiten-/Draufsicht: Wurzelprofil + Anformungsbereich, Leitwerksgrundriss, Wurzelrippen-Ebene.
  function drawAttach(kind, xf) {
    const poly = (pts, closed, colr, dash) => {
      ctx.strokeStyle = colr; ctx.lineWidth = 1.2; ctx.setLineDash(dash || []); ctx.beginPath();
      pts.forEach((q, i) => { const p = xf.P(q[0], q[1]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      if (closed) ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    };
    const g = model.wing, f = model.fin;
    ctx.font = '11px system-ui';
    if (g) {
      if (kind === 'side') {
        const up = [], lo = [];
        for (let i = 0; i <= 40; i++) { const x = g.xLE + g.chord * i / 40, y = wingYs(g, x); up.push([x, y.yu]); lo.push([x, y.yl]); }
        poly(up.concat(lo.reverse()), true, 'rgba(120,230,150,.9)');
        const ym = (wingYs(g, g.xLE).yu + wingYs(g, g.xLE).yl) / 2;
        poly([[g.xLE - g.lf, ym], [g.xLE, ym]], false, 'rgba(120,230,150,.5)', [3, 3]);
        const yt = (wingYs(g, g.xLE + g.chord).yu + wingYs(g, g.xLE + g.chord).yl) / 2;
        poly([[g.xLE + g.chord, yt], [g.xLE + g.chord + g.lb, yt]], false, 'rgba(120,230,150,.5)', [3, 3]);
        ctx.fillStyle = 'rgba(120,230,150,.9)'; const p = xf.P(g.xLE, wingYs(g, g.xLE).yu); ctx.fillText(T('Tragfläche') + (g.name ? ' · ' + g.name : ''), p.x, p.y - 6);
      } else {
        const xa = g.xLE - g.lf, xb = g.xLE + g.chord + g.lb;
        for (const sg of [1, -1]) poly([[xa, 0 * sg], [g.xLE, g.zf * sg], [g.xLE + g.chord, g.zf * sg], [xb, 0]], false, 'rgba(120,230,150,.7)', [4, 3]);
        ctx.fillStyle = 'rgba(120,230,150,.9)'; const p = xf.P(g.xLE, g.zf); ctx.fillText(T('Wurzelrippe Z =') + ' ' + g.zf.toFixed(1), p.x, p.y - 6);
        // Tragfläche aus dem Tragflächendesign: Nasen-/Endleiste je Station, beide Seiten
        const Wg = App.wing;
        if (model.wingMesh && Wg && Wg.stations && state.root) {
          const sc = g.chord / (+state.root.chord || g.chord), le = [], te = [];
          for (const st of Wg.stations) { let a = Infinity, b = -Infinity; for (const q of st.pts) { a = Math.min(a, q.x); b = Math.max(b, q.x); } le.push([g.xLE + a * sc, g.zf + st.z * sc]); te.push([g.xLE + b * sc, g.zf + st.z * sc]); }
          const cw = hexRGB(colOf(3)), cs = 'rgba(' + Math.round(cw[0] * 255) + ',' + Math.round(cw[1] * 255) + ',' + Math.round(cw[2] * 255) + ',.8)';
          for (const sg of [1, -1]) poly(le.concat(te.slice().reverse()).map(q => [q[0], q[1] * sg]), true, cs);
        }
      }
    }
    if (f) {
      const cf = colOf(1), rgba = (h, a) => { const c = hexRGB(h); return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + a + ')'; };
      if (kind === 'side') {
        // Grundriss: Nasenleiste (mit Übergangsbogen) vom Fuß bis zur Spitze, Abschlussgerade, Endleiste zurück zum Fuß
        const pts = [];
        for (let i = 0; i <= 48; i++) { const y = f.y0 + (f.yPT - f.y0) * i / 48; pts.push([finLEx(f, y), y]); }
        pts.push([f.xT, f.yT]); pts.push([finTEx(f, f.y0), f.y0]);
        poly(pts, true, rgba(cf, 0.95));
        if (f.fil) { const c = f.fil.c; ctx.strokeStyle = rgba(cf, 0.35); ctx.setLineDash([2, 3]); ctx.beginPath(); const pc = xf.P(c[0], c[1]); ctx.arc(pc.x, pc.y, f.fil.R * xf.sc, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
        ctx.fillStyle = rgba(cf, 0.95); const p = xf.P(f.xPT, f.yPT); ctx.fillText(T('Seitenleitwerk') + ' · ' + T('Spitzentiefe') + ' ' + f.ct.toFixed(0) + ' mm', p.x, p.y - 6);
      } else {
        // Dickenverlauf (größte halbe Dicke über x)
        const pts = [];
        for (let i = 0; i <= 60; i++) { const x = f.xs + (f.xe - f.xs) * i / 60; let t = 0; for (let k = 0; k <= 16; k++) t = Math.max(t, finT(f, x, f.y0 + (f.yMax - f.y0) * k / 16)); pts.push([x, t]); }
        for (const sg of [1, -1]) poly(pts.map(q => [q[0], q[1] * sg]), false, rgba(cf, 0.7), [4, 3]);
      }
    }
  }
  function drawAxes2d(kind) {
    ctx.fillStyle = col('--muted', '#8aa'); ctx.font = '11px system-ui';
    const nu = kind === 'sec' ? 'Z' : 'X', nv = kind === 'top' ? 'Z' : 'Y';
    ctx.fillText(nu + ' →', 12, H - 12); ctx.fillText('↑ ' + nv, 12, H - 26);
  }
  function draw() {
    if (!ctx && !fit()) return;
    const v = C('rumpfView');
    if (v === 'side' || v === 'top' || v === 'sec') { glHide(); draw2d(v); } else draw3d();
  }
  function refresh() { if (state.activeTab !== 'rumpf') return; build(); draw(); }
  function show() { if (!fit()) return; build(); draw(); }
  function resize() { if (fit()) draw(); }

  // ---------- Bearbeitung in den 2D-Ansichten ------------------------------------
  function hitHandle(kind, mx, my) {
    if (!xf2) return null; let best = null, bd = HANDLE_R + 2;
    for (const h of handles(kind)) { const p = xf2.P(h.u, h.v), d = Math.hypot(p.x - mx, p.y - my); if (d < bd) { bd = d; best = h; } }
    return best;
  }
  function applyHandle(h, u, v, ctrl) {
    const st = stations(), s = st[h.i], sts = sortedSt(), j = sts.indexOf(s);
    if (h.key === 'sec') return h.tan ? applySecTan(s, h, u, v, ctrl) : applySecNode(s, h, u, v);   // Spant: X bleibt
    if (h.tan) return applyLineTan(sts, j, s, h, u, v, ctrl);
    // X: zwischen den Nachbarstationen halten
    const lo = h.i > 0 ? st[h.i - 1].x + 0.5 : -Infinity, hi = h.i < st.length - 1 ? st[h.i + 1].x - 0.5 : Infinity;
    if (!s.xfix) s.x = r1(Math.min(hi, Math.max(lo, u)));
    v = r1(v);
    if (s.fix === 'circle') {
      const c = (s.top + s.bot) / 2;
      if (h.key === 'top') { const r = Math.max(0, v - c); s.top = c + r; s.bot = c - r; }
      else if (h.key === 'bot') { const r = Math.max(0, c - v); s.top = c + r; s.bot = c - r; }
      else if (h.key === 'yw') { const r = (s.top - s.bot) / 2; s.top = v + r; s.bot = v - r; }
      else if (h.key === 'w') { const r = Math.max(0, Math.abs(v)); s.top = c + r; s.bot = c - r; }
      enforceFix(s); return;
    }
    if (h.key === 'top') s.top = Math.max(s.bot, v);
    else if (h.key === 'bot') s.bot = Math.min(s.top, v);
    else if (h.key === 'yw') setYw(s, v);
    else if (h.key === 'w') s.w = Math.max(0, Math.abs(v));
  }
  // Tangentengriff einer Längslinie ziehen (u = x, v = Wert). Ohne Strg bleibt die Gegenseite kollinear.
  function applyLineTan(sts, j, s, h, u, v, ctrl) {
    if (s.fix === 'circle' && h.key === 'w') return;
    const cur = tanOf(sts, j, h.key), base = lval(s, h.key);
    const vec = [u - s.x, v - base];
    vec[0] = h.tan === 'o' ? Math.max(0, vec[0]) : Math.min(0, vec[0]);
    const t = s.tan[h.key] = { i: cur.i, o: cur.o }; t[h.tan] = vec;
    if (!ctrl) {
      const other = h.tan === 'o' ? 'i' : 'o', L = Math.hypot(t[other][0], t[other][1]), Lv = Math.hypot(vec[0], vec[1]);
      if (L > 1e-9 && Lv > 1e-9) t[other] = [-vec[0] / Lv * L, -vec[1] / Lv * L];
    }
  }
  // Spantknoten ziehen (u = z, v = y); Endknoten bleiben auf der Symmetrieebene und setzen Ober-/Unterkante.
  function applySecNode(s, h, u, v) {
    if (s.fix) return;
    const n = s.nodes.length, k = h.k, hh = (s.top - s.bot) || 1, w = s.w || 1;
    v = r1(v);
    if (k === 0) s.top = Math.max(s.bot, v);
    else if (k === n - 1) s.bot = Math.min(s.top, v);
    else { const q = s.nodes[k]; q.y = clamp((v - s.bot) / hh, 0.01, 0.99); q.z = Math.max(0, Math.abs(u)) / w; }
    normalizeShape(s);
  }
  function applySecTan(s, h, u, v, ctrl) {
    if (s.fix) return;
    const q = s.nodes[h.k], n = s.nodes.length, hh = (s.top - s.bot) || 1, w = s.w || 1;
    const py = s.bot + q.y * (s.top - s.bot), pz = q.z * s.w;
    let vec = [(v - py) / hh, (u - pz) / w];
    if (h.k === 0 || h.k === n - 1) vec = [0, Math.max(0.01, vec[1])];
    q[h.tan] = vec;
    if (!ctrl && h.k > 0 && h.k < n - 1) {
      const other = h.tan === 'o' ? 'i' : 'o', L = Math.hypot(q[other][0], q[other][1]), Lv = Math.hypot(vec[0], vec[1]);
      if (L > 1e-9 && Lv > 1e-9) q[other] = [-vec[0] / Lv * L, -vec[1] / Lv * L];
    }
    normalizeShape(s);
  }
  function enforceFix(s) {
    if (s.fix === 'circle') { s.top = r2(s.top); s.bot = r2(s.bot); s.w = r2((s.top - s.bot) / 2); s.nodes = circleNodes(0.5); }
  }
  function setFix(s, v) {
    s.fix = v || '';
    if (v === 'circle') enforceFix(s);
  }
  function resetShape(s) { const h = s.top - s.bot; s.nodes = circleNodes(h > 0 ? (ywOf(s) - s.bot) / h : 0.5); }
  function addNode(s, k, t) {
    if (s.fix) return;
    if (k == null) k = longestSeg(s.nodes);
    splitSeg(s.nodes, k, t == null ? 0.5 : t); selNode = k + 1; normalizeShape(s);
  }
  function removeNode(s, k) {
    if (s.fix || s.nodes.length <= 3) return;
    if (!(k > 0 && k < s.nodes.length - 1)) k = Math.max(1, Math.min(s.nodes.length - 2, Math.round(s.nodes.length / 2)));
    s.nodes.splice(k, 1); selNode = Math.max(1, k - 1); normalizeShape(s);
  }
  function syncInputs() {
    const st = stations();
    document.querySelectorAll('[data-rst]').forEach(el => {
      const [i, k] = el.dataset.rst.split(':'); const s = st[+i]; if (!s || document.activeElement === el) return;
      el.value = r2(k === 'yw' ? ywOf(s) : s[k]);
    });
  }
  // Station bei x einfügen: Längslinien werden exakt geteilt (Form bleibt), Knoten überblendet.
  function insertStation(x) {
    const st = stations(), sts = sortedSt();
    x = r1(x);
    let j = -1; for (let q = 0; q + 1 < sts.length; q++) if (x > sts[q].x + 0.5 && x < sts[q + 1].x - 0.5) j = q;
    let ns;
    if (j < 0) {
      // außerhalb: Kopie der nächsten Station
      if (sts.some(s => Math.abs(s.x - x) <= 0.5)) return;
      const nb = x < sts[0].x ? sts[0] : sts[sts.length - 1];
      ns = JSON.parse(JSON.stringify(nb)); ns.x = x; ns.tan = {};
    } else {
      if (!model || !model.MA) build();
      const a = sts[j], b = sts[j + 1];
      ns = { x, fix: (a.fix === 'circle' && b.fix === 'circle') ? 'circle' : '', tan: {}, nodes: model && model.MA ? morphAt(model, x) : JSON.parse(JSON.stringify(a.nodes)) };
      for (const key of ['top', 'bot', 'w']) {
        const sg = lineSegs(sts, key)[j], t = solveT(sg.P, x), [A, B] = splitBez(sg.P, t), M = A[3];
        ns[key] = r1(M[1]);
        const ta = tanOf(sts, j, key), tb = tanOf(sts, j + 1, key);
        if (!(a.fix === 'circle' && key === 'w')) a.tan[key] = { i: ta.i, o: [A[1][0] - A[0][0], A[1][1] - A[0][1]] };
        if (!(b.fix === 'circle' && key === 'w')) b.tan[key] = { i: [B[2][0] - B[3][0], B[2][1] - B[3][1]], o: tb.o };
        ns.tan[key] = { i: [A[2][0] - M[0], A[2][1] - M[1]], o: [B[1][0] - M[0], B[1][1] - M[1]] };
      }
      ns.w = Math.max(0, ns.w);
      if (ns.fix === 'circle') enforceFix(ns);
    }
    let i = st.findIndex(s => s.x > x); if (i < 0) i = st.length;
    st.splice(i, 0, ns);
    S('rumpfSel', i); buildSidebar(); refresh();
  }
  function cutStep(dir) {
    if (!model || !model.bounds) return;
    const b = model.bounds, stp = Math.max(0.5, Math.round((b.mx[0] - b.mn[0]) / 100 * 2) / 2);
    S('rumpfCutX', Math.min(b.mx[0], Math.max(b.mn[0], (+C('rumpfCutX') || 0) + dir * stp)));
    document.querySelectorAll('[data-rcut]').forEach(el => { if (document.activeElement !== el) el.value = r1(C('rumpfCutX')); });
    draw();
  }
  // Doppelklick in der Spantansicht: Knoten auf der Kurve der gewählten Station einfügen.
  function insertNodeAt(mx, my) {
    const s = stations()[selIdx()]; if (s.fix || !xf2) return false;
    const hh = s.top - s.bot; let best = null, bd = 9;
    for (let k = 0; k + 1 < s.nodes.length; k++) {
      const a = s.nodes[k], b = s.nodes[k + 1];
      const P = [[s.bot + a.y * hh, a.z * s.w], [s.bot + (a.y + a.o[0]) * hh, (a.z + a.o[1]) * s.w], [s.bot + (b.y + b.i[0]) * hh, (b.z + b.i[1]) * s.w], [s.bot + b.y * hh, b.z * s.w]];
      for (let q = 1; q < 40; q++) { const t = q / 40, p = bez2(P, t); for (const sg of [1, -1]) { const sc = xf2.P(sg * p[1], p[0]), d = Math.hypot(sc.x - mx, sc.y - my); if (d < bd) { bd = d; best = { k, t }; } } }
    }
    if (!best) return false;
    addNode(s, best.k, best.t); buildSidebar(); refresh(); return true;
  }
  function bindCanvas() {
    if (!canvas || bound) return; bound = true;
    if (window.ViewCube) ViewCube.attach({ canvas: () => canvas, get: () => cam, set: (y, p) => { cam.yaw = y; cam.pitch = p; }, redraw: () => draw(), rot: ViewCube.ROT_STD, k: [-0.01, -0.01] });
    let downX = 0, downY = 0, moved = false;
    const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener('mousedown', e => {
      const v = C('rumpfView'); dragging = true; moved = false; lastX = downX = e.clientX; lastY = downY = e.clientY; dragH = null; dragCtrl = e.ctrlKey;
      if (v === '3d') dragMode = (e.shiftKey || e.button === 1) ? 'pan' : 'rot';
      else if (e.altKey) dragMode = 'img';
      else {
        const [mx, my] = pos(e); const h = hitHandle(v, mx, my);
        if (h && e.button === 0 && !h.locked) { dragMode = 'handle'; dragH = h; S('rumpfSel', h.i); if (h.node) selNode = h.k; }
        else if (h && e.button === 0) { dragMode = 'pan'; S('rumpfSel', h.i); if (h.node) selNode = h.k; draw(); }
        else dragMode = 'pan';
      }
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      const v = C('rumpfView');
      if (!dragging) {
        if (v !== '3d' && canvas.matches(':hover')) { const [mx, my] = pos(e); const h = hitHandle(v, mx, my); const ch = !sameH(h, hot); hot = h; canvas.style.cursor = h ? (h.locked ? 'not-allowed' : 'pointer') : ''; if (ch) draw(); }
        return;
      }
      const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 3) moved = true;
      if (dragMode === 'rot') { cam.yaw -= dx * 0.01 * (Math.cos(cam.pitch) < 0 ? -1 : 1); cam.pitch -= dy * 0.01; draw(); }   // invertiert (wie Simulator)
      else if (dragMode === 'pan') { if (v === '3d') { cam.px += dx; cam.py += dy; } else { cam2[v].px += dx; cam2[v].py += dy; } draw(); }
      else if (dragMode === 'img') { const c = C(IMG_KEY[v]); if (c && xf2) { c.x += dx / xf2.sc; c.y -= dy / xf2.sc; syncImgInputs(); draw(); } }
      else if (dragMode === 'handle' && dragH && xf2) { const [mx, my] = pos(e); const [u, w] = xf2.inv(mx, my); applyHandle(dragH, u, w, dragCtrl || e.ctrlKey); build(); draw(); }
    });
    window.addEventListener('mouseup', () => {
      if (dragging && dragMode === 'handle') { syncInputs(); if (dragH && (dragH.key === 'sec' || dragH.tan)) buildSidebar(); }
      if (dragging && !moved && dragMode === 'handle') { buildSidebar(); draw(); }
      dragging = false; dragH = null;
    });
    canvas.addEventListener('dblclick', e => {
      const v = C('rumpfView');
      if (v === '3d') { cam = Object.assign({}, CAM0); draw(); return; }
      const [mx, my] = pos(e);
      if ((v === 'side' || v === 'top') && xf2) { if (hitHandle(v, mx, my)) return; const [u] = xf2.inv(mx, my); insertStation(u); return; }
      if (v === 'sec') { if (hitHandle(v, mx, my)) return; if (insertNodeAt(mx, my)) return; }
      cam2[v] = { zoom: 1, px: 0, py: 0 }; draw();
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault(); const v = C('rumpfView'), f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      if (e.altKey && v !== '3d') {
        const c = C(IMG_KEY[v]); if (!c || !xf2) return;
        const [mx, my] = pos(e), [u, w] = xf2.inv(mx, my);
        c.len = Math.max(1, c.len * f); c.x = u - (u - c.x) * f; c.y = w - (w - c.y) * f;
        syncImgInputs(); draw(); return;
      }
      if (v === '3d') cam.zoom = Math.max(0.05, Math.min(60, cam.zoom * f)); else cam2[v].zoom = Math.max(0.05, Math.min(60, cam2[v].zoom * f));
      draw();
    }, { passive: false });
    window.addEventListener('keydown', e => {
      if (state.activeTab !== 'rumpf' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) return;
      const v = C('rumpfView');
      if (v === 'sec') {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { cutStep(-1); e.preventDefault(); }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { cutStep(+1); e.preventDefault(); }
        else if (e.key === 'Delete') { removeNode(stations()[selIdx()], selNode); buildSidebar(); refresh(); }
      }
      else if (e.key === 'Delete' && v !== '3d') { removeStation(selIdx()); }
    });
    const vb = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
    const setView = v => { S('rumpfView', v); if (v === '3d') cam = Object.assign({}, CAM0); buildSidebar(); draw(); };
    vb('rumpfIso', () => setView('3d'));
    vb('rumpf3dTop', () => { S('rumpfView', '3d'); cam = Object.assign({}, CAM0, { yaw: 0, pitch: 1.5 }); buildSidebar(); draw(); });
    vb('rumpfSideV', () => setView('side'));
    vb('rumpfTopV', () => setView('top'));
    vb('rumpfSecV', () => setView('sec'));
  }
  function removeStation(i) {
    const st = stations(); if (st.length <= 2) return;
    st.splice(i, 1); S('rumpfSel', Math.max(0, i - 1)); buildSidebar(); refresh();
  }
  function loadImage(kind) {
    const handler = f => {
      const im = new Image(); im.onload = () => {
        img[kind] = im;
        const key = IMG_KEY[kind];
        if (!C(key)) {
          const b = model && model.bounds ? model.bounds : { mn: [0, -50, -50], mx: [1000, 50, 50] };
          if (kind === 'sec') S(key, { len: b.mx[2] - b.mn[2], x: b.mn[2], y: b.mx[1], flip: false });
          else S(key, { len: b.mx[0] - b.mn[0], x: b.mn[0], y: kind === 'side' ? b.mx[1] : b.mx[2], flip: false });
        }
        buildSidebar(); draw();
      };
      im.src = URL.createObjectURL(f);
    };
    if (App.loadFileVia) App.loadFileVia({ 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'] }, handler, 'fileRumpfImg', 'ldImg');
    else { const inp = document.getElementById('fileRumpfImg'); if (inp) { inp.onchange = () => { if (inp.files[0]) handler(inp.files[0]); inp.value = ''; }; inp.click(); } }
  }
  function syncImgInputs() {
    const c = C(IMG_KEY[C('rumpfView')]); if (!c) return;
    document.querySelectorAll('[data-rimg]').forEach(el => { if (document.activeElement !== el) el.value = r1(c[el.dataset.rimg]); });
  }

  // Profil (.dat) für einen Anbau laden: cb({ name, pts }).
  function datLoad(cb) {
    const handler = async f => {
      try {
        const prof = Airfoil.parseDat(await f.text());
        const closed = App.closeLoadedTE ? App.closeLoadedTE(prof) : prof;
        cb({ name: prof.name || f.name, pts: closed.map(q => ({ x: q.x, y: q.y })) });
      } catch (err) { alert(T('Import fehlgeschlagen: ') + err.message); }
    };
    let inp = document.getElementById('fileDatRumpf');
    if (!inp) { inp = document.createElement('input'); inp.type = 'file'; inp.id = 'fileDatRumpf'; inp.accept = '.dat,.bez,.txt,.cor'; inp.style.display = 'none'; document.body.appendChild(inp); }
    inp.onchange = () => { const f = inp.files && inp.files[0]; inp.value = ''; if (f) handler(f); };
    if (typeof App.loadFileVia === 'function') App.loadFileVia({ 'text/plain': ['.dat', '.bez', '.txt', '.cor'] }, handler, 'fileDatRumpf', 'ldDat');
    else inp.click();
  }
  function profRow(body, label, src, thk, prof, setSrc, setThk, setProf, rb, withWing) {
    const opts = withWing ? [['wing', 'aus Tragflächendesign (Wurzelrippe)'], ['dat', 'aus Datei (.dat)']] : [['naca', 'NACA 00xx (symmetrisch, Dicke unten)'], ['dat', 'aus Datei (.dat)']];
    selectRow(body, label, opts, () => src(), v => { setSrc(v); rb(); });
    if (src() === 'dat') {
      const row = document.createElement('div'); row.style.display = 'flex'; row.style.gap = '4px'; row.style.alignItems = 'center'; row.style.margin = '2px 0 4px';
      const nm = document.createElement('span'); nm.style.fontSize = '10px'; nm.style.opacity = '.8'; nm.style.flex = '1'; nm.textContent = prof() && prof().name ? prof().name : T('(kein Profil geladen)');
      row.appendChild(mkMini(T('Profil laden…'), () => datLoad(p => { setProf(p); rb(); }))); row.appendChild(nm); body.appendChild(row);
    } else if (!withWing) numRow(body, 'Dicke (%)', () => thk(), v => { setThk(v); rb(); }, { step: 1, min: 1, max: 40, int: true, norender: true, enter: true });
  }
  function colorRow(body, label, key) {
    const def = DEF[key], row = document.createElement('div'); row.className = 'row';
    const l = document.createElement('label'); l.textContent = T(label); row.appendChild(l);
    const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;gap:6px;align-items:center';
    const inp = document.createElement('input'); inp.type = 'color'; inp.value = /^#[0-9a-f]{6}$/i.test(C(key) || '') ? C(key) : def;
    inp.style.cssText = 'width:46px;height:26px;padding:0;cursor:pointer';
    inp.oninput = () => { S(key, inp.value); draw(); };
    const rs = document.createElement('button'); rs.textContent = '\u21ba'; rs.title = T('Standardfarbe'); rs.style.cssText = 'padding:0 8px;min-width:0';
    rs.onclick = () => { S(key, def); inp.value = def; draw(); };
    wrap.appendChild(inp); wrap.appendChild(rs); row.appendChild(wrap); body.appendChild(row);
  }
  // Sidebar-Gruppen für die Anbauten.
  function attachSidebar(side, rr, rb) {
    const w = WG(), f = FN();
    const gw = grp('Rumpf: Tragflächenübergang', !!w.on, 'rumpf');
    hint(gw.body, 'Seglertypische Flächenanformung: die Wurzelrippe (Profil aus dem Tragflächendesign oder .dat) wird als ebene Fläche bis zur Wurzelrippen-Ebene Z aus dem Rumpf herausgezogen; die Kanten zum Rumpf bekommen eine Hohlkehle (Radius). Vor der Nase und hinter der Endleiste läuft die Anformung weich in die Rumpfflanke aus. Grün in Seiten-/Draufsicht.');
    boolRow(gw.body, 'Tragflächenübergang einrechnen', () => !!w.on, v => { w.on = v; rb(); });
    if (w.on) {
      profRow(gw.body, 'Wurzelprofil', () => w.src, null, () => w.prof, v => { w.src = v; }, null, p => { w.prof = p; }, rb, true);
      numRow(gw.body, 'Nasenleiste X (mm)', () => w.xLE, v => { w.xLE = v; rr(); }, { step: 5, norender: true });
      numRow(gw.body, 'Nasenleiste Y (mm)', () => w.yLE, v => { w.yLE = v; rr(); }, { step: 1, norender: true });
      numRow(gw.body, 'Wurzeltiefe (mm, 0 = aus Tragflächendesign)', () => w.chord, v => { w.chord = Math.max(0, v); rr(); }, { step: 5, min: 0, norender: true });
      numRow(gw.body, 'Einstellwinkel (°)', () => w.alpha, v => { w.alpha = v; rr(); }, { step: 0.5, norender: true });
      numRow(gw.body, 'Wurzelrippen-Ebene Z (mm, 0 = automatisch)', () => w.z, v => { w.z = Math.max(0, v); rr(); }, { step: 1, min: 0, norender: true, hint: 'Abstand der ebenen Anlagefläche von der Rumpfmitte. Automatisch: größte halbe Rumpfbreite im Flächenbereich + 15 mm.' });
      numRow(gw.body, 'Hohlkehle Radius (mm)', () => w.R, v => { w.R = Math.max(0, v); rr(); }, { step: 1, min: 0, norender: true });
      numRow(gw.body, 'Anformung vor der Nase (mm)', () => w.lf, v => { w.lf = Math.max(0, v); rr(); }, { step: 5, min: 0, norender: true });
      numRow(gw.body, 'Anformung hinter der Endleiste (mm)', () => w.lb, v => { w.lb = Math.max(0, v); rr(); }, { step: 5, min: 0, norender: true });
      if (model && model.wing) hint(gw.body, T('Wurzelrippe bei Z =') + ' ' + model.wing.zf.toFixed(1) + ' mm · ' + T('Wurzeltiefe') + ' ' + model.wing.chord.toFixed(0) + ' mm' + (model.wing.name ? ' · ' + model.wing.name : ''));
      else if (w.src === 'dat' && !(w.prof && w.prof.pts)) hint(gw.body, 'Kein Profil geladen — der Übergang wird nicht eingerechnet.');
    }
    side.appendChild(gw.g);

    const gf = grp('Rumpf: Seitenleitwerk', !!f.on, 'rumpf');
    hint(gf.body, 'Seitenansicht: Nasenleiste und Endleiste sind Geraden mit einstellbarem Winkel, der Abschluss oben eine Gerade mit Winkel. Die Nasenleiste läuft unten mit einem Übergangsradius tangential in die Rumpfoberkante ein. Loft von Wurzel- zu Spitzenprofil (Dicke in Z), elliptischer Randbogen oben, Hohlkehle zum Rumpf. Unter dem Fuß läuft das Profil mit konstanter Dicke bis zur Rumpfunterkante (Leitwerksträger). Reicht das Leitwerk über das Rumpfende hinaus, wird der Rumpf entsprechend verlängert.');
    boolRow(gf.body, 'Seitenleitwerk einrechnen', () => !!f.on, v => { f.on = v; rb(); });
    if (f.on) {
      numRow(gf.body, 'Nasenleiste Wurzel X (mm, 0 = am Rumpfende)', () => f.xLE, v => { f.xLE = Math.max(0, v); rr(); }, { step: 5, min: 0, norender: true });
      boolRow(gf.body, 'Fußhöhe automatisch (Rumpfmitte)', () => !!f.y0Auto, v => { f.y0Auto = v; if (!v && model && model.fin) f.y0 = r1(model.fin.y0); rb(); });
      if (!f.y0Auto) numRow(gf.body, 'Fußhöhe Y (mm)', () => f.y0, v => { f.y0 = v; rr(); }, { step: 1, norender: true });
      numRow(gf.body, 'Tiefe Wurzel (mm)', () => f.cr, v => { f.cr = Math.max(1, v); rr(); }, { step: 5, min: 1, norender: true });
      numRow(gf.body, 'Höhe Nasenleiste über dem Fuß (mm)', () => f.h, v => { f.h = Math.max(1, v); rr(); }, { step: 5, min: 1, norender: true });
      numRow(gf.body, 'Nasenleiste: Winkel zur Senkrechten (°, + = nach hinten)', () => f.angLE, v => { f.angLE = clamp(v, -80, 80); rr(); }, { step: 1, min: -80, max: 80, norender: true });
      numRow(gf.body, 'Übergangsradius Nasenleiste → Rumpf (mm)', () => f.leR, v => { f.leR = Math.max(0, v); rr(); }, { step: 5, min: 0, norender: true, hint: 'Die gerade Nasenleiste läuft unten mit diesem Radius tangential in die Rumpfoberkante ein (0 = Ecke).' });
      numRow(gf.body, 'Endleiste: Winkel zur Senkrechten (°, + = nach hinten)', () => f.angTE, v => { f.angTE = clamp(v, -80, 80); rr(); }, { step: 1, min: -80, max: 80, norender: true });
      numRow(gf.body, 'Abschluss oben: Winkel zur Waagrechten (°, + = hinten höher)', () => f.angTip, v => { f.angTip = clamp(v, -60, 60); rr(); }, { step: 1, min: -60, max: 60, norender: true, hint: 'Gerade vom Ende der Nasenleiste bis zur Endleiste; die Spitzentiefe ergibt sich daraus.' });
      numRow(gf.body, 'Randbogen oben (mm)', () => f.tipRound, v => { f.tipRound = Math.max(0, v); rr(); }, { step: 5, min: 0, norender: true });
      numRow(gf.body, 'Hohlkehle zum Rumpf Radius (mm)', () => f.R, v => { f.R = Math.max(0, v); rr(); }, { step: 1, min: 0, norender: true });
      subhead(gf.body, 'Profil unten (Wurzel)');
      profRow(gf.body, 'Wurzelprofil', () => f.srcR, () => f.thkR, () => f.profR, v => { f.srcR = v; }, v => { f.thkR = v; }, p => { f.profR = p; }, rb, false);
      subhead(gf.body, 'Profil oben (Spitze)');
      profRow(gf.body, 'Spitzenprofil', () => f.srcT, () => f.thkT, () => f.profT, v => { f.srcT = v; }, v => { f.thkT = v; }, p => { f.profT = p; }, rb, false);
      if (model && model.fin) hint(gf.body, T('Fuß bei Y =') + ' ' + model.fin.y0.toFixed(1) + ' mm · X ' + model.fin.xs.toFixed(0) + ' … ' + model.fin.xe.toFixed(0) + ' mm · ' + T('Spitzentiefe') + ' ' + model.fin.ct.toFixed(0) + ' mm' + (model.fin.fil ? '' : ' · ' + T('(kein Übergangsradius: Nasenleiste trifft die Oberkante nicht)')));
    }
    side.appendChild(gf.g);
  }

  // ---------- Sidebar (Reiter „rumpf") ----------------------------------------------
  function rumpfSidebar(side) {
    const rr = () => refresh();
    const rb = () => { buildSidebar(); refresh(); };
    const st = stations(), sel = selIdx();
    const g = grp('Rumpf: Stationen (Spanten)', true, 'rumpf', { alwaysOpen: true });
    hint(g.body, 'Der Rumpf entsteht als Loft-Fläche aus Bezier-Splines: Oberkante, Unterkante (Seitenansicht) und halbe Breite (Draufsicht) laufen als Splines durch die Stationen, die Tangenten je Station sind automatisch oder per Griff ziehbar. Wenige Stationen genügen. Die Nase ist eine kleine erste Station mit eigenem Querschnitt (Deckel); Breite 0 = Messerkante.');
    const bar = document.createElement('div'); bar.style.display = 'flex'; bar.style.flexWrap = 'wrap'; bar.style.gap = '4px'; bar.style.margin = '4px 0';
    bar.appendChild(mkMini(T('+ Station dahinter'), () => { const a = st[sel], b = st[sel + 1]; insertStation(b ? (a.x + b.x) / 2 : a.x + 100); }));
    bar.appendChild(mkMini(T('− Station löschen'), () => removeStation(sel)));
    bar.appendChild(mkMini(T('Vorlage Segler'), () => { if (confirm(T('Alle Stationen durch die Vorlage ersetzen?'))) { S('rumpfSt', TPL.segler()); S('rumpfSel', 0); rb(); } }));
    bar.appendChild(mkMini(T('Vorlage Motormodell'), () => { if (confirm(T('Alle Stationen durch die Vorlage ersetzen?'))) { S('rumpfSt', TPL.motor()); S('rumpfSel', 0); rb(); } }));
    g.body.appendChild(bar);
    const tbl = document.createElement('table'); tbl.className = 'rumpf-tbl'; tbl.style.width = '100%'; tbl.style.borderCollapse = 'collapse'; tbl.style.fontSize = '10px'; tbl.style.tableLayout = 'fixed';
    const cols = [['x', 'X'], ['top', T('oben')], ['bot', T('unten')], ['w', T('½ Breite')], ['yw', T('breit bei')]];
    const thead = document.createElement('tr'); thead.innerHTML = '<th>#</th><th title="' + T('Form: frei (Knoten ziehbar) · Fix = Form fixiert (nicht mehr ziehbar) · Kreis = Kreisquerschnitt, Breite folgt der Höhe') + '">' + T('Form') + '</th>' + cols.map(c => '<th title="' + T({ x: 'Lage entlang der Rumpflänge (mm)', top: 'Oberkante Y (mm)', bot: 'Unterkante Y (mm)', w: 'halbe Breite Z (mm)', yw: 'Höhe Y der breitesten Stelle (mm)' }[c[0]]) + '">' + c[1] + '</th>').join('') + '<th title="' + T('X-Lage fixieren: die Station lässt sich mit der Maus nur noch senkrecht zur Rumpflänge ziehen (Wert bleibt per Eingabe änderbar).') + '" style="width:22px">' + T('X fix') + '</th><th title="' + T('Tangenten dieser Station: automatisch (Catmull-Rom) oder gezogen') + '">' + T('Tang.') + '</th>';
    tbl.appendChild(thead);
    st.forEach((s, i) => {
      const tr = document.createElement('tr'); if (i === sel) tr.style.background = 'rgba(255,120,120,.15)';
      const td0 = document.createElement('td'); td0.textContent = i + 1; td0.style.cursor = 'pointer'; td0.onclick = () => { S('rumpfSel', i); rb(); }; tr.appendChild(td0);
      const tdf = document.createElement('td'); const sf = document.createElement('select'); sf.style.fontSize = '10px'; sf.style.padding = '0'; sf.style.width = '46px'; sf.style.minWidth = '0';
      [['', T('frei')], ['lock', 'Fix'], ['circle', T('Kreis')]].forEach(o => { const e = document.createElement('option'); e.value = o[0]; e.textContent = o[1]; sf.appendChild(e); });
      sf.value = s.fix || '';
      sf.onchange = () => { setFix(s, sf.value); S('rumpfSel', i); rb(); };
      tdf.appendChild(sf); tr.appendChild(tdf);
      for (const [k] of cols) {
        const td = document.createElement('td'); const inp = document.createElement('input'); inp.type = 'text'; inp.inputMode = 'decimal'; inp.style.width = '100%'; inp.style.minWidth = '26px'; inp.style.padding = '1px 2px'; inp.style.fontSize = '10px';
        inp.value = r2(k === 'yw' ? ywOf(s) : s[k]); inp.dataset.rst = i + ':' + k;
        inp.onfocus = () => { if (selIdx() !== i) { S('rumpfSel', i); draw(); } };
        if (s.fix === 'circle' && k === 'w') { inp.readOnly = true; inp.style.opacity = '.5'; inp.title = T('Kreis: folgt Ober-/Unterkante'); }
        if (s.fix === 'lock' && k === 'yw') { inp.readOnly = true; inp.style.opacity = '.5'; inp.title = T('Form fixiert'); }
        inp.onchange = () => { const v = parseFloat(String(inp.value).replace(',', '.')); if (isNaN(v)) return; if (k === 'yw') setYw(s, v); else s[k] = v; if (k === 'x') st.sort((a, b) => a.x - b.x); enforceFix(s); rr(); syncInputs(); };
        td.appendChild(inp); tr.appendChild(td);
      }
      const tdx = document.createElement('td'); tdx.style.textAlign = 'center';
      const cbx = document.createElement('input'); cbx.type = 'checkbox'; cbx.checked = !!s.xfix; cbx.style.margin = '0'; cbx.title = T('X-Lage dieser Station fixieren');
      cbx.onchange = () => { s.xfix = cbx.checked; S('rumpfSel', i); draw(); };
      tdx.appendChild(cbx); tr.appendChild(tdx);
      const tdt = document.createElement('td'); const hasT = ['top', 'bot', 'w'].some(k => s.tan[k] && (s.tan[k].i || s.tan[k].o));
      if (hasT) { const b = mkMini('auto', () => { s.tan = {}; rb(); }); b.title = T('Gezogene Tangenten dieser Station verwerfen (wieder automatisch)'); b.style.fontSize = '9px'; b.style.padding = '0 3px'; tdt.appendChild(b); }
      else { tdt.textContent = T('auto'); tdt.style.opacity = '.5'; tdt.style.textAlign = 'center'; }
      tr.appendChild(tdt);
      tbl.appendChild(tr);
    });
    g.body.appendChild(tbl);
    hint(g.body, 'In Seiten-/Draufsicht lassen sich Werte und Tangenten (grüne Quadrate) mit der Maus ziehen; Doppelklick fügt eine Station ein (Form bleibt), Entf löscht die gewählte.');
    side.appendChild(g.g);

    const q = grp('Rumpf: Fläche & Anzeige', false, 'rumpf');
    numRow(q.body, 'Netz: Schritte um den Spant', () => C('rumpfNu'), v => { S('rumpfNu', v); rr(); }, { int: true, min: 6, max: 200, norender: true });
    numRow(q.body, 'Netz: Schritte längs', () => C('rumpfNv'), v => { S('rumpfNv', v); rr(); }, { int: true, min: 8, max: 1000, norender: true });
    selectRow(q.body, 'Darstellung', [['fine', 'fein (glatt, Glanz)'], ['flat', 'flach (Facetten)'], ['wire', 'Drahtmodell (verdeckte Kanten weg)'], ['2d', 'kompatibel (ohne WebGL)']], () => renderMode(), v => { S('rumpfRender', v); draw(); });
    colorRow(q.body, 'Farbe Rumpf', 'rumpfColBody'); colorRow(q.body, 'Farbe Seitenleitwerk', 'rumpfColFin'); colorRow(q.body, 'Farbe Tragflächenübergang', 'rumpfColAtt'); colorRow(q.body, 'Farbe Tragfläche', 'rumpfColWing');
    boolRow(q.body, 'Tragfläche aus dem Tragflächendesign zeigen', () => C('rumpfShowWing'), v => { S('rumpfShowWing', v); rr(); }, 'Nur Anzeige (nicht im STL). Die Wurzelrippe des Tragflächendesigns sitzt lagerichtig an der Wurzelrippen-Ebene des Übergangs, auf beiden Seiten; Tiefe und Einstellwinkel wie beim Übergang. Braucht einen eingeschalteten Tragflächenübergang.');
    boolRow(q.body, 'Stationskurven zeigen', () => C('rumpfShowSt'), v => { S('rumpfShowSt', v); draw(); });
    boolRow(q.body, 'Tangenten aller Stationen zeigen', () => C('rumpfShowTan'), v => { S('rumpfShowTan', v); draw(); }, 'Aus: nur die Tangenten der gewählten Station werden in Seiten-/Draufsicht gezeigt.');
    side.appendChild(q.g);

    if (C('rumpfView') !== '3d') {
      const kind = C('rumpfView'), key = IMG_KEY[kind], front = kind === 'sec';
      const b = grp('Rumpf: Hintergrundbild (' + (kind === 'side' ? 'Seitenansicht' : kind === 'top' ? 'Draufsicht' : 'Vorderansicht') + ')', false, 'rumpf');
      hint(b.body, front ? 'Spantzeichnung / Vorderansicht hinterlegen und die Knoten der gewählten Station darüber ziehen. Maßstab = Bildbreite in mm; Lage per Zahlen, Alt+Ziehen (schieben) oder Alt+Rad (skalieren um den Mauszeiger).'
        : 'Zeichnung (Dreitafel) hinterlegen und die Stationen darüber ziehen. Maßstab = Bildbreite in mm (z. B. Rumpflänge); Lage per Zahlen, Alt+Ziehen (schieben) oder Alt+Rad (skalieren um den Mauszeiger).');
      const bb = document.createElement('div'); bb.style.display = 'flex'; bb.style.gap = '4px';
      bb.appendChild(mkMini(T('Bild laden…'), () => loadImage(kind)));
      bb.appendChild(mkMini(T('Bild entfernen'), () => { img[kind] = null; S(key, null); rb(); }));
      b.body.appendChild(bb);
      const c = C(key);
      if (c && img[kind]) {
        numRow(b.body, 'Bildbreite entspricht (mm)', () => c.len, v => { c.len = Math.max(1, v); draw(); }, { step: 10, min: 1, norender: true }).dataset.rimg = 'len';
        numRow(b.body, 'Bild links ' + (front ? 'Z' : 'X') + ' (mm)', () => c.x, v => { c.x = v; draw(); }, { step: 5, norender: true }).dataset.rimg = 'x';
        numRow(b.body, 'Bild oben ' + (kind === 'top' ? 'Z' : 'Y') + ' (mm)', () => c.y, v => { c.y = v; draw(); }, { step: 5, norender: true }).dataset.rimg = 'y';
        if (front) { const bc = document.createElement('div'); bc.appendChild(mkMini(T('Bild mittig (Z = 0)'), () => { c.x = -c.len / 2; syncImgInputs(); draw(); })); b.body.appendChild(bc); }
        boolRow(b.body, 'Bild senkrecht spiegeln', () => !!c.flip, v => { c.flip = v; draw(); });
      }
      numRow(b.body, 'Deckkraft (%)', () => C('rumpfImgOp'), v => { S('rumpfImgOp', v); draw(); }, { step: 5, min: 0, max: 100, norender: true });
      side.appendChild(b.g);
    }
    if (C('rumpfView') === 'sec') {
      const c = grp('Rumpf: Spant / Schnitt', true, 'rumpf');
      const bd = model && model.bounds ? model.bounds : { mn: [0, 0, 0], mx: [1000, 0, 0] };
      const row = document.createElement('div'); row.className = 'row'; const l = document.createElement('label'); l.textContent = T('Schnittlage X (mm)');
      const rg = document.createElement('input'); rg.type = 'range'; rg.min = bd.mn[0]; rg.max = bd.mx[0]; rg.step = 0.5; rg.value = C('rumpfCutX'); rg.dataset.rcut = '1'; rg.style.width = '100%';
      rg.oninput = () => { S('rumpfCutX', +rg.value); document.querySelectorAll('[data-rcut]').forEach(el => { if (el !== rg) el.value = +rg.value; }); draw(); };
      row.appendChild(l); row.appendChild(rg); c.body.appendChild(row);
      const ni = numRow(c.body, 'X (mm)', () => C('rumpfCutX'), v => { S('rumpfCutX', v); rg.value = v; draw(); }, { step: 1, norender: true }); ni.dataset.rcut = '1';
      const bb = document.createElement('div'); bb.style.display = 'flex'; bb.style.flexWrap = 'wrap'; bb.style.gap = '4px';
      bb.appendChild(mkMini(T('Zur gewählten Station'), () => { S('rumpfCutX', st[sel].x); rb(); }));
      c.body.appendChild(bb);
      subhead(c.body, T('Form der Station') + ' ' + (sel + 1) + ' · ' + st[sel].nodes.length + ' ' + T('Knoten'));
      const s0 = st[sel];
      selectRow(c.body, 'Form', [['', 'frei (Knoten und Tangenten ziehbar)'], ['lock', 'Form fixieren'], ['circle', 'Kreis']], () => s0.fix || '', v => { setFix(s0, v); rb(); },
        'Knoten (Kreise) und Tangentengriffe (grüne Quadrate) der roten Station im Bild ziehen. Strg+Ziehen ändert nur eine Tangentenseite (Ecke). „Form fixieren“ sperrt das Ziehen, Größe bleibt über Seiten-/Draufsicht änderbar. „Kreis“: Kreisquerschnitt, Breite und Dickenlinie folgen Ober-/Unterkante.');
      const fb = document.createElement('div'); fb.style.display = 'flex'; fb.style.flexWrap = 'wrap'; fb.style.gap = '4px';
      fb.appendChild(mkMini(T('+ Knoten'), () => { addNode(s0); rb(); })).title = T('Knoten im längsten Segment einfügen (Form bleibt). Auch: Doppelklick auf die Kurve.');
      fb.appendChild(mkMini(T('− Knoten'), () => { removeNode(s0, selNode); rb(); })).title = T('Gewählten Knoten (weißer Rand) entfernen. Auch: Entf-Taste.');
      fb.appendChild(mkMini(T('Tangenten glätten'), () => { smoothNodes(s0); normalizeShape(s0); rb(); })).title = T('Ein- und auslaufende Tangente jedes Knotens in eine Richtung bringen (knickfrei).');
      fb.appendChild(mkMini(T('Form zurücksetzen (Kreisbögen)'), () => { resetShape(s0); rb(); }));
      fb.appendChild(mkMini(T('Form auf alle nicht fixierten Stationen kopieren'), () => { if (!confirm(T('Form dieser Station auf alle nicht fixierten Stationen übertragen?'))) return; for (const o of st) { if (o === s0 || o.fix === 'lock' || o.fix === 'circle') continue; o.nodes = JSON.parse(JSON.stringify(s0.nodes)); } rb(); }));
      fb.appendChild(mkMini(T('Alle Stationen fixieren'), () => { for (const o of st) if (!o.fix) o.fix = 'lock'; rb(); }));
      fb.appendChild(mkMini(T('Alle Stationen lösen'), () => { for (const o of st) if (o.fix === 'lock') o.fix = ''; rb(); }));
      c.body.appendChild(fb);
      const bb2 = document.createElement('div'); bb2.style.display = 'flex'; bb2.style.flexWrap = 'wrap'; bb2.style.gap = '4px'; bb2.style.marginTop = '4px';
      bb2.appendChild(mkMini(T('Spant als DXF…'), exportSectionDxf));
      bb2.appendChild(mkMini(T('Alle Stationsspanten als DXF…'), exportAllSectionsDxf));
      c.body.appendChild(bb2);
      side.appendChild(c.g);
    }
    attachSidebar(side, rr, rb);
    const x = grp('Rumpf: Export', false, 'rumpf');
    selectRow(x.body, 'Achsen im STL', [['z', 'Z hoch (Druck / Fräse)'], ['y', 'Y hoch (wie im Programm)']], () => C('rumpfUp'), v => { S('rumpfUp', v); });
    const eb = document.createElement('div'); eb.style.display = 'flex'; eb.style.flexWrap = 'wrap'; eb.style.gap = '4px';
    eb.appendChild(mkMini(T('Rumpf als STL…'), exportStl));
    eb.appendChild(mkMini(T('Alle Stationsspanten als DXF…'), exportAllSectionsDxf));
    x.body.appendChild(eb);
    hint(x.body, 'STL: geschlossenes Netz beider Rumpfhälften, Nullpunkt in der Ecke. DXF: Spantkonturen (Z/Y) nebeneinander, z. B. für Spanten aus Sperrholz oder als Vorlage im CAD-Reiter.');
    side.appendChild(x.g);
  }

  Object.assign(App, { rumpfSidebar });
  window.Rumpf = { show, refresh, resize, draw, build, exportStl, exportSectionDxf, exportAllSectionsDxf, sectionAt,
    _dbg: () => ({ handles: handles(C('rumpfView')), xf: xf2, canvas, model, setCam: c => { Object.assign(cam, c); draw(); }, setImg: (kind, src) => new Promise(res => { const im = new Image(); im.onload = () => { img[kind] = im; if (!C(IMG_KEY[kind])) S(IMG_KEY[kind], { len: 100, x: 0, y: 0, flip: false }); buildSidebar(); draw(); res(true); }; im.src = src; }) }),
    _test: { bez2, solveT, splitBez, lineSegs, lineAt, polyOf, splitSeg, circleNodes, secParams, morphAt, meshFromGrid, resampleRing, halfAt, finT, TPL } };
})();
