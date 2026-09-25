/* stepexport.js — STEP-Export (ISO 10303-21, AP214) für den Formenbau.
 *
 * Erzeugt aus einem Ring-Stapel (Wurzel -> Spitze, gleiche Punktzahl je Ring)
 * einen echten, geschlossenen B-Rep-Volumenkörper (MANIFOLD_SOLID_BREP) mit
 * B-Spline-Flächen — im Gegensatz zum STL-Export ein glatter, im CAD editierbarer
 * Körper. Topologie:
 *   - Haut: je Ringsegment eine B_SPLINE_SURFACE_WITH_KNOTS-Streifenfläche
 *           (Grad 1 quer = exakt durch die Profilpunkte, Grad 3 in Spannweite = glatt).
 *           Benachbarte Streifen teilen ihre Spannkurve -> lückenlose Schale.
 *   - Deckel: Wurzel- und Spitzenring als planare Fläche.
 *   V - E + F = 2M - 3M + (M+2) = 2  (Euler, geschlossene Mannigfaltigkeit).
 *
 * Alle Spannketten nutzen EINEN gemeinsamen Knotenvektor (gemeinsame Parametrisierung
 * über die Ring-Schwerpunkte); die u=const-Isokurven der Streifenflächen sind damit
 * exakt die geteilten Kantenkurven -> der Kernel näht die Schale lückenlos.
 *
 * Läuft in Browser (window.App.stepExport) und Node (module.exports) — Letzteres
 * für den Test gegen einen echten CAD-Kernel (.claude/step_test.mjs, FreeCAD).
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- Zahlen
  // STEP-Real: immer mit Dezimalpunkt, kompakt.
  function R(x) {
    if (!isFinite(x)) x = 0;
    if (x === 0) return '0.';
    let s = x.toPrecision(12);
    if (s.indexOf('e') >= 0 || s.indexOf('E') >= 0) {
      let [mm, e] = s.split(/[eE]/);
      if (mm.indexOf('.') < 0) mm += '.';
      return mm + 'E' + (+e);
    }
    if (s.indexOf('.') < 0) return s + '.';
    return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '.');
  }

  // ------------------------------------------------- Vektor-Kleinkram (3D)
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => { const L = len(a) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };

  // ----------------------------------- B-Spline: Basis (De Boor A2.1/A2.2)
  function findSpan(n, p, u, U) {
    if (u >= U[n + 1]) return n;
    if (u <= U[p]) return p;
    let lo = p, hi = n + 1, mid = (lo + hi) >> 1;
    while (u < U[mid] || u >= U[mid + 1]) { if (u < U[mid]) hi = mid; else lo = mid; mid = (lo + hi) >> 1; }
    return mid;
  }
  function basisFuns(span, u, p, U) {
    const N = new Array(p + 1), left = new Array(p + 1), right = new Array(p + 1);
    N[0] = 1;
    for (let j = 1; j <= p; j++) {
      left[j] = u - U[span + 1 - j]; right[j] = U[span + j] - u; let saved = 0;
      for (let r = 0; r < j; r++) { const temp = N[r] / (right[r + 1] + left[j - r]); N[r] = saved + right[r + 1] * temp; saved = left[j - r] * temp; }
      N[j] = saved;
    }
    return N;
  }

  /* Gemeinsame Parametrisierung + Knotenvektor für m Stationen (zentripetal über die
   * gelieferten Repräsentanten-Distanzen dd[1..m-1]). Grad p = min(3, m-1). */
  function commonKnots(dd) {
    const m = dd.length;                 // dd[0] ungenutzt, dd[k]=Abstand Station k-1->k
    const p = Math.min(3, m - 1);
    const uk = new Array(m); uk[0] = 0;
    let tot = 0; for (let k = 1; k < m; k++) tot += dd[k];
    if (tot < 1e-12) { for (let k = 0; k < m; k++) uk[k] = k / (m - 1); }
    else { let acc = 0; for (let k = 1; k < m; k++) { acc += dd[k]; uk[k] = acc / tot; } uk[m - 1] = 1; }
    const nCtrl = m, mKnot = nCtrl + p + 1, U = new Array(mKnot).fill(0);
    for (let i = 0; i <= p; i++) { U[i] = 0; U[mKnot - 1 - i] = 1; }
    for (let j = 1; j <= nCtrl - p - 1; j++) { let s = 0; for (let i = j; i <= j + p - 1; i++) s += uk[i]; U[j + p] = s / p; }
    // Kollokationsmatrix A[k][i] = N_{i,p}(uk[k])
    const A = [];
    for (let k = 0; k < m; k++) {
      const row = new Array(nCtrl).fill(0);
      const span = findSpan(nCtrl - 1, p, uk[k], U), N = basisFuns(span, uk[k], p, U);
      for (let i = 0; i <= p; i++) row[span - p + i] = N[i];
      A.push(row);
    }
    // Knoten als Werte + Multiplizität
    const knots = [], mult = [];
    for (let i = 0; i < mKnot;) { let j = i; while (j < mKnot && Math.abs(U[j] - U[i]) < 1e-12) j++; knots.push(U[i]); mult.push(j - i); i = j; }
    return { p, A, knots, mult };
  }

  /* Bandierte Elimination (A quadratisch, total positiv -> ohne Pivot).
   * B: Matrix m×W (W = 3*M Spalten, alle Ketten gleichzeitig). In-place gelöst. */
  function solveBanded(A, B, p) {
    const n = A.length, W = B[0].length, bw = p + 1;
    for (let c = 0; c < n; c++) {
      const piv = A[c][c] || 1e-30;
      for (let r = c + 1; r < Math.min(n, c + bw + 1); r++) {
        const f = A[r][c] / piv; if (f === 0) continue;
        for (let k = c; k < Math.min(n, c + bw + 1); k++) A[r][k] -= f * A[c][k];
        const Br = B[r], Bc = B[c]; for (let w = 0; w < W; w++) Br[w] -= f * Bc[w];
      }
    }
    for (let r = n - 1; r >= 0; r--) {
      const Br = B[r];
      for (let k = r + 1; k < Math.min(n, r + bw + 1); k++) { const Ark = A[r][k], Bk = B[k]; if (Ark) for (let w = 0; w < W; w++) Br[w] -= Ark * Bk[w]; }
      const piv = A[r][r] || 1e-30; for (let w = 0; w < W; w++) Br[w] /= piv;
    }
  }

  // ------------------------------------------------------- STEP-Schreiber
  function StepWriter() { this.lines = []; this.id = 0; this.ptCache = new Map(); this.dirCache = new Map(); }
  StepWriter.prototype.add = function (body) { const id = ++this.id; this.lines.push('#' + id + '=' + body + ';'); return '#' + id; };
  StepWriter.prototype.num = function (ref) { return ref.slice(1); };
  StepWriter.prototype.pt = function (P) {
    // Gleiche Koordinaten -> dieselbe CARTESIAN_POINT-Entität (spart ~3× Punkte: Spannketten
    // werden von Kantenkurve und beiden Nachbarflächen geteilt). Zulässig; der frühere Absturz
    // lag am Inline-VECTOR in LINE, nicht am Punkt-Sharing.
    const key = R(P[0]) + ',' + R(P[1]) + ',' + R(P[2]);
    let r = this.ptCache.get(key); if (r) return r;
    r = this.add("CARTESIAN_POINT('',(" + R(P[0]) + ',' + R(P[1]) + ',' + R(P[2]) + '))');
    this.ptCache.set(key, r); return r;
  };
  StepWriter.prototype.dir = function (D) {
    const d = norm(D), key = R(d[0]) + ',' + R(d[1]) + ',' + R(d[2]);
    let r = this.dirCache.get(key); if (r) return r;
    r = this.add("DIRECTION('',(" + R(d[0]) + ',' + R(d[1]) + ',' + R(d[2]) + '))');
    this.dirCache.set(key, r); return r;
  };
  const realList = a => '(' + a.map(R).join(',') + ')';
  const intList = a => '(' + a.join(',') + ')';

  /* Steffen-Tangenten (monoton je Koordinate, kein Überschwingen) für eine Punktkette P[k] mit
   * Parametern zr[k]. Rückgabe T[k] = [dx,dy,dz]/dz-Param. */
  function steffenTangents(P, zr) {
    const m = P.length, T = new Array(m);
    for (let k = 0; k < m; k++) {
      const t = [0, 0, 0];
      for (let d = 0; d < 3; d++) {
        if (m < 2) break;
        if (k === 0) { const h = Math.max(1e-9, zr[1] - zr[0]); t[d] = (P[1][d] - P[0][d]) / h; }
        else if (k === m - 1) { const h = Math.max(1e-9, zr[m - 1] - zr[m - 2]); t[d] = (P[m - 1][d] - P[m - 2][d]) / h; }
        else {
          const h0 = Math.max(1e-9, zr[k] - zr[k - 1]), h1 = Math.max(1e-9, zr[k + 1] - zr[k]);
          const s0 = (P[k][d] - P[k - 1][d]) / h0, s1 = (P[k + 1][d] - P[k][d]) / h1;
          const pk = (s0 * h1 + s1 * h0) / (h0 + h1);
          t[d] = (Math.sign(s0) + Math.sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(pk));
        }
      }
      T[k] = t;
    }
    return T;
  }

  /* Adaptive Verfeinerung in Spannweite: wo die kubische (Steffen-)Fläche zwischen zwei Ringen mehr
   * als tol vom linearen Loft (= Heißdraht/STL) abweicht, wird der lineare Zwischenring eingefügt.
   * Abweichung in Segmentmitte = |T_k - T_{k+1}|·h/8 (Bézier bei t=0,5). Wenige Durchläufe reichen. */
  function refineRings(rings, tol) {
    for (let pass = 0; pass < 6; pass++) {
      const m = rings.length, M = rings[0].pts.length, zr = rings.map(r => r.z);
      const G = rings.map(r => r.pts.map(p => [p.x, p.y, (p.z == null ? r.z : p.z)]));
      const need = new Array(m - 1).fill(false); let any = false;
      for (let i = 0; i < M; i++) {
        const P = []; for (let r = 0; r < m; r++) P.push(G[r][i]);
        const T = steffenTangents(P, zr);
        for (let k = 0; k < m - 1; k++) {
          if (need[k]) continue;
          const h = zr[k + 1] - zr[k];
          const dx = (T[k][0] - T[k + 1][0]) * h / 8, dy = (T[k][1] - T[k + 1][1]) * h / 8, dz = (T[k][2] - T[k + 1][2]) * h / 8;
          if (Math.hypot(dx, dy, dz) > tol / 1.5) { need[k] = true; any = true; }   // Sicherheitsfaktor: Maximum liegt nicht exakt bei t=0,5
        }
      }
      if (!any) break;
      const out = [rings[0]];
      for (let k = 0; k < m - 1; k++) {
        if (need[k]) {
          const A = rings[k], B = rings[k + 1];
          out.push({ z: (A.z + B.z) / 2, pts: A.pts.map((p, i) => { const q = B.pts[i]; return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, z: (p.z == null || q.z == null) ? p.z : (p.z + q.z) / 2 }; }) });
        }
        out.push(rings[k + 1]);
      }
      rings = out;
      if (rings.length > 1500) break;
    }
    return rings;
  }

  /* Adaptive Verfeinerung im QUERSCHNITT (u): wo die glatte Katmull-Rom-Kurve zwischen zwei
   * Profilpunkten mehr als tol von der Sehne (= Polylinie/STL) abweicht (Sagitta bei t=0,5 =
   * 3/8·|(Q1-P0)+(Q2-P1)|), wird in ALLEN Ringen der lineare Zwischenpunkt eingefügt (Punktzahl
   * bleibt je Ring gleich). Ecken wie in buildShell (scharf in praktisch allen Ringen). */
  function refineU(rings, tol) {
    for (let pass = 0; pass < 4; pass++) {
      const m = rings.length, M = rings[0].pts.length;
      const G = rings.map(r => r.pts.map(p => [p.x, p.y, (p.z == null ? r.z : p.z)]));
      const TH = Math.cos(24 * Math.PI / 180), CORNER = new Array(M).fill(false);
      for (let i = 0; i < M; i++) {
        let sharp = 0, nonDeg = 0;
        for (let r = 0; r < m; r++) {
          const P = G[r], a = P[(i - 1 + M) % M], b = P[i], c = P[(i + 1) % M], u = sub(b, a), v = sub(c, b), lu = len(u), lv = len(v);
          if (lu < 1e-6 || lv < 1e-6) continue; nonDeg++; if (dot(u, v) / (lu * lv) < TH) sharp++;
        }
        CORNER[i] = nonDeg > 0 && (nonDeg - sharp) <= Math.max(1, Math.floor(0.05 * nonDeg));
      }
      const need = new Array(M).fill(false); let any = false;
      for (let r = 0; r < m; r++) {
        const P = G[r];
        for (let i = 0; i < M; i++) {
          if (need[i]) continue;
          const j = (i + 1) % M, h = (i - 1 + M) % M, j2 = (i + 2) % M;
          const P0 = P[i], P1 = P[j];
          let d1, m1; if (CORNER[i]) { d1 = sub(P1, P0); m1 = len(d1); } else { d1 = sub(P1, P[h]); m1 = Math.min(len(sub(P0, P[h])), len(sub(P1, P0))); }
          let d2, m2; if (CORNER[j]) { d2 = sub(P1, P0); m2 = len(d2); } else { d2 = sub(P[j2], P0); m2 = Math.min(len(sub(P1, P0)), len(sub(P[j2], P1))); }
          const L1 = len(d1) || 1, L2 = len(d2) || 1, s1 = m1 / (3 * L1), s2 = m2 / (3 * L2);
          // (Q1-P0)+(Q2-P1) = d1*s1 - d2*s2
          const ex = d1[0] * s1 - d2[0] * s2, ey = d1[1] * s1 - d2[1] * s2, ez = d1[2] * s1 - d2[2] * s2;
          if (0.375 * Math.hypot(ex, ey, ez) > tol / 1.5) { need[i] = true; any = true; }
        }
      }
      if (!any) break;
      rings = rings.map(r => {
        const pts = [];
        for (let i = 0; i < M; i++) {
          const p = r.pts[i], q = r.pts[(i + 1) % M]; pts.push(p);
          if (need[i]) pts.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, z: (p.z == null || q.z == null) ? p.z : (p.z + q.z) / 2 });
        }
        return { z: r.z, pts };
      });
      if (rings[0].pts.length > 2000) break;
    }
    return rings;
  }

  /* Kern: geschlossene Schale aus Ringen; schreibt Faces in Writer w, gibt Face-Refs zurück. */
  function buildShell(w, rings, opt) {
    const m = rings.length, M = rings[0].pts.length, flip = !!(opt && opt.flip);
    const G = rings.map(r => r.pts.map(p => [p.x, p.y, (p.z == null ? r.z : p.z)]));

    /* Spannweiten-Richtung (v): stückweise kubische Bézier durch JEDEN Ring, Tangenten nach Steffen
     * (monoton je Koordinate) -> KEIN Überschwingen, auch wenn z. B. die Kavität am Randbogen innerhalb
     * weniger mm zusammenfällt (die frühere globale Interpolation überschwang dort ~2 mm). C1 zwischen
     * den Ringen, die Fläche geht exakt durch jeden Ring. chainCo[i] = v-Kontrollzeilen
     * [P0, B1_0, B2_0, P1, B1_1, ...] (mv = 3m-2 Zeilen), Parameter = ring.z (Spannweite/Bogenlänge). */
    const p = 3, mv = 3 * m - 2, zr = rings.map(r => r.z);
    const chainCo = [];
    for (let i = 0; i < M; i++) {
      const P = []; for (let r = 0; r < m; r++) P.push(G[r][i]);
      const T = steffenTangents(P, zr);
      const co = [P[0]];
      for (let k = 0; k < m - 1; k++) {
        const h = Math.max(1e-9, zr[k + 1] - zr[k]);
        co.push([P[k][0] + T[k][0] * h / 3, P[k][1] + T[k][1] * h / 3, P[k][2] + T[k][2] * h / 3]);
        co.push([P[k + 1][0] - T[k + 1][0] * h / 3, P[k + 1][1] - T[k + 1][1] * h / 3, P[k + 1][2] - T[k + 1][2] * h / 3]);
        co.push(P[k + 1]);
      }
      chainCo.push(co);
    }
    const vmultArr = [4]; for (let k = 1; k < m - 1; k++) vmultArr.push(3); vmultArr.push(4);
    const vknotArr = []; for (let k = 0; k < m; k++) vknotArr.push(k);
    const vmult = intList(vmultArr), vknot = realList(vknotArr);
    const co2refs = co => co.map(c => w.pt(c));   // frische Punkte
    const key = P => R(P[0]) + ',' + R(P[1]) + ',' + R(P[2]);
    const coincident = (a, b) => len(sub(a, b)) < 1e-6;

    // Ecken im Querschnitt erkennen (scharfe Knicke: Endleiste, Flansch, Rückseite): Knickwinkel am
    // Punkt i über ALLE Ringe; Ecke, sobald er irgendwo die Schwelle übersteigt. Zwischen Ecken wird
    // EINE glatte, durch alle Profilpunkte interpolierte Fläche gebaut (nicht 1 Streifen je Punkt).
    /* Ecke nur, wenn der Knick in (praktisch) ALLEN nicht-entarteten Ringen scharf ist. Strukturelle
     * Ecken (Flansch, Rückseite, Endleiste, Kavität/Flansch) sind überall scharf. Ausklingende Features
     * (Blutrinne/Huckel mit Auslauf) werden dagegen flach -> KEINE Ecke -> sie bleiben in einem Bogen
     * und werden von der überschwingfreien Katmull-Rom exakt durch die Punkte abgebildet. Sonst laufen
     * ihre Eckkanten dort zusammen, wo das Feature verschwindet (Null-Breiten-Flächen, unsauberer Rand). */
    const CORNER = new Array(M).fill(false);
    {
      const TH = Math.cos(24 * Math.PI / 180);   // Knick > 24° = scharf
      for (let i = 0; i < M; i++) {
        let sharp = 0, nonDeg = 0;
        for (let r = 0; r < m; r++) {
          const P = G[r], a = P[(i - 1 + M) % M], b = P[i], c = P[(i + 1) % M];
          const u = sub(b, a), v = sub(c, b), lu = len(u), lv = len(v);
          if (lu < 1e-6 || lv < 1e-6) continue;   // entartet (kollabiert): nicht werten
          nonDeg++;
          if (dot(u, v) / (lu * lv) < TH) sharp++;
        }
        CORNER[i] = nonDeg > 0 && (nonDeg - sharp) <= Math.max(1, Math.floor(0.05 * nonDeg));
      }
    }
    /* Katmull-Rom-Bézier-Innenkontrollen je Segment i->i+1 (spaltenweise über die v-Kontrollpunkte).
     * Die TangentenLÄNGE wird auf die kürzere Nachbarsehne begrenzt -> KEIN Überschwingen an schmalen
     * Features (Blutrinne, Huckel) oder ungleichen Abständen; C1 an glatten Punkten, C0/scharf an Ecken.
     * Ein Bogen wird daraus als EINE stückweise-Bézier-Fläche gebaut (interne C1-Übergänge unsichtbar). */
    const Q1 = [], Q2 = [];
    for (let i = 0; i < M; i++) {
      const j = (i + 1) % M, h = (i - 1 + M) % M, j2 = (i + 2) % M;
      Q1.push(chainCo[i].map((Pi, cv) => {
        const Ph = chainCo[h][cv], Pj = chainCo[j][cv];
        let dir, mag;
        if (CORNER[i]) { dir = sub(Pj, Pi); mag = len(dir); }
        else { dir = sub(Pj, Ph); mag = Math.min(len(sub(Pi, Ph)), len(sub(Pj, Pi))); }
        const L = len(dir) || 1, s = mag / (3 * L);
        return [Pi[0] + dir[0] * s, Pi[1] + dir[1] * s, Pi[2] + dir[2] * s];
      }));
      Q2.push(chainCo[j].map((Pj, cv) => {
        const Pi = chainCo[i][cv], Pj2 = chainCo[j2][cv];
        let dir, mag;
        if (CORNER[j]) { dir = sub(Pj, Pi); mag = len(dir); }
        else { dir = sub(Pj2, Pi); mag = Math.min(len(sub(Pj, Pi)), len(sub(Pj2, Pj))); }
        const L = len(dir) || 1, s = mag / (3 * L);
        return [Pj[0] - dir[0] * s, Pj[1] - dir[1] * s, Pj[2] - dir[2] * s];
      }));
    }
    // Split-Indizes -> Bögen. Bei < 2 Ecken erzwungene Teilung (glatte Schleife), damit keine
    // Selbstnaht entsteht; ansonsten je Bogen genau ein Abschnitt zwischen zwei Ecken.
    let S = []; for (let i = 0; i < M; i++) if (CORNER[i]) S.push(i);
    /* Loch-induzierte Teilungen: je Passbohrung werden die beiden Punkte, die das Loch (in x, mit
     * Rand) flankieren, zu Ecken. Das Segment unter dem Loch wird dadurch ein eigener Bogen mit
     * einseitigen (ebenen) Tangenten -> exakt ebene Fläche, Kreis liegt exakt auf ihr — unabhängig
     * davon, ob daneben Blutrinne/Huckel liegen. Gilt für Ober- UND Unterseite des Flansches
     * (beide haben Punkte im x-Fenster; je zusammenhängender Indexlauf ein Paar Splits). */
    if (opt && opt.holes && opt.holes.list && opt.holes.list.length) {
      const rr = opt.holes.r, mgn = Math.max(1, rr * 0.35);
      // Löcher mit gleicher x-Lage (z. B. 3 Bohrungen vorn über die Spannweite) teilen sich EIN Paar
      // Splits: Fenster-Indizes als Vereinigung über ALLE Ringe -> gleiche Flanken für alle -> keine
      // sich gegenseitig zerschneidenden Mini-Bögen.
      const groups = new Map();
      for (const H of opt.holes.list) { const k = Math.round(H.x * 1000); if (!groups.has(k)) groups.set(k, { x: H.x, zs: [] }); groups.get(k).zs.push(H.z); }
      for (const grp of groups.values()) {
        const inWinAny = i => { for (let j = 0; j < m; j++) { const x = rings[j].pts[i].x; if (x >= grp.x - rr - mgn && x <= grp.x + rr + mgn) return true; } return false; };
        const W = new Array(M); for (let i = 0; i < M; i++) W[i] = inWinAny(i);
        let start = -1; for (let i = 0; i < M; i++) if (!W[i]) { start = i; break; }
        if (start < 0) continue;
        // Ringe nahe der Loch-z: dort muss der Lauf eben sein (nur Flansch, NICHT Kavität teilen)
        const jms = grp.zs.map(z => { let jm = 0; for (let j = 0; j < m; j++) if (Math.abs(rings[j].z - z) < Math.abs(rings[jm].z - z)) jm = j; return jm; });
        /* Ebenes Plateau um das Loch: vom Fenster-Lauf (bzw. vom überspannenden Segment) aus nach
         * beiden Seiten alle Punkte gleicher Höhe (auf den Loch-Ringen) dazunehmen und die
         * Plateau-ENDEN zu Ecken machen. Der Bogen unter dem Loch bekommt so einseitige Tangenten
         * (Ecke) und ist exakt eben — unabhängig von Nachbarn (Fillet, Blutrinne, Huckel). */
        // eben = gleiche Höhe wie Punkt a auf JEDEM Loch-Ring (je Ring eigene Referenz -> eine leichte
        // Neigung der Trennfläche entlang der Spannweite (µm) stört nicht)
        const flatAt = (k, a) => jms.every(jm => Math.abs(rings[jm].pts[k].y - rings[jm].pts[a].y) <= 0.02);
        const plateau = (a, b) => {
          for (let t = a; ; t = (t + 1) % M) { if (!flatAt(t, a)) return null; if (t === b) break; }
          let L = a, Rr = b, st = 0;
          while (st < M && flatAt((L - 1 + M) % M, a)) { L = (L - 1 + M) % M; st++; }
          st = 0; while (st < M && flatAt((Rr + 1) % M, a)) { Rr = (Rr + 1) % M; st++; }
          return [L, Rr];
        };
        let i = start, seen = 0;
        while (seen < M) {
          i = (i + 1) % M; seen++;
          if (!W[i]) continue;
          const a = i; while (W[(i + 1) % M] && seen < M) { i = (i + 1) % M; seen++; }
          const pl = plateau(a, i);
          if (pl) { S.push(pl[0]); S.push(pl[1]); }
        }
        // Segment (i -> i+1) OHNE Zwischenpunkte, das das Fenster komplett überspannt (z. B. Trennfläche
        // zwischen Endleiste und Formenrand): ebenfalls Plateau bilden.
        for (let i = 0; i < M; i++) {
          const j = (i + 1) % M;
          if (W[i] || W[j]) continue;
          let ok = true;
          for (const jm of jms) {
            const A = rings[jm].pts[i], B = rings[jm].pts[j], lo = Math.min(A.x, B.x), hi = Math.max(A.x, B.x);
            if (!(lo + mgn <= grp.x - rr && grp.x + rr <= hi - mgn) || Math.abs(A.y - B.y) > 0.01) { ok = false; break; }
          }
          if (!ok) continue;
          const pl = plateau(i, j);
          if (pl) { S.push(pl[0]); S.push(pl[1]); }
        }
      }
    }
    // Mindestens 2 Teilungen, damit jeder Bogen ein offenes Rechteck ist (keine Selbstnaht, die OCC
    // nicht zu einem Solid vernäht). Bei genau EINER Ecke (scharfe Endleiste) an der gegenüberliegenden
    // Seite (Nase) teilen — dort bleibt eine feine C0-Kante; mit Endleistendicke > 0 (stumpfe Endleiste
    // = zwei Ecken) entfällt sie und das ganze Profil wird EINE glatte Fläche.
    if (S.length === 0) S = [0, Math.round(M / 4), Math.round(M / 2), Math.round(3 * M / 4)];
    else if (S.length === 1) S.push((S[0] + Math.round(M / 2)) % M);
    S = Array.from(new Set(S)).sort((a, b) => a - b);
    const arcs = [];
    for (let k = 0; k < S.length; k++) {
      const a = S[k], b = S[(k + 1) % S.length], idx = [a]; let i = a;
      while (i !== b) { i = (i + 1) % M; idx.push(i); }
      arcs.push(idx);   // [a, ..., b] inklusive beider Ecken
    }

    // Randvertices nur an Split-Indizes (verschweißt: koinzidente Ecken teilen sich einen Vertex)
    const vm0 = new Map(), vm1 = new Map(), vtx0 = {}, vtx1 = {};
    for (const s of S) {
      const p0 = chainCo[s][0], p1 = chainCo[s][mv - 1], k0 = key(p0), k1 = key(p1);
      if (!vm0.has(k0)) vm0.set(k0, w.add('VERTEX_POINT(\'\',' + w.pt(p0) + ')')); vtx0[s] = vm0.get(k0);
      if (!vm1.has(k1)) vm1.set(k1, w.add('VERTEX_POINT(\'\',' + w.pt(p1) + ')')); vtx1[s] = vm1.get(k1);
    }
    // Eckspannkurven (geteilte u-Ränder zwischen Nachbarbögen): v-Kurve durch chainCo[s]; null wenn entartet
    const cornerSpan = {};
    for (const s of S) {
      const co = chainCo[s];
      let degen = true; for (let r = 1; r < mv; r++) if (!coincident(co[0], co[r])) { degen = false; break; }
      cornerSpan[s] = degen ? null : w.add('EDGE_CURVE(\'\',' + vtx0[s] + ',' + vtx1[s] + ',' +
        w.add("B_SPLINE_CURVE_WITH_KNOTS(''," + p + ',(' + co2refs(co).join(',') + '),.UNSPECIFIED.,.F.,.F.,' + vmult + ',' + vknot + ',.UNSPECIFIED.)') + ',.T.)');
    }
    // Kontrollnetz eines Bogens als stückweise Bézier (Grad 3) aus den Katmull-Rom-Kontrollen:
    // u-Spalten [P0, Q1_0, Q2_0, P1, Q1_1, Q2_1, ..., P_{n-1}]; Knoten je Segment (Vielfachheit 3),
    // geometrisch C1 (überschwingfrei). ctrl[nu][nv].
    function interpU(idx) {
      const n = idx.length, ctrl = [chainCo[idx[0]]];
      for (let k = 0; k < n - 1; k++) { ctrl.push(Q1[idx[k]]); ctrl.push(Q2[idx[k]]); ctrl.push(chainCo[idx[k + 1]]); }
      const mult = [4]; for (let k = 1; k < n - 1; k++) mult.push(3); mult.push(4);
      const knots = []; for (let k = 0; k < n; k++) knots.push(k);
      return { pu: 3, uknots: realList(knots), umult: intList(mult), ctrl };
    }
    // u-Randkurve (Wurzel/Spitze) durch Kontrollpunkte cps; null wenn entartet
    const uEdge = (cps, va, vb, U) => {
      let degen = true; for (let k = 1; k < cps.length; k++) if (!coincident(cps[0], cps[k])) { degen = false; break; }
      if (degen) return null;
      const crv = w.add("B_SPLINE_CURVE_WITH_KNOTS(''," + U.pu + ',(' + cps.map(c => w.pt(c)).join(',') + '),.UNSPECIFIED.,.F.,.F.,' + U.umult + ',' + U.uknots + ',.UNSPECIFIED.)');
      return w.add('EDGE_CURVE(\'\',' + va + ',' + vb + ',' + crv + ',.T.)');
    };
    // gerade Kante (LINE) für Zylinder-Nahtkanten der Passbohrungen; null bei Null-Länge
    const mkLine = (va, vb, Pa, Pb) => {
      if (coincident(Pa, Pb) || va === vb) return null;
      const vec = w.add('VECTOR(\'\',' + w.dir(sub(Pb, Pa)) + ',1.)');
      const line = w.add('LINE(\'\',' + w.pt(Pa) + ',' + vec + ')');
      return w.add('EDGE_CURVE(\'\',' + va + ',' + vb + ',' + line + ',.T.)');
    };

    const faces = [], orient = flip ? '.F.' : '.T.';

    /* Passbohrungen: senkrechte Zylinder (Achse y) durch je zwei flache, horizontale Flanschbögen.
     * Kreis als Innenrand (FACE_BOUND) auf beiden Bögen + zwei Halbzylinder-Wände. */
    const arcInner = {};   // Bogen-Index -> [innerBound-Refs]
    const cyl = (opt && opt.holes && opt.holes.list && opt.holes.list.length) ? processHoles() : [];
    function processHoles() {
      const rr = opt.holes.r, mgn = Math.max(1, rr * 0.35), out = [];
      const bandFor = cz => { let ja = -1, jb = -1; for (let j = 0; j < m; j++) if (rings[j].z <= cz - rr - mgn) ja = j; for (let j = m - 1; j >= 0; j--) if (rings[j].z >= cz + rr + mgn) jb = j; return [ja, jb]; };
      for (const H of opt.holes.list) {
        const cx = H.x, cz = H.z, band = bandFor(cz), ja = band[0], jb = band[1];
        if (ja < 0 || jb < 0 || jb <= ja) continue;
        if (rings.slice(ja, jb + 1).some(r2 => r2.pts.some(pp => pp.z != null))) continue;   // geneigtes Band -> auslassen
        /* Passende Bögen: der Bogen muss das Loch in x überdecken, und im FENSTER um das Loch
         * (Loch + 2·Rand) müssen alle Bogenpunkte auf einer Höhe liegen (ebener Flansch), damit
         * der Kreis exakt auf der Fläche liegt. Der Rest des Bogens (z. B. Blutrinne/Huckel) darf
         * uneben sein. */
        const fit = [], why = [];   // { ai, cy }; why: Diagnose je Bogen
        arcs.forEach((idx, ai) => {
          let ok = true, cy = null, reason = 'ok';
          const ys = [];   // Höhen aller relevanten Punkte über das Band -> Mittel = Kreishöhe
          for (let j = ja; j <= jb && ok; j++) {
            const P = rings[j].pts;
            // Überdeckung: das Loch (mit Rand) muss innerhalb des Bogens liegen
            let lo = Infinity, hi = -Infinity;
            for (const s of idx) { lo = Math.min(lo, P[s].x); hi = Math.max(hi, P[s].x); }
            if (!(lo + mgn <= cx - rr && cx + rr <= hi - mgn)) { ok = false; reason = 'cover ' + lo.toFixed(1) + '..' + hi.toFixed(1); break; }
            // Punkte, die das Loch berühren, plus bis zu 2 Nachbarn je Seite (am Bogenrand = Ecke
            // mit einseitiger Tangente -> dort reicht der Rand selbst)
            let k0 = -1, k1 = -1;
            for (let k = 0; k < idx.length; k++) { const x = P[idx[k]].x; if (x >= cx - rr - mgn && x <= cx + rr + mgn) { if (k0 < 0) k0 = k; k1 = k; } }
            if (k0 < 0) { k0 = 0; k1 = idx.length - 1; }   // kein Punkt im Lochbereich: ganzes (kurzes) Segment prüfen
            k0 = Math.max(0, k0 - 2); k1 = Math.min(idx.length - 1, k1 + 2);
            for (let k = k0; k <= k1; k++) ys.push(P[idx[k]].y);
          }
          if (ok && ys.length) {
            cy = ys.reduce((s, y) => s + y, 0) / ys.length;
            let mx = 0; for (const y of ys) mx = Math.max(mx, Math.abs(y - cy));
            // Kreis liegt auf Mittelhöhe; Fläche darf um <= 0,02 mm davon abweichen (Toleranz der Datei)
            if (mx > 0.02) { ok = false; reason = 'flat dy' + (mx * 1000).toFixed(1) + 'um (n=' + idx.length + ')'; }
          } else if (ok) { ok = false; reason = 'empty'; }
          why.push(ai + ':' + reason);
          if (ok) fit.push({ ai, cy });
        });
        if (opt.debug) opt.debug.push({ x: cx, z: cz, ja, jb, fit: fit.map(f => [f.ai, +f.cy.toFixed(2)]), arcs: arcs.map(a => a.length), why });
        if (fit.length !== 2) continue;
        const circ = cy => {
          const ax = w.add('AXIS2_PLACEMENT_3D(\'\',' + w.pt([cx, cy, cz]) + ',' + w.dir([0, 1, 0]) + ',' + w.dir([1, 0, 0]) + ')');
          const c = w.add('CIRCLE(\'\',' + ax + ',' + R(rr) + ')');
          const v0 = w.add('VERTEX_POINT(\'\',' + w.pt([cx + rr, cy, cz]) + ')'), v1 = w.add('VERTEX_POINT(\'\',' + w.pt([cx - rr, cy, cz]) + ')');
          const eA = w.add('EDGE_CURVE(\'\',' + v0 + ',' + v1 + ',' + c + ',.T.)');
          const eB = w.add('EDGE_CURVE(\'\',' + v1 + ',' + v0 + ',' + c + ',.T.)');
          return { v0, v1, eA, eB, cy };
        };
        const A = circ(fit[0].cy), Bc = circ(fit[1].cy);
        const innerLoop = C => { const l = w.add('EDGE_LOOP(\'\',(' + w.add('ORIENTED_EDGE(\'\',*,*,' + C.eA + ',.T.)') + ',' + w.add('ORIENTED_EDGE(\'\',*,*,' + C.eB + ',.T.)') + '))'); return w.add('FACE_BOUND(\'\',' + l + ',.F.)'); };
        (arcInner[fit[0].ai] = arcInner[fit[0].ai] || []).push(innerLoop(A));
        (arcInner[fit[1].ai] = arcInner[fit[1].ai] || []).push(innerLoop(Bc));
        const seam0 = mkLine(A.v0, Bc.v0, [cx + rr, A.cy, cz], [cx + rr, Bc.cy, cz]);
        const seam1 = mkLine(A.v1, Bc.v1, [cx - rr, A.cy, cz], [cx - rr, Bc.cy, cz]);
        const axc = w.add('AXIS2_PLACEMENT_3D(\'\',' + w.pt([cx, A.cy, cz]) + ',' + w.dir([0, 1, 0]) + ',' + w.dir([1, 0, 0]) + ')');
        const cs = w.add('CYLINDRICAL_SURFACE(\'\',' + axc + ',' + R(rr) + ')');
        const halfFace = oe => { const l = w.add('EDGE_LOOP(\'\',(' + oe.join(',') + '))'); const b = w.add('FACE_OUTER_BOUND(\'\',' + l + ',.T.)'); return w.add('ADVANCED_FACE(\'\',(' + b + '),' + cs + ',' + (flip ? '.T.' : '.F.') + ')'); };
        out.push(halfFace([w.add('ORIENTED_EDGE(\'\',*,*,' + A.eA + ',.T.)'), w.add('ORIENTED_EDGE(\'\',*,*,' + seam1 + ',.T.)'), w.add('ORIENTED_EDGE(\'\',*,*,' + Bc.eA + ',.F.)'), w.add('ORIENTED_EDGE(\'\',*,*,' + seam0 + ',.F.)')]));
        out.push(halfFace([w.add('ORIENTED_EDGE(\'\',*,*,' + A.eB + ',.T.)'), w.add('ORIENTED_EDGE(\'\',*,*,' + seam0 + ',.T.)'), w.add('ORIENTED_EDGE(\'\',*,*,' + Bc.eB + ',.F.)'), w.add('ORIENTED_EDGE(\'\',*,*,' + seam1 + ',.F.)')]));
      }
      return out;
    }

    // Bogen-Flächen (glatt, kubisch in beiden Richtungen); Wurzel-/Spitzenkurven für die Deckel merken.
    const rootE = [], tipE = [];
    arcs.forEach((idx, ai) => {
      const a = idx[0], b = idx[idx.length - 1], U = interpU(idx);
      const rc = uEdge(U.ctrl.map(c => c[0]), vtx0[a], vtx0[b], U);
      const tc = uEdge(U.ctrl.map(c => c[mv - 1]), vtx1[a], vtx1[b], U);
      rootE.push(rc); tipE.push(tc);
      const parts = [[rc, '.T.'], [cornerSpan[b], '.T.'], [tc, '.F.'], [cornerSpan[a], '.F.']].filter(e => e[0]);
      if (parts.length < 3) return;
      const net = U.ctrl.map(col => '(' + co2refs(col).join(',') + ')').join(',');
      const surf = w.add("B_SPLINE_SURFACE_WITH_KNOTS(''," + U.pu + ',' + p + ',(' + net + '),.UNSPECIFIED.,.F.,.F.,.F.,' + U.umult + ',' + vmult + ',' + U.uknots + ',' + vknot + ',.UNSPECIFIED.)');
      const oe = parts.map(e => w.add('ORIENTED_EDGE(\'\',*,*,' + e[0] + ',' + e[1] + ')'));
      const loop = w.add('EDGE_LOOP(\'\',(' + oe.join(',') + '))');
      const bound = w.add('FACE_OUTER_BOUND(\'\',' + loop + ',.T.)');
      const bounds = arcInner[ai] ? [bound].concat(arcInner[ai]) : [bound];
      faces.push(w.add('ADVANCED_FACE(\'\',(' + bounds.join(',') + '),' + surf + ',' + orient + ')'));
    });
    for (const f of cyl) faces.push(f);
    // Deckel: Rand = die Wurzel-/Spitzen-Bogenkurven (Null-Kanten auslassen)
    const cap0 = capArc(w, chainCo.map(c => c[0]), rootE, true, flip); if (cap0) faces.push(cap0);
    const cap1 = capArc(w, chainCo.map(c => c[mv - 1]), tipE, false, flip); if (cap1) faces.push(cap1);
    return { faces };
  }

  // Planarer Deckel, berandet von den Bogen-Randkurven (edges in Reihenfolge um den Querschnitt).
  function capArc(w, ring3, edges, atRoot, flip) {
    const M = ring3.length, c = [0, 0, 0];
    for (const P of ring3) { c[0] += P[0]; c[1] += P[1]; c[2] += P[2]; }
    c[0] /= M; c[1] /= M; c[2] /= M;
    let nn = [0, 0, 0];
    for (let i = 0; i < M; i++) { const a = ring3[i], b = ring3[(i + 1) % M]; nn[0] += (a[1] - b[1]) * (a[2] + b[2]); nn[1] += (a[2] - b[2]) * (a[0] + b[0]); nn[2] += (a[0] - b[0]) * (a[1] + b[1]); }
    nn = norm(nn);
    let ref = sub(ring3[0], c); const proj = dot(ref, nn); ref = norm([ref[0] - nn[0] * proj, ref[1] - nn[1] * proj, ref[2] - nn[2] * proj]);
    if (len(ref) < 1e-6) ref = Math.abs(nn[0]) < 0.9 ? norm(cross(nn, [1, 0, 0])) : norm(cross(nn, [0, 1, 0]));
    const axis = w.add('AXIS2_PLACEMENT_3D(\'\',' + w.pt(c) + ',' + w.dir(nn) + ',' + w.dir(ref) + ')');
    const plane = w.add('PLANE(\'\',' + axis + ')');
    const list = edges.filter(e => e);
    if (list.length < 2) return null;
    const oe = [];
    if (atRoot) for (let i = list.length - 1; i >= 0; i--) oe.push(w.add('ORIENTED_EDGE(\'\',*,*,' + list[i] + ',.F.)'));
    else for (let i = 0; i < list.length; i++) oe.push(w.add('ORIENTED_EDGE(\'\',*,*,' + list[i] + ',.T.)'));
    const loop = w.add('EDGE_LOOP(\'\',(' + oe.join(',') + '))');
    const bound = w.add('FACE_OUTER_BOUND(\'\',' + loop + ',.T.)');
    return w.add('ADVANCED_FACE(\'\',(' + bound + '),' + plane + ',' + (flip ? '.F.' : '.T.') + ')');
  }

  // Kontext/Produkt/Header um fertige Schalen bauen -> komplette STEP-Datei.
  function assemble(w, shells, opt) {
    const name = (opt && opt.name) || 'foamcut';
    const lenUnit = w.add('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))');
    const angUnit = w.add('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))');
    const solUnit = w.add('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())');
    const unc = w.add('UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(2.E-02),' + lenUnit + ",'distance_accuracy_value','edge/vertex')");
    const ctx = w.add('(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((' + unc + '))GLOBAL_UNIT_ASSIGNED_CONTEXT((' + lenUnit + ',' + angUnit + ',' + solUnit + "))REPRESENTATION_CONTEXT('',''))");
    const placement = w.add('AXIS2_PLACEMENT_3D(\'\',' + w.pt([0, 0, 0]) + ',' + w.dir([0, 0, 1]) + ',' + w.dir([1, 0, 0]) + ')');
    let brepRep;
    if (opt && opt.open) {   // Diagnose: offene Schale als Surface-Model (kein Solid)
      const models = shells.map(sh => { const os = w.add('OPEN_SHELL(\'\',(' + sh.faces.join(',') + '))'); return w.add('SHELL_BASED_SURFACE_MODEL(\'\',(' + os + '))'); });
      brepRep = w.add("MANIFOLD_SURFACE_SHAPE_REPRESENTATION('" + name + "',(" + [placement].concat(models).join(',') + '),' + ctx + ')');
    } else {
      const solids = shells.map(sh => { const cs = w.add('CLOSED_SHELL(\'\',(' + sh.faces.join(',') + '))'); return w.add("MANIFOLD_SOLID_BREP('" + name + "'," + cs + ')'); });
      brepRep = w.add("ADVANCED_BREP_SHAPE_REPRESENTATION('" + name + "',(" + [placement].concat(solids).join(',') + '),' + ctx + ')');
    }
    const appCtx = w.add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
    w.add("APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2010," + appCtx + ')');
    const pc = w.add("PRODUCT_CONTEXT(''," + appCtx + ",'mechanical')");
    const prod = w.add("PRODUCT('" + name + "','" + name + "','',(" + pc + '))');
    w.add("PRODUCT_RELATED_PRODUCT_CATEGORY('part','',(" + prod + '))');
    const pdf = w.add("PRODUCT_DEFINITION_FORMATION('','1'," + prod + ')');
    const pdCtx = w.add("PRODUCT_DEFINITION_CONTEXT('part definition'," + appCtx + ",'design')");
    const pd = w.add("PRODUCT_DEFINITION('design',''," + pdf + ',' + pdCtx + ')');
    const pds = w.add("PRODUCT_DEFINITION_SHAPE('',''," + pd + ')');
    w.add('SHAPE_DEFINITION_REPRESENTATION(' + pds + ',' + brepRep + ')');
    const now = new Date().toISOString();
    const header =
      'ISO-10303-21;\n' +
      'HEADER;\n' +
      "FILE_DESCRIPTION((''),'2;1');\n" +
      "FILE_NAME('" + name + "','" + now + "',(''),(''),'AI Foam Cut STEP','AI Foam Cut','');\n" +
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\n" +
      'ENDSEC;\n';
    return header + 'DATA;\n' + w.lines.join('\n') + '\nENDSEC;\nEND-ISO-10303-21;\n';
  }

  /* Vorzeichenbehaftetes Volumen der geschlossenen Schale (Divergenzsatz) in DERSELBEN
   * Flächenorientierung wie der STEP-Körper (flip=false): Hautstreifen wie im Loft, Deckel
   * als Fächer (Wurzel rückwärts, Spitze vorwärts). <0 => Schale zeigt nach innen -> flip. */
  function signedVolume(rings) {
    const m = rings.length, M = rings[0].pts.length;
    const G = rings.map(r => r.pts.map(p => [p.x, p.y, (p.z == null ? r.z : p.z)]));
    const tv = (a, b, c) => a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    let V = 0;
    for (let r = 0; r < m - 1; r++) for (let i = 0; i < M; i++) {
      const j = (i + 1) % M, a0 = G[r][i], a1 = G[r][j], b0 = G[r + 1][i], b1 = G[r + 1][j];
      V += tv(a0, a1, b1) + tv(a0, b1, b0);
    }
    const cen = ring => { const c = [0, 0, 0]; for (const P of ring) { c[0] += P[0]; c[1] += P[1]; c[2] += P[2]; } return [c[0] / M, c[1] / M, c[2] / M]; };
    const c0 = cen(G[0]), c1 = cen(G[m - 1]);
    for (let i = 0; i < M; i++) { const j = (i + 1) % M; V += tv(c0, G[0][j], G[0][i]); V += tv(c1, G[m - 1][i], G[m - 1][j]); }
    return V / 6;
  }

  /* Entartete/doppelte SPALTEN (Umfangs-Indizes) entfernen: fallen zwei aufeinanderfolgende
   * Profilpunkte über ALLE Ringe (nahezu) zusammen — z. B. Punkt 0 und der letzte Punkt bei
   * scharfer Endleiste (Dicke 0) -> Null-Breiten-Streifen — wird die Spalte zusammengelegt.
   * Nur global entartete Spalten werden entfernt (nicht solche, die sich irgendwo öffnen). */
  function dedupColumns(rings, eps) {
    const m = rings.length, M = rings[0].pts.length;
    const zof = (r, i) => (r.pts[i].z == null ? r.z : r.pts[i].z);
    const close = (i, j) => { for (let r = 0; r < m; r++) { const a = rings[r]; if (Math.hypot(a.pts[i].x - a.pts[j].x, a.pts[i].y - a.pts[j].y, zof(a, i) - zof(a, j)) > eps) return false; } return true; };
    const keep = [0];
    for (let i = 1; i < M; i++) if (!close(i, keep[keep.length - 1])) keep.push(i);
    while (keep.length > 3 && close(keep[keep.length - 1], keep[0])) keep.pop();
    if (keep.length === M) return rings;
    return rings.map(r => ({ pts: keep.map(i => r.pts[i]), z: r.z }));
  }

  /* Ring-Verteilung entlang z vergleichmäßigen: sehr ungleiche Abstände (z. B. dichte Ringe an der
   * Randbogen-Spitze und dann ein großer Sprung zum Spitzenpunkt) lassen die glatte v-Interpolation
   * ÜBERSCHWINGEN (Falte/Zipfel). Ist das Verhältnis größter/typischer Abstand groß, wird der Stapel
   * auf gleichmäßigen z-Abstand (≈ Median) neu abgetastet (Querschnitte linear zwischen Originalringen
   * interpoliert -> Profil bleibt, nur die Stationen liegen gleichmäßig). Sonst unverändert. */
  function resampleZ(rings) {
    const n = rings.length;
    if (n < 4) return rings;
    for (let i = 1; i < n; i++) if (rings[i].z < rings[i - 1].z - 1e-9) return rings;   // nicht monoton -> nicht anfassen
    const lerp = (A, B, t) => ({ z: A.z + (B.z - A.z) * t, pts: A.pts.map((p, i) => { const q = B.pts[i]; return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: (p.z == null || q.z == null) ? p.z : p.z + (q.z - p.z) * t }; }) });
    // 1) Echte Duplikate entfernen: z nah (< 0,3 mm) UND Geometrie (alle Punkte) nahezu gleich. Ein Ring,
    //    der 0,2 mm hinter dem vorigen liegt, aber eine andere Form hat (z. B. der Ring, an dem die Kavität
    //    am Randbogen zusammenfällt), MUSS bleiben — sonst wird der Kavitätsschluss über die ganze
    //    Restlänge verschmiert (war ~2 mm Profilabweichung).
    const sameGeom = (A, B) => { for (let k = 0; k < A.pts.length; k++) { const a = A.pts[k], b = B.pts[k]; if (Math.hypot(a.x - b.x, a.y - b.y, (a.z == null ? 0 : a.z) - (b.z == null ? 0 : b.z)) > 0.05) return false; } return true; };
    const R = [rings[0]];
    for (let i = 1; i < n - 1; i++) { const L = R[R.length - 1]; if (rings[i].z - L.z >= 0.3 || !sameGeom(L, rings[i])) R.push(rings[i]); }
    R.push(rings[n - 1]);
    // 2) Große Lücken auffüllen (linear interpoliert), bis keine Lücke mehr als das 2-Fache der kleineren
    //    Nachbarlücke ist (Untergrenze: ein Viertel des Median-Abstands, damit ein einzelner sehr enger
    //    Ring nicht Hunderte Zwischenringe erzwingt). ORIGINALRINGE BLEIBEN ERHALTEN.
    const gaps0 = []; for (let i = 1; i < R.length; i++) gaps0.push(R[i].z - R[i - 1].z);
    const gs = gaps0.slice().sort((a, b) => a - b), medGap = gs.length ? gs[gs.length >> 1] : 1;
    const gap = i => R[i].z - R[i - 1].z;   // Lücke vor Ring i
    const out = [R[0]];
    for (let i = 1; i < R.length; i++) {
      const g = gap(i), gl = i >= 2 ? gap(i - 1) : g, gr = i + 1 < R.length ? gap(i + 1) : g;
      const ref = Math.max(0.25 * medGap, Math.min(gl, gr, g));
      if (g > 2 * ref) {
        const nIns = Math.min(200, Math.ceil(g / (2 * ref)) - 1);
        for (let k = 1; k <= nIns; k++) out.push(lerp(R[i - 1], R[i], k / (nIns + 1)));
      }
      out.push(R[i]);
    }
    return out;
  }

  // Öffentliche API: Ringe -> STEP-String eines geschlossenen Solids.
  function ringsToStep(rings, opt) {
    opt = opt || {};
    if (!rings || rings.length < 2) throw new Error('mindestens 2 Ringe nötig');
    const M0 = rings[0].pts.length;
    for (const r of rings) if (r.pts.length !== M0) throw new Error('alle Ringe brauchen dieselbe Punktzahl');
    rings = resampleZ(rings);
    rings = refineRings(rings, 0.05);   // glatter Loft überall < ~0,05 mm vom linearen Loft (Heißdraht/STL)
    rings = refineU(rings, 0.05);       // dito im Querschnitt (glatte Kurve vs. Profil-Polylinie)
    rings = dedupColumns(rings, 1e-4);
    if (rings[0].pts.length < 3) throw new Error('Querschnitt zu klein (nach Bereinigung)');
    if (opt.flip == null) opt = Object.assign({}, opt, { flip: signedVolume(rings) < 0 });   // Auto-Orientierung
    const w = new StepWriter();
    const shell = buildShell(w, rings, opt);
    return assemble(w, [shell], opt);
  }

  const CORE = { ringsToStep, _R: R, _interp: commonKnots };
  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof window !== 'undefined') { const App = (window.App = window.App || {}); App.stepExport = CORE; }
})();
