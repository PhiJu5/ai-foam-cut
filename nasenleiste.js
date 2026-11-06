/* nasenleiste.js — Kerndesign: Tasche für eine Vierkant-Nasenleiste.
 *
 *   Die Nase des Kerns wird durch eine quadratische Tasche ersetzt (Kantenlänge,
 *   Drehung, Einlasstiefe je Wurzel/Rand frei). Die Vierkantleiste wird später
 *   eingeklebt und auf Profilform verschliffen. Die Bahn fährt auf der einen
 *   Profilseite in die Tasche, an deren hinteren Kanten entlang und auf der
 *   anderen Seite wieder hinaus — alles im selben Zug wie der Kernschnitt; die
 *   Nasenspitze davor (inkl. Nasen-Verlängerung) fällt als Verschnitt weg.
 *
 *   Abbrand: die Tasche wird um Abbrand/2 je Rippe nach innen versetzt (fertige
 *   Tasche = Kantenlänge + Spiel). Wurzel und Rand behalten gleich viele Punkte
 *   (Türme synchron). Nur Kerndesign (state.cfg.noseBar*, je Tragfläche).
 *   Aufrufe von außen nur geschützt (App.noseBarApply && …). */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;
  const C = () => state.cfg;
  const num = (v, d) => (v == null || !isFinite(+v)) ? d : +v;

  function noseBarOn() { return !!C().noseBarOn; }
  function params() {
    const c = C();
    const aR = Math.max(0.5, num(c.noseBarA, 10)), aT = Math.max(0.5, num(c.noseBarATip, aR));
    return {
      aR, aT,
      dR: Math.max(0, num(c.noseBarDepth, 8)), dT: Math.max(0, num(c.noseBarDepthTip, num(c.noseBarDepth, 8))),
      rot: num(c.noseBarRot, 45), gap: Math.max(0, num(c.noseBarGap, 0.2))
    };
  }

  // Profil-Nase (kleinstes x) und Mittellinien-Höhe bei x.
  function noseOf(P) { let k = 0; for (let i = 1; i < P.length; i++) if (P[i].x < P[k].x) k = i; return P[k]; }
  function camberAt(P, x) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      if ((a.x - x) * (b.x - x) > 0 || a.x === b.x) continue;
      const y = a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
      if (y < lo) lo = y; if (y > hi) hi = y;
    }
    return isFinite(lo) ? (lo + hi) / 2 : null;
  }
  /* Quadrat (Ecken gegen den Uhrzeigersinn) für Profil P: Kantenlänge a, Einlasstiefe d
   * (hinterster Punkt der Leiste hinter der Nase), Drehung rot, Halbkante-Zugabe add. */
  function square(P, a, d, rot, add) {
    const n = noseOf(P), th = rot * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
    const hx = a / 2 * (Math.abs(c) + Math.abs(s));
    const xc = n.x + d - hx;
    let yc = camberAt(P, Math.max(xc, n.x + 1e-3));
    if (yc == null) yc = n.y;
    const h = a / 2 + add;
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({ x: xc + h * (u * c - v * s), y: yc + h * (u * s + v * c) }));
  }
  function inside(Q, p) {
    for (let k = 0; k < 4; k++) {
      const a = Q[k], b = Q[(k + 1) % 4];
      if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < 0) return false;
    }
    return true;
  }
  // Schnittpunkt Strecke p→q mit Quadratrand; nearP: den p-nächsten nehmen.
  function hit(Q, p, q, nearP) {
    let best = null;
    for (let k = 0; k < 4; k++) {
      const a = Q[k], b = Q[(k + 1) % 4];
      const rx = q.x - p.x, ry = q.y - p.y, sx = b.x - a.x, sy = b.y - a.y;
      const den = rx * sy - ry * sx; if (Math.abs(den) < 1e-12) continue;
      const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / den, u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / den;
      if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue;
      const sc = nearP ? t : 1 - t;
      if (!best || sc < best.sc) best = { sc, e: k, p: { x: p.x + rx * t, y: p.y + ry * t } };
    }
    return best;
  }
  // Ein- und Austritt der offenen Bahn P in das Quadrat Q.
  function crossings(P, Q) {
    let iE = -1, iX = -1;
    for (let i = 0; i < P.length - 1; i++) if (!inside(Q, P[i]) && inside(Q, P[i + 1])) { iE = i; break; }
    for (let i = P.length - 2; i >= 0; i--) if (inside(Q, P[i]) && !inside(Q, P[i + 1])) { iX = i; break; }
    if (iE < 0 || iX < 0 || iX < iE) return null;
    const hE = hit(Q, P[iE], P[iE + 1], false), hX = hit(Q, P[iX], P[iX + 1], true);
    if (!hE || !hX) return null;
    // Weg am Quadratrand: die Richtung, die NICHT über die vordere (Nasen-)Ecke führt.
    const fwd = [], bwd = [];
    for (let k = hE.e; k !== hX.e; k = (k + 1) % 4) fwd.push(Q[(k + 1) % 4]);
    for (let k = hE.e; k !== hX.e; k = (k + 3) % 4) bwd.push(Q[k]);
    const mx = L => L.length ? L.reduce((s, p) => s + p.x, 0) / L.length : (hE.p.x + hX.p.x) / 2;
    const corners = mx(fwd) >= mx(bwd) ? fwd : bwd;
    return { iE, iX, entry: hE.p, exit: hX.p, corners };
  }
  // Polylinie gleichmäßig nach Bogenlänge: m Punkte bei t = j/m (j = 1..m).
  function resample(L, m) {
    const cum = [0];
    for (let i = 1; i < L.length; i++) cum.push(cum[i - 1] + Math.hypot(L[i].x - L[i - 1].x, L[i].y - L[i - 1].y));
    const tot = cum[cum.length - 1], out = [];
    let i = 1;
    for (let j = 1; j <= m; j++) {
      const s = tot * j / m;
      while (i < L.length - 1 && cum[i] < s) i++;
      const seg = cum[i] - cum[i - 1], t = seg > 1e-12 ? (s - cum[i - 1]) / seg : 1;
      out.push({ x: L[i - 1].x + (L[i].x - L[i - 1].x) * t, y: L[i - 1].y + (L[i].y - L[i - 1].y) * t });
    }
    return out;
  }
  const NE = 12;   // Punkte je Taschenkante

  /* Bahn einrechnen (compute.js projectCut, nach den Holmausschnitten). */
  function noseBarApply(pr, cut) {
    if (!noseBarOn() || !pr || !pr.rootPath || state.cfg.sparOnly) return pr;
    try {
      const p = params();
      const ck = App.cutKerf(cut.root.chord, cut.tip.chord), ki = pr.kerfInfo || {};
      const khR = (ki.root != null ? ki.root : ck.root) / 2, khT = (ki.tip != null ? ki.tip : ck.tip) / 2;
      const QR = square(cut.root.pts, p.aR, p.dR, p.rot, p.gap / 2 - khR);
      const QT = square(cut.tip.pts, p.aT, p.dT, p.rot, p.gap / 2 - khT);
      const root = pr.rootPath.slice(0, -1), tip = pr.tipPath.slice(0, -1);
      if (root.length !== tip.length) return pr;
      const cR = crossings(root, QR), cT = crossings(tip, QT);
      if (!cR || !cT) return Object.assign({}, pr, { noseBarErr: true });
      const iA = Math.min(cR.iE, cT.iE), iB = Math.max(cR.iX, cT.iX) + 1;
      if (iB >= root.length) return pr;
      const n1 = Math.max(cR.iE, cT.iE) - iA + 1, n2 = iB - Math.min(cR.iX, cT.iX);
      const same = cR.corners.length === cT.corners.length;
      const chainOf = (P, c) => {
        const pre = P.slice(iA, c.iE + 1).concat([c.entry]);
        const ring = [c.entry].concat(c.corners, [c.exit]);
        const post = [c.exit].concat(P.slice(c.iX + 1, iB + 1));
        return { pre, ring, post };
      };
      const build = (P, c, M) => {
        const ch = chainOf(P, c);
        if (!same) return resample(ch.pre.concat(ch.ring.slice(1), ch.post.slice(1)), M);
        let out = resample(ch.pre, n1);
        for (let k = 0; k < ch.ring.length - 1; k++) out = out.concat(resample([ch.ring[k], ch.ring[k + 1]], NE));
        return out.concat(resample(ch.post, n2));
      };
      const M = n1 + n2 + NE * (cR.corners.length + 1);
      const kOf = P => P[iA].k;
      const nr = build(root, cR, M), nt = build(tip, cT, M);
      if (nr.length !== nt.length) return pr;
      const kr = kOf(root), kt = kOf(tip);
      if (kr != null) nr.forEach(q => { q.k = kr; });
      if (kt != null) nt.forEach(q => { q.k = kt; });
      root.splice(iA + 1, iB - iA, ...nr);
      tip.splice(iA + 1, iB - iA, ...nt);
      const rootPath = root.concat([{ x: root[0].x, y: root[0].y }]);
      const tipPath = tip.concat([{ x: tip[0].x, y: tip[0].y }]);
      const zR = pr.zRoot, zT = pr.zTip, mw = state.cfg.machineWidth;
      const prj = (vr, vt, zp) => vr + ((zp - zR) / ((zT - zR) || 1)) * (vt - vr);
      const left = [], right = [];
      for (let k = 0; k < rootPath.length; k++) {
        const r = rootPath[k], t = tipPath[k];
        left.push({ x: prj(r.x, t.x, 0), y: prj(r.y, t.y, 0) });
        right.push({ x: prj(r.x, t.x, mw), y: prj(r.y, t.y, mw) });
      }
      return Object.assign({}, pr, { rootPath, tipPath, left, right });
    } catch (e) { return pr; }
  }

  /* Vorschau im Kerndesign: Nennlage der Leiste (Kantenlänge, ohne Spiel). */
  function noseBarDraw(ctx, V, leg, o) {
    if (!noseBarOn()) return;
    const cut = App.wing && App.wing.cuts[Math.min(o.idx, App.wing.cuts.length - 1)];
    if (!cut) return;
    const p = params(), col = '#c8a165';
    const sh = (Q, dy) => Q.map(q => ({ x: q.x, y: q.y + dy }));
    ctx.save();
    ctx.lineWidth = 1.4; ctx.strokeStyle = col; ctx.fillStyle = 'rgba(200,161,101,0.18)';
    const draw = (Q, dash) => { ctx.setLineDash(dash); App.poly(ctx, V, Q, true); ctx.fill(); ctx.stroke(); };
    if (o.shR) draw(sh(square(cut.root.pts, p.aR, p.dR, p.rot, 0), o.dyR), []);
    if (o.shT) draw(sh(square(cut.tip.pts, p.aT, p.dT, p.rot, 0), o.dyT), [5, 3]);
    ctx.restore();
    leg.push([col, T('Nasenleiste (Vierkant) ') + p.aR.toFixed(1) + ' / ' + p.aT.toFixed(1) + T(' mm · Drehung ') + p.rot + '°']);
    if (o.err) leg.push(['#ff5a3c', T('! Nasenleiste: Tasche schneidet die Profilbahn nicht — Einlasstiefe oder Kantenlänge prüfen')]);
  }

  // ---------- Seitenleiste (Reiter Kerndesign) -------------------------------
  function noseBarSidebar(side) {
    const { grp, hint, boolRow, numRow, buildSidebar } = App;
    const c = C();
    const g = grp('Nasenleiste (Vierkant)', false, 'core');
    hint(g.body, 'Schneidet an der Nase eine quadratische Tasche in den Kern, in die eine Vierkantleiste (z. B. Balsa) eingeklebt '
      + 'und danach auf Profilform verschliffen wird. Die Tasche läuft im selben Zug wie der Kernschnitt; die Nasenspitze davor '
      + 'fällt als Verschnitt weg. Der Abbrand wird nach innen ausgeglichen (fertige Tasche = Kantenlänge + Spiel).');
    boolRow(g.body, 'Nasenleiste einschneiden', () => !!c.noseBarOn, v => { c.noseBarOn = v; buildSidebar(); });
    if (c.noseBarOn) {
      const p = params();
      numRow(g.body, 'Kantenlänge Wurzel (mm)', () => p.aR, v => { c.noseBarA = Math.max(0.5, v); }, { step: 0.5, min: 0.5, enter: true });
      numRow(g.body, 'Kantenlänge Rand (mm)', () => p.aT, v => { c.noseBarATip = Math.max(0.5, v); }, { step: 0.5, min: 0.5, enter: true });
      numRow(g.body, 'Einlasstiefe Wurzel (mm)', () => p.dR, v => { c.noseBarDepth = Math.max(0, v); },
        { step: 0.5, min: 0, enter: true, hint: 'Wie weit die Leiste hinter die Profilnase in den Kern reicht (hinterster Punkt der Tasche). Kleinere Werte = mehr Überstand vor der Nase zum Verschleifen.' });
      numRow(g.body, 'Einlasstiefe Rand (mm)', () => p.dT, v => { c.noseBarDepthTip = Math.max(0, v); }, { step: 0.5, min: 0, enter: true });
      numRow(g.body, 'Drehung (°)', () => p.rot, v => { c.noseBarRot = v; },
        { step: 5, enter: true, hint: '45° = über Eck (Spitze nach vorne), 0° = Kanten parallel zur Sehne.' });
      numRow(g.body, 'Spiel / Klebefuge (mm)', () => p.gap, v => { c.noseBarGap = Math.max(0, v); }, { step: 0.1, min: 0, enter: true });
    }
    side.appendChild(g.g);
  }

  Object.assign(App, { noseBarOn, noseBarApply, noseBarDraw, noseBarSidebar });
})();
