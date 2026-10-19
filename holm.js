/* holm.js — Reiter „Holmauslegung" (optionales Feature `holm`)
 *
 * Statische Vorbemessung der aktiven Tragfläche (Halbspannweite, eingespannt an
 * der Wurzel):
 *   - Lastverteilung 1 g aus dem VLM des Reiters „Aerodynamik" (Aero.spanLoad),
 *     sonst nach Schrenk bzw. elliptisch; Betrag = Masse · g · Auftriebsanteil / 2.
 *   - Querkraft Q(y) und Biegemoment M(y) von der Spitze nach innen integriert,
 *     Bemessung mit Sicherheitsfaktor j · Lastvielfaches n (+ und −).
 *   - Holmgurte (Ober-/Untergurt getrennt): Gurtkraft F = M / h_eff, nötige Fläche
 *     aus Druck- bzw. Zugfestigkeit des UD-Geleges; Breite innen/außen vorgegeben,
 *     daraus Lagenzahl je Station und Abstufung (Lagenlängen + Zugabe).
 *   - Holmstege: Querkraft per Schubgleitung (Kern + optionale ±45°-Beschichtung,
 *     dehnungsverträglich), daraus Anzahl Stege je Abschnitt.
 *   - Schale gegen Torsion (Bredt): Torsionsmoment aus c_m0 bei V_NE plus
 *     Auftrieb · Hebel (Viertelpunkt ↔ Holm), Schubfluss q = T / (2·A_m),
 *     Lagenzahl Gewebe, Verdrehung an der Spitze.
 *
 * Einstellungen je Tragfläche in state.cfg.holm (WING_CFG_KEYS), Werkstoffliste
 * projektweit in state.cfg.holmMats (mit Standardgeweben/-gelegen vorbelegt).
 * Einheiten intern: N, mm, N/mm² (= MPa).
 * Andere Module rufen dieses Modul nur geschützt auf (window.Holm, App.holmSidebar).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const T = s => window.I18N ? window.I18N.t(s) : s;
  const state = App.state;
  const G = 9.81, DEG = Math.PI / 180, RHO_RESIN = 1.15, N_ST = 240;

  // ---------- Werkstoffe ----------------------------------------------------
  // kind 'ud' = UD-Gelege (Gurt), 'fab' = Gewebe (Schale, Stegbeschichtung, auch
  // als Gurt wählbar), 'core' = Stegwerkstoff. Laminatwerte gelten beim
  // angegebenen Faservolumenanteil vf (Vakuum/Handlaminat, Epoxid).
  // E/G in GPa, Festigkeiten in MPa; Stegwerkstoffe: G/τ in MPa, ρ in kg/m³, t in mm.
  const CF = { fiber: 'cf', rhoF: 1.78 }, GF = { fiber: 'gf', rhoF: 2.55 }, AF = { fiber: 'af', rhoF: 1.44 };
  const udCF = gsm => Object.assign({ kind: 'ud', gsm, vf: 0.5, E: 115, st: 1300, sc: 850 }, CF);
  const fabCF = gsm => Object.assign({ kind: 'fab', gsm, vf: 0.45, E: 55, st: 550, sc: 450, G45: 17, tau45: 250, G090: 4, tau090: 70 }, CF);
  const fabGF = gsm => Object.assign({ kind: 'fab', gsm, vf: 0.4, E: 20, st: 300, sc: 250, G45: 6.5, tau45: 130, G090: 3.5, tau090: 55 }, GF);
  // Rovings (Gurt): Garnfeinheit tex = g je km; Laminatquerschnitt je Roving = tex / (1000 · ρF · φ)
  const rovCF = tex => Object.assign({ kind: 'rov', tex, vf: 0.5, E: 115, st: 1300, sc: 850 }, CF);
  const ROV_PRESETS = [
    Object.assign(rovCF(200), { id: 'cf_rov3k', name: 'Kohle-Roving 3k (200 tex)' }),
    Object.assign(rovCF(800), { id: 'cf_rov12k', name: 'Kohle-Roving 12k (800 tex)' }),
    Object.assign(rovCF(800), { id: 'cf_rovT700', name: 'Kohle-Roving T700 12k (800 tex)', E: 125, st: 1500, sc: 900 }),
    Object.assign(rovCF(1600), { id: 'cf_rov24k', name: 'Kohle-Roving 24k (1600 tex)' }),
    Object.assign(rovCF(3300), { id: 'cf_rov50k', name: 'Kohle-Roving 50k (3300 tex)', rhoF: 1.81, E: 110, st: 1150, sc: 800 }),
    Object.assign({ id: 'gf_rov1200', name: 'Glas-Roving 1200 tex', kind: 'rov', tex: 1200, vf: 0.5, E: 38, st: 750, sc: 550 }, GF),
    Object.assign({ id: 'gf_rov2400', name: 'Glas-Roving 2400 tex', kind: 'rov', tex: 2400, vf: 0.5, E: 38, st: 750, sc: 550 }, GF),
    Object.assign({ id: 'af_rov805', name: 'Aramid-Roving 805 tex', kind: 'rov', tex: 805, vf: 0.5, E: 55, st: 1000, sc: 200 }, AF)
  ];
  const MAT_PRESETS = [
    Object.assign(udCF(80), { id: 'cf_ud80', name: 'Kohle-UD-Gelege 80 g/m²' }),
    Object.assign(udCF(125), { id: 'cf_ud125', name: 'Kohle-UD-Gelege 125 g/m²' }),
    Object.assign(udCF(150), { id: 'cf_ud150', name: 'Kohle-UD-Gelege 150 g/m²' }),
    Object.assign(udCF(200), { id: 'cf_ud200', name: 'Kohle-UD-Gelege 200 g/m²' }),
    Object.assign(udCF(300), { id: 'cf_ud300', name: 'Kohle-UD-Gelege 300 g/m²' }),
    Object.assign({ id: 'cf_ud_hm125', name: 'Kohle-UD-Gelege HM 125 g/m²', kind: 'ud', gsm: 125, vf: 0.5, E: 160, st: 1100, sc: 650 }, CF),
    Object.assign({ id: 'gf_ud220', name: 'Glas-UD-Gelege 220 g/m²', kind: 'ud', gsm: 220, vf: 0.5, E: 38, st: 750, sc: 550 }, GF),
    Object.assign(fabCF(93), { id: 'cf_fab93', name: 'Kohlegewebe 93 g/m² (Leinwand)' }),
    Object.assign(fabCF(160), { id: 'cf_fab160', name: 'Kohlegewebe 160 g/m² (Köper)' }),
    Object.assign(fabCF(200), { id: 'cf_fab200', name: 'Kohlegewebe 200 g/m² (Köper)' }),
    Object.assign(fabCF(245), { id: 'cf_fab245', name: 'Kohlegewebe 245 g/m² (Köper)' }),
    Object.assign(fabGF(49), { id: 'gf_fab49', name: 'Glasgewebe 49 g/m²' }),
    Object.assign(fabGF(80), { id: 'gf_fab80', name: 'Glasgewebe 80 g/m²' }),
    Object.assign(fabGF(105), { id: 'gf_fab105', name: 'Glasgewebe 105 g/m²' }),
    Object.assign(fabGF(163), { id: 'gf_fab163', name: 'Glasgewebe 163 g/m²' }),
    Object.assign({ id: 'af_fab61', name: 'Aramidgewebe 61 g/m²', kind: 'fab', gsm: 61, vf: 0.45, E: 28, st: 450, sc: 120, G45: 8, tau45: 100, G090: 2.5, tau090: 45 }, AF),
    { id: 'balsa100', name: 'Balsa stehend 100 kg/m³', kind: 'core', rho: 100, G: 110, tau: 1.9, t: 2 },
    { id: 'balsa150', name: 'Balsa stehend 150 kg/m³', kind: 'core', rho: 150, G: 160, tau: 2.9, t: 2 },
    { id: 'balsaL130', name: 'Balsa liegend (Faser längs) 130 kg/m³', kind: 'core', rho: 130, G: 90, tau: 1.4, t: 2 },
    { id: 'herex60', name: 'Herex C70.55 (60 kg/m³)', kind: 'core', rho: 60, G: 22, tau: 0.85, t: 3 },
    { id: 'herex80', name: 'Herex C70.75 (80 kg/m³)', kind: 'core', rho: 80, G: 30, tau: 1.2, t: 3 },
    { id: 'herex130', name: 'Herex C70.130 (130 kg/m³)', kind: 'core', rho: 130, G: 50, tau: 2.2, t: 2 },
    { id: 'rohacell51', name: 'Rohacell 51 IG (52 kg/m³)', kind: 'core', rho: 52, G: 19, tau: 0.8, t: 3 },
    { id: 'rohacell71', name: 'Rohacell 71 IG (75 kg/m³)', kind: 'core', rho: 75, G: 29, tau: 1.3, t: 3 },
    { id: 'ply_pappel', name: 'Pappelsperrholz', kind: 'core', rho: 450, G: 450, tau: 5, t: 3 },
    { id: 'ply_birke', name: 'Birkensperrholz (Flugzeugsperrholz)', kind: 'core', rho: 700, G: 650, tau: 8, t: 1 }
  ].concat(ROV_PRESETS);
  const clone = o => JSON.parse(JSON.stringify(o));
  function mats() {
    const c = state.cfg;
    if (!Array.isArray(c.holmMats) || !c.holmMats.length) c.holmMats = clone(MAT_PRESETS);
    // Projekte von vor den Rovings: Rovings nachtragen (die letzte Art lässt sich nicht löschen)
    if (!c.holmMats.some(m => m.kind === 'rov')) ROV_PRESETS.forEach(p => c.holmMats.push(clone(p)));
    return c.holmMats;
  }
  const matById = id => mats().find(m => m.id === id) || null;
  const matsOf = (...kinds) => mats().filter(m => kinds.indexOf(m.kind) >= 0);
  // Lagendicke (mm) = Flächengewicht / (Faserdichte · Faservolumenanteil)
  const ply = m => (m && m.gsm > 0 && m.rhoF > 0 && m.vf > 0) ? m.gsm / (1000 * m.rhoF * m.vf) : 0;
  // Laminatquerschnitt je Roving (mm²) = tex / (1000 · ρF · φ)
  const rovA = m => (m && m.kind === 'rov' && m.tex > 0 && m.rhoF > 0 && m.vf > 0) ? m.tex / (1000 * m.rhoF * m.vf) : 0;
  // Fasermassenanteil (für die Laminatmasse)
  const psi = m => { const a = m.vf * m.rhoF; return a / (a + (1 - m.vf) * RHO_RESIN); };

  // ---------- Einstellungen je Tragfläche --------------------------------------
  function defaults() {
    return {
      loadSrc: 'auto', loadCase: 'n', caSrc: 'aero', cmSrc: 'aero', caMax: 1.0, vMax: 150, rovStep: 2,
      caBreak: 1.0, pullD: '10, 20, 40, 80', pullM: '', pullV: 150, pullDc: 20, pullMc: 0, calcMode: 'design', capMode: 'auto', capLenT: '', capLenB: '', webMode: 'auto', webLen: '', shellMode: 'auto', shellLen: '', wMax: 0, wRef: 'n',
      mass: 2500, share: 100, nPos: 8, nNeg: -4, j: 1.5, kRed: 0.8,
      vne: 180, cm0: -0.05, rho: 1.225, polCalc: 'aero',
      xSp: 30, xSpTip: 30, bRoot: 12, bTip: 5, capMat: 'cf_ud200', skinT: 0.3, overlap: 20, capToTip: true,
      webMat: 'balsa100', webT: 2, webCoat: '', webCoatN: 1,
      box: 'full', shellMat: 'cf_fab93', shellOri: '45', shellMin: 1,
      fastMode: 'v', fastV: 150, fastCl: 0.1, fastWmSrc: 'auto', fastWm: 300, fastElastic: true
    };
  }
  function H() {
    const c = state.cfg;
    if (!c.holm || typeof c.holm !== 'object') c.holm = defaults();
    // Altstände ohne Berechnungsvorgabe: aus den bisherigen Einzelschaltern ableiten
    if (c.holm.calcMode === undefined) {
      const mc = c.holm.capMode === 'manual', mw = c.holm.webMode === 'manual';
      c.holm.calcMode = mc && mw ? 'check' : (mc || mw ? 'mixed' : 'design');
    }
    const d = defaults();
    for (const k in d) if (c.holm[k] === undefined) c.holm[k] = d[k];
    return c.holm;
  }

  // Berechnungsvorgabe gilt für alle Bauteile: 'design' = Gurtlagen, Stege und Schale für den
  // Lastfall auslegen, 'check' = eigene Angaben nachrechnen (Bruchlast), 'mixed' = je Bauteil
  // einzeln (h.capMode/webMode/shellMode).
  function modes(h) {
    if (h.calcMode === 'check') return { cap: 'manual', web: 'manual', shell: 'manual' };
    if (h.calcMode === 'mixed') return { cap: h.capMode, web: h.webMode, shell: h.shellMode };
    return { cap: 'auto', web: 'auto', shell: 'auto' };
  }

  // ---------- Profilgeometrie (normiert) ---------------------------------------
  const profCache = new WeakMap();
  function normProf(P) {
    if (!Array.isArray(P) || P.length < 3) return null;
    let e = profCache.get(P);
    if (e) return e;
    let x0 = Infinity, x1 = -Infinity;
    for (const p of P) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; }
    const s = x1 - x0 || 1;
    const pts = P.map(p => ({ x: (p.x - x0) / s, y: p.y / s }));
    let a = 0, per = 0;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[(i + 1) % pts.length];
      a += pts[i].x * q.y - q.x * pts[i].y; per += Math.hypot(q.x - pts[i].x, q.y - pts[i].y);
    }
    e = { pts, A: Math.abs(a) / 2, P: per, m: new Map() };
    profCache.set(P, e);
    return e;
  }
  // Kennwerte an der Holmstelle X (Anteil der Sehne): Dicke, D-Box-Fläche/-Kontur.
  function profAt(P, X) {
    const e = normProf(P); if (!e) return null;
    const key = Math.round(X * 1000);
    if (e.m.has(key)) return e.m.get(key);
    X = key / 1000;
    const pts = e.pts, n = pts.length;
    // Dicke: Schnitt der Senkrechten x = X mit allen Kanten
    let yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      if ((p.x - X) * (q.x - X) <= 0 && p.x !== q.x) {
        const y = p.y + (q.y - p.y) * (X - p.x) / (q.x - p.x);
        if (y < yMin) yMin = y; if (y > yMax) yMax = y;
      }
    }
    const th = yMax > yMin ? yMax - yMin : 0;
    // D-Box: Polygon auf x ≤ X beschneiden (Sutherland-Hodgman, eine Kante)
    const cl = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n], pin = p.x <= X, qin = q.x <= X;
      if (pin) cl.push(p);
      if (pin !== qin) cl.push({ x: X, y: p.y + (q.y - p.y) * (X - p.x) / (q.x - p.x), cut: true });
    }
    let ad = 0, pd = 0;
    for (let i = 0; i < cl.length; i++) {
      const p = cl[i], q = cl[(i + 1) % cl.length];
      ad += p.x * q.y - q.x * p.y;
      const onCut = Math.abs(p.x - X) < 1e-9 && Math.abs(q.x - X) < 1e-9;
      if (!onCut) pd += Math.hypot(q.x - p.x, q.y - p.y);
    }
    const r = { th, top: yMax, bot: yMin, A: e.A, P: e.P, Ad: Math.abs(ad) / 2, Pd: pd };
    e.m.set(key, r);
    return r;
  }

  // ---------- Tragflächengeometrie (aktive Tragfläche, Halbspannweite) ---------
  function wingGeom() {
    const root = state.root, segs = state.segments || [];
    if (!root || !segs.length) return null;
    const knots = [{ y: 0, c: +root.chord || 0, prof: root.profile, le: 0 }];
    let y = 0, le = 0;
    segs.forEach(sg => {
      const sp = +sg.span || 0;
      const sw = sg.sweepMode === 'deg' ? Math.tan((+sg.sweep || 0) * DEG) * sp : (+sg.sweep || 0);
      y += sp; le += sw;
      knots.push({ y, c: +sg.chord || 0, prof: sg.profile, le });
    });
    return y > 0 ? { knots, L: y } : null;
  }
  // Station y: Sehne, Nasenleiste und Profilkennwerte (zwischen den Rippen linear)
  function stationAt(geo, y, X) {
    const K = geo.knots;
    let i = 0; while (i < K.length - 2 && y > K[i + 1].y) i++;
    const a = K[i], b = K[i + 1], t = b.y > a.y ? Math.min(1, Math.max(0, (y - a.y) / (b.y - a.y))) : 0;
    const c = a.c + (b.c - a.c) * t, le = a.le + (b.le - a.le) * t;
    const ma = profAt(a.prof, X), mb = profAt(b.prof, X);
    const L = k => ma && mb ? ma[k] + (mb[k] - ma[k]) * t : (ma || mb || {})[k] || 0;
    return { c, le, th: L('th'), top: L('top'), bot: L('bot'), A: L('A'), P: L('P'), Ad: L('Ad'), Pd: L('Pd') };
  }

  // ---------- Lastverteilung (Form, ∫f dy = 1) ---------------------------------
  function trapz(ys, f) { let s = 0; for (let i = 1; i < ys.length; i++) s += 0.5 * (f[i] + f[i - 1]) * (ys[i] - ys[i - 1]); return s; }
  function interp1(xs, vs, x) {
    if (x <= xs[0]) return vs[0];
    for (let i = 1; i < xs.length; i++) if (x <= xs[i]) { const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1] || 1); return vs[i - 1] + (vs[i] - vs[i - 1]) * t; }
    return vs[vs.length - 1];
  }
  function vlmLoad() {
    if (!window.Aero || !Aero.spanLoad || !App.wingId) return null;
    try { return window.Aero.spanLoad(App.wingId(state.activeWing)); } catch (e) { return null; }
  }
  function loadShape(ys, L, cs, src) {
    const ell = ys.map(y => Math.sqrt(Math.max(0, 1 - (y / L) * (y / L))));
    const norm = f => { const s = trapz(ys, f) || 1; return f.map(v => v / s); };
    let used = src === 'ellipse' ? 'ellipse' : 'schrenk', note = '';
    if (src === 'auto' || src === 'vlm') {
      const sl = vlmLoad();
      if (sl && sl.yn && sl.yn.length > 2) {
        const xs = sl.yn.slice(), vs = sl.ccl.slice();
        // Nur die FORM zählt: ein Zustand mit negativem Auftrieb (z. B. Trimm einer
        // Tragfläche ohne Leitwerk) wird umgedreht.
        if (vs.reduce((a, v) => a + v, 0) < 0) for (let i = 0; i < vs.length; i++) vs[i] = -vs[i];
        if (xs[xs.length - 1] < 1) { xs.push(1); vs.push(0); }
        const fv = ys.map(y => Math.max(0, interp1(xs, vs, y / L)));
        if (trapz(ys, fv) > 0) return { f: norm(fv), used: 'vlm' };
      }
      if (src === 'vlm') note = T('Keine VLM-Rechnung für diese Tragfläche — im Reiter „Aerodynamik" analysieren (die Tragfläche muss Bauteil des Flugzeugs sein). Bis dahin nach Schrenk.');
    }
    if (used === 'ellipse') return { f: norm(ell), used, note };
    const fc = norm(cs), fe = norm(ell);
    return { f: fc.map((v, i) => 0.5 * (v + fe[i])), used: 'schrenk', note };
  }

  // Lagenplan aus der nötigen Lagenzahl je Station: Lage k reicht bis zur
  // äußersten Station mit nreq ≥ k, plus Zugabe (höchstens bis zur Spitze).
  function layerPlan(nreq, ys, L, overlap, minFull) {
    const nmax = Math.max(minFull, ...nreq);
    const out = [];
    for (let k = 1; k <= nmax; k++) {
      if (k <= minFull) { out.push(L); continue; }
      let yk = -1;
      for (let i = 0; i < ys.length; i++) if (nreq[i] >= k) yk = ys[i];
      if (yk < 0) break;
      out.push(Math.min(L, yk + Math.max(0, overlap)));
    }
    return out;
  }
  const provAt = (plan, y) => { let n = 0; for (const l of plan) if (l >= y - 1e-6) n++; return n; };
  const ceilN = v => Math.max(0, Math.ceil(v - 1e-9));
  // Eigene Längenliste: „1415, 1100, 3×800, 2x500" → Längen je Lage/Roving/Steg, längste zuerst
  function parsePlan(txt, L) {
    const out = [];
    String(txt || '').replace(/\s*[x×*]\s*/gi, '×').split(/[;,\s]+/).forEach(tok => {
      if (!tok) return;
      const m = tok.replace(',', '.').match(/^(?:(\d+)\s*[x×*])?(\d+(?:\.\d+)?)$/i);
      if (!m) return;
      const n = m[1] ? Math.min(500, parseInt(m[1], 10)) : 1, l = Math.min(L, Math.max(0, parseFloat(m[2])));
      for (let k = 0; k < n; k++) out.push(l);
    });
    return out.sort((a, b) => b - a);
  }

  // ---------- ca_max und cm-Verteilung aus der Aerodynamik (im Hintergrund) -------------
  // Aero.wingClmax/wingCm0 rechnen synchron (VLM + Profilpolaren) — deshalb per setTimeout
  // außerhalb des Zeichnens; das Ergebnis wird je Geometrie/Geschwindigkeit gemerkt, danach
  // wird neu gerechnet. Bis dahin (oder ohne Aerodynamik) gelten h.caMax bzw. h.cm0.
  let aeCache = { key: '', res: null }, aePend = '';
  const caRefV = h => (h.loadCase === 'aero' ? +h.vMax : +h.vne) || 100;          // km/h, Re-Bezug ca_max
  const sigArr = a => a.length + ':' + a.reduce((s, p, i) => s + (+p.x || 0) * (i % 7 + 1) + (+p.y || 0) * (i % 5 + 3), 0).toFixed(6);
  const aeroOk = () => !!(window.Aero && Aero.wingClmax && Aero.wingCm0 && App.wingId);
  function aeKey(h) {
    const rep = (k, v) => Array.isArray(v) && v.length > 16 ? sigArr(v) : v;
    const c = state.cfg;
    return JSON.stringify([App.wingId(state.activeWing), Math.round(caRefV(h)), Math.round(+h.vne || 0), state.root, state.segments,
      c.aeroVisc, c.aeroNcrit, c.aeroCalc, c.aeroCalcPlane, c.aeroXfUse, h.polCalc], rep);
  }
  // → { ca: {val, src, …}, cm: {fn(y), src, pts} }
  function aeInfo(h) {
    const want = h.caSrc !== 'manual' || h.cmSrc !== 'manual' || h.loadSrc === 'auto' || h.loadSrc === 'vlm';
    let r = null, st = 'manual';
    if (want) {
      if (!aeroOk()) st = 'noaero';
      else {
        const key = aeKey(h);
        if (aeCache.key === key) { r = aeCache.res; st = r ? 'aero' : 'fail'; }
        else {
          st = 'pending';
          if (aePend !== key) {
            aePend = key;
            setTimeout(() => {
              if (aePend !== key) return;
              let ca = null, cm = null, lb = null;
              const id = App.wingId(state.activeWing);
              const pc = h.polCalc === 'nf' || h.polCalc === 'xfoil' ? h.polCalc : undefined;   // undefined = wie „Aerodynamik"
              try { ca = window.Aero.wingClmax(id, caRefV(h) / 3.6, pc); } catch (e) { console.error(e); }
              try { cm = window.Aero.wingCm0(id, (+h.vne || 100) / 3.6, pc); } catch (e) { console.error(e); }
              try { lb = window.Aero.wingLoadBasis ? window.Aero.wingLoadBasis(id) : null; } catch (e) { console.error(e); }
              aeCache = { key, res: (ca || cm || lb) ? { ca, cm, lb } : null }; aePend = '';
              if (state.activeTab === 'holm') render();
            }, 40);
          }
        }
      }
    }
    const caA = r && r.ca && isFinite(r.ca.CL) ? r.ca : null, cmA = r && r.cm ? r.cm : null;
    const ca = h.caSrc === 'manual' ? { val: +h.caMax || 1, src: 'manual' }
      : caA ? Object.assign({}, caA, { val: caA.CL, src: 'aero', pol: caA.src }) : { val: +h.caMax || 1, src: st === 'aero' ? 'fail' : st };
    let cm;
    if (h.cmSrc !== 'manual' && cmA) {
      const P = cmA.pts.filter(p => isFinite(p.cm)).sort((a, b) => a.y - b.y);
      cm = { src: 'aero', pts: P, v: cmA.v, fn: y => { // linear zwischen den Profilschnitten (Wurzel/Rippen)
        if (y <= P[0].y) return P[0].cm;
        for (let i = 1; i < P.length; i++) if (y <= P[i].y) { const t = (y - P[i - 1].y) / ((P[i].y - P[i - 1].y) || 1); return P[i - 1].cm + t * (P[i].cm - P[i - 1].cm); }
        return P[P.length - 1].cm; } };
    } else cm = { src: h.cmSrc === 'manual' ? 'manual' : (st === 'aero' ? 'fail' : st), fn: () => +h.cm0 || 0 };
    return { ca, cm, lb: r && r.lb ? r.lb : null, st };
  }

  // ---------- Rechnung ----------------------------------------------------------
  function compute() {
    const h = H(), geo = wingGeom(), md = modes(h);
    if (!geo) return { err: T('Keine Tragfläche mit Segmenten vorhanden.') };
    const L = geo.L, ys = [], st = [];
    for (let i = 0; i <= N_ST; i++) ys.push(L * i / N_ST);
    const warn = [];
    ys.forEach(y => {
      const eta = y / L, xr = Math.min(0.95, Math.max(0.05, ((+h.xSp) + ((+h.xSpTip) - (+h.xSp)) * eta) / 100));
      const s = stationAt(geo, y, xr);
      s.y = y; s.xr = xr; s.b = Math.max(0.1, (+h.bRoot) + ((+h.bTip) - (+h.bRoot)) * eta);
      s.h = s.th * s.c;
      st.push(s);
    });
    // Lasten 1 g
    const shape = loadShape(ys, L, st.map(s => s.c), h.loadSrc);
    if (shape.note) warn.push(shape.note);
    const Lw = Math.max(0, +h.mass) / 1000 * G * Math.max(0, +h.share) / 100 / 2;   // N je Hälfte bei 1 g
    const ae = aeInfo(h), ca = ae.ca, caMx = Math.max(0.05, ca.val), cmI = ae.cm;
    // Lastfall „ca_max · V": größter Auftrieb A = ρ/2 · V² · S · ca_max (wie Baron 2013),
    // das Lastvielfache ergibt sich daraus (n = A / Gewichtsanteil).
    let aero = null;
    if (h.loadCase === 'aero') {
      const Sh = trapz(ys, st.map(s => s.c)), Vm = Math.max(0, +h.vMax || 0) / 3.6;
      const Ah = 0.5 * (+h.rho || 1.225) * Vm * Vm * Sh * 1e-6 * caMx;
      aero = { S: 2 * Sh, A: 2 * Ah, Ah, V: Vm, n: Lw > 0 ? Ah / Lw : 0 };
      aero.r = aero.n > 1 ? Vm * Vm / (G * (aero.n - 1)) : Infinity;
      if (!(Ah > 0)) warn.push(T('ca_max oder Geschwindigkeit fehlt — ohne sie keine Lasten.'));
      else if (!(Lw > 0)) warn.push(T('Ohne Fluggewicht gilt der Auftrieb aus ca_max · V als 1-g-Last (Lastvielfaches und Durchbiegung bei 1 g unbekannt).'));
    } else if (!(Lw > 0)) warn.push(T('Fluggewicht fehlt — ohne Masse keine Lasten.'));
    const Lh = aero && !(Lw > 0) ? aero.Ah : Lw;                                    // Bezugslast 1 g
    // VLM der Tragfläche allein (aus der Aerodynamik, im Hintergrund): Zusatzverteilung als
    // Lastform, dazu die Grundverteilung aus Schränkung/Profilwahl (wb in mm = c·cl bei CL 0).
    const lb = (h.loadSrc === 'auto' || h.loadSrc === 'vlm') && ae.lb ? ae.lb : null;
    const wb = new Array(ys.length).fill(0);
    if (lb) {
      const fa = ys.map(y => interp1(lb.yn, lb.cA, y / L)), sa = trapz(ys, fa);
      if (sa > 0) {
        shape.f = fa.map(v => v / sa); shape.used = 'vlmw';
        if (shape.note) { const k = warn.indexOf(shape.note); if (k >= 0) warn.splice(k, 1); shape.note = ''; }
      }
      ys.forEach((y, i) => { wb[i] = interp1(lb.yn, lb.cB, y / L); });
    }
    const w1 = shape.f.map(v => v * Lh);                                            // N/mm
    const Q1 = new Array(ys.length).fill(0), M1 = new Array(ys.length).fill(0);
    for (let i = ys.length - 2; i >= 0; i--) {
      const dy = ys[i + 1] - ys[i];
      Q1[i] = Q1[i + 1] + 0.5 * (w1[i] + w1[i + 1]) * dy;
      M1[i] = M1[i + 1] + 0.5 * (Q1[i] + Q1[i + 1]) * dy;
    }
    const j = Math.max(1, +h.j || 1), kRed = Math.min(1, Math.max(0.1, +h.kRed || 1));
    const nP = aero ? (Lh > 0 ? aero.Ah / Lh : 0) : Math.max(0, +h.nPos || 0), nN = Math.abs(+h.nNeg || 0), nMax = Math.max(nP, nN);
    // Grundverteilung je Einheit Staudruck: Qb (mm²), Mb (mm³) → · q (N/mm²) = N bzw. N·mm
    const Qb = new Array(ys.length).fill(0), Mb = new Array(ys.length).fill(0);
    for (let i = ys.length - 2; i >= 0; i--) {
      const dy = ys[i + 1] - ys[i];
      Qb[i] = Qb[i + 1] + 0.5 * (wb[i] + wb[i + 1]) * dy;
      Mb[i] = Mb[i + 1] + 0.5 * (Qb[i] + Qb[i + 1]) * dy;
    }
    // Eckpunkte: A = Abfangen mit ca_max (q = n·W/(ca_max·S)), B = Abfangen bei V_NE (falls
    // schneller als A), C = negative Last bei V_NE, D = negative Last bei kleinem q.
    // M = n·M1 + q·Mb; Bemessung = j · Hüllkurve je Station und Richtung.
    const ShMm = trapz(ys, st.map(s => s.c));                                       // mm² je Hälfte
    const qA1 = Lh > 0 && ShMm > 0 ? Lh / (caMx * ShMm) : 0;                        // N/mm² je n (CL = ca_max)
    const qNE = 0.5 * (+h.rho || 1.225) * Math.pow(Math.max(0, +h.vne || 0) / 3.6, 2) * 1e-6;
    const qA = nP * qA1;
    const corners = [[nP, qA]].concat(qNE > qA ? [[nP, qNE]] : []).concat([[-nN, qNE], [-nN, 0]]);
    const Mp = [], Mn = [], Qd = [];
    M1.forEach((m, i) => {
      let hi = 0, lo = 0, qm = 0;
      corners.forEach(([n, q]) => { const M = n * m + q * Mb[i], Q = n * Q1[i] + q * Qb[i]; hi = Math.max(hi, M); lo = Math.min(lo, M); qm = Math.max(qm, Math.abs(Q)); });
      Mp.push(j * hi); Mn.push(j * -lo); Qd.push(j * qm);
    });

    // --- Holmgurte ---
    const capM = matById(h.capMat) || matsOf('ud')[0];
    const tp = ply(capM), sT = (capM ? capM.st : 1) * kRed, sC = (capM ? capM.sc : 1) * kRed;
    // Gurt aus Gelege: Zähleinheit = Lage (Fläche b · Lagendicke); aus Rovings: Zähleinheit =
    // Roving (fester Querschnitt), abgestuft in Bündeln zu rStep Rovings.
    const isRov = !!capM && capM.kind === 'rov', aR = rovA(capM), rStep = isRov ? Math.max(1, Math.round(+h.rovStep || 1)) : 1;
    const unitA = s => isRov ? aR : s.b * tp;
    const nUnits = (A, s) => { const u = unitA(s); return u > 0 ? Math.ceil(ceilN(A / u) / rStep) * rStep : 0; };
    const skin = Math.max(0, +h.skinT || 0);
    const nTreq = [], nBreq = [], AtReq = [], AbReq = [];
    st.forEach((s, i) => {
      const hin = s.h - 2 * skin;
      let tt = 0, tb = 0, At = 0, Ab = 0;
      for (let it = 0; it < 8; it++) {
        const he = Math.max(0.2 * hin, hin - (tt + tb) / 2);
        const F = he > 0 ? Mp[i] / he : 0, Fn = he > 0 ? Mn[i] / he : 0;
        At = Math.max(F / sC, Fn / sT); Ab = Math.max(F / sT, Fn / sC);
        tt = At / s.b; tb = Ab / s.b;
      }
      AtReq.push(At); AbReq.push(Ab);
      nTreq.push(nUnits(At, s)); nBreq.push(nUnits(Ab, s));
    });
    const minCap = h.capToTip ? rStep : 0;
    const Ecap = (capM ? capM.E : 0) * 1000;
    // Bezugslastfall der Durchbiegungsgrenze (Faktor auf die 1-g-Biegelinie)
    const wFac = { '1g': 1, n: nP, d: j * nP }[h.wRef] ?? nP;
    // Staudruck zum Bezugslastfall der Grenze (Lastform beim Ziehen mit ca_max)
    const wQ = { '1g': qA1, n: qA, d: j * qA }[h.wRef] ?? qA;
    const wMax = Math.max(0, +h.wMax || 0);
    // Gurte aus einem Lagenplan aufbauen und die Biegelinie bei 1 g rechnen
    const applyCaps = (planT, planB) => {
      st.forEach((s, i) => {
        s.nT = provAt(planT, s.y); s.nB = provAt(planB, s.y);
        s.nTreq = nTreq[i]; s.nBreq = nBreq[i];
        s.tT = s.nT * unitA(s) / s.b; s.tB = s.nB * unitA(s) / s.b;
        s.hin = s.h - 2 * skin;
        s.hEff = s.hin - (s.tT + s.tB) / 2;
        s.hW = Math.max(0, s.hin - s.tT - s.tB);
        const At = s.tT * s.b, Ab = s.tB * s.b;
        s.EI = (At > 0 && Ab > 0 && s.hEff > 0) ? Ecap * At * Ab * s.hEff * s.hEff / (At + Ab) : 0;
      });
      // defl = Biegelinie aus der Zusatzverteilung bei 1 g (· n), deflB = aus der
      // Grundverteilung je Einheit Staudruck (· q in N/mm²) → w = n·defl + q·deflB
      let th = 0, w = 0, thB = 0, wB = 0; const defl = [0], slope = [0], deflB = [0], slopeB = [0];
      for (let i = 1; i < st.length; i++) {
        const dy = ys[i] - ys[i - 1], E0 = st[i - 1].EI, E1 = st[i].EI;
        const k0 = E0 > 0 ? M1[i - 1] / E0 : 0, k1 = E1 > 0 ? M1[i] / E1 : 0;
        const b0 = E0 > 0 ? Mb[i - 1] / E0 : 0, b1 = E1 > 0 ? Mb[i] / E1 : 0;
        const thN = th + 0.5 * (k0 + k1) * dy, thBN = thB + 0.5 * (b0 + b1) * dy;
        w += 0.5 * (th + thN) * dy; th = thN; defl.push(w); slope.push(th);
        wB += 0.5 * (thB + thBN) * dy; thB = thBN; deflB.push(wB); slopeB.push(thB);
      }
      return { planT, planB, defl, slope, deflB, slopeB, wTip: defl[defl.length - 1] * wFac + deflB[deflB.length - 1] * wQ };
    };
    st.forEach((s, i) => { s.M1 = M1[i]; });
    // Automatisch: Festigkeit, bei Durchbiegungsgrenze alle Gurtflächen gemeinsam um kS
    // vergrößern (kleinstes kS per Halbierung, das die Grenze einhält).
    const autoCaps = kS => {
      const nt = st.map((s, i) => nUnits(AtReq[i] * kS, s)), nb = st.map((s, i) => nUnits(AbReq[i] * kS, s));
      return applyCaps(layerPlan(nt, ys, L, +h.overlap, minCap), layerPlan(nb, ys, L, +h.overlap, minCap));
    };
    let capRes, kStiff = 1, stiffNote = '';
    const manualCaps = md.cap === 'manual';
    if (manualCaps) {
      capRes = applyCaps(parsePlan(h.capLenT, L), parsePlan(h.capLenB, L));
    } else {
      capRes = autoCaps(1);
      if (wMax > 0 && capRes.wTip > wMax && Ecap > 0) {
        let lo = 1, hi = 1, r = capRes;
        // Gurte dürfen höchstens die halbe Bauhöhe füllen, sonst ist die Grenze so nicht erreichbar
        const full = () => st.some(s => s.hin > 0 && s.tT + s.tB > 0.5 * s.hin);
        for (let it = 0; it < 30 && r.wTip > wMax && !full(); it++) { lo = hi; hi *= Math.max(1.1, r.wTip / wMax); r = autoCaps(hi); }
        if (full()) {
          // Grenze unerreichbar: so weit verstärken, wie die Bauhöhe zulässt (größtes kS ohne
          // „voll“), und sagen, welche Durchbiegung damit erreichbar ist.
          if (lo > 1 || !(autoCaps(1), full())) {
            for (let it = 0; it < 14; it++) { const m = (lo + hi) / 2; autoCaps(m); if (full()) hi = m; else lo = m; }
          }
          kStiff = lo;
          const rb = autoCaps(kStiff);
          stiffNote = T('Durchbiegungsgrenze mit dieser Bauhöhe nicht erreichbar — die Gurte sind so weit verstärkt, bis sie die halbe Holmhöhe füllen.') + ' ' +
            T('Erreichbar: {w} mm statt {g} mm (dafür müsste der Holm {k}-mal steifer sein).').replace('{w}', rb.wTip < 10 ? f1(rb.wTip) : f0(rb.wTip)).replace('{g}', wMax < 10 ? f1(wMax) : f0(wMax)).replace('{k}', f1(rb.wTip / wMax)) + ' ' +
            T('Abhilfe: Grenze bei 1 g oder n statt j·n ansetzen, Grenze erhöhen, steiferes Gelege (HM-Kohle), breiteren Gurt oder dickeres Profil am Holm.');
        }
        else if (r.wTip > wMax) stiffNote = T('Durchbiegungsgrenze auch mit sehr viel Gurtmaterial nicht erreichbar — Bauhöhe oder Gurtwerkstoff (E-Modul) prüfen.');
        else {
          for (let it = 0; it < 12; it++) { const m = (lo + hi) / 2, rm = autoCaps(m); if (rm.wTip > wMax) lo = m; else { hi = m; } }
          kStiff = hi;
        }
        capRes = autoCaps(kStiff);
      }
    }
    const planT = capRes.planT, planB = capRes.planB, defl = capRes.defl, slope = capRes.slope, deflB = capRes.deflB, slopeB = capRes.slopeB;
    if (stiffNote) warn.push(stiffNote);
    let capFitWarn = false;
    st.forEach((s, i) => {
      const At = s.tT * s.b, Ab = s.tB * s.b;
      s.uT = At > 0 ? AtReq[i] / At : (AtReq[i] > 0 ? Infinity : 0);
      s.uB = Ab > 0 ? AbReq[i] / Ab : (AbReq[i] > 0 ? Infinity : 0);
      s.Mp = Mp[i]; s.Mn = Mn[i]; s.Qd = Qd[i]; s.w1 = w1[i]; s.Q1 = Q1[i]; s.M1 = M1[i]; s.wb = wb[i]; s.Qb = Qb[i]; s.Mb = Mb[i];
      if (s.hin > 0 && (s.tT + s.tB) > 0.45 * s.hin) capFitWarn = true;
    });
    if (capFitWarn) warn.push(T('Die Gurte nehmen stellenweise fast die halbe Bauhöhe ein — breiter machen, festeres Gelege wählen oder Holm an die dickste Profilstelle legen.'));
    if (st[0].hin <= 0) warn.push(T('Keine Bauhöhe an der Holmstelle (Profildicke ≤ Deckschicht).'));
    const wTipRef = capRes.wTip;
    if (wMax > 0 && wTipRef > wMax + 0.05 && !stiffNote) warn.push(T('Durchbiegung der Flächenspitze über der Grenze:') + ' ' + wTipRef.toFixed(0) + ' mm > ' + wMax.toFixed(0) + ' mm');
    if (manualCaps) {
      let um = 0, ym = 0; st.forEach(s => { const u = Math.max(s.uT, s.uB); if (u > um) { um = u; ym = s.y; } });
      if (um > 1.0001) warn.push(T('Eigene Gurtlagen reichen nicht:') + ' ' + (isFinite(um) ? Math.round(um * 100) + ' %' : '∞') + ' ' + T('Auslastung bei') + ' y = ' + Math.round(ym) + ' mm');
    }

    // --- Holmstege ---
    const core = matById(h.webMat) || matsOf('core')[0];
    const coat = h.webCoat ? matById(h.webCoat) : null, nc = coat ? Math.max(0, Math.round(+h.webCoatN || 0)) : 0;
    const tc = Math.max(0.1, +h.webT || (core ? core.t : 2));
    const webCap = (cm, tcore, cmCoat, ncoat) => {
      if (!cm) return 0;
      const tpc = cmCoat ? ply(cmCoat) : 0;
      let gam = cm.tau * kRed / cm.G, S = cm.G * tcore;
      if (cmCoat && ncoat > 0) { gam = Math.min(gam, cmCoat.tau45 * kRed / (cmCoat.G45 * 1000)); S += 2 * ncoat * cmCoat.G45 * 1000 * tpc; }
      return gam * S;                                   // N je mm Steghöhe
    };
    const vPerMm = webCap(core, tc, coat, nc);
    const webW = tc + 2 * nc * (coat ? ply(coat) : 0);
    // Nötige Stegzahl je Station, daraus die Abstufung wie bei den Lagen: Steg k reicht bis
    // zur äußersten Station, die k Stege braucht (+ Zugabe); ein Steg läuft bis zur Spitze.
    const nWreq = st.map(s => { const V = s.hW * vPerMm; return V > 0 ? Math.max(1, ceilN(s.Qd / V)) : 0; });
    const manualWebs = md.web === 'manual';
    const planW = manualWebs ? parsePlan(h.webLen, L) : layerPlan(nWreq, ys, L, +h.overlap, nWreq.some(n => n > 0) ? 1 : 0);
    let webFit = false;
    st.forEach((s, i) => {
      const V = s.hW * vPerMm;
      s.nWreq = nWreq[i];
      s.nW = V > 0 ? provAt(planW, s.y) : 0;
      s.uW = V > 0 && s.nW > 0 ? s.Qd / (s.nW * V) : 0;
      if (s.nW * webW > s.b + 1e-6) webFit = true;
    });
    if (manualWebs) {
      let um = 0, ym = 0; st.forEach(s => { const u = s.hW > 0 && s.Qd > 0 ? (s.nW > 0 ? s.uW : Infinity) : 0; if (u > um) { um = u; ym = s.y; } });
      if (um > 1.0001) warn.push(T('Eigene Stege reichen nicht:') + ' ' + (isFinite(um) ? Math.round(um * 100) + ' %' : '∞') + ' ' + T('Auslastung bei') + ' y = ' + Math.round(ym) + ' mm');
    }
    if (webFit) warn.push(T('Die Stege passen stellenweise nicht nebeneinander unter den Gurt (Anzahl · Stegdicke > Gurtbreite) — dickeren/festeren Steg, Beschichtung oder breiteren Gurt wählen.'));
    const webSecs = [];
    st.forEach(s => {
      const last = webSecs[webSecs.length - 1];
      if (!last || last.n !== s.nW) webSecs.push({ from: s.y, to: L, n: s.nW, hR: s.hW, hT: s.hW, uMax: s.uW });
      else { last.hT = s.hW; last.uMax = Math.max(last.uMax, s.uW); }
    });
    for (let k = 0; k < webSecs.length - 1; k++) webSecs[k].to = webSecs[k + 1].from;
    // Vergleich aller Stegwerkstoffe (Wurzel, je eigene Standarddicke)
    const webCmp = matsOf('core').map(m => {
      const s0 = st[0], vb = webCap(m, m.t, null, 0) * s0.hW, vc = coat && nc > 0 ? webCap(m, m.t, coat, nc) * s0.hW : 0;
      const mm = (m.t * m.rho * 1e-6 * s0.hW) * 1000;   // g je m Steg (Wurzelhöhe)
      return { m, nBare: vb > 0 ? Math.max(1, ceilN(s0.Qd / vb)) : 0, nCoat: vc > 0 ? Math.max(1, ceilN(s0.Qd / vc)) : 0, gpm: mm };
    });

    // --- Schale gegen Torsion ---
    const sm = matById(h.shellMat) || matsOf('fab')[0];
    const ori45 = h.shellOri !== '090';
    const tauS = (sm ? (ori45 ? sm.tau45 : sm.tau090) : 1) * kRed, Gs = (sm ? (ori45 ? sm.G45 : sm.G090) : 1) * 1000, tps = ply(sm);
    const V = Math.max(0, +h.vne || 0) / 3.6, qd = 0.5 * (+h.rho || 1.225) * V * V * 1e-6;   // N/mm²
    st.forEach(s => { s.cm0 = cmI.fn(s.y); });          // cm0 je Station (Aerodynamik oder pauschal)
    const cases = [-nN, 1, nP];
    const Tn = cases.map(() => new Array(ys.length).fill(0));
    cases.forEach((n, ci) => {
      const mt = st.map(s => qd * s.c * s.c * s.cm0 + n * s.w1 * (s.xr - 0.25) * s.c);   // N·mm/mm, + = Nase hoch
      for (let i = ys.length - 2; i >= 0; i--) Tn[ci][i] = Tn[ci][i + 1] + 0.5 * (mt[i] + mt[i + 1]) * (ys[i + 1] - ys[i]);
    });
    // Anteile für die 3D-Ansicht: T(n) = Tcm (c_m0 bei V_NE) + n · Tl (Auftrieb · Hebel)
    const Tcm = new Array(ys.length).fill(0), Tl = new Array(ys.length).fill(0), Tb = new Array(ys.length).fill(0);
    for (let i = ys.length - 2; i >= 0; i--) {
      const dy = ys[i + 1] - ys[i], a = st[i], b = st[i + 1];
      Tcm[i] = Tcm[i + 1] + 0.5 * qd * (a.cm0 * a.c * a.c + b.cm0 * b.c * b.c) * dy;
      Tl[i] = Tl[i + 1] + 0.5 * (a.w1 * (a.xr - 0.25) * a.c + b.w1 * (b.xr - 0.25) * b.c) * dy;
      Tb[i] = Tb[i + 1] + 0.5 * ((a.wb || 0) * (a.xr - 0.25) * a.c + (b.wb || 0) * (b.xr - 0.25) * b.c) * dy;   // je Einheit q
    }
    const dbox = h.box === 'dbox';
    const nSreq = [];
    st.forEach((s, i) => {
      s.Tcm = Tcm[i]; s.Tl = Tl[i]; s.Tb = Tb[i];
      s.T1 = Tn[1][i]; s.Td = j * Math.max(...Tn.map(a => Math.abs(a[i])));
      s.Am = (dbox ? s.Ad : s.A) * s.c * s.c;
      s.Pc = dbox ? s.Pd * s.c + s.th * s.c : s.P * s.c;     // Umlauf für die Verdrehung
      s.Pm = dbox ? s.Pd * s.c : s.P * s.c;                 // Gewebefläche je mm
      s.qT = s.Am > 0 ? s.Td / (2 * s.Am) : 0;              // Schubfluss N/mm
      s.tSreq = tauS > 0 ? s.qT / tauS : 0;
      nSreq.push(tps > 0 ? Math.max(Math.max(0, Math.round(+h.shellMin || 0)), ceilN(s.tSreq / tps)) : 0);
    });
    const manualShell = md.shell === 'manual';
    const planS = manualShell ? parsePlan(h.shellLen, L) : layerPlan(nSreq, ys, L, +h.overlap, Math.max(0, Math.round(+h.shellMin || 0)));
    let tw = 0; const twist = [0];
    st.forEach((s, i) => {
      s.nS = provAt(planS, s.y); s.nSreq = nSreq[i];
      const t = s.nS * tps;
      s.GJ = (t > 0 && s.Am > 0 && s.Pc > 0) ? 4 * s.Am * s.Am * Gs * t / s.Pc : 0;
      s.uS = t > 0 ? s.tSreq / t : (s.tSreq > 0 ? Infinity : 0);
      if (i > 0) {
        const a = st[i - 1], k0 = a.GJ > 0 ? a.T1 / a.GJ : 0, k1 = s.GJ > 0 ? s.T1 / s.GJ : 0;
        tw += 0.5 * (k0 + k1) * (ys[i] - ys[i - 1]); twist.push(tw);
      }
    });
    if (manualShell) {
      let um = 0, ym = 0; st.forEach(s => { if (s.uS > um) { um = s.uS; ym = s.y; } });
      if (um > 1.0001) warn.push(T('Eigene Schalenlagen reichen nicht:') + ' ' + (isFinite(um) ? Math.round(um * 100) + ' %' : '∞') + ' ' + T('Auslastung bei') + ' y = ' + Math.round(ym) + ' mm');
    }
    if (!(st[0].nS > 0)) warn.push(T(manualShell ? 'Schale ohne tragende Lage: Verdrehung lässt sich nicht berechnen (Schale: Lagenlängen eintragen).' : 'Schale ohne tragende Lage: Verdrehung lässt sich nicht berechnen (Mindestlagen ≥ 1).'));

    // --- Theoretische Bruchgrenze ---
    // Lastvielfaches, bei dem je Station Gurt, Steg bzw. Schale ihre Festigkeit erreichen
    // (Werkstoffwerte × Abminderung, OHNE Sicherheitsfaktor j). Linear-elastisch; Beulen,
    // Knittern des Druckgurts, Steckung und Klebungen sind nicht erfasst.
    const brk = { pos: { n: Infinity, part: '', y: 0 }, neg: { n: Infinity, part: '', y: 0 } };
    const take = (dir, n, part, y) => { if (n < brk[dir].n) brk[dir] = { n, part, y }; };
    st.forEach(s => {
      const At = s.tT * s.b, Ab = s.tB * s.b, M = s.M1, Mpe = s.M1 + qA1 * s.Mb;   // Mpe: Lastform beim Abfangen mit ca_max
      s.nbCapP = s.nbCapN = s.nbWeb = s.nbShP = s.nbShN = Infinity;
      s.capP = s.hEff > 0 ? Math.min(At * sC, Ab * sT) * s.hEff : 0;
      s.capW = s.nW * s.hW * vPerMm;
      if (M > 1e-9) {
        if (s.hEff > 0) {
          // positiv: oben Druck, unten Zug; negativ umgekehrt
          const fTp = At * sC, fBp = Ab * sT, fTn = At * sT, fBn = Ab * sC;
          s.nbCapP = Mpe > 1e-9 ? Math.min(fTp, fBp) * s.hEff / Mpe : Infinity; s.nbCapN = Math.min(fTn, fBn) * s.hEff / M;
          take('pos', s.nbCapP, fTp <= fBp ? 'Holmgurt oben (Druck)' : 'Holmgurt unten (Zug)', s.y);
          take('neg', s.nbCapN, fTn <= fBn ? 'Holmgurt oben (Zug)' : 'Holmgurt unten (Druck)', s.y);
        } else { s.nbCapP = s.nbCapN = 0; take('pos', 0, 'Holmgurt oben (Druck)', s.y); take('neg', 0, 'Holmgurt unten (Druck)', s.y); }
      }
      if (s.Q1 > 1e-9) {
        const V = s.nW * s.hW * vPerMm, Qe = Math.max(Math.abs(s.Q1 + qA1 * s.Qb), 1e-12);
        s.nbWeb = V / Qe;
        take('pos', s.nbWeb, 'Holmsteg (Schub)', s.y); take('neg', s.nbWeb, 'Holmsteg (Schub)', s.y);
      }
      // Schale bei V_NE: |Tcm + n·Tl| = Tzul
      const t = s.nS * tps, Tz = t > 0 && s.Am > 0 ? 2 * s.Am * t * tauS : 0;
      s.Tz = Tz;
      if (Tz > 0 || Math.abs(s.Tcm) > 1e-9 || Math.abs(s.Tl) > 1e-9) {
        if (Math.abs(s.Tcm) >= Tz) { s.nbShP = s.nbShN = 0; }
        else if (Math.abs(s.Tl) > 1e-12) {
          const r1 = (Tz - s.Tcm) / s.Tl, r2 = (-Tz - s.Tcm) / s.Tl;
          s.nbShP = Math.min(...[r1, r2].filter(r => r > 0).concat([Infinity]));
          s.nbShN = Math.min(...[r1, r2].filter(r => r < 0).map(r => -r).concat([Infinity]));
        }
        take('pos', s.nbShP, 'Schale (Torsion bei V_NE)', s.y); take('neg', s.nbShN, 'Schale (Torsion bei V_NE)', s.y);
      }
    });
    brk.reserve = nP > 0 ? brk.pos.n / nP : Infinity;
    brk.lift = 2 * brk.pos.n * Lh;                                   // Auftrieb beider Hälften beim Bruch, N
    brk.wTip = (defl[defl.length - 1] + qA1 * deflB[deflB.length - 1]) * brk.pos.n;
    brk.aTip = Math.atan((slope[slope.length - 1] + qA1 * slopeB[slopeB.length - 1]) * brk.pos.n) / DEG;
    // Bruchgeschwindigkeit: bei welcher Fluggeschwindigkeit bricht der Flügel, wenn mit dem
    // Auftriebsbeiwert caBreak voll gezogen wird? Auftrieb je Hälfte = ρ/2 · V² · S/2 · ca
    // → n(V) = k · V². Gurt/Steg: V² = n_Bruch / k. Schale: c_m0-Moment wächst ebenfalls mit V²
    // (Tcm gilt bei V_NE) → |Tcm/V_NE² + k · Tl| · V² = T_zul.
    const caB = ca.src === 'aero' ? caMx : Math.max(0, +h.caBreak || 0), ShB = trapz(ys, st.map(s => s.c)) * 1e-6;   // m² je Hälfte
    const kV = Lh > 0 ? 0.5 * (+h.rho || 1.225) * ShB * caB / Lh : 0;                    // n je (m/s)²
    const vne = Math.max(0, +h.vne || 0) / 3.6;
    const vb = { v: Infinity, part: '', y: 0, n: 0 };
    if (kV > 0) {
      const takeV = (v2, part, y) => { const v = v2 > 0 ? Math.sqrt(v2) : 0; if (v < vb.v) { vb.v = v; vb.part = part; vb.y = y; } };
      const qB1 = ShMm > 0 ? Lh / (caB * ShMm) : 0;          // Lastform beim Ziehen mit caB
      st.forEach(s => {
        const Me = s.M1 + qB1 * s.Mb, Qe = Math.abs(s.Q1 + qB1 * s.Qb);
        const nbC = Me > 1e-9 && s.capP > 0 ? s.capP / Me : (Me > 1e-9 ? 0 : Infinity), nbW = Qe > 1e-9 ? s.capW / Qe : Infinity;
        s.vbCap = isFinite(nbC) ? Math.sqrt(Math.max(0, nbC / kV)) * 3.6 : Infinity;
        s.vbWeb = isFinite(nbW) ? Math.sqrt(Math.max(0, nbW / kV)) * 3.6 : Infinity;
        const a = (vne > 0 ? s.Tcm / (vne * vne) : 0) + kV * s.Tl;
        s.vbSh = Math.abs(a) > 1e-15 ? Math.sqrt(Math.max(0, (s.Tz || 0) / Math.abs(a))) * 3.6 : Infinity;
        if (isFinite(nbC)) takeV(nbC / kV, (s.tT * s.b * sC) <= (s.tB * s.b * sT) ? 'Holmgurt oben (Druck)' : 'Holmgurt unten (Zug)', s.y);
        if (isFinite(nbW)) takeV(nbW / kV, 'Holmsteg (Schub)', s.y);
        if (isFinite(s.vbSh)) { const v = s.vbSh / 3.6; takeV(v * v, 'Schale (Torsion)', s.y); }
      });
      vb.v *= 3.6;                                         // km/h
      vb.n = kV * Math.pow(vb.v / 3.6, 2);
    }
    vb.ca = caB;
    brk.vb = vb;
    if (isFinite(brk.pos.n) && brk.pos.n < nP) warn.push(T('Theoretische Bruchgrenze liegt UNTER dem Lastvielfachen n — der Flügel bricht rechnerisch schon im Betrieb.'));
    if (lb && qNE > 0 && Lh > 0) {
      const CL1 = Lh / (qNE * ShMm);                       // 1 g bei V_NE
      let yNeg = -1; st.forEach((s, i) => { if (yNeg < 0 && s.c > 0 && (CL1 * w1[i] / Lh * ShMm + wb[i]) < 0) yNeg = s.y; });
      if (yNeg >= 0) warn.push(T('Grundverteilung (Schränkung): bei V_NE im Geradeausflug erzeugt die Fläche ab y = {y} mm Abtrieb — die Spitzen werden nach unten gebogen; in der Bemessung berücksichtigt.').replace('{y}', Math.round(yNeg)));
    }
    const twTip = twist[twist.length - 1] / DEG;
    if (Math.abs(twTip) > 2) warn.push(T('Verdrehung an der Spitze bei V_NE über 2° — Flattergefahr; mehr Torsionslagen (±45°) oder geschlossene Schale vorsehen.'));

    // --- Massen je Hälfte (g) ---
    const capLen = len => { let a = 0; for (let i = 1; i < st.length; i++) { const y0 = ys[i - 1], y1 = Math.min(ys[i], len); if (y1 <= y0) break; const b0 = st[i - 1].b, b1 = b0 + (st[i].b - b0) * (y1 - y0) / (ys[i] - y0); a += 0.5 * (b0 + b1) * (y1 - y0); } return a; };
    const shellLen = len => { let a = 0; for (let i = 1; i < st.length; i++) { const y0 = ys[i - 1], y1 = Math.min(ys[i], len); if (y1 <= y0) break; a += 0.5 * (st[i - 1].Pm + st[i].Pm) * (y1 - y0); } return a; };
    const lamG = (area, m) => m ? area * m.gsm * 1e-6 / psi(m) : 0;
    const capCut = l => ({ len: l, bIn: st[0].b, bOut: Math.max(0.1, (+h.bRoot) + ((+h.bTip) - (+h.bRoot)) * l / L),
      g: isRov ? l * capM.tex * 1e-6 / psi(capM) : lamG(capLen(l), capM) });
    const cutT = planT.map(capCut), cutB = planB.map(capCut);
    const cutS = planS.map(l => ({ len: l, area: shellLen(l), g: lamG(shellLen(l), sm) }));
    let webG = 0;
    for (let i = 1; i < st.length; i++) {
      const a = st[i - 1], b = st[i], dy = ys[i] - ys[i - 1];
      const perMm = s => s.nW * s.hW * (tc * (core ? core.rho : 0) * 1e-6 + (coat ? 2 * nc * coat.gsm * 1e-6 / psi(coat) : 0));
      webG += 0.5 * (perMm(a) + perMm(b)) * dy;
    }
    // Zuschnitt je Steg: Länge ab Wurzel, Höhe innen → am Ende, Masse
    const webArea = tc * (core ? core.rho : 0) * 1e-6 + (coat ? 2 * nc * coat.gsm * 1e-6 / psi(coat) : 0);   // g je mm²
    const cutW = planW.map(l => {
      let a = 0;
      for (let i = 1; i < st.length; i++) { const y0 = ys[i - 1], y1 = Math.min(ys[i], l); if (y1 <= y0) break; const h1 = st[i - 1].hW + (st[i].hW - st[i - 1].hW) * (y1 - y0) / (ys[i] - y0); a += 0.5 * (st[i - 1].hW + h1) * (y1 - y0); }
      return { len: l, hR: st[0].hW, hE: st[Math.min(N_ST, Math.round(l / L * N_ST))].hW, g: a * webArea };
    });
    const mass = { capT: cutT.reduce((s, c) => s + c.g, 0), capB: cutB.reduce((s, c) => s + c.g, 0), web: webG, shell: cutS.reduce((s, c) => s + c.g, 0) };
    mass.total = mass.capT + mass.capB + mass.web + mass.shell;
    const halves = Math.max(1, Math.round(+state.cfg.wtCount || 2));

    const Rres = {
      h, geo, L, ys, st, shape, Lh, Lw, aero, brk, ca, caMx, cmI, lb, qA1, qA, qNE, ShMm, j, kRed, nP, nN, warn, defl, slope, deflB, slopeB, wFac, wMax, wTipRef, kStiff, manualCaps, manualWebs, manualShell, md, twist, twTip, sT, sC, vPerMm, tauS,
      capM, tp, isRov, aR, rStep, planT, planB, cutT, cutB, core, coat, nc, tc, webW, webSecs, webCmp, planW, cutW,
      sm, tps, ori45, planS, cutS, qd, mass, halves
    };
    try { Rres.fast = fastFlight(Rres); } catch (e) { console.error(e); Rres.fast = null; }
    return Rres;
  }

  // ---------- Schnellflug (1 g, ohne Abfangen) mit elastischer Rückwirkung -------------
  // Geradeausflug bei der Geschwindigkeit V (oder dem Flügel-CL): Auftrieb je Hälfte = Lh.
  // Örtlicher Auftrieb l = q·(CL·cA + cB + K·Δα): Zusatzverteilung cA, Grundverteilung cB
  // (Schränkung/Profilwahl — bei kleinem CL außen Abtrieb, Spitzen biegen nach unten) und
  // der Anteil aus der elastischen Anstellwinkeländerung Δα (VLM-Einflussmatrix K, sonst
  // Streifentheorie). Torsion um den Holm aus c_m0·q·c² und l·(x_Holm − c/4) verdreht die
  // Fläche (θ = ∫T/GJ), Biegung (w = ∬M/EI) dreht sie bei Pfeilung zusätzlich
  // (Δα = θ − tanΛ·w′). Lineares Gleichungssystem in Δα, CL wird je Iteration so nachgestellt,
  // dass der Gesamtauftrieb gleich bleibt (Trimm). Eigengewicht der Fläche entlastet.
  function gaussSolve(A, b) {
    const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
    let sgn = 1;
    for (let k = 0; k < n; k++) {
      let p = k; for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
      if (Math.abs(M[p][k]) < 1e-300) return null;
      if (p !== k) { const t = M[p]; M[p] = M[k]; M[k] = t; sgn = -sgn; }
      for (let i = k + 1; i < n; i++) { const f = M[i][k] / M[k][k]; if (f) for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j]; }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
    let det = sgn; for (let k = 0; k < n; k++) det *= Math.sign(M[k][k]);
    return { x, detSign: det };
  }
  function fastFlight(R) {
    const h = R.h, st = R.st, ys = R.ys, L = R.L, NS = ys.length, rho = +h.rho || 1.225;
    const Sh = R.ShMm, Lh = R.Lh;
    if (!(Lh > 0) || !(Sh > 0)) return null;
    const qOfV = v => 0.5 * rho * Math.pow(v / 3.6, 2) * 1e-6;                         // km/h → N/mm²
    const vOfQ = q => Math.sqrt(Math.max(0, 2 * q * 1e6 / rho)) * 3.6;
    let q, V, CL;
    if (h.fastMode === 'cl') { CL = Math.max(0.01, +h.fastCl || 0.1); q = Lh / (CL * Sh); V = vOfQ(q); }
    else { V = Math.max(1, +h.fastV || +h.vne || 100); q = qOfV(V); CL = Lh / (q * Sh); }
    const f = R.shape.f, wb = st.map(s => s.wb || 0), IB = trapz(ys, wb);
    // Eigengewicht der Fläche (je Hälfte) sehnenproportional verteilt
    let wm = 0, wmSrc = 'manual';
    if (h.fastWmSrc === 'auto') {
      let ww = 0; try { const r = App.wingWeight ? App.wingWeight(state.activeWing) : null; ww = r && r.piece > 0 ? r.piece : 0; } catch (e) { ww = 0; }
      wm = ww + (R.mass ? R.mass.total : 0); wmSrc = ww > 0 ? 'auto' : 'struct';
    } else wm = Math.max(0, +h.fastWm || 0);
    const Ic = trapz(ys, st.map(s => s.c)) || 1, gw = st.map(s => wm / 1000 * G * s.c / Ic);
    // Pfeilung der Holmachse
    const xe = st.map(s => s.le + s.xr * s.c), tanL = xe.map((x, i) => {
      const a = Math.max(0, i - 1), b = Math.min(NS - 1, i + 1); return (xe[b] - xe[a]) / ((ys[b] - ys[a]) || 1); });
    // Knoten der Verdrehung: VLM-Streifen (Einflussmatrix) oder Streifentheorie
    const lb = R.lb, useK = !!(lb && Array.isArray(lb.K) && lb.K.length === lb.yn.length);
    let yn, K;
    if (useK) { yn = lb.yn; K = lb.K; }
    else {
      const n = 40, AR = 2 * L * L / Sh, a = 2 * Math.PI * AR / (AR + 2);
      yn = []; for (let k = 0; k < n; k++) yn.push((k + 0.5) / n);
      K = yn.map((y, i) => yn.map((_, j) => i === j ? a * interp1(ys, st.map(s => s.c), y * L) : 0));
    }
    const nN = yn.length, elastic = h.fastElastic !== false;
    const atNodes = arr => yn.map(y => interp1(ys, arr, y * L));
    // Antwort der Struktur auf eine Δα-Verteilung an den Knoten (rad) beim Staudruck qq
    function respond(x, qq, full) {
      const kx = K.map(row => row.reduce((s, v, j) => s + v * x[j], 0));
      const ctw = ys.map(y => interp1(yn, kx, y / L)), It = trapz(ys, ctw);
      const l = ys.map((y, i) => Lh * f[i] + qq * (wb[i] - f[i] * IB) + qq * (ctw[i] - f[i] * It));
      const Q = new Array(NS).fill(0), M = new Array(NS).fill(0), T = new Array(NS).fill(0);
      const mt = st.map((s, i) => qq * s.c * s.c * (s.cm0 || 0) + l[i] * (s.xr - 0.25) * s.c);
      for (let i = NS - 2; i >= 0; i--) {
        const dy = ys[i + 1] - ys[i];
        Q[i] = Q[i + 1] + 0.5 * (l[i] - gw[i] + l[i + 1] - gw[i + 1]) * dy;
        M[i] = M[i + 1] + 0.5 * (Q[i] + Q[i + 1]) * dy;
        T[i] = T[i + 1] + 0.5 * (mt[i] + mt[i + 1]) * dy;
      }
      const th = [0], sl = [0], w = [0];
      for (let i = 1; i < NS; i++) {
        const dy = ys[i] - ys[i - 1], a = st[i - 1], b = st[i];
        const k0 = a.EI > 0 ? M[i - 1] / a.EI : 0, k1 = b.EI > 0 ? M[i] / b.EI : 0;
        const t0 = a.GJ > 0 ? T[i - 1] / a.GJ : 0, t1 = b.GJ > 0 ? T[i] / b.GJ : 0;
        th.push(th[i - 1] + 0.5 * (t0 + t1) * dy);
        sl.push(sl[i - 1] + 0.5 * (k0 + k1) * dy);
        w.push(w[i - 1] + 0.5 * (sl[i - 1] + sl[i]) * dy);
      }
      const da = th.map((t, i) => t - tanL[i] * sl[i]);
      if (!full) return atNodes(da);
      const cl = l.map((v, i) => st[i].c > 0 && qq > 0 ? v / (qq * st[i].c) : NaN);
      const CLx = qq > 0 ? (Lh - qq * IB - qq * It) / (qq * Sh) : NaN;          // Anteil der Zusatzverteilung
      return { l, cl, Q, M, T, th, sl, w, da, CLx, x };
    }
    // Affine Zerlegung: Δα_neu = q·A1·Δα + b0 + q·b1
    const zero = new Array(nN).fill(0);
    const b0 = respond(zero, 0), r1 = respond(zero, 1), b1 = r1.map((v, i) => v - b0[i]);
    const A1 = yn.map(() => new Array(nN).fill(0));
    if (elastic) for (let j = 0; j < nN; j++) {
      const e = zero.slice(); e[j] = 1;
      const rj = respond(e, 1); for (let i = 0; i < nN; i++) A1[i][j] = rj[i] - r1[i];
    }
    const solveAt = qq => {
      const A = A1.map((row, i) => row.map((v, j) => (i === j ? 1 : 0) - qq * v));
      const r = gaussSolve(A, b0.map((v, i) => v + qq * b1[i]));
      return r && r.x.every(isFinite) ? r : null;
    };
    // Torsionsdivergenz: kleinster Staudruck mit det(I − q·A1) = 0 (Vorzeichenwechsel)
    let vDiv = Infinity;
    const vScan = Math.max(4 * (+h.vne || 0), 3 * V, 300);
    if (elastic) {
      let vPrev = 0, sPrev = 1;
      for (let k = 1; k <= 300; k++) {
        const v = vScan * k / 300, r = solveAt(qOfV(v)), s = r ? r.detSign : 0;
        if (s !== sPrev) {
          let lo = vPrev, hi = v;
          for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2, rm = solveAt(qOfV(m)); if ((rm ? rm.detSign : 0) === sPrev) lo = m; else hi = m; }
          vDiv = (lo + hi) / 2; break;
        }
        vPrev = v; sPrev = s;
      }
    }
    const beyond = V >= vDiv;
    const sol = !elastic ? { x: zero } : (beyond ? null : solveAt(q));
    const E = sol ? respond(sol.x, q, true) : null, Rg = respond(zero, q, true);
    // Verlauf über die Geschwindigkeit (bis knapp vor die Divergenz)
    // ab der Mindestgeschwindigkeit (CL = ca_max)
    const vTop = Math.min(Math.max(1.3 * (+h.vne || 0), 1.3 * V, 60), isFinite(vDiv) ? 0.97 * vDiv : Infinity);
    const vLo = Math.min(0.9 * vTop, vOfQ(Lh / (Math.max(0.05, R.caMx || 1) * Sh)));
    const sweep = { v: [], w: [], th: [], wR: [], thR: [], da: [] };
    for (let k = 0; k <= 60; k++) {
      const v = Math.max(1, vLo + (vTop - vLo) * k / 60), qq = qOfV(v), r = elastic ? solveAt(qq) : { x: zero };
      const a = r ? respond(r.x, qq, true) : null, g = respond(zero, qq, true);
      sweep.v.push(v);
      sweep.w.push(a ? a.w[NS - 1] : NaN); sweep.th.push(a ? a.th[NS - 1] / DEG : NaN); sweep.da.push(a ? a.da[NS - 1] / DEG : NaN);
      sweep.wR.push(g.w[NS - 1]); sweep.thR.push(g.th[NS - 1] / DEG);
    }
    // Auslastung (mit j) im Schnellflug
    const util = Ld => {
      if (!Ld) return null;
      let uc = 0, uw = 0, us = 0, yc = 0, yw = 0, ys_ = 0;
      st.forEach((s, i) => {
        const M = R.j * Ld.M[i], Qv = R.j * Ld.Q[i], Tv = R.j * Ld.T[i];
        const At = s.tT * s.b, Ab = s.tB * s.b;
        if (s.hEff > 0 && Math.abs(M) > 1e-9) {
          const F = Math.abs(M) / s.hEff, sT = At > 0 ? F / At : Infinity, sB = Ab > 0 ? F / Ab : Infinity;
          const u = M >= 0 ? Math.max(sT / R.sC, sB / R.sT) : Math.max(sT / R.sT, sB / R.sC);
          if (u > uc) { uc = u; yc = s.y; }
        }
        const Vw = s.nW * s.hW * R.vPerMm, u2 = Vw > 0 ? Math.abs(Qv) / Vw : (Math.abs(Qv) > 1e-9 ? Infinity : 0);
        if (u2 > uw) { uw = u2; yw = s.y; }
        const t = s.nS * R.tps, u3 = t > 0 && s.Am > 0 && R.tauS > 0 ? Math.abs(Tv) / (2 * s.Am) / (t * R.tauS) : (Math.abs(Tv) > 1e-9 ? Infinity : 0);
        if (u3 > us) { us = u3; ys_ = s.y; }
      });
      return { cap: uc, capY: yc, web: uw, webY: yw, shell: us, shellY: ys_ };
    };
    // Abtrieb außen (örtlicher Auftrieb < 0)
    const negFrom = Ld => { if (!Ld) return -1; let i = NS - 2; while (i >= 0 && Ld.l[i] < 0) i--; return i < NS - 2 ? ys[i + 1] : -1; };
    return { V, q, CL, wm, wmSrc, elastic, useK, vDiv, vScan, beyond, E, Rg, sweep, uE: util(E), uR: util(Rg), negE: negFrom(E), negR: negFrom(Rg),
      sweepAny: tanL.some(t => Math.abs(t) > 0.02) };
  }

  // ---------- Darstellung -------------------------------------------------------
  const f0 = v => (Math.round(v)).toLocaleString('de-DE');
  const f1 = v => (Math.round(v * 10) / 10).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const f2 = v => (Math.round(v * 100) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const COL = { a: '#5c9ded', b: '#ff7a59', c: '#3fb9ab', d: '#b48ae0', e: '#e0b400' };
  // Aufeinanderfolgende Lagen/Rovings/Stege gleicher Länge zusammenfassen
  function groups(plan) {
    const out = [];
    plan.forEach((l, k) => { const g = out[out.length - 1]; if (g && Math.abs(g.len - l) < 0.5) g.to = k + 1; else out.push({ from: k + 1, to: k + 1, len: l }); });
    return out;
  }
  const gLbl = g => g.from === g.to ? String(g.from) : g.from + '–' + g.to;
  const unitName = R => R.isRov ? T('Rovings') : T('Lagen');
  function niceStep(span, n) {
    const raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw || 1))), m = raw / p;
    return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
  }
  // Liniendiagramm (SVG-Text). series: [{ys, color, name, dash, step}]
  function chart(title, unit, xs, series, opt) {
    opt = opt || {};
    // Legende vorab in Zeilen umbrechen; jede weitere Zeile schiebt die Zeichenfläche nach unten
    const W = 560, l = 54, r = 12, b = 30, legPos = [];
    { let x = l + 4, row = 0; series.forEach(s => { if (!s.name) { legPos.push(null); return; } const w = 30 + T(s.name).length * 6.2; if (x + w > W - r && x > l + 4) { x = l + 4; row++; } legPos.push({ x, y: 16 + row * 14 }); x += w; }); var legRows = row + 1; }
    const t = 26 + (legRows - 1) * 14, Hh = 230 + (legRows - 1) * 14;
    let y0 = opt.y0 != null ? opt.y0 : Infinity, y1 = -Infinity;
    series.forEach(s => s.ys.forEach(v => { if (isFinite(v)) { if (v < y0) y0 = v; if (v > y1) y1 = v; } }));
    if (!isFinite(y0) || !isFinite(y1)) { y0 = 0; y1 = 1; }
    if (opt.y0 == null) y0 = Math.min(0, y0);
    if (y1 - y0 < 1e-9) y1 = y0 + 1;
    const ys0 = niceStep(y1 - y0, 4); y0 = Math.floor(y0 / ys0) * ys0; y1 = Math.ceil(y1 / ys0) * ys0;
    const x0 = xs[0], x1 = xs[xs.length - 1] || 1;
    const X = v => l + (v - x0) / (x1 - x0) * (W - l - r), Y = v => t + (1 - (v - y0) / (y1 - y0)) * (Hh - t - b);
    let g = '';
    for (let v = y0; v <= y1 + ys0 * 0.01; v += ys0) {
      g += '<line x1="' + l + '" x2="' + (W - r) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="hg"/>';
      g += '<text x="' + (l - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end" class="ht">' + (Math.abs(ys0) < 1 ? f2(v) : f0(v)) + '</text>';
    }
    const xs0 = niceStep(x1 - x0, 6);
    for (let v = Math.ceil(x0 / xs0 - 1e-9) * xs0; v <= x1 + 1e-6; v += xs0) {
      g += '<line y1="' + t + '" y2="' + (Hh - b) + '" x1="' + X(v).toFixed(1) + '" x2="' + X(v).toFixed(1) + '" class="hg"/>';
      g += '<text x="' + X(v).toFixed(1) + '" y="' + (Hh - b + 15) + '" text-anchor="middle" class="ht">' + f0(v) + '</text>';
    }
    let leg = '', lx = l + 4;
    series.forEach(s => {
      let d = '';
      for (let i = 0; i < xs.length; i++) {
        const v = s.ys[i]; if (!isFinite(v)) continue;
        if (s.step && i > 0 && isFinite(s.ys[i - 1])) d += 'L' + X(xs[i]).toFixed(1) + ' ' + Y(s.ys[i - 1]).toFixed(1);
        d += (d ? 'L' : 'M') + X(xs[i]).toFixed(1) + ' ' + Y(v).toFixed(1);
      }
      g += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2"' + (s.dash ? ' stroke-dasharray="5 4"' : '') + '/>';
      const lp = legPos[series.indexOf(s)];
      if (lp) { leg += '<line x1="' + lp.x + '" x2="' + (lp.x + 16) + '" y1="' + lp.y + '" y2="' + lp.y + '" stroke="' + s.color + '" stroke-width="2"' + (s.dash ? ' stroke-dasharray="4 3"' : '') + '/><text x="' + (lp.x + 20) + '" y="' + (lp.y + 4) + '" class="ht">' + esc(T(s.name)) + '</text>'; }
    });
    return '<div class="holm-chart"><div class="holm-ct">' + esc(T(title)) + (unit ? ' <span>[' + esc(unit) + ']</span>' : '') + '</div>' +
      '<svg viewBox="0 0 ' + W + ' ' + Hh + '" preserveAspectRatio="xMidYMid meet">' + g + leg +
      '<text x="' + (W - r) + '" y="' + (Hh - 2) + '" text-anchor="end" class="ht">' + esc(opt.xLabel || T('Spannweite ab Wurzel') + ' [mm]') + '</text></svg></div>';
  }
  // Grundriss der Halbspannweite mit Holm (Gurtbreite maßstäblich) und Lagenenden
  function planform(R) {
    const W = 1100, Hh = 300, pad = 30;
    const K = R.geo.knots, L = R.L;
    let xmin = 0, xmax = 0;
    K.forEach(k => { xmin = Math.min(xmin, k.le); xmax = Math.max(xmax, k.le + k.c); });
    const sc = Math.min((W - 2 * pad) / L, (Hh - 2 * pad - 20) / (xmax - xmin || 1));
    const X = y => pad + y * sc, Y = x => pad + (x - xmin) * sc;
    const leP = K.map(k => X(k.y).toFixed(1) + ',' + Y(k.le).toFixed(1)), teP = K.slice().reverse().map(k => X(k.y).toFixed(1) + ',' + Y(k.le + k.c).toFixed(1));
    let g = '<polygon points="' + leP.concat(teP).join(' ') + '" class="pf"/>';
    K.forEach(k => { g += '<line x1="' + X(k.y).toFixed(1) + '" x2="' + X(k.y).toFixed(1) + '" y1="' + Y(k.le).toFixed(1) + '" y2="' + Y(k.le + k.c).toFixed(1) + '" class="rib"/>'; });
    // Gurtband: Abschnitte gleicher Lagenzahl (Obergurt) unterschiedlich kräftig
    const st = R.st, nMax = Math.max(1, ...st.map(s => s.nT));
    for (let i = 1; i < st.length; i++) {
      const a = st[i - 1], b = st[i];
      const cA = a.le + a.xr * a.c, cB = b.le + b.xr * b.c;
      const op = 0.25 + 0.75 * (a.nT / nMax);
      g += '<polygon points="' + [X(a.y) + ',' + Y(cA - a.b / 2), X(b.y) + ',' + Y(cB - b.b / 2), X(b.y) + ',' + Y(cB + b.b / 2), X(a.y) + ',' + Y(cA + a.b / 2)].join(' ') +
        '" fill="' + COL.b + '" fill-opacity="' + op.toFixed(2) + '" stroke="none"/>';
    }
    const mark = (plan, col, dy, lbl) => groups(plan).forEach(gr => {
      const l = gr.len;
      if (l >= L - 1e-6) return;
      const s = st[Math.min(N_ST, Math.round(l / L * N_ST))], cx = s.le + s.xr * s.c;
      g += '<line x1="' + X(l).toFixed(1) + '" x2="' + X(l).toFixed(1) + '" y1="' + (Y(cx) - 9 + dy).toFixed(1) + '" y2="' + (Y(cx) + 9 + dy).toFixed(1) + '" stroke="' + col + '" stroke-width="1.5"/>';
      g += '<text x="' + X(l).toFixed(1) + '" y="' + (Y(cx) + (dy < 0 ? -12 : 21) + dy).toFixed(1) + '" text-anchor="middle" class="ht" fill="' + col + '">' + lbl + gLbl(gr) + '</text>';
    });
    mark(R.planT, COL.b, -6, T('o'));
    mark(R.planB, COL.a, 6, T('u'));
    // Stegabschnitte als Text unter der Endleiste
    R.webSecs.forEach(w => {
      const xm = X((w.from + w.to) / 2), s = stationAt(R.geo, (w.from + w.to) / 2, 0.3);
      g += '<text x="' + xm.toFixed(1) + '" y="' + (Y(s.le + s.c) + 16).toFixed(1) + '" text-anchor="middle" class="ht">' + w.n + ' × ' + esc(T('Steg')) + '</text>';
      if (w.from > 0) g += '<line x1="' + X(w.from).toFixed(1) + '" x2="' + X(w.from).toFixed(1) + '" y1="' + (Y(s.le + s.c) + 4).toFixed(1) + '" y2="' + (Y(s.le + s.c) + 20).toFixed(1) + '" class="hg"/>';
    });
    const hh = Math.max(...K.map(k => Y(k.le + k.c))) + 30;
    return '<svg class="holm-plan" viewBox="0 0 ' + W + ' ' + Math.min(Hh + 10, hh).toFixed(0) + '" preserveAspectRatio="xMinYMin meet">' + g + '</svg>';
  }
  // Lagenplan (Balken je Lage, Länge ab Wurzel)
  function layerChart(R) {
    const rows = [];
    const add = (plan, nm, c) => groups(plan).forEach(gr => rows.push({ lbl: nm + ' ' + gLbl(gr), l: gr.len, c }));
    add(R.planT, T('Holmgurt oben'), COL.b);
    add(R.planB, T('Holmgurt unten'), COL.a);
    add(R.planW, T('Steg'), COL.e);
    add(R.planS, T('Schale'), COL.c);
    const W = 1100, lw = 150, rh = 16, Hh = rows.length * rh + 30;
    const X = v => lw + v / R.L * (W - lw - 60);
    let g = '';
    rows.forEach((r, i) => {
      const y = 8 + i * rh;
      g += '<text x="' + (lw - 8) + '" y="' + (y + 11) + '" text-anchor="end" class="ht">' + esc(r.lbl) + '</text>';
      g += '<rect x="' + lw + '" y="' + (y + 2) + '" width="' + (X(r.l) - lw).toFixed(1) + '" height="' + (rh - 5) + '" fill="' + r.c + '" fill-opacity=".75" rx="2"/>';
      g += '<text x="' + (X(r.l) + 6).toFixed(1) + '" y="' + (y + 11) + '" class="ht">' + f0(r.l) + '</text>';
    });
    const xs0 = niceStep(R.L, 8);
    for (let v = 0; v <= R.L + 1e-6; v += xs0) g += '<text x="' + X(v).toFixed(1) + '" y="' + (Hh - 6) + '" text-anchor="middle" class="ht">' + f0(v) + '</text>';
    return '<svg class="holm-plan" viewBox="0 0 ' + W + ' ' + Hh + '" preserveAspectRatio="xMinYMin meet">' + g + '</svg>';
  }
  // Theoretische Bruchgrenze: Karte, Diagramm je Station
  const fn = v => !isFinite(v) ? '∞' : v < 10 ? f1(v) : f0(v);
  function brkCard(R) {
    const b = R.brk; if (!b) return '';
    const bad = isFinite(b.pos.n) && b.pos.n < R.nP;
    const g = R.Lw > 0 ? f1(b.pos.n * (+R.h.mass) / 1000) + ' kg' : '';
    return card('Theoretische Bruchgrenze', (bad ? '<span class="bad">' : '') + 'n = ' + fn(b.pos.n) + (bad ? '</span>' : '') + ' / −' + fn(b.neg.n),
      esc(T('maßgebend') + ': ' + T(b.pos.part) + ' ' + T('bei') + ' y = ' + f0(b.pos.y) + ' mm') + '<br>' +
      esc(T('Reserve gegenüber n') + ' ×' + (isFinite(b.reserve) ? f2(b.reserve) : '∞') + ' · ' + T('Auftrieb beim Bruch') + ' ' + f0(b.lift) + ' N' + (g ? ' (≙ ' + g + ')' : '') +
        ' · ' + T('Durchbiegung beim Bruch') + ' ≈ ' + f0(b.wTip) + ' mm, ' + f1(b.aTip) + '°'));
  }
  const SRC_TXT = { manual: 'selbst angegeben', noaero: 'selbst angegeben — Reiter „Aerodynamik“ nicht in dieser Ausgabe',
    pending: 'wird aus der Aerodynamik berechnet …', fail: 'Aerodynamik-Rechnung nicht möglich — Wert von Hand' };
  function caSrcTxt(R) {
    const c = R.ca || {};
    if (c.src === 'aero') return T('aus der Aerodynamik') + ', ' + T('Re bei') + ' ' + f0(c.v * 3.6) + ' km/h, ' + T('Abriss zuerst') + ' ' + (c.frac > 0.65 ? T('außen') : T('innen'));
    return T(SRC_TXT[c.src] || '');
  }
  function caCard(R) {
    const c = R.ca || {}, pend = c.src === 'pending';
    return card('ca_max der Tragfläche', (pend ? '<span style="color:var(--muted)">' : '') + f2(R.caMx) + (pend ? ' …</span>' : ''),
      esc(caSrcTxt(R)) + (c.src === 'aero' ? '<br>' + esc(T('VLM, erster Streifen erreicht sein cl_max') + ' (cl_max ' + f2(c.clLocal) + ') · α ' + f1(c.alpha) + '°' +
        (c.pol === 'flat' ? ' · ' + T('ohne Profilpolaren: pauschal cl_max') + ' ' + f2(c.clDef) : '')) : ''));
  }
  function cmCard(R) {
    const c = R.cmI || {}, pend = c.src === 'pending';
    if (c.src === 'aero') {
      const v = c.pts.map(p => p.cm), lo = Math.min(...v), hi = Math.max(...v);
      return card('c_m0 über die Spannweite', f2(R.st[0].cm0) + ' → ' + f2(R.st[R.st.length - 1].cm0),
        esc(T('aus den Profilpolaren') + ', ' + T('Re bei') + ' V_NE ' + f0(c.v * 3.6) + ' km/h · ' + T('Bereich') + ' ' + f2(lo) + ' … ' + f2(hi)) + '<br>' +
        esc(c.pts.map(p => (p.name || 'y ' + f0(p.y)) + ' ' + f2(p.cm)).join(' · ')));
    }
    return card('c_m0 über die Spannweite', (pend ? '<span style="color:var(--muted)">' : '') + f2(+R.h.cm0 || 0) + (pend ? ' …</span>' : ''), esc(T(SRC_TXT[c.src] || '')));
  }
  function vbCard(R) {
    const v = R.brk && R.brk.vb; if (!v) return '';
    const ttl = T('Bruchgeschwindigkeit bei vollem Ziehen, ca') + ' = ' + f2(v.ca);
    if (!isFinite(v.v)) return card(ttl, '–', esc(T(v.ca > 0 ? 'Fluggewicht fehlt — ohne Masse keine Lasten.' : 'ca = 0: kein Auftrieb.')));
    const vne = +R.h.vne || 0, low = vne > 0 && v.v < vne;
    return card(ttl, (low ? '<span class="bad">' : '') + 'V = ' + f0(v.v) + ' km/h' + (low ? '</span>' : ''),
      esc(T('maßgebend') + ': ' + T(v.part) + ' ' + T('bei') + ' y = ' + f0(v.y) + ' mm · n = ' + f1(v.n) + ' · ' + f1(v.v / 3.6) + ' m/s' +
        (vne > 0 ? ' · V_NE ' + f0(vne) + ' km/h' + (low ? ' — ' + T('Flügel bricht unter V_NE, wenn voll gezogen wird') : ' ×' + f2(v.v / vne)) : '')));
  }
  function brkChart(R) {
    const top = Math.max(3 * (R.brk && isFinite(R.brk.pos.n) ? R.brk.pos.n : 1), 2 * R.j * R.nP) || 10;
    const lim = v => isFinite(v) ? Math.min(top, v) : NaN;
    return chart('Bruch-Lastvielfaches je Station', 'n', R.ys, [
      { ys: R.st.map(s => lim(s.nbCapP)), color: COL.b, name: 'Gurt' },
      { ys: R.st.map(s => lim(s.nbWeb)), color: COL.e, name: 'Steg' },
      { ys: R.st.map(s => lim(s.nbShP)), color: COL.d, name: 'Schale' },
      { ys: R.st.map(() => R.nP), color: COL.c, name: 'n', dash: 1 },
      { ys: R.st.map(() => R.j * R.nP), color: '#ff6b6b', name: 'j·n', dash: 1 }], { y0: 0 });
  }
  // ---------- Lastvielfaches beim Abfangen ------------------------------------------
  // Tiefster Punkt eines Abfangbogens mit Durchmesser D: n = 1 + 2·V²/(g·D) (gewichtsunabhängig).
  // Grenze durch ca_max: n ≤ ρ/2·V²·S·ca_max/(m·g). Bruch: der Holm trägt einen festen Auftrieb
  // (Auftrieb beim Bruch), also n_Bruch(m) = n_Bruch · m₀/m. Geflogen wird min(Manöver, ca_max-Grenze);
  // der Flügel bricht, sobald das n_Bruch erreicht → V_Bruch = max(V_Bogen, V_ca).
  const numList = (txt, lo, hi) => String(txt || '').split(/[;,\s]+/).map(v => parseFloat(v.replace(',', '.'))).filter(v => isFinite(v) && v >= lo && v <= hi);
  function pullSection(R) {
    const h = R.h, b = R.brk;
    if (!b || !(R.Lw > 0) || !isFinite(b.pos.n)) {
      return '<div class="holm-warn">' + esc(T('Für diese Darstellung werden Fluggewicht und eine Bruchgrenze gebraucht.')) + '</div>';
    }
    const m0 = +h.mass, share = Math.max(0.01, (+h.share || 100) / 100);
    const S = 2 * R.st.reduce((a, s, i) => i ? a + 0.5 * (s.c + R.st[i - 1].c) * (s.y - R.st[i - 1].y) : 0, 0) * 1e-6;   // m²
    const rho = +h.rho || 1.225, caM = R.caMx;
    const Ds = numList(h.pullD, 1, 2000).slice(0, 6);
    let Ms = numList(h.pullM, 10, 1e6).slice(0, 4); if (!Ms.length) Ms = [m0];
    const nBrOf = m => b.pos.n * m0 / m;                                     // Holm trägt festen Auftrieb
    const nCaOf = (m, v) => rho / 2 * v * v * S * caM / (m / 1000 * G * share);
    const nArc = (D, v) => 1 + 2 * v * v / (G * D);
    // Diagramm n über V
    const vTop = Math.max(60, Math.min(600, 1.4 * 3.6 * Math.max(...Ms.map(m => Math.sqrt(nBrOf(m) * m / 1000 * G * share / (rho / 2 * S * caM))))));
    const vs = []; for (let k = 0; k <= 120; k++) vs.push(vTop * k / 120);
    const nTop = 1.6 * Math.max(...Ms.map(nBrOf), R.j * R.nP);
    const lim = v => v <= nTop ? v : NaN;
    const DCOL = [COL.a, COL.c, COL.e, COL.d, '#7fd1ff', '#c0c0c0'], MCOL = ['#ff6b6b', '#ff9f43', '#f368e0', '#feca57'];
    const kg = m => f2(m / 1000) + ' kg';
    const ser = Ds.map((D, i) => ({ ys: vs.map(v => lim(nArc(D, v / 3.6))), color: DCOL[i % DCOL.length], name: 'Ø ' + f0(D) + ' m' }));
    Ms.forEach((m, i) => {
      ser.push({ ys: vs.map(v => lim(nCaOf(m, v / 3.6))), color: MCOL[i], name: 'ca_max ' + kg(m), dash: 1 });
      ser.push({ ys: vs.map(() => nBrOf(m)), color: MCOL[i], name: 'n_Bruch ' + kg(m) });
    });
    let html = '<div class="holm-3dbar">' +
      '<label>' + esc(T('Bogendurchmesser (m)')) + ' <input type="text" data-pull="pullD" value="' + esc(h.pullD) + '" style="width:130px"></label>' +
      '<label>' + esc(T('Gewichte zum Vergleich (g)')) + ' <input type="text" data-pull="pullM" value="' + esc(h.pullM) + '" placeholder="' + f0(m0) + ', ' + f0(m0 * 1.5) + '" style="width:130px"></label>' +
      (h.caSrc === 'manual' ? '<label>ca_max <input type="text" data-pull="caMax" value="' + f2(caM) + '" style="width:50px"></label>'
        : '<span>ca_max = <b>' + f2(caM) + '</b> <span style="color:var(--muted)">(' + esc(caSrcTxt(R)) + ')</span></span>') +
      '<span style="color:var(--muted)">S = ' + f2(S * 100) + ' dm²</span></div>';
    html += '<div class="holm-charts" style="margin-top:4px">' + chart('Lastvielfaches über Geschwindigkeit', 'n', vs, ser, { y0: 0, xLabel: T('Geschwindigkeit') + ' [km/h]' });
    // Rechner
    const cV = Math.max(0, +h.pullV || 0) / 3.6, cD = Math.max(0.5, +h.pullDc || 20), cM = (+h.pullMc > 0 ? +h.pullMc : m0);
    const nA = nArc(cD, cV), nC = nCaOf(cM, cV), nF = Math.min(nA, nC), nB = nBrOf(cM);
    const caReq = cV > 0 ? nA * cM / 1000 * G * share / (rho / 2 * cV * cV * S) : Infinity;
    const lift = nF * cM / 1000 * G * share;
    const brk = nF >= nB;
    const vArcB = Math.sqrt(Math.max(0, (nB - 1) * G * cD / 2)), vCaB = Math.sqrt(nB * cM / 1000 * G * share / (rho / 2 * S * caM));
    const vBr = Math.max(vArcB, vCaB) * 3.6;
    html += '<div class="holm-calc"><div class="holm-ct">' + esc(T('Rechner')) + '</div>' +
      '<div class="holm-3dbar">' +
      '<label>V (km/h) <input type="text" data-pull="pullV" value="' + f0(cV * 3.6) + '" style="width:60px"></label>' +
      '<label>' + esc(T('Bogendurchmesser (m)')) + ' <input type="text" data-pull="pullDc" value="' + f1(cD) + '" style="width:60px"></label>' +
      '<label>' + esc(T('Gewicht (g)')) + ' <input type="text" data-pull="pullMc" value="' + f0(cM) + '" style="width:70px"></label></div>' +
      table([T('Größe'), T('Wert')], [
        [esc(T('Lastvielfaches für diesen Bogen')), 'n = ' + f1(nA)],
        [esc(T('nötiger Auftriebsbeiwert')), 'ca = ' + f2(caReq) + (caReq > caM ? ' <b class="bad">' + esc(T('> ca_max — Strömungsabriss, Bogen nicht so eng fliegbar')) + '</b>' : '')],
        [esc(T('tatsächlich erreichbares n')), 'n = ' + f1(nF) + (nC < nA ? ' (' + esc(T('durch ca_max begrenzt')) + ')' : '')],
        [esc(T('Auftrieb im tiefsten Punkt')), f0(lift) + ' N'],
        [esc(T('Bruchgrenze bei diesem Gewicht')), 'n = ' + f1(nB) + ' · ' + esc(T('Auslastung')) + ' ' + uTxt(nF / nB)],
        [esc(T('Ergebnis für diesen Bogen')), brk ? '<b class="bad">' + esc(T('Flügel bricht')) + '</b>' : esc(T('hält')) + ' (' + T('Reserve') + ' ×' + f2(nB / nF) + ')'],
        [esc(T('Bruch bei diesem Bogen und Gewicht ab')), 'V = ' + f0(vBr) + ' km/h' + (vCaB > vArcB ? ' (' + esc(T('ca_max begrenzt — enger ziehen geht nicht')) + ')' : '')],
        // Vergleich: bei derselben Geschwindigkeit voll gezogen (engster möglicher Bogen)
        [esc(T('bei vollem Ziehen (ca_max) bei dieser Geschwindigkeit')), 'n = ' + f1(nC) + ' · ' + (nC >= nB ? '<b class="bad">' + esc(T('Flügel bricht')) + '</b>' : esc(T('hält'))) +
          ' · ' + esc(T('engster Bogen')) + ' Ø ' + (nC > 1 ? f1(2 * cV * cV / (G * (nC - 1))) + ' m' : '–')],
        [esc(T('Bruch bei vollem Ziehen (ca_max) ab')), 'V = ' + f0(vCaB * 3.6) + ' km/h']
      ]) + '<div class="holm-note" style="margin-top:6px">' + esc(T('Zwei verschiedene Manöver: „dieser Bogen“ = gleichmäßiges Abfangen mit dem eingegebenen Durchmesser (braucht nur das nötige ca); „voll gezogen“ = mit ca_max, also der engste Bogen, den die Fläche bei dieser Geschwindigkeit fliegen kann. Die Karte „Bruchgeschwindigkeit“ oben gilt für voll gezogen.')) + '</div></div></div>';
    // Tabelle Bruchgeschwindigkeit je Durchmesser × Gewicht
    html += table([T('Bogendurchmesser')].concat(Ms.map(m => 'V<sub>Bruch</sub> ' + kg(m))), Ds.map(D => ['Ø ' + f0(D) + ' m'].concat(Ms.map(m => {
      const nb = nBrOf(m), va = Math.sqrt(Math.max(0, (nb - 1) * G * D / 2)), vc = Math.sqrt(nb * m / 1000 * G * share / (rho / 2 * S * caM));
      return f0(Math.max(va, vc) * 3.6) + ' km/h';
    }))));
    return html;
  }
  // ---------- Schnellflug: Karten und Diagramme ----------------------------------------
  function fastSection(R) {
    const F = R.fast, h = R.h;
    let html = '';
    if (!F) return html + '<div class="holm-warn">' + esc(T('Für den Schnellflug werden Fluggewicht und Tragflächengeometrie gebraucht.')) + '</div>';
    const E = F.E, G0 = F.Rg, nL = R.ys.length - 1, fw = v => Math.abs(v) < 10 ? f1(v) : f0(v);
    const lbl = (h.fastMode === 'cl' ? 'CL = ' + f2(F.CL) + ' → V = ' + f0(F.V) + ' km/h' : 'V = ' + f0(F.V) + ' km/h → CL = ' + f2(F.CL));
    if (F.beyond) html += '<div class="holm-warn">' + esc(T('Die Geschwindigkeit liegt über der Divergenzgeschwindigkeit — die Fläche verdreht sich unbegrenzt auf (Torsionsdivergenz). Holm weiter nach vorne legen oder Schale torsionssteifer machen.')) + '</div>';
    const A = E || G0;
    const wTipE = A.w[nL], thE = A.th[nL] / DEG, daE = A.da[nL] / DEG;
    const uTx = U => U ? esc(T('Gurt')) + ' ' + uTxt(U.cap) + ' · ' + esc(T('Steg')) + ' ' + uTxt(U.web) + ' · ' + esc(T('Schale')) + ' ' + uTxt(U.shell) : '–';
    const wmTxt = { auto: T('Gewichtsschätzung + Holm'), struct: T('nur Holmstruktur (keine Gewichtsschätzung)'), manual: T('selbst angegeben') }[F.wmSrc] || '';
    const div = !F.elastic ? T('ohne elastische Rückwirkung gerechnet') : isFinite(F.vDiv) ? 'V_D = ' + f0(F.vDiv) + ' km/h' : '> ' + f0(F.vScan) + ' km/h';
    html += '<div class="holm-cards">' +
      card('Flugzustand', lbl, 'q = ' + f0(F.q * 1e6) + ' Pa · ' + T('Auftrieb je Hälfte') + ' ' + f1(R.Lh) + ' N · ' + T('Flügelmasse je Hälfte') + ' ' + f0(F.wm) + ' g (' + esc(wmTxt) + ')') +
      card('Durchbiegung Spitze', (wTipE < 0 ? '<span style="color:#5c9ded">' : '') + fw(wTipE) + ' mm' + (wTipE < 0 ? ' ↓</span>' : ' ↑'),
        esc(T('starr gerechnet')) + ' ' + fw(G0.w[nL]) + ' mm' + (F.negE >= 0 ? ' · ' + esc(T('Abtrieb ab')) + ' y = ' + f0(F.negE) + ' mm' : '')) +
      card('Verdrehung Spitze (elastisch)', f2(thE) + '°', esc(T('Anstellwinkeländerung')) + ' ' + f2(daE) + '°' + (F.sweepAny ? ' (' + esc(T('inkl. Pfeilung')) + ')' : '') + ' · ' + esc(T('ohne Rückwirkung')) + ' ' + f2(G0.th[nL] / DEG) + '° · ' + esc(T('+ = Nase hoch'))) +
      card('Wurzel-Biegemoment', f1(A.M[0] / 1000) + ' N·m', esc(T('Torsion an der Wurzel')) + ' ' + f2(A.T[0] / 1000) + ' N·m') +
      card('Divergenzgeschwindigkeit', isFinite(F.vDiv) && F.vDiv < (+h.vne || 0) * 1.2 ? '<span class="bad">' + esc(div) + '</span>' : esc(div),
        esc(F.useK ? T('Rückwirkung aus dem VLM der Tragfläche') : T('Rückwirkung nach Streifentheorie (kein VLM-Ergebnis)')) + (isFinite(F.vDiv) && +h.vne > 0 ? ' · V_NE ×' + f2(F.vDiv / +h.vne) : '')) +
      card('Auslastung bei j · Schnellflug', F.uE ? uTxt(Math.max(F.uE.cap, F.uE.web, F.uE.shell)) : '–', uTx(F.uE)) +
      '</div>';
    const ys = R.ys, st = R.st;
    const ser = (key, fac, nmE, nmR) => [{ ys: A[key].map(v => v * fac), color: COL.b, name: nmE }, { ys: G0[key].map(v => v * fac), color: COL.c, name: nmR, dash: 1 }];
    html += '<div class="holm-charts">' +
      chart('Durchbiegung im Schnellflug', 'mm', ys, ser('w', 1, 'elastisch', 'starr').concat([{ ys: ys.map(() => 0), color: '#888', dash: 1 }])) +
      chart('Verdrehung im Schnellflug', '°', ys, [{ ys: A.th.map(v => v / DEG), color: COL.d, name: 'Verdrehung elastisch' },
        { ys: A.da.map(v => v / DEG), color: COL.b, name: 'Anstellwinkeländerung', dash: 0 },
        { ys: G0.th.map(v => v / DEG), color: COL.c, name: 'Verdrehung ohne Rückwirkung', dash: 1 }]) +
      chart('Örtliches cl im Schnellflug', 'cl', ys, [{ ys: A.cl, color: COL.b, name: 'elastisch' }, { ys: G0.cl, color: COL.c, name: 'starr', dash: 1 }, { ys: ys.map(() => 0), color: '#888', dash: 1 }]) +
      chart('Biegemoment im Schnellflug', 'N·m', ys, ser('M', 1e-3, 'elastisch', 'starr')) +
      chart('Torsionsmoment im Schnellflug', 'N·m', ys, ser('T', 1e-3, 'elastisch', 'starr')) +
      chart('Durchbiegung Spitze über der Geschwindigkeit', 'mm', F.sweep.v, [{ ys: F.sweep.w, color: COL.b, name: 'elastisch' }, { ys: F.sweep.wR, color: COL.c, name: 'starr', dash: 1 }, { ys: F.sweep.v.map(() => 0), color: '#888', dash: 1 }], { xLabel: T('Geschwindigkeit') + ' [km/h]' }) +
      chart('Verdrehung Spitze über der Geschwindigkeit', '°', F.sweep.v, [{ ys: F.sweep.th, color: COL.d, name: 'Verdrehung elastisch' }, { ys: F.sweep.da, color: COL.b, name: 'Anstellwinkeländerung' }, { ys: F.sweep.thR, color: COL.c, name: 'ohne Rückwirkung', dash: 1 }], { xLabel: T('Geschwindigkeit') + ' [km/h]' }) +
      '</div>';
    return html;
  }

  function card(lbl, val, sub) { return '<div class="holm-card"><div class="l">' + esc(T(lbl)) + '</div><div class="v">' + val + '</div>' + (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>'; }
  function table(head, rows) {
    return '<table class="holm-tab"><thead><tr>' + head.map(hd => '<th>' + hd + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  }
  const mn = m => m ? T(m.name) : '–';
  const uTxt = u => !isFinite(u) ? '<b class="bad">∞</b>' : (u > 1.0001 ? '<b class="bad">' + f0(u * 100) + ' %</b>' : f0(u * 100) + ' %');

  // ---------- Einklappbare Gruppen im Ergebnis ------------------------------------------
  // Auf/zu je Gruppe merkt sich der Browser (nur Bedienkomfort, nicht im Projekt).
  const GRP_DEF = { load: 1, cap: 1, web: 1, shell: 1, brk: 1, v3: 1, fast: 1, pull: 0, plan: 0, stat: 0 };
  let grpOpen = null;
  function grpState() {
    if (grpOpen) return grpOpen;
    grpOpen = Object.assign({}, GRP_DEF);
    try { const v = JSON.parse(localStorage.getItem('hw_holm_grp') || 'null'); if (v && typeof v === 'object') Object.assign(grpOpen, v); } catch (e) {}
    return grpOpen;
  }
  function grpSave() { try { localStorage.setItem('hw_holm_grp', JSON.stringify(grpOpen)); } catch (e) {} }
  function grpBox(key, title, sub, body) {
    return '<details class="holm-grp" data-grp="' + key + '"' + (grpState()[key] ? ' open' : '') + '><summary>' + esc(T(title)) +
      (sub ? ' <span>' + sub + '</span>' : '') + '</summary><div class="holm-gb">' + body + '</div></details>';
  }

  function render() {
    const el = document.getElementById('holmRes');
    if (!el) return;
    let R;
    try { R = compute(); } catch (e) { console.error(e); el.innerHTML = '<div class="holm-warn">' + esc(T('Fehler in der Rechnung:') + ' ' + e.message) + '</div>'; return; }
    if (R.err) { el.innerHTML = '<div class="holm-warn">' + esc(R.err) + '</div>'; return; }
    const st = R.st, s0 = st[0], h = R.h;
    // Durchbiegung der Flächenspitze: immer zeigen (1 g, n, j·n und die Grenze)
    const w1t = R.defl[R.defl.length - 1];
    const wOver = R.wMax > 0 && R.wTipRef > R.wMax + 0.05;
    const wRefLbl = { '1g': '1 g', n: 'n', d: 'j·n' }[h.wRef] || 'n';
    const fw = v => Math.abs(v) < 10 ? f1(v) : f0(v);
    const wbt = R.deflB[R.deflB.length - 1];
    const wTipTxt = fw(w1t + R.qA1 * wbt) + ' mm (1 g ' + T('langsam') + ') · ' + fw(w1t + R.qNE * wbt) + ' mm (1 g ' + T('bei') + ' V_NE) · ' +
      fw(w1t * R.nP + R.qA * wbt) + ' mm (n = ' + f1(R.nP) + ') · ' + fw(R.j * (w1t * R.nP + R.qA * wbt)) + ' mm (j·n)' +
      (R.wMax > 0 ? ' · ' + T('Grenze') + ' ' + fw(R.wMax) + ' mm ' + T('bei') + ' ' + wRefLbl + (wOver ? ' <b class="bad">' + esc(T('überschritten')) + '</b>' : ' ✓') : '');
    const srcTxt = { vlmw: T('VLM der Tragfläche (Zusatz- + Grundverteilung aus Schränkung)'), vlm: T('VLM (Reiter „Aerodynamik")'), schrenk: T('Schrenk-Näherung'), ellipse: T('elliptisch') }[R.shape.used];
    const wn = App.wingName ? App.wingName() : '';
    const modeTxt = { design: T('Auslegen'), check: T('Nachrechnen (Bruchlast)'), mixed: T('gemischt') }[h.calcMode] || '';
    let html = '<div class="holm-head"><b>' + esc(T('Holmauslegung')) + (wn ? ' · ' + esc(wn) : '') + '</b> — ' + esc(T('Rechenart')) + ': ' + esc(modeTxt) + ' · ' +
      esc(T('Halbspannweite')) + ' ' + f0(R.L) + ' mm · ' + esc(T('Lastverteilung')) + ': ' + esc(srcTxt) +
      ' · ' + esc(T('Bemessungslast')) + ' j·n = ' + f2(R.j) + ' × ' + f1(R.nP) + ' / −' + f1(R.nN) +
      ' · <b>' + esc(T('Durchbiegung Flächenspitze')) + '</b> ' + wTipTxt + '</div>';
    if (R.warn.length) html += R.warn.map(w => '<div class="holm-warn">' + esc(w) + '</div>').join('');
    const A = R.aero;
    // Stegabstufung als Text: „3 → 2 ab 420 mm → 1 ab 880 mm"
    const webSteps = R.webSecs.filter(w => w.n > 0).map(w => w.n + (w.from > 0 ? ' ' + T('ab {y} mm').replace('{y}', f0(w.from)) : '')).join(' → ');
    const ys = R.ys, cards = c => '<div class="holm-cards">' + c + '</div>', charts = c => '<div class="holm-charts">' + c + '</div>';
    const sec = (t, sub) => '<div class="holm-sec">' + esc(T(t)) + (sub ? ' <span>' + esc(sub) + '</span>' : '') + '</div>';
    html += '<div class="holm-gbar"><button data-grpall="1">' + esc(T('alle aufklappen')) + '</button><button data-grpall="0">' + esc(T('alle zuklappen')) + '</button></div>';
    const G = {};

    // --- Lasten ---
    G.load = grpBox('load', 'Lasten', esc(T('Lastverteilung')) + ': ' + esc(srcTxt) + ' · j·n = ' + f2(R.j) + ' × ' + f1(R.nP) + ' / −' + f1(R.nN),
      cards((A ? card('Lastfall ca_max · V', f0(A.A) + ' N', 'ca_max ' + f2(R.caMx) + ' · V ' + f0(+h.vMax) + ' km/h · S ' + f2(A.S / 1e4) + ' dm² · ' +
        (R.Lw > 0 ? 'n = ' + f1(A.n) + ' · ' + T('Abfangradius') + ' ' + (isFinite(A.r) ? f1(A.r) + ' m' : '–') : T('n unbekannt (Fluggewicht fehlt)'))) : '') +
        card('Auftrieb je Hälfte (1 g)', f1(R.Lh) + ' N') +
        card('Wurzel-Biegemoment (Bemessung)', f1(s0.Mp / 1000) + ' N·m', T('1 g') + ': ' + f1(s0.M1 / 1000) + ' N·m') +
        card('Wurzel-Querkraft (Bemessung)', f0(s0.Qd) + ' N') +
        card('Wurzel-Torsion (Bemessung)', f2(s0.Td / 1000) + ' N·m', 'V_NE ' + f0(+h.vne) + ' km/h') +
        caCard(R) + cmCard(R)) +
      charts(chart('Biegemoment', 'N·m', ys, [{ ys: st.map(s => s.Mp / 1000), color: COL.b, name: 'Bemessung (+)' }, { ys: st.map(s => -s.Mn / 1000), color: COL.a, name: 'Bemessung (−)', dash: 1 }, { ys: st.map(s => s.M1 / 1000), color: COL.c, name: '1 g' }]) +
        (R.lb ? (() => {
          const clOf = (CL, s) => s.c > 0 ? (CL * s.w1 / (R.Lh || 1) * R.ShMm + s.wb) / s.c : NaN;
          const CLne1 = R.qNE > 0 ? R.Lh / (R.qNE * R.ShMm) : NaN, CLneN = Math.min(R.caMx, CLne1 * R.nP);
          return chart('Örtliches cl (Zusatz- + Grundverteilung)', 'cl', ys, [
            { ys: st.map(s => clOf(R.caMx, s)), color: COL.b, name: 'Abfangen mit ca_max' },
            { ys: st.map(s => clOf(CLneN, s)), color: COL.a, name: 'V_NE, n' },
            { ys: st.map(s => clOf(CLne1, s)), color: COL.c, name: 'V_NE, 1 g' },
            { ys: st.map(s => clOf(0, s)), color: COL.d, name: 'Grundverteilung (CL = 0)', dash: 1 },
            { ys: st.map(() => 0), color: '#888', dash: 1 }]);
        })() : '') +
        chart('Querkraft', 'N', ys, [{ ys: st.map(s => s.Qd), color: COL.b, name: 'Bemessung' }, { ys: st.map(s => s.Q1), color: COL.c, name: '1 g' }]) +
        chart('Torsionsmoment (Bemessung)', 'N·m', ys, [{ ys: st.map(s => s.Td / 1000), color: COL.d, name: 'Bemessung' }, { ys: st.map(s => s.T1 / 1000), color: COL.c, name: 'V_NE, 1 g' }])));

    // --- Holmgurte: Lagen, Bauhöhe, Durchbiegung, Grundriss, Zuschnitt ---
    let capCut;
    if (R.isRov) {
      // Rovings: Bündel gleicher Länge, Masse je Bündel
      const rovRows = (cut, plan, nm) => groups(plan).map(gr => {
        let g = 0; for (let k = gr.from; k <= gr.to; k++) g += cut[k - 1].g;
        return [nm + ' ' + gLbl(gr), String(gr.to - gr.from + 1), f0(gr.len), f1((gr.to - gr.from + 1) * gr.len / 1000) + ' m', f1(g)];
      });
      capCut = sec('Zuschnitt Holmgurte', mn(R.capM) + ' · ' + f2(R.aR) + ' mm²/Roving · ' + T('Abstufung in Bündeln zu') + ' ' + R.rStep + ' · ' + T('Rovings mittig ablegen, die längsten zuletzt obenauf')) +
        table([T('Rovings'), T('Anzahl'), T('Länge') + ' [mm]', T('Rovinglänge gesamt'), T('Laminat') + ' [g]'], rovRows(R.cutT, R.planT, T('oben')).concat(rovRows(R.cutB, R.planB, T('unten'))));
    } else {
      const cutRows = (cut, nm) => cut.map((c, k) => [nm + ' ' + (k + 1), f0(c.len), f1(c.bIn), f1(c.bOut), f1(c.g)]);
      capCut = sec('Zuschnitt Holmgurte', mn(R.capM) + ' · ' + T('Breite innen → außen = Trapezstreifen')) +
        table([T('Gewebelage'), T('Lagenlänge') + ' [mm]', T('Breite innen') + ' [mm]', T('Breite außen') + ' [mm]', T('Laminat') + ' [g]'], cutRows(R.cutT, T('oben')).concat(cutRows(R.cutB, T('unten'))));
    }
    G.cap = grpBox('cap', 'Holmgurte und Biegung', esc(mn(R.capM)) + ' · ' + s0.nT + ' / ' + s0.nB + ' ' + esc(unitName(R)) + ' ' + esc(T('an der Wurzel')) + ' · ' + esc(T('Durchbiegung Spitze')) + ' ' + fw(R.wTipRef) + ' mm',
      cards(card('Gurt oben / unten an der Wurzel', s0.nT + ' / ' + s0.nB + ' ' + esc(unitName(R)), esc(mn(R.capM)) + ' · ' +
          (R.isRov ? f2(R.aR) + ' mm²/Roving · ' + T('Gurtdicke') + ' ' + f2(s0.tT) + ' / ' + f2(s0.tB) + ' mm' : f2(R.tp) + ' mm/' + esc(T('Gewebelage')))) +
        card('Durchbiegung Spitze', (wOver ? '<span class="bad">' : '') + fw(R.wTipRef) + ' mm' + (wOver ? '</span>' : ''),
          T('bei') + ' ' + wRefLbl + ' (' + T('Lastfaktor') + ' ' + f1(R.wFac) + ')' + (R.wMax > 0 ? ' · ' + T('Grenze') + ' ' + fw(R.wMax) + ' mm' : '') +
          ' · 1 g: ' + fw(w1t) + ' mm' + (R.kStiff > 1.001 ? ' · ' + T('Gurte für die Steifigkeit verstärkt') + ' ×' + f2(R.kStiff) : ''))) +
      charts(chart(R.isRov ? 'Rovings im Gurt' : 'Gurtlagen', unitName(R), ys, [{ ys: st.map(s => s.nT), color: COL.b, name: 'oben', step: 1 }, { ys: st.map(s => s.nB), color: COL.a, name: 'unten', step: 1 }, { ys: st.map(s => s.nTreq), color: COL.b, name: 'oben nötig', dash: 1, step: 1 }, { ys: st.map(s => s.nBreq), color: COL.a, name: 'unten nötig', dash: 1, step: 1 }], { y0: 0 }) +
        // Durchbiegung unter Last (Biegelinie 1 g × Lastfaktor), Grenze waagerecht
        chart('Durchbiegung unter Last', 'mm', ys, [
          { ys: R.defl.map((v, i) => R.j * (v * R.nP + R.qA * R.deflB[i])), color: COL.b, name: 'j·n = ' + f1(R.j * R.nP) },
          { ys: R.defl.map((v, i) => v * R.nP + R.qA * R.deflB[i]), color: COL.a, name: 'n = ' + f1(R.nP) },
          { ys: R.defl.map((v, i) => v + R.qA1 * R.deflB[i]), color: COL.c, name: '1 g langsam', dash: 1 },
          { ys: R.defl.map((v, i) => v + R.qNE * R.deflB[i]), color: COL.e, name: '1 g bei V_NE' },
          { ys: R.defl.map((v, i) => -R.nN * v + R.qNE * R.deflB[i]), color: COL.d, name: '−' + f1(R.nN) + ' bei V_NE', dash: 1 }]
          .concat(R.wMax > 0 ? [{ ys: ys.map(() => R.wMax), color: '#ff6b6b', name: 'Grenze', dash: 1 }] : [])) +
        chart('Bauhöhe am Holm', 'mm', ys, [{ ys: st.map(s => s.h), color: COL.e, name: 'Profildicke' }, { ys: st.map(s => s.hW), color: COL.a, name: 'Steghöhe' }, { ys: st.map(s => s.b), color: COL.b, name: 'Gurtbreite' }], { y0: 0 })) +
      sec('Grundriss mit Holm', T(R.isRov ? 'Gurtband maßstäblich, kräftiger = mehr Rovings (Obergurt); Striche = Rovingenden o = oben, u = unten' : 'Gurtband maßstäblich, kräftiger = mehr Lagen (Obergurt); Striche = Lagenenden o = oben, u = unten')) + planform(R) +
      capCut);

    // --- Holmstege ---
    const s0w = R.st[0];
    G.web = grpBox('web', 'Holmstege und Querkraft', s0.nW + ' × ' + f1(R.tc) + ' mm ' + esc(mn(R.core)) + ' · ' + esc(T('Abstufung')) + ': ' + esc(webSteps),
      cards(card('Stege an der Wurzel', s0.nW + ' × ' + f1(R.tc) + ' mm', esc(mn(R.core)) + (R.coat && R.nc ? ' + ' + R.nc + '× ' + esc(mn(R.coat)) : '') + '<br>' + esc(T('Abstufung')) + ': ' + esc(webSteps))) +
      charts(chart('Anzahl Stege', T('Stege'), ys, [{ ys: st.map(s => s.nW), color: COL.e, name: 'vorgesehen', step: 1 }, { ys: st.map(s => s.nWreq), color: COL.e, name: 'nötig', dash: 1, step: 1 }], { y0: 0 })) +
      sec('Holmstege', mn(R.core) + ' · ' + f1(R.tc) + ' mm' + (R.coat && R.nc ? ' · ' + T('beidseitig') + ' ' + R.nc + '× ' + mn(R.coat) + ' ±45°' : '') + ' · ' + T('Stegpaket') + ' ' + f1(R.webW) + ' mm') +
      '<div class="holm-note" style="margin-top:4px">' + esc(T('Innen {n} Stege nebeneinander ({w} mm unter {b} mm Gurtbreite).').replace('{n}', s0w.nW).replace('{w}', f1(s0w.nW * R.webW)).replace('{b}', f1(s0w.b)) + ' ' +
        T('Abstufung nach außen') + ': ' + webSteps + '. ' + T('Jeder Steg läuft um die Lagenzugabe über die Stelle hinaus, an der er rechnerisch entfällt; der mittlere Steg geht bis zur Spitze, die äußeren enden zuerst.')) + '</div>' +
      table([T('von') + ' [mm]', T('bis') + ' [mm]', T('Stege'), T('Steghöhe') + ' [mm]', T('max. Auslastung')], R.webSecs.map(w => [f0(w.from), f0(w.to), String(w.n), f1(w.hR) + ' → ' + f1(w.hT), uTxt(w.uMax)])) +
      table([T('Steg'), T('Länge ab Wurzel') + ' [mm]', T('Höhe innen') + ' [mm]', T('Höhe am Ende') + ' [mm]', T('Masse') + ' [g]'], R.cutW.map((c, k) => [T('Steg') + ' ' + (k + 1), f0(c.len), f1(c.hR), f1(c.hE), f1(c.g)])) +
      sec('Stegwerkstoffe im Vergleich (Wurzel)', T('Anzahl Stege je Werkstoff in seiner Standarddicke; rechte Spalte mit der eingestellten Beschichtung')) +
      table([T('Werkstoff'), T('Dicke') + ' [mm]', T('Stege ohne Beschichtung'), T('mit Beschichtung'), T('Masse je Steg') + ' [g/m]'], R.webCmp.map(c => [esc(mn(c.m)) + (c.m.id === (R.core && R.core.id) ? ' ◀' : ''), f1(c.m.t), c.nBare ? String(c.nBare) : '–', c.nCoat ? String(c.nCoat) : '–', f1(c.gpm)])));

    // --- Torsionsschale ---
    G.shell = grpBox('shell', 'Torsionsschale und Verdrehung', s0.nS + ' ' + esc(T('Lagen')) + ' ' + esc(mn(R.sm)) + ' ' + (R.ori45 ? '±45°' : '0/90°') + ' · ' + esc(T('Verdrehung Spitze bei V_NE')) + ' ' + f2(R.twTip) + '°',
      cards(card('Torsionsschale an der Wurzel', s0.nS + ' ' + esc(T('Lagen')), esc(mn(R.sm)) + ' ' + (R.ori45 ? '±45°' : '0/90°')) +
        card('Verdrehung Spitze bei V_NE', f2(R.twTip) + '°', T('+ = Nase hoch'))) +
      charts(chart('Verdrehung bei V_NE', '°', ys, [{ ys: R.twist.map(v => v / DEG), color: COL.d, name: '1 g' }])) +
      sec('Torsionsschale', mn(R.sm) + ' ' + (R.ori45 ? '±45°' : '0/90°') + ' · ' + (h.box === 'dbox' ? T('D-Box (Nase bis Holm)') : T('ganzes Profil (geschlossene Schale)')) + ' · ' + f2(R.tps) + ' mm/' + T('Gewebelage')) +
      table([T('Gewebelage'), T('Lagenlänge') + ' [mm]', T('Fläche') + ' [dm²]', T('Laminat') + ' [g]'], R.cutS.map((c, k) => [T('Schale') + ' ' + (k + 1), f0(c.len), f2(c.area / 1e4), f1(c.g)])));

    // --- Bruchgrenze ---
    {
      const mins = key => { let m = Infinity, y = 0; R.st.forEach(s => { if (s[key] < m) { m = s[key]; y = s.y; } }); return [m, y]; };
      const row = (nm, kp, kn) => { const p = mins(kp), q = mins(kn); return [esc(T(nm)), fn(p[0]), isFinite(p[0]) ? f0(p[1]) : '–', fn(q[0]), isFinite(q[0]) ? f0(q[1]) : '–']; };
      const b = R.brk, vb = b && b.vb;
      G.brk = grpBox('brk', 'Bruchgrenze', b ? 'n = ' + fn(b.pos.n) + ' / −' + fn(b.neg.n) + (vb && isFinite(vb.v) ? ' · V<sub>Bruch</sub> ' + f0(vb.v) + ' km/h' : '') : '',
        cards(brkCard(R) + vbCard(R)) +
        charts(brkChart(R) +
          (b && vb && isFinite(vb.v) ? (() => {
            const top = 3 * vb.v, lim = v => isFinite(v) ? Math.min(top, v) : NaN;
            return chart(T('Bruchgeschwindigkeit je Station') + ' (ca = ' + f2(vb.ca) + ')', 'km/h', ys, [
              { ys: st.map(s => lim(s.vbCap)), color: COL.b, name: 'Gurt' }, { ys: st.map(s => lim(s.vbWeb)), color: COL.e, name: 'Steg' },
              { ys: st.map(s => lim(s.vbSh)), color: COL.d, name: 'Schale' }].concat(+R.h.vne > 0 ? [{ ys: st.map(() => +R.h.vne), color: '#ff6b6b', name: 'V_NE', dash: 1 }] : []), { y0: 0 });
          })() : '')) +
        sec('Theoretische Bruchgrenze', T('Lastvielfaches, bei dem das Bauteil seine Festigkeit erreicht (Werkstoffwerte × Abminderung, ohne Sicherheitsfaktor j). Nicht erfasst: Beulen der Schale, Knittern/Ausknicken des Druckgurts, Steckung, Wurzelrippe und Klebungen — diese versagen in der Praxis oft früher.')) +
        table([T('Bauteil'), 'n<sub>Bruch</sub> +', 'y [mm]', 'n<sub>Bruch</sub> −', 'y [mm]'], [row('Holmgurte', 'nbCapP', 'nbCapN'), row('Holmstege', 'nbWeb', 'nbWeb'), row('Torsionsschale (bei V_NE)', 'nbShP', 'nbShN')]));
    }

    // --- 3D, Schnellflug, Abfangen ---
    G.v3 = grpBox('v3', '3D-Ansicht unter Last', esc(T('Flügel um die Biegelinie des gewählten Lastfalls verformt, eingefärbt nach der gewählten Größe — rot = am höchsten beansprucht')),
      v3Bar(h) + '<div class="holm-3d"><canvas id="holm3d"></canvas></div>');
    G.fast = grpBox('fast', 'Schnellflug (1 g, ohne Abfangen)', esc(T('Geradeausflug mit dem Gewicht als Auftrieb. Die Grundverteilung aus Schränkung und Profilwahl bleibt bei kleinem CL stehen — außen entsteht Abtrieb, die Spitzen biegen nach unten. c_m0 und der Auftrieb vor dem Holm verdrehen die Fläche, die Verdrehung ändert wiederum den Auftrieb (elastische Rückwirkung).')), fastSection(R));
    G.pull = grpBox('pull', 'Lastvielfaches beim Abfangen', esc(T('n im tiefsten Punkt des Abfangbogens = 1 + 2·V²/(g·D). Gestrichelt: mehr Auftrieb gibt ca_max bei diesem Gewicht nicht her (darüber reißt die Strömung ab, der Bogen wird weiter). Waagerecht: Bruchgrenze bei diesem Gewicht — der Holm trägt einen festen Auftrieb, ein schwereres Modell bricht also bei kleinerem n.')), pullSection(R));

    // --- Lagenplan und Masse ---
    G.plan = grpBox('plan', 'Lagenplan und Masse', esc(T('Strukturmasse je Hälfte')) + ' ' + f0(R.mass.total) + ' g',
      cards(card('Strukturmasse je Hälfte', f0(R.mass.total) + ' g', T('Gurte') + ' ' + f0(R.mass.capT + R.mass.capB) + ' · ' + T('Stege') + ' ' + f0(R.mass.web) + ' · ' + T('Schale') + ' ' + f0(R.mass.shell) + ' g · ' + T('gesamt') + ' ×' + R.halves + ' = ' + f0(R.mass.total * R.halves) + ' g')) +
      sec('Lagenplan', T('Länge jeder Lage ab Wurzel (inkl. Zugabe). Üblich: kürzeste Lage zuerst, längste zuletzt darüber — so decken die längeren Lagen die Lagenenden ab.')) + layerChart(R));

    // --- Stationstabelle ---
    const idx = []; for (let k = 0; k <= 10; k++) idx.push(Math.round(k * N_ST / 10));
    G.stat = grpBox('stat', 'Stationen (Auszug)', '',
      table(['y [mm]', T('Sehne') + ' [mm]', 'h [mm]', 'M<sub>d</sub> [N·m]', 'Q<sub>d</sub> [N]', 'T<sub>d</sub> [N·m]', T('Gurt o') + ' ' + T('nötig/da'), T('Gurt u') + ' ' + T('nötig/da'), T('Ausl. o/u'), T('Stege'), T('Schale') + ' ' + T('nötig/da'), 'q<sub>T</sub> [N/mm]'],
        idx.map(i => { const s = st[i]; return [f0(s.y), f0(s.c), f1(s.h), f2(s.Mp / 1000), f0(s.Qd), f2(s.Td / 1000), s.nTreq + ' / ' + s.nT, s.nBreq + ' / ' + s.nB, uTxt(s.uT) + ' / ' + uTxt(s.uB), String(s.nW), s.nSreq + ' / ' + s.nS, f2(s.qT)]; })));

    // Reihenfolge: 3D-Ansicht und Bruchgrenze immer ganz oben
    const order = ['v3', 'brk', 'load', 'cap', 'web', 'shell', 'fast', 'pull', 'plan', 'stat'];
    html += order.map(k => G[k]).join('');
    html += '<div class="holm-note">' + esc(T('Vorbemessung nach Balkentheorie (Gurte tragen die Biegung, Stege die Querkraft, Schale die Torsion nach Bredt). Nicht berücksichtigt: Pfeilung, Stabilität der Schale (Beulen), Krafteinleitung an Steckung/Wurzelrippe, Klebefugen und Ermüdung. Werkstoffwerte sind Anhaltswerte — eigene Laminatwerte im Werkstoff-Editor eintragen.')) + '</div>';
    el.innerHTML = html;
    try { init3d(R); } catch (e) { console.error(e); }
    // Gruppen auf/zu merken; 3D erst zeichnen, wenn sichtbar
    el.querySelectorAll('details.holm-grp').forEach(d => {
      d.addEventListener('toggle', () => { grpState()[d.dataset.grp] = d.open; grpSave(); if (d.open && d.dataset.grp === 'v3') draw3d(); });
    });
    el.querySelectorAll('[data-grpall]').forEach(bt => bt.onclick = () => {
      const o = bt.dataset.grpall === '1';
      el.querySelectorAll('details.holm-grp').forEach(d => { d.open = o; grpState()[d.dataset.grp] = o; });
      grpSave(); if (o) draw3d();
    });
    el.querySelectorAll('[data-pull]').forEach(inp => {
      inp.onchange = () => {
        const k = inp.dataset.pull, v = inp.type === 'text' && /^pull[DM]$/.test(k) ? inp.value : parseFloat(String(inp.value).replace(',', '.'));
        if (typeof v === 'number' && !isFinite(v)) return;
        R.h[k] = v; render();
      };
    });
  }

  // ---------- 3D-Ansicht unter Last (Canvas 2D, Flächen nach Tiefe sortiert) ------
  // Flügel als Gitter (Stationen × Profilpunkte), um die Biegelinie w(y) · Lastfaktor
  // (× Überhöhung) verformt, eingefärbt nach der gewählten Größe je Station.
  const V3_CASES = [['1g', '1 g langsam (ca_max)'], ['1gne', '1 g bei V_NE'], ['fast', 'Schnellflug (1 g, elastisch)'], ['n', 'n positiv'], ['nne', 'n positiv bei V_NE'], ['d', 'Bemessung j · n positiv'], ['b', 'Bruchgrenze positiv'],
    ['nn', 'n negativ (V_NE)'], ['dn', 'Bemessung j · n negativ'], ['bn', 'Bruchgrenze negativ']];
  const V3_MAPS = [['cap', 'Auslastung Holmgurt'], ['web', 'Auslastung Holmsteg'], ['shell', 'Auslastung Schale (Torsion)'], ['tw', 'Verdrehwinkel (Torsion in Grad)'], ['M', 'Biegemoment'], ['Q', 'Querkraft'], ['w', 'Streckenlast (Auftrieb)']];
  const v3 = { az: -1.95, el: 0.42, zoom: 1, px: 0, py: 0 };   // von hinten oben, rechte Hälfte rechts
  let v3R = null, v3drag = null, v3cube = false;
  const NX3 = 16;                                       // Profilpunkte je Seite
  const xs3 = (() => { const a = []; for (let k = 0; k <= NX3; k++) a.push((1 - Math.cos(Math.PI * k / NX3)) / 2); return a; })();
  const tbCache = new WeakMap();
  // Ober-/Unterseite eines Profils an den festen x-Stellen xs3 (normiert auf die Sehne)
  function profTB(P) {
    const e = normProf(P); if (!e) return null;
    let r = tbCache.get(P); if (r) return r;
    const pts = e.pts, n = pts.length, top = [], bot = [];
    xs3.forEach(X => {
      X = Math.min(0.9995, Math.max(0.0005, X));
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < n; i++) {
        const p = pts[i], q = pts[(i + 1) % n];
        if ((p.x - X) * (q.x - X) <= 0 && p.x !== q.x) { const y = p.y + (q.y - p.y) * (X - p.x) / (q.x - p.x); if (y < lo) lo = y; if (y > hi) hi = y; }
      }
      top.push(isFinite(hi) ? hi : 0); bot.push(isFinite(lo) ? lo : 0);
    });
    r = { top, bot }; tbCache.set(P, r); return r;
  }
  function v3Factor(R, cs) {
    const b = R.brk || { pos: { n: 1 }, neg: { n: 1 } }, fin = v => isFinite(v) ? v : 1;
    return { '1g': 1, '1gne': 1, n: R.nP, nne: R.nP, d: R.j * R.nP, b: fin(b.pos.n), nn: -R.nN, dn: -R.j * R.nN, bn: -fin(b.neg.n) }[cs] ?? 1;
  }
  // Staudruck (N/mm²) des Lastfalls — wie stark die Grundverteilung (Schränkung) mitwirkt
  function v3Q(R, cs) {
    const b = R.brk || { pos: { n: 1 } }, nb = isFinite(b.pos.n) ? b.pos.n : 1, qa = R.qA1 || 0, qn = R.qNE || 0;
    return { '1g': qa, '1gne': qn, n: R.nP * qa, nne: Math.max(qn, R.nP * qa), d: R.j * R.nP * qa, b: nb * qa, nn: qn, dn: R.j * qn, bn: 0 }[cs] ?? 0;
  }
  // Wert je Station für die Einfärbung; util = Auslastung (Skala 0…100 %)
  // ld = eigener Lastzustand {M, Q, T, l} je Station (Schnellflug), sonst aus f und q
  function v3Values(R, map, f, q, ld) {
    q = q || 0;
    const kq = R.qd > 0 ? q / R.qd : 0;
    // Torsionsmoment des Lastfalls je Station (vorzeichenrichtig, + = Nase hoch):
    // c_m0-Anteil (gilt bei V_NE → auf den Staudruck umgerechnet) + Zusatzverteilung · f + Grundverteilung · q
    const Tof = (s, i) => ld ? ld.T[i] : s.Tcm * kq + f * s.Tl + q * (s.Tb || 0);
    // Verdrehwinkel θ(y) = ∫ T/GJ von der Wurzel nach außen (im Schnellflug elastisch gelöst)
    let th = null;
    if (map === 'tw') {
      if (ld) th = ld.th.map(v => v / DEG);
      else {
        th = [0]; let a = 0;
        for (let i = 1; i < R.st.length; i++) {
          const s0 = R.st[i - 1], s1 = R.st[i];
          const k0 = s0.GJ > 0 ? Tof(s0, i - 1) / s0.GJ : 0, k1 = s1.GJ > 0 ? Tof(s1, i) / s1.GJ : 0;
          a += 0.5 * (k0 + k1) * (s1.y - s0.y); th.push(a / DEG);
        }
      }
    }
    const vals = R.st.map((s, i) => {
      const M = ld ? ld.M[i] : s.M1 * f + q * (s.Mb || 0), Q = ld ? ld.Q[i] : s.Q1 * f + q * (s.Qb || 0);
      switch (map) {
        case 'cap': {
          const At = s.tT * s.b, Ab = s.tB * s.b; if (!(s.hEff > 0)) return 0;
          const F = Math.abs(M) / s.hEff;                   // Gurtkraft
          const sigT = At > 0 ? F / At : Infinity, sigB = Ab > 0 ? F / Ab : Infinity;
          return M >= 0 ? Math.max(sigT / R.sC, sigB / R.sT) : Math.max(sigT / R.sT, sigB / R.sC);
        }
        case 'web': { const V = s.nW * s.hW * R.vPerMm; return V > 0 ? Math.abs(Q) / V : 0; }
        case 'shell': {
          // T = c_m0-Anteil (gilt bei V_NE → auf den Staudruck des Lastfalls umgerechnet)
          //   + Zusatzverteilung · f + Grundverteilung · q
          const t = s.nS * R.tps, T = Math.abs(Tof(s, i));
          return t > 0 && s.Am > 0 && R.tauS > 0 ? T / (2 * s.Am) / (t * R.tauS) : 0;
        }
        case 'tw': return Math.abs(th[i]);
        case 'M': return Math.abs(M) / 1000;
        case 'Q': return Math.abs(Q);
        default: return Math.abs(ld ? ld.l[i] : s.w1 * f + q * (s.wb || 0)) * 1000;   // N/m
      }
    });
    const util = map === 'cap' || map === 'web' || map === 'shell';
    const unit = util ? '%' : { M: 'N·m', Q: 'N', w: 'N/m', tw: '°' }[map];
    let vmax = 0; vals.forEach(v => { if (isFinite(v) && v > vmax) vmax = v; });
    // Verdrehwinkel: Richtung an der Spitze (+ = Nase hoch) für die Beschriftung
    return { vals, util, unit, vmax, sgnTip: th ? Math.sign(th[th.length - 1]) : 0 };
  }
  // Farbskala blau → türkis → grün → gelb → rot (t = 0…1)
  function heat(t) {
    t = Math.min(1, Math.max(0, t));
    const S = [[0, 40, 90, 200], [0.25, 0, 170, 210], [0.5, 60, 190, 80], [0.75, 245, 200, 40], [1, 230, 40, 40]];
    let i = 1; while (i < S.length - 1 && t > S[i][0]) i++;
    const a = S[i - 1], b = S[i], u = (t - a[0]) / (b[0] - a[0] || 1);
    return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
  }
  function cssVar(n, d) { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d; } catch (e) { return d; } }

  function draw3d() {
    const cv = document.getElementById('holm3d'), R = v3R;
    if (!cv || !R || !R.st) return;
    const h = R.h, dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, Hh = cv.clientHeight;
    if (!(W > 0 && Hh > 0)) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(Hh * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
    const txt = cssVar('--txt', '#ddd'), muted = cssVar('--muted', '#999');
    const f = v3Factor(R, h.v3Case || 'd'), q3 = v3Q(R, h.v3Case || 'd'), ex = Math.max(1, +h.v3Exag || 1), both = h.v3Both !== false;
    // Schnellflug: eigene Biegelinie und elastische Verdrehung (um die Holmachse)
    const FL = h.v3Case === 'fast' && R.fast ? (R.fast.E || R.fast.Rg) : null;
    const wAt = i => FL ? FL.w[i] : R.defl[i] * f + q3 * R.deflB[i];
    const V = v3Values(R, h.v3Map || 'cap', f, q3, FL);
    const relS = h.v3Scale !== 'abs';
    const scaleMax = V.util && !relS ? 1 : (V.vmax || 1);
    // Stationen (jede 4.) mit Profil, Biegelinie und Farbe
    const K = R.geo.knots, st = R.st, step = 4, S = [];
    for (let i = 0; i < st.length; i += step) S.push(i);
    if (S[S.length - 1] !== st.length - 1) S.push(st.length - 1);
    const rings = S.map(i => {
      const s = st[i];
      let a = 0; while (a < K.length - 2 && s.y > K[a + 1].y) a++;
      const ka = K[a], kb = K[a + 1], t = kb.y > ka.y ? Math.min(1, Math.max(0, (s.y - ka.y) / (kb.y - ka.y))) : 0;
      const pa = profTB(ka.prof), pb = profTB(kb.prof) || pa, P = pa || pb;
      const wz = wAt(i) * ex, pts = [];
      // Verdrehung (Nase hoch +) um den Holm, mit überhöht
      const th = FL ? Math.max(-0.7, Math.min(0.7, FL.th[i] * ex)) : 0, ct = Math.cos(th), sn = Math.sin(th);
      const xsH = s.le + s.xr * s.c, zsH = 0.5 * (s.top + s.bot) * s.c;
      const P3 = (x, z) => { const dx = x - xsH, dz = z - zsH; return [xsH + dx * ct + dz * sn, s.y, zsH - dx * sn + dz * ct + wz]; };
      if (P) {
        const tp = xs3.map((x, k) => pa && pb ? pa.top[k] + (pb.top[k] - pa.top[k]) * t : P.top[k]);
        const bt = xs3.map((x, k) => pa && pb ? pa.bot[k] + (pb.bot[k] - pa.bot[k]) * t : P.bot[k]);
        for (let k = NX3; k >= 0; k--) pts.push(P3(s.le + xs3[k] * s.c, tp[k] * s.c));   // Endleiste → Nase oben
        for (let k = 1; k < NX3; k++) pts.push(P3(s.le + xs3[k] * s.c, bt[k] * s.c));    // Nase → Endleiste unten
      }
      return { pts, v: V.vals[i], y: s.y, wz, s };
    }).filter(r => r.pts.length);
    if (rings.length < 2) return;
    // Kamera: Gieren um die Hochachse, Nicken um die Bildschirm-Querachse
    const ca = Math.cos(v3.az), sa = Math.sin(v3.az), ce = Math.cos(v3.el), se = Math.sin(v3.el);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    rings.forEach(r => r.pts.forEach(p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }));
    const cx = (x0 + x1) / 2, cy = both ? 0 : R.L / 2, cz = (z0 + z1) / 2;
    const ext = Math.max(both ? 2 * R.L : R.L, x1 - x0, z1 - z0) || 1;
    const sc = v3.zoom * Math.min(W, Hh) / ext * (both ? 1.45 : 1.1);
    const tr = (x, y, z) => {
      const X = x - cx, Y = y - cy, Z = z - cz;
      const xr = X * ca - Y * sa, yr = X * sa + Y * ca;
      // rechtshändig: xr nach rechts, yr vom Betrachter weg, Z nach oben; 3. Wert = Nähe zum Betrachter
      return [W / 2 + v3.px + xr * sc, Hh / 2 + v3.py - (Z * ce + yr * se) * sc, Z * se - yr * ce];
    };
    const L3 = [0.35, -0.45, 0.82];                       // Lichtrichtung (Welt)
    const quads = [];
    const sides = both ? [1, -1] : [1];
    sides.forEach(sg => {
      for (let r = 0; r < rings.length - 1; r++) {
        const A = rings[r], B = rings[r + 1], n = A.pts.length, col = (A.v + B.v) / 2;
        for (let k = 0; k < n; k++) {
          const k2 = (k + 1) % n;
          const p = [A.pts[k], A.pts[k2], B.pts[k2], B.pts[k]].map(q => [q[0], q[1] * sg, q[2]]);
          const u = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]], v = [p[3][0] - p[1][0], p[3][1] - p[1][1], p[3][2] - p[1][2]];
          let nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
          const nl = Math.hypot(nx, ny, nz) || 1;
          const lam = Math.abs((nx * L3[0] + ny * L3[1] + nz * L3[2]) / nl);
          const sp = p.map(q => tr(q[0], q[1], q[2]));
          quads.push({ sp, d: (sp[0][2] + sp[1][2] + sp[2][2] + sp[3][2]) / 4, c: heat(isFinite(col) ? col / scaleMax : 1), l: 0.55 + 0.45 * lam });
        }
      }
    });
    // Ruhelage (unverformt): Nasen- und Endleiste gestrichelt
    g.save(); g.setLineDash([4, 4]); g.strokeStyle = muted; g.lineWidth = 1;
    sides.forEach(sg => {
      ['le', 'te'].forEach(e => {
        g.beginPath();
        rings.forEach((r, i) => { const x = e === 'le' ? r.s.le : r.s.le + r.s.c, q = tr(x, r.y * sg, 0); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); });
        g.stroke();
      });
    });
    g.restore();
    quads.sort((a, b) => a.d - b.d);
    quads.forEach(q => {
      const c = q.c.map(v => Math.round(v * q.l));
      g.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
      g.strokeStyle = g.fillStyle;
      g.beginPath(); g.moveTo(q.sp[0][0], q.sp[0][1]); for (let k = 1; k < 4; k++) g.lineTo(q.sp[k][0], q.sp[k][1]); g.closePath(); g.fill(); g.lineWidth = 0.6; g.stroke();
    });
    // Höchstwert markieren
    let im = 0; V.vals.forEach((v, i) => { if (isFinite(v) && v > V.vals[im]) im = i; });
    const sm = st[im], qm = tr(sm.le + sm.xr * sm.c, sm.y, sm.top * sm.c + wAt(im) * ex);
    const fmtV = v => !isFinite(v) ? '∞' : V.util ? f0(v * 100) + ' %' : (v < 10 ? f2(v) : f0(v)) + ' ' + V.unit;
    g.fillStyle = txt; g.strokeStyle = txt; g.lineWidth = 1.5;
    g.beginPath(); g.arc(qm[0], qm[1], 5, 0, 2 * Math.PI); g.stroke();
    g.font = '12px system-ui,sans-serif'; g.textAlign = 'left';
    g.fillText('max ' + fmtV(V.vals[im]) + (V.sgnTip ? ' (' + T(V.sgnTip < 0 ? 'Nase runter' : 'Nase hoch') + ')' : '') + ' ' + T('bei') + ' y = ' + f0(sm.y) + ' mm', qm[0] + 9, qm[1] - 8);
    // Kopfzeile: Lastfall, Durchbiegung, Biegewinkel
    const nL = R.defl.length - 1, wTip = wAt(nL), aTip = Math.atan(FL ? FL.sl[nL] : R.slope[nL] * f + q3 * R.slopeB[nL]) / DEG;
    g.fillStyle = txt; g.font = '600 12px system-ui,sans-serif';
    g.fillText((FL ? 'V ' + f0(R.fast.V) + ' km/h · CL ' + f2(R.fast.CL) + ' · ' + T('Verdrehung Spitze') + ' ' + f2(FL.th[nL] / DEG) + '°' : T('Lastfaktor') + ' ' + f1(f)) + ' · ' + T('Durchbiegung Spitze') + ' ' + (Math.abs(wTip) < 10 ? f1(wTip) : f0(wTip)) + ' mm · ' + T('Biegewinkel Spitze') + ' ' + f1(aTip) + '°' + (ex > 1 ? ' · ' + T('Überhöhung') + ' ×' + f0(ex) : ''), 10, 18);
    g.font = '11px system-ui,sans-serif'; g.fillStyle = muted;
    g.fillText(T('Ziehen = drehen · rechte Taste = verschieben · Mausrad = Zoom · Doppelklick = Ansicht zurück · gestrichelt = Ruhelage'), 10, Hh - 8);
    // Farblegende rechts
    const lx = W - 34, ly = 34, lh = Math.min(220, Hh - 80);
    for (let k = 0; k < lh; k++) { const c = heat(1 - k / lh); g.fillStyle = 'rgb(' + c.map(Math.round).join(',') + ')'; g.fillRect(lx, ly + k, 14, 1.2); }
    g.strokeStyle = muted; g.lineWidth = 1; g.strokeRect(lx, ly, 14, lh);
    g.fillStyle = txt; g.textAlign = 'right'; g.font = '11px system-ui,sans-serif';
    [0, 0.25, 0.5, 0.75, 1].forEach(t => g.fillText(V.util ? (scaleMax < 0.1 ? f1(t * scaleMax * 100) : f0(t * scaleMax * 100)) + ' %' : fmtV(t * scaleMax), lx - 4, ly + (1 - t) * lh + 4));
    g.textAlign = 'center'; g.fillText(V.unit, lx + 7, ly - 8);
    if (V.util && V.vmax > 1 && !relS) { g.fillStyle = '#ff6b6b'; g.textAlign = 'right'; g.fillText(T('über 100 % = rot'), lx + 14, ly + lh + 16); }
    g.textAlign = 'left';
  }
  function v3Bar(h) {
    const opt = (list, cur) => list.map(([v, l]) => '<option value="' + v + '"' + (String(cur) === v ? ' selected' : '') + '>' + esc(T(l)) + '</option>').join('');
    return '<div class="holm-3dbar">' +
      '<label>' + esc(T('Lastfall')) + ' <select data-v3="v3Case">' + opt(V3_CASES, h.v3Case || 'd') + '</select></label>' +
      '<label>' + esc(T('Einfärbung')) + ' <select data-v3="v3Map">' + opt(V3_MAPS, h.v3Map || 'cap') + '</select></label>' +
      '<label>' + esc(T('Überhöhung')) + ' <select data-v3="v3Exag">' + opt([['1', '×1 (maßstäblich)'], ['2', '×2'], ['5', '×5'], ['10', '×10']], String(h.v3Exag || 1)) + '</select></label>' +
      '<label>' + esc(T('Farbskala')) + ' <select data-v3="v3Scale">' + opt([['rel', 'Höchstwert = rot'], ['abs', '0–100 % Auslastung']], h.v3Scale === 'abs' ? 'abs' : 'rel') + '</select></label>' +
      '<label><input type="checkbox" data-v3="v3Both"' + (h.v3Both !== false ? ' checked' : '') + '> ' + esc(T('beide Hälften')) + '</label></div>';
  }
  function init3d(R) {
    v3R = R;
    const cv = document.getElementById('holm3d'); if (!cv) return;
    document.querySelectorAll('#holmRes [data-v3]').forEach(el => {
      el.onchange = () => {
        const k = el.dataset.v3;
        R.h[k] = el.type === 'checkbox' ? el.checked : (k === 'v3Exag' ? +el.value : el.value);
        draw3d();
      };
    });
    cv.onmousedown = e => { v3drag = { x: e.clientX, y: e.clientY, az: v3.az, el: v3.el, px: v3.px, py: v3.py, pan: e.button === 2 }; e.preventDefault(); };
    cv.oncontextmenu = e => e.preventDefault();
    cv.ondblclick = () => { v3reset(); draw3d(); };
    cv.addEventListener('wheel', e => { e.preventDefault(); v3.zoom = Math.max(0.2, Math.min(12, v3.zoom * (e.deltaY < 0 ? 1.15 : 0.87))); draw3d(); }, { passive: false });
    if (!v3cube) {
      v3cube = true;
      window.addEventListener('mousemove', e => {
        if (!v3drag) return;
        if (v3drag.pan) { v3.px = v3drag.px + e.clientX - v3drag.x; v3.py = v3drag.py + e.clientY - v3drag.y; }
        else { v3.az = v3drag.az - (e.clientX - v3drag.x) * 0.01; v3.el = Math.max(-1.5, Math.min(1.5, v3drag.el + (e.clientY - v3drag.y) * 0.01)); }
        draw3d();
      });
      window.addEventListener('mouseup', () => { v3drag = null; });
      window.addEventListener('resize', () => { if (state.activeTab === 'holm') draw3d(); });
      if (window.ViewCube && ViewCube.home) ViewCube.home({ canvas: () => document.getElementById('holm3d'), active: () => state.activeTab === 'holm', reset: v3reset, redraw: draw3d });
    }
    draw3d();
  }
  function v3reset() { v3.az = -1.95; v3.el = 0.42; v3.zoom = 1; v3.px = v3.py = 0; }

  // ---------- Werkstoff-Editor --------------------------------------------------
  let dlg = null;
  const MAT_COLS = {
    ud: [['name', 'Name', 'text'], ['gsm', 'g/m²'], ['rhoF', 'ρ Faser g/cm³'], ['vf', 'φ Faser'], ['E', 'E GPa'], ['st', 'σ Zug MPa'], ['sc', 'σ Druck MPa']],
    fab: [['name', 'Name', 'text'], ['gsm', 'g/m²'], ['rhoF', 'ρ Faser g/cm³'], ['vf', 'φ Faser'], ['E', 'E GPa'], ['st', 'σ Zug MPa'], ['sc', 'σ Druck MPa'], ['G45', 'G ±45° GPa'], ['tau45', 'τ ±45° MPa'], ['G090', 'G 0/90° GPa'], ['tau090', 'τ 0/90° MPa']],
    rov: [['name', 'Name', 'text'], ['tex', 'tex (g/km)'], ['rhoF', 'ρ Faser g/cm³'], ['vf', 'φ Faser'], ['E', 'E GPa'], ['st', 'σ Zug MPa'], ['sc', 'σ Druck MPa']],
    core: [['name', 'Name', 'text'], ['rho', 'ρ kg/m³'], ['G', 'G MPa'], ['tau', 'τ MPa'], ['t', 'Dicke mm']]
  };
  const KIND_TTL = { ud: 'UD-Gelege (Holmgurte)', rov: 'Rovings (Holmgurte)', fab: 'Gewebe (Schale, Stegbeschichtung)', core: 'Stegwerkstoffe' };
  function newMat(kind) {
    const base = { ud: udCF(125), rov: rovCF(800), fab: fabCF(93), core: { kind: 'core', rho: 100, G: 100, tau: 1.5, t: 2 } }[kind];
    return Object.assign(clone(base), { id: 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), name: T('Eigener Werkstoff') });
  }
  function fillDlg() {
    const body = dlg.querySelector('#holmMatBody');
    let html = '<div class="hint">' + esc(T('Laminatwerte gelten beim angegebenen Faservolumenanteil φ (z. B. 0,5 Vakuum, 0,4 Handlaminat). Lagendicke = g/m² ÷ (ρ Faser · φ), Querschnitt je Roving = tex ÷ (1000 · ρ Faser · φ). Die Liste gehört zum Projekt.')) + '</div>';
    ['ud', 'rov', 'fab', 'core'].forEach(kind => {
      const cols = MAT_COLS[kind];
      html += '<h3 class="holm-mh">' + esc(T(KIND_TTL[kind])) + '</h3><div class="holm-mtw"><table class="holm-tab holm-mt"><thead><tr>' + cols.map(c => '<th>' + esc(T(c[1])) + '</th>').join('') + (kind === 'rov' ? '<th>' + esc(T('mm²/Roving')) + '</th>' : kind !== 'core' ? '<th>' + esc(T('Lage mm')) + '</th>' : '') + '<th></th></tr></thead><tbody>';
      mats().forEach((m, i) => {
        if (m.kind !== kind) return;
        html += '<tr>' + cols.map(c => '<td><input data-i="' + i + '" data-k="' + c[0] + '"' + (c[2] === 'text' ? ' type="text" class="nm"' : ' type="text" inputmode="decimal" class="nu"') + ' value="' + esc(m[c[0]] != null ? m[c[0]] : '') + '"></td>').join('') +
          (kind === 'rov' ? '<td class="ro">' + f2(rovA(m)) + '</td>' : kind !== 'core' ? '<td class="ro">' + f2(ply(m)) + '</td>' : '') + '<td><button data-del="' + i + '" title="' + esc(T('Werkstoff löschen')) + '">✕</button></td></tr>';
      });
      html += '</tbody></table></div><button class="holm-add" data-add="' + kind + '">+ ' + esc(T(KIND_TTL[kind])) + '</button>';
    });
    body.innerHTML = html;
    body.querySelectorAll('input[data-i]').forEach(inp => {
      inp.onchange = () => {
        const m = mats()[+inp.dataset.i], k = inp.dataset.k; if (!m) return;
        if (k === 'name') m.name = inp.value;
        else { const v = parseFloat(String(inp.value).replace(',', '.')); if (isFinite(v)) m[k] = v; }
        fillDlg(); render();
      };
    });
    body.querySelectorAll('button[data-del]').forEach(b => b.onclick = () => {
      const L = mats(), i = +b.dataset.del, m = L[i];
      if (L.filter(x => x.kind === m.kind).length <= 1) { if (App.toast) App.toast(T('Der letzte Werkstoff einer Art bleibt stehen.')); return; }
      L.splice(i, 1); fillDlg(); render();
    });
    body.querySelectorAll('button[data-add]').forEach(b => b.onclick = () => { mats().push(newMat(b.dataset.add)); fillDlg(); });
  }
  function openMatEditor() {
    if (!dlg) {
      dlg = document.createElement('div');
      dlg.className = 'modal-backdrop'; dlg.id = 'holmMatDlg';
      dlg.innerHTML = '<div class="modal" style="width:min(1100px,96vw)">' +
        '<div class="head"><h2>' + esc(T('Werkstoffe Holmauslegung')) + '</h2><div style="flex:1"></div><button id="holmMatX">✕</button></div>' +
        '<div class="body" id="holmMatBody" style="max-height:72vh;overflow:auto"></div>' +
        '<div class="foot" style="display:flex;gap:8px;justify-content:flex-end">' +
        '<button id="holmMatReset">' + esc(T('Standardwerkstoffe wiederherstellen')) + '</button>' +
        '<button id="holmMatOk" class="primary">' + esc(T('Fertig')) + '</button></div></div>';
      document.body.appendChild(dlg);
      const close = () => { dlg.classList.remove('open'); if (App.buildSidebar) App.buildSidebar(); render(); };
      dlg.querySelector('#holmMatX').onclick = close;
      dlg.querySelector('#holmMatOk').onclick = close;
      dlg.addEventListener('mousedown', e => { if (e.target === dlg) close(); });
      dlg.querySelector('#holmMatReset').onclick = () => {
        if (!confirm(T('Standardwerkstoffe auf die Vorgabewerte zurücksetzen? Eigene Werkstoffe bleiben erhalten.'))) return;
        const L = mats();
        MAT_PRESETS.forEach(p => { const i = L.findIndex(m => m.id === p.id); if (i >= 0) L[i] = clone(p); else L.push(clone(p)); });
        fillDlg(); render();
      };
    }
    fillDlg();
    dlg.classList.add('open');
  }

  // ---------- Seitenleiste ------------------------------------------------------
  function holmSidebar(side) {
    const { grp, hint, numRow, boolRow, selectRow, mkMini } = App;
    const TAB = 'holm', h = H();
    const RD = () => { if (state.activeTab === TAB) render(); };
    const RB = () => { if (App.buildSidebar) App.buildSidebar(); RD(); };
    const num = (body, label, key, step, hnt, o) => numRow(body, label, () => h[key], v => { h[key] = v; RD(); }, Object.assign({ step: step || 1, norender: true, hint: hnt }, o || {}));
    const sel = (body, label, opts, key, hnt, rebuild) => {
      const s = selectRow(body, label, opts, () => String(h[key]), v => { h[key] = v; rebuild ? RB() : RD(); }, hnt);
      return s;
    };
    const matOpts = (...kinds) => matsOf(...kinds).map(m => [m.id, m.name]);   // selectRow übersetzt selbst
    // Textfeld für eigene Längenlisten
    const txtRow = (body, label, key, ph) => {
      const row = document.createElement('div'); row.className = 'row';
      const l = document.createElement('label'); l.textContent = T(label);
      const inp = document.createElement('input'); inp.type = 'text'; inp.value = h[key] || ''; inp.placeholder = ph || '';
      inp.style.cssText = 'flex:1;min-width:0';
      inp.onchange = () => { h[key] = inp.value; RD(); };
      row.appendChild(l); row.appendChild(inp); body.appendChild(row);
      return inp;
    };
    const L0 = (() => { const g = wingGeom(); return g ? Math.round(g.L) : 0; })();

    const md = modes(h), check = h.calcMode === 'check', mixed = h.calcMode === 'mixed';
    const fmtPlan = pl => groups(pl).map(g => (g.to > g.from ? (g.to - g.from + 1) + '×' : '') + Math.round(g.len)).join(', ');
    // Ausgelegte Werte als eigene Angaben übernehmen (nur die Bauteile in `parts`)
    const takeOver = parts => {
      const keep = h.calcMode; h.calcMode = 'design';
      try {
        const R = compute();
        if (!R.err) {
          if (parts.cap) { h.capLenT = fmtPlan(R.planT); h.capLenB = fmtPlan(R.planB); }
          if (parts.web) h.webLen = fmtPlan(R.planW);
          if (parts.shell) h.shellLen = fmtPlan(R.planS);
        }
      } finally { h.calcMode = keep; }
      RB();
    };
    const takeBtn = (body, parts, label) => {
      const bb = document.createElement('div'); bb.style.cssText = 'display:flex;gap:4px;margin:2px 0 6px';
      bb.appendChild(mkMini(T(label || 'Aus der Berechnung übernehmen'), () => takeOver(parts)));
      body.appendChild(bb);
    };

    const g0 = grp('Holmauslegung', true, TAB, { key: 'holmMain' });
    hint(g0.body, 'Bemisst bzw. prüft Holmgurte, Holmstege und die Torsionsschale der aktiven Tragfläche (Halbspannweite, an der Wurzel eingespannt). Was gerechnet wird, legt die Berechnungsvorgabe fest; sie gilt für alle Bauteile.');
    if (App.wingSelectEl) {
      const row = document.createElement('div'); row.className = 'row';
      const l = document.createElement('label'); l.textContent = T('Tragfläche');
      const s = App.wingSelectEl(); s.style.cssText = '';
      row.appendChild(l); row.appendChild(s); g0.body.appendChild(row);
    }
    side.appendChild(g0.g);

    // --- Berechnungsvorgabe: Rechenart + Lastfall, gilt für Gurt, Steg und Schale ---
    const gV = grp('Berechnungsvorgabe', true, TAB, { key: 'holmCalc' });
    sel(gV.body, 'Rechenart', [['design', 'Auslegen: Lagen und Stege für den Lastfall'], ['check', 'Nachrechnen: Bruchlast für eigene Lagen und Stege'], ['mixed', 'gemischt (je Bauteil wählen)']], 'calcMode',
      'Auslegen: Anzahl und Länge der Gurtlagen, Anzahl und Verteilung der Stege und die Schalenlagen werden aus dem Lastfall berechnet. Nachrechnen: Gurtlagen, Stege und Schalenlagen selbst angeben — gerechnet werden Bruchlast, Bruchgeschwindigkeit, Auslastung und Durchbiegung. Gemischt: in jeder Bauteilgruppe einzeln wählen.', true);
    if (check) {
      hint(gV.body, 'Die eigenen Angaben stehen in den Gruppen Holmgurt, Holmsteg und Schale. Ergebnis oben rechts: theoretische Bruchgrenze und Bruchgeschwindigkeit.');
      takeBtn(gV.body, { cap: true, web: true, shell: true }, 'Ausgelegte Werte als Startwerte übernehmen');
    }
    const hasVlm = !!vlmLoad();
    sel(gV.body, 'Lastverteilung', [['auto', 'automatisch (VLM, sonst Schrenk)'], ['vlm', 'VLM aus „Aerodynamik"'], ['schrenk', 'Schrenk-Näherung'], ['ellipse', 'elliptisch']], 'loadSrc',
      'VLM = Auftriebsverteilung aus dem Reiter „Aerodynamik" (dort zuerst analysieren; die Tragfläche muss Bauteil des Flugzeugs sein). Schrenk = Mittel aus elliptischer und sehnenproportionaler Verteilung — gute Näherung für gerade Trapezflügel.');
    hint(gV.body, hasVlm ? 'VLM-Ergebnis für diese Tragfläche vorhanden.' : 'Kein VLM-Ergebnis für diese Tragfläche — gerechnet wird nach Schrenk.');
    sel(gV.body, 'Lastfall', [['n', 'Lastvielfaches n vorgeben'], ['aero', 'aus ca_max und Geschwindigkeit']], 'loadCase',
      'Lastvielfaches: Bemessung = j · n · Gewicht. ca_max · V: größter Auftrieb A = ρ/2 · V² · S · ca_max, den die Tragfläche bei dieser Geschwindigkeit überhaupt erzeugen kann (scharfes Abfangen); das Lastvielfache ergibt sich daraus (Rechenweg wie Holmberechnung Baron 2013).', true);
    const aeroCase = h.loadCase === 'aero';
    num(gV.body, 'Fluggewicht (g)', 'mass', 50, aeroCase ? 'Abflugmasse des ganzen Modells — hier nur für das Lastvielfache, die Durchbiegung bei 1 g und den Abfangradius.' : 'Abflugmasse des ganzen Modells.');
    num(gV.body, 'Auftriebsanteil dieser Tragfläche (%)', 'share', 1, 'Welcher Teil des Gewichts von dieser Tragfläche getragen wird (Flügel ≈ 100 %, Höhenleitwerk: eigener Lastfall, z. B. 15–25 %).');
    sel(gV.body, 'ca_max der Tragfläche', [['aero', 'aus der Aerodynamik (automatisch)'], ['manual', 'selbst angeben']], 'caSrc',
      'Automatisch: VLM der Tragfläche mit den Profilpolaren (NeuralFoil/XFOIL) aus dem Reiter „Aerodynamik“ — ca_max ist das Flügel-CL, bei dem der erste Streifen sein cl_max erreicht (Re bei V_max bzw. V_NE). Läuft im Hintergrund und gilt für den Lastfall ca_max · V, die Bruchgeschwindigkeit und das Abfangen.', true);
    if (h.caSrc === 'manual') {
      num(gV.body, 'ca_max', 'caMax', 0.05, 'Größter Auftriebsbeiwert der Tragfläche (ohne Klappen etwa 1,0–1,2, mit Wölbklappen bis 1,4). Baron empfiehlt 1,0.');
      num(gV.body, 'ca für Bruchgeschwindigkeit', 'caBreak', 0.05, 'Auftriebsbeiwert für die Kennzahl „Bruchgeschwindigkeit“: bei welcher Geschwindigkeit bricht der Flügel mit den eingestellten Gurten, Stegen und der Schale, wenn mit diesem ca voll gezogen wird (ohne Sicherheitsfaktor). Standard 1,0.', { min: 0 });
    }
    if (aeroCase) {
      num(gV.body, 'Höchstgeschwindigkeit beim Abfangen (km/h)', 'vMax', 5, 'Größte Geschwindigkeit, bei der noch voll gezogen wird (40 m/s = 144 km/h).');
    } else
      num(gV.body, 'Lastvielfaches n positiv', 'nPos', 0.5, 'Größte Abfanglast. Anhalt: Thermiksegler 5–6, Scale-Segler 6–8, Kunstflug/Hotliner 10–12, F3B/F3F 15–20 und mehr.');
    num(gV.body, 'Lastvielfaches n negativ', 'nNeg', 0.5, 'Größte negative Last (Rückenflug, Drücken), meist die Hälfte des positiven Werts.');
    num(gV.body, 'Sicherheitsfaktor j', 'j', 0.1, check ? 'Nachweis gegen j · n: die Auslastung der eigenen Lagen bezieht sich auf diese Last. Die Bruchgrenze selbst ist ohne j gerechnet.' : 'Bemessungslast = j · n · Last bei 1 g. Üblich 1,5.');
    num(gV.body, 'Abminderung Werkstoff', 'kRed', 0.05, 'Faktor auf alle Festigkeiten für Fertigungsstreuung (1 = Laborwert, 0,8 = sauberes Vakuumlaminat, 0,6–0,7 = Handlaminat).');
    num(gV.body, 'V_NE (km/h)', 'vne', 5, 'Höchstgeschwindigkeit — bestimmt das Torsionsmoment aus c_m0 (Sturzflug).');
    sel(gV.body, 'c_m0 für die Torsion', [['aero', 'Verteilung aus den Profilpolaren'], ['manual', 'ein Wert selbst angeben']], 'cmSrc',
      'Verteilung: c_m0 (um c/4, bei cl = 0) jedes Profilschnitts aus den Profilpolaren (NeuralFoil/XFOIL, Re bei V_NE), zwischen den Rippen linear — so zählen stärker gewölbte Wurzel- und flachere Außenprofile richtig ins Torsionsmoment. Läuft im Hintergrund.', true);
    if (h.cmSrc === 'manual')
      num(gV.body, 'c_m0 des Profils', 'cm0', 0.005, 'Nullmomentenbeiwert um den Viertelpunkt (gewölbte Profile negativ, etwa −0,03 bis −0,10; mit Klappenausschlag deutlich negativer).');
    if ((h.caSrc !== 'manual' || h.cmSrc !== 'manual') && aeroOk())
      sel(gV.body, 'Polaren-Rechner (ca_max, c_m0)', [['aero', 'wie im Reiter „Aerodynamik"'], ['nf', 'NeuralFoil'], ['xfoil', App.aeroXfoil && App.aeroXfoil.ready() ? 'XFOIL' : 'XFOIL (nicht verfügbar)']], 'polCalc',
        'Womit die Profilpolaren für ca_max und die c_m0-Verteilung gerechnet werden. NeuralFoil: sofort. XFOIL: das Original, einige Sekunden. Fehlt XFOIL, rechnet NeuralFoil.');
    num(gV.body, 'Luftdichte (kg/m³)', 'rho', 0.005);
    // Steifigkeit: beim Auslegen Ziel, beim Nachrechnen nur Prüfung
    num(gV.body, 'Durchbiegung Flächenspitze max. (mm)', 'wMax', 5, md.cap === 'auto'
      ? 'Grenze für die Durchbiegung der Flächenspitze; reicht die Festigkeitsbemessung nicht, werden alle Gurtlagen gemeinsam verstärkt, bis die Grenze eingehalten ist. 0 = keine Grenze.'
      : 'Grenze für die Durchbiegung der Flächenspitze — bei eigenen Gurtlagen wird sie nur geprüft. 0 = keine Grenze.', { min: 0 });
    sel(gV.body, 'Grenze gilt bei', [['1g', '1 g'], ['n', 'n positiv'], ['d', 'Bemessung j · n positiv']], 'wRef');
    // Abstufungsregeln gelten nur, wo ausgelegt wird
    if (md.cap === 'auto' || md.web === 'auto' || md.shell === 'auto') {
      num(gV.body, 'Lagenzugabe (mm)', 'overlap', 5, 'Jede Lage, jedes Rovingbündel und jeder Steg läuft um diesen Wert über die Stelle hinaus, an der er rechnerisch endet (weicher Steifigkeitsübergang).');
      if (md.cap === 'auto') boolRow(gV.body, 'Gurte bis zur Spitze (mind. 1 Lage)', () => !!h.capToTip, v => { h.capToTip = v; RD(); });
    }
    side.appendChild(gV.g);

    const gF = grp('Schnellflug', false, TAB, { key: 'holmFast' });
    hint(gF.body, 'Geradeausflug (1 g) ohne Abfangen: Biegung und Verdrehung der Fläche mit Grundverteilung (Schränkung → Abtrieb außen), c_m0, Eigengewicht und elastischer Rückwirkung der Verdrehung auf den Auftrieb; bei Pfeilung auch die Biege-Torsions-Kopplung. Ergebnis im Abschnitt „Schnellflug“ und als Lastfall in der 3D-Ansicht.');
    sel(gF.body, 'Vorgabe', [['v', 'Geschwindigkeit'], ['cl', 'Auftriebsbeiwert CL']], 'fastMode', null, true);
    if (h.fastMode === 'cl') num(gF.body, 'CL der Tragfläche', 'fastCl', 0.01, 'Flügel-Auftriebsbeiwert im Geradeausflug; die Geschwindigkeit folgt aus Gewicht und Fläche.', { min: 0.01 });
    else num(gF.body, 'Geschwindigkeit (km/h)', 'fastV', 5, 'Fluggeschwindigkeit im Geradeausflug; CL folgt aus Gewicht und Fläche.', { min: 1 });
    sel(gF.body, 'Flügelmasse (Entlastung)', [['auto', 'aus Gewichtsschätzung + Holm'], ['manual', 'selbst angeben']], 'fastWmSrc',
      'Das Eigengewicht der Fläche wirkt dem Auftrieb entgegen und verringert die Biegung (sehnenproportional verteilt). Automatisch: Gewichtsschätzung der Projektübersicht plus Holmstruktur.', true);
    if (h.fastWmSrc === 'manual') num(gF.body, 'Masse einer Flächenhälfte (g)', 'fastWm', 10, null, { min: 0 });
    boolRow(gF.body, 'Elastische Rückwirkung (Aeroelastik)', () => h.fastElastic !== false, v => { h.fastElastic = v; RD(); });
    side.appendChild(gF.g);

    const modeHint = (body, auto, autoTxt, manTxt) => hint(body, auto ? autoTxt : manTxt);
    const modeSel = (body, key) => { if (mixed) sel(body, 'Rechenart', [['auto', 'automatisch berechnen'], ['manual', 'selbst angeben']], key, null, true); };

    const g2 = grp('Holmgurt', true, TAB, { key: 'holmCap' });
    modeHint(g2.body, md.cap === 'auto',
      'Ober- und Untergurt werden getrennt bemessen (Obergurt auf Druck bei positiver Last, Untergurt auf Zug — bei negativer Last umgekehrt). Lagenzahl je Station = nötige Fläche ÷ (Breite · Lagendicke), daraus die Abstufung nach außen.',
      'Eigene Gurtlagen: die Rechnung prüft Auslastung, Durchbiegung und Bruchgrenze.');
    modeSel(g2.body, 'capMode');
    sel(g2.body, 'Gurtmaterial', matOpts('ud', 'rov', 'fab'), 'capMat', 'UD-Gelege, Rovings (verschiedene tex) oder Gewebe. Bei Rovings zählt die Rechnung Rovings statt Lagen; Querschnitt je Roving = tex ÷ (1000 · ρ Faser · φ).', true);
    const capSel = matById(h.capMat);
    if (capSel && capSel.kind === 'rov') {
      num(g2.body, 'Rovings je Abstufung', 'rovStep', 1, T('Rovings werden in Bündeln dieser Größe abgestuft (gleiche Länge je Bündel).') + ' ' + T('Querschnitt je Roving:') + ' ' + f2(rovA(capSel)) + ' mm²', { int: true, min: 1 });
    }
    num(g2.body, 'Gurtbreite innen (mm)', 'bRoot', 0.5);
    num(g2.body, 'Gurtbreite außen (mm)', 'bTip', 0.5, 'Breite an der Spitze — dazwischen linear.');
    num(g2.body, 'Holmlage Wurzel (% Sehne)', 'xSp', 1, 'Lage der Holmmitte ab Nasenleiste — günstig an der dicksten Profilstelle (meist 25–35 %).');
    num(g2.body, 'Holmlage außen (% Sehne)', 'xSpTip', 1);
    num(g2.body, 'Deckschicht über dem Gurt (mm)', 'skinT', 0.05, 'Alles, was zwischen Profiloberfläche und Gurt liegt (Beplankung, Schalengewebe) — verringert die Bauhöhe.');
    if (md.cap === 'manual') {
      hint(g2.body, T('Längen ab Wurzel in mm, durch Komma getrennt; Anzahl × Länge erlaubt, z. B.') + ' „2×' + L0 + ', 900, 500“. ' + T('Halbspannweite') + ' ' + L0 + ' mm. ' + T('Bei Rovings zählt jeder Eintrag als ein Roving.'));
      txtRow(g2.body, 'Holmgurt oben: Längen (mm)', 'capLenT', '2×' + L0 + ', 900, 500');
      txtRow(g2.body, 'Holmgurt unten: Längen (mm)', 'capLenB', '2×' + L0 + ', 700');
      takeBtn(g2.body, { cap: true });
    }
    side.appendChild(g2.g);

    const g3 = grp('Holmsteg', true, TAB, { key: 'holmWeb' });
    modeHint(g3.body, md.web === 'auto',
      'Die Stege nehmen die Querkraft auf. Nötige Anzahl je Station = Querkraft ÷ Tragfähigkeit eines Stegs (Kern + Beschichtung, Schubgleitung dehnungsverträglich). Daraus die Abstufung: wie viele Stege innen nebeneinander stehen und wo nach außen jeweils einer entfällt (plus Lagenzugabe). Rechts der Vergleich aller Stegwerkstoffe.',
      'Eigene Stege: ein Eintrag je Steg mit seiner Länge ab Wurzel — die Rechnung prüft Auslastung und Bruchgrenze.');
    modeSel(g3.body, 'webMode');
    sel(g3.body, 'Stegwerkstoff', matOpts('core'), 'webMat', null, true);
    const cm = matById(h.webMat);
    num(g3.body, 'Dicke des Stegs (mm)', 'webT', 0.5, cm ? T('Standarddicke dieses Werkstoffs:') + ' ' + cm.t + ' mm' : null);
    sel(g3.body, 'Beschichtung (beidseitig)', [['', 'keine']].concat(matOpts('fab')), 'webCoat', 'Gewebe unter ±45° beidseitig auf den Steg laminiert („beschichtetes Herex/Balsa") — trägt den Großteil der Querkraft.', true);
    if (h.webCoat) num(g3.body, 'Lagen je Seite', 'webCoatN', 1, null, { int: true, min: 0 });
    if (md.web === 'manual') {
      txtRow(g3.body, 'Stege: Längen (mm)', 'webLen', L0 + ', 800, 400');
      hint(g3.body, T('Ein Eintrag je Steg (Länge ab Wurzel), Anzahl × Länge erlaubt, z. B.') + ' „' + L0 + ', 2×600“.');
      takeBtn(g3.body, { web: true });
    }
    side.appendChild(g3.g);

    const g4 = grp('Schale (Torsion)', true, TAB, { key: 'holmShell' });
    modeHint(g4.body, md.shell === 'auto',
      'Torsionsmoment aus c_m0 bei V_NE und dem Auftrieb am Viertelpunkt mit Hebel zum Holm (Lastfälle n negativ, 1, n positiv). Schubfluss nach Bredt q = T / (2·A), daraus die Lagenzahl des Schalengewebes.',
      'Eigene Schalenlagen: Länge je Gewebelage ab Wurzel — die Rechnung prüft Auslastung, Verdrehung und Bruchgrenze der Schale.');
    modeSel(g4.body, 'shellMode');
    sel(g4.body, 'Torsionsquerschnitt', [['full', 'ganzes Profil (geschlossene Schale)'], ['dbox', 'D-Box (Nase bis Holm)']], 'box');
    sel(g4.body, 'Schalengewebe', matOpts('fab'), 'shellMat');
    sel(g4.body, 'Faserrichtung', [['45', '±45° (torsionssteif)'], ['090', '0/90°']], 'shellOri', 'Für Torsion ±45° legen — 0/90° trägt Schub nur über das Harz.');
    if (md.shell === 'manual') {
      txtRow(g4.body, 'Schale: Lagenlängen (mm)', 'shellLen', L0 + ', 600');
      hint(g4.body, T('Ein Eintrag je Gewebelage (Länge ab Wurzel), Anzahl × Länge erlaubt, z. B.') + ' „2×' + L0 + ', 600“.');
      takeBtn(g4.body, { shell: true });
    } else
      num(g4.body, 'Mindestlagen', 'shellMin', 1, 'Lagen, die unabhängig von der Rechnung über die ganze Spannweite gehen (Handhabung, Oberfläche).', { int: true, min: 0 });
    side.appendChild(g4.g);

    const g5 = grp('Werkstoffe', false, TAB, { key: 'holmMats' });
    hint(g5.body, 'Standard: Kohle-UD-Gelege, Kohle-/Glas-/Aramidgewebe, Balsa, Herex, Rohacell, Sperrholz. Werte anpassen oder eigene Werkstoffe anlegen.');
    const bb = document.createElement('div'); bb.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px';
    bb.appendChild(mkMini(T('Werkstoffe bearbeiten…'), openMatEditor));
    bb.appendChild(mkMini(T('Einstellungen zurücksetzen'), () => { state.cfg.holm = defaults(); RB(); }));
    g5.body.appendChild(bb);
    side.appendChild(g5.g);
  }

  function show() { render(); }

  Object.assign(App, { holmSidebar });
  window.Holm = { show, refresh: show, compute, openMatEditor, presets: () => clone(MAT_PRESETS) };
})();
