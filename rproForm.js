/* rproForm.js — Reiter „Rumpf Formenbau" (Feature „rproForm", braucht „rumpfpro").
 * Leitet aus dem Rumpf (rumpfpro.js, window.RumpfPro.api()) Formen als STL ab — wie der Reiter
 * „Formenbau" für Tragflächen. Rumpf und Kabinenhaube liegen im selben Modul (Auswahl „Bauteil"),
 * weil beide dieselbe Rumpffläche und denselben Blockaufbau nutzen:
 *   Rumpf        Negativform (zwei Halbschalen-Formen, Trennebene Z = 0), geteiltes Urmodell
 *                (Halbschale auf Trennplatte), Urmodell (ganzer Rumpf)
 *   Kabinenhaube Tiefziehklotz (Positiv, mit Zugabe und Sockel) oder Negativform; die Haubenlinie
 *                kommt aus dem Rumpf (Gruppe „Kabinenhaube", api().canopy)
 *   dazu         Formenrand mit Passlöchern (Rumpf), Teilung in Druckstücke quer zur Rumpfachse
 * Aufbau: jeder Block ist ein Höhenfeld über Spalten x = const. Eine Spalte ist ein Linienzug
 * [[u, h], …] (u quer, h Höhe über der Bezugsebene; Rumpf: u = Y, h = Z · Haube: u = Z, h = Y − yB).
 * Rückseite = Projektion des Randes auf h = zb, Wände über die Randkanten -> immer geschlossen.
 * Andere Module rufen nur geschützt (App.rprofSidebar && …, window.RproForm).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const r1 = v => Math.round(v * 10) / 10;

  // ---------- Konfiguration (state.cfg.rprof) ---------------------------------------------
  const DEF = {
    part: 'fus',              // 'fus' Rumpf | 'can' Kabinenhaube | 'boom' Leitwerksrohr (Wickeldorn)
    target: 'neg',            // Rumpf: 'neg' Negativform | 'pos' geteiltes Urmodell auf Trennplatte | 'ur' Urmodell (ganz)
    canTarget: 'pos',         // Haube: 'pos' Tiefziehklotz | 'neg' Negativform | 'ur' Urmodell (Gegenstück zur Sicke des Rumpfs)
    edge: 'box',              // Formenrand: 'box' Kasten | 'offset' folgt der Rumpfkontur im Abstand „Formenrand"
    rot: 0, rotY: null,       // Trennebene um die Längsachse gedreht (°; 0 = senkrecht, 90 = waagrecht), Höhe der Drehachse (null = Rumpfmitte)
    noCan: false,             // Rumpf-Negativform ohne Kabinenhaube: Form im Haubenbereich offen
    side: 'both',             // Rumpfhälfte: 'r' | 'l' | 'both'
    ext: 0,                   // Aufsockelung der Halbschale an der Trennebene (mm)
    margin: 25,               // Formenrand um den Rumpf (mm)
    wall: 12,                 // Negativform: Wandstärke hinter dem tiefsten Punkt (mm)
    plate: 10,                // geteiltes Urmodell: Dicke der Trennplatte (mm)
    holes: { on: true, d: 6, n: 3 },                         // Passlöcher im Formenrand (je Längsseite und Stück)
    seg: { on: false, mode: 'n', n: 2, len: 200 },           // Druckstücke: Anzahl oder größte Länge
    can: { add: 8, addX: null, base: 5, margin: 0, plate: 0, wall: 8, play: 0.2 },  // Haube: Zugabe, Zugabe vorne/hinten (null = wie Zugabe), Sockel, Rand, Platte, Wandstärke, Urmodell: Spiel zur Sicke
    gap: 60, segGap: 20,      // Vorschau: Abstand der Hälften / der Druckstücke
    hk: { on: false, w: 4, h: 3 },                           // Huckel an der Formkante (Negativform), umlaufend
    blut: { on: false, shape: 'round', dist: 4, w: 4, d: 2 },   // Blutrinne im Formenrand, umlaufend
    rods: { on: false, play: 0.3, wall: 1.2, list: [] },     // Urmodell: Kanäle für Fädelstäbe; list [{ shape 'round'|'rect', d, w, h, x0, x1 (ab Nase), y0, y1, z }]
    rodsCan: { on: false, play: 0.3, wall: 1.2, list: [] },  // dasselbe für die Haubenform (Tiefziehklotz / Negativform)
    cut: { on: false, axis: 'x', pos: null, side: '+', fill: true, view: '3d' },   // Schnittansicht (wie Formenbau)
    // Wickeldorn des Leitwerksrohrs: Kegel = Rohr außen − Abzug (aus dem Rumpf), verlängert um Zugabe vorne/hinten,
    // in Druckstücke geteilt, mittig gebohrt für ein durchgehendes Rohr (Seele) zum Auffädeln
    boom: { addF: 30, addR: 30, core: 10, corePlay: 0.3, segLen: 200, minWall: 2 },
    // Haubenform als Schale (Vorbild Libelle 1:5): Rand = Gerade A–B in der Seitenansicht, Deckelebenen um angF/angR gekippt (+ = oben nach hinten)
    shell: { x0: null, y0: null, x1: null, y1: null, angF: 14, angR: -19, wall: 11, inset: 0, lidF: true, lidR: true, lidT: 11, gap: 25, edit: false },
    gapLast: 30, wire: false, ps: false   // Knöpfe unter dem Ansichtswürfel: letzter Abstand, Drahtgitter, Trennfläche zeigen
  };
  // Farben wie im Reiter „Formenbau" (dieselben Schlüssel -> beide Reiter sehen gleich aus)
  const COL = { formColSurf: '#5aa0d8', formColRim: '#8a9099' };
  const colOf = k => (/^#[0-9a-f]{6}$/i.test(state.cfg[k] || '') ? state.cfg[k] : COL[k]);
  function cfg() {
    let c = state.cfg.rprof;
    if (!c || typeof c !== 'object') c = state.cfg.rprof = JSON.parse(JSON.stringify(DEF));
    for (const k in DEF) if (c[k] === undefined) c[k] = JSON.parse(JSON.stringify(DEF[k]));
    for (const k of ['holes', 'seg', 'can', 'hk', 'blut', 'cut', 'rods', 'rodsCan', 'boom', 'shell']) for (const q in DEF[k]) if (c[k][q] === undefined) c[k][q] = DEF[k][q];
    return c;
  }

  // ---------- Quelle: Gitter des Rumpf ---------------------------------------------------
  // G[a][b] = [x, y, z] (a um den Halbspant von oben nach unten, b längs, z >= 0, inkl. Anbauten).
  // Quelle: Rumpf oder ein eigenes STL-Modell (stlbody.js, gleiche Schnittstelle, ohne Kabinenhaube)
  // Körper aus der 3D-Bearbeitung unverändert (1:1): äußere Hülle der gewählten Körper, Nase auf X = 0, fein geschnitten
  let meshMemo = null;
  const meshOpt = () => { const c = cfg(); return c.mesh || (c.mesh = { sel: null, len: 'auto', up: 'auto', flipX: false, flipUp: false }); };
  const meshBodies = () => { const a = window.MeshEdit && MeshEdit.api && MeshEdit.api(); return a ? a.bodies().filter(b => b.F && b.F.length) : []; };
  const meshIsMold = b => (b.rpMold != null ? !!b.rpMold : /form|klotz|lamin|negativ/i.test(b.name || ''));
  const meshChosen = () => { const q = meshOpt(), L = meshBodies(); return q.sel ? L.filter(b => q.sel.includes(b.name)) : L.filter(b => !b.hidden && !meshIsMold(b)); };
  function meshApi() {
    const q = meshOpt(), L = meshChosen(); if (!L.length || !window.StlBody || !StlBody.slice) return null;
    const key = JSON.stringify([q.len, q.up, !!q.flipX, !!q.flipUp]);
    if (meshMemo && meshMemo.key === key && meshMemo.V.length === L.length && L.every((b, i) => b.V === meshMemo.V[i])) return meshMemo.api;
    let n = 0; for (const b of L) n += b.F.length * 3;
    const v = new Float32Array(n); let o = 0;
    for (const b of L) for (let i = 0; i < b.F.length; i++) { const p = b.F[i] * 3; v[o++] = b.V[p]; v[o++] = b.V[p + 1]; v[o++] = b.V[p + 2]; }
    let api = null;
    try {
      const K = 193, g = StlBody.slice({ len: q.len, up: q.up, flipX: q.flipX, flipUp: q.flipUp, unit: 1, scale: 1, mid: 'auto' }, v, { nx: 401, k: K }), G = [];
      for (let a = 0; a < K; a++) G.push(g.xs.map((x, b) => [x, g.cols[b][2 * a], g.cols[b][2 * a + 1]]));
      api = { src: 'mesh', model: { G }, x0: g.xs[0], x1: g.xs[g.xs.length - 1], canopy: null, dim: g.dim };
      // Dreiecke in denselben Achsen wie das Gitter (für die Kantenlinien der Seitenansicht)
      const ax = StlBody._test.axes({ len: q.len, up: q.up }, v), sx = q.flipX ? -1 : 1, sy = q.flipUp ? -1 : 1, xA = sx > 0 ? ax.mn[ax.len] : ax.mx[ax.len], zM = (ax.mn[ax.lat] + ax.mx[ax.lat]) / 2, soup = new Float32Array(v.length);
      for (let i = 0; i < v.length; i += 3) { soup[i] = (v[i + ax.len] - xA) * sx; soup[i + 1] = v[i + ax.up] * sy; soup[i + 2] = v[i + ax.lat] - zM; }
      api.soup = soup;
      // CAD-Flächengruppen je Dreieck: Grenzen zwischen Flächen sind auch dann Linien, wenn sie tangential ineinander übergehen (Tragflächenanschluss)
      const sg = new Int32Array(v.length / 9); let tg = 0, gb = 0;
      for (const b of L) { const nt = b.F.length / 3; for (let i = 0; i < nt; i++) sg[tg++] = gb + (b.G ? b.G[i] : 0); gb += (b.ng || 1) + 1; }
      api.soupG = sg;
    } catch (e) { console.error(e); }
    meshMemo = { key, V: L.map(b => b.V), api };
    return api;
  }
  function srcApi() {
    if (cfg().from === 'mesh') return meshApi();
    if (cfg().from === 'stl') return (window.StlBody && StlBody.api && StlBody.api()) || null;
    return (window.RumpfPro && RumpfPro.api && RumpfPro.api()) || null;
  }
  function source() {
    const api = srcApi();
    if (!api || !api.model || !api.model.G) return null;
    const G = api.model.G, K = G.length, NB = G[0].length, XS = [];
    for (let b = 0; b < NB; b++) XS.push(G[0][b][0]);
    let yMin = Infinity, yMax = -Infinity, zMax = 0;
    for (let a = 0; a < K; a++) for (let b = 0; b < NB; b++) { const p = G[a][b]; if (p[1] < yMin) yMin = p[1]; if (p[1] > yMax) yMax = p[1]; if (p[2] > zMax) zMax = p[2]; }
    // Halbspant bei beliebigem x (linear zwischen den Gitterspalten): [[y, z], …]
    const colAt = x => {
      x = clamp(x, XS[0], XS[NB - 1]);
      let lo = 0, hi = NB - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (XS[m] <= x) lo = m; else hi = m; }
      const d = XS[hi] - XS[lo], t = d > 1e-12 ? (x - XS[lo]) / d : 0, out = new Array(K);
      for (let a = 0; a < K; a++) { const p = G[a][lo], q = G[a][hi]; out[a] = [p[1] + (q[1] - p[1]) * t, Math.max(0, p[2] + (q[2] - p[2]) * t)]; }
      return out;
    };
    return { api, G, K, NB, XS, yMin, yMax, zMax, colAt, x0: XS[0], x1: XS[NB - 1] };
  }

  // ---------- Blocknetz ------------------------------------------------------------------------
  // Ringraum zwischen Außenpolygon O und Lochkreis I (Indexlisten, XY(i) -> [x, u]) per Winkel-
  // Reißverschluss um die Lochmitte; emit bekommt Dreiecke mit positivem Umlauf in (x, u).
  function annulus(O, I, XY, emit) {
    const area = L => { let s = 0; for (let i = 0; i < L.length; i++) { const p = XY(L[i]), q = XY(L[(i + 1) % L.length]); s += p[0] * q[1] - q[0] * p[1]; } return s; };
    if (area(O) < 0) O = O.slice().reverse();
    if (area(I) < 0) I = I.slice().reverse();
    let cx = 0, cu = 0; for (const i of I) { const p = XY(i); cx += p[0]; cu += p[1]; } cx /= I.length; cu /= I.length;
    const ang = i => { const p = XY(i); return Math.atan2(p[1] - cu, p[0] - cx); }, P2 = 2 * Math.PI;
    const nO = O.length, nI = I.length, a0 = ang(O[0]);
    let j0 = 0, best = Infinity;
    for (let j = 0; j < nI; j++) { let d = ang(I[j]) - a0; while (d < 0) d += P2; while (d >= P2) d -= P2; if (d < best) { best = d; j0 = j; } }
    const cum = (L, s, n, first) => { const out = [first]; let prev = ang(L[s]); for (let k = 1; k <= n; k++) { const a = ang(L[(s + k) % n]); let d = a - prev; while (d <= -Math.PI) d += P2; while (d > Math.PI) d -= P2; out.push(out[k - 1] + d); prev = a; } return out; };
    const AO = cum(O, 0, nO, 0), AI = cum(I, j0, nI, best);
    let i = 0, j = 0;
    while (i < nO || j < nI) {
      const o = O[i % nO], q = I[(j0 + j) % nI];
      if (j >= nI || (i < nO && AO[i + 1] <= AI[j + 1])) { emit(o, O[(i + 1) % nO], q); i++; }
      else { emit(o, I[(j0 + j + 1) % nI], q); j++; }
    }
  }
  // cols[c][a] = [u, h] (alle Spalten gleich viele Zeilen), xs[c] aufsteigend.
  // o: { zb Rückseite, bands (Zeilen 0–1 und n−2…n−1 sind der ebene Formenrand), holes [{x, row 0|1, r}], surf(c, a) }
  // -> { v (9 Werte je Dreieck in x/u/h), ft (0 Formfläche, 1 Rand/Hinterbau), skipped (ausgelassene Löcher) }
  function blockMesh(cols, xs, o) {
    const nC = cols.length, n = cols[0].length, V = [], Q = [], SF = [], id = (c, a) => c * n + a;
    for (let c = 0; c < nC; c++) for (let a = 0; a < n; a++) { V.push([xs[c], cols[c][a][0], cols[c][a][1]]); Q.push([c, a]); SF.push(o.surf && o.surf(c, a) ? 1 : 0); }
    const top = [], band = [];
    const sgn = (i, j, k) => { const A = Q[i], B = Q[j], C = Q[k]; return (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]); };
    const addTop = (i, j, k, isBand) => { const t = sgn(i, j, k) < 0 ? [i, k, j] : [i, j, k]; top.push(t); if (isBand) band.push(t); };
    // Passlöcher: Bandvierecke über die Lochbreite durch einen Reißverschluss um den Kreis ersetzen
    const skip = new Set(), used = [-1, -1]; let skipped = 0;
    if (o.bands) for (const h of (o.holes || [])) {
      const a0 = h.row ? n - 2 : 0;
      let cA = -1, cB = -1;
      for (let c = 0; c < nC; c++) { if (xs[c] <= h.x - h.r - 1) cA = c; if (cB < 0 && xs[c] >= h.x + h.r + 1) cB = c; }
      let ok = cA >= 0 && cB > cA && cA >= used[h.row], hu = 0;
      if (ok) { for (let c = cA; c <= cB; c++) hu += cols[c][a0][0] + cols[c][a0 + 1][0]; hu /= 2 * (cB - cA + 1); }
      for (let c = cA; ok && c <= cB; c++) if ((c < cB && !(xs[c + 1] - xs[c] > 1e-6)) || Math.abs(cols[c][a0][0] - hu) < h.r + 1 || Math.abs(cols[c][a0 + 1][0] - hu) < h.r + 1) ok = false;
      if (!ok) { skipped++; continue; }
      const u0 = cols[cA][a0][0], u1 = cols[cA][a0 + 1][0];
      used[h.row] = cB;
      const O = [], I = [], M = 32;
      for (let c = cA; c <= cB; c++) O.push(id(c, a0));
      for (let c = cB; c >= cA; c--) O.push(id(c, a0 + 1));
      for (let k = 0; k < M; k++) { const t = 2 * Math.PI * k / M; I.push(V.length); V.push([h.x + h.r * Math.cos(t), hu + h.r * Math.sin(t), 0]); Q.push(null); SF.push(0); }
      const flip = u1 < u0;   // u fällt mit der Zeile -> Umlauf in (Spalte, Zeile) gespiegelt
      annulus(O, I, i => [V[i][0], V[i][1]], (p, q, r) => { const t = flip ? [p, r, q] : [p, q, r]; top.push(t); band.push(t); });
      for (let c = cA; c < cB; c++) skip.add(c + ',' + a0);
    }
    for (let c = 0; c + 1 < nC; c++) for (let a = 0; a + 1 < n; a++) {
      const isBand = o.bands && (a === 0 || a === n - 2);
      if ((isBand && skip.has(c + ',' + a)) || (o.drop && o.drop(c, a))) continue;
      addTop(id(c, a), id(c, a + 1), id(c + 1, a + 1), isBand); addTop(id(c, a), id(c + 1, a + 1), id(c + 1, a), isBand);
    }
    // Rückseite: Projektion auf h = zb; Wände über alle Randkanten der Oberseite (außen und Löcher)
    const P = new Map(), proj = v => { let p = P.get(v); if (p == null) { p = V.length; V.push([V[v][0], V[v][1], o.zb]); Q.push(Q[v]); SF.push(0); P.set(v, p); } return p; };
    const dir = new Set(); for (const t of top) { dir.add(t[0] + ',' + t[1]); dir.add(t[1] + ',' + t[2]); dir.add(t[2] + ',' + t[0]); }
    const rest = [];
    // Randschleifen ablaufen. Senkrechte Randkanten (gleiches x/u, z. B. Aufsockelung oder Sockel an einer
    // Stückgrenze) haben keine Wandfläche; ihre Punkte liegen auf der Wandkante des Nachbarn und werden
    // dort als Fächer eingebunden (sonst T-Stöße).
    const nxt = new Map();
    for (const t of top) for (let e = 0; e < 3; e++) { const p = t[e], q = t[(e + 1) % 3]; if (!dir.has(q + ',' + p)) nxt.set(p, q); }
    const vert = (p, q) => Math.abs(V[p][0] - V[q][0]) < 1e-9 && Math.abs(V[p][1] - V[q][1]) < 1e-9, dz = p => Math.abs(V[p][2] - o.zb);
    const seen = new Set();
    for (const st of Array.from(nxt.keys())) {
      if (seen.has(st)) continue;
      const L = []; for (let p = st; !seen.has(p) && nxt.has(p); p = nxt.get(p)) { seen.add(p); L.push(p); }
      const nL = L.length; let s = -1;
      for (let i = 0; i < nL; i++) if (!vert(L[i], L[(i + 1) % nL])) { s = i; break; }
      if (s < 0) continue;
      const at = k => L[(s + k) % nL], segs = [];
      for (let k = 0; k < nL;) { let j = k + 1; const chain = [at(j)]; while (j < nL && vert(at(j), at(j + 1))) { j++; chain.push(at(j)); } segs.push({ o: at(k), chain }); k = j; }
      segs.forEach((sg, i) => {
        const pc = segs[(i - 1 + segs.length) % segs.length].chain, ch = sg.chain, m = ch.length - 1, c0 = ch[0], Po = proj(sg.o), B = proj(c0);
        if (pc.length > 1 && dz(pc[0]) < dz(pc[pc.length - 1])) { for (let q = pc.length - 1; q >= 1; q--) rest.push([c0, pc[q], pc[q - 1]]); rest.push([c0, pc[0], Po]); }
        else rest.push([c0, sg.o, Po]);
        if (m > 0 && dz(ch[m]) < dz(c0)) { for (let q = 0; q < m; q++) rest.push([ch[q], Po, ch[q + 1]]); rest.push([ch[m], Po, B]); }
        else rest.push([c0, Po, B]);
      });
    }
    // Durchbruch (o.drop): Rückseite = gespiegelte Projektion der ganzen Oberseite, damit das Loch auch hinten offen ist
    for (const t of (o.drop ? top : band)) rest.push([proj(t[0]), proj(t[2]), proj(t[1])]);
    const r1i = o.bands ? 1 : 0, r2i = n - 1 - r1i;
    const addBack = (i, j, k) => { rest.push(sgn(i, j, k) > 0 ? [proj(i), proj(k), proj(j)] : [proj(i), proj(j), proj(k)]); };
    if (r2i > r1i && !o.drop) {
      if (nC < 3) { for (let c = 0; c + 1 < nC; c++) for (let a = r1i; a < r2i; a++) { addBack(id(c, a), id(c, a + 1), id(c + 1, a + 1)); addBack(id(c, a), id(c + 1, a + 1), id(c + 1, a)); } }
      else {
        const aL = id(1, r1i), aR = id(nC - 2, r1i);
        for (let a = r1i; a < r2i; a++) { addBack(aL, id(0, a), id(0, a + 1)); addBack(aR, id(nC - 1, a), id(nC - 1, a + 1)); }
        addBack(aL, id(0, r2i), id(1, r2i)); addBack(aR, id(nC - 1, r2i), id(nC - 2, r2i));
        for (let c = 1; c + 2 < nC; c++) { addBack(id(c, r1i), id(c + 1, r1i), id(c + 1, r2i)); addBack(id(c, r1i), id(c + 1, r2i), id(c, r2i)); }
      }
    }
    const v = [], ft = [];
    const emit = (t, tag) => {
      const A = V[t[0]], B = V[t[1]], C = V[t[2]], e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      if (Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) < 1e-9) return;
      v.push(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]); ft.push(tag);
    };
    for (const t of top) emit(t, SF[t[0]] && SF[t[1]] && SF[t[2]] ? 0 : 1);
    for (const t of rest) emit(t, 1);
    return { v: new Float32Array(v), ft: new Uint8Array(ft), skipped };
  }

  // ---------- Stücke aus einer Quelle ----------------------------------------------------------------
  // src: { x0, x1, xs (Stützstellen), col(x) -> [[u, h], …], uA/uB (Rand der Form an Zeilenanfang/-ende), hMax }
  // o:   { type 'pos'|'neg', margin, back (Wandstärke bzw. Plattendicke), holes {d, n}|null, cuts [x, …] }
  function pieces(src, o) {
    const bd = [src.x0].concat(o.cuts || [], [src.x1]), out = [], own = !!src.ownBands, bands = own || o.margin > 0, dir = src.uB >= src.uA ? 1 : -1;
    let skipped = 0;
    for (let k = 0; k + 1 < bd.length; k++) {
      const xa = bd[k], xb = bd[k + 1], first = k === 0, last = k + 2 === bd.length;
      const e = src.eps || 0.05, xs = [xa].concat(src.xs.filter(x => x > xa + e && x < xb - e), [xb]);
      let cols = xs.map(x => src.col(x));
      const nReal = cols.length, nRows = cols[0].length;
      if (bands && !own) cols = cols.map(c => [[src.uA - dir * o.margin, 0], [src.uA, 0]].concat(c, [[src.uB, 0], [src.uB + dir * o.margin, 0]]));
      const flat = c => c.map(q => [q[0], 0]);
      let c0 = 0;
      if (bands && !own && first) { cols.unshift(flat(cols[0]), flat(cols[0])); xs.unshift(xa - o.margin, xa); c0 = 2; }
      if (bands && !own && last) { const L = cols[cols.length - 1]; cols.push(flat(L), flat(L)); xs.push(xb, xb + o.margin); }
      const off = bands && !own ? 2 : 0, holes = [];
      if (o.holes && bands) {
        const r = Math.max(0.5, o.holes.d / 2), N = Math.max(1, Math.round(o.holes.n)), X0 = Math.max(xs[0], src.hx0 == null ? -Infinity : src.hx0), X1 = Math.min(xs[xs.length - 1], src.hx1 == null ? Infinity : src.hx1);
        for (let i = 0; i < N; i++) for (const row of [0, 1]) holes.push({ x: X0 + (X1 - X0) * (i + 0.5) / N, row, r });
      }
      const m = blockMesh(cols, xs, { zb: o.type === 'neg' ? src.hMax + o.back : -o.back, bands, holes, surf: (c, a) => c >= c0 && c < c0 + nReal && a >= off && a < off + nRows && (!src.surf || src.surf(xs[c], a - off)),
        drop: src.drop ? (cc, a) => a === off + src.drop.row && cc >= c0 && cc + 1 < c0 + nReal && xs[cc] >= src.drop.x0 - 1e-6 && xs[cc + 1] <= src.drop.x1 + 1e-6 : null });
      skipped += m.skipped; out.push(m);
    }
    return { list: out, skipped };
  }
  function cutList(c, x0, x1) {
    if (!c.seg.on) return [];
    const L = x1 - x0, n = c.seg.mode === 'len' ? Math.ceil(L / Math.max(20, +c.seg.len || 200) - 1e-9) : Math.round(+c.seg.n || 1);
    const N = clamp(n, 1, 40), out = [];
    for (let k = 1; k < N; k++) out.push(x0 + L * k / N);
    return out;
  }

  // Querschnitt von Huckel und Blutrinne über dem Abstand s zur Formkante: [[s, h], …] (h in Formkoordinaten:
  // + = in die Form hinein / über die Trennplatte, − = aus der Negativform heraus) -> { P, sMax, f(s) } | null
  function featProfile(c, neg) {
    const P = [[0, 0]], N = 8; let start = 0;
    if (neg && c.hk.on) {
      const w = Math.max(0.5, +c.hk.w || 0), H = Math.max(0.2, +c.hk.h || 0);
      for (let i = 1; i <= N; i++) { const t = Math.PI * i / N; P.push([w / 2 * (1 - Math.cos(t)), i === N ? 0 : -H * Math.sin(t)]); }
      start = w + 0.5;
    }
    if (c.blut.on) {
      const d = Math.max(+c.blut.dist || 0, start, 0.2), w = Math.max(0.5, +c.blut.w || 0), D = Math.max(0.2, +c.blut.d || 0);
      P.push([d, 0]);
      if (c.blut.shape === 'u') {
        const r = Math.min(w / 2 - 0.05, D);
        for (let i = 1; i <= 4; i++) { const a = Math.PI / 2 * i / 4; P.push([d + r * (1 - Math.cos(a)), D * Math.sin(a)]); }
        for (let i = 0; i <= 4; i++) { const a = Math.PI / 2 * (1 - i / 4); P.push([d + w - r * (1 - Math.cos(a)), i === 4 ? 0 : D * Math.sin(a)]); }
      } else for (let i = 1; i <= N; i++) { const t = Math.PI * i / N; P.push([d + w / 2 * (1 - Math.cos(t)), i === N ? 0 : D * Math.sin(t)]); }
    }
    if (P.length < 2) return null;
    const f = s => { if (s <= 0 || s >= P[P.length - 1][0]) return 0; let j = 1; while (P[j][0] < s) j++; const a = P[j - 1], b = P[j], t = (s - a[0]) / ((b[0] - a[0]) || 1); return a[1] + (b[1] - a[1]) * t; };
    return { P, sMax: P[P.length - 1][0], f };
  }
  // Rumpfhälfte: u = Y (oben -> unten), h = Z (+ Aufsockelung). Mit Huckel/Blutrinne (ft) bekommt jede Spalte
  // Zusatzzeilen auf Linien gleichen Abstands zur Formkante (Umriss in der Seitenansicht) — auch vor der Nase und
  // hinter dem Heck, dadurch laufen beide um den ganzen Rumpf herum.
  function fusSrc(S, c, ft, edge) {
    const ext = Math.max(0, +c.ext || 0);
    let under = 0;
    for (let b = 0; b < S.NB; b++) { let lo = S.G[0][b][1]; for (let a = 1; a < S.K; a++) { const y = S.G[a][b][1]; if (y > lo + 0.2) { under++; break; } if (y < lo) lo = y; } }
    // „ohne Kabinenhaube": Zusatzzeile an der Oberkante; Ringpunkte oberhalb der Haubenlinie rücken auf den
    // Schnittpunkt, der Streifen Oberkante -> Haubenlinie wird im Haubenbereich ausgelassen (Durchbruch).
    const kh = c.noCan && c.target === 'neg' ? S.api.canopy : null, open = !!kh;
    const khX0 = kh ? Math.max(S.x0, kh.x0) : 0, khX1 = kh ? Math.min(S.x1, kh.x1) : 0;
    const cav = x => {
      const p = S.colAt(x); let r = p.map(q => [q[0], q[1] + ext]);
      if (open) {
        let yc = null; if (x > khX0 && x < khX1) { const sp = kh.spans(x); if (sp.length) yc = Math.max(sp[sp.length - 1][0], p[p.length - 1][0] + 1e-3); }
        if (yc != null && yc < p[0][0]) {
          let a = 1; while (a < p.length - 1 && p[a][0] > yc) a++;
          const A = p[a - 1], B = p[a], t = A[0] - B[0] > 1e-12 ? clamp((A[0] - yc) / (A[0] - B[0]), 0, 1) : 0, cp = [yc, A[1] + (B[1] - A[1]) * t + ext];
          for (let i = 0; i < a; i++) r[i] = cp.slice();
        }
        r = [[p[0][0], 0]].concat(r);
      }
      return ext > 0 ? [[p[0][0], 0]].concat(r, [[p[p.length - 1][0], 0]]) : r;
    };
    const dropAt = n0 => (open ? { x0: khX0, x1: khX1, row: n0 + (ext > 0 ? 1 : 0) } : null);
    const withKh = L => { if (!open) return L; const o = L.concat([khX0, khX1]).sort((a, b) => a - b); return o.filter((x, i) => i === 0 || x - o[i - 1] > 1e-3); };
    if (!ft && !edge) return { x0: S.x0, x1: S.x1, xs: withKh(S.XS), uA: S.yMax, uB: S.yMin, hMax: S.zMax + ext, under, col: cav, drop: dropAt(0) };
    // edge: Formenrand als Versatz der Kontur — äußerste Zeile auf der Linie mit Abstand „Rand", davor die innere
    // Bandlinie (Abstand sIn); der Streifen dazwischen ist das Band für die Passlöcher.
    const P = ft ? ft.P : [[0, 0]], f = ft ? ft.f : () => 0, sMax = ft ? ft.sMax : 0, n = P.length - 1;
    const mg = edge ? edge.margin : 0, sIn = ft ? sMax + 1 : 0;
    const NB = S.NB, XS = S.XS, TY = [], BY = [], K = S.K, R = Math.max(sMax, mg) + 1;
    for (let b = 0; b < NB; b++) { TY.push(S.G[0][b][1]); BY.push(S.G[K - 1][b][1]); }
    const dSeg = (x, y, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 > 0 ? clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1) : 0; return Math.hypot(ax + t * dx - x, ay + t * dy - y); };
    // Abstand zum Umriss (nur Strecken im Umkreis R; weiter weg genügt „groß")
    const dist = (x, y) => {
      let lo = 0, hi = NB - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (XS[m] < x - R) lo = m; else hi = m; }
      let d = Infinity;
      for (let b = lo; b + 1 < NB && XS[b] <= x + R; b++) { d = Math.min(d, dSeg(x, y, XS[b], TY[b], XS[b + 1], TY[b + 1]), dSeg(x, y, XS[b], BY[b], XS[b + 1], BY[b + 1])); }
      if (x - R <= XS[0]) d = Math.min(d, dSeg(x, y, XS[0], BY[0], XS[0], TY[0]));
      if (x + R >= XS[NB - 1]) d = Math.min(d, dSeg(x, y, XS[NB - 1], BY[NB - 1], XS[NB - 1], TY[NB - 1]));
      return d;
    };
    const uA = S.yMax + R, uB = S.yMin - R, inR = x => x >= S.x0 - 1e-9 && x <= S.x1 + 1e-9;
    // Punkt der Spalte x mit Abstand s zum Umriss, von der Kante e aus in Richtung Rand g
    const iso = (x, e, g, s) => {
      const d0 = dist(x, e); if (d0 >= s) return [e, f(d0)];
      let lo = e, hi = g; for (let q = 0; q < 26; q++) { const m = (lo + hi) / 2; if (dist(x, m) < s) lo = m; else hi = m; }
      return [(lo + hi) / 2, f(s)];
    };
    const col = x => {
      const ins = inR(x), p = S.colAt(x), top = p[0][0], bot = p[K - 1][0], r = [];
      if (edge) r.push(iso(x, top, uA, mg), iso(x, top, uA, sIn));
      for (let i = n; i >= 1; i--) r.push(iso(x, top, uA, P[i][0]));
      if (ins) for (const q of cav(x)) r.push(q);
      else { const fl = p.map(q => [q[0], f(dist(x, q[0]))]); if (ext > 0) r.push(fl[0].slice()); if (open) r.push(fl[0].slice()); for (const q of fl) r.push(q); if (ext > 0) r.push(fl[K - 1].slice()); }
      for (let i = 1; i <= n; i++) r.push(iso(x, bot, uB, P[i][0]));
      if (edge) r.push(iso(x, bot, uB, sIn), iso(x, bot, uB, mg));
      return r;
    };
    // Stützstellen: vor Nase / hinter Heck dicht (Rundung von Rinne bzw. Rand), genau an den Abständen des Querschnitts
    const list = XS.slice(), E = 2e-3, far = edge ? mg : R;
    for (const [xe, sg] of [[S.x0, -1], [S.x1, 1]]) {
      if (ft) {
        const st = clamp(sMax / 16, 0.4, 1.5);
        for (let d = st; d < sMax + 1; d += st) list.push(xe + sg * d);
        for (let d = st; d < 2 * sMax; d += st) list.push(xe - sg * d);
        for (const q of P) if (q[0] > 0) list.push(xe + sg * q[0]);
        list.push(xe + sg * (sMax + 1));
      }
      if (edge) for (let i = 1; i < 28; i++) { list.push(xe + sg * mg * Math.sin(Math.PI / 2 * i / 28)); list.push(xe - sg * mg * i / 28); }
      list.push(xe + sg * E, xe + sg * far);   // E: ebene Spalte unmittelbar vor einer stumpfen Nase (senkrechte Stirnwand)
    }
    list.sort((a, b) => a - b);
    const xs = withKh(list.filter((x, i) => i === 0 || x - list[i - 1] > 1e-3)).filter(x => x >= S.x0 - far - 1e-9 && x <= S.x1 + far + 1e-9);
    const nCav = K + (ext > 0 ? 2 : 0) + (open ? 1 : 0), nUp = n + (edge ? 2 : 0);
    return { x0: S.x0 - far, x1: S.x1 + far, xs, uA, uB, hMax: S.zMax + ext, under, col, eps: 1e-3, ownBands: !!edge, hx0: S.x0, hx1: S.x1,
      surf: (x, a) => inR(x) && a >= nUp && a < nUp + nCav, drop: dropAt(nUp) };
  }
  // Trennebene um die Längsachse gedreht: Halbspanten der Hälfte sg (+1 = A, −1 = B) im gedrehten System neu bilden.
  // u = Lage in der Trennebene, h = Abstand von ihr; Ring von der Stelle mit größtem u zur Stelle mit kleinstem u über
  // die Seite der Hälfte, Punkte jenseits der Ebene auf h = 0 (dort senkrechte Wand / Hinterschnitt -> part).
  function rotSrc(S, deg, y0, sg) {
    const ph = deg * Math.PI / 180, cs = Math.cos(ph), sn = Math.sin(ph), K = S.K, NB = S.NB, G = [];
    for (let a = 0; a < K; a++) G.push(new Array(NB));
    let yMin = Infinity, yMax = -Infinity, zMax = 0, part = 0;
    for (let b = 0; b < NB; b++) {
      const Q = [], uh = (y, z) => [(y - y0) * cs - z * sn + y0, sg * ((y - y0) * sn + z * cs)];
      for (let a = 0; a < K; a++) Q.push(uh(S.G[a][b][1], S.G[a][b][2]));
      for (let a = K - 2; a >= 1; a--) Q.push(uh(S.G[a][b][1], -S.G[a][b][2]));
      const L = [], m = Q.length;
      for (let i = 0; i < m; i++) { const A = Q[i], B = Q[(i + 1) % m]; L.push(A); if ((A[1] < 0) !== (B[1] < 0) && A[1] !== 0 && B[1] !== 0) { const t = A[1] / (A[1] - B[1]); L.push([A[0] + (B[0] - A[0]) * t, 0]); } }
      const N = L.length; let iMax = 0, iMin = 0;
      const better = (i, j, s2) => { const d = s2 * (L[i][0] - L[j][0]); return d > 1e-6 || (d > -1e-6 && Math.abs(L[i][1]) < Math.abs(L[j][1])); };
      for (let i = 1; i < N; i++) { if (better(i, iMax, 1)) iMax = i; if (better(i, iMin, -1)) iMin = i; }
      const arc = d => { const o = []; for (let i = iMax, g = 0; g <= N; g++, i = (i + d + N) % N) { o.push(L[i]); if (i === iMin) break; } return o; };
      const mean = o => { let t = 0; for (const q of o) t += q[1]; return t / o.length; };
      const a1 = arc(1), a2 = arc(-1), A = mean(a1) >= mean(a2) ? a1 : a2;
      if (A.some(q => q[1] < -0.05)) part++;
      const pts = A.map(q => [q[0], Math.max(0, q[1])]), cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const Lt = cum[cum.length - 1]; let j = 0;
      for (let a = 0; a < K; a++) {
        let q = pts[0];
        if (Lt > 1e-9 && pts.length > 1) { const t = Lt * a / (K - 1); while (j < pts.length - 2 && cum[j + 1] < t) j++; const dd = cum[j + 1] - cum[j], w = dd > 1e-12 ? clamp((t - cum[j]) / dd, 0, 1) : 0; q = [pts[j][0] + (pts[j + 1][0] - pts[j][0]) * w, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * w]; }
        G[a][b] = [S.XS[b], q[0], q[1]];
        if (q[0] < yMin) yMin = q[0]; if (q[0] > yMax) yMax = q[0]; if (q[1] > zMax) zMax = q[1];
      }
    }
    const XS = S.XS, colAt = x => {
      x = clamp(x, XS[0], XS[NB - 1]);
      let lo = 0, hi = NB - 1; while (hi - lo > 1) { const mm = (lo + hi) >> 1; if (XS[mm] <= x) lo = mm; else hi = mm; }
      const d = XS[hi] - XS[lo], t = d > 1e-12 ? (x - XS[lo]) / d : 0, out = new Array(K);
      for (let a = 0; a < K; a++) { const p = G[a][lo], q = G[a][hi]; out[a] = [p[1] + (q[1] - p[1]) * t, Math.max(0, p[2] + (q[2] - p[2]) * t)]; }
      return out;
    };
    return { api: { canopy: null }, G, K, NB, XS, yMin, yMax, zMax, colAt, x0: S.x0, x1: S.x1, part };
  }
  // Kabinenhaube: u = Z (links -> rechts), h = Y − yB. Haubenfläche = Rumpffläche oberhalb der Schnittlinie
  // (um die Zugabe nach unten und in der Länge erweitert), darunter senkrecht bis zur Sockelebene yB.
  function canSrc(S, c) {
    const kh = S.api.canopy; if (!kh) return null;
    const add = Math.max(0, +c.can.add || 0), addX = c.can.addX == null ? add : Math.max(0, +c.can.addX || 0), M = 40;
    const xa = Math.max(S.x0, kh.x0 - addX), xb = Math.min(S.x1, kh.x1 + addX);
    // Höhe der Haubenlinie an ihren Enden: davor/dahinter läuft die Form auf dieser Höhe (minus Zugabe) weiter
    const lineY = x => { const top = S.colAt(x)[0][0], sp = kh.spans(x); return sp.length ? Math.min(top, sp[sp.length - 1][0]) : top; };
    const eE = Math.min(0.5, (kh.x1 - kh.x0) * 0.01), yE0 = lineY(kh.x0 + eE), yE1 = lineY(kh.x1 - eE);
    if (!(xb - xa > 1)) return null;
    const memo = new Map(), gIn = c.canTarget === 'pos' && c.can.inner !== false ? Math.max(0, +kh.glass || 0) : 0;
    const half = x => {
      const key = Math.round(x * 1000); let r = memo.get(key); if (r) return r;
      const ring = S.colAt(x), top = ring[0][0], bot = ring[ring.length - 1][0];
      let yv = top;
      if (x > kh.x0 && x < kh.x1) { const sp = kh.spans(x); if (sp.length) yv = Math.min(top, sp[sp.length - 1][0]); }
      else yv = Math.min(top, x <= kh.x0 ? yE0 : yE1);
      yv = clamp(yv - add, bot, top);
      // Ring von oben bis zur Schnitthöhe; Z darf nicht wieder abnehmen (Hinterschnitt -> senkrecht)
      const pts = [[0, top]]; let zm = 0, under = false;
      for (let a = 1; a < ring.length; a++) {
        const p = ring[a - 1], q = ring[a];
        if (q[0] > yv) { if (q[1] < zm - 0.05) under = true; zm = Math.max(zm, q[1]); pts.push([zm, q[0]]); continue; }
        const t = p[0] - q[0] > 1e-12 ? (p[0] - yv) / (p[0] - q[0]) : 0, z = p[1] + (q[1] - p[1]) * t;
        if (z < zm - 0.05) under = true; zm = Math.max(zm, z); pts.push([zm, yv]); break;
      }
      const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const L = cum[cum.length - 1], res = []; let j = 0;
      for (let k = 0; k < M; k++) {
        if (!(L > 1e-9)) { res.push([0, top]); continue; }
        const s = L * k / (M - 1); while (j < pts.length - 2 && cum[j + 1] < s) j++;
        const dd = cum[j + 1] - cum[j], t = dd > 1e-12 ? clamp((s - cum[j]) / dd, 0, 1) : 0;
        res.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t]);
      }
      // Tiefziehklotz = Innenseite der Haube: um die Haubenstärke (Rumpf) senkrecht zur Kontur nach innen
      if (gIn > 0) {
        const off = res.map((q, k) => {
          const a = res[Math.max(0, k - 1)], b = res[Math.min(M - 1, k + 1)], dz = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dz, dy);
          if (!(l > 1e-9)) return q.slice();
          return [Math.max(0, q[0] + gIn * dy / l), q[1] - gIn * dz / l];
        });
        off[0][0] = 0; for (let k = 1; k < M; k++) if (off[k][0] < off[k - 1][0]) off[k][0] = off[k - 1][0];
        for (let k = 0; k < M; k++) res[k] = off[k];
      }
      r = { pts: res, yv: res[M - 1][1], zc: res[M - 1][0], top, under }; memo.set(key, r); return r;
    };
    const list = [xa, xb]; for (const x of S.XS) if (x > xa && x < xb) list.push(x);
    for (let k = 1; k < 80; k++) list.push(xa + (xb - xa) * k / 80);
    list.sort((p, q) => p - q);
    const xs = list.filter((x, i) => i === 0 || x - list[i - 1] > 0.3);
    let yLow = Infinity, zM = 0, yTop = -Infinity, under = 0;
    for (const x of xs) { const h = half(x); if (h.yv < yLow) yLow = h.yv; if (h.zc > zM) zM = h.zc; if (h.top > yTop) yTop = h.top; if (h.under) under++; }
    const yB = yLow - Math.max(0, +c.can.base || 0);
    return {
      x0: xa, x1: xb, xs, uA: -zM, uB: zM, hMax: yTop - yB, yB, under,
      col: x => {
        const h = half(x), r = [[-h.zc, 0]], H = q => Math.max(0, q[1] - yB);
        for (let i = M - 1; i >= 1; i--) r.push([-h.pts[i][0], H(h.pts[i])]);
        r.push([0, H(h.pts[0])]);
        for (let i = 1; i < M; i++) r.push([h.pts[i][0], H(h.pts[i])]);
        r.push([h.zc, 0]); return r;
      }
    };
  }

  /* Urmodell der Kabinenhaube: voller Körper, außen die Rumpfhaut im Haubenbereich, unten das Gegenstück zur Sicke
   * des Rumpfs (Rumpf, Gruppe „Kabinenhaube") — dieselben Stufen wie in rumpfpro.js sickeTris, aber um das
   * Spiel versetzt: alle Stufenkanten rücken um „play" in die Haube, alle Tiefen werden um „play" kleiner.
   * Hinter der letzten Stufe füllt ein Kern den Ausschnitt (Wand gerade zur Mittelebene, wie der Ausschnitt im Rumpf).
   * Ohne Sicke: nur Haut + Kern. -> { v (beide Hälften, Modellkoordinaten), ft (0 Haut, 1 Innenstruktur) } | null */
  function canUr(S, c, warn) {
    const kh = S.api.canopy; if (!kh || !kh.sd) return null;
    const G = S.G, K = S.K, NB = S.NB, sk = kh.sicke || null, play = Math.max(0, +c.can.play || 0), dp = d => (d > 0 ? Math.max(0.1, d - play) : 0);   // Haubenrand bleibt mindestens 0,1 mm dick
    const th = [], dLo = [0], dHi = [0];
    if (sk) for (let k = 0; k < sk.n; k++) {
      th.push(k * sk.w + play);
      if (sk.r > 0) { dLo.push(dp(k * sk.d)); dHi.push(dp((k + 1) * sk.d)); th.push(k * sk.w + sk.r + play); }
      dLo.push(dp((k + 1) * sk.d)); dHi.push(dp((k + 1) * sk.d));
    }
    th.push((sk ? sk.n * sk.w : 0) + play);
    const n = th.length - 1;
    if (!sk) warn.push(T('Keine Sicke eingeschaltet (Rumpf, Gruppe „Kabinenhaube") — das Urmodell der Haube bekommt keine Innenstruktur.'));
    else if (sk.d - play < 0.2) warn.push(T('Spiel fast so groß wie die Vertiefung der Sicke — der Haubenrand wird dünner als 0,2 mm (mindestens 0,1 mm bleiben stehen).'));
    const gid = (a, b) => a * NB + b, GP = new Array(K * NB);
    for (let b = 0; b < NB; b++) for (let a = 0; a < K; a++) {
      const P = G[a][b]; let sd = kh.sd(P[0], P[1]);
      for (const t of th) if (Math.abs(sd - t) < 1e-7) sd = t + 2e-7;
      let iy = 0, iz = 0;
      if (a === 0) iy = -1; else if (a === K - 1) iy = 1;
      else {
        let ap = a - 1, an = a + 1; const same = q => Math.abs(q[1] - P[1]) + Math.abs(q[2] - P[2]) < 1e-9;
        while (ap > 0 && same(G[ap][b])) ap--; while (an < K - 1 && same(G[an][b])) an++;
        const ty = G[an][b][1] - G[ap][b][1], tz = G[an][b][2] - G[ap][b][2], l = Math.hypot(ty, tz);
        if (l > 1e-9) { iy = -tz / l; iz = ty / l; }
      }
      GP[gid(a, b)] = { id: 'v' + gid(a, b), P, I: [iy, iz], s: sd, tag: -1 };
    }
    const V = [], vmap = new Map(), tris = [], ft = [];
    const at = (pt, d, fl) => {
      const key = pt.id + '|' + Math.round(d * 1e6) + (fl ? 'F' : ''); let i = vmap.get(key);
      if (i == null) { i = V.length; V.push([pt.P[0], pt.P[1] + pt.I[0] * d, fl ? 0 : Math.max(0, pt.P[2] + pt.I[1] * d)]); vmap.set(key, i); }
      return i;
    };
    // Tiefe der Unterseite im Streifen j (1 … n)
    const dep = (pt, j) => pt.tag >= 0 ? (pt.tag === j ? dHi[j] : dLo[j]) : dLo[j] + (dHi[j] - dLo[j]) * clamp((pt.s - th[j - 1]) / (th[j] - th[j - 1]), 0, 1);
    const skin = pt => at(pt, 0), under = (pt, j) => at(pt, dep(pt, j)), floor = pt => at(pt, dHi[n], true);
    const cross = new Map();
    const crossPt = (u, w, k) => {
      const lo = u.id < w.id ? u : w, hi = lo === u ? w : u, key = 'e' + lo.id + '_' + hi.id + '_' + k; let q = cross.get(key);
      if (!q) {
        const t = (th[k] - lo.s) / (hi.s - lo.s), L = (p, r) => p + (r - p) * t; let iy = L(lo.I[0], hi.I[0]), iz = L(lo.I[1], hi.I[1]); const l = Math.hypot(iy, iz);
        if (l > 1e-9) { iy /= l; iz /= l; }
        q = { id: key, P: [L(lo.P[0], hi.P[0]), L(lo.P[1], hi.P[1]), L(lo.P[2], hi.P[2])], I: [iy, iz], s: th[k], tag: k }; cross.set(key, q);
      }
      return q;
    };
    let nzSum = 0;
    for (let a = 0; a + 1 < K; a += Math.max(1, K >> 3)) for (let b = 0; b + 1 < NB; b += Math.max(1, NB >> 4)) { const p = G[a][b], q = G[a + 1][b + 1], r = G[a][b + 1]; nzSum += (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); }
    const rev = nzSum < 0;
    const add = (i, j, k, f) => { if (i === j || j === k || i === k) return; tris.push(rev ? [i, k, j] : [i, j, k]); ft.push(f); };
    const splitTri = (A, B, Cc) => {
      const ring = [], tv = [A, B, Cc];
      for (let e = 0; e < 3; e++) {
        const u = tv[e], w = tv[(e + 1) % 3]; ring.push(u);
        const ks = []; for (let k = 0; k <= n; k++) if ((th[k] - u.s) * (th[k] - w.s) < 0) ks.push(k);
        if (u.s > w.s) ks.reverse();
        for (const k of ks) ring.push(crossPt(u, w, k));
      }
      for (let j = 0; j <= n + 1; j++) {
        const lo = j === 0 ? -Infinity : th[j - 1], hi = j > n ? Infinity : th[j], poly = ring.filter(q => q.s >= lo && q.s <= hi), m = poly.length;
        if (m < 3) continue;
        if (j >= 1) for (let i = 1; i + 1 < m; i++) {
          const s0 = skin(poly[0]), s1 = skin(poly[i]), s2 = skin(poly[i + 1]);
          add(s0, s1, s2, 0);
          if (j <= n) { const u0 = under(poly[0], j), u1 = under(poly[i], j), u2 = under(poly[i + 1], j); if (u0 !== s0 || u1 !== s1 || u2 !== s2) add(u0, u2, u1, 1); }
        }
        if (j <= n) for (let i = 0; i < m; i++) {   // Stufenwand an der oberen Grenze des Streifens j
          const X = poly[i], Y = poly[(i + 1) % m];
          if (X.tag === j && Y.tag === j) {
            const up = q => (j === 0 ? skin(q) : under(q, j)), dn = q => (j < n ? under(q, j + 1) : floor(q));
            add(up(X), up(Y), dn(Y), 1); add(up(X), dn(Y), dn(X), 1); break;
          }
        }
      }
    };
    for (let a = 0; a + 1 < K; a++) for (let b = 0; b + 1 < NB; b++) {
      const p00 = GP[gid(a, b)], p10 = GP[gid(a + 1, b)], p01 = GP[gid(a, b + 1)], p11 = GP[gid(a + 1, b + 1)];
      splitTri(p00, p11, p01); splitTri(p00, p10, p11);
    }
    if (!tris.length) return null;
    const nT = tris.length, v = new Float32Array(nT * 18), f2 = new Uint8Array(nT * 2);
    for (let i = 0; i < nT; i++) {
      const t = tris[i], p = V[t[0]], q = V[t[1]], r = V[t[2]];
      v.set([p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]], i * 9);
      v.set([p[0], p[1], -p[2], r[0], r[1], -r[2], q[0], q[1], -q[2]], (nT + i) * 9);
      f2[i] = f2[nT + i] = ft[i];
    }
    return { v, ft: f2 };
  }

  /* Haubenform als Schale (Vorbild Libelle 1:5, Teile L1–L4): Hohlraum = Rumpffläche über einer ebenen Randfläche,
   * außen im Abstand „Wandstärke" versetzt. Quer dazu liegen Schnittebenen, deren Kippung an den Enden in die Deckelebenen
   * übergeht und in der Mitte 0 ist (Teilfugen dort rechtwinklig zum Rand). Jede Ebene schneidet Innen- und Außengitter
   * mit derselben Punktzahl -> Netz geschlossen; Deckel = Scheibe des Außenkörpers zwischen zwei parallelen Ebenen. */
  const SH_M = 48;
  function shellDefaults(S, c) {
    const q = c.shell; if (q.x0 != null && q.y0 != null && q.x1 != null && q.y1 != null) return q;
    const kh = S.api.canopy, L = S.x1 - S.x0, xa = kh ? Math.max(S.x0 + 1, kh.x0 - 25) : S.x0 + L * 0.15, xb = kh ? Math.min(S.x1 - 1, kh.x1 + 35) : S.x0 + L * 0.45;
    const wide = x => { const R = S.colAt(x); let b = R[0]; for (const p of R) if (p[1] > b[1]) b = p; return b[0] + 10; };   // knapp über der breitesten Stelle
    q.x0 = r1(xa); q.y0 = r1(wide(xa)); q.x1 = r1(xb); q.y1 = r1(wide(xb));
    return q;
  }
  function shellFrame(q) {
    const dx = q.x1 - q.x0, dy = q.y1 - q.y0, L = Math.hypot(dx, dy); if (!(L > 1) || dx <= 0) return null;
    const d = [dx / L, dy / L], n = [-d[1], d[0]], R = Math.PI / 180;
    const plane = (s, deg) => {
      const t = deg * R, cs = Math.cos(t), sn = Math.sin(t);
      return { O: [q.x0 + d[0] * s, q.y0 + d[1] * s], m: [d[0] * cs - n[0] * sn, d[1] * cs - n[1] * sn], e: [n[0] * cs + d[0] * sn, n[1] * cs + d[1] * sn] };
    };
    const tilt = s => { const u = s / L; return u < 0.3 ? q.angF * (1 - u / 0.3) ** 2 : u > 0.7 ? q.angR * ((u - 0.7) / 0.3) ** 2 : 0; };
    return { L, d, n, A: [q.x0, q.y0], plane, tilt, at: s => plane(s, tilt(s)) };
  }
  // Gitter um d senkrecht zur Fläche versetzen (d > 0 nach außen)
  function offsetGrid(G, d) {
    const K = G.length, NB = G[0].length, out = [], same = (p, r) => Math.abs(p[0] - r[0]) + Math.abs(p[1] - r[1]) + Math.abs(p[2] - r[2]) < 1e-6;
    for (let a = 0; a < K; a++) out.push(new Array(NB));
    for (let b = 0; b < NB; b++) {
      const yc = (G[0][b][1] + G[K - 1][b][1]) / 2;
      for (let a = 0; a < K; a++) {
        const P = G[a][b]; let ap = a, an = a, bp = b, bn = b;
        while (ap > 0 && same(G[ap][b], P)) ap--; while (an < K - 1 && same(G[an][b], P)) an++;
        while (bp > 0 && same(G[a][bp], P)) bp--; while (bn < NB - 1 && same(G[a][bn], P)) bn++;
        const A = [0, 1, 2].map(i => G[an][b][i] - G[ap][b][i]), B = [0, 1, 2].map(i => G[a][bn][i] - G[a][bp][i]);
        let N = [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]];
        if (a === 0 || a === K - 1) N[2] = 0;
        let l = Math.hypot(N[0], N[1], N[2]);
        if (!(l > 1e-9)) { N = [0, P[1] - yc, P[2]]; l = Math.hypot(N[1], N[2]) || 1; }
        if (N[1] * (P[1] - yc) + N[2] * P[2] < 0) l = -l;
        out[a][b] = [P[0] + d * N[0] / l, P[1] + d * N[1] / l, Math.max(0, P[2] + d * N[2] / l)];
      }
    }
    return out;
  }
  // Ebene schneidet das Gitter, Halbring von oben bis zur Randebene, nach Bogenlänge neu verteilt, gespiegelt: 2·SH_M + 1 Punkte | null
  function shellRing(G, pl, F) {
    const h = [];
    for (const row of G) {
      let hit = null;
      for (let b = 0; b + 1 < row.length; b++) {
        const p = row[b], r = row[b + 1], f = (p[0] - pl.O[0]) * pl.m[0] + (p[1] - pl.O[1]) * pl.m[1], g = (r[0] - pl.O[0]) * pl.m[0] + (r[1] - pl.O[1]) * pl.m[1];
        if ((f <= 0 && g > 0) || (f >= 0 && g < 0)) { const t = f / (f - g); hit = [p[0] + (r[0] - p[0]) * t, p[1] + (r[1] - p[1]) * t, p[2] + (r[2] - p[2]) * t]; break; }
      }
      if (hit) h.push(hit);
    }
    const W_ = p => (p[0] - F.A[0]) * F.n[0] + (p[1] - F.A[1]) * F.n[1];
    if (h.length < 3 || W_(h[0]) <= 0) return null;
    const pts = [h[0]]; let closed = false;
    for (let i = 1; i < h.length; i++) {
      const u = W_(h[i - 1]), w = W_(h[i]);
      if (w > 0) { pts.push(h[i]); continue; }
      const t = u / (u - w); pts.push([0, 1, 2].map(k => h[i - 1][k] + (h[i][k] - h[i - 1][k]) * t)); closed = true; break;
    }
    if (!closed) return null;
    pts[0][2] = 0;
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
    const half = []; let j = 0;
    for (let k = 0; k <= SH_M; k++) {
      const s = cum[cum.length - 1] * k / SH_M; while (j < pts.length - 2 && cum[j + 1] < s) j++;
      const dd = cum[j + 1] - cum[j], t = dd > 1e-12 ? clamp((s - cum[j]) / dd, 0, 1) : 0;
      half.push([0, 1, 2].map(q => pts[j][q] + (pts[j + 1][q] - pts[j][q]) * t));
    }
    const R = []; for (let k = SH_M; k >= 1; k--) R.push([half[k][0], half[k][1], -half[k][2]]);
    for (let k = 0; k <= SH_M; k++) R.push(half[k]);
    return R;
  }
  function triSink() {
    const t = [], f = [];
    const tri = (a, b, c, ft) => { t.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); f.push(ft); };
    const quad = (a, b, c, d, ft) => { tri(a, b, c, ft); tri(a, c, d, ft); };
    const end = () => { const v = new Float32Array(t), ft = new Uint8Array(f); if (volume(v) < 0) for (let i = 0; i < v.length; i += 9) for (let k = 0; k < 3; k++) { const s = v[i + 3 + k]; v[i + 3 + k] = v[i + 6 + k]; v[i + 6 + k] = s; } return { v, ft }; };
    return { quad, tri, end };
  }
  // Schalenstück zwischen s0 und s1
  function shellPiece(Gi, Go, F, s0, s1) {
    const n = Math.max(2, Math.ceil((s1 - s0) / 5)), M = triSink(), RI = [], RO = [];
    for (let i = 0; i <= n; i++) {
      const pl = F.at(s0 + (s1 - s0) * i / n), a = shellRing(Gi, pl, F), b = shellRing(Go, pl, F);
      if (!a || !b) return null;
      RI.push(a); RO.push(b);
    }
    const N = RI[0].length;
    for (let i = 0; i < n; i++) for (let k = 0; k + 1 < N; k++) { M.quad(RI[i][k], RI[i + 1][k], RI[i + 1][k + 1], RI[i][k + 1], 0); M.quad(RO[i][k], RO[i][k + 1], RO[i + 1][k + 1], RO[i + 1][k], 1); }
    for (let i = 0; i < n; i++) { M.quad(RI[i][0], RO[i][0], RO[i + 1][0], RI[i + 1][0], 1); M.quad(RI[i][N - 1], RI[i + 1][N - 1], RO[i + 1][N - 1], RO[i][N - 1], 1); }
    for (let k = 0; k + 1 < N; k++) { M.quad(RI[0][k], RI[0][k + 1], RO[0][k + 1], RO[0][k], 1); M.quad(RI[n][k], RO[n][k], RO[n][k + 1], RI[n][k + 1], 1); }
    return M.end();
  }
  // Deckel: Scheibe des Außenkörpers zwischen Deckelebene (s, deg) und der um t nach außen (dir) versetzten Parallelen
  function shellLid(Go, F, s, deg, t, dir) {
    const pa = F.plane(s, deg), pb = { O: [pa.O[0] + pa.m[0] * t * dir, pa.O[1] + pa.m[1] * t * dir], m: pa.m, e: pa.e };
    const a = shellRing(Go, pa, F), b = shellRing(Go, pb, F); if (!a || !b) return null;
    const M = triSink(), N = a.length, mid = R => { const c = [0, 0, 0]; for (const p of R) for (let k = 0; k < 3; k++) c[k] += p[k] / N; return c; }, ca = mid(a), cb = mid(b);
    for (let k = 0; k < N; k++) { const j = (k + 1) % N; M.quad(a[k], a[j], b[j], b[k], 1); M.tri(ca, a[j], a[k], 0); M.tri(cb, b[k], b[j], 1); }
    return Object.assign(M.end(), { pl: pa });
  }
  function shellItems(S, c, warn, gapOf) {
    const q = shellDefaults(S, c), F = shellFrame(q);
    if (!F) throw new Error(T('Lage der Form: Der Rand muss von vorne nach hinten laufen.'));
    const wall = Math.max(1, +q.wall || 1), ins = Math.max(0, +q.inset || 0);
    const Gi = ins > 0 ? offsetGrid(S.G, -ins) : S.G, Go = offsetGrid(S.G, wall - ins), bad = T('Die Form liegt nicht ganz am Rumpf: Rand oder Enden in der Seitenansicht versetzen (der Rand muss den Rumpf überall schneiden).');
    const bd = [0].concat(cutList(c, 0, F.L), [F.L]), items = [];
    const place = (v, off) => mapV(v, (x, y, z) => [x + F.d[0] * off, y + F.d[1] * off, z]);
    for (let k = 0; k + 1 < bd.length; k++) {
      const m = shellPiece(Gi, Go, F, bd[k], bd[k + 1]); if (!m) throw new Error(bad);
      const f = finish(mapV(m.v, (x, y, z) => [(x - F.A[0]) * F.d[0] + (y - F.A[1]) * F.d[1], -z, (x - F.A[0]) * F.n[0] + (y - F.A[1]) * F.n[1]]));
      const nm = bd.length > 2 ? '_' + T('teil') + String(k + 1).padStart(2, '0') : '', off = gapOf(k);
      items.push({ name: 'haubenform_schale' + nm, v: place(m.v, off), ft: m.ft, out: f.v, dim: f.dim, vol: f.vol });
    }
    const t = Math.max(1, +q.lidT || 1), g = Math.max(0, +q.gap || 0);
    const lid = (on, s, deg, dir, name, off) => {
      if (!on) return;
      const m = shellLid(Go, F, s, deg, t, dir); if (!m) { warn.push(T('Deckel passt nicht: Die Deckelebene liegt außerhalb des Rumpfs.')); return; }
      const P = m.pl, f = finish(mapV(m.v, (x, y, z) => [(x - P.O[0]) * P.e[0] + (y - P.O[1]) * P.e[1], -z, dir * ((x - P.O[0]) * P.m[0] + (y - P.O[1]) * P.m[1])]));
      items.push({ name, v: place(m.v, off), ft: m.ft, out: f.v, dim: f.dim, vol: f.vol });
    };
    lid(q.lidF, 0, q.angF, -1, 'haubenform_deckel_vorne', -g);
    lid(q.lidR, F.L, q.angR, 1, 'haubenform_deckel_hinten', gapOf(bd.length - 2) + g);
    return items;
  }

  // ---------- Abbildung in Modell- und Druckkoordinaten -------------------------------------------
  function mapV(v, f) { const o = new Float32Array(v.length); for (let i = 0; i < v.length; i += 3) { const q = f(v[i], v[i + 1], v[i + 2]); o[i] = q[0]; o[i + 1] = q[1]; o[i + 2] = q[2]; } return o; }
  function volume(v) { let s = 0; for (let i = 0; i < v.length; i += 9) s += v[i] * (v[i + 4] * v[i + 8] - v[i + 5] * v[i + 7]) - v[i + 1] * (v[i + 3] * v[i + 8] - v[i + 5] * v[i + 6]) + v[i + 2] * (v[i + 3] * v[i + 7] - v[i + 4] * v[i + 6]); return s / 6; }
  // Umlaufsinn nach außen, Ecke auf den Nullpunkt -> { v, dim, vol }
  function finish(v) {
    const vol = volume(v);
    if (vol < 0) for (let i = 0; i < v.length; i += 9) for (let k = 0; k < 3; k++) { const t = v[i + 3 + k]; v[i + 3 + k] = v[i + 6 + k]; v[i + 6 + k] = t; }
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { if (v[i + k] < mn[k]) mn[k] = v[i + k]; if (v[i + k] > mx[k]) mx[k] = v[i + k]; }
    for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) v[i + k] -= mn[k];
    return { v, dim: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]], vol: Math.abs(vol) };
  }
  // Offene Kanten (Prüfung): jede Kante muss genau einmal je Richtung vorkommen.
  function openEdges(v) {
    const m = new Map(), key = i => Math.round(v[i] * 1000) + '_' + Math.round(v[i + 1] * 1000) + '_' + Math.round(v[i + 2] * 1000);
    for (let i = 0; i < v.length; i += 9) {
      const k = [key(i), key(i + 3), key(i + 6)];
      if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue;
      for (let e = 0; e < 3; e++) { const a = k[e], b = k[(e + 1) % 3]; m.set(a + '>' + b, (m.get(a + '>' + b) || 0) + 1); }
    }
    let bad = 0; for (const [e, n] of m) { const p = e.split('>'); if ((m.get(p[1] + '>' + p[0]) || 0) !== n) bad++; }
    return bad;
  }

  // ---------- Urmodell: Kanäle für Fädelstäbe ----------------------------------------------------
  // Gerade Kanäle (rund oder rechteckig) längs durch den vollen Rumpf, je Stab mit Anfang/Ende ab Nase und Höhe
  // an beiden Enden (darf also schräg liegen). Offen sind sie nur an den Trennflächen der Druckstücke (bzw. an
  // einem stumpfen Rumpfende): dort bekommt der Deckel ein Loch (earcut), dazwischen Kanalwand, innen ein Boden.
  function rodShape(r, play, dense) {
    const P = [];
    if (r.shape === 'rect') {
      const hw = (Math.max(0.5, +r.w || 0) + play) / 2, hh = (Math.max(0.5, +r.h || 0) + play) / 2, C = [[hh, hw], [hh, -hw], [-hh, -hw], [-hh, hw]], n = dense ? 6 : 1;
      for (let i = 0; i < 4; i++) for (let j = 0; j < n; j++) { const a = C[i], b = C[(i + 1) % 4], t = j / n; P.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    } else { const R = (Math.max(0.5, +r.d || 0) + play) / 2, n = 32; for (let i = 0; i < n; i++) { const w = 2 * Math.PI * i / n; P.push([R * Math.cos(w), R * Math.sin(w)]); } }
    return P;   // [dy, dz] um die Stabmitte
  }
  function ringAt(S, x) { const col = S.colAt(x), R = col.map(p => [p[0], p[1]]); for (let a = S.K - 2; a >= 1; a--) R.push([col[a][0], -col[a][1]]); return R; }
  // Schnitt eines Dreiecksnetzes (9 Werte je Dreieck) mit der Ebene x -> Linienzüge [[c1, c2], …] (c1/c2 = 2./3. Koordinate)
  function sliceX(v, x) {
    const segs = [];
    for (let i = 0; i < v.length; i += 9) {
      const d = [v[i] - x, v[i + 3] - x, v[i + 6] - x], P = [];
      for (let e = 0; e < 3; e++) { const a = e, b = (e + 1) % 3; if ((d[a] < 0) !== (d[b] < 0)) { const t = d[a] / (d[a] - d[b]), ia = i + a * 3, ib = i + b * 3; P.push([v[ia + 1] + (v[ib + 1] - v[ia + 1]) * t, v[ia + 2] + (v[ib + 2] - v[ia + 2]) * t]); } }
      if (P.length === 2) segs.push(P);
    }
    return chainSegs(segs);
  }
  // Liegen alle Punkte im Querschnitt (gerade-ungerade über alle Linienzüge) und mindestens wall vom Rand entfernt?
  function loopsFit(loops, pts, wall) {
    for (const p of pts) {
      let ins = false, dm = Infinity;
      for (const R of loops) for (let i = 0, n = R.length, j = n - 1; i < n; j = i++) {
        const a = R[i], b = R[j];
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins;
        const ex = b[0] - a[0], ey = b[1] - a[1], L = ex * ex + ey * ey, t = L > 1e-18 ? clamp(((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L, 0, 1) : 0;
        const d = Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t); if (d < dm) dm = d;
      }
      if (!ins || dm < wall) return false;
    }
    return true;
  }
  // rc = { play, wall, list }; o = { x0ref (Nase), X0, X1 (Bereich des Körpers), samples(xs, xe) -> [{ x, loops }],
  // cen(y, z) -> Lage in Netzkoordinaten [c1, c2], swap (Netz hat (z, y) statt (y, z)) }
  // -> [{ a, b (x-Bereich), at(x) -> Mitte [c1, c2], P (Lochumriss), rad, no }], Hinweise nach warn
  function rodChannels(rc, o, warn) {
    const out = [], play = Math.max(0, +rc.play || 0), wall = Math.max(0, +rc.wall || 0), list = Array.isArray(rc.list) ? rc.list : [];
    const sw = P => (o.swap ? P.map(q => [q[1], q[0]]) : P);
    list.forEach((r, n) => {
      const nm = T('Stab') + ' ' + (n + 1) + ': ';
      const xs = clamp(o.x0ref + (+r.x0 || 0), o.X0, o.X1), xe = clamp(o.x0ref + (+r.x1 || 0), o.X0, o.X1);
      if (!(xe - xs > 1)) { warn.push(nm + T('Ende muss hinter dem Anfang liegen.')); return; }
      const P = sw(rodShape(r, play, false)), Pd = sw(rodShape(r, play, true)), rad = Math.max.apply(null, P.map(q => Math.hypot(q[0], q[1])));
      const sm = o.samples(xs, xe);
      for (const zc of ((+r.z || 0) > 1e-6 ? [+r.z, -r.z] : [0])) {
        const at = x => o.cen((+r.y0 || 0) + ((+r.y1 || 0) - (+r.y0 || 0)) * (x - xs) / (xe - xs), zc);
        const ok = sm.map(q => { const m = at(q.x); return loopsFit(q.loops, Pd.map(d => [m[0] + d[0], m[1] + d[1]]), wall); });
        const i0 = ok.indexOf(true), i1 = ok.lastIndexOf(true);
        if (i0 < 0 || i1 <= i0) { warn.push(nm + T('der Kanal passt nirgends in den Rumpfquerschnitt (Lage, Größe oder Mindestwand prüfen).')); continue; }
        if (ok.slice(i0, i1 + 1).indexOf(false) >= 0) { warn.push(nm + T('der Kanal tritt zwischen Anfang und Ende aus dem Rumpf aus — Stab kürzen oder in mehrere Stäbe aufteilen.')); continue; }
        const ch = { a: sm[i0].x, b: sm[i1].x, at, P, rad, no: n + 1 };
        if (out.some(q => q.no !== ch.no && Math.min(q.b, ch.b) > Math.max(q.a, ch.a) && [Math.max(q.a, ch.a), Math.min(q.b, ch.b)].some(x => { const u = q.at(x), w = ch.at(x); return Math.hypot(u[0] - w[0], u[1] - w[1]) < q.rad + ch.rad + 0.4; }))) { warn.push(nm + T('überschneidet sich mit einem anderen Stab — ausgelassen.')); continue; }
        if (i0 > 0 || i1 < sm.length - 1) warn.push(nm + T('Kanal gekürzt auf') + ' ' + r1(ch.a - o.x0ref) + ' … ' + r1(ch.b - o.x0ref) + ' mm ' + T('ab Nase (außerhalb davon zu wenig Querschnitt).'));
        out.push(ch);
      }
    });
    return out;
  }
  // Kanäle in das geschlossene Netz v eines Stücks [xa, xb] einbauen -> { v, ft } | null. Die ebenen Stirnflächen
  // (alle Dreiecke ganz in x = xa bzw. xb) werden entfernt und aus ihrem Randzug mit Löchern neu vernetzt.
  function rodCut(v, xa, xb, chans, warn, ft0, x0ref) {
    const sgn = volume(v) >= 0 ? 1 : -1, add = [], fa = Math.fround(xa), fb = Math.fround(xb);
    const tri = (p, q, r, n) => {
      const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], wx = r[0] - p[0], wy = r[1] - p[1], wz = r[2] - p[2];
      const d = ((uy * wz - uz * wy) * n[0] + (uz * wx - ux * wz) * n[1] + (ux * wy - uy * wx) * n[2]) * sgn;
      if (d >= 0) add.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]); else add.push(p[0], p[1], p[2], r[0], r[1], r[2], q[0], q[1], q[2]);
    };
    const open = [[], []]; let closed = 0;
    for (const ch of chans) {
      const a = Math.max(ch.a, xa), b = Math.min(ch.b, xb); if (!(b - a > 0.5)) continue;
      const oA = a <= xa + 1e-6, oB = b >= xb - 1e-6;
      if (!oA && !oB) { closed++; continue; }
      const ma = ch.at(a), mb = ch.at(b), A = ch.P.map(q => [oA ? fa : a, ma[0] + q[0], ma[1] + q[1]]), B = ch.P.map(q => [oB ? fb : b, mb[0] + q[0], mb[1] + q[1]]), n = A.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, nr = [0, ma[0] - (A[i][1] + A[j][1]) / 2, ma[1] - (A[i][2] + A[j][2]) / 2];
        tri(A[i], A[j], B[j], nr); tri(A[i], B[j], B[i], nr);
      }
      if (oA) open[0].push(A); else for (let i = 1; i + 1 < n; i++) tri(A[0], A[i], A[i + 1], [1, 0, 0]);
      if (oB) open[1].push(B); else for (let i = 1; i + 1 < n; i++) tri(B[0], B[i], B[i + 1], [-1, 0, 0]);
    }
    if (closed) warn.push(closed + ' ' + T('Kanalabschnitte liegen ganz im Inneren eines Stücks (keine Trennfläche im Stabbereich) — ausgelassen.'));
    if (!add.length) return null;
    const isCap = (i, f) => v[i] === f && v[i + 3] === f && v[i + 6] === f, drop = [false, false];
    [fa, fb].forEach((f, e) => {
      if (!open[e].length) return;
      // Randzug der Stirnfläche: Kanten, die nur einmal vorkommen
      const cnt = new Map(), key = (a, b) => a + '_' + b, pk = i => v[i + 1] + '_' + v[i + 2];
      for (let i = 0; i < v.length; i += 9) {
        if (!isCap(i, f)) continue;
        for (let q = 0; q < 3; q++) { const a = i + q * 3, b = i + ((q + 1) % 3) * 3, ka = pk(a), kb = pk(b); if (ka === kb) continue; const k = ka < kb ? key(ka, kb) : key(kb, ka), c = cnt.get(k); if (c) c.n++; else cnt.set(k, { n: 1, p: [v[a + 1], v[a + 2]], q: [v[b + 1], v[b + 2]] }); }
      }
      const segs = []; for (const c of cnt.values()) if (c.n === 1) segs.push([c.p, c.q]);
      const ar = L => { let s2 = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; s2 += p.x * q.y - q.x * p.y; } return Math.abs(s2) / 2; };
      const loops = chainSegs(segs).map(L => { const R = L.slice(); if (R.length > 1 && R[0][0] === R[R.length - 1][0] && R[0][1] === R[R.length - 1][1]) R.pop(); return R.map(p => ({ x: p[0], y: p[1] })); }).filter(R => R.length >= 3).sort((p, q) => ar(q) - ar(p));
      if (!loops.length) return;
      const rings = loops.concat(open[e].map(H => H.map(p => ({ x: p[1], y: p[2] }))));
      const res = App.earcut(rings);
      // earcut lässt Punkte auf geraden Randstücken aus (z. B. Bodenkante des Klotzes) und führt Kanten über Ecken
      // gleich hoher Löcher hinweg -> T-Stöße. Solche Kanten über die Zwischenpunkte führen (Fächer vom dritten Eckpunkt).
      { // alle Punkte, die genau auf einer Dreieckskante liegen (zwischen deren Enden), nach Lage sortiert
        const between = (a, b) => {
          const A = res.V[a], B = res.V[b], L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < 1e-9) return null;
          const mid = [];
          for (let i = 0; i < res.V.length; i++) {
            if (i === a || i === b) continue;
            const P = res.V[i], t = ((P[0] - A[0]) * (B[0] - A[0]) + (P[1] - A[1]) * (B[1] - A[1])) / (L * L);
            if (t <= 1e-9 || t >= 1 - 1e-9 || Math.abs((P[0] - A[0]) * (B[1] - A[1]) - (P[1] - A[1]) * (B[0] - A[0])) / L > 1e-7) continue;
            if (!mid.some(q => Math.abs(q[1] - t) < 1e-12)) mid.push([i, t]);
          }
          return mid.length ? mid.sort((p, q) => p[1] - q[1]).map(q => q[0]) : null;
        };
        const todo = res.tris.slice(), done = []; let guard = 0;
        while (todo.length && guard++ < 200000) {
          const t = todo.pop(); let split = false;
          for (let e = 0; e < 3 && !split; e++) {
            const a = t[e], b = t[(e + 1) % 3], c2 = t[(e + 2) % 3], mid = between(a, b); if (!mid) continue;
            const chain = [a].concat(mid, [b]); for (let k = 0; k + 1 < chain.length; k++) todo.push([chain[k], chain[k + 1], c2]);
            split = true;
          }
          if (!split) done.push(t);
        }
        res.tris = done.concat(todo); }
      let want = ar(rings[0]), got = 0; for (let i = 1; i < rings.length; i++) want -= ar(rings[i]);
      for (const t of res.tris) { const p = res.V[t[0]], q = res.V[t[1]], r = res.V[t[2]]; got += Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2; }
      if (Math.abs(got - want) > Math.max(0.01, want * 1e-4)) warn.push(T('Trennfläche bei') + ' ' + r1(f - (x0ref || 0)) + ' mm: ' + T('Lochbild konnte nicht sauber vernetzt werden — STL prüfen.'));
      for (const t of res.tris) tri([f, res.V[t[0]][0], res.V[t[0]][1]], [f, res.V[t[1]][0], res.V[t[1]][1]], [f, res.V[t[2]][0], res.V[t[2]][1]], [e ? 1 : -1, 0, 0]);
      drop[e] = true;
    });
    const keep = [], kf = [];
    for (let i = 0; i < v.length; i += 9) {
      if ((drop[0] && isCap(i, fa)) || (drop[1] && isCap(i, fb))) continue;
      for (let k = 0; k < 9; k++) keep.push(v[i + k]);
      kf.push(ft0 ? ft0[i / 9] : 0);
    }
    const nv = new Float32Array(keep.length + add.length); nv.set(keep); nv.set(add, keep.length);
    const ft = new Uint8Array(nv.length / 9); ft.set(kf); ft.fill(1, kf.length);
    return { v: nv, ft };
  }

  // ---------- Wickeldorn des Leitwerksrohrs ----------------------------------------------------------
  // Hohlkegel je Druckstück (Achse = Z, s = 0 unten): außen R(s), innen Bohrung rb, Stirnflächen als Ringe.
  // Liefert die 9-Werte-Dreiecksliste mit Umlauf nach außen (Volumen > 0).
  function mandrelPiece(Ra, Rb, L, rb, n) {
    const v = [], P = (r, w, z) => [r * Math.cos(w), r * Math.sin(w), z], same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    const tri = (a, b, c) => { if (!same(a, b) && !same(b, c) && !same(a, c)) v.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); };
    for (let i = 0; i < n; i++) {
      const w0 = 2 * Math.PI * i / n, w1 = 2 * Math.PI * (i + 1) / n;
      const o00 = P(Ra, w0, 0), o01 = P(Ra, w1, 0), o10 = P(Rb, w0, L), o11 = P(Rb, w1, L);
      const i00 = P(rb, w0, 0), i01 = P(rb, w1, 0), i10 = P(rb, w0, L), i11 = P(rb, w1, L);
      tri(o00, o01, o11); tri(o00, o11, o10);   // Mantel außen
      tri(i00, i11, i01); tri(i00, i10, i11);   // Bohrung
      tri(o00, i01, o01); tri(o00, i00, i01);   // Stirn unten (Normale −Z)
      tri(o10, o11, i11); tri(o10, i11, i10);   // Stirn oben (Normale +Z)
    }
    return new Float32Array(v);
  }
  function hasBoom() { const a = srcApi(); return !!(a && a.boom); }
  // Druckstücke des Dorns -> items (Vorschau in Rumpflage längs X, STL stehend mit dem dicken Ende unten)
  function buildBoom(S, c, warn, rods) {
    const bm = S.api.boom; if (!bm) return null;
    const b = c.boom, n = 96, addF = Math.max(0, +b.addF || 0), addR = Math.max(0, +b.addR || 0);
    const sA = -addF, sB = bm.len + addR, L = sB - sA, Rm = s => bm.r0 + bm.k * s - bm.t;
    const rb = Math.max(0, (+b.core || 0) + Math.max(0, +b.corePlay || 0)) / 2;
    const nP = Math.max(1, Math.ceil(L / Math.max(10, +b.segLen || 10) - 1e-9)), pl = L / nP;
    const rMin = Math.min(Rm(sA), Rm(sB));
    if (!(rMin > 0.5)) throw new Error(T('Wickeldorn: am dünnen Ende bleibt kein Querschnitt — Zugabe hinten kürzer oder Rohr hinten dicker wählen.'));
    if (rb > 0 && rMin - rb < Math.max(0.5, +b.minWall || 0)) warn.push(T('Wickeldorn: Wand um die Bohrung am dünnen Ende nur') + ' ' + (rMin - rb).toFixed(2) + ' mm — ' + T('Seelenrohr dünner oder Zugabe hinten kürzer wählen.'));
    const gap = Math.max(0, +c.segGap || 0), items = [];
    for (let k = 0; k < nP; k++) {
      const s0 = sA + pl * k, s1 = s0 + pl, R0 = Rm(s0), R1 = Rm(s1), big = R0 >= R1;
      // Druck: dickes Ende unten
      const v = mandrelPiece(big ? R0 : R1, big ? R1 : R0, pl, rb, n), f = finish(new Float32Array(v)), oe = openEdges(f.v);
      if (oe) warn.push(T('Wickeldorn: Netz nicht geschlossen') + ' (' + oe + ')');
      // Vorschau: Achse längs X ab dem Übergang (ohne Neigung), Stücke um den Vorschauabstand auseinander
      const x0 = bm.xT + s0 + k * gap;
      const pv = mapV(v, (x, y, z) => (big ? [x0 + z, bm.yc + y, -x] : [x0 + pl - z, bm.yc + y, x]));
      items.push({ name: 'leitwerksrohr_wickeldorn' + (nP > 1 ? '_' + T('teil') + String(k + 1).padStart(2, '0') : ''), v: pv, ft: new Uint8Array(pv.length / 9), out: f.v, dim: f.dim, vol: f.vol });
      if (rb > 0) { const ring = x => { const P = []; for (let i = 0; i < 24; i++) { const w = 2 * Math.PI * i / 24; P.push([x, bm.yc + rb * Math.cos(w), rb * Math.sin(w)]); } return P; }; rods.push({ A: ring(x0), B: ring(x0 + pl) }); }
    }
    return { items, nP, pl, sA, sB, Rf: Rm(sA), Rr: Rm(sB), rb };
  }

  // ---------- Aufbau ------------------------------------------------------------------------------
  // cache = { items [{ name, v (Vorschau, Modellkoordinaten), ft, out (STL), dim, vol }], warn [], err }
  let cache = null, canInfo = null, boomInfo = null;   // canInfo: Bereich und Querschnittsmitte der Haubenform (für die Stab-Vorgaben)
  function hasCanopy() { const a = srcApi(); return !!(a && a.canopy); }
  function build() {
    const c = cfg();
    try {
      const S = source(); if (!S) { cache = { none: true }; return cache; }
      const items = [], warn = [], rods = [], seg = k => (c.seg.on ? k * Math.max(0, +c.segGap || 0) : 0), tn = (k, n) => (n > 1 ? '_' + T('teil') + String(k + 1).padStart(2, '0') : '');
      if (c.part === 'boom') {
        const r = buildBoom(S, c, warn, rods);
        if (!r) { cache = { err: T('Kein Leitwerksrohr — im Reiter „Rumpf" die Gruppe „Rumpfboot + Leitwerksrohr" einschalten.') }; return cache; }
        items.push(...r.items); boomInfo = r;
      } else if (c.part === 'can' && c.canTarget === 'ur') {
        const m = canUr(S, c, warn);
        if (!m) { cache = { err: T('Keine Kabinenhaube — im Reiter „Rumpf" in der Gruppe „Kabinenhaube" einschalten.') }; return cache; }
        const f = finish(mapV(m.v, (x, y, z) => [x, -z, y])), oe = openEdges(f.v);
        if (oe) warn.push(T('Das Netz ist nicht geschlossen') + ' (' + oe + ' ' + T('offene Kanten') + ') — ' + T('Haubenlinie und Sicke prüfen.'));
        if (c.seg.on) warn.push(T('Das Urmodell der Haube wird nicht in Druckstücke geteilt.'));
        items.push({ name: 'haube_urmodell', v: m.v, ft: m.ft, out: f.v, dim: f.dim, vol: f.vol });
      } else if (c.part === 'can' && c.canTarget === 'shell') {
        items.push(...shellItems(S, c, warn, seg));
        for (const it of items) { const oe = openEdges(it.out); if (oe) warn.push(it.name + ': ' + oe + ' ' + T('offene Kanten')); }
      } else if (c.part === 'can') {
        const src = canSrc(S, c);
        if (!src) { cache = { err: T('Keine Kabinenhaube — im Reiter „Rumpf" in der Gruppe „Kabinenhaube" einschalten.') }; return cache; }
        const neg = c.canTarget === 'neg', margin = Math.max(0, +c.can.margin || 0);
        const res = pieces(src, { type: neg ? 'neg' : 'pos', margin, back: neg ? Math.max(1, +c.can.wall || 1) : (margin > 0 ? Math.max(1, +c.can.plate || 1) : Math.max(0, +c.can.plate || 0)), cuts: cutList(c, src.x0, src.x1) });
        const ms = res.list.map(m => { let a = Infinity, b = -Infinity; for (let i = 0; i < m.v.length; i += 3) { if (m.v[i] < a) a = m.v[i]; if (m.v[i] > b) b = m.v[i]; } return { v: m.v, xa: a, xb: b }; });
        canInfo = { xa: ms[0].xa - S.x0, xb: ms[ms.length - 1].xb - S.x0, mid: xr => {   // Mitte des Formquerschnitts (Höhe Y) bei x ab Nase
          const x = S.x0 + xr, q = ms.find(q => x >= q.xa && x <= q.xb) || ms[0], L = sliceX(q.v, clamp(x, q.xa + 0.05, q.xb - 0.05)); let a = Infinity, b = -Infinity;
          for (const R of L) for (const p of R) { if (p[1] < a) a = p[1]; if (p[1] > b) b = p[1]; }
          return isFinite(a) ? r1(src.yB + (a + b) / 2) : r1(src.yB); } };
        if (c.rodsCan.on) {
          const chans = rodChannels(c.rodsCan, { x0ref: S.x0, X0: ms[0].xa, X1: ms[ms.length - 1].xb, swap: true, cen: (y, z) => [z, y - src.yB], samples: (xs, xe) => {
            const out = [];
            for (const q of ms) { const a = Math.max(xs, q.xa), b = Math.min(xe, q.xb); if (!(b - a > 0.5)) continue; const n = Math.max(2, Math.ceil((b - a) / 10) + 1); for (let i = 0; i < n; i++) { const x = a + (b - a) * i / (n - 1); out.push({ x, loops: sliceX(q.v, clamp(x, q.xa + 0.05, q.xb - 0.05)) }); } }
            return out.filter((q, i) => !i || q.x - out[i - 1].x > 1e-6); } }, warn);
          if (chans.length) res.list.forEach((m, k) => {
            const q = ms[k], rc = rodCut(m.v, q.xa, q.xb, chans, warn, m.ft, S.x0); if (rc) { m.v = rc.v; m.ft = rc.ft; }
            for (const ch of chans) {
              const a = Math.max(ch.a, q.xa), b = Math.min(ch.b, q.xb); if (!(b - a > 0.5)) continue;
              const pa = ch.at(a), pb = ch.at(b);
              rods.push({ A: ch.P.map(d => [a + seg(k), pa[1] + d[1] + src.yB, pa[0] + d[0]]), B: ch.P.map(d => [b + seg(k), pb[1] + d[1] + src.yB, pb[0] + d[0]]) });
            }
          });
          if (chans.length && ms.length < 2) warn.push(T('Fädelstäbe: ohne Teilung in Druckstücke gibt es keine Trennflächen, an denen die Kanäle offen sind.'));
        }
        res.list.forEach((m, k) => {
          const f = finish(mapV(m.v, neg ? (x, u, h) => [x, u, -h] : (x, u, h) => [x, -u, h]));
          items.push({ name: 'haube_' + (neg ? 'negativ' : 'tiefziehklotz') + tn(k, res.list.length), v: mapV(m.v, (x, u, h) => [x + seg(k), h + src.yB, u]), ft: m.ft, out: f.v, dim: f.dim, vol: f.vol });
        });
        if (src.under) warn.push(T('Die Haubenlinie liegt stellenweise unter der breitesten Stelle des Rumpfs — dort wird die Form senkrecht weitergeführt (sonst Hinterschnitt).'));
      } else if (c.target === 'ur') {
        const mfg = window.RumpfPro && RumpfPro._test && RumpfPro._test.meshFromGrid;
        if (!mfg) throw new Error(T('Rumpf zu alt für das Urmodell.'));
        const bd = [S.x0].concat(cutList(c, S.x0, S.x1), [S.x1]);
        const chans = c.rods.on ? rodChannels(c.rods, { x0ref: S.x0, X0: S.x0, X1: S.x1, cen: (y, z) => [y, z], samples: (xs, xe) =>
          [xs, xe].concat(bd.filter(x => x > xs && x < xe), S.XS.filter(x => x > xs && x < xe)).sort((a, b) => a - b).filter((x, i, A) => !i || x - A[i - 1] > 1e-6).map(x => ({ x, loops: [ringAt(S, x)] })) }, warn) : [];
        for (let k = 0; k + 1 < bd.length; k++) {
          const xs = [bd[k]].concat(S.XS.filter(x => x > bd[k] + 0.05 && x < bd[k + 1] - 0.05), [bd[k + 1]]), colsX = xs.map(x => S.colAt(x)), Gs = [];
          for (let a = 0; a < S.K; a++) Gs.push(xs.map((x, b) => [x, colsX[b][a][0], colsX[b][a][1]]));
          let v = mfg(Gs, { mirror: true, seam: true }).v, ftv = null;
          if (chans.length) { const rc = rodCut(v, bd[k], bd[k + 1], chans, warn, null, S.x0); if (rc) { v = rc.v; ftv = rc.ft; } }
          for (const ch of chans) {   // Anzeige: Kanalabschnitt dieses Stücks (Vorschaulage)
            const a = Math.max(ch.a, bd[k]), b = Math.min(ch.b, bd[k + 1]); if (!(b - a > 0.5)) continue;
            const pa = ch.at(a), pb = ch.at(b);
            rods.push({ A: ch.P.map(q => [a + seg(k), pa[0] + q[0], pa[1] + q[1]]), B: ch.P.map(q => [b + seg(k), pb[0] + q[0], pb[1] + q[1]]) });
          }
          const f = finish(mapV(v, (x, y, z) => [x, -z, y]));
          items.push({ name: 'rumpf_urmodell' + tn(k, bd.length - 1), v: mapV(v, (x, y, z) => [x + seg(k), y, z]), ft: ftv || new Uint8Array(v.length / 9), out: f.v, dim: f.dim, vol: f.vol });
        }
        if (c.rods.on && chans.length && bd.length < 3) warn.push(T('Fädelstäbe: ohne Teilung in Druckstücke gibt es keine Trennflächen, an denen die Kanäle offen sind.'));
      } else {
        const neg = c.target === 'neg', mg = Math.max(0, +c.margin || 0);
        let ft = mg > 0 ? featProfile(c, neg) : null;
        if (ft && mg < ft.sMax + 3) { ft = null; warn.push(T('Huckel/Blutrinne passen nicht in den Formenrand — Rand breiter wählen.')); }
        else if (!ft && mg <= 0 && (c.blut.on || (neg && c.hk.on))) warn.push(T('Huckel/Blutrinne brauchen einen Formenrand.'));
        const margin = ft ? mg - ft.sMax - 1 : mg, edge = c.edge === 'offset' && mg > 0 ? { margin: mg } : null;
        const hl = c.holes.on && margin > 0 ? { d: Math.max(1, +c.holes.d || 1), n: c.holes.n } : null;
        const rot = +c.rot || 0, rotOn = Math.abs(rot) > 1e-6, y0 = c.rotY == null || !isFinite(+c.rotY) ? (S.yMin + S.yMax) / 2 : +c.rotY;
        const cs = Math.cos(rot * Math.PI / 180), sn = Math.sin(rot * Math.PI / 180);
        const off = Math.max(0, +c.gap || 0) / 2 + (neg ? 0 : Math.max(0, +c.plate || 0)), o2 = c.side === 'both' ? off : 0;
        let src = null, res = null, part = 0;
        for (const sd of (c.side === 'both' ? ['r', 'l'] : [c.side])) {
          const R = sd === 'r';
          if (rotOn || !res) {
            const Sx = rotOn ? rotSrc(S, rot, y0, R ? 1 : -1) : S; part += Sx.part || 0;
            src = fusSrc(Sx, c, ft, edge);
            res = pieces(src, { type: neg ? 'neg' : 'pos', margin, back: neg ? Math.max(1, +c.wall || 1) : Math.max(margin > 0 ? 1 : 0, +c.plate || 0), holes: hl, cuts: cutList(c, src.x0, src.x1) });
          }
          const map = (x, u, h) => { const hT = (R ? 1 : -1) * (h + o2); return [x, y0 + (u - y0) * cs + hT * sn, -(u - y0) * sn + hT * cs]; };
          res.list.forEach((m, k) => {
            const su = (neg ? R : !R) ? -1 : 1, sh = neg ? -1 : 1, f = finish(mapV(m.v, (x, u, h) => [x, su * u, sh * h]));
            let xa = Infinity, xb = -Infinity, ua = Infinity, ub = -Infinity;
            for (let i = 0; i < m.v.length; i += 3) { if (m.v[i] < xa) xa = m.v[i]; if (m.v[i] > xb) xb = m.v[i]; if (m.v[i + 1] < ua) ua = m.v[i + 1]; if (m.v[i + 1] > ub) ub = m.v[i + 1]; }
            const pp = [[xa, ua], [xb, ua], [xb, ub], [xa, ub]].map(q => { const w = map(q[0], q[1], 0); w[0] += seg(k); return w; });
            items.push({ name: (neg ? 'rumpfform_negativ_' : 'rumpf_halbschale_') + (rotOn ? (R ? 'haelfte_a' : 'haelfte_b') : (R ? 'rechts' : 'links')) + tn(k, res.list.length),
              v: mapV(m.v, (x, u, h) => { const w = map(x, u, h); w[0] += seg(k); return w; }), ft: m.ft, out: f.v, dim: f.dim, vol: f.vol, pp });
          });
        }
        if (part) warn.push(T('Trennebene: an') + ' ' + part + ' ' + T('Schnitten liegt die breiteste Stelle nicht in der Trennebene — die Form wird dort senkrecht weitergeführt (Hinterschnitt am Bauteil).'));
        if (c.holes.on && margin > 0 && res.skipped) warn.push(res.skipped + ' ' + T('Passlöcher passen nicht in den Formenrand (Rand breiter oder Durchmesser kleiner wählen).'));
        if (c.holes.on && !(margin > 0)) warn.push(T('Passlöcher brauchen einen Formenrand.'));
        if (src.under) warn.push(T('Hinterschnitt: an') + ' ' + src.under + ' ' + T('Schnitten läuft die Kontur wieder nach oben (z. B. Tragflächenübergang) — die Halbschale lässt sich dort nicht gerade entformen.'));
      }
      cache = { items, warn: warn.filter((w, i) => warn.indexOf(w) === i), rods };
    } catch (e) { console.error(e); cache = { err: e.message }; }
    return cache;
  }

  // ---------- Export -------------------------------------------------------------------------------
  function toBinarySTL(v) {
    const n = Math.floor(v.length / 9), buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf), hdr = 'AI Foam Cut Rumpf Formenbau';
    for (let i = 0; i < 80; i++) dv.setUint8(i, i < hdr.length ? hdr.charCodeAt(i) : 0);
    dv.setUint32(80, n, true);
    let o = 84;
    for (let i = 0; i < n * 9; i += 9) {
      const ux = v[i + 3] - v[i], uy = v[i + 4] - v[i + 1], uz = v[i + 5] - v[i + 2], wx = v[i + 6] - v[i], wy = v[i + 7] - v[i + 1], wz = v[i + 8] - v[i + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const L = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / L, true); dv.setFloat32(o + 4, ny / L, true); dv.setFloat32(o + 8, nz / L, true); o += 12;
      for (let k = 0; k < 9; k++) { dv.setFloat32(o, v[i + k], true); o += 4; }
      dv.setUint16(o, 0, true); o += 2;
    }
    return buf;
  }
  function base() { return ((state.projectName || 'rumpf').replace(/[^\w\-]+/g, '_')) || 'rumpf'; }
  async function exportStl() {
    const r = build(); if (!r || !r.items || !r.items.length) { alert(T('Keine Form.')); return; }
    if (App.demoSaveBlocked && App.demoSaveBlocked('svStl')) return;
    const list = r.items.map(it => ({ name: base() + '_' + it.name + '.stl', v: it.out }));
    if (list.length === 1) { if (typeof App.download === 'function') App.download(list[0].name, toBinarySTL(list[0].v), 'model/stl', 'svStl'); else App.anchorDownload(list[0].name, toBinarySTL(list[0].v), 'model/stl'); return; }
    if (App.stlSaveMany) { await App.stlSaveMany(list, 'svStl', { name: base() + '_formen' }); return; }   // Vorschau + 3MF oder STL je Teil
    let i = 0; for (const it of list) setTimeout(() => App.anchorDownload(it.name, toBinarySTL(it.v), 'model/stl'), 300 * i++);
  }

  // ---------- Vorschau (WebGL2, Rückfall Canvas-2D) ---------------------------------------------------
  let canvas = null, ctx = null, W = 0, H = 0, bound = false;
  const CAM0 = { yaw: 0.9, pitch: 0.45, zoom: 1, px: 0, py: 0 }, cam = Object.assign({}, CAM0);
  let center = [0, 0, 0], radius = 100;
  let pivot = null, pivotKey = '';   // eigener Drehpunkt (Mausrad-Doppelklick), sonst Modellmitte; pivotKey = Bauteil, zu dem er gehört
  const LIGHT = (() => { const l = [-0.35, 0.55, 0.75], n = Math.hypot(...l); return l.map(x => x / n); })();
  function rot(n) {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), x1 = n[0] * cy + n[2] * sy, z1 = -n[0] * sy + n[2] * cy, cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    return [x1, n[1] * cp - z1 * sp, n[1] * sp + z1 * cp];
  }
  function scr(x, y, z) { const r = rot([x - center[0], y - center[1], z - center[2]]), s = 0.42 * Math.min(W, H) / radius * cam.zoom; return { x: W / 2 + cam.px + s * r[0], y: H / 2 + cam.py - s * r[1], d: r[2] }; }
  function fit() {
    canvas = document.getElementById('cRprof'); if (!canvas) return false;
    const dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
    W = r.width; H = r.height; if (!(W > 0 && H > 0)) return false;
    canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
    ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!bound) bind();
    return true;
  }
  // Weltpunkt unter dem Bildschirmpunkt (x, y): vorderstes Dreieck (wie gezeichnet, ohne die per Schnitt
  // entfernte Seite); sonst nächster Netzpunkt in 14 px Umkreis.
  function pick3d(x, y) {
    const items = cache && cache.items; if (!items || !items.length) return null;
    const cut = cutSpec(); let best = null;
    for (const it of items) {
      const v = it.v;
      for (let i = 0; i < v.length; i += 9) {
        if (cut && cut.rm * ((v[i + cut.k] + v[i + 3 + cut.k] + v[i + 6 + cut.k]) / 3 - cut.pos) > 0) continue;
        const a = scr(v[i], v[i + 1], v[i + 2]), b = scr(v[i + 3], v[i + 4], v[i + 5]), c = scr(v[i + 6], v[i + 7], v[i + 8]);
        if (x < Math.min(a.x, b.x, c.x) || x > Math.max(a.x, b.x, c.x) || y < Math.min(a.y, b.y, c.y) || y > Math.max(a.y, b.y, c.y)) continue;
        const den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y); if (Math.abs(den) < 1e-9) continue;
        const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / den, w = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / den, t = 1 - u - w;
        if (u < -1e-6 || w < -1e-6 || t < -1e-6) continue;
        const d = u * a.d + w * b.d + t * c.d;   // kleiner = vorne (wie der Tiefenpuffer)
        if (!best || d < best.d) best = { d, pt: [u * v[i] + w * v[i + 3] + t * v[i + 6], u * v[i + 1] + w * v[i + 4] + t * v[i + 7], u * v[i + 2] + w * v[i + 5] + t * v[i + 8]] };
      }
    }
    if (best) return best.pt;
    if (!(window.ViewCube && ViewCube.pickNear)) return null;
    return ViewCube.pickNear(x, y, cb => { for (const it of items) { const v = it.v; for (let i = 0; i < v.length; i += 3) cb(v[i], v[i + 1], v[i + 2]); } }, scr, 14);
  }
  // Drehpunkt auf den Modellpunkt unter dem Cursor legen; der Punkt bleibt dabei an seiner Bildschirmstelle
  // (scr(pivot) = Bildmitte + px/py, weil der Drehpunkt das neue Zentrum ist).
  function setPivotAt(x, y) {
    if (is2d()) return false;
    const pt = pick3d(x, y); if (!pt) return false;
    const q = scr(pt[0], pt[1], pt[2]);
    pivot = pt; center = pt; cam.px = q.x - W / 2; cam.py = q.y - H / 2;
    draw(); return true;
  }
  function bind() {
    bound = true; let drag = false, pan = false, lx = 0, ly = 0;
    canvas.addEventListener('mousedown', e => {
      const r = canvas.getBoundingClientRect(), k = e.button === 0 ? btnHit(e.clientX - r.left, e.clientY - r.top) : null;
      if (k) { btnClick(k); e.preventDefault(); return; }
      if (shellEditOn() && e.button === 0) { shGrab = shellHit(e.clientX - r.left, e.clientY - r.top); if (shGrab) { e.preventDefault(); return; } }
      drag = true; pan = e.shiftKey || e.button !== 0; lx = e.clientX; ly = e.clientY; e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (shGrab) { const r = canvas.getBoundingClientRect(); shellDrag(shGrab, e.clientX - r.left, e.clientY - r.top); draw(); return; }
      if (!drag) return; const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
      if (is2d()) { cam2.px += dx; cam2.py += dy; } else if (pan) { cam.px += dx; cam.py += dy; } else { cam.yaw -= dx * 0.01; cam.pitch = clamp(cam.pitch - dy * 0.01, -1.55, 1.55); }
      draw();
    });
    window.addEventListener('mouseup', () => { drag = false; if (shGrab) { shGrab = null; if (App.buildSidebar) App.buildSidebar(); render(); } });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => { e.preventDefault(); const q = is2d() ? cam2 : cam; q.zoom = clamp(q.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.1, 60); draw(); }, { passive: false });
    canvas.addEventListener('dblclick', () => { if (is2d()) Object.assign(cam2, { zoom: 1, px: 0, py: 0 }); else { Object.assign(cam, CAM0); pivot = null; } draw(); });
    if (window.ViewCube && ViewCube.midDbl) ViewCube.midDbl(canvas, (x, y) => setPivotAt(x, y));   // Mausrad-Doppelklick = Drehpunkt
    const vb = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
    const to3d = over => { Object.assign(cam, CAM0, over || {}); pivot = null; cfg().cut.view = '3d'; buildCutPanel(); draw(); };
    vb('rprofIso', () => to3d()); vb('rprofTop', () => to3d({ yaw: 0, pitch: 1.5 })); vb('rprofSide', () => to3d({ yaw: 0, pitch: 0 })); vb('rprofFront', () => to3d({ yaw: Math.PI / 2, pitch: 0 }));
    vb('rprofCut', () => { const q = cfg().cut; if (q.on && q.view === '2d') q.view = '3d'; else { q.on = true; q.view = '2d'; Object.assign(cam2, { zoom: 1, px: 0, py: 0 }); } buildCutPanel(); draw(); });
    window.addEventListener('keydown', e => {
      if (state.activeTab !== 'rprof' || !cfg().cut.on || /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { cutStep(-1); e.preventDefault(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { cutStep(+1); e.preventDefault(); }
    });
    // gemeinsamer Ansichtswürfel (viewcube.js) wie im Formenbau
    if (window.ViewCube) ViewCube.attach({ reset: () => { Object.assign(cam, CAM0); pivot = null; }, canvas: () => canvas, get: () => cam, set: (y, p) => { cam.yaw = y; cam.pitch = p; }, redraw: () => draw(), rot: ViewCube.ROT_STD, k: [-0.01, -0.01], active: () => !is2d(),
      labels: { '-x': 'Nase', '+x': 'Heck', '+y': 'Oben', '-y': 'Unten', '+z': 'Rechts', '-z': 'Links' } });
  }
  function cssVar(name, fb) { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb; } catch (e) { return fb; } }
  function hexRGB(h, fb) { const m = /^#([0-9a-f]{6})$/i.exec(h || ''); return m ? [parseInt(m[1].slice(0, 2), 16) / 255, parseInt(m[1].slice(2, 4), 16) / 255, parseInt(m[1].slice(4, 6), 16) / 255] : fb; }
  function bgRGB() {
    try { ctx.fillStyle = cssVar('--bg', '#0f1216'); const n = ctx.fillStyle; let m = hexRGB(n, null); if (m) return m; m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(n); if (m) return [m[1] / 255, m[2] / 255, m[3] / 255]; } catch (e) {}
    return [0.06, 0.07, 0.09];
  }
  function colors() { return [hexRGB(colOf('formColSurf')), hexRGB(colOf('formColRim'))]; }
  let glc = null, gl = null, glP = null, glL = null, glVao = null, glTried = false;
  const glBufs = new Map(); let glQuad = null;
  function glInit() {
    if (glTried || !canvas) return; glTried = true;
    try {
      glc = document.createElement('canvas'); glc.id = 'cRprofGL'; glc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
      canvas.parentNode.insertBefore(glc, canvas);
      gl = glc.getContext('webgl2', { antialias: true, alpha: false, depth: true, stencil: true }); if (!gl) throw new Error('no webgl2');
      const VS = `#version 300 es
        in vec3 aPos; in float aTag; out vec3 vW;
        uniform vec3 uCenter; uniform float uYaw; uniform float uPitch; uniform vec4 uProj; uniform float uZScale;
        out vec3 vCam; flat out int vTag;
        vec3 rot(vec3 p){ float cy = cos(uYaw), sy = sin(uYaw), cp = cos(uPitch), sp = sin(uPitch);
          float x1 = p.x*cy + p.z*sy, z1 = -p.x*sy + p.z*cy; return vec3(x1, p.y*cp - z1*sp, p.y*sp + z1*cp); }
        void main(){ vec3 c = rot(aPos - uCenter); vCam = c; vW = aPos; vTag = int(aTag + 0.5);
          gl_Position = vec4(uProj.z + uProj.x*c.x, uProj.w + uProj.y*c.y, c.z*uZScale, 1.0); }`;
      const FS = `#version 300 es
        precision highp float;
        in vec3 vCam; flat in int vTag; uniform vec3 uCol[2]; uniform vec3 uLight; uniform int uWire; uniform vec3 uBg; in vec3 vW; uniform vec4 uClip; uniform int uClipOn; uniform int uCap; out vec4 o;
        void main(){ vec3 col = uCol[vTag < 1 ? 0 : 1];
          if (uCap == 1) { o = vec4(min(vec3(1.0), uCol[1] * 1.2 + 0.06), 1.0); return; }
          if (uClipOn == 1 && dot(uClip.xyz, vW) > uClip.w) discard;
          if (uWire == 2) { o = vec4(uBg, 1.0); return; }
          if (uWire == 1) { o = vec4(min(vec3(1.0), col * 1.25 + 0.08), 1.0); return; }
          vec3 n = normalize(cross(dFdx(vCam), dFdy(vCam))); if (n.z > 0.0) n = -n;
          float lam = max(0.0, dot(n, uLight)); o = vec4(col * (0.32 + 0.68*lam), 1.0); }`;
      const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
      glP = gl.createProgram(); gl.attachShader(glP, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(glP, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(glP);
      if (!gl.getProgramParameter(glP, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glP));
      glL = {}; for (const u of ['uCenter', 'uYaw', 'uPitch', 'uProj', 'uZScale', 'uCol', 'uLight', 'uWire', 'uBg', 'uClip', 'uClipOn', 'uCap']) glL[u] = gl.getUniformLocation(glP, u);
      glL.aPos = gl.getAttribLocation(glP, 'aPos'); glL.aTag = gl.getAttribLocation(glP, 'aTag');
      glVao = gl.createVertexArray();
      glc.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; glBufs.clear(); glQuad = null; }, false);
    } catch (e) {
      console.warn('Rumpf Formenbau: WebGL2 nicht verfügbar, Canvas-2D-Darstellung:', e && e.message);
      gl = null; if (glc && glc.parentNode) glc.parentNode.removeChild(glc); glc = null;
    }
  }
  function glDraw(items, cut, bnd) {
    const dpr = window.devicePixelRatio || 1, w = Math.max(1, Math.round(W * dpr)), h = Math.max(1, Math.round(H * dpr));
    if (glc.width !== w || glc.height !== h) { glc.width = w; glc.height = h; }
    const bg = bgRGB(), cols = colors();
    gl.viewport(0, 0, w, h); gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    for (const b of glBufs.values()) b.used = false;
    gl.useProgram(glP); gl.bindVertexArray(glVao); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    const s = 0.42 * Math.min(W, H) / radius * cam.zoom;
    gl.uniform4f(glL.uProj, 2 * s / W, 2 * s / H, 2 * cam.px / W, -2 * cam.py / H); gl.uniform1f(glL.uZScale, 1 / (radius * 3));
    gl.uniform3f(glL.uCenter, center[0], center[1], center[2]); gl.uniform1f(glL.uYaw, cam.yaw); gl.uniform1f(glL.uPitch, cam.pitch);
    gl.uniform3f(glL.uLight, LIGHT[0], LIGHT[1], LIGHT[2]); gl.uniform3fv(glL.uCol, new Float32Array([...cols[0], ...cols[1]]));
    const wire = !!cfg().wire; gl.uniform3f(glL.uBg, bg[0], bg[1], bg[2]);
    gl.uniform1i(glL.uCap, 0); gl.uniform1i(glL.uClipOn, cut ? 1 : 0);
    if (cut) { const nq = [0, 0, 0]; nq[cut.k] = cut.rm; gl.uniform4f(glL.uClip, nq[0], nq[1], nq[2], cut.rm * cut.pos); }
    const bindB = buf => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(glL.aPos); gl.vertexAttribPointer(glL.aPos, 3, gl.FLOAT, false, 16, 0); gl.enableVertexAttribArray(glL.aTag); gl.vertexAttribPointer(glL.aTag, 1, gl.FLOAT, false, 16, 12); };
    for (const it of items) {
      let b = glBufs.get(it);
      if (!b) {
        const n = it.v.length / 3, d = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) { d[i * 4] = it.v[i * 3]; d[i * 4 + 1] = it.v[i * 3 + 1]; d[i * 4 + 2] = it.v[i * 3 + 2]; d[i * 4 + 3] = it.ft[(i / 3) | 0]; }
        b = { vbo: gl.createBuffer(), n }; gl.bindBuffer(gl.ARRAY_BUFFER, b.vbo); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW); glBufs.set(it, b);
      }
      b.used = true;
      if (!wire) {
        gl.uniform1i(glL.uWire, 0); bindB(b.vbo); gl.drawArrays(gl.TRIANGLES, 0, b.n);
        if (cut && cut.fill) {   // Schnittfläche: Stencil-Parität des aufgeschnittenen (geschlossenen) Körpers, dann Ebene füllen
          gl.enable(gl.STENCIL_TEST); gl.clear(gl.STENCIL_BUFFER_BIT); gl.colorMask(false, false, false, false); gl.depthMask(false); gl.disable(gl.DEPTH_TEST);
          gl.stencilFunc(gl.ALWAYS, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT); gl.drawArrays(gl.TRIANGLES, 0, b.n);
          gl.colorMask(true, true, true, true); gl.depthMask(true); gl.enable(gl.DEPTH_TEST); gl.stencilFunc(gl.NOTEQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
          const k = cut.k, a = (k + 1) % 3, c2 = (k + 2) % 3, m = radius * 0.1, Q = [[bnd.mn[a] - m, bnd.mn[c2] - m], [bnd.mx[a] + m, bnd.mn[c2] - m], [bnd.mx[a] + m, bnd.mx[c2] + m], [bnd.mn[a] - m, bnd.mx[c2] + m]], d = new Float32Array(24);
          [0, 1, 2, 0, 2, 3].forEach((qi, i) => { d[i * 4 + k] = cut.pos; d[i * 4 + a] = Q[qi][0]; d[i * 4 + c2] = Q[qi][1]; d[i * 4 + 3] = 1; });
          if (!glQuad) glQuad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, glQuad); gl.bufferData(gl.ARRAY_BUFFER, d, gl.DYNAMIC_DRAW); bindB(glQuad);
          gl.uniform1i(glL.uClipOn, 0); gl.uniform1i(glL.uCap, 1); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.uniform1i(glL.uCap, 0); gl.uniform1i(glL.uClipOn, 1); gl.disable(gl.STENCIL_TEST);
        }
        continue;
      }
      // Drahtgitter: Flächen in Hintergrundfarbe verdecken die hinteren Kanten
      if (!b.lbo) {
        const nt = it.v.length / 9, d = new Float32Array(nt * 24);
        for (let t = 0, q = 0; t < nt; t++) for (let e = 0; e < 3; e++) for (const k of [e, (e + 1) % 3]) { const i = t * 9 + k * 3; d[q++] = it.v[i]; d[q++] = it.v[i + 1]; d[q++] = it.v[i + 2]; d[q++] = it.ft[t]; }
        b.lbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b.lbo); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW); b.nl = nt * 6;
      }
      gl.uniform1i(glL.uWire, 2); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 2); bindB(b.vbo); gl.drawArrays(gl.TRIANGLES, 0, b.n); gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));   // Treiberfalle: sonst gehen die Linien ab dem 2. Bild verloren
      gl.uniform1i(glL.uWire, 1); bindB(b.lbo); gl.drawArrays(gl.LINES, 0, b.nl);
    }
    gl.bindVertexArray(null);
    for (const [k, b] of glBufs) if (!b.used) { gl.deleteBuffer(b.vbo); if (b.lbo) gl.deleteBuffer(b.lbo); glBufs.delete(k); }
  }
  function drawShaded(items, cut) {
    const faces = [], cols = colors().map(c => c.map(x => Math.round(x * 255))), wire = !!cfg().wire;
    for (const it of items) {
      const v = it.v;
      for (let i = 0, t = 0; i < v.length; i += 9, t++) {
        if (cut && cut.rm * ((v[i + cut.k] + v[i + 3 + cut.k] + v[i + 6 + cut.k]) / 3 - cut.pos) > 0) continue;
        const ux = v[i + 3] - v[i], uy = v[i + 4] - v[i + 1], uz = v[i + 5] - v[i + 2], wx = v[i + 6] - v[i], wy = v[i + 7] - v[i + 1], wz = v[i + 8] - v[i + 2];
        let n = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx]; const L = Math.hypot(...n) || 1; n = rot(n.map(x => x / L)); if (n[2] > 0) n = n.map(x => -x);
        const p0 = scr(v[i], v[i + 1], v[i + 2]), p1 = scr(v[i + 3], v[i + 4], v[i + 5]), p2 = scr(v[i + 6], v[i + 7], v[i + 8]);
        faces.push({ p: [p0, p1, p2], d: (p0.d + p1.d + p2.d) / 3, l: 0.32 + 0.68 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]), c: cols[it.ft[t] ? 1 : 0] });
      }
    }
    faces.sort((a, b) => b.d - a.d);
    for (const f of faces) {
      ctx.beginPath(); ctx.moveTo(f.p[0].x, f.p[0].y); ctx.lineTo(f.p[1].x, f.p[1].y); ctx.lineTo(f.p[2].x, f.p[2].y); ctx.closePath();
      if (wire) { ctx.fillStyle = cssVar('--bg', '#0f1216'); ctx.strokeStyle = 'rgb(' + f.c.join(',') + ')'; }
      else ctx.fillStyle = ctx.strokeStyle = (window.DrawTheme ? DrawTheme.raw('rgb(' + f.c.map(x => Math.round(x * f.l)).join(',') + ')') : 'rgb(' + f.c.map(x => Math.round(x * f.l)).join(',') + ')');
      ctx.fill(); ctx.stroke();
    }
  }
  // Knöpfe unter dem Ansichtswürfel (wie im Formenbau): Hälften, Abstand, Trennfläche, Drahtgitter
  let btns = [];
  const halves = c => c.part === 'fus' && c.target !== 'ur';
  function drawBtns() {
    btns = []; const c = cfg(), hv = halves(c), items = hv ? [['s:both', 'beide Hälften'], ['s:r', 'nur rechte Form'], ['s:l', 'nur linke Form'], ['ps', 'Trennfläche']] : [];
    items.push(['wire', 'Drahtgitter']);
    if (c.part === 'can' && c.canTarget === 'shell') items.unshift(['sedit', 'Lage zeichnen']);
    const bw = 104, bh = 18, x = W - 8 - bw; let y = 4 + 104 + 8;
    const fg = cssVar('--txt', '#dde'), line = cssVar('--line', '#556');
    ctx.save(); ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 1;
    const box = (bx, w, txt, k, on) => {
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, y, w, bh, 4) : ctx.rect(bx, y, w, bh);
      ctx.fillStyle = on ? 'rgba(70,130,220,.85)' : 'rgba(60,70,90,.55)'; ctx.fill(); ctx.strokeStyle = on ? 'rgba(120,170,255,.9)' : line; ctx.stroke();
      ctx.fillStyle = fg; ctx.globalAlpha = on ? 1 : 0.8; ctx.fillText(txt, bx + w / 2, y + bh / 2 + 0.5); ctx.globalAlpha = 1;
      btns.push({ k, x: bx, y, w, h: bh });
    };
    for (const [k, t] of items) {
      box(x, bw, T(t), k, k === 'sedit' ? !!c.shell.edit : k === 'wire' ? !!c.wire : k === 'ps' ? !!c.ps : k === 'cut' ? !!c.cut.on : k === 'cut2d' ? c.cut.view === '2d' : k.slice(2) === c.side); y += bh + 4;
      if (k === 's:l') {   // Abstand der Formhälften: − / Wert (Klick = geschlossen <-> letzter Abstand) / +
        const g = +c.gap || 0, sw = 22;
        box(x, sw, '−', 'gap-'); box(x + sw + 2, bw - 2 * sw - 4, g ? T('Abstand') + ' ' + g + ' mm' : T('geschlossen'), 'gap0', !g); box(x + bw - sw, sw, '+', 'gap+'); y += bh + 4;
      }
    }
    ctx.restore();
  }
  function btnHit(x, y) { const b = btns.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h); return b ? b.k : null; }
  function btnClick(k) {
    const c = cfg(), g = +c.gap || 0;
    if (k === 'sedit') { c.shell.edit = !c.shell.edit; draw(); return; }
    if (k === 'wire') { c.wire = !c.wire; draw(); return; }
    if (k === 'ps') { c.ps = !c.ps; draw(); return; }
    if (k === 'cut' || k === 'cut2d') { if (k === 'cut') c.cut.on = !c.cut.on; else c.cut.view = c.cut.view === '2d' ? '3d' : '2d'; if (App.buildSidebar) App.buildSidebar(); draw(); return; }
    if (k.startsWith('s:')) c.side = k.slice(2);
    else if (k === 'gap0') { if (g) { c.gapLast = g; c.gap = 0; } else c.gap = +c.gapLast || 30; }
    else c.gap = clamp(g + (k === 'gap+' ? 5 : -5), 0, 500);
    if (App.buildSidebar) App.buildSidebar(); render();
  }
  // Trennfläche (Ebene Z der Rumpfmitte je Hälfte) als gelbes Rechteck über dem Bild
  function drawParting(items) {
    ctx.save(); ctx.strokeStyle = 'rgba(255,210,60,.95)'; ctx.fillStyle = 'rgba(255,210,60,.16)'; ctx.lineWidth = 1.3;
    for (const it of items) {
      if (!it.pp) continue;
      const P = it.pp.map(q => scr(q[0], q[1], q[2]));
      ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
  // Fädelstäbe: liegen im Inneren des Körpers -> als Linien über das 3D-Bild gelegt (durch den Körper sichtbar)
  const ROD_COL = 'rgba(255,150,40,.95)';
  function drawRods(rods) {
    ctx.save(); ctx.strokeStyle = ROD_COL; ctx.lineWidth = 1.4;
    for (const r of rods) {
      const A = r.A.map(q => scr(q[0], q[1], q[2])), B = r.B.map(q => scr(q[0], q[1], q[2])), n = A.length, st = Math.max(1, Math.round(n / 4));
      ctx.beginPath();
      for (const L of [A, B]) { L.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); }
      ctx.stroke();
      ctx.setLineDash([6, 4]); ctx.beginPath();
      for (let i = 0; i < n; i += st) { ctx.moveTo(A[i].x, A[i].y); ctx.lineTo(B[i].x, B[i].y); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
  }
  // ---- Schnittansicht: Ebene senkrecht zu X/Y/Z; 3D aufgeschnitten (Clip im Shader) oder 2D-Schnitt
  const AXI = { x: 0, y: 1, z: 2 }, cam2 = { zoom: 1, px: 0, py: 0 };
  const is2d = () => { const q = cfg().cut; return (!!q.on && q.view === '2d') || shellEditOn(); };
  function itemBounds() {
    if (!cache || !cache.items || !cache.items.length) return null;
    if (cache.bnd) return cache.bnd;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const it of cache.items) { const v = it.v; for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { if (v[i + k] < mn[k]) mn[k] = v[i + k]; if (v[i + k] > mx[k]) mx[k] = v[i + k]; } }
    return (cache.bnd = { mn, mx });
  }
  function cutSpec() {
    const q = cfg().cut, b = itemBounds(); if (!q.on || !b) return null;
    const k = AXI[q.axis] == null ? 0 : AXI[q.axis];
    if (q.pos == null || !isFinite(+q.pos)) q.pos = r1((b.mn[k] + b.mx[k]) / 2);
    return { k, pos: clamp(+q.pos, b.mn[k], b.mx[k]), rm: q.side === '-' ? -1 : 1, fill: !!q.fill, two: q.view === '2d' };
  }
  // Schnittstrecken eines Körpers mit der Ebene, in 2D (k = 0: Z/Y · 1: X/Z · 2: X/Y)
  function sectionSegs(it, k, pos) {
    const key = k + ':' + pos; if (it._sk === key) return it._ss;
    const v = it.v, segs = [], ua = k === 0 ? 2 : 0, ub = k === 1 ? 2 : 1;
    for (let i = 0; i < v.length; i += 9) {
      const d = [v[i + k] - pos, v[i + 3 + k] - pos, v[i + 6 + k] - pos], P = [];
      for (let e = 0; e < 3; e++) { const a = e, b = (e + 1) % 3; if ((d[a] < 0) !== (d[b] < 0)) { const t = d[a] / (d[a] - d[b]), ia = i + a * 3, ib = i + b * 3; P.push([v[ia + ua] + (v[ib + ua] - v[ia + ua]) * t, v[ia + ub] + (v[ib + ub] - v[ia + ub]) * t]); } }
      if (P.length === 2) segs.push(P);
    }
    it._sk = key; it._ss = segs; return segs;
  }
  function chainSegs(segs) {
    const key = p => Math.round(p[0] * 500) + ',' + Math.round(p[1] * 500), adj = new Map();
    segs.forEach((s, i) => { for (const e of [0, 1]) { const q = key(s[e]); let l = adj.get(q); if (!l) adj.set(q, (l = [])); l.push(i); } });
    const used = new Uint8Array(segs.length), loops = [];
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue; used[i] = 1;
      const L = [segs[i][0], segs[i][1]]; let cur = key(segs[i][1]);
      for (;;) { const j = (adj.get(cur) || []).find(q => !used[q]); if (j == null) break; used[j] = 1; const s = segs[j], nx = key(s[0]) === cur ? s[1] : s[0]; L.push(nx); cur = key(nx); }
      loops.push(L);
    }
    return loops;
  }
  function draw2dCut(items, cut) {
    if (glc) glc.style.display = 'none';
    const all = items.map(it => chainSegs(sectionSegs(it, cut.k, cut.pos)));
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const loops of all) for (const L of loops) for (const p of L) { if (p[0] < a0) a0 = p[0]; if (p[0] > a1) a1 = p[0]; if (p[1] < b0) b0 = p[1]; if (p[1] > b1) b1 = p[1]; }
    if (!isFinite(a0)) { ctx.fillStyle = cssVar('--muted', '#8aa'); ctx.font = '13px system-ui'; ctx.fillText(T('Die Schnittebene trifft die Form nicht.'), 20, H / 2); return ''; }
    // Maßstab und Bildmitte aus den Gesamtmaßen der Form (nicht aus dem einzelnen Schnitt): beim Durchfahren mit dem
    // Schieberegler bleibt der Maßstab gleich, der Querschnitt wird sichtbar größer und kleiner.
    const ua = cut.k === 0 ? 2 : 0, ub = cut.k === 1 ? 2 : 1, bd = itemBounds();
    const s = Math.max(1e-3, Math.min((W - 160) / Math.max(1, bd.mx[ua] - bd.mn[ua]), (H - 160) / Math.max(1, bd.mx[ub] - bd.mn[ub]))) * cam2.zoom, ca = (bd.mn[ua] + bd.mx[ua]) / 2, cb = (bd.mn[ub] + bd.mx[ub]) / 2;
    const X = a => W / 2 + cam2.px + (a - ca) * s, Y = b => H / 2 + cam2.py - (b - cb) * s;
    // Raster
    let st = 1; for (const q of [1, 2, 5, 10, 20, 50, 100, 200, 500]) { st = q; if (q * s >= 40) break; }
    ctx.strokeStyle = 'rgba(140,160,190,.14)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let g = Math.floor((ca - (W / 2 + cam2.px) / s) / st) * st; X(g) < W; g += st) { ctx.moveTo(X(g), 0); ctx.lineTo(X(g), H); }
    for (let g = Math.floor((cb - (H / 2 - cam2.py) / s) / st) * st; Y(g) > 0; g += st) { ctx.moveTo(0, Y(g)); ctx.lineTo(W, Y(g)); }
    ctx.stroke();
    const cols = colors().map(c => c.map(x => Math.round(x * 255)));
    for (const loops of all) {
      ctx.beginPath(); for (const L of loops) { L.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])))); }
      ctx.fillStyle = 'rgba(' + cols[1].join(',') + ',.55)'; ctx.fill('evenodd');
      ctx.strokeStyle = 'rgb(' + cols[0].join(',') + ')'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // Fädelstäbe hervorheben (Querschnitt bzw. Längsschnitt des Kanals)
    if (cache && cache.rods && cache.rods.length) {
      ctx.save(); ctx.strokeStyle = ROD_COL; ctx.lineWidth = 2; ctx.fillStyle = cssVar('--bg', '#0f1216');
      for (const r of cache.rods) {
        const n = r.A.length, k = cut.k, pts = [];
        for (let i = 0; i < n; i++) {   // Schnitt der Kanalwand (Vierecke A[i] A[j] B[j] B[i]) mit der Ebene
          const j = (i + 1) % n, Q = [r.A[i], r.A[j], r.B[j], r.B[i]];
          for (let e = 0; e < 4; e++) { const p = Q[e], q = Q[(e + 1) % 4], dp = p[k] - cut.pos, dq = q[k] - cut.pos; if ((dp < 0) !== (dq < 0)) { const t = dp / (dp - dq); pts.push([p[ua] + (q[ua] - p[ua]) * t, p[ub] + (q[ub] - p[ub]) * t]); } }
        }
        if (pts.length < 3) continue;
        let ma = 0, mb = 0; for (const q of pts) { ma += q[0]; mb += q[1]; } ma /= pts.length; mb /= pts.length;
        pts.sort((p, q) => Math.atan2(p[1] - mb, p[0] - ma) - Math.atan2(q[1] - mb, q[0] - ma));
        ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(X(q[0]), Y(q[1])) : ctx.moveTo(X(q[0]), Y(q[1])))); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
    // Maße des Schnitts
    const nm = cut.k === 0 ? ['Z', 'Y'] : cut.k === 1 ? ['X', 'Z'] : ['X', 'Y'];
    ctx.strokeStyle = ctx.fillStyle = cssVar('--muted', '#8aa'); ctx.font = '11px system-ui'; ctx.lineWidth = 1; ctx.textAlign = 'center';
    ctx.beginPath(); ctx.moveTo(X(a0), Y(b0) + 18); ctx.lineTo(X(a1), Y(b0) + 18); ctx.moveTo(X(a0), Y(b0) + 12); ctx.lineTo(X(a0), Y(b0) + 24); ctx.moveTo(X(a1), Y(b0) + 12); ctx.lineTo(X(a1), Y(b0) + 24);
    ctx.moveTo(X(a0) - 18, Y(b0)); ctx.lineTo(X(a0) - 18, Y(b1)); ctx.moveTo(X(a0) - 24, Y(b0)); ctx.lineTo(X(a0) - 12, Y(b0)); ctx.moveTo(X(a0) - 24, Y(b1)); ctx.lineTo(X(a0) - 12, Y(b1)); ctx.stroke();
    ctx.fillText(nm[0] + ' ' + (a1 - a0).toFixed(1) + ' mm', (X(a0) + X(a1)) / 2, Y(b0) + 34);
    ctx.save(); ctx.translate(X(a0) - 26, (Y(b0) + Y(b1)) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(nm[1] + ' ' + (b1 - b0).toFixed(1) + ' mm', 0, 0); ctx.restore(); ctx.textAlign = 'left';
    return T('Schnitt') + ' ' + 'XYZ'[cut.k] + ' = ' + cut.pos.toFixed(1) + ' mm · ' + (a1 - a0).toFixed(1) + ' × ' + (b1 - b0).toFixed(1) + ' mm · ' + T('Raster') + ' ' + st + ' mm';
  }
  // Bedienfeld Schnittansicht im Ansichtsfenster (links unten über der Knopfleiste) — wie im Formenbau
  function buildCutPanel() {
    const el = document.getElementById('rprofCutPanel'); if (!el) return;
    el.innerHTML = ''; const q = cfg().cut;
    if (!q.on) { el.style.display = 'none'; return; }
    el.style.display = '';
    { const bar = el.parentElement && el.parentElement.querySelector('.simbar'); el.style.bottom = ((bar ? bar.offsetHeight : 38) + 8) + 'px'; }
    if (!cache) build();
    const rb = () => { buildCutPanel(); draw(); };
    const row = () => { const d = document.createElement('div'); d.style.cssText = 'display:flex;align-items:center;gap:6px;margin:3px 0'; el.appendChild(d); return d; };
    const lab = (r, t, w) => { const l = document.createElement('span'); l.textContent = T(t); l.style.cssText = 'opacity:.7;flex:0 0 ' + (w || 52) + 'px'; r.appendChild(l); return l; };
    const sel = (r, opts, cur, fn) => { const e = document.createElement('select'); e.style.cssText = 'flex:1;min-width:0;font-size:11px;padding:2px 4px'; for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = T(t); if (v === cur) o.selected = true; e.appendChild(o); } e.onchange = () => fn(e.value); r.appendChild(e); return e; };
    const btn = (r, t, on, fn) => { const b = document.createElement('button'); b.textContent = T(t); b.className = on ? 'primary' : ''; b.style.cssText = 'flex:1;padding:2px 6px;font-size:11px'; b.onclick = fn; r.appendChild(b); return b; };
    let r = row(); const h = document.createElement('b'); h.textContent = T('Schnittansicht'); h.style.flex = '1'; r.appendChild(h);
    btn(r, 'Schnitt aus', false, () => { q.on = false; q.view = '3d'; rb(); }).style.flex = '0 0 auto';
    r = row(); lab(r, 'Ebene');
    sel(r, [['x', 'Rumpfachse X (Spantschnitt)'], ['y', 'Höhe Y'], ['z', 'Breite Z']], q.axis, v => { q.axis = v; q.pos = null; rb(); });
    const b = itemBounds(), k = AXI[q.axis] == null ? 0 : AXI[q.axis], lo = b ? Math.floor(b.mn[k]) : -500, hi = b ? Math.ceil(b.mx[k]) : 500;
    if (b && (q.pos == null || !isFinite(+q.pos))) q.pos = r1((b.mn[k] + b.mx[k]) / 2);
    r = row(); lab(r, 'Lage (mm)');
    const rg = document.createElement('input'); rg.type = 'range'; rg.min = lo; rg.max = hi; rg.step = 0.5; rg.value = +q.pos || 0; rg.dataset.rprofcut = '1'; rg.style.cssText = 'flex:1;min-width:0';
    const nm = document.createElement('input'); nm.type = 'number'; nm.step = 0.5; nm.value = r1(+q.pos || 0); nm.dataset.rprofcut = '1'; nm.style.cssText = 'width:64px;font-size:11px;padding:2px 4px';
    rg.oninput = () => { q.pos = +rg.value; syncCutInputs(); draw(); };
    nm.onchange = () => { q.pos = +nm.value || 0; syncCutInputs(); draw(); };
    rg.title = nm.title = lo + ' … ' + hi + ' mm · ' + T('←/→ verschieben die Ebene');
    r.appendChild(rg); r.appendChild(nm);
    r = row(); lab(r, '3D: entfernte Seite', 100);
    sel(r, [['+', 'größere Koordinate (+)'], ['-', 'kleinere Koordinate (−)']], q.side === '-' ? '-' : '+', v => { q.side = v; draw(); });
    const ck = document.createElement('label'); ck.className = 'ck'; ck.style.cssText = 'display:flex;align-items:center;gap:4px;white-space:nowrap';
    const ci = document.createElement('input'); ci.type = 'checkbox'; ci.checked = !!q.fill; ci.onchange = () => { q.fill = ci.checked; draw(); };
    ck.appendChild(ci); ck.appendChild(document.createTextNode(T('füllen'))); r.appendChild(ck);
    r = row();
    btn(r, '3D aufgeschnitten', q.view !== '2d', () => { q.view = '3d'; rb(); });
    btn(r, '2D-Schnitt', q.view === '2d', () => { q.view = '2d'; Object.assign(cam2, { zoom: 1, px: 0, py: 0 }); rb(); });
  }
  function syncCutInputs() {
    const v = +cfg().cut.pos || 0;
    document.querySelectorAll('[data-rprofcut]').forEach(el => { if (document.activeElement !== el) el.value = el.type === 'range' ? v : r1(v); });
  }
  function cutStep(dir) {
    const b = itemBounds(), q = cfg().cut; if (!b) return;
    const k = AXI[q.axis] == null ? 0 : AXI[q.axis], st = Math.max(0.5, Math.round((b.mx[k] - b.mn[k]) / 100 * 2) / 2);
    q.pos = clamp((+q.pos || 0) + dir * st, b.mn[k], b.mx[k]); syncCutInputs(); draw();
  }
  // Seitenansicht zum Zeichnen der Lage: Griffe A/B = Rand, F/R = Neigung der Deckel. Rechnet erst beim Loslassen neu.
  let shGrab = null, shMap = null;
  function shellEditOn() { const c = cfg(); return c.part === 'can' && c.canTarget === 'shell' && !!c.shell.edit && !!source(); }
  function shellHandles(q) {
    const F = shellFrame(q); if (!F) return null;
    const hgt = Math.max(60, F.L * 0.35), top = (P, deg) => { const t = deg * Math.PI / 180; return [P[0] + hgt * (F.n[0] * Math.cos(t) + F.d[0] * Math.sin(t)), P[1] + hgt * (F.n[1] * Math.cos(t) + F.d[1] * Math.sin(t))]; };
    const B = [q.x1, q.y1];
    return { F, hgt, A: F.A, B, TF: top(F.A, q.angF), TR: top(B, q.angR) };
  }
  function shellHit(mx, my) {
    const h = shMap && shellHandles(cfg().shell); if (!h) return null;
    for (const k of ['A', 'B', 'TF', 'TR']) { const p = shMap.to(h[k]); if (Math.hypot(p[0] - mx, p[1] - my) < 10) return k; }
    return null;
  }
  function shellDrag(k, mx, my) {
    const q = cfg().shell, P = shMap.from(mx, my);
    if (k === 'A') { q.x0 = r1(Math.min(P[0], q.x1 - 5)); q.y0 = r1(P[1]); }
    else if (k === 'B') { q.x1 = r1(Math.max(P[0], q.x0 + 5)); q.y1 = r1(P[1]); }
    else {
      const F = shellFrame(q), O = k === 'TF' ? F.A : [q.x1, q.y1], dx = P[0] - O[0], dy = P[1] - O[1];
      const a = clamp(Math.round(Math.atan2(dx * F.d[0] + dy * F.d[1], dx * F.n[0] + dy * F.n[1]) * 1800 / Math.PI) / 10, -60, 60);
      if (k === 'TF') q.angF = a; else q.angR = a;
    }
  }
  // Kantenlinien für die Seitenansicht: scharfe Kanten und Netzränder auf der Außenhaut (Haubenausschnitt, Teilfugen,
  // Tragflächen-/Leitwerksanschluss). Innenteile fallen über den Abstand zur Hülle weg. -> [x0, y0, x1, y1, …] (Seite z >= 0)
  let edgeMemo = null;
  function featureEdges(S) {
    const v = S.api.soup || (S.api.model.mesh && S.api.model.mesh.v); if (!v) return [];
    if (edgeMemo && edgeMemo.v === v) return edgeMemo.out;
    const E = new Map(), kp = i => Math.round(v[i] * 100) + '_' + Math.round(v[i + 1] * 100) + '_' + Math.round(v[i + 2] * 100);
    for (let i = 0; i < v.length; i += 9) {
      const ux = v[i + 3] - v[i], uy = v[i + 4] - v[i + 1], uz = v[i + 5] - v[i + 2], wx = v[i + 6] - v[i], wy = v[i + 7] - v[i + 1], wz = v[i + 8] - v[i + 2];
      const n = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx], l = Math.hypot(n[0], n[1], n[2]); if (!(l > 1e-9)) continue;
      n[0] /= l; n[1] /= l; n[2] /= l;
      const id = [i, i + 3, i + 6], ks = id.map(kp);
      for (let e = 0; e < 3; e++) {
        const a = ks[e], b = ks[(e + 1) % 3]; if (a === b) continue;
        const k = a < b ? a + '|' + b : b + '|' + a; let r = E.get(k);
        if (!r) E.set(k, r = { p: id[e], q: id[(e + 1) % 3], n: [], g: new Set() });
        r.n.push(n); if (S.api.soupG) r.g.add(S.api.soupG[i / 9]);
      }
    }
    const rings = new Map(), ring = x => { const k = Math.round(x); let R = rings.get(k); if (!R) rings.set(k, R = S.colAt(k)); return R; };
    const onHull = (x, y, z) => {
      const R = ring(x); let best = Infinity;
      for (let i = 0; i + 1 < R.length; i++) {
        const a = R[i], b = R[i + 1], dy = b[0] - a[0], dz = b[1] - a[1], L = dy * dy + dz * dz, t = L > 1e-12 ? clamp(((y - a[0]) * dy + (z - a[1]) * dz) / L, 0, 1) : 0, d = Math.hypot(y - a[0] - dy * t, z - a[1] - dz * t);
        if (d < best) best = d;
      }
      return best < 2;
    };
    const out = [], cs = Math.cos(25 * Math.PI / 180);
    for (const r of E.values()) {
      const sharp = r.n.length !== 2 || r.g.size > 1 || r.n[0][0] * r.n[1][0] + r.n[0][1] * r.n[1][1] + r.n[0][2] * r.n[1][2] < cs; if (!sharp) continue;
      const p = r.p, q = r.q; if (v[p + 2] < -0.01 || v[q + 2] < -0.01 || (v[p + 2] < 0.05 && v[q + 2] < 0.05)) continue;
      if (onHull(v[p], v[p + 1], v[p + 2]) && onHull(v[q], v[q + 1], v[q + 2])) out.push(v[p], v[p + 1], v[q], v[q + 1]);
    }
    edgeMemo = { v, out };
    return out;
  }
  function drawShellEdit() {
    const S = source(), c = cfg(), q = shellDefaults(S, c), z = cam2.zoom || 1, s = Math.min(W * 0.9 / (S.x1 - S.x0), H * 0.8 / (S.yMax - S.yMin)) * z;
    const xc = (S.x0 + S.x1) / 2, yc = (S.yMin + S.yMax) / 2;
    shMap = { to: p => [W / 2 + cam2.px + (p[0] - xc) * s, H / 2 + cam2.py - (p[1] - yc) * s], from: (x, y) => [(x - W / 2 - cam2.px) / s + xc, (H / 2 + cam2.py - y) / s + yc] };
    const line = (L, col, lw, dash) => { ctx.beginPath(); L.forEach((p, i) => { const r = shMap.to(p); if (i) ctx.lineTo(r[0], r[1]); else ctx.moveTo(r[0], r[1]); }); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); };
    line(S.G[0].map(p => [p[0], p[1]]), cssVar('--txt', '#dde'), 1.5); line(S.G[S.K - 1].map(p => [p[0], p[1]]), cssVar('--txt', '#dde'), 1.5);
    if (q.lines !== false) {
      const seg = featureEdges(S); ctx.beginPath();
      for (let i = 0; i < seg.length; i += 4) { const a = shMap.to([seg[i], seg[i + 1]]), b = shMap.to([seg[i + 2], seg[i + 3]]); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      ctx.strokeStyle = '#8fa3b8'; ctx.lineWidth = 1; ctx.stroke();
      if (S.api.formers) { try { for (const f of S.api.formers()) { const R = S.colAt(f.x); line([[f.x, R[0][0]], [f.x, R[R.length - 1][0]]], '#8fa3b8', 0.6, [2, 4]); } } catch (e) {} }
    }
    const kh = S.api.canopy;
    if (kh && kh.spans) { const L = []; for (const x of S.XS) if (x > kh.x0 && x < kh.x1) { const sp = kh.spans(x); if (sp.length) L.push([x, sp[sp.length - 1][0]]); } if (L.length > 1) line(L, '#6cf', 1); }
    const h = shellHandles(q); if (!h) return;
    line([h.TF, h.A, h.B, h.TR], '#fb4', 2);
    for (const s of cutList(c, 0, h.F.L)) { const P = h.F.at(s); line([P.O, [P.O[0] + P.e[0] * h.hgt, P.O[1] + P.e[1] * h.hgt]], '#fb4', 1, [2, 3]); }
    const hF = q.lidT * Math.cos(q.angF * Math.PI / 180) > 0 ? h.F.plane(0, q.angF) : null, hR = h.F.plane(h.F.L, q.angR), t = Math.max(1, +q.lidT || 1);
    if (q.lidF && hF) line([h.A, h.TF].map(p => [p[0] - hF.m[0] * t, p[1] - hF.m[1] * t]), '#fb4', 1, [5, 4]);
    if (q.lidR) line([[q.x1, q.y1], h.TR].map(p => [p[0] + hR.m[0] * t, p[1] + hR.m[1] * t]), '#fb4', 1, [5, 4]);
    ctx.font = '11px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    for (const [k, lb] of [['A', 'Rand vorne'], ['B', 'Rand hinten'], ['TF', 'Deckel vorne'], ['TR', 'Deckel hinten']]) {
      const p = shMap.to(h[k]); ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, 7); ctx.fillStyle = '#fb4'; ctx.fill(); ctx.fillStyle = cssVar('--txt', '#dde'); ctx.fillText(T(lb), p[0] + 8, p[1] - 4);
    }
  }
  function setInfo(html, bad) { const el = document.getElementById('rprofInfo'); if (el) { el.innerHTML = html; el.style.color = bad ? '#f88' : ''; } }
  function draw() {
    if (!ctx) return;
    const r = cache;
    ctx.fillStyle = cssVar('--bg', '#0f1216'); ctx.fillRect(0, 0, W, H);
    if (shellEditOn()) {
      if (glc) glc.style.display = 'none';
      drawShellEdit(); drawBtns();
      setInfo(T('Griffe ziehen: Rand der Form und Neigung der Deckel. Ziehen daneben = schieben · Rad = Zoom · Doppelklick = zurück') + (r && r.err ? '<br><span style="color:#f88">' + r.err + '</span>' : ''));
      return;
    }
    if (!r || !r.items || !r.items.length) {
      if (glc) glc.style.display = 'none'; btns = [];
      setInfo(!r || r.none ? (cfg().from === 'mesh' ? T('Kein Körper gewählt — Körper im Reiter „3D-Bearbeitung“ laden und hier ankreuzen.') : cfg().from === 'stl' ? T('Kein STL-Modell geladen.') : T('Kein Rumpf — erst im Reiter „Rumpf" einen Rumpf anlegen.')) : (r.err || T('Keine Form.')), true); return;
    }
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; let ntri = 0, vol = 0;
    for (const it of r.items) { const v = it.v; ntri += v.length / 9; vol += it.vol; for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { if (v[i + k] < mn[k]) mn[k] = v[i + k]; if (v[i + k] > mx[k]) mx[k] = v[i + k]; } }
    { const c = cfg(), key = c.from + '|' + c.part + '|' + c.target; if (key !== pivotKey) { pivotKey = key; pivot = null; } }   // anderes Bauteil: Drehpunkt verwerfen
    center = pivot || [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    radius = Math.max(1, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2);
    if (!glTried) glInit();
    const cut = cutSpec(); let cutTxt = '';
    if (cut && cut.two) cutTxt = draw2dCut(r.items, cut);
    else {
      if (gl) { glc.style.display = ''; glDraw(r.items, cut, { mn, mx }); ctx.clearRect(0, 0, W, H); } else drawShaded(r.items, cut);
      if (cfg().ps) drawParting(r.items);
      if (r.rods && r.rods.length) drawRods(r.rods);
      if (pivot && window.ViewCube && ViewCube.drawPivot) { const q = scr(pivot[0], pivot[1], pivot[2]); ViewCube.drawPivot(ctx, q.x, q.y); }
    }
    drawBtns();
    let big = [0, 0, 0]; for (const it of r.items) big = big.map((b, k) => Math.max(b, it.dim[k]));
    setInfo(r.items.length + ' ' + (r.items.length === 1 ? T('STL-Körper') : T('STL-Körper (je eine Datei)')) + ' · ' + Math.round(ntri) + ' ' + T('Dreiecke') + ' · ' + T('Volumen') + ' ' + (vol / 1000).toFixed(1) + ' cm³'
      + '<br>' + T(cfg().part === 'boom' ? 'größtes Stück (stehend, dickes Ende unten):' : 'größtes Stück (liegend, Z hoch):') + ' ' + big.map(x => x.toFixed(1)).join(' × ') + ' mm'
      + (cutTxt ? '<br>' + cutTxt : '')
      + (r.warn && r.warn.length ? '<br><span style="color:#fb8">' + r.warn.join('<br>') + '</span>' : '')
      + '<br><span style="opacity:.7">' + T(cut && cut.two ? 'Ziehen = schieben · Rad = Zoom · Doppelklick = zurück' : 'Ziehen = drehen · Shift+Ziehen = schieben · Rad = Zoom · Mausrad-Doppelklick = Drehpunkt · Doppelklick = zurück') + '</span>');
  }
  function render() { build(); if (fit()) draw(); }
  function show() { render(); }
  function resize() { if (fit()) draw(); }

  // ---------- Seitenleiste ---------------------------------------------------------------------------
  function rprofSidebar(side) {
    const { grp, hint, boolRow, selectRow, mkMini, subhead, buildSidebar } = App, numRow = App.numRowEnter || App.numRow;   // Zahlen erst bei Enter/Verlassen/Pfeil (Setter bauen die Leiste neu)
    const c = cfg(), RD = () => render(), RB = () => { buildSidebar(); render(); };
    const num = (body, label, get, set, step, h) => numRow(body, label, get, v => { set(v); RD(); }, { step: step || 1, min: 0, norender: true, hint: h });
    const g0 = grp('Rumpf Formenbau', true, 'rprof', { key: 'rprofMain' });
    hint(g0.body, 'Formen als STL aus dem Rumpf (wie der Reiter „Formenbau" für Tragflächen). Rumpf und Kabinenhaube werden hier gemeinsam abgeleitet; Form, Anbauten und Haubenlinie werden im Reiter „Rumpf" festgelegt.');
    if (window.StlBody) {
      selectRow(g0.body, 'Rumpf aus', [['rpro', 'Reiter „Rumpf"'], ['stl', 'eigenes STL-Modell']].concat(window.MeshEdit ? [['mesh', 'Körper aus 3D-Bearbeitung (1:1)']] : []), () => c.from || 'rpro', v => { c.from = v; RB(); });
      if (c.from === 'stl') StlBody.rows(g0.body, RD);
      if (c.from === 'mesh') {
        const q = meshOpt(), L = meshBodies(), ch = meshChosen();
        hint(g0.body, 'Die Form entsteht aus den gewählten Körpern, ohne Umweg über Spanten und Splines: Abgegriffen wird die äußere Hülle in 401 Querschnitten, Maße bleiben gleich, die Nase liegt bei X = 0. Innere Hohlräume und Einbauten zählen nicht.');
        for (const b of L) boolRow(g0.body, b.name, () => ch.includes(b), v => { const s = new Set(ch.map(x => x.name)); if (v) s.add(b.name); else s.delete(b.name); q.sel = [...s]; RB(); });
        selectRow(g0.body, 'Längsachse', [['auto', 'automatisch (größte Ausdehnung)'], ['x', 'X'], ['y', 'Y'], ['z', 'Z']], () => q.len, v => { q.len = v; RB(); });
        selectRow(g0.body, 'Hochachse', [['auto', 'automatisch'], ['x', 'X'], ['y', 'Y'], ['z', 'Z']], () => q.up, v => { q.up = v; RB(); });
        boolRow(g0.body, 'Nase und Heck tauschen', () => !!q.flipX, v => { q.flipX = v; RB(); });
        boolRow(g0.body, 'oben und unten tauschen', () => !!q.flipUp, v => { q.flipUp = v; RB(); });
      }
    }
    if (!source()) { hint(g0.body, c.from === 'stl' ? 'Kein STL-Modell geladen.' : c.from === 'mesh' ? 'Kein Körper gewählt — Körper im Reiter „3D-Bearbeitung“ laden und hier ankreuzen.' : 'Kein Rumpf vorhanden.'); side.appendChild(g0.g); buildCutPanel(); return; }
    const canReal = hasCanopy(), can = canReal || c.from === 'stl' || c.from === 'mesh', boom = c.from === 'rpro' || !c.from ? hasBoom() : false;   // ohne Haubenlinie gibt es nur die Schalenform
    if (!canReal && can) c.canTarget = 'shell';
    if (!can && c.part === 'can') c.part = 'fus';
    if (!boom && c.part === 'boom') c.part = 'fus';
    const parts = [['fus', 'Rumpf']]; if (can) parts.push(['can', 'Kabinenhaube']); if (boom) parts.push(['boom', 'Leitwerksrohr (Wickeldorn)']);
    selectRow(g0.body, 'Bauteil', parts, () => c.part, v => { c.part = v; RB(); });
    if (!can && c.from !== 'stl') hint(g0.body, 'Kabinenhaube: im Reiter „Rumpf" die Gruppe „Kabinenhaube" einschalten, dann lässt sich hier die Haubenform ableiten.');
    if (c.part === 'boom') {
      const bo = c.boom, api = srcApi(), bm = api && api.boom;
      hint(g0.body, 'Wickeldorn für das konische Leitwerksrohr: Rohr außen minus Wandstärke/Abzug (Gruppe „Rumpfboot + Leitwerksrohr" im Reiter „Rumpf"), vorne und hinten um die Zugabe verlängert. Er wird in Druckstücke geteilt, die mittig gebohrt auf ein durchgehendes Rohr (Seele) aufgefädelt werden. Das Rohr wird darauf gewickelt; nach dem Aushärten zuerst das Seelenrohr ziehen, dann die Stücke zum dicken Ende hin aus dem Rohr schieben (Trennmittel / Folie!).');
      if (bm) hint(g0.body, T('Rohr außen') + ' Ø ' + r1(2 * bm.r0) + ' → ' + r1(2 * bm.r1) + ' mm · ' + T('Länge') + ' ' + r1(bm.len) + ' mm · ' + T('Abzug') + ' ' + bm.t + ' mm');
      num(g0.body, 'Zugabe vorne (mm)', () => bo.addF, v => { bo.addF = Math.max(0, v); }, 5, 'Verlängert den Dorn vor dem Rohranfang (Kegel läuft weiter) — Rand zum Ablängen.');
      num(g0.body, 'Zugabe hinten (mm)', () => bo.addR, v => { bo.addR = Math.max(0, v); }, 5);
      num(g0.body, 'Seelenrohr Ø (mm, 0 = ohne Bohrung)', () => bo.core, v => { bo.core = Math.max(0, v); }, 0.5, 'Durchgehendes gerades Rohr (z. B. Alu oder CFK), auf das die Druckstücke aufgefädelt werden; es hält sie fluchtend und dient beim Wickeln als Welle.');
      num(g0.body, 'Spiel der Bohrung (mm)', () => bo.corePlay, v => { bo.corePlay = Math.max(0, v); }, 0.05);
      num(g0.body, 'Druckstück höchstens (mm)', () => bo.segLen, v => { bo.segLen = Math.max(10, v); }, 10, 'Der Dorn wird in gleich lange Stücke geteilt, keines länger als dieser Wert (Bauhöhe des Druckers — die Stücke werden stehend gedruckt, dickes Ende unten).');
      num(g0.body, 'Mindestwand um die Bohrung (mm)', () => bo.minWall, v => { bo.minWall = Math.max(0, v); }, 0.5);
      num(g0.body, 'Vorschau: Abstand der Stücke (mm)', () => c.segGap, v => { c.segGap = Math.max(0, v); }, 5);
      build(); if (boomInfo && cache && cache.items && cache.items.length) hint(g0.body, boomInfo.nP + ' ' + T('Stücke à') + ' ' + r1(boomInfo.pl) + ' mm · ' + T('Dorn') + ' Ø ' + r1(2 * boomInfo.Rf) + ' → ' + r1(2 * boomInfo.Rr) + ' mm' + (boomInfo.rb > 0 ? ' · ' + T('Bohrung') + ' Ø ' + r1(2 * boomInfo.rb) + ' mm' : ''));
      side.appendChild(g0.g); buildCutPanel(); outGroup(); return;
    }
    if (c.part === 'fus') {
      selectRow(g0.body, 'Ziel', [['neg', 'Negativform (Halbschalen-Formen)'], ['pos', 'geteiltes Urmodell (Halbschale auf Trennplatte)'], ['ur', 'Urmodell (ganzer Rumpf)']], () => c.target, v => { c.target = v; RB(); });
      if (c.target !== 'ur') {
        if (c.margin > 0) selectRow(g0.body, 'Form des Formenrands', [['box', 'Kasten (rechteckig)'], ['offset', 'folgt der Rumpfkontur (Versatz)']], () => (c.edge === 'offset' ? 'offset' : 'box'), v => { c.edge = v; RD(); },
          'Versatz: der Rand läuft im Abstand „Formenrand" um den Rumpfumriss, auch um Nase und Heck — spart Material und Druckzeit. Die Passlöcher sitzen im Streifen zwischen Kontur (bzw. Blutrinne) und Außenkante.');
        numRow(g0.body, 'Trennebene: Drehung um die Längsachse (°)', () => +c.rot || 0, v => { c.rot = clamp(v, -180, 180); RB(); }, { step: 5, min: -180, max: 180, norender: true,
          hint: '0° = senkrechte Trennebene (rechte / linke Hälfte), 90° = waagrechte Trennebene (obere / untere Hälfte), dazwischen schräg. Bei gedrehter Ebene sind die Hälften nicht mehr spiegelgleich und werden einzeln aufgebaut.' });
        if (Math.abs(+c.rot || 0) > 1e-6) { const S0 = source(), mid = S0 ? r1((S0.yMin + S0.yMax) / 2) : 0;
          numRow(g0.body, 'Trennebene: Höhe der Drehachse Y (mm)', () => (c.rotY == null ? mid : +c.rotY), v => { c.rotY = v; RD(); }, { step: 1, norender: true, hint: 'Die Trennebene geht durch die Längsachse in dieser Höhe (Rumpfmitte Z = 0). Bei 90° ist das die Höhe der Trennebene — am besten an der breitesten Stelle des Rumpfs.' }); }
        if (c.target === 'neg' && can && !(Math.abs(+c.rot || 0) > 1e-6)) boolRow(g0.body, 'ohne Kabinenhaube (Form dort offen)', () => !!c.noCan, v => { c.noCan = v; RB(); },
          'Lässt die Formfläche im Bereich der Kabinenhaube weg: zwischen Rumpfoberkante und Haubenlinie ist die Form nach hinten durchgebrochen (offen). Formenrand, Huckel und Blutrinne laufen an der Oberkante unverändert durch.');
        selectRow(g0.body, 'Hälfte', [['both', 'beide (zwei Dateien)'], ['r', 'rechts'], ['l', 'links']], () => c.side, v => { c.side = v; RB(); });
        num(g0.body, 'Formenrand um den Rumpf (mm)', () => c.margin, v => { c.margin = Math.max(0, v); }, 5);
        if (c.target === 'neg') num(g0.body, 'Wandstärke hinter dem tiefsten Punkt (mm)', () => c.wall, v => { c.wall = Math.max(1, v); });
        else num(g0.body, 'Dicke der Trennplatte (mm)', () => c.plate, v => { c.plate = Math.max(0, v); }, 1, 'Rand 0 und Dicke 0 ergeben die reine, geschlossene Halbschale.');
        num(g0.body, 'Aufsockelung an der Trennebene (mm)', () => c.ext, v => { c.ext = Math.max(0, v); }, 1, 'Setzt die Halbschale um diesen Betrag senkrecht auf (Zugabe zum Besäumen bzw. tiefere Form).');
      }
    } else {
      selectRow(g0.body, 'Ziel', canReal ? [['pos', 'Tiefziehklotz (Positiv)'], ['neg', 'Negativform (zum Laminieren)'], ['shell', 'Schalenform mit Deckeln (wie Libelle)'], ['ur', 'Urmodell (Haube mit Sicken-Gegenstück)']] : [['shell', 'Schalenform mit Deckeln (wie Libelle)']], () => c.canTarget, v => { c.canTarget = v; RB(); });
      if (c.canTarget === 'ur') {
        hint(g0.body, 'Voller Körper der Kabinenhaube: außen die Rumpfhaut, innen das Gegenstück zur Sicke des Rumpfs (Stufen, Vertiefung und Schräge aus dem Reiter „Rumpf", Gruppe „Kabinenhaube"). Passt in den Ausschnitt von „Rumpf ohne Kabinenhaube" mit Sicke.');
        num(g0.body, 'Spiel zum Rumpf (mm)', () => c.can.play, v => { c.can.play = Math.max(0, v); }, 0.05, 'Luft zwischen Haube und Rumpf: Haubenkante und alle Stufen rücken um diesen Betrag vom Rumpf weg, die Auflageflächen liegen um diesen Betrag höher — damit die Teile nach dem Druck auch wirklich ineinander passen.');
        side.appendChild(g0.g); buildCutPanel(); outGroup(); return;
      }
      if (c.canTarget === 'shell') {
        const q = shellDefaults(source(), c), sn = (l, k, st, h) => numRow(g0.body, l, () => q[k], v => { q[k] = v; RD(); }, { step: st, norender: true, hint: h });
        hint(g0.body, 'Negativform als Schale: Der Hohlraum ist die Rumpffläche über einer ebenen Randfläche, außen gleichmäßige Wandstärke. Die Lage zeichnest du mit dem Knopf „Lage zeichnen“ unter dem Ansichtswürfel in der Seitenansicht. Teilen lässt sie sich unter „Druckstücke“.');
        boolRow(g0.body, 'Lage in der Seitenansicht zeichnen', () => !!q.edit, v => { q.edit = v; RB(); });
        boolRow(g0.body, 'Kantenlinien des Rumpfs anzeigen', () => q.lines !== false, v => { q.lines = v; RB(); }, 'Haubenausschnitt, Teilfugen und Anschlüsse von Tragfläche und Leitwerk als Orientierung in der Seitenansicht: alle scharfen Kanten auf der Außenhaut, bei Rumpf zusätzlich die Spanten.');
        sn('Rand vorne X (mm)', 'x0', 1); sn('Rand vorne Y (mm)', 'y0', 1); sn('Rand hinten X (mm)', 'x1', 1); sn('Rand hinten Y (mm)', 'y1', 1);
        sn('Neigung vorne (°)', 'angF', 1, '0 = rechtwinklig zum Rand, + = oben nach hinten geneigt.'); sn('Neigung hinten (°)', 'angR', 1, '0 = rechtwinklig zum Rand, − = oben nach vorne geneigt.');
        num(g0.body, 'Wandstärke (mm)', () => q.wall, v => { q.wall = Math.max(1, v); }, 0.5);
        num(g0.body, 'Hohlraum nach innen versetzen (mm)', () => q.inset, v => { q.inset = Math.max(0, v); }, 0.1, '0 = Hohlraum ist die Rumpffläche. Größer 0 = um diesen Betrag kleiner, z. B. die Haubenstärke für einen Tiefziehklotz, der in der Form abgeformt wird.');
        boolRow(g0.body, 'Deckel vorne (eigenes Teil)', () => !!q.lidF, v => { q.lidF = v; RB(); });
        boolRow(g0.body, 'Deckel hinten (eigenes Teil)', () => !!q.lidR, v => { q.lidR = v; RB(); });
        if (q.lidF || q.lidR) {
          num(g0.body, 'Deckelstärke (mm)', () => q.lidT, v => { q.lidT = Math.max(1, v); }, 0.5);
          num(g0.body, 'Vorschau: Abstand der Deckel (mm)', () => q.gap, v => { q.gap = Math.max(0, v); }, 5);
        }
      } else {
      if (c.canTarget === 'pos') { const ca = srcApi() && srcApi().canopy, gl = ca && ca.glass > 0 ? ca.glass : 0; boolRow(g0.body, 'Haubenstärke abziehen (Klotz = Innenseite der Haube)' + (gl ? ' — ' + gl + ' mm' : ''), () => c.can.inner !== false, v => { c.can.inner = v; RB(); }, 'Die Haube wird über den Klotz gezogen, ihre Innenseite liegt also am Klotz. Damit sie außen bündig mit dem Rumpf sitzt, ist der Klotz um die Stärke der Kabinenhaube kleiner (Einstellung im Reiter „Rumpf", Gruppe „Kabinenhaube").'); }
      num(g0.body, 'Zugabe um die Haubenlinie (mm)', () => c.can.add, v => { c.can.add = Math.max(0, v); }, 1, 'Die Form folgt der Rumpffläche um diesen Betrag über die Haubenlinie hinaus (nach unten und in der Länge) — Rand zum Besäumen der Haube.');
      num(g0.body, 'Zugabe vorne und hinten (mm)', () => (c.can.addX == null ? c.can.add : c.can.addX), v => { c.can.addX = Math.max(0, v); }, 1, 'Verlängert die Form vor und hinter der Haube um diesen Betrag: Sie folgt dort weiter der Rumpffläche, unten begrenzt auf der Höhe des Haubenendes (abzüglich der Zugabe um die Haubenlinie), darunter der Sockel.');
      num(g0.body, 'Sockel unter der Haube (mm)', () => c.can.base, v => { c.can.base = Math.max(0, v); }, 1, 'Senkrechte Verlängerung unter dem tiefsten Punkt der Haubenkante.');
      num(g0.body, c.canTarget === 'neg' ? 'Formenrand (mm)' : 'Grundplatte: Rand (mm, 0 = ohne)', () => c.can.margin, v => { c.can.margin = Math.max(0, v); }, 5);
      if (c.canTarget === 'neg') num(g0.body, 'Wandstärke über dem höchsten Punkt (mm)', () => c.can.wall, v => { c.can.wall = Math.max(1, v); });
      else if (c.can.margin > 0) num(g0.body, 'Grundplatte: Dicke (mm)', () => c.can.plate, v => { c.can.plate = Math.max(1, v); });
      }
    }
    side.appendChild(g0.g);

    if (c.part === 'fus' && c.target !== 'ur') {
      const g1 = grp('Passlöcher', false, 'rprof', { key: 'rprofHoles' });
      hint(g1.body, 'Durchgehende Löcher im Formenrand oben und unten, in beiden Hälften an derselben Stelle (Passstifte bzw. Schrauben zum Zusammenführen der Formhälften).');
      boolRow(g1.body, 'Passlöcher setzen', () => !!c.holes.on, v => { c.holes.on = v; RB(); });
      if (c.holes.on) {
        num(g1.body, 'Durchmesser (mm)', () => c.holes.d, v => { c.holes.d = Math.max(1, v); }, 0.5);
        num(g1.body, 'Anzahl je Längsseite (und Druckstück)', () => c.holes.n, v => { c.holes.n = clamp(Math.round(v), 1, 20); });
      }
      side.appendChild(g1.g);
    }

    if (c.part === 'fus' && c.target !== 'ur') {
      const neg = c.target === 'neg', gf = grp('Huckel & Blutrinne', false, 'rprof', { key: 'rprofFeat' });
      hint(gf.body, 'Beide laufen im Formenrand um den ganzen Rumpf herum (auch um Nase und Heck), in beiden Hälften gleich. Sie brauchen einen Formenrand, der breiter ist als ihr äußerer Abstand zur Formkante + 3 mm.');
      subhead(gf.body, 'Blutrinne');
      boolRow(gf.body, 'Blutrinne', () => !!c.blut.on, v => { c.blut.on = v; RB(); }, 'Rinne im Formenrand, die beim Schließen der Form das austretende Harz aufnimmt. In der Negativform eine Nut in der Trennfläche; am geteilten Urmodell eine Wulst auf der Trennplatte, die sich beim Abformen als Nut abbildet.');
      if (c.blut.on) {
        selectRow(gf.body, 'Querschnitt', [['round', 'Halbkreis'], ['u', 'U (flacher Grund, verrundete Flanken)']], () => (c.blut.shape === 'u' ? 'u' : 'round'), v => { c.blut.shape = v; RD(); });
        num(gf.body, 'Abstand zur Formkante (mm)', () => c.blut.dist, v => { c.blut.dist = Math.max(0.2, v); }, 0.5, 'Senkrecht zum Rumpfumriss gemessen. Mit Huckel beginnt die Rinne frühestens 0,5 mm hinter dem Huckel.');
        num(gf.body, 'Breite (mm)', () => c.blut.w, v => { c.blut.w = Math.max(0.5, v); }, 0.5);
        num(gf.body, 'Tiefe / Höhe (mm)', () => c.blut.d, v => { c.blut.d = Math.max(0.2, v); }, 0.5);
      }
      if (neg) {
        subhead(gf.body, 'Huckel (Formkante)');
        boolRow(gf.body, 'Huckel an der Formkante', () => !!c.hk.on, v => { c.hk.on = v; RB(); }, 'U-förmige Erhebung auf dem Formenrand, die direkt an der Formkante ansetzt und um den ganzen Rumpf läuft. Nach dem Füllern und Polieren wird sie plan weggeschliffen; dabei entsteht eine scharfe Formkante, die Halbschalen passen genau aufeinander.');
        if (c.hk.on) {
          num(gf.body, 'Huckel: Breite (mm)', () => c.hk.w, v => { c.hk.w = Math.max(0.5, v); }, 0.5);
          num(gf.body, 'Huckel: Höhe (mm)', () => c.hk.h, v => { c.hk.h = Math.max(0.2, v); }, 0.5);
        }
      }
      side.appendChild(gf.g);
    }

    if ((c.part === 'fus' && c.target === 'ur') || (c.part === 'can' && c.canTarget !== 'shell')) {
      const isCan = c.part === 'can', rc = isCan ? c.rodsCan : c.rods, S0 = source(), L = S0.x1 - S0.x0;
      if (isCan && (rc.on || !canInfo)) build();
      const lo = isCan && canInfo ? canInfo.xa : 0, hi = isCan && canInfo ? canInfo.xb : L;
      const mid = isCan ? x => (canInfo ? canInfo.mid(x) : 0) : x => { const R = ringAt(S0, S0.x0 + x); let a = Infinity, b = -Infinity; for (const p of R) { if (p[0] < a) a = p[0]; if (p[0] > b) b = p[0]; } return r1((a + b) / 2); };
      const gr = grp('Fädelstäbe (Kanäle längs)', false, 'rprof', { key: isCan ? 'rprofRodsCan' : 'rprofRods' });
      hint(gr.body, isCan ? 'Kanäle für Rund- oder Vierkantstäbe längs durch die Haubenform (Tiefziehklotz bzw. Negativform): die gedruckten Stücke werden auf die Stäbe aufgefädelt und fluchtend verklebt. Jeder Stab hat Anfang und Ende (ab Rumpfnase gemessen, wie im Rumpf) und eine eigene Höhe an beiden Enden. Die Kanäle sind an den Trennflächen der Druckstücke offen.'
        : 'Kanäle für Rund- oder Vierkantstäbe längs durch das Urmodell: die gedruckten Rumpfstücke werden auf die Stäbe aufgefädelt und fluchtend verklebt. Da die Rumpfachse selten eine Gerade von der Spitze bis zum Ende ist, lassen sich mehrere Stäbe anlegen — jeder mit Anfang und Ende (ab Nasenspitze gemessen) und eigener Höhe an beiden Enden. Die Kanäle sind an den Trennflächen der Druckstücke offen.');
      boolRow(gr.body, 'Kanäle für Fädelstäbe einbauen', () => !!rc.on, v => { rc.on = v; RB(); });
      if (rc.on) {
        if (isCan) hint(gr.body, T('Die Haubenform reicht von') + ' ' + r1(lo) + ' ' + T('bis') + ' ' + r1(hi) + ' mm ' + T('ab Rumpfnase.'));
        num(gr.body, 'Spiel (Zugabe auf das Stabmaß, mm)', () => rc.play, v => { rc.play = Math.max(0, v); }, 0.05);
        num(gr.body, isCan ? 'Mindestwand zur Außenfläche (mm)' : 'Mindestwand zur Rumpfhaut (mm)', () => rc.wall, v => { rc.wall = Math.max(0, v); }, 0.2, 'Wo der Kanal näher an die Außenhaut käme, wird er gekürzt.');
        rc.list.forEach((r, n) => {
          const hd = document.createElement('div'); hd.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:6px';
          const b = document.createElement('b'); b.textContent = T('Stab') + ' ' + (n + 1); b.style.fontSize = '13px'; hd.appendChild(b);
          const bx = document.createElement('span');
          bx.appendChild(mkMini(T('Höhe mittig'), () => { r.y0 = mid(clamp(+r.x0 || 0, lo, hi)); r.y1 = mid(clamp(+r.x1 || 0, lo, hi)); RB(); }));
          bx.appendChild(mkMini('✕', () => { rc.list.splice(n, 1); RB(); }));
          hd.appendChild(bx); gr.body.appendChild(hd);
          selectRow(gr.body, 'Querschnitt', [['round', 'Rundstab'], ['rect', 'Vierkantstab']], () => (r.shape === 'rect' ? 'rect' : 'round'), v => { r.shape = v; RB(); });
          if (r.shape === 'rect') { num(gr.body, 'Breite (mm)', () => r.w, v => { r.w = Math.max(0.5, v); }, 0.5); num(gr.body, 'Höhe (mm)', () => r.h, v => { r.h = Math.max(0.5, v); }, 0.5); }
          else num(gr.body, 'Durchmesser (mm)', () => r.d, v => { r.d = Math.max(0.5, v); }, 0.5);
          num(gr.body, 'Anfang ab Nase (mm)', () => r.x0, v => { r.x0 = clamp(v, 0, L); }, 5);
          num(gr.body, 'Ende ab Nase (mm)', () => r.x1, v => { r.x1 = clamp(v, 0, L); }, 5);
          numRow(gr.body, 'Höhe Y am Anfang (mm)', () => r.y0, v => { r.y0 = v; RD(); }, { step: 0.5, norender: true });
          numRow(gr.body, 'Höhe Y am Ende (mm)', () => r.y1, v => { r.y1 = v; RD(); }, { step: 0.5, norender: true });
          num(gr.body, 'seitlicher Versatz Z (mm)', () => r.z, v => { r.z = Math.max(0, v); }, 0.5, n ? '' : '0 = in der Rumpfmitte. Größer 0 = ein Stabpaar links und rechts im gleichen Abstand (verhindert zusätzlich das Verdrehen der Stücke).');
        });
        const ba = document.createElement('div'); ba.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:6px';
        ba.appendChild(mkMini(T('+ Stab hinzufügen'), () => {
          const last = rc.list[rc.list.length - 1], W2 = hi - lo;
          const x0 = isCan ? r1(lo) : last ? clamp(+last.x1 || 0, 0, L * 0.9) : r1(L * 0.1), x1 = isCan ? r1(hi) : last ? r1(Math.min(L * 0.95, x0 + L * 0.4)) : r1(L * 0.9);
          rc.list.push({ shape: last ? last.shape : 'round', d: last ? last.d : 6, w: last ? last.w : 6, h: last ? last.h : 6, x0, x1, y0: mid(x0 + (isCan ? W2 * 0.02 : 0)), y1: mid(x1 - (isCan ? W2 * 0.02 : 0)), z: isCan && last ? r1((+last.z || 0) + 15) : 0 }); RB();
        }));
        gr.body.appendChild(ba);
        if (!c.seg.on) hint(gr.body, 'Hinweis: erst mit „in Stücke teilen" (Gruppe Druckstücke) entstehen Trennflächen, an denen die Kanäle offen sind.');
      }
      side.appendChild(gr.g);
    }

    const g2 = grp('Druckstücke (Teilung)', false, 'rprof', { key: 'rprofSeg' });
    hint(g2.body, 'Teilt die Form quer zur Rumpfachse in gleich lange Stücke für den Druckraum bzw. die Fräse — je Stück eine STL-Datei.');
    boolRow(g2.body, 'in Stücke teilen', () => !!c.seg.on, v => { c.seg.on = v; RB(); });
    if (c.seg.on) {
      selectRow(g2.body, 'Teilung', [['n', 'Anzahl Stücke'], ['len', 'größte Stücklänge']], () => c.seg.mode, v => { c.seg.mode = v; RB(); });
      if (c.seg.mode === 'len') num(g2.body, 'Stücklänge höchstens (mm)', () => c.seg.len, v => { c.seg.len = Math.max(20, v); }, 10);
      else num(g2.body, 'Anzahl Stücke', () => c.seg.n, v => { c.seg.n = clamp(Math.round(v), 1, 40); });
      num(g2.body, 'Vorschau: Abstand der Stücke (mm)', () => c.segGap, v => { c.segGap = Math.max(0, v); }, 5);
    }
    side.appendChild(g2.g);

    buildCutPanel();
    outGroup();
    function outGroup() {
    const g3 = grp('Ansicht & Ausgabe', true, 'rprof', { key: 'rprofOut' });
    if (c.part === 'fus' && c.target !== 'ur' && c.side === 'both') num(g3.body, 'Vorschau: Abstand der Hälften (mm)', () => c.gap, v => { c.gap = Math.max(0, v); }, 10);
    subhead(g3.body, 'Farben (3D-Ansicht)');
    for (const [label, key] of [['Farbe Formfläche', 'formColSurf'], ['Farbe Formenrand / Hinterbau', 'formColRim']]) {
      const row = document.createElement('div'); row.className = 'row'; const l = document.createElement('label'); l.textContent = T(label); row.appendChild(l);
      const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;gap:6px;align-items:center';
      const inp = document.createElement('input'); inp.type = 'color'; inp.value = colOf(key); inp.style.cssText = 'width:46px;height:26px;padding:0;cursor:pointer';
      inp.oninput = () => { state.cfg[key] = inp.value; draw(); };
      const rs = document.createElement('button'); rs.textContent = '↺'; rs.title = T('Standardfarbe'); rs.style.cssText = 'padding:0 8px;min-width:0';
      rs.onclick = () => { state.cfg[key] = COL[key]; inp.value = COL[key]; draw(); };
      wrap.appendChild(inp); wrap.appendChild(rs); row.appendChild(wrap); g3.body.appendChild(row);
    }
    hint(g3.body, 'Die Farben gelten gemeinsam mit dem Reiter „Formenbau".');
    hint(g3.body, 'Die STL-Dateien liegen druckfertig: Formfläche nach oben, Rückseite bzw. Platte auf Z = 0, Ecke im Nullpunkt.');
    const bb = document.createElement('div'); bb.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px';
    bb.appendChild(mkMini(T('STL speichern…'), exportStl));
    g3.body.appendChild(bb);
    side.appendChild(g3.g);
    }
  }

  Object.assign(App, { rprofSidebar });
  window.RproForm = { show, render, resize, build, exportStl, _test: { featureEdges, shellFrame, shellItems, canUr, sectionSegs, chainSegs, sliceX, rodChannels, rodCut, ringAt, blockMesh, pieces, annulus, fusSrc, canSrc, source, openEdges, volume, finish, cfg } };
})();
