/* cockpit.js — Reiter „Cockpit" (Feature „cockpit"): Instrumentenpilz, Instrumentenbrett mit Instrumenten,
 * Sitzwanne und Steuerknüppel für Segler-Modelle.
 *   Instrumentenbrett  ebene, geneigte Platte (Breite oben/unten, Wölbung oben, Eckradien, Beinausschnitt);
 *                      Instrumente als Sacklöcher oder Durchbrüche mit Zierring
 *   Pilz               Haube über dem Brett: Blende nach hinten, nach vorne abfallend und schmaler werdend,
 *                      Wangen seitlich; optional Säule (Pilzfuß)
 *   Sitzwanne          folgt der Rumpfinnenseite (Rumpf oder eigenes STL) unter dem Haubenausschnitt,
 *                      Seitenprofil Fußraum → Sitz → Lehne
 *   Ausgabe            STL je Bauteil, Instrumentenblätter als SVG (1:1 drucken), Brett als DXF
 * Koordinaten wie Rumpf: X längs (+ nach hinten), Y hoch, Z quer. Brettebene (u, v): u = in Pilotensicht
 * nach rechts (= −Z), v = entlang des geneigten Bretts nach oben ab Unterkante, w = Normale zum Piloten.
 * Werte null = automatisch (aus dem Rumpf abgeleitet). Andere Module rufen nur geschützt
 * (App.cockpitSidebar && …, window.Cockpit).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const r1 = v => Math.round(v * 10) / 10;
  const D2R = Math.PI / 180;

  // ---------- Instrumententypen (Maße im Original, mm) --------------------------------------------
  const KINDS = {
    asi: { name: 'Fahrtmesser', shape: 'round', d: 80, val: 95, unit: 'km/h' },
    vario: { name: 'Variometer', shape: 'round', d: 80, val: 1.5, unit: 'm/s' },
    alt: { name: 'Höhenmesser', shape: 'round', d: 80, val: 850, unit: 'm' },
    comp: { name: 'Kompass', shape: 'round', d: 57, val: 30, unit: '°' },
    turn: { name: 'Wendezeiger', shape: 'round', d: 57, val: 0, unit: '°' },
    clock: { name: 'Uhr', shape: 'round', d: 57 },
    flarm: { name: 'FLARM-Anzeige', shape: 'round', d: 57 },
    blank: { name: 'Blindinstrument', shape: 'round', d: 57 },
    radio: { name: 'Funkgerät', shape: 'rect', w: 61, h: 61 },
    lx: { name: 'Bordrechner (Display)', shape: 'rect', w: 100, h: 75 }
  };
  const KIND_ORDER = ['asi', 'vario', 'alt', 'comp', 'turn', 'clock', 'flarm', 'blank', 'radio', 'lx'];

  // ---------- Konfiguration (state.cfg.cockpit) -----------------------------------------------------
  const DEF = {
    from: 'rpro',             // Rumpf: 'rpro' Rumpf | 'stl' eigenes STL | 'none' ohne Rumpf
    scale: 3,                 // Maßstab 1:n (nur für die Instrumentengrößen)
    view: '3d',               // '3d' | 'brett' (Instrumentenbrett 2D, Instrumente verschieben)
    showFus: true, wire: false, sel: 0,
    spl: 'c2', comb: true, combLen: 40,   // Spline-Art der gezeichneten Linien ('c2' krümmungsstetig | 'cr' Catmull-Rom), Krümmungskamm an/aus, Kammlänge (px)
    pz: {
      shape: 'pilz',          // Umriss: 'trap' Trapez mit Beinausschnitt | 'pilz' breites Oberteil + schmale Konsole zwischen den Beinen
      x: null, yB: null, tilt: 15, h: null, wT: null, wB: null, bow: 10, rc: 8, rcB: 3, legW: 45, legH: 14, t: 2,
      stemW: null, stemH: null, rS: 6, consD: 0,   // Pilzform: Konsolenbreite/-höhe, Hohlkehle an der Schulter, Konsolentiefe nach vorne
      free: null,             // selbst gezeichneter Umriss (shape 'free'): { sym, pts: [{ u, v, r }] } — sym: rechte Hälfte oben Mitte -> unten Mitte
      mount: 'fus',           // 'fus' Pilz fest im Rumpf (z. B. DG) | 'frame' Pilz am Haubenrahmen, schwenkt mit (z. B. ASW 20, Discus 2, LS 6) | 'free' freistehend auf Säule
      merge: true, mergeLen: null,   // am Haubenrahmen: Haube läuft tangential in den vorderen Rahmen aus (ein Bauteil), Länge des Übergangs
      runMode: 'angle', runL: { pts: null }, lid: true, lidD: 0,   // gerader Pilz: Führung 'angle' (hoodA) | 'line' gezeichnete Linie der Seitenansicht (Oberseite Mitte, pts[0] fest am Brett); lid = Deckel auf der vorderen Rahmenschräge
      run: 'straight', hoodA: 0,     // Verlauf am Haubenrahmen: 'straight' gerade senkrecht zum Brett (um hoodA° geneigt, + = nach oben), am Rahmen gestutzt | 'fit' angeschmiegt (Übergang)
      top: { mode: 'down', d: null, r: 3, pts: null, close: true },
      sec: { on: false, pts: null },   // eigener Querschnitt des Pilzes am Übergang in den Haubenrahmen: pts [{x: z, y, t}] Mitte -> Seite (Ebene X = Ende des Übergangs)   // close: Haubenrahmen über dem Pilz verschließen (Deckel)   // Oberkante des Pilzes in der Seitenansicht: 'off' bis zur Haube | 'down' Abstand unter der Rumpfoberkante | 'free' Linienzug pts [{x, y, t line|spline}]
      hood: true, lip: 6, depth: null, drop: null, curve: 2, narrow: null, cheek0: 0, cheek1: 25, wall: 1.2, play: 0.2,
      col: false, colW: 26, colD: 18, colX: null, colY: null
    },
    frame: { on: false },     // Haubenrahmen aus dem Rumpf mit ausgeben (Höhe, Stärke, Haubenstärke stellt der Rumpf ein)
    inst: { mode: 'pocket', rec: 1, bez: 1, bezH: 0.6, screws: true, list: null },
    tub: { on: true, xa: null, xb: null, gap: 1.5, wall: 1.2, rimDrop: 0, rimH: null, footH: 12, seatH: 4, seatLen: 55, backA: 25, soft: 3, stepR: 2.5, rF: 4,
      // Seitenstufen (Absätze links/rechts in Längsrichtung): Höhe über dem Boden, Breite, Bereich in % der Wannenlänge, Auslauf, Schräge der Innenwand
      steps: [{ on: true, h: 22, w: 7, x0: 30, x1: 96, ramp: 12, draft: 4 }, { on: false, h: 40, w: 5, x0: 40, x1: 90, ramp: 10, draft: 4 }] },
    stick: { on: false, x: null, len: 40, d: 2.5, grip: 6, tilt: 5 },
    exp: { sep: true }, preset: '',
    trim: []                  // Stutzen: [{ a: 'haube'|'wanne', b: Teil-id|'rumpf', on }] — A endet an B
  };
  // Vorlagen nach Segler-Typ — Anhaltswerte aus Fotos geschätzt (Form, Neigung, Befestigung, Belegung); Maße folgen dem Rumpf
  const PRESETS = {
    asw20: { name: 'ASW 20 (Pilz am Haubenrahmen)', pz: { shape: 'trap', mount: 'frame', tilt: 18, bow: 8, rc: 8, rcB: 3, legW: 50, legH: 16, lip: 5, cheek0: 0, cheek1: 18, curve: 2 }, frame: { on: true } },
    sh2: { name: 'Discus 2 / Ventus 2 (Brett schwenkt mit der Haube)', pz: { shape: 'pilz', mount: 'frame', tilt: 14, bow: 10, rc: 10, rcB: 4, rS: 8, lip: 8, cheek0: 4, cheek1: 22, curve: 2.2 }, frame: { on: true } },
    ls: { name: 'LS 4b / LS 6 / LS 8 (Brett an der Haube)', pz: { shape: 'pilz', mount: 'frame', tilt: 18, bow: 8, rc: 8, rcB: 3, rS: 6, lip: 6, cheek0: 3, cheek1: 20, curve: 2 }, frame: { on: true } },
    ls1: { name: 'LS 1 / LS 3 (Pilz fest im Rumpf)', pz: { shape: 'trap', mount: 'fus', tilt: 10, bow: 6, rc: 6, rcB: 3, legW: 40, legH: 12, lip: 4, cheek0: 0, cheek1: 25, curve: 1.6 }, frame: { on: false } },
    dg: { name: 'DG-100 … DG-600 (eigener Pilz im Rumpf)', pz: { shape: 'pilz', mount: 'fus', tilt: 12, bow: 12, rc: 12, rcB: 4, rS: 10, consD: 12, lip: 7, cheek0: 2, cheek1: 28, curve: 2.4 }, frame: { on: false } },
    two: { name: 'Doppelsitzer vorne, Pilz auf Säule', pz: { shape: 'trap', mount: 'fus', tilt: 10, bow: 8, rc: 8, rcB: 3, legW: 0, legH: 0, lip: 6, cheek0: 0, cheek1: 25, curve: 2, col: true }, frame: { on: false } },
    free: { name: 'Freistehender Pilz auf Säule', pz: { shape: 'trap', mount: 'free', tilt: 12, bow: 10, rc: 10, rcB: 6, legW: 0, legH: 0, lip: 6, curve: 1.6 }, frame: { on: false } },
    old: { name: 'Holzsegler: Brett ohne Pilz (z. B. Ka 6)', pz: { shape: 'trap', mount: 'fus', hood: false, tilt: 5, bow: 4, rc: 4, rcB: 2, legW: 0, legH: 0 }, frame: { on: false } }
  };
  const COL = { ckColPilz: '#6b7480', ckColBrett: '#2e3238', ckColRing: '#b8c0c8', ckColWanne: '#c9c0ae', ckColStick: '#8a6a44', ckColFus: '#4f7fbf', ckColRahmen: '#d8d2c2' };
  const COL_KEYS = ['ckColPilz', 'ckColBrett', 'ckColRing', 'ckColWanne', 'ckColStick', 'ckColFus', 'ckColRahmen'];
  const colOf = k => (/^#[0-9a-f]{6}$/i.test(state.cfg[k] || '') ? state.cfg[k] : COL[k]);
  const clone = o => JSON.parse(JSON.stringify(o));
  function cfg() {
    let c = state.cfg.cockpit;
    if (!c || typeof c !== 'object') c = state.cfg.cockpit = clone(DEF);
    for (const k in DEF) if (c[k] === undefined) c[k] = clone(DEF[k]);
    for (const k of ['pz', 'frame', 'inst', 'tub', 'stick', 'exp']) for (const q in DEF[k]) if (c[k][q] === undefined) c[k][q] = clone(DEF[k][q]);
    if (!c.pz.top || typeof c.pz.top !== 'object') c.pz.top = clone(DEF.pz.top);
    if (!c.pz.sec || typeof c.pz.sec !== 'object') c.pz.sec = clone(DEF.pz.sec);
    for (const q in DEF.pz.top) if (c.pz.top[q] === undefined) c.pz.top[q] = clone(DEF.pz.top[q]);
    if (!Array.isArray(c.tub.steps)) c.tub.steps = clone(DEF.tub.steps);
    for (let i = 0; i < 2; i++) { if (!c.tub.steps[i] || typeof c.tub.steps[i] !== 'object') c.tub.steps[i] = clone(DEF.tub.steps[i]); for (const q in DEF.tub.steps[i]) if (c.tub.steps[i][q] === undefined) c.tub.steps[i][q] = DEF.tub.steps[i][q]; }
    return c;
  }
  function applyPreset(k) {
    const P = PRESETS[k], c = cfg(); if (!P) return false;
    if (Array.isArray(c.inst.list) && c.inst.list.length && !confirm(T('Vorlage übernehmen? Brettform, Pilz und Instrumentenbelegung werden ersetzt.'))) return false;
    for (const q of ['x', 'yB', 'h', 'wT', 'wB', 'depth', 'drop', 'narrow', 'stemW', 'stemH', 'colX', 'colY', 'mergeLen']) c.pz[q] = null;
    Object.assign(c.pz, { hood: true, col: false, consD: 0, merge: true }, clone(P.pz));
    Object.assign(c.frame, clone(P.frame || {}));
    c.inst.list = null; c.sel = 0; c.preset = k;
    return true;
  }

  // ---------- Rumpf (Rumpf oder STL) ------------------------------------------------------------
  function fusApi() {
    const c = cfg();
    try {
      if (c.from === 'none') return null;
      if (c.from === 'stl') return (window.StlBody && StlBody.api && StlBody.api()) || null;
      return (window.RumpfPro && RumpfPro.api && RumpfPro.api()) || null;
    } catch (e) { return null; }
  }
  // Halbspant [[y, z], …] (oben -> unten, z >= 0) und abgeleitete Maße, je Bau zwischengespeichert
  function fusOf(A) {
    if (!A || typeof A.bodyHalf !== 'function' || !(A.x1 > A.x0)) return null;
    const memo = new Map();
    const half = x => { const k = Math.round(x * 4) / 4; let h = memo.get(k); if (!h) { try { h = A.bodyHalf(k) || []; } catch (e) { h = []; } memo.set(k, h); } return h; };
    const top = x => { let m = -Infinity; for (const p of half(x)) m = Math.max(m, p[0]); return isFinite(m) ? m : 0; };
    const bot = x => { let m = Infinity; for (const p of half(x)) m = Math.min(m, p[0]); return isFinite(m) ? m : 0; };
    // halbe Rumpfbreite in Höhe y (größtes z der Schnittpunkte), -Infinity = Höhe liegt nicht im Rumpf
    const hw = (x, y) => {
      const h = half(x); let z = -Infinity;
      for (let i = 0; i + 1 < h.length; i++) {
        const p = h[i], q = h[i + 1];
        if ((p[0] - y) * (q[0] - y) <= 0 && p[0] !== q[0]) { const t = (y - p[0]) / (q[0] - p[0]); z = Math.max(z, p[1] + (q[1] - p[1]) * t); }
      }
      return z;
    };
    const can = A.canopy && typeof A.canopy.spans === 'function' ? A.canopy : null;
    // Unterkante des Haubenausschnitts (Bordwand), sonst Rumpfoberkante
    const rim = x => { if (can && x >= can.x0 && x <= can.x1) { const sp = can.spans(x); if (sp && sp.length) return sp[0][0]; } return top(x); };
    // wie weit ragt ein Punkt aus dem Rumpf (0 = innen)
    const out = (x, y, z) => {
      if (x < A.x0) return A.x0 - x; if (x > A.x1) return x - A.x1;
      const t = top(x), b = bot(x); if (y > t) return y - t; if (y < b) return b - y;
      const w = hw(x, y); return w > -Infinity ? Math.max(0, Math.abs(z) - w) : 0;
    };
    return { A, half, top, bot, hw, rim, can, out, x0: A.x0, x1: A.x1 };
  }

  // ---------- Splines der gezeichneten Linien (Brettumriss, Oberkante, Querschnitt) ---------------------------
  // cfg.spl 'c2' (Standard): krümmungsstetig — kubischer Spline durch alle Punkte (Parameter = Sehnenlänge) mit stetiger
  // 2. Ableitung an jedem glatten Punkt; an eine Gerade schließt er tangential UND mit Krümmung 0 an (verdeckter
  // Zwischenknoten im ersten/letzten Abschnitt, damit die Kurve weiter durch alle Punkte läuft).
  // 'cr': wie bisher Hermite mit Catmull-Rom-Tangenten (nur Tangente stetig, Krümmung springt an jedem Punkt).
  const splC2 = () => cfg().spl !== 'cr';
  // Hermite-Abschnitt A -> B, TA/TB = Ableitung nach t ∈ [0, 1]; hängt N Punkte (ohne A) an out, in K die Kammproben
  // {x, v, k, n} (k > 0 = Linkskurve, n = Linksnormale), A eingeschlossen
  function hermSeg(A, B, TA, TB, N, out, K) {
    for (let k = K ? 0 : 1; k <= N; k++) {
      const t = k / N, t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      const p = [h00 * A[0] + h10 * TA[0] + h01 * B[0] + h11 * TB[0], h00 * A[1] + h10 * TA[1] + h01 * B[1] + h11 * TB[1]];
      if (k) out.push(p);
      if (!K) continue;
      const a0 = 6 * t2 - 6 * t, a1 = 3 * t2 - 4 * t + 1, a3 = 3 * t2 - 2 * t, b0 = 12 * t - 6, b1 = 6 * t - 4, b3 = 6 * t - 2;
      const d1 = [0, 1].map(c => a0 * A[c] + a1 * TA[c] - a0 * B[c] + a3 * TB[c]), d2 = [0, 1].map(c => b0 * A[c] + b1 * TA[c] - b0 * B[c] + b3 * TB[c]), L = Math.hypot(d1[0], d1[1]);
      if (L > 1e-12) K.push({ x: p[0], v: p[1], k: (d1[0] * d2[1] - d1[1] * d2[0]) / (L * L * L), n: [-d1[1] / L, d1[0] / L] });
    }
  }
  // kleines dichtes Gleichungssystem (Gauß mit Spaltenpivot), zwei rechte Seiten (x und y)
  function solve2(A, B) {
    const n = A.length;
    for (let c = 0; c < n; c++) {
      let pr = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[pr][c])) pr = r;
      if (Math.abs(A[pr][c]) < 1e-12) return null;
      [A[c], A[pr]] = [A[pr], A[c]]; [B[c], B[pr]] = [B[pr], B[c]];
      for (let r = c + 1; r < n; r++) { const f = A[r][c] / A[c][c]; if (!f) continue; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; B[r][0] -= f * B[c][0]; B[r][1] -= f * B[c][1]; }
    }
    const X = new Array(n);
    for (let r = n - 1; r >= 0; r--) { let s0 = B[r][0], s1 = B[r][1]; for (let k = r + 1; k < n; k++) { s0 -= A[r][k] * X[k][0]; s1 -= A[r][k] * X[k][1]; } X[r] = [s0 / A[r][r], s1 / A[r][r]]; }
    return X;
  }
  // C2-Spline durch Q (offen oder geschlossen). e0/e1 (nur offen): null = natürliches Ende (Krümmung 0),
  // { t } = Tangente vorgegeben, { t, k0 } = Tangente + Krümmung 0 (Anschluss an eine Gerade).
  // Liefert je Eingabe-Abschnitt i die Knotenfolge F[i]..F[i+1] mit Knoten X, Ableitungen M (nach der Bogenlänge), Intervallen H.
  function c2Solve(Q, e0, e1, closed) {
    const n = Q.length; if (n < 2 || (closed && n < 3)) return null;
    const ch = i => Math.max(1e-6, dist2(Q[i], Q[(i + 1) % n]));
    // Knoten: Eingabepunkte + verdeckte Zwischenknoten (Position unbekannt) im ersten/letzten Abschnitt bei k0-Enden
    const X = [], H = [], F = [], hid = [];
    const nSeg = closed ? n : n - 1, k0a = !closed && e0 && e0.k0, k0b = !closed && e1 && e1.k0;
    for (let i = 0; i < nSeg; i++) {
      F.push(X.length); X.push(Q[i].slice()); const L = ch(i);
      const fr = (i === 0 && k0a && i === nSeg - 1 && k0b) ? [1 / 3, 2 / 3] : (i === 0 && k0a) ? [0.5] : (i === nSeg - 1 && k0b) ? [0.5] : [];
      let t0 = 0;
      for (const f of fr) { H.push(L * (f - t0)); hid.push(X.length); X.push(lerp2(Q[i], Q[(i + 1) % n], f)); t0 = f; }
      H.push(L * (1 - t0));
    }
    if (!closed) { F.push(X.length); X.push(Q[n - 1].slice()); } else F.push(X.length);   // geschlossen: F[n] = Knoten 0 (über Umlauf)
    const N = X.length, hidOf = new Map(hid.map((j, k) => [j, N + k])), U = N + hid.length;
    const A = [], B = [];
    const row = () => { const r = new Array(U).fill(0), b = [0, 0]; A.push(r); B.push(b); return [r, b]; };
    const nd = j => (j + N) % N;
    const addP = (r, b, j, c) => { j = nd(j); if (hidOf.has(j)) r[hidOf.get(j)] += c; else { b[0] -= c * X[j][0]; b[1] -= c * X[j][1]; } };
    // 2. Ableitung am Anfang (s0) bzw. Ende (s1) des Intervalls i (Knoten i -> i+1), Faktor sg
    const d2s = (r, b, i, sg) => { const h = H[i]; addP(r, b, i + 1, sg * 6 / (h * h)); addP(r, b, i, -sg * 6 / (h * h)); r[nd(i)] -= sg * 4 / h; r[nd(i + 1)] -= sg * 2 / h; };
    const d2e = (r, b, i, sg) => { const h = H[i]; addP(r, b, i + 1, -sg * 6 / (h * h)); addP(r, b, i, sg * 6 / (h * h)); r[nd(i)] += sg * 2 / h; r[nd(i + 1)] += sg * 4 / h; };
    const j0 = closed ? 0 : 1, j1 = closed ? N : N - 1;
    for (let j = j0; j < j1; j++) { const [r, b] = row(); d2e(r, b, (j - 1 + N) % N, 1); d2s(r, b, j, -1); }   // stetige Krümmung
    if (!closed) {
      const end = (e, j, iv, atStart) => {
        if (e && e.t) { const [r, b] = row(); r[j] = 1; b[0] = e.t[0]; b[1] = e.t[1]; }
        if (!e || !e.t || e.k0) { const [r, b] = row(); (atStart ? d2s : d2e)(r, b, iv, 1); }
      };
      end(e0, 0, 0, true); end(e1, N - 1, N - 2, false);
    }
    if (A.length !== U) return null;
    const S = solve2(A, B); if (!S) return null;
    const M = S.slice(0, N);
    hid.forEach((j, k) => { X[j] = S[N + k]; });
    return { X, M, H, F, N };
  }
  // C2-Abschnitt i (zwischen Eingabepunkt i und i+1) abtasten: Nn Punkte je Teilintervall-Länge verteilt
  function c2Seg(sp, i, Ntot, out, K) {
    const a = sp.F[i], b = sp.F[i + 1], m = b - a; let Lt = 0; for (let j = a; j < b; j++) Lt += sp.H[j];
    for (let j = a; j < b; j++) {
      const h = sp.H[j], A = sp.X[j % sp.N], Bp = sp.X[(j + 1) % sp.N], MA = sp.M[j % sp.N], MB = sp.M[(j + 1) % sp.N];
      const Nj = m === 1 ? Ntot : Math.max(2, Math.round(Ntot * h / Lt));
      hermSeg(A, Bp, [MA[0] * h, MA[1] * h], [MB[0] * h, MB[1] * h], Nj, out, K);
    }
  }
  const unit2 = d => { const l = Math.hypot(d[0], d[1]); return l > 1e-9 ? [d[0] / l, d[1] / l] : [0, 0]; };
  // Linienzug mit Abschnittsarten abtasten. Q [[x, y]], S[i] = Abschnitt i -> i+1 ist ein Spline.
  // opt: { closed, N: Länge -> Punktzahl je Spline-Abschnitt, t0: Starttangente (offen, z. B. waagrecht an der Spiegelachse), comb }
  // Ergebnis { out, idx (Index der Eingabepunkte in out), comb (Kammproben längs der ganzen Linie, Geraden mit k = 0) }
  function splinePath(Q, S, opt) {
    const n = Q.length, closed = !!opt.closed, nSeg = closed ? n : n - 1, c2 = splC2(), out = [], idx = [], K = opt.comb ? [] : null;
    const Pi = i => Q[(i + n) % n], Si = i => (closed ? !!S[(i + n) % n] : i >= 0 && i < nSeg && !!S[i]);
    const Nof = i => opt.N(dist2(Q[i], Pi(i + 1)));
    const runOf = new Array(nSeg).fill(null);
    if (c2) {
      if (closed && Q.every((q, i) => Si(i))) { const sp = c2Solve(Q, null, null, true); for (let i = 0; i < n; i++) runOf[i] = sp && { sp, k: i }; }
      else for (let a = 0; a < nSeg; a++) {
        if (!Si(a) || (Si(a - 1) && (closed || a > 0))) continue;   // Anfang eines Spline-Laufs
        let b = a; const R = [Q[a]]; while (Si(b) && R.length <= n) { b++; R.push(Pi(b)); if (closed && (b - a) >= n) break; }
        const m = R.length;
        // Enden: an einer Geraden tangential + Krümmung 0; Gerade zeigt zurück -> natürliches Ende (Ecke)
        const endAt = (lineDir, chord) => { const t = unit2(lineDir); return t[0] * chord[0] + t[1] * chord[1] < 0.05 ? null : { t, k0: true }; };
        let e0 = null, e1 = null;
        if (closed || a > 0) e0 = endAt(sub2(Q[a], Pi(a - 1)), unit2(sub2(R[1], R[0])));
        else if (opt.t0) { const t = unit2(opt.t0), u = unit2(sub2(R[1], R[0])); e0 = t[0] * u[0] + t[1] * u[1] < 0.05 ? null : { t }; }
        if (closed || b < n - 1) e1 = endAt(sub2(Pi(b + 1), Pi(b)), unit2(sub2(R[m - 1], R[m - 2])));
        const sp = c2Solve(R, e0, e1, false);
        for (let k = 0; k < m - 1; k++) runOf[(a + k) % n] = sp && { sp, k };
      }
    }
    // Catmull-Rom/Hermite (auch Rückfall, falls das Gleichungssystem entartet)
    const tan = i => {
      if (Si(i - 1) && Si(i)) return unit2(sub2(Pi(i + 1), Pi(i - 1)));
      if (Si(i - 1) || (!closed && i === 0)) return (i + 1 < n || closed) ? unit2(sub2(Pi(i + 1), Pi(i))) : unit2(sub2(Pi(i), Pi(i - 1)));
      return unit2(sub2(Pi(i), Pi(i - 1)));
    };
    for (let i = 0; i < n; i++) {
      idx.push(out.length); out.push(Q[i].slice());
      if (i >= nSeg) break;
      const A = Q[i], B = Pi(i + 1), L = dist2(A, B);
      if (!Si(i) || L < 1e-6) { if (K) K.push({ x: A[0], v: A[1], k: 0, n: [0, 0] }, { x: B[0], v: B[1], k: 0, n: [0, 0] }); continue; }
      if (runOf[i]) { c2Seg(runOf[i].sp, runOf[i].k, Nof(i), out, K); out.pop(); continue; }
      const cu = unit2(sub2(B, A)); let t0 = tan(i), t1 = tan(i + 1);
      if (!closed && i === 0 && !Si(i - 1)) t0 = cu;
      if (t0[0] * cu[0] + t0[1] * cu[1] < 0.05) t0 = cu;   // Gerade zeigt rückwärts: Sehne statt Schlaufe
      if (t1[0] * cu[0] + t1[1] * cu[1] < 0.05) t1 = cu;
      hermSeg(A, B, [t0[0] * L, t0[1] * L], [t1[0] * L, t1[1] * L], Nof(i), out, K); out.pop();
    }
    if (closed) { /* letzter Abschnitt endet wieder auf Q[0] (nicht doppelt) */ }
    return { out, idx, comb: K };
  }
  // Kamm: robuster Maßstab (85-%-Wert nach Bogenlänge, wie Rumpf), Wendepunkte (Vorzeichenwechsel), kleinster Radius
  function combRef(S) {
    const a = []; let tot = 0;
    for (let i = 1; i < S.length; i++) { const w = Math.hypot(S[i].x - S[i - 1].x, S[i].v - S[i - 1].v); a.push([Math.abs(S[i].k), w]); tot += w; }
    a.sort((p, q) => p[0] - q[0]); let acc = 0;
    for (const [k, w] of a) { acc += w; if (acc >= 0.85 * tot) return k; }
    return a.length ? a[a.length - 1][0] : 0;
  }
  function combStats(S) {
    let kmax = 0; for (const s of S) kmax = Math.max(kmax, Math.abs(s.k));
    const eps = 2e-4 + kmax * 0.002, infl = []; let last = 0;
    for (const s of S) { const sg = s.k > eps ? 1 : s.k < -eps ? -1 : 0; if (sg && last && sg !== last) infl.push(s); if (sg) last = sg; }
    return { kmax, rmin: kmax > 1e-9 ? 1 / kmax : Infinity, infl };
  }
  // Kamm zeichnen: g = 2D-Kontext, S Kammproben in Weltkoordinaten, P(x, v) -> [px, py], scl = px je mm, len = Kammlänge (px)
  function drawCombG(g, S, P, scl, len) {
    const kr = combRef(S); if (!S.length || !(kr > 1e-9)) return;
    const f = len / scl / kr, env = [];
    g.save(); g.strokeStyle = 'rgba(255,150,210,.35)'; g.lineWidth = 1; g.beginPath();
    S.forEach((q, i) => {
      const t = Math.abs(q.k) / kr, kk = Math.sign(q.k) * kr * (t <= 1 ? t : Math.min(1.8, 1 + 0.5 * Math.log(t)));
      const a = P(q.x, q.v), b = P(q.x - q.n[0] * kk * f, q.v - q.n[1] * kk * f);
      if (i % 2 === 0 && q.k) { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
      env.push(b);
    });
    g.stroke();
    g.strokeStyle = 'rgba(255,120,200,.9)'; g.lineWidth = 1.2; g.beginPath(); env.forEach((b, i) => (i ? g.lineTo(b[0], b[1]) : g.moveTo(b[0], b[1]))); g.stroke();
    g.strokeStyle = '#ffe14d'; g.lineWidth = 2;
    for (const q of combStats(S).infl) { const a = P(q.x, q.v); g.beginPath(); g.arc(a[0], a[1], 6, 0, Math.PI * 2); g.stroke(); }
    g.restore();
  }
  const combText = S => { const st = combStats(S); return st.infl.length + ' ' + T('Wendepunkte') + ', R min ' + (isFinite(st.rmin) ? (st.rmin < 10 ? st.rmin.toFixed(1) : st.rmin.toFixed(0)) + ' mm' : '∞'); };

  // ---------- Oberkante des Pilzes (Seitenansicht) -----------------------------------------------------
  // Linienzug [{x, y, t}] -> abgetastete Linie [[x, y]]; t = Art des Abschnitts bis zum nächsten Punkt (line | spline).
  // Spline: krümmungsstetig (C2) bzw. Hermite mit Catmull-Rom-Tangenten (cfg.spl 'cr'); 24 Punkte je Spline-Abschnitt.
  // opt.t0: Starttangente (Querschnitt: waagrecht an der Mitte), opt.comb: Kammproben in .comb mitliefern
  function topCurve(pts, opt) {
    const Q = (pts || []).filter(q => q && isFinite(+q.x) && isFinite(+q.y)).map(q => ({ x: +q.x, y: +q.y, t: q.t === 'spline' ? 'spline' : 'line' }));
    if (Q.length < 2) return null;
    const E = splinePath(Q.map(q => [q.x, q.y]), Q.map(q => q.t === 'spline'), { N: () => 24, t0: opt && opt.t0, comb: opt && opt.comb });
    if (opt && opt.comb) E.out.comb = E.comb;
    return E.out;
  }
  // y der Linie bei x (tiefster Schnittpunkt; außerhalb waagrecht verlängert)
  function curveY(C, x) {
    let y = Infinity, xa = Infinity, xb = -Infinity, ya = 0, yb = 0;
    for (const p of C) { if (p[0] < xa) { xa = p[0]; ya = p[1]; } if (p[0] > xb) { xb = p[0]; yb = p[1]; } }
    if (x <= xa) return ya; if (x >= xb) return yb;
    for (let i = 0; i + 1 < C.length; i++) { const a = C[i], b = C[i + 1]; if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) y = Math.min(y, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])); }
    return isFinite(y) ? y : ya;
  }
  // wie curveY, aber außerhalb entlang des End-Abschnitts geradlinig verlängert (Verlauf des geraden Pilzes)
  function curveYX(C, x) {
    let ia = 0, ib = 0;
    for (let i = 1; i < C.length; i++) { if (C[i][0] < C[ia][0]) ia = i; if (C[i][0] > C[ib][0]) ib = i; }
    const ext = i => { const j = i === 0 ? 1 : i === C.length - 1 ? C.length - 2 : i - 1, a = C[i], b = C[j], dx = a[0] - b[0]; return Math.abs(dx) < 1e-9 ? a[1] : a[1] + (a[1] - b[1]) * (x - a[0]) / dx; };
    if (x < C[ia][0]) return ext(ia); if (x > C[ib][0]) return ext(ib);
    return curveY(C, x);
  }
  // Startpunkte für den Verlauf des geraden Pilzes (Seitenansicht, Oberseite in der Mitte) aus der aktuellen Geraden
  function runFromStraight(R) {
    const d = R && R.runDef; if (!d) return null;
    const pts = []; for (let k = 0; k <= 2; k++) { const t = (d.len + 10) * k / 2; pts.push({ x: Math.round((d.S0[0] + d.dir[0] * t) * 10) / 10, y: Math.round((d.S0[1] + d.dir[1] * t) * 10) / 10, t: k < 2 ? 'spline' : 'line' }); }
    return pts;
  }
  // Startpunkte für den freien Linienzug aus der Abstands-Linie (vom Haubenanfang bis hinter das Brett)
  function topFromDown(R) {
    const F = R.F, p = R.pz; if (!F) return null;
    const xa = F.can ? F.can.x0 : p.x - 80, xb = p.x + 10, d = p.topD, n = 4, pts = [];
    for (let i = 0; i < n; i++) { const x = xa + (xb - xa) * i / (n - 1); pts.push({ x: Math.round(x * 10) / 10, y: Math.round((F.top(x) - d) * 10) / 10, t: 'spline' }); }
    pts[n - 1].t = 'line'; return pts;
  }

  // ---------- wirksame Maße (null = automatisch) ----------------------------------------------------
  function resolve(c, F) {
    const p = c.pz, auto = {}, q = Object.assign({}, p), R = { scale: Math.max(0.1, +c.scale || 1), auto };
    const pick = (o, k, v, key) => { if (o[k] == null || !isFinite(+o[k])) { auto[key || k] = true; return v; } return +o[k]; };
    const tl = clamp(+p.tilt || 0, -30, 60) * D2R; q.tiltR = tl;
    let ca, cb;
    if (F) { ca = F.can ? F.can.x0 : F.x0 + 0.2 * (F.x1 - F.x0); cb = F.can ? F.can.x1 : F.x0 + 0.4 * (F.x1 - F.x0); }
    else { ca = -60; cb = 240; }
    const Lc = Math.max(20, cb - ca), mg = 2 + (+p.wall || 0);
    q.x = pick(p, 'x', ca + 0.2 * Lc);
    const pilz = p.shape === 'pilz', fRaw = p.shape === 'free' ? freeRaw(p) : null;
    q.shape = pilz ? 'pilz' : fRaw ? 'free' : 'trap'; q.mount = p.mount === 'frame' || p.mount === 'free' ? p.mount : 'fus';
    const fs = q.mount === 'free' ? 0.72 : 1;   // freistehend: kleiner als der Rumpfquerschnitt
    if (F) {
      const tp = F.top(q.x), bt = F.bot(q.x);
      q.yB = pick(p, 'yB', bt + (pilz ? 0.2 : 0.42) * (tp - bt));
      q.h = pick(p, 'h', Math.max(15, (bt + 0.86 * (tp - bt) - q.yB) / Math.cos(tl)));
    } else { q.yB = pick(p, 'yB', 0); q.h = pick(p, 'h', 70); }
    q.h = Math.max(5, q.h);
    q.bow = clamp(+p.bow || 0, 0, q.h * 0.6);
    const hc = q.h - q.bow, xc = q.x - hc * Math.sin(tl), yc = q.yB + hc * Math.cos(tl);
    q.stemH = clamp(pick(p, 'stemH', 0.42 * q.h), 0, q.h);
    const vS = pilz ? q.stemH : 0;   // Pilzform: „Breite unten" gilt an der Schulter
    if (F) {
      const w1 = F.hw(xc, yc), w0 = F.hw(q.x - vS * Math.sin(tl), q.yB + vS * Math.cos(tl));
      q.wT = pick(p, 'wT', Math.max(10, fs * 2 * ((w1 > -Infinity ? w1 : 40) - mg)));
      q.wB = pick(p, 'wB', Math.max(10, fs * 2 * ((w0 > -Infinity ? w0 : 40) - mg)));
    } else { q.wT = pick(p, 'wT', 150); q.wB = pick(p, 'wB', 120); }
    q.wT = Math.max(4, q.wT); q.wB = Math.max(4, q.wB);
    if (fRaw) {   // selbst gezeichnet: Höhe und Breiten aus der Zeichnung (mit Spline-Bögen)
      const fD = freeOutline(p) || fRaw;
      let v0 = Infinity, v1 = -Infinity; for (const r of fD) { v0 = Math.min(v0, r[1]); v1 = Math.max(v1, r[1]); }
      const wAt = v => { const xs = []; for (let i = 0; i < fD.length; i++) { const a = fD[i], b = fD[(i + 1) % fD.length], va = a[1] - v0, vb = b[1] - v0; if ((va - v) * (vb - v) <= 0 && va !== vb) xs.push(a[0] + (b[0] - a[0]) * (v - va) / (vb - va)); } return xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : 10; };
      q.h = Math.max(5, v1 - v0); q.bow = 0; q.wT = Math.max(4, wAt(0.85 * q.h)); q.wB = Math.max(4, wAt(0.15 * q.h));
    }
    q.stemW = pick(p, 'stemW', clamp(0.32 * q.wB, 8, Math.max(8, q.wB - 6)));
    q.isPilz = !fRaw && pilz && q.stemW > 1 && q.stemW < q.wB - 2 && q.stemH > 1 && q.stemH < hc - 5;
    q.rS = Math.max(0, +p.rS || 0); q.consD = Math.max(0, +p.consD || 0);
    const xCr = q.x - q.h * Math.sin(tl), yCr = q.yB + q.h * Math.cos(tl);
    // Pilz am Haubenrahmen: reicht bis zum vorderen Rahmen (Haubenlinie vorne in Höhe der Pilzoberseite)
    let dAuto = 0.9 * q.h;
    if (F && q.mount === 'frame' && F.can && Array.isArray(F.can.line)) {
      const N = F.can.line, yRef = yCr - 0.25 * q.h, fw = F.can.frame ? F.can.frame.h : 0;
      for (let i = 0; i + 1 < N.length; i++) { const a = N[i], b = N[i + 1]; if ((a[1] - yRef) * (b[1] - yRef) <= 0 && a[1] !== b[1]) { const xf = a[0] + (b[0] - a[0]) * (yRef - a[1]) / (b[1] - a[1]); dAuto = clamp(xCr - xf + 0.5 * fw, 0.3 * q.h, 4 * q.h); break; } }
    }
    q.merge = q.mount === 'frame' && !!p.merge;
    q.straight = q.merge && p.run !== 'fit'; q.lid = q.straight && p.lid !== false; q.lidD = Math.max(0, +p.lidD || 0); q.runLine = q.straight && p.runMode === 'line' && !!(p.runL && Array.isArray(p.runL.pts) && p.runL.pts.length >= 2); q.hoodA = clamp(+p.hoodA || 0, -45, 45) * D2R;
    q.mergeLen = Math.max(1, pick(p, 'mergeLen', 0.6 * q.h));
    if (q.merge) dAuto = Math.max(0.25 * q.h, dAuto - q.mergeLen);
    if (q.mount === 'free') dAuto = 0.6 * q.h;
    q.depth = Math.max(0, pick(p, 'depth', dAuto));
    // Oberkante des Pilzes (nur am Haubenrahmen angeschmiegt): Abstand unter der Rumpfoberkante oder freie Linie
    const tp = p.top || {}; q.topMode = tp.mode === 'off' || tp.mode === 'free' ? tp.mode : 'down'; q.topR = Math.max(0.2, +tp.r || 0.2); q.topY = null; q.topClose = tp.close !== false;
    q.topD = Math.max(0, pick(tp, 'd', F ? 0.3 * Math.max(5, F.top(q.x) - F.rim(q.x)) : 15, 'top.d'));
    if (F && q.topMode === 'down') { const d = q.topD; q.topY = x => F.top(x) - d; }
    else if (q.topMode === 'free') { const C = topCurve(tp.pts); if (C) { q.topC = C; q.topY = x => curveY(C, x); } }
    q.drop = pick(p, 'drop', q.mount === 'free' ? 0.6 * q.h : F ? Math.max(0.3 * q.h, yCr - (F.top(xCr - q.depth) - mg)) : 0.3 * q.h);
    q.drop = clamp(q.drop, 0, q.h * 0.95);
    if (q.mount === 'free') q.narrow = pick(p, 'narrow', 0.3 * q.wT);
    else if (F) { const w2 = F.hw(xc - q.depth, yc - q.drop); q.narrow = pick(p, 'narrow', Math.max(0, q.wT / 2 - ((w2 > -Infinity ? w2 : q.wT / 2) - mg))); }
    else q.narrow = pick(p, 'narrow', 0.08 * q.wT);
    q.col = q.mount === 'free' ? true : q.mount === 'frame' ? false : !!p.col;
    q.narrow = clamp(q.narrow, 0, q.wT * 0.45);
    q.curve = clamp(+p.curve || 1, 0.5, 5);
    q.lip = Math.max(0, +p.lip || 0); q.wall = Math.max(0.2, +p.wall || 0.2); q.t = Math.max(0.2, +p.t || 0.2);
    q.colX = pick(p, 'colX', 0.55 * q.depth);
    let cy = q.yB - 50;
    if (F) {   // Säule so tief wie möglich, aber ganz im Rumpf (Boden ist meist rund)
      const xc = q.x - q.colX, need = Math.max(+p.colW || 0, +p.colD || 0) / 2 + (+c.tub.gap || 0) + 0.5, tpc = F.top(xc);
      cy = F.bot(xc) + (+c.tub.gap || 0) + 0.5;
      while (cy < tpc && !(F.hw(xc, cy) >= need && F.hw(xc + (+p.colD || 0) / 2, cy) >= need - (+p.colD || 0) / 2 && F.hw(xc - (+p.colD || 0) / 2, cy) >= need - (+p.colD || 0) / 2)) cy += 0.5;
    }
    q.colY = pick(p, 'colY', cy);
    R.pz = q; R.ca = ca; R.cb = cb; R.Lc = Lc; R.F = F;
    const t = Object.assign({}, c.tub);
    t.xa = pick(c.tub, 'xa', F ? Math.max(F.x0 + 0.02 * (F.x1 - F.x0), q.x - 0.45 * Lc) : q.x - 0.45 * Lc, 'tub.xa');
    t.xb = pick(c.tub, 'xb', F ? Math.min(F.x1 - 5, cb - 0.03 * Lc) : cb, 'tub.xb');
    const xm = (t.xa + t.xb) / 2;
    t.rimHv = pick(c.tub, 'rimH', F ? Math.max(1, F.rim(xm) - (+c.tub.rimDrop || 0) - F.bot(xm) - 2 * (+c.tub.gap || 0)) : 60, 'tub.rimH');
    t.rimH = c.tub.rimH == null || !isFinite(+c.tub.rimH) ? null : +c.tub.rimH;
    R.tub = t;
    const s = Object.assign({}, c.stick);
    s.x = pick(c.stick, 'x', q.x + 0.3 * Lc, 'stick.x');
    R.stick = s;
    return R;
  }

  // ---------- 2D-Helfer ------------------------------------------------------------------------------
  const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  function area2(P) { let s = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; }
  function inPoly(p, P) {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; }
    return c;
  }
  // offene Linie nach Bogenlänge auf n Abschnitte (n + 1 Punkte)
  function resampleOpen(P, n) {
    const L = [0]; for (let i = 1; i < P.length; i++) L.push(L[i - 1] + dist2(P[i], P[i - 1]));
    const tot = L[L.length - 1], out = []; let k = 0;
    if (!(tot > 1e-12)) { for (let i = 0; i <= n; i++) out.push(P[0].slice()); return out; }
    for (let i = 0; i <= n; i++) {
      const s = tot * i / n; while (k < P.length - 2 && L[k + 1] < s) k++;
      const d = L[k + 1] - L[k]; out.push(lerp2(P[k], P[k + 1], d > 1e-12 ? (s - L[k]) / d : 0));
    }
    return out;
  }
  // exakt kollineare / doppelte Punkte entfernen (earcut lässt sie sonst aus -> T-Stöße im Netz)
  function cleanRing(P) {
    let R = P.slice(), ch = true;
    while (ch && R.length > 3) {
      ch = false;
      for (let i = 0; i < R.length && R.length > 3; i++) {
        const a = R[(i - 1 + R.length) % R.length], b = R[i], c = R[(i + 1) % R.length];
        const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]), l = dist2(a, c);
        if (dist2(a, b) < 1e-7 || Math.abs(cr) < 1e-9 * Math.max(1, l * l)) { R.splice(i, 1); ch = true; i--; }
      }
    }
    return R;
  }
  // Ecke k eines geschlossenen Polygons abrunden (quadratische Bezier, tangential an beide Schenkel);
  // cap = größte Schenkellänge, die die Rundung verbrauchen darf
  function roundCorner(P, k, r, cap) {
    const n = P.length, a = P[k], pr = P[(k - 1 + n) % n], nx = P[(k + 1) % n];
    const d1 = sub2(pr, a), d2 = sub2(nx, a), l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    if (!(l1 > 1e-9 && l2 > 1e-9)) return;
    const th = Math.acos(clamp((d1[0] * d2[0] + d1[1] * d2[1]) / (l1 * l2), -1, 1));
    if (th > Math.PI - 0.02 || th < 0.05) return;
    const d = Math.min(r / Math.tan(th / 2), cap);
    if (!(d > 1e-3)) return;
    const walk = (dir) => {   // Punkt im Abstand d entlang des Linienzugs, Index des stehenbleibenden Punkts
      let i = k, rest = d;
      for (let s = 0; s < n - 1; s++) {
        const j = (i + dir + n) % n, L = dist2(P[i], P[j]);
        if (L >= rest) return { pt: lerp2(P[i], P[j], L > 1e-12 ? rest / L : 0), j, last: rest >= L - 1e-9 };
        rest -= L; i = j;
      }
      return null;
    };
    const A = walk(-1), B = walk(+1); if (!A || !B) return;
    const m = Math.max(4, Math.round(th > 1.5 ? 10 : 7)), pts = [];
    for (let i = 0; i <= m; i++) { const t = i / m, u = 1 - t; pts.push([u * u * A.pt[0] + 2 * u * t * a[0] + t * t * B.pt[0], u * u * A.pt[1] + 2 * u * t * a[1] + t * t * B.pt[1]]); }
    // Punkte zwischen A.j und B.j (exklusive) ersetzen
    const ja = A.j, jb = B.j;
    if (jb > ja) P.splice(ja + 1, jb - ja - 1, ...pts);
    else { P.splice(ja + 1, P.length - ja - 1, ...pts); if (jb > 0) P.splice(0, jb); }
  }

  // ---------- Brettumriss ----------------------------------------------------------------------------
  // geschlossenes Polygon (CCW) in (u, v), Start auf halber Höhe der linken Kante
  // Pilzform (wie Discus 2 / Ventus 2): breites Oberteil, Schultern mit Hohlkehle, schmale Konsole bis zur Unterkante
  function pilzOutline(p) {
    const h = p.h, wT = p.wT, wB = p.wB, bow = p.bow, hc = h - bow, sw = p.stemW, sh = p.stemH;
    const rc = Math.max(0, +p.rc || 0), rcB = Math.max(0, +p.rcB || 0), rS = Math.max(0, +p.rS || 0);
    const P = [], C = [], side = Math.hypot((wT - wB) / 2, hc - sh), lw = (wB - sw) / 2;
    const push = (u, v) => P.push([u, v]);
    const cO = Math.min(0.45 * side, 0.45 * lw), cS = Math.min(0.45 * lw, 0.45 * sh), cB = Math.min(0.45 * sh, 0.45 * sw);
    push(-(wT + wB) / 4, (hc + sh) / 2);
    C.push({ k: P.length, r: rcB, cap: cO }); push(-wB / 2, sh);
    C.push({ k: P.length, r: rS, cap: cS }); push(-sw / 2, sh);
    C.push({ k: P.length, r: rcB, cap: cB }); push(-sw / 2, 0);
    C.push({ k: P.length, r: rcB, cap: cB }); push(sw / 2, 0);
    C.push({ k: P.length, r: rS, cap: cS }); push(sw / 2, sh);
    C.push({ k: P.length, r: rcB, cap: cO }); push(wB / 2, sh);
    push((wT + wB) / 4, (hc + sh) / 2);
    C.push({ k: P.length, r: rc, cap: Math.min(0.45 * side, 0.4 * wT) }); push(wT / 2, hc);
    const n = 48;
    if (bow > 0.01) {
      const cw = wT / 2, R = (cw * cw + bow * bow) / (2 * bow), yc = h - R, a0 = Math.atan2(hc - yc, cw);
      for (let i = 1; i < n; i++) { const a = a0 + (Math.PI - 2 * a0) * i / n; push(R * Math.cos(a), yc + R * Math.sin(a)); }
    } else for (let i = 1; i < n; i++) push(wT / 2 - wT * i / n, hc);
    C.push({ k: P.length, r: rc, cap: Math.min(0.45 * side, 0.4 * wT) }); push(-wT / 2, hc);
    C.sort((a, b) => b.k - a.k);
    for (const q of C) if (q.r > 0.05) roundCorner(P, q.k, q.r, q.cap);
    return P;
  }
  function panelOutline(p) {
    if (p.shape === 'free') { const P = freeOutline(p); if (P) return P; }
    if (p.isPilz) return pilzOutline(p);
    const h = p.h, wT = p.wT, wB = p.wB, bow = p.bow, hc = h - bow;
    const rcB = Math.max(0, +p.rcB || 0), rc = Math.max(0, +p.rc || 0);
    const lw = clamp(+p.legW || 0, 0, wB - 2 * rcB - 4), lh = clamp(+p.legH || 0, 0, hc * 0.6);
    const P = [], C = [], side = Math.hypot((wT - wB) / 2, hc);
    const push = (u, v) => P.push([u, v]);
    push(-(wT + wB) / 4, hc / 2);
    C.push({ k: P.length, r: rcB, cap: Math.min(0.45 * side, lw > 1 ? 0.45 * (wB - lw) / 2 : 0.45 * wB) }); push(-wB / 2, 0);
    if (lw > 1 && lh > 0.3) {
      const cap = Math.min(0.45 * (wB - lw) / 2, 0.3 * lh);
      C.push({ k: P.length, r: Math.min(rcB, lw / 4), cap }); push(-lw / 2, 0);
      const n = 28; for (let i = 1; i < n; i++) { const a = Math.PI * (1 - i / n); push(lw / 2 * Math.cos(a), lh * Math.sin(a)); }
      C.push({ k: P.length, r: Math.min(rcB, lw / 4), cap }); push(lw / 2, 0);
    }
    C.push({ k: P.length, r: rcB, cap: Math.min(0.45 * side, lw > 1 ? 0.45 * (wB - lw) / 2 : 0.45 * wB) }); push(wB / 2, 0);
    push((wT + wB) / 4, hc / 2);
    C.push({ k: P.length, r: rc, cap: Math.min(0.45 * side, 0.4 * wT) }); push(wT / 2, hc);
    const n = 48;
    if (bow > 0.01) {
      const cw = wT / 2, R = (cw * cw + bow * bow) / (2 * bow), yc = h - R, a0 = Math.atan2(hc - yc, cw);
      for (let i = 1; i < n; i++) { const a = a0 + (Math.PI - 2 * a0) * i / n; push(R * Math.cos(a), yc + R * Math.sin(a)); }
    } else for (let i = 1; i < n; i++) push(wT / 2 - wT * i / n, hc);
    C.push({ k: P.length, r: rc, cap: Math.min(0.45 * side, 0.4 * wT) }); push(-wT / 2, hc);
    C.sort((a, b) => b.k - a.k);
    for (const q of C) if (q.r > 0.05) roundCorner(P, q.k, q.r, q.cap);
    return P;
  }
  // ---------- selbst gezeichneter Umriss (shape 'free') ------------------------------------------------
  // sym: Punkte = rechte Hälfte von oben Mitte nach unten Mitte (Enden auf der Achse u = 0), links gespiegelt
  // Punkt q.s = 1: die Strecke von diesem Punkt zum nächsten ist ein Spline (sonst Gerade)
  // Ergebnis: Ring [u, v, r, s] gegen den Uhrzeigersinn, s gilt für die Strecke zum nächsten Ringpunkt
  function freeRaw(p) {
    const f = p && p.free; if (!f || !Array.isArray(f.pts) || f.pts.length < 3) return null;
    let P;
    if (f.sym) {
      const m = f.pts.length, H = f.pts.map((q, i) => [i === 0 || i === m - 1 ? 0 : Math.max(0, +q.u || 0), +q.v || 0, Math.max(0, +q.r || 0)]), S = f.pts.map(q => (q.s ? 1 : 0));
      // rechts von unten nach oben (Strecke H[i]->H[i+1] trägt S[i]), dann links gespiegelt von oben nach unten
      P = [];
      for (let i = m - 1; i >= 0; i--) P.push([H[i][0], H[i][1], H[i][2], i > 0 ? S[i - 1] : S[0]]);
      for (let i = 1; i < m - 1; i++) P.push([-H[i][0], H[i][1], H[i][2], S[i]]);
    } else P = f.pts.map(q => [+q.u || 0, +q.v || 0, Math.max(0, +q.r || 0), q.s ? 1 : 0]);
    if (Math.abs(area2(P)) < 1) return null;
    if (area2(P) < 0) { const n = P.length, S = P.map(q => q[3]); P.reverse(); P.forEach((q, j) => { q[3] = S[(n - 2 - j + 2 * n) % n]; }); }
    return P;
  }
  // Unterkante = tiefster Punkt des Umrisses MIT Spline-Bögen (ein Bogen kann unter die Punkte durchhängen)
  function freeV0(p) { const P = freeRaw(p); let v0 = Infinity; if (P) for (const q of freeExpand(P, P.map(q => q[3])).out) v0 = Math.min(v0, q[1]); return isFinite(v0) ? v0 : 0; }
  // Spline-Strecken: krümmungsstetig (C2) bzw. Hermite mit Catmull-Rom-Tangenten (cfg.spl 'cr'), siehe splinePath
  function freeExpand(Q, S, comb) {
    return splinePath(Q.map(q => [q[0], q[1]]), S, { closed: true, N: L => (splC2() ? clamp(Math.ceil(L), 10, 60) : clamp(Math.ceil(L / 1.5), 8, 40)), comb });
  }
  // Krümmungskamm des gezeichneten Umrisses (Brettkoordinaten wie freeOutline, ohne Eckradien)
  function freeComb(p) {
    const P = freeRaw(p); if (!P) return null;
    const v0 = freeV0(p); return freeExpand(P.map(q => [q[0], q[1] - v0]), P.map(q => q[3]), true).comb;
  }
  function freeOutline(p) {
    const P = freeRaw(p); if (!P) return null;
    const v0 = freeV0(p), n = P.length, Q = P.map(q => [q[0], q[1] - v0]), S = P.map(q => q[3]), C = [];
    // Eckradius nur zwischen zwei Geraden (am Spline ist die Ecke ohnehin glatt)
    P.forEach((q, i) => { if (q[2] > 0.05 && !S[i] && !S[(i - 1 + n) % n]) C.push({ i, r: q[2], cap: 0.48 * Math.min(dist2(Q[i], Q[(i - 1 + n) % n]), dist2(Q[i], Q[(i + 1) % n])) }); });
    const E = freeExpand(Q, S), D = E.out;
    C.forEach(c => { c.k = E.idx[c.i]; });
    C.sort((a, b) => b.k - a.k);
    for (const c of C) roundCorner(D, c.k, c.r, c.cap);
    return cleanRing(D);
  }
  // Douglas-Peucker für offene Linien
  function dpSimplify(P, tol) {
    if (P.length < 3) return P.slice();
    const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1;
    const st = [[0, P.length - 1]];
    while (st.length) {
      const [a, b] = st.pop(); let md = -1, mi = -1;
      const A = P[a], B = P[b], dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1;
      for (let i = a + 1; i < b; i++) { const d = Math.abs((P[i][0] - A[0]) * dy - (P[i][1] - A[1]) * dx) / L; if (d > md) { md = d; mi = i; } }
      if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    return P.filter((q, i) => keep[i]);
  }
  // aus der bisherigen Form (Trapez/Pilzform) einen Punktzug machen — dann frei weiterzeichnen
  function freeFromShape(R, sym) {
    const P = (R.pz.shape === 'free' && freeOutline(R.pz)) || panelOutline(Object.assign({}, R.pz, { shape: R.pz.isPilz ? 'pilz' : 'trap' }));
    if (!sym) return { sym: false, pts: dpSimplify(P.concat([P[0]]), 0.35).slice(0, -1).map(q => ({ u: r1(q[0]), v: r1(q[1]), r: 0 })) };
    const n = P.length; let it = 0, best = Infinity;
    for (let i = 0; i < n; i++) if (P[i][1] > R.pz.h * 0.5 && Math.abs(P[i][0]) < best) { best = Math.abs(P[i][0]); it = i; }
    const H = [[0, P[it][1]]];
    for (let k = 1; k < n; k++) {
      const a = P[(it - k + 1 + n) % n], b = P[(it - k + n) % n];
      if (k > 2 && b[0] < 0 && a[0] >= 0) { const t = a[0] / ((a[0] - b[0]) || 1); H.push([0, a[1] + (b[1] - a[1]) * t]); break; }
      if (b[0] >= 0) H.push(b.slice());
    }
    return { sym: true, pts: dpSimplify(H, 0.35).map(q => ({ u: r1(q[0]), v: r1(q[1]), r: 0 })) };
  }
  // Umriss im Rumpf einpassen: größter Maßstab (um die Unterkante Mitte), bei dem Brett und Haubenrand im Rumpf bleiben
  function fitFree(c, R, F, mode) {
    const f = c.pz.free; if (!f || !F) return 0;
    const p = R.pz, fr = frame(p), mg = Math.max(0, +c.tub.gap || 0) + (p.hood ? p.wall : 0) + 1, test = fusTester(F, mg), v0 = freeV0(p);
    const scaled = k => ({ sym: f.sym, pts: f.pts.map(q => ({ u: q.u * k, v: mode === 'w' ? q.v : v0 + (q.v - v0) * k, r: q.r, s: q.s ? 1 : 0 })) });
    const ok = k => { const P = freeOutline(Object.assign({}, p, { free: scaled(k) })); if (!P) return false; for (const q of P) for (const w of [0, -p.t]) if (test(fr.map(q[0], q[1], w))) return false; return true; };
    if (!ok(0.05)) return 0;
    let lo = 0.05, hi = 20; for (let i = 0; i < 40; i++) { const m = Math.sqrt(lo * hi); if (ok(m)) lo = m; else hi = m; }
    const k = lo * 0.995; c.pz.free = scaled(k); c.pz.free.pts.forEach(q => { q.u = Math.round(q.u * 10) / 10; q.v = Math.round(q.v * 10) / 10; });
    return k;
  }
  // Bogen über die Oberkante: Teil des Umrisses oberhalb v = L, von rechts nach links, auf NA Abschnitte
  function archAt(P, L, NA) {
    const n = P.length; let kt = 0;
    for (let i = 1; i < n; i++) if (P[i][1] > P[kt][1]) kt = i;
    if (P[kt][1] <= L) return null;
    const at = i => P[((i % n) + n) % n];
    const cross = (a, b) => { const t = (L - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, L]; };
    let i = kt, g = 0; while (at(i - 1)[1] >= L && g++ < n) i--;
    let j = kt; g = 0; while (at(j + 1)[1] >= L && g++ < n) j++;
    const ch = [cross(at(i - 1), at(i))];
    for (let k = i; k <= j; k++) ch.push(at(k));
    ch.push(cross(at(j), at(j + 1)));
    return resampleOpen(ch, NA);
  }
  // offene Linie um d versetzen (rechte Normale = für den Bogen nach außen)
  function offsetOpen(A, d) {
    if (!d) return A;
    return A.map((p, i) => {
      const a = A[Math.max(0, i - 1)], b = A[Math.min(A.length - 1, i + 1)], du = b[0] - a[0], dv = b[1] - a[1], L = Math.hypot(du, dv) || 1;
      return [p[0] + d * dv / L, p[1] - d * du / L];
    });
  }
  function circlePoly(cu, cv, r, n) { const P = []; for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; P.push([cu + r * Math.cos(a), cv + r * Math.sin(a)]); } return P; }
  function rrectPoly(cu, cv, w, h, rr, nc) {
    rr = clamp(rr, 0, Math.min(w, h) / 2 - 1e-3); const P = [];
    const cs = [[w / 2 - rr, h / 2 - rr, 0], [-w / 2 + rr, h / 2 - rr, 90], [-w / 2 + rr, -h / 2 + rr, 180], [w / 2 - rr, -h / 2 + rr, 270]];
    for (const [x, y, a0] of cs) for (let i = 0; i <= nc; i++) { const a = (a0 + 90 * i / nc) * D2R; P.push([cu + x + rr * Math.cos(a), cv + y + rr * Math.sin(a)]); }
    return cleanRing(P);
  }
  function instDims(it, sc) {
    const K = KINDS[it.k] || KINDS.blank;
    if (K.shape === 'rect') { const w = (+it.w || K.w) / sc, h = (+it.h || K.h) / sc; return { rect: true, w, h, rr: Math.min(w, h) * 0.08 }; }
    return { rect: false, r: (+it.d || K.d) / sc / 2 };
  }
  function instPoly(it, sc, grow, n) {
    const d = instDims(it, sc);
    return d.rect ? rrectPoly(it.u, it.v, d.w + 2 * grow, d.h + 2 * grow, d.rr + grow, 4) : circlePoly(it.u, it.v, d.r + grow, n || 48);
  }

  // ---------- Instrumente: Standardbelegung -------------------------------------------------------------
  function defaultInst(R) {
    if (R.pz.isPilz) return defaultInstPilz(R);
    const p = R.pz, sc = R.scale, L = [], hc = p.h - p.bow, big = 80 / sc, sm = 57 / sc, gap = Math.max(2, 4 / sc * 3);
    const widthAt = v => p.wB + (p.wT - p.wB) * clamp(v / Math.max(1, hc), 0, 1) - 2 * Math.max(p.rc, 3);
    const v1 = Math.max(big / 2 + 2, Math.min(0.62 * p.h, hc - big / 2 - 2));
    let row = ['asi', 'vario', 'lx', 'alt'];
    const wOf = k => (KINDS[k].shape === 'rect' ? KINDS[k].w / sc : KINDS[k].d / sc);
    const need = ks => ks.reduce((s, k) => s + wOf(k), 0) + gap * (ks.length - 1);
    while (row.length > 1 && need(row) > widthAt(v1 - big / 2)) row = row.slice(0, -1);
    let u = -need(row) / 2;
    for (const k of row) { const w = wOf(k); L.push({ k, u: r1(u + w / 2), v: r1(v1) }); u += w + gap; }
    const v2 = Math.max(sm / 2 + 2, Math.min(0.26 * p.h, v1 - big / 2 - sm / 2 - gap));
    const lw = clamp(+p.legW || 0, 0, p.wB), uo = lw / 2 + sm / 2 + gap;
    if (uo + sm / 2 < widthAt(v2 - sm / 2) / 2) {
      L.push({ k: 'flarm', u: r1(-uo), v: r1(v2) });
      L.push({ k: 'radio', u: r1(uo + (61 - 57) / sc / 2), v: r1(v2) });
    }
    return L;
  }
  // wie auf Fotos von Discus 2 / Ventus 2: oben Fahrtmesser + Vario, darunter kleines Vario, Display, Höhenmesser, Konsole Funk + FLARM
  function defaultInstPilz(R) {
    const p = R.pz, sc = R.scale, L = [], hc = p.h - p.bow, big = 80 / sc, sm = 57 / sc, gap = Math.max(1.5, 9 / sc);
    const dW = 80 / sc, dH = 64 / sc;
    const v2 = p.stemH + Math.max(big, dH) / 2 + gap;
    const v1 = Math.max(v2 + Math.max(big, dH) / 2 + big / 2 + gap * 0.6, Math.min(hc - big / 2 - gap, hc));
    L.push({ k: 'asi', u: r1(-(big / 2 + gap * 1.5)), v: r1(v1) }, { k: 'vario', u: r1(big / 2 + gap * 1.5), v: r1(v1) });
    L.push({ k: 'lx', w: 80, h: 64, u: 0, v: r1(v2) });
    L.push({ k: 'vario', d: 57, u: r1(-(dW / 2 + gap + sm / 2)), v: r1(v2 + (big - sm) / 2) }, { k: 'alt', u: r1(dW / 2 + gap + big / 2), v: r1(v2) });
    const cr = 61 / sc;
    if (cr < p.stemW - 2) {
      L.push({ k: 'radio', u: 0, v: r1(p.stemH - cr / 2 - gap) });
      if (p.stemH - cr - 2 * gap > sm) L.push({ k: 'flarm', u: 0, v: r1(p.stemH - cr - 2 * gap - sm / 2) });
    }
    return L;
  }
  // Standardbelegung nur mit Instrumenten, die ganz im Brett liegen und sich nicht überlappen
  function defaultFit(R) {
    const L = defaultInst(R), P = panelOutline(R.pz), w = [];
    return checkInst(L, R.scale, P, w).map(o => o.it);
  }
  function instList(c, R) {
    if (!Array.isArray(c.inst.list)) c.inst.list = defaultFit(R);
    return c.inst.list;
  }
  // Prüfung: Instrument im Brett und ohne Überlappung -> nur diese werden ausgeschnitten
  function checkInst(list, sc, outline, warn) {
    const ok = [];
    list.forEach((it, i) => {
      const K = KINDS[it.k] || KINDS.blank, P = instPoly(it, sc, 0.4, 32);
      if (P.some(q => !inPoly(q, outline))) { warn.push(T('Instrument') + ' ' + (i + 1) + ' (' + T(K.name) + '): ' + T('ragt über den Brettrand — nicht ausgeschnitten.')); return; }
      const hit = ok.find(o => P.some(q => inPoly(q, o.P)) || o.P.some(q => inPoly(q, P)));
      if (hit) { warn.push(T('Instrument') + ' ' + (i + 1) + ' (' + T(K.name) + '): ' + T('überlappt Instrument') + ' ' + (hit.i + 1) + ' — ' + T('nicht ausgeschnitten.')); return; }
      ok.push({ i, it, P });
    });
    return ok;
  }

  // ---------- 3D-Netze (Dreiecksliste, je 9 Werte) ---------------------------------------------------
  function addTri(o, a, b, c) { o.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
  function volumeRange(v, from, to) {
    let s = 0;
    for (let i = from; i < to; i += 9) s += v[i] * (v[i + 4] * v[i + 8] - v[i + 5] * v[i + 7]) - v[i + 1] * (v[i + 3] * v[i + 8] - v[i + 5] * v[i + 6]) + v[i + 2] * (v[i + 3] * v[i + 7] - v[i + 4] * v[i + 6]);
    return s / 6;
  }
  // Umlaufsinn eines eben angehängten geschlossenen Körpers so drehen, dass das Volumen positiv ist
  function orient(o, from) {
    if (volumeRange(o, from, o.length) >= 0) return;
    for (let i = from; i < o.length; i += 9) for (let k = 0; k < 3; k++) { const t = o[i + 3 + k]; o[i + 3 + k] = o[i + 6 + k]; o[i + 6 + k] = t; }
  }
  const cross2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  function ecTris(rings) {
    const tr = App.earcut(rings.map(r => r.map(p => ({ x: p[0], y: p[1] }))));
    return tr.tris.map(t => { const A = tr.V[t[0]], B = tr.V[t[1]], C = tr.V[t[2]]; return cross2(A, B, C) < 0 ? [A, C, B] : [A, B, C]; }).filter(t => Math.abs(cross2(...t)) > 1e-12);
  }
  // Ringe normieren: außen CCW, Löcher CW
  const normRings = rings => rings.map((r, i) => { r = cleanRing(r); return (i === 0) === (area2(r) > 0) ? r : r.slice().reverse(); });
  // Prisma aus Ringen [außen, Löcher …] zwischen w0 und w1; map(u, v, w) -> [x, y, z]
  function extrude(o, rings, map, w0, w1) {
    const from = o.length, R = normRings(rings);
    for (const [A, B, C] of ecTris(R)) { addTri(o, map(A[0], A[1], w1), map(B[0], B[1], w1), map(C[0], C[1], w1)); addTri(o, map(A[0], A[1], w0), map(C[0], C[1], w0), map(B[0], B[1], w0)); }
    for (const r of R) wall(o, r, map, w0, w1);
    orient(o, from);
  }
  function wall(o, r, map, w0, w1) {
    for (let i = 0; i < r.length; i++) {
      const p = r[i], q = r[(i + 1) % r.length], p0 = map(p[0], p[1], w0), q0 = map(q[0], q[1], w0), q1 = map(q[0], q[1], w1), p1 = map(p[0], p[1], w1);
      addTri(o, p0, q0, q1); addTri(o, p0, q1, p1);
    }
  }
  // Brettplatte mit Instrumentenlöchern: depth < t -> Sacklöcher (Boden bei −depth), sonst durchgehend
  function plateSolid(o, outline, holes, map, t, depth) {
    const from = o.length, R = normRings([outline].concat(holes)), thru = depth >= t - 1e-6;
    for (const [A, B, C] of ecTris(R)) addTri(o, map(A[0], A[1], 0), map(B[0], B[1], 0), map(C[0], C[1], 0));
    for (const [A, B, C] of ecTris(thru ? R : [R[0]])) addTri(o, map(A[0], A[1], -t), map(C[0], C[1], -t), map(B[0], B[1], -t));
    wall(o, R[0], map, -t, 0);
    for (let h = 1; h < R.length; h++) {
      const r = R[h], d = thru ? t : depth;
      wall(o, r, map, -d, 0);
      if (!thru) for (const [A, B, C] of ecTris([r.slice().reverse()])) addTri(o, map(A[0], A[1], -d), map(B[0], B[1], -d), map(C[0], C[1], -d));
    }
    orient(o, from);
  }
  // Gitterfläche P[i][j] um t in Richtung refDir (am Punkt refI/refJ) aufdicken -> geschlossener Körper
  function gridNormals(P) {
    const I = P.length, J = P[0].length, N = [];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    for (let i = 0; i < I; i++) {
      const row = [];
      for (let j = 0; j < J; j++) {
        const du = sub(P[i][Math.min(J - 1, j + 1)], P[i][Math.max(0, j - 1)]), dv = sub(P[Math.min(I - 1, i + 1)][j], P[Math.max(0, i - 1)][j]);
        const n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]], L = Math.hypot(...n);
        row.push(L > 1e-12 ? n.map(x => x / L) : null);
      }
      N.push(row);
    }
    for (let pass = 0; pass < 4; pass++) for (let i = 0; i < I; i++) for (let j = 0; j < J; j++) if (!N[i][j]) {
      const nb = [[i, j - 1], [i, j + 1], [i - 1, j], [i + 1, j]].find(([a, b]) => a >= 0 && a < I && b >= 0 && b < J && N[a][b]);
      if (nb) N[i][j] = N[nb[0]][nb[1]];
    }
    return N;
  }
  function thicken(o, P, t, refI, refJ, refDir, pre) {
    const I = P.length, J = P[0].length, N = gridNormals(P);
    const nr = N[refI][refJ] || [0, 1, 0], sgn = nr[0] * refDir[0] + nr[1] * refDir[1] + nr[2] * refDir[2] >= 0 ? 1 : -1, sg = sgn * t, pr = sgn * (pre || 0);
    if (pr) P = P.map((row, i) => row.map((p, j) => { const n = N[i][j] || [0, 0, 0]; return [p[0] + pr * n[0], p[1] + pr * n[1], p[2] + pr * n[2]]; }));
    const Q = P.map((row, i) => row.map((p, j) => { const n = N[i][j] || [0, 0, 0]; return [p[0] + sg * n[0], p[1] + sg * n[1], p[2] + sg * n[2]]; }));
    slabGrid(o, P, Q);
  }
  // geschlossener Körper zwischen zwei gleich großen Gittern P (eine Seite) und Q (andere Seite) samt Randflächen
  function slabGrid(o, P, Q) {
    const I = P.length, J = P[0].length, from = o.length;
    for (let i = 0; i < I - 1; i++) for (let j = 0; j < J - 1; j++) {
      addTri(o, P[i][j], P[i][j + 1], P[i + 1][j + 1]); addTri(o, P[i][j], P[i + 1][j + 1], P[i + 1][j]);
      addTri(o, Q[i][j], Q[i + 1][j + 1], Q[i][j + 1]); addTri(o, Q[i][j], Q[i + 1][j], Q[i + 1][j + 1]);
    }
    const loop = [];
    for (let j = 0; j < J - 1; j++) loop.push([0, j]);
    for (let i = 0; i < I - 1; i++) loop.push([i, J - 1]);
    for (let j = J - 1; j > 0; j--) loop.push([I - 1, j]);
    for (let i = I - 1; i > 0; i--) loop.push([i, 0]);
    for (let k = 0; k < loop.length; k++) {
      const a = loop[k], b = loop[(k + 1) % loop.length], Pp = P[a[0]][a[1]], Pq = P[b[0]][b[1]], Qp = Q[a[0]][a[1]], Qq = Q[b[0]][b[1]];
      addTri(o, Pq, Pp, Qp); addTri(o, Pq, Qp, Qq);
    }
    orient(o, from);
  }
  // Drehkörper: Profil [[r, h], …] (r = 0 an den Enden = Spitze), Achse von B in Richtung ax
  function lathe(o, prof, B, ax, n) {
    const from = o.length, ref = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let e1 = [ax[1] * ref[2] - ax[2] * ref[1], ax[2] * ref[0] - ax[0] * ref[2], ax[0] * ref[1] - ax[1] * ref[0]]; const l1 = Math.hypot(...e1); e1 = e1.map(x => x / l1);
    const e2 = [ax[1] * e1[2] - ax[2] * e1[1], ax[2] * e1[0] - ax[0] * e1[2], ax[0] * e1[1] - ax[1] * e1[0]];
    const ring = ([r, h]) => { const c = [B[0] + ax[0] * h, B[1] + ax[1] * h, B[2] + ax[2] * h]; if (r < 1e-9) return null; const R = []; for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n, ca = Math.cos(a) * r, sa = Math.sin(a) * r; R.push([c[0] + e1[0] * ca + e2[0] * sa, c[1] + e1[1] * ca + e2[1] * sa, c[2] + e1[2] * ca + e2[2] * sa]); } return { c, R }; };
    const rings = prof.map(p => ring(p) || { c: [B[0] + ax[0] * p[1], B[1] + ax[1] * p[1], B[2] + ax[2] * p[1]], R: null });
    for (let k = 0; k + 1 < rings.length; k++) {
      const A = rings[k], Bn = rings[k + 1];
      for (let i = 0; i < n; i++) {
        const i1 = (i + 1) % n;
        if (!A.R && !Bn.R) continue;
        if (!A.R) { addTri(o, A.c, Bn.R[i1], Bn.R[i]); continue; }
        if (!Bn.R) { addTri(o, A.R[i], A.R[i1], Bn.c); continue; }
        addTri(o, A.R[i], A.R[i1], Bn.R[i1]); addTri(o, A.R[i], Bn.R[i1], Bn.R[i]);
      }
    }
    orient(o, from);
  }
  function openEdges(v) {
    const key = i => Math.round(v[i] * 1e4) + ',' + Math.round(v[i + 1] * 1e4) + ',' + Math.round(v[i + 2] * 1e4), E = new Map();
    for (let i = 0; i < v.length; i += 9) {
      const k = [key(i), key(i + 3), key(i + 6)];
      if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue;
      for (let e = 0; e < 3; e++) { const a = k[e], b = k[(e + 1) % 3], s = a < b ? a + '|' + b : b + '|' + a; E.set(s, (E.get(s) || 0) + (a < b ? 1 : -1)); }
    }
    let bad = 0; for (const x of E.values()) if (x !== 0) bad++;
    return bad;
  }

  // ---------- Stutzen: Teil A endet an Teil B (oder an der Rumpfinnenseite) ----------------------------
  const TRIM_A = ['haube', 'brett', 'wanne'];
  const ID_NAME = { haube: 'Pilz-Haube', brett: 'Brett', ringe: 'Zierringe', konsole: 'Konsole', saeule: 'Säule', wanne: 'Sitzwanne', rahmen: 'Haubenrahmen', knueppel: 'Knüppel', rumpf: 'Rumpf (Innenseite)' };
  // Punkt-im-Körper für ein geschlossenes Dreiecksnetz: Strahl in +X, Dreiecke nach (y, z) in ein Raster sortiert
  function solidTester(v) {
    const n = v.length / 9; if (!n) return () => false;
    let x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < v.length; i += 3) { x1 = Math.max(x1, v[i]); y0 = Math.min(y0, v[i + 1]); y1 = Math.max(y1, v[i + 1]); z0 = Math.min(z0, v[i + 2]); z1 = Math.max(z1, v[i + 2]); }
    const NB = clamp(Math.round(Math.sqrt(n / 3)), 4, 160), dy = (y1 - y0) / NB || 1, dz = (z1 - z0) / NB || 1;
    const cy = y => clamp(Math.floor((y - y0) / dy), 0, NB - 1), cz = z => clamp(Math.floor((z - z0) / dz), 0, NB - 1);
    // Raster als CSR (Zählen, Präfixsumme, Füllen) — schnell und ohne viele kleine Arrays
    const box = new Int32Array(n * 4), cnt = new Int32Array(NB * NB + 1);
    for (let t = 0, i = 0; t < n; t++, i += 9) {
      const a0 = cy(Math.min(v[i + 1], v[i + 4], v[i + 7])), a1 = cy(Math.max(v[i + 1], v[i + 4], v[i + 7])), b0 = cz(Math.min(v[i + 2], v[i + 5], v[i + 8])), b1 = cz(Math.max(v[i + 2], v[i + 5], v[i + 8]));
      box[t * 4] = a0; box[t * 4 + 1] = a1; box[t * 4 + 2] = b0; box[t * 4 + 3] = b1;
      for (let p = a0; p <= a1; p++) for (let q = b0; q <= b1; q++) cnt[p * NB + q + 1]++;
    }
    for (let k = 1; k <= NB * NB; k++) cnt[k] += cnt[k - 1];
    const fill = cnt.slice(0, NB * NB), list = new Int32Array(cnt[NB * NB]);
    for (let t = 0; t < n; t++) for (let p = box[t * 4]; p <= box[t * 4 + 1]; p++) for (let q = box[t * 4 + 2]; q <= box[t * 4 + 3]; q++) list[fill[p * NB + q]++] = t * 9;
    return P => {
      const y = P[1] + 1.37e-6, z = P[2] - 0.91e-6;
      if (P[0] > x1 || y < y0 || y > y1 || z < z0 || z > z1) return false;
      const cc = cy(y) * NB + cz(z), e = cnt[cc + 1];
      let k = 0;
      for (let m = cnt[cc]; m < e; m++) {
        const i = list[m], ay = v[i + 1], az = v[i + 2], by = v[i + 4] - ay, bz = v[i + 5] - az, cy = v[i + 7] - ay, cz = v[i + 8] - az, d = by * cz - cy * bz;
        if (Math.abs(d) < 1e-14) continue;
        const u = ((y - ay) * cz - cy * (z - az)) / d, w = (by * (z - az) - (y - ay) * bz) / d;
        if (u < 0 || w < 0 || u + w > 1) continue;
        if (v[i] + u * (v[i + 3] - v[i]) + w * (v[i + 6] - v[i]) > P[0]) k++;
      }
      return (k & 1) === 1;
    };
  }
  // „im Rumpf-Teil B" = außerhalb der Rumpfinnenseite (Abstand gap zur Außenhaut)
  function fusTester(F, gap) {
    return P => {
      const x = P[0], y = P[1]; if (x < F.x0 || x > F.x1) return true;
      if (y > F.top(x) - gap || y < F.bot(x) + gap) return true;
      const w = F.hw(x, y); return !(w > -Infinity) || Math.abs(P[2]) > w - gap;
    };
  }
  function resample3(P, n) {
    const L = [0]; for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]));
    const tot = L[L.length - 1], out = []; let k = 0;
    for (let i = 0; i <= n; i++) {
      const s = tot * i / n; while (k < P.length - 2 && L[k + 1] < s) k++;
      const d = L[k + 1] - L[k], t = d > 1e-12 ? (s - L[k]) / d : 0, a = P[k], b = P[Math.min(P.length - 1, k + 1)];
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
    return out;
  }
  // Brettumriss stutzen: Ergebnis = Umriss ohne B (Platte vorne/Mitte/hinten darf nicht in B liegen). Jedes überstehende
  // Stück des Umrisses wird durch die Kante von B zwischen Aus- und Wiedereintritt ersetzt (Konturverfolgung, B rechts);
  // gelingt das nicht, durch die Grenze des sternförmigen Bereichs um die Brettmitte (je Strahl bis zum ersten Treffer).
  // Früher wurde jeder Punkt einzeln radial zur Mitte zurückgezogen — bei Schultern/Einbuchtungen landeten benachbarte
  // Punkte an verschiedenen Kanten von B, das gab Zacken.
  function trimOutline(P, map, t, inside, warn) {
    let A = 0, cu = 0, cv = 0;
    for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length], cr = p[0] * q[1] - q[0] * p[1]; A += cr; cu += (p[0] + q[0]) * cr; cv += (p[1] + q[1]) * cr; }
    const c = Math.abs(A) > 1e-9 ? [cu / (3 * A), cv / (3 * A)] : P[0];
    const bad = q => inside(map(q[0], q[1], 0)) || inside(map(q[0], q[1], -t / 2)) || inside(map(q[0], q[1], -t));
    if (bad(c)) { warn.push(T('Stutzen: die Brettmitte liegt im begrenzenden Teil — Brett nicht gestutzt.')); return P; }
    // Umriss (gegen den Uhrzeigersinn) mit allen Eckpunkten, lange Strecken unterteilt (≤ 0,8 mm)
    const O = A < 0 ? P.slice().reverse() : P, D = []; let perim = 0;
    for (let i = 0; i < O.length; i++) { const a = O[i], b = O[(i + 1) % O.length], L = dist2(a, b), m = Math.max(1, Math.ceil(L / 0.8)); perim += L; for (let k = 0; k < m; k++) D.push(lerp2(a, b, k / m)); }
    const fl = D.map(bad), n = D.length, s0 = fl.indexOf(false);
    if (!fl.some(Boolean)) return P;
    if (s0 < 0) { warn.push(T('Stutzen: das Brett liegt ganz im begrenzenden Teil — nicht gestutzt.')); return P; }
    const TW = 2 * Math.PI, wrap = d => (d > Math.PI ? d - TW : d < -Math.PI ? d + TW : d);
    const inO = q => { let w = false; for (let i = 0, j = O.length - 1; i < O.length; j = i++) { const a = O[i], b = O[j]; if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < (b[0] - a[0]) * (q[1] - a[1]) / (b[1] - a[1]) + a[0]) w = !w; } return w; };
    // Kante von B von e nach x verfolgen (B rechts, Schritt dl); null, wenn sie den Umriss verlässt oder x nicht erreicht
    const trace = (e, x, dir) => {
      const dl = 0.5, NS = 36, path = [], maxN = Math.ceil(3 * perim / dl);
      let p = e, h = Math.atan2(dir[1], dir[0]);
      const at = a => [p[0] + dl * Math.cos(a), p[1] + dl * Math.sin(a)];
      for (let s = 0; s < maxN; s++) {
        if (s > 1 && dist2(p, x) < 2 * dl) return path;
        let ag = h + TW / 3, k = 0;
        if (bad(at(ag))) { for (k = 1; k <= NS && bad(at(ag + k * TW / NS)); k++); if (k > NS) return null; ag += k * TW / NS; }
        let ab = null; for (k = 1; k <= NS; k++) { const a = ag - k * TW / NS; if (bad(at(a))) { ab = a; break; } ag = a; }
        if (ab === null) return null;   // keine Kante mehr in Reichweite
        for (let it = 0; it < 10; it++) { const m = (ag + ab) / 2; if (bad(at(m))) ab = m; else ag = m; }
        p = at(ag); h = ag;
        if (!inO(p)) return null;
        if (s > 8 && dist2(p, e) < dl) return null;   // um B herum im Kreis
        path.push(p);
      }
      return null;
    };
    // Rückfall: sternförmiger Bereich um die Mitte (je Strahl bis zum ersten Treffer), nur bei Bedarf berechnet
    let Rm = 0; for (const q of D) Rm = Math.max(Rm, dist2(q, c)); Rm += 1;
    const NA = 360, rho = new Float64Array(NA).fill(-1);
    const ray = k => {
      if (rho[k] >= 0) return rho[k];
      const a = TW * k / NA, d = [Math.cos(a), Math.sin(a)], at = r => [c[0] + d[0] * r, c[1] + d[1] * r], st = 0.6;
      let r0 = 0, hit = -1;
      for (let r = st; r < Rm + st; r += st) { if (bad(at(r))) { hit = r; break; } r0 = r; }
      if (hit < 0) return (rho[k] = Rm);
      for (let it = 0; it < 16; it++) { const m = (r0 + hit) / 2; if (bad(at(m))) hit = m; else r0 = m; }
      return (rho[k] = r0);
    };
    const ang = q => Math.atan2(q[1] - c[1], q[0] - c[0]);
    const rhoAt = th => { const f = (((th / TW) % 1) + 1) % 1 * NA, k = Math.floor(f) % NA, w = f - Math.floor(f); return (1 - w) * ray(k) + w * ray((k + 1) % NA); };
    const starArc = (e, x, run) => {
      let sw = 0, pa = ang(e); for (const q of run.concat([x])) { const a = ang(q); sw += wrap(a - pa); pa = a; }
      const a0 = ang(e), m = Math.ceil(Math.abs(sw) / (TW / NA)), out = [];
      for (let k = 1; k < m; k++) { const a = a0 + sw * k / m, r = Math.min(rhoAt(a), dist2(lerp2(e, x, k / m), c) + Rm); out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
      return out;
    };
    const R = D.slice(s0).concat(D.slice(0, s0)), F = fl.slice(s0).concat(fl.slice(0, s0));
    const cross = (g, b) => { let lo = g, hi = b; for (let it = 0; it < 20; it++) { const m = lerp2(lo, hi, 0.5); if (bad(m)) hi = m; else lo = m; } return lo; };
    const res = [];
    for (let i = 0; i < n;) {
      if (!F[i]) { res.push(R[i]); i++; continue; }
      let j = i; while (j < n && F[j]) j++;
      const e = cross(R[i - 1], R[i]), x = cross(R[j % n], R[j - 1]);
      // fast kollineare Punkte der Verfolgung entfernen (sonst T-Stöße im Netz), Ecken bleiben
      res.push(...dpSimplify([e, ...(trace(e, x, sub2(R[i], R[i - 1])) || starArc(e, x, R.slice(i, j))), x], 0.01)); i = j;
    }
    const thin = []; for (const q of res) if (!thin.length || dist2(q, thin[thin.length - 1]) > 0.05) thin.push(q);   // fast doppelte Punkte (Netz!)
    while (thin.length > 3 && dist2(thin[0], thin[thin.length - 1]) <= 0.05) thin.pop();
    const out = cleanRing(thin);
    return A < 0 ? out.reverse() : out;
  }
  // Gitter Zeile für Zeile stutzen: je Zeile bleibt das zusammenhängende Stück um den Bezugspunkt refJ, das nicht in B liegt
  // (Grenze per Bisektion, dann wieder auf gleiche Punktzahl); Zeilen mit Bezugspunkt in B fallen weg (längster Block bleibt)
  // probe { t, refDir }: auch die aufgedickte Seite (Wandstärke) darf nicht in B liegen
  function trimGrid(G, refI, refJ, inside0, probe) {
    const J = G[0].length - 1, rows = [], refs = [];
    let inside = inside0;
    if (probe && probe.t > 0) {
      const N = gridNormals(G), nr = N[clamp(refI, 0, G.length - 1)][refJ] || [0, 1, 0], sg = (nr[0] * probe.refDir[0] + nr[1] * probe.refDir[1] + nr[2] * probe.refDir[2] >= 0 ? 1 : -1) * probe.t;
      let cur = null;   // Normale des gerade bearbeiteten Punkts (für Zwischenpunkte genähert)
      inside = q => { if (inside0(q)) return true; const n = q.n || cur; return !!n && (inside0([q[0] + sg * n[0], q[1] + sg * n[1], q[2] + sg * n[2]]) || inside0([q[0] + sg * n[0] / 2, q[1] + sg * n[1] / 2, q[2] + sg * n[2] / 2])); };
      G = G.map((row, i) => row.map((q, j) => { const r = q.slice(); r.n = N[i][j]; return r; }));
      const in1 = inside; inside = q => { if (q.n) cur = q.n; return in1(q); };
    }
    const mid = (a, b) => { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; if (a.n || b.n) m.n = a.n || b.n; return m; };
    // Grenze per Bisektion, dann um „back" zurück (Wandstärke an der Schnittkante, Normalen des fertigen Gitters weichen ab)
    const back = probe && probe.t > 0 ? 0.6 * probe.t + 0.2 : 0.1;
    const edge = (pIn, pOut) => {
      let lo = pOut, hi = pIn; for (let k = 0; k < 20; k++) { const m = mid(lo, hi); if (inside(m)) hi = m; else lo = m; }
      const d = [pOut[0] - lo[0], pOut[1] - lo[1], pOut[2] - lo[2]], L = Math.hypot(...d), f = L > 1e-9 ? Math.min(back, 0.9 * L) / L : 0;
      return [lo[0] + d[0] * f, lo[1] + d[1] * f, lo[2] + d[2] * f];
    };
    for (const row of G) {
      const fl = row.map(q => inside(q)), sm = row.map((q, j) => (j < J ? inside(mid(q, row[j + 1])) : false));
      if (fl[refJ]) { rows.push(null); refs.push(0); continue; }
      let a = refJ; while (a > 0 && !fl[a - 1] && !sm[a - 1]) a--;
      let b = refJ; while (b < J && !fl[b + 1] && !sm[b]) b++;
      if (a === 0 && b === J) { rows.push(row.map(q => [q[0], q[1], q[2]])); refs.push(refJ); continue; }
      const pts = []; if (a > 0) pts.push(edge(fl[a - 1] ? row[a - 1] : mid(row[a - 1], row[a]), row[a]));
      for (let k = a; k <= b; k++) pts.push([row[k][0], row[k][1], row[k][2]]);
      if (b < J) pts.push(edge(fl[b + 1] ? row[b + 1] : mid(row[b], row[b + 1]), row[b]));
      rows.push(resample3(pts, J)); refs.push(clamp(Math.round((refJ - a + (a > 0 ? 1 : 0)) / Math.max(1, pts.length - 1) * J), 0, J));
    }
    let best = [0, -1], i0 = -1;
    for (let i = 0; i <= rows.length; i++) {
      if (i < rows.length && rows[i]) { if (i0 < 0) i0 = i; }
      else if (i0 >= 0) { const len = i - i0, bl = best[1] - best[0] + 1, hit = refI >= i0 && refI < i; if (len > bl || (hit && len >= bl)) best = [i0, i - 1]; i0 = -1; }
    }
    if (best[1] < best[0]) return { G: [], ref: [0, 0] };
    const ri = clamp(refI, best[0], best[1]);
    return { G: rows.slice(best[0], best[1] + 1), ref: [ri - best[0], refs[ri]] };
  }

  // ---------- Bauteile -----------------------------------------------------------------------------------
  function frame(p) {
    const s = Math.sin(p.tiltR), c = Math.cos(p.tiltR), O = [p.x, p.yB, 0];
    const eu = [0, 0, -1], ev = [-s, c, 0], ew = [c, s, 0];
    const map = (u, v, w) => [O[0] + u * eu[0] + v * ev[0] + w * ew[0], O[1] + u * eu[1] + v * ev[1] + w * ew[1], O[2] + u * eu[2] + v * ev[2] + w * ew[2]];
    return { map, eu, ev, ew, O };
  }
  function buildPilz(R, outline, warn, trim) {
    const p = R.pz, fr = frame(p), c = cfg(), items = [];
    // Brett (Platte) + Zierringe
    const pOut = trim && trim.brett ? trimOutline(outline, fr.map, p.t, trim.brett, warn) : outline;
    const ok = checkInst(instList(c, R), R.scale, pOut, warn), mode = c.inst.mode;
    const holes = mode === 'flat' ? [] : ok.map(o => instPoly(o.it, R.scale, 0, 48));
    const rec = mode === 'hole' ? p.t : clamp(+c.inst.rec || 0, 0.1, p.t - 0.2);
    const vb = []; plateSolid(vb, pOut, holes, fr.map, p.t, rec);
    items.push({ id: 'brett', part: 'brett', tag: 1, v: vb });
    const bez = Math.max(0, +c.inst.bez || 0), bh = Math.max(0, +c.inst.bezH || 0);
    if (bez > 0.05 && bh > 0.05) {
      const vr = [];
      for (const o of ok) extrude(vr, [instPoly(o.it, R.scale, bez, 48), instPoly(o.it, R.scale, 0, 48)], fr.map, -0.05, bh);
      if (vr.length) items.push({ id: 'ringe', part: 'brett', tag: 2, v: vr });
    }
    // Konsole (Pilzform): Kasten hinter dem schmalen Unterteil, nach vorne
    if (p.isPilz && p.consD > 0.2) {
      const vk = []; extrude(vk, [rrectPoly(0, p.stemH / 2, p.stemW, p.stemH, Math.min(+p.rcB || 0, p.stemW / 3), 4)], fr.map, -p.t - p.consD, -p.t + 0.05);
      items.push({ id: 'konsole', part: 'brett', tag: 1, v: vk });
    }
    // Haube (Pilz) — am Haubenrahmen gerade senkrecht zum Brett, am Rahmen gestutzt
    if (p.hood && p.straight) {
      const ins = c.exp.sep ? Math.max(0, +p.play || 0) : -Math.min(0.3, p.wall / 3);
      const sh = straightHood(R, outline, ins, warn);
      if (sh) {
        let G = sh.G, ref = sh.ref;
        if (trim && trim.haube && G.length > 1) { const tg = trimGrid(G, ref[0], ref[1], trim.haube, { t: p.wall, refDir: fr.ev }); G = tg.G; ref = tg.ref; if (G.length < 2) warn.push(T('Stutzen: von der Pilz-Haube bleibt nichts übrig.')); }
        if (G.length > 1) { const vh = []; thicken(vh, G, p.wall, ref[0], ref[1], fr.ev); items.push({ id: 'haube', part: 'rahmen', tag: 0, v: vh }); }
        if (sh.lid && sh.lid.length) items.push({ id: 'haube', part: 'rahmen', tag: 6, v: sh.lid });   // Deckel auf der vorderen Rahmenschräge
      }
    } else if (p.hood && p.depth > 0.5) {
      const S = []; if (p.lip > 0.05) S.push(-p.lip / p.depth);
      const NA = 96, fit = p.mount === 'frame' && p.merge, NS = fit ? 0 : 36; for (let i = 0; i <= NS; i++) S.push(NS ? i / NS : 0);
      const ins = c.exp.sep ? Math.max(0, +p.play || 0) : -Math.min(0.3, p.wall / 3);
      let G = [], lastA2 = null;
      for (const s of S) {
        const g = Math.pow(Math.max(0, s), p.curve), cheek = p.mount === 'free' ? 0 : (+p.cheek0 || 0) + ((+p.cheek1 || 0) - (+p.cheek0 || 0)) * Math.max(0, s);
        const L = clamp((p.isPilz ? p.stemH + 0.3 : 0) + cheek + p.drop * g, 0.01, p.h - 1);
        const A = archAt(outline, L, NA); if (!A) { warn.push(T('Pilz: Wange höher als das Brett — Haube ausgelassen.')); G.length = 0; break; }
        const k = 1 - p.narrow / (p.wT / 2) * g, dx = -s * p.depth, A2 = offsetOpen(A, ins).map(([u, v]) => [u * k, v - p.drop * g]);
        G.push(A2.map(([u, v]) => { const q = fr.map(u, v, 0); return [q[0] + dx, q[1], q[2]]; })); lastA2 = A2;
      }
      // freistehend: Boden je Zeile zwischen den Wangen + ebener Deckel vorne -> geschlossener Kopf auf der Säule
      if (p.mount === 'free' && G.length > 1 && lastA2) {
        const B = G.map(row => resample3([row[0], row[row.length - 1]], 24)), vB = [];
        thicken(vB, B, p.wall, B.length >> 1, 12, fr.ev); items.push({ id: 'haube', part: 'pilz', tag: 0, v: vB });
        const vF = [], map2 = (u, v, w) => { const q = fr.map(u, v, w); return [q[0] - p.depth, q[1], q[2]]; };
        extrude(vF, [lastA2], map2, -p.wall, 0); items.push({ id: 'haube', part: 'pilz', tag: 0, v: vF });
      }
      // am Haubenrahmen verschmolzen: Haube läuft tangential bis in den vorderen Rahmenbogen
      if (fit && G.length) {
        const ext = fitHood(G[G.length - 1], R, warn); if (ext && ext.length) G = G.concat(ext);
        const cv = ext && ext.cover;   // Haubenrahmen über dem Pilz geschlossen
        if (cv) {
          const vd = []; thicken(vd, cv.G, p.wall, 0, cv.G[0].length >> 1, fr.ev); items.push({ id: 'haube', part: 'rahmen', tag: 6, v: vd });
          if (cv.wallPoly) { const vw = []; extrude(vw, [cv.wallPoly], (a, b, w) => [cv.xr + w, b, a], -p.wall, 0); items.push({ id: 'haube', part: 'rahmen', tag: 6, v: vw }); }
        }
      }
      let ref = [Math.max(0, S.indexOf(0)), NA >> 1];
      if (trim && trim.haube && G.length > 1) { const tg = trimGrid(G, ref[0], NA >> 1, trim.haube, { t: p.wall, refDir: fr.ev }); G = tg.G; ref = tg.ref; if (G.length < 2) warn.push(T('Stutzen: von der Pilz-Haube bleibt nichts übrig.')); }
      if (G.length > 1) { const vh = []; thicken(vh, G, p.wall, ref[0], ref[1], fr.ev); items.push({ id: 'haube', part: p.mount === 'frame' ? 'rahmen' : 'pilz', tag: 0, v: vh }); }
    }
    // Säule (Pilzfuß)
    if (p.col) {
      const xc = p.x - p.colX, yTop = p.yB + 0.45 * p.h * Math.cos(p.tiltR);
      if (p.colY < yTop - 2) {
        const vc = [], map = (a, b, w) => [xc + a, w, b];
        extrude(vc, [rrectPoly(0, 0, Math.max(1, +p.colD || 1), Math.max(1, +p.colW || 1), Math.min(+p.colD || 1, +p.colW || 1) * 0.3, 4)], map, p.colY, yTop);
        items.push({ id: 'saeule', part: 'pilz', tag: 0, v: vc });
      } else warn.push(T('Säule: Unterkante liegt über dem Pilz — ausgelassen.'));
    }
    return { items, ok, pOut };
  }
  /* Pilz am Haubenrahmen, gerade (Standard): der Bogen über der Brettoberkante läuft als gerades Prisma senkrecht zum
   * Brett nach vorne (Richtung um hoodA in der Seitenansicht geneigt). Jede Mantellinie endet am ersten Hindernis:
   * - Rumpfhaut minus Haubenstärke + Wand (Innenseite G; nach dem Aufdicken liegt die Außenseite bündig mit der
   *   Rahmen-Außenseite bzw. unter der Kabinenhaube),
   * - Ebene durch die Mitte des vorderen Rahmens: senkrecht zur Seitenansicht durch die Verlängerung der vorderen
   *   schrägen Schnittlinie (Tangente am unteren Ende ihres geraden Teils) — gilt also auch unterhalb des Rahmens,
   * - ggf. die nach vorne ansteigende Wangen-Unterkante (cheek0 -> cheek1 über die Länge in der Mitte).
   * Gitter: Spalten = Mantellinien (Brettbogen, NA+1 Punkte), Zeilen = gleiche Anteile der jeweiligen Länge
   * -> { G, ref } | null */
  function straightHood(R, outline, ins, warn) {
    const F = R.F, p = R.pz, can = F && F.can, frA = can && can.frame, fr = frame(p);
    if (!can || !Array.isArray(can.line) || can.line.length < 2 || !frA || typeof can.sd !== 'function') { warn.push(T('Pilz am Haubenrahmen: im Rumpf (Gruppe „Kabinenhaube") den Haubenrahmen einschalten — Pilz-Haube ausgelassen.')); return null; }
    // vordere Schnittlinie: vom vorderen Ende, solange sie gerade läuft (Richtung weicht < 3° vom ersten Abschnitt ab;
    // je Abschnitt vergleichen reicht nicht — der fein unterteilte Radius knickt je Abschnitt nur wenig) -> Tangente am Ende
    let N = can.line; if (N[0][0] > N[N.length - 1][0]) N = N.slice().reverse();
    let de = null, d0 = null, k = 1;
    for (; k < N.length; k++) {
      const dx = N[k][0] - N[k - 1][0], dy = N[k][1] - N[k - 1][1], L = Math.hypot(dx, dy); if (L < 1e-9) continue;
      const d = [dx / L, dy / L]; if (!d0) d0 = d; else if (d0[0] * d[0] + d0[1] * d[1] < Math.cos(3 * D2R)) break; de = d;
    }
    if (!de) { warn.push(T('Pilz am Haubenrahmen: vordere Schnittlinie der Kabinenhaube nicht gefunden.')); return null; }
    const Pe = N[k - 1], Pm = lerp2(N[0], Pe, 0.5);
    let nL = [-de[1], de[0]]; if (can.sd(Pm[0] + nL[0], Pm[1] + nL[1]) < can.sd(Pm[0] - nL[0], Pm[1] - nL[1])) nL = [-nL[0], -nL[1]];   // in die Haube
    const s0 = typeof frA.s0 === 'function' ? frA.s0() || 0 : 0;
    // Stutzebene: Rahmenmitte; mit Deckel liegt dessen Rückseite um lidD unter der Rahmenoberseite (sd = h, zum Cockpit hin)
    const sdM = p.lid ? Math.max(s0 + p.wall / 2, frA.h - p.lidD - p.wall / 2) : (s0 + frA.h) / 2;
    const plane = q => (q[0] - Pe[0]) * nL[0] + (q[1] - Pe[1]) * nL[1] - sdM;   // < 0 = vor der Rahmenmitte
    const hw = p.lid ? p.wall / 2 : 0;   // Deckel: Platte zwischen plane = +hw (hinten) und −hw (vorne)
    // Abstand zur Rumpfhaut im Spant (+ = innen), zwischen den Spanten (Raster 0,25 mm) linear gemittelt
    const dIn = frA.glass + p.wall + 0.02;
    const secD = (xk, y, z) => {
      const H = F.half(xk); if (!H || H.length < 2) return -1e9;
      let d2 = Infinity, inside = false;
      for (let i = 0, n = H.length; i < n; i++) {
        const a = H[i], b = H[(i + 1) % n];
        if ((a[1] > z) !== (b[1] > z) && y < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        if (i + 1 < n) { const dy = b[0] - a[0], dz = b[1] - a[1], l2 = dy * dy + dz * dz, t = l2 > 0 ? clamp(((y - a[0]) * dy + (z - a[1]) * dz) / l2, 0, 1) : 0, ey = a[0] + t * dy - y, ez = a[1] + t * dz - z; d2 = Math.min(d2, ey * ey + ez * ez); }
      }
      return inside ? Math.sqrt(d2) : -Math.sqrt(d2);
    };
    const skin = q => { const f = q[0] * 4, a = Math.floor(f) / 4, w = f - Math.floor(f), az = Math.abs(q[2]); return (1 - w) * secD(a, q[1], az) + w * secD(a + 0.25, q[1], az); };
    const xLo = Math.max(F.x0, can.x0 - 60);
    const badB = (q, e) => q[0] < xLo || q[0] > F.x1 || plane(q) < (e || 0) || skin(q) < dIn;
    // Brettbogen (Innenseite) und Richtung
    const L0 = clamp((p.isPilz ? p.stemH + 0.3 : 0) + (+p.cheek0 || 0), 0.01, p.h - 1), NA = 96;
    const A = archAt(outline, L0, NA); if (!A) { warn.push(T('Pilz: Wange höher als das Brett — Haube ausgelassen.')); return null; }
    const A2 = offsetOpen(A, ins), ang = p.tiltR - p.hoodA, dir = [-Math.cos(ang), -Math.sin(ang), 0], sA = Math.sin(p.hoodA);
    const base = A2.map(([u, v]) => fr.map(u, v, 0));
    let vMin = Infinity; for (const q of A2) vMin = Math.min(vMin, q[1]);
    const jc = NA >> 1, S0 = [base[jc][0], base[jc][1] + p.wall];   // Oberseite des Pilzes in der Mitte am Brett
    // Verlauf: Gerade im Winkel (t = Länge entlang dir) oder gezeichnete Linie der Seitenansicht (t = Weg nach vorne in X;
    // der Brettbogen wird ohne Drehung entlang der Linie verschoben, erster Punkt sitzt fest an der Brettoberkante)
    let at = (P, t) => [P[0] + dir[0] * t, P[1] + dir[1] * t, P[2] + dir[2] * t], rise = t => t * sA;
    if (p.runLine) {
      const pts = cfg().pz.runL.pts; pts[0].x = Math.round(S0[0] * 10) / 10; pts[0].y = Math.round(S0[1] * 10) / 10;
      const C = topCurve(pts);
      if (C) {
        const Y = x => curveYX(C, x), y0 = Y(S0[0]), tn = Math.tan(p.tiltR), cs = Math.cos(p.tiltR);
        at = (P, t) => [P[0] - t, P[1] + Y(S0[0] - t) - y0, P[2]];
        rise = t => (Y(S0[0] - t) - y0 + t * tn) * cs;   // Anstieg gegenüber senkrecht zum Brett
      }
    }
    const TMAX = 3 * (F.x1 - F.x0) + 100;
    const endT = (P, bad) => {
      if (bad(P, 0)) return 0;
      let lo = 0, hi = -1;
      for (let t = 1; t <= TMAX; t += 1) { if (bad(at(P, t), t)) { hi = t; break; } lo = t; }
      if (hi < 0) return TMAX;
      for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (bad(at(P, m), m)) hi = m; else lo = m; }
      return lo;
    };
    const Tref = endT(base[jc], q => badB(q));
    if (!(Tref > 1)) { warn.push(T('Pilz am Haubenrahmen: das Brett liegt schon am bzw. vor dem vorderen Rahmen — Pilz-Haube ausgelassen.')); return null; }
    if (Tref >= TMAX) { warn.push(T('Pilz am Haubenrahmen: die Haube trifft vorne weder Rahmen noch Rumpf — Neigung prüfen.')); return null; }
    const kC = Math.max(0, (+p.cheek1 || 0) - (+p.cheek0 || 0)) / Tref;   // Wangen-Unterkante steigt nach vorne
    R.runDef = { S0, dir: [dir[0], dir[1]], len: Tref };   // Vorgabe für die gezeichnete Linie
    // Richtung am vorderen Ende (Mitte): für Deckel-Normalen und -Schnitt
    const dirE = (() => { const a = at(base[jc], Math.max(0, Tref - 0.5)), b = at(base[jc], Tref + 0.5), l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l]; })();
    // mit Deckel endet jede Mantellinie IN der Platte: Innenseite so weit, dass auch die Außenkante (um wall entlang der
    // Flächennormalen versetzt, Anteil c in Richtung nL) zwischen den beiden Plattenseiten liegt
    const eIn = base.map(() => 0);
    if (hw) {
      const a = base[jc - 1], b = base[jc + 1], tg = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const n = [dirE[1] * tg[2] - dirE[2] * tg[1], dirE[2] * tg[0] - dirE[0] * tg[2], dirE[0] * tg[1] - dirE[1] * tg[0]];
      const sg = n[0] * fr.ev[0] + n[1] * fr.ev[1] + n[2] * fr.ev[2] >= 0 ? 1 : -1;
      for (let j = 0; j < eIn.length; j++) {
        const a2 = base[Math.max(0, j - 1)], b2 = base[Math.min(base.length - 1, j + 1)], t2 = [b2[0] - a2[0], b2[1] - a2[1], b2[2] - a2[2]];
        const m = [dirE[1] * t2[2] - dirE[2] * t2[1], dirE[2] * t2[0] - dirE[0] * t2[2], dirE[0] * t2[1] - dirE[1] * t2[0]], lm = Math.hypot(m[0], m[1], m[2]) || 1;
        const cj = sg * (m[0] * nL[0] + m[1] * nL[1]) / lm;
        eIn[j] = cj >= 0 ? -hw : hw;
      }
    }
    const tE = base.map((P, j) => Math.max(0.5, endT(P, (q, t) => badB(q, eIn[j]) || (kC > 0 && A2[j][1] - vMin + rise(t) < kC * t - 1e-6))));
    let tMax = 0; for (const t of tE) tMax = Math.max(tMax, t);
    const K = clamp(Math.ceil(tMax / 1.2), 6, 300), G = [];
    if (p.lip > 0.05) G.push(base.map(P => at(P, -p.lip)));
    for (let i = 0; i <= K; i++) G.push(base.map((P, j) => at(P, tE[j] * i / K)));
    // Schnittebene zur Anzeige (Mittelebene): Verlängerung der vorderen Linie, um sdM in die Haube versetzt
    const o0 = [Pe[0] + nL[0] * sdM, Pe[1] + nL[1] * sdM];
    R.trimLine = [[o0[0] - 40 * de[0], o0[1] - 40 * de[1]], [o0[0] + 60 * de[0], o0[1] + 60 * de[1]]];
    return { G, ref: [p.lip > 0.05 ? 1 : 0, jc], lid: hw ? lidGrid() : null };
    /* Deckel auf der vorderen Rahmenschräge: Platte in der Stutzebene (Dicke wall, mittig auf der Rahmenmitte), je
     * Mantellinie von der Pilz-Innenseite (Schnitt der Innenfläche mit der jeweiligen Plattenseite — der Pilz stutzt
     * den Deckel, innen steht nichts über) in der Ebene nach oben bis unter die Kabinenhaube (Rumpfhaut − Haubenstärke).
     * Nur Spalten, die an der Ebene enden (nicht an der Rumpfhaut), zusammenhängend um die Mitte. -> Körper | null */
    function lidGrid() {
      if (Math.abs(dirE[0] * nL[0] + dirE[1] * nL[1]) < 0.05) return null;   // Pilz läuft fast parallel zur Ebene
      const crossT = (P, e) => {   // Innenlinie ∩ Plattenseite plane = e
        if (plane(P) <= e) return 0;
        let lo = 0, hi = -1; for (let t = 1; t <= TMAX; t += 1) { if (plane(at(P, t)) <= e) { hi = t; break; } lo = t; }
        if (hi < 0) return lo;
        for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (plane(at(P, m)) <= e) hi = m; else lo = m; }
        return (lo + hi) / 2;
      };
      let ue = de[1] >= 0 ? de : [-de[0], -de[1]]; const u3 = [ue[0], ue[1], 0], dLid = frA.glass + 0.02;
      const atU = (P, s) => [P[0] + u3[0] * s, P[1] + u3[1] * s, P[2]];
      const badU = q => q[0] < xLo || q[0] > F.x1 || skin(q) < dLid;
      const upLen = (P, mp) => {
        const Q = s => mp(atU(P, s));
        if (badU(Q(0))) return 0;
        let lo = 0, hi = -1; for (let s = 0.5; s <= TMAX; s += 0.5) { if (badU(Q(s))) { hi = s; break; } lo = s; }
        if (hi < 0) return 0;
        for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (badU(Q(m))) hi = m; else lo = m; }
        return lo;
      };
      const onPlane = j => Math.abs(plane(at(base[j], tE[j])) - eIn[j]) < 0.05;
      if (!onPlane(jc)) return null;
      let ja = jc, jb = jc; while (ja > 0 && onPlane(ja - 1)) ja--; while (jb < base.length - 1 && onPlane(jb + 1)) jb++;
      if (jb - ja < 2) return null;
      // Rückseite bündig mit der Rahmenoberseite: dort, wo die Schnittlinie schon in den Radius übergeht, liegt die
      // Rahmenoberseite (sd = h − lidD in der Seitenansicht) hinter der Ebene -> Punkte entlang nL bis dorthin schieben (nie nach vorne)
      const sdT = frA.h - p.lidD;
      const toIso = q => { for (let it = 0; it < 3; it++) { const g = sdT - can.sd(q[0], q[1]); if (!(g > 1e-4)) break; q = [q[0] + nL[0] * g, q[1] + nL[1] * g, q[2]]; } return q; };
      const KL = 20, side = (e, iso) => {   // Gitter auf der Plattenseite plane = e
        const rows = []; for (let k = 0; k <= KL; k++) rows.push([]);
        for (let j = ja; j <= jb; j++) {
          const P = base[j], L = at(P, crossT(P, e)), mp = iso ? toIso : q => q, s = upLen(L, mp);
          for (let k = 0; k <= KL; k++) rows[k].push(mp(atU(L, s * k / KL)));
        }
        return rows;
      };
      const Pb = side(hw, sdM + hw >= sdT - 1e-6), Pf = side(-hw);
      let any = false; for (let j = 0; j < Pb[0].length; j++) if (Math.hypot(Pb[KL][j][0] - Pb[0][j][0], Pb[KL][j][1] - Pb[0][j][1]) > 0.2) { any = true; break; }
      if (!any) return null;
      const v = []; slabGrid(v, Pb, Pf); return v;
    }
  }
  /* Pilz am Haubenrahmen, angeschmiegt (wie ASG 29 / Vorbildfotos): die Haube beginnt hinten am Brettbogen (Zeilen
   * G bis s = 0), steigt über die Übergangslänge zur Haubenfläche auf und läuft dann genau unter der Kabinenhaube —
   * Rumpfhaut um Haubenstärke + Wand nach innen (Oberseite nach dem Aufdicken = Außenseite des Rahmens) — über die
   * ganze Haubenbreite bis in den Haubenrahmen (seitlich und vorne bis zur Rahmenmitte). Ersetzt die Zeilen ab s > 0.
   * Liefert die neuen Zeilen (gleiche Punktzahl) oder null. */
  function fitHood(row0, R, warn) {
    const F = R.F, p = R.pz, can = F && F.can, fr = can && can.frame;
    if (!can || typeof can.sd !== 'function' || !fr) { warn.push(T('Pilz am Haubenrahmen: im Rumpf (Gruppe „Kabinenhaube") den Haubenrahmen einschalten — Übergang ausgelassen.')); return null; }
    const lim = p.topY, rT = p.topR, s0 = typeof fr.s0 === 'function' ? fr.s0() || 0 : 0, sdT = (s0 + fr.h) / 2, dIn = fr.glass + p.wall + 0.02, M = row0.length;   // 0,02 mm unter der Rahmenaußenseite (keine deckungsgleichen Flächen)
    // Querschnitt bei x: Rumpfhaut mit sd >= sdT, um dIn nach innen, von +z über die Mitte nach −z, M Punkte (oder null)
    const memo = new Map(), memoO = new Map();
    // Haubenfläche bei x (unbegrenzt): Rumpfhaut mit sd >= sdT um dIn nach innen, [y, z] von der Mitte oben zur Seite
    const offAt = x => {
      const key = Math.round(x * 20); if (memoO.has(key)) return memoO.get(key);
      const r = offRaw(x); memoO.set(key, r); return r;
    };
    const offRaw = x => {
      let H = (F.half(x) || []).slice(); if (H.length < 2) return null;
      if (H[0][0] < H[H.length - 1][0]) H.reverse();   // oben -> unten
      const sd = q => can.sd(x, q[0]);
      if (sd(H[0]) < sdT) return null;
      const pts = [H[0]];
      for (let i = 1; i < H.length; i++) {
        const a = H[i - 1], b = H[i], da = sd(a), db = sd(b);
        if (db >= sdT) { pts.push(b); continue; }
        const t = da - db > 1e-12 ? (da - sdT) / (da - db) : 0; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); break;
      }
      if (pts.length < 2) return null;
      return pts.map((q, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dy = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dy, dz) || 1;
        return [q[0] - dIn * dz / L, i === 0 ? 0 : Math.max(0, q[1] + dIn * dy / L)];
      });
    };
    const section = x => {
      const key = Math.round(x * 20); if (memo.has(key)) return memo.get(key);
      const o0 = offAt(x); if (!o0) { memo.set(key, null); return null; }
      const off = o0.map(q => q.slice());
      if (lim) {   // Oberkante: Seiten bis zur Linie an der Haubenfläche, darüber weich abgeflacht (tanh, Höhe höchstens = Linie)
        const yl = lim(x) - p.wall, y0 = yl - rT, e = off[off.length - 1];   // Innenseite: Außenseite nach dem Aufdicken = Linie
        if (e[0] > yl - 0.5) { memo.set(key, null); return null; }   // hier liegt der Rahmen ganz über der Linie: Pilz endet
        // bis zur Innenkante des Haubenrahmens (sd <= fr.h) bleibt der Pilz bündig auf Haubenhöhe, erst innerhalb fällt er
        // über eine gerade Fase (linear im Abstand zur Schnittlinie) auf die abgeflachte Höhe — nicht im Rahmen versenkt
        for (const q of off) {
          if (!(q[0] > y0)) continue;
          const yf = y0 + rT * Math.tanh((q[0] - y0) / rT), dy = q[0] - yf, w = clamp((can.sd(x, q[0]) - fr.h) / Math.max(1.5, 1.5 * dy), 0, 1);
          q[0] -= dy * w;
        }
      }
      const full = off.slice().reverse().concat(off.slice(1).map(q => [q[0], -q[1]]));   // +z ... Mitte ... −z
      const r = resampleOpen(full, M - 1).map(q => [x, q[0], q[1]]);
      memo.set(key, r); return r;
    };
    const flip = row0[0][2] < row0[M - 1][2], sec = x => { const s = section(x); return s && flip ? s.slice().reverse() : s; };
    // vorderes Ende: Haubenfläche reicht in der Mitte nur bis sd = sdT
    const xMid = row0[M >> 1][0], xs0 = Math.max(F.x0, can.x0);
    if (!sec(xMid - 0.5)) { warn.push(lim ? T('Pilz am Haubenrahmen: die Oberkante liegt am Brett schon über dem Haubenrahmen bzw. unter dem Ausschnitt — Linie prüfen.') : T('Pilz am Haubenrahmen: das Brett liegt vor dem Haubenausschnitt — Übergang ausgelassen.')); return null; }
    let lo = xs0, hi = xMid - 0.5;
    if (sec(lo)) hi = lo; else for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (sec(m)) hi = m; else lo = m; }
    const xEnd = hi, room = xMid - xEnd;
    if (!(room > 2)) { warn.push(T('Pilz am Haubenrahmen: kein Platz zwischen Brett und vorderem Rahmen — Übergang ausgelassen.')); return null; }
    const Lb = clamp(p.mergeLen, 1, 0.85 * room), NB = 16, rows = [], x1 = xMid - Lb;
    // Eigener Querschnitt in der Ebene X = x1 (Pilz trifft hier auf die Haubenfläche/den Rahmen): Abweichung zum
    // Standardquerschnitt je Bogenlängen-Anteil (Mitte -> Seite), wirkt voll im Übergang, läuft nach vorne aus.
    const nh = M >> 1, S1 = sec(x1), def1 = S1 ? S1.slice(nh).map(q => [Math.abs(q[2]), q[1]]) : null;   // Halbquerschnitt Mitte -> Seite (symmetrisch)
    let dlt = null; const sc = p.sec;
    if (def1 && sc && sc.on && Array.isArray(sc.pts) && sc.pts.length >= 2) {
      const Q = sc.pts.map(q => ({ x: +q.x, y: +q.y, t: q.t })); Q[0].x = 0; Q[Q.length - 1].x = def1[nh][0]; Q[Q.length - 1].y = def1[nh][1];
      const C = topCurve(Q, { t0: [1, 0] }); if (C) { const cu = resampleOpen(C, nh); dlt = cu.map((q, j) => [q[1] - def1[j][1], q[0] - def1[j][0]]); dlt[nh] = [0, 0]; dlt[0][1] = 0; }
    }
    R.secInfo = def1 ? { x: x1, def: def1, active: !!dlt } : null;
    const secD = (x, wgt) => {
      const S = sec(x); if (!S || !dlt) return S;
      const w = wgt != null ? wgt : x >= x1 ? 1 : (() => { const t = clamp((x - xEnd) / Math.max(1e-6, x1 - xEnd), 0, 1); return t * t * (3 - 2 * t); })();
      if (!(w > 0)) return S;
      return S.map((q, j) => { const k = Math.abs(j - nh), sg = q[2] < 0 ? -1 : q[2] > 0 ? 1 : 0, d = dlt[k]; return [q[0], q[1] + d[0] * w, k === 0 ? 0 : Math.max(0, Math.abs(q[2]) + d[1] * w) * (sg || 1)]; });
    };
    for (let k = 1; k <= NB; k++) {   // Übergang Brettbogen -> Haubenfläche, tangential an die Haubenfläche
      const s = k / NB, w = 1 - Math.pow(1 - s, Math.max(1.2, p.curve)), xt = xMid - s * Lb, S = secD(xt); if (!S) break;
      rows.push(row0.map((P, j) => [P[0] - s * Lb + (S[j][0] - (P[0] - s * Lb)) * w, P[1] + (S[j][1] - P[1]) * w, P[2] + (S[j][2] - P[2]) * w]));
    }
    const n2 = Math.max(2, Math.ceil((x1 - xEnd) / 2.5));
    for (let k = 1; k <= n2; k++) { const S = secD(x1 - (x1 - xEnd) * k / n2); if (S) rows.push(S); }
    // vorne schließen: letzte Zeile auf ihren Mittelpunkt zusammenziehen
    const last = rows[rows.length - 1]; if (last && !lim) { const c = last[M >> 1]; rows.push(last.map(() => [c[0] - 0.3, c[1], 0])); }
    if (lim && p.topClose) rows.cover = coverHood(x1);
    return rows;
    /* Haubenrahmen über dem Pilz verschließen (Pilz endet oben an der Linie): Deckel auf Höhe der Haubenfläche — der
     * Teil des Querschnitts oberhalb des Abflachungsbeginns y0 — vom vorderen Rahmen bis xr (dort ist der Pilz voll
     * aufgestiegen). Hinten keine senkrechte Stirnwand: die Deckelfläche läuft als Verlängerung des Rahmens über die
     * Länge Lf als gerade Rampe (linear) auf den Pilzrücken (wie gebaut: secD) und liegt bei xr genau auf ihm. */
    function coverHood(xr) {
      const MC = 65, y0At = x => lim(x) - p.wall - rT;
      const half = x => {   // [y, z] von der Mitte oben bis y0 (bzw. bis zum Ende der Haubenfläche)
        const off = offAt(x), y0 = y0At(x); if (!off || !(off[0][0] > y0 + 0.05)) return null;
        const H = [off[0]];
        for (let i = 1; i < off.length; i++) {
          const a = off[i - 1], b = off[i]; if (b[0] >= y0) { H.push(b); continue; }
          const t = (a[0] - y0) / ((a[0] - b[0]) || 1); H.push([y0, a[1] + (b[1] - a[1]) * t]); break;
        }
        return H.length > 1 ? H : null;
      };
      const backAt = (x, z) => {   // Innenseite des Pilzrückens bei (x, |z|), so wie der Pilz gebaut wird
        const S = secD(x); if (!S) return null; const az = Math.abs(z);
        for (let j = nh; j + 1 < M; j++) { const a = S[j], b = S[j + 1], za = Math.abs(a[2]), zb = Math.abs(b[2]); if ((za - az) * (zb - az) <= 0 && za !== zb) return a[1] + (b[1] - a[1]) * (az - za) / (zb - za); }
        return null;
      };
      let Lf = 0;
      const rowAt = x => {
        const H = half(x); if (!H) return null;
        const ws = Lf > 0 ? clamp((x - (xr - Lf)) / Lf, 0, 1) : 0;   // gerade Rampe auf den Pilzrücken
        const Hd = ws > 0 ? H.map(q => { const yb = backAt(x, q[1]); return [yb != null ? q[0] - (q[0] - yb) * ws : q[0], q[1]]; }) : H;
        const full = Hd.slice().reverse().concat(Hd.slice(1).map(q => [q[0], -q[1]]));
        return resampleOpen(full, MC - 1).map(q => [x, q[0], q[1]]);
      };
      const Hr = half(xr); if (!Hr) return null;
      let lo = xs0, hi = xr;
      if (half(lo)) hi = lo; else for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (half(m)) hi = m; else lo = m; }
      const xF = hi, ybr = backAt(xr, 0), gap = ybr != null ? Hr[0][0] - ybr : 3;
      Lf = clamp(1.5 * gap, Math.min(3, 0.6 * (xr - xF)), 0.7 * (xr - xF));
      const nC = Math.max(4, Math.ceil((xr - xF) / 1.5)), G = [];
      for (let k = 0; k <= nC; k++) { const r = rowAt(xr - (xr - xF) * k / nC); if (r) G.push(r); }
      if (G.length < 2) return null;
      const lc = G[G.length - 1], cc = lc[MC >> 1]; G.push(lc.map(() => [cc[0] - 0.3, cc[1], 0]));   // vorne auf einen Punkt
      return { G, wallPoly: null, xr };
    }
  }
  // Haubenrahmen: kommt fertig aus dem Rumpf (Gruppe „Kabinenhaube" → Haubenrahmen) — liegt in der Sicke des
  // Rumpfs, außen um die Haubenstärke unter der Rumpfhaut; beide Hälften, geschlossener Körper
  function buildFrame(R, F, warn) {
    const can = F.can;
    if (!can || !Array.isArray(can.line) || can.line.length < 2) { warn.push(T('Haubenrahmen: im Rumpf ist keine Kabinenhaube angelegt (Gruppe „Kabinenhaube").')); return null; }
    const fr = can.frame;
    if (!fr) { warn.push(T('Haubenrahmen: im Rumpf (Gruppe „Kabinenhaube") „Haubenrahmen erzeugen" einschalten — Höhe, Stärke und Haubenstärke werden dort eingestellt.')); return null; }
    const v = fr.mesh();
    if (!v || !v.length) { warn.push(fr.err() || T('Haubenrahmen: im Rumpf nicht erzeugbar.')); return null; }
    return { id: 'rahmen', part: 'rahmen', tag: 6, v: new Float32Array(v) };
  }
  // Sitzwanne: Gitter Stationen (Seitenprofil) × Querschnitt (Bordwand links -> Boden -> Bordwand rechts)
  function buildTub(R, F, warn, trim) {
    const t = R.tub, xa = clamp(t.xa, F.x0 + 1, F.x1 - 1), xb = clamp(t.xb, F.x0 + 1, F.x1 - 1);
    if (!(xb - xa > 10)) { warn.push(T('Sitzwanne: Länge zu klein.')); return null; }
    const gap = Math.max(0, +t.gap || 0);
    // Innenkontur im Abstand gap zur Rumpfaußenhaut: [[z, y], …] oben -> unten
    const inner = x => {
      const H = F.half(x).map(q => [q[1], q[0]]), n = H.length, out = [];
      for (let i = 0; i < n; i++) {
        const a = H[Math.max(0, i - 1)], b = H[Math.min(n - 1, i + 1)], dz = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dz, dy) || 1;
        out.push([Math.max(0, H[i][0] + gap * dy / L), H[i][1] - gap * dz / L]);
      }
      return out;
    };
    const yMin = C => C.reduce((m, q) => Math.min(m, q[1]), Infinity), yMax = C => C.reduce((m, q) => Math.max(m, q[1]), -Infinity);
    const botAt = x => yMin(inner(x));
    // Rand = Haubenausschnitt; vor/hinter der Haube auf der Höhe ihres Endes weiter (sonst springt der Rand an der Haubenkante)
    const rimX = x => (F.can ? clamp(x, F.can.x0 + 0.01, F.can.x1 - 0.01) : x);
    const rimAt = x => Math.min(t.rimH != null ? botAt(x) + t.rimH : F.rim(rimX(x)) - (+t.rimDrop || 0), yMax(inner(x)) - 1);
    const ba = clamp(+t.backA || 0, 5, 75) * D2R, sl = Math.max(1, +t.seatLen || 0);
    let xs1 = xb - 0.3 * (xb - xa), ySeat = 0;
    for (let it = 0; it < 4; it++) { ySeat = botAt(clamp(xs1 - sl / 2, xa, xb)) + Math.max(0, +t.seatH || 0); xs1 = xb - Math.max(0, rimAt(xb) - ySeat) * Math.tan(ba); }
    xs1 = clamp(xs1, xa + 6, xb - 1); const xs0 = clamp(xs1 - sl, xa + 3, xs1 - 1);
    let prof = [[xa, botAt(xa) + Math.max(0, +t.footH || 0)], [xs0, ySeat], [xs1, ySeat], [xb, rimAt(xb) - 1]];
    for (let k = 0; k < clamp(Math.round(+t.soft || 0), 0, 6); k++) {   // Chaikin, Enden fest
      const Q = [prof[0]];
      for (let i = 0; i + 1 < prof.length; i++) { const a = prof[i], b = prof[i + 1]; if (i > 0) Q.push(lerp2(a, b, 0.25)); if (i + 2 < prof.length) Q.push(lerp2(a, b, 0.75)); }
      Q.push(prof[prof.length - 1]); prof = Q;
    }
    // Querschnitt rechts: Bordwand (Rumpfkontur) bis zur obersten Stufe, je Stufe Absatz nach innen + Innenwand, Boden zur
    // Mitte. Stetig in x: jede Stufe blendet über den Auslauf (smoothstep) zwischen Rumpfkontur und gerader Innenwand über,
    // Ecken gerundet (Stufenradius, Bodenradius), dann gleichmäßig nach Bogenlänge -> gleiche Punktzahl je Station.
    const NX = 110, M = 60, stations = resampleOpen(prof, NX), G = [];
    const Lt = xb - xa, steps = [0, 1].map(k => (t.steps && t.steps[k]) || { on: false }).filter(q => q.on).sort((a, b) => (+b.h || 0) - (+a.h || 0));
    const sstep = e => (e <= 0 ? 0 : e >= 1 ? 1 : e * e * (3 - 2 * e));
    const zAt = (C, y) => { let z = -Infinity; for (let i = 0; i + 1 < C.length; i++) { const a = C[i], b = C[i + 1]; if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) z = Math.max(z, a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1])); } return z > -Infinity ? z : 0; };
    const rSt = Math.max(0, +t.stepR || 0), rFl = Math.max(0, +t.rF || 0);
    let px = -Infinity;
    for (const st of stations) {
      let x = Math.max(st[0], px + 0.05); px = x;
      const C = inner(x), yR = rimAt(x), yF = clamp(st[1], yMin(C) + 0.3, yR - 1);
      let i = 0; while (i + 1 < C.length && !(C[i][1] >= yR && C[i + 1][1] < yR)) i++;
      if (i + 1 >= C.length) continue;
      // Stufen dieser Station (feste Reihenfolge nach Höhe), Gewicht k stetig in x und in der Höhe
      const lv = []; let yTopLim = yR;
      for (const q of steps) {
        const f0 = xa + Lt * clamp(+q.x0 || 0, 0, 100) / 100, f1 = xa + Lt * clamp(+q.x1 || 0, 0, 100) / 100, rp = Math.max(0.5, +q.ramp || 0);
        const yRaw = yF + Math.max(0, +q.h || 0);
        let k = sstep(Math.min((x - f0) / rp, (f1 - x) / rp)) * sstep((yTopLim - 1 - yRaw) / 3) * sstep((yRaw - yF - 0.5) / 2);
        const y = clamp(yRaw, yF + 0.5, yTopLim - 1);
        if (!(y > yF + 0.4 && y < yTopLim - 0.4)) k = 0;
        lv.push({ y, k, w: Math.max(0, +q.w || 0), dr: Math.tan(clamp(+q.draft || 0, 0, 30) * D2R) });
        if (k > 0) yTopLim = y;
      }
      const act = lv.filter(q => q.k > 0);
      // Innenwand je Ebene als Funktion z(y): Rumpfkontur, je Stufe mit k zur geraden Wand übergeblendet
      let zRef = y => zAt(C, y);
      const P = [], corners = [];
      const cut = (a, b, y) => lerp2(a, b, (y - a[1]) / (b[1] - a[1]));
      P.push(cut(C[i], C[i + 1], yR));
      const yTop = act.length ? act[0].y : yF;
      let j = i + 1; while (j < C.length && C[j][1] > yTop) P.push(C[j++]);
      if (j >= C.length) continue;
      P.push(cut(C[j - 1], C[j], yTop));
      act.forEach((q, n) => {
        const yN = n + 1 < act.length ? act[n + 1].y : yF, zo = zRef, zs = zo(q.y);
        const zNew = y => (1 - q.k) * zo(y) + q.k * Math.min(Math.max(1, zs - q.w - (q.y - y) * q.dr), zo(y));
        corners.push({ k: P.length - 1, r: rSt * q.k });
        P.push([Math.max(1, zNew(q.y)), q.y]); corners.push({ k: P.length - 1, r: rSt * q.k });
        for (let m = 1; m <= 14; m++) { const y = q.y + (yN - q.y) * m / 14; P.push([Math.max(1, zNew(y)), y]); }
        zRef = zNew;
      });
      corners.push({ k: P.length - 1, r: rFl });
      P.push([0, yF]);
      // Ecken runden (Schenkellänge bis zur Nachbarecke / zum Ende begrenzt)
      const Ls = [0]; for (let m = 1; m < P.length; m++) Ls.push(Ls[m - 1] + dist2(P[m], P[m - 1]));
      corners.forEach((cq, n) => { const a = n ? Ls[corners[n - 1].k] : 0, b = n + 1 < corners.length ? Ls[corners[n + 1].k] : Ls[Ls.length - 1]; cq.cap = 0.45 * Math.min(Ls[cq.k] - a, b - Ls[cq.k]); });
      corners.slice().sort((a, b) => b.k - a.k).forEach(cq => { if (cq.r > 0.05 && cq.cap > 0.02) roundCorner(P, cq.k, cq.r, cq.cap); });
      const Hh = resampleOpen(P, M);
      const row = [];
      for (let m = 0; m < M; m++) row.push([x, Hh[m][1], -Hh[m][0]]);
      row.push([x, Hh[M][1], 0]);
      for (let m = M - 1; m >= 0; m--) row.push([x, Hh[m][1], Hh[m][0]]);
      G.push(row);
    }
    if (G.length < 3) { warn.push(T('Sitzwanne: kein Querschnitt — Rand (Haubenausschnitt) liegt unter dem Boden?')); return null; }
    let Gt = G, ref = [G.length >> 1, M];   // M = Bodenmitte
    if (trim && trim.wanne) { const tg = trimGrid(G, ref[0], M, trim.wanne, { t: Math.max(0.2, +t.wall || 0.2), refDir: [0, 1, 0] }); Gt = tg.G; ref = tg.ref; if (Gt.length < 2) { warn.push(T('Stutzen: von der Sitzwanne bleibt nichts übrig.')); return null; } }
    const v = []; thicken(v, Gt, Math.max(0.2, +t.wall || 0.2), ref[0], ref[1], [0, 1, 0]);
    return { item: { id: 'wanne', part: 'wanne', tag: 3, v }, grid: Gt, prof, floorAt: x => { for (let i = 0; i + 1 < prof.length; i++) if (x >= prof[i][0] && x <= prof[i + 1][0]) return lerp2(prof[i], prof[i + 1], (x - prof[i][0]) / ((prof[i + 1][0] - prof[i][0]) || 1))[1]; return null; } };
  }
  function buildStick(R, F, tub, warn) {
    const s = R.stick, x = s.x;
    let y = tub && tub.floorAt(x); if (y == null) y = F ? F.bot(x) + (+R.tub.gap || 0) + 1 : R.pz.yB - 50;
    const L = Math.max(2, +s.len || 0), r = Math.max(0.3, (+s.d || 0) / 2), g = Math.max(2 * r, +s.grip || 0), a = (+s.tilt || 0) * D2R;
    const prof = [[0, -0.5], [r * 1.6, -0.5], [r * 1.6, 0.6], [r, 1.2], [r, L], [g * 0.36, L + g * 0.15], [g * 0.5, L + g * 0.55], [g * 0.44, L + g * 1.05], [g * 0.25, L + g * 1.35], [0, L + g * 1.42]];
    const v = []; lathe(v, prof, [x, y, 0], [-Math.sin(a), Math.cos(a), 0], 20);
    return { id: 'knueppel', part: 'stick', tag: 4, v };
  }
  // Rumpf als Linien (Spanten + Längslinien + Haubenlinie), nur Anzeige
  function fusLines(F, R) {
    const G = F.A.model && F.A.model.G, L = [];
    const seg = (a, b) => L.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    if (G && G.length > 2) {
      const K = G.length, NB = G[0].length, xa = Math.min(R.tub.xa, R.pz.x - R.pz.depth) - 0.25 * R.Lc, xb = Math.max(R.tub.xb, R.cb) + 0.25 * R.Lc;
      for (let b = 0; b < NB; b++) {
        const x = G[0][b][0], near = x > xa && x < xb;
        if (!near && b % 6) continue;
        if (near && b % 2) continue;
        for (let a = 0; a + 1 < K; a++) for (const sg of [1, -1]) seg([G[a][b][0], G[a][b][1], sg * G[a][b][2]], [G[a + 1][b][0], G[a + 1][b][1], sg * G[a + 1][b][2]]);
      }
      for (const a of [0, K >> 2, K >> 1, (3 * K) >> 2, K - 1]) for (let b = 0; b + 1 < NB; b++) for (const sg of [1, -1]) seg([G[a][b][0], G[a][b][1], sg * G[a][b][2]], [G[a][b + 1][0], G[a][b + 1][1], sg * G[a][b + 1][2]]);
    }
    if (F.can && Array.isArray(F.can.line)) {
      const N = F.can.line;
      for (let i = 0; i + 1 < N.length; i++) for (const sg of [1, -1]) {
        const p = N[i], q = N[i + 1], zp = Math.max(0, F.hw(p[0], p[1])), zq = Math.max(0, F.hw(q[0], q[1]));
        seg([p[0], p[1], sg * zp], [q[0], q[1], sg * zq]);
      }
    }
    return new Float32Array(L);
  }

  let cache = null;
  function build() {
    const PF = window.__ckProf ? {} : null, t0 = PF ? performance.now() : 0, mark = k => { if (PF) PF[k] = Math.round(performance.now() - t0); };
    const c = cfg(), A = fusApi(), F = fusOf(A), R = resolve(c, F), warn = [], items = []; mark('resolve');
    if (c.from !== 'none' && !F) warn.push(c.from === 'stl' ? T('Kein STL-Modell geladen — Cockpit ohne Rumpf.') : T('Kein Rumpf — Cockpit ohne Rumpf (Sitzwanne braucht einen Rumpf).'));
    let outline = null, ok = [];
    try {
      outline = panelOutline(R.pz);
      const pz = buildPilz(R, outline, warn); items.push(...pz.items); ok = pz.ok;
    } catch (e) { warn.push(T('Pilz/Brett: ') + (e && e.message ? e.message : e)); }
    let tub = null;
    if (c.tub.on && F) { try { tub = buildTub(R, F, warn); if (tub) items.push(tub.item); } catch (e) { warn.push(T('Sitzwanne: ') + (e && e.message ? e.message : e)); } }
    if (c.stick.on) items.push(buildStick(R, F, tub, warn));
    if (F && (c.frame.on || R.pz.mount === 'frame')) { try { const fr = buildFrame(R, F, warn); if (fr) items.push(fr); } catch (e) { warn.push(T('Haubenrahmen: ') + (e && e.message ? e.message : e)); } }
    else if (!F && R.pz.mount === 'frame') warn.push(T('Haubenrahmen: braucht einen Rumpf mit Kabinenhaube aus dem Rumpf.'));
    for (const it of items) it.v = new Float32Array(it.v);
    mark('parts');
    // Stutzen nach den Regeln (Reihenfolge der Regeln): A neu aufbauen, Zeilen an B begrenzt
    // Netz je Teil (zusammengefügt) und Punkt-im-Körper-Prüfer, je Bau zwischengespeichert; nach jedem Stutzen neu
    let vMemo = new Map(); const tMemo = new WeakMap();
    const vOf = id => {
      if (vMemo.has(id)) return vMemo.get(id);
      const L = items.filter(it => it.id === id); let v = null;
      if (L.length === 1) v = L[0].v;
      else if (L.length) { const n = L.reduce((s, it) => s + it.v.length, 0); v = new Float32Array(n); let o = 0; for (const it of L) { v.set(it.v, o); o += it.v.length; } }
      vMemo.set(id, v); return v;
    };
    const testerOf = id => { const v = vOf(id); if (!v) return null; let t = tMemo.get(v); if (!t) { t = solidTester(v); tMemo.set(v, t); } return t; };
    const rules = (c.trim || []).filter(r => r && r.on && TRIM_A.includes(r.a) && r.a !== r.b), trimDone = {};
    let pOut = outline;
    for (const A of [...new Set(rules.map(r => r.a))]) {
      const ts = rules.filter(r => r.a === A).map(r => r.b === 'rumpf' ? (F ? fusTester(F, Math.max(0, +c.tub.gap || 0)) : null) : testerOf(r.b)).filter(Boolean);
      if (!ts.length) continue;
      const tr = {}; tr[A] = q => ts.some(f => f(q));
      try {
        if ((A === 'haube' || A === 'brett') && outline) {
          const prev = items.find(it => it.id === (A === 'haube' ? 'brett' : 'haube'));   // die schon gestutzte andere Hälfte des Pilzes behalten
          Object.assign(tr, trimDone); const pz = buildPilz(R, outline, warn, tr); for (const it of pz.items) it.v = new Float32Array(it.v);
          Object.assign(trimDone, tr); ok = pz.ok; pOut = pz.pOut;
          for (let i = items.length - 1; i >= 0; i--) if (['brett', 'ringe', 'konsole', 'haube', 'saeule'].includes(items[i].id)) items.splice(i, 1);
          items.unshift(...pz.items); void prev;
        } else if (A === 'wanne' && c.tub.on && F) {
          const tb = buildTub(R, F, warn, tr); for (let i = items.length - 1; i >= 0; i--) if (items[i].id === 'wanne') items.splice(i, 1);
          if (tb) { tb.item.v = new Float32Array(tb.item.v); items.push(tb.item); }
        }
      } catch (e) { warn.push(T('Stutzen: ') + (e && e.message ? e.message : e)); }
      vMemo = new Map();
    }
    mark('trim');
    // Überschneidungen zwischen den Teilen (Stichprobe der Eckpunkte), gewollte Paare ausgenommen
    const over = [], ids = [...new Set(items.map(it => it.id))], OK_PAIR = new Set(['brett|ringe', 'brett|konsole', 'brett|haube', 'haube|ringe', 'knueppel|wanne', 'konsole|ringe', 'haube|saeule', 'brett|saeule']);
    if (R.pz.merge) OK_PAIR.add('haube|rahmen');   // gewollt verschmolzen
    const testers = new Map(); ids.forEach(id => testers.set(id, testerOf(id)));
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j], key = [a, b].sort().join('|'); if (OK_PAIR.has(key)) continue;
      let hit = 0;
      for (const [x, y] of [[a, b], [b, a]]) { const v = vOf(x), tB = testers.get(y), st = 3 * Math.max(1, Math.floor(v.length / 3 / 600)); for (let k = 0; k < v.length && hit < 3; k += st) if (tB([v[k], v[k + 1], v[k + 2]])) hit++; }
      if (hit >= 2) over.push([a, b]);
    }
    mark('overlap');
    // Lageprüfung gegen den Rumpf
    if (F) {
      let worst = 0;
      for (const it of items) { if (it.part === 'wanne' || it.tag === 6) continue; const v = it.v, st = Math.max(3, 3 * Math.floor(v.length / 3 / 1500)); for (let i = 0; i < v.length; i += st) worst = Math.max(worst, F.out(v[i], v[i + 1], v[i + 2])); }
      if (worst > 0.3) warn.push(T('Ragt bis') + ' ' + r1(worst) + ' mm ' + T('aus dem Rumpf — Lage/Größe anpassen oder „An Rumpf anpassen".'));
    }
    mark('fit'); if (PF) window.__ckProf = PF;
    let lines = F && c.showFus ? fusLines(F, R) : null;
    if (R.trimLine) { const [a, b] = R.trimLine; lines = (lines ? Array.from(lines) : []).concat([a[0], a[1], 0, b[0], b[1], 0]); }   // Stutzebene des Pilzes am Rahmen
    if (F && R.pz.topY && R.pz.mount === 'frame' && R.pz.merge && !R.pz.straight && F.can) {   // Oberkante des Pilzes in der Mittelebene
      const tl = [], xa = Math.max(F.x0, F.can.x0), xb = R.pz.x + 15, n = 80;
      for (let i = 0; i < n; i++) { const x0 = xa + (xb - xa) * i / n, x1 = xa + (xb - xa) * (i + 1) / n; tl.push(x0, R.pz.topY(x0), 0, x1, R.pz.topY(x1), 0); }
      if (R.pz.topC) for (const q of R.pz.topC) tl.push(q[0] - 1.5, q[1], 0, q[0] + 1.5, q[1], 0);
      lines = lines ? Array.from(lines).concat(tl) : tl;
    }
    cache = { items, R, F, outline: pOut || outline, ok, warn: [...new Set(warn)], tub, over, lines: lines ? new Float32Array(lines) : null };
    if (topEd && topEd.el.style.display !== 'none') { try { topEd.data(); } catch (e) { console.warn('Cockpit: Linien-Editor', e); } }
    if (secEd && secEd.el.style.display !== 'none') { try { secEd.data(); } catch (e) { console.warn('Cockpit: Querschnitt-Editor', e); } }
    return cache;
  }

  // ---------- Instrumentenblätter (SVG, Einheit mm, Mitte 0/0) -------------------------------------------
  const FONT = 'font-family="Arial,Helvetica,sans-serif"';
  const fx = v => String(Math.round(v * 1000) / 1000);
  const pol = (r, a) => [r * Math.sin(a * D2R), -r * Math.cos(a * D2R)];
  const tk = (r0, r1_, a, w, col) => { const p = pol(r0, a), q = pol(r1_, a); return `<line x1="${fx(p[0])}" y1="${fx(p[1])}" x2="${fx(q[0])}" y2="${fx(q[1])}" stroke="${col || '#eee'}" stroke-width="${fx(w)}" stroke-linecap="butt"/>`; };
  const tx = (x, y, s, size, col, extra) => `<text x="${fx(x)}" y="${fx(y)}" font-size="${fx(size)}" fill="${col || '#eee'}" text-anchor="middle" dominant-baseline="central" ${FONT}${extra || ''}>${s}</text>`;
  const arc = (r, a0, a1, w, col) => { const p = pol(r, a0), q = pol(r, a1); return `<path d="M${fx(p[0])} ${fx(p[1])}A${fx(r)} ${fx(r)} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} 1 ${fx(q[0])} ${fx(q[1])}" fill="none" stroke="${col}" stroke-width="${fx(w)}"/>`; };
  const needle = (a, len, w, col) => { const t = pol(len, a), b1 = pol(w, a + 90), b2 = pol(w, a - 90), tl = pol(len * 0.18, a + 180); return `<path d="M${fx(b1[0])} ${fx(b1[1])}L${fx(t[0])} ${fx(t[1])}L${fx(b2[0])} ${fx(b2[1])}L${fx(tl[0])} ${fx(tl[1])}Z" fill="${col || '#f4f4f4'}"/>`; };
  const hub = r => `<circle r="${fx(r)}" fill="#2a2a2a" stroke="#888" stroke-width="${fx(r * 0.2)}"/>`;
  function dialSvg(it, sc) {
    const K = KINDS[it.k] || KINDS.blank, d = instDims(it, sc), val = it.val != null && isFinite(+it.val) ? +it.val : (K.val || 0);
    if (d.rect) {
      const w = d.w, h = d.h, s = Math.min(w, h), o = [`<rect x="${fx(-w / 2)}" y="${fx(-h / 2)}" width="${fx(w)}" height="${fx(h)}" rx="${fx(d.rr)}" fill="#1a1b1d"/>`];
      if (it.k === 'radio') {
        o.push(`<rect x="${fx(-w * 0.42)}" y="${fx(-h * 0.38)}" width="${fx(w * 0.84)}" height="${fx(h * 0.36)}" rx="${fx(s * 0.03)}" fill="#a9c79a"/>`);
        o.push(tx(0, -h * 0.2, '122.475', h * 0.17, '#1c2a1c', ' font-weight="bold"'));
        o.push(tx(-w * 0.3, h * 0.08, 'COM', h * 0.08, '#bbb'));
        for (const ux of [-0.24, 0.24]) o.push(`<circle cx="${fx(w * ux)}" cy="${fx(h * 0.27)}" r="${fx(s * 0.13)}" fill="#333" stroke="#777" stroke-width="${fx(s * 0.015)}"/>`, `<circle cx="${fx(w * ux)}" cy="${fx(h * 0.27)}" r="${fx(s * 0.07)}" fill="#222"/>`);
      } else {
        const sw = w * 0.88, sh = h * 0.8;
        o.push(`<rect x="${fx(-sw / 2)}" y="${fx(-sh / 2 - h * 0.03)}" width="${fx(sw)}" height="${fx(sh)}" fill="#0b2744"/>`);
        o.push(`<circle cx="${fx(sw * 0.12)}" cy="${fx(-h * 0.05)}" r="${fx(sh * 0.22)}" fill="none" stroke="#3fd16b" stroke-width="${fx(s * 0.012)}"/>`);
        o.push(`<path d="M${fx(-sw * 0.4)} ${fx(sh * 0.25)}L${fx(-sw * 0.1)} ${fx(-sh * 0.05)}L${fx(sw * 0.25)} ${fx(sh * 0.12)}L${fx(sw * 0.42)} ${fx(-sh * 0.3)}" fill="none" stroke="#e8e8e8" stroke-width="${fx(s * 0.01)}"/>`);
        o.push(tx(-sw * 0.32, -sh * 0.36, '+1.8', sh * 0.11, '#ffd23f'), tx(sw * 0.33, -sh * 0.36, '112 km/h', sh * 0.08, '#e8e8e8'));
        o.push(tx(0, h * 0.44, 'LX', h * 0.07, '#999'));
      }
      return { svg: o.join(''), bb: [-w / 2, -h / 2, w, h] };
    }
    const r = d.r, o = [`<circle r="${fx(r)}" fill="#0c0c0d"/>`, `<circle r="${fx(r * 0.975)}" fill="none" stroke="#3a3a3a" stroke-width="${fx(r * 0.03)}"/>`];
    const R0 = r * 0.92;
    if (it.k === 'asi') {
      const vmax = 250, A = v => 25 + v / vmax * 310;
      o.push(arc(R0 - r * 0.05, A(70), A(150), r * 0.07, '#2fa84f'), arc(R0 - r * 0.05, A(150), A(220), r * 0.07, '#e3c22b'), tk(R0 - r * 0.16, R0, A(250), r * 0.04, '#e0302a'));
      for (let v = 0; v <= vmax; v += 5) o.push(tk(R0 - (v % 50 === 0 ? r * 0.16 : v % 10 === 0 ? r * 0.1 : r * 0.06), R0, A(v), r * (v % 50 === 0 ? 0.035 : 0.02)));
      for (let v = 0; v <= vmax; v += 50) { const p = pol(r * 0.6, A(v)); o.push(tx(p[0], p[1], String(v / 10), r * 0.17)); }
      o.push(tx(0, r * 0.38, 'km/h ×10', r * 0.11, '#bbb'), needle(A(clamp(val, 0, vmax)), R0 * 0.95, r * 0.045), hub(r * 0.08));
    } else if (it.k === 'vario') {
      const A = v => 270 + v * 30;
      for (let v = -5; v <= 5.001; v += 0.5) { const big = Math.abs(v - Math.round(v)) < 1e-6; o.push(tk(R0 - (big ? r * 0.15 : r * 0.08), R0, A(v), r * (big ? 0.035 : 0.02))); }
      for (let v = -5; v <= 5; v++) { const p = pol(r * 0.64, A(v)); o.push(tx(p[0], p[1], String(Math.abs(v)), r * 0.18)); }
      const up = pol(r * 0.35, A(2.5)), dn = pol(r * 0.35, A(-2.5));
      o.push(tx(up[0], up[1], '+', r * 0.2, '#9fe0a8'), tx(dn[0], dn[1], '−', r * 0.2, '#f0a0a0'), tx(r * 0.3, 0, 'm/s', r * 0.12, '#bbb'));
      o.push(needle(A(clamp(val, -5.2, 5.2)), R0 * 0.95, r * 0.045, '#ffd23f'), hub(r * 0.08));
    } else if (it.k === 'alt') {
      for (let i = 0; i < 50; i++) o.push(tk(R0 - (i % 5 === 0 ? r * 0.14 : r * 0.07), R0, i * 7.2, r * (i % 5 === 0 ? 0.035 : 0.018)));
      for (let dg = 0; dg < 10; dg++) { const p = pol(r * 0.66, dg * 36); o.push(tx(p[0], p[1], String(dg), r * 0.19)); }
      o.push(`<rect x="${fx(r * 0.22)}" y="${fx(-r * 0.09)}" width="${fx(r * 0.36)}" height="${fx(r * 0.18)}" fill="#1b1b1b" stroke="#666" stroke-width="${fx(r * 0.015)}"/>`, tx(r * 0.4, 0, '1013', r * 0.1, '#ddd'));
      o.push(tx(0, -r * 0.3, '×100 m', r * 0.1, '#bbb'));
      o.push(needle(((val % 10000) / 10000) * 360, R0 * 0.5, r * 0.07), needle(((val % 1000) / 1000) * 360, R0 * 0.92, r * 0.04), hub(r * 0.08));
    } else if (it.k === 'comp') {
      const g = [];
      for (let a = 0; a < 360; a += 5) g.push(tk(R0 - (a % 30 === 0 ? r * 0.15 : a % 10 === 0 ? r * 0.1 : r * 0.06), R0, a, r * 0.02));
      const lab = ['N', '3', '6', 'E', '12', '15', 'S', '21', '24', 'W', '30', '33'];
      lab.forEach((s, i) => { const p = pol(r * 0.64, i * 30); g.push(tx(p[0], p[1], s, r * (i % 3 === 0 ? 0.2 : 0.14), i === 0 ? '#ff6b4a' : '#eee', ` transform="rotate(${i * 30} ${fx(p[0])} ${fx(p[1])})"`)); });
      o.push(`<g transform="rotate(${fx(-val)})">${g.join('')}</g>`, tk(r * 0.2, r * 0.98, 0, r * 0.03, '#ff9a2a'));
    } else if (it.k === 'turn') {
      o.push(tk(R0 - r * 0.2, R0, -25, r * 0.06), tk(R0 - r * 0.2, R0, 25, r * 0.06), tk(R0 - r * 0.2, R0, 0, r * 0.04, '#999'));
      o.push(tx(-r * 0.45, -r * 0.42, 'L', r * 0.18), tx(r * 0.45, -r * 0.42, 'R', r * 0.18), tx(0, -r * 0.18, '2 MIN', r * 0.1, '#bbb'));
      o.push(`<g transform="translate(0 ${fx(-r * 0.62)})">${arc(r * 1.2, 164, 196, r * 0.2, '#d8d8c8')}${arc(r * 1.2, 164, 196, r * 0.16, '#26261f')}</g>`);   // Libelle
      o.push(`<circle cx="0" cy="${fx(r * 0.58)}" r="${fx(r * 0.075)}" fill="#111" stroke="#bbb" stroke-width="${fx(r * 0.01)}"/>`);
      o.push(needle(clamp(val, -40, 40), R0 * 0.85, r * 0.05), hub(r * 0.08));
    } else if (it.k === 'clock') {
      for (let i = 0; i < 60; i++) o.push(tk(R0 - (i % 5 === 0 ? r * 0.14 : r * 0.06), R0, i * 6, r * (i % 5 === 0 ? 0.035 : 0.015)));
      for (let hh = 1; hh <= 12; hh++) { const p = pol(r * 0.64, hh * 30); o.push(tx(p[0], p[1], String(hh), r * 0.17)); }
      o.push(needle(10 * 30 + 5, R0 * 0.55, r * 0.06), needle(60, R0 * 0.88, r * 0.04), hub(r * 0.07));
    } else if (it.k === 'flarm') {
      for (let i = 0; i < 12; i++) { const p = pol(r * 0.72, i * 30); o.push(`<circle cx="${fx(p[0])}" cy="${fx(p[1])}" r="${fx(r * 0.075)}" fill="${i === 1 ? '#ff3b30' : i === 2 ? '#ffb02e' : '#17401f'}"/>`); }
      o.push(tx(0, -r * 0.12, 'FLARM', r * 0.17, '#ddd', ' font-weight="bold"'), tx(0, r * 0.22, '+2  450m', r * 0.11, '#9fe0a8'));
    } else {
      for (let i = 0; i < 4; i++) { const p = pol(r * 0.7, 45 + i * 90); o.push(`<circle cx="${fx(p[0])}" cy="${fx(p[1])}" r="${fx(r * 0.05)}" fill="#333"/>`); }
    }
    return { svg: o.join(''), bb: [-r, -r, 2 * r, 2 * r] };
  }
  const imgCache = new Map();
  function dialImg(it, sc) {
    const key = [it.k, it.d, it.w, it.h, it.val, sc].join('|'); let im = imgCache.get(key);
    if (im) return im.complete && im.naturalWidth ? im : null;
    const d = dialSvg(it, sc), bb = d.bb, px = 512, ar = bb[3] / bb[2];
    const s = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${Math.round(px * ar)}" viewBox="${bb.map(fx).join(' ')}">${d.svg}</svg>`;
    im = new Image(); im.onload = () => { if (cfg().view === 'brett') draw(); };
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
    if (imgCache.size > 200) imgCache.clear();
    imgCache.set(key, im); return null;
  }

  // ---------- Ausgabe ------------------------------------------------------------------------------------
  function toBinarySTL(v) {
    const n = Math.floor(v.length / 9), buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf), hdr = 'AI Foam Cut Cockpit';
    for (let i = 0; i < 80; i++) dv.setUint8(i, i < hdr.length ? hdr.charCodeAt(i) : 0);
    dv.setUint32(80, n, true);
    let o = 84;
    for (let i = 0; i < n * 9; i += 9) {
      const ux = v[i + 3] - v[i], uy = v[i + 4] - v[i + 1], uz = v[i + 5] - v[i + 2], wx = v[i + 6] - v[i], wy = v[i + 7] - v[i + 1], wz = v[i + 8] - v[i + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, L = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / L, true); dv.setFloat32(o + 4, ny / L, true); dv.setFloat32(o + 8, nz / L, true); o += 12;
      for (let k = 0; k < 9; k++) { dv.setFloat32(o, v[i + k], true); o += 4; }
      dv.setUint16(o, 0, true); o += 2;
    }
    return buf;
  }
  function base() { return ((state.projectName || 'cockpit').replace(/[^\w\-]+/g, '_')) || 'cockpit'; }
  function saveFile(name, data, mime, which) {
    if (typeof App.download === 'function') App.download(name, data, mime, which);
    else if (App.anchorDownload) App.anchorDownload(name, data, mime);
  }
  const PART_NAME = { pilz: 'pilz', brett: 'brett', wanne: 'sitzwanne', stick: 'knueppel', rahmen: 'haubenrahmen_mit_pilz' };
  function partFiles(r) {
    const by = new Map();
    for (const it of r.items) { const k = cfg().exp.sep ? it.part : 'cockpit'; if (!by.has(k)) by.set(k, []); by.get(k).push(it.v); }
    return [...by].map(([k, arr]) => { const n = arr.reduce((s, a) => s + a.length, 0), v = new Float32Array(n); let o = 0; for (const a of arr) { v.set(a, o); o += a.length; } return { name: base() + '_' + (PART_NAME[k] || k) + '.stl', v }; });
  }
  async function exportStl() {
    const r = build(); if (!r.items.length) { alert(T('Kein Bauteil.')); return; }
    if (App.demoSaveBlocked && App.demoSaveBlocked('svStl')) return;
    const list = partFiles(r);
    if (list.length === 1) { saveFile(list[0].name, toBinarySTL(list[0].v), 'model/stl', 'svStl'); return; }
    if (App.stlSaveMany) { await App.stlSaveMany(list, 'svStl', { name: base() + '_cockpit' }); return; }   // Vorschau + 3MF oder STL je Teil
    let i = 0; for (const it of list) setTimeout(() => App.anchorDownload(it.name, toBinarySTL(it.v), 'model/stl'), 300 * i++);
  }
  function screwPts(it, sc, bez) {
    const d = instDims(it, sc);
    if (d.rect) return [];
    const rr = d.r + Math.max(bez, d.r * 0.08) + d.r * 0.1;
    return [45, 135, 225, 315].map(a => [it.u + rr * Math.cos(a * D2R), it.v + rr * Math.sin(a * D2R), d.r * 0.07]);
  }
  // Druckvorlage: Brett mit allen Instrumenten an ihrem Platz + jedes Instrumentenblatt einzeln, 1:1 in mm
  function svgText() {
    const r = build(), c = cfg(), sc = r.R.scale, P = r.outline; if (!P) return null;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of P) { u0 = Math.min(u0, q[0]); u1 = Math.max(u1, q[0]); v0 = Math.min(v0, q[1]); v1 = Math.max(v1, q[1]); }
    const m = 8, W0 = u1 - u0, H0 = v1 - v0, X = u => m + (u - u0), Y = v => m + 6 + (v1 - v);
    const body = [];
    body.push(tx(m + W0 / 2, m + 1, T('Instrumentenbrett') + ' — ' + T('Maßstab') + ' 1:' + r1(sc) + ' — ' + T('1:1 drucken (100 %)'), 3, '#333'));
    body.push(`<path d="M${P.map(q => fx(X(q[0])) + ' ' + fx(Y(q[1]))).join('L')}Z" fill="#2e3238" stroke="#d0021b" stroke-width="0.15"/>`);
    const bez = Math.max(0, +c.inst.bez || 0);
    for (const o of r.ok) {
      const d = dialSvg(o.it, sc);
      body.push(`<g transform="translate(${fx(X(o.it.u))} ${fx(Y(o.it.v))})">${d.svg}</g>`);
      const hp = instPoly(o.it, sc, 0, 96);
      body.push(`<path d="M${hp.map(q => fx(X(q[0])) + ' ' + fx(Y(q[1]))).join('L')}Z" fill="none" stroke="#d0021b" stroke-width="0.1"/>`);
      if (c.inst.screws) for (const s of screwPts(o.it, sc, bez)) body.push(`<circle cx="${fx(X(s[0]))}" cy="${fx(Y(s[1]))}" r="${fx(s[2])}" fill="#9aa0a6"/>`);
    }
    // Einzelblätter
    let x = m, y = m + 6 + H0 + 10, rowH = 0; const Wp = Math.max(W0 + 2 * m, 120);
    for (const o of r.ok) {
      const d = dialSvg(o.it, sc), bb = d.bb;
      if (x + bb[2] > Wp - m && x > m) { x = m; y += rowH + 5; rowH = 0; }
      body.push(`<g transform="translate(${fx(x - bb[0])} ${fx(y - bb[1])})">${d.svg}</g>`);
      const hp = instPoly(Object.assign({}, o.it, { u: 0, v: 0 }), sc, 0, 96);
      body.push(`<path d="M${hp.map(q => fx(x - bb[0] + q[0]) + ' ' + fx(y - bb[1] - q[1])).join('L')}Z" fill="none" stroke="#d0021b" stroke-width="0.1"/>`);
      body.push(tx(x + bb[2] / 2, y + bb[3] + 2, T((KINDS[o.it.k] || KINDS.blank).name), 1.8, '#333'));
      x += bb[2] + 5; rowH = Math.max(rowH, bb[3] + 4);
    }
    const Hp = y + rowH + m;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${fx(Wp)}mm" height="${fx(Hp)}mm" viewBox="0 0 ${fx(Wp)} ${fx(Hp)}">\n<rect width="100%" height="100%" fill="#fff"/>\n${body.join('\n')}\n</svg>\n`;
  }
  function exportSvg() {
    if (App.demoSaveBlocked && App.demoSaveBlocked('save')) return;
    const s = svgText(); if (!s) { alert(T('Kein Brett.')); return; }
    saveFile(base() + '_instrumente.svg', s, 'image/svg+xml', 'save');
  }
  function exportDxf() {
    if (App.demoSaveBlocked && App.demoSaveBlocked('svDxf')) return;
    const r = build(), c = cfg(); if (!r.outline) { alert(T('Kein Brett.')); return; }
    const L = ['0', 'SECTION', '2', 'ENTITIES'];
    const poly = (P, layer) => { L.push('0', 'LWPOLYLINE', '8', layer, '90', String(P.length), '70', '1'); for (const q of P) L.push('10', q[0].toFixed(4), '20', q[1].toFixed(4)); };
    poly(cleanRing(r.outline), 'BRETT');
    if (c.inst.mode !== 'flat') for (const o of r.ok) {
      const d = instDims(o.it, r.R.scale);
      if (d.rect) poly(instPoly(o.it, r.R.scale, 0), 'INSTRUMENTE');
      else L.push('0', 'CIRCLE', '8', 'INSTRUMENTE', '10', o.it.u.toFixed(4), '20', o.it.v.toFixed(4), '40', d.r.toFixed(4));
      if (c.inst.screws) for (const s of screwPts(o.it, r.R.scale, +c.inst.bez || 0)) L.push('0', 'CIRCLE', '8', 'SCHRAUBEN', '10', s[0].toFixed(4), '20', s[1].toFixed(4), '40', s[2].toFixed(4));
    }
    L.push('0', 'ENDSEC', '0', 'EOF');
    saveFile(base() + '_instrumentenbrett.dxf', L.join('\n'), 'application/dxf', 'svDxf');
  }

  // ---------- Vorschau ---------------------------------------------------------------------------------
  let canvas = null, ctx = null, W = 0, H = 0, bound = false;
  const CAM0 = { yaw: -0.85, pitch: 0.42, zoom: 1, px: 0, py: 0 }, cam = Object.assign({}, CAM0), cam2 = { zoom: 1, px: 0, py: 0 };
  let center = [0, 0, 0], radius = 100, depthR = 100;
  const LIGHT = (() => { const l = [-0.35, 0.55, 0.75], n = Math.hypot(...l); return l.map(x => x / n); })();
  const is2d = () => cfg().view === 'brett';
  function rot(n) {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), x1 = n[0] * cy + n[2] * sy, z1 = -n[0] * sy + n[2] * cy, cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    return [x1, n[1] * cp - z1 * sp, n[1] * sp + z1 * cp];
  }
  function scr(x, y, z) { const r = rot([x - center[0], y - center[1], z - center[2]]), s = 0.42 * Math.min(W, H) / radius * cam.zoom; return { x: W / 2 + cam.px + s * r[0], y: H / 2 + cam.py - s * r[1], d: r[2] }; }
  function fit() {
    canvas = document.getElementById('cCockpit'); if (!canvas) return false;
    const dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
    W = r.width; H = r.height; if (!(W > 0 && H > 0)) return false;
    canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
    ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!bound) bind();
    return true;
  }
  // Brettansicht: Bildschirm <-> (u, v)
  function xf2() {
    const r = cache, p = r && r.R.pz; if (!p) return null;
    const w = Math.max(p.wT, p.wB) + 20, h = p.h + 20, s = Math.min(W / w, (H - 40) / h) * 0.9 * cam2.zoom;
    return { s, X: u => W / 2 + cam2.px + u * s, Y: v => H / 2 + cam2.py - (v - p.h / 2) * s, U: x => (x - W / 2 - cam2.px) / s, V: y => p.h / 2 - (y - H / 2 - cam2.py) / s };
  }
  // gezeichneter Umriss: Punkte (bei sym nur die rechte Hälfte) in Bildschirmkoordinaten
  function freeHandles() {
    const c = cfg(), p = c.pz, t = xf2(); if (p.shape !== 'free' || !p.free || !t) return [];
    const v0 = freeV0(p); return p.free.pts.map((q, i) => ({ i, x: t.X(p.free.sym && (i === 0 || i === p.free.pts.length - 1) ? 0 : q.u), y: t.Y(q.v - v0) }));
  }
  function hitFree(mx, my) { let best = -1, bd = 8; for (const h of freeHandles()) { const d = Math.hypot(h.x - mx, h.y - my); if (d < bd) { bd = d; best = h.i; } } return best; }
  // Doppelklick nahe einer Kante: Punkt einfügen (bei sym nur auf der rechten Hälfte)
  // nächste Strecke (Hilfslinie zwischen zwei Punkten) zur Maus; -1 = keine in Reichweite
  function hitFreeSeg(mx, my) {
    const H = freeHandles(), c = cfg(), f = c.pz.free; if (H.length < 2) return -1;
    const n = H.length, closed = !f.sym; let bi = -1, bd = 10;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = H[i], b = H[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, tt = l2 > 0 ? clamp(((mx - a.x) * dx + (my - a.y) * dy) / l2, 0, 1) : 0, d = Math.hypot(a.x + tt * dx - mx, a.y + tt * dy - my);
      if (d < bd && tt > 0.02 && tt < 0.98) { bd = d; bi = i; }
    }
    return bi;
  }
  function insertFree(mx, my) {
    const c = cfg(), f = c.pz.free, bi = hitFreeSeg(mx, my); if (bi < 0) return false;
    const t = xf2(), v0 = freeV0(c.pz), u = Math.round(t.U(mx) * 2) / 2, v = Math.round((t.V(my) + v0) * 2) / 2;
    f.pts.splice(bi + 1, 0, { u: f.sym ? Math.max(0, u) : u, v, r: 0, s: f.pts[bi].s ? 1 : 0 }); c.freeSel = bi + 1; return true;
  }
  function hitInst(mx, my) {
    const r = cache, t = xf2(); if (!r || !t) return -1;
    const L = cfg().inst.list || [], u = t.U(mx), v = t.V(my);
    for (let i = L.length - 1; i >= 0; i--) { const d = instDims(L[i], r.R.scale), du = u - L[i].u, dv = v - L[i].v; if (d.rect ? Math.abs(du) <= d.w / 2 && Math.abs(dv) <= d.h / 2 : du * du + dv * dv <= d.r * d.r) return i; }
    return -1;
  }
  function bind() {
    bound = true; let drag = false, pan = false, lx = 0, ly = 0, dragI = -1, dragF = -1, moved = false, du0 = 0, dv0 = 0;
    canvas.addEventListener('mousedown', e => {
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      lx = e.clientX; ly = e.clientY; moved = false; e.preventDefault();
      if (is2d() && (e.button === 0 || e.button === 2) && !e.shiftKey) {
        const h = hitFree(mx, my);
        if (h >= 0) {
          const c = cfg(), f = c.pz.free;
          if (e.button === 2) { if (f.pts.length > 3) { f.pts.splice(h, 1); c.freeSel = Math.max(0, h - 1); if (App.buildSidebar) App.buildSidebar(); render(); } return; }
          c.freeSel = h; dragF = h; moved = false; draw(); return;
        }
        if (e.button === 0 && (e.ctrlKey || e.metaKey)) {   // Strg+Klick auf eine Strecke: Gerade <-> Spline
          const sg = hitFreeSeg(mx, my);
          if (sg >= 0) { const c = cfg(), q = c.pz.free.pts[sg]; q.s = q.s ? 0 : 1; c.freeSel = sg; if (App.buildSidebar) App.buildSidebar(); render(); return; }
        }
      }
      if (is2d() && e.button === 0 && !e.shiftKey) {
        const i = hitInst(mx, my);
        if (i >= 0) { const c = cfg(), t = xf2(), it = c.inst.list[i]; c.sel = i; dragI = i; du0 = t.U(mx) - it.u; dv0 = t.V(my) - it.v; draw(); return; }
      }
      drag = true; pan = e.shiftKey || e.button !== 0 || is2d();
    });
    window.addEventListener('mousemove', e => {
      if (dragF >= 0) {
        const r = canvas.getBoundingClientRect(), t = xf2(), c = cfg(), f = c.pz.free, q = f && f.pts[dragF]; if (!t || !q) return;
        const v0 = freeV0(c.pz), axis = f.sym && (dragF === 0 || dragF === f.pts.length - 1);
        let u = Math.round(t.U(e.clientX - r.left) * 2) / 2, v = Math.round((t.V(e.clientY - r.top) + v0) * 2) / 2;
        if (axis) u = 0; else if (f.sym) u = Math.max(0, u);
        if (u !== q.u || v !== q.v) {   // beim Ziehen nur den Umriss neu (schnell), das ganze Modell erst beim Loslassen
          q.u = u; q.v = v; moved = true;
          if (cache && cache.R) { const P = freeOutline(Object.assign({}, cache.R.pz, { free: f })); if (P) cache.outline = P; }
          draw();
        }
        return;
      }
      if (dragI >= 0) {
        const r = canvas.getBoundingClientRect(), t = xf2(), it = cfg().inst.list[dragI]; if (!t || !it) return;
        let u = t.U(e.clientX - r.left) - du0, v = t.V(e.clientY - r.top) - dv0;
        u = Math.round(u * 2) / 2; v = Math.round(v * 2) / 2; if (Math.abs(u) < 1) u = 0;
        if (u !== it.u || v !== it.v) { it.u = u; it.v = v; moved = true; draw(); }
        return;
      }
      if (!drag) return; const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
      if (is2d()) { cam2.px += dx; cam2.py += dy; } else if (pan) { cam.px += dx; cam.py += dy; } else { cam.yaw += dx * 0.01; cam.pitch = clamp(cam.pitch + dy * 0.01, -1.55, 1.55); pilotClip = false; }
      draw();
    });
    window.addEventListener('mouseup', () => {
      if (dragF >= 0) { dragF = -1; if (moved) { render(); if (App.buildSidebar) App.buildSidebar(); } else draw(); return; }
      if (dragI >= 0) { dragI = -1; if (App.buildSidebar) App.buildSidebar(); if (moved) render(); else draw(); }
      drag = false;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => { e.preventDefault(); const q = is2d() ? cam2 : cam; q.zoom = clamp(q.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.1, 60); draw(); }, { passive: false });
    canvas.addEventListener('dblclick', e => {
      if (is2d()) {
        const r = canvas.getBoundingClientRect(); if (insertFree(e.clientX - r.left, e.clientY - r.top)) { if (App.buildSidebar) App.buildSidebar(); render(); return; }
        Object.assign(cam2, { zoom: 1, px: 0, py: 0 });
      } else Object.assign(cam, CAM0);
      draw();
    });
    window.addEventListener('keydown', e => {
      if (state.activeTab !== 'cockpit' || !is2d() || /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) return;
      const c = cfg(), it = (c.inst.list || [])[c.sel]; if (!it) return;
      const st = e.shiftKey ? 5 : 0.5, d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] }[e.key];
      if (!d) return; e.preventDefault(); it.u = r1(it.u + d[0]); it.v = r1(it.v + d[1]); render(); if (App.buildSidebar) App.buildSidebar();
    });
    const vb = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
    const to3d = (over, pc) => { cfg().view = '3d'; pilotClip = !!pc; Object.assign(cam, CAM0, over || {}); if (App.buildSidebar) App.buildSidebar(); draw(); };
    vb('ckView3d', () => to3d({ yaw: cam.yaw, pitch: cam.pitch, zoom: cam.zoom, px: cam.px, py: cam.py }));
    vb('ckViewBrett', () => { cfg().view = 'brett'; if (App.buildSidebar) App.buildSidebar(); draw(); });
    vb('ckIso', () => to3d()); vb('ckPilot', () => to3d({ yaw: -Math.PI / 2, pitch: 0.12 }, true)); vb('ckSide', () => to3d({ yaw: 0, pitch: 0 })); vb('ckTop', () => to3d({ yaw: 0, pitch: 1.5 }));
    vb('ckFus', () => { const c = cfg(); c.showFus = !c.showFus; render(); });
    vb('ckWire', () => { const c = cfg(); c.wire = !c.wire; draw(); });
    if (window.ViewCube) ViewCube.attach({ reset: () => Object.assign(cam, CAM0), canvas: () => canvas, get: () => cam, set: (y, p) => { cam.yaw = y; cam.pitch = p; }, redraw: () => draw(), rot: ViewCube.ROT_STD, k: [0.01, 0.01], active: () => !is2d() && state.activeTab === 'cockpit',
      labels: { '-x': 'Nase', '+x': 'Heck', '+y': 'Oben', '-y': 'Unten', '+z': 'Links', '-z': 'Rechts' } });
  }
  function cssVar(name, fb) { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb; } catch (e) { return fb; } }
  function hexRGB(h, fb) { const m = /^#([0-9a-f]{6})$/i.exec(h || ''); return m ? [parseInt(m[1].slice(0, 2), 16) / 255, parseInt(m[1].slice(2, 4), 16) / 255, parseInt(m[1].slice(4, 6), 16) / 255] : fb; }
  function bgRGB() {
    try { ctx.fillStyle = cssVar('--bg', '#0f1216'); const n = ctx.fillStyle; let m = hexRGB(n, null); if (m) return m; m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(n); if (m) return [m[1] / 255, m[2] / 255, m[3] / 255]; } catch (e) {}
    return [0.06, 0.07, 0.09];
  }
  let glc = null, gl = null, glP = null, glL = null, glVao = null, glTried = false;
  const glBufs = new Map();
  function glInit() {
    if (glTried || !canvas) return; glTried = true;
    try {
      glc = document.createElement('canvas'); glc.id = 'cCockpitGL'; glc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
      canvas.parentNode.insertBefore(glc, canvas);
      gl = glc.getContext('webgl2', { antialias: true, alpha: false, depth: true }); if (!gl) throw new Error('no webgl2');
      const VS = `#version 300 es
        in vec3 aPos; in float aTag; out vec3 vW;
        uniform vec3 uCenter; uniform float uYaw; uniform float uPitch; uniform vec4 uProj; uniform float uZScale;
        out vec3 vCam; flat out int vTag;
        vec3 rot(vec3 p){ float cy = cos(uYaw), sy = sin(uYaw), cp = cos(uPitch), sp = sin(uPitch);
          float x1 = p.x*cy + p.z*sy, z1 = -p.x*sy + p.z*cy; return vec3(x1, p.y*cp - z1*sp, p.y*sp + z1*cp); }
        void main(){ vec3 c = rot(aPos - uCenter); vCam = c; vW = aPos; vTag = int(aTag + 0.5);
          gl_Position = vec4(uProj.z + uProj.x*c.x, uProj.w + uProj.y*c.y, -c.z*uZScale, 1.0); }`;
      const FS = `#version 300 es
        precision highp float;
        in vec3 vCam; in vec3 vW; flat in int vTag; uniform vec3 uCol[7]; uniform vec3 uLight; uniform int uWire; uniform vec3 uBg; uniform float uClipX; out vec4 o;
        void main(){ if (vW.x > uClipX) discard; vec3 col = uCol[vTag];
          if (uWire == 2) { o = vec4(uBg, 1.0); return; }
          if (uWire == 1) { o = vec4(min(vec3(1.0), col * 1.2 + 0.06), 1.0); return; }
          if (uWire == 3) { o = vec4(col, 1.0); return; }
          vec3 n = normalize(cross(dFdx(vCam), dFdy(vCam))); if (n.z < 0.0) n = -n;
          float lam = max(0.0, dot(n, uLight)); o = vec4(col * (0.30 + 0.70*lam), 1.0); }`;
      const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
      glP = gl.createProgram(); gl.attachShader(glP, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(glP, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(glP);
      if (!gl.getProgramParameter(glP, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glP));
      glL = {}; for (const u of ['uCenter', 'uYaw', 'uPitch', 'uProj', 'uZScale', 'uCol', 'uLight', 'uWire', 'uBg', 'uClipX']) glL[u] = gl.getUniformLocation(glP, u);
      glL.aPos = gl.getAttribLocation(glP, 'aPos'); glL.aTag = gl.getAttribLocation(glP, 'aTag');
      glVao = gl.createVertexArray();
      glc.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; glBufs.clear(); }, false);
    } catch (e) {
      console.warn('Cockpit: WebGL2 nicht verfügbar, Canvas-2D-Darstellung:', e && e.message);
      gl = null; if (glc && glc.parentNode) glc.parentNode.removeChild(glc); glc = null;
    }
  }
  function glBuf(key, v, tag, lines) {
    let b = glBufs.get(key);
    if (b && b.src === v) { b.used = true; return b; }
    if (b) { gl.deleteBuffer(b.vbo); if (b.lbo) gl.deleteBuffer(b.lbo); }
    const n = v.length / 3, d = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { d[i * 4] = v[i * 3]; d[i * 4 + 1] = v[i * 3 + 1]; d[i * 4 + 2] = v[i * 3 + 2]; d[i * 4 + 3] = tag; }
    b = { vbo: gl.createBuffer(), n, src: v, used: true, tag };
    gl.bindBuffer(gl.ARRAY_BUFFER, b.vbo); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
    if (!lines) {   // Kanten fürs Drahtgitter
      const nt = v.length / 9, e = new Float32Array(nt * 24);
      for (let t = 0, q = 0; t < nt; t++) for (let k = 0; k < 3; k++) for (const m of [k, (k + 1) % 3]) { const i = t * 9 + m * 3; e[q++] = v[i]; e[q++] = v[i + 1]; e[q++] = v[i + 2]; e[q++] = tag; }
      b.lbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b.lbo); gl.bufferData(gl.ARRAY_BUFFER, e, gl.STATIC_DRAW); b.nl = nt * 6;
    }
    glBufs.set(key, b); return b;
  }
  function glDraw(r) {
    const dpr = window.devicePixelRatio || 1, w = Math.max(1, Math.round(W * dpr)), h = Math.max(1, Math.round(H * dpr));
    if (glc.width !== w || glc.height !== h) { glc.width = w; glc.height = h; }
    const bg = bgRGB(), wire = !!cfg().wire;
    gl.viewport(0, 0, w, h); gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    for (const b of glBufs.values()) b.used = false;
    gl.useProgram(glP); gl.bindVertexArray(glVao); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    const s = 0.42 * Math.min(W, H) / radius * cam.zoom;
    gl.uniform4f(glL.uProj, 2 * s / W, 2 * s / H, 2 * cam.px / W, -2 * cam.py / H); gl.uniform1f(glL.uZScale, 1 / (depthR * 1.6));
    gl.uniform3f(glL.uCenter, center[0], center[1], center[2]); gl.uniform1f(glL.uYaw, cam.yaw); gl.uniform1f(glL.uPitch, cam.pitch);
    gl.uniform3f(glL.uLight, LIGHT[0], LIGHT[1], LIGHT[2]); gl.uniform3f(glL.uBg, bg[0], bg[1], bg[2]); gl.uniform1f(glL.uClipX, clipX());
    gl.uniform3fv(glL.uCol, new Float32Array(COL_KEYS.flatMap(k => hexRGB(colOf(k), [0.6, 0.6, 0.6]))));
    const bindB = buf => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(glL.aPos); gl.vertexAttribPointer(glL.aPos, 3, gl.FLOAT, false, 16, 0); gl.enableVertexAttribArray(glL.aTag); gl.vertexAttribPointer(glL.aTag, 1, gl.FLOAT, false, 16, 12); };
    const bufs = r.items.map((it, i) => glBuf('i' + i, it.v, it.tag));
    if (!wire) { gl.uniform1i(glL.uWire, 0); for (const b of bufs) { bindB(b.vbo); gl.drawArrays(gl.TRIANGLES, 0, b.n); } }
    else {
      gl.uniform1i(glL.uWire, 2); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 2);
      for (const b of bufs) { bindB(b.vbo); gl.drawArrays(gl.TRIANGLES, 0, b.n); }
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));   // Treiberfalle (ANGLE): sonst gehen Linien nach Flächen ab dem 2. Bild verloren
    if (wire) { gl.uniform1i(glL.uWire, 1); for (const b of bufs) { bindB(b.lbo); gl.drawArrays(gl.LINES, 0, b.nl); } }
    if (r.lines && r.lines.length) { const b = glBuf('fus', r.lines, 5, true); gl.uniform1i(glL.uWire, 3); bindB(b.vbo); gl.drawArrays(gl.LINES, 0, b.n); }
    gl.bindVertexArray(null);
    for (const [k, b] of glBufs) if (!b.used) { gl.deleteBuffer(b.vbo); if (b.lbo) gl.deleteBuffer(b.lbo); glBufs.delete(k); }
  }
  // Pilotensicht: alles hinter der Blende (Wanne, Lehne) ausblenden, sonst verdeckt die Lehne das Brett
  let pilotClip = false;
  function clipX() { const p = cache && cache.R && cache.R.pz; return pilotClip && p ? p.x + p.lip + 2 * p.wall + 3 : 1e9; }
  function drawShaded(r) {
    const faces = [], wire = !!cfg().wire, cols = COL_KEYS.map(k => hexRGB(colOf(k), [0.6, 0.6, 0.6]).map(x => Math.round(x * 255)));
    for (const it of r.items) {
      const v = it.v;
      const cx = clipX();
      for (let i = 0; i < v.length; i += 9) {
        if ((v[i] + v[i + 3] + v[i + 6]) / 3 > cx) continue;
        const ux = v[i + 3] - v[i], uy = v[i + 4] - v[i + 1], uz = v[i + 5] - v[i + 2], wx = v[i + 6] - v[i], wy = v[i + 7] - v[i + 1], wz = v[i + 8] - v[i + 2];
        let n = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx]; const L = Math.hypot(...n) || 1; n = rot(n.map(x => x / L)); if (n[2] < 0) n = n.map(x => -x);
        const p0 = scr(v[i], v[i + 1], v[i + 2]), p1 = scr(v[i + 3], v[i + 4], v[i + 5]), p2 = scr(v[i + 6], v[i + 7], v[i + 8]);
        faces.push({ p: [p0, p1, p2], d: (p0.d + p1.d + p2.d) / 3, l: 0.3 + 0.7 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]), c: cols[it.tag] });
      }
    }
    faces.sort((a, b) => a.d - b.d);
    if (r.lines) { ctx.strokeStyle = colOf('ckColFus'); ctx.lineWidth = 1; ctx.beginPath(); const L = r.lines; for (let i = 0; i < L.length; i += 6) { const a = scr(L[i], L[i + 1], L[i + 2]), b = scr(L[i + 3], L[i + 4], L[i + 5]); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } ctx.stroke(); }
    for (const f of faces) {
      ctx.beginPath(); ctx.moveTo(f.p[0].x, f.p[0].y); ctx.lineTo(f.p[1].x, f.p[1].y); ctx.lineTo(f.p[2].x, f.p[2].y); ctx.closePath();
      if (wire) { ctx.fillStyle = cssVar('--bg', '#0f1216'); ctx.strokeStyle = 'rgb(' + f.c.join(',') + ')'; }
      else ctx.fillStyle = ctx.strokeStyle = (window.DrawTheme ? DrawTheme.raw('rgb(' + f.c.map(x => Math.round(x * f.l)).join(',') + ')') : 'rgb(' + f.c.map(x => Math.round(x * f.l)).join(',') + ')');
      ctx.fill(); ctx.stroke();
    }
  }
  // Rumpfkontur in der Brettebene (u, v): Schnitt der Rumpfhaut (gap = 0) bzw. der Grenze mit Abstand (wie fitFree) mit der
  // Brettebene — sternförmig um einen Punkt auf der Mittellinie, je Strahl Marsch + Bisektion; zwischengespeichert
  let fusCtr = null;
  function fusContour(r) {
    const F = r.F, p = r.R.pz; if (!F) return null;
    const c = cfg(), mg = Math.max(0, +c.tub.gap || 0) + (p.hood ? p.wall : 0) + 1;
    const key = [p.x, p.yB, p.tiltR, p.t, p.h, mg].join('|');
    if (fusCtr && fusCtr.F === F && fusCtr.key === key) return fusCtr;
    const fr = frame(p), skin = fusTester(F, 0), lim = fusTester(F, mg);
    const okS = (u, v) => !skin(fr.map(u, v, 0)), okL = (u, v) => !lim(fr.map(u, v, 0)) && !lim(fr.map(u, v, -p.t));
    // Mittelpunkt: Abschnitt auf u = 0 innerhalb der Haut, der v = h/2 enthält (sonst der nächstliegende)
    const segs = []; let s0 = null;
    for (let v = -400; v <= p.h + 400; v += 1) { const o = okS(0, v); if (o && s0 === null) s0 = v; if (!o && s0 !== null) { segs.push([s0, v - 1]); s0 = null; } }
    if (s0 !== null) segs.push([s0, p.h + 400]);
    if (!segs.length) { fusCtr = { F, key, skin: null, lim: null }; return fusCtr; }
    const dS = g => (g[0] <= p.h / 2 && g[1] >= p.h / 2 ? 0 : Math.min(Math.abs(g[0] - p.h / 2), Math.abs(g[1] - p.h / 2)));
    const g = segs.reduce((a, b) => (dS(b) < dS(a) ? b : a)), cv = (g[0] + g[1]) / 2;
    const ring = ok => {
      if (!ok(0, cv)) return null;
      const N = 240, out = [];
      for (let i = 0; i < N; i++) {
        const a = 2 * Math.PI * i / N, du = Math.cos(a), dv = Math.sin(a); let lo = 0, hi = 0, st = 2;
        while (hi < 1500) { hi += st; if (!ok(du * hi, cv + dv * hi)) break; lo = hi; }
        if (hi >= 1500) continue;
        for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (ok(du * m, cv + dv * m)) lo = m; else hi = m; }
        out.push([du * lo, cv + dv * lo]);
      }
      return out.length > 8 ? out : null;
    };
    fusCtr = { F, key, skin: ring(okS), lim: ring(okL), mg };
    return fusCtr;
  }
  function drawBrett(r) {
    const c = cfg(), t = xf2(), P = r.outline; if (!t || !P) return;
    const path = Q => { ctx.beginPath(); Q.forEach((q, i) => (i ? ctx.lineTo(t.X(q[0]), t.Y(q[1])) : ctx.moveTo(t.X(q[0]), t.Y(q[1])))); ctx.closePath(); };
    // Raster 10 mm
    ctx.save(); ctx.strokeStyle = 'rgba(128,140,160,.12)'; ctx.lineWidth = 1;
    const u0 = Math.floor(t.U(0) / 10) * 10, u1 = t.U(W), v0 = Math.floor(t.V(H) / 10) * 10, v1 = t.V(0);
    ctx.beginPath(); for (let u = u0; u <= u1; u += 10) { ctx.moveTo(t.X(u), 0); ctx.lineTo(t.X(u), H); } for (let v = v0; v <= v1; v += 10) { ctx.moveTo(0, t.Y(v)); ctx.lineTo(W, t.Y(v)); } ctx.stroke();
    ctx.strokeStyle = 'rgba(128,140,160,.35)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(t.X(0), 0); ctx.lineTo(t.X(0), H); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
    path(P); ctx.fillStyle = colOf('ckColBrett'); ctx.fill(); ctx.strokeStyle = colOf('ckColPilz'); ctx.lineWidth = Math.max(1.5, (r.R.pz.hood ? r.R.pz.wall : 0.3) * t.s); ctx.stroke();
    // selbst gezeichneter Umriss: Rumpfkontur an der Stelle des Pilzes (Brettebene) + Grenze mit Abstand (gestrichelt)
    if (c.pz.shape === 'free') {
      const K = fusContour(r);
      if (K && K.skin) {
        ctx.save(); ctx.strokeStyle = colOf('ckColFus'); ctx.lineWidth = 1.8; path(K.skin); ctx.stroke();
        if (K.lim) { ctx.lineWidth = 1; ctx.setLineDash([5, 4]); path(K.lim); ctx.stroke(); ctx.setLineDash([]); }
        let top = K.skin[0]; for (const q of K.skin) if (q[1] > top[1]) top = q;
        ctx.fillStyle = colOf('ckColFus'); ctx.font = '11px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText(T('Rumpfkontur (Brettebene)') + (K.lim ? ' · - - ' + T('Abstand') + ' ' + r1(K.mg) + ' mm' : ''), t.X(top[0]) + 8, t.Y(top[1]) - 4);
        ctx.restore();
      }
    }
    const sc = r.R.scale, bez = Math.max(0, +c.inst.bez || 0), okSet = new Set(r.ok.map(o => o.i));
    (c.inst.list || []).forEach((it, i) => {
      const d = instDims(it, sc), im = dialImg(it, sc), x = t.X(it.u), y = t.Y(it.v);
      ctx.save(); path(instPoly(it, sc, 0, 64)); ctx.clip();
      if (im) { const w = (d.rect ? d.w : 2 * d.r) * t.s, h = (d.rect ? d.h : 2 * d.r) * t.s; ctx.drawImage(im, x - w / 2, y - h / 2, w, h); } else { ctx.fillStyle = '#0c0c0d'; ctx.fill(); }
      ctx.restore();
      if (bez > 0.05) { path(instPoly(it, sc, bez / 2, 64)); ctx.strokeStyle = colOf('ckColRing'); ctx.lineWidth = Math.max(1, bez * t.s); ctx.stroke(); }
      if (c.inst.screws) for (const s of screwPts(it, sc, bez)) { ctx.beginPath(); ctx.arc(t.X(s[0]), t.Y(s[1]), Math.max(1, s[2] * t.s), 0, 2 * Math.PI); ctx.fillStyle = '#9aa0a6'; ctx.fill(); }
      if (!okSet.has(i)) { path(instPoly(it, sc, 0.5, 64)); ctx.strokeStyle = '#ff5a4a'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]); ctx.stroke(); ctx.setLineDash([]); }
      if (i === c.sel) {
        path(instPoly(it, sc, bez + 1.2, 64)); ctx.strokeStyle = '#59a8ff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = cssVar('--txt', '#dde'); ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(T((KINDS[it.k] || KINDS.blank).name) + '  u ' + r1(it.u) + ' · v ' + r1(it.v) + ' mm', x, y + ((d.rect ? d.h / 2 : d.r) + bez + 2) * t.s);
      }
    });
    // gezeichneter Umriss: Krümmungskamm (Entwurf vor dem Stutzen, ohne Eckradien) + Punkte
    const FH = freeHandles();
    if (FH.length && c.comb) { const K = freeComb(c.pz); if (K) drawCombG(ctx, K, (u, v) => [t.X(u), t.Y(v)], t.s, +c.combLen || 40); }
    if (FH.length) {
      ctx.save(); ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      const fp = c.pz.free.pts, nS = c.pz.free.sym ? FH.length - 1 : FH.length;   // Hilfslinie je Strecke: gelb = Gerade, blau = Spline
      for (let k = 0; k < nS; k++) {
        const a = FH[k], b = FH[(k + 1) % FH.length]; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = fp[k] && fp[k].s ? 'rgba(110,180,255,.7)' : 'rgba(255,200,80,.55)'; ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const h of FH) { ctx.beginPath(); ctx.arc(h.x, h.y, h.i === (c.freeSel | 0) ? 6 : 4.5, 0, 2 * Math.PI); ctx.fillStyle = h.i === (c.freeSel | 0) ? '#ffd23f' : '#e0a030'; ctx.fill(); ctx.strokeStyle = '#222'; ctx.stroke(); }
      ctx.restore();
    }
    // Maße
    const p = r.R.pz; ctx.fillStyle = cssVar('--txt', '#dde'); ctx.globalAlpha = 0.75; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(T('Breite oben') + ' ' + r1(p.wT) + ' mm', t.X(0), t.Y(p.h) - 6); ctx.textBaseline = 'top'; ctx.fillText(T(p.isPilz ? 'Breite an der Schulter' : 'Breite unten') + ' ' + r1(p.wB) + ' mm · ' + T('Höhe') + ' ' + r1(p.h) + ' mm', t.X(0), t.Y(0) + 6); ctx.globalAlpha = 1;
  }
  function setInfo(html, bad) { const el = document.getElementById('cockpitInfo'); if (el) { el.innerHTML = html; el.style.color = bad ? '#f88' : ''; } }
  function syncBtns() {
    const c = cfg(), on = (id, v) => { const b = document.getElementById(id); if (b) b.classList.toggle('primary', !!v); };
    on('ckView3d', !is2d()); on('ckViewBrett', is2d()); on('ckFus', c.showFus); on('ckWire', c.wire);
    for (const id of ['ckIso', 'ckPilot', 'ckSide', 'ckTop', 'ckFus', 'ckWire']) { const b = document.getElementById(id); if (b) b.style.display = is2d() ? 'none' : ''; }
  }
  function draw() {
    if (!ctx) return;
    const r = cache; syncBtns();
    ctx.fillStyle = cssVar('--bg', '#0f1216'); ctx.fillRect(0, 0, W, H);
    if (!r) { if (glc) glc.style.display = 'none'; return; }
    const warnHtml = r.warn.length ? '<br><span style="color:#fb8">' + r.warn.join('<br>') + '</span>' : '';
    if (is2d()) {
      if (glc) glc.style.display = 'none';
      drawBrett(r);
      const n = (cfg().inst.list || []).length;
      const cc = cfg(), K = cc.pz.shape === 'free' ? freeComb(cc.pz) : null;
      setInfo(T('Instrumentenbrett (Pilotensicht)') + ' · ' + n + ' ' + T('Instrumente') + ' · ' + T('Maßstab') + ' 1:' + r1(r.R.scale)
        + (K ? '<br>' + T(splC2() ? 'krümmungsstetig (C2)' : 'Catmull-Rom') + ' · ' + T('Umriss') + ': ' + combText(K) + (cc.comb ? ' <span style="color:#ffe14d">◯</span> = ' + T('Wendepunkt') : '') : '') + warnHtml
        + '<br><span style="opacity:.7">' + T('Instrument ziehen = verschieben (0,5-mm-Raster) · Pfeiltasten = fein (Shift = 5 mm) · Ziehen daneben = schieben · Rad = Zoom') + '</span>');
      return;
    }
    if (!r.items.length) { if (glc) glc.style.display = 'none'; setInfo(T('Kein Bauteil eingeschaltet.') + warnHtml, true); return; }
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; let ntri = 0;
    for (const it of r.items) { const v = it.v; ntri += v.length / 9; for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { if (v[i + k] < mn[k]) mn[k] = v[i + k]; if (v[i + k] > mx[k]) mx[k] = v[i + k]; } }
    center = Array.isArray(cam.center) ? cam.center.slice() : [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];   // cam.center: fester Blickpunkt (Test)
    radius = Math.max(1, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2) * 1.1;
    depthR = radius;
    if (r.lines) { const L = r.lines; for (let i = 0; i < L.length; i += 3) depthR = Math.max(depthR, Math.hypot(L[i] - center[0], L[i + 1] - center[1], L[i + 2] - center[2])); }
    if (!glTried) glInit();
    if (gl) { glc.style.display = ''; glDraw(r); ctx.clearRect(0, 0, W, H); } else drawShaded(r);
    const p = r.R.pz;
    setInfo(r.items.length + ' ' + T('Körper') + ' · ' + Math.round(ntri) + ' ' + T('Dreiecke')
      + '<br>' + T('Brett') + ' ' + r1(p.wT) + ' / ' + r1(p.wB) + ' × ' + r1(p.h) + ' mm · ' + T('Neigung') + ' ' + r1(+cfg().pz.tilt || 0) + '° · ' + T('bei X') + ' ' + r1(p.x) + ' mm'
      + warnHtml
      + (r.over && r.over.length ? '<br><span style="color:#fb8">' + T('Überschneidungen') + ': ' + r.over.map(([a, b]) => T(ID_NAME[a] || a) + ' ↔ ' + T(ID_NAME[b] || b)).join(', ') + ' — ' + T('Gruppe „Stutzen“') + '</span>' : '')
      + '<br><span style="opacity:.7">' + T('Ziehen = drehen · Shift+Ziehen = schieben · Rad = Zoom · Doppelklick = zurück') + '</span>');
  }
  function render() { build(); if (fit()) draw(); }
  function show() { render(); }
  function resize() { if (fit()) draw(); }

  // ---------- Editor für die Oberkante des Pilzes (Seitenansicht) -----------------------------------------
  // Eigenes Fenster: Rumpfumriss, Haubenausschnitt, Haubenrahmen, Sicke, Brett, Sitzwanne und der aktuelle Pilz als
  // Projektion in der Seitenansicht; die Linie wird über Stützpunkte gezeichnet (ziehen, Doppelklick = einfügen,
  // Rechtsklick/Entf = löschen, Abschnitt gerade/Spline). Nach dem Loslassen wird das Cockpit neu gerechnet.
  let topEd = null; const topEds = {};
  // Linien im Editor: 'top' = Oberkante des angeschmiegten Pilzes, 'run' = Verlauf des geraden Pilzes (erster Punkt fest am Brett)
  const ED_KIND = {
    top: { store: () => cfg().pz.top, title: 'Oberkante des Pilzes — Seitenansicht', legend: 'Oberkante', reset: 'Aus dem Abstand neu anlegen',
      ask: 'Linie verwerfen und aus dem Abstand unter der Rumpfoberkante neu anlegen?', make: R => topFromDown(R), on: () => { const tp = cfg().pz.top; if (tp.mode === 'free') return false; tp.mode = 'free'; return true; }, fixed0: false },
    run: { store: () => { const pz = cfg().pz; if (!pz.runL || typeof pz.runL !== 'object') pz.runL = { pts: null }; return pz.runL; }, title: 'Verlauf des Pilzes — Seitenansicht (Oberseite in der Mitte)', legend: 'Verlauf',
      reset: 'Aus der Geraden neu anlegen', ask: 'Linie verwerfen und aus der Geraden (Neigung) neu anlegen?', make: R => runFromStraight(R), on: () => { const pz = cfg().pz; if (pz.runMode === 'line') return false; pz.runMode = 'line'; return true; }, fixed0: true }
  };
  function topSegs(pts, opt) {   // je Abschnitt die abgetastete Linie (aus topCurve: 1 bzw. 24 Punkte je Abschnitt); .comb = Kammproben
    const all = topCurve(pts, Object.assign({ comb: true }, opt)) || [], segs = []; let k = 0; segs.comb = all.comb || [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const n = pts[i].t === 'spline' ? 24 : 1, seg = all.slice(k, k + n + 1); k += n; segs.push(seg);
    }
    return segs;
  }
  // Projektionen für die Seitenansicht (einmal je Neuaufbau)
  function topEdData(kind) {
    const r = cache; if (!r || !r.F) return null;
    const F = r.F, R = r.R, p = R.pz, can = F.can, tp = ED_KIND[kind || 'top'].store(), pts = tp.pts || [];
    let xa = can ? can.x0 - 40 : p.x - 150, xb = p.x + 70;
    for (const q of pts) { xa = Math.min(xa, q.x - 20); xb = Math.max(xb, q.x + 20); }
    xa = Math.max(F.x0, xa); xb = Math.min(F.x1, xb);
    const n = 160, top = [], bot = [];
    for (let i = 0; i <= n; i++) { const x = xa + (xb - xa) * i / n; top.push([x, F.top(x)]); bot.push([x, F.bot(x)]); }
    const D = { xa, xb, top, bot, can: null, frame: [], sicke: [], pilz: [], wanne: [], brett: null, R };
    if (can && Array.isArray(can.line)) {
      D.can = can.line;
      const fr = can.frame, N = resampleOpen(can.line, 200), sk = can.sicke;
      const offLine = d => {   // Linie gleichen Abstands d (Seitenansicht) zur Haube hin, an der Oberkante begrenzt
        const o = [];
        for (let i = 0; i < N.length; i++) {
          const a = N[Math.max(0, i - 1)], b = N[Math.min(N.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
          let nx = -dy / L, ny = dx / L; if (can.sd(N[i][0] + nx, N[i][1] + ny) < can.sd(N[i][0] - nx, N[i][1] - ny)) { nx = -nx; ny = -ny; }
          const x = N[i][0] + nx * d, y = N[i][1] + ny * d; if (x < F.x0 || x > F.x1) continue;
          o.push([x, Math.min(y, F.top(x))]);
        }
        return o;
      };
      if (fr) { D.frame = [offLine(fr.h)]; if (fr.s0 && fr.s0() > 0.05) D.frame.push(offLine(fr.s0())); }
      if (sk) for (let j = 1; j <= sk.n; j++) D.sicke.push(offLine(j * sk.w));
    }
    // Teile in der Mittelebene: höchste/tiefste Punkte je x (Projektion des Schnitts bei z ≈ 0)
    const prof = (id, tol) => {
      const bins = new Map();
      for (const it of r.items) if (it.id === id) for (let i = 0; i < it.v.length; i += 3) {
        if (Math.abs(it.v[i + 2]) > tol) continue;
        const k = Math.round(it.v[i] * 2) / 2, b = bins.get(k); const y = it.v[i + 1];
        if (!b) bins.set(k, [y, y]); else { b[0] = Math.min(b[0], y); b[1] = Math.max(b[1], y); }
      }
      const ks = [...bins.keys()].sort((a, b) => a - b);
      return { hi: ks.map(k => [k, bins.get(k)[1]]), lo: ks.map(k => [k, bins.get(k)[0]]) };
    };
    D.pilz = prof('haube', 1.0); D.wanne = prof('wanne', 1.0);
    const s = Math.sin(p.tiltR), c = Math.cos(p.tiltR);
    D.brett = [[p.x, p.yB], [p.x - p.h * s, p.yB + p.h * c], [p.x - p.h * s + p.t * c, p.yB + p.h * c + p.t * s], [p.x + p.t * c, p.yB + p.t * s]];
    return D;
  }
  function openTopEditor(kind) {
    kind = kind === 'run' ? 'run' : 'top';
    const K = ED_KIND[kind], tp = K.store();
    if (!cache || !cache.F) { alert(T('Der Editor braucht einen Rumpf mit Kabinenhaube aus dem Rumpf.')); return; }
    if (!(Array.isArray(tp.pts) && tp.pts.length >= 2)) tp.pts = K.make(cache.R);
    if (!(Array.isArray(tp.pts) && tp.pts.length >= 2)) { alert(T('Linie kann noch nicht angelegt werden — der Pilz wird gerade nicht erzeugt.')); return; }
    if (K.on()) rebuildAll();
    for (const k in topEds) if (k !== kind) topEds[k].el.style.display = 'none';
    if (topEds[kind]) { topEd = topEds[kind]; topEd.el.style.display = 'flex'; topEd.refresh(); return; }
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:6vw;top:8vh;width:min(1100px,88vw);height:min(640px,82vh);z-index:9000;display:flex;flex-direction:column;background:var(--panel,#1b1f26);color:var(--txt,#dde);border:1px solid var(--line,#445);border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.55);resize:both;overflow:hidden;min-width:420px;min-height:300px';
    el.innerHTML = '<div class="ckTopHead" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 8px;border-bottom:1px solid var(--line,#445);cursor:move;user-select:none">'
      + '<b style="margin-right:8px">' + T(K.title) + '</b><span class="ckTopBtns" style="display:flex;gap:4px;flex-wrap:wrap"></span>'
      + '<span style="flex:1"></span><span class="ckTopXY" style="font:12px var(--mono,monospace);color:var(--muted,#9ab)"></span></div>'
      + '<div style="position:relative;flex:1;min-height:0"><canvas class="ckTopCv" style="position:absolute;inset:0;width:100%;height:100%;cursor:crosshair"></canvas></div>'
      + '<div style="padding:4px 8px;border-top:1px solid var(--line,#445);font-size:12px;color:var(--muted,#9ab)">' + T('Stützpunkte ziehen · Doppelklick auf die Linie = Punkt einfügen · Rechtsklick oder Entf = Punkt löschen · Mausrad = Zoom · Ziehen auf freier Fläche = verschieben · Doppelklick auf freie Fläche = alles zeigen') + '</div>';
    document.body.appendChild(el);
    const cv = el.querySelector('.ckTopCv'), ctx2 = cv.getContext('2d'), btns = el.querySelector('.ckTopBtns'), xy = el.querySelector('.ckTopXY');
    const st = { D: null, sel: -1, drag: -1, pan: null, view: null, hover: null };
    const mk = (label, fn, title) => { const b = mkMiniBtn(T(label), fn); if (title) b.title = T(title); btns.appendChild(b); return b; };
    let bType, bDel;
    mk(K.reset, () => { if (!confirm(T(K.ask))) return; const n = K.make(cache.R); if (n) tp.pts = n; st.sel = -1; commit(); });
    bType = mk('Abschnitt: gerade', () => { const q = tp.pts[st.sel]; if (!q || st.sel >= tp.pts.length - 1) return; q.t = q.t === 'spline' ? 'line' : 'spline'; commit(); }, 'Art des Abschnitts hinter dem gewählten Punkt umschalten (gerade ↔ Spline).');
    bDel = mk('Punkt löschen', () => delPt(st.sel));
    mk('Krümmungskamm', () => { cfg().comb = !cfg().comb; draw2(); if (fit()) draw(); }, 'Krümmungskamm ein/aus: Zähne senkrecht zur Linie, Länge = Krümmung; Sprung im Kamm = Krümmungssprung, gelber Ring = Wendepunkt.');
    mk('Alles zeigen', () => { st.view = null; draw2(); });
    mk('Schließen', () => { el.style.display = 'none'; });
    // Fenster am Kopf verschieben
    { const head = el.querySelector('.ckTopHead'); let d0 = null;
      head.addEventListener('mousedown', e => { if (e.target.closest('button')) return; const r = el.getBoundingClientRect(); d0 = [e.clientX - r.left, e.clientY - r.top]; e.preventDefault(); });
      window.addEventListener('mousemove', e => { if (!d0) return; el.style.left = Math.max(0, e.clientX - d0[0]) + 'px'; el.style.top = Math.max(0, e.clientY - d0[1]) + 'px'; });
      window.addEventListener('mouseup', () => { d0 = null; }); }
    const size = () => { const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr)); return { w: r.width, h: r.height, dpr }; };
    const fitView = (w, h) => {
      const D = st.D; let y0 = Infinity, y1 = -Infinity;
      // Ausschnitt: Rumpfoberkante bis unter das Brett (bzw. die Haubenunterkante) — der Boden ist hier unwichtig
      for (const q of D.top) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
      for (const q of tp.pts) { y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
      for (const q of (D.can || []).concat(D.brett || [])) if (q[0] >= D.xa && q[0] <= D.xb) y0 = Math.min(y0, q[1]);
      y0 -= 8; y1 += 6;
      const sx = (w - 40) / Math.max(1, D.xb - D.xa), sy = (h - 40) / Math.max(1, y1 - y0), s = Math.min(sx, sy);
      return { s, ox: w / 2 - s * (D.xa + D.xb) / 2, oy: h / 2 + s * (y0 + y1) / 2 };
    };
    const P = (x, y) => [st.view.ox + st.view.s * x, st.view.oy - st.view.s * y];
    const Pinv = (u, v) => [(u - st.view.ox) / st.view.s, (st.view.oy - v) / st.view.s];
    const cssVar = (k, d) => { const v = getComputedStyle(document.documentElement).getPropertyValue(k).trim(); return v || d; };
    function draw2() {
      if (!st.D) return;
      const { w, h, dpr } = size(); if (!st.view) st.view = fitView(w, h);
      const g = ctx2; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = cssVar('--bg', '#0f1216'); g.fillRect(0, 0, w, h);
      const D = st.D, line = (L, col, wd, dash) => { if (!L || L.length < 2) return; g.beginPath(); L.forEach((q, i) => { const a = P(q[0], q[1]); i ? g.lineTo(a[0], a[1]) : g.moveTo(a[0], a[1]); }); g.strokeStyle = col; g.lineWidth = wd; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]); };
      // Raster 10 mm
      { const step = st.view.s * 10 < 12 ? 50 : 10, [xa, yb] = Pinv(0, h), [xb, yt] = Pinv(w, 0); g.strokeStyle = 'rgba(128,140,160,.12)'; g.lineWidth = 1; g.beginPath();
        for (let x = Math.ceil(xa / step) * step; x <= xb; x += step) { const a = P(x, 0)[0]; g.moveTo(a, 0); g.lineTo(a, h); }
        for (let y = Math.ceil(yb / step) * step; y <= yt; y += step) { const a = P(0, y)[1]; g.moveTo(0, a); g.lineTo(w, a); } g.stroke(); }
      // Rumpf (Fläche + Umriss)
      g.beginPath(); D.top.forEach((q, i) => { const a = P(q[0], q[1]); i ? g.lineTo(a[0], a[1]) : g.moveTo(a[0], a[1]); }); for (let i = D.bot.length - 1; i >= 0; i--) { const a = P(D.bot[i][0], D.bot[i][1]); g.lineTo(a[0], a[1]); } g.closePath();
      g.fillStyle = 'rgba(79,127,191,.10)'; g.fill();
      line(D.top, colOf('ckColFus'), 1.5); line(D.bot, colOf('ckColFus'), 1.5);
      // Sitzwanne, Haubenausschnitt, Sicke, Haubenrahmen, Brett, Pilz
      if (D.wanne.hi.length) { line(D.wanne.hi, colOf('ckColWanne'), 1, [3, 3]); line(D.wanne.lo, colOf('ckColWanne'), 1, [3, 3]); }
      if (D.can) line(D.can, '#8fd3f4', 2);
      for (const L of D.sicke) line(L, 'rgba(143,211,244,.6)', 1, [4, 3]);
      for (const L of D.frame) line(L, colOf('ckColRahmen'), 1.5, [8, 3, 2, 3]);
      if (D.brett) { g.beginPath(); D.brett.forEach((q, i) => { const a = P(q[0], q[1]); i ? g.lineTo(a[0], a[1]) : g.moveTo(a[0], a[1]); }); g.closePath(); g.fillStyle = colOf('ckColBrett'); g.fill(); g.strokeStyle = colOf('ckColPilz'); g.lineWidth = 1; g.stroke(); }
      if (D.pilz.hi.length) { line(D.pilz.hi, colOf('ckColPilz'), 2.5); line(D.pilz.lo, colOf('ckColPilz'), 1, [2, 2]); }
      // Linie + Stützpunkte
      const segs = topSegs(tp.pts);
      if (cfg().comb) drawCombG(g, segs.comb, P, st.view.s, +cfg().combLen || 40);
      segs.forEach((S, i) => line(S, i === st.sel && st.sel < tp.pts.length - 1 ? '#ffd54a' : '#ffb347', 2.2, tp.pts[i].t === 'spline' ? [] : [10, 0]));
      tp.pts.forEach((q, i) => { const a = P(q.x, q.y); g.beginPath(); g.rect(a[0] - 5, a[1] - 5, 10, 10); g.fillStyle = i === st.sel ? '#ffd54a' : '#1b1f26'; g.fill(); g.strokeStyle = '#ffb347'; g.lineWidth = 2; g.stroke(); });
      // Legende
      const leg = [[T('Rumpf'), colOf('ckColFus')], [T('Haubenausschnitt'), '#8fd3f4'], [T('Haubenrahmen'), colOf('ckColRahmen')], [T('Brett'), colOf('ckColBrett')], [T('Pilz (Mittelschnitt)'), colOf('ckColPilz')], [T(K.legend) + ' · ' + combText(segs.comb), '#ffb347']];
      g.font = '11px system-ui'; let ly = h - 8 - 15 * leg.length + 8; for (const [t, col] of leg) { g.fillStyle = col; g.fillRect(10, ly - 8, 14, 3); g.fillStyle = cssVar('--txt', '#dde'); g.fillText(t, 30, ly - 4); ly += 15; }
      const q = tp.pts[st.sel]; bType.disabled = !q || st.sel >= tp.pts.length - 1; bDel.disabled = !q || tp.pts.length <= 2 || (K.fixed0 && st.sel === 0);
      bType.textContent = T(q && q.t === 'spline' ? 'Abschnitt: Spline → gerade' : 'Abschnitt: gerade → Spline');
      xy.textContent = q ? T('Punkt') + ' ' + (st.sel + 1) + ': X ' + q.x.toFixed(1) + '  Y ' + q.y.toFixed(1) + ' mm' : (st.hover ? 'X ' + st.hover[0].toFixed(1) + '  Y ' + st.hover[1].toFixed(1) + ' mm' : '');
    }
    const hitPt = (u, v) => { let best = -1, bd = 9; tp.pts.forEach((q, i) => { const a = P(q.x, q.y), d = Math.hypot(a[0] - u, a[1] - v); if (d < bd) { bd = d; best = i; } }); return best; };
    const hitSeg = (u, v) => { let best = -1, bd = 8; topSegs(tp.pts).forEach((S, i) => { for (let k = 0; k + 1 < S.length; k++) { const a = P(S[k][0], S[k][1]), b = P(S[k + 1][0], S[k + 1][1]), dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1, t = clamp(((u - a[0]) * dx + (v - a[1]) * dy) / L2, 0, 1), d = Math.hypot(a[0] + t * dx - u, a[1] + t * dy - v); if (d < bd) { bd = d; best = i; } } }); return best; };
    function delPt(i) { if (i < 0 || tp.pts.length <= 2 || (K.fixed0 && i === 0)) return; tp.pts.splice(i, 1); st.sel = Math.min(i, tp.pts.length - 1); commit(); }
    function commit() { rebuildAll(); st.D = topEdData(kind) || st.D; draw2(); }
    const mpos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('contextmenu', e => { e.preventDefault(); const [u, v] = mpos(e), i = hitPt(u, v); if (i >= 0) delPt(i); });
    cv.addEventListener('mousedown', e => {
      if (e.button !== 0) return; const [u, v] = mpos(e), i = hitPt(u, v);
      if (i >= 0) { st.sel = i; st.drag = K.fixed0 && i === 0 ? -1 : i; draw2(); }
      else { const s = hitSeg(u, v); if (s >= 0) { st.sel = s; draw2(); } else st.pan = [u, v, st.view.ox, st.view.oy]; }
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (el.style.display === 'none' || !st.view) return;
      const [u, v] = mpos(e);
      if (st.drag >= 0) { const [x, y] = Pinv(u, v), q = tp.pts[st.drag]; q.x = Math.round(x * 10) / 10; q.y = Math.round(y * 10) / 10; draw2(); return; }
      if (st.pan) { st.view.ox = st.pan[2] + u - st.pan[0]; st.view.oy = st.pan[3] + v - st.pan[1]; draw2(); return; }
      if (e.target === cv) { st.hover = Pinv(u, v); cv.style.cursor = hitPt(u, v) >= 0 ? 'grab' : hitSeg(u, v) >= 0 ? 'pointer' : 'crosshair'; draw2(); }
    });
    window.addEventListener('mouseup', () => { if (st.drag >= 0) { st.drag = -1; commit(); } st.pan = null; });
    cv.addEventListener('dblclick', e => {
      const [u, v] = mpos(e), s = hitSeg(u, v);
      if (s < 0) { st.view = null; draw2(); return; }
      const [x, y] = Pinv(u, v); tp.pts.splice(s + 1, 0, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, t: tp.pts[s].t }); st.sel = s + 1; commit();
    });
    cv.addEventListener('wheel', e => { e.preventDefault(); const [u, v] = mpos(e), k = Math.exp(-e.deltaY * 0.0015), [x, y] = Pinv(u, v); st.view.s *= k; st.view.ox = u - st.view.s * x; st.view.oy = v + st.view.s * y; draw2(); }, { passive: false });
    window.addEventListener('keydown', e => { if (el.style.display === 'none' || st.sel < 0 || /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return; if (e.key === 'Delete') { delPt(st.sel); e.preventDefault(); } else if (e.key === 'Escape') { st.sel = -1; draw2(); } });
    if (window.ResizeObserver) new ResizeObserver(() => { if (el.style.display !== 'none') draw2(); }).observe(el);
    topEd = topEds[kind] = { el, kind, refresh: () => { st.D = topEdData(kind); st.view = null; draw2(); }, data: () => { st.D = topEdData(kind) || st.D; draw2(); }, st };
    topEd.refresh(); requestAnimationFrame(() => { st.view = null; draw2(); });   // erst nach dem Layout ist die Canvas-Größe richtig
  }
  // ---------- Editor für den Querschnitt des Pilzes am Übergang in den Haubenrahmen ----------------------
  // Ebene quer zum Rumpf (X = Ende des Übergangs, dort trifft der Pilz auf Haubenfläche/Rahmen). Gezeigt: Rumpfquerschnitt,
  // Haubenrahmen und Pilz im Schnitt, Schnittkante der Haube, das Instrumentenbrett mit Instrumenten als Projektion
  // (Anhaltspunkt), der Standardquerschnitt gestrichelt. Die rechte Hälfte wird über Stützpunkte gezeichnet (Mitte nur
  // senkrecht verschiebbar, Endpunkt am Rahmen fest), die linke gespiegelt.
  let secEd = null;
  function sliceX(v, x) {   // Schnitt eines Dreiecksnetzes mit der Ebene X = x -> Strecken [[z, y], [z, y]]
    const out = [];
    for (let i = 0; i < v.length; i += 9) {
      const P = [[v[i], v[i + 1], v[i + 2]], [v[i + 3], v[i + 4], v[i + 5]], [v[i + 6], v[i + 7], v[i + 8]]], hit = [];
      for (let e = 0; e < 3; e++) { const a = P[e], b = P[(e + 1) % 3], da = a[0] - x, db = b[0] - x; if ((da < 0) !== (db < 0)) { const t = da / (da - db); hit.push([a[2] + (b[2] - a[2]) * t, a[1] + (b[1] - a[1]) * t]); } }
      if (hit.length === 2) out.push(hit);
    }
    return out;
  }
  function secEdData() {
    const r = cache; if (!r || !r.F || !r.R.secInfo) return null;
    const F = r.F, R = r.R, p = R.pz, si = R.secInfo, x = si.x, D = { x, si, R };
    const H = F.half(x) || []; D.fus = H.map(q => [q[1], q[0]]); D.fusL = H.map(q => [-q[1], q[0]]);
    const fr = F.can && F.can.frame, fv = fr && fr.mesh(); D.frame = fv ? sliceX(fv, x) : [];
    D.pilz = []; for (const it of r.items) if (it.id === 'haube') D.pilz = D.pilz.concat(sliceX(it.v, x));
    D.cut = []; if (F.can && F.can.spans) for (const sp of F.can.spans(x) || []) { const z = F.hw(x, sp[0]); if (z > -Infinity) D.cut.push([z, sp[0]]); }
    // Instrumentenbrett + Instrumente projiziert (Blick in Flugrichtung)
    const fm = frame(p), pr = (u, v) => { const q = fm.map(u, v, 0); return [q[2], q[1]]; };
    D.brett = (r.outline || []).map(q => pr(q[0], q[1]));
    D.inst = (r.ok || []).map(o => instPoly(o.it, R.scale, 0, 32).map(q => pr(q[0], q[1])));
    let z1 = 1, y0 = Infinity, y1 = -Infinity;
    for (const q of D.fus) { z1 = Math.max(z1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    // Startansicht: oberer Teil (Haube, Rahmen, Pilz, obere Bretthälfte); „Alles zeigen" nach Zoomen setzt hierauf zurück
    let yd = Infinity; for (const q of si.def) yd = Math.min(yd, q[1]);
    const yLo = Math.max(y0, yd - 0.9 * (y1 - yd) - 10);
    D.bounds = [-z1 - 4, yLo, z1 + 4, y1 + 4];
    return D;
  }
  function secInitPts(si) {
    const d = si.def, n = d.length - 1, at = f => d[Math.round(f * n)];
    return [0, 0.3, 0.6, 0.85, 1].map((f, i, a) => { const q = at(f); return { x: Math.round(q[0] * 10) / 10, y: Math.round(q[1] * 10) / 10, t: i < a.length - 1 ? 'spline' : 'line' }; });
  }
  function openSecEditor() {
    const c = cfg(), sc = c.pz.sec;
    if (!cache || !cache.R || !cache.R.secInfo) { alert(T('Kein Übergang Pilz → Haubenrahmen vorhanden (Pilz am Haubenrahmen, übergehen lassen, Haubenrahmen im Rumpf).')); return; }
    if (!(Array.isArray(sc.pts) && sc.pts.length >= 2)) sc.pts = secInitPts(cache.R.secInfo);
    if (!sc.on) { sc.on = true; rebuildAll(); }
    if (secEd) { secEd.el.style.display = 'flex'; secEd.refresh(); return; }
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:10vw;top:10vh;width:min(900px,86vw);height:min(640px,82vh);z-index:9001;display:flex;flex-direction:column;background:var(--panel,#1b1f26);color:var(--txt,#dde);border:1px solid var(--line,#445);border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.55);resize:both;overflow:hidden;min-width:420px;min-height:300px';
    el.innerHTML = '<div class="ckSecHead" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 8px;border-bottom:1px solid var(--line,#445);cursor:move;user-select:none">'
      + '<b class="ckSecTitle" style="margin-right:8px"></b><span class="ckSecBtns" style="display:flex;gap:4px;flex-wrap:wrap"></span>'
      + '<span style="flex:1"></span><span class="ckSecXY" style="font:12px var(--mono,monospace);color:var(--muted,#9ab)"></span></div>'
      + '<div style="position:relative;flex:1;min-height:0"><canvas class="ckSecCv" style="position:absolute;inset:0;width:100%;height:100%;cursor:crosshair"></canvas></div>'
      + '<div style="padding:4px 8px;border-top:1px solid var(--line,#445);font-size:12px;color:var(--muted,#9ab)">' + T('Rechte Hälfte zeichnen, die linke wird gespiegelt · Stützpunkte ziehen (Mitte nur senkrecht, Endpunkt am Rahmen fest) · Doppelklick auf die Linie = Punkt einfügen · Rechtsklick oder Entf = löschen · Mausrad = Zoom · Ziehen auf freier Fläche = verschieben') + '</div>';
    document.body.appendChild(el);
    const cv = el.querySelector('.ckSecCv'), g = cv.getContext('2d'), btns = el.querySelector('.ckSecBtns'), xy = el.querySelector('.ckSecXY'), title = el.querySelector('.ckSecTitle');
    const st = { D: null, sel: -1, drag: -1, pan: null, view: null, hover: null };
    const mk = (label, fn, tt) => { const b = mkMiniBtn(T(label), fn); if (tt) b.title = T(tt); btns.appendChild(b); return b; };
    const bType = mk('Abschnitt: gerade → Spline', () => { const q = sc.pts[st.sel]; if (!q || st.sel >= sc.pts.length - 1) return; q.t = q.t === 'spline' ? 'line' : 'spline'; commit(); }, 'Art des Abschnitts hinter dem gewählten Punkt umschalten (gerade ↔ Spline).');
    const bDel = mk('Punkt löschen', () => delPt(st.sel));
    mk('Krümmungskamm', () => { cfg().comb = !cfg().comb; draw2(); if (fit()) draw(); }, 'Krümmungskamm ein/aus: Zähne senkrecht zur Linie, Länge = Krümmung; Sprung im Kamm = Krümmungssprung, gelber Ring = Wendepunkt.');
    mk('Standardquerschnitt', () => { if (!confirm(T('Eigenen Querschnitt verwerfen und den Standardquerschnitt (Haubenfläche, oben abgeflacht) neu als Stützpunkte anlegen?'))) return; sc.pts = cache.R.secInfo ? secInitPts(cache.R.secInfo) : sc.pts; st.sel = -1; commit(); });
    const bOn = mk('Eigener Querschnitt: an', () => { sc.on = !sc.on; commit(); }, 'Aus: der Pilz nimmt wieder den Standardquerschnitt, die Stützpunkte bleiben gespeichert.');
    mk('Alles zeigen', () => { st.view = null; draw2(); });
    mk('Schließen', () => { el.style.display = 'none'; });
    { const head = el.querySelector('.ckSecHead'); let d0 = null;
      head.addEventListener('mousedown', e => { if (e.target.closest('button')) return; const r = el.getBoundingClientRect(); d0 = [e.clientX - r.left, e.clientY - r.top]; e.preventDefault(); });
      window.addEventListener('mousemove', e => { if (!d0) return; el.style.left = Math.max(0, e.clientX - d0[0]) + 'px'; el.style.top = Math.max(0, e.clientY - d0[1]) + 'px'; });
      window.addEventListener('mouseup', () => { d0 = null; }); }
    const size = () => { const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr)); return { w: r.width, h: r.height, dpr }; };
    const fitView = (w, h) => { const [a, b, c2, d] = st.D.bounds, s = Math.min((w - 30) / (c2 - a), (h - 30) / (d - b)); return { s, ox: w / 2 - s * (a + c2) / 2, oy: h / 2 + s * (b + d) / 2 }; };
    // Anzeige: Pilotensicht (in Flugrichtung), rechts = −Z; die Stützpunkte liegen auf der rechten Seite
    const P = (z, y) => [st.view.ox - st.view.s * z, st.view.oy - st.view.s * y];
    const Pinv = (u, v) => [(st.view.ox - u) / st.view.s, (st.view.oy - v) / st.view.s];
    const cssVar = (k, d) => { const v = getComputedStyle(document.documentElement).getPropertyValue(k).trim(); return v || d; };
    const curve = () => { const Q = sc.pts.map(q => ({ x: Math.abs(+q.x), y: +q.y, t: q.t })); Q[0].x = 0; return topSegs(Q, { t0: [1, 0] }); };
    function draw2() {
      if (!st.D) return;
      const { w, h, dpr } = size(); if (!st.view) st.view = fitView(w, h);
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = cssVar('--bg', '#0f1216'); g.fillRect(0, 0, w, h);
      const D = st.D;
      const line = (L, col, wd, dash, mir) => { if (!L || L.length < 2) return; for (const sg of mir ? [1, -1] : [1]) { g.beginPath(); L.forEach((q, i) => { const a = P(-sg * q[0], q[1]); i ? g.lineTo(a[0], a[1]) : g.moveTo(a[0], a[1]); }); g.strokeStyle = col; g.lineWidth = wd; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]); } };
      const segs = (S, col, wd) => { g.beginPath(); for (const [a, b] of S) { const A = P(a[0], a[1]), B = P(b[0], b[1]); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); } g.strokeStyle = col; g.lineWidth = wd; g.stroke(); };
      { const step = st.view.s * 10 < 12 ? 50 : 10, [za, yb] = Pinv(w, h), [zb, yt] = Pinv(0, 0); g.strokeStyle = 'rgba(128,140,160,.12)'; g.lineWidth = 1; g.beginPath();
        for (let z = Math.ceil(za / step) * step; z <= zb; z += step) { const a = P(z, 0)[0]; g.moveTo(a, 0); g.lineTo(a, h); }
        for (let y = Math.ceil(yb / step) * step; y <= yt; y += step) { const a = P(0, y)[1]; g.moveTo(0, a); g.lineTo(w, a); } g.stroke();
        const c0 = P(0, 0)[0]; g.strokeStyle = 'rgba(128,140,160,.35)'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(c0, 0); g.lineTo(c0, h); g.stroke(); g.setLineDash([]); }
      // Rumpf
      g.beginPath(); D.fus.forEach((q, i) => { const a = P(q[0], q[1]); i ? g.lineTo(a[0], a[1]) : g.moveTo(a[0], a[1]); }); for (let i = D.fusL.length - 1; i >= 0; i--) { const a = P(D.fusL[i][0], D.fusL[i][1]); g.lineTo(a[0], a[1]); } g.closePath(); g.fillStyle = 'rgba(79,127,191,.10)'; g.fill();
      line(D.fus, colOf('ckColFus'), 1.5, null, false); line(D.fusL, colOf('ckColFus'), 1.5, null, false);
      // Instrumentenbrett (Projektion) + Instrumente
      if (D.brett.length > 2) { g.beginPath(); D.brett.forEach((q, i) => { const a = P(q[0], q[1]); i ? g.lineTo(a[0], a[1]) : g.moveTo(a[0], a[1]); }); g.closePath(); g.fillStyle = 'rgba(120,130,145,.25)'; g.fill(); g.strokeStyle = 'rgba(190,200,215,.7)'; g.lineWidth = 1; g.setLineDash([5, 3]); g.stroke(); g.setLineDash([]); }
      for (const L of D.inst) { g.beginPath(); L.forEach((q, i) => { const a = P(q[0], q[1]); i ? g.lineTo(a[0], a[1]) : g.moveTo(a[0], a[1]); }); g.closePath(); g.strokeStyle = colOf('ckColRing'); g.lineWidth = 1; g.stroke(); }
      // Haubenrahmen, Pilz (aktueller Schnitt), Schnittkante der Haube
      segs(D.frame, colOf('ckColRahmen'), 2); segs(D.pilz, colOf('ckColPilz'), 1.5);
      for (const q of D.cut) for (const sg of [1, -1]) { const a = P(sg * q[0], q[1]); g.fillStyle = '#8fd3f4'; g.beginPath(); g.arc(a[0], a[1], 3.5, 0, 7); g.fill(); }
      // Standardquerschnitt + eigener Querschnitt (Innenseite des Pilzes)
      line(D.si.def, 'rgba(255,255,255,.45)', 1, [4, 3], true);
      const C = curve();
      if (cfg().comb) for (const sg of [1, -1]) drawCombG(g, C.comb, (x, y) => P(-sg * x, y), st.view.s, +cfg().combLen || 40);
      C.forEach((S, i) => line(S, i === st.sel && st.sel < sc.pts.length - 1 ? '#ffd54a' : (sc.on ? '#ffb347' : 'rgba(255,179,71,.45)'), 2.2, null, true));
      sc.pts.forEach((q, i) => { const a = P(-Math.abs(q.x), q.y), last = i === sc.pts.length - 1; g.beginPath(); if (last) g.arc(a[0], a[1], 5, 0, 7); else g.rect(a[0] - 5, a[1] - 5, 10, 10); g.fillStyle = i === st.sel ? '#ffd54a' : '#1b1f26'; g.fill(); g.strokeStyle = last ? '#9aa3ad' : '#ffb347'; g.lineWidth = 2; g.stroke(); });
      const leg = [[T('Rumpf'), colOf('ckColFus')], [T('Haubenrahmen'), colOf('ckColRahmen')], [T('Pilz (Schnitt)'), colOf('ckColPilz')], [T('Instrumentenbrett (Projektion)'), 'rgba(190,200,215,.8)'], [T('Standardquerschnitt'), 'rgba(255,255,255,.6)'], [T('eigener Querschnitt (Innenseite)') + ' · ' + combText(C.comb), '#ffb347']];
      g.font = '11px system-ui'; let ly = h - 15 * leg.length; for (const [t, col] of leg) { g.fillStyle = col; g.fillRect(10, ly - 8, 14, 3); g.fillStyle = cssVar('--txt', '#dde'); g.fillText(t, 30, ly - 4); ly += 15; }
      title.textContent = T('Querschnitt am Übergang Pilz → Haubenrahmen') + ' · X = ' + D.x.toFixed(1) + ' mm';
      const q = sc.pts[st.sel]; bType.disabled = !q || st.sel >= sc.pts.length - 1; bDel.disabled = !q || st.sel === 0 || st.sel === sc.pts.length - 1 || sc.pts.length <= 2;
      bType.textContent = T(q && q.t === 'spline' ? 'Abschnitt: Spline → gerade' : 'Abschnitt: gerade → Spline'); bOn.textContent = T(sc.on ? 'Eigener Querschnitt: an' : 'Eigener Querschnitt: aus');
      xy.textContent = q ? T('Punkt') + ' ' + (st.sel + 1) + ': Z ' + Math.abs(q.x).toFixed(1) + '  Y ' + q.y.toFixed(1) + ' mm' : (st.hover ? 'Z ' + st.hover[0].toFixed(1) + '  Y ' + st.hover[1].toFixed(1) + ' mm' : '');
    }
    const hitPt = (u, v) => { let best = -1, bd = 9; sc.pts.forEach((q, i) => { const a = P(-Math.abs(q.x), q.y), d = Math.hypot(a[0] - u, a[1] - v); if (d < bd) { bd = d; best = i; } }); return best; };
    const hitSeg = (u, v) => { let best = -1, bd = 8; curve().forEach((S, i) => { for (let k = 0; k + 1 < S.length; k++) { const a = P(-S[k][0], S[k][1]), b = P(-S[k + 1][0], S[k + 1][1]), dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1, t = clamp(((u - a[0]) * dx + (v - a[1]) * dy) / L2, 0, 1), d = Math.hypot(a[0] + t * dx - u, a[1] + t * dy - v); if (d < bd) { bd = d; best = i; } } }); return best; };
    function delPt(i) { if (i <= 0 || i >= sc.pts.length - 1 || sc.pts.length <= 2) return; sc.pts.splice(i, 1); st.sel = Math.min(i, sc.pts.length - 1); commit(); }
    function commit() { rebuildAll(); st.D = secEdData() || st.D; draw2(); }
    const mpos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('contextmenu', e => { e.preventDefault(); const [u, v] = mpos(e), i = hitPt(u, v); if (i >= 0) delPt(i); });
    cv.addEventListener('mousedown', e => {
      if (e.button !== 0) return; const [u, v] = mpos(e), i = hitPt(u, v);
      if (i >= 0) { st.sel = i; st.drag = i === sc.pts.length - 1 ? -1 : i; draw2(); }
      else { const s = hitSeg(u, v); if (s >= 0) { st.sel = s; draw2(); } else st.pan = [u, v, st.view.ox, st.view.oy]; }
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (el.style.display === 'none' || !st.view) return;
      const [u, v] = mpos(e);
      if (st.drag >= 0) { const [z, y] = Pinv(u, v), q = sc.pts[st.drag]; q.x = st.drag === 0 ? 0 : Math.round(Math.abs(z) * 10) / 10; q.y = Math.round(y * 10) / 10; draw2(); return; }
      if (st.pan) { st.view.ox = st.pan[2] + u - st.pan[0]; st.view.oy = st.pan[3] + v - st.pan[1]; draw2(); return; }
      if (e.target === cv) { const q = Pinv(u, v); st.hover = [Math.abs(q[0]), q[1]]; cv.style.cursor = hitPt(u, v) >= 0 ? 'grab' : hitSeg(u, v) >= 0 ? 'pointer' : 'crosshair'; draw2(); }
    });
    window.addEventListener('mouseup', () => { if (st.drag >= 0) { st.drag = -1; commit(); } st.pan = null; });
    cv.addEventListener('dblclick', e => {
      const [u, v] = mpos(e), s = hitSeg(u, v);
      if (s < 0) { st.view = null; draw2(); return; }
      const [z, y] = Pinv(u, v); sc.pts.splice(s + 1, 0, { x: Math.round(Math.abs(z) * 10) / 10, y: Math.round(y * 10) / 10, t: sc.pts[s].t }); st.sel = s + 1; commit();
    });
    cv.addEventListener('wheel', e => { e.preventDefault(); const [u, v] = mpos(e), k = Math.exp(-e.deltaY * 0.0015), [z, y] = Pinv(u, v); st.view.s *= k; st.view.ox = u + st.view.s * z; st.view.oy = v + st.view.s * y; draw2(); }, { passive: false });
    window.addEventListener('keydown', e => { if (el.style.display === 'none' || st.sel < 0 || /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return; if (e.key === 'Delete') { delPt(st.sel); e.preventDefault(); } else if (e.key === 'Escape') { st.sel = -1; draw2(); } });
    if (window.ResizeObserver) new ResizeObserver(() => { if (el.style.display !== 'none') draw2(); }).observe(el);
    secEd = { el, refresh: () => { st.D = secEdData(); st.view = null; draw2(); }, data: () => { st.D = secEdData() || st.D; draw2(); }, st };
    secEd.refresh();
  }
  function mkMiniBtn(label, fn) { const b = document.createElement('button'); b.textContent = label; b.className = 'mini'; b.style.cssText = 'padding:2px 8px;font-size:12px'; b.onclick = fn; return b; }
  function rebuildAll() { build(); if (App.buildSidebar) App.buildSidebar(); if (fit()) draw(); }

  // ---------- Seitenleiste ---------------------------------------------------------------------------
  function cockpitSidebar(side) {
    const { grp, hint, boolRow, selectRow, mkMini, subhead, buildSidebar } = App, numRow = App.numRowEnter || App.numRow;   // Zahlen erst bei Enter/Verlassen/Pfeil (Setter bauen die Leiste neu)
    const c = cfg(), RD = () => render(), RB = () => { build(); buildSidebar(); if (fit()) draw(); };
    // nur die wirksamen Maße (billig) — die Seitenleiste wird auch auf anderen Reitern aufgebaut
    const F = fusOf(fusApi()), R = resolve(c, F), A = R.auto;
    const num = (body, label, get, set, step, h, o) => numRow(body, label, get, v => { set(v); RD(); }, Object.assign({ step: step || 1, norender: true, hint: h }, o || {}));
    // Zahl mit Automatik: leer lassen/↺ = aus dem Rumpf
    const autoNum = (body, label, obj, key, rv, step, h, akey) => {
      const isA = !!A[akey || key];
      const i = num(body, isA ? T(label) + ' · ' + T('auto') : label, () => r1(rv), v => { obj[key] = v; }, step, h);
      if (!isA && i && i.parentNode) {
        const b = document.createElement('button'); b.textContent = '↺'; b.title = T('wieder automatisch (aus dem Rumpf)'); b.style.cssText = 'padding:0 6px;min-width:0;margin-left:4px';
        b.onclick = () => { obj[key] = null; RB(); };
        const row = i.closest('.row'); if (row) row.appendChild(b);
      }
      return i;
    };
    const bar = (body, list) => { const bb = document.createElement('div'); bb.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px'; for (const [t, f] of list) bb.appendChild(mkMini(T(t), f)); body.appendChild(bb); return bb; };

    const g0 = grp('Cockpit', true, 'cockpit', { key: 'ckMain' });
    hint(g0.body, 'Instrumentenpilz, Instrumentenbrett mit Instrumenten, Sitzwanne und Steuerknüppel für Segler-Modelle. Lage und Größe passen sich automatisch an den Rumpf an (Werte mit „auto"); jede Zahl lässt sich überschreiben, ↺ schaltet zurück auf automatisch.');
    const srcs = [['rpro', 'Reiter „Rumpf"']]; if (window.StlBody) srcs.push(['stl', 'eigenes STL-Modell']); srcs.push(['none', 'ohne Rumpf']);
    if (!window.RumpfPro && c.from === 'rpro') c.from = window.StlBody ? 'stl' : 'none';
    selectRow(g0.body, 'Rumpf aus', srcs.filter(s => s[0] !== 'rpro' || window.RumpfPro), () => c.from, v => { c.from = v; RB(); });
    if (c.from === 'stl' && window.StlBody && StlBody.rows) StlBody.rows(g0.body, RB);
    selectRow(g0.body, 'Vorlage (Segler-Typ)', [['', '— eigene Einstellung —']].concat(Object.keys(PRESETS).map(k => [k, PRESETS[k].name])), () => c.preset || '', v => { if (v) applyPreset(v); else c.preset = ''; RB(); },
      'Anhaltswerte, aus Fotos geschätzt: Brettform, Neigung, ob der Pilz am Haubenrahmen sitzt (schwenkt mit der Haube) oder fest im Rumpf, und die Instrumentenbelegung. Die Maße passen sich weiter an den Rumpf an — mit Fotos/Dreiseitenansicht des Vorbilds abgleichen.');
    num(g0.body, 'Maßstab 1:', () => c.scale, v => { c.scale = Math.max(0.1, v); }, 0.5, 'Nur für die Instrumente: ihre Größe wird im Original (z. B. Ø 57 / 80 mm) angegeben und durch den Maßstab geteilt. Alle anderen Maße sind Modellmaße.');
    selectRow(g0.body, 'Ansicht', [['3d', '3D (alle Bauteile)'], ['brett', 'Instrumentenbrett (2D, Instrumente verschieben)']], () => c.view, v => { c.view = v; RB(); });
    boolRow(g0.body, 'Sitzwanne', () => c.tub.on, v => { c.tub.on = v; RB(); });
    boolRow(g0.body, 'Steuerknüppel', () => c.stick.on, v => { c.stick.on = v; RB(); });
    bar(g0.body, [['↺ alles an den Rumpf anpassen', () => {
      for (const k of ['x', 'yB', 'h', 'wT', 'wB', 'depth', 'drop', 'narrow', 'stemW', 'stemH', 'colX', 'colY']) c.pz[k] = null;
      c.tub.xa = c.tub.xb = null; c.stick.x = null; RB();
    }]]);
    side.appendChild(g0.g);

    const p = R.pz, cp = c.pz;
    const g1 = grp('Instrumentenbrett', true, 'cockpit', { key: 'ckBrett' });
    autoNum(g1.body, 'Lage X (Unterkante, mm)', cp, 'x', p.x, 1, 'Längsposition der Brett-Unterkante (Pilotenseite) im Rumpf.');
    autoNum(g1.body, 'Unterkante Y (mm)', cp, 'yB', p.yB, 1);
    num(g1.body, 'Neigung nach vorne (°)', () => cp.tilt, v => { cp.tilt = clamp(v, -30, 60); }, 1, 'Oberkante zur Nase hin gekippt; 0° = senkrecht.');
    selectRow(g1.body, 'Umriss', [['pilz', 'Pilzform (Oberteil + Konsole zwischen den Beinen)'], ['trap', 'Trapez mit Beinausschnitt'], ['free', 'selbst gezeichnet']],
      () => (cp.shape === 'pilz' || cp.shape === 'free' ? cp.shape : 'trap'), v => { if (v === 'free' && !freeRaw(cp)) cp.free = freeFromShape(R, true); cp.shape = v; if (v === 'free') c.view = 'brett'; RB(); });
    if (cp.shape === 'free') freeRows(g1.body);
    else {
    autoNum(g1.body, 'Höhe entlang Brett (mm)', cp, 'h', p.h, 1);
    autoNum(g1.body, 'Breite oben (mm)', cp, 'wT', p.wT, 1);
    autoNum(g1.body, cp.shape === 'pilz' ? 'Breite an der Schulter (mm)' : 'Breite unten (mm)', cp, 'wB', p.wB, 1);
    num(g1.body, 'Wölbung der Oberkante (mm)', () => cp.bow, v => { cp.bow = Math.max(0, v); }, 0.5);
    num(g1.body, 'Eckradius oben (mm)', () => cp.rc, v => { cp.rc = Math.max(0, v); }, 0.5);
    num(g1.body, 'Eckradius unten (mm)', () => cp.rcB, v => { cp.rcB = Math.max(0, v); }, 0.5);
    }
    if (cp.shape === 'free') { /* Form kommt aus der Zeichnung */ }
    else if (cp.shape === 'pilz') {
      autoNum(g1.body, 'Konsole: Breite (mm)', cp, 'stemW', p.stemW, 1, 'Schmales Unterteil zwischen den Knien (Funkgerät, FLARM …).');
      autoNum(g1.body, 'Konsole: Höhe bis zur Schulter (mm)', cp, 'stemH', p.stemH, 1);
      num(g1.body, 'Hohlkehle an der Schulter (mm)', () => cp.rS, v => { cp.rS = Math.max(0, v); }, 0.5);
      num(g1.body, 'Konsole: Tiefe nach vorne (mm, 0 = nur Platte)', () => cp.consD, v => { cp.consD = Math.max(0, v); }, 1);
      if (!p.isPilz) hint(g1.body, 'Konsole passt nicht (zu breit oder zu hoch) — es wird das Trapez gezeichnet.');
    } else {
      num(g1.body, 'Beinausschnitt Breite (mm, 0 = ohne)', () => cp.legW, v => { cp.legW = Math.max(0, v); }, 1, 'Halbrunder Ausschnitt in der Mitte der Unterkante für die Knie.');
      num(g1.body, 'Beinausschnitt Höhe (mm)', () => cp.legH, v => { cp.legH = Math.max(0, v); }, 0.5);
    }
    num(g1.body, 'Plattendicke (mm)', () => cp.t, v => { cp.t = Math.max(0.2, v); }, 0.1);
    side.appendChild(g1.g);
    // Zeichnen: Punktliste + gewählter Punkt + Einpassen
    function freeRows(body) {
      const f = cp.free || (cp.free = freeFromShape(R, true));
      hint(body, 'Brettumriss selbst zeichnen: in der Ansicht „Instrumentenbrett" Punkte ziehen, Doppelklick auf die Linie fügt einen Punkt ein, Rechtsklick auf einen Punkt löscht ihn. Jeder Punkt kann einen Eckradius bekommen. Symmetrisch: nur die rechte Hälfte wird gezeichnet (Enden auf der Mittellinie), die linke gespiegelt.');
      hint(body, 'Jede Strecke ist wahlweise Gerade oder Spline (Kurve): beim gewählten Punkt gilt die Wahl für die Strecke zum nächsten Punkt, oder Strg+Klick auf die Hilfslinie schaltet um (gelb = Gerade, blau = Spline). An eine Gerade schließt der Spline tangential an (krümmungsstetig: auch ohne Krümmungssprung).');
      boolRow(body, 'spiegelsymmetrisch', () => !!f.sym, v => {
        if (v) cp.free = freeFromShape(R, true);   // aus dem jetzigen Umriss die rechte Hälfte
        else { const P = freeRaw(cp); if (P) cp.free = { sym: false, pts: P.map(q => ({ u: r1(q[0]), v: r1(q[1]), r: q[2], s: q[3] })) }; }
        c.freeSel = 0; RB();
      });
      const sel = clamp(c.freeSel | 0, 0, f.pts.length - 1), q = f.pts[sel];
      hint(body, T('Punkte') + ': ' + f.pts.length + ' · ' + T('Höhe') + ' ' + r1(p.h) + ' mm · ' + T('Breite oben') + ' ' + r1(p.wT) + ' mm');
      if (q) {
        subhead(body, T('Punkt') + ' ' + (sel + 1));
        const axis = f.sym && (sel === 0 || sel === f.pts.length - 1);
        if (!axis) num(body, 'u seitlich (mm)', () => q.u, v => { q.u = v; }, 0.5);
        num(body, 'v Höhe (mm)', () => q.v, v => { q.v = v; }, 0.5);
        const n = f.pts.length, sIn = f.sym ? (sel > 0 ? sel - 1 : 0) : (sel - 1 + n) % n, sOut = f.sym && sel === n - 1 ? n - 2 : sel;
        if (!(f.sym && sel === n - 1)) selectRow(body, 'Strecke zum nächsten Punkt', [['0', 'Gerade'], ['1', 'Spline (Kurve)']], () => (q.s ? '1' : '0'), v => { q.s = v === '1' ? 1 : 0; RB(); });
        if (!f.pts[sIn].s && !f.pts[sOut].s) num(body, 'Eckradius (mm)', () => q.r || 0, v => { q.r = Math.max(0, v); }, 0.5);
        else hint(body, 'Am Spline geht der Umriss ohne Knick durch den Punkt — kein Eckradius nötig.');
        bar(body, [['alle Strecken Gerade', () => { f.pts.forEach(o => { o.s = 0; }); RB(); }], ['alle Strecken Spline', () => { f.pts.forEach(o => { o.s = 1; }); RB(); }]]);
        bar(body, [['◀ Punkt', () => { c.freeSel = Math.max(0, sel - 1); RB(); }], ['Punkt ▶', () => { c.freeSel = Math.min(f.pts.length - 1, sel + 1); RB(); }],
          ['Punkt löschen', () => { if (f.pts.length <= 3) return; f.pts.splice(sel, 1); c.freeSel = Math.max(0, sel - 1); RB(); }]]);
      }
      subhead(body, T('Spline & Krümmungsanalyse'));
      selectRow(body, 'Spline-Art', [['c2', 'krümmungsstetig (C2, empfohlen)'], ['cr', 'Catmull-Rom (nur Tangente stetig)']], () => (c.spl === 'cr' ? 'cr' : 'c2'), v => { c.spl = v; RB(); },
        'Gilt für den Brettumriss, die Oberkante des Pilzes (Seitenansicht) und den Querschnitt am Übergang. Krümmungsstetig (C2): die Kurve läuft durch alle Punkte, ohne Krümmungssprung an den Punkten und an anschließenden Geraden. Catmull-Rom: nur die Tangente ist stetig, an jedem Punkt springt die Krümmung.');
      boolRow(body, 'Krümmungskamm und Wendepunkte zeigen', () => !!c.comb, v => { c.comb = v; draw(); if (topEd && topEd.el.style.display !== 'none') topEd.data(); if (secEd && secEd.el.style.display !== 'none') secEd.data(); });
      numRow(body, 'Kammlänge (px)', () => c.combLen, v => { c.combLen = clamp(v, 5, 300); draw(); }, { step: 5, min: 5, max: 300, norender: true });
      hint(body, 'Krümmungskamm: Zähne senkrecht zur Linie, Länge = Krümmung. Eine gute Linie hat eine ruhige, stetige Hüllkurve; Sprünge im Kamm = Krümmungssprung, Kamm wechselt die Seite = Wendepunkt (gelber Ring). Gezeigt in der Brettansicht und in den Editoren für Oberkante und Querschnitt.');
      bar(body, [['In den Rumpf einpassen', () => { const k = fitFree(c, R, F, 'all'); if (!k) alert(T('Einpassen nicht möglich — Lage X/Unterkante prüfen (die Brettmitte muss im Rumpf liegen).')); RB(); }],
        ['nur Breite einpassen', () => { const k = fitFree(c, R, F, 'w'); if (!k) alert(T('Einpassen nicht möglich — Lage X/Unterkante prüfen (die Brettmitte muss im Rumpf liegen).')); RB(); }],
        ['Aus Trapez/Pilzform neu', () => { cp.free = freeFromShape(Object.assign({}, R, { pz: Object.assign({}, p, { shape: 'trap' }) }), !!f.sym); RB(); }]]);
      if (!F) hint(body, 'Einpassen braucht einen Rumpf (Rumpf oder STL).');
      else hint(body, 'Einpassen vergrößert/verkleinert den Umriss um die Unterkante Mitte, bis er (mit Haubenwand und Abstand zur Außenhaut) gerade noch in den Rumpf passt. Alternativ: Gruppe „Stutzen" → Regel „Brett endet an Rumpf (Innenseite)" beschneidet den Umriss an der Rumpfinnenseite.');
    }

    const g2 = grp('Pilz (Haube über den Instrumenten)', false, 'cockpit', { key: 'ckPilz' });
    selectRow(g2.body, 'Befestigung', [['fus', 'fest im Rumpf (eigener Pilz, z. B. DG)'], ['frame', 'am Haubenrahmen, schwenkt mit (z. B. ASW 20, Discus 2, LS 6)'], ['free', 'freistehend auf Säule (eigener Kopf)']], () => cp.mount || 'fus', v => { cp.mount = v; for (const k of ['depth', 'drop', 'narrow', 'wT', 'wB']) cp[k] = null; RB(); },
      'Am Haubenrahmen: der Haubenrahmen kommt aus dem Rumpf (Gruppe „Kabinenhaube"), der Pilz reicht bis zum vorderen Rahmen und wird mit ihm als ein Bauteil ausgegeben.');
    const cf = c.frame;
    if (cp.mount !== 'frame') boolRow(g2.body, 'Haubenrahmen aus dem Rumpf mit ausgeben', () => cf.on, v => { cf.on = v; RB(); });
    if (cp.mount === 'frame') {
      boolRow(g2.body, 'Pilz in den Haubenrahmen übergehen lassen (ein Teil)', () => cp.merge !== false, v => { cp.merge = v; cp.depth = null; RB(); },
        'Wie bei ASG 29, Discus 2 oder LS 6: die Pilz-Haube steigt hinten vom Brettbogen gerundet auf und liegt dann genau unter der Kabinenhaube (Rumpfhaut minus Haubenstärke, wie die Außenseite des Haubenrahmens) — über die ganze Haubenbreite bis in den seitlichen und vorderen Rahmen. Pilz und Rahmen werden ein Bauteil (eine STL, die überlappenden Körper vereinigt der Slicer). Tiefe, Absenkung und Verjüngung gelten dann nicht.');
      if (cp.merge !== false) selectRow(g2.body, 'Verlauf der Pilz-Haube', [['straight', 'gerade senkrecht zum Brett, am Rahmen gestutzt'], ['fit', 'an die Haubenfläche angeschmiegt (Übergang)']], () => (cp.run === 'fit' ? 'fit' : 'straight'), v => { cp.run = v; RB(); },
        'Gerade: der Bogen über der Brettoberkante läuft als gerade Fläche senkrecht zum Brett (oder im eingestellten Winkel) nach vorne. Vorne endet er am Haubenrahmen — in der Mitte des vorderen Rahmens, unterhalb des Rahmens an der gedachten Verlängerung seiner vorderen Schräge (blaue Linie) — und oben an der Rumpfhaut unter der Kabinenhaube (außen bündig mit dem Rahmen). Angeschmiegt: frühere Form, steigt über einen Übergang zur Haubenfläche auf.');
      if (p.straight) selectRow(g2.body, 'Führung nach vorne', [['angle', 'Gerade im Winkel zum Brett'], ['line', 'Linie in der Seitenansicht zeichnen']], () => (cp.runMode === 'line' ? 'line' : 'angle'),
        v => { if (v === 'line') { const L = ED_KIND.run.store(); if (!(Array.isArray(L.pts) && L.pts.length >= 2)) L.pts = runFromStraight(cache && cache.R); if (!L.pts) { alert(T('Linie kann noch nicht angelegt werden — der Pilz wird gerade nicht erzeugt.')); RB(); return; } } cp.runMode = v; RB(); },
        'Gerade: der Pilz läuft als gerade Fläche im eingestellten Winkel nach vorne. Linie: Du zeichnest in der Seitenansicht, wie die Oberseite des Pilzes (Mitte) vom Brett nach vorne verläuft — gerade Abschnitte und Splines; der Brettbogen wird entlang dieser Linie verschoben. Der erste Punkt sitzt fest an der Brettoberkante, hinter dem letzten Punkt läuft die Linie geradlinig weiter bis zum Haubenrahmen.');
      if (p.straight && cp.runMode === 'line') {
        const L = ED_KIND.run.store(), n = Array.isArray(L.pts) ? L.pts.length : 0;
        hint(g2.body, T('Linie mit') + ' ' + n + ' ' + T('Stützpunkten') + ' (' + (L.pts || []).filter((q, i) => i < n - 1 && q.t === 'spline').length + ' ' + T('Spline-Abschnitte') + ').');
        bar(g2.body, [['Linie im Editor zeichnen (Seitenansicht)…', () => openTopEditor('run')], ['Aus der Geraden neu anlegen', () => { const n2 = runFromStraight(cache && cache.R); if (n2) L.pts = n2; RB(); }]]);
      }
      if (p.straight && cp.runMode !== 'line') num(g2.body, 'Neigung gegenüber senkrecht zum Brett (°, + = nach oben)', () => cp.hoodA || 0, v => { cp.hoodA = clamp(v, -45, 45); }, 1, '0° = genau senkrecht zum Brett nach vorne. Positive Werte lassen die Haube nach vorne ansteigen, negative abfallen.');
      if (p.straight) boolRow(g2.body, 'Rahmen über dem Pilz mit Deckel verschließen', () => cp.lid !== false, v => { cp.lid = v; RB(); },
        'Deckel wie auf die vordere Schräge des Haubenrahmens gelegt (Platte in der blauen Stutzebene, Stärke = Wandstärke): er schließt die Öffnung zwischen Rahmen und Pilz bis unter die Kabinenhaube. Der Pilz endet in dieser Platte, und der Deckel endet an der Pilz-Innenseite — nichts steht über. Aus: der Pilz endet offen an der Rahmenmitte.');
      if (p.straight && cp.lid !== false) num(g2.body, 'Deckel im Rahmen versenkt (mm, 0 = bündig mit der Rahmenoberseite)', () => +cp.lidD || 0, v => { cp.lidD = Math.max(0, v); }, 0.5,
        'Abstand der Deckel-Oberseite unter der Oberseite der vorderen Rahmenschräge (die zum Cockpit zeigende Seite). 0 = Deckel liegt eben mit dem Rahmen. Höchstens so tief, dass der Deckel noch im Rahmen liegt.');
      if (cp.merge !== false && !p.straight) {
        autoNum(g2.body, 'Länge des Übergangs zum Rahmen (mm)', cp, 'mergeLen', p.mergeLen, 1);
        {
          const sc = cp.sec, on = sc.on && Array.isArray(sc.pts) && sc.pts.length >= 2;
          hint(g2.body, on ? T('Eigener Querschnitt am Übergang:') + ' ' + sc.pts.length + ' ' + T('Stützpunkte') + '.' : T('Querschnitt am Übergang: Standard (Haubenfläche, oben abgeflacht).'));
          bar(g2.body, [['Querschnitt am Übergang zeichnen…', () => openSecEditor()]].concat(on ? [['Standard verwenden', () => { sc.on = false; RB(); }]] : []));
        }
        const tp = cp.top;
        selectRow(g2.body, 'Oberkante des Pilzes', [['down', 'Abstand unter der Rumpfoberkante'], ['free', 'freie Linie (Seitenansicht)'], ['off', 'bis ganz oben (keine Begrenzung)']], () => tp.mode, v => { if (v === 'free' && !(Array.isArray(tp.pts) && tp.pts.length >= 2)) tp.pts = topFromDown(R); tp.mode = v; RB(); },
          'Der Pilz liegt seitlich an der Haubenfläche und läuft dort in den Haubenrahmen; oben endet er an dieser Linie (Seitenansicht, in 3D als Linie in der Mittelebene) und wird dort weich abgeflacht — er setzt also nicht ganz oben am Rahmen an. Vorne endet er, wo der Rahmen über die Linie steigt.');
        if (tp.mode === 'down') autoNum(g2.body, 'Abstand unter der Rumpfoberkante (mm)', tp, 'd', p.topD, 1, 'Oberkante des Pilzes = Rumpfoberkante minus diesen Abstand, über die ganze Länge.', 'top.d');
        if (tp.mode !== 'off') num(g2.body, 'Rundung an der Oberkante (mm)', () => tp.r, v => { tp.r = Math.max(0.2, v); }, 0.5, 'So weit unter der Linie beginnt die Abflachung: groß = runder Rücken, klein = scharfe Kante zur Haube hin.');
        if (tp.mode !== 'off') boolRow(g2.body, 'Haubenrahmen über dem Pilz verschließen', () => tp.close !== false, v => { tp.close = v; RB(); },
          'Deckel auf Höhe der Rahmen-Außenseite (unter der Kabinenhaube) vom vorderen Rahmen bis dorthin, wo der Pilz voll aufgestiegen ist, mit einer Stirnwand hinunter zum Pilzrücken — der Rahmen ist über dem Pilz geschlossen, wie das lackierte Vorderteil echter Hauben. Aus: zwischen Pilz und Rahmen bleibt der Ausschnitt offen.');
        if (tp.mode === 'free') {
          if (!Array.isArray(tp.pts) || tp.pts.length < 2) tp.pts = topFromDown(R) || [{ x: p.x - 60, y: p.yB + p.h, t: 'line' }, { x: p.x + 10, y: p.yB + p.h, t: 'line' }];
          hint(g2.body, T('Linie mit') + ' ' + tp.pts.length + ' ' + T('Stützpunkten') + ' (' + tp.pts.filter((q, i) => i < tp.pts.length - 1 && q.t === 'spline').length + ' ' + T('Spline-Abschnitte') + ').');
          bar(g2.body, [['Linie im Editor zeichnen (Seitenansicht)…', () => openTopEditor()], ['Aus dem Abstand neu anlegen', () => { tp.pts = topFromDown(R); RB(); }]]);
        } else if (tp.mode === 'down') bar(g2.body, [['Als freie Linie im Editor bearbeiten…', () => { tp.pts = topFromDown(R); openTopEditor(); }]]);
      }
    }
    if (cp.mount === 'free') hint(g2.body, 'Freistehend: der Pilz ist ein geschlossener Kopf (unten Boden, vorne Deckel) auf einer Säule bis zum Rumpf- bzw. Wannenboden und berührt die Bordwände nicht.');
    if (cp.mount === 'frame' || cf.on) {
      const frA = F && F.can && F.can.frame;
      hint(g2.body, frA ? T('Haubenrahmen aus dem Rumpf: Höhe') + ' ' + frA.h + ' mm, ' + T('Stärke') + ' ' + frA.t + ' mm, ' + T('Haubenstärke') + ' ' + frA.glass + ' mm.'
        : '⚠ ' + T('Der Haubenrahmen wird im Reiter „Rumpf" eingestellt (Gruppe „Kabinenhaube" → „Haubenrahmen erzeugen"): Höhe, Stärke, Spiel und die Stärke der Kabinenhaube. Er übernimmt die Sicke und passt dadurch genau auf den Rumpf.'));
    }
    boolRow(g2.body, 'Pilz-Haube', () => cp.hood, v => { cp.hood = v; RB(); }, 'Schale über dem Brett: läuft vom Brettrand nach vorne, fällt zur Nase hin ab und wird schmaler. Seitlich reicht sie als Wange herunter, unten ist sie offen.');
    if (cp.hood) {
      num(g2.body, 'Blende: Überstand nach hinten (mm)', () => cp.lip, v => { cp.lip = Math.max(0, v); }, 0.5, 'Sonnenblende über den Instrumenten zum Piloten hin.');
      if (!p.straight) {
        autoNum(g2.body, 'Tiefe nach vorne (mm)', cp, 'depth', p.depth, 1);
        autoNum(g2.body, 'Absenkung vorne (mm)', cp, 'drop', p.drop, 1, 'So weit fällt die Oberseite bis zum vorderen Ende ab.');
        num(g2.body, 'Verlauf der Absenkung (1 = gerade, 2 = rund)', () => cp.curve, v => { cp.curve = clamp(v, 0.5, 5); }, 0.1);
        autoNum(g2.body, 'Verjüngung vorne je Seite (mm)', cp, 'narrow', p.narrow, 0.5);
      }
      if (cp.mount !== 'free') {
        num(g2.body, 'Wange hinten: Unterkante über Brett-Unterkante (mm)', () => cp.cheek0, v => { cp.cheek0 = Math.max(0, v); }, 1);
        num(g2.body, 'Wange vorne: Unterkante (mm)', () => cp.cheek1, v => { cp.cheek1 = Math.max(0, v); }, 1);
      }
      num(g2.body, 'Wandstärke (mm)', () => cp.wall, v => { cp.wall = Math.max(0.2, v); }, 0.1);
      if (c.exp.sep) num(g2.body, 'Spiel Brett ↔ Haube (mm)', () => cp.play, v => { cp.play = Math.max(0, v); }, 0.05, 'Bei getrennten Dateien sitzt das Brett mit diesem Spiel in der Haube (zum Einkleben). Zusammen als eine Datei überlappen Brett und Haube leicht.');
    }
    if (cp.mount === 'fus') boolRow(g2.body, 'Säule (Pilzfuß)', () => cp.col, v => { cp.col = v; RB(); }, 'Stütze unter dem Pilz bis zum Rumpfboden — wie bei Doppelsitzern mit mittiger Instrumentensäule.');
    if (p.col) {
      num(g2.body, 'Säule Breite (mm)', () => cp.colW, v => { cp.colW = Math.max(1, v); }, 1);
      num(g2.body, 'Säule Tiefe (mm)', () => cp.colD, v => { cp.colD = Math.max(1, v); }, 1);
      autoNum(g2.body, 'Säule vor dem Brett (mm)', cp, 'colX', p.colX, 1);
      autoNum(g2.body, 'Säule Unterkante Y (mm)', cp, 'colY', p.colY, 1);
    }
    side.appendChild(g2.g);

    const g3 = grp('Instrumente', true, 'cockpit', { key: 'ckInst' });
    const ci = c.inst, L = instList(c, R);
    selectRow(g3.body, 'Einbau', [['pocket', 'Sacklöcher (Blatt einlegen)'], ['hole', 'Durchbrüche'], ['flat', 'kein Ausschnitt (nur Aufdruck)']], () => ci.mode, v => { ci.mode = v; RB(); });
    if (ci.mode === 'pocket') num(g3.body, 'Tiefe der Sacklöcher (mm)', () => ci.rec, v => { ci.rec = Math.max(0.1, v); }, 0.1, 'Platz für das gedruckte Instrumentenblatt (SVG) und eine klare Folie als Glas.');
    num(g3.body, 'Zierring Breite (mm, 0 = ohne)', () => ci.bez, v => { ci.bez = Math.max(0, v); }, 0.1);
    num(g3.body, 'Zierring Höhe (mm)', () => ci.bezH, v => { ci.bezH = Math.max(0, v); }, 0.1);
    boolRow(g3.body, 'Befestigungsschrauben zeigen (SVG/DXF)', () => ci.screws, v => { ci.screws = v; render(); });
    subhead(g3.body, T('Instrumente') + ' (' + L.length + ')');
    if (L.length) {
      const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;grid-column:1/-1';
      L.forEach((it, i) => {
        const b = document.createElement('button'); b.textContent = (i + 1) + ' ' + T((KINDS[it.k] || KINDS.blank).name);
        b.style.cssText = 'padding:2px 6px;min-width:0;font-size:11px'; if (i === c.sel) b.className = 'primary';
        b.onclick = () => { c.sel = i; RB(); }; wrap.appendChild(b);
      });
      g3.body.appendChild(wrap);
    }
    const it = L[c.sel];
    if (it) {
      const K = KINDS[it.k] || KINDS.blank;
      selectRow(g3.body, 'Art', KIND_ORDER.map(k => [k, KINDS[k].name]), () => it.k, v => { it.k = v; delete it.d; delete it.w; delete it.h; delete it.val; RB(); });
      if (K.shape === 'rect') {
        num(g3.body, 'Breite im Original (mm)', () => +it.w || K.w, v => { it.w = Math.max(5, v); }, 1);
        num(g3.body, 'Höhe im Original (mm)', () => +it.h || K.h, v => { it.h = Math.max(5, v); }, 1);
      } else num(g3.body, 'Ø im Original (mm)', () => +it.d || K.d, v => { it.d = Math.max(5, v); }, 1, 'Übliche Größen: 57 mm (2¼") und 80 mm (3⅛").');
      const d = instDims(it, R.scale);
      hint(g3.body, T('im Modell') + ': ' + (d.rect ? r1(d.w) + ' × ' + r1(d.h) : 'Ø ' + r1(2 * d.r)) + ' mm');
      num(g3.body, 'Lage seitlich u (mm, + = rechts)', () => it.u, v => { it.u = v; }, 0.5, 'Ab Brettmitte, in Pilotensicht.');
      num(g3.body, 'Lage Höhe v (mm, ab Unterkante)', () => it.v, v => { it.v = v; }, 0.5);
      if (K.val != null) num(g3.body, T('Zeigerstellung') + ' (' + K.unit + ')', () => (it.val != null ? it.val : K.val), v => { it.val = v; }, it.k === 'alt' ? 50 : it.k === 'vario' ? 0.1 : 5);
      bar(g3.body, [['Instrument entfernen', () => { L.splice(c.sel, 1); c.sel = Math.max(0, Math.min(c.sel, L.length - 1)); RB(); }],
        ['Duplizieren', () => { const n = clone(it); n.u = r1(n.u + 5); L.push(n); c.sel = L.length - 1; RB(); }],
        ['mittig', () => { it.u = 0; RB(); }]]);
    }
    bar(g3.body, [['+ Instrument', () => { L.push({ k: 'blank', u: 0, v: r1(p.h / 2) }); c.sel = L.length - 1; c.view = 'brett'; RB(); }],
      ['Standardbelegung', () => { if (L.length && !confirm(T('Alle Instrumente durch die Standardbelegung ersetzen?'))) return; ci.list = defaultFit(R); c.sel = 0; RB(); }]]);
    side.appendChild(g3.g);

    if (c.tub.on) {
      const g4 = grp('Sitzwanne', false, 'cockpit', { key: 'ckTub' });
      const t = c.tub, rt = R.tub;
      if (!F) hint(g4.body, 'Die Sitzwanne folgt der Rumpfinnenseite — dafür oben einen Rumpf wählen (Rumpf oder STL).');
      hint(g4.body, 'Folgt der Rumpfinnenseite bis zur Unterkante des Haubenausschnitts (Bordwand). Im Seitenprofil: Fußraum vorne, Sitzfläche, Rückenlehne bis zum Rand.');
      autoNum(g4.body, 'vorne X (mm)', t, 'xa', rt.xa, 1, null, 'tub.xa');
      autoNum(g4.body, 'hinten X (mm)', t, 'xb', rt.xb, 1, null, 'tub.xb');
      num(g4.body, 'Abstand zur Rumpfaußenhaut (mm)', () => t.gap, v => { t.gap = Math.max(0, v); }, 0.1, 'Rumpfwand + Luft; die Wanne liegt mit ihrer Außenseite so weit innen.');
      num(g4.body, 'Wandstärke (mm)', () => t.wall, v => { t.wall = Math.max(0.2, v); }, 0.1);
      autoNum(g4.body, 'Hochgezogen bis: Rand über Rumpfboden (mm)', t, 'rimH', rt.rimHv, 1, 'Wie weit die Wanne seitlich hochgezogen wird. Automatisch = bis zur Unterkante des Haubenausschnitts (Bordwand).', 'tub.rimH');
      if (rt.rimH == null) num(g4.body, 'Rand unter dem Haubenausschnitt (mm)', () => t.rimDrop, v => { t.rimDrop = v; }, 0.5);
      num(g4.body, 'Fußraum: Boden über Rumpfboden (mm)', () => t.footH, v => { t.footH = Math.max(0, v); }, 1);
      num(g4.body, 'Sitz: Boden über Rumpfboden (mm)', () => t.seatH, v => { t.seatH = Math.max(0, v); }, 0.5);
      num(g4.body, 'Sitzlänge (mm)', () => t.seatLen, v => { t.seatLen = Math.max(1, v); }, 1);
      num(g4.body, 'Lehne: Neigung nach hinten (°)', () => t.backA, v => { t.backA = clamp(v, 5, 75); }, 1);
      num(g4.body, 'Rundung der Übergänge (0–6)', () => t.soft, v => { t.soft = clamp(Math.round(v), 0, 6); }, 1);
      num(g4.body, 'Radius Boden ↔ Wand (mm)', () => t.rF, v => { t.rF = Math.max(0, v); }, 0.5);
      subhead(g4.body, 'Seitenstufen (links/rechts in Längsrichtung)');
      hint(g4.body, 'Absatz in der Wannenwand: oberhalb folgt die Wand dem Rumpf, auf Stufenhöhe springt sie um die Stufenbreite nach innen und läuft als gerade Innenwand zum Boden. An den Enden läuft die Stufe über den Auslauf aus.');
      num(g4.body, 'Radius an den Stufenkanten (mm)', () => t.stepR, v => { t.stepR = Math.max(0, v); }, 0.5);
      t.steps.forEach((st, k) => {
        boolRow(g4.body, T('Stufe') + ' ' + (k + 1), () => st.on, v => { st.on = v; RB(); });
        if (!st.on) return;
        num(g4.body, T('Stufe') + ' ' + (k + 1) + ': ' + T('Höhe über dem Boden (mm)'), () => st.h, v => { st.h = Math.max(0, v); }, 1);
        num(g4.body, T('Stufe') + ' ' + (k + 1) + ': ' + T('Breite (mm)'), () => st.w, v => { st.w = Math.max(0, v); }, 0.5);
        num(g4.body, T('Stufe') + ' ' + (k + 1) + ': ' + T('von (% der Wannenlänge)'), () => st.x0, v => { st.x0 = clamp(v, 0, 100); }, 1);
        num(g4.body, T('Stufe') + ' ' + (k + 1) + ': ' + T('bis (% der Wannenlänge)'), () => st.x1, v => { st.x1 = clamp(v, 0, 100); }, 1);
        num(g4.body, T('Stufe') + ' ' + (k + 1) + ': ' + T('Auslauf (mm)'), () => st.ramp, v => { st.ramp = Math.max(0, v); }, 1);
        num(g4.body, T('Stufe') + ' ' + (k + 1) + ': ' + T('Schräge der Innenwand (°)'), () => st.draft, v => { st.draft = clamp(v, 0, 30); }, 1);
      });
      side.appendChild(g4.g);
    }
    if (c.stick.on) {
      const g5 = grp('Steuerknüppel', false, 'cockpit', { key: 'ckStick' });
      const s = c.stick;
      autoNum(g5.body, 'Lage X (mm)', s, 'x', R.stick.x, 1, 'Steht auf dem Wannenboden (ohne Wanne auf dem Rumpfboden).', 'stick.x');
      num(g5.body, 'Länge (mm)', () => s.len, v => { s.len = Math.max(2, v); }, 1);
      num(g5.body, 'Ø Stange (mm)', () => s.d, v => { s.d = Math.max(0.6, v); }, 0.1);
      num(g5.body, 'Ø Griff (mm)', () => s.grip, v => { s.grip = Math.max(1, v); }, 0.5);
      num(g5.body, 'Neigung nach vorne (°)', () => s.tilt, v => { s.tilt = clamp(v, -45, 45); }, 1);
      side.appendChild(g5.g);
    }

    const g7 = grp('Stutzen (Überschneidungen)', false, 'cockpit', { key: 'ckTrim' });
    hint(g7.body, 'Teile sollen sich nicht durchdringen: je Regel endet Teil A an Teil B — die Fläche von A wird dort abgeschnitten, wo sie in B eintaucht (B bleibt unverändert). Gestutzt werden können die Pilz-Haube, das Brett (Umriss) und die Sitzwanne; begrenzen kann jedes Teil oder die Rumpfinnenseite. Die Regeln gelten in ihrer Reihenfolge.');
    if (!Array.isArray(c.trim)) c.trim = [];
    const optsA = TRIM_A.map(k => [k, ID_NAME[k]]), optsB = ['haube', 'brett', 'konsole', 'saeule', 'wanne', 'rahmen', 'knueppel', 'rumpf'].map(k => [k, ID_NAME[k]]);
    const sel = (opts, val, set) => { const s = document.createElement('select'); for (const [k, n] of opts) { const o = document.createElement('option'); o.value = k; o.textContent = T(n); s.appendChild(o); } s.value = val; s.onchange = () => set(s.value); s.style.cssText = 'min-width:0;flex:1'; return s; };
    c.trim.forEach((ru, i) => {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:4px;align-items:center;grid-column:1/-1';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!ru.on; cb.onchange = () => { ru.on = cb.checked; RB(); };
      const lb = document.createElement('span'); lb.textContent = T('endet an'); lb.style.cssText = 'font-size:11px;opacity:.8';
      const del = document.createElement('button'); del.textContent = '✕'; del.title = T('Regel löschen'); del.style.cssText = 'padding:0 6px;min-width:0';
      del.onclick = () => { c.trim.splice(i, 1); RB(); };
      row.append(cb, sel(optsA, ru.a, v => { ru.a = v; RB(); }), lb, sel(optsB, ru.b, v => { ru.b = v; RB(); }), del);
      g7.body.appendChild(row);
    });
    if (cache && cache.over && cache.over.length) {
      hint(g7.body, T('Gefundene Überschneidungen') + ': ' + cache.over.map(([a, b]) => T(ID_NAME[a] || a) + ' ↔ ' + T(ID_NAME[b] || b)).join(', '));
      const sug = cache.over.map(([a, b]) => (TRIM_A.includes(a) ? [a, b] : TRIM_A.includes(b) ? [b, a] : null)).filter(x => x && !c.trim.some(r => r.a === x[0] && r.b === x[1]));
      if (sug.length) bar(g7.body, [['Regeln dafür anlegen', () => { for (const [a, b] of sug) c.trim.push({ a, b, on: true }); RB(); }]]);
    }
    bar(g7.body, [['+ Regel', () => { c.trim.push({ a: 'haube', b: 'wanne', on: true }); RB(); }]]);
    side.appendChild(g7.g);

    const g6 = grp('Ansicht & Ausgabe', true, 'cockpit', { key: 'ckOut' });
    boolRow(g6.body, 'Rumpf als Linien zeigen', () => c.showFus, v => { c.showFus = v; render(); });
    boolRow(g6.body, 'Drahtgitter', () => c.wire, v => { c.wire = v; draw(); });
    subhead(g6.body, 'Farben (3D-Ansicht)');
    for (const [label, key] of [['Pilz', 'ckColPilz'], ['Brett', 'ckColBrett'], ['Zierringe', 'ckColRing'], ['Sitzwanne', 'ckColWanne'], ['Knüppel', 'ckColStick'], ['Haubenrahmen', 'ckColRahmen'], ['Rumpflinien', 'ckColFus']]) {
      const row = document.createElement('div'); row.className = 'row'; const l = document.createElement('label'); l.textContent = T(label); row.appendChild(l);
      const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;gap:6px;align-items:center';
      const inp = document.createElement('input'); inp.type = 'color'; inp.value = colOf(key); inp.style.cssText = 'width:46px;height:26px;padding:0;cursor:pointer';
      inp.oninput = () => { state.cfg[key] = inp.value; draw(); };
      const rs = document.createElement('button'); rs.textContent = '↺'; rs.title = T('Standardfarbe'); rs.style.cssText = 'padding:0 8px;min-width:0';
      rs.onclick = () => { state.cfg[key] = COL[key]; inp.value = COL[key]; draw(); };
      wrap.appendChild(inp); wrap.appendChild(rs); row.appendChild(wrap); g6.body.appendChild(row);
    }
    selectRow(g6.body, 'STL-Dateien', [['1', 'je Bauteil eine Datei (Pilz bzw. Haubenrahmen mit Pilz, Brett, Wanne, Knüppel)'], ['0', 'alles in einer Datei']], () => (c.exp.sep ? '1' : '0'), v => { c.exp.sep = v === '1'; RB(); });
    hint(g6.body, 'Die STL-Dateien liegen in Rumpf-Koordinaten (X längs, Y hoch, wie „Rumpf als STL" im Rumpf) und passen so direkt in den Rumpf. Das SVG enthält das Brett mit allen Instrumenten und jedes Instrumentenblatt einzeln in Originalgröße des Modells — mit 100 % drucken. Das DXF enthält Brettumriss, Instrumentenausschnitte und Schraubenlöcher (Laser/Fräse).');
    bar(g6.body, [['STL speichern…', exportStl], ['Instrumente als SVG…', exportSvg], ['Brett als DXF…', exportDxf]]);
    side.appendChild(g6.g);
  }

  Object.assign(App, { cockpitSidebar });
  window.Cockpit = { show, render, resize, build, exportStl, exportSvg, exportDxf, svgText,
    _test: { trimOutline, freeComb, splinePath, c2Solve, setCam: o => { Object.assign(cam, o); draw(); }, freeRaw, freeOutline, freeFromShape, fitFree, fitHood, openTopEditor, topEdData, openSecEditor, secEdData, sliceX, topCurve, trimGrid, solidTester, fusTester, buildFrame, applyPreset, PRESETS, pilzOutline, panelOutline, archAt, thicken, plateSolid, extrude, lathe, openEdges, volumeRange, resolve, defaultInst, dialSvg, cfg, KINDS } };
})();
