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

  // Ausschlag/Expo je Ruder (rateAil … expoRud). pad: Achsenzuordnung, Umkehr, Totzone (%), Kalibrierung je Gerät
  // (cal[gamepad.id][Achse] = { lo, mid, hi }), dev = gewählter Sender. Vorzeichen der Funktionen: + = Quer rechts,
  // Höhe gezogen (Nase hoch), Seite rechts, Vollgas. v: 2 = Höhe ohne die frühere doppelte Verneinung.
  const DEF = { mass: 0, load: 35, motor: true, thrust: 0, cd0: 0.03, rateAil: 100, rateEle: 100, rateRud: 100, expoAil: 30, expoEle: 30, expoRud: 30, wind: 2, windDir: 0, thermal: true,
    cam: 'pilot', start: 'hand', cgPct: 30, npPct: 42, scene: 'flat', plane: 'f3f', loadF3f: 40, loadSu26: 68, fgScale: {}, fgLoad: {}, sound: true, vol: 60, slopeH: 60, slopeDeg: 35, alpH: 700, alpDeg: 40, quality: 'mittel',
    pad: { dev: '', ail: 0, ele: 1, rud: 2, thr: 3, invAil: false, invEle: false, invRud: false, invThr: true, dz: 4, cal: {}, v: 2 } };
  const LS_KEY = 'hw_fsim_cfg'; let lsLast = '', lsT = 0;
  function saveLs() { try { const j = JSON.stringify(cfg()); if (j !== lsLast) { localStorage.setItem(LS_KEY, j); lsLast = j; } } catch (e) {} }
  // Eigenes Objekt, NICHT in state.cfg: Laden von Projekt/Einstellungen oder Rückgängig ersetzt state.cfg und
  // setzte so das Gelände mitten im Flug auf „Flugplatz“ zurück. Simulator-Werte sind Vorlieben des Piloten.
  let C = null;
  function cfg() {
    if (!C) { try { const t = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (t && typeof t === 'object') C = t; } catch (e) {} }
    if (!C) C = JSON.parse(JSON.stringify(DEF));
    const c = C;
    // Altstand: ein Ausschlag/Expo für alle Ruder → auf jedes Ruder übernehmen
    if (c.rate !== undefined || c.expo !== undefined) {
      ['Ail', 'Ele', 'Rud'].forEach(s => { if (c['rate' + s] === undefined && c.rate !== undefined) c['rate' + s] = c.rate; if (c['expo' + s] === undefined && c.expo !== undefined) c['expo' + s] = c.expo; });
      delete c.rate; delete c.expo;
    }
    // Altstand: selbst gebaute LS3-17/Kobuz (2026-11-26 durch FlightGear-Modelle ersetzt)
    if (c.plane === 'ls3') c.plane = 'ls4'; if (c.plane === 'kobuz') c.plane = 'ask21'; delete c.loadLs3; delete c.loadKob;
    if (!c.pad || typeof c.pad !== 'object') c.pad = JSON.parse(JSON.stringify(DEF.pad));
    // Altstand: Höhe wurde zweimal verneint (invEle = true war „normal“) → heute + = gezogen ohne Umkehr
    if (c.pad.v === undefined) { c.pad.invEle = c.pad.invEle === undefined ? false : !c.pad.invEle; c.pad.v = 2; }
    for (const k in DEF) if (c[k] === undefined) c[k] = JSON.parse(JSON.stringify(DEF[k]));
    for (const k in DEF.pad) if (c.pad[k] === undefined) c.pad[k] = JSON.parse(JSON.stringify(DEF.pad[k]));
    ['fgScale', 'fgLoad'].forEach(k => { if (!c[k] || typeof c[k] !== 'object') c[k] = {}; });
    if (!c.pad.cal || typeof c.pad.cal !== 'object') c.pad.cal = {};
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
  const isF3F = () => cfg().plane === 'f3f';
  const isSu26 = () => cfg().plane === 'su26';
  const isBuiltin = () => cfg().plane !== 'own';
  function massOf(S) { const c = cfg(); return c.mass > 0 ? c.mass / 1000 : (isF3F() ? c.loadF3f : isSu26() ? c.loadSu26 : isFg() ? fgLoad(c.plane) : c.load) * (S * 100) / 1000; }   // g/dm² × dm²
  function loadPlane() { return isF3F() ? buildF3F() : isSu26() ? buildSu26() : isFg() ? buildFg(cfg().plane) : loadOwn(); }

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

  // ---------- Kunstflug-Motormodell: Sukhoi Su-26M, Maßstab 1:3 ----------
  // Original 7,80 m / 11,8 m² / 6,83 m lang → 2,60 m, ~1,3 m², 2,28 m. Trapezflügel tief angesetzt, symmetrisches Profil
  // (NACA 0018 → 0012), runde Sternmotor-Haube, Federstahlfahrwerk mit Spornrad, 2-Blatt-Propeller.
  function buildSu26() {
    const c = cfg(), meshes = [];
    const mk = () => ({ P: [], C: [], U: [], I: [], G: [] });
    const v = (m, p, col) => { m.P.push(p[0], p[1], p[2]); m.C.push(col[0], col[1], col[2]); m.U.push(0, 0); return m.P.length / 3 - 1; };
    const q = (m, a, b, cc, d) => { m.I.push(a, b, d, a, d, cc); m.G.push(0, 0); };
    const fan = (m, ring, col, flip) => { let cx = 0, cy = 0, cz = 0; ring.forEach(i => { cx += m.P[3 * i]; cy += m.P[3 * i + 1]; cz += m.P[3 * i + 2]; });
      const n = ring.length, ce = v(m, [cx / n, cy / n, cz / n], col); for (let j = 0; j < n; j++) { const a = ring[j], b = ring[(j + 1) % n]; if (flip) m.I.push(ce, b, a); else m.I.push(ce, a, b); m.G.push(0); } };
    const grid = (m, rows, closed) => { const n = rows[0].length; for (let k = 0; k + 1 < rows.length; k++) for (let j = 0; j < (closed ? n : n - 1); j++) q(m, rows[k][j], rows[k][(j + 1) % n], rows[k + 1][j], rows[k + 1][(j + 1) % n]); };
    const foil = (t, n) => { const yt = x => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4), up = [], lo = [];
      for (let i = 0; i <= n; i++) { const x = 0.5 * (1 - Math.cos(Math.PI * i / n)); up.push([x, yt(x)]); lo.push([x, -yt(x)]); } return up.reverse().concat(lo.slice(1, n)); };
    // st: {xLE, y, z, c, t, col}; Profil je Station (Dicke t), Punktzahl gleich
    function loft(st, n, axisY) {
      const m = mk(), rows = st.map(S => foil(S.t, n).map(([x, y]) => v(m, axisY ? [S.xLE - x * S.c, S.z, y * S.c + S.y] : [S.xLE - x * S.c, S.y + y * S.c, S.z], S.col(x))));
      grid(m, rows, true); fan(m, rows[0], st[0].col(0.5), !axisY); fan(m, rows[rows.length - 1], st[st.length - 1].col(0.5), !!axisY); return m;
    }
    const WHITE = [0.96, 0.96, 0.97], BLUE = [0.10, 0.25, 0.70], RED = [0.85, 0.12, 0.10], DARK = [0.10, 0.12, 0.16], GREY = [0.55, 0.57, 0.60], BLACK = [0.06, 0.06, 0.07];
    const one = col => () => col;
    // Tragfläche: tief angesetzt (y = -0.10), 2° V-Form, gerade Endleiste nahezu, Nasenleiste leicht gepfeilt
    const half = 1.30, cr = 0.63, ct = 0.37, yW = -0.10, st = [], NS = 14;
    for (let k = -NS; k <= NS; k++) {
      const e = k / NS, a = Math.abs(e), ch = cr + (ct - cr) * a, z = e * half;
      const stripe = a > 0.55 && a < 0.72;
      st.push({ xLE: -0.10 * a * 0.6 + 0.0, y: yW + a * half * Math.tan(1 * Math.PI / 180), z, c: ch, t: 0.18 - 0.06 * a,
        col: x => (stripe ? BLUE : (a > 0.9 ? RED : (x > 0.75 && a > 0.25 && a < 0.92 ? GREY : WHITE))) });   // graue Querruder
    }
    meshes.push(loft(st, 18));
    let S = 0, C2 = 0, XL = 0;
    for (let k = 0; k + 1 < st.length; k++) { const dz = Math.abs(st[k + 1].z - st[k].z), cm = (st[k].c + st[k + 1].c) / 2, xm = (st[k].xLE + st[k + 1].xLE) / 2; S += cm * dz; C2 += cm * cm * dz; XL += xm * cm * dz; }
    const mac = C2 / S, xLEmac = XL / S, b = 2 * half;
    // Rumpf: Querschnitte als Superellipse; vorn rund (Haube), hinten schmal und hochkant
    const fm = mk(), NX = 52, NR = 24, xN = 0.72, xT = -1.56, rows = [];
    for (let i = 0; i <= NX; i++) {
      const t = i / NX, x = xN + (xT - xN) * t;
      let rw, rh, yc = 0, ex = 2.2;
      if (t < 0.03) { const u = t / 0.03; rw = rh = 0.13 + 0.035 * Math.sqrt(u); }               // Haubenring vorn
      else if (t < 0.30) { rw = 0.165 - 0.015 * (t - 0.03) / 0.27; rh = rw * 1.05; }                  // Motorhaube → Rumpf
      else { const u = (t - 0.30) / 0.70; rw = 0.15 - 0.135 * Math.pow(u, 0.9); rh = 0.165 - 0.10 * Math.pow(u, 1.1); yc = 0.04 * u; ex = 2.2 + 1.5 * u; }
      if (i === NX) { rw = 0.004; rh = 0.05; }
      const canT = (t - 0.27) / 0.20, can = canT > 0 && canT < 1 ? 0.10 * Math.sin(canT * Math.PI) ** 0.7 : 0;   // Haubenblase über dem Flügel
      const row = [];
      for (let j = 0; j < NR; j++) { const a = j / NR * 2 * Math.PI, cs = Math.cos(a), sn = Math.sin(a);
        const pw = (s, p) => Math.sign(s) * Math.pow(Math.abs(s), 2 / p);
        let y = yc + pw(sn, ex) * rh, z = pw(cs, ex) * rw; if (sn > 0) y += can * Math.pow(sn, 3);
        const col = sn > 0.4 && can > 0.01 ? DARK : t < 0.04 ? BLUE : (t < 0.30 && sn < 0.15 && sn > -0.15) ? BLUE : (t > 0.8 ? RED : WHITE);
        row.push(v(fm, [x, y, z], col)); }
      rows.push(row);
    }
    grid(fm, rows, true); fan(fm, rows[0], BLACK, true); fan(fm, rows[NX], RED, false); meshes.push(fm);
    // Höhenleitwerk (gerade Trapezform, symmetrisch) und Seitenleitwerk
    const hs = [], hHalf = 0.54;
    for (let k = -6; k <= 6; k++) { const a = Math.abs(k / 6); hs.push({ xLE: -1.20 - 0.08 * a, y: 0.03, z: k / 6 * hHalf, c: 0.32 - 0.13 * a, t: 0.10, col: x => x > 0.55 ? RED : WHITE }); }
    meshes.push(loft(hs, 10));
    const vs = []; for (let k = 0; k <= 6; k++) { const a = k / 6; vs.push({ xLE: -1.08 - 0.30 * a, y: 0, z: 0.05 + a * 0.40, c: 0.48 - 0.22 * a, t: 0.10, col: x => x > 0.55 ? RED : (a > 0.6 ? BLUE : WHITE) }); }
    meshes.push(loft(vs, 10, true));
    // Fahrwerk: Federstahlbeine + Räder, Spornrad
    const gm = mk(), wheel = (cx, cy, cz, r, w) => { const N = 16, A = [], B = []; for (let j = 0; j < N; j++) { const a = j / N * 2 * Math.PI; A.push(v(gm, [cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz - w], BLACK)); B.push(v(gm, [cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz + w], BLACK)); } grid(gm, [A, B], true); fan(gm, A, GREY, true); fan(gm, B, GREY, false); };
    const leg = (p0, p1, d) => { const A = [], B = [], o = [[0, -d, -d], [0, d, -d], [0, d, d], [0, -d, d]]; o.forEach(s => { A.push(v(gm, add(p0, [d, s[1], s[2]]), GREY)); B.push(v(gm, add(p1, [d, s[1], s[2]]), GREY)); }); grid(gm, [A, B], true); };
    const yWh = -0.40, rWh = 0.065;
    [1, -1].forEach(s => { leg([0.18, -0.13, s * 0.06], [0.22, yWh, s * 0.26], 0.012); wheel(0.22, yWh, s * 0.27, rWh, 0.025); });
    leg([-1.45, -0.04, 0], [-1.50, -0.14, 0], 0.006); wheel(-1.50, -0.16, 0, 0.025, 0.010);
    meshes.push(gm);
    // Spinner + 2-Blatt-Propeller (Ø 0,66 m)
    const pm = mk(), sp = []; for (let i = 0; i <= 6; i++) { const u = i / 6, row = []; for (let j = 0; j < 14; j++) { const a = j / 14 * 2 * Math.PI, r = 0.085 * Math.sqrt(Math.max(0, 1 - u * u)) + 0.0005; row.push(v(pm, [xN + 0.02 + 0.13 * u, Math.sin(a) * r, Math.cos(a) * r], WHITE)); } sp.push(row); }
    sp.reverse(); grid(pm, sp, true); pm.spin = 'blade';   // Spinner dreht mit
    // Blätter mit Steigung (vorne/hinten gegeneinander verdreht), dreht um die Körper-X-Achse (y = z = 0)
    const bm = mk(); bm.spin = 'blade';
    [1, -1].forEach(s => { const A = [], B = []; [[-0.008, 0.032], [0.008, -0.032], [0.016, -0.028], [0, 0.036]].forEach(([dx, dz]) => { A.push(v(bm, [xN + 0.06 + dx, s * 0.06, s * dz], BLACK)); B.push(v(bm, [xN + 0.06 + dx * 0.4, s * 0.33, s * dz * 0.45], BLACK)); }); grid(bm, [A, B], true); fan(bm, B, BLACK, false); });
    meshes.push(pm, bm);
    // halbdurchsichtige Propellerscheibe, sichtbar bei hoher Drehzahl
    const dm = mk(); dm.spin = 'disc'; { const ring = []; for (let j = 0; j < 40; j++) { const a = j / 40 * 2 * Math.PI; ring.push(v(dm, [xN + 0.062, Math.sin(a) * 0.33, Math.cos(a) * 0.33], [0.35, 0.36, 0.38])); } fan(dm, ring, [0.35, 0.36, 0.38], false); }
    meshes.push(dm);
    // auf den Schwerpunkt schieben (wie beim F3F)
    const cgx = xLEmac - mac * (c.cgPct / 100);
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const out = meshes.map(m => { const P = new Float32Array(m.P.length); for (let k = 0; k < P.length; k += 3) { P[k] = m.P[k] - cgx; P[k + 1] = m.P[k + 1]; P[k + 2] = m.P[k + 2]; for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], P[k + j]); hi[j] = Math.max(hi[j], P[k + j]); } }
      return { P, C: m.C, U: m.U, I: m.I, G: m.G, tex: null, spin: m.spin }; });
    const m = massOf(S);
    // Kunstflug: symmetrisches Profil (a0 = 0), großer Ruderausschlag, Schub ≈ 1,8 × Gewicht (Benziner ~ 60 cm³)
    return { meshes: out, tex: {}, S, b, c: mac, AR: b * b / S, m, bot: lo[1], len: hi[0] - lo[0], warn: [], name: 'Su-26M',
      aero: { a0: 0, cd0: 0.028, roll: 3.2, pitch: 1.8, yaw: 2.2, side: 1.6, tw: 1.8 } };
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

  // ---------- Vorbildgetreue Segler aus FlightGear (fsim_<id>.js, GPL v2+) ----------
  // Die Datenpakete erzeugt .claude/fg_glider_convert.py aus den FGAddon-Modellen (AC3D + Modell-XML). Hier: Maßstab frei wählbar,
  // Schwerpunkt aus der Flügeltiefe im Schnitt 1,5 m neben der Mitte, Ruder/Klappen bewegen sich mit den Knüppeln.
  // S: Flügelfläche des Originals (m²), Werte für Masse über die Flächenbelastung (g/dm²) beim Standardmaßstab.
  const GLIDERS = {
    ls4:   { label: 'Rolladen-Schneider LS4', S: 10.5, scale: 3, load: 90, aero: { a0: -0.065, cd0: 0.0125, roll: 1.3, pitch: 1.0, yaw: 1.4, side: 1.0, tw: 0 } },
    ask21: { label: 'Schleicher ASK 21', S: 17.95, scale: 3.5, load: 72, aero: { a0: -0.05, cd0: 0.016, roll: 1.6, pitch: 1.1, yaw: 1.5, side: 1.1, tw: 0 } },
    ka6:   { label: 'Schleicher Ka 6 CR', S: 12.4, scale: 3, load: 58, aero: { a0: -0.06, cd0: 0.017, roll: 1.35, pitch: 1.0, yaw: 1.4, side: 1.0, tw: 0 } },
    arcus: { label: 'Schempp-Hirth Arcus', S: 15.59, scale: 4, load: 95, aero: { a0: -0.07, cd0: 0.012, roll: 1.1, pitch: 1.0, yaw: 1.3, side: 1.0, tw: 0 } },
    dg300: { label: 'Glaser-Dirks DG-300 Elan', S: 10.27, scale: 3, load: 90, aero: { a0: -0.065, cd0: 0.0125, roll: 1.3, pitch: 1.0, yaw: 1.4, side: 1.0, tw: 0 } },
  };
  const isFg = () => !!GLIDERS[cfg().plane];
  const fgScale = id => { const v = +((cfg().fgScale || {})[id]); return clamp(isFinite(v) && v > 0 ? v : GLIDERS[id].scale, 1, 12); };
  const fgLoad = id => { const v = +((cfg().fgLoad || {})[id]); return clamp(isFinite(v) && v > 0 ? v : GLIDERS[id].load, 5, 250); };
  function b64buf(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
  function buildFg(id) {
    const D = window.FsimGliders && window.FsimGliders[id], G = GLIDERS[id];
    if (!D) return { err: T('Das Segler-Modell ist in dieser Ausgabe nicht enthalten.') + ' (fsim_' + id + '.js)' };
    const c = cfg(), k = 1 / fgScale(id), R = D.ref, spanR = R.span, chord = R.le - R.te;
    const S = G.S * k * k, b = spanR * k, mac = Math.max(0.05, Math.min(chord * 0.92, G.S / spanR)) * k;
    const cgX = R.le - (c.cgPct / 100) * mac / k, yw = R.yw || 0;   // Original-Meter (Körper X vorn); Schwerpunkt auf Flügelhöhe
    const meshes = [];
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    D.parts.forEach(p => {
      const q = new Uint16Array(b64buf(p.P)), nq = new Int8Array(b64buf(p.N)), uq = new Uint16Array(b64buf(p.U));
      const I = p.i32 ? new Uint32Array(b64buf(p.I)) : new Uint16Array(b64buf(p.I));
      const n = p.nv, P = new Float32Array(3 * n), N = new Float32Array(3 * n), U = new Float32Array(2 * n), C = new Float32Array(3 * n), cmax = Math.max(0.05, p.col[0], p.col[1], p.col[2]);   // FG-Material oft 0,8: auf hellstes = 1
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < 3; j++) { let v = p.lo[j] + q[3 * i + j] / 65535 * (p.hi[j] - p.lo[j]); if (j === 0) v -= cgX; else if (j === 1) v -= yw; v *= k; P[3 * i + j] = v; lo[j] = Math.min(lo[j], v); hi[j] = Math.max(hi[j], v); N[3 * i + j] = nq[3 * i + j] / 127; C[3 * i + j] = p.gl ? p.col[j] : p.col[j] / cmax; }
        U[2 * i] = p.ulo[0] + uq[2 * i] / 65535 * (p.uhi[0] - p.ulo[0]); U[2 * i + 1] = p.ulo[1] + uq[2 * i + 1] / 65535 * (p.uhi[1] - p.ulo[1]);
      }
      const an = (p.an || []).map(a => Object.assign({}, a, { p: [(a.p[0] - cgX) * k, (a.p[1] - yw) * k, a.p[2] * k], f: a.t === 't' ? a.f * k : a.f, o: a.t === 't' ? (a.o || 0) * k : (a.o || 0) }));
      meshes.push({ P, N, C, U, I, G: new Uint8Array(I.length / 3), tex: null, texKey: p.tex || null, texMode: 2, gloss: p.gl ? 2 : 1, alpha: p.gl ? 0.32 : 1, an: an.length ? an : null, name: p.n });
    });
    const tex = {}; for (const t in D.tex) tex[t] = { url: D.tex[t], m: [0, 0, 1, 1], repeat: true };
    return { meshes, tex, S, b, c: mac, AR: b * b / S, m: c.mass > 0 ? c.mass / 1000 : fgLoad(id) * (S * 100) / 1000, bot: lo[1], len: hi[0] - lo[0], warn: [],
      name: D.name, credit: D.credit, glider: true, brakes: true, aero: G.aero };
  }
  // Ruder-/Klappenstellung eines animierten Teils: Drehungen/Verschiebungen in Listenreihenfolge (erste zuerst), Körperkoordinaten
  function animMat(an, u, brk) {
    let M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (const a of an) {
      const val = a.c === 'brk' ? brk : clamp((u && u[a.c]) || 0, -1.5, 1.5);
      let A;
      if (a.t === 't') { const d = a.f * val + (a.o || 0); A = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, a.a[0] * d, a.a[1] * d, a.a[2] * d, 1]; }
      else {
        const th = ((a.s || 1) * a.f * val + (a.o || 0)) * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th), t = 1 - cs, [x, y, z] = a.a, p = a.p;
        const r = [t * x * x + cs, t * x * y + sn * z, t * x * z - sn * y, t * x * y - sn * z, t * y * y + cs, t * y * z + sn * x, t * x * z + sn * y, t * y * z - sn * x, t * z * z + cs];   // Spalten
        const rp = [r[0] * p[0] + r[3] * p[1] + r[6] * p[2], r[1] * p[0] + r[4] * p[1] + r[7] * p[2], r[2] * p[0] + r[5] * p[1] + r[8] * p[2]];
        A = [r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, p[0] - rp[0], p[1] - rp[1], p[2] - rp[2], 1];
      }
      M = mm(A, M);
    }
    return M;
  }

  // ---------- Gelände ----------
  // flat: Wiese (Höhe 0). slope: Hang entlang Z — Hochfläche (x < Kante) in Höhe H, Flanke fällt zum Tal (x > Kante) ab.
  // Die Kante schlängelt leicht (edgeX), im Tal liegen flache Wellen. Wind aus dem Tal (Richtung 180°) trifft den Hang.
  const isSlope = () => cfg().scene === 'slope';
  function slopeDims() { const c = cfg(), H = clamp(+c.slopeH || 60, 10, 300), deg = clamp(+c.slopeDeg || 35, 10, 60); return { H, L: 1.5 * H / Math.tan(deg * Math.PI / 180) }; }
  const edgeX = z => 18 * Math.sin(z / 90) + 9 * Math.sin(z / 37 + 1);
  // alpine: Grat entlang Z, ALP_BASE + H m über dem Meer. Luvflanke (x > Grat) fällt konkav ins Tal (oben steil, unten flach),
  // Lee (x < Grat) in ein höheres Hintertal; gegenüber und dahinter weitere Ketten. Rippen/Rinnen und Fels als Rauschen.
  const ALP_BASE = 1700;
  const isAlpine = () => cfg().scene === 'alpine';
  const isHill = () => isSlope() || isAlpine();
  function alpDims() { const c = cfg(), H = clamp(+c.alpH || 700, 200, 1500), deg = clamp(+c.alpDeg || 40, 20, 60); return { H, L: H / Math.tan(deg * Math.PI / 180) }; }
  function hillDims() { return isAlpine() ? alpDims() : slopeDims(); }
  // Luftdichte nach Normatmosphäre (nur im Gebirge spürbar)
  function rhoAt(y) { return isAlpine() ? RHO * Math.pow(Math.max(0.3, 1 - 2.25577e-5 * (ALP_BASE + y)), 4.2559) : RHO; }
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const hsh = (i, j) => { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  function vnz(x, z) {   // Wertrauschen 0…1, stetig differenzierbar (Gradient für den Hangwind)
    const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), w = fz * fz * (3 - 2 * fz);
    const a = hsh(i, j), b = hsh(i + 1, j), cc = hsh(i, j + 1), d = hsh(i + 1, j + 1);
    return a + (b - a) * u + (cc - a) * w + (a - b - cc + d) * u * w;
  }
  function fbm(x, z, o) { let s = 0, a = 0.5, f = 1, n = 0; for (let k = 0; k < o; k++) { s += a * (2 * vnz(x * f + k * 17.3, z * f - k * 9.1) - 1); n += a; a *= 0.5; f *= 2.03; } return s / n; }
  function ridg(x, z, o) { let s = 0, a = 0.5, f = 1, n = 0; for (let k = 0; k < o; k++) { const r = 1 - Math.abs(2 * vnz(x * f + k * 31.7, z * f + k * 5.3) - 1); s += a * r * r; n += a; a *= 0.5; f *= 2.07; } return s / n; }
  const crestX = z => 38 * Math.sin(z / 270) + 15 * Math.sin(z / 95 + 1.3);
  // Gratlinie: Gipfel rechts (z ≈ +720, mit Kreuz), Scharte links, Schulter weiter links, außen freie Gratlinie
  const crestH = (z, H) => H * (1 + 0.24 * Math.exp(-(((z - 720) / 240) ** 2)) - 0.08 * Math.exp(-(((z + 430) / 170) ** 2)) + 0.14 * Math.exp(-(((z + 1350) / 380) ** 2)) +
    0.02 * Math.sin(z / 150) + 0.22 * fbm(z / 1100, 3.7, 3) * sstep(1400, 2800, Math.abs(z)));
  function alpBase(x, z) {
    const { H, L } = alpDims(), xc = crestX(z), Hc = crestH(z, H), d = x - xc;
    const r = 14 + 16 * Math.exp(-((z / 140) ** 2)), sa = Math.sqrt(d * d + r * r) - r;   // gerundeter Grat, am Startplatz etwas breiter
    const Lw = L * (1 + 0.15 * fbm(z / 420, 1.1, 2)), Ll = 0.75 * L, fl = 0.3 * H;
    let h, face;
    if (d >= 0) { face = Math.min(1, sa / Lw); h = Hc * Math.pow(1 - face, 1.7); }
    else { face = Math.min(1, sa / Ll); h = fl + (Hc - fl) * Math.pow(1 - face, 1.5); }
    const fm = 4 * face * (1 - face);                     // Flankenmitte
    h += 18 * fbm(x / 520, z / 520, 3) * (1 - fm);         // Talboden und Gratrücken leicht wellig
    const xo = xc + Lw + 1100, xb = xc - Ll - 900;         // Kette gegenüber, Kette hinten
    if (x > xo) h += sstep(xo, xo + 1900, x) * H * 1.35 * (0.45 + 0.55 * ridg(x / 1200, z / 1200, 4));
    if (x < xb) h += sstep(xb, xb - 1700, x) * H * 1.1 * (0.4 + 0.6 * ridg(x / 1000 + 7, z / 1000, 4));
    // Rippen und Rinnen die Flanke hinab, Fels; nur auf der Startkanzel glatt
    const np = 1 - Math.exp(-((d - PAD_D) ** 2 + z * z) / 400), gul = 1 - Math.abs(2 * vnz(x / 260, z / 52) - 1);
    h += np * (fm * (20 * (gul * gul - 0.35) + 9 * fbm(x / 80, z / 80, 3)) + 2.5 * fbm(x / 22, z / 22, 2) * Math.min(1, fm * 3));
    return h;
  }
  // Startplatz: Felskanzel an der Abbruchkante knapp unter dem Grat (eben im Umkreis ~3,5 m), ringsum Felsbuckel und Platten
  const PAD_D = 17;
  let alpPad = { k: null };
  function alpPadOf() { const { H, L } = alpDims(), key = H + '/' + L; if (alpPad.k !== key) { const x = crestX(0) + PAD_D; alpPad = { k: key, x, y: alpBase(x, 0) + 0.8 }; } return alpPad; }
  function alpH(x, z) {
    let h = alpBase(x, z);
    const pd = alpPadOf(), dp = Math.hypot(x - pd.x, z);
    if (dp < 60) {
      const fw = sstep(pd.x, pd.x + 6, x);   // nach vorn (Flanke): Kante scharf, Blick hinunter frei
      h += Math.exp(-(dp * dp) / 900) * (1.8 * ridg(x / 7 + 3.1, z / 7, 2) - 0.7) * sstep(3.5, 7, dp) * (1 - 0.8 * fw);
      const r2 = 11 - 6 * fw; if (dp < r2) h += (pd.y - h) * (1 - sstep(3, r2, dp));
    }
    return h;
  }
  function terrainH(x, z) {
    if (isAlpine()) return alpH(x, z);
    if (!isSlope()) return 0;
    const { H, L } = slopeDims(), t = clamp((x - edgeX(z)) / L, 0, 1), sh = 1 - t * t * (3 - 2 * t);
    const back = x < edgeX(z) ? -Math.min(15, (edgeX(z) - x) * 0.02) : 0;   // Hochfläche fällt nach hinten leicht ab
    const wav = 2.5 * Math.sin(x / 53) * Math.sin(z / 71) + 1.5 * Math.sin(x / 23 + z / 41);
    return H * sh + back + (1 - sh) * wav * Math.min(1, Math.max(0, t * 3 - 1));
  }
  function terrainGrad(x, z, d) { d = d || 0.5; return [(terrainH(x + d, z) - terrainH(x - d, z)) / (2 * d), (terrainH(x, z + d) - terrainH(x, z - d)) / (2 * d)]; }
  function terrainN(x, z) { const g = terrainGrad(x, z); return norm([-g[0], 1, -g[1]]); }
  let ppMemo = { k: null, p: null };
  function pilotPos() {
    if (!isHill()) return [0, 0, 0];
    const k = sceneKey(); if (ppMemo.k === k) return ppMemo.p.slice();
    const x = isAlpine() ? alpPadOf().x + 1.5 : edgeX(0) - 1.5;   // Pilot direkt an der Kante bzw. auf der Felskanzel an der Abbruchkante
    ppMemo = { k, p: [x, terrainH(x, 0), 0] }; return ppMemo.p.slice();
  }

  // ---------- Simulation ----------
  const S0 = () => ({ p: [0, 2, 0], v: [0, 0, 0], R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], w: [0, 0, 0], thr: 0, crashed: null, t: 0, vario: 0, ground: false });
  let sim = S0(), keys = {}, ctl = { ail: 0, ele: 0, rud: 0, thr: 0 }, paused = false, therm = [];
  function trimSpeed() { return Math.sqrt(2 * plane.m * G / (rhoAt(pilotPos()[1]) * plane.S * 0.45)); }
  function thrustMax() { const c = cfg(); if (isF3F() || (plane && plane.glider)) return 0; if (plane && plane.aero && plane.aero.tw) return plane.m * G * plane.aero.tw; return c.thrust > 0 ? c.thrust : (c.motor ? plane.m * G * 0.8 : 0); }
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
  function newTherm() { const pp = pilotPos(); return { x: pp[0] + (isAlpine() ? 200 : isSlope() ? 40 : 0) + (Math.random() - 0.5) * 500, z: (Math.random() - 0.5) * 500, r: 25 + Math.random() * 30, w: 1.5 + Math.random() * 2, life: 60 + Math.random() * 120 }; }
  function windAt(p, t) {
    const c = cfg(), hd = (c.windDir || 0) * Math.PI / 180, gH = terrainH(p[0], p[2]), h = Math.max(0, p[1] - gH);
    const prof = c.wind * Math.min(1, Math.pow((h + 0.5) / 10, 0.2));   // Grenzschicht über Grund
    // Böen: mehrere Frequenzen, ortsabhängig (Turbulenz nimmt mit der Höhe ab)
    const turb = 0.12 + 0.12 * Math.exp(-h / 30);
    const gust = 1 + turb * (Math.sin(t * 0.7 + p[0] * 0.02) * Math.sin(t * 1.3 + p[2] * 0.03) + 0.5 * Math.sin(t * 3.1 + p[0] * 0.11 + p[2] * 0.07));
    const U = [Math.cos(hd) * prof * gust, 0, Math.sin(hd) * prof * gust];
    const wv = [U[0], 0.25 * turb * c.wind * Math.sin(t * 2.3 + p[2] * 0.09) * Math.sin(t * 1.7 + p[0] * 0.05), U[2]];
    if (isHill()) {
      // Hangaufwind: Luft folgt dem ansteigenden Gelände. Gradient großräumig gemittelt (Streuweite wächst mit der Höhe),
      // dadurch reicht das Aufwindband vor die Kante und nach oben; Abnahme mit der Höhe über Grund.
      const { H } = hillDims(), d = 4 + 0.6 * h, Uh = Math.hypot(U[0], U[2]) || 1, sh = 0.9 * h;   // Stromlinie: über Grund zählt das Gelände luvseitig darunter
      const g = terrainGrad(p[0] - U[0] / Uh * sh, p[2] - U[2] / Uh * sh, d);
      // Gebirge: steile Felsflanken lenken die Strömung nicht voll um (Sinus statt Tangens der Neigung)
      let up = (U[0] * g[0] + U[2] * g[1]) / (isAlpine() ? Math.sqrt(1 + g[0] * g[0] + g[1] * g[1]) : 1) * Math.exp(-h / (1.6 * H));
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
  // ---------- Fernsteuerung (Gamepad-API; USB-Sender melden sich als Joystick) ----------
  const FN = [['ail', 'invAil', 'Querruder'], ['ele', 'invEle', 'Höhenruder'], ['rud', 'invRud', 'Seitenruder'], ['thr', 'invThr', 'Gas']];
  const SURF = [['ail', 'Ail', 'Querruder', 'Ausschlag Querruder (%)', 'Expo Querruder (%)'], ['ele', 'Ele', 'Höhenruder', 'Ausschlag Höhenruder (%)', 'Expo Höhenruder (%)'],
    ['rud', 'Rud', 'Seitenruder', 'Ausschlag Seitenruder (%)', 'Expo Seitenruder (%)']];
  const LEARN_TXT = { ail: 'Querruder anlernen: Knüppel ganz nach rechts bewegen …', ele: 'Höhenruder anlernen: Knüppel ganz zu dir ziehen (Höhe) …',
    rud: 'Seitenruder anlernen: Knüppel ganz nach rechts bewegen …', thr: 'Gas anlernen: Gasknüppel von Leerlauf auf Vollgas schieben …' };
  function padList() { try { return navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(g => g && g.connected !== false && g.axes) : []; } catch (e) { return []; } }
  function curPad() { const l = padList(), id = cfg().pad.dev; return l.find(g => g.id === id) || l[0] || null; }
  function calOf(gp) { const cal = cfg().pad.cal; return (gp && cal && cal[gp.id]) || null; }
  // Rohwert der Achse i → −1…1. Kalibriert: Knüppel von der gemessenen Mitte aus je Seite auf ±1, Gas linear zwischen den Anschlägen.
  function axNorm(gp, i, centred) {
    if (!gp || !(i >= 0)) return null;
    const v = gp.axes[i]; if (v === undefined || v === null || !isFinite(v)) return null;
    const cl = calOf(gp), k = cl && cl[i];
    if (!k) return clamp(v, -1, 1);
    if (!centred) return clamp((v - k.lo) / Math.max(1e-3, k.hi - k.lo) * 2 - 1, -1, 1);
    return v >= k.mid ? clamp((v - k.mid) / Math.max(1e-3, k.hi - k.mid), 0, 1) : -clamp((k.mid - v) / Math.max(1e-3, k.mid - k.lo), 0, 1);
  }
  // Wert einer Funktion (ail/ele/rud/thr) nach Kalibrierung und Umkehr, null = nicht zugeordnet
  function fnVal(gp, k) { const P = cfg().pad, f = FN.find(x => x[0] === k), v = axNorm(gp, +P[k], k !== 'thr'); return v === null ? null : (P[f[1]] ? -v : v); }
  let learn = null, calib = null, padNote = null, padRef = null;   // Anlernen { k, base, t0 } · Kalibrieren { id, lo[], hi[] }
  const padBusy = () => !!(learn || calib);
  const RBs = () => { if (state.activeTab === 'fsim' && App.buildSidebar) App.buildSidebar(); };
  function note(t) { padNote = { text: t, t: performance.now() }; }
  function learnStart(k) { calib = null; learn = learn && learn.k === k ? null : { k, base: null, t0: performance.now() }; }
  function calibStart() { const gp = curPad(); learn = null; calib = gp ? { id: gp.id, lo: [], hi: [] } : null; }
  function calibDone() {
    const gp = curPad(); if (!calib || !gp || gp.id !== calib.id) { calib = null; return; }
    const P = cfg().pad, out = [];
    gp.axes.forEach((v, i) => {
      const lo = calib.lo[i], hi = calib.hi[i];
      if (lo === undefined || !(hi - lo > 0.3)) { out[i] = null; return; }   // nicht bewegt → Rohwert
      // Mitte = Stellung beim „Fertig“; steht ein Knüppel nicht mittig (Gas), Mitte des Wegs
      let mid = isFinite(v) ? v : (lo + hi) / 2; if (mid < lo + 0.25 * (hi - lo) || mid > hi - 0.25 * (hi - lo)) mid = (lo + hi) / 2;
      out[i] = { lo: +lo.toFixed(4), mid: +mid.toFixed(4), hi: +hi.toFixed(4) };
    });
    const n = out.filter(Boolean).length;
    if (n) { P.cal[gp.id] = out; note(T('Kalibriert') + ': ' + n + ' ' + T('Achsen')); } else note(T('Keine Achse bewegt — Kalibrierung nicht übernommen'));
    calib = null; saveLs();
  }
  // Je Bild: Kalibrier-Anschläge sammeln bzw. beim Anlernen die am weitesten bewegte Achse übernehmen
  function padTick() {
    if (!learn && !calib) return;
    const gp = curPad();
    if (calib) {
      if (!gp || gp.id !== calib.id) { calib = null; RBs(); return; }
      gp.axes.forEach((v, i) => { if (!isFinite(v)) return; calib.lo[i] = calib.lo[i] === undefined ? v : Math.min(calib.lo[i], v); calib.hi[i] = calib.hi[i] === undefined ? v : Math.max(calib.hi[i], v); });
      return;
    }
    if (!gp || performance.now() - learn.t0 > 20000) { learn = null; note(T('Anlernen abgebrochen')); RBs(); return; }
    if (!learn.base) { learn.base = gp.axes.slice(); return; }
    let best = -1, bd = 0;
    gp.axes.forEach((v, i) => {
      const b = learn.base[i]; if (!isFinite(v) || !isFinite(b) || Math.abs(b) > 1.05) return;   // Kreuzschalter-Achse (ruht bei ≈1,29) übergehen
      const d = v - b; if (Math.abs(d) > Math.abs(bd)) { bd = d; best = i; }
    });
    if (best >= 0 && Math.abs(bd) > 0.6) {
      const P = cfg().pad, f = FN.find(x => x[0] === learn.k);
      P[learn.k] = best; P[f[1]] = bd < 0;   // Knüppel in Plus-Richtung bewegt: fällt der Rohwert, umkehren
      note(T(f[2]) + ' → ' + T('Achse') + ' ' + best + (bd < 0 ? ' (' + T('umgekehrt') + ')' : ''));
      learn = null; saveLs(); RBs();
    }
  }
  function readInputs(dt) {
    const c = cfg();
    let ail = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0), ele = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0), rud = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    // Tastatur weich nachführen, damit sich das Modell steuern lässt
    const sm = (o, t) => o + clamp(t - o, -dt * 4, dt * 4);
    ctl.ail = sm(ctl.ail, ail); ctl.ele = sm(ctl.ele, ele); ctl.rud = sm(ctl.rud, rud);
    if (keys.KeyW) sim.thr = clamp(sim.thr + dt * 0.6, 0, 1);
    if (keys.KeyS) sim.thr = clamp(sim.thr - dt * 0.6, 0, 1);
    let padInfo = null;
    const gp = curPad();
    if (gp) {
      const P = c.pad, dzv = clamp(+P.dz || 0, 0, 30) / 100, dz = v => Math.abs(v) <= dzv ? 0 : (v - Math.sign(v) * dzv) / (1 - dzv);
      const vals = [fnVal(gp, 'ail'), fnVal(gp, 'ele'), fnVal(gp, 'rud'), fnVal(gp, 'thr')];
      // Sender übernimmt, sobald sich ein Knüppel bewegt (nicht schon bei verstellter Mitte) — eine Steuertaste gibt an die Tastatur zurück
      if (!padUsed) { if (!padRef) padRef = vals; else if (vals.some((v, i) => v !== null && padRef[i] !== null && Math.abs(v - padRef[i]) > 0.08)) padUsed = true; }
      if (padUsed && !padBusy()) {
        if (vals[0] !== null) ctl.ail = dz(vals[0]); if (vals[1] !== null) ctl.ele = dz(vals[1]); if (vals[2] !== null) ctl.rud = dz(vals[2]);
        if (vals[3] !== null) sim.thr = clamp((vals[3] + 1) / 2, 0, 1);
      }
      padInfo = gp.id;
    }
    // Ausschlag und Expo je Ruder (auch für die Tastatur); über 100 % = mehr Ruderweg als Standard
    const out = (k, s) => clamp(expo(ctl[k], clamp(+c['expo' + s] || 0, 0, 100) / 100) * clamp(isFinite(+c['rate' + s]) ? +c['rate' + s] : 100, 0, 200) / 100, -2, 2);
    return { ail: out('ail', 'Ail'), ele: out('ele', 'Ele'), rud: out('rud', 'Rud'), padInfo };
  }
  let padUsed = false;
  function step(dt, u) {
    if (sim.crashed || sim.wait) return;
    const c = cfg(), P = plane, R = sim.R, V0 = trimSpeed();
    const air = sub(sim.v, windAt(sim.p, sim.t)), Va = len(air), vb = toB(R, air);
    const rho = rhoAt(sim.p[1]), qd = 0.5 * rho * Va * Va, f = Math.min(4, (rho * Va * Va) / (rhoAt(pilotPos()[1]) * V0 * V0));
    const alpha = Math.atan2(-vb[1], Math.max(1e-3, Math.abs(vb[0]))), beta = Va > 0.5 ? Math.asin(clamp(vb[2] / Va, -1, 1)) : 0;
    const wb = sim.w, pR = wb[0], qR = wb[2], rR = -wb[1];
    // Bodeneffekt: weniger induzierter Widerstand, etwas mehr Auftriebsanstieg dicht über Grund
    const hAGL = Math.max(0.01, sim.p[1] + P.bot - terrainH(sim.p[0], sim.p[2])), ge = Math.pow(16 * hAGL / P.b, 2), geF = ge / (1 + ge);
    const AE = P.aero || {}, CLa = 2 * Math.PI * P.AR / (P.AR + 2) * (1 + 0.08 * (1 - geF)), aS = 0.21, a0 = AE.a0 !== undefined ? AE.a0 : -0.03;
    const aa = Math.abs(alpha - a0), stalled = aa > aS;
    let CL = CLa * (alpha - a0);
    if (stalled) CL = Math.sign(alpha - a0) * CLa * aS * Math.max(0.3, 1 - (aa - aS) * 2.2);
    if (vb[0] < 0) CL *= 0.2;
    // Bremsklappen (Segler: Gasknüppel): stören den Auftrieb, viel Widerstand
    const brk = P.brakes ? clamp(sim.thr, 0, 1) : 0;
    CL *= 1 - 0.12 * brk;
    // Reynolds-Einfluss auf den Profilwiderstand (kleine Modelle/langsam → mehr Widerstand); dünne Luft = größere Zähigkeit ν
    const Re = Math.max(1e4, Va * P.c / (1.5e-5 * RHO / rho)), cd0 = (isF3F() ? 0.016 : P.aero ? P.aero.cd0 : c.cd0) * clamp(Math.pow(1.5e5 / Re, 0.2), 0.8, 1.7);
    const CD = cd0 + CL * CL / (Math.PI * 0.8 * P.AR) * geF + (stalled ? 0.7 * Math.sin(aa) : 0) + 0.3 * beta * beta + 0.045 * brk;
    let F = [0, -P.m * G, 0];
    if (Va > 0.1) {
      const vh = mul(air, 1 / Va), right = R[2];
      F = add(F, mul(norm(cross(right, vh)), qd * P.S * CL));
      F = add(F, mul(vh, -qd * P.S * CD));
      F = add(F, mul(right, -qd * P.S * 0.5 * (AE.side || 1) * beta));   // Seitenkraft Rumpf/Seitenleitwerk
    }
    // Schub (nimmt mit der Fahrt ab), Propellerstrahl macht Höhe/Seite auch im Stand wirksam
    const Tm = thrustMax(), Tn = Tm > 0 && sim.thr > 0 ? Tm * sim.thr * Math.max(0, 1 - Math.max(0, vb[0]) / (V0 * 3.5)) : 0;
    if (Tn > 0) F = add(F, mul(R[0], Tn));
    const wash = Tn / (P.m * G);
    // Drehbewegung — Eigenfrequenzen aus Fahrt und Größe, Stabilität aus dem Schwerpunkt (Stabilitätsmaß sigma)
    const Lr = Math.max(0.3, P.len), sigma = ((+c.npPct || 42) - (+c.cgPct || 30)) / 100;
    const wq = 0.25 * Va / Math.sqrt(P.c * Lr), kq = wq * wq * clamp(sigma / 0.1, -1, 2.5);
    const eleAuth = 0.22 * (AE.pitch || 1) * clamp(Math.sqrt(0.1 / Math.max(sigma, 0.02)), 0.5, 2.2) * (stalled ? 0.5 : 1);
    const aTrim = 0.45 / CLa + a0;
    const qdd = kq * ((aTrim + u.ele * eleAuth) - alpha) - 2 * 0.45 * wq * qR + wash * 25 * u.ele;   // sigma < 0: kq < 0 → instabil
    const pMax = 0.09 * (AE.roll || 1) * 2 * Va / P.b * (stalled ? 0.4 : 1), lp = clamp(1.5 * Va / P.b, 1, 45);
    let pdd = lp * (u.ail * pMax - pR) - 6 * f * beta + 0.6 * f * rR;   // V-Form-Effekt, Rollmoment aus Gieren
    if (stalled && vb[0] > 0) pdd += sim.tip * 30 * f * (aa - aS);         // Abkippen über eine Fläche
    else sim.tip = beta > 0.02 ? -1 : beta < -0.02 ? 1 : sim.tip;
    const wr = 0.4 * Va / Lr;
    let rdd = wr * wr * (beta + 0.22 * (AE.yaw || 1) * u.rud * (stalled ? 0.6 : 1)) - 2 * 0.3 * wr * rR - 1.2 * f * u.ail * pMax / (AE.roll || 1) + wash * 20 * u.rud;   // Windfahne, Dämpfung, negatives Wendemoment
    if (sim.ground) { const gs = Math.min(1, len(sim.v) / 3); rdd += 8 * (u.rud * 0.8 * gs - rR); pdd -= 15 * pR; }
    sim.w = [pR + pdd * dt, wb[1] - rdd * dt, qR + qdd * dt];
    // Translation
    sim.v = add(sim.v, mul(F, dt / P.m));
    sim.p = add(sim.p, mul(sim.v, dt));
    sim.R = rotAxes(R, sim.w, dt);
    sim.vario = sim.vario * 0.98 + sim.v[1] * 0.02;
    engine(dt, Math.max(0, vb[0]));
    sim.t += dt; sim.stalled = stalled; sim.agl = hAGL;
    ground(dt, V0);
  }
  // Motor: läuft ab dem ersten Gasgeben, Leerlauf ~1800 U/min, Vollgas ~7000 U/min; Hochlauf ~0,35 s, Windmühle durch Fahrt
  const RPM_IDLE = 1800, RPM_MAX = 7000;
  function engine(dt, vx) {
    if (thrustMax() <= 0) { sim.rpm = 0; return; }
    if (sim.thr > 0.03) sim.run = true;
    const tgt = sim.run ? RPM_IDLE + (RPM_MAX - RPM_IDLE) * sim.thr + vx * 25 : 0;
    sim.rpm = (sim.rpm || 0) + (tgt - (sim.rpm || 0)) * Math.min(1, dt / (tgt > (sim.rpm || 0) ? 0.35 : 0.6));
    sim.propA = ((sim.propA || 0) + sim.rpm / 60 * 2 * Math.PI * dt) % (2 * Math.PI);
  }
  // ---------- Motorgeräusch (Web Audio, synthetisch) ----------
  // Einzylinder-Zweitakter: Zündfrequenz = U/min / 60 (Sägezahn), Propeller-Blattfrequenz ×2 (Rechteck), Rauschen fürs Rauschen
  // des Auspuffs; Tiefpass öffnet mit der Drehzahl. Lautstärke nach Entfernung zum Zuhörer (Kamera), Doppler aus der Radialfahrt.
  let AU = null, lastEye = null;
  function audioInit() {
    if (AU || !cfg().sound) { if (AU && AU.ctx.state === 'suspended') AU.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try {
      const ctx = new AC(), out = ctx.createGain(); out.gain.value = 0; out.connect(ctx.destination);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2; lp.connect(out);
      const sh = ctx.createWaveShaper(), cur = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 127.5 - 1; cur[i] = Math.tanh(2.2 * x); } sh.curve = cur; sh.connect(lp);
      const o1 = ctx.createOscillator(), g1 = ctx.createGain(); o1.type = 'sawtooth'; g1.gain.value = 0.55; o1.connect(g1); g1.connect(sh);
      const o2 = ctx.createOscillator(), g2 = ctx.createGain(); o2.type = 'square'; g2.gain.value = 0.18; o2.connect(g2); g2.connect(sh);
      const o3 = ctx.createOscillator(), g3 = ctx.createGain(); o3.type = 'triangle'; g3.gain.value = 0.35; o3.connect(g3); g3.connect(sh);   // Unterton (Kurbelwelle)
      const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8; const gn = ctx.createGain(); gn.gain.value = 0.25;
      ns.connect(bp); bp.connect(gn); gn.connect(lp);
      [o1, o2, o3, ns].forEach(n => n.start());
      AU = { ctx, out, lp, o1, o2, o3, bp, gn };
    } catch (e) { console.warn('Flugsimulator: Audio', e); }
  }
  function audioUpdate(on) {
    if (!AU) return;
    const c = cfg(), t = AU.ctx.currentTime, k = 0.06, rpm = sim.rpm || 0;
    let g = 0;
    if (on && c.sound && rpm > 50 && plane && !plane.err) {
      const eye = lastEye || sim.p, d = Math.max(1, len(sub(sim.p, eye))), vr = dot(sim.v, norm(sub(sim.p, eye)));
      const dop = 343 / (343 + clamp(vr, -150, 150)), f = rpm / 60 * dop;
      AU.o1.frequency.setTargetAtTime(f, t, k); AU.o2.frequency.setTargetAtTime(2 * f, t, k); AU.o3.frequency.setTargetAtTime(f / 2, t, k);
      AU.bp.frequency.setTargetAtTime(400 + 3 * f, t, k); AU.lp.frequency.setTargetAtTime(500 + rpm * 0.45 * dop, t, k);
      const load = clamp(rpm / RPM_MAX, 0, 1);
      g = (0.25 + 0.75 * load * load) * Math.min(1, 12 / d) * (c.vol / 100) * 0.5;
      AU.gn.gain.setTargetAtTime(0.15 + 0.35 * sim.thr, t, k);
    }
    AU.out.gain.setTargetAtTime(g, t, on ? 0.05 : 0.02);
  }
  function ground(dt, V0) {
    const lo = lowestPoint(); if (lo.d >= 0) { sim.ground = false; return; }
    const n = terrainN(lo.q[0], lo.q[2]), vn = dot(sim.v, n), up = dot(sim.R[1], n);
    if (vn < -Math.max(2.5, V0 * 0.4) || up < 0.55 || len(sim.v) > V0 * 2.2 || lo.tip) {
      sim.crashed = vn < -4 || len(sim.v) > V0 * 2.2 ? T('Absturz!') : T('Bruchlandung!'); sim.v = [0, 0, 0]; sim.w = [0, 0, 0]; sim.run = false; sim.rpm = 0; return;
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
  const FS = '#version 300 es\nprecision highp float;in vec3 vN;in vec3 vC;in vec2 vT;in vec3 vW;uniform sampler2D uTex;uniform float uUse;uniform float uShadow;uniform vec3 uEye;uniform vec3 uFog;uniform float uFogD;uniform float uAlpha;uniform float uGloss;out vec4 o;void main(){if(uShadow>0.5){o=vec4(0.0,0.0,0.0,0.35);return;}vec3 n=normalize(vN);vec3 V=normalize(uEye-vW);if(dot(n,V)<0.0)n=-n;vec3 L=normalize(vec3(0.35,0.85,0.25));float d=max(dot(n,L),0.0)*0.7+abs(dot(n,L))*0.15;vec4 t=texture(uTex,vT);if(uUse>1.5&&t.a<0.4)discard;vec3 c=uUse>1.5?vC*t.rgb:mix(vC,t.rgb,t.a*uUse);vec3 col=c*(uGloss>0.5?0.52+0.62*d:0.38+0.75*d);if(uGloss>0.5){float gl=step(1.5,uGloss);vec3 R=reflect(-V,n);vec3 env=R.y>0.0?mix(uFog,vec3(0.22,0.42,0.80),sqrt(R.y)):mix(uFog*0.85,vec3(0.22,0.27,0.17),min(1.0,-R.y*3.0));float fr=0.04+0.96*pow(1.0-max(dot(n,V),0.0),5.0);float sp=pow(max(dot(n,normalize(L+V)),0.0),mix(70.0,400.0,gl));col=mix(col,env,clamp(fr*mix(0.45,1.0,gl)+gl*0.22,0.0,1.0))+vec3(sp*mix(0.5,1.6,gl));}float f=1.0-exp(-length(vW-uEye)/uFogD);o=vec4(mix(col,uFog,f),uAlpha);}';
  // Boden: prozedurales Gras, Mähstreifen, Piste; Gebirge (uMode 2): Alpwiese, Wald unter der Baumgrenze, Geröll, Fels, Schnee
  const GVS = '#version 300 es\nin vec3 aP;in vec3 aN;uniform mat4 uVP;out vec3 vW;out vec3 vN;void main(){vW=aP;vN=aN;gl_Position=uVP*vec4(vW,1.0);}';
  const GFS = '#version 300 es\nprecision highp float;in vec3 vW;in vec3 vN;uniform vec3 uEye;uniform float uRwy;uniform vec3 uFog;uniform float uFogD;uniform float uMode;uniform float uSnow;uniform float uTree;uniform vec2 uPP;out vec4 o;float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}' +
    'vec3 alp(vec2 p,float y,vec3 nn){float st=1.0-nn.y;float g=n(p*0.02)*0.5+n(p*0.13)*0.3+n(p*1.1)*0.2;vec3 c=mix(vec3(0.29,0.41,0.16),vec3(0.47,0.52,0.25),g);' +
    'float tl=uTree+50.0*(n(p*0.006)-0.5);c=mix(c,mix(vec3(0.07,0.16,0.07),vec3(0.12,0.22,0.10),g),smoothstep(tl+12.0,tl-12.0,y)*smoothstep(0.02,0.10,st));' +
    'c=mix(c,vec3(0.50,0.46,0.38),smoothstep(0.16,0.32,st+0.08*(g-0.5))*0.7);vec3 r=mix(vec3(0.36,0.35,0.34),vec3(0.60,0.58,0.54),n(p*0.045+vec2(0.0,y*0.04))*0.6+n(p*0.35)*0.4);r*=0.93+0.07*sin(y*0.35+n(p*0.015)*9.0)+0.08*(n(p*0.2)-0.5);' +
    'c=mix(c,r,smoothstep(0.28,0.45,st+0.12*(g-0.5)));float pr=length(p-uPP);float slab=smoothstep(0.45,0.68,n(p*0.16)*0.7+n(p*0.9)*0.3);c=mix(c,r*vec3(1.03,1.0,0.96),(1.0-smoothstep(8.0,60.0,pr))*max(slab,1.0-smoothstep(2.5,5.0,pr)));float sl=uSnow+70.0*(n(p*0.004)-0.5)+30.0*(n(p*0.03)-0.5);float sn=smoothstep(sl,sl+30.0,y)*(1.0-smoothstep(0.42,0.60,st));return mix(c,vec3(0.93,0.95,1.0),sn);}' +
    'void main(){vec2 p=vW.xz;if(uMode>1.5){vec3 nn=normalize(vN);vec3 ca=alp(p,vW.y,nn)*(0.50+0.60*max(dot(nn,normalize(vec3(0.35,0.85,0.25))),0.0));o=vec4(mix(ca,uFog,1.0-exp(-length(vW-uEye)/uFogD)),1.0);return;}float g=n(p*0.05)*0.5+n(p*0.4)*0.3+n(p*3.0)*0.2;vec3 c=mix(vec3(0.22,0.38,0.14),vec3(0.36,0.52,0.20),g);float s=step(0.5,fract(p.x/12.0));c*=0.94+0.06*s;vec3 n=normalize(vN);float st=1.0-n.y;c=mix(c,vec3(0.40,0.36,0.28),smoothstep(0.25,0.6,st)*0.7);c*=0.55+0.5*max(dot(n,normalize(vec3(0.35,0.85,0.25))),0.0);if(uRwy>0.5&&abs(p.y)<4.0&&abs(p.x)<60.0){c=mix(vec3(0.42,0.50,0.30),c,0.35);if(abs(abs(p.y)-3.8)<0.12)c=vec3(0.85);}float f=1.0-exp(-length(vW-uEye)/uFogD);o=vec4(mix(c,uFog,f),1.0);}';
  const FOG = [0.70, 0.80, 0.90], FOG_ALP = [0.66, 0.77, 0.92];   // Gebirge: klare Luft, bläuliche Ferne
  const SKY = 'linear-gradient(#5d8fd0,#b9d3ee)', SKY_ALP = 'linear-gradient(#2a62b6 0%,#5e92d6 55%,#a8c5eb 100%)';
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
    thrBox.innerHTML = '<div class="fsThrL">' + T('Gas') + '</div><div style="position:relative;width:14px;height:110px;margin:4px auto;border:1px solid rgba(255,255,255,.5);border-radius:3px;overflow:hidden"><div class="fsThr" style="position:absolute;left:0;right:0;bottom:0;height:0;background:linear-gradient(#ff7a3c,#ffd25a)"></div></div><div class="fsThrT" style="font:bold 12px monospace">0 %</div>';
    win.append(cv, hud, msg, thrBox, bar); host.appendChild(win);
    win.addEventListener('pointerdown', audioInit);
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
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyB', 'Space'].includes(e.code)) { e.preventDefault(); padUsed = false; padRef = null; }
      if (e.type === 'keydown') {
        audioInit();
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
    // alte Puffer freigeben (das Gebirgsnetz ist groß; Neuaufbau bei jeder Änderung von Grathöhe/Neigung)
    world.forEach(o => { gl.deleteVertexArray(o.vao); (o.bufs || []).forEach(b => gl.deleteBuffer(b)); }); world.length = 0;
    if (world.ground) { gl.deleteVertexArray(world.ground); (world.groundBufs || []).forEach(b => gl.deleteBuffer(b)); world.ground = null; }
    const P = [], C = [], I = [];
    const cone = (x, z, h, r, col, y0) => {
      const n = 8, base = P.length / 3;
      P.push(x, y0 + h, z); C.push(col[0] * 1.15, col[1] * 1.15, col[2] * 1.15);
      for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI; P.push(x + r * Math.cos(a), y0, z + r * Math.sin(a)); C.push(col[0], col[1], col[2]); }
      for (let i = 0; i < n; i++) I.push(base, base + 1 + (i + 1) % n, base + 1 + i);
    };
    let sd = 7; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    const pp = pilotPos(), slope = isSlope(), alp = isAlpine();
    const tree = (x, z, s) => { const y = terrainH(x, z) - 0.3; cone(x, z, 1.5 * s, 0.25 * s, [0.35, 0.25, 0.15], y); cone(x, z, 6 * s, 2.2 * s, [0.12 + rnd() * 0.06, 0.30 + rnd() * 0.1, 0.12], y + 1.0 * s); };
    // Quader mit eigenen Ecken je Seite (kantig beleuchtet); y0 = Unterkante
    const box = (x, y0, z, sx, sy, sz, col) => { const fc = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
      const h = [sx / 2, sy / 2, sz / 2], c0 = [x, y0 + sy / 2, z];
      fc.forEach(([nn, a, b]) => { const base = P.length / 3; [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([s, t]) => { for (let k = 0; k < 3; k++) P.push(c0[k] + (nn[k] + a[k] * s + b[k] * t) * h[k]); C.push(col[0], col[1], col[2]); }); I.push(base, base + 1, base + 2, base, base + 2, base + 3); }); };
    if (alp) {
      const { H, L } = alpDims();
      // Bergwald unterhalb der Baumgrenze (Luvseite im Tal und Lee), große Fichten/Lärchen
      for (let i = 0, n = 0; i < 6000 && n < 900; i++) {
        const lee = rnd() < 0.3, x = lee ? pp[0] - 0.75 * L * (0.45 + rnd() * 0.9) : pp[0] + L * (0.45 + rnd() * 1.6), z = (rnd() - 0.5) * 5000, y = terrainH(x, z);
        if (y > 0.42 * H + 30 * (rnd() - 0.5) || terrainN(x, z)[1] < 0.75) continue;
        tree(x, z, 1.6 + rnd() * 1.4); n++;
      }
      // Felsblöcke: unregelmäßige, halb eingesunkene Knollen
      const boulder = (x, z, sz, g) => { const NA = 7, NB = 4, base = P.length / 3, y0 = terrainH(x, z) - 0.35 * sz, ks = [];
        for (let j = 0; j <= NB; j++) { const b = -Math.PI / 2 + Math.PI * j / NB; for (let i = 0; i < NA; i++) { const a = i / NA * 2 * Math.PI, kk = j === 0 || j === NB ? 1 : 0.7 + 0.55 * rnd(), gg = g * (0.88 + 0.24 * rnd());
          P.push(x + Math.cos(b) * Math.cos(a) * sz * kk * 1.25, y0 + (Math.sin(b) + 1) * 0.5 * sz * 0.85 * kk, z + Math.cos(b) * Math.sin(a) * sz * kk); C.push(gg, gg * 0.98, gg * 0.93); } }
        for (let j = 0; j < NB; j++) for (let i = 0; i < NA; i++) { const a = base + j * NA + i, b = base + j * NA + (i + 1) % NA; I.push(a, b, b + NA, a, b + NA, a + NA); } };
      // um die Startkanzel (Blick nach vorn in die Flanke bleibt frei), dazu verstreut am Grat
      for (let i = 0, n = 0; i < 400 && n < 75; i++) { const a = rnd() * 2 * Math.PI, r = 4.5 + rnd() * 42, x = pp[0] + Math.cos(a) * r * 0.85, z = Math.sin(a) * r, fx = x - pp[0];
        if (fx > 1.5 && Math.abs(z) < 0.9 * fx + 7) continue; boulder(x, z, 0.35 + rnd() * rnd() * 1.9, 0.38 + rnd() * 0.12); n++; }
      for (let i = 0; i < 60; i++) { const z = (rnd() - 0.5) * 700, x = crestX(z) + (rnd() - 0.6) * 60; if (Math.hypot(x - pp[0], z) < 50) continue; boulder(x, z, 0.5 + rnd() * 2.2, 0.36 + rnd() * 0.14); }
      // Gipfelkreuz auf dem Gipfel rechts
      let gx = crestX(720), gy = -1e9; for (let dx = -40; dx <= 40; dx += 2) { const y = terrainH(crestX(720) + dx, 720); if (y > gy) { gy = y; gx = crestX(720) + dx; } }
      const WOOD = [0.32, 0.22, 0.13]; box(gx, gy - 0.5, 720, 0.35, 7, 0.35, WOOD); box(gx, gy + 4.4, 720, 0.3, 0.35, 3.2, WOOD);
      // Berghütte hinter dem Startplatz (Lee): Steinsockel, Holzwände, Satteldach
      const hx = pp[0] - 42, hz = 55, hy = terrainH(hx, hz);
      box(hx, hy - 1.5, hz, 9, 2.2, 7, [0.50, 0.49, 0.47]); box(hx, hy + 0.7, hz, 9, 2.6, 7, [0.45, 0.30, 0.17]);
      { const y1 = hy + 3.3, y2 = hy + 5.6, b0 = P.length / 3, R = [0.40, 0.18, 0.14];
        [[hx - 5, y1, hz - 4.2], [hx + 5, y1, hz - 4.2], [hx + 5, y2, hz], [hx - 5, y2, hz], [hx - 5, y1, hz + 4.2], [hx + 5, y1, hz + 4.2]].forEach(p => { P.push(p[0], p[1], p[2]); C.push(R[0], R[1], R[2]); });
        I.push(b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2, b0 + 4, b0 + 5, b0 + 2, b0 + 4, b0 + 2, b0 + 3);
        const g0 = P.length / 3; [[hx - 4.5, y1, hz - 3.5], [hx - 4.5, y1, hz + 3.5], [hx - 4.5, y2 - 0.3, hz], [hx + 4.5, y1, hz - 3.5], [hx + 4.5, y1, hz + 3.5], [hx + 4.5, y2 - 0.3, hz]].forEach(p => { P.push(p[0], p[1], p[2]); C.push(0.45, 0.30, 0.17); });
        I.push(g0, g0 + 1, g0 + 2, g0 + 3, g0 + 4, g0 + 5); }
    } else {
      for (let i = 0; i < 300; i++) { const a = rnd() * 2 * Math.PI, r = 160 + rnd() * 450, x = pp[0] + Math.cos(a) * r, z = Math.sin(a) * r;
        if (slope && Math.abs(x - edgeX(z)) < 25) continue; tree(x, z, 0.8 + rnd() * 1.2); }
      for (let i = 0; i < 25; i++) tree(pp[0] + (slope ? -45 - rnd() * 40 : -40 + rnd() * 80), slope ? -60 + rnd() * 120 : 35 + rnd() * 30, 0.7 + rnd() * 0.6);
      // Hügel am Horizont
      for (let i = 0; i < 40; i++) { const a = i / 40 * 2 * Math.PI + rnd() * 0.1, r = 1400 + rnd() * 300, x = Math.cos(a) * r, z = Math.sin(a) * r; cone(x, z, 80 + rnd() * 160, 300 + rnd() * 200, [0.30, 0.42, 0.30], terrainH(x, z) - 5); }
    }
    // Pilotenmarke: Stange mit Fähnchen
    const pf = P.length / 3, fx = pp[0] + 0.6, fy = pp[1]; P.push(fx, fy, 0.6, fx + 0.05, fy, 0.6, fx + 0.05, fy + 2.5, 0.6, fx, fy + 2.5, 0.6); for (let i = 0; i < 4; i++) C.push(0.9, 0.9, 0.9); I.push(pf, pf + 1, pf + 2, pf, pf + 2, pf + 3);
    const Pa = new Float32Array(P), Ia = new Uint32Array(I);
    const o = vao([[prog, 'aP', Pa, 3], [prog, 'aN', normals(Pa, Ia), 3], [prog, 'aC', new Float32Array(C), 3], [prog, 'aT', new Float32Array(P.length / 3 * 2), 2]], Ia);
    world.push({ vao: o.vao, n: Ia.length, bufs: o.bufs });
    cv.style.background = alp ? SKY_ALP : SKY;
    if (alp) {
      // Gebirge: gleichmäßig 8 m um Grat und Flanke, außen geometrisch wachsend bis 12 km (Ketten am Horizont); Normalen aus dem Netz
      const xs = axisPts(pp[0] - 320, pp[0] + 1150, 8, pp[0] - 12000, pp[0] + 12000, 90), zs = axisPts(-1300, 1300, 8, -12000, 12000, 90);
      const nx = xs.length, nz = zs.length, gp = new Float32Array(nx * nz * 3), gi = new Uint32Array((nx - 1) * (nz - 1) * 6);
      for (let i = 0, k = 0; i < nx; i++) for (let j = 0; j < nz; j++, k += 3) { gp[k] = xs[i]; gp[k + 1] = terrainH(xs[i], zs[j]); gp[k + 2] = zs[j]; }
      for (let i = 0, m = 0; i < nx - 1; i++) for (let j = 0; j < nz - 1; j++) { const a = i * nz + j, b = a + 1, c2 = a + nz, d = c2 + 1; gi[m++] = a; gi[m++] = b; gi[m++] = c2; gi[m++] = b; gi[m++] = d; gi[m++] = c2; }
      const g = vao([[gprog, 'aP', gp, 3], [gprog, 'aN', normals(gp, gi), 3]], gi);
      world.ground = g.vao; world.groundBufs = g.bufs; world.groundN = gi.length; world.scene = sceneKey();
      return;
    }
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
    world.ground = g.vao; world.groundBufs = g.bufs; world.groundN = gi.length; world.scene = sceneKey();
  }
  function sceneKey() { const d = hillDims(); return cfg().scene + '/' + d.H + '/' + d.L; }
  // Stützstellen einer Achse: gleichmäßig st in [a, b], außen je n Zellen geometrisch wachsend bis e0 bzw. e1
  function axisPts(a, b, st, e0, e1, n) {
    const mid = []; for (let x = a; x < b - st * 0.5; x += st) mid.push(x); mid.push(b);
    const side = (span, sgn, from) => { let lo = 1.000001, hi = 3; for (let k = 0; k < 80; k++) { const qq = (lo + hi) / 2; if (st * qq * (Math.pow(qq, n) - 1) / (qq - 1) > span) hi = qq; else lo = qq; }
      const qq = (lo + hi) / 2, r = []; let x = from, dd = st; for (let k = 0; k < n; k++) { dd *= qq; x += sgn * dd; r.push(x); } return r; };
    return side(a - e0, -1, a).reverse().concat(mid, side(e1 - b, 1, b));
  }
  function loadAndUpload() {
    draws.forEach(d => { gl.deleteVertexArray(d.vao); }); draws = [];
    texs.forEach(t => gl.deleteTexture(t)); texs = [];
    plane = loadPlane();
    if (plane.err) return;
    const tx = {};
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    const texSetup = rep => { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, rep ? gl.REPEAT : gl.CLAMP_TO_EDGE); if (rep) gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT))); };
    for (const k in plane.tex) {
      const ent = plane.tex[k], t = gl.createTexture(); texs.push(t); gl.bindTexture(gl.TEXTURE_2D, t);
      if (ent.url) {   // Segler aus FlightGear: Bild aus dem Datenpaket, bis dahin hellgrau
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([235, 235, 235, 255])); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        const im = new Image(); im.onload = () => { if (!texs.includes(t)) return; gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im); texSetup(ent.repeat); }; im.src = ent.url;
      } else { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ent.canvas); texSetup(false); }
      tx[k] = { t, m: ent.m };
    }
    plane.meshes.forEach(m => {
      const I = Uint32Array.from(m.I), byG = {};
      for (let k = 0; k < m.G.length; k++) (byG[m.G[k]] = byG[m.G[k]] || []).push(I[3 * k], I[3 * k + 1], I[3 * k + 2]);
      const all = [], parts = []; for (const g in byG) { parts.push({ g: +g, off: all.length * 4, n: byG[g].length }); for (const v of byG[g]) all.push(v); }
      // Normalen: vom Bausatz vorgegeben, sonst gemittelt und nach außen gedreht (Vorzeichen des umschlossenen Volumens)
      let N = m.N;
      if (!N) { N = normals(m.P, I); let vol = 0; const P = m.P; for (let q = 0; q < I.length; q += 3) { const a = 3 * I[q], b = 3 * I[q + 1], c = 3 * I[q + 2];
        vol += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]); }
        if (vol < 0) for (let q = 0; q < N.length; q++) N[q] = -N[q]; }
      const o = vao([[prog, 'aP', m.P, 3], [prog, 'aN', N, 3], [prog, 'aC', new Float32Array(m.C), 3], [prog, 'aT', new Float32Array(m.U), 2]], new Uint32Array(all));
      parts.forEach(p => { const t = m.texKey ? tx[m.texKey] || null : m.tex === 'fus' ? tx.fus : p.g === 2 ? tx[m.tex + 'top'] : p.g === 3 ? tx[m.tex + 'bot'] : null;
        draws.push({ vao: o.vao, off: p.off, n: p.n, tex: t, texMode: m.texMode || 1, spin: m.spin, brake: m.brake, an: m.an || null, alpha: m.alpha !== undefined ? m.alpha : 1, gloss: m.gloss !== undefined ? m.gloss : 1 }); });
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
    // Gebirge: Sicht bis zu den Ketten am Horizont; Nahebene mit dem Abstand zum Modell (Tiefenauflösung über 12 km)
    const alp = isAlpine(), near = alp ? clamp(0.12 * len(sub(sim.p, eye)), 0.1, 2) : 0.1;
    return { vp: mm(persp(fov, asp, near, alp ? 30000 : 6000), lookAt(eye, look, [0, 1, 0])), eye };
  }
  // Bremsklappe: Höhe über der Flächenoberseite (y0 + k·z) mit dem Ausfahrweg b strecken (b = 0: flach in der Fläche)
  function brakeMat(B, b) { return [1, 0, 0, 0, 0, b, 0, 0, 0, (1 - b) * B.k, 1, 0, 0, (1 - b) * B.y0, 0, 1]; }
  function draw() {
    const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect(), w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    if (!plane || plane.err) return;
    if (world.scene !== sceneKey()) buildWorld();
    const { vp, eye } = camera(); lastEye = eye;
    gl.useProgram(gprog);
    const alp = isAlpine(), fog = alp ? FOG_ALP : FOG, GU = n => gl.getUniformLocation(gprog, n);
    gl.uniformMatrix4fv(GU('uVP'), false, vp); gl.uniform3fv(GU('uEye'), eye); gl.uniform3fv(GU('uFog'), fog); gl.uniform1f(GU('uFogD'), alp ? 8000 : 700);
    gl.uniform1f(GU('uRwy'), cfg().scene === 'flat' ? 1 : 0); gl.uniform1f(GU('uMode'), alp ? 2 : isSlope() ? 1 : 0);
    if (alp) { const { H } = alpDims(), pp = pilotPos(); gl.uniform1f(GU('uSnow'), 1.06 * H); gl.uniform1f(GU('uTree'), 0.42 * H); gl.uniform2f(GU('uPP'), pp[0], pp[2]); }
    gl.bindVertexArray(world.ground); gl.drawElements(gl.TRIANGLES, world.groundN, gl.UNSIGNED_INT, 0);
    gl.useProgram(prog);
    const U = n => gl.getUniformLocation(prog, n);
    gl.uniformMatrix4fv(U('uVP'), false, vp); gl.uniform3fv(U('uEye'), eye); gl.uniform3fv(U('uFog'), fog); gl.uniform1f(U('uFogD'), alp ? 8000 : 900);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(U('uTex'), 0);
    if (!texs._none) { texs._none = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texs._none); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); }
    // Welt
    gl.uniform1f(U('uShadow'), 0); gl.uniform1f(U('uUse'), 0); gl.uniform1f(U('uGloss'), 0); gl.uniform4f(U('uTM'), 0, 0, 1, 1); gl.bindTexture(gl.TEXTURE_2D, texs._none);
    gl.uniformMatrix4fv(U('uM'), false, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    world.forEach(o => { gl.bindVertexArray(o.vao); gl.drawElements(gl.TRIANGLES, o.n, gl.UNSIGNED_INT, 0); });
    // Flugzeug + Schatten
    const M0 = modelMat(sim.R, sim.p), pc = Math.cos(sim.propA || 0), ps = Math.sin(sim.propA || 0);
    const Mp = mm(M0, [1, 0, 0, 0, 0, pc, ps, 0, 0, -ps, pc, 0, 0, 0, 0, 1]);   // Drehung um Körper-X (Propellerachse)
    const rps = (sim.rpm || 0) / 60, discA = clamp((rps - 8) / 40, 0, 0.45);   // Scheibe erst bei hoher Drehzahl
    gl.uniform1f(U('uAlpha'), 1);
    const brk = plane.brakes ? clamp(sim.thr, 0, 1) : 0;
    const uc = sim.u || { ail: 0, ele: 0, rud: 0 };
    const drawPlane = (shadow, glass) => draws.forEach(d => {
      if (d.spin === 'disc' || !!glass !== (d.alpha < 1)) return;   // Glas getrennt und zuletzt
      if (d.brake && brk < 0.01) return;   // eingefahrene Bremsklappe liegt bündig in der Fläche
      gl.uniformMatrix4fv(U('uM'), false, d.an ? mm(M0, animMat(d.an, uc, brk)) : d.brake ? mm(M0, brakeMat(d.brake, brk)) : d.spin ? Mp : M0);
      gl.bindVertexArray(d.vao);
      if (!shadow) { gl.uniform1f(U('uGloss'), d.gloss || 0); gl.uniform1f(U('uAlpha'), d.alpha < 1 ? d.alpha : 1); gl.bindTexture(gl.TEXTURE_2D, d.tex ? d.tex.t : texs._none); gl.uniform1f(U('uUse'), d.tex ? d.texMode || 1 : 0); const m = d.tex ? d.tex.m : [0, 0, 1, 1]; gl.uniform4f(U('uTM'), m[0], m[1], m[2], m[3]); }
      gl.drawElements(gl.TRIANGLES, d.n, gl.UNSIGNED_INT, d.off);
    });
    drawPlane(false);
    if (draws.some(d => d.alpha < 1)) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); drawPlane(false, true); gl.depthMask(true); gl.disable(gl.BLEND); gl.uniform1f(U('uAlpha'), 1); }
    if (discA > 0.01) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.uniform1f(U('uAlpha'), discA); gl.uniformMatrix4fv(U('uM'), false, M0); gl.uniform1f(U('uUse'), 0); gl.uniform1f(U('uGloss'), 0); gl.bindTexture(gl.TEXTURE_2D, texs._none);
      draws.forEach(d => { if (d.spin === 'disc') { gl.bindVertexArray(d.vao); gl.drawElements(gl.TRIANGLES, d.n, gl.UNSIGNED_INT, d.off); } }); gl.uniform1f(U('uAlpha'), 1); gl.depthMask(true); gl.disable(gl.BLEND); }
    gl.uniform1f(U('uGY'), terrainH(sim.p[0], sim.p[2]) + 0.06);
    if (sim.p[1] - terrainH(sim.p[0], sim.p[2]) < 150) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.uniform1f(U('uShadow'), 1); drawPlane(true); gl.uniform1f(U('uShadow'), 0); gl.depthMask(true); gl.disable(gl.BLEND); }
  }
  function showHud(u) {
    if (!plane || plane.err) { hud.innerHTML = '<b>' + T('Flugsimulator') + '</b><br><span style="color:#e0a040">⚠ ' + ((plane && plane.err) || '') + '</span>'; msg.textContent = ''; return; }
    const V = len(sim.v), dist = Math.hypot(sim.p[0], sim.p[2]), f1 = v => v.toFixed(1);
    const pitch = Math.asin(clamp(sim.R[0][1], -1, 1)) * 180 / Math.PI, bank = Math.atan2(-sim.R[2][1], sim.R[1][1]) * 180 / Math.PI;
    let s = '<b>' + T('Flugsimulator') + '</b> — ' + (cfg().cam === 'pilot' ? T('Pilotensicht') : T('Verfolgerkamera')) + (paused ? ' · ' + T('PAUSE') : '') +
      '<br>' + T('Fahrt') + ' ' + f1(V * 3.6) + ' km/h · ' + T('Höhe über Grund') + ' ' + f1(Math.max(0, sim.p[1] - terrainH(sim.p[0], sim.p[2]))) + ' m' + (isHill() ? ' (' + T('über Pilot') + ' ' + f1(sim.p[1] - pilotPos()[1]) + ' m)' : '') + ' · ' + T('Steigen') + ' ' + (sim.vario >= 0 ? '+' : '') + f1(sim.vario) + ' m/s · ' + T('Entfernung') + ' ' + Math.round(dist) + ' m' +
      '<br>' + T(plane.brakes ? 'Bremsklappen' : 'Gas') + ' ' + Math.round(sim.thr * 100) + ' % · ' + T('Längsneigung') + ' ' + Math.round(pitch) + '° · ' + T('Querlage') + ' ' + Math.round(bank) + '°' + (sim.stalled ? ' · <b style="color:#ff7050">' + T('Strömungsabriss') + '</b>' : '') +
      '<br><span style="opacity:.75">' + T('Modell') + ': ' + T('Spannweite') + ' ' + f1(plane.b * 1000) + ' mm · ' + T('Masse') + ' ' + Math.round(plane.m * 1000) + ' g · ' + T('Flächenbelastung') + ' ' + f1(plane.m * 1000 / (plane.S * 100)) + ' g/dm² · v₀ ' + f1(trimSpeed() * 3.6) + ' km/h' + (isAlpine() ? ' · ' + Math.round(ALP_BASE + sim.p[1]) + ' ' + T('m NN') + ' · ' + T('Luftdichte') + ' ' + rhoAt(sim.p[1]).toFixed(2) + ' kg/m³' : '') + '</span>' +
      '<br><span style="opacity:.75">' + T('Pfeiltasten = Höhe/Quer · A/D = Seite · W/S = Gas · Leertaste = Handstart · B = Bodenstart · R = neu · C = Kamera · P = Pause · Rad = Zoom') + '</span>';
    if (u.padInfo) s += '<br><span style="opacity:.6;font-size:11px">🎮 ' + u.padInfo + '</span>';
    hud.innerHTML = s;
    msg.textContent = sim.crashed ? sim.crashed + ' — ' + T('Leertaste = Handstart · B = Bodenstart') : paused ? T('Pause') : sim.wait ? T('Leertaste = Handstart · B = Bodenstart') : '';
  }
  function frame(ts) {
    raf = 0;
    if (state.activeTab !== 'fsim' || !win || !win.isConnected) { audioUpdate(false); return; }
    const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0); last = ts;
    let u = { ail: 0, ele: 0, rud: 0 };
    padTick();
    if (plane && !plane.err) {
      u = readInputs(dt); sim.u = u;
      if (!paused) { const n = Math.max(1, Math.ceil(dt / 0.004)); for (let i = 0; i < n; i++) step(dt / n, u); }
      therm.forEach(th => { th.life -= dt; th.x += Math.cos((cfg().windDir || 0) * Math.PI / 180) * cfg().wind * dt; if (th.life < 0) Object.assign(th, newTherm()); });
    }
    draw(); showHud(u); audioUpdate(!paused && !sim.crashed); padMonitor(u);
    if (thrBox) { const bk = !!(plane && plane.brakes), m = thrustMax() > 0 || bk; thrBox.style.display = m ? '' : 'none'; if (m) { const lb = thrBox.querySelector('.fsThrL'), lt = T(bk ? 'Bremse' : 'Gas'); if (lb.textContent !== lt) lb.textContent = lt; const pc = Math.round(sim.thr * 100); thrBox.querySelector('.fsThr').style.height = pc + '%'; thrBox.querySelector('.fsThrT').textContent = pc + ' %'; } }
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
    selectRow(g0.body, 'Flugzeug', [['f3f', 'F3F-Hangrennsegler (Standard)'], ['su26', 'Kunstflug-Motormodell Sukhoi Su-26M'], ['ls4', 'Scale-Segler Rolladen-Schneider LS4'], ['ask21', 'Scale-Segler Schleicher ASK 21'], ['ka6', 'Scale-Segler Schleicher Ka 6 CR'], ['arcus', 'Scale-Segler Schempp-Hirth Arcus'], ['dg300', 'Scale-Segler Glaser-Dirks DG-300'], ['own', 'Eigenes Flugzeug (Flugzeug gesamt)']], () => c.plane, v => { c.plane = v; saveLs(); RB(); if (gl) { loadAndUpload(); reset(); } });
    if (c.plane === 'own') hint(g0.body, 'Fliegt das Flugzeug aus „Flugzeug gesamt“ wie ein Modellflugzeug. Fläche und Streckung kommen aus der Haupttragfläche; Masse aus der Flächenbelastung oder fest. Fernsteuerung: Sender per USB anstecken (meldet sich als Joystick) und einen Knüppel bewegen.');
    else if (c.plane === 'su26') hint(g0.body, 'Eingebaute Sukhoi Su-26M im Maßstab 1:3: 2,60 m Spannweite, rund 130 dm², symmetrisches Profil, Schub knapp das Doppelte des Gewichts — senkrecht steigen, Torque-Rolle, Messerflug. Bodenstart mit B, dann Gas geben. Fernsteuerung: Sender per USB anstecken (meldet sich als Joystick) und einen Knüppel bewegen.');
    else if (isFg()) { const D = window.FsimGliders && window.FsimGliders[c.plane], sp = D ? D.ref.span / fgScale(c.plane) : 0, dec = x => (window.I18N && window.I18N.getLang && window.I18N.getLang() === 'en') ? x : x.replace('.', ',');
      hint(g0.body, T('Vorbildgetreues 3D-Modell aus FlightGear') + ' (' + (D ? T(D.credit) : '—') + '; ' + T('Lizenz GNU GPL v2 oder später') + '). ' + T('Spannweite') + ' ' + dec(sp.toFixed(2)) + ' m ' + T('beim gewählten Maßstab') + '. ' +
        T('Bremsklappen auf dem Gasknüppel (W/S); Querruder, Höhen- und Seitenruder und Klappen bewegen sich mit. Fernsteuerung: Sender per USB anstecken (meldet sich als Joystick) und einen Knüppel bewegen.')); }
    else hint(g0.body, 'Eingebauter F3F-Hangrennsegler: 2,95 m Spannweite, rund 60 dm², V-Leitwerk, ohne Motor — ideal für den Hang. Fernsteuerung: Sender per USB anstecken (meldet sich als Joystick) und einen Knüppel bewegen.');
    if (c.plane === 'own') numRow(g0.body, 'Flächenbelastung (g/dm²)', () => c.load, v => { c.load = clamp(v, 5, 200); reloadPhys(); }, Object.assign({ step: 1, min: 5 }, NR));
    else if (c.plane === 'su26') numRow(g0.body, 'Flächenbelastung (g/dm²)', () => c.loadSu26, v => { c.loadSu26 = clamp(v, 5, 200); reloadPhys(); }, Object.assign({ step: 1, min: 5 }, NR));
    else if (isFg()) {
      numRow(g0.body, 'Maßstab 1:', () => fgScale(c.plane), v => { c.fgScale[c.plane] = clamp(v, 1, 12); saveLs(); if (gl) { loadAndUpload(); reset(); } RB(); }, Object.assign({ step: 0.5, min: 1 }, NR));
      numRow(g0.body, 'Flächenbelastung (g/dm²)', () => fgLoad(c.plane), v => { c.fgLoad[c.plane] = clamp(v, 5, 250); saveLs(); reloadPhys(); }, Object.assign({ step: 1, min: 5 }, NR));
    }
    else numRow(g0.body, 'Flächenbelastung (g/dm²)', () => c.loadF3f, v => { c.loadF3f = clamp(v, 5, 200); reloadPhys(); }, Object.assign({ step: 1, min: 5 }, NR));
    numRow(g0.body, 'Masse fest (g, 0 = aus Belastung)', () => c.mass, v => { c.mass = Math.max(0, v); reloadPhys(); }, Object.assign({ step: 10, min: 0 }, NR));
    numRow(g0.body, 'Schwerpunkt (% Bezugsflügeltiefe)', () => c.cgPct, v => { c.cgPct = clamp(v, 0, 60); }, Object.assign({ step: 1 }, NR));
    numRow(g0.body, 'Neutralpunkt (% Bezugsflügeltiefe)', () => c.npPct, v => { c.npPct = clamp(v, 10, 80); }, Object.assign({ step: 1 }, NR));
    hint(g0.body, 'Stabilitätsmaß = Neutralpunkt − Schwerpunkt. Um 10 % fliegt es ruhig; kleiner wird es nervös und das Höhenruder wirkt stärker, liegt der Schwerpunkt hinter dem Neutralpunkt, ist das Modell instabil.');
    if (c.plane === 'own') numRow(g0.body, 'Nullwiderstand cW₀', () => c.cd0, v => { c.cd0 = clamp(v, 0.005, 0.3); }, Object.assign({ step: 0.005 }, NR));
    if (c.plane === 'own') boolRow(g0.body, 'Motor', () => c.motor, v => { c.motor = v; RB(); });
    if (c.plane === 'own' && c.motor) numRow(g0.body, 'Standschub (N, 0 = automatisch)', () => c.thrust, v => { c.thrust = Math.max(0, v); }, Object.assign({ step: 0.5, min: 0 }, NR));
    if (c.plane === 'own' || c.plane === 'su26') { boolRow(g0.body, 'Motorgeräusch', () => c.sound, v => { c.sound = v; if (v) audioInit(); saveLs(); RB(); }); if (c.sound) numRow(g0.body, 'Lautstärke (%)', () => c.vol, v => { c.vol = clamp(v, 0, 100); saveLs(); }, Object.assign({ step: 5 }, NR)); }
    selectRow(g0.body, 'Kamera', [['pilot', 'Pilot am Boden'], ['chase', 'Verfolgerkamera']], () => c.cam, v => { c.cam = v; });
    side.appendChild(g0.g);
    const gL = grp('Landschaft', true, 'fsim', { key: 'fsimScene' });
    selectRow(gL.body, 'Gelände', [['flat', 'Flugplatz (eben)'], ['slope', 'Hang zum Hangfliegen'], ['alpine', 'Hochalpiner Grat (Hangflug im Gebirge)']], () => c.scene, v => { c.scene = v; if (v !== 'flat') { c.windDir = 180; if (c.wind < 5) c.wind = v === 'alpine' ? 6 : 7; } saveLs(); RB(); reset(); });
    if (c.scene === 'slope') {
      hint(gL.body, 'Der Pilot steht an der Hangkante, der Wind weht aus dem Tal (180°) gegen den Hang. Vor und über der Kante steigt die Luft — dort mit dem Segler hin- und herfliegen, Wenden immer vom Hang weg. Hinter der Kante (Lee) sinkt es und ist böig.');
      numRow(gL.body, 'Hanghöhe (m)', () => c.slopeH, v => { c.slopeH = clamp(v, 10, 300); reset(); }, Object.assign({ step: 5 }, NR));
      numRow(gL.body, 'Hangneigung (°)', () => c.slopeDeg, v => { c.slopeDeg = clamp(v, 10, 60); reset(); }, Object.assign({ step: 5 }, NR));
    }
    if (c.scene === 'alpine') {
      hint(gL.body, 'Der Pilot steht auf einem Grat, die Flanke fällt mehrere hundert Meter ins Tal (Talboden 1700 m, Grat mit den Standardwerten 2400 m über dem Meer). Der Wind kommt aus dem Tal (180°) und steigt an der Flanke auf — das Aufwindband reicht weit hinauf. Die Luft ist dünner (rund 0,97 statt 1,23 kg/m³): das Modell fliegt schneller und braucht mehr Platz. Hinter dem Grat (Lee) sinkt es kräftig und ist böig. Rechts ein Gipfel mit Kreuz, hinten eine Hütte, gegenüber eine Bergkette.');
      numRow(gL.body, 'Grathöhe über dem Tal (m)', () => c.alpH, v => { c.alpH = clamp(v, 200, 1500); reset(); }, Object.assign({ step: 50 }, NR));
      numRow(gL.body, 'Flankenneigung (°)', () => c.alpDeg, v => { c.alpDeg = clamp(v, 20, 60); reset(); }, Object.assign({ step: 5 }, NR));
    }
    side.appendChild(gL.g);
    const g1 = grp('Wetter', false, 'fsim', { key: 'fsimWx' });
    numRow(g1.body, 'Wind (m/s)', () => c.wind, v => { c.wind = clamp(v, 0, 20); }, Object.assign({ step: 0.5, min: 0 }, NR));
    numRow(g1.body, 'Windrichtung (°)', () => c.windDir, v => { c.windDir = ((v % 360) + 360) % 360; }, Object.assign({ step: 15 }, NR));
    boolRow(g1.body, 'Thermik', () => c.thermal, v => { c.thermal = v; }, 'Einige unsichtbare Aufwindblasen, die mit dem Wind wandern.');
    side.appendChild(g1.g);
    const g2 = grp('Fernsteuerung', false, 'fsim', { key: 'fsimCtl' });
    padSidebar(g2.body);
    side.appendChild(g2.g);
    const g3 = grp('Ruderausschläge', false, 'fsim', { key: 'fsimRates' });
    rateSidebar(g3.body);
    side.appendChild(g3.g);
  }
  function reloadPhys() { if (plane && !plane.err) plane.m = massOf(plane.S); }

  // ---------- Fernsteuerung in der Seitenleiste: Achsen live, Zuordnung, Anlernen, Kalibrieren ----------
  let mon = null;   // Live-Anzeige (wird je Bild aus frame() nachgeführt)
  function mkBar(h) {
    const t = document.createElement('div'); t.style.cssText = 'position:relative;height:' + (h || 10) + 'px;background:var(--field,#0c0f13);border:1px solid var(--line);border-radius:3px;overflow:hidden;min-width:0';
    const r = document.createElement('div'); r.style.cssText = 'position:absolute;top:0;bottom:0;background:color-mix(in srgb,var(--accent) 28%,transparent);display:none';   // Kalibrier-Weg
    const m = document.createElement('div'); m.style.cssText = 'position:absolute;left:50%;top:0;bottom:0;width:1px;background:var(--line)';
    const f = document.createElement('div'); f.style.cssText = 'position:absolute;top:1px;bottom:1px;left:50%;width:2px;background:var(--accent);border-radius:2px';
    t.append(r, m, f); return { t, f, r, m };
  }
  function setBar(b, v, uni) {   // v −1…1 von der Mitte; uni: 0…1 von links
    if (v === null || v === undefined || !isFinite(v)) { b.f.style.display = 'none'; return; }
    b.f.style.display = '';
    if (uni) { b.f.style.left = '0'; b.f.style.width = 'max(2px,' + (clamp(v, 0, 1) * 100).toFixed(1) + '%)'; return; }
    v = clamp(v, -1, 1); b.f.style.left = (v >= 0 ? 50 : 50 + v * 50).toFixed(1) + '%'; b.f.style.width = 'max(2px,' + (Math.abs(v) * 50).toFixed(1) + '%)';
  }
  function smallBtn(t, tip, fn, pr) { const b = document.createElement('button'); b.textContent = T(t); b.style.padding = '2px 8px'; if (tip) b.title = T(tip); if (pr) b.className = 'primary'; b.onclick = fn; return b; }
  const padSig = gp => gp ? gp.id + '|' + gp.axes.length : '';
  function padSidebar(body) {
    const { hint, numRow, selectRow } = App, c = cfg(), P = c.pad, RB = () => App.buildSidebar();
    mon = { root: body, sig: padSig(curPad()), ax: [], ref: [], moveT: [], fn: {}, out: {}, msg: null, msgT: null };
    if (!navigator.getGamepads) { hint(body, 'Dieser Browser bietet keine Gamepad-Schnittstelle — Steuerung nur per Tastatur.'); return; }
    const list = padList(), gp = curPad();
    if (!gp) {
      hint(body, 'Kein Sender erkannt. Sender per USB anstecken (meldet sich als Joystick) und einen Knüppel bewegen — der Browser meldet ihn erst nach der ersten Bewegung. Dann erscheinen hier alle Achsen.');
      return;
    }
    if (list.length > 1) selectRow(body, 'Sender / Joystick', list.map(g => [g.id, g.id.length > 44 ? g.id.slice(0, 42) + '…' : g.id]), () => gp.id, v => { P.dev = v; saveLs(); RB(); });
    const cal = calOf(gp);
    const st = document.createElement('div'); st.style.cssText = 'font-size:11px;color:var(--muted);word-break:break-word';   // keine .hint: bleibt bei eingeklappten Beschreibungen sichtbar
    st.textContent = '🎮 ' + gp.id + ' · ' + gp.axes.length + ' ' + T('Achsen') + ' · ' + (cal ? T('kalibriert') : T('nicht kalibriert'));
    body.appendChild(st);
    // Alle Achsen live: Rohwert, Balken, zugeordnete Funktion; die gerade bewegte Achse leuchtet auf
    const hd = document.createElement('div'); hd.style.cssText = 'font-size:12px;font-weight:600;margin-top:4px'; hd.textContent = T('Alle Achsen (live)'); body.appendChild(hd);
    const box = document.createElement('div'); box.style.cssText = 'display:grid;gap:3px'; body.appendChild(box);
    const tagOf = i => FN.filter(f => +P[f[0]] === i).map(f => T(f[2])).join(', ');
    gp.axes.forEach((v, i) => {
      const row = document.createElement('div'); row.style.cssText = 'display:grid;grid-template-columns:50px 1fr 40px 74px;gap:5px;align-items:center;font-size:11px';
      const l = document.createElement('span'); l.textContent = T('Achse') + ' ' + i;
      const b = mkBar(10);
      const vt = document.createElement('span'); vt.style.cssText = 'font-family:monospace;text-align:right';
      const tg = document.createElement('span'); tg.textContent = tagOf(i); tg.title = tagOf(i); tg.style.cssText = 'color:var(--accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      row.append(l, b.t, vt, tg); box.appendChild(row);
      mon.ax[i] = { l, b, vt, act: false };
    });
    // Zuordnung der Funktionen
    const hz = document.createElement('div'); hz.style.cssText = 'font-size:12px;font-weight:600;margin-top:6px'; hz.textContent = T('Zuordnung'); body.appendChild(hz);
    hint(body, 'Knüppel bewegen: die bewegte Achse leuchtet oben auf — dann hier auswählen. Einfacher: „Anlernen“ drücken und den Knüppel wie angezeigt bewegen, Achse und Richtung werden selbst erkannt. Richtig ist es, wenn der Balken der Funktion nach rechts geht bei Quer rechts, Höhe gezogen, Seite rechts und Vollgas.');
    const msg = document.createElement('div'); msg.style.cssText = 'display:none;font-size:12px;font-weight:600;color:var(--accent);padding:4px 6px;border:1px solid var(--accent);border-radius:5px'; body.appendChild(msg); mon.msg = msg;
    const N = Math.max(8, gp.axes.length), opts = [['-1', '— keine —']].concat(Array.from({ length: N }, (_, i) => [String(i), T('Achse') + ' ' + i]));
    FN.forEach(([k, inv, lab]) => {
      selectRow(body, lab, opts, () => String(+P[k] >= 0 ? +P[k] : -1), v => { P[k] = +v; saveLs(); RB(); });
      const row = document.createElement('div'); row.style.cssText = 'display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;margin:-2px 0 4px';
      const lb = document.createElement('label'); lb.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;white-space:nowrap';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!P[inv]; cb.onchange = () => { P[inv] = cb.checked; saveLs(); };
      lb.append(cb, document.createTextNode(T('umkehren')));
      const b = mkBar(8);
      const on = learn && learn.k === k;
      const lbtn = smallBtn(on ? 'Abbrechen' : 'Anlernen', 'Achse und Richtung durch Bewegen des Knüppels erkennen', () => { learnStart(k); RB(); }, on);
      row.append(lb, b.t, lbtn); body.appendChild(row);
      mon.fn[k] = { b };
    });
    // Kalibrieren
    const hk = document.createElement('div'); hk.style.cssText = 'font-size:12px;font-weight:600;margin-top:6px'; hk.textContent = T('Kalibrieren'); body.appendChild(hk);
    if (calib) hint(body, 'Alle Knüppel, Schieber und Drehgeber mehrmals bis an beide Anschläge bewegen. Dann die Knüppel loslassen (Mitte) und „Fertig“ drücken.');
    else hint(body, 'Gleicht Sender aus, deren Knüppel nicht ganz bis ±1 reichen oder deren Mitte nicht bei 0 liegt. Ohne Kalibrierung gilt der Rohwert.');
    const br = document.createElement('div'); br.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    if (calib) br.append(smallBtn('Fertig', 'Anschläge und Mitte übernehmen', () => { calibDone(); RB(); }, true), smallBtn('Abbrechen', '', () => { calib = null; RB(); }));
    else {
      br.append(smallBtn('Kalibrieren', 'Anschläge und Mitte aller Achsen messen', () => { calibStart(); RB(); }));
      if (cal) br.append(smallBtn('Kalibrierung löschen', 'Wieder die Rohwerte des Senders verwenden', () => { delete P.cal[gp.id]; note(T('Kalibrierung gelöscht')); saveLs(); RB(); }));
    }
    body.appendChild(br);
    numRow(body, 'Totzone um die Mitte (%)', () => P.dz, v => { P.dz = clamp(v, 0, 30); saveLs(); }, { step: 1, min: 0, max: 30, norender: true, enter: true,
      hint: 'Kleine Bewegungen um die Knüppelmitte werden ignoriert (gegen Zittern); der Vollausschlag bleibt erhalten.' });
  }
  function rateSidebar(body) {
    const { hint, numRow } = App, c = cfg(), NR = { norender: true, enter: true };
    if (!mon) mon = { root: body, sig: padSig(curPad()), ax: [], ref: [], moveT: [], fn: {}, out: {}, msg: null, msgT: null };
    hint(body, 'Ausschlag = Ruderweg bei vollem Knüppelausschlag: 100 % ist der Standard des Modells, weniger macht es zahmer, mehr (bis 200 %) wendiger — z. B. für Kunstflug. Expo macht die Knüppelmitte weicher, der Vollausschlag bleibt. Gilt für Sender und Tastatur.');
    SURF.forEach(([k, s, lab, lr, le]) => {
      const row = document.createElement('div'); row.className = 'row'; row.style.marginTop = '4px';
      const l = document.createElement('label'); l.style.fontWeight = '600';
      const nm = document.createElement('span'); nm.textContent = T(lab);
      const vt = document.createElement('span'); vt.style.cssText = 'display:block;font:11px monospace;font-weight:400;color:var(--muted)';
      l.append(nm, vt);
      const cv = document.createElement('canvas'); cv.style.cssText = 'width:92px;height:46px;border:1px solid var(--line);border-radius:4px;background:var(--field,#0c0f13)';
      cv.title = T('Kurve: Knüppel (waagrecht) → Ruderausschlag (senkrecht), Punkt = jetzt');
      row.append(l, cv); body.appendChild(row);
      mon.out[k] = { cv, vt, key: '' };
      numRow(body, lr, () => c['rate' + s], v => { c['rate' + s] = clamp(v, 10, 200); saveLs(); }, Object.assign({ step: 5, min: 10, max: 200 }, NR));
      numRow(body, le, () => c['expo' + s], v => { c['expo' + s] = clamp(v, 0, 100); saveLs(); }, Object.assign({ step: 5, min: 0, max: 100 }, NR));
    });
  }
  function drawCurve(o, s, x, y) {
    const c = cfg(), rate = clamp(isFinite(+c['rate' + s]) ? +c['rate' + s] : 100, 0, 200) / 100, e = clamp(+c['expo' + s] || 0, 0, 100) / 100;
    const key = rate + '|' + e + '|' + x.toFixed(3);
    if (key === o.key) return; o.key = key;
    o.vt.textContent = (y >= 0 ? '+' : '−') + Math.abs(Math.round(y * 100)) + ' %';
    const cv = o.cv, dpr = window.devicePixelRatio || 1, W = Math.round(92 * dpr), H = Math.round(46 * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d'), cs = getComputedStyle(cv), acc = cs.getPropertyValue('--accent').trim() || '#4aa3ff', ln = cs.getPropertyValue('--line').trim() || '#444', mu = cs.getPropertyValue('--muted').trim() || '#888';
    const sc = Math.max(1, rate), px = v => (v + 1) / 2 * (W - 4 * dpr) + 2 * dpr, py = v => H / 2 - v / sc * (H / 2 - 3 * dpr);
    g.clearRect(0, 0, W, H); g.lineWidth = dpr;
    g.strokeStyle = ln; g.beginPath(); g.moveTo(px(0), 0); g.lineTo(px(0), H); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    if (sc > 1) { g.setLineDash([2 * dpr, 2 * dpr]); g.strokeStyle = mu; g.beginPath(); g.moveTo(0, py(1)); g.lineTo(W, py(1)); g.moveTo(0, py(-1)); g.lineTo(W, py(-1)); g.stroke(); g.setLineDash([]); }   // 100 %
    g.strokeStyle = acc; g.lineWidth = 1.5 * dpr; g.beginPath();
    for (let i = 0; i <= 40; i++) { const xi = i / 20 - 1, yi = expo(xi, e) * rate; if (i) g.lineTo(px(xi), py(yi)); else g.moveTo(px(xi), py(yi)); }
    g.stroke();
    g.fillStyle = acc; g.beginPath(); g.arc(px(clamp(x, -1, 1)), py(y), 2.6 * dpr, 0, 2 * Math.PI); g.fill();
  }
  function padMonitor(u) {
    if (!mon) return;
    if (!mon.root.isConnected) { mon = null; return; }
    const gp = curPad();
    if (padSig(gp) !== mon.sig) { mon = null; RBs(); return; }   // Sender angesteckt/abgezogen → Seitenleiste neu
    const now = performance.now(), vis = mon.root.offsetParent !== null;
    if (gp && vis) gp.axes.forEach((v, i) => {
      const r = mon.ax[i]; if (!r) return;
      const ok = isFinite(v);
      if (ok && (mon.ref[i] === undefined || Math.abs(v - mon.ref[i]) > 0.05)) { if (mon.ref[i] !== undefined) mon.moveT[i] = now; mon.ref[i] = v; }
      setBar(r.b, ok ? v : null); r.vt.textContent = ok ? (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) : '—';
      const act = now - (mon.moveT[i] || -1e9) < 800;
      if (act !== r.act) { r.act = act; r.l.style.color = act ? 'var(--accent)' : ''; r.l.style.fontWeight = act ? '700' : ''; r.b.t.style.borderColor = act ? 'var(--accent)' : ''; }
      if (calib && calib.lo[i] !== undefined) { const lo = clamp(calib.lo[i], -1, 1), hi = clamp(calib.hi[i], -1, 1); r.b.r.style.display = ''; r.b.r.style.left = ((lo + 1) * 50).toFixed(1) + '%'; r.b.r.style.width = ((hi - lo) * 50).toFixed(1) + '%'; }
      else r.b.r.style.display = 'none';
    });
    if (vis) FN.forEach(([k]) => { const r = mon.fn[k]; if (!r) return; const v = gp ? fnVal(gp, k) : null; setBar(r.b, v === null ? null : k === 'thr' ? (v + 1) / 2 : v, k === 'thr'); });
    if (mon.msg) {
      const t = learn ? T(LEARN_TXT[learn.k]) : calib ? T('Kalibrierung läuft — alle Knüppel bis an die Anschläge bewegen …') : padNote && now - padNote.t < 5000 ? padNote.text : '';
      if (t !== mon.msgT) { mon.msgT = t; mon.msg.textContent = t; mon.msg.style.display = t ? '' : 'none'; }
    }
    SURF.forEach(([k, s]) => { const o = mon.out[k]; if (o && o.cv.offsetParent !== null) drawCurve(o, s, ctl[k] || 0, (u && u[k]) || 0); });
  }

  App.fsimSidebar = fsimSidebar;
  window.Flugsim = { show, reset, _test: { terrainH, windAt, pilotPos, rhoAt, trimSpeed, buildWorld: () => buildWorld(), world: () => world, cfg, sim: () => sim, plane: () => plane, setPlane: () => { plane = loadPlane(); return plane; }, pause: v => { paused = !!v; }, animMat, step, loadPlane, keys: () => keys,
    readInputs, padTick, fnVal, curPad, learnStart, calibStart, calibDone, learn: () => learn, calib: () => calib, mon: () => mon } };
})();
