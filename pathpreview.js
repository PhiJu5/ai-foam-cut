/* pathpreview.js — Bahnvorschau für die 3D-Simulation OHNE G-Code (Kern).
 *
 * In Ausgaben ohne die Funktion „G-Code-Erzeugung" (gcodegen.js, Design-Ausgabe)
 * bekommt der Simulator im Reiter „G-Code" die Drahtbahn direkt als Bewegungs-
 * liste: Kontur aus der jeweiligen Projektion (Kerndesign: HotWire.project,
 * Negativschale: negProjection, DXF-Formen: dxfProjection, 3D-Modell: die
 * Bewegungsdaten aus model3d.js).
 *
 * Der KERN-Ablauf (previewCore) bildet den echten Schnittablauf nach: Blockschnitt
 * vorne/hinten (App.blockCutGeom), Schnittreihenfolge (state.cfg.cutOrder), Schalen-
 * Trennschnitte (App.shellCutGeom) und die dazu passende Anfahrt — dieselben
 * Geometrie-Helfer wie der G-Code-Schreiber, die im Kern (gcode.js) liegen und
 * daher auch in der Design-exe vorhanden sind. Nicht nachgebildet werden nur die
 * reinen Programm-Nachläufe der Vollversion (Holmtaschen, Pausen/M0, Aufheizen,
 * Vorschub-Feinrechnung je Portal, G93, Wasserzeichen). Negativschale/DXF/3D-Modell
 * bleiben eine vereinfachte Kontur-Anfahrt vom Nullpunkt über die Sicherheitshöhe.
 *
 * Mit G-Code-Erzeugung im Build wird diese Datei nicht benutzt (autoGen hat Vorrang).
 * Aufruf: App.pathPreviewMoves() -> { moves:[{from,to,rapid,feed}], label } | null
 * Koordinaten wie im G-Code: Maschinen-X = Nullpunkt.x − x, Maschinen-Y = y − Nullpunkt.y. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;

  // Bewegungsliste aus Turmbahnen (links/rechts, Maschinenkoordinaten) und Sicherheitshöhe.
  function movesFromTowers(L, R, safeY, feed) {
    if (!L || !R || L.length < 2) return [];
    const n = Math.min(L.length, R.length);
    const mv = [], P = (lx, ly, rx, ry) => ({ lx, ly, rx, ry });
    let cur = P(0, 0, 0, 0);
    const go = (to, rapid) => { mv.push({ from: cur, to, rapid: !!rapid, feed: rapid ? 0 : feed }); cur = to; };
    go(P(0, safeY, 0, safeY), true);                          // hoch auf Sicherheitshöhe
    go(P(L[0].x, safeY, R[0].x, safeY), true);                // über den Startpunkt
    go(P(L[0].x, L[0].y, R[0].x, R[0].y), false);             // eintauchen
    for (let i = 1; i < n; i++) go(P(L[i].x, L[i].y, R[i].x, R[i].y), false);
    go(P(cur.lx, safeY, cur.rx, safeY), false);               // ausfahren nach oben
    go(P(0, safeY, 0, safeY), true);                          // zurück
    go(P(0, 0, 0, 0), true);
    return mv;
  }
  const toMachine = (pts, ox, oy) => pts.map(p => ({ x: ox - p.x, y: p.y - oy }));

  // Kerndesign (Profilschnitt des aktiven Segments). Bildet den ECHTEN Ablauf des
  // Kern-G-Codes nach (hotwire_gcode.js): Blockschnitt (vorne/hinten, kerf-kompen-
  // siert via App.blockCutGeom), Schnittreihenfolge (state.cfg.cutOrder: none/before/
  // after/wrap/only), Schalen-Trennschnitte (App.shellCutGeom) und die passende
  // Anfahrt (horizontal von hinten bzw. über den Blockschnitt). Die Geometrie-Helfer
  // liegen im Kern (gcode.js) und sind daher auch in der Design-Ausgabe vorhanden —
  // nur die G-Code-TEXTerzeugung (gcodegen) fehlt. Holmtaschen und gestapelte Kopien
  // werden hier bewusst NICHT nachgebildet (nur der sichtbare Grobablauf).
  function previewCore() {
    const cut = App.activeCut(), idx = App.activeIdx(), seg = state.segments[idx];
    if (!cut || !seg) return null;
    const proj = App.projectCut(cut, seg), o = App.blockOrigin(cut, seg);
    let L = proj.left, R = proj.right;
    if (!L || !R || L.length < 2) return null;
    // „Von vorne" oder nur eine Profilseite: Zug-Ablauf (wie emitPasses im G-Code-Schreiber).
    const oneSide = state.cfg.cutSides === 'top' || state.cfg.cutSides === 'bottom';
    if ((o.sx > 0 || (oneSide && state.cfg.cutOrder !== 'only')) && window.HotWire && HotWire.cutPasses) return previewCoreFront(cut, seg, proj, o);
    // Profilrichtung „Unterseite zuerst": dieselbe Umkehr wie im G-Code-Schreiber.
    if (state.cfg.profileDir === 'bottom' && L.length > 2) {
      const nn = L.length;
      const cl = Math.abs(L[0].x - L[nn-1].x) < 1e-6 && Math.abs(L[0].y - L[nn-1].y) < 1e-6;
      const perm = [];
      if (cl) { for (let k = nn - 2; k >= 0; k--) perm.push(k); perm.push(nn - 2); }
      else    { for (let k = nn - 1; k >= 0; k--) perm.push(k); }
      const pm = a => perm.map(i => ({ x: a[i].x, y: a[i].y }));
      L = pm(L); R = pm(R);
    }
    const N = L.length, feed = state.cfg.feed, safeY = App.safeHeight();
    const ox = o.x, oy = o.y;
    const mx = v => ox - v, my = v => v - oy;                 // Maschinenkoordinaten (wie fx/fy im G-Code)
    // Blockschnitt- und Schalen-Geometrie aus dem Kern (in der Design-exe vorhanden).
    const bc = (state.cfg.cutOrder && state.cfg.cutOrder !== 'none') ? App.blockCutGeom(cut, seg, proj) : null;
    const SC = state.cfg.shellCut ? App.shellCutGeom(cut, seg, proj) : null;
    let mode = state.cfg.cutOrder || (bc ? 'before' : 'none');
    if (mode === 'wrap' && !bc) mode = 'before';

    const closed = N > 1 &&
      Math.abs(L[0].x - L[N-1].x) < 1e-6 && Math.abs(L[0].y - L[N-1].y) < 1e-6 &&
      Math.abs(R[0].x - R[N-1].x) < 1e-6 && Math.abs(R[0].y - R[N-1].y) < 1e-6;
    const last = closed ? N - 2 : N - 1;
    let iLE = 0, xLE = Infinity;
    for (let i = 0; i <= last; i++) { if (L[i].x < xLE) { xLE = L[i].x; iLE = i; } }

    const mv = [], P = (lx, ly, rx, ry) => ({ lx, ly, rx, ry });
    let cur = P(0, 0, 0, 0);
    const go = (to, rapid) => { mv.push({ from: cur, to, rapid: !!rapid, feed: rapid ? 0 : feed }); cur = to; };
    const contour = (from, to) => {
      from = from || 1; to = (to == null) ? last : to;
      for (let i = from; i <= to; i++) go(P(mx(L[i].x), my(L[i].y), mx(R[i].x), my(R[i].y)), false);
    };
    const emitBlockAt = pos => {                              // ein Blockschnitt (vorne oder hinten)
      go(P(mx(pos.l), safeY, mx(pos.r), safeY), true);        // horizontal an Schnittposition (Positionierfahrt)
      go(P(mx(pos.l), 0, mx(pos.r), 0), false);               // vertikal runter (Schnitt)
      go(P(mx(pos.l), safeY, mx(pos.r), safeY), false);       // vertikal hoch (Schnitt)
    };
    const goSafeAtOrigin  = () => go(P(0, safeY, 0, safeY), true);
    const returnFromSafe  = () => { go(P(0, safeY, 0, safeY), true); go(P(0, 0, 0, 0), true); };
    const emitShellCut = (sy, fr) => {                        // horizontaler Schalen-Trennschnitt (Trapez)
      go(P(0, my(sy.l), 0, my(sy.r)), true);                  // hinter dem Block auf Schnitthöhe
      go(P(mx(fr.l), my(sy.l), mx(fr.r), my(sy.r)), false);   // Horizontalschnitt durch den Block
      go(P(mx(fr.l), safeY, mx(fr.r), safeY), true);          // vor dem Block hoch
      go(P(0, safeY, 0, safeY), true);                        // zurück über den Block
    };
    const emitProfileHorizontal = finish => {                 // Profil mit horizontaler Anfahrt (ohne Blockschnitt)
      go(P(0, my(L[0].y), 0, my(R[0].y)), true);              // hoch auf Höhe der EL-Verlängerung
      go(P(mx(L[0].x), my(L[0].y), mx(R[0].x), my(R[0].y)), true); // horizontal zum Profil
      contour();
      go(P(0, my(L[last].y), 0, my(R[last].y)), true);        // horizontal zurück
      if (finish !== false) go(P(0, 0, 0, 0), true);          // vertikal auf Null
    };

    if (SC) emitShellCut(SC.top, SC.front);                   // Oberschale vor dem Kern

    if (mode === 'only') {
      goSafeAtOrigin();
      if (bc) { emitBlockAt(bc.rear); emitBlockAt(bc.front); }
      returnFromSafe();
    } else if (mode === 'before' && bc) {
      goSafeAtOrigin();
      emitBlockAt(bc.front);
      go(P(mx(bc.rear.l), safeY, mx(bc.rear.r), safeY), true);
      go(P(mx(bc.rear.l), 0, mx(bc.rear.r), 0), false);       // hinteres Blockende auf Null (Schnitt)
      go(P(mx(bc.rear.l), my(L[0].y), mx(bc.rear.r), my(R[0].y)), false); // hoch auf Profilanfang
      go(P(mx(L[0].x), my(L[0].y), mx(R[0].x), my(R[0].y)), true);        // horizontal zum Profilanfang
      contour();
      go(P(0, my(L[last].y), 0, my(R[last].y)), true);
      go(P(0, 0, 0, 0), true);
    } else if (mode === 'wrap' && bc) {
      goSafeAtOrigin();
      go(P(mx(bc.rear.l), safeY, mx(bc.rear.r), safeY), true);
      go(P(mx(bc.rear.l), 0, mx(bc.rear.r), 0), false);
      go(P(mx(bc.rear.l), my(L[0].y), mx(bc.rear.r), my(R[0].y)), false);
      go(P(mx(L[0].x), my(L[0].y), mx(R[0].x), my(R[0].y)), true);
      contour(1, iLE);                                        // Oberseite bis zur Nase
      go(P(mx(bc.front.l), my(L[iLE].y), mx(bc.front.r), my(R[iLE].y)), false); // vor die Nase
      go(P(mx(bc.front.l), safeY, mx(bc.front.r), safeY), false);               // Blockvorderkante oben
      go(P(mx(bc.front.l), 0, mx(bc.front.r), 0), false);                       // Blockvorderkante unten
      go(P(mx(bc.front.l), my(L[iLE].y), mx(bc.front.r), my(R[iLE].y)), false); // hoch auf Nasenhöhe
      go(P(mx(L[iLE].x), my(L[iLE].y), mx(R[iLE].x), my(R[iLE].y)), false);     // zurück zur Nase
      contour(iLE + 1, last);                                 // Unterseite zurück
      go(P(0, my(L[last].y), 0, my(R[last].y)), true);
      go(P(0, 0, 0, 0), true);
    } else if (mode === 'after') {
      emitProfileHorizontal(false);
      goSafeAtOrigin();
      if (bc) { emitBlockAt(bc.rear); emitBlockAt(bc.front); }
      returnFromSafe();
    } else {                                                  // 'none'
      emitProfileHorizontal(true);
    }

    if (SC) { emitShellCut(SC.bottom, SC.front); go(P(0, 0, 0, 0), true); }  // Unterschale nach dem Kern

    return { moves: mv, label: T('Kerndesign') };
  }
  // Zug-Ablauf (Schnittrichtung „von vorne" und „nur Ober-/Unterseite"): derselbe
  // Grobablauf wie emitPasses() im G-Code-Schreiber — Züge aus HotWire.cutPasses,
  // Anfahrt von der Seite des Einlaufs (nah = Nullpunktseite, fern = gegenüber),
  // Ausfahrt fern senkrecht hoch bzw. nah waagrecht zum Null-X, Blockschnitte
  // „vor/während/nach" wie dort.
  function previewCoreFront(cut, seg, proj, o) {
    const L = proj.left, R = proj.right, RP = proj.rootPath || L;
    const stackN = (proj.stack && proj.stack.count > 1) ? proj.stack.count : 1;
    const front = o.sx > 0;
    const ps = HotWire.cutPasses(RP, stackN, { front, sides: state.cfg.cutSides, profileDir: state.cfg.profileDir });
    if (!ps.length) return null;
    const feed = state.cfg.feed, safeY = App.safeHeight();
    const mx = v => App.machX(o, v), my = v => v - o.y;
    const bc = (state.cfg.cutOrder && state.cfg.cutOrder !== 'none') ? App.blockCutGeom(cut, seg, proj) : null;
    const bb = App.blockCutGeom(cut, seg, proj);
    const SC = state.cfg.shellCut ? App.shellCutGeom(cut, seg, proj) : null;
    let mode = state.cfg.cutOrder || (bc ? 'before' : 'none');
    if ((mode === 'wrap' && (!bc || stackN > 1)) || (mode !== 'none' && mode !== 'after' && !bc)) mode = bc ? 'before' : 'none';
    const nearB = bc ? (front ? bc.front : bc.rear) : null, farB = bc ? (front ? bc.rear : bc.front) : null;
    const farF = front ? bb.rear : bb.front;
    const mv = [], P = (lx, ly, rx, ry) => ({ lx, ly, rx, ry });
    let cur = P(0, 0, 0, 0);
    const go = (to, rapid) => { mv.push({ from: cur, to, rapid: !!rapid, feed: rapid ? 0 : feed }); cur = to; };
    const at = (l, r, yl, yr) => P(mx(l), yl, mx(r), yr);
    const emitBlockAt = pos => {
      go(at(pos.l, pos.r, safeY, safeY), true);
      go(at(pos.l, pos.r, 0, 0), false);
      go(at(pos.l, pos.r, safeY, safeY), false);
    };
    const emitShellCut = (sy, far) => {
      go(P(0, my(sy.l), 0, my(sy.r)), true);
      go(at(far.l, far.r, my(sy.l), my(sy.r)), false);
      go(at(far.l, far.r, safeY, safeY), true);
      go(P(0, safeY, 0, safeY), true);
    };
    const shellFar = front ? SC && SC.rear : SC && SC.front;
    if (SC) emitShellCut(SC.top, shellFar);
    if (mode === 'only') {
      go(P(0, safeY, 0, safeY), true);
      if (bc) { emitBlockAt(nearB); emitBlockAt(farB); }
      go(P(0, safeY, 0, safeY), true); go(P(0, 0, 0, 0), true);
    } else {
      let pos = 'origin', nearCut = false, farCut = false;
      const startsNear = q => mx(L[q.idx[0]].x) <= mx(L[q.idx[q.idx.length - 1]].x);
      const s0Near = startsNear(ps[0]);
      if (mode === 'before' || mode === 'wrap') {
        go(P(0, safeY, 0, safeY), true);
        if (mode === 'before') { emitBlockAt(s0Near ? farB : nearB); if (s0Near) farCut = true; else nearCut = true; }
        const Bs = s0Near ? nearB : farB;
        go(at(Bs.l, Bs.r, safeY, safeY), true);
        go(at(Bs.l, Bs.r, 0, 0), false);
        if (s0Near) { nearCut = true; pos = 'nearKerf'; } else { farCut = true; pos = 'farKerf'; }
      }
      ps.forEach((q, k) => {
        const i0 = q.idx[0], ie = q.idx[q.idx.length - 1], sNear = startsNear(q);
        const y0l = my(L[i0].y), y0r = my(R[i0].y);
        if (sNear) {
          if (pos === 'origin' || pos === 'nearLow') go(P(0, y0l, 0, y0r), true);
          else if (pos === 'safe') {
            if (nearCut) { go(at(nearB.l, nearB.r, safeY, safeY), true); go(at(nearB.l, nearB.r, y0l, y0r), false); }
            else { go(P(0, safeY, 0, safeY), true); go(P(0, y0l, 0, y0r), true); }
          } else if (pos === 'nearKerf') go(at(nearB.l, nearB.r, y0l, y0r), false);
          go(at(L[i0].x, R[i0].x, y0l, y0r), !nearCut);
        } else {
          if (pos === 'origin' || pos === 'nearLow') { go(P(0, safeY, 0, safeY), true); pos = 'safe'; }
          if (pos === 'safe') {
            if (farCut) { go(at(farB.l, farB.r, safeY, safeY), true); go(at(farB.l, farB.r, y0l, y0r), false); }
            else {
              const dl = Math.max(mx(farF.l) + 5, mx(L[i0].x)), dr = Math.max(mx(farF.r) + 5, mx(R[i0].x));
              go(P(dl, safeY, dr, safeY), true); go(P(dl, y0l, dr, y0r), true);
            }
          } else if (pos === 'farKerf') go(at(farB.l, farB.r, y0l, y0r), false);
          go(at(L[i0].x, R[i0].x, y0l, y0r), !farCut);
        }
        for (let m = 1; m < q.idx.length; m++) { const i = q.idx[m]; go(at(L[i].x, R[i].x, my(L[i].y), my(R[i].y)), false); }
        const yel = my(L[ie].y), yer = my(R[ie].y);
        if (mode === 'wrap' && k === 0) {
          const B = sNear ? farB : nearB;
          go(at(B.l, B.r, yel, yer), false); go(at(B.l, B.r, 0, 0), false); go(at(B.l, B.r, safeY, safeY), false);
          if (sNear) farCut = true; else nearCut = true;
          pos = 'safe';
        } else if (sNear) { go(at(L[ie].x, R[ie].x, safeY, safeY), false); pos = 'safe'; }
        else { go(P(0, yel, 0, yer), true); pos = 'nearLow'; }
      });
      if (mode === 'after' && bc) {
        const atNear = pos === 'nearLow';
        if (pos !== 'safe') { go(P(0, safeY, 0, safeY), true); pos = 'safe'; }
        if (atNear) { emitBlockAt(nearB); emitBlockAt(farB); } else { emitBlockAt(farB); emitBlockAt(nearB); }
      }
      if (pos === 'nearLow') go(P(0, 0, 0, 0), true);
      else { go(P(0, safeY, 0, safeY), true); go(P(0, 0, 0, 0), true); }
    }
    if (SC) { emitShellCut(SC.bottom, shellFar); go(P(0, 0, 0, 0), true); }
    return { moves: mv, label: T('Kerndesign') };
  }
  // Konstanter Schalenrand: die beiden planaren Vertikal-Vorschnitte (Nase/EL) auf
  // konstantem Überstand `se` — identisch zu negGcode (gcodegen.js). Kerf-kompensiert
  // (halber Abbrand je Rippe nach außen), Ziel immer Maschinen-Vertikal 0. Rückgabe:
  // Bewegungsliste, die am Nullpunkt beginnt UND endet (schließt an die Kontur an).
  function negShellEdgeMoves(P, safeY, feed) {
    const se = (P.stege && state.cfg.negStegeOnly) ? 0 : (state.cfg.negShellEdge || 0);
    if (!(se > 0) || (App.negDirectPath && App.negDirectPath())) return [];   // „ein Zug": keine Vorschnitte
    const ck = App.cutKerf(P.cut.root.chord, P.cut.tip.chord);
    const hkR = ck.root / 2, hkT = ck.tip / 2;
    const zR = P.zRoot, zT = P.zTip, mw = P.mw, ox = P.ox;
    const at = (a, b, z) => a + (b - a) * (z - zR) / ((zT - zR) || 1);
    const pos = (a, b) => ({ l: ox - at(a, b, 0), r: ox - at(a, b, mw) });   // Maschinen-X je Turm
    const front = pos(P.root.xL - se - hkR, P.tip.xL - se - hkT);            // Nase
    const rear  = pos(P.root.xT + se + hkR, P.tip.xT + se + hkT);            // Endleiste
    const mv = [], P4 = (lx, ly, rx, ry) => ({ lx, ly, rx, ry });
    let cur = P4(0, 0, 0, 0);
    const go = (to, rapid) => { mv.push({ from: cur, to, rapid: !!rapid, feed: rapid ? 0 : feed }); cur = to; };
    const edgeCut = p => {
      go(P4(0, safeY, 0, safeY), true);                     // hoch auf Sicherheitshöhe
      go(P4(p.l, safeY, p.r, safeY), true);                 // an die Schnittlinie
      go(P4(p.l, 0, p.r, 0), false);                        // vertikal auf 0 (Schnitt)
      go(P4(p.l, safeY, p.r, safeY), true);                 // hoch auf Sicherheitshöhe
    };
    edgeCut(rear); edgeCut(front);                          // Reihenfolge wie negGcode: hinten, dann vorne
    go(P4(0, safeY, 0, safeY), true);                       // über den Block zurück
    go(P4(0, 0, 0, 0), true);                               // zurück auf den Nullpunkt
    return mv;
  }
  // Negativschale: Schalenkontur (rp/tp) auf die Türme projiziert, mit vorangestellten
  // Schalenrand-Vertikalschnitten (Überstand) wie im echten Neg-G-Code.
  function previewNeg() {
    App.matCtxOverride = 'neg';
    try {
      const P = App.negProjection();
      const proj = (vr, vt, zp) => vr + (zp - P.zRoot) / ((P.zTip - P.zRoot) || 1) * (vt - vr);
      const n = Math.min(P.rp.length, P.tp.length), L = [], R = [];
      for (let i = 0; i < n; i++) {
        L.push({ x: P.ox - proj(P.rp[i].x, P.tp[i].x, 0), y: proj(P.rp[i].y, P.tp[i].y, 0) - P.oy });
        R.push({ x: P.ox - proj(P.rp[i].x, P.tp[i].x, P.mw), y: proj(P.rp[i].y, P.tp[i].y, P.mw) - P.oy });
      }
      const safeY = (state.cfg.blockY || 0) + App.blockH() + (state.material.safeH || 0);
      const edge = negShellEdgeMoves(P, safeY, state.cfg.feed);
      return { moves: edge.concat(movesFromTowers(L, R, safeY, state.cfg.feed)), label: T('Negativschale') };
    } finally { App.matCtxOverride = null; }
  }
  // DXF-Formen (INNEN/AUSSEN + Synchronpaare).
  function previewDxf() {
    if (!App.dxfProjection) return null;
    const P = App.dxfProjection(); if (!P) return null;
    const safeY = (P.maxy - P.origin.y) + (state.material.safeH || 10);
    return { moves: movesFromTowers(toMachine(P.left, P.origin.x, P.origin.y), toMachine(P.right, P.origin.x, P.origin.y), safeY, state.cfg.feed),
             label: T('DXF-Form') };
  }
  // 3D-Modell: Bewegungsdaten aus model3d.js (Achswerte als Text, k = Art der Fahrt).
  function movesFromModel(r) {
    if (!r || !r.moves) return [];
    const mv = []; let cur = { lx: 0, ly: 0, rx: 0, ry: 0 };
    for (const m of r.moves) {
      const to = { lx: m.x != null ? +m.x : cur.lx, ly: m.y != null ? +m.y : cur.ly,
                   rx: m.u != null ? +m.u : cur.rx, ry: m.v != null ? +m.v : cur.ry };
      const cutting = m.k === 'cut' || m.k === 'close' || m.k === 'enter';
      mv.push({ from: cur, to, rapid: !cutting, feed: cutting ? (+m.F || state.cfg.feed) : 0 });
      cur = to;
    }
    return mv;
  }
  function previewModel() {
    if (!(window.Model3D && Model3D.hasModel() && Model3D.buildSegmentPaths && App.mgOpt)) return null;
    if (!Model3D.ensureSegments()) return null;
    const c = App.mgCfg(); if (c.seg >= Model3D.segCount()) c.seg = 0;
    return { moves: movesFromModel(Model3D.buildSegmentPaths(c.seg, App.mgOpt())), label: T('3D-Modell Segment ') + (c.seg + 1) };
  }
  function previewPlate() {
    if (!(window.Model3D && Model3D.buildPlatePaths && App.platePlacements)) return null;
    const pls = App.platePlacements(); if (!pls.length) return null;
    const pc = App.plateCfg();
    const r = Model3D.buildPlatePaths(pls, Object.assign({}, App.mgOpt(), { plateConnEdits: pc.connEdits, plateGap: Math.min(pc.gapH, pc.gapV) }));
    return { moves: movesFromModel(r), label: T('3D-Modell Platte') };
  }

  // Vorschau passend zur gewählten G-Code-Quelle; null, wenn nichts darstellbar ist.
  function pathPreviewMoves() {
    const s = state.cfg.gcodeSource;
    try {
      if (s === 'neg') return previewNeg();
      if (s === 'dxf') return previewDxf();
      if (s === 'model') return previewModel();
      if (s === 'plate') return previewPlate();
      if (s === 'schrift') return window.Schrift ? Schrift.previewMoves() : null;
      return previewCore();
    } catch (e) { return null; }
  }

  Object.assign(App, { pathPreviewMoves });
})();
