/* spars.js — Holmausschnitte und Taschen (Spars)  (@@split-module, ausgelagert aus app.js)
 * Namen aus früher geladenen Dateien werden unten aus window.App gebunden;
 * Namen aus app.js (lädt später) laufen als App.<name>. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { dashFor, state } = App;
  // ---------- Holmausschnitte in den Schnittpfad einrechnen -----------
  // Fügt je Holm einen synchronen „Abstecher" in die geschlossene Rippenbahn ein:
  // von der Oberfläche über einen Anfahr-Schlitz in die Tasche, einmal um die
  // Tasche herum und über denselben Schlitz zurück. Wurzel- und Außenbahn werden
  // am GLEICHEN Index mit gleich vielen Punkten eingefügt -> beide Türme bleiben
  // synchron. Danach werden die Turmbahnen (left/right) neu projiziert.
  const SPAR_LEAD_N = 5, SPAR_HOLE_N = 160;
  const SPAR_CORE_GAP = 2;   // mm: Abstand des Kern-Einstichs vor der Tasche (nicht proportionale Holme)
  function applySparCuts(pr, cut, segIdx) {
    const spars = (state.spars || []).filter(sp => sparAppliesTo(sp, segIdx));
    if (!state.cfg.sparCut || !spars.length || !pr) return pr;
    // Schnittzeitpunkt JE HOLM (sp.cutMode, Kerndesign → Holmausschnitte): nur Loch-
    // Holme mit „während des Schnitts" werden hier in die Profilbahn eingerechnet;
    // „nach dem Schnitt"/„nach Oberseitenschnitt" erzeugen eigene Bahnen (gcodegen
    // sparPocketLines). GURTTASCHEN (Tasche / Tasche + Steg) haben keinen Anfahr-
    // schlitz und keine Wahl: sie werden immer hier eingerechnet.
    // „Nur Holmausschnitte" (state.cfg.sparOnly): kein Profilschnitt -> nichts.
    migrateSparModes();
    if (state.cfg.sparOnly) return pr;
    let root = pr.rootPath.slice(0, -1), tip = pr.tipPath.slice(0, -1);   // Schließpunkt entfernen
    // Abbrand der Tasche: 'in' = nach innen (fertige Tasche = Nennmaß), 'out' =
    // nach außen (Tasche wird größer), 'none' = kein Versatz.
    const inserts = [];
    const pockets = [];
    spars.forEach(sp => {
      try {
        // Nicht proportionale Holme NICHT in den Profilpfad einrechnen (würde das
        // Profil verfälschen) — sie werden separat („nach"/„nur") geschnitten.
        // Taschen (Gurt ohne Steg): eigener Einbau (kein Anfahr-Schlitz, sondern
        // der Profilschnitt läuft in die Tasche und wieder heraus) — nach den
        // Loch-Abstechern eingerechnet. Nur bei proportionaler Holmlage möglich
        // (das Oberflächenstück wird ersetzt -> würde sonst das Profil verfälschen).
        const prop = sparProportional(sp);
        if (isPocket(sp)) { pockets.push(sp); return; }
        if (sparModeOf(sp) !== 'during') return;   // eigene Bahnen im Modus „nach…"
        const yco = sparYc(sp);
        const coreR = pr.rootCore || sparCoreOf(cut.root.pts, segIdx, 'root'), coreT = pr.tipCore || sparCoreOf(cut.tip.pts, segIdx, 'tip');
        const gr = sparOnProfile(sp, cut.root.pts, coreR || cut.root.pts, sparFromLE(sp, segIdx, 'root'), yco, 'root', coreR);
        const gt = sparOnProfile(sp, cut.tip.pts, coreT || cut.tip.pts, sparFromLE(sp, segIdx, 'tip'), yco, 'tip', coreT);
        if (!gr || !gr.lead || !gt || !gt.lead) return;   // reicht bis zur Oberfläche -> überspringen
        const kh = App.sparKerfHalf(sp, cut, gr.poly, gt.poly);   // Abbrand je Rippe (Modus/Bezug: global oder je Holm)
        // Abzweigung dort, wo die SENKRECHTE bei x=xc die Rippenbahn kreuzt — je
        // Rippe an IHREM eigenen Holm-x (gr.xc bzw. gt.xc). Fehlt dort ein Bahn-
        // punkt, wird er durch Kantenteilung ERZEUGT -> die Anfahrt ist IMMER
        // senkrecht (auch wenn Wurzel/Rand das Holm-x an unterschiedlichen Stellen
        // haben). Eingefügt wird bei EINEM gemeinsamen Index (Wurzel) -> Türme sync.
        const crR = crossOnPath(root, gr.xc, gr.lead[1].y);
        const crT = crossOnPath(tip, gt.xc, gt.lead[1].y);
        if (!crR || !crT) return;
        let eR = lerpPt(root[crR.i], root[crR.i + 1], crR.t), eT = lerpPt(tip[crT.i], tip[crT.i + 1], crT.t), iIns = crR.i;
        if (!prop) {
          // NICHT proportional: Wurzel und Rand erreichen ihren Holm an verschiedenen
          // Bahnindizes. Abzweig an EINEM gemeinsamen Punkt der Bahn VOR beiden Holmen
          // (Nasenseite). Beide Rippen fahren dort senkrecht in den Kern auf Holm-
          // Mittenhöhe, zurück zur Holm-Vorderwand, umfahren den Holm und verlassen den
          // Kern auf demselben Weg (holeExcursion viaCore). Gleiches (i, t) für beide,
          // Anfahrpunkt = Vorderwand-Mitte auf beiden Rippen -> Türme synchron.
          // Abzweigpunkt: VOR dem Holm (Nasenseite), mit Abstand SPAR_CORE_GAP vor
          // der (abbrand-versetzten) Tasche, damit der senkrechte Schlitz die Tasche
          // nicht trifft. Von beiden Kandidaten den nehmen, bei dem BEIDE Rippen vor
          // ihrem Holm liegen (je nach Laufrichtung der Bahn der spätere/frühere).
          const frontX = (poly, k) => Math.min.apply(null, poly.map(p => p.x)) - Math.abs(k) - SPAR_CORE_GAP;
          const fR = crossOnPath(root, frontX(gr.poly, kh.root), gr.lead[1].y);
          const fT = crossOnPath(tip, frontX(gt.poly, kh.tip), gt.lead[1].y);
          if (!fR || !fT) return;
          const later = (fR.i > fT.i || (fR.i === fT.i && fR.t >= fT.t)) ? fR : fT;
          const earlier = later === fR ? fT : fR;
          const xDecr = root[fR.i + 1].x < root[fR.i].x;   // Bahn läuft hier Richtung Nase?
          const near = xDecr ? later : earlier;
          iIns = near.i;
          eR = lerpPt(root[near.i], root[near.i + 1], near.t);
          eT = lerpPt(tip[near.i], tip[near.i + 1], near.t);
        }
        // Ecken-Anker nur, wenn Wurzel und Rand nach Offset/Deloop GLEICH viele Ecken
        // haben (sonst fielen Anker auf verschiedene Ecken -> Turmbahnen verdreht).
        const kR = kerfKeepTopology(eR, gr.poly, gr.lead[0], kh.root, cut.root.pts, !prop);
        const kT = kerfKeepTopology(eT, gt.poly, gt.lead[0], kh.tip, cut.tip.pts, !prop);
        const hpR = holeLoopPrep(eR, gr.poly, gr.lead[0], kR, cut.root.pts, !prop);
        const hpT = holeLoopPrep(eT, gt.poly, gt.lead[0], kT, cut.tip.pts, !prop);
        const noAnchor = loopAnchors(hpR.loop).anchors.length !== loopAnchors(hpT.loop).anchors.length;
        inserts.push({
          i: iIns,
          root: holeExcursionFinish(eR, hpR.loop, hpR.corner, !prop, noAnchor),
          tip: holeExcursionFinish(eT, hpT.loop, hpT.corner, !prop, noAnchor)
        });
      } catch (e) { /* einzelnen Holm überspringen, Rippenbahn bleibt erhalten */ }
    });
    if (!inserts.length && !pockets.length) return pr;
    inserts.sort((a, b) => b.i - a.i);              // von hinten einfügen -> Indizes bleiben gültig
    inserts.forEach(ins => {
      root.splice(ins.i + 1, 0, ...ins.root);
      tip.splice(ins.i + 1, 0, ...ins.tip);
    });
    // Taschen einrechnen: je Tasche(nseite) wird das Oberflächenstück über der
    // Tasche durch Wand→Boden→Wand ersetzt (gleiche Punktzahl -> Türme synchron).
    // Nicht proportionale Lage: Mündungen je Rippe eigen, das Fenster dazwischen
    // wird abschnittsweise neu abgetastet (siehe carvePocketSide).
    // Wand-Abbrand der Taschen = halber Kerf der Profilbahn je Rippe (dieselbe
    // Kompensation, die der Boden über die Bahn erbt). Im Modus „lokal (Bahn-
    // geschwindigkeit)" als Näherung der Rippen-Kerf aus dem Sehnenverhältnis.
    const ckP = App.cutKerf(cut.root.chord, cut.tip.chord);
    const ki = pr.kerfInfo || {};
    const kerfHalf = { root: (ki.root != null ? ki.root : ckP.root) / 2, tip: (ki.tip != null ? ki.tip : ckP.tip) / 2 };
    pockets.forEach(sp => {
      try {
        const sides = (sp.pkSide === 'top' || sp.pkSide === 'bottom') ? [sp.pkSide] : ['top', 'bottom'];
        sides.forEach(side => {
          const res = carvePocketSide(root, tip, sp, cut, segIdx, side, kerfHalf);
          if (res) { root = res.root; tip = res.tip; }
        });
      } catch (e) { /* einzelne Tasche überspringen */ }
    });
    // Bahn schließen und Turmbahnen neu projizieren (wie in HotWire.project).
    const rootPath = root.concat([{ x: root[0].x, y: root[0].y }]);
    const tipPath = tip.concat([{ x: tip[0].x, y: tip[0].y }]);
    const zR = pr.zRoot, zT = pr.zTip, mw = state.cfg.machineWidth;
    const prj = (vr, vt, zp) => vr + ((zp - zR) / ((zT - zR) || 1)) * (vt - vr);
    const n = Math.min(rootPath.length, tipPath.length), left = [], right = [];
    for (let k = 0; k < n; k++) {
      const r = rootPath[k], t = tipPath[k];
      left.push({ x: prj(r.x, t.x, 0), y: prj(r.y, t.y, 0) });
      right.push({ x: prj(r.x, t.x, mw), y: prj(r.y, t.y, mw) });
    }
    return Object.assign({}, pr, { rootPath, tipPath, left, right });
  }
  function nearestIdx(pts, p) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i++) { const dx = pts[i].x - p.x, dy = pts[i].y - p.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; bi = i; } }
    return bi;
  }
  // ---------- Taschen (Gurt ohne Steg) --------------------------------------
  // Geometrie einer Tasche an einer Rippe: xc (Lage ab NL), x0/x1 (Mündung an der
  // Oberfläche links/rechts), off = deloopte Innen-Offset-Kontur (= Taschenboden,
  // echter Parallel-Offset um die Tiefe), dTanF/dTanR = waagrechter Wandversatz
  // (Boden ggü. Mündung) aus den Wandwinkeln. `fromLE` überschreibt die Lage.
  // Taschentiefe je Seite (oben/unten getrennt; Altstände: gemeinsame pkDepth).
  // Schnittzeitpunkt eines Holms: 'during' (in der Profilbahn), 'after' (nach dem
  // Profil, Pause) oder 'afterTop' (nach der Oberseite, Pause). Je Holm (sp.cutMode);
  // Gurttaschen immer 'during' (keine Wahl). Fehlt der Wert (alte Projekte), gilt
  // die frühere globale Einstellung state.cfg.sparCutMode.
  function sparModeOf(sp) {
    if (isPocket(sp)) return 'during';
    const m = sp.cutMode || state.cfg.sparCutMode || 'during';
    return (m === 'after' || m === 'afterTop') ? m : 'during';
  }
  // Altstände: globales sparCutMode 'only' -> Schalter „nur Holmausschnitte";
  // 'after'/'afterTop' -> in alle Loch-Holme ohne eigenen Wert übernehmen.
  function migrateSparModes() {
    const g = state.cfg.sparCutMode;
    if (!g) return;
    if (g === 'only') state.cfg.sparOnly = true;
    else if (g === 'after' || g === 'afterTop')
      (state.spars || []).forEach(sp => { if (!sp.cutMode && !isPocket(sp)) sp.cutMode = g; });
    state.cfg.sparCutMode = null;
  }
  // Taschen-Formen: 'pocket' (Gurt ohne Steg) und 'pocketWeb' (Tasche + halber Steg).
  function isPocket(sp) { return sp.shape === 'pocket' || sp.shape === 'pocketWeb'; }
  function pocketDepth(sp, side) {
    const d = side === 'bottom' ? (sp.pkDepthBot != null ? sp.pkDepthBot : sp.pkDepth)
                                : (sp.pkDepthTop != null ? sp.pkDepthTop : sp.pkDepth);
    return d != null ? d : 8;
  }
  function pocketGeom(pts, sp, segIdx, which, fromLE, side) {
    const xs = pts.map(p => p.x), leX = Math.min.apply(null, xs), teX = Math.max.apply(null, xs), chord = (teX - leX) || 1;
    const fl = fromLE != null ? fromLE : sparFromLE(sp, segIdx, which);
    const dLE = fl != null ? fl : (sp.pos || 0) / 100 * chord;   // Tasche: immer proportional
    const xc = leX + dLE;
    const surf = surfaceAtX(pts, xc); if (!surf) return null;
    const thick = surf.top - surf.bot;
    const u = sp.sizeMode === 'mm' ? 1 : thick / 100;
    const sz = sparSize(sp, which);
    const halfW = Math.max(0.1, (sz.w || 0) * u) / 2;
    // Tiefe senkrecht zur Kontur; auf ~85 % der lokalen Profildicke begrenzt, damit
    // der Boden nicht durch die gegenüberliegende Profilseite stößt.
    const depth = Math.max(0.1, Math.min(pocketDepth(sp, side), thick * 0.85));
    const angF = (sp.angFront || 0) * Math.PI / 180, angR = (sp.angRear || 0) * Math.PI / 180;
    // Halber Steg (Doppel-T): Schlitz vom Taschenboden weiter in den Kern, Höhe je
    // Seite (pkWebTop/pkWebBot, mm), Breite pkWebW (mm). Auf die Restdicke unter dem
    // Boden begrenzt, damit der Schlitz nicht aus der Gegenseite austritt.
    // Nur Form 'pocketWeb'. Höhe gilt an der Wurzelstation des Holms und wird
    // PROPORTIONAL zur Sehne skaliert (Rand = Wurzelwert · Sehnenverhältnis).
    const webIn = sp.shape === 'pocketWeb' ? (side === 'bottom' ? (sp.pkWebBot || 0) : (sp.pkWebTop || 0)) : 0;
    const webRaw = webIn * chord / stationChord(sparRange(sp)[0]);
    const webH = Math.max(0, Math.min(webRaw, thick - depth - 0.2));
    const webW = Math.max(0, sp.pkWebW != null ? sp.pkWebW : 2);
    return { xc, x0: xc - halfW, x1: xc + halfW, dTanF: depth * Math.tan(angF), dTanR: depth * Math.tan(angR), depth, webH, webW };
  }
  // Halben Steg in den Taschenboden einsetzen: an der Holmmitte (xc) geht die Spur um
  // webH weiter in den Kern (Schlitzbreite webW, abzüglich Wand-Abbrand k je Seite)
  // und kommt wieder zurück auf den Boden. Boden-Reihenfolge (Bogenrichtung) bleibt.
  // M != null -> beide Boden-Teile auf je floor(M/2) Punkte (Wurzel/Rand synchron);
  // Gesamtzahl damit 2*floor(M/2)+2 — für beide Rippen identisch. Ohne Steg: M Punkte.
  function floorWithWeb(floor, g, side, M, k) {
    if (!(g.webH > 0) || floor.length < 2) return M != null ? resamplePolylineN(floor, M) : floor;
    const xF = floor[0].x, xL = floor[floor.length - 1].x, desc = xL < xF;
    const lo = Math.min(xF, xL), hi = Math.max(xF, xL);
    const half = Math.max(0, g.webW / 2 - (k || 0));
    const wL = Math.max(lo + 0.01, Math.min(hi - 0.01, g.xc - half));
    const wR = Math.max(wL, Math.min(hi - 0.01, g.xc + half));
    let partLo = clipPolylineX(floor, lo, wL), partHi = clipPolylineX(floor, wR, hi);
    if (M != null) { const M1 = Math.max(2, Math.floor(M / 2)); partLo = resamplePolylineN(partLo, M1); partHi = resamplePolylineN(partHi, M1); }
    const first = desc ? partHi : partLo, second = desc ? partLo : partHi;
    const p1 = first[first.length - 1], p2 = second[0], dy = side === 'top' ? -g.webH : g.webH;
    return first.concat([{ x: p1.x, y: p1.y + dy }, { x: p2.x, y: p2.y + dy }], second);
  }
  // Offene Polylinie längenproportional auf n Punkte neu abtasten (Reihenfolge bleibt).
  function resamplePolylineN(arc, n) {
    if (arc.length <= 1) return arc.slice();
    const cum = [0]; for (let i = 1; i < arc.length; i++) cum.push(cum[i - 1] + Math.hypot(arc[i].x - arc[i - 1].x, arc[i].y - arc[i - 1].y));
    const total = cum[cum.length - 1] || 1, out = []; let seg = 0;
    for (let k = 0; k < n; k++) {
      const target = total * k / (n - 1);
      while (seg < arc.length - 2 && cum[seg + 1] < target) seg++;
      const l = (cum[seg + 1] - cum[seg]) || 1, f = (target - cum[seg]) / l;
      out.push({ x: arc[seg].x + f * (arc[seg + 1].x - arc[seg].x), y: arc[seg].y + f * (arc[seg + 1].y - arc[seg].y) });
    }
    return out;
  }
  // Senkrecht-Offset (Parallel-Offset) einer offenen Polylinie um `depth` nach INNEN
  // (Taschenboden). Für die Oberseite zeigt die Innen-Normale nach unten, für die
  // Unterseite nach oben. Jeder Punkt wandert entlang der lokalen Normale -> die
  // Tiefe steht überall senkrecht auf der Kontur, auch bei Wölbung.
  function offsetArcPerp(arc, depth, top) {
    const n = arc.length; if (n < 2) return null;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = arc[Math.max(0, i - 1)], b = arc[Math.min(n - 1, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y; const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
      let nx = -ty, ny = tx;                       // Normale zur Tangente
      if (top ? ny > 0 : ny < 0) { nx = -nx; ny = -ny; }   // oben: nach unten; unten: nach oben
      out.push({ x: arc[i].x + nx * depth, y: arc[i].y + ny * depth });
    }
    return out;
  }
  // Offene Polylinie EXAKT auf den x-Bereich [lo, hi] beschneiden: die Endpunkte
  // werden auf den Grenzen INTERPOLIERT (nicht auf den nächsten Stützpunkt gerundet).
  // Sonst rastet die Bodenbreite auf den Punktabstand der Bahn ein und die Wände
  // werden schief. Ist der Bereich kollabiert, Rückgabe = 2 gleiche Punkte (Mitte).
  function clipPolylineX(arc, lo, hi) {
    const yAt = x => { for (let i = 0; i < arc.length - 1; i++) { const a = arc[i], b = arc[i + 1]; if (x < Math.min(a.x, b.x) - 1e-9 || x > Math.max(a.x, b.x) + 1e-9 || Math.abs(b.x - a.x) < 1e-12) continue; return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x); } return null; };
    const mid = arc[Math.floor(arc.length / 2)] || arc[0];
    if (hi <= lo) { const m = (lo + hi) / 2, y = yAt(m); const q = y == null ? mid : { x: m, y }; return [{ x: q.x, y: q.y }, { x: q.x, y: q.y }]; }
    // Reihenfolge = Bogenrichtung: läuft der Bogen von hohem zu niedrigem x, ist
    // die hi-Grenze der ERSTE Punkt (sonst Zickzack).
    const desc = arc.length > 1 && arc[0].x > arc[arc.length - 1].x;
    const xF = desc ? hi : lo, xL = desc ? lo : hi, yF = yAt(xF), yL = yAt(xL);
    const out = [];
    if (yF != null) out.push({ x: xF, y: yF });
    arc.forEach(p => { if (p.x > lo + 1e-9 && p.x < hi - 1e-9) out.push({ x: p.x, y: p.y }); });
    if (yL != null) out.push({ x: xL, y: yL });
    if (out.length < 2) { const q = out[0] || mid; return [{ x: q.x, y: q.y }, { x: q.x, y: q.y }]; }
    return out;
  }
  // Abbrand-Kompensation der Taschen-WÄNDE. Der Draht fährt jede Wand um den halben
  // Abbrand k (senkrecht zur Wand) in die Tasche hinein versetzt; für die Wand mit
  // Winkel a (ab Senkrechte) ist das waagrecht k/cos(a). Rückgabe im Nennsystem:
  //   xA/xB : Mündungs-x auf der (um k nach außen versetzten) Drahtbahn — dort
  //           trifft die versetzte Wand die versetzte Oberfläche (y = +k),
  //   fLo/fHi: x-Grenzen des Bodens auf Draht-Höhe (y = k − Tiefe).
  // k = 0 -> Nennmaße (x0/x1 bzw. x0+dTanF / x1−dTanR). k < 0 weitet die Tasche.
  function pocketWallKerf(g, k) {
    const tF = g.depth > 0 ? g.dTanF / g.depth : 0, tR = g.depth > 0 ? g.dTanR / g.depth : 0;   // tan(a)
    const cF = 1 / Math.sqrt(1 + tF * tF), cR = 1 / Math.sqrt(1 + tR * tR);                     // cos(a)
    const sF = tF * cF, sR = tR * cR;                                                             // sin(a)
    const xA = g.x0 + k * (1 - sF) / cF, xB = g.x1 - k * (1 - sR) / cR;
    let fLo = g.x0 + (g.depth - k) * tF + k / cF, fHi = g.x1 - (g.depth - k) * tR - k / cR;
    if (fHi < fLo) { const m = (fLo + fHi) / 2; fLo = m; fHi = m; }
    return { xA, xB, fLo, fHi };
  }
  // Taschenboden aus dem (kerf-kompensierten) Oberflächenbogen: Parallel-Offset um
  // die Tiefe (erbt damit die Abbrandkompensation des Profils) + Wandwinkel-Beschnitt
  // (Wand-Abbrand k mit eingerechnet). Reihenfolge = Bogenrichtung (a->b). Genau M
  // Punkte (Wurzel/Rand synchron).
  function pocketFloorFromArc(arc, g, side, M, flat, k) {
    const off = offsetArcPerp(arc, g.depth, side === 'top'); if (!off) return null;
    const w = pocketWallKerf(g, k || 0);
    let floor = monotonicX(clipPolylineX(off, w.fLo, w.fHi));
    if (flat) floor = flattenFloor(floor, g);   // gerade waagrechte Innenkante (flacher Gurtboden)
    return floorWithWeb(floor, g, side, M, k || 0);
  }
  // Sicherheits-Wächter: der Taschenboden darf in x NUR IN EINE RICHTUNG laufen
  // (Richtung = Gesamtrichtung des Bogens). Rückläufige Punkte (Hin und Her in der
  // Schnittspur, z. B. aus Offset-Artefakten bei stark gewölbter Kontur) entfallen.
  function monotonicX(arc) {
    if (arc.length < 3) return arc;
    const dir = arc[arc.length - 1].x >= arc[0].x ? 1 : -1;
    const out = [arc[0]];
    for (let i = 1; i < arc.length; i++) if ((arc[i].x - out[out.length - 1].x) * dir >= 0) out.push(arc[i]);
    if (out.length < 2) out.push(arc[arc.length - 1]);
    return out;
  }
  // Boden auf konstante Höhe legen (gerade waagrechte Innenkante der Gurte). Die Höhe
  // = Boden-Wert an der Holmmitte (xc) -> die Tiefe stimmt dort exakt mit der Eingabe
  // überein; zur Nase/EL hin ändert sich die Tiefe entsprechend der Profilwölbung.
  function flattenFloor(floor, g) {
    const xc = (g.x0 + g.x1) / 2;
    let y = floor[0].y, bd = Infinity;
    floor.forEach(p => { const d = Math.abs(p.x - xc); if (d < bd) { bd = d; y = p.y; } });
    return floor.map(p => ({ x: p.x, y }));
  }
  // Muendungsbogen fuer den BODEN-Offset: ueber x0/x1 hinaus verlaengert (um die
  // Tiefe je Seite). Der Parallel-Offset verschiebt die Punkte bei geneigter
  // Oberflaeche auch in x; ohne Ueberstand endete der Bodenbogen VOR fLo/fHi und
  // die Wand der Nennkontur wurde schraeg (Drahtbahn dagegen senkrecht, weil sie
  // Nachbarpunkte der Bahn mitnimmt). Gleiches Vorgehen wie carvePocketSide.
  function mouthExt(pts, g, top, N) {
    const e = Math.max(2, g.depth * 1.2), lo = g.x0 - e, hi = g.x1 + e, out = [];
    for (let i = 0; i <= N; i++) {
      const x = lo + (hi - lo) * i / N, s = surfaceAtX(pts, x); if (!s) continue;
      out.push({ x, y: top ? s.top : s.bot });
    }
    return out;
  }
  // Geschlossener Umriss einer Tasche (nur Vorschau): Mündung an der Kontur (x0→x1)
  // + Boden (x1→x0). side 'top'/'bottom'.
  function pocketOutline(pts, g, side, flat) {
    const top = side === 'top', N = 24;
    const surfY = x => { const s = surfaceAtX(pts, x); return s ? (top ? s.top : s.bot) : null; };
    // Mündungsbogen entlang der Oberfläche (x0 -> x1).
    const mouth = [];
    for (let i = 0; i <= N; i++) { const x = g.x0 + (g.x1 - g.x0) * i / N, y = surfY(x); if (y == null) return null; mouth.push({ x, y }); }
    // Boden = senkrechter Parallel-Offset DIESES Bogens um die Tiefe — identisch zum
    // echten Schnitt (pocketFloorFromArc) und robust auch für dünne Profile. Der frühere
    // globale Kontur-Offset (offsetInward der GANZEN Rippe) überschnitt sich bei dünnen
    // Rand-Profilen nahe der Nase und wurde von deloopPoly weggeschnitten -> die Tasche
    // fehlte am Außenprofil. Zwischen den wandversetzten Grenzen (fLo..fHi) beschnitten.
    const floorArc = offsetArcPerp(mouthExt(pts, g, top, N), g.depth, top); if (!floorArc) return null;
    const w = pocketWallKerf(g, 0);
    let floor = monotonicX(clipPolylineX(floorArc, w.fLo, w.fHi));
    if (flat) floor = flattenFloor(floor, g);   // gerade waagrechte Innenkante (flacher Gurtboden)
    floor = floorWithWeb(floor, g, side, null, 0);
    const out = mouth.slice();
    for (let i = floor.length - 1; i >= 0; i--) out.push(floor[i]);
    out.closed = true; return out;
  }
  // Profilschleife `pts` mit EINER Taschenseite VERSCHMELZEN (fertiges Werkstück):
  // das Oberflächenstück über der Tasche wird getrimmt und durch Wand→Boden→Wand
  // ersetzt. Rückgabe { loop, a, b } — loop[a..b] ist der eingefügte Taschen-Teilpfad
  // (Mündung→Boden→Mündung). Grundlage für den Schneidepfad-Offset (offsetInward mit
  // NEGATIVEM Betrag = zur Abfallseite: Profil nach außen, Tasche nach innen).
  function pocketMergedLoop(pts, g, side, flat) {
    const top = side === 'top', N = 24;
    const surfY = x => { const s = surfaceAtX(pts, x); return s ? (top ? s.top : s.bot) : null; };
    const mouth = [];
    for (let i = 0; i <= N; i++) { const x = g.x0 + (g.x1 - g.x0) * i / N, y = surfY(x); if (y == null) return null; mouth.push({ x, y }); }
    const floorArc = offsetArcPerp(mouthExt(pts, g, top, N), g.depth, top); if (!floorArc) return null;
    const w = pocketWallKerf(g, 0);
    let floor = monotonicX(clipPolylineX(floorArc, w.fLo, w.fHi));
    if (flat) floor = flattenFloor(floor, g);
    floor = floorWithWeb(floor, g, side, null, 0);
    const mL = mouth[0], mR = mouth[mouth.length - 1];   // Mündung an x0 bzw. x1 (auf Oberfläche)
    const cL = crossOnPath(pts, mL.x, mL.y), cR = crossOnPath(pts, mR.x, mR.y);
    if (!cL || !cR) return null;
    const cmp = (a, b) => (a.i !== b.i) ? a.i - b.i : a.t - b.t;
    const firstIsL = cmp(cL, cR) <= 0;
    const ai = (firstIsL ? cL : cR).i, bi = (firstIsL ? cR : cL).i; if (bi < ai) return null;   // Tasche über die Naht -> überspringen
    const mA = firstIsL ? mL : mR, mB = firstIsL ? mR : mL;
    const fl = firstIsL ? floor : floor.slice().reverse();   // von A-Seite zur B-Seite
    const ins = [mA].concat(fl, [mB]);
    const loop = pts.slice(0, ai + 1).concat(ins, pts.slice(bi + 1)); loop.closed = true;
    return { loop, a: ai + 1, b: ai + ins.length };
  }
  // Profilkontur mit ALLEN zutreffenden Taschen verschmelzen (fertiges Werkstück).
  // pocketGeom aus der ORIGINAL-Kontur (korrekte Tiefe/Dicke), Einrechnen fortlaufend
  // in die (getrimmte) Schleife. Ohne Taschen unverändert.
  function profileWithPockets(pts, segIdx, which) {
    let loop = pts;
    (state.spars || []).forEach(sp => {
      if (!isPocket(sp) || !sparAppliesTo(sp, segIdx)) return;
      const fl = sparFromLE(sp, segIdx, which);
      const sides = (sp.pkSide === 'top' || sp.pkSide === 'bottom') ? [sp.pkSide] : ['top', 'bottom'];
      sides.forEach(side => { const g = pocketGeom(pts, sp, segIdx, which, fl, side); if (!g) return; const m = pocketMergedLoop(loop, g, side, sp.pkFlat); if (m) loop = m.loop; });
    });
    return loop;
  }
  // Schnittpunkt der (nötigenfalls verlängerten) Offset-Wand inner→outer mit der
  // Profiloberfläche (Seite top/bot). Für die Taschen-Schnittspur: der Mündungspunkt
  // soll dort liegen, wo die versetzte Wand die Haut trifft — NICHT am Gehrungspunkt
  // (Miter mit der Oberflächen-Offsetlinie), der die Mündung nach außen aufweiten würde.
  // So bleibt der Offset überall ein exakter Parallel-Abstand zur Taschenkontur.
  function wallHitSurface(inner, outer, pts, top) {
    const yAt = t => { const x = inner.x + t * (outer.x - inner.x); const s = surfaceAtX(pts, x); if (!s) return null; return (inner.y + t * (outer.y - inner.y)) - (top ? s.top : s.bot); };
    let lo = 0, hi = 1, fLo = yAt(0), fHi = yAt(1);
    if (fLo == null || fHi == null) return null;
    if (fLo * fHi > 0) { hi = 2; fHi = yAt(2); if (fHi == null || fLo * fHi > 0) return null; }
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2, fm = yAt(mid); if (fm == null) break; if (fLo * fm <= 0) hi = mid; else { lo = mid; fLo = fm; } }
    const t = (lo + hi) / 2;
    return { x: inner.x + t * (outer.x - inner.x), y: inner.y + t * (outer.y - inner.y) };
  }
  // Eine Taschenseite in die (synchronen, offenen) Rippenbahnen einrechnen: das
  // Oberflächenstück über der Tasche wird durch Wand→Boden→Wand ersetzt. Wurzel
  // und Rand werden am GLEICHEN Index mit gleich vielen Punkten gespleißt -> die
  // Türme bleiben synchron. Rückgabe { root, tip } oder null (Seite überspringen).
  function carvePocketSide(root, tip, sp, cut, segIdx, side, kerfHalf) {
    const M = 18;
    const gR = pocketGeom(cut.root.pts, sp, segIdx, 'root', null, side);
    const gT = pocketGeom(cut.tip.pts, sp, segIdx, 'tip', null, side);
    if (!gR || !gT) return null;
    const top = side === 'top';
    // Wand-Abbrand je Rippe (halber Kerf der Profilbahn): Mündungen und Bodengrenzen
    // rücken um k in die Tasche -> die FERTIGE Tasche hat das Nennmaß (der Boden
    // erbt den Offset ohnehin über die kerf-kompensierte Bahn).
    const kR = kerfHalf ? (kerfHalf.root || 0) : 0, kT = kerfHalf ? (kerfHalf.tip || 0) : 0;
    const wR = pocketWallKerf(gR, kR), wT = pocketWallKerf(gT, kT);
    // Ziel-Y = tatsächliche Profiloberfläche an x (aus der Rohkontur) — NICHT ±∞:
    // die Bahn enthält auch Anfahr-/Steg-/Verlängerungspunkte auf großer Höhe, die
    // sonst statt der Oberfläche getroffen würden.
    const syR = (pts, x) => { const s = surfaceAtX(pts, x); return s ? (top ? s.top : s.bot) : (top ? 1e6 : -1e6); };
    const rX0 = crossOnPath(root, wR.xA, syR(cut.root.pts, wR.xA)), rX1 = crossOnPath(root, wR.xB, syR(cut.root.pts, wR.xB));
    const tX0 = crossOnPath(tip, wT.xA, syR(cut.tip.pts, wT.xA)), tX1 = crossOnPath(tip, wT.xB, syR(cut.tip.pts, wT.xB));
    if (!rX0 || !rX1 || !tX0 || !tX1) return null;
    const cmp = (c0, c1) => (c0.i !== c1.i) ? c0.i - c1.i : c0.t - c1.t;
    const lowIsX0 = cmp(rX0, rX1) <= 0;                 // liegt x0 im Pfad VOR x1?
    const aR = lowIsX0 ? rX0 : rX1, bR = lowIsX0 ? rX1 : rX0;
    const aT = lowIsX0 ? tX0 : tX1, bT = lowIsX0 ? tX1 : tX0;
    if (bR.i < aR.i || bT.i < aT.i) return null;        // Sicherheits-Guard (Reihenfolge)
    const clampT = (arr, i, t) => lerpPt(arr[Math.min(i, arr.length - 2)], arr[Math.min(i + 1, arr.length - 1)], Math.max(0, Math.min(1, t)));
    // Mündungen auf der (bereits kerf-kompensierten) Profilbahn. Liegen beide im
    // SELBEN Bahnsegment (schmale Tasche / grobe Bahn), ist das Zwischenstück leer —
    // die Tasche wird trotzdem eingebaut (früher still übersprungen).
    const mAr = clampT(root, aR.i, aR.t), mBr = clampT(root, bR.i, bR.t);
    const mAt = clampT(tip, aT.i, aT.t),  mBt = clampT(tip, bT.i, bT.t);
    // Oberflächen-Bogen der Bahn um die Tasche (Pfadrichtung a->b), mit je zwei
    // Nachbarpunkten außerhalb der Mündungen: der Taschenboden wird als Parallel-
    // Offset DIESES Bogens gebildet -> erbt exakt die Abbrandkompensation des
    // Profils; die Tiefe steht senkrecht darauf. Die Randpunkte sorgen für saubere
    // Tangenten an den Bodenenden (und erlauben Hinterschnitt-Wände, a < 0).
    const arcOf = (path, a, b, mA, mB) => {
      const pre = Math.max(0, a.i - 1), post = Math.min(path.length, b.i + 3);
      return path.slice(pre, a.i + 1).concat([mA], path.slice(a.i + 1, b.i + 1), [mB], path.slice(b.i + 1, post));
    };
    const inR = pocketFloorFromArc(arcOf(root, aR, bR, mAr, mBr), gR, side, M, sp.pkFlat, kR);
    const inT = pocketFloorFromArc(arcOf(tip, aT, bT, mAt, mBt), gT, side, M, sp.pkFlat, kT);
    if (!inR || !inT) return null;
    const repR = [mAr].concat(inR, [mBr]);
    const repT = [mAt].concat(inT, [mBt]);
    if (repR.length !== repT.length) return null;       // Sicherheits-Guard (Steg-Sync)
    if (aR.i === aT.i && bR.i === bT.i) {
      // Proportionale Lage: Mündungen bei GLEICHEN Indizes -> direkt ersetzen.
      const newRoot = root.slice(0, aR.i + 1).concat(repR, root.slice(bR.i + 1));
      const newTip = tip.slice(0, aT.i + 1).concat(repT, tip.slice(bT.i + 1));
      if (newRoot.length !== newTip.length) return null;  // Sicherheits-Guard (Sync)
      return { root: newRoot, tip: newTip };
    }
    // NICHT proportionale Lage (Mündungen an Wurzel und Rand bei verschiedenen
    // Bahnindizes): ein gemeinsames Fenster [lo .. hi] um beide Taschen wird je
    // Rippe in drei Abschnitte geteilt — Fenster-Anfang→Mündung A, Tasche, Mündung
    // B→Fenster-Ende — und Abschnitt für Abschnitt auf GLEICHE Punktzahl neu
    // abgetastet. Außerhalb des Fensters bleiben die Bahnen unverändert (gemeinsame
    // Indizes), innerhalb liegt nur glatte Profiloberfläche (keine Ecken, die ein
    // Neuabtasten verschleifen könnte). Der Draht steht im Taschenbereich schräg;
    // die Zwischenrippen weichen dort ab (Warnung: pocketSkewInfo).
    const lo = Math.min(aR.i, aT.i), hi = Math.max(bR.i, bT.i) + 1;
    if (hi >= root.length || hi >= tip.length) return null;
    const sec = (path, from, to, first, last) => {
      // offener Abschnitt von Bahnpunkt `from` bis `to` (inkl.), optional mit
      // vorangestelltem/angehängtem Mündungspunkt.
      let out = path.slice(from, to + 1);
      if (first) out = [first].concat(out);
      if (last) out = out.concat([last]);
      return out;
    };
    // Abschnitt 1: lo .. Mündung A (Bahnpunkte lo..a.i, dann mA)
    const s1R = sec(root, lo, aR.i, null, mAr), s1T = sec(tip, lo, aT.i, null, mAt);
    // Abschnitt 3: Mündung B .. hi (mB, dann Bahnpunkte b.i+1..hi)
    const s3R = sec(root, bR.i + 1, hi, mBr, null), s3T = sec(tip, bT.i + 1, hi, mBt, null);
    const n1 = Math.max(2, s1R.length, s1T.length), n3 = Math.max(2, s3R.length, s3T.length);
    const r1 = resamplePolylineN(s1R, n1), t1 = resamplePolylineN(s1T, n1);
    const r3 = resamplePolylineN(s3R, n3), t3 = resamplePolylineN(s3T, n3);
    // Zusammensetzen: [0..lo-1] + s1 + Tasche (ohne die doppelten Mündungen) + s3 + [hi+1..]
    const mid = (rep) => rep.slice(1, -1);
    const newRoot = root.slice(0, lo).concat(r1, mid(repR), r3, root.slice(hi + 1));
    const newTip = tip.slice(0, lo).concat(t1, mid(repT), t3, tip.slice(hi + 1));
    if (newRoot.length !== newTip.length) return null;  // Sicherheits-Guard (Sync)
    return { root: newRoot, tip: newTip };
  }
  // Schräglage einer Tasche (nicht proportionale Lage): Sehnenanteil der Mündung an
  // Wurzel und Rand des Bereichs und geschätzte Abweichung der Zwischenrippe in mm
  // (Punkt der Zwischenrippe = Mischung aus Wurzel- und Randpunkt verschiedener
  // Sehnenanteile -> größte Verschiebung in Flugrichtung in der Bereichsmitte ≈
  // halbe Differenz der Nasenabstände). Null bei proportionaler Lage.
  function pocketSkewInfo(sp) {
    if (!isPocket(sp) || !App.wing || !App.wing.cuts) return null;
    const [a, b] = sparRange(sp);
    const rc = segRibChord(a, 'root') || 1, tc = segRibChord(b, 'tip') || 1;
    const dR = sparFromLE(sp, a, 'root'), dT = sparFromLE(sp, b, 'tip');
    const rf = dR / rc, tf = dT / tc;
    if (Math.abs(rf - tf) < 0.005) return null;
    // Abweichung in Flugrichtung an der Bereichsmitte: Mischung von Wurzel (rf) und
    // Rand (tf) gegenüber der exakt proportionalen Lage ((rf+tf)/2 der Mittel-Sehne).
    const cm = (rc + tc) / 2;
    const dev = Math.abs(rf - tf) * cm / 2;
    return { rootPct: rf * 100, tipPct: tf * 100, devMm: dev };
  }
  function resampleSeg(a, b, n) { const out = []; for (let i = 0; i < n; i++) { const t = i / (n - 1); out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); } return out; }
  // Geschlossene Kontur auf n Punkte längenproportional neu abtasten (Rückgabe offen, n Punkte).
  function resampleLoopN(loop, n) {
    const pts = loop.slice(); if (pts.length < 2) return pts;
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = cum[cum.length - 1] || 1, out = []; let seg = 0;
    for (let k = 0; k < n; k++) {
      const target = total * k / n;
      while (seg < pts.length - 2 && cum[seg + 1] < target) seg++;
      const l = (cum[seg + 1] - cum[seg]) || 1, f = (target - cum[seg]) / l;
      out.push({ x: pts[seg].x + f * (pts[seg + 1].x - pts[seg].x), y: pts[seg].y + f * (pts[seg + 1].y - pts[seg].y) });
    }
    return out;
  }
  // Wie resampleLoopN (bogenlängen-gleich), aber die ERKANNTEN Ecken (Richtungsknick
  // > 30°) werden als feste Anker gehalten. Zwischen zwei Ankern wird jeweils die
  // GLEICHE Punktzahl verteilt (index-basiert, nicht längenproportional). Für zwei
  // gleich aufgebaute Konturen (Holmtasche an Wurzel und Rand, gleiche Eckenzahl)
  // fällt damit Ecke k bei beiden auf denselben Ausgabe-Index -> die (auch
  // extrapolierten) Turmbahnen mischen Ecke auf Ecke und bekommen keine Überschwinger/
  // Selbstschnitte am Holm. Anker 0 ist loop[0] (der Anfahrpunkt). Rückgabe offen,
  // exakt n Punkte. Ohne erkennbare Ecken == resampleLoopN.
  // Geschlossene Schleife ohne Schließpunkt + erkannte Ecken (Index 0 = Anfahrpunkt
  // immer dabei). Ecke = Richtungswechsel 30–170°.
  function loopAnchors(loop) {
    let pts = loop.slice();
    if (pts.length > 1 && Math.abs(pts[0].x - pts[pts.length - 1].x) < 1e-9 && Math.abs(pts[0].y - pts[pts.length - 1].y) < 1e-9) pts = pts.slice(0, -1);
    const m = pts.length, anchors = [0];
    for (let i = 1; i < m; i++) {
      const a = pts[(i - 1 + m) % m], b = pts[i], c = pts[(i + 1) % m];
      const v1x = b.x - a.x, v1y = b.y - a.y, v2x = c.x - b.x, v2y = c.y - b.y;
      const l1 = Math.hypot(v1x, v1y) || 1, l2 = Math.hypot(v2x, v2y) || 1;
      const ang = Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)))) * 180 / Math.PI;
      if (ang > 30 && ang < 170) anchors.push(i);
    }
    return { pts, anchors };
  }
  // noAnchor=true: reine Bogenlängen-Abtastung (wenn Wurzel/Rand nach Abbrand-Offset
  // + Deloop UNTERSCHIEDLICH viele Ecken haben — z. B. dünner Gurt kollabiert nur an
  // einer Rippe — würden Ecken-Anker auf verschiedene Ecken fallen -> Sync kaputt).
  function cornerAnchoredResampleN(loop, n, noAnchor) {
    const la = loopAnchors(loop), pts = la.pts, anchors = la.anchors;
    const m = pts.length; if (m < 2) return pts.slice();
    const A = anchors.length;
    if (noAnchor || A < 2 || n <= A) return resampleLoopN(loop, n);   // keine Ecken -> reine Bogenlänge
    const per = Math.floor((n - A) / A);
    let rem = (n - A) - per * A;
    const out = [];
    for (let k = 0; k < A; k++) {
      const s = anchors[k], e = anchors[(k + 1) % A], seq = [];
      let idx = s; while (true) { seq.push(pts[idx]); if (idx === e) break; idx = (idx + 1) % m; }
      const cnt = per + (k < rem ? 1 : 0) + 2;   // Stützpunkte inkl. beider Ankerenden
      const cum = [0]; for (let i = 1; i < seq.length; i++) cum.push(cum[i - 1] + Math.hypot(seq[i].x - seq[i - 1].x, seq[i].y - seq[i - 1].y));
      const tot = cum[cum.length - 1] || 1;
      for (let q = 0; q < cnt - 1; q++) {   // ohne den Endanker (= nächster Startanker)
        const tg = tot * q / (cnt - 1); let g = 0; while (g < seq.length - 2 && cum[g + 1] < tg) g++;
        const l = (cum[g + 1] - cum[g]) || 1, fr = (tg - cum[g]) / l;
        out.push({ x: seq[g].x + fr * (seq[g + 1].x - seq[g].x), y: seq[g].y + fr * (seq[g + 1].y - seq[g].y) });
      }
    }
    return out;   // Länge === n
  }
  function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; } return a / 2; }
  // EXAKTES Parallel-Offset einer geschlossenen Kontur: d>0 nach INNEN (Tasche
  // behält Nennmaß), d<0 nach AUSSEN (Tasche wird größer), d=0 unverändert.
  // Jede Kante wird um d entlang ihrer (Innen-)Normalen versetzt; die neuen
  // Eckpunkte sind die SCHNITTPUNKTE benachbarter versetzter Kanten (echter
  // Gehrungsstoß). Damit stimmt der Abstand auch an rechtwinkligen und KONKAVEN
  // Ecken exakt — nötig für den Doppel-T-Holm (I-Träger). Nur bei (nahezu)
  // parallelen Nachbarkanten wird auf den gemittelten Normalen-Versatz
  // zurückgegriffen (dort ist der Gehrungsstoß nicht definiert).
  function offsetInward(poly, d) {
    if (!d) return poly.slice();
    const n = poly.length; if (n < 3) return poly.slice();
    const s = polyArea(poly) > 0 ? 1 : -1;
    const nrm = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: s * (-dy) / l, y: s * (dx) / l }; };
    // Versetzte Kanten (Stützpunkt + Richtung) je Kante i -> i+1.
    const E = [];
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n], no = nrm(a, b);
      E.push({ px: a.x + no.x * d, py: a.y + no.y * d, dx: b.x - a.x, dy: b.y - a.y });
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const e1 = E[(i - 1 + n) % n], e2 = E[i];   // Kanten VOR und NACH Eckpunkt i
      // Schnittpunkt der beiden versetzten (unendlichen) Geraden.
      const den = e1.dx * e2.dy - e1.dy * e2.dx;
      if (Math.abs(den) > 1e-9) {
        const t = ((e2.px - e1.px) * e2.dy - (e2.py - e1.py) * e2.dx) / den;
        out.push({ x: e1.px + t * e1.dx, y: e1.py + t * e1.dy });
      } else {
        // (nahezu) parallel: gemittelter Normalen-Versatz als Rückfall.
        const n1 = nrm(poly[(i - 1 + n) % n], poly[i]), n2 = nrm(poly[i], poly[(i + 1) % n]);
        let nx = n1.x + n2.x, ny = n1.y + n2.y; const l = Math.hypot(nx, ny) || 1;
        out.push({ x: poly[i].x + nx / l * d, y: poly[i].y + ny / l * d });
      }
    }
    return out;
  }
  // Schnittpunkt zweier Strecken a-b und c-d (echte Kreuzung im Inneren beider),
  // sonst null. Für das Entschleifen von Offset-Polygonen.
  function segCross(a, b, c, d) {
    const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
    const den = rx * sy - ry * sx; if (Math.abs(den) < 1e-12) return null;
    const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
    const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
    if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) return { x: a.x + t * rx, y: a.y + t * ry };
    return null;
  }
  // Ein Offset-Polygon von Abbrand-Artefakten befreien. Ist der Versatz größer als
  // ein lokales Feature (z. B. ein Gurtende, dessen Nachbarpunkt näher liegt als der
  // Versatz, oder eine einspringende Ecke), entstehen zwei Arten von Spitzen:
  //   (a) SCHLEIFEN – zwei versetzte Kanten kreuzen sich; die flächenkleinere
  //       Schleife wird am Kreuzungspunkt herausgeschnitten.
  //   (b) ÜBERSTÄNDE – ein Eckpunkt schießt über beide Nachbarn hinaus (projiziert
  //       AUSSERHALB der Nachbarstrecke), ohne dass sich Kanten kreuzen. Solch ein
  //       dünner Zacken wird entfernt (Punkt gelöscht, Nachbarn direkt verbunden).
  // Beide würden sonst als (Schein-)Ecke gezählt und die Synchronisation Wurzel/Rand
  // zerstören. Nach der Bereinigung ist die Drahtspur ein sauberer Parallel-Offset
  // der Kontur nach innen — für Trapez wie Doppel-T. `spikePerp` = max. Querabstand,
  // bis zu dem ein Überstand als (dünner) Zacken gilt (breitere Features bleiben).
  function deloopPoly(poly, spikePerp) {
    const perpMax = spikePerp != null ? spikePerp : 0.8;
    let P = poly.map(p => ({ x: p.x, y: p.y }));
    for (let pass = 0; pass < 400; pass++) {
      const n = P.length; if (n < 4) break;
      // (a) erste Kanten-Kreuzung suchen
      let hit = null;
      for (let i = 0; i < n && !hit; i++) {
        for (let j = i + 2; j < n; j++) {
          if (i === 0 && j === n - 1) continue;   // benachbart über den Umlauf
          const X = segCross(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n]);
          if (X) { hit = { i, j, X }; break; }
        }
      }
      if (hit) {
        const loopA = P.slice(hit.i + 1, hit.j + 1);
        const cand = P.slice(0, hit.i + 1).concat([hit.X], P.slice(hit.j + 1));
        P = Math.abs(polyArea(cand)) >= Math.abs(polyArea([hit.X].concat(loopA))) ? cand : [hit.X].concat(loopA);
        continue;
      }
      // (b) Überstand-Zacken suchen: Punkt projiziert außerhalb der Nachbarstrecke
      // und liegt dabei nah an ihr (dünn).
      let rm = -1;
      for (let i = 0; i < n; i++) {
        const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n];
        const ax = c.x - a.x, ay = c.y - a.y, L2 = ax * ax + ay * ay;
        if (L2 < 1e-12) { rm = i; break; }
        const t = ((b.x - a.x) * ax + (b.y - a.y) * ay) / L2;
        const perp = Math.hypot(b.x - (a.x + t * ax), b.y - (a.y + t * ay));
        if ((t < -0.02 || t > 1.02) && perp < perpMax) { rm = i; break; }
      }
      if (rm < 0) break;
      P.splice(rm, 1);
    }
    return P;
  }
  function lerpPt(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
  // Kreuzung der Senkrechten x=xc mit der (offenen) Bahn; targetY wählt die
  // richtige Seite (Ober-/Unterkante). Rückgabe { i, t } der getroffenen Kante.
  function crossOnPath(path, xc, targetY) {
    let best = null;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      if (xc < Math.min(a.x, b.x) || xc > Math.max(a.x, b.x) || Math.abs(b.x - a.x) < 1e-9) continue;
      const t = (xc - a.x) / (b.x - a.x), y = a.y + t * (b.y - a.y), d = Math.abs(y - targetY);
      if (!best || d < best.d) best = { i, t, d };
    }
    return best;
  }
  // Startet die Tasche an einem ERZEUGTEN Punkt genau unter der Anfahrt (x=xc,
  // Seite = targetY). Ist dort kein Eckpunkt, wird die Kante geteilt -> der
  // Anfahr-Schlitz trifft die Tasche senkrecht (keine Versatz-/Offset-Fehler).
  function holeEntryStart(hole, xc, targetY) {
    let bi = -1, by = 0, bd = Infinity;
    for (let i = 0; i < hole.length; i++) {
      const a = hole[i], b = hole[(i + 1) % hole.length];
      if (xc < Math.min(a.x, b.x) || xc > Math.max(a.x, b.x) || Math.abs(b.x - a.x) < 1e-9) continue;
      const t = (xc - a.x) / (b.x - a.x), y = a.y + t * (b.y - a.y), d = Math.abs(y - targetY);
      if (d < bd) { bd = d; bi = i; by = y; }
    }
    if (bi < 0) return null;
    const P = { x: xc, y: by }, rot = [P];
    for (let k = 1; k <= hole.length; k++) rot.push(hole[(bi + k) % hole.length]);
    rot.push({ x: P.x, y: P.y });            // Schleife schließen (…→ P)
    return rot;
  }
  // Startet die Tasche dort, wo die WAAGRECHTE y=yT ihren Umriss kreuzt — an der
  // Kreuzung, die xFrom am nächsten liegt (Kante wird geteilt). Null, wenn keine.
  function holeEntryStartY(hole, yT, xFrom) {
    let bi = -1, bx = 0, bd = Infinity;
    for (let i = 0; i < hole.length; i++) {
      const a = hole[i], b = hole[(i + 1) % hole.length];
      if (yT < Math.min(a.y, b.y) || yT > Math.max(a.y, b.y) || Math.abs(b.y - a.y) < 1e-9) continue;
      const t = (yT - a.y) / (b.y - a.y), x = a.x + t * (b.x - a.x), d = Math.abs(x - xFrom);
      if (d < bd) { bd = d; bi = i; bx = x; }
    }
    if (bi < 0) return null;
    const P = { x: bx, y: yT }, rot = [P];
    for (let k = 1; k <= hole.length; k++) rot.push(hole[(bi + k) % hole.length]);
    rot.push({ x: P.x, y: P.y });
    return rot;
  }
  // Startet die Tasche am Punkt ihres Umrisses, der dem Punkt P am NÄCHSTEN liegt
  // (Kante wird dort geteilt). Für die Anfahrt „durch den Kern" bei nicht
  // proportionaler Holmlage: vom Kern-Eckpunkt quer zur nächstliegenden Taschenwand.
  function holeEntryNearest(hole, P) {
    let bi = -1, bp = null, bd = Infinity;
    for (let i = 0; i < hole.length; i++) {
      const a = hole[i], b = hole[(i + 1) % hole.length];
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      const t = L2 > 1e-12 ? Math.max(0, Math.min(1, ((P.x - a.x) * dx + (P.y - a.y) * dy) / L2)) : 0;
      const q = { x: a.x + dx * t, y: a.y + dy * t }, d = Math.hypot(q.x - P.x, q.y - P.y);
      if (d < bd) { bd = d; bi = i; bp = q; }
    }
    if (bi < 0) return null;
    const rot = [bp];
    for (let k = 1; k <= hole.length; k++) rot.push(hole[(bi + k) % hole.length]);
    rot.push({ x: bp.x, y: bp.y });
    return rot;
  }
  // Abstecher-Pfad EINES Holms, beginnend/endend am Bahnpunkt `entry` (auf dem
  // Profil): [Anfahr-Schlitz → Tasche → Schlitz zurück]. Gleiche Punktzahl für
  // Wurzel und Rand (Synchronität).
  // viaCore=true (nicht proportionale Holmlage): Beide Rippen zweigen am GLEICHEN
  // Bahnindex ab, obwohl der Holm an Wurzel/Rand bei unterschiedlichem Sehnenanteil
  // liegt. Liegt die Tasche nicht senkrecht unter dem Abzweigpunkt, fährt der Draht
  // senkrecht in den Kern (bis auf Holm-Mittenhöhe), dann quer durch den Kern zur
  // nächstliegenden Taschenwand, umfährt die Tasche und verlässt den Kern auf
  // demselben Weg. Die Profilkontur bleibt dabei unverfälscht.
  // Abbrand-Offset einer Rippe so weit begrenzen, dass die Tasche nach Offset+Deloop
  // ihre ECKEN-ANZAHL behält (kein Gurt/Steg kollabiert). Sonst hätte z. B. bei
  // Doppel-T mit dünnem Außengurt der Rand weniger Ecken als die Wurzel -> Ecken-
  // Anker fielen auf verschiedene Ecken, die Turmbahnen wären verdreht. Der Gurt
  // wird dann leicht unterkompensiert (dünner als der Abbrand ist er ohnehin
  // nicht sauber schneidbar). Rückgabe: wirksamer Abbrand.
  function kerfKeepTopology(entry, holePoly, edgePt, kerf, surfPts, viaCore) {
    if (!kerf) return 0;
    const cnt = k => loopAnchors(holeLoopPrep(entry, holePoly, edgePt, k, surfPts, viaCore).loop).anchors.length;
    const want = cnt(0);
    if (cnt(kerf) === want) return kerf;
    let lo = 0, hi = kerf;   // lo: ok, hi: zu viel
    for (let i = 0; i < 10; i++) { const mid = (lo + hi) / 2; if (cnt(mid) === want) lo = mid; else hi = mid; }
    return lo;
  }
  function holeExcursion(entry, holePoly, edgePt, kerf, surfPts, viaCore, noAnchor) {
    const hp = holeLoopPrep(entry, holePoly, edgePt, kerf, surfPts, viaCore);
    return holeExcursionFinish(entry, hp.loop, hp.corner, viaCore, noAnchor);
  }
  // Teil 1: Abbrand-Offset, Klemmen, Deloop, Anfahrpunkt -> { loop, corner }.
  function holeLoopPrep(entry, holePoly, edgePt, kerf, surfPts, viaCore) {
    let hole = holePoly.map(p => ({ x: p.x, y: p.y }));
    if (kerf) hole = offsetInward(hole, kerf);   // kerf<0 (Abbrand außen) versetzt nach AUSSEN
    // (1) Kein Überstand über das Außenprofil: reicht ein Gurt an die Oberfläche,
    // liegen Ober-/Unterkante der Tasche auf der Kontur; ein Versatz nach außen
    // schöbe sie darüber hinaus. Solche Punkte wieder auf die Oberfläche klemmen.
    // IMMER klemmen (auch ohne Abbrand): ist die Tasche dicker als das Profil
    // (z. B. Rundholm 15 mm in einer dünnen Außenrippe), ragt der Umriss oben UND
    // unten heraus — ungeklemmt startete holeEntryStart am Umrisspunkt ÜBER der
    // Oberfläche (in der Luft) und die Rippe fuhr nach dem Einstich erst nach oben,
    // während die andere Rippe nach unten fuhr (Turmbahnen verdreht, Drahtsträhne
    // scheinbar „von unten"). Der Kerndesigner zeichnet bereits geklemmt.
    // Ausnahme: Scharnierausschnitt (holePoly.noClamp) soll BEWUSST über die
    // gegenüberliegende Profilseite hinausgehen -> nicht klemmen.
    if (surfPts && !holePoly.noClamp) hole = hole.map(p => { const s = surfaceAtX(surfPts, p.x); return s ? { x: p.x, y: Math.max(s.bot, Math.min(s.top, p.y)) } : p; });
    if (kerf) {
      // (2) SAUBERER Parallel-Offset: Selbstüberschneidungen (Spitzen-Schleifen an
      // Gurtenden/einspringenden Ecken, wenn der Versatz größer als ein lokales
      // Feature ist) herausschneiden. So bekommt die Drahtspur keine Zacken „nach
      // vorne/hinten" mehr — der Offset folgt sauber der Kontur nach innen.
      hole = deloopPoly(hole);
    }
    // Einstich in die Tasche EXAKT bei x = entry.x (senkrecht unter dem Profil-
    // punkt). Fehlt dort ein Taschen-Eckpunkt, teilt holeEntryStart die Kante ->
    // die Anfahrt ist immer vertikal (kein schräger Anfahr-Schlitz).
    let loop = holeEntryStart(hole, entry.x, edgePt.y);
    let corner = null;   // Kern-Eckpunkt der 2-teiligen Anfahrt (nur viaCore, wenn senkrecht nichts getroffen wird)
    if (!loop && viaCore) {
      const ys = hole.map(p => p.y);
      let yT = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;   // Holm-Mittenhöhe
      const s = surfPts ? surfaceAtX(surfPts, entry.x) : null;             // im lokalen Profil bleiben
      if (s) { const m = (s.top - s.bot) * 0.2; yT = Math.max(s.bot + m, Math.min(s.top - m, yT)); }
      corner = { x: entry.x, y: yT };
      // Anfahrpunkt = Taschen-Vorderwand auf HOLM-Mittenhöhe (unabhängig vom Klemmen
      // des Kern-Ecks -> auf beiden Rippen derselbe relative Holmpunkt; bei Doppel-T
      // die Steg-Vorderwand zwischen den Gurten). Erst wenn die Waagrechte nichts
      // trifft, zum nächstliegenden Umrisspunkt.
      const yMid = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
      loop = holeEntryStartY(hole, yMid, entry.x) || holeEntryNearest(hole, corner);
    }
    if (!loop) { const si = nearestIdx(hole, { x: entry.x, y: edgePt.y }); loop = hole.slice(si).concat(hole.slice(0, si), [hole[si]]); }
    return { loop, corner };
  }
  // Teil 2: Abtasten + Anfahr-/Abfahrweg anfügen.
  function holeExcursionFinish(entry, loop, corner, viaCore, noAnchor) {
    // Taschenschleife BOGENLÄNGEN-GLEICH vom gemeinsamen Anfahrpunkt aus auf feste
    // Punktzahl abtasten. Dadurch entsprechen sich Wurzel- und Rand-Punkt bei gleichem
    // Index (gleicher Bogenanteil) — auch wenn die entschleiften Taschen unterschiedlich
    // viele Ecken haben (andere Sehne/Pfeilung) —, und die gesweepten Turmbahnen laufen
    // ohne Knick. Bei 160 Punkten werden Ecken nur um Bruchteile eines mm gerundet
    // (unterhalb des Schnittspalts, für den Heißdraht ohnehin nicht scharf schneidbar).
    const holeR = cornerAnchoredResampleN(loop, SPAR_HOLE_N, noAnchor);
    const start = corner ? { x: holeR[0].x, y: holeR[0].y } : { x: entry.x, y: holeR[0].y };   // x erzwingen -> senkrechte Anfahrt
    if (viaCore) {
      // Anfahrt als Polylinie (entry → [Kern-Eck] → Taschenwand) mit FESTER Punktzahl
      // (2·SPAR_LEAD_N) je Richtung — unabhängig davon, ob eine Rippe senkrecht trifft
      // (kein Eck) oder quer durch den Kern fährt -> Wurzel/Rand bleiben synchron.
      // Das Kern-Eck ist dabei ein FESTER Ankerpunkt (gleicher Index bei Wurzel und
      // Rand, kein Abrunden); trifft eine Rippe senkrecht, dient die Schlitzmitte als
      // (geradliniger) Ersatz-Anker, damit die Punktzahl je Bein gleich bleibt.
      const c = corner || { x: (entry.x + start.x) / 2, y: (entry.y + start.y) / 2 };
      const li = resampleSeg(entry, c, SPAR_LEAD_N).slice(0, -1).concat(resampleSeg(c, start, SPAR_LEAD_N));
      const lo = li.slice().reverse();
      return li.slice(0, -1).concat(holeR, [{ x: start.x, y: start.y }], lo.slice(1));
    }
    // Anfahr-/Abfahr-Schlitz und Taschenschleife zusammensetzen. Der Endpunkt des
    // Anfahr-Schlitzes IST bereits holeR[0] (=start); der Startpunkt des Abfahr-
    // Schlitzes IST der Taschen-Schließpunkt (=start). Diese beiden Punkte NICHT
    // doppelt ablegen (.slice), sonst entstehen NULL-Längen-Segmente, die im G-Code
    // Geschwindigkeitsspitzen erzeugen. Punktzahl bleibt für Wurzel und Rand gleich
    // (deterministisch, 2 Punkte weniger) -> Turmbahnen bleiben synchron.
    return resampleSeg(entry, start, SPAR_LEAD_N).slice(0, -1)
      .concat(holeR, [{ x: start.x, y: start.y }], resampleSeg(start, entry, SPAR_LEAD_N).slice(1));
  }

  // ===== Holmausschnitte (Spars) =====================================
  // Ober-/Unterkante der Kontur an der Sehnen-Position x (mm). Scannt alle
  // Kanten, die die Senkrechte bei x schneiden, und liefert max/min y.
  function surfaceAtX(pts, x) {
    let top = -Infinity, bot = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
      if (x < lo || x > hi || Math.abs(b.x - a.x) < 1e-9) continue;
      const t = (x - a.x) / (b.x - a.x), y = a.y + t * (b.y - a.y);
      if (y > top) top = y; if (y < bot) bot = y;
    }
    return top === -Infinity ? null : { top, bot };
  }
  // Sehne (Profillänge) der Wurzel- bzw. Außenrippe eines Segments.
  function segRibChord(segIdx, which) {
    const seg = state.segments[segIdx]; if (!seg) return 1;
    if (which === 'tip') return seg.chord;
    return segIdx === 0 ? state.root.chord : state.segments[segIdx - 1].chord;
  }
  // Eigener Nasen-Abstand (mm) eines Holm-ENDES (Wurzel von segFrom / Außen von segTo).
  function sparOwnFromLE(sp, chord, which) {
    // Taschen: wie Loch-Holme (mm oder % je Ende). Nicht proportionale Lage wird in
    // carvePocketSide abschnittsweise neu abgetastet (Warnung im Kerndesign).
    const mode = which === 'tip' ? (sp.posModeTip || sp.posMode) : sp.posMode;
    const pos = which === 'tip' ? (sp.posTip != null ? sp.posTip : sp.pos) : sp.pos;
    return mode === 'mm' ? (pos || 0) : (pos || 0) / 100 * chord;
  }
  // Absolute Nase (min x) und z einer Station aus der globalen Geometrie.
  function stationLE(i) { const st = App.wing && App.wing.stations && App.wing.stations[i]; return st ? Math.min.apply(null, st.pts.map(p => p.x)) : 0; }
  function stationZ(i) { const st = App.wing && App.wing.stations && App.wing.stations[i]; return st ? st.z : 0; }
  // Segmentbereich eines Holms (geordnet, geklemmt auf gültige Segmentindizes).
  function sparRange(sp) {
    const n = state.segments.length - 1;
    let a = Math.max(0, Math.min(n, sp.segFrom | 0)), b = Math.max(0, Math.min(n, sp.segTo | 0));
    return a <= b ? [a, b] : [b, a];
  }
  function sparAppliesTo(sp, segIdx) { const r = sparRange(sp); return segIdx >= r[0] && segIdx <= r[1]; }
  // „Proportionaler" Holm: gleicher Nasenabstand-ANTEIL (%-Sehne) am Wurzel- UND
  // Rand-Ende. Nur dann darf der Holm „während des Schnitts" in den Profil-Schnittpfad
  // eingerechnet werden: Der Abstecher wird an Wurzel und Rand am GLEICHEN Bahnindex
  // eingefügt. Läge die Tasche an Wurzel und Rand bei unterschiedlichem Sehnenanteil
  // (nicht proportional), würde dieses synchrone Einfügen die Profilkontur dazwischen
  // verfälschen. „flightPar" (konstante absolute X) ist bei sich verjüngendem/
  // gepfeiltem Flügel automatisch nicht proportional und wird hier erfasst.
  function sparProportional(sp) {
    if (!App.wing || !App.wing.cuts) return true;   // ohne Geometrie nicht prüfbar
    const [a, b] = sparRange(sp);
    const rc = segRibChord(a, 'root') || 1, tc = segRibChord(b, 'tip') || 1;
    const rf = sparFromLE(sp, a, 'root') / rc;
    const tf = sparFromLE(sp, b, 'tip') / tc;
    return Math.abs(rf - tf) < 0.005;       // < 0,5 % der Sehne
  }
  // Gibt es (unter den zu schneidenden) Holmen mindestens einen nicht proportionalen?
  function anyNonProportionalSpar() { return (state.spars || []).some(sp => !sparProportional(sp)); }
  // Lokale Profildicke (mm) an der Holm-Position auf der Wurzelrippe seines
  // Bereichs — Bezug für die %↔mm-Umrechnung der Maße.
  function sparRefThick(sp) {
    if (!App.wing || !App.wing.cuts) return 0;
    const [a] = sparRange(sp), c = App.wing.cuts[Math.min(a, App.wing.cuts.length - 1)]; if (!c) return 0;
    const pts = c.root.pts, leX = Math.min.apply(null, pts.map(p => p.x));
    const s = surfaceAtX(sparCoreOf(pts, a, 'root') || pts, leX + sparFromLE(sp, a, 'root')); return s ? (s.top - s.bot) : 0;
  }
  // Maße beim Umschalten der Einheit umrechnen, damit der Holm gleich groß bleibt.
  // % = Anteil der lokalen Profildicke -> pct→mm: ·(thick/100), mm→pct: ·(100/thick).
  function sparConvertSizeUnits(sp, from, to) {
    if (from === to) return;
    const thick = sparRefThick(sp); if (!(thick > 0)) return;   // ohne Bezug: Werte lassen
    const fscale = from === 'pct' ? thick / 100 : 100 / thick;
    ['w', 'h', 'wTip', 'hTip', 'dtOtW', 'dtOtH', 'dtStW', 'dtStH', 'dtUbW', 'dtUbH']
      .forEach(k => {
        // Gurthöhen fest in mm (dtHmm): stehen unabhängig vom Größenmodus in mm.
        if (sp.dtHmm && (k === 'dtOtH' || k === 'dtUbH')) return;
        if (sp[k] != null) sp[k] = +(sp[k] * fscale).toFixed(2);
      });
  }
  // Doppel-T: Gurthöhen zwischen „% der Profilhöhe" und „fest in mm" umrechnen
  // (beim Umschalten von dtHmm, nur im %-Größenmodus relevant).
  function sparConvertFlangeH(sp, toMM) {
    const thick = sparRefThick(sp); if (!(thick > 0)) return;
    const f = toMM ? thick / 100 : 100 / thick;
    ['dtOtH', 'dtUbH'].forEach(k => { if (sp[k] != null) sp[k] = +(sp[k] * f).toFixed(2); });
  }
  // Wirksamer Abbrand (voller Spalt, mm) für den Holm-Offset nach INNEN. 0, wenn
  // kein Abbrand oder Versatz nach außen (dann werden die Gurte nur breiter).
  function sparKerfIn(sp) {
    const km = (sp && sp.kerfMode && sp.kerfMode !== 'global') ? sp.kerfMode : (state.cfg.sparKerfMode || 'none');
    if (!state.cfg.sparCut || km !== 'in') return 0;
    return App.currentKerf() || 0;
  }
  // Reserve über dem Abbrand, die ein Gurt mindestens dick sein muss: Nach dem
  // Abbrand-Offset bleibt so eine Drahtspur mit diesem Abstand (Hin- und Rückweg
  // liegen nicht exakt übereinander -> sauber fahrbar, kein Schleifen-Artefakt).
  const DT_BAND_RES = 0.3;
  // Zu dünne Gurte eines Doppel-T-Holms je Station melden (für die Sidebar-Warnung):
  // [{ station, key:'ot'|'ub', nom, min, kerf }] — nom = Nenn-Gurtdicke (dünnste
  // Stelle), min = erzwungene Mindestdicke (Abbrand + Reserve).
  function dtThinReport(sp) {
    const out = [];
    if (!sp || sp.shape !== 'doubleT' || !App.wing || !App.wing.stations) return out;
    const [a, b] = sparRange(sp);
    for (let k = a; k <= b + 1; k++) {
      const st = App.wing.stations[k]; if (!st) continue;
      const which = k === a ? 'root' : 'tip';
      const dLE = k === a ? sparFromLE(sp, a, 'root') : sparFromLE(sp, k - 1, 'tip');
      let g = null;
      const coreK = sparCoreOf(st.pts, k === a ? a : k - 1, which);
      try { g = sparOnProfile(sp, st.pts, coreK || st.pts, dLE, sparYc(sp), which, coreK); } catch (e) { g = null; }
      const rp = g && g.poly && g.poly.dtBands; if (!rp || !(rp.minBand > 0)) continue;
      ['ot', 'ub'].forEach(key => {
        if (rp[key] < rp.minBand - 1e-9) out.push({ station: k, key, nom: rp[key], min: rp.minBand, kerf: rp.kerf });
      });
    }
    return out;
  }
  // Nasen-Abstand (mm) an einer Rippe: gerade Linie zwischen Wurzel von segFrom
  // und Außen von segTo (Grundriss). segFrom==segTo -> Linie Wurzel↔Außen dieses
  // Segments (mit ggf. abweichender Außenlage).
  // Scharnier-%-Wert (von hinten) an einer Station: 0=Wurzel, k+1=Außen von Segm. k.
  function hingePctAtStation(i) {
    const segs = state.segments;
    const p = i === 0 ? (segs[0] && segs[0].hingePct) : (segs[i - 1] && segs[i - 1].hingePctTip);
    return p != null ? p : 25;
  }
  // Sehnenlänge einer Station (Panel-mm).
  function stationChord(i) {
    const st = App.wing && App.wing.stations && App.wing.stations[i];
    if (!st) return 1;
    const xs = st.pts.map(p => p.x);
    return (Math.max.apply(null, xs) - Math.min.apply(null, xs)) || 1;
  }
  // Abstand Nasenleiste → Scharnierlinie an einer Station (Panel-mm).
  function hingeFromLE(i) {
    return stationChord(i) * (1 - Math.max(0, Math.min(100, hingePctAtStation(i))) / 100);
  }
  function sparFromLE(sp, segIdx, which) {
    // Entlang der Scharnierlinie: parallel zur Scharnierlinie, um hingeOffset davor.
    // Scharnierausschnitt (shape 'hinge') sitzt IMMER auf der Scharnierlinie.
    if ((sp.hingeAlign && !isPocket(sp)) || sp.shape === 'hinge') {
      const stIdx = which === 'tip' ? segIdx + 1 : segIdx;
      const off = sp.shape === 'hinge' ? 0 : (sp.hingeOffset || 0);
      return Math.max(0, hingeFromLE(stIdx) - off);
    }
    const [a, b] = sparRange(sp);
    const rootSt = a, tipSt = b + 1;
    const x0 = stationLE(rootSt) + sparOwnFromLE(sp, segRibChord(a, 'root'), 'root');
    const stIdx = which === 'tip' ? segIdx + 1 : segIdx;
    // Parallel zur Flugrichtung: absolute X konstant (= Wurzel-Ende) -> gerader,
    // nicht gepfeilter Holm. Sonst gerade Linie Wurzel↔Außen im Grundriss.
    if (sp.flightPar) return x0 - stationLE(stIdx);
    const xN = stationLE(tipSt) + sparOwnFromLE(sp, segRibChord(b, 'tip'), 'tip');
    const z0 = stationZ(rootSt), zN = stationZ(tipSt);
    const t = (stationZ(stIdx) - z0) / ((zN - z0) || 1);
    return (x0 + (xN - x0) * t) - stationLE(stIdx);
  }
  // Konstante Höhe (absolutes Y) eines waagrechten Holms — aus der Wurzelrippe
  // seines Bereichs. Null, wenn nicht „horizontal".
  function sparYc(sp) {
    if (!sp.horiz || !App.wing || !App.wing.cuts) return null;
    const [a] = sparRange(sp), c = App.wing.cuts[Math.min(a, App.wing.cuts.length - 1)]; if (!c) return null;
    const pts = c.root.pts, leX = Math.min.apply(null, pts.map(p => p.x));
    const s = surfaceAtX(sparCoreOf(pts, a, 'root') || pts, leX + sparFromLE(sp, a, 'root')); if (!s) return null;
    return (s.top + s.bot) / 2 + (sp.yOff || 0);
  }
  // Geometrie EINES Holms auf einer konkreten Rippe (pts in Panel-mm).
  // Rückgabe: { poly:[…], lead:[a,b], xc, yc, ok } oder null.
  //  surfPts (optional) = Kontur, auf die sich die Anfahrt bezieht (z. B. Kern).
  //  fromLE (optional) = Abstand ab Nasenleiste in mm; sonst aus sp.pos berechnet.
  // Maß (Breite/Höhe) eines Holms je Rippe: außen optional abweichend (sp.sizeTip).
  function sparYOff(sp, which) {
    if (which === 'tip' && sp.yOffSep) return sp.yOffTip || 0;
    return sp.yOff || 0;
  }
  function sparSize(sp, which) {
    if (which === 'tip' && sp.sizeTip) return { w: sp.wTip != null ? sp.wTip : sp.w, h: sp.hTip != null ? sp.hTip : sp.h };
    return { w: sp.w, h: sp.h };
  }
  // Alle Taschen-Umrisse eines Holms auf einer Rippe (Tasche „oben + unten" hat
  // ZWEI: poly + poly2). Für Ansichten/Exporte, die jede Tasche einzeln brauchen.
  function sparPolys(g) { return g ? [g.poly, g.poly2].filter(pl => pl && pl.length > 2) : []; }
  // Kernkontur (Profil nach Beplankungsabzug) einer Rippe eines Segments — gleiche
  // Rechnung wie in HotWire.project (rootCore/tipCore). Null ohne Beplankung.
  // Für Holmausschnitte gilt: HÖHE/Dicke/Klemmung/Anfahrt beziehen sich auf den
  // Kern, nur der Nasen-Abstand (x) auf das Originalprofil.
  function sparCoreOf(pts, segIdx, which) {
    if (!pts || pts.length < 3 || !App.sheetFor || !state.segments.length) return null;
    const seg = state.segments[Math.max(0, Math.min(segIdx | 0, state.segments.length - 1))]; if (!seg) return null;
    const sf = App.sheetFor(seg)[which === 'tip' ? 'tip' : 'root'];
    return sparCoreFromSheet(pts, sf);
  }
  // Kernkontur aus fertigen Beplankungswerten { top, bot } (z. B. interpolierte
  // Rippen-Stationen). Null ohne Beplankung.
  function sparCoreFromSheet(pts, sh) {
    if (!sh || (!(sh.top > 0) && !(sh.bot > 0)) || !pts || pts.length < 3) return null;
    try {
      const c = Airfoil.resample(HotWire.trimTE(HotWire.offsetPathTB(pts, sh.top || 0, sh.bot || 0)), pts.length);
      return c && c.length > 2 ? c : null;
    } catch (e) { return null; }
  }
  //  core (optional) = Kernkontur nach Beplankungsabzug: x-Lage (Nasenabstand) wird
  //  am ORIGINALPROFIL pts bestimmt, Höhe/Dicke/Klemmung/Anfahrt aber am Kern.
  function sparOnProfile(sp, pts, surfPts, fromLE, ycOverride, which, core) {
    const xs = pts.map(p => p.x), leX = Math.min.apply(null, xs), teX = Math.max.apply(null, xs);
    const chord = (teX - leX) || 1;
    const dLE = fromLE != null ? fromLE : (sp.posMode === 'mm' ? (sp.pos || 0) : (sp.pos || 0) / 100 * chord);
    const xc = leX + dLE;
    // Ab hier Kern statt Originalprofil (Taschen bleiben am Profil: dort wird die
    // Oberfläche selbst ersetzt, Tiefe ist ab Oberfläche gemessen).
    if (core && core.length > 2 && !isPocket(sp)) { pts = core; if (!surfPts) surfPts = core; }
    const surf = surfaceAtX(pts, xc); if (!surf) return null;
    // Tasche (Gurt ohne Steg): Vorschau-Umriss(e). Der eigentliche Schnitt wird in
    // applySparCuts in die Profilbahn eingerechnet (kein Anfahr-Schlitz).
    if (isPocket(sp)) {
      const sides = (sp.pkSide === 'top' || sp.pkSide === 'bottom') ? [sp.pkSide] : ['top', 'bottom'];
      const g1 = pocketGeom(pts, sp, null, which, fromLE, sides[0]); if (!g1) return null;
      const g2 = sides.length > 1 ? pocketGeom(pts, sp, null, which, fromLE, sides[1]) : null;
      const p1 = pocketOutline(pts, g1, sides[0], sp.pkFlat);
      const p2 = g2 ? pocketOutline(pts, g2, sides[1], sp.pkFlat) : null;
      if (!p1) return null;
      return { poly: p1, poly2: p2, lead: null, xc: g1.xc, yc: (surf.top + surf.bot) / 2 };
    }
    const thick = surf.top - surf.bot;
    const u = sp.sizeMode === 'mm' ? 1 : thick / 100;          // %-Größe = Anteil der lokalen Profilhöhe
    // Doppel-T: sechs Rechteck-Maße (je über u skaliert). W/H = umschließende
    // Breite/Höhe (für Anfahrt/Lead-Berechnung).
    let dt = null;
    if (sp.shape === 'doubleT') {
      const dd = (v, def, uu) => Math.max(0.01, (v != null ? v : def) * (uu != null ? uu : u));
      // Gurthöhen fest in mm (dtHmm) -> nicht mit der Profilhöhe skalieren.
      const uH = (sp.sizeMode !== 'mm' && sp.dtHmm) ? 1 : u;
      dt = {
        otW: dd(sp.dtOtW, 60), otH: dd(sp.dtOtH, 12, uH),
        stW: dd(sp.dtStW, 14), stH: dd(sp.dtStH, 40),
        ubW: dd(sp.dtUbW, 60), ubH: dd(sp.dtUbH, 12, uH)
      };
      // Steg füllt auf 100 % der lokalen Profildicke (Ober-/Untergurt ergänzt).
      if (sp.dtFill) { dt.stH = Math.max(0.01, thick - dt.otH - dt.ubH); dt.fill = true; }
      // Innere waagrechte Gurtkanten als Offset der Profilkontur (statt gerade).
      if (sp.dtContourInner) dt.contourInner = true;
      // Mindest-Gurtdicke (Außenkante→Innenkante) in ALLEN Modi, damit die beiden
      // waagrechten Schnittspuren eines Gurts den Abbrand-Offset überstehen und
      // nicht zusammenfallen/kreuzen (deloop würde den Gurt sonst wegschneiden).
      // Ein zu dünner Gurt wird auf Abbrand + DT_BAND_RES verdickt; die Richtung
      // (Innenkante zum Steg / Außenkante in die Schale) wählt dtThinDir. Bei
      // knapp Abbrand-dickem Gurt wird die Tasche so praktisch zum Schlitz: Draht
      // hin und (0,3 mm versetzt) zurück. Kein Abbrand nach innen -> 0 (keine Wirkung).
      dt.kerf = sparKerfIn(sp);
      dt.minBand = dt.kerf > 0 ? dt.kerf + DT_BAND_RES : 0;
      dt.thinDir = sp.dtThinDir === 'out' ? 'out' : 'in';
    }
    const sz = sparSize(sp, which);
    let W = Math.max(0.01, (sz.w || 0) * u), H = Math.max(0.01, (sz.h || 0) * u);
    if (sp.shape === 'circle') { W = H; }
    if (dt) { W = Math.max(dt.otW, dt.stW, dt.ubW); H = dt.otH + dt.stH + dt.ubH; }
    // Höhe: waagrechter Holm hält konstantes Y (ycOverride), sonst Skelettmitte + Versatz.
    const yc = ycOverride != null ? ycOverride : (surf.top + surf.bot) / 2 + sparYOff(sp, which);
    // Trapez/Doppel-T: Ober-/Unterkante werden an den Profilverlauf geklemmt. Wo der
    // Holm (durch Größe oder Höhenversatz) über die Oberfläche hinausragt, folgt
    // die Kontur dem Profil; sonst bleiben die geraden Kanten erhalten.
    const useAng = sp.shape === 'trapez' && sp.cutAngles;
    const angF = (sp.angFront || 0) * Math.PI / 180, angR = (sp.angRear || 0) * Math.PI / 180;
    const baseRef = sp.shape === 'trapez' ? (sp.baseRef || 'center') : 'center';
    // Scharnierausschnitt: Scharnier-Profilseite aus dem Wurzelsegment des Bereichs.
    const hingeSideR = sp.shape === 'hinge'
      ? ((state.segments[sparRange(sp)[0]] && state.segments[sparRange(sp)[0]].hingeSide) || 'top')
      : null;
    let poly;
    if (sp.shape === 'hinge') {
      poly = hingeNotchPoly(surf, xc, hingeSideR, angF, angR, sp.hingeOver || 0, sp.hingeReach || 0, sp.hingeForm || 'v', sp.hingeTipW || 0);
      // Der Schnittpfad soll über die gegenüberliegende Profilseite hinausgehen
      // dürfen -> in holeExcursion NICHT auf die Oberfläche klemmen.
      if (poly) poly.noClamp = true;
    } else if (dt) {
      poly = doubleTClampedPoly(pts, xc, yc, dt);
    } else if (sp.shape === 'trapez' && baseRef !== 'center') {
      // Basis klebt an Ober-/Unterseite; Fernkanten-x aus Schnittwinkeln oder taper.
      let farL, farR;
      if (useAng) { farL = xc - W / 2 + H * Math.tan(angF); farR = xc + W / 2 - H * Math.tan(angR); }
      else { const tw = W * (sp.taper != null ? sp.taper : 0.6); farL = xc - tw / 2; farR = xc + tw / 2; }
      poly = trapezBaseRefPoly(pts, xc, W, H, baseRef, sparYOff(sp, which), farL, farR);
    } else if (useAng) {
      poly = wedgeClampedPoly(pts, xc, yc, W, H, angF, angR, false);
    } else if (sp.shape === 'trapez') {
      poly = trapezClampedPoly(pts, xc, yc, W, H, W * (sp.taper != null ? sp.taper : 0.6));
    } else {
      poly = sparPoly(sp.shape, xc, yc, W, H, sp.taper);
    }
    if (!poly) return null;
    // Anfahrt: senkrecht bei x=xc von der Oberfläche zur Taschenkante. lead[0] =
    // Punkt AUF der Tasche (an x=xc, an die Kontur geklemmt), lead[1] = Oberfläche.
    // Immer gesetzt (auch bei Berührung -> Länge 0), damit stets ein Schnitt entsteht.
    const surfC = surfPts ? surfaceAtX(surfPts, xc) : surf;
    let lead = null;
    if (surfC) {
      // Ober-/Unterkante der Tasche aus dem tatsächlichen Polygon (robust auch für
      // gedrehte V-Formen), an die Oberfläche geklemmt.
      let pTop = -Infinity, pBot = Infinity;
      for (let i = 0; i < poly.length; i++) { if (poly[i].y > pTop) pTop = poly[i].y; if (poly[i].y < pBot) pBot = poly[i].y; }
      const topEdge = Math.min(pTop, surfC.top), botEdge = Math.max(pBot, surfC.bot);
      const topGap = surfC.top - topEdge, botGap = botEdge - surfC.bot;
      let dir = sp.approach || 'shortest';
      // Scharnierausschnitt: Anfahrt IMMER von der dem Scharnier gegenüberliegenden Seite.
      if (sp.shape === 'hinge') dir = hingeSideR === 'top' ? 'bottom' : 'top';
      if (dir === 'shortest') dir = topGap <= botGap ? 'top' : 'bottom';
      lead = dir === 'top'
        ? [{ x: xc, y: topEdge }, { x: xc, y: surfC.top }]
        : [{ x: xc, y: botEdge }, { x: xc, y: surfC.bot }];
    }
    return { poly, lead, xc, yc };
  }
  // Polygon einer Holmform, zentriert bei (xc,yc), Breite W, Höhe H.
  function sparPoly(shape, xc, yc, W, H, taper) {
    const out = [];
    if (shape === 'oval' || shape === 'circle') {
      const N = 40;
      for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; out.push({ x: xc + W / 2 * Math.cos(a), y: yc + H / 2 * Math.sin(a) }); }
    } else if (shape === 'trapez') {
      const tw = W * (taper != null ? taper : 0.6);   // Oberkante schmaler
      out.push({ x: xc - W / 2, y: yc - H / 2 }, { x: xc + W / 2, y: yc - H / 2 },
               { x: xc + tw / 2, y: yc + H / 2 }, { x: xc - tw / 2, y: yc + H / 2 });
    } else {   // Fallback: Rechteck
      out.push({ x: xc - W / 2, y: yc - H / 2 }, { x: xc + W / 2, y: yc - H / 2 },
               { x: xc + W / 2, y: yc + H / 2 }, { x: xc - W / 2, y: yc + H / 2 });
    }
    out.closed = true;
    return out;
  }
  // Scharnierausschnitt: dreieckiger V-Kerbschnitt. Die Spitze zeigt zur Scharnier-
  // Profilseite (hSide 'top'/'bottom'); der Schnitt öffnet sich zur gegenüber-
  // liegenden Seite, von der auch angefahren wird. angF/angR = Öffnungswinkel der
  // vorderen (NL) bzw. hinteren (EL) Wand ab der Senkrechten durch die Spitze
  // (Bogenmaß). over = mm über die gegenüberliegende (Anfahr-)Profilseite hinaus
  // (Basis). reach = Lage der Spitze relativ zur Scharnierlinie (mm; + über die
  // Scharnierseite hinaus, − davor) -> wie weit die Schnittspur Richtung Scharnier geht.
  function hingeNotchPoly(surf, xc, hSide, angF, angR, over, reach, form, tipW) {
    if (!surf) return null;
    const tF = Math.tan(Math.max(0, angF)), tR = Math.tan(Math.max(0, angR));
    const rr = reach || 0, ov = over || 0;
    // Trapez: kurze Seite (Breite tipW) auf der Scharnierlinie, sonst Dreieck (Spitze).
    const hw = (form === 'trapez') ? Math.max(0, (tipW || 0)) / 2 : 0;
    let out;
    if (hSide === 'bottom') {
      // Scharnier unten -> kurze Seite/Spitze unten (+ = weiter nach unten/hinaus), Basis oben.
      const apexY = surf.bot - rr, baseY = surf.top + ov, D = Math.max(0.01, baseY - apexY);
      if (hw > 0)
        // Umlauf: kurze Seite rechts → Basis rechts → Basis links → kurze Seite links.
        out = [{ x: xc + hw, y: apexY }, { x: xc + hw + D * tR, y: baseY },
               { x: xc - hw - D * tF, y: baseY }, { x: xc - hw, y: apexY }];
      else
        // Umlauf: Spitze (unten) → Basis rechts → Basis links (Oberkante R→L).
        out = [{ x: xc, y: apexY }, { x: xc + D * tR, y: baseY }, { x: xc - D * tF, y: baseY }];
    } else {
      // Scharnier oben -> kurze Seite/Spitze oben (+ = weiter nach oben/hinaus), Basis unten.
      const apexY = surf.top + rr, baseY = surf.bot - ov, D = Math.max(0.01, apexY - baseY);
      if (hw > 0)
        // Umlauf: Basis links → Basis rechts → kurze Seite rechts → kurze Seite links.
        out = [{ x: xc - hw - D * tF, y: baseY }, { x: xc + hw + D * tR, y: baseY },
               { x: xc + hw, y: apexY }, { x: xc - hw, y: apexY }];
      else
        // Umlauf: Basis links → Basis rechts (Unterkante L→R) → Spitze (oben).
        out = [{ x: xc - D * tF, y: baseY }, { x: xc + D * tR, y: baseY }, { x: xc, y: apexY }];
    }
    out.closed = true;
    return out;
  }
  // Trapez: standardmäßig ein echtes Trapez mit 4 Eckpunkten. NUR wenn die Ober-
  // und/oder Unterkante über das Profil hinausragt, folgt DIESE Seite dem
  // Profilverlauf (die andere Seite/die Schrägen bleiben gerade).
  // W = Breite unten, tw = Breite oben.
  function trapezClampedPoly(pts, xc, yc, W, H, tw) {
    const yTop = yc + H / 2, yBot = yc - H / 2, half = W / 2, thalf = Math.min(Math.max(tw, 0) / 2, half);
    const N = 24;
    // Klemmung nötig? (Ober-/Unterkante ragt irgendwo über die Kontur hinaus)
    let topClamp = false, botClamp = false;
    for (let i = 0; i <= N; i++) { const s = surfaceAtX(pts, xc - thalf + 2 * thalf * i / N); if (s && s.top < yTop - 1e-6) { topClamp = true; break; } }
    for (let i = 0; i <= N; i++) { const s = surfaceAtX(pts, xc - half + W * i / N); if (s && s.bot > yBot + 1e-6) { botClamp = true; break; } }
    // Unterkante links→rechts.
    const bot = [];
    if (botClamp) { for (let i = 0; i <= N; i++) { const x = xc - half + W * i / N, s = surfaceAtX(pts, x); bot.push({ x, y: s ? Math.max(yBot, s.bot) : yBot }); } }
    else { bot.push({ x: xc - half, y: yBot }, { x: xc + half, y: yBot }); }
    // Oberkante rechts→links.
    const top = [];
    if (topClamp) { for (let i = 0; i <= N; i++) { const x = xc + thalf - 2 * thalf * i / N, s = surfaceAtX(pts, x); top.push({ x, y: s ? Math.min(yTop, s.top) : yTop }); } }
    else { top.push({ x: xc + thalf, y: yTop }, { x: xc - thalf, y: yTop }); }
    const out = bot.concat(top); out.closed = true; return out;
  }
  // Trapez mit an Ober-/Unterseite klebender Basis. ref='bottom': Basis folgt der
  // Profilunterseite (breite Seite), die flache Oberkante liegt H darüber; ref='top'
  // spiegelbildlich. yOff verschiebt die Basis von der Kontur weg. farL/farR = x der
  // Fernkante (aus taper oder Schnittwinkeln). Die flache Fernkante wird an die
  // gegenüberliegende Profilseite geklemmt, wo sie darüber hinausragt.
  function trapezBaseRefPoly(pts, xc, W, H, ref, yOff, farL, farR) {
    const half = W / 2, N = 24, off = yOff || 0;
    const sc = surfaceAtX(pts, xc);
    const anchor = ref === 'top' ? (sc ? sc.top : 0) : (sc ? sc.bot : 0);
    // Kreuzen sich die Wände (Fernkante invertiert) -> Spitze in der Mitte.
    if (farL > farR) { const m = (farL + farR) / 2; farL = m; farR = m; }
    // Basiskante entlang der Profilkontur (L→R).
    const base = [];
    for (let i = 0; i <= N; i++) {
      const x = xc - half + W * i / N, s = surfaceAtX(pts, x);
      const y = (ref === 'top' ? (s ? s.top : anchor) : (s ? s.bot : anchor)) + off;
      base.push({ x, y });
    }
    const yFar = ref === 'top' ? anchor + off - H : anchor + off + H;
    const farIsTop = ref === 'bottom';   // bei Basis unten ist die Fernkante oben
    // Fernkante flach, an die gegenüberliegende Profilseite geklemmt.
    const far = clampEdge(pts, farR, farL, yFar, farIsTop, N);  // R→L
    let out;
    if (ref === 'bottom') {
      out = base.concat(far);                       // Unterkante L→R + Oberkante R→L
    } else {
      const bottom = clampEdge(pts, farL, farR, yFar, false, N);  // flache Unterkante L→R
      const topR2L = base.slice().reverse();                      // Oberkante (Basis) R→L
      out = bottom.concat(topR2L);
    }
    out.closed = true; return out;
  }
  // Waagrechte Kante von x0 nach x1 auf Höhe y, an den Profilverlauf geklemmt.
  // isTop=true: Oberkante (nach unten auf s.top klemmen, wo sie darüber ragt);
  // isTop=false: Unterkante (nach oben auf s.bot klemmen, wo sie darunter ragt).
  function clampEdge(pts, x0, x1, y, isTop, N) {
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    let clamp = false;
    for (let i = 0; i <= N; i++) { const s = surfaceAtX(pts, lo + (hi - lo) * i / N); if (s && (isTop ? s.top < y - 1e-6 : s.bot > y + 1e-6)) { clamp = true; break; } }
    const arr = [];
    if (clamp) { for (let i = 0; i <= N; i++) { const x = x0 + (x1 - x0) * i / N, s = surfaceAtX(pts, x); arr.push({ x, y: s ? (isTop ? Math.min(y, s.top) : Math.max(y, s.bot)) : y }); } }
    else { arr.push({ x: x0, y }, { x: x1, y }); }
    return arr;
  }
  // Keil-/Trapezform mit getrennt einstellbaren Wandwinkeln, zentriert bei (xc,yc),
  // Basisbreite W (breite Seite), Höhe H. angF/angR = Winkel der vorderen (links,
  // NL-Seite) bzw. hinteren (rechts, EL-Seite) Wand ab der Senkrechten (Bogenmaß;
  // positiv = Wand neigt sich nach innen). narrowDown=false (Trapez): Basis unten,
  // verjüngt nach oben. narrowDown=true (V): Basis oben, verjüngt nach unten.
  // Treffen sich beide Wände innerhalb H, entsteht ein Dreieck. Basis- und Fern-
  // kante werden wie beim Trapez an den Profilverlauf geklemmt.
  function wedgeClampedPoly(pts, xc, yc, W, H, angF, angR, narrowDown) {
    const yTop = yc + H / 2, yBot = yc - H / 2, half = W / 2, N = 24;
    const tF = Math.tan(angF), tR = Math.tan(angR), sum = tF + tR;
    const xBL = xc - half, xBR = xc + half;       // breite (Basis-)Kante
    const xFarL = xBL + H * tF, xFarR = xBR - H * tR;  // schmale (Fern-)Kante
    // Treffen sich beide Wände innerhalb der Höhe -> Dreieck (Spitze).
    const apexT = sum > 1e-9 ? W / (H * sum) : Infinity;
    const apex = apexT < 1
      ? { x: xBL + H * apexT * tF, y: (narrowDown ? yTop : yBot) + (narrowDown ? -1 : 1) * H * apexT }
      : null;
    // Unter- und Oberkante je als L→R-Polylinie (an die Kontur geklemmt).
    let bottom, top;
    if (!narrowDown) {                 // Basis unten (breit), verjüngt nach oben
      bottom = clampEdge(pts, xBL, xBR, yBot, false, N);
      top = apex ? [apex] : clampEdge(pts, xFarL, xFarR, yTop, true, N);
    } else {                           // Basis oben (breit), verjüngt nach unten (V)
      top = clampEdge(pts, xBL, xBR, yTop, true, N);
      bottom = apex ? [apex] : clampEdge(pts, xFarL, xFarR, yBot, false, N);
    }
    // Umlauf wie beim Trapez: Unterkante L→R, dann Oberkante R→L.
    const out = bottom.slice();
    for (let i = top.length - 1; i >= 0; i--) out.push(top[i]);
    out.closed = true; return out;
  }
  // Doppel-T (I-Träger): Untergurt (unten) + Steg (Mitte, stehend) + Obergurt
  // (oben), zentriert bei (xc,yc). dt = { otW,otH, stW,stH, ubW,ubH, fill?,
  // contourInner?, minBand? } (bereits skaliert).
  // Alle drei Betriebsarten laufen über EINE Kanten-Funktion edgeY(x), die je
  // x-Position die vier waagrechten Kanten-y liefert:
  //   ob  = Untergurt unten (außen)      ib = Untergurt oben (innen, zum Steg)
  //   it  = Obergurt unten (innen)       ot = Obergurt oben (außen)
  //  - klassisch: Innenkanten gerade; Außenkanten an die Profilkontur geklemmt,
  //    wo der Holm (Größe/Höhenversatz) darüber hinausragt.
  //  - Füll-Modus (Steg auf 100 %): Außenkanten liegen über die GANZE Gurtbreite
  //    bündig auf der Haut (kein Übergang flach↔Kontur, der eine Zacke erzeugte).
  //  - Innenkanten als Kontur-Offset: Innenkanten laufen um ubH/otH nach innen
  //    versetzt der Haut nach -> Gurt hat über seine Breite konstante Dicke. Wird
  //    das Profil dünner als beide Gurte, treffen sich die Innenkanten in der Mitte
  //    (Steg 0); jeder Gurt behält mind. minBand Dicke, indem seine AUSSENkante
  //    über die Kontur hinauswandert (noClamp -> Schnitt geht bewusst in die Schale).
  // Steg breiter als ein Gurt ist zulässig: der Umlauf bleibt schnittfrei (der
  // Steg steht dann seitlich über den Gurt hinaus, kreuzförmig).
  // Der Umlauf wird mit fester Punktzahl je Kante abgetastet; kollineare Zwischen-
  // punkte (gerade Kanten) und Nullstrecken (z. B. kollabierter Steg) werden am
  // Ende entfernt, damit der Abbrand-Offset nur echte Ecken sieht.
  function doubleTClampedPoly(pts, xc, yc, dt) {
    const H = dt.otH + dt.stH + dt.ubH, yBot = yc - H / 2;
    const y0 = yBot, y1 = yBot + dt.ubH, y2 = y1 + dt.stH, y3 = y2 + dt.otH;
    const ub = dt.ubW / 2, st = dt.stW / 2, ot = dt.otW / 2, N = 32;
    const mb = dt.minBand || 0, outward = dt.thinDir === 'out';
    let beyond = false;   // ragt eine Außenkante über die Profilkontur hinaus?
    // Dünnste NENN-Gurtdicke je Gurt (vor der Verdickung) — für die Sidebar-Warnung.
    const rp = { ot: Infinity, ub: Infinity };
    // key = welche Kante gerade abgetastet wird ('ob'/'ib' = Untergurt, 'it'/'ot' =
    // Obergurt). Verdickung/Meldung nur für den Gurt, zu dem die Kante gehört (der
    // andere Gurt kann an diesem x schmaler sein und dort gar nicht existieren).
    const edgeY = (x, key) => {
      const s = surfaceAtX(pts, x);
      const sb = s ? s.bot : y0, stp = s ? s.top : y3;
      let ob, ib, it, ot_;
      if (dt.contourInner) {
        ib = sb + dt.ubH; it = stp - dt.otH;
        if (it < ib) { const mid = (sb + stp) / 2; ib = mid; it = mid; }
        ob = sb; ot_ = stp;
      } else if (dt.fill) { ob = sb; ib = y1; it = y2; ot_ = stp; }
      else { ob = Math.max(y0, sb); ib = y1; it = y2; ot_ = Math.min(y3, stp); }
      const lower = key === 'ob' || key === 'ib';
      if (lower) rp.ub = Math.min(rp.ub, ib - ob); else rp.ot = Math.min(rp.ot, ot_ - it);
      if (mb > 0) {
        // Mindestdicke erzwingen: 'in' = Innenkante zum Steg, 'out' = Außenkante über
        // die Kontur hinaus. Treffen sich dabei die Innenkanten (Profil dünner als
        // beide Mindestdicken), bleibt nur noch der Weg nach außen.
        if (lower && ib - ob < mb) { if (outward) ob = ib - mb; else ib = ob + mb; }
        if (!lower && ot_ - it < mb) { if (outward) ot_ = it + mb; else it = ot_ - mb; }
        if (it < ib - 1e-9) {
          const mid = (ib + it) / 2; ib = mid; it = mid;
          ob = Math.min(ob, ib - mb); ot_ = Math.max(ot_, it + mb);
        }
        if ((lower && ob < sb - 1e-6) || (!lower && ot_ > stp + 1e-6)) beyond = true;
      }
      return { ob, ib, it, ot: ot_ };
    };
    const out = [];
    const edge = (x0, x1, key) => {
      for (let i = 0; i <= N; i++) { const x = x0 + (x1 - x0) * i / N; out.push({ x, y: edgeY(x, key)[key] }); }
    };
    edge(xc - ub, xc + ub, 'ob');   // Untergurt unten (l→r)
    edge(xc + ub, xc + st, 'ib');   // Untergurt-Innenkante rechts
    edge(xc + st, xc + ot, 'it');   // Obergurt-Innenkante rechts
    edge(xc + ot, xc - ot, 'ot');   // Obergurt oben (r→l)
    edge(xc - ot, xc - st, 'it');   // Obergurt-Innenkante links
    edge(xc - st, xc - ub, 'ib');   // Untergurt-Innenkante links
    const res = simplifyLoop(out);
    res.closed = true;
    if (beyond) res.noClamp = true;
    res.dtBands = { ot: rp.ot, ub: rp.ub, minBand: mb, kerf: dt.kerf || 0 };
    return res;
  }
  // Geschlossenen Umlauf bereinigen: Nullstrecken (doppelte Punkte) und kollineare
  // Zwischenpunkte auf geraden Kanten entfernen. Behält nur echte Ecken/Krümmung.
  function simplifyLoop(poly, eps) {
    const e = eps != null ? eps : 1e-7;
    let P = poly.filter((p, i, arr) => { const q = arr[(i + 1) % arr.length]; return Math.hypot(q.x - p.x, q.y - p.y) > e; });
    for (let pass = 0; pass < 4; pass++) {
      const n = P.length; if (n < 4) break;
      const keep = [];
      for (let i = 0; i < n; i++) {
        const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n];
        const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
        // kollinear UND gleiche Richtung -> Zwischenpunkt entbehrlich
        if (Math.abs(cross) < e * Math.max(1, Math.hypot(c.x - a.x, c.y - a.y)) && dot > 0) continue;
        keep.push(b);
      }
      if (keep.length === P.length) break;
      P = keep;
    }
    return P;
  }
  // Alle Holme einer Rippe (Wurzel/Außen eines Segments) zeichnen. Die Nasen-
  // Lage kommt aus sparFromLE (inkl. Vererbung/gerader Linie).
  //  core (optional) = Kernkontur nach Beplankungsabzug (Höhenbezug + Anfahrt).
  // Rückgabe (für die Legende): { n: gezeichnete Holme, lead: Anfahrt gezeichnet,
  // kerf: eigene Holm-Schnittspur gezeichnet }.
  function drawSpars(ctx, V, segIdx, which, pts, dy, core) {
    const cut = App.wing && App.wing.cuts && App.wing.cuts[Math.min(segIdx, App.wing.cuts.length - 1)];
    const info = { n: 0, lead: false, kerf: false };
    (state.spars || []).forEach(sp => {
      if (!sparAppliesTo(sp, segIdx)) return;
      const g = sparOnProfile(sp, pts, core || null, sparFromLE(sp, segIdx, which), sparYc(sp), which, core); if (!g) return;
      info.n++;
      const strokePoly = pl => {
        const poly = dy ? pl.map(p => ({ x: p.x, y: p.y + dy })) : pl;
        ctx.strokeStyle = App.PAL.spar; ctx.lineWidth = 1.6; ctx.setLineDash(dashFor('spar', []));
        ctx.beginPath(); poly.forEach((p, i) => i ? ctx.lineTo(V.X(p.x), V.Y(p.y)) : ctx.moveTo(V.X(p.x), V.Y(p.y)));
        ctx.closePath(); ctx.stroke();
      };
      if (isPocket(sp)) {
        // Tasche ist in die (getrimmte) Profilkontur eingerechnet (fertiges Werkstück)
        // -> nur Wand→Boden→Wand (offener Teilpfad, KEIN Mündungs-„Deckel") in
        // Holmfarbe hervorheben. So bleibt die Mündung offen wie am fertigen Teil.
        const flN = sparFromLE(sp, segIdx, which);
        const sidesN = (sp.pkSide === 'top' || sp.pkSide === 'bottom') ? [sp.pkSide] : ['top', 'bottom'];
        sidesN.forEach(side => {
          const pgN = pocketGeom(pts, sp, segIdx, which, flN, side); if (!pgN) return;
          const m = pocketMergedLoop(pts, pgN, side, sp.pkFlat); if (!m) return;
          let wf = m.loop.slice(m.a, m.b + 1);
          if (dy) wf = wf.map(p => ({ x: p.x, y: p.y + dy }));
          ctx.strokeStyle = App.PAL.spar; ctx.lineWidth = 1.6; ctx.setLineDash(dashFor('spar', []));
          ctx.beginPath(); wf.forEach((p, i) => i ? ctx.lineTo(V.X(p.x), V.Y(p.y)) : ctx.moveTo(V.X(p.x), V.Y(p.y))); ctx.stroke();
          ctx.setLineDash([]);
        });
      } else {
        strokePoly(g.poly);
        if (g.poly2) strokePoly(g.poly2);   // zweite Taschenseite (Paar oben+unten)
      }
      if (g.lead) {
        info.lead = true;
        const a = { x: g.lead[0].x, y: g.lead[0].y + (dy || 0) }, b = { x: g.lead[1].x, y: g.lead[1].y + (dy || 0) };
        ctx.strokeStyle = App.PAL.sparLead; ctx.lineWidth = 1.2; ctx.setLineDash(dashFor('sparLead', [4, 3]));
        ctx.beginPath(); ctx.moveTo(V.X(a.x), V.Y(a.y)); ctx.lineTo(V.X(b.x), V.Y(b.y)); ctx.stroke();
        ctx.setLineDash([]);
      }
      // Schnittspur des Holms (Abbrand-kompensierter Drahtweg der Tasche) anzeigen,
      // wenn „Schnittspur (Abbrand)" aktiv ist. ABER: Im Modus „während des Schnitts"
      // steckt die Tasche bereits als Abstecher in der Profilbahn (applySparCuts) und
      // wird dort als Haupt-Schnittspur (pr.rootPath) gezeichnet — die ist zugleich
      // die per Punkte-Editor bearbeitbare und die im G-Code verwendete Bahn. Eine
      // zweite, rein aus der Geometrie gerechnete Spur würde sie DOPPELT darstellen
      // (und nach dem Bearbeiten auseinanderlaufen). Daher hier nur zeichnen, wenn die
      // Tasche NICHT in die Profilbahn eingerechnet ist (Modus „nach"/„nur", oder
      // nicht proportionale Holme, die ebenfalls separat geschnitten werden).
      const bakedInPath = state.cfg.sparCut && !state.cfg.sparOnly
        && sparModeOf(sp) === 'during';
      if (!bakedInPath && state.cfg.showKerf && cut && g.poly && g.poly.length > 2) {
        try {
          const cR = sparCoreOf(cut.root.pts, segIdx, 'root'), cT = sparCoreOf(cut.tip.pts, segIdx, 'tip');
          const gr = sparOnProfile(sp, cut.root.pts, cR || cut.root.pts, sparFromLE(sp, segIdx, 'root'), sparYc(sp), 'root', cR);
          const gt = sparOnProfile(sp, cut.tip.pts, cT || cut.tip.pts, sparFromLE(sp, segIdx, 'tip'), sparYc(sp), 'tip', cT);
          if (gr && gt) {
            info.kerf = true;
            const kh = App.sparKerfHalf(sp, cut, gr.poly, gt.poly);
            const k = which === 'root' ? kh.root : kh.tip;
            ctx.strokeStyle = App.PAL.kerf; ctx.lineWidth = 1.3; ctx.setLineDash(dashFor('kerf', [4, 3]));
            if (isPocket(sp)) {
              // Schneidepfad = EXAKTER Parallel-Offset der Taschenkontur (Wände/Boden)
              // zur Abfallseite (offsetInward mit NEGATIVEM k) -> überall gleicher
              // Abstand k; die FERTIGE Tasche hat bei „Abbrand innen" das Nennmaß. Die
              // beiden Mündungspunkte werden auf den Schnittpunkt der Offset-Wand mit der
              // Profiloberfläche gelegt (wallHitSurface) — NICHT auf den Gehrungspunkt,
              // der die Mündung aufweiten würde. Offener Pfad (keine Mündungssehne).
              const flK = sparFromLE(sp, segIdx, which);
              const sides = (sp.pkSide === 'top' || sp.pkSide === 'bottom') ? [sp.pkSide] : ['top', 'bottom'];
              sides.forEach(side => {
                const pg = pocketGeom(pts, sp, segIdx, which, flK, side); if (!pg) return;
                const m = pocketMergedLoop(pts, pg, side, sp.pkFlat); if (!m) return;
                let off = k ? offsetInward(m.loop, -k) : m.loop.map(p => ({ x: p.x, y: p.y }));
                let seg = off.slice(m.a, m.b + 1).map(p => ({ x: p.x, y: p.y }));   // Wand→Boden→Wand
                if (k && seg.length >= 3) {
                  const top = side === 'top';
                  const s0 = wallHitSurface(seg[1], seg[0], pts, top); if (s0) seg[0] = s0;
                  const sN = wallHitSurface(seg[seg.length - 2], seg[seg.length - 1], pts, top); if (sN) seg[seg.length - 1] = sN;
                }
                if (dy) seg = seg.map(p => ({ x: p.x, y: p.y + dy }));
                if (seg.length < 2) return;
                // Wahre Dicke: k ist der HALBE Spalt (Versatz) -> Band 2k breit.
                if (App.kerfBand) App.kerfBand(ctx, V, [seg], { k: 2 * k });
                ctx.beginPath(); seg.forEach((p, i) => i ? ctx.lineTo(V.X(p.x), V.Y(p.y)) : ctx.moveTo(V.X(p.x), V.Y(p.y)));
                ctx.stroke();
              });
              ctx.setLineDash([]);
            } else {
              let off = k ? offsetInward(g.poly.map(p => ({ x: p.x, y: p.y })), k) : g.poly.map(p => ({ x: p.x, y: p.y }));
              if (k) off = deloopPoly(off);
              // Scharnierausschnitt (noClamp): Schnittspur NICHT auf die Kontur klemmen
              // (der Schnitt soll über die Profilseite hinausgehen) — wie im G-Code.
              if (!g.poly.noClamp) off = off.map(p => { const s = surfaceAtX(pts, p.x); return s ? { x: p.x, y: Math.max(s.bot, Math.min(s.top, p.y)) } : p; });
              if (dy) off = off.map(p => ({ x: p.x, y: p.y + dy }));
              if (App.kerfBand) App.kerfBand(ctx, V, [off], { k: 2 * k, close: true });   // Band 2k (k = halber Spalt)
              ctx.beginPath(); off.forEach((p, i) => i ? ctx.lineTo(V.X(p.x), V.Y(p.y)) : ctx.moveTo(V.X(p.x), V.Y(p.y)));
              ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
            }
          }
        } catch (e) { /* Holm-Schnittspur überspringen, Nennkontur bleibt sichtbar */ }
      }
    });
    return info;
  }


  // ---- Registry: eigene Top-Level-Namen bereitstellen (automatisch) ----
  Object.assign(App, { DT_BAND_RES, SPAR_CORE_GAP, SPAR_HOLE_N, SPAR_LEAD_N, anyNonProportionalSpar, applySparCuts, carvePocketSide, clampEdge });
  Object.assign(App, { clipPolylineX, cornerAnchoredResampleN, crossOnPath, deloopPoly, doubleTClampedPoly, drawSpars, dtThinReport, flattenFloor });
  Object.assign(App, { hingeFromLE, hingeNotchPoly, hingePctAtStation, holeEntryNearest, holeEntryStart, holeEntryStartY, holeExcursion, holeExcursionFinish });
  Object.assign(App, { holeLoopPrep, kerfKeepTopology, lerpPt, loopAnchors, monotonicX, nearestIdx, offsetArcPerp, offsetInward });
  Object.assign(App, { floorWithWeb, isPocket, migrateSparModes, sparModeOf, pocketDepth, pocketSkewInfo, pocketFloorFromArc, pocketGeom, pocketMergedLoop, pocketOutline, pocketWallKerf, polyArea, profileWithPockets });
  Object.assign(App, { resampleLoopN, resamplePolylineN, resampleSeg, segCross, segRibChord, simplifyLoop, sparAppliesTo, sparConvertFlangeH });
  Object.assign(App, { sparConvertSizeUnits, sparCoreFromSheet, sparCoreOf, sparFromLE, sparKerfIn, sparOnProfile, sparOwnFromLE, sparPoly, sparPolys, sparProportional });
  Object.assign(App, { sparRange, sparRefThick, sparSize, sparYOff, sparYc, stationChord, stationLE, stationZ });
  Object.assign(App, { surfaceAtX, trapezBaseRefPoly, trapezClampedPoly, wallHitSurface, wedgeClampedPoly });
})();
