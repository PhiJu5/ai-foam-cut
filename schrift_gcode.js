/* schrift_gcode.js — G-Code-TEXT für den Reiter „Schriften".
 * Gehört zur abwählbaren Funktion „gcodegen" (features.json): Die Bahnen (Teile,
 * Einschnitte, Verbindungswege, Abbrand) rechnet schrift.js selbst und liefert sie
 * als Daten (Schrift.machineMoves → {X, Y, F, k, cut}). Hier werden daraus die
 * G1-Zeilen samt Kopf gemacht. Beide Portale fahren dieselbe Bahn (XY = UV,
 * gerader Draht) — die Buchstaben sind Prismen mit der Blockdicke als Tiefe.
 * Fehlt diese Datei, zeigt der G-Code-Reiter nur die Bahnvorschau. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  function note(m) {
    switch (m.k) {
      case 'start': return T('Start am Nullpunkt (0,0)');
      case 'air': return T('in Luft (außerhalb des Blocks)');
      case 'travel': return T('Verbindungsweg (Abfall)');
      case 'enter': return T('Teil: Einstieg seitlich');
      case 'slit': return T('Einschnitt in die Innenform');
      case 'hole': return T('Innenform');
      default: return '';
    }
  }
  function schriftGcode() {
    if (!window.Schrift || !Schrift.machineMoves) return null;
    const mm = Schrift.machineMoves(); if (!mm) return null;
    const c = App.state.cfg, P = c.precision != null ? c.precision : 3, f = v => (+v).toFixed(P);
    const ax = [c.axX || 'X', c.axY || 'Y', c.axU || 'Z', c.axV || 'A'], m = mm.meta, out = [];
    const em = s => out.push(window.I18N && window.I18N.tc ? window.I18N.tc(s) : s);
    em('; AI Foam Cut · ' + T('Schriften') + ' · „' + String(m.text).replace(/\s*\n\s*/g, ' / ').slice(0, 60) + '"');
    em('; ' + T('Schrift: ') + m.font + ' · ' + T('Versalhöhe ') + m.H.toFixed(1) + ' mm' + (m.w ? ' · ' + T('Strich ') + m.w.toFixed(1) + ' mm' : ''));
    em('; ' + T('Block ') + m.block.w.toFixed(1) + ' x ' + m.block.h.toFixed(1) + ' x ' + m.block.d.toFixed(1) + ' mm · ' + T('Lage X/Y ') + (+m.block.x).toFixed(1) + ' / ' + (+m.block.y).toFixed(1) + ' mm');
    em('; ' + T('Teile: ') + m.pieces + ' · ' + T('Einschnitte: ') + m.slits + ' · ' + T('Abbrand ') + m.kerf.toFixed(2) + ' mm · ' + T('Schnittlänge ') + (m.cutLen / 1000).toFixed(2) + ' m');
    em('; ' + T('Nullpunkt: links unten vor dem Block (Blocklage X/Y), beide Portale fahren dieselbe Bahn'));
    em('; ' + T(m.topFirst === false ? 'Je Teil: seitlich einfahren, Unterseite zuerst, dann Oberseite' : 'Je Teil: seitlich einfahren, Oberseite zuerst, dann Unterseite'));
    em('; ' + T('erzeugt: ') + new Date().toISOString());
    em('G21 ; mm');
    em('G90 ; absolut');
    if (c.header) String(c.header).split('\n').forEach(l => em(l));
    if (m.heat != null) {
      em('; ' + T('Drahtheizung: ') + m.heat + ' %');
      em('M3 S' + (m.wireS != null ? m.wireS : Math.round(m.heat)) + ' ; ' + T('Drahtheizung EIN'));
    }
    let lastK = '';
    mm.moves.forEach((mv, i) => {
      const x = f(mv.X), y = f(mv.Y);
      const cm = mv.k !== lastK ? note(mv) : '';
      lastK = mv.k;
      em((i === 0 ? 'G0 ' : 'G1 ') + ax[0] + x + ' ' + ax[1] + y + ' ' + ax[2] + x + ' ' + ax[3] + y + (i === 0 ? '' : ' F' + Math.round(mv.F)) + (cm ? ' ; ' + cm : ''));
    });
    if (m.heat != null) em('M5 ; ' + T('Drahtheizung AUS'));
    if (c.footer) String(c.footer).split('\n').forEach(l => em(l));
    em('M2 ; ' + T('Ende'));
    const text = out.join('\n') + '\n';
    return { text, meta: m, scene: Schrift.buildScene(mm), cutLengthFoam: m.cutLen, estMinutes: m.minutes };
  }
  App.schriftGcode = schriftGcode;
})();
