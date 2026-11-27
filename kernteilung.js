/* kernteilung.js — Kerndesign: Kern vorne/hinten teilen (sehr tiefe Wurzelrippen).
 *
 * Passt eine Rippe nicht in den Verfahrweg, wird der Kern eines Segments an einer
 * Trennfuge parallel zur Spannweite in ein VORDERES (Nase) und ein HINTERES Teil
 * (Endleiste) zerlegt. Jedes Teil ist ein eigenes Programm mit eigenem Rohblock und
 * eigenem X-Nullpunkt; Höhenbezug (Blockhöhe, Blockmitte, Blockabstand) und Lage in
 * Spannweite bleiben gleich.
 *
 * Damit die geklebten Teile dasselbe ergeben wie ein Schnitt aus einem Stück:
 *  · Trennfläche senkrecht (Block-/Maschinenbezug), Gerade Wurzel → Rand bei gleichem
 *    % der Sehne (läuft parallel zu den Holmen).
 *  · Sie wird als eigener SENKRECHTER BLOCKSCHNITT über die volle Blockhöhe gefahren
 *    und ersetzt den Blockschnitt dieser Seite. Wurzel und Rand fahren dieselbe
 *    Strecke -> gleiche Geschwindigkeit -> gleicher Abbrand an beiden Rippen und an
 *    beiden Teilen. Abbrand der Fuge daher k(Vorschub) an BEIDEN Rippen, nicht nach
 *    Sehnenverhältnis (cutKerf). Draht um k/2 auf der Verschnittseite -> Nennmaß.
 *  · Der Profilzug wird an der Trennfläche beschnitten (clipPath): Teil vorne = Bahn-
 *    stück um die Nase, bis der Draht an BEIDEN Rippen hinter der Fuge steht; Teil
 *    hinten = Bahn ohne dieses Stück, vor der Fuge (im Verschnitt) gerade verbunden.
 *    So bleiben Holme „während", Beplankung, Nasenleiste, Bahn-Override, Schnitt-
 *    richtung, Schnittreihenfolge und Schalenschnitte erhalten.
 *  · Fahrten im Rohblock-Überstand hinter/vor der Fuge laufen mit Schnittvorschub
 *    (leadFace/blockBox = Rohblockkante).
 *  · Die Blockreste beider Teile haben dieselbe Stirnfläche wie der Kern und dieselbe
 *    Unterkante -> Klebebett beim Zusammensetzen.
 *  · Klebefuge/Steg-Einlage: jede Fläche um die Hälfte zurück.
 *
 *  · Holme, die die Fuge trifft (v. a. nicht proportionale, die sie schräg kreuzen),
 *    werden mitgeteilt: Jedes Teil fährt die Bahn des ungeteilten Schnitts überall, wo
 *    sie sein Material berührt (Vorderseite mit Teil vorne, Rückseite mit Teil hinten);
 *    Stücke, die an beiden Rippen jenseits der Fuge liegen, werden abgekürzt.
 * Daten je Segment: seg.splitOn, seg.splitPct (% der Sehne ab Nase) bzw. seg.splitUnit
 * 'mm' + seg.splitMm (mm ab Nase an der Wurzel, außen proportional), seg.splitGap
 * (Klebefuge/Steg mm), seg.splitOver (Rohblock-Überstand an der Fuge mm).
 * Teil-Auswahl global: cfg.coreSplitSel 'front' | 'rear' (Ansichtswert, kein Undo).
 * „Kern in Stege zerlegen" (kernteile.js) hat Vorrang. Stapeln wirkt hier nicht.
 * Abwählbare Funktion „kernteilung" (features.json); Aufrufe von außen nur geschützt.
 * Einhängepunkte: gcode.js blockOrigin + buildScene, gcodegen.js genOne,
 * hotwire_gcode.js (noShellMerge, Blockschnitt-Beschriftung), compute.js projectCut
 * (kein Stapeln), render.js drawProfiles, sidebar.js, pathpreview.js. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;
  const EPS = 1e-6;
  const COL = '#ff9f43', COL_RAW = '#c9a26b', COL_WARN = '#ff5a3c', COL_INFO = '#8b98a8';

  // ---------- Einstellungen ------------------------------------------------
  function splitOn(segIdx) {
    const s = state.segments[segIdx];
    return !!(s && s.splitOn) && !state.cfg.coreStegeOn;
  }
  function part() { return state.cfg.coreSplitSel === 'rear' ? 'rear' : 'front'; }
  // Lage der Fuge: in % der Sehne (Wurzel und Rand gleich) oder in mm ab Nase an der
  // Wurzelrippe (seg.splitUnit 'mm', seg.splitMm) — außen dann beim selben Anteil.
  function unitOf(s) { return s && s.splitUnit === 'mm' ? 'mm' : 'pct'; }
  function chordOf(pts) {
    let lo = Infinity, hi = -Infinity;
    (pts || []).forEach(p => { if (p.x < lo) lo = p.x; if (p.x > hi) hi = p.x; });
    return hi > lo ? hi - lo : 0;
  }
  function pctOf(s, cut) {
    let v = s && s.splitPct != null ? +s.splitPct : 50;
    if (unitOf(s) === 'mm' && s.splitMm != null && cut) {
      const c = chordOf(cut.root.pts);
      if (c > 0) v = +s.splitMm / c * 100;
    }
    return Math.max(5, Math.min(95, isFinite(v) ? v : 50));
  }
  function gapOf(s) { return Math.max(0, +(s && s.splitGap) || 0); }
  function overOf(s) { const v = s && s.splitOver != null ? +s.splitOver : 10; return Math.max(0, isFinite(v) ? v : 10); }
  // Abbrand des senkrechten Fugenschnitts: beide Rippen fahren dieselbe Strecke
  // (Blockhöhe) -> beide mit dem Vorschub -> Abbrand der längeren Rippe für beide.
  function faceKerf() { return App.cutKerf(1, 1).root; }
  const partName = p => T(p === 'rear' ? 'Teil hinten' : 'Teil vorne');
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1);

  // ---------- Geometrie ----------------------------------------------------
  /* Lage der Trennfuge und der Rohblöcke je Rippe (Cut-Koordinaten, ungedreht):
   *   x       Trennfuge (Mitte der Klebefuge)
   *   nF / nB Nennfläche Teil vorne / Teil hinten (± Klebefuge/2)
   *   wF / wB Drahtmitte des Fugenschnitts (halber Abbrand auf der Verschnittseite)
   *   eF / eB Rohblockkante an der Fuge (Nennfläche ± Überstand)
   *   bF / bR normale Blockvorderkante / hinteres Blockende (Blockzugaben) */
  function geom(cut, seg, pctArg) {
    const pct = pctArg != null ? pctArg : pctOf(seg, cut), g = gapOf(seg), over = overOf(seg), k0 = faceKerf();
    const e = App.blockExt(seg, cut.root.chord, cut.tip.chord);
    const rib = (pts, le, te) => {
      let xL = Infinity, xT = -Infinity;
      pts.forEach(p => { if (p.x < xL) xL = p.x; if (p.x > xT) xT = p.x; });
      const c = xT - xL, x = xL + c * pct / 100;
      return { xL, xT, c, x, nF: x - g / 2, nB: x + g / 2,
        wF: x - g / 2 + k0 / 2, wB: x + g / 2 - k0 / 2,
        eF: x - g / 2 + over, eB: x + g / 2 - over,
        bF: xL - le, bR: xT + te };
    };
    return { pct, g, over, k0, e, R: rib(cut.root.pts, e.leR, e.teR), Tp: rib(cut.tip.pts, e.leT, e.teT) };
  }
  // Rohblock eines Teils (fR/rR = Vorder-/Hinterkante an der Wurzel, fT/rT außen).
  function partBox(G, p) {
    if (p === 'rear') return { fR: G.R.eB, rR: G.R.bR, fT: G.Tp.eB, rT: G.Tp.bR };
    if (p === 'front') return { fR: G.R.bF, rR: G.R.eF, fT: G.Tp.bF, rT: G.Tp.eF };
    return { fR: G.R.bF, rR: G.R.bR, fT: G.Tp.bF, rT: G.Tp.bR };   // ungeteilt
  }
  /* Nullpunkt wie blockOrigin, aber am Rohblock des Teils: von hinten hinter dessen
   * hinterer Kante, von vorne vor dessen Vorderkante. Y unverändert (gemeinsamer
   * Höhenbezug beider Teile).
   *  · Normale Blockseite: wie blockOrigin (Wurzelrippe; gedreht: äußerste Ecke).
   *  · Fugenseite (nahe Seite = Fuge): Bei Zuspitzung läuft die Fuge schräg zum Draht.
   *    Bezug ist daher die weiter herausragende Rippe (rechteckiger Rohblock, Kante quer
   *    zum Draht), und die Türme dürfen an der Rohblockkante nicht hinter den Nullpunkt. */
  function originFor(cut, seg, segIdx, G, p, pr) {
    const B = partBox(G, p), front = !!(App.cutFront && App.cutFront());
    const y = App.blockCenterY(cut) - App.blockH(null, segIdx) / 2 - (state.cfg.blockY || 0);
    const faceNear = p === 'front' ? !front : p === 'rear' ? front : false;
    const q = (faceNear || state.cfg.sweepRot) ? (pr || App.projectCut(cut, seg)) : pr;
    let xNear = front ? B.fR : B.rR;
    if (faceNear) xNear = front ? Math.min(B.fR, B.fT) : Math.max(B.rR, B.rT);
    const rot = state.cfg.sweepRot && window.SweepRot && q ? q.sweepRot : null;
    if (rot) {
      const xs = [[B.rR, q.zRoot], [B.fR, q.zRoot], [B.rT, q.zTip], [B.fT, q.zTip]]
        .map(([x, z]) => SweepRot.rotXZ(x, z, rot.angleRad, rot.pivot.x, rot.pivot.z).x);
      xNear = front ? Math.min.apply(null, xs) : Math.max.apply(null, xs);
    }
    const bx = state.cfg.blockX || 0;
    let ox = front ? xNear - bx : xNear + bx;
    if (faceNear && q) {
      const raw = front ? towerAt(q, B.fR, B.fT) : towerAt(q, B.rR, B.rT);
      ox = front ? Math.min(ox, raw.l, raw.r) : Math.max(ox, raw.l, raw.r);
      // Ebenso die Bahnstücke JENSEITS der Fuge (an einer Rippe im Verschnitt) und
      // eigenständig geschnittene, an der Fuge geteilte Holme: Ein solcher Holm wird an
      // einer Rippe ganz umfahren, auch wenn er dort jenseits der Fuge (ggf. hinter dem
      // Rohblock) liegt. Übrige Bahnpunkte wie blockOrigin (extrapolierte Turmbahnen
      // dürfen dort wie beim ungeteilten Schnitt hinter Null reichen).
      const keep = x => { ox = front ? Math.min(ox, x) : Math.max(ox, x); };
      const c = clipPath(q, G, p);
      if (!c.err) {
        const RPc = c.pr.rootPath, TPc = c.pr.tipPath;
        const past = p === 'rear' ? (i => RPc[i].x < G.R.nB || TPc[i].x < G.Tp.nB) : (i => RPc[i].x > G.R.nF || TPc[i].x > G.Tp.nF);
        c.pr.left.forEach((t, i) => { if (past(i)) { keep(t.x); keep(c.pr.right[i].x); } });
      }
      sparFaceTowers(cut, segIdx, G, p, q).forEach(keep);
    }
    return front ? { x: ox, y, sx: 1 } : { x: ox, y, sx: -1 };
  }
  // Maschinen-X der Rohblockkante an der Fuge (Wurzel/außen) — Einlegemaß des Teils
  // (nur wenn die Fuge auf der Nullpunkt-Seite liegt).
  function rawEdgeX(cut, seg, segIdx, G, p, pr) {
    const front = !!(App.cutFront && App.cutFront());
    if (!(p === 'front' ? !front : p === 'rear' ? front : false)) return null;
    const o = originFor(cut, seg, segIdx, G, p, pr), B = partBox(G, p);
    const mX = v => (o.sx > 0 ? v - o.x : o.x - v);
    return front ? { r: mX(B.fR), t: mX(B.fT) } : { r: mX(B.rR), t: mX(B.rT) };
  }
  /* Werkstoffgrenze an der Fuge für die Vorschub-Entscheidung (Luft oder Schaum):
   * Ein rechteckiger Rohblock (Kante quer zum Draht) reicht bei schräger Fuge an einer
   * Rippe weiter über sie hinaus als der Überstand. Bis zu SEINER Kante gilt alles als
   * Werkstoff — der Draht fährt dort nie im Eilgang. Mit Werkstück-Drehung: die
   * gedrehte Trapezkante (Turmprojektion). */
  function rawFace(G, p, pr) {
    const front = p !== 'rear';
    if (pr.sweepRot) return towerAt(pr, front ? G.R.eF : G.R.eB, front ? G.Tp.eF : G.Tp.eB);
    const x = front ? Math.max(G.R.eF, G.Tp.eF) : Math.min(G.R.eB, G.Tp.eB);
    return { l: x, r: x };
  }
  // Turmlage (links z=0 / rechts z=Maschinenbreite) einer Rippen-Geraden a (Wurzel) → b (Rand).
  function towerAt(pr, a, b) {
    const zR = pr.zRoot, zT = pr.zTip, mw = state.cfg.machineWidth, rot = pr.sweepRot;
    const px = z => App.sweepProj2(rot, zR, zT, a, 0, b, 0, z).x;
    return { l: px(0), r: px(mw) };
  }

  /* Schnittbahn auf ein Teil beschneiden. Grundsatz: Jedes Teil fährt GENAU die Bahn
   * des ungeteilten Schnitts, überall wo sie sein Material berührt -> geklebt dasselbe
   * Ergebnis wie aus einem Stück, auch für Holm-Abstecher, Gurttaschen, Nasenleiste.
   * Gleiche Indexwahl für rootPath/tipPath/left/right (Wurzel und Rand synchron).
   * out(i) = der Draht steht an BEIDEN Rippen jenseits der Nennfläche des Teils (im
   * Verschnitt); da die Trennfläche eine Ebene ist, liegt dann der ganze Draht dort.
   *   vorne:  vom ersten bis zum letzten Bahnpunkt, an dem eine Rippe vor der Fuge
   *           steht (Lauf um die Nase), Enden an der Fuge gekürzt.
   *   hinten: Lauf um die Nase (ganz vor der Fuge) herausnehmen, dazwischen eine Gerade
   *           — beide Enden vollständig vor der Fuge, also auch die Gerade.
   * Liegt die Bahn ZWISCHENDURCH an beiden Rippen tief im Verschnitt (z. B. die
   * jenseitige Hälfte eines an der Fuge geteilten Holms), wird dieses Stück durch eine
   * Gerade knapp jenseits der Fuge ersetzt: Wurzel und Rand bleiben dort je für sich
   * jenseits der Fläche, also auch der Draht dazwischen. */
  function faceLimits(G, p) {
    const front = p !== 'rear', m = G.k0;
    const xmR = front ? G.R.nF + m : G.R.nB - m, xmT = front ? G.Tp.nF + m : G.Tp.nB - m;
    const beyond = (x, xm) => (front ? x >= xm - EPS : x <= xm + EPS);
    return { front, xmR, xmT, beyond };
  }
  /* Bahnpunkte lo..hi übernehmen; innere Läufe, die an beiden Rippen um den Abbrand
   * jenseits der Fuge liegen (deep), durch ihre gekürzten Enden ersetzen. Einträge:
   * { i } = Originalpunkt, { own, cut, leave } = gekürzter Punkt auf der Strecke
   * own ↔ cut (own auf der Teil-Seite, cut jenseits). */
  function pushSpan(items, lo, hi, deep) {
    let i = lo;
    while (i <= hi) {
      if (!deep(i)) { items.push({ i }); i++; continue; }
      let e = i; while (e < hi && deep(e + 1)) e++;
      if (i > lo && e < hi) items.push({ own: i - 1, cut: i, leave: true }, { own: e + 1, cut: e, leave: false });
      else for (let k = i; k <= e; k++) items.push({ i: k });
      i = e + 1;
    }
  }
  /* Gekürzte Punkte: statt bis zum nächsten Bahnpunkt (bis zu eine Punktteilung hinter
   * der Fuge) nur so weit, bis der Draht an beiden Rippen um den Abbrand jenseits der
   * Nennfläche steht. Gleicher Parameter t für Wurzel, Rand und beide Türme (Turmlage
   * ist linear in den Rippenpunkten) -> bleibt synchron und liegt genau auf der
   * ursprünglichen Fahrt. */
  function trimItems(items, RP, TP, FL) {
    const { xmR, xmT, beyond } = FL;
    // Zeitpunkt auf P→Q, ab dem (leave) bzw. bis zu dem (enter) eine Rippe jenseits xm steht.
    const tLeave = (P, Q, xm) => beyond(P.x, xm) ? 0 : !beyond(Q.x, xm) ? 1 : (xm - P.x) / ((Q.x - P.x) || 1);
    const tEnter = (P, Q, xm) => !beyond(P.x, xm) ? 0 : beyond(Q.x, xm) ? 1 : (xm - P.x) / ((Q.x - P.x) || 1);
    items.forEach(it => {
      if (it.i != null) return;
      const P = it.leave ? it.own : it.cut, Q = it.leave ? it.cut : it.own;   // Fahrtrichtung P → Q
      const tr = it.leave ? tLeave(RP[P], RP[Q], xmR) : tEnter(RP[P], RP[Q], xmR);
      const tt = it.leave ? tLeave(TP[P], TP[Q], xmT) : tEnter(TP[P], TP[Q], xmT);
      it.P = P; it.Q = Q; it.t = Math.max(0, Math.min(1, it.leave ? Math.max(tr, tt) : Math.min(tr, tt)));
    });
  }
  function itemPoint(S, it) {
    if (it.i != null) return Object.assign({}, S[it.i]);
    const q = Object.assign({}, S[it.cut]), a = S[it.P], b = S[it.Q], t = it.t;
    q.x = a.x + t * (b.x - a.x); q.y = a.y + t * (b.y - a.y);
    if (a.k != null && b.k != null) q.k = a.k + t * (b.k - a.k);
    return q;
  }
  function clipPath(pr, G, p) {
    const RP = pr && pr.rootPath, TP = pr && pr.tipPath, L = pr && pr.left, R = pr && pr.right;
    if (!RP || !TP || !L || !R || RP.length < 4) return { err: T('keine Schnittbahn') };
    let n = Math.min(RP.length, TP.length, L.length, R.length);
    const same = (a, b) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
    const closed = same(RP[0], RP[n - 1]) && same(TP[0], TP[n - 1]);
    if (closed) n--;
    let iN = 0;
    for (let i = 1; i < n; i++) if (RP[i].x < RP[iN].x) iN = i;
    const FL = faceLimits(G, p), front = FL.front;
    const out = front
      ? (i => RP[i].x >= G.R.nF - EPS && TP[i].x >= G.Tp.nF - EPS)
      : (i => RP[i].x <= G.R.nB + EPS && TP[i].x <= G.Tp.nB + EPS);
    const deep = i => FL.beyond(RP[i].x, FL.xmR) && FL.beyond(TP[i].x, FL.xmT);
    const items = [];
    if (front) {
      if (out(iN)) return { err: T('die Trennfuge liegt vor der Nase') };
      let F = -1, Ls = -1;
      for (let i = 0; i < n; i++) if (!out(i)) { if (F < 0) F = i; Ls = i; }
      if (F < 1 || Ls > n - 2) return { err: T('die Trennfuge liegt hinter dem Ende der Schnittbahn (Endleiste)') };
      items.push({ own: F, cut: F - 1, leave: false });
      pushSpan(items, F, Ls, deep);
      items.push({ own: Ls, cut: Ls + 1, leave: true });
    } else {
      if (!out(iN)) return { err: T('die Trennfuge liegt zu nah an der Nase (der Draht steht nirgends an beiden Rippen vor der Fuge)') };
      let u = iN; while (u > 0 && out(u - 1)) u--;
      let w = iN; while (w < n - 1 && out(w + 1)) w++;
      if (u === 0 || w === n - 1) return { err: T('die Schnittbahn beginnt oder endet vor der Trennfuge') };
      // Teil hinten: Naht (Schnittrichtung „von vorne") an den beiden Fugen-Enden, die
      // Nasen-Naht des Originals gehört zum vorderen Teil.
      pushSpan(items, 0, u - 1, deep);
      // Nur ein einziger Punkt vor der Fuge: nicht kürzen (sonst würde die Ecke abgeschnitten).
      if (w !== u) items.push({ own: u - 1, cut: u, leave: true, seam: true }, { own: w + 1, cut: w, leave: false, seam: true });
      else items.push({ i: u, seam: true });
      pushSpan(items, w + 1, n - 1, deep);
      if (closed) items.push({ i: 0, close: true });   // geschlossen wie die Ausgangsbahn (Schließzug wird nicht gefahren)
    }
    trimItems(items, RP, TP, FL);
    const pick = (S, rib) => items.map(it => {
      const q = itemPoint(S, it);
      if (!front && rib) { if (it.seam && !it.close) q.seam = true; else delete q.seam; }
      return q;
    });
    const A = { rootPath: pick(RP, true), tipPath: pick(TP, true), left: pick(L, false), right: pick(R, false) };
    const out2 = Object.assign({}, pr, A, { coreSplit: { part: p, pct: G.pct } });
    return { pr: out2 };
  }
  /* Eigenständige Holmbahn (Modus „nach dem Schnitt"/„nach Oberseite"/„nur Holm",
   * Rippenpunkte Wurzel/Rand gleicher Punktzahl) auf ein Teil beschneiden — gleicher
   * Grundsatz wie clipPath. null = berührt das Teil nicht. Anfang/Ende im Verschnitt
   * werden an der Fuge gekürzt: Ein- und Ausstich laufen dann senkrecht jenseits der
   * Fuge (im Verschnitt). */
  function clipSeq(Rx, Tx, G, p) {
    const n = Math.min(Rx.length, Tx.length);
    const FL = faceLimits(G, p);
    const deep = i => FL.beyond(Rx[i].x, FL.xmR) && FL.beyond(Tx[i].x, FL.xmT);
    let F = -1, Ls = -1;
    for (let i = 0; i < n; i++) if (!deep(i)) { if (F < 0) F = i; Ls = i; }
    if (F < 0) return null;
    const items = [];
    if (F > 0) items.push({ own: F, cut: F - 1, leave: false });
    pushSpan(items, F, Ls, deep);
    if (Ls < n - 1) items.push({ own: Ls, cut: Ls + 1, leave: true });
    trimItems(items, Rx, Tx, FL);
    return { R: items.map(it => itemPoint(Rx, it)), T: items.map(it => itemPoint(Tx, it)) };
  }

  /* Holm (Loch-Holm/Tasche) eines Segments: x-Bereich an Wurzel und Rand. */
  function sparSpan(sp, cut, segIdx) {
    try {
      const yco = App.sparYc(sp);
      const coreR = App.sparCoreOf(cut.root.pts, segIdx, 'root'), coreT = App.sparCoreOf(cut.tip.pts, segIdx, 'tip');
      const gr = App.sparOnProfile(sp, cut.root.pts, coreR || cut.root.pts, App.sparFromLE(sp, segIdx, 'root'), yco, 'root', coreR);
      const gt = App.sparOnProfile(sp, cut.tip.pts, coreT || cut.tip.pts, App.sparFromLE(sp, segIdx, 'tip'), yco, 'tip', coreT);
      const ext = g => {
        const P = App.sparPolys ? App.sparPolys(g) : (g && g.poly ? [g.poly] : []);
        let lo = Infinity, hi = -Infinity;
        P.forEach(pl => pl.forEach(q => { if (q.x < lo) lo = q.x; if (q.x > hi) hi = q.x; }));
        return isFinite(lo) ? { lo, hi } : null;
      };
      const r = ext(gr), t = ext(gt);
      return (r || t) ? { r, t } : null;
    } catch (e) { return null; }
  }
  function segSpars(segIdx) {
    if (!state.cfg.sparCut) return [];
    return (state.spars || []).filter(sp => App.sparAppliesTo && App.sparAppliesTo(sp, segIdx));
  }
  // Holm reicht in das Material des Teils (an mindestens einer Rippe vor bzw. hinter der Fuge)?
  function sparTouches(s, G, p) {
    if (p === 'rear') return !!((s.r && s.r.hi > G.R.nB) || (s.t && s.t.hi > G.Tp.nB));
    return !!((s.r && s.r.lo < G.R.nF) || (s.t && s.t.lo < G.Tp.nF));
  }
  // An der Fuge geteilter Holm: reicht in beide Teile.
  function sparSplit(s, G) { return sparTouches(s, G, 'front') && sparTouches(s, G, 'rear'); }
  /* Turmlagen der fugenseitigen Kante eigenständig geschnittener Holme („nach dem
   * Schnitt"/„nach Oberseite"), die das Teil berühren — für den Nullpunkt auf der
   * Fugenseite (ein geteilter Holm wird an einer Rippe ggf. jenseits der Fuge umfahren). */
  function sparFaceTowers(cut, segIdx, G, p, q) {
    const xs = [];
    segSpars(segIdx).forEach(sp => {
      if ((App.isPocket && App.isPocket(sp)) || !App.sparModeOf || App.sparModeOf(sp) === 'during') return;
      const s = sparSpan(sp, cut, segIdx);
      if (!s || !s.r || !s.t || !sparSplit(s, G)) return;
      const tw = p === 'rear' ? towerAt(q, s.r.lo - G.k0, s.t.lo - G.k0) : towerAt(q, s.r.hi + G.k0, s.t.hi + G.k0);
      xs.push(tw.l, tw.r);
    });
    return xs;
  }

  /* Verfahrweg (größtes Maschinen-X) eines Teils: Drahtbahn + ferner Blockschnitt. */
  function travelOf(cut, seg, segIdx, G, pr, p) {
    let P = pr, far;
    const front = !!(App.cutFront && App.cutFront());
    const normal = App.blockCutGeom(cut, seg, pr);
    if (p === 'whole') far = front ? normal.rear : normal.front;
    else {
      const c = clipPath(pr, G, p);
      if (c.err) return null;
      P = c.pr;
      const face = towerAt(pr, p === 'rear' ? G.R.wB : G.R.wF, p === 'rear' ? G.Tp.wB : G.Tp.wF);
      far = front ? (p === 'rear' ? normal.rear : face) : (p === 'rear' ? face : normal.front);
    }
    const o = originFor(cut, seg, segIdx, G, p, pr);
    const mX = v => (o.sx > 0 ? v - o.x : o.x - v);
    let mx = Math.max(mX(far.l), mX(far.r));
    P.left.forEach(q => { mx = Math.max(mx, mX(q.x)); });
    P.right.forEach(q => { mx = Math.max(mx, mX(q.x)); });
    return mx;
  }

  // Warnungen/Hinweise (Text mit '!' am Anfang = Warnung).
  function warnings(cut, seg, segIdx, G, pr) {
    const w = [];
    const lim = +state.cfg.maxTravelH || 0;
    if (G.pct < 15) w.push('! ' + T('Trennfuge im Nasenbereich (unter 15 %) — kleine Klebefläche, die Nase bricht leicht'));
    if (G.over < G.k0 / 2 + 1) w.push('! ' + T('Rohblock-Überstand an der Fuge zu klein — er muss deutlich größer als der halbe Abbrand sein, sonst trennt der Fugenschnitt nichts ab'));
    ['front', 'rear'].forEach(p => {
      const c = clipPath(pr, G, p);
      if (c.err) { w.push('! ' + partName(p) + ': ' + c.err); return; }
      if (lim > 0) {
        const t = travelOf(cut, seg, segIdx, G, pr, p);
        if (t != null && t > lim + 0.5) w.push('! ' + partName(p) + T(' braucht ') + t.toFixed(0) + T(' mm Verfahrweg (max. ') + lim.toFixed(0) + ' mm)');
      }
    });
    segSpars(segIdx).forEach(sp => {
      const s = sparSpan(sp, cut, segIdx); if (!s || !sparSplit(s, G)) return;
      const no = (state.spars || []).indexOf(sp) + 1;
      w.push((App.sparLabel ? App.sparLabel(no - 1) : T('Holm ') + no)
        + T(' wird an der Trennfuge geteilt: Teil vorne schneidet seine Vorderseite, Teil hinten seine Rückseite'));
    });
    if (Math.max(1, state.cfg.stackCount | 0) > 1) w.push(T('Hinweis: Stapeln wirkt bei geteiltem Kern nicht'));
    if ((state.cfg.cutOrder || 'none') === 'none') w.push(T('Hinweis: Die Trennfuge wird als Blockschnitt gefahren — statt „Ohne Blockschnitt" gilt hier „Blockschnitt vor Profilschnitt"'));
    return w;
  }

  // ---------- G-Code ---------------------------------------------------------
  /* Für genOne: Teilbahn + Änderungen an den Schreiber-Optionen. null = nicht geteilt.
   * Bei {err} liefert errProgram() ein Programm nur aus Kommentaren (KEIN Schnitt —
   * Nullpunkt und Bahn würden sonst nicht zusammenpassen). */
  function coreSplitFor(cut, seg, segIdx, pr) {
    if (!splitOn(segIdx)) return null;
    const p = part(), G = geom(cut, seg);
    const res = { part: p, G };
    const c = clipPath(pr, G, p);
    if (c.err) { res.err = c.err; res.errProgram = () => errProgram(segIdx, p, c.err); return res; }
    res.pr = c.pr;
    const normal = App.blockCutGeom(cut, seg, pr);
    const face = towerAt(pr, p === 'rear' ? G.R.wB : G.R.wF, p === 'rear' ? G.Tp.wB : G.Tp.wF);
    const raw = rawFace(G, p, pr);
    face.label = p === 'rear' ? 'Trennfuge (Teil hinten)' : 'Trennfuge (Teil vorne)';
    res.bc = p === 'rear' ? { front: face, rear: normal.rear } : { front: normal.front, rear: face };
    res.bb = p === 'rear' ? { front: raw, rear: normal.rear } : { front: normal.front, rear: raw };
    res.patchOpt = opt => patchOpt(opt, res, cut, seg, segIdx, pr);
    return res;
  }
  function patchOpt(opt, S, cut, seg, segIdx, pr) {
    const front = opt.cutDir === 'front', p = S.part, G = S.G;
    const forced = (opt.cutMode || 'none') === 'none';
    if (forced) opt.cutMode = 'before';
    opt.blockCut = S.bc;
    opt.blockBox = S.bb;
    // Nahe Blockseite = Fuge (Teil vorne von hinten, Teil hinten von vorne): Fahrten im
    // Rohblock-Überstand zwischen Nullpunkt-Seite und Fuge mit Schnittvorschub.
    if (front ? p === 'rear' : p === 'front') {
      const rw = front ? S.bb.front : S.bb.rear;
      opt.leadFace = { l: rw.l, r: rw.r, in: pr.sweepRot ? (front ? G.R.eB : G.R.eF) : rw.l, free: true };
    }
    // Schalenschnitt nur bis zur Rohblockkante an der Fuge; kein Zusammenlegen mit den
    // Blockschnitten (dessen Wendepunkte lägen sonst im Rohblock-Überstand).
    if (opt.shellCut) opt.shellCut = Object.assign({}, opt.shellCut, p === 'rear' ? { front: S.bb.front } : { rear: S.bb.rear });
    opt.noShellMerge = true;
    // Holmausschnitte „nach dem Schnitt"/„nach Oberseite"/„nur Holm": je Holm das Stück
    // in diesem Teil (an der Fuge geteilte Holme in beiden Teilen, je eine Seite).
    opt.sparSeqClip = (Rx, Tx) => clipSeq(Rx, Tx, G, p);
    const B = partBox(G, p), H = App.blockH(null, segIdx);
    const hd = [
      '; ' + T('Kern vorne/hinten geteilt — ') + partName(p) + (p === 'rear' ? T(' (Trennfuge bis Endleiste)') : T(' (Nase bis Trennfuge)')),
      '; ' + T('Trennfuge bei ') + f1(G.pct) + T(' % der Sehne: Wurzel ') + f1(G.R.x - G.R.xL) + T(' mm · außen ') + f1(G.Tp.x - G.Tp.xL)
        + T(' mm ab Nase · Klebefuge ') + f1(G.g) + ' mm',
      '; ' + T('Trennfuge = senkrechter Blockschnitt über die volle Blockhöhe, Abbrand ') + G.k0.toFixed(2)
        + T(' mm an beiden Rippen (gleiche Strecke = voller Vorschub)'),
      '; ' + T('Rohblock dieses Teils: Wurzel ') + f1(B.rR - B.fR) + T(' mm · außen ') + f1(B.rT - B.fT) + T(' mm × Höhe ') + f1(H)
        + T(' mm · Überstand an der Fuge ') + f1(G.over) + ' mm'
    ];
    const rx = rawEdgeX(cut, seg, segIdx, G, p, pr);
    if (rx) hd.push('; ' + T('Rohblock einlegen: Kante an der Fuge bei X ') + f1(Math.min(rx.r, rx.t))
      + T(' (quer zum Draht; Bedarf Wurzel X ') + f1(rx.r) + T(' · außen X ') + f1(rx.t) + ')');
    warnings(cut, seg, segIdx, G, pr).forEach(t => hd.push('; ' + t));
    opt.header = (opt.header ? opt.header + '\n' : '') + hd.join('\n');
  }
  function errProgram(segIdx, p, msg) {
    const tc = s => (window.I18N ? window.I18N.tc(s) : s);
    const L = ['; ==== HotWing 4-Achs Heißdraht G-Code ====', '; --- Segment ' + (segIdx + 1) + ' ---',
      '; ' + T('FEHLER: Kern vorne/hinten teilen — ') + partName(p) + ': ' + msg,
      '; ' + T('Kein Schnitt. Lage der Trennfuge im Kerndesign ändern.'), 'M2 ; Ende'].map(tc);
    return { text: L.join('\n'), lines: L.length, cutLengthFoam: 0, estMinutes: 0 };
  }

  // ---------- Einhängepunkte für Nullpunkt, Szene, Zeichnung -----------------
  function coreSplitOrigin(cut, seg) {
    const i = state.segments.indexOf(seg);
    if (i < 0 || !splitOn(i)) return null;
    return originFor(cut, seg, i, geom(cut, seg), part(), null);
  }
  // Rohblock des gewählten Teils (Cut-Koordinaten) für die 3D-Simulation.
  function coreSplitBox(cut, seg, segIdx) {
    if (!splitOn(segIdx)) return null;
    return partBox(geom(cut, seg), part());
  }
  // Beschnittene Bahn des gewählten Teils (Schnittspur im Kerndesign, Bahnvorschau).
  function coreSplitSpur(pr, cut, seg, segIdx) {
    if (!splitOn(segIdx)) return null;
    const c = clipPath(pr, geom(cut, seg), part());
    return c.err ? null : c.pr;
  }
  // Blockschnitte des gewählten Teils (Bahnvorschau ohne G-Code-Erzeugung).
  function coreSplitBlockCut(cut, seg, segIdx, pr) {
    if (!splitOn(segIdx)) return null;
    const S = coreSplitFor(cut, seg, segIdx, pr);
    return S && !S.err ? { bc: S.bc, bb: S.bb } : null;
  }

  /* Kerndesign-Profilfenster: Trennfuge (Wurzel durchgezogen, Rand gestrichelt),
   * Rohblockkanten der Teile, Drahtmitte des Fugenschnitts (bei „Schnittspur"),
   * nicht gewähltes Teil abgeblendet, Beschriftung + Legende. */
  function coreSplitDraw(ctx, V, leg, o) {
    if (!splitOn(o.idx)) return;
    const G = geom(o.cut, o.seg), p = part();
    const yb = o.cy - o.bh / 2, yt = o.cy + o.bh / 2;
    const vline = (x, dy, dash, c, lw) => {
      ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(V.X(x), V.Y(yb + dy)); ctx.lineTo(V.X(x), V.Y(yt + dy)); ctx.stroke();
    };
    const rb = o.shR ? G.R : G.Tp, dy = o.shR ? o.dyR : o.dyT;
    ctx.save();
    // Nicht gewähltes Teil leicht abblenden (an der sichtbaren Rippe).
    const x0 = p === 'rear' ? rb.bF : rb.nB, x1 = p === 'rear' ? rb.nF : rb.bR;
    const X0 = V.X(x0), X1 = V.X(x1), Y0 = V.Y(yt + dy), Y1 = V.Y(yb + dy);
    ctx.fillStyle = 'rgba(128,128,128,0.16)';
    ctx.fillRect(Math.min(X0, X1), Math.min(Y0, Y1), Math.abs(X1 - X0), Math.abs(Y1 - Y0));
    if (o.shR) { vline(G.R.nF, o.dyR, [], COL, 1.8); if (G.g > 0) vline(G.R.nB, o.dyR, [], COL, 1.8); }
    if (o.shT) { vline(G.Tp.nF, o.dyT, [6, 4], COL, 1.3); if (G.g > 0) vline(G.Tp.nB, o.dyT, [6, 4], COL, 1.3); }
    if (o.shR) { vline(G.R.eF, o.dyR, [2, 3], COL_RAW, 1); vline(G.R.eB, o.dyR, [2, 3], COL_RAW, 1); }
    if (o.kerf) {
      const kc = App.PAL.kerf || '#ff7a59';
      if (o.shR) vline(p === 'rear' ? G.R.wB : G.R.wF, o.dyR, [], kc, 1.2);
      if (o.shT) vline(p === 'rear' ? G.Tp.wB : G.Tp.wF, o.dyT, [4, 3], kc, 1);
    }
    ctx.setLineDash([]);
    ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const yl = Math.min(Y0, Y1) + 5;
    const lab = (x, q) => { ctx.fillStyle = q === p ? COL : COL_INFO; ctx.fillText(partName(q) + (q === p ? ' · G-Code' : ''), V.X(x), yl); };
    lab((rb.bF + rb.nF) / 2, 'front');
    lab((rb.nB + rb.bR) / 2, 'rear');
    ctx.restore();
    leg.push([COL, T('Trennfuge Kern vorne/hinten: ') + f1(G.pct) + T(' % der Sehne · Wurzel ') + f1(G.R.x - G.R.xL)
      + T(' mm · außen ') + f1(G.Tp.x - G.Tp.xL) + T(' mm ab Nase') + (G.g > 0 ? T(' · Klebefuge ') + f1(G.g) + ' mm' : '')]);
    leg.push([COL_RAW, T('Rohblockkanten der Teile an der Fuge (Überstand ') + f1(G.over) + ' mm)']);
    leg.push([COL_INFO, T('G-Code: ') + partName(p) + T(' · Fuge als senkrechter Blockschnitt, Abbrand ') + G.k0.toFixed(2) + ' mm']);
    if (o.pr) warnings(o.cut, o.seg, o.idx, G, o.pr).forEach(t => leg.push([t.charAt(0) === '!' ? COL_WARN : COL_INFO, t]));
  }

  /* Kerndesign-Grundriss (render.js drawPlan): Trennfuge je geteiltem Segment als
   * Gerade von der Wurzel- zur Außenrippe (gleicher Anteil der Sehne), Klebefuge und
   * Rohblockkanten der Teile, Maße an Wurzel/außen. o = { leTe, poly, L, showBlock }
   * mit leTe[k] = { z, le, te } (Grundriss: x = Spannweite, y = −Sehnenlage). */
  function coreSplitPlan(ctx, V, legP, o) {
    const leTe = o.leTe;
    let any = false, anyRaw = false, anyGap = false;
    ctx.save();
    for (let k = 0; k < leTe.length - 1 && k < state.segments.length; k++) {
      if (!splitOn(k)) continue;
      const cut = App.wing.cuts[Math.min(k, App.wing.cuts.length - 1)], seg = state.segments[k];
      if (!cut) continue;
      const G = geom(cut, seg), a = leTe[k], b = leTe[k + 1];
      // Lage ab Nase an der Station: gleicher Anteil der Sehne, Versätze (Klebefuge,
      // Überstand) in mm.
      const at = (s, d) => -(s.le + (s.te - s.le) * G.pct / 100 + d);
      const line = (d, dash, col, lw) => {
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash(dash);
        o.poly(ctx, V, [{ x: a.z, y: at(a, d) }, { x: b.z, y: at(b, d) }], false); ctx.stroke();
      };
      const act = state.activeSeg === k;
      any = true;
      if (o.showBlock) { line(-G.g / 2 + G.over, [2, 3], COL_RAW, 1); line(G.g / 2 - G.over, [2, 3], COL_RAW, 1); anyRaw = true; }
      if (G.g > 0) { line(-G.g / 2, [], COL, act ? 1.6 : 1.1); line(G.g / 2, [], COL, act ? 1.6 : 1.1); anyGap = true; }
      else line(0, [], COL, act ? 2.4 : 1.5);
      ctx.setLineDash([]);
      // Maße ab Nase an Wurzel und Rand (hinter der Fuge, Richtung Endleiste).
      ctx.font = (act ? 'bold ' : '') + '11px Segoe UI'; ctx.fillStyle = COL; ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText(f1(G.R.x - G.R.xL) + ' mm', V.X(a.z) + 4, V.Y(at(a, 0)) + 3);
      ctx.textAlign = 'right';
      ctx.fillText(f1(G.Tp.x - G.Tp.xL) + ' mm', V.X(b.z) - 4, V.Y(at(b, 0)) + 3);
    }
    ctx.restore();
    if (!any) return;
    legP.push(o.L(COL, T('Trennfuge Kern vorne/hinten (mm ab Nase)') + (anyGap ? T(' · mit Klebefuge') : ''), [], 'line', 2));
    if (anyRaw) legP.push(o.L(COL_RAW, T('Rohblockkanten der Teile an der Fuge'), [2, 3], 'line', 1));
  }

  /* Automatik: Lage so, dass der größere der beiden Verfahrwege möglichst klein wird. */
  function autoPct(cut, seg, segIdx) {
    const pr = App.projectCut(cut, seg);
    let best = null;
    for (let q = 10; q <= 90 + 1e-9; q += 0.5) {
      const G = geom(cut, seg, q);
      const a = travelOf(cut, seg, segIdx, G, pr, 'front'), b = travelOf(cut, seg, segIdx, G, pr, 'rear');
      if (a == null || b == null) continue;
      const m = Math.max(a, b);
      if (!best || m < best.m - 1e-9) best = { q, m, a, b };
    }
    return best;
  }

  // ---------- Sidebar ----------------------------------------------------------
  function coreSplitSidebar(side) {
    const { grp, hint, boolRow, selectRow, buildSidebar } = App;
    const idx = App.activeIdx(), seg = state.segments[idx];
    if (!seg) return;
    const rr = () => App.render();
    // Sichtbare Infozeile (hint() blendet Hilfetexte je nach Einstellung als „?“ ein).
    const info = (body, t) => { const d = document.createElement('div'); d.className = 'row full';
      d.style.cssText = 'font-size:12px;line-height:1.35;margin:1px 0;color:var(--muted)'; d.textContent = t; body.appendChild(d); return d; };
    const g = grp('Kern vorne/hinten teilen', false, 'core');
    hint(g.body, 'Für sehr tiefe Wurzelrippen, die nicht in den Verfahrweg passen: Der Kern dieses Segments wird an einer '
      + 'Trennfuge parallel zur Spannweite in ein vorderes und ein hinteres Teil zerlegt. Jedes Teil bekommt einen eigenen '
      + 'Rohblock und ein eigenes Programm; Blockhöhe und Höhenbezug bleiben gleich. Die Fuge wird als senkrechter Blockschnitt '
      + 'über die volle Blockhöhe gefahren — Wurzel und Rand laufen dabei gleich schnell, der Abbrand ist an beiden Rippen und '
      + 'an beiden Teilen gleich, und beide Teile haben Nennmaß.');
    if (state.cfg.coreStegeOn) hint(g.body, 'Wirkt nicht, solange „Kern in Stege zerlegen" eingeschaltet ist.');
    boolRow(g.body, T('Kern teilen (Segment ') + (idx + 1) + ')', () => !!seg.splitOn,
      v => { seg.splitOn = v; if (v && seg.splitPct == null) seg.splitPct = 50; buildSidebar(); rr(); });
    if (!seg.splitOn) { side.appendChild(g.g); return; }
    const cut = App.wing.cuts[Math.min(idx, App.wing.cuts.length - 1)];
    const G = geom(cut, seg);
    const upd = () => { buildSidebar(); rr(); };
    selectRow(g.body, 'Lage angeben in', [['pct', '% der Sehne'], ['mm', 'mm an der Wurzel']], () => unitOf(seg),
      v => {
        // Umschalten ohne Sprung: aktuelle Lage in die andere Einheit übernehmen.
        if (v === 'mm') seg.splitMm = +(G.R.x - G.R.xL).toFixed(1); else seg.splitPct = +G.pct.toFixed(2);
        seg.splitUnit = v; upd();
      },
      'In % der Sehne (an Wurzel und Rand gleich) oder in mm ab Nase an der Wurzelrippe — außen liegt die Fuge dann beim selben Anteil der Sehne (proportional).');
    if (unitOf(seg) === 'mm') {
      App.numRowEnter(g.body, 'Lage der Trennfuge an der Wurzel (mm ab Nase)', () => +(G.R.x - G.R.xL).toFixed(1),
        v => { seg.splitMm = Math.max(0.05 * G.R.c, Math.min(0.95 * G.R.c, v)); upd(); },
        { step: 1, min: 0, norender: true,
          hint: 'Abstand ab Nasenleiste an der Wurzelrippe dieses Segments. Außen liegt die Fuge beim selben Anteil der Sehne — sie läuft damit parallel zu proportionalen Holmen. Ein nicht proportionaler Holm, den sie trifft, wird mitgeteilt.' });
    } else {
      App.numRowEnter(g.body, 'Lage der Trennfuge (% der Sehne ab Nase)', () => +pctOf(seg, cut).toFixed(2),
        v => { seg.splitPct = Math.max(5, Math.min(95, v)); upd(); },
        { step: 1, min: 5, max: 95, norender: true,
          hint: 'Gleicher Anteil an Wurzel und Rand — die Fuge läuft damit parallel zu proportionalen Holmen. Nicht in den Nasenbereich legen. Ein Holm, den sie trifft, wird mitgeteilt (Vorderseite mit Teil vorne, Rückseite mit Teil hinten).' });
    }
    info(g.body, T('Trennfuge: Wurzel ') + f1(G.R.x - G.R.xL) + T(' mm · außen ') + f1(G.Tp.x - G.Tp.xL) + T(' mm ab Nase') + ' (' + f1(G.pct) + ' %)');
    {
      const row = document.createElement('div'); row.className = 'row full';
      const b = document.createElement('button');
      b.textContent = T('Automatisch: kürzester Verfahrweg');
      b.title = T('Sucht die Lage, bei der das längere der beiden Teile den kürzesten Verfahrweg braucht (Drahtbahn samt Schnittverlängerungen und Blockschnitten).');
      b.onclick = () => {
        const r = autoPct(cut, seg, idx);
        if (!r) { if (App.toast) App.toast(T('Keine gültige Lage gefunden.')); return; }
        seg.splitPct = r.q;
        if (unitOf(seg) === 'mm') seg.splitMm = +(r.q / 100 * G.R.c).toFixed(1);
        upd();
        const lim = +state.cfg.maxTravelH || 0;
        if (App.toast) App.toast(T('Trennfuge bei ') + f1(r.q) + T(' %: Teil vorne ') + r.a.toFixed(0) + T(' mm, Teil hinten ') + r.b.toFixed(0) + T(' mm Verfahrweg')
          + (lim > 0 && r.m > lim + 0.5 ? T(' — passt trotzdem nicht in ') + lim.toFixed(0) + ' mm' : ''));
      };
      row.appendChild(b); g.body.appendChild(row);
    }
    App.numRowEnter(g.body, 'Klebefuge / Steg-Einlage (mm)', () => gapOf(seg), v => { seg.splitGap = Math.max(0, v); upd(); },
      { step: 0.1, min: 0, norender: true,
        hint: 'Dicke der Klebefuge oder eines eingeklebten Stegs (z. B. Balsa als Holmsteg). Jede Trennfläche wird um die Hälfte zurückgesetzt, damit die geklebte Fläche wieder Nennmaß hat. 0 = stumpf geklebt.' });
    App.numRowEnter(g.body, 'Rohblock-Überstand an der Fuge (mm)', () => overOf(seg), v => { seg.splitOver = Math.max(0, v); upd(); },
      { step: 1, min: 0, norender: true,
        hint: 'So weit ragt der Rohblock jedes Teils über die Trennfuge hinaus; der Fugenschnitt trennt ihn ab. Muss deutlich größer als der halbe Abbrand sein. Der Nullpunkt liegt um den Blockabstand dahinter.' });
    selectRow(g.body, 'G-Code für', [['front', 'Teil vorne (Nase)'], ['rear', 'Teil hinten (Endleiste)']],
      () => part(), v => { state.cfg.coreSplitSel = v; buildSidebar(); });
    const H = App.blockH(null, idx), pr = App.projectCut(cut, seg);
    ['front', 'rear'].forEach(q => {
      const B = partBox(G, q), t = travelOf(cut, seg, idx, G, pr, q), rx = rawEdgeX(cut, seg, idx, G, q, pr);
      info(g.body, partName(q) + T(': Rohblock Wurzel ') + f1(B.rR - B.fR) + T(' mm · außen ') + f1(B.rT - B.fT) + T(' mm × Höhe ') + f1(H) + ' mm'
        + (t != null ? T(' · Verfahrweg ') + t.toFixed(0) + ' mm' : '')
        + (rx ? T(' · Kante an der Fuge bei X ') + f1(Math.min(rx.r, rx.t)) : ''));
    });
    const tw = travelOf(cut, seg, idx, G, pr, 'whole');
    if (tw != null) info(g.body, T('Ungeteilt: Verfahrweg ') + tw.toFixed(0) + ' mm' + ((+state.cfg.maxTravelH || 0) > 0 ? T(' (max. ') + (+state.cfg.maxTravelH).toFixed(0) + ' mm)' : ''));
    warnings(cut, seg, idx, G, pr).forEach(t => { if (t.charAt(0) === '!' && App.warn) App.warn(g.body, t.slice(2)); else info(g.body, t); });
    hint(g.body, 'Zusammensetzen: Beide Blöcke gleich hoch und gleich weit vom Portal einlegen. Nach dem Schnitt die unteren Blockreste '
      + 'beider Teile auf eine ebene Platte legen und an der Fuge zusammenschieben (bei Steg-Einlage mit Distanzstreifen) — sie haben '
      + 'dieselbe Stirnfläche wie der Kern. Kerne einlegen, Fuge kleben, obere Reste als Gewicht auflegen: Höhe, Schränkung und Sehne '
      + 'stimmen dann wie aus einem Stück.');
    side.appendChild(g.g);
  }
  // Reiter „G-Code", Gruppe „Quelle Gcode" (unter der Segmentwahl): Auswahl des Teils.
  function coreSplitGcodeRow(body) {
    const idx = App.activeIdx();
    if (!splitOn(idx) || state.cfg.gcodeSource && state.cfg.gcodeSource !== 'core') return;
    const seg = state.segments[idx], cut = App.wing.cuts[Math.min(idx, App.wing.cuts.length - 1)];
    App.selectRow(body, T('Kernteil (Fuge bei ') + f1(pctOf(seg, cut)) + ' %)', [['front', 'Teil vorne (Nase)'], ['rear', 'Teil hinten (Endleiste)']],
      () => part(), v => { state.cfg.coreSplitSel = v; if (App.releaseGcodeLock) App.releaseGcodeLock(); App.buildSidebar(); },
      'Der Kern dieses Segments ist vorne/hinten geteilt (Kerndesign → „Kern vorne/hinten teilen"). Jedes Teil ist ein eigenes Programm mit eigenem Rohblock — hier wählen, welches erzeugt und simuliert wird.');
  }

  Object.assign(App, {
    coreSplitOn: splitOn, coreSplitPart: part, coreSplitFor, coreSplitOrigin, coreSplitBox, coreSplitSpur,
    coreSplitBlockCut, coreSplitDraw, coreSplitPlan, coreSplitSidebar, coreSplitGcodeRow,
    _coreSplit: { geom, clipPath, clipSeq, partBox, originFor, travelOf, warnings, autoPct, sparSpan, sparSplit }   // für Tests
  });
})();
