/* profilfit.js — Profilkurven aus .dat-Punkten (Kern, ohne Oberfläche; Browser und Node).
 *
 * Gemeinsame Mathematik für den Formenbau (Urmodell/Formen) und die Heißdraht-Rippen:
 *   - Ausgleichs-B-Spline (kubisch, geklemmt) mit Krümmungsstrafe, Endleistenpunkte fest
 *   - toleranzgesteuerte Verfeinerung: Knotenspannen nur dort halbieren, wo ein Punkt der
 *     Original-.dat weiter als tol von der Kurve liegt (Nase, Klappenknick)
 *   - Nase fest (optional): Kurve geht exakt durch den Nasenpunkt, Tangente dort senkrecht
 *     zur Sehne (Nase -> Endleistenmitte); Nebenbedingungen per Lagrange-Multiplikator
 *   - exakte Interpolation durch alle Punkte (global, zentripetal, NURBS-Book A9.1)
 *   - Abtastung: Kosinus-Verteilung je Profilseite, Nase immer bei Index ceil(M/2)-1
 *     (gleiche Indexlage wie Airfoil.resample -> Rippen bleiben punktweise synchron)
 *
 * Punkte: {x, y}, Reihenfolge Endleiste oben -> Nase -> Endleiste unten (Selig).
 */
(function (global) {
  'use strict';

  // ---------- Parameter / Basis -------------------------------------------
  // Kumulierte Sehnenlänge^e (e = 1 Sehnenlänge, 0,5 zentripetal), normiert auf 0..1.
  function chordParam(P, e) {
    const u = [0];
    for (let i = 1; i < P.length; i++) { const d = Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y); u.push(u[i - 1] + (e && e !== 1 ? Math.pow(d, e) : d)); }
    const L = u[u.length - 1] || 1;
    return u.map(v => v / L);
  }
  // Kubische B-Spline-Basis (geklemmt), NURBS-Book A2.2. t: Knoten (K+4), K Kontrollpunkte.
  function bsBasis(u, t, K) {
    const p = 3, N = new Float64Array(K);
    if (u >= 1) u = 1 - 1e-12; if (u < 0) u = 0;
    let k = p; while (k < K - 1 && u >= t[k + 1]) k++;
    const left = [], right = [], Nn = [1];
    for (let j = 1; j <= p; j++) {
      left[j] = u - t[k + 1 - j]; right[j] = t[k + j] - u;
      let saved = 0;
      for (let r = 0; r < j; r++) { const tmp = Nn[r] / (right[r + 1] + left[j - r]); Nn[r] = saved + right[r + 1] * tmp; saved = left[j - r] * tmp; }
      Nn[j] = saved;
    }
    for (let j = 0; j <= p; j++) N[k - p + j] = Nn[j];
    return N;
  }
  // Ableitung der Basis nach u (zentrale Differenz; an einfachen Knoten ist der kubische Spline C2).
  function bsBasisD(u, t, K) {
    const h = 1e-6, a = Math.max(0, u - h), b = Math.min(1 - 1e-12, u + h);
    const Na = bsBasis(a, t, K), Nb = bsBasis(b, t, K), D = new Float64Array(K);
    for (let i = 0; i < K; i++) D[i] = (Nb[i] - Na[i]) / (b - a);
    return D;
  }
  // Knoten: geklemmt, innere Knoten an den Quantilen der Punktparameter (dicht an
  // Nase/Endleiste, wo die Punkte dicht liegen).
  function knotsFor(u, K) {
    const t = [0, 0, 0, 0], ni = K - 4, n = u.length;
    for (let j = 1; j <= ni; j++) {
      const pos = j * (n - 1) / (ni + 1), i0 = Math.floor(pos), f = pos - i0;
      t.push(u[i0] + f * ((u[Math.min(i0 + 1, n - 1)] - u[i0]) || 0));
    }
    t.push(1, 1, 1, 1);
    return t;
  }
  function solveLinear(A, b, n, m) {   // A n×n (Array of Float64Array), b n×m; Gauß mit Pivot
    for (let c = 0; c < n; c++) {
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      if (piv !== c) { const tA = A[c]; A[c] = A[piv]; A[piv] = tA; const tb = b[c]; b[c] = b[piv]; b[piv] = tb; }
      const d = A[c][c] || 1e-12;
      for (let r = c + 1; r < n; r++) {
        const f = A[r][c] / d; if (!f) continue;
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        for (let k = 0; k < m; k++) b[r][k] -= f * b[c][k];
      }
    }
    const x = []; for (let r = 0; r < n; r++) x[r] = new Float64Array(m);
    for (let r = n - 1; r >= 0; r--) {
      for (let k = 0; k < m; k++) {
        let s = b[r][k]; for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c][k];
        x[r][k] = s / (A[r][r] || 1e-12);
      }
    }
    return x;
  }

  // ---------- Nase / Sehne ---------------------------------------------------
  // Nase einer Kontur: Punkt mit größtem Abstand zur Endleistenmitte (wie Airfoil.normalize).
  function noseIndex(P) {
    const n = P.length, tx = (P[0].x + P[n - 1].x) / 2, ty = (P[0].y + P[n - 1].y) / 2;
    let iLE = 0, dm = -1;
    for (let i = 0; i < n; i++) { const d = Math.hypot(P[i].x - tx, P[i].y - ty); if (d > dm) { dm = d; iLE = i; } }
    return iLE;
  }
  // Sehnen-Koordinatensystem: Ursprung Nase, ex = Richtung Nase -> Endleistenmitte.
  function chordFrame(P, iLE) {
    const n = P.length, o = P[iLE], tx = (P[0].x + P[n - 1].x) / 2 - o.x, ty = (P[0].y + P[n - 1].y) / 2 - o.y;
    const L = Math.hypot(tx, ty) || 1, ex = { x: tx / L, y: ty / L };
    return { o, ex, ey: { x: -ex.y, y: ex.x },
      to: p => ({ x: (p.x - o.x) * ex.x + (p.y - o.y) * ex.y, y: -(p.x - o.x) * ex.y + (p.y - o.y) * ex.x }),
      from: q => ({ x: o.x + q.x * ex.x - q.y * ex.y, y: o.y + q.x * ex.y + q.y * ex.x }) };
  }

  // ---------- Ausgleichs-B-Spline --------------------------------------------
  /* Ausgleichs-B-Spline durch P zu Parametern u und Knoten t. Erster/letzter Kontrollpunkt =
   * Endleistenpunkte (fest). lambda: Strafe auf 2. Differenzen der Kontrollpunkte, skaliert mit
   * Punktzahl / Grund-Kontrollpunktzahl K0 (beim Verfeinern bleibt die Glättung gleich stark).
   * nose = { i, u }: Kurve geht bei u exakt durch P[i], Tangente dort senkrecht zur Sehne. */
  function fitKnots(P, u, t, lambda, K0, nose) {
    const n = P.length, K = t.length - 4;
    const fr = nose ? chordFrame(P, nose.i) : null;
    const Q = fr ? P.map(fr.to) : P;
    const A = []; for (let i = 0; i < K; i++) A.push(new Float64Array(K));
    const b = []; for (let i = 0; i < K; i++) b.push(new Float64Array(2));
    for (let i = 0; i < n; i++) {
      const Bi = bsBasis(u[i], t, K);
      for (let r = 0; r < K; r++) { const br = Bi[r]; if (!br) continue;
        for (let c = 0; c < K; c++) if (Bi[c]) A[r][c] += br * Bi[c];
        b[r][0] += br * Q[i].x; b[r][1] += br * Q[i].y; }
    }
    // Krümmungsstrafe: sum (c[i-1] - 2c[i] + c[i+1])^2, skaliert mit Punktdichte
    // und Sehnenlänge (Kontrollpunktabstand ~ L/K).
    const lam = (lambda || 0) * (n / (K0 || K)) * 0.02;
    if (lam > 0) for (let i = 1; i < K - 1; i++) {
      const idx = [i - 1, i, i + 1], w = [1, -2, 1];
      for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) A[idx[a]][idx[c]] += lam * w[a] * w[c];
    }
    // Enden fest: c0 = Q0, cK-1 = Qn-1 -> aus dem System herausnehmen.
    const m = K - 2, q0 = Q[0], q1 = Q[n - 1];
    let xs;
    if (!nose) {
      const A2 = [], b2 = [];
      for (let r = 1; r < K - 1; r++) {
        A2.push(A[r].slice(1, K - 1));
        b2.push(new Float64Array([b[r][0] - A[r][0] * q0.x - A[r][K - 1] * q1.x, b[r][1] - A[r][0] * q0.y - A[r][K - 1] * q1.y]));
      }
      xs = solveLinear(A2, b2, m, 2);
    } else {
      // Je Koordinate eigenes KKT-System: [A C^T; C 0] [c; mu] = [b; d].
      // x (entlang der Sehne): x(uLE) = 0 und x'(uLE) = 0 (Tangente senkrecht zur Sehne); y: y(uLE) = 0.
      const Nl = bsBasis(nose.u, t, K), Dl = bsBasisD(nose.u, t, K);
      const solveC = (coord, cons) => {
        const nc = cons.length, S = m + nc, M2 = [], rhs = [];
        for (let r = 1; r < K - 1; r++) {
          const row = new Float64Array(S); row.set(A[r].slice(1, K - 1));
          cons.forEach((cn, j) => { row[m + j] = cn.w[r]; });
          M2.push(row); rhs.push(new Float64Array([b[r][coord] - A[r][0] * (coord ? q0.y : q0.x) - A[r][K - 1] * (coord ? q1.y : q1.x)]));
        }
        for (const cn of cons) {
          const row = new Float64Array(S); for (let r = 1; r < K - 1; r++) row[r - 1] = cn.w[r];
          M2.push(row); rhs.push(new Float64Array([cn.d - cn.w[0] * (coord ? q0.y : q0.x) - cn.w[K - 1] * (coord ? q1.y : q1.x)]));
        }
        const s = solveLinear(M2, rhs, S, 1); const out = []; for (let i = 0; i < m; i++) out.push(s[i][0]); return out;
      };
      const cx = solveC(0, nose.tangent === false ? [{ w: Nl, d: 0 }] : [{ w: Nl, d: 0 }, { w: Dl, d: 0 }]), cy = solveC(1, [{ w: Nl, d: 0 }]);
      xs = cx.map((v, i) => [v, cy[i]]);
    }
    let ctrl = [{ x: q0.x, y: q0.y }];
    for (let i = 0; i < m; i++) ctrl.push({ x: xs[i][0], y: xs[i][1] });
    ctrl.push({ x: q1.x, y: q1.y });
    if (fr) ctrl = ctrl.map(fr.from);
    const ev = uu => { const N = bsBasis(uu, t, K); let x = 0, y = 0;
      for (let i = 0; i < K; i++) if (N[i]) { x += N[i] * ctrl[i].x; y += N[i] * ctrl[i].y; } return { x, y }; };
    return { ev, ctrl, t };
  }
  /* Ausgleichs-B-Spline mit K Kontrollpunkten. iLE: Index der Nase in P (Standard: Mitte, wie
   * bei den neu abgetasteten Rippen). noseFix: Nase fest (Punkt + Tangente). */
  function fitBSpline(P, K, lambda, iLE, noseFix) {
    const n = P.length; K = Math.max(6, Math.min(K, n - 1));
    if (iLE == null) iLE = Math.ceil(n / 2) - 1;
    const u = chordParam(P), f = fitKnots(P, u, knotsFor(u, K), lambda, K, noseFix ? { i: iLE, u: u[iLE], tangent: noseFix !== 'point' } : null);
    return { ev: f.ev, ctrl: f.ctrl, t: f.t, u, uLE: u[iLE] };
  }
  /* Abstand jedes Punkts aus ref zur Kurve ev (dicht abgetastet), mit Kurvenparameter
   * des Lotfußpunkts. */
  function curveResiduals(ref, ev, NS) {
    const S = []; for (let i = 0; i <= NS; i++) S.push(ev(i / NS));
    return ref.map(p => {
      let best = Infinity, bu = 0;
      for (let i = 0; i < NS; i++) {
        const a = S[i], b = S[i + 1], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-30;
        let s = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2; s = s < 0 ? 0 : s > 1 ? 1 : s;
        const d = Math.hypot(p.x - a.x - s * dx, p.y - a.y - s * dy); if (d < best) { best = d; bu = (i + s) / NS; }
      }
      return { d: best, u: bu };
    });
  }
  /* Toleranzgesteuerte Ausgleichung: Start mit K0 Kontrollpunkten (Knoten wie fitBSpline),
   * dann jede Knotenspanne, in der ein Punkt weiter als tol von der Kurve liegt, halbieren
   * und neu anpassen — bis alle Punkte innerhalb tol liegen oder maxK erreicht ist. Die
   * Kurve wird so nur dort feiner, wo sie es braucht (Nase, Klappenknick); der Rest bleibt
   * so glatt wie mit K0. Ohne Glättungsstrafe (lambda = 0) wird eine Spanne nur geteilt, wenn
   * beide Hälften Datenpunkte haben (sonst singuläres System); mit Strafe bleibt es lösbar. */
  function fitTolerance(P, K0, lambda, tol, iLE, maxK, noseFix) {
    const n = P.length; K0 = Math.max(6, Math.min(K0, n - 1)); maxK = Math.min(maxK || 150, n - 1);
    const u = chordParam(P), nose = noseFix ? { i: iLE, u: u[iLE], tangent: noseFix !== 'point' } : null;
    let t = knotsFor(u, K0), f = null, res = null, it = 0;
    const NS = Math.min(4000, Math.max(1500, 12 * n));
    for (;;) {
      f = fitKnots(P, u, t, lambda, K0, nose); res = curveResiduals(P, f.ev, NS); it++;
      const bad = res.filter(r => r.d > tol);
      if (!bad.length || t.length - 4 >= maxK || it > 24) break;
      const spans = new Set();
      for (const r of bad) { let k = 3; while (k < t.length - 5 && r.u >= t[k + 1]) k++; spans.add(k); }
      const add = [];
      for (const k of spans) {
        const a = t[k], b = t[k + 1], mid = (a + b) / 2; if (b - a < 1e-7) continue;
        if (!(lambda > 0)) {
          let nl = 0, nr = 0; for (const v of u) { if (v >= a && v < mid) nl++; else if (v >= mid && v <= b) nr++; }
          if (!nl || !nr) continue;
        }
        add.push(mid);
      }
      if (!add.length || t.length - 4 + add.length > maxK) break;
      t = t.concat(add).sort((x, y) => x - y);
    }
    let dev = 0; for (const r of res) if (r.d > dev) dev = r.d;
    return { ev: f.ev, ctrl: f.ctrl, t: f.t, u, uLE: u[iLE], dev, ok: dev <= tol + 1e-9 };
  }

  // ---------- Exakte Interpolation (NURBS-Book A9.1) -------------------------
  /* Kubischer B-Spline exakt durch ALLE Punkte: zentripetale Parameter, Knotenmittelung (9.8).
   * Folgt der .dat ohne Abweichung — übernimmt aber auch deren Rundungsrauschen. */
  function interpolate(P, iLE) {
    const n = P.length, p = 3;
    if (n < 4) return fitBSpline(P, Math.max(4, n - 1), 0, iLE);
    const u = chordParam(P, 0.5);
    const t = [0, 0, 0, 0];
    for (let j = 1; j <= n - 1 - p; j++) { let s = 0; for (let i = j; i < j + p; i++) s += u[i]; t.push(s / p); }
    t.push(1, 1, 1, 1);
    const K = n, A = [], b = [];
    for (let i = 0; i < n; i++) {
      const row = i === n - 1 ? (() => { const r = new Float64Array(K); r[K - 1] = 1; return r; })() : bsBasis(u[i], t, K);
      A.push(Float64Array.from(row)); b.push(new Float64Array([P[i].x, P[i].y]));
    }
    const xs = solveLinear(A, b, K, 2), ctrl = xs.map(v => ({ x: v[0], y: v[1] }));
    const ev = uu => { if (uu >= 1) return { x: ctrl[K - 1].x, y: ctrl[K - 1].y };
      const N = bsBasis(uu, t, K); let x = 0, y = 0; for (let i = 0; i < K; i++) if (N[i]) { x += N[i] * ctrl[i].x; y += N[i] * ctrl[i].y; } return { x, y }; };
    return { ev, ctrl, t, u, uLE: u[iLE != null ? iLE : noseIndex(P)] };
  }

  // ---------- Abtastung / Abweichung ----------------------------------------
  // Auswerte-Parameter: Kosinus-Verteilung um die Nase (uLE), Nase bei Index Mu-1.
  function evalParams(M, uLE) {
    const Mu = Math.ceil(M / 2), Ml = M - Mu + 1, out = [];
    for (let i = 0; i < Mu; i++) out.push(uLE * (1 - Math.cos(Math.PI * i / (Mu - 1))) / 2);
    for (let j = 1; j < Ml; j++) out.push(uLE + (1 - uLE) * (1 - Math.cos(Math.PI * j / (Ml - 1))) / 2);
    return out;
  }
  function leIndex(M) { return Math.ceil(M / 2) - 1; }
  // Abstand Punkt -> Polylinie (max über alle Punkte; misst auch den Sehnenfehler der Abtastung).
  function maxDeviation(raw, curve) {
    let worst = 0;
    for (const p of raw) { const d = distToPolyline(p, curve).d; if (d > worst) worst = d; }
    return worst;
  }
  // Abstand + Vorzeichen (+ = außerhalb, Kontur Selig/CCW) eines Punkts zur Polylinie.
  function distToPolyline(p, curve) {
    let best = Infinity, sg = 1;
    for (let i = 0; i < curve.length - 1; i++) {
      const a = curve[i], b = curve[i + 1], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-12;
      let s = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2; s = s < 0 ? 0 : s > 1 ? 1 : s;
      const ex = p.x - a.x - s * dx, ey = p.y - a.y - s * dy, d = Math.hypot(ex, ey);
      if (d < best) { best = d; sg = (dx * ey - dy * ex) > 0 ? 1 : -1; }
    }
    return { d: best, s: sg };
  }
  function extentC(R) { let a = Infinity, b = -Infinity; for (const p of R) { if (p.x < a) a = p.x; if (p.x > b) b = p.x; } return b - a; }

  /* Profilkurve einer Rippe: M Punkte, Nase bei leIndex(M).
   * opt: { mode 'bspline'|'interp'|'none', ctrl (je Seite), lambda, tol (mm), nose (Nase fest), pts }
   * src: Originalkontur (vor dem Neu-Abtasten) — Abweichung wird immer dagegen gemessen.
   * chordMm: Sehne in mm, falls P/src normiert sind -> tol und Abweichung umrechnen.
   * Rückgabe { pts, dev (Kurve), devPoly (abgetastete Polylinie), ok, ctrl, ev, uLE }. */
  function ribCurve(P, opt, src, chordMm) {
    const M = opt.pts, ref = src && src.length >= 5 ? src : P;
    const c = extentC(ref), sc = chordMm > 0 && c > 0 ? chordMm / c : 1;   // Einheit -> mm
    let r;
    // Alle Methoden arbeiten auf ref (Original-.dat), nie auf der schon neu abgetasteten
    // Heißdraht-Rippe P: Formenbau und Heißdraht bleiben strikt getrennt.
    if (opt.mode === 'none') {
      const pts = global.Airfoil.resample(ref, M).map(p => ({ x: p.x, y: p.y }));
      r = { pts, dev: ref !== P ? maxDeviation(ref, pts) * sc : 0, ctrl: null };
    } else if (opt.mode === 'interp') {
      const f = interpolate(ref, noseIndex(ref));
      r = { pts: evalParams(M, f.uLE).map(f.ev), dev: 0, ok: true, ctrl: f.ctrl, ev: f.ev, uLE: f.uLE, t: f.t };
    } else {
      const K = 2 * opt.ctrl + 1;
      if (opt.tol > 0) {
        const iLE = noseIndex(ref), f = fitTolerance(ref, K, opt.lambda, opt.tol / sc, iLE, 150, opt.nose);
        r = { pts: evalParams(M, f.uLE).map(f.ev), dev: f.dev * sc, ok: f.ok, ctrl: f.ctrl, ev: f.ev, uLE: f.uLE, t: f.t };
      } else {
        const f = fitBSpline(ref, K, opt.lambda, null, opt.nose);
        const pts = evalParams(M, f.uLE).map(f.ev);
        r = { pts, dev: null, ctrl: f.ctrl, ev: f.ev, uLE: f.uLE, t: f.t };
      }
    }
    r.devPoly = maxDeviation(ref, r.pts) * sc;
    if (r.dev == null) r.dev = r.devPoly;
    return r;
  }

  /* Heißdraht-Rippe: normiertes Profil -> N Punkte nach Methode rf (gecacht je Profil-Array).
   * rf: { mode 'cr'|'bspline'|'interp', ctrl, lambda, tol (mm), nose }, chordMm für die Toleranz. */
  const CACHE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function ribSample(prof, N, chordMm, rf) {
    if (!rf || rf.mode === 'cr' || !prof || prof.length < 5) return global.Airfoil.resample(prof, N);
    const key = [N, rf.mode, rf.ctrl, rf.lambda, rf.mode === 'bspline' ? (rf.tol / (chordMm || 1)).toPrecision(6) : 0, rf.nose ? 1 : 0].join('|');
    let m = CACHE && CACHE.get(prof); if (m && m.has(key)) return m.get(key);
    let out;
    try {
      const r = ribCurve(prof, { mode: rf.mode, ctrl: rf.ctrl, lambda: rf.lambda, tol: rf.tol, nose: rf.nose, pts: N }, prof, chordMm);
      out = r.pts; out.fit = { dev: r.dev, devPoly: r.devPoly, ok: r.ok, ctrl: r.ctrl ? r.ctrl.length : 0 };
    } catch (e) { out = global.Airfoil.resample(prof, N); }
    out.name = prof.name; if (prof.keepAlign) out.keepAlign = true;
    if (CACHE) { if (!m) { m = new Map(); CACHE.set(prof, m); } if (m.size > 40) m.clear(); m.set(key, out); }
    return out;
  }

  /* Innere Knoten einer Rippenkurve im Ringparameter s (Oberseite 0..0,5, Unterseite 0,5..1;
   * so legt die Kosinus-Abtastung um uLE die Ringpunkte). Für das STEP-Kurvennetz. */
  function knotsToS(t, uLE) {
    if (!t || !(uLE > 0 && uLE < 1)) return [];
    const out = [];
    for (const v of t) { if (v <= 1e-9 || v >= 1 - 1e-9) continue; out.push(v < uLE ? 0.5 * v / uLE : 0.5 + 0.5 * (v - uLE) / (1 - uLE)); }
    return out;
  }

  global.ProfilFit = { knotsToS, chordParam, bsBasis, knotsFor, solveLinear, fitKnots, fitBSpline, fitTolerance, interpolate, curveResiduals,
    evalParams, leIndex, maxDeviation, distToPolyline, noseIndex, chordFrame, ribCurve, ribSample };
})(typeof window !== 'undefined' ? window : globalThis);
