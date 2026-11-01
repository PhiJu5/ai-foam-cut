/* neuralfoil.js — NeuralFoil-Portierung: neuronales Netz als XFOIL-Ersatz.
 * Original: NeuralFoil von Peter Sharpe (MIT-Lizenz, auf Millionen
 * XFOIL-Rechnungen trainiert), https://github.com/peterdsharpe/NeuralFoil —
 * hier als reine JS-Neuimplementierung des Vorwärtspasses samt Kulfan-(CST)-
 * Profilparametrisierung (aerosandbox, ebenfalls MIT). Gewichte liegen in
 * neuralfoil_data.js (globalThis.NEURALFOIL_DATA, Modell „xlarge").
 *
 * Eingabe wie Foil2D: Profil normiert 0..1, TE→oben→LE→unten→TE.
 *   NeuralFoil.build(prof) → { run(alpha, Re, {ncrit}), polar({Re,a0,a1,da,ncrit}) }
 * — dieselbe Schnittstelle wie Foil2D, damit der Reiter Aerodynamik die
 * Quelle einfach umschalten kann. polar() liefert {Re, pts, clmax, alphaMax};
 * Punkte tragen zusätzlich conf (analysis_confidence des Netzes, 0..1).
 * Läuft im Browser UND in Node (Harness: erst neuralfoil_data.js laden). */
(function (global) {
  'use strict';
  const RAD = Math.PI / 180;

  // ---------- Gewichte dekodieren (einmalig, träge) -------------------------
  let NET = null;
  function b64f32(s) {
    if (typeof Buffer !== 'undefined') {
      const buf = Buffer.from(s, 'base64');
      return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    }
    const bin = atob(s), n = bin.length;
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  }
  function loadNet() {
    if (NET) return NET;
    const D = global.NEURALFOIL_DATA;
    if (!D) return null;
    NET = {
      layers: D.layers.map(L => ({ rows: L.rows, cols: L.cols, w: b64f32(L.w), b: b64f32(L.b) })),
      mean: b64f32(D.mean),
      invCov: b64f32(D.invCov),
      model: D.model
    };
    return NET;
  }

  // ---------- kleines Gauß-Lösen (für den Kulfan-Fit) -----------------------
  function solveGauss(A, b) {                        // A: n×n (Array of Float64Array)
    const n = b.length;
    for (let k = 0; k < n; k++) {
      let m = k;
      for (let i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > Math.abs(A[m][k])) m = i;
      if (m !== k) { const t = A[k]; A[k] = A[m]; A[m] = t; const tb = b[k]; b[k] = b[m]; b[m] = tb; }
      const akk = A[k][k] || 1e-30;
      for (let i = k + 1; i < n; i++) {
        const f = A[i][k] / akk;
        if (f) { for (let j = k; j < n; j++) A[i][j] -= f * A[k][j]; b[i] -= f * b[k]; }
      }
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
      x[i] = s / (A[i][i] || 1e-30);
    }
    return x;
  }

  // ---------- Kulfan-(CST)-Fit (aerosandbox „least_squares", 8+8+LEM+TE) ----
  // Kleinste Quadrate über die Normalengleichungen: y ≈ A·[lo(8), up(8), LEM, TE].
  // Negative TE-Dicke → erneut ohne TE-Spalte (TE = 0), wie im Original.
  const COMB7 = [1, 7, 21, 35, 35, 21, 7, 1];        // Bernstein-Koeffizienten N=7
  function kulfanFit(prof) {
    const pts = prof.map(p => [+p.x, +p.y]).filter(p => isFinite(p[0]) && isFinite(p[1]));
    if (pts.length < 10) return null;
    // sanft normalisieren: x auf [0,1] (Profile der App sind es praktisch schon)
    let x0 = Infinity, x1 = -Infinity;
    for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; }
    const sc = 1 / Math.max(1e-9, x1 - x0);
    const xs = pts.map(p => (p[0] - x0) * sc), ys = pts.map(p => p[1] * sc);
    let iLE = 0;
    for (let i = 1; i < xs.length; i++) if (xs[i] < xs[iLE]) iLE = i;
    const M = xs.length, NC = 18;
    const rows = [];                                 // je Punkt die 18 Basiswerte
    for (let i = 0; i < M; i++) {
      const x = Math.min(1, Math.max(0, xs[i]));
      const isUp = i <= iLE;
      const C = Math.sqrt(x) * (1 - x);              // Klassenfunktion N1=0.5, N2=1
      const row = new Float64Array(NC);
      for (let k = 0; k < 8; k++) {
        const S = COMB7[k] * Math.pow(x, k) * Math.pow(1 - x, 7 - k);
        row[(isUp ? 8 : 0) + k] = C * S;             // Spalten 0..7 = unten, 8..15 = oben
      }
      row[16] = x * Math.pow(Math.max(0, 1 - x), 8.5);   // LEM
      row[17] = isUp ? x / 2 : -x / 2;               // TE-Dicke
      rows.push(row);
    }
    const solve = nc => {
      const AtA = [], Atb = new Float64Array(nc);
      for (let a = 0; a < nc; a++) AtA.push(new Float64Array(nc));
      for (let i = 0; i < M; i++) {
        const r = rows[i], y = ys[i];
        for (let a = 0; a < nc; a++) {
          if (!r[a]) continue;
          Atb[a] += r[a] * y;
          for (let b = a; b < nc; b++) AtA[a][b] += r[a] * r[b];
        }
      }
      for (let a = 0; a < nc; a++) for (let b = 0; b < a; b++) AtA[a][b] = AtA[b][a];
      return solveGauss(AtA, Atb);
    };
    let s = solve(18);
    let lower = Array.from(s.slice(0, 8)), upper = Array.from(s.slice(8, 16)),
      lew = s[16], tet = s[17];
    if (tet < 0) {
      s = solve(17);
      lower = Array.from(s.slice(0, 8)); upper = Array.from(s.slice(8, 16));
      lew = s[16]; tet = 0;
    }
    return { lower, upper, lew, tet };
  }

  // ---------- Netz-Vorwärtspass ---------------------------------------------
  function netEval(net, x) {                         // x: Float64Array(25)
    let v = Float64Array.from(x);
    for (let li = 0; li < net.layers.length; li++) {
      const L = net.layers[li];
      const out = new Float64Array(L.rows);
      for (let r = 0; r < L.rows; r++) {
        let s = L.b[r];
        const off = r * L.cols;
        for (let c = 0; c < L.cols; c++) s += L.w[off + c] * v[c];
        out[r] = s;
      }
      if (li < net.layers.length - 1)
        for (let r = 0; r < L.rows; r++) {           // Swish-Aktivierung
          const z = out[r];
          out[r] = z / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
        }
      v = out;
    }
    return v;
  }
  function maha2(net, x) {                           // quadr. Mahalanobis-Abstand
    const n = 25, d = new Float64Array(n);
    for (let i = 0; i < n; i++) d[i] = x[i] - net.mean[i];
    let s = 0;
    for (let i = 0; i < n; i++) {
      let t = 0;
      const off = i * n;
      for (let j = 0; j < n; j++) t += net.invCov[off + j] * d[j];
      s += d[i] * t;
    }
    return s;
  }

  // Ein Betriebspunkt: Eingänge bauen, Netz normal + gespiegelt auswerten
  // (Alpha-Symmetrie wie im Original), Ausgänge 0..5 zurückspiegeln und mitteln.
  function evalPoint(net, kp, alphaDeg, Re, ncrit, xtru, xtrl) {
    const a = alphaDeg * RAD;
    const x = new Float64Array(25);
    for (let i = 0; i < 8; i++) { x[i] = kp.upper[i]; x[8 + i] = kp.lower[i]; }
    x[16] = kp.lew; x[17] = kp.tet * 50;
    x[18] = Math.sin(2 * a); x[19] = Math.cos(a); x[20] = 1 - x[19] * x[19];
    x[21] = (Math.log(Re) - 12.5) / 3.5;
    x[22] = (ncrit - 9) / 4.5;
    x[23] = xtru; x[24] = xtrl;
    const xf = Float64Array.from(x);
    for (let i = 0; i < 8; i++) { xf[i] = -x[8 + i]; xf[8 + i] = -x[i]; }
    xf[16] = -x[16]; xf[18] = -x[18]; xf[23] = x[24]; xf[24] = x[23];
    const y = netEval(net, x), yf = netEval(net, xf);
    const c0 = y[0] - maha2(net, x) / 50;            // 2·25 Eingänge
    const c0f = yf[0] - maha2(net, xf) / 50;
    const f1 = (y[1] - yf[1]) / 2, f2 = (y[2] + yf[2]) / 2, f3 = (y[3] - yf[3]) / 2;
    const f4 = (y[4] + yf[5]) / 2, f5 = (y[5] + yf[4]) / 2;
    const c = (c0 + c0f) / 2;
    return {
      conf: 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, c)))),
      cl: f1 / 2,
      cd: Math.exp((f2 - 2) * 2),
      cm: f3 / 20,
      xtrU: Math.min(1, Math.max(0, f4)),
      xtrL: Math.min(1, Math.max(0, f5))
    };
  }

  // ---------- Foil2D-kompatible Schnittstelle -------------------------------
  // Liegt die Sehne (Nase → Endleistenmitte) nicht auf der x-Achse — z. B. Stufen-
  // profile aus dem KFm-Gestalter, die bei waagrechter Grundplatte (0°) ausgerichtet
  // sind —, wird intern zur Sehne gedreht gerechnet und α zurück auf die x-Achse
  // des übergebenen Profils bezogen (α_x = α_Sehne + Sehnenwinkel).
  function build(prof) {
    const net = loadNet();
    if (!net) return null;
    const n = prof.length;
    const te = { x: (prof[0].x + prof[n - 1].x) / 2, y: (prof[0].y + prof[n - 1].y) / 2 };
    let le = prof[0], dm = -1;
    for (const q of prof) { const d = Math.hypot(q.x - te.x, q.y - te.y); if (d > dm) { dm = d; le = q; } }
    const ang = Math.atan2(te.y - le.y, te.x - le.x);
    if (!isFinite(ang) || Math.abs(ang) < 1e-4) return fromKulfan(kulfanFit(prof), net);
    const ca = Math.cos(-ang), sa = Math.sin(-ang);
    const rot = prof.map(q => { const dx = q.x - le.x, dy = q.y - le.y; return { x: dx * ca - dy * sa, y: dx * sa + dy * ca }; });
    const m = fromKulfan(kulfanFit(rot), net);
    if (!m) return m;
    const dA = ang / RAD;                            // Grad
    return Object.assign({}, m, {
      chordAngle: dA,
      run: (a, Re, o) => Object.assign(m.run(a - dA, Re, o), { alpha: a }),
      polar: o => {
        o = Object.assign({}, o);
        o.a0 = (o.a0 != null ? o.a0 : -6) - dA; o.a1 = (o.a1 != null ? o.a1 : 18) - dA;
        const r = m.polar(o);
        if (r) { r.pts.forEach(q => { q.alpha += dA; }); r.alphaMax += dA; }
        return r;
      }
    });
  }
  // Modell direkt aus Kulfan-Parametern {lower[8], upper[8], lew, tet} — für die
  // Profiloptimierung (profopt_core.js), die in diesen Parametern sucht.
  function fromKulfan(kp, net) {
    net = net || loadNet();
    if (!net || !kp) return null;
    function run(alphaDeg, Re, o) {
      o = o || {};
      const ncrit = o.ncrit != null ? o.ncrit : 9;
      const r = evalPoint(net, kp, alphaDeg, Re, ncrit, 1, 1);
      return { alpha: alphaDeg, cl: r.cl, cd: r.cd, cm: r.cm,
        xtrU: r.xtrU, xtrL: r.xtrL, conf: r.conf, sep: false, xsepU: 1, bub: false };
    }
    // cl_max genauer: um den besten Rasterpunkt zwei halbierte Schritte
    // nachrechnen und dann den Scheitel der Parabel durch die drei Punkte
    // um das Maximum nehmen.
    function refinePeak(pts, evalAt, da) {
      const imax = () => { let b = 0; for (let i = 1; i < pts.length; i++) if (pts[i].cl > pts[b].cl) b = i; return b; };
      for (let step = da / 2; step >= da / 4 - 1e-9; step /= 2) {
        const aM = pts[imax()].alpha;
        for (const a of [aM - step, aM + step]) {
          if (pts.some(p => Math.abs(p.alpha - a) < 1e-6)) continue;
          let r = null; try { r = evalAt(a); } catch (e) { r = null; }
          if (r && isFinite(r.cl)) pts.push(Object.assign({}, r, { alpha: a }));
        }
        pts.sort((x, y) => x.alpha - y.alpha);
      }
      const b = imax();
      let cl = pts[b].cl, alpha = pts[b].alpha;
      if (b > 0 && b < pts.length - 1) {
        const p0 = pts[b - 1], p1 = pts[b], p2 = pts[b + 1];
        const d1 = p1.alpha - p0.alpha, d2 = p2.alpha - p1.alpha;
        if (d1 > 1e-9 && d2 > 1e-9) {
          const s1 = (p1.cl - p0.cl) / d1, s2 = (p2.cl - p1.cl) / d2;
          const c = (s2 - s1) / (p2.alpha - p0.alpha);
          if (c < -1e-9) {
            const aV = (p0.alpha + p1.alpha) / 2 - s1 / (2 * c);
            if (aV > p0.alpha && aV < p2.alpha) {
              const v = p0.cl + s1 * (aV - p0.alpha) + c * (aV - p0.alpha) * (aV - p1.alpha);
              if (isFinite(v) && v >= cl) { cl = v; alpha = aV; }
            }
          }
        }
      }
      return { cl, alpha };
    }

    // Polare: Alpha-Reihe; Punkte mit zu geringer Netz-Konfidenz (weit weg
    // von den XFOIL-Trainingsdaten = tief im Abriss oder exotischer Zustand)
    // fliegen raus; clmax = Maximum, nach klarem Abfall früh beenden.
    function polar(o) {
      o = o || {};
      const a0 = o.a0 != null ? o.a0 : -6, a1 = o.a1 != null ? o.a1 : 18, da = o.da || 0.5;
      const Re = o.Re || 2e5;
      const ncrit = o.ncrit != null ? o.ncrit : 9;
      const pts = [];
      let clmax = -Infinity, aMax = 0, drop = 0, weak = 0, stopped = false;
      const sweep = (from, to) => {
        for (let a = from; a <= to + 1e-9; a += da) {
          const r = run(a, Re, { ncrit });
          if (r.conf < 0.6) {                        // unsicher: hinter dem Abriss abbrechen
            if (a > 2 && clmax > 0.3 && ++weak >= 2) { stopped = true; break; }
            continue;
          }
          weak = 0;
          pts.push(r);
          if (r.cl > clmax) { clmax = r.cl; aMax = a; drop = 0; }
          else if (a > 2 && r.cl < clmax - 0.02) { if (++drop >= 4) { stopped = true; break; } }
        }
      };
      sweep(a0, a1);
      // Steigt cl am oberen Rand noch, liegt cl_max über dem Bogenende:
      // in 2°-Schritten verlängern (höchstens +8°)
      let aTop = a1;
      while (!stopped && aTop < a1 + 8 && pts.length && pts[pts.length - 1].cl >= clmax - 1e-9) {
        const nx = Math.min(a1 + 8, aTop + 2);
        sweep(aTop + da, nx); aTop = nx;
      }
      // Spitze fein nachfahren + Parabelscheitel (der 0,5°-Raster trifft
      // cl_max fast nie genau)
      if (pts.length > 2) {
        const pk = refinePeak(pts, a => { const r = run(a, Re, { ncrit }); return (r && r.conf >= 0.6) ? r : null; }, da);
        clmax = pk.cl; aMax = pk.alpha;
      }
      return { Re, pts, clmax: isFinite(clmax) ? clmax : NaN, alphaMax: aMax };
    }
    return { run, polar, kulfan: kp, model: net.model };
  }

  const NeuralFoil = {
    build, fromKulfan, kulfanFit,
    ready: () => !!loadNet(),
    polar: (prof, o) => { const m = build(prof); return m ? m.polar(o) : null; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = NeuralFoil;
  global.NeuralFoil = NeuralFoil;
})(typeof window !== 'undefined' ? window : globalThis);
