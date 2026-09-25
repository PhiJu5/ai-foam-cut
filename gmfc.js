/* gmfc.js — Export der Tragfläche als GMFC-Projekt (.cnc)   (Feature „gmfc")
 *
 * GMFC (Gilles Muller Foam Cutter) speichert Projekte als OLE-Compound-Datei mit
 * genau einem Stream „Contents", dessen Inhalt eine MFC-CArchive-Serialisierung
 * ist. Das Layout wurde aus GMFC-4.x-Projektdateien rekonstruiert (Ventus 3 5m,
 * LS3-17) und mit der GMFC-Hilfe („Current Panel Configuration") abgeglichen:
 *
 *   Datei:   i32 0 · f64 101021 (Version) · i32 nPanels · Panel[nPanels] · Tail
 *   Panel:   i32 Typ (1 = Wing profile, 0 = Rumpfsegment; gleicher Aufbau, beim
 *            Rumpf Oberseite 1 Punkt + Unterseite = ganze Kontur) · f64 Sweep Back (mm, Nasenleiste außen ggü.
 *            Wurzel) · f64 0 · i32 2 · i32 1 · f64 Panel length (Spannweite)
 *            · f64 Foam thickness (Blockhöhe) · i32 1 · i32 20 · i32 1 · i32 1 ·
 *            i32 1 · i32 0 · f64 Dihedral (°) · i32 1 · f64 0 ·f64 0 · f64 0 ·
 *            i32 -1 · i32 -1 · i32 0 · f64 20 · i32 -1 · f64 0
 *            · Section(Wurzel) · Profil(Wurzel) · Section(außen) · Profil(außen)
 *            · 10 × Cutout (Holm, hier immer „Inactive")
 *   Section: f64 Basic height (Höhe der Profilsehne im Block) · f64 Chord ·
 *            f64 LE margin · f64 TE margin · f64 TE prolongation · f64 Skin ·
 *            f64 Washout · f64 5 · f64 5 · f64 10 · f64 45 · f64 45 (X-Nase) ·
 *            i32 -1 · i32 -1
 *   Profil:  u8 0 (1 = invertiert) · u16 nOben · nOben × (f64 x, f64 y) [Nase → Endleiste] ·
 *            u16 nUnten · nUnten × (f64 x, f64 y) [Nase → Endleiste] ·
 *            12 × u8 0 · CString Name (u8 Länge + Zeichen)
 *   Cutout:  i32 0 · CString "Inactive" · i32 0 · f64 5 · f64 5 · f64 3 · f64 50 ·
 *            i32 1 · i32 0 · f64 3 · i32 1 · i32 0 · f64 50 · i32 0
 *   Tail:    i32 0 · i32 1 · f64 0 · 4 × i32 1 · CString Schaumtyp · i32 -1 ·
 *            i32 -1 · u8 0
 *
 * Werte, die das eigene Tragflächenmodell nicht kennt (Grundhöhe der Sehne im
 * Block, Schaumtyp in GMFC, Endleisten-Verlängerung …), werden vor dem Export in
 * einem Eingabefenster abgefragt — vorbelegt mit sinnvollen Vorschlägen aus dem
 * Modell (Blockgeometrie, Beplankung, Schnittverlängerung).
 *
 * IMPORT (seit 2026-09-13): dieselbe Struktur wird auch gelesen — ein GMFC-Projekt
 * (z. B. in GMFC importierte und dort synchronisierte Rumpf-Querschnitte, mehrere
 * Segmente) landet als Rippenkette im Reiter „DXF-Formen": je Section eine
 * geschlossene Kontur (Oberseite Nase→Endleiste, Unterseite zurück), mit Sehne
 * skaliert, Nase um die aufsummierte Pfeilung („Sweep back") versetzt, Grundhöhe
 * als Y-Versatz; je Panel ein Segment (Spannweite = Panel length, Blockhöhe =
 * Foam thickness). GMFC hat die Querschnitte punktsynchron resampelt (gleiche
 * Gesamtpunktzahl) — diese Zuordnung wird als Index-Synchronpaare übernommen.
 *
 * Aufruf von außen NUR geschützt: `App.gmfcExport && App.gmfcExport()`,
 * `App.gmfcImportDxf && App.gmfcImportDxf()`, `App.gmfcImportWing && App.gmfcImportWing()`.
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const GMFC_VERSION = 101021;

  // ---------- Binärschreiber (little endian, wachsender Puffer) --------------
  function Writer() { this.buf = new ArrayBuffer(1 << 16); this.dv = new DataView(this.buf); this.len = 0; }
  Writer.prototype.need = function (n) {
    if (this.len + n <= this.buf.byteLength) return;
    let cap = this.buf.byteLength * 2; while (cap < this.len + n) cap *= 2;
    const nb = new ArrayBuffer(cap); new Uint8Array(nb).set(new Uint8Array(this.buf, 0, this.len));
    this.buf = nb; this.dv = new DataView(nb);
  };
  Writer.prototype.u8 = function (v) { this.need(1); this.dv.setUint8(this.len, v & 0xff); this.len += 1; return this; };
  Writer.prototype.u16 = function (v) { this.need(2); this.dv.setUint16(this.len, v & 0xffff, true); this.len += 2; return this; };
  Writer.prototype.i32 = function (v) { this.need(4); this.dv.setInt32(this.len, v | 0, true); this.len += 4; return this; };
  Writer.prototype.u32 = function (v) { this.need(4); this.dv.setUint32(this.len, v >>> 0, true); this.len += 4; return this; };
  Writer.prototype.f64 = function (v) { this.need(8); this.dv.setFloat64(this.len, +v || 0, true); this.len += 8; return this; };
  Writer.prototype.zeros = function (n) { this.need(n); this.len += n; return this; };
  // MFC-CString (ANSI): u8 Länge (<255), sonst 0xFF + u16 Länge; dann die Zeichen.
  Writer.prototype.cstr = function (s) {
    const b = latin1(s);
    if (b.length < 255) this.u8(b.length); else { this.u8(0xff); this.u16(b.length); }
    this.need(b.length); new Uint8Array(this.buf, this.len, b.length).set(b); this.len += b.length; return this;
  };
  Writer.prototype.bytes = function () { return new Uint8Array(this.buf, 0, this.len).slice(); };

  // Zeichen außerhalb Latin-1 durch „_" ersetzen (GMFC ist ein ANSI-Programm).
  function latin1(s) {
    const str = String(s == null ? '' : s), out = [];
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); out.push(c < 256 ? c : 95); }
    return Uint8Array.from(out);
  }

  // ---------- Profil in GMFC-Form: Ober-/Unterseite je Nase → Endleiste -------
  // Erwartet die normierte Selig-Kontur (Endleiste → Oberseite → Nase →
  // Unterseite → Endleiste, Sehne 0…1). Beide Hälften beginnen mit demselben
  // Nasenpunkt — so liegen es auch die GMFC-eigenen Dateien ab.
  function splitProfile(pts) {
    let P = (pts || []).map(p => ({ x: +p.x, y: +p.y })).filter(p => isFinite(p.x) && isFinite(p.y));
    if (P.length < 4) throw new Error(T('Profil hat zu wenige Punkte.'));
    let iLE = 0; for (let i = 1; i < P.length; i++) if (P[i].x < P[iLE].x) iLE = i;
    let up = P.slice(0, iLE + 1).reverse(), lo = P.slice(iLE);
    // Liegt die Kontur „verkehrt" (beginnt unten), Hälften tauschen.
    const mean = a => a.reduce((s, p) => s + p.y, 0) / (a.length || 1);
    if (mean(up) < mean(lo)) { const t = up; up = lo; lo = t; }
    if (up.length > 65000 || lo.length > 65000) throw new Error(T('Profil hat zu viele Punkte für GMFC.'));
    return { up, lo };
  }

  function writeProfile(w, name, pts) {
    const { up, lo } = splitProfile(pts);
    // Kennzeichen-Byte: 1 nur in der (invertiert angelegten) Ventus-Datei, alle
    // übrigen Flügelprojekte haben 0 -> Profil normal (nicht invertiert).
    w.u8(0);
    w.u16(up.length); up.forEach(p => { w.f64(p.x); w.f64(p.y); });
    w.u16(lo.length); lo.forEach(p => { w.f64(p.x); w.f64(p.y); });
    w.zeros(12);
    w.cstr(name || 'Profil');
  }

  function writeSection(w, s) {
    w.f64(s.bh).f64(s.chord).f64(s.mLE).f64(s.mTE).f64(s.teProl).f64(s.skin).f64(s.washout);
    w.f64(5).f64(5).f64(10).f64(45).f64(45);
    w.i32(-1).i32(-1);
  }

  function writeCutoutInactive(w) {
    w.i32(0).cstr('Inactive').i32(0).f64(5).f64(5).f64(3).f64(50).i32(1).i32(0).f64(3).i32(1).i32(0).f64(50).i32(0);
  }

  // Stream „Contents" aus dem (im Dialog bestätigten) Exportmodell erzeugen.
  function buildStream(m) {
    const w = new Writer();
    w.i32(0).f64(GMFC_VERSION).i32(m.panels.length);
    m.panels.forEach(p => {
      // Die beiden Kennzahlen 2/1 stehen so in normalen Flügelprojekten (Ventus);
      // 0/0 stammt aus einer Negativform-Datei und lässt GMFC die Profile als
      // „invertiert" annehmen — deshalb immer 2/1 schreiben.
      w.i32(1).f64(p.sweep).f64(0).i32(2).i32(1);
      w.f64(p.span).f64(p.blockH);
      // Sechste Kennzahl (Offset 64): 1 nur in der invertierten Ventus-Datei, sonst 0.
      w.i32(1).i32(20).i32(1).i32(1).i32(1).i32(0);
      w.f64(p.dih);
      w.i32(1).f64(0).f64(0).f64(0).i32(-1).i32(-1).i32(0).f64(20).i32(-1).f64(0);
      writeSection(w, p.root); writeProfile(w, p.root.name, p.root.pts);
      writeSection(w, p.tip); writeProfile(w, p.tip.name, p.tip.pts);
      for (let k = 0; k < 10; k++) writeCutoutInactive(w);
    });
    w.i32(0).i32(1).f64(0).i32(1).i32(1).i32(1).i32(1).cstr(m.foam || '').i32(-1).i32(-1).u8(0);
    return w.bytes();
  }

  // ---------- OLE-Compound-Container (CFB v3, 512-Byte-Sektoren) -------------
  // Ein Stream „Contents" im Wurzelverzeichnis. Streams unter 4096 Byte müssten
  // laut Spezifikation in den Mini-Stream — deshalb wird der Inhalt notfalls mit
  // Nullen aufgefüllt (GMFC liest nur, was es braucht).
  function buildCompound(data) {
    const SEC = 512, FREE = 0xFFFFFFFF, END = 0xFFFFFFFE, FATSEC = 0xFFFFFFFD;
    if (data.length < 4096) { const d = new Uint8Array(4096); d.set(data); data = d; }
    const nData = Math.ceil(data.length / SEC);
    let nFat = 1; while ((nFat + 1 + nData) > nFat * (SEC / 4)) nFat++;
    if (nFat > 109) throw new Error(T('Datei zu groß für den GMFC-Container.'));
    const nTotal = nFat + 1 + nData, dirSec = nFat, firstData = nFat + 1;
    const out = new Uint8Array(SEC * (1 + nTotal));
    const dv = new DataView(out.buffer);
    // Header
    out.set([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], 0);
    dv.setUint16(24, 0x3E, true); dv.setUint16(26, 3, true); dv.setUint16(28, 0xFFFE, true);
    dv.setUint16(30, 9, true); dv.setUint16(32, 6, true);
    dv.setUint32(44, nFat, true); dv.setUint32(48, dirSec, true);
    dv.setUint32(56, 4096, true); dv.setUint32(60, END, true); dv.setUint32(64, 0, true);
    dv.setUint32(68, END, true); dv.setUint32(72, 0, true);
    for (let i = 0; i < 109; i++) dv.setUint32(76 + 4 * i, i < nFat ? i : FREE, true);
    // FAT
    const fat = (idx, val) => dv.setUint32(SEC * (1 + Math.floor(idx / 128)) + 4 * (idx % 128), val, true);
    for (let i = 0; i < nFat * 128; i++) fat(i, FREE);
    for (let i = 0; i < nFat; i++) fat(i, FATSEC);
    fat(dirSec, END);
    for (let i = 0; i < nData; i++) fat(firstData + i, i === nData - 1 ? END : firstData + i + 1);
    // Verzeichnis (4 Einträge à 128 Byte)
    const dirOff = SEC * (1 + dirSec);
    const entry = (n, name, type, color, left, right, child, start, size) => {
      const o = dirOff + 128 * n;
      for (let i = 0; i < name.length; i++) dv.setUint16(o + 2 * i, name.charCodeAt(i), true);
      dv.setUint16(o + 64, name.length ? 2 * (name.length + 1) : 0, true);
      dv.setUint8(o + 66, type); dv.setUint8(o + 67, color);
      dv.setUint32(o + 68, left, true); dv.setUint32(o + 72, right, true); dv.setUint32(o + 76, child, true);
      dv.setUint32(o + 116, start, true); dv.setUint32(o + 120, size, true);
    };
    entry(0, 'Root Entry', 5, 1, FREE, FREE, 1, END, 0);
    entry(1, 'Contents', 2, 1, FREE, FREE, FREE, firstData, data.length);
    entry(2, '', 0, 1, FREE, FREE, FREE, 0, 0);
    entry(3, '', 0, 1, FREE, FREE, FREE, 0, 0);
    // Daten
    out.set(data, SEC * (1 + firstData));
    return out;
  }

  // ---------- Exportmodell aus dem Tragflächenmodell ableiten ----------------
  const num = (v, d) => (v == null || v === '' || !isFinite(+v)) ? d : +v;
  function minY(pts) { let m = 0; (pts || []).forEach(p => { if (p.y < m) m = p.y; }); return m; }
  function profName(p) { return (p && p.name) ? String(p.name).replace(/\s+/g, ' ').trim() : 'Profil'; }

  function deriveModel() {
    const state = App.state;
    const segs = state.segments || [];
    if (!segs.length) throw new Error(T('Keine Segmente vorhanden.'));
    const cfg = state.cfg || {};
    const sheet = seg => (App.sheetFor ? App.sheetFor(seg) : null);
    let foam = '';
    try { if (App.matIdFor && App.matIdFor('wing') && App.matField) foam = App.matField(App.matIdFor('wing'), 'name', App.matIdFor('wing')) || ''; } catch (e) { foam = ''; }
    const panels = [];
    let bhCarry = null;
    segs.forEach((seg, k) => {
      const rProf = k === 0 ? state.root.profile : segs[k - 1].profile;
      const rChord = num(k === 0 ? state.root.chord : segs[k - 1].chord, 0);
      const rWash = k === 0 ? 0 : num(segs[k - 1].washout, 0);
      const tChord = num(seg.chord, 0), span = num(seg.span, 0);
      const ratio = rChord > 0 ? tChord / rChord : 1;
      const sweep = App.effSweep ? num(App.effSweep(k), 0) : num(seg.sweep, 0);
      const dih = seg.dihMode === 'deg' ? num(seg.dih, 0) : (span > 0 ? Math.atan2(num(seg.dih, 0), span) * 180 / Math.PI : 0);
      const sh = sheet(seg);
      const skinR = sh ? num(sh.root.top, 0) : num(cfg.sheeting, 0);
      const skinT = sh ? num(sh.tip.top, 0) : num(cfg.sheeting, 0);
      const blockH = num(seg.blockH, 60);
      // Grundhöhe der Sehne: erste Wurzel = tiefster Profilpunkt + 10 mm Luft, danach
      // Außenwert des Vorsegments (so wie GMFC selbst die Panels verkettet).
      const bhRoot = bhCarry != null ? bhCarry : Math.ceil(-minY(rProf) * rChord + 10);
      const bhTip = +(bhRoot + span * Math.tan(dih * Math.PI / 180)).toFixed(2);
      bhCarry = bhTip;
      const prop = (v, vt, isProp) => (isProp ? num(v, 0) * ratio : num(vt, num(v, 0)));
      panels.push({
        span, sweep, dih: +dih.toFixed(3), blockH,
        root: { name: profName(rProf), pts: rProf, chord: rChord, bh: bhRoot,
          mLE: num(seg.bLE, 0), mTE: num(seg.bTE, 0), teProl: num(seg.teExt, 0), skin: skinR, washout: rWash },
        tip: { name: profName(seg.profile), pts: seg.profile, chord: tChord, bh: bhTip,
          mLE: +prop(seg.bLE, seg.bLETip, seg.bLEProp).toFixed(2), mTE: +prop(seg.bTE, seg.bTETip, seg.bTEProp).toFixed(2),
          teProl: +prop(seg.teExt, seg.teExtTip, seg.teExtProp).toFixed(2), skin: skinT, washout: num(seg.washout, 0) }
      });
    });
    return { foam, panels, bhMissing: true, foamMissing: !foam };
  }

  // ---------- Eingabefenster --------------------------------------------------
  let modal = null;
  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div'); modal.className = 'modal-backdrop'; modal.id = 'gmfcModal';
    modal.innerHTML =
      '<div class="modal" style="width:min(1100px,96vw);max-width:96vw;max-height:94vh;display:flex;flex-direction:column">' +
      '<div class="head"><h2 id="gmfcTitle"></h2><button class="close-x" id="gmfcClose" title="' + T('Schließen') + '">×</button></div>' +
      '<div class="body" id="gmfcBody" style="flex:1 1 auto;min-height:0;overflow:auto"></div>' +
      '<div class="foot"><div class="mrow"><span class="hint" id="gmfcErr" style="color:var(--warn,#e6b450)"></span><div class="sp"></div>' +
      '<button id="gmfcCancel"></button><button class="primary" id="gmfcOk"></button></div></div></div>';
    document.body.appendChild(modal);
    modal.querySelector('#gmfcClose').onclick = closeModal;
    modal.querySelector('#gmfcCancel').onclick = closeModal;
    modal.addEventListener('mousedown', e => { if (e.target === modal) closeModal(); });
    return modal;
  }
  function closeModal() { if (modal) modal.classList.remove('open'); }

  const ROWS = [
    // [Schlüssel, Beschriftung, Art, Seite('root'|'tip'|null=Panel), Hinweis, fehlend?]
    ['name', 'Profilname', 'text', 'root', 'Name des Wurzelprofils, wie GMFC ihn anzeigt.'],
    ['name', 'Profilname außen', 'text', 'tip', 'Name des Außenprofils.'],
    ['chord', 'Sehne Wurzel (mm)', 'ro', 'root', ''],
    ['chord', 'Sehne außen (mm)', 'ro', 'tip', ''],
    ['span', 'Spannweite Segment (mm)', 'num', null, 'GMFC „Panel length".'],
    ['sweep', 'Pfeilung LE-Versatz (mm)', 'num', null, 'GMFC „Sweep back": Lage der Nasenleiste außen gegenüber der Wurzel (negativ = außen weiter vorne).'],
    ['dih', 'V-Form (°)', 'num', null, 'GMFC „Dihedral": Winkel dieses Segments.'],
    ['blockH', 'Blockhöhe (mm)', 'num', null, 'GMFC „Foam thickness": Höhe des Schaumblocks.'],
    ['bh', 'Grundhöhe Sehne Wurzel (mm)', 'num', 'root', 'GMFC „Basic height": Höhe der Profilsehne (y = 0) über der Blockunterkante. Kennt das eigene Modell nicht — Vorschlag: tiefster Profilpunkt + 10 mm.', true],
    ['bh', 'Grundhöhe Sehne außen (mm)', 'num', 'tip', 'Wie Wurzel; Vorschlag aus V-Form (Wurzelhöhe + Spannweite · tan V).', true],
    ['mLE', 'Rand Nasenleiste Wurzel (mm)', 'num', 'root', 'GMFC „LE margin": Schaum vor der Nase (Vorschlag: Block-Verlängerung Nase).'],
    ['mLE', 'Rand Nasenleiste außen (mm)', 'num', 'tip', ''],
    ['mTE', 'Rand Endleiste Wurzel (mm)', 'num', 'root', 'GMFC „TE margin": Schaum hinter der Endleiste (Vorschlag: Block-Verlängerung Endleiste).'],
    ['mTE', 'Rand Endleiste außen (mm)', 'num', 'tip', ''],
    ['teProl', 'EL-Verlängerung Wurzel (mm)', 'num', 'root', 'GMFC „TE prolongation": Weg des Drahts nach der Endleiste; sollte größer als der Endleisten-Rand sein (Vorschlag: Schnittverlängerung EL).', true],
    ['teProl', 'EL-Verlängerung außen (mm)', 'num', 'tip', '', true],
    ['skin', 'Beplankung Wurzel (mm)', 'num', 'root', 'GMFC „Skin": Schalendicke, die vom Kern abgezogen wird.'],
    ['skin', 'Beplankung außen (mm)', 'num', 'tip', ''],
    ['washout', 'Schränkung Wurzel (°)', 'num', 'root', 'GMFC „Washout".'],
    ['washout', 'Schränkung außen (°)', 'num', 'tip', '']
  ];

  function openDialog(model, onOk) {
    const m = ensureModal();
    m.querySelector('#gmfcTitle').textContent = T('Als GMFC-Projekt (.cnc) exportieren');
    m.querySelector('#gmfcCancel').textContent = T('Abbrechen');
    m.querySelector('#gmfcOk').textContent = T('Exportieren…');
    const altX = m.querySelector('#gmfcAlt'); if (altX) altX.style.display = 'none';
    const err = m.querySelector('#gmfcErr'); err.textContent = '';
    const body = m.querySelector('#gmfcBody'); body.textContent = '';
    const MISS = 'background:rgba(230,180,80,.18);border-color:var(--warn,#e6b450)';

    const h = document.createElement('div'); h.className = 'hint';
    h.textContent = T('Alle Werte werden als GMFC-Segmente (Panels) geschrieben; die Vorschläge stammen aus dem Tragflächenmodell. Gelb hinterlegte Felder kennt das eigene Modell nicht — bitte prüfen und ergänzen. Holmausschnitte werden nicht übertragen (in GMFC als „Inactive" angelegt).');
    body.appendChild(h);

    // Allgemein: Schaumtyp
    const gen = document.createElement('div'); gen.className = 'mrow'; gen.style.margin = '8px 0';
    const lf = document.createElement('label'); lf.textContent = T('Schaumtyp in GMFC (Foam type)');
    const inf = document.createElement('input'); inf.type = 'text'; inf.value = model.foam || ''; inf.style.width = '220px';
    inf.title = T('Name des Schaumtyps, wie er in der GMFC-Schaumverwaltung heißt. Unbekannte Namen setzt GMFC beim Öffnen auf „ungültig" — dann dort neu wählen.');
    if (model.foamMissing) inf.style.cssText += ';' + MISS;
    inf.oninput = () => { if (inf.value.trim()) inf.style.cssText = 'width:220px'; };
    gen.appendChild(lf); gen.appendChild(inf); body.appendChild(gen);

    // Tabelle: Zeilen = Parameter, Spalten = Segmente
    const wrap = document.createElement('div'); wrap.style.overflowX = 'auto';
    const tbl = document.createElement('table'); tbl.className = 'set-table'; tbl.style.whiteSpace = 'nowrap';
    const thead = document.createElement('thead'); const trh = document.createElement('tr');
    const th0 = document.createElement('th'); th0.textContent = T('Parameter'); trh.appendChild(th0);
    model.panels.forEach((p, i) => { const th = document.createElement('th'); th.textContent = T('Segment') + ' ' + (i + 1); th.style.minWidth = '120px'; trh.appendChild(th); });
    thead.appendChild(trh); tbl.appendChild(thead);
    const tb = document.createElement('tbody');
    const inputs = [];   // {panel, side, key, el, type}
    ROWS.forEach(r => {
      const [key, label, type, side, hintTxt, missing] = r;
      const tr = document.createElement('tr');
      const td0 = document.createElement('td'); td0.textContent = T(label); if (hintTxt) td0.title = T(hintTxt); tr.appendChild(td0);
      model.panels.forEach((p, i) => {
        const td = document.createElement('td');
        const src = side ? p[side] : p;
        if (type === 'ro') { td.textContent = (+src[key]).toFixed(1); td.style.color = 'var(--muted)'; }
        else {
          const inp = document.createElement('input'); inp.type = type === 'num' ? 'number' : 'text';
          if (type === 'num') { inp.step = 'any'; inp.value = String(+(+src[key]).toFixed(3)); inp.style.width = '92px'; }
          else { inp.value = src[key] || ''; inp.style.width = '150px'; }
          if (missing) inp.style.cssText += ';' + MISS;
          if (hintTxt) inp.title = T(hintTxt);
          td.appendChild(inp); inputs.push({ panel: i, side, key, el: inp, type });
        }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb); wrap.appendChild(tbl); body.appendChild(wrap);

    m.querySelector('#gmfcOk').onclick = () => {
      err.textContent = '';
      const out = { foam: inf.value.trim(), panels: model.panels.map(p => ({ span: p.span, sweep: p.sweep, dih: p.dih, blockH: p.blockH,
        root: Object.assign({}, p.root), tip: Object.assign({}, p.tip) })) };
      for (const it of inputs) {
        const dst = it.side ? out.panels[it.panel][it.side] : out.panels[it.panel];
        if (it.type === 'num') {
          const v = parseFloat(String(it.el.value).replace(',', '.'));
          if (!isFinite(v)) { err.textContent = T('Ungültiger Wert in Segment') + ' ' + (it.panel + 1) + ': ' + T(ROWS.find(r => r[0] === it.key && r[3] === it.side)[1]); it.el.focus(); return; }
          dst[it.key] = v;
        } else dst[it.key] = it.el.value.trim();
      }
      for (let i = 0; i < out.panels.length; i++) {
        const p = out.panels[i];
        if (!(p.span > 0)) { err.textContent = T('Spannweite muss größer 0 sein (Segment') + ' ' + (i + 1) + ').'; return; }
        if (!(p.blockH > 0)) { err.textContent = T('Blockhöhe muss größer 0 sein (Segment') + ' ' + (i + 1) + ').'; return; }
        if (!(p.root.chord > 0) || !(p.tip.chord > 0)) { err.textContent = T('Sehnen müssen größer 0 sein (Segment') + ' ' + (i + 1) + ').'; return; }
      }
      if (!out.foam) { if (!confirm(T('Kein Schaumtyp angegeben — GMFC verlangt dann beim Öffnen die Auswahl eines Schaumtyps. Trotzdem exportieren?'))) return; }
      closeModal(); onOk(out);
    };
    m.classList.add('open');
  }

  // ---------- Export -------------------------------------------------------
  function fileBase() {
    const state = App.state;
    const n = (state && state.projectName) ? String(state.projectName).trim() : '';
    return (n || 'Tragflaeche').replace(/[\\/:*?"<>|]/g, '_');
  }
  function gmfcExport() {
    let model;
    try { model = deriveModel(); } catch (e) { alert(e.message); return; }
    openDialog(model, out => {
      let file;
      try { file = buildCompound(buildStream(out)); }
      catch (e) { alert(T('GMFC-Export fehlgeschlagen: ') + e.message); return; }
      const name = fileBase() + '.cnc';
      if (typeof App.download === 'function') App.download(name, file.buffer, 'application/octet-stream', 'save');
      else if (App.anchorDownload) App.anchorDownload(name, file.buffer, 'application/octet-stream');
    });
  }

  // =========================================================================
  // ---------- Import: GMFC-Projekt (.cnc) → Reiter „DXF-Formen" -----------
  // =========================================================================
  function Reader(buf) { this.dv = new DataView(buf); this.u8a = new Uint8Array(buf); this.p = 0; }
  Reader.prototype.need = function (n) { if (this.p + n > this.u8a.length) throw new Error(T('Datei unerwartet zu Ende — keine (vollständige) GMFC-Projektdatei.')); };
  Reader.prototype.u8 = function () { this.need(1); return this.u8a[this.p++]; };
  Reader.prototype.u16 = function () { this.need(2); const v = this.dv.getUint16(this.p, true); this.p += 2; return v; };
  Reader.prototype.i32 = function () { this.need(4); const v = this.dv.getInt32(this.p, true); this.p += 4; return v; };
  Reader.prototype.f64 = function () { this.need(8); const v = this.dv.getFloat64(this.p, true); this.p += 8; return v; };
  Reader.prototype.skip = function (n) { this.need(n); this.p += n; };
  Reader.prototype.cstr = function () {
    let n = this.u8(); if (n === 0xff) n = this.u16();
    this.need(n); let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8a[this.p + i]);
    this.p += n; return s;
  };

  // OLE-Compound-Datei lesen und den Stream „Contents" zurückgeben (Uint8Array).
  // Liest FAT/DIFAT sowie den Mini-Stream (kleine Streams < 4096 Byte).
  function readCompound(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    const magic = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    if (u8.length < 512 || magic.some((b, i) => u8[i] !== b)) throw new Error(T('Keine GMFC-Projektdatei (kein OLE-Container).'));
    const SEC = 1 << dv.getUint16(30, true), MINI = 1 << dv.getUint16(32, true);
    const END = 0xFFFFFFFE;
    const nFat = dv.getUint32(44, true), dirStart = dv.getUint32(48, true);
    const miniCut = dv.getUint32(56, true), miniFatStart = dv.getUint32(60, true);
    let difatStart = dv.getUint32(68, true); const nDifat = dv.getUint32(72, true);
    const secOff = i => SEC * (1 + i);
    // FAT-Sektorliste (109 im Header, Rest in DIFAT-Sektoren)
    const fatSecs = [];
    for (let i = 0; i < 109 && fatSecs.length < nFat; i++) { const v = dv.getUint32(76 + 4 * i, true); if (v < 0xFFFFFFFC) fatSecs.push(v); }
    for (let d = 0; d < nDifat && difatStart < 0xFFFFFFFC; d++) {
      const o = secOff(difatStart);
      for (let i = 0; i < SEC / 4 - 1 && fatSecs.length < nFat; i++) { const v = dv.getUint32(o + 4 * i, true); if (v < 0xFFFFFFFC) fatSecs.push(v); }
      difatStart = dv.getUint32(o + SEC - 4, true);
    }
    const fat = idx => { const s = fatSecs[Math.floor(idx / (SEC / 4))]; if (s == null) return END; return dv.getUint32(secOff(s) + 4 * (idx % (SEC / 4)), true); };
    const chain = (start, next) => { const out = []; let s = start, g = 0; while (s < 0xFFFFFFFC && g++ < 1e6) { out.push(s); s = next(s); } return out; };
    const readChain = (start, size) => {
      const secs = chain(start, fat), out = new Uint8Array(size); let w = 0;
      for (const s of secs) { if (w >= size) break; const n = Math.min(SEC, size - w); out.set(u8.subarray(secOff(s), secOff(s) + n), w); w += n; }
      return out;
    };
    // Verzeichnis durchsuchen
    const dirSecs = chain(dirStart, fat);
    let root = null, contents = null;
    for (const s of dirSecs) for (let e = 0; e < SEC / 128; e++) {
      const o = secOff(s) + 128 * e; const type = u8[o + 66]; if (!type) continue;
      const nl = dv.getUint16(o + 64, true); let name = '';
      for (let i = 0; i + 1 < nl; i += 2) { const c = dv.getUint16(o + i, true); if (c) name += String.fromCharCode(c); }
      const ent = { name, type, start: dv.getUint32(o + 116, true), size: dv.getUint32(o + 120, true) };
      if (type === 5 && !root) root = ent;
      if (type === 2 && name === 'Contents') contents = ent;
    }
    if (!contents) throw new Error(T('Kein Stream „Contents" in der Datei — keine GMFC-Projektdatei.'));
    if (contents.size >= miniCut) return readChain(contents.start, contents.size);
    // Kleiner Stream: liegt im Mini-Stream des Wurzeleintrags, Kette über die Mini-FAT.
    if (!root) throw new Error(T('OLE-Container ohne Wurzeleintrag.'));
    const miniStream = readChain(root.start, root.size);
    const miniFat = readChain(miniFatStart, chain(miniFatStart, fat).length * SEC);
    const mdv = new DataView(miniFat.buffer, miniFat.byteOffset, miniFat.byteLength);
    const mnext = i => (4 * i + 4 <= miniFat.length ? mdv.getUint32(4 * i, true) : END);
    const out = new Uint8Array(contents.size); let w = 0;
    for (const s of chain(contents.start, mnext)) { if (w >= contents.size) break; const n = Math.min(MINI, contents.size - w); out.set(miniStream.subarray(MINI * s, MINI * s + n), w); w += n; }
    return out;
  }

  // Stream „Contents" nach dem oben dokumentierten Layout lesen.
  // Ergebnis: { version, foam, panels:[{ sweep, span, blockH, dih, root:{...}, tip:{...} }] }
  // mit Section = { bh, chord, mLE, mTE, teProl, skin, washout, name, inverted, up:[{x,y}], lo:[{x,y}] }.
  function parseStream(bytes) {
    const r = new Reader(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    r.i32(); const version = r.f64(); const nPanels = r.i32();
    if (!(nPanels >= 1 && nPanels < 1000)) throw new Error(T('Datei enthält keine Segmente.'));
    const readSection = () => {
      const s = { bh: r.f64(), chord: r.f64(), mLE: r.f64(), mTE: r.f64(), teProl: r.f64(), skin: r.f64(), washout: r.f64() };
      for (let i = 0; i < 5; i++) r.f64();
      r.i32(); r.i32();
      return s;
    };
    const readProfile = (s) => {
      s.inverted = r.u8() === 1;
      const nu = r.u16(); s.up = []; for (let i = 0; i < nu; i++) s.up.push({ x: r.f64(), y: r.f64() });
      const nl = r.u16(); s.lo = []; for (let i = 0; i < nl; i++) s.lo.push({ x: r.f64(), y: r.f64() });
      r.skip(12);
      s.name = r.cstr();
    };
    const readCutout = () => { r.i32(); r.cstr(); r.i32(); r.f64(); r.f64(); r.f64(); r.f64(); r.i32(); r.i32(); r.f64(); r.i32(); r.i32(); r.f64(); r.i32(); };
    const panels = [];
    for (let k = 0; k < nPanels; k++) {
      const type = r.i32();
      // 1 = Tragflächensegment („Wing profile"), 0 = Rumpfsegment (GMFC-Rumpfmodus:
      // Oberseite 1 Punkt, Unterseite = ganze geschlossene Kontur). Gleicher Aufbau.
      if (type !== 1 && type !== 0) throw new Error(T('Unbekannter Segmenttyp in der GMFC-Datei: ') + type);
      const sweep = r.f64(); r.f64(); r.i32(); r.i32();
      const span = r.f64(), blockH = r.f64();
      for (let i = 0; i < 6; i++) r.i32();
      const dih = r.f64();
      r.i32(); r.f64(); r.f64(); r.f64(); r.i32(); r.i32(); r.i32(); r.f64(); r.i32(); r.f64();
      const root = readSection(); readProfile(root);
      const tip = readSection(); readProfile(tip);
      for (let c = 0; c < 10; c++) readCutout();
      panels.push({ type, sweep, span, blockH, dih, root, tip });
    }
    let foam = '';
    try { r.i32(); r.i32(); r.f64(); r.i32(); r.i32(); r.i32(); r.i32(); foam = r.cstr(); } catch (e) { foam = ''; }
    return { version, foam, panels };
  }

  // Section → geschlossene Kontur in mm. GMFC speichert die SYNCHRONISIERTE
  // Punktfolge („Re-echantillonne") Index für Index: der geschlossene Umlauf ist
  // Unterseite rückwärts (Endleiste → Nase) + Oberseite (Nase → Endleiste); Punkt k
  // dieses Umlaufs gehört bei allen Querschnitten eines Projekts zusammen. Der
  // Teilungspunkt Ober-/Unterseite darf dabei je Querschnitt anders liegen (R3 in
  // Rumpf.cnc: 5 Punkte weiter) — deshalb NICHT je Hälfte, sondern über den ganzen
  // Umlauf zuordnen. Doppelte Punkte (Nase in beiden Hälften, Endleiste mehrfach)
  // werden entfernt; `map` führt den Rohindex k auf den bereinigten Index.
  function sectionLoop(sec) {
    const c = +sec.chord || 1, ySign = sec.inverted ? -1 : 1;
    const raw = sec.lo.slice().reverse().concat(sec.up);
    const same = (a, b) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
    const pts = [], map = new Array(raw.length);
    raw.forEach((p, k) => { if (pts.length && same(pts[pts.length - 1], p)) map[k] = pts.length - 1; else { map[k] = pts.length; pts.push(p); } });
    while (pts.length > 1 && same(pts[0], pts[pts.length - 1])) { const last = pts.length - 1; pts.pop(); for (let k = 0; k < map.length; k++) if (map[k] === last) map[k] = 0; }
    const out = pts.map(p => ({ x: p.x * c, y: (+sec.bh || 0) + ySign * p.y * c }));
    out.closed = true; out.name = sec.name;
    return { pts: out, map, rawN: raw.length };
  }
  function cleanName(n) { return String(n || 'Querschnitt').replace(/\s*-\s*Re-echantillonne\s*$/i, '').replace(/\s+/g, ' ').trim() || 'Querschnitt'; }

  // Segmentgrenze mit Sprung: die Wurzel von Segment k ist nicht dasselbe Profil
  // wie die Außenrippe von Segment k-1 (GMFC erlaubt je Segment eine eigene Wurzel).
  function sectionsDiffer(a, b) {
    if (!a || !b) return false;
    if (cleanName(a.name) !== cleanName(b.name)) return true;
    if (Math.abs((+a.chord || 0) - (+b.chord || 0)) > 1e-6 || Math.abs((+a.bh || 0) - (+b.bh || 0)) > 1e-6) return true;
    if (!!a.inverted !== !!b.inverted || a.up.length !== b.up.length || a.lo.length !== b.lo.length) return true;
    const same = (P, Q) => P.every((p, i) => Math.abs(p.x - Q[i].x) < 1e-9 && Math.abs(p.y - Q[i].y) < 1e-9);
    return !(same(a.up, b.up) && same(a.lo, b.lo));
  }

  // GMFC-Modell → Segmentliste für den Reiter „DXF-Formen". Jedes GMFC-Segment bringt
  // IMMER seine beiden eigenen Profile mit (Wurzel + außen): GMFC erlaubt je Segment
  // eine Wurzel, die nicht die Außenrippe des Vorsegments ist (Rumpf V2: R2_1neu → R2_2),
  // und die Pfeilung bezieht sich auf diese eigene Wurzel.
  // ribs = [Wurzel 1, Außen 1, Wurzel 2, Außen 2, …] (pairs: true), loops ebenso.
  // Identische Querschnitte hintereinander teilen sich nur den Layer, nicht die Rippe.
  function toRibChain(m, fileName) {
    const layers = {}, order = [], ribs = [], segs = [], loops = [];
    const uniq = base => { let n = base, k = 2; while (layers[n]) n = base + ' (' + k++ + ')'; return n; };
    // Kontur ohne Nasenversatz ablegen (Grundhöhe steckt im Y der Kontur); die
    // Pfeilung (aufsummiertes „Sweep back") geht in die Verschiebung X der Rippe.
    let lex = 0, prev = null;
    const addRib = (sec, x) => {
      let name, L;
      if (prev && !sectionsDiffer(prev.sec, sec)) { name = prev.name; L = prev.L; }
      else { name = uniq(cleanName(sec.name)); L = sectionLoop(sec); layers[name] = [L.pts]; order.push(name); }
      loops.push(L); ribs.push({ layer: name, off: { x, y: 0 } });
      prev = { sec, name, L };
    };
    // Synchronpaare = GMFCs Index-Zuordnung (gleiche Rohpunktzahl beider Querschnitte):
    // bis zu 24 Paare gleichmäßig über den Umlauf, beginnend an der Nase der
    // Wurzel; Punktdichte = Rohpunktzahl, damit die Bahn wie in GMFC läuft.
    let gmfcSync = true;
    m.panels.forEach((p, k) => {
      addRib(p.root, lex); lex += +p.sweep || 0; addRib(p.tip, lex);
      const A = loops[2 * k], B = loops[2 * k + 1];
      const sync = [];
      let own = false;
      if (A.rawN === B.rawN && A.rawN > 3) {
        const N = A.rawN; own = true;
        let k0 = 0; for (let i = 1; i < N; i++) if (A.pts[A.map[i]].x < A.pts[A.map[k0]].x) k0 = i;
        const M = Math.max(2, Math.min(24, Math.floor(N / 4)));
        for (let t = 0; t < M; t++) {
          const kk = (k0 + Math.round(t * N / M)) % N, i = A.map[kk], j = B.map[kk];
          if (!sync.some(s => s.i === i || s.j === j)) sync.push({ i, j });
        }
      } else { gmfcSync = false; sync.push({ i: 0, j: 0 }); }
      // gmfcSync: die Index-Zuordnung der Datei bleibt im Segment gespeichert und
      // ist im Reiter per Knopf „Zuordnung wie GMFC" jederzeit wieder wählbar.
      segs.push({ span: +p.span || 0, linkPrev: false, sync, start: 0, dir: 1, density: Math.max(60, A.rawN), densMode: 'total',
        gmfcSync: own ? sync.map(q => ({ i: q.i, j: q.j })) : null,
        block: { heightY: +p.blockH || 0, lenX: 0 } });
    });
    return { file: fileName || 'GMFC', pairs: true, layers, order, ribs, segs, loops, foam: m.foam, version: m.version, gmfcSync };
  }

  // ---------- Import-Vorschau: Punktzuordnung aus der GMFC-Datei zeigen -----
  // Je Segment beide Querschnitte übereinander (Wurzel orange, außen blau) und
  // die Verbindungslinien der GMFC-Zuordnung (Index für Index, jede n-te);
  // die daraus abgeleiteten Synchronpaare sind hervorgehoben und nummeriert.
  function drawSyncPreview(cv, chain, k, every) {
    const A = chain.loops[2 * k], B = chain.loops[2 * k + 1];
    const ox = chain.ribs[2 * k].off.x || 0, oxB = chain.ribs[2 * k + 1].off.x || 0;
    const ctx = cv.getContext('2d'); const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    A.pts.forEach(p => { x0 = Math.min(x0, p.x + ox); x1 = Math.max(x1, p.x + ox); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
    B.pts.forEach(p => { x0 = Math.min(x0, p.x + oxB); x1 = Math.max(x1, p.x + oxB); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
    const pad = 14, sc = Math.min((W - 2 * pad) / Math.max(1e-6, x1 - x0), (H - 2 * pad) / Math.max(1e-6, y1 - y0));
    const cx = (W - (x1 - x0) * sc) / 2, cy = (H - (y1 - y0) * sc) / 2;
    const X = (p, o) => cx + (p.x + o - x0) * sc, Y = p => H - cy - (p.y - y0) * sc;
    const fg = getComputedStyle(document.body).color || '#ccc';
    // Verbindungslinien (jede n-te)
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(140,140,140,.55)';
    if (A.rawN === B.rawN) for (let r = 0; r < A.rawN; r += Math.max(1, every | 0)) {
      const a = A.pts[A.map[r]], b = B.pts[B.map[r]];
      ctx.beginPath(); ctx.moveTo(X(a, ox), Y(a)); ctx.lineTo(X(b, oxB), Y(b)); ctx.stroke();
    }
    const draw = (L, o, col) => { ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath(); L.pts.forEach((p, n) => n ? ctx.lineTo(X(p, o), Y(p)) : ctx.moveTo(X(p, o), Y(p))); ctx.closePath(); ctx.stroke(); };
    draw(A, ox, '#e08a1e'); draw(B, oxB, '#4aa3ff');
    // Synchronpaare hervorheben
    const sync = chain.segs[k].gmfcSync || [];
    ctx.font = '10px sans-serif'; ctx.fillStyle = fg;
    sync.forEach((q, n) => {
      const a = A.pts[q.i], b = B.pts[q.j];
      ctx.strokeStyle = '#57d38c'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(X(a, ox), Y(a)); ctx.lineTo(X(b, oxB), Y(b)); ctx.stroke();
      ctx.fillStyle = '#57d38c'; ctx.beginPath(); ctx.arc(X(a, ox), Y(a), 2.5, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(X(b, oxB), Y(b), 2.5, 0, 7); ctx.fill();
      ctx.fillStyle = fg; ctx.fillText(String(n + 1), (X(a, ox) + X(b, oxB)) / 2 + 3, (Y(a) + Y(b)) / 2 - 3);
    });
  }

  function openImportPreview(chain, m, onChoice) {
    const md = ensureModal();
    md.querySelector('#gmfcTitle').textContent = T('GMFC-Projekt importieren — Punktzuordnung aus der Datei');
    md.querySelector('#gmfcCancel').textContent = T('Abbrechen');
    const ok = md.querySelector('#gmfcOk'); ok.textContent = T('Automatisch synchronisieren (Umkehrpunkte)');
    let alt = md.querySelector('#gmfcAlt');
    if (!alt) { alt = document.createElement('button'); alt.id = 'gmfcAlt'; ok.parentNode.insertBefore(alt, ok); }
    alt.style.display = ''; alt.textContent = T('Zuordnung wie GMFC übernehmen');
    alt.disabled = !chain.gmfcSync;
    const err = md.querySelector('#gmfcErr'); err.textContent = '';
    const body = md.querySelector('#gmfcBody'); body.textContent = '';
    const h = document.createElement('div'); h.className = 'hint';
    h.textContent = chain.gmfcSync
      ? T('So ordnet GMFC die Punkte der Querschnitte einander zu: alle Querschnitte sind auf dieselbe Punktzahl verteilt und werden Index für Index geschnitten (graue Linien = jede n-te Zuordnung, grün = daraus abgeleitete Synchronpaare). Taschen oder Ecken werden dabei nicht einander zugeordnet — bei ungleich großen Taschen passt „Automatisch" (Nase + Umkehrpunkte) meist besser. Beide Varianten lassen sich später im Reiter jederzeit umschalten.')
      : T('Die Querschnitte haben in der Datei unterschiedliche Punktzahlen — GMFC hat sie nicht synchronisiert. Die Synchronpunkte werden automatisch angelegt (Nase + Umkehrpunkte).');
    body.appendChild(h);
    const info = document.createElement('div'); info.className = 'hint';
    info.textContent = T('Datei: ') + (chain.file || '') + ' · ' + m.panels.length + ' ' + T('Segmente') + ' · ' + chain.order.length + ' ' + T('Querschnitte')
      + (chain.gmfcSync ? ' · ' + chain.loops[0].rawN + ' ' + T('Punkte je Querschnitt') : '') + (m.foam ? ' · ' + T('Schaum') + ': ' + m.foam : '');
    body.appendChild(info);
    // Liniendichte
    const ctrl = document.createElement('div'); ctrl.className = 'mrow'; ctrl.style.margin = '6px 0';
    const lab = document.createElement('label'); lab.textContent = T('Zuordnungslinie alle');
    const inp = document.createElement('input'); inp.type = 'number'; inp.min = '1'; inp.max = '100'; inp.step = '1'; inp.value = '6'; inp.style.width = '64px';
    const lab2 = document.createElement('span'); lab2.className = 'hint'; lab2.style.margin = '0'; lab2.textContent = T('Punkte');
    ctrl.appendChild(lab); ctrl.appendChild(inp); ctrl.appendChild(lab2); body.appendChild(ctrl);
    const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px';
    let cvs = [];
    const buildBoxes = () => {
      wrap.textContent = ''; cvs = [];
      chain.segs.forEach((sg, k) => {
        const box = document.createElement('div'); box.style.cssText = 'border:1px solid var(--line);border-radius:6px;padding:6px';
        const cap = document.createElement('div'); cap.className = 'hint'; cap.style.margin = '0 0 4px';
        cap.textContent = T('Segment ') + (k + 1) + ': ' + chain.ribs[2 * k].layer + ' → ' + chain.ribs[2 * k + 1].layer + ' · '
          + T('Spannweite') + ' ' + (+sg.span).toFixed(1) + ' mm';
        const cv = document.createElement('canvas'); cv.width = 330; cv.height = 270; cv.style.display = 'block';
        box.appendChild(cap); box.appendChild(cv); wrap.appendChild(box); cvs.push(cv);
      });
      alt.disabled = !chain.gmfcSync;
    };
    body.appendChild(wrap);
    const redraw = () => cvs.forEach((cv, k) => drawSyncPreview(cv, chain, k, Math.max(1, parseInt(inp.value, 10) || 6)));
    inp.oninput = redraw; buildBoxes(); redraw();
    const leg = document.createElement('div'); leg.className = 'hint';
    leg.textContent = T('Orange = Wurzelquerschnitt (INNEN), blau = Außenquerschnitt (AUSSEN), grau = GMFC-Zuordnung, grün = Synchronpaare.');
    body.appendChild(leg);
    ok.onclick = () => { closeModal(); onChoice('auto', chain); };
    alt.onclick = () => { closeModal(); onChoice('gmfc', chain); };
    md.classList.add('open');
  }

  function applyChain(chain, m, mode) {
    if (typeof App.dxfApplyRibChain !== 'function') throw new Error(T('Der Reiter „DXF-Formen" ist in dieser Ausgabe nicht enthalten.'));
    App.dxfApplyRibChain(chain);
    // Synchronpunkte: GMFC verteilt die Punkte nur gleichmäßig auf gleiche Anzahl
    // (Index für Index), ohne Merkmale wie Taschen zuzuordnen — bei ungleich
    // großen Taschen passt das nicht (Rumpf.cnc: Tasche R1/R2 um 2–15 Punkte
    // verschoben). Standard ist daher die Automatik des DXF-Formen-Reiters (Nase +
    // Umkehrpunkte/Ecken); die GMFC-Index-Zuordnung bleibt je Segment gespeichert
    // und ist dort per Knopf „Zuordnung wie GMFC" wählbar.
    let syncMsg = chain.gmfcSync ? T('Zuordnung wie GMFC (Index) übernommen') : '';
    if ((mode !== 'gmfc' || !chain.gmfcSync) && typeof App.dxfAutoSyncAll === 'function') {
      try { syncMsg = App.dxfAutoSyncAll(); App.buildSidebar(); if (App.render) App.render(); } catch (e) { /* GMFC-Zuordnung bleibt */ }
    }
    if (App.toast) App.toast(T('GMFC-Projekt geladen: ') + m.panels.length + ' ' + T('Segmente') + ', ' + chain.order.length + ' ' + T('Querschnitte')
      + (syncMsg ? ' — ' + syncMsg.split(String.fromCharCode(10)).join(' · ') : ''));
  }

  // opts.preview === false: ohne Vorschau direkt übernehmen (Tests); opts.mode 'auto'|'gmfc'.
  function importFromBuffer(buf, fileName, opts) {
    opts = opts || {};
    const m = parseStream(readCompound(buf));
    if (Math.round(m.version) !== GMFC_VERSION) console.warn('GMFC: unbekannte Dateiversion', m.version);
    const chain = toRibChain(m, fileName);
    if (typeof App.dxfApplyRibChain !== 'function') throw new Error(T('Der Reiter „DXF-Formen" ist in dieser Ausgabe nicht enthalten.'));
    if (opts.preview === false) { applyChain(chain, m, opts.mode || 'auto'); return; }
    openImportPreview(chain, m, (mode, ch) => { try { applyChain(ch || chain, m, mode); } catch (e) { alert(T('GMFC-Import fehlgeschlagen: ') + (e && e.message || e)); } });
  }

  function gmfcImportDxf() {
    const handle = async file => {
      try { importFromBuffer(await file.arrayBuffer(), file.name); }
      catch (e) { alert(T('GMFC-Import fehlgeschlagen: ') + (e && e.message || e)); }
    };
    if (typeof App.loadFileVia === 'function') App.loadFileVia({ 'application/octet-stream': ['.cnc'] }, handle, 'fileCnc', 'ldDxf');
    else { const inp = document.getElementById('fileCnc'); if (inp) inp.click(); }
  }
  // Fallback-Input (ohne File-System-Access-API): steht in der HTML oberhalb der Skripte.
  (function wireInput() {
    const inp = document.getElementById('fileCnc'); if (!inp) return;
    inp.onchange = e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      f.arrayBuffer().then(b => importFromBuffer(b, f.name)).catch(err => alert(T('GMFC-Import fehlgeschlagen: ') + (err && err.message || err)));
    };
  })();

  // ---------- GMFC-Projekt → Tragflächendesigner (Wurzel + Segmente) ----------
  // Gegenstück zum Export: jedes GMFC-Panel wird ein Segment der Tragfläche.
  // Profile (Sehne 0…1, Selig-Reihenfolge), Sehnen, Spannweite, Pfeilung (LE-
  // Versatz), V-Form (Winkel), Schränkung, Blockhöhe, Nasen-/Endleistenrand,
  // Endleisten-Verlängerung und Beplankung werden übernommen. Holmausschnitte
  // (Cutouts) nicht. Rumpf-Projekte (Segmenttyp 0) gehören in „DXF-Formen".
  function sectionProfile(sec) {
    const ySign = sec.inverted ? -1 : 1;
    // Selig: Endleiste → Oberseite → Nase → Unterseite → Endleiste.
    const raw = sec.up.slice().reverse().concat(sec.lo.slice(1)).map(p => ({ x: p.x, y: ySign * p.y }));
    if (raw.length < 4) throw new Error(T('Profil hat zu wenige Punkte.'));
    const prof = (window.Airfoil && Airfoil.normalize) ? Airfoil.normalize(raw) : raw;
    prof.name = cleanName(sec.name);
    return prof;
  }
  function toWingConfig(m) {
    if (!m.panels.length) throw new Error(T('Datei enthält keine Segmente.'));
    if (m.panels.some(p => p.type === 0)) throw new Error(T('Das ist ein GMFC-Rumpfprojekt (geschlossene Querschnitte) — bitte über „GMFC-Projekt (.cnc) in DXF-Formen…" laden.'));
    const mk = App.mkSeg || (o => Object.assign({}, o));
    const p0 = m.panels[0];
    const cfg = { root: { profile: sectionProfile(p0.root), chord: +(+p0.root.chord || 0).toFixed(2), twistRef: 0.25 }, segments: [], joints: [], foam: m.foam || '' };
    const skins = [];
    m.panels.forEach((p, k) => {
      if (k && sectionsDiffer(m.panels[k - 1].tip, p.root)) cfg.joints.push(k + 1);
      const span = +p.span || 0, dih = +p.dih || 0;
      // Grundhöhe: Sprung zur Außenrippe des Vorsegments → Versatz am Wurzelende.
      const prevBh = k ? +m.panels[k - 1].tip.bh || 0 : +p.root.bh || 0;
      const dihRoot = +((+p.root.bh || 0) - prevBh).toFixed(2) || 0;
      skins.push(+p.root.skin || 0, +p.tip.skin || 0);
      cfg.segments.push(mk({
        profile: sectionProfile(p.tip), chord: +(+p.tip.chord || 0).toFixed(2),
        span: +span.toFixed(2), sweep: +(+p.sweep || 0).toFixed(2), sweepMode: 'mm',
        washout: +(+p.tip.washout || 0).toFixed(3), twistRef: 0.25,
        dihMode: 'deg', dih: +dih.toFixed(3), dihRoot,
        blockH: +(+p.blockH || 0).toFixed(1),
        bLE: +(+p.root.mLE || 0).toFixed(2), bLETip: +(+p.tip.mLE || 0).toFixed(2), bLEProp: false,
        bTE: +(+p.root.mTE || 0).toFixed(2), bTETip: +(+p.tip.mTE || 0).toFixed(2), bTEProp: false,
        teExt: +(+p.root.teProl || 0).toFixed(2), teExtTip: +(+p.tip.teProl || 0).toFixed(2), teExtProp: false,
        sheetRoot: +(+p.root.skin || 0).toFixed(2), sheetTip: +(+p.tip.skin || 0).toFixed(2)
      }));
    });
    const uniform = skins.every(v => Math.abs(v - skins[0]) < 1e-6);
    cfg.sheeting = uniform ? skins[0] : null;   // null = je Segment verschieden
    return cfg;
  }
  function applyWing(cfg, fileName) {
    const state = App.state;
    state.root = cfg.root;
    state.segments = cfg.segments;
    state.spars = []; state.pathEdit = {}; state.negEdit = {}; state.negBurnEdit = {}; state.profBase = {};
    state.activeSeg = state.segments.length ? 0 : 'all';
    if (state.cfg) {
      if (state.cfg.align) state.cfg.align.enable = false;
      if (cfg.sheeting != null) { state.cfg.sheeting = cfg.sheeting; state.cfg.sheetMode = 'global'; state.cfg.sheetSides = 'same'; }
      else { state.cfg.sheetMode = 'segment'; state.cfg.sheetSides = 'same'; }
    }
    if (App.buildSidebar) App.buildSidebar(); if (App.render) App.render();
    const jn = cfg.joints.length ? '\n' + T('Hinweis: Segment(e) ') + cfg.joints.join(', ') + T(' beginnen in der Datei mit einem anderen Wurzelprofil als das Vorsegment endet — der Tragflächendesigner kennt je Segment nur eine Außenrippe; die Außenrippe des Vorsegments wird verwendet.') : '';
    const fm = cfg.foam ? '\n' + T('Schaumtyp in GMFC: ') + cfg.foam + T(' (Werkstoff bitte in der Projektübersicht wählen).') : '';
    alert(T('GMFC-Import: ') + (fileName || '') + '\n' + cfg.segments.length + ' ' + T('Segmente, Wurzelsehne ') + cfg.root.chord.toFixed(0) + ' mm.'
      + '\n' + T('Holmausschnitte aus GMFC werden nicht übernommen.') + jn + fm);
  }
  function importWingFromBuffer(buf, fileName) {
    const m = parseStream(readCompound(buf));
    if (Math.round(m.version) !== GMFC_VERSION) console.warn('GMFC: unbekannte Dateiversion', m.version);
    applyWing(toWingConfig(m), fileName);
  }
  function gmfcImportWing() {
    const handle = async file => {
      try { importWingFromBuffer(await file.arrayBuffer(), file.name); }
      catch (e) { alert(T('GMFC-Import fehlgeschlagen: ') + (e && e.message || e)); }
    };
    if (typeof App.loadFileVia === 'function') App.loadFileVia({ 'application/octet-stream': ['.cnc'] }, handle, 'fileCncWing', 'ldDat');
    else { const inp = document.getElementById('fileCncWing'); if (inp) inp.click(); }
  }
  (function wireWingInput() {
    const inp = document.getElementById('fileCncWing'); if (!inp) return;
    inp.onchange = e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      f.arrayBuffer().then(b => importWingFromBuffer(b, f.name)).catch(err => alert(T('GMFC-Import fehlgeschlagen: ') + (err && err.message || err)));
    };
  })();

  Object.assign(App, { gmfcExport, gmfcBuildStream: buildStream, gmfcBuildCompound: buildCompound, gmfcDeriveModel: deriveModel });
  Object.assign(App, { gmfcImportDxf, gmfcReadCompound: readCompound, gmfcParseStream: parseStream, gmfcToRibChain: toRibChain, gmfcImportFromBuffer: importFromBuffer, gmfcDrawSyncPreview: drawSyncPreview,
    gmfcImportWing, gmfcToWingConfig: toWingConfig, gmfcImportWingFromBuffer: importWingFromBuffer });
})();
