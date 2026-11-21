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
      rot: num(c.noseBarRot, 45), gap: Math.max(0, num(c.noseBarGap, 0.2)),
      // 'square' = Vierkant-Tasche, 'cut' = gerader Nasenabschnitt (Balsa-Nasenleiste aufkleben)
      shape: c.noseBarShape === 'cut' ? 'cut' : 'square'
    };
  }
  /* Geltungsbereich wie bei Holmen (seit 2026-11-14):
   *   'wing'   = ganze Tragfläche: Wurzelwert an der Wurzelrippe, Randwert an der
   *              äußersten Rippe, dazwischen linear über die Spannweite;
   *   'groups' = Segmentgruppen (cfg.noseBarGroups [{from, to, a, aTip, d, dTip}]):
   *              je Gruppe eigene Werte innen/außen, linear über die Gruppe; Segmente
   *              ohne Gruppe bekommen keinen Nasenabschnitt (erste passende Gruppe gilt).
   * Früher galten Wurzel/Rand je Segment (Sprung am Segmentstoß). */
  function spanMode() { return C().noseBarSpan === 'groups' && state.segments.length > 1 ? 'groups' : 'wing'; }
  function grpRange(g) {
    const n = state.segments.length - 1, cl = v => Math.max(0, Math.min(n, v | 0));
    const a = cl(g.from), b = cl(g.to);
    return a <= b ? [a, b] : [b, a];
  }
  function newGroup(from, to) { const p = params(); return { from, to, a: p.aR, aTip: p.aT, d: p.dR, dTip: p.dT }; }
  function groups() {
    const c = C();
    if (!Array.isArray(c.noseBarGroups) || !c.noseBarGroups.length) c.noseBarGroups = [newGroup(0, state.segments.length - 1)];
    return c.noseBarGroups;
  }
  function segZ(i) { let z = 0; for (let k = 0; k < i; k++) z += +state.segments[k].span || 0; return z; }
  function spanOf(i) { return +(state.segments[i] && state.segments[i].span) || 0; }
  // Kantenlänge a und Tiefe d an der Stelle t (0 = Wurzel-, 1 = Randrippe) des Segments
  // segIdx; null = dort kein Nasenabschnitt.
  function noseBarAt(segIdx, t) {
    const n = state.segments.length;
    if (!(segIdx >= 0 && segIdx < n)) return null;
    const p = params();
    let r, A, AT, D, DT;
    if (spanMode() === 'groups') {
      const g = (C().noseBarGroups || []).find(q => { const ab = grpRange(q); return segIdx >= ab[0] && segIdx <= ab[1]; });
      if (!g) return null;
      r = grpRange(g);
      A = Math.max(0.5, num(g.a, p.aR)); AT = Math.max(0.5, num(g.aTip, A));
      D = Math.max(0, num(g.d, p.dR)); DT = Math.max(0, num(g.dTip, D));
    } else { r = [0, n - 1]; A = p.aR; AT = p.aT; D = p.dR; DT = p.dT; }
    const za = segZ(r[0]), zb = segZ(r[1]) + spanOf(r[1]);
    const z = segZ(segIdx) + Math.max(0, Math.min(1, +t || 0)) * spanOf(segIdx);
    const f = zb > za ? Math.max(0, Math.min(1, (z - za) / (zb - za))) : 0;
    return { a: A + (AT - A) * f, d: D + (DT - D) * f };
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
  /* Gerader Nasenabschnitt: senkrechte Fläche bei x = Nase + d (Fertigmaß). Die
   * Drahtbahn liegt um den halben Abbrand davor (auf der Verschnittseite), damit
   * die fertige Fläche genau bei Nase + d steht. Das „Quadrat" ist ein großes
   * Rechteck vor der Fläche -> crossings() liefert Ein-/Austritt an der Fläche,
   * ohne Ecken = gerade Linie oben -> unten. */
  function cutBox(P, d, kh) {
    const n = noseOf(P), xf = n.x + d - kh, B = 1e4;
    return [{ x: n.x - B, y: -B }, { x: xf, y: -B }, { x: xf, y: B }, { x: n.x - B, y: B }];
  }
  function surfAt(P, x) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      if ((a.x - x) * (b.x - x) > 0 || a.x === b.x) continue;
      const y = a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
      if (y < lo) lo = y; if (y > hi) hi = y;
    }
    return isFinite(lo) ? { lo, hi } : null;
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

  /* Bahn einrechnen (compute.js projectCut, nach den Holmausschnitten).
   * segIdx = Segment des Schnitts (Werte nach Lage in Tragfläche bzw. Segmentgruppe). */
  function noseBarApply(pr, cut, segIdx) {
    if (!noseBarOn() || !pr || !pr.rootPath || state.cfg.sparOnly) return pr;
    try {
      const p = params(), vR = noseBarAt(segIdx, 0), vT = noseBarAt(segIdx, 1);
      if (!vR || !vT) return pr;   // Segment außerhalb der Segmentgruppen
      const ck = App.cutKerf(cut.root.chord, cut.tip.chord), ki = pr.kerfInfo || {};
      const khR = (ki.root != null ? ki.root : ck.root) / 2, khT = (ki.tip != null ? ki.tip : ck.tip) / 2;
      const QR = p.shape === 'cut' ? cutBox(cut.root.pts, vR.d, khR) : square(cut.root.pts, vR.a, vR.d, p.rot, p.gap / 2 - khR);
      const QT = p.shape === 'cut' ? cutBox(cut.tip.pts, vT.d, khT) : square(cut.tip.pts, vT.a, vT.d, p.rot, p.gap / 2 - khT);
      const root = pr.rootPath.slice(0, -1), tip = pr.tipPath.slice(0, -1);
      if (root.length !== tip.length) return pr;
      const cR = crossings(root, QR), cT = crossings(tip, QT);
      if (!cR || !cT) return Object.assign({}, pr, { noseBarErr: true });
      const iA = Math.min(cR.iE, cT.iE), iB = Math.max(cR.iX, cT.iX) + 1;
      if (iB >= root.length) return pr;
      const n1 = Math.max(cR.iE, cT.iE) - iA + 1, n2 = iB - Math.min(cR.iX, cT.iX);
      const maxC = Math.max(cR.corners.length, cT.corners.length);
      const chainOf = (P, c) => {
        const pre = P.slice(iA, c.iE + 1).concat([c.entry]);
        const ring = [c.entry].concat(c.corners, [c.exit]);
        const post = [c.exit].concat(P.slice(c.iX + 1, iB + 1));
        return { pre, ring, post };
      };
      const build = (P, c, M) => {
        const ch = chainOf(P, c);
        // Ein-/Austritt und Ecken immer exakt treffen (sonst läuft die Bahn schräg in
        // die Tasche statt senkrecht). Ungleiche Eckenzahl: Punkte je Kante verteilen.
        let out = resample(ch.pre, n1);
        const nE = ch.ring.length - 1, R = NE * (maxC + 1);
        const cnt = new Array(nE).fill(Math.floor(R / nE));
        for (let k = 0; k < R - cnt[0] * nE; k++) cnt[k]++;
        for (let k = 0; k < nE; k++) out = out.concat(resample([ch.ring[k], ch.ring[k + 1]], cnt[k]));
        return out.concat(resample(ch.post, n2));
      };
      const M = n1 + n2 + NE * (maxC + 1);
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

  /* Rippendesigner (ribs.js): derselbe Nasenabschnitt für eine Rippe, als FERTIGMASS
   * (Rippen werden gefräst/gelasert, kein Drahtabbrand; Tasche = Kantenlänge + Spiel).
   * ref = Außenprofil der Rippe (Nase und Mittellinie wie beim Kern), segIdx/f = Segment
   * und Lage darin (0 = Wurzel-, 1 = Randrippe; Werte wie beim Kernschnitt über
   * noseBarAt). Rückgabe null (aus / Segment ohne Gruppe) oder { bar, clip(poly) }:
   * bar = Nennlage der Leiste (Anzeige, nur Vierkant), clip = Rippenkontur mit Tasche
   * bzw. Abschnitt (null, wenn die Kontur das Quadrat nicht kreuzt). */
  function noseBarRib(ref, segIdx, f) {
    if (!noseBarOn() || !ref || ref.length < 3) return null;
    const p = params(), v = noseBarAt(segIdx, f);
    if (!v) return null;
    const Q = p.shape === 'cut' ? cutBox(ref, v.d, 0) : square(ref, v.a, v.d, p.rot, p.gap / 2);
    return { shape: p.shape, bar: p.shape === 'cut' ? null : square(ref, v.a, v.d, p.rot, 0), clip: poly => clipLoop(poly, Q) };
  }
  // Geschlossene Kontur: ab dem hintersten Punkt (Endleiste) als offene Bahn umlaufen,
  // Ein-/Austritt ins Quadrat wie beim Kernschnitt (crossings), Stück dazwischen
  // (Nase) durch die hinteren Quadratkanten ersetzen.
  function clipLoop(poly, Q) {
    if (!poly || poly.length < 3) return null;
    let k = 0; for (let i = 1; i < poly.length; i++) if (poly[i].x > poly[k].x) k = i;
    const L = poly.slice(k).concat(poly.slice(0, k + 1));
    const c = crossings(L, Q); if (!c) return null;
    const out = L.slice(0, c.iE + 1).concat([c.entry], c.corners.map(q => ({ x: q.x, y: q.y })), [c.exit], L.slice(c.iX + 1, L.length - 1));
    if (out.length < 3) return null;
    out.closed = true;
    return out;
  }

  /* Vorschau im Kerndesign: Nennlage der Leiste (Kantenlänge, ohne Spiel). */
  function noseBarDraw(ctx, V, leg, o) {
    if (!noseBarOn()) return;
    const cut = App.wing && App.wing.cuts[Math.min(o.idx, App.wing.cuts.length - 1)];
    if (!cut) return;
    const p = params(), col = '#c8a165';
    const vR = noseBarAt(o.idx, 0), vT = noseBarAt(o.idx, 1);
    if (!vR || !vT) { leg.push([col, T('Nasenabschnitt: dieses Segment liegt in keiner Segmentgruppe')]); return; }
    const sh = (Q, dy) => Q.map(q => ({ x: q.x, y: q.y + dy }));
    ctx.save();
    ctx.lineWidth = 1.4; ctx.strokeStyle = col; ctx.fillStyle = 'rgba(200,161,101,0.18)';
    const draw = (Q, dash) => { ctx.setLineDash(dash); App.poly(ctx, V, Q, true); ctx.fill(); ctx.stroke(); };
    if (p.shape === 'cut') {
      const face = (P, d, dy, dash) => {
        const x = noseOf(P).x + d, s = surfAt(P, x); if (!s) return;
        ctx.setLineDash(dash); ctx.lineWidth = 2;
        App.poly(ctx, V, [{ x, y: s.lo + dy }, { x, y: s.hi + dy }], false); ctx.stroke();
      };
      if (o.shR) face(cut.root.pts, vR.d, o.dyR, []);
      if (o.shT) face(cut.tip.pts, vT.d, o.dyT, [5, 3]);
      ctx.restore();
      leg.push([col, T('Nasenabschnitt ') + vR.d.toFixed(1) + ' / ' + vT.d.toFixed(1) + T(' mm hinter der Nase')]);
      if (o.err) leg.push(['#ff5a3c', T('! Nasenabschnitt: Schnittfläche trifft die Profilbahn nicht — Abstand prüfen')]);
      return;
    }
    if (o.shR) draw(sh(square(cut.root.pts, vR.a, vR.d, p.rot, 0), o.dyR), []);
    if (o.shT) draw(sh(square(cut.tip.pts, vT.a, vT.d, p.rot, 0), o.dyT), [5, 3]);
    ctx.restore();
    leg.push([col, T('Nasenleiste (Vierkant) ') + vR.a.toFixed(1) + ' / ' + vT.a.toFixed(1) + T(' mm · Drehung ') + p.rot + '°']);
    if (o.err) leg.push(['#ff5a3c', T('! Nasenleiste: Tasche schneidet die Profilbahn nicht — Einlasstiefe oder Kantenlänge prüfen')]);
  }

  // ---------- Seitenleiste (Reiter Kerndesign) -------------------------------
  function noseBarSidebar(side) {
    const { grp, hint, boolRow, numRow, buildSidebar } = App;
    const c = C();
    const g = grp('Nasenabschnitt', false, 'core');
    hint(g.body, 'Schneidet an der Nase eine quadratische Tasche in den Kern, in die eine Vierkantleiste (z. B. Balsa) eingeklebt '
      + 'und danach auf Profilform verschliffen wird. Die Tasche läuft im selben Zug wie der Kernschnitt; die Nasenspitze davor '
      + 'fällt als Verschnitt weg. Der Abbrand wird nach innen ausgeglichen (fertige Tasche = Kantenlänge + Spiel).');
    boolRow(g.body, 'Nasenleiste einschneiden', () => !!c.noseBarOn, v => { c.noseBarOn = v; buildSidebar(); });
    if (c.noseBarOn) App.selectRow(g.body, 'Form',
      [['square', 'Vierkant-Tasche'], ['cut', 'Gerader Nasenabschnitt']],
      () => params().shape, v => { c.noseBarShape = v; buildSidebar(); },
      '„Gerader Nasenabschnitt": die Nase wird senkrecht abgeschnitten, z. B. um eine Balsa-Nasenleiste stumpf aufzukleben. '
      + 'Der Abbrand wird ausgeglichen: die fertige Schnittfläche liegt genau im eingestellten Abstand hinter der Nase.');
    if (c.noseBarOn) {
      const p = params(), isCut = p.shape === 'cut', nSeg = state.segments.length;
      const reb = () => { buildSidebar(); if (App.render) App.render(); };
      if (nSeg > 1) App.selectRow(g.body, 'Gilt für', [['wing', 'Ganze Tragfläche'], ['groups', 'Segmentgruppen']],
        () => spanMode(), v => { c.noseBarSpan = v; if (v === 'groups') groups(); reb(); },
        'Wie bei den Holmen: „Ganze Tragfläche" = Wurzelwert an der Wurzelrippe, Randwert an der äußersten Rippe, dazwischen '
        + 'linear über die Spannweite. „Segmentgruppen" = je Gruppe (Segment von–bis) eigene Werte innen/außen; Segmente ohne '
        + 'Gruppe bekommen keinen Nasenabschnitt.');
      const dHint = isCut ? 'Abstand der fertigen Schnittfläche hinter der Profilnase (= Dicke der Nasenleiste vor dem Verschleifen).'
        : 'Wie weit die Leiste hinter die Profilnase in den Kern reicht (hinterster Punkt der Tasche). Kleinere Werte = mehr Überstand vor der Nase zum Verschleifen.';
      if (spanMode() === 'wing') {
        if (isCut) {
          numRow(g.body, 'Abschnitt hinter der Nase Wurzel (mm)', () => p.dR, v => { c.noseBarDepth = Math.max(0, v); },
            { step: 0.5, min: 0, enter: true, hint: dHint });
          numRow(g.body, 'Abschnitt hinter der Nase Rand (mm)', () => p.dT, v => { c.noseBarDepthTip = Math.max(0, v); }, { step: 0.5, min: 0, enter: true });
        } else {
          numRow(g.body, 'Kantenlänge Wurzel (mm)', () => p.aR, v => { c.noseBarA = Math.max(0.5, v); }, { step: 0.5, min: 0.5, enter: true });
          numRow(g.body, 'Kantenlänge Rand (mm)', () => p.aT, v => { c.noseBarATip = Math.max(0.5, v); }, { step: 0.5, min: 0.5, enter: true });
          numRow(g.body, 'Einlasstiefe Wurzel (mm)', () => p.dR, v => { c.noseBarDepth = Math.max(0, v); },
            { step: 0.5, min: 0, enter: true, hint: dHint });
          numRow(g.body, 'Einlasstiefe Rand (mm)', () => p.dT, v => { c.noseBarDepthTip = Math.max(0, v); }, { step: 0.5, min: 0, enter: true });
        }
      } else {
        const segOpts = state.segments.map((s, i) => [String(i), 'Segment ' + (i + 1)]);
        const G = groups();
        G.forEach((q, i) => {
          App.subhead(g.body, T('Gruppe ') + (i + 1));
          App.selectRow(g.body, 'Von Segment (Wurzel)', segOpts, () => String(grpRange(q)[0]),
            v => { q.from = +v; if ((q.to | 0) < q.from) q.to = q.from; reb(); });
          App.selectRow(g.body, 'Bis Segment (Außen)', segOpts, () => String(grpRange(q)[1]),
            v => { q.to = +v; if ((q.from | 0) > q.to) q.from = q.to; reb(); });
          if (!isCut) {
            numRow(g.body, 'Kantenlänge innen (mm)', () => num(q.a, p.aR), v => { q.a = Math.max(0.5, v); }, { step: 0.5, min: 0.5, enter: true });
            numRow(g.body, 'Kantenlänge außen (mm)', () => num(q.aTip, num(q.a, p.aR)), v => { q.aTip = Math.max(0.5, v); }, { step: 0.5, min: 0.5, enter: true });
          }
          numRow(g.body, isCut ? 'Abschnitt hinter der Nase innen (mm)' : 'Einlasstiefe innen (mm)', () => num(q.d, p.dR),
            v => { q.d = Math.max(0, v); }, { step: 0.5, min: 0, enter: true, hint: dHint });
          numRow(g.body, isCut ? 'Abschnitt hinter der Nase außen (mm)' : 'Einlasstiefe außen (mm)', () => num(q.dTip, num(q.d, p.dR)),
            v => { q.dTip = Math.max(0, v); }, { step: 0.5, min: 0, enter: true });
          if (G.length > 1) g.body.appendChild(App.mkMini(T('Gruppe löschen'), () => { G.splice(i, 1); reb(); }));
        });
        g.body.appendChild(App.mkMini(T('+ Gruppe'), () => {
          const last = G[G.length - 1], from = last ? Math.min(nSeg - 1, grpRange(last)[1] + 1) : 0;
          G.push(newGroup(from, nSeg - 1)); reb();
        }));
        hint(g.body, 'Innen = Wurzelrippe von „Von Segment", außen = äußerste Rippe von „Bis Segment"; dazwischen linear über die Spannweite. '
          + 'Überschneiden sich Gruppen, gilt die erste.');
      }
      if (!isCut) {
        numRow(g.body, 'Drehung (°)', () => p.rot, v => { c.noseBarRot = v; },
          { step: 5, enter: true, hint: '45° = über Eck (Spitze nach vorne), 0° = Kanten parallel zur Sehne.' });
        numRow(g.body, 'Spiel / Klebefuge (mm)', () => p.gap, v => { c.noseBarGap = Math.max(0, v); }, { step: 0.1, min: 0, enter: true });
      }
    }
    side.appendChild(g.g);
  }

  Object.assign(App, { noseBarOn, noseBarApply, noseBarDraw, noseBarSidebar, noseBarRib, noseBarAt });
})();
