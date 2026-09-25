/* wingexport.js — Export des Projekts als Flugzeug für XFLR5 und FLZ_Vortex.
 *
 * Gegenstück zum Import (xflr5.js / flz.js / wingimport.js). Beide Programme
 * rechnen mit einem GANZEN Flugzeug aus mehreren Flächen, der Designer hier
 * dagegen mit halben Tragflächen. Der Export bringt das zusammen:
 *   • Jede Tragfläche des Projekts wird zu einer Fläche des Flugzeugs.
 *   • Lage (Position der Wurzelnase) und Einstellwinkel je Fläche.
 *   • FLZ spiegelt selbst nicht — dort wird die Fläche von Spitze zu Spitze
 *     geschrieben (linke Hälfte umgekehrt mit negativen Breiten).
 *     XFLR5 bekommt die halbe Fläche mit <Symetric>true</Symetric>.
 *
 * Beide Rechenprogramme brauchen zusätzlich Angaben, die im Designer gar nicht
 * vorkommen: die PANELAUFTEILUNG (Rechennetz) und die MASSEN. Genau danach
 * fragt das Exportfenster; die Massen sind aus der Gewichtsschätzung der
 * Projektübersicht vorbelegt.
 *
 * Ausgabeformate:
 *   .flz  natives FLZ_Vortex-Projekt (Text, Windows-1252, CRLF) — mit Profilen
 *   .xfl  natives XFLR5-Projekt (Qt-QDataStream, Big-Endian)    — mit Profilen
 *   .xml  XFLR5 plane-XML — nur Planform, Profile müssen in XFLR5 geladen sein
 */
(function () {
  'use strict';
  const App = window.App, state = App.state;
  const T = App.T;

  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : (d || 0); };

  // Panelverteilungen, in beiden Programmen vorhanden (nur anders benannt).
  const DISTS = [
    { id: 'uni', label: 'gleichmäßig', flz: 'LINEAR', xml: 'UNIFORM', bin: 0 },
    { id: 'cos', label: 'Cosinus (beide Enden dichter)', flz: 'COS', xml: 'COSINE', bin: 1 },
    { id: 'sin', label: 'Sinus (außen dichter)', flz: 'SIN_R', xml: 'SINE', bin: 2 },
    { id: 'isin', label: 'inverser Sinus (innen dichter)', flz: 'SIN_L', xml: 'INVERSE SINE', bin: -2 }
  ];
  const dist = id => DISTS.find(d => d.id === id) || DISTS[0];

  // Rollen im Flugzeug. XFLR5 kennt genau diese vier und höchstens eine je Art;
  // FLZ nummeriert die Flächen nur durch (die Rolle ist dort ohne Bedeutung).
  const ROLES = [
    { id: 'main', label: 'Tragfläche', bin: 0, xml: 'MAINWING' },
    { id: 'second', label: 'zweite Tragfläche (Doppeldecker)', bin: 1, xml: 'SECONDWING' },
    { id: 'elev', label: 'Höhenleitwerk', bin: 2, xml: 'ELEVATOR' },
    { id: 'fin', label: 'Seitenleitwerk', bin: 3, xml: 'FIN' }
  ];
  const role = id => ROLES.find(r => r.id === id) || ROLES[0];

  // ---------- Geometrie einer Tragfläche einsammeln -------------------------

  // Liefert die Rippenkette EINER Tragfläche in Exportform (mm/Grad):
  //   { root:{chord,profile}, segs:[{span,chord,sweep,dih,twist,hingeIn,hingeOut,profile}],
  //     kink } — sweep = LE-Versatz (mm) des Segments, dih = ABSOLUTER V-Winkel
  //   des Segments (°), twist = Schränkung am Außenende (°, Wurzel = 0).
  // Läuft in withWing(), damit die globale Pfeilung (effSweep) und alle
  // abgeleiteten Werte zur richtigen Tragfläche gehören.
  function wingGeom(i) {
    return App.withWing(i, () => {
      const st = App.state;
      const cp = p => { const c = (p || []).map(q => ({ x: q.x, y: q.y })); c.name = p && p.name; return c; };
      const ph = p => !!(window.App.isPlaceholderProfile && App.isPlaceholderProfile(p));
      const out = { root: { chord: num(st.root.chord), profile: cp(st.root.profile),
                            foilName: st.root.foilName || '' },
                    segs: [], kink: false, placeholder: [] };
      if (ph(st.root.profile)) out.placeholder.push(st.root.foilName || T('Wurzelprofil'));
      // V-Form: 'mm' = Höhe des Außenendes über dem Innenende, 'deg' = Winkel
      // RELATIV zum Vorsegment. Beide Programme wollen den ABSOLUTEN Winkel je
      // Segment — deshalb wie in wing.js mitlaufend aufsummieren.
      let cumAng = 0;
      (st.segments || []).forEach((s, k) => {
        const span = num(s.span);
        let ang;
        if (s.dihMode === 'deg') { cumAng += num(s.dih); ang = cumAng; }
        else { ang = span > 0 ? Math.atan2(num(s.dih), span) * R2D : 0; cumAng = ang; }
        if (num(s.dihRoot) !== 0) out.kink = true;   // Knick lässt sich nicht abbilden
        out.segs.push({
          span: span,
          chord: num(s.chord),
          sweep: App.effSweep ? num(App.effSweep(k)) : num(s.sweep),
          dih: ang,
          twist: num(s.washout),
          hingeIn: num(s.hingePct, 25),
          hingeOut: num(s.hingePctTip, num(s.hingePct, 25)),
          // Beginnt hier eine neue Scharnierlinien-Gruppe? Daraus werden unten
          // die Klappengruppen für FLZ vorbelegt.
          groupStart: k === 0 || !!s.hingeGroupStart,
          foilName: s.foilName || '',
          profile: cp(s.profile)
        });
        if (ph(s.profile)) out.placeholder.push(s.foilName || (T('Segment ') + (k + 1)));
      });
      return out;
    });
  }

  // Panels Y der Fläche auf die Segmente verteilen — proportional zur
  // Spannweite, mindestens 1 je Segment, Summe = Vorgabe.
  function splitPanels(segs, total) {
    const n = segs.length;
    if (!n) return [];
    total = Math.max(n, Math.round(total) || n);
    const sum = segs.reduce((a, s) => a + Math.abs(s.span), 0) || 1;
    const raw = segs.map(s => Math.abs(s.span) / sum * total);
    const out = raw.map(v => Math.max(1, Math.floor(v)));
    let rest = total - out.reduce((a, v) => a + v, 0);
    // Restpunkte an die Segmente mit dem größten abgeschnittenen Anteil.
    const order = raw.map((v, k) => ({ k: k, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac);
    for (let j = 0; rest > 0; j = (j + 1) % n) { out[order[j].k]++; rest--; }
    return out;
  }

  // ---------- Profilverwaltung ---------------------------------------------

  // Alle im Export vorkommenden Profile sammeln und EINDEUTIG benennen. XFLR5
  // und FLZ verweisen über den Namen auf das Profil — zwei verschiedene Formen
  // mit gleichem Namen würden sich sonst gegenseitig ersetzen.
  function foilTable(rows) {
    const list = [], byRef = new Map(), used = new Set();
    // `want` = beim Import gemerkter Originalname (root.foilName / seg.foilName).
    // Er hat Vorrang vor prof.name, weil Platzhalterprofile ihren Namen mit dem
    // Zusatz „(Platzhalter …)" tragen — der gehört nicht in die Exportdatei.
    const add = (prof, want) => {
      if (!prof || !prof.length) return '';
      if (byRef.has(prof)) return byRef.get(prof);
      let base = String(want || '').trim() || String(prof.name || '').trim() || T('Profil');
      // Gleiche Form unter gleichem Namen nur einmal aufnehmen.
      const same = list.find(f => f.name === base && f.pts.length === prof.length
        && f.pts.every((p, k) => Math.abs(p.x - prof[k].x) < 1e-9 && Math.abs(p.y - prof[k].y) < 1e-9));
      if (same) { byRef.set(prof, same.name); return same.name; }
      let nm = base;
      for (let k = 2; used.has(nm.toLowerCase()); k++) nm = base + ' (' + k + ')';
      used.add(nm.toLowerCase());
      const rec = { name: nm, pts: prof };
      list.push(rec); byRef.set(prof, nm);
      return nm;
    };
    rows.forEach(r => {
      // Auch an der Geometrie hinterlegen — xflSections() arbeitet nur mit ihr.
      r.rootFoil = r.geom.rootFoil = add(r.geom.root.profile, r.geom.root.foilName);
      r.geom.segs.forEach(s => { s.foil = add(s.profile, s.foilName); });
    });
    return list;
  }

  // ---------- FLZ_Vortex (.flz) --------------------------------------------

  const f5 = v => (isFinite(v) ? v : 0).toFixed(5);

  function flzProfile(name, pts) {
    const L = ['[PROFIL]', 'PROFILDATEINAME=' + name + '.DAT'];
    pts.forEach((p, k) => L.push('PK' + k + '=' + f5(p.x) + ' ' + f5(p.y)));
    L.push('[PROFIL ENDE]');
    return L;
  }

  // Ein Segment der (gespiegelten) Kette.
  //   `left` = true für die gespiegelte linke Hälfte. Davon hängt ab, welche
  //   Kante FLZ als „links" sieht (dort ist es die äußere) und ob die Klappe
  //   gegenläufig läuft (Querruder: nur eine Seite wird invertiert).
  //   `fl` = Klappeneinstellung des Segments aus dem Exportfenster.
  function flzSegment(idx, s, ny, dY, fl, left) {
    const on = fl && fl.on;
    // Klappentiefe an der inneren/äußeren Kante — aus der Lage der
    // Scharnierlinie (% der Sehne von der Endleiste aus).
    const inner = on ? num(fl.depthIn) : 0, outer = on ? num(fl.depthOut) : 0;
    const sideL = left ? outer : inner, sideR = left ? inner : outer;
    return ['[SEGMENT' + idx + ']',
      'SEGMENTBREITE=' + f5((left ? -s.span : s.span) / 1000),
      'PROFILTIEFE=' + f5(s.chord / 1000),
      'BEZUGSPUNKT_PROFILTIEFE=0.00000',
      'VERWINDUNGSWINKEL=' + f5(s.twist),
      'V-FORM_WINKEL=' + f5(s.dih),
      'PFEILWINKEL=' + f5(s.span > 0 ? Math.atan2(s.sweep, s.span) * R2D : 0),
      'BEZUGSPUNKT_PFEILWINKEL=0.00000',
      'ANZAHL PANELS Y=' + ny,
      'VERTEILUNG=' + dY,
      'KLAPPENTIEFE LINKS,RECHTS=' + f5(sideL) + ' ' + f5(sideR),
      'KLAPPENAUSSCHLAG=0.00000',
      'KLAPPENGRUPPE=' + (on ? Math.max(0, Math.round(num(fl.group))) : 0),
      'KLAPPENINVERSE=' + (on && fl.invert && left ? 'TRUE' : 'FALSE'),
      'FLAG_MAN_BEIWERTE=FALSE',
      'ALFA0_MAN=0.00000',
      'CM0_MAN=0.00000']
      .concat(flzProfile(s.foil, s.profile))
      .concat(['[SEGMENT ENDE]']);
  }

  function buildFlz(model) {
    const now = new Date();
    const p2 = n => String(n).padStart(2, '0');
    const stamp = p2(now.getDate()) + '.' + p2(now.getMonth() + 1) + '.' + now.getFullYear()
      + ' ' + p2(now.getHours()) + ':' + p2(now.getMinutes()) + ':' + p2(now.getSeconds());
    const L = ['FLZ_VORTEX Vers. 01.217 15.08.2016', stamp, '', '[FLUGZEUG]',
      'KONSTRUKTEUR=' + model.author,
      'BEZEICHNUNG=' + model.name,
      'NULLPUNKT SICHTBAR=TRUE',
      'POSITION X,Y,Z=0.00000 0.00000 2.00000',
      'BETRACHTUNGSWINKEL X,Y,Z=20.00000 10.00000 0.00000',
      'LAENGE MARKIERUNGSLINIEN=0.05000',
      'ZUSAETZLICHE MASSEN=' + f5(model.extraMass / 1000),
      'ANSTELLWINKEL=0.00000',
      'CA=0.40000',
      'STABILITAETSMASS=0.00000',
      'SCHWERPUNKT X=' + f5(model.cogX / 1000),
      'FLUG_GESCHWINDIGKEIT=15.00000',
      'SCHIEBEWINKEL=0.00000',
      'FLUGHOEHE=0.00000',
      'LUFTDICHTE=1.22500',
      'AUSLEGUNGSNUMMER=4',
      'MAX_INTERATION=15',
      'ANZAHL_NACHLAUFELEMENTE=10',
      'LAENGE_NACHLAUFELEMENTE=1.00000',
      'NACHLAUFKORREKTUR=FALSE',
      'NACHLAUFKORREKTUR_KOMPLETT=FALSE',
      'INTERFERENZ_WIDERSTAND=0.00000',
      'RUMPF_WIDERSTAND=0.00000',
      'RUMPF_QUERSCHNITTFLAECHE=0.00000',
      'BLASENWIDERSTAND_RECHNEN=TRUE'];
    for (let k = 0; k < 4; k++) L.push('GESAMTPOLARBERECHNUNG_HAUPT' + k + '=0 0.00000 0.00000');
    for (let k = 0; k < 4; k++) L.push('GESAMTPOLARBERECHNUNG_EWD' + k + '=-1 0.00000 0.00000');
    L.push('GESAMTPOLARBERECHNUNG_SCHRITTZAHL=1');

    model.rows.forEach((r, wi) => {
      const g = r.geom, dX = dist(r.distX).flz, dY = dist(r.distY).flz;
      const ny = splitPanels(g.segs, r.panelsY);
      L.push('[FLAECHE' + wi + ']',
        'ART=FLUEGEL',
        'BEZEICHNUNG=' + r.name,
        'POSITION X,Y,Z=' + f5(r.x / 1000) + ' ' + f5(r.y / 1000) + ' ' + f5(r.z / 1000),
        'ALFA0_CM0_OPTIMIERUNG=TRUE',
        'EINSTELLWINKEL=' + f5(r.incidence),
        'PROFILTIEFE=' + f5(g.root.chord / 1000),
        'BEZUGSPUNKT_PROFILTIEFE=0.00000',
        'VERWINDUNGSWINKEL=0.00000',
        'ANZAHL PANELS X=' + r.panelsX,
        'VERTEILUNG=' + dX,
        'ANZAHL PANELS VOLUMENDARSTELLUNG=30',
        'MASSE=' + f5(r.mass / 1000),
        'FLAG_MAN_BEIWERTE=FALSE',
        'ALFA0_MAN=0.00000',
        'CM0_MAN=0.00000',
        'ZIRKULATIONSVORGABE=1.00000');
      flzProfile(r.rootFoil, g.root.profile).forEach(x => L.push(x));
      // Spitze zu Spitze: linke Hälfte von außen nach innen (negative Breiten),
      // danach die rechte Hälfte von innen nach außen.
      let idx = 0;
      const fl = k => (r.flaps && r.flaps[k]) || null;
      if (r.mirror) {
        for (let k = g.segs.length - 1; k >= 0; k--)
          flzSegment(idx++, g.segs[k], ny[k], dY, fl(k), true).forEach(x => L.push(x));
      }
      g.segs.forEach((s, k) =>
        flzSegment(idx++, s, ny[k], dY, fl(k), false).forEach(x => L.push(x)));
      L.push('[FLAECHE ENDE]');
    });

    L.push('[FLUGZEUG ENDE]', '', '[SCHALTER]');
    ['BUTTON GESAMT FLUGZEUG DARSTELLUNG', 'BUTTON KLAPPEN WINKEL AUSGABE', 'BUTTON CWI LOKAL',
      'BUTTON CWV LOKAL', 'BUTTON CWG LOKAL', 'BUTTON GAMMA LOKAL', 'BUTTON GAMMA VORGABE',
      'CHECKBOX GAMMA VORGABE INTEGRAL', 'BUTTON CA LOKAL'].forEach(k => L.push(k + '=FALSE'));
    L.push('CHECKBOX CA LOKAL MIN MAX=TRUE');
    ['BUTTON AI LOKAL', 'BUTTON BLASENWARNUNG', 'BUTTON RE LOKAL', 'BUTTON XD', 'BUTTON XS',
      'BUTTON XN'].forEach(k => L.push(k + '=FALSE'));
    L.push('ROTIEREN=TRUE', 'VERSCHIEBEN=FALSE', 'ZOOMEN=FALSE', 'BEARBEITEN=FALSE');
    ['GEFÜLLTE PANELS', 'VERDECKTE LINIEN', 'ANSTROEMVEKTOR_ZEICHNEN', 'FREIE_WIRBEL_ZEICHNEN',
      'GEBUNDENE_WIRBEL_ZEICHNEN', 'SEGMENTKANTENMARKIERUNG_ZEICHNEN', 'PANELNORMALVEKTOREN_ZEICHNEN',
      'PANELKRAFTVEKTOREN_ZEICHNEN', 'VOLUMENMODELL_ZEICHNEN',
      'MOMENTENDREHRICHTUNG_ZEICHNEN'].forEach(k => L.push(k + '=FALSE'));
    L.push('IMMER SPIEGELN=TRUE', '[SCHALTER ENDE]', '', '[EINSTELLUNGEN]',
      'SPLITTERPOS=1058', '[EINSTELLUNGEN ENDE]', '');
    return L.join('\r\n');
  }

  // Windows-1252 kodieren (FLZ liest keine UTF-8-Dateien).
  const CP1252_HI = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
    0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B,
    0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94,
    0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A,
    0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
  function encode1252(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      out[i] = c < 256 ? c : (CP1252_HI[c] != null ? CP1252_HI[c] : 0x3F);
    }
    return out;
  }

  // ---------- XFLR5 plane-XML ----------------------------------------------

  const xesc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const f6 = v => (isFinite(v) ? v : 0).toFixed(6);

  // Rippen einer Fläche für XFLR5: absolute Spannweitenlage, aufsummierter
  // Nasenversatz; die V-Form einer Rippe gilt für das Feld, das dort BEGINNT.
  function xflSections(g) {
    const secs = [{ y: 0, chord: g.root.chord, off: 0, twist: 0, foil: g.rootFoil || '' }];
    let y = 0, off = 0;
    g.segs.forEach(s => {
      y += s.span; off += s.sweep;
      secs.push({ y: y, chord: s.chord, off: off, twist: s.twist, foil: s.foil || '' });
    });
    secs.forEach((sec, k) => {
      sec.dih = g.segs[k] ? g.segs[k].dih : (g.segs.length ? g.segs[g.segs.length - 1].dih : 0);
    });
    return secs;
  }

  function buildXflXml(model) {
    const L = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE explane>', '<explane version="1.0">',
      '  <Units>', '    <length_unit_to_meter>1</length_unit_to_meter>',
      '    <mass_unit_to_kg>1</mass_unit_to_kg>', '  </Units>',
      '  <Plane>', '    <Name>' + xesc(model.name) + '</Name>',
      '    <Description>' + xesc(model.author ? T('Konstrukteur: ') + model.author : '') + '</Description>',
      '    <Inertia>'];
    if (model.extraMass > 0)
      L.push('      <Point_Mass>', '        <Tag>' + xesc(T('Restmasse (Rumpf, RC, Akku)')) + '</Tag>',
        '        <Mass>' + f6(model.extraMass / 1000) + '</Mass>',
        '        <coordinates>' + f6(model.cogX / 1000) + ', 0, 0</coordinates>', '      </Point_Mass>');
    L.push('    </Inertia>', '    <has_body>false</has_body>');
    model.rows.forEach(r => {
      const g = r.geom, R = role(r.role);
      const ny = splitPanels(g.segs, r.panelsY);
      const secs = xflSections(g);
      L.push('    <wing>', '      <Name>' + xesc(r.name) + '</Name>',
        '      <Type>' + R.xml + '</Type>',
        '      <Description></Description>',
        '      <Position>' + f6(r.x / 1000) + ', ' + f6(r.y / 1000) + ', ' + f6(r.z / 1000) + '</Position>',
        '      <Tilt_angle>' + f6(r.incidence) + '</Tilt_angle>',
        '      <Symetric>' + (r.mirror ? 'true' : 'false') + '</Symetric>',
        '      <isFin>' + (R.id === 'fin' ? 'true' : 'false') + '</isFin>',
        '      <isDoubleFin>false</isDoubleFin>', '      <isSymFin>false</isSymFin>',
        '      <Inertia>', '        <Volume_Mass>' + f6(r.mass / 1000) + '</Volume_Mass>', '      </Inertia>',
        '      <Sections>');
      secs.forEach((s, k) => {
        L.push('        <Section>',
          '          <y_position>' + f6(s.y / 1000) + '</y_position>',
          '          <Chord>' + f6(s.chord / 1000) + '</Chord>',
          '          <xOffset>' + f6(s.off / 1000) + '</xOffset>',
          '          <Dihedral>' + f6(s.dih) + '</Dihedral>',
          '          <Twist>' + f6(s.twist) + '</Twist>',
          '          <x_number_of_panels>' + r.panelsX + '</x_number_of_panels>',
          '          <x_panel_distribution>' + dist(r.distX).xml + '</x_panel_distribution>',
          '          <y_number_of_panels>' + (ny[k] || ny[ny.length - 1] || 1) + '</y_number_of_panels>',
          '          <y_panel_distribution>' + dist(r.distY).xml + '</y_panel_distribution>',
          '          <Left_Side_FoilName>' + xesc(s.foil) + '</Left_Side_FoilName>',
          '          <Right_Side_FoilName>' + xesc(s.foil) + '</Right_Side_FoilName>',
          '        </Section>');
      });
      L.push('      </Sections>', '    </wing>');
    });
    L.push('  </Plane>', '</explane>', '');
    return L.join('\n');
  }

  // ---------- XFLR5-Projekt (.xfl) -----------------------------------------
  // Schreibkopf für den Qt-QDataStream (Big-Endian). Spiegelbild des Lesekopfs
  // in xflr5.js; die Feldfolgen stammen aus den serialize…XFL-Funktionen von
  // XFLR5 v6 (mainframe.cpp / plane.cpp / wing.cpp).
  function Wr() { this.buf = new ArrayBuffer(1 << 16); this.v = new DataView(this.buf); this.o = 0; }
  Wr.prototype.need = function (n) {
    if (this.o + n <= this.buf.byteLength) return;
    let cap = this.buf.byteLength;
    while (cap < this.o + n) cap *= 2;
    const nb = new ArrayBuffer(cap);
    new Uint8Array(nb).set(new Uint8Array(this.buf));
    this.buf = nb; this.v = new DataView(nb);
  };
  Wr.prototype.i32 = function (x) { this.need(4); this.v.setInt32(this.o, x | 0); this.o += 4; return this; };
  Wr.prototype.f64 = function (x) { this.need(8); this.v.setFloat64(this.o, isFinite(x) ? x : 0); this.o += 8; return this; };
  Wr.prototype.u8 = function (x) { this.need(1); this.v.setUint8(this.o, x & 0xFF); this.o += 1; return this; };
  Wr.prototype.bool = function (x) { return this.u8(x ? 1 : 0); };
  Wr.prototype.str = function (s) {
    s = String(s == null ? '' : s);
    this.need(4 + 2 * s.length);
    this.v.setUint32(this.o, 2 * s.length); this.o += 4;
    for (let i = 0; i < s.length; i++) { this.v.setUint16(this.o, s.charCodeAt(i)); this.o += 2; }
    return this;
  };
  // QColor, wie xfl::writeQColor: Kennung + je zwei Bytes a,r,g,b + Füller.
  Wr.prototype.color = function (r, g, b) {
    this.u8(1); this.u8(255); this.u8(255);
    this.u8(r); this.u8(r); this.u8(g); this.u8(g); this.u8(b); this.u8(b);
    this.u8(0); this.u8(0);
    return this;
  };
  Wr.prototype.style = function (r, g, b) {
    this.i32(0); this.i32(1); this.i32(0); this.color(r, g, b); this.bool(true);
    return this;
  };
  Wr.prototype.zi = function (n) { for (let i = 0; i < n; i++) this.i32(0); return this; };
  Wr.prototype.zf = function (n) { for (let i = 0; i < n; i++) this.f64(0); return this; };

  // Vorgabe-Polare des Projekts (XFLR5 erwartet sie, benutzt wird sie nur als
  // Vorbelegung des Analyse-Dialogs).
  function xflWPolar(w, mass, cogX) {
    w.i32(200014);
    w.str(''); w.str('');
    w.f64(0); w.f64(0); w.f64(0);
    w.style(255, 0, 0);
    w.i32(2);                                   // VLM
    w.i32(1);                                   // Typ 1 (feste Geschwindigkeit)
    w.bool(false); w.bool(true); w.bool(false); w.bool(true); w.bool(true); w.bool(false);
    w.bool(false); w.f64(0);                    // Bodeneffekt
    w.f64(1.225); w.f64(1.5e-5);                // Dichte, Zähigkeit
    w.i32(1);                                   // Bezugsfläche = Grundriss
    w.bool(false);
    w.f64(mass);
    w.f64(cogX); w.f64(0); w.f64(0);
    w.f64(0); w.f64(0); w.f64(0); w.f64(0);
    w.i32(0);                                   // Steuerflächen
    w.i32(1); w.f64(100); w.f64(1.1);           // Nachlauf
    w.f64(10); w.f64(0); w.f64(0);              // Geschwindigkeit, Alpha, Beta
    w.i32(0);                                   // keine Rechenpunkte
    w.zi(19); w.i32(0);
    w.zf(35); w.zf(4); w.zf(4); w.zf(7);
  }

  function xflWriteWing(w, r, nameFallback) {
    const g = r ? r.geom : null;
    w.i32(100001);
    w.str(r ? r.name : nameFallback);
    w.str('');
    w.color(r ? 110 : 128, r ? 190 : 128, r ? 240 : 128);
    w.bool(r ? !!r.mirror : true);
    if (!g) { w.i32(0); w.f64(0); w.i32(0); w.i32(1); w.zi(18); w.i32(0); w.zf(50); return; }
    const secs = xflSections(g);
    const ny = splitPanels(g.segs, r.panelsY);
    const dx = dist(r.distX).bin, dy = dist(r.distY).bin;
    w.i32(secs.length);
    secs.forEach((s, k) => {
      w.str(s.foil); w.str(s.foil);
      w.f64(s.chord / 1000); w.f64(s.y / 1000); w.f64(s.off / 1000);
      w.f64(s.dih); w.f64(s.twist);
      w.i32(r.panelsX); w.i32(ny[k] || ny[ny.length - 1] || 1);
      w.i32(dx); w.i32(dy);
    });
    w.f64(r.mass / 1000);
    w.i32(0);                    // keine Punktmassen an der Fläche
    w.i32(1);                    // früher bTextures
    w.zi(18);
    w.i32(role(r.role).bin);
    w.zf(50);
  }

  function xflWritePlane(w, model) {
    // XFLR5 hält immer vier Flächen vor; nicht belegte werden als Platzhalter
    // geschrieben und über die Schalter abgeschaltet.
    const slot = ['main', 'second', 'elev', 'fin'].map(id => model.rows.find(r => r.role === id) || null);
    w.i32(100001);
    w.str(model.name); w.str(model.author ? T('Konstrukteur: ') + model.author : '');
    const FALL = ['Main Wing', 'Second Wing', 'Elevator', 'Fin'];
    slot.forEach((r, k) => xflWriteWing(w, r, FALL[k]));
    w.bool(!!slot[1]); w.bool(!!slot[2]); w.bool(!!slot[3]);
    w.bool(false); w.bool(false); w.bool(false);
    slot.forEach(r => {
      w.f64(r ? r.x / 1000 : 0); w.f64(r ? r.y / 1000 : 0);
      w.f64(r ? r.z / 1000 : 0); w.f64(r ? r.incidence : 0);
    });
    w.bool(false);               // kein Rumpf
    w.f64(0); w.f64(0);
    if (model.extraMass > 0) {
      w.i32(1);
      w.f64(model.extraMass / 1000);
      w.f64(model.cogX / 1000); w.f64(0); w.f64(0);
      w.str(T('Restmasse (Rumpf, RC, Akku)'));
    } else w.i32(0);
    w.zi(20); w.zf(50);
  }

  function xflWriteFoil(w, f) {
    w.i32(100007);
    w.str(f.name); w.str('');
    w.style(0, 160, 255);
    w.bool(false); w.bool(false); w.bool(false);        // Mittellinie, Nasen-/Endleistenklappe
    w.zf(6);                                            // Klappenwinkel und -scharniere
    w.i32(f.pts.length);
    f.pts.forEach(p => { w.f64(p.x); w.f64(p.y); });
  }

  // Der Profildesigner von XFLR5 speichert seine Spline-Form im Projekt mit —
  // ohne diesen Block bricht das Einlesen ab. Eine neutrale Vorgabe genügt.
  function xflWriteSplineFoil(w) {
    w.i32(200002);
    w.str('Spline Foil');
    w.style(255, 255, 255);
    w.bool(false); w.bool(false);
    w.i32(3); w.i32(3);
    w.i32(30); w.i32(30);
    const ex = [[0, 0], [0.15, 0.06], [0.5, 0.07], [1, 0]];
    w.i32(ex.length); ex.forEach(p => { w.f64(p[0]); w.f64(p[1]); });
    w.i32(ex.length); ex.forEach(p => { w.f64(p[0]); w.f64(-p[1]); });
    w.i32(1); w.i32(1);
    w.zi(8); w.zf(10);
  }

  function buildXfl(model) {
    const w = new Wr();
    w.i32(200002);
    // Einheiten (Anzeige): mm, mm², kg, m/s, N, N·m — wie in den Projekten,
    // die XFLR5 selbst schreibt. Die Daten stehen unabhängig davon in Metern.
    [3, 3, 1, 0, 0, 0].forEach(u => w.i32(u));
    xflWPolar(w, model.totalMass / 1000, model.cogX / 1000);
    w.i32(1);                    // ein Flugzeug
    xflWritePlane(w, model);
    w.i32(0);                    // keine Polaren
    w.i32(0);                    // keine Betriebspunkte
    w.i32(model.foils.length);
    model.foils.forEach(f => xflWriteFoil(w, f));
    w.i32(0);                    // keine Profilpolaren
    w.i32(0);                    // keine Profil-Betriebspunkte
    xflWriteSplineFoil(w);
    w.i32(0); w.i32(0);          // Druck- und Trägheitseinheit
    w.zi(18); w.zf(50);
    return w.buf.slice(0, w.o);
  }

  // ---------- Planform Creator 2 (.pc2) ------------------------------------
  // PC2 beschreibt EINE halbe Tragfläche über normierte Größen: xn = Anteil der
  // Halbspannweite, cn = Tiefe bezogen auf die Wurzelsehne. Die Lage der Sehnen
  // steckt in einer GERADEN Bezugslinie (Pfeilwinkel + Lage in der Sehne) —
  // deshalb wird sie an die Nasenleiste der Rippenkette angepasst
  // (PC2.fitReference) und der verbleibende Fehler gemeldet.
  function buildPc2(model) {
    const r = model.rows[0];
    const g = r.geom;
    const half = g.segs.reduce((a, s) => a + s.span, 0);
    if (!(half > 0)) throw new Error(T('Tragfläche hat keine Spannweite.'));
    const croot = g.root.chord || 1;

    // Rippen: Wurzel + je Segmentende, mit aufsummierter Lage und Nasenversatz.
    const pts = [{ xn: 0, chord: croot, le: 0 }];
    let y = 0, off = 0;
    g.segs.forEach(s => {
      y += s.span; off += s.sweep;
      pts.push({ xn: y / half, chord: s.chord, le: off });
    });

    const fit = PC2.fitReference(pts, half);

    // Klappen: Tiefe je Rippe aus der Scharnierlinie, Gruppe je Feld. PC2
    // vermerkt die Gruppe an der INNEREN Rippe des Feldes; die Spitzenrippe
    // erbt die des letzten Feldes.
    const flaps = r.flaps || [];
    const hingeAt = (k) => {
      const f = flaps[k], fp = flaps[k - 1];
      if (f && f.on) return 1 - num(f.depthIn) / 100;
      if (fp && fp.on) return 1 - num(fp.depthOut) / 100;
      return null;
    };
    const grpOf = (f) => (f && f.on ? Math.max(0, Math.round(num(f.group))) : 0);
    const sections = pts.map((q, k) => {
      const f = (k < flaps.length) ? flaps[k] : flaps[flaps.length - 1];
      const foil = k === 0 ? g.rootFoil : g.segs[k - 1].foil;
      return { xn: q.xn, cn: q.chord / croot, hingeCn: hingeAt(k),
        flapGroup: grpOf(f), airfoil: foil ? foil + '.dat' : null };
    });

    const spec = {
      name: r.name || model.name,
      description: model.author ? T('Konstrukteur: ') + model.author : '',
      halfspan: half, chordRoot: croot, sweepDeg: fit.sweepDeg,
      cr0: fit.cr0, cr1: fit.cr1, sections: sections,
      panels: { wy: r.panelsY, wx: r.panelsX }
    };
    return { text: JSON.stringify(PC2.build(spec), null, 2) + '\n', maxErr: fit.maxErr };
  }

  // ---------- Fenster -------------------------------------------------------

  const FORMATS = [
    { id: 'flz', label: 'FLZ_Vortex-Projekt (.flz)', ext: '.flz', mime: 'application/octet-stream' },
    { id: 'xfl', label: 'XFLR5-Projekt (.xfl)', ext: '.xfl', mime: 'application/octet-stream' },
    { id: 'xml', label: 'XFLR5 plane-XML (.xml)', ext: '.xml', mime: 'application/xml' },
    { id: 'pc2', label: 'Planform Creator 2 (.pc2)', ext: '.pc2', mime: 'application/json' }
  ];
  const FORMAT_NOTE = {
    flz: 'Natives FLZ_Vortex-Projekt mit allen Profilen. Jede Tragfläche wird gespiegelt (Spitze zu Spitze) geschrieben — genau so, wie FLZ ein Flugzeug erwartet.',
    xfl: 'Natives XFLR5-Projekt mit allen Profilen; in XFLR5 über „File → Open" laden. Die Flächen werden als halbe Tragflächen mit Spiegelung eingetragen.',
    xml: 'Planform als plane-XML; in XFLR5 über „Plane → Import Plane from XML" laden. Enthält KEINE Profilkoordinaten — die Profile müssen in XFLR5 unter den hier vergebenen Namen bereits geladen sein.',
    pc2: 'Planform Creator 2 beschreibt GENAU EINE halbe Tragfläche — es wird die erste angehakte geschrieben, als Trapezfläche (chord_style „Trapezoid") mit Rippen, Scharnierlinie und Klappengruppen. Panels werden übernommen (Verteilung dort immer gleichmäßig). Lage, Einstellwinkel und Massen kennt das Format nicht. Profile stehen nur als Dateiname drin, nicht als Koordinaten.'
  };

  let modal = null, dlg = null;
  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'wexpModal';
    modal.innerHTML =
      '<div class="modal" style="width:min(1250px,96vw);max-width:96vw;max-height:94vh;display:flex;flex-direction:column">' +
      '<div class="head"><h2 id="wexpTitle"></h2><button class="close-x" id="wexpClose" title="' + T('Schließen') + '">×</button></div>' +
      '<div class="body" id="wexpBody" style="flex:1 1 auto;min-height:0;overflow:auto"></div>' +
      '<div class="foot"><div class="mrow"><span class="hint" id="wexpErr" style="color:var(--warn,#e6b450)"></span>' +
      '<div class="sp"></div><button id="wexpCancel"></button>' +
      '<button class="primary" id="wexpOk"></button></div></div></div>';
    document.body.appendChild(modal);
    modal.querySelector('#wexpClose').onclick = close;
    modal.querySelector('#wexpCancel').onclick = close;
    modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });
    return modal;
  }
  function close() { if (modal) modal.classList.remove('open'); }

  function mkSel(opts, val, onChange) {
    const s = document.createElement('select');
    opts.forEach(o => {
      const e = document.createElement('option');
      e.value = o[0]; e.textContent = T(o[1]); s.appendChild(e);
    });
    s.value = val;
    if (onChange) s.onchange = onChange;
    return s;
  }
  function mkNum(val, width, step, onChange) {
    const n = document.createElement('input');
    n.type = 'number'; n.step = step || 'any';
    n.value = String(val);
    n.style.width = (width || 74) + 'px';
    if (onChange) n.oninput = onChange;
    return n;
  }

  // Vorbelegung je Tragfläche: Rolle nach Reihenfolge/Name geraten, Masse aus
  // der Gewichtsschätzung, Panels nach Segmentzahl.
  function defaultRows() {
    const L = App.wingList();
    const rows = [];
    L.forEach((w, i) => {
      let g;
      try { g = wingGeom(i); } catch (e) { return; }
      if (!g.segs.length) return;
      const name = App.wingName(i);
      let rl = 'main';
      if (/slw|seiten|fin|rudder/i.test(name)) rl = 'fin';
      else if (/hlw|höhen|hoehen|leitwerk|elevator|stab/i.test(name)) rl = 'elev';
      else if (rows.some(r => r.role === 'main')) rl = 'elev';
      let mass = 0;
      try { const wt = App.wingWeight(i); mass = wt ? Math.round(wt.total || 0) : 0; } catch (e) { mass = 0; }
      rows.push({
        idx: i, name: name, geom: g, on: true, role: rl,
        x: 0, y: 0, z: 0, incidence: 0, mass: mass, mirror: rl !== 'fin',
        panelsX: 13, distX: 'cos',
        panelsY: Math.max(8, g.segs.length * 8), distY: 'uni'
      });
    });
    // Klappen aus der Scharnierlinie ableiten: Tiefe = Lage der Scharnierlinie
    // am Innen-/Außenende des Segments (% der Sehne von der Endleiste). Die
    // Klappengruppen kommen aus den Scharnierlinien-Gruppen des Designers —
    // Segmente einer Gruppe hängen an derselben Ruderwelle, bekommen also
    // dieselbe Gruppennummer. Durchnummeriert wird über alle Flächen hinweg,
    // damit z. B. das Höhenruder nicht mit den Querrudern ausschlägt.
    let grp = 0;
    rows.forEach(r => {
      r.flaps = r.geom.segs.map(s => {
        if (s.groupStart) grp++;
        return { on: num(s.hingeIn) > 0 || num(s.hingeOut) > 0,
          depthIn: +num(s.hingeIn).toFixed(1), depthOut: +num(s.hingeOut).toFixed(1),
          group: grp, invert: false };
      });
    });
    // Zweite und weitere Flächen hinter die erste setzen (grobe Vorgabe, damit
    // das Flugzeug in XFLR5/FLZ nicht ineinander steckt).
    let first = rows.find(r => r.role === 'main');
    rows.forEach(r => {
      if (r === first || !first) return;
      r.x = Math.round(first.geom.root.chord * 4);
    });
    return rows;
  }

  function open(format) {
    const rows = defaultRows();
    if (!rows.length) { alert(T('Keine Tragfläche mit Segmenten im Projekt.')); return; }
    dlg = {
      format: format || 'flz',
      name: (state.projectName || '').trim() || T('Flugzeug'),
      author: '', extraMass: 0, cogX: 0, rows: rows
    };
    // Schwerpunkt grob auf 33 % der Wurzelsehne der Hauptfläche vorschlagen.
    const main = rows.find(r => r.role === 'main') || rows[0];
    dlg.cogX = Math.round(main.geom.root.chord * 0.33);
    render();
    ensureModal().classList.add('open');
  }

  function totalMass() {
    return dlg.rows.filter(r => r.on).reduce((a, r) => a + num(r.mass), 0) + num(dlg.extraMass);
  }

  function render() {
    const m = ensureModal();
    m.querySelector('#wexpTitle').textContent = T('Flugzeug exportieren (XFLR5 / FLZ_Vortex)');
    m.querySelector('#wexpCancel').textContent = T('Abbrechen');
    m.querySelector('#wexpOk').textContent = T('Exportieren…');
    m.querySelector('#wexpErr').textContent = '';
    const body = m.querySelector('#wexpBody'); body.textContent = '';

    // --- Format ---
    const top = document.createElement('div');
    top.className = 'mrow'; top.style.cssText = 'margin:4px 0 8px;flex-wrap:wrap;gap:10px';
    const lf = document.createElement('label'); lf.textContent = T('Format');
    top.appendChild(lf);
    top.appendChild(mkSel(FORMATS.map(f => [f.id, f.label]), dlg.format,
      e => { dlg.format = e.target.value; render(); }));
    const ln = document.createElement('label'); ln.textContent = T('Flugzeugname');
    top.appendChild(ln);
    const inName = document.createElement('input');
    inName.type = 'text'; inName.value = dlg.name; inName.style.width = '190px';
    inName.oninput = () => { dlg.name = inName.value; };
    top.appendChild(inName);
    const la = document.createElement('label'); la.textContent = T('Konstrukteur');
    top.appendChild(la);
    const inAuth = document.createElement('input');
    inAuth.type = 'text'; inAuth.value = dlg.author; inAuth.style.width = '140px';
    inAuth.oninput = () => { dlg.author = inAuth.value; };
    top.appendChild(inAuth);
    body.appendChild(top);

    const note = document.createElement('div');
    note.className = 'hint';
    note.textContent = T(FORMAT_NOTE[dlg.format]);
    body.appendChild(note);

    const tip = document.createElement('div');
    tip.className = 'hint'; tip.style.margin = '6px 0 10px';
    tip.textContent = T('Panels sind das Rechennetz des Strömungslösers, nicht die Segmente des Schnitts: „Sehne" teilt jedes Profil in Flugrichtung, „Spannweite" die ganze Fläche quer dazu (sie wird unten im Verhältnis der Segmentbreiten aufgeteilt). Mehr Panels = genauer und langsamer; 10–15 über die Sehne und 15–30 über die Halbspannweite sind üblich.');
    body.appendChild(tip);

    // --- Tabelle der Tragflächen ---
    const wrap = document.createElement('div'); wrap.style.overflowX = 'auto';
    const tbl = document.createElement('table'); tbl.className = 'set-table'; tbl.style.whiteSpace = 'nowrap';
    const thead = document.createElement('thead'), trh = document.createElement('tr');
    [['Export', ''], ['Tragfläche', ''], ['Rolle', 'Stellung im Flugzeug. XFLR5 kennt jede Rolle nur einmal; FLZ nummeriert die Flächen nur durch.'],
      ['Lage X (mm)', 'Lage der Wurzelnase im Flugzeug: X nach hinten, Y zur Seite, Z nach oben — gemessen von der Flugzeugnase bzw. vom Nullpunkt.'],
      ['Lage Y (mm)', ''], ['Lage Z (mm)', ''],
      ['Einstellw. (°)', 'Anstellwinkel der ganzen Fläche gegenüber der Flugzeugachse (EWD).'],
      ['Masse (g)', 'Masse der VOLLSTÄNDIGEN Fläche (beide Hälften). Vorbelegt aus der Gewichtsschätzung der Projektübersicht.'],
      ['Panels Sehne', 'Panels in Flugrichtung je Profil.'], ['Verteilung Sehne', ''],
      ['Panels Spannw.', 'Panels über die halbe Fläche, werden auf die Segmente verteilt.'],
      ['Verteilung Spannw.', '']].forEach(([t, ti]) => {
      const th = document.createElement('th');
      th.textContent = T(t); if (ti) th.title = T(ti);
      trh.appendChild(th);
    });
    thead.appendChild(trh); tbl.appendChild(thead);
    const tb = document.createElement('tbody');
    const splitInfo = [];
    dlg.rows.forEach(r => {
      const tr = document.createElement('tr');
      const cell = el => { const td = document.createElement('td'); if (el) td.appendChild(el); tr.appendChild(td); return td; };
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = r.on;
      cb.onchange = () => { r.on = cb.checked; render(); };
      cell(cb);
      cell().textContent = r.name;
      cell(mkSel(ROLES.map(x => [x.id, x.label]), r.role, e => {
        r.role = e.target.value; r.mirror = r.role !== 'fin'; render();
      }));
      cell(mkNum(r.x, 74, 1, e => { r.x = num(e.target.value); }));
      cell(mkNum(r.y, 64, 1, e => { r.y = num(e.target.value); }));
      cell(mkNum(r.z, 64, 1, e => { r.z = num(e.target.value); }));
      cell(mkNum(r.incidence, 64, 0.1, e => { r.incidence = num(e.target.value); }));
      cell(mkNum(r.mass, 74, 1, e => { r.mass = num(e.target.value); refreshMass(); }));
      cell(mkNum(r.panelsX, 62, 1, e => { r.panelsX = Math.max(1, Math.round(num(e.target.value, 1))); }));
      cell(mkSel(DISTS.map(d => [d.id, d.label]), r.distX, e => { r.distX = e.target.value; }));
      const nyIn = mkNum(r.panelsY, 62, 1, e => {
        r.panelsY = Math.max(r.geom.segs.length, Math.round(num(e.target.value, 1)));
        updSplit();
      });
      cell(nyIn);
      cell(mkSel(DISTS.map(d => [d.id, d.label]), r.distY, e => { r.distY = e.target.value; }));
      tb.appendChild(tr);
      splitInfo.push(r);
    });
    tbl.appendChild(tb); wrap.appendChild(tbl); body.appendChild(wrap);

    // Aufteilung der Spannweiten-Panels auf die Segmente zeigen.
    const split = document.createElement('div');
    split.className = 'hint'; split.style.margin = '6px 0 0';
    body.appendChild(split);
    function updSplit() {
      split.textContent = T('Panels je Segment: ') + splitInfo.filter(r => r.on)
        .map(r => r.name + ': ' + splitPanels(r.geom.segs, r.panelsY).join(' · ')).join('   |   ');
    }
    updSplit();

    // --- Klappen (FLZ und PC2 kennen Klappengruppen) ---
    if (dlg.format === 'flz' || dlg.format === 'pc2') {
      const h = document.createElement('div');
      h.style.cssText = 'margin:14px 0 4px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)';
      h.textContent = T('Klappen');
      body.appendChild(h);
      const fh = document.createElement('div');
      fh.className = 'hint';
      fh.textContent = T('Die Klappentiefe ist aus der Lage der Scharnierlinie des Segments abgeleitet (% der Sehne, von der Endleiste gemessen) und hier noch änderbar. Segmente mit derselben Gruppennummer schlagen in FLZ gemeinsam aus — die Vorbelegung folgt den Scharnierlinien-Gruppen des Designers. „Gegenläufig" invertiert die linke Hälfte (Querruder); für Wölbklappen, Höhen- und Seitenruder bleibt es aus.');
      body.appendChild(fh);

      const fwrap = document.createElement('div'); fwrap.style.overflowX = 'auto';
      const ftbl = document.createElement('table'); ftbl.className = 'set-table'; ftbl.style.whiteSpace = 'nowrap';
      const fthead = document.createElement('thead'), ftrh = document.createElement('tr');
      [['Fläche', ''], ['Segment', ''], ['Klappe', 'Ohne Haken bekommt das Segment in FLZ keine Klappe (Tiefe 0).'],
        ['Tiefe innen (%)', 'Klappentiefe am wurzelseitigen Ende, aus der Scharnierlinie abgeleitet.'],
        ['Tiefe außen (%)', 'Klappentiefe am äußeren Ende, aus der Scharnierlinie abgeleitet.'],
        ['Gruppe', 'FLZ-Klappengruppe: Segmente mit gleicher Nummer schlagen gemeinsam aus.'],
        ['gegenläufig', 'Querruder: die linke Hälfte schlägt entgegengesetzt aus (KLAPPENINVERSE).']]
        .forEach(([t, ti]) => {
          const th = document.createElement('th');
          th.textContent = T(t); if (ti) th.title = T(ti);
          ftrh.appendChild(th);
        });
      fthead.appendChild(ftrh); ftbl.appendChild(fthead);
      const ftb = document.createElement('tbody');
      dlg.rows.filter(r => r.on).forEach(r => {
        r.geom.segs.forEach((s, k) => {
          const f = r.flaps[k];
          const tr = document.createElement('tr');
          const cell = el => { const td = document.createElement('td'); if (el) td.appendChild(el); tr.appendChild(td); return td; };
          cell().textContent = r.name;
          cell().textContent = T('Segment ') + (k + 1);
          const cb = document.createElement('input');
          cb.type = 'checkbox'; cb.checked = f.on;
          cb.onchange = () => { f.on = cb.checked; render(); };
          cell(cb);
          const di = mkNum(f.depthIn, 70, 0.1, e => { f.depthIn = num(e.target.value); });
          const dOut = mkNum(f.depthOut, 70, 0.1, e => { f.depthOut = num(e.target.value); });
          const gi = mkNum(f.group, 60, 1, e => { f.group = Math.max(0, Math.round(num(e.target.value))); });
          const iv = document.createElement('input');
          iv.type = 'checkbox'; iv.checked = f.invert;
          iv.onchange = () => { f.invert = iv.checked; };
          [di, dOut, gi, iv].forEach(el => { el.disabled = !f.on; });
          cell(di); cell(dOut); cell(gi); cell(iv);
          ftb.appendChild(tr);
        });
      });
      ftbl.appendChild(ftb); fwrap.appendChild(ftbl); body.appendChild(fwrap);
    }

    // Platzhalter-Warnung: nach einem plane-XML-/PC2-Import stecken NACA-0012-
    // Platzhalter in der Kette. In .flz/.xfl würden die als echte Profilform
    // mitgeschrieben — das ist schlimmer als ein fehlendes Profil.
    const phAll = [];
    dlg.rows.forEach(r => { if (r.on) (r.geom.placeholder || []).forEach(n => {
      if (phAll.indexOf(n) < 0) phAll.push(n); }); });
    if (phAll.length && dlg.format !== 'xml') {
      const w = document.createElement('div');
      w.className = 'hint'; w.style.color = 'var(--warn,#e6b450)';
      w.textContent = T('Achtung: Für diese Profile steckt nur ein Platzhalter im Projekt (NACA 0012), keine echte Form — sie würden so in die Datei geschrieben. Bitte vorher über „Profile (.dat) zuordnen…" laden: ')
        + phAll.join(', ');
      body.appendChild(w);
    }

    // Knick-Warnung (V-Form-Versatz an der Wurzel eines Segments).
    if (dlg.rows.some(r => r.on && r.geom.kink)) {
      const k = document.createElement('div');
      k.className = 'hint'; k.style.color = 'var(--warn,#e6b450)';
      k.textContent = T('Hinweis: Mindestens eine Fläche hat einen Höhenversatz am Segmentanfang („Höhe Profilsehne Wurzel"). XFLR5 und FLZ kennen nur durchgehende V-Form — der Versatz geht beim Export verloren.');
      body.appendChild(k);
    }

    // --- Massen ---
    const mrow = document.createElement('div');
    mrow.className = 'mrow'; mrow.style.cssText = 'margin:12px 0 0;flex-wrap:wrap;gap:10px';
    const le = document.createElement('label'); le.textContent = T('Restmasse (Rumpf, RC, Akku) (g)');
    le.title = T('Alles, was nicht in den Flächen steckt. Wird als Punktmasse im Schwerpunkt eingetragen.');
    mrow.appendChild(le);
    mrow.appendChild(mkNum(dlg.extraMass, 90, 1, e => { dlg.extraMass = num(e.target.value); refreshMass(); }));
    const lc = document.createElement('label'); lc.textContent = T('Schwerpunkt X (mm)');
    lc.title = T('Lage des Schwerpunkts hinter der Nase der Wurzelrippe der Hauptfläche.');
    mrow.appendChild(lc);
    mrow.appendChild(mkNum(dlg.cogX, 80, 1, e => { dlg.cogX = num(e.target.value); }));
    const tot = document.createElement('span');
    tot.className = 'hint'; tot.style.marginLeft = '10px';
    mrow.appendChild(tot);
    body.appendChild(mrow);
    function refreshMass() {
      const g = totalMass();
      tot.textContent = T('Gesamtgewicht: ') + g.toFixed(0) + ' g (' + (g / 1000).toFixed(3) + ' kg)';
    }
    refreshMass();

    m.querySelector('#wexpOk').onclick = doExport;
  }

  async function doExport() {
    const err = modal.querySelector('#wexpErr');
    err.textContent = '';
    const rows = dlg.rows.filter(r => r.on);
    if (!rows.length) { err.textContent = T('Keine Fläche ausgewählt.'); return; }
    if (dlg.format === 'pc2' && rows.length > 1) {
      err.textContent = T('Planform Creator 2 beschreibt genau eine halbe Tragfläche — bitte nur eine anhaken.');
      return;
    }
    if (dlg.format === 'xfl' || dlg.format === 'xml') {
      // XFLR5 kennt jede Rolle genau einmal.
      const seen = new Set();
      for (const r of rows) {
        if (seen.has(r.role)) {
          err.textContent = T('XFLR5 kennt jede Rolle nur einmal — „') + T(role(r.role).label) + T('" ist doppelt vergeben.');
          return;
        }
        seen.add(r.role);
      }
      if (!seen.has('main')) { err.textContent = T('XFLR5 braucht genau eine Fläche als „Tragfläche".'); return; }
    }
    const model = {
      name: dlg.name.trim() || T('Flugzeug'), author: dlg.author.trim(),
      extraMass: num(dlg.extraMass), cogX: num(dlg.cogX),
      rows: rows, totalMass: totalMass()
    };
    let data, fmt = FORMATS.find(f => f.id === dlg.format);
    try {
      model.foils = foilTable(model.rows);
      if (dlg.format === 'flz') data = encode1252(buildFlz(model));
      else if (dlg.format === 'xfl') data = buildXfl(model);
      else if (dlg.format === 'xml') data = buildXflXml(model);
      else {
        const res = buildPc2(model);
        data = res.text;
        // PC2 kennt nur EINE gerade Bezugslinie; eine Knickfläche lässt sich
        // damit nicht immer exakt beschreiben. Lieber nachfragen als still
        // eine andere Fläche schreiben.
        if (res.maxErr > 0.5 && !confirm(
          T('Die Nasenleiste lässt sich mit der geraden Bezugslinie von PC2 nicht genau abbilden. Größte Abweichung: ')
          + res.maxErr.toFixed(1) + ' mm.\n\n' + T('Trotzdem schreiben?'))) return;
      }
    } catch (e) { err.textContent = T('Fehler: ') + T(e.message); return; }
    const base = (model.name || 'Flugzeug').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Flugzeug';
    close();
    // Eigene Picker-id 'svWing': der Flugzeug-Export ist reines Design (keine
    // Fertigungsdaten) und bleibt darum auch in der Design-Ausgabe (kernp) erlaubt.
    try { await App.exportViaPicker(base + fmt.ext, data, fmt.mime, 'svWing'); }
    catch (e) { if (!e || e.name !== 'AbortError') alert(T('Export fehlgeschlagen: ') + T(e.message)); }
  }

  Object.assign(App, {
    wingExportOpen: open,
    wingExportFlz: () => open('flz'),
    wingExportXflr: () => open('xfl'),
    wingExportPc2: () => open('pc2'),
    // für Tests/Weiterverwendung
    wingExportBuild: { flz: buildFlz, xfl: buildXfl, xml: buildXflXml, pc2: buildPc2,
      foils: foilTable, geom: wingGeom, split: splitPanels, encode1252: encode1252 }
  });
})();
