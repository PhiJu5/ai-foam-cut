/* dxfshapes.js — DXF-Formen, Schneidepfad-Punkteditor, Mini-CAD, DXF-Export  (@@split-module, ausgelagert aus app.js)
 * Namen aus früher geladenen Dateien werden unten aus window.App gebunden;
 * Namen aus app.js (lädt später) laufen als App.<name>. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, applyView, blockOrigin, cadEnsureLayer, cadLoadFromDxf, dashFor, negProjection, outsideFeed } = App;   // genOne/negGcode: App.* (gcodegen.js, abwählbar)
  const { renderCad, saveFilePicker, sparAppliesTo, sparFromLE, sparOnProfile, sparPolys, sparRange, sparYc, state, toast } = App;
  const { parseSvgToLayers, sampleSvgEl } = App;   // SVG-Parser liegt im Kern (dxf.js)
  // Demo-Build: Formen aufbereiten ja, DXF-Export nein.
  const DEMO = App.demoFeature('dxfshapes', 'Demo-Version: Der DXF-Export der DXF-Formen ist in dieser Ausgabe nicht enthalten.');
  // ---------- DXF-Formen ----------------------------------------------
  // Zwei importierte Turmprofile (INNEN/AUSSEN) werden mit manuell gesetzten
  // Synchronpaaren auf gleiche, synchron durchlaufene Punktfolgen gebracht und
  // über die bestehende Maschinen-/G-Code-Kette (HotWire.gcode) geschnitten.
  function dxfImport(text) {
    let parsed;
    try { parsed = Dxf.parse(text); } catch (e) { alert(T('DXF-Import fehlgeschlagen: ') + e.message); return; }
    applyParsedLayers(parsed);
  }
  function svgImport(text) {
    let parsed;
    try { parsed = parseSvgToLayers(text); } catch (e) { alert(T('SVG-Import fehlgeschlagen: ') + e.message); return; }
    applyParsedLayers(parsed);
  }
  // Geparste {layers, order}-Struktur (aus DXF ODER SVG) übernehmen, Layer
  // automatisch INNEN/AUSSEN zuordnen und die Ansicht öffnen.
  // Layer aus dem 3D-Modell erkennen (Name „Segment 2 Soll A [S1 X1250.00 d420.00,0.00]",
  // siehe m3dSecTag in cad.js). Rückgabe {seg, kind, side, sec, axis, pos, dx, dy} oder null.
  function m3dParseLayer(name) {
    const m = /Segment\s+(\d+)\s+(Soll|Schnitt)\s+([AB])\s+\[S(\d+)\s+([XYZ])(-?\d+(?:\.\d+)?)(?:\s+d(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?))?\]/.exec(name || '');
    if (!m) return null;
    return { seg: +m[1] - 1, kind: m[2], side: m[3], sec: +m[4], axis: m[5], pos: +m[6], dx: m[7] != null ? +m[7] : 0, dy: m[8] != null ? +m[8] : 0 };
  }
  // Querschnitte aus dem 3D-Modell → fertige Rippenkette (je Segment Profil A/B),
  // lagerichtig: Layout-Versatz wird über rib.off zurückgenommen, Segmentbreite =
  // Ebenenabstand. Sollkonturen haben Vorrang vor Schnittspuren. Rückgabe true, wenn übernommen.
  function m3dApplyAsChain(parsed) {
    const ents = [];
    parsed.order.forEach(n => { const i = m3dParseLayer(n); if (i && parsed.layers[n] && parsed.layers[n].length) { i.layer = n; ents.push(i); } });
    if (!ents.length) return false;
    const kind = ents.some(e => e.kind === 'Soll') ? 'Soll' : 'Schnitt';
    const E = ents.filter(e => e.kind === kind);
    const segIds = [...new Set(E.map(e => e.seg))].sort((a, b) => a - b);
    const pick = (seg, side, sec) => E.find(e => e.seg === seg && e.side === side) || E.find(e => e.sec === sec);
    const ribs = [], segs = [];
    segIds.forEach(k => {
      const a = pick(k, 'A', k), b = pick(k, 'B', k + 1);
      if (!a || !b || a.sec === b.sec) return;
      ribs.push({ layer: a.layer, off: { x: -a.dx, y: -a.dy } }, { layer: b.layer, off: { x: -b.dx, y: -b.dy } });
      segs.push({ span: Math.max(0.1, Math.abs(b.pos - a.pos)) });
    });
    if (segs.length < 1) return false;
    const n = segs.length;
    if (!confirm(T('Die Konturen stammen aus dem 3D-Modell. Als ') + n + T(' Segment(e) mit Profil A/B lagerichtig übernehmen (Segmentbreite = Ebenenabstand)?\n\nAbbrechen = als lose Layer übernehmen.'))) return false;
    dxfApplyRibChain({ file: '3D-Modell', layers: parsed.layers, order: parsed.order, ribs, pairs: true, segs });
    return true;
  }
  function applyParsedLayers(parsed) {
    if (m3dApplyAsChain(parsed)) return;
    const d = state.dxf;
    d.layers = parsed.layers; d.order = parsed.order;
    d.sync = []; d.start = 0; d.pick = null;
    d.pathEdit = null; d.pEdit.on = false; d.pEdit.drag = null; d.pEdit.undo.length = 0; d.pEdit.redo.length = 0;
    // Neue Datei: Rippenkette zurücksetzen — ensureModel baut aus INNEN/AUSSEN neu auf.
    d.ribs = null; d.segs = null; d.activeSeg = 0; d.innerOff = { x: 0, y: 0 }; d.outerOff = { x: 0, y: 0 };
    // Layer automatisch zuordnen (Name enthält INNEN/AUSSEN, sonst erste zwei mit Geometrie).
    // Hilfslayer (nur Anzeige, nie Schneidpfad): Name enthält HILF/HELP/AUX/REF — später in der
    // Seitenleiste frei umschaltbar.
    d.helpLayers = {}; d.order.forEach(n => { if (/hilf|help|aux|ref/i.test(n)) d.helpLayers[n] = true; });
    const find = re => d.order.find(name => re.test(name) && !d.helpLayers[name]);
    d.innerName = find(/inn|inner/i) || null;
    d.outerName = find(/aus|auß|outer/i) || null;
    const withGeom = d.order.filter(n => d.layers[n] && d.layers[n].length && !d.helpLayers[n]);
    if (!d.innerName) d.innerName = withGeom[0] || null;
    if (!d.outerName) d.outerName = withGeom.find(n => n !== d.innerName) || null;
    // Nur EIN Layer mit Geometrie? Dann denselben Layer auch für AUSSEN nehmen —
    // INNEN und AUSSEN dürfen dieselbe Kontur sein (z. B. gerader/prismatischer
    // Schnitt, Wurzel = Rand). So entsteht sofort ein gültiges Segment.
    if (!d.outerName && d.innerName) d.outerName = d.innerName;
    dxfResolve();
    App.buildSidebar();
    App.switchView('dxf');
  }
  // Fertige Rippenkette von außen übernehmen (z. B. GMFC-Projekt, gmfc.js):
  // model = { file, layers:{name:[loop]}, order:[name], ribs:[{layer, off:{x,y}}],
  //           segs:[{span, sync, start, dir, density, densMode, block:{heightY,lenX}}] }.
  // Ersetzt den kompletten Inhalt des Reiters „DXF-Formen" und öffnet ihn.
  function dxfApplyRibChain(model) {
    const d = state.dxf;
    if (!model || !model.layers || !Array.isArray(model.ribs) || model.ribs.length < 2) throw new Error(T('Rippenkette unvollständig (mindestens zwei Querschnitte nötig).'));
    d.layers = model.layers; d.order = (model.order || Object.keys(model.layers)).slice();
    d.helpLayers = {};
    d.sync = []; d.start = 0; d.pick = null;
    d.pathEdit = null; d.pEdit.on = false; d.pEdit.drag = null; d.pEdit.undo.length = 0; d.pEdit.redo.length = 0;
    if (d.undo) d.undo.length = 0; if (d.redo) d.redo.length = 0;
    d.ribs = model.ribs.map(r => ({ layer: r.layer, off: { x: +(r.off && r.off.x) || 0, y: +(r.off && r.off.y) || 0 } }));
    // model.pairs: ribs = je Segment zwei eigene Profile; sonst alte Kette (wird migriert).
    d.ribModel = model.pairs ? 2 : 1;
    d.segs = (model.segs || []).map(s => dxfNewSeg(s));
    d.activeSeg = 0;
    if (model.file) d.file = model.file;
    dxfEnsureModel(); dxfLoadActive(); dxfResolve();
    App.buildSidebar();
    App.switchView('dxf');
  }
  // Eine SEPARATE DXF gezielt als INNEN- oder AUSSEN-Kontur laden. Aus der Datei
  // wird die größte Schleife (über alle Layer) genommen und unter einem festen
  // Layernamen (INNEN/AUSSEN) abgelegt — so lassen sich zwei getrennte DXF laden
  // und über die Verschiebung (X/Y) zueinander ausrichten.
  function loadDxfRole(role) {
    App.loadVia({ 'application/dxf': ['.dxf'] }, t => {
      let parsed;
      try { parsed = Dxf.parse(t); } catch (e) { alert(T('DXF-Import fehlgeschlagen: ') + e.message); return; }
      applyParsedRole(parsed, role, 'Keine geeignete Kontur in der DXF gefunden.');
    }, 'fileDxf', 'ldDxf');
  }
  function loadSvgRole(role) {
    App.loadVia({ 'image/svg+xml': ['.svg'] }, t => {
      let parsed;
      try { parsed = parseSvgToLayers(t); } catch (e) { alert(T('SVG-Import fehlgeschlagen: ') + e.message); return; }
      applyParsedRole(parsed, role, 'Keine geeignete Kontur in der SVG gefunden.');
    }, 'fileSvg', 'ldSvg');
  }
  // Aus einer geparsten Datei die größte Kontur als INNEN/AUSSEN übernehmen.
  function applyParsedRole(parsed, role, noneMsg) {
    const d = state.dxf;
    if (!d.layers) { d.layers = {}; d.order = []; }
    // Größte Kontur der Datei bestimmen (über alle ihre Layer).
    let best = null, bestP = -1;
    parsed.order.forEach(n => {
      const loops = parsed.layers[n]; if (!loops || !loops.length) return;
      const lp = Dxf.pickLoop(loops); if (!lp) return;
      const p = Dxf.perimeter(lp, lp.closed);
      if (p > bestP) { bestP = p; best = loops; }
    });
    if (!best) { alert(T(noneMsg || 'Keine geeignete Kontur gefunden.')); return; }
    dxfEnsureModel();
    // Eindeutigen Layernamen vergeben (mehrere Segmente collidieren sonst).
    const base = role === 'inner' ? 'INNEN' : 'AUSSEN';
    let key = base, n = 2; while (d.layers[key] && d.layers[key] !== best) key = base + ' ' + (n++);
    d.layers[key] = best;
    if (d.order.indexOf(key) < 0) d.order.push(key);
    // Rolle bezieht sich auf das AKTIVE Segment: inner = Rippe 2k, outer = Rippe 2k+1.
    // Ein eigenes INNEN-Profil löst die Übernahme vom Vorsegment.
    if (role === 'inner') dxfUnlinkPrev(d.activeSeg);
    const ribIdx = 2 * d.activeSeg + (role === 'inner' ? 0 : 1);
    while (d.ribs.length <= ribIdx) d.ribs.push({ layer: key, off: { x: 0, y: 0 } });
    d.ribs[ribIdx].layer = key; d.ribs[ribIdx].off = { x: 0, y: 0 };
    dxfEnsureModel();
    // Sync-Paare können nach Geometriewechsel ungültig sein — dxfResolve filtert.
    d.pick = null; d.pathEdit = null; d.pEdit.on = false; d.pEdit.drag = null;
    if (d.segs[d.activeSeg]) d.segs[d.activeSeg].pathEdit = null;
    state.dxf.file = 'DXF';
    dxfLoadActive();
    dxfResolve();
    App.buildSidebar();
    App.switchView('dxf');
  }
  // ---- SVG-Import: Formen (path/polyline/polygon/line/rect/circle/ellipse) in
  // Punktzüge zerlegen und wie DXF-Layer bereitstellen ({layers, order}). Jede
  // Form wird ein eigener „Layer" (Name aus id/label/Tag). SVG-y zeigt nach
  // unten -> y wird invertiert, damit die Lage zu DXF/CAD passt.
  // ---- Rippenkette (mehrere Segmente) --------------------------------
  // Vorlage für ein Segment-Snapshot (Daten des Rippenpaars k..k+1).
  function dxfNewSeg(src) {
    const s = { sync: [], start: 0, dir: 1, density: 240, densMode: 'total', perMM: 1,
      span: 300, kerf: true, safeLead: true, pathEdit: null,
      block: { lenX: 0, heightY: 0, ovF: 20, ovR: 20, margin: 10 } };
    if (src) { Object.keys(src).forEach(k => { if (k !== 'block') s[k] = src[k]; }); if (src.block) Object.assign(s.block, src.block); }
    return s;
  }
  // ---- Modell (seit 2026-09-18): JEDES Segment hat ZWEI eigene Profile ----------
  // d.ribs = [INNEN 1, AUSSEN 1, INNEN 2, AUSSEN 2, …] (d.ribModel === 2), Segment k
  // nutzt ribs[2k] und ribs[2k+1]. Anders als bei der Tragfläche wird das Profil des
  // Vorsegments NICHT automatisch übernommen — nur als Option je Segment
  // (seg.linkPrev): dann ist ribs[2k] DASSELBE Objekt wie ribs[2k-1] (Layer und
  // Verschiebung gemeinsam). Nach JSON (Projekt laden) stellt ensureModel das wieder her.
  const dxfRibClone = r => ({ layer: r ? r.layer : null, off: { x: +(r && r.off && r.off.x) || 0, y: +(r && r.off && r.off.y) || 0 } });
  function dxfSegCount() { const r = state.dxf.ribs; return Math.max(1, Array.isArray(r) ? Math.floor(r.length / 2) : 1); }
  // Alte Rippenkette (n+1 Rippen, Segment k = Rippe k..k+1) → Paarliste. Die alte
  // Kette teilte jede Zwischenrippe: das bleibt als linkPrev erhalten. Stoß-Segmente
  // (joint, GMFC-Import vom 2026-09-17) entfallen — ihr Nachfolger bekommt die eigene Wurzel.
  function dxfMigratePairs() {
    const d = state.dxf, old = d.ribs || [], so = Array.isArray(d.segs) ? d.segs : [];
    d.ribModel = 2;
    if (old.length < 2) return;
    const nr = [], ns = []; let act = -1, prevKept = false;
    for (let k = 0; k + 1 < old.length; k++) {
      const sg = so[k] || dxfNewSeg();
      if (sg.joint) { prevKept = false; continue; }
      const linked = prevKept && nr.length > 0;
      nr.push(linked ? nr[nr.length - 1] : dxfRibClone(old[k])); nr.push(dxfRibClone(old[k + 1]));
      sg.linkPrev = linked; delete sg.joint;
      if (k === d.activeSeg) act = ns.length;
      ns.push(sg); prevKept = true;
    }
    d.ribs = nr; d.segs = ns;
    if (act < 0) { d.activeSeg = 0; dxfLoadActive(); } else d.activeSeg = act;
  }
  // Sorgt für ein gültiges Segment-Modell und migriert Altstände (Einzelpaar, Kette).
  function dxfEnsureModel() {
    const d = state.dxf;
    if (!Array.isArray(d.ribs)) {
      d.ribs = [];
      if (d.innerName) d.ribs.push({ layer: d.innerName, off: d.innerOff || { x: 0, y: 0 } });
      if (d.outerName) d.ribs.push({ layer: d.outerName, off: d.outerOff || { x: 0, y: 0 } });
      d.segs = [dxfNewSeg({ sync: d.sync || [], start: d.start, dir: d.dir, density: d.density,
        densMode: d.densMode, perMM: d.perMM, span: d.span, kerf: d.kerf, safeLead: d.safeLead,
        pathEdit: d.pathEdit,
        block: { lenX: d.blockLenX || 0, heightY: d.blockHeightY || 0, ovF: d.blockOvF, ovR: d.blockOvR, margin: d.blockMargin } })];
      d.activeSeg = 0; d.ribModel = 2;
    }
    if (d.ribModel !== 2) dxfMigratePairs();
    if (d.ribs.length > 2 && d.ribs.length % 2) d.ribs.push(dxfRibClone(d.ribs[d.ribs.length - 1]));
    d.ribs.forEach(r => { if (!r.off) r.off = { x: 0, y: 0 }; });
    if (!Array.isArray(d.segs)) d.segs = [];
    const need = Math.floor(d.ribs.length / 2);
    while (d.segs.length < need) d.segs.push(dxfNewSeg({ span: (d.segs[d.segs.length - 1] || {}).span || 300 }));
    if (d.segs.length > need) d.segs.length = need;
    // Option „INNEN vom Vorsegment": gemeinsames Rippenobjekt (wieder) herstellen.
    if (d.segs[0]) d.segs[0].linkPrev = false;
    for (let k = 1; k < need; k++) if (d.segs[k].linkPrev) d.ribs[2 * k] = d.ribs[2 * k - 1];
    if (d.activeSeg == null || d.activeSeg >= Math.max(1, need)) d.activeSeg = Math.max(0, need - 1);
  }
  // Übernahme vom Vorsegment lösen: Segment k bekommt eine eigene Kopie als INNEN.
  function dxfUnlinkPrev(k) {
    const d = state.dxf, sg = d.segs && d.segs[k]; if (!sg || !sg.linkPrev) return;
    sg.linkPrev = false; d.ribs[2 * k] = dxfRibClone(d.ribs[2 * k]);
  }
  // Option je Segment: INNEN = AUSSEN des Vorsegments (an) bzw. eigenes Profil (aus).
  function dxfSetLinkPrev(k, on) {
    const d = state.dxf; dxfEnsureModel(); dxfStashActive();
    const sg = d.segs[k]; if (!sg || k < 1) return;
    if (on) { sg.linkPrev = true; d.ribs[2 * k] = d.ribs[2 * k - 1]; sg.pathEdit = null; if (k === d.activeSeg) d.pathEdit = null; }
    else dxfUnlinkPrev(k);
    dxfLoadActive(); dxfResolve(); App.buildSidebar(); renderDxf(); App.render();
  }
  // Flachfelder (aktives Segment) in den Snapshot zurückschreiben.
  function dxfStashActive() {
    const d = state.dxf; const s = d.segs && d.segs[d.activeSeg]; if (!s) return;
    ['start', 'dir', 'density', 'densMode', 'perMM', 'span', 'kerf', 'safeLead', 'pathEdit'].forEach(k => s[k] = d[k]);
    s.sync = d.sync;
    s.block = { lenX: d.blockLenX || 0, heightY: d.blockHeightY || 0, ovF: d.blockOvF, ovR: d.blockOvR, margin: d.blockMargin };
  }
  // Snapshot des aktiven Segments in die Flachfelder laden (Aliasse setzen).
  function dxfLoadActive() {
    const d = state.dxf; const k = d.activeSeg; const s = d.segs && d.segs[k];
    const ri = d.ribs && d.ribs[2 * k], ro = d.ribs && d.ribs[2 * k + 1];
    d.innerName = ri ? ri.layer : null; d.outerName = ro ? ro.layer : null;
    d.innerOff = ri ? ri.off : { x: 0, y: 0 }; d.outerOff = ro ? ro.off : { x: 0, y: 0 };
    if (!s) return;
    ['start', 'dir', 'density', 'densMode', 'perMM', 'span', 'kerf', 'safeLead', 'pathEdit'].forEach(k2 => d[k2] = s[k2]);
    d.sync = s.sync || (s.sync = []);
    const b = s.block || (s.block = { lenX: 0, heightY: 0, ovF: 20, ovR: 20, margin: 10 });
    d.blockLenX = b.lenX || 0; d.blockHeightY = b.heightY || 0;
    d.blockOvF = b.ovF; d.blockOvR = b.ovR; d.blockMargin = b.margin;
  }
  // Aktives Segment wechseln (stash → laden → auflösen).
  function dxfSetActive(k) {
    const d = state.dxf; dxfStashActive();
    d.activeSeg = Math.max(0, Math.min(k, dxfSegCount() - 1));
    dxfLoadActive(); dxfResolve();
    // Sync-Editor/Auswahl auf das neue Segment beziehen.
    d.pick = null;
  }
  // Segment anhängen: zwei EIGENE Profile (Startbelegung = Layer des letzten AUSSEN-
  // Profils, ohne Kopplung ans Vorsegment — die gibt es nur als Option).
  function dxfAddSeg() {
    const d = state.dxf; dxfEnsureModel(); dxfStashActive();
    const last = d.ribs[d.ribs.length - 1] || { layer: d.innerName, off: { x: 0, y: 0 } };
    if (d.ribs.length < 2) d.ribs.push(dxfRibClone(last));
    else { d.ribs.push(dxfRibClone(last)); d.ribs.push(dxfRibClone(last)); }
    dxfEnsureModel();
    d.activeSeg = dxfSegCount() - 1;   // das neu entstandene Segment
    dxfLoadActive(); dxfResolve(); App.buildSidebar(); renderDxf(); App.render();
  }
  // Segment k entfernen (samt seiner beiden Profile). Mindestens ein Segment bleibt.
  // Ein Nachfolger, der sein INNEN von hier übernommen hat, behält es als eigenes Profil.
  function dxfDelSeg(k) {
    const d = state.dxf; dxfEnsureModel();
    if (d.segs.length <= 1 || !d.segs[k]) return;
    dxfStashActive();
    if (d.segs[k + 1]) dxfUnlinkPrev(k + 1);
    d.ribs.splice(2 * k, 2);
    d.segs.splice(k, 1);
    dxfEnsureModel();
    d.activeSeg = Math.max(0, Math.min(k, d.segs.length - 1));
    dxfLoadActive(); dxfResolve(); App.buildSidebar(); renderDxf(); App.render();
  }
  // Aus den gewählten Layern je EINE Kontur (größter Umfang) als inner/outer.
  function dxfResolve() {
    const d = state.dxf;
    dxfEnsureModel();
    const io = d.innerOff || (d.innerOff = { x: 0, y: 0 });
    const oo = d.outerOff || (d.outerOff = { x: 0, y: 0 });
    // Kontur kopieren und um (off.x, off.y) verschieben — ohne die gespeicherten
    // Layer-Rohdaten zu verändern (mehrere Aufrufe bleiben stabil).
    const shift = (loop, off) => { if (!loop) return null; const a = loop.map(p => ({ x: p.x + off.x, y: p.y + off.y })); a.closed = loop.closed; a.name = loop.name; return a; };
    d.inner = d.innerName && d.layers && d.layers[d.innerName] ? shift(Dxf.pickLoop(d.layers[d.innerName]), io) : null;
    d.outer = d.outerName && d.layers && d.layers[d.outerName] ? shift(Dxf.pickLoop(d.layers[d.outerName]), oo) : null;
    // Sync-Indizes prüfen (könnten nach Layerwechsel ungültig sein).
    let f = [];
    if (d.inner && d.outer) f = (d.sync || []).filter(s => s.i < d.inner.length && s.j < d.outer.length);
    d.sync = f;
    if (d.segs && d.segs[d.activeSeg]) d.segs[d.activeSeg].sync = f;
  }
  // Synchronisierte Bahnen (gleich lang) aus inner/outer + Sync-Paaren — ohne
  // Berücksichtigung eines eingefrorenen Schneidepfad-Overrides.
  // INNEN und AUSSEN stammen aus DEMSELBEN Layer (identischer Querschnitt,
  // Wurzel = Rand, z. B. gerader/prismatischer Schnitt). Dann ist die Zuordnung
  // trivial (Index i = Index j) und es sind KEINE Synchronpaare nötig.
  function dxfSameSection() {
    const d = state.dxf;
    return !!(d.innerName && d.outerName && d.innerName === d.outerName
      && d.inner && d.outer && d.inner.length === d.outer.length && d.inner.length > 2);
  }
  function dxfSyncedRaw() {
    const d = state.dxf;
    if (!d.inner || !d.outer) return null;
    // Bei gleichem Querschnitt ein synthetisches Startpaar {0,0} verwenden, damit
    // ohne manuelles Setzen von Synchronpunkten sofort eine Bahn (und G-Code) entsteht.
    const same = dxfSameSection();
    if (d.sync.length < 1 && !same) return null;
    const pairs = (d.sync.length >= 1) ? d.sync : [{ i: 0, j: 0 }];
    const start = (d.sync.length >= 1) ? d.start : 0;
    const opt = d.densMode === 'permm' ? { perMM: Math.max(0.01, d.perMM || 1) } : {};
    return Dxf.buildSync(d.inner, d.outer, pairs, start, d.dir, Math.max(8, d.density | 0), opt);
  }
  // Synchronisierte Bahnen für Anzeige/G-Code. Ein per „Schneidepfad bearbeiten"
  // eingefrorener Override hat Vorrang (Punktverteilung/Sync ändern ihn dann nicht
  // mehr, bis zurückgesetzt) — analog zum Schneidepfad-Editor im Kerndesign.
  function dxfSynced() {
    const d = state.dxf;
    if (d.pathEdit && d.pathEdit.inner && d.pathEdit.inner.length > 1)
      return { inner: d.pathEdit.inner.map(p => ({ x: p.x, y: p.y })),
               outer: d.pathEdit.outer.map(p => ({ x: p.x, y: p.y })) };
    return dxfSyncedRaw();
  }
  // kerf-Berechnungsmethode (steht jetzt im jeweiligen Design statt bei Werkstoff).
  function buildDxfSidebar(side) {
    const d = state.dxf;
    const g = App.grp('DXF-/SVG-Import', true, 'dxf', { alwaysOpen: true });
    const irow = document.createElement('div');
    irow.style.display = 'flex'; irow.style.gap = '6px';
    const bi = document.createElement('button'); bi.className = 'primary';
    bi.textContent = T('DXF laden…');
    bi.onclick = () => App.loadVia({ 'application/dxf': ['.dxf'] }, t => { state.dxf.file = 'DXF'; dxfImport(t); }, 'fileDxf', 'ldDxf');
    const bsv = document.createElement('button'); bsv.className = 'primary';
    bsv.textContent = T('SVG laden…');
    bsv.onclick = () => App.loadVia({ 'image/svg+xml': ['.svg'] }, t => { state.dxf.file = 'SVG'; svgImport(t); }, 'fileSvg', 'ldSvg');
    bi.style.flex = bsv.style.flex = '1 1 0'; bi.style.minWidth = bsv.style.minWidth = '0';
    irow.appendChild(bi); irow.appendChild(bsv);
    g.body.appendChild(irow);
    // GMFC-Projekt (Feature „gmfc", nur wenn gmfc.js geladen ist): Querschnitte + Segmente als Rippenkette.
    if (typeof App.gmfcImportDxf === 'function') {
      const bg = document.createElement('button'); bg.textContent = T('GMFC-Projekt (.cnc) laden…');
      bg.title = T('GMFC-Projektdatei (.cnc) mit importierten, in GMFC synchronisierten Querschnitten und mehreren Segmenten als Rippenkette übernehmen (Sehne, Pfeilung, Grundhöhe, Spannweite, Blockhöhe und die Punktzuordnung aus GMFC).');
      bg.onclick = () => App.gmfcImportDxf();
      g.body.appendChild(bg);
    }
    // Hinweis direkt zu den kombinierten Import-Schaltflächen darüber.
    App.hint(g.body, 'Lädt DXF/SVG mit EINEM Layer (Single-Layer) ODER mit ZWEI ODER MEHR Layern '
      + '(Multi-Layer, je Layer ein Profil). Bei mehreren Layern lassen sich diese nach dem Laden über '
      + 'die Auswahlfelder INNEN/AUSSEN zuordnen bzw. den Segmenten zuweisen. Einzelne Profile je Segment '
      + 'lädst du direkt beim Segment (.dat/DXF/SVG). Bögen/Kreise/Splines/SVG-Pfade werden in Punkte zerlegt.');
    App.hint(g.body, 'Zwei GETRENNTE Dateien (DXF oder SVG): eine als INNEN (linke Ebene), eine als AUSSEN '
      + '(rechte Ebene). Je Datei wird die größte Kontur übernommen; mit der Verschiebung X/Y unten '
      + 'richtest du beide zueinander aus.');
    if (!d.layers) {
      const bn = document.createElement('button');
      bn.textContent = T('✎ Frei zeichnen (CAD-Reiter)');
      bn.onclick = dxfNewBlank;
      g.body.appendChild(bn);
      App.hint(g.body, 'Öffnet den Reiter „CAD-Bearbeitung" mit einer leeren Zeichnung, '
        + 'um frei Geometrie zu zeichnen und als DXF zu exportieren.');
      side.appendChild(g.g);
      return;
    }
    // Rippe der aktiven Kette aus eigener Datei laden (deckt „jeweils ein neues DXF").
    App.hint(g.body, 'Rippe aus EIGENER Datei laden: die größte Kontur der Datei wird der Wurzel- '
      + 'bzw. Randrippe des AKTIVEN Segments zugewiesen. So lässt sich je Rippe eine separate '
      + 'DXF/SVG verwenden und über die Verschiebung X/Y ausrichten.');
    side.appendChild(g.g);

    // --- Segmente (je zwei eigene Profile) ----------------------------
    dxfEnsureModel();
    const nSeg = dxfSegCount();
    const sgg = App.grp(T('Segmente') + ' (' + nSeg + ')', true, 'dxf', { key: 'Segmente-DXF' });
    App.hint(sgg.body, 'Jedes Segment besteht aus zwei eigenen Profilen (INNEN und AUSSEN). Anders als bei der '
      + 'Tragfläche wird das Profil des Vorsegments nicht automatisch übernommen — das ist je Segment als Option wählbar. '
      + 'Segment auswählen, dann darunter die Layer/Konturen und Synchronpunkte einstellen. Segmentbreite und Blockmaße stehen direkt beim jeweiligen Segment.');
    // Alle Segmente gemeinsam um die waagrechte Achse drehen.
    {
      const rr = document.createElement('div'); rr.className = 'mrow'; rr.style.cssText = 'gap:4px;align-items:center;flex-wrap:wrap;margin-bottom:6px';
      const rl = document.createElement('span'); rl.textContent = T('Alle drehen'); rl.style.cssText = 'font-size:12px;color:var(--muted);margin-right:2px'; rr.appendChild(rl);
      [90, 180, -90].forEach(a => { const b = App.mkMini((a > 0 ? '+' : '') + a + '°', () => dxfRotateAll(a)); b.title = T('Alle Segmente um') + ' ' + a + '° ' + T('drehen'); rr.appendChild(b); });
      const ra = document.createElement('input'); ra.type = 'number'; ra.step = '1'; ra.value = d.rotFreeAll != null ? d.rotFreeAll : 45; ra.title = T('Freier Winkel (°), positiv = gegen den Uhrzeigersinn');
      ra.style.cssText = 'width:58px'; ra.onchange = () => { d.rotFreeAll = +ra.value || 0; };
      const rb = App.mkMini('↻', () => dxfRotateAll(+ra.value || 0)); rb.title = T('Um den eingegebenen Winkel drehen');
      rr.appendChild(ra); rr.appendChild(rb);
      sgg.body.appendChild(rr);
      App.hint(sgg.body, 'Dreht alle Rippenkonturen gemeinsam um einen gemeinsamen Mittelpunkt — die Lage der Rippen zueinander bleibt erhalten (Rückgängig: Strg+Z).');
    }
    for (let k = 0; k < nSeg; k++) (kk => {
      const rowEl = document.createElement('div'); rowEl.className = 'mrow';
      rowEl.style.cssText = 'gap:6px;align-items:center;padding:4px 6px;border:1px solid var(--line);border-radius:6px;margin-bottom:4px;cursor:pointer';
      if (kk === d.activeSeg) { rowEl.style.borderColor = 'var(--accent)'; rowEl.style.background = 'rgba(74,163,255,.10)'; }
      const lbl = document.createElement('span'); lbl.style.flex = '1';
      const ri = d.ribs[2 * kk], ro = d.ribs[2 * kk + 1];
      lbl.textContent = T('Segment ') + (kk + 1) + '  ·  ' + ((d.segs[kk] && d.segs[kk].linkPrev) ? '⇠ ' : '') + (ri ? ri.layer : '—') + ' → ' + (ro ? ro.layer : '—');
      rowEl.appendChild(lbl);
      rowEl.onclick = () => { dxfSetActive(kk); App.buildSidebar(); renderDxf(); App.render(); };
      if (nSeg > 1) {
        const del = App.mkMini('✕', ev => { if (ev) ev.stopPropagation(); dxfDelSeg(kk); }); del.style.color = 'var(--bad)';
        del.title = T('Segment entfernen'); rowEl.appendChild(del);
      }
      sgg.body.appendChild(rowEl);
      // Blockgeometrie direkt beim Segment: aktives Segment mit Eingabefeldern,
      // die übrigen kompakt als Kurzinfo (Breite · X · Y) — Klick auf die Zeile wechselt.
      const sg = d.segs && d.segs[kk];
      const isAct = kk === d.activeSeg;
      const blk = isAct ? null : (sg && (sg.block || (sg.block = { lenX: 0, heightY: 0, ovF: 20, ovR: 20, margin: 10 })));
      const getSpan = () => isAct ? d.span : (sg ? sg.span : 0);
      const setSpan = v => { if (isAct) d.span = v; else if (sg) sg.span = v; App.render(); };
      const getLX = () => isAct ? (d.blockLenX || 0) : (blk ? blk.lenX || 0 : 0);
      const setLX = v => { v = Math.max(0, v); if (isAct) d.blockLenX = v; else if (blk) blk.lenX = v; renderDxf(); App.render(); };
      const getHY = () => isAct ? (d.blockHeightY || 0) : (blk ? blk.heightY || 0 : 0);
      const setHY = v => { v = Math.max(0, v); if (isAct) d.blockHeightY = v; else if (blk) blk.heightY = v; renderDxf(); App.render(); };
      const getMg = () => isAct ? (d.blockMargin || 0) : (blk ? blk.margin || 0 : 0);
      const setMg = v => { v = Math.max(0, v); if (isAct) d.blockMargin = v; else if (blk) blk.margin = v; renderDxf(); };
      const box = document.createElement('div');
      box.style.cssText = 'margin:-2px 0 6px 10px;padding:4px 6px 2px;border-left:2px solid ' + (isAct ? 'var(--accent)' : 'var(--line)');
      if (isAct) {
        const cap = document.createElement('div'); cap.style.cssText = 'font-size:11px;color:var(--muted);margin-bottom:2px';
        cap.textContent = T('Blockgeometrie · Segment ') + (kk + 1);
        box.appendChild(cap);
        // Segment um die waagrechte Achse drehen (feste Winkel + freier Winkel).
        const rr = document.createElement('div'); rr.className = 'mrow'; rr.style.cssText = 'gap:4px;align-items:center;flex-wrap:wrap;margin-bottom:4px';
        const rl = document.createElement('span'); rl.textContent = T('Drehen'); rl.style.cssText = 'font-size:12px;color:var(--muted);margin-right:2px'; rr.appendChild(rl);
        [90, 180, -90].forEach(a => { const b = App.mkMini((a > 0 ? '+' : '') + a + '°', () => dxfRotateSeg(kk, a)); b.title = T('Segment um') + ' ' + a + '° ' + T('drehen'); rr.appendChild(b); });
        const ra = document.createElement('input'); ra.type = 'number'; ra.step = '1'; ra.value = d.rotFree != null ? d.rotFree : 45; ra.title = T('Freier Winkel (°), positiv = gegen den Uhrzeigersinn');
        ra.style.cssText = 'width:58px'; ra.onchange = () => { d.rotFree = +ra.value || 0; };
        const rb = App.mkMini('↻', () => dxfRotateSeg(kk, +ra.value || 0)); rb.title = T('Um den eingegebenen Winkel drehen');
        rr.appendChild(ra); rr.appendChild(rb);
        box.appendChild(rr);
        App.hint(box, 'Dreht beide Rippenkonturen des Segments in der Schnittebene um ihren Mittelpunkt (Rückgängig: Strg+Z). '
          + 'Die Drehung gilt nur für dieses Segment: ein Layer, den auch andere Segmente nutzen, wird dafür kopiert.');
        App.numRow(box, 'Segmentbreite (mm)', getSpan, setSpan,
          { min: 1, norender: true, hint: 'Breite des Segments = Abstand der INNEN- zur AUSSEN-Ebene (Z). '
            + 'Der Turmabstand (Maschinenbreite) wird im Bereich „G-Code"/„Maschine" eingegeben; '
            + 'Seite und Abstand zum Portal gelten wie im Tragflächendesigner.' });
        App.numRow(box, 'Blocklänge X (mm, 0 = auto)', getLX, setLX,
          { step: 1, min: 0, norender: true, hint: 'Feste Blocklänge in Schnittrichtung (X). 0 = automatisch aus '
            + 'Geometrie + Zugaben vorne/hinten. Wirkt auf das gezeigte Rohmaß UND die 3D-Simulation; der '
            + 'Schneidepfad selbst bleibt unverändert.' });
        App.numRow(box, 'Blockhöhe Y (mm, 0 = auto)', getHY, setHY,
          { step: 1, min: 0, norender: true, hint: 'Feste Blockhöhe (Y). 0 = automatisch aus Geometrie + Rand '
            + 'oben/unten. Wirkt auf Rohmaß und 3D-Simulation.' });
        if (d.showBlock) {
          App.numRow(box, 'Mindestabstand zum Profil (mm)', getMg, setMg, { step: 1, min: 0, norender: true,
            hint: 'Kleinster Abstand des Blockrands zum Profil — rundum (vorne, hinten, oben, unten). '
              + 'Wird für eine Seite eine feste Blocklänge X bzw. Blockhöhe Y gesetzt, gilt dort diese statt des Abstands.' });
        }
      } else {
        const info = document.createElement('div'); info.style.cssText = 'font-size:11px;color:var(--muted)';
        const fx = v => v > 0 ? Math.round(v) + ' mm' : T('auto');
        info.textContent = T('Breite ') + Math.round(getSpan() || 0) + ' mm · X ' + fx(getLX()) + ' · Y ' + fx(getHY());
        box.appendChild(info);
      }
      sgg.body.appendChild(box);
    })(k);
    App.boolRow(sgg.body, 'Blockgrenze anzeigen', () => d.showBlock,
      v => { d.showBlock = v; App.buildSidebar(); renderDxf(); },
      'Zeichnet das rechteckige Rohmaß (Styroporblock) um beide Profile. Reine Darstellung, '
      + 'kein Einfluss auf die Form oder den G-Code.');
    const badd = document.createElement('button'); badd.className = 'primary';
    badd.textContent = T('+ Segment hinzufügen'); badd.onclick = dxfAddSeg;
    sgg.body.appendChild(badd);
    App.hint(sgg.body, 'Hängt ein weiteres Segment mit zwei eigenen Profilen an (vorbelegt mit dem Layer des letzten '
      + 'AUSSEN-Profils). Beide Profile anschließend per Layerauswahl oder aus eigener Datei belegen.');
    side.appendChild(sgg.g);

    // --- Layer-/Konturzuordnung des AKTIVEN Segments ------------------
    const g2 = App.grp(T('Zuordnung · Segment ') + (d.activeSeg + 1), true, 'dxf', { alwaysOpen: true });
    App.hint(g2.body, 'Layer-Zuordnung des aktiven Segments: INNEN (Wurzel-/linke Ebene) und AUSSEN '
      + '(Rand-/rechte Ebene). Beide Rippen können auch aus getrennten Dateien stammen. '
      + 'Für INNEN und AUSSEN darf auch derselbe Layer gewählt werden (Wurzel = Rand, z. B. gerader Schnitt).');
    const isHelp = n => !!(d.helpLayers && d.helpLayers[n]);
    const layerOpts = d.order.filter(n => d.layers[n] && d.layers[n].length && !isHelp(n)).map(n => [n, n + ' (' + d.layers[n].length + ')']);
    const setRibLayer = (idx, v) => {
      dxfEnsureModel();
      // Fehlt die Zielrippe noch (z. B. AUSSEN bei einem Ein-Layer-Import), wird sie
      // angelegt — INNEN und AUSSEN dürfen denselben Layer verwenden.
      if (idx >= d.ribs.length) { while (d.ribs.length <= idx) d.ribs.push({ layer: v, off: { x: 0, y: 0 } }); }
      else if (d.ribs[idx]) d.ribs[idx].layer = v;
      dxfEnsureModel(); dxfLoadActive(); dxfResolve(); App.buildSidebar(); renderDxf(); App.render();
    };
    const actSeg = d.segs && d.segs[d.activeSeg], linked = !!(actSeg && actSeg.linkPrev);
    if (d.activeSeg > 0)
      App.boolRow(g2.body, 'INNEN vom Vorsegment übernehmen', () => linked, v => dxfSetLinkPrev(d.activeSeg, v),
        'An: INNEN ist das AUSSEN-Profil des Vorsegments (Layer und Verschiebung gemeinsam, Änderungen wirken auf beide Segmente). Aus: das Segment hat ein eigenes INNEN-Profil.');
    if (linked) App.hint(g2.body, T('INNEN = AUSSEN von Segment ') + d.activeSeg + ': ' + (d.innerName || '—'));
    else App.selectRow(g2.body, 'Layer INNEN (Wurzel)', layerOpts,
      () => d.innerName || '', v => setRibLayer(2 * d.activeSeg, v));
    App.selectRow(g2.body, 'Layer AUSSEN (Rand)', layerOpts,
      () => d.outerName || '', v => setRibLayer(2 * d.activeSeg + 1, v));
    App.hint(g2.body, T('INNEN = ') + (d.inner ? d.inner.length + T(' Pkt') : '—') + T(' · AUSSEN = ') + (d.outer ? d.outer.length + T(' Pkt') : '—'));
    const rrow = document.createElement('div'); rrow.style.cssText = 'display:flex;gap:6px';
    const rIn = document.createElement('button'); rIn.textContent = T('INNEN aus eigener DXF…'); rIn.onclick = () => loadDxfRole('inner');
    const rOut = document.createElement('button'); rOut.textContent = T('AUSSEN aus eigener DXF…'); rOut.onclick = () => loadDxfRole('outer');
    rIn.style.flex = rOut.style.flex = '1 1 0'; rIn.style.minWidth = rOut.style.minWidth = '0';
    rrow.appendChild(rIn); rrow.appendChild(rOut); g2.body.appendChild(rrow);
    const rrow2 = document.createElement('div'); rrow2.style.cssText = 'display:flex;gap:6px;margin-top:6px';
    const rInS = document.createElement('button'); rInS.textContent = T('INNEN aus eigener SVG…'); rInS.onclick = () => loadSvgRole('inner');
    const rOutS = document.createElement('button'); rOutS.textContent = T('AUSSEN aus eigener SVG…'); rOutS.onclick = () => loadSvgRole('outer');
    rInS.style.flex = rOutS.style.flex = '1 1 0'; rInS.style.minWidth = rOutS.style.minWidth = '0';
    rrow2.appendChild(rInS); rrow2.appendChild(rOutS); g2.body.appendChild(rrow2);

    // Verschiebung je Rippe (mm), um getrennt geladene DXF zueinander auszurichten.
    // Rein visuell/geometrisch — verändert die Rohdaten nicht. Bezieht sich auf die
    // beiden Rippen des AKTIVEN Segments (Referenzen auf ribs[k].off / ribs[k+1].off).
    d.innerOff = d.innerOff || { x: 0, y: 0 }; d.outerOff = d.outerOff || { x: 0, y: 0 };
    App.numRow(g2.body, 'INNEN verschieben X (mm)', () => d.innerOff.x, v => { d.innerOff.x = v; dxfResolve(); renderDxf(); App.render(); }, { step: 1, norender: true });
    App.numRow(g2.body, 'INNEN verschieben Y (mm)', () => d.innerOff.y, v => { d.innerOff.y = v; dxfResolve(); renderDxf(); App.render(); }, { step: 1, norender: true });
    App.numRow(g2.body, 'AUSSEN verschieben X (mm)', () => d.outerOff.x, v => { d.outerOff.x = v; dxfResolve(); renderDxf(); App.render(); }, { step: 1, norender: true });
    App.numRow(g2.body, 'AUSSEN verschieben Y (mm)', () => d.outerOff.y, v => { d.outerOff.y = v; dxfResolve(); renderDxf(); App.render(); }, { step: 1, norender: true });
    // Beide Querschnitte synchron verschieben: das Feld zeigt die INNEN-Verschiebung;
    // eine Änderung wird als gleiche Differenz auch auf AUSSEN übertragen (Lage
    // der beiden Rippen zueinander bleibt erhalten).
    const both = (ax, v) => {
      const dlt = v - (d.innerOff[ax] || 0);
      d.innerOff[ax] = v; d.outerOff[ax] = (d.outerOff[ax] || 0) + dlt;
      dxfResolve(); App.buildSidebar(); renderDxf(); App.render();
    };
    App.numRow(g2.body, 'BEIDE verschieben X (mm)', () => d.innerOff.x, v => both('x', v),
      { step: 1, norender: true, enter: true, hint: 'Verschiebt INNEN und AUSSEN gemeinsam um dieselbe Strecke (Lage zueinander bleibt).' });
    App.numRow(g2.body, 'BEIDE verschieben Y (mm)', () => d.innerOff.y, v => both('y', v), { step: 1, norender: true, enter: true });
    const bReset = document.createElement('button'); bReset.textContent = T('Verschiebung zurücksetzen');
    bReset.onclick = () => { if (d.innerOff) { d.innerOff.x = 0; d.innerOff.y = 0; } if (d.outerOff) { d.outerOff.x = 0; d.outerOff.y = 0; } dxfResolve(); App.buildSidebar(); renderDxf(); App.render(); };
    g2.body.appendChild(bReset);

    side.appendChild(g2.g);
    // --- Hilfslayer: nur Anzeige, nie Schneidpfad (je Layer umschaltbar) ---
    // Hilfslayer kann nur sein, was KEINEM Segment zugeordnet ist; von einem zugeordneten
    // Layer lässt sich eine Kopie als Hilfslayer anlegen (eigene Punktdaten).
    const layersWithGeom = d.order.filter(n => d.layers[n] && d.layers[n].length);
    if (layersWithGeom.length > 1) {
      const assigned = new Set((d.ribs || []).map(r => r.layer));
      const gh = App.grp('Hilfslayer (nur Anzeige)', false, 'dxf', { key: 'dxfHelpLayers' });
      App.hint(gh.body, 'Angehakte Layer werden gestrichelt mit angezeigt (z. B. Rumpfkontur, Holmlage, Referenzmaße), '
        + 'stehen aber nicht als INNEN/AUSSEN zur Wahl und werden nie geschnitten. Zur Wahl stehen nur Layer, die keinem Segment zugeordnet sind.');
      const free = layersWithGeom.filter(n => !assigned.has(n) || isHelp(n));
      if (!free.length) App.hint(gh.body, 'Alle Layer sind Segmenten zugeordnet — unten eine Kopie als Hilfslayer anlegen.');
      free.forEach(n => {
        App.boolRow(gh.body, n + ' (' + d.layers[n].length + ')', () => isHelp(n), v => {
          if (!d.helpLayers) d.helpLayers = {};
          if (v) d.helpLayers[n] = true; else delete d.helpLayers[n];
          // Altstand (Hilfslayer trotz Zuordnung): Profile auf den ersten Nicht-Hilfslayer umhängen.
          if (v && d.ribs) {
            const alt = d.order.find(m => d.layers[m] && d.layers[m].length && !isHelp(m));
            d.ribs.forEach(r => { if (r.layer === n && alt) r.layer = alt; });
          }
          dxfEnsureModel(); dxfLoadActive(); dxfResolve(); App.buildSidebar(); renderDxf(); App.render();
        });
      });
      const used = layersWithGeom.filter(n => assigned.has(n) && !isHelp(n));
      if (used.length) {
        const cr = document.createElement('div'); cr.className = 'mrow'; cr.style.cssText = 'gap:6px;align-items:center;margin-top:6px';
        const sel = document.createElement('select'); sel.style.cssText = 'flex:1 1 0;min-width:0';
        used.forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
        if (d.innerName && used.includes(d.innerName)) sel.value = d.innerName;
        const bc = document.createElement('button'); bc.textContent = T('Kopie als Hilfslayer');
        bc.title = T('Legt eine Kopie des gewählten, einem Segment zugeordneten Layers als Hilfslayer an — in der Lage, in der er im aktiven Segment (sonst im ersten Segment, das ihn nutzt) liegt.');
        bc.onclick = () => {
          const n = sel.value; if (!d.layers[n]) return;
          const act = [d.ribs[2 * d.activeSeg], d.ribs[2 * d.activeSeg + 1]].find(r => r && r.layer === n);
          const rib = act || d.ribs.find(r => r.layer === n);
          dxfPushUndo();
          const nn = dxfCopyLayer(n, n + ' (' + T('Hilf') + ')', rib && rib.off);
          if (!d.helpLayers) d.helpLayers = {};
          d.helpLayers[nn] = true;
          dxfResolve(); App.buildSidebar(); renderDxf(); App.render();
        };
        cr.appendChild(sel); cr.appendChild(bc); gh.body.appendChild(cr);
        App.hint(gh.body, 'Zugeordnete Layer können nicht selbst Hilfslayer sein — die Kopie ist ein eigener Layer und ändert sich nicht mehr mit dem Original.');
      }
      side.appendChild(gh.g);
    }



    const sy = App.grp('Synchronpunkte', true, 'dxf');
    // Gleicher Querschnitt (INNEN = AUSSEN): Synchronpunkte sind nicht nötig —
    // die Bahn und der G-Code entstehen direkt. Deutlich sichtbare Meldung.
    if (dxfSameSection() && !d.sync.length) {
      const note = document.createElement('div');
      note.style.cssText = 'margin:0 0 8px;padding:8px 10px;border-radius:6px;'
        + 'background:rgba(87,211,140,.14);border:1px solid var(--accent);color:var(--txt);font-size:12px;line-height:1.4';
      note.innerHTML = '<b>✓ ' + T('Gleicher Querschnitt (INNEN = AUSSEN)') + '</b><br>'
        + T('Synchronpunkte entfallen — die Schnittbahn wird direkt erzeugt, der G-Code kann sofort erstellt werden.');
      sy.body.appendChild(note);
    }
    // Setzmodus starten/stoppen — im aktiven Modus setzt der Klick Synchronpunkte.
    const bsm = document.createElement('button');
    bsm.textContent = d.syncMode ? T('■ Synchronpunkte setzen: AN') : T('▶ Synchronpunkte setzen starten');
    bsm.className = d.syncMode ? '' : 'primary';
    if (d.syncMode) { bsm.style.background = 'var(--accent)'; bsm.style.color = '#04121f'; bsm.style.borderColor = 'var(--accent)'; }
    bsm.disabled = !(d.inner && d.outer);
    bsm.onclick = () => { d.syncMode = !d.syncMode; if (d.syncMode) { d.edit.on = false; d.pEdit.on = false; d.pEdit.drag = null; } else { d.syncHover = null; } d.pick = null; App.buildSidebar(); renderDxf(); };
    sy.body.appendChild(bsm);
    App.hint(sy.body, d.syncMode
      ? 'Setzmodus AKTIV: erst einen Punkt auf INNEN anklicken, dann den zugehörigen auf AUSSEN. '
        + 'Die farbige Markierung zeigt den Punkt, auf den das Fadenkreuz einrastet — vor dem Klick. '
        + 'Wie im CAD wird an bestehenden Stützpunkten gefangen; liegt keiner in der Nähe, rastet es auf den '
        + 'nächstgelegenen Punkt der Kante ein (dort wird ein neuer Stützpunkt eingefügt). '
        + 'Schnittpunkte mit Hilfslayern (kleine Kreuze) werden ebenfalls gefangen. '
        + 'Erneut klicken auf den Button beendet den Modus.'
      : 'Zum Setzen den Modus starten. Danach INNEN-Punkt und zugehörigen AUSSEN-Punkt anklicken. '
        + 'Beide Konturen werden zwischen den Paaren synchronisiert; das erste Paar legt den Startpunkt fest.');
    if (d.pick && d.pick.stage === 1)
      App.hint(sy.body, T('➊ INNEN-Punkt ') + d.pick.i + T(' gewählt — jetzt zugehörigen AUSSEN-Punkt anklicken.'));
    // Automatik: Ecken beider Konturen zuordnen (sonst gleichmäßig nach Bogenlänge).
    if (d.inner && d.outer && !dxfSameSection()) {
      const arow = document.createElement('div'); arow.style.cssText = 'display:flex;gap:6px;margin-top:6px';
      const ba = document.createElement('button'); ba.textContent = T('⟳ Synchronpunkte automatisch');
      ba.title = T('Vorhandene Paare des aktiven Segments ersetzen: Startpaar = Nase, dann Umkehrpunkte bzw. Ecken beider Konturen der Reihe nach zuordnen; ohne passende Merkmale gleichmäßig nach Bogenlänge.');
      ba.onclick = () => { dxfPushUndo(); const m = dxfAutoSync(); d.syncMode = false; toast(m); App.buildSidebar(); renderDxf(); App.render(); };
      const bl = document.createElement('button'); bl.textContent = T('… alle Segmente');
      bl.title = T('Synchronpunkte für alle Segmente der Rippenkette automatisch neu anlegen.');
      bl.onclick = () => { dxfPushUndo(); const m = dxfAutoSyncAll(); d.syncMode = false; toast(m); App.buildSidebar(); renderDxf(); App.render(); };
      ba.style.flex = '1 1 0'; bl.style.flex = '0 0 auto';
      arow.appendChild(ba); if (dxfSegCount() > 1) arow.appendChild(bl);
      sy.body.appendChild(arow);
      // Aus einem GMFC-Projekt importiert: die Index-Zuordnung der Datei zum Vergleich.
      const segG = d.segs && d.segs[d.activeSeg];
      if (segG && Array.isArray(segG.gmfcSync) && segG.gmfcSync.length) {
        const grow = document.createElement('div'); grow.style.cssText = 'display:flex;gap:6px;margin-top:6px';
        const applyG = (k) => { const sg = d.segs[k]; if (!sg || !sg.gmfcSync) return; sg.sync = sg.gmfcSync.map(q => ({ i: q.i, j: q.j })); sg.start = 0; sg.pathEdit = null; if (k === d.activeSeg) { d.sync = sg.sync; d.start = 0; d.pathEdit = null; d.pick = null; } };
        const bg1 = document.createElement('button'); bg1.textContent = T('↺ Zuordnung wie GMFC');
        bg1.title = T('Synchronpaare so setzen, wie GMFC die Punkte der Datei zuordnet (Index für Index, gleichmäßig verteilt — ohne Zuordnung von Taschen/Ecken).');
        bg1.onclick = () => { dxfPushUndo(); applyG(d.activeSeg); dxfResolve(); toast(T('Zuordnung wie GMFC (Index) übernommen')); App.buildSidebar(); renderDxf(); App.render(); };
        const bg2 = document.createElement('button'); bg2.textContent = T('… alle Segmente');
        bg2.title = T('Zuordnung wie GMFC für alle Segmente der Rippenkette.');
        bg2.onclick = () => { dxfPushUndo(); dxfStashActive(); d.segs.forEach((sg, k) => applyG(k)); dxfLoadActive(); dxfResolve(); toast(T('Zuordnung wie GMFC (Index) übernommen')); App.buildSidebar(); renderDxf(); App.render(); };
        bg1.style.flex = '1 1 0'; bg2.style.flex = '0 0 auto';
        grow.appendChild(bg1); if (dxfSegCount() > 1) grow.appendChild(bg2);
        sy.body.appendChild(grow);
        App.hint(sy.body, 'GMFC verteilt die Punkte nur gleichmäßig auf gleiche Anzahl; Taschen oder Ecken werden dabei nicht '
          + 'einander zugeordnet. Bei ungleich großen Taschen passt die Automatik (Umkehrpunkte) meist besser — beide '
          + 'Varianten lassen sich hier direkt vergleichen.');
      }
      App.hint(sy.body, 'Automatik: Nase als Startpaar, danach die Umkehrpunkte (x-/y-Extrema, gerade Kanten in der Mitte) '
        + 'beider Konturen der Reihe nach — passt bei gleichem Konturtyp (z. B. Spanten mit Schlitz/Tasche, auch mit verrundeten '
        + 'Ecken). Stimmt die Abfolge nicht, werden harte Ecken zugeordnet, sonst die Paare gleichmäßig nach Bogenlänge verteilt; '
        + 'einzelne Paare danach von Hand ergänzen oder löschen.');
    }
    if (d.sync.length) {
      const list = document.createElement('div'); list.style.display = 'grid'; list.style.gap = '4px';
      d.sync.forEach((s, k) => {
        const row = document.createElement('div'); row.className = 'row';
        const lab = document.createElement('span'); lab.className = 'hint'; lab.style.margin = '0';
        lab.textContent = (k === d.start ? '▶ ' : '') + T('Paar ') + (k + 1) + T(': innen ') + s.i + T(' ↔ außen ') + s.j;
        const bs = App.mkMini('◎', () => { d.start = k; App.buildSidebar(); renderDxf(); }); bs.title = T('als Startpaar');
        const np = document.createElement('input'); np.type = 'number'; np.min = '2'; np.step = '1';
        np.placeholder = T('auto'); np.title = T('Punkte des Segments ab diesem Paar (leer = automatisch)');
        np.value = s.n > 0 ? s.n : ''; np.style.width = '52px'; np.style.padding = '3px 5px'; np.style.fontSize = '11px';
        np.oninput = () => { const v = parseInt(np.value, 10); s.n = (np.value === '' || isNaN(v)) ? 0 : Math.max(2, v); renderDxf(); App.render(); };
        const bx = App.mkMini('✕', () => { dxfPushUndo(); d.sync.splice(k, 1); if (d.start >= d.sync.length) d.start = 0; App.buildSidebar(); renderDxf(); App.render(); });
        bx.style.color = 'var(--bad)';
        row.appendChild(lab); const sp = document.createElement('div'); sp.style.flex = '1'; row.appendChild(sp);
        row.appendChild(np); row.appendChild(bs); row.appendChild(bx); list.appendChild(row);
      });
      sy.body.appendChild(list);
      const bc = document.createElement('button'); bc.textContent = T('Alle Synchronpaare löschen');
      bc.onclick = () => { dxfPushUndo(); d.sync = []; d.start = 0; d.pick = null; App.buildSidebar(); renderDxf(); App.render(); };
      sy.body.appendChild(bc);
    }
    // Punktverteilung der synchronen Bahn (alles rund um Punkte gehört hierher).
    App.subhead(sy.body, 'Punktverteilung der Bahn');
    App.selectRow(sy.body, 'Verteilung', [['total', 'Punkte gesamt'], ['permm', 'Punktdichte (Pkt/mm)']],
      () => d.densMode, v => { d.densMode = v; App.buildSidebar(); renderDxf(); App.render(); },
      'Gesamt: feste Zielpunktzahl, längenproportional verteilt. Punktdichte: Punkte je mm '
      + '(längere Seite je Intervall). Einzelne Segmente per Feld „Pkt" oben fest vorgeben.');
    if (d.densMode === 'permm')
      App.numRow(sy.body, 'Punktdichte (Pkt/mm)', () => d.perMM, v => { d.perMM = v; renderDxf(); App.render(); },
        { step: 0.1, min: 0.01, norender: true, hint: 'Stützpunkte je mm Bahnlänge.' });
    else
      App.numRow(sy.body, 'Punkte gesamt', () => d.density, v => { d.density = v; renderDxf(); App.render(); },
        { int: true, min: 8, max: 5000, norender: true,
          hint: 'Zielpunktzahl der synchronen Schnittbahn (längenproportional auf die Intervalle verteilt).' });
    side.appendChild(sy.g);

    const op = App.grp('Schnitt', true, 'dxf');
    App.selectRow(op.body, 'Umlaufrichtung', [['1', 'Vorwärts (wie gesetzt)'], ['-1', 'Rückwärts']],
      () => String(d.dir), v => { d.dir = parseInt(v, 10); renderDxf(); App.render(); },
      'Richtung, in der die Kontur ab dem Startpaar durchlaufen wird.');
    App.boolRow(op.body, 'Abbrand kompensieren', () => d.kerf,
      v => { d.kerf = v; App.buildSidebar(); renderDxf(); App.render(); },
      'Versetzt beide Bahnen um Abbrand/2 nach außen (Werkstoff-/Betriebspunkt). Bei falscher Seite '
      + 'die Umlaufrichtung umkehren.');
    if (d.kerf) App.kerfModeRow(op.body, 'dxf');
    App.boolRow(op.body, 'Schnittspur anzeigen', () => d.showSpur,
      v => { d.showSpur = v; App.buildSidebar(); renderDxf(); },
      'Zeichnet die tatsächliche Draht-Bahn (INNEN/AUSSEN synchronisiert, inkl. Abbrand-Versatz) '
      + 'zusätzlich zu den Profilen.');
    if (d.showSpur && App.kerfTrueRow) App.kerfTrueRow(op.body, 'dxf');
    App.boolRow(op.body, 'Anfahrt/Ausfahrt sicher', () => d.safeLead,
      v => { d.safeLead = v; App.render(); },
      'Beginnt den Schnitt automatisch am HINTERSTEN Punkt (größtes X), damit die waagrechte '
      + 'An- und Abfahrt vom Maschinennullpunkt das Werkstück nicht kreuzt. Ändert nur die '
      + 'Anfahrt, nicht die Form.');
    App.hint(op.body, 'G-Code entsteht über „G-Code-Quelle → DXF-Formen" mit Vorschub, Achsen, '
      + 'Sicherheitshöhe und dem „Schneiden"-Ablauf der Maschine.');
    side.appendChild(op.g);

    // --- Punkteditor (Profil / Schneidepfad) -----------------------
    const pe = d.pEdit;
    const pg = App.grp('Punkte bearbeiten', true, 'dxf');
    const hasProfile = !!(d.inner && d.outer);
    const canPath = !!(d.pathEdit) || !!dxfSyncedRaw();
    // Ziel-Aktivierung sicherstellen (Pfad braucht eingefrorene Bahn).
    const ensureTarget = tgt => {
      if (tgt === 'path') { if (!d.pathEdit) return dxfPathEditBake(); return true; }
      return hasProfile;   // Profil: Rohkonturen direkt bearbeiten
    };
    App.boolRow(pg.body, 'Bearbeiten aktiv', () => pe.on,
      v => {
        if (v) {
          if (!ensureTarget(pe.target)) { flashDxf(pe.target === 'path' ? 'Mindestens 1 Synchronpaar nötig.' : 'Keine INNEN/AUSSEN-Kontur vorhanden.'); App.buildSidebar(); return; }
          d.syncMode = false; d.edit.on = false; d.pick = null;
        }
        pe.on = v; pe.drag = null; pe.undo.length = 0; pe.redo.length = 0;
        App.buildSidebar(); renderDxf();
      },
      'Zeigt die Stützpunkte als Griffe (Linksklick halten = verschieben, Doppelklick = hinzufügen, Rechtsklick = löschen) — wahlweise auf der '
      + 'INNEN/AUSSEN-Profilkontur oder auf dem synchronisierten Schneidepfad (analog zum Kerndesign).');
    if (pe.on) {
      App.selectRow(pg.body, 'Ziel',
        [['profile', 'Profil (INNEN/AUSSEN)'], ['path', 'Schneidepfad (synchronisiert)']],
        () => pe.target, v => {
          if (v === pe.target) return;
          if (!ensureTarget(v)) { flashDxf(v === 'path' ? 'Mindestens 1 Synchronpaar nötig.' : 'Keine INNEN/AUSSEN-Kontur vorhanden.'); App.buildSidebar(); return; }
          if (v === 'profile') d.pathEdit = null;   // Profil live -> Override verwerfen
          pe.target = v; pe.drag = null; pe.undo.length = 0; pe.redo.length = 0;
          App.buildSidebar(); renderDxf(); App.render();
        },
        '„Profil": die geladenen/gezeichneten INNEN- und AUSSEN-Konturen direkt bearbeiten (jede Bahn '
        + 'unabhängig; wird für den Schnitt neu synchronisiert). „Schneidepfad": die FERTIGE, '
        + 'synchronisierte Bahn einfrieren und Punkt für Punkt bearbeiten (INNEN/AUSSEN index-synchron).');
      App.hint(pg.body, 'Bedienung: Griff anklicken und halten = verschieben · Doppelklick links auf Kante = Punkt hinzufügen · Rechtsklick auf Griff = Punkt löschen.'
        + (pe.target === 'path' ? ' Hinzufügen/Löschen wirkt auf INNEN und AUSSEN am gleichen Index.' : ' Wirkt nur auf die getroffene Kontur.'));
      const bar = document.createElement('div'); bar.style.display = 'flex'; bar.style.gap = '6px';
      const mk = (txt, fn) => { const b = document.createElement('button'); b.textContent = T(txt); b.style.flex = '1'; b.onclick = fn; return b; };
      bar.appendChild(mk('↶ Rückgängig', dxfPathUndo));
      bar.appendChild(mk('↷ Wiederholen', dxfPathRedo));
      pg.body.appendChild(bar);
      if (pe.target === 'path') {
        const rb = document.createElement('button'); rb.textContent = T('⟲ Schneidepfad zurücksetzen (neu aus Sync)');
        rb.style.color = 'var(--bad)';
        rb.onclick = () => { d.pathEdit = null; pe.undo.length = 0; pe.redo.length = 0; if (dxfPathEditBake()) { App.buildSidebar(); renderDxf(); App.render(); } };
        pg.body.appendChild(rb);
      }
      App.hint(pg.body, pe.target === 'path'
        ? 'Schneidepfad eingefroren: Punktverteilung/Sync/Abbrand ändern ihn nicht mehr, bis zurückgesetzt. '
          + 'Wirkt sofort auf Schnittspur, 3D-Simulation und G-Code. Strg+Z / Strg+Y.'
        : 'Profil-Modus: Änderungen an INNEN/AUSSEN wirken über die Synchronisierung auf Schnittspur und '
          + 'G-Code. Strg+Z / Strg+Y.');
    } else {
      App.hint(pg.body, (hasProfile || canPath)
        ? 'Bearbeitet die Stützpunkte der Profilkontur ODER des fertigen Schneidepfads — analog zum Kerndesign.'
        : 'Zuerst eine DXF laden/zeichnen (Profil) bzw. mindestens 1 Synchronpaar setzen (Schneidepfad).');
    }
    side.appendChild(pg.g);

    // --- CAD-Bearbeitung: in eigenen Reiter ausgelagert ----------------
    // Die Zeichen-/CAD-Werkzeuge sind nicht mehr hier, sondern im Reiter
    // „CAD-Bearbeitung". Editier-Modus im DXF-Reiter bleibt deshalb aus.
    d.edit.on = false;
    const eg = App.grp('CAD-Bearbeitung', true, 'dxf');
    App.hint(eg.body, 'Die Zeichen- und Änderungswerkzeuge (Linie, Polylinie, Kreis, Ellipse, '
      + 'Trimmen, Spiegeln, Objektfang, Ortho …) sind in den eigenen Reiter CAD-Bearbeitung '
      + 'umgezogen. Dort die Geometrie importieren, bearbeiten und als DXF exportieren '
      + '(kein Zurückschreiben in die DXF-Formen).');
    const bcad = document.createElement('button'); bcad.className = 'primary';
    bcad.textContent = T('Im CAD-Reiter bearbeiten →');
    bcad.onclick = () => { App.switchView('cad'); cadLoadFromDxf(); };
    eg.body.appendChild(bcad);
    side.appendChild(eg.g);
  }
  // Sidebar-Gruppe „Hintergrundbild": laden, sichtbar, Deckkraft, Verschieben,
  // Skalieren, Drehen. Wird sowohl mit als auch ohne geladene DXF gezeigt.
  function buildBgSidebar(side) {
    const bg = state.dxf.bg;
    const bgrp = App.grp('Hintergrundbild', true, 'dxf');
    const bl = document.createElement('button'); bl.className = bg.img ? '' : 'primary';
    bl.textContent = bg.img ? T('Anderes Bild laden…') : T('Bild laden…');
    bl.onclick = () => App.loadFileVia({ 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'] }, f => dxfLoadBgImage(f), 'fileBgImg', 'ldImg');
    bgrp.body.appendChild(bl);
    if (!bg.img) {
      App.hint(bgrp.body, 'Lädt ein Referenz-/Vorlagenbild (PNG/JPG/SVG) unter die Zeichnung. '
        + 'Danach lässt es sich verschieben, skalieren und drehen — ideal zum Nachzeichnen.');
      side.appendChild(bgrp.g); return;
    }
    App.boolRow(bgrp.body, 'Sichtbar', () => bg.visible, v => { bg.visible = v; renderDxf(); });
    App.numRow(bgrp.body, 'Deckkraft (%)', () => Math.round(bg.opacity * 100),
      v => { bg.opacity = Math.min(1, Math.max(0, v / 100)); renderDxf(); },
      { int: true, min: 0, max: 100, norender: true });
    const bm = document.createElement('button');
    bm.textContent = bg.moveMode ? T('■ Verschieben per Maus: AN') : T('✋ Verschieben per Maus');
    if (bg.moveMode) { bm.style.background = 'var(--accent)'; bm.style.color = '#04121f'; bm.style.borderColor = 'var(--accent)'; }
    bm.title = T('Bild mit gedrückter Maustaste auf der Zeichenfläche verschieben (nur bei ausgeschaltetem Bearbeiten-Modus).');
    bm.onclick = () => { bg.moveMode = !bg.moveMode; App.buildSidebar(); renderDxf(); };
    bgrp.body.appendChild(bm);
    App.numRow(bgrp.body, 'Position X (mm)', () => bg.x, v => { bg.x = v; renderDxf(); }, { step: 1, norender: true });
    App.numRow(bgrp.body, 'Position Y (mm)', () => bg.y, v => { bg.y = v; renderDxf(); }, { step: 1, norender: true });
    App.numRow(bgrp.body, 'Breite (mm)', () => +(bg.iw * bg.scale).toFixed(1),
      v => { if (bg.iw > 0 && v > 0) bg.scale = v / bg.iw; renderDxf(); }, { step: 1, min: 0.1, norender: true,
        hint: 'Gesamtbreite des Bildes in mm (skaliert proportional).' });
    App.numRow(bgrp.body, 'Skalierung (%)', () => +(bg.scale * 100).toFixed(1),
      v => { if (v > 0) bg.scale = v / 100; renderDxf(); }, { step: 1, min: 0.1, norender: true });
    App.numRow(bgrp.body, 'Drehung (°)', () => bg.rot, v => { bg.rot = v; renderDxf(); }, { step: 1, norender: true });
    const br = document.createElement('button'); br.textContent = T('Bild entfernen'); br.style.color = 'var(--bad)';
    br.onclick = () => { bg.img = null; bg.url = null; bg.moveMode = false; App.buildSidebar(); renderDxf(); };
    bgrp.body.appendChild(br);
    App.hint(bgrp.body, 'Das Hintergrundbild dient nur als Vorlage und ist nicht Teil der Geometrie/des G-Codes.');
    side.appendChild(bgrp.g);
  }
  // Frei zeichnen: leeren CAD-Reiter öffnen (Zeichnen/Bearbeiten passiert jetzt
  // dort, nicht mehr im DXF-Formen-Reiter).
  function dxfNewBlank() {
    const c = state.cad; c.layers = {}; c.order = []; c.texts = []; c.layerColors = {}; c.layerHidden = {}; c.lineStyles = {}; cadEnsureLayer('Zeichnung');
    c.edit.active = 'Zeichnung'; c.edit.sel = []; c.edit.draft = null; c.edit.tool = 'polyline';
    c.undo.length = 0; c.redo.length = 0;
    App.nav.cad = App.nav.cad || { z: 1, ox: 0, oy: 0, drag: null }; state.cad.view = null; App.nav.cad.z = 1; App.nav.cad.ox = 0; App.nav.cad.oy = 0;
    App.buildSidebar(); App.switchView('cad'); renderCad();
  }
  // Bild aus einer Datei laden (data-URL) und als Hintergrund setzen.
  function dxfLoadBgImage(file) {
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const bg = state.dxf.bg;
        bg.url = rd.result; bg.img = img; bg.iw = img.naturalWidth || img.width; bg.ih = img.naturalHeight || img.height;
        bg.visible = true;
        // Beim ersten Bild sinnvoll platzieren: mittig, Breite ~ vorhandene Geometrie oder 200 mm.
        if (!bg.scale || bg.scale === 1) {
          const b = App.bounds.apply(null, dxfEntities().map(e => e.loop));
          const targetW = (isFinite(b.maxx) && b.maxx > b.minx) ? (b.maxx - b.minx) * 1.2 : 200;
          bg.scale = bg.iw > 0 ? targetW / bg.iw : 1;
          bg.x = (isFinite(b.maxx) && b.maxx > b.minx) ? (b.minx + b.maxx) / 2 : 0;
          bg.y = (isFinite(b.maxy) && b.maxy > b.miny) ? (b.miny + b.maxy) / 2 : 0;
        }
        App.buildSidebar(); renderDxf();
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(file);
  }
  // --- Hintergrundbild per Maus verschieben (nur außerhalb Bearbeiten-Modus) ---
  function dxfBgDown(ev) {
    const bg = state.dxf.bg;
    if (!bg.img || !bg.visible || !bg.moveMode || ev.button !== 0 || !dxfDraw) return false;
    const cv = document.getElementById('cDxf'); const r = cv.getBoundingClientRect();
    const w0 = dxfDraw.V.inv(ev.clientX - r.left, ev.clientY - r.top);
    bg._drag = { sx: w0.x, sy: w0.y, ox: bg.x, oy: bg.y };
    ev.preventDefault(); ev.stopPropagation();
    return true;
  }
  function dxfBgMove(ev) {
    const bg = state.dxf.bg; if (!bg._drag || !dxfDraw) return;
    const cv = document.getElementById('cDxf'); const r = cv.getBoundingClientRect();
    const w0 = dxfDraw.V.inv(ev.clientX - r.left, ev.clientY - r.top);
    bg.x = bg._drag.ox + (w0.x - bg._drag.sx);
    bg.y = bg._drag.oy + (w0.y - bg._drag.sy);
    renderDxf();
  }
  function dxfBgUp() {
    const bg = state.dxf.bg; if (bg._drag) { bg._drag = null; App.buildSidebar(); }
  }
  function dxfToolHint(t) {
    switch (t) {
      case 'select': return T('Klick wählt eine Kontur (Umschalt = mehrere). Ziehen einer gewählten Kontur verschiebt sie.');
      case 'vertex': return T('Einen Konturpunkt anfassen und ziehen. Verändert die Form direkt.');
      case 'delpt': return T('Auf einen Konturpunkt klicken, um ihn zu entfernen.');
      case 'line': return T('Startpunkt klicken, Endpunkt klicken. Fügt eine Linie auf dem aktiven Layer ein.');
      case 'rect': return T('Zwei gegenüberliegende Ecken klicken. Fügt ein geschlossenes Rechteck ein.');
      case 'circle': return T('Mittelpunkt klicken, dann Radius klicken. Fügt einen Kreis ein.');
      case 'ellipse': return T('Zwei gegenüberliegende Ecken des umschließenden Rechtecks klicken. Fügt eine Ellipse ein.');
      case 'mirror': return T('Erst Konturen auswählen (Werkzeug „Auswählen"), dann zwei Punkte der Spiegelachse klicken. Original bleibt erhalten.');
      case 'polyline': return T('Nacheinander Punkte klicken; Doppelklick oder „abschließen". Nahe am Start = geschlossen.');
      case 'move': return T('Erst Konturen auswählen (Werkzeug „Auswählen"), dann Basispunkt + Zielpunkt klicken.');
      case 'copy': return T('Wie Verschieben, legt aber eine Kopie ab (Auswahl bleibt erhalten).');
      case 'trim': return T('Auf den WEGZUSCHNEIDENDEN Teil einer Kontur klicken — er wird bis zur nächsten Kreuzung mit einer anderen Kontur entfernt.');
      case 'erase': return T('Auf eine Kontur klicken, um sie zu löschen.');
      default: return '';
    }
  }

  let dxfDraw = null;   // letzte Zeichentransformation für die Klick-Trefferprüfung
  // Alle Konturen aller Layer als flache Liste {layer, idx, loop}.
  function dxfEntities() {
    const d = state.dxf, out = [];
    if (!d.layers) return out;
    for (const name of d.order) (d.layers[name] || []).forEach((loop, idx) => out.push({ layer: name, idx, loop }));
    return out;
  }
  // Die vier Weltkoordinaten-Ecken des (evtl. gedrehten) Hintergrundbildes.
  function bgCorners(bg) {
    const hw = bg.iw * bg.scale / 2, hh = bg.ih * bg.scale / 2;
    const c = Math.cos(bg.rot * Math.PI / 180), s = Math.sin(bg.rot * Math.PI / 180);
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([dx, dy]) =>
      ({ x: bg.x + dx * c - dy * s, y: bg.y + dx * s + dy * c }));
  }
  // Hintergrundbild positioniert/skaliert/gedreht zeichnen (unter der Geometrie).
  function dxfDrawBg(ctx, V, bg) {
    const cx = V.X(bg.x), cy = V.Y(bg.y);
    const sw = bg.iw * bg.scale * V.s, sh = bg.ih * bg.scale * V.s;
    if (!(sw > 0) || !(sh > 0)) return;
    ctx.save();
    ctx.globalAlpha = bg.opacity;
    ctx.translate(cx, cy);
    ctx.rotate(-bg.rot * Math.PI / 180);   // Y ist auf dem Canvas invertiert
    try { ctx.drawImage(bg.img, -sw / 2, -sh / 2, sw, sh); } catch (e) {}
    ctx.restore();
    if (bg.moveMode) {   // Rahmen als Hinweis auf den Verschiebemodus
      ctx.save(); ctx.globalAlpha = 1; ctx.strokeStyle = App.PAL.accent; ctx.lineWidth = 1.4; ctx.setLineDash([6, 4]);
      const corners = bgCorners(bg).map(p => [V.X(p.x), V.Y(p.y)]);
      ctx.beginPath(); corners.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.stroke();
      ctx.restore();
    }
  }
  // Rohmaß-Rechteck des aktiven Segments aus Geometrie-Bounds + Zugaben, bzw. aus
  // festen Blockmaßen X/Y (0 = automatisch). Rückkante (max X) bleibt Bezug.
  function dxfBlockRect(gb) {
    const d = state.dxf, m = d.blockMargin || 0;   // Mindestabstand rundum zum Profil
    const lenX = d.blockLenX || 0, hY = d.blockHeightY || 0;
    let minx, maxx, miny, maxy;
    if (lenX > 0) { maxx = gb.maxx + m; minx = maxx - lenX; }
    else { minx = gb.minx - m; maxx = gb.maxx + m; }
    if (hY > 0) { const mid = (gb.miny + gb.maxy) / 2; miny = mid - hY / 2; maxy = mid + hY / 2; }
    else { miny = gb.miny - m; maxy = gb.maxy + m; }
    return { minx, miny, maxx, maxy };
  }
  // ===== Schneidepfad-Punkteditor (DXF) ==============================
  // Friert die synchronisierte Schnittbahn (INNEN/AUSSEN) als Override ein und
  // lässt die Stützpunkte direkt verschieben/hinzufügen/löschen — analog zum
  // Schneidepfad-Modus im Kerndesign. INNEN und AUSSEN bleiben index-synchron.
  function dxfPathEditBake() {
    const sc = dxfSyncedRaw();
    if (!sc || sc.inner.length < 2) return false;
    let inner = sc.inner.map(p => ({ x: p.x, y: p.y }));
    let outer = sc.outer.map(p => ({ x: p.x, y: p.y }));
    // Abbrand mit einfrieren, damit die Griffe EXAKT auf der sichtbaren roten
    // Schnittspur (dem echten Drahtweg) sitzen — kein Versatz zum Cursor. Der
    // Abbrand wird danach NICHT erneut angewandt (siehe dxfProjection/showSpur).
    if (state.dxf.kerf) { const kk = dxfApplyKerf(inner, outer); inner = kk.root; outer = kk.tip; }
    state.dxf.pathEdit = { inner, outer };
    return true;
  }
  // Aktive Editier-Bahnen je nach Ziel: 'profile' = INNEN/AUSSEN-Rohkonturen
  // (unabhängige, geschlossene Loops), 'path' = eingefrorener Schneidepfad
  // (INNEN/AUSSEN index-synchron). Rückgabe null, wenn nichts editierbar.
  function dxfPEArrays() {
    const d = state.dxf;
    if (d.pEdit.target === 'profile') {
      if (!d.inner || !d.outer) return null;
      return { inner: d.inner, outer: d.outer, sync: false, closed: true };
    }
    if (!d.pathEdit) return null;
    return { inner: d.pathEdit.inner, outer: d.pathEdit.outer, sync: true, closed: true };
  }
  // Undo/Redo — im Profil-Ziel wird die INNEN/AUSSEN-Geometrie über den
  // bestehenden DXF-Undo-Stack gesichert; im Pfad-Ziel der Override.
  function dxfPathSnap() { const d = state.dxf.pathEdit; return { inner: d.inner.map(p => ({ x: p.x, y: p.y })), outer: d.outer.map(p => ({ x: p.x, y: p.y })) }; }
  function dxfPathPushUndo() {
    const d = state.dxf, pe = d.pEdit;
    if (pe.target === 'profile') { dxfPushUndo(); return; }
    if (!d.pathEdit) return;
    pe.undo.push(dxfPathSnap()); if (pe.undo.length > 60) pe.undo.shift(); pe.redo.length = 0;
  }
  function dxfPathUndo() {
    const d = state.dxf, pe = d.pEdit;
    if (pe.target === 'profile') { dxfUndo(); return; }
    if (!pe.undo.length || !d.pathEdit) return;
    pe.redo.push(dxfPathSnap()); d.pathEdit = pe.undo.pop(); pe.drag = null; renderDxf(); App.render();
  }
  function dxfPathRedo() {
    const d = state.dxf, pe = d.pEdit;
    if (pe.target === 'profile') { dxfRedo(); return; }
    if (!pe.redo.length || !d.pathEdit) return;
    pe.undo.push(dxfPathSnap()); d.pathEdit = pe.redo.pop(); pe.drag = null; renderDxf(); App.render();
  }
  function dxfPathWorld(ev) { const cv = document.getElementById('cDxf'); const r = cv.getBoundingClientRect(); return dxfDraw.V.inv(ev.clientX - r.left, ev.clientY - r.top); }
  // Nächsten Stützpunkt über beide Bahnen (INNEN/AUSSEN) finden; Toleranz in px.
  function dxfPathHit(w, tolPx) {
    const A = dxfPEArrays(); if (!A) return null;
    const V = dxfDraw.V; let best = null;
    [['inner', A.inner], ['outer', A.outer]].forEach(([which, arr]) => arr.forEach((p, i) => {
      const dd = Math.hypot(V.X(p.x) - V.X(w.x), V.Y(p.y) - V.Y(w.y));
      if (dd <= tolPx && (!best || dd < best.d)) best = { d: dd, which, i };
    }));
    return best;
  }
  // Nächste KANTE (Segment i..i+1, geschlossen) für „Punkt hinzufügen".
  function dxfPathHitEdge(w, tolPx) {
    const A = dxfPEArrays(); if (!A) return null;
    const V = dxfDraw.V; let best = null;
    [['inner', A.inner], ['outer', A.outer]].forEach(([which, arr]) => {
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i], b = arr[(i + 1) % arr.length];
        const ax = V.X(a.x), ay = V.Y(a.y), bx = V.X(b.x), by = V.Y(b.y);
        const mx = V.X(w.x), my = V.Y(w.y);
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
        let t = ((mx - ax) * dx + (my - ay) * dy) / L2; t = Math.max(0, Math.min(1, t));
        const dd = Math.hypot(ax + t * dx - mx, ay + t * dy - my);
        if (dd <= tolPx && (!best || dd < best.d)) best = { d: dd, which, i };
      }
    });
    return best;
  }
  // Bedienung ohne Werkzeugwahl: Linksklick halten = verschieben,
  // Doppelklick links auf Kante = Punkt hinzufügen, Rechtsklick auf Griff = löschen.
  function dxfPathDown(ev) {
    const d = state.dxf, pe = d.pEdit, A = dxfPEArrays();
    if (!pe.on || !dxfDraw || !A) return;
    if (ev.button !== 0 && ev.button !== 2) return;
    ev.preventDefault(); ev.stopPropagation();
    const w = dxfPathWorld(ev), tol = 10;
    if (ev.button === 2) {   // Rechtsklick: Punkt löschen
      const h = dxfPathHit(w, tol); if (!h) return;
      const arr = h.which === 'inner' ? A.inner : A.outer;
      const other = h.which === 'inner' ? A.outer : A.inner;
      if (arr.length <= 4) { flashDxf('Zu wenige Punkte zum Löschen.'); return; }
      dxfPathPushUndo();
      arr.splice(h.i, 1);
      if (A.sync) other.splice(h.i, 1);   // Pfad: INNEN/AUSSEN index-synchron halten
      pe.drag = null;
      dxfPathAfter(); return;
    }
    // Linksklick: Griff fassen; Undo erst bei der ersten echten Bewegung.
    const h = dxfPathHit(w, tol); if (!h) { pe.drag = null; return; }
    pe.drag = { which: h.which, i: h.i, moved: false };
    renderDxf();
  }
  // Doppelklick links: neuen Punkt auf der getroffenen Kante einfügen.
  function dxfPathDbl(ev) {
    const d = state.dxf, pe = d.pEdit, A = dxfPEArrays();
    if (!pe.on || !dxfDraw || !A) return;
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
    pe.drag = null;
    const w = dxfPathWorld(ev);
    const e = dxfPathHitEdge(w, 16); if (!e) return;
    dxfPathPushUndo();
    const cArr = e.which === 'inner' ? A.inner : A.outer;
    cArr.splice(e.i + 1, 0, { x: w.x, y: w.y });
    if (A.sync) {   // Pfad: Partnerbahn am gleichen Index mit Kanten-Mittelpunkt ergänzen
      const oArr = e.which === 'inner' ? A.outer : A.inner;
      const oa = oArr[e.i] || oArr[oArr.length - 1], ob = oArr[(e.i + 1) % oArr.length] || oa;
      oArr.splice(e.i + 1, 0, { x: (oa.x + ob.x) / 2, y: (oa.y + ob.y) / 2 });
    }
    dxfPathAfter();
  }
  function dxfPathMove(ev) {
    const d = state.dxf, pe = d.pEdit, A = dxfPEArrays();
    if (!pe.on || !dxfDraw || !A) return;
    const dg = pe.drag; if (!dg) return;
    const w = dxfPathWorld(ev);
    const arr = dg.which === 'inner' ? A.inner : A.outer;
    if (dg.i >= arr.length) { pe.drag = null; return; }
    if (!dg.moved) { dxfPathPushUndo(); dg.moved = true; }
    arr[dg.i] = { x: w.x, y: w.y };
    dxfPathAfter();
  }
  function dxfPathUp() { if (state.dxf.pEdit.drag) { state.dxf.pEdit.drag = null; renderDxf(); } }
  // Nach einer Bearbeitung neu zeichnen. Im Profil-Ziel muss zusätzlich die
  // Sync-Auflösung laufen (die Rohkonturen haben sich geändert).
  function dxfPathAfter() {
    if (state.dxf.pEdit.target === 'profile') { dxfProfileWriteBack(); dxfResolve(); }
    renderDxf(); App.render();
  }
  // Profil-Ziel: d.inner/d.outer sind nur abgeleitete (verschobene) Kopien der
  // Layer-Rohdaten — dxfResolve() würde Punkt-Edits sonst sofort verwerfen.
  // Deshalb die bearbeitete Kontur (abzüglich Verschiebung) in den Layer zurückschreiben.
  function dxfProfileWriteBack() {
    const d = state.dxf; if (!d.layers) return;
    [['inner', d.innerName, d.innerOff], ['outer', d.outerName, d.outerOff]].forEach(([k, nm, off]) => {
      const arr = d[k]; if (!arr || !nm || !d.layers[nm]) return;
      const loop = Dxf.pickLoop(d.layers[nm]); if (!loop) return;
      const o = off || { x: 0, y: 0 };
      loop.length = 0; arr.forEach(p => loop.push({ x: p.x - o.x, y: p.y - o.y }));
    });
  }

  // ===== Mini-CAD-Editor =============================================
  function dxfWorld(ev) {   // Bildschirm -> Weltkoordinaten (mit optionalem Fang)
    const cv = document.getElementById('cDxf'); const r = cv.getBoundingClientRect();
    const V = dxfDraw && dxfDraw.V; if (!V) return null;
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    const wpt = V.inv(px, py);
    const ed = state.dxf.edit;
    ed.snapHit = false; ed.snapKind = null;
    // Objektfang (F3) hat Vorrang vor Ortho — wie im CAD üblich.
    if (ed.snap) {
      const s = dxfOsnap(wpt, 12);
      if (s) { ed.snapHit = true; ed.snapKind = s.kind; return { x: s.x, y: s.y }; }
    }
    // Ortho (F8): auf waagrecht/senkrecht zum Bezugspunkt der Skizze zwingen.
    const base = ed.ortho ? dxfDraftRef() : null;
    if (base) return (Math.abs(wpt.x - base.x) >= Math.abs(wpt.y - base.y))
      ? { x: wpt.x, y: base.y } : { x: base.x, y: wpt.y };
    if (ed.gridSnap) {   // aufs Raster runden
      const st = ed.gridStep || 10;
      return { x: Math.round(wpt.x / st) * st, y: Math.round(wpt.y / st) * st };
    }
    return wpt;
  }
  // Objektfang: bester Treffer über alle Konturen nach Typ. Priorität (klein =
  // stärker): Endpunkt 0 · Mittelpunkt 1 · Perpendikular 2 · Nächster 3.
  function dxfOsnap(wpt, tolPx) {
    const ed = state.dxf.edit, V = dxfDraw.V;
    const wx = V.X(wpt.x), wy = V.Y(wpt.y);
    const ref = dxfDraftRef();   // Bezugspunkt für Perpendikular
    let best = null;
    const consider = (kind, prio, x, y) => {
      const dd = Math.hypot(V.X(x) - wx, V.Y(y) - wy);
      if (dd <= tolPx && (!best || prio < best.prio || (prio === best.prio && dd < best.dd)))
        best = { kind, prio, dd, x, y };
    };
    dxfEntities().forEach(e => {
      const loop = e.loop, n = loop.length, last = loop.closed ? n : n - 1;
      if (ed.snapEnd) loop.forEach(p => consider('end', 0, p.x, p.y));
      for (let i = 0; i < last; i++) {
        const a = loop[i], b = loop[(i + 1) % n];
        if (ed.snapMid) consider('mid', 1, (a.x + b.x) / 2, (a.y + b.y) / 2);
        if (ed.snapNear || (ed.snapPerp && ref)) {
          const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-9;
          if (ed.snapNear) { let t = ((wpt.x - a.x) * dx + (wpt.y - a.y) * dy) / L2; t = Math.max(0, Math.min(1, t)); consider('near', 3, a.x + t * dx, a.y + t * dy); }
          if (ed.snapPerp && ref) { const tp = ((ref.x - a.x) * dx + (ref.y - a.y) * dy) / L2; if (tp >= 0 && tp <= 1) consider('perp', 2, a.x + tp * dx, a.y + tp * dy); }
        }
      }
    });
    return best;
  }
  function dxfNearestVertex(wpt, tolPx) {
    const V = dxfDraw.V; let best = null, bd = tolPx * tolPx;
    dxfEntities().forEach(e => e.loop.forEach((p, vi) => {
      const dx = V.X(p.x) - V.X(wpt.x), dy = V.Y(p.y) - V.Y(wpt.y); const dd = dx * dx + dy * dy;
      if (dd < bd) { bd = dd; best = { x: p.x, y: p.y, layer: e.layer, idx: e.idx, vi }; }
    }));
    return best;
  }
  function dxfNearestVertexRef(wpt, tolPx) { return dxfNearestVertex(wpt, tolPx); }
  // Abstand (px) eines Punktes zur Polylinie; liefert {dist, seg, t}.
  function dxfDistToLoop(loop, wpt) {
    const V = dxfDraw.V; let best = { dist: 1e9, seg: 0, t: 0 };
    const n = loop.length, last = loop.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = loop[i], c = loop[(i + 1) % n];
      const ax = V.X(a.x), ay = V.Y(a.y), cx = V.X(c.x), cy = V.Y(c.y);
      const dx = cx - ax, dy = cy - ay, L2 = dx * dx + dy * dy || 1;
      let t = ((V.X(wpt.x) - ax) * dx + (V.Y(wpt.y) - ay) * dy) / L2; t = Math.max(0, Math.min(1, t));
      const qx = ax + t * dx, qy = ay + t * dy;
      const dd = Math.hypot(qx - V.X(wpt.x), qy - V.Y(wpt.y));
      if (dd < best.dist) best = { dist: dd, seg: i, t };
    }
    return best;
  }
  function dxfHitEntity(wpt, tolPx) {
    let best = null;
    dxfEntities().forEach(e => { const h = dxfDistToLoop(e.loop, wpt); if (h.dist < (tolPx || 8) && (!best || h.dist < best.dist)) best = { layer: e.layer, idx: e.idx, dist: h.dist, seg: h.seg, t: h.t }; });
    return best;
  }
  function dxfLoopOf(ref) { const arr = state.dxf.layers[ref.layer]; return arr && arr[ref.idx]; }
  function dxfAddEntity(layer, loop) {
    const d = state.dxf;
    if (!d.layers[layer]) { d.layers[layer] = []; if (!d.order.includes(layer)) d.order.push(layer); }
    d.layers[layer].push(loop);
  }
  function dxfAfterEdit() { dxfResolve(); App.buildSidebar(); renderDxf(); App.render(); }

  // --- Rückgängig / Wiederholen (Strg+Z / Strg+Y bzw. Strg+Umschalt+Z) ---
  function dxfSnap(src) {
    const layers = {};
    for (const k in src.layers) layers[k] = src.layers[k].map(loop => { const a = loop.map(p => ({ x: p.x, y: p.y })); a.closed = loop.closed; return a; });
    return { layers, order: src.order.slice(), innerName: src.innerName, outerName: src.outerName,
             ribLayers: src.ribLayers ? src.ribLayers.slice() : (Array.isArray(src.ribs) ? src.ribs.map(r => r.layer) : null),
             sync: src.sync.map(s => ({ i: s.i, j: s.j, n: s.n })), start: src.start, dir: src.dir };
  }
  function dxfPushUndo() { const d = state.dxf; if (!d.layers) return; d.undo.push(dxfSnap(d)); if (d.undo.length > 60) d.undo.shift(); d.redo.length = 0; }
  function dxfApplySnap(snap) { const d = state.dxf, c = dxfSnap(snap); d.layers = c.layers; d.order = c.order; d.innerName = c.innerName; d.outerName = c.outerName; d.sync = c.sync; d.start = c.start; d.dir = c.dir;
    // Layerzuordnung der Profile zurücksetzen (gleiche Segmentzahl) bzw. verwaiste Zuordnungen heilen.
    if (c.ribLayers && Array.isArray(d.ribs)) d.ribs.forEach((r, i) => {
      if (i < c.ribLayers.length && c.ribLayers[i] && (d.ribs.length === c.ribLayers.length || !d.layers[r.layer])) r.layer = c.ribLayers[i];
    });
  }
  // Layer kopieren (eigene Punktdaten). bake = Verschiebung, die in die Kopie eingerechnet wird.
  function dxfCopyLayer(n, base, bake) {
    const d = state.dxf; let nn = base, i = 2; while (d.layers[nn]) nn = base + ' ' + (i++);
    const bx = bake ? +bake.x || 0 : 0, by = bake ? +bake.y || 0 : 0;
    d.layers[nn] = d.layers[n].map(loop => { const a = loop.map(p => ({ x: p.x + bx, y: p.y + by })); a.closed = loop.closed; a.name = loop.name; return a; });
    const at = d.order.indexOf(n); if (at >= 0) d.order.splice(at + 1, 0, nn); else d.order.push(nn);
    return nn;
  }
  function dxfUndo() {
    const d = state.dxf; if (!d.undo.length) { flashDxf('Nichts rückgängig zu machen.'); return; }
    d.redo.push(dxfSnap(d)); dxfApplySnap(d.undo.pop());
    d.edit.sel = []; d.edit.draft = null; d.edit.drag = null; d.pick = null;
    dxfResolve(); App.buildSidebar(); renderDxf(); App.render();
  }
  function dxfRedo() {
    const d = state.dxf; if (!d.redo.length) return;
    d.undo.push(dxfSnap(d)); dxfApplySnap(d.redo.pop());
    d.edit.sel = []; d.edit.draft = null; d.edit.drag = null;
    dxfResolve(); App.buildSidebar(); renderDxf(); App.render();
  }

  function dxfEditDown(ev) {
    const d = state.dxf, ed = d.edit; if (!ed.on || !dxfDraw) return;
    ev.preventDefault(); ev.stopPropagation();
    // Mittlere Maustaste (Mausrad) = Ansicht verschieben, unabhängig vom Werkzeug.
    if (ev.button === 1) { ed.pan = { px: ev.clientX, py: ev.clientY, ox: App.nav.dxf.ox, oy: App.nav.dxf.oy }; return; }
    if (ev.button !== 0) return;
    const wpt = dxfWorld(ev); if (!wpt) return;
    const active = ed.active || d.innerName || (d.order[0]);
    switch (ed.tool) {
      case 'select': {
        const h = dxfHitEntity(wpt, 8);
        if (h) {
          const key = h.layer + ':' + h.idx;
          const has = ed.sel.some(s => s.layer + ':' + s.idx === key);
          if (ev.shiftKey) { if (has) ed.sel = ed.sel.filter(s => s.layer + ':' + s.idx !== key); else ed.sel.push({ layer: h.layer, idx: h.idx }); }
          else if (!has) ed.sel = [{ layer: h.layer, idx: h.idx }];
          ed.drag = null;   // Auswahl per Klick; Objekte NICHT per Maus verschieben (nur über die Verschieben-Funktion)
        } else { if (!ev.shiftKey) ed.sel = []; ed.drag = null; }
        App.buildSidebar();   // „Verbinden"-Button / Auswahlzähler aktuell halten
        break;
      }
      case 'vertex': {
        const vr = dxfNearestVertexRef(wpt, 12);
        if (vr) ed.drag = { mode: 'vertex', ref: vr };
        break;
      }
      case 'line': case 'rect': case 'circle': case 'ellipse': case 'polyline': case 'move': case 'copy': case 'mirror':
        dxfToolPoint(wpt); return;
      case 'trim': { dxfTrimAt(wpt); return; }
      case 'erase': { const h = dxfHitEntity(wpt, 8); if (h) { dxfPushUndo(); state.dxf.layers[h.layer].splice(h.idx, 1); ed.sel = []; dxfAfterEdit(); } return; }
      case 'delpt': {
        const vr = dxfNearestVertexRef(wpt, 12); if (!vr) return;
        const loop = dxfLoopOf(vr); const minPts = loop && loop.closed ? 3 : 2;
        if (loop && loop.length > minPts) { dxfPushUndo(); loop.splice(vr.vi, 1); dxfAfterEdit(); }
        else flashDxf('Zu wenige Punkte zum Löschen.');
        return;
      }
    }
    renderDxf();
  }
  // Setzt EINEN Punkt für die punktbasierten Werkzeuge (Maus ODER Tastatureingabe).
  function dxfToolPoint(wpt) {
    const d = state.dxf, ed = d.edit;
    const active = ed.active || d.innerName || d.order[0];
    switch (ed.tool) {
      case 'line': if (!ed.draft) ed.draft = { type: 'line', p0: wpt }; else { dxfPushUndo(); dxfAddEntity(active, mkLoopLocal([ed.draft.p0, wpt], false)); ed.draft = null; dxfAfterEdit(); return; } break;
      case 'rect': if (!ed.draft) ed.draft = { type: 'rect', p0: wpt }; else {
        const a = ed.draft.p0, c = wpt; dxfPushUndo();
        dxfAddEntity(active, mkLoopLocal([{ x: a.x, y: a.y }, { x: c.x, y: a.y }, { x: c.x, y: c.y }, { x: a.x, y: c.y }], true));
        ed.draft = null; dxfAfterEdit(); return;
      } break;
      case 'circle': if (!ed.draft) ed.draft = { type: 'circle', c: wpt }; else {
        const rr = Math.hypot(wpt.x - ed.draft.c.x, wpt.y - ed.draft.c.y), pts = [];
        const steps = Math.max(24, Math.ceil(rr / 2));
        for (let k = 0; k < steps; k++) { const a = 2 * Math.PI * k / steps; pts.push({ x: ed.draft.c.x + rr * Math.cos(a), y: ed.draft.c.y + rr * Math.sin(a) }); }
        dxfPushUndo(); dxfAddEntity(active, mkLoopLocal(pts, true)); ed.draft = null; dxfAfterEdit(); return;
      } break;
      case 'ellipse': if (!ed.draft) ed.draft = { type: 'ellipse', p0: wpt }; else {
        const a = ed.draft.p0, c = wpt, cx = (a.x + c.x) / 2, cy = (a.y + c.y) / 2;
        const rx = Math.abs(c.x - a.x) / 2, ry = Math.abs(c.y - a.y) / 2;
        if (rx < 1e-6 || ry < 1e-6) { ed.draft = null; renderDxf(); return; }
        const steps = Math.max(32, Math.ceil(Math.max(rx, ry) / 1.5)), pts = [];
        for (let k = 0; k < steps; k++) { const t = 2 * Math.PI * k / steps; pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) }); }
        dxfPushUndo(); dxfAddEntity(active, mkLoopLocal(pts, true)); ed.draft = null; dxfAfterEdit(); return;
      } break;
      case 'mirror': {
        if (!ed.sel.length) { flashDxf('Erst mit „Auswählen" Konturen wählen.'); return; }
        if (!ed.draft) ed.draft = { type: 'mirror', p1: wpt };
        else { dxfPushUndo(); dxfMirrorSelection(ed.draft.p1, wpt); ed.draft = null; dxfAfterEdit(); return; }
        break;
      }
      case 'polyline': {
        if (!ed.draft) ed.draft = { type: 'poly', pts: [] };
        if (ed.draft.pts.length >= 2 && dxfDraw) {
          const p0 = ed.draft.pts[0], V = dxfDraw.V;
          if (Math.hypot(V.X(p0.x) - V.X(wpt.x), V.Y(p0.y) - V.Y(wpt.y)) < 10) { dxfFinishPolyline(true); return; }
        }
        ed.draft.pts.push(wpt); break;
      }
      case 'move': case 'copy': {
        if (!ed.sel.length) { flashDxf('Erst mit „Auswählen" Konturen wählen.'); return; }
        if (!ed.draft) ed.draft = { type: 'move', base: wpt, copy: ed.tool === 'copy' };
        else { dxfPushUndo(); dxfTranslateSelection(wpt.x - ed.draft.base.x, wpt.y - ed.draft.base.y, ed.draft.copy); ed.draft = null; dxfAfterEdit(); return; }
        break;
      }
    }
    renderDxf();
  }
  // Koordinaten-Eingabe: absolut „x,y" · relativ „@dx,dy" · polar „Länge<Winkel".
  function dxfCoordApply(str) {
    const ed = state.dxf.edit; if (!ed.on) return;
    const s = (str || '').trim().replace(',', ' ').replace(/\s+/g, ' ');
    if (!s) return;
    const ref = dxfDraftRef() || { x: 0, y: 0 };
    let pt = null;
    let m;
    if ((m = s.match(/^@\s*(-?\d*\.?\d+)\s+(-?\d*\.?\d+)$/))) pt = { x: ref.x + parseFloat(m[1]), y: ref.y + parseFloat(m[2]) };
    else if ((m = s.match(/^(-?\d*\.?\d+)\s*<\s*(-?\d*\.?\d+)$/))) { const L = parseFloat(m[1]), a = parseFloat(m[2]) * Math.PI / 180; pt = { x: ref.x + L * Math.cos(a), y: ref.y + L * Math.sin(a) }; }
    else if ((m = s.match(/^(-?\d*\.?\d+)\s+(-?\d*\.?\d+)$/))) pt = { x: parseFloat(m[1]), y: parseFloat(m[2]) };
    if (!pt) { flashDxf('Eingabe: x,y  ·  @dx,dy  ·  Länge<Winkel'); return; }
    dxfToolPoint(pt);
  }
  function dxfEditMove(ev) {
    const ed = state.dxf.edit; if (!ed.on || !dxfDraw) return;
    if (ed.pan) { App.nav.dxf.ox = ed.pan.ox + (ev.clientX - ed.pan.px); App.nav.dxf.oy = ed.pan.oy + (ev.clientY - ed.pan.py); renderDxf(); return; }
    const wpt = dxfWorld(ev); if (!wpt) return;
    ed.hover = wpt;
    if (ed.drag) {
      if (!ed.drag.moved) dxfPushUndo();   // erster echter Zug -> ein Undo-Schritt
      if (ed.drag.mode === 'move') { dxfTranslateSelection(wpt.x - ed.drag.last.x, wpt.y - ed.drag.last.y, false); ed.drag.last = wpt; ed.drag.moved = true; }
      else if (ed.drag.mode === 'vertex') { const loop = dxfLoopOf(ed.drag.ref); if (loop && loop[ed.drag.ref.vi]) { loop[ed.drag.ref.vi].x = wpt.x; loop[ed.drag.ref.vi].y = wpt.y; } ed.drag.moved = true; }
    }
    renderDxf();
  }
  function dxfEditUp(ev) {
    const ed = state.dxf.edit; if (!ed.on) return;
    if (ed.pan) { ed.pan = null; return; }
    if (ed.drag) { const wasVertex = ed.drag.mode === 'vertex', moved = ed.drag.moved; ed.drag = null; if (wasVertex || moved) dxfAfterEdit(); }
  }
  function dxfFinishPolyline(closed) {
    const ed = state.dxf.edit; if (!ed.draft || ed.draft.type !== 'poly' || ed.draft.pts.length < 2) { ed.draft = null; renderDxf(); return; }
    const active = ed.active || state.dxf.innerName || state.dxf.order[0];
    dxfPushUndo();
    dxfAddEntity(active, mkLoopLocal(ed.draft.pts.map(p => ({ x: p.x, y: p.y })), !!closed));
    ed.draft = null; dxfAfterEdit();
  }
  function dxfTranslateSelection(dx, dy, copy) {
    const d = state.dxf, ed = d.edit;
    if (copy) {
      const newSel = [];
      ed.sel.forEach(s => { const loop = dxfLoopOf(s); if (!loop) return; const cp = mkLoopLocal(loop.map(p => ({ x: p.x + dx, y: p.y + dy })), loop.closed); dxfAddEntity(s.layer, cp); newSel.push({ layer: s.layer, idx: d.layers[s.layer].length - 1 }); });
      // Auswahl NICHT umsetzen (Original bleibt gewählt); Kopie liegt versetzt.
    } else {
      ed.sel.forEach(s => { const loop = dxfLoopOf(s); if (!loop) return; loop.forEach(p => { p.x += dx; p.y += dy; }); });
    }
  }
  // Spiegeln: gewählte Konturen an der Achse p1→p2 gespiegelt kopieren. Die
  // Originale bleiben erhalten (wie AutoCAD „Spiegeln" mit „Original behalten").
  function dxfMirrorSelection(p1, p2) {
    const d = state.dxf, ed = d.edit;
    const dx = p2.x - p1.x, dy = p2.y - p1.y, L2 = dx * dx + dy * dy;
    if (L2 < 1e-9) { flashDxf('Spiegelachse zu kurz.'); return; }
    const refl = p => {   // Punkt an der Geraden durch p1 mit Richtung (dx,dy) spiegeln
      const t = ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / L2;
      const fx = p1.x + t * dx, fy = p1.y + t * dy;
      return { x: 2 * fx - p.x, y: 2 * fy - p.y };
    };
    ed.sel.forEach(s => {
      const loop = dxfLoopOf(s); if (!loop) return;
      // Spiegelung kehrt den Umlaufsinn um -> Reihenfolge umdrehen, damit die
      // Kontur konsistent bleibt.
      const cp = mkLoopLocal(loop.map(refl).reverse(), loop.closed);
      dxfAddEntity(s.layer, cp);
    });
  }
  // Punkt an kumulativer Position (Segmentindex + t) einer Kontur.
  function dxfPosPoint(loop, pos) {
    const n = loop.length, i = ((Math.floor(pos) % n) + n) % n, t = pos - Math.floor(pos);
    const a = loop[i], b = loop[(i + 1) % n];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  // Teilpfad von fromPos bis toPos (vorwärts, Index mod n; toPos darf > n für Umlauf sein).
  function dxfLoopSub(loop, fromPos, toPos) {
    const n = loop.length, pts = [dxfPosPoint(loop, ((fromPos % n) + n) % n)];
    let i = Math.floor(fromPos) + 1, guard = 0;
    while (i < toPos - 1e-9 && guard++ < n + 4) { const vi = ((i % n) + n) % n; pts.push({ x: loop[vi].x, y: loop[vi].y }); i++; }
    pts.push(dxfPosPoint(loop, ((toPos % n) + n) % n));
    return pts;
  }
  /* Trimmen: der angeklickte Teil einer Kontur wird bis zur nächsten Kreuzung
   * mit einer ANDEREN Kontur entfernt. Kumulative Position = Segmentindex + t. */
  function dxfTrimAt(wpt) {
    const h = dxfHitEntity(wpt, 10); if (!h) { flashDxf('Keine Kontur getroffen.'); return; }
    const loop = dxfLoopOf(h); if (!loop || loop.length < 2) return;
    const n = loop.length, closed = !!loop.closed, last = closed ? n : n - 1;
    // Kreuzungspositionen (auf DIESER Kontur) mit allen anderen sammeln.
    const cutPos = [];
    dxfEntities().forEach(e => {
      if (e.layer === h.layer && e.idx === h.idx) return;
      const m = e.loop.length, mlast = e.loop.closed ? m : m - 1;
      for (let i = 0; i < last; i++) {
        const a = loop[i], b = loop[(i + 1) % n];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        for (let j = 0; j < mlast; j++) {
          const X = HotWire.segX(a, b, e.loop[j], e.loop[(j + 1) % m]); if (!X) continue;
          const t = Math.max(0, Math.min(1, Math.hypot(X.x - a.x, X.y - a.y) / segLen));
          cutPos.push(i + t);
        }
      }
    });
    if (!cutPos.length) { flashDxf('Keine Kreuzung gefunden — nichts getrimmt.'); return; }
    dxfPushUndo();
    cutPos.sort((x, y) => x - y);
    const cp = h.seg + h.t;
    let a = null, b = null;
    for (const q of cutPos) { if (q < cp - 1e-9) a = q; if (q > cp + 1e-9 && b === null) b = q; }
    const arr = state.dxf.layers[h.layer];
    if (closed) {
      if (a === null) a = cutPos[cutPos.length - 1];
      if (b === null) b = cutPos[0];
      // Behalten = Komplement des angeklickten Bogens: von b vorwärts (ggf. mit Umlauf) bis a.
      const keepTo = a > b ? a : a + n;
      const keep = dxfLoopSub(loop, b, keepTo);
      if (keep.length < 2) { flashDxf('Trimmen nicht eindeutig.'); return; }
      arr[h.idx] = mkLoopLocal(keep, false);
    } else {
      const parts = [];
      if (a !== null) { const p1 = dxfLoopSub(loop, 0, a); if (p1.length >= 2) parts.push(mkLoopLocal(p1, false)); }
      if (b !== null) { const p2 = dxfLoopSub(loop, b, last); if (p2.length >= 2) parts.push(mkLoopLocal(p2, false)); }
      if (!parts.length) { flashDxf('Trimmen nicht möglich (Klick liegt außerhalb der Kreuzungen).'); return; }
      arr.splice(h.idx, 1, ...parts);
    }
    state.dxf.edit.sel = [];
    dxfAfterEdit();
  }
  /* Verbinden: ausgewählte offene Linien/Polylinien mit zusammenfallenden
   * Endpunkten zu Ketten zusammenfügen (schließt sich der Zug -> geschlossen). */
  function dxfJoinSelection() {
    const d = state.dxf, ed = d.edit;
    if (ed.sel.length < 2) { flashDxf('Mindestens zwei Konturen auswählen (Werkzeug „Auswählen").'); return; }
    const items = ed.sel.map(r => ({ r, loop: dxfLoopOf(r) })).filter(x => x.loop);
    if (items.length < 2) return;
    dxfPushUndo();
    const tol = (dxfDraw && dxfDraw.V) ? Math.max(0.05, 5 / dxfDraw.V.s) : 0.5;
    const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;
    const closedKeep = [];
    let open = [];
    items.forEach(x => { if (x.loop.closed) closedKeep.push(x.loop.map(p => ({ x: p.x, y: p.y }))); else open.push(x.loop.map(p => ({ x: p.x, y: p.y }))); });
    const result = [];
    let guard = 0;
    while (open.length && guard++ < 10000) {
      let cur = open.shift(), merged = true;
      while (merged) {
        merged = false;
        for (let k = 0; k < open.length; k++) {
          const o = open[k], ce = cur[cur.length - 1], cs = cur[0];
          if (near(ce, o[0])) cur = cur.concat(o.slice(1));
          else if (near(ce, o[o.length - 1])) cur = cur.concat(o.slice(0, -1).reverse());
          else if (near(cs, o[o.length - 1])) cur = o.slice(0, -1).concat(cur);
          else if (near(cs, o[0])) cur = o.slice().reverse().slice(0, -1).concat(cur);
          else continue;
          open.splice(k, 1); merged = true; break;
        }
      }
      const isClosed = cur.length > 2 && near(cur[0], cur[cur.length - 1]);
      if (isClosed) cur = cur.slice(0, -1);
      result.push(mkLoopLocal(cur, isClosed));
    }
    // Ausgewählte Originale entfernen (Indizes je Layer absteigend), dann Ergebnis ablegen.
    const byLayer = {}; ed.sel.forEach(r => { (byLayer[r.layer] = byLayer[r.layer] || []).push(r.idx); });
    Object.keys(byLayer).forEach(L => byLayer[L].sort((x, y) => y - x).forEach(idx => d.layers[L] && d.layers[L].splice(idx, 1)));
    const active = ed.active || ed.sel[0].layer;
    result.forEach(L => dxfAddEntity(active, L));
    closedKeep.forEach(pts => dxfAddEntity(active, mkLoopLocal(pts, true)));
    ed.sel = [];
    dxfAfterEdit();
    flashDxf('Verbunden: ' + result.length + ' Kette(n)' + (result.some(l => l.closed) ? ' (geschlossen)' : '') + '.');
  }
  function mkLoopLocal(pts, closed) { const a = pts.map(p => ({ x: p.x, y: p.y })); a.closed = !!closed; return a; }
  let dxfFlashT = 0;
  function flashDxf(msg) {
    const info = document.getElementById('dxfInfo'); if (!info) return;
    info.innerHTML = '<div style="color:#ffd27f">' + msg + '</div>';
    clearTimeout(dxfFlashT); dxfFlashT = setTimeout(renderDxf, 1800);
  }

  /* Projektion der DXF-Form auf die beiden Turmebenen (wie HotWire.project,
   * aber aus zwei fertigen synchronen Konturen). INNEN = Wurzelseite. */
  // Abbrand-Versatz für die beiden DXF-Bahnen (INNEN=root, AUSSEN=tip).
  // 'ratio'/flach: ein konstanter Versatz (currentKerf/2) auf beide Seiten.
  // 'speed': je Schnittsegment aus der Bahngeschwindigkeit — die LÄNGERE Seite
  //   läuft mit vollem Vorschub (schmaler Spalt), die kürzere langsamer (breiter).
  //   Wechselt die längere/kürzere Seite während des Schnitts von INNEN nach
  //   AUSSEN, folgt der Versatz dem Segment für Segment. Erwartet OFFENE Pfade
  //   (Schließzug wird nicht geschnitten). Gibt neue Punktarrays zurück.
  function dxfApplyKerf(rootPath, tipPath) {
    const DL = { deloop: true };   // Mini-Schlaufen an konkaven Ecken auflösen
    if ((state.dxf.kerfMode || 'ratio') === 'speed') {   // eigene Abbrand-Berechnung der DXF-Formen
      const kp = App.kerfPair(App.matIdFor('dxf')), fp = App.feedPair(App.matIdFor('dxf'));
      const cal = { kerfSlow: kp.slow, kerfFast: kp.fast, feedSlow: fp.slow, feedFast: fp.fast, feed: App.currentFeed() };
      const sg = HotWire.speedGaps(rootPath, tipPath, cal);
      return { root: HotWire.offsetPath(rootPath, sg.gapR, null, DL),
               tip: HotWire.offsetPath(tipPath, sg.gapT, null, DL), info: sg.info };
    }
    const k = (App.currentKerf() || 0) / 2;
    if (k > 0) return { root: HotWire.offsetPath(rootPath, k, null, DL),
                        tip: HotWire.offsetPath(tipPath, k, null, DL), info: null };
    return { root: rootPath, tip: tipPath, info: null };
  }

  function dxfProjection() {
    const d = state.dxf; const synced = dxfSynced(); if (!synced) return null;
    let rootPath = synced.inner.map(p => ({ x: p.x, y: p.y }));
    let tipPath = synced.outer.map(p => ({ x: p.x, y: p.y }));
    // Sichere Anfahrt/Ausfahrt: Der Draht fährt vom Maschinennullpunkt (hinten,
    // größtes X) waagrecht ans Werkstück. Damit diese waagrechte An-/Abfahrt die
    // Kontur NICHT kreuzt, beginnt der Schnitt am HINTERSTEN Punkt (max X) — dort
    // trifft die Anfahrt die Kontur zuerst. Reine zyklische Verschiebung der
    // geschlossenen Bahn -> die geschnittene Form bleibt identisch.
    if (d.safeLead && rootPath.length > 2) {
      let r = 0, best = -1e9;
      for (let i = 0; i < rootPath.length; i++) { const s = rootPath[i].x + tipPath[i].x; if (s > best) { best = s; r = i; } }
      if (r > 0) {
        // Der Schließpunkt (letzter = erster Punkt) darf beim Drehen nicht in die
        // Mitte wandern: dort entstünde ein Nulllängen-Segment (Abbrand-Ausreißer,
        // Schlaufe im G-Code) und der Pfad wäre nicht mehr als geschlossen erkennbar
        // (Start/Ende verschieden versetzt). Deshalb Duplikat entfernen, drehen,
        // Startpunkt wieder ans Ende hängen.
        const nr = rootPath.length;
        const dup = nr > 3 && Math.hypot(rootPath[0].x - rootPath[nr - 1].x, rootPath[0].y - rootPath[nr - 1].y) < 1e-6
                           && Math.hypot(tipPath[0].x - tipPath[nr - 1].x, tipPath[0].y - tipPath[nr - 1].y) < 1e-6;
        if (dup) { rootPath = rootPath.slice(0, -1); tipPath = tipPath.slice(0, -1); }
        rootPath = rootPath.slice(r).concat(rootPath.slice(0, r)); tipPath = tipPath.slice(r).concat(tipPath.slice(0, r));
        if (dup) { rootPath = rootPath.concat([{ x: rootPath[0].x, y: rootPath[0].y }]); tipPath = tipPath.concat([{ x: tipPath[0].x, y: tipPath[0].y }]); }
      }
    }
    // Ein eingefrorener Schneidepfad (pathEdit) enthält den Abbrand bereits —
    // nicht erneut versetzen. Sonst Abbrand wie gehabt anwenden.
    if (d.kerf && !d.pathEdit) {
      const kk = dxfApplyKerf(rootPath, tipPath); rootPath = kk.root; tipPath = kk.tip;
    }
    rootPath = rootPath.concat([{ x: rootPath[0].x, y: rootPath[0].y }]);   // Schleife schließen
    tipPath = tipPath.concat([{ x: tipPath[0].x, y: tipPath[0].y }]);
    const mw = state.cfg.machineWidth, mirror = state.cfg.side === 'left';
    const bz = App.effBlockZ(d.span);
    const zRoot = mirror ? mw - bz : bz;
    const zTip = mirror ? zRoot - d.span : zRoot + d.span;
    const pr = (vr, vt, zp) => vr + (zp - zRoot) / ((zTip - zRoot) || 1) * (vt - vr);
    const n = Math.min(rootPath.length, tipPath.length);
    const left = [], right = [];
    let maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (let i = 0; i < n; i++) {
      const rp = rootPath[i], tp = tipPath[i];
      left.push({ x: pr(rp.x, tp.x, 0), y: pr(rp.y, tp.y, 0) });
      right.push({ x: pr(rp.x, tp.x, mw), y: pr(rp.y, tp.y, mw) });
      [rp, tp].forEach(p => { if (p.x > maxx) maxx = p.x; if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y; });
    }
    const origin = { x: maxx + (state.cfg.blockX || 0), y: miny - (state.cfg.blockY || 0) };
    return { left, right, rootPath, tipPath, zRoot, zTip, origin, maxy, miny };
  }
  // dxfGcode() (G-Code aus INNEN/AUSSEN) liegt in gcodegen.js (Funktion „G-Code-Erzeugung", abwählbar).
  // 3D-Szene für die Simulation: ein Block, der beide Formen umschließt.
  function buildDxfScene() {
    const P = dxfProjection();
    const y0 = (state.cfg.blockY || 0);
    if (!P) return { machineWidth: state.cfg.machineWidth, ax: { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV }, blocks: [], defaultSeg: 0, limits: {} };
    // Rohmaß aus Welt-Bounds beider Bahnen + Zugaben bzw. festen Blockmaßen X/Y.
    let gminx = 1e9, gmaxx = -1e9, gminy = 1e9, gmaxy = -1e9;
    const acc = p => { if (p.x < gminx) gminx = p.x; if (p.x > gmaxx) gmaxx = p.x; if (p.y < gminy) gminy = p.y; if (p.y > gmaxy) gmaxy = p.y; };
    P.rootPath.forEach(acc); P.tipPath.forEach(acc);
    const br = dxfBlockRect({ minx: gminx, miny: gminy, maxx: gmaxx, maxy: gmaxy });
    const y1 = y0 + (br.maxy - br.miny);
    // X in Maschinenkoordinaten (origin.x − Welt-x); Block umschließt beide Konturen.
    const bxMin = P.origin.x - br.maxx, bxMax = P.origin.x - br.minx;
    return {
      machineWidth: state.cfg.machineWidth,
      ax: { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV },
      blocks: [{ seg: 0, x0: bxMin, x1: bxMax, y0, y1, x0t: bxMin, x1t: bxMax, y0t: y0, y1t: y1,
        z0: P.zRoot, z1: P.zTip, cutZ0: P.zRoot, cutZ1: P.zTip }],
      defaultSeg: 0,
      limits: App.machineLimits()
    };
  }

  // ---------- DXF-Export (eigener) ------------------------------------
  /* Baut aus der aktuellen Tragfläche die ausgewählten Geometrien als benannte
   * DXF-Layer. Rückgabe: [{ name, color, polys }] für Dxf.write.
   *   Grundriss  : Draufsicht-Umriss (X=Spannweite, Y=−Sehne).
   *   Profile    : je Station ein Layer — real (mit Pfeilung/V-Form) oder auf
   *                die Sehne gestapelt (LE bei X=0).
   *   Werkstück  : Schneidepfad in der Profilebene (root/tip) je Segment.
   *   Turm       : Schneidepfad in der linken/rechten Turmebene je Segment.
   *   Ebenen     : Kern (Profilschnitt) und/oder Negativschale.
   * Alle Konturen behalten ihre echten mm-Koordinaten; die Layer trennen die
   * Inhalte (in CAD ein-/ausblendbar). */
  function dxfExportSegList() {
    const e = state.dxfExport, n = state.segments.length;
    if (!e.segs) return Array.from({ length: n }, (_, k) => k);
    return e.segs.filter(k => k >= 0 && k < n);
  }
  const dxfExportClose = pts => {   // geschlossene Kontur (Schließpunkt entfernen)
    if (pts.length > 2) { const a = pts[0], b = pts[pts.length - 1];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) return pts.slice(0, -1); }
    return pts;
  };

  /* Baut eine Bemaßung (Maßlinie mit Maßhilfslinien, Pfeilen und Maßtext) in
   * Modellkoordinaten zwischen a und b, um `off` mm senkrecht versetzt. Hängt die
   * Linien an `polys` und den Text an `texts` (für den Bemaßungs-Layer). */
  function dxfExportDim(polys, texts, a, b, off, label, h) {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;                    // Normale
    const ux = dx / len, uy = dy / len;                     // Richtung a->b
    const a2 = { x: a.x + nx * off, y: a.y + ny * off };
    const b2 = { x: b.x + nx * off, y: b.y + ny * off };
    const ov = Math.sign(off || 1) * h * 0.6;               // Maßhilfslinien-Überstand
    polys.push({ pts: [a, { x: a2.x + nx * ov, y: a2.y + ny * ov }], closed: false });
    polys.push({ pts: [b, { x: b2.x + nx * ov, y: b2.y + ny * ov }], closed: false });
    polys.push({ pts: [a2, b2], closed: false });           // Maßlinie
    // Pfeilspitzen (offene Winkel) an beiden Enden.
    const aw = h * 0.9, ca = Math.cos(0.35), sa = Math.sin(0.35);
    const arrowWing = (tip, dirx, diry) => {
      const r1x = dirx * ca - diry * sa, r1y = dirx * sa + diry * ca;
      const r2x = dirx * ca + diry * sa, r2y = -dirx * sa + diry * ca;
      polys.push({ pts: [tip, { x: tip.x + r1x * aw, y: tip.y + r1y * aw }], closed: false });
      polys.push({ pts: [tip, { x: tip.x + r2x * aw, y: tip.y + r2y * aw }], closed: false });
    };
    arrowWing(a2, ux, uy); arrowWing(b2, -ux, -uy);
    // Maßtext mittig, leicht neben die Maßlinie, lesbar ausgerichtet.
    let rot = Math.atan2(dy, dx) * 180 / Math.PI;
    if (rot > 90) rot -= 180; else if (rot < -90) rot += 180;
    const tOff = h * 0.8;
    texts.push({ x: (a2.x + b2.x) / 2 + nx * tOff, y: (a2.y + b2.y) / 2 + ny * tOff,
                 h, text: label, rot });
  }

  /* Zerlegt einen erzeugten G-Code in die TATSÄCHLICH gefahrenen Bahnen — das
   * ist der Weg, den die Maschine fährt bzw. der Draht schneidet (inkl. Anfahrt,
   * Ein-/Auslauf, Block-/Schalenschnitte), NICHT nur die Nennkontur. Rückgabe in
   * Maschinenkoordinaten:
   *   left/right  : Bahn des linken (X/Y) bzw. rechten (U/V) Turms.
   *   workRoot/workTip : Drahtbahn in der Werkstück-Wurzel-/Randebene (zwischen
   *                 den Türmen linear interpoliert) — der Schnitt am Werkstück. */
  function dxfExportParsePath(gtext, ax, zRoot, zTip, mw) {
    const letters = [ax.x, ax.y, ax.u, ax.v], keys = ['x', 'y', 'u', 'v'];
    const rx = letters.map(a => new RegExp('(?:^|\\s)' + a + '(-?\\d+(?:\\.\\d+)?)'));
    const cur = { x: 0, y: 0, u: 0, v: 0 };
    const left = [], right = [], workRoot = [], workTip = [];
    const fr0 = mw ? zRoot / mw : 0, fr1 = mw ? zTip / mw : 0;
    const push = (arr, p) => { const q = arr[arr.length - 1]; if (!q || Math.hypot(q.x - p.x, q.y - p.y) > 1e-6) arr.push(p); };
    gtext.split(/\r\n|\n/).forEach(line => {
      if (!/^\s*G[0-3]\b/.test(line)) return;                 // nur Bewegungszeilen
      let moved = false;
      for (let i = 0; i < 4; i++) { const m = line.match(rx[i]); if (m) { cur[keys[i]] = parseFloat(m[1]); moved = true; } }
      if (!moved) return;
      const lx = cur.x, ly = cur.y, rx2 = cur.u, ry = cur.v;
      push(left, { x: lx, y: ly }); push(right, { x: rx2, y: ry });
      push(workRoot, { x: lx + fr0 * (rx2 - lx), y: ly + fr0 * (ry - ly) });
      push(workTip, { x: lx + fr1 * (rx2 - lx), y: ly + fr1 * (ry - ly) });
    });
    return { left, right, workRoot, workTip };
  }

  /* Zusatzgeometrie einer Rippe (Station i) im übergebenen (bereits transformierten)
   * Punkte-Frame: aktive Holmausschnitte (Polygon + Anfahrt) und, falls Beplankung
   * gesetzt, die nach innen versetzte Kernkontur. Rückgabe: { spars, leads, sheet }
   * als Poly-Listen. */
  function dxfExportRibExtras(pts, i) {
    const out = { spars: [], leads: [], sheet: [] }, ex = state.dxfExport;
    // Beplankung: Profil um die Beplankungsstärke nach innen versetzt (Kernkontur).
    // Station i ist Wurzelrippe von Segment i (bzw. Außenrippe des letzten Segments).
    const ns = state.segments.length;
    const sf = i <= ns - 1 ? App.sheetFor(state.segments[i]).root
                           : App.sheetFor(state.segments[ns - 1]).tip;
    if (ex.beplankung && App.sheetActive({ root: sf, tip: sf })) {
      const inner = Airfoil.resample(HotWire.trimTE(HotWire.offsetPathTB(pts, sf.top, sf.bot)), pts.length);
      if (inner && inner.length > 2) out.sheet.push({ pts: inner.map(p => ({ x: p.x, y: p.y })), closed: true });
    }
    // Aktive Holme, die diese Rippe betreffen. Station i ist Außenrippe von Segment
    // i−1 UND Wurzelrippe von Segment i — je Holm die passende Seite wählen.
    const n = state.segments.length;
    if (ex.holme) (state.spars || []).forEach(sp => {
      let segIdx = null, which = null;
      if (i - 1 >= 0 && sparAppliesTo(sp, i - 1)) { segIdx = i - 1; which = 'tip'; }
      else if (i <= n - 1 && sparAppliesTo(sp, i)) { segIdx = i; which = 'root'; }
      if (segIdx == null) return;
      const g = sparOnProfile(sp, pts, null, sparFromLE(sp, segIdx, which), null, which, App.sparCoreOf(pts, segIdx, which));
      if (!g) return;
      sparPolys(g).forEach(pl => out.spars.push({ pts: pl.map(p => ({ x: p.x, y: p.y })), closed: true }));
      if (g.lead) out.leads.push({ pts: g.lead.map(p => ({ x: p.x, y: p.y })), closed: false });
    });
    return out;
  }

  function buildDxfExportLayers() {
    if (!App.wing || !App.wing.cuts || !App.wing.cuts.length) return [];
    const e = state.dxfExport, layers = [];
    const seg1 = k => 'S' + (k + 1);
    const AX = { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV };
    const mw = state.cfg.machineWidth;

    // Jeder Export ist ein „Block". Blöcke werden am Ende NEBENEINANDER angeordnet
    // (dxfExportLayoutRow); INNERHALB eines Blocks bleibt die Geometrie (und damit
    // die Lage der Profile zueinander) unverändert. put() hängt einen Layer an
    // seinen Block.
    const put = (block, name, color, polys, texts) => { layers.push({ _block: block, name, color, polys, texts }); };

    // --- Grundriss (Draufsicht) -------------------------------------
    if (e.grundriss && App.wing.stations && App.wing.stations.length) {
      const leTe = App.wing.stations.map(s => {
        const xs = s.pts.map(p => p.x);
        return { z: s.z, le: Math.min.apply(null, xs), te: Math.max.apply(null, xs) };
      });
      const outline = [];
      leTe.forEach(s => outline.push({ x: s.z, y: -s.le }));
      for (let i = leTe.length - 1; i >= 0; i--) outline.push({ x: leTe[i].z, y: -leTe[i].te });
      put('grundriss', 'GRUNDRISS', 7, [{ pts: outline, closed: true }]);

      // Lage der Profile (Rippen): je Station eine Sehnenlinie von LE zu TE.
      put('grundriss', 'GRUNDRISS_PROFILLAGE', 8, leTe.map(s => ({ pts: [{ x: s.z, y: -s.le }, { x: s.z, y: -s.te }], closed: false })));

      // Scharnierlinie (Ruderscharnier): je Segment von der Wurzel- zur Außenlage
      // (Prozent der jeweiligen Sehne, von der Endleiste gemessen).
      const hx = (s, pct) => s.te - Math.max(0, Math.min(100, pct)) / 100 * (s.te - s.le);
      const hinge = [];
      for (let k = 0; k < leTe.length - 1; k++) {
        const sg = state.segments[k]; if (!sg) continue;
        const pr = sg.hingePct, pt = sg.hingePctTip;
        if (pr == null && pt == null) continue;
        hinge.push({ pts: [{ x: leTe[k].z, y: -hx(leTe[k], pr != null ? pr : pt) },
                           { x: leTe[k + 1].z, y: -hx(leTe[k + 1], pt != null ? pt : pr) }], closed: false });
      }
      if (hinge.length) put('grundriss', 'GRUNDRISS_SCHARNIERLINIE', 6, hinge);

      // Holmausschnitte im Grundriss: je Segment ein Band (Sehnen-Fußabdruck von
      // Wurzel- zur Außenlage) plus Mittellinie — wie in der Draufsicht.
      const st = App.wing.stations;
      const xr = pl => { let mn = Infinity, mx = -Infinity; pl.forEach(p => { mn = Math.min(mn, p.x); mx = Math.max(mx, p.x); }); return { min: mn, max: mx, c: (mn + mx) / 2 }; };
      const sparBands = [], sparMid = [];
      if (e.holme) (state.spars || []).forEach(sp => {
        const [ra, rb] = sparRange(sp);
        for (let k = ra; k <= rb && k < leTe.length - 1; k++) {
          const rpts = st[k] && st[k].pts, tpts = st[k + 1] && st[k + 1].pts;
          if (!rpts || !tpts) continue;
          const zr = leTe[k].z, zt = leTe[k + 1].z, yco = sparYc(sp);
          const gr = sparOnProfile(sp, rpts, null, sparFromLE(sp, k, 'root'), yco, 'root', App.sparCoreOf(rpts, k, 'root'));
          const gt = sparOnProfile(sp, tpts, null, sparFromLE(sp, k, 'tip'), yco, 'tip', App.sparCoreOf(tpts, k, 'tip'));
          if (!gr || !gt) continue;
          const a = xr(gr.poly), b = xr(gt.poly);
          sparBands.push({ pts: [{ x: zr, y: -a.min }, { x: zt, y: -b.min }, { x: zt, y: -b.max }, { x: zr, y: -a.max }], closed: true });
          sparMid.push({ pts: [{ x: zr, y: -a.c }, { x: zt, y: -b.c }], closed: false });
        }
      });
      if (sparBands.length) put('grundriss', 'GRUNDRISS_HOLME', 30, sparBands);
      if (sparMid.length) put('grundriss', 'GRUNDRISS_HOLME_MITTE', 8, sparMid);

      // Bemaßung: Profillängen (Sehnen), Rückpfeilung (LE-Versatz) und Spannweite
      // je Segment — als Maßlinien mit Pfeilen und Maßtext.
      const span = App.wing.totalSpan || 300;
      const off = Math.max(15, 0.045 * span), th = Math.max(5, 0.02 * span);
      const dpolys = [], dtexts = [], mm = v => String(Math.round(v));
      for (let k = 0; k < leTe.length - 1; k++) {
        const a = leTe[k], b = leTe[k + 1];
        if (k === 0)   // Innen-Sehne nur einmal (Folgesegmente teilen sie mit dem Vorsegment)
          dxfExportDim(dpolys, dtexts, { x: a.z, y: -a.le }, { x: a.z, y: -a.te }, -off, mm(a.te - a.le), th);
        dxfExportDim(dpolys, dtexts, { x: b.z, y: -b.le }, { x: b.z, y: -b.te }, off, mm(b.te - b.le), th);
        if (Math.abs(b.le - a.le) > 0.01)
          dxfExportDim(dpolys, dtexts, { x: b.z, y: -a.le }, { x: b.z, y: -b.le }, -2 * off, mm(b.le - a.le), th);
        const yBase = -Math.max(a.te, b.te);
        dxfExportDim(dpolys, dtexts, { x: a.z, y: yBase }, { x: b.z, y: yBase }, -1.2 * off, mm(b.z - a.z), th);
      }
      put('grundriss', 'GRUNDRISS_BEMASSUNG', 2, dpolys, dtexts);
    }

    // --- Aufriss (Vorderansicht: Spannweite × Höhe / V-Form) --------
    if (e.aufriss && App.wing.cuts && App.wing.cuts.length) {
      const panels = [], midlines = [];
      const span = App.wing.totalSpan || 300, th = Math.max(5, 0.02 * span), off = Math.max(15, 0.045 * span);
      const apolys = [], atexts = [];
      // Höhe der SEHNENLINIE (nicht der Profilmitte!) = Mittel aus Nasen- und
      // Endleisten-y. Nur so ergibt die V-Form 0, wenn die Fläche flach ist —
      // die Profilmitte (max+min) würde die Profilwölbung mitzählen.
      const chordY = pts => {
        let le = pts[0], te = pts[0];
        pts.forEach(p => { if (p.x < le.x) le = p; if (p.x > te.x) te = p; });
        return (le.y + te.y) / 2;
      };
      state.segments.forEach((s, k) => {
        const c = App.wing.cuts[Math.min(k, App.wing.cuts.length - 1)];
        const ry = c.root.pts.map(p => p.y), ty = c.tip.pts.map(p => p.y);
        const rTop = Math.max.apply(null, ry), rBot = Math.min.apply(null, ry);
        const tTop = Math.max.apply(null, ty), tBot = Math.min.apply(null, ty);
        const z0 = App.segZ[k].z0, z1 = App.segZ[k].z1;
        const rMid = chordY(c.root.pts), tMid = chordY(c.tip.pts);
        panels.push({ pts: [{ x: z0, y: rTop }, { x: z1, y: tTop }, { x: z1, y: tBot }, { x: z0, y: rBot }], closed: true });
        midlines.push({ pts: [{ x: z0, y: rMid }, { x: z1, y: tMid }], closed: false });
        // V-Form-Angaben: Steighöhe (mm) je Segment als senkrechtes Maß am Außenende
        // und der V-Winkel (°) als Text an der Sehnenlinie.
        const rise = tMid - rMid;
        const ang = Math.atan2(rise, (z1 - z0) || 1) * 180 / Math.PI;
        if (Math.abs(rise) > 0.05)
          dxfExportDim(apolys, atexts, { x: z1, y: rMid }, { x: z1, y: tMid }, off, String(Math.round(rise)), th);
        atexts.push({ x: (z0 + z1) / 2, y: (rMid + tMid) / 2 + th, h: th,
                      text: 'V ' + ang.toFixed(1) + '°', rot: 0 });
      });
      if (panels.length) {
        put('aufriss', 'AUFRISS', 7, panels);
        put('aufriss', 'AUFRISS_SEHNENLINIE', 8, midlines);
        put('aufriss', 'AUFRISS_VFORM', 2, apolys, atexts);
      }
    }

    // --- Profile ----------------------------------------------------
    // Reale Lage: alle Profile ÜBERLAGERT an ihrer echten Position (Pfeilung +
    // V-Form) — die Lage der Profile zueinander bleibt erhalten.
    if (e.profReal && App.wing.stations) {
      const outl = [], spars = [], leads = [], sheet = [];
      App.wing.stations.forEach((s, i) => {
        const dy = s.yRise || 0, pts = dxfExportClose(s.pts).map(p => ({ x: p.x, y: p.y + dy }));
        outl.push({ pts, closed: true });
        const ex = dxfExportRibExtras(pts, i);
        ex.sheet.forEach(p => sheet.push(p)); ex.spars.forEach(p => spars.push(p)); ex.leads.forEach(p => leads.push(p));
      });
      put('prof_real', 'PROFILE_REALE_LAGE', 5, outl);
      if (sheet.length) put('prof_real', 'PROFILE_REALE_LAGE_BEPLANKUNG', 3, sheet);
      if (spars.length) put('prof_real', 'PROFILE_REALE_LAGE_HOLME', 30, spars);
      if (leads.length) put('prof_real', 'PROFILE_REALE_LAGE_HOLM_ANFAHRT', 8, leads);
    }
    // Auf Sehne gestapelt: alle Profile überlagert, LE bei X=0 (Registrierung auf
    // der Sehne) — ebenfalls unveränderte Lage zueinander.
    if (e.profChord && App.wing.stations) {
      const outl = [], spars = [], leads = [], sheet = [];
      App.wing.stations.forEach((s, i) => {
        const c = dxfExportClose(s.pts), minX = Math.min.apply(null, c.map(p => p.x));
        const pts = c.map(p => ({ x: p.x - minX, y: p.y }));
        outl.push({ pts, closed: true });
        const ex = dxfExportRibExtras(pts, i);
        ex.sheet.forEach(p => sheet.push(p)); ex.spars.forEach(p => spars.push(p)); ex.leads.forEach(p => leads.push(p));
      });
      put('prof_chord', 'PROFILE_AUF_SEHNE', 4, outl);
      if (sheet.length) put('prof_chord', 'PROFILE_AUF_SEHNE_BEPLANKUNG', 3, sheet);
      if (spars.length) put('prof_chord', 'PROFILE_AUF_SEHNE_HOLME', 30, spars);
      if (leads.length) put('prof_chord', 'PROFILE_AUF_SEHNE_HOLM_ANFAHRT', 8, leads);
    }

    // --- Schneidepfade je Segment (Kern / Negativ) ------------------
    // Der exportierte Pfad ist die TATSÄCHLICH gefahrene Bahn aus dem G-Code
    // (Anfahrt, Ein-/Auslauf inklusive), in Maschinenkoordinaten. Jedes Segment
    // (je Ebene) ist ein eigener Block -> Segmente liegen nebeneinander.
    const segs = dxfExportSegList();
    const wantWp = e.workpiece, wantTw = e.tower;
    if (wantWp || wantTw) {
      segs.forEach(k => {
        const cut = App.wing.cuts[Math.min(k, App.wing.cuts.length - 1)];
        const seg = state.segments[k];
        if (e.levelCore && App.genOne) {
          const bk = 'kern_' + seg1(k);
          const pr = App.projectCut(cut, seg);
          const tp = dxfExportParsePath(App.genOne(cut, k).text, AX, pr.zRoot, pr.zTip, mw);
          if (wantWp) {
            put(bk, 'KERN_WERKSTUECK_WURZEL_' + seg1(k), 3, [{ pts: tp.workRoot, closed: false }]);
            put(bk, 'KERN_WERKSTUECK_RAND_' + seg1(k), 3, [{ pts: tp.workTip, closed: false }]);
            // Originalprofil + Beplankungslinie (Kernkontur) in derselben Lage zur
            // Schnittspur: Kontur (Schnittkoordinaten) mit demselben Maschinen-
            // Nullpunkt wie der G-Code abbilden (X = o.x − x, Y = y − o.y). Nur
            // ohne Werkstück-Drehung/Stapel, wo pr die Konturen unverändert führt.
            const o = blockOrigin(cut, seg);
            const toM = p => ({ x: App.machX ? App.machX(o, p.x) : o.x - p.x, y: p.y - o.y });   // „von vorne": X = x − o.x
            const overlayOK = !state.cfg.sweepRot && (state.cfg.stackCount | 0) <= 1;
            if (overlayOK && pr.rootProf && pr.tipProf) {
              put(bk, 'KERN_PROFIL_WURZEL_' + seg1(k), 5, [{ pts: pr.rootProf.map(toM), closed: true }]);
              put(bk, 'KERN_PROFIL_RAND_' + seg1(k), 5, [{ pts: pr.tipProf.map(toM), closed: true }]);
            }
            if (overlayOK && pr.rootCore && pr.tipCore && App.sheetActive(App.sheetFor(seg))) {
              put(bk, 'KERN_BEPLANKUNG_WURZEL_' + seg1(k), 4, [{ pts: pr.rootCore.map(toM), closed: true }]);
              put(bk, 'KERN_BEPLANKUNG_RAND_' + seg1(k), 4, [{ pts: pr.tipCore.map(toM), closed: true }]);
            }
          }
          if (wantTw) {
            put(bk, 'KERN_TURM_LINKS_' + seg1(k), 1, [{ pts: tp.left, closed: false }]);
            put(bk, 'KERN_TURM_RECHTS_' + seg1(k), 1, [{ pts: tp.right, closed: false }]);
          }
        }
        // Kern-Stege (Negativdesign): Nennkonturen je Steg, Original- und Schnittlage.
        if (e.stege && App.stegeOn && App.stegeOn()) {
          App.stegeExportLayers(k).forEach(l => put('stege_' + seg1(k), l.name, l.color, l.polys));
        }
        if (e.levelNeg && App.negGcode) {
          const bk = 'neg_' + seg1(k);
          const P = negProjection(k);
          const tp = dxfExportParsePath(App.negGcode(k).text, AX, P.zRoot, P.zTip, P.mw);
          if (wantWp) {
            put(bk, 'NEG_WERKSTUECK_WURZEL_' + seg1(k), 6, [{ pts: tp.workRoot, closed: false }]);
            put(bk, 'NEG_WERKSTUECK_RAND_' + seg1(k), 6, [{ pts: tp.workTip, closed: false }]);
          }
          if (wantTw) {
            put(bk, 'NEG_TURM_LINKS_' + seg1(k), 2, [{ pts: tp.left, closed: false }]);
            put(bk, 'NEG_TURM_RECHTS_' + seg1(k), 2, [{ pts: tp.right, closed: false }]);
          }
        }
      });
    }

    // Anordnung: Aufriss EXAKT über dem Grundriss (X unverändert, nur vertikal
    // versetzt), die Profile darunter; die Schneidepfad-Blöcke nebeneinander
    // rechts daneben. Interne Lage jedes Blocks bleibt unverändert.
    dxfExportLayout(layers, Math.max(50, 0.15 * (App.wing.totalSpan || 300)));
    return layers;
  }

  /* Ordnet die Blöcke (Layer mit gleichem _block) an:
   *   Ansichten (Aufriss, Grundriss, Profile) werden VERTIKAL gestapelt — Aufriss
   *   oben, dann Grundriss, dann die Profile — jeweils mit unveränderter X-Lage,
   *   sodass der Aufriss exakt über dem Grundriss steht.
   *   Alle übrigen Blöcke (Schneidepfade) liegen NEBENEINANDER rechts daneben.
   * Innerhalb eines Blocks wird nichts verschoben (Lage der Profile zueinander
   * bleibt erhalten). */
  function dxfExportLayout(layers, gap) {
    const groups = {}, order = [];
    layers.forEach(l => { const b = l._block || l.name; if (!groups[b]) { groups[b] = []; order.push(b); } groups[b].push(l); });
    const bboxOf = ls => {
      let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
      const s = p => { if (p.x < mnx) mnx = p.x; if (p.y < mny) mny = p.y; if (p.x > mxx) mxx = p.x; if (p.y > mxy) mxy = p.y; };
      ls.forEach(l => { (l.polys || []).forEach(pl => pl.pts.forEach(s)); (l.texts || []).forEach(s); });
      return { mnx, mny, mxx, mxy, ok: mnx <= mxx };
    };
    const shift = (ls, dx, dy) => ls.forEach(l => {
      (l.polys || []).forEach(pl => { pl.pts = pl.pts.map(q => ({ x: q.x + dx, y: q.y + dy })); });
      (l.texts || []).forEach(t => { t.x += dx; t.y += dy; });
    });
    // Ansichten vertikal stapeln (X unverändert -> Aufriss exakt über Grundriss).
    const viewsOrder = ['aufriss', 'grundriss', 'prof_real', 'prof_chord'].filter(b => groups[b]);
    let laneTop = 0, viewsMaxX = -1e9, anyView = false, profTop = null;
    viewsOrder.forEach(b => {
      const bb = bboxOf(groups[b]); if (!bb.ok) return;
      if ((b === 'prof_real' || b === 'prof_chord') && profTop === null) profTop = laneTop;   // Oberkante der Profil-Ablage
      shift(groups[b], 0, laneTop - bb.mxy);
      laneTop -= (bb.mxy - bb.mny) + gap;
      viewsMaxX = Math.max(viewsMaxX, bb.mxx);
      anyView = true;
    });
    // Schneidepfad-Blöcke nebeneinander RECHTS UNTEN — auf Höhe der Profile (bzw.
    // am unteren Ende der Ansichten), mit deutlichem Abstand nach rechts.
    const rowTop = profTop != null ? profTop : (anyView ? laneTop : 0);
    let cx = anyView ? viewsMaxX + gap * 3 : 0;
    order.forEach(b => {
      if (viewsOrder.indexOf(b) >= 0) return;
      const bb = bboxOf(groups[b]); if (!bb.ok) return;
      shift(groups[b], cx - bb.mnx, rowTop - bb.mxy);
      cx += (bb.mxx - bb.mnx) + gap;
    });
  }

  async function dxfExportRun() {
    if (DEMO.blocked()) return;
    const layers = buildDxfExportLayers();
    if (!layers.length) { toast(T('Nichts ausgewählt oder keine Geometrie.')); return; }
    const text = Dxf.write(layers, { precision: state.cfg.precision != null ? state.cfg.precision : 4 });
    // Explorer-Speichern-Dialog, startet im Ordner „DXF exportieren" (Einstellungen).
    const wt = App.wingFileTag ? App.wingFileTag() : '';   // mehrere Tragflächen: Name der aktiven
    await App.exportViaPicker((wt || 'tragflaeche') + '_export.dxf', text, 'application/dxf', 'svDxf');
    const nPolys = layers.reduce((s, l) => s + l.polys.length, 0);
    const info = document.getElementById('dxfExpInfo');
    if (info) info.textContent = T('Exportiert: ') + layers.length + T(' Layer, ') + nPolys + T(' Konturen.');
  }

  function buildDxfExportSidebar(side) {
    const e = state.dxfExport;
    const rd = () => { renderDxfExport(); };

    const gi = App.grp('Inhalte (anhaken)', true, 'dxfexport', { alwaysOpen: true });
    App.hint(gi.body, 'Alles Angehakte kommt in EINE DXF-Datei, jeder Inhalt auf eigenem Layer. '
      + 'In deinem CAD lassen sich die Layer einzeln ein- und ausblenden.');
    App.boolRow(gi.body, 'Tragflächen-Grundriss (mit Profillage, Scharnier, Maßen)', () => e.grundriss, v => { e.grundriss = v; rd(); });
    App.boolRow(gi.body, 'Aufriss (Vorderansicht / V-Form)', () => e.aufriss, v => { e.aufriss = v; rd(); });
    App.boolRow(gi.body, 'Profile — reale Lage', () => e.profReal, v => { e.profReal = v; rd(); });
    App.boolRow(gi.body, 'Profile — auf Sehne gestapelt', () => e.profChord, v => { e.profChord = v; rd(); });
    App.boolRow(gi.body, 'Schneidepfad am Werkstück (je Segment)', () => e.workpiece, v => { e.workpiece = v; rd(); });
    App.boolRow(gi.body, 'Schneidepfad am Turm (je Segment)', () => e.tower, v => { e.tower = v; rd(); });
    App.boolRow(gi.body, 'Holmausschnitte (Grundriss + Profile)', () => e.holme, v => { e.holme = v; rd(); });
    App.boolRow(gi.body, 'Beplankung (Kernkontur in Profilen)', () => e.beplankung, v => { e.beplankung = v; rd(); });
    side.appendChild(gi.g);

    const gl = App.grp('Designebene', true, 'dxfexport');
    App.hint(gl.body, 'Für welche Ebene die Schneidepfade erzeugt werden: Kern (Profilschnitt) '
      + 'und/oder Negativschale. Grundriss und Profile sind ebenenunabhängig.');
    // Schneidepfade entstehen aus dem erzeugten G-Code — ohne die Funktion
    // „G-Code-Erzeugung" (gcodegen.js, Design-Ausgabe) gibt es sie nicht.
    if (App.genOne) App.boolRow(gl.body, 'Kern (Profilschnitt)', () => e.levelCore, v => { e.levelCore = v; rd(); });
    if (App.negGcode) App.boolRow(gl.body, 'Negativschale', () => e.levelNeg, v => { e.levelNeg = v; rd(); });
    if (!App.genOne) App.hint(gl.body, 'Schneidepfade (gefahrene Drahtbahn) sind in dieser Ausgabe nicht enthalten — sie entstehen erst mit der G-Code-Erzeugung.');
    if (App.stegeOn && App.stegeOn())
      App.boolRow(gl.body, 'Kern-Stege (Nennkonturen)', () => e.stege, v => { e.stege = v; rd(); },
        'Je Steg eine geschlossene Nennkontur (Wurzel/Rand): einmal in Originallage (zusammengesetzt) und einmal in Schnittlage (im Block auseinandergerückt).');
    side.appendChild(gl.g);

    const gs = App.grp('Segmente', true, 'dxfexport');
    App.hint(gs.body, 'Welche Segmente exportiert werden (nur für die Schneidepfade). '
      + 'Grundriss und Profile umfassen immer die ganze Tragfläche.');
    const allOn = !e.segs;
    App.boolRow(gs.body, 'Alle Segmente', () => allOn, v => {
      e.segs = v ? null : state.segments.map((_, k) => k);
      App.buildSidebar(); rd();
    });
    if (!allOn) {
      state.segments.forEach((_, k) => {
        App.boolRow(gs.body, 'Segment ' + (k + 1), () => e.segs.indexOf(k) >= 0, v => {
          const i = e.segs.indexOf(k);
          if (v && i < 0) e.segs.push(k);
          else if (!v && i >= 0) e.segs.splice(i, 1);
          rd();
        });
      });
    }
    side.appendChild(gs.g);

    const ge = App.grp('Export', true, 'dxfexport', { alwaysOpen: true });
    const b = document.createElement('button'); b.textContent = T('DXF exportieren');
    b.className = 'primary'; b.onclick = dxfExportRun; DEMO.btn(b); ge.body.appendChild(b);
    if (DEMO.on) App.hint(ge.body, DEMO.msg);
    side.appendChild(ge.g);
  }

  // Vorschau des DXF-Exports: alle ausgewählten Layer in Export-Farben zeichnen.
  function renderDxfExport() {
    const cv = document.getElementById('cExport');
    if (!cv) return;
    const { ctx, w, h } = App.fitCanvas(cv); ctx.clearRect(0, 0, w, h);
    const info = document.getElementById('dxfExpInfo');
    if (!App.wing || !App.wing.cuts || !App.wing.cuts.length) { if (info) info.textContent = T('Keine Tragfläche.'); return; }
    let layers = [];
    try { layers = buildDxfExportLayers(); } catch (err) { if (info) info.textContent = T('Fehler: ') + err.message; return; }
    if (!layers.length) { if (info) info.textContent = T('Nichts ausgewählt.'); return; }
    // AutoCAD-Color-Index -> Anzeigefarbe.
    const ACI = { 1: '#ff5a3c', 2: '#ffd24a', 3: '#5ad16b', 4: '#4ad1d1', 5: '#4aa3ff', 6: '#d98bff', 7: '#c8d2dc', 8: '#8b98a8', 30: '#ffa03c' };
    const all = [];
    layers.forEach(l => { l.polys.forEach(p => { if (p.pts.length) all.push(p.pts); });
                          if (l.texts) all.push(l.texts); });
    if (!all.length) { if (info) info.textContent = T('Nichts ausgewählt.'); return; }
    const V = App.makeView(w, h, App.bounds.apply(null, all), 40, App.nav.exp);
    App.grid(ctx, w, h, V);
    layers.forEach(l => {
      const col = ACI[l.color] || '#c8d2dc';
      ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.setLineDash([]);
      l.polys.forEach(p => { if (p.pts.length > 1) { App.poly(ctx, V, p.pts, !!p.closed); ctx.stroke(); } });
      // Maßtext.
      if (l.texts) {
        ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        l.texts.forEach(t => { ctx.font = Math.max(9, t.h * V.s) + 'px Segoe UI'; ctx.fillText(t.text, V.X(t.x), V.Y(t.y)); });
      }
    });
    const nPolys = layers.reduce((s, l) => s + l.polys.length, 0);
    if (info) info.textContent = layers.length + T(' Layer · ') + nPolys + T(' Konturen — bereit zum Export.');
  }


  // ---- DXF-Formen-Ansicht: zeichnen, Raster, Synchronpaare ------------
  // (2026-09-12 aus ribs.js hierher geholt, damit der Reiter „DXF-Formen"
  //  vollständig in dieser Datei liegt und als Funktion abwählbar ist.)
  // Während der DXF-Darstellung gilt die Werkstoff-Zuweisung „DXF-Formen".
  function renderDxf() {
    App.matCtxOverride = 'dxf';
    try { renderDxfMain(); App.renderDxfPlan(); } finally { App.matCtxOverride = null; }
    if (App.renderSeg3DWin) App.renderSeg3DWin();   // offenes 3D-Fenster mitziehen
  }
  function renderDxfMain() {
    applyView('dxf');   // DXF-Formen-Ansicht nutzt eigene Zeichnungsfarben
    const cv = document.getElementById('cDxf'); if (!cv) return;
    const { ctx, w, h } = App.fitCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    const d = state.dxf, ed = d.edit;
    const info = document.getElementById('dxfInfo');
    const ents = App.dxfEntities();
    const bg = d.bg;
    const hasBg = !!(bg && bg.img && bg.visible);
    if (!d.inner && !d.outer && !ents.length && !ed.on && !hasBg) {
      if (info) info.innerHTML = '<div class="hint">' + T('Keine DXF geladen. Links „DXF laden…" oder „Ohne DXF neu zeichnen".') + '</div>';
      App.dxfDraw = null; return;
    }
    // Bildausschnitt: im Bearbeiten-Modus über ALLE Geometrie, sonst INNEN/AUSSEN.
    // Bei leerer Zeichnung ein Hintergrundbild bzw. eine Standardfläche einpassen.
    let bsrc = (ed.on && ents.length) ? ents.map(e => e.loop) : [d.inner, d.outer].filter(Boolean).concat(d.helpLayers ? ents.filter(e => d.helpLayers[e.layer]).map(e => e.loop) : []);
    if (!bsrc.length && hasBg) bsrc = [App.bgCorners(bg)];
    // Blockaußengrenze mit in den Bildausschnitt aufnehmen, damit sie nicht abschneidet.
    if (d.showBlock && bsrc.length) {
      const br = App.dxfBlockRect(App.bounds.apply(null, bsrc));
      bsrc = bsrc.concat([App.rect(br.minx, br.miny, br.maxx, br.maxy)]);
    }
    const b = App.bounds.apply(null, bsrc.length ? bsrc : [[{ x: 0, y: 0 }, { x: 100, y: 100 }]]);
    const V = App.makeView(w, h, b, 50, App.nav.dxf);
    if (hasBg) App.dxfDrawBg(ctx, V, bg);
    App.grid(ctx, w, h, V);
    // Blockaußengrenze (Rohmaß) = Bounding-Box der Profile plus Rand ringsum.
    if (d.showBlock) {
      const gsrc = [d.inner, d.outer].filter(Boolean);
      const gs = gsrc.length ? gsrc : ents.map(e => e.loop);
      if (gs.length) {
        const gb = App.bounds.apply(null, gs);
        if (isFinite(gb.minx) && gb.maxx >= gb.minx) {
          const br = App.dxfBlockRect(gb);
          const blk = App.rect(br.minx, br.miny, br.maxx, br.maxy);
          App.drawBlock(ctx, V, blk, App.PAL.block);
          // Maße der Blockaußengrenze (Breite × Höhe) einblenden.
          ctx.fillStyle = App.PAL.block; ctx.font = '11px system-ui';
          const bw = (br.maxx - br.minx), bh = (br.maxy - br.miny);
          ctx.fillText(bw.toFixed(1) + ' × ' + bh.toFixed(1) + ' mm',
            V.X(br.minx) + 4, V.Y(br.maxy) - 5);
        }
      }
    }
    const drawLoop = (pts, col, lw, dots) => {
      App.poly(ctx, V, pts, !!pts.closed); ctx.strokeStyle = col; ctx.lineWidth = lw || 1.8; ctx.stroke();
      if (dots !== false) { ctx.fillStyle = col; pts.forEach(p => { ctx.beginPath(); ctx.arc(V.X(p.x), V.Y(p.y), 1.7, 0, 6.3); ctx.fill(); }); }
    };
    // Koordinaten-Leiste nur im Bearbeiten-Modus zeigen.
    const bar = document.getElementById('dxfCoordBar');
    if (bar) bar.style.display = ed.on ? 'flex' : 'none';
    if (cv) cv.style.cursor = (ed.on && ed.cross) ? 'none' : ((d.syncMode || d.pEdit.on) ? 'crosshair' : (hasBg && bg.moveMode ? 'move' : ''));
    if (ed.on) {
      if (ed.showGrid) dxfDrawGrid(ctx, w, h, V);
      // Bearbeiten: alle Layer zeichnen, aktiver Layer betont, Auswahl weiß.
      const selKey = new Set(ed.sel.map(s => s.layer + ':' + s.idx));
      ents.forEach(e => {
        const isActive = e.layer === ed.active;
        const isSel = selKey.has(e.layer + ':' + e.idx);
        const col = isSel ? '#ffffff' : (e.layer === d.innerName ? App.PAL.profInner : e.layer === d.outerName ? App.PAL.profOuter : App.PAL.block);
        drawLoop(e.loop, col, isSel ? 2.6 : (isActive ? 1.8 : 1.2), isActive || isSel);
      });
      App.dxfDraw = { V };
      dxfDrawEditOverlay(ctx, V, w, h);
    } else {
      // Hilfslayer (nur Anzeige): gestrichelt, ohne Punkte, nie Schneidpfad.
      if (d.helpLayers) ents.forEach(e => { if (d.helpLayers[e.layer]) { ctx.setLineDash([6, 4]); drawLoop(e.loop, App.PAL.block || '#8fa0b4', 1.2, false); ctx.setLineDash([]); } });
      if (d.inner) { ctx.setLineDash(dashFor('profInner', [])); drawLoop(d.inner, App.PAL.profInner); ctx.setLineDash([]); }
      if (d.outer) { ctx.setLineDash(dashFor('profOuter', [])); drawLoop(d.outer, App.PAL.profOuter); ctx.setLineDash([]); }
      // Schnittspur (tatsächliche Draht-Bahn inkl. Abbrand) — synchron aus INNEN/AUSSEN.
      if (d.showSpur) {
        const sc = App.dxfSynced();
        if (sc && sc.inner.length > 1) {
          let ri = sc.inner.map(p => ({ x: p.x, y: p.y })), ro = sc.outer.map(p => ({ x: p.x, y: p.y }));
          if (d.kerf && !d.pathEdit) { const kk = App.dxfApplyKerf(ri, ro); ri = kk.root; ro = kk.tip; }
          // Wahre Dicke: Band in Schnittspaltbreite (p.k aus offsetPath; bearbeitete
          // Bahn ohne p.k -> aktueller Abbrand). INNEN und AUSSEN getrennt.
          const kb = d.kerf ? (App.currentKerf() || 0) : 0;
          if (App.kerfBand) { App.kerfBand(ctx, V, [ri], { view: 'dxf', k: kb, close: true }); App.kerfBand(ctx, V, [ro], { view: 'dxf', k: kb, close: true }); }
          ctx.strokeStyle = App.PAL.kerf; ctx.lineWidth = 1.4; ctx.setLineDash(dashFor('kerf', []));
          App.poly(ctx, V, ri, true); ctx.stroke();
          ctx.setLineDash(dashFor('kerf', [6, 4])); App.poly(ctx, V, ro, true); ctx.stroke(); ctx.setLineDash([]);
        }
      }
      ctx.lineWidth = 1.2;
      if (d.inner && d.outer) d.sync.forEach((s, k) => {
        const a = d.inner[s.i], c = d.outer[s.j]; if (!a || !c) return;
        const start = (k === d.start);
        ctx.strokeStyle = start ? App.PAL.syncStart : 'rgba(160,176,196,.6)';
        ctx.setLineDash(start ? dashFor('syncStart', []) : []);
        ctx.beginPath(); ctx.moveTo(V.X(a.x), V.Y(a.y)); ctx.lineTo(V.X(c.x), V.Y(c.y)); ctx.stroke(); ctx.setLineDash([]);
        [a, c].forEach(p => { ctx.fillStyle = start ? App.PAL.syncStart : '#a0b0c4'; ctx.beginPath(); ctx.arc(V.X(p.x), V.Y(p.y), 3.4, 0, 6.3); ctx.fill(); });
        ctx.fillStyle = '#e6edf3'; ctx.font = '11px system-ui';
        ctx.fillText(String(k + 1), (V.X(a.x) + V.X(c.x)) / 2 + 4, (V.Y(a.y) + V.Y(c.y)) / 2 - 4);
      });
      if (d.pick && d.pick.stage === 1 && d.inner && d.inner[d.pick.i]) {
        const p = d.inner[d.pick.i];
        ctx.strokeStyle = '#57d38c'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(V.X(p.x), V.Y(p.y), 6, 0, 6.3); ctx.stroke();
      }
      // Hover-Vorschau im Setzmodus: markiert den Punkt, auf den das Fadenkreuz
      // aktuell einrastet — VOR dem Klick. Farbe zeigt die erwartete Kontur
      // (INNEN blau, AUSSEN orange) passend zur nächsten Auswahlstufe.
      if (d.syncMode && d.helpLayers) {
        // Schnittpunkte INNEN/AUSSEN × Hilfslayer als Fangmarken (kleine Kreuze).
        ctx.lineWidth = 1; ctx.setLineDash([]);
        [[d.inner, App.PAL.profInner || '#5aa0ff'], [d.outer, App.PAL.profOuter || '#ff9f45']].forEach(([pts, col]) => {
          if (!pts) return; ctx.strokeStyle = col;
          dxfHelpIntersections(pts).forEach(q => { const cx = V.X(q.x), cy = V.Y(q.y); ctx.beginPath(); ctx.moveTo(cx - 4, cy - 4); ctx.lineTo(cx + 4, cy + 4); ctx.moveTo(cx - 4, cy + 4); ctx.lineTo(cx + 4, cy - 4); ctx.stroke(); });
        });
      }
      if (d.syncMode && d.syncHover) {
        const h = d.syncHover;
        const p = (h.i != null) ? ((h.which === 'outer' ? d.outer : d.inner) || [])[h.i] : { x: h.x, y: h.y };
        if (p) {
          const col = h.which === 'outer' ? (App.PAL.profOuter || '#ff9f45') : (App.PAL.profInner || '#5aa0ff');
          const cx = V.X(p.x), cy = V.Y(p.y);
          ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 6.3); ctx.stroke();
          ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, 6.3); ctx.fill();
          // kleines Fadenkreuz auf dem Rastpunkt
          ctx.beginPath();
          ctx.moveTo(cx - 11, cy); ctx.lineTo(cx - 4, cy);
          ctx.moveTo(cx + 4, cy); ctx.lineTo(cx + 11, cy);
          ctx.moveTo(cx, cy - 11); ctx.lineTo(cx, cy - 4);
          ctx.moveTo(cx, cy + 4); ctx.lineTo(cx, cy + 11);
          ctx.stroke();
        }
      }
      // Punkteditor: Stützpunkte als Griffe (INNEN blau, AUSSEN orange) — je nach
      // Ziel auf der Rohkontur (Profil) oder dem eingefrorenen Schneidepfad.
      if (d.pEdit.on) {
        const A = App.dxfPEArrays();
        if (A) {
          const drag = d.pEdit.drag;
          [['inner', A.inner, App.PAL.profInner], ['outer', A.outer, App.PAL.profOuter]].forEach(([which, arr, col]) => {
            arr.forEach((p, i) => {
              const sel = drag && drag.which === which && drag.i === i;
              ctx.beginPath(); ctx.arc(V.X(p.x), V.Y(p.y), sel ? 4.5 : 3, 0, 6.3);
              ctx.fillStyle = sel ? '#ffffff' : col; ctx.fill();
            });
          });
        }
      }
      const synced = App.dxfSynced();
      if (synced && synced.inner.length > 1) {
        const s0 = synced.inner[0], s1 = synced.inner[1];
        ctx.fillStyle = App.PAL.syncStart; ctx.beginPath(); ctx.arc(V.X(s0.x), V.Y(s0.y), 4.5, 0, 6.3); ctx.fill();
        const ang = Math.atan2(V.Y(s1.y) - V.Y(s0.y), V.X(s1.x) - V.X(s0.x));
        ctx.strokeStyle = App.PAL.syncStart; ctx.lineWidth = 2;
        const ex = V.X(s0.x) + 22 * Math.cos(ang), ey = V.Y(s0.y) + 22 * Math.sin(ang);
        ctx.beginPath(); ctx.moveTo(V.X(s0.x), V.Y(s0.y)); ctx.lineTo(ex, ey);
        ctx.lineTo(ex - 6 * Math.cos(ang - 0.5), ey - 6 * Math.sin(ang - 0.5));
        ctx.moveTo(ex, ey); ctx.lineTo(ex - 6 * Math.cos(ang + 0.5), ey - 6 * Math.sin(ang + 0.5));
        ctx.stroke();
      }
      App.dxfDraw = { V };
    }
    if (info) {
      if (ed.on) info.innerHTML =
        '<div><b>' + T('Bearbeiten — ') + dxfToolLabel(ed.tool) + '</b></div>'
        + '<div class="hint" style="margin:2px 0">' + T('Aktiver Layer: ') + (ed.active || '—') + T(' · Auswahl: ') + ed.sel.length + '</div>'
        + '<div class="hint" style="margin:2px 0">' + App.dxfToolHint(ed.tool) + '</div>';
      else {
        const synced = App.dxfSynced();
        const same = App.dxfSameSection() && !d.sync.length;
        info.innerHTML =
          '<div><b>' + T('DXF-Formen') + '</b></div>'
          + '<div class="hint" style="margin:2px 0">' + T('INNEN') + ' ' + (d.inner ? d.inner.length : '—') + T(' Pkt · AUSSEN ') + (d.outer ? d.outer.length : '—') + T(' Pkt') + '</div>'
          + '<div class="hint" style="margin:2px 0">' + (same
              ? T('Gleicher Querschnitt — keine Synchronpunkte nötig') + (synced ? T(' · Bahn ') + synced.inner.length + T(' Pkt') : '')
              : T('Synchronpaare: ') + d.sync.length + (synced ? T(' · Bahn ') + synced.inner.length + T(' Pkt') : T(' — mind. 1 nötig'))) + '</div>'
          + '<div class="hint" style="margin:2px 0">' + T(same ? '✓ G-Code kann direkt erstellt werden'
              : d.pick && d.pick.stage === 1 ? '➊ INNEN gewählt — jetzt AUSSEN anklicken'
              : d.syncMode ? 'Setzmodus AKTIV: INNEN- dann AUSSEN-Punkt klicken'
              : 'Setzmodus aus — links „Synchronpunkte setzen starten"') + '</div>';
      }
    }
  }
  function dxfToolLabel(t) {
    return ({ select: 'Auswählen', vertex: 'Punkt', line: 'Linie', rect: 'Rechteck', circle: 'Kreis',
      ellipse: 'Ellipse', polyline: 'Polylinie', move: 'Verschieben', copy: 'Kopieren',
      mirror: 'Spiegeln', trim: 'Trimmen', erase: 'Löschen' })[t] || t;
  }
  // CAD-Raster (Rasterweite in mm) über den sichtbaren Bereich.
  function dxfDrawGrid(ctx, w, h, V) {
    const step = state.dxf.edit.gridStep || 10;
    const p0 = V.inv(0, h), p1 = V.inv(w, 0);   // Welt-Ecken (unten-links / oben-rechts)
    const x0 = Math.floor(Math.min(p0.x, p1.x) / step) * step, x1 = Math.max(p0.x, p1.x);
    const y0 = Math.floor(Math.min(p0.y, p1.y) / step) * step, y1 = Math.max(p0.y, p1.y);
    if ((x1 - x0) / step > 800 || (y1 - y0) / step > 800) return;   // zu fein -> nicht zeichnen
    ctx.lineWidth = 1;
    for (let x = x0; x <= x1; x += step) {
      const on0 = Math.abs(x) < 1e-6;
      ctx.strokeStyle = on0 ? 'rgba(120,140,160,.5)' : 'rgba(90,105,120,.16)';
      const px = V.X(x); ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    }
    for (let y = y0; y <= y1; y += step) {
      const on0 = Math.abs(y) < 1e-6;
      ctx.strokeStyle = on0 ? 'rgba(120,140,160,.5)' : 'rgba(90,105,120,.16)';
      const py = V.Y(y); ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
    }
  }
  // Bezugspunkt der laufenden Skizze (für relative/polare Eingabe + Anzeige).
  function dxfDraftRef() {
    const dr = state.dxf.edit.draft; if (!dr) return null;
    if (dr.type === 'line' || dr.type === 'rect' || dr.type === 'ellipse') return dr.p0;
    if (dr.type === 'circle') return dr.c;
    if (dr.type === 'move') return dr.base;
    if (dr.type === 'mirror') return dr.p1;
    if ((dr.type === 'poly' || dr.type === 'spline') && dr.pts.length) return dr.pts[dr.pts.length - 1];
    return null;
  }
  // Zeichnet Skizze (draft), Raster/Fadenkreuz, Fang-/Hover-Marker + Koordinaten.
  function dxfDrawEditOverlay(ctx, V, w, h) {
    const ed = state.dxf.edit;
    const hv = ed.hover;
    // Fadenkreuz über die ganze Fläche am Cursor.
    if (ed.cross && hv) {
      const cx = V.X(hv.x), cy = V.Y(hv.y);
      ctx.strokeStyle = App.hexA(App.PAL.crosshair, 0.55); ctx.lineWidth = 1; ctx.setLineDash(dashFor('crosshair', [4, 4]));
      ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (ed.draft) {
      ctx.strokeStyle = '#57d38c'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      const dr = ed.draft;
      if (dr.type === 'line' && hv) { ctx.beginPath(); ctx.moveTo(V.X(dr.p0.x), V.Y(dr.p0.y)); ctx.lineTo(V.X(hv.x), V.Y(hv.y)); ctx.stroke(); }
      else if (dr.type === 'rect' && hv) { const x0 = V.X(dr.p0.x), y0 = V.Y(dr.p0.y), x1 = V.X(hv.x), y1 = V.Y(hv.y); ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); }
      else if (dr.type === 'circle' && hv) { const rr = Math.hypot(V.X(hv.x) - V.X(dr.c.x), V.Y(hv.y) - V.Y(dr.c.y)); ctx.beginPath(); ctx.arc(V.X(dr.c.x), V.Y(dr.c.y), rr, 0, 6.3); ctx.stroke(); }
      else if (dr.type === 'ellipse' && hv) { const cx = V.X((dr.p0.x + hv.x) / 2), cy = V.Y((dr.p0.y + hv.y) / 2), rx = Math.abs(V.X(hv.x) - V.X(dr.p0.x)) / 2, ry = Math.abs(V.Y(hv.y) - V.Y(dr.p0.y)) / 2; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 6.3); ctx.stroke(); }
      else if (dr.type === 'mirror' && hv) { ctx.beginPath(); ctx.moveTo(V.X(dr.p1.x), V.Y(dr.p1.y)); ctx.lineTo(V.X(hv.x), V.Y(hv.y)); ctx.stroke(); }
      else if (dr.type === 'poly') { ctx.beginPath(); dr.pts.forEach((p, i) => i ? ctx.lineTo(V.X(p.x), V.Y(p.y)) : ctx.moveTo(V.X(p.x), V.Y(p.y))); if (hv) ctx.lineTo(V.X(hv.x), V.Y(hv.y)); ctx.stroke(); }
      else if (dr.type === 'move' && hv) { ctx.beginPath(); ctx.moveTo(V.X(dr.base.x), V.Y(dr.base.y)); ctx.lineTo(V.X(hv.x), V.Y(hv.y)); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    if (hv) {
      const mx = V.X(hv.x), my = V.Y(hv.y);
      ctx.strokeStyle = ed.snapHit ? '#ffd27f' : '#57d38c'; ctx.lineWidth = 1.6; ctx.setLineDash([]);
      const k = ed.snapHit ? ed.snapKind : null;
      if (k === 'mid') { ctx.beginPath(); ctx.moveTo(mx, my - 6); ctx.lineTo(mx + 6, my + 5); ctx.lineTo(mx - 6, my + 5); ctx.closePath(); ctx.stroke(); }
      else if (k === 'perp') { ctx.beginPath(); ctx.moveTo(mx - 6, my - 6); ctx.lineTo(mx - 6, my + 6); ctx.lineTo(mx + 6, my + 6); ctx.moveTo(mx - 6, my + 1); ctx.lineTo(mx + 1, my + 1); ctx.lineTo(mx + 1, my + 6); ctx.stroke(); }
      else if (k === 'near') { ctx.beginPath(); ctx.moveTo(mx - 6, my - 6); ctx.lineTo(mx + 6, my + 6); ctx.moveTo(mx + 6, my - 6); ctx.lineTo(mx - 6, my + 6); ctx.stroke(); }
      else ctx.strokeRect(mx - 5, my - 5, 10, 10);   // Endpunkt / kein Typ
    }
    // Koordinaten-Anzeige: am Cursor + in der Leiste unten links.
    const read = document.getElementById('dxfCoordRead');
    if (hv) {
      const ref = dxfDraftRef();
      let txt = 'X ' + hv.x.toFixed(1) + '  Y ' + hv.y.toFixed(1);
      if (ref) {
        const dx = hv.x - ref.x, dy = hv.y - ref.y, len = Math.hypot(dx, dy);
        const ang = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        txt += '   Δ ' + dx.toFixed(1) + ',' + dy.toFixed(1) + '   L ' + len.toFixed(1) + '  ∠ ' + ang.toFixed(1) + '°';
      }
      ctx.fillStyle = '#cfe3ff'; ctx.font = '11px Consolas, monospace';
      ctx.fillText('X ' + hv.x.toFixed(1) + ' Y ' + hv.y.toFixed(1), V.X(hv.x) + 9, V.Y(hv.y) - 9);
      if (read && document.activeElement !== document.getElementById('dxfCoordInput')) read.textContent = txt;
    } else if (read) read.textContent = T('Cursor über die Fläche bewegen …');
  }
  // Bester Rastpunkt auf einer geschlossenen Kontur (Bildschirmkoordinaten px,py,
  // Toleranz tolPx). Wie im CAD-Objektfang: ein bestehender Stützpunkt hat Vorrang
  // (Rückgabe { i }); liegt keiner in Reichweite, wird der NÄCHSTE Punkt auf einer
  // Kante gefangen (Rückgabe { seg, x, y } — beim Setzen als neuer Stützpunkt
  // eingefügt). null = nichts in Reichweite.
  // Schnittpunkte einer Kontur mit allen Hilfslayer-Konturen: [{seg, x, y}] —
  // ---- Synchronpunkte automatisch anlegen ---------------------------------
  // Ecken beider Konturen (Richtungsänderung > minDeg über ein Bogenlängen-
  // Fenster, damit dicht resampelte Konturen keine Scheinecken liefern).
  function dxfLoopCorners(L, minDeg, lookMM) {
    const n = L.length; if (n < 4) return [];
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    let per = 0; for (let i = 0; i < n; i++) per += dist(L[i], L[(i + 1) % n]);
    const look = Math.max(lookMM, per / n * 1.5);
    const at = (i, dir) => { let k = i, acc = 0; while (acc < look) { const nk = (k + dir + n) % n; acc += dist(L[k], L[nk]); k = nk; if (k === i) break; } return L[k]; };
    const ang = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = at(i, -1), b = at(i, 1), p = L[i];
      const v1x = p.x - a.x, v1y = p.y - a.y, v2x = b.x - p.x, v2y = b.y - p.y;
      ang[i] = Math.abs(Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y)) * 180 / Math.PI;
    }
    const win = Math.max(1, Math.ceil(look * 2 / (per / n)));
    const cand = []; for (let i = 0; i < n; i++) if (ang[i] >= minDeg) cand.push(i);
    cand.sort((a, b) => ang[b] - ang[a]);
    const acc = [];
    cand.forEach(i => { if (!acc.some(k => Math.min(Math.abs(k - i), n - Math.abs(k - i)) <= win)) acc.push(i); });
    return acc.sort((a, b) => a - b);
  }
  function dxfLoopArea(L) { let a = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; a += p.x * q.y - q.x * p.y; } return a / 2; }
  function dxfLoopBBox(L) { const b = { minx: Infinity, maxx: -Infinity, miny: Infinity, maxy: -Infinity }; L.forEach(p => { b.minx = Math.min(b.minx, p.x); b.maxx = Math.max(b.maxx, p.x); b.miny = Math.min(b.miny, p.y); b.maxy = Math.max(b.maxy, p.y); }); return b; }
  // Nase = Mitte des linkesten Plateaus (gerade senkrechte Front -> mittlerer
  // Punkt, nicht der zufällig erste/letzte Punkt mit minimalem x).
  function dxfLoopNose(L, eps) {
    const n = L.length; eps = eps || 0;
    let k = 0; for (let i = 1; i < n; i++) if (L[i].x < L[k].x) k = i;
    const minx = L[k].x;
    let a = k, b = k, g = 0;
    while (g++ < n && L[(a - 1 + n) % n].x <= minx + eps) a--;
    g = 0; while (g++ < n && L[(b + 1) % n].x <= minx + eps) b++;
    if (b - a >= n - 1) return k;
    return ((Math.round((a + b) / 2) % n) + n) % n;
  }
  // Index des Punktes bei normierter Bogenlänge t (0..1) ab Start in Richtung dir.
  function dxfLoopIdxAt(L, start, dir, t) {
    const n = L.length, dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    let per = 0; for (let i = 0; i < n; i++) per += dist(L[i], L[(i + 1) % n]);
    const target = t * per; let k = start, acc = 0;
    for (let c = 0; c < n; c++) { const nk = (k + dir + n) % n; const dd = dist(L[k], L[nk]); if (acc + dd >= target) return (target - acc) < dd / 2 ? k : nk; acc += dd; k = nk; }
    return k;
  }
  // Umkehrpunkte (lokale Minima/Maxima) der Koordinate key entlang der Kontur ab
  // Start s in Richtung dir, mit Hysterese eps; Plateaus (gerade Kanten) liefern
  // ihren Mittelpunkt. Ergebnis: [{k, tag}] in Laufreihenfolge (k = Schritte ab s).
  function dxfLoopExtrema(L, s, dir, key, eps) {
    const n = L.length, v = k => L[(((s + dir * k) % n) + n) % n][key];
    const mid = (kc, val) => { let a = kc, b = kc; while (a > 0 && Math.abs(v(a - 1) - val) <= eps) a--; while (b < n && Math.abs(v(b + 1) - val) <= eps) b++; return Math.round((a + b) / 2); };
    const out = [];
    let mode = 0, ext = v(0), kExt = 0;
    for (let k = 1; k <= n; k++) {
      const x = v(k);
      if (mode === 0) { if (x > ext + eps) { mode = 1; ext = x; kExt = k; } else if (x < ext - eps) { mode = -1; ext = x; kExt = k; } continue; }
      if (mode === 1) { if (x > ext) { ext = x; kExt = k; } else if (x < ext - eps) { out.push({ k: mid(kExt, ext), tag: key + '+' }); mode = -1; ext = x; kExt = k; } }
      else { if (x < ext) { ext = x; kExt = k; } else if (x > ext + eps) { out.push({ k: mid(kExt, ext), tag: key + '-' }); mode = 1; ext = x; kExt = k; } }
    }
    return out.filter(e => e.k > 2 && e.k < n - 2);
  }
  // Synchronpaare des AKTIVEN Segments automatisch anlegen (ersetzt vorhandene).
  // Startpaar = Nase beider Konturen. Danach, in dieser Reihenfolge:
  //  1. Umkehrpunkte (x-/y-Extrema) beider Konturen — stimmt die Abfolge der
  //     Merkmale überein (gleicher Konturtyp, z. B. Spanten mit Schlitz und
  //     Tasche, auch mit verrundeten Ecken), werden sie der Reihe nach gepaart;
  //  2. sonst harte Ecken beider Konturen bei gleicher Anzahl;
  //  3. sonst M Paare gleichmäßig nach Bogenlänge.
  function dxfAutoSync(opt) {
    const d = state.dxf; opt = opt || {};
    const A = d.inner, B = d.outer;
    if (!A || !B || A.length < 4 || B.length < 4) return T('Keine INNEN/AUSSEN-Kontur vorhanden.');
    const nA = A.length, nB = B.length;
    const bA = dxfLoopBBox(A), bB = dxfLoopBBox(B);
    const size = Math.max(bA.maxx - bA.minx, bA.maxy - bA.miny, bB.maxx - bB.minx, bB.maxy - bB.miny);
    const eps = Math.max(0.3, (opt.epsRel || 0.015) * size);
    const nose = { i: dxfLoopNose(A, eps), j: dxfLoopNose(B, eps) };
    const dirB = (dxfLoopArea(A) >= 0) === (dxfLoopArea(B) >= 0) ? 1 : -1;
    const idxA = k => (nose.i + k) % nA, idxB = k => (((nose.j + dirB * k) % nB) + nB) % nB;
    const relA = i => (i - nose.i + nA) % nA;
    const relB = j => dirB > 0 ? (j - nose.j + nB) % nB : (nose.j - j + nB) % nB;
    const pairs = [{ i: nose.i, j: nose.j }];
    const add = (i, j) => { if (!pairs.some(p => p.i === i || p.j === j)) pairs.push({ i, j }); };
    let msg = null;
    // 1. Umkehrpunkte
    const eA = dxfLoopExtrema(A, nose.i, 1, 'x', eps).concat(dxfLoopExtrema(A, nose.i, 1, 'y', eps)).sort((p, q) => p.k - q.k);
    const eB = dxfLoopExtrema(B, nose.j, dirB, 'x', eps).concat(dxfLoopExtrema(B, nose.j, dirB, 'y', eps)).sort((p, q) => p.k - q.k);
    if (eA.length && eA.length === eB.length && eA.every((e, k) => e.tag === eB[k].tag)) {
      eA.forEach((e, k) => add(idxA(e.k), idxB(eB[k].k)));
      msg = T('Synchronpunkte automatisch: Nase + ') + (pairs.length - 1) + T(' Umkehrpunkte zugeordnet.');
    }
    // 2. Ecken
    if (!msg) {
      const minDeg = opt.minDeg || 25, look = opt.lookMM || 2;
      const cA = dxfLoopCorners(A, minDeg, look).filter(i => Math.min(relA(i), nA - relA(i)) > 2).sort((p, q) => relA(p) - relA(q));
      const cB = dxfLoopCorners(B, minDeg, look).filter(j => Math.min(relB(j), nB - relB(j)) > 2).sort((p, q) => relB(p) - relB(q));
      if (cA.length && cA.length === cB.length) {
        cA.forEach((i, k) => add(i, cB[k]));
        msg = T('Synchronpunkte automatisch: Nase + ') + (pairs.length - 1) + T(' Ecken zugeordnet.') + ' (' + T('Umkehrpunkte ungleich') + ' ' + eA.length + '/' + eB.length + ')';
      } else if (!msg) {
        // 3. Bogenlänge
        const M = Math.max(8, Math.min(24, Math.max(eA.length, eB.length, cA.length, cB.length) || 12));
        for (let k = 1; k < M; k++) add(dxfLoopIdxAt(A, nose.i, 1, k / M), dxfLoopIdxAt(B, nose.j, dirB, k / M));
        msg = T('Synchronpunkte automatisch: Merkmale ungleich (Umkehrpunkte ') + eA.length + '/' + eB.length + T(', Ecken ') + cA.length + '/' + cB.length + T(') — ') + pairs.length + T(' Paare gleichmäßig nach Bogenlänge.');
      }
    }
    d.sync = pairs; d.start = 0; d.pick = null; d.pathEdit = null;
    if (d.segs && d.segs[d.activeSeg]) { d.segs[d.activeSeg].sync = pairs; d.segs[d.activeSeg].pathEdit = null; }
    return msg;
  }
  // Alle Segmente der Rippenkette nacheinander (aktives Segment bleibt).
  function dxfAutoSyncAll() {
    const d = state.dxf; dxfEnsureModel();
    const keep = d.activeSeg, msgs = [];
    for (let k = 0; k < dxfSegCount(); k++) { dxfSetActive(k); msgs.push(T('Segment ') + (k + 1) + ': ' + dxfAutoSync()); }
    dxfSetActive(keep);
    return msgs.join('\n');
  }
  // Fangziele beim Setzen der Synchronpunkte (z. B. Holmlage als Hilfslinie).
  function dxfHelpIntersections(pts) {
    const d = state.dxf, out = []; if (!d.helpLayers || !d.layers || !pts) return out;
    const helps = [];
    for (const name of d.order) if (d.helpLayers[name]) (d.layers[name] || []).forEach(l => helps.push(l));
    if (!helps.length) return out;
    const n = pts.length, last = pts.closed === false ? n - 1 : n;
    for (let i = 0; i < last; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      helps.forEach(h => {
        const m = h.length, ml = h.closed ? m : m - 1;
        for (let j = 0; j < ml; j++) { const X = HotWire.segX(a, b, h[j], h[(j + 1) % m]); if (X) out.push({ seg: i, x: X.x, y: X.y }); }
      });
    }
    return out;
  }
  function dxfSyncSnap(pts, px, py, tolPx) {
    const V = App.dxfDraw.V;
    let bi = -1, bd = 1e9;
    pts.forEach((p, i) => { const dx = V.X(p.x) - px, dy = V.Y(p.y) - py; const dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; bi = i; } });
    // Schnittpunkt mit einem Hilfslayer in Reichweite? Gewinnt, wenn näher als der Stützpunkt.
    let bq = null, bqd = 1e9;
    dxfHelpIntersections(pts).forEach(q => { const dx = V.X(q.x) - px, dy = V.Y(q.y) - py; const dd = dx * dx + dy * dy; if (dd < bqd) { bqd = dd; bq = q; } });
    if (bq && Math.sqrt(bqd) <= tolPx && bqd < bd) {
      // Liegt der Schnittpunkt praktisch auf einem Stützpunkt, diesen nehmen.
      const near = pts.findIndex(p => Math.hypot(p.x - bq.x, p.y - bq.y) < 1e-6);
      return near >= 0 ? { i: near } : { seg: bq.seg, x: bq.x, y: bq.y, xsect: true };
    }
    if (bi >= 0 && Math.sqrt(bd) <= tolPx) return { i: bi };
    // Kein Stützpunkt in Reichweite -> „Nächster" auf einer Kante.
    let bseg = -1, bnd = 1e9, bx = 0, by = 0; const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const ax = V.X(a.x), ay = V.Y(a.y), bxs = V.X(b.x), bys = V.Y(b.y);
      const dx = bxs - ax, dy = bys - ay, L2 = dx * dx + dy * dy || 1e-9;
      let t = ((px - ax) * dx + (py - ay) * dy) / L2; t = Math.max(0, Math.min(1, t));
      const sx = ax + t * dx, sy = ay + t * dy, dd = (sx - px) * (sx - px) + (sy - py) * (sy - py);
      if (dd < bnd) { bnd = dd; bseg = i; bx = a.x + t * (b.x - a.x); by = a.y + t * (b.y - a.y); }
    }
    if (bseg >= 0 && Math.sqrt(bnd) <= tolPx) return { seg: bseg, x: bx, y: by };
    return null;
  }
  // Fügt einen „Nächster"-Rastpunkt als neuen Stützpunkt in die Rohkontur ein
  // (damit er nach dxfResolve erhalten bleibt) und verschiebt bestehende
  // Sync-Indizes entsprechend. Rückgabe = neuer Stützpunktindex.
  function dxfSyncInsert(which, snap) {
    const d = state.dxf;
    const name = which === 'outer' ? d.outerName : d.innerName;
    const src = d.layers && d.layers[name] && Dxf.pickLoop(d.layers[name]);
    if (!src) return -1;
    const off = which === 'outer' ? (d.outerOff || { x: 0, y: 0 }) : (d.innerOff || { x: 0, y: 0 });
    const pos = snap.seg + 1;                        // hinter dem Segmentanfang einfügen
    src.splice(pos, 0, { x: snap.x - off.x, y: snap.y - off.y });
    const key = which === 'outer' ? 'j' : 'i';
    d.sync.forEach(s => { if (s[key] >= pos) s[key]++; });
    if (d.pick && which === 'inner' && d.pick.i >= pos) d.pick.i++;
    App.dxfResolve();
    return pos;
  }
  // Klick (Sync-Punkte) nur außerhalb des Bearbeiten-Modus.
  function dxfCanvasClick(ev) {
    const d = state.dxf; if (d.edit.on || d.pEdit.on || !d.syncMode) return;
    if (!d.inner || !d.outer || !App.dxfDraw) return;
    const cv = document.getElementById('cDxf'); const r = cv.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    if (!d.pick || d.pick.stage !== 1) {
      const s = dxfSyncSnap(d.inner, px, py, 24); if (!s) return;
      App.dxfPushUndo();                                 // ein Undo pro Paar (vor allen Änderungen)
      const i = (s.i != null) ? s.i : dxfSyncInsert('inner', s);
      d.pick = { stage: 1, i };
    } else {
      const s = dxfSyncSnap(d.outer, px, py, 24); if (!s) { d.pick = null; App.buildSidebar(); renderDxf(); return; }
      const j = (s.i != null) ? s.i : dxfSyncInsert('outer', s);
      d.sync.push({ i: d.pick.i, j });
      d.pick = null;
    }
    App.buildSidebar(); renderDxf(); App.render();
  }

  // Hover im Setzmodus: bestimmt den Punkt, auf den der nächste Klick einrastet,
  // und zeigt ihn als Markierung an (INNEN bei Stufe 0, AUSSEN bei Stufe 1).
  function dxfSyncMove(ev) {
    const d = state.dxf;
    if (!d.syncMode || !d.inner || !d.outer || !App.dxfDraw) { if (d.syncHover) { d.syncHover = null; renderDxf(); } return; }
    const cv = document.getElementById('cDxf'); const r = cv.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    const stage1 = !!(d.pick && d.pick.stage === 1);
    const which = stage1 ? 'outer' : 'inner';
    const s = dxfSyncSnap(stage1 ? d.outer : d.inner, px, py, 24);
    const hov = s ? (s.i != null ? { which, i: s.i } : { which, x: s.x, y: s.y }) : null;
    const prev = d.syncHover;
    const same = (!hov && !prev) || (hov && prev && hov.which === prev.which && hov.i === prev.i && hov.x === prev.x && hov.y === prev.y);
    if (!same) { d.syncHover = hov; renderDxf(); }
  }

  // ---- Grundriss/Aufriss oben + Teilerbalken (2026-09-12 aus render.js) ----
  // Gehört zur Ansicht des Reiters „DXF-Formen“ und liegt darum hier.
  // render.js lädt NACH dieser Datei — darum erst beim Aufruf aus App holen.
  const fitCanvas = (cv) => App.fitCanvas(cv);
  const render = () => App.render();
  // DXF-Reiter: waagrechte Teilung Grundriss (oben) / Profile+Schnitt (unten).
  function applyDxfSplit() {
    const stack = document.getElementById('dxfStack');
    const bar = document.getElementById('dxfSplit');
    if (!stack) return;
    const f = Math.max(0.15, Math.min(0.85, state.cfg.dxfSplit || 0.333));
    stack.style.gridTemplateColumns = '1fr';
    stack.style.gridTemplateRows = f + 'fr ' + (1 - f) + 'fr';
    if (bar) { bar.style.display = 'block'; bar.style.top = (f * 100) + '%'; }
  }
  function setupDxfSplit() {
    const stack = document.getElementById('dxfStack');
    const bar = document.getElementById('dxfSplit');
    if (!stack || !bar) return;
    bar.addEventListener('mousedown', e => {
      e.preventDefault();
      const mv = ev => {
        const r = stack.getBoundingClientRect();
        state.cfg.dxfSplit = Math.max(0.15, Math.min(0.85, (ev.clientY - r.top) / r.height));
        applyDxfSplit(); renderDxf();
      };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    });
    // Umschalter Grundriss/Aufriss.
    const modeSel = document.getElementById('dxfPlanMode');
    if (modeSel) modeSel.onchange = () => { state.cfg.dxfPlanMode = modeSel.value; renderDxfPlan(); };
    // Segment im Grundriss anklicken = aktiv schalten (wie im Tragflächendesign).
    const plan = document.getElementById('cDxfPlan');
    if (plan) {
      plan.style.cursor = 'pointer';
      plan.addEventListener('click', e => {
        if (!dxfPlanHit || !dxfPlanHit.nSeg) return;
        const r = plan.getBoundingClientRect();
        const z = ((e.clientX - r.left) - dxfPlanHit.ox) / (dxfPlanHit.s || 1);
        const zs = dxfPlanHit.zs;
        for (let i = 0; i < dxfPlanHit.nSeg; i++) {
          if (z >= zs[i] && z <= zs[i + 1]) { dxfSetActive(i); App.buildSidebar(); renderDxf(); render(); break; }
        }
      });
    }
  }
  // Obere DXF-Ansicht: Grundriss (Draufsicht, X = Profiltiefe) ODER Aufriss
  // (Vorderansicht, Y = Profilhöhe). Waagrecht = Spannweite (Z, aufsummierte
  // Segmentbreiten). Die Rippen werden in IHRER TATSÄCHLICHEN LAGE zueinander
  // gezeichnet (inkl. Verschiebung je Rippe) — keine Kante wird gerade gezogen.
  let dxfPlanHit = null;   // {ox,s,zs,nSeg} für Klick-Trefferprüfung im Grundriss
  function renderDxfPlan() {
    const cv = document.getElementById('cDxfPlan'); if (!cv) return;
    const { ctx, w, h } = fitCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    const d = state.dxf; dxfEnsureModel();
    const ribs = d.ribs || [];
    if (state.cfg.dxfPlanMode === '3d') state.cfg.dxfPlanMode = 'plan';   // (alter Umschalterwert)
    const mode = state.cfg.dxfPlanMode || 'plan';
    const lbl = document.getElementById('dxfPlanLabel');
    if (lbl) lbl.textContent = mode === 'front' ? T('Vorderansicht — Schneidepfade aller Segmente')
                             : mode === 'elev' ? T('Aufriss — alle Segmente')
                                               : T('Grundriss — alle Segmente');
    const sel = document.getElementById('dxfPlanMode'); if (sel) sel.value = mode;
    if (mode === 'front') { renderDxfFront(ctx, w, h); return; }
    // Grundriss: Wertachse = Y der Kontur; Aufriss: Wertachse = X der Kontur
    // (2026-09-17 nach Rückmeldung getauscht — die Ansichten waren vertauscht).
    const elev = mode === 'elev';
    // Tatsächliche lo/hi der gewählten Achse je Rippe (inkl. Verschiebung).
    const extOf = r => {
      const lp = r && d.layers && d.layers[r.layer] && Dxf.pickLoop(d.layers[r.layer]);
      if (!lp || !lp.length) return null;
      const off = r.off || { x: 0, y: 0 };
      let lo = Infinity, hi = -Infinity;
      lp.forEach(p => { const v = (elev ? p.x + off.x : p.y + off.y); if (v < lo) lo = v; if (v > hi) hi = v; });
      return hi > lo ? { lo, hi } : null;
    };
    const ext = ribs.map(extOf);
    if (ribs.length < 2 || !d.layers || ext.every(e => !e)) {
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted') || '#8a97a6';
      ctx.font = '12px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(T('Ansicht erscheint nach Import (2+ Rippen).'), w / 2, h / 2);
      ctx.textAlign = 'left'; dxfPlanHit = null; return;
    }
    // Gemeinsame Wertespanne der Achse (relative Lage bleibt erhalten).
    let vLo = Infinity, vHi = -Infinity;
    ext.forEach(e => { if (e) { if (e.lo < vLo) vLo = e.lo; if (e.hi > vHi) vHi = e.hi; } });
    const vSpan = (vHi - vLo) || 1;
    // Z-Positionen der Segmentgrenzen aus den Segmentbreiten; Rippe i (Paarliste)
    // liegt an der Grenze (i>>1) + (i&1).
    const nS = Math.floor(ribs.length / 2);
    const zs = [0];
    for (let i = 0; i < nS; i++) zs.push(zs[i] + (((d.segs && d.segs[i]) || {}).span || 100));
    const totalZ = zs[nS] || 1;
    const ribZ = i => zs[(i >> 1) + (i & 1)];
    const pad = 42;
    const s = Math.min((w - 2 * pad) / totalZ, (h - 2 * pad) / vSpan);
    const ox = pad + ((w - 2 * pad) - totalZ * s) / 2;
    const oy = pad + ((h - 2 * pad) - vSpan * s) / 2;
    const X = z => ox + z * s;
    // Aufriss: kleiner Wert oben -> Wert wächst nach unten.
    // Grundriss: großer Wert oben -> Wert wächst nach oben (invertiert).
    const Y = v => elev ? oy + (v - vLo) * s : oy + (vHi - v) * s;
    dxfPlanHit = { ox, s, zs, nSeg: nS };
    // Segment-Flächen in echter Lage (Rand = lo/hi der beiden Profile des Segments).
    for (let i = 0; i < nS; i++) {
      const a = ext[2 * i], b = ext[2 * i + 1]; if (!a || !b) continue;
      const zA = zs[i], zB = zs[i + 1];
      ctx.beginPath();
      ctx.moveTo(X(zA), Y(a.lo)); ctx.lineTo(X(zB), Y(b.lo));
      ctx.lineTo(X(zB), Y(b.hi)); ctx.lineTo(X(zA), Y(a.hi)); ctx.closePath();
      const active = i === d.activeSeg;
      ctx.fillStyle = active ? 'rgba(74,163,255,.16)' : (i % 2 ? 'rgba(160,176,196,.06)' : 'rgba(160,176,196,.11)');
      ctx.fill();
      ctx.strokeStyle = active ? (App.PAL.accent || '#4aa3ff') : (App.PAL.line || 'rgba(160,176,196,.5)');
      ctx.lineWidth = active ? 1.8 : 1; ctx.stroke();
      ctx.fillStyle = active ? (App.PAL.accent || '#4aa3ff') : (App.PAL.muted || '#8a97a6');
      ctx.font = '11px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('Seg ' + (i + 1), (X(zA) + X(zB)) / 2, Math.min(Y(a.lo), Y(a.hi), Y(b.lo), Y(b.hi)) - 6);
    }
    ctx.textAlign = 'left';
    // Rippenlinien in echter Lage — INNEN/AUSSEN des aktiven Segments farbig.
    // An einer Segmentgrenze liegen zwei Profile (AUSSEN links, INNEN des nächsten
    // rechts beschriftet); ein vom Vorsegment übernommenes Profil wird nur einmal gezeichnet.
    const aIn = ribs[2 * d.activeSeg], aOut = ribs[2 * d.activeSeg + 1];
    for (let i = 0; i < ribs.length; i++) {
      const e = ext[i]; if (!e) continue;
      if (i > 0 && !(i & 1) && ribs[i] === ribs[i - 1]) continue;
      const shared = (i & 1) && ribs[i + 1] === ribs[i];
      let col = App.PAL.muted || '#8a97a6', lw = 1.2;
      if (ribs[i] === aIn) { col = App.PAL.profInner || '#4aa3ff'; lw = 2.4; }
      else if (ribs[i] === aOut) { col = App.PAL.profOuter || '#ffb454'; lw = 2.4; }
      const xz = X(ribZ(i));
      ctx.strokeStyle = col; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(xz, Y(e.lo)); ctx.lineTo(xz, Y(e.hi)); ctx.stroke();
      const yBot = Math.max(Y(e.lo), Y(e.hi));
      const inner = i === 0 || i === ribs.length - 1 || shared;
      ctx.fillStyle = col; ctx.font = '10px system-ui'; ctx.textAlign = inner ? 'center' : ((i & 1) ? 'right' : 'left');
      const xt = inner ? xz : xz + ((i & 1) ? -4 : 4);
      ctx.fillText((ribs[i].layer || '—'), xt, yBot + 14);
      ctx.fillText((e.hi - e.lo).toFixed(0) + ' mm', xt, yBot + 26);
    }
    ctx.textAlign = 'left';
  }

  // Vorderansicht: Blick längs der Spannweite (Z) auf die Schneidepfade aller
  // Segmente — Wurzel- und Außenbahn je Segment in ihrer echten XY-Lage
  // übereinander (Y nach oben). Aktives Segment farbig (INNEN/AUSSEN), übrige grau.
  function renderDxfFront(ctx, w, h) {
    const d = state.dxf; const ribs = d.ribs || [];
    const paths = [];
    for (let k = 0; k < Math.floor(ribs.length / 2); k++) {
      let P = dxfSegPaths(k);
      if (!P) {   // kein Schneidepfad (z. B. ohne Synchronpunkte): Rohkonturen zeigen
        const sh = (r) => { const lp = r && d.layers && d.layers[r.layer] && Dxf.pickLoop(d.layers[r.layer]); if (!lp) return null; const o = r.off || { x: 0, y: 0 }; return lp.map(p => ({ x: p.x + o.x, y: p.y + o.y })); };
        const a = sh(ribs[2 * k]), b = sh(ribs[2 * k + 1]);
        if (a && b) P = { root: a, tip: b, raw: true };
      }
      if (P) paths.push({ k, P });
    }
    dxfPlanHit = null;
    if (!paths.length) {
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted') || '#8a97a6';
      ctx.font = '12px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(T('Ansicht erscheint nach Import (2+ Rippen).'), w / 2, h / 2);
      ctx.textAlign = 'left'; return;
    }
    let xLo = Infinity, xHi = -Infinity, yLo = Infinity, yHi = -Infinity;
    paths.forEach(({ P }) => [P.root, P.tip].forEach(a => a.forEach(p => {
      if (p.x < xLo) xLo = p.x; if (p.x > xHi) xHi = p.x; if (p.y < yLo) yLo = p.y; if (p.y > yHi) yHi = p.y; })));
    const pad = 42, sw = (xHi - xLo) || 1, shh = (yHi - yLo) || 1;
    const s = Math.min((w - 2 * pad) / sw, (h - 2 * pad) / shh);
    const ox = pad + ((w - 2 * pad) - sw * s) / 2, oy = pad + ((h - 2 * pad) - shh * s) / 2;
    const X = x => ox + (x - xLo) * s, Y = y => oy + (yHi - y) * s;
    const draw = (a, col, lw, dash) => {
      if (!a || a.length < 2) return;
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash(dash || []);
      ctx.beginPath(); a.forEach((p, i) => i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y)));
      ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    };
    // Zuerst die inaktiven Segmente (grau), dann das aktive obenauf.
    paths.filter(q => q.k !== d.activeSeg).forEach(({ P }) => {
      draw(P.root, App.PAL.line || 'rgba(160,176,196,.5)', 1, P.raw ? [4, 3] : null);
      draw(P.tip, App.PAL.line || 'rgba(160,176,196,.5)', 1, P.raw ? [4, 3] : null);
    });
    const act = paths.find(q => q.k === d.activeSeg);
    if (act) {
      draw(act.P.root, App.PAL.profInner || '#4aa3ff', 2.2, act.P.raw ? [4, 3] : null);
      draw(act.P.tip, App.PAL.profOuter || '#ffb454', 2.2, act.P.raw ? [4, 3] : null);
    }
    ctx.font = '11px system-ui'; ctx.textAlign = 'left';
    ctx.fillStyle = App.PAL.profInner || '#4aa3ff'; ctx.fillText(T('INNEN') + ' · Seg ' + (d.activeSeg + 1), 10, h - 22);
    ctx.fillStyle = App.PAL.profOuter || '#ffb454'; ctx.fillText(T('AUSSEN') + ' · Seg ' + (d.activeSeg + 1), 10, h - 8);
    ctx.fillStyle = App.PAL.muted || '#8a97a6';
    ctx.fillText((xHi - xLo).toFixed(0) + ' × ' + (yHi - yLo).toFixed(0) + ' mm', 130, h - 8);
    ctx.textAlign = 'left';
  }

  // Segment k um die waagrechte Achse (Spannweite, Z) drehen = beide Rippenkonturen
  // des Segments in der Schnittebene XY um den Mittelpunkt ihrer Kontur drehen
  // (deg > 0 = gegen den Uhrzeigersinn, Y nach oben). Dreht die Layer-Rohdaten
  // (mit Rückgängig). Ein Layer darf mehreren Segmenten zugeordnet sein — die Drehung
  // gilt dann NUR für dieses Segment: der Layer wird vorher für das Segment kopiert
  // („… · Seg n"). Nur ein per Option vom Vorsegment übernommenes Profil dreht gemeinsam.
  // Synchronpunkte (Indizes) bleiben gültig; ein eingefrorener Schneidepfad des
  // Segments dreht mit, eingefrorene Pfade anderer betroffener Segmente werden gelöst.
  function dxfRotateSeg(k, deg) {
    const d = state.dxf; dxfEnsureModel(); dxfStashActive();
    const ri = d.ribs[2 * k], ro = d.ribs[2 * k + 1]; if (!ri || !ro || !d.layers) return;
    deg = +deg || 0; if (!deg) return;
    const rad = deg * Math.PI / 180, c = Math.cos(rad), sn = Math.sin(rad);
    const rot = (p, cx, cy) => { const dx = p.x - cx, dy = p.y - cy; p.x = cx + dx * c - dy * sn; p.y = cy + dx * sn + dy * c; };
    const center = name => {
      const lp = d.layers[name] && Dxf.pickLoop(d.layers[name]); if (!lp || !lp.length) return null;
      let a = Infinity, b = -Infinity, e = Infinity, f = -Infinity;
      lp.forEach(p => { if (p.x < a) a = p.x; if (p.x > b) b = p.x; if (p.y < e) e = p.y; if (p.y > f) f = p.y; });
      return { x: (a + b) / 2, y: (e + f) / 2 };
    };
    if (![ri.layer, ro.layer].some(n => d.layers[n])) return;
    dxfPushUndo();
    // Von anderen Segmenten mitbenutzte Layer zuerst für dieses Segment kopieren.
    [...new Set([ri.layer, ro.layer])].filter(n => d.layers[n]).forEach(n => {
      if (!d.ribs.some(r => r !== ri && r !== ro && r.layer === n)) return;
      const nn = dxfCopyLayer(n, n + ' · Seg ' + (k + 1));
      [ri, ro].forEach(r => { if (r.layer === n) r.layer = nn; });
    });
    const names = [...new Set([ri.layer, ro.layer])].filter(n => d.layers[n]);
    const cen = {}; names.forEach(n => { cen[n] = center(n); });
    names.forEach(n => { const cc = cen[n]; if (cc) d.layers[n].forEach(loop => loop.forEach(p => rot(p, cc.x, cc.y))); });
    // Eingefrorene Schneidepfade: eigenes Segment mitdrehen (Weltlage = Rohdaten + Verschiebung).
    (d.segs || []).forEach((sg, j) => {
      if (!sg || !sg.pathEdit || !sg.pathEdit.inner) return;
      const a = d.ribs[2 * j], b = d.ribs[2 * j + 1];
      const hit = (a && names.includes(a.layer)) || (b && names.includes(b.layer));
      if (!hit) return;
      if (j !== k) { sg.pathEdit = null; if (j === d.activeSeg) d.pathEdit = null; return; }
      const ci = cen[a.layer], co = cen[b.layer];
      if (ci) sg.pathEdit.inner.forEach(p => rot(p, ci.x + (a.off ? a.off.x : 0), ci.y + (a.off ? a.off.y : 0)));
      if (co) sg.pathEdit.outer.forEach(p => rot(p, co.x + (b.off ? b.off.x : 0), co.y + (b.off ? b.off.y : 0)));
    });
    dxfLoadActive(); dxfAfterEdit();
    if (typeof flashDxf === 'function') flashDxf(T('Segment ') + (k + 1) + ' ' + T('gedreht um') + ' ' + deg + '°');
  }

  // ALLE Segmente gemeinsam drehen: alle Rippenkonturen um EINEN gemeinsamen
  // Mittelpunkt (Bounding-Box aller Rippen in Weltlage inkl. Verschiebung), damit
  // die Lage der Rippen zueinander erhalten bleibt. Die Verschiebung je Rippe
  // bleibt unverändert (Drehpunkt je Layer = C − off, ergibt in Weltlage genau die
  // Drehung um C). Eingefrorene Schneidepfade drehen in Weltlage um C mit.
  function dxfRotateAll(deg) {
    const d = state.dxf; dxfEnsureModel(); dxfStashActive();
    if (!d.layers || !d.ribs || !d.ribs.length) return;
    deg = +deg || 0; if (!deg) return;
    const rad = deg * Math.PI / 180, c = Math.cos(rad), sn = Math.sin(rad);
    const rot = (p, cx, cy) => { const dx = p.x - cx, dy = p.y - cy; p.x = cx + dx * c - dy * sn; p.y = cy + dx * sn + dy * c; };
    dxfPushUndo();
    // Ein Layer, der mit UNTERSCHIEDLICHER Verschiebung mehrfach zugeordnet ist, kann nicht
    // als Ganzes richtig um C drehen — je weitere Verschiebung eine eigene Kopie.
    const grp = {};
    d.ribs.forEach(r => {
      if (!d.layers[r.layer]) return;
      const o = r.off || { x: 0, y: 0 }, key = o.x + '|' + o.y, g = grp[r.layer] || (grp[r.layer] = {});
      if (!Object.keys(g).length) g[key] = r.layer;
      else if (!g[key]) { g[key] = dxfCopyLayer(r.layer, r.layer + ' · ' + T('Kopie')); grp[g[key]] = { [key]: g[key] }; }
      r.layer = g[key];
    });
    let a = Infinity, b = -Infinity, e = Infinity, f = -Infinity;
    const offOf = {};   // Verschiebung je Layer (nach der Trennung eindeutig)
    d.ribs.forEach(r => {
      const lp = d.layers[r.layer] && Dxf.pickLoop(d.layers[r.layer]); if (!lp || !lp.length) return;
      const o = r.off || { x: 0, y: 0 }; if (!offOf[r.layer]) offOf[r.layer] = o;
      lp.forEach(p => { const x = p.x + o.x, y = p.y + o.y; if (x < a) a = x; if (x > b) b = x; if (y < e) e = y; if (y > f) f = y; });
    });
    if (!(b > a)) return;
    const C = { x: (a + b) / 2, y: (e + f) / 2 };
    Object.keys(offOf).forEach(n => { const o = offOf[n]; d.layers[n].forEach(loop => loop.forEach(p => rot(p, C.x - o.x, C.y - o.y))); });
    (d.segs || []).forEach(sg => {
      if (!sg || !sg.pathEdit || !sg.pathEdit.inner) return;
      sg.pathEdit.inner.forEach(p => rot(p, C.x, C.y)); sg.pathEdit.outer.forEach(p => rot(p, C.x, C.y));
    });
    dxfLoadActive(); dxfAfterEdit();
    if (typeof flashDxf === 'function') flashDxf(T('Alle Segmente') + ' ' + T('gedreht um') + ' ' + deg + '°');
  }

  // ---------- 3D-Ansicht: geschnittene Segmente zusammengebaut ---------
  /* Schneidepfad (Wurzel/Außen, gleich lang) für Segment k — aus den GESPEICHERTEN
   * Segmentdaten (Synchronpaare, Start, Richtung, Dichte, eingefrorener Pfad,
   * Abbrand). Für das aktive Segment gelten die Flachfelder (evtl. ungespeichert).
   * Rückgabe { root, tip } (offene Punktlisten, gleich lang) oder null. */
  function dxfSegPaths(k) {
    const d = state.dxf; dxfEnsureModel();
    const sg = d.segs && d.segs[k]; if (!sg) return null;
    const cp = a => a.map(p => ({ x: p.x, y: p.y }));
    if (k === d.activeSeg) {
      const s = dxfSynced(); if (!s) return null;
      let root = cp(s.inner), tip = cp(s.outer);
      if (d.kerf && !d.pathEdit) { const kk = dxfApplyKerf(root, tip); root = kk.root; tip = kk.tip; }
      return { root, tip };
    }
    if (sg.pathEdit && sg.pathEdit.inner && sg.pathEdit.inner.length > 1)
      return { root: cp(sg.pathEdit.inner), tip: cp(sg.pathEdit.outer) };
    const ri = d.ribs[2 * k], ro = d.ribs[2 * k + 1]; if (!ri || !ro || !d.layers) return null;
    const shift = (loop, off) => { if (!loop) return null; const a = loop.map(p => ({ x: p.x + (off ? off.x : 0), y: p.y + (off ? off.y : 0) })); a.closed = loop.closed; return a; };
    const inner = d.layers[ri.layer] ? shift(Dxf.pickLoop(d.layers[ri.layer]), ri.off) : null;
    const outer = d.layers[ro.layer] ? shift(Dxf.pickLoop(d.layers[ro.layer]), ro.off) : null;
    if (!inner || !outer) return null;
    const same = ri.layer === ro.layer && inner.length === outer.length && inner.length > 2;
    const sync = (sg.sync || []).filter(q => q.i < inner.length && q.j < outer.length);
    if (sync.length < 1 && !same) return null;
    const pairs = sync.length ? sync : [{ i: 0, j: 0 }];
    const start = sync.length ? (sg.start || 0) : 0;
    const opt = sg.densMode === 'permm' ? { perMM: Math.max(0.01, sg.perMM || 1) } : {};
    const r = Dxf.buildSync(inner, outer, pairs, start, sg.dir || 1, Math.max(8, sg.density | 0), opt);
    if (!r) return null;
    let root = cp(r.inner), tip = cp(r.outer);
    if (sg.kerf) { const kk = dxfApplyKerf(root, tip); root = kk.root; tip = kk.tip; }
    return { root, tip };
  }
  /* Liefert alle Segmente der Rippenkette als 3D-Liste für das gemeinsame
   * 3D-Fenster (render.js, App.seg3dOpen('dxf')): { k, root, tip, z0, z1, label }.
   * Welt: X = Profiltiefe, Y = Höhe, Z = Spannweite (Segmentbreiten aufsummiert).
   * Segmente ohne Schneidepfad entfallen. */
  function dxfSeg3DList() {
    const d = state.dxf; dxfEnsureModel(); const ribs = d.ribs || [];
    const nS = Math.floor(ribs.length / 2);
    const zs = [0];
    for (let i = 0; i < nS; i++) zs.push(zs[i] + (((d.segs && d.segs[i]) || {}).span || 100));
    const list = [];
    for (let k = 0; k < nS; k++) {
      const P = dxfSegPaths(k);
      if (P && P.root.length > 2 && P.tip.length === P.root.length)
        list.push({ k, root: P.root, tip: P.tip, z0: zs[k], z1: zs[k + 1], label: 'Seg ' + (k + 1) + ' · ' + Math.round(zs[k + 1] - zs[k]) + ' mm' });
    }
    return { list, active: d.activeSeg };
  }

  // ---------- kerf-Heatmap (Schnittspur-Einfärbung) -------------------
  // Farbverlauf blau (schmaler Spalt) -> gelb -> rot (breiter Spalt).

  // ---- Verdrahtung des Reiters (2026-09-12 aus app.js hierher geholt) ----
  // app.js ruft dxfWireUp() beim Start geschützt auf. So bringt Reiter „DXF-Formen“
  // seine Ereignisse selbst mit und die Datei lässt sich als Funktion abwählen.
  function dxfWireUp() {
    const setupNav = App.setupNav, buildSidebar = App.buildSidebar;
    setupNav('cDxf', 'dxf', renderDxf);      // Zoom/Pan in der DXF-Formen-Ansicht
    setupNav('cExport', 'exp', renderDxfExport);   // Zoom/Pan in der DXF-Export-Vorschau
    const cdxf = document.getElementById('cDxf');
    if (cdxf) {
      cdxf.addEventListener('click', dxfCanvasClick);   // Synchronpunkte setzen (nur ohne Edit-Modus)
      // Editor: Capture-Phase, damit im Bearbeiten-Modus kein Nav-Pan startet.
      cdxf.addEventListener('mousedown', ev => {
        if (state.dxf.pEdit.on) { dxfPathDown(ev); return; }
        if (state.dxf.edit.on) { dxfEditDown(ev); return; }
        if (dxfBgDown(ev)) return;   // Hintergrundbild verschieben (Verschiebemodus)
      }, true);
      cdxf.addEventListener('mousemove', ev => { if (state.dxf.pEdit.on) dxfPathMove(ev); else if (state.dxf.edit.on) dxfEditMove(ev); else if (state.dxf.syncMode) dxfSyncMove(ev); else dxfBgMove(ev); });
      cdxf.addEventListener('mouseleave', () => { if (state.dxf.syncHover) { state.dxf.syncHover = null; renderDxf(); } });
      cdxf.addEventListener('dblclick', ev => { if (state.dxf.pEdit.on) { App.dxfPathDbl(ev); return; } if (state.dxf.edit.on && state.dxf.edit.tool === 'polyline') { ev.preventDefault(); ev.stopPropagation(); dxfFinishPolyline(false); } }, true);
      cdxf.addEventListener('contextmenu', ev => { if (state.dxf.pEdit.on) ev.preventDefault(); });
      window.addEventListener('mouseup', ev => { if (state.dxf.pEdit.on) dxfPathUp(ev); else if (state.dxf.edit.on) dxfEditUp(ev); else dxfBgUp(ev); });
    }
    const dci = document.getElementById('dxfCoordInput');
    if (dci) dci.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); dxfCoordApply(dci.value); dci.value = ''; dci.focus(); }
      else if (ev.key === 'Escape') { dci.value = ''; dci.blur(); }
    });
    // DXF-Reiter: Rückgängig (Strg+Z) / Wiederholen (Strg+Y bzw. Strg+Umschalt+Z).
    window.addEventListener('keydown', e => {
      if (state.activeTab !== 'dxf' || !(e.ctrlKey || e.metaKey)) return;
      const inField = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (inField) return;
      const k = e.key.toLowerCase();
      const path = state.dxf.pEdit.on;
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); path ? dxfPathUndo() : dxfUndo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); path ? dxfPathRedo() : dxfRedo(); }
    });
    // Bearbeiten-Modus: Esc bricht laufende Skizze/Auswahl ab, Entf löscht Auswahl.
    window.addEventListener('keydown', e => {
      const ed = state.dxf.edit; if (!ed.on || state.activeTab !== 'dxf') return;
      const inField = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (e.key === 'F3') { e.preventDefault(); ed.snap = !ed.snap; flashDxf('Objektfang ' + (ed.snap ? 'AN' : 'AUS')); buildSidebar(); renderDxf(); return; }
      if (e.key === 'F8') { e.preventDefault(); ed.ortho = !ed.ortho; flashDxf('Ortho ' + (ed.ortho ? 'AN' : 'AUS')); buildSidebar(); renderDxf(); return; }
      if (e.key === 'Escape') { ed.draft = null; ed.drag = null; ed.sel = []; ed.tool = 'select'; buildSidebar(); renderDxf(); }
      else if ((e.key === 'Enter' || e.key === ' ') && !inField) {
        // Funktion beenden: laufende Polylinie abschließen, sonst Skizze verwerfen; danach Auswählen.
        e.preventDefault();
        if (ed.draft && ed.draft.type === 'poly' && ed.draft.pts.length >= 2) dxfFinishPolyline(false);
        else ed.draft = null;
        ed.drag = null; ed.tool = 'select'; buildSidebar(); renderDxf();
      }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && ed.sel.length && !inField) {
        e.preventDefault(); dxfPushUndo();
        ed.sel.sort((a, b) => b.idx - a.idx).forEach(s => { if (state.dxf.layers[s.layer]) state.dxf.layers[s.layer].splice(s.idx, 1); });
        ed.sel = []; dxfAfterEdit();
      }
    });
  }

  // ---- Registry: eigene Top-Level-Namen bereitstellen (automatisch) ----
  Object.assign(App, { dxfWireUp, applyDxfSplit, renderDxfPlan, setupDxfSplit });
  Object.assign(App, { dxfSegPaths, dxfSeg3DList, dxfRotateSeg, dxfRotateAll, renderDxfFront });
  Object.defineProperty(App, 'dxfPlanHit', { get: () => dxfPlanHit, set: v => { dxfPlanHit = v; }, enumerable: true, configurable: true });
  Object.assign(App, { dxfCanvasClick, dxfDraftRef, dxfDrawEditOverlay, dxfDrawGrid, dxfHelpIntersections, dxfSyncInsert, dxfSyncMove, dxfSyncSnap, dxfToolLabel, renderDxf, renderDxfMain });
  Object.assign(App, { m3dParseLayer, applyParsedLayers, applyParsedRole, bgCorners, buildBgSidebar, buildDxfExportLayers, buildDxfExportSidebar, buildDxfScene, buildDxfSidebar });
  Object.assign(App, { dxfAddEntity, dxfAddSeg, dxfAfterEdit, dxfApplyKerf, dxfApplySnap, dxfBgDown, dxfBgMove, dxfBgUp });
  Object.assign(App, { dxfBlockRect, dxfCoordApply, dxfDelSeg, dxfDistToLoop, dxfDrawBg, dxfEditDown, dxfEditMove, dxfEditUp });
  Object.assign(App, { dxfEnsureModel, dxfEntities, dxfExportClose, dxfExportDim, dxfExportLayout, dxfExportParsePath, dxfExportRibExtras, dxfExportRun });
  Object.assign(App, { dxfExportSegList, dxfFinishPolyline, dxfHitEntity, dxfImport, dxfJoinSelection, dxfLoadActive, dxfLoadBgImage });
  Object.assign(App, { dxfLoopOf, dxfLoopSub, dxfMirrorSelection, dxfNearestVertex, dxfNearestVertexRef, dxfNewBlank, dxfNewSeg, dxfOsnap });
  Object.assign(App, { dxfPEArrays, dxfPathAfter, dxfPathDbl, dxfPathDown, dxfPathEditBake, dxfPathHit, dxfPathHitEdge, dxfPathMove, dxfPathPushUndo });
  Object.assign(App, { dxfPathRedo, dxfPathSnap, dxfPathUndo, dxfPathUp, dxfPathWorld, dxfPosPoint, dxfProjection, dxfPushUndo });
  Object.assign(App, { dxfRedo, dxfResolve, dxfSameSection, dxfSetActive, dxfSnap, dxfStashActive, dxfSynced, dxfSyncedRaw });
  Object.assign(App, { dxfToolHint, dxfToolPoint, dxfTranslateSelection, dxfTrimAt, dxfUndo, dxfWorld, flashDxf });
  Object.assign(App, { dxfSegCount, dxfSetLinkPrev, dxfApplyRibChain, dxfAutoSync, dxfAutoSyncAll, dxfLoopCorners, dxfLoopExtrema, dxfLoopNose, loadDxfRole, loadSvgRole, mkLoopLocal, renderDxfExport, svgImport });
  Object.defineProperty(App, 'dxfDraw', { get: () => dxfDraw, set: v => { dxfDraw = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'dxfFlashT', { get: () => dxfFlashT, set: v => { dxfFlashT = v; }, enumerable: true, configurable: true });
})();
