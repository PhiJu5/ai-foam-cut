/* sweeprot.js — Werkstück drehen bei starker Pfeilung (EIGENSTÄNDIGES MODUL).
 *
 * Problem: Segmente mit starker Pfeilung brauchen viel X-Fahrweg auf der
 * Maschine, weil das Außenprofil stark gegen die Wurzel in X versetzt liegt.
 * Dreht man den Block einfach, passt das geschnittene Profil nicht mehr.
 *
 * Lösung: Der Heißdraht schneidet IMMER eine Regelfläche (gerade Drahtlinien
 * zwischen zwei synchronen Profilen). Ein Segment-Paneel ist genau so eine
 * Regelfläche. Dreht man das Werkstück um die Hochachse (Y, Dickenrichtung),
 * bis die Bezugslinie (z. B. Nasenleiste oder t/4) parallel zur Drahtachse (Z)
 * liegt, verschwindet der X-Versatz — und die nötige „Verzerrung" des Profils
 * an den Führungsebenen fällt AUTOMATISCH aus der Projektion heraus. Das Modul
 * verändert dazu NUR die Turmbahnen (left/right); rootPath/tipPath bleiben
 * unangetastet.
 *
 * Verfahren (Generator-Projektion):
 *   Für jeden synchronen Konturpunkt i ist die Drahtlinie die Gerade zwischen
 *     R_i = (rootPath[i].x, rootPath[i].y, zRoot)   [Wurzelebene]
 *     T_i = (tipPath[i].x,  tipPath[i].y,  zTip)     [Randebene]
 *   Beide Endpunkte werden um die Hochachse (Y) um φ gedreht (x,z drehen sich,
 *   y bleibt). Danach hat jeder Endpunkt sein EIGENES z. Die gedrehte Gerade
 *   wird mit den beiden Turmebenen z=0 und z=machineWidth geschnitten -> das
 *   sind die neuen Schlittenkoordinaten. Das ist exakt (kein Näherungs-Shear).
 *
 * Koordinaten (wie hotwire.js): x = Sehne/Fahrweg, y = Dicke/vertikal,
 *   z = Spannweite entlang des Drahts (Turm links z=0, Turm rechts z=mw).
 */
(function (global) {
  'use strict';

  // Dreht (x,z) um die vertikale Achse (Y) um Winkel a (rad) um Pivot (px,pz).
  function rotXZ(x, z, a, px, pz) {
    const dx = x - px, dz = z - pz, c = Math.cos(a), s = Math.sin(a);
    return { x: px + dx * c - dz * s, z: pz + dx * s + dz * c };
  }

  // Gesamte X-Ausdehnung (max-min) über MEHRERE Punktlisten zusammen — das ist
  // der Fahrweg, den die Maschine in X abdecken muss (beide Türme). Genau hier
  // wirkt die Pfeilung: sie zieht die Turmbahnen in X auseinander.
  function xRange() {
    let lo = Infinity, hi = -Infinity;
    for (let a = 0; a < arguments.length; a++) {
      const pts = arguments[a] || [];
      for (const p of pts) { if (p.x < lo) lo = p.x; if (p.x > hi) hi = p.x; }
    }
    return (hi >= lo) ? (hi - lo) : 0;
  }

  // Referenz-x einer Rippe an Sehnenanteil f (0 = Nasenleiste/min x, 1 = End-
  // leiste/max x). Nutzt die saubere Kernkontur, falls vorhanden.
  function refX(pts, f) {
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { if (p.x < lo) lo = p.x; if (p.x > hi) hi = p.x; }
    if (!(hi > lo)) return lo;
    return lo + f * (hi - lo);
  }

  /* Ermittelt den Drehwinkel (rad).
   *   mode 'manual' : angleDeg direkt.
   *   mode 'auto'   : so, dass die Bezugslinie (Sehnenanteil ref) parallel zur
   *                   Drahtachse liegt -> minimaler X-Versatz/Fahrweg.
   * Rückgabe 0, wenn keine sinnvolle Drehung möglich/nötig.
   */
  function computeAngle(pr, opts) {
    if (opts.mode === 'manual') return (opts.angleDeg || 0) * Math.PI / 180;
    const rootRef = pr.rootCore || pr.rootPath, tipRef = pr.tipCore || pr.tipPath;
    if (!rootRef || !tipRef || !rootRef.length || !tipRef.length) return 0;
    const f = (opts.ref != null) ? opts.ref : 0;   // Standard: Nasenleiste
    const dx = refX(tipRef, f) - refX(rootRef, f);
    const dz = pr.zTip - pr.zRoot;
    if (Math.abs(dz) < 1e-9) return 0;
    // KLEINSTER Winkel, der die Bezugslinie parallel zur Drahtachse stellt
    // (tan a = dx/dz). atan2 wäre falsch: bei gespiegelter Lage (linke Fläche,
    // Wurzel am rechten Portal, dz < 0) liefert es 180° − a und dreht das
    // Werkstück damit komplett um (wirkt wie eine Spiegelung).
    return Math.atan(dx / dz);
  }

  /* Winkel UND Pivot der Drehung (rad / mm). Damit können auch die Ansichten
   * (Block-Darstellung, 3D-Sim) exakt DIESELBE Drehung nachbilden.
   * Rückgabe null, wenn keine Drehung anzuwenden ist.
   *   pr braucht: rootCore|rootPath, tipCore|tipPath, zRoot, zTip
   *   opts wie apply().
   */
  function rotation(pr, opts) {
    if (!pr) return null;
    opts = opts || {};
    const a = computeAngle(pr, opts);
    if (!isFinite(a) || Math.abs(a) < 1e-9) return null;
    const rootRef = pr.rootCore || pr.rootPath, tipRef = pr.tipCore || pr.tipPath;
    if (!rootRef || !tipRef || !rootRef.length || !tipRef.length) return null;
    // Pivot in Spannweitenmitte und Sehnenmitte -> das Paneel bleibt (bis auf die
    // Drehung) an seinem Platz. (Der Pivot beeinflusst nur die absolute Lage,
    // nicht die Form/den Fahrweg-Gewinn.)
    const pz = (pr.zRoot + pr.zTip) / 2;
    const px = (refX(rootRef, 0.5) + refX(tipRef, 0.5)) / 2;
    return { a: a, angleDeg: a * 180 / Math.PI, px: px, pz: pz };
  }

  /* Wendet die Drehung an: gibt eine KOPIE von pr zurück, in der NUR left/right
   * neu (rotiert) projiziert sind. rootPath/tipPath/zRoot/zTip bleiben gleich,
   * damit der restliche Pfad (Sim, G-Code, DXF) unverändert weiterläuft.
   * Zusätzlich pr.sweepRot = Kennwerte (Winkel, Fahrweg vorher/nachher …).
   */
  function apply(pr, opts) {
    if (!pr || !pr.rootPath || !pr.tipPath || pr.rootPath.length < 2) return pr;
    opts = opts || {};
    const mw = opts.machineWidth;
    if (!(mw > 0)) return pr;
    const rot = rotation(pr, opts);
    if (!rot) return pr;
    const a = rot.a, px = rot.px, pz = rot.pz;
    // Zusätzliche z-Verschiebung NACH der Drehung (Portalabstand auf den
    // nächstgelegenen Punkt beziehen; von app.js vorberechnet). 0 = keine.
    const zShift = opts.dz || 0;

    const root = pr.rootPath, tip = pr.tipPath;
    const n = Math.min(root.length, tip.length);
    const zR = pr.zRoot, zT = pr.zTip;

    const left = [], right = [];
    for (let i = 0; i < n; i++) {
      const r = root[i], t = tip[i];
      const R = rotXZ(r.x, zR, a, px, pz);   // Wurzel-Endpunkt (x,z) gedreht
      const T = rotXZ(t.x, zT, a, px, pz);   // Rand-Endpunkt   (x,z) gedreht
      R.z += zShift; T.z += zShift;
      const span = T.z - R.z;
      if (Math.abs(span) < 1e-9) {
        // Draht wäre parallel zu den Turmebenen -> Drehung nicht anwendbar.
        return pr;
      }
      // Gerade R->T mit z=0 (links) und z=mw (rechts) schneiden.
      const t0 = (0  - R.z) / span;
      const t1 = (mw - R.z) / span;
      left.push({  x: R.x + t0 * (T.x - R.x), y: r.y + t0 * (t.y - r.y) });
      right.push({ x: R.x + t1 * (T.x - R.x), y: r.y + t1 * (t.y - r.y) });
    }

    const info = {
      angleDeg: a * 180 / Math.PI, angleRad: a,
      travelBefore: xRange(pr.left || [], pr.right || []),
      travelAfter: xRange(left, right),
      pivot: { x: px, z: pz }, dz: zShift
    };
    info.saved = info.travelBefore - info.travelAfter;

    return Object.assign({}, pr, { left, right, sweepRot: info });
  }

  global.SweepRot = { apply, computeAngle, rotation, rotXZ };
})(window);
