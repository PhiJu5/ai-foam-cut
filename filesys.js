/* filesys.js — Dateizugriff, Projekt laden/speichern, Einstellungen, Lade-/Speichermenüs  (@@split-module, ausgelagert aus app.js)
 * Namen aus früher geladenen Dateien werden unten aus window.App gebunden;
 * Namen aus app.js (lädt später) laufen als App.<name>. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { GLOBAL_DRAW_KEYS, LINE_STYLES, LST_DEFAULT, LST_KEYS, PAL_DEF, PAL_GROUPS, PER_VIEW_KEYS, PER_VIEW_LABEL, PROJECT_DEFAULTS, T } = App;
  const { VIEWS, VLST, VPAL, applyPalette, applyView, copyViewSettings, dxfResolve, mkSeg, parseSvgToLayers, renderDxf } = App;
  const { saveFilePicker, savePalette, saveViewPalettes, state, toast } = App;
  // ---------- Datei-Speicher-/Ladeorte (File System Access API) -------
  // Merkt sich Ordner-Handles in IndexedDB; danach werden Dateien direkt in den
  // Speicherordner geschrieben und der Ladedialog im Ladeordner geöffnet.
  // Speicherordner (save) + eigene Ladeordner je Dateityp.
  const DIR_KEYS = ['save', 'svProject', 'svSettings', 'svMaterial', 'svDat', 'svDxf', 'svGcode', 'svStl',
    'ldProject', 'ldSettings', 'ldMaterial', 'ldDat', 'ldDxf', 'ldSvg', 'ldStl', 'ldImg'];
  // Startordner aller Explorer-Dialoge, solange kein fester Ordner gewählt ist:
  // der Windows-Ordner „Dokumente" (well-known directory der FS-Access-API).
  const DIR_DEFAULT = 'documents';
  const DIR_REMIND_KEY = 'hotwing-dirReminded';
  // Startordner eines Dialogs: typeigener Ordner, sonst Standardordner „save"
  // (gilt für ALLE Dateien, Speichern und Laden), sonst „Dokumente".
  function startDir(which) { return (which && dirHandles[which]) || dirHandles.save || DIR_DEFAULT; }
  // Zuletzt gewählter Ordner je DATEIFORMAT: Der Browser merkt sich pro Picker-
  // `id` den zuletzt benutzten Ordner (z. B. „.dat laden" -> nächster .dat-Dialog
  // startet dort). Der Einstellungsordner (startDir) wird nur beim allerersten
  // Dialog eines Formats bzw. nach Neuwahl des Ordners in den Einstellungen
  // vorgegeben — sonst würde er den gemerkten Ordner überschreiben.
  const DIR_USED_KEY = 'hotwing-dirUsed';
  function dirFormat(which, ext) {
    let f = (which || '').replace(/^(sv|ld)/, '').toLowerCase();
    if (!f || f === 'save') f = String(ext || '').replace(/^\./, '').toLowerCase() || 'save';
    if (f === 'txt' || f === 'cor') f = 'dat';
    if (f === 'jpg' || f === 'jpeg' || f === 'png' || f === 'gif' || f === 'bmp' || f === 'webp') f = 'img';
    if (f === 'nc' || f === 'tap') f = 'gcode';
    return 'foamcut-' + f.replace(/[^a-z0-9_-]/g, '');
  }
  function dirUsed() { try { return JSON.parse(localStorage.getItem(DIR_USED_KEY) || '[]'); } catch (e) { return []; } }
  function acceptExt(accept) { try { const v = accept && Object.values(accept)[0]; return v && v[0]; } catch (e) { return ''; } }
  // Optionen für showOpen-/showSaveFilePicker: id je Format; startIn nur solange
  // dieses Format noch keinen gemerkten Ordner hat.
  function pickerOpts(which, ext) {
    const id = dirFormat(which, ext), o = { id };
    if (!dirUsed().includes(id)) o.startIn = startDir(which);
    return o;
  }
  function markDirUsed(which, ext) {
    const id = dirFormat(which, ext), u = dirUsed();
    if (!u.includes(id)) { u.push(id); try { localStorage.setItem(DIR_USED_KEY, JSON.stringify(u)); } catch (e) {} }
  }
  // Ordner in den Einstellungen neu gewählt/gelöscht: Merker des Formats
  // verwerfen, damit der nächste Dialog wieder im Einstellungsordner startet.
  function resetDirUsed(which) {
    try {
      if (which === 'save') { localStorage.removeItem(DIR_USED_KEY); return; }
      const id = dirFormat(which);
      localStorage.setItem(DIR_USED_KEY, JSON.stringify(dirUsed().filter(x => x !== id)));
    } catch (e) {}
  }
  const dirHandles = {}; DIR_KEYS.forEach(k => dirHandles[k] = null);
  const FS_SUPPORTED = !!(window.showDirectoryPicker && window.showOpenFilePicker);
  function fsIdb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('hotwing-fs', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('handles');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function fsSet(key, val) { const db = await fsIdb(); return new Promise((res, rej) => { const t = db.transaction('handles', 'readwrite'); t.objectStore('handles').put(val, key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
  async function fsGet(key) { const db = await fsIdb(); return new Promise((res, rej) => { const t = db.transaction('handles', 'readonly'); const rq = t.objectStore('handles').get(key); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); }
  async function fsDel(key) { const db = await fsIdb(); return new Promise((res) => { const t = db.transaction('handles', 'readwrite'); t.objectStore('handles').delete(key); t.oncomplete = () => res(); }); }
  async function fsPerm(handle, mode) {
    if (!handle) return false;
    const opt = { mode };
    try { if ((await handle.queryPermission(opt)) === 'granted') return true; return (await handle.requestPermission(opt)) === 'granted'; }
    catch (e) { return false; }
  }
  async function loadDirHandles() {
    if (!FS_SUPPORTED) return;
    for (const k of DIR_KEYS) { try { dirHandles[k] = (await fsGet('dir_' + k)) || null; } catch (e) {} }
  }
  async function pickDir(which) {
    if (!FS_SUPPORTED) { alert(T('Dieser Browser unterstützt keine Ordnerauswahl (File System Access API). Chrome/Edge am Desktop nutzen.')); return; }
    try {
      const writeMode = which === 'save' || which.startsWith('sv');
      const h = await window.showDirectoryPicker({ mode: writeMode ? 'readwrite' : 'read', startIn: startDir(which) });
      dirHandles[which] = h; await fsSet('dir_' + which, h); resetDirUsed(which);
      buildSettingsModal();
    } catch (e) { /* Abbruch */ }
  }
  async function clearDir(which) { dirHandles[which] = null; await fsDel('dir_' + which); resetDirUsed(which); buildSettingsModal(); }
  // Ordnerbaum: Unterordner je Dateityp unterhalb eines gewählten Wurzelordners
  // (z. B. Dokumente\AI Foam Cut) anlegen und alle Startordner automatisch darauf
  // setzen. Jede Zeile in den Einstellungen bleibt danach einzeln nachjustierbar.
  const DIR_TREE = [
    ['Projekte',      ['svProject', 'ldProject']],
    ['Einstellungen', ['svSettings', 'ldSettings']],
    ['Werkstoffe',    ['svMaterial', 'ldMaterial']],
    ['G-Code',        ['svGcode']],
    ['Profile',       ['svDat', 'ldDat']],
    ['DXF',           ['svDxf', 'ldDxf']],
    ['STL',           ['svStl', 'ldStl']],
    ['SVG',           ['ldSvg']],
    ['Bilder',        ['ldImg']],
  ];
  async function createDirTree() {
    if (!FS_SUPPORTED) { alert(T('Dieser Browser unterstützt keine Ordnerauswahl (File System Access API). Chrome/Edge am Desktop nutzen.')); return; }
    let root;
    try { root = await window.showDirectoryPicker({ mode: 'readwrite', startIn: dirHandles.save || DIR_DEFAULT }); }
    catch (e) { return; }                                  // Abbruch
    if (!(await fsPerm(root, 'readwrite'))) { alert(T('Keine Schreibfreigabe für den gewählten Ordner.')); return; }
    const made = [];
    try {
      dirHandles.save = root; await fsSet('dir_save', root);
      for (const [name, keys] of DIR_TREE) {
        const h = await root.getDirectoryHandle(name, { create: true });
        made.push(name);
        for (const k of keys) { dirHandles[k] = h; await fsSet('dir_' + k, h); resetDirUsed(k); }
      }
    } catch (e) { alert(T('Ordnerbaum konnte nicht vollständig angelegt werden: ') + (e && e.message ? e.message : e)); }
    try { localStorage.setItem(DIR_REMIND_KEY, '1'); } catch (e) {}
    buildSettingsModal();
    toast(T('Ordnerbaum angelegt in ') + (root.name || T('Ordner')) + ': ' + made.join(', '));
  }
  // Vorhandenen Ordnerbaum wieder verknüpfen (z. B. nach Neuinstallation oder auf
  // einem zweiten Rechner): Wurzelordner wählen, nichts neu anlegen, nur die
  // bereits vorhandenen Unterordner als Startordner eintragen.
  async function useDirTree() {
    if (!FS_SUPPORTED) { alert(T('Dieser Browser unterstützt keine Ordnerauswahl (File System Access API). Chrome/Edge am Desktop nutzen.')); return; }
    let root;
    try { root = await window.showDirectoryPicker({ mode: 'readwrite', startIn: dirHandles.save || DIR_DEFAULT }); }
    catch (e) { return; }                                  // Abbruch
    if (!(await fsPerm(root, 'readwrite'))) { alert(T('Keine Schreibfreigabe für den gewählten Ordner.')); return; }
    const found = [], miss = [];
    dirHandles.save = root; await fsSet('dir_save', root);
    for (const [name, keys] of DIR_TREE) {
      let h = null;
      try { h = await root.getDirectoryHandle(name, { create: false }); } catch (e) { h = null; }
      if (!h) { miss.push(name); continue; }
      found.push(name);
      for (const k of keys) { dirHandles[k] = h; await fsSet('dir_' + k, h); resetDirUsed(k); }
    }
    try { localStorage.setItem(DIR_REMIND_KEY, '1'); } catch (e) {}
    buildSettingsModal();
    if (!found.length) { alert(T('In diesem Ordner wurde kein Ordnerbaum gefunden. Bitte den Wurzelordner wählen (z. B. Dokumente\\AI Foam Cut) oder den Ordnerbaum neu anlegen.')); return; }
    toast(T('Ordnerbaum verknüpft aus ') + (root.name || T('Ordner')) + ': ' + found.join(', ')
      + (miss.length ? ' — ' + T('fehlen: ') + miss.join(', ') : ''));
  }
  // Einmalige Erinnerung beim ERSTEN Speichern/Exportieren ohne festen Ordner:
  // Ordner (z. B. Dokumente\AI Foam Cut) anlegen und in den Einstellungen wählen.
  // Rückgabe true = Nutzer will zuerst die Einstellungen öffnen (Speichern abbrechen).
  function dirReminder(which) {
    if (!FS_SUPPORTED) return false;
    if ((which && dirHandles[which]) || dirHandles.save) return false;
    let seen = false; try { seen = !!localStorage.getItem(DIR_REMIND_KEY); } catch (e) {}
    if (seen) return false;
    try { localStorage.setItem(DIR_REMIND_KEY, '1'); } catch (e) {}
    const go = window.confirm(T('Noch kein Speicherordner festgelegt.') + '\n\n'
      + T('Empfehlung: unter „Dokumente" einen Ordner „AI Foam Cut" anlegen — am einfachsten über „Einstellungen → Dateien → Ordnerbaum anlegen…" (legt Unterordner je Dateityp an und verknüpft sie automatisch). Der Explorer-Dialog startet dann immer dort.') + '\n\n'
      + T('Einstellungen jetzt öffnen? (Abbrechen = diesmal Speicherort im Dialog wählen)'));
    if (go) { settingsTab = 'files'; openSettings(); }
    return go;
  }
  // Anker-Download (Fallback, wenn kein Speicherordner gesetzt / nicht unterstützt).
  // `which` = Picker-id (DIR_KEYS); in der Design-Ausgabe ist nur 'svProject' erlaubt.
  function anchorDownload(name, text, mime, which) {
    if (App.demoSaveBlocked && App.demoSaveBlocked(which)) return;   // Kern-/Design-Sperre: nichts schreiben
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const a = document.getElementById('dl');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  // Schreibt direkt in einen FEST gewählten Speicherordner: zuerst der typeigene
  // (svProject/svSettings), sonst der allgemeine Speicherordner (save). Nur wenn
  // kein Ordner gesetzt ist bzw. die Freigabe fehlt, kommt der Datei-Dialog.
  async function saveToDir(name, text, which) {
    if (App.demoSaveBlocked && App.demoSaveBlocked(which)) return true;   // Kern-/Design-Sperre: nichts schreiben
    const h = (which && dirHandles[which]) || dirHandles.save;
    if (!h) return false;
    if (!(await fsPerm(h, 'readwrite'))) return false;
    const fh = await h.getFileHandle(name, { create: true });
    const w = await fh.createWritable(); await w.write(text); await w.close();
    toast('Gespeichert: ' + name + '  (' + (h.name || 'Ordner') + ')');
    return true;
  }
  // Datei aus dem Ladeordner öffnen (Dialog startet dort). Rückgabe {name,text} oder null.
  async function pickTextFile(accept, which) {
    if (!FS_SUPPORTED) return null;
    const opts = pickerOpts(which, acceptExt(accept));
    if (accept) opts.types = [{ description: 'Dateien', accept }];
    const [fh] = await window.showOpenFilePicker(opts);
    markDirUsed(which, acceptExt(accept));
    const f = await fh.getFile(); return { name: f.name, text: await f.text(), handle: fh };
  }
  // Profil-.dat verarbeiten (aus Datei-Input ODER Ladeordner) für das aktuelle importTarget.
  function processDat(text) {
    try {
      const prof = Airfoil.parseDat(text);
      const t = state.importTarget || { type: 'root' };
      const tid = t.type === 'root' ? 'root' : t.idx;
      // Endleistendicke beim Laden automatisch auf 0 schließen (scharfe EL). Das
      // geladene Original bleibt als Editier-Basis (profBase) erhalten -> „Reset"
      // bzw. eine spätere Endleistendicke > 0 im Profil-Editor stellt es wieder her.
      const closed = App.closeLoadedTE(prof);
      const orig = prof.map(p => ({ x: p.x, y: p.y })); orig.name = prof.name;
      state.profBase[String(tid)] = orig;
      if (t.type === 'root') state.root.profile = closed; else state.segments[t.idx].profile = closed;
      if (App.profModalOpen && String(state.profEdit.target) === String(tid)) {
        state.profEdit.points = orig.length;
        state.profEdit.teMM = 0;
        App.buildProfEditControls(); App.renderProfEdit();
      }
      App.buildSidebar(); App.render();
    } catch (err) { alert(T('Import fehlgeschlagen: ') + T(err.message)); }
  }
  function loadDat() { loadVia({ 'text/plain': ['.dat', '.bez', '.txt', '.cor'] }, processDat, 'fileDat', 'ldDat'); }
  // Profil aus beliebiger unterstützter Datei: Endung entscheidet (DXF/SVG ->
  // größte Kontur in .dat wandeln), sonst .dat/.bez direkt parsen.
  function processProfileFile(text, name) {
    const ext = String(name || '').toLowerCase().replace(/^.*\./, '');
    let dat = text;
    try {
      if (ext === 'dxf') dat = dxfToProfileDat(text);
      else if (ext === 'svg') dat = layersToProfileDat(parseSvgToLayers(text), 'Profil (SVG)');
    } catch (e) { alert(T('Import fehlgeschlagen: ') + T(e.message)); return; }
    processDat(dat);
  }
  // Ein Dialog für alle Profilformate (.dat, .bez, .dxf, .svg).
  function loadProfileAny() {
    loadVia({ 'text/plain': ['.dat', '.bez', '.txt', '.cor'], 'application/dxf': ['.dxf'], 'image/svg+xml': ['.svg'] },
      processProfileFile, 'fileDat', 'ldDat');
  }

  // ---- Tragflächen-Import aus Fremdprogrammen ------------------------------
  // FLZ_Vortex und XFLR5 legen in einer Datei fast immer MEHRERE Flügel ab
  // (Tragfläche, Höhen-, Seitenleitwerk), XFLR5-Projekte zusätzlich mehrere
  // Modelle. Deshalb wird nicht mehr stillschweigend „der Hauptflügel" gewählt,
  // sondern alles Gefundene im Auswahlfenster (wingimport.js) angeboten: je
  // Flügel „übernehmen ja/nein" und das Ziel im Projekt.

  // Datei als ArrayBuffer holen — die nativen Formate sind binär (.xfl) bzw.
  // Windows-1252-kodiert (.flz); beides überlebt file.text() (UTF-8) nicht.
  async function pickBinary(accept, which) {
    if (FS_SUPPORTED && window.showOpenFilePicker) {
      const opts = pickerOpts(which, acceptExt(accept));
      if (accept) opts.types = [{ description: 'Dateien', accept }];
      const [fh] = await window.showOpenFilePicker(opts);
      markDirUsed(which, acceptExt(accept));
      const f = await fh.getFile();
      return { name: f.name, buf: await f.arrayBuffer() };
    }
    // Ohne File-System-Access-API: verstecktes <input type=file> bemühen.
    // (acceptExt liefert nur die erste Endung — hier werden alle gebraucht.)
    const exts = [];
    Object.values(accept || {}).forEach(v => (v || []).forEach(e => exts.push(e)));
    return await new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = exts.join(',');
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        resolve(f ? { name: f.name, buf: await f.arrayBuffer() } : null);
      };
      inp.click();
    });
  }
  const utf8 = buf => new TextDecoder('utf-8').decode(buf);

  // FLZ_Vortex: natives Projekt (.flz) oder CSV-Export. Beide bringen die
  // Profilkoordinaten mit.
  async function loadFlz() {
    let file;
    try { file = await pickBinary({ 'application/octet-stream': ['.flz'], 'text/csv': ['.csv', '.txt'] }, 'ldFlz'); }
    catch (e) { if (e && e.name === 'AbortError') return; alert(T('Datei nicht lesbar: ') + T(e.message)); return; }
    if (!file) return;
    try {
      if (!window.FLZ) throw new Error(T('FLZ-Modul fehlt.'));
      // .flz ist Windows-1252; der CSV-Export ebenso. UTF-8 nur, wenn die
      // Datei sauber als UTF-8 dekodierbar ist (sonst Umlaute als Fragezeichen).
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(file.buf); }
      catch (e) { text = FLZ.decode1252(file.buf); }
      const parsed = FLZ.parseAny(text);
      const items = App.wingImportItemsFlz(parsed);
      App.wingImportOpen(items, {
        title: T('FLZ_Vortex-Import: ') + file.name,
        note: T('FLZ beschreibt jeden Flügel von Spitze zu Spitze; übernommen wird eine Hälfte (Wurzel nach außen) — genau das, was der Tragflächendesigner schneidet. Der Einstellwinkel der Fläche wird NICHT auf die Rippen angewandt.')
      });
    } catch (err) { alert(T('FLZ-Import fehlgeschlagen: ') + T(err.message)); }
  }

  // XFLR5: natives Projekt (.xfl, mit Profilkoordinaten) oder plane-XML
  // (nur Planform — Profile müssen als .dat nachgeladen werden).
  async function loadXflr() {
    let file;
    try { file = await pickBinary({ 'application/octet-stream': ['.xfl'], 'application/xml': ['.xml'] }, 'ldXflr'); }
    catch (e) { if (e && e.name === 'AbortError') return; alert(T('Datei nicht lesbar: ') + T(e.message)); return; }
    if (!file) return;
    try {
      if (!window.XFLR5) throw new Error(T('XFLR5-Modul fehlt.'));
      // Endung entscheidet; bei abweichendem Namen hilft die Formatkennung
      // am Dateianfang (200001/200002 = XFLR5-Projekt).
      const tag = file.buf.byteLength >= 4 ? new DataView(file.buf).getInt32(0) : 0;
      const isXfl = /\.xfl$/i.test(file.name) || tag === 200001 || tag === 200002;
      let parsed, note;
      if (isXfl) {
        parsed = XFLR5.parseXfl(file.buf);
        // Profile der Datei in die Namensbibliothek übernehmen — so greifen sie
        // auch bei später importierten plane-XML derselben Modelle.
        state.xflrFoils = state.xflrFoils || {};
        Object.keys(parsed.foils).forEach(k => { state.xflrFoils[k] = parsed.foils[k]; });
        note = T('XFLR5-Projekt: enthält die Profilkoordinaten, sie werden mit übernommen. Der Einstellwinkel (Tilt) der Fläche wird NICHT auf die Rippen angewandt.');
      } else {
        parsed = XFLR5.parse(utf8(file.buf));
        parsed.planes = [{ name: '', wings: parsed.wings }];
        note = T('plane-XML: enthält KEINE Profilkoordinaten, nur die Namen. Für die fehlenden Profile werden Platzhalter gesetzt — danach über „Profile (.dat) zuordnen…" laden.');
      }
      const foils = Object.assign({}, state.xflrFoils || {}, parsed.foils || {});
      const items = App.wingImportItemsXflr(parsed, foils);
      App.wingImportOpen(items, { title: T('XFLR5-Import: ') + file.name, note: note });
    } catch (err) { alert(T('XFLR5-Import fehlgeschlagen: ') + T(err.message)); }
  }

  // Platzhalterprofil aus dem XFLR5-Import erkennen (Name enthält den Marker).
  function isPlaceholderProfile(p) {
    return !!(p && p.name && /Platzhalter/i.test(p.name));
  }

  // Foil-.dat-Dateien einlesen und über den Namen den Rippen zuordnen. Baut eine
  // Map normName -> Profil auf (state.xflrFoils) und weist sie allen Rippen zu,
  // deren gespeicherter Foil-Name (root/segment .foilName, aus dem XFLR5-Import)
  // passt. Robust für Mehrfachauswahl; unbenannte/ungültige Dateien werden
  // übersprungen.
  function addFoilDats(files) {
    if (!window.XFLR5) return;
    state.xflrFoils = state.xflrFoils || {};
    let added = 0;
    for (const f of files) {
      try {
        const prof = Airfoil.parseDat(f.text);
        // Schlüssel aus Dateiname (ohne Endung) UND aus dem Profilnamen in der
        // Datei — so greift die Zuordnung unabhängig davon, welcher dem XFLR5-
        // Foil-Namen entspricht.
        const base = String(f.name || '').replace(/\.[^.]+$/, '');
        state.xflrFoils[XFLR5.normName(base)] = prof;
        if (prof.name) state.xflrFoils[XFLR5.normName(prof.name)] = prof;
        added++;
      } catch (e) { /* Datei ohne gültiges Profil überspringen */ }
    }
    const res = applyFoilsToWing();
    App.buildSidebar(); App.render();
    const miss = res.missing;
    alert(T('Profile geladen: ') + added + '. '
      + T('Zugeordnet: ') + res.assigned + '.'
      + (miss.length ? ('\n\n' + T('Noch offen (kein passendes .dat gefunden): ')
          + '\n• ' + miss.join('\n• ')) : ('\n\n' + T('Alle Profile zugeordnet.'))));
  }
  // Weist Profile aus state.xflrFoils allen Rippen mit passendem .foilName zu.
  // Rückgabe { assigned, missing:[Name] }.
  function applyFoilsToWing() {
    const lib = state.xflrFoils || {};
    let assigned = 0; const missing = [];
    const use = (holder, setter) => {
      const fn = holder.foilName; if (!fn) return;
      const hit = lib[XFLR5.normName(fn)];
      if (hit) { const c = hit.map(p => ({ x: p.x, y: p.y })); c.name = fn; setter(c); assigned++; }
      else if (missing.indexOf(fn) < 0) missing.push(fn);
    };
    // Endleiste beim Laden auf 0 schließen (wie bei .dat); Original als Editier-Basis behalten.
    const setLoaded = (key, apply) => (p) => {
      const orig = p.map(q => ({ x: q.x, y: q.y })); orig.name = p.name;
      state.profBase[key] = orig; apply(App.closeLoadedTE(p));
    };
    use(state.root, setLoaded('root', p => { state.root.profile = p; }));
    state.segments.forEach((s, i) => use(s, setLoaded(String(i), p => { s.profile = p; })));
    return { assigned, missing };
  }
  // Mehrere .dat wählen (FS-Access-Picker mit multiple; sonst Datei-Input).
  async function loadFoilDats() {
    if (FS_SUPPORTED && window.showOpenFilePicker) {
      try {
        const opts = { multiple: true, types: [{ description: 'Profile (.dat/.bez)', accept: { 'text/plain': ['.dat', '.bez', '.txt', '.cor'] } }] };
        Object.assign(opts, pickerOpts('ldDat', '.dat'));
        const handles = await window.showOpenFilePicker(opts);
        markDirUsed('ldDat', '.dat');
        const files = [];
        for (const fh of handles) { const f = await fh.getFile(); files.push({ name: f.name, text: await f.text() }); }
        if (files.length) addFoilDats(files);
        return;
      } catch (e) { if (e && e.name === 'AbortError') return; /* sonst Fallback */ }
    }
    document.getElementById('fileFoils').click();
  }

  // ---- Planform Creator 2 (.pc2) -------------------------------------
  // Import öffnet einen eigenen Dialog: die glatte (elliptische) Fläche wird in
  // wählbar viele/positionierte Trapeze zerlegt (Live-Vorschau). „Importieren"
  // ersetzt dann die Segmentkette.
  let pc2dlg = null;   // { model, stations, mode, n }
  function processPc2(text) {
    try {
      if (!window.PC2) throw new Error('PC2-Modul fehlt.');
      const model = PC2.parse(text);
      openPc2Dialog(model);
    } catch (err) { alert(T('PC2-Import fehlgeschlagen: ') + T(err.message)); }
  }
  function loadPc2() { loadVia({ 'application/json': ['.pc2', '.json'] }, processPc2, 'filePc2', 'ldPc2'); }

  function openPc2Dialog(model) {
    // Startvorschlag: an den Profilschnitten (sinnvolle Trapezgrenzen).
    const initStations = model.sectionStations();
    pc2dlg = { model, stations: initStations, mode: 'sections', n: Math.max(1, initStations.length - 1) };
    document.getElementById('pc2Title').textContent = T('Planform importieren') + ' — ' + model.name;
    document.getElementById('pc2Modal').classList.add('open');
    buildPc2Controls();
    // Canvas hat erst nach dem Einblenden eine Größe -> im nächsten Frame zeichnen.
    requestAnimationFrame(() => requestAnimationFrame(renderPc2));
  }
  function closePc2() { const m = document.getElementById('pc2Modal'); if (m) m.classList.remove('open'); pc2dlg = null; }

  // Stationsliste aus Modus/Anzahl neu erzeugen (außer bei 'manual').
  function pc2Regen() {
    if (!pc2dlg) return;
    const m = pc2dlg.model;
    if (pc2dlg.mode === 'sections') pc2dlg.stations = m.sectionStations();
    else if (pc2dlg.mode === 'uniform') pc2dlg.stations = PC2.stations(pc2dlg.n, 'uniform');
    else if (pc2dlg.mode === 'cosine') pc2dlg.stations = PC2.stations(pc2dlg.n, 'cosine');
    // 'manual': unverändert
  }
  function buildPc2Controls() {
    const box = document.getElementById('pc2Ctrl'); if (!box || !pc2dlg) return;
    box.textContent = '';
    const m = pc2dlg.model;
    const info = document.createElement('div'); info.className = 'hint';
    info.innerHTML = '<b>' + m.name + '</b><br>' + T('Halbspannweite') + ': ' + m.halfspan.toFixed(0) + ' mm<br>'
      + T('Wurzelsehne') + ': ' + m.chordRoot.toFixed(0) + ' mm · ' + T('Spitze') + ': ' + m.chordTip.toFixed(1) + ' mm<br>'
      + T('Profilschnitte') + ': ' + m.sections.filter(s => s.airfoil).length;
    box.appendChild(info);
    // Trapezflächen sind bereits aus geraden Feldern aufgebaut — an den
    // Profilschnitten ist die Übernahme dann EXAKT, nicht genähert.
    if (m.isTrapez) {
      const tz = document.createElement('div'); tz.className = 'hint';
      tz.style.color = 'var(--ok,#57d38c)';
      tz.textContent = T('Trapezfläche: mit der Verteilung „An Profilschnitten" wird die Fläche exakt übernommen (keine Näherung). Scharnierlinie und Klappengruppen kommen mit.');
      box.appendChild(tz);
    }

    // Ziel im Projekt — wie beim FLZ-/XFLR5-Import.
    const lt = document.createElement('label');
    lt.textContent = T('Ziel im Projekt');
    lt.style.cssText = 'font-size:12px;color:var(--muted)';
    box.appendChild(lt);
    const tsel = document.createElement('select'); tsel.style.cssText = 'width:100%';
    App.wingList().forEach((w, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = T('ersetzen: ') + (w.name || (T('Tragfläche') + ' ' + (i + 1)));
      tsel.appendChild(o);
    });
    {
      const o = document.createElement('option');
      o.value = 'new'; o.textContent = T('neue Tragfläche anlegen');
      tsel.appendChild(o);
    }
    if (pc2dlg.target == null) pc2dlg.target = String(state.activeWing);
    tsel.value = pc2dlg.target;
    tsel.onchange = () => { pc2dlg.target = tsel.value; };
    box.appendChild(tsel);

    const mk = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
    // Verteilungs-Modus
    const lm = mk('label'); lm.textContent = T('Trapez-Verteilung'); lm.style.cssText = 'font-size:12px;color:var(--muted)';
    box.appendChild(lm);
    const sel = mk('select'); sel.style.cssText = 'width:100%';
    [['sections', T('An Profilschnitten')], ['uniform', T('Gleichmäßig')], ['cosine', T('Zur Spitze verdichtet')], ['manual', T('Manuell (Werte unten)')]]
      .forEach(([v, t]) => { const o = mk('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
    sel.value = pc2dlg.mode;
    sel.onchange = () => { pc2dlg.mode = sel.value; if (pc2dlg.mode !== 'manual') pc2Regen(); buildPc2Controls(); renderPc2(); };
    box.appendChild(sel);

    // Anzahl Trapeze (nur bei uniform/cosine)
    if (pc2dlg.mode === 'uniform' || pc2dlg.mode === 'cosine') {
      const rn = mk('div', 'row'); const ln = mk('label'); ln.textContent = T('Anzahl Trapeze');
      const inp = mk('input'); inp.type = 'number'; inp.min = 1; inp.max = 40; inp.step = 1; inp.value = pc2dlg.n;
      inp.oninput = () => { const v = Math.max(1, Math.min(40, Math.round(+inp.value || 1))); pc2dlg.n = v; pc2Regen(); buildPc2StationList(); renderPc2(); };
      rn.appendChild(ln); rn.appendChild(inp); box.appendChild(rn);
    }

    // Stationsgrenzen (editierbar)
    const lh = mk('div', 'hint'); lh.style.marginTop = '4px';
    lh.textContent = T('Trapezgrenzen (% Halbspannweite, Wurzel 0 → Spitze 100). Bearbeiten schaltet auf „Manuell".');
    box.appendChild(lh);
    const list = mk('div'); list.id = 'pc2Stations'; box.appendChild(list);
    buildPc2StationList();

    // Manuell: Grenze hinzufügen/entfernen
    const rowb = mk('div', 'mrow'); rowb.style.gap = '6px';
    const addb = mk('button'); addb.textContent = T('+ Grenze');
    addb.onclick = () => { pc2dlg.mode = 'manual'; const st = pc2dlg.stations; st.splice(st.length - 1, 0, +( (st[st.length-2]+st[st.length-1])/2 ).toFixed(4)); buildPc2Controls(); renderPc2(); };
    rowb.appendChild(addb);
    box.appendChild(rowb);
  }
  function buildPc2StationList() {
    const list = document.getElementById('pc2Stations'); if (!list || !pc2dlg) return;
    list.textContent = '';
    const st = pc2dlg.stations;
    st.forEach((v, i) => {
      const r = document.createElement('div'); r.className = 'row'; r.style.gridTemplateColumns = '1fr 68px auto';
      const l = document.createElement('label');
      l.textContent = (i === 0) ? T('Wurzel') : (i === st.length - 1 ? T('Spitze') : (T('Grenze ') + i));
      const inp = document.createElement('input'); inp.type = 'number'; inp.step = 1; inp.min = 0; inp.max = 100;
      inp.value = (v * 100).toFixed(1);
      const locked = (i === 0 || i === st.length - 1);
      if (locked) { inp.readOnly = true; inp.style.opacity = '.55'; inp.tabIndex = -1; }
      else inp.oninput = () => {
        pc2dlg.mode = 'manual';
        let f = Math.max(0, Math.min(100, +inp.value || 0)) / 100;
        pc2dlg.stations[i] = f;
        renderPc2();   // Sortierung erst beim Import; Live-Zeichnung nutzt sort()
        // Modus-Select oben aktualisieren
        const sel = document.querySelector('#pc2Ctrl select'); if (sel) sel.value = 'manual';
      };
      r.appendChild(l); r.appendChild(inp);
      if (!locked) {
        const del = App.mkMini('✕', () => { pc2dlg.mode = 'manual'; pc2dlg.stations.splice(i, 1); buildPc2Controls(); renderPc2(); });
        del.style.color = 'var(--bad)'; r.appendChild(del);
      }
      list.appendChild(r);
    });
  }
  // Sortierte, gültige Stationsliste (0..1, inkl. 0 und 1).
  function pc2SortedStations() {
    let st = pc2dlg.stations.map(v => Math.max(0, Math.min(1, +v))).slice().sort((a, b) => a - b);
    st = Array.from(new Set(st.map(v => +v.toFixed(5))));
    if (st[0] > 0) st.unshift(0);
    if (st[st.length - 1] < 1) st.push(1);
    return st;
  }
  function renderPc2() {
    if (!pc2dlg) return;
    const cv = document.getElementById('cPc2'); if (!cv) return;
    const m = pc2dlg.model, st = pc2SortedStations();
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || 700, H = cv.clientHeight || 400;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    // Datengrenzen (mm): span 0..halfspan (X der Zeichnung), chord-Bereich (Y).
    const N = 160, span = m.halfspan;
    let xminC = Infinity, xmaxC = -Infinity;
    const LE = [], TE = [];
    for (let i = 0; i <= N; i++) {
      const xn = i / N; const le = m.le(xn), te = m.te(xn);
      LE.push([xn * span, le]); TE.push([xn * span, te]);
      xminC = Math.min(xminC, le, te); xmaxC = Math.max(xmaxC, le, te);
    }
    const pad = 26;
    const sx = (W - 2 * pad) / (span || 1);
    const sy = (H - 2 * pad) / ((xmaxC - xminC) || 1);
    const sc = Math.min(sx, sy);
    const ox = pad, oy = pad;
    // Zeichnung: Y-Spannweite nach rechts, Chord-X nach unten (Nase oben).
    const X = mm => ox + (mm) * sc;
    const Y = c => oy + (c - xminC) * sc;
    // echte Fläche (gefüllt)
    g.beginPath();
    LE.forEach((p, i) => { const xx = X(p[0]), yy = Y(p[1]); i ? g.lineTo(xx, yy) : g.moveTo(xx, yy); });
    for (let i = TE.length - 1; i >= 0; i--) { g.lineTo(X(TE[i][0]), Y(TE[i][1])); }
    g.closePath();
    g.fillStyle = 'rgba(74,163,255,.12)'; g.fill();
    g.strokeStyle = 'rgba(74,163,255,.55)'; g.lineWidth = 1; g.stroke();
    // Trapez-Näherung (LE/TE stückweise gerade zwischen Stationen)
    g.beginPath();
    st.forEach((xn, i) => { const xx = X(xn * span), yy = Y(m.le(xn)); i ? g.lineTo(xx, yy) : g.moveTo(xx, yy); });
    for (let i = st.length - 1; i >= 0; i--) { g.lineTo(X(st[i] * span), Y(m.te(st[i]))); }
    g.closePath();
    g.strokeStyle = '#ffb454'; g.lineWidth = 1.6; g.stroke();   // Trapez-Näherung (Akzent 2)
    // Stationslinien
    g.strokeStyle = 'rgba(255,180,84,.5)'; g.lineWidth = 1; g.font = '10px sans-serif'; g.fillStyle = '#ffb454';
    st.forEach(xn => {
      const xx = X(xn * span);
      g.beginPath(); g.moveTo(xx, Y(m.le(xn))); g.lineTo(xx, Y(m.te(xn))); g.stroke();
    });
    // Profilschnitte markieren
    g.fillStyle = '#57d38c';
    m.sections.filter(s => s.airfoil).forEach(s => {
      const xx = X(s.xn * span), yy = Y(m.le(s.xn));
      g.beginPath(); g.arc(xx, yy, 3, 0, 2 * Math.PI); g.fill();
    });
    // Info + Fehler
    const err = PC2.chordError(m, st);
    const info = document.getElementById('pc2Info');
    if (info) info.textContent = (st.length - 1) + ' ' + T('Trapeze')
      + ' · ' + T('max. Sehnenabweichung') + ' ' + err.max.toFixed(1) + ' mm ('
      + T('Mittel') + ' ' + err.mean.toFixed(1) + ' mm)'
      + ' · ' + T('grün = Profilschnitt');
  }
  // Übernehmen: Trapeze -> Segmentkette der App.
  function pc2DoImport() {
    if (!pc2dlg) return;
    try {
      const st = pc2SortedStations();
      const cfg = PC2.toWingConfig(pc2dlg.model, { stations: st, foils: state.xflrFoils || {}, mkSeg });
      const meta = cfg.meta, miss = cfg.missingFoils;
      // Ziel wie beim FLZ-/XFLR5-Import: vorhandene Tragfläche ersetzen oder
      // eine neue anlegen. Die Übernahme selbst macht wingimport.js.
      const target = (pc2dlg.target === 'new') ? 'new' : +(pc2dlg.target != null ? pc2dlg.target : state.activeWing);
      if (target !== 'new' && !confirm(T('Die Geometrie folgender Tragflächen wird ersetzt (Segmente, Profile und Holme gehen verloren): ')
        + App.wingList()[target].name + '\n\n' + T('Fortfahren?'))) return;
      closePc2();
      App.wingImportApply([{ item: { name: meta.name, missing: miss, build: () => cfg }, target: target }]);
      const missTxt = miss.length ? ('\n\n' + T('Profile sind in PC2 NICHT enthalten (nur Namen). '
        + 'Bitte über „Profile (.dat) zuordnen…" laden: ') + '\n• ' + miss.join('\n• ')) : '';
      alert(T('Planform-Import: ') + meta.name + '\n'
        + meta.nTrapez + ' ' + T('Trapeze, Wurzelsehne ') + cfg.root.chord.toFixed(0) + ' mm.'
        + '\n' + T('V-Form/Schränkung = 0 (Planform Creator ist eine reine Draufsicht) — bei Bedarf je Segment ergänzen.')
        + missTxt);
    } catch (err) { const e = document.getElementById('pc2Err'); if (e) e.textContent = T('Fehler: ') + err.message; }
  }

  // DXF-Kontur (größte Schleife über alle Layer) in .dat-Text (Selig-Rohpunkte)
  // wandeln. parseDat/normalize kanonisiert danach Reihenfolge und Skalierung.
  function dxfToProfileDat(text) {
    return layersToProfileDat(Dxf.parse(text), 'Profil (DXF)');
  }
  // Geparste {layers, order}-Struktur (DXF/SVG) -> .dat-Text der größten Kontur.
  function layersToProfileDat(parsed, defName) {
    let all = [];
    for (const name of parsed.order) {
      const ls = parsed.layers[name];
      if (ls && ls.length) all = all.concat(ls);
    }
    const loop = Dxf.pickLoop(all);
    if (!loop || loop.length < 5) throw new Error(T('Keine geeignete Profilkontur gefunden.'));
    const body = loop.map(p => p.x.toFixed(6) + ' ' + p.y.toFixed(6)).join('\n');
    return (loop.name || defName || 'Profil') + '\n' + body;
  }
  // DXF für ein Profil laden: erst in .dat wandeln, dann wie eine .dat verarbeiten.
  function loadProfileDxf() {
    loadVia({ 'application/dxf': ['.dxf'] }, t => {
      let dat;
      try { dat = dxfToProfileDat(t); }
      catch (e) { alert(T('DXF-Import fehlgeschlagen: ') + e.message); return; }
      processDat(dat);
    }, 'fileDxf', 'ldDxf');
  }
  // SVG für ein Profil laden: größte Kontur in .dat wandeln und verarbeiten.
  function loadProfileSvg() {
    loadVia({ 'image/svg+xml': ['.svg'] }, t => {
      let dat;
      try { dat = layersToProfileDat(parseSvgToLayers(t), 'Profil (SVG)'); }
      catch (e) { alert(T('SVG-Import fehlgeschlagen: ') + e.message); return; }
      processDat(dat);
    }, 'fileSvg', 'ldSvg');
  }
  // Dateinamen-tauglichen Stamm aus dem Profilnamen ableiten.
  function profFileBase(pts) {
    return ((pts && pts.name) || 'profil').replace(/[^\w.\-]+/g, '_').replace(/^_+|_+$/g, '') || 'profil';
  }
  // Export mit Explorer-Speichern-Dialog (Ordnerpfad UND Name frei wählbar) —
  // analog zum Laden über den Explorer. Fällt ohne File System Access API auf
  // den normalen Download zurück.
  async function exportViaPicker(name, text, mime, which) {
    if (App.demoSaveBlocked(which)) return null;   // Kern-/Design-Sperre (Projekt bleibt in der Design-Ausgabe erlaubt)
    if (FS_SUPPORTED && window.showSaveFilePicker) {
      if (dirReminder(which)) return null;                 // erst Ordner einrichten
      try { return await saveFilePicker(name, text, mime, which || 'save'); }
      catch (e) { if (e && e.name === 'AbortError') return null; }   // Abbruch: nichts tun
    }
    anchorDownload(name, text, mime, which); return null;
  }
  // Bearbeitetes Profil als .dat (Selig, normiert: LE x=0, TE x=1) exportieren.
  function exportProfileDat(id) {
    const p = App.profEditGet(id);
    const name = ((p && p.name) || 'Profil').replace(/\s+/g, ' ').trim();
    const body = p.map(q => q.x.toFixed(6) + '  ' + q.y.toFixed(6)).join('\n');
    exportViaPicker(profFileBase(p) + '.dat', name + '\n' + body + '\n', 'text/plain', 'svDat');
  }
  // Bearbeitetes Profil als DXF (geschlossene Polylinie, in mm anhand der Sehne).
  function exportProfileDxf(id) {
    const p = App.profEditGet(id), scale = App.profEditChord(id) || 1;
    const poly = { closed: true, pts: p.map(q => ({ x: q.x * scale, y: q.y * scale })) };
    const layers = [{ name: 'PROFIL', color: 7, polys: [poly] }];
    const text = Dxf.write(layers, { precision: state.cfg.precision != null ? state.cfg.precision : 4 });
    exportViaPicker(profFileBase(p) + '.dxf', text, 'application/dxf', 'svDxf');
  }
  // Laden über den (typeigenen) Ladeordner; sonst versteckter Datei-Input.
  async function loadVia(accept, handler, inputId, which) {
    if (FS_SUPPORTED) {
      try { const r = await pickTextFile(accept, which); if (r) handler(r.text, r.name, r.handle); return; }
      catch (e) { if (e && e.name === 'AbortError') return; /* sonst Fallback */ }
    }
    document.getElementById(inputId).click();
  }
  // Datei als File-Objekt (Binärdateien: STL, Bilder) über den Explorer-Dialog
  // wählen, der im Ladeordner des Typs startet.
  async function loadFileVia(accept, handler, inputId, which) {
    if (FS_SUPPORTED) {
      try {
        const opts = pickerOpts(which, acceptExt(accept));
        if (accept) opts.types = [{ description: 'Dateien', accept }];
        const [fh] = await window.showOpenFilePicker(opts);
        markDirUsed(which, acceptExt(accept));
        handler(await fh.getFile()); return;
      } catch (e) { if (e && e.name === 'AbortError') return; /* sonst Fallback */ }
    }
    document.getElementById(inputId).click();
  }
  function repaintAll() { applyPalette(); savePalette(); saveViewPalettes(); if (typeof App.render === 'function') App.render(); if (state.activeTab === 'dxf' && typeof renderDxf === 'function') renderDxf(); }
  let settingsTab = 'colors';
  function buildSettingsModal() {
    const body = document.getElementById('settingsBody'); if (!body) return;
    body.textContent = '';
    // Reiterleiste
    const tabs = document.createElement('div');
    tabs.style.cssText = 'display:flex;gap:6px;margin-bottom:10px;border-bottom:1px solid var(--line);padding-bottom:8px';
    const tabDef = [['colors', 'Farben'], ['files', 'Dateien'],
      ['checklist', 'Beschreibungen und Checkliste'], ['lang', 'Sprache'], ['tabmenu', 'Menüleiste']];
    // Reiter „Lizenz" in jeder Electron-Ausgabe (LICENSE_INFO kommt vom lokalen
    // Server der exe): bei Lizenzpflicht mit Computer-Code und Lizenzdatei,
    // sonst (frei weitergebbare Design-Ausgabe) nur die Lizenzbedingungen und
    // die Lizenzen der Komponenten Dritter zum Nachlesen.
    if (window.LICENSE_INFO) tabDef.push(['lizenz', 'Lizenz']);
    tabDef.forEach(([id, label]) => {
      const b = document.createElement('button'); b.textContent = T(label);
      if (settingsTab === id) b.className = 'primary';
      b.onclick = () => { settingsTab = id; buildSettingsModal(); };
      tabs.appendChild(b);
    });
    body.appendChild(tabs);
    const ttl = document.getElementById('settingsTitle');
    if (ttl) { const cur = tabs.querySelector('.primary'); ttl.textContent = T('Einstellungen') + (cur ? ' — ' + cur.textContent : ''); }
    if (settingsTab === 'colors') buildSettingsColors(body);
    else if (settingsTab === 'checklist') { buildSettingsDescriptions(body); buildSettingsChecklist(body); }
    else if (settingsTab === 'lang') buildSettingsLanguage(body);
    else if (settingsTab === 'lizenz') buildSettingsLicense(body);
    else if (settingsTab === 'tabmenu') App.buildSettingsTabMenu(body);   // tabmenu.js
    else buildSettingsFiles(body);
  }

  // ---------- Reiter „Lizenz" ------------------------------------------------
  // Zeigt den Lizenzzustand (Demo mit Resttagen oder Lizenznehmer), den
  // Computer-/Anforderungscode und erlaubt, die Lizenzdatei SOFORT zu
  // aktivieren — also auch mitten in der Demo, ohne auf deren Ablauf zu warten.
  // Alles läuft über den lokalen Server der exe (electron/server.js); im
  // Browser oder in der Python-Variante gibt es den Reiter nicht.
  function buildSettingsLicense(body) {
    const inf = window.LICENSE_INFO || {};
    const head = document.createElement('b');
    head.textContent = T('Lizenz'); head.className = 'set-h'; body.appendChild(head);

    // Ausgabe ohne Lizenzpflicht (z. B. Design-Ausgabe): keine Codes, nur die
    // Texte - Lizenzbedingungen (mit Aerodynamik-Haftungsausschluss) und
    // Komponenten Dritter.
    if (!inf.lizenzpflicht) {
      App.hint(body, 'Diese Ausgabe braucht keine Lizenzdatei. Die Nutzung unterliegt trotzdem den '
        + 'Lizenzbedingungen — rechtlich bindend ist die deutsche Fassung.');
      appendLicenseTexts(body, true);
      return;
    }

    // --- Zustand
    const st = document.createElement('div');
    st.style.cssText = 'margin:6px 0 12px;padding:8px 10px;border:1px solid var(--line);'
      + 'border-radius:6px;background:var(--panel2)';
    if (inf.lic && inf.typ === 'demo') {
      // Demo-Lizenz: befristet, aber voller Funktionsumfang (nichts gesperrt).
      const b1 = document.createElement('b');
      b1.style.color = '#fbbf24';
      b1.textContent = T('Demo-Lizenz') + ' — ' + (inf.daysLeft === 1
        ? T('letzter Tag') : inf.daysLeft + ' ' + T('Tage übrig'));
      st.appendChild(b1);
      [
        T('Lizenziert für') + ': ' + inf.name + ' <' + inf.email + '>',
        T('Lizenz') + ': ' + inf.lic + ' · ' + T('Computer') + ' ' + inf.machine,
        T('Voller Funktionsumfang bis einschließlich') + ' ' + inf.expiry + '. '
          + T('Danach braucht das Programm eine Lizenz.'),
      ].forEach(t => { const d = document.createElement('div'); d.textContent = t; st.appendChild(d); });
    } else if (inf.lic) {
      const b1 = document.createElement('b');
      b1.textContent = T('Lizenziert für') + ': ' + inf.name;
      st.appendChild(b1);
      const lines = [
        inf.email,
        T('Lizenz') + ': ' + inf.lic + ' · ' + T('Computer') + ' ' + inf.machine,
        T('Gültig bis') + ': ' + (inf.expiry || T('unbegrenzt')),
        // Wartungsfenster: nur zeigen, wenn eines eingetragen ist.
        T('Updates bis Version') + ': ' + (inf.maxVersion || T('ohne Begrenzung')),
      ];
      lines.forEach(t => { const d = document.createElement('div'); d.textContent = t; st.appendChild(d); });
    } else if (inf.trial && inf.trial.on) {
      const b1 = document.createElement('b');
      b1.style.color = '#fbbf24';
      b1.textContent = T('Demo-Version') + ' — ' + (inf.trial.daysLeft === 1
        ? T('noch 1 Tag') : inf.trial.daysLeft + ' ' + T('Tage übrig'));
      st.appendChild(b1);
      const d = document.createElement('div');
      d.textContent = T('G-Code speichern und kopieren ist in der Demo gesperrt.');
      st.appendChild(d);
    } else {
      st.textContent = T('Keine Lizenz aktiv.');
    }
    body.appendChild(st);

    // --- Lizenzbedingungen: vor dem ersten Computer-Code annehmen. Bis dahin
    // liefert der Server gar keine Codes (electron/main.js licenseCodes).
    if (inf.eulaPending) { buildLicenseEula(body); return; }

    // --- Codes
    App.hint(body, 'Für eine Lizenz diesen Code zusammen mit dem vollständigen Namen und der '
      + 'E-Mail-Adresse schicken. Die Lizenz gilt nur für diesen Computer.');
    const codeBox = (label, value) => {
      if (!value) return;
      const l = document.createElement('div');
      l.style.cssText = 'margin-top:8px;color:var(--muted)';
      l.textContent = T(label);
      body.appendChild(l);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:2px';
      const v = document.createElement('code');
      v.style.cssText = 'flex:1;user-select:all;word-break:break-all;background:var(--panel2);'
        + 'border:1px solid var(--line);border-radius:6px;padding:6px 8px;font-family:Consolas,monospace';
      v.textContent = value;
      const cp = document.createElement('button');
      cp.textContent = T('Kopieren');
      cp.onclick = () => {
        navigator.clipboard.writeText(value)
          .then(() => App.toast(T('In die Zwischenablage kopiert.')))
          .catch(() => {});
      };
      row.appendChild(v); row.appendChild(cp); body.appendChild(row);
    };
    codeBox('Computer-Code', inf.code);
    codeBox('Anforderungscode (für diese Programmausgabe)', inf.request);

    // --- Aktionen
    const msg = document.createElement('div');
    msg.style.cssText = 'margin:10px 0;min-height:20px;font-weight:600';
    const say = (t, ok) => { msg.textContent = t; msg.style.color = ok ? '#16a34a' : '#dc2626'; };

    const row = document.createElement('div');
    row.className = 'mrow'; row.style.cssText = 'gap:8px;margin-top:12px;flex-wrap:wrap';

    const pick = document.createElement('button');
    pick.className = 'primary';
    pick.textContent = T('Lizenzdatei auswählen…');
    pick.onclick = () => {
      say(T('Bitte die Lizenzdatei im Windows-Dialog wählen …'), true);
      fetch('/__lizenz_waehlen__' + licLangQ(), { method: 'POST' }).then(r => r.json()).then(r => {
        if (r.canceled) { say('', true); return; }
        if (!r.ok) { say(r.text || T('Die Lizenzdatei ist nicht gültig.'), false); return; }
        say(T('Lizenz übernommen für') + ' ' + (r.data && r.data.name || '') + ' — '
          + T('das Programm lädt gleich neu.'), true);
      }).catch(() => say(T('Die Lizenzdatei ist nicht gültig.'), false));
    };
    row.appendChild(pick);

    if (inf.support) {
      const mail = document.createElement('button');
      mail.textContent = T('Lizenz anfordern (E-Mail)');
      mail.onclick = () => { fetch('/__lizenz_mail__' + licLangQ(), { method: 'POST' }).catch(() => {}); };
      row.appendChild(mail);
      // Ohne Lizenz (z. B. im Demo-Zeitraum mit gesperrtem Export): eine
      // befristete Demo-Lizenz mit vollem Umfang anfragen.
      if (!inf.lic) {
        const demo = document.createElement('button');
        demo.textContent = T('Demo-Lizenz anfordern (E-Mail)');
        demo.title = T('Kostenlos und befristet, mit vollem Funktionsumfang auf diesem Computer.');
        demo.onclick = () => { fetch('/__lizenz_demo_mail__' + licLangQ(), { method: 'POST' }).catch(() => {}); };
        row.appendChild(demo);
      }
    }
    body.appendChild(row);
    body.appendChild(msg);
    App.hint(body, 'Die Lizenzdatei muss „lizenz.key“ heißen und neben der exe liegen — beim '
      + 'Auswählen hier wird sie automatisch dorthin kopiert.');

    // Erteilte Zustimmung + Text zum Nachlesen.
    appendLicenseTexts(body, false);
  }

  /** Lizenzbedingungen (mit Stand/Zustimmung) und die Lizenzen der Komponenten
   *  Dritter (THIRD_PARTY_LICENSES.md) als Aufklappbereiche.
   *  open = Lizenzbedingungen gleich aufgeklappt (Ausgabe ohne Lizenzpflicht). */
  function appendLicenseTexts(body, open) {
    fetch('/__lizenzbedingungen__' + licLangQ()).then(r => r.ok ? r.json() : null).then(d => {
      if (!d || !d.ok) return;
      const det = document.createElement('details');
      det.style.cssText = 'margin-top:12px';
      if (open) det.open = true;
      const sum = document.createElement('summary');
      sum.style.cssText = 'cursor:pointer;color:var(--muted)';
      sum.textContent = d.accepted
        ? T('Lizenzbedingungen') + ' (' + T('Stand') + ' ' + d.accepted.stand + ') — '
          + T('akzeptiert am') + ' ' + d.accepted.date
        : T('Lizenzbedingungen') + ' (' + T('Stand') + ' ' + d.stand + ')';
      det.appendChild(sum);
      det.appendChild(eulaBox(d.html));
      body.appendChild(det);
      if (d.thirdHtml) {
        const det2 = document.createElement('details');
        det2.style.cssText = 'margin-top:8px';
        const sum2 = document.createElement('summary');
        sum2.style.cssText = 'cursor:pointer;color:var(--muted)';
        sum2.textContent = T('Lizenzen der Komponenten Dritter');
        det2.appendChild(sum2);
        det2.appendChild(eulaBox(d.thirdHtml));
        body.appendChild(det2);
      }
    }).catch(() => {});
  }

  /** ?lang=… für die Lizenz-Endpunkte: Lizenztext, Dialogtitel und Meldungen
   *  des Hauptprozesses in der Programmsprache (LICENSE_EN.md bei Englisch). */
  function licLangQ() {
    return '?lang=' + (window.I18N && window.I18N.getLang && window.I18N.getLang() === 'en' ? 'en' : 'de');
  }

  /** Aufbereiteter Text der Lizenzbedingungen (HTML aus electron/eula.js,
   *  dort aus LICENSE.md der App mit Escaping erzeugt) in einem Rollkasten. */
  function eulaBox(html) {
    if (!document.getElementById('eulaMdStyle')) {
      const s = document.createElement('style');
      s.id = 'eulaMdStyle';
      s.textContent = '.eula-md{max-height:48vh;overflow:auto;margin:6px 0 10px;padding:4px 16px 12px;'
        + 'border:1px solid var(--line);border-radius:6px;background:var(--panel2);font-size:12.5px;line-height:1.45}'
        + '.eula-md h1{font-size:16px;margin:12px 0 6px}.eula-md h2{font-size:14.5px;margin:16px 0 6px}'
        + '.eula-md h3{font-size:13px;margin:12px 0 4px}.eula-md p,.eula-md ul,.eula-md ol{margin:0 0 7px}'
        + '.eula-md ul,.eula-md ol{padding-left:22px}.eula-md li{margin-bottom:2px}'
        + '.eula-md hr{border:0;border-top:1px solid var(--line);margin:12px 0}'
        + '.eula-md blockquote{margin:0 0 7px;padding:5px 10px;border-left:3px solid #e0a000}'
        + '.eula-md code{font-family:Consolas,monospace}.eula-md .tbl{overflow-x:auto;margin-bottom:7px}'
        + '.eula-md table{border-collapse:collapse;font-size:11.5px}'
        + '.eula-md th,.eula-md td{border:1px solid var(--line);padding:2px 5px;text-align:left;vertical-align:top}';
      document.head.appendChild(s);
    }
    const box = document.createElement('div');
    box.className = 'eula-md';
    box.innerHTML = html || '';
    return box;
  }

  /** Reiter „Lizenz", solange die Lizenzbedingungen noch nicht angenommen sind:
   *  Text, Häkchen, „Akzeptieren“ — erst danach gibt es den Computer-Code. */
  function buildLicenseEula(body) {
    App.hint(body, 'Den Computer-Code für eine Lizenz gibt es, sobald Sie den Lizenzbedingungen '
      + 'zugestimmt haben. Rechtlich bindend ist die deutsche Fassung.');
    const holder = document.createElement('div');
    holder.textContent = '…';
    body.appendChild(holder);

    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:flex;gap:8px;align-items:center;font-weight:600;cursor:pointer';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    lbl.appendChild(chk);
    lbl.appendChild(document.createTextNode(T('Ich habe die Lizenzbedingungen gelesen und akzeptiere sie.')));
    body.appendChild(lbl);

    const msg = document.createElement('div');
    msg.style.cssText = 'margin:8px 0;min-height:20px;font-weight:600;color:#dc2626';
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.style.marginTop = '10px';
    btn.textContent = T('Akzeptieren und Computer-Code anzeigen');
    btn.disabled = true;
    chk.onchange = () => { btn.disabled = !chk.checked; };
    btn.onclick = () => {
      if (!chk.checked) return;
      btn.disabled = true;
      fetch('/__lizenz_akzeptieren__' + licLangQ(), { method: 'POST' }).then(r => r.json()).then(r => {
        if (!r || !r.ok) {
          msg.textContent = (r && r.text) || T('Die Zustimmung konnte nicht gespeichert werden.');
          btn.disabled = false;
          return null;
        }
        return fetch('/__lizenz__').then(x => x.json()).then(d => {
          window.LICENSE_INFO = d;
          buildSettingsModal();
        });
      }).catch(() => {
        msg.textContent = T('Die Zustimmung konnte nicht gespeichert werden.');
        btn.disabled = false;
      });
    };
    body.appendChild(btn);
    body.appendChild(msg);

    fetch('/__lizenzbedingungen__' + licLangQ()).then(r => r.ok ? r.json() : null).then(d => {
      if (!d || !d.ok) { holder.textContent = T('Die Lizenzbedingungen konnten nicht geladen werden.'); return; }
      const cap = document.createElement('b');
      cap.textContent = T('Lizenzbedingungen') + ' (' + T('Stand') + ' ' + d.stand + ')';
      holder.textContent = '';
      holder.style.marginTop = '10px';
      holder.appendChild(cap);
      holder.appendChild(eulaBox(d.html));
    }).catch(() => { holder.textContent = T('Die Lizenzbedingungen konnten nicht geladen werden.'); });
  }

  // ---------- Sicherheitshinweis (einmalig, vor dem ersten Maschinenlauf) ----------
  // Der Dialog selbst steht in safety.js und erscheint beim ersten „Start" in
  // den Reitern Schneiden und Fräse. Hier nur Stand anzeigen und zurücksetzen.
  function buildSettingsSafety(body) {
    if (!(window.App && App.safetyAckInfo)) return;
    const head = document.createElement('b'); head.textContent = T('Sicherheitshinweis vor dem Maschinenlauf');
    head.className = 'set-h'; body.appendChild(head);
    App.hint(body, 'Vor dem ersten Maschinenlauf ist einmal zu bestätigen, dass ein hardwareseitiger Not-Aus vorhanden ist '
      + 'und die Halt- und Endlagenfunktionen des Programms keine Sicherheitsfunktion erfüllen (Abschnitt 2.2b der Lizenzbedingungen).');
    const row = document.createElement('div'); row.className = 'mrow'; row.style.margin = '8px 0';
    const st = document.createElement('span'); st.className = 'hint'; st.style.margin = '0';
    const rec = App.safetyAckInfo();
    st.textContent = rec ? (T('Bestätigt am ') + rec.date) : T('Noch nicht bestätigt.');
    row.appendChild(st);
    if (rec) {
      const sp = document.createElement('div'); sp.className = 'sp'; row.appendChild(sp);
      const b = document.createElement('button'); b.textContent = T('Erneut anzeigen');
      b.onclick = () => { App.safetyAckReset(); buildSettingsModal(); };
      row.appendChild(b);
    }
    body.appendChild(row);
  }

  // ---------- Schneid-Checkliste (optional, vor jedem Schnittstart) ----------
  // Teil der Programm-Einstellungen (state.cfg.checklistOn / state.cfg.checklist,
  // über MACHINE_KEYS in der Einstellungsdatei). Ist sie eingeschaltet, muss vor
  // „Start“ im Reiter Schneiden jeder Punkt abgehakt werden.
  const CHECKLIST_DEF = ['Material Abbrand kalibriert?', 'Blocklage korrekt?', 'Maschine auf 0?'];
  function checklistGet() {
    let items = state.cfg.checklist;
    if (!Array.isArray(items)) items = CHECKLIST_DEF.slice();
    items = items.map(x => String(x).trim()).filter(Boolean);
    return { on: !!state.cfg.checklistOn, items };
  }
  function checklistSet(c) {
    state.cfg.checklistOn = !!c.on;
    state.cfg.checklist = (c.items || []).map(x => String(x).trim()).filter(Boolean);
    saveSettings();
  }
  function buildSettingsChecklist(body) {
    buildSettingsSafety(body);
    const c = checklistGet();
    const head = document.createElement('b'); head.textContent = T('Checkliste vor dem Schneiden'); head.className = 'set-h'; head.style.marginTop = '14px'; body.appendChild(head);
    App.hint(body, 'Ist die Checkliste eingeschaltet, erscheint sie beim Drücken von „Start“ im Reiter Schneiden. '
      + 'Erst wenn alle Punkte abgehakt sind, wird der Schnitt gestartet. Ein Punkt je Zeile; leere Zeilen werden ignoriert.');
    const row = document.createElement('label'); row.className = 'mrow'; row.style.cssText = 'gap:8px;margin:8px 0;cursor:pointer';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!c.on;
    cb.onchange = () => { const n = checklistGet(); n.on = cb.checked; checklistSet(n); };
    row.appendChild(cb); row.appendChild(document.createTextNode(T('Checkliste vor dem Schnitt abfragen')));
    body.appendChild(row);
    const ta = document.createElement('textarea'); ta.spellcheck = false; ta.rows = Math.max(6, c.items.length + 2);
    ta.style.cssText = 'width:100%;box-sizing:border-box;background:var(--panel2);color:var(--txt);border:1px solid var(--line);border-radius:6px;padding:6px;font:inherit;resize:vertical';
    ta.value = c.items.join('\n');
    ta.oninput = () => { const n = checklistGet(); n.items = ta.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean); checklistSet(n); };
    body.appendChild(ta);
    const r2 = document.createElement('div'); r2.className = 'mrow'; r2.style.marginTop = '6px';
    const rst = document.createElement('button'); rst.textContent = T('Grundliste wiederherstellen');
    rst.onclick = () => { const n = checklistGet(); n.items = CHECKLIST_DEF.slice(); checklistSet(n); buildSettingsModal(); };
    r2.appendChild(rst); body.appendChild(r2);
  }
  // Sprachauswahl (Deutsch/English) — eigener Reiter „Sprache".
  function buildSettingsLanguage(body) {
    const head = document.createElement('b');
    head.textContent = T('Sprache');
    head.className = 'set-h';
    body.appendChild(head);
    const row = document.createElement('div'); row.className = 'row'; row.style.gridTemplateColumns = '1fr 120px';
    const l = document.createElement('label'); l.textContent = T('Sprache');
    const s = document.createElement('select');
    [['de', 'Deutsch'], ['en', 'English']].forEach(([v, t]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = t; s.appendChild(o);
    });
    s.value = window.I18N ? window.I18N.getLang() : 'de';
    s.onchange = () => { if (window.I18N) window.I18N.setLang(s.value); };
    row.appendChild(l); row.appendChild(s); body.appendChild(row);
    App.hint(body, 'Sprache der Programmoberfläche.');
  }
  // Funktionsbeschreibungen + Notizfelder — Reiter „Beschreibungen und Checkliste".
  function buildSettingsDescriptions(body) {
    // Darstellung der Funktionsbeschreibungen (Hinweistexte).
    const head2 = document.createElement('b');
    head2.textContent = T('Beschreibungen');
    head2.className = 'set-h';
    body.appendChild(head2);
    const row2 = document.createElement('div'); row2.className = 'row'; row2.style.gridTemplateColumns = '1fr 120px';
    const l2 = document.createElement('label'); l2.textContent = T('Funktionsbeschreibungen');
    const s2 = document.createElement('select');
    [['shown', 'Immer anzeigen'], ['collapsed', 'Ausblenden (? klappt auf)']].forEach(([v, t]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = T(t); s2.appendChild(o);
    });
    s2.value = App.hintsMode;
    s2.onchange = () => App.setHintsMode(s2.value);
    row2.appendChild(l2); row2.appendChild(s2); body.appendChild(row2);
    App.hint(body, 'Legt fest, ob die Hinweistexte zu den Funktionen direkt sichtbar sind oder ausgeblendet und über ein „?" neben der Funktion eingeblendet werden.');

    // Notizfelder (📝 je Bedienfeld) komplett ein-/ausschalten.
    const row3 = document.createElement('div'); row3.className = 'row'; row3.style.gridTemplateColumns = '1fr 120px';
    const l3 = document.createElement('label'); l3.textContent = T('Notizfelder');
    const s3 = document.createElement('select');
    [['on', 'Anzeigen'], ['off', 'Ausblenden']].forEach(([v, t]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = T(t); s3.appendChild(o);
    });
    s3.value = App.notesEnabled ? 'on' : 'off';
    s3.onchange = () => App.setNotesEnabled(s3.value === 'on');
    row3.appendChild(l3); row3.appendChild(s3); body.appendChild(row3);
    App.hint(body, 'Legt fest, ob neben den Funktionen das 📝-Symbol zum Hinterlegen von Notizen erscheint. Ausgeblendet bleiben bestehende Notizen erhalten, das Symbol wird nur verborgen.');

    // Lösungsvorschläge zu Maschinengrenz-Warnungen (Simulation + Start-Verweigerung).
    const row4 = document.createElement('div'); row4.className = 'row'; row4.style.gridTemplateColumns = '1fr 120px';
    const l4 = document.createElement('label'); l4.textContent = T('Lösungsvorschläge bei Warnungen');
    const s4 = document.createElement('select');
    [['on', 'Anzeigen'], ['off', 'Ausblenden']].forEach(([v, t]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = T(t); s4.appendChild(o);
    });
    s4.value = App.state.cfg.limitTips === false ? 'off' : 'on';
    s4.onchange = () => { App.state.cfg.limitTips = s4.value === 'on'; if (window.Sim3D && Sim3D.refreshWarn) Sim3D.refreshWarn(); };
    row4.appendChild(l4); row4.appendChild(s4); body.appendChild(row4);
    App.hint(body, 'Bei Warnungen zu Maschinengrenzen (Fahrweg überschritten, Portal fährt ins Negative, Vorschub zu hoch) werden unter der Meldung konkrete Abhilfen vorgeschlagen — in der 3D-Simulation und beim verweigerten Start im Reiter „Schneiden". Ausgeblendet erscheint nur die Warnung selbst.');
  }
  // Kopfzeile einer Farbgruppe.
  function colGroupHead(body, title) {
    const h = document.createElement('b'); h.textContent = T(title);
    h.className = 'set-h';
    body.appendChild(h); return h;
  }
  /* Eine Farb-/Strichtyp-Zeile. getStyle/setStyle sind optional (nur Linien).
   * getCol/setCol lesen/schreiben die Farbe (global oder je Ansicht). */
  function colorRow(body, key, label, getCol, setCol, getStyle, setStyle) {
    const hasStyle = !!getStyle && LST_KEYS.indexOf(key) >= 0;
    const row = document.createElement('div'); row.className = 'row';
    row.style.gridTemplateColumns = hasStyle ? '1fr 110px 46px' : '1fr 46px';
    const l = document.createElement('label'); l.textContent = T(label);
    row.appendChild(l);
    if (hasStyle) {
      const sel = document.createElement('select');
      LINE_STYLES.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = T(t); sel.appendChild(o); });
      sel.value = getStyle() || 'auto'; sel.title = T('Strichtyp');
      sel.onchange = () => { setStyle(sel.value); repaintAll(); };
      row.appendChild(sel);
    }
    const inp = document.createElement('input'); inp.type = 'color';
    inp.value = /^#[0-9a-f]{6}$/i.test(getCol()) ? getCol() : '#000000';
    inp.style.cssText = 'width:46px;height:26px;padding:0;cursor:pointer';
    inp.oninput = () => { setCol(inp.value); repaintAll(); };
    row.appendChild(inp); body.appendChild(row);
  }
  // Alle Farben und Strichtypen (global + je Ansicht) auf Werkseinstellung.
  function resetColors() {
    Object.assign(App.PAL, PAL_DEF);
    VIEWS.forEach(([v]) => {
      PER_VIEW_KEYS.forEach(k => VPAL[v][k] = PAL_DEF[k]);
      LST_KEYS.forEach(k => VLST[v][k] = LST_DEFAULT[k] || 'auto');
    });
    applyPalette(); savePalette(); saveViewPalettes(); applyView();
    if (App.KTRUE) { for (const v in App.KTRUE) App.KTRUE[v].alpha = App.KTRUE_DEF.alpha; App.saveKerfTrue(); }   // Band-Deckkraft mit zurücksetzen
    if (typeof App.render === 'function') App.render(); buildSettingsModal();
  }
  /* Einklappbare Abschnittsgruppe im Einstellungsmenü. Gibt das <details>
   * zurück; Inhalt (Zeilen) wird HINEIN angehängt statt in body. Auf-/Zu-
   * Zustand wird je Abschnitt gemerkt (Standard: eingeklappt). */
  function colSection(parent, title, openDefault) {
    const det = document.createElement('details'); det.className = 'set-sec';
    const skey = 'hw_set_open_' + String(title).replace(/\W+/g, '_');
    let open = openDefault === true;
    try { const v = localStorage.getItem(skey); if (v != null) open = v === '1'; } catch (e) {}
    det.open = open;
    det.ontoggle = () => { try { localStorage.setItem(skey, det.open ? '1' : '0'); } catch (e) {} };
    const sum = document.createElement('summary'); sum.className = 'set-h';
    sum.style.cssText = 'cursor:pointer;list-style:revert';
    sum.textContent = T(title);
    det.appendChild(sum); parent.appendChild(det);
    return det;
  }
  function buildSettingsColors(body) {
    // Werkseinstellung wiederherstellen (Farben + Strichtypen).
    const reset = document.createElement('button');
    reset.textContent = T('Standard wiederherstellen');
    reset.style.cssText = 'margin:4px 0 2px';
    reset.title = T('Alle Farben und Strichtypen auf Werkseinstellung zurücksetzen.');
    reset.onclick = () => { if (confirm(T('Alle Farben und Strichtypen auf Werkseinstellung zurücksetzen?'))) resetColors(); };
    body.appendChild(reset);
    buildSettingsKerfTrue(body);
    // 1) Oberfläche/UI (global, CSS-Variablen).
    const surf = PAL_GROUPS[0];
    const s1 = colSection(body, surf[0]);
    surf[1].forEach(([key, label]) => colorRow(s1, key, label,
      () => App.PAL[key], v => { App.PAL[key] = v; }));
    // 2) Allgemeine Zeichnungsfarben (3D/Maschine — für alle Ansichten gleich).
    const s2 = colSection(body, 'Zeichnung (allgemein)');
    App.hint(s2, '3D-Türme und Maschinennullpunkt — gelten in allen Ansichten.');
    GLOBAL_DRAW_KEYS.forEach(key => colorRow(s2, key, PER_VIEW_LABEL[key] || key,
      () => App.PAL[key], v => { App.PAL[key] = v; }));
    // 3) Je Design-Ansicht: eigene Zeichnungsfarben UND Strichtypen.
    VIEWS.forEach(([v, vlabel]) => {
      const sv = colSection(body, vlabel, false);
      // „Übernehmen von …" — Farben+Strichtypen einer anderen Ansicht kopieren.
      const cp = document.createElement('div'); cp.className = 'mrow';
      cp.style.cssText = 'gap:6px;align-items:center;margin:2px 0 6px';
      const cl = document.createElement('span'); cl.className = 'hint'; cl.textContent = T('Übernehmen von:');
      cp.appendChild(cl);
      VIEWS.forEach(([v2, vlabel2]) => {
        if (v2 === v) return;
        const b = document.createElement('button'); b.textContent = T(vlabel2);
        b.title = T('Farben und Strichtypen aus dieser Ansicht übernehmen.');
        b.onclick = () => copyViewSettings(v2, v);
        cp.appendChild(b);
      });
      sv.appendChild(cp);
      PER_VIEW_KEYS.forEach(key => colorRow(sv, key, PER_VIEW_LABEL[key] || key,
        () => VPAL[v][key], val => { VPAL[v][key] = val; },
        () => VLST[v][key], val => { VLST[v][key] = val; }));
    });
    // 4) Menüfarben (Seitenleisten-Gruppen) — eigener, einklappbarer Punkt.
    buildSettingsMenuColors(body);
  }
  // Abbrandlinien in wahrer Dicke (App.KTRUE, render.js kerfBand): je Designebene
  // Schalter + Deckkraft des Bands — dieselben Werte wie die Schalter der Ansichten.
  function buildSettingsKerfTrue(body) {
    const sec = colSection(body, 'Abbrandlinien (Schnittspur)', true);
    App.hint(sec, 'In wahrer Dicke: unter die Abbrandlinie (Drahtmitte) kommt ein halbtransparentes Band in der '
      + 'echten Breite des Schnittspalts im aktuellen Zoom — von der Sollkontur bis in den Abfall. Je Designebene '
      + 'einzeln (Kerndesign inkl. Schalen- und Holmschnitt, Negativdesign, DXF-Formen, 3D-Modell, Schriften).');
    (App.KTRUE_VIEWS || []).forEach(([view, label]) => {
      const row = document.createElement('div'); row.className = 'row';
      const l = document.createElement('label'); l.textContent = T(label);
      const wrap = document.createElement('span'); wrap.style.cssText = 'display:flex;gap:8px;align-items:center';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.ktrue = view;
      cb.checked = App.kerfTrueOn(view); cb.title = T('Abbrand in wahrer Dicke');
      cb.onchange = () => App.kerfTrueSet(view, cb.checked);
      const rg = document.createElement('input'); rg.type = 'range'; rg.min = '5'; rg.max = '100'; rg.step = '5';
      rg.value = String(Math.round(App.kerfTrueAlpha(view) * 100)); rg.title = T('Deckkraft des Bands');
      const out = document.createElement('span'); out.style.cssText = 'min-width:38px;text-align:right'; out.textContent = rg.value + ' %';
      rg.oninput = () => { out.textContent = rg.value + ' %'; App.kerfTrueSet(view, null, (+rg.value) / 100); };
      wrap.appendChild(cb); wrap.appendChild(rg); wrap.appendChild(out);
      row.appendChild(l); row.appendChild(wrap); sec.appendChild(row);
    });
    App.hint(sec, 'Häkchen = Band an, Regler = Deckkraft des Bands.');
  }
  // Farben der Seitenleisten-Menüs — als einklappbare Gruppe im Farben-Reiter.
  function buildSettingsMenuColors(body) {
    const det = colSection(body, 'Menüfarben', false);
    App.hint(det, 'Farbe der einzelnen Menüs (aufklappbare Gruppen) in der Seitenleiste. Die Farbe umrahmt die gesamte Gruppe. Menüs erscheinen hier, sobald sie einmal angezeigt wurden.');
    // Nur die Menüfarben zurücksetzen.
    const reset = document.createElement('button');
    reset.textContent = T('Menüfarben zurücksetzen');
    reset.style.cssText = 'margin:2px 0 6px';
    reset.onclick = () => {
      App.MENU_COL = {}; App.saveMenuColors();
      App.applyMenuColors();
      buildSettingsModal();
    };
    det.appendChild(reset);
    const keys = Array.from(App.MENU_REG.keys()).sort((a, b) => a.localeCompare(b));
    if (!keys.length) {
      App.hint(det, 'Noch keine Menüs erfasst — bitte zuerst die Reiter/Menüs öffnen.');
    }
    keys.forEach(key => colorRow(det, 'menu:' + key, key,
      () => App.MENU_COL[key] || App.MENU_REG.get(key),
      v => { App.MENU_COL[key] = v; App.saveMenuColors(); App.applyMenuColor(key, v); }));
  }
  function buildSettingsFiles(body) {
    if (!FS_SUPPORTED) {
      const w = document.createElement('div'); w.className = 'hint';
      w.textContent = T('Dieser Browser unterstützt keine feste Ordnerwahl (File System Access API). ')
        + T('In Chrome oder Edge am Desktop werden hier Speicher- und Ladeordner wählbar; sonst gelten ')
        + T('der Standard-Download-Ordner und der normale Datei-Dialog.');
      body.appendChild(w); return;
    }
    App.hint(body, 'Beim Speichern und Laden öffnet immer der Windows-Explorer-Dialog (Name und Ordner frei wählbar). '
      + 'Er startet im Ordner des Dateityps, sonst im Standardordner für alle Dateien, sonst in „Dokumente" '
      + '(Empfehlung: Dokumente\\AI Foam Cut).');
    const folderRow = (which, label) => {
      const box = document.createElement('div'); box.style.cssText = 'border:1px solid var(--line);border-radius:7px;padding:9px;margin:8px 0;background:var(--panel2)';
      const t = document.createElement('b'); t.textContent = T(label); t.style.fontSize = '12px'; box.appendChild(t);
      const cur = document.createElement('div'); cur.className = 'hint'; cur.style.margin = '4px 0';
      cur.textContent = T('Ordner:') + ' ' + (dirHandles[which] ? (dirHandles[which].name || T('(gewählt)')) : T('— nicht gesetzt (Standard)'));
      box.appendChild(cur);
      const row = document.createElement('div'); row.className = 'mrow'; row.style.gap = '6px';
      const pick = document.createElement('button'); pick.className = 'primary'; pick.textContent = T('Ordner wählen…');
      pick.onclick = () => pickDir(which);
      row.appendChild(pick);
      if (dirHandles[which]) { const clr = document.createElement('button'); clr.textContent = T('Zurücksetzen'); clr.onclick = () => clearDir(which); row.appendChild(clr); }
      box.appendChild(row); body.appendChild(box);
    };
    const head = t => { const h = document.createElement('b'); h.textContent = T(t); h.className = 'set-h'; body.appendChild(h); };
    head('Ordnerbaum anlegen');
    App.hint(body, 'Legt unterhalb eines gewählten Ordners (z. B. Dokumente\\AI Foam Cut) die Unterordner Projekte, Einstellungen, '
      + 'Werkstoffe, G-Code, Profile, DXF, STL, SVG und Bilder an und setzt alle Startordner unten automatisch darauf. '
      + 'Jede Zeile kann danach einzeln geändert werden. Vorhandene Unterordner werden wiederverwendet. '
      + 'Gibt es den Ordnerbaum schon (z. B. nach einer Neuinstallation), genügt „Vorhandenen Ordnerbaum wählen…“: '
      + 'damit wird nur neu verknüpft, ohne etwas anzulegen.');
    { const row = document.createElement('div'); row.className = 'mrow';
      const b = document.createElement('button'); b.className = 'primary'; b.textContent = T('Ordnerbaum anlegen…');
      b.onclick = createDirTree; row.appendChild(b);
      const b2 = document.createElement('button'); b2.textContent = T('Vorhandenen Ordnerbaum wählen…');
      b2.title = T('Wurzelordner eines bereits vorhandenen Ordnerbaums wählen — es wird nichts neu angelegt.');
      b2.onclick = useDirTree; row.appendChild(b2);
      body.appendChild(row); }
    head('Standardordner');
    folderRow('save', 'Standardordner für alle Dateien (Speichern und Laden)');
    head('Speichern — je Dateityp');
    folderRow('svProject', 'Projekt speichern (.json)');
    folderRow('svSettings', 'Einstellungen speichern (.json)');
    folderRow('svMaterial', 'Werkstoffdaten exportieren (.json)');
    folderRow('svGcode', 'G-Code speichern (.gcode)');
    folderRow('svDat', 'Profil exportieren (.dat)');
    folderRow('svDxf', 'DXF exportieren (Profil, Tragfläche, CAD)');
    folderRow('svStl', '3D-Segmente exportieren (.stl)');
    head('Laden — je Dateityp');
    folderRow('ldProject', 'Projekt laden (.json)');
    folderRow('ldSettings', 'Einstellungen laden (.json)');
    folderRow('ldMaterial', 'Werkstoffdaten importieren (.json)');
    folderRow('ldDat', 'Profil laden (.dat)');
    folderRow('ldDxf', 'DXF laden (.dxf)');
    folderRow('ldSvg', 'SVG laden (.svg)');
    folderRow('ldStl', '3D-Modell laden (.stl/.obj)');
    folderRow('ldImg', 'Hintergrundbild laden (CAD, DXF-Formen)');
  }
  function openSettings() { buildSettingsModal(); document.getElementById('settingsModal').classList.add('open'); }
  function closeSettings() { document.getElementById('settingsModal').classList.remove('open'); }

  // ---------- Maschinen- & Werkstoff-Einstellungen (persistent) --------
  // Werden automatisch gespeichert (Browser-Speicher) und beim Start geladen.
  // Zusätzlich als Datei „hotwing-settings.json" exportier-/importierbar; liegt
  // sie im Programmordner, wird sie beim ersten Start (leerer Speicher) geladen.
  // Läuft die App über den lokalen exe-Server (launcher.py), existiert zusätzlich
  // der Endpunkt /__settings__: er liest/schreibt dieselbe Datei direkt neben der
  // exe, damit Einstellungen unabhängig vom Browser-Speicher automatisch geladen
  // und gespeichert werden (siehe launcher.py). Im normalen Browser (kein exe-
  // Server) liefert /__settings__ 404 und wird einfach ignoriert.
  const SETTINGS_KEY = 'hotwing.settings.v1';
  const SETTINGS_FILE = 'hotwing-settings.json';
  const SETTINGS_ENDPOINT = '/__settings__';
  const MACHINE_KEYS = ['checklistOn', 'checklist', 'machineWidth', 'axX', 'axY', 'axU', 'axV', 'precision', 'header', 'footer', 'feed',
    'maxTravelH', 'maxTravelV', 'maxFeed', 'warnNeg', 'warnTravel', 'warnFeed', 'axMig', 'firmware', 'feedMode', 'feedMig',
    'relayOut', 'relayPin', 'relayP', 'relayOn', 'relayOff', 'relayMode'];
  let settingsReady = false;   // erst nach dem Laden automatisch speichern
  function collectSettings() {
    const machine = {}; MACHINE_KEYS.forEach(k => machine[k] = state.cfg[k]);
    // Farben (Palette) gehören zu den Einstellungen; Ordnerwahl bleibt separat
    // persistent (IndexedDB, nicht JSON-serialisierbar) und wird beim Start geladen.
    return { v: 1, machine, material: state.material, palette: Object.assign({}, App.PAL),
      notes: App.noteBuckets().settings, prefs: collectPrefs() };
  }
  // ---------- Browser-Einstellungen (localStorage) mit in die Datei ----------
  // Alles, was bisher nur im Browser-Speicher lag (Sprache, Strichtypen, Ansichts-
  // farben, Menüfarben, Hinweis-/Notiz-Modus, CAD-Schalter, GRBL-Homing-Nullpunkt,
  // zuletzt geöffnete Projekte, Klappzustände, Ordner-Merker), wird 1:1 als
  // Roh-Strings unter `prefs` mitgeschrieben und beim Laden zurückgespielt.
  // So greifen die Einstellungen auch bei neuem Browserprofil/gelöschten
  // Website-Daten. Ordner-/Datei-Handles (IndexedDB) sind nicht serialisierbar
  // und bleiben außen vor.
  const PREF_KEYS = ['hotwire-lang', 'hotwing.linestyle', 'hotwing.vpalette', 'hotwing.vlinestyle',
    'hw_menu_colors', 'hw_hints_mode', 'hw_notes_enabled', 'cadRelCoords', 'cadCmdList',
    'hotwire-homeSetZero', 'hotwing.recentProjects', DIR_USED_KEY, DIR_REMIND_KEY, 'hw_tab_layout'];
  const PREF_PREFIXES = ['hw_set_open_'];
  function isPrefKey(k) {
    return PREF_KEYS.indexOf(k) >= 0 || PREF_PREFIXES.some(p => String(k).indexOf(p) === 0);
  }
  function collectPrefs() {
    const out = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (isPrefKey(k)) out[k] = localStorage.getItem(k);
      }
    } catch (e) {}
    return out;
  }
  let applyingPrefs = false;
  function applyPrefs(prefs) {
    if (!prefs || typeof prefs !== 'object') return;
    const changed = {};
    applyingPrefs = true;
    try {
      Object.keys(prefs).forEach(k => {
        if (!isPrefKey(k)) return;
        const v = prefs[k];
        let cur = null; try { cur = localStorage.getItem(k); } catch (e) {}
        if (v == null) { if (cur != null) { try { localStorage.removeItem(k); } catch (e) {} changed[k] = null; } return; }
        const sv = String(v);
        if (cur === sv) return;
        try { localStorage.setItem(k, sv); } catch (e) {}
        changed[k] = sv;
      });
    } finally { applyingPrefs = false; }
    const ks = Object.keys(changed);
    if (!ks.length) return;
    // Live nachziehen — die Module haben ihre Werte beim Start bereits aus dem
    // (alten) localStorage gelesen; die Datei trifft asynchron danach ein.
    const has = k => ks.indexOf(k) >= 0;
    try { if (has('hotwing.linestyle')) App.loadLineStyles(); } catch (e) {}
    try { if (has('hotwing.vpalette') || has('hotwing.vlinestyle') || has('hotwing.linestyle')) { App.loadViewPalettes(); App.applyView(); } } catch (e) {}
    try { if (has('hw_menu_colors')) { App.MENU_COL = JSON.parse(changed['hw_menu_colors'] || '{}') || {}; App.applyMenuColors(); } } catch (e) {}
    try { if (has('hw_hints_mode')) App.setHintsMode(changed['hw_hints_mode']); } catch (e) {}
    try { if (has('hw_notes_enabled')) App.setNotesEnabled(changed['hw_notes_enabled'] !== '0'); } catch (e) {}
    try { if (has('cadRelCoords') && state.cad && state.cad.edit) { state.cad.edit.relCoords = changed['cadRelCoords'] !== '0'; App.cadUpdateRelButtons(); } } catch (e) {}
    try { if (has('cadCmdList')) App.cadToggleCmdList(changed['cadCmdList'] === '1'); } catch (e) {}
    try { if (has('hw_tab_layout')) App.tabMenuReload(); } catch (e) {}   // Gliederung der Reiterleiste
    // Sprache zuletzt: setLang baut Seitenleiste/Einstellungen neu auf.
    try { if (has('hotwire-lang') && window.I18N && window.I18N.getLang() !== changed['hotwire-lang']) window.I18N.setLang(changed['hotwire-lang']); } catch (e) {}
    // GRBL-Homing, Recent-Liste, Klappzustände, Ordner-Merker werden bei Bedarf
    // direkt aus localStorage gelesen — nichts weiter nötig.
  }
  // Jede Änderung eines dieser Schlüssel (egal aus welchem Modul) löst ein
  // verzögertes Speichern in die Datei aus — ohne alle Aufrufstellen anzufassen.
  (function hookStorage() {
    let timer = null;
    const kick = k => { if (applyingPrefs || !isPrefKey(k)) return; if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; saveSettings(); }, 300); };
    try {
      const P = Storage.prototype, si = P.setItem, ri = P.removeItem;
      P.setItem = function (k, v) { si.call(this, k, v); if (this === localStorage) kick(k); };
      P.removeItem = function (k) { ri.call(this, k); if (this === localStorage) kick(k); };
    } catch (e) {}
  })();
  function applySettings(s) {
    if (!s) return;
    if (s.machine) MACHINE_KEYS.forEach(k => { if (s.machine[k] != null) state.cfg[k] = s.machine[k]; });
    // Migration (2026-09-07): Standard für den rechten Turm war A (horiz.)/Z (vert.),
    // jetzt Z (horiz.)/A (vert.). Alte Stände, die noch exakt den alten Standard
    // tragen und nie bewusst umgestellt wurden, einmalig umsetzen (axMig markiert).
    if (!(s.machine && s.machine.axMig) && state.cfg.axU === 'A' && state.cfg.axV === 'Z') { state.cfg.axU = 'Z'; state.cfg.axV = 'A'; }
    state.cfg.axMig = 1;
    // Migration (2026-09-20): Standard-Vorschub-Modus war G94, jetzt G93 (Inverse
    // Time). Alte Stände, die noch den alten Standard tragen und nie bewusst
    // umgestellt wurden (feedMig fehlt), einmalig auf G93 heben.
    if (!(s.machine && s.machine.feedMig) && state.cfg.feedMode === 'g94') state.cfg.feedMode = 'g93';
    state.cfg.feedMig = 1;
    // Altstände mit Schaltausgang, aber ohne Pin-Auswahl: die frei eingetragenen
    // Befehle bleiben gültig -> auf 'custom' stellen.
    if (s.machine && s.machine.relayOut && !s.machine.relayPin) state.cfg.relayPin = 'custom';
    // Gewählte Maschinensteuerung (grblHAL / Mega 5X) ans Pendant weiterreichen —
    // die Datei neben der exe trifft asynchron NACH GrblPanel.init ein.
    if (s.machine && s.machine.firmware && window.GrblPanel && GrblPanel.setFirmware) GrblPanel.setFirmware(s.machine.firmware);
    if (s.material) Object.assign(state.material, s.material);
    // Migration: Ältere Stände (Voreinstellungen aus der Datenbank) kannten keine
    // `mats`-Liste. Aus den vorhandenen je-Werkstoff-Daten die Liste rekonstruieren,
    // damit früher angelegte/kalibrierte Werkstoffe erhalten bleiben.
    if (!Array.isArray(state.material.mats) || !state.material.mats.length) {
      const ids = [];
      ['props', 'kerf', 'feed', 'heat', 'cal'].forEach(k => {
        const o = state.material[k];
        if (o && typeof o === 'object') Object.keys(o).forEach(id => { if (id && ids.indexOf(id) < 0) ids.push(id); });
      });
      state.material.mats = ids;
      if (state.material.id && ids.indexOf(state.material.id) < 0) state.material.id = ids[0] || '';
    }
    if (!state.material.props || typeof state.material.props !== 'object') state.material.props = {};
    if (s.palette) { Object.assign(App.PAL, s.palette); applyPalette(); savePalette(); }
    if (s.notes && typeof s.notes === 'object') { App.noteBuckets().settings = Object.assign({}, s.notes); App.refreshNoteMarks(); }
    if (s.prefs) applyPrefs(s.prefs);
  }
  // Erst nachdem die Datei neben der exe einmal gelesen wurde, darf zurück in die
  // Datei geschrieben werden. Sonst würde das allererste render() beim Start die
  // Datei mit Default-Werten überschreiben, BEVOR sie geladen werden konnte.
  let fileLoadDone = false;
  // Hat der Nutzer seit dem Start bereits selbst etwas geändert? Dann darf der
  // (asynchron eintreffende) Datei-/Datei-Fallback-Load die aktuellen Werte NICHT
  // mehr überschreiben — sonst gingen Eingaben, die im kurzen Ladefenster gemacht
  // wurden, verloren ("Parameter wird erst nach Neustart übernommen").
  let userEdited = false;
  document.addEventListener('input', () => { userEdited = true; }, true);
  document.addEventListener('change', () => { userEdited = true; }, true);
  function saveSettings() {
    if (!settingsReady) return;
    const json = JSON.stringify(collectSettings());
    try { localStorage.setItem(SETTINGS_KEY, json); } catch (e) {}
    // Zusätzlich in die Datei neben der exe schreiben (falls exe-Server läuft).
    if (fileLoadDone && typeof fetch === 'function') {
      fetch(SETTINGS_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json })
        .catch(() => {});
    }
  }
  function loadSettingsLocal() {
    try { const s = localStorage.getItem(SETTINGS_KEY); if (s) { applySettings(JSON.parse(s)); return true; } } catch (e) {}
    return false;
  }
  // Beim Schließen/Verlassen der Seite: letzten Stand zuverlässig speichern.
  // sendBeacon läuft (anders als ein normaler fetch) auch dann noch zu Ende,
  // wenn der Browser-Tab/das Fenster gerade geschlossen wird.
  function saveSettingsOnExit() {
    if (!settingsReady) return;
    const json = JSON.stringify(collectSettings());
    try { localStorage.setItem(SETTINGS_KEY, json); } catch (e) {}
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(SETTINGS_ENDPOINT, new Blob([json], { type: 'application/json' }));
      } else if (typeof fetch === 'function') {
        fetch(SETTINGS_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true }).catch(() => {});
      }
    } catch (e) {}
  }
  window.addEventListener('pagehide', saveSettingsOnExit);
  window.addEventListener('beforeunload', saveSettingsOnExit);
  // Beim Start: Datei neben der exe (falls vorhanden) hat Vorrang vor dem
  // Browser-Speicher, damit Einstellungen auch bei neuem Browser/Profil greifen.
  // Name der beim Start (exe-Launcher) gewählten Maschine in der Kopfzeile zeigen.
  function loadMachineName() {
    if (typeof fetch !== 'function') return;
    fetch('/__machine__').then(r => r.ok ? r.json() : null).then(m => {
      const el = document.getElementById('machName');
      if (!el || !m || !m.name) return;
      el.textContent = T('Maschine') + ': ' + m.name;
      el.hidden = false;
    }).catch(() => {});
  }

  // Lizenznehmer laden (nur bei einer personalisierten Ausgabe vorhanden).
  // window.LICENSE trägt Name/E-Mail/Computer und steht als Wasserzeichen im
  // erzeugten G-Code (siehe gcode.js applyFeedMode) sowie im Versions-Hinweis.
  function loadLicense() {
    if (typeof fetch !== 'function') return;
    // Normalerweise steht window.LICENSE schon in der Seite (der Server setzt es
    // ein, damit der erste erzeugte G-Code das Wasserzeichen trägt). Dieser
    // Nachzügler ist nur die Rückfallebene.
    fetch('/__lizenz__').then(r => r.ok ? r.json() : null).then(d => {
      if (!d) return;
      // Vollständige Auskunft (auch Computer-/Anforderungscode) für den Reiter
      // „Lizenz" in den Einstellungen. Fehlt sie (Browser, Python-Variante),
      // erscheint der Reiter nicht.
      window.LICENSE_INFO = d;
      if (!d.lic || (window.LICENSE && window.LICENSE.lic === d.lic)) return;
      window.LICENSE = d;
      showAppVersion();          // Hinweistext um den Lizenznehmer ergänzen
      if (App.autoGen) App.autoGen();   // G-Code mit Wasserzeichen neu erzeugen
    }).catch(() => {});
  }

  // Versionsnummer (aus window.BUILD_INFO, vom Build-Tool in die HTML eingefügt)
  // rechts neben dem Programmnamen zeigen; ohne Build-Info (Entwicklung) „Dev“.
  function showAppVersion() {
    const bi = window.BUILD_INFO || null;
    // Fenster-/Tab-Titel oben links an die Ausgabe anpassen: die Design-Ausgabe
    // heißt „AI Foam Cut Designer". In Electron setzt main.js (windowTitle) denselben
    // Titel; hier gilt es für den Browser-/PyInstaller-Tab. Idempotent (immer neu setzen).
    try {
      const edN = bi && bi.edition ? String(bi.edition) : '';
      document.title = (edN === 'Design') ? 'AI Foam Cut Designer' : 'AI Foam Cut';
    } catch (e) {}
    const el = document.getElementById('appVer');
    if (!el) return;
    el.textContent = '';
    if (bi && bi.version) {
      const b = document.createElement('b'); b.textContent = 'v' + bi.version; el.appendChild(b);
      const ed = bi.edition == null ? 'Demo' : String(bi.edition);
      // Läuft gerade der Demo-Zeitraum, steht „Demo (n Tage übrig)" ohnehin
      // gleich dahinter — die Ausgabe „Demo" dann nicht doppelt nennen.
      const demoRun = !!(window.DEMO && window.DEMO.on);
      if (ed && !(demoRun && /^demo$/i.test(ed))) el.appendChild(document.createTextNode(' · ' + T(ed)));
      const tip = [T('Programmversion') + ' ' + bi.version + (ed ? ' (' + T(ed) + ')' : '')];
      if (bi.date) tip.push(T('Erstellt') + ': ' + bi.date);
      if (bi.expiry) tip.push(T('Gültig bis') + ': ' + bi.expiry);
      if (bi.features && bi.features.length) tip.push(T('Funktionen') + ': ' + bi.features.join(', '));
      const dm = window.DEMO;
      if (dm && dm.on) {
        const rest = dm.daysLeft === 1 ? T('noch 1 Tag') : dm.daysLeft + ' ' + T('Tage übrig');
        const s = document.createElement('b');
        s.style.color = '#fbbf24';
        s.textContent = ' · ' + T('Demo') + ' (' + rest + ')';
        el.appendChild(s);
        tip.push(T('Demo-Version') + ': ' + rest + ' — ' + T('danach ist ein Lizenzschlüssel nötig.'));
        tip.push(T('G-Code speichern und kopieren ist in der Demo gesperrt.'));
      }
      const lz = window.LICENSE;
      if (lz && lz.lic) {
        tip.push(T('Lizenziert für') + ': ' + lz.name + ' <' + lz.email + '>');
        tip.push(T('Lizenz') + ': ' + lz.lic + ' · ' + T('Computer') + ' ' + lz.machine);
        el.appendChild(document.createTextNode(' · ' + lz.name));
        if (lz.typ === 'demo') {
          const rest = lz.daysLeft === 1 ? T('letzter Tag') : lz.daysLeft + ' ' + T('Tage übrig');
          const s = document.createElement('b');
          s.style.color = '#fbbf24';
          s.textContent = ' · ' + T('Demo-Lizenz') + ' (' + rest + ')';
          el.appendChild(s);
          tip.push(T('Demo-Lizenz') + ': ' + T('Voller Funktionsumfang bis einschließlich') + ' '
            + lz.expiry + ' — ' + T('danach ist ein Lizenzschlüssel nötig.'));
        }
      }
      el.title = tip.join('\n');
    } else {
      el.textContent = 'Dev';
      el.title = T('Entwicklungsversion (nicht als exe gebaut)');
    }
    el.hidden = false;
  }
  window.showAppVersion = showAppVersion;

  function loadSettingsFromExeFolder() {
    loadMachineName();
    loadLicense();
    showAppVersion();
    if (typeof fetch !== 'function') { fileLoadDone = true; return; }
    fetch(SETTINGS_ENDPOINT).then(r => r.ok ? r.json() : null).then(s => {
      // Nur übernehmen, wenn der Nutzer im Ladefenster noch nichts geändert hat.
      // Sonst nur fileLoadDone setzen, damit die bereits geänderten Werte per
      // render()/saveSettings() jetzt in die Datei geschrieben werden.
      const apply = s && !userEdited;
      if (apply) { applySettings(s); try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {} }
      fileLoadDone = true;   // ab jetzt darf zurückgeschrieben werden
      if (apply) { App.buildSidebar(); App.render(); }   // render() speichert den geladenen Stand in die Datei
      else saveSettings();   // aktuellen (ggf. schon bearbeiteten) Stand sichern
    }).catch(() => { fileLoadDone = true; });
  }

  // ---------- Projekt --------------------------------------------------
  const SEGKEYS = ['chord', 'span', 'sweep', 'sweepMode', 'washout', 'twistRef', 'dihMode', 'dih', 'dihRoot',
    'hingeSide', 'hingePct', 'hingePctTip',
    'hingeGroupStart', 'hingeSweep', 'hingeSweepMode',
    'alignGroupStart', 'alignDih', 'alignDihMode',
    'sheetRoot', 'sheetTip', 'sheetRootTop', 'sheetRootBot', 'sheetTipTop', 'sheetTipBot',
    'leExt', 'leExtTip', 'leExtProp', 'leExt2', 'leExt2Tip', 'leExt2Prop',
    'teExt', 'teExtTip', 'teExtProp', 'blockH',
    'bLE', 'bLETip', 'bLEProp', 'bTE', 'bTETip', 'bTEProp'];
  // Projektnamen in State + Kopfzeilen-Eingabefeld synchronisieren.
  function setProjectName(v) {
    state.projectName = v || '';
    const pn = document.getElementById('projName');
    if (pn && pn.value !== state.projectName) pn.value = state.projectName;
  }
  // Aus dem Projektnamen einen zulässigen Dateinamen (ohne Endung) bilden.
  function projFileBase() {
    const b = (state.projectName || '').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ');
    return b || 'hotwing-projekt';
  }
  // Neues Projekt: verwirft alle projekt-bezogenen Daten (Tragfläche, Segmente,
  // Holme, DXF-/SVG-Formen, 3D-Modell, CAD-Bearbeitung, generierter G-Code,
  // Projekt-Notizen) und stellt die im Quelltext hinterlegten Anfangswerte für
  // cfg (außer Maschinen-Keys), dxf und cad wieder her. Maschinen-Einstellungen
  // (MACHINE_KEYS) und die komplette Werkstoff-Datenbank bleiben unangetastet;
  // die zuletzt gewählte Werkstoff-ID (state.material.id) bleibt ebenfalls
  // erhalten (die Auswahl gehört zwar zum Projekt, ein Zurücksetzen darauf
  // hätte aber ohne Kontext keinen sinnvollen Wert).
  function newProject(silent) {
    setProjFileHandle(null);
    const hasWork = !!state.projectName
      || (state.segments && state.segments.length > 1)
      || (state.wings && state.wings.length > 1)
      || (state.spars && state.spars.length)
      || (state.dxf && state.dxf.layers && Object.keys(state.dxf.layers).length)
      || (state.cad && state.cad.order && state.cad.order.length)
      || (window.Model3D && Model3D.state && Model3D.state.verts)
      || (state.modelGcode);
    if (!silent && hasWork) {
      if (!confirm(T('Neues Projekt starten? Alle Tragflächen-, DXF-, 3D- und CAD-Daten des aktuellen Projekts werden verworfen. Maschinen-Einstellungen und Werkstoff-Datenbank bleiben erhalten.'))) return;
    }
    // cfg: nur nicht-maschinen-Keys aus den Defaults übernehmen.
    for (const k in PROJECT_DEFAULTS.cfg) {
      if (MACHINE_KEYS.indexOf(k) >= 0) continue;
      const v = PROJECT_DEFAULTS.cfg[k];
      state.cfg[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
    }
    // Tragfläche (Wurzel + Segmente + Holme).
    state.root = { profile: Airfoil.naca4('2412', 100), chord: 200, twistRef: 0.25 };
    state.segments = [ mkSeg({ chord: 160, span: 300, sweep: 10, washout: 0, dih: 0 }) ];
    state.spars = [];
    // Overrides und Editor-Zustände verwerfen.
    state.pathEdit = {}; state.negEdit = {}; state.negBurnEdit = {};
    if (state.profBase) state.profBase = {};
    // Wieder genau eine Tragfläche (wings.js); ihre Daten sind die eben gesetzten.
    if (App.resetWings) App.resetWings();
    // Tragflächen-Einstellungen ohne Programm-Vorgabe (Rippen, Formenbau …) verwerfen.
    if (App.isWingCfgKey) for (const k in state.cfg) if (App.isWingCfgKey(k) && !(k in PROJECT_DEFAULTS.cfg)) delete state.cfg[k];
    if (state.dxfExport) state.dxfExport.segs = null;
    // DXF-/SVG-Reiter zurücksetzen (Layer, Ribs, Hintergrundbild, Editor).
    for (const k in state.dxf) delete state.dxf[k];
    Object.assign(state.dxf, JSON.parse(JSON.stringify(PROJECT_DEFAULTS.dxf)));
    // CAD-Reiter zurücksetzen.
    for (const k in state.cad) delete state.cad[k];
    Object.assign(state.cad, JSON.parse(JSON.stringify(PROJECT_DEFAULTS.cad)));
    // 3D-Modell verwerfen.
    state.modelGcode = null;
    if (window.Model3D && Model3D.reset) { try { Model3D.reset(); } catch (e) {} }
    // Reiter „Schriften" (optional): Text, Schrift und Einstellungen zurücksetzen.
    if (window.Schrift && Schrift.reset) { try { Schrift.reset(); } catch (e) {} }
    // Generierter G-Code, aktive Auswahl, Projekt-Notizen, Projektname.
    state.lastGcode = null; state.gcodeEdited = false;
    state.activeSeg = 0; state.activeSpar = null;
    if (typeof App.noteBuckets === 'function') App.noteBuckets().project = {};
    setProjectName('');
    // Neu zeichnen.
    if (typeof dxfResolve === 'function') { try { dxfResolve(); } catch (e) {} }
    App.buildSidebar(); App.render();
    if (typeof App.refreshNoteMarks === 'function') App.refreshNoteMarks();
    if (typeof renderDxf === 'function' && state.activeTab === 'dxf') renderDxf();
    if (!silent) toast(T('Neues Projekt.'));
  }

  // Datei, in die das aktuelle Projekt zuletzt gespeichert bzw. aus der es geladen
  // wurde. Strg+S (saveProject({ quick: true })) schreibt ohne Dialog direkt dorthin;
  // ohne Datei (neues Projekt, Download-Fallback) kommt einmal der Speichern-Dialog.
  let projFileHandle = null;
  function setProjFileHandle(h) { projFileHandle = (h && h.createWritable) ? h : null; }
  async function saveProject(opts) {
    const quick = !!(opts && opts.quick);
    const enc = p => ({ name: p.name, pts: p.map(q => [+q.x.toFixed(6), +q.y.toFixed(6)]) });
    // DXF-Formen serialisieren: nur JSON-taugliche Werte (Image-Objekte/Drag-
    // Zustände auslassen; das Hintergrundbild bleibt als dataURL in bg.url erhalten).
    const dxfClean = JSON.parse(JSON.stringify(state.dxf, (k, v) => {
      if (k === 'img' || (k && k[0] === '_')) return undefined;
      return v;
    }));
    // Schleifen explizit mit closed/name serialisieren — diese Array-Eigenschaften
    // gehen bei JSON.stringify sonst verloren (Polygone kämen offen zurück).
    if (state.dxf.layers) {
      const L = {};
      for (const name in state.dxf.layers)
        L[name] = state.dxf.layers[name].map(loop => ({
          closed: !!loop.closed, name: loop.name || undefined,
          pts: loop.map(p => [+p.x.toFixed(6), +p.y.toFixed(6)]) }));
      dxfClean.layers = L;
    }
    // Maschinendaten (MACHINE_KEYS) und Werkstoff-Datenbank gehören zu den
    // Einstellungen und dürfen NICHT im Projekt landen — sonst würden sie beim
    // Laden eines Projekts überschrieben. Aus dem Projekt kommt nur die aktuell
    // ausgewählte Werkstoff-ID (state.material.id) sowie alle projekt-cfg-Werte
    // außer den maschinenspezifischen.
    const cfgProj = {};
    // Reine Ansichtszustände (z. B. Formenbau-Ansicht 3D/2D-Schnitt/Winglet-Zeichnung) gehören nicht ins Projekt.
    const VIEW_ONLY = ['formView', 'formCutOn'];
    for (const k in state.cfg) if (MACHINE_KEYS.indexOf(k) < 0 && VIEW_ONLY.indexOf(k) < 0) cfgProj[k] = state.cfg[k];
    // Eine Tragfläche (Wurzel + Segmente + Holme) im Dateiformat.
    const encWing = (root, segments, spars) => ({
      root: { chord: root.chord, profile: enc(root.profile) },
      segments: segments.map(s => {
        const o = { profile: enc(s.profile) };
        SEGKEYS.forEach(k => o[k] = s[k]); return o;
      }),
      spars: spars || []
    });
    // root/segments/spars auf oberster Ebene = aktive Tragfläche (ältere Programm-
    // stände lesen weiterhin genau diese); wings[] = alle Tragflächen (wings.js).
    const wingsData = App.serializeWings ? App.serializeWings(encWing) : null;
    const data = Object.assign({
      v: 5, cfg: cfgProj, material: { id: state.material.id }, projectName: state.projectName || ''
    }, encWing(state.root, state.segments, state.spars), {
      wings: wingsData, activeWing: state.activeWing || 0,
      notes: App.noteBuckets().project,
      // DXF-/SVG-Formen und 3D-Modell (Netz + Bearbeitungen) mitspeichern.
      dxf: dxfClean,
      modelGcode: state.modelGcode || null,
      model3d: (window.Model3D && Model3D.serialize) ? Model3D.serialize() : null
    });
    const text = JSON.stringify(data, null, 1);
    if (quick && projFileHandle && FS_SUPPORTED && !App.demoSaveBlocked('svProject')) {
      try {
        if (await fsPerm(projFileHandle, 'readwrite')) {
          const w = await projFileHandle.createWritable(); await w.write(text); await w.close();
          toast('Gespeichert: ' + projFileHandle.name);
          recordRecent(projFileHandle); return;
        }
      } catch (e) { /* Datei weg/gesperrt → Dialog */ }
    }
    const fh = await exportViaPicker(projFileBase() + '.json', text, 'application/json', 'svProject');
    if (fh) { setProjFileHandle(fh); recordRecent(fh); }
  }
  function decProf(o) { const p = o.pts.map(a => ({ x: a[0], y: a[1] })); p.name = o.name || 'Profil'; return p; }
  function loadProject(txt) {
    const d = JSON.parse(txt);
    setProjFileHandle(null);   // Aufrufer mit Datei-Handle setzen es danach neu
    // Maschinendaten (MACHINE_KEYS) NIE aus dem Projekt übernehmen — sie
    // gehören zu den Einstellungen und würden sonst überschrieben. Ältere
    // Projekte (v<=3) enthalten sie noch → gezielt ausfiltern.
    // Kern-Stege: Altprojekte ohne diese Keys starten mit den Defaults (kein Rest vom Vorprojekt).
    // Reiter „Schriften": Altprojekte ohne sc*-Werte starten mit den Vorgaben.
    if (window.Schrift && Schrift.reset) { try { Schrift.reset(); } catch (e) {} }
    ['negStegeOn', 'negStegeList', 'negStegeGap', 'negStegeOnly'].forEach(k => {
      const v = PROJECT_DEFAULTS.cfg[k]; state.cfg[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
    });
    if (d.cfg) for (const k in d.cfg) if (MACHINE_KEYS.indexOf(k) < 0 && k !== 'formView' && k !== 'formCutOn') state.cfg[k] = d.cfg[k];   // formView/formCutOn: Ansicht, nicht Projekt
    state.cfg.formCutOn = false;   // Schnittansicht startet immer deaktiviert
    // Entfernter EL-Modus „Skelett-Keil" -> auf „Horizontal" migrieren.
    if (state.cfg.teStyle === 'camber') state.cfg.teStyle = 'horizontal';
    App.migrateExtOverBlock(state.cfg);   // alt: ein Schalter für NL & EL -> getrennt
    // Aus dem Projekt kommt nur die ausgewählte Werkstoff-ID; die Datenbank
    // selbst (mats/props/kerf/feed/heat/cal, height, safeH, meltDwell,
    // preheatSec, preheatH) bleibt unangetastet. Altprojekte mit vollem
    // material-Block würden sonst die persistente DB überschreiben.
    if (d.material && d.material.id != null) {
      // Nur setzen, wenn die ID in der lokalen DB existiert — sonst ersten
      // vorhandenen Werkstoff behalten, damit die Auswahl gültig bleibt.
      const mats = Array.isArray(state.material.mats) ? state.material.mats : [];
      if (!d.material.id || mats.indexOf(d.material.id) >= 0) state.material.id = d.material.id;
    }
    setProjectName(d.projectName || '');
    // Eine Tragfläche (Wurzel + Segmente + Holme) aus dem Dateiformat lesen —
    // für die oberste Ebene (Altprojekte = genau eine Tragfläche) und je Eintrag
    // in d.wings (mehrere Tragflächen, wings.js).
    const decWing = w => {
      let root, segments;
      if (d.v >= 2) {
        root = { chord: w.root.chord, profile: decProf(w.root.profile) };
        segments = w.segments.map(s => {
          const o = mkSeg({ profile: decProf(s.profile) });
          SEGKEYS.forEach(k => { if (s[k] != null) o[k] = s[k]; });
          return o;
        });
      } else {
        const rp = w.root.map(a => ({ x: a[0], y: a[1] })); rp.name = w.rootName || 'Profil';
        const tp = w.tip.map(a => ({ x: a[0], y: a[1] })); tp.name = w.tipName || 'Profil';
        root = { chord: w.cfg.rootChord || 200, profile: rp };
        segments = [mkSeg({ profile: tp, chord: w.cfg.tipChord || 140, span: w.cfg.span || 400,
          sweep: w.cfg.sweep || 0, washout: w.cfg.washout || 0 })];
      }
      // Holmausschnitte: neue globale Liste, oder Migration alter per-Segment-Holme.
      let spars;
      if (Array.isArray(w.spars)) spars = w.spars.map(s => Object.assign({}, s));
      else {
        spars = [];
        segments.forEach((s, i) => (s.spars || []).forEach(sp => {
          spars.push(Object.assign(App.newSpar(), sp, { segFrom: i, segTo: i })); delete s.spars;
        }));
      }
      // V-förmig entfernt (mit Trapez abgedeckt) -> Altstände migrieren.
      spars.forEach(sp => { if (sp.shape === 'v') sp.shape = 'trapez'; });
      // Taschen-Parameter (Gurt ohne Steg) in Altständen ergänzen, damit das Umstellen
      // auf Form „Tasche" nicht auf undefinierte Werte trifft.
      spars.forEach(sp => {
        if (sp.pkDepth == null) sp.pkDepth = 8; if (sp.pkSide == null) sp.pkSide = 'both';
        if (sp.pkDepthTop == null) sp.pkDepthTop = sp.pkDepth; if (sp.pkDepthBot == null) sp.pkDepthBot = sp.pkDepth;
        if (sp.pkWebTop == null) sp.pkWebTop = 0; if (sp.pkWebBot == null) sp.pkWebBot = 0; if (sp.pkWebW == null) sp.pkWebW = 2;
        // Taschen: Lage immer proportional (% der Sehne) — mm-Altstände umrechnen.
        if ((sp.shape === 'pocket' || sp.shape === 'pocketWeb') && sp.posMode === 'mm') {
          const a = Math.max(0, Math.min(sp.segFrom || 0, sp.segTo || 0));
          const c = (a === 0 ? (root && root.chord) : (segments[a - 1] && segments[a - 1].chord)) || 1;
          sp.pos = (sp.pos || 0) / c * 100; sp.posMode = 'pct';
        }
      });
      return { root, segments, spars };
    };
    const top = decWing(d);
    state.root = top.root; state.segments = top.segments; state.spars = top.spars;
    // Overrides des vorigen Projekts verwerfen (passen nicht zur neuen Geometrie).
    state.pathEdit = {}; state.negEdit = {}; state.negBurnEdit = {};
    if (state.profBase) state.profBase = {};
    // Mehrere Tragflächen: alle einlesen und die aktive einsetzen. Altprojekte
    // (ohne wings) = eine Tragfläche aus der obersten Ebene.
    if (App.restoreWings) {
      if (Array.isArray(d.wings) && d.wings.length) {
        const recs = d.wings.map(w => {
          try { return Object.assign(decWing(w), { name: w.name, cfg: (w.cfg && typeof w.cfg === 'object') ? w.cfg : {} }); }
          catch (e) { return null; }
        }).filter(Boolean);
        if (recs.length) App.restoreWings(recs, d.activeWing);
        else App.restoreWings(null);
      } else App.restoreWings(null);
    }
    // Projekt-Notizen übernehmen (ersetzen den bisherigen Projekt-Satz).
    App.noteBuckets().project = (d.notes && typeof d.notes === 'object') ? Object.assign({}, d.notes) : {};
    // DXF-/SVG-Formen wiederherstellen (Hintergrundbild aus dataURL neu aufbauen).
    if (d.dxf && typeof d.dxf === 'object') {
      // Schleifen wieder als Arrays mit closed/name aufbauen (neues Format
      // {closed,name,pts}; altes Format = reines Punkt-Array -> als geschlossen
      // annehmen, da DXF-Konturen im Regelfall geschlossen sind).
      if (d.dxf.layers && typeof d.dxf.layers === 'object') {
        const L = {};
        for (const name in d.dxf.layers) {
          const loops = d.dxf.layers[name] || [];
          L[name] = loops.map(loop => {
            if (Array.isArray(loop)) {
              const a = loop.map(p => Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y });
              a.closed = true; return a;
            }
            const a = (loop.pts || []).map(p => Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y });
            a.closed = !!loop.closed; if (loop.name) a.name = loop.name; return a;
          });
        }
        d.dxf.layers = L;
      }
      Object.assign(state.dxf, d.dxf);
      // Abbrand-Berechnung je Ebene (2026-09-18): Altprojekte hatten EINE gemeinsame
      // Methode (cfg.kerfMode) — DXF-Formen übernehmen sie einmalig.
      if (d.dxf.kerfMode == null) state.dxf.kerfMode = (d.cfg && d.cfg.kerfMode) || 'ratio';
      if (App.dxfResolve) App.dxfResolve();   // inner/outer aus den wiederhergestellten Layern neu ableiten (nur mit Reiter „DXF-Formen“)
      const bg = state.dxf.bg;
      if (bg) { bg._drag = null; bg.img = null;
        if (bg.url) { const im = new Image(); im.onload = () => { bg.img = im; bg.iw = im.naturalWidth || im.width; bg.ih = im.naturalHeight || im.height; if (typeof renderDxf === 'function' && state.activeTab === 'dxf') renderDxf(); }; im.src = bg.url; } }
    }
    // 3D-Modell-Bearbeitungen (Segment-/Platten-Konfiguration) und Netz.
    if (d.modelGcode && typeof d.modelGcode === 'object') {
      state.modelGcode = d.modelGcode;
      // Wie oben: das 3D-Modell übernimmt die frühere gemeinsame Abbrand-Berechnung.
      if (state.modelGcode.kerfMode == null) state.modelGcode.kerfMode = (d.cfg && d.cfg.kerfMode) || 'ratio';
    }
    if (d.model3d && window.Model3D && Model3D.deserialize) { try { Model3D.deserialize(d.model3d); } catch (e) {} }
    state.activeSeg = 0;
    App.buildSidebar(); App.render();
    // Nach dem Laden JEDEN Reiter sofort auf die neuen Daten bringen: App.render()
    // erfasst nur wing/core/neg/dxf. refreshActiveView() baut zusätzlich den gerade
    // sichtbaren Reiter (Übersicht, 3D-Modell, Formenbau, Rumpf, Fräse, DXF-Export,
    // Rippen, CAD, Schneiden) neu auf. Die übrigen (inaktiven) Reiter frischen beim
    // Umschalten über switchView() ohnehin frisch aus dem State auf.
    if (App.refreshActiveView) App.refreshActiveView();
    App.refreshNoteMarks();
  }

  // ---------- Zuletzt geladene/gespeicherte Projekte -------------------
  // Speichert bis zu 10 Einträge. Die Metadaten (Name, Zeit) liegen in
  // localStorage; der zugehörige Datei-Handle (zum direkten Wiederöffnen) in
  // IndexedDB unter „recent_<id>". Ohne File System Access API wird nur der
  // Name gemerkt (Wiederöffnen dann über den normalen Ladedialog).
  const RECENT_KEY = 'hotwing.recentProjects';
  const RECENT_MAX = 10;
  function loadRecentMeta() {
    try { const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function saveRecentMeta(list) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) {}
  }
  async function recordRecent(handle, nameFallback) {
    const name = (handle && handle.name) || nameFallback;
    if (!name) return;
    let list = loadRecentMeta();
    // Doppelte (gleicher Name) entfernen und deren Handles aufräumen.
    const dropIds = list.filter(e => e.name === name).map(e => e.id);
    list = list.filter(e => e.name !== name);
    const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    list.unshift({ name, time: Date.now(), id, hasHandle: !!(handle && FS_SUPPORTED) });
    // Auf RECENT_MAX kürzen, überzählige Handles löschen.
    const removed = list.slice(RECENT_MAX);
    list = list.slice(0, RECENT_MAX);
    if (FS_SUPPORTED) {
      for (const rid of dropIds) { try { await fsDel('recent_' + rid); } catch (e) {} }
      for (const r of removed) { try { await fsDel('recent_' + r.id); } catch (e) {} }
      if (handle) { try { await fsSet('recent_' + id, handle); } catch (e) {} }
    }
    saveRecentMeta(list);
    if (loadMenuEl && loadMenuEl.classList.contains('open')) buildLoadMenu();
  }
  async function openRecent(entry) {
    if (FS_SUPPORTED && entry.hasHandle) {
      let h = null; try { h = await fsGet('recent_' + entry.id); } catch (e) {}
      if (h) {
        if (!(await fsPerm(h, 'read'))) { toast(T('Kein Zugriff auf die Datei — bitte neu laden.')); return; }
        try { const f = await h.getFile(); loadProject(await f.text()); setProjFileHandle(h); recordRecent(h); toast('Geladen: ' + entry.name); return; }
        catch (e) { toast(T('Datei nicht mehr verfügbar — bitte neu laden.')); return; }
      }
    }
    // Kein Handle: normalen Ladedialog öffnen.
    toast(T('Bitte Datei über den Ladedialog wählen.'));
    loadProjectDialog();
  }
  // ---------- Kopfzeilen-Menüs „Laden" / „Speichern" ------------------
  // Alle Ladeaktionen (Projekt laden, Tragfläche importieren, Einstellungen
  // laden, zuletzt geladen) sind in einem Dropdown „Laden" zusammengefasst,
  // alle Speicheraktionen (Projekt, Einstellungen) in einem Dropdown „Speichern".

  // Gemeinsame Aktionen (auch von openRecent bzw. Strg+S genutzt).
  function loadProjectDialog() {
    loadVia({ 'application/json': ['.json'] }, (t, name, handle) => { try { loadProject(t); setProjFileHandle(handle); recordRecent(handle || null, name); } catch (err) { alert(err.message); } }, 'fileProj', 'ldProject');
  }
  function loadSettingsDialog() {
    loadVia({ 'application/json': ['.json'] }, t => { try { applySettings(JSON.parse(t)); App.buildSidebar(); App.render(); } catch (err) { alert(T('Einstellungen fehlerhaft: ') + err.message); } }, 'fileSettings', 'ldSettings');
  }
  function saveSettingsFile() {
    exportViaPicker(SETTINGS_FILE, JSON.stringify(collectSettings(), null, 1), 'application/json', 'svSettings');
  }
  function fmtRecentTime(t) {
    if (!t) return '';
    const d = new Date(t), now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    if (sameDay) return hh;
    return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '. ' + hh;
  }

  // Menü-Bausteine (gemeinsam für Laden/Speichern).
  function mkMenuItem(menuEl, text, title, fn, opt) {
    opt = opt || {};
    const it = document.createElement('div'); it.className = 'rm-item';
    const nm = document.createElement('span'); nm.className = 'rm-name';
    nm.textContent = opt.raw ? text : T(text); if (title) nm.title = T(title);
    it.appendChild(nm);
    if (opt.primary) nm.style.color = 'var(--accent2)';
    it.onclick = () => { closeLoadMenu(); closeSaveMenu(); fn(); };
    menuEl.appendChild(it);
    return it;
  }
  function mkMenuHead(menuEl, text, sep) {
    const h = document.createElement('div'); h.className = 'rm-head' + (sep ? ' sep' : '');
    h.textContent = T(text); menuEl.appendChild(h);
  }
  function openMenuAt(menuEl, btn) {
    const r = btn.getBoundingClientRect();
    menuEl.classList.add('open');
    const w = menuEl.offsetWidth || 260, vw = window.innerWidth;
    menuEl.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + 'px';
    menuEl.style.top = (r.bottom + 5) + 'px';
  }

  // --- „Laden"-Menü ---
  let loadMenuEl = null;
  function buildLoadMenu() {
    if (!loadMenuEl) {
      loadMenuEl = document.createElement('div');
      loadMenuEl.className = 'recent-menu';
      document.body.appendChild(loadMenuEl);
      loadMenuEl.addEventListener('mousedown', e => e.stopPropagation());
    }
    loadMenuEl.textContent = '';
    // Projekt
    mkMenuHead(loadMenuEl, 'Projekt');
    mkMenuItem(loadMenuEl, 'Neues Projekt', 'Aktuelles Projekt verwerfen und mit den Programm-Vorgaben neu beginnen. Maschinen-Einstellungen und Werkstoff-Datenbank bleiben erhalten.', () => newProject());
    mkMenuItem(loadMenuEl, 'Projekt laden…', 'Projekt (.json) aus Datei laden.', loadProjectDialog);
    // Tragfläche importieren
    mkMenuHead(loadMenuEl, 'Tragfläche importieren', true);
    mkMenuItem(loadMenuEl, 'FLZ_Vortex (.flz) importieren…',
      'FLZ_Vortex-Projekt (.flz) oder CSV-Export: Sehnen, Spannweiten, Pfeilung, V-Form, Schränkung und Klappentiefen — inklusive aller Profilkoordinaten. Enthält die Datei mehrere Flügel (Tragfläche, Leitwerke), wird zur Auswahl gefragt, welche übernommen werden und in welche Tragfläche des Projekts.',
      () => loadFlz());
    mkMenuItem(loadMenuEl, 'XFLR5 (.xfl) importieren…',
      'XFLR5-Projekt (.xfl) oder plane-XML: Planform (Sehnen, Spannweiten, Pfeilung, V-Form, Schränkung). Das .xfl-Projekt bringt auch die Profilkoordinaten mit und kann mehrere Modelle mit je mehreren Flügeln enthalten — die Auswahl fragt, was übernommen wird und wohin. Das plane-XML hat nur Profilnamen (Platzhalter, .dat nachladen).',
      () => loadXflr());
    mkMenuItem(loadMenuEl, 'Planform Creator (.pc2) importieren…',
      'Planform Creator 2 (.pc2): glatte/elliptische Fläche, eigener Trapez-Dialog mit Live-Vorschau. Profile als .dat zuordnen.',
      () => { if (confirm(T('Der Import ersetzt die komplette Tragfläche (alle Segmente, Profile und Holme). Fortfahren?'))) loadPc2(); });
    // GMFC-Projekt → Tragflächendesigner (Feature „gmfc").
    if (typeof App.gmfcImportWing === 'function') {
      mkMenuItem(loadMenuEl, 'GMFC-Projekt (.cnc) importieren…',
        'GMFC-Tragflächenprojekt (.cnc): Profile, Sehnen, Spannweiten, Pfeilung, V-Form, Schränkung, Blockhöhe, Ränder und Beplankung aller Segmente in den Tragflächendesigner übernehmen. Holmausschnitte werden nicht übertragen; Rumpfprojekte (geschlossene Querschnitte) gehören in „DXF-Formen".',
        () => { if (confirm(T('Der GMFC-Import ersetzt die komplette Tragfläche (alle Segmente, Profile und Holme). Fortfahren?'))) App.gmfcImportWing(); });
    }
    // GMFC-Projekt → DXF-Formen (Feature „gmfc" + „dxfshapes").
    if (typeof App.gmfcImportDxf === 'function' && typeof App.dxfApplyRibChain === 'function') {
      mkMenuHead(loadMenuEl, 'DXF-Formen importieren', true);
      mkMenuItem(loadMenuEl, 'GMFC-Projekt (.cnc) in DXF-Formen…',
        'GMFC-Projektdatei (.cnc) mit importierten, in GMFC synchronisierten Querschnitten und mehreren Segmenten als Rippenkette in den Reiter „DXF-Formen" laden (ersetzt dessen Inhalt).',
        () => App.gmfcImportDxf());
    }
    // Profil-Zuordnung nur anbieten, wenn Foil-Namen vorhanden sind (nach XFLR5/PC2).
    const hasFoilNames = (state.root && state.root.foilName) || state.segments.some(s => s.foilName);
    if (hasFoilNames) {
      const openCnt = (state.root && state.root.foilName && isPlaceholderProfile(state.root.profile) ? 1 : 0)
        + state.segments.filter(s => s.foilName && isPlaceholderProfile(s.profile)).length;
      mkMenuItem(loadMenuEl, T('Profile (.dat) zuordnen…') + (openCnt ? ' (' + openCnt + ')' : ''),
        'Mehrere Profil-.dat auf einmal wählen; Zuordnung über den Foil-Namen. Passende Profile ersetzen die Platzhalter automatisch.',
        loadFoilDats, { raw: true, primary: !!openCnt });
    }
    // Einstellungen
    mkMenuHead(loadMenuEl, 'Einstellungen', true);
    mkMenuItem(loadMenuEl, 'Einstellungen laden…', 'Einstellungsdatei laden.', loadSettingsDialog);
    // Zuletzt geladen
    mkMenuHead(loadMenuEl, 'Zuletzt geladen', true);
    const list = loadRecentMeta();
    if (!list.length) {
      const e = document.createElement('div'); e.className = 'rm-empty';
      e.textContent = T('Noch keine Projekte geladen.'); loadMenuEl.appendChild(e);
    } else {
      list.forEach(entry => {
        const it = document.createElement('div'); it.className = 'rm-item';
        const nm = document.createElement('span'); nm.className = 'rm-name';
        nm.textContent = entry.name; nm.title = entry.name;
        const tm = document.createElement('span'); tm.className = 'rm-time';
        tm.textContent = fmtRecentTime(entry.time);
        it.appendChild(nm); it.appendChild(tm);
        it.onclick = () => { closeLoadMenu(); openRecent(entry); };
        loadMenuEl.appendChild(it);
      });
      const foot = document.createElement('div'); foot.className = 'rm-foot';
      const clr = document.createElement('button'); clr.textContent = T('Liste leeren');
      clr.onclick = async () => {
        if (FS_SUPPORTED) for (const e of list) { try { await fsDel('recent_' + e.id); } catch (er) {} }
        saveRecentMeta([]); buildLoadMenu();
      };
      foot.appendChild(clr); loadMenuEl.appendChild(foot);
    }
  }
  function toggleLoadMenu(btn) {
    if (loadMenuEl && loadMenuEl.classList.contains('open')) { closeLoadMenu(); return; }
    closeSaveMenu(); buildLoadMenu(); openMenuAt(loadMenuEl, btn);
  }
  function closeLoadMenu() { if (loadMenuEl) loadMenuEl.classList.remove('open'); }

  // --- „Speichern"-Menü ---
  let saveMenuEl = null;
  function buildSaveMenu() {
    if (!saveMenuEl) {
      saveMenuEl = document.createElement('div');
      saveMenuEl.className = 'recent-menu';
      document.body.appendChild(saveMenuEl);
      saveMenuEl.addEventListener('mousedown', e => e.stopPropagation());
    }
    saveMenuEl.textContent = '';
    // Kern-Demo / Design-Ausgabe: der Export ist gesperrt. Bei der Design-Ausgabe
    // bleiben „Projekt speichern" und der Flugzeug-Export (XFLR5/FLZ/PC2, reine
    // Designdaten) nutzbar; die übrigen Einträge bleiben sichtbar (ausgegraut),
    // damit man sieht, was die Vollversion kann.
    if (App.demoNoSave && App.demoNoSave()) {
      const projOk = App.demoProjectAllowed && App.demoProjectAllowed();
      mkMenuHead(saveMenuEl, projOk
        ? 'Design-Ausgabe — Projekt speichern & Flugzeug-Export'
        : 'Demo-Version — Speichern und Exportieren gesperrt');
      const dim = (it) => { it.style.opacity = '.45'; it.style.cursor = 'not-allowed';
        it.title = T(App.demoKernMsg); it.onclick = () => { closeSaveMenu(); App.toast(T(App.demoKernMsg)); }; return it; };
      if (projOk) mkMenuItem(saveMenuEl, 'Projekt speichern', 'Projekt als .json speichern (Strg+Umschalt+S).', saveProject);
      else dim(mkMenuItem(saveMenuEl, 'Projekt speichern', '', () => {}));
      if (typeof App.gmfcExport === 'function') dim(mkMenuItem(saveMenuEl, 'Tragfläche als GMFC-Projekt (.cnc)…', '', () => {}));
      if (typeof App.wingExportOpen === 'function') {
        if (projOk) {
          mkMenuItem(saveMenuEl, 'Flugzeug für FLZ_Vortex (.flz)…',
            'Alle Tragflächen des Projekts als FLZ_Vortex-Projekt schreiben (mit Profilen, Spitze zu Spitze gespiegelt). Im Fenster werden Rolle und Lage der Flächen, die Panelaufteilung (Rechennetz) und die Massen eingestellt.',
            App.wingExportFlz);
          mkMenuItem(saveMenuEl, 'Flugzeug für XFLR5 (.xfl)…',
            'Alle Tragflächen des Projekts als XFLR5-Projekt schreiben (mit Profilen). Wahlweise auch als plane-XML ohne Profile. Im Fenster werden Rolle und Lage der Flächen, die Panelaufteilung (Rechennetz) und die Massen eingestellt.',
            App.wingExportXflr);
          mkMenuItem(saveMenuEl, 'Tragfläche für Planform Creator 2 (.pc2)…',
            'Die erste angehakte Tragfläche als Planform-Creator-2-Datei schreiben (Trapezfläche mit Rippen, Scharnierlinie und Klappengruppen). PC2 beschreibt genau eine halbe Tragfläche; Profile stehen nur als Dateiname darin, nicht als Koordinaten.',
            App.wingExportPc2);
        } else {
          dim(mkMenuItem(saveMenuEl, 'Flugzeug für FLZ_Vortex (.flz)…', '', () => {}));
          dim(mkMenuItem(saveMenuEl, 'Flugzeug für XFLR5 (.xfl)…', '', () => {}));
          dim(mkMenuItem(saveMenuEl, 'Tragfläche für Planform Creator 2 (.pc2)…', '', () => {}));
        }
      }
      dim(mkMenuItem(saveMenuEl, 'Einstellungen sichern', '', () => {}));
      return;
    }
    mkMenuItem(saveMenuEl, 'Projekt speichern', 'Projekt als .json speichern (Strg+Umschalt+S).', saveProject);
    // GMFC-Export (Feature „gmfc", nur wenn gmfc.js geladen ist).
    if (typeof App.gmfcExport === 'function') mkMenuItem(saveMenuEl, 'Tragfläche als GMFC-Projekt (.cnc)…', 'Tragfläche (alle Segmente, Profile, Pfeilung, V-Form, Beplankung) als GMFC-Projektdatei exportieren. Fehlende Werte (Grundhöhe, Schaumtyp …) werden vorher abgefragt.', App.gmfcExport);
    // Export in die Auslegungsprogramme (wingexport.js). Ein Fenster für beide
    // Formate — Panelaufteilung und Massen werden dort abgefragt.
    if (typeof App.wingExportOpen === 'function') {
      mkMenuItem(saveMenuEl, 'Flugzeug für FLZ_Vortex (.flz)…',
        'Alle Tragflächen des Projekts als FLZ_Vortex-Projekt schreiben (mit Profilen, Spitze zu Spitze gespiegelt). Im Fenster werden Rolle und Lage der Flächen, die Panelaufteilung (Rechennetz) und die Massen eingestellt.',
        App.wingExportFlz);
      mkMenuItem(saveMenuEl, 'Flugzeug für XFLR5 (.xfl)…',
        'Alle Tragflächen des Projekts als XFLR5-Projekt schreiben (mit Profilen). Wahlweise auch als plane-XML ohne Profile. Im Fenster werden Rolle und Lage der Flächen, die Panelaufteilung (Rechennetz) und die Massen eingestellt.',
        App.wingExportXflr);
      mkMenuItem(saveMenuEl, 'Tragfläche für Planform Creator 2 (.pc2)…',
        'Die erste angehakte Tragfläche als Planform-Creator-2-Datei schreiben (Trapezfläche mit Rippen, Scharnierlinie und Klappengruppen). PC2 beschreibt genau eine halbe Tragfläche; Profile stehen nur als Dateiname darin, nicht als Koordinaten.',
        App.wingExportPc2);
    }
    mkMenuItem(saveMenuEl, 'Einstellungen sichern', 'Maschinen- & Werkstoff-Einstellungen als hotwing-settings.json sichern (in den Programmordner legen → wird beim Start geladen).', saveSettingsFile);
  }
  function toggleSaveMenu(btn) {
    if (saveMenuEl && saveMenuEl.classList.contains('open')) { closeSaveMenu(); return; }
    closeLoadMenu(); buildSaveMenu(); openMenuAt(saveMenuEl, btn);
  }
  function closeSaveMenu() { if (saveMenuEl) saveMenuEl.classList.remove('open'); }

  document.addEventListener('mousedown', () => { closeLoadMenu(); closeSaveMenu(); });


  // ---- Registry: eigene Top-Level-Namen bereitstellen (automatisch) ----
  Object.assign(App, { DIR_DEFAULT, DIR_KEYS, DIR_TREE, FS_SUPPORTED, createDirTree, useDirTree, dirReminder, loadFileVia, markDirUsed, pickerOpts, startDir, MACHINE_KEYS, RECENT_KEY, RECENT_MAX, SEGKEYS, SETTINGS_ENDPOINT, SETTINGS_FILE });
  Object.assign(App, { SETTINGS_KEY, addFoilDats, anchorDownload, applyFoilsToWing, applySettings, buildLoadMenu, buildPc2Controls, buildPc2StationList });
  Object.assign(App, { buildSaveMenu, buildSettingsColors, buildSettingsFiles, buildSettingsLanguage, buildSettingsMenuColors, buildSettingsModal, clearDir, closeLoadMenu });
  Object.assign(App, { closePc2, closeSaveMenu, closeSettings, colGroupHead, colSection, collectSettings, colorRow, decProf });
  Object.assign(App, { dirHandles, dxfToProfileDat, exportProfileDat, exportProfileDxf, exportViaPicker, fmtRecentTime, fsDel, fsGet });
  Object.assign(App, { fsIdb, fsPerm, fsSet, isPlaceholderProfile, layersToProfileDat, loadDat, loadDirHandles, loadFlz });
  Object.assign(App, { loadFoilDats, loadPc2, loadProfileAny, loadProfileDxf, processProfileFile, loadProfileSvg, loadProject, loadProjectDialog, loadRecentMeta, loadSettingsDialog });
  Object.assign(App, { loadSettingsFromExeFolder, loadSettingsLocal, loadVia, loadXflr, mkMenuHead, mkMenuItem, newProject, openMenuAt });
  Object.assign(App, { openPc2Dialog, openRecent, openSettings, pc2DoImport, pc2Regen, pc2SortedStations, pickDir, pickTextFile });
  Object.assign(App, { processDat, processPc2, profFileBase, projFileBase, recordRecent, renderPc2 });
  Object.assign(App, { repaintAll, resetColors, saveProject, saveRecentMeta, saveSettings, saveSettingsFile, saveSettingsOnExit, saveToDir });
  Object.assign(App, { setProjectName, toggleLoadMenu, toggleSaveMenu, checklistGet, checklistSet, buildSettingsChecklist });
  Object.defineProperty(App, 'fileLoadDone', { get: () => fileLoadDone, set: v => { fileLoadDone = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'loadMenuEl', { get: () => loadMenuEl, set: v => { loadMenuEl = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'pc2dlg', { get: () => pc2dlg, set: v => { pc2dlg = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'saveMenuEl', { get: () => saveMenuEl, set: v => { saveMenuEl = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'settingsReady', { get: () => settingsReady, set: v => { settingsReady = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'settingsTab', { get: () => settingsTab, set: v => { settingsTab = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'userEdited', { get: () => userEdited, set: v => { userEdited = v; }, enumerable: true, configurable: true });
})();
