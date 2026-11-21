/* verbinder.js — Reiter „Verbinderform" (Menü Tragflächen, nach Formenbau; id vbf, Feature „verbinder").
 *
 *   Pressform für einen Tragflächenverbinder (Steckung) aus UD-Kohle in Composite-Bauweise,
 *   als STL / 3MF für den 3D-Druck oder als Vorlage zum Fräsen.
 *
 *   Steckung  : Querschnitt (Vierkant mit SCHARFEN Ecken oder rund), Länge je Seite ab der Mitte,
 *               V-Knick in der Mitte (Winkel gesamt, scharf oder mit Innenradius). ALLE Werte frei; Knöpfe
 *               übernehmen sie nur einmalig aus dem Formenbau (Steckungs-Ausnehmungen Wurzel /
 *               Fugen / Randbogen), aus „Steghöhen" (Hauptsteckung) bzw. den V-Winkel aus dem
 *               Tragflächendesign — danach bleibt alles änderbar (keine Verknüpfung).
 *   Aufbau    : 'print2' zweiteilig für den 3D-Druck — Unterteil = untere Platte + Seitenwände in
 *               EINEM Stück, Stempel = obere Platte + Zunge in EINEM Stück;
 *               'split3' dreiteilig — Grundplatte, zwei Seitenleisten (abschraubbar), Stempel.
 *               Wandstärke untere Platte / obere Platte / Seitenwand frei, Führungshöhe der Zunge,
 *               Spiel, Überlänge (Kanal an den Enden offen, Rovings lassen sich straff ziehen),
 *               Entformungsschräge (nur zweiteilig), Überlaufnut, Verschraubung (Durchgang oder
 *               Sechskant-Mutterfalle von unten).
 *   Lage      : 'flat' — Dickenrichtung der Steckung waagrecht, V-Knick in der Draufsicht
 *               (flache Form, gepresst wird in Sehnenrichtung); 'upv' — Dickenrichtung senkrecht,
 *               V-Knick in der Vorderansicht, Unterteil und Stempel selbst geknickt (Unter-/Ober-
 *               seite als scharfer Knick, Wandstärke überall mindestens wie eingestellt; wahlweise mit
 *               ebener Latte unten am Unterteil und oben auf dem Stempel, die den Knick ausgleicht);
 *               'up' — wie 'upv', aber Unter- und Oberseite eben (Knick nur im Kanal).
 *   Geometrie : jedes Teil ist ein 2,5D-Körper (Grundriss + Unter-/Oberkante je Punkt). Kanalbereich
 *               als Raster (Stationen längs × Querprofil), Wände als Blöcke zwischen Querlinien
 *               (Fächer, um Bohrungen ein Winkel-Reißverschluss), senkrechte Flächen aus den Kanten
 *               mit allen Zwischenhöhen (keine T-Stöße) → wasserdichtes, richtig orientiertes Netz.
 *   Daten     : state.cfg.formVb (Präfix form… → je Tragfläche, wings.js).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const TAB = 'vbf', KEY = 'formVb', D2R = Math.PI / 180;
  // Schrauben: Durchgangsbohrung d, Schlüsselweite s, Mutterhöhe m (mm)
  const SCREWS = { M3: { d: 3.4, s: 5.5, m: 2.4 }, M4: { d: 4.5, s: 7, m: 3.2 }, M5: { d: 5.5, s: 8, m: 4 }, M6: { d: 6.6, s: 10, m: 5 }, M8: { d: 9, s: 13, m: 6.5 } };
  const DEF = {
    shape: 'rect',          // 'rect' Vierkant | 'circle' rund
    a: 8,                   // Breite in Sehnenrichtung (mm)
    b: 20,                  // Höhe in Dickenrichtung (mm) — in dieser Richtung liegt der V-Knick
    d: 10,                  // Durchmesser (mm)
    len1: 150, len2: 150,   // Länge je Seite ab der Mitte (mm)
    vDeg: 0,                // Knickwinkel gesamt = V-Form beider Seiten zusammen (°)
    kinkShape: 'sharp',     // Knick: 'sharp' scharf (innen und außen) | 'round' ausgerundet mit Innenradius
    rIn: 20,                // Innenradius am Knick (mm), nur bei 'round'
    pick: '',               // zuletzt gewählte Quelle zum Übernehmen
    vPick: 'root',          // zuletzt gewählte Stelle für die V-Form aus der Tragfläche
    orient: 'flat',         // 'flat' Knick in der Draufsicht | 'upv' Knick in der Vorderansicht, Form geknickt | 'up' dito, Form außen eben
    build: 'print2',        // 'print2' zweiteilig (3D-Druck) | 'split3' dreiteilig
    tBot: 4, tTop: 4, tSide: 12,  // Wandstärken untere Platte / obere Platte / Seitenwand (mm)
    guide: 6,               // Führungshöhe: Seitenwand reicht so weit über die Steckung (mm)
    clr: 0.15,              // Spiel der Zunge je Seite (mm)
    ov: 15,                 // Überlänge je Ende (mm)
    draft: 0,               // Entformungsschräge des Kanals (°, nur zweiteilig)
    grvW: 0, grvD: 1, grvOff: 1,  // Überlaufnut: Breite (0 = keine), Tiefe, Abstand zum Kanal (mm)
    latte: false,           // nur 'upv': ebene Latte unter dem Unterteil und auf dem Stempel (Knick ausgeglichen)
    latW: 0,                // Breite der Latte (mm, 0 = ganze Breite der Form)
    latT: 3,                // Stärke der Latte an der dünnsten Stelle (mm)
    holes: 'nut',           // 'nut' Durchgang + Sechskant unten | 'thru' Durchgang | 'none'
    screw: 'M4', pitch: 50, edge: 15,
    tex: 800, phi: 60, rhoF: 1.8, over: 4,   // Faserbedarf: Feinheit, Faservolumenanteil %, Dichte, Überfüllung %
    explode: 12, showPart: true, showSec: true
  };
  const ST = () => App.state;
  function C() {
    const cfg = ST().cfg; let c = cfg[KEY];
    if (!c || typeof c !== 'object') c = cfg[KEY] = {};
    for (const k in DEF) if (!(k in c)) c[k] = DEF[k];
    return c;
  }
  const num = (v, d) => { v = +v; return isFinite(v) ? v : d; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r6 = z => Math.round(z * 1e6) / 1e6;
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1), f2 = v => (Math.round(v * 100) / 100).toFixed(2);
  const fmt = v => String(Math.round(v * 100) / 100).replace('.', ',');

  function params(c) {
    const p = {};
    p.shape = c.shape === 'circle' ? 'circle' : 'rect';
    p.a = clamp(num(c.a, 8), 0.5, 500); p.b = clamp(num(c.b, 20), 0.5, 500); p.d = clamp(num(c.d, 10), 0.5, 500);
    p.len1 = clamp(num(c.len1, 150), 1, 5000); p.len2 = clamp(num(c.len2, 150), 1, 5000);
    p.kink = clamp(Math.abs(num(c.vDeg, 0)), 0, 60);
    p.sharp = c.kinkShape !== 'round';
    p.rIn = p.sharp ? 0 : clamp(num(c.rIn, 20), 0, 5000);
    p.orient = c.orient === 'up' || c.orient === 'upv' ? c.orient : 'flat';
    p.build = c.build === 'split3' ? 'split3' : 'print2';
    p.tBot = clamp(num(c.tBot, 4), 0.4, 200); p.tTop = clamp(num(c.tTop, 4), 0.4, 200); p.tSide = clamp(num(c.tSide, 12), 0.8, 200);
    p.guide = clamp(num(c.guide, 6), 0.5, 500); p.clr = clamp(num(c.clr, 0.15), 0, 5); p.ov = clamp(num(c.ov, 15), 0, 500);
    p.draft = p.build === 'print2' ? clamp(num(c.draft, 0), 0, 10) : 0;
    p.grvW = clamp(num(c.grvW, 0), 0, 50); p.grvD = clamp(num(c.grvD, 1), 0, 50); p.grvOff = clamp(num(c.grvOff, 1), 0, 50);
    p.latte = p.orient === 'upv' && !!c.latte; p.latW = clamp(num(c.latW, 0), 0, 2000); p.latT = clamp(num(c.latT, 3), 0.4, 200);
    p.holes = ['nut', 'thru', 'none'].indexOf(c.holes) >= 0 ? c.holes : 'nut';
    p.screw = SCREWS[c.screw] ? c.screw : 'M4';
    p.pitch = clamp(num(c.pitch, 50), 5, 5000); p.edge = clamp(num(c.edge, 15), 0, 5000);
    p.tex = clamp(num(c.tex, 800), 1, 1e6); p.phi = clamp(num(c.phi, 60), 1, 90); p.rhoF = clamp(num(c.rhoF, 1.8), 0.1, 20); p.over = clamp(num(c.over, 4), 0, 100);
    return p;
  }

  // =====================================================================================
  //  2,5D-Netzbauer: Zellen = Grundriss-Polygone (Vertex-Ids) mit Unter-/Oberkante je Vertex.
  // =====================================================================================
  function Mesher() {
    const xy = [], idx = new Map(), cells = [];
    function vid(x, y) {
      const k = Math.round(x * 1e5) + ',' + Math.round(y * 1e5);
      let i = idx.get(k);
      if (i === undefined) { i = xy.length; xy.push([x, y]); idx.set(k, i); }
      return i;
    }
    const area = L => { let s = 0; for (let i = 0; i < L.length; i++) { const a = xy[L[i]], b = xy[L[(i + 1) % L.length]]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
    const tarea = (a, b, c) => ((xy[b][0] - xy[a][0]) * (xy[c][1] - xy[a][1]) - (xy[c][0] - xy[a][0]) * (xy[b][1] - xy[a][1])) / 2;
    // Zelle anlegen: Außenring gegen den Uhrzeigersinn, Löcher im Uhrzeigersinn, Dreiecke CCW.
    function add(loops, tris, zb, zt) {
      loops = loops.map((L, k) => {
        L = L.filter((v, i) => v !== L[(i + L.length - 1) % L.length]);
        const A = area(L);
        return (k === 0 ? A < 0 : A > 0) ? L.slice().reverse() : L;
      }).filter(L => L.length >= 3);
      if (!loops.length) return;
      // Höhe als Funktion von x (geknickte Form): je Eckpunkt auswerten
      const toMap = h => { if (typeof h !== 'function') return h; const M = new Map(); loops.forEach(L => L.forEach(v => M.set(v, h(xy[v][0])))); return M; };
      zb = toMap(zb); zt = toMap(zt);
      if (!tris) {   // konvexe Zelle (Raster): passende Diagonale wählen
        const L = loops[0];
        if (L.length === 3) tris = [[L[0], L[1], L[2]]];
        else if (L.length === 4) tris = (tarea(L[0], L[1], L[2]) > 1e-12 && tarea(L[0], L[2], L[3]) > 1e-12)
          ? [[L[0], L[1], L[2]], [L[0], L[2], L[3]]] : [[L[1], L[2], L[3]], [L[1], L[3], L[0]]];
        else { tris = []; for (let i = 1; i + 1 < L.length; i++) tris.push([L[0], L[i], L[i + 1]]); }
      }
      const out = [];
      tris.forEach(t => { const s = tarea(t[0], t[1], t[2]); if (Math.abs(s) < 1e-12) return; out.push(s > 0 ? t : [t[0], t[2], t[1]]); });
      cells.push({ loops, tris: out, zb, zt });
    }
    function build() {
      const zOf = (c, v, top) => { const h = top ? c.zt : c.zb; return typeof h === 'number' ? h : h.get(v); };
      const lev = new Map();
      cells.forEach(c => c.loops.forEach(L => L.forEach(v => {
        let a = lev.get(v); if (!a) lev.set(v, a = []);
        a.push(zOf(c, v, 0), zOf(c, v, 1));
      })));
      lev.forEach((a, v) => { a.sort((x, y) => x - y); const b = []; a.forEach(z => { if (!b.length || z - b[b.length - 1] > 1e-6) b.push(z); }); lev.set(v, b); });
      const E = new Map();
      cells.forEach((c, ci) => c.loops.forEach(L => { for (let i = 0; i < L.length; i++) E.set(L[i] + ',' + L[(i + 1) % L.length], ci); }));
      const pos = [];
      const tri = (a, za, b, zb, d, zd) => pos.push(xy[a][0], xy[a][1], za, xy[b][0], xy[b][1], zb, xy[d][0], xy[d][1], zd);
      cells.forEach(c => c.tris.forEach(([a, b, d]) => {
        tri(a, zOf(c, a, 1), b, zOf(c, b, 1), d, zOf(c, d, 1));
        tri(a, zOf(c, a, 0), d, zOf(c, d, 0), b, zOf(c, b, 0));
      }));
      const col = (v, lo, hi) => { const L = [lo]; (lev.get(v) || []).forEach(z => { if (z > lo + 1e-6 && z < hi - 1e-6) L.push(z); }); if (hi > lo + 1e-6) L.push(hi); return L; };
      // Senkrechte Fläche über der Kante a→b (Zelle links), Spalten mit allen Zwischenhöhen.
      const zip = (a, b, LA, LB) => {
        let i = 0, j = 0;
        while (i < LA.length - 1 || j < LB.length - 1) {
          if (i >= LA.length - 1 || (j < LB.length - 1 && LB[j + 1] <= LA[i + 1])) { tri(a, LA[i], b, LB[j], b, LB[j + 1]); j++; }
          else { tri(a, LA[i], b, LB[j], a, LA[i + 1]); i++; }
        }
      };
      cells.forEach(c => c.loops.forEach(L => {
        for (let i = 0; i < L.length; i++) {
          const a = L[i], b = L[(i + 1) % L.length], nb = E.get(b + ',' + a), B = nb === undefined ? null : cells[nb];
          const a0 = zOf(c, a, 0), a1 = zOf(c, a, 1), b0 = zOf(c, b, 0), b1 = zOf(c, b, 1), pieces = [];
          if (!B) pieces.push([a0, a1, b0, b1]);
          else {
            const na0 = zOf(B, a, 0), na1 = zOf(B, a, 1), nb0 = zOf(B, b, 0), nb1 = zOf(B, b, 1);
            pieces.push([a0, Math.min(a1, na0), b0, Math.min(b1, nb0)], [Math.max(a0, na1), a1, Math.max(b0, nb1), b1]);
          }
          pieces.forEach(([la, ha, lb, hb]) => {
            if (ha < la) ha = la; if (hb < lb) hb = lb;
            if (ha - la < 1e-6 && hb - lb < 1e-6) return;
            zip(a, b, col(a, la, ha), col(b, lb, hb));
          });
        }
      }));
      return new Float32Array(pos);
    }
    return { vid, add, build, xy, cells };
  }

  /* Ring zwischen zwei geschlossenen CCW-Ringen (außen O, innen I) um den Mittelpunkt c: Start an der
   * Speiche mit dem kleinsten Winkelunterschied, dann je Schritt die kürzere Diagonale — aber nur, wenn
   * das Dreieck richtig herum liegt (sonst sähe eine Ecke den Kreis „von hinten“). */
  function ringZip(m, O, I, c) {
    const P = v => m.xy[v], ang = v => Math.atan2(P(v)[1] - c[1], P(v)[0] - c[0]);
    const dA = (a, b) => { let t = Math.abs(a - b) % (2 * Math.PI); return t > Math.PI ? 2 * Math.PI - t : t; };
    let k0 = 0, best = Infinity; const a0 = ang(I[0]);
    O.forEach((v, k) => { const t = dA(ang(v), a0); if (t < best) { best = t; k0 = k; } });
    const Oo = O.slice(k0).concat(O.slice(0, k0)), nO = Oo.length, nI = I.length, tris = [];
    const ar = (a, b, d) => (P(b)[0] - P(a)[0]) * (P(d)[1] - P(a)[1]) - (P(d)[0] - P(a)[0]) * (P(b)[1] - P(a)[1]);
    const d2 = (a, b) => (P(a)[0] - P(b)[0]) ** 2 + (P(a)[1] - P(b)[1]) ** 2;
    let i = 0, j = 0;
    while (i < nO || j < nI) {
      const o0 = Oo[i % nO], o1 = Oo[(i + 1) % nO], q0 = I[j % nI], q1 = I[(j + 1) % nI];
      let advO;
      if (j >= nI) advO = true; else if (i >= nO) advO = false;
      else {
        const okO = ar(o0, o1, q0) > 1e-12, okI = ar(o0, q1, q0) > 1e-12;
        // Abschluss: vor dem letzten Schritt außen (zurück zum Startpunkt) erst innen fertig laufen und umgekehrt
        if (i === nO - 1 && okI) advO = false;
        else if (j === nI - 1 && okO) advO = true;
        else advO = okO !== okI ? okO : d2(o1, q0) <= d2(o0, q1);
      }
      if (advO) { tris.push([o0, o1, q0]); i++; } else { tris.push([o0, q1, q0]); j++; }
    }
    return tris;
  }
  function ccw(m, L) { let s = 0; for (let i = 0; i < L.length; i++) { const a = m.xy[L[i]], b = m.xy[L[(i + 1) % L.length]]; s += a[0] * b[1] - b[0] * a[1]; } return s >= 0 ? L : L.slice().reverse(); }

  // =====================================================================================
  //  Geometrie der Form
  // =====================================================================================
  function geometry(p) {
    const warn = [];
    const round = p.shape === 'circle', lying = p.orient === 'flat', upv = p.orient === 'upv', split = p.build === 'split3';
    const bendDim = round ? p.d : p.b;                 // Maß in Biegerichtung (Dickenrichtung der Tragfläche)
    let Wc, Hc;                                        // Querschnitt in der Form: quer / senkrecht (Pressrichtung)
    if (round) Wc = Hc = p.d; else if (lying) { Wc = p.b; Hc = p.a; } else { Wc = p.a; Hc = p.b; }
    const r = Wc / 2;
    const clr = Math.max(0, Math.min(p.clr, Wc / 2 - 0.2));
    if (clr < p.clr - 1e-9) warn.push(T('Spiel der Zunge auf') + ' ' + f2(clr) + ' mm ' + T('begrenzt.'));
    const Rf = 0;                                      // Ecken der Steckung immer scharf (Nutzervorgabe)
    // Scharfer Knick: Mittellinie = zwei Geraden (Rb = 0), alle Versatzflächen innen UND außen auf Gehrung.
    const phi = p.kink / 2 * D2R, Rb = p.sharp ? 0 : p.rIn + bendDim / 2;
    const sa = Rb * phi, cph = Math.cos(phi), sph = Math.sin(phi), tph = Math.tan(phi), bent = phi > 1e-9;
    const tanA = Math.tan(p.draft * D2R), NF = 6, NC = 16;

    // ---- Mittellinie (Biegeebene: p längs, q zur Krümmungsmitte) -------------------------
    const Mxy = u => [0, Rb + (u - Rb) / cph];
    function Q(s, u) {
      const as = Math.abs(s), sg = s < 0 ? -1 : 1;
      if (bent && u > Rb - 1e-9 && as <= sa + (u - Rb) * tph + 1e-9) return Mxy(u);
      if (as <= sa && bent) { if (Rb < 1e-9) return Mxy(u); const t = s / Rb; return [(Rb - u) * Math.sin(t), Rb - (Rb - u) * Math.cos(t)]; }
      const t = bent ? sg * phi : 0, ct = Math.cos(t), st = Math.sin(t), l = as - (bent ? sa : 0);
      const p0 = bent ? Rb * Math.sin(t) : 0, q0 = bent ? Rb * (1 - Math.cos(t)) : 0;
      return [p0 + ct * sg * l - st * u, q0 + st * sg * l + ct * u];
    }
    const xs = s => { const as = Math.abs(s), sg = s < 0 ? -1 : 1; if (!bent) return s; if (as <= sa) return Rb > 1e-9 ? Rb * Math.sin(s / Rb) : 0; return sg * (Rb * sph + (as - sa) * cph); };
    const XY = (s, e) => lying ? Q(s, e) : [xs(s), e];
    function zRel(x, u) {
      if (!bent) return u;
      const R = Rb - u;
      if (Rb > 1e-9 && R > 0 && Math.abs(x) <= R * sph) return Rb - Math.sqrt(R * R - x * x);
      return Rb + Math.abs(x) * tph - R / cph;
    }
    // Außenflächen der geknickten Form ('upv'): immer scharfer Knick (Versatz der Tangenten auf Gehrung)
    const zMit = (x, u) => bent ? Rb + Math.abs(x) * tph - (Rb - u) / cph : u;
    const uB = -Hc / 2 - p.tBot;                                // Unterseite (Versatz von der Mittellinie)
    const zc = lying ? p.tBot + Hc / 2 : upv ? -zMit(0, uB) : p.tBot - zRel(0, -Hc / 2);
    const Zf = (s, v) => r6(lying ? zc + v : zc + zRel(xs(s), v));
    const ZO = (x, u) => r6(zc + zMit(x, u));

    // ---- Querprofile (lokal e quer, v senkrecht) ----------------------------------------
    const floorL = [];
    if (round) for (let k = 0; k <= NC; k++) { const t = k / NC * Math.PI / 2; floorL.push([r * Math.sin(t), -r * Math.cos(t)]); }
    else {
      floorL.push([0, -Hc / 2]);
      if (Rf > 1e-6) { floorL.push([Wc / 2 - Rf, -Hc / 2]); for (let k = 1; k <= NF; k++) { const t = k / NF * Math.PI / 2; floorL.push([Wc / 2 - Rf + Rf * Math.sin(t), -Hc / 2 + Rf * (1 - Math.cos(t))]); } }
      else floorL.push([Wc / 2, -Hc / 2]);
    }
    floorL[floorL.length - 1][0] = Wc / 2;
    const vW0 = round ? 0 : -Hc / 2 + Rf;
    const eT = Wc / 2 - clr, tongueL = [];
    let Rt = 0;
    if (round) { const tm = Math.asin(clamp(eT / r, 0, 1)); for (let k = 0; k <= NC; k++) { const t = tm * k / NC; tongueL.push([r * Math.sin(t), r * Math.cos(t)]); } }
    else {
      Rt = Math.max(0, Math.min(Rf, eT - 0.01));
      tongueL.push([0, Hc / 2]);
      if (Rt > 1e-6) { tongueL.push([eT - Rt, Hc / 2]); for (let k = 1; k <= NF; k++) { const t = k / NF * Math.PI / 2; tongueL.push([eT - Rt + Rt * Math.sin(t), Hc / 2 + Rt * (1 - Math.cos(t))]); } }
      else tongueL.push([eT, Hc / 2]);
    }
    const vTop = round ? r : Hc / 2;
    const guide = Math.max(p.guide, 0.3);
    const S1 = p.len1 + p.ov, S2 = p.len2 + p.ov;
    const uT = vTop + guide, uT2 = uT + p.tTop, uF = -Hc / 2;   // Wandoberkante, Stempeloberseite, Kanalboden (Versatz)
    const ZtopFlat = r6(Math.max(Zf(-S1, vTop), Zf(S2, vTop), Zf(0, vTop)) + guide);
    /* Höhen je Station s bzw. je Grundriss-x. Eben ('flat', 'up'): feste Werte. Geknickt ('upv'): Unterseite,
     * Wandoberkante, Stempeloberseite und (dreiteilig) Oberkante Grundplatte folgen dem Knick. */
    const ztS = s => upv ? ZO(xs(s), uT) : ZtopFlat, ztX = x => upv ? ZO(x, uT) : ZtopFlat;
    const zbS = s => upv ? ZO(xs(s), uB) : 0, zbX = x => upv ? ZO(x, uB) : 0;
    const z2S = s => upv ? ZO(xs(s), uT2) : r6(ZtopFlat + p.tTop), z2X = x => upv ? ZO(x, uT2) : r6(ZtopFlat + p.tTop);
    const z3S = s => upv ? ZO(xs(s), uF) : p.tBot, z3X = x => upv ? ZO(x, uF) : p.tBot;   // dreiteilig: Oberkante Grundplatte
    const fx = f => upv ? f : f(0);                           // Höhe für Zellen: Funktion von x oder fester Wert
    const Ztop = ztS(0), tB3 = z3S(0);
    const eWt0 = Math.max.apply(null, [-S1, 0, S2].map(s => Wc / 2 + (ztS(s) - Zf(s, vW0)) * tanA));   // Kanalbreite oben (breiteste Stelle)
    const eOut = eWt0 + p.tSide;
    const wallH = upv ? uT - (split ? uF : uB) : Ztop - (split ? tB3 : 0);
    let grv = p.grvW > 1e-6 && p.grvD > 1e-6;
    if (grv && p.grvOff + p.grvW > p.tSide - 1) { grv = false; warn.push(T('Überlaufnut passt nicht in die Seitenwand — weggelassen.')); }
    if (grv && p.grvD > wallH - 0.6) { grv = false; warn.push(T('Überlaufnut tiefer als die Seitenwand — weggelassen.')); }
    const eEmax = grv ? eWt0 + p.grvOff + p.grvW : eWt0;

    // ---- Knick-Block (liegend) und Schraubenlage -----------------------------------------
    const sk = lying && bent ? sa + Math.max(0, (eOut - Rb) * tph) + 0.5 : 0;
    if (lying && bent && (sk >= S1 - 0.5 || sk >= S2 - 0.5)) return { ok: false, msg: T('Die Steckung ist zu kurz für Knickwinkel und Innenradius.'), warn };
    const SC = SCREWS[p.screw];
    const nutOn = p.holes === 'nut';
    const rCirc = SC.d / 2 / Math.cos(Math.PI / 20);
    const rHex = (SC.s + 0.3) / 2 / Math.cos(Math.PI / 6), mHex = SC.m + 0.4;
    const rH = nutOn ? rHex : rCirc, hw = (eOut - eEmax) / 2, uH = eEmax + hw, bh = rH + 1;
    let holeS = [];
    if (p.holes !== 'none') {
      if (hw < rH + 0.8) warn.push(T('Seitenwand zu schmal für') + ' ' + p.screw + ' — ' + T('Wandstärke Seitenwand mindestens') + ' ' + fmt(Math.ceil((p.tSide + 2 * (rH + 0.8 - hw)) * 2) / 2) + ' mm. ' + T('Bohrungen weggelassen.'));
      else {
        const pitch = Math.max(p.pitch, 2 * bh + 0.5);
        const lo = Math.max(-S1 + p.edge, -S1 + bh + 0.3), hi = Math.min(S2 - p.edge, S2 - bh - 0.3);
        const segs = lying && bent ? [[lo, -(sk + bh + 0.5)], [sk + bh + 0.5, hi]] : [[lo, hi]];
        segs.forEach(([a, b]) => {
          if (b < a - 1e-9) return;
          const L = b - a, n = Math.max(1, Math.floor(L / pitch + 1e-9) + 1);
          for (let k = 0; k < n; k++) holeS.push(n === 1 ? (a + b) / 2 : a + L * k / (n - 1));
        });
      }
    }
    /* ---- Ebene Latte ('upv'): unter dem Unterteil bzw. der Grundplatte und auf dem Stempel, gleicht den Knick
     * aus. Breite mittig (uL = halbe Breite, mindestens Kanal + 1 mm, höchstens ganze Form); ihre Kante darf
     * keine Bohrung schneiden — dann rückt sie neben das Loch (nach außen, wenn gleich weit). */
    let lat = null;
    if (p.latte) {
      let uL = p.latW > 0 ? clamp(p.latW / 2, eEmax + 1, eOut) : eOut, moved = false;
      if (uL > eOut - 1) uL = eOut;
      if (holeS.length && uL < eOut && Math.abs(uL - uH) < rH + 0.5) {
        const out = uH + rH + 0.5 > eOut - 1 ? eOut : uH + rH + 0.5, inn = uH - rH - 0.5;
        uL = inn >= eEmax + 1 && uL - inn < out - uL ? inn : out; moved = true;
      }
      const xE = [xs(-S1), 0, xs(S2)];
      const zB = r6(Math.min.apply(null, xE.map(zbX)) - p.latT), zT = r6(Math.max.apply(null, xE.map(z2X)) + p.latT);
      lat = { uL, zB, zT, moved, rise: Math.max.apply(null, xE.map(zbX)) - Math.min.apply(null, xE.map(zbX)) };
      if (moved) warn.push(T('Breite der Latte an die Bohrungen angepasst:') + ' ' + fmt(2 * uL) + ' mm.');
    }
    // ---- Stationen -----------------------------------------------------------------------
    let sl = [-S1, S2, -p.len1, p.len2, 0];
    if (bent) {
      if (lying) { const n = clamp(Math.ceil(2 * phi / (1.5 * D2R)), 2, 120); for (let k = 0; k <= n; k++) sl.push(-sa + 2 * sa * k / n); sl.push(-sk, sk); }
      else if (Rb > 1e-9) {
        const xM = (Rb + Hc / 2) * sph, n = clamp(Math.ceil(2 * phi / (0.75 * D2R)), 8, 240);
        const sx = x => { const ax = Math.abs(x), sg = x < 0 ? -1 : 1; return ax <= Rb * sph ? sg * Rb * Math.asin(clamp(ax / Rb, 0, 1)) : sg * (sa + (ax - Rb * sph) / cph); };
        for (let k = 0; k <= n; k++) sl.push(sx(-xM + 2 * xM * k / n));
      }
    }
    holeS.forEach(s => { for (let k = -4; k <= 4; k++) sl.push(s + bh * k / 4); });   // Bohrungsblock: dicht, damit der Ring sauber verzahnt
    sl = sl.filter(s => s >= -S1 - 1e-9 && s <= S2 + 1e-9).sort((a, b) => a - b);
    const S = [];
    sl.forEach(s => { if (!S.length || s - S[S.length - 1] > 1e-4) S.push(s); });
    const iOf = s => { let bi = 0; S.forEach((q, i) => { if (Math.abs(q - s) < Math.abs(S[bi] - s)) bi = i; }); return bi; };
    const iK0 = lying && bent ? iOf(-sk) : -1, iK1 = lying && bent ? iOf(sk) : -1;
    const holes = holeS.map(s => {
      const i0 = iOf(s - bh), i1 = iOf(s + bh), tAng = lying && bent ? (s > 0 ? phi : -phi) : 0;
      return { s, i0, i1, tAng };
    });

    // ---- Querprofile je Station ------------------------------------------------------------
    const groove = (e0, z) => {
      if (!grv) return [];
      const g = [], a = e0 + p.grvOff, b = a + p.grvW, zd = r6(z - p.grvD);
      if (p.grvOff > 1e-6) g.push([a, z]);
      g.push([a, zd], [b, zd], [b, z]);
      return g;
    };
    const full = half => half.slice(1).reverse().map(([e, z]) => [-e, z]).concat(half);
    const mirror = half => half.slice().reverse().map(([e, z]) => [-e, z]);
    const SD = S.map(s => {
      const Zt = ztS(s), zW0 = Zf(s, vW0), eWt = Wc / 2 + (Zt - zW0) * tanA;
      const floor = floorL.map(([e, v]) => [e, Zf(s, v)]);
      let tongue;
      if (round) tongue = tongueL.map(([e, v]) => [e, Zf(s, v)]);
      else { const dT = Math.max(0, Zf(s, Hc / 2 + Rt) - zW0) * tanA; tongue = tongueL.map(([e, v], k) => [k === 0 ? 0 : e + dT, Zf(s, v)]); }
      const tl = tongue[tongue.length - 1], eTt = tl[0] + (Zt - tl[1]) * tanA;
      const low = floor.concat([[eWt, Zt]], groove(eWt, Zt));
      const stamp = tongue.concat([[eTt, Zt]]);
      const bar = [[Wc / 2, Zt]].concat(groove(Wc / 2, Zt));
      return { s, floor, tongue, low, stamp, bar, zW0 };
    });

    // ---- Bauteile ------------------------------------------------------------------------
    function zoneGrid(m, prof, zbF, ztF) {
      const n = S.length, w = prof[0].length;
      const V = prof.map((row, i) => row.map(([e]) => { const q = XY(S[i], e); return m.vid(q[0], q[1]); }));
      for (let i = 0; i + 1 < n; i++) for (let j = 0; j + 1 < w; j++) {
        const loop = [], zb = new Map(), zt = new Map();
        [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].forEach(([ii, jj]) => {
          const v = V[ii][jj]; if (loop.indexOf(v) >= 0) return;
          loop.push(v); const z = prof[ii][jj][1]; zb.set(v, zbF(z, S[ii])); zt.set(v, ztF(z, S[ii]));
        });
        if (loop.length >= 3) m.add([loop], null, zb, zt);
      }
      return V;
    }
    const holeCenter = (h, sg) => lying ? Q(h.s, sg * uH) : [xs(h.s), sg * uH];
    function holeLoop(m, h, sg, hex) {
      const c = holeCenter(h, sg), L = [], n = hex ? 6 : 20, R = hex ? rHex : rCirc;
      for (let k = 0; k < n; k++) { const t = h.tAng + 2 * Math.PI * k / n; L.push(m.vid(c[0] + R * Math.cos(t), c[1] + R * Math.sin(t))); }
      return { c, L };
    }
    /* Wandbereich einer Seite (sg = ±1) als Raster: Stationen × Querteilung von der inneren Kante
     * (Vertex-Ids innerV, Abstand innerE) bis zur Außenseite eOut. Ausgespart und als eigener Block:
     * Knick (liegend, Fächer vom Gehrungspunkt) und je Bohrung (Ring um das Loch).
     * hole: 'nut' (Sechskant von unten bis mHex) | 'thru' | 'none'. */
    function wall(m, innerV, innerE, sg, zb, zt, hole, lv) {
      const n = S.length;
      // Querteilung: ohne Latte gleichmäßig bis eOut; mit Latte erst bis zur Lattenkante uL (Index kL), dann bis eOut
      let eMin = Infinity, nK, kL = -1;
      innerE.forEach(e => { eMin = Math.min(eMin, e); });
      if (lv) { const n1 = Math.max(1, Math.ceil((lv.uL - eMin) / 2)), n2 = lv.uL >= eOut - 1e-9 ? 0 : Math.max(1, Math.ceil((eOut - lv.uL) / 2)); kL = n1; nK = n1 + n2; }
      else nK = clamp(Math.ceil((eOut - eMin) / 2), 2, 16);
      const uAt = (i, k) => !lv ? innerE[i] + (eOut - innerE[i]) * k / nK
        : k <= kL ? innerE[i] + (lv.uL - innerE[i]) * k / kL : lv.uL + (eOut - lv.uL) * (k - kL) / (nK - kL);
      const Gv = S.map((s, i) => {
        const row = [innerV[i]];
        for (let k = 1; k <= nK; k++) { const u = sg * uAt(i, k), q = lying ? Q(s, u) : [xs(s), u]; row.push(m.vid(q[0], q[1])); }
        return row;
      });
      // Höhen je Querstreifen k: innerhalb der Latte deren ebene Unter- bzw. Oberseite
      const inL = k => lv && k < kL, zbK = k => inL(k) && lv.zb != null ? lv.zb : zb, ztK = k => inL(k) && lv.zt != null ? lv.zt : zt;
      const quads = (i0, i1, k0, k1) => { for (let i = i0; i < i1; i++) for (let k = k0; k < k1; k++) m.add([[Gv[i][k], Gv[i + 1][k], Gv[i + 1][k + 1], Gv[i][k + 1]]], null, zbK(k), ztK(k)); };
      const hs = hole !== 'none' ? holes : [];
      const inKink = i => iK0 >= 0 && i >= iK0 && i < iK1, inHole = i => hs.some(h => i >= h.i0 && i < h.i1);
      for (let i = 0; i + 1 < n; i++) { if (!inKink(i) && !inHole(i)) quads(i, i + 1, 0, nK); }
      // Umriss eines Blocks (Stationen i0..i1, Querstreifen k0..k1): innen hin, Querlinie bei i1, außen zurück (bzw. Gehrungspunkt), Querlinie bei i0
      const ringOf = (i0, i1, mid, k0, k1) => {
        k0 = k0 || 0; k1 = k1 == null ? nK : k1;
        const L = [], push = v => { if (L[L.length - 1] !== v) L.push(v); };
        for (let i = i0; i <= i1; i++) push(Gv[i][k0]);
        for (let k = k0 + 1; k <= k1; k++) push(Gv[i1][k]);
        if (mid != null) { push(mid); for (let k = k1; k > k0; k--) push(Gv[i0][k]); }
        else { for (let i = i1 - 1; i >= i0; i--) push(Gv[i][k1]); for (let k = k1 - 1; k > k0; k--) push(Gv[i0][k]); }
        if (L.length > 1 && L[0] === L[L.length - 1]) L.pop();
        return L;
      };
      if (iK0 >= 0) {
        const q = Mxy(sg * eOut), Mv = m.vid(q[0], q[1]), L = ringOf(iK0, iK1, Mv), tris = [];
        for (let j = 0; j < L.length; j++) { const a = L[j], b = L[(j + 1) % L.length]; if (a !== Mv && b !== Mv) tris.push([Mv, a, b]); }
        m.add([L], tris, zb, zt);
      }
      hs.forEach(h => {
        // Mit Latte: das Loch liegt ganz innerhalb oder ganz außerhalb der Lattenkante; der andere Teil des Blocks wird Raster
        let k0 = 0, k1 = nK;
        if (lv && kL < nK) { if (uH < lv.uL) { k1 = kL; quads(h.i0, h.i1, kL, nK); } else { k0 = kL; quads(h.i0, h.i1, 0, kL); } }
        const hb = zbK(k0), ht = ztK(k0);
        const hx = hole === 'nut', H = holeLoop(m, h, sg, hx), O = ccw(m, ringOf(h.i0, h.i1, null, k0, k1)), I = ccw(m, H.L);
        m.add([O, I.slice().reverse()], ringZip(m, O, I, H.c), hb, ht);
        if (hx) {
          const Hc2 = holeLoop(m, h, sg, false), I2 = ccw(m, Hc2.L);
          m.add([I, I2.slice().reverse()], ringZip(m, I, I2, H.c), typeof hb === 'function' ? x => r6(hb(x) + mHex) : r6(hb + mHex), ht);
        }
      });
    }
    // beide Seiten einer Zone mit Wänden versehen (lv = Latte: { uL, zb } unten bzw. { uL, zt } oben)
    const walls = (m, V, pf, zb, zt, hole, lv) => {
      const w = V[0].length;
      wall(m, V.map(r => r[w - 1]), pf.map(r => r[w - 1][0]), 1, zb, zt, hole, lv);
      wall(m, V.map(r => r[0]), pf.map(r => -r[0][0]), -1, zb, zt, hole, lv);
    };
    const latB = lat ? { uL: lat.uL, zb: lat.zB } : null, latTop = lat ? { uL: lat.uL, zt: lat.zT } : null;
    const parts = [];
    const stampHole = p.holes === 'none' ? 'none' : 'thru';
    if (!split) {
      const m = Mesher(), pf = SD.map(d => full(d.low)), V = zoneGrid(m, pf, (z, s) => lat ? lat.zB : zbS(s), z => z);
      const nh = p.holes === 'nut' && mHex > (upv ? uT - uB : Ztop) - 1 ? 'thru' : p.holes;
      if (p.holes === 'nut' && nh !== 'nut') warn.push(T('Unterteil zu flach für die Mutterfalle — nur Durchgangsbohrung.'));
      walls(m, V, pf, fx(zbX), fx(ztX), nh, latB);
      parts.push({ id: 'low', name: T('Unterteil (untere Platte + Seitenwände)'), file: 'unterteil', col: [87, 168, 255], pos: m.build(), off: [0, 0, 0] });
    } else {
      const m = Mesher(), pf = SD.map(d => full(d.floor)), V = zoneGrid(m, pf, (z, s) => lat ? lat.zB : zbS(s), z => z);
      const nh = p.holes === 'nut' && mHex > (upv ? uF - uB : tB3) - 0.6 ? 'thru' : p.holes;
      if (p.holes === 'nut' && nh !== 'nut') warn.push(T('Grundplatte zu dünn für die Mutterfalle — nur Durchgangsbohrung.'));
      walls(m, V, pf, fx(zbX), fx(z3X), nh, latB);
      parts.push({ id: 'base', name: T('Grundplatte'), file: 'grundplatte', col: [87, 168, 255], pos: m.build(), off: [0, 0, 0] });
      [1, -1].forEach(sg => {
        const mb = Mesher(), prof = SD.map(d => sg > 0 ? d.bar : mirror(d.bar));
        const Vb = zoneGrid(mb, prof, (z, s) => z3S(s), z => z), wb = Vb[0].length;
        wall(mb, Vb.map(r => sg > 0 ? r[wb - 1] : r[0]), prof.map(r => sg > 0 ? r[wb - 1][0] : -r[0][0]), sg, fx(z3X), fx(ztX), p.holes === 'none' ? 'none' : 'thru');
        parts.push({ id: sg > 0 ? 'bar1' : 'bar2', name: T('Seitenleiste') + ' ' + (sg > 0 ? 1 : 2), file: 'seitenleiste_' + (sg > 0 ? 1 : 2), col: [120, 210, 140], pos: mb.build(), off: [0, sg, 0] });
      });
    }
    {
      const m = Mesher(), pf = SD.map(d => full(d.stamp)), V = zoneGrid(m, pf, z => z, (z, s) => lat ? lat.zT : z2S(s));
      walls(m, V, pf, fx(ztX), fx(z2X), stampHole, latTop);
      parts.push({ id: 'stamp', name: T('Stempel (obere Platte + Zunge)'), file: 'stempel', col: [255, 180, 84], pos: m.build(), off: [0, 0, 1], flip: true });
    }

    // ---- Steckung selbst (Vorschau, Fläche, Volumen) --------------------------------------
    // Hohlraum = Kanalboden + Wand bis zur Zungenkante + Zunge (Harzspalt neben der Zunge gehört nicht dazu)
    const ring = d => { const tl = d.tongue[d.tongue.length - 1], ew = Wc / 2 + Math.max(0, tl[1] - d.zW0) * tanA; return full(d.floor.concat([[ew, tl[1]]])).concat(full(d.tongue).reverse()); };
    const jIdx = []; S.forEach((s, i) => { if (s >= -p.len1 - 1e-6 && s <= p.len2 + 1e-6) jIdx.push(i); });
    const jp = [];
    const P3 = (i, e, z) => { const q = XY(S[i], e); return [q[0], q[1], z]; };
    const R0 = jIdx.map(i => ring(SD[i]).map(([e, z]) => P3(i, e, z)));
    const T3 = (a, b, c) => jp.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    const nz = (a, b, c) => { const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2]; return Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) > 1e-9; };
    for (let k = 0; k + 1 < R0.length; k++) { const A = R0[k], B = R0[k + 1], n = A.length; for (let i = 0; i < n; i++) { const j = (i + 1) % n; if (nz(A[i], B[i], B[j])) T3(A[i], B[i], B[j]); if (nz(A[i], B[j], A[j])) T3(A[i], B[j], A[j]); } }
    [0, R0.length - 1].forEach((k, e) => {
      const R = R0[k], c = R.reduce((s, q) => [s[0] + q[0] / R.length, s[1] + q[1] / R.length, s[2] + q[2] / R.length], [0, 0, 0]);
      for (let i = 0; i < R.length; i++) { const j = (i + 1) % R.length; if (e) T3(c, R[j], R[i]); else T3(c, R[i], R[j]); }
    });
    const joiner = new Float32Array(jp);
    if (signedVolume(joiner) < 0) for (let i = 0; i < joiner.length; i += 9) for (let k = 0; k < 3; k++) { const t = joiner[i + 3 + k]; joiner[i + 3 + k] = joiner[i + 6 + k]; joiner[i + 6 + k] = t; }
    const i0 = iOf(0), ringC = ring(SD[i0]);
    let A = 0; for (let i = 0; i < ringC.length; i++) { const a = ringC[i], b = ringC[(i + 1) % ringC.length]; A += a[0] * b[1] - b[0] * a[1]; }
    A = Math.abs(A) / 2;
    // Querschnitt Mitte (für die Einblendung): Polygone in (e, z)
    const d0 = SD[i0], sec = [], Z0 = zbS(0), ZT2 = z2S(0);
    // Unterkante (von −eOut nach +eOut) bzw. Oberkante (von +eOut nach −eOut), mit Latte gestuft
    const edgeL = (z, zl) => !lat ? [[-eOut, z], [eOut, z]] : lat.uL >= eOut ? [[-eOut, zl], [eOut, zl]]
      : [[-eOut, z], [-lat.uL, z], [-lat.uL, zl], [lat.uL, zl], [lat.uL, z], [eOut, z]];
    const botE = lat ? edgeL(Z0, lat.zB) : edgeL(Z0), topE = (lat ? edgeL(ZT2, lat.zT) : edgeL(ZT2)).reverse();
    if (!split) {
      sec.push({ col: parts[0].col, P: botE.concat([[eOut, Ztop]], full(d0.low).reverse(), [[-eOut, Ztop]]) });
    } else {
      sec.push({ col: parts[0].col, P: botE.concat([[eOut, tB3], [Wc / 2, tB3]], full(d0.floor).reverse(), [[-Wc / 2, tB3], [-eOut, tB3]]) });
      sec.push({ col: parts[1].col, P: [[Wc / 2, tB3], [eOut, tB3], [eOut, Ztop]].concat(d0.bar.slice().reverse()) });
      sec.push({ col: parts[2].col, P: [[-eOut, Ztop], [-eOut, tB3], [-Wc / 2, tB3]].concat(mirror(d0.bar).reverse()) });
    }
    sec.push({ col: [255, 180, 84], P: [[-eOut, Ztop]].concat(full(d0.stamp), [[eOut, Ztop]], topE) });
    sec.push({ col: [60, 64, 74], part: true, P: ringC });
    let zLo = Infinity, zHi = -Infinity;
    parts.forEach(pt => { const b = bbox(pt.pos); zLo = Math.min(zLo, b.lo[2]); zHi = Math.max(zHi, b.hi[2]); });
    return {
      ok: true, warn, parts, joiner, sec, A, Wc, Hc, eOut, Ztop, ZT2, tB3, Hges: zHi - zLo, lat, Rf, Rt, clr, guide, phi, Rb, round, lying, upv, split,
      nHoles: p.holes === 'none' ? 0 : holes.length * 2, rH, mHex, stations: S.length,
      topWide: round ? 0 : 2 * Math.max(0, Zf(0, Hc / 2 + Rt) - Zf(0, vW0)) * tanA
    };
  }
  function signedVolume(v) {
    let s = 0;
    for (let i = 0; i + 8 < v.length; i += 9) s += v[i] * (v[i + 4] * v[i + 8] - v[i + 5] * v[i + 7]) - v[i + 1] * (v[i + 3] * v[i + 8] - v[i + 5] * v[i + 6]) + v[i + 2] * (v[i + 3] * v[i + 7] - v[i + 4] * v[i + 6]);
    return s / 6;
  }
  function bbox(v) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { const x = v[i + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
    return { lo, hi };
  }

  // =====================================================================================
  //  Werte übernehmen (einmalig, danach frei)
  // =====================================================================================
  function segAngle(k) { const W = App.wing, st = W && W.stations; return st && st[k + 1] ? (+st[k + 1].dihAngle || 0) : 0; }
  function kinkAt(pick) {
    if (pick === 'root') return Math.abs(2 * segAngle(0));
    const m = /^j(\d+)$/.exec(pick || '');
    if (m) { const k = +m[1]; return Math.abs(segAngle(k) - segAngle(k - 1)); }
    return 0;
  }
  function vPicks() {
    const n = (ST().segments || []).length, out = [['root', T('Wurzel (2 × V-Form Segment 1)')]];
    for (let k = 1; k < n; k++) out.push(['j' + k, T('Fuge nach Segment') + ' ' + k]);
    return out;
  }
  function formItems(P) {
    const c = ST().cfg, src = Array.isArray(c[P + 'Pts']) ? c[P + 'Pts'] : null;
    const DF = P === 'formStkT' ? { D: 8, A: 10, B: 6 } : { D: 10, A: 12, B: 8 };
    const dv = (k) => { const v = +c[P + k]; return v > 0 ? v : DF[k]; };
    const one = q => {
      const o = Array.isArray(q) ? {} : (q || {});
      const shape = (o.shape != null ? o.shape : c[P + 'Shape']) === 'rect' ? 'rect' : 'circle';
      return { shape, d: +o.d > 0 ? +o.d : dv('D'), a: +o.a > 0 ? +o.a : dv('A'), b: +o.b > 0 ? +o.b : dv('B') };
    };
    if (src && src.length) return src.map(one);
    return c[P] ? [one(null)] : [];
  }
  // Quellen: [{ id, label, apply(c) -> Text }]
  function sources() {
    const c = ST().cfg, out = [];
    const desc = it => it.shape === 'rect' ? fmt(it.a) + ' × ' + fmt(it.b) + ' mm' : 'Ø ' + fmt(it.d) + ' mm';
    const addList = (P, label, vp) => formItems(P).forEach((it, i, all) => out.push({
      id: 'form:' + P + ':' + i, label: label + (all.length > 1 ? ' · ' + T('Ausnehmung') + ' ' + (i + 1) : '') + ' — ' + desc(it),
      apply(v) {
        v.shape = it.shape; if (it.shape === 'rect') { v.a = it.a; v.b = it.b; } else v.d = it.d;
        if (vp != null) { v.vDeg = Math.round(kinkAt(vp) * 100) / 100; v.vPick = vp; }
        return T('Querschnitt') + ' ' + desc(it) + (vp != null ? ', ' + T('Knickwinkel') + ' ' + fmt(v.vDeg) + '°' : '');
      }
    }));
    addList('formStk', T('Formenbau: Tragflächensteckung (Wurzel)'), 'root');
    if (c.formGrpOn && Array.isArray(c.formGrpCuts)) c.formGrpCuts.slice().sort((a, b) => a - b).forEach(k => addList('formStkJ' + k, T('Formenbau: Fuge nach Segment') + ' ' + k, 'j' + k));
    addList('formStkT', T('Formenbau: Anschluss Randbogen / Winglet'), null);
    const SA = App.StegApi;
    if (SA && SA.stkData && SA.geo && SA.cfg) {
      let S = null; try { const G = SA.geo(); S = G ? SA.stkData(G, SA.cfg()) : null; } catch (e) { S = null; }
      if (S && S.inH > 0) {
        const len = Math.max(1, (+S.len || 0) - (+S.z0 || 0));
        const txt = S.round ? 'Ø ' + fmt(S.inH) + ' mm' : fmt(S.inW) + ' × ' + fmt(S.inH) + ' mm';
        out.push({
          id: 'stegh', label: T('Steghöhen: Hauptsteckung') + ' — ' + txt + ', ' + fmt(len) + ' mm',
          apply(v) {
            if (S.round) { v.shape = 'circle'; v.d = Math.floor(S.inH * 10 + 1e-6) / 10; }
            else { v.shape = 'rect'; v.a = Math.floor(S.inW * 10 + 1e-6) / 10; v.b = Math.floor(S.inH * 10 + 1e-6) / 10; }
            v.len1 = v.len2 = Math.round(len);
            v.vDeg = Math.round(Math.abs(2 * (segAngle(0) - (S.round ? (+S.vDeg || 0) : 0))) * 100) / 100; v.vPick = 'root';
            return T('Querschnitt') + ' ' + txt + ', ' + T('Länge je Seite') + ' ' + fmt(v.len1) + ' mm, ' + T('Knickwinkel') + ' ' + fmt(v.vDeg) + '°';
          }
        });
      }
    }
    return out;
  }

  // =====================================================================================
  //  Ansicht (WebGL2, Rückfall Canvas 2D) + Einblendung Querschnitt
  // =====================================================================================
  let cv = null, ctx = null, glc = null, gl = null, glP = null, glL = null, glBuf = null, glTried = false, glN = 0, glDirty = true;
  let G = null, scene = null, wired = false, pivot = null;
  const CAM0 = { yaw: -0.65, pitch: 0.55, zoom: 1, px: 0, py: 0 };
  const cam = Object.assign({}, CAM0);
  const ROT = (v, yaw, pitch) => {   // wie ViewCube.ROT_STD (Welt: y oben)
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x1 = v[0] * cy + v[2] * sy, z1 = -v[0] * sy + v[2] * cy;
    return [x1, v[1] * cp - z1 * sp, v[1] * sp + z1 * cp];
  };
  // Formkoordinaten (z oben) -> Kamera: Welt der Ansicht = (x, z, −y)
  function rotM() { const c0 = ROT([1, 0, 0], cam.yaw, cam.pitch), c1 = ROT([0, 0, -1], cam.yaw, cam.pitch), c2 = ROT([0, 1, 0], cam.yaw, cam.pitch); return [c0, c1, c2]; }
  function cssVar(n, fb) { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb; } catch (e) { return fb; } }
  function bgRGB() {
    try {
      ctx.fillStyle = cssVar('--bg', '#0f1216'); const s = String(ctx.fillStyle);
      let m = /^#([0-9a-f]{6})$/i.exec(s); if (m) return [0, 2, 4].map(k => parseInt(m[1].slice(k, k + 2), 16) / 255);
      m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s); if (m) return [m[1] / 255, m[2] / 255, m[3] / 255];
    } catch (e) { /* Rückfall */ }
    return [0.06, 0.07, 0.09];
  }

  function makeScene() {
    const c = C(), ex = Math.max(0, num(c.explode, 12));
    const items = [];
    if (G && G.ok) {
      G.parts.forEach(pt => items.push({ v: pt.pos, col: pt.col, d: [0, pt.off[1] * ex, pt.off[2] * ex] }));
      if (c.showPart) items.push({ v: G.joiner, col: [70, 74, 86], d: [0, 0, 0] });
    }
    let n = 0; items.forEach(it => n += it.v.length / 9);
    const data = new Float32Array(n * 27), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let o = 0;
    items.forEach(it => {
      const v = it.v, cl = it.col.map(x => x / 255);
      for (let i = 0; i < v.length; i += 9) {
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
    scene = { data, n: n * 3, lo, hi, c: ok ? lo.map((x, k) => (x + hi[k]) / 2) : [0, 0, 0], R: ok ? Math.max(1, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2) : 1 };
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
      console.warn('Verbinderform: WebGL2 nicht verfügbar, Canvas-2D-Darstellung:', e && e.message);
      gl = null; if (glc && glc.parentNode) glc.parentNode.removeChild(glc); glc = null;
    }
  }
  function viewParams(w, h) {
    const c = pivot || scene.c, s = 0.44 * Math.min(w, h) / scene.R * cam.zoom;
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
      ctx.fillText(G && G.msg ? G.msg : T('Keine Form.'), w / 2, h / 2); ctx.textAlign = 'left';
      return;
    }
    const vp = viewParams(w, h);
    if (gl) {
      const W = Math.round(w * dpr), H = Math.round(h * dpr);
      if (glc.width !== W || glc.height !== H) { glc.width = W; glc.height = H; }
      gl.viewport(0, 0, W, H); gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
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
      gl.uniform1f(glL.uZ, 1 / (scene.R * 3.2 + 1));
      gl.drawArrays(gl.TRIANGLES, 0, glN);
    } else {
      ctx.fillStyle = cssVar('--bg', '#0f1216'); ctx.fillRect(0, 0, w, h);
      const D = scene.data, list = [];
      const Lv = [-0.35, 0.55, 0.75], Ln = Math.hypot(Lv[0], Lv[1], Lv[2]);
      for (let i = 0; i < scene.n; i += 3) {
        const o = i * 9, q = [0, 1, 2].map(k => project([D[o + 9 * k], D[o + 9 * k + 1], D[o + 9 * k + 2]], vp, w, h));
        const M = vp.M, nn = [D[o + 3], D[o + 4], D[o + 5]];
        const ny = M[0][1] * nn[0] + M[1][1] * nn[1] + M[2][1] * nn[2], nz = M[0][2] * nn[0] + M[1][2] * nn[1] + M[2][2] * nn[2], nx = M[0][0] * nn[0] + M[1][0] * nn[1] + M[2][0] * nn[2];
        const k = Math.min(1.08, 0.30 + 0.62 * Math.abs((nx * Lv[0] + ny * Lv[1] + nz * Lv[2]) / Ln) + 0.10 * Math.abs(ny));
        list.push({ q, d: (q[0][2] + q[1][2] + q[2][2]) / 3, c: [D[o + 6], D[o + 7], D[o + 8]].map(x => Math.round(x * 255 * k)) });
      }
      list.sort((a, b) => a.d - b.d);
      list.forEach(f => {
        const s = 'rgb(' + f.c.join(',') + ')';
        ctx.fillStyle = ctx.strokeStyle = window.DrawTheme ? DrawTheme.raw(s) : s;
        ctx.beginPath(); ctx.moveTo(f.q[0][0], f.q[0][1]); ctx.lineTo(f.q[1][0], f.q[1][1]); ctx.lineTo(f.q[2][0], f.q[2][1]); ctx.closePath(); ctx.fill(); ctx.lineWidth = 0.5; ctx.stroke();
      });
    }
    if (pivot && window.ViewCube) { const q = project(pivot, vp, w, h); ViewCube.drawPivot(ctx, q[0], q[1]); }
    if (C().showSec) drawSection(w, h);
  }
  // Querschnitt in der Mitte (zusammengebaut) mit Maßen
  function drawSection(w, h) {
    if (!G || !G.ok) return;
    const bw = Math.min(330, w * 0.42), bh = Math.min(230, h * 0.42), x0 = 10, y0 = h - bh - 46;
    ctx.save();
    ctx.fillStyle = 'rgba(16,20,26,.82)'; ctx.strokeStyle = 'rgba(120,135,150,.6)'; ctx.lineWidth = 1;
    ctx.fillRect(x0, y0, bw, bh); ctx.strokeRect(x0 + 0.5, y0 + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = '#c9d3de'; ctx.font = '12px Segoe UI, sans-serif';
    ctx.fillText(T('Querschnitt in der Mitte'), x0 + 8, y0 + 16);
    let zl = Infinity, zh = -Infinity; G.sec.forEach(s => s.P.forEach(q => { zl = Math.min(zl, q[1]); zh = Math.max(zh, q[1]); }));
    const W = 2 * G.eOut, H = zh - zl, sc = Math.min((bw - 30) / W, (bh - 52) / H);
    const cx = x0 + bw / 2, by = y0 + bh - 22;
    const X = e => cx + e * sc, Y = z => by - (z - zl) * sc;
    G.sec.forEach(s => {
      ctx.beginPath(); s.P.forEach(([e, z], i) => i ? ctx.lineTo(X(e), Y(z)) : ctx.moveTo(X(e), Y(z))); ctx.closePath();
      const c = s.col, fill = 'rgba(' + c.join(',') + ',' + (s.part ? 0.95 : 0.55) + ')';
      ctx.fillStyle = window.DrawTheme ? DrawTheme.raw(fill) : fill; ctx.fill();
      ctx.strokeStyle = s.part ? '#e8edf2' : 'rgba(' + c.join(',') + ',1)'; ctx.lineWidth = 1; ctx.stroke();
    });
    ctx.fillStyle = '#c9d3de'; ctx.font = '11px Segoe UI, sans-serif';
    ctx.fillText(fmt(W) + ' × ' + fmt(H) + ' mm · ' + T('Kanal') + ' ' + fmt(G.Wc) + ' × ' + fmt(G.Hc) + ' mm', x0 + 8, y0 + bh - 6);
    ctx.restore();
  }

  function wire() {
    if (wired) return;
    cv = document.getElementById('cVbf'); if (!cv) return;
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
        const w = cv.clientWidth, h = cv.clientHeight, vp = viewParams(w, h), D = scene.data;
        const pt = ViewCube.pickNear(x, y, cb => { for (let i = 0; i < D.length; i += 9 * 6) cb(D[i], D[i + 1], D[i + 2]); }, (a, b, c) => { const q = project([a, b, c], vp, w, h); return { x: q[0], y: q[1], d: -q[2] }; }, 16);
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
    btn('vbfIso', () => setCam(CAM0.yaw, CAM0.pitch));
    btn('vbfTop', () => setCam(0, Math.PI / 2));
    btn('vbfSide', () => setCam(-Math.PI / 2, 0));   // Seitenansicht = Blick auf die Stirnseite (Querschnitt)
    btn('vbfFront', () => setCam(0, 0));             // Vorderansicht = Blick auf die Längsseite (V-Knick wie am Flugzeug von vorn)
    btn('vbfExport', () => exportAll());
  }
  function resetCam() { Object.assign(cam, CAM0); pivot = null; }
  function home() { resetCam(); draw(); }
  function setCam(y, p) { cam.yaw = y; cam.pitch = p; cam.px = 0; cam.py = 0; cam.zoom = 1; pivot = null; draw(); }

  // =====================================================================================
  //  Info, Export
  // =====================================================================================
  function infoHTML(p) {
    const el = document.getElementById('vbfInfo'); if (!el) return;
    if (!G || !G.ok) { el.innerHTML = '<b>' + T('Verbinderform') + '</b><br>' + (G && G.msg ? G.msg : T('Keine Form.')); return; }
    const L = p.len1 + p.len2, A = G.A, V = A * L / 1000, ph = p.phi / 100;
    const nRov = A * ph * p.rhoF * 1000 / p.tex * (1 + p.over / 100);
    const mF = V * ph * p.rhoF, mR = V * (1 - ph) * 1.15;
    const dims = pt => { const b = bbox(pt.pos); return fmt(b.hi[0] - b.lo[0]) + ' × ' + fmt(b.hi[1] - b.lo[1]) + ' × ' + fmt(b.hi[2] - b.lo[2]) + ' mm'; };
    const sec = p.shape === 'circle' ? 'Ø ' + fmt(p.d) + ' mm' : fmt(p.a) + ' × ' + fmt(p.b) + ' mm (' + T('Sehne × Dicke') + ')';
    let h = '<b>' + T('Verbinderform') + '</b> · ' + T(G.split ? 'dreiteilig' : 'zweiteilig (3D-Druck)') + ' · '
      + T(G.lying ? 'Knick in der Draufsicht' : G.upv ? 'Knick in der Vorderansicht, Form geknickt' : 'Knick in der Vorderansicht, Form außen eben') + '<br>';
    h += T('Steckung') + ': ' + sec + ', ' + T('Länge') + ' ' + fmt(p.len1) + ' + ' + fmt(p.len2) + ' mm';
    h += p.kink > 0 ? ', ' + T('Knick') + ' ' + fmt(p.kink) + '° (' + (p.sharp ? T('scharf') : T('Innenradius') + ' ' + fmt(p.rIn) + ' mm') + ')' : ', ' + T('gerade');
    h += '<br>';
    G.parts.forEach(pt => { h += pt.name + ': ' + dims(pt) + '<br>'; });
    if (G.lat) h += T('Ebene Latte') + ': ' + fmt(2 * G.lat.uL) + ' mm ' + T('breit') + ', ' + fmt(p.latT) + '–' + fmt(p.latT + G.lat.rise) + ' mm ' + T('stark (unten und oben)') + '<br>';
    if (G.nHoles) h += T('Bohrungen') + ': ' + G.nHoles + ' × ' + p.screw + (p.holes === 'nut' ? ' ' + T('mit Sechskant unten') : '') + ', ' + T('Gesamthöhe zusammengebaut') + ' ' + fmt(G.Hges) + ' mm<br>';
    h += T('Querschnittsfläche') + ' ' + fmt(A) + ' mm² · ' + T('Volumen') + ' ' + fmt(V) + ' cm³<br>';
    h += T('Rovings') + ': ' + Math.ceil(nRov) + ' × ' + fmt(p.tex) + ' tex (' + T('inkl.') + ' ' + fmt(p.over) + ' % ' + T('Überfüllung') + '), ' + T('Zuschnitt je') + ' ' + fmt(L + 2 * p.ov + 40) + ' mm<br>';
    h += T('Faser') + ' ≈ ' + fmt(mF) + ' g · ' + T('Harz') + ' ≈ ' + fmt(mR) + ' g · ' + T('Steckung') + ' ≈ ' + fmt(mF + mR) + ' g';
    if (G.topWide > 0.005) h += '<br>' + T('Entformungsschräge: Steckung oben') + ' ' + fmt(G.topWide) + ' mm ' + T('breiter als unten.');
    G.warn.forEach(w => { h += '<br><span style="color:#ffb454">' + w + '</span>'; });
    el.innerHTML = h;
  }
  function fileBase(p) { return 'verbinderform_' + (p.shape === 'circle' ? 'D' + fmt(p.d) : fmt(p.a) + 'x' + fmt(p.b)).replace(/,/g, '-'); }
  async function exportAll() {
    const p = params(C());
    if (!G || !G.ok) { alert(G && G.msg ? G.msg : T('Keine Form.')); return; }
    const base = fileBase(p), list = [];
    let yOff = 0;
    G.parts.forEach(pt => {
      const v = new Float32Array(pt.pos);
      if (pt.flip) for (let i = 0; i < v.length; i += 3) { v[i + 1] = -v[i + 1]; v[i + 2] = -v[i + 2]; }   // 180° um die Längsachse: obere Platte aufs Druckbett
      const b = bbox(v);
      for (let i = 0; i < v.length; i += 3) { v[i] -= b.lo[0]; v[i + 1] += yOff - b.lo[1]; v[i + 2] -= b.lo[2]; }
      yOff += b.hi[1] - b.lo[1] + 10;
      list.push({ name: base + '_' + pt.file + '.stl', v });
    });
    if (App.stlSaveMany) await App.stlSaveMany(list, 'svStl', { name: base + '.3mf' });
    else if (App.download && App.stlBinary) for (const it of list) await App.download(it.name, App.stlBinary(it.v), 'model/stl', 'svStl');
  }

  function refresh() {
    try { G = geometry(params(C())); } catch (e) { console.error(e); G = { ok: false, msg: T('Fehler beim Aufbau der Form:') + ' ' + (e && e.message ? e.message : e), warn: [] }; }
    makeScene();
    infoHTML(params(C()));
    draw();
  }
  function show() { wire(); refresh(); }
  function resize() { draw(); }

  // =====================================================================================
  //  Seitenleiste
  // =====================================================================================
  function vbfSidebar(side) {
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

    // ---- Steckung ----
    const g1 = grp('Steckung', true, TAB, { key: 'vbfMain' });
    hint(g1.body, 'Alle Werte der Steckung sind frei einstellbar. „Übernehmen“ füllt sie einmalig aus Formenbau, Steghöhen bzw. Tragfläche vor — danach lässt sich alles weiter ändern.');
    SEL(g1.body, 'Querschnitt', [['rect', 'Vierkant (Flachsteckung)'], ['circle', 'Rund']], 'shape', true);
    if (p.shape === 'rect') {
      N(g1.body, 'Breite in Sehnenrichtung (mm)', 'a', { step: 0.1, min: 0.5 });
      N(g1.body, 'Höhe in Dickenrichtung (mm)', 'b', { step: 0.1, min: 0.5, hint: 'Dickenrichtung = Richtung der Profildicke; in dieser Richtung liegt der V-Knick.' });
    } else N(g1.body, 'Durchmesser (mm)', 'd', { step: 0.1, min: 0.5 });
    N(g1.body, 'Länge Seite 1 ab Mitte (mm)', 'len1', { step: 5, min: 1 });
    N(g1.body, 'Länge Seite 2 ab Mitte (mm)', 'len2', { step: 5, min: 1 });
    const src = sources();
    if (src.length) {
      subhead(g1.body, 'Werte übernehmen');
      if (!src.some(s => s.id === c.pick)) c.pick = src[0].id;
      selectRow(g1.body, 'Quelle', src.map(s => [s.id, s.label]), () => c.pick, v => { c.pick = v; }, null);
      button(g1.body, 'Übernehmen', () => {
        const s = sources().find(q => q.id === c.pick); if (!s) return;
        const txt = s.apply(c); if (App.toast) App.toast(T('Übernommen:') + ' ' + txt);
        RB();
      }, 'Querschnitt (und V-Winkel der Stelle) einmalig in die eigenen Werte kopieren. Die Längen bleiben, außer bei Steghöhen (Einbindetiefe).');
    } else hint(g1.body, 'Zum Übernehmen: im Formenbau „Ausnehmungen für die Steckung“ einschalten oder in „Steghöhen“ eine Steckung vorsehen.');

    // ---- V-Form ----
    const g2 = grp('V-Form (Knick in der Mitte)', false, TAB, { key: 'vbfV' });
    N(g2.body, 'Knickwinkel gesamt (°)', 'vDeg', { step: 0.5, min: 0, max: 60, hint: 'Winkel zwischen den beiden Hälften = V-Form links + rechts. 0 = gerade Steckung.' });
    SEL(g2.body, 'Knick', [['sharp', 'Scharf (ohne Ausrundung)'], ['round', 'Ausgerundet (Innenradius)']], 'kinkShape', true,
      'Scharf: beide Hälften stoßen innen und außen in einer Kante zusammen. Ausgerundet: innen mit dem Innenradius, außen mit Innenradius + Dicke.');
    if (c.kinkShape === 'round') N(g2.body, 'Innenradius am Knick (mm)', 'rIn', { step: 1, min: 0, hint: 'Radius der inneren (hohlen) Seite am Knick.' });
    if (App.wing && App.wing.stations) {
      const vp = vPicks(); if (!vp.some(q => q[0] === c.vPick)) c.vPick = 'root';
      selectRow(g2.body, 'Stelle in der Tragfläche', vp, () => c.vPick, v => { c.vPick = v; RB(); }, null);
      button(g2.body, T('V-Form übernehmen') + ' (' + fmt(kinkAt(c.vPick)) + '°)', () => { c.vDeg = Math.round(kinkAt(c.vPick) * 100) / 100; RB(); },
        'Knickwinkel aus dem Tragflächendesign (V-Form der Segmente) eintragen.');
    }

    // ---- Form ----
    const g3 = grp('Aufbau und Wandstärken', false, TAB, { key: 'vbfForm' });
    SEL(g3.body, 'Aufbau', [['print2', 'Zweiteilig für 3D-Druck (Unterteil mit Seitenwänden, Stempel mit Zunge)'], ['split3', 'Dreiteilig (Grundplatte, 2 Seitenleisten, Stempel)']], 'build', true,
      'Zweiteilig: Unterteil = untere Platte und beide Seitenwände in einem Stück, Stempel = obere Platte und Zunge in einem Stück. Dreiteilig: Seitenleisten abschraubbar, die Steckung wird seitlich entformt.');
    SEL(g3.body, 'V-Knick der Form', [['flat', 'In der Draufsicht (Form liegt flach)'], ['upv', 'In der Vorderansicht — Unterteil und Stempel geknickt'], ['up', 'In der Vorderansicht — Unter- und Oberseite eben']], 'orient', false,
      'Draufsicht: Dickenrichtung waagrecht, die Form ist von oben gesehen geknickt; die stark belasteten Ober- und Unterseiten der Steckung entstehen an den glatten Kanalwänden. Vorderansicht: Dickenrichtung senkrecht wie in der Tragfläche, der Knick ist von vorn zu sehen — wahlweise sind Unterteil und Stempel selbst geknickt (Wandstärke überall mindestens wie eingestellt, für den 3D-Druck mit Stützstruktur) oder unten und oben eben (Knick nur im Kanal).');
    if (p.orient === 'upv') {
      boolRow(g3.body, 'Ebene Latte unten und oben (V-Form ausgeglichen)', () => !!c.latte, v => { c.latte = v; RB(); },
        'Unter das Unterteil (bzw. die Grundplatte) und auf den Stempel kommt je eine ebene Latte, die den Knick ausgleicht: Die Form steht eben auf, liegt eben auf dem Druckbett und lässt sich eben pressen.');
      if (c.latte) {
        N(g3.body, 'Breite der Latte (mm, 0 = ganze Breite)', 'latW', { step: 1, min: 0, hint: 'Mittig unter bzw. auf der Form, mindestens Kanalbreite + 2 mm. Schneidet die Kante eine Bohrung, rückt sie daneben.' });
        N(g3.body, 'Stärke der Latte an der dünnsten Stelle (mm)', 'latT', { step: 0.5, min: 0.4 });
      }
    }
    N(g3.body, 'Wandstärke untere Platte (mm)', 'tBot', { step: 0.5, min: 0.4, hint: 'Unter dem tiefsten Punkt des Kanals.' });
    N(g3.body, 'Wandstärke obere Platte (mm)', 'tTop', { step: 0.5, min: 0.4, hint: 'Platte des Stempels über den Seitenwänden.' });
    N(g3.body, 'Wandstärke Seitenwand (mm)', 'tSide', { step: 0.5, min: 0.8, hint: 'Von der Kanalkante oben bis zur Außenseite; die Schrauben sitzen in der Mitte der Wand.' });
    N(g3.body, 'Führungshöhe der Zunge (mm)', 'guide', { step: 0.5, min: 0.5, hint: 'So weit ragen die Seitenwände über die fertige Steckung. Der überfüllte Roving-Strang steht vor dem Pressen darüber hinaus — die Zunge muss schon im Kanal geführt sein.' });
    N(g3.body, 'Spiel der Zunge je Seite (mm)', 'clr', { step: 0.05, min: 0, hint: 'Durch diesen Spalt entweicht das überschüssige Harz. Für 3D-Druck etwa 0,1–0,2 mm.' });
    N(g3.body, 'Überlänge je Ende (mm)', 'ov', { step: 1, min: 0, hint: 'Der Kanal ist an den Enden offen; die Rovings werden straff durchgezogen und die harzreichen Enden später abgesägt.' });
    if (p.build === 'print2') N(g3.body, 'Entformungsschräge Kanal (°)', 'draft', { step: 0.5, min: 0, max: 10, hint: 'Kanalwände öffnen sich nach oben, damit die Steckung aus dem einteiligen Unterteil geht. 0 = senkrechte Wände.' });
    subhead(g3.body, 'Überlaufnut');
    N(g3.body, 'Breite (mm, 0 = keine)', 'grvW', { step: 0.5, min: 0, hint: 'Nut oben in der Seitenwand neben dem Kanal, nimmt das ausgepresste Harz auf.' });
    if (p.grvW > 0) { N(g3.body, 'Tiefe (mm)', 'grvD', { step: 0.5, min: 0 }); N(g3.body, 'Abstand zum Kanal (mm)', 'grvOff', { step: 0.5, min: 0 }); }

    // ---- Verschraubung ----
    const g4 = grp('Verschraubung', false, TAB, { key: 'vbfScrew' });
    SEL(g4.body, 'Schrauben', [['nut', 'Durchgang + Sechskant-Mutter unten eingelassen'], ['thru', 'Nur Durchgangsbohrung'], ['none', 'Keine (Schraubzwingen)']], 'holes', true);
    if (p.holes !== 'none') {
      SEL(g4.body, 'Gewinde', Object.keys(SCREWS).map(k => [k, k]), 'screw', false);
      N(g4.body, 'Abstand der Schrauben (mm)', 'pitch', { step: 5, min: 5 });
      N(g4.body, 'Randabstand an den Enden (mm)', 'edge', { step: 1, min: 0 });
    }

    // ---- Faserbedarf ----
    const g5 = grp('Faserbedarf (UD-Rovings)', false, TAB, { key: 'vbfFib' });
    N(g5.body, 'Roving-Feinheit (tex)', 'tex', { step: 100, min: 1, hint: '12K ≈ 800 tex, 24K ≈ 1600 tex, 48–50K ≈ 3200–3700 tex (Datenblatt).' });
    N(g5.body, 'Faservolumenanteil (%)', 'phi', { step: 1, min: 1, max: 90, hint: 'Gepresst in geschlossener Form etwa 55–60 %.' });
    N(g5.body, 'Faserdichte (g/cm³)', 'rhoF', { step: 0.01, min: 0.1 });
    N(g5.body, 'Überfüllung (%)', 'over', { step: 1, min: 0, hint: 'Etwas mehr Fasern einlegen, als rechnerisch hineinpasst; der Überschuss wird beim Schließen ausgepresst.' });

    // ---- Ansicht und Export ----
    const g6 = grp('Ansicht und Export', false, TAB, { key: 'vbfView' });
    N(g6.body, 'Teile auseinanderziehen (mm)', 'explode', { step: 2, min: 0 });
    boolRow(g6.body, 'Steckung zeigen', () => !!c.showPart, v => { c.showPart = v; RD(); });
    boolRow(g6.body, 'Querschnitt einblenden', () => !!c.showSec, v => { c.showSec = v; RD(); });
    button(g6.body, 'STL / 3MF exportieren …', () => exportAll(), 'Alle Teile in Druckposition: Unterteil bzw. Grundplatte mit der Unterseite, Stempel mit der Oberseite auf dem Druckbett.');
    [g1, g2, g3, g4, g5, g6].forEach(g => side.appendChild(g.g));
  }

  App.vbfSidebar = vbfSidebar;
  window.Verbinder = { show, refresh, resize, _test: { geometry, params, DEF, signedVolume, bbox, sources, kinkAt } };
})();
