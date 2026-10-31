// undo.js — gemeinsames Rückgängig/Wiederholen (Strg+Z / Strg+Y bzw. Strg+Umschalt+Z) für alle
// Reiter, in denen mit der Maus gezeichnet oder gezogen wird und die keinen eigenen Verlauf haben.
// CAD, DXF-Formen, Punkte-Editor, 3D-Bearbeitung und Rumpf-Pro behalten ihren eigenen.
// Prinzip: Die Reiter halten ihre Daten in state.cfg. Nach jeder Bedienung (Maus los, Feld geändert,
// Taste los) wird je cfg-Schlüssel verglichen; ein Schritt speichert nur die geänderten Schlüssel.
// Änderungen ohne Bedienung (Selbst-Ergänzung, Übergabe aus anderen Reitern) ergeben keinen Schritt.
(function () {
  'use strict';
  const { state, T } = App;
  const TABS = new Set(['rumpf', 'cockpit', 'decal', 'fraese', 'ausschnitt', 'schrift', 'form', 'rprob', 'rpss', 'model']);
  const MAX_STEPS = 100, MAX_KEY_SIZE = 5e6;   // größere Werte (eingebettete Netze/Bilder) laufen nicht mit
  const MG = '@modelGcode';                    // 3D-Modell: Segmentpaar/Platte liegen in state.modelGcode
  // Nur Ansicht/Auswahl: ändert sich mit, ist aber kein eigener Schritt.
  const VIEW_KEY = /(View|Sel|Cam|Zoom|Pan|Pt)$/;
  const VIEW_NESTED = new Set(['view', 'sel', 'freeSel']);   // dasselbe innerhalb der Objekte cfg.decals/cockpit/…
  const hist = {};
  let base = null, baseWing = null, touched = false, gestureTab = null, wheelTimer = 0;

  function strip(v) {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return JSON.stringify(v);
    return JSON.stringify(v, function (k, x) { return this === v && VIEW_NESTED.has(k) ? undefined : x; });
  }
  function snap() {
    const o = new Map();
    for (const k of Object.keys(state.cfg)) {
      const s = strip(state.cfg[k]);
      if (s !== undefined && s.length <= MAX_KEY_SIZE) o.set(k, s);
    }
    if (state.activeTab === 'model' && state.modelGcode) o.set(MG, strip(state.modelGcode));
    return o;
  }
  const stack = tab => hist[tab] || (hist[tab] = { undo: [], redo: [] });
  function rebase() { base = snap(); baseWing = state.activeWing; }
  // Stand mit der Basis vergleichen; bei Bedienung im selben Reiter wird daraus ein Schritt.
  function commit() {
    const tab = gestureTab, was = touched; touched = false;
    if (!base || state.activeWing !== baseWing) { reset(); return; }   // Tragfläche gewechselt: Schlüssel gehören einer anderen
    if (!was || !tab || tab !== state.activeTab) { rebase(); return; }
    const cur = snap(), diff = [];
    for (const k of new Set([...base.keys(), ...cur.keys()])) {
      const a = base.get(k), b = cur.get(k);
      if (a === b || VIEW_KEY.test(k)) continue;
      if (a === undefined && !/^[[{]/.test(b)) continue;   // Vorgabe erstmals angelegt
      diff.push([k, a, b]);
    }
    base = cur;
    if (!diff.length) return;
    const h = stack(tab); h.undo.push(diff); if (h.undo.length > MAX_STEPS) h.undo.shift();
    h.redo.length = 0;
  }
  function setKey(k, s) {
    const live = k === MG ? state.modelGcode : state.cfg[k];
    if (s === undefined) { if (k !== MG) delete state.cfg[k]; return; }
    const v = JSON.parse(s);
    // Ansicht/Auswahl bleibt wie jetzt; die Auswahl kann auf ein Teil zeigen, das es nicht mehr gibt.
    if (v && live && typeof v === 'object' && typeof live === 'object') VIEW_NESTED.forEach(n => { if (n in live && !(n in v)) v[n] = typeof live[n] === 'number' ? 0 : live[n]; });
    if (k === MG) state.modelGcode = v; else state.cfg[k] = v;
  }
  function step(back) {
    const tab = state.activeTab;
    if (touched) { gestureTab = tab; commit(); }
    const h = stack(tab), from = back ? h.undo : h.redo, to = back ? h.redo : h.undo;
    if (!from.length) { if (App.toast) App.toast(T(back ? 'Nichts rückgängig zu machen.' : 'Nichts zu wiederholen.')); return; }
    const diff = from.pop(); to.push(diff);
    for (const [k, a, b] of diff) setKey(k, back ? a : b);
    if (App.buildSidebar) App.buildSidebar();
    if (tab === 'model' && window.Model3D) { if (state.cfg.gcodeSource === 'model' || state.cfg.gcodeSource === 'plate') App.render(); Model3D.refresh(); }
    else if (App.refreshActiveView) App.refreshActiveView();
    rebase();
  }
  function reset() { for (const k of Object.keys(hist)) delete hist[k]; touched = false; base = null; rebase(); }

  const isField = el => !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  const later = () => setTimeout(() => { if (touched) commit(); }, 0);   // nach den Handlern der Reiter
  // Beginn einer Bedienung: Getipptes noch als eigenen Schritt sichern, sonst Fremdänderungen übernehmen.
  function begin() {
    if (touched) commit(); else rebase();
    gestureTab = state.activeTab; touched = true;
  }
  window.addEventListener('mousedown', e => {
    const onCanvas = e.target instanceof HTMLCanvasElement;
    // Klick in die Zeichenfläche beendet die Feldeingabe (sonst fängt das Feld das Strg+Z ab),
    // auch dort, wo ein Reiter das Standardverhalten unterdrückt. Das CAD führt sein Eingabefeld selbst.
    if (onCanvas && state.activeTab !== 'cad' && isField(document.activeElement)) document.activeElement.blur();
    if (TABS.has(state.activeTab)) begin();
  }, true);
  window.addEventListener('mouseup', () => { if (touched) later(); }, true);
  window.addEventListener('click', () => { if (touched) later(); }, true);
  document.addEventListener('input', () => { if (TABS.has(state.activeTab) && !touched) { gestureTab = state.activeTab; touched = true; } }, true);
  document.addEventListener('change', () => { if (TABS.has(state.activeTab)) { gestureTab = state.activeTab; touched = true; later(); } }, true);
  window.addEventListener('wheel', e => {   // Alt+Rad skaliert/dreht Hintergrundbilder
    if (!e.altKey || !TABS.has(state.activeTab)) return;
    if (!touched) begin();
    clearTimeout(wheelTimer); wheelTimer = setTimeout(later, 400);
  }, { passive: true, capture: true });
  window.addEventListener('keydown', e => {
    if (!TABS.has(state.activeTab)) return;
    const inField = isField(document.activeElement);
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      if (inField && document.activeElement.tagName !== 'SELECT') return;   // Textfeld: Rückgängig des Browsers
      e.preventDefault(); e.stopImmediatePropagation();
      step(k === 'z' && !e.shiftKey);
      return;
    }
    if (!inField && !e.repeat && !/^(Shift|Control|Alt|Meta)$/.test(e.key)) begin();
  }, true);
  window.addEventListener('keyup', e => {
    if (!TABS.has(state.activeTab) || !touched) return;
    if (!isField(document.activeElement) || e.key === 'Enter') later();
  }, true);

  Object.assign(App, { undoReset: reset, undoStep: step });
})();
