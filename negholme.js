/* negholme.js — Holmausschnitte im Kern des Negativschalendesigns.
 * Mit „Kern mitschneiden" werden EIGENE Holme (cfg.negSpars, getrennt von
 * Kerndesign/Tragflächendesigner) wie im Kerndesign als Abstecher „während des Schnitts" in die
 * Kernbahn eingerechnet: Anfahr-Schlitz von der Kernoberfläche, einmal um die
 * Tasche, über denselben Schlitz zurück. Ist der Kern in Stege zerlegt (stege.js),
 * gehört jeder Holm zu genau einem Kernteil (sp.negSteg, sonst automatisch nach
 * Lage) und wird mit diesem Steg um dessen Stegabstand verschoben geschnitten;
 * Höhe/Klemmung beziehen sich dann auf die Stegkontur (inkl. Glasschlauch/Gurt).
 * Eingefügt wird NACH dem Abbrand-Versatz der Gesamtbahn auf der Teilbahn des
 * Kerns bzw. Stegs (Bahnindizes aus negShell: coreRange / stegRanges) — am
 * gleichen Index für Wurzel und Rand -> Türme synchron. Gurttaschen (Tasche /
 * Tasche + Steg) werden hier nicht geschnitten.
 * (@@split-module) */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;

  // Eigene Holmliste des Negativschalendesigns (je Tragfläche, cfg.negSpars) —
  // komplett getrennt von den Holmen aus Kerndesign/Tragflächendesigner (state.spars).
  // Eigene Abbrand-Einstellungen negSparKerfMode/negSparKerfBasis.
  function negList() { return Array.isArray(state.cfg.negSpars) ? state.cfg.negSpars : (state.cfg.negSpars = []); }
  const NEG_CTX = { list: negList, active: () => (state.negActiveSpar != null ? state.negActiveSpar : null),
    setActive: i => { state.negActiveSpar = i; }, kmKey: 'negSparKerfMode', kbKey: 'negSparKerfBasis' };
  // Holm-Rechnungen (spars.js/compute.js) lesen die Kerndesign-Schalter; für die
  // Negativschale werden sie für die Dauer der Rechnung durch die eigenen ersetzt.
  function withNegCfg(fn) {
    const c = state.cfg, keep = { m: c.sparKerfMode, b: c.sparKerfBasis, on: c.sparCut };
    c.sparKerfMode = c.negSparKerfMode || 'none'; c.sparKerfBasis = c.negSparKerfBasis || 'local'; c.sparCut = true;
    try { return fn(); } finally { c.sparKerfMode = keep.m; c.sparKerfBasis = keep.b; c.sparCut = keep.on; }
  }
  function negSparOn() { return !!state.cfg.negCore && !!state.cfg.negSparCut; }
  // Loch-Holme, die im Segment liegen (Taschen ausgenommen).
  function negSparList(segIdx) {
    return negList().filter(sp => !App.isPocket(sp) && App.sparAppliesTo(sp, segIdx));
  }
  // Steg-Grenzen in % der Kernsehne: [a, b] für Steg k.
  function stegBounds(k) {
    const L = App.stegeList();
    return [k === 0 ? 0 : L[k - 1].end, k === L.length - 1 ? 100 : L[k].end];
  }
  // Kernteil eines Holms: fest gewählt (sp.negSteg) oder automatisch der Steg, in
  // dem die Holmmitte (Wurzel) liegt.
  function stegOf(sp, S, xc) {
    const N = S.length;
    if (sp.negSteg != null && sp.negSteg >= 0 && sp.negSteg < N) return sp.negSteg | 0;
    for (let k = 0; k < N; k++) if (xc <= S[k].xb || k === N - 1) return k;
    return N - 1;
  }
  const shift = (P, dx) => P.map(p => ({ x: p.x + dx, y: p.y }));
  /* Geometrie aller Holme eines Segments für die Negativschale.
   * ctx = { cut, idx, rPts, tPts, root, tip, stR, stT } (root/tip = negShell-Ergebnis).
   * Rückgabe: [{ sp, n, k, gr, gt, surfR, surfT, ranges, warn }]. */
  function negSparGeoms(ctx) { return withNegCfg(() => negSparGeoms_(ctx)); }
  function negSparGeoms_(ctx) {
    const out = [];
    if (!negSparOn() || !ctx || !ctx.cut) return out;
    const segIdx = Math.min(ctx.idx, state.segments.length - 1);
    const sh = state.cfg.negCoreSheeting || 0;
    const coreR = App.negCoreContour(ctx.rPts, sh), coreT = App.negCoreContour(ctx.tPts, sh);
    // Profil im Kerndesign ggf. kopfüber (flip) -> waagrechte Holmhöhe spiegeln.
    const flR = ctx.cut.root.pl && ctx.cut.root.pl.flip, flT = ctx.cut.tip.pl && ctx.cut.tip.pl.flip;
    const S = ctx.stR, ST = ctx.stT;
    negList().forEach((sp, n) => {
      if (App.isPocket(sp) || !App.sparAppliesTo(sp, segIdx)) return;
      const o = { sp, n, k: null, warn: null };
      try {
        let yc = App.sparYc(sp);
        const ycR = yc != null && flR ? -yc : yc, ycT = yc != null && flT ? -yc : yc;
        const fR = App.sparFromLE(sp, segIdx, 'root'), fT = App.sparFromLE(sp, segIdx, 'tip');
        let cR = coreR, cT = coreT, dxR = 0, dxT = 0, ranges = ctx.root.coreRange ? [ctx.root.coreRange] : [];
        if (S && ST && S.length) {
          const leR = Math.min.apply(null, ctx.rPts.map(p => p.x));
          const k = stegOf(sp, S, leR + fR); o.k = k;
          const st = S[k].st || {}, sl = st.sleeve || 0;
          cR = App.stegeContour(coreR, sl + (st.capTop || 0), sl + (st.capBot || 0));
          cT = App.stegeContour(coreT, sl + (st.capTop || 0), sl + (st.capBot || 0));
          dxR = S[k].dx || 0; dxT = ST[k].dx || 0;
          const rg = ctx.root.stegRanges && ctx.root.stegRanges[k];
          ranges = rg ? [rg.top, rg.bot] : [];
          o.flank = [[S[k], k > 0, k < S.length - 1], [ST[k], k > 0, k < ST.length - 1]];
        }
        const gr = App.sparOnProfile(sp, shift(ctx.rPts, dxR), shift(cR, dxR), fR, ycR, 'root', shift(cR, dxR));
        const gt = App.sparOnProfile(sp, shift(ctx.tPts, dxT), shift(cT, dxT), fT, ycT, 'tip', shift(cT, dxT));
        o.gr = gr; o.gt = gt; o.surfR = shift(cR, dxR); o.surfT = shift(cT, dxT); o.ranges = ranges;
        if (!gr || !gt) o.warn = T('liegt außerhalb des Kerns');
        else if (!gr.lead || !gt.lead) o.warn = T('reicht bis zur Kernoberfläche (durchgehend) – übersprungen');
        else if (o.flank) {
          // Holm muss zwischen den Flanken seines Stegs liegen (Glasschlauch abgezogen).
          const bad = o.flank.some(([pc, hasL, hasR], j) => {
            const xs = (j ? gt : gr).poly.map(p => p.x), sl = pc.sl || 0;
            return (hasL && Math.min.apply(null, xs) < pc.xa + pc.dx + sl) || (hasR && Math.max.apply(null, xs) > pc.xb + pc.dx - sl);
          });
          if (bad) o.warn = T('ragt über die Flanke von Kernteil S') + (o.k + 1) + T(' – übersprungen');
        }
      } catch (e) { o.warn = T('Geometrie nicht berechenbar'); }
      out.push(o);
    });
    return out;
  }
  /* Holm-Abstecher in die fertige (abbrand-versetzte) Negativbahn einfügen.
   * rp/tp = Drahtbahn Wurzel/Rand (gleiche Punktzahl). Rückgabe [rp, tp]. */
  function negSparApply(rp, tp, ctx) {
    if (!negSparOn()) return [rp, tp];
    return withNegCfg(() => negSparApply_(rp, tp, ctx));
  }
  function negSparApply_(rp, tp, ctx) {
    const G = negSparGeoms_(ctx), inserts = [];
    G.forEach(o => {
      if (o.warn || !o.gr || !o.ranges.length) return;
      try {
        // Teilbahn (Kern bzw. Ober-/Unterseite des Stegs) wählen, die die Senkrechte
        // am Holm am nächsten zur Anfahrseite kreuzt.
        let best = null;
        o.ranges.forEach(rg => {
          if (!rg) return;
          const c = App.crossOnPath(rp.slice(rg[0], rg[1] + 1), o.gr.xc, o.gr.lead[1].y);
          if (c && (!best || c.d < best.d)) best = { d: c.d, rg };
        });
        if (!best) return;
        const [a, b] = best.rg;
        const kh = App.sparKerfHalf(o.sp, ctx.cut, o.gr.poly, o.gt.poly);
        const ins = App.sparHoleInsert(rp.slice(a, b + 1), tp.slice(a, b + 1), o.gr, o.gt, kh, o.surfR, o.surfT, App.sparProportional(o.sp));
        if (ins && ins.root.length === ins.tip.length) inserts.push({ i: ins.i + a, root: ins.root, tip: ins.tip });
      } catch (e) { /* einzelnen Holm überspringen */ }
    });
    if (!inserts.length) return [rp, tp];
    rp = rp.slice(); tp = tp.slice();
    inserts.sort((x, y) => y.i - x.i);   // von hinten einfügen -> Indizes bleiben gültig
    inserts.forEach(ins => { rp.splice(ins.i + 1, 0, ...ins.root); tp.splice(ins.i + 1, 0, ...ins.tip); });
    return [rp, tp];
  }
  // Nennumrisse der Holme (Vorschau) — Rippe 'root'/'tip'.
  function negSparDraw(ctx2d, V, ctx, shR, shT) {
    const G = negSparGeoms(ctx);
    G.forEach(o => {
      [[shR, o.gr, false], [shT, o.gt, true]].forEach(([on, g, dash]) => {
        if (!on || !g || !g.poly) return;
        ctx2d.strokeStyle = o.warn ? '#ff6b6b' : '#ffb347'; ctx2d.lineWidth = 1.4;
        ctx2d.setLineDash(dash ? [5, 3] : []);
        App.poly(ctx2d, V, g.poly, true); ctx2d.stroke();
        if (g.lead) { App.poly(ctx2d, V, g.lead, false); ctx2d.stroke(); }
      });
    });
    ctx2d.setLineDash([]);
    return G;
  }

  // ---------- Seitenleiste (Negativschalendesign) ----------------------------
  function negSparSidebar(side) {
    if (!state.cfg.negCore) return;
    const { grp, hint, boolRow, numRow, selectRow, warn, buildSidebar, mkMini } = App;
    const rr = () => App.render();
    const g = grp('Holmausschnitte im Kern', true, 'neg');
    boolRow(g.body, 'Holme im Kern schneiden', () => !!state.cfg.negSparCut,
      v => { state.cfg.negSparCut = v; buildSidebar(); rr(); },
      'Rechnet die Holmausschnitte wie im Kerndesign („während des Schnitts") in die Kernbahn der '
      + 'Negativschale ein: Anfahr-Schlitz von der Kernoberfläche, einmal um die Tasche, über denselben '
      + 'Schlitz zurück. Höhe und Größe beziehen sich auf den Kern (nach Beplankungsabzug). Die Holme und ihr '
      + 'Abbrand werden hier eigens angelegt, unabhängig von Kerndesign und Tragflächendesigner. Gurttaschen werden hier nicht geschnitten.');
    if (!state.cfg.negSparCut) { side.appendChild(g.g); return; }
    // Eigene Holmliste (unabhängig von Kerndesign/Tragflächendesigner).
    App.subhead(g.body, 'Holme der Negativschale (Form, Größe, Lage, Segmentbereich)');
    App.sparEditor(g.body, NEG_CTX);
    App.subhead(g.body, 'Schnitt');
    hint(g.body, 'Im Negativblock werden alle Holme „während des Schnitts" in die Kernbahn eingerechnet. '
      + '„Nach dem Schnitt" / „Nach Oberseitenschnitt" (Anfahrt von oben) entfallen hier: der Draht würde '
      + 'dabei durch die obere Formschale schneiden. Gurttaschen werden nicht geschnitten.');
    App.subhead(g.body, 'Abbrand');
    App.sparKerfRows(g.body, NEG_CTX);
    hint(g.body, 'Eigene Holme und Abbrand-Einstellungen nur für die Negativschale — unabhängig von Kerndesign und Tragflächendesigner.');
    const stOn = App.stegeOn && App.stegeOn();
    const idx = App.activeIdx ? App.activeIdx() : 0;
    const segIdx = Math.min(idx, state.segments.length - 1);
    const L = stOn ? App.stegeList() : null;
    if (stOn) {
      hint(g.body, 'Kern in Stege zerlegt: jeder Holm gehört zu einem Kernteil und wird mit diesem Steg '
        + '(um den Stegabstand verschoben) geschnitten. Höhe/Klemmung beziehen sich auf die Stegkontur '
        + '(inkl. Glasschlauch und Holmgurt).');
      // Kernteil wählen und darauf bezogen Holme anlegen.
      const cur = Math.max(0, Math.min(L.length - 1, state.cfg.negSparSteg | 0));
      state.cfg.negSparSteg = cur;
      selectRow(g.body, 'Kernteil', L.map((s, k) => [String(k), 'S' + (k + 1)]),
        () => String(cur), v => { state.cfg.negSparSteg = +v; buildSidebar(); });
      const [a, b] = stegBounds(cur);
      const row = document.createElement('div'); row.className = 'row';
      row.appendChild(mkMini(T('+ Holm in S') + (cur + 1), () => {
        const mid = +((a + b) / 2).toFixed(1);
        negList().push(App.newSpar({ segFrom: segIdx, segTo: segIdx, pos: mid, posTip: mid, negSteg: cur, w: 30, h: 30 }));
        NEG_CTX.setActive(negList().length - 1);
        buildSidebar(); rr();
      }));
      g.body.appendChild(row);
    }
    const P = App.negProjection ? (() => { try { return App.negProjection(idx); } catch (e) { return null; } })() : null;
    const G = P && P.sparGeoms ? P.sparGeoms : [];
    const list = negList().map((sp, n) => ({ sp, n })).filter(o => !App.isPocket(o.sp));
    if (stOn && list.length) App.subhead(g.body, 'Kernteil je Holm');
    list.forEach(({ sp, n }) => {
      if (stOn && sp.negSteg != null && sp.negSteg !== state.cfg.negSparSteg) return;   // nur Holme des gewählten Kernteils (+ automatische)
      if (stOn) {
        App.subhead(g.body, T('Holm ') + (n + 1) + (App.sparAppliesTo(sp, segIdx) ? '' : T(' (nicht in diesem Segment)')));
        selectRow(g.body, 'Kernteil', [['auto', 'Automatisch (nach Lage)']].concat(L.map((s, k) => [String(k), 'S' + (k + 1)])),
          () => sp.negSteg == null ? 'auto' : String(sp.negSteg),
          v => { sp.negSteg = v === 'auto' ? null : +v; buildSidebar(); rr(); });
        // Lage bezogen auf das Kernteil (nur %-Lage, nicht flugrichtungsparallel/Scharnier).
        const o = G.find(x => x.sp === sp);
        const k = sp.negSteg != null ? sp.negSteg : (o && o.k != null ? o.k : null);
        if (k != null && sp.posMode === 'pct' && (sp.posModeTip || sp.posMode) === 'pct' && !sp.flightPar && !sp.hingeAlign && sp.shape !== 'hinge') {
          const [ka, kb] = stegBounds(k), wd = (kb - ka) || 1;
          numRow(g.body, T('Lage in S') + (k + 1) + T(' (% Stegbreite ab Vorderkante)'), () => +((sp.pos - ka) / wd * 100).toFixed(1),
            v => { sp.pos = sp.posTip = +(ka + v / 100 * wd).toFixed(2); rr(); },
            { step: 1, min: 0, max: 100, norender: true,
              hint: 'Setzt die Holmlage (Wurzel und außen) relativ zum Kernteil: 0 % = Stegvorderkante, 100 % = Steghinterkante. Die Stegbreite gilt in % der Sehne für alle Segmente.' });
        }
      }
      const o = G.find(x => x.sp === sp);
      if (o && o.warn) warn(g.body, T('Holm ') + (n + 1) + ': ' + o.warn);
    });
    side.appendChild(g.g);
  }

  Object.assign(App, { NEG_CTX, negList, negSparApply, negSparDraw, negSparGeoms, negSparOn, negSparSidebar, negSparList });
})();
