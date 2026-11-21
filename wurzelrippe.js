/* wurzelrippe.js — Wurzelrippe im Reiter „Steghöhen“ (Feature steghoehe)
 *
 * Einrückung von Nase und Endleiste der Wurzelrippe (cfg.stegH.rootInL/rootInT, frei → parallel oder schräg; Ebene
 * und Schnittpunkte in stegh.js rootPlane/rootZLine/rootEnds), eigene Bohrungen rund/eckig (cfg.stegH.rootHoles) und
 * der Schnitt durch die Tragfläche in der Ebene der Wurzelrippe als wahre Form:
 * Profil, Schale bzw. Außenlage/Stützstoff/Innenlage, Holmgurt, Holm- und Ruderstege, die an der Wurzelrippe
 * beginnen, Steckungshülse und Steckung, Rippenkontur (Innenkontur der Schale bzw. Gurt-Innenfläche + Spiel, mit
 * Ausschnitt für die Hülse). Vorschau im Fenster „Schnitte in Spannweite“, Übernahme in die CAD-Bearbeitung mit
 * einer Ebene je Teil. Koordinaten der Ausgabe: u = wahre Länge in der Rippenebene ab der Nase der Wurzelrippe,
 * y = Höhe wie in den Schnitten. Wird nur geschützt aus stegh.js/stuetzrippen.js gerufen (App.StegWurzel && …).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { state } = App;
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const A = () => App.StegApi;

  // Teile: Ebene im CAD, DXF-Farbe, Füllung/Linie in der Vorschau, Name in der Legende
  const PART = {
    prof: { cad: 'PROFIL', dxf: 7, fill: 'rgba(160,180,210,.10)', line: '#c8d2e0', name: 'Profil' },
    shell: { cad: 'SCHALE', dxf: 3, fill: 'rgba(120,220,170,.45)', line: '#78dcaa', name: 'Schale' },
    outer: { cad: 'AUSSENLAGE', dxf: 3, fill: 'rgba(120,220,170,.45)', line: '#78dcaa', name: 'Außenlage' },
    sup: { cad: 'STUETZSTOFF', dxf: 33, fill: 'rgba(185,169,138,.85)', line: '#d6ffe8', name: 'Stützstoff' },
    inner: { cad: 'INNENLAGE', dxf: 4, fill: 'rgba(170,235,205,.55)', line: '#78dcaa', name: 'Innenlage' },
    rib: { cad: 'WURZELRIPPE', dxf: 40, fill: 'rgba(224,185,122,.22)', line: '#e0b97a', name: 'Wurzelrippe' },
    cap: { cad: 'HOLMGURT', dxf: 6, fill: 'rgba(255,60,220,.6)', line: '#ff3cdc', name: 'Holmgurt' },
    holm: { cad: 'HOLMSTEGE', dxf: 5, fill: 'rgba(90,169,255,.45)', line: '#5aa9ff', name: 'Holmstege' },
    ruder: { cad: 'RUDERSTEGE', dxf: 30, fill: 'rgba(255,169,77,.45)', line: '#ffa94d', name: 'Ruderstege' },
    huel: { cad: 'HUELSE', dxf: 2, fill: 'rgba(255,240,106,.30)', line: '#fff06a', name: 'Hülse' },
    stk: { cad: 'STECKUNG', dxf: 1, fill: 'rgba(255,240,106,.70)', line: '#fff06a', name: 'Steckung' }
  };

  // ---------- Geometrie ----------
  // Spur der Rippe im Grundriss: x von der Nase (xa) bis zur Endleiste (xb), z = zAt(x), wahre Länge u(x)
  function trace(G, c) {
    const S = A(), P = S.rootPlane(G, c), E = S.rootEnds(G, c), cos = P ? P.cos : 1;
    return { P, E, xa: E.xL, xb: E.xT, cos, zAt: x => (P ? P.z(x) : 0), u: x => (x - E.xL) / cos };
  }
  // Bereiche der Spur, in denen inside(x) gilt (abgetastet, Ränder halbiert) → [[x1, x2], …]
  function bands(tr, inside) {
    const n = 600, d = (tr.xb - tr.xa) / n, out = [];
    const edge = (lo, hi) => { const v = inside(lo); for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (inside(m) === v) lo = m; else hi = m; } return (lo + hi) / 2; };
    let on = inside(tr.xa), s = on ? tr.xa : null;
    for (let i = 1; i <= n; i++) {
      const x = i === n ? tr.xb : tr.xa + d * i, q = inside(x);
      if (q !== on) { const e = edge(x - d, x); if (q) s = e; else { out.push([s, e]); s = null; } on = q; }
    }
    if (on && s != null) out.push([s, tr.xb]);
    return out.filter(b => b[1] - b[0] > 1e-3);
  }
  // Alle Teile in der Rippenebene; Schleifen in Grundriss-x (p[0]) und Höhe (p[1]), Umrechnung in u erst bei der Ausgabe
  const cache = new WeakMap();
  function rootSec(G, c) {
    const key = JSON.stringify(c);
    let M = cache.get(App.wing); if (!M) cache.set(App.wing, M = new Map());
    if (M.has(key)) return M.get(key);
    if (M.size > 20) M.clear();
    const R = calc(G, c); M.set(key, R);
    return R;
  }
  function calc(G, c) {
    const S = A(), tr = trace(G, c), warn = [];
    if (!(tr.xb - tr.xa > 1)) return null;
    if (tr.E.zL >= G.L - 1e-6 || tr.E.zT >= G.L - 1e-6) warn.push(T('Die Wurzelrippe reicht über die Tragfläche hinaus.'));
    const N = 200, xs = [];
    for (let i = 0; i <= N; i++) xs.push(tr.xa + (tr.xb - tr.xa) * (1e-4 + (1 - 2e-4) * (1 - Math.cos(Math.PI * i / N)) / 2));
    const sec = x => S.section(G, x, tr.zAt(x));
    const up = [], dn = [];
    xs.forEach(x => { const s = sec(x); if (s) { up.push([x, s.top]); dn.push([x, s.bot]); } });
    if (up.length < 3) return null;
    const outline = up.concat(dn.slice().reverse());
    // Innenkontur im senkrechten Abstand off (wie der Abzug der Steghöhen); X = zusätzliche Abtaststellen
    const loopOff = (off, X) => {
      if (!(off > 0)) return outline;
      const a = [], b = [];
      (X || xs).forEach(x => { const s = sec(x); if (s && s.top - s.bot > 2 * off) { a.push([x, s.top - off]); b.push([x, s.bot + off]); } });
      return a.length > 1 ? a.concat(b.reverse()) : null;
    };
    const parts = [], add = (k, loops) => { const L = loops.filter(P => P && P.length > 2); if (L.length) parts.push({ k, loops: L }); };
    add('prof', [outline]);
    // Schale bzw. Lagen: je Lage die beiden begrenzenden Schleifen (Fläche dazwischen)
    const shT = S.shellOf(c);
    if (c.layOn) {
      const lA = S.layA(c), lS = S.layS(c), B = [0, lA, lA + lS, shT];
      ['outer', 'sup', 'inner'].forEach((k, i) => { if (B[i + 1] - B[i] > 1e-9) add(k, [loopOff(B[i]), loopOff(B[i + 1])]); });
    } else if (shT > 0) add('shell', [outline, loopOff(shT)]);
    // Holmgurt oben und unten im Bereich, in dem die Spur im Gurtband liegt
    const go = S.capFace(c), capIn = x => { const z = tr.zAt(x), bw = S.capAt(G, c, 'capW', z); return bw > 0 && Math.abs(x - S.capCenter(G, c, z)) <= bw / 2; };
    const capB = bands(tr, capIn), capL = [];
    capB.forEach(([x1, x2]) => {
      const T1 = [], T2 = [], B1 = [], B2 = [];
      for (let i = 0; i <= 16; i++) {
        const x = x1 + (x2 - x1) * i / 16, ct = S.capAt(G, c, 'capT', tr.zAt(x)), s = sec(x);
        if (!s || !(ct > 0) || s.top - s.bot < 2 * (go + ct)) continue;
        T1.push([x, s.top - go]); T2.push([x, s.top - go - ct]); B1.push([x, s.bot + go]); B2.push([x, s.bot + go + ct]);
      }
      if (T1.length > 1) capL.push(T1.concat(T2.reverse()), B1.concat(B2.reverse()));
    });
    // Stege, die an der Wurzelrippe beginnen: ihre Stirnfläche in der Rippenebene
    const webs = { holm: [], ruder: [] };
    S.allStege(G, c).forEach(d => {
      if (!(d.len > 0)) return;
      const w = S.webOf(d.st, d.kind), xc = d.xAt || (z => d.at(z, 0).x);
      bands(tr, x => Math.abs(x - xc(tr.zAt(x))) <= w / 2).forEach(([x1, x2]) => {
        const zm = tr.zAt((x1 + x2) / 2); if (zm < d.a - 0.5 || zm > d.b + 0.5) return;
        const P1 = [], P2 = [];
        for (let i = 0; i <= 8; i++) {
          const x = x1 + (x2 - x1) * i / 8, s = sec(x), ins = S.insetOf(G, c, d.kind, tr.zAt(x));
          if (s && s.top - s.bot > 2 * ins) { P1.push([x, s.top - ins]); P2.push([x, s.bot + ins]); }
        }
        if (P1.length > 1) webs[d.kind].push(P1.concat(P2.reverse()));
      });
    });
    // Steckung und Hülse (gerades Rohr; rund im Querschnitt z = konst., in der schrägen Ebene entsprechend gestreckt)
    const huel = [], stk = [], holes = [], cutX = [];   // cutX: Ausnehmungen als Ober-/Unterlinie (für den STL-Körper)
    const loopOf = s => dedupLoop(s.top.concat(s.bot.slice().reverse()));
    S.stkAll(G, c).forEach((K, ki) => {
      if (K.cy == null || !(K.oH > 0) || !(K.oW > 0)) return;
      const tube = (wd, ht) => {
        const res = [];
        bands(tr, x => Math.abs(x - K.cx(tr.zAt(x))) <= wd / 2).forEach(([x1, x2]) => {
          const zm = tr.zAt((x1 + x2) / 2); if (zm < K.z0 - 0.5 || zm > K.len + 0.5) return;
          const a = [], b = [], n = 32;
          for (let i = 0; i <= n; i++) {
            const x = K.round ? x1 + (x2 - x1) * (1 - Math.cos(Math.PI * i / n)) / 2 : x1 + (x2 - x1) * i / n, z = tr.zAt(x), yc = K.cy + z * K.tan;
            const hh = K.round ? Math.sqrt(Math.max(0, wd * wd / 4 - Math.pow(x - K.cx(z), 2))) : ht / 2;
            a.push([x, yc + hh]); b.push([x, yc - hh]);
          }
          res.push({ top: a, bot: b, x1, x2 });
        });
        return res;
      };
      const o = tube(K.oW, K.oH), i = K.inW > 0 && K.inH > 0 ? tube(K.inW, K.inH) : [];
      huel.push(...o.map(loopOf), ...i.map(loopOf)); stk.push(...i.map(loopOf)); holes.push(...o.map(loopOf));
      o.forEach((s, j) => {
        // Mitte: wo die Achse der Steckung die Rippenebene trifft (für die Bohrschablone)
        let lo = s.x1, hi = s.x2; const f = x => x - K.cx(tr.zAt(x));
        for (let it = 0; it < 50; it++) { const m = (lo + hi) / 2; if ((f(lo) <= 0) === (f(m) <= 0)) lo = m; else hi = m; }
        const xc = (lo + hi) / 2;
        cutX.push({ id: 'huel:' + ki + (j ? ':' + j : ''), name: T('Hülse') + (K.split != null ? ' (' + T('Teilung') + ' ' + (K.split + 1) + ')' : ''), top: s.top, bot: s.bot, round: !!K.round, d: K.oW, xc, yc: K.cy + tr.zAt(xc) * K.tan, tanV: K.tan || 0, ortho: Math.abs(K.cx(K.len) - K.cx(K.z0)) < 1e-3 });
      });
    });
    // Rippenkontur abzüglich Spiel; Hülse ausgeschnitten. Reicht bis (c.rootTo): 'inner' = innen an der Schale bzw.
    // Innenlage (Standard), 'outer' = bis zur Außenlage (Stützstoff und Innenlage ausgespart; ohne Lagenaufbau bis zur
    // Außenkontur). Holmgurt ausgenommen (c.rootCapCut, Standard an): im Gurtband (+ Spiel seitlich) bis zur
    // Gurt-Innenfläche, der Gurt läuft durch; aus = die Rippe geht über den Gurt, der Gurt endet an ihr.
    // Übergang zum Gurt (c.rootCapEdge): 'step' = senkrecht, 'chamfer' = Schräge über c.rootCapEdgeW mm, 'round' =
    // Hohlkehle am Boden + Rundung oben mit Radius c.rootCapEdgeR. Er liegt neben dem Gurtband (+ Spiel), die
    // Aussparung für den Gurt selbst bleibt voll tief; Maße in der Rippenebene (wahre Länge).
    const gap = Math.max(0, +c.rootGap || 0), ribBase = c.rootTo === 'outer' ? (c.layOn ? S.layA(c) : 0) : shT, capCut = c.rootCapCut !== false;
    const edgeMode = c.rootCapEdge === 'chamfer' || c.rootCapEdge === 'round' ? c.rootCapEdge : 'step';
    const edgeW = edgeMode === 'chamfer' ? Math.max(0, +(c.rootCapEdgeW != null ? c.rootCapEdgeW : 3) || 0) : edgeMode === 'round' ? Math.max(0, +(c.rootCapEdgeR != null ? c.rootCapEdgeR : 2) || 0) : 0;
    // s = Abstand neben dem Gurtband in der Rippenebene (≤ 0 = im Band), deep = Abzug bis zur Gurt-Innenfläche
    const capGeo = x => { const z = tr.zAt(x), bw = S.capAt(G, c, 'capW', z), ct = S.capAt(G, c, 'capT', z); return { ok: ct > 0 && bw > 0, s: (Math.abs(x - S.capCenter(G, c, z)) - bw / 2 - gap) / tr.cos, deep: S.capFace(c) + ct }; };
    const ribCapIn = x => { if (!capCut) return false; const q = capGeo(x); return q.ok && q.s <= 0; };
    const ribAt = x => {
      const s = sec(x); if (!s) return null;
      let ins = ribBase;
      if (capCut) { const q = capGeo(x); if (q.ok && q.deep > ins) ins = q.deep - (q.s <= 0 ? 0 : ramp(q.s, q.deep - ins, edgeMode, edgeW)); }
      ins += gap;
      return s.top - ins > s.bot + ins ? { top: s.top - ins, bot: s.bot + ins } : null;
    };
    const rx = xs.slice(), capRB = bands(tr, ribCapIn);
    capRB.forEach(([x1, x2]) => {
      rx.push(x1 - 1e-6, x1 + 1e-6, x2 - 1e-6, x2 + 1e-6);
      const D = capGeo((x1 + x2) / 2).deep - ribBase;
      if (edgeMode !== 'step' && edgeW > 0 && D > 0) {   // Übergangszone fein abtasten (in Grundriss-x)
        const r = edgeW, W = edgeMode === 'chamfer' ? edgeW : (r >= D / 2 ? 2 * Math.sqrt(r * D - D * D / 4) : 2 * r), n = 32;
        for (let k = 1; k <= n; k++) { const d = W * k / n * tr.cos; rx.push(x1 - d, x2 + d); }
        if (edgeMode === 'round' && r < D / 2) { const d = r * tr.cos; rx.push(x1 - d - 1e-6, x1 - d + 1e-6, x2 + d - 1e-6, x2 + d + 1e-6); }
      }
    });
    rx.sort((p, q) => p - q);
    const ru = [], rd = [];
    rx.forEach(x => { const s = ribAt(x); if (s) { ru.push([x, s.top]); rd.push([x, s.bot]); } });
    // Umrechnung in die Rippenebene: u ab der Nase der Wurzelrippe (wahre Länge); xOfU = zurück in Grundriss-x
    let u0 = Infinity, ymin = Infinity, ymax = -Infinity;
    outline.forEach(p => { u0 = Math.min(u0, tr.u(p[0])); ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); });
    const xOfU = u => tr.xa + (u + u0) * tr.cos;
    // Eigene Bohrungen (Stecker, Bolzen …): rund oder eckig (mit Eckenradius), Lage in der Rippenebene ab Nase,
    // Höhe ab der Mitte zwischen Ober- und Unterseite; Form in wahrer Größe, deshalb erst in u gebildet
    const own = [], ownName = [], cutU = [];
    (c.rootHoles || []).forEach((h, i) => {
      const nm = (h.name && String(h.name).trim()) || T('Bohrung') + ' ' + (i + 1), uc = +h.x || 0, s = sec(xOfU(uc));
      if (!s) { warn.push(nm + ': ' + T('außerhalb des Profils.')); return; }
      const yc = (s.top + s.bot) / 2 + (+h.y || 0);
      let sh = null;
      if (h.shape === 'rect') { const w = Math.max(0, +h.w || 0), hh = Math.max(0, +h.h || 0); if (w > 0 && hh > 0) sh = rshape(uc, yc, w, hh, Math.max(0, +h.r || 0)); }
      else { const d = Math.max(0, +h.d || 0); if (d > 0) sh = rshape(uc, yc, d, d, d / 2); }
      if (!sh) return;
      const L = loopOf(sh).map(p => [xOfU(p[0]), p[1]]);
      if (!L.every(p => { const q = ribAt(p[0]); return q && p[1] < q.top - 1e-6 && p[1] > q.bot + 1e-6; })) warn.push(nm + ': ' + T('reicht über die Kontur der Rippe hinaus.'));
      own.push(L); ownName.push(nm); cutU.push({ id: 'hole:' + i, name: nm, top: sh.top, bot: sh.bot, round: h.shape !== 'rect', d: +h.d || 0, cu: uc, cy: yc, tanV: 0, ortho: true });
    });
    const ribL = ru.length > 1 ? [ru.concat(rd.slice().reverse())].concat(holes, own) : [];
    if (!ribL.length) warn.push(T('Kein Platz für die Rippe innerhalb der Schale.'));
    add('rib', ribL);
    add('cap', capL); add('holm', webs.holm); add('ruder', webs.ruder); add('huel', huel); add('stk', stk);
    const toU = P => P.map(p => [tr.u(p[0]) - u0, p[1]]);
    parts.forEach(p => { p.uloops = p.loops.map(toU); });
    let ulen = 0; parts[0].uloops[0].forEach(p => { ulen = Math.max(ulen, p[0]); });
    // Für den STL-Körper: Rippe als Ober-/Unterlinie und alle möglichen Ausnehmungen (Hülse, Bohrungen), alles in u
    const ok = ribL.length > 0, hasCap = capB.some(([x1, x2]) => S.capAt(G, c, 'capT', tr.zAt((x1 + x2) / 2)) > 0);
    const cuts = ok ? cutX.map(q => ({ id: q.id, name: q.name, top: toU(q.top), bot: toU(q.bot), round: q.round, d: q.d, cu: tr.u(q.xc) - u0, cy: q.yc, tanV: q.tanV, ortho: q.ortho })).concat(cutU) : [];
    const midAt = u => { const s = sec(xOfU(u)); return s ? (s.top + s.bot) / 2 : null; };
    const capDepth = capRB.length ? Math.max(0, capGeo((capRB[0][0] + capRB[0][1]) / 2).deep - ribBase) : 0;
    return { tr, parts, ulen, ymin, ymax, warn, loopOff, outline, ribLoops: ribL, holes, own: ok ? own.map(toU) : [], ownName, angle: tr.P ? tr.P.a : 0, ribTop: ok ? toU(ru) : null, ribBot: ok ? toU(rd) : null, cuts, hasCap, capDepth, xOfU, midAt };
  }
  // Übergang neben dem Gurtband: Höhe über dem Boden der Aussparung im Abstand s (> 0) bei Stufenhöhe D.
  // chamfer: gerade über die Breite w. round (w = Radius): Hohlkehle tangential aus dem Boden, Rundung tangential in
  // die Rippenkontur; reicht der Radius nicht über die halbe Stufe, steht dazwischen eine senkrechte Wand.
  function ramp(s, D, mode, w) {
    if (s <= 0) return 0;
    if (mode === 'chamfer' && w > 0) return Math.min(D, D * s / w);
    if (mode === 'round' && w > 0) {
      const r = w, sq = v => Math.sqrt(Math.max(0, v));
      if (r >= D / 2) { const s1 = sq(r * D - D * D / 4); if (s >= 2 * s1) return D; return s <= s1 ? r - sq(r * r - s * s) : D - r + sq(r * r - (s - 2 * s1) * (s - 2 * s1)); }
      if (s < r) return r - sq(r * r - s * s);
      if (s < 2 * r) return D - r + sq(r * r - (s - 2 * r) * (s - 2 * r));
    }
    return D;
  }
  // Doppelte aufeinanderfolgende Punkte einer geschlossenen Schleife entfernen
  function dedupLoop(P) {
    const o = [];
    P.forEach(p => { const l = o[o.length - 1]; if (!l || Math.abs(p[0] - l[0]) > 1e-9 || Math.abs(p[1] - l[1]) > 1e-9) o.push(p); });
    while (o.length > 1 && Math.abs(o[0][0] - o[o.length - 1][0]) <= 1e-9 && Math.abs(o[0][1] - o[o.length - 1][1]) <= 1e-9) o.pop();
    return o;
  }
  // Rechteck mit Eckenradius als Ober-/Unterlinie über u (r = halbe Breite/Höhe → Langloch bzw. Kreis), Mitte (cx, cy)
  function rshape(cx, cy, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    const us = [], n = 12;
    if (r > 1e-6) {
      for (let i = 0; i <= n; i++) us.push(cx - w / 2 + r - r * Math.cos(Math.PI / 2 * i / n));
      for (let i = n; i >= 0; i--) us.push(cx + w / 2 - r + r * Math.cos(Math.PI / 2 * i / n));
    } else us.push(cx - w / 2, cx + w / 2);
    const U = us.filter((u, i) => !i || u - us[i - 1] > 1e-9);
    const half = u => { const dx = Math.max(0, Math.abs(u - cx) - (w / 2 - r)); return h / 2 - r + Math.sqrt(Math.max(0, r * r - dx * dx)); };
    return { top: U.map(u => [u, cy + half(u)]), bot: U.map(u => [u, cy - half(u)]) };
  }
  const data = (G, c) => { const S = A(); G = G || S.geo(); c = c || S.cfg(); return G ? rootSec(G, c) : null; };

  // ---------- Vorschau im Fenster „Schnitte“ (aus stegh.js drawSec) ----------
  function draw(g, X, Y, R) {
    const S = A(), tr = P => P.forEach((p, i) => { const a = X(p[0]), b = Y(p[1]); if (i) g.lineTo(a, b); else g.moveTo(a, b); });
    R.parts.forEach(p => {
      const st = PART[p.k];
      g.beginPath(); p.uloops.forEach(L => { tr(L); g.closePath(); });
      g.fillStyle = st.fill; g.fill('evenodd');
      if (p.k === 'rib') { g.setLineDash([5, 3]); g.lineWidth = 1.6; } else g.lineWidth = p.k === 'prof' ? 1.2 : 1;
      g.strokeStyle = st.line; g.stroke(); g.setLineDash([]);
    });
    // eigene Bohrungen durchgezogen und beschriftet (die Rippenkontur ist gestrichelt)
    g.strokeStyle = PART.rib.line; g.lineWidth = 1.4;
    R.own.forEach((L, i) => {
      g.beginPath(); tr(L); g.closePath(); g.stroke();
      let xm = -Infinity, ym = 0; L.forEach(p => { if (p[0] > xm) { xm = p[0]; ym = p[1]; } });
      g.fillStyle = PART.rib.line; g.font = '10px sans-serif'; g.fillText(R.ownName[i], X(xm) + 3, Y(ym) + 3);
    });
    g.font = '12px sans-serif';
    const E = R.tr.E, sk = R.angle;
    const head = T('Wurzelrippe') + ' · ' + (Math.abs(sk) > 0.005 ? T('schräg') + ' ' + S.f1(sk) + '°' : T('senkrecht')) + (E.zL > 0.05 ? ' · ' + T('Nase eingerückt') + ' ' + S.f1(E.zL) + ' mm' : '') + (E.zT > 0.05 ? ' · ' + T('Endleiste eingerückt') + ' ' + S.f1(E.zT) + ' mm' : '')
      + ' · ' + T('wahre Länge') + ' ' + S.f1(R.ulen) + ' mm';
    g.fillStyle = '#9aa7b8'; g.textAlign = 'left'; g.fillText(head, X(0), Y(R.ymax) - 10);
    // Legende unter dem Schnitt (bricht am rechten Rand um)
    const x0 = Math.max(8, X(0)), wMax = (g.canvas.clientWidth || 800) - 8;
    let x = x0, y = Y(R.ymin) + 22;
    R.parts.forEach(p => {
      const st = PART[p.k], t = T(st.name), wd = 14 + g.measureText(t).width + 14;
      if (x > x0 && x + wd > wMax) { x = x0; y += 16; }
      g.fillStyle = st.fill; g.fillRect(x, y - 9, 10, 10); g.strokeStyle = st.line; g.lineWidth = 1; g.strokeRect(x + 0.5, y - 8.5, 9, 9);
      g.fillStyle = '#c8d2e0'; g.fillText(t, x + 14, y); x += wd;
    });
    R.warn.forEach((wt, i) => { g.fillStyle = '#ffb454'; g.fillText(wt, X(0), y + 18 + 16 * i); });
  }

  // ---------- CAD ----------
  // keys = gewählte Teile (null = alle)
  function dxfText(keys) {
    const S = A(), G = S.geo(); if (!G || !window.Dxf) return null;
    const R = rootSec(G, S.cfg()); if (!R) return null;
    const layers = R.parts.filter(p => !keys || keys.indexOf(p.k) >= 0).map(p => ({ name: PART[p.k].cad, color: PART[p.k].dxf, polys: p.uloops.map(P => ({ closed: true, pts: P.map(q => ({ x: q[0], y: q[1] })) })) }));
    return layers.length ? Dxf.write(layers, { precision: state.cfg.precision != null ? state.cfg.precision : 3 }) : null;
  }
  // Vor der Übernahme fragen, welche Teile ins CAD gehen (Häkchen). Abgewählte Teile merkt sich c.rootCadOff je Tragfläche.
  const PART_NOTE = { rib: 'Kontur mit Ausschnitt für die Hülse und den Bohrungen', prof: 'Außenkontur' };
  function pickParts(R, c, done) {
    const off = c.rootCadOff && typeof c.rootCadOff === 'object' ? c.rootCadOff : {};
    const ov = document.createElement('div'); ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div'); box.style.cssText = 'background:var(--panel,#1a2028);border:1px solid var(--line,#334);border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.5);padding:14px 16px;min-width:340px;max-width:92vw;max-height:86vh;overflow:auto;font-size:13px';
    const h = document.createElement('div'); h.textContent = T('Wurzelrippe in CAD übernehmen'); h.style.cssText = 'font-weight:700;font-size:14px;margin-bottom:4px';
    const sub = document.createElement('div'); sub.textContent = T('Was soll ins CAD übernommen werden? Je Teil eine Ebene.'); sub.style.cssText = 'color:var(--muted,#8a97a6);margin-bottom:8px';
    box.append(h, sub);
    const boxes = [];
    R.parts.forEach(p => {
      const st = PART[p.k], l = document.createElement('label'); l.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !off[p.k]; cb.dataset.k = p.k;
      const sw = document.createElement('span'); sw.style.cssText = 'display:inline-block;width:11px;height:11px;border-radius:2px;flex:none;background:' + st.fill + ';border:1px solid ' + st.line;
      const tx = document.createElement('span'); tx.textContent = T(st.name);
      const ly = document.createElement('span'); ly.textContent = st.cad + (PART_NOTE[p.k] ? ' · ' + T(PART_NOTE[p.k]) : ''); ly.style.cssText = 'color:var(--muted,#8a97a6);font-size:11px';
      l.append(cb, sw, tx, ly); box.appendChild(l); boxes.push(cb);
    });
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;margin-top:10px;align-items:center';
    const mk = (t, cls) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = T(t); if (cls) b.className = cls; bar.appendChild(b); return b; };
    const ball = mk('Alle'), bnone = mk('Keine'); const sp = document.createElement('span'); sp.style.flex = '1'; bar.appendChild(sp);
    const bok = mk('Übernehmen', 'primary'), bcancel = mk('Abbrechen');
    box.appendChild(bar); ov.appendChild(box); document.body.appendChild(ov);
    const sync = () => { bok.disabled = !boxes.some(b => b.checked); };
    boxes.forEach(b => { b.onchange = sync; }); sync();
    ball.onclick = () => { boxes.forEach(b => { b.checked = true; }); sync(); };
    bnone.onclick = () => { boxes.forEach(b => { b.checked = false; }); sync(); };
    const onKey = e => { if (e.key === 'Escape') close(); else if (e.key === 'Enter' && !bok.disabled) ok(); };
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    const ok = () => {
      const keys = boxes.filter(b => b.checked).map(b => b.dataset.k), o = {};
      boxes.forEach(b => { if (!b.checked) o[b.dataset.k] = true; });
      c.rootCadOff = o; close(); done(keys);
    };
    bok.onclick = ok; bcancel.onclick = close; ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    document.addEventListener('keydown', onKey);
    bok.focus();
  }
  function toCad() {
    const S = A(), G = S.geo(), c = S.cfg(), R = G && window.Dxf ? rootSec(G, c) : null;
    if (!R) { if (App.toast) App.toast(T('Keine Wurzelrippe vorhanden.')); return; }
    pickParts(R, c, keys => importCad(keys));
  }
  function importCad(keys) {
    const t = dxfText(keys);
    if (!t) { if (App.toast) App.toast(T('Keine Wurzelrippe vorhanden.')); return; }
    const before = state.cad && state.cad.layers;
    App.cadImportDxfText(t, T('Wurzelrippe'));
    if (state.cad && state.cad.layers !== before) {   // nicht bei abgelehnter Rückfrage: Rippenkontur gestrichelt wie in der Vorschau
      if (state.cad.layers.WURZELRIPPE) { if (!state.cad.lineStyles) state.cad.lineStyles = {}; state.cad.lineStyles.WURZELRIPPE = 'dashed'; }
      if (App.buildSidebar) App.buildSidebar();
      if (App.renderCad) App.renderCad();
      if (App.switchView && document.getElementById('cadView')) App.switchView('cad');
    }
  }

  // ---------- STL ----------
  // Fläche „Rippe minus gewählte Ausnehmungen“, auch wenn eine Ausnehmung über den Rand der Rippe ragt: Rippe und
  // Ausnehmungen sind je eine Ober- und Unterlinie über u. Zwischen allen Stützstellen (plus Schnittpunkten der Linien)
  // liegt jede Linie gerade; die Streifenmitte ergibt die Materialbereiche (Trapeze). Deren Ränder (Material links)
  // werden zu Schleifen verkettet: gegen den Uhrzeigersinn = Außenkontur, im Uhrzeigersinn = Loch.
  const pl = P => { const o = []; P.forEach(p => { if (!o.length || p[0] - o[o.length - 1][0] > 1e-9) o.push([p[0], p[1]]); }); return o; };
  function ev(C, u) {
    let lo = 0, hi = C.length - 1;
    if (u <= C[0][0]) return C[0][1];
    if (u >= C[hi][0]) return C[hi][1];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C[m][0] <= u) lo = m; else hi = m; }
    const a = C[lo], b = C[hi];
    return a[0] === u ? a[1] : a[1] + (b[1] - a[1]) * (u - a[0]) / (b[0] - a[0]);
  }
  const area2 = L => { let s = 0; for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; s += a[0] * b[1] - b[0] * a[1]; } return s; };
  const inPoly = (p, L) => { let o = false; for (let i = 0, j = L.length - 1; i < L.length; j = i++) if ((L[i][1] > p[1]) !== (L[j][1] > p[1]) && p[0] < L[j][0] + (L[i][0] - L[j][0]) * (p[1] - L[j][1]) / (L[i][1] - L[j][1])) o = !o; return o; };
  // gerade durchlaufende Zwischenpunkte entfernen (sonst lässt earcut sie aus → Lücken zwischen Deckel und Wand)
  function simplify(L) {
    let P = dedupLoop(L), changed = true;
    while (changed && P.length > 3) {
      changed = false; const Q = [];
      for (let i = 0; i < P.length; i++) {
        const a = Q.length ? Q[Q.length - 1] : P[P.length - 1], b = P[i], c = P[(i + 1) % P.length];
        const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1], la = Math.hypot(ux, uy), lb = Math.hypot(vx, vy);
        if (la < 1e-9 || (Math.abs(ux * vy - uy * vx) <= 1e-9 * la * lb && ux * vx + uy * vy > 0)) { changed = true; continue; }
        Q.push(b);
      }
      P = Q;
    }
    return P;
  }
  function region(top, bot, cuts) {
    const RT = pl(top), RB = pl(bot); if (RT.length < 2 || RB.length < 2) return [];
    const ua = Math.max(RT[0][0], RB[0][0]), ub = Math.min(RT[RT.length - 1][0], RB[RB.length - 1][0]);
    const H = cuts.map(q => ({ t: pl(q.top), b: pl(q.bot) })).filter(h => h.t.length > 1 && h.b.length > 1)
      .map(h => Object.assign(h, { u0: Math.max(h.t[0][0], h.b[0][0]), u1: Math.min(h.t[h.t.length - 1][0], h.b[h.b.length - 1][0]) }))
      .filter(h => h.u1 > ua + 1e-9 && h.u0 < ub - 1e-9 && h.u1 - h.u0 > 1e-6);
    const C = [{ c: RB, u0: ua, u1: ub }, { c: RT, u0: ua, u1: ub }];
    H.forEach(h => { h.cb = { c: h.b, u0: h.u0, u1: h.u1 }; h.ct = { c: h.t, u0: h.u0, u1: h.u1 }; C.push(h.cb, h.ct); });
    let U = [ua, ub];
    C.forEach(q => { U.push(q.u0, q.u1); q.c.forEach(p => U.push(p[0])); });
    const uniq = A2 => { A2 = A2.filter(u => u >= ua - 1e-12 && u <= ub + 1e-12).sort((p, q) => p - q); return A2.filter((u, i) => !i || u - A2[i - 1] > 1e-9); };
    U = uniq(U);
    const spans = (q, a, b) => q.u0 <= a + 1e-12 && q.u1 >= b - 1e-12;
    // Schnittpunkte der Linien innerhalb eines Streifens ergänzen
    const X = [];
    for (let i = 0; i + 1 < U.length; i++) {
      const a = U[i], b = U[i + 1], act = C.filter(q => spans(q, a, b));
      for (let p = 0; p < act.length; p++) for (let q = p + 1; q < act.length; q++) {
        const dl = ev(act[p].c, a) - ev(act[q].c, a), dr = ev(act[p].c, b) - ev(act[q].c, b);
        if (dl * dr < 0) X.push(a + (b - a) * dl / (dl - dr));
      }
    }
    if (X.length) U = uniq(U.concat(X));
    // Materialbereiche je Streifen: zwischen Unter- und Oberlinie der Rippe, ohne die Ausnehmungen
    const slabs = [];
    for (let i = 0; i + 1 < U.length; i++) {
      const a = U[i], b = U[i + 1], m = (a + b) / 2, tm = ev(RT, m), bm = ev(RB, m), iv = [];
      if (tm - bm > 1e-9) {
        const hs = H.filter(h => spans(h, a, b)).map(h => ({ h, lo: ev(h.b, m), hi: ev(h.t, m) })).filter(q => q.hi - q.lo > 1e-9).sort((p, q) => p.lo - q.lo);
        let cur = RB, cv = bm;
        for (const q of hs) {
          if (q.lo >= tm) break;
          if (q.lo > cv + 1e-9) iv.push([cur, q.h.b]);
          if (q.hi > cv) { cur = q.h.t; cv = q.hi; }
        }
        if (tm > cv + 1e-9) iv.push([cur, RT]);
      }
      slabs.push(iv.map(([lo, hi]) => ({ l0: ev(lo, a), l1: ev(hi, a), r0: ev(lo, b), r1: ev(hi, b) })));
    }
    // Ränder mit Material links: Unter-/Oberkanten der Trapeze, senkrechte Kanten an den Streifengrenzen
    const E = [], edge = (x1, y1, x2, y2) => { if (x1 !== x2 || y1 !== y2) E.push([x1, y1, x2, y2]); };
    slabs.forEach((S, i) => S.forEach(q => { edge(U[i], q.l0, U[i + 1], q.r0); edge(U[i + 1], q.r1, U[i], q.l1); }));
    for (let i = 0; i < U.length; i++) {
      const L = i > 0 ? slabs[i - 1].map(q => [q.r0, q.r1]) : [], R = i < slabs.length ? slabs[i].map(q => [q.l0, q.l1]) : [];
      const ys = []; L.concat(R).forEach(q => ys.push(q[0], q[1])); ys.sort((p, q) => p - q);
      const yu = ys.filter((y, k) => !k || y !== ys[k - 1]), inS = (S, y) => S.some(q => y > q[0] && y < q[1]);
      for (let k = 0; k + 1 < yu.length; k++) {
        const y = (yu[k] + yu[k + 1]) / 2, l = inS(L, y), r = inS(R, y);
        if (l && !r) edge(U[i], yu[k], U[i], yu[k + 1]); else if (r && !l) edge(U[i], yu[k + 1], U[i], yu[k]);
      }
    }
    // verketten
    const key = (x, y) => x + '|' + y, out = new Map();
    E.forEach((e, k) => { const s = key(e[0], e[1]); if (!out.has(s)) out.set(s, []); out.get(s).push(k); });
    const used = new Uint8Array(E.length), loops = [];
    for (let k0 = 0; k0 < E.length; k0++) {
      if (used[k0]) continue;
      const L = []; let k = k0;
      while (k != null) {
        used[k] = 1; const e = E[k]; L.push([e[0], e[1]]);
        const nx = out.get(key(e[2], e[3])) || [], j = nx.find(q => !used[q]); k = j === undefined ? null : j;
      }
      const S2 = simplify(L); if (S2.length >= 3 && Math.abs(area2(S2)) > 1e-9) loops.push(S2);
    }
    const outers = loops.filter(L => area2(L) > 0).map(L => ({ outer: L, holes: [] }));
    loops.filter(L => area2(L) < 0).forEach(L => { const o = outers.find(q => inPoly(L[0], q.outer)); if (o) o.holes.push(L); });
    return outers;
  }
  // STL-Körper der Wurzelrippe: o = { t (Dicke), capCut (Holmgurt ausgenommen), off (abgewählte Ausnehmungen) };
  // liegt flach: x = wahre Länge ab Nase, y = Höhe wie im CAD, z = 0 … Dicke
  function ribMesh(G, c, o) {
    const cc = Object.assign({}, c, { rootCapCut: o.capCut != null ? !!o.capCut : c.rootCapCut !== false });
    const R = rootSec(G, cc); if (!R || !R.ribTop || !App.earcut) return null;
    const regs = region(R.ribTop, R.ribBot, R.cuts.filter(q => !(o.off && o.off[q.id])));
    const t = Math.max(0.1, +o.t || 3), v = [], P = (p, z) => [p[0], p[1], z];
    const tri = (a, b, c2) => v.push(a[0], a[1], a[2], b[0], b[1], b[2], c2[0], c2[1], c2[2]);
    regs.forEach(rg => {
      const rings = [rg.outer].concat(rg.holes), ec = App.earcut(rings.map(L => L.map(p => ({ x: p[0], y: p[1] }))));
      ec.tris.forEach(q => {
        let a = ec.V[q[0]], b = ec.V[q[1]], d = ec.V[q[2]];
        if ((b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]) < 0) { const s = b; b = d; d = s; }
        tri(P(a, t), P(b, t), P(d, t)); tri(P(a, 0), P(d, 0), P(b, 0));   // oben nach +z, unten nach −z
      });
      // Wände: Außenkontur gegen, Löcher im Uhrzeigersinn → Normalen zeigen aus dem Material heraus
      rings.forEach(L => L.forEach((p, i) => { const q = L[(i + 1) % L.length]; tri(P(p, 0), P(q, 0), P(q, t)); tri(P(p, 0), P(q, t), P(p, t)); }));
    });
    return { v, pieces: regs.length, holes: regs.reduce((s, r) => s + r.holes.length, 0) };
  }
  function stlAscii(v) {
    let s = 'solid wurzelrippe\n';
    for (let i = 0; i < v.length; i += 9) {
      const ux = v[i + 3] - v[i], uy = v[i + 4] - v[i + 1], uz = v[i + 5] - v[i + 2], wx = v[i + 6] - v[i], wy = v[i + 7] - v[i + 1], wz = v[i + 8] - v[i + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, L = Math.hypot(nx, ny, nz) || 1;
      s += ' facet normal ' + nx / L + ' ' + ny / L + ' ' + nz / L + '\n  outer loop\n';
      for (let k = 0; k < 9; k += 3) s += '   vertex ' + v[i + k] + ' ' + v[i + k + 1] + ' ' + v[i + k + 2] + '\n';
      s += '  endloop\n endfacet\n';
    }
    return s + 'endsolid wurzelrippe\n';
  }
  // Abfrage vor dem STL-Export: Dicke und welche Ausnehmungen drin sein sollen (gemerkt in c.rootStl je Tragfläche),
  // danach die STL-Vorschau (stlpreview.js hängt sich in App.exportViaPicker) und der Speichern-Dialog
  function stlDialog() {
    const S = A(), G = S.geo(), c = S.cfg(), R = G ? rootSec(G, Object.assign({}, c, { rootCapCut: true })) : null;
    if (!R || !R.ribTop) { if (App.toast) App.toast(T('Keine Wurzelrippe vorhanden.')); return; }
    const o = c.rootStl && typeof c.rootStl === 'object' ? c.rootStl : {};
    const ov = document.createElement('div'); ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div'); box.style.cssText = 'background:var(--panel,#1a2028);border:1px solid var(--line,#334);border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.5);padding:14px 16px;min-width:340px;max-width:92vw;max-height:86vh;overflow:auto;font-size:13px';
    const h = document.createElement('div'); h.textContent = T('Wurzelrippe als STL'); h.style.cssText = 'font-weight:700;font-size:14px;margin-bottom:8px';
    box.appendChild(h);
    const tr = document.createElement('label'); tr.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';
    const ti = document.createElement('input'); ti.type = 'text'; ti.inputMode = 'decimal'; ti.style.width = '70px'; ti.value = +o.t > 0 ? o.t : 3;
    tr.append(document.createTextNode(T('Dicke (mm)')), ti); box.appendChild(tr);
    const sub = document.createElement('div'); sub.textContent = T('Welche Ausnehmungen sollen drin sein?'); sub.style.cssText = 'font-weight:600;margin:4px 0';
    box.appendChild(sub);
    const row = (text, on, note) => {
      const l = document.createElement('label'); l.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on;
      const tx = document.createElement('span'); tx.textContent = text; l.append(cb, tx);
      if (note) { const n = document.createElement('span'); n.textContent = note; n.style.cssText = 'color:var(--muted,#8a97a6);font-size:11px'; l.appendChild(n); }
      box.appendChild(l); return cb;
    };
    const off = o.off && typeof o.off === 'object' ? o.off : {};
    const cbCap = R.hasCap ? row(T('Holmgurt'), o.capCut != null ? !!o.capCut : c.rootCapCut !== false, T('Aussparung bis zur Gurt-Innenfläche')) : null;
    const cbs = R.cuts.map(q => ({ q, cb: row(q.id.indexOf('hole:') === 0 ? T('Bohrung') + ': ' + q.name : q.name, !off[q.id]) }));
    if (!cbCap && !cbs.length) { const n = document.createElement('div'); n.textContent = T('Keine Ausnehmungen vorhanden.'); n.style.cssText = 'color:var(--muted,#8a97a6)'; box.appendChild(n); }
    const info = document.createElement('div'); info.style.cssText = 'color:var(--muted,#8a97a6);font-size:11px;margin-top:8px;max-width:420px';
    const to = c.layOn ? (c.rootTo === 'outer' ? 'Außenlage' : 'Innenlage') : (c.rootTo === 'outer' ? 'Außenkontur' : 'Schale innen');
    info.textContent = T('Rippe reicht bis') + ': ' + T(to) + ', ' + T('Spiel') + ' ' + S.f1(+c.rootGap || 0) + ' mm (' + T('Einstellung in der Menügruppe „Wurzelrippe“') + '). ' + T('Die Rippe liegt flach: x = wahre Länge ab Nase, y = Höhe wie im CAD, z = Dicke.');
    box.appendChild(info);
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;margin-top:12px;justify-content:flex-end';
    const bok = document.createElement('button'); bok.type = 'button'; bok.className = 'primary'; bok.textContent = T('Weiter zur STL-Vorschau');
    const bc = document.createElement('button'); bc.type = 'button'; bc.textContent = T('Abbrechen');
    bar.append(bok, bc); box.appendChild(bar); ov.appendChild(box); document.body.appendChild(ov);
    const onKey = e => { if (e.key === 'Escape') close(); else if (e.key === 'Enter') ok(); };
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    const ok = () => {
      const t = parseFloat(String(ti.value).replace(',', '.'));
      if (!(t > 0)) { ti.focus(); ti.select(); return; }
      const off2 = {}; cbs.forEach(({ q, cb }) => { if (!cb.checked) off2[q.id] = true; });
      c.rootStl = { t, off: off2, capCut: cbCap ? cbCap.checked : (o.capCut != null ? !!o.capCut : null) };
      close(); exportStl(c.rootStl);
    };
    bok.onclick = ok; bc.onclick = close; ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    document.addEventListener('keydown', onKey);
    ti.focus(); ti.select();
  }
  function exportStl(o) {
    const S = A(), G = S.geo(), c = S.cfg(), M = G ? ribMesh(G, c, o) : null;
    if (!M || !M.v.length) { if (App.toast) App.toast(T('Die Wurzelrippe ließ sich nicht als Körper bilden.')); return; }
    if (M.pieces > 1 && App.toast) App.toast(T('Hinweis: Die Ausnehmungen teilen die Rippe in') + ' ' + M.pieces + ' ' + T('Teile.'));
    const wt = App.wingFileTag ? App.wingFileTag() : '', nm = (wt ? wt + '_' : '') + 'wurzelrippe.stl';
    if (App.exportViaPicker) App.exportViaPicker(nm, App.stlBinary ? App.stlBinary(M.v) : stlAscii(M.v), 'model/stl', 'svStl');
  }

  // ---------- Bohrschablone für die schräge Wurzelrippe ----------
  // Quader rechtwinklig zur Flugrichtung (Achse = Spannweite; bei der Hülse mit ihrer V-Form geneigt), mittig eine
  // durchgehende Bohrung als Führung. Die Vorderseite ist genau in der Ebene der Wurzelrippe abgeschnitten und wird
  // dort von außen angesetzt. Örtlich: X = Flugrichtung, Y = Höhe (quer zur Achse), Z = Achse ab der geraden
  // Rückseite (Z = 0, Druckbett) bis zur schrägen Anlagefläche Z = L − (k·X − sinβ·Y)/cosβ. Daten c.rootJig.
  const jigTargets = R => R.cuts.filter(q => q.round && q.d > 0 && q.cu != null);
  function jigData(G, c) {
    const S = A(), P = S.rootPlane(G, c); if (!P || Math.abs(P.k) < 1e-9) return null;
    const R = rootSec(G, c); if (!R || !R.ribTop) return null;
    const J = c.rootJig && typeof c.rootJig === 'object' ? c.rootJig : {}, TG = jigTargets(R), warn = [];
    const tg = J.target === 'free' ? null : (TG.find(q => q.id === J.target) || TG[0] || null);
    let u, y, tanV = 0, d0 = 6, name = T('frei');
    if (tg) { u = tg.cu; y = tg.cy; tanV = tg.tanV || 0; d0 = tg.d; name = tg.name; if (!tg.ortho) warn.push(T('Die Steckung läuft im Grundriss nicht rechtwinklig zur Flugrichtung; die Schablone bohrt rechtwinklig zur Flugrichtung.')); }
    else { u = J.u != null ? +J.u : R.ulen / 2; const m = R.midAt(u); if (m == null) return { warn: [T('Die freie Lage liegt außerhalb des Profils.')] }; y = m + (+J.y || 0); }
    const d = +J.d > 0 ? +J.d : d0, w = Math.max(d + 2, +J.w > 0 ? +J.w : Math.ceil(d + 16)), h = Math.max(d + 2, +J.h > 0 ? +J.h : Math.ceil(d + 16));
    const beta = Math.atan(tanV), sinB = Math.sin(beta), cosB = Math.cos(beta);
    const need = (Math.abs(P.k) * w / 2 + Math.abs(sinB) * h / 2) / cosB + 2, l0 = +J.l > 0 ? +J.l : 30, L = Math.max(l0, need);
    if (L > l0 + 1e-9) warn.push(T('Führungslänge auf') + ' ' + S.f1(L) + ' mm ' + T('erhöht, damit die kurze Seite noch 2 mm hat.'));
    const xc = R.xOfU(u), zc = P.z(xc), zf = (X, Y) => L - (P.k * X - sinB * Y) / cosB;
    const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(p => zf(p[0], p[1]));
    // örtlich → Tragfläche: (Grundriss-x, Höhe, Spannweite)
    const world = (X, Y, Z) => [xc + X, y + Y * cosB + (Z - L) * sinB, zc - Y * sinB + (Z - L) * cosB];
    return { name, u, y, d, w, h, L, beta, sinB, cosB, k: P.k, a: P.a, xc, zc, zf, world, zMin: Math.min(...corners), zMax: Math.max(...corners), warn };
  }
  // Dreiecke der Schablone (örtliche Koordinaten), wasserdicht: Deckel aus earcut, Wände je Kante
  function jigTris(J) {
    if (!J || !(J.L > 0) || !App.earcut) return [];
    const n = 48, r = J.d / 2, O = [[-J.w / 2, -J.h / 2], [J.w / 2, -J.h / 2], [J.w / 2, J.h / 2], [-J.w / 2, J.h / 2]], Hc = [];
    for (let i = 0; i < n; i++) { const a = -2 * Math.PI * (i + 0.5) / n; Hc.push([r * Math.cos(a), r * Math.sin(a)]); }   // im Uhrzeigersinn
    const ec = App.earcut([O, Hc].map(L => L.map(p => ({ x: p[0], y: p[1] })))), out = [];
    const B = p => [p[0], p[1], 0], F = p => [p[0], p[1], J.zf(p[0], p[1])];
    ec.tris.forEach(q => {
      let a = ec.V[q[0]], b = ec.V[q[1]], d = ec.V[q[2]];
      if ((b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]) < 0) { const s = b; b = d; d = s; }
      out.push([F(a), F(b), F(d)], [B(a), B(d), B(b)]);   // schräge Anlage nach außen, Rückseite nach unten
    });
    [O, Hc].forEach(L => L.forEach((p, i) => { const q = L[(i + 1) % L.length]; out.push([B(p), B(q), F(q)], [B(p), F(q), F(p)]); }));
    return out;
  }
  function exportJig() {
    const S = A(), G = S.geo(), c = S.cfg(), J = G ? jigData(G, c) : null, TR = jigTris(J);
    if (!TR.length) { if (App.toast) App.toast(T('Keine Bohrschablone möglich – die Wurzelrippe ist nicht schräg.')); return; }
    const v = []; TR.forEach(t => t.forEach(p => v.push(p[0], p[1], p[2])));
    const wt = App.wingFileTag ? App.wingFileTag() : '', nm = (wt ? wt + '_' : '') + 'wurzelrippe_bohrschablone.stl';
    if (App.exportViaPicker) App.exportViaPicker(nm, App.stlBinary ? App.stlBinary(v) : stlAscii(v), 'model/stl', 'svStl');
  }
  // Schablone an ihrem Platz an der Wurzelrippe (für die 3D-Ansicht in stuetzrippen.js)
  function jig3d(G, c) {
    const J = jigData(G, c), TR = jigTris(J);
    return TR.map(t => t.map(p => J.world(p[0], p[1], p[2])));
  }

  // ---------- Seitenleiste (Menügruppe „Wurzelrippe“ aus stegh.js) ----------
  // Winkel eingeben: + = Endleiste behält ihr Maß, die Nase rückt entsprechend; − = Nase behält ihr Maß, die Endleiste
  // rückt. Gelöst per Halbierung, gilt auch, wenn die Rippe über einen Segmentstoß reicht.
  function setAngle(G, c, a) {
    const S = A(), k = Math.tan(S.clamp(+a || 0, -45, 45) * Math.PI / 180);
    const le = z => S.frame(G, z).le, te = z => { const f = S.frame(G, z); return f.le + f.c; };
    const dL = S.clamp(+c.rootInL || 0, 0, G.L), dT = S.clamp(+c.rootInT || 0, 0, G.L);
    const solve = (f, lo, hi) => { if (f(lo) >= 0) return lo; if (f(hi) <= 0) return hi; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; } return (lo + hi) / 2; };
    const r3 = v => Math.round(v * 1000) / 1000;
    if (k >= 0) c.rootInL = r3(solve(d => d - dT - k * (te(dT) - le(d)), dT, G.L));
    else c.rootInT = r3(solve(d => d - dL + k * (te(d) - le(dL)), dL, G.L));
  }
  function sidebar(box, H) {
    const S = A(), { numRow, hint, subhead, selectRow, txtRow } = App, c = S.cfg(), G = S.geo(); if (!G) return;
    const P = S.rootPlane(G, c);   // stellt auch einen Altstand (nur Winkel) auf die beiden Maße um
    // Stützrippen-Verteilung neu: Rippen vor der Wurzelrippe entfallen bzw. kommen zurück
    const again = () => { if (App.StegRippen && App.StegRippen.regenNow) App.StegRippen.regenNow(); H.refresh(); };
    const r1 = v => Math.round(v * 10) / 10, NM = { step: 1, min: 0, norender: true, enter: true };
    numRow(box, 'Nase eingerückt (mm)', () => r1(+c.rootInL || 0), v => { c.rootInL = S.clamp(v, 0, G.L); again(); }, NM);
    numRow(box, 'Endleiste eingerückt (mm)', () => r1(+c.rootInT || 0), v => { c.rootInT = S.clamp(v, 0, G.L); again(); }, NM);
    hint(box, 'Um so viel rücken Nase und Endleiste der Wurzelrippe in Spannweitenrichtung nach außen (ins Werkstück), z. B. bei einem Rumpf mit Einschnürung. Beide sind frei: gleich = parallel eingerückt, verschieden = schräg. 0 und 0 = Wurzelrippe an der Wurzel.');
    numRow(box, 'Wurzelrippe schräg (°)', () => (P ? Math.round(P.a * 100) / 100 : 0), v => { setAngle(G, c, v); again(); }, { step: 0.5, min: -45, max: 45, norender: true, enter: true });
    hint(box, 'Ergibt sich aus den beiden Maßen. Eingabe ändert eines davon: + = die Endleiste bleibt, die Nase rückt weiter nach außen; − = die Nase bleibt, die Endleiste rückt weiter nach außen.');
    if (P) hint(box, 'Stege, Steckung (Einbindetiefe ab der Wurzelrippe) sowie Gurt-, Scharnier- und Endleistenliste beginnen an der Wurzelrippe; was davor liegt, gehört nicht zum Werkstück. „Rechtwinklig zur Wurzelrippe“ bei Gurt und Steckung bleibt rechtwinklig zur Flugrichtung.');
    // Rippenkontur: bis wohin die Rippe reicht und ob sie den Holmgurt ausspart
    subhead(box, 'Rippenkontur', PART.rib.line);
    selectRow(box, 'Rippe reicht bis', c.layOn ? [['inner', 'Innenlage'], ['outer', 'Außenlage']] : [['inner', 'Schale innen'], ['outer', 'Außenkontur']], () => c.rootTo === 'outer' ? 'outer' : 'inner', v => { c.rootTo = v; H.upd(); });
    hint(box, c.layOn ? 'Innenlage: Die Rippe sitzt innen an der Schale. Außenlage: Die Rippe reicht bis an die Außenlage, Stützstoff und Innenlage enden an ihr.' : 'Schale innen: Die Rippe sitzt innen an der Schale. Außenkontur: Die Rippe hat die volle Profilkontur und deckt die Schale ab.');
    App.boolRow(box, 'Holmgurt ausgenommen', () => c.rootCapCut !== false, v => { c.rootCapCut = v; H.refresh(); }, 'An: Die Rippe spart den Holmgurt aus (Kontur an der Gurt-Innenfläche, seitlich mit Spiel), der Gurt läuft durch. Aus: Die Rippe geht über den Gurt hinweg bis zur gewählten Lage, der Gurt endet an der Rippe.');
    if (c.rootCapCut !== false) {
      const em = c.rootCapEdge === 'chamfer' || c.rootCapEdge === 'round' ? c.rootCapEdge : 'step', NE = { step: 0.5, min: 0, norender: true, enter: true };
      selectRow(box, 'Übergang zum Gurt', [['step', 'scharf (senkrecht)'], ['chamfer', 'abgeschrägt'], ['round', 'ausgerundet']], () => em, v => { c.rootCapEdge = v; H.refresh(); });
      if (em === 'chamfer') numRow(box, 'Breite der Schräge (mm)', () => (c.rootCapEdgeW != null ? +c.rootCapEdgeW : 3), v => { c.rootCapEdgeW = Math.max(0, v); H.upd(); }, NE);
      if (em === 'round') numRow(box, 'Radius (mm)', () => (c.rootCapEdgeR != null ? +c.rootCapEdgeR : 2), v => { c.rootCapEdgeR = Math.max(0, v); H.upd(); }, NE);
      const R1 = rootSec(G, c);
      if (em !== 'step') hint(box, T('Der Übergang liegt neben dem Gurt (außerhalb von Gurtbreite + Spiel), die Aussparung für den Gurt selbst bleibt voll tief. Abgeschrägt: gerade Schräge über diese Breite in der Rippenebene. Ausgerundet: Hohlkehle am Boden und Rundung oben, je mit diesem Radius.') + (R1 && R1.capDepth > 0 ? ' ' + T('Tiefe der Aussparung:') + ' ' + S.f1(R1.capDepth) + ' mm.' : ''));
    }
    numRow(box, 'Spiel Rippe zur Schale/zum Gurt (mm)', () => +c.rootGap || 0, v => { c.rootGap = Math.max(0, v); H.upd(); }, { step: 0.1, min: 0, norender: true, enter: true });
    // Bohrungen für Stecker, Bolzen …
    subhead(box, 'Bohrungen (Stecker, Bolzen …)', PART.rib.line);
    const HL = Array.isArray(c.rootHoles) ? c.rootHoles : (c.rootHoles = []), R0 = rootSec(G, c), uMid = R0 ? Math.round(R0.ulen * 0.5) : 50;
    const NB = { step: 0.5, min: -1e9, norender: true, enter: true }, NP = { step: 0.5, min: 0, norender: true, enter: true };
    HL.forEach((h, i) => {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:12px;margin-top:6px';
      const b = document.createElement('b'); b.textContent = (h.name && String(h.name).trim()) || T('Bohrung') + ' ' + (i + 1); b.style.flex = '1';
      const x = document.createElement('button'); x.textContent = '✕'; x.title = T('Bohrung löschen'); x.style.padding = '2px 7px';
      x.onclick = () => { HL.splice(i, 1); H.refresh(); };
      row.append(b, x); box.appendChild(row);
      txtRow(box, 'Name', () => h.name || '', v => { h.name = v; b.textContent = v.trim() || T('Bohrung') + ' ' + (i + 1); H.upd(); });   // je Tastendruck: ohne Neuaufbau
      selectRow(box, 'Form', [['round', 'rund'], ['rect', 'eckig']], () => h.shape === 'rect' ? 'rect' : 'round', v => {
        h.shape = v;
        if (v === 'rect' && !(+h.w > 0)) { h.w = Math.max(1, +h.d || 10); h.h = Math.max(1, +h.d || 6); if (h.r == null) h.r = 0; }
        if (v === 'round' && !(+h.d > 0)) h.d = Math.max(1, Math.min(+h.w || 6, +h.h || 6));
        H.refresh();
      });
      numRow(box, 'Mitte ab Nase (mm)', () => +h.x || 0, v => { h.x = v; H.upd(); }, NB);
      numRow(box, 'Mitte ab Profilmitte (mm, + = oben)', () => +h.y || 0, v => { h.y = v; H.upd(); }, NB);
      if (h.shape === 'rect') {
        numRow(box, 'Breite in Flugrichtung (mm)', () => +h.w || 0, v => { h.w = Math.max(0, v); H.upd(); }, NP);
        numRow(box, 'Höhe (mm)', () => +h.h || 0, v => { h.h = Math.max(0, v); H.upd(); }, NP);
        numRow(box, 'Eckenradius (mm)', () => +h.r || 0, v => { h.r = Math.max(0, v); H.upd(); }, NP);
      } else numRow(box, 'Durchmesser (mm)', () => +h.d || 0, v => { h.d = Math.max(0, v); H.upd(); }, NP);
    });
    const hb = document.createElement('div'); hb.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px';
    const addB = (t, o) => { const b = document.createElement('button'); b.textContent = T(t); b.onclick = () => { HL.push(Object.assign({ name: '', x: uMid, y: 0 }, o)); H.refresh(); }; hb.appendChild(b); };
    addB('Runde Bohrung hinzufügen', { shape: 'round', d: 6 });
    addB('Eckige Bohrung hinzufügen', { shape: 'rect', w: 20, h: 8, r: 0 });
    box.appendChild(hb);
    hint(box, 'Lage der Mitte in der Rippenebene ab der Nase der Wurzelrippe (wahre Länge, wie im CAD), Höhe ab der Mitte zwischen Ober- und Unterseite. Breite in Flugrichtung, Höhe senkrecht. Die Bohrungen gehören zur Kontur der Rippe (Ebene WURZELRIPPE).');
    // Bohrschablone: nur bei schräger Wurzelrippe
    if (P && Math.abs(P.k) > 1e-9) {
      subhead(box, 'Bohrschablone (schräge Wurzelrippe)', PART.rib.line);
      const J = c.rootJig && typeof c.rootJig === 'object' ? c.rootJig : (c.rootJig = {}), Rj = rootSec(G, c), TG = Rj ? jigTargets(Rj) : [];
      const cur = J.target === 'free' || TG.some(q => q.id === J.target) ? J.target : (TG[0] ? TG[0].id : 'free');
      const opts = TG.map(q => [q.id, q.name + ' (Ø ' + S.f1(q.d) + ' mm)']).concat([['free', T('frei (Lage eingeben)')]]);
      selectRow(box, 'Bohrung für', opts, () => cur, v => { J.target = v; delete J.d; delete J.w; delete J.h; H.refresh(); });
      const NJ = { step: 0.5, min: 0, norender: true, enter: true }, NF = { step: 0.5, min: -1e9, norender: true, enter: true }, Jd = jigData(G, c) || {};
      if (cur === 'free') {
        numRow(box, 'Mitte ab Nase (mm)', () => (J.u != null ? +J.u : (Rj ? Math.round(Rj.ulen / 2) : 50)), v => { J.u = v; H.upd(); }, NF);
        numRow(box, 'Mitte ab Profilmitte (mm, + = oben)', () => +J.y || 0, v => { J.y = v; H.upd(); }, NF);
      }
      numRow(box, 'Bohrungs-Ø (mm)', () => (Jd.d != null ? Math.round(Jd.d * 100) / 100 : 6), v => { J.d = Math.max(0.5, v); H.refresh(); }, NJ);
      numRow(box, 'Breite in Flugrichtung (mm)', () => (Jd.w != null ? Jd.w : 0), v => { J.w = Math.max(0, v); H.refresh(); }, NJ);
      numRow(box, 'Höhe (mm)', () => (Jd.h != null ? Jd.h : 0), v => { J.h = Math.max(0, v); H.refresh(); }, NJ);
      numRow(box, 'Führungslänge an der Bohrung (mm)', () => (J.l != null ? +J.l : 30), v => { J.l = Math.max(1, v); H.refresh(); }, NJ);
      if (Jd.L) {
        const inf = document.createElement('div'); inf.style.cssText = 'font-size:12px;margin-top:4px';
        inf.textContent = T('Anlagefläche schräg') + ' ' + S.f1(Jd.a) + '° · ' + T('Länge') + ' ' + S.f1(Jd.zMin) + ' … ' + S.f1(Jd.zMax) + ' mm' + (Math.abs(Jd.beta) > 1e-6 ? ' · ' + T('Bohrung mit V-Form') + ' ' + S.f1(Jd.beta * 180 / Math.PI) + '°' : '');
        box.appendChild(inf);
      }
      (Jd.warn || []).forEach(w => { const d = document.createElement('div'); d.textContent = w; d.style.cssText = 'font-size:12px;color:#ffb454'; box.appendChild(d); });
      hint(box, 'Quader mit Führungsbohrung, rechtwinklig zur Flugrichtung (bei der Hülse mit ihrer V-Form). Die schräge Seite passt genau an die Wurzelrippe und wird dort von außen angesetzt. Gedruckt mit der geraden Seite nach unten steht die Bohrung senkrecht. Breite/Höhe 0 = Bohrung + 16 mm.');
      if (App.exportViaPicker) { const jb = document.createElement('button'); jb.textContent = T('Bohrschablone als STL…'); jb.title = T('Bohrschablone mit STL-Vorschau speichern'); jb.style.marginTop = '4px'; jb.onclick = exportJig; box.appendChild(jb); }
    }
    const R = rootSec(G, c), info = document.createElement('div'); info.style.cssText = 'font-size:12px;margin-top:4px';
    info.textContent = R ? T('Wahre Länge der Wurzelrippe:') + ' ' + S.f1(R.ulen) + ' mm' : T('Keine Wurzelrippe vorhanden.');
    box.appendChild(info);
    if (R) R.warn.forEach(w => { const d = document.createElement('div'); d.textContent = w; d.style.cssText = 'font-size:12px;color:#ffb454'; box.appendChild(d); });
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:6px';
    const sb = document.createElement('button'); sb.textContent = T('Schnitt zeigen'); sb.title = T('Wurzelrippe als wahre Form unten im Fenster „Schnitte in Spannweite“'); sb.onclick = () => S.showRoot && S.showRoot(); bar.appendChild(sb);
    if (App.cadImportDxfText) { const b = document.createElement('button'); b.className = 'primary'; b.textContent = T('Wurzelrippe in CAD übernehmen'); b.title = T('Schnitt in der Ebene der Wurzelrippe (wahre Form) mit Schale/Lagen, Holmgurt, Stegen, Hülse, Steckung und Rippenkontur in den Reiter „CAD-Bearbeitung" laden, je Teil eine Ebene (ersetzt dessen Inhalt nach Rückfrage)'); b.onclick = toCad; bar.appendChild(b); }
    if (App.exportViaPicker) { const b = document.createElement('button'); b.textContent = T('Wurzelrippe als STL…'); b.title = T('Wurzelrippe als Körper exportieren: Dicke und Ausnehmungen (Holmgurt, Hülse, Bohrungen) abfragen, dann STL-Vorschau und Speichern'); b.onclick = stlDialog; bar.appendChild(b); }
    box.appendChild(bar);
    hint(box, 'Vor der Übernahme fragt ein Fenster, welche Teile ins CAD sollen (je Teil eine Ebene: PROFIL, SCHALE bzw. AUSSENLAGE/STUETZSTOFF/INNENLAGE, HOLMGURT, HOLMSTEGE, RUDERSTEGE, HUELSE, STECKUNG, WURZELRIPPE = Kontur mit Ausschnitt für die Hülse und den Bohrungen). x = wahre Länge ab der Nase der Wurzelrippe.');
  }

  App.StegWurzel = { sidebar, data, draw, toCad, dxfText, stlDialog, jig3d, exportJig, _test: { jigData, jigTris, rootSec, calc, bands, setAngle, pickParts, importCad, rshape, region, ribMesh, stlDialog, exportStl } };
})();
