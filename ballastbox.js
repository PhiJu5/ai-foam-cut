/* ballastbox.js — Reiter „Ballastbox" (Menü Tragflächen, nach Verbinderform; id ballast, Feature „ballastbox").
 *
 *   Parametrische Ballastbox für den 3D-Druck in drei Bauarten (cfg.type):
 *     lip    : wird bei montiertem Modell von vorn auf den Verbinder geschoben und mit Klettbändern
 *              festgezurrt (Vorbild: rc-network.de, Thema „Ballastbox", Beitrag 4) — Beschreibung unten.
 *     sleeve : Kasten mit Fächern und quer liegender Hülse um den Verbinder, Klemmschraube vorn in der
 *              Hülse (Vorbild: dasselbe Thema, Beitrag 1) — geomMount().
 *     block  : Durchsteckblock, Verbinder quer durch einen Kanal hinten (bJoin 'rear') oder mittig zwischen
 *              den Reihen (bJoin 'mid', Ballast darüber und darunter), Bohrungen/Fächer von vorn,
 *              Klemmschrauben von vorn; Deckel mit Aussparungen für die Köpfe statt einzeln
 *              verschraubter Ballaststücke (Art handelsüblicher Ballastblöcke) — geomMount().
 *   Muttern der Klemmschrauben sitzen am Kanal (vom Kanal aus eingelegt): Die Schraube drückt den Verbinder
 *   nach hinten, die Gegenkraft schiebt die Mutter nach vorn — gegen das Material, nicht aus der Tasche.
 *   Bauart lip im Einzelnen:
 *     Kasten   : Fächer für die Ballaststücke — Anzahl nebeneinander (Spannweite) × übereinander ×
 *                hintereinander; die Stücke werden von vorn eingeschoben (Länge in Flugrichtung).
 *                Breite, Tiefe und Höhe des Kastens folgen aus Stückmaß, Spiel, Trennwänden und Wandstärke.
 *     Aufnahme : Oberseite des Kastens = Auflage des Verbinders (folgt der V-Form, Knick in der Mitte),
 *                hinten eine Anschlagwand, oben eine Lippe über dem Verbinder → C-Profil, nach vorn offen.
 *                lipX > 0: Anschlagwand/Lippe/Verbinder um lipX nach vorn; die Lippe läuft als Platte nach
 *                hinten bis x = 0 (Standard, Druck auf der Rückseite bleibt stützenfrei, Klettband liegt auf)
 *                oder nur lipBk mm weit (0 = keine) → dann Druck auf der Seite liegend (g.side): Profil in y
 *                extrudiert. Kasten und Deckel bleiben wie sonst (Absatz rundum, vier gleich lange Ränder); der Absatz
 *                an der Druckbettseite hängt dann frei → Hinweis: kleine Stütze oder Deckel übergestülpt.
 *     Bänder   : Schlaufen auf der Lippe; die Klettbänder laufen in Flugrichtung hindurch, vorn über
 *                Verbinder und Deckel nach unten, unter dem Kasten zurück und hinten wieder hoch.
 *     Deckel   : Stülpdeckel mit Rand — bündig auf einem Absatz am Kasten oder außen übergestülpt.
 *   Koordinaten: x in Flugrichtung (0 = Rückseite, Öffnung vorn), y Spannweite (0 = Knick), z oben (0 = Boden).
 *   Netz      : Säulen-Netzbauer colMesh() — Blöcke über einem Rechteckraster (Grundriss x/y), Unter- und
 *               Oberkante je Block a + b·|y| (V-Form, linear in jedem Rasterstreifen). Vereinigung je Säule,
 *               senkrechte Flächen mit allen Zwischenhöhen der Gitterpunkte → wasserdicht, ohne T-Stöße.
 *   Daten     : state.cfg.ballastBox (je Projekt, Ansicht in .view → kein Strg+Z-Schritt).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const TAB = 'ballast', KEY = 'ballastBox', D2R = Math.PI / 180;
  // Ballastwerkstoffe: Name, Dichte (g/cm³), Anzeigefarbe
  const MATS = {
    brass: ['Messing', 8.5, [204, 168, 82]], lead: ['Blei', 11.3, [128, 133, 146]], steel: ['Stahl', 7.85, [168, 173, 181]],
    tungsten: ['Wolfram-Schwermetall', 18, [104, 107, 118]], copper: ['Kupfer', 8.9, [198, 120, 82]], own: ['Eigene Dichte', 0, [196, 160, 92]]
  };
  const DEF = {
    jW: 14,                 // Verbinder: Breite in Flugrichtung (Sehnenrichtung, mm)
    jH: 20,                 // Verbinder: Höhe (Dickenrichtung, mm)
    vDeg: 0,                // Knickwinkel gesamt = V-Form links + rechts (°)
    jClr: 0.3,              // Spiel über dem Verbinder (Auflage → Lippe, mm)
    pShape: 'rect',         // Ballaststück 'rect' Quader | 'round' Rundmaterial
    pL: 65, pW: 20, pH: 12, // Länge (Flugrichtung), Breite (Spannweite), Höhe (mm)
    pD: 12,                 // Durchmesser Rundmaterial (mm)
    nY: 3, nZ: 3, nX: 1,    // Anzahl nebeneinander / übereinander / hintereinander
    pClr: 0.25,             // Spiel um jedes Stück je Seite (mm)
    mat: 'brass', rho: 8.5, // Ballastwerkstoff, eigene Dichte (g/cm³)
    t: 2,                   // Wandstärke außen (Boden, Seiten, Rückwand, Decke an der dünnsten Stelle)
    cells: true, tD: 1.2,   // Trennwände zwischen den Stücken, Stärke
    tJ: 2.5,                // Aufschieben: Lippe über dem Verbinder (bis 2026-11-26 auch Anschlagwand); Block: Wand Kanal ↔ Ballast
    tWl: 2.5,               // Aufschieben: Stärke der senkrechten Anschlagwand (Altstände: = tJ, siehe C())
    lipL: 8,                // Lippe: so weit greift sie über den Verbinder (mm, 0 = keine)
    strapN: 2, strapW: 20, strapT: 3, strapPost: 2, strapPos: 0,   // Klettband-Schlaufen: Anzahl, Bandbreite, Schlitzhöhe, Stegstärke, Abstand Mitte–Mitte (0 = außen bündig)
    lid: true, lidFit: 'flush', lidT: 1.6, lidWall: 1, lidRim: 6, lidClr: 0.2,   // Deckel: Platte, Randstärke, Randhöhe, Spiel
    rhoP: 1.24,             // Dichte Druckwerkstoff (g/cm³, PLA 1,24 · PETG 1,27)
    printPos: 'print',      // Export: 'print' Druckposition (Kasten auf der Rückseite) | 'asm' wie eingebaut
    pick: '', vPick: 'root',
    // ---- Bauart (seit 2026-11-26) ----
    type: 'lip',            // 'lip' Aufschieben mit Lippe (Beitrag 4) | 'sleeve' Kasten mit Hülse (Beitrag 1) | 'block' Durchsteckblock
    arr: 'grid',            // Rundmaterial: 'grid' Raster | 'stagger' versetzt (dichter)
    outline: 'rect',        // Durchsteckblock mit Rundmaterial: 'rect' Kasten | 'lobed' gerundet um die Bohrungen
    slvL: 40, slvT: 3, slvX: 0,   // Hülse: Länge (Spannweite), Wandstärke, Versatz in Flugrichtung
    sScrN: 1, bScrN: 2,     // Klemmschrauben: Anzahl Hülse / Block
    scrM: 'M5', scrFix: 'nut', insD: 0, lidHoleD: 0,   // Größe, Befestigung (nut | insert | tap), Bohrung Einsatz, Aussparung im Deckel (0 = auto)
    jzOff: 0,               // Block: Verbinder höher (+) / tiefer (−) als die Mitte des Ballasts
    // ---- seit 2026-11-26 (2) ----
    lipX: 0,                // Aufschieben: Anschlagwand, Lippe und Verbinder nach vorn versetzt (mm)
    lipBkFull: true, lipBk: 0,   // … Lippe hinter der Anschlagwand: bis zur Kastenkante | eigene Länge (0 = keine)
    bJoin: 'rear'           // Block: Verbinder 'rear' hinter dem Ballast | 'mid' zwischen den Reihen
  };
  // Schrauben: Durchgang, Kernloch, Mutter (Schlüsselweite, Höhe), Gewindeeinsatz (Bohrung, Länge), Kopf-Ø (ISO 4762)
  const SCR = {
    M3: { d: 3, clr: 3.4, core: 2.5, af: 5.5, nh: 2.4, ins: 4.0, insL: 5.7, head: 5.5 },
    M4: { d: 4, clr: 4.5, core: 3.3, af: 7, nh: 3.2, ins: 5.6, insL: 8.1, head: 7 },
    M5: { d: 5, clr: 5.5, core: 4.2, af: 8, nh: 4, ins: 6.4, insL: 9.5, head: 8.5 },
    M6: { d: 6, clr: 6.6, core: 5, af: 10, nh: 5, ins: 8, insL: 12.7, head: 10 }
  };
  const VIEW0 = { explode: 15, joiner: true, ballast: true, sec: true };
  const ST = () => App.state;
  function C() {
    const cfg = ST().cfg; let c = cfg[KEY];
    if (!c || typeof c !== 'object') c = cfg[KEY] = {};
    if (!('tWl' in c) && 'tJ' in c) c.tWl = c.tJ;   // Altstand: Anschlagwand so stark wie die Lippe
    for (const k in DEF) if (!(k in c)) c[k] = DEF[k];
    if (!c.view || typeof c.view !== 'object') c.view = {};
    for (const k in VIEW0) if (!(k in c.view)) c.view[k] = VIEW0[k];
    return c;
  }
  const num = (v, d) => { v = +v; return isFinite(v) ? v : d; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const R6 = z => Math.round(z * 1e6) / 1e6;
  const fmt = v => String(Math.round(v * 100) / 100).replace('.', ',');
  const fmt1 = v => String(Math.round(v * 10) / 10).replace('.', ',');

  function params(c) {
    const p = {};
    p.jW = clamp(num(c.jW, 14), 1, 300); p.jH = clamp(num(c.jH, 20), 1, 300);
    p.vDeg = clamp(Math.abs(num(c.vDeg, 0)), 0, 40); p.jClr = clamp(num(c.jClr, 0.3), 0, 10);
    p.round = c.pShape === 'round';
    p.pL = clamp(num(c.pL, 65), 1, 1000); p.pW = clamp(num(c.pW, 20), 0.5, 500); p.pH = clamp(num(c.pH, 12), 0.5, 500); p.pD = clamp(num(c.pD, 12), 0.5, 500);
    p.nY = clamp(Math.round(num(c.nY, 3)), 1, 30); p.nZ = clamp(Math.round(num(c.nZ, 3)), 1, 30); p.nX = clamp(Math.round(num(c.nX, 1)), 1, 20);
    p.pClr = clamp(num(c.pClr, 0.25), 0, 5);
    p.mat = MATS[c.mat] ? c.mat : 'brass';
    p.rho = p.mat === 'own' ? clamp(num(c.rho, 8.5), 0.1, 30) : MATS[p.mat][1];
    p.t = clamp(num(c.t, 2), 0.4, 20); p.cells = c.cells !== false; p.tD = clamp(num(c.tD, 1.2), 0.4, 20);
    p.tJ = clamp(num(c.tJ, 2.5), 0.4, 20); p.lipL = clamp(num(c.lipL, 8), 0, 300); p.tWl = clamp(num(c.tWl, p.tJ), 0.4, 20);
    p.strapN = [0, 1, 2].indexOf(Math.round(num(c.strapN, 2))) >= 0 ? Math.round(num(c.strapN, 2)) : 2;
    p.strapW = clamp(num(c.strapW, 20), 3, 200); p.strapT = clamp(num(c.strapT, 3), 0.5, 20);
    p.strapPost = clamp(num(c.strapPost, 2), 0.6, 20); p.strapPos = clamp(num(c.strapPos, 0), 0, 2000);
    p.lid = c.lid !== false; p.lidFit = c.lidFit === 'over' ? 'over' : 'flush';
    p.lidT = clamp(num(c.lidT, 1.6), 0.4, 20); p.lidWall = clamp(num(c.lidWall, 1), 0.4, 20);
    p.lidRim = clamp(num(c.lidRim, 6), 1, 200); p.lidClr = clamp(num(c.lidClr, 0.2), 0, 3);
    p.rhoP = clamp(num(c.rhoP, 1.24), 0.1, 20);
    p.printPos = c.printPos === 'asm' ? 'asm' : 'print';
    p.type = c.type === 'sleeve' || c.type === 'block' ? c.type : 'lip';
    p.arr = c.arr === 'stagger' ? 'stagger' : 'grid';
    p.outline = c.outline === 'lobed' ? 'lobed' : 'rect';
    p.slvL = clamp(num(c.slvL, 40), 5, 1000); p.slvT = clamp(num(c.slvT, 3), 0.8, 30); p.slvX = clamp(num(c.slvX, 0), -500, 500);
    p.sScrN = Math.round(num(c.sScrN, 1)) === 2 ? 2 : 1; p.bScrN = Math.round(num(c.bScrN, 2)) === 1 ? 1 : 2;
    p.scrM = SCR[c.scrM] ? c.scrM : 'M5';
    p.scrFix = c.scrFix === 'insert' || c.scrFix === 'tap' ? c.scrFix : 'nut';
    p.insD = clamp(num(c.insD, 0), 0, 30); p.lidHoleD = clamp(num(c.lidHoleD, 0), 0, 60);
    p.jzOff = clamp(num(c.jzOff, 0), -500, 500);
    p.lipX = clamp(num(c.lipX, 0), 0, 1000);
    p.lipBkFull = c.lipBkFull !== false; p.lipBk = clamp(num(c.lipBk, 0), 0, 1000);
    p.bJoin = c.bJoin === 'mid' ? 'mid' : 'rear';
    return p;
  }

  // =====================================================================================
  //  Säulen-Netzbauer: Blöcke { x0, x1, y0, y1, lo, hi } mit lo/hi = { a, b } → z = a + b·|y|.
  //  Raster aus allen Blockgrenzen (+ y = 0 für den V-Knick); je Rasterzelle die Vereinigung der
  //  z-Intervalle (Werte an beiden y-Enden des Streifens). Flächen:
  //   · waagrecht/schräg  : Ober- und Unterseite jedes Intervalls (eben, linear in y),
  //   · senkrecht x = konst: Differenz der Nachbarzellen (Trapeze, Seiten mit allen Gitterhöhen),
  //   · senkrecht y = konst: dito (Rechtecke).
  //  Hohlräume: Blöcke mit v = true werden je Zelle von der Vereinigung abgezogen (Bohrungen, Kanal).
  //  Damit sich Intervallgrenzen innerhalb eines Streifens nie kreuzen, kommen alle Kreuzungsstellen
  //  zweier Grenzfunktionen als zusätzliche Rasterlinien dazu (crossYs).
  // =====================================================================================
  const EPS = 1e-5;
  function crossYs(blocks) {
    const F = [], out = [];
    blocks.forEach(b => { F.push([b.lo, b.y0, b.y1], [b.hi, b.y0, b.y1]); });
    for (let i = 0; i < F.length; i++) for (let j = i + 1; j < F.length; j++) {
      const A = F[i], B = F[j], ya = Math.max(A[1], B[1]), yb = Math.min(A[2], B[2]);
      if (yb - ya < 1e-7) continue;
      const db = A[0].b - B[0].b; if (Math.abs(db) < 1e-12) continue;
      const u = (B[0].a - A[0].a) / db;   // |y| der Kreuzung von a1 + b1·|y| und a2 + b2·|y|
      if (!(u > 1e-7)) continue;
      if (u > ya + 1e-7 && u < yb - 1e-7) out.push(u);
      if (-u > ya + 1e-7 && -u < yb - 1e-7) out.push(-u);
    }
    return out;
  }
  function ivMerge(L) {
    L.sort((p, q) => (p.l[0] + p.l[1]) - (q.l[0] + q.l[1]));
    const M = [];
    L.forEach(s => {
      const c = M[M.length - 1];
      if (c && s.l[0] <= c.h[0] + EPS && s.l[1] <= c.h[1] + EPS) c.h = [Math.max(c.h[0], s.h[0]), Math.max(c.h[1], s.h[1])];
      else M.push({ l: s.l.slice(), h: s.h.slice() });
    });
    return M;
  }
  // Teile der Intervalle A außerhalb von B (je Ende getrennt; ohne Kreuzungen exakt)
  function ivDiff(A, B) {
    let out = A.map(s => ({ l: s.l.slice(), h: s.h.slice() }));
    B.forEach(b => {
      const nxt = [];
      out.forEach(s => {
        const lo = { l: s.l.slice(), h: [0, 1].map(e => Math.min(s.h[e], Math.max(s.l[e], b.l[e]))) };
        const up = { l: [0, 1].map(e => Math.max(s.l[e], Math.min(s.h[e], b.h[e]))), h: s.h.slice() };
        [lo, up].forEach(q => { if (q.h[0] - q.l[0] > 1e-6 || q.h[1] - q.l[1] > 1e-6) nxt.push(q); });
      });
      out = nxt;
    });
    return out;
  }
  // Rasterwerte, die näher als GTOL beieinander liegen, zusammenfassen (0 bleibt 0); Höhen je Rasterlinie
  // auf ZSNAP fangen. So gibt es keine Fast-Doppelpunkte (3MF verschmilzt Punkte auf 1e-5 mm).
  const GTOL = 1e-4, ZSNAP = 2e-3;
  function cluster(vals) {
    const s = vals.slice().sort((a, b) => a - b), G = [];
    s.forEach(v => { const L = G[G.length - 1]; if (L && v - L.last <= GTOL) { L.last = v; if (v === 0) L.rep = 0; } else G.push({ rep: v, last: v }); });
    return G.map(g => g.rep);
  }
  function nearest(G, v) {
    let lo = 0, hi = G.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (G[m] < v) lo = m + 1; else hi = m; }
    return lo > 0 && Math.abs(G[lo - 1] - v) < Math.abs(G[lo] - v) ? G[lo - 1] : G[lo];
  }
  // z = c + m·y auf [u0, u1] → { a, b } mit z = a + b·|y| (Streifen liegt ganz auf einer Seite von y = 0)
  const linF = (u0, u1, z0, z1) => { const m = (z1 - z0) / (u1 - u0), c = z0 - m * u0; return u1 <= 1e-12 ? { a: c, b: -m } : { a: c, b: m }; };
  function colMesh(blocks0) {
    const snap = new Map();
    const ev = (f, y) => {
      const z = R6(f.a + f.b * Math.abs(y));
      let L = snap.get(y); if (!L) snap.set(y, L = []);
      for (let k = 0; k < L.length; k++) if (Math.abs(L[k] - z) <= ZSNAP) return L[k];
      L.push(z); return z;
    };
    const xsA = [], ysA = [];
    blocks0.forEach(b => { xsA.push(R6(b.x0), R6(b.x1)); ysA.push(R6(b.y0), R6(b.y1)); });
    if (ysA.length && Math.min.apply(null, ysA) < 0 && Math.max.apply(null, ysA) > 0) ysA.push(0);
    const X = cluster(xsA), Yb = cluster(ysA);
    // Blockgrenzen aufs Raster; Vieleck-Streifen behalten dabei ihre Eckhöhen (keine Stufen)
    const blocks = blocks0.map(b => {
      const y0 = nearest(Yb, R6(b.y0)), y1 = nearest(Yb, R6(b.y1));
      let lo = b.lo, hi = b.hi;
      if (b.pz && (y0 !== b.y0 || y1 !== b.y1) && y1 > y0) { lo = linF(y0, y1, b.pz[0], b.pz[1]); hi = linF(y0, y1, b.pz[2], b.pz[3]); }
      return { x0: nearest(X, R6(b.x0)), x1: nearest(X, R6(b.x1)), y0, y1, lo, hi, v: b.v };
    }).filter(b => b.x1 > b.x0 && b.y1 > b.y0);
    // Kreuzungsstellen als weitere Rasterlinien (nicht näher als GTOL an vorhandenen)
    const Y = Yb.slice();
    cluster(crossYs(blocks).map(R6)).forEach(y => {
      let lo = 0, hi = Y.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (Y[m] < y) lo = m + 1; else hi = m; }
      if ((lo < Y.length && Y[lo] - y <= GTOL) || (lo > 0 && y - Y[lo - 1] <= GTOL)) return;
      Y.splice(lo, 0, y);
    });
    const nx = Math.max(0, X.length - 1), ny = Math.max(0, Y.length - 1), cols = [];
    for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) {
      const ya = Y[i], yb = Y[i + 1], xa = X[j], xb = X[j + 1], L = [], Vd = [];
      blocks.forEach(b => {
        if (b.x0 > xa + 1e-7 || b.x1 < xb - 1e-7 || b.y0 > ya + 1e-7 || b.y1 < yb - 1e-7) return;
        const l = [ev(b.lo, ya), ev(b.lo, yb)], h = [ev(b.hi, ya), ev(b.hi, yb)];
        if (h[0] - l[0] < 1e-6 && h[1] - l[1] < 1e-6) return;
        (b.v ? Vd : L).push({ l, h: [Math.max(h[0], l[0]), Math.max(h[1], l[1])] });
      });
      let M = ivMerge(L);
      if (Vd.length && M.length) M = ivDiff(M, ivMerge(Vd)).sort((p, q) => (p.l[0] + p.l[1]) - (q.l[0] + q.l[1]));
      cols.push(M);
    }
    const cell = (i, j) => (i < 0 || j < 0 || i >= ny || j >= nx) ? [] : cols[i * nx + j];
    // Alle Höhen am Gitterpunkt (X[j], Y[i]) aus den bis zu vier anliegenden Zellen
    const levC = new Map();
    function lev(j, i) {
      const k = j * (ny + 1) + i; let a = levC.get(k); if (a) return a;
      a = [];
      [[i - 1, j - 1, 1], [i - 1, j, 1], [i, j - 1, 0], [i, j, 0]].forEach(q => cell(q[0], q[1]).forEach(s => a.push(s.l[q[2]], s.h[q[2]])));
      a.sort((p, q) => p - q);
      const b = []; a.forEach(z => { if (!b.length || z - b[b.length - 1] > 1e-6) b.push(z); });
      levC.set(k, b); return b;
    }
    const colz = (j, i, lo, hi) => { const L = [lo]; lev(j, i).forEach(z => { if (z > lo + 1e-6 && z < hi - 1e-6) L.push(z); }); if (hi > lo + 1e-6) L.push(hi); return L; };
    const pos = [];
    function tri(P, Q, S, n) {   // Dreieck mit Sollnormale n (Umlauf wird passend gedreht)
      const ux = Q[0] - P[0], uy = Q[1] - P[1], uz = Q[2] - P[2], wx = S[0] - P[0], wy = S[1] - P[1], wz = S[2] - P[2];
      const d = (uy * wz - uz * wy) * n[0] + (uz * wx - ux * wz) * n[1] + (ux * wy - uy * wx) * n[2];
      if (Math.abs(d) < 1e-12) return;
      if (d > 0) pos.push(P[0], P[1], P[2], Q[0], Q[1], Q[2], S[0], S[1], S[2]);
      else pos.push(P[0], P[1], P[2], S[0], S[1], S[2], Q[0], Q[1], Q[2]);
    }
    function zip(LA, LB, PA, PB, n) {   // Fläche zwischen zwei senkrechten Kanten mit allen Zwischenhöhen
      let a = 0, b = 0;
      while (a < LA.length - 1 || b < LB.length - 1) {
        if (a >= LA.length - 1 || (b < LB.length - 1 && LB[b + 1] <= LA[a + 1])) { tri(PA(LA[a]), PB(LB[b]), PB(LB[b + 1]), n); b++; }
        else { tri(PA(LA[a]), PB(LB[b]), PA(LA[a + 1]), n); a++; }
      }
    }
    const diff = ivDiff;
    // Ober-/Unterseiten
    for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) cell(i, j).forEach(s => {
      const xa = X[j], xb = X[j + 1], ya = Y[i], yb = Y[i + 1];
      const t0 = [xa, ya, s.h[0]], t1 = [xb, ya, s.h[0]], t2 = [xb, yb, s.h[1]], t3 = [xa, yb, s.h[1]];
      tri(t0, t1, t2, [0, 0, 1]); tri(t0, t2, t3, [0, 0, 1]);
      const b0 = [xa, ya, s.l[0]], b1 = [xb, ya, s.l[0]], b2 = [xb, yb, s.l[1]], b3 = [xa, yb, s.l[1]];
      tri(b0, b1, b2, [0, 0, -1]); tri(b0, b2, b3, [0, 0, -1]);
    });
    // Senkrechte Flächen x = X[j]
    for (let j = 0; j <= nx; j++) for (let i = 0; i < ny; i++) {
      const A = cell(i, j - 1), B = cell(i, j);
      if (!A.length && !B.length) continue;
      const x = X[j], ya = Y[i], yb = Y[i + 1];
      const face = (s, n) => zip(colz(j, i, s.l[0], s.h[0]), colz(j, i + 1, s.l[1], s.h[1]), z => [x, ya, z], z => [x, yb, z], n);
      diff(A, B).forEach(s => face(s, [1, 0, 0]));
      diff(B, A).forEach(s => face(s, [-1, 0, 0]));
    }
    // Senkrechte Flächen y = Y[i]
    for (let i = 0; i <= ny; i++) for (let j = 0; j < nx; j++) {
      const A = cell(i - 1, j).map(s => ({ l: [s.l[1], s.l[1]], h: [s.h[1], s.h[1]] }));
      const B = cell(i, j).map(s => ({ l: [s.l[0], s.l[0]], h: [s.h[0], s.h[0]] }));
      if (!A.length && !B.length) continue;
      const y = Y[i], xa = X[j], xb = X[j + 1];
      const face = (s, n) => zip(colz(j, i, s.l[0], s.h[0]), colz(j + 1, i, s.l[0], s.h[0]), z => [xa, y, z], z => [xb, y, z], n);
      diff(A, B).forEach(s => face(s, [0, 1, 0]));
      diff(B, A).forEach(s => face(s, [0, -1, 0]));
    }
    // Volumen direkt aus den Säulen (Prüfwert für das Netz)
    let vol = 0;
    for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) cell(i, j).forEach(s => {
      vol += (X[j + 1] - X[j]) * (Y[i + 1] - Y[i]) * ((s.h[0] - s.l[0]) + (s.h[1] - s.l[1])) / 2;
    });
    return { pos: new Float32Array(pos), X, Y, nx, ny, cols, cell, vol };
  }
  // Schnitt x = konst. → Vierecke [[y, z] × 4] (Vorderansicht)
  function secX(M, x) {
    const out = []; if (!M) return out;
    let j = -1; for (let k = 0; k < M.nx; k++) if (x >= M.X[k] - 1e-9 && x < M.X[k + 1]) { j = k; break; }
    if (j < 0) return out;
    for (let i = 0; i < M.ny; i++) M.cell(i, j).forEach(s => out.push([[M.Y[i], s.l[0]], [M.Y[i + 1], s.l[1]], [M.Y[i + 1], s.h[1]], [M.Y[i], s.h[0]]]));
    return out;
  }
  // Schnitt y = konst. → Rechtecke [x0, x1, z0, z1] (Seitenansicht)
  function secY(M, y) {
    const out = []; if (!M) return out;
    let i = -1; for (let k = 0; k < M.ny; k++) if (y >= M.Y[k] - 1e-9 && y < M.Y[k + 1]) { i = k; break; }
    if (i < 0) return out;
    const f = (y - M.Y[i]) / (M.Y[i + 1] - M.Y[i]);
    for (let j = 0; j < M.nx; j++) M.cell(i, j).forEach(s => out.push([M.X[j], M.X[j + 1], s.l[0] + f * (s.l[1] - s.l[0]), s.h[0] + f * (s.h[1] - s.h[0])]));
    return out;
  }

  // Anzeige-Körper (nur Darstellung): Sechsflach aus 8 Ecken (Reihenfolge wie Quader), Zylinder längs x
  function hexTris(out, P) {
    const F = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
    F.forEach(f => { const a = P[f[0]], b = P[f[1]], c = P[f[2]], d = P[f[3]]; out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]); });
  }
  function cuboid(out, x0, x1, y0, y1, z0, z1) {
    hexTris(out, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
  }
  function cylX(out, x0, x1, yc, zc, r) {
    const N = 28;
    for (let k = 0; k < N; k++) {
      const a0 = 2 * Math.PI * k / N, a1 = 2 * Math.PI * (k + 1) / N;
      const y0 = yc + r * Math.cos(a0), z0 = zc + r * Math.sin(a0), y1 = yc + r * Math.cos(a1), z1 = zc + r * Math.sin(a1);
      out.push(x0, y0, z0, x1, y0, z0, x1, y1, z1, x0, y0, z0, x1, y1, z1, x0, y1, z1);
      out.push(x0, yc, zc, x0, y1, z1, x0, y0, z0, x1, yc, zc, x1, y0, z0, x1, y1, z1);
    }
  }

  // =====================================================================================
  //  Querschnitte (y, z) als Prismen längs x: Rechteck (Grenzen auch in V-Form a + b·|y|) oder
  //  konvexes Vieleck (Streifen zwischen den Eck-y, je Streifen Unter-/Oberkante linear).
  // =====================================================================================
  const fz = z => typeof z === 'number' ? { a: z, b: 0 } : z;
  const rectP = (y0, y1, z0, z1) => ({ k: 'rect', y0, y1, z0, z1 });
  // Regelmäßiges N-Eck um (yc, zc) mit Innenkreis r; Ecken bei (2k+1)·π/N → senkrechte Kanten links/rechts
  function ngon(yc, zc, r, N) {
    const R = r / Math.cos(Math.PI / N), pts = [];
    for (let k = 0; k < N; k++) { const a = (2 * k + 1) * Math.PI / N; pts.push([yc + R * Math.cos(a), zc + R * Math.sin(a)]); }
    return { k: 'poly', pts };
  }
  function addPrim(L, x0, x1, q, vd) {
    if (!q || !(x1 - x0 > 1e-6)) return;
    if (q.k === 'rect') { if (q.y1 - q.y0 > 1e-6) L.push({ x0, x1, y0: q.y0, y1: q.y1, lo: fz(q.z0), hi: fz(q.z1), v: !!vd }); return; }
    const P = q.pts.map(r => [R6(r[0]), r[1]]), n = P.length;
    const ys = Array.from(new Set(P.map(r => r[0]))).sort((a, b) => a - b);
    const span = y => {   // z-Bereich der senkrechten Linie y (konvex)
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < n; k++) {
        const A = P[k], B = P[(k + 1) % n], ya = Math.min(A[0], B[0]), yb = Math.max(A[0], B[0]);
        if (y < ya - 1e-9 || y > yb + 1e-9) continue;
        if (yb - ya < 1e-12) { lo = Math.min(lo, A[1], B[1]); hi = Math.max(hi, A[1], B[1]); continue; }
        const z = A[1] + (B[1] - A[1]) * (y - A[0]) / (B[0] - A[0]);
        lo = Math.min(lo, z); hi = Math.max(hi, z);
      }
      return [lo, hi];
    };
    for (let k = 0; k + 1 < ys.length; k++) {
      const ya = ys[k], yb = ys[k + 1];
      if (yb - ya < 1e-9) continue;
      const sa = span(ya), sb = span(yb);
      const parts = ya < -1e-12 && yb > 1e-12 ? [[ya, 0, sa, span(0)], [0, yb, span(0), sb]] : [[ya, yb, sa, sb]];
      parts.forEach(q2 => L.push({ x0, x1, y0: q2[0], y1: q2[1], lo: linF(q2[0], q2[1], q2[2][0], q2[3][0]), hi: linF(q2[0], q2[1], q2[2][1], q2[3][1]),
        pz: [q2[2][0], q2[3][0], q2[2][1], q2[3][1]], v: !!vd }));
    }
  }
  function convexHull(P) {   // Andrew: gegen den Uhrzeigersinn, ohne kollineare Punkte
    const pts = P.map(q => q.slice()).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) return pts;
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    pts.forEach(q => { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-9) lo.pop(); lo.push(q); });
    for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 1e-9) up.pop(); up.push(q); }
    lo.pop(); up.pop();
    return lo.concat(up);
  }
  const inConvex = (P, y, z) => { for (let k = 0; k < P.length; k++) { const A = P[k], B = P[(k + 1) % P.length]; if ((B[0] - A[0]) * (z - A[1]) - (B[1] - A[1]) * (y - A[0]) < -1e-9) return false; } return true; };

  function geometry(p) { return p.type === 'lip' ? geomLip(p) : geomMount(p); }

  // =====================================================================================
  //  Bauarten „Hülse“ (Kasten mit Halter-Hülse und Klemmschraube, Beitrag 1) und „Durchsteckblock“
  //  (Verbinder läuft quer durch einen Block, Klemmschrauben von vorn; Art FW-Models). Beide mit
  //  Stülpdeckel statt einzeln verschraubter Ballaststücke.
  //   Hülse : Kasten mit Fächern (Öffnung vorn), oben eine Hülse quer (Spannweite) um den Verbinder,
  //           Klemmschraube vorn in der Hülsenwand drückt den Verbinder gegen die hintere Wand.
  //           Druck wie eingebaut (Boden unten); bündiger Deckel mit Absatz rundum (unten hängt er frei → Hinweis).
  //   Block : hinten Gehäuse mit Querkanal für den Verbinder, davor die Bohrungen/Fächer (Öffnung
  //           vorn). Schrauben laufen von vorn längs x bis zum Kanal (zwischen den Bohrungen oder
  //           außen in Augen); der Deckel bekommt Aussparungen für die Köpfe. Druck auf der Rückseite.
  //   Beide: Durchgang für den Verbinder gerade, bei V-Form um Lh · tan(V/2) höher (zum Durchschieben).
  // =====================================================================================
  function geomMount(p, LhIn) {
    const warn = [], V = (a, b) => ({ a, b: b || 0 }), sleeve = p.type === 'sleeve', t = p.t;
    const eW = p.round ? p.pD : p.pW, eH = p.round ? p.pD : p.pH;
    const cells = p.cells, roundB = p.round && cells;
    const cw = (cells ? eW : p.nY * eW) + 2 * p.pClr, ch = (cells ? eH : p.nZ * eH) + 2 * p.pClr, tD = cells ? p.tD : 0;
    let stag = roundB && p.arr === 'stagger';
    if (stag && (p.nY < 2 || p.nZ < 2)) { stag = false; warn.push(T('Versetzte Anordnung braucht mindestens 2 nebeneinander und 2 übereinander — Raster verwendet.')); }
    const lobed = !sleeve && roundB && p.outline === 'lobed';
    const py = cw + tD, pz = stag ? py * Math.sqrt(3) / 2 : ch + tD;
    const nCy = cells ? p.nY : 1, nCz = cells ? p.nZ : 1;
    const Wi = (nCy - 1) * py + cw, Hi = (nCz - 1) * pz + ch, Di = p.nX * p.pL + 2 * p.pClr;
    const phi = p.vDeg / 2 * D2R, tv = Math.tan(phi), jHv = p.jH / Math.cos(phi), cl = p.jClr, chJ = jHv + 2 * cl;
    // Durchgang gerade (nicht in V-Form), sonst lässt sich ein V-Verbinder nicht durchschieben: Höhe =
    // Verbinder + Spiel + halbe Kanallänge · tan(V/2). In der Endlage liegt der Knick unten in der Mitte auf,
    // die Enden oben an den Kanalenden; beim Durchschieben kippt der Verbinder von flach in die V-Lage
    // (nachgerechnet: Scratchpad vpass.cjs). Kanallänge = Hülse bzw. ganze Blockbreite samt Augen.
    const Lh = sleeve ? p.slvL / 2 : Math.max(LhIn || 0, Wi / 2 + t), chH = chJ + Lh * tv;
    // Klemmschraube: Durchgang, Gewindezone (Mutter / Einsatz / Kernloch), wirksamer Platzbedarf
    const S = SCR[p.scrM], fix = p.scrFix;
    const rClr = S.clr / 2, rThr = fix === 'nut' ? S.af / 2 + 0.15 : fix === 'insert' ? (p.insD > 0 ? p.insD : S.ins) / 2 : S.core / 2;
    const nThr = fix === 'nut' ? 6 : 16;
    const rEff = Math.max(rClr, fix === 'nut' ? rThr / Math.cos(Math.PI / 6) : rThr);
    const LtStd = fix === 'nut' ? S.nh + 0.3 : fix === 'insert' ? S.insL + 0.5 : Math.max(1.5 * S.d, 6);
    const holeR = (p.lidHoleD > 0 ? p.lidHoleD : S.head + 2) / 2;

    // Block mit Verbinder zwischen den Reihen: unten nLo Reihen (bei ungerader Anzahl die zusätzliche),
    // darüber der Kanal (Wand tJ zu beiden Seiten, oben um die V-Form-Steigung bis zum Rand der Bohrungen
    // zusätzlich Luft), darüber nUp Reihen
    const midReq = !sleeve && p.bJoin === 'mid', mid = midReq && p.nZ >= 2;
    if (midReq && !mid) warn.push(T('Verbinder zwischen den Reihen braucht mindestens 2 Stücke übereinander — Verbinder liegt hinter dem Ballast.'));
    const nLo = mid ? Math.ceil(p.nZ / 2) : p.nZ, nUp = p.nZ - nLo;
    // Höhenlage: Block → Verbindermitte auf Höhe der Ballastmitte (+ Versatz), alles ab z = 0
    const zC0 = sleeve || mid ? t : Math.max(t, t + chJ / 2 - Hi / 2 - p.jzOff);
    let chLoM = 0, zUp = 0, HiA = Hi;
    if (mid) {
      const loTop = cells ? zC0 + (nLo - 1) * pz + ch : zC0 + nLo * eH + 2 * p.pClr;
      chLoM = loTop + p.tJ;
      zUp = chLoM + chH + p.tJ;
      HiA = (cells ? zUp + (nCz - nLo - 1) * pz + ch : zUp + nUp * eH + 2 * p.pClr) - zC0;
    }
    const zTopB = zC0 + HiA + t, hw = Wi / 2 + t, Rl = cw / 2 + t;
    const cen = [];   // Mitten der Fächer bzw. Bohrungen [y, z, halbe Höhe]
    if (cells || !mid) {
      for (let iz = 0; iz < nCz; iz++) {
        const odd = stag && iz % 2 === 1, n = odd ? nCy - 1 : nCy, off = odd ? py / 2 : 0;
        const zb = mid && iz >= nLo ? zUp + (iz - nLo) * pz : zC0 + iz * pz;
        for (let iy = 0; iy < n; iy++) cen.push([-Wi / 2 + cw / 2 + off + iy * py, zb + ch / 2, ch / 2]);
      }
    } else {   // ohne Trennwände: je ein Raum unter und über dem Verbinder
      const hLo = nLo * eH + 2 * p.pClr, hUp = nUp * eH + 2 * p.pClr;
      cen.push([0, zC0 + hLo / 2, hLo / 2], [0, zUp + hUp / 2, hUp / 2]);
    }
    let hull = null, bar = null;
    if (lobed && cen.length > 1) {
      const H = convexHull(cen.map(c => [c[0], c[1]]));
      if (H.length >= 3) hull = { k: 'poly', pts: H };
      else {   // eine Reihe bzw. Spalte: Steg zwischen den Rundungen
        const ysC = cen.map(c => c[0]), zsC = cen.map(c => c[1]), hh = Rl * 0.6;
        const y0 = Math.min.apply(null, ysC), y1 = Math.max.apply(null, ysC), z0 = Math.min.apply(null, zsC), z1 = Math.max.apply(null, zsC);
        bar = y1 - y0 >= z1 - z0 ? rectP(y0, y1, z0 - hh, z0 + hh) : rectP(y0 - hh, y0 + hh, z0, z1);
      }
    }
    const ears = [];   // Augen für außen liegende Schrauben { y, z, r }
    // Außenkontur des Kastens/Blocks (vorderer Teil), um d versetzt
    const cont = (d, keepBottom) => {
      const out = [];
      if (lobed) { cen.forEach(c => out.push(ngon(c[0], c[1], Rl + d, 48))); if (hull) out.push(hull); if (bar) out.push(bar); }
      else out.push(rectP(-hw - d, hw + d, keepBottom ? zC0 - t : zC0 - t - d, zTopB + d));
      ears.forEach(e => { out.push(ngon(e.y, e.z, e.r + d, 24)); out.push(rectP(Math.min(0, e.y), Math.max(0, e.y), e.z - e.r - d, e.z + e.r + d)); });
      return out;
    };
    const inCont = (y, z) => {
      if (!lobed) return Math.abs(y) <= hw + 1e-9 && z >= zC0 - t - 1e-9 && z <= zTopB + 1e-9;
      if (cen.some(c => Math.hypot(y - c[0], z - c[1]) <= Rl + 1e-9)) return true;
      if (hull && inConvex(hull.pts, y, z)) return true;
      return !!(bar && y >= bar.y0 && y <= bar.y1 && z >= bar.z0 && z <= bar.z1);
    };

    // Deckel
    let fit = p.lid ? p.lidFit : 'none';
    const inset = p.lidWall + p.lidClr;
    if (fit === 'flush' && t - inset < 0.6 - 1e-9) {
      fit = 'over';
      warn.push(T('Wand zu dünn für den bündigen Deckel (Wandstärke ≥ Randstärke + Spiel + 0,6 mm) — Deckel wird außen übergestülpt.'));
    }
    const sd = fit === 'none' ? 0 : Math.min(p.lidRim, Math.max(1, Di - 1)), sdF = fit === 'flush' ? sd : 0;

    // Lage in Flugrichtung
    let D, xb0, cx0, cx1, xh1 = 0, sx0 = 0, sx1 = 0, wF = 0, Lt = LtStd;
    if (sleeve) {
      D = t + Di; xb0 = t;
      const xm = t + Di / 2 + p.slvX;
      cx0 = xm - p.jW / 2 - cl; cx1 = xm + p.jW / 2 + cl;
      if (fix === 'tap') { wF = Math.max(p.slvT, LtStd); Lt = wF; } else wF = Math.max(p.slvT, LtStd + 1.2);
      sx0 = cx0 - p.slvT; sx1 = cx1 + wF;
      const xLim = D - (fit === 'none' ? 0 : sd + (fit === 'over' ? p.lidClr : 0));
      if (sx0 < -1e-6 || sx1 > xLim + 1e-6) warn.push(T('Die Hülse ragt hinten über den Kasten oder vorn in den Deckelrand — Versatz prüfen.'));
    } else if (mid) {   // Kanal mittig über der Ballastlänge, vorn Platz für Gewinde + Durchgang
      xb0 = t; D = t + Di;
      const w2 = p.jW / 2 + cl, xm = t + Di / 2;
      cx1 = Math.min(xm + w2, D - Lt - 1.5); cx0 = cx1 - 2 * w2;
      if (cx0 < t - 1e-9) {
        cx0 = t; cx1 = t + 2 * w2; D = cx1 + Lt + 1.5;
        warn.push(T('Ballast zu kurz für Kanal und Gewinde — der Block wird länger als die Ballaststücke.'));
      }
    } else {
      cx0 = t; cx1 = t + p.jW + 2 * cl; xh1 = cx1 + p.tJ; xb0 = xh1; D = xh1 + Di;
    }
    const zF = zTopB;
    const chLo0 = sleeve ? zF : mid ? chLoM : zC0 + Hi / 2 + p.jzOff - chJ / 2;   // Kanal-Unterkante (eben)
    const zMid = y => chLo0 + chJ / 2 + Math.abs(y) * tv;            // Verbindermitte in der Endlage an der Stelle y
    if (chJ / 2 - rClr - 0.5 < 0) warn.push(T('Verbinder zu niedrig für diese Schraubengröße.'));

    // Klemmschrauben
    const scr = [];
    if (sleeve) {
      const ysL = p.sScrN === 1 ? [0] : [-p.slvL / 4, p.slvL / 4];
      let bad = false;
      ysL.forEach(y => {
        const z = zMid(y);
        if (z - rEff < zC0 + Hi + 0.6 - 1e-9 || z + rEff > chLo0 + chH + p.slvT - 0.6 + 1e-9) bad = true;
        scr.push({ y, z, xa: cx1, xb: sx1, lt: Lt });
      });
      if (bad) warn.push(T('Mutter bzw. Einsatz passt nicht ganz in die Hülsenwand — Hülsenwand stärker oder kleinere Schraube wählen.'));
    } else {
      const marg = 1.2 + (fit === 'flush' ? inset : 0);
      const boreR = (eW / 2 + p.pClr) / Math.cos(Math.PI / 48);
      const voidR = roundB ? null : cen.map(c => [c[0] - cw / 2, c[0] + cw / 2, c[1] - c[2], c[1] + c[2]]);
      const clearOf = (y, z, r) => roundB ? cen.every(c => Math.hypot(y - c[0], z - c[1]) >= boreR + r - 1e-9)
        : voidR.every(q => Math.hypot(Math.max(q[0] - y, 0, y - q[1]), Math.max(q[2] - z, 0, z - q[3])) >= r - 1e-9);
      const fits = (y, z) => {
        if (!inCont(y, z) || !clearOf(y, z, rEff + 1.2)) return false;
        for (let k = 0; k < 24; k++) { const a = 2 * Math.PI * k / 24; if (!inCont(y + (rEff + marg) * Math.cos(a), z + (rEff + marg) * Math.sin(a))) return false; }
        return true;
      };
      const zr = Math.max(0, chJ / 2 - rClr - 0.5);
      const zC = y => { const zc = zMid(y), o = [zc]; for (let dz = 0.25; dz <= zr + 1e-9; dz += 0.25) o.push(zc - dz, zc + dz); return o; };
      const find = yl => { for (const y of yl) for (const z of zC(y)) if (fits(y, z)) return [y, z]; return null; };
      const yMax = lobed ? Math.max.apply(null, cen.map(c => Math.abs(c[0]))) + Rl : hw;
      const yl = [];
      if (p.bScrN === 2) { for (let y = yMax - rEff - marg; y >= rEff + 0.6 - 1e-9; y -= 0.25) yl.push(y); }
      else for (let y = 0; y <= yMax; y += 0.25) yl.push(y);
      const f = find(yl);
      if (f) {
        if (p.bScrN === 2) scr.push({ y: -f[0], z: f[1] }, { y: f[0], z: f[1] }); else scr.push({ y: f[0], z: f[1] });
      } else {   // kein Platz zwischen den Bohrungen → Augen außen am Block
        const ye = yMax + rEff + 0.6, rb = rEff + Math.max(t, inset + 0.6, 1.6);
        (p.bScrN === 2 ? [-ye, ye] : [ye]).forEach(y => { ears.push({ y, z: zMid(y), r: rb }); scr.push({ y, z: zMid(y) }); });
      }
      scr.forEach(s => { s.xa = cx1; s.xb = D; s.lt = Lt; });
    }

    // Ausdehnung des vorderen Teils (für Gehäuse und Bemaßung)
    let yExt = lobed ? Math.max.apply(null, cen.map(c => Math.abs(c[0]))) + Rl : hw;
    let zMinB = lobed ? Math.min.apply(null, cen.map(c => c[1])) - Rl : zC0 - t, zMaxB = lobed ? Math.max.apply(null, cen.map(c => c[1])) + Rl : zTopB;
    ears.forEach(e => { yExt = Math.max(yExt, Math.abs(e.y) + e.r); zMinB = Math.min(zMinB, e.z - e.r); zMaxB = Math.max(zMaxB, e.z + e.r); });

    // Augen außen verlängern den Kanal → mit der neuen Länge noch einmal (Augen hängen nicht von der Kanalhöhe ab)
    if (!sleeve && tv > 0 && yExt > Lh + 1e-6 && !LhIn) return geomMount(p, yExt);
    const B = [], LB = [];
    const addAll = (L, x0, x1, qs, vd) => qs.forEach(q => addPrim(L, x0, x1, q, vd));
    // Fächer bzw. Bohrungen (Hohlräume, vorn offen)
    const voids = roundB ? cen.map(c => ngon(c[0], c[1], eW / 2 + p.pClr, 48)) : cen.map(c => rectP(c[0] - cw / 2, c[0] + cw / 2, c[1] - c[2], c[1] + c[2]));
    if (sleeve) {
      addAll(B, 0, D - sdF, cont(0));
      if (sdF) addPrim(B, D - sdF, D, rectP(-hw + inset, hw - inset, inset, zF - inset));   // Absatz rundum (unten hängt er beim Druck frei)
      addAll(B, t, D, voids, true);
      // Hülse quer über dem Kasten, gerader Durchgang, Schraube vorn
      const L2 = p.slvL / 2;
      addPrim(B, sx0, sx1, rectP(-L2, L2, zF, chLo0 + chH + p.slvT));
      addPrim(B, cx0, cx1, rectP(-L2, L2, chLo0, chLo0 + chH), true);
    } else if (mid) {   // ein Körper über die ganze Tiefe, Kanal quer hindurch
      addAll(B, 0, D - sdF, cont(0));
      if (sdF) addAll(B, D - sdF, D, cont(-inset));
      addAll(B, xb0, D, voids, true);
      addPrim(B, cx0, cx1, rectP(-yExt, yExt, chLo0, chLo0 + chH), true);
    } else {
      addAll(B, xb0, D - sdF, cont(0));
      if (sdF) addAll(B, D - sdF, D, cont(-inset));
      addAll(B, xb0, D, voids, true);
      // Gehäuse hinten mit geradem Querkanal
      const hb = Math.min(zMinB, chLo0 - t);
      addPrim(B, 0, xh1, rectP(-yExt, yExt, hb, zMaxB));
      addPrim(B, 0, xh1, rectP(-yExt, yExt, hb, chLo0 + chH + t));
      addPrim(B, cx0, cx1, rectP(-yExt, yExt, chLo0, chLo0 + chH), true);
    }
    // Gewindezone: Mutter direkt am Kanal (wird vom Kanal aus eingelegt; die Gegenkraft der Schraube
    // drückt sie gegen das Material statt aus der Tasche), Einsatz bzw. Kernloch vorn an der Stirnseite
    scr.forEach(s => {
      const nutK = fix === 'nut', t0 = nutK ? s.xa : s.xb - s.lt, t1 = nutK ? s.xa + s.lt : s.xb;
      addPrim(B, t0, t1, ngon(s.y, s.z, rThr, nThr), true);
      addPrim(B, nutK ? t1 : s.xa, nutK ? s.xb : t0, ngon(s.y, s.z, rClr, 16), true);
    });

    // Deckel (Platte vorn, Rand nach hinten); Block: Aussparungen für die Schraubenköpfe
    let lidOut = 0;
    if (fit === 'flush') {
      const xr = D - sd + Math.min(p.lidClr, sd / 2), w = p.lidWall;
      if (sleeve) {   // Rand rundum, alle vier Seiten gleich lang
        addPrim(LB, D, D + p.lidT, rectP(-hw, hw, 0, zF));
        addPrim(LB, xr, D, rectP(-hw, hw, 0, zF));
        addPrim(LB, xr, D, rectP(-hw + w, hw - w, w, zF - w), true);
      } else {
        addAll(LB, D, D + p.lidT, cont(0));
        addAll(LB, xr, D, cont(0));
        addAll(LB, xr, D, cont(-w), true);
      }
    } else if (fit === 'over') {
      const o = p.lidClr + p.lidWall;
      lidOut = o;
      addAll(LB, D, D + p.lidT, cont(o));
      addAll(LB, D - sd, D, cont(o));
      addAll(LB, D - sd, D, cont(p.lidClr), true);
    }
    if (fit !== 'none' && !sleeve) scr.forEach(s => addPrim(LB, D - sd - 1, D + p.lidT + 1, ngon(s.y, s.z, holeR, 24), true));
    const MB = colMesh(B), ML = LB.length ? colMesh(LB) : null;

    // Ballaststücke
    const pieces = [];
    if (cells) cen.forEach(c => {
      for (let ix = 0; ix < p.nX; ix++) { const x0 = xb0 + p.pClr + ix * p.pL; pieces.push({ x0, x1: x0 + p.pL, y0: c[0] - eW / 2, y1: c[0] + eW / 2, z0: c[1] - eH / 2, z1: c[1] + eH / 2 }); }
    });
    else for (let iy = 0; iy < p.nY; iy++) for (let iz = 0; iz < p.nZ; iz++) for (let ix = 0; ix < p.nX; ix++) {
      const y0 = -Wi / 2 + p.pClr + iy * eW, x0 = xb0 + p.pClr + ix * p.pL;
      const z0 = mid && iz >= nLo ? zUp + p.pClr + (iz - nLo) * eH : zC0 + p.pClr + iz * eH;
      pieces.push({ x0, x1: x0 + p.pL, y0, y1: y0 + eW, z0, z1: z0 + eH });
    }
    const vPiece = p.round ? Math.PI * p.pD * p.pD / 4 * p.pL : p.pL * p.pW * p.pH;
    const nP = pieces.length, mPiece = vPiece / 1000 * p.rho, mBall = nP * mPiece;
    const bb = bbox(MB.pos);
    // Verbinder: liegt im Kanal unten auf und wird von der Schraube nach hinten gedrückt
    const jX0 = cx0, jX1 = cx0 + p.jW, jZ0 = chLo0;
    const yS = cells && cen.length ? cen.reduce((a, c) => Math.abs(c[0]) < Math.abs(a) ? c[0] : a, Infinity) : 0;
    const secXs = sleeve ? [{ x: t / 2, dark: true }, { x: (cx0 + cx1) / 2 }]
      : mid ? [{ x: (cx0 + cx1) / 2, dark: true }, { x: (cx1 + D - sdF) / 2 }] : [{ x: (cx1 + xh1) / 2, dark: true }, { x: (xb0 + D - sdF) / 2 }];
    return {
      ok: true, type: p.type, warn, p, MB, ML, box: MB.pos, lid: ML ? ML.pos : null, pieces, fit, sd, sdF, inset, lidOut, mid, nLo, nUp,
      W: bb.hi[1] - bb.lo[1], D, Dtot: D + (fit === 'none' ? 0 : p.lidT), Wi, Hi: HiA, Di, cw, ch, zC0, zF, tv, jHv, chH, chJ, Lh, eW, eH, nP, vPiece, mPiece, mBall,
      jX0, jX1, jZ0, cx0, cx1, xh1, xb0, sx0, sx1, wF, scr, S, rEff, rThr, holeR, ears, cen, roundB, lobed, stag, secXs, yS,
      hTop: bb.hi[2], zBot: bb.lo[2], bb, scrLen: (scr.length ? scr[0].xb : 0) - jX1 + 2
    };
  }

  // =====================================================================================
  //  Bauart „Lippe“: Box zum Aufschieben mit Lippe und Klettband (Beitrag 4)
  // =====================================================================================
  function geomLip(p) {
    const warn = [];
    const eW = p.round ? p.pD : p.pW, eH = p.round ? p.pD : p.pH;    // Stückmaß quer (Spannweite) / hoch
    const nCy = p.cells ? p.nY : 1, nCz = p.cells ? p.nZ : 1, tD = p.cells ? p.tD : 0;
    const cw = (p.cells ? eW : p.nY * eW) + 2 * p.pClr, ch = (p.cells ? eH : p.nZ * eH) + 2 * p.pClr;
    const Wi = nCy * cw + (nCy - 1) * tD, Hi = nCz * ch + (nCz - 1) * tD, Di = p.nX * p.pL + 2 * p.pClr;
    const t = p.t, W = Wi + 2 * t, hw = W / 2, zC0 = t, zC1 = t + Hi, zF = zC1 + t, D = t + Di;
    const phi = p.vDeg / 2 * D2R, tv = Math.tan(phi), jHv = p.jH / Math.cos(phi);
    const V = (a, b) => ({ a, b: b || 0 });
    const zTop = V(zF, tv), lipB = V(zF + jHv + p.jClr, tv), lipT = V(lipB.a + p.tJ, tv);
    const tJ = p.tJ, tW = p.tWl;   // Lippe / senkrechte Anschlagwand
    let lipL = p.lipL;
    if (lipL > p.jW + 1e-9) { lipL = p.jW; warn.push(T('Lippe auf die Verbinderbreite begrenzt.')); }
    // Deckel: bündig auf einem Absatz (Kastenkontur vorn um Randstärke + Spiel eingezogen) oder übergestülpt
    let fit = p.lid ? p.lidFit : 'none';
    const inset = p.lidWall + p.lidClr;
    if (fit === 'flush' && t - inset < 0.6 - 1e-9) {
      fit = 'over';
      warn.push(T('Wand zu dünn für den bündigen Deckel (Wandstärke ≥ Randstärke + Spiel + 0,6 mm) — Deckel wird außen übergestülpt.'));
    }
    const sd = fit === 'none' ? 0 : Math.min(p.lidRim, Math.max(1, Di - 1));   // Absatz bzw. Randbereich vorn
    const xV1 = D - sd;                                                         // Auflage in V-Form endet davor
    // Versatz nach vorn: Anschlagwand höchstens bis an das Ende der Auflage
    const lx = Math.min(p.lipX, Math.max(0, xV1 - tW));
    const back = p.lipBkFull ? lx : Math.min(p.lipBk, lx), xP0 = lx - back;   // Lippe hinter der Wand, Beginn der Lippe
    // Reicht die Lippe nicht bis hinten, stünde sie beim Druck auf der Rückseite frei → auf der Seite drucken
    const side = xP0 > 1e-6 && p.printPos === 'print', flushSide = side && fit === 'flush';
    if (lx > 1e-9 || p.lipX > 1e-9) {
      if (lx + tW + p.jW > xV1 + 1e-6 || p.lipX > lx + 1e-6) warn.push(T('Der Verbinder liegt nicht ganz auf: Versatz nach vorn zu groß für die Kastentiefe.'));
    } else if (tW + p.jW > xV1 + 1e-6) warn.push(T('Der Verbinder liegt nicht ganz auf: Kasten kürzer als Anschlagwand + Verbinderbreite') + (sd ? ' + ' + T('Deckelrand') : '') + '.');

    const B = [], LB = [];
    const add = (L, x0, x1, y0, y1, lo, hi) => {
      if (x1 - x0 > 1e-6 && y1 - y0 > 1e-6) L.push({ x0, x1, y0, y1, lo: typeof lo === 'number' ? V(lo) : lo, hi: typeof hi === 'number' ? V(hi) : hi });
    };
    // Kastenhülle mit Fächern im Bereich [x0, x1], Außenkontur um e eingezogen
    function shell(x0, x1, e, eL) {   // eL: Einzug an der Seite y = −hw (Standard e)
      const y0 = -hw + (eL == null ? e : eL), y1 = hw - e, z0 = e, z1 = zF - e;
      add(B, x0, x1, y0, y1, z0, zC0);                     // Boden
      add(B, x0, x1, y0, y1, zC1, z1);                     // Decke
      add(B, x0, x1, y0, -Wi / 2, z0, z1); add(B, x0, x1, Wi / 2, y1, z0, z1);   // Seitenwände
      for (let k = 1; k < nCy; k++) { const ya = -Wi / 2 + k * cw + (k - 1) * tD; add(B, x0, x1, ya, ya + tD, zC0, zC1); }
      for (let k = 1; k < nCz; k++) { const za = zC0 + k * ch + (k - 1) * tD; add(B, x0, x1, -Wi / 2, Wi / 2, za, za + tD); }
    }
    add(B, 0, t, -hw, hw, 0, zF);                        // Rückwand
    shell(t, xV1, 0);
    if (sd > 0) shell(xV1, D, fit === 'flush' ? inset : 0);
    add(B, 0, xV1, -hw, hw, zC1, zTop);                  // Auflage des Verbinders (V-Form)
    add(B, lx, lx + tW, -hw, hw, zC1, lipT);             // Anschlagwand
    const xL1 = lx + tW + lipL;
    // Lippe über dem Verbinder; bei Versatz läuft sie als Platte nach hinten (Standard bis zur Kastenkante:
    // steht beim Druck auf der Rückseite selbst auf dem Bett, die Anschlagwand überbrückt nur die Verbinderhöhe)
    if (lipL > 1e-6 || back > 1e-6) add(B, xP0, xL1, -hw, hw, lipB, lipT);

    // Klettband-Schlaufen auf der Lippe (Schlitz in Flugrichtung)
    const slot = p.strapW + 1, sp = p.strapPost, Lw = slot + 2 * sp, loops = [];
    let nS = p.strapN;
    if (nS > 0 && Lw > W + 1e-6) { warn.push(T('Klettband-Schlaufe breiter als der Kasten — weggelassen.')); nS = 0; }
    if (nS === 2 && 2 * Lw + 1 > W + 1e-6) { warn.push(T('Für zwei Klettband-Schlaufen zu schmal — eine Schlaufe in der Mitte.')); nS = 1; }
    if (nS === 2) {
      let yc = p.strapPos > 0 ? p.strapPos / 2 : hw - Lw / 2;
      yc = clamp(yc, Lw / 2 + 0.5, hw - Lw / 2);
      loops.push(-yc, yc);
    } else if (nS === 1) loops.push(0);
    const loopTop = V(lipT.a + p.strapT + sp, tv);
    loops.forEach(yc => {
      const ya = yc - Lw / 2, yb = yc + Lw / 2, s1 = V(lipT.a + p.strapT, tv);
      add(B, xP0, xL1, ya, ya + sp, lipT, s1); add(B, xP0, xL1, yb - sp, yb, lipT, s1);
      add(B, xP0, xL1, ya, yb, s1, loopTop);
    });

    // Deckel
    let lidOut = 0;
    if (fit === 'flush') {
      const xr = D - sd + Math.min(p.lidClr, sd / 2), w = p.lidWall;
      add(LB, D, D + p.lidT, -hw, hw, 0, zF);
      add(LB, xr, D, -hw, hw, 0, w); add(LB, xr, D, -hw, hw, zF - w, zF);
      add(LB, xr, D, -hw, -hw + w, w, zF - w);
      add(LB, xr, D, hw - w, hw, w, zF - w);
    } else if (fit === 'over') {
      const o = p.lidClr + p.lidWall, c0 = p.lidClr, xr = D - sd;
      lidOut = o;
      add(LB, D, D + p.lidT, -hw - o, hw + o, -o, zF + o);
      add(LB, xr, D, -hw - o, hw + o, -o, -c0); add(LB, xr, D, -hw - o, hw + o, zF + c0, zF + o);
      add(LB, xr, D, -hw - o, -hw - c0, -c0, zF + c0); add(LB, xr, D, hw + c0, hw + o, -c0, zF + c0);
    }
    const MB = colMesh(B), ML = LB.length ? colMesh(LB) : null;

    // Ballaststücke (Lage für Anzeige und Schwerpunkt)
    const pieces = [];
    for (let iy = 0; iy < p.nY; iy++) for (let iz = 0; iz < p.nZ; iz++) for (let ix = 0; ix < p.nX; ix++) {
      const y0 = p.cells ? -Wi / 2 + iy * (cw + tD) + p.pClr : -Wi / 2 + p.pClr + iy * eW;
      const z0 = p.cells ? zC0 + iz * (ch + tD) + p.pClr : zC0 + p.pClr + iz * eH;
      pieces.push({ x0: t + p.pClr + ix * p.pL, x1: t + p.pClr + (ix + 1) * p.pL, y0, y1: y0 + eW, z0, z1: z0 + eH });
    }
    const vPiece = p.round ? Math.PI * p.pD * p.pD / 4 * p.pL : p.pL * p.pW * p.pH;   // mm³
    const nP = pieces.length, mPiece = vPiece / 1000 * p.rho, mBall = nP * mPiece;
    const hEdge = hw * tv, hTop = (loops.length ? loopTop.a : lipT.a) + hEdge;          // höchster Punkt (außen)
    return {
      ok: true, type: 'lip', jX0: lx + tW, jX1: lx + tW + p.jW, jZ0: zF, scr: [], lx, back, xP0, side, flushSide,
      warn, p, MB, ML, box: MB.pos, lid: ML ? ML.pos : null, pieces, fit, sd, inset, lidOut,
      W, D, Wi, Hi, Di, cw, ch, zC0, zC1, zF, tv, jHv, lipL, xL1, loops, Lw, slot, zTop, lipB, lipT, loopTop,
      hTop, eW, eH, nP, vPiece, mPiece, mBall, xV1, Dtot: D + (fit === 'none' ? 0 : p.lidT)
    };
  }
  function signedVolume(v) {
    let s = 0;
    for (let i = 0; i + 8 < v.length; i += 9) s += v[i] * (v[i + 4] * v[i + 8] - v[i + 5] * v[i + 7]) - v[i + 1] * (v[i + 3] * v[i + 8] - v[i + 5] * v[i + 6]) + v[i + 2] * (v[i + 3] * v[i + 7] - v[i + 4] * v[i + 6]);
    return s / 6;
  }
  // Schwerpunkt eines geschlossenen Netzes (Tetraeder vom Ursprung)
  function centroid(v) {
    let V = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i + 8 < v.length; i += 9) {
      const d = (v[i] * (v[i + 4] * v[i + 8] - v[i + 5] * v[i + 7]) - v[i + 1] * (v[i + 3] * v[i + 8] - v[i + 5] * v[i + 6]) + v[i + 2] * (v[i + 3] * v[i + 7] - v[i + 4] * v[i + 6])) / 6;
      V += d; cx += d * (v[i] + v[i + 3] + v[i + 6]) / 4; cy += d * (v[i + 1] + v[i + 4] + v[i + 7]) / 4; cz += d * (v[i + 2] + v[i + 5] + v[i + 8]) / 4;
    }
    return V > 1e-9 ? [cx / V, cy / V, cz / V] : [0, 0, 0];
  }
  function bbox(v) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { const x = v[i + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
    return { lo, hi };
  }
  // Kantenprüfung: jede gerichtete Kante braucht genau eine Gegenkante
  function checkMesh(v) {
    const key = i => Math.round(v[i] * 1e4) + ',' + Math.round(v[i + 1] * 1e4) + ',' + Math.round(v[i + 2] * 1e4);
    const E = new Map();
    for (let i = 0; i < v.length; i += 9) {
      const k = [key(i), key(i + 3), key(i + 6)];
      for (let e = 0; e < 3; e++) { const a = k[e], b = k[(e + 1) % 3], s = a + '|' + b; E.set(s, (E.get(s) || 0) + 1); }
    }
    let open = 0, multi = 0;
    E.forEach((n, s) => { const q = s.split('|'), r = E.get(q[1] + '|' + q[0]) || 0; if (r !== n) open++; if (n > 1) multi++; });
    return { open, multi, tris: v.length / 9 };
  }

  // =====================================================================================
  //  Werte übernehmen (einmalig, danach frei)
  // =====================================================================================
  function segAngle(k) { const W = App.wing, st = W && W.stations; return st && st[k + 1] ? (+st[k + 1].dihAngle || 0) : 0; }
  function sources() {
    const cf = ST().cfg, out = [];
    const desc = (a, b) => fmt(a) + ' × ' + fmt(b) + ' mm';
    const vb = cf.formVb;
    if (vb && typeof vb === 'object') {
      const round = vb.shape === 'circle', a = round ? +vb.d || 10 : +vb.a || 8, b = round ? +vb.d || 10 : +vb.b || 20, v = Math.abs(+vb.vDeg || 0);
      out.push({ id: 'vbf', label: T('Verbinderform') + ' — ' + (round ? 'Ø ' + fmt(a) + ' mm' : desc(a, b)) + ', ' + fmt(v) + '°',
        apply(c) { c.jW = a; c.jH = b; c.vDeg = v; return desc(a, b) + ', ' + T('Knickwinkel') + ' ' + fmt(v) + '°'; } });
    }
    const SA = App.StegApi;
    if (cf.stegH && SA && SA.stkData && SA.geo && SA.cfg) {   // StegApi.cfg() legt stegH an → nur wenn schon vorhanden
      let S = null; try { const G = SA.geo(); S = G ? SA.stkData(G, SA.cfg()) : null; } catch (e) { S = null; }
      if (S && S.inH > 0) {
        const a = S.round ? S.inH : S.inW, b = S.inH;
        const v = Math.round(Math.abs(2 * (S.tubeDeg != null ? S.tubeDeg : segAngle(0) - (+S.vDeg || 0))) * 100) / 100;
        out.push({ id: 'stegh', label: T('Steghöhen: Hauptsteckung') + ' — ' + (S.round ? 'Ø ' + fmt(b) + ' mm' : desc(a, b)) + ', ' + fmt(v) + '°',
          apply(c) { c.jW = Math.round(a * 10) / 10; c.jH = Math.round(b * 10) / 10; c.vDeg = v; return desc(c.jW, c.jH) + ', ' + T('Knickwinkel') + ' ' + fmt(v) + '°'; } });
      }
    }
    if (cf.formStk) {
      const pts = Array.isArray(cf.formStkPts) && cf.formStkPts.length ? cf.formStkPts : [null];
      pts.forEach((q, i) => {
        const o = Array.isArray(q) ? {} : (q || {});
        const shape = (o.shape != null ? o.shape : cf.formStkShape) === 'rect' ? 'rect' : 'circle';
        const dv = (k, d) => { const x = +o[k.toLowerCase()]; if (x > 0) return x; const y = +cf['formStk' + k]; return y > 0 ? y : d; };
        const a = shape === 'rect' ? dv('A', 12) : dv('D', 10), b = shape === 'rect' ? dv('B', 8) : a;
        const v = Math.round(Math.abs(2 * segAngle(0)) * 100) / 100;
        out.push({ id: 'form' + i, label: T('Formenbau: Tragflächensteckung (Wurzel)') + (pts.length > 1 ? ' · ' + (i + 1) : '') + ' — ' + (shape === 'rect' ? desc(a, b) : 'Ø ' + fmt(a) + ' mm'),
          apply(c) { c.jW = a; c.jH = b; c.vDeg = v; return desc(a, b) + ', ' + T('Knickwinkel') + ' ' + fmt(v) + '°'; } });
      });
    }
    return out;
  }

  // =====================================================================================
  //  Ansicht (WebGL2, Rückfall Canvas 2D) + Einblendung Vorder-/Seitenansicht
  // =====================================================================================
  let cv = null, ctx = null, glc = null, gl = null, glP = null, glL = null, glBuf = null, glTried = false, glN = 0, glDirty = true;
  let G = null, scene = null, wired = false, pivot = null;
  const CAM0 = { yaw: -0.65, pitch: 0.5, zoom: 1, px: 0, py: 0 };
  const cam = Object.assign({}, CAM0);
  const ROT = (v, yaw, pitch) => {   // wie ViewCube.ROT_STD (Welt: y oben)
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x1 = v[0] * cy + v[2] * sy, z1 = -v[0] * sy + v[2] * cy;
    return [x1, v[1] * cp - z1 * sp, v[1] * sp + z1 * cp];
  };
  // Boxkoordinaten → Welt der Ansicht: x (Flugrichtung) → Welt z (zum Betrachter), y → Welt x, z → Welt y
  function rotM() { return [ROT([0, 0, 1], cam.yaw, cam.pitch), ROT([1, 0, 0], cam.yaw, cam.pitch), ROT([0, 1, 0], cam.yaw, cam.pitch)]; }
  function cssVar(n, fb) { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb; } catch (e) { return fb; } }
  function bgRGB() {
    try {
      ctx.fillStyle = cssVar('--bg', '#0f1216'); const s = String(ctx.fillStyle);
      let m = /^#([0-9a-f]{6})$/i.exec(s); if (m) return [0, 2, 4].map(k => parseInt(m[1].slice(k, k + 2), 16) / 255);
      m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s); if (m) return [m[1] / 255, m[2] / 255, m[3] / 255];
    } catch (e) { /* Rückfall */ }
    return [0.06, 0.07, 0.09];
  }
  const COL_BOX = [118, 166, 212], COL_LID = [96, 140, 186], COL_JOIN = [64, 66, 74];

  function joinerTris(g) {
    const out = [], L = Math.max(g.W / 2 + 35, 70), x0 = g.jX0, x1 = g.jX1;
    [-1, 1].forEach(s => {
      const y1 = s * L, zb0 = g.jZ0, zb1 = g.jZ0 + L * g.tv;
      hexTris(out, [[x0, 0, zb0], [x1, 0, zb0], [x1, y1, zb1], [x0, y1, zb1], [x0, 0, zb0 + g.jHv], [x1, 0, zb0 + g.jHv], [x1, y1, zb1 + g.jHv], [x0, y1, zb1 + g.jHv]]);
    });
    return out;
  }
  // Klemmschrauben (nur Anzeige): Schaft bis an den Verbinder, Kopf außen
  const COL_SCREW = [176, 180, 188];
  function screwTris(g) {
    const out = [];
    (g.scr || []).forEach(s => {
      cylX(out, g.jX1, s.xb, s.y, s.z, g.S.d / 2 * 0.96);
      cylX(out, s.xb, s.xb + 0.7 * g.S.d, s.y, s.z, g.S.head / 2);
    });
    return out;
  }
  function ballastTris(g) {
    const out = [], p = g.p;
    g.pieces.forEach(q => {
      if (p.round) cylX(out, q.x0, q.x1, (q.y0 + q.y1) / 2, (q.z0 + q.z1) / 2, p.pD / 2);
      else cuboid(out, q.x0, q.x1, q.y0, q.y1, q.z0, q.z1);
    });
    return out;
  }
  function makeScene() {
    const c = C(), vw = c.view, ex = Math.max(0, num(vw.explode, 15));
    const items = [];
    if (G && G.ok) {
      items.push({ v: G.box, col: COL_BOX, d: [0, 0, 0] });
      if (G.lid) items.push({ v: G.lid, col: COL_LID, d: [ex, 0, 0] });
      if (vw.ballast) items.push({ v: ballastTris(G), col: MATS[G.p.mat][2], d: [0, 0, 0] });
      if (vw.joiner) items.push({ v: joinerTris(G), col: COL_JOIN, d: [0, 0, 0] });
      if (vw.joiner && G.scr && G.scr.length) items.push({ v: screwTris(G), col: COL_SCREW, d: [0, 0, 0] });
    }
    let n = 0; items.forEach(it => n += Math.floor(it.v.length / 9));
    const data = new Float32Array(n * 27), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let o = 0;
    items.forEach(it => {
      const v = it.v, cl = it.col.map(x => x / 255);
      for (let i = 0; i + 8 < v.length; i += 9) {
        const P = [0, 1, 2].map(k => [v[i + 3 * k] + it.d[0], v[i + 3 * k + 1] + it.d[1], v[i + 3 * k + 2] + it.d[2]]);
        const ux = P[1][0] - P[0][0], uy = P[1][1] - P[0][1], uz = P[1][2] - P[0][2], wx = P[2][0] - P[0][0], wy = P[2][1] - P[0][1], wz = P[2][2] - P[0][2];
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
        P.forEach(q => {
          data[o++] = q[0]; data[o++] = q[1]; data[o++] = q[2]; data[o++] = nx; data[o++] = ny; data[o++] = nz; data[o++] = cl[0]; data[o++] = cl[1]; data[o++] = cl[2];
          for (let k = 0; k < 3; k++) { if (q[k] < lo[k]) lo[k] = q[k]; if (q[k] > hi[k]) hi[k] = q[k]; }
        });
      }
    });
    const ok = n > 0;
    // Ausschnitt nur aus Kasten + Deckel (der Verbinder ragt seitlich weit hinaus)
    let blo = lo, bhi = hi;
    if (ok && G && G.ok) {
      const b = bbox(G.box); blo = b.lo.slice(); bhi = b.hi.slice();
      if (G.lid) { const l = bbox(G.lid); for (let k = 0; k < 3; k++) { blo[k] = Math.min(blo[k], l.lo[k] + (k === 0 ? ex : 0)); bhi[k] = Math.max(bhi[k], l.hi[k] + (k === 0 ? ex : 0)); } }
    }
    scene = { data, n: n * 3, lo, hi, c: ok ? blo.map((x, k) => (x + bhi[k]) / 2) : [0, 0, 0], R: ok ? Math.max(1, Math.hypot(bhi[0] - blo[0], bhi[1] - blo[1], bhi[2] - blo[2]) / 2 * 1.15) : 1,
      Rz: ok ? Math.max(1, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2) : 1 };
    glDirty = true;
  }
  function glInit() {
    if (glTried || !cv) return; glTried = true;
    try {
      glc = document.createElement('canvas'); glc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
      cv.parentNode.insertBefore(glc, cv);
      gl = glc.getContext('webgl2', { antialias: true, alpha: false, depth: true }); if (!gl) throw new Error('no webgl2');
      const VS = `#version 300 es
        in vec3 aP; in vec3 aN; in vec3 aC; uniform mat3 uR; uniform vec3 uC; uniform vec4 uS; uniform float uZ;
        out vec3 vN; out vec3 vC;
        void main() { vec3 p = uR * (aP - uC); vN = uR * aN; vC = aC; gl_Position = vec4(p.x * uS.x + uS.z, p.y * uS.y + uS.w, -p.z * uZ, 1.0); }`;
      const FS = `#version 300 es
        precision mediump float; in vec3 vN; in vec3 vC; out vec4 o;
        void main() { vec3 n = normalize(vN); vec3 L = normalize(vec3(-0.35, 0.55, 0.75)); float k = 0.30 + 0.62 * abs(dot(n, L)) + 0.10 * abs(n.y); o = vec4(vC * min(k, 1.08), 1.0); }`;
      const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
      glP = gl.createProgram(); gl.attachShader(glP, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(glP, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(glP);
      if (!gl.getProgramParameter(glP, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glP));
      glL = { aP: gl.getAttribLocation(glP, 'aP'), aN: gl.getAttribLocation(glP, 'aN'), aC: gl.getAttribLocation(glP, 'aC'), uR: gl.getUniformLocation(glP, 'uR'), uC: gl.getUniformLocation(glP, 'uC'), uS: gl.getUniformLocation(glP, 'uS'), uZ: gl.getUniformLocation(glP, 'uZ') };
      glBuf = gl.createBuffer();
      glc.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; }, false);
    } catch (e) {
      console.warn('Ballastbox: WebGL2 nicht verfügbar, Canvas-2D-Darstellung:', e && e.message);
      gl = null; if (glc && glc.parentNode) glc.parentNode.removeChild(glc); glc = null;
    }
  }
  function viewParams(w, h) {
    const c = pivot || scene.c, s = 0.36 * Math.min(w, h) / scene.R * cam.zoom;
    return { c, s, M: rotM() };
  }
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
      ctx.fillText(G && G.msg ? G.msg : T('Keine Box.'), w / 2, h / 2); ctx.textAlign = 'left';
      return;
    }
    const vp = viewParams(w, h);
    if (gl) {
      const Wd = Math.round(w * dpr), Hd = Math.round(h * dpr);
      if (glc.width !== Wd || glc.height !== Hd) { glc.width = Wd; glc.height = Hd; }
      gl.viewport(0, 0, Wd, Hd); gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(glP); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
      gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
      if (glDirty) { gl.bufferData(gl.ARRAY_BUFFER, scene.data, gl.STATIC_DRAW); glN = scene.n; glDirty = false; }
      const st = 36;
      gl.enableVertexAttribArray(glL.aP); gl.vertexAttribPointer(glL.aP, 3, gl.FLOAT, false, st, 0);
      gl.enableVertexAttribArray(glL.aN); gl.vertexAttribPointer(glL.aN, 3, gl.FLOAT, false, st, 12);
      gl.enableVertexAttribArray(glL.aC); gl.vertexAttribPointer(glL.aC, 3, gl.FLOAT, false, st, 24);
      gl.uniformMatrix3fv(glL.uR, false, [].concat(vp.M[0], vp.M[1], vp.M[2]));
      gl.uniform3f(glL.uC, vp.c[0], vp.c[1], vp.c[2]);
      gl.uniform4f(glL.uS, 2 * vp.s / w, 2 * vp.s / h, 2 * cam.px / w, -2 * cam.py / h);
      gl.uniform1f(glL.uZ, 1 / (scene.Rz * 3.2 + 1));
      gl.drawArrays(gl.TRIANGLES, 0, glN);
    } else {
      ctx.fillStyle = cssVar('--bg', '#0f1216'); ctx.fillRect(0, 0, w, h);
      const Dd = scene.data, list = [];
      const Lv = [-0.35, 0.55, 0.75], Ln = Math.hypot(Lv[0], Lv[1], Lv[2]);
      for (let i = 0; i < scene.n; i += 3) {
        const o = i * 9, q = [0, 1, 2].map(k => project([Dd[o + 9 * k], Dd[o + 9 * k + 1], Dd[o + 9 * k + 2]], vp, w, h));
        const M = vp.M, nn = [Dd[o + 3], Dd[o + 4], Dd[o + 5]];
        const ny = M[0][1] * nn[0] + M[1][1] * nn[1] + M[2][1] * nn[2], nz = M[0][2] * nn[0] + M[1][2] * nn[1] + M[2][2] * nn[2], nx = M[0][0] * nn[0] + M[1][0] * nn[1] + M[2][0] * nn[2];
        const k = Math.min(1.08, 0.30 + 0.62 * Math.abs((nx * Lv[0] + ny * Lv[1] + nz * Lv[2]) / Ln) + 0.10 * Math.abs(ny));
        list.push({ q, d: (q[0][2] + q[1][2] + q[2][2]) / 3, c: [Dd[o + 6], Dd[o + 7], Dd[o + 8]].map(x => Math.round(x * 255 * k)) });
      }
      list.sort((a, b) => a.d - b.d);
      list.forEach(f => {
        const s = 'rgb(' + f.c.join(',') + ')';
        ctx.fillStyle = ctx.strokeStyle = window.DrawTheme ? DrawTheme.raw(s) : s;
        ctx.beginPath(); ctx.moveTo(f.q[0][0], f.q[0][1]); ctx.lineTo(f.q[1][0], f.q[1][1]); ctx.lineTo(f.q[2][0], f.q[2][1]); ctx.closePath(); ctx.fill(); ctx.lineWidth = 0.5; ctx.stroke();
      });
    }
    if (pivot && window.ViewCube) { const q = project(pivot, vp, w, h); ViewCube.drawPivot(ctx, q[0], q[1]); }
    if (C().view.sec) drawSec(w, h);
  }

  // Einblendung unten links: Vorderansicht (Kasten offen, ohne Deckel) und Schnitt in Flugrichtung, maßstäblich
  function drawSec(w, h) {
    if (!G || !G.ok) return;
    if (G.type !== 'lip') { drawSecMount(w, h); return; }
    const g = G, p = g.p, vw = C().view;
    const bw = Math.min(520, w * 0.52), bh = Math.min(240, h * 0.4), x0 = 10, y0 = h - bh - 46;
    ctx.save();
    ctx.fillStyle = 'rgba(16,20,26,.84)'; ctx.strokeStyle = 'rgba(120,135,150,.6)'; ctx.lineWidth = 1;
    ctx.fillRect(x0, y0, bw, bh); ctx.strokeRect(x0 + 0.5, y0 + 0.5, bw - 1, bh - 1);
    const pad = 12, gap = 22, pw = (bw - 2 * pad - gap) / 2, ph = bh - 58;
    const over = g.lidOut, yL = -g.W / 2 - over - 4, yR = g.W / 2 + over + 4;
    const zLo = -over - 1, zHi = g.hTop + 2, xLo = -2, xHi = g.Dtot + 2;
    const s = Math.min(pw / (yR - yL), pw / (xHi - xLo), ph / (zHi - zLo));
    if (!(s > 0) || !isFinite(s)) { ctx.restore(); return; }   // Zeichenfläche noch zu klein (Reiter gerade erst sichtbar)
    const by = y0 + 26 + ph;                                  // Grundlinie (z = zLo)
    const fx0 = x0 + pad + (pw - (yR - yL) * s) / 2, sx0 = x0 + pad + pw + gap + (pw - (xHi - xLo) * s) / 2;
    const FY = y => fx0 + (y - yL) * s, SX = x => sx0 + (x - xLo) * s, Z = z => by - (z - zLo) * s;
    const RAW = c => window.DrawTheme ? DrawTheme.raw(c) : c;
    const poly = (pts, fill) => { ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); ctx.fillStyle = RAW(fill); ctx.fill(); ctx.strokeStyle = RAW(fill); ctx.lineWidth = 0.6; ctx.stroke(); };
    ctx.fillStyle = '#c9d3de'; ctx.font = '12px Segoe UI, sans-serif';
    ctx.fillText(T('Vorderansicht (ohne Deckel)'), x0 + pad, y0 + 16);
    ctx.fillText(T('Schnitt in Flugrichtung'), x0 + pad + pw + gap, y0 + 16);
    // Vorderansicht: hinten Anschlagwand/Lippe/Schlaufen (dunkler), davor der Schnitt durch die Fächer
    secX(g.MB, g.lx > 0 ? g.lx + g.p.tWl / 2 : Math.min(g.p.tWl, g.p.t) / 2).forEach(q => poly(q.map(r => [FY(r[0]), Z(r[1])]), 'rgb(78,110,140)'));
    secX(g.MB, g.xL1 + 0.01 < g.D ? Math.max(g.xL1 + 0.01, (g.p.t + g.D) / 2) : (g.p.t + g.D) / 2).forEach(q => poly(q.map(r => [FY(r[0]), Z(r[1])]), 'rgb(118,166,212)'));
    if (vw.ballast) {
      const mc = MATS[p.mat][2], col = 'rgb(' + mc.join(',') + ')';
      const seen = new Set();
      g.pieces.forEach(q => {
        const k = q.y0.toFixed(3) + ',' + q.z0.toFixed(3); if (seen.has(k)) return; seen.add(k);
        if (p.round) { ctx.beginPath(); ctx.arc(FY((q.y0 + q.y1) / 2), Z((q.z0 + q.z1) / 2), p.pD / 2 * s, 0, 2 * Math.PI); ctx.fillStyle = RAW(col); ctx.fill(); }
        else poly([[FY(q.y0), Z(q.z0)], [FY(q.y1), Z(q.z0)], [FY(q.y1), Z(q.z1)], [FY(q.y0), Z(q.z1)]], col);
      });
    }
    if (vw.joiner) {   // Verbinder von vorn: Band in V-Form
      const zb = y => g.zF + Math.abs(y) * g.tv;
      poly([[FY(yL), Z(zb(yL))], [FY(0), Z(zb(0))], [FY(yR), Z(zb(yR))], [FY(yR), Z(zb(yR) + g.jHv)], [FY(0), Z(zb(0) + g.jHv)], [FY(yL), Z(zb(yL) + g.jHv)]], 'rgba(205,85,85,.55)');
    }
    // Schnitt in Flugrichtung: durch ein Fach in der Mitte
    const yS = p.cells && p.nY > 1 ? (p.nY % 2 ? 0 : -g.Wi / 2 + (p.nY / 2) * (g.cw + p.tD) + g.cw / 2) : 0;
    secY(g.MB, yS).forEach(r => poly([[SX(r[0]), Z(r[2])], [SX(r[1]), Z(r[2])], [SX(r[1]), Z(r[3])], [SX(r[0]), Z(r[3])]], 'rgb(118,166,212)'));
    if (g.ML) secY(g.ML, yS).forEach(r => poly([[SX(r[0]), Z(r[2])], [SX(r[1]), Z(r[2])], [SX(r[1]), Z(r[3])], [SX(r[0]), Z(r[3])]], 'rgb(96,140,186)'));
    if (vw.ballast) {
      const mc = MATS[p.mat][2], col = 'rgb(' + mc.join(',') + ')';
      g.pieces.forEach(q => { if (yS >= q.y0 - 1e-9 && yS <= q.y1 + 1e-9) poly([[SX(q.x0) + 0.5, Z(q.z0)], [SX(q.x1) - 0.5, Z(q.z0)], [SX(q.x1) - 0.5, Z(q.z1)], [SX(q.x0) + 0.5, Z(q.z1)]], col); });
    }
    if (vw.joiner) {
      const zb = g.zF + Math.abs(yS) * g.tv, xa = g.jX0, xb = g.jX1;
      poly([[SX(xa), Z(zb)], [SX(xb), Z(zb)], [SX(xb), Z(zb + g.jHv)], [SX(xa), Z(zb + g.jHv)]], 'rgba(205,85,85,.75)');
    }
    // Maße
    ctx.fillStyle = '#c9d3de'; ctx.font = '11px Segoe UI, sans-serif';
    ctx.fillText(T('Breite') + ' ' + fmt(g.W + 2 * over) + ' · ' + T('Höhe') + ' ' + fmt(g.hTop + over) + ' mm', x0 + pad, y0 + bh - 12);
    ctx.fillText(T('Tiefe') + ' ' + fmt(g.Dtot) + ' mm' + (g.fit !== 'none' ? ' (' + T('mit Deckel') + ')' : ''), x0 + pad + pw + gap, y0 + bh - 12);
    ctx.fillStyle = '#8a97a6'; ctx.font = '10px Segoe UI, sans-serif';
    ctx.fillText('← ' + T('hinten') + '   ' + T('vorne') + ' →', x0 + pad + pw + gap, y0 + bh - 26);
    ctx.restore();
  }

  // Einblendung für Hülse/Block: Vorderansicht (Schnitt durch die Fächer, dahinter dunkel die Rückwand
  // bzw. das Gehäuse) und Schnitt in Flugrichtung durch ein Fach
  function drawSecMount(w, h) {
    const g = G, p = g.p, vw = C().view;
    const bw = Math.min(520, w * 0.52), bh = Math.min(240, h * 0.4), x0 = 10, y0 = h - bh - 46;
    ctx.save();
    ctx.fillStyle = 'rgba(16,20,26,.84)'; ctx.strokeStyle = 'rgba(120,135,150,.6)'; ctx.lineWidth = 1;
    ctx.fillRect(x0, y0, bw, bh); ctx.strokeRect(x0 + 0.5, y0 + 0.5, bw - 1, bh - 1);
    const pad = 12, gap = 22, pw = (bw - 2 * pad - gap) / 2, ph = bh - 58;
    const bb = g.bb, lb = g.lid ? bbox(g.lid) : null;
    const yL = Math.min(bb.lo[1], lb ? lb.lo[1] : Infinity) - 4, yR = Math.max(bb.hi[1], lb ? lb.hi[1] : -Infinity) + 4;
    const zLo = Math.min(bb.lo[2], lb ? lb.lo[2] : Infinity) - 1, zHi = Math.max(bb.hi[2], lb ? lb.hi[2] : -Infinity, g.jZ0 + g.jHv) + 2;
    const xLo = -2, xHi = g.Dtot + 2 + (g.scr.length ? 0.7 * g.S.d : 0);
    const s = Math.min(pw / (yR - yL), pw / (xHi - xLo), ph / (zHi - zLo));
    if (!(s > 0) || !isFinite(s)) { ctx.restore(); return; }   // Zeichenfläche noch zu klein (Reiter gerade erst sichtbar)
    const by = y0 + 26 + ph;
    const fx0 = x0 + pad + (pw - (yR - yL) * s) / 2, sx0 = x0 + pad + pw + gap + (pw - (xHi - xLo) * s) / 2;
    const FY = y => fx0 + (y - yL) * s, SX = x => sx0 + (x - xLo) * s, Z = z => by - (z - zLo) * s;
    const RAW = c => window.DrawTheme ? DrawTheme.raw(c) : c;
    const poly = (pts, fill) => { ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); ctx.fillStyle = RAW(fill); ctx.fill(); ctx.strokeStyle = RAW(fill); ctx.lineWidth = 0.6; ctx.stroke(); };
    const box4 = (xa, xb, za, zb, col) => poly([[SX(xa), Z(za)], [SX(xb), Z(za)], [SX(xb), Z(zb)], [SX(xa), Z(zb)]], col);
    ctx.fillStyle = '#c9d3de'; ctx.font = '12px Segoe UI, sans-serif';
    ctx.fillText(T('Vorderansicht (ohne Deckel)'), x0 + pad, y0 + 16);
    ctx.fillText(T('Schnitt in Flugrichtung'), x0 + pad + pw + gap, y0 + 16);
    g.secXs.forEach(q => secX(g.MB, q.x).forEach(r => poly(r.map(u => [FY(u[0]), Z(u[1])]), q.dark ? 'rgb(78,110,140)' : 'rgb(118,166,212)')));
    const mc = MATS[p.mat][2], colB = 'rgb(' + mc.join(',') + ')';
    if (vw.ballast) {
      const seen = new Set();
      g.pieces.forEach(q => {
        const k = q.y0.toFixed(3) + ',' + q.z0.toFixed(3); if (seen.has(k)) return; seen.add(k);
        if (p.round) { ctx.beginPath(); ctx.arc(FY((q.y0 + q.y1) / 2), Z((q.z0 + q.z1) / 2), p.pD / 2 * s, 0, 2 * Math.PI); ctx.fillStyle = RAW(colB); ctx.fill(); }
        else poly([[FY(q.y0), Z(q.z0)], [FY(q.y1), Z(q.z0)], [FY(q.y1), Z(q.z1)], [FY(q.y0), Z(q.z1)]], colB);
      });
    }
    if (vw.joiner) {
      const zb = y => g.jZ0 + Math.abs(y) * g.tv;
      poly([[FY(yL), Z(zb(yL))], [FY(0), Z(zb(0))], [FY(yR), Z(zb(yR))], [FY(yR), Z(zb(yR) + g.jHv)], [FY(0), Z(zb(0) + g.jHv)], [FY(yL), Z(zb(yL) + g.jHv)]], 'rgba(205,85,85,.45)');
      g.scr.forEach(q => { ctx.beginPath(); ctx.arc(FY(q.y), Z(q.z), g.S.head / 2 * s, 0, 2 * Math.PI); ctx.strokeStyle = RAW('rgb(220,224,230)'); ctx.lineWidth = 1.2; ctx.stroke(); });
    }
    secY(g.MB, g.yS).forEach(r => box4(r[0], r[1], r[2], r[3], 'rgb(118,166,212)'));
    if (g.ML) secY(g.ML, g.yS).forEach(r => box4(r[0], r[1], r[2], r[3], 'rgb(96,140,186)'));
    if (vw.ballast) g.pieces.forEach(q => { if (g.yS >= q.y0 - 1e-9 && g.yS <= q.y1 + 1e-9) poly([[SX(q.x0) + 0.5, Z(q.z0)], [SX(q.x1) - 0.5, Z(q.z0)], [SX(q.x1) - 0.5, Z(q.z1)], [SX(q.x0) + 0.5, Z(q.z1)]], colB); });
    if (vw.joiner) { const zb = g.jZ0 + Math.abs(g.yS) * g.tv; box4(g.jX0, g.jX1, zb, zb + g.jHv, 'rgba(205,85,85,.75)'); }
    ctx.fillStyle = '#c9d3de'; ctx.font = '11px Segoe UI, sans-serif';
    ctx.fillText(T('Breite') + ' ' + fmt(g.W + 2 * g.lidOut) + ' · ' + T('Höhe') + ' ' + fmt(g.hTop - g.zBot) + ' mm', x0 + pad, y0 + bh - 12);
    ctx.fillText(T('Tiefe') + ' ' + fmt(g.Dtot) + ' mm' + (g.fit !== 'none' ? ' (' + T('mit Deckel') + ')' : ''), x0 + pad + pw + gap, y0 + bh - 12);
    ctx.fillStyle = '#8a97a6'; ctx.font = '10px Segoe UI, sans-serif';
    ctx.fillText('← ' + T('hinten') + '   ' + T('vorne') + ' →', x0 + pad + pw + gap, y0 + bh - 26);
    ctx.restore();
  }

  function wire() {
    if (wired) return;
    cv = document.getElementById('cBallast'); if (!cv) return;
    wired = true;
    ctx = cv.getContext('2d');
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('mousedown', e => {
      if (!scene || !scene.n) return;
      const x0 = e.clientX, y0 = e.clientY, c0 = Object.assign({}, cam), pan = e.button !== 0 || e.shiftKey;
      const mv = ev => {
        const dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (pan) { cam.px = c0.px + dx; cam.py = c0.py + dy; }
        else { cam.yaw = c0.yaw + dx * 0.008; cam.pitch = clamp(c0.pitch + dy * 0.008, -1.57, 1.57); }
        draw();
      };
      const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
      addEventListener('mousemove', mv); addEventListener('mouseup', up);
    });
    cv.addEventListener('wheel', e => {
      e.preventDefault(); if (!scene || !scene.n) return;
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left - cv.clientWidth / 2, my = e.clientY - r.top - cv.clientHeight / 2;
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      cam.px = mx - (mx - cam.px) * f; cam.py = my - (my - cam.py) * f; cam.zoom *= f; draw();
    }, { passive: false });
    cv.addEventListener('dblclick', () => home());
    if (window.ViewCube) {
      ViewCube.midDbl(cv, (x, y) => {
        if (!scene || !scene.n) return false;
        const w = cv.clientWidth, h = cv.clientHeight, vp = viewParams(w, h), pt = pickSurface(x, y, vp, w, h);
        if (!pt) return false;
        const old = vp.c, M = vp.M, d = [pt[0] - old[0], pt[1] - old[1], pt[2] - old[2]];
        cam.px += (M[0][0] * d[0] + M[1][0] * d[1] + M[2][0] * d[2]) * vp.s;
        cam.py -= (M[0][1] * d[0] + M[1][1] * d[1] + M[2][1] * d[2]) * vp.s;
        pivot = pt; draw(); return true;
      });
      ViewCube.attach({
        canvas: () => cv, get: () => ({ yaw: cam.yaw, pitch: cam.pitch }), set: (y, p) => { cam.yaw = y; cam.pitch = p; }, redraw: draw,
        rot: ROT, k: [0.008, 0.008], active: () => ST().activeTab === TAB && !!(scene && scene.n),
        labels: { '+x': T('Seite 2'), '-x': T('Seite 1'), '+y': T('Oben'), '-y': T('Unten'), '+z': T('Vorne'), '-z': T('Hinten') },
        reset: () => resetCam()
      });
    }
    const btn = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
    btn('ballastIso', () => setCam(CAM0.yaw, CAM0.pitch));
    btn('ballastFront', () => setCam(0, 0));                 // Vorderansicht: Blick gegen die Flugrichtung auf Öffnung und V-Knick
    btn('ballastSide', () => setCam(-Math.PI / 2, 0));       // Seitenansicht: C-Profil der Aufnahme
    btn('ballastTop', () => setCam(0, Math.PI / 2));
    btn('ballastExport', () => exportAll());
    btn('ballastDxf', () => exportDxf());
  }
  // Vorderster Oberflächenpunkt unter dem Zeiger (Drehpunkt per Mausrad-Doppelklick)
  function pickSurface(x, y, vp, w, h) {
    const D = scene.data; let best = null, bd = Infinity;
    for (let i = 0; i < scene.n; i += 3) {
      const o = i * 9, q = [0, 1, 2].map(k => project([D[o + 9 * k], D[o + 9 * k + 1], D[o + 9 * k + 2]], vp, w, h));
      const d0 = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
      if (Math.abs(d0) < 1e-9) continue;
      const l1 = ((q[1][0] - x) * (q[2][1] - y) - (q[2][0] - x) * (q[1][1] - y)) / d0, l2 = ((q[2][0] - x) * (q[0][1] - y) - (q[0][0] - x) * (q[2][1] - y)) / d0, l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const z = l1 * q[0][2] + l2 * q[1][2] + l3 * q[2][2];
      if (-z < bd) { bd = -z; best = [0, 1, 2].map(k => l1 * D[o + k] + l2 * D[o + 9 + k] + l3 * D[o + 18 + k]); }
    }
    return best;
  }
  function resetCam() { Object.assign(cam, CAM0); pivot = null; }
  function home() { resetCam(); draw(); }
  function setCam(y, p) { cam.yaw = y; cam.pitch = p; cam.px = 0; cam.py = 0; cam.zoom = 1; pivot = null; draw(); }

  // =====================================================================================
  //  Info, Export
  // =====================================================================================
  function strapLen(g) {   // Klettband einmal rundum (über Schlaufe/Lippe, vorn schräg auf den Deckel, unten, hinten hoch)
    const Htop = g.loops.length ? g.loopTop.a : g.lipT.a, Dt = g.Dtot, lo = -g.lidOut, x0 = g.xP0 || 0;
    // oben über Schlaufe/Lippe ab x0, hinten von der Kastenkante (0, zF) schräg hinauf zur Lippe
    return (g.xL1 - x0) + Math.hypot(Math.max(0, Dt - g.xL1), Htop - g.zF) + (g.zF - lo) + Dt + (g.zF - lo) + Math.hypot(x0, Htop - g.zF);
  }
  function infoHTML() {
    const el = document.getElementById('ballastInfo'); if (!el) return;
    if (!G || !G.ok) { el.innerHTML = '<b>' + T('Ballastbox') + '</b><br>' + (G && G.msg ? G.msg : T('Keine Box.')); return; }
    if (G.type !== 'lip') { el.innerHTML = infoMount(G); return; }
    const g = G, p = g.p;
    const mat = T(MATS[p.mat][0]) + (p.mat === 'own' ? ' (' + fmt(p.rho) + ' g/cm³)' : '');
    const vBox = signedVolume(g.box) / 1000, vLid = g.lid ? signedVolume(g.lid) / 1000 : 0;
    const mBox = (vBox + vLid) * p.rhoP;
    const stk = p.round ? 'Ø ' + fmt(p.pD) + ' × ' + fmt(p.pL) + ' mm' : fmt(p.pL) + ' × ' + fmt(p.pW) + ' × ' + fmt(p.pH) + ' mm';
    let h = '<b>' + T('Ballastbox') + '</b> · ' + T('Außenmaße') + ' ' + fmt(g.W + 2 * g.lidOut) + ' × ' + fmt(g.Dtot) + ' × ' + fmt(g.hTop + g.lidOut) + ' mm (' + T('Breite × Tiefe × Höhe') + ')<br>';
    h += T('Ballast') + ': ' + g.nP + ' × ' + stk + ' (' + p.nY + ' ' + T('nebeneinander') + ' × ' + p.nZ + ' ' + T('übereinander') + (p.nX > 1 ? ' × ' + p.nX + ' ' + T('hintereinander') : '') + '), ' + mat + '<br>';
    h += T('Masse') + ': ' + g.nP + ' × ' + fmt1(g.mPiece) + ' g = <b>' + fmt1(g.mBall) + ' g</b>' + ' · ' + T('Box') + ' ≈ ' + fmt1(mBox) + ' g (' + T('bei 100 % Füllung') + ')<br>';
    h += T('Fach') + ' ' + fmt(g.cw) + ' × ' + fmt(g.ch) + ' mm, ' + fmt(g.Di) + ' mm ' + T('tief') + (p.cells ? '' : ' (' + T('ohne Trennwände') + ')') + '<br>';
    h += T('Verbinder') + ' ' + fmt(p.jW) + ' × ' + fmt(p.jH) + ' mm' + (p.vDeg > 0 ? ', ' + T('V-Knick') + ' ' + fmt(p.vDeg) + '° (' + fmt(p.vDeg / 2) + '° ' + T('je Seite') + ')' : ', ' + T('gerade'))
      + ' · ' + T('Aufnahmehöhe') + ' ' + fmt(g.jHv + p.jClr) + ' mm' + (g.lipL > 0 ? ', ' + T('Lippe') + ' ' + fmt(g.lipL) + ' mm' : '') + '<br>';
    // Schwerpunkt des Ballasts gegenüber dem Verbinder
    const xb = p.t + g.Di / 2, zb = g.zC0 + g.Hi / 2, xj = (g.jX0 + g.jX1) / 2;
    const cb = centroid(g.box), mAll = g.mBall + vBox * p.rhoP, xs = (g.mBall * xb + vBox * p.rhoP * cb[0]) / mAll, zs = (g.mBall * zb + vBox * p.rhoP * cb[2]) / mAll;
    h += T('Schwerpunkt Ballast') + ': ' + fmt1(Math.abs(xb - xj)) + ' mm ' + T(xb - xj >= -0.05 ? 'vor der Verbindermitte' : 'hinter der Verbindermitte') + ', ' + fmt1(g.zF - zb) + ' mm ' + T('unter der Verbinderunterkante')
      + ' · ' + T('mit Box') + ' ' + fmt1(xs - xj) + ' / ' + fmt1(g.zF - zs) + ' mm<br>';
    if (g.loops.length) h += T('Klettband') + ': ' + g.loops.length + ' × ' + fmt(p.strapW) + ' mm ' + T('breit') + ', ' + T('Länge je Band') + ' ≈ ' + Math.ceil((strapLen(g) + 40) / 10) * 10 + ' mm (' + T('inkl. 40 mm Überlappung') + ')<br>';
    let note = T('Box nach vorn eingebaut; um 180° gedreht liegt der Ballast hinter dem Verbinder.');
    if (g.lx > 0) {
      note = T('Verbinder nach vorn versetzt um') + ' ' + fmt(g.lx) + ' mm — ';
      if (g.xP0 <= 1e-6) note += T('die Lippe läuft als Platte bis zur Hinterkante durch; Druck weiterhin auf der Rückseite ohne Stützen.');
      else {
        note += (g.back > 0 ? T('Lippe hinter der Anschlagwand') + ' ' + fmt(g.back) + ' mm. ' : T('keine Lippe hinter der Anschlagwand.') + ' ');
        if (g.side) note += T(g.flushSide ? 'Druck auf der Seite liegend (auf der Rückseite stünde die Anschlagwand frei).' : 'Druck auf der Seite liegend ohne Stützen (auf der Rückseite stünde die Anschlagwand frei).') + (g.flushSide ? ' ' + T('Der Absatz für den bündigen Deckel hängt dabei an der Druckbettseite frei: dort eine kleine Stütze setzen oder den Deckel „außen übergestülpt“ wählen (dann ganz ohne Stützen).') : '');
      }
    }
    h += '<span style="color:#8a97a6">' + note + '</span>';
    g.warn.forEach(w => { h += '<br><span style="color:#ffb454">' + w + '</span>'; });
    el.innerHTML = h;
  }
  const TYPE_NAME = { lip: 'Ballastbox zum Aufschieben', sleeve: 'Ballastbox mit Hülse', block: 'Ballastblock zum Durchstecken' };
  const FIX_NAME = { nut: 'Sechskantmutter eingelassen', insert: 'Gewindeeinsatz (Einschmelzmutter)', tap: 'Gewinde ins Kernloch schneiden' };
  function fixText(g) {
    const p = g.p, S = g.S;
    if (p.scrFix === 'nut') return T(FIX_NAME.nut) + ' (' + T('Schlüsselweite') + ' ' + fmt(S.af) + ' mm), ' + T('vom Verbinderkanal aus einlegen');
    if (p.scrFix === 'insert') return T(FIX_NAME.insert) + ', ' + T('Bohrung') + ' Ø ' + fmt(2 * g.rThr) + ' mm';
    return T(FIX_NAME.tap) + ', ' + T('Kernloch') + ' Ø ' + fmt(S.core) + ' mm';
  }
  function infoMount(g) {
    const p = g.p;
    const mat = T(MATS[p.mat][0]) + (p.mat === 'own' ? ' (' + fmt(p.rho) + ' g/cm³)' : '');
    const vBox = signedVolume(g.box) / 1000, vLid = g.lid ? signedVolume(g.lid) / 1000 : 0, mBox = (vBox + vLid) * p.rhoP;
    const stk = p.round ? 'Ø ' + fmt(p.pD) + ' × ' + fmt(p.pL) + ' mm' : fmt(p.pL) + ' × ' + fmt(p.pW) + ' × ' + fmt(p.pH) + ' mm';
    const H = g.hTop - g.zBot + 2 * g.lidOut;
    let h = '<b>' + T(TYPE_NAME[g.type]) + '</b> · ' + T('Außenmaße') + ' ' + fmt(g.W + 2 * g.lidOut) + ' × ' + fmt(g.Dtot) + ' × ' + fmt(H) + ' mm (' + T('Breite × Tiefe × Höhe') + ')<br>';
    const arr = g.stag ? ', ' + T('versetzt angeordnet') : '';
    h += T('Ballast') + ': ' + g.nP + ' × ' + stk + ' (' + (g.stag ? g.cen.length + ' ' + T('Bohrungen') + arr : p.nY + ' ' + T('nebeneinander') + ' × ' + p.nZ + ' ' + T('übereinander')) + (p.nX > 1 ? ' × ' + p.nX + ' ' + T('hintereinander') : '') + '), ' + mat
      + (g.mid ? ' · ' + T('Reihen unter / über dem Verbinder') + ' ' + g.nLo + ' / ' + g.nUp : '') + '<br>';
    h += T('Masse') + ': ' + g.nP + ' × ' + fmt1(g.mPiece) + ' g = <b>' + fmt1(g.mBall) + ' g</b>' + ' · ' + T('Box') + ' ≈ ' + fmt1(mBox) + ' g (' + T('bei 100 % Füllung') + ')<br>';
    h += (g.roundB ? T('Bohrung') + ' Ø ' + fmt(g.cw) + ' mm' : T('Fach') + ' ' + fmt(g.cw) + ' × ' + fmt(g.ch) + ' mm') + ', ' + fmt(g.Di) + ' mm ' + T('tief') + (p.cells ? '' : ' (' + T('ohne Trennwände') + ')') + '<br>';
    h += T('Verbinder') + ' ' + fmt(p.jW) + ' × ' + fmt(p.jH) + ' mm' + (p.vDeg > 0 ? ', ' + T('V-Knick') + ' ' + fmt(p.vDeg) + '° (' + fmt(p.vDeg / 2) + '° ' + T('je Seite') + ')' : ', ' + T('gerade'))
      + ' · ' + T('Kanal für den Verbinder') + ' ' + fmt(p.jW + 2 * p.jClr) + ' × ' + fmt(g.chH) + ' mm' + (g.type === 'sleeve' ? ', ' + T('Hülsenlänge') + ' ' + fmt(p.slvL) + ' mm' : '') + '<br>';
    if (p.vDeg > 0) h += '<span style="color:#8a97a6">' + T('Durchgang gerade, damit sich der V-Verbinder durchschieben lässt') + ': ' + T('Höhe') + ' ' + fmt(g.chJ) + ' + ' + fmt(g.Lh) + ' × tan ' + fmt(p.vDeg / 2) + '° = ' + fmt(g.chH) + ' mm ('
      + T('Verbinder mit Spiel + halbe Kanallänge × Steigung je Seite') + '). ' + T('Beim Durchschieben kippt der Verbinder von flach in die V-Lage; eingebaut liegt der Knick unten in der Mitte auf, die Enden oben an den Kanalenden.') + '</span><br>';
    if (g.scr.length) {
      h += T('Klemmschraube') + ': ' + g.scr.length + ' × ' + p.scrM + ', ' + T('Länge ab Kopfauflage') + ' ≥ ' + Math.ceil(g.scrLen) + ' mm · ' + fixText(g);
      if (g.ears.length) h += ' · ' + T('außen in Augen (zwischen den Bohrungen kein Platz)');
      if (g.type === 'block' && g.fit !== 'none') h += ' · ' + T('Aussparung im Deckel') + ' Ø ' + fmt(2 * g.holeR) + ' mm';
      h += '<br>';
    }
    // Schwerpunkt des Ballasts gegenüber der Verbindermitte
    let xb = 0, zb = 0; g.pieces.forEach(q => { xb += (q.x0 + q.x1) / 2; zb += (q.z0 + q.z1) / 2; }); xb /= g.pieces.length || 1; zb /= g.pieces.length || 1;
    const xj = (g.jX0 + g.jX1) / 2, zj = g.jZ0 + g.jHv / 2;
    const cb = centroid(g.box), mB = vBox * p.rhoP, mAll = g.mBall + mB, xs = (g.mBall * xb + mB * cb[0]) / mAll, zs = (g.mBall * zb + mB * cb[2]) / mAll;
    const dirX = d => fmt1(Math.abs(d)) + ' mm ' + T(d >= -0.05 ? 'vor der Verbindermitte' : 'hinter der Verbindermitte'), dirZ = d => fmt1(Math.abs(d)) + ' mm ' + T(d >= -0.05 ? 'über der Verbindermitte' : 'unter der Verbindermitte');
    h += T('Schwerpunkt Ballast') + ': ' + dirX(xb - xj) + ', ' + dirZ(zb - zj) + ' · ' + T('mit Box') + ' ' + fmt1(xs - xj) + ' / ' + fmt1(zs - zj) + ' mm<br>';
    h += '<span style="color:#8a97a6">' + (g.type === 'block' && !g.mid ? T('Block nach vorn eingebaut; um 180° gedreht liegt der Ballast hinter dem Verbinder.') + ' ' : '')
      + T(g.type === 'sleeve' ? (g.fit === 'flush' ? 'Druck wie eingebaut (Boden unten). Der Absatz für den bündigen Deckel hängt unten frei: dort eine kleine Stütze setzen oder den Deckel „außen übergestülpt“ wählen (dann ganz ohne Stützen).' : 'Druck wie eingebaut (Boden unten), ohne Stützen.')
        : 'Druck auf der Rückseite stehend: Bohrungen senkrecht, nur der Verbinderkanal wird überbrückt.') + '</span>';
    g.warn.forEach(w => { h += '<br><span style="color:#ffb454">' + w + '</span>'; });
    return h;
  }
  function fileBase(p) {
    const stk = p.round ? 'D' + fmt(p.pD) + 'x' + fmt(p.pL) : fmt(p.pW) + 'x' + fmt(p.pH) + 'x' + fmt(p.pL);
    const pre = p.type === 'sleeve' ? 'ballastbox-huelse_' : p.type === 'block' ? 'ballastblock_' : 'ballastbox_';
    return (pre + p.nY + 'x' + p.nZ + (p.nX > 1 ? 'x' + p.nX : '') + '_' + stk).replace(/,/g, '-');
  }
  // Druckposition: Kasten steht auf der Rückseite (Öffnung oben, alles ohne Stützen), Deckel liegt auf der Platte
  function placed(g) {
    const out = [], pr = g.p.printPos === 'print';
    const xf = (v, m) => {   // m: Abbildung (x,y,z) → (X,Y,Z), orientierungserhaltend
      const o = new Float32Array(v.length);
      for (let i = 0; i < v.length; i += 3) { const q = m(v[i], v[i + 1], v[i + 2]); o[i] = q[0]; o[i + 1] = q[1]; o[i + 2] = q[2]; }
      return o;
    };
    // Hülse: wie eingebaut (Boden unten); Aufschieben mit kurzer Lippe hinten: auf der Seite y = −hw
    // (Profil in y extrudiert); sonst steht der Kasten/Block auf der Rückseite
    const box = !pr || g.type === 'sleeve' ? new Float32Array(g.box) : xf(g.box, g.side ? (x, y, z) => [x, -z, y] : (x, y, z) => [y, z, x]);
    out.push({ file: g.type === 'block' ? 'block' : 'kasten', v: box });
    if (g.lid) out.push({ file: 'deckel', v: pr ? xf(g.lid, (x, y, z) => [-y, z, -x]) : new Float32Array(g.lid) });
    // auf z = 0 setzen und nebeneinander legen
    let xOff = 0;
    out.forEach(it => {
      const v = it.v, b = bbox(v);
      for (let i = 0; i < v.length; i += 3) { v[i] += xOff - b.lo[0]; v[i + 1] -= b.lo[1]; v[i + 2] -= b.lo[2]; }
      xOff += b.hi[0] - b.lo[0] + 10;
    });
    return out;
  }
  // =====================================================================================
  //  Planzeichnung (DXF R12): Vorderansicht · Schnitt A–A in Flugrichtung · Draufsicht, bemaßt
  // =====================================================================================
  // Streifen { a, b, iv } eines Schnitts: x = konst. (u = y) bzw. y = konst. (u = x)
  function stripsX(M, x) {
    const out = []; if (!M) return out;
    let j = -1; for (let k = 0; k < M.nx; k++) if (x >= M.X[k] - 1e-9 && x < M.X[k + 1]) { j = k; break; }
    if (j < 0) return out;
    for (let i = 0; i < M.ny; i++) out.push({ a: M.Y[i], b: M.Y[i + 1], iv: M.cell(i, j) });
    return out;
  }
  function stripsY(M, y) {
    const out = []; if (!M) return out;
    let i = -1; for (let k = 0; k < M.ny; k++) if (y >= M.Y[k] - 1e-9 && y < M.Y[k + 1]) { i = k; break; }
    if (i < 0) return out;
    const f = (y - M.Y[i]) / (M.Y[i + 1] - M.Y[i]);
    for (let j = 0; j < M.nx; j++) out.push({ a: M.X[j], b: M.X[j + 1], iv: M.cell(i, j).map(s => { const l = s.l[0] + f * (s.l[1] - s.l[0]), h = s.h[0] + f * (s.h[1] - s.h[0]); return { l: [l, l], h: [h, h] }; }) });
    return out;
  }
  // Randkanten eines Schnitts als Strecken [[u, v], [u, v]]
  function edgeSegs(strips) {
    const segs = [];
    strips.forEach(s => s.iv.forEach(q => { segs.push([[s.a, q.l[0]], [s.b, q.l[1]]], [[s.a, q.h[0]], [s.b, q.h[1]]]); }));
    const at = (S, e) => S ? S.iv.map(q => ({ l: [q.l[e], q.l[e]], h: [q.h[e], q.h[e]] })) : [];
    const edge = (u, A, B) => ivDiff(A, B).concat(ivDiff(B, A)).forEach(q => segs.push([[u, q.l[0]], [u, q.h[0]]]));
    for (let k = 0; k <= strips.length; k++) {
      const P = k > 0 ? strips[k - 1] : null, N = k < strips.length ? strips[k] : null;
      if (P && N && Math.abs(P.b - N.a) > 1e-9) { edge(P.b, at(P, 1), []); edge(N.a, [], at(N, 0)); }
      else edge(P ? P.b : N.a, at(P, 1), at(N, 0));
    }
    return segs;
  }
  // Senkrechte Strecken derselben Linie an allen Endpunkten teilen, Doppelte entfernen
  function cleanSegs(segs) {
    const Kp = q => Math.round(q[0] * 1e4) + ',' + Math.round(q[1] * 1e4);
    const vert = new Map(), out = [], seen = new Set();
    const push = s => { const a = Kp(s[0]), b = Kp(s[1]); if (a === b) return; const k = a < b ? a + '|' + b : b + '|' + a; if (seen.has(k)) return; seen.add(k); out.push(s); };
    segs.forEach(s => {
      if (Math.abs(s[0][0] - s[1][0]) > 1e-7) { push(s); return; }
      const k = Math.round(s[0][0] * 1e4); if (!vert.has(k)) vert.set(k, []);
      vert.get(k).push([s[0][0], Math.min(s[0][1], s[1][1]), Math.max(s[0][1], s[1][1])]);
    });
    vert.forEach(L => {
      const zs = []; L.forEach(q => zs.push(q[1], q[2])); zs.sort((a, b) => a - b);
      L.forEach(q => { let z0 = q[1]; zs.forEach(z => { if (z > z0 + 1e-6 && z < q[2] - 1e-6) { push([[q[0], z0], [q[0], z]]); z0 = z; } }); push([[q[0], z0], [q[0], q[2]]]); });
    });
    return out;
  }
  // Strecken zu Polylinien verketten, gerade Zwischenpunkte entfernen
  function chain(segs) {
    const Kp = q => Math.round(q[0] * 1e4) + ',' + Math.round(q[1] * 1e4);
    const adj = new Map(), used = segs.map(() => false), out = [];
    segs.forEach((s, i) => [0, 1].forEach(e => { const k = Kp(s[e]); if (!adj.has(k)) adj.set(k, []); adj.get(k).push(i); }));
    const next = k => { const L = adj.get(k) || []; for (let n = 0; n < L.length; n++) if (!used[L[n]]) return L[n]; return -1; };
    segs.forEach((s0, i) => {
      if (used[i]) return; used[i] = true;
      const P = [s0[0], s0[1]];
      for (let j = next(Kp(P[P.length - 1])); j >= 0; j = next(Kp(P[P.length - 1]))) { used[j] = true; const s = segs[j]; P.push(Kp(s[0]) === Kp(P[P.length - 1]) ? s[1] : s[0]); }
      for (let j = next(Kp(P[0])); j >= 0; j = next(Kp(P[0]))) { used[j] = true; const s = segs[j]; P.unshift(Kp(s[0]) === Kp(P[0]) ? s[1] : s[0]); }
      let closed = false;
      if (P.length > 3 && Kp(P[0]) === Kp(P[P.length - 1])) { P.pop(); closed = true; }
      for (let ch = true; ch && P.length > (closed ? 3 : 2);) {
        ch = false;
        for (let k = closed ? 0 : 1; k < (closed ? P.length : P.length - 1); k++) {
          const a = P[(k - 1 + P.length) % P.length], b = P[k], c = P[(k + 1) % P.length];
          const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
          if (Math.abs(ux * vy - uy * vx) <= 1e-9 * Math.hypot(ux, uy) * Math.hypot(vx, vy) && ux * vx + uy * vy > 0) { P.splice(k, 1); ch = true; break; }
        }
      }
      out.push({ pts: P, closed });
    });
    return out;
  }
  // DXF R12 kennt kein UTF-8 sicher: Umlaute umschreiben, ° und Ø als AutoCAD-Steuercodes
  const dxfStr = s => String(s).replace(/ · /g, ', ').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .replace(/×/g, 'x').replace(/[–—]/g, '-').replace(/°/g, '%%d').replace(/Ø/g, '%%c').replace(/≈/g, '~').replace(/·/g, '-').replace(/[^\x20-\x7e]/g, '');

  function planDxf(g) {
    const layers = planLayers(g);
    return layers && window.Dxf ? Dxf.write(layers, { precision: ST().cfg.precision != null ? ST().cfg.precision : 3 }) : null;
  }
  // Zeichenhilfen der Planzeichnung (Ebenen, Linien, Texte, Maße)
  function planKit(p) {
    const K = { LK: [], LV: [], LB: [], LA: [], LM: [], TM: [], TT: [], TA: [] };
    const { LK, LM, TM } = K;
    K.line = (L, pts, closed) => L.push({ pts: pts.map(q => ({ x: q[0], y: q[1] })), closed: !!closed });
    K.rect = (L, x0, y0, x1, y1) => K.line(L, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true);
    K.outl = (segs, map) => chain(cleanSegs(segs)).forEach(pl => K.line(LK, pl.pts.map(map), pl.closed));
    K.text = (L, x, y, s, h, rot) => L.push({ x, y, text: dxfStr(s), raw: String(s), h: h || 2.5, rot: rot || 0 });
    const arrow = (x, y, dx, dy) => {   // Spitze bei (x, y), zeigt in Richtung (dx, dy)
      const L = 2.5, c = Math.cos(0.27), s = Math.sin(0.27), ux = -dx, uy = -dy;
      K.line(LM, [[x + L * (ux * c - uy * s), y + L * (uy * c + ux * s)], [x, y], [x + L * (ux * c + uy * s), y + L * (uy * c - ux * s)]]);
    };
    K.dimH = (xa, xb, ya, yb, yd, s) => {   // waagrecht: Hilfslinien von (xa, ya) / (xb, yb) bis yd
      const sa = yd >= ya ? 1 : -1, sb = yd >= yb ? 1 : -1;
      K.line(LM, [[xa, ya + sa], [xa, yd + sa * 1.5]]); K.line(LM, [[xb, yb + sb], [xb, yd + sb * 1.5]]);
      K.line(LM, [[xa, yd], [xb, yd]]); arrow(xa, yd, -1, 0); arrow(xb, yd, 1, 0);
      K.text(TM, (xa + xb) / 2, yd + 1, s);
    };
    K.dimV = (ya, yb, xa, xb, xd, s) => {   // senkrecht: Hilfslinien von (xa, ya) / (xb, yb) bis xd
      const sa = xd >= xa ? 1 : -1, sb = xd >= xb ? 1 : -1;
      K.line(LM, [[xa + sa, ya], [xd + sa * 1.5, ya]]); K.line(LM, [[xb + sb, yb], [xd + sb * 1.5, yb]]);
      K.line(LM, [[xd, ya], [xd, yb]]); arrow(xd, ya, 0, -1); arrow(xd, yb, 0, 1);
      K.text(TM, xd - 1, (ya + yb) / 2, s, 2.5, 90);
    };
    K.pieceFront = (L, q, mx, my) => {
      if (p.round) { const pts = []; for (let k = 0; k < 48; k++) { const a = 2 * Math.PI * k / 48; pts.push([(q.y0 + q.y1) / 2 + p.pD / 2 * Math.cos(a), (q.z0 + q.z1) / 2 + p.pD / 2 * Math.sin(a)]); } K.line(L, pts.map(r => [mx(r[0]), my(r[1])]), true); }
      else K.rect(L, mx(q.y0), my(q.z0), mx(q.y1), my(q.z1));
    };
    K.layers = () => [
      { name: 'KONTUR', color: 7, polys: K.LK },
      { name: 'BALLAST', color: 2, polys: K.LB },
      { name: 'VERBINDER', color: 1, ltype: 'DASHDOT', polys: K.LV },
      { name: 'SCHNITTLINIE', color: 1, ltype: 'DASHDOT', polys: K.LA, texts: K.TA },
      { name: 'MASSE', color: 3, polys: K.LM, texts: K.TM },
      { name: 'TEXT', color: 7, polys: [], texts: K.TT }
    ];
    return K;
  }
  function planLayers(g) {
    if (!g || !g.ok) return null;
    if (g.type !== 'lip') return planMount(g);
    const p = g.p, hw = g.W / 2, ov = g.lidOut, zb = y => g.zF + Math.abs(y) * g.tv;
    const K = planKit(p), { LK, LV, LB, LA, LM, TM, TT, TA, line, rect, outl, text, dimH, dimV, pieceFront } = K;

    // ---- Vorderansicht (Blick gegen die Flugrichtung, ohne Deckel): X = y, Y = z ----
    const xs = [Math.min(p.t, p.tWl) / 2];
    if (g.lx > 0.05) xs.push(g.lx + p.tWl / 2);
    if (g.lipL > 0.05) xs.push(g.lx + p.tWl + g.lipL / 2);
    const xm0 = Math.max(p.t, g.xL1);
    xs.push(g.xV1 - xm0 > 0.05 ? (xm0 + g.xV1) / 2 : (p.t + g.xV1) / 2);
    if (g.sd > 0) xs.push((g.xV1 + g.D) / 2);
    let fs = []; xs.forEach(x => { fs = fs.concat(edgeSegs(stripsX(g.MB, x))); });
    outl(fs, q => [q[0], q[1]]);
    const seen = new Set();
    g.pieces.forEach(q => { const k = q.y0.toFixed(3) + ',' + q.z0.toFixed(3); if (seen.has(k)) return; seen.add(k); pieceFront(LB, q, y => y, z => z); });
    const yj = hw + ov + 12;
    line(LV, [[-yj, zb(yj)], [0, zb(0)], [yj, zb(yj)], [yj, zb(yj) + g.jHv], [0, zb(0) + g.jHv], [-yj, zb(yj) + g.jHv]], true);
    dimH(-hw, hw, 0, 0, -8, fmt(g.W));
    dimV(0, g.hTop, -hw, -hw, -hw - 9, fmt(g.hTop));
    text(TT, 0, g.hTop + 9, T('Vorderansicht (ohne Deckel)'), 3.5);

    // ---- Schnitt A–A in Flugrichtung (durch ein Fach): X = X0 + x, Y = z ----
    const yS = p.cells && p.nY > 1 ? (p.nY % 2 ? 0 : -g.Wi / 2 + (p.nY / 2) * (g.cw + p.tD) + g.cw / 2) : 0;
    const X0 = hw + ov + 48, zS = zb(yS), lipS = g.lipB.a + Math.abs(yS) * g.tv;
    outl(edgeSegs(stripsY(g.MB, yS)), q => [X0 + q[0], q[1]]);
    if (g.ML) outl(edgeSegs(stripsY(g.ML, yS)), q => [X0 + q[0], q[1]]);
    g.pieces.forEach(q => { if (yS >= q.y0 - 1e-9 && yS <= q.y1 + 1e-9) rect(LB, X0 + q.x0, q.z0, X0 + q.x1, q.z1); });
    rect(LV, X0 + g.jX0, zS, X0 + g.jX1, zS + g.jHv);
    dimH(X0, X0 + g.D, 0, 0, -ov - 8, fmt(g.D));
    if (g.fit !== 'none') dimH(X0, X0 + g.Dtot, -ov, -ov, -ov - 15, fmt(g.Dtot));
    dimH(X0 + g.xP0, X0 + g.xL1, g.hTop, g.hTop, g.hTop + 7, fmt(g.xL1 - g.xP0));   // Lippe (mit Wand) gesamt
    if (g.lx > 0.05) dimH(X0, X0 + g.lx, g.hTop, g.hTop, g.hTop + 14, fmt(g.lx));   // Versatz bis zur Anschlagwand
    const xR = X0 + g.Dtot + 9;
    dimV(0, zS, X0 + g.D, X0 + g.xV1, xR, fmt(zS));
    dimV(zS, lipS, X0 + g.xV1, X0 + g.xL1, xR, fmt(lipS - zS));
    text(TT, X0 + g.Dtot / 2, g.hTop + (g.lx > 0.05 ? 23 : 16), T('Schnitt A–A'), 3.5);
    text(TT, X0 - 4, -4, T('hinten'), 2.5); text(TT, X0 + g.Dtot + 4, -4, T('vorne'), 2.5);

    // ---- Draufsicht: X = y, Y = Yt − x (vorne unten) ----
    const Yt = -ov - 36, TY = x => Yt - x;
    const xr = g.fit === 'flush' ? g.D - g.sd + Math.min(p.lidClr, g.sd / 2) : g.fit === 'over' ? g.D - g.sd : g.D;
    rect(LK, -hw, TY(0), hw, TY(xr));
    if (g.fit !== 'none') rect(LK, -hw - ov, TY(xr), hw + ov, TY(g.Dtot));
    if (g.fit === 'flush') line(LK, [[-hw, TY(g.xV1)], [hw, TY(g.xV1)]]);
    if (g.fit === 'flush') line(LK, [[-hw, TY(g.D)], [hw, TY(g.D)]]);
    line(LK, [[-hw, TY(g.xL1)], [hw, TY(g.xL1)]]);
    if (g.xP0 > 0.05) line(LK, [[-hw, TY(g.xP0)], [hw, TY(g.xP0)]]);   // Hinterkante der Lippe bzw. Anschlagwand
    g.loops.forEach(yc => rect(LK, yc - g.Lw / 2, TY(g.xP0), yc + g.Lw / 2, TY(g.xL1)));
    if (p.vDeg > 0) line(LK, [[0, TY(0)], [0, TY(g.xV1)]]);   // Knickkante der V-Form
    rect(LV, -yj, TY(g.jX0), yj, TY(g.jX1));
    // Schnittlinie A–A mit Blickrichtung (+y)
    const yA = yS, xA0 = -6, xA1 = g.Dtot + 6;
    line(LA, [[yA, TY(xA0)], [yA, TY(xA1)]]);
    [xA0, xA1].forEach(x => { line(LA, [[yA, TY(x)], [yA + 6, TY(x)]]); line(LA, [[yA + 4.5, TY(x) + 1], [yA + 6, TY(x)], [yA + 4.5, TY(x) - 1]]); text(TA, yA + 8.5, TY(x) - 1.2, 'A', 3.5); });
    dimV(TY(g.Dtot), TY(0), -hw - ov, -hw, -hw - ov - 9, fmt(g.Dtot));
    dimH(-hw - ov, hw + ov, TY(g.Dtot), TY(g.Dtot), TY(g.Dtot) - 14, fmt(g.W + 2 * ov));
    if (g.loops.length === 2) dimH(g.loops[0], g.loops[1], TY(0), TY(0), TY(0) + 7, fmt(g.loops[1] - g.loops[0]));
    text(TT, 0, TY(g.Dtot) - 24, T('Draufsicht'), 3.5);

    // ---- Schriftfeld ----
    const xc = X0 + g.Dtot / 2 + 10;
    let yl = Yt - 4;
    const ln = (s, h) => { text(TT, xc, yl, s, h || 2.5); yl -= (h || 2.5) * 1.9; };
    const stk = p.round ? 'Ø ' + fmt(p.pD) + ' × ' + fmt(p.pL) : fmt(p.pL) + ' × ' + fmt(p.pW) + ' × ' + fmt(p.pH);
    ln(T('Ballastbox'), 5);
    ln(T('Ballast') + ': ' + g.nP + ' × ' + stk + ' mm ' + T(MATS[p.mat][0]) + ' = ' + fmt1(g.mBall) + ' g');
    ln(p.nY + ' ' + T('nebeneinander') + ' × ' + p.nZ + ' ' + T('übereinander') + (p.nX > 1 ? ' × ' + p.nX + ' ' + T('hintereinander') : ''));
    ln(T('Fach') + ' ' + fmt(g.cw) + ' × ' + fmt(g.ch) + ' mm, ' + fmt(g.Di) + ' mm ' + T('tief') + ' · ' + T('Wand') + ' ' + fmt(p.t) + (p.cells ? ' · ' + T('Trennwand') + ' ' + fmt(p.tD) : '') + ' mm');
    ln(T('Verbinder') + ' ' + fmt(p.jW) + ' × ' + fmt(p.jH) + ' mm' + (p.vDeg > 0 ? ', ' + T('V-Knick') + ' ' + fmt(p.vDeg) + '°' : '') + ' · ' + T('Spiel') + ' ' + fmt(p.jClr) + ' mm'
      + (g.lx > 0.05 ? ' · ' + T('Verbinder nach vorn versetzt um') + ' ' + fmt(g.lx) + ' mm' : ''));
    if (g.fit !== 'none') ln(T('Deckel') + ': ' + T(g.fit === 'flush' ? 'bündig' : 'übergestülpt') + ', ' + T('Spiel') + ' ' + fmt(p.lidClr) + ' mm');
    if (g.loops.length) ln(T('Klettband') + ': ' + g.loops.length + ' × ' + fmt(p.strapW) + ' mm, ' + T('Länge je Band') + ' ~ ' + Math.ceil((strapLen(g) + 40) / 10) * 10 + ' mm');
    ln(T('Maße in mm') + ' · AI Foam Cut · ' + new Date().toISOString().slice(0, 10));

    return K.layers();
  }
  // Draufsicht aus dem Säulennetz: Umriss und Kanten, an denen die Oberkante springt; Strecken (u = y, v = x)
  function topSegs(M) {
    const segs = []; if (!M) return segs;
    const top = (i, j, e) => { const L = M.cell(i, j); if (!L.length) return null; let h = -Infinity; L.forEach(s => { h = Math.max(h, s.h[e]); }); return h; };
    const dif = (a, b) => (a == null) !== (b == null) || (a != null && Math.abs(a - b) > 1e-3);
    for (let j = 0; j <= M.nx; j++) for (let i = 0; i < M.ny; i++) {
      const a0 = j > 0 ? top(i, j - 1, 0) : null, a1 = j > 0 ? top(i, j - 1, 1) : null, b0 = j < M.nx ? top(i, j, 0) : null, b1 = j < M.nx ? top(i, j, 1) : null;
      if (dif(a0, b0) || dif(a1, b1)) segs.push([[M.Y[i], M.X[j]], [M.Y[i + 1], M.X[j]]]);
    }
    for (let i = 0; i <= M.ny; i++) for (let j = 0; j < M.nx; j++) {
      const a = i > 0 ? top(i - 1, j, 1) : null, b = i < M.ny ? top(i, j, 0) : null;
      if (dif(a, b)) segs.push([[M.Y[i], M.X[j]], [M.Y[i], M.X[j + 1]]]);
    }
    return segs;
  }
  // Planzeichnung Hülse / Durchsteckblock: Vorderansicht · Schnitt A–A · Draufsicht, bemaßt
  function planMount(g) {
    const p = g.p, ov = g.lidOut, bb = g.bb, lb = g.lid ? bbox(g.lid) : null;
    const K = planKit(p), { LK, LV, LB, LA, TT, TA, line, rect, outl, text, dimH, dimV, pieceFront } = K;
    const yMin = Math.min(bb.lo[1], lb ? lb.lo[1] : Infinity), yMax = Math.max(bb.hi[1], lb ? lb.hi[1] : -Infinity);
    const zMin = Math.min(bb.lo[2], lb ? lb.lo[2] : Infinity), zMax = Math.max(bb.hi[2], lb ? lb.hi[2] : -Infinity);
    const zj = y => g.jZ0 + Math.abs(y) * g.tv;

    // ---- Vorderansicht (ohne Deckel): X = y, Y = z ----
    let fs = []; g.secXs.forEach(q => { fs = fs.concat(edgeSegs(stripsX(g.MB, q.x))); });
    outl(fs, q => [q[0], q[1]]);
    const seen = new Set();
    g.pieces.forEach(q => { const k = q.y0.toFixed(3) + ',' + q.z0.toFixed(3); if (seen.has(k)) return; seen.add(k); pieceFront(LB, q, y => y, z => z); });
    const yj = Math.max(-yMin, yMax) + 12;
    line(LV, [[-yj, zj(yj)], [0, zj(0)], [yj, zj(yj)], [yj, zj(yj) + g.jHv], [0, zj(0) + g.jHv], [-yj, zj(yj) + g.jHv]], true);
    g.scr.forEach(q => { line(LV, [[q.y - 3, q.z], [q.y + 3, q.z]]); line(LV, [[q.y, q.z - 3], [q.y, q.z + 3]]); });   // Schraubenachsen
    dimH(bb.lo[1], bb.hi[1], bb.lo[2], bb.lo[2], bb.lo[2] - 8, fmt(bb.hi[1] - bb.lo[1]));
    dimV(bb.lo[2], bb.hi[2], bb.lo[1], bb.lo[1], bb.lo[1] - 9, fmt(bb.hi[2] - bb.lo[2]));
    if (g.scr.length === 2) dimH(g.scr[0].y, g.scr[1].y, g.scr[0].z, g.scr[1].z, bb.hi[2] + 7, fmt(g.scr[1].y - g.scr[0].y));
    text(TT, (bb.lo[1] + bb.hi[1]) / 2, zMax + (g.scr.length === 2 ? 16 : 9), T('Vorderansicht (ohne Deckel)'), 3.5);

    // ---- Schnitt A–A in Flugrichtung (durch ein Fach): X = X0 + x, Y = z ----
    const yS = g.yS, X0 = yMax + 48;
    outl(edgeSegs(stripsY(g.MB, yS)), q => [X0 + q[0], q[1]]);
    if (g.ML) outl(edgeSegs(stripsY(g.ML, yS)), q => [X0 + q[0], q[1]]);
    g.pieces.forEach(q => { if (yS >= q.y0 - 1e-9 && yS <= q.y1 + 1e-9) rect(LB, X0 + q.x0, q.z0, X0 + q.x1, q.z1); });
    rect(LV, X0 + g.jX0, zj(yS), X0 + g.jX1, zj(yS) + g.jHv);
    dimH(X0, X0 + g.D, zMin, zMin, zMin - 8, fmt(g.D));
    if (g.fit !== 'none') dimH(X0, X0 + g.Dtot, zMin, zMin, zMin - 15, fmt(g.Dtot));
    const xjm = (g.jX0 + g.jX1) / 2;
    dimH(X0, X0 + xjm, zMax, zj(yS) + g.jHv, zMax + 7, fmt(xjm));   // Verbindermitte ab Rückseite
    const xR = X0 + g.Dtot + 9;
    dimV(0, zj(yS), X0 + g.D, X0 + g.jX1, xR, fmt(zj(yS)));         // Verbinder-Unterkante über dem Boden
    text(TT, X0 + g.Dtot / 2, zMax + 16, T('Schnitt A–A'), 3.5);
    text(TT, X0 - 4, zMin - 4, T('hinten'), 2.5); text(TT, X0 + g.Dtot + 4, zMin - 4, T('vorne'), 2.5);

    // ---- Draufsicht: X = y, Y = Yt − x (vorne unten) ----
    const Yt = zMin - ov - 36, TY = x => Yt - x;
    outl(topSegs(g.MB).concat(topSegs(g.ML)), q => [q[0], TY(q[1])]);
    rect(LV, -yj, TY(g.jX0), yj, TY(g.jX1));
    g.scr.forEach(q => line(LV, [[q.y, TY(g.jX1 - 2)], [q.y, TY(q.xb + 0.7 * g.S.d + 2)]]));
    const xA0 = -6, xA1 = g.Dtot + 6;
    line(LA, [[yS, TY(xA0)], [yS, TY(xA1)]]);
    [xA0, xA1].forEach(x => { line(LA, [[yS, TY(x)], [yS + 6, TY(x)]]); line(LA, [[yS + 4.5, TY(x) + 1], [yS + 6, TY(x)], [yS + 4.5, TY(x) - 1]]); text(TA, yS + 8.5, TY(x) - 1.2, 'A', 3.5); });
    dimV(TY(g.Dtot), TY(0), yMin, yMin, yMin - 9, fmt(g.Dtot));
    dimH(yMin, yMax, TY(g.Dtot), TY(g.Dtot), TY(g.Dtot) - 14, fmt(yMax - yMin));
    text(TT, (yMin + yMax) / 2, TY(g.Dtot) - 24, T('Draufsicht'), 3.5);

    // ---- Schriftfeld ----
    const xc = X0 + g.Dtot / 2 + 10;
    let yl = Yt - 4;
    const ln = (s, h) => { text(TT, xc, yl, s, h || 2.5); yl -= (h || 2.5) * 1.9; };
    const stk = p.round ? 'Ø ' + fmt(p.pD) + ' × ' + fmt(p.pL) : fmt(p.pL) + ' × ' + fmt(p.pW) + ' × ' + fmt(p.pH);
    ln(T(TYPE_NAME[g.type]), 5);
    ln(T('Ballast') + ': ' + g.nP + ' × ' + stk + ' mm ' + T(MATS[p.mat][0]) + ' = ' + fmt1(g.mBall) + ' g');
    if (g.mid) ln(T('Reihen unter / über dem Verbinder') + ' ' + g.nLo + ' / ' + g.nUp);
    ln((g.roundB ? T('Bohrung') + ' Ø ' + fmt(g.cw) : T('Fach') + ' ' + fmt(g.cw) + ' × ' + fmt(g.ch)) + ' mm, ' + fmt(g.Di) + ' mm ' + T('tief') + ' · ' + T('Wand') + ' ' + fmt(p.t) + (p.cells ? ' · ' + T('Trennwand') + ' ' + fmt(p.tD) : '') + ' mm');
    ln(T('Verbinder') + ' ' + fmt(p.jW) + ' × ' + fmt(p.jH) + ' mm' + (p.vDeg > 0 ? ', ' + T('V-Knick') + ' ' + fmt(p.vDeg) + '°' : '') + ' · ' + T('Spiel') + ' ' + fmt(p.jClr) + ' mm');
    ln(T('Kanal für den Verbinder') + ' ' + fmt(p.jW + 2 * p.jClr) + ' × ' + fmt(g.chH) + ' mm' + (p.vDeg > 0 ? ' (' + T('gerade, zum Durchschieben') + ')' : ''));
    if (g.scr.length) ln(T('Klemmschraube') + ': ' + g.scr.length + ' × ' + p.scrM + ' ≥ ' + Math.ceil(g.scrLen) + ' mm, ' + fixText(g));
    if (g.fit !== 'none') ln(T('Deckel') + ': ' + T(g.fit === 'flush' ? 'bündig' : 'übergestülpt') + ', ' + T('Spiel') + ' ' + fmt(p.lidClr) + ' mm' + (g.type === 'block' && g.scr.length ? ', ' + T('Aussparung') + ' Ø ' + fmt(2 * g.holeR) + ' mm' : ''));
    ln(T('Maße in mm') + ' · AI Foam Cut · ' + new Date().toISOString().slice(0, 10));
    return K.layers();
  }
  function exportDxf() {
    if (!G || !G.ok) { alert(G && G.msg ? G.msg : T('Keine Box.')); return; }
    const txt = planDxf(G);
    if (!txt) { if (App.toast) App.toast(T('Nichts zu speichern.')); return; }
    if (App.exportViaPicker) App.exportViaPicker(fileBase(G.p) + '_plan.dxf', txt, 'application/dxf', 'svDxf');
    else if (App.download) App.download(fileBase(G.p) + '_plan.dxf', txt, 'application/dxf', 'svDxf');
  }
  // Planzeichnung in den Reiter CAD-Bearbeitung: Konturen über den DXF-Import, Beschriftungen direkt
  // (der DXF-Import liest keine TEXT-Elemente), danach in den Reiter wechseln.
  function toCad() {
    const layers = G && G.ok ? planLayers(G) : null, txt = layers && window.Dxf ? Dxf.write(layers, { precision: 4 }) : null;
    const cad = ST().cad;
    if (!txt || !App.cadImportDxfText || !cad) { if (App.toast) App.toast(T('Nichts zu übernehmen.')); return; }
    const before = cad.texts;
    App.cadImportDxfText(txt, T('Ballastbox'));
    if (cad.texts === before) return;   // Import abgelehnt (vorhandene Zeichnung behalten)
    layers.forEach(l => (l.texts || []).forEach(t => cad.texts.push({ x: t.x, y: t.y, h: t.h, text: t.raw != null ? t.raw : t.text, rot: t.rot || 0, layer: cad.layers && cad.layers[l.name] ? l.name : 'KONTUR' })));
    if (App.switchView) App.switchView('cad'); else if (App.renderCad) App.renderCad();
  }
  async function exportAll() {
    if (!G || !G.ok) { alert(G && G.msg ? G.msg : T('Keine Box.')); return; }
    const base = fileBase(G.p), list = placed(G).map(it => ({ name: base + '_' + it.file + '.stl', v: it.v }));
    if (App.stlSaveMany) await App.stlSaveMany(list, 'svStl', { name: base + '.3mf' });
    else if (App.download && App.stlBinary) for (const it of list) await App.download(it.name, App.stlBinary(it.v), 'model/stl', 'svStl');
  }

  function refresh() {
    try { G = geometry(params(C())); } catch (e) { console.error(e); G = { ok: false, msg: T('Fehler beim Aufbau der Box:') + ' ' + (e && e.message ? e.message : e), warn: [] }; }
    makeScene();
    infoHTML();
    draw();
  }
  function show() { wire(); refresh(); }
  function resize() { draw(); }

  // =====================================================================================
  //  Seitenleiste
  // =====================================================================================
  function ballastSidebar(side) {
    const { grp, hint, numRow, boolRow, selectRow, subhead } = App;
    if (!grp || !numRow) return;
    const c = C(), p = params(c);
    const RD = () => { if (ST().activeTab === TAB) refresh(); };
    const RB = () => { if (App.buildSidebar) App.buildSidebar(); RD(); };
    const N = (body, label, key, o) => numRow(body, label, () => c[key], v => { c[key] = v; RD(); }, Object.assign({ step: 1, norender: true }, o || {}));
    const SEL = (body, label, opts, key, rebuild, h) => selectRow(body, label, opts, () => String(c[key]), v => { c[key] = v; rebuild ? RB() : RD(); }, h);
    const button = (body, txt, fn, title) => {
      const row = document.createElement('div'); row.className = 'row';
      const b = document.createElement('button'); b.type = 'button'; b.textContent = T(txt); b.style.cssText = 'flex:1'; if (title) b.title = T(title);
      b.onclick = fn; row.appendChild(b); body.appendChild(row); return b;
    };

    const lip = p.type === 'lip', sleeve = p.type === 'sleeve', block = p.type === 'block';
    // ---- Bauart ----
    const g0 = grp('Bauart der Box', true, TAB, { key: 'ballType' });
    SEL(g0.body, 'Box-Typ', [['lip', 'Aufschieben mit Lippe und Klettband'], ['sleeve', 'Kasten mit Hülse und Klemmschraube'], ['block', 'Durchsteckblock mit Klemmschrauben']], 'type', true);
    hint(g0.body, lip ? 'Die Box wird bei montiertem Modell von vorn auf den Verbinder geschoben und mit Klettbändern festgezurrt.'
      : sleeve ? 'Kasten mit Fächern, oben eine Hülse quer um den Verbinder. Eine Klemmschraube vorn in der Hülse drückt den Verbinder gegen die hintere Hülsenwand. Die Fächer werden von vorn beladen und mit dem Deckel verschlossen.'
        : 'Der Verbinder wird quer durch den Block geschoben, Klemmschrauben von vorn drücken ihn gegen die Rückwand. Ein Deckel verschließt alle Bohrungen auf einmal (statt jedes Stück einzeln zu verschrauben) und hat Aussparungen für die Schraubenköpfe.');

    // ---- Verbinder ----
    const g1 = grp('Verbinder (Steckung)', true, TAB, { key: 'ballMain' });
    if (lip) hint(g1.body, 'Die Box wird bei montiertem Modell von vorn auf den Verbinder geschoben: Er liegt auf der Oberseite des Kastens, hinten an der Anschlagwand und unter der Lippe. Festgezurrt wird mit Klettbändern.');
    N(g1.body, 'Breite in Flugrichtung (mm)', 'jW', { step: 0.5, min: 1 });
    N(g1.body, 'Höhe (mm)', 'jH', { step: 0.5, min: 1, hint: 'Höhe des Verbinders in Dickenrichtung (senkrecht zur Verbinderachse gemessen).' });
    N(g1.body, 'V-Form: Knickwinkel gesamt (°)', 'vDeg', { step: 0.5, min: 0, max: 40, hint: lip ? 'Winkel zwischen den beiden Verbinderhälften = V-Form links + rechts. Auflage, Lippe und Schlaufen folgen dem Knick in der Mitte. 0 = gerader Verbinder.'
      : 'Winkel zwischen den beiden Verbinderhälften = V-Form links + rechts. Der Durchgang bleibt gerade und wird um halbe Kanallänge × Steigung je Seite höher, damit sich der Verbinder durchschieben lässt. 0 = gerader Verbinder.' });
    if (lip) N(g1.body, 'Spiel über dem Verbinder (mm)', 'jClr', { step: 0.1, min: 0, hint: 'Luft zwischen Verbinder und Lippe, damit sich die Box leicht aufschieben lässt.' });
    else N(g1.body, 'Spiel um den Verbinder (mm, je Seite)', 'jClr', { step: 0.1, min: 0, hint: 'Luft im Kanal rundum, damit sich der Verbinder leicht durchschieben lässt; die Klemmschraube nimmt das Spiel heraus.' });
    const src = sources();
    if (src.length) {
      subhead(g1.body, 'Werte übernehmen');
      if (!src.some(s => s.id === c.pick)) c.pick = src[0].id;
      selectRow(g1.body, 'Quelle', src.map(s => [s.id, s.label]), () => c.pick, v => { c.pick = v; }, null);
      button(g1.body, 'Übernehmen', () => {
        const s = sources().find(q => q.id === c.pick); if (!s) return;
        const txt = s.apply(c); if (App.toast) App.toast(T('Übernommen:') + ' ' + txt);
        RB();
      }, 'Querschnitt und Knickwinkel einmalig in die eigenen Werte kopieren — danach bleibt alles frei änderbar.');
    }
    if (App.wing && App.wing.stations && App.wing.stations.length > 1) {
      const v2 = Math.round(Math.abs(2 * segAngle(0)) * 100) / 100;
      button(g1.body, T('V-Form der Tragfläche übernehmen') + ' (' + fmt(v2) + '°)', () => { c.vDeg = v2; RB(); }, 'Knickwinkel = 2 × V-Form des ersten Segments (Tragflächendesign).');
    }

    // ---- Ballaststücke ----
    const g2 = grp('Ballaststücke', true, TAB, { key: 'ballPieces' });
    SEL(g2.body, 'Form', [['rect', 'Quader (Flachmaterial)'], ['round', 'Rundmaterial']], 'pShape', true);
    if (p.round) {
      N(g2.body, 'Durchmesser (mm)', 'pD', { step: 0.5, min: 0.5 });
      N(g2.body, 'Länge in Flugrichtung (mm)', 'pL', { step: 1, min: 1 });
    } else {
      N(g2.body, 'Länge in Flugrichtung (mm)', 'pL', { step: 1, min: 1, hint: 'Die Stücke werden von vorn in die Fächer geschoben; die Länge bestimmt die Tiefe der Box.' });
      N(g2.body, 'Breite (Spannweite, mm)', 'pW', { step: 0.5, min: 0.5 });
      N(g2.body, 'Höhe (mm)', 'pH', { step: 0.5, min: 0.5 });
    }
    if (!lip && p.round && p.cells) SEL(g2.body, 'Anordnung', [['grid', 'Raster'], ['stagger', 'Versetzt (dichter, jede zweite Reihe ein Stück weniger)']], 'arr', true);
    N(g2.body, 'Anzahl nebeneinander', 'nY', { step: 1, min: 1, max: 30, int: true, hint: 'Nebeneinander (in Spannweitenrichtung) × übereinander × hintereinander = Anzahl der Stücke. Daraus ergeben sich Breite, Höhe und Tiefe der Box.' });
    if (block) numRow(g2.body, 'Anzahl übereinander', () => c.nZ, v => { c.nZ = v; RB(); }, { step: 1, min: 1, max: 30, int: true, norender: true });   // Block: „Lage des Verbinders“ hängt davon ab
    else N(g2.body, 'Anzahl übereinander', 'nZ', { step: 1, min: 1, max: 30, int: true });
    N(g2.body, 'Anzahl hintereinander', 'nX', { step: 1, min: 1, max: 20, int: true });
    N(g2.body, 'Spiel je Seite (mm)', 'pClr', { step: 0.05, min: 0, hint: 'Luft um jedes Stück im Fach. Für den 3D-Druck etwa 0,2–0,3 mm.' });
    SEL(g2.body, 'Werkstoff', Object.keys(MATS).map(k => [k, T(MATS[k][0]) + (MATS[k][1] ? ' (' + fmt(MATS[k][1]) + ' g/cm³)' : '')]), 'mat', true);
    if (p.mat === 'own') N(g2.body, 'Dichte (g/cm³)', 'rho', { step: 0.1, min: 0.1 });

    // ---- Kasten ----
    const g3 = grp(lip ? 'Kasten und Aufnahme' : sleeve ? 'Kasten und Hülse' : 'Block', false, TAB, { key: 'ballBox' });
    N(g3.body, 'Wandstärke außen (mm)', 't', { step: 0.2, min: 0.4, hint: lip ? 'Boden, Seiten, Rückwand und Decke (an der dünnsten Stelle in der Mitte unter dem Verbinder).' : 'Boden, Seiten, Rückwand und Decke; beim Block auch die Wand um den Verbinderkanal.' });
    boolRow(g3.body, 'Trennwände zwischen den Stücken', () => !!c.cells, v => { c.cells = v; RB(); }, 'Jedes Stück bekommt ein eigenes Fach. Ohne Trennwände liegen alle Stücke in einem gemeinsamen Raum.');
    if (p.cells) N(g3.body, 'Stärke der Trennwände (mm)', 'tD', { step: 0.1, min: 0.4 });
    if (lip) {
      N(g3.body, 'Stärke der Anschlagwand (mm)', 'tWl', { step: 0.2, min: 0.4, hint: 'Der senkrechte Steg hinter dem Verbinder: Er steht auf dem Kasten und reicht bis über den Verbinder.' });
      N(g3.body, 'Stärke der Lippe (mm)', 'tJ', { step: 0.2, min: 0.4, hint: 'Die Lippe greift von oben über den Verbinder (bei Versatz auch die Platte nach hinten).' });
      N(g3.body, 'Lippe über dem Verbinder (mm, 0 = keine)', 'lipL', { step: 0.5, min: 0, hint: 'So weit reicht die Lippe von der Anschlagwand nach vorn über den Verbinder (höchstens Verbinderbreite).' });
      numRow(g3.body, 'Verbinder nach vorn versetzt (mm, 0 = hinten am Kasten)', () => c.lipX, v => { c.lipX = v; RB(); }, { step: 1, min: 0, norender: true,
        hint: 'Anschlagwand, Lippe und Verbinder rücken um diesen Wert nach vorn, der Kasten reicht hinter den Verbinder — der Ballast liegt dann vor und hinter dem Verbinder.' });
      const xMid = Math.max(0, Math.round((p.t + (p.nX * p.pL + 2 * p.pClr) / 2 - p.tWl - p.jW / 2) * 10) / 10);
      button(g3.body, T('Verbinder über die Ballastmitte') + ' (' + fmt(xMid) + ' mm)', () => { c.lipX = xMid; RB(); },
        'Versatz so wählen, dass die Verbindermitte über der Mitte des Ballasts liegt (Schwerpunkt in Flugrichtung unverändert).');
      if (p.lipX > 0) {
        boolRow(g3.body, 'Lippe nach hinten bis zur Kastenkante', () => c.lipBkFull !== false, v => { c.lipBkFull = v; RB(); },
          'Die Lippe läuft als Platte von der Anschlagwand nach hinten bis zur Kastenkante: Das Klettband liegt auf, und der Druck auf der Rückseite bleibt ohne Stützen. Aus: eigene Länge hinter der Anschlagwand (0 = keine) — dann wird die Box auf der Seite liegend gedruckt.');
        if (!p.lipBkFull) numRow(g3.body, 'Lippe hinter der Anschlagwand (mm, 0 = keine)', () => c.lipBk, v => { c.lipBk = v; RB(); }, { step: 1, min: 0, norender: true });
      }
    } else if (sleeve) {
      N(g3.body, 'Hülsenlänge (Spannweite, mm)', 'slvL', { step: 1, min: 5 });
      N(g3.body, 'Wandstärke der Hülse (mm)', 'slvT', { step: 0.2, min: 0.8, hint: 'Die vordere Wand wird bei Bedarf dicker, damit Mutter oder Gewindeeinsatz hineinpassen.' });
      N(g3.body, 'Hülse versetzt nach vorn (mm)', 'slvX', { step: 1, hint: '0 = Verbindermitte genau über der Mitte des Ballasts (Schwerpunkt bleibt in Flugrichtung unverändert). Positiv = Hülse weiter vorn, negativ = weiter hinten.' });
    } else {
      SEL(g3.body, 'Lage des Verbinders', [['rear', 'Hinter dem Ballast'], ['mid', 'Zwischen den Reihen (Ballast darüber und darunter)']], 'bJoin', true,
        'Zwischen den Reihen: Die Reihen werden oben und unten auseinandergerückt, der Verbinder läuft mittig dazwischen hindurch — der Schwerpunkt bleibt in Flugrichtung auf der Verbindermitte, der Block wird kürzer. Braucht mindestens 2 Stücke übereinander; bei ungerader Anzahl liegt die zusätzliche Reihe unten.');
      if (p.round && p.cells) SEL(g3.body, 'Außenform', [['rect', 'Kasten (rechteckig)'], ['lobed', 'Gerundet um die Bohrungen']], 'outline', true);
      N(g3.body, 'Wand zwischen Verbinder und Ballast (mm)', 'tJ', { step: 0.2, min: 0.4 });
      if (!(p.bJoin === 'mid' && p.nZ >= 2)) N(g3.body, 'Verbinder höher/tiefer (mm, 0 = Mitte des Ballasts)', 'jzOff', { step: 1, hint: 'Lage des Verbinderkanals über der Mitte der Ballastpackung. Positiv = Verbinder weiter oben.' });
    }

    let g4;
    if (lip) {
      // ---- Klettbänder ----
      g4 = grp('Klettband-Schlaufen', false, TAB, { key: 'ballStrap' });
      SEL(g4.body, 'Anzahl Schlaufen', [['0', 'Keine'], ['1', 'Eine (Mitte)'], ['2', 'Zwei (außen)']], 'strapN', true,
        'Die Schlaufen sitzen auf der Lippe. Das Band läuft in Flugrichtung hindurch, vorn über Verbinder und Deckel nach unten, unter dem Kasten zurück und hinten wieder hoch.');
      if (+c.strapN > 0) {
        N(g4.body, 'Klettband-Breite (mm)', 'strapW', { step: 1, min: 3, hint: 'Der Schlitz wird 1 mm breiter als das Band.' });
        N(g4.body, 'Schlitzhöhe (mm)', 'strapT', { step: 0.5, min: 0.5 });
        N(g4.body, 'Stegstärke der Schlaufe (mm)', 'strapPost', { step: 0.2, min: 0.6 });
        if (+c.strapN === 2) N(g4.body, 'Abstand Mitte–Mitte (mm, 0 = außen bündig)', 'strapPos', { step: 1, min: 0 });
      }
    } else {
      // ---- Klemmschrauben ----
      g4 = grp('Klemmschrauben', false, TAB, { key: 'ballScrew' });
      hint(g4.body, sleeve ? 'Die Schraube sitzt vorn in der Hülse und klemmt den Verbinder gegen die hintere Hülsenwand.'
        : 'Die Schrauben laufen von vorn durch den Block bis zum Verbinderkanal und drücken den Verbinder gegen die Rückwand. Sie sitzen zwischen den Bohrungen oder, wenn dort kein Platz ist, außen in Augen.');
      SEL(g4.body, 'Anzahl Schrauben', sleeve ? [['1', 'Eine (Mitte)'], ['2', 'Zwei']] : [['1', 'Eine'], ['2', 'Zwei']], sleeve ? 'sScrN' : 'bScrN', false);
      SEL(g4.body, 'Gewindegröße', Object.keys(SCR).map(k => [k, k]), 'scrM', false);
      SEL(g4.body, 'Gewinde im Druckteil', [['nut', FIX_NAME.nut], ['insert', FIX_NAME.insert], ['tap', FIX_NAME.tap]], 'scrFix', true,
        'Die Mutter sitzt direkt am Verbinderkanal und wird von dort eingelegt — die Schraube drückt sie beim Spannen gegen das Material statt aus der Tasche. Einschmelzmutter und Kernloch liegen vorn an der Stirnseite.');
      if (p.scrFix === 'insert') N(g4.body, 'Bohrung für den Einsatz Ø (mm, 0 = Standard)', 'insD', { step: 0.1, min: 0, hint: 'Standard je Größe: M3 4,0 · M4 5,6 · M5 6,4 · M6 8,0 mm (übliche Einschmelzmuttern).' });
      if (block && p.lid) N(g4.body, 'Aussparung im Deckel Ø (mm, 0 = Kopf + 2 mm)', 'lidHoleD', { step: 0.5, min: 0, hint: 'Durch diese Löcher ragen die Schraubenköpfe; der Deckel lässt sich abnehmen, ohne die Schrauben zu lösen. Für Rändelschrauben den Kopfdurchmesser + 2 mm eintragen.' });
    }

    // ---- Deckel ----
    const g5 = grp('Deckel', false, TAB, { key: 'ballLid' });
    boolRow(g5.body, 'Deckel erzeugen', () => !!c.lid, v => { c.lid = v; RB(); }, lip ? 'Stülpdeckel vorn über der Öffnung; er wird von den Klettbändern gehalten.' : 'Stülpdeckel vorn über der Öffnung, er hält im Klemmsitz (Spiel klein wählen) und verschließt alle Fächer auf einmal.');
    if (p.lid) {
      SEL(g5.body, 'Sitz', [['flush', 'Bündig (Absatz am Kasten)'], ['over', 'Außen übergestülpt']], 'lidFit', false,
        sleeve ? 'Bündig: Der Kasten ist vorn rundum um Randstärke + Spiel eingezogen (braucht Wandstärke ≥ Randstärke + Spiel + 0,6 mm); beim Druck wie eingebaut hängt der Absatz unten frei und braucht eine kleine Stütze. Übergestülpt: Der Deckel ist rundum etwas größer als der Kasten, Druck ganz ohne Stützen.'
          : 'Bündig: Der Kasten ist vorn um Randstärke + Spiel eingezogen, der Deckel schließt außen bündig ab (braucht Wandstärke ≥ Randstärke + Spiel + 0,6 mm). Übergestülpt: Der Deckel ist rundum etwas größer als der Kasten.');
      N(g5.body, 'Stärke der Deckelplatte (mm)', 'lidT', { step: 0.2, min: 0.4 });
      N(g5.body, 'Randstärke (mm)', 'lidWall', { step: 0.1, min: 0.4 });
      N(g5.body, 'Randhöhe (mm)', 'lidRim', { step: 0.5, min: 1 });
      N(g5.body, 'Spiel (mm)', 'lidClr', { step: 0.05, min: 0 });
    }

    // ---- Ansicht und Export ----
    const g6 = grp('Ansicht und Export', false, TAB, { key: 'ballView' });
    const vw = c.view;
    numRow(g6.body, 'Deckel abrücken (mm)', () => vw.explode, v => { vw.explode = v; RD(); }, { step: 5, min: 0, norender: true });
    boolRow(g6.body, 'Verbinder zeigen', () => !!vw.joiner, v => { vw.joiner = v; RD(); });
    boolRow(g6.body, 'Ballast zeigen', () => !!vw.ballast, v => { vw.ballast = v; RD(); });
    boolRow(g6.body, 'Vorder- und Seitenansicht einblenden', () => !!vw.sec, v => { vw.sec = v; RD(); });
    N(g6.body, 'Dichte Druckwerkstoff (g/cm³)', 'rhoP', { step: 0.01, min: 0.1, hint: 'Nur für die Massenschätzung der Box (PLA ≈ 1,24, PETG ≈ 1,27, ASA ≈ 1,07).' });
    if (lip) SEL(g6.body, 'Lage im Export', [['print', p.lipX > 0 && !p.lipBkFull && p.lipBk < p.lipX ? 'Druckposition (Kasten auf der Seite liegend, ohne Stützen)' : 'Druckposition (Kasten auf der Rückseite, ohne Stützen)'], ['asm', 'Wie eingebaut']], 'printPos', true);
    else if (block) SEL(g6.body, 'Lage im Export', [['print', 'Druckposition (Block auf der Rückseite, Bohrungen senkrecht)'], ['asm', 'Wie eingebaut']], 'printPos', false);
    button(g6.body, 'STL / 3MF exportieren …', () => exportAll(), 'Kasten und Deckel als STL bzw. gemeinsam als 3MF (mit Vorschau).');
    button(g6.body, 'Planzeichnung als DXF …', () => exportDxf(), 'Vorderansicht, Schnitt A–A in Flugrichtung und Draufsicht im Maßstab 1:1 mit Maßen und Schriftfeld; Ebenen Kontur, Ballast, Verbinder, Schnittlinie, Maße, Text.');
    if (App.cadImportDxfText) button(g6.body, 'Planzeichnung ins CAD übernehmen', () => toCad(), 'Die Planzeichnung im Reiter CAD-Bearbeitung öffnen (dort weiter bearbeiten oder als PDF drucken).');
    [g0, g1, g2, g3, g4, g5, g6].forEach(g => side.appendChild(g.g));
  }

  App.ballastSidebar = ballastSidebar;
  window.Ballastbox = { show, refresh, resize, _test: { geometry, params, DEF, colMesh, checkMesh, signedVolume, centroid, bbox, placed, secX, secY, sources, C, planDxf, planLayers, edgeSegs, chain, cleanSegs, stripsX, stripsY, topSegs, SCR } };
})();
