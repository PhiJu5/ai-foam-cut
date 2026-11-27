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
   *   opts.angleRad : fest vorgegeben (z. B. von bestAngle im Modus 'min').
   *   mode 'manual' : angleDeg direkt.
   *   mode 'ref'    : so, dass die Bezugslinie (Sehnenanteil ref) parallel zur
   *                   Drahtachse liegt ('auto' = alter Name dafür). Kürzt den
   *                   Fahrweg nur, wenn Nasen- und Endleiste ähnlich gepfeilt sind.
   *   mode 'min'    : ohne angleRad wie 'ref' — der Aufrufer sucht den Winkel mit
   *                   bestAngle(), weil der Fahrweg vom Portalabstand (dz) abhängt.
   * Rückgabe 0, wenn keine sinnvolle Drehung möglich/nötig.
   */
  function computeAngle(pr, opts) {
    if (opts.angleRad != null) return opts.angleRad;
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
    const p = pivotOf(pr);
    return { a: a, angleDeg: a * 180 / Math.PI, px: p.px, pz: p.pz };
  }
  // Pivot in Spannweitenmitte und Sehnenmitte -> das Paneel bleibt (bis auf die
  // Drehung) an seinem Platz. (Der Pivot beeinflusst nur die absolute Lage,
  // nicht die Form/den Fahrweg-Gewinn.)
  function pivotOf(pr) {
    const rootRef = pr.rootCore || pr.rootPath, tipRef = pr.tipCore || pr.tipPath;
    return { px: (refX(rootRef, 0.5) + refX(tipRef, 0.5)) / 2, pz: (pr.zRoot + pr.zTip) / 2 };
  }

  /* X-Fahrweg beider Portale zusammen (wie travelAfter von apply), ohne Listen
   * anzulegen. rot = {a, px, pz}, dz = z-Verschiebung nach der Drehung.
   * Infinity, wenn eine Drahtlinie parallel zu den Turmebenen läge. */
  function travelAt(pr, rot, dz, mw) {
    const root = pr.rootPath, tip = pr.tipPath, n = Math.min(root.length, tip.length);
    const c = Math.cos(rot.a), s = Math.sin(rot.a), px = rot.px, pz = rot.pz;
    const dR = pr.zRoot - pz, dT = pr.zTip - pz;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const xr = root[i].x - px, xt = tip[i].x - px;
      const Rx = px + xr * c - dR * s, Rz = pz + xr * s + dR * c + dz;
      const Tx = px + xt * c - dT * s, Tz = pz + xt * s + dT * c + dz;
      const span = Tz - Rz;
      if (Math.abs(span) < 1e-6) return Infinity;
      const k = (Tx - Rx) / span;
      const x0 = Rx - Rz * k, x1 = Rx + (mw - Rz) * k;   // Turm links (z=0) / rechts (z=mw)
      if (x0 < lo) lo = x0; if (x0 > hi) hi = x0;
      if (x1 < lo) lo = x1; if (x1 > hi) hi = x1;
    }
    return hi >= lo ? hi - lo : 0;
  }

  /* Modus „kürzester Fahrweg" ('min'): Drehwinkel (rad), bei dem die X-Ausdehnung
   * BEIDER Turmbahnen zusammen am kleinsten ist. Bei Segmenten, deren Nasen- und
   * Endleiste verschieden stark gepfeilt sind, liegt das Optimum zwischen den
   * beiden Kanten — die Nasenleiste als Bezugslinie kann den Fahrweg dort sogar
   * verlängern (z. B. Nase 46° gepfeilt, Endleiste fast gerade).
   *   o.machineWidth
   *   o.dzFor(rot)    -> z-Verschiebung nach der Drehung (Portalabstand, wie apply)
   *   o.fits(rot, dz) -> false, wenn der gedrehte Block nicht zwischen die Portale
   *                      passt (der Winkel scheidet dann aus)
   *   o.maxDeg        -> Suchbereich ±maxDeg (Standard 60°)
   *   o.minGain       -> Mindestgewinn in mm (Standard 1), sonst keine Drehung
   * Suche: 0,5°-Raster von 0 nach außen (gleicher Fahrweg -> kleinerer Winkel),
   * dann goldener Schnitt im Nachbarintervall. Rückgabe 0 = Drehung bringt nichts.
   */
  function bestAngle(pr, o) {
    o = o || {};
    const mw = o.machineWidth;
    if (!pr || !pr.rootPath || !pr.tipPath || pr.rootPath.length < 2 || !(mw > 0)) return 0;
    const rootRef = pr.rootCore || pr.rootPath, tipRef = pr.tipCore || pr.tipPath;
    if (!rootRef.length || !tipRef.length || Math.abs(pr.zTip - pr.zRoot) < 1e-9) return 0;
    const piv = pivotOf(pr);
    const at = a => ({ a, px: piv.px, pz: piv.pz });
    const dzOf = rot => (o.dzFor ? o.dzFor(rot) : 0);
    const cost = a => {
      const rot = at(a), dz = dzOf(rot);
      if (o.fits && !o.fits(rot, dz)) return Infinity;
      return travelAt(pr, rot, dz, mw);
    };
    const r0 = at(0), c0 = travelAt(pr, r0, dzOf(r0), mw);   // ohne Drehung (Vergleichswert)
    const step = 0.5 * Math.PI / 180, maxA = (o.maxDeg || 60) * Math.PI / 180;
    let best = 0, bc = c0;
    for (let k = 1; k * step <= maxA + 1e-12; k++) {
      for (const sg of [1, -1]) {
        const a = sg * k * step, c = cost(a);
        if (c < bc - 1e-6) { bc = c; best = a; }
      }
    }
    if (best !== 0) {
      const g = (Math.sqrt(5) - 1) / 2;
      let lo = best - step, hi = best + step;
      let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo), f1 = cost(x1), f2 = cost(x2);
      for (let it = 0; it < 30; it++) {
        if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = cost(x1); }
        else { lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = cost(x2); }
      }
      const am = f1 < f2 ? x1 : x2, cm = Math.min(f1, f2);
      if (cm < bc) { best = am; bc = cm; }
    }
    const gain = o.minGain != null ? o.minGain : 1;
    return (isFinite(bc) && c0 - bc >= gain) ? best : 0;
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

  global.SweepRot = { apply, bestAngle, computeAngle, rotation, rotXZ, travelAt };
})(window);
