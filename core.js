/* core.js — Kern: Zustand, Helfer, Farben/Strichtypen  (@@split-module, ausgelagert aus app.js)
 * Namen aus früher geladenen Dateien werden unten aus window.App gebunden;
 * Namen aus app.js (lädt später) laufen als App.<name>. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});

  // Übersetzungs-Shortcut (siehe i18n.js). Bei fehlendem I18N unverändert.
  const T = (s) => (window.I18N ? window.I18N.t(s) : s);
  // Zahlparser: akzeptiert '.' und ',' als Dezimaltrenner (z. B. "1,5" -> 1.5).
  function parseNum(v) {
    if (v == null) return NaN;
    return parseFloat(String(v).trim().replace(',', '.'));
  }
  window.parseNum = parseNum;
  // Wie T, aber Gruppentitel mit Zähler-Suffix „ (n)" bleiben übersetzbar:
  // wenn der Gesamttitel keine Übersetzung hat, Basis übersetzen, Zähler anhängen.
  function Ttitle(s) {
    const tr = T(s);
    if (tr !== s) return tr;
    const m = /^(.*?)(\s*\(\d+\))$/.exec(String(s));
    if (m) { const b = T(m[1]); if (b !== m[1]) return b + m[2]; }
    return tr;
  }

  // ---------- Texteingabe-Dialog (Ersatz für window.prompt) ----------
  // Electron implementiert window.prompt() NICHT — im eigenen Programmfenster
  // passierte bei „Neuer Werkstoff“, „Neuer Layer…“ usw. schlicht nichts.
  // askText() ist der Ersatz und funktioniert in beiden Varianten gleich.
  // Anders als prompt() hält es den Ablauf nicht an: Rückgabe ist ein Promise
  // mit dem eingegebenen Text oder null bei Abbruch.
  function askText(title, def, opts) {
    const o = opts || {};
    return new Promise(resolve => {
      const back = document.createElement('div');
      back.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.55);' +
        'display:flex;align-items:center;justify-content:center';
      const box = document.createElement('div');
      box.style.cssText = 'min-width:320px;max-width:min(90vw,460px);background:var(--panel);' +
        'border:1px solid var(--line);border-radius:8px;padding:14px 16px;' +
        'box-shadow:0 10px 40px rgba(0,0,0,.5)';
      const lab = document.createElement('div');
      lab.textContent = title;
      lab.style.cssText = 'margin-bottom:9px;color:var(--txt);font-weight:600';
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = def == null ? '' : String(def);
      inp.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 8px;border-radius:5px;' +
        'border:1px solid var(--line);background:var(--panel2);color:var(--txt);font:inherit';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:12px';
      const ok = document.createElement('button'); ok.textContent = T('OK');
      const no = document.createElement('button'); no.textContent = T('Abbrechen');
      row.appendChild(no); row.appendChild(ok);
      box.appendChild(lab); box.appendChild(inp); box.appendChild(row);
      back.appendChild(box);

      let done = false;
      function close(val) {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        back.remove();
        resolve(val);
      }
      function onKey(ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); close(null); }
        else if (ev.key === 'Enter') { ev.preventDefault(); close(inp.value); }
      }
      ok.onclick = () => close(inp.value);
      no.onclick = () => close(null);
      back.addEventListener('mousedown', ev => { if (ev.target === back) close(null); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(back);
      inp.focus();
      if (o.select !== false) inp.select();
    });
  }

  function mkSeg(o) {
    return Object.assign({
      profile: Airfoil.naca4('2412', 100), chord: 150, span: 300,
      sweep: 10, sweepMode: 'mm', washout: 0,   // Pfeilung: LE-Versatz mm oder Winkel °
      twistRef: 0.25,                    // Drehpunkt (Schränkung) DIESES Außenprofils
                                         // (Anteil der Sehne ab Nasenleiste). Fällt bei
                                         // Altprojekten auf cfg.twistRef zurück.
      // Beplankung je Segment (nur bei cfg.sheetMode='segment' aktiv). null =
      // vom globalen Wert erben. …Top/…Bot nur bei cfg.sheetSides='asym'.
      sheetRoot: null, sheetTip: null,
      sheetRootTop: null, sheetRootBot: null, sheetTipTop: null, sheetTipBot: null,
      dihMode: 'mm', dih: 0,             // V-Form: Höhe Außenende (mm) oder Winkel (°)
      dihRoot: 0,                        // Höhe der Profilsehne am Wurzelende (mm),
                                         // Versatz ggü. dem Außenende des Vorsegments
      // Scharnierlinie (Ruderscharnier): Seite oben/unten + Lage in % der Sehne
      // von HINTEN (Endleiste) gemessen. Reine Konstruktionshilfe im Profilbild.
      hingeSide: 'top', hingePct: 25, hingePctTip: 25,
      // Scharnierlinien-Pfeilung (Gruppen): hingeGroupStart beginnt an diesem Segment
      // eine neue Gruppe; hingeSweep/hingeSweepMode = Pfeilung der Gruppe (nur am
      // Gruppenstart relevant). Siehe computeHingeSweeps.
      hingeGroupStart: false, hingeSweep: 0, hingeSweepMode: 'deg',
      // Profilhöhenausrichtung (Gruppen): alignGroupStart beginnt an diesem Segment
      // eine neue V-Form-Gruppe; alignDih/alignDihMode = V-Form der Gruppe (nur am
      // Gruppenstart ab Gruppe 2 relevant — Gruppe 1 nutzt cfg.align.dih).
      alignGroupStart: false, alignDih: 0, alignDihMode: 'mm',
      // Schnittverlängerungen (Draht-Weg): je Wurzel/außen + proportional.
      leExt: 8, leExtTip: 8, leExtProp: false,      // X-Schlaufe: Schräge (A)
      leExt2: 12, leExt2Tip: 12, leExt2Prop: false, // X-Schlaufe: parallel (B)
      teExt: 20, teExtTip: 20, teExtProp: false,    // EL: horizontaler Steg in Sehnenrichtung
      // Styroporblock je Segment: Länge in Spannweite = Segment-Spannweite (auto).
      // Sehnen-Ausdehnung über Verlängerung vor der Nase / hinter der Endleiste,
      // getrennt für Wurzel- und Außenprofil. Außen wahlweise absolut (…Tip) oder
      // proportional zur Sehne (…Prop): Verlängerung_außen = Verlängerung_Wurzel · Sehne_außen/Sehne_Wurzel.
      blockH: 60,
      bLE: 15, bLETip: 15, bLEProp: false,   // Nasen-Verlängerung (Wurzel/außen/proportional)
      bTE: 25, bTETip: 25, bTEProp: false     // Endleisten-Verlängerung
    }, o || {});
  }

  // ---------- Zustand -------------------------------------------------
  const state = {
    root: { profile: Airfoil.naca4('2412', 100), chord: 200, twistRef: 0.25 },
    segments: [
      // Vorerst EIN Segment — wir richten den Einzelschnitt sauber aus,
      // bevor wieder mehrere Segmente dazukommen.
      mkSeg({ chord: 160, span: 300, sweep: 10, washout: 0, dih: 0 })
    ],
    // Holmausschnitte sind von den Segmenten GELÖST: eine globale Liste. Jeder
    // Holm gilt für einen Segmentbereich (segFrom..segTo) und wird über die
    // Wurzel von segFrom und das Außenprofil von segTo als gerade Linie definiert.
    spars: [],
    // Mehrere Tragflächen je Projekt (wings.js): Die AKTIVE Tragfläche liegt
    // weiterhin in root/segments/spars (+ tragflächenbezogene cfg-Werte), damit
    // alle Reiter unverändert darauf arbeiten. wings[] hält Name + ruhende Daten
    // der übrigen Tragflächen; beim Umschalten werden die Daten getauscht.
    wings: [{ name: T('Tragfläche 1') }],
    activeWing: 0,
    // Frei wählbarer Projektname — oben in der Kopfzeile angezeigt und als
    // Vorschlag für den Dateinamen beim Speichern verwendet.
    projectName: '',
    // Freitext-Notizen je Bedienfeld (Schlüssel = Hash des Beschreibungstexts).
    // „project" wird mit dem Projekt gespeichert, „settings" mit den Einstellungen.
    notes: { project: {}, settings: {} },
    cfg: {
      twistRef: 0.25, points: 160,
      machineWidth: 900, blockZ: 20, blockZCenter: false, blockX: 0, blockY: 0, kerf: 1.2,
      // blockX = zusätzlicher Abstand X zwischen Nullpunkt und Blockrückkante
      // (0 = Nullpunkt direkt hinter dem Block; +Wert = Lücke davor).
      side: 'right',                      // 'right' | 'left' -> Spiegelung fürs Gegenstück
      sheeting: 0,                        // Beplankungsdicke (mm) — globaler „gleich"-Wert
      // Beplankungsmodell (Tragflächendesigner):
      //   sheetMode : 'global'  = ein Wert für die ganze Fläche
      //               'segment' = je Segment eigene Werte (Wurzel/außen) in den Segmentkarten
      //   sheetSides: 'same'    = Ober- und Unterschale gleich (nutzt cfg.sheeting bzw. seg.sheetRoot/Tip)
      //               'asym'    = Ober-/Unterschale getrennt (sheetTop/Bot bzw. seg.sheet*Top/Bot)
      sheetMode: 'global', sheetSides: 'same',
      sheetTop: 0, sheetBot: 0,           // globale asymmetrische Werte (oben/unten)
      feed: 220,
      feedAuto: true,                     // Vorschub automatisch = „Vorschub schnell" des Werkstoffs (Abbrand-Kalibrierpunkt) in ALLEN G-Codes
      outFeedMode: 'cut', outFeed: 600,   // Geschwindigkeit außerhalb Block: 'max'|'cut'|'free' (+ freier Wert)
      // Vorschub-Modus im erzeugten G-Code:
      //  'g94' = F ist die Geschwindigkeit in mm/min
      //  'g93' = Inverse Time: F ist der Kehrwert der Blockdauer (1/min). Die
      //          Zeit je Block wird damit EXPLIZIT vorgegeben; es haengt nicht
      //          mehr von der Steuerung ab, wie sie aus 4 Achsen eine Bahnlaenge
      //          bildet. Erfordert GRBL 1.1 / grblHAL / FluidNC / LinuxCNC / Mach3.
      //          Seit 2026-09-20 Standard (Migration alter Staende: filesys.js feedMig).
      feedMode: 'g93',
      // Schaltausgang (Relais) parallel zur Drahtheizung — z. B. RAMPS 1.4 mit
      // grbl-Mega-5X: die Heizung liegt auf der Spindel (M3 S…/M5, D8), ein
      // zusätzliches Relais/SSR hängt am Kühlmittelausgang (M7 = D10 „Mist",
      // M8 = D9 „Flood"). relayMode 'wire' = folgt der Heizung (auch um Pausen
      // herum), 'program' = einmal zu Programmbeginn ein, am Ende aus.
      // relayPin: 'm7' (RAMPS D10) | 'm8' (RAMPS D9) | 'digital' (M62/M63 P<n>,
      // grblHAL/FluidNC/LinuxCNC, Nummer in relayP) | 'custom' (relayOn/relayOff).
      relayOut: false, relayPin: 'm7', relayP: 0, relayOn: 'M7', relayOff: 'M9', relayMode: 'wire',
      cutDir: 'rear',                     // Schnittrichtung Kern: 'rear' (von hinten, Nase vorne) | 'front' (von vorne, Nase zum Nullpunkt; Ober-/Unterseite je Nase → Endleiste)
      cutOrder: 'none',                   // Schnittreihenfolge: 'before' | 'after' | 'wrap' | 'only' | 'none'
      cutSides: 'both',                   // Profilseiten: 'both' | 'top' (nur Oberseite) | 'bottom' (nur Unterseite)
      profileDir: 'top',                  // Profil-Schnittrichtung: 'top' (Oberseite zuerst) | 'bottom' (Unterseite zuerst)
      leStyle: 'x', leAngle: 45,   // NL-Art + Winkel (Längen je Segment)
      leGap: 0,                    // X-Schlaufe: fester vertikaler Abstand der horizontalen
                                   // Schneidelinien (mm). 0 = automatisch aus Winkel (2·A·sin).
      eightW: 12, eightH: 8,       // Liegende Acht an der Nase: Länge (Sehnenrichtung) × Höhe (mm)
      eightCross: 0,               // Liegende Acht: horizontale Lage der Selbstkreuzung (mm ab Nase; 0 = mittig)
      teStyle: 'horizontal',       // EL-Art: 'horizontal' = 2 waagr. Stege (Negativschalen-Logik) | 'skeleton' = entlang Skelettlinie | 'surface' = je Steg entlang eigener Fläche | 'surfaceUpper'/'surfaceLower' = beide parallel zur Ober-/Unterseite
      extOverBlockLE: false, extOverBlockClearLE: 5,  // Schnittverlängerung NL immer über Block (+Abstand mm)
      extOverBlockTE: false, extOverBlockClearTE: 5,  // Schnittverlängerung EL immer über Block (+Abstand mm)
      showCore: true, showKerf: true, showNums: false, numEvery: 10, showBlock: true, showDim: true,   // numEvery: jeder n-te Profilpunkt nummeriert
      showDihedral: true,                 // V-Form in Profil-/Drahtansicht zeigen
      ribShow: 'both',                     // Zeichenfenster: 'both' | 'inner' (Wurzel) | 'outer' (Rand)
      kerfMode: 'ratio',                  // kerf-Berechnung KERNDESIGN: 'ratio' (Profillängen) | 'speed' (Bahngeschwindigkeit); DXF-Formen/3D-Modell eigene (state.dxf/modelGcode.kerfMode)
      negKerfMode: 'ratio',               // dto. NUR für Negativschalendesign — bewusst entkoppelt vom Kerndesign
      kerfDatum: 'sym',                   // Bezugsseite für die Schalen-Passung: 'top' | 'bottom' | 'sym'
      kerfHeat: true,                     // Schnittspur nach lokalem kerf einfärben (Heatmap)
      showHingePlan: true,                // Scharnierlinie im Grundriss zeigen
      hingeAlign: false,                  // globale Pfeilung: Bezugslinie je Segmentgruppe gerade
      sweepRef: 'hinge',                  // Bezugslinie der Pfeilung: 'hinge' | 'le' | 'te'
      coreSplit: 0.333,                   // horizontale Teilung im Reiter „Kernschneiden" (Anteil oben: 1/3 Grundriss)
      wingColSplit: 0.5,                  // senkrechte Teilung obere Reihe (Grundriss|Profile) im Tragflächen-Reiter
      wingRowSplit: 0.5,                  // waagrechte Teilung (obere Reihe|Aufriss) im Tragflächen-Reiter
      dxfSplit: 0.333,                    // waagrechte Teilung im DXF-Reiter (Anteil oben: Grundriss)
      dxfPlanMode: 'plan',                // obere DXF-Ansicht: 'plan' (Grundriss) | 'elev' (Aufriss) | 'front' (Vorderansicht auf die Schneidepfade)
      dihedralCut: false,                 // V-Form in den Schnitt einrechnen (schräges Paneel)
      // Globale V-Form (°): dreht die GESAMTE Tragfläche um die Wurzelrippe.
      // Wirkt zusätzlich zur Segment-V-Form/Ausrichtung, ändert die Winkel der
      // Segmente zueinander NICHT (reine Starr-Drehung um die Wurzel).
      globalDih: 0,
      // Globale Höhenausrichtung der Profile zueinander. Ist sie aktiv, richtet
      // sie ALLE Rippen an einem gemeinsamen Merkmal aus und legt darüber EINE
      // globale V-Form der ganzen Tragfläche — die Segment-V-Form (dih/dihRoot)
      // wird dann nicht verwendet.
      align: {
        enable: false,
        ref: 'chord',        // 'top' | 'chord' | 'bottom' | 'hinge'
        dihMode: 'mm',       // globale V-Form: 'mm' (Höhe Randbogen) | 'deg' (Winkel)
        dih: 0
      },
      // Werkstück drehen bei starker Pfeilung (eigenständiges Modul sweeprot.js).
      // Dreht den Block um die Hochachse, bis die Bezugslinie parallel zur Draht-
      // achse liegt -> weniger X-Fahrweg. Wirkt NUR auf die Turmbahnen (left/right).
      sweepRot: false,
      sweepRotMode: 'auto',                // 'auto' (aus Bezugslinie) | 'manual' (fester Winkel)
      sweepRotRef: 0,                      // Sehnenanteil der Bezugslinie: 0 = Nasenleiste, 0.25 = t/4, 1 = Endleiste
      sweepRotAngle: 0,                    // fester Drehwinkel (°) im Modus 'manual'
      flipY: false,                        // Profil kopfüber schneiden (Unterseite oben, V-Form mitgespiegelt)
      stackCount: 1,                       // Kern übereinander stapeln: Anzahl Kopien (1 = aus)
      stackGap: 5,                         // vertikaler Abstand zwischen gestapelten Kernen (mm)
      stackOffset: 0,                      // vertikale Verschiebung des ganzen Stapels (mm, + = nach oben)
      stackBaseOn: false,                  // Stapel-Unterkante absolut über Blockunterkante (Y=0) setzen
      stackBase: 10,                       // Höhe der Stapel-Unterkante über der Blockunterkante (mm)
      stackMirror: false,                  // abwechselnd spiegeln (nesten / Paar links+rechts) statt gleich orientiert
      axX: 'X', axY: 'Y', axU: 'Z', axV: 'A', precision: 3,   // links X (horiz.)/Y (vert.), rechts Z (horiz.)/A (vert.)
      header: '', footer: '',
      maxTravelH: 0, maxTravelV: 0,        // max. Fahrweg Portale horiz./vert. (mm); 0 = kein Limit
      maxFeed: 0,                          // max. Vorschub (mm/min); 0 = kein Limit
      firmware: 'grblhal',                 // Maschinensteuerung im Reiter „Schneiden“: 'grblhal' | 'mega5x'
      // Warnungen (Simulation + Reiter „Schneiden“) einzeln abschaltbar — Menü
      // „Maschinengrenzen & Warnungen“ im Reiter „Maschine“.
      warnNeg: true,                       // Portal fährt ins Negative (< 0, Maschinennullpunkt)
      warnTravel: true,                    // max. Fahrweg horiz./vert. überschritten
      warnFeed: true,                      // max. Vorschub überschritten
      limitTips: true,                     // Lösungsvorschläge zu Grenz-Warnungen anzeigen
      // Aufheizphase liegt jetzt materialabhängig in state.material (preheatSec/preheatH).
      // Schalenschnitte: zwei horizontale Trennschnitte (Oberschale VOR, Unterschale
      // NACH dem Kernschnitt), trapezkompensiert. Der Draht läuft von vorne betrachtet
      // als leichtes Trapez (Keil = k_t − k_r je Rippe), um den höheren Abbrand an der
      // Außenrippe UND den zulasten der Schale gehenden Kern-Abbrand auszugleichen.
      shellCut: false, shellTop: 10, shellBot: 10,
      // Kerndesign: Kern in Stege zerlegen (kernteile.js, Aufteilung wie im Negativdesign
      // = negStegeList/negStegeGap). Es werden immer nur die Stege geschnitten.
      coreStegeOn: false,
      sparCut: true, sparKerfMode: 'in',   // Holme schneiden; Abbrand: 'none'|'in' (Tasche Nennmaß)|'out'
      // Abbrand-Bezug der Holme: 'local' = aus der lokalen Geschwindigkeit beim
      // Holmschnitt (Verhältnis der Taschenumfänge Wurzel/Außen, Standard),
      // 'profile' = wie das Profil je Rippe (Sehnen-/Vorschub-Verhältnis, cutKerf).
      sparKerfBasis: 'local',
      // Holm-Schnittmodus: 'during' = während des Profilschnitts (in die Bahn
      // eingerechnet), 'after' = nach dem Profilschnitt mit Pause (M0), 'only' =
      // nur die Holmausschnitte (kein Profilschnitt).
      sparCutMode: null, sparOnly: false,   // Schnittzeitpunkt je Holm (sp.cutMode); sparCutMode nur noch Altstand-Migration
      // Negativschalendesign (Reiter „Negativschalendesign"): Querschnitt einer
      // Negativschale (Formhälften) analog zur DXF-Vorlage. Der Block enthält das
      // Profil als Kavität; Ober- und Unterseite werden um `negSplit` mm ausein-
      // andergezogen, mit Überstand vorne/hinten und wählbarer Gesamtblockhöhe.
      negBlockH: 70, negOvF: 40, negOvR: 40, negSplit: 10,
      // Höhenlage der Tragfläche im Block: verschiebt die Profile (samt V-Form-
      // Versatz) vertikal gegenüber der Blockmitte. Positiv = Tragfläche nach OBEN,
      // negativ = nach UNTEN. Nützlich, um die V-Form besser in den Werkstoff-
      // Block einzupassen (z. B. das höher sitzende Außenprofil unter die Blockkante).
      negProfShift: 0,                    // Tragfläche (und damit Trennebene) im Formblock heben/senken (mm), 0 = V-Form-Spanne mittig
      negMatShift: 0,                     // Formblock im Werkstoff heben/senken (mm), 0 = mittig
      negViewSplit: 0.3,                  // Reiter „Negativdesign": Höhe des Aufriss-Fensters (Anteil 0..1)
      // Optionaler Kern zwischen den beiden Schalen: das Profil wird zusätzlich in
      // der Mitte mitgeschnitten. negCoreSheeting = Beplankungsabzug für DIESEN
      // Kern (Profil nach innen versetzt = fertiger Schaumkern unter der Beplankung).
      negTeStyle: 'horizontal',   // Schnittverlauf an der Endleiste: 'horizontal' = waagrecht | 'skeleton' = tangentiale Verlängerung der Skelettlinie
      negCore: false, negCoreSheeting: 1.5, negNoseExt: 4,   // negNoseExt = kleine vertikale Öffnung (mm) der Nasen-Schlaufe (horizontal bis Blockvorderkante)
      // Stützstoff (Schalenbauweise): zusätzliche geschlossene Kontur = Profil um
      // negSupportMM nach innen versetzt (Offset der Ober-/Unterschale). Als eigener
      // Schnitt neben der Kavität — ergibt den Stützstoff-Streifen unter der Schale.
      negSupport: false, negSupportMM: 1, negSupportMode: 'surface',   // 'surface' = versetzte Flächen (DXF), 'core' = Kernschnitt m. Nasen-Schlaufe
      negSupportGap: 1,   // Flächen-Modus: Abstand der 1. versetzten Fläche zur Schale; negSupportMM = Abstand der 2. Fläche zur 1. (= Stützstoffdicke)
      // Konstanter Überstand des Schalenrands (mm), gemessen ab Profil-Nase/-EL.
      // Wird VOR dem Profilschnitt als zwei planare Vertikalschnitte gefahren (wie
      // der Blockschnitt beim Kern) -> konstante Referenzkante zum späteren Bauen.
      negShellEdge: 10,
      // Schneideweg: 'precut' = Schnittverlängerung (negOvF/negOvR, proportional) + zwei
      // Randvorschnitte mit Freifahren (s. o.) | 'direct' = Block vorne/hinten genau auf
      // dem konstanten Überstand negShellEdge, EIN durchgehender Zug ohne Vorschnitte.
      negCutPath: 'precut',
      // Kern in Stege zerlegen (stege.js, nur mit negCore): Stege im selben Schnitt
      // wie die Schalen, um negStegeGap auseinandergerückt; je Steg {end (% Sehne),
      // sleeve (Glasschlauch), capTop/capBot (Holmgurt)} in negStegeList.
      negStegeOn: false, negStegeList: null, negStegeGap: 4,
      negStegeOnly: false,                // nur die Stege schneiden (ohne Schalen/Stützstoff/Vorschnitte)
      gcodeSource: 'core',                 // Quelle im Reiter „G-Code": 'core' (Kerndesign) | 'neg' (Negativschalendesign)
      // Werkstoff-Zuweisung je Tragfläche (Reiter „Projektübersicht", wings.js cfg-Keys):
      // matId/matHeight = Werkstoff-ID + Dicke (Blockhöhe) für Kern (Tragflächendesigner,
      // Kerndesign, G-Code, Simulation); negMatId/negMatHeight = eigene Zuweisung für die
      // Negativschalen. null = noch nicht zugewiesen -> Rückfall auf state.material.id/height
      // (Altprojekte). Zugriff nur über App.matIdFor(ctx) / App.blockH(ctx).
      // design = 'core' (Kern) | 'neg' (Negativschalen): welche der beiden Zuweisungen in der Projektübersicht gezeigt wird.
      design: 'core', matId: null, matHeight: null, negMatId: null, negMatHeight: null,
      // Gewichtsabschätzung je Tragfläche (Reiter „Projektübersicht", wings.js wingWeight):
      // wtCount = Stückzahl (Hälften), wtSheetMode 'none'|'density'|'area' (Beplankung aus
      // Dichte×Dicke oder direkt g/m²), wtSheetThick null = Dicke aus dem Tragflächendesign,
      // Gewebe 1/2 (g/m² je Lage, Lagenzahl), wtFiber = Faser-Gewichtsanteil im Laminat (%),
      // wtExtra = Zuschlag in g (Holme, Ruder, Anlenkungen …).
      wtCount: 2, wtSheetMode: 'none', wtSheetDensity: 160, wtSheetThick: null, wtSheetArea: 300,
      wtFab1Gsm: 0, wtFab1Layers: 1, wtFab2Gsm: 0, wtFab2Layers: 1, wtFiber: 50, wtExtra: 0,
      // Projektweite Werkstoff-Zuweisung (ohne Dicke) für DXF-Formen und 3D-Modell/Platte.
      dxfMatId: null, modelMatId: null,
      // Gewichtsschätzung DXF-Formen / 3D-Modell (Projektübersicht, overview.js secParts)
      dxfWtCount: 1, dxfWtExtra: 0, modelWtCount: 1, modelWtExtra: 0
    },
    // Werkstoff (Rohmaterial): Art aus der Werkstoff-Datenbank + Blockdicke (Y).
    // Länge (Spannweite) und Breite (Sehne) sind unwichtig — sie werden beim
    // Schnitt ohnehin beschnitten und daher nicht erfasst.
    // safeH = Sicherheitshöhe über dem Block. speed = aktives Schneidtempo
    // (langsam/schnell) -> bestimmt, welcher Schnittspalt (kerf) gilt. kerf =
    // manuelle Überschreibungen je Werkstoff-ID: { id: { slow, fast } }.
    // heat = Drahtheizung je Werkstoff-ID (%) am SCHNELLEN Kalibrierpunkt: { id: prozent }.
    // heatSlow = optionaler zweiter Heizungs-Kalibrierpunkt am LANGSAMEN Vorschub
    // ({ id: prozent }); fehlt er, ist die Heizung konstant (= heat).
    // Der Abbrand an Punkt 3 ist per Definition der von Punkt 1 (Heizstrom 2 wird
    // darauf kalibriert) — kein eigener Wert.
    // kerf/feed = Kalibrier-Overrides je Werkstoff (langsam/schnell) für die
    // kerf-vs-Vorschub-Gerade. Der wirksame kerf folgt dem eingegebenen Vorschub.
    material: { id: '', mats: [], props: {}, height: 60, safeH: 40, meltDwell: 3, preheatSec: 3, preheatH: 10, kerf: {}, feed: {}, heat: {}, heatSlow: {}, cal: {} },
    // Abbrand-Kalibrierung: Testrechtecke (Länge×Höhe) am gewählten Werkstoff,
    // je Vorschub (langsam/schnell), mit oder ohne Abbrand-Kompensation. count =
    // Anzahl (gestapelt mit gap Abstand). Die Vorschub-/Abbrand-Werte sind die
    // Kalibrierpunkte des Werkstoffs (feedPair/kerfPair).
    calib: { len: 100, hgt: 20, count: 2, gap: 15, withKerf: false, speed: 'fast', xDist: 20, yBase: 20 },
    // Blockzurichten: fertiger Block per zwei kerf-kompensierten Vertikalschnitten.
    // dist = X-Abstand des 1. Schnitts vom Nullpunkt, length = Blocklänge (Abstand
    // zum 2. Schnitt), height = Blockhöhe ab Y0 (Maschinen-Nullpunkt).
    block: { dist: 20, length: 300, height: 60, feed: 300, lenSrc: 'free' },
    // Guillotine: EIN gerader Schnitt — Höhe, X-Abstand zum Nullpunkt (Block unten)
    // und Winkel (0° = senkrecht; positiv kippt die Oberkante nach +X/hinten).
    // upMode = 'rapid' (Eilgang, Draht autom. AUS) | 'cut' (Vorschub, Draht autom. EIN) beim Rauffahren.
    guillotine: { height: 60, xDist: 0, angle: 0, feed: 300, upMode: 'rapid', overY: 0 },  // overY = Überfahrt unter Y0 (mm, als negativer Y-Wert gespeichert; sicher durchschneiden)
    // Block horizontal: waagrechte Schnitte über die Blocklänge. mode='height'
    // trennt nur oben (auf Zielhöhe yTop), mode='topbottom' trennt oben+unten
    // (fertige Scheibe zwischen yBot und yTop). dist/length = X-Ausdehnung.
    blockH: { dist: 20, length: 300, yTop: 60, yBot: 15, mode: 'height', feed: 300, over: 10, pass: 'cutRapid' },   // over = X-Überlauf vor/hinter dem Block (mm); pass = Ablauf bei „nur oben": rapidCut (Eilgang hin, Schnitt zurück) | cutRapid (Schnitt hin, Eilgang zurück; Standard) | cutCut (Schnitt hin und zurück)
    activeSeg: 'all',                    // Start: kein Segment aufgeklappt (Karten zu)
    activeSpar: null,                    // aktiver Holm (aufgeklappt); null = keiner
    activeTab: 'material',               // aktiver Reiter -> steuert die Sidebar (Start: Projektübersicht und Werkstoffzuordnung)
    importTarget: null,
    lastGcode: null,
    gcodeEdited: false,                  // G-Code von Hand bearbeitet -> autoGen sperren
    // Profilbearbeitung: gewähltes Zielprofil ('root' | Segment-Index), Punktzahl
    // und gewünschte Endleistendicke (mm, bezogen auf die Sehne des Ziels). base =
    // Ausgangsprofil je Ziel (unbearbeitet) für nicht-destruktives Neuberechnen.
    profEdit: { target: 'root', points: 160, teMM: null, thickPct: null, camPct: null },
    profBase: {},
    // Punkte-Editor (Kerndesign & Negativschalendesign): Kontur-Stützpunkte des
    // aktiven Segments direkt im Querschnitt verschieben/löschen/hinzufügen. Wurzel
    // und Rand werden strukturell synchron gehalten (gleiche Punktzahl/Index).
    ptEdit: { on: false, tool: 'move', target: 'profile', negTarget: 'cavity', drag: null, hover: null, undo: [], redo: [] },
    // Manuell bearbeitete Schnittpfade je Segment (Kerndesign). Wenn gesetzt, wird
    // der generierte Pfad DIESES Segments durch den eingefrorenen/bearbeiteten
    // ersetzt (root/tip in Cut-mm). Über „Zurücksetzen" wieder aus dem Profil.
    pathEdit: {},
    // Manuell bearbeitete Negativschalen-Profile je Segment (Reiter „Negativ-
    // design"). Wenn gesetzt, ersetzt der eingefrorene/bearbeitete Rippenzug
    // (root/tip in Cut-mm) das aus dem Tragflächendesign abgeleitete Profil —
    // NUR für die Negativschale. Über „Zurücksetzen" wieder aus dem Wingdesign.
    // Bewusst getrennt von pathEdit/Profil: das Kerndesign darf die Negativschale
    // niemals beeinflussen, und Punkt-Edits hier ändern das Originalprofil nicht.
    //   negEdit     = Kavität: Override der Schalengeometrie (negShell-Nennumriss,
    //                 vor Abbrand) je Segment.
    //   negBurnEdit = Schnittverlauf: Override der kerf-kompensierten Abbrandlinie
    //                 (tatsächliche Drahtbahn, nach Abbrand) je Segment.
    // Im Punkte-Editor über „Ziel" wählbar; keiner der beiden ändert das Original-
    // profil oder das Kerndesign.
    negEdit: {},
    negBurnEdit: {},
    // DXF-Formen (Reiter „DXF-Formen"): zwei importierte Turmprofile (INNEN =
    // Wurzel-/linke Ebene, AUSSEN = Rand-/rechte Ebene) mit manuell gesetzten
    // Synchronpaaren, Startpaar und Umlaufrichtung. sync = [{i,j}] (Index in der
    // jeweils gewählten Kontur). density = Zielpunktzahl der synchronen Bahn.
    dxf: { file: null, layers: null, order: [], innerName: null, outerName: null,
           innerOff: { x: 0, y: 0 }, outerOff: { x: 0, y: 0 },  // Verschiebung je Kontur (mm) zum Ausrichten zweier separater DXF
           inner: null, outer: null, sync: [], start: 0, dir: 1, density: 240,
           span: 300, pick: null, kerf: true, safeLead: true,
           showBlock: true, blockMargin: 10,   // Mindestabstand des Blockrands zum Profil (rundum, mm)
           blockOvF: 20, blockOvR: 20,         // (Alt) getrennte Zugabe vorne/hinten — nicht mehr in der UI
           blockLenX: 0, blockHeightY: 0,      // feste Blockmaße X/Y (0 = automatisch aus Geometrie + Zugaben)
           // Mehrere Segmente als RIPPENKETTE (wie Tragfläche): ribs = geordnete
           // Profile (je ein Layer aus dem geteilten Pool d.layers + Verschiebung),
           // jedes benachbarte Paar bildet ein Segment. segs = Snapshot je Segment
           // (Länge = ribs.length-1). Die obigen Flachfelder spiegeln activeSeg.
           ribs: null, segs: null, activeSeg: 0,
           showSpur: true,                     // Schnittspur (Abbrand-Bahn) im DXF-Reiter zeigen
           kerfMode: 'ratio',                  // Abbrand-Berechnung NUR für DXF-Formen: 'ratio' | 'speed' (entkoppelt vom Kerndesign)
           densMode: 'total', perMM: 1,        // Punktverteilung: 'total' | 'permm'
           syncMode: false,                    // aktiv = Klick setzt Synchronpunkte
           syncHover: null,                    // Hover-Vorschau im Setzmodus {which,i} — Rastpunkt vor dem Klick
           pathEdit: null,                     // eingefrorene Schneidepfad-Stützpunkte {inner,outer} (Override)
           pEdit: { on: false, target: 'profile', tool: 'move', drag: null, undo: [], redo: [] },  // Punkteditor: 'profile' = INNEN/AUSSEN-Kontur, 'path' = synchronisierter Schneidepfad
           undo: [], redo: [],                 // Bearbeiten: Rückgängig/Wiederholen
           // Bearbeiten-Modus (Mini-CAD): Werkzeug, aktiver Layer, Auswahl,
           // laufende Skizze (draft) und Fangen (snap).
           edit: { on: false, tool: 'select', active: null, snap: true,
                   sel: [], draft: null, drag: null, hover: null,
                   cross: true, showGrid: true, gridSnap: false, gridStep: 10,
                   // Objektfang-Typen (F3 = Master an/aus) + Ortho (F8).
                   snapEnd: true, snapMid: true, snapPerp: true, snapNear: false,
                   ortho: false, snapKind: null },
           // Hintergrundbild (Referenz-/Vorlagenbild) mit freier Platzierung:
           // Mitte bei (x,y) in mm, scale = mm je Bildpixel, rot in Grad.
           bg: { url: null, img: null, iw: 0, ih: 0, x: 0, y: 0, scale: 1,
                 rot: 0, opacity: 0.55, visible: true, moveMode: false } },
    // Reiter „DXF-Export": eigener DXF-Export. Auswahl der Inhalte (anhaken),
    // Ebenen (Kern/Negativ) und Segmente. Alles Ausgewählte landet in EINER
    // DXF-Datei, Layer benannt nach Ebene, Inhalt und Segment.
    dxfExport: {
      grundriss: true,          // Tragflächen-Grundriss (Draufsicht) inkl. Profillage, Scharnier, Maße
      aufriss: false,           // Aufriss (Vorderansicht: Spannweite × Höhe / V-Form)
      profReal: true,           // Profile in realer Lage (mit Pfeilung + V-Form)
      profChord: true,          // Profile auf Sehne gestapelt
      workpiece: true,          // Schneidepfad am Werkstück (pro Segment)
      tower: true,              // Schneidepfad am Turm (pro Segment)
      holme: true,              // aktive Holmausschnitte in Grundriss + Profilen
      beplankung: true,         // Beplankung (Kernkontur) in den Profilen, falls gesetzt
      levelCore: true,          // Ebene Kern (Profilschnitt)
      levelNeg: false,          // Ebene Negativschale
      stege: false,             // Kern-Stege (Negativdesign): Nennkonturen je Steg
      segs: null                // null = alle; sonst Array aktiver Segment-Indizes
    },
    // Reiter „CAD-Bearbeitung": eigenständiger 2D-CAD-Editor (Store getrennt von
    // DXF-Formen). Geometrie als benannte Layer von Loops (mkLoopLocal: Array mit
    // .closed). Brücken importieren Konturen aus DXF-Formen bzw. Rippendesign;
    // Export als eigene DXF. KEIN Zurückschreiben in die Quelle.
    cad: {
      layers: {}, order: [],
      // Anzeigefarbe je Layer (Hex, umstellbar); Export bildet auf ACI ab.
      layerColors: {},
      // Ausgeblendete Layer (Name -> true): nicht gezeichnet/wählbar/exportiert.
      layerHidden: {},
      // Linienart je Layer: 'solid' | 'dashed' | 'dotted' | 'dashdot'.
      lineStyles: {},
      // Eingefrorene Basis-Ansicht (Weltausschnitt). Wird EINMAL berechnet und
      // bleibt stabil — der Ausschnitt folgt NICHT den Objekten; Pan/Zoom (nav.cad)
      // verschieben ihn. null = beim nächsten Render neu einpassen.
      view: null,
      // Referenz-/Hintergrundbild (nur Vorlage, nicht Teil der Geometrie).
      bg: { url: null, img: null, iw: 0, ih: 0, x: 0, y: 0, scale: 1, rot: 0, opacity: 0.55, visible: true },
      // Textelemente (z. B. importierte Maßtexte): {x,y,h,text,rot,layer}.
      texts: [],
      edit: { tool: 'select', lastTool: null, active: null, sel: [], draft: null, drag: null, hover: null, pan: null,
              snap: true, snapEnd: true, snapMid: true, snapPerp: true, snapNear: false, snapInt: true, snapQuad: true, snapTan: false,
              // Voreinstellungen: Abrundungsradius, Fasenabstände, Bemaßungs-Texthöhe, Polygonseiten.
              filletR: 5, chamferD1: 2, chamferD2: 2, dimH: 3, polyN: 6,
              ortho: false, snapKind: null, snapHit: false,
              gridSnap: false, gridStep: 10, cross: true, crossSize: 100, dynIn: true, showGrid: true, showOrigin: true,
              // Punktzahl (Segmente) für Kreis/Ellipse + Abfrage beim Zeichnen (Standard: aus).
              arcPoints: 48, arcAsk: false,
              // Punkte je Spline-Segment (Auflösung der Kurve).
              splineSeg: 48,
              // „Mitte zwischen 2 Punkten": laufende 2-Punkt-Erfassung (null = inaktiv).
              m2p: null },
      undo: [], redo: []
    }
  };

  // Frische Projekt-Defaults als Snapshot — wird für „Neues Projekt" gebraucht,
  // um cfg/dxf/cad auf die im Quelltext hinterlegten Anfangswerte zurückzusetzen,
  // ohne Maschinen-Einstellungen (MACHINE_KEYS) und Werkstoff-DB zu berühren.
  // Deep-Clone via JSON: alle Anfangswerte sind hier plain JSON (Image/Handles
  // sind zu diesem Zeitpunkt noch null).
  const PROJECT_DEFAULTS = {
    cfg: JSON.parse(JSON.stringify(state.cfg)),
    dxf: JSON.parse(JSON.stringify(state.dxf)),
    cad: JSON.parse(JSON.stringify(state.cad))
  };

  let wing = null, segZ = [];
  let profSegOpen = false;   // Segment-Filter am Profilfenster ausgeklappt?

  // ---------- Zentrale Farbpalette (UI + Zeichnung) -------------------
  // Ein Ort für ALLE Farben. UI-Schlüssel spiegeln die CSS-Variablen (--name);
  // Zeichnungs-Schlüssel werden in den Canvas-Funktionen als PAL.xxx gelesen.
  const PAL_DEF = {
    bg: '#0f1216', panel: '#171b21', panel2: '#1e242c', line: '#2a323c', txt: '#e6ebf1', muted: '#8b98a8',
    accent: '#4aa3ff', accent2: '#ffb454', good: '#57d38c', bad: '#ff6b6b', wire: '#ff5a3c',
    profInner: '#4aa3ff', profOuter: '#ffb454', block: '#8fa0b4', blockOuter: '#8fa0b4',
    core: '#57d38c', skeleton: '#ffd27f',
    kerf: '#ff5a3c', origin: '#ff3b3b', grid: '#1a2028', crosshair: '#57d38c', syncStart: '#57d38c',
    hinge: '#ff5ad0', dim: '#c9d4e0', towerL: '#4aa3ff', towerR: '#ffb454', profile: '#57d38c',
    spar: '#7ad0ff', sparLead: '#ffd27f', shellCut: '#5bd6c8',
    shellEdge: '#c78bff', shellEdgeOuter: '#c78bff',
    mat: '#c9a25e'          // Werkstoff-Block (Rohblock um den Negativblock) — sandfarben, deutlich vom grauen Negativblock
  };
  const PAL_GROUPS = [
    ['Oberfläche', [['bg', 'Hintergrund'], ['panel', 'Panel'], ['panel2', 'Panel (hell)'], ['line', 'Rahmen/Linien'],
      ['txt', 'Text'], ['muted', 'Text (gedämpft)'], ['accent', 'Akzent'], ['accent2', 'Akzent 2'],
      ['good', 'Grün/OK'], ['bad', 'Rot/Fehler'], ['wire', 'Draht']]],
    ['Zeichnung', [['profInner', 'Innenprofil'], ['profOuter', 'Außenprofil'],
      ['block', 'Blockgrenze innen'], ['blockOuter', 'Blockgrenze außen'],
      ['core', 'Kern/Beplankung'], ['skeleton', 'Skelettlinie'], ['kerf', 'Schnittspur (Abbrand)'],
      ['origin', 'Maschinennullpunkt'], ['grid', 'Raster'], ['crosshair', 'Fadenkreuz'],
      ['syncStart', 'Synchron/Start'], ['hinge', 'Scharnier'], ['dim', 'Bemaßung'],
      ['towerL', 'Turm links'], ['towerR', 'Turm rechts'], ['profile', 'Flächenprofil (3D)'],
      ['spar', 'Holmausschnitt'], ['sparLead', 'Holm-Anfahrt'],
      ['shellCut', 'Schalenschnitt'],
      ['shellEdge', 'Schalenrand konstant innen'], ['shellEdgeOuter', 'Schalenrand konstant außen'],
      ['mat', 'Werkstoff-Block']]]
  ];
  const CSS_KEYS = ['bg', 'panel', 'panel2', 'line', 'txt', 'muted', 'accent', 'accent2', 'good', 'bad', 'wire'];
  const PAL_KEY = 'hotwing.palette';
  let PAL = Object.assign({}, PAL_DEF);
  function applyPalette() {
    CSS_KEYS.forEach(k => document.documentElement.style.setProperty('--' + k, PAL[k]));
    // Farbfelder in HTML-Legenden (z. B. 3D-Simulation) folgen der Palette.
    try { document.querySelectorAll('[data-pal]').forEach(el => { const c = PAL[el.dataset.pal]; if (c) el.style.background = c; }); } catch (e) {}
    if (window.Sim3D && Sim3D.setColors) Sim3D.setColors({ towerL: PAL.towerL, towerR: PAL.towerR, wire: PAL.wire, origin: PAL.origin, profile: PAL.profile });
  }
  function loadPalette() {
    try { const s = localStorage.getItem(PAL_KEY); if (s) Object.assign(PAL, JSON.parse(s)); } catch (e) {}
    // INNEN/AUSSEN sollen sich immer farblich unterscheiden (alte Paletten: beide blau).
    if (PAL.profOuter === PAL.profInner) PAL.profOuter = PAL_DEF.profOuter;
    applyPalette();
  }
  function savePalette() { try { localStorage.setItem(PAL_KEY, JSON.stringify(PAL)); } catch (e) {} }

  // ---------- Strichtyp je Zeichnungslinie (parallel zur Farbe) -------
  // Für Zeichnungslinien lässt sich neben der Farbe auch der Strichtyp wählen.
  // 'auto' behält das ursprüngliche Aussehen der jeweiligen Linie bei; jede
  // andere Wahl überschreibt das Strichmuster. Nur Schlüssel, die tatsächlich
  // eine Linie zeichnen, sind wählbar (LST_KEYS).
  const LINE_STYLES = [
    ['auto', 'Automatisch'], ['solid', 'Durchgezogen'], ['dashed', 'Gestrichelt'],
    ['dotted', 'Gepunktet'], ['dashdot', 'Strich-Punkt']
  ];
  const DASH_MAP = { solid: [], dashed: [6, 4], dotted: [1, 3], dashdot: [6, 3, 1, 3] };
  const LST_KEYS = ['profInner', 'profOuter', 'block', 'blockOuter', 'core', 'skeleton', 'kerf',
    'grid', 'crosshair', 'syncStart', 'spar', 'sparLead', 'shellCut', 'shellEdge', 'shellEdgeOuter', 'hinge', 'mat'];
  // Ab Werk vorgegebene Strichtypen (Rest = 'auto' = ursprüngliches Aussehen):
  // Originalprofil durchgezogen (blau), Beplankungslinie gestrichelt (grün),
  // Schnittspur gepunktet (rot). Farben stehen bereits in PAL_DEF.
  const LST_DEFAULT = { profInner: 'solid', profOuter: 'solid', block: 'solid', blockOuter: 'dashed',
    shellEdge: 'solid', shellEdgeOuter: 'dashed', core: 'dashed', kerf: 'dotted', mat: 'solid' };
  const LST_DEF = {}; LST_KEYS.forEach(k => LST_DEF[k] = LST_DEFAULT[k] || 'auto');
  const LST_KEY = 'hotwing.linestyle';
  let LST = Object.assign({}, LST_DEF);
  function loadLineStyles() {
    try { const s = localStorage.getItem(LST_KEY); if (s) Object.assign(LST, JSON.parse(s)); } catch (e) {}
  }
  function saveLineStyles() { try { localStorage.setItem(LST_KEY, JSON.stringify(LST)); } catch (e) {} }
  // Strichmuster für einen Schlüssel: bei 'auto' das übergebene Standardmuster,
  // sonst das gewählte. Direkt an ctx.setLineDash(...) übergebbar.
  function dashFor(key, fallback) {
    const st = LST[key];
    if (!st || st === 'auto') return fallback || [];
    return DASH_MAP[st] || [];
  }

  // ---------- Schnittspur (Abbrand) in wahrer Dicke --------------------
  // Anzeige-Vorliebe JE DESIGNEBENE (Kern inkl. Schalen-/Holmschnitt, Negativ,
  // DXF-Formen, 3D-Modell, Schriften): unter die dünne Drahtmitte ein Band in der
  // echten Schnittspaltbreite legen (render.js kerfBand). Wie Farben/Strichtypen
  // im Browser-Speicher -> gilt projektunabhängig. alpha = Deckkraft des Bands.
  const KTRUE_KEY = 'hotwing.kerfTrue';
  const KTRUE_VIEWS = [['core', 'Kerndesign'], ['neg', 'Negativdesign'], ['dxf', 'DXF-Formen'],
    ['model', '3D-Modell'], ['schrift', 'Schriften']];
  const KTRUE_DEF = { on: false, alpha: 0.35 };
  const KTRUE = {};
  KTRUE_VIEWS.forEach(([v]) => KTRUE[v] = Object.assign({}, KTRUE_DEF));
  function loadKerfTrue() {
    try {
      const s = localStorage.getItem(KTRUE_KEY); if (!s) return;
      const o = JSON.parse(s) || {};
      // Altstand: eine gemeinsame Einstellung {on, alpha} -> für jede Ebene übernehmen.
      const flat = (o.on != null || o.alpha != null) && !KTRUE_VIEWS.some(([v]) => o[v]);
      KTRUE_VIEWS.forEach(([v]) => { const src = flat ? o : o[v]; if (src) Object.assign(KTRUE[v], { on: !!src.on, alpha: src.alpha != null ? src.alpha : KTRUE_DEF.alpha }); });
    } catch (e) {}
  }
  function saveKerfTrue() { try { localStorage.setItem(KTRUE_KEY, JSON.stringify(KTRUE)); } catch (e) {} }
  // Designebene der Abbrand-Darstellung aus dem Reiter (Tragflächendesign -> Kern).
  function kerfView(tab) { tab = tab || state.activeTab; return KTRUE[tab] ? tab : 'core'; }
  function kerfTrueOn(v) { const k = KTRUE[v || kerfView()]; return !!(k && k.on); }
  function kerfTrueAlpha(v) { const k = KTRUE[v || kerfView()]; return (k && k.alpha != null) ? k.alpha : KTRUE_DEF.alpha; }

  // ---------- Zeichnungsfarben/Strichtypen JE DESIGN-ANSICHT ----------
  // Tragflächendesign (wing), Kerndesign (core) und Negativdesign (neg) haben
  // eigene Zeichnungsfarben UND Strichtypen. Oberflächen-/UI-Farben (CSS) sowie
  // reine 3D-/Maschinenfarben (origin/towerL/towerR) bleiben global.
  const VIEWS = [['wing', 'Tragflächendesign'], ['core', 'Kerndesign'], ['neg', 'Negativdesign'], ['dxf', 'DXF-Formen']];
  const GLOBAL_DRAW_KEYS = ['origin', 'towerL', 'towerR', 'profile'];
  // Zeichnungs-Farbschlüssel je Ansicht = alle „Zeichnung"-Schlüssel außer global.
  const PER_VIEW_KEYS = PAL_GROUPS[1][1].map(e => e[0]).filter(k => GLOBAL_DRAW_KEYS.indexOf(k) < 0);
  const PER_VIEW_LABEL = {}; PAL_GROUPS[1][1].forEach(([k, l]) => PER_VIEW_LABEL[k] = l);
  const VPAL_KEY = 'hotwing.vpalette', VLST_KEY = 'hotwing.vlinestyle';
  const VPAL = {}, VLST = {};
  VIEWS.forEach(([v]) => {
    VPAL[v] = {}; PER_VIEW_KEYS.forEach(k => VPAL[v][k] = PAL_DEF[k]);
    VLST[v] = {}; LST_KEYS.forEach(k => VLST[v][k] = LST_DEFAULT[k] || 'auto');
  });
  function loadViewPalettes() {
    let hasV = false, hasL = false;
    try { const s = localStorage.getItem(VPAL_KEY); if (s) { const o = JSON.parse(s); VIEWS.forEach(([v]) => { if (o[v]) Object.assign(VPAL[v], o[v]); }); hasV = true; } } catch (e) {}
    try { const s = localStorage.getItem(VLST_KEY); if (s) { const o = JSON.parse(s); VIEWS.forEach(([v]) => { if (o[v]) Object.assign(VLST[v], o[v]); }); hasL = true; } } catch (e) {}
    // Migration: früher globale Zeichnungsfarben/-strichtypen auf alle drei
    // Ansichten übernehmen, damit bestehende Anpassungen erhalten bleiben.
    if (!hasV) VIEWS.forEach(([v]) => PER_VIEW_KEYS.forEach(k => { if (PAL[k] != null) VPAL[v][k] = PAL[k]; }));
    if (!hasL) VIEWS.forEach(([v]) => LST_KEYS.forEach(k => { if (LST[k]) VLST[v][k] = LST[k]; }));
  }
  function saveViewPalettes() {
    try { localStorage.setItem(VPAL_KEY, JSON.stringify(VPAL)); localStorage.setItem(VLST_KEY, JSON.stringify(VLST)); } catch (e) {}
  }
  // Aktive Design-Ansicht aus dem Reiter ableiten (Fallback: Tragflächendesign).
  function curView() { const t = state.activeTab; return (t === 'core' || t === 'neg' || t === 'dxf') ? t : 'wing'; }
  // Vor dem Zeichnen die Zeichnungsfarben/-strichtypen der aktiven Ansicht in die
  // aktiven Container (PAL/LST) spiegeln — so bleibt der restliche Zeichencode
  // unverändert (liest weiter PAL.xxx bzw. dashFor(...)).
  function applyView(v) {
    v = v || curView();
    const vp = VPAL[v]; if (vp) PER_VIEW_KEYS.forEach(k => { if (vp[k] != null) PAL[k] = vp[k]; });
    if (VLST[v]) LST = VLST[v];
  }
  // Zeichnungsfarben + Strichtypen einer Ansicht in eine andere übernehmen.
  function copyViewSettings(fromV, toV) {
    if (fromV === toV) return;
    PER_VIEW_KEYS.forEach(k => VPAL[toV][k] = VPAL[fromV][k]);
    LST_KEYS.forEach(k => VLST[toV][k] = VLST[fromV][k]);
    saveViewPalettes(); applyView(); if (typeof App.render === 'function') App.render(); App.buildSettingsModal();
  }


  // ---- Registry: eigene Top-Level-Namen bereitstellen (automatisch) ----
  Object.assign(App, { CSS_KEYS, DASH_MAP, GLOBAL_DRAW_KEYS, LINE_STYLES, LST_DEF, LST_DEFAULT, LST_KEY, LST_KEYS });
  Object.assign(App, { askText });
  Object.assign(App, { PAL_DEF, PAL_GROUPS, PAL_KEY, PER_VIEW_KEYS, PER_VIEW_LABEL, PROJECT_DEFAULTS, T, Ttitle });
  Object.assign(App, { VIEWS, VLST, VLST_KEY, VPAL, VPAL_KEY, applyPalette, applyView, copyViewSettings });
  Object.assign(App, { curView, dashFor, loadLineStyles, loadPalette, loadViewPalettes, mkSeg, parseNum, saveLineStyles });
  Object.assign(App, { KTRUE, KTRUE_DEF, KTRUE_VIEWS, kerfTrueAlpha, kerfTrueOn, kerfView, loadKerfTrue, saveKerfTrue });
  // Maschinengrenzen + Warnschalter für Simulation (sim3d) und Schneiden (grbl).
  // Abgeschaltete Warnungen liefern 0/false, sodass die Prüfungen still bleiben.
  function machineLimits() {
    const c = state.cfg;
    return { h: c.maxTravelH, v: c.maxTravelV, f: c.maxFeed,
      warnNeg: c.warnNeg !== false, warnTravel: c.warnTravel !== false, warnFeed: c.warnFeed !== false };
  }
  /* Lösungsvorschläge zu einer Grenzverletzung (Simulation + Reiter „Schneiden").
     viol = { kind:'neg'|'max'|'feed', axis:'X', val, limit }. Rückgabe: Liste
     kurzer Handlungsempfehlungen mit konkreten Zahlen aus dem aktuellen Stand. */
  function limitAdvice(viol) {
    if (!viol || state.cfg.limitTips === false) return [];
    const c = state.cfg, tips = [];
    const ax = String(viol.axis || '').toUpperCase();
    const horiz = ax === String(c.axX || 'X').toUpperCase() || ax === String(c.axU || 'Z').toUpperCase();
    const r1 = v => (Math.round(v * 10) / 10).toFixed(1);
    if (viol.kind === 'feed') {
      const F = +viol.limit || 0;
      tips.push(T('Vorschub im Reiter „G-Code" auf höchstens ') + F + T(' mm/min setzen (aktuell ') + (c.feed || 0) + ' mm/min).');
      if (c.outFeedMode === 'free' && (c.outFeed || 0) > F)
        tips.push(T('„Geschwindigkeit außerhalb Block" auf „Maximum" stellen oder Außen-Vorschub auf höchstens ') + F + T(' mm/min senken (aktuell ') + c.outFeed + ' mm/min).');
      if ((c.feed || 0) <= F)
        tips.push(T('Bei Trapezflächen fährt das äußere Portal schneller als der Vorschub: Schnitt-Vorschub so weit senken, dass auch das schnellere Portal unter ') + F + T(' mm/min bleibt.'));
      tips.push(T('Falls die Maschine schneller kann: „Max. Vorschub" im Reiter „Maschine" anheben (0 = kein Limit).'));
      return tips;
    }
    if (viol.kind === 'neg') {
      const need = Math.max(0, -(+viol.val || 0));
      // Kernschnitt „von vorne": Nullpunkt liegt VOR der Nase — dort ragt die Nasenverlängerung heraus.
      const fr = c.cutDir === 'front' && (!c.gcodeSource || c.gcodeSource === 'core');
      if (horiz) {
        tips.push(T('Block weiter vom Nullpunkt weg: „Abstand in Flugrichtung X" (Reiter Block) um mindestens ') + r1(need) + T(' mm erhöhen (aktuell ') + (c.blockX || 0) + ' mm).');
        tips.push(fr ? T('Schnittverlängerung an der Nase verkürzen oder „Schnittverlängerung über Block" ausschalten (Reiter „G-Code").')
                     : T('Schnittverlängerung an der Endleiste verkürzen oder „Schnittverlängerung über Block" ausschalten (Reiter „G-Code").'));
      } else {
        tips.push(T('Block höher legen: „Höhe über Nullpunkt Y" (Reiter Block) um mindestens ') + r1(need) + T(' mm erhöhen (aktuell ') + (c.blockY || 0) + ' mm).');
        tips.push(T('Profil-Lage im Block prüfen: Anstellwinkel oder Verwindung drückt die Endleiste unter die Blockunterkante.'));
      }
      tips.push(fr ? T('Maschinennullpunkt prüfen: Bei „von vorne" muss der Nullpunkt vor der Nase bzw. unter dem Block liegen.')
                   : T('Maschinennullpunkt prüfen: Der Nullpunkt muss hinter bzw. unter dem Block liegen.'));
      return tips;
    }
    // kind === 'max'
    const over = Math.max(0, (+viol.val || 0) - (+viol.limit || 0));
    if (horiz) {
      if ((c.blockX || 0) > 0)
        tips.push(T('„Abstand in Flugrichtung X" (Reiter Block) um mindestens ') + r1(over) + T(' mm verringern (aktuell ') + c.blockX + ' mm).');
      tips.push(T('Schnittverlängerung an Nase/Endleiste kürzen (Reiter „G-Code") – spart Fahrweg vor und hinter dem Profil.'));
      tips.push(T('Teil in Flugrichtung verkleinern oder die Tragfläche in mehrere Segmente/Blöcke aufteilen.'));
      tips.push(T('Falls die Maschine mehr Weg hat: „Max. Fahrweg horizontal" im Reiter „Maschine" auf mindestens ') + r1(+viol.val) + T(' mm setzen.'));
    } else {
      if ((c.blockY || 0) > 0)
        tips.push(T('„Höhe über Nullpunkt Y" (Reiter Block) um mindestens ') + r1(over) + T(' mm verringern (aktuell ') + c.blockY + ' mm).');
      tips.push(T('Block flacher legen: Anstellwinkel/Verwindung verringern oder Blockhöhe reduzieren.'));
      tips.push(T('Falls die Maschine mehr Weg hat: „Max. Fahrweg vertikal" im Reiter „Maschine" auf mindestens ') + r1(+viol.val) + T(' mm setzen.'));
    }
    return tips;
  }
  // ---------- Demo-Ausgaben einzelner Funktionen -------------------------
  // Das Build-Tool kann eine Funktion als „nur Demo (ohne Export)" bauen; ihre
  // ID steht dann in window.BUILD_INFO.demo. Das Modul sperrt seine Exporte
  // selbst — demoFeature() liefert dafür die drei üblichen Handgriffe:
  //   const DEMO = App.demoFeature('cad', 'Demo-Version: …');
  //   if (DEMO.blocked()) return;      // im Export-Aufruf
  //   DEMO.btn(mkMini('Als DXF …'));   // Schaltfläche sperren und beschriften
  function demoFeature(id, msg) {
    const list = (window.BUILD_INFO && Array.isArray(window.BUILD_INFO.demo))
      ? window.BUILD_INFO.demo : [];
    // Zwei „globale" Pseudo-Funktionen sperren den Export in JEDER Funktion:
    //   'kern'  = Schalter „Kern: nur Demo" (kein Schreibweg mehr, auch Projekt).
    //   'kernp' = Design-Ausgabe „nur Projekt speichern" (jeder Export gesperrt,
    //             aber „Projekt speichern" .json bleibt erlaubt, siehe unten).
    // Für die einzelne Funktion wirken beide gleich: ihr Export ist gesperrt.
    const globalLock = list.indexOf('kern') >= 0 || list.indexOf('kernp') >= 0;
    const isLockId = (id === 'kern' || id === 'kernp');
    const on = list.indexOf(id) >= 0 || (!isLockId && globalLock);
    // In der reinen Design-Ausgabe (nur 'kernp') heißt es „Export gesperrt"
    // statt „Demo" — es ist ja kein Demo-, sondern ein Vollprodukt ohne Export.
    const exportOnly = list.indexOf('kernp') >= 0 && list.indexOf('kern') < 0;
    const text = msg || (exportOnly
      ? 'Diese Ausgabe (Design) exportiert keine Fertigungsdaten — möglich sind „Projekt speichern" und der Flugzeug-Export (XFLR5/FLZ/PC2).'
      : 'Demo-Version: Der Export dieser Funktion ist in dieser Ausgabe nicht enthalten.');
    const tag = exportOnly ? T('Export gesperrt') : 'Demo';
    return {
      on, msg: text,
      blocked() { if (!on) return false; alert(T(text)); return true; },
      btn(b) { if (on && b) { b.textContent += ' (' + T(tag) + ')'; b.disabled = true; b.title = T(text); } return b; }
    };
  }

  // ---------- Kern-Demo / Design-Export-Sperre ---------------------------
  // Zwei Pseudo-Funktionen aus dem Build-Tool (in window.BUILD_INFO.demo):
  //   'kern'  = „Kern: nur Demo" → KEIN Schreibweg mehr (auch Projekt & G-Code).
  //   'kernp' = Design-Ausgabe „nur Projekt speichern" → jeder Export gesperrt,
  //             aber „Projekt speichern" (.json) bleibt möglich (damit die frei
  //             weitergegebene Design-exe nutzbar ist, ohne Fertigungsdaten
  //             herzugeben). Rechnen/Anzeigen/Simulation bleiben in beiden Fällen.
  const DEMO_KERN = demoFeature('kern',
    'Demo-Version: Speichern, Exportieren und Kopieren sind in dieser Ausgabe gesperrt. '
    + 'Schneiden an der Maschine ist möglich.');
  const DEMO_KERNP = demoFeature('kernp',
    'Design-Ausgabe: Exportieren ist gesperrt — möglich sind „Projekt speichern" und der Flugzeug-Export (XFLR5/FLZ/PC2).');
  // Irgendein Schreib-Schloss aktiv? (beide sperren jeden Export)
  function demoNoSave() { return DEMO_KERN.on || DEMO_KERNP.on; }
  // Darf „Projekt speichern" (.json) trotz Sperre? Nur in der Design-Ausgabe.
  function demoProjectAllowed() { return DEMO_KERNP.on && !DEMO_KERN.on; }
  // In jedem schreibenden Weg ganz vorn aufrufen; `which` = Picker-id (DIR_KEYS).
  //   if (App.demoSaveBlocked(which)) return;
  // Rückgabe true = gesperrt, der Benutzer hat den Hinweis gesehen.
  function demoSaveBlocked(which) {
    // Design-Ausgabe: erlaubt sind das Projekt selbst (.json, 'svProject') und
    // der Flugzeug-Export in die Auslegungsprogramme (XFLR5/FLZ/PC2, 'svWing',
    // wingexport.js — reine Designdaten, keine Fertigungsdaten). Jeder andere
    // Export bleibt gesperrt.
    if ((which === 'svProject' || which === 'svWing') && demoProjectAllowed()) return false;
    if (!(DEMO_KERN.on || DEMO_KERNP.on)) return false;
    const m = T(DEMO_KERN.on ? DEMO_KERN.msg : DEMO_KERNP.msg);
    if (App.toast) App.toast(m); else alert(m);
    return true;
  }

  // Text für Hinweise in anderen Modulen (Design-Ausgabe: eigener Wortlaut).
  const demoKernMsg = DEMO_KERN.on ? DEMO_KERN.msg : DEMO_KERNP.msg;
  Object.assign(App, { demoFeature, demoKernMsg, demoNoSave, demoProjectAllowed, demoSaveBlocked });
  Object.assign(App, { demoFeature, machineLimits, limitAdvice, savePalette, saveViewPalettes, state });
  Object.defineProperty(App, 'LST', { get: () => LST, set: v => { LST = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'PAL', { get: () => PAL, set: v => { PAL = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'profSegOpen', { get: () => profSegOpen, set: v => { profSegOpen = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'segZ', { get: () => segZ, set: v => { segZ = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'wing', { get: () => wing, set: v => { wing = v; }, enumerable: true, configurable: true });
})();
