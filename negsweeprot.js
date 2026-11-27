/* negsweeprot.js — Werkstück drehen bei starker Pfeilung im NEGATIVDESIGN
 * (eigenständiges Modul, Kern).
 *
 * Gleiche Funktion wie „Werkstück drehen (Pfeilung)" im Kerndesign (sweeprot.js),
 * aber OHNE Kopplung: eigene Einstellungen cfg.negSweepRot / negSweepRotMode /
 * negSweepRotRef / negSweepRotAngle (je Tragfläche über das neg*-Präfix) und ein
 * eigenes Menü im Reiter „Negativschalendesign". Die Kern-Einstellungen
 * (cfg.sweepRot …) wirken hier nicht und umgekehrt.
 *
 * Prinzip wie im Kerndesign: Der Block wird um die Hochachse gedreht, bis die
 * Bezugslinie (Sehnenanteil der Quellprofile, z. B. Nasenleiste) parallel zur
 * Drahtachse liegt -> weniger X-Fahrweg. Der Draht schneidet weiter dieselbe
 * Regelfläche (Wurzel-/Randbahn rp/tp); geändert wird nur die Projektion auf die
 * Portalebenen, der Nullpunkt (hinterste gedrehte Blockecke) und die Block-
 * darstellung (Draufsicht, 3D-Simulation). Der Querschnitt bleibt unverändert.
 *
 * Einhängepunkte (alle geschützt aufgerufen):
 *   gcode.js     negProjection   -> App.negSweepRotFor(q) = P.sweepRot
 *   gcode.js     buildNegScene   -> gedrehte Blockecken (blk.rot)
 *   gcodegen.js  contourCutter / negGcode_ (Randvorschnitte) -> App.sweepProj2(P.sweepRot, …)
 *   pathpreview.js previewNeg    -> dito (Bahnvorschau ohne G-Code-Erzeugung)
 *   render.js    drawNegPlan     -> App.negSweepRotPlanAngle(idx)
 *   render.js    Profilvergleich -> App.openSweepCmp('neg')
 *   sidebar.js   Menü            -> App.negSweepRotSidebar(side)
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;

  function on() { return !!(state.cfg.negSweepRot && window.SweepRot); }
  // Modus: 'min' = kürzester Fahrweg (Standard), 'ref' = aus Bezugslinie
  // ('auto' = alter Name dafür), 'manual' = fester Winkel.
  function mode() {
    const m = state.cfg.negSweepRotMode;
    return m === 'manual' ? 'manual' : (m === 'ref' || m === 'auto') ? 'ref' : 'min';
  }
  function opts() {
    const c = state.cfg;
    return {
      mode: mode(),
      ref: c.negSweepRotRef != null ? Math.max(0, Math.min(1, +c.negSweepRotRef || 0)) : 0,
      angleDeg: +c.negSweepRotAngle || 0
    };
  }
  // Winkel/Pivot aus den Quellprofilen (Bezugslinie = Sehnenanteil der Profile).
  // extra.angleRad: fest vorgegebener Winkel (Modus „kürzester Fahrweg").
  function rotation(rPts, tPts, zRoot, zTip, extra) {
    if (!rPts || !tPts || !rPts.length || !tPts.length) return null;
    return SweepRot.rotation({ rootCore: rPts, tipCore: tPts, rootPath: rPts, tipPath: tPts, zRoot, zTip }, Object.assign(opts(), extra || {}));
  }
  // Turm-Projektion (Wurzel@zR -> Rand@zT auf Ebene zp), mit oder ohne Drehung.
  function proj(rot, zR, zT, xr, yr, xt, yt, zp) {
    if (App.sweepProj2) return App.sweepProj2(rot, zR, zT, xr, yr, xt, yt, zp);
    const t = (zp - zR) / ((zT - zR) || 1);
    return { x: xr + t * (xt - xr), y: yr + t * (yt - yr) };
  }

  /* Drehung einer Negativ-Projektion (gcode.js negProjection).
   *   q = { rPts, tPts, root, tip (negShell: xBL/xBR), rp, tp, zRoot, zTip, mw, mirror, bz }
   * Rückgabe null (aus / Winkel ≈ 0 / nicht anwendbar) oder
   *   { angleRad, angleDeg, pivot:{x,z}, dz, rearX, frontX, travelBefore, travelAfter, saved }
   * angleRad/pivot/dz haben dieselbe Bedeutung wie pr.sweepRot im Kerndesign —
   * App.sweepProj2 und der Profilvergleich verarbeiten sie unverändert. */
  function rotFor(q) {
    if (!on() || !q || !q.root || !q.tip) return null;
    // Portalabstand auf den JEWEILS nächstgelegenen Blockeckpunkt beziehen (wie im
    // Kerndesign, compute.js): die gedrehte Geometrie wird in z so verschoben, dass
    // die dem Wurzelseiten-Portal nächste Ecke genau blockZ entfernt liegt.
    const corners = [[q.root.xBR, q.zRoot], [q.root.xBL, q.zRoot], [q.tip.xBR, q.zTip], [q.tip.xBL, q.zTip]];
    const box = rt => {
      let zmin = Infinity, zmax = -Infinity, xmin = Infinity, xmax = -Infinity;
      corners.forEach(([x, z]) => {
        const p = SweepRot.rotXZ(x, z, rt.a, rt.px, rt.pz);
        if (p.z < zmin) zmin = p.z; if (p.z > zmax) zmax = p.z;
        if (p.x < xmin) xmin = p.x; if (p.x > xmax) xmax = p.x;
      });
      return { zmin, zmax, xmin, xmax };
    };
    const dzFor = rt => { const b = box(rt); return q.mirror ? ((q.mw - q.bz) - b.zmax) : (q.bz - b.zmin); };
    // „Automatisch (kürzester Fahrweg)": Winkel mit dem kleinsten X-Fahrweg der
    // Drahtbahnen rp/tp beider Portale suchen; der gedrehte Formblock muss
    // zwischen die Portale passen. Pivot wie rotation() aus den Quellprofilen.
    let extra = null;
    if (mode() === 'min') {
      const fits = (rt, d) => { const b = box(rt); return b.zmin + d >= -1e-6 && b.zmax + d <= q.mw + 1e-6; };
      extra = { angleRad: SweepRot.bestAngle({ rootCore: q.rPts, tipCore: q.tPts, rootPath: q.rp || [], tipPath: q.tp || [], zRoot: q.zRoot, zTip: q.zTip },
        { machineWidth: q.mw, dzFor, fits }) };
    }
    const rot = rotation(q.rPts, q.tPts, q.zRoot, q.zTip, extra);
    if (!rot) return null;
    const bx = box(rot), zmin = bx.zmin, zmax = bx.zmax, xmin = bx.xmin, xmax = bx.xmax;
    const dz = q.mirror ? ((q.mw - q.bz) - zmax) : (q.bz - zmin);
    const r = { angleRad: rot.a, angleDeg: rot.angleDeg, pivot: { x: rot.px, z: rot.pz }, dz, rearX: xmax, frontX: xmin };
    // X-Fahrweg beider Portale vorher/nachher. Liegt eine Drahtlinie nach der
    // Drehung parallel zu den Turmebenen, ist die Drehung nicht anwendbar.
    const rp = q.rp || [], tp = q.tp || [], n = Math.min(rp.length, tp.length);
    let b0 = Infinity, b1 = -Infinity, a0 = Infinity, a1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const R = SweepRot.rotXZ(rp[i].x, q.zRoot, rot.a, rot.px, rot.pz);
      const Tt = SweepRot.rotXZ(tp[i].x, q.zTip, rot.a, rot.px, rot.pz);
      if (Math.abs(Tt.z - R.z) < 1e-6) return null;
      for (const zp of [0, q.mw]) {
        const xl = proj(null, q.zRoot, q.zTip, rp[i].x, 0, tp[i].x, 0, zp).x;
        const xr = proj(r, q.zRoot, q.zTip, rp[i].x, 0, tp[i].x, 0, zp).x;
        if (xl < b0) b0 = xl; if (xl > b1) b1 = xl;
        if (xr < a0) a0 = xr; if (xr > a1) a1 = xr;
      }
    }
    r.travelBefore = b1 >= b0 ? b1 - b0 : 0;
    r.travelAfter = a1 >= a0 ? a1 - a0 : 0;
    r.saved = r.travelBefore - r.travelAfter;
    return r;
  }

  /* Drehwinkel des Blocks in der Draufsicht des Negativdesigns (rad). Die Draufsicht
   * zeigt die Wurzel immer links; liegt die Wurzel an der Maschine rechts (linke
   * Fläche), ist die Spannweite dort gespiegelt -> Drehsinn umkehren (wie drawPlan). */
  function planAngle(idx) {
    if (!on()) return 0;
    const cuts = App.wing && App.wing.cuts;
    if (!cuts || !cuts.length || !App.negRibPts) return 0;
    const cut = cuts[Math.min(idx, cuts.length - 1)];
    const mirror = state.cfg.side === 'left', span = cut.span || 0;
    // Kürzester Fahrweg: der Winkel hängt an der ganzen Projektion (Bahnen, Block,
    // Portalabstand) -> dieselbe Rechnung wie für G-Code/Simulation nehmen.
    if (mode() === 'min') {
      if (!App.negProjection) return 0;
      let P = null;
      const prev = App.matCtxOverride;
      App.matCtxOverride = 'neg';
      try { P = App.negProjection(idx); } catch (e) { P = null; }
      finally { App.matCtxOverride = prev; }
      const a = P && P.sweepRot ? P.sweepRot.angleRad : 0;
      return mirror ? -a : a;
    }
    const rot = rotation(App.negRibPts(cut, idx, 'root'), App.negRibPts(cut, idx, 'tip'), 0, mirror ? -span : span);
    if (!rot || !isFinite(rot.a)) return 0;
    return mirror ? -rot.a : rot.a;
  }

  // Kennwerte der Drehung ins Menü schreiben (aus renderNeg aufgerufen).
  function info() {
    const el = document.getElementById('negSweepRotInfo');
    if (!el) return;
    let P = null;
    const prev = App.matCtxOverride;
    App.matCtxOverride = 'neg';
    try { P = App.negProjection ? App.negProjection() : null; } catch (e) { P = null; }
    finally { App.matCtxOverride = prev; }
    const i = P && P.sweepRot;
    if (!i) { el.textContent = T(mode() === 'min' ? 'Keine Drehung angewandt — gedreht wird der Fahrweg nicht kürzer.' : 'Keine Drehung angewandt.'); return; }
    const f = v => (Math.round(v * 10) / 10);
    el.textContent = T('Segment') + ' ' + (P.idx + 1) + ' · ' + T('Drehwinkel') + ': ' + f(i.angleDeg) + '°  ·  '
      + T('X-Fahrweg') + ': ' + f(i.travelBefore) + ' → ' + f(i.travelAfter) + ' mm  ('
      + (i.saved >= 0 ? '−' : '+') + f(Math.abs(i.saved)) + ' mm)';
  }

  // Eigenes Menü im Reiter „Negativschalendesign" — Bedienung wie im Kerndesign.
  function sidebar(side) {
    const { grp, boolRow, selectRow, numRow, hint, buildSidebar, render } = App;
    const c = state.cfg;
    if (c.negSweepRotMode == null) c.negSweepRotMode = 'min';
    if (c.negSweepRotRef == null) c.negSweepRotRef = 0;
    if (c.negSweepRotAngle == null) c.negSweepRotAngle = 0;
    const g = grp('Werkstück drehen (Pfeilung)', true, 'neg', { key: 'Werkstück drehen (Negativdesign)' });
    boolRow(g.body, 'Drehung aktiv', () => !!c.negSweepRot,
      // Profilvergleich öffnet NUR über den Button unten, nicht beim Einschalten.
      v => { c.negSweepRot = v; buildSidebar(); render(); if (!v && App.closeSweepCmp) App.closeSweepCmp('neg'); },
      'Dreht das Werkstück um die Hochachse, damit ein stark gepfeiltes Segment '
      + 'weniger X-Fahrweg braucht. Der Heißdraht schneidet weiter die gleiche Regelfläche; die nötige '
      + 'Profil-„Verzerrung" an den Türmen entsteht automatisch. Wirkt nur auf die '
      + 'Turmbahnen/G-Code der Negativschale, nicht auf den Querschnitt. Unabhängig von '
      + 'der Drehung im Kerndesign.');
    if (c.negSweepRot) {
      selectRow(g.body, 'Winkel', App.SWEEP_ROT_MODES,
        () => mode(), v => { c.negSweepRotMode = v; buildSidebar(); render(); },
        App.SWEEP_ROT_MODE_HINT);
      if (mode() === 'ref')
        numRow(g.body, 'Bezugslinie (Sehnenanteil 0–1)', () => c.negSweepRotRef,
          v => { c.negSweepRotRef = Math.max(0, Math.min(1, v)); render(); },
          { step: 0.05, min: 0, max: 1,
            hint: '0 = Nasenleiste, 0,25 = t/4, 1 = Endleiste. Diese Linie wird parallel '
            + 'zur Drahtachse gedreht.' });
      else
        numRow(g.body, 'Drehwinkel (°)', () => c.negSweepRotAngle,
          v => { c.negSweepRotAngle = v; render(); }, { step: 0.5 });
      const inf = document.createElement('div');
      inf.className = 'hint'; inf.id = 'negSweepRotInfo';
      g.body.appendChild(inf);
      const cmpBtn = document.createElement('button');
      cmpBtn.textContent = T('⬍ Profilvergleich (Original ↔ verzerrt)');
      cmpBtn.onclick = () => { if (App.openSweepCmp) App.openSweepCmp('neg'); };
      g.body.appendChild(cmpBtn);
    }
    hint(g.body, 'Der Block wird in der Draufsicht und im 3D-Simulator bereits gedreht '
      + 'dargestellt („wie er wirklich liegt"). Beim Aufspannen den Werkstoff-Block real um den '
      + 'angezeigten Winkel drehen; Diagonale/Blocklänge prüfen. Die Randvorschnitte '
      + '(Schalenrand) werden mitgedreht, Schnitthöhen bleiben drehinvariant.');
    side.appendChild(g.g);
  }

  Object.assign(App, { negSweepRotOn: on, negSweepRotFor: rotFor, negSweepRotPlanAngle: planAngle,
    negSweepRotInfo: info, negSweepRotSidebar: sidebar });
})();
