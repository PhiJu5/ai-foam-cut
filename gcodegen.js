/* gcodegen.js — G-Code-ERZEUGUNG Heißdraht (Kern/Profilschnitt, Negativschale, DXF-Formen,
 * Guillotine, Block horizontal, Abbrand-Kalibrierung) samt Nachläufen (Aufheizphase, G93,
 * Wasserzeichen) und autoGen() für den Reiter „G-Code".
 * Abwählbare Funktion „gcodegen" (features.json). Ohne diese Datei erzeugt das Programm
 * KEINEN Heißdraht-G-Code: der Reiter „G-Code" zeigt dann nur geladene Dateien in der
 * Simulation (Design-Ausgabe). Andere Module rufen die Namen hier nur geschützt auf
 * (App.autoGen && App.autoGen(), App.genOne, App.negGcode, App.applyFeedMode …).
 * Am 2026-09-13 aus gcode.js (und dxfGcode aus dxfshapes.js) herausgelöst. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state, blockOrigin, safeHeight, outsideFeed, blockCutGeom, shellCutGeom, sweepProj2, negProjection } = App;
  const { buildScene, buildNegScene, setGcode, setGcodeEditMode, feedJumpLines, demoOn } = App;

  // Kommentar zur Drahtheizung im G-Code-Kopf: konstant oder (mit zweitem
  // Heizungs-Kalibrierpunkt) aus dem Vorschub interpoliert.
  function heatNote() {
    return App.heatPair(App.matIdFor()).varies
      ? T(' % (aus Kalibrierung langsam/schnell für Vorschub ') + state.cfg.feed + ' mm/min)'
      : T(' % (konstant während des Schnitts)');
  }
  function genOne(cut, segIdx) {
    const seg = state.segments[segIdx];
    const pr = App.projectCut(cut, seg);
    const origin = blockOrigin(cut, seg);
    const blockMidFrac = (state.cfg.machineWidth / 2 - pr.zRoot) / ((pr.zTip - pr.zRoot) || 1);
    const opt = {
      ax: { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV },
      feed: state.cfg.feed, wireHeat: App.currentHeat(), wireS: App.currentWireS(), wireNote: heatNote(), safeY: safeHeight(), precision: state.cfg.precision,
      blockMidFrac: Math.max(0, Math.min(1, blockMidFrac)),
      maxFeed: state.cfg.maxFeed || 0, outsideFeed: outsideFeed(),
      origin: origin,
      meltDwell: +state.material.meltDwell || 0,
      cutMode: state.cfg.cutOrder,
      profileDir: state.cfg.profileDir,
      // Schnittrichtung „von vorne" (Nase zum Nullpunkt, zwei Züge Nase → Endleiste).
      cutDir: App.cutFront && App.cutFront() ? 'front' : 'rear',
      // Nur eine Profilseite schneiden ('top'/'bottom'; sonst beide).
      cutSides: state.cfg.cutSides || 'both',
      blockCut: state.cfg.cutOrder !== 'none' ? blockCutGeom(cut, seg, pr) : null,
      // Blocklage auch ohne Blockschnitt: „von vorne" entscheidet damit, ob Ein-/
      // Ausläufe in Luft (Außen-Vorschub) oder durch Verschnitt (Schnittvorschub) laufen.
      blockBox: blockCutGeom(cut, seg, pr),
      shellCut: state.cfg.shellCut ? shellCutGeom(cut, seg, pr) : null,
      header: (state.cfg.header ? state.cfg.header + '\n' : '') + '; --- Segment ' + (segIdx + 1) + ' ---',
      footer: state.cfg.footer
    };
    // Schnittzeitpunkt je Holm (App.sparModeOf): 'during' steckt bereits in der
    // Bahn (applySparCuts); 'afterTop' wird HotWire an der Nase eingespeist
    // (opt.noseSpar); 'after' folgt nach dem Profil mit Pause. Globaler Schalter
    // „nur Holmausschnitte" (cfg.sparOnly): eigenständiges Programm ohne Profil.
    if (state.cfg.sparCut) App.migrateSparModes();
    if (state.cfg.sparCut && state.cfg.sparOnly) return sparOnlyProgram(pr, cut, segIdx, opt);
    // „Holmschnitt nach Oberseitenschnitt": Profil-Oberseite bis zur Nase, Pause,
    // Holmtaschen von oben, zurück zur Nase, Pause, dann Unterseite. Direkte Fahrten
    // (Nase↔Holmposition auf Sicherheitshöhe) ohne Null-Umweg: sparPocketLines im
    // „inline"-Modus liefert nur Anfahrt→Tasche→Sicherheitshöhe je Holm.
    const spT = state.cfg.sparCut ? sparPocketLines(pr, cut, segIdx, Object.assign({}, opt, { inline: true, modeFilter: 'afterTop' })) : null;
    const optT = Object.assign({}, opt, { noseSpar: (spT && spT.body.length) ? spT.body : null });
    const g0 = HotWire.gcode(pr, optT);
    const g = { text: g0.text, lines: g0.lines,
      cutLengthFoam: (g0.cutLengthFoam || 0) + (spT ? spT.foam : 0),
      estMinutes: (g0.estMinutes || 0) + (spT ? spT.mins : 0) };
    if (!state.cfg.sparCut) return g;
    // „nach dem Schnitt": Profil normal, dann Pause (M0) und die Taschen separat.
    const sp = sparPocketLines(pr, cut, segIdx, Object.assign({}, opt, { modeFilter: 'after' }));
    if (!sp || !sp.body.length) return g;
    const lines = g.text.split('\n');
    // Einfügen vor dem LETZTEN M5 (Drahtheizung AUS am Programmende) — ein früheres
    // M5 gehört zur Pause „nach Oberseitenschnitt" anderer Holme.
    let ins = -1;
    for (let i = lines.length - 1; i >= 0; i--) if (/^\s*M5\b/.test(lines[i])) { ins = i; break; }
    if (ins < 0) ins = lines.findIndex(l => /^\s*M2\b/.test(l));
    if (ins < 0) ins = lines.length;
    const tc = s => window.I18N ? window.I18N.tc(s) : s;
    const pause = [tc('; --- ' + T('Holmausschnitte nach dem Profilschnitt') + ' ---'),
      tc('M0 ; ' + T('AUTO-PAUSE: Profil fertig. Im Reiter „Schneiden“ auf „Fortsetzen“ drücken (Holmausschnitte)'))];
    const merged = lines.slice(0, ins).concat(pause, sp.body, lines.slice(ins));
    return { text: merged.join('\n'), lines: merged.length,
      cutLengthFoam: (g.cutLengthFoam || 0) + sp.foam, estMinutes: (g.estMinutes || 0) + sp.mins };
  }
  /* Eigenständige Holmausschnitte (Modus „nach dem Schnitt“ und „nur Holm“). Je
   * Holm: von der Sicherheitshöhe senkrecht über dem Einstich auf die Oberfläche,
   * über den Anfahr-Schlitz in die Tasche, einmal herum und über die Höhe wieder
   * heraus. Anfahrt IMMER von oben (der Kern ist bereits frei geschnitten), damit
   * kein Durchstich durch den ganzen Kern nötig ist. Turmbahnen inkl. Sweep-
   * Drehung projiziert. Rückgabe { body:[Zeilen], foam, mins }. */
  function sparPocketLines(pr, cut, segIdx, opt) {
    // Nur Loch-Holme (Gurttaschen stecken immer in der Profilbahn); opt.modeFilter
    // wählt den Schnittzeitpunkt ('after'/'afterTop'), ohne Filter alle (Programm
    // „nur Holmausschnitte").
    const spars = (state.spars || []).filter(sp => App.sparAppliesTo(sp, segIdx) && !App.isPocket(sp)
      && (!opt.modeFilter || App.sparModeOf(sp) === opt.modeFilter));
    if (!spars.length) return { body: [], foam: 0, mins: 0 };
    const ax = opt.ax, p = opt.precision != null ? opt.precision : 3, f = v => v.toFixed(p);
    const ox = (opt.origin && opt.origin.x) || 0, oy = (opt.origin && opt.origin.y) || 0;
    // Nullpunkt hinter der Endleiste (sx −1, X = ox − x) oder bei „von vorne" vor der Nase (sx +1).
    const sx = (opt.origin && opt.origin.sx) || -1;
    const fx = sx > 0 ? (v => (v - ox).toFixed(p)) : (v => (ox - v).toFixed(p)), fy = v => (v - oy).toFixed(p);
    const zR = pr.zRoot, zT = pr.zTip, mw = state.cfg.machineWidth, rot = pr.sweepRot;
    const feed = opt.feed, safeY = opt.safeY;
    const maxFeed = opt.maxFeed || 0, capF = v => (maxFeed > 0 ? Math.min(v, maxFeed) : v);
    const maxMove = maxFeed > 0 ? maxFeed : 3000;
    const body = [], em = s => body.push(window.I18N ? window.I18N.tc(s) : s);
    let foam = 0, mins = 0, cutAny = false;
    // Gemeinsame Ausgabe einer Wurzel-/Rand-Sequenz (2D-Rippenpunkte, gleiche
    // Punktzahl): auf Sicherheitshöhe über den ersten Punkt, senkrecht einstechen,
    // Sequenz abfahren, am letzten Punkt senkrecht heraus auf Sicherheitshöhe.
    function emitSeq(Rex, Tex, label) {
      const n = Math.min(Rex.length, Tex.length); if (n < 2) return false;
      const L = [], R = [];
      for (let i = 0; i < n; i++) {
        L.push(sweepProj2(rot, zR, zT, Rex[i].x, Rex[i].y, Tex[i].x, Tex[i].y, 0));
        R.push(sweepProj2(rot, zR, zT, Rex[i].x, Rex[i].y, Tex[i].x, Tex[i].y, mw));
      }
      em('; --- ' + label + ' ---');
      // „inline" (Modus „nach Oberseitenschnitt"): KEIN Umweg über X0 — der Draht
      // ist bereits auf Sicherheitshöhe und fährt direkt über den Einstich.
      if (!opt.inline && !cutAny)
        em(`G1 ${ax.x}${f(0)} ${ax.y}${f(safeY)} ${ax.u}${f(0)} ${ax.v}${f(safeY)} F${maxMove.toFixed(0)} ; hoch auf Sicherheitshöhe (max)`);
      em(`G1 ${ax.x}${fx(L[0].x)} ${ax.y}${f(safeY)} ${ax.u}${fx(R[0].x)} ${ax.v}${f(safeY)} F${maxMove.toFixed(0)} ; über den Einstich (max)`);
      em(`G1 ${ax.x}${fx(L[0].x)} ${ax.y}${fy(L[0].y)} ${ax.u}${fx(R[0].x)} ${ax.v}${fy(R[0].y)} F${capF(feed).toFixed(0)} ; senkrecht auf die Oberfläche einstechen`);
      for (let i = 1; i < n; i++) {
        const dL = Math.hypot(L[i].x - L[i - 1].x, L[i].y - L[i - 1].y);
        const dR = Math.hypot(R[i].x - R[i - 1].x, R[i].y - R[i - 1].y);
        const dMax = Math.max(dL, dR);
        const dRoot = Math.hypot(Rex[i].x - Rex[i - 1].x, Rex[i].y - Rex[i - 1].y);
        // Sub-Auflösungs-Segmente (< 0,02 mm, z. B. Taschen-Schließpunkt) NICHT über
        // feed·dMax/dRoot hochrechnen — dRoot≈0 würde F auf maxFeed hochreißen
        // (Geschwindigkeitsspitze). Solche Kleinstschritte mit feed fahren.
        const F = dRoot > 0.02 ? capF(feed * dMax / dRoot) : capF(feed);
        const vRoot = dMax > 1e-6 ? dRoot * F / dMax : F;
        em(`G1 ${ax.x}${fx(L[i].x)} ${ax.y}${fy(L[i].y)} ${ax.u}${fx(R[i].x)} ${ax.v}${fy(R[i].y)} F${F.toFixed(0)}`);
        foam += dRoot; mins += vRoot > 1e-6 ? dRoot / vRoot : 0;
      }
      em(`G1 ${ax.x}${fx(L[n - 1].x)} ${ax.y}${f(safeY)} ${ax.u}${fx(R[n - 1].x)} ${ax.v}${f(safeY)} F${maxMove.toFixed(0)} ; heraus auf Sicherheitshöhe (max)`);
      cutAny = true;
      return true;
    }
    spars.forEach(sp => {
      const no = (state.spars || []).indexOf(sp) + 1;
      try {
        const topSp = Object.assign({}, sp, { approach: 'top' });   // immer von oben anfahren
        const yco = App.sparYc(sp);
        const coreR = App.sparCoreOf(cut.root.pts, segIdx, 'root'), coreT = App.sparCoreOf(cut.tip.pts, segIdx, 'tip');
        const gr = App.sparOnProfile(topSp, cut.root.pts, coreR || cut.root.pts, App.sparFromLE(sp, segIdx, 'root'), yco, 'root', coreR);
        const gt = App.sparOnProfile(topSp, cut.tip.pts, coreT || cut.tip.pts, App.sparFromLE(sp, segIdx, 'tip'), yco, 'tip', coreT);
        if (!gr || !gr.lead || !gt || !gt.lead) return;   // reicht bis zur Oberfläche -> überspringen
        const kh = App.sparKerfHalf(sp, cut, gr.poly, gt.poly);   // Abbrand je Rippe (Modus/Bezug: global oder je Holm)
        // Ecken-Anker nur bei gleicher Ecken-Anzahl an Wurzel und Rand (s. applySparCuts).
        const kR = App.kerfKeepTopology(gr.lead[1], gr.poly, gr.lead[0], kh.root, cut.root.pts, false);
        const kT = App.kerfKeepTopology(gt.lead[1], gt.poly, gt.lead[0], kh.tip, cut.tip.pts, false);
        const hpR = App.holeLoopPrep(gr.lead[1], gr.poly, gr.lead[0], kR, cut.root.pts, false);
        const hpT = App.holeLoopPrep(gt.lead[1], gt.poly, gt.lead[0], kT, cut.tip.pts, false);
        const noAnchor = App.loopAnchors(hpR.loop).anchors.length !== App.loopAnchors(hpT.loop).anchors.length;
        const Rex = App.holeExcursionFinish(gr.lead[1], hpR.loop, hpR.corner, false, noAnchor);
        const Tex = App.holeExcursionFinish(gt.lead[1], hpT.loop, hpT.corner, false, noAnchor);
        if (Math.min(Rex.length, Tex.length) < 3) return;
        emitSeq(Rex, Tex, T('Holm ') + no + T(' · Holmausschnitt'));
      } catch (e) { /* einzelnen Holm überspringen */ }
    });
    if (cutAny && !opt.inline) {
      em(`G1 ${ax.x}${f(0)} ${ax.y}${f(safeY)} ${ax.u}${f(0)} ${ax.v}${f(safeY)} F${maxMove.toFixed(0)} ; über den Block zurück (max)`);
      em(`G1 ${ax.x}${f(0)} ${ax.y}${f(0)} ${ax.u}${f(0)} ${ax.v}${f(0)} F${maxMove.toFixed(0)} ; zurück auf den Nullpunkt (max)`);
    }
    return { body, foam, mins };
  }
  /* Vollständiges Programm „nur Holmausschnitt“ (kein Profil/Block). */
  function sparOnlyProgram(pr, cut, segIdx, opt) {
    const ax = opt.ax, p = opt.precision != null ? opt.precision : 3, f = v => v.toFixed(p);
    const out = [], em = s => out.push(window.I18N ? window.I18N.tc(s) : s);
    em('; ==== HotWing 4-Achs Heißdraht G-Code — nur Holmausschnitte ====');
    em('; ' + T('Achsen: L=') + ax.x + ax.y + '  R=' + ax.u + ax.v);
    em('; ' + T('erzeugt: ') + new Date().toISOString());
    em('G21 ; mm'); em('G90 ; absolut');
    if (opt.wireHeat != null) {
      em('; ' + T('Drahtheizung: ') + opt.wireHeat + (opt.wireNote || T(' % (konstant während des Schnitts)')));
      em('M3 S' + (opt.wireS != null ? opt.wireS : (+opt.wireHeat).toFixed(0)) + ' ; Drahtheizung EIN');
    }
    if (opt.header) opt.header.split('\n').forEach(l => em(l));
    em(`G0 ${ax.x}${f(0)} ${ax.y}${f(0)} ${ax.u}${f(0)} ${ax.v}${f(0)} ; `
      + ((opt.origin && opt.origin.sx > 0) ? 'Start am Maschinennullpunkt (vorne/unten)' : 'Start am Maschinennullpunkt (hinten/unten)'));
    const sp = sparPocketLines(pr, cut, segIdx, opt);
    if (sp && sp.body.length) sp.body.forEach(l => out.push(l));
    else em('; ' + T('Keine Holmausschnitte in diesem Segment.'));
    if (opt.wireHeat != null) em('M5 ; Drahtheizung AUS');
    em('M2 ; Ende');
    if (opt.footer) opt.footer.split('\n').forEach(l => em(l));
    return { text: out.join('\n'), lines: out.length,
      cutLengthFoam: sp ? sp.foam : 0, estMinutes: sp ? sp.mins : 0 };
  }

  /* Guillotine: vom unteren Punkt (xDist, Y0) unter dem gewählten Winkel rauf
   * bis zur Höhe, dort Pause (M0), dann auf gleicher Linie runter auf Y0. */
  function guillotineGcode() {
    const gp = state.guillotine;
    const ax = { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV };
    const pr = state.cfg.precision != null ? state.cfg.precision : 2, f = v => v.toFixed(pr);
    const feed = gp.feed || 300, H = gp.height, ang = (gp.angle || 0) * Math.PI / 180;
    const rapid = state.cfg.maxFeed || 0;         // Eilgang-Vorschub aus den Maschinendaten (0 = echtes G0)
    const upCut = gp.upMode === 'cut';            // rauf im Schnitt (Vorschub) statt Eilgang?
    const upHeat = upCut;                          // Schnitt → Draht automatisch EIN, Eilgang → automatisch AUS
    const xBot = gp.xDist, xTop = gp.xDist + H * Math.tan(ang);
    // Überfahrt unter Y0: der Draht fährt auf derselben Linie um overY ins Negative,
    // damit er sicher ganz durchschneidet (Y0 liegt evtl. knapp über der Auflage).
    const over = Math.abs(+gp.overY || 0), yEnd = -over, xEnd = xBot - over * Math.tan(ang);   // overY ist negativ (Y-Ziel), Betrag = Weg
    const out = [], em = s => out.push(window.I18N ? window.I18N.tc(s) : s);
    const g0 = (x, y, c) => em(`G0 ${ax.x}${f(x)} ${ax.y}${f(y)} ${ax.u}${f(x)} ${ax.v}${f(y)}` + (c ? ' ; ' + c : ''));
    const g1 = (x, y, F, c) => em(`G1 ${ax.x}${f(x)} ${ax.y}${f(y)} ${ax.u}${f(x)} ${ax.v}${f(y)} F${F.toFixed(0)}` + (c ? ' ; ' + c : ''));
    // Rauffahren: entweder Schnitt (G1 mit Vorschub) oder Eilgang (G1 mit Max-Vorschub, sonst echtes G0).
    const gUp = (x, y, c) => upCut ? g1(x, y, feed, c) : (rapid > 0 ? g1(x, y, rapid, c) : g0(x, y, c));
    const upLabel = upCut ? (feed + T(' mm/min (Schnitt)')) : (rapid > 0 ? rapid + T(' mm/min (Eilgang)') : T('G0 (Eilgang)'));
    em('; ==== HotWing – Guillotine-Schnitt ====');
    em('; ' + T('Höhe ') + H + T(' mm · X-Abstand unten ') + gp.xDist + T(' mm · Winkel ') + gp.angle
      + T('° · rauf ') + upLabel + (upHeat ? T(' · Draht rauf EIN') : T(' · Draht rauf AUS')) + T(' · runter Vorschub ') + feed + ' mm/min'
      + (over > 0 ? T(' · Überfahrt bis Y ') + (-over) + ' mm' : ''));
    em('; rauf auf Höhe → Pause → runter im Schnitt auf Y0 (beide Türme identisch) · Bezug Y0 = Maschinen-Nullpunkt');
    if (over > 0) em('; ' + T('ACHTUNG: Schnitt endet bei Y = -') + over + T(' mm (unter dem Nullpunkt) – Verfahrweg/Auflage prüfen! Dort Pause, nach Fortsetzen rauf auf Y0.'));
    em('G21 ; mm'); em('G90 ; absolut'); em('G94 ; Vorschub in mm/min');
    // Startvorschub schon VOR der ersten Bewegung setzen: der erste G1 kommt evtl.
    // erst nach der M0-Pause, sonst meldet der Controller error:22 (Vorschub undefiniert).
    em('F' + feed.toFixed(0) + ' ; Startvorschub setzen');
    const heat = App.currentHeat();
    // Draht nur einschalten, wenn er schon beim Rauffahren heiß sein soll.
    if (heat != null && upHeat) em('M3 S' + App.currentWireS() + ' ; Draht EIN (rauffahren, ' + (+heat).toFixed(0) + ' %)');
    g0(0, 0, 'Start am Maschinennullpunkt (X0/Y0)');
    g0(xBot, 0, 'zum unteren Einstichpunkt (auf Y0)');
    gUp(xTop, H, T('rauf auf gewünschte Höhe (Winkel ') + gp.angle + '°)');
    // Drahtheizung während der Pause AUS (Draht brennt sonst auf der Stelle weiter).
    if (heat != null && upHeat) em('M5 ; Draht AUS für die Pause');
    em('M0 ; AUTO-PAUSE: auf Höhe erreicht. Im Reiter „Schneiden" auf „Fortsetzen" drücken');
    // Nach Fortsetzen: Heizung EIN und aufheizen — direkt vor dem Abwärtsschnitt.
    // Aufheizzeit nach der Pause (Draht war aus) fügt applyPauseReheat ein.
    if (heat != null) em('M3 S' + App.currentWireS() + ' ; Draht EIN (nach Fortsetzen, ' + (+heat).toFixed(0) + ' %)');
    g1(xBot, 0, feed, T('runter auf Y0 (Winkel ') + gp.angle + '°)');
    if (over > 0) g1(xEnd, yEnd, feed, T('Überfahrt unter Y0 (sicher durchschneiden, bis Y ') + (-over) + ' mm)');
    const dwl = +state.material.meltDwell || 0;
    if (dwl > 0) em('G4 P' + dwl + ' ; ' + T('am Nullpunkt verweilen (durchschmelzen)'));
    if (over > 0) {
      // Unten anhalten: Pause (Draht bleibt EIN), nach „Fortsetzen“ Draht AUS und im Eilgang zurück auf Y0.
      em('M0 ; AUTO-PAUSE: unten (Überfahrt erreicht). Im Reiter „Schneiden" auf „Fortsetzen" drücken');
      if (heat != null) em('M5 ; Draht AUS (nach Fortsetzen)');
      g0(xBot, 0, T('nach Fortsetzen: rauf auf Y0 (Eilgang, Draht aus)'));
    }
    g0(0, 0, 'zurück auf den Maschinennullpunkt');
    if (heat != null && !(over > 0)) em('M5 ; Draht AUS');
    em('M2 ; Ende');
    // Bewusst OHNE applyPreheat (kein Aufheizen beim ersten Hochfahren) — aber
    // die Aufheizzeit nach der Pause mit ausgeschaltetem Draht wird eingerechnet.
    const text = applyPauseReheat(out.join('\n'));
    return { text, lines: text.split('\n').length, cutLength: 2 * Math.hypot(xBot - xTop, H) + 2 * Math.hypot(xEnd - xBot, over) };
  }
  /* Block horizontal: waagrechte, planare Schnitte über die Blocklänge (beide
   * Türme identisch). mode='height' trennt nur oben auf Zielhöhe yTop (von hinten
   * Richtung Nullpunkt); mode='topbottom' fährt durchgehend oben rein → hinten
   * runter → unten durch (fertige Scheibe zwischen yBot und yTop). Abbrand wird
   * nach außen (weg vom Gutteil) kompensiert, damit die Höhe exakt stimmt. */
  function blockHGcode() {
    const bp = state.blockH;
    const ax = { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV };
    const pr = state.cfg.precision != null ? state.cfg.precision : 2, f = v => v.toFixed(pr);
    const feed = bp.feed || 300, k = App.kerfForSpeed(App.matIdFor('wing'), feed);
    const over = Math.max(0, +(bp.over != null ? bp.over : 10) || 0);   // X-Überlauf vor/hinter dem Block (Menü „Block horizontal")
    const d1 = bp.dist, d2 = bp.dist + bp.length;
    const xL = d1 - over, xR = d2 + over;          // X-Überlauf: Schnitt tritt beidseits aus dem Block aus
    const topbottom = bp.mode === 'topbottom';
    const yTopC = bp.yTop + k / 2;                 // oben: Draht kerf/2 nach außen (+Y)
    const yBotC = Math.max(0, bp.yBot - k / 2);    // unten: kerf/2 nach außen (−Y)
    const safeY = bp.yTop + (state.material.safeH || 20);
    const out = [], em = s => out.push(window.I18N ? window.I18N.tc(s) : s);
    const g0 = (x, y, c) => em(`G0 ${ax.x}${f(x)} ${ax.y}${f(y)} ${ax.u}${f(x)} ${ax.v}${f(y)}` + (c ? ' ; ' + c : ''));
    const g1 = (x, y, F, c) => em(`G1 ${ax.x}${f(x)} ${ax.y}${f(y)} ${ax.u}${f(x)} ${ax.v}${f(y)} F${F.toFixed(0)}` + (c ? ' ; ' + c : ''));
    em('; ==== HotWing – Block horizontal ====');
    em('; ' + (topbottom ? T('Ober- und Unterseite') : T('Auf Höhe ablängen (nur oben)'))
      + T(' · Block X ') + d1 + ' … ' + d2 + T(' mm · yTop ') + bp.yTop + (topbottom ? T(' mm · yBot ') + bp.yBot + T(' mm') : ' mm')
      + T(' · Vorschub ') + feed + ' mm/min' + T(' · Überlauf X ') + over + ' mm');
    em('; ' + T('Abbrand ') + k.toFixed(2) + T(' mm kompensiert (nach außen) · Bezug Y0 = Maschinen-Nullpunkt · beide Türme identisch'));
    em('G21 ; mm'); em('G90 ; absolut'); em('G94 ; Vorschub in mm/min');
    // Startvorschub VOR der ersten Bewegung setzen -> verhindert error:22 (Vorschub undefiniert).
    em('F' + feed.toFixed(0) + ' ; Startvorschub setzen');
    const heat = App.currentHeat();
    const wireOn = () => { if (heat != null) em('M3 S' + App.currentWireS() + ' ; Draht EIN (' + (+heat).toFixed(0) + ' %)'); };
    // Ablauf-Wahl nur bei „Auf Höhe ablängen": rapidCut = Eilgang über die Oberkante
    // hin, Schnitt zurück; cutRapid = Schnitt hin, Eilgang im Spalt zurück (Standard);
    // cutCut = Schnitt hin und zurück. „Ober-/Unterseite" hat einen festen Ablauf.
    // Draht bei ALLEN Abläufen von Anfang an ein: die Eilgang-Anfahrt bei rapidCut
    // läuft rein in der Luft (über/hinter dem Block), und so sitzt die Aufheizphase
    // (applyPreheat) korrekt beim ersten Hochfahren und nicht vor dem M3.
    const pass = topbottom ? 'cutRapid' : (bp.pass || 'cutRapid');
    if (!topbottom) em('; ' + ({
      rapidCut: 'Ablauf: Eilgang über die Oberkante nach hinten, dann Schnitt zurück nach vorn (Abfall vorn)',
      cutRapid: 'Ablauf: Schnitt nach hinten, Eilgang im Schnittspalt zurück nach vorn (Abfall hinten)',
      cutCut:   'Ablauf: Schnitt nach hinten und wieder zurück nach vorn (beide Kanten sauber)'
    })[pass]);
    wireOn();
    g0(0, 0, 'Start am Maschinennullpunkt (X0/Y0)');
    let cutLen = 0;
    if (!topbottom && pass === 'rapidCut') {
      // Eilgang ÜBER die Blockoberkante hinter den Block (rein in der Luft), dann
      // EIN Schnitt zurück nach vorn. Sicherheitshöhe bezieht sich auf die ECHTE
      // Blockoberkante (nicht yTop), sonst führe die Querfahrt durch den Block.
      // Braucht Freiraum über dem Block UND Platz dahinter (X-Überlauf > 0).
      const safeTop = Math.max(App.blockH(), bp.yTop) + (state.material.safeH || 20);
      g0(0, safeTop, 'hoch auf Sicherheitshöhe');
      g0(xR, safeTop, 'im Eilgang über die Oberkante nach hinten');
      g0(xR, yTopC, 'hinter dem Block runter auf Schnitthöhe yTop');
      g1(0, yTopC, feed, 'waagrecht auf yTop nach vorn durchtrennen');
      cutLen += Math.abs(xR - 0);
      g0(0, 0, 'runter auf den Maschinennullpunkt (X0/Y0)');
    } else if (!topbottom && pass === 'cutCut') {
      // Schnitt nach hinten UND wieder nach vorn (zweiter Durchgang glättet beide
      // Kanten). Pause am hinteren Ende — der weitesten Stelle von X0 — zum Abnehmen
      // des Abfalls, danach zurück nach vorn und runter.
      g0(0, yTopC, 'hoch auf Schnitthöhe yTop (vor dem Block)');
      g1(xR, yTopC, feed, 'waagrecht auf yTop nach hinten durchtrennen');
      em('M0 ; AUTO-PAUSE: hinteres Ende erreicht, Abfall oben abnehmen. Im Reiter „Schneiden" auf „Fortsetzen" drücken');
      g1(0, yTopC, feed, 'waagrecht auf yTop zurück nach vorn (zweiter Durchgang)');
      cutLen += Math.abs(xR - 0) * 2;
      g0(0, 0, 'runter auf den Maschinennullpunkt (X0/Y0)');
    } else if (!topbottom) {
      // Standard (cutRapid), OHNE Sicherheitshöhe: am Nullpunkt (X0) ZUERST senkrecht
      // auf Schnitthöhe hoch, dann in EINEM Zug waagrecht nach hinten durch den Block
      // (der X-Abstand vor dem Block wird in Luft mit Vorschub durchfahren).
      // Am hinteren Ende Pause (Abfall oben abnehmen), dann im Schnittspalt zurück.
      g0(0, yTopC, 'hoch auf Schnitthöhe yTop (vor dem Block)');
      g1(xR, yTopC, feed, 'waagrecht auf yTop nach hinten durchtrennen');
      cutLen += Math.abs(xR - 0);
      em('M0 ; AUTO-PAUSE: hinteres Ende erreicht, Abfall oben abnehmen. Im Reiter „Schneiden" auf „Fortsetzen" drücken');
      g0(0, yTopC, 'im Schnittspalt zurück nach vorn');
      g0(0, 0, 'runter auf den Maschinennullpunkt (X0/Y0)');
    } else {
      // Oben + unten durchgehend: oben rein → hinten runter → unten durch.
      g0(0, safeY, 'hoch auf Sicherheitshöhe');
      g0(xL, safeY, 'vor den Block (Nullpunktseite)');
      g0(xL, yTopC, 'runter auf obere Schnitthöhe yTop (vor dem Block)');
      g1(xR, yTopC, feed, T('oben waagrecht nach hinten durchtrennen'));
      g1(xR, yBotC, feed, T('hinten senkrecht runter auf untere Schnitthöhe yBot'));
      g1(xL, yBotC, feed, T('unten waagrecht nach vorn durchtrennen'));
      cutLen += Math.abs(xR - xL) * 2 + Math.abs(yTopC - yBotC);
      g0(xL, safeY, 'hoch auf Sicherheitshöhe');
      g0(0, safeY, 'über den Block zurück');
      g0(0, 0, 'zurück auf den Maschinennullpunkt (X0/Y0)');
    }
    if (heat != null) em('M5 ; Draht AUS');
    em('M2 ; Ende');
    const text = applyPreheat(out.join('\n'));
    return { text, lines: text.split('\n').length, cutLength: cutLen };
  }
  /* Abbrand-Kalibrierung: schneidet `count` Testrechtecke (Länge×Höhe), gestapelt
   * mit Abstand `gap`, am gewählten Vorschub. Optional um Abbrand/2 nach außen
   * kompensiert (dann sollte das FERTIGE Rechteck das Nennmaß haben). Ohne
   * Kompensation ist es um den Abbrand kleiner -> gemessene Differenz = Abbrand. */
  function calibGcode() {
    const cb = state.calib, id = state.material.id;
    const ax = { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV };
    const pr = state.cfg.precision != null ? state.cfg.precision : 2, f = v => v.toFixed(pr);
    // Drei Kalibrierpunkte: 1 = schnell/Heizstrom 1, 2 = langsam/Heizstrom 1,
    // 3 = langsam/Heizstrom 2 (cb.speed = 'fast' | 'slow' | 'slowH').
    const isSlow = cb.speed === 'slow' || cb.speed === 'slowH', isH2 = cb.speed === 'slowH';
    const feed = (isSlow ? App.feedPair(id).slow : App.feedPair(id).fast) || 300;
    const hp = App.heatPair(id), heat = isH2 ? hp.slow : hp.fast;
    // Punkt 3 hat per Definition den Abbrand von Punkt 1 (Heizstrom 2 darauf kalibriert).
    const kerfPt = isSlow && !isH2 ? App.kerfPair(id).slow : App.kerfPair(id).fast;
    const kerf = cb.withKerf ? kerfPt || 0 : 0;
    const ptName = isH2 ? T('Punkt 3: langsam, Heizstrom 2') : isSlow ? T('Punkt 2: langsam, Heizstrom 1') : T('Punkt 1: schnell, Heizstrom 1');
    const k = kerf / 2;                         // Versatz nach außen
    const L = cb.len, Hh = cb.hgt, n = Math.max(1, cb.count | 0), gap = cb.gap || 0, x0 = cb.xDist || 20, yBase = cb.yBase || 0;
    const xl = x0 - k, xr = x0 + L + k;
    // Rechtecke von OBEN nach UNTEN abarbeiten.
    const rects = [];
    for (let i = 0; i < n; i++) { const yb = yBase + i * (Hh + gap); rects.push({ yBot: yb - k, yTop: yb + Hh + k }); }
    rects.sort((a, b) => b.yTop - a.yTop);
    const safeY = rects[0].yTop + (state.material.safeH || 20);
    const out = [], em = s => out.push(window.I18N ? window.I18N.tc(s) : s);
    const g0 = (x, y, c) => em(`G0 ${ax.x}${f(x)} ${ax.y}${f(y)} ${ax.u}${f(x)} ${ax.v}${f(y)}` + (c ? ' ; ' + c : ''));
    const g1 = (x, y, c) => em(`G1 ${ax.x}${f(x)} ${ax.y}${f(y)} ${ax.u}${f(x)} ${ax.v}${f(y)} F${feed.toFixed(0)}` + (c ? ' ; ' + c : ''));
    em('; ==== HotWing – Abbrand-Kalibrierung ====');
    em('; ' + T('Werkstoff ') + T(App.matField(id, 'name', id)) + ' · ' + ptName + T(' · Vorschub ') + feed + ' mm/min'
      + T(' · Heizung ') + heat + ' %');
    em('; ' + T('Testrechteck ') + L + ' × ' + Hh + T(' mm · Anzahl ') + n + (n > 1 ? T(' (Abstand ') + gap + T(' mm)') : '')
      + T(' · unterstes ') + yBase + T(' mm über Y0 · ') + (cb.withKerf ? T('MIT Abbrand ') + kerf.toFixed(2) + T(' mm komp.') : T('OHNE Abbrand (Rohschnitt)')));
    em('; Ablauf je Viereck: horizontale Anfahrt von X0 (Nullpunkt) → oben → rechts runter → unten → links hoch (schließen) → zurück auf X0 → vertikal zum nächsten.');
    em('; Nach dem Schnitt Ist-Maße messen: Abbrand = Nennmaß − Istmaß (ohne Komp.).');
    em('G21 ; mm'); em('G90 ; absolut');
    if (heat != null) em('M3 S' + App.wireSFor(heat) + ' ; Draht EIN (' + (+heat).toFixed(0) + ' %)');
    g0(0, 0, 'Start am Maschinennullpunkt');
    g0(0, safeY, 'hoch auf Sicherheitshöhe');
    g0(0, rects[0].yTop, 'auf Höhe des obersten Vierecks (am Nullpunkt X0)');
    let cutLen = 0;
    rects.forEach((r, idx) => {
      // Anfahrt IMMER von X0 waagrecht bis zur rechten Kante (schneidet zugleich die Oberkante).
      g1(xr, r.yTop, T('horizontale Anfahrt von X0 + Oberkante — Viereck ') + (idx + 1));
      g1(xr, r.yBot, 'rechte Kante nach unten');
      g1(xl, r.yBot, 'Unterkante nach links');
      g1(xl, r.yTop, 'linke Kante nach oben (Viereck schließen)');
      g1(0, r.yTop, 'horizontal zurück auf X0');
      cutLen += xr + 2 * (r.yTop - r.yBot) + (xr - xl) + xl;
      if (idx < rects.length - 1) g0(0, rects[idx + 1].yTop, 'vertikal nach unten zum nächsten Viereck (am X0)');
    });
    g0(0, safeY, 'hoch auf Sicherheitshöhe'); g0(0, 0, 'zurück auf Y0');
    if (heat != null) em('M5 ; Draht AUS');
    em('M2 ; Ende');
    const text = applyPreheat(out.join('\n'));
    return { text, lines: text.split('\n').length, cutLength: cutLen };
  }

  /* Geschlossene, turmsynchrone Kontur emittieren (Negativschale, Kern-Stege):
   * eintauchen, umfahren, schließen, ausfahren. P = Projektion {ox, oy, zRoot,
   * zTip, mw}, em = Zeilen-Emitter, acc = {foam, time} (Schnittlänge/Zeit
   * werden aufsummiert). Rückgabe: cutContour(rpA, tpA, label). */
  function contourCutter(P, em, acc) {
    const mw = P.mw, ax = { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV };
    const proj = (vr, vt, zp) => vr + (zp - P.zRoot) / ((P.zTip - P.zRoot) || 1) * (vt - vr);
    const pr = state.cfg.precision != null ? state.cfg.precision : 3;
    // P.sx > 0: Nullpunkt vor der Nase (Kerndesign „von vorne"), sonst dahinter.
    const fx = P.sx > 0 ? (v => (v - P.ox).toFixed(pr)) : (v => (P.ox - v).toFixed(pr));
    const fy = v => (v - P.oy).toFixed(pr), f = v => v.toFixed(pr);
    const feed = state.cfg.feed, maxFeed = state.cfg.maxFeed || 0;
    const capF = v => (maxFeed > 0 ? Math.min(v, maxFeed) : v);
    const safeY = (state.cfg.blockY || 0) + App.blockH() + (state.material.safeH || 0);
    return (rpA, tpA, label) => {
      const nn = Math.min(rpA.length, tpA.length), LL = [], RR = [];
      for (let i = 0; i < nn; i++) {
        LL.push({ x: proj(rpA[i].x, tpA[i].x, 0), y: proj(rpA[i].y, tpA[i].y, 0) });
        RR.push({ x: proj(rpA[i].x, tpA[i].x, mw), y: proj(rpA[i].y, tpA[i].y, mw) });
      }
      // Segmentliste der GESCHLOSSENEN Kontur: 0→1 … nn-1→0.
      const seg = [];
      for (let i = 1; i < nn; i++) seg.push([i - 1, i]);
      seg.push([nn - 1, 0]);
      const dRootOf = (a, b) => Math.hypot(rpA[b].x - rpA[a].x, rpA[b].y - rpA[a].y);
      const dLOf = (a, b) => Math.hypot(LL[b].x - LL[a].x, LL[b].y - LL[a].y);
      const dROf = (a, b) => Math.hypot(RR[b].x - RR[a].x, RR[b].y - RR[a].y);
      // Roh-Vorschub je Segment (Werkstück-konstant, auf maxFeed gedeckelt), dann
      // isolierte Spitzen glätten.
      const Fraw = seg.map(([a, b]) => { const dRoot = dRootOf(a, b); return dRoot > 1e-6 ? capF(Math.max(dLOf(a, b), dROf(a, b)) * feed / dRoot) : feed; });
      const F = HotWire.medianDespike(Fraw, true);
      em('; --- ' + label + ' ---');
      em(`G0 ${ax.x}${f(0)} ${ax.y}${f(safeY)} ${ax.u}${f(0)} ${ax.v}${f(safeY)} ; hoch auf Sicherheitshöhe`);
      em(`G0 ${ax.x}${fx(LL[0].x)} ${ax.y}${f(safeY)} ${ax.u}${fx(RR[0].x)} ${ax.v}${f(safeY)} ; über den Startpunkt fahren`);
      em(`G1 ${ax.x}${fx(LL[0].x)} ${ax.y}${fy(LL[0].y)} ${ax.u}${fx(RR[0].x)} ${ax.v}${fy(RR[0].y)} F${capF(feed).toFixed(0)} ; eintauchen (Schnittvorschub, ein Zug)`);
      for (let s = 0; s < seg.length; s++) {
        const a = seg[s][0], b = seg[s][1];
        const dRoot = dRootOf(a, b), dL = dLOf(a, b), dRt = dROf(a, b), dMax = Math.max(dL, dRt);
        const Fs = F[s];
        // tatsächliche Geschwindigkeiten aus dem (geglätteten/gedeckelten) F ableiten.
        const vL = dMax > 1e-6 ? dL * Fs / dMax : Fs;
        const vR = dMax > 1e-6 ? dRt * Fs / dMax : Fs;
        const vRoot = dMax > 1e-6 ? dRoot * Fs / dMax : Fs;   // = feed, außer bei Deckelung/Glättung
        em(`G1 ${ax.x}${fx(LL[b].x)} ${ax.y}${fy(LL[b].y)} ${ax.u}${fx(RR[b].x)} ${ax.v}${fy(RR[b].y)} F${Fs.toFixed(0)}`
          + ` ; ${T('Portal ')}${ax.x}${ax.y}=${vL.toFixed(0)} ${ax.u}${ax.v}=${vR.toFixed(0)}${T(' mm/min (Werkstück ')}${vRoot.toFixed(0)})`);
        acc.foam += dRoot; acc.time += vRoot > 1e-6 ? dRoot / vRoot : 0;
      }
      em(`G0 ${ax.x}${fx(LL[0].x)} ${ax.y}${f(safeY)} ${ax.u}${fx(RR[0].x)} ${ax.v}${f(safeY)} ; hoch auf Sicherheitshöhe`);
      em(`G0 ${ax.x}${f(0)} ${ax.y}${f(safeY)} ${ax.u}${f(0)} ${ax.v}${f(safeY)} ; über den Block zurück`);
      em(`G0 ${ax.x}${f(0)} ${ax.y}${f(0)} ${ax.u}${f(0)} ${ax.v}${f(0)} ; zurück auf den Nullpunkt`);
    };
  }
  // Negativschalen: während der Erzeugung gilt die Werkstoff-Zuweisung „Negativschalen".
  function negGcode(idxArg) {
    App.matCtxOverride = 'neg';
    try { return negGcode_(idxArg); } finally { App.matCtxOverride = null; }
  }
  function negGcode_(idxArg) {
    const P = negProjection(idxArg);
    const mw = P.mw, ax = { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV };
    const proj = (vr, vt, zp) => vr + (zp - P.zRoot) / ((P.zTip - P.zRoot) || 1) * (vt - vr);
    const n = Math.min(P.rp.length, P.tp.length);   // Punktzahl je Kontur (für den Kopf)
    const pr = state.cfg.precision != null ? state.cfg.precision : 3;
    const fx = v => (P.ox - v).toFixed(pr), fy = v => (v - P.oy).toFixed(pr), f = v => v.toFixed(pr);
    const feed = state.cfg.feed, heat = App.currentHeat();
    // Max.-Vorschub-Deckelung (F = Geschwindigkeit des schnelleren Portals).
    const maxFeed = state.cfg.maxFeed || 0;
    const capF = v => (maxFeed > 0 ? Math.min(v, maxFeed) : v);
    // Sicherheitshöhe wie im Profilschnitt: Bezug ist die WERKSTOFF-Oberkante
    // (Blockhöhe über Nullpunkt + Werkstoffhöhe + Zugabe), NICHT die Höhe des
    // geschnittenen Negativblocks (P.geom.H).
    const safeY = (state.cfg.blockY || 0) + App.blockH() + (state.material.safeH || 0);
    const out = [], em = s => out.push(window.I18N ? window.I18N.tc(s) : s);
    em('; ==== HotWing Negativschale · 4-Achs Heißdraht G-Code ====');
    em('; ' + T('Achsen: L=') + ax.x + ax.y + '  R=' + ax.u + ax.v);
    const ckH = App.cutKerf(P.cut.root.chord, P.cut.tip.chord);
    // Kein "Segment N" im Header — die 3D-Simulation deutet das Muster
    // "Segment <Zahl>" als Segment-Marker in parseGcode und ordnete dann alle
    // Bewegungen einem nicht vorhandenen Block zu (die blaue Schnittfläche
    // wurde nie gezeichnet). Deshalb hier "Teil N von M" — wie beim 3D-Modell.
    em('; ' + T('Teil ') + (P.idx + 1) + T(' von ') + App.wing.cuts.length
      + T(' · Punkte/Kontur: ') + n + T(' · Vorschub: ') + feed + ' mm/min'
      + T(' · Abbrand innen ') + ckH.root.toFixed(2) + T(' / außen ') + ckH.tip.toFixed(2) + ' mm'
      + ' (' + T((state.cfg.negKerfMode || 'ratio') === 'speed' ? 'Bahngeschwindigkeit' : 'Sehnenverhältnis') + ')');
    if (P.stege) em('; ' + T('Kern in ') + P.stege.length + T(' Stege zerlegt (') + T(state.cfg.negStegeOnly ? 'NUR Stege, ohne Schalen' : 'im selben Schnitt') + T(') · Stegabstand ') + (state.cfg.negStegeGap || 0)
      + T(' mm · Nennbreiten Wurzel ') + P.stege.map(pc => pc.w.toFixed(1)).join(' + ') + ' mm'
      + P.stege.map(pc => (pc.st.sleeve || pc.st.capTop || pc.st.capBot) ? ' · S' + (pc.k + 1) + T(': Glasschlauch ') + pc.st.sleeve + T(' / Holmgurt ') + pc.st.capTop + '+' + pc.st.capBot : '').join(''));
    em('; ' + T('erzeugt: ') + new Date().toISOString());
    em('G21 ; mm'); em('G90 ; absolut');
    if (heat != null) { em('M3 S' + App.currentWireS() + ' ; ' + T('Drahtheizung EIN (') + heat + ' %)'); }
    if (state.cfg.header) state.cfg.header.split('\n').forEach(l => em(l));
    em(`G0 ${ax.x}${f(0)} ${ax.y}${f(0)} ${ax.u}${f(0)} ${ax.v}${f(0)} ; Start am Maschinennullpunkt (hinten/unten)`);
    // --- Konstanter Schalenrand: VOR dem Profilschnitt zwei planare Vertikal-
    //     schnitte (Nase/EL) auf konstantem Überstand — wie der Blockschnitt beim
    //     Kern. Ergibt die konstante Referenzkante der Schalen. ---
    const se = (P.stege && state.cfg.negStegeOnly) ? 0 : (state.cfg.negShellEdge || 0);   // Vorschnitte nur mit Schalen
    // Schneideweg „ein Zug": die Blockkanten liegen schon auf dem konstanten Überstand,
    // der Umriss schneidet die Schalenränder selbst -> keine Vorschnitte, kein Freifahren.
    if (se > 0 && App.negDirectPath && App.negDirectPath())
      em('; ' + T('Schalenüberstand konstant ') + se + T(' mm — im Umriss geschnitten (ein Zug, ohne Vorschnitte/Freifahren)'));
    else if (se > 0) {
      const at = (a, b, z) => a + (b - a) * (z - P.zRoot) / ((P.zTip - P.zRoot) || 1);
      // Abbrand-Kompensation (wie beim Kern-Blockschnitt): der Draht fährt um den
      // HALBEN Abbrand weiter nach vorne (Nase) bzw. hinten (EL), damit die stehen
      // bleibende Schalenrandkante genau auf Nennmaß + Überstand liegt.
      const hkR = ckH.root / 2, hkT = ckH.tip / 2;
      const front = { l: at(P.root.xL - se - hkR, P.tip.xL - se - hkT, 0), r: at(P.root.xL - se - hkR, P.tip.xL - se - hkT, mw) }; // Nase
      const rear = { l: at(P.root.xT + se + hkR, P.tip.xT + se + hkT, 0), r: at(P.root.xT + se + hkR, P.tip.xT + se + hkT, mw) };   // Endleiste
      const fdn = capF(feed).toFixed(0);   // Randschnitt mit vollem Schnittvorschub in einem Zug
      // Y-Ziel = Maschinen-Vertikal 0: Der Randschnitt für den konstanten Überstand
      // fährt IMMER ganz auf Vertikal 0 hinunter — auch wenn der Block über die
      // G-Code-Blocklage (blockY) in der Höhe verschoben ist. So läuft der Schnitt
      // stets komplett durch, statt bei blockY ≠ 0 auf der angehobenen Blockunter-
      // kante (Y = blockY) stehen zu bleiben. Beide Türme auf 0.
      const ybR = f(0), ybT = f(0);
      const edgeCut = (pos, label) => {
        em(`G0 ${ax.x}${f(0)} ${ax.y}${f(safeY)} ${ax.u}${f(0)} ${ax.v}${f(safeY)} ; hoch auf Sicherheitshöhe`);
        em(`G0 ${ax.x}${fx(pos.l)} ${ax.y}${f(safeY)} ${ax.u}${fx(pos.r)} ${ax.v}${f(safeY)} ; ${T('an ')}${label}`);
        em(`G1 ${ax.x}${fx(pos.l)} ${ax.y}${ybR} ${ax.u}${fx(pos.r)} ${ax.v}${ybT} F${fdn} ; ${T('vertikal auf 0 (')}${label})`);
        const dwl = +state.material.meltDwell || 0;
        if (dwl > 0) em('G4 P' + dwl + ' ; ' + T('auf Vertikal 0 verweilen (durchschmelzen)'));
        em(`G0 ${ax.x}${fx(pos.l)} ${ax.y}${f(safeY)} ${ax.u}${fx(pos.r)} ${ax.v}${f(safeY)} ; hoch auf Sicherheitshöhe`);
      };
      em('; --- ' + T('Überstand Schalenrand (konstant ') + se + T(' mm) — vor dem Profilschnitt') + ' ---');
      edgeCut(rear, T('hinterer Schalenrand'));
      edgeCut(front, T('vorderer Schalenrand'));
      em(`G0 ${ax.x}${f(0)} ${ax.y}${f(safeY)} ${ax.u}${f(0)} ${ax.v}${f(safeY)} ; über den Block zurück`);
      em(`G0 ${ax.x}${f(0)} ${ax.y}${f(0)} ${ax.u}${f(0)} ${ax.v}${f(0)} ; zurück auf den Nullpunkt`);
    }
    // WERKSTÜCK-KONSTANT (wie beim Kern, hotwire.js): Die Wurzelrippe (dRoot) soll
    // überall mit dem gewählten Vorschub laufen. Da die Steuerung F als BAHN-/
    // Portalvorschub interpretiert (das schnellere Portal), muss F dafür VARIIEREN:
    //   t = dRoot / feed  (Zeit, damit die Rippe mit 'feed' läuft)
    //   F = max(dL,dR)·feed / dRoot   (schnelleres Portal, gedeckelt auf maxFeed)
    // Die Portale fahren so je nach Rippenlage unterschiedlich schnell; ihre
    // tatsächlichen Geschwindigkeiten stehen als Kommentar (v = dPortal·feed/dRoot).
    // Eine geschlossene Kontur (turmsynchron) schneiden: eintauchen, umfahren,
    // schließen, ausfahren. rpA/tpA = Wurzel-/Randbahn (bereits kerf-kompensiert).
    // ZWEI Durchgänge: erst alle Segment-Vorschübe berechnen, dann isolierte
    // Vorschub-Spitzen an Nase/EL per 3-Punkt-Median glätten (nur der Wert F, die
    // Bahnpunkte bleiben unverändert), dann emittieren.
    const acc = { foam: 0, time: 0 };
    const cutContour = contourCutter(P, em, acc);
    // EIN durchgehender Schnitt: Kavität + integrierte Kerne (Kern/Stützstoff)
    // sind bereits in P.rp/P.tp enthalten (aus dem TE-Bereich angefahren).
    cutContour(P.rp, P.tp, (P.stege && state.cfg.negStegeOnly) ? T('Kern-Stege (ohne Schalen)') : T('Negativschale (Kavität') + T(P.stege ? ' + Kern-Stege' : (state.cfg.negCore || state.cfg.negSupport ? ' + Kerne' : '')) + ')');
    if (heat != null) em('M5 ; Drahtheizung AUS');
    em('M2 ; Ende');
    if (state.cfg.footer) state.cfg.footer.split('\n').forEach(l => em(l));
    return { text: out.join('\n'), lines: out.length, cutLengthFoam: acc.foam, estMinutes: acc.time };
  }

  /* Aufheizzeit nach jeder Pause mit ausgeschaltetem Draht: Wird der Draht vor
   * einer Programmpause (M0) per M5 abgeschaltet, so wird nach dem Wieder-
   * einschalten (nächstes M3) die Aufheizzeit `preheatSec` des Werkstoffs als
   * G4-Verweilen eingefügt — sofern dort nicht bereits ein G4 steht. Gilt für
   * ALLE G-Code-Quellen (Kern, Negativschale, DXF, Block, Guillotine, Holm-Pausen). */
  function applyPauseReheat(text) {
    const sec = +state.material.preheatSec || 0;
    if (!(sec > 0) || !text || !/\bM0\b/i.test(text)) return text;
    const lines = text.split('\n'), out = [];
    let wireOn = false, needReheat = false;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i], code = raw.split(';')[0];
      out.push(raw);
      if (/\bM3\b/i.test(code)) {
        wireOn = true;
        if (needReheat) {
          needReheat = false;
          // Nächste Nicht-Kommentar-Zeile prüfen: steht dort schon ein G4, nichts tun.
          let j = i + 1; while (j < lines.length && !lines[j].split(';')[0].trim()) j++;
          if (!(j < lines.length && /\bG4\b/i.test(lines[j].split(';')[0])))
            out.push('G4 P' + sec + ' ; ' + T('aufheizen nach Pause (Draht war aus)'));
        }
      } else if (/\bM5\b/i.test(code)) wireOn = false;
      else if (/\bM0\b/i.test(code) && !wireOn) needReheat = true;
    }
    return out.join('\n');
  }

  /* Aufheizphase in ein fertiges G-Code-Programm einrechnen: NUR EINMAL ganz am
   * Anfang. Sobald der Draht im Zuge des normalen G-Codes ERSTMALS beim Hochfahren
   * die vertikale „Aufheizhöhe" `preheatH` mm (über dem Maschinen-Nullpunkt Y0)
   * erreicht — also nach oben quert —, wird die Bewegung genau auf dieser Höhe
   * unterbrochen: G4-Verweilen `preheatSec` s, dann läuft die Bewegung zum
   * ursprünglichen Ziel weiter. Danach wird NICHT mehr aufgeheizt (der Draht bleibt
   * heiß). Beide Türme (Y/V) werden am Kreuzungspunkt linear interpoliert, damit sie
   * synchron bleiben. Wird so auch von der Simulation abgefahren. */
  /* G94 -> G93 (Inverse Time). Nachlauf ueber ein FERTIGES Programm — greift
   * daher fuer alle Quellen (Kern, Negativschale, DXF, Block, Guillotine,
   * Platte, Modell, Kalibrierung) gleichermassen.
   *
   * In G93 ist F keine Geschwindigkeit mehr, sondern der Kehrwert der Dauer
   * dieses einen Blocks:  Dauer T [min] = 1 / F. Die vom Generator GEMEINTE
   * Dauer steckt bereits im G94-Vorschub — dort ist F per Konvention die
   * Geschwindigkeit des schnelleren (aeusseren) Portals:
   *     T = dMax / F        (dMax = laengeres Portal)   ->   F(G93) = 1 / T
   * Die Umrechnung ist damit verlustfrei: dieselbe Zeit, dieselbe Deckelung
   * auf maxFeed, dieselbe Vorschub-Glaettung — nur haengt das Ergebnis nicht
   * mehr davon ab, wie die Steuerung aus vier Achsen eine Bahnlaenge bildet.
   *
   * G0 bleibt unangetastet (Eilgang ignoriert F). Vor dem Programmende und vor
   * M2/M30 wird auf G94 zurueckgeschaltet. */
  function toInverseTime(text) {
    if (!text) return text;
    const ax = { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV };
    const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rex = l => new RegExp('(?:^|\\s)' + esc(l) + '(-?\\d*\\.?\\d+)', 'i');
    const rX = rex(ax.x), rY = rex(ax.y), rU = rex(ax.u), rV = rex(ax.v), rF = rex('F');
    // F wird sehr klein (lange Bloecke) oder sehr gross (kurze Bloecke) — die
    // Stellenzahl mitfuehren, sonst rundet ein toFixed(0) den Vorschub kaputt.
    const fmt = v => v >= 1000 ? v.toFixed(1) : v >= 10 ? v.toFixed(3) : v.toFixed(5);
    const cur = { x: 0, y: 0, u: 0, v: 0 };
    let mode = 0, feed = 0, on = false;
    const out = [];
    text.split(/\r?\n/).forEach(raw => {
      const ci = raw.indexOf(';');
      const code = ci >= 0 ? raw.slice(0, ci) : raw;
      const cmt = ci >= 0 ? raw.slice(ci) : '';
      if (/\bM(?:2|30)\b/i.test(code)) {
        if (on) { out.push('G94 ; ' + T('zurück auf Vorschub in mm/min')); on = false; }
        out.push(raw); return;
      }
      // Ein G94 aus dem Programmkopf („Vorschub in mm/min“) waere hier irrefuehrend —
      // den Modus setzt jetzt diese Umrechnung selbst.
      if (/\bG94\b/i.test(code) && !/[A-Z]/i.test(code.replace(/\bG94\b/i, ''))) {
        out.push('; ' + raw.trim() + ' — ' + T('ersetzt durch G93'));
        return;
      }
      const g = code.match(/\bG([0-3])\b/i);
      if (g) mode = parseInt(g[1], 10);
      const mf = rF.exec(code); if (mf) feed = parseFloat(mf[1]) || feed;
      const mx = rX.exec(code), my = rY.exec(code), mu = rU.exec(code), mv = rV.exec(code);
      if (!mx && !my && !mu && !mv) {
        // Alleinstehendes F („Startvorschub setzen“) ist in G93 sinnlos und wird von
        // manchen Steuerungen als Fehler quittiert — der Wert steckt jetzt in jeder
        // einzelnen Bewegungszeile. Zeile auskommentieren, Wert bleibt modal gemerkt.
        if (mf && !/\bG\d/i.test(code)) out.push('; ' + raw.trim() + ' — ' + T('in G93 nicht nötig'));
        else out.push(raw);
        return;
      }
      const fx0 = cur.x, fy0 = cur.y, fu0 = cur.u, fv0 = cur.v;
      if (mx) cur.x = parseFloat(mx[1]);
      if (my) cur.y = parseFloat(my[1]);
      if (mu) cur.u = parseFloat(mu[1]);
      if (mv) cur.v = parseFloat(mv[1]);
      if (mode !== 1 || !(feed > 0)) { out.push(raw); return; }        // G0/G2/G3 unveraendert
      const dMax = Math.max(Math.hypot(cur.x - fx0, cur.y - fy0),
                            Math.hypot(cur.u - fu0, cur.v - fv0));
      if (!(dMax > 1e-9)) { out.push(raw); return; }                   // Nullzug (kein F noetig)
      const tMin = dMax / feed;                                        // Blockdauer in Minuten
      if (!on) { out.push('G93 ; ' + T('Inverse Time: F = 1 / Blockdauer (1/min)')); on = true; }
      const base = code.replace(/(^|\s)F-?\d*\.?\d+/ig, '').replace(/\s+$/, '');
      out.push(base + ' F' + fmt(1 / tMin)
        + (cmt ? ' ' + cmt + ' · ' + (tMin * 60).toFixed(2) + ' s' : ' ; ' + (tMin * 60).toFixed(2) + ' s'));
    });
    if (on) out.push('G94 ; ' + T('zurück auf Vorschub in mm/min'));
    return out.join('\n');
  }
  /* Wasserzeichen: bei einer personalisierten Ausgabe steht der Lizenznehmer
   * im Kopf und am Ende jedes erzeugten Programms. Damit ist nachvollziehbar,
   * aus welcher Lizenz eine weitergegebene Datei stammt. window.LICENSE kommt
   * vom Server (/__lizenz__, siehe filesys.js); ohne Lizenz bleibt der G-Code
   * unverändert. */
  const WM_MARK = '; AI Foam Cut';
  function watermark(text) {
    const lz = window.LICENSE;
    if (!text || text.startsWith(WM_MARK)) return text;
    const bi = window.BUILD_INFO || {};
    const d = new Date();
    const p2 = n => String(n).padStart(2, '0');
    const stamp = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
      + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
    // Demo: kein Lizenznehmer, aber als Demo-Programm gekennzeichnet.
    if (!lz || !lz.lic) {
      if (!demoOn()) return text;
      return WM_MARK + (bi.version ? ' v' + bi.version : '') + ' · ' + T('Demo')
        + ' · ' + T('erzeugt') + ' ' + stamp + '\n;\n' + text;
    }
    // Demo-Lizenz (befristet, voller Umfang): als solche gekennzeichnet, damit
    // weitergegebene Programme ihre Herkunft zeigen.
    const art = lz.typ === 'demo' ? T('Demo-Lizenz') : T('Lizenz');
    const head = [
      WM_MARK + (bi.version ? ' v' + bi.version : '') + ' · ' + art + ' ' + lz.lic
        + (lz.typ === 'demo' && lz.expiry ? ' (' + T('gültig bis') + ' ' + lz.expiry + ')' : ''),
      '; ' + T('Lizenziert für') + ': ' + lz.name + ' <' + lz.email + '>',
      '; ' + T('Computer') + ': ' + lz.machine + ' · ' + T('erzeugt') + ' ' + stamp,
      ';',
    ];
    return head.join('\n') + '\n' + text
      + '\n; ' + T('Ende') + ' · ' + art + ' ' + lz.lic + ' · ' + lz.name;
  }

  /* Vorschub-Modus auf ein fertiges Programm anwenden (Maschinendaten).
   * Letzter gemeinsamer Schritt aller G-Code-Quellen (autoGen() hier und
   * program() in app.js) — deshalb sitzt das Wasserzeichen hier. */
  function applyFeedMode(text) {
    return watermark(applyRelay(state.cfg.feedMode === 'g93' ? toInverseTime(text) : text));
  }

  /* Schaltausgang (Relais/SSR) parallel zur Drahtheizung.
   * Hintergrund: auf einem RAMPS 1.4 mit grbl-Mega-5X liegt die Drahtheizung
   * auf dem Spindelausgang (M3 S…/M5, PWM auf D8). Wer die Drahtleistung über
   * ein Relais/SSR aus einem EIGENEN Netzteil schaltet, braucht dafür einen
   * zweiten, PWM-freien Ausgang — das sind die Kühlmittelausgänge M7 (D10) und
   * M8 (D9). Die Befehle sind frei eintragbar, weil das Pin-Mapping je Firmware
   * abweicht.
   * Reihenfolge bewusst: Relais EIN *vor* M3 und AUS *nach* M5 — so schaltet
   * der Kontakt nie unter Last, und der Draht ist bei jedem M3 schon versorgt.
   * Läuft als Nachlauf über das fertige Programm, damit ALLE G-Code-Quellen
   * erfasst sind (auch die, die ihr M3/M5 selbst schreiben). */
  /* Welcher Ausgang geschaltet wird. Die Steuerung kennt keine Pin-Nummern im
   * G-Code — welcher Pin an einem Befehl hängt, legt die Firmware fest. Die
   * Auswahl bildet deshalb die gängigen Ausgänge mit ihrer RAMPS-Belegung ab
   * (grbl-Mega-5X) und bietet zusätzlich die nummerierten Digitalausgänge
   * M62/M63 P<n> (grblHAL, FluidNC, LinuxCNC) sowie freie Befehle.
   *   m7      : M7  / M9   -> RAMPS D10 (Kühlmittel „Mist")
   *   m8      : M8  / M9   -> RAMPS D9  (Kühlmittel „Flood")
   *   digital : M62 P<n> / M63 P<n> -> Pin nach Firmware-Konfiguration
   *   custom  : frei eingetragene Befehle (relayOn/relayOff)
   * Rückgabe {on, off, pin} — pin nur als Kommentartext. */
  const RELAY_PINS = {
    m7: { on: 'M7', off: 'M9', pin: 'RAMPS D10' },
    m8: { on: 'M8', off: 'M9', pin: 'RAMPS D9' },
  };
  function relayCmds(cfg) {
    const c = cfg || state.cfg;
    const sel = c.relayPin || 'm7';
    if (sel === 'custom') return { on: (c.relayOn || '').trim(), off: (c.relayOff || '').trim(), pin: '' };
    if (sel === 'digital') {
      const n = Math.max(0, Math.round(+c.relayP || 0));
      return { on: 'M62 P' + n, off: 'M63 P' + n, pin: 'P' + n };
    }
    return Object.assign({}, RELAY_PINS[sel] || RELAY_PINS.m7);
  }

  function applyRelay(text) {
    const c = state.cfg;
    if (!c.relayOut || !text) return text;
    const r = relayCmds(c), on = r.on, off = r.off;
    if (!on || !off) return text;
    const lines = text.split('\n');
    const isCode = (l, rx) => rx.test(l.split(';')[0]);
    const rxOn = /\bM0*3\b/i, rxOff = /\bM0*5\b/i;
    const pin = r.pin ? ' [' + r.pin + ']' : '';
    const cOn = on + ' ; ' + T('Schaltausgang EIN (Relais parallel zur Drahtheizung)') + pin;
    const cOff = off + ' ; ' + T('Schaltausgang AUS') + pin;
    // 'program': nur einmal — vor dem ERSTEN M3 ein, nach dem LETZTEN M5 aus.
    if (c.relayMode === 'program') {
      let first = -1, last = -1;
      lines.forEach((l, i) => {
        if (first < 0 && isCode(l, rxOn)) first = i;
        if (isCode(l, rxOff)) last = i;
      });
      if (first < 0) return text;            // kein M3 im Programm -> nichts zu schalten
      const out = [];
      lines.forEach((l, i) => {
        if (i === first) out.push(cOn);
        out.push(l);
        if (i === last && last > first) out.push(cOff);
      });
      if (last <= first) out.push(cOff);     // ohne abschließendes M5 am Ende ausschalten
      return out.join('\n');
    }
    // 'wire': folgt der Heizung — auch um Pausen (M0) herum, in denen der Draht
    // abgeschaltet wird. Der Zustand wird mitgeführt, damit keine doppelten
    // Schaltbefehle entstehen.
    const out = [];
    let relay = false;
    lines.forEach(l => {
      if (isCode(l, rxOn) && !relay) { out.push(cOn); relay = true; }
      out.push(l);
      if (isCode(l, rxOff) && relay) { out.push(cOff); relay = false; }
    });
    if (relay) out.push(cOff);               // Sicherheitsnetz: nie eingeschaltet enden
    return out.join('\n');
  }
  function applyPreheat(text) {
    const sec = +state.material.preheatSec || 0, h = +state.material.preheatH || 0;
    if (!(sec > 0) || !text) return text;
    text = applyPauseReheat(text);
    const p = state.cfg.precision != null ? state.cfg.precision : 2, f = v => v.toFixed(p);
    const ax = { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV };
    const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rex = l => new RegExp('(?:^|\\s)' + esc(l) + '(-?\\d*\\.?\\d+)', 'i');
    const rY = rex(ax.y), rV = rex(ax.v);
    const out = [];
    let mode = null, done = false, curY = 0, curV = 0;
    text.split('\n').forEach(raw => {
      const code = raw.split(';')[0];
      const gm = code.match(/\bG([0-3])\b/i);
      if (gm) mode = parseInt(gm[1], 10);
      const my = rY.exec(code), mv = rV.exec(code);
      const tY = my ? parseFloat(my[1]) : curY, tV = mv ? parseFloat(mv[1]) : curV;
      // Erstes Hochfahren auf die Aufheizhöhe (curY unter h, Ziel bei/über h).
      if (!done && (mode === 0 || mode === 1) && curY < h && tY >= h) {
        done = true;
        // Kreuzungspunkt: Bruchteil t der Strecke, an dem Y die Höhe h erreicht.
        const t = (tY - curY) !== 0 ? (h - curY) / (tY - curY) : 0;
        const vCross = curV + t * (tV - curV);
        const g = mode === 1 ? 'G1' : 'G0';
        // Bei G1 den Vorschub (F) der aufgeschnittenen Zeile mitnehmen — sonst
        // ist diese eingefügte Zeile die ERSTE Vorschubbewegung ohne gesetzten
        // Vorschub -> GRBL error 22 (Feed rate undefined).
        const mf = g === 'G1' ? code.match(/\bF(-?\d*\.?\d+)/i) : null;
        out.push('; --- ' + T('Aufheizphase (einmalig): bei ') + h + T(' mm auf ') + sec + T(' s aufheizen') + ' ---');
        out.push(g + ' ' + ax.y + f(h) + ' ' + ax.v + f(vCross) + (mf ? ' F' + mf[1] : '') + ' ; ' + T('auf Aufheizhöhe hochfahren'));
        out.push('G4 P' + sec + ' ; ' + T('aufheizen'));
      }
      out.push(raw);
      // Positionsverfolgung NACH der Zeile.
      if (my) curY = tY;
      if (mv) curV = tV;
    });
    return out.join('\n');
  }

  /* Baut den G-Code aus dem aktuellen Zustand neu auf. Wird bei jeder Änderung
   * über render() aufgerufen -> der Editor und die 3D-Simulation bleiben aktuell,
   * ohne dass ein „Erzeugen"-Knopf gedrückt werden muss. */
  // Manuelle Bearbeitung verwerfen und aus den Parametern neu erzeugen.
  function regenGcode() {
    state.gcodeEdited = false;
    autoGen();
    setGcodeEditMode(false);
  }

  function autoGen() {
    // Von Hand bearbeiteten G-Code NICHT automatisch überschreiben. Erst wenn
    // der Nutzer „↻ Neu erzeugen" klickt (state.gcodeEdited = false), werden
    // Parameteränderungen wieder übernommen.
    if (state.gcodeEdited) {
      const info = document.getElementById('gInfo');
      if (info) info.textContent = (state.lastGcode && state.lastGcode.file)
        ? state.lastGcode.file + ' · ' + T('Geladene Datei — „↻ Neu erzeugen" übernimmt wieder die Parameter.')
        : T('Von Hand bearbeitet — „↻ Neu erzeugen" übernimmt wieder die Parameter.');
      return;
    }
    let text, cutLen = 0, mins = 0, lines = 0;
    // Quelle „DXF-Formen": eigener Generator aus INNEN/AUSSEN + Synchronpaaren.
    if (state.cfg.gcodeSource === 'dxf' && App.dxfGcode) {
      const g = App.dxfGcode();
      text = applyFeedMode(applyPreheat(g.text)); cutLen = g.cutLengthFoam || 0; mins = g.estMinutes || 0; lines = text.split('\n').length;
      state.lastGcode = { text, cutLengthFoam: cutLen, estMinutes: mins, lines };
      setGcode(text, feedJumpLines(text));
      const info = document.getElementById('gInfo');
      if (info) info.textContent = `${lines}${T(' Zeilen · DXF-Form · Schnittlänge ')}${cutLen.toFixed(0)}${T(' mm · ~')}${mins.toFixed(1)}${T(' min')}`;
      Sim3D.load(text, App.buildDxfScene ? App.buildDxfScene() : null);
      return;
    }
    // Quelle „Negativschalendesign": eigener Generator, immer aktives Segment.
    if (state.cfg.gcodeSource === 'neg') {
      const g = negGcode();
      text = applyFeedMode(applyPreheat(g.text)); cutLen = g.cutLengthFoam; mins = g.estMinutes; lines = text.split('\n').length;
      state.lastGcode = { text, cutLengthFoam: cutLen, estMinutes: mins, lines };
      setGcode(text, feedJumpLines(text));
      const info = document.getElementById('gInfo');
      if (info) info.textContent = `${lines}${T(' Zeilen · Negativschale · Schnittlänge ')}${cutLen.toFixed(0)}${T(' mm · ~')}${mins.toFixed(1)}${T(' min')}`;
      Sim3D.load(text, buildNegScene());
      return;
    }
    // Quelle „Schriften" (schrift.js + schrift_gcode.js): Buchstaben als Prismen.
    if (state.cfg.gcodeSource === 'schrift') {
      const r = App.schriftGcode ? App.schriftGcode() : null;
      const info = document.getElementById('gInfo');
      if (!r) {
        text = ''; state.lastGcode = { text, cutLengthFoam: 0, estMinutes: 0, lines: 0 };
        setGcode(text, new Set());
        if (info) info.textContent = T('Kein Text — im Reiter „Schriften" Text eingeben.');
        Sim3D.load(text, App.buildSchriftScene ? App.buildSchriftScene() : null);
        return;
      }
      text = applyFeedMode(applyPreheat(r.text)); cutLen = r.cutLengthFoam || 0; mins = r.estMinutes || 0; lines = text.split('\n').length;
      state.lastGcode = { text, cutLengthFoam: cutLen, estMinutes: mins, lines };
      setGcode(text, feedJumpLines(text));
      if (info) info.textContent = `${lines}${T(' Zeilen · Schriften · ')}${r.meta.pieces}${T(' Teile · Schnittlänge ')}${cutLen.toFixed(0)}${T(' mm · ~')}${mins.toFixed(1)}${T(' min')}`;
      Sim3D.load(text, r.scene);
      return;
    }
    // Quelle „3D-Modell Platte": mehrere gleich dicke Segmente in einem Programm.
    if (state.cfg.gcodeSource === 'plate') {
      const r = App.plateGcode();
      const info = document.getElementById('gInfo');
      if (!r) {
        text = ''; state.lastGcode = { text, cutLengthFoam: 0, estMinutes: 0, lines: 0 };
        setGcode(text, new Set());
        if (info) info.textContent = T('Keine Platten-Auswahl — im Menü „Platte" Segmente wählen.');
        Sim3D.load(text, App.buildPlateScene(null));
        return;
      }
      text = applyFeedMode(r.text); lines = text.split('\n').length;
      state.lastGcode = { text, cutLengthFoam: 0, estMinutes: 0, lines };
      setGcode(text, feedJumpLines(text));
      if (info) info.textContent = `${lines}${T(' Zeilen · Platte · ')}${r.pieces.length}${T(' Segmente · Dicke ')}${r.span.toFixed(1)}${T(' mm')}`;
      Sim3D.load(text, r.scene);
      return;
    }
    // Quelle „3D-Modell": Regelflächenschnitt zwischen den Stirnprofilen.
    if (state.cfg.gcodeSource === 'model') {
      const r = App.modelGcode();
      const info = document.getElementById('gInfo');
      if (!r) {
        text = ''; state.lastGcode = { text, cutLengthFoam: 0, estMinutes: 0, lines: 0 };
        setGcode(text, new Set());
        if (info) info.textContent = T('Kein Modellsegment — im Reiter „3D-Modell" laden und zerlegen.');
        Sim3D.load(text, App.buildModelScene(null));
        return;
      }
      text = applyFeedMode(r.text); lines = text.split('\n').length;
      state.lastGcode = { text, cutLengthFoam: 0, estMinutes: 0, lines };
      setGcode(text, feedJumpLines(text));
      if (info) info.textContent = `${lines}${T(' Zeilen · 3D-Modell Segment ')}${r.seg + 1}${T(' · ')}${r.points}${T(' Punkte je Profil')}`;
      Sim3D.load(text, r.scene);
      return;
    }
    {
      // Immer genau ein Segment (Auswahl „Alle" gibt es nicht mehr).
      // Kern in Stege zerlegt (kernteile.js): eigener Generator statt Profilschnitt.
      const g = (App.kernTeileOn && App.kernTeileOn()) ? App.kernTeileGcode() : genOne(App.activeCut(), App.activeIdx());
      text = g.text; cutLen = g.cutLengthFoam; mins = g.estMinutes; lines = g.lines;
    }
    text = applyFeedMode(applyPreheat(text)); lines = text.split('\n').length;
    state.lastGcode = { text, cutLengthFoam: cutLen, estMinutes: mins, lines };
    const warnLines = feedJumpLines(text);
    setGcode(text, warnLines);
    const info = document.getElementById('gInfo');
    if (info) info.textContent =
      `${lines}${T(' Zeilen · Schnittlänge ')}${cutLen.toFixed(0)}${T(' mm · ~')}${mins.toFixed(1)}${T(' min')}`
      + (warnLines.size ? ` · ⚠ ${warnLines.size} ${warnLines.size > 1 ? T('Portal-Sprünge') : T('Portal-Sprung')} (≥10%)` : '');
    Sim3D.load(text, buildScene());
  }

  // ---- DXF-Formen (INNEN/AUSSEN + Synchronpaare) -> G-Code über HotWire.gcode ----
  // Nur vorhanden, wenn der Reiter „DXF-Formen" (dxfshapes.js) im Build steckt.
  function dxfGcode() {
    const P = App.dxfProjection();
    if (!P) return { text: '; ' + T('DXF-Formen: mindestens 1 Synchronpaar nötig.') + '\nM2 ; ' + T('Ende'), lines: 2, cutLengthFoam: 0, estMinutes: 0 };
    const safeY = (P.maxy - P.origin.y) + (state.material.safeH || 10);
    return HotWire.gcode(P, {
      ax: { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV },
      feed: state.cfg.feed, wireHeat: App.currentHeat(), wireS: App.currentWireS(), safeY, precision: state.cfg.precision,
      maxFeed: state.cfg.maxFeed || 0, outsideFeed: outsideFeed(),
      origin: P.origin, cutMode: 'none', blockCut: null,
      header: (state.cfg.header ? state.cfg.header + '\n' : '') + '; --- DXF-Form (INNEN/AUSSEN) ---',
      footer: state.cfg.footer
    });
  }

  // ---- Registry ----
  Object.assign(App, { applyFeedMode, applyPauseReheat, applyPreheat, applyRelay, autoGen, relayCmds, blockHGcode, calibGcode, contourCutter, genOne, guillotineGcode });
  Object.assign(App, { heatNote, negGcode, regenGcode, sparOnlyProgram, sparPocketLines, toInverseTime, watermark });
  if (App.dxfProjection) App.dxfGcode = dxfGcode;
})();
