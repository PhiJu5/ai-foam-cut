/* wing.js — Mehrsegment-Flügel.
 *
 * Modell:
 *   root                : { profile, chord }                — Innenprofil des 1. Segments
 *   segments[k]         : { profile, chord, span, sweep, washout }
 *                         beschreibt das AUSSEN-Ende (Tip) von Segment k.
 *   Das Innen-Ende (Root) von Segment k ist das Außen-Ende von Segment k-1
 *   (bzw. `root` für k=0). Dadurch sind die Stöße immer stetig — an jedem
 *   Stoß wird genau EIN Profil verwendet, das Endprofil des vorigen Segments.
 *
 *   span    : Spannweite DIESES Segments (mm)
 *   sweep   : LE-Versatz Tip ggü. Root DIESES Segments (mm)
 *   washout : absolute Verwindung am Tip-Ende (°, relativ zur Wurzel)
 *
 * Blockkoordinaten: X=Sehne (LE klein), Y=Dicke, Z=Spannweite (0 an Wurzel).
 */
(function (global) {
  'use strict';

  // normiertes Profil -> in mm platziert
  function place(normPts, opts) {
    const { chord, washoutDeg, twistRefX, leOffset, z, yOffset } = opts;
    const yo = yOffset || 0;
    // Vorzeichen der Schränkung: Endleiste (TE) nach UNTEN = positiver Wert,
    // Endleiste nach OBEN = negativer Wert -> Winkel invertiert drehen.
    const rad = -washoutDeg * Math.PI / 180;
    const ca = Math.cos(rad), sa = Math.sin(rad);
    const px = twistRefX;
    const pts = normPts.map(p => {
      let x = p.x - px, y = p.y;
      const rx = x * ca - y * sa;
      const ry = x * sa + y * ca;
      return { x: (rx + px) * chord + leOffset, y: ry * chord + yo };
    });
    pts.name = normPts.name;
    return { pts, z, chord, name: normPts.name };
  }

  function yMid(pts) {
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { if (p.y < lo) lo = p.y; if (p.y > hi) hi = p.y; }
    return (lo + hi) / 2;
  }
  function shiftPts(pts, dy) { if (dy) for (const p of pts) p.y += dy; }

  // Ein einzelnes Segment als schneidbares Paneel (lokale Koordinaten:
  // Root bei z=0/leOffset=0, Tip bei z=span/leOffset=sweep).
  //
  // Höhe (Profilsehne): Bezug ist die Sehnenmitte der WURZELRIPPE DES ERSTEN
  // SEGMENTS (o.datum). Von dort wird die V-Form über die Segmente KUMULIERT
  // durchgezogen (o.rootRise/o.tipRise = kumulierte Höhe am Innen-/Außenende).
  // Weil der Block auf dieses feste Datum (0) zentriert bleibt, liegt das
  // gemeinsame Stoßprofil in beiden Nachbarblöcken auf gleicher Höhe -> die
  // Schaumschalen passen zueinander, und die V-Form steckt im Schnitt.
  function segmentCut(rootProf, tipProf, o) {
    const N = o.points;
    const datum = o.datum || 0;
    // Drehpunkt (Schränkung) je Rippe getrennt: Innen- und Außenprofil können
    // um verschiedene Sehnenpunkte verdreht werden. Fällt zurück auf o.twistRef.
    const rootTR = o.rootTwistRef != null ? o.rootTwistRef : o.twistRef;
    const tipTR  = o.tipTwistRef  != null ? o.tipTwistRef  : o.twistRef;
    const root = place(Airfoil.resample(rootProf, N), {
      chord: o.rootChord, washoutDeg: o.rootTwist, twistRefX: rootTR,
      leOffset: 0, z: 0
    });
    const tip = place(Airfoil.resample(tipProf, N), {
      chord: o.tipChord, washoutDeg: o.tipTwist, twistRefX: tipTR,
      leOffset: o.sweep, z: o.span
    });
    const rShift = -datum + (o.rootRise || 0), tShift = -datum + (o.tipRise || 0);
    shiftPts(root.pts, rShift);
    shiftPts(tip.pts, tShift);
    // Platzierungs-Transform je Rippe (für den Punkte-Editor: mm <-> normiert).
    // mm = ((rot(n-px)+px)*chord + leOffset, rot_y*chord + shift), flip später.
    root.pl = { chord: o.rootChord, twist: o.rootTwist, twistRef: rootTR, leOffset: 0, shift: rShift, flip: false };
    tip.pl  = { chord: o.tipChord,  twist: o.tipTwist,  twistRef: tipTR, leOffset: o.sweep, shift: tShift, flip: false };
    return { root, tip, span: o.span, N };
  }

  // Referenzhöhe (mm, y) EINER Rippe für die globale Höhenausrichtung. Die Rippe
  // wird OHNE Höhenversatz platziert (yOffset=0), dann das gewählte Merkmal
  // gemessen:
  //   'top'    höchster Punkt   'bottom' tiefster Punkt
  //   'chord'  Sehne am Twist-Bezugspunkt (liegt bei y=0) -> immer 0
  //   'hinge'  Scharnierlinie (Seite + % der Sehne ab Endleiste)
  function ribRefY(prof, N, opts, mode, hingeSide, hingePct) {
    const pts = place(Airfoil.resample(prof, N), opts).pts;
    if (mode === 'top')    { let hi = -Infinity; for (const p of pts) if (p.y > hi) hi = p.y; return hi; }
    if (mode === 'bottom') { let lo =  Infinity; for (const p of pts) if (p.y < lo) lo = p.y; return lo; }
    if (mode === 'hinge') {
      // LE liegt bei x≈leOffset, TE bei x≈leOffset+chord. Ziel-x = (1−pct)·Sehne
      // ab LE. Obere Flanke = Index 0..iLE, untere = iLE..N-1.
      const iLE = Math.ceil(N / 2) - 1;
      const chord = opts.chord || 1, x0 = opts.leOffset || 0;
      const xt = x0 + (1 - (hingePct != null ? hingePct : 25) / 100) * chord;
      const side = (hingeSide === 'bottom') ? pts.slice(iLE) : pts.slice(0, iLE + 1);
      for (let i = 0; i < side.length - 1; i++) {
        const a = side[i], b = side[i + 1];
        if ((a.x - xt) * (b.x - xt) <= 0 && a.x !== b.x) {
          const t = (xt - a.x) / (b.x - a.x); return a.y + t * (b.y - a.y);
        }
      }
      let best = side[0] ? side[0].y : 0, bd = Infinity;   // Fallback: nächster Punkt
      for (const p of side) { const d = Math.abs(p.x - xt); if (d < bd) { bd = d; best = p.y; } }
      return best;
    }
    return 0;   // 'chord' bzw. unbekannt: Twist-Bezugspunkt der Sehne (y=0)
  }

  function build(cfg) {
    const N = cfg.points;
    // Globaler Drehpunkt (Schränkung) nur noch als Rückfall-Wert. Der Drehpunkt
    // wird primär je Profil gesetzt: root.twistRef bzw. seg.twistRef.
    const trDef = cfg.twistRef != null ? cfg.twistRef : 0.25;
    const trOf = o => (o && o.twistRef != null) ? o.twistRef : trDef;
    const tr = trDef;   // Wurzelrippe des ersten Segments (Rückfall)
    const rootTR = trOf(cfg.root);
    const stations = [];   // absolute Positionen für die Draufsicht
    const cuts = [];       // pro Segment ein schneidbares Paneel

    // Globale Höhenausrichtung (optional). Ist sie aktiv, richtet sie ALLE
    // Rippen an einem gemeinsamen Merkmal aus (höchster/tiefster Punkt, Sehne,
    // Scharnierlinie) und legt darüber EINE globale V-Form der ganzen Tragfläche.
    // Die V-Form der einzelnen Segmente (dih/dihRoot) wird dann NICHT verwendet.
    const AL = (cfg.align && cfg.align.enable) ? cfg.align : null;
    // Globale V-Form (°) um die Wurzel: gSlope = Höhe je mm Spannweite.
    const gDeg = +cfg.globalDih || 0;
    const gSlope = gDeg ? Math.tan(gDeg * Math.PI / 180) : 0;
    // Gruppenweise Ausrichtlinie: Die V-Form kann je Segmentgruppe eine eigene
    // Steigung haben (Grenze über seg.alignGroupStart). Gruppe 1 nutzt die globalen
    // Werte (AL.dih/AL.dihMode), weitere Gruppen ihre eigenen (seg.alignDih/
    // alignDihMode). deg: Gruppe 1 absolut, weitere RELATIV zur Vorgruppe (Winkel
    // zwischen den Geraden). mm: x-/y-Versatz über die Spannweite DER Gruppe.
    // alignYAt[i] = Ziel-Höhe an Stationsgrenze i (0 = Wurzel). Piecewise-linear.
    const segsAL = cfg.segments, nAL = segsAL.length;
    const zBound = [0]; for (let k = 0; k < nAL; k++) zBound.push(zBound[k] + (segsAL[k].span || 0));
    const alignYAt = new Array(nAL + 1); alignYAt[0] = 0;
    if (AL) {
      let cumAngle = 0, curSlope = 0;
      for (let k = 0; k < nAL; k++) {
        if (k === 0 || segsAL[k].alignGroupStart) {
          const grp0 = k === 0;
          const mode = grp0 ? (AL.dihMode || 'mm') : (segsAL[k].alignDihMode || 'mm');
          const val = (grp0 ? AL.dih : segsAL[k].alignDih) || 0;
          if (mode === 'deg') {
            cumAngle = grp0 ? val : cumAngle + val;
            curSlope = Math.tan(cumAngle * Math.PI / 180);
          } else {
            let gz = 0; for (let j = k; j < nAL && (j === k || !segsAL[j].alignGroupStart); j++) gz += (segsAL[j].span || 0);
            curSlope = gz > 0 ? val / gz : 0; cumAngle = Math.atan(curSlope) * 180 / Math.PI;
          }
        }
        alignYAt[k + 1] = alignYAt[k] + curSlope * (zBound[k + 1] - zBound[k]);
      }
    }
    // Ziel-Höhe der Ausrichtlinie an Spannweitenposition zabs (piecewise-linear).
    const alignTarget = zabs => {
      if (!AL) return 0;
      if (zabs <= 0) return alignYAt[0];
      for (let i = 0; i < nAL; i++)
        if (zabs <= zBound[i + 1] + 1e-6) {
          const t = (zabs - zBound[i]) / ((zBound[i + 1] - zBound[i]) || 1);
          return alignYAt[i] + t * (alignYAt[i + 1] - alignYAt[i]);
        }
      return alignYAt[nAL];
    };

    // Station 0 = Wurzel
    let prevProf = cfg.root.profile, prevChord = cfg.root.chord, prevTwist = 0;
    let prevTwistRef = rootTR;
    let cumZ = 0, cumLE = 0;
    // V-Form: Höhe der Profilsehne, kumuliert über die Segmente
    let cumY = 0, cumAng = 0;
    const st0 = place(Airfoil.resample(prevProf, N), {
      chord: prevChord, washoutDeg: 0, twistRefX: rootTR, leOffset: 0, z: 0
    });
    st0.yRise = 0; st0.dihAngle = 0;
    stations.push(st0);

    // Höhen-Datum: Sehnenmitte der Wurzelrippe des ERSTEN Segments (Station 0).
    // Von hier aus wird die V-Form kumuliert durchgezogen; alle Blöcke bleiben
    // auf dieses Datum zentriert.
    //
    // Die Wurzelhöhe des ERSTEN Segments (dihRoot) ist die Starthöhe: sie
    // verschiebt die GESAMTE Tragfläche parallel im Block (Form bleibt, nur die
    // Lage ändert sich). Ab Segment 2 ist dihRoot ein reiner lokaler Wurzel-
    // Versatz (nur diese Wurzelrippe). Der Parallel-Versatz steckt hier im Datum.
    // Auch bei globaler Ausrichtung bleibt die Starthöhe der Wurzelrippe (dihRoot
    // des ERSTEN Segments) erhalten: Sie bestimmt die Lage der GESAMTEN Tragfläche
    // im Block. Die Wurzelrippe bleibt, wo sie ist — alle anderen Profile werden
    // an IHR ausgerichtet.
    const baseOffset = (cfg.segments[0] && cfg.segments[0].dihRoot) || 0;
    const datum = yMid(st0.pts) - baseOffset;

    // Referenzhöhe (Merkmal) der WURZELRIPPE des ersten Segments. Bei aktiver
    // Ausrichtung liegt das Merkmal jeder anderen Rippe auf dieser Höhe (plus der
    // globalen V-Form) — die Wurzelrippe selbst wird NICHT verschoben.
    const s0 = cfg.segments[0] || {};
    const refRoot = AL
      ? ribRefY(prevProf, N, { chord: prevChord, washoutDeg: 0, twistRefX: rootTR, leOffset: 0, z: 0 }, AL.ref, s0.hingeSide, s0.hingePct)
      : 0;

    cfg.segments.forEach((s, k) => {
      const zRootAbs = cumZ, zTipAbs = cumZ + s.span;
      let rootRise, tipRise;
      if (AL) {
        // GLOBALE Ausrichtung: jede Rippe so verschieben, dass ihr Merkmal auf
        // der globalen V-Linie liegt. Merkmal je Rippe an ihrer Sehne gemessen.
        // Merkmal jeder Rippe auf die Wurzel-Referenz (refRoot) + globale V-Form
        // bringen. Für die Wurzelrippe selbst (rRef == refRoot, zRootAbs == 0)
        // ergibt sich rootRise = 0 -> sie bleibt an ihrer Starthöhe.
        const rRef = ribRefY(prevProf, N, { chord: prevChord, washoutDeg: prevTwist, twistRefX: prevTwistRef, leOffset: 0, z: 0 }, AL.ref, s.hingeSide, s.hingePct);
        const tRef = ribRefY(s.profile, N, { chord: s.chord, washoutDeg: s.washout, twistRefX: trOf(s), leOffset: 0, z: 0 }, AL.ref, s.hingeSide, s.hingePctTip);
        rootRise = alignTarget(zRootAbs) + refRoot - rRef;
        tipRise  = alignTarget(zTipAbs) + refRoot - tRef;
        cumAng = Math.atan2(alignTarget(zTipAbs) - alignTarget(zRootAbs), s.span || 1) * 180 / Math.PI;
        cumY = alignTarget(zTipAbs);
      } else {
        // Stetige Basis-Höhe = Außenende des Vorsegments (durchgezogene V-Form).
        // cumY enthält bereits die globale Drehung -> hier herausrechnen, die
        // Segmentkette bleibt davon unberührt.
        const baseRoot = cumY - gSlope * zRootAbs;
        // Wurzel-Höhe dieses Segments: verschiebt NUR die Wurzelrippe im Block
        // (Versatz gegenüber der Basis). Das Außenende bleibt davon unberührt und
        // die Folgesegmente ebenfalls -> dihRoot wandert nicht in die kumulierte
        // Höhe. Für Segment 1 wirkt dihRoot als Starthöhe (Parallel-Versatz, oben
        // im Datum verrechnet) und daher hier NICHT lokal.
        const localRoot = k === 0 ? 0 : (s.dihRoot || 0);
        rootRise = baseRoot + localRoot;
        // V-Form dieses Segments (Höhe des Außen- über dem Innenende): entweder
        // Höhe in mm, oder Winkel (°) relativ zum Vorsegment.
        let rise;
        if (s.dihMode === 'deg') {
          cumAng += (s.dih || 0);
          rise = s.span * Math.tan(cumAng * Math.PI / 180);
        } else {
          rise = s.dih || 0;
          cumAng = Math.atan2(rise, s.span || 1) * 180 / Math.PI;
        }
        tipRise = baseRoot + rise;
        cumY = baseRoot + rise;
      }
      // Globale V-Form: Starr-Drehung der ganzen Fläche um die Wurzelrippe
      // (Höhe linear mit der absoluten Spannweitenposition). Die Winkel der
      // Segmente zueinander bleiben unverändert.
      if (gSlope) {
        rootRise += gSlope * zRootAbs;
        tipRise  += gSlope * zTipAbs;
        cumY     += gSlope * zTipAbs;
      }
      // Schnitt-Paneel (lokal). Die V-Form/Ausrichtung wird IMMER in den Schnitt
      // eingerechnet: Der Block liegt waagrecht, das Paneel wird schräg aus dem
      // Block geschnitten. So steckt die V-Form direkt im G-Code.
      cuts.push(segmentCut(prevProf, s.profile, {
        rootChord: prevChord, tipChord: s.chord,
        rootTwist: prevTwist, tipTwist: s.washout,
        sweep: s.sweep, span: s.span, twistRef: tr, points: N,
        rootTwistRef: prevTwistRef, tipTwistRef: trOf(s),
        datum: datum, rootRise: rootRise, tipRise: tipRise
      }));
      // absolute Station (Außenende).
      cumZ += s.span; cumLE += s.sweep;
      const st = place(Airfoil.resample(s.profile, N), {
        chord: s.chord, washoutDeg: s.washout, twistRefX: trOf(s),
        leOffset: cumLE, z: cumZ
      });
      st.yRise = cumY; st.dihAngle = cumAng + gDeg;   // Anzeige inkl. globaler V-Form
      stations.push(st);
      prevProf = s.profile; prevChord = s.chord; prevTwist = s.washout;
      prevTwistRef = trOf(s);
    });

    // Kopfüber schneiden: das gesamte Werkstück um die Blockmitte (y=0) spiegeln.
    // Damit liegt die Profilunterseite oben UND die V-Form wird mitgespiegelt
    // (aus V wird Λ). Wirkt auf Schnitt-Paneele UND Draufsicht-Stationen.
    if (cfg.flipY) {
      const flip = arr => { for (const p of arr) p.y = -p.y; };
      cuts.forEach(c => { flip(c.root.pts); flip(c.tip.pts); c.root.pl.flip = true; c.tip.pl.flip = true; });
      stations.forEach(s => { flip(s.pts); s.yRise = -s.yRise; });
    }

    return { stations, cuts, totalSpan: cumZ, N };
  }

  global.Wing = { build, place, segmentCut };
})(window);
