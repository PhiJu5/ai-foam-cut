/* kernteile.js — Kerndesign: Kern in Stege zerlegen (Aufteilung wie im
 * Negativschalendesign, dieselbe Steg-Liste negStegeList/negStegeGap aus stege.js).
 *
 *   Es werden IMMER nur die Stege geschnitten (wie „Nur Stege schneiden" im
 *   Negativdesign) — der Block um das Profil ist Verschnitt.
 *
 * Geometrie im Kerndesign-Block (Blockzugaben, Blockhöhe, Nullpunkt blockOrigin);
 * Bahn über App.negShell (stegeOnly), Abbrand symmetrisch nach
 * außen wie im Negativdesign (Sehnenverhältnis, cutKerf). Holmausschnitte, Stapeln
 * und Werkstück-Drehung wirken in diesem Modus NICHT.
 * Gehört zur Funktion „stege" (features.json); Aufrufe von außen nur geschützt
 * (App.kernTeileOn && App.kernTeileOn()). */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;

  function kernTeileOn() { return !!state.cfg.coreStegeOn && !!App.stegePieces && !!App.negShell; }

  /* Geometrie des Segments idx: Steg-Bahn (st*) je Rippe als Nennbahn und als Drahtbahn (kerf-kompensiert), plus Maschinenbezug. */
  function ktGeom(idxArg) {
    const idx = idxArg != null ? idxArg : App.activeIdx();
    const cut = App.wing.cuts[Math.min(idx, App.wing.cuts.length - 1)];
    const seg = state.segments[Math.min(idx, state.segments.length - 1)];
    const pr = App.projectCut(cut, seg);
    const e = App.blockExt(seg, cut.root.chord, cut.tip.chord);
    const H = App.blockH(), cy = App.blockCenterY(cut);
    const base = (ovF, ovR) => ({ H, blockCy: cy, ovF, ovR, split: 0, cores: [], supOffsets: [],
      noseExt: state.cfg.negNoseExt, teStyle: state.cfg.negTeStyle || 'horizontal' });
    // Stege aus der Kernkontur (nach Beplankungsabzug, wie der normale Kernschnitt).
    const SR = App.stegePieces(pr.rootCore || cut.root.pts), ST = App.stegePieces(pr.tipCore || cut.tip.pts);
    const nomR = cut.root.pts, nomT = cut.tip.pts;
    const stR = App.negShell(nomR, Object.assign(base(e.leR, e.teR), { stege: SR, stegeOnly: true }));
    const stT = App.negShell(nomT, Object.assign(base(e.leT, e.teT), { stege: ST, stegeOnly: true }));
    const ck = App.cutKerf(cut.root.chord, cut.tip.chord);
    const kg = { gapR: ck.root / 2, gapT: ck.tip / 2 };
    const wire = (r, t) => {
      let rp = App.negShellOffset(r.path, kg.gapR), tp = App.negShellOffset(t.path, kg.gapT);
      App.negSnapNoseApex(rp, tp, r, t, kg);
      [rp, tp] = App.negDeloopSync(rp, tp);
      return { rp, tp };
    };
    const stW = wire(stR, stT);
    return { idx, cut, seg, pr, e, H, cy, SR, ST, stR, stT, stW, ck, nomR, nomT };
  }

  // Warnungen (Block-Hinterkante, Stegabstand ≤ Abbrand).
  function ktWarnings(G) {
    const w = [];
    const cR = App.stegeCheck(G.SR, G.nomR, 0, 0, G.ck.root / 2, G.stR.xBR);
    const cT = App.stegeCheck(G.ST, G.nomT, 0, 0, G.ck.tip / 2, G.stT.xBR);
    if (cR.over || cT.over) w.push(T('! Stege ragen über die Block-Hinterkante — Blockzugabe Endleiste vergrößern oder Stegabstand verkleinern'));
    if ((+state.cfg.negStegeGap || 0) <= Math.max(G.ck.root, G.ck.tip)) w.push(T('! Stegabstand kleiner als der Abbrand — benachbarte Stege werden angeschnitten'));
    if (G.SR.some(pc => pc.thin) || G.ST.some(pc => pc.thin)) w.push(T('! Steg zu dünn oder zu schmal (Abzüge größer als Profildicke/Stegbreite)'));
    if (state.cfg.sweepRot) w.push(T('Hinweis: Werkstück-Drehung wirkt bei zerlegtem Kern nicht'));
    return w;
  }

  function kernTeileGcode(idxArg) {
    const G = ktGeom(idxArg);
    const o = App.blockOrigin(G.cut, G.seg);
    const P = { ox: o.x, oy: o.y, sx: o.sx, zRoot: G.pr.zRoot, zTip: G.pr.zTip, mw: state.cfg.machineWidth };
    const ax = { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV };
    const f = v => v.toFixed(state.cfg.precision != null ? state.cfg.precision : 3);
    const heat = App.currentHeat();
    const out = [], em = s => out.push(window.I18N ? window.I18N.tc(s) : s);
    em('; ==== HotWing Kern in Stege zerlegt · 4-Achs Heißdraht G-Code ====');
    em('; ' + T('Achsen: L=') + ax.x + ax.y + '  R=' + ax.u + ax.v);
    em('; --- Segment ' + (G.idx + 1) + ' ---');
    em('; ' + T('Kern in ') + G.SR.length + T(' Stege zerlegt · Stegabstand ') + (state.cfg.negStegeGap || 0)
      + T(' mm · Nennbreiten Wurzel ') + G.SR.map(pc => pc.w.toFixed(1)).join(' + ') + ' mm'
      + T(' · Abbrand innen ') + G.ck.root.toFixed(2) + T(' / außen ') + G.ck.tip.toFixed(2) + ' mm');
    ktWarnings(G).forEach(w => em('; ' + w));
    em('; ' + T('erzeugt: ') + new Date().toISOString());
    em('G21 ; mm'); em('G90 ; absolut');
    if (heat != null) em('M3 S' + App.currentWireS() + ' ; ' + T('Drahtheizung EIN (') + heat + ' %)');
    if (state.cfg.header) state.cfg.header.split('\n').forEach(l => em(l));
    em(`G0 ${ax.x}${f(0)} ${ax.y}${f(0)} ${ax.u}${f(0)} ${ax.v}${f(0)} ; Start am Maschinennullpunkt`);
    const acc = { foam: 0, time: 0 };
    const cutContour = App.contourCutter(P, em, acc);
    cutContour(G.stW.rp, G.stW.tp, T('Kern-Stege'));
    em(`G0 ${ax.x}${f(0)} ${ax.y}${f(0)} ${ax.u}${f(0)} ${ax.v}${f(0)} ; zurück auf den Nullpunkt`);
    if (heat != null) em('M5 ; Drahtheizung AUS');
    em('M2 ; Ende');
    if (state.cfg.footer) state.cfg.footer.split('\n').forEach(l => em(l));
    return { text: out.join('\n'), lines: out.length, cutLengthFoam: acc.foam, estMinutes: acc.time };
  }

  /* Zusatz im Kerndesign-Profilfenster: Steg-Konturen (Wurzel durchgezogen,
   * Rand gestrichelt), Drahtbahn bei „Schnittspur", Beschriftung, Legende. */
  function kernTeileDraw(ctx, V, leg, o) {
    if (!kernTeileOn()) return;
    let G;
    try { G = ktGeom(o.idx); } catch (err) { leg.push(['#ff5a3c', T('Kern-Stege: Geometrie nicht berechenbar')]); return; }
    const sh = (P, dy) => dy ? P.map(p => ({ x: p.x, y: p.y + dy })) : P;
    const line = (P, col, dash, lw) => { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash(dash); App.poly(ctx, V, P, true); ctx.stroke(); };
    const loop = pc => pc.top.concat(pc.bot.slice().reverse());
    const cSt = '#ffd27f', cK = App.PAL.kerf || '#ff7a59';
    ctx.save();
    if (o.shR) G.SR.forEach(pc => line(sh(loop(pc), o.dyR), cSt, [], 1.6));
    if (o.shT) G.ST.forEach(pc => line(sh(loop(pc), o.dyT), cSt, [6, 4], 1.2));
    if (o.kerf) {
      if (o.shR) line(sh(G.stW.rp, o.dyR), cK, [], 1);
      if (o.shT) line(sh(G.stW.tp, o.dyT), cK, [4, 3], 1);
    }
    ctx.setLineDash([]);
    if (o.shR) {
      ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      G.SR.forEach(pc => {
        let yMax = -Infinity; pc.top.forEach(p => { if (p.y > yMax) yMax = p.y; });
        ctx.fillStyle = pc.thin ? '#ff5a3c' : cSt;
        ctx.fillText('S' + (pc.k + 1) + ' · ' + pc.w.toFixed(1) + ' mm', V.X((pc.xa + pc.xb) / 2 + pc.dx), V.Y(yMax + o.dyR) - 6);
      });
    }
    ctx.restore();
    leg.push([cSt, T('Kern-Stege: ') + G.SR.length + T(' Stücke · Nennbreiten (Wurzel) ') + G.SR.map(pc => pc.w.toFixed(1)).join(' + ')
      + T(' mm · Stegabstand ') + (state.cfg.negStegeGap || 0) + ' mm']);
    ktWarnings(G).forEach(w => leg.push([w.charAt(0) === '!' ? '#ff5a3c' : '#8b98a8', w]));
  }

  // ---------- Sidebar (Reiter Kerndesign) ------------------------------------
  function kernTeileSidebar(side) {
    const { grp, hint, boolRow, numRow, selectRow, buildSidebar } = App;
    const rr = () => App.render();
    const g = grp('Kern zerteilen (Stege)', true, 'core');
    hint(g.body, 'Zerlegt den Kern in einzelne Stege (Sehnen-Abschnitte) — gleiche Aufteilung wie im Negativschalendesign '
      + '(Steg-Liste und Stegabstand sind dieselben). Die Stege liegen im Block um den Stegabstand nach hinten auseinandergerückt, '
      + 'damit jeder Steg für sich um Abbrand/2 kompensiert wird; zusammengesetzt ergeben sie wieder das Kernprofil. '
      + 'Es werden nur die Stege geschnitten, der Block um das Profil ist Verschnitt. Ersetzt im G-Code den normalen Profilschnitt; Holmausschnitte, Stapeln und Werkstück-Drehung wirken dann nicht.');
    boolRow(g.body, 'Kern in Stege zerlegen', () => !!state.cfg.coreStegeOn, v => { state.cfg.coreStegeOn = v; buildSidebar(); rr(); });
    if (!state.cfg.coreStegeOn) { side.appendChild(g.g); return; }
    App.stegeListUi(g.body, rr);
    side.appendChild(g.g);
  }

  Object.assign(App, { kernTeileOn, kernTeileGcode, kernTeileDraw, kernTeileSidebar });
})();
