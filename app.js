/* app.js — UI, State, Rendering (Mehrsegment-Flügel) */
(function () {
  'use strict';
  // @@app-imports-begin (automatisch, split_extract.py)
  const App = (window.App = window.App || {});
  const { PAL_DEF, SETTINGS_FILE, T, activeIdx, addFoilDats, applyCoreSplit, applyDxfSplit, applyGcodeEdit, applyHintsMode, applyNegSplit, applySettings } = App;
  const { applySidebarFilter, buildBlockHScene, buildBlockScene, buildCalibScene, buildDxfScene, buildGuillotineScene, buildModelScene, buildNegScene, buildPlateScene } = App;
  const { buildScene, buildSettingsModal, buildSidebar, cadBuildCmdList, cadCancel, cadEditDown, cadEditMove, cadEditUp, cadEnterKey, cadEraseSelection } = App;
  const { cadFinishDraft, cadFlash, cadImportDxfText, cadInputKey, cadJoinSelection, cadLoadBgImage, cadLog, cadMatchOption, cadRedo, cadSetRel } = App;
  const { cadSuggest, cadToggleCmdList, cadUndo, cadUpdateRelButtons, closePc2, closeProfModal, closeSettings, closeSweepCmp, decorateFields } = App;
  const { download, dxfAfterEdit, dxfBgDown, dxfBgMove, dxfBgUp, dxfCanvasClick, dxfCoordApply, dxfEditDown, dxfEditMove, dxfEditUp } = App;
  const { dxfFinishPolyline, dxfImport, dxfLoadBgImage, dxfPathDown, dxfPathMove, dxfPathRedo, dxfPathUndo, dxfPathUp, dxfPushUndo, dxfRedo } = App;
  const { dxfSyncMove, dxfUndo, exportSweepCmpDxf, flashDxf, loadDat, loadDirHandles, loadKerfTrue, loadLineStyles, loadPalette, loadProject } = App;
  const { loadSettingsFromExeFolder, loadSettingsLocal, loadViewPalettes, mgCfg, modelGcode, openSettings, pc2DoImport, plateGcode, processDat } = App;
  const { processPc2, profNavKey, ptEditDbl, ptEditDown, ptEditMove, ptEditUp, ptRedo, ptUndo, recordRecent, refreshNoteMarks } = App;
  const { render, renderCad, renderDxf, renderDxfExport, renderMaterial, renderNeg, renderPc2, renderProfEdit } = App;
  const { renderRib, renderRibPlan, repaintAll, ribStlPreviewClose, saveProject, setGcodeEditMode, setupCoreSplit, setupDraggableOverlays, setupDxfSplit } = App;
  const { setupNav, setupNegElevPick, setupNegSplit, setupPlanPick, setupStlPreviewNav, setupSweepCmpNav, state, svgImport, syncProfSegFilter, toggleLoadMenu, toggleSaveMenu } = App;
  // @@app-imports-end
  // @@app-exports-begin (automatisch, split_extract.py)
  Object.assign(App, { refreshActiveView, switchView });
  // @@app-exports-end
  // ---------- Tabs / Verdrahtung ---------------------------------------
  function switchView(name) {
    const tabChanged = state.activeTab !== name;
    state.activeTab = name;
    // „Kernschneiden" (core) teilt sich die Zeichenansichten mit dem
    // „Tragflächendesigner" (wing) — nur die Sidebar unterscheidet sich.
    const viewName = name === 'core' ? 'wing' : name;
    document.querySelectorAll('.tabs button[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    App.tabMenuUpdate();                               // Aufklappmenüs der Reiterleiste (tabmenu.js)
    { const mb = document.getElementById('btnMatDb'); if (mb) mb.classList.toggle('active', name === 'matdb'); }
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    // Die Ansicht kann im Build fehlen (abgewählte Funktion, z. B. CAD-Bearbeitung):
    // dann auf den Tragflächendesigner zurückfallen statt ins Leere zu schalten.
    const viewEl = document.getElementById(viewName + 'View');
    if (!viewEl) { if (name !== 'wing') switchView('wing'); return; }
    viewEl.classList.add('active');
    // Beim Reiterwechsel immer ganz nach oben: die Ansicht selbst, alle darin
    // scrollbaren Bereiche und die Sidebar (Reiter-spezifischer Inhalt).
    if (tabChanged) {
      viewEl.scrollTop = 0; viewEl.scrollLeft = 0;
      viewEl.querySelectorAll('*').forEach(el => { if (el.scrollTop) el.scrollTop = 0; });
      const side = document.getElementById('side'); if (side) side.scrollTop = 0;
    }
    // Kernschneiden: ohne Aufriss, dafür größere Profil-Darstellung.
    const stack = document.querySelector('#wingView .wing-stack');
    if (stack) stack.classList.toggle('core-mode', name === 'core');
    applyCoreSplit();                                  // Teilerbalken/Zeilenhöhe setzen
    applySidebarFilter();                              // Sidebar an den Reiter anpassen
    // Projektübersicht: keine Seitenleiste, alles mittig (overview.js)
    document.getElementById('app').classList.toggle('nosidebar', name === 'material');
    if (name === 'machine' && window.GrblPanel) GrblPanel.refreshAxes();   // Achsnamen können sich geändert haben
    if (name === 'material' || name === 'matdb') renderMaterial();
    // Untere Status-/Info-Anzeige in Tragflächendesigner und Kernschneiden
    // entfernt (bessere Übersicht) — sie erscheint in keinem Reiter mehr.
    document.getElementById('stat').style.display = 'none';
    requestAnimationFrame(() => {
      if (name === 'wing' || name === 'core') render();
      else if (name === 'neg') { applyNegSplit(); renderNeg(); }
      else if (name === 'dxf' && App.renderDxf) { App.applyDxfSplit(); App.renderDxf(); }
      else if (name === 'dxfexport' && App.renderDxfExport) App.renderDxfExport();
      else if (name === 'rib' && App.renderRib) App.renderRib();
      else if (name === 'rf' && App.renderRf) App.renderRf();
      else if (name === 'cad' && App.renderCad) App.renderCad();
      else if (name === 'model' && window.Model3D) Model3D.show();
      else if (name === 'form' && window.Formenbau) Formenbau.show();
      else if (name === 'rumpf' && window.Rumpf) Rumpf.show();
      else if (name === 'fraese' && window.Fraese) Fraese.show();
      else if (name === 'schrift' && window.Schrift) Schrift.show();
    });
  }
  // Den gerade sichtbaren Reiter vollständig neu zeichnen (mit den aktuellen
  // State-Daten). Wird u. a. nach dem Laden eines Projekts aufgerufen, damit
  // NICHT nur die Tragflächen-Ansicht, sondern JEDER aktive Reiter (Übersicht,
  // 3D-Modell, Formenbau, Rumpf, Fräse, DXF-Export, Rippen, CAD, Schneiden)
  // sofort das neue Projekt zeigt. Die Fall-Liste spiegelt switchView() wider.
  function refreshActiveView() {
    const name = state.activeTab;
    if (name === 'material' || name === 'matdb') renderMaterial();
    else if (name === 'wing' || name === 'core') render();
    else if (name === 'neg') { applyNegSplit(); renderNeg(); }
    else if (name === 'dxf' && App.renderDxf) { App.applyDxfSplit(); App.renderDxf(); }
    else if (name === 'dxfexport' && App.renderDxfExport) App.renderDxfExport();
    else if (name === 'rib' && App.renderRib) App.renderRib();
    else if (name === 'rf' && App.renderRf) App.renderRf();
    else if (name === 'cad' && App.renderCad) App.renderCad();
    else if (name === 'model' && window.Model3D) Model3D.show();
    else if (name === 'form' && window.Formenbau) Formenbau.show();
    else if (name === 'rumpf' && window.Rumpf) Rumpf.show();
    else if (name === 'fraese' && window.Fraese) Fraese.show();
    else if (name === 'schrift' && window.Schrift) Schrift.show();
    else if (name === 'cut' && App.renderBlock) App.renderBlock();
  }
  function wireUp() {
    document.querySelectorAll('.tabs button[data-view]').forEach(b => b.onclick = () => switchView(b.dataset.view));
    // Reiter frei zu Aufklappmenüs gliedern (Einstellungen → Menüleiste); baut die
    // Leiste nach der gespeicherten Gliederung um — erst NACH der Klick-Verdrahtung.
    App.tabMenuInit();
    document.getElementById('btnDlGcode').onclick = () => {
      if (!state.lastGcode) render();
      let nm;
      // Mehrere Tragflächen: Name der aktiven Tragfläche voranstellen (wings.js).
      const wt = App.wingFileTag ? App.wingFileTag() : '';
      if (state.cfg.gcodeSource === 'dxf') nm = 'dxf_form_seg' + ((state.dxf.activeSeg || 0) + 1) + '.gcode';
      else if (state.cfg.gcodeSource === 'neg') nm = (wt ? wt + '_' : '') + 'negativschale_seg' + (activeIdx() + 1) + '.gcode';
      else if (state.cfg.gcodeSource === 'model') nm = (window.Model3D ? Model3D.baseName() : 'modell') + '_seg' + ((mgCfg().seg || 0) + 1) + '.gcode';
      else if (state.cfg.gcodeSource === 'plate') nm = (window.Model3D ? Model3D.baseName() : 'modell') + '_platte.gcode';
      else if (state.cfg.gcodeSource === 'schrift' && window.Schrift) nm = Schrift.fileBase() + '.gcode';
      else nm = (wt || 'tragflaeche') + '_seg' + (activeIdx() + 1) + '.gcode';
      // Vor dem Speichern Achsnamen abfragen (links/rechts, horizontal/vertikal).
      App.exportGcodeAxes(nm, () => (state.lastGcode && state.lastGcode.text) || '');
    };
    document.getElementById('btnCopy').onclick = () => {
      if (App.demoSaveBlocked()) return;   // Kern-Demo: nichts herausgeben
      if (App.demoOn()) { App.toast(T('In der Demo lässt sich der G-Code nicht kopieren.')); return; }
      navigator.clipboard.writeText((state.lastGcode && state.lastGcode.text) || '')
        .then(() => { document.getElementById('gInfo').textContent = T('In Zwischenablage kopiert.'); })
        .catch(() => {});
    };
    // Handische G-Code-Bearbeitung im Reiter „G-Code".
    { const b = document.getElementById('btnEditGcode'); if (b) b.onclick = () => { if (App.demoSaveBlocked()) return; if (state.lastGcode && state.lastGcode.text) setGcodeEditMode(true); }; }
    { const b = document.getElementById('btnEditApply'); if (b) b.onclick = applyGcodeEdit; }
    { const b = document.getElementById('btnEditCancel'); if (b) b.onclick = () => setGcodeEditMode(false); }
    // Ohne G-Code-Erzeugung (Design-Ausgabe) gibt es nichts zu speichern/kopieren:
    // Knöpfe ausblenden, die Simulation läuft über die Bahnvorschau (pathpreview.js).
    if (!App.autoGen) ['btnDlGcode', 'btnCopy', 'btnEditGcode'].forEach(id => { const b = document.getElementById(id); if (b) b.style.display = 'none'; });
    // „↻ Neu erzeugen" gibt es nur mit der Funktion „G-Code-Erzeugung" (gcodegen.js).
    // Ohne Erzeugung wird er zu „↻ Bahnvorschau": geladene Datei verwerfen, zurück zur Vorschau.
    { const b = document.getElementById('btnRegenGcode');
      if (b) {
        if (App.regenGcode) b.onclick = App.regenGcode;
        else {
          b.textContent = T('↻ Bahnvorschau'); b.title = T('Geladene G-Code-Datei verwerfen und wieder die Bahnvorschau aus dem Design zeigen');
          b.onclick = () => { state.lastGcode = null; state.gcodeEdited = false; setGcodeEditMode(false); render(); };
        }
      } }
    // G-Code-Datei in Anzeige + Simulation laden (Explorer-Dialog, Startordner „G-Code laden").
    { const b = document.getElementById('btnLoadGcode');
      if (b) b.onclick = () => App.loadVia({ 'text/plain': ['.gcode', '.nc', '.ngc', '.tap', '.txt'] },
        (t, name) => App.loadGcodeText(t, name), 'fileGcode', 'ldGcode'); }
    { const fg = document.getElementById('fileGcode');
      if (fg) fg.onchange = e => {
        const f = e.target.files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = () => App.loadGcodeText(rd.result, f.name);
        rd.readAsText(f); e.target.value = '';
      }; }
    { const b = document.getElementById('btnSampleDat'); if (b) b.onclick = () => { state.importTarget = { type: 'root' }; loadDat(); }; }
    document.getElementById('fileDat').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => App.processProfileFile(rd.result, f.name);
      rd.readAsText(f); e.target.value = '';
    };
    const fpc2 = document.getElementById('filePc2');
    if (fpc2) fpc2.onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => processPc2(rd.result);
      rd.readAsText(f); e.target.value = '';
    };
    { const b = document.getElementById('pc2Close'); if (b) b.onclick = closePc2; }
    { const b = document.getElementById('pc2Cancel'); if (b) b.onclick = closePc2; }
    { const b = document.getElementById('pc2Import'); if (b) b.onclick = pc2DoImport; }
    { const bd = document.getElementById('pc2Modal');
      if (bd) bd.addEventListener('click', e => { if (e.target === bd) closePc2(); }); }
    window.addEventListener('resize', () => { if (App.pc2dlg) renderPc2(); });
    const ffoils = document.getElementById('fileFoils');
    if (ffoils) ffoils.onchange = e => {
      const list = Array.from(e.target.files || []); if (!list.length) return;
      let pending = list.length; const out = [];
      list.forEach(f => {
        const rd = new FileReader();
        rd.onload = () => { out.push({ name: f.name, text: rd.result }); if (--pending === 0) addFoilDats(out); };
        rd.onerror = () => { if (--pending === 0) addFoilDats(out); };
        rd.readAsText(f);
      });
      e.target.value = '';
    };
    const fdxf = document.getElementById('fileDxf');
    if (fdxf) fdxf.onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { state.dxf.file = f.name; if (App.dxfImport) App.dxfImport(rd.result); };
      rd.readAsText(f); e.target.value = '';
    };
    const fcaddxf = document.getElementById('fileCadDxf');
    if (fcaddxf) fcaddxf.onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { if (App.cadImportDxfText) App.cadImportDxfText(rd.result, f.name); };
      rd.readAsText(f); e.target.value = '';
    };
    const fcadbg = document.getElementById('fileCadBg');
    if (fcadbg) fcadbg.onchange = e => { const f = e.target.files[0]; if (f && App.cadLoadBgImage) App.cadLoadBgImage(f); e.target.value = ''; };
    const fsvg = document.getElementById('fileSvg');
    if (fsvg) fsvg.onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { state.dxf.file = f.name; if (App.svgImport) App.svgImport(rd.result); };
      rd.readAsText(f); e.target.value = '';
    };
    const fbg = document.getElementById('fileBgImg');
    if (fbg) fbg.onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      if (App.dxfLoadBgImage) App.dxfLoadBgImage(f); e.target.value = '';
    };
    const pnEl = document.getElementById('projName');
    if (pnEl) { pnEl.value = state.projectName || ''; pnEl.oninput = () => { state.projectName = pnEl.value; }; }
    // Kopfzeilen-Menüs „Laden" / „Speichern" + „Werkstoff-Datenbank".
    const btnMatDb = document.getElementById('btnMatDb');
    if (btnMatDb) btnMatDb.onclick = () => switchView('matdb');
    const btnLoad = document.getElementById('btnLoad');
    if (btnLoad) btnLoad.onclick = ev => { ev.stopPropagation(); toggleLoadMenu(btnLoad); };
    const btnSave = document.getElementById('btnSave');
    if (btnSave) btnSave.onclick = ev => { ev.stopPropagation(); toggleSaveMenu(btnSave); };
    // Sprung in den Reiter „G-Code" mit passender Quelle (Knöpfe „⚙ G-Code" in
    // Kerndesign/Negativschalendesign/DXF-Formen/3D-Modell sowie Strg+G).
    // Ohne Reiter „G-Code" im Build (Design-exe) bleiben die Knöpfe verborgen.
    const hasGcode = !!document.getElementById('gcodeView');
    function goGcode(src) {
      if (!hasGcode) return;
      if (!src) {   // Kürzel: Quelle aus dem aktuellen Reiter ableiten
        const t = state.activeTab;
        src = t === 'neg' ? 'neg' : t === 'dxf' ? 'dxf' : t === 'model' ? (state.cfg.gcodeSource === 'plate' ? 'plate' : 'model') : t === 'core' ? 'core' : t === 'schrift' ? 'schrift' : null;
      }
      const ok = src === 'core' || src === 'neg' || (src === 'dxf' && App.dxfGcode)
        || ((src === 'model' || src === 'plate') && window.Model3D && Model3D.hasModel())
        || (src === 'schrift' && window.Schrift);
      if (src === 'model' && !ok) { App.toast(T('Kein 3D-Modell geladen — zuerst eine STL-Datei laden.')); return; }
      if (ok) { state.cfg.gcodeSource = src; if (src !== 'model') state.cfg.gcodeSourceLast = src; }
      switchView('gcode');
      buildSidebar(); render();
    }
    document.querySelectorAll('button.to-gcode').forEach(b => {
      if (!hasGcode) { b.style.display = 'none'; return; }
      b.onclick = () => goGcode(b.dataset.gsrc);
    });
    // Tastenkürzel: Strg+G -> Reiter „G-Code", Strg+S -> Projekt speichern (nur beim ersten Mal
    // mit Dialog, danach direkt in dieselbe Datei), Strg+Umschalt+S -> Speichern unter (immer Dialog),
    // Strg+C -> Reiter „Schneiden" (Cut; nur im G-Code-Reiter, wie Knopf „✂ Schneiden",
    // und nur ohne Textauswahl/Eingabefeld, damit Kopieren weiter funktioniert).
    // Browser-Kürzel (Suchen/Speichern-Dialog) werden unterdrückt.
    window.addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); saveProject({ quick: !e.shiftKey }); return; }
      if (k === 'c' && !e.shiftKey) {
        if (state.activeTab !== 'gcode') return;
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const sel = window.getSelection && window.getSelection();
        if (sel && String(sel).length) return;
        e.preventDefault();
        const toCut = document.getElementById('simToCut');
        if (toCut && toCut.style.display !== 'none') toCut.click();
        else if (document.getElementById('cutView')) switchView('cut');
        return;
      }
      if (k === 'g' && !e.shiftKey) { e.preventDefault(); goGcode(null); }
    });
    document.getElementById('fileProj').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { try { loadProject(rd.result); recordRecent(null, f.name); } catch (err) { alert(err.message); } };
      rd.readAsText(f); e.target.value = '';
    };
    const fs = document.getElementById('fileSettings');
    if (fs) fs.onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { try { applySettings(JSON.parse(rd.result)); buildSidebar(); render(); }
                          catch (err) { alert(T('Einstellungen fehlerhaft: ') + err.message); } };
      rd.readAsText(f); e.target.value = '';
    };
    // Reiter „3D-Modell": Datei-Import (STL) und Renderer.
    if (window.Model3D) {
      Model3D.init({ canvasId: 'cModel' });
      const fm = document.getElementById('fileModel3d');
      if (fm) fm.onchange = e => {
        const f = e.target.files[0]; if (!f) return;
        Model3D.loadFile(f).then(() => { buildSidebar(); if (state.activeTab === 'model') Model3D.show(); });
        e.target.value = '';
      };
    }
    Sim3D.init({ canvasId: 'cSim' });    // 3D-Schnittsimulation im G-Code-Tab
    // Reiter „Schneiden"/„Maschine" (GrblPanel, Monitor-Simulation, Blockzurichten):
    // bringt cutpanel.js mit — fehlt die Funktion „machine" im Build, entfällt sie.
    if (App.cutWireUp) App.cutWireUp();
    setupNav('cPlan', 'plan'); setupNav('cElev', 'elev');
    setupNav('cProf', profNavKey); if (App.setupBlock3D) App.setupBlock3D();   // je Reiter (wing/core) eigener Zoom/Pan
    setupNav('cNeg', 'neg', renderNeg);      // Zoom/Pan im Negativschalen-Querschnitt
    // Negativschalendesign, oberes Fenster: Aufriss über die Spannweite —
    // eigener Zoom/Pan, Klick schaltet das Segment aktiv, Teiler ziehbar.
    setupNav('cNegElev', 'negelev', renderNeg);
    setupNegElevPick(); setupNegSplit(); applyNegSplit();
    // Punkte-Editor: Maus auf Kern-/Negativschalen-Canvas (Capture-Phase, damit
    // im Bearbeiten-Modus kein Nav-Pan startet).
    [['cProf', 'prof'], ['cNeg', 'neg']].forEach(([id, which]) => {
      const cv = document.getElementById(id); if (!cv) return;
      cv.addEventListener('mousedown', ev => { if (state.ptEdit.on) ptEditDown(which, ev); }, true);
      cv.addEventListener('mousemove', ev => { if (state.ptEdit.on && state.ptEdit.drag) ptEditMove(which, ev); }, true);
      cv.addEventListener('dblclick', ev => { if (state.ptEdit.on) ptEditDbl(which, ev); }, true);   // Punkt hinzufügen
      cv.addEventListener('contextmenu', ev => { if (state.ptEdit.on) ev.preventDefault(); });     // Rechtsklick = Punkt löschen
    });
    window.addEventListener('mouseup', () => { if (state.ptEdit.on) ptEditUp(); });
    // Rückgängig/Wiederholen im Punkte-Editor (Strg+Z / Strg+Y).
    window.addEventListener('keydown', e => {
      if (!state.ptEdit.on || !(e.ctrlKey || e.metaKey)) return;
      if (state.activeTab !== 'core' && state.activeTab !== 'neg') return;
      const inField = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (inField) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); ptUndo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); ptRedo(); }
    });
    // Verdrahtung der abwählbaren Reiter — die Module bringen sie selbst mit
    // (cad.js / dxfshapes.js / ribs.js). Fehlt eines im Build, entfällt sie.
    if (App.cadWireUp) App.cadWireUp();
    if (App.dxfWireUp) App.dxfWireUp();
    if (App.ribWireUp) App.ribWireUp();
    if (App.rfWireUp) App.rfWireUp();
    // Einstellungen (Farben): Header-Button + Modal.
    const bset = document.getElementById('btnSettings');
    if (bset) bset.onclick = openSettings;
    const sclose = document.getElementById('settingsClose');
    if (sclose) sclose.onclick = closeSettings;
    const smodal = document.getElementById('settingsModal');
    if (smodal) smodal.addEventListener('mousedown', ev => { if (ev.target === smodal) closeSettings(); });
    const sreset = document.getElementById('settingsReset');
    if (sreset) sreset.onclick = () => { App.PAL = Object.assign({}, PAL_DEF); repaintAll(); buildSettingsModal(); };
    window.addEventListener('keydown', ev => { if (ev.key === 'Escape' && smodal && smodal.classList.contains('open')) closeSettings(); });
    setupNav('cProfEdit', 'profedit', renderProfEdit);   // Zoom/Pan Profilbearbeitung
    // Profilbearbeitungs-Fenster: schließen per ×, Klick auf den Hintergrund, Esc.
    const pm = document.getElementById('profEditModal');
    const pmc = document.getElementById('profEditClose');
    if (pmc) pmc.onclick = closeProfModal;
    if (pm) pm.addEventListener('mousedown', e => { if (e.target === pm) closeProfModal(); });
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && App.profModalOpen) closeProfModal(); });
    // Drehungs-Profilvergleich: schließen per ×, Klick auf den Hintergrund, Esc.
    const scm = document.getElementById('sweepCmpModal');
    const scc = document.getElementById('sweepCmpClose');
    if (scc) scc.onclick = closeSweepCmp;
    const scd = document.getElementById('sweepCmpDxf');
    if (scd) scd.onclick = exportSweepCmpDxf;
    if (scm) scm.addEventListener('mousedown', e => { if (e.target === scm) closeSweepCmp(); });
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && App.sweepCmpOpen) closeSweepCmp(); });
    setupSweepCmpNav('cSweepCmpRoot'); setupSweepCmpNav('cSweepCmpTip');
    setupPlanPick();                         // Segmentauswahl per Klick im Grundriss
    setupDraggableOverlays();                // Legenden/Klickmenüs frei verschiebbar
    setupCoreSplit();                        // verschiebbare Teiler (Tragfläche & Kernschneiden)
    if (App.setupDxfSplit) App.setupDxfSplit();   // verschiebbarer Teiler im DXF-Reiter
    if (App.applyDxfSplit) App.applyDxfSplit();
    applyCoreSplit();                        // Teiler/Raster für den Start-Reiter (wing) setzen
    // Segment-Auswahl (Dropdown-Menü) am Profilfenster.
    const psHead = document.getElementById('profSegHead');
    const psList = document.getElementById('profSegList');
    if (psHead) psHead.onclick = e => { e.stopPropagation(); App.profSegOpen = !App.profSegOpen; syncProfSegFilter(); };
    if (psList) psList.addEventListener('click', e => e.stopPropagation());   // Klicks im Menü nicht schließen
    // Klick außerhalb schließt das Menü.
    document.addEventListener('click', () => { if (App.profSegOpen) { App.profSegOpen = false; syncProfSegFilter(); } });
    // Sichtbarkeits-Schalter neben der Profil-Abbildung -> spiegeln state.cfg und
    // halten die Sidebar-Checkboxen synchron.
    document.querySelectorAll('#profToggles input[data-cfg]').forEach(cb => {
      cb.checked = !!state.cfg[cb.dataset.cfg];
      cb.onchange = () => { state.cfg[cb.dataset.cfg] = cb.checked; buildSidebar(); render(); };
    });
    // Profil-Sichtbarkeit (innen/außen/beide) im Zeichenfenster (Kern- & Neg-Ansicht).
    document.querySelectorAll('select[data-show]').forEach(sel => {
      sel.value = state.cfg.ribShow || 'both';
      sel.onchange = () => { state.cfg.ribShow = sel.value; document.querySelectorAll('select[data-show]').forEach(s => s.value = sel.value); render(); };
    });
    window.addEventListener('resize', render);
    window.addEventListener('resize', () => { if (window.Model3D && state.activeTab === 'model') Model3D.resize(); if (window.Formenbau && state.activeTab === 'form') Formenbau.resize(); if (window.Rumpf && state.activeTab === 'rumpf') Rumpf.resize(); if (window.Fraese && state.activeTab === 'fraese') Fraese.resize(); if (window.Schrift && state.activeTab === 'schrift') Schrift.resize(); });
  }

  // Beim Start: gespeicherte Maschinen-/Werkstoff-Einstellungen laden.
  const hadLocal = loadSettingsLocal();
  loadPalette();
  loadLineStyles();
  loadKerfTrue();                      // Abbrandlinien in wahrer Dicke (Anzeige-Vorliebe)
  // Feste Schalter dafür (Kern-/Negativ-Ansicht, Schriften) an ihre Ebene binden (data-ktrue=<Ebene>).
  document.querySelectorAll('input[data-ktrue]').forEach(cb => {
    cb.checked = App.kerfTrueOn(cb.dataset.ktrue);
    cb.onchange = () => App.kerfTrueSet(cb.dataset.ktrue, cb.checked);
  });
  loadViewPalettes();
  loadDirHandles();                    // gemerkte Speicher-/Ladeordner (falls vorhanden)
  App.settingsReady = true;
  // i18n: statisches HTML erfassen und (bei EN) übersetzen; bei Sprachwechsel
  // die dynamischen Ansichten neu aufbauen.
  if (window.I18N) {
    window.I18N.captureStatic(document.body);
    window.I18N.applyStatic();
    window.__onLangChange = () => {
      try { buildSidebar(); } catch (e) {}
      try { App.tabMenuUpdate(); } catch (e) {}
      try { buildSettingsModal(); } catch (e) {}
      try { if (typeof repaintAll === 'function') repaintAll(); else render(); } catch (e) {}
      try { if (state.activeTab === 'dxf' && typeof renderDxf === 'function') renderDxf(); } catch (e) {}
    };
  }
  App.setupFieldObserver();   // ?/📝-Paar-Beobachter (sidebar.js) erst jetzt, wie vor der Modultrennung
  buildSidebar(); wireUp(); render();
  // Start-Reiter: „Projektübersicht und Werkstoffzuordnung“ (Reiter-Kennung 'material').
  switchView('material');
  App.applyDemoUi();  // Demo: Speichern/Kopieren/Bearbeiten des G-Codes sperren
  applyHintsMode();   // gewählte Darstellung der Funktionsbeschreibungen anwenden
  decorateFields();   // ?-Beschreibungs- und 📝-Notiz-Umschalter (als Paar) setzen
  refreshNoteMarks();
  // exe-Server: Datei neben der exe hat Vorrang und wird automatisch geladen.
  loadSettingsFromExeFolder();
  // Externe Datei im Programmordner als Seed, falls noch nichts gespeichert war
  // (Fallback für den Fall, dass kein exe-Server mit /__settings__ läuft).
  if (!hadLocal && typeof fetch === 'function') {
    fetch(SETTINGS_FILE).then(r => r.ok ? r.json() : null).then(s => {
      if (s && !App.userEdited) { applySettings(s); buildSidebar(); render(); }
    }).catch(() => {});
  }
})();
