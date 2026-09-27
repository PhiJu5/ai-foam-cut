/* xflr5.js — Import von Flügelgeometrien aus XFLR5 / plane XML-Dateien.
 *
 * Struktur (…/wing/Sections/Section):
 *   <y_position>  absolute Spannweitenposition der Rippe (Wurzel bei 0)
 *   <Chord>       Sehne an dieser Rippe
 *   <xOffset>     ABSOLUTER Nasen-Versatz (Pfeilung) ggü. der Wurzelnase
 *   <Dihedral>    V-Form des Paneels, das an DIESER Rippe BEGINNT (nach außen)
 *   <Twist>       absolute Schränkung an dieser Rippe
 *   <Left_/Right_Side_FoilName>  Profilname (nur Name — KEINE Koordinaten!)
 *
 * Längen sind in Einheiten von <length_unit_to_meter> (·Wert = Meter).
 * XFLR5 definiert eine HALBE Tragfläche (y = 0 nach außen); <Symetric> spiegelt
 * sie. Das passt direkt auf das Rippenketten-Modell der App.
 *
 * WICHTIG: XFLR5-Wing-XML enthält die ProfilKOORDINATEN nicht, nur die Namen.
 * toWingConfig() setzt daher Platzhalterprofile (mit dem XFLR5-Namen) ein, sofern
 * kein passendes Profil über die Namens-Map `foils` geliefert wird. Die echten
 * Profile lädt man anschließend je Segment als .dat.
 */
(function (global) {
  'use strict';

  const T = (s) => (window.I18N ? window.I18N.t(s) : s);

  function num(v) {
    if (v == null) return 0;
    const n = parseFloat(String(v).trim().replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }
  function txt(el, tag) {
    const n = el ? el.getElementsByTagName(tag)[0] : null;
    return n ? n.textContent : '';
  }
  // Namens-Normalisierung fürs Zuordnen von .dat-Dateien zu Foil-Namen:
  // Groß/Klein + alle Nicht-alphanumerischen Zeichen ignorieren.
  function normName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  // Text -> { unit, wings:[ { name, type, symmetric, tilt, sections:[sec] } ] }
  // sec = { y, chord, xOffset, dihedral, twist, foil }
  function parse(text) {
    if (!global.DOMParser) throw new Error(T('DOMParser nicht verfügbar.'));
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length)
      throw new Error(T('XML nicht lesbar (Syntaxfehler).'));
    const unitTxt = txt(doc.documentElement, 'length_unit_to_meter');
    const unit = unitTxt ? num(unitTxt) : 1;   // Vorgabe: Meter
    const wingEls = doc.getElementsByTagName('wing');
    const wings = [];
    for (let i = 0; i < wingEls.length; i++) {
      const we = wingEls[i];
      const secEls = we.getElementsByTagName('Section');
      const sections = [];
      for (let k = 0; k < secEls.length; k++) {
        const se = secEls[k];
        sections.push({
          y: num(txt(se, 'y_position')),
          chord: num(txt(se, 'Chord')),
          xOffset: num(txt(se, 'xOffset')),
          dihedral: num(txt(se, 'Dihedral')),
          twist: num(txt(se, 'Twist')),
          foil: (txt(se, 'Left_Side_FoilName') || txt(se, 'Right_Side_FoilName') || 'Profil').trim()
        });
      }
      wings.push({
        name: (txt(we, 'Name') || ('Wing ' + (i + 1))).trim(),
        type: (txt(we, 'Type') || '').trim(),
        symmetric: /true/i.test(txt(we, 'Symetric')),
        tilt: num(txt(we, 'Tilt_angle')),
        sections
      });
    }
    if (!wings.length) throw new Error(T('Kein <wing> in der Datei gefunden.'));
    return { unit: unit || 1, wings };
  }

  // Alle Flügel flach auflisten (für die Auswahl / Meldungen).
  function listWings(parsed) {
    return parsed.wings.map((wg, i) => {
      const s = wg.sections;
      const half = s.length ? (s[s.length - 1].y - s[0].y) * parsed.unit * 1000 : 0;
      return { index: i, ref: wg,
        label: wg.name + (wg.type ? ' [' + wg.type + ']' : '') + ' — ' +
               Math.max(0, s.length - 1) + ' ' + T('Segmente') + ', ' +
               T('Halbspannw.') + ' ' + half.toFixed(0) + ' mm' };
    });
  }

  // Platzhalterprofil (echte Airfoil-Form fehlt in XFLR5-XML): benanntes NACA0012,
  // klar als Platzhalter markiert, damit es sichtbar ersetzt werden muss.
  function placeholder(name) {
    const p = (window.Airfoil ? Airfoil.naca4('0012', 120) : []);
    p.name = name + ' ' + T('(Platzhalter – .dat laden)');
    return p;
  }

  // Einen Flügel in eine App-Wing-Konfiguration umsetzen.
  //   opts.unit  Längeneinheit (…_to_meter) aus parse(); Vorgabe 1 (Meter)
  //   opts.foils optionale Map normName(foil) -> Profil-Array (aus geladenen .dat)
  //   opts.mkSeg Segment-Fabrik der App
  // Rückgabe: { root, segments, meta, missingFoils:[Name] }
  function toWingConfig(wing, opts) {
    opts = opts || {};
    const mkSeg = opts.mkSeg || (o => Object.assign({}, o));
    const foils = opts.foils || {};
    const MM = (opts.unit || 1) * 1000;   // Einheit -> mm

    // Rippen nach Spannweite sortieren (Wurzel zuerst) und Nullbreiten überspringen.
    const secs = wing.sections.slice().sort((a, b) => a.y - b.y);
    if (secs.length < 2) throw new Error(T('Flügel braucht mindestens zwei Rippen.'));

    const missing = [];
    const resolveProfile = (foil) => {
      const hit = foils[normName(foil)];
      if (hit) { const c = hit.map(p => ({ x: p.x, y: p.y })); c.name = foil; return c; }
      if (missing.indexOf(foil) < 0) missing.push(foil);
      return placeholder(foil);
    };

    const cfg = {
      root: { profile: resolveProfile(secs[0].foil), chord: +(secs[0].chord * MM).toFixed(2),
              foilName: secs[0].foil },
      segments: [],
      meta: { name: wing.name, type: wing.type, symmetric: wing.symmetric, tilt: wing.tilt },
      missingFoils: missing
    };

    for (let k = 1; k < secs.length; k++) {
      const inner = secs[k - 1], outer = secs[k];
      const spanMM = (outer.y - inner.y) * MM;
      if (Math.abs(spanMM) < 1e-3) continue;   // entartetes Segment (gleiche y) überspringen
      const sweepMM = (outer.xOffset - inner.xOffset) * MM;
      // V-Form des Paneels stammt von der INNEREN Rippe (dort beginnt es).
      const dihMM = spanMM * Math.tan(inner.dihedral * Math.PI / 180);
      cfg.segments.push(mkSeg({
        profile: resolveProfile(outer.foil),
        foilName: outer.foil,
        chord: +(outer.chord * MM).toFixed(2),
        span: +spanMM.toFixed(2),
        sweep: +sweepMM.toFixed(2),
        washout: +(outer.twist || 0).toFixed(3),
        dihMode: 'mm', dih: +dihMM.toFixed(2), dihRoot: 0
      }));
    }
    if (!cfg.segments.length) throw new Error(T('Flügel enthält keine Segmente.'));
    return cfg;
  }

  // ==========================================================================
  // Natives XFLR5-Projekt (.xfl) — Qt-QDataStream, Big-Endian
  // ==========================================================================
  // Das .xfl ist KEIN XML, sondern der serialisierte Objektbaum von XFLR5 v6:
  //   int  200001|200002      Archivformat
  //   int  x6                 Einheiten
  //   [200002] WPolar         Vorgabe-Polare des Projekts
  //   int  n + n x Plane      die Flugzeuge (jedes mit vier Flügeln)
  //   … WPolaren, Betriebspunkte, Profile, Profilpolaren …
  //
  // Anders als das plane-XML enthält das .xfl die PROFILKOORDINATEN. Die
  // Profilblöcke stehen aber hinter den (teils riesigen) Betriebspunktdaten,
  // deren Format sich zwischen den XFLR5-Fassungen mehrfach geändert hat.
  // Deshalb: die Flugzeuge werden streng sequentiell gelesen (dieser Teil steht
  // direkt am Dateianfang und ist stabil), die Profile dagegen über einen
  // Signatur-Scan gefunden (Formatkennung 100006/100007 + Plausibilitätsprüfung
  // der Koordinaten). Das ist robust gegen unbekannte Betriebspunktformate.

  // Kleiner Lesekopf auf einem ArrayBuffer (Qt schreibt alles Big-Endian).
  function Rd(buf) { this.v = new DataView(buf); this.o = 0; this.n = buf.byteLength; }
  Rd.prototype.i32 = function () { const x = this.v.getInt32(this.o); this.o += 4; return x; };
  Rd.prototype.u32 = function () { const x = this.v.getUint32(this.o); this.o += 4; return x; };
  Rd.prototype.f64 = function () { const x = this.v.getFloat64(this.o); this.o += 8; return x; };
  Rd.prototype.bool = function () { const x = this.v.getUint8(this.o); this.o += 1; return x !== 0; };
  Rd.prototype.skip = function (k) { this.o += k; if (this.o > this.n) throw new Error(T('Datei endet unerwartet.')); };
  // QString: 4 Byte Länge in BYTES, dann UTF-16BE. 0xFFFFFFFF = null.
  Rd.prototype.str = function () {
    const n = this.u32();
    if (n === 0xFFFFFFFF) return '';
    if (n > 4e6 || this.o + n > this.n) throw new Error(T('Ungültige Zeichenkette in der Datei.'));
    let s = '';
    for (let i = 0; i < n; i += 2) s += String.fromCharCode(this.v.getUint16(this.o + i));
    this.o += n;
    return s;
  };
  Rd.prototype.color = function () { this.skip(11); };          // QColor
  Rd.prototype.style = function () { this.i32(); this.i32(); this.i32(); this.color(); this.bool(); };

  function xflWing(r) {
    const fmt = r.i32();
    if (fmt < 100000 || fmt > 100001) throw new Error(T('Unbekanntes Flügelformat ') + fmt);
    const w = { name: r.str(), desc: r.str() };
    r.color();
    w.symmetric = r.bool();
    const n = r.i32();
    if (n < 0 || n > 500) throw new Error(T('Unplausible Rippenzahl ') + n);
    w.sections = [];
    for (let i = 0; i < n; i++) {
      const right = r.str(), left = r.str();
      const s = { chord: r.f64(), y: r.f64(), xOffset: r.f64(), dihedral: r.f64(), twist: r.f64() };
      r.i32(); r.i32(); r.i32(); r.i32();         // Panelzahlen + Verteilungen
      s.foil = (right || left || '').trim();
      w.sections.push(s);
    }
    w.volumeMass = r.f64();
    const npm = r.i32();
    if (npm < 0 || npm > 5000) throw new Error(T('Unplausible Massenzahl.'));
    for (let i = 0; i < npm; i++) { r.skip(32); r.str(); }
    r.i32();                                       // früher bTextures
    for (let i = 1; i < 19; i++) r.i32();
    w.typeIdx = r.i32();                           // 0 Fläche, 1 zweite Fläche, 2 HLW, 3 SLW
    r.skip(400);
    return w;
  }

  // Rumpfspant. Die Kontrollpunkte stehen je nach XFLR5-Fassung als float ODER
  // double in der Datei — beide tragen dieselbe Formatkennung 1000. Die Größe
  // wird deshalb durchgereicht und über den Null-Reserveblock des Flugzeugs geprüft.
  function xflFrame(r, csz) {
    const fmt = r.i32();
    if (fmt < 1000 || fmt > 1100) throw new Error(T('Unbekanntes Spantformat ') + fmt);
    const n = r.i32();
    if (n < 0 || n > 5000) throw new Error(T('Unplausible Spantpunktzahl ') + n);
    r.skip(3 * n * csz);
  }

  function xflBody(r, csz) {
    r.i32();                                       // Formatkennung
    r.str(); r.str(); r.color();
    r.i32(); r.i32(); r.i32(); r.i32(); r.f64();
    let n = r.i32();
    if (n < 0 || n > 5000) throw new Error(T('Unplausible Rumpfdaten.'));
    for (let i = 0; i < n; i++) r.i32();
    n = r.i32();
    if (n < 0 || n > 5000) throw new Error(T('Unplausible Spantzahl.'));
    for (let i = 0; i < n; i++) { r.i32(); r.f64(); xflFrame(r, csz); }
    r.f64();
    const k = r.i32();
    if (k < 0 || k > 5000) throw new Error(T('Unplausible Massenzahl.'));
    for (let i = 0; i < k; i++) { r.skip(32); r.str(); }
    for (let i = 0; i < 20; i++) r.i32();
    r.skip(400);
  }

  // Reserveblock am Ende jedes Flugzeugs: 20 Nullen (int) + 50 Nullen (double).
  // Er ist der Prüfstein dafür, dass der Rumpf richtig gelesen wurde.
  function xflPlaneTail(r) {
    const k = r.i32();
    if (k < 0 || k > 5000) throw new Error(T('Unplausible Massenzahl.'));
    for (let i = 0; i < k; i++) { r.skip(32); r.str(); }
    for (let i = 0; i < 20; i++) if (r.i32() !== 0) throw new Error(T('Reserveblock nicht leer.'));
    for (let i = 0; i < 50; i++) if (r.f64() !== 0) throw new Error(T('Reserveblock nicht leer.'));
  }

  function xflPlane(r) {
    const fmt = r.i32();
    if (fmt < 100001 || fmt > 110000) throw new Error(T('Unbekanntes Flugzeugformat ') + fmt);
    const p = { name: r.str(), desc: r.str(), wings: [] };
    if (fmt >= 100002) { r.i32(); r.i32(); r.i32(); r.i32(); r.color(); r.bool(); r.str(); }
    for (let i = 0; i < 4; i++) p.wings.push(xflWing(r));
    p.biplane = r.bool(); p.stab = r.bool(); p.fin = r.bool();
    p.doubleFin = r.bool(); p.symFin = r.bool(); r.bool();
    for (let i = 0; i < 4; i++)
      p.wings[i].le = { x: r.f64(), y: r.f64(), z: r.f64(), tilt: r.f64() };
    const hasBody = r.bool(); r.f64(); r.f64();
    if (hasBody) {
      const o0 = r.o;
      let ok = false;
      for (const csz of [8, 4]) {
        r.o = o0;
        try { r.str(); xflBody(r, csz); xflPlaneTail(r); ok = true; break; }
        catch (e) { /* andere Punktgröße versuchen */ }
      }
      if (!ok) throw new Error(T('Rumpfdaten nicht lesbar.'));
    } else xflPlaneTail(r);
    return p;
  }

  // Flugzeugpolare (WPolar). Mit keep=true kommen die gerechneten Punkte mit:
  // je Punkt 20 double (Reihenfolge wie WPolar::serializeWPlrXFL) + 16 double
  // Eigenwerte. Zusatzwiderstand (4 × Fläche·Beiwert) erst ab Format 200013.
  // Alles in SI (m, m², kg, m/s).
  function xflWPolar(r, keep) {
    const pf = r.i32();
    if (pf < 200000 || pf > 205000) throw new Error(T('Unbekanntes Polarenformat ') + pf);
    const w = { fmt: pf, plane: r.str(), name: r.str() };
    w.S = r.f64(); w.c = r.f64(); w.b = r.f64();
    if (pf < 200014) { r.i32(); r.i32(); r.color(); r.bool(); r.bool(); }
    else r.style();
    w.method = r.i32();                            // 1 LLT, 2 VLM, 3 Panel, 4/5 Dreiecke
    w.type = r.i32();                              // 1 v fest, 2 Auftrieb fest, 4 α fest, 5 β, 7 Stabilität
    w.vlm1 = r.bool(); w.thin = r.bool(); w.tilted = r.bool(); r.bool();
    w.viscous = r.bool(); w.ignoreBody = r.bool();
    w.ground = r.bool(); w.height = r.f64();
    w.rho = r.f64(); w.nu = r.f64();
    w.refDim = r.i32();
    r.bool(); w.mass = r.f64();
    w.cg = { x: r.f64(), y: r.f64(), z: r.f64() };
    r.skip(4 * 8);                                 // Trägheiten
    const nc = r.i32();
    if (nc < 0 || nc > 1000) throw new Error(T('Unplausible Steuerflächenzahl.'));
    r.skip(nc * 8);
    r.i32(); r.skip(16);                           // Nachlauf
    w.vSpec = r.f64(); w.aSpec = r.f64(); w.beta = r.f64();
    const n = r.i32();
    if (Math.abs(n) > 10000) throw new Error(T('Unplausible Polarengröße.'));
    const pts = [];
    for (let i = 0; i < n; i++) {
      if (keep) {
        const d = []; for (let j = 0; j < 20; j++) d.push(r.f64());
        pts.push({ alpha: d[0], beta: d[1], v: d[2], ctrl: d[3], CL: d[4], CY: d[5], CDi: d[6], CDv: d[7],
          Cm: d[8], XCP: d[15], XNP: d[19] });
        r.skip(16 * 8);
      } else r.skip(36 * 8);
    }
    r.skip(19 * 4 + 4 + 35 * 8);
    let extra = 0;
    { const a = [], c = [];
      for (let i = 0; i < 4; i++) a.push(r.f64());
      for (let i = 0; i < 4; i++) c.push(r.f64());
      if (pf >= 200013) for (let i = 0; i < 4; i++) extra += a[i] * c[i]; }
    r.skip(7 * 8);
    w.extraArea = extra;                           // Σ Fläche·Cd (m²)
    w.pts = pts;
    return w;
  }
  // Vorgabe-Polare des Projekts: nur überlesen
  function xflSkipWPolar(r) { xflWPolar(r, false); }

  // Flügel-Betriebspunkt: je Station 22 double. Zwischen den Nachlauf-Zahlen
  // und α stehen je nach Fassung 8 oder 24 Byte — deshalb wird α (aus dem
  // Flugzeug-Betriebspunkt bekannt, gefolgt von β und v) als Anker gesucht.
  function xflWingOpp(r, alpha, qinf) {
    r.i32(); const name = r.str(); r.str(); r.i32(); r.bool();
    const ns = r.i32(), nv = r.i32();
    if (ns < 0 || ns > 5000 || nv < 0 || nv > 1e6) throw new Error(T('Unplausibler Betriebspunkt.'));
    r.i32(); r.i32(); r.i32();
    const o0 = r.o; let k = 0;
    for (; k <= 64; k += 4)
      if (o0 + k + 24 <= r.n && r.v.getFloat64(o0 + k) === alpha && r.v.getFloat64(o0 + k + 16) === qinf) break;
    if (k > 64) throw new Error(T('Unplausibler Betriebspunkt.'));
    r.o = o0 + k + 6 * 8;
    const CL = r.f64(); r.skip(12 * 8);
    if (r.o + ns * 22 * 8 > r.n) throw new Error(T('Datei endet unerwartet.'));
    const st = { y: [], chord: [], re: [], ai: [], cl: [], cdv: [], cdi: [], xtrT: [], xtrB: [] };
    for (let i = 0; i < ns; i++) {
      const b = r.o, f = j => r.v.getFloat64(b + 8 * j);
      st.re.push(f(0)); st.chord.push(f(1)); st.ai.push(f(3)); st.cl.push(f(4)); st.cdv.push(f(5)); st.cdi.push(f(6));
      st.xtrT.push(f(11)); st.xtrB.push(f(12)); st.y.push(f(20));
      r.o += 22 * 8;
    }
    const nf = r.i32();
    if (nf < 0 || nf > 1000) throw new Error(T('Unplausibler Betriebspunkt.'));
    r.skip(nf * 8 + 20 * 4 + 50 * 8);
    return { name, CL, st };
  }

  // Flugzeug-Betriebspunkt (PlaneOpp). Die Panelwerte (Cp, σ, Γ) stehen in
  // alten Fassungen als double, in neuen als float — beide Größen werden
  // probiert und am Folgefeld (Flügel vorhanden 0/1 + Flügelblock) geprüft.
  function xflPlaneOpp(r) {
    const f = r.i32();
    if (f < 200000 || f > 200100) throw new Error(T('Unplausibler Betriebspunkt.'));
    const o = { plane: r.str(), polar: r.str() };
    if (f < 200002) { r.i32(); r.i32(); r.color(); r.bool(); r.bool(); } else r.style();
    r.skip(4);                                     // bOut, VLM1, dünne Flächen, gekippt
    o.type = r.i32(); o.method = r.i32();
    const np = r.i32(); r.i32();
    if (np < 0 || np > 5e6) throw new Error(T('Unplausibler Betriebspunkt.'));
    o.alpha = r.f64(); o.v = r.f64(); o.beta = r.f64(); o.ctrl = r.f64(); o.mass = r.f64();
    const o0 = r.o; let err = null;
    for (const sz of (f >= 200003 ? [4, 8] : [8, 4])) {
      r.o = o0; err = null;
      try {
        if (o.method !== 1) r.skip(3 * sz * np);
        o.wings = [];
        for (let iw = 0; iw < 4; iw++) {
          const has = r.i32();
          if (has !== 0 && has !== 1) throw new Error(T('Unplausibler Betriebspunkt.'));
          if (has) { const w = xflWingOpp(r, o.alpha, o.v); w.idx = iw; o.wings.push(w); }
        }
        break;
      } catch (e) { err = e; }
    }
    if (err) throw err;
    o.CL = r.f64(); r.f64(); r.f64();              // CL, CX, CY
    o.CDv = r.f64(); o.CDi = r.f64();
    const Cmv = r.f64(), Cmi = r.f64(); o.Cm = Cmv + Cmi;
    r.skip(7 * 8 + 18 * 8 + 4 + 6 * 8 + 8 * 8 + 32 * 8);
    o.XNP = r.f64();
    r.skip(80 * 8 + 20 * 4 + 50 * 8);
    return o;
  }

  // Profil, sequentiell überlesen (Felder wie beim Signatur-Scan unten)
  function xflFoilSeq(r) {
    const f = r.i32();
    if (f < 100000 || f > 110000) throw new Error(T('Unbekanntes Profilformat ') + f);
    r.str(); r.str();
    if (f >= 100007) r.style(); else { r.i32(); r.i32(); r.color(); r.bool(); r.bool(); }
    r.skip(3 + 48);
    const nb = r.i32();
    if (nb < 0 || nb > 100000) throw new Error(T('Unplausible Profilpunktzahl.'));
    r.skip(16 * nb);
  }
  // Profilpolare: je Punkt 11 Werte (α, Cd, Cdp, Cl, Cm, XTr1, XTr2, HMom,
  // Cpmin, Re, XCp) — Format 100005 schreibt sie als double, neuere
  // XFLR5-Fassungen als float. Beide probieren, am Folgefeld prüfen.
  function xflFoilPolar(r) {
    const f = r.i32();
    if (f < 100000 || f > 110000) throw new Error(T('Unbekanntes Polarenformat ') + f);
    const p = { foil: r.str(), name: r.str() };
    if (f >= 100005) r.style(); else { r.i32(); r.i32(); r.color(); r.bool(); r.bool(); }
    p.type = r.i32(); r.i32(); r.i32();            // Typ, früher MaType/ReType
    p.Re = r.f64(); p.Mach = r.f64(); r.f64(); r.f64(); r.f64(); p.ncrit = r.f64();
    const n = r.i32();
    if (n < 0 || n > 100000) throw new Error(T('Unplausible Polarengröße.'));
    const o0 = r.o;
    for (const sz of (f >= 100006 ? [4, 8] : [8, 4])) {
      const end = o0 + 11 * sz * n + (f < 100005 ? 4 : 0) + 19 * 4 + 50 * 8;
      if (end > r.n) continue;
      if (end + 4 <= r.n) {                        // Folgefeld: nächste Polare oder Anzahl
        const nx = r.v.getInt32(end);
        if (!(nx >= 100000 && nx <= 110000) && !(nx >= 0 && nx < 1e6)) continue;
      }
      const rd = sz === 8 ? (o => r.v.getFloat64(o)) : (o => r.v.getFloat32(o));
      const pts = [];
      for (let i = 0; i < n; i++) {
        const b = o0 + 11 * sz * i, g = j => rd(b + sz * j);
        pts.push({ alpha: g(0), cd: g(1), cdp: g(2), cl: g(3), cm: g(4), xtrT: g(5), xtrB: g(6), re: g(9) });
      }
      if (!pts.every(q => isFinite(q.cl) && isFinite(q.cd) && Math.abs(q.alpha) < 180 && Math.abs(q.cl) < 20)) continue;
      p.pts = pts; r.o = end;
      return p;
    }
    throw new Error(T('Unplausible Polarengröße.'));
  }

  // --- Profilblöcke über Signatur finden -----------------------------------
  // Ein gültiger Block: int 100006|100007, Name, Beschreibung, Stil, drei bool,
  // sechs double, int nb, nb x (x,y). Geprüft wird auf lesbaren Namen und darauf,
  // dass die Koordinaten wie ein auf die Sehne normiertes Profil aussehen.
  function xflTryFoil(buf, at) {
    const r = new Rd(buf); r.o = at;
    try {
      const fmt = r.i32();
      const name = r.str(); r.str();
      if (!name || name.length > 120) return null;
      for (let i = 0; i < name.length; i++) if (name.charCodeAt(i) < 32) return null;
      if (fmt >= 100007) r.style();
      else { r.i32(); r.i32(); r.color(); r.bool(); r.skip(1); }
      r.skip(3);                    // Mittellinie, Nasen-/Endleistenklappe
      r.skip(48);                   // Klappenwinkel und -scharniere
      const nb = r.i32();
      if (nb < 10 || nb > 5000) return null;
      if (r.o + 16 * nb > r.n) return null;
      const pts = []; let xmin = Infinity, xmax = -Infinity;
      for (let i = 0; i < nb; i++) {
        const x = r.f64(), y = r.f64();
        if (!(x > -0.5 && x < 2 && y > -1 && y < 1)) return null;
        if (x < xmin) xmin = x;
        if (x > xmax) xmax = x;
        pts.push({ x: x, y: y });
      }
      if (xmin > 0.05 || xmax < 0.9) return null;
      pts.name = name;
      return { name: name, pts: pts, end: r.o };
    } catch (e) { return null; }
  }

  function xflScanFoils(buf) {
    const v = new DataView(buf), n = buf.byteLength, out = [];
    let o = 0;
    while (o + 4 <= n) {
      const tag = v.getInt32(o);
      if (tag === 100006 || tag === 100007) {
        const f = xflTryFoil(buf, o);
        if (f) { out.push(f); o = f.end; continue; }
      }
      o += 1;
    }
    return out;
  }

  // ArrayBuffer -> { planes:[{name,wings:[…]}], foils:{normName:Profil}, foilNames:[…] }
  // opts.results: zusätzlich wpolars[], popps[], foilPolars[] (Vergleich im Aero-Reiter)
  // Die Flügelobjekte haben dieselbe Gestalt wie beim XML-Import, damit
  // toWingConfig() unverändert greift.
  function parseXfl(buf, opts) {
    const r = new Rd(buf);
    const fmt = r.i32();
    if (fmt < 200001 || fmt > 200002)
      throw new Error(T('Keine XFLR5-Projektdatei (unbekannte Formatkennung).'));
    for (let i = 0; i < 6; i++) r.i32();                 // Einheiten
    if (fmt === 200002) xflSkipWPolar(r);
    else { r.i32(); r.i32(); r.skip(9 * 8); r.bool(); r.bool(); }
    const nPlanes = r.i32();
    if (nPlanes < 0 || nPlanes > 5000) throw new Error(T('Unplausible Flugzeugzahl ') + nPlanes);

    // Profile zuerst (unabhängiger Scan) — sie werden für die Auswahl gebraucht.
    const foils = {}, foilNames = [];
    xflScanFoils(buf).forEach(f => {
      const prof = (window.Airfoil && Airfoil.normalize) ? Airfoil.normalize(f.pts) : f.pts;
      prof.name = f.name;
      foils[normName(f.name)] = prof;
      if (foilNames.indexOf(f.name) < 0) foilNames.push(f.name);
    });

    const KIND = ['MAINWING', 'SECONDWING', 'ELEVATOR', 'FIN'];
    const planes = [];
    for (let i = 0; i < nPlanes; i++) {
      const p = xflPlane(r);
      // XFLR5 hält immer alle vier Flügel vor; nur die eingeschalteten zählen.
      const on = [true, p.biplane, p.stab, p.fin];
      const wings = [];
      p.wings.forEach((w, k) => {
        if (!on[k]) return;
        if (!w.sections || w.sections.length < 2) return;
        if (!w.sections.some(s => s.foil)) return;       // Flügel ohne Profile = ungenutzt
        w.type = KIND[w.typeIdx >= 0 && w.typeIdx < 4 ? w.typeIdx : k];
        w.tilt = w.le ? w.le.tilt : 0;
        wings.push(w);
      });
      planes.push({ name: p.name || (T('Flugzeug ') + (i + 1)), desc: p.desc, wings: wings,
        doubleFin: p.doubleFin, symFin: p.symFin });
    }
    const out = { kind: 'xfl', unit: 1, planes: planes, foils: foils, foilNames: foilNames,
      wpolars: [], popps: [], foilPolars: [], resultsError: null };
    // Ergebnisse (Flugzeugpolaren, Betriebspunkte, Profilpolaren) — nur auf
    // Wunsch; bricht etwas ab, bleibt das bis dahin Gelesene erhalten.
    if (opts && opts.results) {
      try {
        const nW = r.i32();
        if (nW < 0 || nW > 100000) throw new Error(T('Unplausible Polarenzahl.'));
        for (let i = 0; i < nW; i++) out.wpolars.push(xflWPolar(r, true));
        const nO = r.i32();
        if (nO < 0 || nO > 1e6) throw new Error(T('Unplausibler Betriebspunkt.'));
        for (let i = 0; i < nO; i++) out.popps.push(xflPlaneOpp(r));
        const nF = r.i32();
        if (nF < 0 || nF > 100000) throw new Error(T('Unplausible Profilzahl.'));
        for (let i = 0; i < nF; i++) xflFoilSeq(r);
        const nP = r.i32();
        if (nP < 0 || nP > 1e6) throw new Error(T('Unplausible Polarenzahl.'));
        for (let i = 0; i < nP; i++) out.foilPolars.push(xflFoilPolar(r));
      } catch (e) { out.resultsError = e.message || String(e); }
    }
    return out;
  }

  global.XFLR5 = { parse, parseXfl, listWings, toWingConfig, normName };
})(window);
