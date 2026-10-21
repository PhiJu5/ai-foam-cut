/* model3d_gcode.js — G-Code-TEXT für den Reiter „3D-Modell" (Segment + Platte).
 * Abwählbare Funktion „gcodegen" (features.json). Die Bahnen (Türme, Profile,
 * Platten-Layout, kollisionsfreie Verbindungen) rechnet model3d.js selbst
 * (Model3D.buildSegmentPaths / buildPlatePaths) und liefert die Fahrten als Daten
 * ({x,y,u,v} bereits formatiert, F, k = Art). Hier werden daraus die G-Code-Zeilen
 * samt Kopf gemacht und als Model3D.buildSegmentGcode / buildPlateGcode nachgerüstet.
 * Fehlt diese Datei, gibt es keinen 3D-Modell-G-Code (sidebar.js modelGcode/plateGcode
 * prüfen das). Am 2026-09-13 aus model3d.js herausgelöst. */
(function () {
  'use strict';
  if (!window.Model3D) return;
  const T = (s) => (window.I18N ? window.I18N.t(s) : s);
  const KEYS = [['x', 'axX'], ['y', 'axY'], ['u', 'axU'], ['v', 'axV']];
  function portal(o, s) {
    return T('Portal ') + o.axX + o.axY + '=' + s.vL.toFixed(0) + ' ' + o.axU + o.axV + '=' + s.vR.toFixed(0)
      + T(', Werkstück=') + s.vW.toFixed(0) + ' mm/min';
  }
  function note(o, m) {
    switch (m.k) {
      case 'start': return T('Start am Nullpunkt (0,0)');
      case 'up': return T('senkrecht von Null hoch auf Eintrittshöhe');
      case 'lead': return T('waagerecht heran (Anfahrabstand ') + m.lead.toFixed(1) + ' mm)';
      case 'enter': return m.seg ? T('Teil ') + m.seg + T(': einfahren')
        : (m.dir === 'top' || m.dir === 'bottom') ? T('senkrecht in den Eindringpunkt') : T('waagerecht in den Eindringpunkt');
      case 'cut': return portal(o, m.spd);
      case 'close': return portal(o, m.spd) + T(' · Kontur schließen');
      case 'safeUp': return T('hoch auf Sicherheitshöhe');
      case 'over': return T('über den Block');
      case 'down': return T('herab zum Anfahrpunkt');
      case 'under': return T('unter dem Block zum Anfahrpunkt');
      case 'exit': return T('Ausfahrt auf dem Anfahrweg');
      case 'backUp': return T('hoch auf Sicherheitshöhe');
      case 'bcOver': return T('Blockschnitt: über die Blockfläche');
      case 'bcCut': return T('Blockschnitt: durch den Block');
      case 'bcUp': return T('Blockschnitt: im Schnittspalt hoch');
      case 'backX': return m.y != null ? T('zurück auf Null-X') : T('waagerecht zurück auf Null-X');
      case 'backY': return T('senkrecht herab auf Null (0,0)');
      case 'out': return T('heraus in Freiraum');
      case 'end': return T('Ende am Nullpunkt (0,0)');
      case 'conn': return T('Verbindung → Teil ') + m.seg + T(m.edited ? ' (manuell)' : ' (frei)');
      case 'connEnd': return T('zurück zum Nullpunkt') + T(m.edited ? ' (manuell)' : ' (frei)');
      default: return '';
    }
  }
  function line(o, m) {
    const parts = [];
    KEYS.forEach(([k, a]) => { if (m[k] != null) parts.push(o[a] + m[k]); });
    const c = note(o, m);
    return 'G1 ' + parts.join(' ') + ' F' + m.F + (c ? ' ; ' + c : '');
  }
  // Drahtheizung EIN: S-Wert (auf $30 skaliert) aus mgOpt, sonst roher Prozentwert.
  function wireOn(o, heat) {
    const s = o.heatS != null ? o.heatS : Math.round(heat);
    return 'M3 S' + s + ' ; ' + T('Draht ein') + ' (' + (+heat).toFixed(0) + ' %)';
  }
  function segmentText(r) {
    const o = r.opt, mt = r.meta, ki = mt.kerfInfo, out = [];
    // Hinweis: NICHT das Muster „Segment <Zahl>" verwenden — die 3D-Simulation
    // deutet das als Segment-Marker (`; SEGMENT n`). Daher „Teil … von …".
    out.push('; ' + T('AI Foam Cut · 3D-Modell · Teil ') + (mt.seg + 1) + T(' von ') + mt.nseg);
    out.push('; ' + T('Datei: ') + mt.name + T(' — Schnittachse ') + mt.axis);
    out.push('; ' + T('Regelflächenschnitt zwischen zwei Stirnprofilen (') + mt.N + T(' Punkte)'));
    if (ki && ki.mode === 'speed')
      out.push('; ' + T('Abbrand lokal (Bahngeschwindigkeit): ')
        + ki.info.aMin.toFixed(2) + '–' + ki.info.aMax.toFixed(2) + ' / '
        + ki.info.bMin.toFixed(2) + '–' + ki.info.bMax.toFixed(2) + ' mm');
    else if (ki && ki.mode === 'ratio')
      out.push('; ' + T('Abbrand (Profillängen-Verhältnis): ') + ki.kA.toFixed(2) + ' / ' + ki.kB.toFixed(2) + ' mm');
    else if (mt.kerf > 0) out.push('; ' + T('Abbrand ') + mt.kerf.toFixed(2) + ' mm');
    out.push('; ' + T('Spannweite (Ebenenabstand) = ') + mt.span.toFixed(1) + T(' mm · Maschinenbreite ') + mt.mw.toFixed(0) + ' mm');
    const AP = { rear: 'hinten', top: 'oben', front: 'vorne', bottom: 'unten' };
    const BC = { before: 'Blockschnitt vor Formschnitt', after: 'Blockschnitt nach Formschnitt', only: 'Nur Blockschnitt' };
    if (r.cutOrder !== 'only') out.push('; ' + T('Anfahrt von ') + T(AP[r.approach] || 'hinten'));
    if (BC[r.cutOrder]) out.push('; ' + T(BC[r.cutOrder]) + ' · ' + T('Block ') + (r.block[2] - r.block[0]).toFixed(1) + ' x ' + (r.block[3] - r.block[1]).toFixed(1) + ' mm');
    out.push('G21 ; mm');
    out.push('G90 ; ' + T('absolut'));
    out.push('; ' + T('Nullpunkt: linke untere Ecke (per Set Home der Maschine setzen)'));
    if (mt.heat > 0) out.push(wireOn(o, mt.heat));
    r.moves.forEach(m => {
      if (m.k === 'backX' && mt.heat > 0) out.push('M5 ; ' + T('Draht aus'));
      out.push(line(o, m));
    });
    return out.join('\n') + '\n';
  }
  function plateText(r) {
    const o = r.opt, mt = r.meta, bb = mt.bb, out = [];
    out.push('; ' + T('AI Foam Cut · 3D-Modell · Platte — ') + mt.n + T(' Segmente · Dicke ') + mt.span.toFixed(1) + ' mm');
    out.push('; ' + T('Platte (Block): ') + (bb[2] - bb[0]).toFixed(1) + ' x ' + (bb[3] - bb[1]).toFixed(1) + T(' mm (B x H) · Bereich h ')
      + bb[0].toFixed(1) + '…' + bb[2].toFixed(1) + ' / v ' + bb[1].toFixed(1) + '…' + bb[3].toFixed(1));
    out.push('; ' + T('Verbindungswege kollisionsfrei (nur durch Freiraum zwischen den Teilen)'));
    out.push('G21 ; mm'); out.push('G90 ; ' + T('absolut'));
    // Verbindungen laufen durch den Schaum der Platte -> Draht bleibt bis zum Ende heiß.
    const heat = o.heat > 0;
    if (heat) out.push(wireOn(o, o.heat));
    r.moves.forEach(m => out.push(line(o, m)));
    if (heat) out.push('M5 ; ' + T('Draht aus'));
    return out.join('\n') + '\n';
  }
  Model3D.buildSegmentGcode = function (seg, opt) {
    const r = Model3D.buildSegmentPaths(seg, opt); if (!r) return null;
    r.text = segmentText(r); return r;
  };
  Model3D.buildPlateGcode = function (pls, opt) {
    const r = Model3D.buildPlatePaths(pls, opt); if (!r) return null;
    r.text = plateText(r); return r;
  };
})();
