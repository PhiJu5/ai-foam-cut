/* flz.js — Import von Flügelgeometrien aus FLZ_Vortex CSV-Exporten.
 *
 * Format (Semikolon-getrennt, deutsches Dezimalkomma, Windows-1252):
 *   Schlüssel;Klartext-Beschreibung;Wert
 * Die Schlüssel sind hierarchisch, z.B.
 *   F-0-FL-0-6            Flügel 0: Profiltiefe (Wurzel) [m]
 *   F-0-FL-0-PRX-<i>      Flügel 0: Wurzelprofil, X-Koordinate i (normiert 0..1)
 *   F-0-FL-0-SEG-<k>-1    Segment k: Segmentbreite [m] (signiert; <0 = links)
 *   F-0-FL-0-SEG-<k>-2    Segment k: Profiltiefe am AUSSENende [m]
 *   F-0-FL-0-SEG-<k>-5    Segment k: Pfeilwinkel [°]
 *   F-0-FL-0-SEG-<k>-PRX-<i>  Segment k: Profil (am Außenende)
 *
 * FLZ beschreibt den GESAMTEN Flügel von Spitze zu Spitze. Die Wurzel (Referenz,
 * Y=0) liegt in der Mitte; Segmente mit negativer Breite gehen nach links, mit
 * positiver nach rechts. Das gespeicherte Profil/die Profiltiefe eines Segments
 * gilt jeweils an dessen Ende, das WEITER von der Wurzel entfernt liegt.
 *
 * Der Tragflächendesigner der App modelliert eine HALBE Tragfläche als
 * Rippenkette (Wurzel + Segmente nach außen). toWingConfig() extrahiert daher
 * eine Hälfte (rechts bevorzugt) und rechnet in App-Einheiten um (mm, °).
 */
(function (global) {
  'use strict';

  const T = (s) => (window.I18N ? window.I18N.t(s) : s);

  // deutsches Dezimalkomma -> Zahl. Leere/ungültige Werte -> 0.
  function num(v) {
    if (v == null) return 0;
    const n = parseFloat(String(v).trim().replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }

  // Roh-Text -> Map( Schlüssel -> Wert ). Nur Zeilen mit >=3 Feldern.
  function parseMap(text) {
    const map = new Map();
    const lines = String(text).split(/\r?\n/);
    for (const ln of lines) {
      if (!ln || ln.indexOf(';') < 0) continue;
      const parts = ln.split(';');
      if (parts.length < 3) continue;
      // Schlüssel = 1. Feld, Wert = 3. Feld (die Beschreibung dazwischen wird
      // ignoriert). Ein Wert kann Kommas enthalten (z.B. Profilname) — das ist
      // unkritisch, da wir nicht am Komma trennen.
      const key = parts[0].trim();
      if (key) map.set(key, parts[2] != null ? parts[2].trim() : '');
    }
    return map;
  }

  // Profilkoordinaten unter <prefix>PRX-i / <prefix>PRZ-i einlesen.
  // FLZ liefert Selig-Reihenfolge (Endleiste -> Oberseite -> Nase -> Unterseite
  // -> Endleiste), normiert auf Sehne 1. Wir übergeben die Rohpunkte an
  // Airfoil.normalize (kanonisiert Reihenfolge/Skalierung).
  function readProfile(map, prefix, name) {
    const n = Math.round(num(map.get(prefix + 'PR_ANZ')));
    const pts = [];
    for (let i = 0; i < n; i++) {
      const xs = map.get(prefix + 'PRX-' + i);
      const zs = map.get(prefix + 'PRZ-' + i);
      if (xs == null || zs == null) continue;
      pts.push({ x: num(xs), y: num(zs) });
    }
    if (pts.length < 5) return null;
    pts.name = name || 'Profil';
    return (window.Airfoil && Airfoil.normalize) ? Airfoil.normalize(pts) : pts;
  }

  // Profilnamen aufräumen: „MH 9,8-2 177k.DAT" -> „MH 9,8-2 177k".
  function cleanName(s) {
    return String(s || 'Profil').replace(/\.(dat|cor|txt)\s*$/i, '').trim() || 'Profil';
  }

  // Text -> { planes:[ { name, wings:[ wing ] } ] }.
  // wing = { name, rootChord, rootProfile, incidence, segments:[seg] }
  //   rootChord  in m   rootProfile normiertes Profil-Array
  //   incidence  Einstellwinkel [°]
  // seg = { width, chord, profile, profileName, twist, vform, sweep, sweepRef,
  //         flapL, flapR }   (width/chord in m, Winkel in °, flap in %)
  function parse(text) {
    const map = parseMap(text);
    if (!map.size) throw new Error(T('Keine FLZ-Daten erkannt.'));
    const nPlanes = Math.max(1, Math.round(num(map.get('F-ANZ'))));
    const planes = [];
    for (let p = 0; p < nPlanes; p++) {
      const pPref = 'F-' + p + '-';
      const nWings = Math.max(0, Math.round(num(map.get(pPref + 'FL_ANZ'))));
      const wings = [];
      for (let w = 0; w < nWings; w++) {
        const wPref = pPref + 'FL-' + w + '-';
        const rootProfName = cleanName(map.get(wPref + 'PR'));
        const wing = {
          name: (map.get(wPref + '1') || (T('Flügel ') + (w + 1))).trim(),
          rootChord: num(map.get(wPref + '6')),        // Profiltiefe [m]
          incidence: num(map.get(wPref + '5')),        // Einstellwinkel [°]
          rootProfile: readProfile(map, wPref, rootProfName),
          rootProfileName: rootProfName,
          segments: []
        };
        const nSeg = Math.max(0, Math.round(num(map.get(wPref + 'SEG_ANZ'))));
        for (let k = 0; k < nSeg; k++) {
          const sPref = wPref + 'SEG-' + k + '-';
          const profName = cleanName(map.get(sPref + 'PR'));
          wing.segments.push({
            width: num(map.get(sPref + '1')),          // Segmentbreite [m] (signiert)
            chord: num(map.get(sPref + '2')),          // Profiltiefe außen [m]
            twist: num(map.get(sPref + '3')),          // Verwindungswinkel [°]
            vform: num(map.get(sPref + '4')),          // V-Form-Winkel [°]
            sweep: num(map.get(sPref + '5')),          // Pfeilwinkel [°]
            sweepRef: num(map.get(sPref + '6')),       // Bezugspunkt Pfeilwinkel [%]
            flapL: num(map.get(sPref + '9')),          // Klappentiefe links [%]
            flapR: num(map.get(sPref + '10')),         // Klappentiefe rechts [%]
            profile: readProfile(map, sPref, profName),
            profileName: profName
          });
        }
        wings.push(wing);
      }
      planes.push({ name: (map.get(pPref + '2') || map.get('F-0-2') || 'Flugzeug').trim(), wings });
    }
    return { planes };
  }

  // Alle Flügel aller Flugzeuge flach als Liste (für die Auswahl).
  function listWings(parsed) {
    const out = [];
    parsed.planes.forEach((pl, pi) => pl.wings.forEach((wg, wi) => {
      const span = wg.segments.reduce((a, s) => a + Math.abs(s.width), 0) * 2;
      out.push({ plane: pi, wing: wi, ref: wg,
        label: wg.name + ' — ' + wg.segments.length + ' ' + T('Segmente') +
               ', ' + T('Halbspannw.') + ' ' + (span * 500).toFixed(0) + ' mm' });
    }));
    return out;
  }

  // Einen Flügel in eine App-Wing-Konfiguration umsetzen (halbe Tragfläche).
  //   { root:{ profile, chord }, segments:[ { profile, chord, span, sweep,
  //     washout, dihMode, dih, hingePct, hingePctTip, ... } ], meta }
  // side: 'right' (positive Breite) | 'left' (negative) | 'auto'.
  // mkSeg: Fabrik der App (Vorgabewerte); wird pro Segment mit Overrides gerufen.
  function toWingConfig(wing, opts) {
    opts = opts || {};
    const mkSeg = opts.mkSeg || (o => Object.assign({}, o));
    const M = 1000;   // m -> mm

    // Segmente nach Seite trennen. FLZ-Reihenfolge ist Spitze->Spitze:
    //   negative Breiten stehen zuerst (linke Spitze -> Mitte, also außen->innen),
    //   positive danach (Mitte -> rechte Spitze, innen->außen).
    // Wir brauchen die Kette von der WURZEL nach AUSSEN:
    //   rechts = positive in Dateireihenfolge; links = negative umgekehrt.
    const right = wing.segments.filter(s => s.width > 0);
    const left = wing.segments.filter(s => s.width < 0).slice().reverse();
    let side = opts.side || 'auto';
    let chain;
    if (side === 'left') chain = left;
    else if (side === 'right') chain = right;
    else { chain = right.length ? right : left; side = right.length ? 'right' : 'left'; }
    if (!chain.length) {
      // Kein Vorzeichen gesetzt (einseitiger Flügel): alle Segmente in Reihenfolge.
      chain = wing.segments.slice(); side = 'right';
    }

    const rootProfile = wing.rootProfile ||
      (window.Airfoil ? Airfoil.naca4('2412', 120) : null);
    const cfg = {
      root: { profile: rootProfile, chord: +(wing.rootChord * M).toFixed(2) },
      segments: [],
      meta: { name: wing.name, incidence: wing.incidence, side: side,
              nLeft: left.length, nRight: right.length }
    };

    chain.forEach(s => {
      const spanMM = Math.abs(s.width) * M;
      const rootChordMM = cfg.segments.length
        ? cfg.segments[cfg.segments.length - 1].chord
        : cfg.root.chord;
      const tipChordMM = +(s.chord * M).toFixed(2);
      // Pfeilung: FLZ gibt einen Winkel am Bezugspunkt f (% der Sehne). Die App
      // will den LE-Versatz (Nase außen ggü. Nase Wurzel). Aus der Geometrie:
      //   LE_versatz = span·tan(γ) + f·(Sehne_Wurzel − Sehne_außen)
      const f = (s.sweepRef || 0) / 100;
      const sweepMM = spanMM * Math.tan(s.sweep * Math.PI / 180)
        + f * (rootChordMM - tipChordMM);
      // V-Form: FLZ-Winkel ist ABSOLUT je Segment. Als Höhe (mm) des Außen- über
      // dem Innenende ausgedrückt bleibt die V-Form über die Kette stetig 3° usw.
      const dihMM = spanMM * Math.tan(s.vform * Math.PI / 180);
      cfg.segments.push(mkSeg({
        profile: s.profile || rootProfile,
        chord: tipChordMM,
        span: +spanMM.toFixed(2),
        sweep: +sweepMM.toFixed(2),
        washout: +(s.twist || 0).toFixed(3),
        dihMode: 'mm', dih: +dihMM.toFixed(2), dihRoot: 0,
        hingeSide: 'top',
        hingePct: +(s.flapL || 0).toFixed(1),
        hingePctTip: +(s.flapR || s.flapL || 0).toFixed(1)
      }));
    });
    return cfg;
  }

  // ==========================================================================
  // Natives FLZ_Vortex-Projekt (.flz)
  // ==========================================================================
  // Zeilenformat SCHLUESSEL=Wert, gegliedert durch Abschnittsmarken in eckigen
  // Klammern; Dezimalpunkt, Kodierung Windows-1252:
  //   [FLUGZEUG]            BEZEICHNUNG, KONSTRUKTEUR, …
  //   [FLAECHE0]            ART (FLUEGEL/RUMPF), BEZEICHNUNG, EINSTELLWINKEL,
  //                         PROFILTIEFE  = Wurzel
  //     [PROFIL]            PROFILDATEINAME + PKi=x z   (Wurzelprofil)
  //     [SEGMENT0]          SEGMENTBREITE (signiert), PROFILTIEFE (aussen),
  //                         VERWINDUNGSWINKEL, V-FORM_WINKEL, PFEILWINKEL,
  //                         BEZUGSPUNKT_PFEILWINKEL, KLAPPENTIEFE LINKS,RECHTS
  //       [PROFIL]          Profil am AUSSENende des Segments
  //     [SEGMENT ENDE] … [FLAECHE ENDE] … [FLUGZEUG ENDE]
  //
  // Wie beim CSV-Export beschreibt FLZ den GESAMTEN Flügel von Spitze zu
  // Spitze; negative Segmentbreiten gehen nach links. Das Ergebnis hat deshalb
  // dieselbe Gestalt wie parse(), sodass toWingConfig() unverändert greift.

  // Windows-1252 -> Text. (TextDecoder kennt die Kennung; sonst Latin-1.)
  function decode1252(buf) {
    try { return new TextDecoder('windows-1252').decode(buf); }
    catch (e) {
      const b = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
      return s;
    }
  }

  // Ein [PROFIL]-Block ab Zeile i einlesen. Rückgabe { profile, name, next }.
  function readNativeProfile(lines, i) {
    const pts = [];
    let name = 'Profil';
    let k = i;
    for (; k < lines.length; k++) {
      const ln = lines[k].trim();
      if (ln === '[PROFIL ENDE]') { k++; break; }
      const eq = ln.indexOf('=');
      if (eq < 0) continue;
      const key = ln.slice(0, eq).trim(), val = ln.slice(eq + 1).trim();
      if (key === 'PROFILDATEINAME') name = cleanName(val);
      else if (/^PK\d+$/.test(key)) {
        const p = val.split(/\s+/);
        if (p.length >= 2) pts.push({ x: num(p[0]), y: num(p[1]) });
      }
    }
    let prof = null;
    if (pts.length >= 5) {
      pts.name = name;
      prof = (window.Airfoil && Airfoil.normalize) ? Airfoil.normalize(pts) : pts;
      if (prof) prof.name = name;
    }
    return { profile: prof, name: name, next: k };
  }

  // Text einer nativen .flz -> { planes:[ { name, wings:[ wing ] } ] }
  // (gleiche Gestalt wie parse() für den CSV-Export).
  function parseNative(text) {
    const lines = String(text).split(/\r?\n/);
    const planes = [];
    let plane = null, wing = null, seg = null;

    // Zielobjekt für den nächsten [PROFIL]-Block: Segment falls offen, sonst Flügel.
    const takeProfile = (res) => {
      if (seg) { seg.profile = res.profile; seg.profileName = res.name; }
      else if (wing) { wing.rootProfile = res.profile; wing.rootProfileName = res.name; }
    };

    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i].trim();
      if (!ln) continue;
      if (ln.charAt(0) === '[') {
        if (ln === '[FLUGZEUG]') { plane = { name: '', wings: [] }; planes.push(plane); }
        else if (ln === '[FLUGZEUG ENDE]') { plane = null; }
        else if (/^\[FLAECHE\d+\]$/.test(ln)) {
          if (!plane) { plane = { name: '', wings: [] }; planes.push(plane); }
          wing = { name: '', art: '', rootChord: 0, incidence: 0,
            rootProfile: null, rootProfileName: 'Profil', segments: [] };
          seg = null;
        } else if (ln === '[FLAECHE ENDE]') {
          // Nur echte Flügel übernehmen — Rümpfe kennt der Tragflächendesigner nicht.
          if (wing && /FLUEGEL/i.test(wing.art) && wing.segments.length) plane.wings.push(wing);
          wing = null; seg = null;
        } else if (/^\[SEGMENT\d+\]$/.test(ln)) {
          seg = { width: 0, chord: 0, twist: 0, vform: 0, sweep: 0, sweepRef: 0,
            flapL: 0, flapR: 0, profile: null, profileName: 'Profil' };
        } else if (ln === '[SEGMENT ENDE]') {
          if (wing && seg) wing.segments.push(seg);
          seg = null;
        } else if (ln === '[PROFIL]') {
          const res = readNativeProfile(lines, i + 1);
          takeProfile(res);
          i = res.next - 1;
        }
        continue;
      }
      const eq = ln.indexOf('=');
      if (eq < 0) continue;
      const key = ln.slice(0, eq).trim(), val = ln.slice(eq + 1).trim();
      if (seg) {
        switch (key) {
          case 'SEGMENTBREITE': seg.width = num(val); break;
          case 'PROFILTIEFE': seg.chord = num(val); break;
          case 'VERWINDUNGSWINKEL': seg.twist = num(val); break;
          case 'V-FORM_WINKEL': seg.vform = num(val); break;
          case 'PFEILWINKEL': seg.sweep = num(val); break;
          case 'BEZUGSPUNKT_PFEILWINKEL': seg.sweepRef = num(val); break;
          case 'KLAPPENTIEFE LINKS,RECHTS': {
            const p = val.split(/\s+/);
            seg.flapL = num(p[0]); seg.flapR = num(p.length > 1 ? p[1] : p[0]);
            break;
          }
          default: break;
        }
      } else if (wing) {
        switch (key) {
          case 'ART': wing.art = val; break;
          case 'BEZEICHNUNG': wing.name = val; break;
          case 'PROFILTIEFE': wing.rootChord = num(val); break;
          case 'EINSTELLWINKEL': wing.incidence = num(val); break;
          default: break;
        }
      } else if (plane && key === 'BEZEICHNUNG') plane.name = val;
    }
    planes.forEach((pl, i) => {
      if (!pl.name) pl.name = T('Flugzeug ') + (i + 1);
      pl.wings.forEach((w, k) => { if (!w.name) w.name = T('Flügel ') + (k + 1); });
    });
    if (!planes.some(p => p.wings.length))
      throw new Error(T('Keine Tragfläche in der FLZ-Datei gefunden.'));
    return { kind: 'flz', planes: planes };
  }

  // Beliebige FLZ-Quelle: natives Projekt (.flz) oder CSV-Export.
  function parseAny(text) {
    if (/\[FLUGZEUG\]|\[FLAECHE\d+\]/.test(String(text).slice(0, 4000))) return parseNative(text);
    const res = parse(text);
    res.kind = 'flzcsv';
    return res;
  }

  global.FLZ = { parse, parseNative, parseAny, decode1252, listWings, toWingConfig };
})(window);
