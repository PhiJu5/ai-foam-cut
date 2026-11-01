/* decals_design.js — Lackier-Designs für den Reiter „Decals" (Funktion „decals"), die der FORM des
 * Bauteils folgen statt als ebenes Motiv aufgelegt zu werden. Vorbilder: Werksdesigns von Segelflugzeugen
 * (Zierlinie unter der Haube, „Schnurrbart" an der Nase, Regenbogen-Bänder der 70er wie an der ASW 17,
 * Nasenkappe, Blendschutz, Haubenrahmen, zweifarbige Unterseite, Warnfelder und Streifen am Randbogen).
 *
 *  Rumpf (FUS):   build(p, ctx) -> Gruppen [{ name?, at?, layers: [{ c, rings, view? }] }]
 *                 Ringe in Rumpfparametern [x, tau]: x = Längslage (mm), tau = Umfangsanteil ab der
 *                 Rückenlinie (0 = oben, +0,5 = Bauchlinie über die linke Seite, −0,5 über die rechte).
 *                 ctx = { x0, x1, L, G(x) Umfang, tauH(x, h) Umfangsanteil in Höhe h (0 = unten … 1 = oben) }
 *                 Jede Gruppe wird für die Ausgabe gemeinsam abgewickelt (at = Leitlinie, sonst Mittelwert).
 *  Tragfläche (WING): build(p, st) -> Ebenen in Grundrisskoordinaten (x = Spannweite, y = −Tiefe),
 *                 st = Stationen [{ y, le, c }] der Halbspannweite.
 *  Farbverläufe sind Stufen zwischen zwei Farben: viele Stufen = Verlauf für den Druck, wenige = Folienbänder.
 *
 * Keine Abhängigkeit von App — die Datei läuft auch in Node (Tests).
 */
(function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rgb = h => { const n = parseInt(String(h).replace('#', ''), 16) || 0; return [n >> 16, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
  // n Farben von c1 nach c2 (n = 1: c1).
  const grad = (c1, c2, n) => { const o = []; for (let k = 0; k < n; k++) o.push(n > 1 ? mix(c1, c2, k / (n - 1)) : c1); return o; };
  // Parabel durch drei Werte bei t = 0 / 0,5 / 1.
  const q3 = (a, m, b, t) => a * (1 - t) * (1 - 2 * t) + m * 4 * t * (1 - t) + b * t * (2 * t - 1);
  const N = v => +v || 0;

  // ---------- Rumpf ---------------------------------------------------------------------------
  // Band entlang des Rumpfs auf einer Seite: Mittellinie in Höhe h(t), Breite w(t) (mm, im Umfang), n Teilbänder.
  function sideBands(p, ctx, sign) {
    const xa = ctx.x0 + ctx.L * clamp(N(p.xa), 0, 100) / 100, xb = ctx.x0 + ctx.L * clamp(N(p.xb), 0, 100) / 100, n = clamp(Math.round(N(p.n) || 1), 1, 60), M = 90;
    const cols = grad(p.c1, p.c2, n), layers = [], gap = clamp(N(p.gap), 0, 90) / 100;
    if (!(xb > xa)) return layers;
    const S = []; for (let i = 0; i <= M; i++) { const t = i / M, x = xa + (xb - xa) * t, G = ctx.G(x); S.push({ x, tc: ctx.tauH(x, clamp(q3(N(p.h0), N(p.hm), N(p.h1), t), 0, 100) / 100), w: G > 1e-6 ? Math.max(0, q3(N(p.w0), N(p.wm), N(p.w1), t)) / G : 0 }); }
    for (let k = 0; k < n; k++) {
      const o0 = -0.5 + k / n, o1 = -0.5 + (k + 1 - gap) / n, up = [], lo = [];
      S.forEach(s => { up.push([s.x, sign * clamp(s.tc + o0 * s.w, 0, 0.5)]); lo.push([s.x, sign * clamp(s.tc + o1 * s.w, 0, 0.5)]); });
      layers.push({ c: cols[k], rings: [up.concat(lo.reverse())] });
    }
    return layers;
  }
  const sides = (p, ctx, fn) => { const g = []; if (p.side !== 'right') g.push({ name: 'L', layers: fn(1) }); if (p.side !== 'left') g.push({ name: 'R', layers: fn(-1) }); return g; };
  const STRIPE = [
    { k: 'xa', n: 'Beginn (% der Rumpflänge)', t: 'num', d: 3, min: 0, max: 100, step: 1 }, { k: 'xb', n: 'Ende (% der Rumpflänge)', t: 'num', d: 96, min: 0, max: 100, step: 1 },
    { k: 'h0', n: 'Höhe am Beginn (% der Rumpfhöhe)', t: 'num', d: 50, min: 0, max: 100, step: 2 }, { k: 'hm', n: 'Höhe in der Mitte (%)', t: 'num', d: 50, min: -50, max: 150, step: 2 }, { k: 'h1', n: 'Höhe am Ende (%)', t: 'num', d: 50, min: 0, max: 100, step: 2 },
    { k: 'w0', n: 'Breite am Beginn (mm)', t: 'num', d: 12, min: 0, max: 2000, step: 1 }, { k: 'wm', n: 'Breite in der Mitte (mm)', t: 'num', d: 12, min: -500, max: 2000, step: 1 }, { k: 'w1', n: 'Breite am Ende (mm)', t: 'num', d: 12, min: 0, max: 2000, step: 1 },
    { k: 'n', n: 'Bänder / Verlaufsstufen', t: 'num', d: 1, min: 1, max: 60, step: 1 }, { k: 'gap', n: 'Lücke zwischen den Bändern (%)', t: 'num', d: 0, min: 0, max: 90, step: 5 },
    { k: 'c1', n: 'Farbe oben', t: 'col', d: '#c8102e' }, { k: 'c2', n: 'Farbe unten', t: 'col', d: '#ffd100' },
    { k: 'side', n: 'Seiten', t: 'sel', d: 'both', o: [['both', 'beide Seiten'], ['left', 'nur links'], ['right', 'nur rechts']] }];
  const FUS = [
    { id: 'stripe', name: 'Zierlinie / Bänder entlang des Rumpfs', params: STRIPE, build: (p, ctx) => sides(p, ctx, s => sideBands(p, ctx, s)) },
    { id: 'nose', name: 'Nasenkappe', params: [
      { k: 'len', n: 'Länge (% der Rumpflänge)', t: 'num', d: 7, min: 0.5, max: 100, step: 0.5 }, { k: 'slant', n: 'Schräge: oben weiter hinten (% der Rumpflänge)', t: 'num', d: 0, min: -40, max: 40, step: 0.5 },
      { k: 'spike', n: 'Spitze an den Seiten (% der Rumpflänge)', t: 'num', d: 0, min: 0, max: 60, step: 1 }, { k: 'n', n: 'Bänder / Verlaufsstufen', t: 'num', d: 1, min: 1, max: 60, step: 1 },
      { k: 'c1', n: 'Farbe vorn', t: 'col', d: '#c8102e' }, { k: 'c2', n: 'Farbe hinten', t: 'col', d: '#ffd100' }],
      build: (p, ctx) => {
        const n = clamp(Math.round(N(p.n) || 1), 1, 60), M = 64, cols = grad(p.c1, p.c2, n), layers = [];
        const xe = tau => clamp(ctx.x0 + ctx.L * (N(p.len) + N(p.slant) * Math.cos(2 * Math.PI * tau) + N(p.spike) * Math.max(0, 1 - Math.abs(Math.abs(tau) - 0.25) / 0.09)) / 100, ctx.x0, ctx.x1);
        for (let k = 0; k < n; k++) {
          const a = [], b = [];
          for (let i = 0; i <= M; i++) { const tau = -0.5 + i / M, e = xe(tau); a.push([ctx.x0 + (e - ctx.x0) * (k + 1) / n, tau]); b.push([ctx.x0 + (e - ctx.x0) * k / n, tau]); }
          layers.push({ c: cols[k], rings: [a.concat(b.reverse())] });
        }
        return [{ layers }];
      } },
    { id: 'rings', name: 'Rumpfbänder (Ringe um den Rumpf)', params: [
      { k: 'pos', n: 'Lage des ersten Bands (% der Rumpflänge)', t: 'num', d: 70, min: 0, max: 100, step: 1 }, { k: 'w', n: 'Bandbreite (mm)', t: 'num', d: 20, min: 1, max: 2000, step: 1 },
      { k: 'n', n: 'Anzahl', t: 'num', d: 3, min: 1, max: 60, step: 1 }, { k: 'gap', n: 'Abstand (mm)', t: 'num', d: 8, min: 0, max: 500, step: 1 },
      { k: 'c1', n: 'Farbe vorn', t: 'col', d: '#ffd100' }, { k: 'c2', n: 'Farbe hinten', t: 'col', d: '#c8102e' }],
      build: (p, ctx) => {
        const n = clamp(Math.round(N(p.n) || 1), 1, 60), cols = grad(p.c1, p.c2, n), layers = [], w = Math.max(1, N(p.w));
        for (let k = 0; k < n; k++) { const xa = ctx.x0 + ctx.L * N(p.pos) / 100 + k * (w + N(p.gap)), xb = Math.min(ctx.x1, xa + w); if (xa < ctx.x1) layers.push({ c: cols[k], rings: [[[xa, -0.5], [xb, -0.5], [xb, 0.5], [xa, 0.5]]] }); }
        return [{ layers }];
      } },
    { id: 'antiglare', name: 'Blendschutz vor der Haube', params: [
      { k: 'xa', n: 'Beginn (% der Rumpflänge)', t: 'num', d: 1, min: 0, max: 100, step: 0.5 }, { k: 'xb', n: 'Ende (% der Rumpflänge)', t: 'num', d: 14, min: 0, max: 100, step: 0.5 },
      { k: 'w', n: 'Breite (% des Umfangs)', t: 'num', d: 30, min: 2, max: 100, step: 1 }, { k: 'round', n: 'hinten ausgerundet', t: 'bool', d: true }, { k: 'c1', n: 'Farbe', t: 'col', d: '#1c1c1c' }],
      build: (p, ctx) => {
        const xa = ctx.x0 + ctx.L * N(p.xa) / 100, xb = ctx.x0 + ctx.L * N(p.xb) / 100, M = 60, a = [], b = [], hw = clamp(N(p.w), 2, 100) / 200;
        if (!(xb > xa)) return [];
        for (let i = 0; i <= M; i++) { const t = i / M, x = xa + (xb - xa) * t, r = p.round && t > 0.6 ? Math.sqrt(Math.max(0, 1 - ((t - 0.6) / 0.4) ** 2)) : 1; a.push([x, hw * r]); b.push([x, -hw * r]); }
        return [{ at: 0, layers: [{ c: p.c1, rings: [a.concat(b.reverse())] }] }];
      } },
    { id: 'canopy', name: 'Kabinenhaube mit Rahmen', params: [
      { k: 'xc', n: 'Mitte (% der Rumpflänge)', t: 'num', d: 24, min: 0, max: 100, step: 0.5 }, { k: 'len', n: 'Länge (% der Rumpflänge)', t: 'num', d: 24, min: 2, max: 100, step: 0.5 },
      { k: 'w', n: 'Breite (% des Umfangs)', t: 'num', d: 46, min: 5, max: 100, step: 1 }, { k: 'frame', n: 'Rahmenbreite (mm)', t: 'num', d: 8, min: 0, max: 200, step: 1 },
      { k: 'pow', n: 'Form: 2 = Ellipse … 4 = eckig', t: 'num', d: 2.6, min: 1.5, max: 6, step: 0.1 }, { k: 'glass', n: 'Verglasung darstellen (nur Ansicht)', t: 'bool', d: true },
      { k: 'c1', n: 'Farbe des Rahmens', t: 'col', d: '#1c1c1c' }, { k: 'c2', n: 'Farbe der Verglasung', t: 'col', d: '#8fb8d6' }],
      build: (p, ctx) => {
        const xc = ctx.x0 + ctx.L * N(p.xc) / 100, a = ctx.L * N(p.len) / 200, b = clamp(N(p.w), 5, 100) / 200, e = 2 / clamp(N(p.pow) || 2.6, 1.5, 6), G = ctx.G(xc) || 1, fr = Math.max(0, N(p.frame));
        const sup = (ra, rb) => { const o = []; for (let i = 0; i < 96; i++) { const th = 2 * Math.PI * i / 96, c = Math.cos(th), s = Math.sin(th); o.push([clamp(xc + ra * Math.sign(c) * Math.abs(c) ** e, ctx.x0, ctx.x1), rb * Math.sign(s) * Math.abs(s) ** e]); } return o; };
        const outer = sup(a, b), inner = sup(Math.max(1, a - fr), Math.max(0.005, b - fr / G)), layers = [];
        if (p.glass) layers.push({ c: p.c2, view: true, rings: [inner] });
        if (fr > 0) layers.push({ c: p.c1, rings: [outer, inner] });
        return [{ at: 0, layers }];
      } },
    { id: 'belly', name: 'Zweifarbig: Unterseite farbig', params: [
      { k: 'xa', n: 'Beginn (% der Rumpflänge)', t: 'num', d: 0, min: 0, max: 100, step: 1 }, { k: 'xb', n: 'Ende (% der Rumpflänge)', t: 'num', d: 100, min: 0, max: 100, step: 1 },
      { k: 'h0', n: 'Trennlinie am Beginn (% der Rumpfhöhe)', t: 'num', d: 45, min: 0, max: 100, step: 2 }, { k: 'hm', n: 'Trennlinie in der Mitte (%)', t: 'num', d: 35, min: -50, max: 150, step: 2 }, { k: 'h1', n: 'Trennlinie am Ende (%)', t: 'num', d: 45, min: 0, max: 100, step: 2 },
      { k: 'c1', n: 'Farbe', t: 'col', d: '#1f4e9c' }],
      build: (p, ctx) => {
        const xa = ctx.x0 + ctx.L * N(p.xa) / 100, xb = ctx.x0 + ctx.L * N(p.xb) / 100, M = 90, a = [], b = [];
        if (!(xb > xa)) return [];
        for (let i = 0; i <= M; i++) { const t = i / M, x = xa + (xb - xa) * t; a.push([x, ctx.tauH(x, clamp(q3(N(p.h0), N(p.hm), N(p.h1), t), 0, 100) / 100)]); b.push([x, 0.5]); }
        const L = a.concat(b.reverse());
        return [{ at: 0.5, layers: [{ c: p.c1, rings: [L, L.map(q => [q[0], -q[1]])] }] }];
      } }
  ];

  // ---------- Tragfläche ----------------------------------------------------------------------
  function planAt(st, Y) {
    let k = 0; while (k < st.length - 2 && st[k + 1].y < Y) k++;
    const a = st[k], b = st[Math.min(st.length - 1, k + 1)], d = b.y - a.y, t = d > 1e-9 ? clamp((Y - a.y) / d, 0, 1) : 0;
    return { le: a.le + (b.le - a.le) * t, c: a.c + (b.c - a.c) * t };
  }
  // Ring an einem konvexen Ring (gegen den Uhrzeigersinn) beschneiden (Sutherland–Hodgman).
  function clipConvex(ring, clip) {
    let out = ring;
    for (let i = 0; i < clip.length && out.length; i++) {
      const a = clip[i], b = clip[(i + 1) % clip.length], f = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]), inp = out; out = [];
      for (let k = 0; k < inp.length; k++) { const p = inp[k], q = inp[(k + 1) % inp.length], fp = f(p), fq = f(q); if (fp >= 0) out.push(p); if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); } }
    }
    return out;
  }
  // Flügelfelder (je Segment ein Trapez, gegen den Uhrzeigersinn) im Spannweitenbereich ya … yb.
  function panels(st, ya, yb) {
    const out = [];
    for (let k = 0; k < st.length - 1; k++) {
      const y0 = Math.max(ya, st[k].y), y1 = Math.min(yb, st[k + 1].y); if (!(y1 > y0 + 1e-6)) continue;
      const a = planAt(st, y0), b = planAt(st, y1);
      out.push([[y0, -(a.le + a.c)], [y1, -(b.le + b.c)], [y1, -b.le], [y0, -a.le]]);
    }
    return out;
  }
  // Konvexe Formen auf den Flügel beschneiden und auf die gewählten Hälften legen.
  function onWing(st, p, shapes) {
    const B = st[st.length - 1].y, P = panels(st, B * clamp(N(p.y0), 0, 100) / 100, B * clamp(N(p.y1 == null ? 100 : p.y1), 0, 100) / 100), rings = [];
    shapes.forEach(S => P.forEach(pn => { const r = clipConvex(S, pn); if (r.length > 2) { if (p.side !== 'left') rings.push(r); if (p.side !== 'right') rings.push(r.map(q => [-q[0], q[1]])); } }));
    return rings;
  }
  const WSPAN = [{ k: 'y0', n: 'von (% der Halbspannweite)', t: 'num', d: 0, min: 0, max: 100, step: 1 }, { k: 'y1', n: 'bis (% der Halbspannweite)', t: 'num', d: 100, min: 0, max: 100, step: 1 }];
  const WSIDE = { k: 'side', n: 'Hälften', t: 'sel', d: 'both', o: [['both', 'beide Hälften'], ['left', 'nur links'], ['right', 'nur rechts']] };
  // Vorgaben der Keile [von, bis, Farbe] — die ersten beiden wie am Original (blau breit, rot schmal)
  const WEDGE = [[62, 140, '#1f4fb4'], [20, 32, '#e0242b'], [150, 172, '#e0242b'], [42, 52, '#1f4fb4'], [182, 196, '#1f4fb4'], [6, 12, '#e0242b'], [146, 149, '#1f4fb4'], [56, 60, '#e0242b']];
  const WING = [
    // Keile vom Flügelansatz (Pilatus B4): Anzahl wählbar; je Keil zwei Kanten vom Ursprung zu einem Zielpunkt am Flügelrand.
    // Zielwert 0 … 100 = Endleiste von der Wurzel bis zum Randbogen, 100 … 200 = Randbogen von der Endleiste zur Nase.
    { id: 'wwedge', name: 'Keile vom Flügelansatz (Pilatus B4)', params: [
      { k: 'ox', n: 'Ursprung: Spannweite (% der Halbspannweite)', t: 'num', d: 0, min: -50, max: 100, step: 1 }, { k: 'oc', n: 'Ursprung: Tiefe (% ab Nase)', t: 'num', d: 0, min: -200, max: 300, step: 5 },
      { k: 'n', n: 'Anzahl der Keile', t: 'num', d: 2, min: 1, max: 8, step: 1, rb: true }].concat([].concat.apply([], WEDGE.map((w, i) => [
        { k: 'a' + (i + 1), n: 'Keil ' + (i + 1) + ' von (Ziel am Rand, 0–200)', t: 'num', d: w[0], min: 0, max: 200, step: 2, show: p => i < (+p.n || 2) },
        { k: 'b' + (i + 1), n: 'Keil ' + (i + 1) + ' bis', t: 'num', d: w[1], min: 0, max: 200, step: 2, show: p => i < (+p.n || 2) },
        { k: 'c' + (i + 1), n: 'Farbe Keil ' + (i + 1), t: 'col', d: w[2], show: p => i < (+p.n || 2) }])), [WSIDE]),
      build: (p, st) => {
        const B = st[st.length - 1].y, r0 = planAt(st, 0), tp = planAt(st, B), O = [B * N(p.ox) / 100, -(r0.le + r0.c * N(p.oc) / 100)], layers = [], q = { y0: 0, y1: 100, side: p.side };
        const tgt = v => { v = clamp(N(v), 0, 200); if (v <= 100) { const Y = B * v / 100, s = planAt(st, Y); return [Y, -(s.le + s.c)]; } return [B, -(tp.le + tp.c * (1 - (v - 100) / 100))]; };
        const far = v => { const t = tgt(v), dx = t[0] - O[0], dy = t[1] - O[1], l = Math.hypot(dx, dy) || 1, k = (3 * B + 2000) / l; return [O[0] + dx * k, O[1] + dy * k]; };
        for (let i = 1; i <= clamp(Math.round(N(p.n) || 2), 1, 8); i++) {
          const v0 = N(p['a' + i]), v1 = N(p['b' + i]); if (Math.abs(v1 - v0) < 0.5) continue;
          let tri = [O, far(Math.min(v0, v1)), far(Math.max(v0, v1))];
          if ((tri[1][0] - O[0]) * (tri[2][1] - O[1]) - (tri[1][1] - O[1]) * (tri[2][0] - O[0]) < 0) tri = [tri[0], tri[2], tri[1]];
          const rings = onWing(st, q, [tri]); if (rings.length) layers.push({ c: p['c' + i], rings });
        }
        return layers;
      } },
    { id: 'wrays', name: 'Sonnenstrahlen über die Fläche (Kunstflug)', params: WSPAN.concat([
      { k: 'n', n: 'Strahlen', t: 'num', d: 7, min: 2, max: 40, step: 1 }, { k: 'ox', n: 'Ursprung: Spannweite (% der Halbspannweite)', t: 'num', d: 0, min: -50, max: 100, step: 1 }, { k: 'oc', n: 'Ursprung: Tiefe (% ab Nase)', t: 'num', d: 50, min: -200, max: 300, step: 5 },
      { k: 'fan', n: 'Fächerwinkel (°)', t: 'num', d: 70, min: 5, max: 180, step: 5 }, { k: 'duty', n: 'Strahlbreite (% der Teilung)', t: 'num', d: 50, min: 5, max: 95, step: 5 },
      { k: 'c1', n: 'Farbe innen / vorn', t: 'col', d: '#d4213d' }, { k: 'c2', n: 'Farbe außen / hinten', t: 'col', d: '#d4213d' }, WSIDE]),
      build: (p, st) => {
        const B = st[st.length - 1].y, r0 = planAt(st, 0), n = clamp(Math.round(N(p.n) || 7), 2, 40), fan = clamp(N(p.fan), 5, 180) * Math.PI / 180, duty = clamp(N(p.duty), 5, 95) / 100, cols = grad(p.c1, p.c2, n);
        const O = [B * N(p.ox) / 100, -(r0.le + r0.c * N(p.oc) / 100)], far = 3 * B + 2000, layers = [];
        for (let k = 0; k < n; k++) {
          const a0 = -fan / 2 + fan * k / n, a1 = a0 + fan / n * duty, tri = [O, [O[0] + far * Math.cos(a0), O[1] + far * Math.sin(a0)], [O[0] + far * Math.cos(a1), O[1] + far * Math.sin(a1)]];
          const rings = onWing(st, p, [tri]); if (rings.length) layers.push({ c: cols[k], rings });
        }
        return layers;
      } },
    { id: 'wdiag', name: 'Schräge Streifen (Kunstflug, Pilatus B4)', params: WSPAN.concat([
      { k: 'n', n: 'Streifen', t: 'num', d: 3, min: 1, max: 40, step: 1 }, { k: 'w', n: 'Streifenbreite (mm)', t: 'num', d: 60, min: 2, max: 2000, step: 5 }, { k: 'gap', n: 'Abstand (mm)', t: 'num', d: 30, min: 0, max: 2000, step: 5 },
      { k: 'pos', n: 'Lage des ersten Streifens (% der Halbspannweite)', t: 'num', d: 55, min: -50, max: 150, step: 1 }, { k: 'ang', n: 'Schräge (°, 0 = in Flugrichtung)', t: 'num', d: 30, min: -80, max: 80, step: 5 },
      { k: 'c1', n: 'Farbe innen / vorn', t: 'col', d: '#d4213d' }, { k: 'c2', n: 'Farbe außen / hinten', t: 'col', d: '#ffc400' }, WSIDE]),
      build: (p, st) => {
        const B = st[st.length - 1].y, n = clamp(Math.round(N(p.n) || 3), 1, 40), w = Math.max(2, N(p.w)), cols = grad(p.c1, p.c2, n), tn = Math.tan(clamp(N(p.ang), -80, 80) * Math.PI / 180), far = 20000, layers = [];
        for (let k = 0; k < n; k++) {
          const x0 = B * N(p.pos) / 100 + k * (w + Math.max(0, N(p.gap))), x1 = x0 + w;      // Lage an der Nasenleiste der Wurzel (y = 0); nach hinten um tan(Schräge) nach außen versetzt
          const S = [[x0 - tn * far, far], [x0 + tn * far, -far], [x1 + tn * far, -far], [x1 - tn * far, far]];
          const rings = onWing(st, p, [S]); if (rings.length) layers.push({ c: cols[k], rings });
        }
        return layers;
      } },
    { id: 'wchecker', name: 'Schachbrett über die Fläche', params: [{ k: 'y0', n: 'von (% der Halbspannweite)', t: 'num', d: 70, min: 0, max: 100, step: 1 }, { k: 'y1', n: 'bis (% der Halbspannweite)', t: 'num', d: 100, min: 0, max: 100, step: 1 },
      { k: 'cell', n: 'Feldgröße (mm)', t: 'num', d: 50, min: 5, max: 1000, step: 5 }, { k: 'c1', n: 'Farbe 1', t: 'col', d: '#111111' }, { k: 'c2', n: 'Farbe 2', t: 'col', d: '#ffffff' }, WSIDE],
      build: (p, st) => {
        const B = st[st.length - 1].y, cs = Math.max(5, N(p.cell)), ya = B * clamp(N(p.y0), 0, 100) / 100, yb = B * clamp(N(p.y1), 0, 100) / 100, A = [], C = [];
        let ymin = 0, ymax = 0; st.forEach(s => { ymin = Math.min(ymin, -(s.le + s.c)); ymax = Math.max(ymax, -s.le); });
        if ((yb - ya) / cs * (ymax - ymin) / cs > 6000) return [];
        for (let i = 0; ya + i * cs < yb; i++) for (let j = 0; ymax - j * cs > ymin; j++) { const x = ya + i * cs, y = ymax - j * cs; ((i + j) % 2 ? C : A).push([[x, y - cs], [x + cs, y - cs], [x + cs, y], [x, y]]); }
        return [{ c: p.c1, rings: onWing(st, p, A) }, { c: p.c2, rings: onWing(st, p, C) }].filter(l => l.rings.length);
      } },
    { id: 'wband', name: 'Bänder / Warnfeld (folgt dem Flügelumriss)', params: [
      { k: 'y0', n: 'von (% der Halbspannweite)', t: 'num', d: 88, min: 0, max: 100, step: 1 }, { k: 'y1', n: 'bis (% der Halbspannweite)', t: 'num', d: 100, min: 0, max: 100, step: 1 },
      { k: 'f0', n: 'Tiefe von (% ab Nase)', t: 'num', d: 0, min: 0, max: 100, step: 5 }, { k: 'f1', n: 'Tiefe bis (% ab Nase)', t: 'num', d: 100, min: 0, max: 100, step: 5 },
      { k: 'dir', n: 'Teilung der Bänder', t: 'sel', d: 'span', o: [['span', 'in Spannweite (Streifen in Flugrichtung)'], ['chord', 'in der Tiefe (Bänder längs der Fläche)']] },
      { k: 'n', n: 'Bänder / Verlaufsstufen', t: 'num', d: 1, min: 1, max: 60, step: 1 }, { k: 'gap', n: 'Lücke zwischen den Bändern (%)', t: 'num', d: 0, min: 0, max: 90, step: 5 },
      { k: 'c1', n: 'Farbe innen / vorn', t: 'col', d: '#c8102e' }, { k: 'c2', n: 'Farbe außen / hinten', t: 'col', d: '#c8102e' },
      { k: 'side', n: 'Hälften', t: 'sel', d: 'both', o: [['both', 'beide Hälften'], ['left', 'nur links'], ['right', 'nur rechts']] }],
      build: (p, st) => {
        const B = st[st.length - 1].y, ya = B * clamp(N(p.y0), 0, 100) / 100, yb = B * clamp(N(p.y1), 0, 100) / 100, fa = clamp(N(p.f0), 0, 100) / 100, fb = clamp(N(p.f1), 0, 100) / 100;
        const n = clamp(Math.round(N(p.n) || 1), 1, 60), cols = grad(p.c1, p.c2, n), gap = clamp(N(p.gap), 0, 90) / 100, layers = [];
        if (!(yb > ya) || !(fb > fa)) return layers;
        const piece = (y0, y1, f0, f1) => {
          const ys = [y0]; st.forEach(s => { if (s.y > y0 + 1e-6 && s.y < y1 - 1e-6) ys.push(s.y); }); ys.push(y1);
          const fr = ys.map(Y => { const q = planAt(st, Y); return [Y, -(q.le + f0 * q.c)]; }), re = ys.map(Y => { const q = planAt(st, Y); return [Y, -(q.le + f1 * q.c)]; });
          return fr.concat(re.reverse());
        };
        for (let k = 0; k < n; k++) {
          const t0 = k / n, t1 = (k + 1 - gap) / n, R = p.dir === 'chord' ? piece(ya, yb, fa + (fb - fa) * t0, fa + (fb - fa) * t1) : piece(ya + (yb - ya) * t0, ya + (yb - ya) * t1, fa, fb), rings = [];
          if (p.side !== 'left') rings.push(R); if (p.side !== 'right') rings.push(R.map(q => [-q[0], q[1]]));
          layers.push({ c: cols[k], rings });
        }
        return layers;
      } }
  ];

  // ---------- Vorlagen (Galerie) ----------------------------------------------------------------
  const PRESETS = [
    { kind: 'fdes', key: 'stripe', name: 'Zierlinie gerade', p: {} },
    { kind: 'fdes', key: 'stripe', name: 'Haubenschwung (Linie unter der Haube bis zum Leitwerk)', p: { xa: 0.5, xb: 97, h0: 50, hm: 36, h1: 50, w0: 0, wm: 30, w1: 3, c1: '#1f4e9c', c2: '#1f4e9c' } },
    { kind: 'fdes', key: 'stripe', name: 'Regenbogen-Bänder (70er, ASW 17)', p: { xa: 1, xb: 72, h0: 46, hm: 40, h1: 48, w0: 0, wm: 48, w1: 6, n: 3, c1: '#ffd100', c2: '#c8102e' } },
    { kind: 'fdes', key: 'stripe', name: 'Farbverlauf entlang des Rumpfs', p: { xa: 1, xb: 80, h0: 46, hm: 40, h1: 48, w0: 0, wm: 55, w1: 4, n: 24, c1: '#ffd100', c2: '#c8102e' } },
    { kind: 'fdes', key: 'stripe', name: 'Keil von der Nase', p: { xa: 0, xb: 55, h0: 50, hm: 50, h1: 50, w0: 70, wm: 30, w1: 0, c1: '#c8102e', c2: '#c8102e' } },
    { kind: 'fdes', key: 'stripe', name: 'Schnurrbart (Schwung von der Nase zur Haube)', p: { xa: 0, xb: 26, h0: 50, hm: 64, h1: 86, w0: 3, wm: 24, w1: 0, c1: '#c8102e', c2: '#c8102e' } },
    { kind: 'fdes', key: 'nose', name: 'Nasenkappe', p: {} },
    { kind: 'fdes', key: 'nose', name: 'Nasenkappe schräg mit Farbverlauf', p: { len: 10, slant: 3, n: 16 } },
    { kind: 'fdes', key: 'nose', name: 'Nasenkappe mit Pfeilspitze an den Seiten', p: { len: 5, spike: 12, c2: '#c8102e' } },
    { kind: 'fdes', key: 'rings', name: 'Rumpfbänder', p: {} },
    { kind: 'fdes', key: 'antiglare', name: 'Blendschutz vor der Haube', p: {} },
    { kind: 'fdes', key: 'canopy', name: 'Kabinenhaube mit Rahmen', p: {} },
    { kind: 'fdes', key: 'belly', name: 'Unterseite farbig', p: {} },
    { kind: 'fdes', key: 'stripe', name: 'Kunstflug-Bänder (rot, orange, gelb)', p: { xa: 4, xb: 97, h0: 50, hm: 50, h1: 55, w0: 70, wm: 60, w1: 30, n: 3, gap: 25, c1: '#d4213d', c2: '#ffc400' } },
    { kind: 'wdes', key: 'wwedge', name: 'Pilatus B4: blaue und rote Keile vom Flügelansatz', p: {} },
    { kind: 'wdes', key: 'wrays', name: 'Sonnenstrahlen über die Fläche (Kunstflug)', p: {} },
    { kind: 'wdes', key: 'wdiag', name: 'Schräge Streifen (Kunstflug, Pilatus B4)', p: {} },
    { kind: 'wdes', key: 'wchecker', name: 'Schachbrett am Außenflügel', p: {} },
    { kind: 'wdes', key: 'wband', name: 'Warnfeld am Randbogen', p: {} },
    { kind: 'wdes', key: 'wband', name: 'Zwei Streifen am Außenflügel', p: { y0: 78, y1: 90, n: 2, gap: 45 } },
    { kind: 'wdes', key: 'wband', name: 'Farbverlauf zum Randbogen', p: { y0: 70, y1: 100, n: 24, c1: '#ffffff', c2: '#1f4e9c' } },
    { kind: 'wdes', key: 'wband', name: 'Band an der Nasenleiste', p: { y0: 0, y1: 100, f0: 0, f1: 12, dir: 'chord', c1: '#c8102e', c2: '#c8102e' } }
  ];
  const BY = {}; FUS.concat(WING).forEach(s => { BY[s.id] = s; });
  function defaults(id, over) { const s = BY[id], p = {}; if (s) s.params.forEach(q => { p[q.k] = q.d; }); return Object.assign(p, over || {}); }

  root.DecalDesign = { FUS, WING, BY, PRESETS, defaults, grad, mix };
})(typeof window !== 'undefined' ? window : globalThis);
