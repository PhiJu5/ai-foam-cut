/* flugsim.js — Reiter „Flugsimulator“ (Tab fsim, Feature flugsim)
 * Mit dem zusammengesetzten Flugzeug aus „Flugzeug gesamt“ (Flugzeug._test.buildModel) wie mit einem
 * Modellflugzeug herumfliegen: Pilot steht am Boden (oder Verfolgerkamera), Steuerung per Tastatur oder
 * Fernsteuerung/Gamepad (Gamepad-API, USB-Sender melden sich als Joystick).
 *
 * Flugmodell: vereinfachte 6-Freiheitsgrade-Rechnung. Kräfte (Auftrieb, Widerstand, Seitenkraft, Schub,
 * Gewicht) aus Fläche/Streckung der Haupttragfläche (refData aus flugzeug.js); Drehbewegung als
 * stabilisiertes Modell (Anstellwinkel-Stabilität, Dämpfung, Windfahnen- und V-Form-Effekt), alles mit
 * dem Staudruck skaliert. Körperachsen: X vorn, Y oben, Z rechts. Welt: Y oben, Pilot im Nullpunkt.
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { state } = App;
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const G = 9.81, RHO = 1.225;

  const DEF = { mass: 0, load: 35, motor: true, thrust: 0, cd0: 0.03, rate: 100, expo: 30, wind: 2, windDir: 0, thermal: true,
    cam: 'pilot', start: 'hand', cgPct: 30, npPct: 42, scene: 'flat', plane: 'f3f', loadF3f: 40, slopeH: 60, slopeDeg: 35, quality: 'mittel',
    pad: { ail: 0, ele: 1, rud: 2, thr: 3, invAil: false, invEle: true, invRud: false, invThr: true } };
  const LS_KEY = 'hw_fsim_cfg'; let lsLast = '', lsT = 0;
  function saveLs() { try { const j = JSON.stringify(cfg()); if (j !== lsLast) { localStorage.setItem(LS_KEY, j); lsLast = j; } } catch (e) {} }
  // Eigenes Objekt, NICHT in state.cfg: Laden von Projekt/Einstellungen oder Rückgängig ersetzt state.cfg und
  // setzte so das Gelände mitten im Flug auf „Flugplatz“ zurück. Simulator-Werte sind Vorlieben des Piloten.
  let C = null;
  function cfg() {
    if (!C) { try { const t = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (t && typeof t === 'object') C = t; } catch (e) {} }
    if (!C) C = JSON.parse(JSON.stringify(DEF));
    const c = C;
    for (const k in DEF) if (c[k] === undefined) c[k] = JSON.parse(JSON.stringify(DEF[k]));
    for (const k in DEF.pad) if (c.pad[k] === undefined) c.pad[k] = DEF.pad[k];
    return c;
  }

  // ---------- kleine Vektor-/Matrixhelfer ----------
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]), norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  // Lage als 3×3 (Spalten = Körperachsen X vorn, Y oben, Z rechts in Weltkoordinaten)
  const toW = (R, v) => [R[0][0] * v[0] + R[1][0] * v[1] + R[2][0] * v[2], R[0][1] * v[0] + R[1][1] * v[1] + R[2][1] * v[2], R[0][2] * v[0] + R[1][2] * v[1] + R[2][2] * v[2]];
  const toB = (R, v) => [dot(R[0], v), dot(R[1], v), dot(R[2], v)];
  function rotAxes(R, w, dt) {   // w in Körperkoordinaten
    const ang = len(w) * dt; if (ang < 1e-12) return R;
    const k = norm(toW(R, w)), c = Math.cos(ang), s = Math.sin(ang);
    const rot = v => add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
    let x = norm(rot(R[0])), y = rot(R[1]);
    y = norm(sub(y, mul(x, dot(x, y)))); return [x, y, cross(x, y)];
  }
  function persp(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; }
  function lookAt(e, c, up) {
    const z = norm(sub(e, c)), x = norm(cross(up, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
  }
  function mm(a, b) { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return o; }
  function modelMat(R, p) { return [R[0][0], R[0][1], R[0][2], 0, R[1][0], R[1][1], R[1][2], 0, R[2][0], R[2][1], R[2][2], 0, p[0], p[1], p[2], 1]; }

  // ---------- Flugzeug aus „Flugzeug gesamt“ ----------
  let plane = null;   // { meshes (Körper-Koordinaten m), tex, S, b, c, AR, m, lo, hi }
  const isF3F = () => cfg().plane !== 'own';
  function massOf(S) { const c = cfg(); return c.mass > 0 ? c.mass / 1000 : (isF3F() ? c.loadF3f : c.load) * (S * 100) / 1000; }   // g/dm² × dm²
  function loadPlane() { return isF3F() ? buildF3F() : loadOwn(); }

  // ---------- Standardmodell: F3F-Hangrennsegler ----------
  // 2,95 m Spannweite, ~55 dm², V-Leitwerk 110°, schlanker Rumpf; Profil gewölbt 1,8 %/8,5 % (NACA-4-Formel).
  // Erzeugt direkt in Körperkoordinaten (m, X vorn, Y oben, Z rechts), danach auf den Schwerpunkt verschoben.
  function buildF3F() {
    const c = cfg(), meshes = [];
    const mk = () => ({ P: [], C: [], U: [], I: [], G: [] });
    const v = (m, p, col) => { m.P.push(p[0], p[1], p[2]); m.C.push(col[0], col[1], col[2]); m.U.push(0, 0); return m.P.length / 3 - 1; };
    const q = (m, a, b, cc, d) => { m.I.push(a, b, d, a, d, cc); m.G.push(0, 0); };
    const fan = (m, ring, col, flip) => { let cx = 0, cy = 0, cz = 0; ring.forEach(i => { cx += m.P[3 * i]; cy += m.P[3 * i + 1]; cz += m.P[3 * i + 2]; });
      const n = ring.length, ce = v(m, [cx / n, cy / n, cz / n], col); for (let j = 0; j < n; j++) { const a = ring[j], b = ring[(j + 1) % n]; if (flip) m.I.push(ce, b, a); else m.I.push(ce, a, b); m.G.push(0); } };
    // Profil: Ring von der Endleiste oben über die Nase zur Endleiste unten (x/c, y/c)
    function foil(mc, pc, t, n) {
      const yt = x => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
      const yc = x => mc ? (x < pc ? mc / (pc * pc) * (2 * pc * x - x * x) : mc / ((1 - pc) ** 2) * (1 - 2 * pc + 2 * pc * x - x * x)) : 0;
      const up = [], lo = [];
      for (let i = 0; i <= n; i++) { const x = 0.5 * (1 - Math.cos(Math.PI * i / n)); up.push([x, yc(x) + yt(x)]); lo.push([x, yc(x) - yt(x)]); }
      return up.reverse().concat(lo.slice(1, n));
    }
    // Fläche als Loft über Stationen st = [{xLE, y, z, c, col}] mit Profil pf; Kappen an beiden Enden
    function loft(st, pf) {
      const m = mk(), rows = st.map(S => pf.map(([x, y]) => v(m, [S.xLE - x * S.c, S.y + y * S.c, S.z], S.col)));
      const n = pf.length;
      for (let k = 0; k + 1 < rows.length; k++) for (let j = 0; j < n; j++) q(m, rows[k][j], rows[k][(j + 1) % n], rows[k + 1][j], rows[k + 1][(j + 1) % n]);
      fan(m, rows[0], st[0].col, true); fan(m, rows[rows.length - 1], st[st.length - 1].col, false);
      return m;
    }
    const WHITE = [0.95, 0.95, 0.96], RED = [0.85, 0.12, 0.10], YEL = [0.98, 0.78, 0.10], DARK = [0.12, 0.14, 0.18], BLUE = [0.12, 0.30, 0.75];
    // Tragfläche
    const half = 1.475, cr = 0.235, pfW = foil(0.018, 0.4, 0.085, 22), st = [];
    const NS = 28;
    for (let k = -NS; k <= NS; k++) {
      const e = Math.sign(k) * (1 - Math.cos(Math.PI / 2 * Math.abs(k) / NS)) , z = e * half, a = Math.abs(e);
      const ch = Math.max(0.03, cr * (0.42 + 0.58 * Math.sqrt(Math.max(0, 1 - a ** 2.2))) * (a > 0.97 ? Math.sqrt(Math.max(0.05, (1 - a) / 0.03)) : 1));
      const xLE = 0.02 * a - 0.25 * (cr - ch) * 0 + (cr - ch) * -0.15;   // leicht vorgepfeilte Nase, Endleiste fast gerade
      st.push({ xLE, y: Math.abs(z) * Math.tan(2.5 * Math.PI / 180), z, c: ch, col: a > 0.78 ? RED : WHITE });
    }
    const wing = loft(st, pfW); meshes.push(wing);
    // Fläche, Bezugsflügeltiefe, LE der MAC aus den Stationen
    let S = 0, C2 = 0, XL = 0;
    for (let k = 0; k + 1 < st.length; k++) { const dz = Math.abs(st[k + 1].z - st[k].z), cm = (st[k].c + st[k + 1].c) / 2, xm = (st[k].xLE + st[k + 1].xLE) / 2; S += cm * dz; C2 += cm * cm * dz; XL += xm * cm * dz; }
    const mac = C2 / S, xLEmac = XL / S, b = 2 * half;
    // Rumpf: Ellipsenquerschnitte, Nase rund, Haube oben, dünnes Leitwerksrohr
    const fm = mk(), NX = 46, NR = 20, x0 = 0.62, x1 = -0.98, rows = [];
    for (let i = 0; i <= NX; i++) {
      const t = i / NX, x = x0 + (x1 - x0) * t;
      let r = t < 0.28 ? 0.036 * Math.sqrt(Math.sin(Math.min(1, t / 0.28) * Math.PI / 2)) : 0.036 - (0.036 - 0.009) * Math.pow((t - 0.28) / 0.72, 0.7);
      if (i === 0) r = 0.0005;
      const ry = r * 1.25, yc = -0.012 + (t < 0.35 ? 0 : (t - 0.35) * 0.02), can = t > 0.06 && t < 0.3 ? 0.012 * Math.sin((t - 0.06) / 0.24 * Math.PI) : 0;
      const row = [];
      for (let j = 0; j < NR; j++) { const a = j / NR * 2 * Math.PI, sy = Math.sin(a), cz = Math.cos(a);
        row.push(v(fm, [x, yc + sy * (ry + (sy > 0 ? can * sy : 0)), cz * r], sy > 0.55 && can > 0.002 ? DARK : t < 0.12 ? RED : YEL)); }
      rows.push(row);
    }
    for (let i = 0; i < NX; i++) for (let j = 0; j < NR; j++) q(fm, rows[i][j], rows[i][(j + 1) % NR], rows[i + 1][j], rows[i + 1][(j + 1) % NR]);
    fan(fm, rows[NX], YEL, false); meshes.push(fm);
    // V-Leitwerk 110° (je Seite 35° V-Form)
    const pfT = foil(0, 0.4, 0.08, 14), vd = 35 * Math.PI / 180;
    [1, -1].forEach(sg => {
      const ts = []; for (let k = 0; k <= 10; k++) { const a = k / 10, sp = 0.33 * a, ch = 0.135 * (1 - 0.45 * a) * (a > 0.95 ? Math.sqrt(Math.max(0.1, (1 - a) / 0.05)) : 1);
        ts.push({ xLE: -0.80 - 0.10 * a, y: -0.0 + sp * Math.sin(vd), z: sg * sp * Math.cos(vd), c: Math.max(0.02, ch), col: a > 0.7 ? BLUE : YEL }); }
      if (sg < 0) ts.reverse();
      meshes.push(loft(ts, pfT));
    });
    // auf den Schwerpunkt schieben
    const cgx = xLEmac - mac * (c.cgPct / 100);
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const out = meshes.map(m => { const P = new Float32Array(m.P.length); for (let k = 0; k < P.length; k += 3) { P[k] = m.P[k] - cgx; P[k + 1] = m.P[k + 1]; P[k + 2] = m.P[k + 2]; for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], P[k + j]); hi[j] = Math.max(hi[j], P[k + j]); } }
      return { P, C: m.C, U: m.U, I: m.I, G: m.G, tex: null }; });
    const Sw = S;   // Stationen laufen über die ganze Spannweite
    return { meshes: out, tex: {}, S: Sw, b, c: mac, AR: b * b / Sw, m: massOf(Sw), bot: lo[1], len: hi[0] - lo[0], warn: [], name: 'F3F' };
  }

  function loadOwn() {
    const F = window.Flugzeug, B = F && F._test && F._test.buildModel;
    if (!B) return { err: T('Der Reiter „Flugzeug gesamt“ fehlt in dieser Ausgabe.') };
    let M; try { M = B(F.VIEW_Q || { nc: 60, ns: 80, fx: 100, fs: 64, view: true }); } catch (e) { console.error('Flugsimulator:', e); return { err: String(e) }; }
    if (!M || !M.meshes.length) return { err: T('Kein Flugzeug — bitte zuerst Rumpf und Tragflächen anlegen (Reiter „Flugzeug gesamt“).') };
    const c = cfg();
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    M.meshes.forEach(m => { for (let k = 0; k < m.P.length; k += 3) for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], m.P[k + j]); hi[j] = Math.max(hi[j], m.P[k + j]); } });
    const ref = M.ref || { S: (hi[2] - lo[2]) * (hi[0] - lo[0]) * 0.25, span: hi[2] - lo[2], mac: (hi[0] - lo[0]) * 0.2 };
    // Schwerpunkt: Anteil der Bezugsflügeltiefe hinter der Nasenleiste der Haupttragfläche (Wurzel) — sonst Mitte
    let xLE = null; M.meshes.forEach(m => { if (m.wing !== undefined && m.wing === firstWing(M) && m.P.length) { let a = Infinity; for (let k = 0; k < m.P.length; k += 3) if (Math.abs(m.P[k + 2]) < ref.span * 0.15) a = Math.min(a, m.P[k]); if (isFinite(a)) xLE = xLE === null ? a : Math.min(xLE, a); } });
    const cg = [xLE !== null ? xLE + ref.mac * (c.cgPct / 100) : (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, 0];
    // Modell (mm, x hinten, y oben, z Spannweite) → Körper (m, X vorn, Y oben, Z) — reine Drehung um Y (keine Spiegelung)
    const meshes = M.meshes.map(m => {
      const P = new Float32Array(m.P.length);
      for (let k = 0; k < m.P.length; k += 3) { P[k] = -(m.P[k] - cg[0]) * 1e-3; P[k + 1] = (m.P[k + 1] - cg[1]) * 1e-3; P[k + 2] = -(m.P[k + 2] - cg[2]) * 1e-3; }
      return { P, C: m.C, U: m.U, I: m.I, G: m.G, tex: m.tex };
    });
    const S = Math.max(1e-3, ref.S * 1e-6), b = Math.max(0.1, ref.span * 1e-3), mac = Math.max(0.03, ref.mac * 1e-3);
    let tex = {}; try { if (F.texCanvases) tex = F.texCanvases(M); } catch (e) { console.warn('Flugsimulator: Texturen', e); }
    const mass = massOf(S);
    const bot = -(cg[1] - lo[1]) * 1e-3;
    return { meshes, tex, S, b, c: mac, AR: b * b / S, m: mass, bot, len: (hi[0] - lo[0]) * 1e-3, warn: M.warn || [] };
  }
  function firstWing(M) { const w = M.meshes.find(m => m.wing !== undefined); return w ? w.wing : -99; }

  // ---------- Gelände ----------
  // flat: Wiese (Höhe 0). slope: Hang entlang Z — Hochfläche (x < Kante) in Höhe H, Flanke fällt zum Tal (x > Kante) ab.
  // Die Kante schlängelt leicht (edgeX), im Tal liegen flache Wellen. Wind aus dem Tal (Richtung 180°) trifft den Hang.
  const isSlope = () => cfg().scene === 'slope';
  function slopeDims() { const c = cfg(), H = clamp(+c.slopeH || 60, 10, 300), deg = clamp(+c.slopeDeg || 35, 10, 60); return { H, L: 1.5 * H / Math.tan(deg * Math.PI / 180) }; }
  const edgeX = z => 18 * Math.sin(z / 90) + 9 * Math.sin(z / 37 + 1);
  function terrainH(x, z) {
    if (!isSlope()) return 0;
    const { H, L } = slopeDims(), t = clamp((x - edgeX(z)) / L, 0, 1), sh = 1 - t * t * (3 - 2 * t);
    const back = x < edgeX(z) ? -Math.min(15, (edgeX(z) - x) * 0.02) : 0;   // Hochfläche fällt nach hinten leicht ab
    const wav = 2.5 * Math.sin(x / 53) * Math.sin(z / 71) + 1.5 * Math.sin(x / 23 + z / 41);
    return H * sh + back + (1 - sh) * wav * Math.min(1, Math.max(0, t * 3 - 1));
  }
  function terrainGrad(x, z, d) { d = d || 0.5; return [(terrainH(x + d, z) - terrainH(x - d, z)) / (2 * d), (terrainH(x, z + d) - terrainH(x, z - d)) / (2 * d)]; }
  function terrainN(x, z) { const g = terrainGrad(x, z); return norm([-g[0], 1, -g[1]]); }
  function pilotPos() { if (!isSlope()) return [0, 0, 0]; const x = edgeX(0) - 1.5; /* Pilot direkt an der Kante */ return [x, terrainH(x, 0), 0]; }

  // ---------- Simulation ----------
  const S0 = () => ({ p: [0, 2, 0], v: [0, 0, 0], R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], w: [0, 0, 0], thr: 0, crashed: null, t: 0, vario: 0, ground: false });
  let sim = S0(), keys = {}, ctl = { ail: 0, ele: 0, rud: 0, thr: 0 }, paused = false, therm = [];
  function trimSpeed() { return Math.sqrt(2 * plane.m * G / (RHO * plane.S * 0.45)); }
  function thrustMax() { const c = cfg(); if (isF3F()) return 0; return c.thrust > 0 ? c.thrust : (c.motor ? plane.m * G * 0.8 : 0); }
  function launch(mode) { const th = sim.thr; reset(mode); if (mode === 'hand') sim.thr = th; }
  function reset(mode) {
    const c = cfg(); mode = mode || 'wait'; sim = S0(); if (!plane || plane.err) return;   // Gas immer 0 zu Beginn (S0)
    const V0 = trimSpeed(), hd = (c.windDir || 0) * Math.PI / 180, pp = pilotPos();
    // Start gegen den Wind (am Hang also hinaus übers Tal)
    const f = [Math.cos(hd + Math.PI), 0, Math.sin(hd + Math.PI)], side = [-f[2], 0, f[0]];
    const R = [f, [0, 1, 0], cross(f, [0, 1, 0])];
    const onGround = q => { q[1] = terrainH(q[0], q[2]) - plane.bot + 0.03; return q; };
    if (mode === 'wait') { sim.p = add(pp, add(add(mul(side, 0.7), mul(f, 0.4)), [0, 1.5, 0])); sim.v = [0, 0, 0]; sim.R = rotAxes(R, [0, 0, 0.1], 1); sim.wait = true; }   // in der Hand des Piloten, wartet auf Leertaste/B
    else if (mode === 'ground') { sim.p = onGround(add(pp, add(mul(side, 8), mul(f, -15)))); sim.v = [0, 0, 0]; sim.R = R; }
    else if (mode === 'winch') { sim.p = add(add(pp, add(mul(side, 10), mul(f, -60))), [0, 120, 0]); sim.v = mul(f, V0 * 1.2); sim.R = R; sim.thr = 0; }
    else { sim.p = add(pp, add(mul(side, 3), [0, 2, 0])); sim.v = mul(f, V0 * 1.25); sim.R = rotAxes(R, [0, 0, 0.08], 1); }
    therm = [];
    for (let i = 0; i < 4; i++) therm.push(newTherm());
    if (mode === 'hand' || mode === 'winch') { const w = windAt(sim.p, 0); sim.v = add(sim.v, [w[0], 0, w[2]]); }   // Startfahrt gegenüber der Luft
    sim.tip = Math.random() < 0.5 ? -1 : 1;
  }
  function newTherm() { const pp = pilotPos(); return { x: pp[0] + (isSlope() ? 40 : 0) + (Math.random() - 0.5) * 500, z: (Math.random() - 0.5) * 500, r: 25 + Math.random() * 30, w: 1.5 + Math.random() * 2, life: 60 + Math.random() * 120 }; }
  function windAt(p, t) {
    const c = cfg(), hd = (c.windDir || 0) * Math.PI / 180, gH = terrainH(p[0], p[2]), h = Math.max(0, p[1] - gH);
    const prof = c.wind * Math.min(1, Math.pow((h + 0.5) / 10, 0.2));   // Grenzschicht über Grund
    // Böen: mehrere Frequenzen, ortsabhängig (Turbulenz nimmt mit der Höhe ab)
    const turb = 0.12 + 0.12 * Math.exp(-h / 30);
    const gust = 1 + turb * (Math.sin(t * 0.7 + p[0] * 0.02) * Math.sin(t * 1.3 + p[2] * 0.03) + 0.5 * Math.sin(t * 3.1 + p[0] * 0.11 + p[2] * 0.07));
    const U = [Math.cos(hd) * prof * gust, 0, Math.sin(hd) * prof * gust];
    const wv = [U[0], 0.25 * turb * c.wind * Math.sin(t * 2.3 + p[2] * 0.09) * Math.sin(t * 1.7 + p[0] * 0.05), U[2]];
    if (isSlope()) {
      // Hangaufwind: Luft folgt dem ansteigenden Gelände. Gradient großräumig gemittelt (Streuweite wächst mit der Höhe),
      // dadurch reicht das Aufwindband vor die Kante und nach oben; Abnahme mit der Höhe über Grund.
      const { H } = slopeDims(), d = 4 + 0.6 * h, Uh = Math.hypot(U[0], U[2]) || 1, sh = 0.9 * h;   // Stromlinie: über Grund zählt das Gelände luvseitig darunter
      const g = terrainGrad(p[0] - U[0] / Uh * sh, p[2] - U[2] / Uh * sh, d);
      let up = (U[0] * g[0] + U[2] * g[1]) * Math.exp(-h / (1.6 * H));
      // Lee hinter der Kante: sinkt und ist böig; über der Kante etwas schneller
      if (up < 0) up *= 1 + 0.6 * Math.abs(Math.sin(t * 2.1 + p[2] * 0.2));
      wv[0] *= 1 + 0.3 * Math.exp(-h / H) * Math.abs(g[0]); wv[2] *= 1 + 0.3 * Math.exp(-h / H) * Math.abs(g[1]);
      wv[1] += up;
    }
    if (c.thermal) for (const th of therm) {
      const dx = p[0] - th.x, dz = p[2] - th.z, d2 = (dx * dx + dz * dz) / (th.r * th.r);
      if (d2 < 4) wv[1] += th.w * Math.exp(-d2) * Math.min(1, h / 20) - (d2 > 1 ? 0.3 : 0);
    }
    return wv;
  }
  function expo(x, e) { return x * (1 - e) + x * x * x * e; }
  function readInputs(dt) {
    const c = cfg(), e = c.expo / 100, k = c.rate / 100;
    let ail = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0), ele = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0), rud = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    // Tastatur weich nachführen, damit sich das Modell steuern lässt
    const sm = (o, t) => o + clamp(t - o, -dt * 4, dt * 4);
    ctl.ail = sm(ctl.ail, ail); ctl.ele = sm(ctl.ele, ele); ctl.rud = sm(ctl.rud, rud);
    if (keys.KeyW) sim.thr = clamp(sim.thr + dt * 0.6, 0, 1);
    if (keys.KeyS) sim.thr = clamp(sim.thr - dt * 0.6, 0, 1);
    let padInfo = null;
    const gps = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    if (gps.length) {
      const gp = gps[0], P = c.pad, ax = (i, inv) => { const v = gp.axes[i]; return v === undefined ? null : (inv ? -v : v); };
      const dz = v => Math.abs(v) < 0.04 ? 0 : v;
      const a = ax(P.ail, P.invAil), el = ax(P.ele, P.invEle), r = ax(P.rud, P.invRud), th = ax(P.thr, P.invThr);
      if (a !== null && Math.abs(a) > 0.04 || padUsed) { padUsed = true; if (a !== null) ctl.ail = dz(a); if (el !== null) ctl.ele = dz(-el); if (r !== null) ctl.rud = dz(r); if (th !== null) sim.thr = clamp((th + 1) / 2, 0, 1); }
      padInfo = gp.id + ' — ' + gp.axes.map((v, i) => i + ':' + v.toFixed(2)).join('  ');
    }
    return { ail: clamp(expo(ctl.ail, e) * k, -1, 1), ele: clamp(expo(ctl.ele, e) * k, -1, 1), rud: clamp(expo(ctl.rud, e) * k, -1, 1), padInfo };
  }
  let padUsed = false;
  function step(dt, u) {
    if (sim.crashed || sim.wait) return;
    const c = cfg(), P = plane, R = sim.R, V0 = trimSpeed();
    const air = sub(sim.v, windAt(sim.p, sim.t)), Va = len(air), vb = toB(R, air);
    const qd = 0.5 * RHO * Va * Va, f = Math.min(4, (Va * Va) / (V0 * V0));
    const alpha = Math.atan2(-vb[1], Math.max(1e-3, Math.abs(vb[0]))), beta = Va > 0.5 ? Math.asin(clamp(vb[2] / Va, -1, 1)) : 0;
    const wb = sim.w, pR = wb[0], qR = wb[2], rR = -wb[1];
    // Bodeneffekt: weniger induzierter Widerstand, etwas mehr Auftriebsanstieg dicht über Grund
    const hAGL = Math.max(0.01, sim.p[1] + P.bot - terrainH(sim.p[0], sim.p[2])), ge = Math.pow(16 * hAGL / P.b, 2), geF = ge / (1 + ge);
    const CLa = 2 * Math.PI * P.AR / (P.AR + 2) * (1 + 0.08 * (1 - geF)), aS = 0.21, a0 = -0.03;
    const aa = Math.abs(alpha - a0), stalled = aa > aS;
    let CL = CLa * (alpha - a0);
    if (stalled) CL = Math.sign(alpha - a0) * CLa * aS * Math.max(0.3, 1 - (aa - aS) * 2.2);
    if (vb[0] < 0) CL *= 0.2;
    // Reynolds-Einfluss auf den Profilwiderstand (kleine Modelle/langsam → mehr Widerstand)
    const Re = Math.max(1e4, Va * P.c / 1.5e-5), cd0 = (isF3F() ? 0.016 : c.cd0) * clamp(Math.pow(1.5e5 / Re, 0.2), 0.8, 1.7);
    const CD = cd0 + CL * CL / (Math.PI * 0.8 * P.AR) * geF + (stalled ? 0.7 * Math.sin(aa) : 0) + 0.3 * beta * beta;
    let F = [0, -P.m * G, 0];
    if (Va > 0.1) {
      const vh = mul(air, 1 / Va), right = R[2];
      F = add(F, mul(norm(cross(right, vh)), qd * P.S * CL));
      F = add(F, mul(vh, -qd * P.S * CD));
      F = add(F, mul(right, -qd * P.S * 0.5 * beta));   // Seitenkraft Rumpf/Seitenleitwerk
    }
    // Schub (nimmt mit der Fahrt ab), Propellerstrahl macht Höhe/Seite auch im Stand wirksam
    const Tm = thrustMax(), Tn = Tm > 0 && sim.thr > 0 ? Tm * sim.thr * Math.max(0, 1 - Math.max(0, vb[0]) / (V0 * 3.5)) : 0;
    if (Tn > 0) F = add(F, mul(R[0], Tn));
    const wash = Tn / (P.m * G);
    // Drehbewegung — Eigenfrequenzen aus Fahrt und Größe, Stabilität aus dem Schwerpunkt (Stabilitätsmaß sigma)
    const Lr = Math.max(0.3, P.len), sigma = ((+c.npPct || 42) - (+c.cgPct || 30)) / 100;
    const wq = 0.25 * Va / Math.sqrt(P.c * Lr), kq = wq * wq * clamp(sigma / 0.1, -1, 2.5);
    const eleAuth = 0.22 * clamp(Math.sqrt(0.1 / Math.max(sigma, 0.02)), 0.5, 2.2) * (stalled ? 0.5 : 1);
    const aTrim = 0.45 / CLa + a0;
    const qdd = kq * ((aTrim + u.ele * eleAuth) - alpha) - 2 * 0.45 * wq * qR + wash * 25 * u.ele;   // sigma < 0: kq < 0 → instabil
    const pMax = 0.09 * 2 * Va / P.b * (stalled ? 0.4 : 1), lp = clamp(1.5 * Va / P.b, 1, 45);
    let pdd = lp * (u.ail * pMax - pR) - 6 * f * beta + 0.6 * f * rR;   // V-Form-Effekt, Rollmoment aus Gieren
    if (stalled && vb[0] > 0) pdd += sim.tip * 30 * f * (aa - aS);         // Abkippen über eine Fläche
    else sim.tip = beta > 0.02 ? -1 : beta < -0.02 ? 1 : sim.tip;
    const wr = 0.4 * Va / Lr;
    let rdd = wr * wr * (beta + 0.22 * u.rud * (stalled ? 0.6 : 1)) - 2 * 0.3 * wr * rR - 1.2 * f * u.ail * pMax + wash * 20 * u.rud;   // Windfahne, Dämpfung, negatives Wendemoment
    if (sim.ground) { const gs = Math.min(1, len(sim.v) / 3); rdd += 8 * (u.rud * 0.8 * gs - rR); pdd -= 15 * pR; }
    sim.w = [pR + pdd * dt, wb[1] - rdd * dt, qR + qdd * dt];
    // Translation
    sim.v = add(sim.v, mul(F, dt / P.m));
    sim.p = add(sim.p, mul(sim.v, dt));
    sim.R = rotAxes(R, sim.w, dt);
    sim.vario = sim.vario * 0.98 + sim.v[1] * 0.02;
    sim.t += dt; sim.stalled = stalled; sim.agl = hAGL;
    ground(dt, V0);
  }
  function ground(dt, V0) {
    const lo = lowestPoint(); if (lo.d >= 0) { sim.ground = false; return; }
    const n = terrainN(lo.q[0], lo.q[2]), vn = dot(sim.v, n), up = dot(sim.R[1], n);
    if (vn < -Math.max(2.5, V0 * 0.4) || up < 0.55 || len(sim.v) > V0 * 2.2 || lo.tip) {
      sim.crashed = vn < -4 || len(sim.v) > V0 * 2.2 ? T('Absturz!') : T('Bruchlandung!'); sim.v = [0, 0, 0]; sim.w = [0, 0, 0]; return;
    }
    sim.p = add(sim.p, mul(n, -lo.d / Math.max(0.3, n[1])));
    if (vn < 0) sim.v = sub(sim.v, mul(n, vn));
    // Reibung entlang des Bodens (Rad rollt mit Motor, Kufe/Rumpf rutscht)
    const fr = Math.exp(-dt * (sim.thr > 0.05 ? 0.15 : 0.9)), vnn = dot(sim.v, n), vt = sub(sim.v, mul(n, vnn));
    sim.v = add(mul(n, vnn), mul(vt, fr));
    // Nase nicht unter den Boden
    const nd = dot(sim.R[0], n);
    sim.w = [sim.w[0] * 0.9, sim.w[1], sim.w[2] * 0.95 + (nd < -0.02 ? 0.5 * dt * 60 * -nd : 0)];
    sim.ground = true;
  }
  function lowestPoint() {
    // Tiefster Punkt über Grund: Rumpfboden, Nase, Heck, Flügelspitzen (Spitze bei Fahrt im Boden = Bruch)
    const R = sim.R, pts = [[0, plane.bot, 0, 0], [plane.len * 0.45, plane.bot * 0.6, 0, 0], [-plane.len * 0.5, plane.bot * 0.4, 0, 0], [0, 0, plane.b / 2, 1], [0, 0, -plane.b / 2, 1]];
    let best = { d: Infinity };
    pts.forEach(q => { const w = add(sim.p, toW(R, q)), d = w[1] - terrainH(w[0], w[2]); if (d < best.d) best = { d, q: w, tip: !!q[3] && len(sim.v) > trimSpeed() * 0.5 && d < -0.02 }; });
    return best;
  }
  // ---------- Darstellung ----------
  let win = null, cv = null, hud = null, msg = null, gl = null, prog = null, gprog = null, draws = [], world = [], texs = [], raf = 0, last = 0;
  const VS = '#version 300 es\nin vec3 aP;in vec3 aN;in vec3 aC;in vec2 aT;uniform mat4 uVP;uniform mat4 uM;uniform vec4 uTM;uniform float uShadow;uniform float uGY;out vec3 vN;out vec3 vC;out vec2 vT;out vec3 vW;void main(){vec4 w=uM*vec4(aP,1.0);if(uShadow>0.5){w.y=uGY;}vW=w.xyz;vN=mat3(uM)*aN;vC=aC;vT=vec2((aT.x-uTM.x)*uTM.z,(aT.y-uTM.y)*uTM.w);gl_Position=uVP*w;}';
  const FS = '#version 300 es\nprecision highp float;in vec3 vN;in vec3 vC;in vec2 vT;in vec3 vW;uniform sampler2D uTex;uniform float uUse;uniform float uShadow;uniform vec3 uEye;uniform vec3 uFog;out vec4 o;void main(){if(uShadow>0.5){o=vec4(0.0,0.0,0.0,0.35);return;}vec3 n=normalize(vN);vec3 L=normalize(vec3(0.35,0.85,0.25));float d=max(dot(n,L),0.0)*0.7+abs(dot(n,L))*0.15;vec4 t=texture(uTex,vT);vec3 c=mix(vC,t.rgb,t.a*uUse);vec3 col=c*(0.38+0.75*d);float f=1.0-exp(-length(vW-uEye)/900.0);o=vec4(mix(col,uFog,f),1.0);}';
  // Boden: prozedurales Gras, Mähstreifen, Piste
  const GVS = '#version 300 es\nin vec3 aP;in vec3 aN;uniform mat4 uVP;out vec3 vW;out vec3 vN;void main(){vW=aP;vN=aN;gl_Position=uVP*vec4(vW,1.0);}';
  const GFS = '#version 300 es\nprecision highp float;in vec3 vW;in vec3 vN;uniform vec3 uEye;uniform float uRwy;uniform vec3 uFog;out vec4 o;float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}void main(){vec2 p=vW.xz;float g=n(p*0.05)*0.5+n(p*0.4)*0.3+n(p*3.0)*0.2;vec3 c=mix(vec3(0.22,0.38,0.14),vec3(0.36,0.52,0.20),g);float s=step(0.5,fract(p.x/12.0));c*=0.94+0.06*s;vec3 n=normalize(vN);float st=1.0-n.y;c=mix(c,vec3(0.40,0.36,0.28),smoothstep(0.25,0.6,st)*0.7);c*=0.55+0.5*max(dot(n,normalize(vec3(0.35,0.85,0.25))),0.0);if(uRwy>0.5&&abs(p.y)<4.0&&abs(p.x)<60.0){c=mix(vec3(0.42,0.50,0.30),c,0.35);if(abs(abs(p.y)-3.8)<0.12)c=vec3(0.85);}float f=1.0-exp(-length(vW-uEye)/700.0);o=vec4(mix(c,uFog,f),1.0);}';
  const FOG = [0.70, 0.80, 0.90];
  function build() {
    const host = document.getElementById('fsimView');
    win = document.createElement('div'); win.style.cssText = 'position:absolute;inset:0;outline:none'; win.tabIndex = 0;
    cv = document.createElement('canvas'); cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;background:linear-gradient(#5d8fd0,#b9d3ee)';
    hud = document.createElement('div'); hud.className = 'simlegend'; hud.style.cssText = 'left:10px;right:auto;top:10px;max-width:520px;z-index:3;display:block;font-family:monospace';
    msg = document.createElement('div'); msg.style.cssText = 'position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);font:bold 34px sans-serif;color:#fff;text-shadow:0 2px 6px #000;z-index:4;pointer-events:none;text-align:center';
    const bar = document.createElement('div'); bar.className = 'simbar'; bar.style.cssText = 'position:absolute;left:0;right:0;bottom:0;z-index:4';
    const btn = (t, tt, fn, pr) => { const b = document.createElement('button'); b.textContent = T(t); b.title = T(tt); b.onclick = () => { fn(); win.focus(); }; if (pr) b.className = 'primary'; bar.appendChild(b); return b; };
    btn('↺ Neu starten (R)', 'Flugzeug wieder an den Start setzen', () => reset(), true);
    btn('Handstart (Leertaste)', 'Aus der Hand werfen', () => launch('hand'));
    btn('Hochstart', 'Seilende in 120 m Höhe', () => launch('winch'));
    btn('Bodenstart (B)', 'Auf den Boden stellen, dann mit W Gas geben', () => launch('ground'));
    btn('Kamera (C)', 'Zwischen Pilotensicht am Boden und Verfolgerkamera wechseln', () => toggleCam());
    btn('Flugzeug neu laden', 'Flugzeug neu aus „Flugzeug gesamt“ übernehmen (nach Änderungen)', () => { loadAndUpload(); reset(); });
    // Gasanzeige links unten (wie Gasknüppel am Sender)
    thrBox = document.createElement('div'); thrBox.style.cssText = 'position:absolute;left:12px;bottom:52px;z-index:3;width:44px;padding:6px 0 4px;border-radius:8px;background:rgba(10,14,20,.65);color:#fff;font:11px sans-serif;text-align:center;pointer-events:none';
    thrBox.innerHTML = '<div>' + T('Gas') + '</div><div style="position:relative;width:14px;height:110px;margin:4px auto;border:1px solid rgba(255,255,255,.5);border-radius:3px;overflow:hidden"><div class="fsThr" style="position:absolute;left:0;right:0;bottom:0;height:0;background:linear-gradient(#ff7a3c,#ffd25a)"></div></div><div class="fsThrT" style="font:bold 12px monospace">0 %</div>';
    win.append(cv, hud, msg, thrBox, bar); host.appendChild(win);
    gl = cv.getContext('webgl2', { antialias: true, alpha: true, depth: true });
    if (!gl) { hud.textContent = T('WebGL2 nicht verfügbar.'); return; }
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(o)); return o; };
    const pg = (v, f) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, v)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, f)); gl.linkProgram(p); return p; };
    prog = pg(VS, FS); gprog = pg(GVS, GFS);
    const kd = e => {
      if (state.activeTab !== 'fsim') return;
      // Steuertasten gehören dem Flug: hat eine Auswahlliste/ein Häkchen der Seitenleiste noch den Fokus, würden die
      // Pfeiltasten dort den Wert ändern (z. B. Gelände Hang → Flugplatz). Fokus zurück aufs Flugbild.
      const tg = e.target, tn = (tg && tg.tagName) || '', fly = /^(Arrow|Key[ADWSRCPB]$|Space$)/.test(e.code);
      if (fly && (tn === 'SELECT' || (tn === 'INPUT' && /checkbox|radio|color|range/.test(tg.type)) || tn === 'BUTTON')) { e.preventDefault(); tg.blur(); win.focus(); }
      else if (/INPUT|SELECT|TEXTAREA/.test(tn)) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyB', 'Space'].includes(e.code)) { e.preventDefault(); padUsed = false; }
      if (e.type === 'keydown') {
        if (e.code === 'KeyR' && !e.ctrlKey) reset();
        if (e.code === 'KeyC' && !e.ctrlKey) toggleCam();
        if (e.code === 'KeyP' || e.code === 'Escape') paused = !paused;
        if (e.code === 'Space' && !e.repeat && (sim.wait || sim.crashed)) launch('hand');
        if (e.code === 'KeyB' && !e.repeat && (sim.wait || sim.crashed)) launch('ground');
      }
      keys[e.code] = e.type === 'keydown';
    };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', kd);
    window.addEventListener('blur', () => { keys = {}; });
    cv.addEventListener('mousedown', () => win.focus());
    cv.addEventListener('wheel', e => { e.preventDefault(); zoomK = clamp(zoomK * Math.exp(e.deltaY * 0.001), 0.3, 4); }, { passive: false });
    buildWorld();
  }
  let zoomK = 1, thrBox = null;
  function toggleCam() { const c = cfg(); c.cam = c.cam === 'pilot' ? 'chase' : 'pilot'; }
  function vao(arrs, idx) {
    const v = gl.createVertexArray(); gl.bindVertexArray(v); const bufs = [];
    arrs.forEach(([p, nm, data, sz]) => { const l = gl.getAttribLocation(p, nm); if (l < 0) return; const b = gl.createBuffer(); bufs.push(b); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, sz, gl.FLOAT, false, 0, 0); });
    if (idx) { const b = gl.createBuffer(); bufs.push(b); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW); }
    return { vao: v, bufs };
  }
  function normals(P, I) {
    const N = new Float32Array(P.length);
    for (let k = 0; k < I.length; k += 3) {
      const a = 3 * I[k], b = 3 * I[k + 1], c = 3 * I[k + 2], ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const q of [a, b, c]) { N[q] += nx; N[q + 1] += ny; N[q + 2] += nz; }
    }
    return N;
  }
  // Landschaft: Bäume (Kegel + Stamm) und Waldrand als Bezug für Höhe und Entfernung
  function buildWorld() {
    world.forEach(o => gl.deleteVertexArray(o.vao)); world.length = 0;
    const P = [], C = [], I = [];
    const cone = (x, z, h, r, col, y0) => {
      const n = 8, base = P.length / 3;
      P.push(x, y0 + h, z); C.push(col[0] * 1.15, col[1] * 1.15, col[2] * 1.15);
      for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI; P.push(x + r * Math.cos(a), y0, z + r * Math.sin(a)); C.push(col[0], col[1], col[2]); }
      for (let i = 0; i < n; i++) I.push(base, base + 1 + (i + 1) % n, base + 1 + i);
    };
    let sd = 7; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    const pp = pilotPos(), slope = isSlope();
    const tree = (x, z, s) => { const y = terrainH(x, z) - 0.3; cone(x, z, 1.5 * s, 0.25 * s, [0.35, 0.25, 0.15], y); cone(x, z, 6 * s, 2.2 * s, [0.12 + rnd() * 0.06, 0.30 + rnd() * 0.1, 0.12], y + 1.0 * s); };
    for (let i = 0; i < 300; i++) { const a = rnd() * 2 * Math.PI, r = 160 + rnd() * 450, x = pp[0] + Math.cos(a) * r, z = Math.sin(a) * r;
      if (slope && Math.abs(x - edgeX(z)) < 25) continue; tree(x, z, 0.8 + rnd() * 1.2); }
    for (let i = 0; i < 25; i++) tree(pp[0] + (slope ? -45 - rnd() * 40 : -40 + rnd() * 80), slope ? -60 + rnd() * 120 : 35 + rnd() * 30, 0.7 + rnd() * 0.6);
    // Hügel am Horizont
    for (let i = 0; i < 40; i++) { const a = i / 40 * 2 * Math.PI + rnd() * 0.1, r = 1400 + rnd() * 300, x = Math.cos(a) * r, z = Math.sin(a) * r; cone(x, z, 80 + rnd() * 160, 300 + rnd() * 200, [0.30, 0.42, 0.30], terrainH(x, z) - 5); }
    // Pilotenmarke: Stange mit Fähnchen
    const pf = P.length / 3, fx = pp[0] + 0.6, fy = pp[1]; P.push(fx, fy, 0.6, fx + 0.05, fy, 0.6, fx + 0.05, fy + 2.5, 0.6, fx, fy + 2.5, 0.6); for (let i = 0; i < 4; i++) C.push(0.9, 0.9, 0.9); I.push(pf, pf + 1, pf + 2, pf, pf + 2, pf + 3);
    const Pa = new Float32Array(P), Ia = new Uint32Array(I);
    const o = vao([[prog, 'aP', Pa, 3], [prog, 'aN', normals(Pa, Ia), 3], [prog, 'aC', new Float32Array(C), 3], [prog, 'aT', new Float32Array(P.length / 3 * 2), 2]], Ia);
    world.push({ vao: o.vao, n: Ia.length });
    // Boden: Gitter, in der Mitte fein (Hangkante), außen grob
    const N = 240, GS = 3200, cs = [];
    for (let i = 0; i <= N; i++) { const s2 = i / N * 2 - 1; cs.push(Math.sign(s2) * Math.pow(Math.abs(s2), 1.8) * GS); }
    const gp = new Float32Array((N + 1) * (N + 1) * 3), gn = new Float32Array(gp.length), gi = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = cs[i] + pp[0], z = cs[j], k = 3 * (i * (N + 1) + j), nn = terrainN(x, z);
      gp[k] = x; gp[k + 1] = terrainH(x, z); gp[k + 2] = z; gn[k] = nn[0]; gn[k + 1] = nn[1]; gn[k + 2] = nn[2];
      if (i < N && j < N) { const a = i * (N + 1) + j, b = a + 1, c2 = a + N + 1, d = c2 + 1; gi.push(a, c2, b, b, c2, d); }
    }
    const g = vao([[gprog, 'aP', gp, 3], [gprog, 'aN', gn, 3]], new Uint32Array(gi));
    world.ground = g.vao; world.groundN = gi.length; world.scene = sceneKey();
  }
  function sceneKey() { const d = slopeDims(); return cfg().scene + '/' + d.H + '/' + d.L; }
  function loadAndUpload() {
    draws.forEach(d => { gl.deleteVertexArray(d.vao); }); draws = [];
    texs.forEach(t => gl.deleteTexture(t)); texs = [];
    plane = loadPlane();
    if (plane.err) return;
    const tx = {};
    for (const k in plane.tex) {
      const t = gl.createTexture(); texs.push(t); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, plane.tex[k].canvas); gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      tx[k] = { t, m: plane.tex[k].m };
    }
    plane.meshes.forEach(m => {
      const I = Uint32Array.from(m.I), byG = {};
      for (let k = 0; k < m.G.length; k++) (byG[m.G[k]] = byG[m.G[k]] || []).push(I[3 * k], I[3 * k + 1], I[3 * k + 2]);
      const all = [], parts = []; for (const g in byG) { parts.push({ g: +g, off: all.length * 4, n: byG[g].length }); for (const v of byG[g]) all.push(v); }
      const o = vao([[prog, 'aP', m.P, 3], [prog, 'aN', normals(m.P, I), 3], [prog, 'aC', new Float32Array(m.C), 3], [prog, 'aT', new Float32Array(m.U), 2]], new Uint32Array(all));
      parts.forEach(p => { const t = m.tex === 'fus' ? tx.fus : p.g === 2 ? tx[m.tex + 'top'] : p.g === 3 ? tx[m.tex + 'bot'] : null; draws.push({ vao: o.vao, off: p.off, n: p.n, tex: t }); });
    });
  }
  let camPos = [0, 1.7, 0];
  function camera() {
    const c = cfg(), r = cv.getBoundingClientRect(), asp = r.width / Math.max(1, r.height);
    let eye, look, fov;
    if (c.cam === 'chase') {
      const back = Math.max(3, plane.b * 2.2) * zoomK, hv = [sim.v[0], 0, sim.v[2]], hd = len(hv) > 1 ? norm(hv) : norm([sim.R[0][0], 0, sim.R[0][2]]);
      const want = add(sim.p, add(mul(hd, -back), [0, back * 0.3, 0]));
      camPos = add(camPos, mul(sub(want, camPos), 0.08)); const gy = terrainH(camPos[0], camPos[2]) + 0.8; if (camPos[1] < gy) camPos[1] = gy;
      eye = camPos; look = sim.p; fov = 55 * Math.PI / 180;
    } else {
      eye = add(pilotPos(), [0, 1.7, 0]); look = sim.p;
      const d = len(sub(sim.p, eye));   // Pilot: Blickfeld so, dass das Modell gut erkennbar bleibt (wie ein Auge, das „heranholt“)
      fov = clamp(2 * Math.atan(plane.b * 6 * zoomK / Math.max(1, d)), 12 * Math.PI / 180, 70 * Math.PI / 180);
    }
    if (Math.abs(norm(sub(look, eye))[1]) > 0.995) look = add(look, [0.01, 0, 0]);
    return { vp: mm(persp(fov, asp, 0.1, 6000), lookAt(eye, look, [0, 1, 0])), eye };
  }
  function draw() {
    const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect(), w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    if (!plane || plane.err) return;
    if (world.scene !== sceneKey()) buildWorld();
    const { vp, eye } = camera();
    gl.useProgram(gprog);
    gl.uniformMatrix4fv(gl.getUniformLocation(gprog, 'uVP'), false, vp); gl.uniform3fv(gl.getUniformLocation(gprog, 'uEye'), eye); gl.uniform3fv(gl.getUniformLocation(gprog, 'uFog'), FOG);
    gl.uniform1f(gl.getUniformLocation(gprog, 'uRwy'), isSlope() ? 0 : 1);
    gl.bindVertexArray(world.ground); gl.drawElements(gl.TRIANGLES, world.groundN, gl.UNSIGNED_INT, 0);
    gl.useProgram(prog);
    const U = n => gl.getUniformLocation(prog, n);
    gl.uniformMatrix4fv(U('uVP'), false, vp); gl.uniform3fv(U('uEye'), eye); gl.uniform3fv(U('uFog'), FOG);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(U('uTex'), 0);
    if (!texs._none) { texs._none = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texs._none); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); }
    // Welt
    gl.uniform1f(U('uShadow'), 0); gl.uniform1f(U('uUse'), 0); gl.uniform4f(U('uTM'), 0, 0, 1, 1); gl.bindTexture(gl.TEXTURE_2D, texs._none);
    gl.uniformMatrix4fv(U('uM'), false, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    world.forEach(o => { gl.bindVertexArray(o.vao); gl.drawElements(gl.TRIANGLES, o.n, gl.UNSIGNED_INT, 0); });
    // Flugzeug + Schatten
    gl.uniformMatrix4fv(U('uM'), false, modelMat(sim.R, sim.p));
    const drawPlane = shadow => draws.forEach(d => {
      gl.bindVertexArray(d.vao);
      if (!shadow) { gl.bindTexture(gl.TEXTURE_2D, d.tex ? d.tex.t : texs._none); gl.uniform1f(U('uUse'), d.tex ? 1 : 0); const m = d.tex ? d.tex.m : [0, 0, 1, 1]; gl.uniform4f(U('uTM'), m[0], m[1], m[2], m[3]); }
      gl.drawElements(gl.TRIANGLES, d.n, gl.UNSIGNED_INT, d.off);
    });
    drawPlane(false);
    gl.uniform1f(U('uGY'), terrainH(sim.p[0], sim.p[2]) + 0.06);
    if (sim.p[1] - terrainH(sim.p[0], sim.p[2]) < 150) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.uniform1f(U('uShadow'), 1); drawPlane(true); gl.uniform1f(U('uShadow'), 0); gl.depthMask(true); gl.disable(gl.BLEND); }
  }
  function showHud(u) {
    if (!plane || plane.err) { hud.innerHTML = '<b>' + T('Flugsimulator') + '</b><br><span style="color:#e0a040">⚠ ' + ((plane && plane.err) || '') + '</span>'; msg.textContent = ''; return; }
    const V = len(sim.v), dist = Math.hypot(sim.p[0], sim.p[2]), f1 = v => v.toFixed(1);
    const pitch = Math.asin(clamp(sim.R[0][1], -1, 1)) * 180 / Math.PI, bank = Math.atan2(-sim.R[2][1], sim.R[1][1]) * 180 / Math.PI;
    let s = '<b>' + T('Flugsimulator') + '</b> — ' + (cfg().cam === 'pilot' ? T('Pilotensicht') : T('Verfolgerkamera')) + (paused ? ' · ' + T('PAUSE') : '') +
      '<br>' + T('Fahrt') + ' ' + f1(V * 3.6) + ' km/h · ' + T('Höhe über Grund') + ' ' + f1(Math.max(0, sim.p[1] - terrainH(sim.p[0], sim.p[2]))) + ' m' + (isSlope() ? ' (' + T('über Pilot') + ' ' + f1(sim.p[1] - pilotPos()[1]) + ' m)' : '') + ' · ' + T('Steigen') + ' ' + (sim.vario >= 0 ? '+' : '') + f1(sim.vario) + ' m/s · ' + T('Entfernung') + ' ' + Math.round(dist) + ' m' +
      '<br>' + T('Gas') + ' ' + Math.round(sim.thr * 100) + ' % · ' + T('Längsneigung') + ' ' + Math.round(pitch) + '° · ' + T('Querlage') + ' ' + Math.round(bank) + '°' + (sim.stalled ? ' · <b style="color:#ff7050">' + T('Strömungsabriss') + '</b>' : '') +
      '<br><span style="opacity:.75">' + T('Modell') + ': ' + T('Spannweite') + ' ' + f1(plane.b * 1000) + ' mm · ' + T('Masse') + ' ' + Math.round(plane.m * 1000) + ' g · ' + T('Flächenbelastung') + ' ' + f1(plane.m * 1000 / (plane.S * 100)) + ' g/dm² · v₀ ' + f1(trimSpeed() * 3.6) + ' km/h</span>' +
      '<br><span style="opacity:.75">' + T('Pfeiltasten = Höhe/Quer · A/D = Seite · W/S = Gas · Leertaste = Handstart · B = Bodenstart · R = neu · C = Kamera · P = Pause · Rad = Zoom') + '</span>';
    if (u.padInfo) s += '<br><span style="opacity:.6;font-size:11px">🎮 ' + u.padInfo + '</span>';
    hud.innerHTML = s;
    msg.textContent = sim.crashed ? sim.crashed + ' — ' + T('Leertaste = Handstart · B = Bodenstart') : paused ? T('Pause') : sim.wait ? T('Leertaste = Handstart · B = Bodenstart') : '';
  }
  function frame(ts) {
    raf = 0;
    if (state.activeTab !== 'fsim' || !win || !win.isConnected) return;
    const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0); last = ts;
    let u = { ail: 0, ele: 0, rud: 0 };
    if (plane && !plane.err) {
      u = readInputs(dt);
      if (!paused) { const n = Math.max(1, Math.ceil(dt / 0.004)); for (let i = 0; i < n; i++) step(dt / n, u); }
      therm.forEach(th => { th.life -= dt; th.x += Math.cos((cfg().windDir || 0) * Math.PI / 180) * cfg().wind * dt; if (th.life < 0) Object.assign(th, newTherm()); });
    }
    draw(); showHud(u);
    if (thrBox) { const m = thrustMax() > 0; thrBox.style.display = m ? '' : 'none'; if (m) { const pc = Math.round(sim.thr * 100); thrBox.querySelector('.fsThr').style.height = pc + '%'; thrBox.querySelector('.fsThrT').textContent = pc + ' %'; } }
    if (ts - lsT > 2000) { lsT = ts; saveLs(); }
    raf = requestAnimationFrame(frame);
  }
  function show() {
    if (!win) build();
    if (!gl) return;
    loadAndUpload(); reset(); last = 0; paused = false;
    if (!raf) raf = requestAnimationFrame(frame);
    setTimeout(() => win.focus(), 0);
  }

  // ---------- Seitenleiste ----------
  function fsimSidebar(side) {
    const { grp, hint, numRow, boolRow, selectRow } = App;
    const c = cfg(), NR = { norender: true, enter: true }, RB = () => App.buildSidebar();
    const g0 = grp('Flugsimulator', true, 'fsim', { key: 'fsimMain', alwaysOpen: true });
    selectRow(g0.body, 'Flugzeug', [['f3f', 'F3F-Hangrennsegler (Standard)'], ['own', 'Eigenes Flugzeug (Flugzeug gesamt)']], () => c.plane, v => { c.plane = v; saveLs(); RB(); if (gl) { loadAndUpload(); reset(); } });
    if (c.plane === 'own') hint(g0.body, 'Fliegt das Flugzeug aus „Flugzeug gesamt“ wie ein Modellflugzeug. Fläche und Streckung kommen aus der Haupttragfläche; Masse aus der Flächenbelastung oder fest. Fernsteuerung: Sender per USB anstecken (meldet sich als Joystick) und einen Knüppel bewegen.');
    else hint(g0.body, 'Eingebauter F3F-Hangrennsegler: 2,95 m Spannweite, rund 60 dm², V-Leitwerk, ohne Motor — ideal für den Hang. Fernsteuerung: Sender per USB anstecken (meldet sich als Joystick) und einen Knüppel bewegen.');
    if (c.plane === 'own') numRow(g0.body, 'Flächenbelastung (g/dm²)', () => c.load, v => { c.load = clamp(v, 5, 200); reloadPhys(); }, Object.assign({ step: 1, min: 5 }, NR));
    else numRow(g0.body, 'Flächenbelastung (g/dm²)', () => c.loadF3f, v => { c.loadF3f = clamp(v, 5, 200); reloadPhys(); }, Object.assign({ step: 1, min: 5 }, NR));
    numRow(g0.body, 'Masse fest (g, 0 = aus Belastung)', () => c.mass, v => { c.mass = Math.max(0, v); reloadPhys(); }, Object.assign({ step: 10, min: 0 }, NR));
    numRow(g0.body, 'Schwerpunkt (% Bezugsflügeltiefe)', () => c.cgPct, v => { c.cgPct = clamp(v, 0, 60); }, Object.assign({ step: 1 }, NR));
    numRow(g0.body, 'Neutralpunkt (% Bezugsflügeltiefe)', () => c.npPct, v => { c.npPct = clamp(v, 10, 80); }, Object.assign({ step: 1 }, NR));
    hint(g0.body, 'Stabilitätsmaß = Neutralpunkt − Schwerpunkt. Um 10 % fliegt es ruhig; kleiner wird es nervös und das Höhenruder wirkt stärker, liegt der Schwerpunkt hinter dem Neutralpunkt, ist das Modell instabil.');
    if (c.plane === 'own') numRow(g0.body, 'Nullwiderstand cW₀', () => c.cd0, v => { c.cd0 = clamp(v, 0.005, 0.3); }, Object.assign({ step: 0.005 }, NR));
    if (c.plane === 'own') boolRow(g0.body, 'Motor', () => c.motor, v => { c.motor = v; RB(); });
    if (c.plane === 'own' && c.motor) numRow(g0.body, 'Standschub (N, 0 = automatisch)', () => c.thrust, v => { c.thrust = Math.max(0, v); }, Object.assign({ step: 0.5, min: 0 }, NR));
    selectRow(g0.body, 'Kamera', [['pilot', 'Pilot am Boden'], ['chase', 'Verfolgerkamera']], () => c.cam, v => { c.cam = v; });
    side.appendChild(g0.g);
    const gL = grp('Landschaft', true, 'fsim', { key: 'fsimScene' });
    selectRow(gL.body, 'Gelände', [['flat', 'Flugplatz (eben)'], ['slope', 'Hang zum Hangfliegen']], () => c.scene, v => { c.scene = v; if (v === 'slope') { c.windDir = 180; if (c.wind < 5) c.wind = 7; } saveLs(); RB(); reset(); });
    if (c.scene === 'slope') {
      hint(gL.body, 'Der Pilot steht an der Hangkante, der Wind weht aus dem Tal (180°) gegen den Hang. Vor und über der Kante steigt die Luft — dort mit dem Segler hin- und herfliegen, Wenden immer vom Hang weg. Hinter der Kante (Lee) sinkt es und ist böig.');
      numRow(gL.body, 'Hanghöhe (m)', () => c.slopeH, v => { c.slopeH = clamp(v, 10, 300); reset(); }, Object.assign({ step: 5 }, NR));
      numRow(gL.body, 'Hangneigung (°)', () => c.slopeDeg, v => { c.slopeDeg = clamp(v, 10, 60); reset(); }, Object.assign({ step: 5 }, NR));
    }
    side.appendChild(gL.g);
    const g1 = grp('Wetter', false, 'fsim', { key: 'fsimWx' });
    numRow(g1.body, 'Wind (m/s)', () => c.wind, v => { c.wind = clamp(v, 0, 20); }, Object.assign({ step: 0.5, min: 0 }, NR));
    numRow(g1.body, 'Windrichtung (°)', () => c.windDir, v => { c.windDir = ((v % 360) + 360) % 360; }, Object.assign({ step: 15 }, NR));
    boolRow(g1.body, 'Thermik', () => c.thermal, v => { c.thermal = v; }, 'Einige unsichtbare Aufwindblasen, die mit dem Wind wandern.');
    side.appendChild(g1.g);
    const g2 = grp('Steuerung', false, 'fsim', { key: 'fsimCtl' });
    numRow(g2.body, 'Ruderausschlag (%)', () => c.rate, v => { c.rate = clamp(v, 20, 150); }, Object.assign({ step: 5 }, NR));
    numRow(g2.body, 'Expo (%)', () => c.expo, v => { c.expo = clamp(v, 0, 100); }, Object.assign({ step: 5 }, NR));
    hint(g2.body, 'Achsen der Fernsteuerung (Nummern siehe unten im Bild, wenn ein Sender angesteckt ist).');
    const axes = [0, 1, 2, 3, 4, 5, 6, 7].map(i => [String(i), T('Achse') + ' ' + i]);
    [['ail', 'invAil', 'Querruder'], ['ele', 'invEle', 'Höhenruder'], ['rud', 'invRud', 'Seitenruder'], ['thr', 'invThr', 'Gas']].forEach(([k, inv, lab]) => {
      selectRow(g2.body, lab, axes, () => String(c.pad[k]), v => { c.pad[k] = +v; });
      boolRow(g2.body, lab + ' ' + T('umkehren'), () => !!c.pad[inv], v => { c.pad[inv] = v; });
    });
    side.appendChild(g2.g);
  }
  function reloadPhys() { if (plane && !plane.err) plane.m = massOf(plane.S); }

  App.fsimSidebar = fsimSidebar;
  window.Flugsim = { show, reset, _test: { terrainH, windAt, pilotPos, cfg, sim: () => sim, plane: () => plane, step, loadPlane, keys: () => keys } };
})();
