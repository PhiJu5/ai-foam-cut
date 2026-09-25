/* sidebar.js — Sidebar-Aufbau, UI-Bausteine, Funktionsbeschreibungen, Notizen  (@@split-module, ausgelagert aus app.js)
 * Namen aus früher geladenen Dateien werden unten aus window.App gebunden;
 * Namen aus app.js (lädt später) laufen als App.<name>. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, Ttitle, anchorDownload, buildCadSidebar, buildDxfExportSidebar, buildDxfSidebar, buildRibSidebar, closeSweepCmp, dim, dtThinReport } = App;
  const { isPlaceholderProfile, loadDat, loadFlz, loadFoilDats, loadPc2, loadProfileDxf, loadXflr } = App;
  const { openSweepCmp, parseNum, pocketDepth, render, renderDxf, renderMaterial, renderNeg, saveSettings } = App;
  // Aus cutpanel.js (Reiter „Schneiden"/„Maschine", abwählbar) — nur geschützt aufrufen:
  const refreshCutSource = w => { if (App.refreshCutSource) App.refreshCutSource(w); };
  const renderBlock = () => { if (App.renderBlock) App.renderBlock(); };
  // Maschinengeometrie/-grenzen brauchen auch Ausgaben ohne Reiter „Maschine" (Simulation):
  // dann erscheinen die Gruppen im Reiter „G-Code".
  function machineTab() { return document.querySelector('.tabs button[data-view="machine"]') ? 'machine' : 'gcode'; }
  const { sparConvertFlangeH, sparConvertSizeUnits, sparProportional, sparRange, state } = App;
  // ---------- kleine UI-Bausteine -------------------------------------
  // Auf-/zugeklappt-Status je Gruppe über Sidebar-Neuaufbauten hinweg merken.
  // Standard: ALLE Gruppen zugeklappt — erst ein Klick öffnet sie (Zustand bleibt
  // dann bis zum erneuten Zuklappen erhalten). Schlüssel = Titel ohne Zähler „(…)".
  const grpState = {};
  const grpKey = title => String(title).replace(/\s*\([^)]*\)\s*$/, '').trim();
  /* Menü-Orientierung: die Menüs einer Seitenleiste wechseln in Anzeige-
     reihenfolge zwischen Blau (Akzentfarbe) und Violett. Untergruppen unter
     einer Abschnitts-Überschrift übernehmen deren Farbe. Die Zuordnung wird
     nach jedem Aufbau in applyMenuColors() aus der sichtbaren Reihenfolge
     ermittelt (nicht aus dem Titel). */
  const GRP_PALETTE = ['#4aa3ff', '#57d38c'];
  const MENU_REG = new Map();   // key -> Standardfarbe (aus der Reihenfolge), für die Einstellungsliste
  // Standardfarbe eines Menüs — die zuletzt per Reihenfolge ermittelte,
  // sonst Blau.
  const grpColorDefault = key => MENU_REG.get(key) || GRP_PALETTE[0];
  // Farben aller Menüs nach ihrer sichtbaren Reihenfolge neu vergeben.
  // Je Container (Seitenleiste, Profil-Editor, verschachtelte Gruppen)
  // beginnt der Wechsel wieder bei Blau. Benutzerfarben (MENU_COL) gehen vor.
  let _menuColTimer = 0;
  function applyMenuColors() {
    _menuColTimer = 0;
    const byParent = new Map();
    document.querySelectorAll('.grp').forEach(g => {
      const p = g.parentElement; if (!p) return;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(g);
    });
    byParent.forEach(list => {
      let i = -1, cur = GRP_PALETTE[0];
      list.forEach(g => {
        if (g.style.display === 'none') return;          // ausgeblendet (anderer Reiter)
        if (!g.classList.contains('grp-sub')) { i++; cur = GRP_PALETTE[i % GRP_PALETTE.length]; }
        const key = g.dataset.grpkey || '';
        MENU_REG.set(key, cur);
        g.style.setProperty('--grp-accent', MENU_COL[key] || cur);
      });
    });
  }
  const scheduleMenuColors = () => { if (!_menuColTimer) _menuColTimer = setTimeout(applyMenuColors, 0); };
  // Benutzerdefinierte Menüfarben (überschreiben die Palette) — in den
  // Einstellungen unter „Farben → Menüfarben" wählbar, dauerhaft gespeichert.
  const MENU_COL_KEY = 'hw_menu_colors';
  let MENU_COL = {};
  try { MENU_COL = JSON.parse(localStorage.getItem(MENU_COL_KEY) || '{}') || {}; } catch (e) { MENU_COL = {}; }
  function saveMenuColors() { try { localStorage.setItem(MENU_COL_KEY, JSON.stringify(MENU_COL)); } catch (e) {} }
  const grpColor = key => MENU_COL[key] || grpColorDefault(key);
  // Farbe eines bereits gezeichneten Menüs live aktualisieren (ohne Neuaufbau).
  function applyMenuColor(key, val) {
    document.querySelectorAll('.grp').forEach(g => {
      if (g.dataset.grpkey === key) g.style.setProperty('--grp-accent', val);
    });
  }
  // Gruppen, die standardmäßig OFFEN starten (weiterhin zuklappbar).
  const GRP_OPEN_DEFAULT = new Set(['Quelle Gcode', 'Tragfläche, Schnitt und Block', 'Blocklage', 'Segmente', 'Werkstoff', 'matdb', 'Erstellen', 'Bearbeiten', 'Fang & Optionen', 'cadLayer', 'Maschinengeometrie', 'Vorschub-Modus', 'Maschinengrenzen & Warnungen']);
  /* opts.alwaysOpen = true -> Gruppe ist dauerhaft offen und NICHT klappbar
   * (kein Pfeil, kein Klick). Sonst: gemerkter Zustand, Standard zugeklappt
   * (außer in GRP_OPEN_DEFAULT). */
  function grp(title, open, tabs, opts) {
    opts = opts || {};
    const key = opts.key || grpKey(title);
    const always = !!opts.alwaysOpen;
    if (!(key in grpState)) grpState[key] = GRP_OPEN_DEFAULT.has(key);   // Standard: zugeklappt
    const isOpen = always || grpState[key];
    const g = document.createElement('div'); g.className = 'grp';
    if (tabs) g.dataset.tabs = tabs;    // Reiter, auf denen die Gruppe sichtbar ist
    // Farbliche Orientierung: jedes Menü erhält eine eigene Farbe. Standard aus
    // dem Titel abgeleitet, in den Einstellungen (Farben → Menüfarben)
    // überschreibbar. Das Menü wird dort registriert und per Key wiederfindbar.
    g.dataset.grpkey = key;
    if (!MENU_REG.has(key)) MENU_REG.set(key, grpColorDefault(key));
    g.style.setProperty('--grp-accent', grpColor(key));
    scheduleMenuColors();   // endgültige Farbe nach dem Aufbau aus der Reihenfolge
    const h = document.createElement('h3');
    const body = document.createElement('div'); body.className = 'body';
    if (always) {
      h.textContent = Ttitle(title); h.style.cursor = 'default';
    } else {
      h.innerHTML = Ttitle(title) + '<span class="ch">▾</span>';
      if (!isOpen) { body.style.display = 'none'; h.querySelector('.ch').textContent = '▸'; }
      h.onclick = () => {
        const vis = body.style.display !== 'none';
        body.style.display = vis ? 'none' : 'grid';
        h.querySelector('.ch').textContent = vis ? '▸' : '▾';
        grpState[key] = !vis;
      };
    }
    g.appendChild(h); g.appendChild(body);
    return { g, body };
  }
  function hint(body, t) { const h = document.createElement('div'); h.className = 'hint'; h.textContent = T(t); body.appendChild(h); return h; }
  // Warnhinweis (orange, hervorgehoben) — für nicht ausführbare Kombinationen.
  // Bewusst KEINE Klasse „hint": sonst würde er bei zugeklappten Funktions-
  // beschreibungen (body.hints-collapsed) mit ausgeblendet. Warnungen müssen immer
  // sichtbar bleiben. Styling daher inline.
  function warn(body, t) {
    const h = document.createElement('div');
    h.className = 'warnmsg';
    h.textContent = T(t);
    h.style.cssText = 'color:#ffb454;font-weight:600;font-size:12px;line-height:1.35;margin:6px 0;padding:6px 8px;border-left:3px solid #ffb454;background:rgba(255,180,84,0.10);border-radius:4px';
    body.appendChild(h);
  }

  // ---------- Funktionsbeschreibungen ein-/ausblenden -------------------
  // Zwei Darstellungen der .hint-Beschreibungstexte, in den Einstellungen wählbar:
  //   'shown'     – wie bisher: alle Beschreibungen direkt sichtbar.
  //   'collapsed' – Beschreibungen ausgeblendet; je ein „?" davor klappt sie auf.
  // Status-Anzeigen (.hint mit id, z. B. simInfo/gInfo) bleiben immer sichtbar.
  const HINTS_KEY = 'hw_hints_mode';
  // In der fertigen exe (window.BUILD_INFO steckt das Build-Tool hinein) sind die
  // Beschreibungen standardmäßig zugeklappt — die Oberfläche wirkt sonst beim
  // ersten Start erschlagend. In der Entwicklung bleibt alles sichtbar. Eine in
  // den Einstellungen getroffene Wahl hat in beiden Fällen Vorrang.
  let hintsMode = window.BUILD_INFO ? 'collapsed' : 'shown';
  try { const m = localStorage.getItem(HINTS_KEY); if (m === 'collapsed' || m === 'shown') hintsMode = m; } catch (e) {}
  // Notizfelder (📝 je Bedienfeld) lassen sich komplett abschalten. Dann wird das
  // Symbol per CSS (body.notes-hidden) verborgen; bestehende Notizen bleiben erhalten.
  const NOTES_KEY = 'hw_notes_enabled';
  let notesEnabled = true;
  try { const v = localStorage.getItem(NOTES_KEY); if (v === '0') notesEnabled = false; } catch (e) {}
  function applyNotesEnabled() {
    document.body.classList.toggle('notes-hidden', !notesEnabled);
  }
  function setNotesEnabled(on) {
    notesEnabled = !!on;
    try { localStorage.setItem(NOTES_KEY, notesEnabled ? '1' : '0'); } catch (e) {}
    applyNotesEnabled();
  }
  // Zugehöriges Bedien-Element einer Beschreibung finden: In der Seitenleiste
  // steht die Beschreibung VOR ihrer Zeile (nextSibling), im Dialog DAHINTER
  // (previousSibling). Der Rückfall bleibt an der Beschreibung selbst.
  function hintHost(h) {
    const isCtrl = el => !!el && el.nodeType === 1 && !el.classList.contains('hint')
      && (/\b(row|mrow)\b/.test(el.className) || (el.querySelector && el.querySelector('input,select,textarea')));
    return isCtrl(h.nextElementSibling) ? h.nextElementSibling
      : (isCtrl(h.previousElementSibling) ? h.previousElementSibling : null);
  }
  // „?" (Beschreibung ein/aus) UND 📝 (Notiz) IMMER als EIN Paar setzen — beide
  // im selben Container, feste Reihenfolge (? links, 📝 rechts), am selben Host.
  // So sitzt die Notiz stets direkt neben dem „?" und beide sind demselben Feld
  // zugeordnet. Das „?" ist per CSS nur im eingeklappten Modus sichtbar.
  function decorateFields(root) {
    (root || document).querySelectorAll('.hint:not([id])').forEach(h => {
      if (h.dataset.fd || !h.parentNode) return;
      if (h.closest && h.closest('#settingsModal')) return;   // Einstellungen: immer Text, kein „?"/📝
      h.dataset.fd = h.dataset.hd = h.dataset.nd = '1';
      const q = document.createElement('button');
      q.type = 'button'; q.className = 'hint-toggle'; q.textContent = '?';
      q.title = T('Beschreibung ein-/ausblenden');
      q.onclick = () => { h.classList.toggle('hint-open'); };
      const key = noteKey(h.textContent);
      const n = document.createElement('button');
      n.type = 'button'; n.className = 'note-toggle'; n.textContent = '📝';
      n.title = T('Notiz zu diesem Feld');
      if (noteHas(key)) n.classList.add('has-note');
      n.dataset.nkey = key;
      n.onclick = ev => { ev.stopPropagation(); openNotePop(n, key, h.textContent); };
      const tools = document.createElement('span'); tools.className = 'field-tools';
      tools.appendChild(q); tools.appendChild(n);
      const host = hintHost(h);
      if (host) {
        const lbl = host.querySelector && host.querySelector('label, .mlbl');
        const target = lbl || host;
        // Nur EIN Werkzeug-Paar je Feld: bereits vorhandenes 📝/? nicht duplizieren.
        if (target.querySelector && target.querySelector('.field-tools')) return;
        target.appendChild(tools);
      }
      else { h.parentNode.insertBefore(tools, h.nextSibling); }   // direkt nach der Beschreibung
    });
  }
  // Rückwärtskompatible Namen (falls anderswo referenziert).
  function decorateHints(root) { decorateFields(root); }
  function decorateNotes(root) { decorateFields(root); }
  function applyHintsMode() {
    document.body.classList.toggle('hints-collapsed', hintsMode === 'collapsed');
    decorateFields();   // Paar (?/📝) immer setzen; „?" wird per CSS nur eingeklappt gezeigt
    applyNotesEnabled();   // 📝-Sichtbarkeit gemäß Einstellung
  }
  function setHintsMode(m) {
    if (m !== 'shown' && m !== 'collapsed') return;
    hintsMode = m;
    try { localStorage.setItem(HINTS_KEY, m); } catch (e) {}
    applyHintsMode();
  }
  // ---------- Notizen je Bedienfeld (📝 neben dem „?") -----------------
  // Zu jeder Beschreibung lässt sich eine Freitext-Notiz hinterlegen. Der
  // Schlüssel ist ein stabiler Hash des Beschreibungstexts, sodass die Notiz
  // beim Neuaufbau der Seitenleiste erhalten bleibt. Jede Notiz gehört wahlweise
  // zum Projekt (mit dem Projekt gespeichert) oder zu den Programm-Einstellungen.
  function noteKey(txt) {
    const s = String(txt || '').replace(/\s+/g, ' ').trim();
    let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'n' + (h >>> 0).toString(36);
  }
  function noteBuckets() { const n = state.notes || (state.notes = { project: {}, settings: {} });
    n.project = n.project || {}; n.settings = n.settings || {}; return n; }
  function noteGet(key) { const n = noteBuckets();
    if (n.project[key] != null) return { text: n.project[key], scope: 'project' };
    if (n.settings[key] != null) return { text: n.settings[key], scope: 'settings' };
    return { text: '', scope: 'project' };
  }
  function noteSet(key, text, scope) {
    const n = noteBuckets();
    delete n.project[key]; delete n.settings[key];   // aus beiden entfernen, dann neu setzen
    text = (text || '').trim();
    if (text) n[scope === 'settings' ? 'settings' : 'project'][key] = text;
    if (scope === 'settings') { try { saveSettings(); } catch (e) {} }
  }
  function noteHas(key) { const n = noteBuckets(); return n.project[key] != null || n.settings[key] != null; }
  // Markierung (has-note) aller sichtbaren 📝 auffrischen (nach Laden/Speichern).
  function refreshNoteMarks() {
    document.querySelectorAll('.note-toggle[data-nkey]').forEach(b =>
      b.classList.toggle('has-note', noteHas(b.dataset.nkey)));
  }
  // Popup zum Bearbeiten einer Feld-Notiz.
  let notePop = null, notePopKey = null;
  function buildNotePop() {
    const p = document.createElement('div'); p.className = 'note-pop';
    p.innerHTML =
      '<textarea placeholder="' + T('Notiz eingeben …') + '"></textarea>' +
      '<div class="np-scope">' +
      '<label><input type="radio" name="npScope" value="project"> ' + T('Zum Projekt (mit Projekt speichern)') + '</label>' +
      '<label><input type="radio" name="npScope" value="settings"> ' + T('Zu Programm-Einstellungen') + '</label>' +
      '</div>' +
      '<div class="np-foot">' +
      '<button class="primary np-save">' + T('Speichern') + '</button>' +
      '<button class="np-del">' + T('Löschen') + '</button>' +
      '<div class="sp"></div><button class="np-cancel">' + T('Abbrechen') + '</button></div>';
    document.body.appendChild(p);
    p.querySelector('.np-cancel').onclick = closeNotePop;
    p.querySelector('.np-save').onclick = () => {
      const scope = p.querySelector('input[name=npScope]:checked').value;
      noteSet(notePopKey, p.querySelector('textarea').value, scope);
      refreshNoteMarks(); closeNotePop();
    };
    p.querySelector('.np-del').onclick = () => {
      noteSet(notePopKey, '', 'project'); refreshNoteMarks(); closeNotePop();
    };
    p.addEventListener('mousedown', e => e.stopPropagation());
    return p;
  }
  function openNotePop(btn, key, descr) {
    if (!notePop) notePop = buildNotePop();
    notePopKey = key;
    const cur = noteGet(key);
    notePop.querySelector('textarea').value = cur.text;
    notePop.querySelectorAll('input[name=npScope]').forEach(r => r.checked = (r.value === cur.scope));
    notePop.classList.add('open');
    // Position: unter dem Button, im Fenster gehalten.
    const r = btn.getBoundingClientRect();
    const w = 280, vw = window.innerWidth, vh = window.innerHeight;
    let left = Math.min(r.left, vw - w - 8); left = Math.max(8, left);
    notePop.style.left = left + 'px';
    notePop.style.top = Math.min(r.bottom + 5, vh - 220) + 'px';
    setTimeout(() => notePop.querySelector('textarea').focus(), 0);
  }
  function closeNotePop() { if (notePop) notePop.classList.remove('open'); notePopKey = null; }
  document.addEventListener('mousedown', () => { if (notePop && notePop.classList.contains('open')) closeNotePop(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNotePop(); });

  // Dynamisch nachgebaute Bereiche (Sidebar, Dialoge) automatisch mitversehen.
  // Wird von app.js beim Start aufgerufen (nicht beim Laden dieses Moduls), damit
  // der erste Callback wie früher erst NACH dem Start-Aufbau (wireUp) läuft.
  function setupFieldObserver() {
    try {
      new MutationObserver(muts => {
        let added = false;
        for (const m of muts) { if (m.addedNodes && m.addedNodes.length) { added = true; break; } }
        if (!added) return;
        decorateFields();
      }).observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }
  App.setupFieldObserver = setupFieldObserver;
  function subhead(body, t, color) { const h = document.createElement('b'); h.textContent = T(t); h.style.fontSize = '13px'; h.style.fontWeight = '700'; h.style.color = color || 'var(--txt)'; h.style.marginTop = '6px'; body.appendChild(h); }
  /* Wurzel-/Außen-Eingabepaar mit „proportional zur Sehne"-Option. keys =
   * {root,tip,prop}, labels = {root,tip,prop}. Bei prop wird der Außenwert aus
   * dem Wurzelwert · ratio berechnet und schreibgeschützt angezeigt. */
  // part: undefined = Wurzel + proportional + außen in einem Block;
  //       'root' = nur die Wurzelzeile, 'tip' = nur proportional + außen.
  //       Bei getrennten Aufrufen verbindet `link` (gemeinsames Objekt) beide,
  //       damit der Wurzelwert das proportionale Außenfeld live nachführt.
  function extTriple(body, seg, ratio, ro, keys, labels, opt, rootRO, after, part, link) {
    opt = opt || { step: 1, min: 0 };
    link = link || {};
    const fin = () => { if (after) after(); };
    if (part === 'tip') { extTipRows(); return; }
    if (rootRO) {
      // Ab Segment 2: Wurzelwert kommt vom Vorsegment (gemeinsamer Stoß) und
      // ist nicht editierbar — analog zum geteilten Profil im Tragflächendesigner.
      numRow(body, labels.root, () => (+seg[keys.root] || 0).toFixed(1), () => {},
        { readonly: true, roTitle: 'Wurzelwert = Außenwert des Vorsegments am Stoß.' });
    } else {
      numRow(body, labels.root, () => seg[keys.root], v => {
        seg[keys.root] = v; if (seg[keys.prop] && link.tipInp) link.tipInp.value = (v * ratio).toFixed(1); fin();
      }, opt);
    }
    if (part === 'root') return;
    extTipRows();
    function extTipRows() {
      boolRow(body, labels.prop, () => seg[keys.prop], v => { seg[keys.prop] = v; buildSidebar(); });
      if (seg[keys.prop])
        link.tipInp = numRow(body, labels.tip, () => (seg[keys.root] * ratio).toFixed(1), () => {}, { readonly: true, roTitle: ro });
      else
        numRow(body, labels.tip, () => seg[keys.tip], v => { seg[keys.tip] = v; fin(); }, opt);
    }
  }

  // Plausibilitätsprüfung der Nasen-X-Schlaufe eines Segments. Liefert eine Liste
  // von Meldungen (leer = alles in Ordnung). Rechnet die WIRKSAMEN Längen wie
  // projectCut (proportional, „Schnittverlängerung immer über Block"):
  //   • parallele Strecke B kleiner als ~1,5·Abbrand -> die beiden waagrechten
  //     Linien fallen nach dem Abbrand-Versatz zusammen, die Schlaufe wird zum V.
  //   • Schlaufenhöhe (2·A·sin) ein Vielfaches der Rippendicke -> riesige
  //     Schlaufe statt kompaktem X (typisch: fester Blocküberstand zieht die
  //     Schräge über „immer über Block" hoch).
  function noseLoopReport(seg, idx) {
    const out = [];
    if (state.cfg.leStyle !== 'x') return out;
    const rootChord = idx === 0 ? state.root.chord : state.segments[idx - 1].chord;
    const rootProf = idx === 0 ? state.root.profile : state.segments[idx - 1].profile;
    const ratio = rootChord ? seg.chord / rootChord : 1;
    const tipv = (r, t, p) => p ? (+r || 0) * ratio : (+t || 0);
    const A = [+seg.leExt || 0, tipv(seg.leExt, seg.leExtTip, seg.leExtProp)];
    const B = [+seg.leExt2 || 0, tipv(seg.leExt2, seg.leExt2Tip, seg.leExt2Prop)];
    const A0 = A.slice();
    if (state.cfg.extOverBlockLE && App.blockExt) {
      const be = App.blockExt(seg, rootChord, seg.chord);
      const CLR = state.cfg.extOverBlockClearLE != null ? state.cfg.extOverBlockClearLE : 5;
      const cosf = Math.max(Math.cos((state.cfg.leAngle || 45) * Math.PI / 180), 0.2);
      const need = (b, B2) => Math.max(0, (b + CLR) - B2) / cosf;
      if (A[0] > 0) A[0] = Math.max(A[0], need(be.leR, B[0]));
      if (A[1] > 0) A[1] = Math.max(A[1], need(be.leT, B[1]));
    }
    if (!(A[0] > 0)) return out;   // keine Schlaufe
    // Abbrand: aus der Werkstoff-Kalibrierung, sonst der Projektwert.
    const kerf = (App.currentKerf ? App.currentKerf() : 0) || state.cfg.kerf || 0;
    const sa = Math.sin((state.cfg.leAngle || 45) * Math.PI / 180);
    // Profil im Zustand = Punkt-Array (mit .name); in Projektdateien {name, pts}.
    const thick = (prof, c) => {
      const pts = Array.isArray(prof) ? prof : (prof && prof.pts);
      if (!pts || pts.length < 4) return 0;
      const P = pts.map(q => Array.isArray(q) ? { x: q[0], y: q[1] } : q);
      return Airfoil.maxThickness(Airfoil.resample(P, 160)) * c;
    };
    const th = [thick(rootProf, rootChord), thick(seg.profile, seg.chord)];
    const f1 = v => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
    const st = [T('Wurzel'), T('Segment') + ' ' + (idx + 1) + T(' (außen)')];
    const minB = Math.max(kerf * 1.5, 2);
    for (let i = 0; i < 2; i++) {
      if (B[i] > 0 && B[i] < minB)
        out.push({ kind: 'B', txt: st[i] + ': ' + T('horizontale Strecke') + ' ' + f1(B[i]) + ' mm < ' + f1(minB) + ' mm (' + T('Abbrand') + ' ' + f1(kerf) + ' mm)' });
      const h = 2 * A[i] * sa;
      if (th[i] > 0 && h > 2.5 * th[i])
        out.push({ kind: 'H', txt: st[i] + ': ' + T('Schlaufenhöhe') + ' ' + f1(h) + ' mm > 2,5 × ' + T('Rippendicke') + ' ' + f1(th[i]) + ' mm'
          + (A[i] > A0[i] + 0.05 ? ' (' + T('Schräge durch „immer über Block" von') + ' ' + f1(A0[i]) + ' → ' + f1(A[i]) + ' mm)' : '') });
    }
    return out;
  }
  // Kleine ▲▼-Schaltpfeile (Spinner) für ein Text-Zahlenfeld. Die nativen Spinner
  // entfielen mit der Umstellung von type=number auf type=text (Komma als
  // Dezimaltrenner). Gibt einen flex-Wrapper mit Feld + Pfeilen zurück. Ein Klick
  // ändert um `step` (Halten wiederholt); danach werden die vorhandenen
  // input/change-Handler des Feldes ausgelöst, damit die Übernahme wie bei
  // Tastatureingabe erfolgt.
  function wrapWithSpinner(input, opt) {
    opt = opt || {};
    const step = opt.step || 1;
    const dp = (String(step).split('.')[1] || '').length;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:stretch;gap:3px;min-width:0';
    input.style.flex = '1'; input.style.minWidth = '0';
    const bump = dir => {
      const cur = parseNum(input.value);
      let v = (isNaN(cur) ? 0 : cur) + dir * step;
      v = opt.int ? Math.round(v) : Math.round(v * Math.pow(10, dp)) / Math.pow(10, dp);
      if (opt.min != null) v = Math.max(opt.min, v);
      if (opt.max != null) v = Math.min(opt.max, v);
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const spin = document.createElement('div');
    spin.style.cssText = 'display:flex;flex-direction:column;gap:2px;flex:0 0 auto';
    const mk = (txt, dir) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.tabIndex = -1;
      b.style.cssText = 'padding:0;width:19px;height:12px;line-height:1;font-size:9px;border-radius:3px;color:var(--muted)';
      let ht = 0, hv = 0;
      const stop = () => {
        clearTimeout(ht); clearInterval(hv); ht = 0; hv = 0;
        window.removeEventListener('mouseup', stop, true);
      };
      b.onmousedown = e => {
        e.preventDefault();
        // Auf window/capture hören: Der Setter kann die Sidebar (und damit
        // diesen Button) neu aufbauen, bevor b.onmouseup feuern würde – dann
        // liefe der Auto-Repeat endlos weiter (z. B. "Stapeln"-Anzahl).
        window.addEventListener('mouseup', stop, true);
        bump(dir);
        ht = setTimeout(() => { hv = setInterval(() => bump(dir), 70); }, 350);
      };
      b.onmouseleave = stop;
      return b;
    };
    spin.appendChild(mk('▲', 1)); spin.appendChild(mk('▼', -1));
    wrap.appendChild(input); wrap.appendChild(spin);
    return wrap;
  }
  window.wrapWithSpinner = wrapWithSpinner;   // auch für grbl.js (GRBL-/Homing-Felder)
  function numRow(body, label, get, set, opt) {
    opt = opt || {};
    if (opt.hint) hint(body, opt.hint);
    const row = document.createElement('div'); row.className = 'row';
    const l = document.createElement('label'); l.textContent = T(label);
    // type=text + inputmode=decimal, damit sowohl '.' als auch ',' als
    // Dezimaltrenner eingegeben werden können (type=number blockiert je nach
    // Browser-Locale eines der beiden Zeichen).
    const i = document.createElement('input'); i.type = 'text'; i.inputMode = 'decimal';
    if (opt.step) i.step = opt.step; if (opt.min != null) i.min = opt.min; if (opt.max != null) i.max = opt.max;
    i.value = get();
    if (opt.readonly) {
      i.readOnly = true; i.tabIndex = -1;
      i.style.opacity = '.6'; i.title = T(opt.roTitle || 'automatisch berechnet');
      row.appendChild(l); row.appendChild(i); body.appendChild(row);
      return i;
    }
    const commit = () => { let v = parseNum(i.value); if (isNaN(v)) return; if (opt.int) v = Math.round(v); set(v); if (!opt.norender) render(); };
    if (opt.enter) {
      // Wert erst mit Enter (oder beim Verlassen des Felds) übernehmen – für
      // Setter, die die Sidebar neu aufbauen und sonst das Tippen unterbrechen.
      // Die Spinner-Pfeile lösen 'change' aus und gelten damit sofort.
      let last = String(i.value);
      const go = () => { if (String(i.value) === last) return; last = String(i.value); commit(); };
      i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
      i.onchange = go; i.onblur = go;
    } else i.oninput = commit;
    row.appendChild(l);
    row.appendChild(wrapWithSpinner(i, { step: opt.step, min: opt.min, max: opt.max, int: opt.int }));
    body.appendChild(row);
    return i;
  }
  // Vorschub-Zeile für G-Code-Quellen: bei „Vorschub automatisch" (Reiter
  // „Werkstoff") schreibgeschützt und mit dem Werkstoff-Wert belegt.
  function feedRow(body, label, get, set, opt) {
    opt = Object.assign({}, opt || {});
    if (App.autoFeedOn() && App.autoFeedVal() > 0) {
      opt.readonly = true; opt.roTitle = 'automatisch = „Vorschub schnell" des Werkstoffs (Reiter „Projektübersicht")';
    }
    return numRow(body, label, get, set, opt);
  }
  function txtRow(body, label, get, set) {
    const row = document.createElement('div'); row.className = 'row';
    const l = document.createElement('label'); l.textContent = T(label);
    const i = document.createElement('input'); i.type = 'text'; i.value = get();
    i.oninput = () => set(i.value);
    row.appendChild(l); row.appendChild(i); body.appendChild(row);
    return i;
  }
  function boolRow(body, label, get, set, h) {
    if (h) hint(body, h);
    const row = document.createElement('div'); row.className = 'row';
    const l = document.createElement('label'); l.textContent = T(label);
    const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!get();
    i.onchange = () => { set(i.checked); render(); };
    row.appendChild(l); row.appendChild(i); body.appendChild(row);
    return i;
  }
  function selectRow(body, label, options, get, set, h) {
    if (h) hint(body, h);
    const row = document.createElement('div'); row.className = 'row';
    const l = document.createElement('label'); l.textContent = T(label);
    const s = document.createElement('select');
    options.forEach(o => { const e = document.createElement('option'); e.value = o[0]; e.textContent = T(o[1]); s.appendChild(e); });
    s.value = get();
    s.onchange = () => { set(s.value); render(); };
    row.appendChild(l); row.appendChild(s); body.appendChild(row);
    return s;
  }
  function areaRow(body, label, get, set) {
    const row = document.createElement('div'); row.className = 'row full';
    const l = document.createElement('label'); l.textContent = T(label);
    const i = document.createElement('textarea'); i.rows = 2; i.value = get();
    i.oninput = () => set(i.value);
    row.appendChild(l); row.appendChild(i); body.appendChild(row);
    return i;
  }
  function profilePicker(body, getProf, importKey) {
    const p = getProf(); const th = (Airfoil.maxThickness(p) * 100).toFixed(1);
    const info = document.createElement('div'); info.style.color = 'var(--txt)';
    info.innerHTML = T('Profil') + ': <b>' + p.name + '</b> (' + th + '%)';
    body.appendChild(info);
    const profId = importKey.type === 'root' ? 'root' : importKey.idx;
    // Ein Lade-Button für alle Profilformate, darunter Profil bearbeiten.
    const rl = document.createElement('div'); rl.className = 'row full';
    const bd = document.createElement('button'); bd.textContent = T('Profil laden…');
    bd.onclick = () => { state.importTarget = importKey; App.loadProfileAny(); };
    rl.appendChild(bd); body.appendChild(rl);
    hint(body, 'Profil laden: .dat (Selig/Lednicer), .bez (Bézier-Kontrollpunkte, wird abgetastet) oder DXF/SVG '
      + '(größte Kontur der Datei). Reihenfolge/Skalierung werden automatisch normalisiert.');
    const r2 = document.createElement('div'); r2.className = 'row full';
    const be = document.createElement('button'); be.textContent = T('Profil bearbeiten…');
    be.onclick = () => App.openProfModal(profId);
    r2.appendChild(be); body.appendChild(r2);
  }

  // ---------- Sidebar --------------------------------------------------
  function segBox() {
    const box = document.createElement('div');
    box.style.border = '1px solid var(--line)'; box.style.borderRadius = '7px';
    box.style.padding = '8px'; box.style.marginBottom = '8px'; box.style.background = 'var(--panel2)';
    return box;
  }

  /* Aufklappbare Segment-Karte: Kopfzeile (Titel + Verschieben/Löschen) ist
   * anklickbar; sie aktiviert das Segment und klappt dessen Menü auf, während
   * alle anderen Segmentmenüs zugeklappt bleiben. Gibt {box, body} zurück —
   * die eigentlichen Eingabefelder werden in `body` gefüllt. */
  function segCard(idx) {
    const box = segBox();
    box.style.padding = '0'; box.style.overflow = 'hidden';
    const open = state.activeSeg !== 'all' && App.activeIdx() === idx;

    const head = document.createElement('div');
    head.style.display = 'flex'; head.style.alignItems = 'center'; head.style.cursor = 'pointer';
    head.style.padding = '7px 8px';
    if (open) head.style.background = 'rgba(74,163,255,.14)';
    const caret = document.createElement('span');
    caret.textContent = open ? '▾' : '▸';
    caret.style.color = 'var(--muted)'; caret.style.marginRight = '6px'; caret.style.fontSize = '10px';
    const t = document.createElement('b'); t.textContent = 'Segment ' + (idx + 1); t.style.fontSize = '12px';
    if (open) t.style.color = 'var(--accent)';
    const note = document.createElement('span'); note.className = 'hint'; note.style.marginLeft = '8px';
    note.textContent = idx === 0 ? T('(innen = Wurzel)') : T('(innen = außen von Seg ') + idx + ')';
    const sp = document.createElement('div'); sp.style.flex = '1';
    head.appendChild(caret); head.appendChild(t); head.appendChild(note); head.appendChild(sp);
    head.appendChild(mkMini('▲', () => App.moveSeg(idx, -1)));
    head.appendChild(mkMini('▼', () => App.moveSeg(idx, +1)));
    const rm = mkMini('✕', () => App.removeSeg(idx)); rm.style.color = 'var(--bad)';
    head.appendChild(rm);
    head.onclick = () => {
      // Klick auf die Kopfzeile: dieses Segment aktivieren (aufklappen) bzw.
      // ein bereits aktives wieder zuklappen.
      state.activeSeg = open ? 'all' : idx;
      buildSidebar(); render();
    };
    box.appendChild(head);

    const body = document.createElement('div');
    body.style.padding = '8px'; body.style.display = open ? 'grid' : 'none'; body.style.gap = '8px';
    box.appendChild(body);
    return { box, body };
  }

  /* Formkarte (Reiter „Tragflächendesigner"): alle tragflächenrelevanten
   * Parameter — Profile, Sehnen, Spannweite, Pfeilung, Schränkung, V-Form
   * und die Scharnierlinie. */
  function segmentShapeCard(seg, idx) {
    const card = segCard(idx); const box = card.body;

    // Nur das ERSTE Segment hat ein eigenes Wurzel-(Innen-)Profil. Bei allen
    // weiteren Segmenten ist das Innenprofil per Konstruktion das Außenprofil des
    // Vorsegments (gemeinsamer Stoß) — es wird dort bearbeitet und hier NICHT
    // noch einmal angeboten.
    if (idx === 0) {
      subhead(box, 'Wurzelprofil');
      profilePicker(box, () => state.root.profile, { type: 'root' });
      numRow(box, 'Wurzelsehne / Profillänge Wurzel (mm)', () => state.root.chord, v => state.root.chord = v);
    }
    subhead(box, idx === 0 ? 'Außenprofil' : 'Profil (Stoß = Außenprofil Vorsegment)');
    profilePicker(box, () => seg.profile, { type: 'seg', idx });
    // Innenprofil (Wurzel bzw. Stoß = Außenprofil des Vorsegments) ins Außenprofil
    // übernehmen -> konstantes Profil über das Segment (nur die Sehne kann sich ändern).
    {
      const innerProf = () => idx === 0 ? state.root.profile : state.segments[idx - 1].profile;
      const rr = document.createElement('div'); rr.className = 'row full';
      const bc = document.createElement('button');
      bc.textContent = idx === 0 ? T('↧ Wurzelprofil übernehmen') : T('↧ Innenprofil übernehmen');
      bc.title = T('Kopiert das Innenprofil (Wurzel bzw. Stoß zum Vorsegment) als Außenprofil dieses Segments — gleiche Form innen wie außen.');
      bc.onclick = () => {
        const src = innerProf();
        const copy = src.map(pt => ({ x: pt.x, y: pt.y }));
        copy.name = src.name;
        seg.profile = copy;
        App.recompute(); buildSidebar(); render();
      };
      rr.appendChild(bc); box.appendChild(rr);
    }
    numRow(box, 'Außensehne / Profillänge außen (mm)', () => seg.chord, v => seg.chord = v);
    numRow(box, 'Spannweite (mm)', () => seg.span, v => seg.span = v);
    if (state.cfg.hingeAlign) {
      // Pfeilung wird aus der Scharnierlinie je Gruppe berechnet — die Gruppen und
      // ihre Pfeilung werden im Menü „Globale Pfeilung" festgelegt.
      numRow(box, 'Rückpfeilung LE-Versatz (mm)', () => (App.effSweep(idx)).toFixed(1), () => {},
        { readonly: true, roTitle: 'Berechnet aus der globalen Pfeilung. Gruppen & Pfeilung im Menü „Globale Pfeilung“ festlegen.' });
    } else {
      selectRow(box, 'Pfeilung als', [['mm', 'LE-Versatz (mm)'], ['deg', 'Winkel ° zur Spannweite']],
        () => seg.sweepMode || 'mm', v => { seg.sweepMode = v; buildSidebar(); render(); });
      if ((seg.sweepMode || 'mm') === 'deg') {
        numRow(box, 'Rückpfeilung (°)',
          () => (Math.atan2(seg.sweep || 0, seg.span || 1) * 180 / Math.PI).toFixed(2),
          v => { seg.sweep = +((seg.span || 0) * Math.tan(v * Math.PI / 180)).toFixed(3); },
          { step: 0.5, hint: 'Pfeilwinkel der Nasenleiste gegenüber der Spannweitenrichtung. '
            + 'Positiv = Rückpfeilung. Wird intern in den LE-Versatz umgerechnet '
            + '(Versatz = Spannweite · tan(Winkel)).' });
      } else {
        numRow(box, 'Rückpfeilung LE-Versatz (mm)', () => seg.sweep, v => seg.sweep = v);
      }
    }
    numRow(box, 'Schränkung außen (°)', () => seg.washout, v => seg.washout = v, { step: 0.1 });
    numRow(box, 'Drehpunkt Schränkung (außen)',
      () => seg.twistRef != null ? seg.twistRef : state.cfg.twistRef,
      v => seg.twistRef = v,
      { step: 0.05, min: 0, max: 1, hint: 'Punkt auf der Sehne DES AUSSENPROFILS, UM DEN die Schränkung (Washout) '
        + 'verdreht wird — als Anteil der Sehne ab Nasenleiste: 0 = Nasenleiste (LE), 0.25 = Viertelpunkt (t/4), 1 = Endleiste (TE). '
        + 'Wird je Profil getrennt eingestellt.' });
    if (state.cfg.align && state.cfg.align.enable) {
      // Globale Höhenausrichtung aktiv -> Segment-V-Form wird nicht verwendet.
      // Die Starthöhe der Wurzelrippe (Segment 1) bleibt erhalten: Sie steuert die
      // Lage der GESAMTEN Tragfläche; alle anderen Profile richten sich an ihr aus.
      if (idx === 0)
        numRow(box, 'Höhe Wurzelrippe / Starthöhe (mm)', () => seg.dihRoot, v => seg.dihRoot = v,
          { step: 1, hint: 'Lage der gesamten Tragfläche im Block. 0 = Wurzel-Sehnenmitte auf '
            + 'Blockmitte; positiv hebt die GANZE Tragfläche parallel an, negativ senkt sie. '
            + 'Die Wurzelrippe bleibt an dieser Höhe — alle anderen Profile werden an ihr ausgerichtet.' });
      hint(box, 'V-Form dieses Segments ist deaktiviert: Die Profilhöhenausrichtung '
        + '(Menü „Profilhöhenausrichtung") richtet alle Profile an der Wurzelrippe aus und legt die '
        + 'V-Form der gesamten Tragfläche fest.');
    } else {
      selectRow(box, 'V-Form als', [['mm', 'Höhe in mm'], ['deg', 'Winkel ° zum Vorsegment']],
        () => seg.dihMode, v => { seg.dihMode = v; buildSidebar(); render(); });
      numRow(box, idx === 0 ? 'Höhe Profilsehne Wurzel / Starthöhe (mm)' : 'Höhe Profilsehne Wurzel (mm)',
        () => seg.dihRoot, v => seg.dihRoot = v,
        { step: 1, hint: idx === 0
          ? 'Starthöhe: Lage der gesamten Tragfläche im Block. 0 = Wurzel-Sehnenmitte auf '
            + 'Blockmitte; positiv hebt die GANZE Tragfläche parallel an, negativ senkt sie '
            + '(Form bleibt, nur die Lage im Block ändert sich).'
          : 'Verschiebt NUR die Wurzelrippe dieses Segments im Block gegenüber dem '
            + 'stetigen Anschluss (0 = bündig an das Außenende des Vorsegments). '
            + 'Außenende und Folgesegmente bleiben unberührt.' });
      numRow(box, seg.dihMode === 'deg' ? 'V-Winkel (°)' : 'Höhe Profilsehne außen (mm)',
        () => seg.dih, v => seg.dih = v, { step: seg.dihMode === 'deg' ? 0.5 : 1,
        hint: seg.dihMode === 'deg' ? 'Winkel relativ zum vorherigen Segment.' : 'Höhe des Außenendes über der Basis (stetiger Anschluss an das Vorsegment).' });
    }

    // Beplankung je Segment (nur wenn Modus „segmentweise" gewählt ist).
    segmentSheetRows(box, seg);

    subhead(box, 'Scharnierlinie');
    selectRow(box, 'Seite', [['top', 'Oben'], ['bottom', 'Unten']],
      () => seg.hingeSide, v => { seg.hingeSide = v; render(); });
    numRow(box, 'Lage innen (% von hinten)', () => seg.hingePct, v => seg.hingePct = v,
      { step: 1, min: 0, max: 100, hint: 'Prozent der Sehne des Innenprofils, von der Endleiste (hinten) gemessen.' });
    numRow(box, 'Lage außen (% von hinten)', () => seg.hingePctTip, v => seg.hingePctTip = v,
      { step: 1, min: 0, max: 100, hint: 'Prozent der Sehne des Außenprofils, von der Endleiste (hinten) gemessen.' });

    subhead(box, 'Segment teilen');
    const su = seg.splitUI || (seg.splitUI = { on: false, mode: 'pct', val: 50 });
    boolRow(box, 'Teilen', () => su.on, v => { su.on = v; buildSidebar(); },
      'Teilt dieses Segment an einer Stelle in Spannweitenrichtung in zwei Segmente.');
    if (su.on) {
      selectRow(box, 'Teilung über', [['pct', 'Prozent der Spannweite'], ['mm', 'Länge (mm)']],
        () => su.mode, v => { su.mode = v; buildSidebar(); });
      if (su.mode === 'pct')
        numRow(box, 'Position (% von innen)', () => su.val, v => su.val = v,
          { step: 1, min: 0, max: 100, norender: true,
            hint: 'Teilungsstelle in % der Segment-Spannweite, vom Innenende (Wurzel) gemessen.' });
      else
        numRow(box, 'Position (mm von innen)', () => su.val, v => su.val = v,
          { step: 1, min: 0, norender: true,
            hint: T('Teilungsstelle in mm ab dem Innenende dieses Segments (0…') + (seg.span || 0) + ' mm).' });
      const brow = document.createElement('div'); brow.className = 'row';
      const btn = document.createElement('button'); btn.textContent = T('Segment teilen'); btn.className = 'primary';
      btn.onclick = () => App.splitSeg(idx, su.mode, su.val);
      brow.appendChild(btn); box.appendChild(brow);
      hint(box, 'Am Teilungsschnitt wird ein Zwischenprofil (interpoliert aus Innen- und Außenprofil) '
        + 'eingefügt; Sehne, Schränkung, Rückpfeilung und V-Form werden anteilig aufgeteilt.');
    }

    return card.box;
  }

  // Neuer (globaler) Holm. segFrom/segTo = Segmentbereich (0-basiert).
  // flightPar = Lage über den Bereich auf KONSTANTEM X halten (parallel zur
  // Flugrichtung, ignoriert Rückpfeilung). horiz = Höhe auf KONSTANTEM Y halten
  // (waagrecht, ignoriert V-Form) — für gerade Tragflächensteckung.
  function newSpar(extra) {
    return Object.assign({ shape: 'circle', sizeMode: 'pct', w: 60, h: 60, taper: 0.6, yOff: 0,
      // Trapez/V: getrennt einstellbare Schnittwinkel der vorderen (NL-Seite) und
      // hinteren (EL-Seite) Wand, gemessen ab der Senkrechten (0° = senkrechte
      // Wand, positiv = Wand neigt sich nach innen/oben, Tasche wird oben schmaler).
      // Aus (cutAngles=false) -> bisherige symmetrische Form (Trapez per taper,
      // V symmetrisches Dreieck).
      cutAngles: false, angFront: 15, angRear: 15,
      // V-förmig: Drehwinkel des gesamten V um seinen Mittelpunkt (Grad, 0–360;
      // 0° = Spitze unten).
      rot: 0,
      // Trapez: Bezug der Basis (breite Seite). 'center' = mittig auf der Skelett-
      // linie (bisheriges Verhalten). 'top'/'bottom' = die Basis klebt an der
      // Profiloberseite bzw. -unterseite (folgt deren Kontur); die gegenüber-
      // liegende (flache) Seite verschiebt sich mit der Höhe vertikal.
      baseRef: 'center',
      // Scharnierausschnitt (shape 'hinge'): Dreieck, Wände über angFront/angRear.
      // Angefahren wird IMMER von der dem Scharnier gegenüberliegenden Profilseite.
      // Die Basis liegt an dieser gegenüberliegenden Seite; hingeOver verlängert sie
      // (mm) darüber hinaus. hingeReach = Lage der Spitze relativ zur Scharnierlinie
      // (mm; + = über die Scharnierseite hinaus, − = davor) -> wie weit die
      // Schnittspur in Richtung Scharnier geht.
      hingeOver: 0, hingeReach: 0,
      // Form des Scharnierausschnitts: 'v' = Dreieck (Spitze auf der Scharnierlinie),
      // 'trapez' = Trapez mit kurzer Seite (hingeTipW mm breit) an der Scharnierlinie.
      hingeForm: 'v', hingeTipW: 2,
      // Entlang der Scharnierlinie ausrichten: der Holm läuft im Grundriss parallel
      // zur Scharnierlinie (statt als NL-bezogene Gerade). hingeOffset = Abstand VOR
      // der Scharnierlinie (mm, Richtung Nasenleiste).
      hingeAlign: false, hingeOffset: 0,
      // Außenmaß (Randrippe) getrennt wählbar: sizeTip AN -> eigene wTip/hTip,
      // sonst gleich wie innen (Wurzel).
      sizeTip: false, wTip: 60, hTip: 60,
      // Höhenversatz zur Mitte außen getrennt: yOffSep AN -> eigener yOffTip.
      yOffSep: false, yOffTip: 0,
      // Doppel-T (I-Träger): Ober-/Untergurt (waagrechte Rechtecke, folgen oben/
      // unten dem Profilverlauf) und mittiger Steg (stehendes Rechteck). Maße je
      // Rechteck über sizeMode (% der Profilhöhe oder mm) skaliert.
      dtOtW: 60, dtOtH: 12, dtStW: 14, dtStH: 40, dtUbW: 60, dtUbH: 12,
      // dtFill: Steg-Höhe ergänzt Ober-/Untergurt auf die volle Profilhöhe (100 %),
      // auch im mm-Modus (Steg füllt bis zur lokalen Profildicke).
      dtFill: true,
      // dtContourInner: innere Gurtkanten als Offset der Profilkontur statt gerade.
      dtContourInner: false,
      // dtHmm: Gurthöhen (Ober-/Untergurt) FEST in mm, auch wenn die übrigen Maße in
      // % der Profilhöhe stehen (ein realer Gurt ist überall gleich dick; nur die
      // Profilhöhe ändert sich). Verhindert, dass der Gurt außen dünner als der Abbrand wird.
      dtHmm: false,
      // dtThinDir: Wohin ein Gurt ausweicht, der dünner als der Abbrand (+Reserve) ist:
      // 'in' = Innenkante wandert zum Steg (Steg wird niedriger, Schale bleibt heil),
      // 'out' = Außenkante wandert über die Profilkontur hinaus (in die Schale).
      dtThinDir: 'in',
      // Tasche (shape 'pocket'): Gurt-Aufnahme ohne Steg. Es werden flache Taschen
      // als Parallel-Offset der Profilkontur nach INNEN geschnitten (Tiefe = pkDepth
      // senkrecht zur Kontur). KEINE eigene Anfahrt: der Profilschnitt läuft in die
      // Tasche hinein, den Boden entlang und vorne wieder heraus (das Profilstück
      // über der Tasche wird getrimmt). pkSide = Ober-/Unterseite oder beide.
      // Breite = sp.w/wTip (wie andere Formen), Wandwinkel = angFront/angRear.
      // pkFlat: gerade waagrechte Innenkante (flacher Gurtboden) statt konturfolgend.
      pkDepth: 8, pkDepthTop: 8, pkDepthBot: 8, pkSide: 'both', pkFlat: false, pkWebTop: 0, pkWebBot: 0, pkWebW: 2,
      // Abbrand je Holm überschreibbar: 'global' = globale Kerndesign-Einstellung,
      // sonst eigener Modus ('none'/'in'/'out') bzw. Bezug ('profile'/'local').
      kerfMode: 'global', kerfBasis: 'global',
      approach: 'top', segFrom: 0, segTo: 0, posMode: 'pct', pos: 33, posModeTip: 'pct', posTip: 33,
      flightPar: false, horiz: false }, extra || {});
  }
  // Lage-Eingabefelder für Wurzel (which='root') bzw. Außen (which='tip').
  function sparPosFields(sb, which, sp, label) {
    const modeOpts = [['pct', '% der Sehne'], ['mm', 'mm']];
    if (which === 'root') {
      selectRow(sb, label + T(' ab NL'), modeOpts, () => sp.posMode, v => { sp.posMode = v; buildSidebar(); render(); });
      numRow(sb, sp.posMode === 'mm' ? label + ' (mm)' : label + ' (%)',
        () => sp.pos, v => { sp.pos = v; render(); }, { min: 0, norender: true });
    } else {
      selectRow(sb, label + T(' ab NL'), modeOpts, () => sp.posModeTip || sp.posMode, v => { sp.posModeTip = v; buildSidebar(); render(); });
      numRow(sb, (sp.posModeTip || sp.posMode) === 'mm' ? label + ' (mm)' : label + ' (%)',
        () => (sp.posTip != null ? sp.posTip : sp.pos), v => { sp.posTip = v; render(); }, { min: 0, norender: true });
    }
  }
  /* Globaler Holm-Editor (Reiter Tragflächendesigner). Holme sind von den
   * Segmenten gelöst; jeder Holm gilt für einen Segmentbereich und wird als
   * gerade Linie zwischen Wurzel von segFrom und Außen von segTo definiert. */
  function sparEditor(box) {
    if (!state.spars) state.spars = [];
    const segOpts = state.segments.map((s, i) => [String(i), 'Segment ' + (i + 1)]);
    hint(box, 'Taschen im Profil (Holmkästen), unabhängig von den Segmenten. Jeder Holm gilt für '
      + 'einen Segmentbereich und wird als GERADE Linie zwischen der Wurzel des Von-Segments und dem '
      + 'Außenprofil des Bis-Segments geführt; dazwischenliegende Segmente werden gerade durchzogen.');
    hint(box, 'Holm im Grundriss anklicken zum Aktivieren – oder auf die Kopfzeile tippen. Nur der aktive Holm ist aufgeklappt.');
    if (state.activeSpar != null && state.activeSpar >= state.spars.length) state.activeSpar = null;
    state.spars.forEach((sp, k) => {
      const open = state.activeSpar === k;
      const card = document.createElement('div');
      card.style.cssText = 'border:1px solid var(--line);border-radius:7px;padding:0;margin:2px 0;background:var(--panel2);overflow:hidden';
      const hd = document.createElement('div');
      hd.style.cssText = 'display:flex;align-items:center;cursor:pointer;padding:7px 8px';
      if (open) hd.style.background = 'rgba(74,163,255,.14)';
      const caret = document.createElement('span');
      caret.textContent = open ? '▾' : '▸';
      caret.style.cssText = 'color:var(--muted);margin-right:6px;font-size:10px';
      const lab = document.createElement('b'); lab.style.fontSize = '12px'; lab.textContent = 'Holm ' + (k + 1);
      if (open) lab.style.color = 'var(--accent)';
      const spc = document.createElement('div'); spc.style.flex = '1';
      const del = mkMini('✕', () => {
        state.spars.splice(k, 1);
        if (state.activeSpar === k) state.activeSpar = null;
        else if (state.activeSpar != null && state.activeSpar > k) state.activeSpar--;
        buildSidebar(); render();
      }); del.style.color = 'var(--bad)';
      hd.appendChild(caret); hd.appendChild(lab); hd.appendChild(spc); hd.appendChild(del);
      hd.onclick = () => { state.activeSpar = open ? null : k; buildSidebar(); render(); };
      card.appendChild(hd);
      box.appendChild(card);
      if (!open) return;
      // Eingabefelder des aktiven Holms in `sb` (Body der Karte) füllen.
      const sb = document.createElement('div');
      sb.style.cssText = 'padding:8px;display:grid;gap:8px';
      card.appendChild(sb);
      if (sp.shape === 'v') sp.shape = 'trapez';   // V-förmig entfernt (mit Trapez abgedeckt)
      selectRow(sb, 'Form', [['circle', 'Kreis'], ['oval', 'Oval'], ['trapez', 'Trapez'], ['doubleT', 'Doppel-T (I-Träger)'], ['pocket', 'Tasche (Gurt ohne Steg)'], ['pocketWeb', 'Tasche + Steg (Doppel-T)'], ['hinge', 'Scharnierschnitt']],
        () => sp.shape, v => { sp.shape = v; buildSidebar(); render(); });
      const isHinge = sp.shape === 'hinge';
      const isPocket = sp.shape === 'pocket' || sp.shape === 'pocketWeb';
      const isPocketWeb = sp.shape === 'pocketWeb';
      if (!isHinge)
        selectRow(sb, 'Größe in', [['pct', '% der Profilhöhe'], ['mm', 'mm']],
          () => sp.sizeMode, v => { if (v !== sp.sizeMode) sparConvertSizeUnits(sp, sp.sizeMode, v); sp.sizeMode = v; buildSidebar(); render(); });
      const uMM = sp.sizeMode === 'mm';
      const isCirc = sp.shape === 'circle';
      const isDT = sp.shape === 'doubleT';
      const dLbl = uMM ? ' (mm)' : ' (%)';
      const innerTxt = sp.sizeTip ? ' innen' : '';
      if (isDT) {
        // Doppel-T: Ober-/Untergurt (waagrechte Rechtecke, folgen oben/unten dem
        // Profilverlauf) + mittiger Steg (stehendes Rechteck). Maße je Rechteck.
        boolRow(sb, 'Höhe füllt Profil (Steg auf 100 %)', () => sp.dtFill, v => { sp.dtFill = v; buildSidebar(); render(); },
          'Die Steg-Höhe ergänzt Ober- und Untergurt automatisch auf die volle Profilhöhe (100 %) — '
          + 'auch im mm-Modus (der Steg füllt bis zur lokalen Profildicke). Aus = Steg-Höhe frei eingeben.');
        boolRow(sb, 'Innere Gurtkanten folgen dem Profil', () => sp.dtContourInner, v => { sp.dtContourInner = v; buildSidebar(); render(); },
          'Die inneren waagrechten Kanten von Ober- und Untergurt (zum Steg hin) werden als Offset der '
          + 'Profilkontur geführt statt gerade: Der Gurt bekommt so über seine ganze Breite eine gleichmäßige '
          + 'Dicke (= Gurthöhe), die der Wölbung der Haut folgt. Aus = gerade, waagrechte Innenkanten.');
        if (!uMM)
          boolRow(sb, 'Gurthöhe fest in mm (Breite in %)', () => !!sp.dtHmm,
            v => { if (!!sp.dtHmm !== v) sparConvertFlangeH(sp, v); sp.dtHmm = v; buildSidebar(); render(); },
            'Die Höhe (Dicke) von Ober- und Untergurt wird in mm eingegeben und bleibt über die ganze Spannweite '
            + 'gleich, während die Breiten weiter mit der Profilhöhe skalieren (%). Ein realer Gurt (CFK-Band, '
            + 'Kiefernleiste) ist überall gleich dick — so wird er an dünnen Profilstellen außen nicht dünner als '
            + 'der Abbrand. Beim Umschalten wird der aktuelle Wert an der Wurzel umgerechnet.');
        const hLbl = (uMM || sp.dtHmm) ? ' (mm)' : ' (%)';
        selectRow(sb, 'Gurt dünner als Abbrand', [['in', 'Nach innen verdicken (Steg wird niedriger)'], ['out', 'Nach außen (in die Schale)']],
          () => (sp.dtThinDir === 'out' ? 'out' : 'in'), v => { sp.dtThinDir = v; buildSidebar(); render(); },
          'Ist ein Gurt an einer Stelle dünner als der Schnittspalt (Abbrand) plus 0,3 mm Reserve, würden seine '
          + 'beiden waagrechten Schnittspuren beim Abbrand-Offset zusammenfallen (der Gurt verschwände aus der '
          + 'Drahtbahn). Er wird dann automatisch auf diese Mindestdicke verdickt: „Nach innen" = die Innenkante '
          + 'wandert zum Steg, die Schale bleibt unversehrt. „Nach außen" = die Außenkante wandert über die '
          + 'Profilkontur hinaus (schneidet die Schale an). Die Tasche wird dabei praktisch zum Schlitz: der '
          + 'Draht fährt hinaus und 0,3 mm versetzt zurück. Betroffene Stellen werden direkt darunter gemeldet.');
        // Warnbox „Gurt dünner als Abbrand" — wird beim Tippen in den Gurt-Feldern
        // LIVE neu gefüllt (ohne Sidebar-Neubau, damit die Eingabe nicht abbricht).
        const dtWarnBox = document.createElement('div');
        const refreshDtWarn = () => {
          dtWarnBox.innerHTML = '';
          const thin = dtThinReport(sp);
          if (!thin.length) return;
          const f1 = v => (Math.round(v * 100) / 100).toFixed(2).replace('.', ',');
          const dirTxt = sp.dtThinDir === 'out' ? T('nach außen, in die Schale') : T('nach innen, Steg niedriger');
          warn(dtWarnBox, T('Gurt dünner als der Abbrand: an den genannten Rippen wird der Gurt automatisch auf Abbrand + 0,3 mm verdickt')
            + ' (' + dirTxt + '). ' + (!uMM && !sp.dtHmm ? T('Tipp: „Gurthöhe fest in mm" einschalten, dann bleibt der Gurt überall gleich dick.') : ''));
          thin.forEach(w => {
            const stLbl = w.station === 0 ? T('Wurzel') : T('Segment') + ' ' + w.station + T(' (außen)');
            const nm = w.key === 'ot' ? T('Obergurt') : T('Untergurt');
            hint(dtWarnBox, nm + ' ' + stLbl + ': ' + f1(w.nom) + ' mm < ' + T('Abbrand') + ' ' + f1(w.kerf) + ' mm → ' + f1(w.min) + ' mm');
          });
        };
        const dtSet = (k, v) => { sp[k] = v; render(); refreshDtWarn(); };
        // Warnbox direkt unter der Auswahl (User-Wunsch), nicht erst hinter den Maßen.
        sb.appendChild(dtWarnBox);
        refreshDtWarn();
        subhead(sb, 'Obergurt (oben, folgt dem Profil)');
        numRow(sb, 'Breite' + dLbl, () => sp.dtOtW, v => dtSet('dtOtW', v), { step: 1, min: 0.1, norender: true });
        numRow(sb, 'Höhe' + hLbl, () => sp.dtOtH, v => dtSet('dtOtH', v), { step: 1, min: 0.1, norender: true });
        subhead(sb, 'Steg (Mitte, stehend)');
        numRow(sb, 'Breite' + dLbl, () => sp.dtStW, v => dtSet('dtStW', v), { step: 1, min: 0.1, norender: true });
        if (!sp.dtFill)
          numRow(sb, 'Höhe' + dLbl, () => sp.dtStH, v => dtSet('dtStH', v), { step: 1, min: 0.1, norender: true });
        else
          hint(sb, 'Steg-Höhe = 100 % − Obergurt − Untergurt (ergänzt automatisch).');
        subhead(sb, 'Untergurt (unten, folgt dem Profil)');
        numRow(sb, 'Breite' + dLbl, () => sp.dtUbW, v => dtSet('dtUbW', v), { step: 1, min: 0.1, norender: true });
        numRow(sb, 'Höhe' + hLbl, () => sp.dtUbH, v => dtSet('dtUbH', v), { step: 1, min: 0.1, norender: true });
      } else if (isCirc) {
        numRow(sb, 'Durchmesser' + innerTxt + dLbl,
          () => sp.h, v => { sp.h = v; render(); }, { step: 1, min: 0.1, norender: true });
      } else if (isPocket) {
        // Tasche: Gurt-Aufnahme ohne Steg. Flache Tasche als Parallel-Offset der
        // Profilkontur nach innen (Tiefe senkrecht zur Kontur). Keine eigene
        // Anfahrt — der Profilschnitt läuft in die Tasche und wieder heraus.
        hint(sb, (isPocketWeb ? 'Tasche(n) mit halbem Steg (Doppel-T). ' : 'Flache Tasche(n) als Aufnahme für Gurte (Doppel-T ohne Steg). ') + 'Der Boden ist ein '
          + 'Parallel-Offset der Profilkontur nach innen (gleichmäßige Tiefe, folgt der Wölbung). '
          + 'Es wird KEINE eigene Anfahrt geschnitten: Der Profilschnitt läuft bis zur Tasche, den '
          + 'Boden entlang und vorne als Profilschnitt weiter — das Profilstück über der Tasche wird '
          + 'getrimmt. Wird nur im Holmschnitt-Modus „während des Schnitts" erzeugt.');
        numRow(sb, 'Breite' + innerTxt + dLbl,
          () => sp.w, v => { sp.w = v; render(); }, { step: 1, min: 0.1, norender: true });
        const pkS = sp.pkSide || 'both';
        if (pkS !== 'bottom')
          numRow(sb, 'Tiefe oben (mm, senkrecht zur Kontur)', () => pocketDepth(sp, 'top'), v => { sp.pkDepthTop = v; render(); },
            { step: 0.5, min: 0.1, norender: true,
              hint: 'Tiefe der OBEREN Tasche als echter Parallel-Offset der Profilkontur nach innen.' });
        if (pkS !== 'top')
          numRow(sb, 'Tiefe unten (mm, senkrecht zur Kontur)', () => pocketDepth(sp, 'bottom'), v => { sp.pkDepthBot = v; render(); },
            { step: 0.5, min: 0.1, norender: true,
              hint: 'Tiefe der UNTEREN Tasche als echter Parallel-Offset der Profilkontur nach innen.' });
        boolRow(sb, 'Gerade waagrechte Innenkante (flacher Gurtboden)', () => sp.pkFlat, v => { sp.pkFlat = v; render(); },
          'Der Taschenboden (innere Gurtkante) läuft GERADE waagrecht statt der Profilwölbung zu folgen — '
          + 'für flache Gurte/Steckungen mit ebenem Auflager. Die Tiefe wird an der Holmmitte gemessen; '
          + 'zur Nase/Endleiste hin ändert sich die Tiefe entsprechend der Profilwölbung. '
          + 'Aus = Boden folgt der Kontur (gleichmäßige Tiefe).');
        selectRow(sb, 'Seite(n)', [['both', 'Oben + unten (Paar)'], ['top', 'Nur oben'], ['bottom', 'Nur unten']],
          () => sp.pkSide || 'both', v => { sp.pkSide = v; buildSidebar(); render(); },
          'Auf welchen Profilseiten die Tasche liegt. „Oben + unten" = zwei Taschen an derselben Lage '
          + '(wie die beiden Gurte eines Doppel-T ohne Steg).');
        // Halber Steg (Doppel-T): Schlitz vom Taschenboden weiter in den Kern, Höhe je Seite.
        if (isPocketWeb) {
        hint(sb, 'Halber Steg (Doppel-T): Ab der Taschenmitte läuft die Spur als schmaler Schlitz um die '
          + 'angegebene Höhe weiter in den Kern und wieder zurück auf den Boden — oben und unten getrennt '
          + 'einstellbar. 0 = kein Steg. Treffen sich beide Hälften, entsteht ein durchgehender Steg. '
          + 'Die Höhe gilt an der Wurzel und wird zum Rand hin proportional zur Sehne skaliert.');
        if (pkS !== 'bottom')
          numRow(sb, 'Steghöhe oben (mm an der Wurzel, ab Taschenboden)', () => sp.pkWebTop || 0, v => { sp.pkWebTop = v; buildSidebar(); render(); },
            { step: 0.5, min: 0, norender: true,
              hint: 'Höhe des halben Stegs unter der OBEREN Tasche an der Wurzel (0 = kein Steg), am Rand proportional zur Sehne. Wird auf die Restdicke unter dem Boden begrenzt.' });
        if (pkS !== 'top')
          numRow(sb, 'Steghöhe unten (mm an der Wurzel, ab Taschenboden)', () => sp.pkWebBot || 0, v => { sp.pkWebBot = v; buildSidebar(); render(); },
            { step: 0.5, min: 0, norender: true,
              hint: 'Höhe des halben Stegs über der UNTEREN Tasche an der Wurzel (0 = kein Steg), am Rand proportional zur Sehne. Wird auf die Restdicke über dem Boden begrenzt.' });
        if ((sp.pkWebTop || 0) > 0 || (sp.pkWebBot || 0) > 0)
          numRow(sb, 'Stegbreite (mm)', () => sp.pkWebW != null ? sp.pkWebW : 2, v => { sp.pkWebW = v; render(); },
            { step: 0.5, min: 0, norender: true,
              hint: 'Breite des Steg-Schlitzes (Fertigmaß). Ist sie kleiner als der Abbrand, fährt der Draht nur hin und zurück (Schlitz = Abbrandbreite).' });
        }
        numRow(sb, 'Winkel vorne (° ab Senkrechte)', () => sp.angFront, v => { sp.angFront = v; render(); },
          { step: 1, min: -80, max: 80, norender: true,
            hint: 'Vordere Taschenwand (Richtung Nasenleiste). 0° = senkrecht, positiv = Boden schmaler (Wand neigt nach innen).' });
        numRow(sb, 'Winkel hinten (° ab Senkrechte)', () => sp.angRear, v => { sp.angRear = v; render(); },
          { step: 1, min: -80, max: 80, norender: true,
            hint: 'Hintere Taschenwand (Richtung Endleiste). 0° = senkrecht, positiv = Boden schmaler.' });
      } else if (isHinge) {
        // Scharnierausschnitt: Dreieck, Spitze auf der Scharnierlinie. Wände über
        // Winkel vorne/hinten; Schnitt bis zur gegenüberliegenden Profilseite,
        // optional darüber hinaus.
        hint(sb, 'Ausschnitt für ein Scharnier (V-förmig oder trapezförmig): Spitze bzw. kurze '
          + 'Trapezseite liegt auf der Scharnierlinie '
          + '(an der eingestellten Scharnier-Profilseite des Segments), der Schnitt öffnet sich zur '
          + 'gegenüberliegenden Profilseite und wird IMMER von dieser gegenüberliegenden Seite angefahren. '
          + 'Lage und Seite kommen aus der Scharnierlinie des Segments.');
        selectRow(sb, 'Form', [['v', 'V-förmig (Dreieck)'], ['trapez', 'Trapezförmig']],
          () => sp.hingeForm || 'v', v => { sp.hingeForm = v; buildSidebar(); render(); },
          'V-förmig: Spitze (Punkt) auf der Scharnierlinie. Trapezförmig: die kurze Trapezseite '
          + 'liegt auf der Scharnierlinie, der Schnitt öffnet sich zur gegenüberliegenden Seite.');
        if ((sp.hingeForm || 'v') === 'trapez')
          numRow(sb, 'Breite kurze Seite an Scharnier (mm)', () => sp.hingeTipW, v => { sp.hingeTipW = v; render(); },
            { step: 0.5, min: 0, norender: true,
              hint: 'Breite der kurzen Trapezseite auf der Scharnierlinie. 0 = wieder ein Dreieck (Spitze).' });
        numRow(sb, 'Winkel vorne (° ab Senkrechte)', () => sp.angFront, v => { sp.angFront = v; render(); },
          { step: 1, min: 0, max: 85, norender: true,
            hint: 'Öffnungswinkel der vorderen Wand (Richtung Nasenleiste), gemessen ab der Senkrechten durch die Spitze.' });
        numRow(sb, 'Winkel hinten (° ab Senkrechte)', () => sp.angRear, v => { sp.angRear = v; render(); },
          { step: 1, min: 0, max: 85, norender: true,
            hint: 'Öffnungswinkel der hinteren Wand (Richtung Endleiste), gemessen ab der Senkrechten durch die Spitze.' });
        numRow(sb, 'Schnittspur Richtung Scharnier (mm)', () => sp.hingeReach, v => { sp.hingeReach = v; render(); },
          { step: 0.5, norender: true,
            hint: 'Wie weit die Schnittspur in Richtung Scharnier geht, gemessen ab der Scharnierlinie: '
              + '0 = genau bis zur Scharnierlinie, positiv = über die Scharnierseite hinaus, negativ = davor (kürzer).' });
        numRow(sb, 'Über gegenüberliegende (Anfahr-)Seite hinaus (mm)', () => sp.hingeOver, v => { sp.hingeOver = v; render(); },
          { step: 0.5, min: 0, norender: true,
            hint: 'Verlängert die Basis über die gegenüberliegende (Anfahr-)Profilseite hinaus. 0 = genau an der gegenüberliegenden Seite.' });
      } else {
        numRow(sb, 'Breite' + innerTxt + dLbl,
          () => sp.w, v => { sp.w = v; render(); }, { step: 1, min: 0.1, norender: true });
        numRow(sb, 'Höhe' + innerTxt + dLbl,
          () => sp.h, v => { sp.h = v; render(); }, { step: 1, min: 0.1, norender: true });
        if (sp.shape === 'trapez' && !sp.cutAngles)
          numRow(sb, 'Verjüngung oben (0–1)', () => 1 - sp.taper, v => { sp.taper = Math.min(1, Math.max(0, 1 - v)); render(); },
            { step: 0.05, min: 0, max: 1, norender: true, hint: '0 = keine Verjüngung (viereckig), 1 = Oberkante läuft auf null zusammen.' });
        // Basisbezug (nur Trapez): Basis mittig / an Ober- bzw. Unterseite klebend.
        if (sp.shape === 'trapez') {
          selectRow(sb, 'Basisbezug', [['center', 'Mittig (Skelettlinie)'], ['bottom', 'Profilunterseite'], ['top', 'Profiloberseite']],
            () => sp.baseRef || 'center', v => { sp.baseRef = v; render(); },
            'Bezug der Basis (breite Seite): „Mittig" = zentriert auf der Skelettlinie (bisher). '
            + '„Profilunterseite"/„Profiloberseite" = die Basis klebt an der jeweiligen Profilkontur '
            + 'und folgt ihr; die gegenüberliegende (flache) Seite verschiebt sich mit der Höhe vertikal.');
        }
        // Getrennte Schnittwinkel (vorne/hinten) — nur Trapez.
        if (sp.shape === 'trapez') {
          boolRow(sb, 'Eigene Schnittwinkel (vorne/hinten)', () => sp.cutAngles, v => { sp.cutAngles = v; buildSidebar(); render(); },
            'Winkel der vorderen (Nasenleisten-Seite) und hinteren (Endleisten-Seite) Wand getrennt '
            + 'einstellbar, gemessen ab der Senkrechten. Aus = symmetrische Standardform.');
          if (sp.cutAngles) {
            numRow(sb, 'Winkel vorne (° ab Senkrechte)', () => sp.angFront, v => { sp.angFront = v; render(); },
              { step: 1, min: -80, max: 80, norender: true,
                hint: 'Vordere Wand (Richtung Nasenleiste). 0° = senkrecht, positiv = neigt sich nach innen (oben schmaler), negativ = nach außen.' });
            numRow(sb, 'Winkel hinten (° ab Senkrechte)', () => sp.angRear, v => { sp.angRear = v; render(); },
              { step: 1, min: -80, max: 80, norender: true,
                hint: 'Hintere Wand (Richtung Endleiste). 0° = senkrecht, positiv = neigt sich nach innen. Treffen sich beide Wände, entsteht ein Dreieck (V).' });
          }
        }
      }
      // Außenmaß getrennt wählbar (Innen-/Außensegment unterschiedlich groß).
      // Bei Doppel-T entfällt das getrennte Außenmaß — die %-Skalierung an der
      // lokalen Profilhöhe verjüngt den Träger ohnehin von innen nach außen.
      if (!isDT && !isHinge) {
        boolRow(sb, 'Außenmaß abweichend', () => sp.sizeTip, v => { sp.sizeTip = v; buildSidebar(); render(); },
          isPocket ? 'Eigene Taschenbreite für die AUSSEN-Rippe (Randseite). Aus = außen wie innen (Tasche läuft konisch von innen nach außen).'
                   : 'Eigenes Maß für die AUSSEN-Rippe (Randseite). Aus = außen wie innen. '
                     + 'Der Holm läuft dann konisch von innen nach außen.');
        if (sp.sizeTip) {
          if (isCirc) {
            numRow(sb, 'Durchmesser außen' + dLbl,
              () => sp.hTip, v => { sp.hTip = v; render(); }, { step: 1, min: 0.1, norender: true });
          } else {
            numRow(sb, 'Breite außen' + dLbl,
              () => sp.wTip, v => { sp.wTip = v; render(); }, { step: 1, min: 0.1, norender: true });
            if (!isPocket)
              numRow(sb, 'Höhe außen' + dLbl,
                () => sp.hTip, v => { sp.hTip = v; render(); }, { step: 1, min: 0.1, norender: true });
          }
        }
      }
      if (!isHinge && !isPocket) {
        // Doppel-T sitzt immer mittig zwischen den Profiloberflächen (kein Höhenversatz).
        if (isDT) sp.yOff = 0;
        else {
          selectRow(sb, 'Höhenversatz', [['same', 'Innen = außen'], ['sep', 'Innen / außen getrennt']],
            () => sp.yOffSep ? 'sep' : 'same', v => { sp.yOffSep = v === 'sep'; buildSidebar(); render(); },
            'Verschiebt den Holm gegenüber der Skelettlinie (+ nach oben). Getrennt: eigener Versatz für die '
            + 'Wurzel- und die Außenrippe; dazwischen läuft der Holm linear.');
          numRow(sb, sp.yOffSep ? 'Höhenversatz zur Mitte innen (mm)' : 'Höhenversatz zur Mitte (mm)',
            () => sp.yOff, v => { sp.yOff = v; render(); }, { step: 1, norender: true });
          if (sp.yOffSep)
            numRow(sb, 'Höhenversatz zur Mitte außen (mm)', () => sp.yOffTip, v => { sp.yOffTip = v; render(); },
              { step: 1, norender: true });
        }
        selectRow(sb, 'Anfahrt', [['shortest', 'Kürzester Weg'], ['top', 'Von oben'], ['bottom', 'Von unten']],
          () => sp.approach, v => { sp.approach = v; render(); },
          'Von welcher Seite der Draht in den Holm einsticht — kürzester Weg zur Oberfläche oder erzwungen.');
      }
      subhead(sb, 'Segmentbereich');
      selectRow(sb, 'Von Segment (Wurzel)', segOpts, () => String(Math.min(sp.segFrom, sp.segTo)),
        v => { sp.segFrom = +v; if (sp.segTo < sp.segFrom) sp.segTo = sp.segFrom; buildSidebar(); render(); },
        'Wurzelseite des Holms — hier liegt das Wurzel-Ende der geraden Holmlinie.');
      selectRow(sb, 'Bis Segment (Außen)', segOpts, () => String(Math.max(sp.segFrom, sp.segTo)),
        v => { sp.segTo = +v; if (sp.segTo < sp.segFrom) sp.segFrom = sp.segTo; buildSidebar(); render(); },
        'Außenseite des Holms — hier liegt das Außen-Ende der geraden Holmlinie.');
      const [ra, rb] = sparRange(sp);
      subhead(sb, 'Lage ab Nasenleiste');
      if (isHinge) {
        hint(sb, 'Die Lage liegt automatisch auf der Scharnierlinie des jeweiligen Segments '
          + '(Seite + % von hinten). Zum Ändern die Scharnierlinie im Segment anpassen.');
      } else if (isPocket) {
        // Tasche: Wurzel-/Außenlage wie bei Loch-Holmen (mm oder %). Nicht
        // proportional -> abschnittsweise Neuabtastung der Profilbahn (Warnung).
        sparPosFields(sb, 'root', sp, T('Wurzel Seg ') + (ra + 1));
        sparPosFields(sb, 'tip', sp, T('Außen Seg ') + (rb + 1));
        const sk = App.pocketSkewInfo(sp);
        if (sk) warn(sb, T('Lage nicht proportional (Wurzel ') + sk.rootPct.toFixed(1) + T(' %, Außen ') + sk.tipPct.toFixed(1)
          + T(' % der Sehne): der Draht steht im Taschenbereich schräg, die Profilbahn wird dort abschnittsweise neu abgetastet. '
          + 'Zwischenrippen weichen im Taschenbereich um bis zu ≈ ') + sk.devMm.toFixed(1) + T(' mm in Flugrichtung ab.'));
      } else {
      boolRow(sb, 'Entlang Scharnierlinie ausrichten', () => sp.hingeAlign, v => { sp.hingeAlign = v; buildSidebar(); render(); },
        'Der Holm läuft im Grundriss PARALLEL zur Scharnierlinie (folgt deren Lage/Pfeilung) statt als '
        + 'Nasenleisten-bezogene Gerade. Der Abstand vor der Scharnierlinie wird unten eingestellt. '
        + 'Die Wurzel-/Außenlage entfällt dann.');
      if (sp.hingeAlign) {
        numRow(sb, 'Abstand vor Scharnier (mm)', () => sp.hingeOffset, v => { sp.hingeOffset = v; render(); },
          { step: 1, min: 0, norender: true,
            hint: 'Abstand des Holms VOR der Scharnierlinie (Richtung Nasenleiste). 0 = auf der Scharnierlinie.' });
      } else {
        sparPosFields(sb, 'root', sp, T('Wurzel Seg ') + (ra + 1));
        sparPosFields(sb, 'tip', sp, T('Außen Seg ') + (rb + 1));
      }
      }
      subhead(sb, 'Gerade Steckung');
      boolRow(sb, 'Parallel zur Flugrichtung', () => sp.flightPar, v => { sp.flightPar = v; render(); },
        'Hält die Lage über den Segmentbereich auf KONSTANTEM X (ignoriert Rückpfeilung) — '
        + 'der Holm bleibt in Flugrichtung gerade.');
      if (!isPocket)
      boolRow(sb, 'Horizontal (waagrecht)', () => sp.horiz, v => { sp.horiz = v; render(); },
        'Hält die Höhe über den Segmentbereich auf KONSTANTEM Y (ignoriert V-Form) — '
        + 'für eine GERADE Tragflächensteckung trotz V-Form. Beide zusammen: durchgehend gerader Holm.');
    });
    const add = document.createElement('button'); add.className = 'primary'; add.textContent = T('+ Holm hinzufügen');
    add.onclick = () => { const n = state.segments.length - 1; state.spars.push(newSpar({ segFrom: 0, segTo: n })); state.activeSpar = state.spars.length - 1; buildSidebar(); render(); };
    box.appendChild(add);
  }

  /* Schnittkarte (Reiter „Kernschneiden"): NL/EL-Schnitt- und Blockzugaben. */
  // Art der Schnittverlängerung an der Nasenleiste (global für alle Segmente
  // der Tragfläche) — wird in jeder Segmentkarte unter „Nasenleiste" gezeigt.
  function leArtRows(body) {
    selectRow(body, 'Schnittverlängerung NL (Art)',
      [['x', 'X-Schlaufe an der Nase'], ['eight', 'Liegende Acht an der Nase'], ['horizontal', 'Horizontal nach vorne'], ['none', 'Keine']],
      () => state.cfg.leStyle, v => { state.cfg.leStyle = v; buildSidebar(); },
      'X-Schlaufe: schräg unter Winkel runter, parallel vor, senkrecht hoch, gespiegelt zurück zur Nase. '
      + 'Liegende Acht: ∞-Schlaufe vor der Nase, tangential in Ober- und Unterseite übergehend.');
    if (state.cfg.leStyle === 'x') {
      numRow(body, 'Winkel zur Mittellinie (°)', () => state.cfg.leAngle, v => state.cfg.leAngle = v, { step: 1, min: 1, max: 89 });
      numRow(body, 'Abstand horizontale Linien (mm)', () => state.cfg.leGap, v => state.cfg.leGap = Math.max(0, v),
        { step: 1, min: 0, hint: 'Vertikaler Abstand der beiden waagrechten Schneidelinien der X-Schlaufe. '
          + '0 = automatisch aus dem Winkel (2·A·sin). >0 = fester Abstand; der WINKEL bleibt, '
          + 'der Vorlauf nach vorne wächst/schrumpft mit dem Abstand (A = Abstand / 2·sin).' });
    }
    if (state.cfg.leStyle === 'eight') {
      numRow(body, 'Acht: Länge (mm)', () => state.cfg.eightW, v => state.cfg.eightW = Math.max(0, v),
        { step: 1, min: 0, hint: 'Länge der liegenden Acht in Sehnenrichtung (nach vorne). Die Selbstkreuzung liegt mittig.' });
      numRow(body, 'Acht: Höhe (mm)', () => state.cfg.eightH, v => state.cfg.eightH = Math.max(0, v),
        { step: 1, min: 0, hint: 'Höhe der beiden Keulen der liegenden Acht (senkrecht zur Sehne).' });
      numRow(body, 'Acht: Schnittpunkt vor Nase (mm)', () => state.cfg.eightCross, v => state.cfg.eightCross = Math.max(0, v),
        { step: 1, min: 0, hint: 'Horizontale Lage der Selbstkreuzung, gemessen ab der Nase. '
          + '0 = mittig (halbe Länge). Größerer Wert schiebt die Kreuzung nach vorne — z. B. damit sie VOR der Blockkante liegt. '
          + '(Wird auf 5…95 % der Länge begrenzt.)' });
    }
    boolRow(body, 'Schnittverlängerung NL immer über Block', () => state.cfg.extOverBlockLE,
      v => { state.cfg.extOverBlockLE = v; buildSidebar(); render(); },
      'Zieht die wirksame Schnittverlängerung an der Nasenleiste automatisch so weit heraus, '
      + 'dass sie den Block-Überstand überragt — der Draht fährt garantiert außerhalb des '
      + 'Blocks ein. Vorhandene Verlängerungen werden nur angehoben, nie neu erzeugt.');
    if (state.cfg.extOverBlockLE)
      numRow(body, 'Abstand über Block NL (mm)', () => state.cfg.extOverBlockClearLE,
        v => state.cfg.extOverBlockClearLE = v, { step: 1, min: 0 });
  }
  // Art der Schnittverlängerung an der Endleiste (global) — unter „Endleiste".
  function teArtRows(body) {
    selectRow(body, 'Schnittverlängerung EL (Art)',
      [['horizontal', 'Horizontal'],
       ['skeleton', 'Entlang Skelettlinie (gekrümmt)'],
       ['surface', 'Entlang Profilober-/-unterseite (tangential)'],
       ['surfaceUpper', 'Parallel zur Profiloberseite'],
       ['surfaceLower', 'Parallel zur Profilunterseite']],
      () => state.cfg.teStyle, v => { state.cfg.teStyle = v; render(); },
      'Steg hinter der Endleiste; setzt an den Kern-Endleisten-Ecken an und läuft NUR nach hinten '
      + '(taucht nicht ins Profil). Länge zählt ab der Profil-Endleiste. '
      + '„Horizontal": zwei WAAGRECHTE Stege, je auf der Höhe der oberen bzw. unteren '
      + 'Kern-Endleisten-Ecke — dieselbe Logik wie das Negativschalendesign, das den Kern '
      + 'beplankungsunabhängig sauber schneidet (empfohlen). '
      + '„Entlang Skelettlinie": wie horizontal, aber beide Stege folgen der KRÜMMUNG der '
      + 'Skelettlinie des Ausgangsprofils, über die Endleiste hinaus fortgesetzt. '
      + '„Entlang Profilober-/-unterseite": der obere Steg setzt die PROFILOBERSEITE, der '
      + 'untere die PROFILUNTERSEITE tangential (knickfrei) über die Endleiste hinaus fort — '
      + 'die Verlängerung läuft parallel zur jeweiligen Kontur-Tangente an der EL, wie die '
      + 'Skelettlinien-Verlängerung, nur je Steg entlang seiner eigenen Kontur. '
      + '„Parallel zur Profiloberseite": BEIDE Stege folgen der Krümmung der OBERSEITE '
      + '(der untere versetzt auf seine EL-Ecke) — der obere Schnittverlauf verlängert die '
      + 'Unterseite dann parallel zur Oberseite. „Parallel zur Profilunterseite": umgekehrt, '
      + 'beide Stege parallel zur UNTERSEITE. '
      + 'Länge je Segment unter „Schnittverl. EL".');
    boolRow(body, 'Schnittverlängerung EL immer über Block', () => state.cfg.extOverBlockTE,
      v => { state.cfg.extOverBlockTE = v; buildSidebar(); render(); },
      'Zieht den Steg hinter der Endleiste automatisch so weit heraus, dass er den '
      + 'Block-Überstand überragt — der Draht fährt garantiert außerhalb des Blocks aus. '
      + 'Vorhandene Verlängerungen werden nur angehoben, nie neu erzeugt.');
    if (state.cfg.extOverBlockTE)
      numRow(body, 'Abstand über Block EL (mm)', () => state.cfg.extOverBlockClearTE,
        v => state.cfg.extOverBlockClearTE = v, { step: 1, min: 0 });
  }

  // Knopfzeile „für alle Segmente": setzt die genannten Verlängerungen von der
  // Wurzel bis zur Außenrippe des letzten Segments auf KONSTANT (überall der
  // Wurzelwert von Segment 1, proportional aus) oder PROPORTIONAL zur Sehne
  // (proportional an in jedem Segment; die Wurzelwerte folgen der Kette
  // Außenwert Vorsegment = Wurzelwert Folgesegment).
  function chainRow(body, fields, what) {
    const r = document.createElement('div'); r.className = 'row';
    const l = document.createElement('label'); l.textContent = T(what) + ' ' + T('für alle Segmente');
    const wrap = document.createElement('div');
    const base = state.segments[0] || {};
    wrap.appendChild(mkMini(T('konstant'), () => {
      state.segments.forEach(s => fields.forEach(f => { s[f.prop] = false; s[f.tip] = +base[f.root] || 0; }));
      buildSidebar(); render();
    }));
    wrap.appendChild(mkMini(T('proportional'), () => {
      state.segments.forEach(s => fields.forEach(f => { s[f.prop] = true; }));
      buildSidebar(); render();
    }));
    r.appendChild(l); r.appendChild(wrap); body.appendChild(r);
    hint(body, 'Konstant: von der Wurzel bis zur Außenrippe des letzten Segments überall der Wurzelwert von Segment 1. '
      + 'Proportional: in jedem Segment proportional zur Sehne, die Wurzelwerte folgen dem Außenwert des Vorsegments.');
  }

  function segmentCutCard(seg, idx) {
    const card = segCard(idx); const box = card.body;

    // --- Nasenleiste (NL) & Endleiste (EL) -----------------------------
    // Je Kante zwei Größen, jeweils getrennt für Wurzel/außen (+proportional):
    //   • Verlängerung        -> Schaumzugabe = BLOCKGRÖSSE.
    //   • Schnittverlängerung -> Weg des Drahts; DARF über den Block hinaus.
    const rootChord = idx === 0 ? state.root.chord : state.segments[idx - 1].chord;
    const ratio = rootChord ? seg.chord / rootChord : 1;
    const ro = T('Proportional zur Sehne (Wurzelwert · ') + ratio.toFixed(3) + ').';
    // Ab Segment 2 wird der Wurzelwert vom Vorsegment übernommen (nicht editierbar).
    const rRO = idx > 0;
    const rl = s => rRO ? s.replace('Wurzel (mm)', 'Wurzel (mm, vom Vorsegment)') : s;
    let xRefresh = null; const xR = () => { if (xRefresh) xRefresh(); };

    subhead(box, 'Nasenleiste (NL)', '#4da3ff');
    hint(box, 'Verlängerung = Blockgröße vor der Nase. Negative Werte erlaubt: die Blockkante liegt dann HINTER der Nase, der Kern wird an der Nasenleiste abgeschnitten (z. B. für eine aufgesetzte Nasenleiste).');
    extTriple(box, seg, ratio, ro, { root: 'bLE', tip: 'bLETip', prop: 'bLEProp' },
      { root: rl('Blockzugabe NL Wurzel (mm)'), tip: 'Blockzugabe NL außen (mm)', prop: 'Blockzugabe NL außen proportional zur Sehne' },
      { step: 1 }, rRO, xR);
    if (state.segments.length > 1) chainRow(box, [{ root: 'bLE', tip: 'bLETip', prop: 'bLEProp' }], 'Blockzugabe NL');
    subhead(box, 'Schnittverlängerung NL', '#9aa7b4');
    hint(box, 'Art, Winkel und „über Block" gelten für alle Segmente dieser Tragfläche; die Längen je Segment.');
    leArtRows(box);
    if (state.cfg.leStyle === 'x' || state.cfg.leStyle === 'horizontal') {
      hint(box, 'Schnittverlängerung — darf über den Block hinausragen.');
      // Reihenfolge: erst alle Wurzelwerte (Schräge, horizontal), dann alle
      // Außenwerte (jeweils mit proportional-Schalter).
      const kA = { root: 'leExt', tip: 'leExtTip', prop: 'leExtProp' };
      const lA = { root: rl(state.cfg.leStyle === 'x' ? 'Schnittverl. NL Schräge Wurzel (mm)' : 'Schnittverl. NL Länge Wurzel (mm)'),
          tip: state.cfg.leStyle === 'x' ? 'Schnittverl. NL Schräge außen (mm)' : 'Schnittverl. NL Länge außen (mm)',
          prop: 'Schnittverl. NL Schräge proportional' };
      const kB = { root: 'leExt2', tip: 'leExt2Tip', prop: 'leExt2Prop' };
      const lB = { root: rl('Schnittverl. NL horizontal Wurzel (mm)'), tip: 'Schnittverl. NL horizontal außen (mm)', prop: 'Schnittverl. NL horizontal proportional' };
      const linkA = {}, linkB = {};
      if (state.cfg.leStyle !== 'x') {
        extTriple(box, seg, ratio, ro, kA, lA, null, rRO, xR);
        if (state.segments.length > 1) chainRow(box, [kA], 'Schnittverlängerung NL');
      } else {
        // Warnbox „X-Schlaufe unplausibel" — LIVE beim Tippen aktualisiert (ohne
        // Sidebar-Neubau, damit die Eingabe nicht abbricht).
        const xWarnBox = document.createElement('div');
        const refreshXWarn = () => {
          xWarnBox.innerHTML = '';
          const rep = noseLoopReport(seg, idx);
          if (!rep.length) return;
          if (rep.some(r => r.kind === 'B'))
            warn(xWarnBox, 'X-Schlaufe unplausibel: die horizontale Strecke ist kleiner als der Abbrand — die beiden waagrechten Linien fallen nach dem Abbrand-Versatz zusammen, aus dem X wird ein V.');
          if (rep.some(r => r.kind === 'H'))
            warn(xWarnBox, 'X-Schlaufe unplausibel: die Schlaufe ist um ein Vielfaches höher als die Rippe. Blockzugabe NL kleiner/proportional wählen, horizontale Strecke vergrößern oder „Schnittverlängerung immer über Block" ausschalten.');
          rep.forEach(r => hint(xWarnBox, r.txt));
        };
        xRefresh = refreshXWarn;
        extTriple(box, seg, ratio, ro, kA, lA, null, rRO, xR, 'root', linkA);
        extTriple(box, seg, ratio, ro, kB, lB, null, rRO, refreshXWarn, 'root', linkB);
        extTriple(box, seg, ratio, ro, kA, lA, null, rRO, xR, 'tip', linkA);
        extTriple(box, seg, ratio, ro, kB, lB, null, rRO, refreshXWarn, 'tip', linkB);
        if (state.segments.length > 1) chainRow(box, [kA, kB], 'Schnittverlängerung NL');
        box.appendChild(xWarnBox);
        refreshXWarn();
      }
    }

    subhead(box, 'Endleiste (EL)', '#4da3ff');
    hint(box, 'Verlängerung = Blockgröße hinter der Endleiste.');
    extTriple(box, seg, ratio, ro, { root: 'bTE', tip: 'bTETip', prop: 'bTEProp' },
      { root: rl('Blockzugabe EL Wurzel (mm)'), tip: 'Blockzugabe EL außen (mm)', prop: 'Blockzugabe EL außen proportional zur Sehne' }, null, rRO);
    subhead(box, 'Schnittverlängerung EL', '#9aa7b4');
    hint(box, 'Art und „über Block" gelten für alle Segmente dieser Tragfläche; die Länge je Segment.');
    teArtRows(box);
    hint(box, 'Steg hinter der Endleiste — darf über den Block hinausragen.');
    extTriple(box, seg, ratio, ro, { root: 'teExt', tip: 'teExtTip', prop: 'teExtProp' },
      { root: rl('Schnittverl. EL Wurzel (mm)'), tip: 'Schnittverl. EL außen (mm)', prop: 'Schnittverl. EL außen proportional' }, null, rRO);
    return card.box;
  }
  function mkMini(txt, cb) {
    const b = document.createElement('button'); b.textContent = txt;
    b.style.padding = '2px 7px'; b.style.marginLeft = '3px';
    b.onclick = e => { e.stopPropagation(); cb(); };   // Klick nicht an die Kopfzeile weiterreichen
    return b;
  }

  // Auswahlmenü für das Segment (Vorschau / G-Code / Kernschneiden).
  function segmentSelectRow() {
    const r = document.createElement('div'); r.className = 'row';
    const l = document.createElement('label'); l.textContent = 'Segment';
    const sel = document.createElement('select');
    state.segments.forEach((s, i) => { const o = document.createElement('option'); o.value = i; o.textContent = 'Segment ' + (i + 1); sel.appendChild(o); });
    // Keine Option „Alle": G-Code/Negativ beziehen sich immer auf genau ein
    // Segment. Intern 'all' (= keine Karte offen) wird als Segment 1 angezeigt.
    sel.value = String(App.activeIdx());
    sel.onchange = () => { state.activeSeg = parseInt(sel.value, 10); buildSidebar(); render(); };
    r.appendChild(l); r.appendChild(sel); return r;
  }

  /* Eigenes Menü „Tragfläche importieren" (ganz oben im Reiter Tragflächen-
   * design): FLZ_Vortex-CSV und XFLR5-XML. Ersetzt jeweils die komplette
   * Segmentkette. Bei XFLR5 zusätzlich die Profil-.dat-Zuordnung. */
  function wingImportGroup() {
    const g = grp('Tragfläche importieren', true, 'wing', { alwaysOpen: true });
    const b = g.body;
    // Konvention wie im übrigen Tragflächendesigner: Beschreibung (hint) VOR ihre
    // Bedienzeile setzen. So ordnet decorateFields()/hintHost() das „?"/📝-Paar
    // eindeutig der DARUNTER liegenden Schaltfläche zu (nextSibling) und nicht
    // versehentlich dem nächsten Import-Button.
    // FLZ_Vortex CSV.
    hint(b, 'FLZ_Vortex CSV-Export (Geometrie): Wurzelprofil, Sehnen, Spannweiten, '
      + 'Pfeilung, V-Form, Schränkung und Klappentiefen werden übernommen (inkl. Profil-'
      + 'koordinaten). Bei mehreren Flügeln wird der Hauptflügel gewählt. Es wird eine '
      + 'HALBE Tragfläche (Wurzel nach außen) importiert.');
    const rflz = document.createElement('div'); rflz.className = 'row full';
    const bflz = document.createElement('button'); bflz.textContent = T('FLZ_Vortex CSV importieren…');
    bflz.onclick = () => {
      if (!confirm(T('FLZ-Import ersetzt die komplette Tragfläche (alle Segmente, Profile und Holme). Fortfahren?'))) return;
      loadFlz();
    };
    rflz.appendChild(bflz); b.appendChild(rflz);
    // XFLR5 / plane XML.
    hint(b, 'XFLR5-/plane-XML: Planform (Sehnen, Spannweiten, Pfeilung aus xOffset, '
      + 'V-Form, Schränkung) wird übernommen. ACHTUNG: XFLR5-XML enthält KEINE '
      + 'Profilkoordinaten — es werden Platzhalterprofile gesetzt, die echten Profile '
      + 'unten als .dat zuordnen.');
    const rxf = document.createElement('div'); rxf.className = 'row full'; rxf.style.marginTop = '6px';
    const bxf = document.createElement('button'); bxf.textContent = T('XFLR5 XML importieren…');
    bxf.onclick = () => {
      if (!confirm(T('XFLR5-Import ersetzt die komplette Tragfläche (alle Segmente, Profile und Holme). Fortfahren?'))) return;
      loadXflr();
    };
    rxf.appendChild(bxf); b.appendChild(rxf);
    // Planform Creator 2 (.pc2) — öffnet einen eigenen Trapez-Dialog.
    hint(b, 'Planform Creator 2 (.pc2): glatte/elliptische Fläche. Ein eigener Dialog '
      + 'zerlegt sie in wählbar viele/positionierte Trapeze (Live-Vorschau). Profile sind '
      + 'auch hier nur Namen — unten als .dat zuordnen. V-Form/Schränkung = 0 (reine Draufsicht).');
    const rpc = document.createElement('div'); rpc.className = 'row full'; rpc.style.marginTop = '6px';
    const bpc = document.createElement('button'); bpc.textContent = T('Planform Creator (.pc2) importieren…');
    bpc.onclick = () => {
      if (!confirm(T('Der Import ersetzt die komplette Tragfläche (alle Segmente, Profile und Holme). Fortfahren?'))) return;
      loadPc2();
    };
    rpc.appendChild(bpc); b.appendChild(rpc);
    // Profil-Zuordnung (nur nach XFLR5-Import mit gespeicherten Foil-Namen).
    const hasFoilNames = (state.root && state.root.foilName) || state.segments.some(s => s.foilName);
    if (hasFoilNames) {
      const openCnt = (state.root && state.root.foilName && isPlaceholderProfile(state.root.profile) ? 1 : 0)
        + state.segments.filter(s => s.foilName && isPlaceholderProfile(s.profile)).length;
      hint(b, 'Mehrere Profil-.dat auf einmal wählen. Die Zuordnung erfolgt über den '
        + 'Foil-Namen (Dateiname ODER Profilname in der Datei = XFLR5-Name, Groß/Klein und '
        + 'Sonderzeichen egal). Passende Profile ersetzen die Platzhalter automatisch.');
      const rfl = document.createElement('div'); rfl.className = 'row full'; rfl.style.marginTop = '6px';
      const bfl = document.createElement('button');
      bfl.textContent = T('Profile (.dat) zuordnen…') + (openCnt ? ' (' + openCnt + ')' : '');
      if (openCnt) bfl.className = 'primary';
      bfl.onclick = loadFoilDats;
      rfl.appendChild(bfl); b.appendChild(rfl);
    }
    return g;
  }

  /* Menü „Beplankung" (Tragflächendesigner): globaler Wert oder segmentweise,
   * Ober-/Unterschale gleich oder getrennt. Die eigentlichen Segmentwerte werden
   * bei „segmentweise" direkt in den Segmentkarten (segmentShapeCard) eingegeben. */
  function sheetingGroup() {
    const g = grp('Beplankung', true, 'wing');
    const c = state.cfg;
    hint(g.body, 'Beplankung = Schalendicke, die von der Kontur abgezogen wird (der Schaumkern wird '
      + 'entsprechend kleiner geschnitten). Wirkt auf Kernschnitt und Profilbild.');
    selectRow(g.body, 'Werte', [['global', 'Ein Wert (ganze Fläche)'], ['segment', 'Segmentweise (je Segment)']],
      () => c.sheetMode || 'global', v => { c.sheetMode = v; buildSidebar(); render(); });
    selectRow(g.body, 'Ober-/Unterschale', [['same', 'Gleich'], ['asym', 'Asymmetrisch (oben/unten)']],
      () => c.sheetSides || 'same', v => { c.sheetSides = v; buildSidebar(); render(); });
    if ((c.sheetMode || 'global') === 'segment') {
      hint(g.body, 'Segmentweise aktiv: Die Beplankungsdicke wird je Segment in der Segmentkarte '
        + '(Wurzel- und Außenrippe) eingegeben.');
    } else if ((c.sheetSides || 'same') === 'asym') {
      numRow(g.body, 'Beplankung oben (mm)', () => c.sheetTop, v => c.sheetTop = Math.max(0, v), { step: 0.1, min: 0 });
      numRow(g.body, 'Beplankung unten (mm)', () => c.sheetBot, v => c.sheetBot = Math.max(0, v), { step: 0.1, min: 0 });
    } else {
      numRow(g.body, 'Beplankungsdicke (mm)', () => c.sheeting, v => c.sheeting = Math.max(0, v), { step: 0.1, min: 0 });
    }
    return g;
  }

  /* Beplankungs-Eingabefelder einer Segmentkarte (nur bei sheetMode='segment').
   * Wurzel-/Außenrippe, bei sheetSides='asym' zusätzlich oben/unten getrennt.
   * Platzhalter (leeres Feld) = globalen Wert erben. */
  function segmentSheetRows(box, seg) {
    if ((state.cfg.sheetMode || 'global') !== 'segment') return;
    subhead(box, 'Beplankung (Schalendicke)');
    const asym = state.cfg.sheetSides === 'asym';
    // Leeres Feld -> null (erbt globalen Wert). numRow kann kein leer/NaN setzen,
    // daher hier ein eigener kleiner Zeilenbauer mit Platzhalter.
    const shRow = (label, get, set) => {
      const row = document.createElement('div'); row.className = 'row';
      const l = document.createElement('label'); l.textContent = T(label);
      const i = document.createElement('input'); i.type = 'text'; i.inputMode = 'decimal';
      const cur = get(); i.value = (cur == null ? '' : cur);
      i.placeholder = T('global');
      i.oninput = () => { const s = i.value.trim(); set(s === '' ? null : Math.max(0, parseNum(s) || 0)); render(); };
      row.appendChild(l); row.appendChild(wrapWithSpinner(i, { step: 0.1, min: 0 })); box.appendChild(row);
    };
    if (asym) {
      shRow('Wurzel oben (mm)', () => seg.sheetRootTop, v => seg.sheetRootTop = v);
      shRow('Wurzel unten (mm)', () => seg.sheetRootBot, v => seg.sheetRootBot = v);
      shRow('Außen oben (mm)', () => seg.sheetTipTop, v => seg.sheetTipTop = v);
      shRow('Außen unten (mm)', () => seg.sheetTipBot, v => seg.sheetTipBot = v);
    } else {
      shRow('Wurzel (mm)', () => seg.sheetRoot, v => seg.sheetRoot = v);
      shRow('Außen (mm)', () => seg.sheetTip, v => seg.sheetTip = v);
    }
  }

  function buildSidebar() {
    App.inheritRootExtensions();   // Wurzelwerte ab Segment 2 vom Vorsegment übernehmen
    // Berechnete Scharnier-Pfeilung aktuell halten, damit die (schreibgeschützten)
    // Sweep-Anzeigen mit dem gezeichneten Grundriss übereinstimmen.
    if (state.cfg.hingeAlign) state._hingeSweeps = App.computeHingeSweeps(state);
    const side = document.getElementById('side'); side.innerHTML = '';
    App.syncAutoFeed();   // Vorschub automatisch (= „Vorschub schnell" des Werkstoffs) in alle Vorschubfelder

    // Tragflächen-Auswahl (wings.js) — die Verwaltung liegt im Reiter „Projektübersicht" (overview.js).
    if (App.wingSidebar) App.wingSidebar(side);

    // --- Reiter „Tragflächendesigner" (wing) --------------------------
    // Import externer Tragflächen liegt jetzt im Kopfzeilen-Menü „Tragfläche
    // importieren" (oben links) — nicht mehr als Sidebar-Gruppe.
    const sg = grp(T('Segmente') + ' (' + state.segments.length + ')', true, 'wing');
    hint(sg.body, 'Segment im Grundriss anklicken zum Aktivieren – oder auf die Kopfzeile tippen. Nur das aktive Segment ist aufgeklappt.');
    state.segments.forEach((s, i) => sg.body.appendChild(segmentShapeCard(s, i)));
    // „Segment hinzufügen" jetzt im Menü „Segmente" (unten), statt als eigener Block.
    const add = document.createElement('button'); add.textContent = T('+ Segment hinzufügen');
    add.className = 'primary'; add.onclick = App.addSeg; sg.body.appendChild(add);
    side.appendChild(sg.g);

    // Beplankung (Schalendicke) — global oder segmentweise, symmetrisch/asymmetrisch.
    side.appendChild(sheetingGroup().g);

    // Holmausschnitte (global, segmentübergreifend) — eigenes Menü.
    const hg = grp(T('Holmausschnitte') + ' (' + (state.spars ? state.spars.length : 0) + ')', true, 'wing');
    sparEditor(hg.body);
    side.appendChild(hg.g);

    const gf = grp('Anzahl Profilpunkte', true, 'wing');
    numRow(gf.body, 'Profil Punkteanzahl', () => state.cfg.points, v => state.cfg.points = v,
      { int: true, min: 40, max: 400, hint: 'Anzahl der Stützpunkte, mit denen jedes Profil (und damit die '
        + 'Schnittbahn) abgetastet wird. Mehr Punkte = feinere Kontur, aber längerer G-Code. 120–200 sind üblich.' });
    hint(gf.body, 'Der Drehpunkt der Schränkung (Washout) wird jetzt je Profil im '
      + 'Tragflächendesigner eingestellt (Zeile „Drehpunkt Schränkung") — nicht mehr global.');
    side.appendChild(gf.g);

    // --- Reiter „Kernschneiden" (core) --------------------------------
    const sc = grp('Blockgeometrie (je Segment)', true, 'core');
    hint(sc.body, 'Segment im Grundriss anklicken zum Aktivieren – oder auf die Kopfzeile tippen. Nur das aktive Segment ist aufgeklappt.');
    state.segments.forEach((s, i) => sc.body.appendChild(segmentCutCard(s, i)));
    side.appendChild(sc.g);

    const gl = grp('Abbrand', true, 'core');
    kerfModeRow(gl.body, 'core');
    // Beplankung wird ausschließlich im Reiter „Tragflächendesigner" gepflegt,
    // um Doppel-Eingaben zu vermeiden.
    selectRow(gl.body, 'Abbrand zulasten der Schale',
      [['sym', 'Beide (symmetrisch)'], ['top', 'Oberschale exakt'], ['bottom', 'Unterschale exakt']],
      () => state.cfg.kerfDatum, v => { state.cfg.kerfDatum = v; render(); },
      'Der Kern bleibt IMMER auf Nennmaß — der Abbrand geht nie zulasten des Kerns, nur der Schalen. '
      + '„Beide": symmetrisch, der Verlust teilt sich auf Ober- und Unterschale. '
      + '„Oberschale exakt": der Schnitt wird so verschoben, dass die Oberschale auf der Nennkontur '
      + 'liegt (an allen Fügestellen gleich hoch, Abbrand-unabhängig) — der Verlust geht auf die Unterschale. '
      + '„Unterschale exakt": spiegelbildlich. Nur eine Schalenseite kann exakt passen.');
    hint(gl.body, 'V-Form ist immer in den Schnitt eingerechnet: Der Block liegt waagrecht, das Werkstück wird schräg herausgeschnitten. Die V-Form ändert damit den G-Code.');
    side.appendChild(gl.g);

    // --- Schalenschnitte (trapezkompensierte Horizontalschnitte) -------
    const shc = grp('Schalenschnitte', true, 'core');
    boolRow(shc.body, 'Ober-/Unterschale schneiden (Trapez)', () => state.cfg.shellCut,
      v => { state.cfg.shellCut = v; buildSidebar(); render(); },
      'Zwei horizontale Trennschnitte: Oberschale VOR, Unterschale NACH dem Kernschnitt. '
      + 'Der Draht läuft von vorne betrachtet als leichtes Trapez (Keil = k_t − k_r), um den '
      + 'höheren Abbrand an der Außenrippe UND den bei „Kern exakt" zulasten der Schale gehenden '
      + 'Kern-Abbrand auszugleichen. Wirkt nur auf den Kern-G-Code.');
    if (state.cfg.shellCut) {
      numRow(shc.body, 'Schalendicke oben (mm)', () => state.cfg.shellTop,
        v => state.cfg.shellTop = Math.max(0, v),
        { step: 1, min: 0, hint: 'Dicke der Oberschale ab Blockoberkante (vor dem Kernschnitt getrennt).' });
      numRow(shc.body, 'Schalendicke unten (mm)', () => state.cfg.shellBot,
        v => state.cfg.shellBot = Math.max(0, v),
        { step: 1, min: 0, hint: 'Dicke der Unterschale ab Blockunterkante (nach dem Kernschnitt getrennt).' });
      hint(shc.body, 'Trapez-Keil (Rand − Wurzel) = k_t − k_r aus dem Abbrand je Rippe (cutKerf). '
        + 'Blockhöhe muss beide Schalen + Kern fassen.');
    }
    side.appendChild(shc.g);
    if (App.kernTeileSidebar) App.kernTeileSidebar(side);   // Kern zerteilen (Stege) + Schale erhalten

    // --- Profilhöhenausrichtung (V-Form) ------------------------------
    const al = grp('Profilhöhenausrichtung', true, 'wing');
    const alc = state.cfg.align;
    boolRow(al.body, 'Profile global ausrichten', () => alc.enable,
      v => { alc.enable = v; buildSidebar(); App.recompute(); render(); },
      'Richtet ALLE Profile der Tragfläche an einem gemeinsamen Merkmal in der Höhe aus '
      + 'und legt darüber die V-Form (je Segmentgruppe eine Gerade). Solange aktiv, wird die '
      + 'V-Form der einzelnen Segmente nicht verwendet — sie folgt dieser Ausrichtung.');
    if (alc.enable) {
      selectRow(al.body, 'Ausrichten an',
        [['top', 'Höchstem Punkt'], ['chord', 'Profilsehne'], ['bottom', 'Unterstem Punkt'], ['hinge', 'Scharnierlinie']],
        () => alc.ref, v => { alc.ref = v; App.recompute(); render(); },
        'Merkmal, an dem alle Profile auf gleiche Höhe gebracht werden (V-Form = 0): '
        + '„Höchster/Unterster Punkt" = Profiloberkante bzw. -unterkante; „Profilsehne" = '
        + 'Sehne am Twist-Bezugspunkt; „Scharnierlinie" = die je Segment definierte '
        + 'Scharnierlinie (Seite + % der Sehne).');
      const segs = state.segments;
      // 1) Gruppengrenzen: je Segment ab dem 2. eine V-Form-Grenze setzbar.
      if (segs.length > 1) {
        subhead(al.body, 'Gruppengrenzen');
        hint(al.body, 'Legt fest, wo die V-Linie abknickt. Ohne Grenze läuft sie über den '
          + 'Stoß hinweg als Gerade weiter.');
        for (let k = 1; k < segs.length; k++) (kk => {
          boolRow(al.body, T('Neue Gruppe ab Segment ') + (kk + 1), () => segs[kk].alignGroupStart,
            v => { segs[kk].alignGroupStart = v; buildSidebar(); App.recompute(); render(); });
        })(k);
      }
      // 2) Gruppen-Ranges bilden. Gruppe 1 nutzt die globalen Werte (alc.dih/
      // alc.dihMode), weitere Gruppen ihre eigenen (seg.alignDih/alignDihMode).
      const groups = [];
      segs.forEach((s, i) => {
        if (i === 0 || s.alignGroupStart) groups.push({ start: i, end: i });
        else groups[groups.length - 1].end = i;
      });
      groups.forEach((gr, gi) => {
        const seg = segs[gr.start];
        const rng = gr.start === gr.end ? ('Segment ' + (gr.start + 1))
          : (T('Segmente ') + (gr.start + 1) + '–' + (gr.end + 1));
        subhead(al.body, T('Gruppe ') + (gi + 1) + ' · ' + rng);
        const getMode = () => gi === 0 ? alc.dihMode : (seg.alignDihMode || 'mm');
        selectRow(al.body, 'V-Form als', [['mm', 'Höhe Randbogen (mm)'], ['deg', 'Winkel (°)']],
          getMode, v => { if (gi === 0) alc.dihMode = v; else seg.alignDihMode = v; buildSidebar(); App.recompute(); render(); });
        const mode = getMode();
        numRow(al.body, mode === 'deg'
            ? (gi === 0 ? 'V-Winkel (°)' : 'Winkel zur Vorgruppe (°)')
            : 'Höhe Randbogen der Gruppe (mm)',
          () => gi === 0 ? alc.dih : seg.alignDih,
          v => { if (gi === 0) alc.dih = v; else seg.alignDih = v; App.recompute(); render(); },
          { step: mode === 'deg' ? 0.5 : 1,
            hint: mode === 'deg'
              ? (gi === 0 ? 'V-Winkel dieser Gruppe (Wurzel = 0°).'
                          : 'Winkel zwischen der V-Linie dieser Gruppe und der Vorgruppe.')
              : 'Höhenanstieg der V-Linie über die Spannweite dieser Gruppe.' });
      });
    }
    hint(al.body, 'Wirkt auf Vorschau UND G-Code (V-Form ist immer in den Schnitt eingerechnet).');
    side.appendChild(al.g);

    // --- Fläche kippen (globale V-Form, Drehung um die Wurzel) -----------------------
    const gvf = grp('Fläche kippen', true, 'wing');
    numRow(gvf.body, 'Fläche kippen (°)', () => state.cfg.globalDih || 0,
      v => { state.cfg.globalDih = v; App.recompute(); render(); }, { step: 0.5, hint:
      'Dreht die GESAMTE Tragfläche um die Wurzelrippe nach oben (positiv) bzw. unten (negativ). '
      + 'Die V-Form der Segmente zueinander (Knicke) bleibt unverändert — der Wert kommt einfach obendrauf. '
      + 'Wirkt auf Vorschau UND G-Code.' });
    side.appendChild(gvf.g);

    // --- Globale Pfeilung (Draufsicht) --------------------------------
    const refName = { hinge: 'Scharnierlinie', le: 'Nasenleiste', te: 'Endleiste' };
    const rN = refName[state.cfg.sweepRef] || 'Scharnierlinie';
    const rn = rN.toLowerCase();
    // Bezugslinie übersetzt (EN mitten im Satz klein).
    const rNt = (window.I18N && window.I18N.getLang() === 'en') ? T(rN).toLowerCase() : rN;
    const hgp = grp('Globale Pfeilung', true, 'wing');
    boolRow(hgp.body, 'Globale Pfeilung', () => state.cfg.hingeAlign,
      v => { state.cfg.hingeAlign = v; buildSidebar(); App.recompute(); render(); },
      'Richtet die Tragfläche in der Draufsicht so aus, dass eine wählbare Bezugslinie '
      + '(Scharnierlinie, Nasenleiste oder Endleiste) je Segmentgruppe eine GERADE bildet. '
      + 'Der LE-Versatz (Rückpfeilung) je Segment wird dann berechnet — die manuellen '
      + 'Sweep-Felder sind deaktiviert.');
    if (state.cfg.hingeAlign) {
      const segs = state.segments;
      // Bezugslinie der Pfeilung: Scharnierlinie / Nasenleiste / Endleiste.
      selectRow(hgp.body, 'Ausrichten an',
        [['hinge', 'Scharnierlinie'], ['le', 'Nasenleiste'], ['te', 'Endleiste']],
        () => state.cfg.sweepRef, v => { state.cfg.sweepRef = v; buildSidebar(); App.recompute(); render(); },
        'Welche Linie je Gruppe gerade laufen soll: „Scharnierlinie" (Seite + % von hinten je '
        + 'Segment), „Nasenleiste" (LE) oder „Endleiste" (TE).');
      // 1) Gruppengrenzen: je Segment ab dem 2. eine Grenze setzbar. Segment 1
      // startet immer Gruppe 1.
      if (segs.length > 1) {
        subhead(hgp.body, 'Gruppengrenzen');
        hint(hgp.body, T('Legt fest, wo die ') + rNt + T(' abknickt. Ohne Grenze läuft die Gerade über den Stoß hinweg weiter.'));
        for (let k = 1; k < segs.length; k++) (kk => {
          boolRow(hgp.body, T('Neue Gruppe ab Segment ') + (kk + 1), () => segs[kk].hingeGroupStart,
            v => { segs[kk].hingeGroupStart = v; buildSidebar(); App.recompute(); render(); });
        })(k);
      }
      // 2) Gruppen-Ranges bilden und je Gruppe Pfeilung (Modus + Wert) anbieten.
      const groups = [];
      segs.forEach((s, i) => {
        if (i === 0 || s.hingeGroupStart) groups.push({ start: i, end: i });
        else groups[groups.length - 1].end = i;
      });
      groups.forEach((gr, gi) => {
        const seg = segs[gr.start];
        const rng = gr.start === gr.end ? ('Segment ' + (gr.start + 1))
          : (T('Segmente ') + (gr.start + 1) + '–' + (gr.end + 1));
        subhead(hgp.body, T('Gruppe ') + (gi + 1) + ' · ' + rng);
        selectRow(hgp.body, 'Pfeilung als', [['deg', 'Winkel (°)'], ['mm', 'x-Versatz (mm)']],
          () => seg.hingeSweepMode, v => { seg.hingeSweepMode = v; buildSidebar(); App.recompute(); render(); });
        numRow(hgp.body, seg.hingeSweepMode === 'mm'
            ? (T('x-Versatz ') + rNt + ' (mm)')
            : (gi === 0 ? (T('Pfeilwinkel ') + rNt + ' (°)') : 'Winkel zur Vorgruppe (°)'),
          () => seg.hingeSweep, v => { seg.hingeSweep = v; },
          { step: seg.hingeSweepMode === 'mm' ? 1 : 0.5,
            hint: seg.hingeSweepMode === 'mm'
              ? (T('x-Versatz der ') + rNt + T(' über die Spannweite dieser Gruppe (positiv = Rückpfeilung).'))
              : (gi === 0
                ? (T('Pfeilwinkel der ') + rNt + T(' gegenüber der Spannweiten-Senkrechten (positiv = zurück).'))
                : (T('Winkel zwischen der ') + (rNt === rN ? rn : rNt) + T('-Geraden dieser Gruppe und der Vorgruppe.'))) });
      });
      if (state.cfg.sweepRef === 'hinge')
        hint(hgp.body, 'Wo die Gerade liegt, steuert die Scharnierlinie (Seite + % von hinten) je Segment.');
    }
    side.appendChild(hgp.g);

    // --- Eigenes Menü „Spiegeln & Stapeln" ----------------------------
    const sp = grp('Spiegeln & Stapeln', true, 'core');
    boolRow(sp.body, 'Kopfüber schneiden (Unterseite oben)', () => state.cfg.flipY,
      v => { state.cfg.flipY = v; App.recompute(); render(); },
      'Spiegelt das gesamte Werkstück horizontal: Die Profilunterseite liegt oben. '
      + 'Die V-Form wird mitgespiegelt (aus V wird Λ). Wirkt auf Vorschau UND G-Code — '
      + 'praktisch, wenn die Fläche mit der flachen Seite nach oben aufgebaut/geschnitten werden soll.');
    numRow(sp.body, 'Übereinander stapeln (Anzahl)', () => state.cfg.stackCount,
      v => { state.cfg.stackCount = Math.max(1, Math.round(v)); buildSidebar(); render(); },
      { step: 1, min: 1, hint: 'Vervielfältigt den Kern übereinander im Block (1 = aus). Der Stapel wächst nur nach OBEN: '
        + 'die unterste Kopie bleibt auf der Originalhöhe, nichts rückt ins Negative. Der Draht schneidet '
        + 'alle Kopien in EINEM durchgehenden Weg — der Block muss entsprechend höher sein (Werkstoffhöhe erhöhen).' });
    if (state.cfg.stackCount > 1) {
      numRow(sp.body, 'Stapelabstand (mm)', () => state.cfg.stackGap,
        v => { state.cfg.stackGap = Math.max(0, v); render(); },
        { step: 1, min: 0, hint: 'Vertikaler Abstand zwischen zwei gestapelten Kernen.' });
      boolRow(sp.body, 'Stapel-Unterkante fest über Blockunterkante', () => state.cfg.stackBaseOn,
        v => { state.cfg.stackBaseOn = v; buildSidebar(); render(); },
        'Setzt die Unterkante des ganzen Stapels auf eine feste Höhe über der Blockunterkante '
        + '(Maschinen-Nullpunkt Y=0) — unabhängig vom Tragflächendesign. Aus = relative Verschiebung.');
      if (state.cfg.stackBaseOn) {
        numRow(sp.body, 'Höhe Stapel-Unterkante über Blockunterkante (mm)', () => state.cfg.stackBase,
          v => { state.cfg.stackBase = Math.max(0, v); render(); },
          { step: 1, min: 0, hint: 'Der tiefste Punkt der untersten Kopie liegt genau so viele mm über der '
            + 'Blockunterkante (Y=0). Nie negativ.' });
      } else {
        numRow(sp.body, 'Stapel vertikal verschieben (mm)', () => state.cfg.stackOffset,
          v => { state.cfg.stackOffset = v; render(); },
          { step: 1, hint: 'Verschiebt den GESAMTEN Stapel nach oben (+) oder unten (−) im Block — '
            + 'zum Zentrieren des Stapels in der Blockhöhe.' });
      }
      boolRow(sp.body, 'Abwechselnd spiegeln', () => state.cfg.stackMirror,
        v => { state.cfg.stackMirror = v; render(); },
        'Jede zweite Kopie wird um ihre Mitte gespiegelt (Unterseite oben). '
        + 'So nesten benachbarte Kerne ineinander (weniger Verschnitt) bzw. es entsteht ein '
        + 'Paar links/rechts. Aus = alle Kopien gleich orientiert.');
    }
    hint(sp.body, 'Stapeln wirkt auf Schnittspur (Vorschau) UND G-Code. Kontrolliere die '
      + 'Blockhöhe: Der Stapel darf nicht über den Werkstoffblock hinausragen.');
    side.appendChild(sp.g);

    App.ptEditMenu(side, 'core');   // Punkte-Editor (Kerndesign)

    // Eigenes Menü im Kerndesign für die Holmausschnitte im Schnitt/G-Code.
    const hgc = grp('Holmausschnitte', true, 'core');
    boolRow(hgc.body, 'Holme schneiden (G-Code)', () => state.cfg.sparCut,
      v => { state.cfg.sparCut = v; buildSidebar(); render(); },
      'Rechnet die Holmausschnitte in den Schnittpfad ein: Der Draht sticht am gewählten '
      + 'Anfahrweg (oben/unten, kürzester Weg) über einen schmalen Schlitz in die Tasche, umfährt '
      + 'sie einmal und fährt über denselben Schlitz zurück. Wurzel- und Außenbahn laufen synchron. '
      + 'Holme, die eine Profiloberfläche erreichen (durchgehender Schnitt), werden dabei übersprungen.');
    if (state.cfg.sparCut) {
      // „Während des Schnitts" nur zulassen, wenn ALLE Holme proportional liegen
      // (gleicher Sehnenanteil an Wurzel und Rand). Sonst würde das synchrone
      // Einrechnen die Profilkontur verfälschen -> nur „nach"/„nur" anbieten.
      // Nicht proportionale Holme (verschiedener Sehnenanteil an Wurzel/Rand) sind
      // auch „während des Schnitts" möglich: Abzweig an einem gemeinsamen Bahnpunkt,
      // die zweite Rippe fährt senkrecht in den Kern und quer zum Holm (applySparCuts).
      // Nur Taschen (Gurt ohne Steg) bleiben auf proportionale Lage beschränkt.
      const skewPockets = (state.spars || []).map((sp, i) => ({ i, sk: App.pocketSkewInfo(sp) })).filter(o => o.sk);
      App.migrateSparModes();
      boolRow(hgc.body, 'Nur Holmausschnitte (kein Profilschnitt)', () => !!state.cfg.sparOnly,
        v => { state.cfg.sparOnly = v; buildSidebar(); render(); },
        'Es werden ausschließlich die Holmausschnitte geschnitten (kein Profil- und kein Blockschnitt), '
        + 'jeder von oben angefahren. Gurttaschen (Tasche / Tasche + Steg) sind Teil des Profilschnitts und '
        + 'entfallen dabei.');
      // Schnittzeitpunkt JE LOCH-HOLM. Gurttaschen haben keine Wahl (immer in der Profilbahn).
      const modeOpts = [['during', 'Während des Schnitts'], ['after', 'Nach dem Schnitt (Pause)'], ['afterTop', 'Nach Oberseitenschnitt (Pause)']];
      const modeHelp = '„Während des Schnitts": die Holmtasche wird in den Profil-Schnittpfad eingerechnet (Draht '
        + 'sticht auf der Kontur ein). „Nach dem Schnitt (Pause)": erst das ganze Profil, dann ein Halt (M0) '
        + '— nach „Fortsetzen" wird die Tasche separat von oben angefahren. „Nach Oberseitenschnitt (Pause)": '
        + 'erst die Profil-OBERSEITE bis zur Nasenverlängerung, Pause (M0), dann die Tasche von oben, zurück '
        + 'zur Nase, Pause (M0), dann die UNTERSEITE — der Draht durchtrennt so beim Holmschnitt nicht die noch '
        + 'volle Unterseite. Bei „nach dem Schnitt" und „nach Oberseitenschnitt" wird die Tasche immer von OBEN '
        + 'angefahren (Stapeln bleibt unberücksichtigt). Jeder Holm wird einzeln eingestellt; Gurttaschen '
        + '(Tasche / Tasche + Steg) sind immer Teil des Profilschnitts.';
      if (!state.cfg.sparOnly) (state.spars || []).forEach((sp, i) => {
        if (App.isPocket(sp)) return;
        selectRow(hgc.body, 'Holm ' + (i + 1) + ' · Schnitt', modeOpts,
          () => App.sparModeOf(sp), v => { sp.cutMode = v; render(); }, modeHelp);
      });
      if (state.cfg.cutDir === 'front' && !state.cfg.sparOnly && (state.spars || []).some(sp => App.sparModeOf(sp) === 'afterTop'))
        hint(hgc.body, 'Schnittrichtung „von vorne": Pause und Holmtaschen folgen, sobald die Oberseite an der '
          + 'Endleiste fertig ist und der Draht hinten auf Sicherheitshöhe steht; danach die Unterseite (wieder von der Nase).');
      if (skewPockets.length && !state.cfg.sparOnly)
        skewPockets.forEach(o => warn(hgc.body, T('Holm ') + (o.i + 1) + T(' (Tasche): Lage nicht proportional (Wurzel ')
          + o.sk.rootPct.toFixed(1) + T(' %, Außen ') + o.sk.tipPct.toFixed(1) + T(' %). Die Profilbahn wird im Taschenbereich '
          + 'abschnittsweise neu abgetastet; der Draht steht dort schräg, Zwischenrippen weichen um bis zu ≈ ')
          + o.sk.devMm.toFixed(1) + T(' mm in Flugrichtung ab.')));
    }
    if (state.cfg.sparCut)
      selectRow(hgc.body, 'Abbrand-Kompensation',
        [['none', 'Ohne Abbrand'], ['in', 'Abbrand innen'], ['out', 'Abbrand außen']],
        () => state.cfg.sparKerfMode, v => { state.cfg.sparKerfMode = v; render(); },
        '„Ohne": Draht fährt auf der Nennkontur der Tasche. „Abbrand innen": Taschenkontur um Abbrand/2 '
        + 'nach INNEN versetzt → die FERTIGE Tasche hat das Nennmaß (Standard). „Abbrand außen": um '
        + 'Abbrand/2 nach AUSSEN → die Tasche wird um den Abbrand größer.');
    if (state.cfg.sparCut && (state.cfg.sparKerfMode || 'none') !== 'none')
      selectRow(hgc.body, 'Abbrand-Bezug (global)',
        [['profile', 'Verhältnis (Profillänge)'], ['local', 'Lokale Geschwindigkeit']],
        () => state.cfg.sparKerfBasis || 'local', v => { state.cfg.sparKerfBasis = v; render(); },
        '„Verhältnis (Profillänge)": der Abbrand wird je Rippe dem PROFIL gleichgesetzt (Wurzel-/Außenwert '
        + 'aus dem Sehnen-/Vorschubverhältnis wie beim Kernschnitt). „Lokale Geschwindigkeit": der Abbrand '
        + 'wird aus der tatsächlichen Draht-Geschwindigkeit BEIM HOLMSCHNITT bestimmt (Verhältnis der '
        + 'Taschenumfänge Wurzel/Außen) — die größere Tasche läuft schneller (schmaler), die kleinere '
        + 'langsamer (breiter). Bei durchgehend gleich großem Holm sind beide Bezüge nahezu identisch. '
        + 'Gilt für alle Holme auf „Global"; einzelne Holme können unten abweichen.');
    // Abbrand je Holm überschreiben (Modus + Bezug). „Global" = obige Einstellung.
    if (state.cfg.sparCut && (state.spars || []).length) {
      subhead(hgc.body, 'Abbrand je Holm');
      (state.spars || []).forEach((sp, k) => {
        selectRow(hgc.body, T('Holm ') + (k + 1) + T(' · Abbrand'),
          [['global', 'Global'], ['none', 'Ohne'], ['in', 'Innen'], ['out', 'Außen']],
          () => sp.kerfMode || 'global', v => { sp.kerfMode = v; buildSidebar(); render(); },
          T('Abbrand-Kompensation nur für Holm ') + (k + 1) + T('. „Global" = obige Einstellung.'));
        if ((sp.kerfMode || 'global') !== 'global' && (sp.kerfMode || 'global') !== 'none')
          selectRow(hgc.body, T('Holm ') + (k + 1) + T(' · Bezug'),
            [['global', 'Global'], ['profile', 'Verhältnis (Profillänge)'], ['local', 'Lokale Geschwindigkeit']],
            () => sp.kerfBasis || 'global', v => { sp.kerfBasis = v; render(); },
            T('Abbrand-Bezug nur für Holm ') + (k + 1) + T('. „Global" = obige Einstellung, „Verhältnis" = wie Profil je Rippe, „Lokale Geschwindigkeit" = Verhältnis der Taschenumfänge beim Holmschnitt.'));
      });
    }
    hint(hgc.body, 'Form, Größe, Lage und Segmentbereich der Holme werden im Reiter '
      + '„Tragflächendesigner → Holmausschnitte" festgelegt.');
    side.appendChild(hgc.g);

    // Eigenständige Gruppe: Werkstück drehen bei starker Pfeilung (sweeprot.js).
    const swr = grp('Werkstück drehen (Pfeilung)', true, 'core');
    boolRow(swr.body, 'Drehung aktiv', () => state.cfg.sweepRot,
      // Profilvergleich öffnet NUR über den Button unten, nicht beim Einschalten.
      v => { state.cfg.sweepRot = v; buildSidebar(); render(); if (!v) closeSweepCmp(); },
      'Dreht das Werkstück um die Hochachse, bis die Bezugslinie parallel zur '
      + 'Drahtachse liegt — so braucht ein stark gepfeiltes Segment deutlich weniger '
      + 'X-Fahrweg. Der Heißdraht schneidet weiter die gleiche Regelfläche; die nötige '
      + 'Profil-„Verzerrung" an den Türmen entsteht automatisch. Wirkt nur auf die '
      + 'Turmbahnen/G-Code, nicht auf das Kerndesign.');
    if (state.cfg.sweepRot) {
      selectRow(swr.body, 'Winkel', [['auto', 'Automatisch (aus Bezugslinie)'], ['manual', 'Fester Winkel']],
        () => state.cfg.sweepRotMode, v => { state.cfg.sweepRotMode = v; buildSidebar(); render(); },
        '„Automatisch": Drehwinkel so, dass die gewählte Bezugslinie (Sehnenanteil) '
        + 'parallel zur Drahtachse liegt (minimaler Versatz). „Fester Winkel": eigener Wert.');
      if (state.cfg.sweepRotMode === 'auto')
        numRow(swr.body, 'Bezugslinie (Sehnenanteil 0–1)', () => state.cfg.sweepRotRef,
          v => { state.cfg.sweepRotRef = Math.max(0, Math.min(1, v)); render(); },
          { step: 0.05, min: 0, max: 1,
            hint: '0 = Nasenleiste, 0,25 = t/4, 1 = Endleiste. Diese Linie wird parallel '
            + 'zur Drahtachse gedreht.' });
      else
        numRow(swr.body, 'Drehwinkel (°)', () => state.cfg.sweepRotAngle,
          v => { state.cfg.sweepRotAngle = v; render(); }, { step: 0.5 });
      const inf = document.createElement('div');
      inf.className = 'hint'; inf.id = 'sweepRotInfo';
      swr.body.appendChild(inf);
      const cmpBtn = document.createElement('button');
      cmpBtn.textContent = T('⬍ Profilvergleich (Original ↔ verzerrt)');
      cmpBtn.onclick = openSweepCmp;
      swr.body.appendChild(cmpBtn);
    }
    hint(swr.body, 'Der Rohblock wird im Grundriss und im 3D-Simulator bereits gedreht '
      + 'dargestellt („wie er wirklich liegt"). Beim Aufspannen den Block real um den '
      + 'angezeigten Winkel drehen; Diagonale/Blocklänge prüfen. Block- und '
      + 'Schalenschnitte werden mitgedreht (Schnitthöhen bleiben drehinvariant).');
    side.appendChild(swr.g);

    // Profilbild: wählbar, welche Segment-Profile überlagert werden (nur im
    // Tragflächendesigner). Aktives Segment ist immer hervorgehoben.
    const ps = grp('Profile anzeigen', true, 'wing core');
    boolRow(ps.body, 'Alle Segmente', () => App.profIsAll(),
      v => { state.cfg.profSegs = v ? state.segments.map((_, i) => i) : []; buildSidebar(); render(); });
    state.segments.forEach((s, i) => {
      boolRow(ps.body, 'Segment ' + (i + 1) + (i === App.activeIdx() ? T(' (aktiv)') : ''),
        () => App.profSet().has(i), v => { App.profToggle(i, v); buildSidebar(); render(); });
    });
    hint(ps.body, 'Leer = nur aktives Segment. Das aktive Segment wird farblich hervorgehoben.');
    side.appendChild(ps.g);

    // Menü-Reihenfolge im Reiter „Tragflächendesigner":
    //   Import · Segmente · Segment hinzufügen ·
    //   Profilhöhenausrichtung · Globale Pfeilung · Holmausschnitte ·
    //   Anzahl Profilpunkte · Profile anzeigen · Anzeige
    // „Globale Pfeilung", „Holmausschnitte" und „Anzahl Profilpunkte" hinter
    // „Profilhöhenausrichtung" (in dieser Reihenfolge, vor „Profile anzeigen").
    side.insertBefore(hgp.g, ps.g);
    side.insertBefore(hg.g, ps.g);
    side.insertBefore(gf.g, ps.g);


    const pv = grp('Quelle Gcode', true, 'gcode');
    const srcOpts = [['core', 'Kerndesign (Profilschnitt)'], ['neg', 'Negativschalendesign']];
    // „DXF-Formen" nur anbieten, wenn die Funktion im Build steckt (dxfshapes.js).
    if (App.dxfGcode) srcOpts.push(['dxf', 'DXF-Formen']);
    if (!App.dxfGcode && state.cfg.gcodeSource === 'dxf') state.cfg.gcodeSource = 'core';
    if (window.Model3D && Model3D.hasModel()) { srcOpts.push(['model', '3D-Modell (Segment)']); srcOpts.push(['plate', '3D-Modell Platte (mehrere)']); }
    if (window.Schrift) srcOpts.push(['schrift', 'Schriften']);
    if (!window.Schrift && state.cfg.gcodeSource === 'schrift') state.cfg.gcodeSource = 'core';
    selectRow(pv.body, 'G-Code-Quelle', srcOpts,
      () => state.cfg.gcodeSource,
      v => { state.cfg.gcodeSource = v; if (v !== 'model') state.cfg.gcodeSourceLast = v; buildSidebar(); render(); },
      App.autoGen
        ? 'Woraus der G-Code erzeugt wird: aus dem Kerndesigner (Profil-/Kernschnitt), '
          + 'aus dem Negativschalendesign (Formhälften-Kavität), aus den DXF-Formen (INNEN/AUSSEN) '
          + 'oder aus einem Segment des 3D-Modells.'
        : 'Diese Ausgabe erzeugt keinen G-Code. Die Quelle legt nur fest, welcher Block (Tragfläche, '
          + 'Negativschale, DXF-Form, 3D-Modell) in der Simulation zu einer geladenen G-Code-Datei gezeigt wird.');
    if (!App.autoGen)
      hint(pv.body, 'G-Code-Datei laden: Knopf „G-Code laden…" unter der Simulation. Sie wird abgespielt und auf Maschinengrenzen geprüft.');
    // Tragflächenwahl direkt unter der Quelle (statt eigenem Block): nur für die
    // tragflächenbasierten Quellen Kern-/Negativschalendesign relevant.
    if (App.wingSelectEl && (state.cfg.gcodeSource === 'core' || state.cfg.gcodeSource === 'neg')) {
      const row = document.createElement('div'); row.className = 'row';
      const l = document.createElement('label'); l.textContent = T('Tragfläche');
      const sel = App.wingSelectEl(); sel.style.cssText = '';
      row.appendChild(l); row.appendChild(sel); pv.body.appendChild(row);
    }
    if (state.cfg.gcodeSource === 'model' && window.Model3D && Model3D.hasModel()) {
      // Alle Modell-Segmente wählbar.
      const nseg = Model3D.segCount(); const cc = mgCfg();
      if (cc.seg >= nseg) cc.seg = 0;
      const opts = [];
      for (let i = 0; i < nseg; i++) opts.push([String(i), T('Segment ') + (i + 1) + ' / ' + nseg]);
      selectRow(pv.body, 'Modell-Segment', opts, () => String(cc.seg),
        v => { cc.seg = +v; render(); if (window.Model3D) Model3D.refresh(); },
        'Wählt das Segment des 3D-Modells, dessen Schnitt erzeugt wird.');
    } else if (state.cfg.gcodeSource === 'dxf' && App.dxfEnsureModel) {
      // DXF-Formen: eigene Segmentkette (state.dxf.segs), nicht die Tragflächen-Segmente.
      App.dxfEnsureModel();
      const d = state.dxf, nseg = App.dxfSegCount ? App.dxfSegCount() : 1;
      const opts = [];
      for (let i = 0; i < nseg; i++) {
        const ri = d.ribs[2 * i], ro = d.ribs[2 * i + 1];
        opts.push([String(i), T('Segment ') + (i + 1) + ' / ' + nseg + '  ·  ' + (ri ? ri.layer : '—') + ' → ' + (ro ? ro.layer : '—')]);
      }
      selectRow(pv.body, 'DXF-Segment', opts, () => String(d.activeSeg || 0),
        v => { App.dxfSetActive(+v); buildSidebar(); if (App.renderDxf) App.renderDxf(); render(); },
        'Wählt das DXF-Formen-Segment, dessen Schnitt erzeugt wird (gleiche Auswahl wie im Reiter „DXF-Formen").');
    } else if (state.cfg.gcodeSource === 'schrift') {
      hint(pv.body, 'Text, Schriftart, Verbindung und Block stellt der Reiter „Schriften" ein.');
    } else {
      pv.body.appendChild(segmentSelectRow());
    }
    side.appendChild(pv.g);

    // --- Reiter „Negativschalendesign" (neg) --------------------------
    const ng = grp('Negativschale', true, 'neg');
    hint(ng.body, 'Querschnitt der Negativschale (Formhälften) — auf Basis des Wingdesigns, '
      + 'analog zur DXF-Vorlage. Ober- und Unterseite des Profils werden auseinandergezogen; '
      + 'der Block umschließt sie mit Überstand vorne/hinten.');

    subhead(ng.body, 'Segment');
    ng.body.appendChild(segmentSelectRow());

    subhead(ng.body, 'Formmaße und Schnittüberstände');
    numRow(ng.body, 'Formblockhöhe (mm)', () => state.cfg.negBlockH,
      v => { state.cfg.negBlockH = v; renderNeg(); }, { min: 1, norender: true,
      hint: 'Höhe des gesamten Blockes (Y). Die Blockmitte ist für ALLE Segmente dieselbe '
        + '(Mitte zwischen tiefster und höchster Rippe) — nur so passen die Schalen an den '
        + 'Segmentstößen zusammen. Der Block muss deshalb die V-Form der ganzen Tragfläche fassen.' });
    numRow(ng.body, 'Tragfläche im Formblock heben/senken (mm)', () => state.cfg.negProfShift,
      v => { state.cfg.negProfShift = v; render(); }, { norender: true,
      hint: 'Verschiebt die Tragfläche (samt V-Form-Versatz) und damit die Trennebene der Höhe nach '
        + 'im Formblock. Positiv = nach oben (obere Formhälfte dünner, untere dicker), '
        + 'negativ = nach unten, 0 = V-Form-Spanne mittig. Gilt für ALLE Segmente gemeinsam, damit die Schalen an den '
        + 'Segmentstößen zusammenpassen. Die Höhe der Formhälften an der Nase zeigt die Legende. '
        + 'Die Lage des Formblocks im Werkstoff stellt das nächste Feld ein.' });
    numRow(ng.body, 'Formblock im Werkstoff heben/senken (mm)', () => state.cfg.negMatShift,
      v => { state.cfg.negMatShift = v; render(); }, { norender: true,
      hint: 'Verschiebt den gesamten Formblock (beide Schalen) der Höhe nach im Werkstoff-Block '
        + '(Höhe aus dem Reiter „Projektübersicht") — für alle Segmente gemeinsam. Positiv = nach oben, '
        + 'negativ = nach unten, 0 = mittig. Der G-Code-Nullpunkt (Y) liegt an der Werkstoff-Unterkante.' });
    const negDirect = state.cfg.negCutPath === 'direct';
    selectRow(ng.body, 'Schneideweg',
      [['precut', 'Schnittverlängerung + Randvorschnitte (mit Freifahren)'],
       ['direct', 'Konstanter Schalenüberstand, ein Zug (ohne Freifahren)']],
      () => negDirect ? 'direct' : 'precut',
      v => { state.cfg.negCutPath = v; buildSidebar(); },
      '„Schnittverlängerung + Randvorschnitte": Block mit proportionaler Schnittverlängerung vorne/hinten, der '
      + 'konstante Schalenrand wird vorher als zwei Vertikalschnitte (mit Freifahren) gefahren. '
      + '„Ein Zug": KEINE Schnittverlängerung und keine Vertikalschnitte zu Beginn — der Block endet genau auf dem '
      + 'konstanten Schalenüberstand. Start hinten oben, oben nach vorne, runter auf Nasenhöhe, waagrecht (Überstand) '
      + 'auf die Nase, Profil, … alles in einem durchgehenden Schnitt.');
    if (!negDirect) {
      numRow(ng.body, 'Schnittverlängerung vorne / Nase (mm)', () => state.cfg.negOvF,
        v => { state.cfg.negOvF = v; render(); }, { min: 0, norender: true,
        hint: 'Schnittverlängerung vor der Profilnase (LE) — vorgegeben für die Wurzel. '
          + 'Rand/andere Rippen skalieren proportional zur Profillänge (konstante Draht-Geschwindigkeit).' });
      numRow(ng.body, 'Schnittverlängerung hinten / Endleiste (mm)', () => state.cfg.negOvR,
        v => { state.cfg.negOvR = v; render(); }, { min: 0, norender: true,
        hint: 'Schnittverlängerung hinter der Endleiste (TE) — vorgegeben für die Wurzel, '
          + 'Rand proportional zur Profillänge. So bleibt die Draht-Geschwindigkeit konstant und die '
          + 'einfache Abbrand-Kompensation (Sehnenverhältnis) ist exakt.' });
    }
    numRow(ng.body, 'Überstand Schalenrand konstant (mm)', () => state.cfg.negShellEdge,
      v => { state.cfg.negShellEdge = v; render(); }, { min: 0, norender: true,
      hint: negDirect
        ? 'KONSTANTER Überstand der Schalen vor der Nase und hinter der Endleiste (Wurzel und Rand gleich). '
          + 'Im Schneideweg „ein Zug" liegen Blockvorder- und -hinterkante genau hier — der Umriss schneidet die '
          + 'Schalenränder selbst, ohne Vorschnitte. Tipp: Abbrand „Aus Bahngeschwindigkeit" rechnet die '
          + 'nicht proportionalen Überstände genauer.'
        : 'KONSTANTER Referenz-Überstand der Schalen (ab Nase/Endleiste). Wird VOR dem '
          + 'Profilschnitt als zwei planare Vertikalschnitte gefahren (wie der Blockschnitt beim Kern) '
          + '— dient als konstante Referenzkante beim späteren Bauen. Bezug ist der Werkstoff: die Schnitte gehen '
          + 'immer vertikal durch den ganzen Werkstoff-Block. 0 = aus. Sollte ≤ Überstand vorne/hinten sein.' });

    subhead(ng.body, 'Schalentrennung');
    selectRow(ng.body, 'Schnittverlauf an der Endleiste',
      [['horizontal', 'Waagrecht'], ['skeleton', 'Verlängerung der Skelettlinie']],
      () => (state.cfg.negTeStyle === 'chord' ? 'skeleton' : state.cfg.negTeStyle) || 'horizontal',
      v => { state.cfg.negTeStyle = v; render(); },
      'Wie die Schnitte an der Endleiste zur Block-Hinterkante laufen: „Waagrecht" = exakt horizontal (Standard). „Verlängerung der Skelettlinie" = gerade in Richtung der Skelettlinien-Tangente an der Endleiste fortgesetzt (wie der EL-Steg „Entlang Skelettlinie" im Kerndesign) — die Trennfuge läuft dann knickfrei aus dem Profil heraus, bei gewölbten Profilen also leicht nach unten geneigt. Gilt für beide Schalen, den Kern, die Stege und die Stützstoff-Flächen.');
    numRow(ng.body, 'Ober-/Unterseite auseinanderziehen (mm)', () => state.cfg.negSplit,
      v => { state.cfg.negSplit = v; renderNeg(); }, { min: 0, norender: true,
      hint: 'Abstand, um den Profilober- und -unterseite an Nase und Endleiste '
        + 'vertikal getrennt werden (Ober +½ hoch, Unter −½ runter).' });

    subhead(ng.body, 'Anzeige');
    boolRow(ng.body, 'Schnittspur (Abbrand)', () => state.cfg.showKerf,
      v => { state.cfg.showKerf = v; renderNeg(); },
      'Zeigt den tatsächlichen Drahtweg inkl. Abbrand-Kompensation (Versatz Abbrand/2 nach außen) — '
      + 'der wirksame Abbrand folgt dem Vorschub aus dem Werkstoff-/G-Code-Betriebspunkt.');
    kerfTrueRow(ng.body, 'neg');
    boolRow(ng.body, 'Bemaßung', () => state.cfg.showDim,
      v => { state.cfg.showDim = v; renderNeg(); });
    side.appendChild(ng.g);

    // --- Eigener Menüpunkt „Abbrand" (Negativschale) ------------------
    // Bewusst getrennt vom Kerndesign: die Negativschale hat ihre eigene
    // Abbrand-Berechnungsmethode (negKerfMode) und ihre eigenen Anzeige-Optionen.
    const nk = grp('Abbrand', true, 'neg');
    selectRow(nk.body, 'Abbrand-Berechnung',
      [['ratio', 'Aus Profillängen-Verhältnis'], ['speed', 'Aus Bahngeschwindigkeit (lokal)']],
      () => state.cfg.negKerfMode || 'ratio',
      v => { state.cfg.negKerfMode = v; buildSidebar(); renderNeg(); },
      'Nur für die Negativschale. Verhältnis: ein Abbrand je Rippe aus dem Verhältnis der Profillängen '
      + '(Wurzel/außen). Bahngeschwindigkeit: Abbrand lokal je Schnittsegment aus der tatsächlichen '
      + 'Draht-Geschwindigkeit — genauer bei komplexen Schalenverläufen. Kalibrier-Stützpunkte: Reiter „Projektübersicht".');
    // „Abbrand-Verteilung farbig" nur sinnvoll bei Abbrand aus Bahngeschwindigkeit.
    if ((state.cfg.negKerfMode || 'ratio') === 'speed')
      boolRow(nk.body, 'Abbrand-Verteilung farbig', () => state.cfg.kerfHeat,
        v => { state.cfg.kerfHeat = v; renderNeg(); },
        'Färbt die Schnittspur nach dem lokalen Abbrand ein (blau = schmal, rot = breit) — innen & außen. '
        + 'Nur bei „Bahngeschwindigkeit" (Abbrand variiert entlang der Kontur).');
    side.appendChild(nk.g);

    // Legacy: der entfernte Stützstoff-Modus „Kernschnitt" wird auf „versetzte
    // Flächen" normalisiert (Kern läuft jetzt ausschließlich über „Kern mitschneiden").
    if (state.cfg.negSupportMode === 'core') state.cfg.negSupportMode = 'surface';
    // --- Menü „Kern & Stützstoff" (Negativschale) --------------------
    // Kern und Stützstoff in EINEM Menü zusammengefasst. Der frühere Stützstoff-
    // Modus „Kernschnitt (Nasen-Schlaufe)" entfällt — er war identisch mit
    // „Kern mitschneiden" (Kern-Funktion sonst doppelt). Stützstoff = immer
    // versetzte Flächen; der Kern wird über „Kern mitschneiden" gefahren.
    const kg = grp('Kern & Stützstoff (Negativschale)', true, 'neg');
    boolRow(kg.body, 'Kern mitschneiden', () => state.cfg.negCore,
      v => { state.cfg.negCore = v; buildSidebar(); render(); },
      'Schneidet zusätzlich das Profil als Kern in der Mitte zwischen den beiden Schalen '
      + '(der Spalt „auseinanderziehen" gibt den Freiraum). Als eigener geschlossener Schnitt im G-Code.');
    if (state.cfg.negCore) {
      numRow(kg.body, 'Beplankungsabzug Kern (mm)', () => state.cfg.negCoreSheeting,
        v => { state.cfg.negCoreSheeting = v; render(); }, { step: 0.1, min: 0, norender: true,
        hint: 'Der Kern wird um diesen Betrag nach innen versetzt (Schaumkern unter der Beplankung). 0 = Profil in Nennmaß.' });
      numRow(kg.body, 'Nasen-Schlaufe vertikal (mm)', () => state.cfg.negNoseExt,
        v => { state.cfg.negNoseExt = v; render(); }, { step: 0.5, min: 0, norender: true,
        hint: 'Kleine vertikale Öffnung der Nasen-Schlaufe: 45° schräg, dann '
          + 'horizontal bis zur Blockvorderkante und um diesen Betrag vertikal versetzt zurück.' });
    }
    boolRow(kg.body, 'Stützstoff mitschneiden', () => state.cfg.negSupport,
      v => { state.cfg.negSupport = v; if (v) state.cfg.negSupportMode = 'surface'; buildSidebar(); render(); },
      'Schneidet den Stützstoff-Streifen (versetzte Flächen) für die Schalenbauweise mit — Ober- und '
      + 'Unterschale zusätzlich um die Stützstoffdicke nach INNEN versetzt, an den Blockkanten verbunden. '
      + 'In DIE SCHNITTFOLGE integriert (aus dem Endleisten-Bereich angefahren) — NICHT von außen durch den Block.');
    if (state.cfg.negSupport) {
      numRow(kg.body, 'Abstand zur Schale (mm)', () => state.cfg.negSupportGap,
        v => { state.cfg.negSupportGap = v; render(); }, { step: 0.1, min: 0, norender: true,
        hint: 'Abstand der 1. versetzten Fläche zur Schalenfläche (Spalt zwischen Schale und Stützstoff). 0 = direkt an der Schale.' });
      numRow(kg.body, 'Stützstoffdicke (Abstand der Flächen, mm)', () => state.cfg.negSupportMM,
        v => { state.cfg.negSupportMM = v; render(); }, { step: 0.1, min: 0, norender: true,
        hint: 'Abstand ZWISCHEN den beiden versetzten Flächen = Dicke des Stützstoff-Streifens (Standard 1 mm). '
          + '0 = nur eine versetzte Fläche.' });
    }
    side.appendChild(kg.g);

    if (App.stegeSidebar) App.stegeSidebar(side);   // Kern in Stege zerlegen (nur mit Kern)
    App.ptEditMenu(side, 'neg');   // Punkte-Editor (Negativschalendesign)

    // --- Reiter „Formenbau" (form, optionales Feature) ------------------
    if (App.formSidebar) App.formSidebar(side);

    // --- Reiter „Rumpf" (rumpf, optionales Feature) ---------------------
    if (App.rumpfSidebar) App.rumpfSidebar(side);

    // --- Reiter „Fräse" (fraese, optionales Feature) --------------------
    if (App.fraeseSidebar) App.fraeseSidebar(side);

    // --- Reiter „Schriften" (schrift, optionales Feature) -----------------
    if (App.schriftSidebar) App.schriftSidebar(side);


    // --- Reiter „DXF-Formen" (dxf) ------------------------------------
    // Abwählbare Funktionen: nur aufbauen, wenn das Modul im Build steckt.
    if (App.buildDxfSidebar) App.buildDxfSidebar(side);

    // --- Reiter „DXF-Export" (dxfexport) ------------------------------
    if (App.buildDxfExportSidebar) App.buildDxfExportSidebar(side);

    // --- Reiter „Rippendesigner" (rib) --------------------------------
    if (App.buildRibSidebar) App.buildRibSidebar(side);

    // --- Reiter „Rippenfläche" (rf) -----------------------------------
    if (App.rfSidebar) App.rfSidebar(side);

    // --- Reiter „CAD-Bearbeitung" (cad) -------------------------------
    if (App.buildCadSidebar) App.buildCadSidebar(side);

    // --- Reiter „Werkstoff-Datenbank" (matdb) -------------------------
    // Werkstoffe werden hier mit ALLEN Eigenschaften angelegt/gepflegt —
    // AUSSER der projektbezogenen Dimension (Höhe/Dicke, Sicherheitshöhe),
    // die im Reiter „Projektübersicht" pro Projekt eingegeben wird.
    const mdb = grp('Werkstoff-Datenbank', true, 'matdb', { key: 'matdb' });
    const matOpts = App.matOptions();
    if (matOpts.length) {
      selectRow(mdb.body, 'Werkstoff', matOpts,
        () => state.material.id, v => { state.material.id = v; buildSidebar(); renderMaterial(); render(); });
    } else {
      hint(mdb.body, 'Noch kein Werkstoff angelegt. Es gibt bewusst keine Voreinstellungen — legen Sie Ihren ersten Werkstoff selbst an.');
    }
    // Neuen Werkstoff anlegen (Name frei eingebbar) bzw. aktuellen löschen.
    const matAdmin = document.createElement('div');
    matAdmin.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:4px 0';
    const bNew = document.createElement('button'); bNew.textContent = T('Neuer Werkstoff');
    bNew.onclick = () => {
      App.askText(T('Name des neuen Werkstoffs:'), '').then(nm => {
        if (nm && nm.trim()) { App.addMaterial(nm); buildSidebar(); renderMaterial(); render(); }
      });
    };
    matAdmin.appendChild(bNew);
    if (matOpts.length) {
      const bDel = document.createElement('button'); bDel.textContent = T('Werkstoff löschen');
      bDel.onclick = () => {
        const id = state.material.id;
        if (!id) return;
        if (confirm(T('Werkstoff „') + App.matField(id, 'name', id) + T('" mit allen eigenen Werten löschen?'))) {
          App.delMaterial(id); buildSidebar(); renderMaterial(); render();
        }
      };
      matAdmin.appendChild(bDel);
    }
    mdb.body.appendChild(matAdmin);
    if (matOpts.length && !(state.material.cal && state.material.cal[state.material.id])) {
      const warn = document.createElement('div'); warn.className = 'hint';
      warn.style.cssText = 'color:var(--bad);font-weight:600;margin:2px 0';
      warn.textContent = T('⚠ Nicht kalibriert — Abbrand/Vorschub-Test noch nicht durchgeführt (Reiter „Schneiden" → Abbrand-Kalibrierung).');
      mdb.body.appendChild(warn);
    }

    // Alle Werkstoff-Eigenschaften frei eingebbar. Es gibt keine Voreinstellungen:
    // Name und alle Werte werden komplett selbst eingegeben.
    if (matOpts.length) {
    subhead(mdb.body, 'Eigenschaften (frei eingebbar)');
    hint(mdb.body, 'Name und alle Werte werden selbst eingegeben — es gibt keine Voreinstellungen. Die Dimension (Höhe/Dicke) gehört ins Projekt und wird im Reiter „Projektübersicht" eingegeben.');
    txtRow(mdb.body, 'Name', () => App.matField(state.material.id, 'name', state.material.id),
      v => { App.setMatField('name', v); buildSidebar(); renderMaterial(); saveSettings(); });
    txtRow(mdb.body, 'Kategorie', () => App.matField(state.material.id, 'category', ''),
      v => { App.setMatField('category', v); renderMaterial(); saveSettings(); });
    numRow(mdb.body, 'Rohdichte (kg/m³)', () => App.matField(state.material.id, 'density', 0),
      v => { App.setMatField('density', v); renderMaterial(); saveSettings(); }, { min: 0, norender: true });
    const brm = document.createElement('button'); brm.textContent = T('Eigene Werte zurücksetzen');
    brm.onclick = () => { const nm = App.matField(state.material.id, 'name', state.material.id);
      if (state.material.props) delete state.material.props[state.material.id];
      if (state.material.kerf) delete state.material.kerf[state.material.id];
      if (state.material.feed) delete state.material.feed[state.material.id];
      if (state.material.heat) delete state.material.heat[state.material.id];
      App.setMatField('name', nm);   // Name des Werkstoffs bewahren
      buildSidebar(); renderMaterial(); render(); };
    mdb.body.appendChild(brm);
    }

    // --- Werkstoffdaten exportieren / importieren -------------------------
    // Exportiert/importiert den kompletten Werkstoff-Zustand (alle Overrides,
    // Kalibrierungen, Heizung, Eigenschaften je Werkstoff-ID) als portable
    // JSON-Datei, z. B. um Werkstoffe zwischen Rechnern/Installationen zu teilen.
    subhead(mdb.body, 'Werkstoffdaten sichern');
    hint(mdb.body, 'Exportiert alle Werkstoffe samt eigenen Werten, Abbrand-/Vorschub-Kalibrierung und Heizung als JSON-Datei. Import überschreibt die aktuellen Werkstoffdaten.');
    const matBtns = document.createElement('div');
    matBtns.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    const bmex = document.createElement('button'); bmex.textContent = T('Exportieren');
    bmex.onclick = () => {
      const data = { type: 'hotwing-materials', v: 1, material: state.material };
      // Explorer-Speichern-Dialog, startet im Ordner „Werkstoffdaten exportieren"
      // (Einstellungen); normaler Browser-Download nur als Notlösung.
      App.download('werkstoffdaten.json', JSON.stringify(data, null, 2), 'application/json', 'svMaterial');
    };
    const bmim = document.createElement('button'); bmim.textContent = T('Importieren');
    // Import über den Explorer-Öffnen-Dialog (startet im Ladeordner „Werkstoffdaten",
    // Einstellungen); versteckter Datei-Input nur als Fallback.
    const matImportText = text => {
      try {
        const o = JSON.parse(text);
        const m = o && o.material ? o.material : o;
        if (!m || typeof m !== 'object' || m.id == null) { alert(T('Keine gültige Werkstoffdatei.')); return; }
        Object.assign(state.material, m);
        buildSidebar(); renderMaterial(); saveSettings(); render();
      } catch (err) { alert(T('Werkstoffdatei konnte nicht gelesen werden.')); }
    };
    const fmat = document.getElementById('fileMaterial');
    if (fmat) fmat.onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader(); rd.onload = () => matImportText(rd.result); rd.readAsText(f); e.target.value = '';
    };
    bmim.onclick = () => App.loadVia({ 'application/json': ['.json'] }, t => matImportText(t), 'fileMaterial', 'ldMaterial');
    matBtns.appendChild(bmex); matBtns.appendChild(bmim);
    mdb.body.appendChild(matBtns);

    if (matOpts.length) {
    subhead(mdb.body, 'Abbrand-Kalibrierung (Vorschub ↔ Spalt)');
    hint(mdb.body, 'Zwei Stützpunkte je Werkstoff: bei langsamem Vorschub breiterer Spalt, bei '
      + 'schnellem schmaler. Der WIRKSAME Abbrand folgt dem im G-Code eingegebenen Vorschub '
      + '(zwischen den Stützpunkten interpoliert). Bei Trapezflächen läuft die kürzere Rippe '
      + 'langsamer -> dort größerer Abbrand.');
    hint(mdb.body, 'Die Wahl der Abbrand-Berechnungsmethode steht jetzt direkt im jeweiligen '
      + 'Design (Kerndesign, Negativschalendesign, DXF-Formen).');

    subhead(mdb.body, 'Stützpunkt langsam (kleinerer Vorschub)');
    numRow(mdb.body, 'Vorschub (mm/min)', () => App.feedPair(state.material.id).slow,
      v => { App.setFeed('slow', v); renderMaterial(); render(); }, { min: 1 });
    numRow(mdb.body, 'Abbrand (mm)', () => App.kerfPair(state.material.id).slow.toFixed(2),
      v => { App.setKerf('slow', v); renderMaterial(); render(); }, { step: 0.05, min: 0 });
    subhead(mdb.body, 'Stützpunkt schnell (größerer Vorschub)');
    numRow(mdb.body, 'Vorschub (mm/min)', () => App.feedPair(state.material.id).fast,
      v => { App.setFeed('fast', v); renderMaterial(); render(); }, { min: 1 });
    numRow(mdb.body, 'Abbrand (mm)', () => App.kerfPair(state.material.id).fast.toFixed(2),
      v => { App.setKerf('fast', v); renderMaterial(); render(); }, { step: 0.05, min: 0 });

    // Interpolation braucht ZWEI verschiedene Vorschübe. Sind sie gleich, kann der
    // Abbrand nicht vorschubabhängig berechnet werden -> es wird gemittelt. Das ist
    // die häufigste Verwirrung („Abbrand wird nicht übernommen"), daher klar warnen.
    // Statisches Element; Inhalt/Sichtbarkeit aktualisiert renderMaterial() live
    // (kein buildSidebar in den Eingabe-Handlern -> Tippen bricht nicht ab).
    const feedWarn = document.createElement('div');
    feedWarn.id = 'matFeedWarn'; feedWarn.className = 'hint';
    feedWarn.style.cssText = 'color:var(--bad);font-weight:600;margin:4px 0;display:none';
    mdb.body.appendChild(feedWarn);
    App.updateFeedWarn(feedWarn);

    subhead(mdb.body, 'Drahtheizung (%)');
    numRow(mdb.body, 'Heizstrom 1 (schnell)', () => App.matHeat(state.material.id),
      v => { App.setHeat(v); renderMaterial(); }, { min: 0, max: 100, hint: 'Heizstrom der Kalibrierpunkte 1 (schnell) und 2 (langsam). Ohne Punkt 3 konstant während des Schnitts.' });
    boolRow(mdb.body, 'Heizstrom vorschubabhängig (Punkt 3 aktiv)', () => App.heatPair(state.material.id).varies,
      v => { App.setHeatSlow(v ? App.matHeat(state.material.id) : null); buildSidebar(); renderMaterial(); },
      'Ein: Kalibrierpunkt 3 (langsam, Heizstrom 2 so gewählt, dass der Abbrand gleich Punkt 1 ist). Die Heizung folgt dann '
      + 'dem Vorschub (linear zwischen Punkt 3 und Punkt 1) und der Abbrand bleibt beim vorgegebenen Vorschub konstant '
      + '= Abbrand schnell. Beim Verringern/Erhöhen des Vorschubs passt sich die Drahtheizung an. Aus: Heizung konstant = Heizstrom 1.');
    if (App.heatPair(state.material.id).varies)
      numRow(mdb.body, 'Heizstrom 2 (langsam)', () => App.heatPair(state.material.id).slow,
        v => { App.setHeatSlow(v); renderMaterial(); }, { min: 0, max: 100 });
    }
    subhead(mdb.body, 'Schmelzen / Aufheizen');
    numRow(mdb.body, 'Verweilzeit am Nullpunkt (s)', () => state.material.meltDwell,
      v => { state.material.meltDwell = v; saveSettings(); renderBlock(); render(); },
      { min: 0, step: 0.5, norender: true, hint: 'Bei senkrechten Schnitten bis auf den Nullpunkt (Blockschnitte, Guillotine) verweilt der Draht unten so lange (G4), um sich sicher durch den Werkstoff zu schmelzen. Wichtig bei Guillotine, wo der Draht danach nicht weiterfährt. Standard 3 s, 0 = aus.' });

    subhead(mdb.body, 'Aufheizphase');
    numRow(mdb.body, 'Aufheizzeit (s)', () => state.material.preheatSec,
      v => { state.material.preheatSec = v; saveSettings(); render(); renderBlock(); },
      { min: 0, step: 0.5, hint: 'Zu Programmbeginn: sobald der Draht im Zuge des normalen G-Codes erstmals beim Hochfahren die „Aufheizhöhe" erreicht, hält er dort so lange (G4) und heizt auf. Zusätzlich wird diese Zeit nach JEDER Pause (M0), in der der Draht ausgeschaltet war, beim Wiedereinschalten eingehalten (alle G-Code-Quellen). Standard 3 s, 0 = aus.' });
    numRow(mdb.body, 'Aufheizhöhe (mm)', () => state.material.preheatH,
      v => { state.material.preheatH = v; saveSettings(); render(); renderBlock(); },
      { min: 0, hint: 'Vertikale Höhe über dem Maschinen-Nullpunkt (Y0), bei der aufgeheizt wird — kurz bevor der Draht in den Werkstoff eintaucht. Standard 10 mm.' });
    side.appendChild(mdb.g);

    // Reiter „Projektübersicht" (material): keine Seitenleiste mehr — Projekt, Tragflächen,
    // Werkstoff DXF/3D-Modell und Schneideinstellungen stehen mittig in overview.js.

    if (App.sidebarMachine) App.sidebarMachine(side, 'cut');   // Reiter „Schneiden": Blockzuschnitt/Kalibrierung — cutpanel.js

    const mc = grp('Maschinengeometrie', true, machineTab());
    numRow(mc.body, 'Turmabstand (mm)', () => state.cfg.machineWidth, v => state.cfg.machineWidth = v);
    side.appendChild(mc.g);

    if (App.sidebarMachine) App.sidebarMachine(side, 'feedmode');   // Vorschub-Modus G94/G93 — cutpanel.js
    if (App.sidebarMachine) App.sidebarMachine(side, 'relay');      // Schaltausgang/Relais parallel zur Heizung — cutpanel.js

    // Maschinengrenzen + Warnungen: die Prüfungen (Simulation im Reiter „G-Code"
    // und Startsperre im Reiter „Schneiden") sind einzeln abschaltbar.
    const ml = grp('Maschinengrenzen & Warnungen', true, machineTab());
    hint(ml.body, 'Max. Fahrweg je Portal ab Maschinennullpunkt. Überschreitet ein Programm '
      + 'diese Werte, wird in der Simulation gewarnt und der Schnitt im Reiter „Schneiden" mit Fehlermeldung verweigert. 0 = kein Limit.');
    numRow(ml.body, 'Max. Fahrweg horizontal (mm)', () => state.cfg.maxTravelH, v => state.cfg.maxTravelH = v, { min: 0 });
    numRow(ml.body, 'Max. Fahrweg vertikal (mm)', () => state.cfg.maxTravelV, v => state.cfg.maxTravelV = v, { min: 0 });
    numRow(ml.body, 'Max. Vorschub (mm/min)', () => state.cfg.maxFeed, v => { state.cfg.maxFeed = v; render(); renderBlock(); }, { min: 0,
      hint: 'Überschreitet ein Vorschub (F) im Programm diesen Wert, wird in der Simulation gewarnt und der Schnitt verweigert. 0 = kein Limit.' });
    hint(ml.body, 'Warnungen einzeln ein-/ausschalten. Ausgeschaltete Prüfungen zeigen keine Warnleiste in der '
      + '3D-Simulation und sperren den Start im Reiter „Schneiden" nicht. Achtung: Ohne Prüfung schützt nur noch '
      + 'die Steuerung selbst (Endschalter / Soft-Limits $20) vor Kollisionen.');
    const warnRow = (label, key, h) => boolRow(ml.body, label, () => state.cfg[key] !== false,
      v => { state.cfg[key] = v; if (window.Sim3D && Sim3D.refreshWarn) Sim3D.refreshWarn(); }, h);
    warnRow('Warnung: Portal fährt ins Negative', 'warnNeg',
      'Meldung, wenn eine Achse unter 0 (Maschinennullpunkt) fahren würde — z. B. beim Durchschneiden unter Y0 oder bei Anfahrwegen vor dem Block.');
    warnRow('Warnung: Max. Fahrweg überschritten', 'warnTravel',
      'Meldung, wenn eine Achse über den oben eingetragenen max. Fahrweg hinausfährt (nur mit Wert > 0).');
    warnRow('Warnung: Max. Vorschub überschritten', 'warnFeed',
      'Meldung, wenn ein Vorschub (F) im Programm über dem max. Vorschub liegt (nur mit Wert > 0).');
    side.appendChild(ml.g);

    if (App.sidebarMachine) App.sidebarMachine(side, 'grbl');   // GRBL-Einstellungen ($$) — cutpanel.js

    // Achszuweisung (Achsbuchstaben, Nachkommastellen, Header/Footer) ist maschinenspezifisch
    // → ganz unten im Reiter „Maschine", standardmäßig zugeklappt (ohne diesen Reiter im Build: Rückfall auf „G-Code", machineTab()).
    // Änderungen wirken SOFORT in der Maschinensteuerung: Achsbuchstaben schon beim
    // Tippen auf Positionsanzeige/Handfahrt/GRBL-Achsmenüs (GrblPanel.refreshAxes);
    // nach dem Bestätigen (Enter/Feld verlassen) G-Code neu erzeugen und ein aus
    // einer Quelle übernommenes Programm neu übernehmen (sonst liefe es mit den alten Achsen).
    const gc = grp('Achszuweisung', false, machineTab());
    const axLive = () => {
      const L = [state.cfg.axX, state.cfg.axY, state.cfg.axU, state.cfg.axV];
      if (L.every(l => String(l || '').trim()) && window.GrblPanel && GrblPanel.refreshAxes) GrblPanel.refreshAxes();
    };
    const axCommit = () => {
      axLive(); render();
      if (window.GrblPanel && GrblPanel.refreshProgram) { try { GrblPanel.refreshProgram('axes'); } catch (e) {} }
    };
    const axIn = (inp) => { inp.addEventListener('input', axLive); inp.addEventListener('change', axCommit); };
    axIn(txtRow(gc.body, 'Achse L horiz.', () => state.cfg.axX, v => state.cfg.axX = v));
    axIn(txtRow(gc.body, 'Achse L vert.', () => state.cfg.axY, v => state.cfg.axY = v));
    axIn(txtRow(gc.body, 'Achse R horiz.', () => state.cfg.axU, v => state.cfg.axU = v));
    axIn(txtRow(gc.body, 'Achse R vert.', () => state.cfg.axV, v => state.cfg.axV = v));
    numRow(gc.body, 'Nachkommastellen', () => state.cfg.precision, v => { state.cfg.precision = v; axCommit(); }, { int: true, min: 1, max: 5, norender: true, enter: true });
    areaRow(gc.body, 'Header', () => state.cfg.header, v => state.cfg.header = v).addEventListener('change', axCommit);
    areaRow(gc.body, 'Footer', () => state.cfg.footer, v => state.cfg.footer = v).addEventListener('change', axCommit);
    side.appendChild(gc.g);

    // Aufheizphase ist zum Reiter „Projektübersicht" gewandert (materialabhängig).

    const sb = grp('Tragfläche, Schnitt und Block', true, 'gcode');
    if (state.cfg.gcodeSource === 'schrift')
      warn(sb.body, 'Quelle „Schriften": Hier gelten Vorschub, Geschwindigkeit außerhalb Block und die Profil-Schnittrichtung (Oberseite/Unterseite zuerst). Schnittrichtung, Tragflächenseite und Blockschnitt betreffen nur Tragflächen.');
    // Ganz oben, groß und deutlich: Schnittrichtung (von hinten / von vorne), darunter
    // welche Tragfläche (links/rechts) geschnitten wird.
    const cutFrontOn = state.cfg.cutDir === 'front';
    {
      const lab = document.createElement('div');
      lab.className = 'row full';
      lab.innerHTML = '<label style="font-weight:600;font-size:13px;color:var(--txt)">' + T('Schnittrichtung:') + '</label>';
      sb.body.appendChild(lab);
      const row = document.createElement('div'); row.className = 'row full';
      row.style.display = 'grid'; row.style.gridTemplateColumns = '1fr 1fr'; row.style.gap = '6px';
      [['rear', 'Von hinten (Nase vorne)'], ['front', 'Von vorne (Nase hinten)']].forEach(([v, t]) => {
        const b = document.createElement('button'); b.textContent = T(t);
        const on = (state.cfg.cutDir || 'rear') === v;
        b.style.cssText = 'padding:9px 6px;font-size:13px;font-weight:600;border-radius:6px;'
          + (on ? 'background:var(--grp-accent,var(--accent));color:#04121f;border-color:var(--grp-accent,var(--accent))' : '');
        b.onclick = () => { if ((state.cfg.cutDir || 'rear') !== v) { state.cfg.cutDir = v; buildSidebar(); render(); } };
        row.appendChild(b);
      });
      sb.body.appendChild(row);
      hint(sb.body, cutFrontOn
        ? '„Von vorne": Die Tragfläche liegt mit der NASE zum Nullpunkt (X0 vor der Nase, +X zur Endleiste). '
          + 'Oberseite: Einlauf an der Nase (bei Nasenverlängerung ab deren Anfang) → Nase → Oberseite → Endleiste → '
          + 'obere EL-Verlängerung → senkrecht hoch auf Sicherheitshöhe → über den Block nach vorne. Unterseite: vor dem '
          + 'Block runter → Einlauf → Nase → Unterseite → Endleiste → untere EL-Verlängerung → hoch → zurück zum Nullpunkt. '
          + 'X-Schlaufe/Acht an der Nase werden an ihrer vordersten Stelle geteilt: jede Seite läuft über ihren Ast ein.'
        : '„Von hinten" (Standard): Die Tragfläche liegt mit der NASE vorne (X0 hinter der Endleiste). Der Draht fährt '
          + 'hinten über die EL-Verlängerung ein, schneidet die Oberseite zur Nase, wendet dort (Nasenverlängerung/Schlaufe) '
          + 'und schneidet die Unterseite zurück — ein durchgehender Zug.');
    }
    {
      // „Von vorne" liegt der Block um 180° gedreht (Nase zum Nullpunkt) — damit
      // die Fläche seitenrichtig bleibt, wechselt die Wurzel aufs andere Portal
      // (App.rootAtRight). Die Knöpfe stehen dort, wo die Wurzel liegt.
      hint(sb.body, cutFrontOn
        ? 'Von vorne (Block um 180° gedreht): Rechte Fläche: Wurzel am RECHTEN Portal (z=machineWidth). Linke Fläche: '
          + 'Wurzel am LINKEN Portal (z=0). So bleibt die jeweilige Fläche seitenrichtig — ohne den Tausch entstünde '
          + 'beim Umdrehen das Spiegelbild.'
        : 'Rechte Fläche: Wurzel am LINKEN Portal (z=0). Linke Fläche: Wurzel am RECHTEN '
          + 'Portal (z=machineWidth). So liegt die jeweilige Fläche seitenrichtig auf der Maschine.');
      const lab = document.createElement('div');
      lab.className = 'row full';
      lab.innerHTML = '<label style="font-weight:600;font-size:13px;color:var(--txt)">' + T('Geschnitten wird:') + '</label>';
      sb.body.appendChild(lab);
      const row = document.createElement('div'); row.className = 'row full';
      row.style.display = 'grid'; row.style.gridTemplateColumns = '1fr 1fr'; row.style.gap = '6px';
      // Reihenfolge wie der Block auf der Maschine liegt (Knopf auf der Seite der
      // Wurzel): von hinten rechte Fläche links, linke Fläche rechts; von vorne umgekehrt.
      const sides = [['right', 'Rechte Tragfläche'], ['left', 'Linke Tragfläche']];
      if (cutFrontOn) sides.reverse();
      sides.forEach(([v, t]) => {
        const b = document.createElement('button'); b.textContent = T(t);
        const on = state.cfg.side === v;
        b.style.cssText = 'padding:9px 6px;font-size:13px;font-weight:600;border-radius:6px;'
          + (on ? 'background:var(--grp-accent,var(--accent));color:#04121f;border-color:var(--grp-accent,var(--accent))' : '');
        b.onclick = () => { if (state.cfg.side !== v) { state.cfg.side = v; buildSidebar(); render(); } };
        row.appendChild(b);
      });
      sb.body.appendChild(row);
    }
    selectRow(sb.body, 'Schnittreihenfolge',
      [['before', 'Blockschnitt vor Profilschnitt'],
       ['after',  'Blockschnitt nach Profilschnitt'],
       ['wrap',   'Blockschnitt während Profilschnitt'],
       ['only',   'Nur Blockschnitt'],
       ['none',   'Ohne Blockschnitt']],
      () => state.cfg.cutOrder, v => { state.cfg.cutOrder = v; render(); },
      cutFrontOn
      ? 'Blockschnitt = zwei vertikale Schnitte durch den Block: Blockvorderkante (Nase, nah am Nullpunkt) und hinteres '
        + 'Blockende (Endleiste, fern) — je auf Null. „Vor Profilschnitt": erst hinten, dann vorne; aus dem vorderen '
        + 'Schnittspalt steigt der Draht direkt auf die Einlaufhöhe. „Nach Profilschnitt": erst Ober- und Unterseite, '
        + 'dann hinteres Blockende, dann Blockvorderkante. „Blockschnitt während Profilschnitt": erst die Blockvorderkante, '
        + 'dann die Oberseite; am Ende der EL-Verlängerung schneidet der Draht gleich das hintere Blockende (volle Höhe), '
        + 'danach die Unterseite. „Nur Blockschnitt": Blockvorderkante und hinteres Blockende. „Ohne Blockschnitt": '
        + 'Draht fährt vorne am Nullpunkt auf Einlaufhöhe und horizontal zur Nase. Sicherheitshöhe: Reiter „Projektübersicht".'
      : 'Blockschnitt = zwei vertikale Schnitte durch den Block: Blockvorderkante und hinteres Blockende (je auf Null). '
      + '„Vor Profilschnitt": erst vorne, dann hinten, danach das Profil. '
      + '„Nach Profilschnitt": erst das Profil, dann hinteres Blockende, dann Blockvorderkante. '
      + '„Blockschnitt während Profilschnitt": erst hinteres Blockende, dann die Profil-Oberseite; '
      + 'der Draht kommt an der Nase heraus und schneidet dort gleich die Blockvorderkante '
      + '(voller Höhe, oben und unten), dann die Profil-Unterseite zurück. Spart Leerfahrten (wenig „umsonst gefahren"). '
      + '„Nur Blockschnitt": nur hinteres Blockende und Blockvorderkante, kein Profilschnitt. '
      + '„Ohne Blockschnitt": Draht fährt hinten am Nullpunkt auf Höhe der EL-Verlängerung, '
      + 'horizontal von hinten ins Profil, schneidet die Kontur, fährt horizontal zurück und dann vertikal auf Null. '
      + 'Sicherheitshöhe: Reiter „Projektübersicht".');
    // Welche Profilseite(n): beide (Standard) oder nur Ober-/Unterseite — über den
    // Zug-Ablauf (hotwire_gcode.js emitPasses), in beiden Schnittrichtungen.
    const sidesVal = state.cfg.cutSides || 'both';
    selectRow(sb.body, 'Profilseiten',
      [['both',   'Ober- und Unterseite'],
       ['top',    'Nur Oberseite'],
       ['bottom', 'Nur Unterseite']],
      () => state.cfg.cutSides || 'both', v => { state.cfg.cutSides = v; buildSidebar(); render(); },
      T('Welche Profilseite geschnitten wird. „Nur Oberseite" / „Nur Unterseite": die andere Seite bleibt stehen '
      + '(z. B. flache Unterseite auf dem Tisch, Nachschnitt einer Seite). Die gewählte Schnittreihenfolge (Blockschnitte) '
      + 'gilt weiter. ') + T(cutFrontOn
        ? 'Von vorne: der Zug läuft wie gewohnt von der Nase zur Endleiste und fährt hinten hoch.'
        : 'Von hinten: Oberseite von der EL-Verlängerung zur Nase, Ausfahrt vor der Nase nach oben; Unterseite: '
          + 'Anfahrt über den Block von vorne, von der Nase zur Endleiste, Ausfahrt waagrecht zum Nullpunkt.')
      + T(' Bei „Nur Blockschnitt" ohne Wirkung.'));
    if (sidesVal === 'both')
    selectRow(sb.body, 'Profil-Schnittrichtung',
      [['top',    'Oberseite zuerst'],
       ['bottom', 'Unterseite zuerst']],
      () => state.cfg.profileDir, v => { state.cfg.profileDir = v; render(); },
      cutFrontOn
      ? 'Welche Seite zuerst geschnitten wird. Bei „von vorne" laufen beide Seiten von der Nase zur Endleiste — '
        + 'die Wahl bestimmt nur die Reihenfolge der beiden Züge (gilt auch für gestapelte Kopien).'
      : 'In welcher Richtung die Profilkontur geschnitten wird. „Oberseite zuerst" (Standard): '
      + 'der Draht fährt von der oberen EL-Verlängerung über die Oberseite zur Nase und die '
      + 'Unterseite zurück. „Unterseite zuerst": dieselbe Kontur in umgekehrter Reihenfolge '
      + '(untere EL-Verlängerung → Unterseite → Nase → Oberseite). Nützlich, um die '
      + 'Schnittwärme/Verzug auf die gewünschte Seite zu legen. Bei gestapelten Kopien wird '
      + 'immer „Oberseite zuerst" verwendet.');
    hint(sb.body, 'Schnittspalt (Abbrand), Vorschub und Drahtheizung kommen aus dem Werkstoff-'
      + 'Betriebspunkt (Reiter „Projektübersicht"). Der Vorschub hier ist der wirksame Wert und '
      + 'lässt sich für diesen Schnitt manuell überschreiben.');
    feedRow(sb.body, 'Vorschub (mm/min)', () => state.cfg.feed, v => state.cfg.feed = v,
      { hint: 'Geschwindigkeit auf der Schnittspur — bleibt konstant. Die Steuerung regelt die Türme, '
        + 'um dieses Tempo zu halten; die tatsächlichen Portal-Geschwindigkeiten stehen als Kommentar in jeder Schnittzeile. '
        + 'Wie dieser Wert in den G-Code geschrieben wird (F in mm/min oder G93 Inverse Time), steht im Reiter „Maschine".' });
    selectRow(sb.body, 'Geschwindigkeit außerhalb Block',
      [['max', 'Maximum (Maschinen-Grenze)'], ['cut', 'Gleich wie Schnitt'], ['free', 'Freie Wahl']],
      () => state.cfg.outFeedMode, v => { state.cfg.outFeedMode = v; buildSidebar(); render(); },
      'Vorschub für die Anfahr-/Auslauf-Züge AUSSERHALB des Blocks (Draht in Luft). '
      + '„Maximum": so schnell wie erlaubt (Max.-Vorschub, Reiter „Maschine"). '
      + '„Gleich wie Schnitt": derselbe Vorschub wie im Schnitt. „Freie Wahl": eigener Wert. '
      + 'In JEDEM Fall wird der Maschinen-Max.-Vorschub am schnelleren (äußeren) Portal beim Anfahren NICHT überschritten.');
    if (state.cfg.outFeedMode === 'free')
      numRow(sb.body, 'Außen-Vorschub (mm/min)', () => state.cfg.outFeed, v => state.cfg.outFeed = v, { min: 0 });
    if (state.cfg.outFeedMode === 'max' && !(state.cfg.maxFeed > 0))
      hint(sb.body, '⚠ Kein Max.-Vorschub gesetzt (Reiter „Maschine") — „Maximum" nutzt ersatzweise 3000 mm/min.');
    hint(sb.body, 'Sicherheitshöhe über dem Block: Reiter „Projektübersicht".');
    side.appendChild(sb.g);

    const bl = grp('Blocklage', true, 'gcode');
    hint(bl.body, 'Abstand des Styroporblocks vom Maschinennullpunkt (rote Linie). '
      + 'Der G-Code wird entsprechend verschoben.');
    selectRow(bl.body, 'Lage zwischen den Portalen',
      [['manual', 'Abstand angeben'], ['center', 'Mittig zwischen den Portalen']],
      () => state.cfg.blockZCenter ? 'center' : 'manual',
      v => { state.cfg.blockZCenter = (v === 'center'); buildSidebar(); render(); },
      'Spannweiten-Lage des Blocks im Portal. „Mittig zwischen den Portalen": der Block '
      + 'wird automatisch zentriert (gleicher Abstand zu beiden Portalen). „Abstand angeben": '
      + 'freier Abstand der Wurzelebene zum Portal auf der Wurzelseite.');
    const blSchrift = state.cfg.gcodeSource === 'schrift';   // Reiter „Schriften": Block links unten, X nach rechts
    if (!state.cfg.blockZCenter)
    numRow(bl.body,
      blSchrift ? 'Abstand Block ↔ linkes Portal (mm)'
      : !App.rootAtRight() ? 'Abstand Wurzel ↔ linkes Portal (mm)'
                         : 'Abstand Wurzel ↔ rechtes Portal (mm)',
      () => state.cfg.blockZ, v => state.cfg.blockZ = v,
      { hint: 'Abstand der Wurzelebene vom Portal auf der Wurzelseite (Spannweiten-Lage im Portal). '
        + 'Bei aktiver Werkstück-Drehung bezogen auf den dem Portal am NÄCHSTEN gelegenen '
        + 'Blockpunkt (die gedrehte Ecke), nicht auf die schräg stehende Wurzelebene.' });
    numRow(bl.body, blSchrift ? 'Abstand X vom Nullpunkt (mm)' : 'Abstand in Flugrichtung X (mm)', () => state.cfg.blockX, v => state.cfg.blockX = v,
      { min: 0, hint: blSchrift ? 'Schriften: Lücke zwischen Nullpunkt (X=0) und linker Blockkante; +X zeigt nach rechts in den Block.'
        : state.cfg.cutDir === 'front'
        ? 'Schnittrichtung „von vorne": Lücke vor der Nase — X=0 sitzt so weit vor der Blockvorderkante.'
        : 'Lücke hinter der Endleiste: X=0 sitzt so weit hinter dem Block.' });
    numRow(bl.body, 'Höhe über Nullpunkt Y (mm)', () => state.cfg.blockY, v => state.cfg.blockY = v,
      { min: 0, hint: 'Der Block schwebt um diesen Betrag über der Nulllinie (Y=0 darunter).' });
    side.appendChild(bl.g);

    // Anzeige-Optionen ganz nach unten (bessere Übersicht über die Segmente oben).
    const an = grp('Anzeige', true, 'wing');
    boolRow(an.body, 'Beplankungslinie', () => state.cfg.showCore, v => state.cfg.showCore = v);
    // Schnittspur/Abbrand-Heatmap sind Fertigungshilfen -> nur im Reiter
    // „Kernschneiden" (Schalter über dem Profilfenster), hier nicht anbieten.
    boolRow(an.body, 'Punktnummern', () => state.cfg.showNums, v => state.cfg.showNums = v,
      'Nummeriert die Profilpunkte (Sollkontur) im Profilfenster, jeden n-ten Punkt.');
    numRow(an.body, 'Nummer alle n Punkte', () => state.cfg.numEvery, v => state.cfg.numEvery = Math.max(1, v),
      { int: true, min: 1, max: 100, step: 1 });
    boolRow(an.body, 'Styroporblock', () => state.cfg.showBlock, v => state.cfg.showBlock = v);
    boolRow(an.body, 'Bemaßung', () => state.cfg.showDim, v => state.cfg.showDim = v);
    boolRow(an.body, 'V-Form (Einbaulage)', () => state.cfg.showDihedral, v => state.cfg.showDihedral = v,
      'Zeigt Profile/Konturen auf ihrer echten Einbauhöhe. Reine Darstellung — der Schnitt bleibt flach.');
    boolRow(an.body, 'Scharnierlinie im Grundriss', () => state.cfg.showHingePlan, v => state.cfg.showHingePlan = v,
      'Zeichnet die Scharnierlinie (Prozent von hinten) auch in die Draufsicht.');
    hint(an.body, 'Mausrad = Zoom, Ziehen = Verschieben. Doppelklick setzt zurück.');
    side.appendChild(an.g);

    buildModelSidebar(side);            // Reiter „3D-Modell"
    buildModelGcodeSidebar(side);       // Reiter „3D-Modell" — Heißdraht-G-Code
    buildModelStlSidebar(side);         // Reiter „3D-Modell" — STL-Export (ganz unten)

    applySidebarFilter();               // nur die zum aktiven Reiter passenden Gruppen zeigen
  }

  // --- „3D-Modell → G-Code" (eigenes Menü unten im Reiter „G-Code") ----
  // Erzeugt aus einem Modellsegment den Heißdraht-G-Code und schleust ihn über
  // dieselbe Pipeline wie die übrigen Quellen (state.lastGcode, #gcodeText,
  // Sim3D-Simulation) — Quelle = state.cfg.gcodeSource === 'model'.
  // Effektiver Wurzel-Portalabstand (Blocklage, Wurzelseiten-Wert VOR Spiegelung).
  // Bei „mittig zwischen den Portalen" liegt der Block zentriert: der near-Wert ist
  // (Maschinenbreite − Spannweite)/2 — das zentriert auch nach der Spiegelung.
  function effBlockZ(span) {
    if (state.cfg.blockZCenter) {
      const mw = state.cfg.machineWidth || 0;
      return Math.max(0, (mw - (span || 0)) / 2);
    }
    return state.cfg.blockZ;
  }
  function mgCfg() {
    if (!state.modelGcode) state.modelGcode = {
      seg: 0, N: 160, feed: (state.cfg.feed || 220), safe: 20, swap: false, flip: false,
      start: 'angle', startAng: 90, startPt: null, reverse: false, leadIn: 0, edits: {}, kerfMode: 'ratio'
    };
    if (!state.modelGcode.start) state.modelGcode.start = 'auto';
    if (!isFinite(state.modelGcode.startAng)) state.modelGcode.startAng = 90;
    if (state.modelGcode.leadIn == null) state.modelGcode.leadIn = 0;
    if (!state.modelGcode.edits) state.modelGcode.edits = {};
    if (!state.modelGcode.kerfMode) state.modelGcode.kerfMode = 'ratio';   // eigene Abbrand-Berechnung (Altprojekte: loadProject)
    return state.modelGcode;
  }
  function mgOpt() {
    const c = mgCfg();
    // Abbrand wie in den anderen Reitern: Modus + Werkstoff-Kalibrierung.
    const mid = App.matIdFor('model');
    const kp = App.kerfPair(mid), fp = App.feedPair(mid);
    const cal = { kerfSlow: kp.slow, kerfFast: kp.fast, feedSlow: fp.slow, feedFast: fp.fast, feed: c.feed, heatVaries: App.heatPair(mid).varies };
    return { axX: state.cfg.axX, axY: state.cfg.axY, axU: state.cfg.axU, axV: state.cfg.axV,
      feed: c.feed, safe: c.safe, prec: state.cfg.precision || 3, maxFeed: state.cfg.maxFeed || 0,
      N: c.N, swap: c.swap, flip: c.flip, start: c.start, startPt: c.startPt, startAng: c.startAng, reverse: c.reverse,
      edits: c.edits, leadIn: c.leadIn,
      kerfMode: c.kerfMode || 'ratio', kerf: App.kerfForSpeed(mid, c.feed), cal,   // eigene Abbrand-Berechnung des 3D-Modells
      machineWidth: state.cfg.machineWidth,
      sectionDensity: (window.Model3D ? Model3D.getSectionDensity() : 1),
      blockX: state.cfg.blockX || 0, blockY: state.cfg.blockY || 0,
      blockZ: state.cfg.blockZCenter ? null : state.cfg.blockZ };
  }
  // Szene für die 3D-Simulation: Schaumblock der Segmentdicke (= Ebenenabstand)
  // liegt mittig zwischen den Türmen (z = zA…zB). Die Blockflächen tragen die
  // beiden Stirnprofile; der Draht (Türme bei z=0 / z=Maschinenbreite) ist im
  // G-Code so extrapoliert, dass er an den Flächen genau diese Profile erzeugt.
  function buildModelScene(r) {
    const mw = (r && r.mw) || state.cfg.machineWidth;
    const bb = P => { let a = [Infinity, Infinity, -Infinity, -Infinity];
      for (const p of P) { a[0] = Math.min(a[0], p[0]); a[1] = Math.min(a[1], p[1]); a[2] = Math.max(a[2], p[0]); a[3] = Math.max(a[3], p[1]); } return a; };
    const blocks = [];
    if (r && r.profA && r.profB) {
      const A = bb(r.profA), B = bb(r.profB);
      const zA = r.zA != null ? r.zA : 0, zB = r.zB != null ? r.zB : mw;
      blocks.push({ seg: 0, x0: A[0], x1: A[2], y0: A[1], y1: A[3],
        x0t: B[0], x1t: B[2], y0t: B[1], y1t: B[3], z0: zA, z1: zB, cutZ0: zA, cutZ1: zB });
    }
    return { machineWidth: mw, ax: { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV },
      blocks, defaultSeg: 0, limits: App.machineLimits() };
  }
  // Erzeugt den G-Code des aktuellen Modellsegments. Rückgabe wie andere Quellen.
  function modelGcode() {
    if (!window.Model3D || !Model3D.hasModel()) return null;
    if (!Model3D.ensureSegments()) return null;   // bei Bedarf automatisch zerlegen
    const M = Model3D.state;
    const c = mgCfg();
    if (c.seg >= M.segs.length) c.seg = 0;
    if (!Model3D.buildSegmentGcode) return null;   // Funktion „G-Code-Erzeugung" fehlt (model3d_gcode.js)
    const r = Model3D.buildSegmentGcode(c.seg, mgOpt());
    if (!r) return null;
    r.scene = buildModelScene(r);
    r.seg = c.seg;
    return r;
  }
  // Platten-Config (Stapeln mehrerer gleich dicker Segmente).
  function plateCfg() {
    const c = mgCfg();
    if (!c.plate) c.plate = { segs: [], cols: 2, gapH: 15, gapV: 15, chanX: 0, edits: {}, pos: {}, connEdits: {} };
    // Anordnung: 'pyramid' = unten mehr und größere Stücke (Standard), 'grid' = festes Raster.
    if (!c.plate.arrange) c.plate.arrange = 'pyramid';
    if (!Array.isArray(c.plate.order)) c.plate.order = [];
    if (!c.plate.edits) c.plate.edits = {};
    if (!c.plate.pos) c.plate.pos = {};
    if (!c.plate.connEdits) c.plate.connEdits = {};
    if (c.plate.chanX == null) c.plate.chanX = 0;
    return c.plate;
  }
  // Platzierungen der aktuellen Platten-Auswahl (nur gleich dicke Segmente).
  function platePlacements() {
    if (!window.Model3D || !Model3D.hasModel() || !Model3D.ensureSegments()) return [];
    const p = plateCfg();
    const ids = (p.segs || []).filter(i => i < Model3D.state.segs.length);
    if (!ids.length) return [];
    // Belegung „was wo": p.order legt fest, welches Segment wohin kommt (erster
    // Eintrag = unten links); nicht aufgeführte Segmente hängen sich hinten an.
    const ord = (p.order || []).filter(i => ids.indexOf(i) >= 0);
    ids.forEach(i => { if (ord.indexOf(i) < 0) ord.push(i); });
    const auto = Model3D.plateLayout(ids, p.cols, p.gapH, p.gapV, mgOpt(), { mode: p.arrange || 'pyramid', order: ord });
    // Manuelle Positionen (per Maus/Wert) überschreiben das Auto-Raster.
    return auto.map(pl => (p.pos[pl.seg] ? { seg: pl.seg, dh: p.pos[pl.seg].dh, dv: p.pos[pl.seg].dv } : pl));
  }
  // Szene für die Platte: EIN Block (die Platte), der alle Stücke samt Abstand
  // umschließt; er liegt zwischen den Plattenflächen A (zA) und B (zB) im
  // Maschinen-Turmabstand mw. (Nicht mehr der Block des einzelnen Segments.)
  function buildPlateScene(r) {
    const mw = (r && r.mw) || state.cfg.machineWidth;
    let blocks = [];
    if (r && r.pieces && r.pieces.length) {
      const pb = r.plateBox || [0, 0, 1, 1];
      const pc0 = r.pieces[0];
      const zA = pc0.zA != null ? pc0.zA : 0, zB = pc0.zB != null ? pc0.zB : mw;
      const pg = plateCfg();
      const mH = Math.max(2, (pg.gapH || 0) / 2), mV = Math.max(2, (pg.gapV || 0) / 2);
      const x0 = pb[0] - mH, x1 = pb[2] + mH, y0 = pb[1] - mV, y1 = pb[3] + mV;
      blocks = [{ seg: 0, x0, x1, y0, y1, x0t: x0, x1t: x1, y0t: y0, y1t: y1, z0: zA, z1: zB, cutZ0: zA, cutZ1: zB }];
    }
    return { machineWidth: mw, ax: { x: state.cfg.axX, y: state.cfg.axY, u: state.cfg.axU, v: state.cfg.axV },
      blocks: blocks.length ? blocks : [{ seg: 0, x0: 0, x1: 1, y0: 0, y1: 1, x0t: 0, x1t: 1, y0t: 0, y1t: 1, z0: 0, z1: mw, cutZ0: 0, cutZ1: mw }],
      defaultSeg: 0, limits: App.machineLimits() };
  }
  // Erzeugt den Platten-G-Code (mehrere Segmente). Rückgabe wie andere Quellen.
  function plateGcode() {
    const pls = platePlacements();
    if (!pls.length) return null;
    const opt = Object.assign({}, mgOpt(), { plateConnEdits: plateCfg().connEdits, plateGap: Math.min(plateCfg().gapH, plateCfg().gapV) });
    // Memo: render() läuft aus vielen Gründen — den (teuren) Platten-Aufbau inkl.
    // 3D-Szene nur bei tatsächlich geänderter Auswahl/Position/Optionen neu rechnen.
    const key = JSON.stringify(pls) + '|' + JSON.stringify(opt);
    if (plateGcode._memo && plateGcode._memo.key === key) return plateGcode._memo.r;
    if (!Model3D.buildPlateGcode) { plateGcode._memo = null; return null; }   // ohne model3d_gcode.js
    const r = Model3D.buildPlateGcode(pls, opt);
    if (!r) { plateGcode._memo = null; return null; }
    r.scene = buildPlateScene(r);
    plateGcode._memo = { key, r };
    return r;
  }
  // Anfahrpunkt-Auswahl (Segment- und Platten-Menü). „fester Winkel": Strahl vom
  // Profilschwerpunkt → bei jedem Segment dieselbe Stelle am Umfang, der
  // Eindringschlitz dient beim Zusammensetzen (z. B. Rumpf) als Ausrichtmarke.
  function startRows(body, after) {
    const c = mgCfg();
    selectRow(body, 'Anfahrpunkt',
      [['angle', 'fester Winkel vom Schwerpunkt (bei allen Segmenten gleiche Stelle)'],
       ['auto', 'automatisch (Konturanfang)'], ['rear', 'hinten (max. waagerecht)'],
       ['front', 'vorne (min. waagerecht)'], ['top', 'oben (max. senkrecht)'], ['bottom', 'unten (min. senkrecht)']],
      () => c.start, v => { c.start = v; buildSidebar(); after(); },
      'Legt fest, an welchem Konturpunkt der Schnitt beginnt und endet (Ein-/Austrittsstelle '
      + 'des Drahts). „fester Winkel": Der Eindringpunkt liegt dort, wo ein Strahl vom '
      + 'Profilschwerpunkt unter dem Anfahrwinkel die Kontur trifft — bei jedem Segment an '
      + 'derselben Stelle, sodass der Eindringschlitz beim Zusammensetzen der Segmente als '
      + 'Ausrichtmarke dient. In der Ansicht „◫ Segmentpaar" auch per Klick auf die Schnittspur '
      + 'setzbar (übernimmt den Winkel). Für Tragflächenprofile ist „hinten" (Endleiste) üblich.');
    if (c.start === 'angle')
      numRow(body, 'Anfahrwinkel (°)', () => c.startAng, v => { c.startAng = ((v % 360) + 360) % 360; after(); },
        { step: 5, norender: true, hint: '0° = hinten (+waagerecht), 90° = oben, 180° = vorne, 270° = unten; gegen den Uhrzeigersinn.' });
  }
  // Menü ganz unten im Reiter „G-Code".
  function buildModelGcodeSidebar(side) {
    if (!window.Model3D) return;
    // Pair-Ansicht (3. Fenster) holt Segment + Parameter hierüber.
    window.__model3dPairProvider = () => ({ seg: mgCfg().seg, opt: mgOpt() });
    // Platten-Ansicht: Stücke + Parameter, und Bearbeitung (Verschieben/Kanal).
    window.__model3dPlateProvider = () => ({ placements: platePlacements(),
      opt: Object.assign({}, mgOpt(), { plateConnEdits: plateCfg().connEdits, plateGap: Math.min(plateCfg().gapH, plateCfg().gapV) }) });
    window.__model3dPlateApply = (patch) => {
      const p = plateCfg();
      if (patch.pos) p.pos[patch.pos.seg] = { dh: patch.pos.dh, dv: patch.pos.dv };
      if (patch.conn) p.connEdits[patch.conn.idx] = patch.conn.points.map(q => [q[0], q[1]]);
      if (patch.resetConns) p.connEdits = {};
      if (state.cfg.gcodeSource === 'plate') render();
      if (window.Model3D) Model3D.refresh();
    };
    // Interaktion aus der Segmentpaar-Ansicht (Startpunkt setzen / Punkte verschieben).
    window.__model3dPairApply = (patch) => {
      const cc = mgCfg();
      if (patch.start !== undefined) cc.start = patch.start;
      if (patch.startPt !== undefined) cc.startPt = patch.startPt;
      if (patch.startAng !== undefined) cc.startAng = patch.startAng;
      if (patch.reverse !== undefined) cc.reverse = patch.reverse;
      if (patch.edits !== undefined) cc.edits = patch.edits;
      if (state.cfg.gcodeSource === 'model') render();
      if (window.Model3D) Model3D.refresh();
    };
    const M = Model3D.state;
    const g = grp('Heißdraht-G-Code', true, 'model');
    if (!Model3D.hasModel()) {
      hint(g.body, 'Zuerst oben ein Modell laden (STL) und mit „Zerlegen" teilen. '
        + 'Danach hier je Segment ein Heißdraht-Programm erzeugen.');
      side.appendChild(g.g);
      return;
    }
    const nseg = Model3D.segCount();
    const c = mgCfg();
    if (c.seg >= nseg) c.seg = 0;
    hint(g.body, 'Erzeugt den Regelflächenschnitt zwischen den beiden Stirnprofilen des '
      + 'gewählten Segments. Das gewählte Segmentpaar mit Schnittspur zeigt die Ansicht '
      + '„◫ Segmentpaar" (unten). „Als G-Code-Quelle übernehmen" schaltet die Quelle auf '
      + '„3D-Modell" — der G-Code samt 3D-Simulation erscheint im Reiter „G-Code" (dort auch '
      + 'die Blocklage am Nullpunkt). Im Reiter „Schneiden" ist „3D-Modell" als Quelle wählbar.');
    // Übernehmen: Quelle auf 'model' schalten + Sidebar neu (Dropdown „Quelle
    // Gcode" mitziehen). Parameteränderungen aktualisieren die G-Code-Ansicht (falls
    // Modellquelle aktiv) und die Segmentpaar-Ansicht live.
    const useThis = () => { state.cfg.gcodeSource = 'model'; buildSidebar(); render(); if (window.Model3D) Model3D.refresh(); };
    const live = () => { if (state.cfg.gcodeSource === 'model') render(); if (window.Model3D) Model3D.refresh(); };
    const segList = [];
    for (let i = 0; i < nseg; i++) segList.push([String(i), T('Segment ') + (i + 1) + ' / ' + nseg]);
    selectRow(g.body, 'Segment', segList,
      () => String(c.seg), v => { c.seg = +v; live(); },
      'Wähle das Segment. Sein Segmentpaar (zwei Stirnprofile) mit Schnittspur zeigt die Ansicht „◫ Segmentpaar".');
    // „Punkte je Profil" und „Querschnitt-Punktdichte" stehen im Reiter „3D-Modell"
    // unter „Segmentteilung" (Zerlegen), da sie die Auflösung der Querschnitte betreffen.
    kerfModeRow(g.body, 'model');   // Abbrand: „aus Profillängen-Verhältnis" oder „lokal (Bahngeschwindigkeit)"
    hint(g.body, 'Abbrand-Kompensation wie in den anderen Reitern — der Draht schneidet um den '
      + 'halben Abbrand nach außen versetzt. Werte aus der Werkstoff-Kalibrierung (Reiter „Projektübersicht"). '
      + 'Bei „lokal" variiert der Abbrand entlang der Kontur mit der Draht-Geschwindigkeit.');
    feedRow(g.body, 'Vorschub (mm/min)', () => c.feed, v => { c.feed = Math.max(1, v); live(); },
      { step: 10, min: 1, norender: true });
    numRow(g.body, 'Sicherheitshöhe (mm)', () => c.safe, v => { c.safe = Math.max(0, v); live(); },
      { step: 1, min: 0, norender: true });
    boolRow(g.body, 'Achsen tauschen (h ↔ v)', () => c.swap, v => { c.swap = v; live(); },
      'Vertauscht die beiden Ebenenachsen (waagerecht/senkrecht), falls das Profil liegend statt stehend geschnitten werden soll.');
    boolRow(g.body, 'Horizontal spiegeln', () => c.flip, v => { c.flip = v; live(); });
    startRows(g.body, live);
    boolRow(g.body, 'Richtung umkehren', () => c.reverse, v => { c.reverse = v; live(); },
      'Kehrt den Umlaufsinn der Schnittspur um (Pfeil in der Segmentpaar-Ansicht).');
    boolRow(g.body, 'Turmwege anzeigen', () => (window.Model3D && Model3D.isPairTowers()),
      v => { if (window.Model3D) Model3D.setPairTowers(v); },
      'Standard aus: die Ansicht „◫ Segmentpaar" zeigt nur die Querschnitte (Sollkontur) und die '
      + 'Schnittspur (rot, abbrandkompensiert — wo der Draht wirklich fährt). Einschalten blendet '
      + 'zusätzlich die extrapolierten Turmbahnen (blau/orange) und den Maschinen-Nullpunkt ein '
      + '(die Turmwege spannen die volle Maschinenbreite auf).');
    kerfTrueRow(g.body, 'model');
    // Schnittspur von Hand bearbeiten (Punkte ziehen) — wie in Kern/Negativ.
    boolRow(g.body, 'Schnittspur bearbeiten', () => (window.Model3D && Model3D.isPairEdit()),
      v => { if (window.Model3D) { Model3D.setPairEdit(v); if (v) Model3D.setView('pairs'); } },
      'Punkte der Schnittspur in der Ansicht „◫ Segmentpaar" mit der Maus ziehen. Die Spur wird '
      + 'dabei eingefroren (Abbrand/Start werden nicht mehr neu berechnet).');
    { const rb = document.createElement('button'); rb.textContent = T('Bearbeitung zurücksetzen');
      rb.onclick = () => { if (c.edits) delete c.edits[c.seg]; c.edits = Object.assign({}, c.edits); live(); };
      g.body.appendChild(rb); }
    numRow(g.body, 'Anfahrabstand (mm)', () => c.leadIn, v => { c.leadIn = Math.max(0, v); live(); },
      { step: 1, min: 0, norender: true,
        hint: 'Der Draht fährt vom Nullpunkt zuerst senkrecht hoch auf Eintrittshöhe, dann waagerecht '
          + 'in den Eindringpunkt. Der Anfahrabstand teilt nur den letzten waagerechten Anteil in '
          + 'Eilgang + Schnitt auf. 0 = kompletter waagerechter Weg im Schnittvorschub.' });
    const gen = document.createElement('button'); gen.textContent = T('Als G-Code-Quelle übernehmen'); gen.className = 'primary';
    gen.onclick = useThis;
    g.body.appendChild(gen);
    side.appendChild(g.g);

    buildPlateSidebar(side);
  }
  // „Platte / Stapeln": mehrere gleich dicke Segmente in einem Schnitt.
  function buildPlateSidebar(side) {
    if (!window.Model3D || !Model3D.hasModel()) return;
    const nseg = Model3D.segCount();
    if (nseg < 1) return;
    const p = plateCfg(), c = mgCfg();
    const g = grp('Platte / Stapeln (mehrere Segmente)', true, 'model');
    hint(g.body, 'Mehrere gleich DICKE Segmente (gleicher Ebenenabstand) in EINEM Schnitt aus '
      + 'einer Platte schneiden. Nur Segmente mit derselben Dicke wie das aktive Segment sind wählbar. '
      + 'Die Stücke werden platzsparend in Reihen gelegt (echte Stückbreiten, Reihen oben bündig). '
      + 'Standard ist die Pyramide: unten liegen mehr und größere Segmente als oben. Die '
      + 'Schnittreihenfolge läuft reihenweise von oben nach unten; die '
      + 'Verbindungswege führen nur durch den Freiraum zwischen den Teilen.');
    const activeSpan = Model3D.segSpan(c.seg);
    // Segment-Auswahl (nur gleiche Dicke)
    for (let i = 0; i < nseg; i++) {
      const same = Math.abs(Model3D.segSpan(i) - activeSpan) < 0.5;
      const row = document.createElement('div'); row.className = 'row';
      const l = document.createElement('label');
      l.textContent = T('Segment ') + (i + 1) + ' · ' + Model3D.segSpan(i).toFixed(0) + ' mm' + (same ? '' : T(' (andere Dicke)'));
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = p.segs.indexOf(i) >= 0; cb.disabled = !same;
      cb.onchange = () => { const k = p.segs.indexOf(i); if (cb.checked && k < 0) p.segs.push(i); else if (!cb.checked && k >= 0) p.segs.splice(k, 1); if (state.cfg.gcodeSource === 'plate') render(); };
      row.appendChild(l); row.appendChild(cb); g.body.appendChild(row);
    }
    { const b = document.createElement('button'); b.textContent = T('Alle gleich dicken wählen');
      b.onclick = () => { p.segs = []; for (let i = 0; i < nseg; i++) if (Math.abs(Model3D.segSpan(i) - activeSpan) < 0.5) p.segs.push(i); buildSidebar(); if (state.cfg.gcodeSource === 'plate') render(); };
      g.body.appendChild(b); }
    // Anordnung: Pyramide (unten mehr/größer) oder festes Raster.
    const reLayout = () => { buildSidebar(); if (state.cfg.gcodeSource === 'plate') render(); if (window.Model3D) Model3D.refresh(); };
    selectRow(g.body, 'Anordnung',
      [['pyramid', T('Pyramide — unten mehr und größere Segmente')], ['grid', T('festes Raster (gleich viele je Reihe)')]],
      () => p.arrange || 'pyramid', v => { p.arrange = v; reLayout(); },
      'Pyramide: Die unterste Reihe bekommt die meisten Stücke, jede Reihe darüber eines '
      + 'weniger; die größeren Stücke liegen unten, die Reihen sind mittig ausgerichtet. '
      + 'Festes Raster: je Reihe gleich viele Stücke in Segmentreihenfolge (wie bisher).');
    // Raster: Segmente pro Reihe (Spalten) und Anzahl Reihen — beide steuerbar.
    const nsel = () => Math.max(1, p.segs.length);
    if ((p.arrange || 'pyramid') === 'pyramid') {
      numRow(g.body, 'Stücke in der untersten Reihe', () => p.cols, v => { p.cols = Math.max(1, Math.round(v)); reLayout(); },
        { int: true, min: 1, max: 40, norender: true,
          hint: 'Breiteste (unterste) Reihe. Jede Reihe darüber bekommt ein Stück weniger, '
            + 'bis alle verteilt sind — so liegen immer mehr Segmente unten als oben.' });
      { const r = document.createElement('div'); r.className = 'hint';
        const cnt = []; let left = p.segs.length, k = Math.max(1, p.cols | 0);
        while (left > 0) { const t = Math.min(k, left); cnt.push(t); left -= t; k = Math.max(1, k - 1); }
        r.textContent = T('Reihen von unten: ') + (cnt.length ? cnt.join(' · ') : '–');
        g.body.appendChild(r); }
    } else {
      numRow(g.body, 'Spalten (Segmente je Reihe)', () => p.cols, v => { p.cols = Math.max(1, Math.round(v)); reLayout(); },
        { int: true, min: 1, max: 40, norender: true, hint: 'Wie viele Segmente NEBENEINANDER (je Reihe) angeordnet werden.' });
      numRow(g.body, 'Reihen (übereinander)', () => Math.ceil(nsel() / Math.max(1, p.cols)),
        v => { const rows = Math.max(1, Math.round(v)); p.cols = Math.max(1, Math.ceil(nsel() / rows)); reLayout(); },
        { int: true, min: 1, max: 40, norender: true, hint: 'Wie viele Reihen ÜBEREINANDER. Legt die Spaltenzahl passend zur Auswahl fest.' });
    }
    // Belegung „was wo": Reihenfolge der Stücke, erster Eintrag = unten links.
    if ((p.arrange || 'pyramid') === 'pyramid' && p.segs.length > 1) {
      hint(g.body, 'Belegung: Erster Eintrag kommt unten links, dann reihenweise nach oben. '
        + 'Mit ▲/▼ festlegen, welches Segment wohin kommt. „Nach Größe" ordnet automatisch '
        + 'die größten Stücke nach unten.');
      const ord = (p.order || []).filter(i => p.segs.indexOf(i) >= 0);
      p.segs.forEach(i => { if (ord.indexOf(i) < 0) ord.push(i); });
      p.order = ord;
      ord.forEach((seg, k) => {
        const row = document.createElement('div'); row.className = 'row';
        const l = document.createElement('label'); l.textContent = (k + 1) + '. ' + T('Segment ') + (seg + 1);
        const wrap = document.createElement('div'); wrap.style.display = 'flex'; wrap.style.gap = '4px';
        const mv = (d, txt) => { const b = document.createElement('button'); b.textContent = txt;
          b.disabled = (k + d < 0 || k + d >= ord.length);
          b.onclick = () => { const t = ord[k + d]; ord[k + d] = ord[k]; ord[k] = t; p.order = ord.slice(); reLayout(); };
          return b; };
        wrap.appendChild(mv(-1, '▲')); wrap.appendChild(mv(1, '▼'));
        row.appendChild(l); row.appendChild(wrap); g.body.appendChild(row);
      });
      { const b = document.createElement('button'); b.textContent = T('Belegung nach Größe (größte unten)');
        b.onclick = () => { p.order = []; reLayout(); };
        g.body.appendChild(b); }
    }
    numRow(g.body, 'Abstand waagerecht (mm)', () => p.gapH, v => { p.gapH = Math.max(1, v); if (state.cfg.gcodeSource === 'plate') render(); }, { step: 1, min: 1, norender: true });
    numRow(g.body, 'Abstand senkrecht (mm)', () => p.gapV, v => { p.gapV = Math.max(1, v); if (state.cfg.gcodeSource === 'plate') render(); }, { step: 1, min: 1, norender: true });
    { const b = document.createElement('button'); b.textContent = T('Automatisches Layout wiederherstellen');
      b.title = T('Verwirft von Hand verschobene Positionen und legt die Stücke neu platzsparend in Reihen.');
      b.onclick = () => { p.pos = {}; p.connEdits = {}; buildSidebar(); if (state.cfg.gcodeSource === 'plate') render(); if (window.Model3D) Model3D.refresh(); };
      g.body.appendChild(b); }
    // Anfahrpunkt (gleiche Werte wie im Segment-G-Code) — für die Platte besonders
    // wichtig: „fester Winkel" setzt den Eindringschlitz bei allen Stücken gleich.
    startRows(g.body, () => { if (state.cfg.gcodeSource === 'plate') render(); if (window.Model3D) Model3D.refresh(); });
    // Schnittparameter (wie im Segment-G-Code — dieselben Werte, hier direkt erreichbar).
    kerfModeRow(g.body, 'model');   // Abbrand-Berechnung: Verhältnis / lokal (Bahngeschwindigkeit)
    feedRow(g.body, 'Vorschub (mm/min)', () => c.feed, v => { c.feed = Math.max(1, v); if (state.cfg.gcodeSource === 'plate') render(); if (window.Model3D) Model3D.refresh(); },
      { step: 10, min: 1, norender: true });
    hint(g.body, 'Die Verbindungswege zwischen den Segmenten werden automatisch '
      + 'kollisionsfrei geführt (nur durch den freien Raum zwischen den Teilen) — sie '
      + 'kreuzen kein Werkstück und sich nie selbst. Sie lassen sich in der Ansicht '
      + '„▤ Platte" auch von Hand als Linienzug bearbeiten (Punkte ziehen/hinzufügen/löschen).');
    { const b = document.createElement('button'); b.textContent = T('Als Platten-Quelle übernehmen'); b.className = 'primary';
      b.onclick = () => { state.cfg.gcodeSource = 'plate'; buildSidebar(); render(); };
      g.body.appendChild(b); }
    // --- Layout bearbeiten (Ansicht „▤ Platte") -------------------------
    hint(g.body, 'In der Ansicht „▤ Platte" bearbeiten: „Bearbeitung starten", dann '
      + 'wählen, ob Segmente verschoben oder der Verbindungspfad (als Linienzug) '
      + 'bearbeitet wird. Ohne Bearbeitungsmodus wird nur geschwenkt/gezoomt.');
    const editing = !!(window.Model3D && Model3D.isPlateEdit && Model3D.isPlateEdit());
    { const b = document.createElement('button');
      b.textContent = editing ? T('Bearbeitung beenden') : T('Bearbeitung starten');
      if (editing) b.className = 'primary';
      b.onclick = () => { if (!window.Model3D) return; Model3D.setPlateEdit(!editing);
        if (!editing) Model3D.setView('plate');
        buildSidebar(); };
      g.body.appendChild(b); }
    if (editing) {
      selectRow(g.body, 'Was bearbeiten',
        [['pieces', T('Segmente verschieben')], ['conns', T('Verbindungspfad (Linienzug)')]],
        () => (Model3D.getPlateEditMode ? Model3D.getPlateEditMode() : 'pieces'),
        v => { Model3D.setPlateEditMode(v); },
        'Segmente = Stücke per Maus verschieben. Verbindungspfad = die grünen Wege '
        + 'als Linienzug bearbeiten: Punkt ziehen = verschieben, auf die Linie klicken '
        + '= Punkt einfügen, Doppelklick auf einen Punkt = löschen. Von Hand bearbeitete '
        + 'Wege sind orange.');
    }
    boolRow(g.body, 'Fahrwege anzeigen', () => (window.Model3D && Model3D.isPlateTravel && Model3D.isPlateTravel()),
      v => { if (window.Model3D) Model3D.setPlateTravel(v); },
      'Zeigt in der Ansicht „▤ Platte" die Fahrwege des Portals (Verbindungen, grün/orange). '
      + 'Ausschalten blendet sie aus — dann bleiben nur die Querschnitte der Segmente (Sollkontur, '
      + 'Segmentfarbe) und die Schnittspur (rot, abbrandkompensiert — wo der Draht wirklich fährt). '
      + 'Beim Bearbeiten des Verbindungspfads sind sie immer sichtbar.');
    kerfTrueRow(g.body, 'model');
    { const b = document.createElement('button'); b.textContent = T('Verbindungen auf Automatik zurücksetzen');
      b.onclick = () => { if (window.__model3dPlateApply) window.__model3dPlateApply({ resetConns: true }); };
      g.body.appendChild(b); }
    // Genaue Position je Segment (X/Y) — überschreibt das Auto-Raster.
    if (p.segs.length) {
      hint(g.body, 'Position je Segment (auch per Maus in der Ansicht „▤ Platte" verschiebbar). '
        + 'Leer = Auto-Raster.');
      const cur = {}; try { platePlacements().forEach(pl => cur[pl.seg] = pl); } catch (e) {}
      p.segs.slice().sort((a, b) => a - b).forEach(seg => {
        const pl = cur[seg] || { dh: 0, dv: 0 };
        const row = document.createElement('div'); row.className = 'row';
        const l = document.createElement('label'); l.textContent = T('Segment ') + (seg + 1) + ' X/Y';
        const wrap = document.createElement('div'); wrap.style.display = 'flex'; wrap.style.gap = '4px';
        const mk = (get, axis) => { const inp = document.createElement('input'); inp.type = 'text'; inp.inputMode = 'decimal'; inp.value = (+get()).toFixed(0); inp.style.width = '100%';
          inp.oninput = () => { const v = parseNum(inp.value); if (isNaN(v)) return; const base = p.pos[seg] || { dh: pl.dh, dv: pl.dv }; p.pos[seg] = { dh: axis === 'x' ? v : base.dh, dv: axis === 'y' ? v : base.dv }; if (state.cfg.gcodeSource === 'plate') render(); if (window.Model3D) Model3D.refresh(); };
          return inp; };
        wrap.appendChild(wrapWithSpinner(mk(() => (p.pos[seg] ? p.pos[seg].dh : pl.dh), 'x'), { step: 1 }));
        wrap.appendChild(wrapWithSpinner(mk(() => (p.pos[seg] ? p.pos[seg].dv : pl.dv), 'y'), { step: 1 }));
        row.appendChild(l); row.appendChild(wrap); g.body.appendChild(row);
      });
      { const b = document.createElement('button'); b.textContent = T('Positionen zurücksetzen (Auto-Raster)');
        b.onclick = () => { p.pos = {}; buildSidebar(); if (state.cfg.gcodeSource === 'plate') render(); if (window.Model3D) Model3D.refresh(); };
        g.body.appendChild(b); }
    }
    side.appendChild(g.g);
  }

  // --- Reiter „3D-Modell": Laden, Zerlegen, Segmente ------------------
  function buildModelSidebar(side) {
    if (!window.Model3D) return;
    // Nach dem Neubau der Sidebar wieder aufrufbar machen (aus dem Modul).
    window.__model3dRebuildSidebar = () => { buildSidebar(); if (state.activeTab === 'model') Model3D.updateInfo(); };
    const M = Model3D.state;

    const lg = grp('3D-Modell laden', true, 'model', { alwaysOpen: true });
    const load = document.createElement('button');
    load.textContent = T('STL/OBJ laden…'); load.className = 'primary';
    load.onclick = () => App.loadFileVia({ 'model/stl': ['.stl', '.obj'] }, f => {
      Model3D.loadFile(f).then(() => { buildSidebar(); if (state.activeTab === 'model') Model3D.show(); });
    }, 'fileModel3d', 'ldStl');
    lg.body.appendChild(load);
    hint(lg.body, 'Lädt ein Dreiecksnetz (STL binär/ASCII oder Wavefront-OBJ). Es wird '
      + 'entlang einer Achse durch senkrechte Schnittebenen in einzelne Segmente zerlegt.');
    if (window.SimModel) {
      const sim = document.createElement('button');
      sim.textContent = T('Flugzeug aus Flugsimulator…');
      sim.onclick = async () => {
        const acc = { 'model/gltf+json': ['.gltf', '.glb', '.bin', '.ac', '.obj', '.him', '.msh'] };
        let files = null;
        if (window.showOpenFilePicker) {
          try { files = await Promise.all((await window.showOpenFilePicker({ id: 'ldSim', multiple: true,
            types: [{ description: T('Flugsimulator-Modelle'), accept: acc }] })).map(h => h.getFile())); }
          catch (e) { if (e && e.name === 'AbortError') return; }
        }
        const go = fs => Model3D.loadFile(fs).then(() => { buildSidebar(); if (state.activeTab === 'model') Model3D.show(); });
        if (files) return go(files);
        const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true;
        inp.accept = '.gltf,.glb,.bin,.ac,.obj,.him,.msh';
        inp.onchange = () => { if (inp.files.length) go(Array.from(inp.files)); };
        inp.click();
      };
      lg.body.appendChild(sim);
      hint(lg.body, 'X-Plane (.obj, OBJ8), FlightGear (.ac) und MSFS 2020/2024 bzw. andere '
        + 'glTF-Modelle (.gltf zusammen mit der zugehörigen .bin wählen, oder .glb). Meter → mm, '
        + 'Y-oben → Z-oben. Nur die erste LOD-Stufe, bewegliche Teile in Ruhelage. '
        + 'FSX/P3D-.mdl und verschlüsselte Marketplace-Modelle sind nicht lesbar.');
    }
    side.appendChild(lg.g);

    if (!Model3D.hasModel()) return;

    const tg = grp('Segmentteilung', true, 'model');
    selectRow(tg.body, 'Schnittachse (Spannweite)',
      [['0', 'X'], ['1', 'Y'], ['2', 'Z']],
      () => String(M.axis), v => { Model3D.setAxis(+v); buildSidebar(); },
      'Die Ebenen stehen senkrecht auf dieser Achse. Standard ist die längste '
      + 'Ausdehnung des Modells.');
    // Konturen + Lückenweite legen fest, WIE die Ebenen das Modell schneiden —
    // nur vor dem Zerlegen wählbar, danach gesperrt (bis „Zerlegung aufheben").
    const liveCt = () => { if (state.cfg.gcodeSource === 'model' || state.cfg.gcodeSource === 'plate') render(); Model3D.refresh(); };
    const CT_OPTS = [['both', 'Außen- und Innenkonturen'], ['outer', 'nur Außenkontur'], ['inner', 'nur Innenkonturen']];
    if (!Model3D.isSegmented()) {
      selectRow(tg.body, 'Konturen', CT_OPTS,
        () => Model3D.getContourMode(), v => { Model3D.setContourMode(v); buildSidebar(); liveCt(); },
        'Legt vor dem Zerlegen fest, welche Konturen die Schnittebenen aus dem Modell übernehmen. '
        + '„Außen- und Innenkonturen": Hohlräume bleiben als Löcher erhalten. „nur Außenkontur": '
        + 'Hohlräume werden gefüllt, das Segment ist massiv. „nur Innenkonturen": nur die Hohlräume '
        + 'werden zu Segmenten (z. B. als Kern). Innenleben wie Spanten oder verdeckte Bauteile '
        + 'fällt in allen Fällen weg. Nach dem Zerlegen nicht mehr änderbar.');
      numRow(tg.body, 'Netzlücken schließen bis (mm)', () => +Model3D.getGapTol().toPrecision(3),
        v => { Model3D.setGapTol(v); liveCt(); },
        { step: 0.5, min: 0, norender: true,
          hint: 'Offene Netze (z. B. OBJ aus Baugruppen) haben an den Schnittebenen Lücken. '
            + 'Offene Kantenenden bis zu dieser Weite werden gerade verbunden; ist der Schnitt danach '
            + 'noch offen, wird die Weite automatisch schrittweise erhöht. Standard: 2 % des Querschnitts.' });
      if (!Model3D.isGapTolAuto()) {
        const ga = document.createElement('button'); ga.textContent = T('Lückenweite automatisch');
        ga.onclick = () => { Model3D.setGapTol(null); buildSidebar(); liveCt(); };
        tg.body.appendChild(ga);
      }
    } else {
      const lbl = (CT_OPTS.find(o => o[0] === Model3D.getContourMode()) || CT_OPTS[0])[1];
      hint(tg.body, T('Konturen: ') + T(lbl) + T(' — beim Zerlegen festgelegt. Zum Ändern die Zerlegung aufheben.'));
      const un = document.createElement('button'); un.textContent = T('Zerlegung aufheben');
      un.onclick = () => { Model3D.unsegment(); buildSidebar(); liveCt(); };
      tg.body.appendChild(un);
    }
    // Auflösung der abgeleiteten Querschnitte (wirkt auf Anzeige + Schnittkontur/G-Code).
    { const c = mgCfg();
      const liveSec = () => { if (state.cfg.gcodeSource === 'model' || state.cfg.gcodeSource === 'plate') render(); if (window.Model3D) Model3D.refresh(); };
      numRow(tg.body, 'Punkte je Profil (mind.)', () => c.N, v => { c.N = Math.max(8, Math.round(v)); liveSec(); },
        { int: true, min: 8, max: 2000, norender: true,
          hint: 'Mindest-Auflösung beim Korrespondieren der beiden Stirnprofile. Der Schnitt folgt '
            + 'der abgeleiteten Querschnittkurve — deren Feinheit stellt „Querschnitt-Punktdichte" ein.' });
      numRow(tg.body, 'Querschnitt-Punktdichte (×)', () => (window.Model3D ? Model3D.getSectionDensity() : 1),
        v => { if (window.Model3D) Model3D.setSectionDensity(v); liveSec(); },
        { step: 0.5, min: 0.2, max: 16, norender: true,
          hint: 'Feinheit der aus dem STL abgeleiteten Querschnitte (Anzeige UND Schnittkontur). '
            + '1 = Standard. Höher = mehr Stützpunkte → rundere Konturen bei feinen/gekrümmten Modellen '
            + '(kostet etwas Leistung); niedriger = weniger Punkte, mehr Tempo. Wirkt auf Schnittspuren, '
            + 'Profile und die Segmentpaar-Ansicht. Bei eckigen Querschnitten hier erhöhen.' }); }
    // Gleichmäßig teilen
    let parts = Math.max(2, (M.planes.length + 1));
    numRow(tg.body, 'In N gleiche Teile', () => parts, v => { parts = Math.max(1, Math.round(v)); },
      { int: true, min: 1, max: 200, norender: true, hint: 'Setzt N−1 gleichmäßig verteilte Schnittebenen.' });
    const eq = document.createElement('button'); eq.textContent = T('Ebenen gleichmäßig verteilen');
    eq.onclick = () => { Model3D.equalSplit(parts); buildSidebar(); };
    tg.body.appendChild(eq);
    // Ebene manuell hinzufügen
    const b = M.bbox; const lo = b.min[M.axis], hi = b.max[M.axis];
    let atVal = ((lo + hi) / 2);
    numRow(tg.body, 'Ebene bei (mm)', () => (+atVal).toFixed(1), v => { atVal = v; },
      { step: 1, min: lo, max: hi, norender: true });
    const addP = document.createElement('button'); addP.textContent = T('+ Ebene hinzufügen');
    addP.onclick = () => { Model3D.addPlane(+atVal); buildSidebar(); };
    tg.body.appendChild(addP);
    // Liste der Ebenen — jede einzeln per Wert/Tastenregler (↑/↓) verschiebbar.
    const ps = Model3D.boundaries().slice(1, -1);
    if (ps.length) {
      hint(tg.body, T('Schnittebenen (') + ps.length + T(') — Wert überschreiben oder mit ↑/↓ verschieben:'));
      ps.forEach((p, i) => {
        const planeIdx = Model3D.planeIndexOf(p);   // stabiler Index in M.planes (während des Editierens)
        const row = document.createElement('div'); row.className = 'row';
        const l = document.createElement('label'); l.textContent = AXIS_L(M.axis) + ' ' + (i + 1);
        const wrap = document.createElement('div'); wrap.style.display = 'flex'; wrap.style.gap = '4px';
        const inp = document.createElement('input'); inp.type = 'text'; inp.inputMode = 'decimal';
        inp.value = p.toFixed(1); inp.style.width = '100%'; inp.title = T('Lage der Ebene (mm)');
        // Live verschieben ohne Sidebar-Neubau → Fokus bleibt, Schnittspur folgt sofort.
        inp.oninput = () => { const v = parseNum(inp.value); if (!isNaN(v)) Model3D.setPlaneIndex(planeIdx, v); };
        const del = document.createElement('button'); del.textContent = '✕'; del.style.color = 'var(--bad)'; del.style.flex = '0 0 auto';
        del.onclick = () => { const idx = Model3D.planeIndexOf(p); if (idx >= 0) Model3D.removePlane(idx); buildSidebar(); };
        wrap.appendChild(wrapWithSpinner(inp, { step: 1 })); wrap.appendChild(del);
        row.appendChild(l); row.appendChild(wrap); tg.body.appendChild(row);
      });
      const clr = document.createElement('button'); clr.textContent = T('Alle Ebenen entfernen');
      clr.onclick = () => { Model3D.clearPlanes(); buildSidebar(); };
      tg.body.appendChild(clr);
    }
    const seg = document.createElement('button'); seg.textContent = T('Zerlegen'); seg.className = 'primary';
    seg.onclick = () => { Model3D.segment(); buildSidebar(); };
    tg.body.appendChild(seg);
    side.appendChild(tg.g);
  }
  // STL-Export der Segmente — ganz unten im Reiter „3D-Modell".
  function buildModelStlSidebar(side) {
    if (!window.Model3D) return;
    const M = Model3D.state;
    if (!M.segs || !M.segs.length) return;
    const sg = grp(T('Segmente als STL') + ' (' + M.segs.length + ')', true, 'model');
    const selRow = document.createElement('div'); selRow.className = 'row';
    const sl = document.createElement('label'); sl.textContent = T('Anzeige');
    const sel = document.createElement('select');
    sel.innerHTML = '<option value="all">' + T('alle') + '</option>'
      + M.segs.map((s, i) => '<option value="' + i + '">' + T('nur Segment ') + (i + 1) + '</option>').join('');
    sel.value = String(M.sel);
    sel.onchange = () => { Model3D.select(sel.value === 'all' ? 'all' : +sel.value); };
    selRow.appendChild(sl); selRow.appendChild(sel); sg.body.appendChild(selRow);
    M.segs.forEach((s, i) => {
      const row = document.createElement('div'); row.className = 'row';
      const dim = s.bbox ? [s.bbox.max[0] - s.bbox.min[0], s.bbox.max[1] - s.bbox.min[1], s.bbox.max[2] - s.bbox.min[2]]
        .map(x => x.toFixed(0)).join('×') : '—';
      const l = document.createElement('label');
      l.textContent = T('Segment ') + (i + 1) + ' · ' + dim + ' mm';
      const dl = document.createElement('button'); dl.textContent = T('STL');
      dl.onclick = () => Model3D.exportSegment(i);
      row.appendChild(l); row.appendChild(dl); sg.body.appendChild(row);
    });
    const all = document.createElement('button'); all.textContent = T('Alle Segmente als STL');
    all.onclick = () => Model3D.exportAll(); sg.body.appendChild(all);
    hint(sg.body, 'Jedes Segment wird an den Schnittebenen mit Kappen geschlossen und als '
      + 'binäres STL exportiert.');
    side.appendChild(sg.g);
  }
  function AXIS_L(a) { return ['X', 'Y', 'Z'][a] || 'X'; }

  /* Blendet die Sidebar-Gruppen passend zum aktiven Reiter ein/aus.
   * Gruppen ohne data-tabs bleiben immer sichtbar. */
  function applySidebarFilter() {
    const tab = state.activeTab || 'wing';
    document.querySelectorAll('#side .grp').forEach(g => {
      const tabs = g.dataset.tabs;
      if (!tabs) return;
      g.style.display = tabs.split(/\s+/).indexOf(tab) >= 0 ? '' : 'none';
    });
    applyMenuColors();   // Blau/Violett-Wechsel nur über die sichtbaren Menüs
  }


  // ---- Abbrand-Berechnung JE DESIGNEBENE ------------------------------
  // (2026-09-12 aus dxfshapes.js hierher — der Reiter „DXF-Formen“ ist abwählbar.)
  // Jede Ebene hat ihre eigene Methode; Umschalten wirkt nur dort:
  //   'core'  Kerndesign                    state.cfg.kerfMode
  //   'dxf'   DXF-Formen                    state.dxf.kerfMode
  //   'model' 3D-Modell (Segment + Platte)  state.modelGcode.kerfMode (mgCfg)
  //   'neg'   Negativdesign                 state.cfg.negKerfMode (eigenes Menü „Abbrand")
  function kerfModeOf(lvl) {
    if (lvl === 'dxf') return (state.dxf && state.dxf.kerfMode) || 'ratio';
    if (lvl === 'model') return mgCfg().kerfMode || 'ratio';
    if (lvl === 'neg') return state.cfg.negKerfMode || 'ratio';
    return state.cfg.kerfMode || 'ratio';
  }
  function setKerfModeOf(lvl, v) {
    if (lvl === 'dxf') state.dxf.kerfMode = v;
    else if (lvl === 'model') mgCfg().kerfMode = v;
    else if (lvl === 'neg') state.cfg.negKerfMode = v;
    else state.cfg.kerfMode = v;
  }
  const KERF_MODE_ONLY = {
    core: 'Gilt nur für das Kerndesign — Negativdesign, DXF-Formen und 3D-Modell haben eine eigene Einstellung.',
    dxf: 'Gilt nur für DXF-Formen — Kerndesign, Negativdesign und 3D-Modell haben eine eigene Einstellung.',
    model: 'Gilt nur für das 3D-Modell (Segment und Platte) — Kerndesign, Negativdesign und DXF-Formen haben eine eigene Einstellung.'
  };
  function kerfModeRow(body, lvl) {
    lvl = lvl || 'core';
    App.selectRow(body, 'Abbrand-Berechnung',
      [['ratio', 'Aus Profillängen-Verhältnis'], ['speed', 'Aus Bahngeschwindigkeit (lokal)']],
      () => kerfModeOf(lvl), v => {
        setKerfModeOf(lvl, v); App.buildSidebar();
        if (lvl === 'core') App.renderMaterial();
        if (lvl === 'model' && window.Model3D) Model3D.refresh();
      },
      'Verhältnis: ein Abbrand je Rippe aus dem Verhältnis der Profillängen (Wurzel/außen). '
      + 'Bahngeschwindigkeit: Abbrand lokal je Schnittsegment aus der tatsächlichen Draht-Geschwindigkeit '
      + '— genauer bei komplexen/verwundenen Geometrien. Kalibrier-Stützpunkte: Reiter „Projektübersicht".');
    if (KERF_MODE_ONLY[lvl]) hint(body, KERF_MODE_ONLY[lvl]);
  }

  // ---- Abbrandlinien in wahrer Dicke: Schalter JE DESIGNEBENE (App.KTRUE[view]) ----
  // view: 'core' | 'neg' | 'dxf' | 'model' | 'schrift'; Deckkraft des Bands unter
  // Einstellungen → Farben. data-ktrue=<view> hält die Schalter einer Ebene gleich.
  function kerfTrueRow(body, view) {
    const i = boolRow(body, 'Abbrand in wahrer Dicke', () => App.kerfTrueOn(view), v => App.kerfTrueSet(view, v),
      'Legt unter die Abbrandlinie (Drahtmitte) ein halbtransparentes Band in der echten Breite des '
      + 'Schnittspalts — es reicht von der Sollkontur bis in den Abfall. Gilt nur für diese Ansicht; '
      + 'Deckkraft unter Einstellungen → Farben.');
    if (i) i.dataset.ktrue = view;
    return i;
  }

  // ---- Registry: eigene Top-Level-Namen bereitstellen (automatisch) ----
  Object.assign(App, { kerfModeOf, kerfModeRow, kerfTrueRow });
  Object.assign(App, { AXIS_L, GRP_OPEN_DEFAULT, GRP_PALETTE, HINTS_KEY, MENU_COL_KEY, MENU_REG, NOTES_KEY, applyHintsMode });
  Object.assign(App, { applyMenuColor, applyMenuColors, applyNotesEnabled, applySidebarFilter, areaRow, boolRow, buildModelGcodeSidebar, buildModelScene });
  Object.assign(App, { buildModelSidebar, buildModelStlSidebar, buildNotePop, buildPlateScene, buildPlateSidebar, buildSidebar, closeNotePop, decorateFields });
  Object.assign(App, { decorateHints, decorateNotes, effBlockZ, extTriple, grp, grpColor, grpColorDefault, grpKey });
  Object.assign(App, { grpState, hint, hintHost, mgCfg, mgOpt, mkMini, modelGcode, newSpar });
  Object.assign(App, { noteBuckets, noteGet, noteHas, noteKey, noteSet, numRow, openNotePop, plateCfg });
  Object.assign(App, { plateGcode, platePlacements, profilePicker, refreshNoteMarks, saveMenuColors, scheduleMenuColors, segBox, segCard });
  Object.assign(App, { segmentCutCard, segmentSelectRow, segmentShapeCard, segmentSheetRows, selectRow, setHintsMode, setNotesEnabled, sheetingGroup });
  Object.assign(App, { feedRow, sparEditor, sparPosFields, subhead, txtRow, warn, wingImportGroup, wrapWithSpinner });
  Object.defineProperty(App, 'MENU_COL', { get: () => MENU_COL, set: v => { MENU_COL = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, '_menuColTimer', { get: () => _menuColTimer, set: v => { _menuColTimer = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'hintsMode', { get: () => hintsMode, set: v => { hintsMode = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'notePop', { get: () => notePop, set: v => { notePop = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'notePopKey', { get: () => notePopKey, set: v => { notePopKey = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'notesEnabled', { get: () => notesEnabled, set: v => { notesEnabled = v; }, enumerable: true, configurable: true });
})();
