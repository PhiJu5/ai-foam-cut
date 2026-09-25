/* hotwire_gcode.js — G-Code-Schreiber des Heißdraht-Kerns (HotWire.gcode): macht aus der
 * projizierten Bahn (HotWire.project) die G0/G1-Zeilen samt Vorschub, Block-/Schalenschnitt,
 * Holm-Einspeisung und Null-Fahrten-Bereinigung. Abwählbare Funktion „gcodegen"; hotwire.js
 * selbst (Projektion, Abbrand-Offset, Bahnmathematik) bleibt Kern.
 * Am 2026-09-13 aus hotwire.js herausgelöst. */
(function (global) {
  'use strict';
  if (!global.HotWire) return;
  const T = (s) => (window.I18N ? window.I18N.t(s) : s);
  const { project, medianDespike } = global.HotWire;

  /* G-Code-Erzeugung. opt:
   *  ax:{x,y,u,v} Achsnamen, feed(mm/min), safeY, leadIn(mm),
   *  precision, header/footer, maxFeed, outsideFeed
   */
  function gcode(proj, opt) {
    const ax = opt.ax;
    const p = opt.precision ?? 3;
    const f = v => v.toFixed(p);
    // Maschinennullpunkt: alle X/Y um den Blockbezug (hinten/unten) verschieben.
    // safeY ist eine Anfahrhöhe ÜBER der Blockunterkante und daher bereits im
    // neuen Bezug — nur X und die Kontur-Y werden versetzt.
    const ox = (opt.origin && opt.origin.x) || 0;
    const oy = (opt.origin && opt.origin.y) || 0;
    // X-Nullpunkt liegt HINTER dem Block; +X zeigt in den Block hinein (zur Nase).
    // Dadurch sind alle Block-X positiv, X=0 sitzt hinter der Endleiste.
    // Schnittrichtung „von vorne" (origin.sx = +1): Nullpunkt VOR der Nase, +X zeigt
    // zur Endleiste — die Tragfläche liegt mit der Nase zum Nullpunkt.
    const sx = (opt.origin && opt.origin.sx) || -1;
    const fx = sx > 0 ? (v => (v - ox).toFixed(p)) : (v => (ox - v).toFixed(p));
    const fy = v => (v - oy).toFixed(p);
    const front = opt.cutDir === 'front';
    // Nur eine Profilseite schneiden ('top' | 'bottom', sonst beide) — über den Zug-Ablauf.
    const single = opt.cutSides === 'top' || opt.cutSides === 'bottom';
    // Profil-Schnittrichtung: 'top' (Standard) = Oberseite zuerst — der Draht
    // fährt von der oberen EL-Verlängerung über die Oberseite zur Nase und die
    // Unterseite zurück. 'bottom' = Unterseite zuerst: dieselbe Kontur in
    // umgekehrter Reihenfolge (untere EL-Verlängerung → Unterseite → Nase →
    // Oberseite). Bei gestapelten Kopien nicht möglich (dann immer 'top').
    let L = proj.left, R = proj.right, RP = proj.rootPath || null;
    const _stackN0 = (proj.stack && proj.stack.count > 1) ? proj.stack.count : 1;
    // „Von vorne": die Reihenfolge Ober-/Unterseite regelt emitFront() je Zug.
    if (!front && opt.profileDir === 'bottom' && _stackN0 === 1 && L.length > 2) {
      const nn = L.length;
      // Geschlossener Pfad (letzter = erster): Kern (0..nn-2) umkehren und wieder
      // schließen. Sonst schlichte Umkehr. Gleiche Permutation für L/R/RP, damit
      // die parallelen Punkt-Arrays ausgerichtet bleiben.
      const cl = Math.abs(L[0].x - L[nn-1].x) < 1e-6 && Math.abs(L[0].y - L[nn-1].y) < 1e-6;
      const perm = [];
      if (cl) { for (let k = nn - 2; k >= 0; k--) perm.push(k); perm.push(nn - 2); }
      else    { for (let k = nn - 1; k >= 0; k--) perm.push(k); }
      const permute = a => { if (!a) return a; const o = perm.map(i => ({ x: a[i].x, y: a[i].y })); o.name = a.name; return o; };
      L = permute(L); R = permute(R); RP = permute(RP);
    }
    const N = L.length;
    const feed = opt.feed;
    // Max.-Vorschub-Deckelung: F ist per Konvention die Geschwindigkeit des
    // SCHNELLEREN (äußeren) Portals -> Min(F, maxFeed) hält das äußere Portal
    // unter der Maschinengrenze, auch beim Anfahren.
    const maxFeed = opt.maxFeed || 0;
    const capF = v => (maxFeed > 0 ? Math.min(v, maxFeed) : v);
    // Vorschub AUSSERHALB des Blocks (Anfahrt/Auslauf in Luft).
    const outF = capF(opt.outsideFeed || feed);
    const out = [];
    const em = s => out.push(window.I18N ? window.I18N.tc(s) : s);

    em('; ==== HotWing 4-Achs Heißdraht G-Code ====');
    em('; ' + T('Achsen: L=') + ax.x + ax.y + '  R=' + ax.u + ax.v);
    if (front) em('; ' + T('Schnittrichtung: von vorne (Nase zum Nullpunkt) — Ober- und Unterseite je von der Nase zur Endleiste'));
    if (single) em('; ' + T(opt.cutSides === 'top' ? 'Profilseite: nur Oberseite' : 'Profilseite: nur Unterseite'));
    em('; ' + T('Punkte pro Profil: ') + N + T('  Vorschub: ') + feed + ' mm/min');
    em('; ' + T('erzeugt: ') + new Date().toISOString());
    em('G21 ; mm');
    em('G90 ; absolut');
    // Drahtheizung: bleibt während des gesamten Schnitts konstant. S = Prozent
    // der Heizleistung (Duty = S / $30; bei $30 = 100 entspricht S direkt %).
    if (opt.wireHeat != null) {
      em('; ' + T('Drahtheizung: ') + opt.wireHeat + (opt.wireNote || T(' % (konstant während des Schnitts)')));
      // S = auf $30 skalierter Wert (wie Handsteuerung). Fallback auf rohen
      // Prozentwert nur, falls der Aufrufer wireS nicht mitgibt.
      em('M3 S' + (opt.wireS != null ? opt.wireS : (+opt.wireHeat).toFixed(0)) + ' ; Drahtheizung EIN');
    }
    if (opt.header) opt.header.split('\n').forEach(l => em(l));

    const safeY = opt.safeY;
    const bc = opt.blockCut;
    // Modus der Schnittreihenfolge:
    //  'before' Blockschnitt VOR Profilschnitt   'after' Blockschnitt NACH Profilschnitt
    //  'only'   nur Blockschnitt (kein Profil)    'none'  ohne Blockschnitt (horizontale Anfahrt)
    let mode = opt.cutMode || (bc ? 'before' : 'none');

    let totalTime = 0, totalFoam = 0;

    // project() schließt den Pfad (letzter Punkt = erster). Diesen Schließzug
    // NICHT fahren: am Ende der EL-Verlängerung (unten) soll der Draht nicht
    // wieder nach vorne zum Startpunkt (oben) ziehen, sondern direkt ausfahren.
    // Letzter tatsächlich geschnittener Punkt = Spitze der Verlängerung.
    const closed = N > 1 &&
      Math.abs(L[0].x - L[N-1].x) < 1e-6 && Math.abs(L[0].y - L[N-1].y) < 1e-6 &&
      Math.abs(R[0].x - R[N-1].x) < 1e-6 && Math.abs(R[0].y - R[N-1].y) < 1e-6;
    const last = closed ? N - 2 : N - 1;

    // Nasenindex (Profil-LE) = vorderster Konturpunkt (kleinstes x). Trennt die
    // Kontur in Oberseite (1..iLE) und Unterseite (iLE+1..last) — für den
    // nasenoptimierten Blockschnitt („wrap").
    let iLE = 0, xLE = Infinity;
    for (let i = 0; i <= last; i++) { if (L[i].x < xLE) { xLE = L[i].x; iLE = i; } }

    // Der Draht startet IMMER am Maschinennullpunkt (hinten/unten am Block; bei
    // „von vorne" vorne/unten vor der Nase).
    em(`G0 ${ax.x}${f(0)} ${ax.y}${f(0)} ${ax.u}${f(0)} ${ax.v}${f(0)} ; ` + (front ? 'Start am Maschinennullpunkt (vorne/unten)' : 'Start am Maschinennullpunkt (hinten/unten)'));

    // Blockschnitt: Positionier-/Horizontalfahrten mit MAX-Geschwindigkeit, die
    // VERTIKALEN Schnitte durch den Block (runter UND wieder hoch) in Schnitt-
    // geschwindigkeit. maxMove = Max.-Vorschub (bzw. 3000 mm/min ersatzweise).
    const maxMove = maxFeed > 0 ? maxFeed : 3000;
    // gBlock0: waagrechte Positionierfahrt (auf Sicherheitshöhe) — MAX.
    const gBlock0 = (xl, yv, xr, cm) => em(`G1 ${ax.x}${xl} ${ax.y}${f(yv)} ${ax.u}${xr} ${ax.v}${f(yv)} F${maxMove.toFixed(0)}${cm ? ' ; ' + cm : ''}`);
    // gBlock1: vertikaler Blockschnitt — Schnittgeschwindigkeit.
    const gBlock1 = (xl, yv, xr, cm) => em(`G1 ${ax.x}${xl} ${ax.y}${f(yv)} ${ax.u}${xr} ${ax.v}${f(yv)} F${feed.toFixed(0)} ; ${cm}`);
    function emitBlockAt(pos, label) {
      gBlock0(fx(pos.l), safeY, fx(pos.r), 'horizontal an Schnittposition (max)');   // horizontal — MAX
      gBlock1(fx(pos.l), 0, fx(pos.r), T('vertikal runter, ') + T(label));                  // oben -> unten (Schnitt)
      if ((opt.meltDwell || 0) > 0) em('G4 P' + opt.meltDwell + ' ; ' + T('am Nullpunkt verweilen (durchschmelzen)'));
      gBlock1(fx(pos.l), safeY, fx(pos.r), T('vertikal hoch, ') + T(label));                // unten -> oben (Schnitt)
    }
    function emitBlockFront() { if (bc) emitBlockAt(bc.front, 'Blockvorderkante'); }
    function emitBlockRear()  { if (bc) emitBlockAt(bc.rear,  'hinteres Blockende'); }
    // Von Null hoch auf Sicherheitshöhe — MAX.
    function goSafeAtOrigin() { em(`G1 ${ax.x}${f(0)} ${ax.y}${f(safeY)} ${ax.u}${f(0)} ${ax.v}${f(safeY)} F${maxMove.toFixed(0)} ; von Null hoch auf Sicherheitshöhe (max)`); }

    // Horizontaler Schalen-Trennschnitt: Draht hinter dem Block (Null-X) auf die
    // trapezförmige Schnitthöhe (sy.l/sy.r je Turm), dann WAAGRECHT durch den Block
    // bis vor die Nase (fr) — das trennt die Ober- bzw. Unterschale ab. Danach vor
    // dem Block hoch und zurück. Die Trapez-Neigung (sy.l≠sy.r bzw. Wurzel/Rand)
    // steckt bereits in den Werten (Abbrand-Ausgleich, s. shellCutGeom).
    const SC = opt.shellCut || null;
    // „Von vorne": der Nullpunkt liegt vor der Nase — der Schalenschnitt läuft von
    // vorne durch den Block bis hinter das hintere Blockende (SC.rear).
    function emitShellCut(sy, fr, label) {
      if (!SC) return;
      // Anfahrt direkt hinter dem Block (Null-X, in Luft) auf die Schnitthöhe — kein
      // Umweg über die Sicherheitshöhe nötig, da hinter dem Block kein Material ist.
      em(`G1 ${ax.x}${f(0)} ${ax.y}${fy(sy.l)} ${ax.u}${f(0)} ${ax.v}${fy(sy.r)} F${maxMove.toFixed(0)} ; ${label}: ${T(front ? 'vor dem Block auf Schnitthöhe (max)' : 'hinter dem Block auf Schnitthöhe (max)')}`);
      em(`G1 ${ax.x}${fx(fr.l)} ${ax.y}${fy(sy.l)} ${ax.u}${fx(fr.r)} ${ax.v}${fy(sy.r)} F${capF(feed).toFixed(0)} ; ${label}: ${T('Horizontalschnitt durch den Block (Trapez)')}`);
      // Vor dem Block hoch auf Sicherheitshöhe und über den Block zurück auf Null-X.
      em(`G1 ${ax.x}${fx(fr.l)} ${ax.y}${f(safeY)} ${ax.u}${fx(fr.r)} ${ax.v}${f(safeY)} F${maxMove.toFixed(0)} ; ${label}: ${T(front ? 'hinter dem Block hoch (max)' : 'vor dem Block hoch (max)')}`);
      em(`G1 ${ax.x}${f(0)} ${ax.y}${f(safeY)} ${ax.u}${f(0)} ${ax.v}${f(safeY)} F${maxMove.toFixed(0)} ; ${label}: ${T('zurück über den Block (max)')}`);
    }

    // Gemeinsamer Konturzug (i=1..last) inkl. Zeit-/Schnittlängen-Zählung.
    // VORSCHUB AM WERKSTÜCK: 'feed' ist die Schnittgeschwindigkeit des Drahts
    // AM WERKSTÜCK (Wurzelrippe), NICHT am Portal. Die Wurzelrippe fährt also in
    // jedem Konturschritt genau mit 'feed' — die Portale laufen entsprechend
    // schneller oder langsamer, je nach Projektion (Trapez/Pfeilung).
    // Da die Steuerung F als Vorschub des SCHNELLEREN Portals interpretiert, wird
    // der Master (längeres Portal) so skaliert, dass die Wurzelrippe feed erreicht:
    //   F = feed · dMax / dRoot      (dMax = längeres Portal, dRoot = Wurzelrippe)
    //   v(Wurzelrippe) = feed        (Werkstück konstant)
    //   v(Portal)      = feed · dPortal / dRoot
    // maxFeed deckelt weiterhin das schnellere Portal (capF) — dann läuft das
    // Werkstück ausnahmsweise langsamer als feed (Sicherheit vor Genauigkeit).
    // RP (Wurzelpfad) wird oben zusammen mit L/R definiert (ggf. umgekehrt).
    // Stapel: Anzahl Kopien und Punkte je Kopie. An jeder Kopie-Grenze wird NICHT
    // quer durch den Block zur nächsten Kopie geschnitten, sondern über die
    // Endleiste hinten AUS DEM BLOCK heraus (Null-X), in Luft zur nächsten Kopie
    // und wieder heran. So bleibt zwischen den Kopien kein Schnitt im Block.
    const stackN = (proj.stack && proj.stack.count > 1) ? proj.stack.count : 1;
    const perCopy = stackN > 1 ? Math.round(N / stackN) : 0;
    // Nasenoptimiert („wrap") teilt die Kontur an der Nase — mit gestapelten Kopien
    // nicht möglich; dann konventionell „vor Profilschnitt".
    if (mode === 'wrap' && (!bc || stackN > 1)) mode = 'before';
    // Vorschub für Fahrten in LUFT (außerhalb des Blocks): in den Blockschnitt-
    // Modi immer MAX (Maschinen-/GRBL-Grenze) — nur die vertikalen Blockschnitte
    // (runter UND wieder hoch, vorne und hinten) sowie die Kontur laufen mit dem
    // gewählten Schnittvorschub. Ohne Blockschnitt gilt die Einstellung
    // „Geschwindigkeit außerhalb Block" (outF).
    const airF = mode !== 'none' ? maxMove : outF;
    function emitContour(from, to) {
      // Modus „Holmschnitt nach Oberseitenschnitt": beim VOLLEN Konturaufruf die
      // Kontur an der Nase (iLE) teilen — erst die Oberseite, dann Pause + Holm-
      // taschen von oben + Pause, dann die Unterseite (injectNoseSpar).
      if (from === undefined && to === undefined && opt.noseSpar && opt.noseSpar.length) {
        emitContour(1, iLE); injectNoseSpar(); emitContour(iLE + 1, last); return;
      }
      // ZWEI Durchgänge: erst je Segment den Roh-Vorschub berechnen, dann isolierte
      // Vorschub-Spitzen an Nase/EL per 3-Punkt-Median glätten (nur der Wert F, die
      // Bahnpunkte bleiben unverändert), dann emittieren. Stapel-Übergänge (feste
      // Luft-Fahrt mit outF) trennen die Läufe und werden nicht geglättet.
      // from/to = optionaler Konturausschnitt (Punktindizes). Ohne Angabe die
      // ganze Kontur (1..last) — so verhält sich der Aufruf wie bisher.
      from = from || 1; to = (to == null) ? last : to;
      const seg = [];   // je i: {trans} ODER {dL,dR,dMax,dRoot,Fraw}
      for (let i = from; i <= to; i++) {
        if (perCopy && i % perCopy === 0 && i < N) { seg.push({ i, trans: true }); continue; }
        const dL = Math.hypot(L[i].x-L[i-1].x, L[i].y-L[i-1].y);
        const dR = Math.hypot(R[i].x-R[i-1].x, R[i].y-R[i-1].y);
        const dMax = Math.max(dL, dR);                 // längeres Portal = Master
        const dRoot = RP && RP[i] && RP[i-1]
          ? Math.hypot(RP[i].x - RP[i-1].x, RP[i].y - RP[i-1].y) : dMax;
        // Sub-Auflösungs-Segmente (< 0,02 mm) nicht hochrechnen — dRoot≈0 risse F
        // sonst auf maxFeed hoch (Geschwindigkeitsspitze, z. B. an Holm-Schlitzen).
        const Fraw = dRoot > 0.02 ? capF(feed * dMax / dRoot) : capF(feed);   // Werkstück = feed, auf maxFeed gedeckelt
        seg.push({ i, dL, dR, dMax, dRoot, Fraw });
      }
      // Median je zusammenhängendem Konturschnitt-Lauf (Stapel-Übergänge trennen).
      let s = 0;
      while (s < seg.length) {
        if (seg[s].trans) { s++; continue; }
        let e = s; while (e < seg.length && !seg[e].trans) e++;
        const run = seg.slice(s, e).map(o => o.Fraw);
        const dz = medianDespike(run, false);
        for (let k = 0; k < dz.length; k++) seg[s + k].F = dz[k];
        s = e;
      }
      for (let s2 = 0; s2 < seg.length; s2++) {
        const o = seg[s2], i = o.i;
        if (o.trans) {
          // i = erster Punkt (obere Steg-Spitze) der nächsten Kopie,
          // i-1 = letzter Punkt (untere Steg-Spitze) der vorigen Kopie.
          em(`G1 ${ax.x}${f(0)} ${ax.y}${fy(L[i-1].y)} ${ax.u}${f(0)} ${ax.v}${fy(R[i-1].y)} F${airF.toFixed(0)} ; Stapel: an der Endleiste hinten aus dem Block`);
          em(`G1 ${ax.x}${f(0)} ${ax.y}${fy(L[i].y)} ${ax.u}${f(0)} ${ax.v}${fy(R[i].y)} F${airF.toFixed(0)} ; Stapel: in Luft (vor dem Block) zur nächsten Kopie`);
          em(`G1 ${ax.x}${fx(L[i].x)} ${ax.y}${fy(L[i].y)} ${ax.u}${fx(R[i].x)} ${ax.v}${fy(R[i].y)} F${airF.toFixed(0)} ; Stapel: an die nächste Kopie heran (Endleiste)`);
          continue;
        }
        cutLine(L[i], R[i], o);
      }
    }
    // Eine Konturzeile (G1) mit Portal-/Werkstückgeschwindigkeit im Kommentar;
    // o = {dL, dR, dMax, dRoot, F} aus der Vorschubrechnung.
    function cutLine(Lp, Rp, o) {
      const F = o.F, dMax = o.dMax;
      // Tatsächliche Geschwindigkeiten aus dem (geglätteten/gedeckelten) F ableiten.
      const vL = dMax > 1e-6 ? o.dL * F / dMax : F;
      const vR = dMax > 1e-6 ? o.dR * F / dMax : F;
      const vRoot = dMax > 1e-6 ? o.dRoot * F / dMax : F;   // = feed, außer bei Deckelung/Glättung
      em(`G1 ${ax.x}${fx(Lp.x)} ${ax.y}${fy(Lp.y)} ${ax.u}${fx(Rp.x)} ${ax.v}${fy(Rp.y)} F${F.toFixed(0)}`
        + ` ; ${T('Portal ')}${ax.x}${ax.y}=${vL.toFixed(0)} ${ax.u}${ax.v}=${vR.toFixed(0)}${T(', Werkstück=')}${vRoot.toFixed(0)} mm/min`);
      totalFoam += o.dRoot;                    // Schnittlänge an der Wurzelrippe
      totalTime += vRoot > 1e-6 ? o.dRoot / vRoot : 0;   // Zeit = Werkstücklänge / Werkstückvorschub
    }
    // Ein offener Zug (Punkt 0 = Startpunkt, bereits angefahren) — gleiche
    // Vorschubrechnung wie emitContour (Werkstück = feed, Median gegen Spitzen).
    function emitRun(Lp, Rp, RPp) {
      const seg = [];
      for (let i = 1; i < Lp.length; i++) {
        const dL = Math.hypot(Lp[i].x - Lp[i-1].x, Lp[i].y - Lp[i-1].y);
        const dR = Math.hypot(Rp[i].x - Rp[i-1].x, Rp[i].y - Rp[i-1].y);
        const dMax = Math.max(dL, dR);
        const dRoot = RPp ? Math.hypot(RPp[i].x - RPp[i-1].x, RPp[i].y - RPp[i-1].y) : dMax;
        const Fraw = dRoot > 0.02 ? capF(feed * dMax / dRoot) : capF(feed);
        seg.push({ dL, dR, dMax, dRoot, Fraw });
      }
      const dz = medianDespike(seg.map(o => o.Fraw), false);
      seg.forEach((o, k) => { o.F = dz[k]; cutLine(Lp[k + 1], Rp[k + 1], o); });
    }

    /* Profilschnitt mit HORIZONTALER Anfahrt (Modus „ohne Blockschnitt" und
     * „nach Profilschnitt"): am Nullpunkt hinten vertikal auf die Höhe der
     * EL-Verlängerung, horizontal von hinten ins Profil, Kontur, horizontal
     * zurück zum Null-X. Mit finish=true zusätzlich vertikal auf Null
     * (eigenständiger Schnitt); mit finish=false bleibt der Draht am Null-X auf
     * Höhe der Spitze (Anschluss an nachfolgende Blockschnitte). */
    function emitProfileHorizontal(finish) {
      em(`G0 ${ax.x}${f(0)} ${ax.y}${fy(L[0].y)} ${ax.u}${f(0)} ${ax.v}${fy(R[0].y)} ; hoch auf Höhe der EL-Verlängerung`);
      em(`G1 ${ax.x}${fx(L[0].x)} ${ax.y}${fy(L[0].y)} ${ax.u}${fx(R[0].x)} ${ax.v}${fy(R[0].y)} F${airF.toFixed(0)} ; horizontal von hinten zum Profil (außerhalb Block)`);
      emitContour();
      // Von der Verlängerungsspitze direkt horizontal raus (kein Zug nach vorne).
      em(`G1 ${ax.x}${f(0)} ${ax.y}${fy(L[last].y)} ${ax.u}${f(0)} ${ax.v}${fy(R[last].y)} F${airF.toFixed(0)} ; horizontal zurück (außerhalb Block)`);
      if (finish !== false)
        em(`G1 ${ax.x}${f(0)} ${ax.y}${f(0)} ${ax.u}${f(0)} ${ax.v}${f(0)} F${airF.toFixed(0)} ; vertikal auf Null (außerhalb Block)`);
    }

    // Holm-Injektion an der Nase (Modus „Holmschnitt nach Oberseitenschnitt").
    // Der Draht steht nach der Oberseite an der Nase (L[iLE]/R[iLE]). Ablauf OHNE
    // Null-Umweg: hoch über den Block → direkt zur Holmposition (opt.noseSpar fährt
    // „inline": nur Anfahrt→Tasche→Sicherheitshöhe je Holm) → direkt zurück zur Nase →
    // EINE Pause → runter auf die Nase, die Unterseite schließt sich an. Bei Draht-
    // heizung wird die Pause mit M5/M3 umschlossen (kein Durchbrennen auf der Stelle).
    function injectNoseSpar() {
      const heat = opt.wireHeat, s = opt.wireS != null ? opt.wireS : (heat != null ? (+heat).toFixed(0) : null);
      // Pause am Nasenüberstand: Oberseite fertig, BEVOR es hoch zum Holmschnitt geht
      // (Draht steht auf der Nase). Bei Drahtheizung M5/M3 um die Pause.
      if (heat != null) em('M5 ; Draht AUS für die Pause');
      em('M0 ; ' + T('AUTO-PAUSE: Oberseite fertig. Im Reiter „Schneiden" auf „Fortsetzen" drücken (Holmschnitt)'));
      if (heat != null) em('M3 S' + s + ' ; Draht EIN (nach Fortsetzen)');
      em(`G1 ${ax.x}${fx(L[iLE].x)} ${ax.y}${f(safeY)} ${ax.u}${fx(R[iLE].x)} ${ax.v}${f(safeY)} F${maxMove.toFixed(0)} ; hoch über den Block (Oberseite fertig)`);
      (opt.noseSpar || []).forEach(l => em(l));   // direkt zur Holmposition, Tasche(n), zurück auf Sicherheitshöhe
      em(`G1 ${ax.x}${fx(L[iLE].x)} ${ax.y}${f(safeY)} ${ax.u}${fx(R[iLE].x)} ${ax.v}${f(safeY)} F${maxMove.toFixed(0)} ; direkt nach vorne zur Nase (kein Null-Umweg)`);
      if (heat != null) em('M5 ; Draht AUS für die Pause');
      em('M0 ; ' + T('AUTO-PAUSE: Oberseite + Holm fertig. Im Reiter „Schneiden" auf „Fortsetzen" drücken (Unterseite)'));
      if (heat != null) em('M3 S' + s + ' ; Draht EIN (nach Fortsetzen)');
      em(`G1 ${ax.x}${fx(L[iLE].x)} ${ax.y}${fy(L[iLE].y)} ${ax.u}${fx(R[iLE].x)} ${ax.v}${fy(R[iLE].y)} F${feed.toFixed(0)} ; runter auf die Nase — Unterseite beginnt`);
    }
    // Rückkehr aus Sicherheitshöhe zum Maschinennullpunkt — MAX.
    function emitReturnFromSafe() {
      em(`G1 ${ax.x}${f(0)} ${ax.y}${f(safeY)} ${ax.u}${f(0)} ${ax.v}${f(safeY)} F${maxMove.toFixed(0)} ; über den Block zurück (max)`);
      em(`G1 ${ax.x}${f(0)} ${ax.y}${f(0)} ${ax.u}${f(0)} ${ax.v}${f(0)} F${maxMove.toFixed(0)} ; zurück auf den Nullpunkt (max)`);
    }

    /* ---- Zug-Ablauf: Schnittrichtung „von vorne" und „nur Ober-/Unterseite" ----
     * Die Kontur wird an der Nase in Züge geteilt (HotWire.cutPasses). „Von vorne"
     * (Nase zum Nullpunkt) beginnen beide vorne an der Nase (bzw. am Anfang der
     * Nasenverlängerung):
     *   Zug Oberseite: Einlauf → Nase → Oberseite → Endleiste → oberer EL-Steg
     *   → senkrecht hoch auf Sicherheitshöhe → über den Block nach vorne
     *   Zug Unterseite: vor dem Block runter → Einlauf → Nase → Unterseite →
     *   Endleiste → unterer EL-Steg → hoch → über den Block zurück zum Nullpunkt.
     * „Nur Oberseite"/„nur Unterseite" (opt.cutSides): EIN Zug je Kopie, auch von
     * hinten — dort läuft die Oberseite Stegspitze → Nase → Einlaufast (Ausfahrt vor
     * der Nase nach oben), die Unterseite Einlaufast → Nase → Stegspitze (Anfahrt von
     * vorne über den Block, Ausfahrt waagrecht zum Null-X) wie im klassischen Umlauf.
     * NAH = Blockseite am Nullpunkt (von vorne: Blockvorderkante, von hinten: hinteres
     * Blockende), FERN = gegenüber. Blockschnitte: „vor" = erst die Seite, auf der der
     * erste Zug NICHT beginnt, dann die Startseite (Draht bleibt in deren Spalt und
     * steigt auf die Einlaufhöhe); „während" = Startseite vor dem ersten Zug, die
     * Gegenseite gleich an dessen Ende (volle Höhe); „nach" = erst die Seite, an der
     * der Draht steht. Holm „nach Oberseitenschnitt": Pause + Holmtaschen nach dem
     * Oberseiten-Zug (ohne Oberseite: nach dem letzten Zug). */
    function emitPasses() {
      const ps = global.HotWire.cutPasses(RP || L, stackN, { front, sides: opt.cutSides, profileDir: opt.profileDir });
      if (!ps.length) return;
      // Blockschnitt-Positionen (bc, kerf-kompensiert) und Blockflächen (bb) je Seite,
      // Profil-/Turmkoordinaten wie L/R. Maschinen-X als Zahl über mXn.
      const bb = opt.blockBox || bc || null;
      const nearB = bc ? (front ? bc.front : bc.rear) : null, farB = bc ? (front ? bc.rear : bc.front) : null;
      const nearF = bb ? (front ? bb.front : bb.rear) : null, farF = bb ? (front ? bb.rear : bb.front) : null;
      const mXn = v => (sx > 0 ? v - ox : ox - v);
      const beforeNear = (l, r) => !nearF || (mXn(l.x) < mXn(nearF.l) - 1e-6 && mXn(r.x) < mXn(nearF.r) - 1e-6);   // zwischen Null und naher Blockfläche (Luft)
      const beyondFar = (l, r) => !farF || (mXn(l.x) > mXn(farF.l) + 1e-6 && mXn(r.x) > mXn(farF.r) + 1e-6);     // hinter der fernen Blockfläche (Luft)
      const dwell = () => { if ((opt.meltDwell || 0) > 0) em('G4 P' + opt.meltDwell + ' ; ' + T('am Nullpunkt verweilen (durchschmelzen)')); };
      const mv = (lx, ly, rx, ry, F, cm) => em(`G1 ${ax.x}${lx} ${ax.y}${ly} ${ax.u}${rx} ${ax.v}${ry} F${F.toFixed(0)} ; ${cm}`);
      // Kommentare je Blockseite: 'nose' = Nasen-/Vorderseite, 'te' = Endleisten-/Rückseite.
      const TX = {
        nose: { up0: 'hoch auf Einlaufhöhe (vor dem Block)', toFace: 'über den Block nach vorne zur Blockvorderkante (max)',
          downKerf: 'im Schnittspalt der Blockvorderkante runter auf Einlaufhöhe', upKerf: 'im Schnittspalt der Blockvorderkante hoch auf Einlaufhöhe',
          toAir: 'über den Block nach vorne (vor die Nase)', downAir: 'vor dem Block runter auf Einlaufhöhe',
          hAir: 'horizontal zum Einlauf an der Nase (außerhalb Block)', hCut: 'horizontal zum Einlauf an der Nase (durch den Verschnitt, Schnittvorschub)',
          exAir: 'vor der Nase senkrecht hoch auf Sicherheitshöhe (außerhalb Block)', exCut: 'an der Nasenverlängerung senkrecht hoch auf Sicherheitshöhe (Schnittvorschub)',
          fMove: 'waagrecht zur Blockvorderkante (Schnittvorschub)', fDown: 'vertikal auf Null (Blockvorderkante)',
          fUp: 'vertikal hoch auf Sicherheitshöhe (Blockvorderkante oben)', fDown1: 'vertikal runter, Blockvorderkante',
          ret1: 'über den Block zurück zum Nullpunkt (vorne)', ret2: 'vor dem Block runter auf Null' },
        te: { up0: 'hoch auf Einlaufhöhe (hinter dem Block)', toFace: 'über den Block zum hinteren Blockende (max)',
          downKerf: 'im Schnittspalt des hinteren Blockendes runter auf Einlaufhöhe', upKerf: 'im Schnittspalt des hinteren Blockendes hoch auf Einlaufhöhe',
          toAir: 'über den Block nach hinten (hinter die Endleiste)', downAir: 'hinter dem Block runter auf Einlaufhöhe',
          hAir: 'horizontal zum Einlauf an der EL-Verlängerung (außerhalb Block)', hCut: 'horizontal zum Einlauf an der EL-Verlängerung (durch den Verschnitt, Schnittvorschub)',
          exAir: 'hinter der Endleiste senkrecht hoch auf Sicherheitshöhe (außerhalb Block)', exCut: 'an der Endleisten-Verlängerung senkrecht hoch auf Sicherheitshöhe (Schnittvorschub)',
          fMove: 'waagrecht zum hinteren Blockende (Schnittvorschub)', fDown: 'vertikal auf Null (hinteres Blockende)',
          fUp: 'vertikal hoch auf Sicherheitshöhe (hinteres Blockende oben)', fDown1: 'vertikal runter, hinteres Blockende',
          ret1: 'über den Block zurück zum Nullpunkt (hinten)', ret2: 'hinter dem Block runter auf Null' }
      };
      const nearTx = TX[front ? 'nose' : 'te'], farTx = TX[front ? 'te' : 'nose'];
      // pos: 'origin' (Nullpunkt), 'safe' (Sicherheitshöhe), 'nearLow' (am Null-X auf Steghöhe),
      //      'nearKerf'/'farKerf' (nahe/ferne Blockfläche auf Null geschnitten, Draht im Spalt)
      let pos = 'origin', nearCut = false, farCut = false;
      const startsNear = q => mXn(L[q.idx[0]].x) <= mXn(L[q.idx[q.idx.length - 1]].x);
      const upSafeAtZero = () => {
        if (pos === 'origin') goSafeAtOrigin();
        else mv(f(0), f(safeY), f(0), f(safeY), airF, T('am Nullpunkt senkrecht hoch auf Sicherheitshöhe (außerhalb Block)'));
        pos = 'safe';
      };
      // Anfahrt an den Einlauf (erster Punkt des Zugs) — von der Seite, auf der er liegt.
      function approach(Lp, Rp, sNear) {
        const s0 = Lp[0], r0 = Rp[0], tx = sNear ? nearTx : farTx;
        if (sNear) {
          if (pos === 'origin' || pos === 'nearLow') {
            em(`G0 ${ax.x}${f(0)} ${ax.y}${fy(s0.y)} ${ax.u}${f(0)} ${ax.v}${fy(r0.y)} ; ` + T(tx.up0));
          } else if (pos === 'safe') {
            if (nearCut) {
              mv(fx(nearB.l), f(safeY), fx(nearB.r), f(safeY), maxMove, T(tx.toFace));
              mv(fx(nearB.l), fy(s0.y), fx(nearB.r), fy(r0.y), capF(feed), T(tx.downKerf));
            } else {
              mv(f(0), f(safeY), f(0), f(safeY), airF, T(tx.toAir));
              mv(f(0), fy(s0.y), f(0), fy(r0.y), airF, T(tx.downAir));
            }
          } else if (pos === 'nearKerf') {
            mv(fx(nearB.l), fy(s0.y), fx(nearB.r), fy(r0.y), capF(feed), T(tx.upKerf));
          }
          const air = !nearCut && beforeNear(s0, r0);
          mv(fx(s0.x), fy(s0.y), fx(r0.x), fy(r0.y), air ? airF : capF(feed), T(air ? tx.hAir : tx.hCut));
        } else {
          if (pos === 'origin' || pos === 'nearLow') upSafeAtZero();
          if (pos === 'safe') {
            if (farCut) {
              mv(fx(farB.l), f(safeY), fx(farB.r), f(safeY), maxMove, T(tx.toFace));
              mv(fx(farB.l), fy(s0.y), fx(farB.r), fy(r0.y), capF(feed), T(tx.downKerf));
            } else {
              // Senkrecht in Luft hinter der fernen Blockfläche (5 mm Abstand) bzw. direkt
              // über dem Einlauf, wenn der schon außerhalb liegt.
              const dl = farF ? Math.max(mXn(farF.l) + 5, mXn(s0.x)) : mXn(s0.x);
              const dr = farF ? Math.max(mXn(farF.r) + 5, mXn(r0.x)) : mXn(r0.x);
              mv(f(dl), f(safeY), f(dr), f(safeY), airF, T(tx.toAir));
              mv(f(dl), fy(s0.y), f(dr), fy(r0.y), airF, T(tx.downAir));
            }
          } else if (pos === 'farKerf') {
            mv(fx(farB.l), fy(s0.y), fx(farB.r), fy(r0.y), capF(feed), T(tx.upKerf));
          }
          const air = !farCut && beyondFar(s0, r0);
          mv(fx(s0.x), fy(s0.y), fx(r0.x), fy(r0.y), air ? airF : capF(feed), T(air ? tx.hAir : tx.hCut));
        }
        pos = 'cut';
      }
      // Ende eines Zugs: auf der fernen Seite senkrecht hoch auf Sicherheitshöhe, auf der
      // nahen Seite waagrecht (entlang des Stegs) hinaus zum Null-X.
      function exitPass(Lp, Rp, sNear) {
        const e = Lp[Lp.length - 1], er = Rp[Rp.length - 1];
        if (sNear) {
          const air = !farCut && beyondFar(e, er);
          mv(fx(e.x), f(safeY), fx(er.x), f(safeY), air ? airF : capF(feed), T(air ? farTx.exAir : farTx.exCut));
          pos = 'safe';
        } else {
          const air = !nearCut && beforeNear(e, er);
          mv(f(0), fy(e.y), f(0), fy(er.y), air ? airF : capF(feed),
            air ? T('horizontal zum Null-X (außerhalb Block)') : T('horizontal zum Null-X (durch den Verschnitt, Schnittvorschub)'));
          pos = 'nearLow';
        }
      }
      // „Blockschnitt während Profilschnitt": die Blockfläche am ENDE des ersten Zugs
      // gleich dort schneiden (Draht steht ohnehin da) — von der Steg-/Einlaufhöhe
      // runter auf Null, dann in einem Zug hoch auf Sicherheitshöhe.
      function faceAtEnd(Lp, Rp, sNear) {
        const e = Lp[Lp.length - 1], er = Rp[Rp.length - 1];
        const B = sNear ? farB : nearB, tx = sNear ? farTx : nearTx;
        mv(fx(B.l), fy(e.y), fx(B.r), fy(er.y), capF(feed), T(tx.fMove));
        gBlock1(fx(B.l), 0, fx(B.r), tx.fDown);
        dwell();
        gBlock1(fx(B.l), safeY, fx(B.r), tx.fUp);
        if (sNear) farCut = true; else nearCut = true;
        pos = 'safe';
      }
      // Holm „nach Oberseitenschnitt": Pause, Holmtaschen von oben (Draht auf
      // Sicherheitshöhe), bei weiteren Zügen erneut Pause.
      function injectSpar(more) {
        if (pos !== 'safe') upSafeAtZero();
        const heat = opt.wireHeat, s = opt.wireS != null ? opt.wireS : (heat != null ? (+heat).toFixed(0) : null);
        if (heat != null) em('M5 ; Draht AUS für die Pause');
        em('M0 ; ' + T('AUTO-PAUSE: Oberseite fertig. Im Reiter „Schneiden" auf „Fortsetzen" drücken (Holmschnitt)'));
        if (heat != null) em('M3 S' + s + ' ; Draht EIN (nach Fortsetzen)');
        opt.noseSpar.forEach(l => em(l));   // über den Einstich, Tasche(n), zurück auf Sicherheitshöhe
        if (!more) return;
        if (heat != null) em('M5 ; Draht AUS für die Pause');
        em('M0 ; ' + T('AUTO-PAUSE: Oberseite + Holm fertig. Im Reiter „Schneiden" auf „Fortsetzen" drücken (Unterseite)'));
        if (heat != null) em('M3 S' + s + ' ; Draht EIN (nach Fortsetzen)');
      }

      if (mode === 'only') {
        // Nur Blockschnitt: erst die nahe, dann die ferne Blockseite.
        goSafeAtOrigin();
        if (front) { emitBlockFront(); emitBlockRear(); } else { emitBlockRear(); emitBlockFront(); }
        emitReturnFromSafe();
        return;
      }
      const s0Near = startsNear(ps[0]);
      if (mode === 'before' || mode === 'wrap') {
        goSafeAtOrigin();
        // „Vor Profilschnitt": zuerst die Blockseite, auf der der erste Zug NICHT beginnt.
        if (mode === 'before') {
          const Bo = s0Near ? farB : nearB;
          emitBlockAt(Bo, (s0Near ? farTx : nearTx) === TX.nose ? 'Blockvorderkante' : 'hinteres Blockende');
          if (s0Near) farCut = true; else nearCut = true;
        }
        // Startseite auf Null — der Draht bleibt im Schnittspalt und steigt von dort
        // auf die Einlaufhöhe des ersten Zugs.
        const Bs = s0Near ? nearB : farB, txs = s0Near ? nearTx : farTx;
        gBlock0(fx(Bs.l), safeY, fx(Bs.r), 'horizontal an Schnittposition (max)');
        gBlock1(fx(Bs.l), 0, fx(Bs.r), txs.fDown1);
        dwell();
        if (s0Near) { nearCut = true; pos = 'nearKerf'; } else { farCut = true; pos = 'farKerf'; }
      }
      const useSpar = !!(opt.noseSpar && opt.noseSpar.length);
      const hasTop = ps.some(q => q.top);
      let sparDone = false;
      ps.forEach((q, k) => {
        const Lp = q.idx.map(i => L[i]), Rp = q.idx.map(i => R[i]), RPp = RP ? q.idx.map(i => RP[i]) : null;
        const sNear = startsNear(q);
        const noseFirst = front ? sNear : !sNear;   // Zug beginnt an der Nase?
        em('; --- ' + (stackN > 1 ? T('Kopie ') + (q.copy + 1) + ' · ' : '')
          + T(q.top ? (noseFirst ? 'Oberseite: Nase → Endleiste' : 'Oberseite: Endleiste → Nase')
                    : (noseFirst ? 'Unterseite: Nase → Endleiste' : 'Unterseite: Endleiste → Nase')) + ' ---');
        approach(Lp, Rp, sNear);
        emitRun(Lp, Rp, RPp);
        if (mode === 'wrap' && k === 0) faceAtEnd(Lp, Rp, sNear); else exitPass(Lp, Rp, sNear);
        if (useSpar && !sparDone && (q.top || (!hasTop && k === ps.length - 1))) { injectSpar(k < ps.length - 1); sparDone = true; }
      });
      if (mode === 'after') {
        // Blockschnitte NACH dem Profil: erst die Seite, an der der Draht steht.
        const atNear = pos === 'nearLow';
        if (pos !== 'safe') upSafeAtZero();
        const nearCutFn = () => (front ? emitBlockFront() : emitBlockRear());
        const farCutFn = () => (front ? emitBlockRear() : emitBlockFront());
        if (atNear) { nearCutFn(); farCutFn(); } else { farCutFn(); nearCutFn(); }
      }
      if (pos === 'nearLow') {
        em(`G1 ${ax.x}${f(0)} ${ax.y}${f(0)} ${ax.u}${f(0)} ${ax.v}${f(0)} F${airF.toFixed(0)} ; ` + T('vertikal auf Null (außerhalb Block)'));
      } else {
        em(`G1 ${ax.x}${f(0)} ${ax.y}${f(safeY)} ${ax.u}${f(0)} ${ax.v}${f(safeY)} F${airF.toFixed(0)} ; ` + T(nearTx.ret1));
        em(`G1 ${ax.x}${f(0)} ${ax.y}${f(0)} ${ax.u}${f(0)} ${ax.v}${f(0)} F${airF.toFixed(0)} ; ` + T(nearTx.ret2));
      }
    }

    // Oberschale VOR dem Kernschnitt (trapezkompensiert).
    if (SC) emitShellCut(SC.top, front ? SC.rear : SC.front, T('Oberschale (vor Kern)'));

    if (front || (single && mode !== 'only')) {
      emitPasses();
    } else if (mode === 'only') {
      // Nur Blockschnitt: erst hinteres Blockende, dann Blockvorderkante.
      goSafeAtOrigin();
      emitBlockRear();
      emitBlockFront();
      emitReturnFromSafe();
    } else if (mode === 'before') {
      // Vor dem Profil: erst vorne über den Block, dann hinten.
      goSafeAtOrigin();
      emitBlockFront();
      // Hinteres Blockende schneiden, danach NICHT auf Sicherheitshöhe zurück:
      // aus der Tiefe direkt bis auf die Höhe der oberen EL-Verlängerung
      // steigen — dort beginnt der Profilschnitt.
      gBlock0(fx(bc.rear.l), safeY, fx(bc.rear.r));            // horizontal zum hinteren Blockende
      gBlock1(fx(bc.rear.l), 0, fx(bc.rear.r), 'vertikal auf Null (hinteres Blockende)');
      if ((opt.meltDwell || 0) > 0) em('G4 P' + opt.meltDwell + ' ; ' + T('am Nullpunkt verweilen (durchschmelzen)'));
      // Zuerst senkrecht (am hinteren Blockende) auf die Höhe des Profilanfangs,
      // dann horizontal an den Profilanfang — nicht schräg.
      em(`G1 ${ax.x}${fx(bc.rear.l)} ${ax.y}${fy(L[0].y)} ${ax.u}${fx(bc.rear.r)} ${ax.v}${fy(R[0].y)} F${feed.toFixed(0)} ; vertikal hoch auf Höhe des Profilanfangs (im Blockschnitt, Schnittvorschub)`);
      em(`G1 ${ax.x}${fx(L[0].x)} ${ax.y}${fy(L[0].y)} ${ax.u}${fx(R[0].x)} ${ax.v}${fy(R[0].y)} F${airF.toFixed(0)} ; horizontal zum Profilanfang (außerhalb Block, max)`);
      emitContour();
      // Verlassen ohne Sicherheitshöhe: von der Verlängerungsspitze waagerecht
      // bis zum Null-X, dann vertikal nach unten auf Null.
      em(`G1 ${ax.x}${f(0)} ${ax.y}${fy(L[last].y)} ${ax.u}${f(0)} ${ax.v}${fy(R[last].y)} F${airF.toFixed(0)} ; horizontal zum Null-X (außerhalb Block, max)`);
      em(`G1 ${ax.x}${f(0)} ${ax.y}${f(0)} ${ax.u}${f(0)} ${ax.v}${f(0)} F${airF.toFixed(0)} ; vertikal nach unten auf Null (außerhalb Block, max)`);
    } else if (mode === 'wrap' && bc && stackN === 1) {
      // Blockschnitt während Profilschnitt (wenig Leerfahrt): hinteres Blockende ->
      // Profil-Oberseite bis zur Nase -> dort gleich die Blockvorderkante über die
      // VOLLE Blockhöhe (oben UND unten) -> Profil-Unterseite zurück.
      // Der Draht kommt an der Nase aus dem Profil und trennt die Blockvorderkante
      // ohne separaten Umweg zum Nullpunkt.
      goSafeAtOrigin();
      // 1) Hinteres Blockende (auf Null), dann direkt hoch auf den Profilanfang.
      gBlock0(fx(bc.rear.l), safeY, fx(bc.rear.r));
      gBlock1(fx(bc.rear.l), 0, fx(bc.rear.r), 'vertikal auf Null (hinteres Blockende)');
      if ((opt.meltDwell || 0) > 0) em('G4 P' + opt.meltDwell + ' ; ' + T('am Nullpunkt verweilen (durchschmelzen)'));
      em(`G1 ${ax.x}${fx(bc.rear.l)} ${ax.y}${fy(L[0].y)} ${ax.u}${fx(bc.rear.r)} ${ax.v}${fy(R[0].y)} F${feed.toFixed(0)} ; vertikal hoch auf Höhe des Profilanfangs (im Blockschnitt, Schnittvorschub)`);
      em(`G1 ${ax.x}${fx(L[0].x)} ${ax.y}${fy(L[0].y)} ${ax.u}${fx(R[0].x)} ${ax.v}${fy(R[0].y)} F${airF.toFixed(0)} ; horizontal zum Profilanfang (außerhalb Block, max)`);
      // 2) Oberseite bis zur Nase.
      emitContour(1, iLE);
      // 3) Blockvorderkante an der Nase: vor die Nase (in Luft, im vorderen Verschnitt)
      //    auf Nasenhöhe. Dann die Blockvorderkante über die VOLLE Blockhöhe trennen:
      //    erst nach OBEN bis Sicherheitshöhe (oberer Blockschnitt), zurück auf Null
      //    (unterer Blockschnitt, Kerf-Retrace durch den oberen Teil), dann wieder hoch
      //    auf Nasenhöhe und zurück zur Nase.
      em(`G1 ${ax.x}${fx(bc.front.l)} ${ax.y}${fy(L[iLE].y)} ${ax.u}${fx(bc.front.r)} ${ax.v}${fy(R[iLE].y)} F${feed.toFixed(0)} ; vor die Nase zur Blockvorderkante (durch den vorderen Verschnitt, Schnittvorschub)`);
      gBlock1(fx(bc.front.l), safeY, fx(bc.front.r), 'vertikal hoch auf Sicherheitshöhe (Blockvorderkante oben)');
      gBlock1(fx(bc.front.l), 0, fx(bc.front.r), 'vertikal auf Null (Blockvorderkante)');
      if ((opt.meltDwell || 0) > 0) em('G4 P' + opt.meltDwell + ' ; ' + T('am Nullpunkt verweilen (durchschmelzen)'));
      em(`G1 ${ax.x}${fx(bc.front.l)} ${ax.y}${fy(L[iLE].y)} ${ax.u}${fx(bc.front.r)} ${ax.v}${fy(R[iLE].y)} F${feed.toFixed(0)} ; vertikal hoch auf Nasenhöhe (Blockvorderkante)`);
      em(`G1 ${ax.x}${fx(L[iLE].x)} ${ax.y}${fy(L[iLE].y)} ${ax.u}${fx(R[iLE].x)} ${ax.v}${fy(R[iLE].y)} F${feed.toFixed(0)} ; horizontal zurück zur Nase (im Schnittspalt, Schnittvorschub)`);
      // 4) Unterseite zurück bis zur EL-Verlängerung, dann hinten aus dem Block auf Null.
      emitContour(iLE + 1, last);
      em(`G1 ${ax.x}${f(0)} ${ax.y}${fy(L[last].y)} ${ax.u}${f(0)} ${ax.v}${fy(R[last].y)} F${airF.toFixed(0)} ; horizontal zum Null-X (außerhalb Block, max)`);
      em(`G1 ${ax.x}${f(0)} ${ax.y}${f(0)} ${ax.u}${f(0)} ${ax.v}${f(0)} F${airF.toFixed(0)} ; vertikal nach unten auf Null (außerhalb Block, max)`);
    } else if (mode === 'after') {
      // Nach dem Profil: Profil wie „ohne Blockschnitt" (horizontale An-/Abfahrt,
      // ohne Sicherheitshöhe), danach hinteres Blockende, dann Blockvorderkante.
      emitProfileHorizontal(false);   // endet am Null-X auf Höhe der Spitze
      goSafeAtOrigin();               // hoch auf Sicherheitshöhe für die Blockschnitte
      emitBlockRear();
      emitBlockFront();
      emitReturnFromSafe();
    } else { // 'none'
      emitProfileHorizontal(true);   // eigenständig: endet auf dem Nullpunkt
    }
    // Unterschale NACH dem Kernschnitt (trapezkompensiert), dann zurück auf Null.
    if (SC) {
      emitShellCut(SC.bottom, front ? SC.rear : SC.front, T('Unterschale (nach Kern)'));
      em(`G1 ${ax.x}${f(0)} ${ax.y}${f(0)} ${ax.u}${f(0)} ${ax.v}${f(0)} F${maxMove.toFixed(0)} ; zurück auf den Nullpunkt (max)`);
    }
    if (opt.wireHeat != null) em('M5 ; Drahtheizung AUS');
    em('M2 ; Ende');
    if (opt.footer) opt.footer.split('\n').forEach(l => em(l));

    // Doppelte Fahrten vermeiden: Bewegungszeilen (G0/G1), die den Draht NICHT
    // bewegen (Zielposition = aktuelle Position auf allen 4 Achsen), werden
    // entfernt. Das räumt Null-Fahrten auf, die an Übergängen (Schalenschnitt,
    // Blockschnitt, Ein-/Auslauf) entstehen, ohne die Geometrie zu ändern.
    const cleaned = dedupeMoves(out, [ax.x, ax.y, ax.u, ax.v], p);

    return {
      text: cleaned.join('\n'),
      lines: cleaned.length,
      cutLengthFoam: totalFoam,
      estMinutes: totalTime
    };
  }

  /* Entfernt nulllange Bewegungszeilen (G0/G1 ohne Positionsänderung). Achswerte
   * werden nur aus dem Code-Teil VOR dem ';' gelesen (Kommentare bleiben außen
   * vor). Nicht-Bewegungszeilen (Kommentare, M-/G-Codes) bleiben unverändert. */
  function dedupeMoves(lines, axes, prec) {
    const eps = Math.pow(10, -(prec || 3)) / 2;
    const cur = {};
    const res = [];
    for (const ln of lines) {
      if (!/^\s*G0?[01]\b/.test(ln)) { res.push(ln); continue; }   // nur G0/G1
      const code = ln.split(';')[0];
      const vals = {}; let any = false, moved = false;
      for (const a of axes) {
        const m = code.match(new RegExp(a + '(-?\\d+(?:\\.\\d+)?)'));
        if (m) { const v = parseFloat(m[1]); vals[a] = v; any = true; if (cur[a] === undefined || Math.abs(cur[a] - v) > eps) moved = true; }
      }
      if (any && !moved) continue;                 // Zielposition = aktuelle -> Null-Fahrt weg
      for (const a of axes) if (vals[a] !== undefined) cur[a] = vals[a];
      res.push(ln);
    }
    return res;
  }

  global.HotWire.gcode = gcode;
})(window);
