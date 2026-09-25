/* cutpanel.js — Reiter „Schneiden" und „Maschine" (Heißdraht): Verdrahtung des GRBL-Pendants
 * (GrblPanel aus grbl.js) mit den G-Code-Quellen, Monitor-Simulation, Blockzurichten sowie die
 * zugehörigen Seitenleisten-Gruppen (Blockzuschnitt, Guillotine, Block horizontal, Kalibrierung,
 * Vorschub-Modus G93, GRBL-Einstellungen $$). Abwählbare Funktion „machine" (features.json,
 * braucht „gcodegen"). Ohne diese Datei gibt es keine Maschinensteuerung — die übrigen Module
 * rufen ihre Namen nur geschützt auf (App.cutWireUp, App.sidebarMachine, App.renderBlock,
 * App.refreshCutSource, App.setupBlock3D).
 * Am 2026-09-13 aus app.js, render.js, sidebar.js und gcode.js herausgelöst. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state, render, renderMaterial, buildSidebar, fitCanvas, applyPreheat, applyFeedMode } = App;
  const { grp, numRow, selectRow, boolRow, feedRow, txtRow, hint, warn, subhead } = App;
  const { buildScene, buildNegScene, buildBlockScene, buildGuillotineScene, buildBlockHScene, buildCalibScene } = App;
  const { buildModelScene, buildPlateScene, modelGcode, plateGcode, guillotineGcode, blockHGcode, calibGcode } = App;

  // Bei Parameteränderung die Schneiden-Quelle neu übernehmen, wenn aktiv.
  function refreshCutSource(which) {
    const src = document.getElementById('cutSource');
    if (state.activeTab === 'cut' && src && src.value === which) {
      const btn = document.getElementById('mUseGcode'); if (btn) btn.click();
    }
  }


  /* Reiter „Blockzurichten": 3D-Vorschau + G-Code (zwei kerf-komp. Vertikalschnitte). */
  const bcam = { yaw: -0.62, pitch: 0.45, zoom: 1, drag: null };
  function renderBlock() {
    if (!window.BlockPrep) return;
    const k = App.kerfForSpeed(App.matIdFor('wing'), state.block.feed);
    const spec = { dist: state.block.dist, length: state.block.length, height: App.blockH('wing'), kerf: k };
    const cuts = BlockPrep.cutsFor(spec);
    const safeY = App.blockH('wing') + (state.material.safeH || 20);
    const g = BlockPrep.gcode({
      dist: spec.dist, length: spec.length, H: spec.height, kerf: k,
      feed: state.block.feed, heat: App.currentHeat(), heatS: App.currentWireS(), safeY, precision: state.cfg.precision,
      meltDwell: +state.material.meltDwell || 0,
      ax: { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV }, cuts
    });
    g.text = applyPreheat(g.text);       // Aufheizphase mit einrechnen (auch für Simulation)
    state.lastBlockGcode = g;
    const ta = document.getElementById('blockGcode'); if (ta) ta.value = g.text;
    const info = document.getElementById('blockInfo');
    if (info) info.textContent = T('Block ') + spec.length + T(' mm lang · Höhe ') + spec.height + T(' mm · Abbrand ') + k.toFixed(2)
      + T(' mm komp. · Schnittlänge ') + g.cutLength.toFixed(0) + ' mm';
    drawBlock3D(cuts);
  }
  // Kompakte 3D-Vorschau: fertiger Block (Quader) + zwei Schnittebenen + Nullpunkt.
  function drawBlock3D(cuts) {
    const cv = document.getElementById('cBlock'); if (!cv) return;
    const { ctx, w, h } = fitCanvas(cv); ctx.clearRect(0, 0, w, h);
    const d1 = state.block.dist, L = state.block.length, H = App.blockH('wing');
    const d2 = d1 + L, mw = state.cfg.machineWidth || 900;
    const cyaw = Math.cos(bcam.yaw), syaw = Math.sin(bcam.yaw), cp = Math.cos(bcam.pitch), sp = Math.sin(bcam.pitch);
    const cx = (d1 + d2) / 2, ch = H / 2, cz = mw / 2;
    const rot = (x, y, z) => {
      x -= cx; y -= ch; z -= cz;
      const X = x * cyaw - z * syaw, Z = x * syaw + z * cyaw;
      return { x: X, y: y * cp - Z * sp };
    };
    // Autoscale über alle relevanten Punkte.
    const box = [[d1, 0, 0], [d2, 0, 0], [d2, H, 0], [d1, H, 0], [d1, 0, mw], [d2, 0, mw], [d2, H, mw], [d1, H, mw]];
    const pts = box.concat([[0, 0, cz], [d2 + 30, 0, cz]]);
    cuts.forEach(c => pts.push([c.x1, 0, 0], [c.x1, H, mw]));
    let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
    pts.forEach(pp => { const p = rot(pp[0], pp[1], pp[2]); mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x); mny = Math.min(mny, p.y); mxy = Math.max(mxy, p.y); });
    const pad = 46, s = Math.min((w - 2 * pad) / ((mxx - mnx) || 1), (h - 2 * pad) / ((mxy - mny) || 1)) * bcam.zoom;
    const ox = (mnx + mxx) / 2, oy = (mny + mxy) / 2;
    const S = (x, y, z) => { const p = rot(x, y, z); return { x: w / 2 + (p.x - ox) * s, y: h / 2 - (p.y - oy) * s }; };
    const line = (a, b, col, wd) => { ctx.strokeStyle = col; ctx.lineWidth = wd || 1; ctx.beginPath(); const p = S(a[0], a[1], a[2]), q = S(b[0], b[1], b[2]); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); };
    // Nullpunkt-Bezugslinie (X-Achse bei Y0), rot.
    line([Math.min(0, d1) - 20, 0, cz], [d2 + 30, 0, cz], '#ff3b3b', 1.5);
    // Block-Quader (Kanten).
    const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    E.forEach(([a, b]) => line(box[a], box[b], '#8fa0b4', 1.3));
    // Schnittebenen (rot, halbtransparent).
    cuts.forEach(c => {
      const pl = [[c.x1, 0, 0], [c.x1, H, 0], [c.x1, H, mw], [c.x1, 0, mw]];
      ctx.beginPath(); pl.forEach((pt, i) => { const q = S(pt[0], pt[1], pt[2]); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.closePath();
      ctx.fillStyle = 'rgba(255,90,60,0.16)'; ctx.fill(); ctx.strokeStyle = '#ff5a3c'; ctx.lineWidth = 1.6; ctx.stroke();
    });
    // Nullpunkt-Marker + Beschriftung.
    const o = S(0, 0, cz); ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(o.x, o.y, 4, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = '#8b98a8'; ctx.font = '11px Segoe UI'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('X0/Y0', o.x + 6, o.y + 4);
    ctx.fillText(T('Block ') + L + ' × ' + H + T(' mm · 1. Schnitt bei X=') + d1 + ' mm', 12, 18);
    ctx.fillText(T('Ziehen = drehen · Rad = Zoom · Doppelklick = zurück'), 12, h - 10);
  }
  function setupBlock3D() {
    const cv = document.getElementById('cBlock'); if (!cv) return;
    if (window.ViewCube) ViewCube.attach({ canvas: () => document.getElementById('cBlock'), get: () => bcam, set: (y, p) => { bcam.yaw = y; bcam.pitch = p; }, redraw: () => renderBlock(),
      rot: (v, y, p) => ViewCube.ROT_STD(v, -y, p), k: [-0.01, -0.01], labels: { '+x': '+X', '-x': '−X', '+z': '+Z', '-z': '−Z' } });
    cv.addEventListener('mousedown', e => { bcam.drag = { x: e.clientX, y: e.clientY, yaw: bcam.yaw, pitch: bcam.pitch }; cv.style.cursor = 'grabbing'; });
    window.addEventListener('mousemove', e => {
      if (!bcam.drag) return;
      bcam.yaw = bcam.drag.yaw - (e.clientX - bcam.drag.x) * 0.01 * (Math.cos(bcam.drag.pitch) < 0 ? -1 : 1);   // invertiert (wie Simulator)
      bcam.pitch = bcam.drag.pitch - (e.clientY - bcam.drag.y) * 0.01;   // keine Kipp-Begrenzung
      drawBlock3D(BlockPrep ? BlockPrep.cutsFor({ dist: state.block.dist, length: state.block.length, height: App.blockH('wing'), kerf: App.kerfForSpeed(state.material.id, state.block.feed) }) : []);
    });
    window.addEventListener('mouseup', () => { if (bcam.drag) { bcam.drag = null; cv.style.cursor = 'grab'; } });
    cv.addEventListener('wheel', e => { e.preventDefault(); bcam.zoom *= Math.exp(-e.deltaY * 0.0015); renderBlock(); }, { passive: false });
    cv.addEventListener('dblclick', () => { bcam.yaw = -0.62; bcam.pitch = 0.45; bcam.zoom = 1; renderBlock(); });
    cv.style.cursor = 'grab';
  }


  // ---------- Seitenleiste: Gruppen der Reiter „Schneiden" und „Maschine" ----------
  // Wird aus buildSidebar() (sidebar.js) an den bisherigen Stellen aufgerufen.
  function sidebarMachine(side, part) {
    if (part === 'cut') {
      // --- Reiter „Schneiden" (cut): Blockzurichten integriert ----------
      // Nur Maße des ZU SCHNEIDENDEN Blocks; der Rohblock ist egal. Zwei kerf-
      // kompensierte Vertikalschnitte (vorne/hinten) legen die Blocklänge fest.
      // Als G-Code-Quelle im Reiter „Schneiden" wählbar. „Blockzuschnitt" ist nur
      // eine Überschrift; darunter liegen die drei Funktionen als eigene,
      // standardmäßig eingeklappte Gruppen.
      const bzHead = grp('Blockzuschnitt', true, 'cut', { alwaysOpen: true });
      bzHead.g.classList.add('grp-head');
      bzHead.body.remove();                    // nur Titelzeile, kein Inhalt
      side.appendChild(bzHead.g);

      // 1) Guillotine ---------------------------------------------------
      const zuG = grp('Guillotine', false, 'cut'); zuG.g.classList.add('grp-sub');
      numRow(zuG.body, 'Höhe (mm)', () => state.guillotine.height,
        v => { state.guillotine.height = v; refreshCutSource('guillotine'); }, { min: 1, norender: true,
        hint: 'Wie hoch der Schnitt reicht (ab Y0 bis Höhe). Der Draht durchtrennt bis Y0.' });
      numRow(zuG.body, 'X-Abstand zum Nullpunkt unten (mm)', () => state.guillotine.xDist,
        v => { state.guillotine.xDist = v; refreshCutSource('guillotine'); }, { min: 0, norender: true,
        hint: 'X-Position des UNTEREN Schnittpunkts (bei Y0), gemessen vom Maschinen-Nullpunkt.' });
      numRow(zuG.body, 'Winkel (°)', () => state.guillotine.angle,
        v => { state.guillotine.angle = Math.max(-89, Math.min(89, v)); refreshCutSource('guillotine'); }, { step: 1, min: -89, max: 89, norender: true,
        hint: 'Neigung gegen die Senkrechte. 0° = senkrecht; positiv kippt die Oberkante nach +X (hinten).' });
      feedRow(zuG.body, 'Vorschub (mm/min)', () => state.guillotine.feed,
        v => { state.guillotine.feed = v; refreshCutSource('guillotine'); }, { min: 1, norender: true });
      const ovIn = numRow(zuG.body, 'Überfahrt unter Y0 (mm, negativ)', () => -Math.abs(state.guillotine.overY || 0),
        v => { state.guillotine.overY = -Math.abs(v); refreshCutSource('guillotine'); }, { max: 0, step: 0.5, norender: true,
        hint: 'Y-Zielwert unter dem Nullpunkt, z. B. -3 = der Draht fährt auf derselben Schnittlinie bis Y = -3 mm, um sicher ganz durchzuschneiden. Das Vorzeichen wird automatisch negativ gesetzt. Unten hält die Maschine an (Pause, Draht bleibt an); nach „Fortsetzen“ geht der Draht aus und sie fährt im Eilgang zurück auf Y0. 0 = aus. Achtung: Die Maschine muss den Weg unter Y0 tatsächlich fahren können (Endschalter/Auflage prüfen).' });
      // Vorzeichen automatisch negativ: beim Verlassen des Feldes den gespeicherten Wert anzeigen (3 → -3).
      ovIn.onblur = () => { ovIn.value = -Math.abs(state.guillotine.overY || 0); };
      selectRow(zuG.body, 'Rauffahren', [['rapid', 'Eilgang (Draht aus)'], ['cut', 'Schnitt (Draht ein)']],
        () => state.guillotine.upMode, v => { state.guillotine.upMode = v; refreshCutSource('guillotine'); },
        'Eilgang: schnell rauf mit Max-Vorschub, Draht automatisch AUS (nur Positionieren). '
        + 'Schnitt: rauf mit Vorschub, Draht automatisch EIN (schneidet bereits hoch).');
      hint(zuG.body, 'Ein gerader, planarer Schnitt (beide Türme identisch). Als G-Code-Quelle „Guillotine" '
        + 'im Reiter „Schneiden" wählen und übernehmen.');
      side.appendChild(zuG.g);

      // 2) Block ablängen (vertikal) ------------------------------------
      const zuV = grp('Block ablängen (vertikal)', false, 'cut'); zuV.g.classList.add('grp-sub');
      numRow(zuV.body, '1. Schnitt: Abstand von Nullpunkt X (mm)', () => state.block.dist,
        v => { state.block.dist = v; renderBlock(); refreshCutSource('block'); }, { min: 0, norender: true,
        hint: 'Horizontaler Abstand des vorderen Schnitts vom Maschinen-Nullpunkt (X0).' });
      // Blocklänge: frei wählbar ODER direkt eine Segment-Spannweite aus dem
      // Tragflächendesigner übernehmen. Bei Auswahl eines Segments wird dessen
      // span als Blocklänge gesetzt; „Frei" lässt die manuelle Eingabe zu.
      if (state.segments && state.segments.length) {
        const segLenOpts = [['free', 'Frei']].concat(
          state.segments.map((s, i) =>
            [String(i), T('Segment ') + (i + 1) + ' (' + (s.span || 0).toFixed(0) + ' mm)']));
        selectRow(zuV.body, 'Blocklänge aus Segment', segLenOpts,
          () => (state.block.lenSrc == null ? 'free' : state.block.lenSrc),
          v => {
            state.block.lenSrc = v;
            if (v !== 'free') {
              const s = state.segments[+v];
              if (s) state.block.length = s.span || 0;
            }
            buildSidebar(); renderBlock(); refreshCutSource('block');
          },
          'Blocklänge frei eingeben oder direkt die Spannweite eines Segments aus dem Tragflächendesigner übernehmen.');
      }
      numRow(zuV.body, 'Blocklänge (mm)', () => state.block.length,
        v => { state.block.length = v; state.block.lenSrc = 'free'; renderBlock(); refreshCutSource('block'); }, { min: 1, norender: true,
        hint: 'Abstand vom 1. zum 2. (hinteren) Schnitt = fertige Blocklänge.' });
      hint(zuV.body, 'Blockhöhe = Werkstoff-Blockhöhe (Reiter „Projektübersicht"). Der Draht sticht an der Blockoberkante ein und fährt bis Y0 durch.');
      feedRow(zuV.body, 'Vorschub (mm/min)', () => state.block.feed,
        v => { state.block.feed = v; renderBlock(); refreshCutSource('block'); }, { min: 1, norender: true });
      hint(zuV.body, T('Zwei planare Vertikalschnitte, um Abbrand/2 nach außen versetzt (Abbrand-kompensiert) → Block misst exakt die Länge. Draht ')
        + App.kerfForSpeed(App.matIdFor('wing'), state.block.feed).toFixed(2)
        + T(' mm Abbrand · Heizung ') + App.currentHeat() + T(' % (aus Werkstoff). Als G-Code-Quelle „Block" wählbar.'));
      side.appendChild(zuV.g);

      // 3) Block horizontal ---------------------------------------------
      const zuH = grp('Block horizontal', false, 'cut'); zuH.g.classList.add('grp-sub');
      const bh = state.blockH;
      selectRow(zuH.body, 'Modus', [['height', 'Auf Höhe ablängen (nur oben)'], ['topbottom', 'Ober- und Unterseite']],
        () => bh.mode, v => { bh.mode = v; buildSidebar(); refreshCutSource('blockH'); },
        'Auf Höhe ablängen: EIN waagrechter Schnitt bei yTop, von vorn nach hinten, ohne Sicherheitshöhe (Anfahrt vor dem Block auf Y0, Rückweg im Schnittspalt). '
        + 'Ober- und Unterseite: durchgehend oben → hinten runter → unten durch (Scheibe zwischen yBot und yTop).');
      if (bh.mode === 'height')
        selectRow(zuH.body, 'Schnitt-Ablauf',
          [['rapidCut', 'Eilgang hin, Schnitt zurück'], ['cutRapid', 'Schnitt hin, Eilgang zurück'], ['cutCut', 'Schnitt hin und zurück']],
          () => bh.pass || 'cutRapid', v => { bh.pass = v; refreshCutSource('blockH'); },
          'Reihenfolge beim Ablängen auf Höhe. „Eilgang hin, Schnitt zurück": der Draht fährt im Eilgang über die Blockoberkante nach hinten '
          + '(braucht Sicherheitshöhe über dem Block und Platz dahinter) und schneidet dann in einem Zug zurück nach vorn — der Abfall fällt vorn ab. '
          + '„Schnitt hin, Eilgang zurück" (Standard): schneidet nach hinten und fährt im Schnittspalt zurück — der Abfall fällt hinten ab. '
          + '„Schnitt hin und zurück": schneidet in beide Richtungen (zweiter Durchgang glättet die Kante), mit Pause am hinteren Ende zum Abnehmen des Abfalls.');
      numRow(zuH.body, 'X-Abstand von Nullpunkt (mm)', () => bh.dist,
        v => { bh.dist = v; refreshCutSource('blockH'); }, { min: 0, norender: true,
        hint: 'Vordere X-Kante des Blocks (Abstand vom Maschinen-Nullpunkt X0).' });
      numRow(zuH.body, 'Blocklänge X (mm)', () => bh.length,
        v => { bh.length = v; refreshCutSource('blockH'); }, { min: 1, norender: true,
        hint: 'X-Ausdehnung des Blocks (die der waagrechte Schnitt durchtrennt).' });
      numRow(zuH.body, 'Höhe oben yTop (mm)', () => bh.yTop,
        v => { bh.yTop = v; refreshCutSource('blockH'); }, { min: 1, norender: true,
        hint: 'Höhe des oberen Schnitts ab Y0. Alles darüber wird abgetrennt.' });
      if (bh.mode === 'topbottom')
        numRow(zuH.body, 'Höhe unten yBot (mm)', () => bh.yBot,
          v => { bh.yBot = v; refreshCutSource('blockH'); }, { min: 0, norender: true,
          hint: 'Höhe des unteren Schnitts ab Y0. Fertige Scheibe liegt zwischen yBot und yTop.' });
      numRow(zuH.body, 'Überlauf X vor/hinter dem Block (mm)', () => (bh.over != null ? bh.over : 10),
        v => { bh.over = Math.max(0, v); refreshCutSource('blockH'); }, { min: 0, step: 1, norender: true,
        hint: 'Der waagrechte Schnitt beginnt um diesen Betrag VOR dem Block und endet um diesen Betrag DAHINTER, damit der Draht sicher beidseitig aus dem Werkstoff austritt. 0 = exakt an den Blockkanten.' });
      feedRow(zuH.body, 'Vorschub (mm/min)', () => bh.feed,
        v => { bh.feed = v; refreshCutSource('blockH'); }, { min: 1, norender: true });
      hint(zuH.body, 'Waagrechte, planare Schnitte (beide Türme identisch). Als G-Code-Quelle „Block horizontal" '
        + 'im Reiter „Schneiden" wählen und übernehmen.');
      side.appendChild(zuH.g);

      // --- Kalibrierung (Testschnitt) -----------------------------------
      // Eigene Abschnitts-Überschrift (konsistent zu „Blockzuschnitt"), darunter
      // die Funktion als eingeklappte Untergruppe.
      const kalHead = grp('Kalibrierung', true, 'cut', { alwaysOpen: true });
      kalHead.g.classList.add('grp-head');
      kalHead.body.remove();
      side.appendChild(kalHead.g);

      const cb = state.calib, mid = state.material.id;
      const ca = grp('Abbrand-Kalibrierung', false, 'cut'); ca.g.classList.add('grp-sub');
      hint(ca.body, 'Testrechtecke am gewählten Werkstoff schneiden, Ist-Maße messen und den Abbrand '
        + 'je Vorschub eintragen. Die Werte gehen direkt in die Werkstoff-Kalibrierung ein.');
      const calMatOpts = App.matOptions();
      if (calMatOpts.length)
        selectRow(ca.body, 'Werkstoff', calMatOpts, () => state.material.id,
          v => { state.material.id = v; buildSidebar(); renderMaterial(); refreshCutSource('calib'); });
      else
        hint(ca.body, 'Noch kein Werkstoff angelegt — bitte zuerst im Reiter „Projektübersicht" einen anlegen.');
      subhead(ca.body, 'Testrechteck');
      numRow(ca.body, 'Länge (mm)', () => cb.len, v => { cb.len = v; refreshCutSource('calib'); }, { min: 1, norender: true });
      numRow(ca.body, 'Höhe (mm)', () => cb.hgt, v => { cb.hgt = v; refreshCutSource('calib'); }, { min: 1, norender: true });
      numRow(ca.body, 'Anzahl', () => cb.count, v => { cb.count = Math.max(1, v); buildSidebar(); refreshCutSource('calib'); }, { int: true, min: 1, norender: true });
      if (cb.count > 1)
        numRow(ca.body, 'Abstand gestapelt (mm)', () => cb.gap, v => { cb.gap = Math.max(0, v); refreshCutSource('calib'); }, { min: 0, norender: true });
      numRow(ca.body, 'X-Abstand vom Nullpunkt (mm)', () => cb.xDist, v => { cb.xDist = Math.max(0, v); refreshCutSource('calib'); }, { min: 0, norender: true });
      numRow(ca.body, 'Abstand vom Boden (mm)', () => cb.yBase, v => { cb.yBase = Math.max(0, v); refreshCutSource('calib'); }, { min: 0, norender: true,
        hint: 'Höhe des UNTERSTEN Vierecks über dem Maschinen-Nullpunkt (Y0). Die weiteren stapeln nach oben.' });
      boolRow(ca.body, 'Mit Abbrand-Kompensation schneiden', () => cb.withKerf,
        v => { cb.withKerf = v; refreshCutSource('calib'); },
        'Ohne: Rohschnitt auf Nennmaß — das Rechteck wird um den Abbrand kleiner (Differenz = Abbrand). '
        + 'Mit: um Abbrand/2 nach außen versetzt — das FERTIGE Rechteck sollte das Nennmaß haben (Kontrolle).');
      hint(ca.body, 'Drei Kalibrierpunkte: 1 = schnell mit Heizstrom 1, 2 = langsam mit Heizstrom 1, 3 = langsam mit Heizstrom 2. '
        + 'Punkt 1+2 ergeben die Abbrand-Gerade über den Vorschub (konische Teile: innen/außen unterschiedlich schnell). '
        + 'Punkt 1+3 ergeben davon unabhängig die Heizstrom-Gerade über den Vorschub (Heizung folgt dem Vorschub).');
      selectRow(ca.body, 'Testschnitt', [['fast', '1: schnell, Heizstrom 1'], ['slow', '2: langsam, Heizstrom 1'], ['slowH', '3: langsam, Heizstrom 2']],
        () => cb.speed, v => { cb.speed = v; refreshCutSource('calib'); });
      subhead(ca.body, 'Punkt 1: schnell, Heizstrom 1');
      numRow(ca.body, 'Vorschub schnell (mm/min)', () => App.feedPair(mid).fast, v => { App.setFeed('fast', v); App.syncAutoFeed(); renderMaterial(); refreshCutSource('calib'); }, { min: 1, norender: true });
      numRow(ca.body, 'Heizstrom 1 (%)', () => App.matHeat(mid), v => { App.setHeat(v); renderMaterial(); refreshCutSource('calib'); }, { min: 0, max: 100, norender: true });
      numRow(ca.body, 'Abbrand schnell (mm)', () => App.kerfPair(mid).fast.toFixed(2), v => { App.setKerf('fast', v); renderMaterial(); refreshCutSource('calib'); }, { step: 0.05, min: 0, norender: true });
      subhead(ca.body, 'Punkt 2: langsam, Heizstrom 1');
      numRow(ca.body, 'Vorschub langsam (mm/min)', () => App.feedPair(mid).slow, v => { App.setFeed('slow', v); renderMaterial(); refreshCutSource('calib'); }, { min: 1, norender: true });
      numRow(ca.body, 'Abbrand langsam (mm)', () => App.kerfPair(mid).slow.toFixed(2), v => { App.setKerf('slow', v); renderMaterial(); refreshCutSource('calib'); }, { step: 0.05, min: 0, norender: true });
      subhead(ca.body, 'Punkt 3: langsam, Heizstrom 2');
      boolRow(ca.body, 'Heizstrom vorschubabhängig (Punkt 3 aktiv)', () => App.heatPair(mid).varies,
        v => { App.setHeatSlow(v ? App.matHeat(mid) : null); buildSidebar(); renderMaterial(); refreshCutSource('calib'); },
        'Ein: Testschnitt 3 mit gleichem Vorschub wie Punkt 2, aber so verändertem Heizstrom fahren, dass der Abbrand '
        + 'GLEICH dem von Punkt 1 ist. Die Heizung folgt dann in allen G-Codes dem Vorschub (linear zwischen Punkt 3 und Punkt 1) '
        + 'und der Abbrand bleibt beim vorgegebenen Vorschub konstant = Abbrand schnell; nur innerhalb eines Schnitts '
        + '(kürzere Rippe läuft langsamer) wirkt die Steigung aus Punkt 1+2. Aus: Heizung konstant = Heizstrom 1, Abbrand aus 1+2.');
      if (App.heatPair(mid).varies) {
        numRow(ca.body, 'Heizstrom 2 (%)', () => App.heatPair(mid).slow, v => { App.setHeatSlow(v); renderMaterial(); refreshCutSource('calib'); }, { min: 0, max: 100, norender: true });
        // Dieser Hinweis ist STANDARDMÄSSIG sichtbar (auch bei eingeklappten Beschreibungen).
        hint(ca.body, 'Heizstrom 2 so einstellen, dass der Abbrand bei langsamer Geschwindigkeit GLEICH dem Abbrand von Punkt 1 (schnelle Geschwindigkeit, hoher Heizstrom) ist. Testschnitt 3 so lange wiederholen, bis dieses Maß erreicht ist.').classList.add('hint-open');
        numRow(ca.body, 'Abbrand (= Punkt 1, mm)', () => App.kerfPair(mid).fast.toFixed(2), () => {}, { readonly: true,
          roTitle: 'Per Definition gleich dem Abbrand von Punkt 1 — Heizstrom 2 so einstellen, dass der Testschnitt 3 dieses Maß ergibt.' });
      }
      const done = state.material.cal && state.material.cal[mid];
      const bcal = document.createElement('button'); bcal.className = done ? '' : 'primary';
      bcal.textContent = done ? T('✓ Als kalibriert markiert') : T('Werkstoff als kalibriert markieren');
      bcal.onclick = () => { if (!state.material.cal) state.material.cal = {}; state.material.cal[mid] = !state.material.cal[mid]; buildSidebar(); renderMaterial(); };
      ca.body.appendChild(bcal);
      hint(ca.body, 'Als G-Code-Quelle „Abbrand-Kalibrierung" im Reiter „Schneiden" wählen und übernehmen.');
      side.appendChild(ca.g);
      return;
    }
    if (part === 'feedmode') {
      // Vorschub-Modus des erzeugten G-Codes. Betrifft NUR die Schreibweise des
      // Vorschubs — der eingestellte Schnittvorschub (mm/min an der Wurzelrippe)
      // bleibt in beiden Modi derselbe.
      const fm = grp('Vorschub-Modus (G94 / G93)', true, 'machine');
      selectRow(fm.body, 'Bedeutung von F im G-Code',
        [['g94', 'G94 — F in mm/min'], ['g93', 'G93 — Inverse Time (F = 1/Blockdauer, Standard)']],
        () => state.cfg.feedMode || 'g93', v => { state.cfg.feedMode = v; buildSidebar(); render(); },
        'Wie der Vorschub in den G-Code geschrieben wird. „G94": F ist eine Geschwindigkeit in '
        + 'mm/min — die Steuerung entscheidet selbst, auf welche Achskombination sie diese '
        + 'Geschwindigkeit bezieht. Bei vier Achsen (X/Y + U/V) ist das NICHT genormt: manche '
        + 'Steuerungen nehmen die Länge über alle vier Achsen, andere nur das schnellere Portal. '
        + 'Deshalb kann der Schnittvorschub am Werkstück von der Vorgabe abweichen — und damit '
        + 'auch der Abbrand. „G93" (Inverse Time) gibt statt der Geschwindigkeit die DAUER jedes '
        + 'Blocks vor (F = 1/Dauer in Minuten). Die Zeit ist damit eindeutig, unabhängig von der '
        + 'Steuerung — der Vorschub an der Wurzelrippe stimmt exakt. Erfordert eine Steuerung, '
        + 'die G93 beherrscht (GRBL 1.1, grblHAL, FluidNC, LinuxCNC, Mach3).');
      if ((state.cfg.feedMode || 'g93') === 'g93')
        hint(fm.body, '⚠ In G93 lässt sich am Gerät KEIN Vorschub in mm/min mehr eintippen — F bedeutet dort '
          + 'eine Zeit. Auch der prozentuale Echtzeit-Override (Feed-Override) ist hier keine gute Idee: '
          + 'reine Heißdraht-Firmware (z. B. Grbl HotWire) sperrt ihn im G93-Betrieb bewusst, weil das '
          + 'Verstellen der Geschwindigkeit die Synchronität der vier Achsen stören kann. Die Regel beim '
          + 'Schaumschneiden lautet: „Heizung nachregeln, nicht das Tempo." Ein anderer Vorschub bedeutet '
          + 'G-Code neu erzeugen — das zieht Abbrand und Heizstrom aus der Werkstoff-Kalibrierung mit.');
      else
        hint(fm.body, 'Bei Abweichungen zwischen eingestelltem und tatsächlich gefahrenem Schnittvorschub '
          + '(Abbrand stimmt nicht) ist G93 der saubere Weg — dort kann die Steuerung den Vorschub '
          + 'nicht mehr anders interpretieren.');
      side.appendChild(fm.g);
      return;
    }
    if (part === 'relay') {
      // Zusätzlicher Schaltausgang parallel zur Drahtheizung (Relais/SSR).
      const rl = grp('Schaltausgang (Relais) parallel zur Drahtheizung', true, 'machine');
      boolRow(rl.body, 'Schaltausgang mitschalten', () => !!state.cfg.relayOut,
        v => { state.cfg.relayOut = v; buildSidebar(); render(); renderBlock(); },
        'Schaltet zusätzlich zur Drahtheizung (M3 S…/M5) einen zweiten Ausgang der Steuerung — '
        + 'für ein Relais oder SSR, das die Drahtleistung aus einem eigenen Netzteil schaltet. '
        + 'Auf einem RAMPS 1.4 mit grbl-Mega-5X liegt die Heizung (Spindel, PWM) auf D8; PWM-frei '
        + 'schaltbar sind die Kühlmittelausgänge: M7 = D10 („Mist"), M8 = D9 („Flood"), M9 = beide aus. '
        + 'Ein mechanisches Relais gehört NICHT auf den PWM-Ausgang — es würde im Takt rattern.');
      if (state.cfg.relayOut) {
        // Welcher Ausgang: im G-Code gibt es keine Pin-Nummern — welcher Pin an
        // welchem Befehl hängt, legt die Firmware fest. Die Auswahl nennt deshalb
        // den Befehl samt üblicher RAMPS-Belegung (grbl-Mega-5X).
        selectRow(rl.body, 'Ausgang (Pin)',
          [['m7', 'M7 — Kühlmittel „Mist" (RAMPS D10)'],
           ['m8', 'M8 — Kühlmittel „Flood" (RAMPS D9)'],
           ['digital', 'M62/M63 P… — Digitalausgang nach Nummer'],
           ['custom', 'Eigene Befehle']],
          () => state.cfg.relayPin || 'm7',
          v => { state.cfg.relayPin = v; buildSidebar(); render(); renderBlock(); },
          'Welcher Ausgang der Steuerung geschaltet wird. Auf einem RAMPS 1.4 mit grbl-Mega-5X: '
          + 'M7 schaltet D10 („Mist"), M8 schaltet D9 („Flood"); M9 schaltet beide wieder aus — '
          + 'liegt also nur EIN Relais an einem der beiden Ausgänge, ist die Auswahl frei. '
          + '„M62/M63 P…" ist der nummerierte Digitalausgang von grblHAL, FluidNC und LinuxCNC: '
          + 'dort wird die Pin-Nummer direkt im G-Code mitgegeben (bahnsynchron geschaltet). '
          + '„Eigene Befehle" für alles andere.');
        if (state.cfg.relayPin === 'digital')
          numRow(rl.body, 'Ausgangsnummer (P)', () => state.cfg.relayP || 0,
            v => { state.cfg.relayP = v; render(); renderBlock(); }, { min: 0, int: true, norender: true,
              hint: 'Nummer des Digitalausgangs, wie sie die Firmware vergibt (grblHAL: die Reihenfolge der '
                + 'konfigurierten Auxiliary-Ausgänge, beginnend bei 0 — `$pins` listet sie auf).' });
        selectRow(rl.body, 'Wann schalten',
          [['wire', 'Mit der Heizung (auch um Pausen)'], ['program', 'Einmal: Programmanfang/-ende']],
          () => state.cfg.relayMode || 'wire', v => { state.cfg.relayMode = v; render(); renderBlock(); },
          '„Mit der Heizung": der Ausgang folgt jedem M3/M5 — bei jeder Pause (M0) ist der Draht dann '
          + 'wirklich stromlos, das Relais schaltet aber entsprechend oft. „Einmal": nur vor dem ersten '
          + 'M3 ein und nach dem letzten M5 aus — schont die Kontakte, der Draht bleibt in Pausen am Netz '
          + '(die Heizung selbst ist über M5 trotzdem aus).');
        if (state.cfg.relayPin === 'custom') {
          txtRow(rl.body, 'Befehl EIN', () => state.cfg.relayOn || 'M7',
            v => { state.cfg.relayOn = v; render(); renderBlock(); });
          txtRow(rl.body, 'Befehl AUS', () => state.cfg.relayOff || 'M9',
            v => { state.cfg.relayOff = v; render(); renderBlock(); });
        } else {
          const rc = App.relayCmds ? App.relayCmds(state.cfg) : { on: '', off: '' };
          numRow(rl.body, 'Befehl EIN', () => rc.on, () => {}, { readonly: true, roTitle: 'ergibt sich aus dem gewählten Ausgang' });
          numRow(rl.body, 'Befehl AUS', () => rc.off, () => {}, { readonly: true, roTitle: 'ergibt sich aus dem gewählten Ausgang' });
        }
        hint(rl.body, 'Das Pin-Mapping ist nicht genormt — vor dem Anklemmen in der Firmware nachsehen '
          + '(grbl-Mega-5X: cpu_map.h, Blöcke COOLANT_FLOOD_*/COOLANT_MIST_*; M7 braucht ENABLE_M7 in config.h). '
          + 'Die Kühlmittelausgänge sind wie alle RAMPS-MOSFETs Low-Side-Schalter: Freilaufdiode (z. B. 1N4004) '
          + 'antiparallel an die Relaisspule, sonst zerstört die Abschaltspitze den MOSFET. Der Befehl wirkt '
          + 'in allen G-Code-Quellen und in der Handsteuerung (Drahtheizung im Reiter „Schneiden").');
      }
      side.appendChild(rl.g);
      return;
    }
    if (part === 'grbl') {
      // Homing-Einstellungen ($22–$27, $44–$47) — Referenzfahrt. Direkt an die
      // Steuerung; die Felder baut das GRBL-Modul (kennt Verbindung + $$-Cache).
      // Alle GRBL-Menüs (Homing, $3, $$-Gruppen) liegen in EINEM zuklappbaren
      // Übermenü, damit die Seitenleiste im Reiter „Maschine" übersichtlich bleibt.
      const gb = grp('GRBL-Steuerung · Einstellungen ($$)', false, 'machine');
      hint(gb.body, 'Einstellungen direkt auf der Steuerung. Änderungen werden sofort gesendet '
        + 'und dort dauerhaft gespeichert ($$-EEPROM). Erfordert eine Verbindung.');
      side.appendChild(gb.g);
      const grblHost = gb.body;
      const hm = grp('Referenzfahrt / Homing', true, 'machine'); hm.g.classList.add('grp-sub');
      hint(hm.body, 'Konfiguration der Referenzfahrt ($H). Jede Änderung wird sofort an die '
        + 'Steuerung gesendet und dort dauerhaft gespeichert ($$-EEPROM). Erfordert eine Verbindung '
        + 'und eingebaute Endschalter.');
      const hmHost = document.createElement('div'); hmHost.className = 'hset';
      hm.body.appendChild(hmHost);
      if (window.GrblPanel && GrblPanel.renderHoming) GrblPanel.renderHoming(hmHost);
      grblHost.appendChild(hm.g);

      // Achsrichtungen invertieren ($3) — je Achse ein Häkchen, sofort ans Board.
      const iv = grp('Achsrichtungen invertieren · $3', true, 'machine'); iv.g.classList.add('grp-sub');
      hint(iv.body, 'Kehrt die Drehrichtung der jeweiligen Achse um (Richtungsport-Invert-Maske $3). '
        + 'Änderungen werden sofort an die Steuerung gesendet und dort dauerhaft gespeichert. Erfordert eine Verbindung.');
      const ivHost = document.createElement('div'); ivHost.className = 'hset-axes';
      iv.body.appendChild(ivHost);
      if (window.GrblPanel && GrblPanel.renderInvertAxes) GrblPanel.renderInvertAxes(ivHost);
      grblHost.appendChild(iv.g);

      // ---- Direkt-Editor für weitere GRBL-Settings ($$) ---------------
      // Jede Gruppe schreibt ihre Änderungen sofort in den EEPROM der Steuerung
      // ($n=Wert). Die Felder werden aus dem $$-Cache befüllt; „Aktuelle Werte
      // vom Board laden" holt sie neu, falls sich extern etwas geändert hat.
      const grblGroup = (title, id, hint0) => {
        const g = grp(title, false, 'machine'); g.g.classList.add('grp-sub');
        hint(g.body, hint0);
        const host = document.createElement('div'); host.className = 'hset';
        g.body.appendChild(host);
        if (window.GrblPanel && GrblPanel.renderSettingsGroup) GrblPanel.renderSettingsGroup(host, id);
        grblHost.appendChild(g.g);
      };
      grblGroup('Schrittsignale · $0/$1/$2/$4', 'stepper',
        'Zeitverhalten der Schrittimpulse und Polarität von Step- und Enable-Pins. Änderungen wirken sofort auf ALLE Achsen.');
      grblGroup('Achsparameter · Schritte/mm · $100…', 'stepsPerMm',
        'Kalibrierwert je Achse (Impulse pro Millimeter). Nach Umbau am Antrieb neu bestimmen.');
      grblGroup('Achsparameter · Max. Rate · $110…', 'maxRate',
        'Größtmögliche Fahrgeschwindigkeit je Achse. Begrenzt Eilgang UND Schnitt-Vorschub.');
      grblGroup('Achsparameter · Beschleunigung · $120…', 'accel',
        'Beschleunigung je Achse. Zu hoch = Schrittverlust.');
      grblGroup('Achsparameter · Max. Verfahrweg · $130…', 'maxTravel',
        'Nutzbarer Fahrweg je Achse (für Soft-Limits und Homing-Zyklen).');
      grblGroup('Motortreiber (TMC) · Strom · $140…', 'motorCurrent',
        'Nur bei Trinamic-Treibern (TMC): Motorstrom je Achse.');
      grblGroup('Motortreiber (TMC) · Microsteps · $150…', 'microsteps',
        'Nur bei Trinamic-Treibern (TMC): Microstep-Auflösung je Achse. Nach Änderung Schritte/mm neu kalibrieren.');
      grblGroup('Endschalter & Limits · $5/$6/$20/$21', 'limits',
        'Endschalter-/Probe-Polarität und Soft-/Hard-Limits.');
      grblGroup('Bericht & Einheiten · $10/$11/$12/$13', 'report',
        'Statusreport, Kurvenglättung und Anzeigeeinheit.');
      grblGroup('Drahtheizung (Spindel) · $30/$31/$32', 'wire',
        'S-Wert-Bereich für die Drahtheizung (M3 S…). Lasermodus ($32) beim Heißdraht AUS lassen.');

    }
  }

  // ---------- Verdrahtung (aus app.js wireUp) ----------
  function cutWireUp() {
    if (!window.GrblPanel || !window.Sim3D) return;
    Sim3D.mountMonitor('cSimM');         // gleicher Renderer im Reiter „Schneiden" (folgt Ausführung)
    // grblHAL-Pendant — Achsnamen und G-Code kommen aus der App. Die G-Code-
    // Quelle (Tragfläche/G-Code oder Blockzurichten) wählt der Reiter „Schneiden".
    GrblPanel.init({
      axisLetters: () => [state.cfg.axX, state.cfg.axY, state.cfg.axU, state.cfg.axV],
      limits: () => App.machineLimits(),
      // Liefert das im Reiter „Schneiden" gewählte Programm mit passender 3D-Szene.
      // Wird bei „Quelle übernehmen" ausgewertet und immer frisch erzeugt, damit
      // auch ohne vorherigen Besuch des Quell-Reiters G-Code vorliegt.
      program: () => {
        const src = document.getElementById('cutSource');
        if (src && src.value === 'block') {
          renderBlock();
          return {
            text: App.applyFeedMode((state.lastBlockGcode && state.lastBlockGcode.text) || ''),
            scene: buildBlockScene(), label: 'Block'
          };
        }
        if (src && src.value === 'guillotine') {
          const g = guillotineGcode();
          return { text: App.applyFeedMode(g.text), scene: buildGuillotineScene(), label: 'Guillotine' };
        }
        if (src && src.value === 'blockH') {
          const g = blockHGcode();
          return { text: App.applyFeedMode(g.text), scene: buildBlockHScene(), label: 'Block horizontal' };
        }
        if (src && src.value === 'calib') {
          const g = calibGcode();
          return { text: App.applyFeedMode(g.text), scene: buildCalibScene(), label: 'Abbrand-Kalibrierung' };
        }
        if (src && src.value === 'model') {
          const r = modelGcode();
          return { text: App.applyFeedMode((r && r.text) || ''), scene: (r && r.scene) || buildModelScene(null),
            label: r ? '3D-Modell Segment ' + (r.seg + 1) : '3D-Modell' };
        }
        if (src && src.value === 'plate') {
          const r = plateGcode();
          return { text: App.applyFeedMode((r && r.text) || ''), scene: (r && r.scene) || buildPlateScene(null),
            label: r ? T('3D-Modell Platte (') + r.pieces.length + ')' : T('3D-Modell Platte') };
        }
        // Quelle „G-Code (Kern/Negativschale)": NIE den 3D-Modell-Zustand des
        // G-Code-Reiters übernehmen (eigene Quelle „3D-Modell"). Steht dort gerade
        // 'model', mit der letzten Nicht-Modell-Quelle erzeugen und danach den
        // ursprünglichen Zustand wiederherstellen.
        const saved = state.cfg.gcodeSource;
        const eff = (saved === 'model') ? (state.cfg.gcodeSourceLast || 'core') : saved;
        state.cfg.gcodeSource = eff;
        render();
        const text = (state.lastGcode && state.lastGcode.text) || '';
        let scene, label;
        // Bezeichnung: Quelle · Tragfläche · Segment · Seite (gleiche Kennzeichnung wie im Simulator).
        label = App.cutContextLabel ? App.cutContextLabel(eff) : eff;
        if (eff === 'dxf') { scene = App.buildDxfScene ? App.buildDxfScene() : null; }
        else if (eff === 'schrift') { scene = App.buildSchriftScene ? App.buildSchriftScene() : null; }
        else if (eff === 'neg') { scene = buildNegScene(); }
        else { scene = buildScene(); }
        if (saved !== eff) { state.cfg.gcodeSource = saved; render(); }   // Zustand wiederherstellen
        return { text, scene, label };
      }
    });
    // Reiter „G-Code" → Knopf „✂ Schneiden": zum Reiter „Schneiden" wechseln und das
    // dort gerade aktive Programm (Quelle + Segment des G-Code-Reiters) als Quelle
    // übernehmen. 3D-Modell/Platte haben im Reiter „Schneiden" eigene Quellen, alles
    // andere (Kern/Negativschale/DXF) läuft über „G-Code".
    const toCut = document.getElementById('simToCut');
    if (toCut && document.getElementById('cutView')) {
      toCut.style.display = '';
      toCut.onclick = () => {
        const gs = state.cfg.gcodeSource;
        const want = (gs === 'model' || gs === 'plate') ? gs : 'gcode';
        const src = document.getElementById('cutSource');
        if (src && [...src.options].some(o => o.value === want)) src.value = want;
        App.switchView('cut');
        const btn = document.getElementById('mUseGcode'); if (btn) btn.click();
      };
    }
    // Blockzurichten: G-Code herunterladen / kopieren.
    const dlb = document.getElementById('btnDlBlock');
    if (dlb) dlb.onclick = () => {
      if (!state.lastBlockGcode) renderBlock();
      App.exportGcodeAxes('block-zurichten.gcode', () => App.applyFeedMode(state.lastBlockGcode.text));
    };
    const cpb = document.getElementById('btnCopyBlock');
    if (cpb) cpb.onclick = () => {
      if (App.demoSaveBlocked()) return;   // Kern-Demo: nichts herausgeben
      if (App.demoOn()) { App.toast(T('In der Demo lässt sich der G-Code nicht kopieren.')); return; }
      const t = document.getElementById('blockGcode'); if (t) navigator.clipboard.writeText(t.value).catch(() => {});
    };
  }

  Object.assign(App, { cutWireUp, refreshCutSource, renderBlock, drawBlock3D, setupBlock3D, sidebarMachine, bcam });
})();
