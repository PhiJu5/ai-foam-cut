/* wings.js — Mehrere Tragflächen je Projekt
 *
 * Prinzip „Tauschen statt umschreiben": Die AKTIVE Tragfläche liegt wie bisher
 * in state.root / state.segments / state.spars (+ tragflächenbezogene cfg-Werte
 * und Editor-Overrides). Alle Reiter (Kerndesign, Negativdesign, Rippendesign,
 * Formenbau, G-Code, Schneiden, DXF-Export, Rumpf, Fräse …) lesen unverändert
 * dort bzw. aus App.wing. state.wings[] hält je Tragfläche Name + ruhende Daten;
 * beim Umschalten wird die aktive eingesammelt und die gewählte eingesetzt.
 *
 * Je Tragfläche gespeichert: Geometrie (Wurzel, Segmente, Holme), Punkt-Overrides
 * (pathEdit/negEdit/negBurnEdit), Profil-Basis, aktives Segment/Holm, DXF-Export-
 * Segmentauswahl sowie die Design-Einstellungen aus Tragflächen-, Kern-, Negativ-,
 * Rippendesign und Formenbau (WING_CFG_KEYS + Präfixe neg…/form…). Maschine,
 * Werkstoff, G-Code-/Blocklage-Einstellungen, DXF-Formen, CAD, 3D-Modell und Rumpf
 * bleiben projektweit. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state, mkSeg, PROJECT_DEFAULTS } = App;

  // ---------- Welche cfg-Werte gehören zur Tragfläche? --------------------
  const WING_CFG_KEYS = [
    // Tragflächendesign
    'twistRef', 'points', 'sheeting', 'sheetMode', 'sheetSides', 'sheetTop', 'sheetBot',
    'globalDih', 'align', 'hingeAlign', 'sweepRef', 'dihedralCut', 'profSegs',
    // Kerndesign
    'leStyle', 'leAngle', 'leGap', 'eightW', 'eightH', 'eightCross', 'teStyle',
    'extOverBlockLE', 'extOverBlockClearLE', 'extOverBlockTE', 'extOverBlockClearTE', 'kerfDatum', 'shellCut', 'shellTop', 'shellBot',
    'coreStegeOn',
    'flipY', 'stackCount', 'stackGap', 'stackOffset', 'stackBaseOn', 'stackBase', 'stackMirror',
    'sparCut', 'sparKerfMode', 'sparKerfBasis', 'sparCutMode', 'sparOnly',
    'sweepRot', 'sweepRotMode', 'sweepRotRef', 'sweepRotAngle',
    // Rippendesign
    'rib',
    // Rippenfläche (Rippenbauweise, rippenflaeche.js)
    'rf',
    // Werkstoff-Zuweisung (Reiter „Projektübersicht")
    'design', 'matId', 'matHeight', 'negMatId', 'negMatHeight',
    // Gewichtsabschätzung (Reiter „Projektübersicht")
    'wtCount', 'wtSheetMode', 'wtSheetDensity', 'wtSheetThick', 'wtSheetArea',
    'wtFab1Gsm', 'wtFab1Layers', 'wtFab2Gsm', 'wtFab2Layers', 'wtFiber', 'wtExtra'
  ];
  // Reine Ansichtszustände bleiben projektweit, auch wenn sie ein Präfix teilen.
  const WING_CFG_EXCLUDE = ['formView', 'formCutOn', 'negViewSplit'];
  function isWingCfgKey(k) {
    if (WING_CFG_EXCLUDE.indexOf(k) >= 0) return false;
    return WING_CFG_KEYS.indexOf(k) >= 0 || /^neg[A-Z]/.test(k) || /^form[A-Z]/.test(k);
  }

  // Tiefe Kopie, die Array-Zusatzfelder (Profil.name, Loop.closed …) erhält.
  function deepClone(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) {
      const a = v.map(deepClone);
      Object.keys(v).forEach(k => { if (!/^\d+$/.test(k)) a[k] = deepClone(v[k]); });
      return a;
    }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return v;   // Image, Handles … nicht kopieren
    const o = {};
    for (const k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = deepClone(v[k]);
    return o;
  }

  function freshGeometry() {
    return {
      root: { profile: Airfoil.naca4('2412', 100), chord: 200, twistRef: 0.25 },
      segments: [mkSeg({ chord: 160, span: 300, sweep: 10, washout: 0, dih: 0 })],
      spars: []
    };
  }

  // ---------- Namen ------------------------------------------------------
  let wingSeq = 0;
  function wingList() {
    if (!Array.isArray(state.wings) || !state.wings.length) state.wings = [{ name: defaultName(1) }];
    if (!(state.activeWing >= 0 && state.activeWing < state.wings.length)) state.activeWing = 0;
    // Sitzungsweite Kennung je Tragfläche (bleibt beim Umsortieren/Löschen anderer gleich) —
    // z. B. für die Tragflächen-Auswahl im CAD-Import.
    state.wings.forEach(w => { if (!w.id) w.id = 'w' + (++wingSeq); });
    return state.wings;
  }
  function wingId(i) { const w = wingList()[i]; return w ? w.id : null; }
  function defaultName(n) { return T('Tragfläche') + ' ' + n; }
  // Nächster freier Standardname „Tragfläche n".
  function nextDefaultName() {
    const used = new Set((state.wings || []).map(w => String(w.name || '').trim().toLowerCase()));
    for (let n = (state.wings || []).length + 1; ; n++) {
      const nm = defaultName(n);
      if (!used.has(nm.toLowerCase())) return nm;
    }
  }
  function wingName(i) {
    const L = wingList(); if (i == null) i = state.activeWing;
    const w = L[i]; return (w && String(w.name || '').trim()) || defaultName(i + 1);
  }
  // Dateinamen-Baustein der aktiven Tragfläche. Nur bei mehreren Tragflächen
  // (Einzel-Tragfläche: Dateinamen wie bisher).
  function wingFileTag() {
    if (wingList().length < 2) return '';
    return wingName().trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
  }

  // ---------- Tauschen -----------------------------------------------------
  // Aktive Tragfläche aus dem Live-Zustand in ihren Datensatz einsammeln.
  function captureWing(rec) {
    rec = rec || wingList()[state.activeWing];
    rec.root = state.root; rec.segments = state.segments; rec.spars = state.spars;
    rec.pathEdit = state.pathEdit; rec.negEdit = state.negEdit; rec.negBurnEdit = state.negBurnEdit;
    rec.profBase = state.profBase;
    rec.activeSeg = state.activeSeg; rec.activeSpar = state.activeSpar;
    rec.dxfExportSegs = state.dxfExport ? state.dxfExport.segs : null;
    rec.cfg = {};
    for (const k in state.cfg) if (isWingCfgKey(k)) rec.cfg[k] = state.cfg[k];
    return rec;
  }
  // Datensatz in den Live-Zustand einsetzen. Fehlende cfg-Werte -> Programm-
  // Vorgaben (bzw. löschen, damit die Module ihre eigenen Vorgaben nachziehen).
  function applyWing(rec) {
    if (!rec.root || !rec.segments) Object.assign(rec, freshGeometry());
    state.root = rec.root; state.segments = rec.segments; state.spars = rec.spars || [];
    state.pathEdit = rec.pathEdit || {}; state.negEdit = rec.negEdit || {}; state.negBurnEdit = rec.negBurnEdit || {};
    state.profBase = rec.profBase || {};
    const n = state.segments.length;
    state.activeSeg = (rec.activeSeg === 'all' || (rec.activeSeg >= 0 && rec.activeSeg < n)) ? rec.activeSeg : (n ? 0 : 'all');
    state.activeSpar = (rec.activeSpar != null && rec.activeSpar < state.spars.length) ? rec.activeSpar : null;
    if (state.dxfExport) state.dxfExport.segs = Array.isArray(rec.dxfExportSegs) ? rec.dxfExportSegs.filter(i => i < n) : null;
    const c = rec.cfg || {};
    if (App.migrateExtOverBlock) App.migrateExtOverBlock(c);   // alt: extOverBlock/-Clear -> LE/TE getrennt
    const keys = new Set(Object.keys(state.cfg).concat(Object.keys(c)).concat(Object.keys(PROJECT_DEFAULTS.cfg)));
    keys.forEach(k => {
      if (!isWingCfgKey(k)) return;
      if (Object.prototype.hasOwnProperty.call(c, k)) state.cfg[k] = c[k];
      else if (Object.prototype.hasOwnProperty.call(PROJECT_DEFAULTS.cfg, k)) {
        const d = deepClone(PROJECT_DEFAULTS.cfg[k]); state.cfg[k] = d; c[k] = d;
      } else delete state.cfg[k];
    });
    rec.cfg = c;
  }

  // Nach jedem Wechsel: Editoren schließen, alles neu berechnen und zeichnen.
  function afterWingChange() {
    if (state.ptEdit) { state.ptEdit.on = false; state.ptEdit.drag = null; state.ptEdit.hover = null; state.ptEdit.undo = []; state.ptEdit.redo = []; }
    if (state.profEdit) state.profEdit.target = 'root';
    if (App.profModalOpen && App.closeProfModal) { try { App.closeProfModal(); } catch (e) {} }
    if (state.gcodeEdited) { state.gcodeEdited = false; if (App.setGcodeEditMode) { try { App.setGcodeEditMode(false); } catch (e) {} } }
    state.lastGcode = null; state._hingeSweeps = null;
    App.buildSidebar();
    App.render();
    if (App.switchView) App.switchView(state.activeTab || 'wing');   // Reiter-spezifische Ansicht (Formenbau, Rippen …) neu aufbauen
    // Maschinen-Programm (Reiter „Schneiden") an die neue Fläche angleichen: ein
    // bereits aus einer Quelle übernommenes Programm samt 3D-Monitor neu erzeugen,
    // damit nie die vorige Fläche gestreamt wird, während der Simulator schon die
    // neue zeigt. Läuft nur bei vorhandener Maschinensteuerung (Build-abhängig).
    if (window.GrblPanel && GrblPanel.refreshProgram) { try { GrblPanel.refreshProgram(); } catch (e) {} }
  }

  function selectWing(i) {
    const L = wingList();
    i = Math.max(0, Math.min(L.length - 1, +i || 0));
    if (i === state.activeWing) return;
    captureWing(L[state.activeWing]);
    state.activeWing = i;
    applyWing(L[i]);
    afterWingChange();
  }

  // fn() mit Tragfläche i als aktiver Tragfläche ausführen (Daten + App.wing), danach
  // den vorigen Zustand wiederherstellen — ohne Sidebar/Zeichnen. Für Auswertungen
  // über mehrere Tragflächen (z. B. CAD-Import).
  function withWing(i, fn) {
    const L = wingList(), cur = state.activeWing;
    if (i === cur || !L[i]) return fn();
    const keep = { lastGcode: state.lastGcode, hinge: state._hingeSweeps };
    captureWing(L[cur]);
    state.activeWing = i; applyWing(L[i]);
    try { if (App.recompute) App.recompute(); return fn(); }
    finally {
      captureWing(L[i]);
      state.activeWing = cur; applyWing(L[cur]);
      if (App.recompute) App.recompute();
      state.lastGcode = keep.lastGcode; state._hingeSweeps = keep.hinge;
    }
  }

  // Neue Tragfläche mit Programm-Vorgaben (Geometrie wie „Neues Projekt").
  function addWing(name) {
    const L = wingList();
    captureWing(L[state.activeWing]);
    const rec = Object.assign({ name: (name && String(name).trim()) || nextDefaultName(), cfg: {} }, freshGeometry());
    L.push(rec);
    state.activeWing = L.length - 1;
    applyWing(rec);
    afterWingChange();
  }

  // Aktive Tragfläche kopieren (inkl. aller Design-Einstellungen).
  function duplicateWing() {
    const L = wingList();
    const cur = captureWing(L[state.activeWing]);
    const copy = deepClone({ root: cur.root, segments: cur.segments, spars: cur.spars,
      pathEdit: cur.pathEdit, negEdit: cur.negEdit, negBurnEdit: cur.negBurnEdit, profBase: cur.profBase,
      activeSeg: cur.activeSeg, activeSpar: cur.activeSpar, dxfExportSegs: cur.dxfExportSegs, cfg: cur.cfg });
    let nm = wingName() + ' ' + T('(Kopie)');
    const used = new Set(L.map(w => String(w.name || '').trim().toLowerCase()));
    for (let k = 2; used.has(nm.toLowerCase()); k++) nm = wingName() + ' ' + T('(Kopie)') + ' ' + k;
    copy.name = nm;
    L.splice(state.activeWing + 1, 0, copy);
    state.activeWing = state.activeWing + 1;
    applyWing(copy);
    afterWingChange();
  }

  function deleteWing(i) {
    const L = wingList();
    if (i == null) i = state.activeWing;
    if (L.length < 2) { if (App.toast) App.toast(T('Die letzte Tragfläche kann nicht gelöscht werden.')); return; }
    if (!confirm(T('Tragfläche löschen?') + '\n„' + wingName(i) + '"')) return;
    captureWing(L[state.activeWing]);
    L.splice(i, 1);
    if (i < state.activeWing) state.activeWing--;
    else if (i === state.activeWing) state.activeWing = Math.min(i, L.length - 1);
    applyWing(L[state.activeWing]);
    afterWingChange();
  }

  function renameWing(i, name) {
    const L = wingList(); if (i == null) i = state.activeWing;
    if (!L[i]) return;
    const nm = String(name == null ? '' : name).trim();
    L[i].name = nm || defaultName(i + 1);
    App.buildSidebar();
  }

  function moveWing(i, dir) {
    const L = wingList(); const j = i + dir;
    if (j < 0 || j >= L.length) return;
    const t = L[i]; L[i] = L[j]; L[j] = t;
    if (state.activeWing === i) state.activeWing = j; else if (state.activeWing === j) state.activeWing = i;
    App.buildSidebar();
  }

  // Neues Projekt: zurück auf eine einzige Tragfläche (Geometrie setzt newProject).
  function resetWings() {
    state.wings = [{ name: defaultName(1) }];
    state.activeWing = 0;
  }

  // ---------- Projekt-Datei ----------------------------------------------
  // Liste aller Tragflächen für saveProject; encode(root, segments, spars) kommt
  // aus filesys.js (gleiches Format wie die bisherige Einzel-Tragfläche).
  function serializeWings(encode) {
    const L = wingList();
    captureWing(L[state.activeWing]);
    return L.map((w, i) => Object.assign({ name: wingName(i) },
      encode(w.root, w.segments, w.spars || []),
      { cfg: JSON.parse(JSON.stringify(w.cfg || {})) }));
  }
  // Nach loadProject: recs = [{name, root, segments, spars, cfg}] (bereits dekodiert).
  function restoreWings(recs, active) {
    if (!Array.isArray(recs) || !recs.length) { resetWings(); captureWing(state.wings[0]); return; }
    state.wings = recs.map((r, i) => ({
      name: (r.name && String(r.name).trim()) || defaultName(i + 1),
      root: r.root, segments: r.segments, spars: r.spars || [], cfg: r.cfg || {},
      pathEdit: {}, negEdit: {}, negBurnEdit: {}, profBase: {}, activeSeg: 0, activeSpar: null
    }));
    state.activeWing = Math.max(0, Math.min(state.wings.length - 1, +active || 0));
    applyWing(state.wings[state.activeWing]);
  }

  // ---------- Bedienung ----------------------------------------------------
  function wingSelectEl(onPick) {
    const s = document.createElement('select');
    s.style.cssText = 'width:100%;font-weight:600';
    wingList().forEach((w, i) => {
      const o = document.createElement('option'); o.value = String(i);
      o.textContent = wingName(i); s.appendChild(o);
    });
    s.value = String(state.activeWing);
    s.onchange = () => (onPick || selectWing)(+s.value);
    return s;
  }

  // Sidebar: Verwaltung im Tragflächendesigner, Auswahl in den Folge-Reitern.
  // cfg-Wert einer Tragfläche lesen/schreiben — aktive Tragfläche live in
  // state.cfg, die übrigen in ihrem Datensatz (rec.cfg).
  function wingCfgGet(i, k) { return i === state.activeWing ? state.cfg[k] : (wingList()[i].cfg || {})[k]; }
  function wingCfgSet(i, k, v) {
    if (i === state.activeWing) { state.cfg[k] = v; return; }
    const w = wingList()[i]; if (!w.cfg) w.cfg = {}; w.cfg[k] = v;
  }

  // ---------- Geometrie- und Gewichtsabschätzung je Tragfläche --------------
  // Rein aus root/segments/cfg des Datensatzes (kein Tauschen nötig). Profil-
  // koordinaten sind auf die Sehne normiert (x,y in 0..1): Fläche·chord²,
  // Umfang·chord. Volumen je Segment als Kegelstumpf-Formel über die beiden
  // Rippenflächen, Oberfläche als Mantel (Mittel der Umfänge · Spannweite).
  function profMetrics(prof) {
    if (!Array.isArray(prof) || prof.length < 3) return { area: 0, perim: 0 };
    let a = 0, p = 0;
    for (let i = 0; i < prof.length; i++) {
      const q = prof[(i + 1) % prof.length];
      a += prof[i].x * q.y - q.x * prof[i].y;
      p += Math.hypot(q.x - prof[i].x, q.y - prof[i].y);
    }
    return { area: Math.abs(a) / 2, perim: p };
  }
  // Wirksame Beplankung (mm, oben+unten) je Rippe — wie compute.sheetFor, nur mit cfg-Parameter.
  function sheetSum(cfg, seg) {
    const c = cfg || {}, asym = c.sheetSides === 'asym';
    const gTop = asym ? (+c.sheetTop || 0) : (+c.sheeting || 0);
    const gBot = asym ? (+c.sheetBot || 0) : (+c.sheeting || 0);
    if (c.sheetMode !== 'segment' || !seg) return { root: gTop + gBot, tip: gTop + gBot };
    const v = (x, d) => (x == null ? d : +x);
    if (asym) return { root: v(seg.sheetRootTop, gTop) + v(seg.sheetRootBot, gBot), tip: v(seg.sheetTipTop, gTop) + v(seg.sheetTipBot, gBot) };
    const g = +c.sheeting || 0;
    return { root: 2 * v(seg.sheetRoot, g), tip: 2 * v(seg.sheetTip, g) };
  }
  /* Kennwerte einer Tragfläche i: je Segment Volumen (mm³), Oberfläche (mm²), Beplankungs-
   * volumen (mm³ aus Design-Dicke), Summen; Gewicht in g nach den wt*-Einstellungen.
   * foam = null, wenn der Werkstoff keine Rohdichte hat. */
  function wingWeight(i) {
    const L = wingList(), w = L[i]; if (!w) return null;
    const act = i === state.activeWing;
    const segs = (act ? state.segments : w.segments) || [], root = act ? state.root : w.root;
    const cfg = act ? state.cfg : (w.cfg || {});
    const C = (k) => (cfg[k] != null ? cfg[k] : PROJECT_DEFAULTS.cfg[k]);
    const neg = cfg.design === 'neg';
    const matId = neg ? (cfg.negMatId != null ? cfg.negMatId : state.material.id) : (cfg.matId != null ? cfg.matId : state.material.id);
    const dens = matId ? +App.matField(matId, 'density', 0) || 0 : 0;
    const thickOv = C('wtSheetThick');   // eigene Beplankungsdicke (mm, je Seite) oder null = aus Design
    const out = { segs: [], vol: 0, surf: 0, sheetVol: 0, span: 0, area: 0, dens, matId };
    // Abbrand je Rippe wie beim Kernschnitt (compute.cutKerf): die längere Sehne läuft mit dem
    // Vorschub, die kürzere proportional langsamer -> breiterer Spalt; Werkstoff dieser Tragfläche.
    const fp = matId ? App.feedPair(matId) : null;
    const feed = (App.autoFeedOn() && fp && fp.fast > 0) ? fp.fast : (+state.cfg.feed || 0);
    const kerfAt = (chord, longC) => (matId && feed > 0) ? App.kerfForSpeed(matId, feed * chord / (longC || 1), feed) : null;
    out.feed = feed;
    let prev = root ? { prof: root.profile, chord: +root.chord || 0 } : null;
    segs.forEach(sg => {
      const cur = { prof: sg.profile, chord: +sg.chord || 0 };
      const span = +sg.span || 0;
      let vol = 0, surf = 0, sheetVol = 0, area = 0, kerfRoot = null, kerfTip = null;
      if (prev) {
        area = span * (prev.chord + cur.chord) / 2;
        const longC = Math.max(prev.chord, cur.chord);
        kerfRoot = kerfAt(prev.chord, longC); kerfTip = kerfAt(cur.chord, longC);
        const m1 = profMetrics(prev.prof), m2 = profMetrics(cur.prof);
        const A1 = m1.area * prev.chord * prev.chord, A2 = m2.area * cur.chord * cur.chord;
        const P1 = m1.perim * prev.chord, P2 = m2.perim * cur.chord;
        vol = span / 3 * (A1 + A2 + Math.sqrt(A1 * A2));
        surf = span * (P1 + P2) / 2;
        const sh = sheetSum(cfg, sg);
        const tR = thickOv != null ? 2 * thickOv : sh.root, tT = thickOv != null ? 2 * thickOv : sh.tip;
        // Beplankungsvolumen: halber Umfang je Seite · Dicke, Mittel Wurzel/außen
        sheetVol = span * (P1 * tR / 2 + P2 * tT / 2) / 2;
      }
      out.segs.push({ vol, surf, sheetVol, span, area, kerfRoot, kerfTip });
      out.vol += vol; out.surf += surf; out.sheetVol += sheetVol; out.span += span; out.area += area;
      prev = cur;
    });
    // Gewichte (g): mm³·kg/m³·1e-6, mm²·g/m²·1e-6
    const mode = C('wtSheetMode');
    const sheet = mode === 'density' ? (out.sheetVol - 0) * (+C('wtSheetDensity') || 0) * 1e-6
      : mode === 'area' ? out.surf * (+C('wtSheetArea') || 0) * 1e-6 : 0;
    // Schaumkern = Profilvolumen minus Beplankung (nur wenn die Beplankung mitgerechnet wird)
    const foamVol = Math.max(0, out.vol - (mode === 'none' ? 0 : out.sheetVol));
    const foam = dens > 0 ? foamVol * dens * 1e-6 : null;
    const fab = out.surf * 1e-6 * ((+C('wtFab1Gsm') || 0) * (+C('wtFab1Layers') || 0) + (+C('wtFab2Gsm') || 0) * (+C('wtFab2Layers') || 0));
    const fiber = Math.min(95, Math.max(5, +C('wtFiber') || 50));
    const resin = fab > 0 ? fab * (100 / fiber - 1) : 0;
    const extra = +C('wtExtra') || 0;
    const count = Math.max(1, Math.round(+C('wtCount') || 1));
    const piece = (foam || 0) + sheet + fab + resin + extra;
    Object.assign(out, { foamVol, foam, sheet, fab, resin, extra, count, piece, total: piece * count, mode, fiber });
    return out;
  }

  /* Einstellungen EINER Tragfläche — Reiter „Projektübersicht" (overview.js):
   * Design (Kern/Negativschalen), Werkstoff + Blockdicke, Gewichtsschätzung
   * (Beplankung · Gewebe · Zuschlag) und Aktionen (Duplizieren/Löschen/Reihenfolge).
   * refresh(rebuild): Übersicht (und bei rebuild auch die Seitenleiste) neu aufbauen. */
  function wingSettingsCard(i, card, refresh) {
    const L = wingList(), hint = App.hint;
    const matOpts = App.matOptions ? App.matOptions() : [];
    const mkRow = (body, label) => {
      const row = document.createElement('div'); row.className = 'row full';
      const l = document.createElement('label'); l.textContent = T(label); row.appendChild(l);
      body.appendChild(row); return row;
    };
    // Werkstoff-Auswahl (aus der Werkstoff-Datenbank) je Tragfläche und Kontext.
    const matSel = (body, label, i, key) => {
      const row = mkRow(body, label);
      const sel = document.createElement('select'); sel.style.width = '100%';
      sel.appendChild(new Option(T('— kein Werkstoff —'), ''));
      matOpts.forEach(([id, nm]) => sel.appendChild(new Option(nm, id)));
      const cur = wingCfgGet(i, key), eff = cur != null ? cur : (state.material.id || '');
      sel.value = eff; if (sel.value !== eff) sel.value = '';
      sel.onchange = () => { wingCfgSet(i, key, sel.value); refresh(true); };
      row.appendChild(sel);
    };
    // Dicke (Blockhöhe) je Tragfläche und Kontext.
    const heightNum = (body, label, i, key) => {
      const row = mkRow(body, label);
      const inp = document.createElement('input'); inp.type = 'number'; inp.min = '0'; inp.step = '1';
      inp.style.width = '100%'; inp.style.boxSizing = 'border-box';
      const cur = wingCfgGet(i, key);
      inp.value = cur != null ? cur : (state.material.height != null ? state.material.height : '');
      inp.onchange = () => { const v = parseFloat(inp.value); wingCfgSet(i, key, isFinite(v) && v >= 0 ? v : null); refresh(false); };
      inp.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); } };
      row.appendChild(inp);
    };

    if (!matOpts.length)
      hint(card, 'Noch kein Werkstoff angelegt — bitte zuerst in der „Werkstoff-Datenbank" (Kopfzeile) einen anlegen.');
    // Design-Art der Tragfläche: Kern (Positiv) oder Negativschalen. Danach nur
    // Werkstoff + Dicke für dieses Design; die andere Zuweisung bleibt erhalten.
    const isNeg = wingCfgGet(i, 'design') === 'neg';
    {
      const row = mkRow(card, 'Design');
      const sel = document.createElement('select'); sel.style.width = '100%';
      sel.appendChild(new Option(T('Kern (Positiv)'), 'core'));
      sel.appendChild(new Option(T('Negativschalen'), 'neg'));
      sel.value = isNeg ? 'neg' : 'core';
      sel.title = T('Wird diese Tragfläche als Kern oder als Negativschalen geschnitten? Bestimmt, welcher Werkstoff und welche Dicke hier zugewiesen werden.');
      sel.onchange = () => { wingCfgSet(i, 'design', sel.value === 'neg' ? 'neg' : 'core'); refresh(true); };
      row.appendChild(sel);
    }
    if (isNeg) {
      matSel(card, 'Werkstoff Negativschalen', i, 'negMatId');
      heightNum(card, 'Blockdicke (mm)', i, 'negMatHeight');
    } else {
      matSel(card, 'Werkstoff Kern', i, 'matId');
      heightNum(card, 'Blockdicke (mm)', i, 'matHeight');
    }
    // --- Gewichtsabschätzung: Beplankung, Gewebe/Harz, Zuschlag, Stückzahl ---
    {
      const det = document.createElement('details');
      det.style.cssText = 'margin:4px 0;border-top:1px dashed var(--line);padding-top:4px';
      det.open = !!state._wtOpen && state._wtOpen[wingId ? wingId(i) : i];
      const sum = document.createElement('summary'); sum.textContent = T('Gewicht (Beplankung · Gewebe · Zuschlag)');
      sum.style.cssText = 'cursor:pointer;color:var(--muted);font-size:12px';
      det.appendChild(sum);
      det.ontoggle = () => { state._wtOpen = state._wtOpen || {}; state._wtOpen[wingId ? wingId(i) : i] = det.open; };
      const G = k => { const v = wingCfgGet(i, k); return v != null ? v : PROJECT_DEFAULTS.cfg[k]; };
      const S = (k, v, rebuild) => { wingCfgSet(i, k, v); refresh(!!rebuild); };
      const num = (label, k, opt) => App.numRow(det, label, () => G(k), v => S(k, v), Object.assign({ norender: true, enter: true }, opt || {}));
      const sel = (label, opts, k, h, rebuild) => App.selectRow(det, label, opts, () => String(G(k)), v => S(k, v, rebuild), h);
      hint(det, 'Schätzung aus Profilvolumen (Kegelstumpf je Segment) und Profiloberfläche. Kernmasse = Volumen × Rohdichte des '
        + 'Werkstoffs (Werkstoff-Datenbank); bei Beplankung wird deren Volumen vom Kern abgezogen. Ergebnis rechts in der Projektübersicht.');
      num('Stückzahl (Hälften)', 'wtCount', { min: 1, step: 1, int: true });
      const mode = sel('Beplankung', [['none', 'keine'], ['density', 'Dichte × Dicke'], ['area', 'Flächengewicht (g/m²)']], 'wtSheetMode',
        'Beplankung (Balsa, Abachi, Sperrholz …): aus Rohdichte und Dicke oder direkt als Flächengewicht.', true);
      mode.onchange = () => { S('wtSheetMode', mode.value, true); };
      const sm = G('wtSheetMode');
      if (sm === 'density') {
        num('Rohdichte Beplankung (kg/m³)', 'wtSheetDensity', { min: 0, step: 10, hint: 'Balsa ≈ 100–200, Abachi ≈ 350–400, Sperrholz ≈ 600 kg/m³.' });
        {
          const row = mkRow(det, 'Dicke je Seite (mm)');
          const inp = document.createElement('input'); inp.type = 'text'; inp.inputMode = 'decimal';
          inp.style.width = '100%'; inp.style.boxSizing = 'border-box';
          const cur = wingCfgGet(i, 'wtSheetThick');
          inp.value = cur != null ? cur : ''; inp.placeholder = T('aus Tragflächendesign');
          inp.title = T('Leer = Beplankungsdicke aus dem Tragflächendesign (Gruppe „Beplankung"). Eigener Wert überschreibt sie nur für die Gewichtsrechnung.');
          inp.onchange = () => { const v = App.parseNum ? App.parseNum(inp.value) : parseFloat(inp.value); S('wtSheetThick', isFinite(v) && v >= 0 ? v : null); };
          inp.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); } };
          row.appendChild(inp);
        }
      } else if (sm === 'area') {
        num('Flächengewicht Beplankung (g/m²)', 'wtSheetArea', { min: 0, step: 10, hint: 'Gewicht je m² Oberfläche, z. B. Balsa 1,5 mm ≈ 240 g/m².' });
      }
      // Gewebe: Voreinstellungen (Flächengewicht je Lage) oder eigener Wert, Lagenzahl.
      const FAB = [['0', '— kein Gewebe —'], ['25', 'Glas 25 g/m²'], ['49', 'Glas 49 g/m²'], ['80', 'Glas 80 g/m²'], ['105', 'Glas 105 g/m²'],
        ['163', 'Glas 163 g/m²'], ['93', 'CFK 93 g/m²'], ['160', 'CFK 160 g/m²'], ['200', 'CFK 200 g/m²'], ['245', 'CFK 245 g/m²'],
        ['36', 'Aramid 36 g/m²'], ['61', 'Aramid 61 g/m²'], ['custom', 'eigener Wert']];
      const fabric = (n) => {
        const kG = 'wtFab' + n + 'Gsm', kL = 'wtFab' + n + 'Layers';
        const cur = +G(kG) || 0, known = FAB.some(o => o[0] === String(cur));
        const s = App.selectRow(det, 'Gewebe ' + n, FAB, () => (known ? String(cur) : 'custom'),
          () => {}, n === 1 ? 'Gewebe auf der gesamten Oberfläche (oben und unten). Flächengewicht je Lage; Lagenzahl darunter.' : null);
        s.onchange = () => { if (s.value !== 'custom') S(kG, +s.value, true); else { S(kG, cur || 100, true); } };
        if (!known) num('Flächengewicht (g/m²)', kG, { min: 0, step: 5 });
        if (cur > 0) num('Lagen', kL, { min: 0, step: 1, int: true });
      };
      fabric(1); fabric(2);
      if ((+G('wtFab1Gsm') || 0) > 0 || (+G('wtFab2Gsm') || 0) > 0)
        num('Faser-Gewichtsanteil (%)', 'wtFiber', { min: 5, max: 95, step: 5,
          hint: 'Anteil der Faser am Laminatgewicht. Harz = Gewebe × (100/Anteil − 1). Handlaminat ≈ 30–40 %, Vakuum ≈ 50 %, Prepreg ≈ 60 %.' });
      num('Zuschlag (g)', 'wtExtra', { min: 0, step: 5, hint: 'Feste Zugabe je Stück: Holme, Ruder, Scharniere, Anlenkungen, Lack …' });
      card.appendChild(det);
    }
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:4px';
    const mk = (txt, title, fn) => {
      const b = document.createElement('button'); b.textContent = T(txt); b.title = T(title);
      b.onclick = fn; bar.appendChild(b); return b;
    };
    mk('Duplizieren', 'Tragfläche samt Holmen, Design-Einstellungen und Werkstoff-Zuweisung kopieren.', () => { selectWing(i); duplicateWing(); });
    const del = mk('Löschen', 'Tragfläche aus dem Projekt entfernen.', () => deleteWing(i));
    if (L.length < 2) del.disabled = true;
    if (L.length > 1) {
      const up = mk('▲', 'Tragfläche in der Liste nach oben schieben.', () => moveWing(i, -1));
      const dn = mk('▼', 'Tragfläche in der Liste nach unten schieben.', () => moveWing(i, +1));
      up.disabled = i === 0; dn.disabled = i === L.length - 1;
    }
    card.appendChild(bar);
  }

  function wingSidebar(side) {
    const L = wingList();
    const grp = App.grp, hint = App.hint;
    // --- Folge-Reiter: nur Auswahl ---
    const s = grp('Tragfläche', true, 'wing core neg rib form dxfexport rumpf fraese', { key: 'wingsSelect', alwaysOpen: true });
    {
      const row = document.createElement('div'); row.className = 'row full';
      row.appendChild(wingSelectEl()); s.body.appendChild(row);
    }
    if (L.length < 2)
      hint(s.body, 'Weitere Tragflächen im Reiter „Projektübersicht" anlegen.');
    side.appendChild(s.g);
  }

  // ---- Registry ----
  Object.assign(App, { WING_CFG_KEYS, isWingCfgKey, wingList, wingId, wingName, wingFileTag, withWing, captureWing, applyWing,
    selectWing, wingSelectEl, addWing, duplicateWing, deleteWing, renameWing, moveWing, resetWings,
    serializeWings, restoreWings, wingSidebar, wingSettingsCard, wingCfgGet, wingCfgSet, wingWeight });
})();
