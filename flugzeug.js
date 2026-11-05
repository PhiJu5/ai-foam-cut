/* flugzeug.js — Reiter „Flugzeug gesamt" (Funktion „flugzeug"): das ganze Modell in 3D.
 *
 * Rumpf aus „Rumpf" (RumpfPro.api, Querschnitte), alle Tragflächen aus dem Formenbau-Ringstapel
 * (Urmodell ohne Aufmaß, mit Randbogen bzw. Winglet; je Tragfläche per App.withWing gerechnet).
 * Jede Tragfläche bekommt eine Rolle (Tragfläche, Höhenleitwerk, Seitenleitwerk), eine Lage am Rumpf
 * und eigene Farben; Rumpf-Decals und Tragflächen-Decals kommen als Textur aus decals.js.
 *
 * Koordinaten der Anzeige: X = Rumpflänge (nach hinten), Y = Höhe (oben), Z = seitlich (rechte Fläche +Z).
 * Flugzeug-Lokal je Tragfläche (Formenbau): x = Tiefe ab Wurzelnase, y = Dicke/Höhe, z = Spannweite.
 *
 * Ausgabe für flow5 (Plane/Import/From an STL file): je Bauteil ein geschlossener, nicht überschneidender
 * Körper (Tragflächen an der Rumpfwand gekürzt), Normalen nach außen, keine doppelten/entarteten Dreiecke,
 * strukturiertes Netz (gleich viele Dreiecke oben/unten an der Endleiste → „Guess T.E." findet Paare),
 * Kosinus-Teilung zur Nase/Endleiste. Achsen flow5: x nach hinten, y seitlich, z oben; Einheit wählbar (m).
 * Daten: state.cfg.flz (Projekt), Tragflächen-Lage je Index in flz.parts[]. Andere Module rufen geschützt.
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { state } = App;
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const RAW = s => (window.DrawTheme && typeof s === 'string') ? DrawTheme.raw(s) : s;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const DEF = { fusOn: true, fusCol: '#e8ecf0', tailCol: '#e8ecf0', canoOwn: false, canoCol: '#2e4f73', decals: true, attach: true, clip: true, gap: 1, parts: [],
    f5: { unit: 'm', nc: 20, ns: 24, fx: 60, fs: 32 } };
  const ROLES = [['wing', 'Tragfläche'], ['htail', 'Höhenleitwerk (auch V-Leitwerk)'], ['vtail', 'Seitenleitwerk'], ['off', 'nicht zeigen']];
  const PAL = ['#f2f2f2', '#e0b030', '#d04a3a', '#3c7fd0', '#4aa060'];

  function cfg() {
    let c = state.cfg.flz;
    if (!c || typeof c !== 'object') c = state.cfg.flz = JSON.parse(JSON.stringify(DEF));
    for (const k in DEF) if (c[k] === undefined) c[k] = JSON.parse(JSON.stringify(DEF[k]));
    for (const k in DEF.f5) if (c.f5[k] === undefined) c.f5[k] = DEF.f5[k];
    if (!Array.isArray(c.parts)) c.parts = [];
    return c;
  }
  const wingCount = () => (App.wingList ? App.wingList().length : (state.root ? 1 : 0));
  const wingName = i => (App.wingName ? App.wingName(i) : T('Tragfläche') + ' ' + (i + 1));
  function fusApi() { try { const a = window.RumpfPro && RumpfPro.api && RumpfPro.api(); return a && a.x1 > a.x0 ? a : null; } catch (e) { return null; } }
  function part(i) {
    const c = cfg(); let p = c.parts[i];
    if (!p || typeof p !== 'object') {
      const a = fusApi(), L = a ? a.x1 - a.x0 : 1000, x0 = a ? a.x0 : 0;
      p = { role: i === 0 ? 'wing' : i === 1 ? 'htail' : 'vtail', x: Math.round(x0 + L * (i === 0 ? 0.3 : 0.84)), y: 0, inc: 0, mirror: true, col: PAL[i % PAL.length], tipCol: PAL[(i + 1) % PAL.length] };
      const w = state.cfg.rproWing;   // Lage der Tragfläche aus „Rumpf", falls dort eingetragen
      if (i === 0 && w && w.on) { p.x = +w.xLE || p.x; p.y = +w.yLE || 0; p.inc = +w.alpha || 0; }
      c.parts[i] = p;
    }
    // Stand 2: Haupttragfläche sitzt wie im Reiter „Rumpf“; Leitwerk kommt aus „Rumpf“, sofern es dort eins gibt
    if (p.v !== 2) {
      p.v = 2;
      const a = fusApi(), m = a && a.model;
      if (p.role === 'wing' && i === (state.activeWing || 0)) p.fromFus = true;
      else if (p.role !== 'wing' && m && (m.fin || m.vt)) p.role = 'off';
    }
    return p;
  }

  // Lage einer Tragfläche: aus „Rumpf“ (Wurzelnase xLE/yLE, Einstellwinkel als Scherung wie dort, Wurzelrippe in zf,
  // Maßstab Rumpf-Tiefe/Wurzeltiefe) oder von Hand (x, y, Einstellwinkel als Drehung).
  function placeOf(i, p, chord) {
    if (p.fromFus && i === (state.activeWing || 0)) {
      const a = fusApi(), g = a && a.model && a.model.wing;
      if (g) { const sc = chord > 0 ? g.chord / chord : 1; return { x: g.xLE, y: g.yLE, z0: g.zf, sc, fus: true, map: (x, y) => [x * sc, y * sc - x * sc * g.tanA] }; }
    }
    const r = (+p.inc || 0) * Math.PI / 180, ca = Math.cos(r), sa = Math.sin(r);
    return { x: +p.x || 0, y: +p.y || 0, z0: 0, sc: 1, map: (x, y) => [x * ca + y * sa, -x * sa + y * ca] };
  }
  // Rumpf mit Anformungen, Leitwerk und Rohr genau wie im Reiter „Rumpf“ (dessen eigene Netze, glatte Normalen).
  // Decal-uv je Punkt: u = Länge, v = Bogenlänge auf dem reinen Rumpfspant (wie decals.js fus(), Index NS/2 = oben).
  function fusMeshes(c) {
    const a = fusApi(), M = a && a.model; if (!M || !M.mesh) return null;
    const L = a.x1 - a.x0, cF = hex(c.fusCol), cT = hex(c.tailCol || c.fusCol), arcC = new Map();
    const arc = x => {
      const key = Math.round(x * 20); let r = arcC.get(key); if (r) return r;
      let P = []; try { P = a.bodyHalf(clamp(x, a.x0 + L * 1e-4, a.x1 - L * 1e-4)) || []; } catch (e) {}
      const cum = [0]; for (let k = 1; k < P.length; k++) cum.push(cum[k - 1] + Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]));
      r = { P, cum, tot: cum[cum.length - 1] }; arcC.set(key, r); return r;
    };
    const vOf = (x, y, z) => {
      const A = arc(x), P = A.P; if (P.length < 2 || !(A.tot > 0)) return 0.5;
      const za = Math.abs(z); let best = Infinity, s = 0;
      for (let k = 0; k + 1 < P.length; k++) {
        const dy = P[k + 1][0] - P[k][0], dz = P[k + 1][1] - P[k][1], l2 = dy * dy + dz * dz, t = l2 > 1e-12 ? clamp(((y - P[k][0]) * dy + (za - P[k][1]) * dz) / l2, 0, 1) : 0;
        const d = Math.hypot(P[k][0] + dy * t - y, P[k][1] + dz * t - za); if (d < best) { best = d; s = A.cum[k] + (A.cum[k + 1] - A.cum[k]) * t; }
      }
      const f = s / A.tot; return z < 0 || Object.is(z, -0) ? 0.5 - 0.5 * f : 0.5 + 0.5 * f;
    };
    const conv = (ms, name, tex) => {
      const m = newMesh(name, false), n = ms.pos.length / 3; m.P = Array.from(ms.pos); m.N = ms.nrm; m.tex = tex ? 'fus' : null;
      for (let i = 0; i < n; i++) {
        const t = ms.tag[i], col = t === 1 || t === 3 ? cT : cF, x = ms.pos[3 * i];
        m.C.push(col[0], col[1], col[2]); m.U.push(tex ? (x - a.x0) / L : 0, tex ? vOf(x, ms.pos[3 * i + 1], ms.pos[3 * i + 2]) : 0);
      }
      for (let k = 0; k < ms.idx.length; k += 3) {
        const t = Math.max(ms.tag[ms.idx[k]], ms.tag[ms.idx[k + 1]], ms.tag[ms.idx[k + 2]]);
        m.I.push(ms.idx[k], ms.idx[k + 1], ms.idx[k + 2]); m.G.push(tex && (t === 0 || t === 2 || t === 4) ? 1 : 0);
      }
      return m;
    };
    const out = [conv(M.mesh, T('Rumpf'), true)];
    [[M.hlwMesh, 'Höhenleitwerk'], [M.rudMesh, 'Ruder'], [M.boomMesh, 'Leitwerksrohr']].forEach(([ms, nm]) => { if (ms && ms.pos && ms.idx) out.push(conv(ms, T(nm), false)); });
    return out;
  }
  // Höhenleitwerk aus „Rumpf“ als Ringstapel (wie dort hlwMesh), damit es im flow5-Netz wie eine Tragfläche vernetzt wird
  function hlwStack() {
    const a = fusApi(), M = a && a.model, hl = M && M.fin && M.fin.hl; if (!hl || !hl.show || !hl.pl) return null;
    let R;
    if (hl.wp) {
      const r0 = hl.wp.sec[0], fl = hl.wp.flip;
      R = hl.wp.sec.map((sc, k) => {
        const pts = sc.pts.map(q => [q.x, (q.y + sc.yRise) * fl]);
        return pts.map(q => { const dx = q[0] - r0.le; return [hl.xLE + dx, hl.y + q[1] - r0.yN - dx * hl.tanA, hl.pl[k].z]; });
      });
      if (R.some(r => r.length !== R[0].length)) return null;
    } else {
      const n = 60, us = []; for (let i = 0; i <= n; i++) us.push((1 - Math.cos(Math.PI * i / n)) / 2);
      R = hl.pl.map(q => { const r = [];
        for (let i = n; i >= 0; i--) { const u = us[i]; r.push([q.le + u * q.c, hl.y + q.c * hl.pf.up(u) - u * q.c * hl.tanA, q.z]); }
        for (let i = 1; i <= n; i++) { const u = us[i]; r.push([q.le + u * q.c, hl.y + q.c * hl.pf.lo(u) - u * q.c * hl.tanA, q.z]); }
        return r; });
    }
    // Ringe beginnen an der Endleiste (resampleRing sucht die Nase selbst); doppelte Schlusspunkte weg
    R = R.map(r => { r = r.slice(); const f = r[0], l = r[r.length - 1]; if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) r.pop();
      let iT = 0; for (let k = 1; k < r.length; k++) if (r[k][0] > r[iT][0]) iT = k; r = r.slice(iT).concat(r.slice(0, iT)); r.push(r[0].slice()); return r; });
    return { rings: R, nWing: R.length };
  }
  // Dreiecksliste (flach, 9 Werte je Dreieck) zu indiziertem, verschweißtem Netz ohne entartete/doppelte Dreiecke
  function weld(v, name) {
    const m = newMesh(name, true), map = new Map(), seen = new Set(), id = (x, y, z) => {
      const key = Math.round(x * 1e3) + ',' + Math.round(y * 1e3) + ',' + Math.round(z * 1e3); let i = map.get(key);
      if (i === undefined) { i = addV(m, [x, y, z], [1, 1, 1]); map.set(key, i); } return i;
    };
    for (let k = 0; k < v.length; k += 9) {
      const a = id(v[k], v[k + 1], v[k + 2]), b = id(v[k + 3], v[k + 4], v[k + 5]), c = id(v[k + 6], v[k + 7], v[k + 8]);
      if (a === b || b === c || a === c) continue;
      const key = [a, b, c].sort((p, q) => p - q).join(','); if (seen.has(key)) continue; seen.add(key);
      tri(m, a, b, c, 1);
    }
    orient(m); return m;
  }
  // flow5-Rumpf: aus dem Gitter des Reiters „Rumpf“ (mit Anformungen) gleichmäßig ausgedünnt, gespiegelt, verschweißt
  function fusFlow5(q) {
    const a = fusApi(), M = a && a.model, mg = window.RumpfPro && RumpfPro._test && RumpfPro._test.meshFromGrid;
    if (!M || !M.G || !mg) return null;
    const G = M.G, K = G.length, NB = G[0].length;
    // Auswahl nach Formänderung (größter Punktabstand zur Nachbarlinie), Grenzen der Anbauten (Herkunftswechsel) immer dabei —
    // gleichmäßig nach Index verschluckte die Anformung, deren Linien sich auf engem Raum drängen
    const TG = M.TG || null, d3 = (p, q2) => Math.hypot(p[0] - q2[0], p[1] - q2[1], p[2] - q2[2]);
    const pick = (n, N, step, keep) => {
      n = Math.max(2, Math.min(N, n)); const cum = [0];
      for (let k = 1; k < N; k++) cum.push(cum[k - 1] + step(k));
      const tot = cum[N - 1] || 1, set = new Set([0, N - 1]); let j = 0;
      for (let k = 1; k < n - 1; k++) { const s = tot * k / (n - 1); while (j < N - 1 && cum[j + 1] < s) j++; set.add(cum[j + 1] - s < s - cum[j] ? j + 1 : j); }
      for (let k = 1; k < N; k++) if (keep(k)) { set.add(k - 1); set.add(k); }
      return Array.from(set).sort((x, y) => x - y);
    };
    const ra = pick(q.fs / 2 + 1, K, a2 => { let m2 = 0; for (let b = 0; b < NB; b++) m2 = Math.max(m2, d3(G[a2][b], G[a2 - 1][b])); return m2; },
      a2 => !!TG && TG[a2].some((t, b) => (t === 2) !== (TG[a2 - 1][b] === 2)) && TG[a2].some(t => t === 2) !== TG[a2 - 1].some(t => t === 2));
    const rb = pick(q.fx, NB, b => { let m2 = 0; for (let a2 = 0; a2 < K; a2++) m2 = Math.max(m2, d3(G[a2][b], G[a2][b - 1])); return m2; },
      b => !!TG && TG.some(r => (r[b] === 2) !== (r[b - 1] === 2)));
    const out = [weld(mg(ra.map(i => rb.map(b => G[i][b].slice())), { mirror: true, seam: true }).v, T('Rumpf'))];
    if (M.boomMesh && M.boomMesh.v) out.push(weld(M.boomMesh.v, T('Leitwerksrohr')));
    return out;
  }

  // ---------- Geometrie ----------------------------------------------------------------------------
  // Rumpfgitter: NX Spanten (Kosinus-Teilung zu Nase/Heck), je NS Umfangspunkte (Bogenlänge, Index NS/2 = Rücken).
  // Gleiche Parametrierung wie decals.js fus() → die Decal-Textur (u = x, v = j/NS) passt.
  function fusGrid(NX, NS, full) {
    const a = fusApi(); if (!a) return null;
    const H = NS / 2, eps = (a.x1 - a.x0) * 1e-4, f = { x0: a.x0, x1: a.x1, NX, NS, xs: [], R: [] };
    for (let i = 0; i < NX; i++) {
      const t = i / (NX - 1), x = a.x0 + (a.x1 - a.x0) * (0.5 - 0.5 * Math.cos(Math.PI * t)), xe = clamp(x, a.x0 + eps, a.x1 - eps);
      let P = []; try { P = (full && a.fullHalf ? a.fullHalf(xe) : a.bodyHalf(xe)) || []; } catch (e) {}
      P = P.filter(q => isFinite(q[0]) && isFinite(q[1])).map(q => [q[0], Math.max(0, q[1])]);
      if (P.length < 2) P = [[0, 0], [0, 0]];
      const cum = [0]; for (let k = 1; k < P.length; k++) cum.push(cum[k - 1] + Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]));
      const tot = cum[cum.length - 1], R = new Float64Array(2 * (NS + 1)); let j = 0;
      for (let k = 0; k <= H; k++) {
        const s = tot * k / H; while (j < P.length - 2 && cum[j + 1] < s) j++;
        const d = cum[j + 1] - cum[j], tt = d > 1e-12 ? clamp((s - cum[j]) / d, 0, 1) : 0, y = P[j][0] + (P[j + 1][0] - P[j][0]) * tt, z = P[j][1] + (P[j + 1][1] - P[j][1]) * tt;
        R[2 * (H + k)] = y; R[2 * (H + k) + 1] = z; R[2 * (H - k)] = y; R[2 * (H - k) + 1] = -z;
      }
      f.xs.push(x); f.R.push(R);
    }
    return f;
  }
  // Rumpfhülle an der Stelle x: größte halbe Breite bzw. größte Höhe (für das Kürzen der Flächen)
  function fusExtent(f, xa, xb, kind) {
    let m = -Infinity;
    for (let i = 0; i < f.NX; i++) {
      if (f.xs[i] < Math.min(xa, xb) - 1 || f.xs[i] > Math.max(xa, xb) + 1) continue;
      const R = f.R[i]; for (let j = 0; j <= f.NS; j++) m = Math.max(m, kind === 'top' ? R[2 * j] : Math.abs(R[2 * j + 1]));
    }
    return m;
  }

  // Ringstapel einer Tragfläche aus dem Formenbau (gecacht bis zum nächsten Öffnen / „Neu aufbauen")
  let stackCache = null;
  function wingStack(i) {
    if (!stackCache) stackCache = [];
    if (stackCache[i] !== undefined) return stackCache[i];
    stackCache[i] = null;
    const F = window.Formenbau && Formenbau._test; if (!F || !F.urmodellRingStack || !F.opts) return null;
    const run = () => {
      const o = Object.assign({}, F.opts(), { mirror: false, target: 'ur', grp: null, aufmass: 0 });
      const all = F.urmodellRingStack(Object.assign({}, o, { part: 'all' })); if (!all || all.length < 2) return null;
      const w = F.urmodellRingStack(Object.assign({}, o, { part: 'wing' }));
      let rings = all.map(r => r.pts.map(p => [p.x, p.y, p.z == null ? r.z : p.z]));
      // Der Formenbau verschiebt das Profil (Blocklage); „Rumpf“ setzt die Wurzelrippe des Tragflächendesigns ein
      // (y·flipY). Ringe deshalb auf die Wurzelstation ausrichten: Nase/Endleiste deckungsgleich, ggf. gespiegelt.
      const s0 = App.wing && App.wing.stations && App.wing.stations[0];
      if (s0 && s0.pts && s0.pts.length > 2) {
        const fl = state.cfg && state.cfg.flipY ? -1 : 1, sp = s0.pts.map(p => [p.x, (p.y + (s0.yRise || 0)) * fl]);
        const ext = (P, f) => { let b = P[0]; for (const p of P) if (f(p) > f(b)) b = p; return b; };
        const r0 = rings[0], sLE = ext(sp, p => -p[0]), sTE = ext(sp, p => p[0]), sHi = ext(sp, p => p[1])[1] - sTE[1];
        const rLE = ext(r0, p => -p[0]), rTE = ext(r0, p => p[0]), rHi = ext(r0, p => p[1])[1] - rTE[1], rLo = ext(r0, p => -p[1])[1] - rTE[1];
        const fy = Math.abs(-rLo - sHi) < Math.abs(rHi - sHi) ? -1 : 1;   // Ring spiegelverkehrt zur Station?
        const dx = sLE[0] - rLE[0], dy = sTE[1] - fy * rTE[1];
        rings = rings.map(R => R.map(p => [p[0] + dx, fy * p[1] + dy, p[2]]));
      }
      return { rings, nWing: w ? Math.min(all.length, w.length) : all.length };
    };
    try { stackCache[i] = App.withWing ? App.withWing(i, run) : run(); } catch (e) { console.error('Flugzeug gesamt: Tragfläche', i, e); }
    return stackCache[i];
  }

  // Ring in Tiefenrichtung neu teilen: Endleiste oben -> Nase -> Endleiste unten, je Seite nc Abschnitte (Kosinus).
  // Rückgabe: geschlossener Ring ohne doppelten Endleistenpunkt (bei spitzer Endleiste 2·nc Punkte, sonst 2·nc + 1).
  function resampleRing(P, nc) {
    let iLE = 0; for (let k = 1; k < P.length; k++) if (P[k][0] < P[iLE][0]) iLE = k;
    const branch = (a, b) => {
      const Q = []; for (let k = a; a <= b ? k <= b : k >= b; k += a <= b ? 1 : -1) Q.push(P[k]);
      const cum = [0]; for (let k = 1; k < Q.length; k++) cum.push(cum[k - 1] + Math.hypot(Q[k][0] - Q[k - 1][0], Q[k][1] - Q[k - 1][1], Q[k][2] - Q[k - 1][2]));
      const L = cum[cum.length - 1], out = []; let j = 0;
      for (let k = 0; k <= nc; k++) {
        const s = L * (0.5 - 0.5 * Math.cos(Math.PI * k / nc)); while (j < Q.length - 2 && cum[j + 1] < s) j++;
        const d = cum[j + 1] - cum[j], t = d > 1e-12 ? clamp((s - cum[j]) / d, 0, 1) : 0;
        out.push([0, 1, 2].map(c => Q[j][c] + (Q[j + 1][c] - Q[j][c]) * t));
      }
      return out;
    };
    const A = branch(0, iLE), B = branch(iLE, P.length - 1);
    const R = A.concat(B.slice(1)), f = R[0], l = R[R.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1], f[2] - l[2]) < 1e-3) R.pop();
    return R;
  }

  // Tragfläche im eigenen Rahmen: Stationen (gleich viele Punkte), gekürzt ab Spannweite zc, Randbogen ab Station tip.
  function wingSurface(st, nc, ns, zc) {
    const rings = st.rings.map(r => resampleRing(r, nc));
    const M = Math.min.apply(null, rings.map(r => r.length));
    if (rings.some(r => r.length !== M)) return null;   // Endleiste teils spitz, teils stumpf → nicht gemeinsam teilbar
    const le = r => { let b = r[0]; for (const p of r) if (p[0] < b[0]) b = p; return b; };
    const cum = [0]; for (let k = 1; k < rings.length; k++) { const a = le(rings[k - 1]), b = le(rings[k]); cum.push(cum[k - 1] + Math.max(1e-9, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]))); }
    // Kürzen am Rumpf: Parameter, an dem die Nase die Spannweite zc erreicht
    let s0 = 0;
    if (zc > 0) {
      const zs = rings.map(r => le(r)[2]);
      if (zs[zs.length - 1] <= zc) return null;
      for (let k = 0; k + 1 < rings.length; k++) if (zs[k + 1] > zc) { if (zs[k] < zc) s0 = cum[k] + (cum[k + 1] - cum[k]) * (zc - zs[k]) / (zs[k + 1] - zs[k]); else s0 = cum[k]; break; }
    }
    const sT = cum[Math.min(st.nWing, rings.length) - 1], sE = cum[cum.length - 1];
    const at = s => {
      let k = 0; while (k < cum.length - 2 && cum[k + 1] < s) k++;
      const t = clamp((s - cum[k]) / (cum[k + 1] - cum[k]), 0, 1), A = rings[k], B = rings[k + 1];
      return A.map((p, j) => [p[0] + (B[j][0] - p[0]) * t, p[1] + (B[j][1] - p[1]) * t, p[2] + (B[j][2] - p[2]) * t]);
    };
    const S = [], tipFrom = [];
    const a0 = Math.min(s0, sT);
    for (let k = 0; k <= ns; k++) S.push(a0 + (sT - a0) * k / ns);
    const nt = sE - sT > 1e-6 ? Math.max(3, Math.ceil(ns * (sE - sT) / Math.max(1e-6, sT - a0))) : 0;
    for (let k = 1; k <= nt; k++) S.push(sT + (sE - sT) * k / nt);
    const out = S.map(s => at(s));
    S.forEach((s, k) => tipFrom.push(s > sT + 1e-9));
    // Oberseite: die Hälfte des Rings mit der größeren mittleren Höhe
    const half = Math.floor(M / 2); let up = 0;
    for (let j = 1; j < half; j++) up += out[0][j][1] - out[0][M - j][1];
    return { st: out, M, tip: tipFrom, topFirst: up > 0 };
  }

  // Indiziertes Netz aufbauen: pos, Farbe, uv, Gruppe je Dreieck. Kappe per earcut in der Ringebene.
  function newMesh(name, closed) { return { name, P: [], C: [], U: [], I: [], G: [], closed }; }
  function addV(m, p, c, uv) { m.P.push(p[0], p[1], p[2]); m.C.push(c[0], c[1], c[2]); m.U.push(uv ? uv[0] : 0, uv ? uv[1] : 0); return m.P.length / 3 - 1; }
  function tri(m, a, b, c, g) { if (a === b || b === c || a === c) return; m.I.push(a, b, c); m.G.push(g || 0); }
  function capRing(m, idx, outward, g) {
    const pts = idx.map(i => [m.P[3 * i], m.P[3 * i + 1], m.P[3 * i + 2]]);
    let nx = 0, ny = 0, nz = 0;   // Newell-Normale
    for (let k = 0; k < pts.length; k++) { const a = pts[k], b = pts[(k + 1) % pts.length]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
    const nl = Math.hypot(nx, ny, nz); if (nl < 1e-12) return;
    const n = [nx / nl, ny / nl, nz / nl], ax = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = [n[1] * ax[2] - n[2] * ax[1], n[2] * ax[0] - n[0] * ax[2], n[0] * ax[1] - n[1] * ax[0]], ul = Math.hypot(u[0], u[1], u[2]); u[0] /= ul; u[1] /= ul; u[2] /= ul;
    const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const flat = pts.map(p => ({ x: p[0] * u[0] + p[1] * u[1] + p[2] * u[2], y: p[0] * v[0] + p[1] * v[1] + p[2] * v[2] }));
    const r = App.earcut ? App.earcut([flat]) : null;
    // Umlaufsinn passend zum Mantel: die Kante idx[0]→idx[1] muss in der Kappe gegenläufig zum Mantel liegen
    let mant = 0; for (let k = 0; k < m.I.length; k += 3) for (let e = 0; e < 3; e++) { const a = m.I[k + e], b = m.I[k + (e + 1) % 3]; if (a === idx[0] && b === idx[1]) mant = 1; else if (a === idx[1] && b === idx[0]) mant = -1; }
    let same = n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] > 0;
    if (mant) { const r0 = r && r.tris.length ? r.tris : null; let fw = 0;   // Kappe ohne Umdrehen: enthält sie idx[0]→idx[1]?
      if (r0) r0.forEach(t => { for (let e = 0; e < 3; e++) { const a = t[e], b = t[(e + 1) % 3]; if (a === 0 && b === 1) fw = 1; else if (a === 1 && b === 0) fw = -1; } }); else fw = 1;
      if (fw) same = fw !== mant; }
    if (r && r.tris.length) r.tris.forEach(t => { const A = idx[t[0]], B = idx[t[1]], Cc = idx[t[2]]; if (same) tri(m, A, B, Cc, g); else tri(m, A, Cc, B, g); });
    else { const c = addV(m, [0, 1, 2].map(k => pts.reduce((s, p) => s + p[k], 0) / pts.length), [m.C[3 * idx[0]], m.C[3 * idx[0] + 1], m.C[3 * idx[0] + 2]]); for (let k = 0; k < idx.length; k++) { const A = idx[k], B = idx[(k + 1) % idx.length]; if (same) tri(m, c, A, B, g); else tri(m, c, B, A, g); } }
  }
  // Rundum stimmige Orientierung: Volumen negativ → alle Dreiecke umdrehen (Normalen nach außen)
  function orient(m) {
    let V = 0; const P = m.P, I = m.I;
    for (let k = 0; k < I.length; k += 3) { const a = 3 * I[k], b = 3 * I[k + 1], c = 3 * I[k + 2]; V += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]); }
    if (V < 0) for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; }
    m.vol = Math.abs(V) / 6;
  }
  // Prüfung für flow5: jede Kante genau zweimal, gegenläufig
  function checkMesh(m) {
    const E = new Map(); let bad = 0, deg = 0; const I = m.I, P = m.P;
    for (let k = 0; k < I.length; k += 3) {
      for (let e = 0; e < 3; e++) { const a = I[k + e], b = I[k + (e + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a; E.set(key, (E.get(key) || 0) + (a < b ? 1 : 1000)); }
      const a = 3 * I[k], b = 3 * I[k + 1], c = 3 * I[k + 2], ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-6) deg++;
    }
    E.forEach(v => { if (v !== 1001) bad++; });
    return { free: bad, deg, tris: I.length / 3 };
  }

  const hex = c => { const s = RAW(c || '#cccccc').replace('#', ''); const n = parseInt(s.length === 3 ? s.split('').map(q => q + q).join('') : s, 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

  // Ganzes Modell. q = { nc, ns, fx, fs } (Feinheit). Rückgabe { meshes:[…], ref, warn:[] }
  function buildModel(q) {
    const c = cfg(), out = { meshes: [], warn: [], wingsUV: [] };
    // Anzeige: Netze aus „Rumpf“; flow5: daraus abgeleitet (ausgedünnt, verschweißt). Das eigene Gitter nur als Rückfall.
    const fm = c.fusOn ? (q.view ? fusMeshes(c) : fusFlow5(q)) : null;
    if (fm) { out.meshes.push.apply(out.meshes, fm); out.fus = true; }
    const f = c.fusOn ? fusGrid(60, 48, true) : null;
    if (c.fusOn && !f) out.warn.push(T('Kein Rumpf im Reiter „Rumpf“.'));
    if (f && !fm) {
      const m = newMesh(T('Rumpf'), true), col = hex(c.fusCol), W = f.NS, ids = [];
      m.tex = 'fus';
      for (let i = 0; i < f.NX; i++) { const row = []; for (let j = 0; j < W; j++) row.push(addV(m, [f.xs[i], f.R[i][2 * j], f.R[i][2 * j + 1]], col, [(f.xs[i] - f.x0) / (f.x1 - f.x0), j / W])); ids.push(row); }
      for (let i = 0; i + 1 < f.NX; i++) for (let j = 0; j < W; j++) { const a = ids[i][j], b = ids[i][(j + 1) % W], d = ids[i + 1][j], e = ids[i + 1][(j + 1) % W]; tri(m, a, d, b, 1); tri(m, b, d, e, 1); }
      capRing(m, ids[0], [-1, 0, 0], 1); capRing(m, ids[f.NX - 1], [1, 0, 0], 1);
      orient(m); out.meshes.push(m); out.fus = f;
    }
    const items = []; for (let i = 0; i < wingCount(); i++) items.push({ i });
    // flow5: Höhenleitwerk aus „Rumpf“ als eigene Tragfläche (Endleisten-Paare, Kosinus-Teilung), nicht als Rumpfteil
    if (!q.view && c.fusOn && fm) { const hs = hlwStack(); if (hs) items.push({ i: -1, st: hs, name: T('Höhenleitwerk'), p: { role: 'htail', mirror: true, col: c.tailCol || c.fusCol },
      pl: { x: 0, y: 0, z0: 0, sc: 1, fus: true, map: (x, y) => [x, y] } }); }   // nicht kürzen: Auflage (T) bzw. Stummel bis zS gehören zum Rumpf
    for (const it of items) {
      const i = it.i, p = it.p || part(i); if (p.role === 'off') continue;
      const wName = it.name || wingName(i);
      const st = it.st || wingStack(i); if (!st) { out.warn.push(wName + ': ' + T('keine Geometrie (Formenbau nötig)')); continue; }
      const vt = p.role === 'vtail';
      const chord = st.rings[0].reduce((m, r) => Math.max(m, r[0]), 0), pl = it.pl || placeOf(i, p, chord);
      let zc = 0;
      // Anzeige: nicht kürzen. flow5: Lage aus „Rumpf“ endet an der Wurzelrippe (Anformung gehört zum Rumpf), sonst an der Rumpfwand kürzen
      if (f && c.clip && !q.view && !pl.fus) {
        const x0w = st.rings[0].reduce((m2, r) => Math.min(m2, r[0]), Infinity), e = fusExtent(f, pl.x + (it.st ? x0w : 0), pl.x + chord * pl.sc, vt ? 'top' : 'side');
        if (isFinite(e)) zc = ((vt ? e - pl.y : e) + (+c.gap || 0) - pl.z0) / pl.sc;
      }
      const S = wingSurface(st, q.nc, q.ns, zc);
      if (!S) { out.warn.push(wName + ': ' + T('liegt ganz im Rumpf oder Endleiste uneinheitlich')); continue; }
      const sides = vt || p.mirror === false ? [1] : [1, -1];
      sides.forEach(sg => {
        const m = newMesh(wName + (sides.length > 1 ? (sg > 0 ? ' ' + T('rechts') : ' ' + T('links')) : ''), true);
        m.tex = 'w' + i; m.wing = i;
        const cw = hex(p.col), ct = hex(p.tipCol || p.col), ids = [];
        const X = pl.map;
        S.st.forEach((ring, k) => {
          const row = [];
          ring.forEach((pt, j) => {
            const r = X(pt[0], pt[1]);
            const zz = pl.z0 + pt[2] * pl.sc, w = vt ? [pl.x + r[0], pl.y + zz, -r[1]] : [pl.x + r[0], pl.y + r[1], sg * zz];
            const topS = (j <= S.M / 2) === S.topFirst;
            // Decal-Ansicht (decals.js): x = Spannweite (rechte Hälfte +), y = −Tiefe; Unterseite von unten gesehen gespiegelt
            const vx = (topS ? 1 : -1) * sg * pt[2], vy = -pt[0];
            row.push(addV(m, w, S.tip[k] ? ct : cw, [vx, vy]));
          });
          ids.push(row);
        });
        const M = S.M, grp = j => ((j + 0.5 <= M / 2) === S.topFirst ? 2 : 3);
        for (let k = 0; k + 1 < ids.length; k++) for (let j = 0; j < M; j++) { const a = ids[k][j], b = ids[k][(j + 1) % M], d = ids[k + 1][j], e = ids[k + 1][(j + 1) % M]; tri(m, a, b, d, grp(j)); tri(m, b, e, d, grp(j)); }
        const cen = r => [0, 1, 2].map(k => r.reduce((s, i2) => s + m.P[3 * i2 + k], 0) / r.length);
        const c0 = cen(ids[0]), c1 = cen(ids[1]), cn = cen(ids[ids.length - 1]), cm = cen(ids[ids.length - 2]);
        capRing(m, ids[0], [c0[0] - c1[0], c0[1] - c1[1], c0[2] - c1[2]], 0);
        capRing(m, ids[ids.length - 1], [cn[0] - cm[0], cn[1] - cm[1], cn[2] - cm[2]], 0);
        orient(m); out.meshes.push(m);
      });
      if (p.role === 'wing' && !out.ref) out.ref = refData(st);
    }
    return out;
  }
  // Bezugsgrößen für flow5 (Fläche, Bezugsflügeltiefe, Spannweite) aus der Haupttragfläche, ohne Kürzung
  function refData(st) {
    const ch = st.rings.map(r => { let a = Infinity, b = -Infinity, z = 0; r.forEach(p => { a = Math.min(a, p[0]); b = Math.max(b, p[0]); z += p[2]; }); return { c: b - a, z: z / r.length }; });
    let S = 0, C2 = 0;
    for (let k = 0; k + 1 < ch.length; k++) { const dz = Math.abs(ch[k + 1].z - ch[k].z), cm = (ch[k].c + ch[k + 1].c) / 2; S += cm * dz; C2 += cm * cm * dz; }
    const span = 2 * Math.max.apply(null, ch.map(q => q.z));
    return { S: 2 * S, mac: S > 0 ? C2 / S : 0, span };
  }

  // ---------- Anzeige (WebGL2) ---------------------------------------------------------------------
  let win = null, cv = null, info = null, model = null, gl = null, prog = null, draws = [], texs = {}, ext = 1, ctr = [0, 0, 0];
  const cam = { yaw: -0.6, pitch: 0.35, zoom: 1, px: 0, py: 0, piv: null };
  function build() {
    const host = document.getElementById('flzView');
    win = document.createElement('div'); win.style.cssText = 'position:absolute;inset:0';
    cv = document.createElement('canvas'); cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    info = document.createElement('div'); info.className = 'simlegend'; info.style.cssText = 'left:10px;right:auto;top:10px;max-width:440px;z-index:3;display:block';
    const bar = document.createElement('div'); bar.className = 'simbar'; bar.style.cssText = 'position:absolute;left:0;right:0;bottom:0;z-index:4';
    const btn = (t, tt, fn, pr) => { const b = document.createElement('button'); b.textContent = T(t); b.title = T(tt); b.onclick = fn; if (pr) b.className = 'primary'; bar.appendChild(b); return b; };
    btn('flow5-Netz…', 'Netz für flow5 aus dem Modell ableiten, in eigenem Fenster prüfen und als STL speichern', () => exportFlow5(), true);
    btn('Neu aufbauen', 'Tragflächen neu aus dem Formenbau holen (nach Änderungen in anderen Reitern)', () => { stackCache = null; refresh(); });
    btn('⬚ Einpassen', 'Ansicht zurücksetzen (auch Doppelklick)', () => { reset(); draw(); });
    win.append(cv, info, bar); host.appendChild(win);
    gl = cv.getContext('webgl2', { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: true });
    if (!gl) { info.textContent = T('WebGL2 nicht verfügbar.'); return; }
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, '#version 300 es\nin vec3 aP;in vec3 aN;in vec3 aC;in vec2 aT;uniform mat3 uR;uniform vec3 uC;uniform vec3 uS;uniform vec2 uO;uniform vec4 uM;out vec3 vN;out vec3 vC;out vec2 vT;void main(){vec3 q=uR*(aP-uC);vN=uR*aN;vC=aC;vT=vec2((aT.x-uM.x)*uM.z,(aT.y-uM.y)*uM.w);gl_Position=vec4(q.x*uS.x+uO.x,q.y*uS.y+uO.y,-q.z*uS.z,1.0);}'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;in vec3 vN;in vec3 vC;in vec2 vT;uniform sampler2D uTex;uniform float uUse;out vec4 o;void main(){vec3 n=normalize(vN);float d=abs(dot(n,normalize(vec3(0.25,0.45,0.86))));vec4 t=texture(uTex,vT);vec3 c=mix(vC,t.rgb,t.a*uUse);o=vec4(c*(0.40+0.62*d),1.0);}'));
    gl.linkProgram(prog);
    let d = null;
    cv.addEventListener('mousedown', e => { d = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, px: cam.px, py: cam.py, pan: e.button === 2 || e.button === 1 || e.ctrlKey }; });
    window.addEventListener('mousemove', e => {
      if (!d) return;
      if (d.pan) { const r = cv.getBoundingClientRect(); cam.px = d.px + (e.clientX - d.x) / r.width * 2; cam.py = d.py - (e.clientY - d.y) / r.height * 2; }
      else { cam.yaw = d.yaw + (e.clientX - d.x) * 0.008; cam.pitch = clamp(d.pitch + (e.clientY - d.y) * 0.008, -1.55, 1.55); }
      draw();
    });
    window.addEventListener('mouseup', () => { d = null; });
    cv.addEventListener('wheel', e => { e.preventDefault(); const r = cv.getBoundingClientRect(), nx = (e.clientX - r.left) / r.width * 2 - 1, ny = 1 - (e.clientY - r.top) / r.height * 2, z0 = cam.zoom, z1 = clamp(z0 * Math.exp(-e.deltaY * 0.0015), 0.2, 80), k = z1 / z0;
      cam.px = nx - (nx - cam.px) * k; cam.py = ny - (ny - cam.py) * k; cam.zoom = z1; draw(); }, { passive: false });
    cv.addEventListener('dblclick', () => { reset(); draw(); });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    if (window.ViewCube && ViewCube.home) ViewCube.home({ canvas: () => cv, reset, redraw: () => draw() });
    if (window.ViewCube && ViewCube.midDbl) ViewCube.midDbl(cv, (x, y, e) => { const h = pick(e.clientX, e.clientY); if (!h) return false; const r = cv.getBoundingClientRect(); cam.piv = h; cam.px = (e.clientX - r.left) / r.width * 2 - 1; cam.py = 1 - (e.clientY - r.top) / r.height * 2; d = null; draw(); return true; });
    new ResizeObserver(() => draw()).observe(win);
  }
  function reset() { Object.assign(cam, { yaw: -0.6, pitch: 0.35, zoom: 1, px: 0, py: 0, piv: null }); }
  const center = () => cam.piv || ctr;
  function scale() { const r = cv.getBoundingClientRect(), asp = r.width / Math.max(1, r.height), k = cam.zoom * 0.92 / ext; return { sx: asp >= 1 ? k / asp : k, sy: asp >= 1 ? k : k * asp }; }
  // Mausrad-Doppelklick: vorderster Treffer auf dem Modell
  function pick(cx, cy) {
    if (!model) return null;
    const r = cv.getBoundingClientRect(), nx = (cx - r.left) / r.width * 2 - 1, ny = 1 - (cy - r.top) / r.height * 2, s = scale();
    const qx = (nx - cam.px) / s.sx, qy = (ny - cam.py) / s.sy;
    const cyw = Math.cos(cam.yaw), syw = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const c0 = [cyw, sp * syw, -cp * syw], c1 = [0, cp, sp], c2 = [syw, -sp * cyw, cp * cyw], C = center();
    const O = [c0[0] * qx + c0[1] * qy + C[0], c1[0] * qx + c1[1] * qy + C[1], c2[0] * qx + c2[1] * qy + C[2]], D = [c0[2], c1[2], c2[2]];
    let best = -Infinity;
    for (const m of model.meshes) {
      const P = m.P, I = m.I;
      for (let k = 0; k < I.length; k += 3) {
        const a = 3 * I[k], b = 3 * I[k + 1], c = 3 * I[k + 2];
        const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
        const pv = [D[1] * e2[2] - D[2] * e2[1], D[2] * e2[0] - D[0] * e2[2], D[0] * e2[1] - D[1] * e2[0]], det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
        if (Math.abs(det) < 1e-12) continue;
        const tv = [O[0] - P[a], O[1] - P[a + 1], O[2] - P[a + 2]], u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) / det; if (u < 0 || u > 1) continue;
        const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]], v = (D[0] * qv[0] + D[1] * qv[1] + D[2] * qv[2]) / det; if (v < 0 || u + v > 1) continue;
        const t = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det; if (t > best) best = t;
      }
    }
    return best === -Infinity ? null : [O[0] + D[0] * best, O[1] + D[1] * best, O[2] + D[2] * best];
  }
  // Texturen: Rumpf (Decals + Haube aus decals.js) und je Tragfläche Ober-/Unterseite (Ansichtskoordinaten)
  function texFrom(canvas, key) {
    let t = texs[key]; if (!t) t = texs[key] = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  }
  // Textur-Bilder (Canvas + uv-Abbildung m) — auch vom Flugsimulator (flugsim.js) genutzt
  function texCanvases(mdl) {
    const c = cfg(), D = window.Decals, out = {};
    if (mdl.fus && D && D.paintFus) {
      if (D.refreshFus) D.refreshFus();
      const tc = document.createElement('canvas'); tc.width = 4096; tc.height = 2048;
      if (D.paintFus(tc.getContext('2d'), tc.width, tc.height, { canoCol: c.canoOwn ? RAW(c.canoCol) : null, noItems: !c.decals })) out.fus = { canvas: tc, m: [0, 0, 1, 1] };
    }
    if (c.decals && D && D.wingLayers) for (let i = 0; i < wingCount(); i++) for (const side of ['top', 'bot']) {
      const L = D.wingLayers(i, side); if (!L.length) continue;
      // Bereich der Ansicht = Hülle der Netzpunkte dieser Tragfläche (uv = Ansichtskoordinaten in mm)
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      mdl.meshes.filter(m => m.wing === i).forEach(m => { for (let k = 0; k < m.U.length; k += 2) { x0 = Math.min(x0, m.U[k]); x1 = Math.max(x1, m.U[k]); y0 = Math.min(y0, m.U[k + 1]); y1 = Math.max(y1, m.U[k + 1]); } });
      if (!(x1 > x0 && y1 > y0)) continue;
      const tc = document.createElement('canvas'); tc.width = 4096; tc.height = 1024;
      const ctx = tc.getContext('2d'), sx = tc.width / (x1 - x0), sy = tc.height / (y1 - y0);
      L.forEach(l => { ctx.beginPath(); l.rings.forEach(R => { R.forEach((q, k) => { const X = (q[0] - x0) * sx, Y = (q[1] - y0) * sy; if (k) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }); ctx.closePath(); }); ctx.fillStyle = RAW(l.c); ctx.fill(l.rule === 'nonzero' ? 'nonzero' : 'evenodd'); });
      out['w' + i + side] = { canvas: tc, m: [x0, y0, 1 / (x1 - x0), 1 / (y1 - y0)] };
    }
    return out;
  }
  function makeTextures() {
    const cs = texCanvases(model), out = {};
    for (const k in cs) out[k] = { t: texFrom(cs[k].canvas, k), m: cs[k].m };
    return out;
  }
  function upload() {
    draws.forEach(d => { gl.deleteVertexArray(d.vao); d.bufs.forEach(b => gl.deleteBuffer(b)); }); draws = [];
    if (!model) return;
    const tx = makeTextures();
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    model.meshes.forEach(m => {
      const n = m.P.length / 3, P = m.P, I = m.I, N = m.N ? new Float32Array(m.N) : new Float32Array(3 * n);
      if (!m.N) for (let k = 0; k < I.length; k += 3) {
        const a = 3 * I[k], b = 3 * I[k + 1], c = 3 * I[k + 2], ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const q of [a, b, c]) { N[q] += nx; N[q + 1] += ny; N[q + 2] += nz; }
      }
      for (let k = 0; k < n; k++) for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], P[3 * k + j]); hi[j] = Math.max(hi[j], P[3 * k + j]); }
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao); const bufs = [];
      [['aP', new Float32Array(P), 3], ['aN', N, 3], ['aC', new Float32Array(m.C), 3], ['aT', new Float32Array(m.U), 2]].forEach(([nm, data, sz]) => {
        const b = gl.createBuffer(); bufs.push(b); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        const l = gl.getAttribLocation(prog, nm); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, sz, gl.FLOAT, false, 0, 0);
      });
      // Dreiecke je Gruppe (0 Kappe, 1 Rumpf, 2 Oberseite, 3 Unterseite) → eigene Textur
      const byG = {}; for (let k = 0; k < m.G.length; k++) (byG[m.G[k]] = byG[m.G[k]] || []).push(I[3 * k], I[3 * k + 1], I[3 * k + 2]);
      const all = [], parts = [];
      for (const g in byG) { parts.push({ g: +g, off: all.length * 4, n: byG[g].length }); for (const v of byG[g]) all.push(v); }
      const ib = gl.createBuffer(); bufs.push(ib); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(all), gl.STATIC_DRAW);
      parts.forEach(p => { const t = m.tex === 'fus' ? tx.fus : p.g === 2 ? tx[m.tex + 'top'] : p.g === 3 ? tx[m.tex + 'bot'] : null; draws.push({ vao, bufs: draws.some(d => d.vao === vao) ? [] : bufs, off: p.off, n: p.n, tex: t }); });
    });
    ctr = [0, 1, 2].map(j => (lo[j] + hi[j]) / 2); ext = Math.max(1, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);
    if (cam.piv && Math.hypot(cam.piv[0] - ctr[0], cam.piv[1] - ctr[1], cam.piv[2] - ctr[2]) > 1.5 * ext) { cam.piv = null; cam.px = cam.py = 0; }
  }
  function draw() {
    if (!gl || !win || state.activeTab !== 'flz') return;
    const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect(), w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const bg = hex(window.DrawTheme && DrawTheme.raw ? '#171c24' : '#171c24');
    gl.viewport(0, 0, w, h); gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    if (!draws.length) return;
    gl.useProgram(prog);
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), s = scale();
    gl.uniformMatrix3fv(gl.getUniformLocation(prog, 'uR'), false, [cy, sp * sy, -cp * sy, 0, cp, sp, sy, -sp * cy, cp * cy]);
    gl.uniform3fv(gl.getUniformLocation(prog, 'uC'), center());
    gl.uniform2f(gl.getUniformLocation(prog, 'uO'), cam.px, cam.py);
    gl.uniform3f(gl.getUniformLocation(prog, 'uS'), s.sx, s.sy, (cam.piv ? 0.25 : 0.5) / ext);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
    const uUse = gl.getUniformLocation(prog, 'uUse'), uM = gl.getUniformLocation(prog, 'uM');
    if (!texs._none) { texs._none = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texs._none); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); }
    draws.forEach(d => {
      gl.bindVertexArray(d.vao);
      gl.bindTexture(gl.TEXTURE_2D, d.tex ? d.tex.t : texs._none); gl.uniform1f(uUse, d.tex ? 1 : 0);
      const m = d.tex ? d.tex.m : [0, 0, 1, 1]; gl.uniform4f(uM, m[0], m[1], m[2], m[3]);
      gl.drawElements(gl.TRIANGLES, d.n, gl.UNSIGNED_INT, d.off);
    });
  }
  const VIEW_Q = { nc: 80, ns: 120, fx: 140, fs: 96, view: true };
  function refresh() {
    if (!win) return;
    try { model = buildModel(VIEW_Q); } catch (e) { console.error('Flugzeug gesamt:', e); model = { meshes: [], warn: [String(e)] }; }
    if (gl) upload();
    showInfo(); draw();
  }
  function showInfo() {
    if (!info || !model) return;
    const f1 = v => (Math.round(v * 10) / 10).toLocaleString();
    let s = '<b>' + T('Flugzeug gesamt') + '</b> — ' + model.meshes.length + ' ' + T('Bauteile');
    if (model.ref) s += '<br>' + T('Bezugswerte für flow5 (Haupttragfläche)') + ': ' + T('Fläche') + ' ' + f1(model.ref.S / 1e4) + ' dm² · ' + T('Bezugsflügeltiefe') + ' ' + f1(model.ref.mac) + ' mm · ' + T('Spannweite') + ' ' + f1(model.ref.span) + ' mm';
    model.warn.forEach(w => { s += '<br><span style="color:#e0a040">⚠ ' + w + '</span>'; });
    s += '<br><span style="opacity:.7">' + T('Ziehen = drehen · Rad = Zoom · rechte Taste = schieben · Doppelklick = einpassen') + '</span>';
    info.innerHTML = s;
  }
  function show() {
    if (!win) build();
    stackCache = null; reset();
    refresh();
  }

  // ---------- flow5-Export --------------------------------------------------------------------------
  function stlOf(meshes, k) {
    let n = 0; meshes.forEach(m => { n += m.I.length / 3; });
    const buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf);
    const hd = 'AI Foam Cut - flow5 plane mesh'; for (let i = 0; i < hd.length; i++) dv.setUint8(i, hd.charCodeAt(i));
    dv.setUint32(80, n, true); let o = 84;
    // Anzeige (X hinten, Y oben, Z seitlich) → flow5 (x hinten, y seitlich, z oben): (X, −Z, Y), reine Drehung
    const F = (P, i) => [P[3 * i] * k, -P[3 * i + 2] * k, P[3 * i + 1] * k];
    meshes.forEach(m => {
      for (let t = 0; t < m.I.length; t += 3) {
        const a = F(m.P, m.I[t]), b = F(m.P, m.I[t + 1]), c = F(m.P, m.I[t + 2]);
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        [nx, ny, nz].concat(a, b, c).forEach(v => { dv.setFloat32(o, v, true); o += 4; });
        dv.setUint16(o, 0, true); o += 2;
      }
    });
    return buf;
  }
  function exportFlow5() {
    const c = cfg(), q = { nc: clamp(Math.round(+c.f5.nc || 20), 6, 200), ns: clamp(Math.round(+c.f5.ns || 24), 4, 400), fx: clamp(Math.round(+c.f5.fx || 60), 8, 400), fs: 2 * clamp(Math.round((+c.f5.fs || 32) / 2), 4, 200) };
    let M; try { M = buildModel(q); } catch (e) { console.error('Flugzeug gesamt: flow5', e); (App.toast || alert)(String(e)); return; }
    if (!M.meshes.length) { (App.toast || alert)(T('Nichts zu exportieren.')); return; }
    preview(M, M.meshes.map(m => Object.assign({ name: m.name }, checkMesh(m))));
  }
  // Eigenes Vorschaufenster: das flow5-Netz mit Dreieckskanten, offene Kanten rot, Prüfliste je Bauteil, Speichern
  function preview(M, chk) {
    const old = document.getElementById('flzF5Win'); if (old) old.remove();
    const ov = document.createElement('div'); ov.id = 'flzF5Win';
    ov.style.cssText = 'position:fixed;inset:5vh 5vw;z-index:9000;background:#14181e;border:1px solid #3a4452;border-radius:6px;box-shadow:0 10px 40px rgba(0,0,0,.6);display:flex;flex-direction:column;overflow:hidden';
    const head = document.createElement('div'); head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #3a4452;color:#dde';
    head.innerHTML = '<b style="flex:1">' + T('flow5-Netz — Vorschau') + '</b>';
    const x = document.createElement('button'); x.textContent = '✕'; x.onclick = () => ov.remove(); head.appendChild(x);
    const body = document.createElement('div'); body.style.cssText = 'position:relative;flex:1;min-height:0';
    const cvs = document.createElement('canvas'); cvs.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    const inf = document.createElement('div'); inf.className = 'simlegend'; inf.style.cssText = 'left:10px;right:auto;top:10px;max-width:460px;display:block;z-index:2';
    const c = cfg(), k = c.f5.unit === 'mm' ? 1 : 0.001, tot = chk.reduce((s2, r) => s2 + r.tris, 0);
    inf.innerHTML = chk.map(r => '<div' + (r.free || r.deg ? ' style="color:#e0a040"' : '') + '>' + r.name + ': ' + r.tris + ' ' + T('Dreiecke') + (r.free ? ', ' + r.free + ' ' + T('offene Kanten') : '') + (r.deg ? ', ' + r.deg + ' ' + T('entartet') : '') + (r.free || r.deg ? '' : ' ✓') + '</div>').join('')
      + '<div style="opacity:.75;margin-top:4px">' + T('Summe') + ' ' + tot + ' ' + T('Dreiecke') + ' · ' + T('Einheit') + ' ' + (k === 1 ? 'mm' : 'm') + (M.ref ? ' · S ' + (Math.round(M.ref.S / 1e4 * 10) / 10) + ' dm², MAC ' + Math.round(M.ref.mac) + ' mm, b ' + Math.round(M.ref.span) + ' mm' : '') + '</div>'
      + '<div style="opacity:.6">' + T('Rot = offene Kanten · Ziehen = drehen · Rad = Zoom · rechte Taste = schieben') + '</div>';
    body.append(cvs, inf);
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;padding:6px 10px;border-top:1px solid #3a4452';
    const base = (App.projBase ? App.projBase() : (state.projectName || 'flugzeug')).replace(/[\\/:*?"<>|]+/g, '_');
    const bad = chk.some(r => r.free || r.deg);
    const ok = () => !bad || confirm(T('Das Netz ist nicht überall geschlossen. Trotzdem speichern?'));
    const b = (t, fn, pr) => { const e = document.createElement('button'); e.textContent = T(t); e.onclick = fn; if (pr) e.className = 'primary'; bar.appendChild(e); };
    b('Als ein STL speichern…', () => { if (!ok()) return; save(base + '_flow5.stl', stlOf(M.meshes, k)); }, true);
    b('Einzelteile speichern…', () => {
      if (!ok()) return;
      const list = M.meshes.map(m => ({ name: base + '_' + m.name.replace(/\s+/g, '_') + '.stl', data: stlOf([m], k) }));
      if (App.stlSaveMany) App.stlSaveMany(list, 'svStl', { name: base + '_flow5' }); else list.forEach(it => save(it.name, it.data));
    });
    b('Schließen', () => ov.remove());
    ov.append(head, body, bar); document.body.appendChild(ov);

    const g = cvs.getContext('webgl2', { antialias: true, alpha: false, depth: true });
    if (!g) { inf.innerHTML += '<div>' + T('WebGL2 nicht verfügbar.') + '</div>'; return; }
    const sh = (t, src) => { const o = g.createShader(t); g.shaderSource(o, src); g.compileShader(o); return o; };
    const pr = g.createProgram();
    g.attachShader(pr, sh(g.VERTEX_SHADER, '#version 300 es\nin vec3 aP;in vec3 aB;in vec3 aC;uniform mat3 uR;uniform vec3 uC;uniform vec3 uS;uniform vec2 uO;out vec3 vQ;out vec3 vB;out vec3 vC;void main(){vec3 q=uR*(aP-uC);vQ=q;vB=aB;vC=aC;gl_Position=vec4(q.x*uS.x+uO.x,q.y*uS.y+uO.y,-q.z*uS.z,1.0);}'));
    g.attachShader(pr, sh(g.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;in vec3 vQ;in vec3 vB;in vec3 vC;uniform float uL;out vec4 o;void main(){if(uL>0.5){o=vec4(1.0,0.2,0.15,1.0);return;}vec3 n=normalize(cross(dFdx(vQ),dFdy(vQ)));float d=abs(dot(n,normalize(vec3(0.25,0.45,0.86))));vec3 c=vC*(0.38+0.62*d);float e=min(min(vB.x,vB.y),vB.z);float w=fwidth(e);c=mix(c*0.35,c,smoothstep(0.0,w*1.3,e));o=vec4(c,1.0);}'));
    g.linkProgram(pr);
    const pal = [[0.85, 0.87, 0.9], [0.95, 0.75, 0.3], [0.45, 0.65, 0.95], [0.5, 0.8, 0.5], [0.9, 0.5, 0.45], [0.75, 0.6, 0.9]];
    const P3 = [], B3 = [], C3 = [], LN = []; let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    M.meshes.forEach((m, mi) => {
      const col = pal[mi % pal.length], E = new Map();
      for (let t = 0; t < m.I.length; t += 3) for (let e = 0; e < 3; e++) {
        const i = m.I[t + e]; P3.push(m.P[3 * i], m.P[3 * i + 1], m.P[3 * i + 2]); B3.push(e === 0 ? 1 : 0, e === 1 ? 1 : 0, e === 2 ? 1 : 0); C3.push(col[0], col[1], col[2]);
        for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], m.P[3 * i + j]); hi[j] = Math.max(hi[j], m.P[3 * i + j]); }
        const a2 = m.I[t + e], b2 = m.I[t + (e + 1) % 3], key = a2 < b2 ? a2 + ',' + b2 : b2 + ',' + a2; E.set(key, (E.get(key) || 0) + 1);
      }
      E.forEach((n, key) => { if (n !== 2) key.split(',').forEach(i => LN.push(m.P[3 * i], m.P[3 * i + 1], m.P[3 * i + 2])); });
    });
    const mk = arrs => { const vao = g.createVertexArray(); g.bindVertexArray(vao); arrs.forEach(([nm, data]) => { const bf = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, bf); g.bufferData(g.ARRAY_BUFFER, new Float32Array(data), g.STATIC_DRAW); const l = g.getAttribLocation(pr, nm); if (l < 0) return; g.enableVertexAttribArray(l); g.vertexAttribPointer(l, 3, g.FLOAT, false, 0, 0); }); return vao; };
    const vT = mk([['aP', P3], ['aB', B3], ['aC', C3]]), vL = LN.length ? mk([['aP', LN]]) : null;
    const ctr = [0, 1, 2].map(j => (lo[j] + hi[j]) / 2), ex = Math.max(1, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);
    const cm = { yaw: -0.6, pitch: 0.35, zoom: 1, px: 0, py: 0 };
    const paint = () => {
      if (!ov.isConnected) return;
      const dpr = window.devicePixelRatio || 1, r = cvs.getBoundingClientRect(), w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (cvs.width !== w || cvs.height !== h) { cvs.width = w; cvs.height = h; }
      g.viewport(0, 0, w, h); g.clearColor(0.09, 0.11, 0.14, 1); g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT); g.enable(g.DEPTH_TEST); g.useProgram(pr);
      const cy = Math.cos(cm.yaw), sy = Math.sin(cm.yaw), cp = Math.cos(cm.pitch), sp = Math.sin(cm.pitch), asp = r.width / Math.max(1, r.height), kk = cm.zoom * 0.92 / ex;
      g.uniformMatrix3fv(g.getUniformLocation(pr, 'uR'), false, [cy, sp * sy, -cp * sy, 0, cp, sp, sy, -sp * cy, cp * cy]);
      g.uniform3fv(g.getUniformLocation(pr, 'uC'), ctr); g.uniform2f(g.getUniformLocation(pr, 'uO'), cm.px, cm.py);
      g.uniform3f(g.getUniformLocation(pr, 'uS'), asp >= 1 ? kk / asp : kk, asp >= 1 ? kk : kk * asp, 0.5 / ex);
      const uL = g.getUniformLocation(pr, 'uL');
      g.uniform1f(uL, 0); g.bindVertexArray(vT); g.drawArrays(g.TRIANGLES, 0, P3.length / 3);
      if (vL) { g.uniform1f(uL, 1); g.disable(g.DEPTH_TEST); g.bindVertexArray(vL); g.drawArrays(g.LINES, 0, LN.length / 3); }
    };
    let d = null;
    cvs.addEventListener('mousedown', e => { d = { x: e.clientX, y: e.clientY, yaw: cm.yaw, pitch: cm.pitch, px: cm.px, py: cm.py, pan: e.button !== 0 || e.ctrlKey }; });
    const mv = e => { if (!d) return; if (!ov.isConnected) { window.removeEventListener('mousemove', mv); return; }
      if (d.pan) { const r = cvs.getBoundingClientRect(); cm.px = d.px + (e.clientX - d.x) / r.width * 2; cm.py = d.py - (e.clientY - d.y) / r.height * 2; }
      else { cm.yaw = d.yaw + (e.clientX - d.x) * 0.008; cm.pitch = clamp(d.pitch + (e.clientY - d.y) * 0.008, -1.55, 1.55); }
      paint(); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', () => { d = null; });
    cvs.addEventListener('wheel', e => { e.preventDefault(); const r = cvs.getBoundingClientRect(), nx = (e.clientX - r.left) / r.width * 2 - 1, ny = 1 - (e.clientY - r.top) / r.height * 2, z1 = clamp(cm.zoom * Math.exp(-e.deltaY * 0.0015), 0.2, 200), kq = z1 / cm.zoom;
      cm.px = nx - (nx - cm.px) * kq; cm.py = ny - (ny - cm.py) * kq; cm.zoom = z1; paint(); }, { passive: false });
    cvs.addEventListener('dblclick', () => { Object.assign(cm, { yaw: -0.6, pitch: 0.35, zoom: 1, px: 0, py: 0 }); paint(); });
    cvs.addEventListener('contextmenu', e => e.preventDefault());
    new ResizeObserver(paint).observe(body); paint();
  }
  function save(name, data) { if (typeof App.download === 'function') App.download(name, data, 'model/stl', 'svStl'); else if (App.anchorDownload) App.anchorDownload(name, data, 'model/stl'); }

  // ---------- Seitenleiste ---------------------------------------------------------------------------
  function flzSidebar(side) {
    const { grp, hint, numRow, boolRow, selectRow } = App;
    const c = cfg(), RD = () => { refresh(); }, RB = () => { App.buildSidebar(); refresh(); };
    const row = (body, label, el) => { const r = document.createElement('div'); r.className = 'row'; const l = document.createElement('label'); l.textContent = T(label); r.append(l, el); body.appendChild(r); };
    const colRow = (body, label, get, set) => { const i = document.createElement('input'); i.type = 'color'; i.value = get(); i.onchange = () => { set(i.value); RD(); }; row(body, label, i); };
    const NR = { norender: true, enter: true };

    const g0 = grp('Flugzeug gesamt', true, 'flz', { key: 'flzMain', alwaysOpen: true });
    hint(g0.body, 'Rumpf aus dem Reiter „Rumpf“, Tragflächen mit Randbogen/Winglet aus dem Formenbau (je Tragfläche). Jede Tragfläche bekommt eine Rolle, eine Lage am Rumpf und eigene Farben.');
    boolRow(g0.body, 'Rumpf zeigen', () => c.fusOn, v => { c.fusOn = v; RD(); });
    colRow(g0.body, 'Farbe Rumpf', () => c.fusCol, v => { c.fusCol = v; });
    colRow(g0.body, 'Farbe Leitwerk', () => c.tailCol || c.fusCol, v => { c.tailCol = v; });
    boolRow(g0.body, 'Kabinenhaube eigene Farbe', () => c.canoOwn, v => { c.canoOwn = v; RB(); });
    if (c.canoOwn) colRow(g0.body, 'Farbe Kabinenhaube', () => c.canoCol, v => { c.canoCol = v; });
    boolRow(g0.body, 'Decals zeigen', () => c.decals, v => { c.decals = v; RD(); });
    side.appendChild(g0.g);

    for (let i = 0; i < wingCount(); i++) {
      const p = part(i), g = grp(wingName(i), i === 0, 'flz', { key: 'flzW' + i });
      selectRow(g.body, 'Rolle', ROLES, () => p.role, v => { p.role = v; RB(); });
      const own = i === (state.activeWing || 0);
      if (p.role !== 'off' && own) boolRow(g.body, 'Lage wie im Reiter „Rumpf“', () => !!p.fromFus, v => { p.fromFus = v; RB(); }, 'Wurzelnase, Einstellwinkel und Wurzelrippen-Ebene aus „Rumpf“ → Tragfläche (nur die aktive Tragfläche).');
      if (p.role !== 'off' && !(own && p.fromFus)) {
        numRow(g.body, 'Lage Wurzelnase X (mm)', () => p.x, v => { p.x = v; RD(); }, Object.assign({ step: 5 }, NR));
        numRow(g.body, 'Höhe Wurzelnase Y (mm)', () => p.y, v => { p.y = v; RD(); }, Object.assign({ step: 1 }, NR));
        numRow(g.body, 'Einstellwinkel (°)', () => p.inc, v => { p.inc = v; RD(); }, Object.assign({ step: 0.1 }, NR));
      }
      if (p.role !== 'off') {
        if (p.role !== 'vtail') boolRow(g.body, 'beide Hälften', () => p.mirror !== false, v => { p.mirror = v; RD(); });
        colRow(g.body, 'Farbe', () => p.col, v => { p.col = v; });
        colRow(g.body, 'Farbe Randbogen / Winglet', () => p.tipCol || p.col, v => { p.tipCol = v; });
      }
      side.appendChild(g.g);
    }

    const g2 = grp('Netz für flow5', false, 'flz', { key: 'flzF5' });
    hint(g2.body, 'flow5: Plane → Import → From an STL file, Einheit wie hier gewählt. Danach „Connect panels“, „Check free edges“ (nur an der Endleiste erlaubt) und „Guess T.E.“; Fläche, Bezugsflügeltiefe und Spannweite aus der Info oben links eintragen. Jedes Bauteil ist ein geschlossener Körper mit Normalen nach außen; oben und unten an der Endleiste gleich viele Dreiecke.');
    boolRow(g2.body, 'Flächen an der Rumpfwand kürzen', () => c.clip, v => { c.clip = v; RB(); }, 'Nur für Flächen mit eigener Lage: die Körper dürfen sich nicht überschneiden. Die Tragfläche mit Lage aus „Rumpf“ endet an der Wurzelrippe der Anformung.');
    if (c.clip) numRow(g2.body, 'Abstand zur Rumpfwand (mm)', () => c.gap, v => { c.gap = Math.max(0, v); }, Object.assign({ step: 0.5, min: 0 }, NR));
    selectRow(g2.body, 'Einheit', [['m', 'Meter (empfohlen)'], ['mm', 'Millimeter']], () => c.f5.unit, v => { c.f5.unit = v; });
    numRow(g2.body, 'Punkte je Profilseite', () => c.f5.nc, v => { c.f5.nc = clamp(Math.round(v), 6, 200); }, Object.assign({ step: 1, min: 6, int: true }, NR));
    numRow(g2.body, 'Schnitte je Flügelhälfte', () => c.f5.ns, v => { c.f5.ns = clamp(Math.round(v), 4, 400); }, Object.assign({ step: 1, min: 4, int: true }, NR));
    numRow(g2.body, 'Rumpf: Spanten', () => c.f5.fx, v => { c.f5.fx = clamp(Math.round(v), 8, 400); }, Object.assign({ step: 1, min: 8, int: true }, NR));
    numRow(g2.body, 'Rumpf: Punkte im Umfang', () => c.f5.fs, v => { c.f5.fs = clamp(Math.round(v), 8, 400); }, Object.assign({ step: 2, min: 8, int: true }, NR));
    side.appendChild(g2.g);
  }

  App.flzSidebar = flzSidebar;
  window.Flugzeug = { show, refresh, resize: draw, draw, exportFlow5, texCanvases, VIEW_Q, _test: { buildModel, fusFlow5, preview, checkMesh, wingSurface, resampleRing, fusGrid, stlOf, cfg, model: () => model, cam } };
})();
