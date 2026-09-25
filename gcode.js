/* gcode.js — Reiter „G-Code": Anzeige, Bearbeitung, Datei laden, 3D-Szenen für die Simulation, Speichern/Download (Kern)  (@@split-module, ausgelagert aus app.js)
 * Namen aus früher geladenen Dateien werden unten aus window.App gebunden;
 * Namen aus app.js (lädt später) laufen als App.<name>. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;
  // ---------- G-Code ---------------------------------------------------
  /* Maschinennullpunkt: hinter der Tragfläche, unten auf Blockunterkante.
   * X=0 an der Block-Hinterkante (Endleistenseite = größtes X des Blocks),
   * Y=0 an der Block-Unterkante. Reine Verschiebung, kein Spiegeln — sonst
   * änderte sich die Schnittgeometrie. Für Wurzel und Rand identisch, damit
   * beide Turmbahnen synchron bleiben. */
  // Y-Mitte, um die der (waagrechte) Block eines Schnitts zentriert wird.
  // Die Höhe kommt aus dem festen Datum (Sehnenmitte der Wurzelrippe des ersten
  // Segments = 0); die kumulierte V-Form steckt bereits in den Schnittpunkten.
  // Der Block bleibt auf 0 zentriert, damit das Stoßprofil in Nachbarblöcken
  // auf gleicher Höhe sitzt (Schalen passen zueinander).

  function blockCenterY() { return 0; }
  // Hinterkante (Endleistenseite, größtes x) des Blocks in Cut-Koordinaten. Bei
  // aktiver Werkstück-Drehung: das größte x der VIER gedrehten Blockecken (in der
  // x-z-Ebene; y ist drehinvariant). So wird der Nullpunkt an die gedrehte
  // Endleiste gelegt -> der Block wird mit seiner Endleiste auf 0,0 geschoben.
  function blockRearX(cut, seg) {
    const e = App.blockExt(seg, cut.root.chord, cut.tip.chord);
    const xr = cut.root.pts.map(p => p.x), xt = cut.tip.pts.map(p => p.x);
    const rearR = Math.max.apply(null, xr) + e.teR;
    if (state.cfg.sweepRot && window.SweepRot) {
      const pr = App.projectCut(cut, seg), rot = pr.sweepRot;
      if (rot) {
        const rearT = Math.max.apply(null, xt) + e.teT;
        const frontR = Math.min.apply(null, xr) - e.leR, frontT = Math.min.apply(null, xt) - e.leT;
        const corners = [[rearR, pr.zRoot], [frontR, pr.zRoot], [rearT, pr.zTip], [frontT, pr.zTip]];
        let mx = -Infinity;
        corners.forEach(([x, z]) => { const p = SweepRot.rotXZ(x, z, rot.angleRad, rot.pivot.x, rot.pivot.z); if (p.x > mx) mx = p.x; });
        return mx;
      }
    }
    return rearR;
  }
  // Vorderkante (Nasenseite, kleinstes x) des Blocks — Gegenstück zu blockRearX
  // für die Schnittrichtung „von vorne" (Nullpunkt vor der Nase).
  function blockFrontX(cut, seg) {
    const e = App.blockExt(seg, cut.root.chord, cut.tip.chord);
    const xr = cut.root.pts.map(p => p.x), xt = cut.tip.pts.map(p => p.x);
    const frontR = Math.min.apply(null, xr) - e.leR;
    if (state.cfg.sweepRot && window.SweepRot) {
      const pr = App.projectCut(cut, seg), rot = pr.sweepRot;
      if (rot) {
        const frontT = Math.min.apply(null, xt) - e.leT;
        const rearR = Math.max.apply(null, xr) + e.teR, rearT = Math.max.apply(null, xt) + e.teT;
        const corners = [[rearR, pr.zRoot], [frontR, pr.zRoot], [rearT, pr.zTip], [frontT, pr.zTip]];
        let mn = Infinity;
        corners.forEach(([x, z]) => { const p = SweepRot.rotXZ(x, z, rot.angleRad, rot.pivot.x, rot.pivot.z); if (p.x < mn) mn = p.x; });
        return mn;
      }
    }
    return frontR;
  }
  /* Schnittrichtung des Kernschnitts:
   *   'rear'  (Standard) — von hinten: Nase vorne, Nullpunkt hinter der Endleiste,
   *            Kontur als EIN Zug (oben rein, Nasen-Schlaufe, unten raus).
   *   'front' — von vorne: Nase hinten (zum Nullpunkt), Oberseite und Unterseite
   *            je als eigener Zug von der Nase zur Endleiste (hotwire_gcode.js). */
  function cutFront() { return state.cfg.cutDir === 'front'; }
  function blockOrigin(cut, seg) {
    // Block liegt waagrecht: Unterkante bezogen auf die Block-Mitte (je nach
    // Ausrichtmodus gemeinsame Querschnittsmitte oder Bezugsmerkmal auf 0).
    const cy = blockCenterY(cut);
    const y = cy - App.blockH() / 2 - (state.cfg.blockY || 0);
    // „Von vorne": Nullpunkt VOR der Nase (blockX Abstand zur Blockvorderkante),
    // Maschinen-X = x − origin.x (sx = +1) wächst zur Endleiste hin.
    if (cutFront()) return { x: blockFrontX(cut, seg) - (state.cfg.blockX || 0), y, sx: 1 };
    // Maschinennullpunkt hinten/unten, mit wählbarem Abstand zum Block:
    //   blockX = Abstand in Flugrichtung (X, hinter der Endleiste),
    //   blockY = Höhe des Blocks über dem Nullpunkt (Block schwebt +blockY).
    // Nullpunkt-Y liegt daher blockY UNTER der Blockunterkante.
    // X=0 an der (ggf. gedrehten) Block-Hinterkante. Maschinen-X = origin.x − x (sx = −1).
    return { x: blockRearX(cut, seg) + (state.cfg.blockX || 0), y, sx: -1 };
  }
  // Profilkoordinate x -> Maschinen-X zum Nullpunkt o (siehe blockOrigin).
  function machX(o, x) { return (o && o.sx > 0) ? x - o.x : o.x - x; }
  // Sicherheitshöhe (Maschinen-Y) über der Blockoberkante: Blockhöhe + Zugabe,
  // zzgl. Höhenabstand des Blocks vom Nullpunkt (blockY).
  function safeHeight() { return (state.cfg.blockY || 0) + App.blockH() + (state.material.safeH || 0); }
  // Wirksamer Vorschub AUSSERHALB des Blocks (Anfahrt/Auslauf in Luft), gedeckelt
  // auf den Maschinen-Max.-Vorschub — dieser gilt fürs SCHNELLERE (äußere) Portal.
  function outsideFeed() {
    const maxF = state.cfg.maxFeed || 0;
    let v;
    if (state.cfg.outFeedMode === 'max') v = maxF > 0 ? maxF : 3000;
    else if (state.cfg.outFeedMode === 'free') v = state.cfg.outFeed || state.cfg.feed;
    else v = state.cfg.feed;                         // 'cut'
    return maxF > 0 ? Math.min(v, maxF) : v;
  }
  /* Turm-Projektion eines (Wurzel@zR -> Rand@zT)-Punktepaars auf Ebene z=zp,
   * inkl. Sweep-Drehung (rot = pr.sweepRot | null). Ohne Drehung identisch zur
   * linearen HotWire.proj. Gemeinsam für Block-/Schalenschnitte, damit deren
   * G-Code bei aktiver Werkstück-Drehung mitgedreht wird. Gibt {x,y}.
   * Hinweis: Y (Höhe) ist gegenüber der Drehung um die Hochachse invariant. */
  function sweepProj2(rot, zR, zT, xr, yr, xt, yt, zp) {
    if (!rot) { const t = (zp - zR) / ((zT - zR) || 1); return { x: xr + t * (xt - xr), y: yr + t * (yt - yr) }; }
    const dz = rot.dz || 0;
    const R = SweepRot.rotXZ(xr, zR, rot.angleRad, rot.pivot.x, rot.pivot.z);
    const Tt = SweepRot.rotXZ(xt, zT, rot.angleRad, rot.pivot.x, rot.pivot.z);
    R.z += dz; Tt.z += dz;
    const t = (zp - R.z) / ((Tt.z - R.z) || 1);
    return { x: R.x + t * (Tt.x - R.x), y: yr + t * (yt - yr) };
  }
  /* X-Positionen der beiden Blockschnitte, je Turm (links z=0, rechts
   * z=machineWidth), im selben Vor-Origin-Koordinatensystem wie proj.left/right.
   *   front = Blockvorderkante (Profil-LE − vordere Blockzugabe)
   *   rear  = hinteres Blockende (Profil-TE + hintere Blockzugabe) */
  function blockCutGeom(cut, seg, pr) {
    const e = App.blockExt(seg, cut.root.chord, cut.tip.chord);
    // Nase/EL aus dem ORIGINALPROFIL (cut.*.pts, ohne Beplankungsabzug) — die
    // Blockzugabe bemisst sich damit aufs Nennmaß, nicht auf den Kern.
    const noseR = Math.min.apply(null, cut.root.pts.map(p => p.x));
    const noseT = Math.min.apply(null, cut.tip.pts.map(p => p.x));
    const teR = Math.max.apply(null, cut.root.pts.map(p => p.x));
    const teT = Math.max.apply(null, cut.tip.pts.map(p => p.x));
    // Abbrand-Kompensation am Blockschnitt: der Draht fährt um den HALBEN Abbrand
    // weiter nach vorne (Nase) bzw. hinten (EL) ins Verschnittmaterial, damit die
    // stehen bleibende Blockkante genau auf Nennmaß + Blockzugabe liegt.
    const ck = App.cutKerf(cut.root.chord, cut.tip.chord);
    const hkR = ck.root / 2, hkT = ck.tip / 2;
    const frontR = noseR - e.leR - hkR, frontT = noseT - e.leT - hkT;
    const rearR  = teR + e.teR + hkR,   rearT  = teT + e.teT + hkT;
    const zR = pr.zRoot, zT = pr.zTip, mw = state.cfg.machineWidth, rot = pr.sweepRot;
    const px = (a, b, z) => sweepProj2(rot, zR, zT, a, 0, b, 0, z).x;   // wie HotWire.proj (+ Drehung)
    return {
      front: { l: px(frontR, frontT, 0), r: px(frontR, frontT, mw) },
      rear:  { l: px(rearR,  rearT,  0), r: px(rearR,  rearT,  mw) }
    };
  }
  /* Trapezkompensierte Horizontal-Schalenschnitte (Ober-/Unterschale).
   * Front-Ansicht: waagrecht = Spannweite, senkrecht = Dicke. Der Draht ist eine
   * Gerade von der Wurzel- zur Randebene; weil der Abbrand an der Außenrippe (k_t)
   * größer ist als an der Wurzel (k_r), wird die Schnitthöhe je Rippe versetzt ->
   * der Draht läuft als leichtes Trapez.
   *
   * Versatz je Rippe = k  (= k/2 eigener Abbrand des Horizontalschnitts
   *                        + k/2 Kern-Abbrand, der bei „Kern exakt" zulasten der
   *                        Schale geht). Damit ist der Trapez-Keil (Rand−Wurzel)
   *                        genau k_t − k_r — exakt aus cutKerf() je Rippe.
   *   Oberschnitt: Y = Blockoberkante − Dicke_oben + k
   *   Unterschnitt: Y = Blockunterkante + Dicke_unten − k
   * Rückgabe: Schnitthöhen je Turm (l/r) + vordere Block-X je Turm (Auslauf). */
  function shellCutGeom(cut, seg, pr) {
    const k = App.cutKerf(cut.root.chord, cut.tip.chord);   // volle Kerf-Breite je Rippe
    const h = App.blockH(), cy = blockCenterY(cut);
    const yBo = cy + h / 2, yBu = cy - h / 2;            // Block Ober-/Unterkante
    const Dt = state.cfg.shellTop || 0, Db = state.cfg.shellBot || 0;
    const yTopR = yBo - Dt + k.root, yTopT = yBo - Dt + k.tip;
    const yBotR = yBu + Db - k.root, yBotT = yBu + Db - k.tip;
    const zR = pr.zRoot, zT = pr.zTip, mw = state.cfg.machineWidth, rot = pr.sweepRot;
    const at = (a, b, z) => a + (b - a) * (z - zR) / ((zT - zR) || 1);   // Höhen: drehinvariant
    const px = (a, b, z) => sweepProj2(rot, zR, zT, a, 0, b, 0, z).x;    // X: mit Drehung
    const e = App.blockExt(seg, cut.root.chord, cut.tip.chord);
    const noseR = Math.min.apply(null, cut.root.pts.map(p => p.x));
    const noseT = Math.min.apply(null, cut.tip.pts.map(p => p.x));
    const teR = Math.max.apply(null, cut.root.pts.map(p => p.x));
    const teT = Math.max.apply(null, cut.tip.pts.map(p => p.x));
    // Auslauf-X = kompensierte Blockvorderkante (halber Abbrand weiter vorne),
    // deckungsgleich mit blockCutGeom.front.
    const frontR = noseR - e.leR - k.root / 2, frontT = noseT - e.leT - k.tip / 2;   // Blockvorderkante (LE-Seite)
    // Schnittrichtung „von vorne": Auslauf hinter dem hinteren Blockende (= blockCutGeom.rear).
    const rearR = teR + e.teR + k.root / 2, rearT = teT + e.teT + k.tip / 2;
    // Höhe (Y) ist gegenüber der Drehung um die Hochachse invariant -> lineare
    // Interpolation. Nur die X-Auslaufkante (front/rear) wird mitgedreht.
    return {
      top:    { l: at(yTopR, yTopT, 0), r: at(yTopR, yTopT, mw) },
      bottom: { l: at(yBotR, yBotT, 0), r: at(yBotR, yBotT, mw) },
      front:  { l: px(frontR, frontT, 0), r: px(frontR, frontT, mw) },
      rear:   { l: px(rearR, rearT, 0), r: px(rearR, rearT, mw) }
    };
  }
  /* Szene für die 3D-Simulation: Turmabstand, Achsnamen und je Segment der
   * Styroporblock (Lage wie in „Draht & Türme": auf das Profil zentriert)
   * samt der beiden Schnittebenen (Wurzel- und Randseite des Kerns). */
  function buildScene() {
    const mw = state.cfg.machineWidth;
    // Wurzel-/Randebene wie im G-Code: rechte Fläche -> Wurzel am LINKEN Portal
    // (kein mirror), linke Fläche -> Wurzel am RECHTEN Portal (mirror); bei der
    // Schnittrichtung „von vorne" getauscht (App.rootAtRight).
    const mirror = App.rootAtRight();
    const blocks = state.segments.map((s, i) => {
      const cut = App.wing.cuts[Math.min(i, App.wing.cuts.length - 1)];
      const xr = cut.root.pts.map(p => p.x);
      const xt = cut.tip.pts.map(p => p.x);
      const leR = Math.min.apply(null, xr), teR = Math.max.apply(null, xr);
      const leT = Math.min.apply(null, xt), teT = Math.max.apply(null, xt);
      const e = App.blockExt(s, cut.root.chord, cut.tip.chord);
      const bz = App.effBlockZ(cut.span);
      const cutZ0 = mirror ? mw - bz : bz;
      const cutZ1 = mirror ? cutZ0 - cut.span : cutZ0 + cut.span;
      // Gleicher Nullpunkt wie im G-Code (hinten unten). Block = Trapez: Wurzel-
      // ebene bei z0 (cutZ0), Außenebene bei z1 (cutZ1), Länge = Segment-Spannweite.
      const o = blockOrigin(cut, s);
      // Waagrechter Block: gleiche Y-Höhe (gemeinsame Mitte) an Wurzel und Außen,
      // konstant über die Spannweite. Das Paneel (Wurzel −rise/2, Außen +rise/2)
      // liegt dadurch schräg im Block. blockOrigin.y = Mitte − H/2 -> untere Kante 0.
      const bh = App.blockH();
      const cyMid = blockCenterY(cut);
      const yBot = cyMid - bh / 2 - o.y, yTop = cyMid + bh / 2 - o.y;
      // X wie im G-Code gespiegelt (o.x − x): Block liegt in +X, Null dahinter.
      // Rückkante = kleines +X (= blockX), Nase = großes +X. Schnittrichtung „von
      // vorne" (o.sx = +1): Nase = kleines +X, Rückkante = großes +X (noseNear).
      const mx = x => machX(o, x);
      const blk = {
        seg: i,
        x0: mx(teR + e.teR), x1: mx(leR - e.leR),
        y0: yBot, y1: yTop,
        x0t: mx(teT + e.teT), x1t: mx(leT - e.leT),
        y0t: yBot, y1t: yTop,
        z0: cutZ0, z1: cutZ1,
        cutZ0, cutZ1
      };
      if (o.sx > 0) blk.noseNear = true;
      // Werkstück-Drehung (Pfeilung): Block als starrer Körper um die Hochachse
      // drehen — SELBER Winkel/Pivot wie der Schnitt (pr.sweepRot), damit der
      // gedrehte Block die (bereits gedrehte) Schnittfläche umschließt. Die 8
      // Ecken werden in Cut-Koordinaten (x,z) gedreht und wie der G-Code auf
      // Maschinenkoordinaten gespiegelt (o.x − x). Reihenfolge = drawBlock().
      const rot = state.cfg.sweepRot && window.SweepRot ? App.projectCut(cut, s).sweepRot : null;
      if (rot) {
        const cRearR = teR + e.teR, cFrontR = leR - e.leR;
        const cRearT = teT + e.teT, cFrontT = leT - e.leT;
        const specs = [
          [cRearR, yBot, cutZ0], [cFrontR, yBot, cutZ0], [cRearR, yTop, cutZ0], [cFrontR, yTop, cutZ0],
          [cRearT, yBot, cutZ1], [cFrontT, yBot, cutZ1], [cRearT, yTop, cutZ1], [cFrontT, yTop, cutZ1]
        ];
        const dz = rot.dz || 0;
        blk.rot = {
          angleDeg: rot.angleDeg,
          corners: specs.map(([cx, cy, cz]) => {
            const p = SweepRot.rotXZ(cx, cz, rot.angleRad, rot.pivot.x, rot.pivot.z);
            return { x: mx(p.x), y: cy, z: p.z + dz };
          })
        };
        // Schnittflächen-Ebenen (Sim-Vorschau) mit verschieben, damit die
        // überstrichene Fläche im gedrehten Block liegt.
        blk.cutZ0 += dz; blk.cutZ1 += dz;
      }
      return blk;
    });
    return {
      machineWidth: state.cfg.machineWidth,
      ax: { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV },
      blocks, defaultSeg: App.activeIdx(),
      limits: App.machineLimits()
    };
  }

  /* Szene für „Blockzurichten": der Rohblock als Quader über die volle
     Maschinenbreite (Z), damit der Monitor im Reiter „Schneiden" das
     Blockprogramm mit passendem Körper simuliert. */
  function buildBlockScene() {
    const mw = state.cfg.machineWidth;
    const d1 = state.block.dist, d2 = d1 + state.block.length, H = App.blockH();   // Blockhöhe = Werkstoff
    return {
      machineWidth: mw,
      ax: { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV },
      blocks: [{ seg: 0, x0: d1, x1: d2, y0: 0, y1: H, x0t: d1, x1t: d2, y0t: 0, y1t: H, z0: 0, z1: mw, cutZ0: 0, cutZ1: mw }],
      defaultSeg: 0,
      limits: App.machineLimits()
    };
  }

  function buildGuillotineScene() {
    const mw = state.cfg.machineWidth, gp = state.guillotine, H = gp.height;
    const ang = (gp.angle || 0) * Math.PI / 180, xTop = gp.xDist + H * Math.tan(ang);
    const over = Math.abs(+gp.overY || 0), xEnd = gp.xDist - over * Math.tan(ang);
    const lo = Math.min(gp.xDist, xTop, xEnd) - 20, hi = Math.max(gp.xDist, xTop, xEnd) + 20;
    // Block der Szene = WERKSTOFF-Block (Höhe aus Reiter „Werkstoff"); die
    // Schnitthöhe der Guillotine wird als Hilfsebene eingezeichnet.
    const bh = App.blockH();
    const guides = [{ y: H, label: T('Schnitthöhe ') + H + ' mm', color: '#ffb454' }];
    return {
      machineWidth: mw,
      ax: { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV },
      blocks: [{ seg: 0, x0: lo, x1: hi, y0: 0, y1: bh, x0t: lo, x1t: hi, y0t: 0, y1t: bh, z0: 0, z1: mw, cutZ0: 0, cutZ1: mw, guides }],
      defaultSeg: 0,
      limits: App.machineLimits()
    };
  }

  function buildBlockHScene() {
    const mw = state.cfg.machineWidth, bp = state.blockH;
    const d1 = bp.dist, d2 = bp.dist + bp.length;
    const y1 = App.blockH();   // Block der Szene = WERKSTOFF-Block
    // Schnitthöhen als Hilfsebenen in der Simulation (gestrichelt + Maß ab Y0).
    const guides = [{ y: bp.yTop, label: T('Schnitthöhe yTop ') + bp.yTop + ' mm', color: '#ffb454' }];
    if (bp.mode === 'topbottom') guides.push({ y: bp.yBot, label: T('Schnitthöhe yBot ') + bp.yBot + ' mm', color: '#ffb454' });
    return {
      machineWidth: mw,
      ax: { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV },
      blocks: [{ seg: 0, x0: d1, x1: d2, y0: 0, y1, x0t: d1, x1t: d2, y0t: 0, y1t: y1, z0: 0, z1: mw, cutZ0: 0, cutZ1: mw, guides }],
      defaultSeg: 0,
      limits: App.machineLimits()
    };
  }
  function buildCalibScene() {
    const cb = state.calib, mw = state.cfg.machineWidth, n = Math.max(1, cb.count | 0);
    const totalH = n * cb.hgt + (n - 1) * (cb.gap || 0), x0 = cb.xDist || 20, x1 = x0 + cb.len, yBase = cb.yBase || 0;
    const y0 = Math.max(0, yBase - 15), y1 = yBase + totalH + 15, xa = x0 - 15, xb = x1 + 15;
    return {
      machineWidth: mw, ax: { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV },
      blocks: [{ seg: 0, x0: xa, x1: xb, y0, y1, x0t: xa, x1t: xb, y0t: y0, y1t: y1, z0: 0, z1: mw, cutZ0: 0, cutZ1: mw }],
      defaultSeg: 0, limits: App.machineLimits()
    };
  }
  // ---------- Negativschale: G-Code + Szene ---------------------------
  /* Baut die beiden turmsynchronen Schnittpfade (Wurzel/Rand) der Negativschale
   * des aktiven Segments samt Maschinenbezug. Der kerf wird symmetrisch nach
   * außen kompensiert (Kavität bleibt auf Nennmaß, wie beim Profilschnitt). */
  function negProjection(idxArg) {
    const idx = idxArg != null ? idxArg : App.activeIdx();
    const cut = App.wing.cuts[Math.min(idx, App.wing.cuts.length - 1)];
    // Quellprofile NUR aus dem Tragflächendesign (flipY zurückgerechnet) bzw. aus
    // dem Negativ-Override — kein Kerndesign-Einfluss. Siehe negRibPts().
    const rPts = App.negRibPts(cut, idx, 'root'), tPts = App.negRibPts(cut, idx, 'tip');
    const geom = { H: state.cfg.negBlockH, ovF: state.cfg.negOvF, ovR: state.cfg.negOvR, split: state.cfg.negSplit };
    // Blockmitte: für ALLE Segmente dieselbe (App.negBlockCy) — sonst liegt der
    // Nullpunkt (Werkstoff-Unterkante) je Segment anders und die geschnittenen
    // Schalen passen an den Segmentstößen nicht aufeinander.
    const blockCy = App.negBlockCy();
    // Kerne, die als EIN durchgehender Schnitt zwischen den Schalen integriert
    // werden (aus dem TE-Bereich angefahren, NICHT von außen durch den Block):
    //   1) optionaler Kern (negCore)
    //   2) optionaler Stützstoff (negSupport) = Profil um negSupportMM nach innen
    // Reihenfolge: erst der äußere (Stützstoff, näher an der Oberfläche), dann der
    // innere Kern — die kerf-Kompensation der Gesamtbahn gilt für beide.
    const coresR = [], coresT = [];
    // Stützstoff: 'surface' = zwei versetzte Flächen je Schale (Spalt + Dicke),
    // 'core' = Kernschnitt.
    const supSurf = state.cfg.negSupport && state.cfg.negSupportMode !== 'core';
    const supOffsets = supSurf ? App.negSupportOffsets() : [];
    if (state.cfg.negSupport && !supSurf) {
      const sm = state.cfg.negSupportMM || 0;
      coresR.push(App.negCoreContour(rPts, sm)); coresT.push(App.negCoreContour(tPts, sm));
    }
    let sheeting = 0, stR = null, stT = null;
    const stegeOn = state.cfg.negCore && App.stegeOn && App.stegeOn();
    if (state.cfg.negCore) {
      sheeting = state.cfg.negCoreSheeting || 0;
      const cR = App.negCoreContour(rPts, sheeting), cT = App.negCoreContour(tPts, sheeting);
      // Kern in Stege zerlegt (stege.js): Steg-Bahn statt Kern-Schlaufe, gleicher Schnitt.
      if (stegeOn) { stR = App.stegePieces(cR); stT = App.stegePieces(cT); }
      else { coresR.push(cR); coresT.push(cT); }
    }
    const root = App.negShell(rPts, App.negRibGeom(geom, blockCy, coresR, cut.root.chord, supOffsets, stR));
    const tip = App.negShell(tPts, App.negRibGeom(geom, blockCy, coresT, cut.tip.chord, supOffsets, stT));
    // Von Hand bearbeiteter Schnittverlauf (Punkte-Editor): ersetzt die Nennbahn.
    const negOv = state.negEdit[idx];
    if (negOv) { root.path = negOv.root.map(p => ({ x: p.x, y: p.y })); tip.path = negOv.tip.map(p => ({ x: p.x, y: p.y })); }
    // kerf je Rippe (innen/außen) wie bei den Kernen — außen geschwindigkeits-
    // abhängig. Symmetrischer Außenversatz; Punktzahl bleibt erhalten -> Türme sync.
    const kg = App.negKerf(root.path, tip.path, cut.root.chord, cut.tip.chord);
    let rp = App.negShellOffset(root.path, kg.gapR);
    let tp = App.negShellOffset(tip.path, kg.gapT);
    if (!negOv) {
      App.negSnapNoseApex(rp, tp, root, tip, kg);   // Nasen-Schlaufe der Kerne enthaken
      [rp, tp] = App.negDeloopSync(rp, tp);          // Rest-Selbstüberschneidungen wegstutzen
    }
    // Von Hand bearbeitete Abbrandlinie (Ziel „Schnittverlauf"): ersetzt die
    // fertige Drahtbahn direkt (nach dem Abbrand) — hat Vorrang vor der Kavität.
    const burnOv = state.negBurnEdit[idx];
    if (burnOv) { rp = burnOv.root.map(p => ({ x: p.x, y: p.y })); tp = burnOv.tip.map(p => ({ x: p.x, y: p.y })); }
    const mw = state.cfg.machineWidth, mirror = state.cfg.side === 'left';
    const bz = App.effBlockZ(cut.span);
    const zRoot = mirror ? mw - bz : bz;
    const zTip = mirror ? zRoot - cut.span : zRoot + cut.span;
    // Maschinennullpunkt: hinter dem Block (größtes X = Endleistenseite) und an
    // der Blockunterkante — analog zum Profilschnitt (blockOrigin).
    // Y-Bezug ist die WERKSTOFF-Unterkante (Reiter „Werkstoff": Höhe), nicht die
    // Unterkante des Negativblocks — der Formblock sitzt mittig im Werkstoff.
    const mat = App.negMatBlock(root);
    const ox = root.xBR + (state.cfg.blockX || 0);
    const oy = mat.yBot - (state.cfg.blockY || 0);
    const core = state.cfg.negCore ? { sheeting } : null;
    return { cut, geom, root, tip, rp, tp, core, mw, zRoot, zTip, ox, oy, idx, mat, stege: stegeOn ? stR : null };
  }
  /* 3D-Szene der Negativschale für die Simulation (ein waagrechter Block über der
   * Segment-Spannweite, Wurzel-/Randebene wie im G-Code). */
  function buildNegScene() {
    const P = negProjection();
    // Block der Szene = WERKSTOFF-Block (Höhe aus Reiter „Werkstoff"); der
    // Formblock samt Schalen sitzt mittig darin.
    const bh = P.mat.H;
    const y0 = (state.cfg.blockY || 0), y1 = y0 + bh;
    // Konstanter Schalenrand: die beiden planaren Vertikalschnitte (Nase/EL) auf
    // konstantem Überstand `se` — als Maschinen-X (fx = ox − Profil-X), innen an
    // der Wurzelebene (z0), außen an der Randebene (z1). Damit kann der Simulator
    // den Abstand vom Nullpunkt zu diesen Referenzschnitten bemaßen.
    // Schneideweg „ein Zug": kein Vorschnitt — die hintere Blockkante IST dann der
    // (echt geschnittene) Schalenrand -> normale Blockschnitt-Maße statt edge.
    const direct = !!(App.negDirectPath && App.negDirectPath());
    const se = direct ? 0 : (state.cfg.negShellEdge || 0);
    const edge = se > 0 ? {
      se,
      rearIn:   P.ox - (P.root.xT + se), rearOut:  P.ox - (P.tip.xT + se)   // Endleiste (hinten)
    } : null;
    return {
      machineWidth: P.mw,
      ax: { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV },
      blocks: [{
        seg: 0,
        x0: P.ox - P.root.xBR, x1: P.ox - P.root.xBL, y0, y1,
        x0t: P.ox - P.tip.xBR, x1t: P.ox - P.tip.xBL, y0t: y0, y1t: y1,
        z0: P.zRoot, z1: P.zTip, cutZ0: P.zRoot, cutZ1: P.zTip, edge, noBlockCut: !direct
      }],
      defaultSeg: 0,
      limits: App.machineLimits()
    };
  }


  // Zeilen (0-basiert) mit starkem PORTAL-Geschwindigkeitssprung finden: F ist die
  // (konstant gehaltene) Schnittspur-Geschwindigkeit — springen tut das schnellere
  // (äußere) Portal. Weicht dessen Geschwindigkeit um >= 10% vom Vorwert ab, ist
  // die Zeile markiert (Bahnknick / zu kurzes Segment -> Ruck am Portal).
  // Die Portal-Geschwindigkeiten stehen im Zeilenkommentar „Portal …=v …=v".
  const FEED_JUMP_FRAC = 0.10;
  function feedJumpLines(text) {
    const warn = new Set();
    let prev = null;
    text.split('\n').forEach((ln, i) => {
      const m = ln.match(/Portal\s+\S+?=(\d+(?:\.\d+)?)\s+\S+?=(\d+(?:\.\d+)?)/);
      if (!m) return;
      const v = Math.max(parseFloat(m[1]), parseFloat(m[2]));   // äußeres Portal
      if (prev != null && prev > 0 && Math.abs(v - prev) / prev >= FEED_JUMP_FRAC) warn.add(i);
      prev = v;
    });
    return warn;
  }
  // ---- Demo-Sperren ---------------------------------------------------------
  // In der Demo (window.DEMO, vom Server gesetzt) darf geschnitten, aber nicht
  // gespeichert oder kopiert werden; die Anzeige zeigt den G-Code nur angedeutet.
  // Der echte Text bleibt in state.lastGcode — die Maschine bekommt ihn ganz.
  function demoOn() { return !!(window.DEMO && window.DEMO.on); }

  // Knöpfe, die in der Demo nichts tun dürfen, gleich sichtbar sperren.
  function applyDemoUi() {
    const noSave = !!(App.demoNoSave && App.demoNoSave());   // Kern-Demo aus dem Build-Tool
    if (!demoOn() && !noSave) return;
    const txt = T('In der Demo nicht verfügbar — Schneiden ist möglich.');
    ['btnDlGcode', 'btnCopy', 'btnEditGcode', 'btnDlBlock', 'btnCopyBlock'].forEach(id => {
      const b = document.getElementById(id);
      if (!b) return;
      b.disabled = true;
      b.title = txt;
      b.style.opacity = '.5';
      b.style.cursor = 'not-allowed';
    });
  }

  // Zahlenwerte durch Blöcke ersetzen, Kommentare abschneiden. Struktur bleibt
  // sichtbar (man sieht, dass ein Programm da ist), die Bahn aber nicht.
  function maskGcodeLine(ln) {
    if (/^\s*;/.test(ln)) return ln;                      // reine Kommentarzeilen
    const code = ln.split(';')[0].replace(/\s+$/, '');
    const masked = code.replace(/([XYZUVABCIJKRFSPQ])\s*-?\d*\.?\d+/gi, '$1▪▪▪▪');
    return masked + (ln.indexOf(';') >= 0 ? ' ; …' : '');
  }

  // Eine G-Code-Anzeige für die Demo absichern: nicht markierbar, kein
  // Kontextmenü, und ein Hinweis als ::before-Regel.
  // WICHTIG als Regel und nicht als Element: die Zeilen werden anderswo über
  // ihren Kindindex angesprochen (sim3d.js seekToLine, grbl.js/fraese.js
  // highlightProgLine) — ein Zusatzkind würde die Zuordnung verschieben.
  function demoMaskView(el, selector) {
    if (!el) return false;
    el.style.userSelect = 'none';
    el.style.webkitUserSelect = 'none';
    el.oncopy = ev => ev.preventDefault();
    el.oncontextmenu = ev => ev.preventDefault();
    const id = 'demoHint_' + selector.replace(/[^a-z0-9]/gi, '');
    if (!document.getElementById(id)) {
      const st = document.createElement('style');
      st.id = id;
      const txt = T('Demo: Die Zahlenwerte sind ausgeblendet — Schneiden ist möglich, '
        + 'Speichern und Kopieren nicht.').replace(/["\\]/g, '\\$&');
      st.textContent = selector + ':not(:empty)::before{content:"' + txt + '";display:block;'
        + 'padding:4px 12px;color:#fbbf24;background:#1f2937;position:sticky;top:0;z-index:1}';
      document.head.appendChild(st);
    }
    return true;
  }

  // G-Code als zeilenweise, hervorhebbare Ansicht setzen (statt <textarea>).
  // warnLines = Menge 0-basierter Zeilennummern, die als Warnung markiert werden.
  function setGcode(text, warnLines) {
    const el = document.getElementById('gcodeText');
    if (!el) return;
    const demo = demoOn();
    if (demo) demoMaskView(el, '#gcodeText');
    const warn = warnLines instanceof Set ? warnLines : new Set(warnLines || []);
    const frag = document.createDocumentFragment();
    text.split('\n').forEach((ln, i) => {
      const d = document.createElement('div');
      d.className = warn.has(i) ? 'gln warn' : 'gln';
      d.dataset.n = i + 1;
      const shown = demo ? maskGcodeLine(ln) : ln;
      d.textContent = shown.length ? shown : ' ';
      // Klick auf eine Zeile setzt den Simulator an den Beginn dieser Bewegung.
      d.onclick = () => { if (window.Sim3D && Sim3D.seekToLine) Sim3D.seekToLine(i); };
      frag.appendChild(d);
    });
    el.replaceChildren(frag);
  }

  // ---- Handische G-Code-Bearbeitung (im Reiter „G-Code") -------------------
  // Der automatisch erzeugte G-Code kann bei Bedarf von Hand angepasst werden.
  // Beim Übernehmen wird state.lastGcode.text ersetzt (einzige Quelle für
  // Download, Zwischenablage, 3D-Sim und die Schneiden-Quelle) und der
  // Bearbeitungs-Sperrschalter state.gcodeEdited gesetzt, damit autoGen() die
  // Handänderungen nicht bei der nächsten Neuberechnung überschreibt.
  function setGcodeEditMode(on) {
    const view = document.getElementById('gcodeText');
    const ta = document.getElementById('gcodeEdit');
    const bEdit = document.getElementById('btnEditGcode');
    const bApply = document.getElementById('btnEditApply');
    const bCancel = document.getElementById('btnEditCancel');
    if (!view || !ta) return;
    // In der Demo bliebe der G-Code im Textfeld markierbar - deshalb gesperrt.
    if (on && demoOn()) {
      toast(T('Das Bearbeiten des G-Codes ist in der Demo nicht möglich.'));
      return;
    }
    if (on) {
      ta.value = (state.lastGcode && state.lastGcode.text) || '';
      view.style.display = 'none'; ta.style.display = '';
      if (bEdit) bEdit.style.display = 'none';
      if (bApply) bApply.style.display = '';
      if (bCancel) bCancel.style.display = '';
      ta.focus();
    } else {
      ta.style.display = 'none'; view.style.display = '';
      if (bEdit) bEdit.style.display = '';
      if (bApply) bApply.style.display = 'none';
      if (bCancel) bCancel.style.display = 'none';
    }
  }
  function applyGcodeEdit() {
    const ta = document.getElementById('gcodeEdit');
    if (!ta) return;
    const text = ta.value;
    const lines = text.split('\n').length;
    // Kennzahlen (Schnittlänge/Zeit) lassen sich nach Handänderung nicht mehr
    // sicher zuordnen -> aus dem letzten Stand übernehmen, Zeilenzahl neu.
    const prev = state.lastGcode || {};
    state.lastGcode = { text, cutLengthFoam: prev.cutLengthFoam || 0, estMinutes: prev.estMinutes || 0, lines };
    state.gcodeEdited = true;
    const warnLines = feedJumpLines(text);
    setGcode(text, warnLines);
    const info = document.getElementById('gInfo');
    if (info) info.textContent = `${lines}${T(' Zeilen · ')}${T('von Hand bearbeitet')}`
      + (warnLines.size ? ` · ⚠ ${warnLines.size} ${warnLines.size > 1 ? T('Portal-Sprünge') : T('Portal-Sprung')} (≥10%)` : '');
    Sim3D.load(text, sceneForSource());
    setGcodeEditMode(false);
  }

  // ---- Kennzeichnung: welche Tragfläche, welches Segment, welche Seite ist aktiv ----
  // Gemeinsame Beschriftung für den Simulator (Reiter „G-Code") und den Monitor
  // (Reiter „Schneiden"), abhängig von der G-Code-Quelle. Seite (rechte/linke
  // Tragfläche) nur bei Kern/Negativschale — dort entscheidet sie die Spiegelung.
  function cutContextLabel(src) {
    const s = src || state.cfg.gcodeSource;
    const wn = App.wingName ? App.wingName() : '';
    const side = T(state.cfg.side === 'left' ? 'Linke Tragfläche' : 'Rechte Tragfläche');
    try {
      if (s === 'model' && window.Model3D && Model3D.hasModel()) {
        const c = App.mgCfg ? App.mgCfg() : null;
        return T('3D-Modell') + ' · ' + T('Segment ') + ((c ? c.seg : 0) + 1);
      }
      if (s === 'plate') return T('3D-Modell Platte');
      if (s === 'schrift' && window.Schrift) return Schrift.label();
      if (s === 'dxf') {
        const d = state.dxf; const n = App.dxfSegCount ? App.dxfSegCount() : 1;
        return T('DXF-Form') + ' · ' + T('Segment ') + ((d && d.activeSeg || 0) + 1) + ' / ' + n;
      }
    } catch (e) { /* Kennzeichnung ist nur Anzeige */ }
    const nseg = state.segments.length;
    const seg = T('Segment ') + (App.activeIdx() + 1) + ' / ' + nseg;
    return (s === 'neg' ? T('Negativschale') : T('Tragfläche')) + ' „' + wn + '" · ' + seg + ' · ' + side;
  }
  function updateSimContext() {
    const el = document.getElementById('simCtx');
    if (el) el.textContent = cutContextLabel();
  }
  // ---- 3D-Szene passend zur gewählten G-Code-Quelle (auch ohne Erzeugung) ----
  // Bei geladenen Dateien und nach Handbearbeitung: Block der Quelle (Tragfläche,
  // Negativschale, DXF-Form, 3D-Modell-Segment/Platte) um das Programm herum zeigen.
  function sceneForSource() {
    const s = state.cfg.gcodeSource;
    try {
      if (s === 'dxf' && App.buildDxfScene) return App.buildDxfScene();
      if (s === 'schrift' && App.buildSchriftScene) return App.buildSchriftScene();
      if (s === 'neg') return buildNegScene();
      if (s === 'model' && window.Model3D && Model3D.hasModel() && Model3D.buildSegmentPaths && App.buildModelScene) {
        const c = App.mgCfg(); const r = Model3D.ensureSegments() ? Model3D.buildSegmentPaths(c.seg, App.mgOpt()) : null;
        return App.buildModelScene(r);
      }
      if (s === 'plate' && window.Model3D && Model3D.buildPlatePaths && App.platePlacements && App.buildPlateScene) {
        const pls = App.platePlacements();
        const r = pls.length ? Model3D.buildPlatePaths(pls, Object.assign({}, App.mgOpt(),
          { plateConnEdits: App.plateCfg().connEdits, plateGap: Math.min(App.plateCfg().gapH, App.plateCfg().gapV) })) : null;
        return App.buildPlateScene(r);
      }
    } catch (e) { /* Szene ist nur Kulisse — im Zweifel Tragflächenblock */ }
    return buildScene();
  }
  // ---- G-Code-Datei laden (Reiter „G-Code") ----
  // Zeigt eine fertige Datei in Liste + 3D-Simulation (Maschinengrenzen werden
  // geprüft). In Ausgaben ohne G-Code-Erzeugung der einzige Weg zu einem Programm;
  // mit Erzeugung bleibt die Datei stehen, bis „↻ Neu erzeugen" gedrückt wird
  // (state.gcodeEdited sperrt autoGen wie bei der Handbearbeitung).
  function loadGcodeText(text, name) {
    text = String(text || '').replace(/\r\n?/g, '\n');
    const lines = text.split('\n').length;
    state.lastGcode = { text, cutLengthFoam: 0, estMinutes: 0, lines, file: name || '' };
    state.gcodeEdited = true;
    const warnLines = feedJumpLines(text);
    setGcode(text, warnLines);
    const info = document.getElementById('gInfo');
    if (info) info.textContent = (name ? name + ' · ' : '') + lines + T(' Zeilen · ') + T('geladene Datei')
      + (App.autoGen ? T(' — „↻ Neu erzeugen" kehrt zu den Parametern zurück.') : '')
      + (warnLines.size ? ` · ⚠ ${warnLines.size} ${warnLines.size > 1 ? T('Portal-Sprünge') : T('Portal-Sprung')} (≥10%)` : '');
    if (window.Sim3D) Sim3D.load(text, sceneForSource());
    setGcodeEditMode(false);
    toast(T('G-Code geladen: ') + (name || '') + ' (' + lines + T(' Zeilen') + ')');
  }
  // Ohne G-Code-Erzeugung: render() ruft dies statt autoGen() — die geladene Datei
  // bleibt, nur die Szene (Block/Quelle) folgt den Parametern.
  let sceneKey = '';
  function gcodeSceneRefresh() {
    if (!window.Sim3D) return;
    let sc; try { sc = sceneForSource(); } catch (e) { return; }
    // Geladene Datei: nur die Szene (Block) nachziehen.
    if (state.lastGcode && state.lastGcode.text) {
      const key = 'file|' + JSON.stringify(sc);
      if (key === sceneKey) return;         // nichts geändert -> Simulation nicht zurücksetzen
      sceneKey = key;
      Sim3D.load(state.lastGcode.text, sc);
      return;
    }
    // Sonst Bahnvorschau aus der Projektion (pathpreview.js): Kontur + Anfahrt,
    // ohne Programmtext — der Simulator läuft damit auch ohne G-Code-Erzeugung.
    if (!App.pathPreviewMoves || !Sim3D.loadMoves) return;
    const pv = App.pathPreviewMoves();
    const info = document.getElementById('gInfo');
    if (!pv || !pv.moves.length) {
      const key = 'none|' + state.cfg.gcodeSource;
      if (key !== sceneKey) { sceneKey = key; Sim3D.loadMoves([], sc); setGcode('', new Set()); }
      if (info) info.textContent = T('Keine Bahnvorschau für diese Quelle — G-Code-Datei laden oder Quelle wechseln.');
      return;
    }
    const key = 'pv|' + JSON.stringify([pv.moves, sc]);
    if (key === sceneKey) return;
    sceneKey = key;
    Sim3D.loadMoves(pv.moves, sc);
    const cut = pv.moves.filter(m => !m.rapid).length;
    setGcode([T('; Bahnvorschau — kein Maschinenprogramm'),
      '; ' + T('Quelle: ') + pv.label + ' · ' + cut + T(' Schnittbewegungen'),
      '; ' + T('Diese Ausgabe erzeugt keinen G-Code. Die Simulation zeigt die Schnittkontur mit Anfahrt über die Sicherheitshöhe.'),
      '; ' + T('Ein fertiges Programm lässt sich mit „G-Code laden…" abspielen.')].join('\n'), new Set());
    if (info) info.textContent = T('Bahnvorschau: ') + pv.label + ' · ' + pv.moves.length + T(' Bewegungen · kein Maschinenprogramm');
  }
  // Fragt einen eigenen Dateinamen ab (ohne Endung eingeben; Endung wird
  // aus dem Vorschlag übernommen). Rückgabe: fertiger Name inkl. Endung, oder
  // null bei Abbruch. So lassen sich Projekte/Einstellungen frei benennen,
  // auch ohne File-System-Access-Dialog (Fallback-Download).
  // Liefert ein Promise mit dem Namen inkl. Endung, oder null bei Abbruch
  // (App.askText statt window.prompt — letzteres gibt es in Electron nicht).
  function promptFileName(suggested) {
    const m = suggested.match(/^(.*?)(\.[^.]+)?$/);
    const base = (m && m[1]) || suggested, ext = (m && m[2]) || '';
    return App.askText(T('Name für die Datei (ohne Endung):'), base).then(inp => {
      if (inp == null) return null;                     // Abbruch
      let nm = inp.trim();
      if (!nm) nm = base;                               // leer -> Standardname
      nm = nm.replace(/[\\/:*?"<>|]/g, '_');            // ungültige Zeichen ersetzen
      if (ext && !nm.toLowerCase().endsWith(ext.toLowerCase())) nm += ext;
      return nm;
    });
  }
  // Speichern mit vorgeschaltetem Namensdialog. Bei Abbruch passiert nichts.
  function downloadNamed(name, text, mime, which) {
    return promptFileName(name).then(nm => {
      if (nm == null) return;
      download(nm, text, mime, which);
    });
  }
  // ---------- Achsnamen-Abfrage beim G-Code-Export ----------
  // Vor dem Speichern eines Heißdraht-Programms: vier Eingabefelder (links
  // horiz./vert., rechts horiz./vert.). Die Zuordnung gilt NUR für die
  // exportierte Datei — state.cfg (Maschinen-Einstellungen) bleibt unberührt.
  // Vorbelegt mit der zuletzt exportierten Zuordnung (eigener localStorage-
  // Schlüssel), sonst mit den Maschinen-Achsnamen.
  // Rückgabe: Promise mit { x, y, u, v } oder null bei Abbruch.
  // Reserviert: Buchstaben, die der G-Code selbst als Befehls-/Parameterwort nutzt.
  const AX_RESERVED = 'FGMNOPST';
  const AX_EXPORT_KEY = 'gcodeExportAxes';
  function askAxisNames() {
    const cf = state.cfg;
    let c = { axX: cf.axX, axY: cf.axY, axU: cf.axU, axV: cf.axV };
    try {
      const s = JSON.parse(localStorage.getItem(AX_EXPORT_KEY) || 'null');
      if (s && ['x', 'y', 'u', 'v'].every(k => /^[A-Z]$/.test(s[k]))) c = { axX: s.x, axY: s.y, axU: s.u, axV: s.v };
    } catch (e) {}
    return new Promise(resolve => {
      const back = document.createElement('div');
      back.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.55);' +
        'display:flex;align-items:center;justify-content:center';
      const box = document.createElement('div');
      box.style.cssText = 'min-width:340px;max-width:min(92vw,460px);background:var(--panel);' +
        'border:1px solid var(--line);border-radius:8px;padding:14px 16px;' +
        'box-shadow:0 10px 40px rgba(0,0,0,.5)';
      const head = document.createElement('div');
      head.textContent = T('Achsnamen für den G-Code');
      head.style.cssText = 'margin-bottom:4px;color:var(--txt);font-weight:600';
      const sub = document.createElement('div');
      sub.textContent = T('Buchstaben frei wählbar — gilt nur für die exportierte Datei, die Maschinen-Einstellungen bleiben unverändert.');
      sub.style.cssText = 'margin-bottom:10px;color:var(--mut, #8a96a3);font-size:12px';
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:auto 1fr 1fr;gap:6px 10px;align-items:center';
      const cell = (txt, css) => { const d = document.createElement('div'); d.textContent = txt; d.style.cssText = css || ''; grid.appendChild(d); return d; };
      const colCss = 'text-align:center;color:var(--mut, #8a96a3);font-size:12px';
      cell(''); cell(T('horizontal'), colCss); cell(T('vertikal'), colCss);
      const mkInp = val => {
        const i = document.createElement('input');
        i.type = 'text'; i.maxLength = 1; i.value = String(val || '').toUpperCase();
        i.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 8px;border-radius:5px;text-align:center;' +
          'border:1px solid var(--line);background:var(--panel2);color:var(--txt);font:inherit;font-weight:600;text-transform:uppercase';
        i.onfocus = () => i.select();
        i.oninput = () => { i.value = i.value.replace(/[^a-z]/gi, '').toUpperCase(); check(); };
        grid.appendChild(i); return i;
      };
      cell(T('Portal links'));
      const iX = mkInp(c.axX), iY = mkInp(c.axY);
      cell(T('Portal rechts'));
      const iU = mkInp(c.axU), iV = mkInp(c.axV);
      const inps = [iX, iY, iU, iV];
      const err = document.createElement('div');
      err.style.cssText = 'min-height:16px;margin-top:8px;color:#e0785a;font-size:12px';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:8px';
      const no = document.createElement('button'); no.textContent = T('Abbrechen');
      const ok = document.createElement('button'); ok.textContent = T('Exportieren');
      row.appendChild(no); row.appendChild(ok);
      box.appendChild(head); box.appendChild(sub); box.appendChild(grid); box.appendChild(err); box.appendChild(row);
      back.appendChild(box);

      function check() {
        const v = inps.map(i => i.value);
        let msg = '';
        if (v.some(s => !/^[A-Z]$/.test(s))) msg = T('Bitte in jedes Feld genau einen Buchstaben eintragen.');
        else if (new Set(v).size !== 4) msg = T('Jeder Achsname darf nur einmal vorkommen.');
        else { const r = v.find(s => AX_RESERVED.includes(s)); if (r) msg = r + T(' ist im G-Code reserviert (F, G, M, N, O, P, S, T nicht erlaubt).'); }
        err.textContent = msg; ok.disabled = !!msg;
        inps.forEach(i => { i.style.borderColor = (!/^[A-Z]$/.test(i.value) || v.filter(s => s === i.value).length > 1 || AX_RESERVED.includes(i.value)) && msg ? '#e0785a' : ''; });
        return !msg;
      }
      let done = false;
      function close(val) {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        back.remove();
        resolve(val);
      }
      const accept = () => { if (check()) close({ x: iX.value, y: iY.value, u: iU.value, v: iV.value }); };
      function onKey(ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); close(null); }
        else if (ev.key === 'Enter') { ev.preventDefault(); accept(); }
      }
      ok.onclick = accept;
      no.onclick = () => close(null);
      back.addEventListener('mousedown', ev => { if (ev.target === back) close(null); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(back);
      check();
      iX.focus();
    });
  }
  // Achswörter in fertigem G-Code umbenennen (für den Export mit eigener
  // Achszuordnung). Kommentare (; … und ( … )) bleiben
  // unberührt; alle vier Buchstaben werden gleichzeitig getauscht (X<->Z geht).
  function remapAxisWords(text, from, to) {
    const map = {};
    from.forEach((f, k) => { map[String(f).toUpperCase()] = to[k]; });
    const re = new RegExp('(^|[^A-Za-z])([' + from.map(f => String(f).toUpperCase()).join('') + '])(?=\\s*[-+.\\d])', 'gi');
    return String(text).split('\n').map(line => {
      let out = '', i = 0;
      while (i < line.length) {
        const s = line.indexOf(';', i), p = line.indexOf('(', i);
        const cut = [s, p].filter(n => n >= 0);
        const j = cut.length ? Math.min(...cut) : line.length;
        out += line.slice(i, j).replace(re, (m, pre, l) => pre + (map[l.toUpperCase()] || l));
        if (j >= line.length) break;
        if (line[j] === ';') { out += line.slice(j); break; }
        const e = line.indexOf(')', j);
        const k = e < 0 ? line.length : e + 1;
        out += line.slice(j, k); i = k;
      }
      return out;
    }).join('\n');
  }
  // Export-Ablauf für Heißdraht-G-Code: Achsnamen abfragen und NUR im
  // exportierten Text umbenennen, dann speichern. Maschinen-Einstellungen,
  // G-Code-Anzeige und Simulation bleiben bei den Maschinen-Achsnamen.
  //   getText() liefert den (mit den Maschinen-Achsnamen erzeugten) Text
  function exportGcodeAxes(name, getText) {
    // Demo: gleich an download() — dort kommt der Sperr-Hinweis, kein Dialog.
    if ((App.demoSaveBlocked && App.demoSaveBlocked()) || demoOn()) { download(name, getText(), 'text/plain', 'svGcode'); return; }
    const c = state.cfg;
    const old = [c.axX, c.axY, c.axU, c.axV].map(s => String(s || '').toUpperCase());
    askAxisNames().then(ax => {
      if (!ax) return;
      const neu = [ax.x, ax.y, ax.u, ax.v];
      try { localStorage.setItem(AX_EXPORT_KEY, JSON.stringify(ax)); } catch (e) {}
      let text = getText();
      if (neu.some((s, k) => s !== old[k])) {
        text = remapAxisWords(text, old, neu);
        // Kopfkommentar „; Achsen: L=XY  R=ZA" passend mitziehen.
        const m = {}; old.forEach((o, k) => { m[o] = neu[k]; });
        const sw = s => s.replace(/[A-Z]/g, l => m[l] || l);
        text = text.replace(/^(;\s*(?:Achsen|Axes): L=)([A-Z]{2})(\s+R=)([A-Z]{2})/m, (x, a, l, b, r) => a + sw(l) + b + sw(r));
      }
      download(name, text, 'text/plain', 'svGcode');
    });
  }
  // Dateiendungen, die ein Maschinenprogramm enthalten - in der Demo gesperrt.
  const PROG_EXT = /\.(gcode|nc|ngc|tap|cnc|iso|mpf)$/i;
  async function download(name, text, mime, which) {
    // Kern-Demo / Design-Ausgabe: kein Export (in der Design-Ausgabe wäre nur
    // 'svProject' erlaubt — G-Code/DXF/STL laufen hier nie als Projekt).
    if (App.demoSaveBlocked && App.demoSaveBlocked(which)) return;
    if (demoOn() && (PROG_EXT.test(name) || which === 'svGcode')) {
      toast(T('In der Demo lässt sich das Maschinenprogramm nicht speichern. '
        + 'Schneiden ist möglich.'));
      return;
    }
    if (App.FS_SUPPORTED) {
      // IMMER der Windows-Explorer-Speichern-Dialog (Ordnerpfad UND Name frei
      // wählbar); der in den Einstellungen gewählte Ordner ist nur der Startordner.
      // Ohne festen Ordner: einmalige Erinnerung, einen anzulegen.
      if (App.dirReminder && App.dirReminder(which)) return;
      try { await saveFilePicker(name, text, mime, which); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }   // Abbruch: nichts tun
    }
    // 3) Ohne File System Access API: normaler Download als letzter Ausweg.
    App.anchorDownload(name, text, mime);
  }
  async function saveFilePicker(name, text, mime, which) {
    // Letzter gemeinsamer Schreibweg (auch für exportViaPicker) — Kern-/Design-
    // Sperre hier abfangen, damit kein Modul am Schloss vorbeikommt. In der
    // Design-Ausgabe lässt demoSaveBlocked genau which==='svProject' durch.
    if (App.demoSaveBlocked && App.demoSaveBlocked(which)) return null;
    const ext = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    // Startordner: zuletzt für dieses Dateiformat benutzter Ordner (Picker-id),
    // beim ersten Mal der Einstellungsordner des Typs.
    const base = Object.assign({ suggestedName: name }, App.pickerOpts ? App.pickerOpts(which, ext) : { startIn: 'documents' });
    // Typ-Filter setzen — manche Browser lehnen ungewöhnliche MIME-Typen (z. B.
    // „model/stl") ab und werfen einen TypeError. Dann OHNE Filter erneut
    // versuchen, damit trotzdem der gewohnte Windows-Explorer-Dialog erscheint
    // (statt still auf einen normalen Download zurückzufallen).
    let fh;
    try {
      const opts = Object.assign({}, base);
      if (ext) opts.types = [{ description: T('Datei ') + ext, accept: { [mime || 'application/octet-stream']: [ext] } }];
      fh = await window.showSaveFilePicker(opts);
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      fh = await window.showSaveFilePicker(base);   // ohne Typ-Filter
    }
    if (App.markDirUsed) App.markDirUsed(which, ext);
    const w = await fh.createWritable(); await w.write(text); await w.close();
    toast('Gespeichert: ' + fh.name);
    return fh;
  }
  // Kurze Statusmeldung oben in der Kopfzeile.
  let toastT = 0;
  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);background:var(--panel2);border:1px solid var(--accent);color:var(--txt);padding:7px 14px;border-radius:7px;z-index:100;font-size:12px;box-shadow:0 4px 16px rgba(0,0,0,.4)'; document.body.appendChild(el); }
    el.textContent = msg; el.style.display = 'block';
    clearTimeout(toastT); toastT = setTimeout(() => { el.style.display = 'none'; }, 2200);
  }

  /* Lade-Overlay mit unbestimmtem Fortschrittsbalken: zeigt, dass eine (blockierende)
   * Operation läuft. busy(label) -> Handle { setLabel, close }. Für synchrone, die
   * UI blockierende Arbeit withBusy() benutzen (blendet ein, LÄSST DEN BROWSER ZEICHNEN
   * und startet erst danach die Arbeit). */
  function busy(label) {
    if (!document.getElementById('busyKf')) {
      const st = document.createElement('style'); st.id = 'busyKf';
      st.textContent = '@keyframes busySlide{0%{left:-40%}100%{left:100%}}';
      document.head.appendChild(st);
    }
    let ov = document.getElementById('busyOv');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'busyOv';
      ov.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35)';
      const card = document.createElement('div');
      card.style.cssText = 'min-width:260px;max-width:80vw;background:var(--panel2);border:1px solid var(--accent);color:var(--txt);border-radius:9px;padding:16px 18px;box-shadow:0 8px 28px rgba(0,0,0,.5);font-size:13px';
      const lab = document.createElement('div'); lab.id = 'busyLab'; lab.style.cssText = 'margin-bottom:10px;text-align:center';
      const track = document.createElement('div'); track.style.cssText = 'position:relative;height:8px;border-radius:5px;background:var(--panel);overflow:hidden';
      const bar = document.createElement('div'); bar.style.cssText = 'position:absolute;top:0;bottom:0;width:40%;border-radius:5px;background:var(--accent);animation:busySlide 1.1s linear infinite';
      track.appendChild(bar); card.appendChild(lab); card.appendChild(track); ov.appendChild(card); document.body.appendChild(ov);
    }
    ov.querySelector('#busyLab').textContent = label || T('Bitte warten…');
    ov.style.display = 'flex';
    return { setLabel: t => { const l = ov.querySelector('#busyLab'); if (l) l.textContent = t; }, close: () => { ov.style.display = 'none'; } };
  }
  // Overlay zeigen, EINEN Frame zeichnen lassen, dann fn() (sync oder async) ausführen; danach schließen.
  async function withBusy(label, fn) {
    const h = busy(label);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try { return await fn(); }
    finally { h.close(); }
  }


  // ---- Registry: eigene Top-Level-Namen bereitstellen ----
  Object.assign(App, { cutContextLabel, updateSimContext, FEED_JUMP_FRAC, applyGcodeEdit, blockCenterY, blockCutGeom, blockOrigin, blockRearX });
  Object.assign(App, { blockFrontX, cutFront, machX });
  Object.assign(App, { buildBlockHScene, buildBlockScene, buildCalibScene, buildGuillotineScene, buildNegScene, buildScene });
  Object.assign(App, { applyDemoUi, demoMaskView, demoOn, download, downloadNamed, feedJumpLines, maskGcodeLine, negProjection, outsideFeed });
  Object.assign(App, { askAxisNames, exportGcodeAxes, remapAxisWords });
  Object.assign(App, { busy, promptFileName, safeHeight, saveFilePicker, setGcode, setGcodeEditMode, shellCutGeom, sweepProj2, toast, withBusy });
  Object.assign(App, { gcodeSceneRefresh, loadGcodeText, sceneForSource });
  Object.defineProperty(App, 'toastT', { get: () => toastT, set: v => { toastT = v; }, enumerable: true, configurable: true });
})();
