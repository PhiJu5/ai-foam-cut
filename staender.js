/* staender.js — Reiter „Tragflächenständer“ (Menü Flugzeug, nach „Flugzeug gesamt“; id tfst, Feature „staender“).
 *
 *   Wenn die Tragflächenanschlüsse in den Rumpf gebohrt und geklebt werden, müssen die Tragflächen in der richtigen
 *   Höhe und unter dem richtigen Anstellwinkel liegen. Dieser Reiter baut dafür zwei Dinge als STL (3D-Druck) bzw.
 *   DXF (Laser / Fräse):
 *
 *   Stützen   : je eine flache Platte an der Stelle z (mm ab der Wurzel). Oberkante = Profilunterseite an dieser
 *               Stelle (Schnitt in Flugrichtung aus dem Tragflächendesign, mit Schränkung und V-Form), um den
 *               Anstellwinkel gedreht und auf Höhe gesetzt; das Spiel/Polster ist ein echter Abstand senkrecht zur
 *               Oberfläche (untere Hülle der Profilkontur mit einem Kreis vom Radius „Spiel“). Vorne und hinten je
 *               ein Haken für Gummiringe: Arm nach außen mit einer nach unten zeigenden Nase — der Ring liegt unter
 *               dem Arm, die Nase hält ihn fest, beide Stränge laufen neben der Platte nach oben über die Fläche.
 *               Optional eine Fußplatte mit Schlitz zum Einstecken (Platte flach druckbar, ohne Stützstruktur).
 *               Eine Stütze dient für beide Seiten (links und rechts je eine).
 *   Schablone : Bohrschablone für die Übergänge Tragfläche/Rumpf: zwei Platten mit der Wurzelrippe aus „Steghöhen“
 *               (originale Profilkontur, Ausnehmungen = Hülse und Bohrungen als Bohrführung), gleicher Anstellwinkel,
 *               unten über eine Grundplatte verbunden; lichter Abstand vorne (Nasenleiste) und hinten (Endleiste)
 *               frei, damit der Rumpf dazwischen passt. Bohrungen wahlweise in Richtung der Steckung (quer zum Rumpf,
 *               mit ihrer V-Form): die Platte ist dann um Bruchteile eines mm geschert, die Innenseite (am Rumpf)
 *               bleibt exakt. Ohne Steghöhen: Wurzelprofil ohne Ausnehmungen.
 *   Körper    : 2,5D — Grundriss aus Unter- und Oberkette (x-monoton, senkrechte Sprünge = gleiches x zweimal) minus
 *               Löcher; in Streifen zwischen allen Stützstellen zerlegt (Trapeze mit allen Punkten auf den senkrechten
 *               Kanten → keine T-Stöße), Wände aus den Randkanten → wasserdicht, Normalen außen. Kein earcut nötig.
 *   Lage      : Welt der Ansicht X = Flugrichtung nach hinten (Wurzel-Nasenleiste gedreht = 0), Y = oben (Tisch = 0),
 *               Z = quer (+Z = linke Fläche, von vorn gesehen rechts). Mehrere Tragflächen: die aktive.
 *   Daten     : state.cfg.formStand (Präfix form… → je Tragfläche, wings.js).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const TAB = 'tfst', KEY = 'formStand', D2R = Math.PI / 180;
  const DEF = {
    alpha: 0,               // Anstellwinkel der Wurzelsehne gegen den Tisch (°, + = Nase hoch)
    hRef: 'low',            // Höhe innen an der Wurzel: 'low' tiefster Punkt des Wurzelprofils | 'le' Nasenleiste der Wurzel (alt 'root' = 'le')
    h: 60,                  // Höhe über dem Tisch (mm) der Stützen bzw. bei 'root' der Wurzel-Nasenleiste
    stands: [{ z: 100 }],   // Stützen: Abstand ab Wurzel (mm)
    t: 10,                  // Plattendicke der Stützen (mm)
    pad: 0.5,               // Spiel / Polster zur Profilunterseite (mm, senkrecht zur Oberfläche)
    extF: 8, extR: 8,       // Überstand vor der Nasenleiste / hinter der Endleiste (mm)
    dropF: 0, dropR: 0,     // Auflage vorne/hinten tiefer als Nasenleiste/Endleiste (mm)
    hook: true,             // Haken für Gummiringe vorne und hinten
    hookY: 20,              // Oberkante des Arms über dem Tisch (mm)
    hookL: 14,              // Armlänge ab Stirnseite (mm)
    hookT: 5,               // Armdicke (mm)
    hookH: 4,               // Nase nach unten unter dem Arm (mm)
    hookW: 4,               // Breite der Nase (mm)
    stopR: false,           // Anschlag hinter der Endleiste (Fläche rutscht nicht nach hinten)
    stopH: 5,               // Anschlag: Höhe über der Endleiste (mm)
    stopW: 5,               // Anschlag: Stärke in Flugrichtung (mm)
    stopGap: 0.5,           // Anschlag: Abstand zur Endleiste (mm, mindestens das Spiel)
    foot: true,             // Fußplatte mit Schlitz
    footW: 60, footT: 5, footM: 10, footClr: 0.2,
    jig: true,              // Bohrschablone
    jt: 10,                 // Plattendicke der Schablone (mm)
    dF: 60, dR: 60,         // lichter Abstand der Platten an der Nasenleiste / an der Endleiste (mm) = Rumpfbreite
    dRAuto: true,           // Abstand hinten aus der Schräge der Wurzel (dF + 2·(Einrückung Endleiste − Einrückung Nase))
    rootInL: 0, rootInT: 0, // schräge Wurzel ohne „Steghöhen“: Einrückung Nase / Endleiste (mm); mit Steghöhen gelten dessen Werte
    jStk: 'outer',          // Ausschnitt der Steckung: 'outer' Hülse außen | 'inner' Steckung innen
    legA: 20, legB: 80,     // Steg unter dem Profil von … bis … % der Rippenlänge
    bT: 5, bOv: 10,         // Grundplatte: Dicke, Rand um die Platten (mm)
    bWin: false, bWinM: 15, // Fenster in der Grundplatte, Randbreite
    slotClr: 0.2,           // Spiel der Schlitze in Grundplatte (Einzelteile)
    jAxis: true,            // Bohrungen in Richtung der Steckung (Platte geschert)
    jClr: 0.1,              // Spiel der Bohrungen je Seite (mm)
    jOff: {},               // abgewählte Ausnehmungen { id: true }
    jOut: 'parts',          // STL der Schablone: 'parts' Einzelteile flach | 'one' zusammengebaut
    liteS: true,            // Erleichterungslöcher (Fachwerk) in den Stützen
    liteJ: true,            // … im Steg der Bohrschablone
    liteB: true,            // … in der Grundplatte der Bohrschablone (ersetzt das Fenster)
    liteE: 5,               // Stegbreite der Streben (mm) — alter gemeinsamer Wert, Vorgabe für die Werte je Teil
    liteSn: 0, liteJn: 0, liteBn: 0,   // Anzahl Streben je Teil: Stützen / Steg der Schablone / Grundplatte (0 = automatisch, etwa 55°)
    liteSe: null, liteJe: null, liteBe: null,   // Stegbreite der Streben je Teil (mm; leer = liteE)
    liteM: 6,               // voller Rand entlang der Kontur (mm)
    liteR: 3,               // Eckenradius der Löcher (mm)
    sel: 's0',              // Zeichnung unten links: 's<i>' Stütze | 'jig'
    view: null,             // Sichtbarkeit in 3D { wing, stands, jig } (Häkchen in der Ansicht)
    showInset: true
  };
  const ST = () => App.state;
  const clone = v => JSON.parse(JSON.stringify(v));
  function C() {
    const cfg = ST().cfg; let c = cfg[KEY];
    if (!c || typeof c !== 'object') c = cfg[KEY] = {};
    for (const k in DEF) if (!(k in c)) c[k] = DEF[k] && typeof DEF[k] === 'object' ? clone(DEF[k]) : DEF[k];
    if (!Array.isArray(c.stands)) c.stands = clone(DEF.stands);
    if (!c.jOff || typeof c.jOff !== 'object') c.jOff = {};
    ['liteSe', 'liteJe', 'liteBe'].forEach(k => { if (c[k] == null || c[k] === '') c[k] = num(c.liteE, 5); });   // Altstand: gemeinsame Stegbreite
    return c;
  }
  const num = (v, d) => { v = +v; return isFinite(v) ? v : d; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = v => String(Math.round(v * 10) / 10).replace('.', ',');
  const fmt2 = v => String(Math.round(v * 100) / 100).replace('.', ',');

  function params(c) {
    const p = {};
    p.alpha = clamp(num(c.alpha, 0), -30, 30);
    p.hRef = c.hRef === 'le' || c.hRef === 'root' ? 'le' : 'low';   // 'root' (alt) = Nasenleiste der Wurzel = 'le'
    p.h = clamp(num(c.h, 60), 0, 3000);
    p.stands = (c.stands || []).map(s => ({ z: Math.max(0, num(s && s.z, 100)) }));
    p.t = clamp(num(c.t, 10), 1, 300); p.pad = clamp(num(c.pad, 0.5), 0, 30);
    p.extF = clamp(num(c.extF, 8), 0, 500); p.extR = clamp(num(c.extR, 8), 0, 500);
    p.dropF = clamp(num(c.dropF, 0), 0, 500); p.dropR = clamp(num(c.dropR, 0), 0, 500);
    p.hook = !!c.hook;
    p.hookY = clamp(num(c.hookY, 20), 1, 1000); p.hookL = clamp(num(c.hookL, 14), 3, 200); p.hookT = clamp(num(c.hookT, 5), 0.5, 100);
    p.hookH = clamp(num(c.hookH, 4), 0, 100); p.hookW = clamp(num(c.hookW, 4), 1, Math.max(1, p.hookL - 2));
    p.stopR = !!c.stopR;
    p.stopH = clamp(num(c.stopH, 5), 0.5, 500); p.stopW = clamp(num(c.stopW, 5), 1, 200); p.stopGap = clamp(num(c.stopGap, 0.5), 0, 100);
    p.foot = !!c.foot;
    p.footW = clamp(num(c.footW, 60), 5, 2000); p.footT = clamp(num(c.footT, 5), 0.5, 200); p.footM = clamp(num(c.footM, 10), 2, 1000); p.footClr = clamp(num(c.footClr, 0.2), 0, 3);
    p.jig = !!c.jig;
    p.jt = clamp(num(c.jt, 10), 1, 300);
    p.dF = clamp(num(c.dF, 60), 0, 3000); p.dR = clamp(num(c.dR, 60), 0, 3000); p.dRAuto = c.dRAuto !== false;
    p.rootInL = Math.max(0, num(c.rootInL, 0)); p.rootInT = Math.max(0, num(c.rootInT, 0));
    p.jStk = c.jStk === 'inner' ? 'inner' : 'outer';
    p.legA = clamp(num(c.legA, 20), 0, 95); p.legB = clamp(num(c.legB, 80), p.legA + 5, 100);
    p.bT = clamp(num(c.bT, 5), 0.5, 200); p.slotClr = clamp(num(c.slotClr, 0.2), 0, 1);
    p.bOv = clamp(num(c.bOv, 10), p.slotClr + 1, 1000);
    p.bWin = !!c.bWin; p.bWinM = clamp(num(c.bWinM, 15), 3, 1000);
    p.jAxis = c.jAxis !== false; p.jClr = clamp(num(c.jClr, 0.1), -2, 5);
    p.jOff = c.jOff || {};
    p.liteS = c.liteS !== false; p.liteJ = c.liteJ !== false; p.liteB = c.liteB !== false;
    p.liteE = clamp(num(c.liteE, 5), 1.2, 100); p.liteM = clamp(num(c.liteM, 6), 1.2, 100); p.liteR = clamp(num(c.liteR, 3), 0, 30);
    // je Teil: Anzahl Streben (gerade; 0 = automatisch) und Stegbreite (ohne Angabe der alte gemeinsame Wert)
    [['S', 'liteSn', 'liteSe'], ['J', 'liteJn', 'liteJe'], ['B', 'liteBn', 'liteBe']].forEach(([k, kn, ke]) => {
      p['lite' + k + 'n'] = clamp(Math.round(num(c[kn], 0)), 0, 200);
      p['lite' + k + 'e'] = clamp(c[ke] == null || c[ke] === '' ? p.liteE : num(c[ke], p.liteE), 1.2, 100);
    });
    p.jOut = c.jOut === 'one' ? 'one' : 'parts';
    return p;
  }

  // =====================================================================================
  //  Tragfläche: Segmente in Gesamt-Koordinaten (wie stegh.js geo, aber ohne dessen Einstellungen)
  //  x = Grundriss ab Wurzel-Nase (nach hinten), y = Höhe im gemeinsamen Datum (mit V-Form), z = Spannweite
  // =====================================================================================
  function geo() {
    const W = App.wing; if (!W || !W.cuts || !W.cuts.length) return null;
    let z = 0, le = 0; const segs = [];
    W.cuts.forEach((cut, k) => {
      const sp = +cut.span || 0, sw = +(cut.tip && cut.tip.pl && cut.tip.pl.leOffset) || 0;
      segs.push({ k, cut, z0: z, z1: z + sp, le0: le, sw }); z += sp; le += sw;
    });
    if (!(z > 0)) return null;
    const G = { segs, L: z }, P0 = profSeg(segs[0], 0);
    let im = 0; P0.forEach((q, i) => { if (q[0] < P0[im][0]) im = i; });
    G.xLE0 = P0[im][0]; G.yLE0 = P0[im][1];
    return G;
  }
  function locate(G, z) {
    let s = G.segs[0];
    for (const q of G.segs) { s = q; if (z <= q.z1) break; }
    const d = s.z1 - s.z0;
    return { s, t: d > 0 ? clamp((z - s.z0) / d, 0, 1) : 0 };
  }
  // Profil eines Segments bei t (0 = Wurzel, 1 = außen): [[x, y], …] in echter Lage (Kopfüber-Schnitt aufgehoben)
  function profSeg(s, t) {
    const A = s.cut.root.pts, B = s.cut.tip.pts, n = Math.min(A.length, B.length), sgn = ST().cfg.flipY ? -1 : 1, P = [];
    for (let i = 0; i < n; i++) P.push([s.le0 + A[i].x + (B[i].x - A[i].x) * t, sgn * (A[i].y + (B[i].y - A[i].y) * t)]);
    return dedup(P);
  }
  const profAt = (G, z) => { const { s, t } = locate(G, z); return profSeg(s, t); };
  // Drehung um den Anstellwinkel (+ = Nase hoch, x nach hinten, y oben)
  const rotFn = deg => { const a = deg * D2R, c = Math.cos(a), s = Math.sin(a); return (x, y) => [x * c + y * s, -x * s + y * c]; };

  // =====================================================================================
  //  2D-Werkzeuge
  // =====================================================================================
  function dedup(P) {
    const o = [];
    P.forEach(p => { const l = o[o.length - 1]; if (!l || Math.abs(p[0] - l[0]) > 1e-9 || Math.abs(p[1] - l[1]) > 1e-9) o.push([p[0], p[1]]); });
    while (o.length > 1 && Math.abs(o[0][0] - o[o.length - 1][0]) <= 1e-9 && Math.abs(o[0][1] - o[o.length - 1][1]) <= 1e-9) o.pop();
    return o;
  }
  const area2 = L => { let s = 0; for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; s += a[0] * b[1] - b[0] * a[1]; } return s; };
  // Senkrechte Linie x durch ein geschlossenes Polygon: [tiefster, höchster] Schnittpunkt oder null
  function vcut(P, x) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0, n = P.length; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      if (a[0] === x) { if (a[1] < lo) lo = a[1]; if (a[1] > hi) hi = a[1]; }
      if ((a[0] - x) * (b[0] - x) < 0) { const y = a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); if (y < lo) lo = y; if (y > hi) hi = y; }
    }
    return lo <= hi ? [lo, hi] : null;
  }
  // Unter-/Oberkette (untere/obere Hülle) eines Polygons über allen Eckpunkt-x; beide beginnen und enden am selben x
  function envChains(P) {
    let xs = P.map(p => p[0]).sort((a, b) => a - b); xs = xs.filter((x, i) => !i || x - xs[i - 1] > 1e-9);
    const bot = [], top = [];
    xs.forEach(x => { const v = vcut(P, x); if (v) { bot.push([x, v[0]]); top.push([x, v[1]]); } });
    return { bot, top };
  }
  // Alle Werte einer Kette bei x: Eckpunkte mit genau diesem x (senkrechter Sprung = mehrere), sonst interpoliert
  function valsAt(C, x) {
    const n = C.length; if (!n || x < C[0][0] || x > C[n - 1][0]) return [];
    let k;
    if (x === C[0][0]) k = 0;
    else {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C[m][0] < x) lo = m; else hi = m; }
      k = hi;
      if (C[k][0] !== x) { const p = C[lo], q = C[hi]; return [p[1] + (q[1] - p[1]) * (x - p[0]) / (q[0] - p[0])]; }
    }
    const o = []; while (k < n && C[k][0] === x) o.push(C[k++][1]);
    return o;
  }
  const first = v => v[0], last = v => v[v.length - 1];
  // Gehrungs-Versatz einer konvexen Schleife (gegen den Uhrzeigersinn) um d nach außen
  function miter(L, d) {
    const n = L.length, out = [], nrm = (dx, dy) => { const l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; };
    for (let i = 0; i < n; i++) {
      const a = L[(i - 1 + n) % n], b = L[i], c = L[(i + 1) % n], n1 = nrm(b[0] - a[0], b[1] - a[1]), n2 = nrm(c[0] - b[0], c[1] - b[1]);
      const k = 1 + n1[0] * n2[0] + n1[1] * n2[1];
      out.push(k > 1e-6 ? [b[0] + d * (n1[0] + n2[0]) / k, b[1] + d * (n1[1] + n2[1]) / k] : [b[0] + d * n1[0], b[1] + d * n1[1]]);
    }
    return out;
  }
  // Untere Hülle von Polygon ⊕ Kreis(pad) an den Stellen xs (pad = 0: reine Unterkante)
  function lowEnv(P, pad, xs) {
    const D = [];
    if (pad > 0) {
      for (let i = 0, n = P.length; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n], m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.2));
        for (let k = 0; k < m; k++) D.push([a[0] + (b[0] - a[0]) * k / m, a[1] + (b[1] - a[1]) * k / m]);
      }
      D.sort((p, q) => p[0] - q[0]);
    }
    const p2 = pad * pad;
    return xs.map(x => {
      const v = vcut(P, x); let e = v ? v[0] - pad : Infinity;
      if (pad > 0) {
        let lo = 0, hi = D.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (D[m][0] < x - pad - 1e-9) lo = m + 1; else hi = m; }
        for (let j = lo; j < D.length && D[j][0] <= x + pad + 1e-9; j++) { const dx = D[j][0] - x; const y = D[j][1] - Math.sqrt(Math.max(0, p2 - dx * dx)); if (y < e) e = y; }
      }
      return e;
    });
  }

  // =====================================================================================
  //  2,5D-Körper: Grundriss (outer = { bot, top }, holes = [{ bot, top }]) × Dicke t, Fläche n = t um sh verschoben.
  //  Örtlich (x, y, n). Rückgabe { tris: [[p, q, r], …] (Normalen außen), tri2: Dreiecke des Grundrisses }.
  // =====================================================================================
  // Punkt (x, y) als Eckpunkt in eine Kette setzen (vorhandenen einfachen Punkt bei x ersetzen; Sprungstellen bleiben)
  function setVertex(Cn, x, y) {
    let k = 0; while (k < Cn.length && Cn[k][0] < x) k++;
    if (k < Cn.length && Cn[k][0] === x) { if (k + 1 < Cn.length && Cn[k + 1][0] === x) return; Cn[k] = [x, y]; }
    else Cn.splice(k, 0, [x, y]);
  }
  // Schnittpunkte zweier Ketten in beide als gemeinsamen Eckpunkt einfügen (Loch über den Rand → Ausschnitt am Rand)
  function crossInsert(A, B) {
    const lo = Math.max(A[0][0], B[0][0]), hi = Math.min(A[A.length - 1][0], B[B.length - 1][0]);
    if (!(hi > lo)) return;
    let xs = [lo, hi]; A.concat(B).forEach(p => { if (p[0] >= lo && p[0] <= hi) xs.push(p[0]); });
    xs.sort((a, b) => a - b); xs = xs.filter((x, i) => !i || x !== xs[i - 1]);
    const add = [];
    xs.forEach(x => { const va = valsAt(A, x), vb = valsAt(B, x); if (va.length === 1 && vb.length === 1 && va[0] !== vb[0] && Math.abs(va[0] - vb[0]) < 1e-7) add.push([x, va[0]]); });
    for (let i = 0; i + 1 < xs.length; i++) {
      const a = xs[i], b = xs[i + 1], dA = last(valsAt(A, a)) - last(valsAt(B, a)), dB = first(valsAt(A, b)) - first(valsAt(B, b));
      if (dA * dB < 0 && Math.abs(dA) > 1e-9 && Math.abs(dB) > 1e-9) { const xc = a + (b - a) * dA / (dA - dB); if (xc > a && xc < b) add.push([xc, valsAt(A, xc)[0]]); }
    }
    add.forEach(([x, y]) => { setVertex(A, x, y); setVertex(B, x, y); });
  }
  // Umrisse (Außenkontur gegen, Löcher im Uhrzeigersinn) aus den Randkanten der Grundriss-Dreiecke; gerade Zwischenpunkte entfernt
  function boundaryLoops(tri2) {
    const K = p => p[0] + ',' + p[1], E = new Map();
    tri2.forEach(T3 => { for (let k = 0; k < 3; k++) { const p = T3[k], q = T3[(k + 1) % 3]; E.set(K(p) + '|' + K(q), [p, q]); } });
    const out = new Map();
    E.forEach(([p, q]) => { if (E.has(K(q) + '|' + K(p))) return; const s = K(p); if (!out.has(s)) out.set(s, []); out.get(s).push([p, q]); });
    const used = new Set(), loops = [];
    out.forEach(list => list.forEach(e0 => {
      if (used.has(e0)) return;
      const L = []; let e = e0;
      while (e && !used.has(e)) { used.add(e); L.push(e[0]); e = (out.get(K(e[1])) || []).find(q => !used.has(q)); }
      let P = dedup(L), changed = true;
      while (changed && P.length > 3) {
        changed = false; const Q = [];
        for (let i = 0; i < P.length; i++) {
          const a = Q.length ? Q[Q.length - 1] : P[P.length - 1], b = P[i], c = P[(i + 1) % P.length];
          const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1], la = Math.hypot(ux, uy), lb = Math.hypot(vx, vy);
          if (la < 1e-9 || (Math.abs(ux * vy - uy * vx) <= 1e-9 * la * lb && ux * vx + uy * vy > 0)) { changed = true; continue; }
          Q.push(b);
        }
        P = Q;
      }
      if (P.length >= 3) loops.push(P);
    }));
    return loops;
  }
  function prism(outer, holes, t, sh) {
    holes = holes || [];
    if (holes.length) {   // Ketten kopieren und Schnittpunkte Rand/Loch einfügen
      const cp = Cn => Cn.map(q => [q[0], q[1]]);
      outer = { bot: cp(outer.bot), top: cp(outer.top) }; holes = holes.map(h => ({ bot: cp(h.bot), top: cp(h.top) }));
      holes.forEach(h => [h.bot, h.top].forEach(Hc => { crossInsert(outer.bot, Hc); crossInsert(outer.top, Hc); }));
    }
    const chains = [outer.bot, outer.top]; holes.forEach(h => chains.push(h.bot, h.top));
    let X = []; chains.forEach(Cn => Cn.forEach(p => X.push(p[0])));
    X.sort((a, b) => a - b); X = X.filter((x, i) => !i || x !== X[i - 1]);
    const spans = (Cn, a, b) => Cn[0][0] <= a && Cn[Cn.length - 1][0] >= b;
    const ysAt = x => {
      let Y = []; chains.forEach(Cn => { if (Cn[0][0] <= x && Cn[Cn.length - 1][0] >= x) Y.push(...valsAt(Cn, x)); });
      Y.sort((p, q) => p - q); return Y.filter((y, i) => !i || y !== Y[i - 1]);
    };
    const tri2 = [];
    let Ya = X.length ? ysAt(X[0]) : [];
    for (let i = 0; i + 1 < X.length; i++) {
      const a = X[i], b = X[i + 1], m = (a + b) / 2, Yb = ysAt(b);
      if (spans(outer.bot, a, b) && spans(outer.top, a, b)) {
        const mid = Cn => valsAt(Cn, m)[0];
        const H = holes.filter(h => spans(h.bot, a, b) && spans(h.top, a, b)).map(h => ({ h, lo: mid(h.bot), hi: mid(h.top) }))
          .filter(q => q.hi > q.lo).sort((p, q) => p.lo - q.lo);
        const ivs = []; let cur = outer.bot;
        H.forEach(q => { ivs.push([cur, q.h.bot]); cur = q.h.top; });
        ivs.push([cur, outer.top]);
        ivs.forEach(([lc, uc]) => {
          if (!(mid(uc) - mid(lc) > 1e-12)) return;
          const l0 = last(valsAt(lc, a)), l1 = last(valsAt(uc, a)), r0 = first(valsAt(lc, b)), r1 = first(valsAt(uc, b));
          const Lp = Ya.filter(y => y >= l0 && y <= l1).map(y => [a, y]), Rp = Yb.filter(y => y >= r0 && y <= r1).map(y => [b, y]);
          if (!Lp.length || !Rp.length) return;
          let pi = 0, qi = 0;
          const fl = k => (l1 > l0 ? (Lp[k][1] - l0) / (l1 - l0) : 0), fr = k => (r1 > r0 ? (Rp[k][1] - r0) / (r1 - r0) : 0);
          while (pi < Lp.length - 1 || qi < Rp.length - 1) {
            if (qi < Rp.length - 1 && (pi >= Lp.length - 1 || fr(qi + 1) <= fl(pi + 1))) { tri2.push([Lp[pi], Rp[qi], Rp[qi + 1]]); qi++; }
            else { tri2.push([Lp[pi], Rp[qi], Lp[pi + 1]]); pi++; }
          }
        });
      }
      Ya = Yb;
    }
    // Randkanten = gerichtete Kanten ohne Gegenkante (Material links) → Wände
    const K = p => p[0] + ',' + p[1], E = new Map();
    tri2.forEach(T3 => { for (let k = 0; k < 3; k++) { const p = T3[k], q = T3[(k + 1) % 3]; E.set(K(p) + '|' + K(q), [p, q]); } });
    // sh: [du, dy] = Fläche n = t verschoben (Schablone) oder { f0, f1 } = Punktabbildung je Fläche (Stütze folgt der Tragfläche)
    const out = [], f0 = sh && sh.f0 ? sh.f0 : null, f1 = sh && sh.f1 ? sh.f1 : null, du = Array.isArray(sh) ? sh[0] : 0, dy = Array.isArray(sh) ? sh[1] : 0;
    const A0 = f0 ? p => { const q = f0(p); return [q[0], q[1], 0]; } : p => [p[0], p[1], 0];
    const A1 = f1 ? p => { const q = f1(p); return [q[0], q[1], t]; } : p => [p[0] + du, p[1] + dy, t];
    tri2.forEach(([p, q, r]) => { out.push([A1(p), A1(q), A1(r)], [A0(p), A0(r), A0(q)]); });
    E.forEach(([p, q]) => { if (E.has(K(q) + '|' + K(p))) return; out.push([A0(p), A0(q), A1(q)], [A0(p), A1(q), A1(p)]); });
    return { tris: out, tri2 };
  }
  // Dreiecke abbilden; Spiegelung (det < 0) dreht den Umlauf um
  function mapTris(tris, f, flip) { return tris.map(([p, q, r]) => flip ? [f(p), f(r), f(q)] : [f(p), f(q), f(r)]); }
  function toFloat(tris) { const v = new Float32Array(tris.length * 9); let o = 0; tris.forEach(t3 => t3.forEach(p => { v[o++] = p[0]; v[o++] = p[1]; v[o++] = p[2]; })); return v; }
  // auf positive Koordinaten schieben (Druckbett)
  function toBed(tris) {
    const lo = [Infinity, Infinity, Infinity]; tris.forEach(t3 => t3.forEach(p => { for (let k = 0; k < 3; k++) if (p[k] < lo[k]) lo[k] = p[k]; }));
    return tris.map(t3 => t3.map(p => [p[0] - lo[0], p[1] - lo[1], p[2] - lo[2]]));
  }
  function checkMesh(tris) {   // offene Kanten zählen und Volumen (Test)
    const K = p => p.join(','), E = new Map(); let vol = 0;
    tris.forEach(([a, b, c]) => {
      [[a, b], [b, c], [c, a]].forEach(([p, q]) => { const k = K(p) + '|' + K(q); E.set(k, (E.get(k) || 0) + 1); });
      vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    });
    let open = 0, dup = 0;
    E.forEach((n, k) => { const [p, q] = k.split('|'); const r = E.get(q + '|' + p) || 0; if (r !== n) open++; if (n > 1) dup++; });
    return { open, dup, vol };
  }

  // =====================================================================================
  //  Stütze an der Stelle z
  // =====================================================================================
  // Höhenlage der Tragfläche, EIN Wert für alle Teile (Stützen, Schablone, Ansicht): Tischhöhe = R(x − xLE0, y − yLE0)[1] + sW.
  // Die Vorgabe gilt innen an der Wurzel (bei schräger bzw. eingerückter Wurzel an der Wurzelrippe = Platte der Schablone):
  // 'le' = Nasenleiste, 'low' = tiefster Punkt des Wurzelprofils. Die Stützen passen sich ihrer Lage in Spannweitenrichtung an
  // (V-Form, Schränkung), die Schablone deckt sich mit der Wurzel.
  function wingLift(G, p, src) {
    src = src || rootSource(G);
    const R = rotFn(p.alpha), Nw = R(src.xn - G.xLE0, src.yn - G.yLE0);   // Nase der Wurzelrippe gegenüber der Bezugsnase
    const lowRoot = Math.min(...src.loop.map(q => R(q[0] - src.un, q[1] - src.yn)[1]));   // tiefster Punkt unter der Nase
    const sW = p.hRef === 'low' ? p.h - Nw[1] - lowRoot : p.h - Nw[1];
    return { sW, src, leRoot: sW + Nw[1], lowRoot: sW + Nw[1] + lowRoot };
  }
  // Beide Seitenflächen einer Stütze folgen der Tragfläche an ihrer eigenen Spannweitenlage (z ∓ t/2): Pfeilung der Endleiste
  // (Anschlag), V-Form, Zuspitzung und Schränkung (Auflage). Ähnlichkeit Mitte → Seite S(x, y) = [a x − b y + tx, b x + a y + ty]
  // (kleinste Quadrate über die Profilpunkte, Endleiste exakt). Damit kein Dreieck des Streifennetzes umklappt, hängt die
  // Längsverschiebung NUR von x ab (senkrechte Linien bleiben senkrecht; y auf Höhe der Endleiste, Fehler auf der Auflage
  // ≈ b·Δy, unter 0,01 mm): Stirnseiten laufen parallel zu Nasen- bzw. Endleiste, der Schlitz der Fußplatte folgt (ux0/ux1).
  // Die Höhenverschiebung wird nach unten bis y0 (Boden bzw. Oberkante der Fußplatte) linear ausgeblendet → Boden bleibt eben.
  function faceMaps(G, p, z, sY, Ps, y0, yLow) {
    const R = rotFn(p.alpha), at = zz => profAt(G, clamp(zz, 0, G.L)).map(q => { const r = R(q[0] - G.xLE0, q[1] - G.yLE0); return [r[0], r[1] + sY]; });
    const n = Ps.length; let iT = 0; Ps.forEach((q, i) => { if (q[0] > Ps[iT][0]) iT = i; });
    const yT = Ps[iT][1];
    const sim = Q => {
      if (Q.length === n) {
        let cx = 0, cy = 0, dx = 0, dy = 0;
        for (let i = 0; i < n; i++) { cx += Ps[i][0]; cy += Ps[i][1]; dx += Q[i][0]; dy += Q[i][1]; }
        cx /= n; cy /= n; dx /= n; dy /= n;
        let sa = 0, sb = 0, ss = 0;
        for (let i = 0; i < n; i++) { const px = Ps[i][0] - cx, py = Ps[i][1] - cy, qx = Q[i][0] - dx, qy = Q[i][1] - dy; sa += px * qx + py * qy; sb += px * qy - py * qx; ss += px * px + py * py; }
        if (ss > 1e-9) {
          const a = sa / ss, b = sb / ss, T0 = [a * Ps[iT][0] - b * Ps[iT][1], b * Ps[iT][0] + a * Ps[iT][1]];
          const S = { a, b, tx: Q[iT][0] - T0[0], ty: Q[iT][1] - T0[1] };   // Endleiste exakt
          let e = 0; for (let i = 0; i < n; i++) { const q = Ps[i]; e = Math.max(e, Math.hypot(a * q[0] - b * q[1] + S.tx - Q[i][0], b * q[0] + a * q[1] + S.ty - Q[i][1])); }
          if (e < 1 && a > 0.5) return S;
        }
      }
      // Rückfall (anderes Profil bzw. andere Punktzahl jenseits eines Stoßes): nur verschieben, Endleiste auf Endleiste
      let jT = 0; Q.forEach((q, i) => { if (q[0] > Q[jT][0]) jT = i; });
      return { a: 1, b: 0, tx: Q[jT][0] - Ps[iT][0], ty: Q[jT][1] - Ps[iT][1] };
    };
    const A = sim(at(z - p.t / 2)), B = sim(at(z + p.t / 2));
    const ux = S => x => (S.a - 1) * x - S.b * yT + S.tx, uy = S => (x, y) => S.b * x + (S.a - 1) * y + S.ty;
    // Ausblendhöhe: oberhalb y1 volle Höhenverschiebung; Rampe steiler als die Verschiebung selbst wäre nicht mehr monoton
    let D = 0; [A, B].forEach(S => { const f = uy(S); Ps.forEach(q => { D = Math.max(D, Math.abs(f(q[0], q[1])), Math.abs(f(q[0], y0))); }); });
    const y1 = Math.max(yLow, y0 + 2 * D + 1), w = y => y <= y0 ? 0 : y >= y1 ? 1 : (y - y0) / (y1 - y0);
    const mk = S => { const fx = ux(S), fy = uy(S); return q => [q[0] + fx(q[0]), q[1] + w(q[1]) * fy(q[0], q[1])]; };
    return { f0: mk(A), f1: mk(B), ux0: ux(A), ux1: ux(B), dTE: [B.tx + (B.a - 1) * Ps[iT][0] - B.b * yT - (A.tx + (A.a - 1) * Ps[iT][0] - A.b * yT), uy(B)(Ps[iT][0], yT) - uy(A)(Ps[iT][0], yT)] };
  }
  function standGeo(G, p, i, sW) {
    const s = p.stands[i], warn = [], z = Math.min(s.z, G.L), nm = T('Stütze') + ' ' + (i + 1);
    if (s.z > G.L + 1e-6) warn.push(nm + ': ' + T('liegt außerhalb der Tragfläche – an die Spitze gesetzt.'));
    const P0 = profAt(G, z), R = rotFn(p.alpha), P = P0.map(q => R(q[0] - G.xLE0, q[1] - G.yLE0));
    const sY = sW != null ? sW : wingLift(G, p).sW;
    const Ps = P.map(q => [q[0], q[1] + sY]);
    let xmin = Infinity, xmax = -Infinity; Ps.forEach(q => { if (q[0] < xmin) xmin = q[0]; if (q[0] > xmax) xmax = q[0]; });
    const pad = p.pad, xa = xmin - pad, xb = xmax + pad;
    let xs = [];
    const N = Math.max(60, Math.ceil((xb - xa) / 0.5));
    for (let k = 0; k <= N; k++) xs.push(xa + (xb - xa) * k / N);
    Ps.forEach(q => xs.push(q[0]));
    if (pad > 0) for (let k = 1; k < 16; k++) { const d = pad * (1 - Math.cos(Math.PI / 2 * k / 16)); xs.push(xa + d, xb - d); }
    xs = xs.filter(x => x >= xa && x <= xb).sort((a, b) => a - b); xs = xs.filter((x, k) => !k || x - xs[k - 1] > 1e-6);
    const Ep = lowEnv(Ps, pad, xs);
    let kL = 0; Ep.forEach((e, k) => { if (e < Ep[kL]) kL = k; });
    const yLow = Ep[kL];
    if (!(yLow > 0.5)) return { ok: false, i, z, warn: warn.concat([nm + ': ' + T('zu niedrig – die Profilunterseite liegt nicht über dem Tisch. Höhe vergrößern.')]) };
    const capF = Math.max(yLow, Ep[0] - p.dropF), capR = Math.max(yLow, Ep[Ep.length - 1] - p.dropR);
    // Auflage: Hülle, vorne bis capF, hinten bis capR gekappt (Schnittpunkte ergänzt)
    const cr = [];
    for (let k = 0; k < xs.length; k++) {
      const cap = k <= kL ? capF : capR;
      if (k > 0 && (k - 1 <= kL ? capF : capR) === cap) {
        const e0 = Ep[k - 1] - cap, e1 = Ep[k] - cap;
        if (e0 * e1 < 0) cr.push([xs[k - 1] + (xs[k] - xs[k - 1]) * e0 / (e0 - e1), cap]);
      }
      cr.push([xs[k], Math.min(Ep[k], cap)]);
    }
    const xF = xa - p.extF;
    let xR = xb + p.extR, stop = null;
    // Anschlag hinter der Endleiste: Klotz von der Auflage bis stopH über die Endleiste, Abstand mindestens das Spiel
    if (p.stopR) {
      const xs0 = xmax + Math.max(p.stopGap, pad), xs1 = xs0 + p.stopW, yS = Ep[Ep.length - 1] + p.stopH;
      xR = Math.max(xR, xs1); stop = { xs0, xs1, yS };
    }
    const hookFit = (cap, side) => {
      if (!p.hook) return null;
      const yT = Math.min(p.hookY, cap), yA = yT - p.hookT;
      if (yA < 1) { warn.push(nm + ': ' + T(side === 'F' ? 'Haken vorne' : 'Haken hinten') + ' ' + T('passt nicht unter die Auflage (Arm zu dick oder Stütze zu niedrig).')); return null; }
      if (p.hookY > cap + 1e-9) warn.push(nm + ': ' + T(side === 'F' ? 'Haken vorne' : 'Haken hinten') + ' ' + T('auf die Höhe der Auflage gesenkt:') + ' ' + fmt(yT) + ' mm');
      const H = Math.min(p.hookH, yA), floor = p.foot ? p.footT : 0;
      if (yA - H < floor + 2) warn.push(nm + ': ' + T('Unter der Hakennase bleiben nur') + ' ' + fmt(yA - H - floor) + ' mm ' + T('zum Einhängen des Gummis.'));
      return { yT, yA, H, L: p.hookL, W: Math.min(p.hookW, p.hookL - 2) };
    };
    const hF = hookFit(capF, 'F'), hR = hookFit(capR, 'R');
    const bot = [], top = [];
    if (hF) { bot.push([xF - hF.L, hF.yA - hF.H], [xF - hF.L + hF.W, hF.yA - hF.H], [xF - hF.L + hF.W, hF.yA], [xF, hF.yA]); top.push([xF - hF.L, hF.yT], [xF, hF.yT]); }
    bot.push([xF, 0], [xR, 0]);
    top.push([xF, capF]); cr.forEach(q => top.push(q));
    if (stop) {
      if (stop.xs0 > xb) top.push([stop.xs0, capR]);
      top.push([stop.xs0, stop.yS], [stop.xs1, stop.yS]);
      if (stop.xs1 < xR) top.push([stop.xs1, capR], [xR, capR]);
    } else top.push([xR, capR]);
    if (hR) { bot.push([xR, hR.yA], [xR + hR.L - hR.W, hR.yA], [xR + hR.L - hR.W, hR.yA - hR.H], [xR + hR.L, hR.yA - hR.H]); top.push([xR, hR.yT], [xR + hR.L, hR.yT]); }
    const outer = { bot: dedupChain(bot), top: dedupChain(top) };
    // Erleichterungslöcher: Fachwerk zwischen Boden (über dem Schlitz der Fußplatte) und Auflage, Rand an Enden und Kontur
    let lite = [];
    if (p.liteS) {
      // nur innerhalb der Platte messen: an der Stirnseite springt die Kontur auf die Oberkante des Hakenarms
      const M = p.liteM, topY = x => { const v = valsAt(outer.top, clamp(x, xF + 1e-6, xR - 1e-6)); return v.length ? Math.min(...v) : Infinity; };
      lite = liteHoles(xF + M, xR - M, (p.foot ? p.footT : 0) + M, rimBelow(topY, M), { e: p.liteSe, n: p.liteSn, r: p.liteR, up: false });
      if (p.liteSn > 0 && !lite.length) warn.push(nm + ': ' + T('Bei dieser Zahl der Streben bleibt kein Platz für Erleichterungslöcher – weniger Streben oder schmalere Stegbreite wählen.'));
    }
    // Seitenflächen folgen der Tragfläche über die Plattendicke (Anschlag parallel zur gepfeilten Endleiste, Auflage mit V-Form)
    const yB = p.foot ? p.footT : 0, fm = faceMaps(G, p, z, sY, Ps, yB, yLow);
    const mesh = prism(outer, lite.map(h => h.chains), p.t, fm);
    let foot = null;
    if (p.foot) {
      // Schlitz folgt den Stirnseiten der Stütze (parallel zu Nasen- bzw. Endleiste): Versatz linear über die Dicke (n = −t/2 … +t/2)
      const hw = p.t / 2 + p.footClr, uAt = (x, zq) => fm.ux0(x) + (fm.ux1(x) - fm.ux0(x)) * (zq + p.t / 2) / p.t;
      const sl = [[xF - p.footClr + uAt(xF, -hw), -hw], [xR + p.footClr + uAt(xR, -hw), -hw], [xR + p.footClr + uAt(xR, hw), hw], [xF - p.footClr + uAt(xF, hw), hw]];
      const W = Math.max(p.footW, p.t + 2 * p.footClr + 4), x0 = Math.min(xF - p.footM, sl[0][0] - 2, sl[3][0] - 2), x1 = Math.max(xR + p.footM, sl[1][0] + 2, sl[2][0] + 2);
      const fo = { bot: [[x0, -W / 2], [x1, -W / 2]], top: [[x0, W / 2], [x1, W / 2]] }, fh = envChains(sl);
      foot = { outer: fo, holes: [fh], mesh: prism(fo, [fh], p.footT), W, x0, x1 };
    }
    let hMax = 0; outer.top.forEach(q => { if (q[1] > hMax) hMax = q[1]; });
    const x0 = outer.bot[0][0], x1 = outer.bot[outer.bot.length - 1][0];
    const areaOut = Math.abs(area2(dedup(outer.bot.concat(outer.top.slice().reverse())))) / 2, liteA = lite.reduce((s, h) => s + h.area, 0);
    return { ok: true, i, z, sY, Ps, outer, mesh, foot, lite, litePct: areaOut > 0 ? 100 * liteA / areaOut : 0, xF, xR, xa, xb, yLow, xLow: xs[kL], capF, capR, hF, hR, stop, dTE: fm.dTE, len: x1 - x0, x0, x1, hMax, warn };
  }
  // aufeinanderfolgende gleiche Punkte einer Kette entfernen
  function dedupChain(Cn) { const o = []; Cn.forEach(p => { const l = o[o.length - 1]; if (!l || l[0] !== p[0] || l[1] !== p[1]) o.push(p); }); return o; }

  // =====================================================================================
  //  Erleichterungslöcher (Fachwerk)
  // =====================================================================================
  // Konvexes Polygon an der Halbebene a·x + b·y ≤ c abschneiden (Sutherland–Hodgman)
  function clipHalf(P, a, b, c) {
    const out = [], n = P.length, f = q => a * q[0] + b * q[1] - c;
    for (let i = 0; i < n; i++) {
      const p = P[i], q = P[(i + 1) % n], fp = f(p), fq = f(q);
      if (fp <= 0) out.push(p);
      if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    return out;
  }
  // Ecken eines konvexen Polygons (gegen den Uhrzeigersinn) mit Radius r runden, je Ecke höchstens bis zur halben Kante
  function roundConvex(P, r) {
    if (!(r > 0) || P.length < 3) return P;
    const n = P.length, out = [];
    for (let i = 0; i < n; i++) {
      const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n];
      const u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]], lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
      if (lu < 1e-9 || lv < 1e-9) { out.push(b); continue; }
      const A = Math.acos(clamp((u[0] * v[0] + u[1] * v[1]) / lu / lv, -1, 1));   // Innenwinkel
      if (A > Math.PI - 1e-3) { out.push(b); continue; }
      const tn = Math.tan(A / 2), d = Math.min(r / tn, 0.5 * lu, 0.5 * lv), rr = d * tn;
      const p1 = [b[0] + u[0] / lu * d, b[1] + u[1] / lu * d], p2 = [b[0] + v[0] / lv * d, b[1] + v[1] / lv * d];
      const bx = u[0] / lu + v[0] / lv, by = u[1] / lu + v[1] / lv, lb = Math.hypot(bx, by) || 1, dc = rr / Math.sin(A / 2);
      const C0 = [b[0] + bx / lb * dc, b[1] + by / lb * dc];
      const a1 = Math.atan2(p1[1] - C0[1], p1[0] - C0[0]); let da = Math.atan2(p2[1] - C0[1], p2[0] - C0[0]) - a1;
      while (da <= -Math.PI) da += 2 * Math.PI; while (da > Math.PI) da -= 2 * Math.PI;
      const m = Math.max(2, Math.ceil(Math.abs(da) / (Math.PI / 2) * 6));
      for (let k = 0; k <= m; k++) { const g = a1 + da * k / m; out.push([C0[0] + rr * Math.cos(g), C0[1] + rr * Math.sin(g)]); }
    }
    return dedup(out);
  }
  // Fachwerk (Warren) zwischen Untergurt y = yB und Obergurt y = yT(x) (Innenkanten, Rand schon abgezogen), x0 … x1:
  // Streben von den Untergurt- zu den Obergurtknoten (etwa 55°), Stegbreite e, Ecken mit Radius r. Die Löcher sind die
  // Felder zwischen den Streben; oben begrenzt eine Gerade unter dem Obergurt. o.up = stehend gedruckt → jede Decke wird
  // ein 45°-Dach (ohne Stützstruktur druckbar). Ergebnis: [{ loop, chains, area }]
  const LITE_ANG = 55;
  function liteHoles(x0, x1, yB, yT, o) {
    const e = o.e, r = o.r, out = [];
    if (!(x1 - x0 > 2 * e + 2 * r + 4)) return out;
    const hs = []; for (let k = 0; k <= 20; k++) hs.push(yT(x0 + (x1 - x0) * k / 20) - yB);
    hs.sort((a, b) => a - b); const H = hs[10];
    if (!(H > e + 2 * r + 4)) return out;
    // Anzahl Felder: vorgegeben über die Zahl der Streben (o.n, je Feld zwei) oder automatisch, Streben etwa LITE_ANG geneigt
    const n = o.n > 0 ? Math.max(1, Math.ceil(o.n / 2)) : Math.max(1, Math.round((x1 - x0) / (2 * H / Math.tan(LITE_ANG * D2R)))), w = (x1 - x0) / n;
    out.struts = 2 * n;
    const Bn = k => [x0 + k * w, yB], Tn = k => { const x = x0 + (k + 0.5) * w; return [x, Math.max(yB, yT(x))]; };
    const D = []; for (let k = 0; k < n; k++) { D.push([Bn(k), Tn(k)]); D.push([Tn(k), Bn(k + 1)]); }
    // Halbebene neben der Strebe p→q (links = oberhalb, rechts = unterhalb) mit Abstand e/2 zur Mittellinie
    const half = (L, left) => {
      const p = L[0], q = L[1], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, nx = (q[1] - p[1]) / l, ny = -(q[0] - p[0]) / l, s = left ? 1 : -1;
      return [s * nx, s * ny, s * (nx * p[0] + ny * p[1]) - e / 2];
    };
    let yTop = yB; for (let k = 0; k <= 40; k++) yTop = Math.max(yTop, yT(x0 + (x1 - x0) * k / 40));
    const minA = Math.max(20, 2 * (e + 2 * r) * (e + 2 * r));
    for (let j = 0; j <= 2 * n; j++) {
      const left = j % 2 === 0;   // gerade: Feld über den Streben (Dreieck nach unten), ungerade: darunter (nach oben)
      let P = [[x0, yB], [x1, yB], [x1, yTop + 1], [x0, yTop + 1]];
      if (j > 0) P = clipHalf(P, ...half(D[j - 1], left));
      if (j < 2 * n && P.length > 2) P = clipHalf(P, ...half(D[j], left));
      // oben: Gerade durch die Enden des Felds, so weit gesenkt, dass sie überall unter dem Obergurt liegt (zweimal angepasst)
      for (let it = 0; it < 2 && P.length > 2; it++) {
        const xa = Math.min(...P.map(q => q[0])), xb = Math.max(...P.map(q => q[0])); if (!(xb - xa > 1e-6)) { P = []; break; }
        const ya = yT(xa), yb = yT(xb), sl = (yb - ya) / (xb - xa); let dn = 0;
        for (let k = 0; k <= 24; k++) { const x = xa + (xb - xa) * k / 24; dn = Math.max(dn, ya + sl * (x - xa) - yT(x)); }
        P = clipHalf(P, -sl, 1, ya - sl * xa - dn);
      }
      if (P.length < 3) continue;
      if (area2(P) < 0) P = P.reverse();
      if (o.up) {   // stehend gedruckt: Decke als 45°-Dach, Scheitel dort, wo das Loch am größten bleibt
        const xa = Math.min(...P.map(q => q[0])), xb = Math.max(...P.map(q => q[0])); let best = null;
        for (let k = 0; k <= 10; k++) {
          const xc = xa + (xb - xa) * k / 10, v = vcut(P, xc); if (!v) continue;
          let Q = clipHalf(P, 1, 1, v[1] + xc); if (Q.length > 2) Q = clipHalf(Q, -1, 1, v[1] - xc);
          const A = Q.length > 2 ? Math.abs(area2(Q)) / 2 : 0; if (!best || A > best.A) best = { Q, A };
        }
        if (!best || best.Q.length < 3) continue;
        P = best.Q;
      }
      const A0 = Math.abs(area2(P)) / 2;
      const bw = Math.max(...P.map(q => q[0])) - Math.min(...P.map(q => q[0])), bh = Math.max(...P.map(q => q[1])) - Math.min(...P.map(q => q[1]));
      if (A0 < minA || bw < 2 * r + 3 || bh < 2 * r + 3) continue;
      const L = roundConvex(dedup(P), r);
      if (L.length < 3) continue;
      out.push({ loop: L, chains: envChains(L), area: Math.abs(area2(L)) / 2 });
    }
    return out;
  }
  // Obergurt-Innenkante: tiefster Wert von f in ±m um x, um m gesenkt (Rand auch an schrägen Stellen)
  const rimBelow = (f, m) => x => { let y = Infinity; for (let k = -4; k <= 4; k++) y = Math.min(y, f(x + k * m / 4)); return y - m; };

  // =====================================================================================
  //  Bohrschablone
  // =====================================================================================
  // Schräge Wurzel: mit „Steghöhen“ gelten dessen Einrückungen (gemeinsame Werte → Wurzelrippe und Schablone deckungsgleich),
  // ohne Steghöhen eigene Werte in formStand. skewSrc() = Objekt, aus dem gelesen wird (null = gerade).
  const stegOn = () => !!(App.StegApi && App.StegApi.cfg && App.StegWurzel && App.StegWurzel.data);
  function skewSrc() { const cfg = ST().cfg; return stegOn() ? (cfg.stegH && typeof cfg.stegH === 'object' ? cfg.stegH : null) : C(); }
  function skewTarget() { return stegOn() ? App.StegApi.cfg() : C(); }   // legt bei Bedarf cfg.stegH an (nur bei Eingabe)
  const leAt = (G, z) => Math.min(...profAt(G, z).map(q => q[0]));
  const teAt = (G, z) => Math.max(...profAt(G, z).map(q => q[0]));
  // Ebene der Wurzel im Grundriss: Gerade durch die Nase bei zL und die Endleiste bei zT; z(x) = zL − (x − xL)·k
  function skewPlane(G, iL, iT) {
    iL = clamp(+iL || 0, 0, G.L); iT = clamp(+iT || 0, 0, G.L);
    const xL = leAt(G, iL), xT = teAt(G, iT), k = xT - xL > 1e-6 ? (iL - iT) / (xT - xL) : 0;
    return { xL, zL: iL, xT, zT: iT, k, a: Math.atan(k) / D2R, z: x => clamp(iL - (x - xL) * k, 0, G.L) };
  }
  // Winkel eingeben wie in Steghöhen: + = Endleiste bleibt, Nase rückt weiter nach außen; − = Nase bleibt, Endleiste rückt nach außen
  function setSkewAngle(G, c, a) {
    const k = Math.tan(clamp(+a || 0, -45, 45) * D2R), dL = clamp(+c.rootInL || 0, 0, G.L), dT = clamp(+c.rootInT || 0, 0, G.L);
    const solve = (f, lo, hi) => { if (f(lo) >= 0) return lo; if (f(hi) <= 0) return hi; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; } return (lo + hi) / 2; };
    const r3 = v => Math.round(v * 1000) / 1000;
    if (k >= 0) c.rootInL = r3(solve(d => d - dT - k * (teAt(G, dT) - leAt(G, d)), dT, G.L));
    else c.rootInT = r3(solve(d => d - dL + k * (teAt(G, d) - leAt(G, dL)), dL, G.L));
  }
  // Quelle der Wurzel: Wurzelrippe aus „Steghöhen“ (wahre Form in ihrer Ebene, u ab Nase) mit Ausnehmungen; sonst Schnitt
  // durch die Tragfläche in der (ggf. schrägen) Wurzelebene ohne Ausnehmungen
  function rootSource(G) {
    const S = App.StegApi, W = App.StegWurzel, cfg = ST().cfg;
    if (stegOn() && cfg.stegH && typeof cfg.stegH === 'object') {
      try {
        const SG = S.geo(), sc = S.cfg(), R = SG ? W.data(SG, sc) : null;
        const pr = R && R.parts && R.parts.find(q => q.k === 'prof');
        if (pr && pr.uloops && pr.uloops[0] && pr.uloops[0].length > 3) {
          const E = S.rootEnds(SG, sc), K = (S.stkAll && S.stkAll(SG, sc)) || [], RP = S.rootPlane ? S.rootPlane(SG, sc) : null;
          const cuts = (R.cuts || []).map(q => {
            let dir = [0, 0, 1], wall = 0;
            const huel = q.id.indexOf('huel:') === 0;
            if (huel) {
              const Kk = K[parseInt(q.id.split(':')[1], 10)];
              if (Kk && Kk.cx) { const dz = Kk.len - Kk.z0; dir = [dz > 1e-6 ? (Kk.cx(Kk.len) - Kk.cx(Kk.z0)) / dz : 0, Kk.tan || 0, 1]; wall = Math.max(0, +Kk.wall || 0); }
            }
            return { id: q.id, name: q.name, loop: dedup(q.top.concat(q.bot.slice().reverse())), dir, huel, wall, round: !!q.round, d: q.d };
          }).filter(q => q.loop.length > 2);
          const lp = pr.uloops[0]; let im = 0; lp.forEach((q, k) => { if (q[0] < lp[im][0]) im = k; });
          const plane = RP ? { xL: RP.xL, zL: RP.zL, k: RP.k } : { xL: E.xL, zL: 0, k: 0 };
          return { from: 'stegh', loop: dedup(lp), cuts, xn: R.xOfU ? R.xOfU(lp[im][0]) : E.xL, un: lp[im][0], yn: lp[im][1], zL: E.zL || 0, zT: E.zT || 0, skew: R.angle || 0, plane };
        }
      } catch (e) { console.warn('Tragflächenständer: Wurzelrippe aus Steghöhen nicht lesbar:', e); }
    }
    const sk = skewSrc(), iL = sk ? +sk.rootInL || 0 : 0, iT = sk ? +sk.rootInT || 0 : 0;
    if (iL < 1e-6 && iT < 1e-6) {
      const P0 = profSeg(G.segs[0], 0);
      return { from: 'wing', loop: P0.map(q => [q[0] - G.xLE0, q[1]]), cuts: [], xn: G.xLE0, un: 0, yn: G.yLE0, zL: 0, zT: 0, skew: 0, plane: { xL: G.xLE0, zL: 0, k: 0 } };
    }
    // schräger Schnitt: senkrecht durch die Tragfläche entlang der Wurzelebene, u = wahre Länge ab Nase
    const PL = skewPlane(G, iL, iT), cs = 1 / Math.sqrt(1 + PL.k * PL.k), up = [], dn = [], N = 160;
    for (let i = 0; i <= N; i++) {
      const x = PL.xL + (PL.xT - PL.xL) * (1e-4 + (1 - 2e-4) * (1 - Math.cos(Math.PI * i / N)) / 2), v = vcut(profAt(G, PL.z(x)), x);
      if (v) { const u = (x - PL.xL) / cs; up.push([u, v[1]]); dn.push([u, v[0]]); }
    }
    const loop = dedup(up.concat(dn.reverse()));
    let im = 0; loop.forEach((q, k) => { if (q[0] < loop[im][0]) im = k; });
    return { from: 'wing', loop, cuts: [], xn: PL.xL, un: loop[im][0], yn: loop[im][1], zL: PL.zL, zT: PL.zT, skew: PL.a, plane: { xL: PL.xL, zL: PL.zL, k: PL.k } };
  }
  function jigGeo(G, p, sW, src0) {
    const src = src0 || rootSource(G), warn = [], R = rotFn(p.alpha);
    const rot = q => R(q[0] - src.un, q[1] - src.yn);
    const PL0 = src.loop.map(rot);
    // Höhe aus der Lage der Tragfläche: die Platte deckt sich mit der Wurzel der Fläche auf den Stützen
    const sY = (sW != null ? sW : wingLift(G, p, src).sW) + R(src.xn - G.xLE0, src.yn - G.yLE0)[1];
    const PL = PL0.map(q => [q[0], q[1] + sY]), env = envChains(PL);
    if (env.bot.length < 3) return { ok: false, src, warn: [T('Kein Wurzelprofil vorhanden.')] };
    const umin = env.bot[0][0], umax = env.bot[env.bot.length - 1][0], ulen = umax - umin;
    // Plattenwinkel im Grundriss aus dem lichten Abstand vorne/hinten; hinten automatisch aus der Schräge der Wurzel
    let dR = p.dRAuto ? p.dF + 2 * (src.zT - src.zL) : p.dR;
    if (dR < 0) { warn.push(T('Abstand hinten wäre negativ – Abstand vorne vergrößern oder Schräge verringern.')); dR = 0; }
    const sphi = clamp((dR - p.dF) / 2 / ulen, -0.7, 0.7), cphi = Math.sqrt(1 - sphi * sphi), phi = Math.asin(sphi);
    // Bohrrichtung: rechtwinklig zur Flugrichtung (quer zum Rumpf), mit der Neigung der ersten gewählten Hülse (V-Form);
    // die Ausnehmungen liegen an der Innenseite genau wie in der Wurzelrippe
    const enabled = src.cuts.filter(q => !p.jOff[q.id]), main = enabled.find(q => q.huel) || null, d = main ? [0, main.dir[1], 1] : [0, 0, 1];
    if (p.jAxis && main && Math.abs(main.dir[0]) > 0.0087) warn.push(T('Die Steckung läuft im Grundriss nicht rechtwinklig zur Flugrichtung; die Schablone bohrt rechtwinklig zur Flugrichtung.'));
    const dr = R(d[0], d[1]), dn = -dr[0] * sphi + d[2] * cphi, duu = dr[0] * cphi + d[2] * sphi;
    const axis = p.jAxis && enabled.length > 0 && dn > 0.2;   // ohne Bohrungen keine Scherung
    const su = axis ? duu / dn : 0, sy = axis ? dr[1] / dn : 0;
    const t = p.jt, shU = t * su, shY = t * sy, y0 = Math.max(0, -shY);
    // Platte: Profil + Steg bis zum Tisch zwischen uA und uB
    const uA = p.legA <= 0 ? umin : umin + ulen * p.legA / 100, uB = p.legB >= 100 ? umax : umin + ulen * p.legB / 100, bot = [];
    env.bot.forEach(q => { if (q[0] < uA - 1e-9) bot.push(q); });
    if (uA > umin + 1e-9) bot.push([uA, first(valsAt(env.bot, uA))]);
    bot.push([uA, y0], [uB, y0]);
    if (uB < umax - 1e-9) bot.push([uB, last(valsAt(env.bot, uB))]);
    env.bot.forEach(q => { if (q[0] > uB + 1e-9) bot.push(q); });
    const outer = { bot: dedupChain(bot), top: env.top };
    let legMin = Infinity; env.bot.forEach(q => { if (q[0] >= uA && q[0] <= uB && q[1] < legMin) legMin = q[1]; });
    legMin = Math.min(legMin, first(valsAt(env.bot, uA)), last(valsAt(env.bot, uB)));
    if (!(legMin > y0 + p.bT + 1)) warn.push(T('Schablone zu niedrig: Das Profil liegt nicht über der Grundplatte. Höhe vergrößern.'));
    // Ausnehmungen als Löcher (Spiel je Seite). Ragt eine über die Profilkontur, wird sie zum Ausschnitt am Rand;
    // ganz außerhalb oder mit Überschneidung entfällt sie. Steckung wahlweise in Hülsen- oder Steckungsgröße.
    const holes = [], used = [];
    enabled.forEach(q => {
      const inner = q.huel && p.jStk === 'inner' && q.wall > 0, nm = inner ? q.name.replace(T('Hülse'), T('Steckung')) : q.name;
      let L = q.loop.map(rot).map(r => [r[0], r[1] + sY]);
      if (area2(L) < 0) L = L.reverse();
      const off = p.jClr - (inner ? q.wall : 0);
      if (Math.abs(off) > 1e-9) L = miter(L, off);
      const h = envChains(L); if (h.bot.length < 2) return;
      const isIn = r => { const b = valsAt(outer.bot, r[0]), tp = valsAt(outer.top, r[0]); return b.length && tp.length && r[1] > Math.max(...b) && r[1] < Math.min(...tp); };
      const nIn = L.filter(isIn).length;
      const bb = [h.bot[0][0], Math.min(...L.map(r => r[1])), h.bot[h.bot.length - 1][0], Math.max(...L.map(r => r[1]))];
      const clash = used.some(o => bb[0] < o.bb[2] && bb[2] > o.bb[0] && bb[1] < o.bb[3] && bb[3] > o.bb[1]);
      if (!nIn) warn.push(nm + ': ' + T('liegt außerhalb der Platte – weggelassen.'));
      else if (clash) warn.push(nm + ': ' + T('überschneidet eine andere Ausnehmung – weggelassen.'));
      else {
        if (nIn < L.length) warn.push(nm + ': ' + T('ragt über die Profilkontur – als Ausschnitt am Rand.') + (q.huel ? ' ' + T('(Die Steckung passt nicht ins Profil, siehe Steghöhen.)') : ''));
        holes.push(h); used.push({ id: q.id, name: nm, L, bb, huel: q.huel, inner, d: q.d, round: q.round, dir: q.dir, edge: nIn < L.length });
      }
    });
    if (p.jAxis && main) enabled.forEach(q => { if (q !== main && q.huel && Math.abs(q.dir[1] - d[1]) > 1e-3) warn.push(q.name + ': ' + T('andere Achsrichtung als die erste Hülse – die Platte folgt der ersten.')); });
    // Erleichterungslöcher im Steg: unter dem Profil (und unter den Bohrungen), über dem Schlitz der Grundplatte.
    // „Zusammengebaut“ wird stehend gedruckt → Decken als 45°-Dach.
    let lite = [];
    if (p.liteJ) {
      const M = p.liteM, ceil = x => {
        const v = valsAt(env.bot, x); let y = v.length ? Math.min(...v) : Infinity;
        holes.forEach(h => { const b = valsAt(h.bot, x); if (b.length) y = Math.min(y, ...b); });
        return y;
      };
      lite = liteHoles(uA + M, uB - M, y0 + p.bT + M, rimBelow(ceil, M), { e: p.liteJe, n: p.liteJn, r: p.liteR, up: p.jOut === 'one' });
      if (p.liteJn > 0 && !lite.length) warn.push(T('Bohrschablone') + ': ' + T('Bei dieser Zahl der Streben bleibt kein Platz für Erleichterungslöcher – weniger Streben oder schmalere Stegbreite wählen.'));
    }
    const mesh = prism(outer, holes.concat(lite.map(h => h.chains)), t, [shU, shY]);
    const areaOut = Math.abs(area2(dedup(outer.bot.concat(outer.top.slice().reverse())))) / 2, litePct = areaOut > 0 ? 100 * lite.reduce((s, h) => s + h.area, 0) / areaOut : 0;
    // Platte (örtlich u, y, n) → Schablone: X ab vorderstem Profilpunkt, Z quer (+ rechte Platte nach außen)
    const toW = (q, side) => { const s = q[0] - umin, n = q[2]; return [s * cphi - n * sphi, q[1], side * (p.dF / 2 + s * sphi + n * cphi)]; };
    // Grundplatte (Grundriss X, Z; Dicke nach oben)
    const fp = [[uA, 0], [uB, 0], [uB + shU, t], [uA + shU, t]].map(q => { const w = toW([q[0], 0, q[1]], 1); return [w[0], w[2]]; });
    const tph = sphi / cphi, Zin = X => p.dF / 2 + X * tph, Zs = X => Zin(X) + (t + p.bOv) / cphi;
    const Xf = Math.min(...fp.map(q => q[0])) - p.bOv, Xr = Math.max(...fp.map(q => q[0])) + p.bOv;
    const bOuter = { bot: [[Xf, -Zs(Xf)], [Xr, -Zs(Xr)]], top: [[Xf, Zs(Xf)], [Xr, Zs(Xr)]] }, bWin = [];
    let bLite = [], bStruts = 0, bTwo = false;
    if (p.liteB) {
      // Fachwerk zwischen den Platten (Grundplatte liegt beim Druck flach → Löcher ohne Dach): voller Rand vorn/hinten und
      // entlang der Platten bzw. Schlitze; ab rund 90 mm lichter Breite zusätzlich ein Längsgurt in der Mitte (Felder nicht zu groß).
      // Gerechnet im gescherten Rahmen v = Z + hw(X) (Boden v = 0 gerade), danach zurück; bei zwei Hälften gespiegelt.
      const M = p.liteM, hw = X => Zin(X) - p.slotClr - M, X0 = Xf + M, X1 = Xr - M;
      const two = Math.min(hw(X0), hw(X1)) * 2 > 90, top = two ? X => hw(X) - p.liteBe / 2 : X => 2 * hw(X);
      if (X1 - X0 > 10 && Math.min(hw(X0), hw(X1)) > 0) {
        const LH = liteHoles(X0, X1, 0, top, { e: p.liteBe, n: p.liteBn, r: p.liteR, up: false }), H = LH.map(h => h.loop.map(q => [q[0], q[1] - hw(q[0])]));
        bStruts = LH.length ? LH.struts : 0; bTwo = two;   // bei Längsgurt je Hälfte
        if (p.liteBn > 0 && !LH.length) warn.push(T('Grundplatte') + ': ' + T('Bei dieser Zahl der Streben bleibt kein Platz für Erleichterungslöcher – weniger Streben oder schmalere Stegbreite wählen.'));
        const loops = two ? H.concat(H.map(L => L.map(q => [q[0], -q[1]]).reverse())) : H;
        bLite = loops.map(L => ({ chains: envChains(L), area: Math.abs(area2(L)) / 2 }));
      }
    } else if (p.bWin) {
      const Xw0 = Xf + p.bOv + p.bWinM, Xw1 = Xr - p.bOv - p.bWinM, hw = X => Zin(X) - p.bWinM;
      if (Xw1 - Xw0 > 10 && hw(Xw0) > 3 && hw(Xw1) > 3) bWin.push({ bot: [[Xw0, -hw(Xw0)], [Xw1, -hw(Xw1)]], top: [[Xw0, hw(Xw0)], [Xw1, hw(Xw1)]] });
      else warn.push(T('Kein Platz für ein Fenster in der Grundplatte.'));
    }
    let fpL = fp.slice(); if (area2(fpL) < 0) fpL = fpL.reverse();
    const slotR = miter(fpL, p.slotClr), slots = [envChains(slotR), envChains(slotR.map(q => [q[0], -q[1]]))];
    const bHoles = bWin.concat(bLite.map(h => h.chains)), bArea = (Xr - Xf) * (Zs(Xf) + Zs(Xr));
    const base = { outer: bOuter, win: bWin, slots, parts: prism(bOuter, bHoles.concat(slots), p.bT), one: prism(bOuter, bHoles, p.bT), Xf, Xr, W: 2 * Math.max(Zs(Xf), Zs(Xr)),
      lite: bLite, struts: bStruts, two: bTwo, litePct: bArea > 0 ? 100 * bLite.reduce((s, h) => s + h.area, 0) / bArea : 0 };
    if (p.dF < 10) warn.push(T('Lichter Abstand vorne sehr klein – passt der Rumpf dazwischen?'));
    const skewDR = Math.abs(src.zT - src.zL) > 1e-3 ? p.dF + 2 * (src.zT - src.zL) : null;
    if (!p.dRAuto && skewDR != null && Math.abs(skewDR - p.dR) > 0.5) warn.push(T('Die Wurzel ist schräg: passend wäre hinten') + ' ' + fmt(skewDR) + ' mm ' + T('(„Abstand hinten aus der Schräge“ einschalten).'));
    let hMax = 0; outer.top.forEach(q => { if (q[1] > hMax) hMax = q[1]; });
    return { ok: true, src, PL, outer, holes, used, lite, litePct, mesh, toW, sphi, cphi, phi, su, sy, shU, shY, umin, umax, uA, uB, y0, sY, base, main, hMax, skewDR, dR, warn };
  }

  // =====================================================================================
  //  Gesamtmodell (Stützen, Schablone, Tragfläche in der Ansicht)
  // =====================================================================================
  function build() {
    const c = C(), p = params(c), G = geo();
    if (!G) return { ok: false, msg: T('Keine Tragfläche im Tragflächendesign.'), p, stands: [], warn: [] };
    const lift = wingLift(G, p), sW = lift.sW;
    const stands = p.stands.map((s, i) => standGeo(G, p, i, sW));
    let jig = null;
    if (p.jig) { try { jig = jigGeo(G, p, sW, lift.src); } catch (e) { console.error(e); jig = { ok: false, warn: [T('Bohrschablone:') + ' ' + (e && e.message ? e.message : e)] }; } }
    const warn = []; stands.forEach(s => warn.push(...s.warn)); if (jig) warn.push(...jig.warn);
    return { ok: true, p, G, sW, lift, stands, jig, warn };
  }
  // Weltlage der Teile in der Ansicht
  function sceneParts(M) {
    const p = M.p, G = M.G, items = [], R = rotFn(p.alpha);
    const src = M.jig && M.jig.src ? M.jig.src : rootSource(G);
    const Nw = R(src.xn - G.xLE0, src.yn - G.yLE0), Zw0 = p.dF / 2 - (src.zL || 0);
    const okS = M.stands.filter(s => s.ok);
    const sW = M.sW != null ? M.sW : wingLift(G, p).sW;   // Höhenversatz der Tragfläche (gemeinsam mit Stützen und Schablone)
    // Tragfläche (beide Seiten), je Segment Mantel zwischen innen und außen
    {
      const tris = [], pl = src.plane || { xL: 0, zL: 0, k: 0 }, zr = x => pl.zL - (x - pl.xL) * pl.k;
      const W3 = q => { const r = R(q[0] - G.xLE0, q[1] - G.yLE0); return [r[0], r[1] + sW, Zw0 + q[2]]; };
      // Mantellinie A→B an der (schrägen) Wurzelebene abschneiden: was davor liegt, gehört nicht zur Tragfläche
      const clip = (a, b) => {
        const f0 = a[2] - zr(a[0]); if (f0 >= 0) return a;
        const D = (b[2] - a[2]) + (b[0] - a[0]) * pl.k, t = D > 1e-12 ? Math.min(1, -f0 / D) : 1;
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      };
      let rootRing = null;
      G.segs.forEach((s, si) => {
        const A = profSeg(s, 0), B = profSeg(s, 1), n = Math.min(A.length, B.length), a3 = [], b3 = [];
        for (let i = 0; i < n; i++) { const pb = [B[i][0], B[i][1], s.z1]; a3.push(clip([A[i][0], A[i][1], s.z0], pb)); b3.push(pb); }
        if (si === 0) rootRing = a3;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n, a = W3(a3[i]), b = W3(a3[j]), cc = W3(b3[j]), d = W3(b3[i]);
          tris.push([a, b, cc], [a, cc, d]);
        }
      });
      // Deckel an der Wurzel (in ihrer Ebene) und an der Spitze (sonst sieht man in der Seitenansicht durch die offene Fläche)
      const tipS = G.segs[G.segs.length - 1], cap = (P2, zOf) => prism(envChains(P2), [], 0).tri2.forEach(T3 => tris.push(T3.map(q => W3([q[0], q[1], zOf(q[0])]))));
      if (rootRing) cap(rootRing.map(q => [q[0], q[1]]), x => Math.max(0, Math.min(G.segs[0].z1, zr(x))));
      cap(profSeg(tipS, 1), () => G.L);
      items.push({ grp: 'wing', tris, col: [150, 160, 176] });
      items.push({ grp: 'wing', tris: mapTris(tris, q => [q[0], q[1], -q[2]], true), col: [150, 160, 176] });
    }
    okS.forEach(s => {
      const zc = Zw0 + s.z;
      [1, -1].forEach(side => {
        items.push({ grp: 'stands', tris: mapTris(s.mesh.tris, q => [q[0], q[1], side * (zc - p.t / 2 + q[2])], side < 0), col: [232, 150, 70] });
        if (s.foot) items.push({ grp: 'stands', tris: mapTris(s.foot.mesh.tris, q => [q[0], q[2], side * (zc + q[1])], side > 0), col: [168, 124, 84] });
      });
    });
    if (M.jig && M.jig.ok) {
      const J = M.jig, dx = Nw[0] + J.umin;
      const sh = q => [q[0] + dx, q[1], q[2]];
      items.push({ grp: 'jig', tris: mapTris(J.mesh.tris, q => sh(J.toW(q, 1)), false), col: [90, 169, 255] });
      items.push({ grp: 'jig', tris: mapTris(J.mesh.tris, q => sh(J.toW(q, -1)), true), col: [90, 169, 255] });
      items.push({ grp: 'jig', tris: mapTris(J.base.one.tris, q => sh([q[0], q[2], q[1]]), true), col: [60, 112, 176] });
    }
    // Steckung aus „Steghöhen“ (Häkchen „Steckung“): Hülse je Flächenhälfte, die Steckung selbst durchgehend durch den Rumpf
    // (Hauptsteckung; bei Lage „parallel zur Tragfläche“ in der Mitte geknickt), Teilungen nur in der Fläche
    {
      const W3 = q => { const r = R(q[0] - G.xLE0, q[1] - G.yLE0); return [r[0], r[1] + sW, Zw0 + q[2]]; };
      const sleeve = [], rod = [];
      stkList().forEach(S => {
        const zEnd = S.len, zIn = S.split == null ? -Zw0 : S.z0;   // Hauptsteckung bis zur Rumpfmitte (Welt Z = 0)
        const tube = (w, h, zA, zB) => tubeRing(S, w, h, zA, zB);
        if (S.inW > 0 && S.inH > 0) rod.push(...closedTube(tube(S.inW, S.inH, zIn, zEnd)));
        if (S.wall > 0 && S.oW > S.inW) sleeve.push(...hollowTube(tube(S.oW, S.oH, S.z0, zEnd), tube(S.inW, S.inH, S.z0, zEnd)));
      });
      [[sleeve, [64, 68, 78]], [rod, [226, 76, 92]]].forEach(([tr, col]) => {
        if (!tr.length) return;
        const w3 = tr.map(t3 => t3.map(W3));
        items.push({ grp: 'stk', tris: w3, col }, { grp: 'stk', tris: mapTris(w3, q => [q[0], q[1], -q[2]], true), col });
      });
    }
    return items;
  }
  // Steckungen aus „Steghöhen“ (nur wenn dort angelegt; StegApi.cfg() würde stegH sonst erst anlegen)
  function stkList() {
    const S = App.StegApi, cfg = ST().cfg;
    if (!stegOn() || !S.stkAll || !cfg.stegH || typeof cfg.stegH !== 'object') return [];
    try {
      const SG = S.geo(), sc = S.cfg(); if (!SG) return [];
      return (S.stkAll(SG, sc) || []).filter(k => k && k.cy != null && k.len > k.z0 + 1e-6 && k.oW > 0 && k.oH > 0).map(k => {
        const dz = k.len - k.z0, x0 = k.cx(k.z0), x1 = k.cx(k.len);
        return { z0: k.z0, len: k.len, split: k.split, round: !!k.round, wall: Math.max(0, +k.wall || 0), oW: k.oW, oH: k.oH, inW: k.inW, inH: k.inH,
          cy: k.cy, tan: +k.tan || 0, x0, kx: dz > 1e-9 ? (x1 - x0) / dz : 0 };
      });
    } catch (e) { console.warn('Tragflächenständer: Steckung aus Steghöhen nicht lesbar:', e); return []; }
  }
  // Querschnitte eines geraden Rohrs bei zA und zB (Ebenen z = konst., Maße senkrecht zur Achse → senkrecht/quer gestreckt):
  // je ein Ring [[x, y, z], …] gegen den Uhrzeigersinn im Querschnitt
  function tubeRing(S, w, h, zA, zB) {
    const cx = z => S.x0 + S.kx * (z - S.z0), cy = z => S.cy + z * S.tan;
    const hw = w / 2 * Math.sqrt(1 + S.kx * S.kx), hh = h / 2 * Math.sqrt(1 + S.tan * S.tan);
    const sec = S.round ? Array.from({ length: 40 }, (_, i) => { const a = 2 * Math.PI * i / 40; return [Math.cos(a), Math.sin(a)]; }) : [[1, -1], [1, 1], [-1, 1], [-1, -1]];
    return [zA, zB].map(z => sec.map(([u, v]) => [cx(z) + u * hw, cy(z) + v * hh, z]));
  }
  // Mantel zwischen zwei Ringen gleicher Punktzahl (Normale nach außen, bei inside nach innen)
  function mantle(A, B, inside) {
    const out = [], n = A.length;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; if (inside) out.push([A[i], B[j], B[i]], [A[i], A[j], B[j]]); else out.push([A[i], B[i], B[j]], [A[i], B[j], A[j]]); }
    return out;
  }
  function closedTube([A, B]) {   // volles Rohr (Steckung): Mantel + Deckel (konvex → Fächer)
    const out = mantle(A, B, false);
    for (let i = 1; i + 1 < A.length; i++) { out.push([A[0], A[i], A[i + 1]], [B[0], B[i + 1], B[i]]); }
    return out.map(t => [t[0], t[2], t[1]]);   // Ringe laufen gegen den Uhrzeigersinn bei wachsendem z → Umlauf drehen, Normalen außen
  }
  function hollowTube([A, B], [a, b]) {   // Hülse: außen, innen, Ringflächen an den Enden
    const out = mantle(A, B, false).concat(mantle(a, b, true)), n = A.length;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; out.push([A[i], a[j], a[i]], [A[i], A[j], a[j]], [B[i], b[i], b[j]], [B[i], b[j], B[j]]); }
    return out.map(t => [t[0], t[2], t[1]]);
  }

  // =====================================================================================
  //  Ausgabe: STL je Teil, Schablone zusammengebaut, DXF
  // =====================================================================================
  const tag = () => { const w = App.wingFileTag ? App.wingFileTag() : ''; return w ? w + '_' : ''; };
  const yUpToZUp = tris => tris.map(t3 => t3.map(q => [q[0], -q[2], q[1]]));
  // Teile nebeneinander aufs Druckbett (in y versetzt, 10 mm Abstand), dann als Float32-Dreiecke
  function lineUp(list) {
    let yo = 0;
    return list.map(it => {
      let hi = -Infinity; const tr = toBed(it.tris).map(t3 => t3.map(q => { if (q[1] > hi) hi = q[1]; return [q[0], q[1] + yo, q[2]]; }));
      yo += hi + 10;
      return { name: it.name, v: toFloat(tr) };
    });
  }
  function standFiles(M) {
    const list = [];
    M.stands.forEach(s => {
      if (!s.ok) return;
      const b = tag() + 'stuetze' + (s.i + 1) + '_z' + fmt(s.z).replace(',', '-');
      list.push({ name: b + '.stl', tris: s.mesh.tris });   // liegt flach: x längs, y Höhe, z Dicke
      if (s.foot) list.push({ name: b + '_fuss.stl', tris: s.foot.mesh.tris });
    });
    return lineUp(list);
  }
  function jigFiles(M) {
    const J = M.jig; if (!J || !J.ok) return [];
    const b = tag() + 'bohrschablone';
    if (M.p.jOut === 'one') {
      const w = mapTris(J.mesh.tris, q => J.toW(q, 1), false).concat(mapTris(J.mesh.tris, q => J.toW(q, -1), true), mapTris(J.base.one.tris, q => [q[0], q[2], q[1]], true));
      return lineUp([{ name: b + '.stl', tris: yUpToZUp(w) }]);
    }
    // Einzelteile flach: Innenseite der Platte auf dem Druckbett; linke Platte gespiegelt
    return lineUp([
      { name: b + '_platte_rechts.stl', tris: J.mesh.tris },
      { name: b + '_platte_links.stl', tris: mapTris(J.mesh.tris, q => [q[0], q[1], -q[2]], true) },
      { name: b + '_grundplatte.stl', tris: J.base.parts.tris }
    ]);
  }
  async function saveList(list, name) {
    if (!list.length) { if (App.toast) App.toast(T('Nichts zu speichern.')); return; }
    if (App.stlSaveMany) await App.stlSaveMany(list, 'svStl', { name });
    else if (App.download && App.stlBinary) for (const it of list) await App.download(it.name, App.stlBinary(it.v), 'model/stl', 'svStl');
  }
  function exportStands() { const M = model(); if (!M.ok) { alert(M.msg); return; } saveList(standFiles(M), tag() + 'stuetzen.3mf'); }
  function exportJig() {
    const M = model(); if (!M.ok) { alert(M.msg); return; }
    if (!M.jig || !M.jig.ok) { if (App.toast) App.toast(T('Keine Bohrschablone (in der Seitenleiste einschalten).')); return; }
    saveList(jigFiles(M), tag() + 'bohrschablone.3mf');
  }
  function dxfText(M) {
    if (!window.Dxf || !M.ok) return null;
    const layers = [], poly = L => ({ closed: true, pts: L.map(q => ({ x: q[0], y: q[1] })) });
    let yo = 0;
    const put = (name, color, loops, h) => {
      let x0 = Infinity, y0 = Infinity, y1 = -Infinity; loops.forEach(L => L.forEach(q => { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }));
      layers.push({ name, color, polys: loops.map(L => poly(L.map(q => [q[0] - x0, q[1] - y0 + yo]))) });
      yo += (h != null ? h : y1 - y0) + 20;
    };
    M.stands.forEach(s => {
      if (!s.ok) return;
      put('STUETZE_' + (s.i + 1), 30, boundaryLoops(s.mesh.tri2));
      if (s.foot) put('FUSS_' + (s.i + 1), 33, boundaryLoops(s.foot.mesh.tri2));
    });
    const J = M.jig;
    if (J && J.ok) {
      put('SCHABLONE_PLATTE', 5, boundaryLoops(J.mesh.tri2));
      put('SCHABLONE_GRUNDPLATTE', 4, boundaryLoops(J.base.parts.tri2));
    }
    return layers.length ? Dxf.write(layers, { precision: ST().cfg.precision != null ? ST().cfg.precision : 3 }) : null;
  }
  function exportDxf() {
    const M = model(), txt = dxfText(M);
    if (!txt) { if (App.toast) App.toast(T('Nichts zu speichern.')); return; }
    if (App.exportViaPicker) App.exportViaPicker(tag() + 'staender.dxf', txt, 'application/dxf', 'svDxf');
  }
  function toCad() {
    const M = model(), txt = dxfText(M);
    if (!txt || !App.cadImportDxfText) { if (App.toast) App.toast(T('Nichts zu übernehmen.')); return; }
    App.cadImportDxfText(txt, T('Tragflächenständer'));
  }

  // =====================================================================================
  //  Ansicht (WebGL2, Rückfall Canvas 2D) + Zeichnung des gewählten Teils
  // =====================================================================================
  let cv = null, ctx = null, glc = null, gl = null, glP = null, glL = null, glBuf = null, glTried = false, glN = 0, glN0 = 0, glDirty = true;
  let MODEL = null, scene = null, wired = false, pivot = null;
  const CAM0 = { yaw: 0.75, pitch: 0.42, zoom: 1, px: 0, py: 0 };   // schräg von vorn links oben
  const cam = Object.assign({}, CAM0);
  const ROT = (v, yaw, pitch) => {   // wie ViewCube.ROT_STD (Welt: y oben)
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x1 = v[0] * cy + v[2] * sy, z1 = -v[0] * sy + v[2] * cy;
    return [x1, v[1] * cp - z1 * sp, v[1] * sp + z1 * cp];
  };
  function rotM() { return [ROT([1, 0, 0], cam.yaw, cam.pitch), ROT([0, 1, 0], cam.yaw, cam.pitch), ROT([0, 0, 1], cam.yaw, cam.pitch)]; }
  function cssVar(n, fb) { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb; } catch (e) { return fb; } }
  function bgRGB() {
    try {
      ctx.fillStyle = cssVar('--bg', '#0f1216'); const s = String(ctx.fillStyle);
      let m = /^#([0-9a-f]{6})$/i.exec(s); if (m) return [0, 2, 4].map(k => parseInt(m[1].slice(k, k + 2), 16) / 255);
      m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s); if (m) return [m[1] / 255, m[2] / 255, m[3] / 255];
    } catch (e) { /* Rückfall */ }
    return [0.06, 0.07, 0.09];
  }
  // Sichtbarkeit in der 3D-Ansicht (Häkchen unten in der Ansicht): Tragfläche, Stützen (mit Fußplatten), Schablone (mit Grundplatte).
  // In cfg.formStand.view (Ansichtswert, erzeugt keinen Strg+Z-Schritt; Altstand showWing).
  function vis() {
    const c = C(); let v = c.view;
    if (!v || typeof v !== 'object') v = c.view = { wing: c.showWing !== false, stands: true, jig: true };
    return v;
  }
  // Steckung ist eine Zusatzansicht: nur mit Häkchen (ohne Eintrag aus); die übrigen Teile ohne Eintrag sichtbar
  const shown = (V, g) => g === 'stk' ? V.stk === true : V[g] !== false;
  let sceneItems = [], sceneBox = null;
  const boxOf = items => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    items.forEach(it => it.tris.forEach(P => P.forEach(q => { for (let k = 0; k < 3; k++) { if (q[k] < lo[k]) lo[k] = q[k]; if (q[k] > hi[k]) hi[k] = q[k]; } })));
    return lo[0] <= hi[0] ? { lo, hi } : null;
  };
  // Szene aus dem Modell aufbauen
  function makeScene() { sceneItems = MODEL && MODEL.ok ? sceneParts(MODEL) : []; fillScene(); }
  // nur die eingeschalteten Teile in den Puffer; der Bildausschnitt passt sich an das Sichtbare an
  // (ohne Tragfläche sind Stützen und Schablone groß zu sehen), nichts sichtbar = letzter Ausschnitt
  function fillScene() {
    // Schablone zuletzt: sie wird mit kleinem Tiefenvorrang gezeichnet (Platten und Tragfläche liegen an der Wurzel im selben Raum)
    const V = vis(), items = sceneItems.filter(it => shown(V, it.grp)).sort((a, b) => (a.grp === 'jig') - (b.grp === 'jig'));
    const nb = boxOf(items) || sceneBox || boxOf(sceneItems);
    // Drehpunkt nur verwerfen, wenn sich der sichtbare Bereich merklich ändert (sonst springt die Ansicht bei jeder Eingabe)
    const sameBox = (a, b) => {
      if (!a || !b) return false;
      const tol = 0.1 * Math.hypot(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]);   // Ein-/Ausblenden ja, Maßänderung nein
      return [0, 1, 2].every(k => Math.abs(a.lo[k] - b.lo[k]) <= tol && Math.abs(a.hi[k] - b.hi[k]) <= tol);
    };
    if (!sameBox(nb, sceneBox)) pivot = null;
    sceneBox = nb;
    let n = 0, n0 = 0; const parts = [];
    items.forEach(it => { parts.push({ a: n, b: n + it.tris.length, grp: it.grp }); n += it.tris.length; if (it.grp !== 'jig') n0 += it.tris.length; });
    meas.hover = null;
    const data = new Float32Array(n * 27);
    let o = 0;
    items.forEach(it => {
      const cl = it.col.map(x => x / 255);
      it.tris.forEach(P => {
        const ux = P[1][0] - P[0][0], uy = P[1][1] - P[0][1], uz = P[1][2] - P[0][2], wx = P[2][0] - P[0][0], wy = P[2][1] - P[0][1], wz = P[2][2] - P[0][2];
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
        P.forEach(q => { data[o++] = q[0]; data[o++] = q[1]; data[o++] = q[2]; data[o++] = nx; data[o++] = ny; data[o++] = nz; data[o++] = cl[0]; data[o++] = cl[1]; data[o++] = cl[2]; });
      });
    });
    const B = sceneBox, ok = !!B;
    scene = { data, n: n * 3, n0: n0 * 3, parts, lo: ok ? B.lo : [0, 0, 0], hi: ok ? B.hi : [0, 0, 0], c: ok ? B.lo.map((x, k) => (x + B.hi[k]) / 2) : [0, 0, 0], R: ok ? Math.max(1, Math.hypot(B.hi[0] - B.lo[0], B.hi[1] - B.lo[1], B.hi[2] - B.lo[2]) / 2) : 1 };
    glDirty = true;
  }
  // Häkchen in der Knopfleiste der Ansicht (einmal angelegt, Zustand bei jedem Neuaufbau aus cfg)
  function visBar() {
    const bar = cv && cv.parentNode && cv.parentNode.querySelector('.simbar'); if (!bar) return;
    let box = bar.querySelector('.tfst-vis');
    if (!box) {
      box = document.createElement('span'); box.className = 'tfst-vis';
      box.style.cssText = 'display:inline-flex;gap:10px;align-items:center;margin:0 6px;font-size:12px;white-space:nowrap';
      [['wing', 'Tragfläche', '#96a0b0'], ['stands', 'Stützen', '#e8964a'], ['jig', 'Schablone', '#5aa9ff'], ['stk', 'Steckung', '#e24c5c']].forEach(([k, lab, col]) => {
        const l = document.createElement('label'); l.style.cssText = 'display:inline-flex;gap:4px;align-items:center;cursor:pointer'; l.dataset.k = k;
        if (k === 'stk') l.title = T('Steckung und Hülse aus „Steghöhen“ (Hülse dunkel, Steckung rot, durch den Rumpf durchgehend)');
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.k = k;
        const sw = document.createElement('span'); sw.style.cssText = 'display:inline-block;width:10px;height:10px;border-radius:2px;background:' + col;
        const tx = document.createElement('span'); tx.textContent = T(lab);
        cb.onchange = () => { vis()[k] = cb.checked; fillScene(); draw(); };
        l.append(cb, sw, tx); box.appendChild(l);
      });
      const h = bar.querySelector('.hint'); if (h) bar.insertBefore(box, h); else bar.appendChild(box);
    }
    const V = vis();
    box.querySelectorAll('input').forEach(cb => { cb.checked = shown(V, cb.dataset.k); });
    // „Steckung“ nur anbieten, wenn „Steghöhen“ eine liefert
    const sl = box.querySelector('label[data-k="stk"]'); if (sl) sl.style.display = sceneItems.some(it => it.grp === 'stk') ? 'inline-flex' : 'none';
  }
  function glInit() {
    if (glTried || !cv) return; glTried = true;
    try {
      glc = document.createElement('canvas'); glc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
      cv.parentNode.insertBefore(glc, cv);
      gl = glc.getContext('webgl2', { antialias: true, alpha: false, depth: true }); if (!gl) throw new Error('no webgl2');
      const VS = `#version 300 es
        in vec3 aP; in vec3 aN; in vec3 aC; uniform mat3 uR; uniform vec3 uC; uniform vec4 uS; uniform float uZ; uniform float uB;
        out vec3 vN; out vec3 vC;
        void main() { vec3 p = uR * (aP - uC); vN = uR * aN; vC = aC; gl_Position = vec4(p.x * uS.x + uS.z, p.y * uS.y + uS.w, -p.z * uZ - uB, 1.0); }`;
      const FS = `#version 300 es
        precision mediump float; in vec3 vN; in vec3 vC; out vec4 o;
        void main() { vec3 n = normalize(vN); vec3 L = normalize(vec3(-0.35, 0.55, 0.75)); float k = 0.30 + 0.62 * abs(dot(n, L)) + 0.10 * abs(n.y); o = vec4(vC * min(k, 1.08), 1.0); }`;
      const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
      glP = gl.createProgram(); gl.attachShader(glP, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(glP, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(glP);
      if (!gl.getProgramParameter(glP, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glP));
      glL = { aP: gl.getAttribLocation(glP, 'aP'), aN: gl.getAttribLocation(glP, 'aN'), aC: gl.getAttribLocation(glP, 'aC'), uR: gl.getUniformLocation(glP, 'uR'), uC: gl.getUniformLocation(glP, 'uC'), uS: gl.getUniformLocation(glP, 'uS'), uZ: gl.getUniformLocation(glP, 'uZ'), uB: gl.getUniformLocation(glP, 'uB') };
      glBuf = gl.createBuffer();
      glc.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; }, false);
    } catch (e) {
      console.warn('Tragflächenständer: WebGL2 nicht verfügbar, Canvas-2D-Darstellung:', e && e.message);
      gl = null; if (glc && glc.parentNode) glc.parentNode.removeChild(glc); glc = null;
    }
  }
  function viewParams(w, h) { return { c: pivot || scene.c, s: 0.44 * Math.min(w, h) / scene.R * cam.zoom, M: rotM() }; }
  function project(q, vp, w, h) {
    const d = [q[0] - vp.c[0], q[1] - vp.c[1], q[2] - vp.c[2]], M = vp.M;
    const x = M[0][0] * d[0] + M[1][0] * d[1] + M[2][0] * d[2], y = M[0][1] * d[0] + M[1][1] * d[1] + M[2][1] * d[2], z = M[0][2] * d[0] + M[1][2] * d[1] + M[2][2] * d[2];
    return [w / 2 + cam.px + x * vp.s, h / 2 + cam.py - y * vp.s, z];
  }
  function draw() {
    if (!cv || ST().activeTab !== TAB) return;
    const dpr = window.devicePixelRatio || 1, w = Math.max(1, cv.clientWidth), h = Math.max(1, cv.clientHeight);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    glInit();
    if (!scene) makeScene();
    const bg = bgRGB();
    if (!scene.n) {
      if (gl) { gl.viewport(0, 0, glc.width, glc.height); gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      else { ctx.fillStyle = cssVar('--bg', '#0f1216'); ctx.fillRect(0, 0, w, h); }
      ctx.fillStyle = '#8a97a6'; ctx.font = '13px Segoe UI, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(MODEL && MODEL.msg ? MODEL.msg : T('Nichts zu zeigen.'), w / 2, h / 2); ctx.textAlign = 'left';
      return;
    }
    const vp = viewParams(w, h);
    if (gl) {
      const W = Math.round(w * dpr), H = Math.round(h * dpr);
      if (glc.width !== W || glc.height !== H) { glc.width = W; glc.height = H; }
      gl.viewport(0, 0, W, H); gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(glP); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
      gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
      if (glDirty) { gl.bufferData(gl.ARRAY_BUFFER, scene.data, gl.STATIC_DRAW); glN = scene.n; glN0 = Math.min(scene.n0 || 0, scene.n); glDirty = false; }
      const st = 36;
      gl.enableVertexAttribArray(glL.aP); gl.vertexAttribPointer(glL.aP, 3, gl.FLOAT, false, st, 0);
      gl.enableVertexAttribArray(glL.aN); gl.vertexAttribPointer(glL.aN, 3, gl.FLOAT, false, st, 12);
      gl.enableVertexAttribArray(glL.aC); gl.vertexAttribPointer(glL.aC, 3, gl.FLOAT, false, st, 24);
      gl.uniformMatrix3fv(glL.uR, false, [].concat(vp.M[0], vp.M[1], vp.M[2]));
      gl.uniform3f(glL.uC, vp.c[0], vp.c[1], vp.c[2]);
      gl.uniform4f(glL.uS, 2 * vp.s / w, 2 * vp.s / h, 2 * cam.px / w, -2 * cam.py / h);
      const uZ = 1 / (scene.R * 3.2 + 1);
      gl.uniform1f(glL.uZ, uZ);
      // erst Tragfläche und Stützen, dann die Schablone 0,4 mm nach vorn: wo Platte und Fläche zusammenfallen, sieht man die Platte
      gl.uniform1f(glL.uB, 0); if (glN0 > 0) gl.drawArrays(gl.TRIANGLES, 0, glN0);
      gl.uniform1f(glL.uB, 0.4 * uZ); if (glN > glN0) gl.drawArrays(gl.TRIANGLES, glN0, glN - glN0);
    } else {
      ctx.fillStyle = cssVar('--bg', '#0f1216'); ctx.fillRect(0, 0, w, h);
      const D = scene.data, list = [], Lv = [-0.35, 0.55, 0.75], Ln = Math.hypot(Lv[0], Lv[1], Lv[2]), M = vp.M;
      for (let i = 0; i < scene.n; i += 3) {
        const o = i * 9, q = [0, 1, 2].map(k => project([D[o + 9 * k], D[o + 9 * k + 1], D[o + 9 * k + 2]], vp, w, h)), nn = [D[o + 3], D[o + 4], D[o + 5]];
        const nx = M[0][0] * nn[0] + M[1][0] * nn[1] + M[2][0] * nn[2], ny = M[0][1] * nn[0] + M[1][1] * nn[1] + M[2][1] * nn[2], nz = M[0][2] * nn[0] + M[1][2] * nn[1] + M[2][2] * nn[2];
        const k = Math.min(1.08, 0.30 + 0.62 * Math.abs((nx * Lv[0] + ny * Lv[1] + nz * Lv[2]) / Ln) + 0.10 * Math.abs(ny));
        list.push({ q, d: (q[0][2] + q[1][2] + q[2][2]) / 3, c: [D[o + 6], D[o + 7], D[o + 8]].map(x => Math.round(x * 255 * k)) });
      }
      list.sort((a, b) => a.d - b.d);
      list.forEach(f => {
        const s = 'rgb(' + f.c.join(',') + ')';
        ctx.fillStyle = ctx.strokeStyle = window.DrawTheme ? DrawTheme.raw(s) : s;
        ctx.beginPath(); ctx.moveTo(f.q[0][0], f.q[0][1]); ctx.lineTo(f.q[1][0], f.q[1][1]); ctx.lineTo(f.q[2][0], f.q[2][1]); ctx.closePath(); ctx.fill(); ctx.lineWidth = 0.5; ctx.stroke();
      });
    }
    if (pivot && window.ViewCube) { const q = project(pivot, vp, w, h); ViewCube.drawPivot(ctx, q[0], q[1]); }
    if (C().showInset) drawInset(w, h);
    lastVP = { vp, w, h }; drawMeas();
  }
  // gewähltes Teil als Zeichnung unten links (Stütze mit Profil gestrichelt, Schablonenplatte mit Bohrungen)
  function drawInset(w, h) {
    if (!MODEL || !MODEL.ok) return;
    const sel = String(C().sel || 's0'), J = MODEL.jig;
    let part = null, title = '', loops = [], prof = null, dims = '';
    if (sel === 'jig' && J && J.ok) {
      part = J; title = T('Bohrschablone – Platte (Innenseite)'); loops = boundaryLoops(J.mesh.tri2);
      dims = fmt(J.umax - J.umin) + ' × ' + fmt(J.hMax) + ' mm · ' + T('Steg') + ' ' + fmt(J.uB - J.uA) + ' mm';
    } else {
      const k = Math.max(0, parseInt(sel.slice(1), 10) || 0), S = MODEL.stands[k] || MODEL.stands.find(s => s.ok);
      if (S && S.ok) {
        part = S; title = T('Stütze') + ' ' + (S.i + 1) + ' · z = ' + fmt(S.z) + ' mm'; loops = boundaryLoops(S.mesh.tri2); prof = S.Ps;
        dims = fmt(S.len) + ' × ' + fmt(S.hMax) + ' mm · ' + T('tiefster Punkt') + ' ' + fmt(S.yLow) + ' mm';
      }
    }
    if (!part) return;
    // über der Knopfleiste (bricht bei schmalem Fenster in zwei Zeilen um)
    const bar = cv.parentNode && cv.parentNode.querySelector('.simbar'), barH = bar ? bar.offsetHeight + 8 : 46;
    const bw = Math.min(380, w * 0.44), bh = Math.max(80, Math.min(230, (h - barH) * 0.42)), x0 = 10, y0 = h - bh - barH;
    let lx = Infinity, hx = -Infinity, ly = 0, hy = -Infinity;
    loops.concat(prof ? [prof] : []).forEach(L => L.forEach(q => { lx = Math.min(lx, q[0]); hx = Math.max(hx, q[0]); hy = Math.max(hy, q[1]); }));
    const sc = Math.min((bw - 24) / Math.max(1, hx - lx), (bh - 52) / Math.max(1, hy - ly));
    const X = x => x0 + 12 + (x - lx) * sc + ((bw - 24) - (hx - lx) * sc) / 2, Y = y => y0 + bh - 24 - (y - ly) * sc;
    ctx.save();
    ctx.fillStyle = 'rgba(16,20,26,.84)'; ctx.strokeStyle = 'rgba(120,135,150,.6)'; ctx.lineWidth = 1;
    ctx.fillRect(x0, y0, bw, bh); ctx.strokeRect(x0 + 0.5, y0 + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = '#c9d3de'; ctx.font = '12px Segoe UI, sans-serif'; ctx.fillText(title, x0 + 8, y0 + 16);
    ctx.strokeStyle = 'rgba(140,150,160,.5)'; ctx.beginPath(); ctx.moveTo(x0 + 6, Y(0) + 0.5); ctx.lineTo(x0 + bw - 6, Y(0) + 0.5); ctx.stroke();   // Tisch
    ctx.beginPath(); loops.forEach(L => { L.forEach((q, i) => i ? ctx.lineTo(X(q[0]), Y(q[1])) : ctx.moveTo(X(q[0]), Y(q[1]))); ctx.closePath(); });
    const fill = sel === 'jig' ? 'rgba(90,169,255,.45)' : 'rgba(232,150,70,.45)';
    ctx.fillStyle = window.DrawTheme ? DrawTheme.raw(fill) : fill; ctx.fill('evenodd');
    ctx.strokeStyle = sel === 'jig' ? '#5aa9ff' : '#e8964a'; ctx.lineWidth = 1.2; ctx.stroke();
    if (prof) { ctx.setLineDash([4, 3]); ctx.strokeStyle = '#c8d2e0'; ctx.beginPath(); prof.forEach((q, i) => i ? ctx.lineTo(X(q[0]), Y(q[1])) : ctx.moveTo(X(q[0]), Y(q[1]))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = '#c9d3de'; ctx.font = '11px Segoe UI, sans-serif'; ctx.fillText(dims, x0 + 8, y0 + bh - 6);
    ctx.restore();
  }

  // =====================================================================================
  //  Messwerkzeug in der 3D-Ansicht (wie Formenbau / 3D-Bearbeitung)
  // =====================================================================================
  /* Abstand (mit ΔX/ΔY/ΔZ), Kette, Winkel, Radius (Kreis durch drei Punkte) und Wandstärke (Strahl senkrecht zur Fläche
   * bis zur Gegenseite desselben Teils). Punkte liegen auf der vordersten sichtbaren Oberfläche (Schablone mit demselben
   * Tiefenvorrang wie im Bild), Fang auf Netzecken und vorhandene Messpunkte. Weltkoordinaten der Ansicht: X nach hinten
   * (Wurzel-Nasenleiste = 0), Y = Höhe über dem Tisch, Z quer. Nur Sitzung; Messungen bleiben stehen, wenn sich das Modell ändert. */
  let lastVP = null, pc = null;   // pc: Bildschirmlage der Ecken je Ansicht (pickSurface)
  const V3 = {
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: a => Math.hypot(a[0], a[1], a[2]), norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  };
  const MEAS_MODES = [['dist', 'Abstand'], ['chain', 'Kette'], ['angle', 'Winkel'], ['radius', 'Radius'], ['thick', 'Wandstärke']];
  const MEAS_NEED = { dist: 2, angle: 3, radius: 3 };
  const MEAS_COL = '#7CFC9A', MEAS_COL_CUR = '#ffd27a';
  const meas = { on: false, mode: 'dist', snap: true, axes: true, list: [], cur: null, hover: null, raf: 0, hx: 0, hy: 0, halt: false };
  const measActive = () => meas.on && !!(scene && scene.n);
  const scr = q => { if (!lastVP) return { x: 0, y: 0 }; const r = project(q, lastVP.vp, lastVP.w, lastVP.h); return { x: r[0], y: r[1] }; };
  // Vorderster Oberflächenpunkt unter (x, y) in Bildschirmpunkten der Ansicht: { p, n (Dreiecksnormale), t (Dreieck), part }
  function pickSurface(x, y) {
    if (!scene || !scene.n || !cv) return null;
    const w = cv.clientWidth, h = cv.clientHeight, D = scene.data, nT = scene.n / 3, jig0 = (scene.n0 || 0) / 3;
    // Bildschirmlage aller Ecken je Ansicht einmal rechnen (Mausbewegung beim Messen fragt bei ruhender Ansicht oft ab)
    const key = [cam.yaw, cam.pitch, cam.zoom, cam.px, cam.py, pivot ? pivot.join(',') : '', w, h].join('|');
    if (!pc || pc.scene !== scene || pc.key !== key) {
      const vp = viewParams(w, h), M = vp.M, c = vp.c, s = vp.s, ox = w / 2 + cam.px, oy = h / 2 + cam.py, nV = scene.n;
      const m00 = M[0][0], m10 = M[1][0], m20 = M[2][0], m01 = M[0][1], m11 = M[1][1], m21 = M[2][1], m02 = M[0][2], m12 = M[1][2], m22 = M[2][2];
      const X = new Float64Array(nV), Y = new Float64Array(nV), Z = new Float64Array(nV);
      for (let v = 0; v < nV; v++) {
        const b = v * 9, dx = D[b] - c[0], dy = D[b + 1] - c[1], dz = D[b + 2] - c[2];
        X[v] = ox + (m00 * dx + m10 * dy + m20 * dz) * s; Y[v] = oy - (m01 * dx + m11 * dy + m21 * dz) * s; Z[v] = m02 * dx + m12 * dy + m22 * dz;
      }
      pc = { scene, key, X, Y, Z };
    }
    const PX = pc.X, PY = pc.Y, PZ = pc.Z, sx = [0, 0, 0], sy = [0, 0, 0], sz = [0, 0, 0];
    let best = -Infinity, ht = -1, hl = null;
    for (let t = 0; t < nT; t++) {
      const v0 = t * 3;
      for (let k = 0; k < 3; k++) { sx[k] = PX[v0 + k]; sy[k] = PY[v0 + k]; sz[k] = PZ[v0 + k]; }
      if (x < Math.min(sx[0], sx[1], sx[2]) || x > Math.max(sx[0], sx[1], sx[2]) || y < Math.min(sy[0], sy[1], sy[2]) || y > Math.max(sy[0], sy[1], sy[2])) continue;
      const d = (sy[1] - sy[2]) * (sx[0] - sx[2]) + (sx[2] - sx[1]) * (sy[0] - sy[2]); if (Math.abs(d) < 1e-12) continue;
      const l0 = ((sy[1] - sy[2]) * (x - sx[2]) + (sx[2] - sx[1]) * (y - sy[2])) / d, l1 = ((sy[2] - sy[0]) * (x - sx[2]) + (sx[0] - sx[2]) * (y - sy[2])) / d, l2 = 1 - l0 - l1;
      if (l0 < -1e-7 || l1 < -1e-7 || l2 < -1e-7) continue;
      let z = l0 * sz[0] + l1 * sz[1] + l2 * sz[2]; if (t >= jig0) z += 0.4;   // Schablone: Tiefenvorrang wie beim Zeichnen
      if (z > best) { best = z; ht = t; hl = [l0, l1, l2]; }
    }
    if (ht < 0) return null;
    const o = ht * 27, P = [0, 1, 2].map(k => [D[o + 9 * k], D[o + 9 * k + 1], D[o + 9 * k + 2]]);
    const p = [0, 1, 2].map(i => hl[0] * P[0][i] + hl[1] * P[1][i] + hl[2] * P[2][i]);
    return { p, n: V3.norm([D[o + 3], D[o + 4], D[o + 5]]), t: ht, P, part: (scene.parts || []).find(q => ht >= q.a && ht < q.b) || null };
  }
  function measHit(x, y, noSnap) {
    const h = pickSurface(x, y); if (!h) return null;
    let p = h.p.slice(), snap = '';
    if (!noSnap && meas.snap) {
      let bd = 8;
      const tryQ = (q, kind) => { const e = scr(q), dd = Math.hypot(e.x - x, e.y - y); if (dd < bd) { bd = dd; p = q.slice(); snap = kind; } };
      h.P.forEach(q => tryQ(q, 'v'));
      for (const m of meas.list.concat(meas.cur ? [meas.cur] : [])) for (const q of m.pts) tryQ(q, 'm');
    }
    return { p, n: h.n, part: h.part, snap };
  }
  // Strahl P0 + t·d gegen die Dreiecke eines Teils (Möller–Trumbore): alle t > 1 µm aufsteigend, Doppeltreffer zusammengefasst
  function measRay(part, P0, d) {
    const D = scene.data, out = [];
    for (let k = part.a; k < part.b; k++) {
      const o = k * 27, ax = D[o], ay = D[o + 1], az = D[o + 2];
      const e1x = D[o + 9] - ax, e1y = D[o + 10] - ay, e1z = D[o + 11] - az, e2x = D[o + 18] - ax, e2y = D[o + 19] - ay, e2z = D[o + 20] - az;
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det, tx = P0[0] - ax, ty = P0[1] - ay, tz = P0[2] - az;
      const u = (tx * px + ty * py + tz * pz) * inv; if (u < -1e-9 || u > 1 + 1e-9) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < -1e-9 || u + v > 1 + 1e-9) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv; if (t > 1e-3) out.push(t);
    }
    out.sort((a, b) => a - b);
    return out.filter((t, k) => !k || t - out[k - 1] > 1e-6);
  }
  // Wandstärke: Innenseite = Richtung mit ungerader Trefferzahl (geschlossenes Teil), sonst gegen die Normale
  function measThick(h) {
    if (h.thick !== undefined) return h.thick;
    if (!h.part) return (h.thick = null);
    const n = h.n, a = measRay(h.part, h.p, n), c = measRay(h.part, h.p, V3.mul(n, -1));
    let dir = -1, hits = c;
    if ((a.length % 2 === 1 && c.length % 2 === 0) || !c.length) { dir = 1; hits = a; }
    if (!hits.length) return (h.thick = null);
    return (h.thick = { t: hits[0], q: V3.add(h.p, V3.mul(n, dir * hits[0])) });
  }
  function circle3(A, B, Cc) {
    const a = V3.sub(A, Cc), b = V3.sub(B, Cc), axb = V3.cross(a, b), n2 = V3.dot(axb, axb), la = V3.len(a), lb = V3.len(b);
    if (la < 1e-9 || lb < 1e-9 || Math.sqrt(n2) < 1e-6 * la * lb) return null;
    const c = V3.add(Cc, V3.mul(V3.cross(V3.sub(V3.mul(b, la * la), V3.mul(a, lb * lb)), axb), 1 / (2 * n2)));
    return { c, r: V3.len(V3.sub(A, c)), n: V3.norm(axb) };
  }
  function measCalc(m) {
    const P = m.pts, f = x => x.toFixed(2);
    if ((m.type === 'dist' || m.type === 'thick') && P.length >= 2) {
      const d = V3.sub(P[1], P[0]), L = V3.len(d);
      return m.type === 'thick' ? { v: L, main: f(L) + ' mm', sub: T('Wandstärke senkrecht zur Fläche') }
        : { v: L, main: f(L) + ' mm', sub: 'ΔX ' + f(d[0]) + ' · ΔY ' + f(d[1]) + ' · ΔZ ' + f(d[2]) + ' mm' };
    }
    if (m.type === 'chain' && P.length >= 2) {
      let L = 0; for (let i = 1; i < P.length; i++) L += V3.len(V3.sub(P[i], P[i - 1]));
      return { v: L, main: 'Σ ' + f(L) + ' mm', sub: (P.length - 1) + ' ' + T('Strecken') };
    }
    if (m.type === 'angle' && P.length >= 3) {
      const a = V3.sub(P[0], P[1]), b = V3.sub(P[2], P[1]), la = V3.len(a), lb = V3.len(b);
      if (!(la > 1e-9 && lb > 1e-9)) return null;
      const ang = Math.acos(clamp(V3.dot(a, b) / (la * lb), -1, 1)) * 180 / Math.PI;
      return { v: ang, main: ang.toFixed(2) + '°', sub: T('Ergänzung') + ' ' + (180 - ang).toFixed(2) + '° · ' + T('Schenkel') + ' ' + f(la) + ' / ' + f(lb) + ' mm' };
    }
    if (m.type === 'radius' && P.length >= 3) {
      const c = circle3(P[0], P[1], P[2]);
      return c ? { v: c.r, main: 'R ' + f(c.r) + ' mm', sub: 'Ø ' + f(2 * c.r) + ' mm · ' + T('Mitte') + ' X ' + f(c.c[0]) + ' Y ' + f(c.c[1]) + ' Z ' + f(c.c[2]) } : null;
    }
    return null;
  }
  function measTag(x, y, txt, colr) {
    const W = lastVP ? lastVP.w : 800, H = lastVP ? lastVP.h : 600;
    ctx.font = 'bold 12px system-ui';
    const w = ctx.measureText(txt).width + 10, h = 18, bx = Math.min(Math.max(4, x + 8), W - w - 4), by = Math.min(Math.max(4, y - h - 6), H - h - 4);
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, w, h, 4); else ctx.rect(bx, by, w, h);
    ctx.globalAlpha = 0.85; ctx.fillStyle = cssVar('--bg', '#0f1216'); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = colr; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.stroke();
    ctx.fillStyle = colr; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, bx + 5, by + h / 2 + 0.5);
  }
  function drawMeasOne(m, k, colr, preview) {
    const Wp = m.pts, Sp = Wp.map(scr), r = measCalc(m);
    const line = (a, b) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    const path = (pts, close) => { ctx.beginPath(); pts.forEach((w, i) => { const e = scr(w); if (i) ctx.lineTo(e.x, e.y); else ctx.moveTo(e.x, e.y); }); if (close) ctx.closePath(); ctx.stroke(); };
    ctx.strokeStyle = colr; ctx.lineWidth = 1.6; ctx.setLineDash(preview ? [5, 4] : []);
    let at = Sp[Sp.length - 1];
    if (m.type === 'dist' || m.type === 'thick' || m.type === 'chain') {
      for (let i = 1; i < Sp.length; i++) line(Sp[i - 1], Sp[i]);
      if (Sp.length === 2 && m.type !== 'chain') at = { x: (Sp[0].x + Sp[1].x) / 2, y: (Sp[0].y + Sp[1].y) / 2 };
      if (m.type === 'dist' && meas.axes && Wp.length === 2) {   // Achsanteile als farbiger Winkelzug
        const d = V3.sub(Wp[1], Wp[0]); let q = Wp[0].slice();
        ctx.save(); ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const [ax, cl, nm] of [[0, '#ff8080', 'ΔX'], [1, '#ffe066', 'ΔY'], [2, '#80b8ff', 'ΔZ']]) {
          if (Math.abs(d[ax]) < 1e-6) continue;
          const q2 = q.slice(); q2[ax] += d[ax];
          const a = scr(q), b = scr(q2);
          ctx.strokeStyle = cl; ctx.globalAlpha = 0.85; line(a, b);
          if (Math.hypot(b.x - a.x, b.y - a.y) > 46) { ctx.fillStyle = cl; ctx.fillText(nm + ' ' + d[ax].toFixed(1), (a.x + b.x) / 2, (a.y + b.y) / 2 - 7); }
          q = q2;
        }
        ctx.restore(); ctx.strokeStyle = colr;
      }
    } else if (m.type === 'angle') {
      if (Sp.length >= 2) line(Sp[0], Sp[1]);
      if (Sp.length >= 3) {
        line(Sp[1], Sp[2]);
        const a = V3.sub(Wp[0], Wp[1]), b = V3.sub(Wp[2], Wp[1]), la = V3.len(a), lb = V3.len(b);
        if (la > 1e-9 && lb > 1e-9) {
          const e1 = V3.mul(a, 1 / la), bp = V3.sub(b, V3.mul(e1, V3.dot(b, e1))), lbp = V3.len(bp);
          const th = Math.acos(clamp(V3.dot(a, b) / (la * lb), -1, 1)), rr = 0.3 * Math.min(la, lb);
          if (lbp > 1e-9) {
            const e2 = V3.mul(bp, 1 / lbp), arc = [];
            for (let j = 0; j <= 32; j++) { const t = th * j / 32; arc.push(V3.add(Wp[1], V3.add(V3.mul(e1, rr * Math.cos(t)), V3.mul(e2, rr * Math.sin(t))))); }
            ctx.setLineDash([]); path(arc); ctx.setLineDash(preview ? [5, 4] : []);
            at = scr(arc[16]);
          }
        }
      }
    } else if (m.type === 'radius') {
      ctx.save(); ctx.lineWidth = 1; ctx.globalAlpha = 0.6; for (let i = 1; i < Sp.length; i++) line(Sp[i - 1], Sp[i]); ctx.restore();
      const c = Wp.length >= 3 ? circle3(Wp[0], Wp[1], Wp[2]) : null;
      if (c) {
        const u = V3.norm(V3.sub(Wp[0], c.c)), v = V3.cross(c.n, u), ring = [];
        for (let j = 0; j < 72; j++) { const t = j / 72 * Math.PI * 2; ring.push(V3.add(c.c, V3.add(V3.mul(u, c.r * Math.cos(t)), V3.mul(v, c.r * Math.sin(t))))); }
        path(ring, true);
        const ce = scr(c.c);
        ctx.save(); ctx.lineWidth = 1; ctx.setLineDash([4, 3]); line(ce, Sp[1]); ctx.restore();
        ctx.beginPath(); ctx.moveTo(ce.x - 5, ce.y); ctx.lineTo(ce.x + 5, ce.y); ctx.moveTo(ce.x, ce.y - 5); ctx.lineTo(ce.x, ce.y + 5); ctx.stroke();
        at = ce;
      }
    }
    ctx.setLineDash([]);
    for (const e of Sp) { ctx.beginPath(); ctx.arc(e.x, e.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = colr; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke(); }
    if (r && at) measTag(at.x, at.y, (k ? k + ': ' : '') + r.main, colr);
  }
  function drawMeas() {
    if (!measActive() || !lastVP) return;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    meas.list.forEach((m, i) => drawMeasOne(m, i + 1, MEAS_COL, false));
    const h = meas.hover;
    if (meas.mode === 'thick' && h && !meas.cur) { const th = measThick(h); if (th) drawMeasOne({ type: 'thick', pts: [h.p, th.q] }, 0, MEAS_COL_CUR, true); }
    else if (meas.cur) drawMeasOne(h ? { type: meas.cur.type, pts: meas.cur.pts.concat([h.p]) } : meas.cur, 0, MEAS_COL_CUR, true);
    if (h) {   // Cursor: Kreis = frei, Quadrat = Netzecke, Raute = Messpunkt
      const e = scr(h.p);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath();
      if (h.snap === 'v') ctx.rect(e.x - 5, e.y - 5, 10, 10);
      else if (h.snap === 'm') { ctx.moveTo(e.x, e.y - 7); ctx.lineTo(e.x + 7, e.y); ctx.lineTo(e.x, e.y + 7); ctx.lineTo(e.x - 7, e.y); ctx.closePath(); }
      else { ctx.arc(e.x, e.y, 5, 0, Math.PI * 2); ctx.moveTo(e.x - 10, e.y); ctx.lineTo(e.x - 6, e.y); ctx.moveTo(e.x + 6, e.y); ctx.lineTo(e.x + 10, e.y); ctx.moveTo(e.x, e.y - 10); ctx.lineTo(e.x, e.y - 6); ctx.moveTo(e.x, e.y + 6); ctx.lineTo(e.x, e.y + 10); }
      ctx.stroke();
    }
    ctx.restore();
  }
  function measFinish() { const m = meas.cur; meas.cur = null; if (m && measCalc(m)) meas.list.push(m); }
  // Klick: Punkt setzen; Rechtsklick = Kette beenden bzw. letzten Punkt / letzte Messung zurücknehmen
  function measClick(x, y, right, noSnap) {
    if (right) {
      if (meas.cur && meas.cur.type === 'chain' && meas.cur.pts.length >= 2) measFinish();
      else if (meas.cur) { meas.cur.pts.pop(); if (!meas.cur.pts.length) meas.cur = null; }
      else meas.list.pop();
      buildMeasPanel(); draw(); return;
    }
    const h = measHit(x, y, noSnap); if (!h) return;
    if (meas.mode === 'thick') {
      const th = measThick(h);
      if (!th) { if (App.toast) App.toast(T('Wandstärke: keine Gegenseite gefunden (Netz an dieser Stelle offen?)')); return; }
      meas.list.push({ type: 'thick', pts: [h.p, th.q] });
    } else {
      if (!meas.cur || meas.cur.type !== meas.mode) meas.cur = { type: meas.mode, pts: [] };
      const lastP = meas.cur.pts[meas.cur.pts.length - 1];
      if (lastP && V3.len(V3.sub(lastP, h.p)) < 1e-6) return;
      meas.cur.pts.push(h.p);
      const need = MEAS_NEED[meas.cur.type];
      if (need && meas.cur.pts.length >= need) {
        if (!measCalc(meas.cur)) { meas.cur.pts.pop(); if (App.toast) App.toast(T('Die drei Punkte liegen auf einer Geraden – anderen Punkt wählen.')); }
        else measFinish();
      }
    }
    buildMeasPanel(); draw();
  }
  function measHoverAt(x, y, noSnap) {
    meas.hx = x; meas.hy = y; meas.halt = noSnap;
    if (meas.raf) return;
    const go = () => { if (!meas.raf) return; meas.raf = 0; if (!measActive()) return; meas.hover = measHit(meas.hx, meas.hy, meas.halt); draw(); measLive(); };
    meas.raf = requestAnimationFrame(go); setTimeout(go, 80);   // Rückfall, falls kein Frame kommt (verdecktes Fenster)
  }
  function measHoverOff() { if (meas.hover) { meas.hover = null; if (measActive()) { draw(); measLive(); } } }
  function measLive() {
    const el = document.getElementById('tfstMeasLive'); if (!el) return;
    const n = meas.cur ? meas.cur.pts.length : 0, md = meas.mode;
    const step = md === 'thick' ? T('Punkt auf der Fläche anklicken')
      : md === 'chain' ? T('Punkt') + ' ' + (n + 1) + (n >= 2 ? ' · ' + T('Rechtsklick oder Enter beendet die Kette') : '')
      : md === 'angle' ? [T('1. Schenkelpunkt'), T('Scheitelpunkt'), T('2. Schenkelpunkt')][n] || ''
      : T('Punkt') + ' ' + (n + 1) + ' / ' + MEAS_NEED[md] + (md === 'radius' ? ' ' + T('auf dem Bogen') : '');
    const h = meas.hover; let cur = '';
    if (h) {
      cur = 'X ' + h.p[0].toFixed(2) + ' · Y ' + h.p[1].toFixed(2) + ' · Z ' + h.p[2].toFixed(2);
      if (h.snap) cur += ' · ' + T(h.snap === 'v' ? 'Fang: Netzecke' : 'Fang: Messpunkt');
      if (md === 'thick') { const th = measThick(h); cur += '<br><b style="color:' + MEAS_COL_CUR + '">' + (th ? T('Wandstärke') + ' ' + th.t.toFixed(2) + ' mm' : T('keine Gegenseite')) + '</b>'; }
    }
    el.innerHTML = '<span style="color:' + MEAS_COL_CUR + '">' + step + '</span>' + (cur ? '<br><span style="opacity:.85">' + cur + '</span>' : '');
  }
  const measName = m => T((MEAS_MODES.find(q => q[0] === m.type) || ['', m.type])[1]);
  function setMeas(on) { meas.on = !!on; meas.cur = null; meas.hover = null; buildMeasPanel(); draw(); }
  // Bedienfeld rechts oben neben dem Ansichtswürfel
  function buildMeasPanel() {
    const el = document.getElementById('tfstMeasPanel'); if (!el) return;
    { const b = document.getElementById('tfstMeas'); if (b) b.classList.toggle('primary', meas.on); }
    el.innerHTML = '';
    if (!meas.on) { el.style.display = 'none'; if (cv) cv.style.cursor = ''; return; }
    el.style.display = ''; if (cv) cv.style.cursor = 'crosshair';
    const row = () => { const d = document.createElement('div'); d.style.cssText = 'display:flex;align-items:center;gap:6px;margin:3px 0;flex-wrap:wrap'; el.appendChild(d); return d; };
    const btn = (r, t, on, fn, title) => { const b = document.createElement('button'); b.textContent = T(t); b.className = on ? 'primary' : ''; b.style.cssText = 'flex:1 1 auto;padding:2px 6px;font-size:11px;min-width:0'; if (title) b.title = T(title); b.onclick = fn; r.appendChild(b); return b; };
    const ck = (r, t, on, fn, title) => { const l = document.createElement('label'); l.className = 'ck'; l.style.cssText = 'display:flex;align-items:center;gap:4px;white-space:nowrap'; if (title) l.title = T(title); const i = document.createElement('input'); i.type = 'checkbox'; i.checked = on; i.onchange = () => fn(i.checked); l.appendChild(i); l.appendChild(document.createTextNode(T(t))); r.appendChild(l); return l; };
    const redo = () => { buildMeasPanel(); draw(); };
    let r = row(); const hd = document.createElement('b'); hd.textContent = '📏 ' + T('Messen'); hd.style.flex = '1'; r.appendChild(hd);
    btn(r, 'aus', false, () => setMeas(false)).style.flex = '0 0 auto';
    r = row();
    const tips = { dist: 'Abstand zwischen zwei Punkten (mit ΔX / ΔY / ΔZ)', chain: 'Kette: Summe mehrerer Strecken, Rechtsklick oder Enter beendet', angle: 'Winkel aus drei Punkten, der zweite Punkt ist der Scheitel', radius: 'Radius des Kreises durch drei Punkte (z. B. Nasenradius, Übergang)', thick: 'Wandstärke: Strahl senkrecht zur Fläche nach innen bis zur Gegenseite desselben Teils (Plattendicke, Profildicke)' };
    for (const [k, t] of MEAS_MODES) btn(r, t, meas.mode === k, () => { meas.mode = k; meas.cur = null; redo(); }, tips[k]);
    r = row();
    ck(r, 'Fang', meas.snap, v => { meas.snap = v; }, 'Fang auf Netzecken und vorhandene Messpunkte im 8-px-Umkreis (Alt gedrückt = ohne Fang)');
    ck(r, 'ΔX/ΔY/ΔZ zeigen', meas.axes, v => { meas.axes = v; draw(); }, 'Beim Abstand die Achsanteile als farbigen Winkelzug einzeichnen');
    const live = document.createElement('div'); live.id = 'tfstMeasLive'; live.style.cssText = 'display:block;margin:4px 0;line-height:1.35'; el.appendChild(live);
    if (meas.list.length) {
      const lst = document.createElement('div'); lst.style.cssText = 'display:block;max-height:220px;overflow:auto;margin:4px 0;border-top:1px solid var(--line,#556);padding-top:4px';
      meas.list.forEach((m, i) => {
        const res = measCalc(m); if (!res) return;
        const it = document.createElement('div'); it.style.cssText = 'display:flex;align-items:flex-start;gap:6px;margin:3px 0';
        const tx = document.createElement('div'); tx.style.cssText = 'display:block;flex:1;min-width:0;line-height:1.3';
        tx.innerHTML = '<b style="color:' + MEAS_COL + '">' + (i + 1) + ': ' + res.main + '</b> <span style="opacity:.7">' + measName(m) + '</span><br><span style="opacity:.75;font-size:10px">' + res.sub + '</span>';
        const x = document.createElement('button'); x.textContent = '✕'; x.title = T('Messung löschen'); x.style.cssText = 'flex:0 0 auto;padding:0 6px;font-size:11px;min-width:0';
        x.onclick = () => { meas.list.splice(i, 1); redo(); };
        it.appendChild(tx); it.appendChild(x); lst.appendChild(it);
      });
      el.appendChild(lst);
      r = row();
      btn(r, '📋 Kopieren', false, () => {
        const t = meas.list.map((m, i) => { const q = measCalc(m); return q ? (i + 1) + '\t' + measName(m) + '\t' + q.main + '\t' + q.sub : ''; }).filter(Boolean).join('\n'); if (!t) return;
        const ok = () => App.toast && App.toast(T('Messwerte in die Zwischenablage kopiert'));
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, () => {}); else ok();
      }, 'Alle Messwerte als Text (tabulatorgetrennt) in die Zwischenablage');
      btn(r, 'Alle löschen', false, () => { meas.list = []; meas.cur = null; redo(); });
    }
    const hn = document.createElement('div'); hn.style.cssText = 'display:block;opacity:.6;font-size:10px;line-height:1.35;margin-top:4px';
    hn.textContent = T('Klick = Punkt auf der Oberfläche · Alt = ohne Fang · Rechtsklick = letzten Punkt bzw. letzte Messung zurücknehmen · Esc = abbrechen · Ziehen dreht weiter · Y = Höhe über dem Tisch');
    el.appendChild(hn);
    measLive();
  }

  function wire() {
    if (wired) return;
    cv = document.getElementById('cTfst'); if (!cv) return;
    wired = true;
    ctx = cv.getContext('2d');
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('mousedown', e => {
      if (!scene || !scene.n) return;
      const x0 = e.clientX, y0 = e.clientY, c0 = Object.assign({}, cam), pan = e.button !== 0 || e.shiftKey, bt = e.button, alt = e.altKey;
      let moved = false;   // Messen: Klick ohne Ziehen setzt einen Punkt, Ziehen dreht bzw. schiebt wie sonst
      const mv = ev => {
        const dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (!moved && meas.on && Math.hypot(dx, dy) < 4) return;
        moved = true;
        if (pan) { cam.px = c0.px + dx; cam.py = c0.py + dy; }
        else { cam.yaw = c0.yaw + dx * 0.008; cam.pitch = clamp(c0.pitch + dy * 0.008, -1.57, 1.57); }
        draw();
      };
      const up = () => {
        removeEventListener('mousemove', mv); removeEventListener('mouseup', up);
        if (!moved && measActive() && (bt === 0 || bt === 2)) { const r = cv.getBoundingClientRect(); measClick(x0 - r.left, y0 - r.top, bt === 2, alt); }
      };
      addEventListener('mousemove', mv); addEventListener('mouseup', up);
    });
    cv.addEventListener('mousemove', e => { if (!measActive() || e.buttons) return; const r = cv.getBoundingClientRect(); measHoverAt(e.clientX - r.left, e.clientY - r.top, e.altKey); });
    cv.addEventListener('mouseleave', () => measHoverOff());
    window.addEventListener('keydown', e => {
      if (ST().activeTab !== TAB || !meas.on || e.ctrlKey || e.metaKey || e.altKey) return;
      const tg = e.target; if (tg && (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') { if (meas.cur) meas.cur = null; else { setMeas(false); return; } buildMeasPanel(); draw(); e.preventDefault(); }
      else if (k === 'enter' && meas.cur && meas.cur.type === 'chain') { measFinish(); buildMeasPanel(); draw(); e.preventDefault(); }
    });
    cv.addEventListener('wheel', e => {
      e.preventDefault(); if (!scene || !scene.n) return;
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left - cv.clientWidth / 2, my = e.clientY - r.top - cv.clientHeight / 2;
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      cam.px = mx - (mx - cam.px) * f; cam.py = my - (my - cam.py) * f; cam.zoom *= f; draw();
    }, { passive: false });
    cv.addEventListener('dblclick', () => { if (!meas.on) home(); });   // beim Messen setzt ein Doppelklick zwei Punkte, kein Zurücksetzen
    if (window.ViewCube) {
      ViewCube.midDbl(cv, (x, y) => {
        if (!scene || !scene.n) return false;
        // Drehpunkt = Oberflächenpunkt unter dem Mauszeiger (vorderstes Dreieck); daneben geklickt → nächste Netzecke im 16-px-Umkreis
        const w = cv.clientWidth, h = cv.clientHeight, vp = viewParams(w, h), D = scene.data, hit = pickSurface(x, y);
        const pt = hit ? hit.p : ViewCube.pickNear(x, y, cb => { for (let i = 0; i < scene.n * 9; i += 9) cb(D[i], D[i + 1], D[i + 2]); }, (a, b, c) => { const q = project([a, b, c], vp, w, h); return { x: q[0], y: q[1], d: -q[2] }; }, 16);
        if (!pt) return false;
        const old = vp.c, M = vp.M, d = [pt[0] - old[0], pt[1] - old[1], pt[2] - old[2]];
        cam.px += (M[0][0] * d[0] + M[1][0] * d[1] + M[2][0] * d[2]) * vp.s;
        cam.py -= (M[0][1] * d[0] + M[1][1] * d[1] + M[2][1] * d[2]) * vp.s;
        pivot = pt; draw(); return true;
      });
      ViewCube.attach({
        canvas: () => cv, get: () => ({ yaw: cam.yaw, pitch: cam.pitch }), set: (y, p) => { cam.yaw = y; cam.pitch = p; }, redraw: draw,
        rot: ROT, k: [0.008, 0.008], active: () => ST().activeTab === TAB && !!(scene && scene.n),
        labels: { '+x': T('Hinten'), '-x': T('Vorne'), '+y': T('Oben'), '-y': T('Unten'), '+z': T('Links'), '-z': T('Rechts') },
        reset: () => resetCam()
      });
    }
    const btn = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
    btn('tfstIso', () => setCam(CAM0.yaw, CAM0.pitch));
    btn('tfstFront', () => setCam(Math.PI / 2, 0));
    btn('tfstSide', () => setCam(0, 0));
    btn('tfstTop', () => setCam(0, Math.PI / 2));
    btn('tfstStl', () => exportStands());
    btn('tfstJig', () => exportJig());
    btn('tfstDxf', () => exportDxf());
    btn('tfstMeas', () => setMeas(!meas.on));
    buildMeasPanel();
  }
  function resetCam() { Object.assign(cam, CAM0); pivot = null; }
  function home() { resetCam(); draw(); }
  function setCam(y, p) { cam.yaw = y; cam.pitch = p; cam.px = 0; cam.py = 0; cam.zoom = 1; pivot = null; draw(); }

  // =====================================================================================
  //  Info
  // =====================================================================================
  function infoHTML() {
    const el = document.getElementById('tfstInfo'); if (!el) return;
    const M = MODEL;
    if (!M || !M.ok) { el.innerHTML = '<b>' + T('Tragflächenständer') + '</b><br>' + (M && M.msg ? M.msg : T('Keine Tragfläche im Tragflächendesign.')); return; }
    const p = M.p, L = M.lift || {};
    let h = '<b>' + T('Tragflächenständer') + '</b> · ' + T('Anstellwinkel') + ' ' + fmt2(p.alpha) + '° · ' + T('An der Wurzel') + ': '
      + T('Nasenleiste') + ' ' + fmt(L.leRoot != null ? L.leRoot : p.h) + ' mm, ' + T('tiefster Punkt') + ' ' + fmt(L.lowRoot != null ? L.lowRoot : p.h) + ' mm ' + T('über dem Tisch') + '<br>';
    M.stands.forEach(s => {
      if (!s.ok) return;
      h += T('Stütze') + ' ' + (s.i + 1) + ' (z = ' + fmt(s.z) + ' mm, 2×): ' + fmt(s.len) + ' × ' + fmt(s.hMax) + ' × ' + fmt(p.t) + ' mm, '
        + T('tiefster Punkt') + ' ' + fmt(s.yLow) + ' mm, ' + T('Nasenleiste') + ' ' + fmt(s.capF + p.dropF) + ' mm, ' + T('Endleiste') + ' ' + fmt(s.capR + p.dropR) + ' mm'
        + (s.stop ? ', ' + T('Anschlag') + ' ' + fmt(s.stop.yS) + ' mm' : '')
        + (s.foot ? ', ' + T('Fuß') + ' ' + fmt(s.foot.x1 - s.foot.x0) + ' × ' + fmt(s.foot.W) + ' mm' : '')
        + (s.lite && s.lite.length ? ', ' + s.lite.length + ' ' + T('Erleichterungslöcher') + ' / ' + s.lite.struts + ' ' + T('Streben') + ' (−' + Math.round(s.litePct) + ' % ' + T('Material') + ')' : '') + '<br>';
    });
    if (!M.stands.length) h += T('Keine Stützen.') + '<br>';
    const J = M.jig;
    if (J && J.ok) {
      h += T('Bohrschablone') + ': ' + T(J.src.from === 'stegh' ? 'Wurzelrippe aus Steghöhen' : 'Wurzelprofil (ohne Steghöhen keine Ausnehmungen)') + ', '
        + T('Platte') + ' ' + fmt(J.umax - J.umin) + ' × ' + fmt(J.hMax) + ' × ' + fmt(p.jt) + ' mm, ' + T('Abstand') + ' ' + fmt(p.dF) + ' / ' + fmt(J.dR) + ' mm'
        + (Math.abs(J.phi) > 1e-4 ? ' (' + T('Platten je') + ' ' + fmt2(J.phi / D2R) + '° ' + T('schräg') + ')' : '')
        + (Math.abs(J.src.zT - J.src.zL) > 1e-3 || J.src.zL > 1e-3 ? ', ' + T('Wurzel eingerückt') + ' ' + fmt(J.src.zL) + ' / ' + fmt(J.src.zT) + ' mm (' + fmt2(J.src.skew) + '°)' : '') + '<br>';
      h += T('Grundplatte') + ' ' + fmt(J.base.Xr - J.base.Xf) + ' × ' + fmt(J.base.W) + ' × ' + fmt(p.bT) + ' mm'
        + (J.base.lite && J.base.lite.length ? ' (' + J.base.lite.length + ' ' + T('Erleichterungslöcher') + ' / ' + J.base.struts + ' ' + T('Streben') + (J.base.two ? ' ' + T('je Hälfte, mit Längsgurt') : '') + ', −' + Math.round(J.base.litePct) + ' % ' + T('Material') + ')' : '');
      h += J.used.length ? ' · ' + T('Bohrungen') + ': ' + J.used.map(q => q.name + (q.round && q.d ? ' Ø ' + fmt2(q.d + 2 * p.jClr) : '')).join(', ') : ' · ' + T('keine Bohrungen');
      if (J.lite && J.lite.length) h += ' · ' + J.lite.length + ' ' + T('Erleichterungslöcher') + ' / ' + J.lite.struts + ' ' + T('Streben') + ' ' + T('je Platte') + ' (−' + Math.round(J.litePct) + ' % ' + T('Material') + ')';
      if (p.jAxis && (Math.abs(J.shU) > 0.005 || Math.abs(J.shY) > 0.005)) h += '<br>' + T('Bohrrichtung') + ' = ' + T('quer zum Rumpf (90° zur Flugrichtung)')
        + (J.main && Math.abs(J.main.dir[1]) > 1e-4 ? ', ' + T('geneigt wie die Hülse') + ' ' + fmt2(Math.atan(J.main.dir[1]) / D2R) + '°' : '')
        + ': ' + T('Außenseite versetzt um') + ' ' + fmt2(J.shU) + ' mm ' + T('längs') + ', ' + fmt2(J.shY) + ' mm ' + T('hoch');
    }
    M.warn.forEach(w => { h += '<br><span style="color:#ffb454">' + w + '</span>'; });
    el.innerHTML = h;
  }

  function model() { return MODEL && MODEL.ok ? MODEL : (MODEL = build()); }
  function refresh() {
    try { MODEL = build(); } catch (e) { console.error(e); MODEL = { ok: false, msg: T('Fehler beim Aufbau:') + ' ' + (e && e.message ? e.message : e), stands: [], warn: [] }; }
    makeScene(); visBar(); infoHTML(); draw();
  }
  function show() { wire(); refresh(); }
  function resize() { draw(); }

  // =====================================================================================
  //  Seitenleiste
  // =====================================================================================
  function tfstSidebar(side) {
    const { grp, hint, numRow, boolRow, selectRow, subhead } = App;
    if (!grp || !numRow) return;
    const c = C(), p = params(c), G = geo();
    const RD = () => { if (ST().activeTab === TAB) refresh(); };
    const RB = () => { if (App.buildSidebar) App.buildSidebar(); RD(); };
    const N = (body, label, key, o) => numRow(body, label, () => c[key], v => { c[key] = v; RD(); }, Object.assign({ step: 1, norender: true }, o || {}));
    const SEL = (body, label, opts, key, rebuild, h) => selectRow(body, label, opts, () => String(c[key]), v => { c[key] = v; rebuild ? RB() : RD(); }, h);
    const BOOL = (body, label, key, rebuild, h) => boolRow(body, label, () => !!c[key], v => { c[key] = v; rebuild ? RB() : RD(); }, h);
    const button = (body, txt, fn, title) => {
      const row = document.createElement('div'); row.className = 'row';
      const b = document.createElement('button'); b.type = 'button'; b.textContent = T(txt); b.style.cssText = 'flex:1'; if (title) b.title = T(title);
      b.onclick = fn; row.appendChild(b); body.appendChild(row); return b;
    };

    // ---- Lage ----
    const g1 = grp('Lage der Tragfläche', true, TAB, { key: 'tfstPos' });
    hint(g1.body, 'Anstellwinkel und Höhe gelten für Stützen und Bohrschablone. Die Profile kommen aus dem Tragflächendesign (Schnitt in Flugrichtung mit Schränkung und V-Form), bei mehreren Tragflächen aus der aktiven.');
    N(g1.body, 'Anstellwinkel (°)', 'alpha', { step: 0.1, hint: 'Winkel der Wurzelsehne gegen die Tischplatte, + = Nase hoch.' });
    if (c.hRef === 'root') c.hRef = 'le';   // alter Wert: Nasenleiste der Wurzel
    SEL(g1.body, 'Höhe bezogen auf', [['le', 'Nasenleiste an der Wurzel'], ['low', 'Tiefster Punkt der Wurzel']], 'hRef', true,
      'Die Höhe gilt innen an der Wurzel (bei schräger Wurzel an der Wurzelrippe). Jede Stütze passt ihre Höhe ihrer Lage in Spannweitenrichtung an (V-Form, Schränkung), die Bohrschablone deckt sich mit der Wurzel.');
    N(g1.body, p.hRef === 'le' ? 'Höhe der Nasenleiste an der Wurzel über dem Tisch (mm)' : 'Höhe des tiefsten Punkts der Wurzel über dem Tisch (mm)', 'h', { step: 1, min: 0 });

    // ---- Stützen ----
    const g2 = grp('Stützen', true, TAB, { key: 'tfstStands' });
    hint(g2.body, 'Je Stelle eine Stütze (links und rechts je eine). Die Oberkante ist die Profilunterseite an dieser Stelle.');
    c.stands.forEach((s, i) => numRow(g2.body, T('Stütze') + ' ' + (i + 1) + ': ' + T('Abstand ab Wurzel (mm)'), () => s.z, v => { s.z = v; RD(); },
      { step: 5, min: 0, norender: true }));
    if (G) hint(g2.body, T('Spannweite dieser Tragfläche') + ': ' + fmt(G.L) + ' mm');
    button(g2.body, '+ Stütze', () => { const l = c.stands[c.stands.length - 1]; c.stands.push({ z: Math.round(l ? (+l.z || 0) + 200 : 100) }); RB(); });
    if (c.stands.length) button(g2.body, 'Letzte Stütze entfernen', () => { c.stands.pop(); if (c.sel === 's' + c.stands.length) c.sel = c.stands.length ? 's0' : 'jig'; RB(); });
    N(g2.body, 'Plattendicke (mm)', 't', { step: 1, min: 1 });
    N(g2.body, 'Spiel / Polster zur Unterseite (mm)', 'pad', { step: 0.1, min: 0, hint: 'Abstand senkrecht zur Profiloberfläche, z. B. für Filz, Moosgummi oder Folie.' });
    N(g2.body, 'Überstand vor der Nasenleiste (mm)', 'extF', { step: 1, min: 0 });
    N(g2.body, 'Überstand hinter der Endleiste (mm)', 'extR', { step: 1, min: 0 });
    N(g2.body, 'Auflage vorne tiefer als Nasenleiste (mm)', 'dropF', { step: 1, min: 0, hint: '0 = die Auflage umfasst die Nase bis auf Höhe der Nasenleiste. Größer = niedrigerer Rand vorne.' });
    N(g2.body, 'Auflage hinten tiefer als Endleiste (mm)', 'dropR', { step: 1, min: 0 });
    BOOL(g2.body, 'Anschlag hinter der Endleiste', 'stopR', true, 'Ein Klotz hinter der Endleiste, der über die Endleiste hinausragt: Die Tragfläche kann nicht nach hinten rutschen (bei Anstellwinkel liegt die Endleiste tiefer, die Fläche drängt nach hinten).');
    if (p.stopR) {
      N(g2.body, 'Anschlag: Höhe über der Endleiste (mm)', 'stopH', { step: 0.5, min: 0.5 });
      N(g2.body, 'Anschlag: Stärke (mm)', 'stopW', { step: 0.5, min: 1, hint: 'In Flugrichtung; reicht der Überstand hinten nicht, wird die Stütze entsprechend länger.' });
      N(g2.body, 'Anschlag: Abstand zur Endleiste (mm)', 'stopGap', { step: 0.1, min: 0, hint: 'Mindestens das Spiel zur Unterseite.' });
    }

    // ---- Haken ----
    const g3 = grp('Haken für Gummiringe', false, TAB, { key: 'tfstHook' });
    BOOL(g3.body, 'Haken vorne und hinten', 'hook', true, 'Arm nach außen mit einer Nase nach unten: Der Gummiring liegt unter dem Arm, die Nase hält ihn, beide Stränge laufen neben der Platte nach oben über die Tragfläche.');
    if (p.hook) {
      N(g3.body, 'Oberkante des Arms über dem Tisch (mm)', 'hookY', { step: 1, min: 1, hint: 'Höchstens so hoch wie die Auflage an der Stirnseite.' });
      N(g3.body, 'Armlänge (mm)', 'hookL', { step: 1, min: 3 });
      N(g3.body, 'Armdicke (mm)', 'hookT', { step: 0.5, min: 0.5 });
      N(g3.body, 'Nase nach unten (mm)', 'hookH', { step: 0.5, min: 0 });
      N(g3.body, 'Breite der Nase (mm)', 'hookW', { step: 0.5, min: 1, hint: 'Lichte Weite für den Gummi = Armlänge − Breite der Nase.' });
    }

    // ---- Fuß ----
    const g4 = grp('Fußplatte zum Einstecken', false, TAB, { key: 'tfstFoot' });
    BOOL(g4.body, 'Fußplatte mit Schlitz', 'foot', true, 'Die Stütze wird flach gedruckt (ohne Stützstruktur) und in den Schlitz der Fußplatte gesteckt — sie steht dann sicher auf dem Tisch.');
    if (p.foot) {
      N(g4.body, 'Breite der Fußplatte (mm)', 'footW', { step: 5, min: 5 });
      N(g4.body, 'Dicke der Fußplatte (mm)', 'footT', { step: 0.5, min: 0.5 });
      N(g4.body, 'Rand vorne und hinten (mm)', 'footM', { step: 1, min: 2 });
      N(g4.body, 'Spiel im Schlitz je Seite (mm)', 'footClr', { step: 0.05, min: 0 });
    }

    // ---- Bohrschablone ----
    const g5 = grp('Bohrschablone für den Rumpfanschluss', false, TAB, { key: 'tfstJig' });
    BOOL(g5.body, 'Bohrschablone', 'jig', true, 'Zwei Platten mit der Wurzelrippe (originale Profilkontur, Hülse und Bohrungen als Bohrführung), unten über eine Grundplatte verbunden. Der Rumpf kommt dazwischen, dann wird durch die Platten gebohrt.');
    if (p.jig) {
      const src = G ? rootSource(G) : null;
      hint(g5.body, src && src.from === 'stegh' ? 'Wurzel aus „Steghöhen“: Wurzelrippe in ihrer Ebene (auch schräg) mit Hülse und Bohrungen.' : 'Ohne Einstellungen im Reiter „Steghöhen“ nur das Wurzelprofil ohne Ausnehmungen.');
      hint(g5.body, 'Höhe und Anstellwinkel kommen aus „Lage der Tragfläche“: Die Platten decken sich genau mit der Wurzel der Tragfläche auf den Stützen.');
      N(g5.body, 'Plattendicke (mm)', 'jt', { step: 1, min: 1, hint: 'Dicke Platten führen den Bohrer besser.' });
      // Schräge Wurzel wie in Steghöhen (dieselben Werte, wenn Steghöhen vorhanden ist)
      if (G) {
        subhead(g5.body, 'Wurzel schräg');
        const sk = skewSrc() || {}, r1 = v => Math.round(v * 10) / 10, NM = { step: 1, min: 0, norender: true, enter: true };
        const after = () => { if (App.StegRippen && App.StegRippen.regenNow) App.StegRippen.regenNow(); RB(); };
        numRow(g5.body, 'Nase eingerückt (mm)', () => r1(+sk.rootInL || 0), v => { skewTarget().rootInL = clamp(v, 0, G.L); after(); }, NM);
        numRow(g5.body, 'Endleiste eingerückt (mm)', () => r1(+sk.rootInT || 0), v => { skewTarget().rootInT = clamp(v, 0, G.L); after(); }, NM);
        numRow(g5.body, 'Wurzelrippe schräg (°)', () => (src ? Math.round(src.skew * 100) / 100 : 0), v => { setSkewAngle(G, skewTarget(), v); after(); }, { step: 0.5, min: -45, max: 45, norender: true, enter: true });
        hint(g5.body, stegOn()
          ? 'Gleiche Werte wie in „Steghöhen“ → Wurzelrippe: Wurzelrippe der Tragfläche und Schablone bleiben deckungsgleich. Um so viel rücken Nase und Endleiste nach außen; verschieden = schräg (z. B. Rumpf mit Einschnürung). Winkel: + = Endleiste bleibt, − = Nase bleibt.'
          : 'Um so viel rücken Nase und Endleiste der Wurzel nach außen; verschieden = schräg (z. B. Rumpf mit Einschnürung). Winkel: + = Endleiste bleibt, − = Nase bleibt.');
      }
      N(g5.body, 'Lichter Abstand vorne (mm)', 'dF', { step: 1, min: 0, hint: 'Innen zwischen den Platten an der Nasenleiste = Rumpfbreite dort.' });
      BOOL(g5.body, 'Abstand hinten aus der Schräge', 'dRAuto', true, 'Hinten = vorne + 2 × (Endleiste eingerückt − Nase eingerückt): Die Platten stehen genau wie die schräge Wurzel. Aus = Abstand hinten frei.');
      if (!p.dRAuto) N(g5.body, 'Lichter Abstand hinten (mm)', 'dR', { step: 1, min: 0, hint: 'Innen zwischen den Platten an der Endleiste.' });
      else if (src) hint(g5.body, T('Abstand hinten') + ': ' + fmt(Math.max(0, p.dF + 2 * (src.zT - src.zL))) + ' mm');
      N(g5.body, 'Steg unter dem Profil von (% der Länge)', 'legA', { step: 5, min: 0, max: 95, hint: 'Bereich, in dem die Platte bis zum Tisch reicht. Davor und dahinter bleibt die Profilunterseite sichtbar.' });
      N(g5.body, 'Steg bis (% der Länge)', 'legB', { step: 5, min: 5, max: 100 });
      subhead(g5.body, 'Grundplatte');
      N(g5.body, 'Dicke (mm)', 'bT', { step: 0.5, min: 0.5 });
      N(g5.body, 'Rand um die Platten (mm)', 'bOv', { step: 1, min: 1 });
      if (p.liteB) hint(g5.body, 'Fachwerk in der Grundplatte: siehe „Erleichterungslöcher (3D-Druck)“.');
      else {
        BOOL(g5.body, 'Fenster in der Grundplatte', 'bWin', true, 'Spart Material; der Rumpf liegt dann nur auf dem Rand auf.');
        if (p.bWin) N(g5.body, 'Randbreite um das Fenster (mm)', 'bWinM', { step: 1, min: 3 });
      }
      subhead(g5.body, 'Bohrungen');
      if (src && src.cuts.length) src.cuts.forEach(q => boolRow(g5.body, q.name, () => !c.jOff[q.id], v => { if (v) delete c.jOff[q.id]; else c.jOff[q.id] = true; RD(); }));
      else hint(g5.body, 'Keine Ausnehmungen (Hülse bzw. Bohrungen in „Steghöhen“ → Wurzelrippe festlegen).');
      if (src && src.cuts.some(q => q.huel && q.wall > 0))
        SEL(g5.body, 'Ausschnitt der Steckung', [['outer', 'Hülse (außen)'], ['inner', 'Steckung (innen)']], 'jStk', false,
          'Hülse: Ausschnitt wie in der Wurzelrippe (Außenmaß der Hülse). Steckung: Ausschnitt um die Wandstärke der Hülse kleiner, z. B. wenn nur der Verbinder durch den Rumpf geht.');
      N(g5.body, 'Spiel der Bohrungen je Seite (mm)', 'jClr', { step: 0.05, hint: 'Gedruckte Löcher werden meist etwas kleiner; negativ = enger.' });
      BOOL(g5.body, 'Quer zum Rumpf bohren (90° zur Flugrichtung)', 'jAxis', false, 'Die Bohrungen laufen rechtwinklig zur Flugrichtung, mit der Neigung der Hülse aus der V-Form, auch wenn die Platten schräg stehen. An der Innenseite (am Rumpf) liegen sie genau wie die Ausnehmungen der Wurzelrippe; die Außenseite der Platte ist dafür leicht versetzt. Aus = senkrecht zur Platte.');
      SEL(g5.body, 'STL-Ausgabe', [['parts', 'Einzelteile flach (Platten + Grundplatte mit Schlitzen)'], ['one', 'Zusammengebaut (ein Druckteil)']], 'jOut', true);
      if (p.jOut === 'parts') N(g5.body, 'Spiel der Schlitze je Seite (mm)', 'slotClr', { step: 0.05, min: 0 });
    }

    // ---- Erleichterungslöcher ----
    const gL = grp('Erleichterungslöcher (3D-Druck)', false, TAB, { key: 'tfstLite' });
    hint(gL.body, 'Fachwerk aus schrägen Streben (etwa 55°) zwischen vollem Rand oben und unten: Die Last von der Auflage läuft über die Streben in den Boden, die Haken hängen an vollen Enden. Spart viel Material und Druckzeit. Stützen und Einzelteile werden flach gedruckt; die zusammengebaute Schablone steht beim Druck, ihre Löcher bekommen deshalb ein 45°-Dach (ohne Stützstruktur druckbar).');
    // je Teil: Anzahl der Streben (0 = automatisch) und Stegbreite; die tatsächliche Zahl steht oben in der Info
    let eHint = true;
    const partRows = (on, kn, ke, nHint) => {
      if (!on) return;
      N(gL.body, 'Anzahl Streben (0 = automatisch)', kn, { step: 2, min: 0, hint: nHint });
      N(gL.body, 'Stegbreite der Streben (mm)', ke, { step: 0.5, min: 1.2, hint: eHint ? 'Ein Vielfaches der Linienbreite druckt am saubersten (z. B. 4,8 mm = 12 × 0,4 mm).' : undefined });
      eHint = false;
    };
    BOOL(gL.body, 'In den Stützen', 'liteS', true);
    partRows(p.liteS, 'liteSn', 'liteSe', 'Je Stütze, gerade Zahl (zwei Streben je Feld). Automatisch sind die Streben etwa 55° geneigt; die tatsächliche Zahl steht oben in der Info. Zu viele Streben lassen keinen Platz mehr für Löcher.');
    BOOL(gL.body, 'Im Steg der Bohrschablone', 'liteJ', true, 'Nur im Steg unter dem Profil; das Profil mit den Bohrungen bleibt voll als Bohrführung.');
    partRows(p.liteJ, 'liteJn', 'liteJe', 'Je Platte, gerade Zahl (zwei Streben je Feld); 0 = automatisch etwa 55°.');
    BOOL(gL.body, 'In der Grundplatte der Bohrschablone', 'liteB', true, 'Fachwerk zwischen den beiden Platten, voller Rand ringsum und entlang der Platten bzw. Schlitze; bei breitem Rumpf mit Längsgurt in der Mitte. Die Grundplatte liegt beim Druck flach. Ersetzt das Fenster in der Grundplatte.');
    partRows(p.liteB, 'liteBn', 'liteBe', 'Gerade Zahl (zwei Streben je Feld); mit Längsgurt (ab rund 90 mm lichter Breite) je Hälfte. 0 = automatisch etwa 55°.');
    if (p.liteS || p.liteJ || p.liteB) {
      subhead(gL.body, 'Für alle Teile');
      N(gL.body, 'Voller Rand (mm)', 'liteM', { step: 0.5, min: 1.2, hint: 'Entlang der Kontur (Auflage, Boden über dem Schlitz, Enden mit den Haken) und unter den Bohrungen.' });
      N(gL.body, 'Eckenradius (mm)', 'liteR', { step: 0.5, min: 0, hint: 'Gerundete Ecken mindern Kerbspannungen und drucken sauberer.' });
    }

    // ---- Ansicht und Export ----
    const g6 = grp('Ansicht und Export', false, TAB, { key: 'tfstOut' });
    BOOL(g6.body, 'Zeichnung unten links', 'showInset', false);
    const opts = c.stands.map((s, i) => ['s' + i, T('Stütze') + ' ' + (i + 1)]); if (p.jig) opts.push(['jig', 'Bohrschablone']);
    if (opts.length) { if (!opts.some(o => o[0] === c.sel)) c.sel = opts[0][0]; SEL(g6.body, 'Teil in der Zeichnung', opts, 'sel', false); }
    button(g6.body, 'Stützen als STL …', () => exportStands(), 'Jede Stütze flach liegend (für den 3D-Druck ohne Stützstruktur), dazu die Fußplatten. Je Stütze zwei drucken (links und rechts).');
    if (p.jig) button(g6.body, 'Bohrschablone als STL …', () => exportJig());
    button(g6.body, 'Konturen als DXF …', () => exportDxf(), 'Alle Umrisse (Stützen, Fußplatten, Schablonenplatte, Grundplatte) zum Lasern oder Fräsen; je Teil eine Ebene.');
    if (App.cadImportDxfText) button(g6.body, 'In CAD übernehmen', () => toCad(), 'Die Konturen in den Reiter „CAD-Bearbeitung“ laden (ersetzt dessen Inhalt nach Rückfrage).');
    [g1, g2, g3, g4, g5, gL, g6].forEach(g => side.appendChild(g.g));   // jede neue Gruppe hier eintragen, sonst erscheint sie nicht
  }

  App.tfstSidebar = tfstSidebar;
  window.Staender = { show, refresh, resize, _test: { build, params, DEF, geo, standGeo, jigGeo, prism, checkMesh, envChains, valsAt, lowEnv, standFiles, jigFiles, dxfText, sceneParts, rootSource, boundaryLoops, skewPlane, setSkewAngle, liteHoles, wingLift, faceMaps, pickSurface, stkList, measClick, scr: q => scr(q), setMeas, meas, measCalc, pivot: () => pivot,
    look: (pt, yaw, pitch, zoom) => { pivot = pt; Object.assign(cam, { yaw, pitch, zoom, px: 0, py: 0 }); draw(); } } };
})();
