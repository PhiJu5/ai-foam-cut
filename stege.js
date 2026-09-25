/* stege.js — Kern-Stege (Negativschalendesign): der Kern zwischen den beiden
 * Schalen wird in einzelne Stege (Sehnen-Abschnitte) zerlegt, die IM SELBEN
 * durchgehenden Schnitt wie die Schalen gefahren werden (anstelle der Kern-
 * Schlaufe von „Kern mitschneiden"). Die Stege liegen im Negativblock um den
 * Stegabstand auseinandergerückt (Steg k um k·Abstand nach hinten), damit jeder
 * Steg für sich um Abbrand/2 nach außen kompensiert werden kann: die fertigen
 * Stücke haben Nennmaß und ergeben zusammengesetzt wieder die volle Sehne.
 * Je Steg: Glasschlauch-Dicke (rundum abgezogen) und Holmgurt oben/unten
 * (zusätzlich von Ober-/Unterseite abgezogen).
 *
 *   Bahn (Ausschnitt, zwischen oberer und unterer Schale, EIN Schnitt):
 *     Anfahrt hinten (xBR) -> Oberseiten hinten→vorne, dazwischen je Lücke
 *     (Stegtrennung im OBEREN Schnitt): linke Flanke runter, Lücke unten queren,
 *     rechte Flanke des vorderen Stegs hoch -> Nase des 1. Stegs -> Unterseiten
 *     vorne→hinten über die schon offenen Lücken -> hinten raus (xBR). Jede Lücke
 *     wird unten zweimal gequert (hin/zurück), Ober- und Unterseiten nur einmal. Waste liegt immer auf derselben Seite der Bahn ->
 *     der normale Parallel-Offset der Negativschale kompensiert alles nach außen.
 * (@@split-module) */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;
  const { grp, hint, subhead, numRow, boolRow, mkMini, buildSidebar } = App;
  const { resampleOpenN, clipPolylineX, dim, makeView, bounds, poly } = App;

  const NS = 80;   // Stützpunkte je Ober-/Unterseite eines Stegs (Wurzel/Rand identisch -> Türme synchron)

  /* Offenes Teilstück auf exakt n Punkte abtasten, KRÜMMUNGSGEWICHTET: jedes Kanten-
   * stück zählt mit seiner Länge plus seinem Richtungswechsel (1 rad ≙ TURN Punkt-
   * abstände). Dadurch bekommt die stark gekrümmte Nase viele Punkte, die flachen
   * Flächen wenige — gleichmäßig nach Bogenlänge (resampleOpenN) war die Nase eckig.
   * Endpunkte bleiben exakt; Punktzahl fest -> Wurzel/Rand synchron. */
  const TURN = 6;
  function resampleCurvN(seg, n) {
    const m = seg.length;
    if (m < 3 || n < 2) return resampleOpenN(seg, n);
    const len = [], ang = new Array(m).fill(0);
    let tot = 0;
    for (let i = 0; i < m - 1; i++) { len.push(Math.hypot(seg[i + 1].x - seg[i].x, seg[i + 1].y - seg[i].y)); tot += len[i]; }
    for (let i = 1; i < m - 1; i++) {
      const a1 = Math.atan2(seg[i].y - seg[i - 1].y, seg[i].x - seg[i - 1].x), a2 = Math.atan2(seg[i + 1].y - seg[i].y, seg[i + 1].x - seg[i].x);
      let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d;
      ang[i] = d;
    }
    const K = TURN * (tot || 1) / (n - 1);
    const cum = [0];
    for (let i = 0; i < m - 1; i++) cum.push(cum[i] + len[i] + K * (ang[i] + ang[i + 1]) / 2);
    const W = cum[m - 1] || 1, out = [];
    let g = 0;
    for (let q = 0; q < n; q++) {
      const tg = W * q / (n - 1);
      while (g < m - 2 && cum[g + 1] < tg) g++;
      const l = (cum[g + 1] - cum[g]) || 1, fr = Math.min(1, Math.max(0, (tg - cum[g]) / l));
      out.push({ x: seg[g].x + fr * (seg[g + 1].x - seg[g].x), y: seg[g].y + fr * (seg[g + 1].y - seg[g].y) });
    }
    return out;
  }

  // ---------- Konfiguration ---------------------------------------------
  /* Steg-Liste normalisieren: mindestens 1 Steg, letzter endet immer bei 100 %,
   * alle Felder vorhanden (Altstände). */
  function stegeList() {
    let L = state.cfg.negStegeList;
    if (!Array.isArray(L) || !L.length) L = state.cfg.negStegeList = [mkSteg(33.3), mkSteg(66.7), mkSteg(100)];
    L.forEach(s => { if (s.end == null) s.end = 100; s.sleeve = +s.sleeve || 0; s.capTop = +s.capTop || 0; s.capBot = +s.capBot || 0; });
    L[L.length - 1].end = 100;
    return L;
  }
  function mkSteg(end) { return { end, sleeve: 0, capTop: 0, capBot: 0 }; }
  // Grenzen gleichmäßig über die Sehne verteilen (Eigenschaften bleiben).
  function stegeEven(L) { L.forEach((s, k) => s.end = Math.round(1000 * (k + 1) / L.length) / 10); L[L.length - 1].end = 100; }
  function stegeSetCount(n) {
    const L = stegeList();
    n = Math.max(1, Math.min(30, Math.round(n)));
    while (L.length < n) L.push(mkSteg(100));
    L.length = n;
    stegeEven(L);
  }
  // Nur aktiv, wenn im Negativdesign der Kern mitgeschnitten wird.
  function stegeOn() { return !!state.cfg.negStegeOn && !!state.cfg.negCore; }
  function stegeGap() { return Math.max(0, +state.cfg.negStegeGap || 0); }

  // ---------- Geometrie ---------------------------------------------------
  // Kernkontur um Ober-/Unterseiten-Abzug nach innen versetzt (Glasschlauch +
  // Gurt), auf die Punktzahl der Kontur resampled (LE-Index bleibt deterministisch).
  function stegeContour(pts, tTop, tBot) {
    if (!(tTop > 0) && !(tBot > 0)) return pts.map(p => ({ x: p.x, y: p.y }));
    return Airfoil.resample(HotWire.trimTE(HotWire.offsetPathTB(pts, tTop, tBot)), pts.length);
  }
  /* Nennkontur eines Stegs k (Cut-mm, ungeschoben): top/bot = Ober-/Unterseite
   * jeweils links→rechts (NS Punkte). Erster Steg enthält die Nase, letzter die
   * Endleiste; dazwischen senkrechte Flanken. */
  function stegePiece(pts, k, L) {
    const st = L[k], N = L.length;
    const xs = pts.map(p => p.x);
    const xL = Math.min.apply(null, xs), xT = Math.max.apply(null, xs), chord = xT - xL;
    const a = k === 0 ? 0 : L[k - 1].end, b = k === N - 1 ? 100 : st.end;
    const sl = st.sleeve || 0;
    const C = stegeContour(pts, sl + (st.capTop || 0), sl + (st.capBot || 0));
    const iLE = Math.ceil(C.length / 2) - 1;
    const upper = C.slice(0, iLE + 1), lower = C.slice(iLE);   // TE→LE, LE→TE
    const xa = xL + chord * a / 100, xb = xL + chord * b / 100;
    // Seitenflanken: Glasschlauch umhüllt den Steg -> beidseitig um sl nach innen.
    const lo = k === 0 ? -1e9 : xa + sl, hi = k === N - 1 ? 1e9 : xb - sl;
    const top = resampleCurvN(clipPolylineX(upper, lo, hi), NS).reverse();   // links→rechts
    const bot = resampleCurvN(clipPolylineX(lower, lo, hi), NS);             // links→rechts
    // Dünn-Prüfung nur an den geraden Flanken (an Nase/Endleiste laufen Ober- und
    // Unterseite naturgemäß zusammen) — plus Mindestbreite des Stegs.
    const thin = (k > 0 && top[0].y - bot[0].y < 0.05) || (k < N - 1 && top[NS - 1].y - bot[NS - 1].y < 0.05)
      || (xb - xa) - 2 * sl < 0.5;
    return { k, top, bot, xa, xb, a, b, w: xb - xa, thin, xL, xT, chord, sl };
  }
  /* Alle Stege einer Rippe aus der KERNKONTUR (bereits um den Beplankungsabzug
   * versetzt), im Block um k·Stegabstand nach hinten gerückt. */
  function stegePieces(corePts) {
    const L = stegeList(), gap = stegeGap();
    return L.map((st, k) => {
      const pc = stegePiece(corePts, k, L);
      const dx = k * gap, sh = P => P.map(p => ({ x: p.x + dx, y: p.y }));
      pc.dx = dx; pc.top = sh(pc.top); pc.bot = sh(pc.bot); pc.st = st;
      return pc;
    });
  }
  /* Steg-Bahn in den Negativschalen-Umriss einfügen (wird von negShell an der
   * Stelle der Kern-Schlaufe aufgerufen). An der Nase des 1. Stegs dieselbe
   * Nasen-Schlaufe wie beim reinen Kern (45° schräg, horizontal bis Block-
   * vorderkante xBL, um 2·hv vertikal versetzt zurück). Punktzahl deterministisch:
   * 2 + 2·N·NS + 2·(N−1) + 4. Rückgabe: noseApex-Eintrag (für negSnapNoseApex). */
  function stegeEmit(path, S, xBR, xBL, hv, teSlope) {
    const N = S.length, n = S[0].top.length, last = S[N - 1];
    const m = teSlope || 0;   // Endleisten-Verlauf: 0 = waagrecht, sonst Sehnen-Steigung (Verlängerung der Profilsehne)
    path.push({ x: xBR, y: last.top[n - 1].y + m * (xBR - last.top[n - 1].x) });  // Anfahrt hinten (Höhe EL-Oberkante)
    // Oberseiten hinten→vorne; die Stegtrennung erfolgt IM OBEREN SCHNITT: nach der
    // Oberseite von Steg k die linke Flanke runter, Lücke unten queren, rechte Flanke
    // von Steg k−1 hoch (dessen Oberseite folgt).
    for (let k = N - 1; k >= 0; k--) {
      const t = S[k].top; for (let i = n - 1; i >= 0; i--) path.push(t[i]);
      if (k > 0) path.push(S[k].bot[0], S[k - 1].bot[n - 1]);
    }
    // Nasen-Schlaufe (wie emitCores): Nasenspitze wird zweimal besucht.
    const nose = S[0].top[0], apexUp = path.length - 1;
    hv = Math.max(hv || 0, 0);
    path.push({ x: nose.x - hv, y: nose.y - hv }, { x: xBL, y: nose.y - hv }, { x: xBL, y: nose.y + hv }, { x: nose.x - hv, y: nose.y + hv });
    const apexLo = path.length;
    for (let k = 0; k < N; k++) { const b = S[k].bot; for (let i = 0; i < n; i++) path.push(b[i]); }   // Unterseiten vorne→hinten (Lücken unten schon offen)
    path.push({ x: xBR, y: last.bot[n - 1].y + m * (xBR - last.bot[n - 1].x) });  // hinten raus (Höhe EL-Unterkante)
    return { apexUp, apexLo, prev: S[0].top[1] || nose, nose, next: S[0].bot[1] || nose };
  }
  /* Draufsicht der Tragfläche (alle Segmente) mit den Steg-Grenzen in
   * ORIGINALLAGE (so, wie die Stücke zusammengesetzt werden) — oben im
   * Negativschalen-Fenster im Band [0..band]. Die Prozentwerte gelten für alle
   * Segmente gleich (Grenzen laufen als gerade Linien von Wurzel bis Randbogen). */
  function stegePlan(ctx, w, band, idx) {
    const st = App.wing && App.wing.stations; if (!st || st.length < 2) return;
    const L = stegeList();
    const leTe = st.map(s => { const xs = s.pts.map(p => p.x); return { z: s.z, le: Math.min.apply(null, xs), te: Math.max.apply(null, xs) }; });
    const outline = [];
    leTe.forEach(s => outline.push({ x: s.z, y: -s.le }));
    for (let i = leTe.length - 1; i >= 0; i--) outline.push({ x: leTe[i].z, y: -leTe[i].te });
    const V = makeView(w, band, bounds(outline), 22, null);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.025)'; ctx.fillRect(0, 0, w, band);
    // Aktives Segment hervorheben.
    const segZ = App.segZ || [];
    const sz = segZ[Math.min(idx, segZ.length - 1)];
    if (sz && leTe[idx] && leTe[idx + 1]) {
      const a = leTe[idx], b = leTe[idx + 1];
      poly(ctx, V, [{ x: a.z, y: -a.le }, { x: b.z, y: -b.le }, { x: b.z, y: -b.te }, { x: a.z, y: -a.te }], true);
      ctx.fillStyle = 'rgba(74,163,255,.10)'; ctx.fill();
    }
    ctx.strokeStyle = App.PAL.profInner; ctx.lineWidth = 1.4; ctx.setLineDash([]);
    poly(ctx, V, outline, true); ctx.stroke();
    ctx.strokeStyle = '#5a6675'; ctx.lineWidth = 1;
    leTe.forEach(s => { poly(ctx, V, [{ x: s.z, y: -s.le }, { x: s.z, y: -s.te }], false); ctx.stroke(); });
    // Steg-Grenzen: gleiche % an jeder Station -> gerade Linien über die Spannweite.
    ctx.strokeStyle = '#ffd27f'; ctx.lineWidth = 1.3; ctx.setLineDash([5, 3]);
    L.slice(0, -1).forEach(s => {
      poly(ctx, V, leTe.map(t => ({ x: t.z, y: -(t.le + (t.te - t.le) * s.end / 100) })), false); ctx.stroke();
    });
    ctx.setLineDash([]);
    // Beschriftung S1..SN mittig im aktiven Segment.
    if (leTe[idx] && leTe[idx + 1]) {
      const a = leTe[idx], b = leTe[idx + 1];
      ctx.fillStyle = '#ffd27f'; ctx.font = 'bold 11px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      L.forEach((s, k) => {
        const p0 = k === 0 ? 0 : L[k - 1].end, p1 = s.end, pm = (p0 + p1) / 200;
        const xm = ((a.le + (a.te - a.le) * pm) + (b.le + (b.te - b.le) * pm)) / 2;
        ctx.fillText('S' + (k + 1), V.X((a.z + b.z) / 2), V.Y(-xm));
      });
    }
    ctx.fillStyle = '#8b98a8'; ctx.font = '11px Segoe UI'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(T('Draufsicht · Stege in Originallage (zusammengesetzt) · Grenzen in % Sehne für alle Segmente'), 10, 6);
    ctx.strokeStyle = '#2a323c'; ctx.lineWidth = 1; poly(ctx, V, [], false);
    ctx.beginPath(); ctx.moveTo(0, band + 0.5); ctx.lineTo(w, band + 0.5); ctx.stroke();
    ctx.restore();
  }
  /* Kollisionsprüfung Stege ↔ Schalen/Stützstoff-Flächen und Blockhinterkante.
   * pts = Rippen-Nennprofil (TE→LE→TE), s2 = halbes Auseinanderziehen, sup =
   * innerster Stützstoff-Abstand, k2 = Abbrand/2, xBR = Block-Hinterkante. */
  function stegeCheck(S, pts, s2, sup, k2, xBR) {
    const iLE = Math.ceil(pts.length / 2) - 1;
    const upper = pts.slice(0, iLE + 1), lower = pts.slice(iLE);
    const xT = Math.max.apply(null, pts.map(p => p.x)), yTE = (pts[0].y + pts[pts.length - 1].y) / 2;
    const yAt = (arc, x) => { for (let i = 0; i < arc.length - 1; i++) { const a = arc[i], b = arc[i + 1]; if (x < Math.min(a.x, b.x) - 1e-9 || x > Math.max(a.x, b.x) + 1e-9 || Math.abs(b.x - a.x) < 1e-12) continue; return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x); } return null; };
    const lim = s2 - (sup || 0) - k2;   // Freiraum zwischen Nennfläche und innerster Schalen-/Stützfläche, abzüglich Abbrand
    let collide = false, over = false;
    S.forEach(pc => {
      pc.top.forEach(p => { const y = p.x > xT ? yTE : yAt(upper, p.x); if (y != null && p.y + k2 > y + lim) collide = true; if (p.x + k2 > xBR) over = true; });
      pc.bot.forEach(p => { const y = p.x > xT ? yTE : yAt(lower, p.x); if (y != null && p.y - k2 < y - lim) collide = true; if (p.x + k2 > xBR) over = true; });
    });
    return { collide, over };
  }

  // ---------- Zeichnen (Zusatz im Negativschalen-Fenster) ------------------
  /* Beschriftung/Bemaßung der Stege + Legendenzeilen. SR/ST = Stege Wurzel/Rand,
   * root/tip = negShell-Ergebnisse, ck = Abbrand innen/außen, shR/shT = Sichtbarkeit. */
  function stegeDecorate(ctx, V, SR, ST, root, tip, rPts, tPts, supMax, ck, shR, shT) {
    const leg = [];
    if (!SR || !SR.length) return leg;
    ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    SR.forEach(pc => {
      const bad = pc.thin || (ST[pc.k] && ST[pc.k].thin);
      const cx = (pc.xa + pc.xb) / 2 + pc.dx;
      let yMax = -Infinity; pc.top.forEach(p => { if (p.y > yMax) yMax = p.y; });
      ctx.fillStyle = bad ? '#ff5a3c' : '#ffd27f';
      if (shR) ctx.fillText('S' + (pc.k + 1) + ' · ' + pc.w.toFixed(1) + ' mm' + (bad ? ' !' : ''), V.X(cx), V.Y(yMax) - 6);
      // Nennbreite (Wurzel) unter dem Block bemaßen — das Maß, das nach dem Zusammensetzen zählt.
      if (state.cfg.showDim && shR) dim(ctx, V, pc.xa + pc.dx, root.yBot, pc.xb + pc.dx, root.yBot, String(Math.round(pc.w * 10) / 10), { off: 90, color: '#ffd27f' });
    });
    const gap = stegeGap();
    const cR = stegeCheck(SR, rPts, root.s2, supMax, ck.root / 2, root.xBR);
    const cT = stegeCheck(ST, tPts, tip.s2, supMax, ck.tip / 2, tip.xBR);
    const capTxt = SR.map(pc => (pc.st.sleeve || pc.st.capTop || pc.st.capBot) ? ('S' + (pc.k + 1) + ': ' + T('Schlauch ') + pc.st.sleeve + ' / ' + T('Gurt ') + pc.st.capTop + '+' + pc.st.capBot) : null).filter(Boolean).join(' · ');
    leg.push(['#ffd27f', T('Kern-Stege: ') + SR.length + T(' Stücke im selben Schnitt · Nennbreiten (Wurzel) ') + SR.map(pc => pc.w.toFixed(1)).join(' + ') + ' = ' + SR[0].chord.toFixed(1) + T(' mm = Sehne · Stegabstand ') + gap + ' mm']);
    if (capTxt) leg.push(['#8b98a8', T('Abzüge je Steg (mm): ') + capTxt]);
    if (SR.some(pc => pc.thin) || ST.some(pc => pc.thin)) leg.push(['#ff5a3c', T('! Steg zu dünn oder zu schmal (Abzüge größer als Profildicke/Stegbreite)')]);
    if (gap <= Math.max(ck.root, ck.tip)) leg.push(['#ff5a3c', T('! Stegabstand kleiner als der Abbrand — benachbarte Stege werden angeschnitten')]);
    if (!state.cfg.negStegeOnly && (cR.collide || cT.collide)) leg.push(['#ff5a3c', T('! Steg berührt Schale/Stützstoff — „Ober-/Unterseite auseinanderziehen" vergrößern oder Stegabstand verkleinern')]);
    if (cR.over || cT.over) leg.push(['#ff5a3c', T('! Stege ragen über die Block-Hinterkante — „Überstand hinten" vergrößern')]);
    return leg;
  }

  /* Export-Layer (DXF-Export / CAD-Import) für Segment k: je Steg eine geschlossene
   * Nennkontur, einmal in ORIGINALLAGE (zusammengesetzt) und einmal in SCHNITTLAGE
   * (im Block auseinandergerückt), Wurzel und Rand getrennt. Cut-mm, y nach oben.
   * Rückgabe: [{ name, color, polys:[{pts, closed}] }] */
  function stegeExportLayers(k) {
    if (!stegeOn() || !App.wing || !App.wing.cuts || !App.wing.cuts[k]) return [];
    const cut = App.wing.cuts[k], sh = state.cfg.negCoreSheeting || 0, out = [];
    const loop = pc => pc.top.concat(pc.bot.slice().reverse()).map(p => ({ x: p.x, y: p.y }));
    const unshift = (pc, P) => P.map(p => ({ x: p.x - pc.dx, y: p.y }));
    [['WURZEL', 'root'], ['RAND', 'tip']].forEach(([lab, rib]) => {
      const S = stegePieces(App.negCoreContour(App.negRibPts(cut, k, rib), sh));
      out.push({ name: 'STEGE_ORIGINALLAGE_' + lab + '_S' + (k + 1), color: rib === 'root' ? 2 : 3,
        polys: S.map(pc => ({ pts: unshift(pc, loop(pc)), closed: true })) });
      out.push({ name: 'STEGE_SCHNITTLAGE_' + lab + '_S' + (k + 1), color: rib === 'root' ? 30 : 8,
        polys: S.map(pc => ({ pts: loop(pc), closed: true })) });
    });
    return out;
  }

  // ---------- Sidebar (Reiter Negativschalendesign) --------------------------
  /* Aufteilung (Anzahl, Stegabstand, Steg-Karten) — gemeinsam für Negativdesign
   * und Kerndesign (kernteile.js): beide nutzen dieselbe Steg-Liste. */
  function stegeListUi(body, rr) {
    subhead(body, 'Aufteilung');
    const L = stegeList();
    numRow(body, 'Anzahl Stege', () => L.length, v => { stegeSetCount(v); buildSidebar(); rr(); },
      { int: true, min: 1, max: 30, step: 1, norender: true, hint: 'Anzahl der Sehnen-Abschnitte. Beim Ändern werden die Grenzen gleichmäßig verteilt.' });
    const rowB = document.createElement('div'); rowB.className = 'row';
    rowB.appendChild(mkMini(T('Gleichmäßig verteilen'), () => { stegeEven(L); buildSidebar(); rr(); }));
    body.appendChild(rowB);
    numRow(body, 'Stegabstand (mm)', () => state.cfg.negStegeGap, v => { state.cfg.negStegeGap = Math.max(0, v); rr(); },
      { step: 0.5, min: 0, norender: true, hint: 'Die Stege werden im Block um diesen Abstand auseinandergerückt (Steg k um k·Abstand nach hinten). '
        + 'Muss GRÖSSER als der Abbrand sein, sonst schneidet der Draht den Nachbarsteg an. Die Stege brauchen dafür Platz zwischen den '
        + 'Schalen („auseinanderziehen") und hinter der Endleiste („Überstand hinten") — die Anzeige warnt bei Kollision.' });
    subhead(body, 'Stege (ab Nase)');
    // Bezugssehne für die mm-Eingabe = Wurzelsehne des 1. Segments (die %-Werte
    // gelten für alle Segmente; andere Rippen skalieren proportional).
    const refC = (App.wing && App.wing.cuts && App.wing.cuts[0] && App.wing.cuts[0].root.chord) || 0;
    hint(body, 'Je Steg: Ende ab Nase in % der Sehne ODER in mm (Bezug: Wurzelsehne des 1. Segments = '
      + refC.toFixed(1) + ' mm; beide Felder sind gekoppelt, andere Rippen skalieren proportional), Glasschlauch-Dicke '
      + '(wird RUNDUM abgezogen: oben, unten und an beiden Flanken) sowie Holmgurt oben/unten (zusätzlich von der '
      + 'Ober-/Unterseite abgezogen). 0 = nichts abziehen.');
    L.forEach((st, k) => {
      const a = k === 0 ? 0 : L[k - 1].end, b = k === L.length - 1 ? 100 : st.end;
      const card = document.createElement('div');
      card.style.cssText = 'border:1px solid var(--line);border-radius:7px;padding:6px 8px;margin:2px 0;background:var(--panel2)';
      const hd = document.createElement('b'); hd.style.fontSize = '12px';
      const title = e => T('Steg ') + (k + 1) + '  ·  ' + a.toFixed(1) + ' – ' + e.toFixed(1) + ' %  (' + (refC * a / 100).toFixed(1) + ' – ' + (refC * e / 100).toFixed(1) + ' mm)';
      hd.textContent = title(b);
      card.appendChild(hd);
      if (k < L.length - 1) {
        const setEnd = v => {
          const lo = (k === 0 ? 0 : L[k - 1].end) + 0.5, hi = (k + 1 < L.length - 1 ? L[k + 1].end : 100) - 0.5;
          st.end = Math.round(Math.min(hi, Math.max(lo, v)) * 100) / 100; hd.textContent = title(st.end); rr();
        };
        let inPct, inMM;
        inPct = numRow(card, 'Ende (% Sehne ab Nase)', () => st.end, v => { setEnd(v); if (inMM) inMM.value = (refC * st.end / 100).toFixed(1); },
          { step: 0.5, min: 0, max: 100, norender: true });
        if (refC > 0)
          inMM = numRow(card, 'Ende (mm ab Nase, Wurzel 1. Seg.)', () => +(refC * st.end / 100).toFixed(1), v => { setEnd(v / refC * 100); if (inPct) inPct.value = st.end; },
            { step: 1, min: 0, max: refC, norender: true });
      }
      numRow(card, 'Glasschlauch-Dicke (mm)', () => st.sleeve, v => { st.sleeve = Math.max(0, v); rr(); }, { step: 0.1, min: 0, norender: true });
      numRow(card, 'Holmgurt oben (mm)', () => st.capTop, v => { st.capTop = Math.max(0, v); rr(); }, { step: 0.1, min: 0, norender: true });
      numRow(card, 'Holmgurt unten (mm)', () => st.capBot, v => { st.capBot = Math.max(0, v); rr(); }, { step: 0.1, min: 0, norender: true });
      body.appendChild(card);
    });
  }

  function stegeSidebar(side) {
    if (!state.cfg.negCore) return;   // nur mit „Kern mitschneiden"
    const g = grp('Kern in Stege zerlegen', true, 'neg');
    hint(g.body, 'Zerlegt den Kern zwischen den Schalen in einzelne Stege (Sehnen-Abschnitte). Schalen und Stege werden '
      + 'in EINEM durchgehenden Schnitt aus dem Negativblock gefahren (die Stege ersetzen die Kern-Schlaufe). Die Stege '
      + 'liegen um den Stegabstand auseinandergerückt, damit jeder Steg für sich um Abbrand/2 nach außen kompensiert '
      + 'wird — die fertigen Stücke haben Nennmaß und ergeben zusammengesetzt wieder das Ursprungsprofil. Glasschlauch '
      + '(rundum) und Holmgurte (oben/unten) werden je Steg abgezogen, damit der bezogene Steg wieder auf Nennmaß kommt. '
      + 'Basis ist der Kern inkl. Beplankungsabzug — nur mit „Kern mitschneiden"; die Nasen-Schlaufe des 1. Stegs ist dieselbe wie beim '
      + 'Kern (Menü „Kern & Stützstoff"). Die Prozentgrenzen gelten für ALLE Segmente (oben: Draufsicht mit den Stegen in Originallage).');
    const rr = () => App.render();
    boolRow(g.body, 'Kern in Stege zerlegen', () => stegeOn(), v => { state.cfg.negStegeOn = v; buildSidebar(); });
    if (!stegeOn()) { side.appendChild(g.g); return; }
    boolRow(g.body, 'Nur Stege schneiden (ohne Schalen)', () => !!state.cfg.negStegeOnly, v => { state.cfg.negStegeOnly = v; buildSidebar(); },
      'Schneidet ausschließlich die Stege aus dem Block — die Formhälften (Schalen), Stützstoff und die Schalenrand-Vorschnitte entfallen. '
      + 'Die Bahn beginnt und endet hinten am Block auf Endleisten-Höhe. Aus: Schalen und Stege in EINEM Schnitt.');
    stegeListUi(g.body, rr);
    side.appendChild(g.g);
  }

  Object.assign(App, { stegeCheck, stegeDecorate, stegeEmit, stegeExportLayers, stegeList, stegeOn, stegePiece, stegePieces, stegePlan, stegeSidebar, stegeListUi });
})();
