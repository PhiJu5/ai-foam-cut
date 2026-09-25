/* blockprep.js — Rohblock ablängen (zwei kerf-kompensierte Vertikalschnitte).
 *
 * Der fertige Block liegt in X zwischen `dist` (erster/vorderer Schnitt, Abstand
 * vom Maschinen-Nullpunkt) und `dist + length` (zweiter/hinterer Schnitt). In Y
 * reicht er vom Maschinen-Nullpunkt (Y=0, Bezug) bis zur Blockhöhe H.
 *
 * Beide Türme (L = X/Y, R = U/V) fahren identisch -> planare Vertikalschnitte
 * über die volle Blockbreite (Spannweite Z). Der Draht steht je Schnitt um
 * kerf/2 nach AUSSEN versetzt (weg vom Block), damit der Block exakt die
 * gewünschte Länge behält (kerf-kompensiert).
 */
(function (global) {
  'use strict';

  const T = (s) => (window.I18N ? window.I18N.t(s) : s);

  /* Schnittliste: zwei Vertikalschnitte. Punkt 1 = oben (Einstich von oben),
   * Punkt 2 = unten am Maschinen-Nullpunkt (Y=0). */
  function cutsFor(spec) {
    const k = spec.kerf || 0, H = spec.height;
    const d1 = spec.dist, d2 = spec.dist + spec.length;
    const xc1 = d1 - k / 2;                 // vorne: Draht kerf/2 nach außen (−X)
    const xc2 = d2 + k / 2;                 // hinten: kerf/2 nach außen (+X)
    return [
      { x1: xc1, y1: H, x2: xc1, y2: 0, label: T('1. Schnitt X=') + d1 + T(' mm (Abbrand-komp. ') + xc1.toFixed(2) + ')' },
      { x1: xc2, y1: H, x2: xc2, y2: 0, label: T('2. Schnitt X=') + d2.toFixed(0) + T(' mm (Abbrand-komp. ') + xc2.toFixed(2) + ')' }
    ];
  }

  function gcode(opt) {
    const ax = opt.ax, p = opt.precision != null ? opt.precision : 2, f = v => v.toFixed(p);
    const feed = opt.feed, safeY = opt.safeY, out = [], em = s => out.push(window.I18N ? window.I18N.tc(s) : s);
    const g0 = (x, y, c) => em(`G0 ${ax.x}${f(x)} ${ax.y}${f(y)} ${ax.u}${f(x)} ${ax.v}${f(y)}` + (c ? ' ; ' + c : ''));
    const g1 = (x, y, F, c) => em(`G1 ${ax.x}${f(x)} ${ax.y}${f(y)} ${ax.u}${f(x)} ${ax.v}${f(y)} F${F.toFixed(0)}` + (c ? ' ; ' + c : ''));
    em('; ==== HotWing – Block ablängen ====');
    em('; Block: X ' + opt.dist + ' … ' + (opt.dist + opt.length) + T(' mm (Länge ') + opt.length + T('), Höhe ') + opt.H + ' mm');
    em('; ' + T('Abbrand ') + (opt.kerf || 0).toFixed(2) + T(' mm kompensiert · Bezug Höhe = Maschinen-Nullpunkt (Y0)'));
    em('; ' + T('planare Vertikalschnitte (beide Türme identisch) · Vorschub ') + feed + ' mm/min');
    em('G21 ; mm'); em('G90 ; absolut');
    if (opt.heat != null) { em('; ' + T('Drahtheizung ') + opt.heat + ' %'); em('M3 S' + (opt.heatS != null ? opt.heatS : (+opt.heat).toFixed(0)) + ' ; Draht EIN'); }
    g0(0, 0, 'Start am Maschinennullpunkt (X0/Y0)');
    g0(0, safeY, 'hoch auf Sicherheitshöhe');
    let cutLen = 0;
    (opt.cuts || []).forEach((c, i) => {
      em('; --- ' + (c.label || (T('Schnitt ') + (i + 1))) + ' ---');
      g0(c.x1, safeY, 'über Schnittlinie');
      // Von der Sicherheitshöhe in EINEM Zug mit Schnittvorschub senkrecht bis Y0
      // (kein langsameres Anfahren an die Blockoberkante).
      g1(c.x2, c.y2, feed, 'vertikal von der Sicherheitshöhe auf Y0 (durchtrennen, ein Zug)');
      if ((opt.meltDwell || 0) > 0) em('G4 P' + opt.meltDwell + ' ; ' + T('am Nullpunkt verweilen (durchschmelzen)'));
      cutLen += Math.hypot(c.x2 - c.x1, c.y2 - c.y1);
      g0(c.x2, safeY, 'zurück auf Sicherheitshöhe');
    });
    g0(0, safeY, 'über den Block zurück');
    g0(0, 0, 'zurück auf den Maschinennullpunkt (X0/Y0)');
    if (opt.heat != null) em('M5 ; Draht AUS');
    em('M2 ; Ende');
    return { text: out.join('\n'), lines: out.length, cutLength: cutLen, cuts: opt.cuts || [] };
  }

  global.BlockPrep = { cutsFor, gcode };
})(window);
