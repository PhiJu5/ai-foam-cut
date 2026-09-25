/* formenbau.js — Reiter „Formenbau": Urmodell (Positiv) oder Negativform
 * (Formhälften oben/unten) aus dem Tragflächendesign als STL für 3D-Druck und
 * CNC-Fräsen. (Feature „formenbau", optional — andere Module rufen nur geschützt.)
 *
 *   Datenquelle : App.wing.cuts (Rippen je Segment in mm inkl. Schränkung,
 *                 Pfeilung, V-Form; OHNE Beplankungsabzug = Außenkontur).
 *   Glättung    : jede Rippe wird als kubischer B-Spline (= stückweise Bezier)
 *                 per Ausgleichsrechnung (Least Squares + Krümmungsstrafe) an
 *                 die Profilpunkte angepasst und fein neu abgetastet. Endleisten-
 *                 punkte bleiben exakt erhalten.
 *   Loft        : Regelfläche zwischen den Rippen (wie der Heißdraht sie
 *                 schneidet), Zwischenringe im Abstand „Ringabstand".
 *   Randbogen   : flach (ebener Deckel) oder parametrisch nach realen Segel-
 *                 flugzeugen: Nasen- und Endleistenlinie je als Superellipse zum
 *                 Bezugspunkt (Vorlagen Ellipse / Sichel / gerade gepfeilt /
 *                 hochgezogen), Dickenverjüngung, Hochziehen; V-Form läuft weiter.
 *   Winglet     : Flügelende biegt tangential (Kreisbogen, Radius) in ein Winglet
 *                 (Höhe, Neigung, Tiefen, Pfeilung, Schränkung/Toe-out, Twist);
 *                 Profile an Wurzel / optional Mitte / Spitze aus .dat, alle
 *                 Übergänge knickfrei (Smoothstep in Tiefe, Profil, Winkel).
 *   Negativform : Formhälfte = Kasten minus Flügelhälfte; Trennlinie = Nasen-
 *                 punkt (vorderster Punkt der Rippe) und Endleiste, Trennfläche
 *                 waagrecht bis zur Kastenwand (Flansch = Überstand vorn/hinten).
 *                 Aufbau als geschlossene Ringpolygone je Station -> Loft +
 *                 Deckel (Ear-Clipping) -> wasserdichtes Netz.
 *   Ausgabe     : binäres STL, Achsen wahlweise Y hoch (wie im Programm) oder
 *                 Z hoch (Druck/Fräse), Nullpunkt in der Ecke.
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;
  const { grp, hint, subhead, numRow, boolRow, selectRow, mkMini, buildSidebar } = App;
  // Demo-Build (Build-Tool: „nur Demo (ohne Export)“): alles bedienbar, aber kein STL-Export.
  const DEMO_F = App.demoFeature('formenbau',
    'Demo-Version: Der STL-Export des Formenbaus ist in dieser Ausgabe nicht enthalten.');
  const DEMO = DEMO_F.on, DEMO_MSG = DEMO_F.msg;
  function demoBlocked() { return DEMO_F.blocked(); }
  function demoBtn(b) { return DEMO_F.btn(b); }

  // ---------- Konfiguration (state.cfg.form*) ----------------------------
  const DEF = {
    formTarget: 'ur',          // 'ur' Urmodell | 'split' Urmodell geteilt (abformbar) | 'neg' Negativform (oben + unten)
    formPart: 'all',           // Bauteil: 'all' Tragfläche mit Randbogen/Winglet | 'wing' nur Tragfläche (bis letzte Rippe) | 'tip' nur Randbogen / Winglet (eigene Form)
    formSmooth: 'bspline',     // 'bspline' | 'none'
    formCtrl: 18,              // Kontrollpunkte je Profilseite
    formLambda: 1,             // Glättungsgewicht (0 = reine Ausgleichung)
    formPts: 240,              // Punkte je Rippe (Ausgabe)
    formRingMm: 5,             // Ringabstand entlang der Spannweite (mm)
    formLoft: 'linear',        // Loft in Spannweite: 'linear' Regelfläche (wie Heißdraht) | 'spline' kubischer Spline über die Rippen
    formLoftAng: 2,            // Spline-Loft: neuer Zwischenring, sobald sich die Fläche um mehr als diesen Winkel (°) dreht
    formTipMode: 'round',      // 'round' parametrischer Randbogen | 'flat' | 'winglet'
    formTipPreset: 'ellipse',  // zuletzt angewandte Vorlage (ellipse|sichel|raked|hoch|custom)
    formTipLen: 15,            // Randbogen-Länge (mm)
    formTipPLE: 2,             // Superellipsen-Exponent Nasenlinie (1 gerade, 2 Ellipse, groß = lange gerade, dann rund)
    formTipPTE: 2,             // dito Endleiste
    formTipRef: 50,            // Bezugspunkt in % der Sehne (Ziel des Randbogens)
    formTipRise: 0,            // Hochziehen am Ende (mm)
    formTipTwist: 0,           // Schränkung am Ende (°, positiv = Endleiste nach oben / Washout)
    formTipThk: 100,           // Dicke am Ende in % (relative Profildicke wird verjüngt)
    formWlFlatLen: 20,         // Winglet: waagrechter Teil vor dem Übergangsbogen (mm, 0 = keiner)
    formWlFlatWing: true,      // Nasenlinie im waagrechten Teil in Verlängerung der Flügel-Nasenlinie
    formWlFlatSweep: 0,        // sonst: Rückpfeilung der Nasenlinie im waagrechten Teil (°)
    formWlLen: 180,            // Winglet: Länge ab Ende des waagrechten Teils entlang der Mittellinie (inkl. Übergang), mm
    formWlR: 30,               // Übergangsradius Flügel -> Winglet (mm)
    formWlStepAt: 0,           // Rücksprung der Nase: Beginn ab Flügelende (mm)
    formWlStep: 50,            // Rücksprung der Nase: Länge (mm, 0 = bis zum Bogenende verteilt)
    formWlTeWing: true,        // Endleiste in Verlängerung der Flügel-Endleiste (eine gerade Linie)
    formWlTeSweepH: 0,         // sonst: Pfeilung der Endleiste im waagrechten Teil (°)
    formWlTeSweep: 5,          // Pfeilung der Endleiste im senkrechten Teil (°)
    formWlCant: 20,            // Neigung aus der Senkrechten nach außen (°)
    formWlCRoot: 50,           // Wurzeltiefe des Winglets in % der Flügel-Endtiefe
    formWlCTip: 20,            // Spitzentiefe in % der Flügel-Endtiefe
    formWlSweep: 28,           // Pfeilung der Nasenlinie (°)
    formWlToe: 2.5,            // Toe-out (Nase nach außen) an der Winglet-Wurzel (°)
    formWlTwist: -2,           // Schränkung zur Spitze (°, negativ = Auswaschung)
    formWlMidPos: 50,          // Lage des mittleren Profils in % der Winglet-Länge (ab Übergangsende)
    formWlTipLen: 10,          // Rundung der Winglet-Spitze (mm)
    formWlTipMode: 'ellipse',  // Spitzenform: 'ellipse' | 'sichel' | 'custom' (frei parametrisch)
    formWlTipPLE: 2,           // Superellipsen-Exponent Nasenlinie der Spitze
    formWlTipPTE: 2,           // dito Endleiste
    formWlTipRef: 50,          // Bezugspunkt der Spitze in % der Sehne (Zusammenlaufpunkt)
    formWlTipThk: 100,         // Dicke am Ende der Spitze (%)
    formWlTipP: 2,             // (alt) gemeinsamer Exponent — wird nach PLE/PTE migriert
    formWlProf: null,          // { root:{name,pts}|null, mid:..., tip:... } — null = Profil des Flügelendes
    formWlDraw: null,          // Winglet aus Zeichnung: { le:[[dx,dy,dz],…], te:[…] } Versätze der Kontrollpunkte zum Flügelende (null = aus Einstellungen ableiten)
    formWlDrawMode: 'spline',  // 'spline' | 'pline'
    formWlDrawRootAt: 30,      // % der Winglet-Länge, bei dem das Wurzelprofil erreicht ist
    formWlDrawTwRoot: 2.5,     // Schränkung (Anstellwinkel) am Wurzelprofil (°, positiv = Nase nach außen / Toe-out)
    formWlDrawTwMid: 1.5,      // dito Mitte (nur mit Mittelprofil)
    formWlDrawTwTip: 0.5,      // dito Spitze
    formAufmass: 0,            // Aufmaß (mm, nach außen; negativ = Abzug)
    formTeThk: 0,              // globale Endleistendicke (mm, 0 = Profil unverändert); gilt für Tragfläche, Randbogen und Winglet
    formTeEdge: 'out',         // Negativform / geteiltes Urmodell: Endleiste 'out' steht mit halber Dicke über die Trennfläche (Sehnenmitte) | 'blend' läuft in die Trennfläche aus (Keil) | 'flush' bündig je Hälfte auf dem eigenen Endleistenpunkt (wie vor 2026-09-06)
    formMirror: false,         // Urmodell: beide Hälften (gespiegelt an der Wurzel)
    formUp: 'z',               // 'y' wie im Programm | 'z' hoch (Druck/Fräse)
    formOrigin: 'min',         // 'min' Ecke | 'keep' unverändert
    formOvF: 30, formOvR: 30,  // Negativform: Überstand vorn/hinten (= Flanschbreite)
    formOvRoot: 0, formOvTip: 20, // Überstand an Wurzel / hinter dem Randbogen
    formWall: 20,              // Formdicke über dem Profil (Kastenhöhe über höchstem Punkt)
    formWallMode: 'custom',    // Formhöhe: 'custom' = formWall | 'neg' = Ober-/Unterkante wie der Negativblock im Negativdesign (Schalen anklebbar)
    formWallWing: '',          // Negativdesign welcher Tragfläche (Name; '' = diese Tragfläche)
    formWallSeg: -1,           // Segment dieser Tragfläche (-1 = letztes)
    formWallRib: 'tip',        // Bezugsrippe des Segments: 'tip' außen | 'root' Wurzel (andere Tragfläche: Außenrippe -> Formwurzel, Wurzelrippe -> Formaußenende)
    formCavUp: true,           // Formhälften mit Kavität nach oben exportieren
    formPlateT: 15,            // geteiltes Urmodell: Dicke der Trennplatte (mm)
    formSicke: false,          // geteiltes Urmodell: U-förmige Sicke vor Nase -> um Randbogen (-> hinter Endleiste)
    formSickeDist: 6,          // Abstand Sicke zur Kontur (mm)
    formSickeW: 4,             // Breite der Sicke (mm)
    formSickeD: 3,             // Tiefe der Sicke (mm)
    formSickeRun: 'le',        // 'le' Nasenleiste + Randbogen | 'all' zusätzlich hinter der Endleiste zurück
    formSickeTip: 100,         // wie weit die Sicke in den Randbogen laeuft (% der Randbogenlaenge); nie auf die Trennebene hinaus
    formSickeWedge: 0,         // davon als auslaufender Keil (%)
    formBlut: false,           // Blutrinne im Formenrand hinter der Endleiste (Negativform Nut, geteiltes Urmodell Wulst)
    formBlutShape: 'round',    // 'round' Halbkreis | 'u' U-Profil
    formBlutDist: 4,           // Abstand der Rinne zur Endleiste (mm)
    formBlutW: 4,              // Breite (mm)
    formBlutD: 2,              // Tiefe (Negativform) bzw. Hoehe (Urmodell) (mm)
    formBlutTip: 20,           // wie weit die Blutrinne in den Randbogen laeuft (% der Randbogenlaenge); nie auf die Trennebene hinaus
    formBlutWedge: 100,        // davon als auslaufender Keil (%)
    formHk: false,             // Negativform: U-foermiger Huckel auf dem Formenrand vor der Nase
    formHkW: 4,                // Breite (mm)
    formHkH: 3,                // Hoehe ueber der Trennflaeche (mm)
    formHkTip: 100,            // wie weit der Huckel in den Randbogen laeuft (% der Randbogenlaenge); nie auf die Trennebene hinaus
    formHkWedge: 0,            // davon als auslaufender Keil (% der Randbogenlaenge, 0 = stumpfes Ende)
    formEdge: 'box',           // Formenrand: 'box' Rechteck um die ganze Fläche | 'offset' folgt Nase/Endleiste im festen Abstand
    /* Trennfläche (Negativform / geteiltes Urmodell; beim Urmodell nur Vorschau): Verlauf vor der Nase und hinter der
     * Endleiste als Neigung (°, 0 = waagrecht), Verlauf über den Randbogen hinaus 'flat' (in Höhe der letzten Rippe)
     * oder 'tangent' (Nasen- und Endleistenlinie laufen tangential weiter und gehen knickfrei in die Waagrechte über). */
    formPsShow: false,         // Trennfläche in der 3D-Ansicht halbdurchsichtig zeigen
    formPsAngF: 0,             // Neigung vor der Nase (°, positiv = steigt nach vorn)
    formPsAngR: 0,             // Neigung hinter der Endleiste (°, positiv = steigt nach hinten)
    formPsTip: 'flat',         // 'flat' | 'tangent'
    formPsTanLen: 30,          // 'tangent': Abstand hinter der Randbogenspitze, ab dem die Fläche wieder waagrecht ist (mm, 0 = bleibt tangential)
    formPsChord: 'flat',       // Trennfläche am Randbogen in Flugrichtung: 'flat' je Rippe waagrecht (Nasenhöhe) | 'follow' folgt der Nasen-/Endleistenlinie (Linie in Spannweitenrichtung ausgezogen, keine Stufe)
    formHoles: false,          // Passlöcher im Flansch / in der Trennplatte (oben und unten deckungsgleich)
    formHoleD: 6,              // Durchmesser (mm)
    formHoleN: 3,              // Anzahl je Seite (vorn / hinten) über die Spannweite
    formHoleX: 15,             // Abstand Lochmitte vom Formenrand (mm)
    formHoleEnd: 15,           // Randabstand der äußersten Löcher von Wurzel-/Spitzenende (mm)
    formHoleSides: 'both',     // 'both' | 'front' | 'rear'
    formHoleSeg: false,        // bei Segmentierung: Löcher je Druckstück verteilen (Anzahl je Stück wählbar)
    formHolePer: null,         // { '0': n, … } Anzahl je Seite je Druckstück (Index von der Wurzel); fehlt -> formHoleN
    formPin: false,            // Passbohrungen an der Trennebene Tragfläche / Randbogen bzw. Winglet (getrennter Export)
    formPinN: 2,               // Anzahl
    formPinShape: 'circle',    // 'circle' | 'rect'
    formPinD: 4,               // Durchmesser (mm)
    formPinA: 4, formPinB: 3,  // Rechteck: a in Sehnenrichtung, b in Dickenrichtung (mm)
    formPinDepth: 10,          // Tiefe in der Tragfläche (mm)
    formPinDepthTip: 10,       // Tiefe im Randbogen / Winglet (mm)
    formPinPts: null,          // [[x, y], …] Lochmitten bezogen auf die Profilnase der letzten Rippe (mm)
    formPinGap: 30,            // Vorschau: Teile auseinanderziehen (mm)
    formStk: false,            // Steckungs-Ausnehmungen in der Wurzelverlängerung (Tragflächensteckung)
    formStkN: 1,               // (alt) Anzahl — nur noch für Altstände ohne Liste
    formStkShape: 'circle',    // Vorgabe für neue Ausnehmungen: 'circle' | 'rect'
    formStkD: 10,              // Vorgabe Durchmesser (mm)
    formStkA: 12, formStkB: 8, // Vorgabe Rechteck: a in Sehnenrichtung, b in Dickenrichtung (mm)
    formStkLen: 30,            // Vorgabe Länge in der Trennebene ab der Wurzelrippe nach innen (mm)
    formStkPts: null,          // [{ x, y, shape, d, a, b, len }, …] — je Ausnehmung Lage (ab Profilnase der Wurzelrippe), eigener Querschnitt und eigene Länge
    /* Zweite, eigene Liste: Steckung am Anschluss Tragfläche <-> Randbogen / Winglet. Dieselben Werte
     * wirken auf BEIDE Bauteile — im Bauteil „nur Randbogen / Winglet“ an dessen Wurzel (Überstand am
     * Anschluss), im Bauteil „nur Tragfläche“ am äußeren Ende (Überstand hinter der letzten Rippe).
     * Lage bezogen auf die Profilnase der letzten Tragflächenrippe, also in beiden Formen deckungsgleich. */
    formStkT: false,
    formStkTShape: 'circle',
    formStkTD: 8,
    formStkTA: 10, formStkTB: 6,
    formStkTLen: 25,
    formStkTPts: null,
    formTipCut: 'seg',         // Abschlusskante am Spitzen-Überstand (nur Rand 'offset'): 'seg' senkrecht zum letzten Segment (schräg) | 'span' senkrecht zur Spannweite
    formSegOn: false,          // Segmentierung: Formteile für den Druck in Stücke entlang der Spannweite teilen (beim Export)
    formSegMode: 'len',        // 'len' feste Stücklänge | 'seg' Tragflächen-Segmente, je in n Stücke | 'n' gesamt in n Stücke | 'max' gesamt in gleich lange Stücke ≤ max. Länge
    formSegLen: 200,           // Stücklänge (mm) bei 'len'
    formSegPer: 1,             // Stücke je Tragflächen-Segment bei 'seg'
    formSegN: 2,               // Stückzahl bei 'n'
    formSegMax: 200,           // maximale Stücklänge (mm) bei 'max'
    formSegGap: 15,            // Vorschau: Stücke auseinanderziehen (mm)
    formSegPin: false,         // Passstifte an den Trennstellen: Sacklöcher senkrecht zur Schnittebene, beidseitig deckungsgleich
    formSegPinN: 2,            // Anzahl je Trennstelle
    formSegPinD: 4,            // Durchmesser (mm)
    formSegPinDepth: 10,       // Tiefe je Stück (mm; Stiftlänge = 2 × Tiefe)
    formSegPinMargin: 2,       // Mindestwand vom Loch zum Rand der Schnittfläche (mm)
    formSegPinPer: null,       // je Trennstelle (Index von der Wurzel): { '0': { on, n, pts: [[x, y, body], …] } … }; pts = manuelle Lage (Netzkoordinaten je Körper 'ur'|'top'|'bot'|'wing'|'tip'), sonst automatisch
    formStation: 0,            // Profilansicht: Station
    formView: '3d',            // '3d' | 'prof'
    formGap: 30,               // Vorschau: Formhälften auseinanderziehen (mm)
    formCutOn: false,          // Schnittansicht aktiv
    formCutAxis: 'z',          // Schnittebene senkrecht zu: 'z' Spannweite (Rippenschnitt) | 'x' Sehne | 'y' Höhe
    formCutPos: 0,             // Lage der Ebene (mm, Modellkoordinaten)
    formCutSide: '+',          // in 3D entfernte Seite ('+' = größere Koordinate wird entfernt)
    formCutFill: true,         // Schnittfläche in 3D füllen
    formShow: 'both',          // 3D-Ansicht Winglet: 'both' Fläche + Winglet | 'wing' nur Fläche | 'wl' nur Winglet
    formHalf: 'both',          // 3D-Ansicht Negativform / geteiltes Urmodell: 'both' | 'top' nur obere Hälfte | 'bot' nur untere Hälfte
    formWire: false,           // 3D-Ansicht als Drahtgitter
    formColWing: '#c98a3a',    // Farbe Tragfläche (Urmodell) in der 3D-Ansicht
    formColWl: '#3a8ac9',      // Farbe Winglet / Randbogen-Teil
    formColSurf: '#5aa0d8',    // Farbe Formfläche (Kavität / Profilhälfte) bei Negativform / geteiltem Urmodell
    formColRim: '#8a9099',     // Farbe Formenrand / Hinterbau (Flansch, Trennplatte, Rückseite, Stirnseiten)
    formColTipF: '#4fb08a',    // Farbe Randbogen-Bereich der Formfläche (Ringe ab tipStart)
    formCurvOn: false,         // Krümmungsanalyse (Krümmungskamm) in der 3D-Ansicht / im 2D-Schnitt
    formCurvStep: 250,         // Abstand der Analyse-Schnitte über die Spannweite (mm, ab Wurzel); Wert wird erst mit Enter übernommen
    formCurvScale: 10,         // Maßstab: Linienlänge = Krümmung · Sehne² · Maßstab/100
    formCurvMax: 50,           // Kappung der Linienlänge (% der Sehne; Nase wäre sonst riesig)
    formCurvN: 120,            // Linien je Schnitt (Kontur wird entsprechend ausgedünnt)
    formCurvEnv: true,         // Hüllkurve durch die Linienspitzen (rot)
    formCurvDir: 'profile',    // Richtung: 'profile' Kämme auf Schnitten z = konst (Profilkrümmung) | 'span' Kämme entlang Längslinien (Spannweitenkrümmung)
    formCurvLines: 13,         // Spannweite: Anzahl Längslinien um die Kontur (Nase und Endleiste immer dabei)
    formRender: 'fine',        // 3D-Darstellung: 'fine' WebGL glatt + Glanz (volle Auflösung) | 'fast' WebGL flach, Bildschirmauflösung | '2d' alter Canvas-2D-Pfad
    formZebraOn: false,        // Zebra-Analyse (Reflexionsstreifen) in der 3D-Ansicht (nur WebGL)
    formZebraN: 60,            // Anzahl Streifen über den Spiegelwinkel (180° Neigung der Spiegelrichtung)
    formZebraDir: 'h',         // (alt) Streifenrichtung 'v'/'h' – nur noch zur Übernahme in formZebraAng
    formZebraRef: 'part',      // Bezug der Streifenachse: 'part' Bauteil (feste Achse im Modell, Streifen laufen über Randbogen/Winglet durch) | 'view' Ansicht (Kamera, wie klassisches CAD-Zebra)
    formZebraAng: null,        // Winkel der Streifenachse in Grad (0–180). Bauteil: 0 = Sehne, 90 = Spannweite. Ansicht: 0 = senkrecht, 90 = waagrecht. null = aus formZebraDir übernehmen
    formZebraMix: 85           // Stärke (%) der Streifen gegenüber der Schattierung
  };
  // Hex-Farbe -> {h, sat, l} für die Schattierung.
  function hexHsl(hex, def) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return def;
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, sat = 0;
    if (d > 1e-6) {
      sat = d / (1 - Math.abs(2 * l - 1));
      h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60;
    }
    return { h: Math.round(h), sat: Math.round(sat * 100), l: Math.round(l * 100) };
  }
  function C(k) { if (state.cfg[k] == null) state.cfg[k] = DEF[k]; return state.cfg[k]; }
  function S(k, v) { state.cfg[k] = v; }

  // ---------- Rippen absolut aus dem Tragflächendesign -------------------
  /* Stationen (Wurzel + Außenenden aller Segmente) in mm: x = Sehne absolut
   * (Wurzel-Nase = 0 + Pfeilung), y = Dicke (Datum = Sehnenmitte Wurzel),
   * z = Spannweite. Kopfüber-Schneiden (flipY) wird zurückgenommen. */
  function stationsAbs() {
    if (!App.wing && typeof App.recompute === 'function') { try { App.recompute(); } catch (e) {} }
    const w = App.wing; if (!w || !w.cuts || !w.cuts.length) return [];
    const segZ = App.segZ || [];
    const fy = state.cfg.flipY ? -1 : 1;
    const conv = (pts, dx) => pts.map(p => ({ x: p.x + dx, y: p.y * fy }));
    const out = [{ pts: conv(w.cuts[0].root.pts, 0), z: 0, name: T('Wurzel') }];
    let cumLE = 0;
    w.cuts.forEach((c, k) => {
      // Alle Segmente inkl. V-Form (Höhenversatz steckt in den Schnitt-Rippen). Hat ein
      // Folgesegment einen lokalen Wurzelversatz (dihRoot), weicht seine Wurzelrippe vom
      // Außenende des Vorsegments ab -> zusätzliche Station auf gleicher z (Stufe).
      if (k > 0) {
        const prev = out[out.length - 1], rp = conv(c.root.pts, cumLE);
        let diff = 0; for (let i = 0; i < Math.min(rp.length, prev.pts.length); i++) diff = Math.max(diff, Math.abs(rp[i].y - prev.pts[i].y), Math.abs(rp[i].x - prev.pts[i].x));
        if (diff > 1e-6) out.push({ pts: rp, z: prev.z, name: T('Segment ') + (k + 1) + ' ' + T('Wurzel') });
      }
      out.push({ pts: conv(c.tip.pts, cumLE), z: segZ[k] ? segZ[k].z1 : out[out.length - 1].z + c.span,
        name: T('Segment ') + (k + 1) + ' ' + T('außen') });
      cumLE += (c.tip.pl && c.tip.pl.leOffset) || 0;
    });
    return out;
  }

  // ---------- B-Spline-Ausgleichung ---------------------------------------
  function chordParam(P) {
    const u = [0];
    for (let i = 1; i < P.length; i++) u.push(u[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y));
    const L = u[u.length - 1] || 1;
    return u.map(v => v / L);
  }
  // Kubische B-Spline-Basis (geklemmt), NURBS-Book A2.2. t: Knoten (K+4), K Kontrollpunkte.
  function bsBasis(u, t, K) {
    const p = 3, N = new Float64Array(K);
    if (u >= 1) u = 1 - 1e-12; if (u < 0) u = 0;
    let k = p; while (k < K - 1 && u >= t[k + 1]) k++;
    const left = [], right = [], Nn = [1];
    for (let j = 1; j <= p; j++) {
      left[j] = u - t[k + 1 - j]; right[j] = t[k + j] - u;
      let saved = 0;
      for (let r = 0; r < j; r++) { const tmp = Nn[r] / (right[r + 1] + left[j - r]); Nn[r] = saved + right[r + 1] * tmp; saved = left[j - r] * tmp; }
      Nn[j] = saved;
    }
    for (let j = 0; j <= p; j++) N[k - p + j] = Nn[j];
    return N;
  }
  // Knoten: geklemmt, innere Knoten an den Quantilen der Punktparameter (dicht an
  // Nase/Endleiste, wo die Punkte dicht liegen).
  function knotsFor(u, K) {
    const t = [0, 0, 0, 0], ni = K - 4, n = u.length;
    for (let j = 1; j <= ni; j++) {
      const pos = j * (n - 1) / (ni + 1), i0 = Math.floor(pos), f = pos - i0;
      t.push(u[i0] + f * ((u[Math.min(i0 + 1, n - 1)] - u[i0]) || 0));
    }
    t.push(1, 1, 1, 1);
    return t;
  }
  function solveLinear(A, b, n, m) {   // A n×n (Array of Float64Array), b n×m; Gauß mit Pivot
    for (let c = 0; c < n; c++) {
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      if (piv !== c) { const tA = A[c]; A[c] = A[piv]; A[piv] = tA; const tb = b[c]; b[c] = b[piv]; b[piv] = tb; }
      const d = A[c][c] || 1e-12;
      for (let r = c + 1; r < n; r++) {
        const f = A[r][c] / d; if (!f) continue;
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        for (let k = 0; k < m; k++) b[r][k] -= f * b[c][k];
      }
    }
    const x = []; for (let r = 0; r < n; r++) x[r] = new Float64Array(m);
    for (let r = n - 1; r >= 0; r--) {
      for (let k = 0; k < m; k++) {
        let s = b[r][k]; for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c][k];
        x[r][k] = s / (A[r][r] || 1e-12);
      }
    }
    return x;
  }
  /* Ausgleichs-B-Spline durch die Rippe P (offen: TE oben … Nase … TE unten).
   * Rückgabe: Auswertefunktion ev(u) und Kontrollpunkte. Erster/letzter Kontroll-
   * punkt = Endleistenpunkte (fest). lambda: Strafe auf 2. Differenzen der
   * Kontrollpunkte (relativ zur Punktzahl skaliert). */
  function fitBSpline(P, K, lambda) {
    const n = P.length; K = Math.max(6, Math.min(K, n - 1));
    const u = chordParam(P), t = knotsFor(u, K);
    const B = []; for (let i = 0; i < n; i++) B.push(bsBasis(u[i], t, K));
    const A = []; for (let i = 0; i < K; i++) A.push(new Float64Array(K));
    const b = []; for (let i = 0; i < K; i++) b.push(new Float64Array(2));
    for (let i = 0; i < n; i++) {
      const Bi = B[i];
      for (let r = 0; r < K; r++) { const br = Bi[r]; if (!br) continue;
        for (let c = 0; c < K; c++) if (Bi[c]) A[r][c] += br * Bi[c];
        b[r][0] += br * P[i].x; b[r][1] += br * P[i].y; }
    }
    // Krümmungsstrafe: sum (c[i-1] - 2c[i] + c[i+1])^2, skaliert mit Punktdichte
    // und Sehnenlänge (Kontrollpunktabstand ~ L/K).
    const lam = (lambda || 0) * (n / K) * 0.02;
    if (lam > 0) for (let i = 1; i < K - 1; i++) {
      const idx = [i - 1, i, i + 1], w = [1, -2, 1];
      for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) A[idx[a]][idx[c]] += lam * w[a] * w[c];
    }
    // Enden fest: c0 = P0, cK-1 = Pn-1 -> aus dem System herausnehmen.
    const m = K - 2, A2 = [], b2 = [];
    for (let r = 1; r < K - 1; r++) {
      A2.push(A[r].slice(1, K - 1));
      b2.push(new Float64Array([b[r][0] - A[r][0] * P[0].x - A[r][K - 1] * P[n - 1].x,
        b[r][1] - A[r][0] * P[0].y - A[r][K - 1] * P[n - 1].y]));
    }
    const xs = solveLinear(A2, b2, m, 2);
    const ctrl = [{ x: P[0].x, y: P[0].y }];
    for (let i = 0; i < m; i++) ctrl.push({ x: xs[i][0], y: xs[i][1] });
    ctrl.push({ x: P[n - 1].x, y: P[n - 1].y });
    const ev = uu => { const N = bsBasis(uu, t, K); let x = 0, y = 0;
      for (let i = 0; i < K; i++) if (N[i]) { x += N[i] * ctrl[i].x; y += N[i] * ctrl[i].y; } return { x, y }; };
    return { ev, ctrl, u, uLE: u[Math.ceil(n / 2) - 1] };
  }
  // Auswerte-Parameter: Kosinus-Verteilung um die Nase (uLE), Nase bei Index Mu-1.
  function evalParams(M, uLE) {
    const Mu = Math.ceil(M / 2), Ml = M - Mu + 1, out = [];
    for (let i = 0; i < Mu; i++) out.push(uLE * (1 - Math.cos(Math.PI * i / (Mu - 1))) / 2);
    for (let j = 1; j < Ml; j++) out.push(uLE + (1 - uLE) * (1 - Math.cos(Math.PI * j / (Ml - 1))) / 2);
    return out;
  }
  function leIndex(M) { return Math.ceil(M / 2) - 1; }
  // Abstand Punkt -> Polylinie (max über alle Rohpunkte = Abweichung der Glättung).
  function maxDeviation(raw, curve) {
    let worst = 0;
    for (const p of raw) {
      let best = Infinity;
      for (let i = 0; i < curve.length - 1; i++) {
        const a = curve[i], b = curve[i + 1], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-12;
        let s = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2; s = s < 0 ? 0 : s > 1 ? 1 : s;
        const d = Math.hypot(p.x - a.x - s * dx, p.y - a.y - s * dy); if (d < best) best = d;
      }
      if (best > worst) worst = best;
    }
    return worst;
  }
  /* Geglättete/neu abgetastete Rippe: M Punkte, Nase bei leIndex(M). */
  function smoothRib(P, opt) {
    const M = opt.pts;
    if (opt.mode === 'none') {
      const r = Airfoil.resample(P, M).map(p => ({ x: p.x, y: p.y }));
      return { pts: r, dev: 0, ctrl: null };
    }
    const K = 2 * opt.ctrl + 1;
    const f = fitBSpline(P, K, opt.lambda);
    const pts = evalParams(M, f.uLE).map(f.ev);
    return { pts, dev: maxDeviation(P, pts), ctrl: f.ctrl };
  }
  // Aufmaß: Parallelversatz nach außen (Ring CCW: außen = rechts der Laufrichtung).
  function offsetRib(pts, d) {
    if (!d) return pts;
    const n = pts.length, out = [];
    const en = i => { const a = pts[i], b = pts[i + 1]; const L = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.y - a.y) / L, y: -(b.x - a.x) / L }; };
    for (let i = 0; i < n; i++) {
      let nx, ny;
      if (i === 0) { const e = en(0); nx = e.x; ny = e.y; }
      else if (i === n - 1) { const e = en(n - 2); nx = e.x; ny = e.y; }
      else { const e0 = en(i - 1), e1 = en(i); nx = e0.x + e1.x; ny = e0.y + e1.y; const L = Math.hypot(nx, ny) || 1; const dot = (1 + e0.x * e1.x + e0.y * e1.y) / 2; const sc = 1 / Math.max(Math.sqrt(Math.max(dot, 0.05)), 0.25); nx = nx / L * sc; ny = ny / L * sc; }
      out.push({ x: pts[i].x + d * nx, y: pts[i].y + d * ny });
    }
    return out;
  }

  /* Globale Endleistendicke: die Endleiste des Rings (Punkt 0 = oben, letzter Punkt = unten) wird auf
   * den Abstand gap (mm) gesetzt, symmetrisch zur Sehne. Die Korrektur wächst quadratisch mit der Lage
   * auf der Sehne (Nase 0 -> Endleiste 1), das vordere Profil bleibt praktisch unverändert. Für 2D- und
   * 3D-Ringe (x/y[/z]); die Richtung „oben" folgt aus dem Ring selbst (Ober- gegen Unterseite bei
   * halber Sehne). Bei dünnen Ringen (Randbogen-/Wingletende) höchstens die halbe Profildicke, kollabierte
   * Ringe bleiben unverändert. Wird NACH Skalierung/Aufmaß angewandt (absolutes Maß). */
  function teThickRing(pts, gap) {
    if (!(gap > 0) || !pts || pts.length < 8) return pts;
    const M = pts.length, iLE = leIndex(M), d3 = pts[0].z != null;
    const v = (a, b) => d3 ? [a.x - b.x, a.y - b.y, a.z - b.z] : [a.x - b.x, a.y - b.y, 0];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const nose = pts[iLE], p0 = pts[0], pM = pts[M - 1];
    const teMid = { x: (p0.x + pM.x) / 2, y: (p0.y + pM.y) / 2, z: d3 ? (p0.z + pM.z) / 2 : 0 };
    const e = v(teMid, nose), c = Math.hypot(e[0], e[1], e[2]);
    if (c < 1e-6) return pts;
    e[0] /= c; e[1] /= c; e[2] /= c;
    const k = Math.max(1, Math.round(iLE / 2)), w0 = v(pts[k], pts[M - 1 - k]), we = dot(w0, e);
    const n = [w0[0] - we * e[0], w0[1] - we * e[1], w0[2] - we * e[2]], nl = Math.hypot(n[0], n[1], n[2]);
    if (nl < 1e-9) return pts;
    n[0] /= nl; n[1] /= nl; n[2] /= nl;
    let tmax = 0; for (let i = 0; i < iLE; i++) { const t = dot(v(pts[i], pts[M - 1 - i]), n); if (t > tmax) tmax = t; }
    const g = Math.min(gap, tmax * 0.5), g0 = dot(v(p0, pM), n), d = (g - g0) / 2;
    if (Math.abs(d) < 1e-9) return pts;
    return pts.map((p, i) => {
      let sN = dot(v(p, nose), e) / c; sN = sN < 0 ? 0 : sN > 1 ? 1 : sN;
      const f = (i <= iLE ? 1 : -1) * d * sN * sN;
      const q = { x: p.x + f * n[0], y: p.y + f * n[1] }; if (d3) q.z = p.z + f * n[2];
      return q;
    });
  }
  // Endleistendicke auf einen fertigen Ring (Fläche 2D, Randbogen 2D, Winglet 3D mit lokalem 2D-Ring loc).
  function teThickApply(r, gap) {
    if (!(gap > 0)) return r;
    const o = Object.assign({}, r, { pts: teThickRing(r.pts, gap) });
    if (r.loc) o.loc = teThickRing(r.loc, gap);
    return o;
  }

  // ---------- Ringe (Loft-Stationen) --------------------------------------
  function lerpRing(A, B, t) { return A.map((p, i) => ({ x: p.x + (B[i].x - p.x) * t, y: p.y + (B[i].y - p.y) * t })); }
  function yAtX(pts, i0, i1, x) {   // y der Kontur zwischen Index i0..i1 an Stelle x (lineare Suche)
    const st = i0 < i1 ? 1 : -1;
    for (let i = i0; i !== i1; i += st) {
      const a = pts[i], b = pts[i + st];
      if ((a.x - x) * (b.x - x) <= 0 && a.x !== b.x) return a.y + (x - a.x) / (b.x - a.x) * (b.y - a.y);
    }
    return (pts[i0].y + pts[i1].y) / 2;
  }
  /* Spline-Loft: die Kette jedes Ringpunkts i über die Stationen (x, y als Funktion von z) wird als
   * kubischer Hermite-Spline (Bessel-Tangenten, Parameter = z) statt linear interpoliert -> keine Knicke
   * an den Rippenstationen bei Schränkung, V-Form und Tiefenverlauf. Stationen auf gleicher z (Stufe)
   * trennen den Spline in Läufe, die Stufe selbst bleibt (beide Ringe). Zwischenringe adaptiv: neuer Ring,
   * sobald sich die Fläche an einem der Prüfpunkte (Nase, Endleiste, Viertel) um mehr als opt.loftAng
   * gedreht hat oder der Ringabstand erreicht ist. Die Stationen selbst sind immer Ringe (ohne letzte). */
  function splineLoftRings(stations, opt) {
    const out = [], step = Math.max(opt.ringMm, 0.5), ANG = Math.max(0.1, opt.loftAng || 2) * Math.PI / 180;
    const runs = [[stations[0]]];
    for (let k = 1; k < stations.length; k++) {
      if (stations[k].z - stations[k - 1].z <= 1e-9) runs.push([stations[k]]); else runs[runs.length - 1].push(stations[k]);
    }
    const M = stations[0].sm.length, chk = [0, leIndex(M), M - 1, Math.round(M * 0.25), Math.round(M * 0.75)];
    runs.forEach((run, ri) => {
      const K = run.length, lastRun = ri === runs.length - 1;
      if (K === 1) { if (!lastRun) out.push({ pts: run[0].sm, z: run[0].z }); return; }
      const Z = run.map(s => s.z), h = [];
      for (let k = 0; k < K - 1; k++) h.push(Z[k + 1] - Z[k]);
      // Tangenten je Punkt i und Station k (dx/dz, dy/dz): Bessel (gewichtete Sekanten), Enden einseitig
      const tan = run.map((s, k) => s.sm.map((p, i) => {
        const P = kk => run[kk].sm[i];
        if (K === 2 || k === 0) { const q = P(1); return { x: (q.x - P(0).x) / h[0], y: (q.y - P(0).y) / h[0] }; }
        if (k === K - 1) { const q = P(K - 2); return { x: (p.x - q.x) / h[K - 2], y: (p.y - q.y) / h[K - 2] }; }
        const a = P(k - 1), b = P(k + 1), h0 = h[k - 1], h1 = h[k];
        return { x: ((p.x - a.x) / h0 * h1 + (b.x - p.x) / h1 * h0) / (h0 + h1), y: ((p.y - a.y) / h0 * h1 + (b.y - p.y) / h1 * h0) / (h0 + h1) };
      }));
      const ringAt = (k, t) => {   // Hermite auf Segment k, t in [0,1]
        const A = run[k].sm, B = run[k + 1].sm, mA = tan[k], mB = tan[k + 1], hk = h[k];
        const t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        return { pts: A.map((p, i) => ({ x: h00 * p.x + h10 * hk * mA[i].x + h01 * B[i].x + h11 * hk * mB[i].x,
                                        y: h00 * p.y + h10 * hk * mA[i].y + h01 * B[i].y + h11 * hk * mB[i].y })), z: Z[k] + hk * t };
      };
      // Richtung der Prüfpunkt-Ketten zwischen zwei Ringen (3D)
      const dirs = (r0, r1) => chk.map(i => [r1.pts[i].x - r0.pts[i].x, r1.pts[i].y - r0.pts[i].y, r1.z - r0.z]);
      const maxTurn = (D, E) => {
        let m = 0;
        for (let c = 0; c < D.length; c++) {
          const d = D[c], e = E[c], L = Math.hypot(d[0], d[1], d[2]), Le = Math.hypot(e[0], e[1], e[2]);
          if (L < 1e-12 || Le < 1e-12) continue;
          m = Math.max(m, Math.acos(Math.min(1, Math.max(-1, (d[0] * e[0] + d[1] * e[1] + d[2] * e[2]) / (L * Le)))));
        }
        return m;
      };
      for (let k = 0; k < K - 1; k++) {
        const n = Math.max(8, Math.ceil(h[k] / step) * 8);
        let last = ringAt(k, 0), prev = last, ref = null;
        out.push(last);
        for (let j = 1; j < n; j++) {
          const r = ringAt(k, j / n), d = dirs(prev, r);
          if (!ref) ref = d;
          if (maxTurn(ref, d) > ANG || r.z - last.z >= step - 1e-9) { out.push(r); last = r; ref = null; }
          prev = r;
        }
      }
      if (!lastRun) out.push({ pts: run[K - 1].sm, z: Z[K - 1] });
    });
    return out;
  }
  /* Alle Ringe des Flügels (geglättet, mit Aufmaß, Zwischenringe, Randbogen).
   * Rückgabe { rings:[{pts,z}], stations:[{raw, sm, dev, z, name}], tipStart }. */
  function wingRings(opt) {
    const st = stationsAbs(); if (st.length < 2) return null;
    const stations = st.map(s => { const r = smoothRib(s.pts, opt); return { raw: s.pts, sm: teThickRing(offsetRib(r.pts, opt.aufmass), opt.teThk), dev: r.dev, ctrl: r.ctrl, z: s.z, name: s.name }; });
    let rings = [];
    if (opt.loft === 'spline') rings = splineLoftRings(stations, opt);
    else for (let k = 0; k < stations.length - 1; k++) {
      const a = stations[k], b = stations[k + 1], span = b.z - a.z;
      const n = Math.max(1, Math.round(span / Math.max(opt.ringMm, 0.5)));
      for (let j = 0; j < n; j++) { const t = j / n; rings.push({ pts: t ? lerpRing(a.sm, b.sm, t) : a.sm, z: a.z + span * t }); }
    }
    const last = stations[stations.length - 1], prev = stations[stations.length - 2];
    rings.push({ pts: last.sm, z: last.z });
    const tipStart = rings.length - 1;
    let wl = null;
    if (opt.tipMode === 'round' && opt.tipLen > 0) for (const r of tipRings(last, prev, opt)) rings.push(r);
    else if (opt.tipMode === 'winglet') wl = wingletRings(last, prev, opt);
    else if (opt.tipMode === 'wldraw') wl = wingletDrawRings(last, prev, opt);
    // globale Endleistendicke: Randbogen-/Winglet-Ringe sind skalierte Profile -> absolutes Maß erst hier
    if (opt.teThk > 0) { rings = rings.map(r => teThickApply(r, opt.teThk)); if (wl) wl = wl.map(r => teThickApply(r, opt.teThk)); }
    return { rings, stations, tipStart, wl };
  }

  /* Ringe (Rippen) senkrecht zur Nasenleiste in der Vorderansicht: jeder Ring wird als exakter Schnitt der
   * Regelfläche (Loft der senkrechten Ringe) mit der Ebene durch seinen Nasenpunkt gelegt, deren Normale in
   * der y/z-Ebene der Nasenleiste folgt (z = z0 − (y − yNase)·tanφ). φ je Segment = Steigung der Nasenleiste
   * (V-Form); an Segmentgrenzen die Winkelhalbierende, an der Wurzel (Symmetrie-/Rumpfebene) senkrecht;
   * Randbogenringe folgen dem letzten Segment. Der Ring behält sein z (Nase), die Punkte tragen eine eigene
   * z-Koordinate. Winglet-Ringe (wl) stehen bereits senkrecht auf ihrer Mittellinie und bleiben. */
  function tiltRings(W) {
    if (!W || W.tilted) return W;
    const R = W.rings, st = W.stations, N = R.length;
    if (N < 2 || !st || st.length < 2) return W;
    const iLE = leIndex(R[0].pts.length), yLEof = q => q.sm[leIndex(q.sm.length)].y;
    const seg = [];
    for (let k = 0; k + 1 < st.length; k++) {
      const dz = st[k + 1].z - st[k].z; if (dz <= 1e-9) continue;   // Stufe (gleiche z): keine Steigung
      seg.push({ z0: st[k].z, z1: st[k + 1].z, t: (yLEof(st[k + 1]) - yLEof(st[k])) / dz });
    }
    if (!seg.length) return W;
    const tanAt = z => {
      const eps = 1e-6; let a = null, b = null;
      for (const s of seg) { if (z > s.z0 + eps && z < s.z1 - eps) return s.t; if (Math.abs(z - s.z1) <= eps) a = s; if (Math.abs(z - s.z0) <= eps) b = s; }
      if (a && b) return Math.tan((Math.atan(a.t) + Math.atan(b.t)) / 2);
      if (b && !a) return 0;
      return seg[seg.length - 1].t;
    };
    const out = R.map((r, j) => {
      const t = tanAt(r.z);
      if (Math.abs(t) < 1e-9) return r;
      const z0 = r.z, yLE = r.pts[iLE].y;
      const g = (k, i) => R[k].z - z0 + (R[k].pts[i].y - yLE) * t;   // Abstand von der Schnittebene (>0: außen)
      const pts = r.pts.map((p, i) => {
        // Kette der Ringpunkte i (Regelfläche): Nulldurchgang von g suchen, an den Enden extrapolieren
        let k = Math.min(j, N - 2);
        if (g(k, i) > 0) { while (k > 0 && g(k, i) > 0) k--; }
        else { while (k < N - 2 && g(k + 1, i) < 0) k++; }
        const g0 = g(k, i), g1 = g(k + 1, i), d = g1 - g0, s = Math.abs(d) < 1e-12 ? 0 : -g0 / d;
        const a = R[k].pts[i], b = R[k + 1].pts[i];
        return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, z: R[k].z + (R[k + 1].z - R[k].z) * s };
      });
      return Object.assign({}, r, { pts });
    });
    return Object.assign({}, W, { rings: out, tilted: true });
  }

  // ---------- Randbogen (parametrisch, nach realen Segelflugzeugen) ------
  /* Grundriss aus zwei Superellipsen-Kurven: Nasenlinie von xLE0 und Endleiste
   * von xTE0 laufen beide zum Bezugspunkt xEnd (in % der Sehne). Schrumpf-
   * faktor s(t) = (1 - t^p)^(1/p): p = 1 gerade, 2 Viertelellipse, groß =
   * lange gerade weiter, dann schnell einlaufend. Für p > 1 ist die Tangente
   * bei t = 0 die Fortsetzung der Fläche (knickfrei). Das Profil wird mit der
   * lokalen Tiefe skaliert (relative Dicke bleibt), optional zusätzlich in der
   * Dicke verjüngt (Smoothstep) und hochgezogen (t², tangential).
   *   ellipse : klassischer elliptischer Randbogen (Holz-/GFK-Ära, LS4, ASW 19)
   *   sichel  : Sichelrandbogen (Discus, ASW 27/28, Ventus): Endleiste läuft
   *             fast gerade weiter, Nase pfeilt stark zurück, Spitze bei ~90 %
   *   raked   : gerade nach hinten gezogene Nase (leichte Pfeilung), Spitze an
   *             der Endleiste (Außenflügel-Ohren, F3B-Stil)
   *   hoch    : hochgezogener Randbogen mit Dickenverjüngung (DG-/LS-Stil)
   * len = Länge in Anteilen der Endtiefe (Vorlagenvorschlag). */
  const TIP_PRESETS = {
    ellipse: { pLE: 2,   pTE: 2, ref: 40,  rise: 0,    thk: 100, len: 0.35, twist: 0 },
    sichel:  { pLE: 2.2, pTE: 1, ref: 100, rise: 0,    thk: 100, len: 0.8, twist: 0 },   // Endleiste gerade weiter, Nase läuft in scharfer Ecke ein
    raked:   { pLE: 1.3, pTE: 3, ref: 100, rise: 0,    thk: 100, len: 0.6, twist: 0 },
    hoch:    { pLE: 2,   pTE: 4, ref: 80,  rise: 0.12, thk: 75,  len: 0.55, twist: 0 }
  };
  const smoothstep = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  const supEll = (t, p) => Math.pow(Math.max(0, 1 - Math.pow(t, p)), 1 / p);
  function ribExtent(R) {
    let xLE = Infinity, xTE = -Infinity; for (const p of R) { if (p.x < xLE) xLE = p.x; if (p.x > xTE) xTE = p.x; }
    return { xLE, xTE, c: xTE - xLE };
  }
  // V-Form-Steigung dy/dz und Nasen-Pfeilung dx/dz des letzten Segments (werden weitergeführt).
  // Steigung dy/dz des Nasenpunkts zwischen zwei Stationen (Vorderansicht) als Winkel
  function leSlopeY(last, prev) {
    const dz = (last.z - prev.z) || 1, iL = leIndex(last.sm.length), iP = leIndex(prev.sm.length);
    return Math.atan((last.sm[iL].y - prev.sm[iP].y) / dz);
  }
  function endSlopes(last, prev) {
    const mid = pts => pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const dz = (last.z - prev.z) || 1, L = last.sm, P = prev.sm;
    return { dy: (mid(L) - mid(P)) / dz, dx: (ribExtent(L).xLE - ribExtent(P).xLE) / dz, dxTE: (ribExtent(L).xTE - ribExtent(P).xTE) / dz };
  }
  // Rippe um ihre Nase in der Profilebene drehen; positiv = Endleiste nach oben (Washout).
  function twistRib(R, deg) {
    const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), P = R[leIndex(R.length)], xp = P.x, yp = P.y;
    return R.map(q => { const ux = q.x - xp, uy = q.y - yp; return Object.assign({}, q, { x: xp + ux * ca - uy * sa, y: yp + ux * sa + uy * ca }); });
  }
  function tipRings(last, prev, opt) {
    const R = last.sm, M = R.length, iLE = leIndex(M), e = ribExtent(R);
    const xEnd = e.xLE + e.c * Math.min(100, Math.max(0, opt.tipRef)) / 100;
    const yref = (yAtX(R, 0, iLE, xEnd) + yAtX(R, iLE, M - 1, xEnd)) / 2;
    const sl = endSlopes(last, prev);
    const pLE = Math.max(0.5, opt.tipPLE), pTE = Math.max(0.5, opt.tipPTE), thkEnd = Math.max(0.05, opt.tipThk / 100);
    const out = [];
    // Grundriss: Nase und Endleiste setzen je die EIGENE Linie des letzten Segments fort
    // (tangential, Steigung dx bzw. dxTE) und weichen davon per Superellipse monoton zum
    // gemeinsamen Endpunkt xEndT zurück -> die Nase geht nie vor ihre Verlängerung, die
    // Endleiste nie dahinter. xEndT = Bezugspunkt, mit der Endleistensteigung weitergeführt
    // (bei 100 % bleibt die Endleiste eine Gerade), mindestens aber das Ende der Nasenlinie.
    const L = opt.tipLen, xEndT = Math.max(xEnd + sl.dxTE * L, e.xLE + sl.dx * L);
    const xLEat = t => e.xLE + sl.dx * L * t + (xEndT - e.xLE - sl.dx * L) * (1 - supEll(t, pLE));
    const xTEat = t => e.xTE + sl.dxTE * L * t + (xEndT - e.xTE - sl.dxTE * L) * (1 - supEll(t, pTE));
    // Schränkung: nur der Randbogen. Jeder Ring ist die skalierte Endrippe, um ihre Nase um a(t) = Winkel·Smoothstep
    // gedreht (0 an der Endrippe, voll an der Spitze). Damit die Endleiste nach außen STETIG ansteigt (und nicht mit
    // der schwindenden Tiefe wieder auf die Nasenhöhe zurückfällt), wird jeder Ring zusätzlich so angehoben, dass seine
    // Endleiste auf H·Smoothstep liegt; H = Endleistenhöhe der ganzen, um die Nase gedrehten Endrippe. Die Spitze
    // (fiktive Endrippe, Tiefe 0) liegt dann in der Verlängerung dieser Endleiste, die Nasenlinie zieht zu ihr hoch.
    const twist = (opt.tipTwist || 0) * Math.PI / 180;
    let iTE = 0; for (let i = 1; i < M; i++) if (R[i].x > R[iTE].x) iTE = i;
    const H = twist ? twistRib(R, opt.tipTwist)[iTE].y - R[iTE].y : 0;
    const ringAt = t => {
      const dz = opt.tipLen * t, dy = sl.dy * dz + opt.tipRise * t * t, f = smoothstep(t);
      const xLE = xLEat(t), xTE = xTEat(t);
      const c = Math.max(0, xTE - xLE), sc = e.c ? c / e.c : 0, thk = 1 - (1 - thkEnd) * f;
      const a = twist * f, ca = Math.cos(a), sa = Math.sin(a), xp = xLE, yp = yref + (R[iLE].y - yref) * sc * thk;
      const rot = R.map(q => {
        const x = xLE + (q.x - e.xLE) * sc, y = yref + (q.y - yref) * sc * thk;
        const ux = x - xp, uy = y - yp;
        return { x: xp + ux * ca - uy * sa, y: yp + ux * sa + uy * ca };
      });
      const lift = twist ? (yref + (R[iTE].y - yref) * sc * thk + H * f) - rot[iTE].y : 0;   // Endleiste auf die Soll-Höhe
      return { pts: rot.map(q => ({ x: q.x, y: q.y + lift + dy })), z: last.z + dz };
    };
    // Ringe adaptiv nach der Krümmung von Nasen- UND Endleistenlinie (Grundriss x/z): neuer Ring,
    // sobald sich eine der beiden Richtungen um > 2° gedreht hat oder der Ringabstand erreicht ist.
    // Superellipsen werden zum Ende hin steil -> dort dichte Ringe, sonst Facetten an der Sichel.
    const step = Math.max(opt.ringMm, 0.5), dt = Math.min(0.25, step / 8) / opt.tipLen, ANG = 2 * Math.PI / 180;
    const pt = t => { const dz = opt.tipLen * t; return [[xLEat(t), dz], [xTEat(t), dz]]; };
    const dir2 = (a, b) => { const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(d[0], d[1]) || 1; return [d[0] / l, d[1] / l]; };
    const turn = (u, v) => Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
    let pq = pt(0), refL = null, refT = null, tLast = 0;
    for (let t = dt; t < 1 - 1e-9; t += dt) {
      const q = pt(t), dL = dir2(pq[0], q[0]), dT = dir2(pq[1], q[1]); pq = q;
      if (!refL) { refL = dL; refT = dT; }
      if (turn(dL, refL) > ANG || turn(dT, refT) > ANG || (t - tLast) * opt.tipLen >= step - 1e-9) { out.push(ringAt(t)); tLast = t; refL = dL; refT = dT; }
    }
    out.push(ringAt(1));
    return out;
  }

  // ---------- Winglet ------------------------------------------------------
  /* Mittellinie: ab dem Flügelende (Richtung = V-Form des letzten Segments)
   * ein Kreisbogen mit Radius R um eine Achse parallel zur Sehne, bis zur
   * Winglet-Richtung (90° − Neigung), danach gerade bis zur Länge L. Jeder Ring
   * liegt in der Ebene senkrecht zur Mittellinie (lokales Bezugssystem
   * ex = Sehne, n = Profilhöhe, dreht mit). Tiefe, Profil (Flügelende ->
   * Wurzelprofil), Nasenpfeilung und Anstellwinkel (Toe) gehen im Bogen per
   * Smoothstep über — knickfreie Fläche, nur der Bogen selbst ist gekrümmt.
   * Danach linear: Tiefe -> Spitzentiefe, Profil Wurzel -> (Mitte) -> Spitze,
   * Winkel Toe -> Toe + Twist; Spitze als Superellipse auf einen Punkt.
   * Vorbild: Maughmer/PSU-Winglets (Discus-2, ASW 27/28, LS8): Neigung 15–25°,
   * Toe-out 2–3°, Pfeilung ~30°, Wurzeltiefe ~50–60 %, Spitzentiefe ~25 %
   * der Flügel-Endtiefe, Profil PSU 94-097, Twist −2°. Rings tragen 3D-Punkte
   * (p.z) und ein lokales 2D-Polygon (loc) für den Deckel. */
  // Winglet-Spitze: wie der Randbogen als zwei Superellipsen (Nase/Endleiste) zum Bezugspunkt;
  // Rückgabe des Formzustands bei t (0..1) und Abbildung eines Einheitsprofilpunkts in lokale u/v.
  const WL_TIP_PRESETS = { ellipse: { pLE: 2, pTE: 2, ref: 50, thk: 100 }, sichel: { pLE: 2.2, pTE: 1, ref: 100, thk: 100 } };
  function wlTipShape(w, t) {
    const P = WL_TIP_PRESETS[w.tipMode] || { pLE: w.tipPLE, pTE: w.tipPTE, ref: w.tipRef, thk: w.tipThk };
    const ref = Math.min(1, Math.max(0, (+P.ref || 0) / 100)), thkEnd = Math.max(0.05, (+P.thk || 100) / 100);
    const sLE = supEll(t, Math.max(0.5, +P.pLE || 2)), sTE = supEll(t, Math.max(0.5, +P.pTE || 2));
    return { uLE: ref * (1 - sLE), uTE: ref + (1 - ref) * sTE, thk: 1 - (1 - thkEnd) * smoothstep(t) };
  }
  const wlTipUV = (q, shp) => shp ? { u: shp.uLE + q.x * (shp.uTE - shp.uLE), v: q.y * (shp.uTE - shp.uLE) * shp.thk } : { u: q.x, v: q.y };
  function unitProfile(P, opt) {
    const pts = smoothRib(P, opt).pts, e = ribExtent(pts), iLE = leIndex(pts.length), yLE = pts[iLE].y;
    return pts.map(q => ({ x: (q.x - e.xLE) / (e.c || 1), y: (q.y - yLE) / (e.c || 1) }));
  }
  function wingletRings(last, prev, opt) {
    const R = last.sm, M = R.length, iLE = leIndex(M), e = ribExtent(R), c0 = e.c || 1, yLE0 = R[iLE].y;
    const w = opt.wl, prof = opt.wlProf || {};
    const Pw = R.map(q => ({ x: (q.x - e.xLE) / c0, y: (q.y - yLE0) / c0 }));
    const Pr = prof.root ? unitProfile(prof.root.pts, opt) : Pw;
    const Pt = prof.tip ? unitProfile(prof.tip.pts, opt) : Pr;
    const Pm = prof.mid ? unitProfile(prof.mid.pts, opt) : null;
    const sl = endSlopes(last, prev);
    const th0 = leSlopeY(last, prev), th1 = (90 - w.cant) * Math.PI / 180, beta = Math.max(0.05, th1 - th0);   // Nasenleisten-Steigung (wie die geneigte Endrippe)
    let hUp = 0; for (const q of Pw) hUp = Math.max(hUp, q.y * c0);
    // Waagrechter Teil (Länge Lf): Richtung des letzten Segments läuft weiter, die Endleiste bleibt
    // auf der verlängerten Endleistenlinie der Tragfläche; die Nasenpfeilung geht per Smoothstep von
    // der Flügelpfeilung in die eigene Rückpfeilung über -> Tiefe = Endleiste − Nase (Fuß wird schmäler).
    const Lf = Math.max(0, w.flatLen), tanW = sl.dx, tanF = Lf > 0 && !w.flatWing ? Math.tan(w.flatSweep * Math.PI / 180) : tanW;
    const zF = last.z + Lf * Math.cos(th0), yF = yLE0 + Lf * Math.sin(th0);
    const xF = e.xLE + tanW * Lf + (tanF - tanW) * Lf * 0.5;
    // Übergänge im Winglet als „smootherstep" 6t⁵−15t⁴+10t³ (auch die 2. Ableitung ist an den Enden 0:
    // die Krümmung der Nasen-/Endleistenlinie baut sich stetig auf -> rund, keine Ecken) und ∫ davon.
    const sm2 = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (6 * t - 15) + 10);
    const ismooth = t => t <= 0 ? 0 : t >= 1 ? t - 0.5 : t * t * t * t * (t * (t - 3) + 2.5);   // ∫ sm2
    const Ltot = Math.max(5, w.len);
    let Rb = Math.max(w.R, 1.5 * hUp, 1);                    // sonst schneidet die Oberseite die Biegeachse
    if (Rb * beta > 0.8 * Ltot) Rb = 0.8 * Ltot / beta;
    const Lb = Rb * beta, Ls = Ltot - Lb, Tt = Lf + Lb + Ls;   // t = Strecke ab Flügelende (waagrecht, Bogen, gerade)
    const cR = c0 * w.cRoot / 100, cT = c0 * w.cTip / 100, toe = w.toe * Math.PI / 180, tw = w.twist * Math.PI / 180;
    const mp = Math.min(0.95, Math.max(0.05, w.midPos / 100));
    const zb = zF + Rb * (Math.sin(th1) - Math.sin(th0)), yb = yF - Rb * (Math.cos(th1) - Math.cos(th0));
    // Endleiste: gerade im waagrechten Teil (Verlängerung der Flügel-Endleiste oder eigene
    // Pfeilung) und gerade im senkrechten Teil (eigene Pfeilung); im Bogen geht die Steigung per
    // Smoothstep über -> Endleistenlinie ohne Knick.
    const tanH = w.teWing ? sl.dxTE : Math.tan(w.teSweepH * Math.PI / 180), tanV = Math.tan(w.teSweep * Math.PI / 180);
    const xTEat = t => e.xTE + tanH * t + (tanV - tanH) * (t <= Lf ? 0 : t <= Lf + Lb ? Lb * ismooth((t - Lf) / Lb) : Lb * 0.5 + (t - Lf - Lb));
    // Nasenlinie ohne Rücksprung (Flügelpfeilung -> Rückpfeilung des waagrechten Teils) und
    // zugehörige Tiefe; ab Beginn t0 geht die Tiefe per Smoothstep über die Länge Lr in den
    // Zielverlauf über (Wurzeltiefe, dann Verjüngung auf die Spitzentiefe; die Verjüngung setzt
    // mit Steigung 0 ein und wird dann linear -> C1). Die Nase folgt aus Endleiste − Tiefe und
    // ist damit überall stetig differenzierbar (keine Knicke/Huckel).
    const xLEline = t => t <= Lf ? e.xLE + tanW * t + (tanF - tanW) * Lf * ismooth(t / Lf) : xF + tanF * (t - Lf);
    const cLine = t => Math.max(0.15 * c0, xTEat(t) - xLEline(t));
    const t0 = Math.min(Math.max(0, w.stepAt), Lf + Lb);
    const Lr = Math.max(1, w.step > 0 ? Math.min(w.step, Tt - t0) : Lf + Lb - t0), tEnd = Math.min(Tt, t0 + Lr);
    // Zielverlauf = eine Gerade (Wurzeltiefe am Ende des Rücksprungs -> Spitzentiefe), auch vor tEnd
    // fortgesetzt: der Smoothstep des Rücksprungs läuft damit direkt in die Verjüngung ein (C1, keine
    // Plateau-/S-Form an der Nase).
    const cTarget = t => Tt <= tEnd ? cR : cR + (cT - cR) * (t - tEnd) / (Tt - tEnd);
    const cAt = t => {
      if (t < t0) return cLine(t);
      if (t < tEnd) { const cl = cLine(t); return cl + (cTarget(t) - cl) * sm2((t - t0) / Lr); }
      return cTarget(t);
    };
    // s = Bogenlänge ab Ende des waagrechten Teils (negativ = im waagrechten Teil).
    const ringAt = (s, shrink) => {
      let th, y, z, P, a;
      const t = Lf + s, c = cAt(t), xLE = xTEat(t) - c;
      if (s < 0) {
        th = th0; z = last.z + t * Math.cos(th0); y = yLE0 + t * Math.sin(th0);
        P = Pw; a = 0;
      } else if (s <= Lb) {
        th = th0 + s / Rb; z = zF + Rb * (Math.sin(th) - Math.sin(th0)); y = yF - Rb * (Math.cos(th) - Math.cos(th0));
        const u = sm2(s / Lb);
        P = lerpRing(Pw, Pr, u); a = toe * u;
      } else {
        th = th1; z = zb + (s - Lb) * Math.cos(th1); y = yb + (s - Lb) * Math.sin(th1);
        const v = Ls > 0 ? Math.min(1, (s - Lb) / Ls) : 1;
        a = toe + tw * v;
        P = Pm ? (v < mp ? lerpRing(Pr, Pm, v / mp) : lerpRing(Pm, Pt, (v - mp) / (1 - mp))) : lerpRing(Pr, Pt, v);
      }
      const ca = Math.cos(a), sa = Math.sin(a), ct = Math.cos(th), st = Math.sin(th);
      const loc = P.map(q => { const { u, v } = wlTipUV(q, shrink); return { x: c * (u * ca - v * sa), y: c * (u * sa + v * ca) }; });
      // fr: Ringsystem (Nase, Sehnenrichtung ex, Dickenrichtung en – um den Anstellwinkel a gedreht) für den Formenbau
      const fr = { O: [xLE, y, z], ex: [ca, sa * ct, -sa * st], en: [-sa, ca * ct, -ca * st] };
      return { pts: loc.map(q => ({ x: xLE + q.x, y: y + q.y * ct, z: z - q.y * st })), z, loc, fr };
    };
    const step = Math.max(opt.ringMm, 0.5), out = [];
    const tipLen = Math.min(Math.max(0, w.tipLen), Ls * 0.6), Lst = Ls - tipLen, tMax = Lf + Lb + Lst;
    // Ringe adaptiv nach der Krümmung der Nasenlinie setzen: Nasenpunkt (x aus Endleiste − Tiefe,
    // y/z auf der Mittellinie) in feinen Schritten verfolgen; neuer Ring, sobald sich die Richtung
    // seit dem letzten Ring um > 2° gedreht hat oder der Ringabstand erreicht ist. Rücksprung und
    // Übergangsbogen werden so fein aufgelöst -> runde, stetig verlaufende Nase statt Facetten.
    const lePt = t => {
      const s = t - Lf; let y, z;
      if (s < 0) { z = last.z + t * Math.cos(th0); y = yLE0 + t * Math.sin(th0); }
      else if (s <= Lb) { const th = th0 + s / Rb; z = zF + Rb * (Math.sin(th) - Math.sin(th0)); y = yF - Rb * (Math.cos(th) - Math.cos(th0)); }
      else { z = zb + (s - Lb) * Math.cos(th1); y = yb + (s - Lb) * Math.sin(th1); }
      return [xTEat(t) - cAt(t), y, z];
    };
    const dt = Math.min(0.25, step / 8), ANG = 2 * Math.PI / 180;
    let tLast = 0, pLast = lePt(0), dirRef = null, pPrev = pLast;
    for (let t = dt; t < tMax - 1e-9; t += dt) {
      const p = lePt(t), d = V3.norm(V3.sub(p, pPrev)); pPrev = p;
      if (!dirRef) dirRef = d;
      const ang = Math.acos(Math.max(-1, Math.min(1, V3.dot(d, dirRef))));
      if (ang > ANG || t - tLast >= step - 1e-9) { out.push(ringAt(t - Lf)); tLast = t; pLast = p; dirRef = d; }
    }
    out.push(ringAt(tMax - Lf));
    if (tipLen > 0) {
      const nt = Math.max(4, Math.round(tipLen / step) * 2);
      for (let j = 1; j <= nt; j++) { const t = j / nt; out.push(ringAt(Lb + Lst + tipLen * t, wlTipShape(w, t))); }
    }
    return out;
  }

  // ---------- Winglet aus Zeichnung (Dreitafel: Aufriss / Draufsicht / Seitenansicht) ----
  /* Der Nutzer zeichnet Nasenlinie und Endleiste des Winglets als 3D-Kurven
   * (Spline oder Polylinie) über ihre Projektionen in drei Ansichten — wie in
   * einer Dreitafel-Zeichnung: Aufriss (Z→, Y↑: Biegung/Neigung), Draufsicht
   * (Z→, X↓: Grundriss, Pfeilung, Toe) und Seitenansicht (X→, Y↑: Umriss des
   * stehenden Winglets). Jede Kurve ist EINE Raumkurve; Ziehen eines Griffs
   * ändert nur die beiden Koordinaten der jeweiligen Ansicht — dadurch sind die
   * Ansichten immer widerspruchsfrei. Punkt 0 sitzt fest am Flügelende (Nase
   * bzw. Endleiste der letzten Rippe), die Kurve verlässt es in Richtung der
   * Nasen-/Endleistenlinie des letzten Segments (tangentialer Anschluss): beim
   * Spline über die feste Starttangente, bei der Polylinie liegt Punkt 1 auf
   * dem Tangentenstrahl. Kontrollpunkte werden als Versatz zum Flügelende ge-
   * speichert (das Winglet wandert mit, wenn sich der Flügel ändert).
   * Ringe: an gleichem normiertem Bogenparameter u beider Kurven Sehne Nase→
   * Endleiste (ex), Ringnormale n = t × ex mit t = Tangente der Mittellinie;
   * so ergeben sich Neigung, Pfeilung, Toe und Twist allein aus der Zeichnung.
   * Profil: Flügelprofil -> Wurzelprofil (Smoothstep bis formWlDrawRootAt) ->
   * (Mitte) -> Spitze; Spitze optional als Superellipse auf einen Punkt. */
  const V3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: a => Math.hypot(a[0], a[1], a[2]), norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  };
  // Nase / Endleiste einer Station als 3D-Punkte.
  function tipPoints(R, z) {
    const M = R.length, iLE = leIndex(M);
    return { le: [R[iLE].x, R[iLE].y, z], te: [(R[0].x + R[M - 1].x) / 2, (R[0].y + R[M - 1].y) / 2, z] };
  }
  // Profil in Einheitskoordinaten bezogen auf die Sehne Nase (0,0) -> Endleiste (1,0).
  function chordUnit(pts) {
    const M = pts.length, iLE = leIndex(M), le = pts[iLE], tex = (pts[0].x + pts[M - 1].x) / 2, tey = (pts[0].y + pts[M - 1].y) / 2;
    const cx = tex - le.x, cy = tey - le.y, c = Math.hypot(cx, cy) || 1, ex = cx / c, ey = cy / c;
    return pts.map(q => { const dx = q.x - le.x, dy = q.y - le.y; return { x: (dx * ex + dy * ey) / c, y: (-dx * ey + dy * ex) / c }; });
  }
  /* Kurve durch Kontrollpunkte P (absolut, 3D). 'spline': kubische Hermite-
   * Segmente mit Einheitstangenten (Mittel der Nachbarrichtungen, skaliert mit
   * der Segmentlänge — kein Überschwingen bei ungleichen Abständen), Start-
   * tangente d0 fest. 'pline': gerade Strecken. Rückgabe dicht abgetastet mit
   * Bogenlängen; at(u) für u in [0,1], knotU = Parameter der Kontrollpunkte. */
  function railCurve(P, d0, mode, tans) {
    const n = P.length, pts = [], knotIdx = [];
    if (n < 2) return null;
    const segL = [], dir = [];
    for (let i = 0; i < n - 1; i++) { const d = V3.sub(P[i + 1], P[i]); segL.push(V3.len(d) || 1e-6); dir.push(V3.norm(d)); }
    const tan = [V3.norm(d0)];
    for (let i = 1; i < n - 1; i++) tan.push(V3.norm(V3.add(dir[i - 1], dir[i])));
    tan.push(dir[n - 2]);
    // Explizite Tangenten (Fusion-artige Griffe): Vektor mit Länge; Punkt 0 nur entlang d0.
    const T = P.map((p, i) => { let v = tans && tans[i]; if (!v) return null; if (i === 0) v = V3.mul(tan[0], Math.max(1, V3.dot(v, tan[0]))); return v; });
    const eff = P.map((p, i) => { if (T[i]) return T[i]; const L = i === 0 ? segL[0] : i === n - 1 ? segL[n - 2] : (segL[i - 1] + segL[i]) / 2; return V3.mul(tan[i], L); });
    for (let i = 0; i < n - 1; i++) {
      const m = mode === 'pline' ? 1 : Math.max(8, Math.ceil(segL[i] / 1.5)), L = segL[i];
      const m0 = T[i] || V3.mul(tan[i], L), m1 = T[i + 1] || V3.mul(tan[i + 1], L);
      knotIdx.push(pts.length);
      for (let j = 0; j < m; j++) {
        const t = j / m;
        if (mode === 'pline') { pts.push(P[i]); continue; }
        const t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        pts.push([0, 1, 2].map(k => h00 * P[i][k] + h10 * m0[k] + h01 * P[i + 1][k] + h11 * m1[k]));
      }
    }
    knotIdx.push(pts.length); pts.push(P[n - 1]);
    const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + V3.len(V3.sub(pts[i], pts[i - 1])));
    const L = s[s.length - 1] || 1;
    const at = u => {
      const target = Math.min(1, Math.max(0, u)) * L; let lo = 0, hi = s.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid] <= target) lo = mid; else hi = mid; }
      const ds = s[hi] - s[lo] || 1; return V3.lerp(pts[lo], pts[hi], (target - s[lo]) / ds);
    };
    return { pts, s, L, at, knotU: knotIdx.map(i => s[i] / L), ctrl: P, tan: eff, explicit: T.map(v => !!v) };
  }
  // Tangentenfeld einer Kurve auf Länge der Kontrollpunkte bringen (null = automatisch).
  function tArr(D, key, n) { const a = (D && D[key + 'T']) || []; const out = []; for (let i = 0; i < n; i++) out.push(a[i] ? a[i].slice() : null); return out; }
  // Kontrollpunkte absolut aus Versätzen; Polylinie: Punkt 1 auf den Tangentenstrahl legen.
  function railAbs(p0, offs, d0, mode) {
    const P = [p0].concat((offs || []).map(o => V3.add(p0, o)));
    if (mode === 'pline' && P.length > 1) P[1] = V3.add(p0, V3.mul(d0, Math.max(1, V3.dot(V3.sub(P[1], p0), d0))));
    return P;
  }
  function wlDrawData() {
    const D = C('formWlDraw');
    return D && D.le && D.te && D.le.length && D.te.length ? D : null;
  }
  // Nasen-/Endleistenkurve des Winglets (beide Rails) aus der Zeichnung; ohne Zeichnung Vorgabe aus den Winglet-Einstellungen.
  function wlRails(last, prev, opt) {
    const A = tipPoints(last.sm, last.z), B = tipPoints(prev.sm, prev.z);
    const dLE = V3.norm(V3.sub(A.le, B.le)), dTE = V3.norm(V3.sub(A.te, B.te));
    let D = wlDrawData();
    if (!D) D = wlDrawFromParam(last, prev, opt);
    const mode = opt.wlDrawMode || 'spline';
    const le = railCurve(railAbs(A.le, D.le, dLE, mode), dLE, mode, tArr(D, 'le', D.le.length + 1));
    const te = railCurve(railAbs(A.te, D.te, dTE, mode), dTE, mode, tArr(D, 'te', D.te.length + 1));
    return { A, B, dLE, dTE, le, te, mode, D };
  }
  // Vorgabe / Übernahme: Nasen- und Endleistenpunkte des parametrischen Winglets an einigen Ringen.
  function wlDrawFromParam(last, prev, opt) {
    const o = Object.assign({}, opt, { wl: Object.assign({}, opt.wl, { tipLen: 0 }) });
    const rings = wingletRings(last, prev, o), A = tipPoints(last.sm, last.z);
    const M = last.sm.length, iLE = leIndex(M);
    const fr = [0.05, 0.1, 0.16, 0.24, 0.34, 0.5, 0.68, 0.85, 1];
    const le = [], te = [];
    for (const f of fr) {
      const r = rings[Math.min(rings.length - 1, Math.round(f * (rings.length - 1)))], p = r.pts;
      le.push(V3.sub([p[iLE].x, p[iLE].y, p[iLE].z], A.le));
      te.push(V3.sub([(p[0].x + p[M - 1].x) / 2, (p[0].y + p[M - 1].y) / 2, (p[0].z + p[M - 1].z) / 2], A.te));
    }
    return { le, te };
  }
  function wingletDrawRings(last, prev, opt) {
    const R = last.sm, M = R.length, prof = opt.wlProf || {};
    const rl = wlRails(last, prev, opt); if (!rl.le || !rl.te) return [];
    const Pw = chordUnit(R);
    const Pr = prof.root ? chordUnit(smoothRib(prof.root.pts, opt).pts) : Pw;
    const Pt = prof.tip ? chordUnit(smoothRib(prof.tip.pts, opt).pts) : Pr;
    const Pm = prof.mid ? chordUnit(smoothRib(prof.mid.pts, opt).pts) : null;
    const ur = Math.min(0.95, Math.max(0.02, (opt.wlDrawRootAt || 30) / 100)), mp = Math.min(0.95, Math.max(0.05, opt.wl.midPos / 100));
    const Lm = (rl.le.L + rl.te.L) / 2, step = Math.max(opt.ringMm, 0.5);
    const mid = u => V3.mul(V3.add(rl.le.at(u), rl.te.at(u)), 0.5);
    // Schränkung: feste Winkel je Profil (unabhängig von der Zeichnung). Bezugsrichtung = Sehne der
    // Flügel-Endrippe ex0; Ringebene = (ex0, n0) mit n0 = t × ex0 (t = Tangente der Mittellinie), die Sehne
    // wird darin um den Winkel a gedreht (positiv = Nase nach außen / Toe-out, wie beim parametrischen Winglet).
    // Die Endleistenkurve der Zeichnung liefert nur noch die Tiefe (|TE − LE|), die Nase sitzt auf der Nasenlinie.
    const ex0 = V3.norm(V3.sub(rl.A.te, rl.A.le)), tw = opt.wlDrawTw || { root: 0, mid: 0, tip: 0 };
    const twistAt = u => {
      if (u <= ur) return tw.root * smoothstep(u / ur);
      const v = (u - ur) / (1 - ur);
      return Pm ? (v < mp ? tw.root + (tw.mid - tw.root) * v / mp : tw.mid + (tw.tip - tw.mid) * (v - mp) / (1 - mp)) : tw.root + (tw.tip - tw.root) * v;
    };
    const ringAt = (u, shrink) => {
      const le = rl.le.at(u), te = rl.te.at(u), c = V3.len(V3.sub(te, le)) || 1e-6;
      const du = 0.005, t = V3.norm(V3.sub(mid(Math.min(1, u + du)), mid(Math.max(0, u - du))));
      let n0 = V3.cross(t, ex0); if (V3.len(n0) < 1e-9) n0 = [0, 1, 0]; n0 = V3.norm(n0);
      const a = twistAt(u) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      const ex = V3.add(V3.mul(ex0, ca), V3.mul(n0, sa)), n = V3.add(V3.mul(ex0, -sa), V3.mul(n0, ca));
      let P;
      if (u <= ur) P = lerpRing(Pw, Pr, smoothstep(u / ur));
      else { const v = (u - ur) / (1 - ur); P = Pm ? (v < mp ? lerpRing(Pr, Pm, v / mp) : lerpRing(Pm, Pt, (v - mp) / (1 - mp))) : lerpRing(Pr, Pt, v); }
      const m = mid(u);
      const loc = P.map(q => { const r = wlTipUV(q, shrink); return { x: c * r.u, y: c * r.v }; });
      return { pts: loc.map(q => ({ x: le[0] + q.x * ex[0] + q.y * n[0], y: le[1] + q.x * ex[1] + q.y * n[1], z: le[2] + q.x * ex[2] + q.y * n[2] })), z: m[2], loc, u, fr: { O: le, ex, en: n } };
    };
    const tipLen = Math.min(Math.max(0, opt.wl.tipLen), Lm * 0.6), uT = 1 - tipLen / Lm;
    const out = [], nS = Math.max(6, Math.round(Lm * uT / step));
    for (let j = 1; j <= nS; j++) out.push(ringAt(uT * j / nS));
    if (tipLen > 0) {
      const nt = Math.max(4, Math.round(tipLen / step) * 2);
      for (let j = 1; j <= nt; j++) { const t = j / nt; out.push(ringAt(uT + (1 - uT) * t, wlTipShape(opt.wl, t))); }
    }
    return out;
  }

  // ---------- Netz-Aufbau ---------------------------------------------------
  // t: je Dreieck ein Tag (0 = Formfläche, 1 = Formenrand / Hinterbau) für die getrennte Einfärbung.
  function Mesh() { this.v = []; this.t = []; }
  Mesh.prototype.tri = function (a, b, c, tag) {
    // entartete Dreiecke (Fläche ~0) überspringen: entstehen an kollabierten Ringen
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-18) return;
    this.v.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); this.t.push(tag | 0);
  };
  // Loft geschlossener Ringe (gleiche Punktzahl, CCW in x/y, z aufsteigend) -> Außennormalen.
  // Ringpunkte dürfen eine eigene z-Koordinate tragen (Winglet), sonst gilt ring.z.
  const v3 = (ring, i) => { const p = ring.pts[i]; return [p.x, p.y, p.z == null ? ring.z : p.z]; };
  // tagFn(i, r): Tag des Vierecks Streifen i / Ringband r (siehe Mesh).
  function loft(mesh, rings, skip, tagFn) {
    for (let r = 0; r < rings.length - 1; r++) {
      const A = rings[r], B = rings[r + 1], n = A.pts.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (skip && skip.has(i * 1000000 + r)) continue;
        const tg = tagFn ? tagFn(i, r) : 0;
        const a0 = v3(A, i), a1 = v3(A, j);
        const b0 = v3(B, i), b1 = v3(B, j);
        mesh.tri(a0, a1, b1, tg); mesh.tri(a0, b1, b0, tg);
      }
    }
  }
  // Ear-Clipping (einfaches Polygon, CCW). Rückgabe: Index-Tripel (CCW).
  function earClip(poly, noChain) {
    // doppelte/aufeinanderfolgende gleiche Punkte entfernen (Index-Mapping behalten)
    const idx = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[idx.length ? idx[idx.length - 1] : i];
      if (idx.length && Math.hypot(p.x - q.x, p.y - q.y) < 1e-7) continue;
      idx.push(i);
    }
    while (idx.length > 2) { const a = poly[idx[0]], b = poly[idx[idx.length - 1]]; if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-7) idx.pop(); else break; }
    const tris = [];
    if (idx.length < 3) return tris;
    let area = 0; for (let i = 0; i < idx.length; i++) { const a = poly[idx[i]], b = poly[idx[(i + 1) % idx.length]]; area += a.x * b.y - b.x * a.y; }
    if (area < 0) idx.reverse();
    const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    // Maßstab für Toleranzen (Polygon-Ausdehnung).
    let ex = 0; for (const i of idx) { const p = poly[i]; ex = Math.max(ex, Math.abs(p.x), Math.abs(p.y)); }
    const eps = Math.max(1e-14, (ex * ex) * 1e-13);
    // Kollineare Ecken (z. B. Kontur auf der Trennlinie kollabiert) vorab
    // entfernen und als Kette zwischen ihren behaltenen Nachbarn merken. Nach
    // der Triangulation wird das Dreieck an dieser Kante in einen Fächer über
    // die Kettenpunkte aufgeteilt -> keine T-Stöße, keine Nullflächen.
    const chains = new Map();   // "a|b" -> [Indizes zwischen a und b, in Laufrichtung]
    if (!noChain) {
      let changed = true;
      while (changed && idx.length > 3) {
        changed = false;
        for (let i = 0; i < idx.length; i++) {
          const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
          if (Math.abs(cross(poly[ia], poly[ib], poly[ic])) > eps) continue;
          // ib liegt auf der Strecke ia->ic (oder Spitze): Ketten zusammenführen
          const k1 = ia + '|' + ib, k2 = ib + '|' + ic;
          const chain = (chains.get(k1) || []).concat([ib], chains.get(k2) || []);
          chains.delete(k1); chains.delete(k2); chains.set(ia + '|' + ic, chain);
          idx.splice(i, 1); changed = true; break;
        }
      }
    }
    const emit = (i0, i1, i2) => {
      // Kanten (i0,i1),(i1,i2),(i2,i0) auf Ketten prüfen und ggf. fächern.
      const edges = [[i0, i1, i2], [i1, i2, i0], [i2, i0, i1]];
      for (const e of edges) {
        const ch = chains.get(e[0] + '|' + e[1]);
        if (ch && ch.length) {
          const pts = [e[0]].concat(ch, [e[1]]);
          for (let q = 0; q < pts.length - 1; q++) emit(pts[q], pts[q + 1], e[2]);
          return;
        }
      }
      tris.push([i0, i1, i2]);
    };
    if (idx.length < 3) return tris;
    // Punkt STRENG innerhalb des Dreiecks (Randberührung blockiert kein Ohr).
    const inTri = (p, a, b, c) => cross(a, b, p) > eps && cross(b, c, p) > eps && cross(c, a, p) > eps;
    let guard = 0;
    while (idx.length > 3 && guard++ < 100000) {
      let found = false;
      for (let i = 0; i < idx.length; i++) {
        const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
        const a = poly[i0], b = poly[i1], c = poly[i2];
        if (cross(a, b, c) <= eps) continue;   // reflexe/kollineare Ecke: kein Ohr
        let ok = true;
        for (let k = 0; k < idx.length; k++) {
          const m = idx[k]; if (m === i0 || m === i1 || m === i2) continue;
          if (inTri(poly[m], a, b, c)) { ok = false; break; }
        }
        if (!ok) continue;
        emit(i0, i1, i2); idx.splice(i, 1); found = true; break;
      }
      if (!found) {
        // Numerisch entartet (nur kollineare Ecken übrig): die flachste Ecke als
        // (dünnes) Dreieck ausgeben und entfernen — so bleibt die Kantenfolge
        // geschlossen (kein Loch); Fläche ~0 fällt später in mesh.tri heraus.
        let bi = 0, bv = Infinity;
        for (let i = 0; i < idx.length; i++) { const v = Math.abs(cross(poly[idx[(i + idx.length - 1) % idx.length]], poly[idx[i]], poly[idx[(i + 1) % idx.length]])); if (v < bv) { bv = v; bi = i; } }
        emit(idx[(bi + idx.length - 1) % idx.length], idx[bi], idx[(bi + 1) % idx.length]);
        idx.splice(bi, 1);
      }
    }
    if (idx.length === 3) emit(idx[0], idx[1], idx[2]);
    return tris;
  }
  function cap(mesh, ring, outwardPlusZ, tag) {
    // Winglet-Ring: Triangulation im lokalen 2D-System (loc, CCW -> Normale in Winglet-Richtung).
    const tris = earClip(ring.loc || ring.pts);
    for (const t of tris) {
      const a = v3(ring, t[0]), b = v3(ring, t[1]), c = v3(ring, t[2]);
      if (outwardPlusZ) mesh.tri(a, b, c, tag); else mesh.tri(a, c, b, tag);
    }
  }

  /* Passbohrungen an der Trennebene Tragfläche / Randbogen bzw. Winglet (getrennter Export):
   * Sacklöcher senkrecht zur Trennebene (Achse z) in der ebenen Abschlussfläche des Rings, an
   * beiden Teilen deckungsgleich (Passstifte / Zapfen). Lochmitten (x, y) bezogen auf die
   * Profilnase der letzten Rippe: x entlang der Sehne nach hinten, y nach oben. Der Deckel wird
   * als Polygon mit Löchern (Brückenschnitte -> ein einfaches Polygon) per Ear-Clipping
   * trianguliert, dazu je Loch Wand und Grund. Löcher, die nicht mit 0,5 mm Rand in der Kontur
   * liegen oder sich überlappen, werden ausgelassen. */
  function pinPolys(ring, pin) {
    const R = ring.pts, iLE = leIndex(R.length), x0 = R[iLE].x, y0 = R[iLE].y, out = [];
    for (let k = 0; k < pin.n; k++) {
      const P = pin.pts[k] || [0, 0], cx = x0 + (+P[0] || 0), cy = y0 + (+P[1] || 0), pts = [], ky = pin.ky || 1;
      if (pin.shape === 'rect') { const a = pin.a / 2, b = pin.b / 2 * ky; pts.push({ x: cx - a, y: cy - b }, { x: cx + a, y: cy - b }, { x: cx + a, y: cy + b }, { x: cx - a, y: cy + b }); }
      else { const r = pin.d / 2, N = Math.max(16, Math.round(Math.PI * 2 * r / 1.0)); for (let q = 0; q < N; q++) { const th = 2 * Math.PI * q / N; pts.push({ x: cx + r * Math.cos(th), y: cy + r * ky * Math.sin(th) }); } }
      out.push({ cx, cy, pts });
    }
    return out;
  }
  const nrm3 = (a, b, c) => { const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]; };
  function pointInPoly(p, P) { let inside = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside; } return inside; }
  function edgeDist(p, P) {
    let d = Infinity;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      const t = L2 > 1e-12 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
      d = Math.min(d, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    }
    return d;
  }
  // Außenpolygon (CCW) mit Löchern (CCW) über Brückenschnitte zu einem einfachen Polygon verbinden
  // (Eberly: Loch mit größtem x zuerst; Strahl +x vom rechtesten Lochpunkt, sichtbare Außenecke).
  function mergeHoles(outer, holes) {
    let poly = outer.slice();
    const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const hs = holes.map(h => { let im = 0; for (let i = 1; i < h.length; i++) if (h[i].x > h[im].x) im = i; return { pts: h, im }; }).sort((a, b) => b.pts[b.im].x - a.pts[a.im].x);
    for (const h of hs) {
      const M = h.pts[h.im];
      let best = null;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if (a.y === b.y || (a.y - M.y) * (b.y - M.y) > 0) continue;
        const x = a.x + (M.y - a.y) / (b.y - a.y) * (b.x - a.x); if (x < M.x) continue;
        if (!best || x < best.x) best = { x, i, a, b };
      }
      if (!best) continue;
      let ip = best.a.x > best.b.x ? best.i : (best.i + 1) % poly.length;
      const I = { x: best.x, y: M.y }, P = poly[ip];
      const inTri = q => { const s1 = cross(M, I, q), s2 = cross(I, P, q), s3 = cross(P, M, q); return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0); };
      let bestAng = Infinity;
      for (let i = 0; i < poly.length; i++) {
        if (i === ip) continue;
        const q = poly[i], pr = poly[(i + poly.length - 1) % poly.length], nx = poly[(i + 1) % poly.length];
        if (cross(pr, q, nx) >= 0 || !inTri(q)) continue;
        const ang = Math.atan2(Math.abs(q.y - M.y), q.x - M.x); if (ang < bestAng) { bestAng = ang; ip = i; }
      }
      const rot = h.pts.slice(h.im).concat(h.pts.slice(0, h.im)).reverse();   // endet mit M
      const cw = [M].concat(rot.slice(0, -1));                                  // CW, beginnt mit M
      poly = poly.slice(0, ip + 1).concat(cw, [M], [poly[ip]], poly.slice(ip + 1));
    }
    return poly;
  }
  function capPins(mesh, ring, outwardPlusZ, pin, tag) {
    const res = { placed: 0, skipped: 0, edges: [] }, zc = ring.z, margin = 0.5;
    let outer = ring.pts;
    let area = 0; for (let i = 0; i < outer.length; i++) { const a = outer[i], b = outer[(i + 1) % outer.length]; area += a.x * b.y - b.x * a.y; }
    if (area < 0) outer = outer.slice().reverse();
    // Trennfläche als Ebene z = z0 + a·(y − y0) (Normale in der y/z-Ebene; a = 0: senkrecht zur Spannweite).
    // Punkte mit eigener z-Koordinate (geneigte Endrippe) liefern die Steigung a.
    let a = 0, z0 = zc, y0 = outer[0].y;
    { const P = outer.filter(p => p.z != null); if (P.length) { z0 = P[0].z; y0 = P[0].y; let best = 0; for (const q of P) { const dy = q.y - y0; if (Math.abs(dy) > Math.abs(best)) { best = dy; a = (q.z - z0) / dy; } } } }
    const zAt = p => z0 + a * (p.y - y0), L = Math.hypot(a, 1);
    const nOut = outwardPlusZ ? [0, -a / L, 1 / L] : [0, a / L, -1 / L];   // Außennormale der Trennfläche = Bohrachse
    const bbox = P => { const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }; for (const p of P) { b.x0 = Math.min(b.x0, p.x); b.y0 = Math.min(b.y0, p.y); b.x1 = Math.max(b.x1, p.x); b.y1 = Math.max(b.y1, p.y); } return b; };
    const holes = [];
    for (const h of pinPolys(ring, Object.assign({}, pin, { ky: 1 / L }))) {
      const bb = bbox(h.pts);
      const fits = h.pts.every(p => pointInPoly(p, outer) && edgeDist(p, outer) >= margin);
      const overlap = holes.some(o => bb.x0 - margin < o.bb.x1 && o.bb.x0 - margin < bb.x1 && bb.y0 - margin < o.bb.y1 && o.bb.y0 - margin < bb.y1);
      if (!fits || overlap) { res.skipped++; continue; }
      holes.push({ pts: h.pts, bb, cx: h.cx, cy: h.cy }); res.placed++;
    }
    if (!holes.length) { cap(mesh, ring, outwardPlusZ, tag); return res; }
    const poly = mergeHoles(outer, holes.map(h => h.pts)), tris = earClip(poly, true);
    const top = p => [p.x, p.y, p.z != null ? p.z : zAt(p)];   // Rippenpunkte exakt wie im Loft (keine Rundungslücke)
    // Lochgrund: Deckelpunkt entlang der Bohrachse um die Tiefe ins Teil verschoben (Wand = gerader Zylinder)
    const dB = [0, -nOut[1] * pin.depth, -nOut[2] * pin.depth];
    const bot = p => { const t = top(p); return [t[0], t[1] + dB[1], t[2] + dB[2]]; };
    const emit = (P, T, f) => { for (const t of T) { const a = f(P[t[0]]), b = f(P[t[1]]), c = f(P[t[2]]); if (outwardPlusZ) mesh.tri(a, b, c, tag); else mesh.tri(a, c, b, tag); } };
    emit(poly, tris, top);
    for (const h of holes) {
      const H = h.pts, N = H.length;
      const P3 = H.map(top), B3 = H.map(bot);
      res.edges.push({ pts: P3.map(q => ({ x: q[0], y: q[1], z: q[2] })), zc, pts2: B3.map(q => ({ x: q[0], y: q[1], z: q[2] })), zb: zc + dB[2], dir: outwardPlusZ ? 1 : -1, n: nOut });
      emit(H, earClip(H), bot);   // Lochgrund: Normale wie der Deckel (zur Trennebene hin)
      const cx = h.cx, cy = h.cy + dB[1] / 2;
      for (let q = 0; q < N; q++) {   // Wand: Normale zur Lochachse hin
        const T0 = P3[q], T1 = P3[(q + 1) % N], B0 = B3[q], B1 = B3[(q + 1) % N];
        const nn = nrm3(T0, T1, B1), mx = (T0[0] + B1[0]) / 2, my = (T0[1] + B1[1]) / 2;
        const inward = nn[0] * (cx - mx) + nn[1] * (cy - my) > 0;
        if (inward) { mesh.tri(T0, T1, B1, tag); mesh.tri(T0, B1, B0, tag); } else { mesh.tri(T0, B1, T1, tag); mesh.tri(T0, B0, B1, tag); }
      }
    }
    return res;
  }

  // Urmodell: Flügel (+ Spiegelung) als geschlossenes Netz.
  function buildUrmodell(W, opt) {
    W = tiltRings(W);   // Rippen senkrecht zur Nasenleiste (Vorderansicht)
    // Flügel und Winglet als getrennte Teilnetze (Vorschau: eigene Farbe), zusammen ein Körper.
    const flip = r => ({ pts: r.pts.map(p => p.z == null ? p : { x: p.x, y: p.y, z: -p.z }), z: -r.z, loc: r.loc });
    const wr = W.rings, wlr = W.wl ? [wr[wr.length - 1]].concat(W.wl) : null;
    const wing = new Mesh(), wl = new Mesh();
    // Spiegelung an z=0 kehrt die Ringfolge um; CCW-Orientierung in x/y bleibt.
    // Randbogen-Ringe (ab tipStart) als Tag 2 -> eigene Farbe in der Vorschau
    const tb = tipBands(W, 0, opt.mirror ? 2 * wr.length - 1 : wr.length, !!opt.mirror);
    loft(wing, opt.mirror ? wr.slice(1).reverse().map(flip).concat(wr) : wr, null, tb ? (i, r) => tb(r) ? 2 : 0 : null);
    if (!opt.mirror) cap(wing, wr[0], false);
    if (wlr) {
      loft(wl, wlr); cap(wl, wlr[wlr.length - 1], true);
      if (opt.mirror) { const mr = wlr.slice().reverse().map(flip); loft(wl, mr); cap(wl, mr[0], false); }
    } else {
      cap(wing, wr[wr.length - 1], true);
      if (opt.mirror) cap(wing, flip(wr[wr.length - 1]), false);
    }
    const m = new Mesh(); m.v = wing.v.concat(wl.v); m.t = wing.t.concat(wl.t);
    if (wl.v.length) { m.wing = wing; m.wl = wl; }
    return m;
  }
  // Urmodell in zwei getrennte, jeweils geschlossene Körper zerlegt: Tragfläche (bis zur
  // letzten Rippe, dort eben verschlossen) und Randbogen bzw. Winglet (an der letzten Rippe
  // eben verschlossen). Beide Teile passen an der Trennebene exakt aneinander. Bei „flach“
  // gibt es kein Abschlussteil (null).
  function buildUrParts(W, opt) {
    W = tiltRings(W);   // Rippen senkrecht zur Nasenleiste; Endrippe = Trennebene, Winglet-Ringe passen dazu
    const flip = r => ({ pts: r.pts.map(p => p.z == null ? p : { x: p.x, y: p.y, z: -p.z }), z: -r.z, loc: r.loc });
    const wr = W.rings, base = wr.slice(0, W.tipStart + 1);
    let tipR = null;
    if (W.wl) tipR = [wr[wr.length - 1]].concat(W.wl);
    else if (wr.length > W.tipStart + 1) tipR = wr.slice(W.tipStart);
    // Trennebene = geneigte Endrippe (senkrecht zur Nasenleiste des letzten Segments in der Vorderansicht,
    // senkrecht zur Spannweite in der Draufsicht); Randbogen / Winglet setzen dort an. Steckungsbohrungen
    // stehen senkrecht auf dieser Ebene (= parallel zur Nasenleiste).
    const pin = opt.pin && opt.pin.on && tipR ? opt.pin : null;
    let pins = null;
    const capP = (mesh, ring, out, depth) => { if (!pin) return cap(mesh, ring, out); const r = capPins(mesh, ring, out, Object.assign({}, pin, { depth })); if (!pins) pins = r; (mesh.pinEdges = mesh.pinEdges || []).push(...r.edges); };
    const wing = new Mesh();
    loft(wing, opt.mirror ? base.slice(1).reverse().map(flip).concat(base) : base);
    if (!opt.mirror) cap(wing, base[0], false);
    capP(wing, base[base.length - 1], true, pin && pin.depth);
    if (opt.mirror) capP(wing, flip(base[base.length - 1]), false, pin && pin.depth);
    let tip = null;
    if (tipR) {
      tip = new Mesh();
      loft(tip, tipR); capP(tip, tipR[0], false, pin && pin.depthTip); cap(tip, tipR[tipR.length - 1], true);
      if (opt.mirror) { const mr = tipR.slice().reverse().map(flip); loft(tip, mr); cap(tip, mr[0], false); capP(tip, mr[mr.length - 1], true, pin && pin.depthTip); }
    }
    return { wing, tip, pins };
  }
  /* Randbogen bzw. Winglet als eigenes Formteil: Ringliste ab der letzten Rippe.
   * Runder Randbogen: ebene Ringe (z = Spannweite) wie bei der Tragfläche; die Nasen-/Endleistenlinie
   * des letzten Segments läuft für den Formenrand weiter (tipLine).
   * Winglet: die Ringe liegen in gedrehten Ebenen. Die Form wird deshalb in einem „abgerollten" Raum
   * gebaut – u = Sehnenrichtung, v = Dickenrichtung, s = Bogenlänge der Mittellinie als z – und danach
   * Punkt für Punkt über das Ringsystem frameAt(s) zurückgebogen. Die Trennfläche ist damit die Sehnen-
   * fläche des Winglets: in Verlängerung von Nase und Endleiste und durch die Mitte der Spitze; Platte,
   * Flansch und Rückseite folgen der Biegung mit konstanter Dicke, Passlöcher stehen senkrecht darauf. */
  function tipSpine(W, opt) {
    const wr = W.rings, ts = W.tipStart, rib = wr[ts], prev = wr[Math.max(0, ts - 1)];
    if (!W.wl) {
      if (wr.length <= ts + 1) return null;
      const rings = wr.slice(ts);
      return { rings, disp: rings, stations: W.stations, tipStart: 0, tipLine: [prev, rib], part: 'tip', wl: null, frameAt: null };
    }
    if (!W.wl.length) return null;
    const M = rib.pts.length, iLE = leIndex(M), LE = rib.pts[iLE], yRef = LE.y;
    // Ringsystem der letzten Rippe: parametrisches Winglet = Achsen x/y; Zeichnung = Sehne der Rippe (wie dort ex0/n0)
    let ex0 = [1, 0, 0], en0 = [0, 1, 0];
    if (opt.tipMode === 'wldraw') { const tp = tipPoints(rib.pts, rib.z); ex0 = V3.norm(V3.sub(tp.te, tp.le)); en0 = [-ex0[1], ex0[0], 0]; }
    const src = [{ pts: rib.pts.map(p => ({ x: p.x, y: p.y, z: rib.z })), z: rib.z, fr: { O: [LE.x, LE.y, rib.z], ex: ex0, en: en0 } }].concat(W.wl);
    const F = [], rings = [];
    let s = rib.z, cPrev = null;
    for (const r of src) {
      const { O, ex, en } = r.fr;
      let cen = [0, 0, 0]; for (const p of r.pts) { cen[0] += p.x; cen[1] += p.y; cen[2] += p.z; } cen = V3.mul(cen, 1 / r.pts.length);
      if (cPrev) s += Math.max(1e-3, V3.len(V3.sub(cen, cPrev)));
      cPrev = cen;
      const u0 = O[0];   // abgerollte Lage der Nase: x wie im Grundriss, Höhe = Nase der letzten Rippe (Platte konstant dick)
      const pts = r.pts.map(p => { const d = [p.x - O[0], p.y - O[1], p.z - O[2]]; return { x: u0 + V3.dot(d, ex), y: yRef + V3.dot(d, en) }; });
      F.push({ s, O: V3.sub(V3.sub(O, V3.mul(ex, u0)), V3.mul(en, yRef)), ex, en, t: V3.norm(V3.cross(ex, en)) });
      rings.push({ pts, z: s });
    }
    const n = F.length;
    const frameAt = q => {
      if (q <= F[0].s) { const f = F[0]; return { O: V3.add(f.O, V3.mul(f.t, q - f.s)), ex: f.ex, en: f.en }; }
      if (q >= F[n - 1].s) { const f = F[n - 1]; return { O: V3.add(f.O, V3.mul(f.t, q - f.s)), ex: f.ex, en: f.en }; }
      let k = 0; while (k < n - 2 && F[k + 1].s < q) k++;
      const a = F[k], b = F[k + 1], t = (q - a.s) / (b.s - a.s);
      const ex = V3.norm(V3.lerp(a.ex, b.ex, t)); let en = V3.lerp(a.en, b.en, t); en = V3.norm(V3.sub(en, V3.mul(ex, V3.dot(en, ex))));
      return { O: V3.lerp(a.O, b.O, t), ex, en };
    };
    // kleinster Biegeradius je Seite (+v = Oberseite / −v = Unterseite): dort darf Platte/Formdicke nicht dicker sein
    let rPlus = Infinity, rMinus = Infinity;
    for (let k = 0; k + 1 < n; k++) {
      const a = F[k], b = F[k + 1], dth = Math.acos(Math.max(-1, Math.min(1, V3.dot(a.t, b.t))));
      if (dth < 1e-4) continue;
      const R = (b.s - a.s) / dth;
      if (V3.dot(V3.sub(b.t, a.t), a.en) > 0) rPlus = Math.min(rPlus, R); else rMinus = Math.min(rMinus, R);
    }
    const last = rings[rings.length - 1];
    return { rings, disp: src, stations: W.stations, tipStart: rings.length - 1, tipLine: [last, last], part: 'tip', wl: null, frameAt, rPlus, rMinus, vRef: yRef };
  }
  // Bauteil wählen: 'all' ganze Fläche | 'wing' bis zur letzten Rippe | 'tip' Randbogen / Winglet (abgerollt)
  function partW(W, o) {
    if (o.part === 'wing') return Object.assign({}, W, { rings: W.rings.slice(0, W.tipStart + 1), wl: null, part: 'wing' });
    if (o.part === 'tip') return tipSpine(W, o);
    return W;
  }
  // Abgerolltes Netz über frameAt(s) zurückbiegen; meldet fold (Radius), wenn sich die Innenseite der Biegung faltet.
  /* dy = Versatz senkrecht zur Trennflaeche, VOR dem Biegen aufgebracht (Vorschau: Haelften
   * auseinanderziehen). Beim gebogenen Winglet wird er dadurch mitgebogen und trennt die Haelften
   * ueberall senkrecht zur Trennflaeche - ein reiner y-Versatz nach dem Biegen tut das nicht. */
  function bendMesh(mesh, Wp, dy) {
    if (!Wp.frameAt) return mesh;
    dy = dy || 0;
    const b = meshBounds(mesh), inner = b.mx[1] - Wp.vRef, outer = Wp.vRef - b.mn[1];
    const out = transformMesh(mesh, (x, y0, z) => { const f = Wp.frameAt(z), y = y0 + dy; return [f.O[0] + x * f.ex[0] + y * f.en[0], f.O[1] + x * f.ex[1] + y * f.en[1], f.O[2] + x * f.ex[2] + y * f.en[2]]; }, false);
    out.holes = mesh.holes; out.sicke = mesh.sicke;
    // Nachtraeglich (ohne Neuaufbau) mit anderem Versatz biegen; Ergebnis je Wert gecacht.
    if (!dy) out.rebend = d => { if (!d) return out; if (!out._rb || out._rb.d !== d) out._rb = { d, m: bendMesh(mesh, Wp, d) }; return out._rb.m; };
    const fp = inner >= Wp.rPlus - 0.5, fm = outer >= Wp.rMinus - 0.5;
    if (fp || fm) out.fold = Math.round(Math.min(fp ? Wp.rPlus : Infinity, fm ? Wp.rMinus : Infinity));
    return out;
  }
  /* Formenrand je Ring: Kasten (feste Wände xF0/xR0) oder im festen Abstand zum Grundriss: echter
   * Parallel-Offset (senkrecht gemessen) der Nasenlinie, der Endleistenlinie und der Abschlusskante an
   * der Spitze (letzte Nase -> letzte Endleiste) — der Rand läuft damit auch um den Randbogen mit
   * gleichem Abstand herum (Minkowski-Summe Grundriss + Kreis, je Höhe z als Intervall [xF, xR]).
   * Vor der Wurzel wird das erste Segment geradlinig verlängert. z wird absolut genommen (Spiegelung
   * an der Wurzel). Endleisten-x für beide Hälften gleich (max. der beiden Endleistenpunkte).
   * fn.off(dLE, dTE, withTE) liefert den Offset für andere Abstände (Sicke): at(z) -> {xF, xR} | null,
   * zEnd (Ende des Offsets hinter der Spitze), dist(x, z) = Abstand zum Grundriss minus Offset. */
  function edgeFn(W, opt, xF0, xR0) {
    if (opt.edge !== 'offset') return () => ({ xF: xF0, xR: xR0 });
    const R = W.rings, M = R[0].pts.length, iLE = leIndex(M), teX = P => Math.max(P[0].x, P[M - 1].x);
    const zExt = R[0].z - (opt.ovRoot + Math.max(opt.ovF, opt.ovR) + 10);
    const LEp = R.map(r => [r.pts[iLE].x, r.z]), TEp = R.map(r => [teX(r.pts), r.z]);
    const extend = L => { const a = L[0], b = L[1] || a, dz = b[1] - a[1] || 1; L.unshift([a[0] + (b[0] - a[0]) / dz * (zExt - a[1]), zExt]); };
    extend(LEp); extend(TEp);
    const tipLE = LEp[LEp.length - 1], tipTE = TEp[TEp.length - 1], cache = {};
    const mk = (dLE, dTE, withTE) => {
      const key = dLE + '/' + dTE + '/' + withTE;
      if (cache[key]) return cache[key];
      const seg = [], add = (L, d) => { for (let i = 0; i + 1 < L.length; i++) seg.push({ a: L[i], b: L[i + 1], d }); };
      add(LEp, dLE); if (withTE) add(TEp, dTE);
      const K = 8;   // Abschlusskante an der Spitze: Abstand geht von dLE in dTE über
      for (let k = 0; k < K; k++) {
        const t0 = k / K, t1 = (k + 1) / K, lp = t => [tipLE[0] + (tipTE[0] - tipLE[0]) * t, tipLE[1] + (tipTE[1] - tipLE[1]) * t];
        seg.push({ a: lp(t0), b: lp(t1), d: dLE + (dTE - dLE) * (t0 + t1) / 2 });
      }
      let zEnd = -Infinity; for (const s of seg) zEnd = Math.max(zEnd, s.a[1] + s.d, s.b[1] + s.d);
      // [xF, xR] bei Höhe z: Minimum/Maximum von x(t) ∓ sqrt(d² − (z − z(t))²) über alle Segmente
      // (Endpunkte = Kreise, innerer Extrempunkt = Parallele zum Segment).
      const at = z => {
        let xF = Infinity, xR = -Infinity;
        const end = (p, d) => { const u = z - p[1]; if (Math.abs(u) <= d) { const h = Math.sqrt(Math.max(0, d * d - u * u)); if (p[0] - h < xF) xF = p[0] - h; if (p[0] + h > xR) xR = p[0] + h; } };
        for (const { a, b, d } of seg) {
          end(a, d); end(b, d);
          const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
          if (L < 1e-9 || Math.abs(dz) < 1e-9) continue;
          const h = d * Math.abs(dz) / L, uu = dx * d * Math.sign(dz) / L;
          let t = (z - a[1] - uu) / dz; if (t > 0 && t < 1) { const x = a[0] + dx * t - h; if (x < xF) xF = x; }
          t = (z - a[1] + uu) / dz; if (t > 0 && t < 1) { const x = a[0] + dx * t + h; if (x > xR) xR = x; }
        }
        return xF <= xR ? { xF, xR } : null;
      };
      const dist = (x, z) => {
        let s = Infinity;
        for (const { a, b, d } of seg) {
          const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
          const t = L2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)) : 0;
          const v = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) - d;
          if (v < s) s = v;
        }
        return s;
      };
      return cache[key] = { at, zEnd, dist };
    };
    const main = mk(opt.ovF, opt.ovR, true);
    const fn = (P, z) => (z == null ? null : main.at(Math.abs(z))) || { xF: P[iLE].x - opt.ovF, xR: teX(P) + opt.ovR };
    fn.off = mk; fn.zEnd = main.zEnd;
    return fn;
  }
  /* Endleiste an der Trennfläche (Negativform / geteiltes Urmodell). Die Trennfläche liegt hinten auf der
   * Sehnenmitte der Endleiste (yM, für beide Hälften gleich -> die Hälften passen aufeinander). Rückgabe:
   * yM und der Punkt, mit dem die Profilhälfte auf die Trennfläche trifft:
   *   'out'   : senkrecht unter/über dem Endleistenpunkt -> die halbe Endleistendicke steht als Stirnfläche
   *             über die Trennfläche (Kante bleibt im Abguss erhalten)
   *   'blend' : die Profilfläche läuft mit ihrer Endtangente weiter bis zur Trennfläche (Keil, Kante läuft aus);
   *             die Verlängerung wird auf xMax begrenzt (Flansch / Sicke)
   *   'flush' : wie früher: jede Hälfte liegt hinten auf ihrem EIGENEN Endleistenpunkt (Endleiste läuft bündig
   *             in die Trennfläche, die Trennflächen beider Hälften sind um die Endleistendicke versetzt). */
  function teMid(P) { const a = P[0], b = P[P.length - 1]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  function teRef(P, top, mode) { return mode === 'flush' ? (top ? P[0] : P[P.length - 1]) : teMid(P); }
  function teParting(P, top, mode, xMax) {
    const M = P.length, TE = top ? P[0] : P[M - 1], yM = teRef(P, top, mode).y, Q = top ? P[1] : P[M - 2];
    let x = TE.x;
    if (mode === 'blend' && TE.y !== yM && Q) {
      const dx = TE.x - Q.x, dy = TE.y - Q.y, t = Math.abs(dy) > 1e-9 ? (yM - TE.y) / dy : -1;
      if (t > 0) x = TE.x + dx * t;
      const lim = Math.max(TE.x, xMax == null ? Infinity : xMax);
      if (x > lim) x = lim; if (x < TE.x) x = TE.x;
    }
    return { yM, x };
  }
  /* ---------- Steckungs-Ausnehmungen in der Wurzelverlängerung ------------------
   * Für die Tragflächensteckung: Taschen parallel zur Spannweite, die in der Wurzel-
   * verlängerung (Überstand vor der Wurzelrippe) in der Trennfläche liegen. Querschnitt
   * Kreis oder Rechteck (Maße wählbar), Lage (x, y) bezogen auf die Nase der Wurzelrippe
   * (x zur Endleiste, y nach oben) — also im Koordinatensystem des Profilschnitts —,
   * Länge ab der Wurzelrippe nach innen wählbar.
   * Umsetzung: die kollabierte Kontur der Überstand-Ringe (Trennlinie Nase -> Endleiste)
   * wird umparametrisiert — ein Teil ihrer Punkte läuft um den an der Trennlinie
   * abgeschnittenen Querschnitt herum, die Punktzahl je Ring bleibt gleich. Ein flacher
   * Ring mit derselben Punktaufteilung (Querschnitt auf die Trennlinie projiziert) liefert
   * die senkrechte Stirnwand am Ende der Tasche.
   * In der Negativform liegt das Material über der Trennlinie -> Tasche; am geteilten
   * Urmodell liegt es darunter -> derselbe Umriss wird ein auf die Trennebene gesetzter
   * Volumenkörper. Beides passt zusammen (die Form wird vom Urmodell abgenommen).
   * Querschnitte, die nicht mit 0,5 mm Rand in der Profilkontur liegen, ganz auf der
   * anderen Seite der Trennlinie liegen oder sich überlappen, werden ausgelassen. */
  // Konvexes Polygon an der Geraden sOf = 0 schneiden: Randzug der behaltenen Seite
  // (sOf >= 0) von einem Schnittpunkt zum anderen, ohne die Strecke auf der Geraden.
  function clipToSide(poly, sOf) {
    const N = poly.length, s = poly.map(sOf), K = [];
    let cuts = 0;
    for (let i = 0; i < N; i++) {
      const a = poly[i], b = poly[(i + 1) % N], sa = s[i], sb = s[(i + 1) % N];
      if (sa >= 0) K.push({ p: a, cut: false });
      if ((sa >= 0) !== (sb >= 0)) { const t = sa / (sa - sb); K.push({ p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, cut: true }); cuts++; }
    }
    if (cuts !== 2 || K.length < 3) return null;   // ganz auf einer Seite (oder entartet)
    let i0 = -1;
    for (let i = 0; i < K.length; i++) if (K[i].cut && K[(i + 1) % K.length].cut) { i0 = (i + 1) % K.length; break; }
    if (i0 < 0) return null;
    const out = []; for (let i = 0; i < K.length; i++) out.push(K[(i0 + i) % K.length].p);
    return out;
  }
  // Polyline auf k Punkte ausdünnen (Enden bleiben erhalten)
  function resamplePath(p, k) {
    if (k >= p.length) return p.slice();
    const L = [0];
    for (let i = 1; i < p.length; i++) L.push(L[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y));
    const tot = L[L.length - 1] || 1, out = [];
    for (let j = 0; j < k; j++) {
      const d = tot * j / (k - 1); let i = 1;
      while (i < L.length - 1 && L[i] < d) i++;
      const t = (d - L[i - 1]) / ((L[i] - L[i - 1]) || 1);
      out.push({ x: p[i - 1].x + (p[i].x - p[i - 1].x) * t, y: p[i - 1].y + (p[i].y - p[i - 1].y) * t });
    }
    return out;
  }
  /* Trennlinien-Strecke der Wurzelrippe mit Ausnehmungen: liefert run(deep) — die Punkte der
   * kollabierten Kontur (oben von der Endleiste zur Nase, unten umgekehrt), deep = mit
   * Querschnitt, false = flach mit gleicher Punktaufteilung. null = keine Ausnehmung möglich. */
  function stkChord(P, top, teEdge, stk) {
    stk = { pts: (stk.pts || []).map(q => q || {}), n: (stk.pts || []).length };
    const M = P.length, iLE = leIndex(M), LE = P[iLE], TE = teRef(P, top, teEdge);
    const dx = TE.x - LE.x, dy = TE.y - LE.y, Lc = Math.hypot(dx, dy);
    if (!(Lc > 1e-6)) return null;
    const ux = dx / Lc, uy = dy / Lc, sg = top ? 1 : -1, nx = -uy * sg, ny = ux * sg;   // Normale zur Profilseite
    const tOf = p => (p.x - LE.x) * ux + (p.y - LE.y) * uy;
    const sOf = p => (p.x - LE.x) * nx + (p.y - LE.y) * ny;
    const onChord = t => ({ x: LE.x + ux * t, y: LE.y + uy * t });
    const margin = 0.5, items = [];
    let skipped = 0;
    for (let k = 0; k < stk.n; k++) {
      const Q = stk.pts[k] || { x: 0, y: 0 }, cx = LE.x + (+Q.x || 0), cy = LE.y + (+Q.y || 0), poly = [];
      if (Q.shape === 'rect') {
        const a = Q.a / 2, b = Q.b / 2, cor = [[cx - a, cy - b], [cx + a, cy - b], [cx + a, cy + b], [cx - a, cy + b]], K = 6;
        for (let i = 0; i < 4; i++) { const A = cor[i], B = cor[(i + 1) % 4]; for (let j = 0; j < K; j++) { const t = j / K; poly.push({ x: A[0] + (B[0] - A[0]) * t, y: A[1] + (B[1] - A[1]) * t }); } }
      } else {
        const r = Q.d / 2, N = Math.max(24, Math.min(72, Math.round(Math.PI * 2 * r / 0.8)));
        for (let j = 0; j < N; j++) { const th = 2 * Math.PI * j / N; poly.push({ x: cx + r * Math.cos(th), y: cy + r * Math.sin(th) }); }
      }
      const path = clipToSide(poly, sOf);
      if (!path || path.length < 3) { skipped++; continue; }
      if (!path.every(p => pointInPoly(p, P) && edgeDist(p, P) >= margin)) { skipped++; continue; }
      let t0 = Infinity, t1 = -Infinity;
      for (const p of path) { const t = tOf(p); if (t < t0) t0 = t; if (t > t1) t1 = t; }
      if (t0 < margin || t1 > Lc - margin) { skipped++; continue; }
      items.push({ t0, t1, path, len: Math.max(0.5, +Q.len || 0) });
    }
    items.sort((a, b) => a.t0 - b.t0);
    for (let i = items.length - 1; i > 0; i--) if (items[i].t0 - items[i - 1].t1 < 0.8) { items.splice(i, 1); skipped++; }
    if (!items.length) return { placed: 0, skipped, run: null };
    // Punktbudget der Trennlinien-Strecke: je Ausnehmung ein Block, dazwischen/außen die Lücken
    const n0 = top ? iLE + 1 : M - iLE, G = items.length + 1, per = Math.floor((n0 - G) / items.length);
    if (per < 4) return { placed: 0, skipped: skipped + items.length, run: null };
    const seq = top ? items.slice().reverse() : items.slice();   // Durchlaufrichtung der kollabierten Kontur
    const paths = seq.map(it => {
      const p = resamplePath(it.path, Math.min(it.path.length, per));
      const f = tOf(p[0]), l = tOf(p[p.length - 1]);
      return (top ? f < l : f > l) ? p.slice().reverse() : p;
    });
    const used = paths.reduce((a, p) => a + p.length, 0), rem = n0 - used;
    return {
      placed: items.length, skipped, lens: seq.map(it => it.len),
      /* deep(i) = true: Ausnehmung i (in Durchlaufreihenfolge) ist an dieser Station offen;
       * sonst laufen ihre Punkte flach auf der Trennlinie (Stirnwand am Ende der Tasche). */
      run(deep) {
        const dp = typeof deep === 'function' ? deep : () => !!deep;
        const use = paths.map((p, i) => dp(i) ? p : p.map(q => onChord(tOf(q))));
        // Lücken auf der Trennlinie: Start -> 1. Ausnehmung -> … -> Ende
        const tS = top ? Lc : 0, tE = top ? 0 : Lc, seg = [];
        let tPrev = tS;
        for (const p of use) { seg.push([tPrev, tOf(p[0])]); tPrev = tOf(p[p.length - 1]); }
        seg.push([tPrev, tE]);
        // Restpunkte nach Länge auf die Lücken verteilen (jede mindestens 1)
        const len = seg.map(g => Math.abs(g[1] - g[0])), tot = len.reduce((a, b) => a + b, 0) || 1;
        const m = len.map(() => 1); let left = rem - seg.length;
        const share = len.map(l => l / tot * left);
        share.forEach((v, i) => { const f = Math.floor(v); m[i] += f; left -= f; });
        share.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(q => { if (left > 0) { m[q[1]]++; left--; } });
        const out = [];
        for (let g = 0; g < seg.length; g++) {
          const a = seg[g][0], b = seg[g][1], mg = m[g];
          for (let j = 0; j < mg; j++) {
            const f = g === 0 ? j / mg : g === seg.length - 1 ? (j + 1) / mg : (j + 1) / (mg + 1);
            out.push(onChord(a + (b - a) * f));
          }
          if (g < use.length) out.push.apply(out, use[g]);
        }
        return out;
      }
    };
  }
  /* Ringfolge der Wurzelverlängerung bei unterschiedlichen Längen: von außen (dz = Überstand)
   * bis zur Wurzelrippe (dz = 0). Je Länge, die vor dem Formenende endet, zwei Ringe an derselben
   * Station (flach / offen) = senkrechte Stirnwand. deep(i) fragt, ob Ausnehmung i dort offen ist. */
  function stkLevels(lens, ov) {
    const L = lens.map(v => Math.min(v, ov)), uniq = [...new Set(L)].sort((a, b) => b - a), out = [];
    const mask = d => i => L[i] >= d - 1e-6;
    // Am äußeren Ende der Form bleibt die Trennfläche geschlossen: Ausnehmungen, die bis dorthin
    // durchlaufen, enden dort mit einer senkrechten Stirnwand (flacher Ring + offener Ring).
    out.push({ dz: ov, deep: () => false });
    if (L.some(v => v >= ov - 1e-6)) out.push({ dz: ov, deep: mask(ov) });
    for (const l of uniq) {
      if (l >= ov - 1e-6) continue;
      out.push({ dz: l, deep: i => L[i] > l + 1e-6 });   // vor dem Absatz
      out.push({ dz: l, deep: mask(l) });                // ab hier offen
    }
    out.push({ dz: 0, deep: () => true });
    return out;
  }
  /* Verlauf einer Rand-Zutat (Huckel, Sicke, Blutrinne) über den Randbogen: Faktor auf Höhe bzw. Tiefe je
   * Profilring k. Bis zur letzten Rippe voll, im Randbogen nur noch über tip % seiner Länge; die letzten
   * wedge % laufen als Keil auf 0 aus. Hinter dem Randbogen (Überstand auf der Trennebene) immer 0 —
   * keine dieser Zutaten darf auf die ebene Trennfläche hinauslaufen. */
  function tipFade(W, tip, wedge) {
    const N = W.rings.length, ts = W.tipStart == null ? N - 1 : W.tipStart;
    const lim = tip == null ? 100 : tip, wd = Math.min(wedge || 0, lim);
    return k => {
      if (k <= ts || N - 1 <= ts) return 1;
      const u = (k - ts) / (N - 1 - ts) * 100;
      if (u >= lim) return 0;
      return wd > 0 && u > lim - wd ? (lim - u) / wd : 1;
    };
  }
  /* Trennfläche (gemeinsam für Negativform, geteiltes Urmodell und die Vorschau-Fläche):
   *   yF(LE, x)   Höhe der Trennfläche vor der Nase (x ≤ LE.x): waagrecht ab dem Nasenpunkt oder um angF geneigt
   *   yR(tp, x)   Höhe hinter der Endleiste (x ≥ tp.x, tp aus teParting): waagrecht auf der Sehnenmitte oder um angR geneigt
   *   tipDy(s, t) Zusatzhöhe hinter der Randbogenspitze: s = Abstand hinter der letzten Rippe (mm), t = Sehnenlage
   *               0 (Nase) .. 1 (Endleiste). 'flat' = 0 (Fläche bleibt in Höhe der letzten Rippe). 'tangent' = Nasen-
   *               und Endleistenlinie laufen mit ihrer Steigung dy/dz (aus den letzten Ringen) weiter und gehen als
   *               Parabel knickfrei in die Waagrechte über: y' = m·(1 − s/L), ab s = L waagrecht (L = 0: bleibt tangential).
   *               Damit folgt die Trennfläche z. B. der V-Form oder einem hochgezogenen Randbogen statt dort zu knicken. */
  /* Trennlinie ohne Hinterschnitt (Randbogen): je Ring liegt der vordere Trennlinienpunkt dort, wo die Fläche –
   * bei Blick senkrecht auf die Mittelfläche des Randbogens – ihren Umriss hat (Silhouette). Bezug ist die
   * Mittellinie in Spannweitenrichtung (mittlere Profilhöhe je Ring über z, über ≥ 1 mm geglättet); die Entform-
   * richtung n steht senkrecht darauf (in Sehnenrichtung weiterhin senkrecht zur x-Achse, also oben / unten). Trennlinienpunkt = Nulldurchgang von
   * (Flächennormale · n) nahe der Nase (Oberseite > 0, Unterseite < 0). Bei waagrechter Mittellinie ist das genau
   * der Nasenpunkt (wie bisher); steigt der Randbogen an (Hochziehen, V-Form), wandert der Punkt auf die Oberseite:
   * die Trennfläche geht dann genau durch den äußersten Punkt des Randbogens, senkrecht zur Mittellinie gemessen.
   * Umsetzung: der Ring wird so umparametrisiert, dass dieser Punkt auf dem Index leIndex(M) liegt (alle Punkte
   * bleiben auf dem Polygonzug, Punktzahl gleich) – Form, Trennplatte, Vorschau-Fläche und Zutaten arbeiten damit
   * unverändert. Nicht bei gebogenen Winglet-Formen (frameAt: Trennfläche = Sehnenfläche). */
  function partingReparam(W) {
    const R = W && W.rings, N = R ? R.length : 0; if (N < 2 || W.frameAt) return W;
    const M = R[0].pts.length, iLE = leIndex(M); if (M < 8) return W;
    const pz = (r, p) => (p.z != null ? p.z : r.z);
    const ym = R.map(r => r.pts.reduce((s, p) => s + p.y, 0) / r.pts.length);
    const chord = R.map(r => { const LE = r.pts[iLE], TE = teMid(r.pts); return Math.hypot(TE.x - LE.x, TE.y - LE.y); });
    /* Steigung der Mittellinie: sehnengewichtete Ausgleichsgerade über ein Fenster von ± der Randbogenlänge
     * (mind. 3 mm). Die letzten, winzigen Ringe am Randbogen-Ende (Sehne -> 0, Mittelhöhe springt auf die
     * Wölbungsmitte) bekommen so kaum Gewicht – sonst kippt die Entformrichtung dort um 20–30° und der
     * Trennpunkt springt auf die Oberseite (Zacken in der Trennfläche). */
    const ts = W.tipStart == null ? N - 1 : Math.max(0, Math.min(N - 1, W.tipStart));
    const hW = Math.max(3, R[N - 1].z - R[ts].z);
    const slope = j => {
      const z0 = R[j].z; let sw = 0, sz = 0, sy = 0, szz = 0, szy = 0, zMin = Infinity, zMax = -Infinity;
      const add = k => { const w = chord[k] + 1e-3, dz = R[k].z - z0; sw += w; sz += w * dz; sy += w * ym[k]; szz += w * dz * dz; szy += w * dz * ym[k]; if (R[k].z < zMin) zMin = R[k].z; if (R[k].z > zMax) zMax = R[k].z; };
      for (let k = 0; k < N; k++) if (Math.abs(R[k].z - z0) <= hW) add(k);
      // bei grober Ringteilung: mindestens einen Nachbarn je Seite mitnehmen
      for (let k = j - 1; k >= 0 && R[k].z < zMin; k--) { if (z0 - R[k].z > hW) { add(k); break; } }
      for (let k = j + 1; k < N && R[k].z > zMax; k++) { if (R[k].z - z0 > hW) { add(k); break; } }
      const det = sw * szz - sz * sz; return det > 1e-9 ? (sw * szy - sz * sy) / det : 0;
    };
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const v3 = (r, i) => { const p = r.pts[i]; return [p.x, p.y, pz(r, p)]; };
    const rings = [], idx = new Array(N); let changed = false, sPrev = iLE;
    for (let j = 0; j < N; j++) {
      const r = R[j], P = r.pts, LE = P[iLE], TE = teMid(P), c = chord[j];
      let s = sPrev;   // kein Nulldurchgang gefunden / entarteter Ring: Trennpunkt des Nachbarrings beibehalten (stetig)
      if (c > 0.5 && P.length === M) {
        // Entformrichtung: senkrecht zur Mittellinie (y/z) und zur x-Achse (in Sehnenrichtung wie bisher: Entformen nach oben / unten)
        const th = Math.atan(slope(j)), n = [0, Math.cos(th), -Math.sin(th)];
        const A = R[Math.max(0, j - 1)], B = R[Math.min(N - 1, j + 1)];
        const nrm = i => cross(sub(v3(r, Math.min(M - 1, i + 1)), v3(r, Math.max(0, i - 1))), sub(v3(B, i), v3(A, i)));
        // Vorzeichen so, dass die Oberseite (Indizes < iLE) positiv zählt
        const sg = nrm(Math.floor(iLE / 2))[1] < 0 ? -1 : 1;
        const g = i => sg * dot(nrm(i), n);
        // Nulldurchgang im Nasenbereich (x < Nase + 30 % Sehne), dem Trennpunkt des vorigen Rings am nächsten (stetig)
        const xLim = LE.x + 0.3 * Math.abs(TE.x - LE.x);
        let best = -1, bd = Infinity, gi = g(0);
        for (let i = 0; i < M - 1; i++) {
          const gn = g(i + 1);
          if (gi > 0 && gn <= 0 && P[i].x <= xLim && P[i + 1].x <= xLim) { const d = Math.abs(i + 0.5 - sPrev); if (d < bd) { bd = d; best = i; } }
          gi = gn;
        }
        if (best >= 0) { const a = g(best), b = g(best + 1); s = best + (a - b > 1e-12 ? a / (a - b) : 0.5); }
      }
      idx[j] = s; sPrev = s;
    }
    /* Glättung des Trennpunkts entlang der Spannweite (Gauß, σ = 1 mm, sehnengewichtet): die Trennlinie läuft
     * damit ohne Zacken um den Randbogen, alle Punkte bleiben auf dem jeweiligen Ringpolygon. */
    const sig = 1, sm = new Array(N);
    for (let j = 0; j < N; j++) {
      let sw = 0, ss = 0;
      for (let k = 0; k < N; k++) { const dz = (R[k].z - R[j].z) / sig; if (Math.abs(dz) > 3) continue; const w = (chord[k] + 1e-3) * Math.exp(-0.5 * dz * dz); sw += w; ss += w * idx[k]; }
      sm[j] = sw > 0 ? ss / sw : idx[j];
    }
    for (let j = 0; j < N; j++) {
      const r = R[j], P = r.pts, s = sm[j]; idx[j] = s;
      if (Math.abs(s - iLE) < 1e-6 || P.length !== M) { rings.push(r); continue; }
      const at = u => { const i0 = Math.max(0, Math.min(M - 2, Math.floor(u))), fr = Math.max(0, Math.min(1, u - i0)), a = P[i0], b = P[i0 + 1]; const q = { x: a.x + (b.x - a.x) * fr, y: a.y + (b.y - a.y) * fr }; if (a.z != null && b.z != null) q.z = a.z + (b.z - a.z) * fr; return q; };
      const Q = new Array(M);
      for (let k = 0; k < M; k++) { const u = k <= iLE ? s * k / iLE : s + (M - 1 - s) * (k - iLE) / (M - 1 - iLE); Q[k] = k === 0 ? P[0] : k === M - 1 ? P[M - 1] : at(u); }
      rings.push(Object.assign({}, r, { pts: Q })); changed = true;
    }
    return changed ? Object.assign({}, W, { rings, psIdx: idx }) : W;
  }
  /* Trennfläche vor der Nase / hinter der Endleiste, Höhe an der Stelle x (Sehnenrichtung):
   *   yF(LE, x, P): vor der Nase (x < LE.x), yR(tp, x, P): hinter der Endleiste (x > tp.x). P = Punktliste des Rings
   *   (kennzeichnet über P.psTip die Ringe des Randbogens, siehe unten) — ohne P gilt der bisherige Verlauf.
   * 'flat' (bisher): je Rippe waagrecht auf Nasenhöhe bzw. Sehnenmitte der Endleiste (ggf. um angF/angR geneigt).
   *   Am hochgezogenen Randbogen liegt die Fläche vor der Nase damit für jeden Ring auf dessen (steigender)
   *   Nasenhöhe — im Schnitt quer zur Sehne eine Stufe, wo die zurückweichende Nasenlinie die Schnittebene passiert.
   * 'follow' (chord): die Trennfläche folgt am Randbogen in Flugrichtung der Nasen- bzw. Endleistenlinie: Höhe an
   *   der Stelle x = Höhe der Nasenlinie (bzw. Endleistenlinie) dort, wo sie x erreicht — die Linie wird also in
   *   Spannweitenrichtung ausgezogen (im Schnitt quer zur Sehne eine Gerade, keine Stufe). Vor der Nase der letzten
   *   Rippe (x < Nasenlinie am Randbogenanfang) und hinter deren Endleiste läuft die Fläche wie bisher weiter
   *   (waagrecht / geneigt), an den Rippen der Tragfläche ändert sich nichts. Hinter dem Randbogen (Überstand)
   *   wird die Fläche um den dortigen tangentialen Verlauf (tipDy) mit verschoben. Kein Hinterschnitt: die Fläche
   *   fällt zur Nase hin nur so ab, wie die Nasenlinie es tut, und ist in Spannweitenrichtung eben. */
  function partingSpec(W, opt) {
    const ps = opt.ps || {}, R = W.rings, N = R.length, M = R[0].pts.length, iLE = leIndex(M);
    const tF = Math.tan((ps.angF || 0) * Math.PI / 180), tR = Math.tan((ps.angR || 0) * Math.PI / 180);
    const yF0 = (LE, x) => LE.y + tF * (LE.x - x);
    const yR0 = (tp, x) => tp.yM + tR * (x - tp.x);
    /* Verlauf am Randbogen in Flugrichtung ('follow'): Nasen- und Endleistenlinie der Randbogen-Ringe als Polygonzug
     * über x; Ringe ab tipStart tragen pts.psTip = true (Kopien in den Überständen übernehmen die Kennung). */
    let curveF = null, curveR = null, wF = 0, wR = 0;
    const ts = W.tipStart == null ? N - 1 : Math.max(0, Math.min(N - 1, W.tipStart));
    const FX = [], FY = [], RX = [], RY = [];
    if (ps.chord === 'follow' && !W.frameAt && N >= 2 && ts < N - 1) {
      for (let j = ts; j < N; j++) {
        const P = R[j].pts; if (P.length !== M) continue;
        P.psTip = true;
        const LE = P[iLE], TE = teMid(P);
        FX.push(LE.x); FY.push(LE.y); RX.push(TE.x); RY.push(TE.y);
      }
      // Polygonzug auswerten: erstes Teilstück (vom Randbogenanfang aus), das x enthält; davor / dahinter Verlängerung
      const mk = (X, Y, before, after) => x => {
        const n = X.length; if (n < 2) return null;
        for (let k = 0; k + 1 < n; k++) {
          const a = X[k], b = X[k + 1], lo = Math.min(a, b), hi = Math.max(a, b);
          if (x >= lo - 1e-9 && x <= hi + 1e-9) { const t = hi - lo > 1e-9 ? (x - a) / (b - a) : 0; return Y[k] + (Y[k + 1] - Y[k]) * Math.max(0, Math.min(1, t)); }
        }
        return before(x);
      };
      // vor der Nasenlinie der letzten Rippe: wie bisher (waagrecht / geneigt) ab deren Nasenpunkt; hinter der Spitze: eben
      curveF = mk(FX, FY, x => x < FX[0] ? FY[0] + tF * (FX[0] - x) : FY[FY.length - 1]);
      curveR = mk(RX, RY, x => x > RX[0] ? RY[0] + tR * (x - RX[0]) : RY[RY.length - 1]);
      // Ausdehnung der Nasen-/Endleistenlinie des Randbogens in Sehnenrichtung (für tipFade)
      wF = Math.max(5, Math.max.apply(null, FX) - Math.min.apply(null, FX)); wR = Math.max(5, Math.max.apply(null, RX) - Math.min.apply(null, RX));
    }
    /* Abweichung des Bezugspunkts von der Linie (LE.y − Linie: 0 an den Randbogen-Ringen, im Überstand hinter der
     * Spitze der tangentiale Anteil tipDy) wird nach vorn / hinten mit fadeF / fadeR ausgeblendet (siehe tipFade). */
    const fadeF = (x, x0) => smoothstep(1 - (x0 - x) / wF), fadeR = (x, x0) => smoothstep(1 - (x - x0) / wR);
    const yF = (LE, x, P) => {
      if (curveF && P && P.psTip) { const y0 = curveF(LE.x), y1 = curveF(x); if (y0 != null && y1 != null) return y1 + (LE.y - y0) * fadeF(x, LE.x); }
      return yF0(LE, x);
    };
    const yR = (tp, x, P) => {
      if (curveR && P && P.psTip) { const y0 = curveR(tp.x), y1 = curveR(x); if (y0 != null && y1 != null) return y1 + (tp.yM - y0) * fadeR(x, tp.x); }
      return yR0(tp, x);
    };
    const tan = ps.tip === 'tangent';
    let sLE = 0, sTE = 0;
    if (tan && N >= 2) {
      /* Steigung von Nasen- und Endleistenlinie am Randbogen-Ende: Ausgleichsgerade über die letzten ≥ 3 mm
       * (mindestens 3 Ringe), sehnengewichtet – der letzte, winzige Ring allein wäre zu verrauscht. */
      const zE = R[N - 1].z, fit = f => {
        let sw = 0, sz = 0, sy = 0, szz = 0, szy = 0, n = 0;
        for (let k = N - 1; k >= 0 && (zE - R[k].z <= 3 || n < 3); k--) {
          const LE = R[k].pts[iLE], TE = teMid(R[k].pts), w = Math.hypot(TE.x - LE.x, TE.y - LE.y) + 1e-3, dz = R[k].z - zE, y = f(R[k].pts);
          sw += w; sz += w * dz; sy += w * y; szz += w * dz * dz; szy += w * dz * y; n++;
        }
        const det = sw * szz - sz * sz; return det > 1e-9 ? (sw * szy - sz * sy) / det : 0;
      };
      sLE = fit(P => P[iLE].y); sTE = fit(P => teMid(P).y);
    }
    const L = Math.max(0, ps.tanLen || 0);
    const f = s => !tan ? 0 : (L <= 0 ? s : (s < L ? s - s * s / (2 * L) : L / 2));
    const tipDy = (s, t) => (sLE + (sTE - sLE) * Math.max(0, Math.min(1, t))) * f(Math.max(0, s));
    /* Faktor auf tipDy im Überstand hinter der Spitze beim Verlauf 'follow': die tangential weiterlaufende Nasen- /
     * Endleistenlinie hebt die Fläche nur im Sehnenband der letzten Rippe an; davor / dahinter folgt die Fläche der
     * (in z ebenen) Linie und der Anteil läuft über die Randbogen-Ausdehnung wF / wR glatt auf 0 aus (sonst Stufe
     * am Übergang letzte Rippe -> Überstand). Ohne 'follow' immer 1. */
    const tipFade = (x, LE, TE) => !curveF ? 1 : x < LE.x ? smoothstep(1 - (LE.x - x) / wF) : x > TE.x ? smoothstep(1 - (x - TE.x) / wR) : 1;
    // NX: zusätzliche Punkte je Flansch (vorn / hinten) in den Ringpolygonen, damit der gekrümmte Verlauf abgebildet wird
    const NX = curveF ? 10 : 0, xkF = curveF ? FX[0] : null, xkR = curveR ? RX[0] : null;
    const xFarF = curveF ? Math.max.apply(null, FX) : 0, xFarR = curveR ? Math.min.apply(null, RX) : 0;
    /* Flanschpunkte (NX Stück, streng zwischen xa und xb, in dieser Reihenfolge): beim Verlauf 'follow' hat die
     * Trennfläche an der Nasen- bzw. Endleistenlinie der letzten Rippe (x = xkF bzw. xkR) einen Knick – davor bzw.
     * dahinter ist sie eben, dann folgt sie der gekrümmten Linie. Liegt der Knick im Flansch, wird er als fester
     * Punkt mitgenommen: 1 Punkt im ebenen Teil, der Knick, die übrigen im gekrümmten Teil auf einem festen
     * x-Raster (vom Knick bis zum äußersten Nasen-/Endleistenpunkt des Randbogens); Rasterpunkte jenseits der
     * Nase / Endleiste des Rings rücken gleichmäßig auf den Rest zusammen. So liegt jeder Punkt in allen Ringen an
     * derselben Stelle (gleiche Rolle) und der Loft zwischen den Ringen ist dort exakt. Gleichmäßig je Ring verteilte
     * Punkte mittelten beim Loft über den Knick hinweg: Wellen bis 0,3 mm quer zur Sehne am hochgezogenen Randbogen. */
    const flangeX = (xa, xb) => {
      const lo = Math.min(xa, xb), hi = Math.max(xa, xb), L = [];
      const inside = k => k != null && k > lo + 0.3 && k < hi - 0.3;
      const k = inside(xkF) ? xkF : inside(xkR) ? xkR : null;
      const seg = (a, b, n) => { for (let j = 1; j <= n; j++) L.push(a + (b - a) * j / (n + 1)); };
      if (k == null || NX < 3) { seg(xa, xb, NX); return L; }
      const front = k === xkF, GF = 1, nC = NX - GF - 1, f = front ? hi : lo, far = front ? xFarF : xFarR;
      // gekrümmter Teil vom Knick k zum Ringende f: Rasterpunkte (Raster k .. far), gültig solange > 0,3 mm vor f
      const C = []; let base = k;
      for (let j = 1; j <= nC; j++) { const g = k + (far - k) * j / (nC + 1); if (Math.abs(g - k) < Math.abs(f - k) - 0.3 && (far - k) * (f - k) > 0) { C.push(g); base = g; } else break; }
      for (let jv = C.length, j = jv + 1; j <= nC; j++) C.push(base + (f - base) * (j - jv) / (nC - jv + 1));
      if (front) { seg(lo, k, GF); L.push(k); L.push(...C); } else { L.push(...C.reverse()); L.push(k); seg(k, hi, GF); }
      return xa <= xb ? L : L.reverse();
    };
    return { yF, yR, tipDy, tipFade, tan, angled: tF !== 0 || tR !== 0, tanLen: L, follow: !!curveF, NX, flangeX };
  }
  // Negativform: Ringpolygone der Formhälfte (half 'top'|'bot') je Station.
  function moldRings(W, opt, half) {
    const ps = partingSpec(W, opt);
    const rings = W.rings, M = rings[0].pts.length, iLE = leIndex(M);
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const r of rings) for (const p of r.pts) { if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x; if (p.y < yMin) yMin = p.y; if (p.y > yMax) yMax = p.y; }
    // Formhöhe: Formdicke über dem Profil oder (opt.fit) absolute Ober-/Unterkante wie der Negativblock im Negativdesign
    const xF0 = xMin - opt.ovF, xR0 = xMax + opt.ovR, yTop = opt.fit ? opt.fit.yTop : yMax + opt.wall, yBot = opt.fit ? opt.fit.yBot : yMin - opt.wall;
    const teX = P => Math.max(P[0].x, P[M - 1].x), edge = edgeFn(W, opt, xF0, xR0);
    /* Nasen-Huckel: U-förmige Erhebung auf dem Formenrand (Trennfläche), die direkt an der Nasenleiste ansetzt
     * und das Profil nach vorn verlängert (kein Absatz, kein Abstand zur Nase),
     * die mit dem Rand um den Randbogen herumläuft. Sie wird nach dem Füllern und Polieren der Form wieder
     * weggeschliffen — es bleibt eine scharfe Kante, Ober- und Unterschale passen dadurch genau aufeinander.
     * Richtung: obere Hälfte nach unten (−y), untere nach oben (+y), also jeweils aus der Trennfläche heraus. */
    const hk = opt.hk || {}, HN = 9;
    const hkOn = !!(hk.on && hk.w > 0 && hk.h > 0 && hk.w + 1 <= opt.ovF);
    // Innenkante = Nasenpunkt des Rings selbst; nur die Außenkante folgt bei 'offset' der Nasenlinie.
    const gHo = hkOn && opt.edge === 'offset' ? edge.off(hk.w, hk.w, false) : null;
    /* Blutrinne: Nut im Formenrand hinter der Endleiste, im Abstand bl.dist, Querschnitt Halbkreis oder U.
     * Sie nimmt beim Schließen der Form das austretende Harz auf. In der Negativform ist sie eine Nut
     * (in das Material hinein), am geteilten Urmodell eine Wulst (siehe splitRings). */
    const bl = opt.blut || {}, BN = 9;
    const blOn = !!(bl.on && bl.w > 0 && bl.d > 0 && bl.dist + bl.w + 1 <= opt.ovR);
    const blFac = tipFade(W, bl.tip, bl.wedge);
    const blProf = t => { const a = Math.abs(2 * t - 1); if (bl.shape === 'u') { const u = Math.min(1, (1 - a) / 0.25); return u * u * (3 - 2 * u); } return Math.sqrt(Math.max(0, 1 - a * a)); };
    // Lage der Rinne: in Sehnenrichtung hinter der Endleiste des Rings — sie läuft damit genau entlang der
    // Endleiste und nicht darüber hinaus. In den Überständen (flat) bleiben ihre Punkte eben -> Stirnwand.
    const blBand = P => { const xt = teX(P); return { xi: xt + bl.dist, xo: xt + bl.dist + bl.w }; };
    // y0(x): Höhe der Trennfläche an der Stelle x (vor der Nase bzw. hinter der Endleiste, ggf. geneigt)
    // Lage der Blutrinne (Innen-/Außenkante) je Ring — auch für die Flanschpunkte hinter der Rinne (subF) gebraucht
    const blX = (P, xR, xTe) => {
      const B = blBand(P), av = xR - xTe;
      if (av < 1) return { xi: xTe + 0.2 * av, xo: xTe + 0.8 * av, av };
      let xi = Math.max(B.xi, xTe + 0.2), xo = Math.max(B.xo, xi + 0.2);
      xo = Math.min(xo, xR - 0.2); xi = Math.min(xi, xo - 0.2); xi = Math.max(xi, xTe + 0.1);
      return { xi, xo, av };
    };
    const blPts = (P, xR, xTe, y0, dir, rev, flat, bf) => {
      const { xi, xo, av } = blX(P, xR, xTe);
      if (av < 1) { const L0 = []; for (let j = 0; j < BN; j++) { const x = xTe + av * (0.2 + 0.6 * j / (BN - 1)); L0.push({ x, y: y0(x) }); } return rev ? L0.reverse() : L0; }
      const d = flat ? 0 : bl.d * (bf == null ? 1 : bf) * Math.max(0, Math.min(1, (xo - xi) / bl.w)), L = [];
      for (let j = 0; j < BN; j++) { const t = j / (BN - 1), x = xi + (xo - xi) * t; L.push({ x, y: y0(x) + dir * d * blProf(t) }); }
      return rev ? L.reverse() : L;
    };
    /* Flanschpunkte (NX Stück, streng zwischen xa und xb, in dieser Reihenfolge) auf der Trennfläche y0(x): nur beim
     * Verlauf 'follow' (sonst NX = 0), damit der in Flugrichtung gekrümmte Flansch am Randbogen abgebildet wird. */
    const NX = ps.NX || 0;
    const subF = (xa, xb, y0) => ps.flangeX(xa, xb).map(x => ({ x, y: y0(x) }));
    // Lage des Huckels (Außen-/Innenkante) je Ring — auch für die Flanschpunkte vor dem Huckel (subF) gebraucht
    const hkX = (P, z, xF) => {
      let xi = P[iLE].x, xo = xi - hk.w;
      if (gHo) { const O = gHo.at(Math.abs(z)); if (O) xo = O.xF; }
      const xN = P[iLE].x, av = xN - xF;
      if (av < 1) return { xi: xF + 0.8 * av, xo: xF + 0.2 * av, av };
      xi = Math.min(xi, xN); xo = Math.min(xo, xi - 0.2);
      xo = Math.max(xo, xF + 0.2); xi = Math.max(xi, xo + 0.2); xi = Math.min(xi, xN);
      return { xi, xo, av };
    };
    const hkPts = (P, z, xF, y0, dir, rev, hf) => {
      if (hf == null) hf = 1;
      // Innenkante liegt exakt auf dem Nasenpunkt: der Huckel setzt ohne Absatz am Profil an.
      /* Der Huckel muss immer zwischen Formenrand (xF) und Trennlinienpunkt (Nase) liegen: hinter dem
       * Randbogen läuft die Kontur auf den Rand zu, dort bleibt nur noch ein schmaler Streifen. Punkte
       * nie zusammenfallen lassen (sonst entartete Dreiecke) und die Höhe mit der Restbreite auslaufen. */
      const { xi, xo, av } = hkX(P, z, xF);
      if (av < 1) { const L0 = []; for (let j = 0; j < HN; j++) { const x = xF + av * (0.2 + 0.6 * j / (HN - 1)); L0.push({ x, y: y0(x) }); } return rev ? L0.reverse() : L0; }
      const h = hk.h * hf * Math.max(0, Math.min(1, (xi - xo) / hk.w)), L = [];
      // letzter Punkt (t = 1) faellt auf den Nasenpunkt -> weglassen, sonst doppelter Punkt im Ring
      for (let j = 0; j < HN - 1; j++) {
        const t = j / (HN - 1), a = Math.abs(2 * t - 1), u = Math.min(1, (1 - a) / 0.25), x = xo + (xi - xo) * t;
        L.push({ x, y: y0(x) + dir * h * u * u * (3 - 2 * u) });
      }
      return rev ? L.reverse() : L;
    };
    const poly = (P, z, E, flat, hf, bf) => {
      const LE = P[iLE], out = [], { xF, xR } = E || edge(P, z), xm = (LE.x + teX(P)) / 2;
      // Trennfläche hinten auf der Sehnenmitte der Endleiste (yM); tp.x = Auftreffpunkt der Profilhälfte
      // Keil der Endleiste ('blend') darf nicht in die Blutrinne laufen
      const tp = teParting(P, half === 'top', opt.teEdge, blOn ? Math.min(xR - 1, blBand(P).xi - 0.5) : xR - 1);
      // Trennfläche vor der Nase / hinter der Endleiste (waagrecht oder geneigt), innerhalb der Formwände gehalten
      const clampY = y => Math.min(yTop - 1, Math.max(yBot + 1, y));
      const yFx = x => clampY(ps.yF(LE, x, P)), yRx = x => clampY(ps.yR(tp, x, P));
      // Flanschpunkte (follow): vorn zwischen Formenrand und Huckel bzw. Nase, hinten zwischen Blutrinne bzw. Auftreffpunkt und Formenrand
      const xEndF = hkOn ? hkX(P, z, xF).xo : LE.x, xStartR = blOn ? blX(P, xR, tp.x).xo : tp.x;
      // Zwischenpunkt xm auf der Rückseite: trennt vorderen und hinteren Flansch (Passlöcher je in einem eigenen Streifen)
      if (half === 'top') {
        out.push({ x: xR, y: yRx(xR) }, { x: xR, y: yTop }, { x: xm, y: yTop }, { x: xF, y: yTop }, { x: xF, y: yFx(xF) });
        out.push(...subF(xF, xEndF, yFx));
        if (hkOn) out.push(...hkPts(P, z, xF, yFx, -1, false, hf));
        for (let i = iLE; i >= 0; i--) out.push({ x: P[i].x, y: P[i].y });
        out.push({ x: tp.x, y: tp.yM });
        if (blOn) out.push(...blPts(P, xR, tp.x, yRx, 1, false, flat, bf));
        out.push(...subF(xStartR, xR, yRx));
      } else {
        out.push({ x: xF, y: yFx(xF) }, { x: xF, y: yBot }, { x: xm, y: yBot }, { x: xR, y: yBot }, { x: xR, y: yRx(xR) });
        out.push(...subF(xR, xStartR, yRx));
        if (blOn) out.push(...blPts(P, xR, tp.x, yRx, -1, true, flat, bf));
        out.push({ x: tp.x, y: tp.yM });
        for (let i = M - 1; i >= iLE; i--) out.push({ x: P[i].x, y: P[i].y });
        if (hkOn) out.push(...hkPts(P, z, xF, yFx, 1, true, hf));
        out.push(...subF(xEndF, xF, yFx));
      }
      return out;
    };
    const ring = (P, z, flat, hf, bf) => Object.assign({ pts: poly(P, z, null, flat, hf, bf), z }, edge(P, z));
    /* Huckel-Verlauf am Randbogen: Faktor auf die Huckelhöhe je Profilring. Bis zur letzten Rippe voll,
     * im Randbogen nur noch über hk.tip % seiner Länge; die letzten hk.wedge % laufen als Keil auf 0 aus.
     * Hinter dem Randbogen (kollabierte Ringe / Überstand auf der Trennebene) immer 0 — der Huckel darf
     * nie auf die Trennebene hinauslaufen. */
    const hkFac = tipFade(W, hk.tip, hk.wedge);
    // Kontur auf die Trennlinie (Nase -> Endleiste) kollabiert: für Überstand-Ringe
    // vor der Wurzel und hinter dem Randbogen.
    // (Trennlinie Nase -> Sehnenmitte der Endleiste; beide Endleistenpunkte auf die Mitte, damit yM stimmt)
    /* Steckungs-Ausnehmungen (Wurzelverlängerung): Trennlinienpunkte der Wurzelrippe laufen um den
     * an der Trennlinie abgeschnittenen Querschnitt herum (deep) bzw. flach mit gleicher Aufteilung. */
    /* Bauteil „nur Randbogen / Winglet“: an dessen Wurzel (= Trennebene zur Tragfläche) gilt die
     * Anschluss-Steckung (formStkT), sonst die Tragflächensteckung an der Wurzelrippe. */
    const stkSrc = W.part === 'tip' ? opt.stkT : opt.stk;
    const stk = stkSrc && stkSrc.on && opt.ovRoot > 0 ? stkChord(rings[0].pts, half === 'top', opt.teEdge, stkSrc) : null;
    const stkRun = stk && stk.run;
    /* Gegenstück am Außenende des Bauteils „nur Tragfläche“: dieselbe Liste, dieselbe Lage (bezogen auf die
     * Nase der letzten Rippe) — Tragflächen- und Randbogenform bekommen damit deckungsgleiche Ausnehmungen. */
    const stkE = opt.stkT && opt.stkT.on && W.part === 'wing' ? stkChord(rings[rings.length - 1].pts, half === 'top', opt.teEdge, opt.stkT) : null;
    const stkERun = stkE && stkE.run;
    const collapsed = (P, deep, run) => {
      const LE = P[iLE], TE = teRef(P, half === 'top', opt.teEdge), Q = P.slice(); Q.psTip = P.psTip;
      if (half === 'top') for (let i = 0; i <= iLE; i++) { const t = iLE ? i / iLE : 0; Q[i] = { x: LE.x + (TE.x - LE.x) * (1 - t), y: LE.y + (TE.y - LE.y) * (1 - t) }; }
      else for (let i = iLE; i < M; i++) { const t = (i - iLE) / ((M - 1 - iLE) || 1); Q[i] = { x: LE.x + (TE.x - LE.x) * t, y: LE.y + (TE.y - LE.y) * t }; }
      const R0 = run || stkRun;
      if (R0 && deep) { const R = R0(deep), o = half === 'top' ? 0 : iLE; for (let i = 0; i < R.length; i++) Q[o + i] = R[i]; }
      Q[0] = { x: TE.x, y: TE.y }; Q[M - 1] = { x: TE.x, y: TE.y };
      return Q;
    };
    const out = [];
    const first = rings[0], last = rings[rings.length - 1];
    if (opt.ovRoot > 0) {
      if (!stkRun) { const Q = collapsed(first.pts); out.push(ring(Q, first.z - opt.ovRoot, true, 1)); out.push(ring(Q, first.z, true, 1)); }
      else for (const e of stkLevels(stk.lens, opt.ovRoot)) out.push(ring(collapsed(first.pts, e.deep), first.z - e.dz, true, 1));
    }
    const nExt = out.length;   // Ringe der Wurzelverlängerung (Ringband der Formfläche beginnt am letzten davon)
    rings.forEach((r, k) => out.push(ring(r.pts, r.z, false, hkFac(k), blFac(k))));
    let hasTip = false;
    const off = opt.edge === 'offset', zEndTip = off ? (edge.zEnd > last.z + 0.3 ? edge.zEnd - 0.1 : null) : (opt.ovTip > 0 && ps.tan ? last.z + opt.ovTip : null);
    if (zEndTip != null) {
      // Rand folgt der Kontur (oder die Trennfläche läuft tangential weiter): Ringe bis zum Ende des Überstands
      // hinter der Spitze (dicht zum Ende hin); die Trennlinie spannt dort von xF bis xR (Höhe auf der Linie
      // Nase -> Endleiste der letzten Rippe, plus tangentialem Verlauf ps.tipDy).
      const LE = last.pts[iLE], TE = teRef(last.pts, half === 'top', opt.teEdge), zEnd = zEndTip;
      const tAt = x => Math.abs(TE.x - LE.x) > 1e-9 ? Math.max(0, Math.min(1, (x - LE.x) / (TE.x - LE.x))) : 0;
      const yAt = (x, s) => { const t = tAt(x); return LE.y + (TE.y - LE.y) * t + ps.tipDy(s, t) * ps.tipFade(x, LE, TE); };
      /* Anschluss-Steckung: die Ausnehmungen laufen in den Rand hinter der letzten Rippe hinein (höchstens
       * 60 % davon, damit für den auslaufenden Rand genug übrig bleibt) und enden dort mit einer Stirnwand. */
      const zStk = stkERun ? Math.min(Math.max.apply(null, stkE.lens), Math.max(0, zEnd - last.z) * 0.6) : 0;
      if (zStk > 0.3) for (const e of stkLevels(stkE.lens, zStk).slice().reverse()) out.push(ring(collapsed(last.pts, e.deep, stkERun), last.z + e.dz, true, 0));
      else out.push(ring(collapsed(last.pts), last.z, true, 0));
      const zA = zStk > 0.3 ? last.z + zStk : last.z;
      const K = Math.max(14, Math.min(60, Math.round((zEnd - zA) / Math.max(0.5, opt.ringMm || 5))));
      for (let k = 1; k <= K; k++) {
        const z = zA + (zEnd - zA) * Math.sin(Math.PI / 2 * k / K), E = edge(last.pts, z), d = (E.xR - E.xF) * 0.02, Q = last.pts.slice(); Q.psTip = last.pts.psTip;
        /* Die Kavität endet mit einer Stirnwand an der letzten Rippe; dahinter ist die Form nur noch
         * Rand. Die Trennlinienpunkte bleiben deshalb im Sehnenband der letzten Rippe (LE..TE) statt
         * über den ganzen Rand gespreizt zu werden — der Formenrand läuft damit hinter dem Randbogen
         * eben in Verlängerung des übrigen Randes weiter (vorn auf Nasenhöhe, hinten auf der
         * Sehnenmitte der Endleiste) und schwingt nicht mehr durch. */
        let x0 = Math.min(Math.max(LE.x, E.xF + d), E.xR - d), x1 = Math.max(Math.min(TE.x, E.xR - d), E.xF + d);
        if (x1 - x0 < 0.2) { const c = (x0 + x1) / 2; x0 = c - 0.1; x1 = c + 0.1; }
        const s = z - zA;
        for (let i = 0; i < M; i++) { const t = half === 'top' ? (iLE ? 1 - Math.min(i, iLE) / iLE : 0) : Math.min(1, Math.max(0, i - iLE) / ((M - 1 - iLE) || 1)); const x = x0 + (x1 - x0) * t; Q[i] = { x, y: Math.min(yTop - 1, Math.max(yBot + 1, yAt(x, s))) }; }
        if (half === 'top') Q[M - 1] = Q[0]; else Q[0] = Q[M - 1];   // Endleistenpunkte gemeinsam auf der Trennlinie
        out.push(Object.assign({ pts: poly(Q, z, E, true, 0), z }, E));
      }
      hasTip = true;
    } else if (opt.ovTip > 0) {
      if (stkERun) for (const e of stkLevels(stkE.lens, opt.ovTip).slice().reverse()) out.push(ring(collapsed(last.pts, e.deep, stkERun), last.z + e.dz, true, 0));
      else { const Q = collapsed(last.pts), zEnd = last.z + opt.ovTip; out.push(ring(Q, last.z, true, 0)); out.push(ring(Q, zEnd, true, 0)); }
      hasTip = true;
    }
    // Formfläche: Streifen zwischen den Profilpunkten (nach den 5 Randpunkten), Ringbänder vom kollabierten
    // Ring an der Wurzel bis zum kollabierten Ring am Ende (Stirnwände der Kavität zählen zur Fläche).
    const np = half === 'top' ? iLE + 1 : M - iLE, r0 = opt.ovRoot > 0 ? nExt - 1 : 0;
    const i0 = half === 'top' ? 5 + NX + (hkOn ? HN : 0) : 6 + NX + (blOn ? BN : 0);
    const surf = { i0, i1: i0 + np - 2, r0, r1: r0 + rings.length - 1 + (hasTip ? 1 : 0), tip: tipBands(W, r0 + (nExt ? 1 : 0), rings.length, false) };
    return { rings: out, box: { xF: xF0, xR: xR0, yTop, yBot }, surf, stk: stk ? { placed: stk.placed, skipped: stk.skipped } : null,
      stkE: stkE ? { placed: stkE.placed, skipped: stkE.skipped } : null };
  }
  // Tag-Funktion für loft(): 0 (Formfläche) innerhalb des Streifen-/Ringband-Bereichs surf, sonst 1 (Rand/Hinterbau).
  function surfTag(sf) { return (i, r) => (sf && i >= sf.i0 && i <= sf.i1 && r >= sf.r0 && r < sf.r1) ? (sf.tip && sf.tip(r) ? 2 : 0) : 1; }
  /* Randbogen-Bänder der Formfläche: rp = Index des ersten Profilrings in der Ringliste, n = Zahl der
   * Profilringe (bei Spiegelung 2·N−1). Band r liegt zwischen Ring r und r+1; es zählt zum Randbogen, wenn
   * einer seiner Ringe (Originalindex) ≥ W.tipStart liegt – inkl. Stirnwand am Randbogen-Ende. */
  function tipBands(W, rp, n, mirror) {
    const N = W.rings.length, ts = W.tipStart;
    if (N <= ts + 1 || W.part === 'tip') return null;   // kein Randbogen (bzw. das ganze Teil ist der Randbogen)
    const orig = k => mirror ? (k < N - 1 ? N - 1 - k : k - (N - 1)) : k;
    return r => { const k = r - rp; return Math.min(orig(Math.max(0, Math.min(n - 1, k))), orig(Math.max(0, Math.min(n - 1, k + 1)))) >= ts; };
  }
  function buildMold(W, opt, half) {
    const mr = moldRings(W, opt, half);
    const m = new Mesh();
    m.holes = loftHoles(m, mr.rings, holeSpots(mr.rings, opt, W), opt, surfTag(mr.surf));
    cap(m, mr.rings[0], false, 1);
    cap(m, mr.rings[mr.rings.length - 1], true, 1);
    m.stk = mr.stk; m.stkE = mr.stkE;
    return m;
  }

  /* Passlöcher: Lochmitten (x, z) im Flansch bzw. in der Trennplatte, gleich für beide Hälften
   * (aus Formenrand xF/xR je Ring und Spannweitenlage abgeleitet). */
  function holeSpots(rings, opt, W) {
    const h = opt.holes;
    if (!h || !h.on || h.n < 1 || rings.length < 2) return [];
    const z0 = rings[0].z, z1 = rings[rings.length - 1].z;
    const edgeAt = z => {
      let j = 0; while (j < rings.length - 2 && rings[j + 1].z < z) j++;
      const A = rings[j], B = rings[j + 1], dz = B.z - A.z, t = dz > 1e-9 ? Math.min(1, Math.max(0, (z - A.z) / dz)) : 0;
      return { xF: A.xF + (B.xF - A.xF) * t, xR: A.xR + (B.xR - A.xR) * t };
    };
    const out = [];
    const put = z => { const E = edgeAt(z); if (h.sides !== 'rear') out.push({ x: E.xF + h.x, z, side: 'front' }); if (h.sides !== 'front') out.push({ x: E.xR - h.x, z, side: 'rear' }); };
    // Je Druckstück: eigene Anzahl (formHolePer, sonst h.n), gleichmäßig innerhalb des Stücks mit Randabstand zu beiden Trennstellen.
    const knots = h.seg ? [z0].concat(segPlanes(null, [z0, z1], { stations: (W && W.stations) || [], mirror: !!opt.mirror, part: opt.part }), [z1]) : [z0, z1];
    for (let s = 0; s < knots.length - 1; s++) {
      const a = knots[s], b = knots[s + 1], L = b - a, e = Math.min(h.end, L / 2);
      const q = h.seg ? +h.per[s] : NaN, n = q >= 0 ? Math.min(50, Math.round(q)) : h.n;
      for (let k = 0; k < n; k++) put(n === 1 ? (a + b) / 2 : a + e + (L - 2 * e) * k / (n - 1));
    }
    return out;
  }
  /* Loft mit senkrechten Bohrungen (Achse y). Je Loch werden die beiden Flächenstreifen (Ring-
   * punkt i -> i+1) gesucht, die den Lochkreis samt Rand über ein Ringband [ja, jb] vollständig
   * enthalten (Ober- und Unterseite des Flansches). Dort entfallen die Loft-Vierecke; das Band wird
   * als Ring um den Kreis neu vernetzt (Reißverschluss nach Winkel um die Lochmitte, keine neuen
   * Randpunkte -> keine T-Stöße), dazu die Zylinderwand. Löcher, die nicht passen, werden ausgelassen. */
  function loftHoles(mesh, rings, holes, opt, tagFn) {
    const res = { placed: 0, skipped: 0 };
    if (!holes.length) { loft(mesh, rings, null, tagFn); return res; }
    const r = opt.holes.d / 2, m = Math.max(1, r * 0.35), n = rings[0].pts.length, NR = rings.length;
    const N = Math.max(16, Math.round(Math.PI * 2 * r / 1.2)), skip = new Set(), jobs = [], used = [];
    const surfY = (i, ja, jb, x, z) => {
      const k = (i + 1) % n;
      for (let j = ja; j < jb; j++) {
        const A = rings[j], B = rings[j + 1], dz = B.z - A.z;
        if (dz <= 1e-9 || z < A.z - 1e-9 || z > B.z + 1e-9) continue;
        const t = (z - A.z) / dz, a0 = A.pts[i], a1 = A.pts[k], b0 = B.pts[i], b1 = B.pts[k];
        const Lx = a0.x + (b0.x - a0.x) * t, Ly = a0.y + (b0.y - a0.y) * t, Rx = a1.x + (b1.x - a1.x) * t, Ry = a1.y + (b1.y - a1.y) * t;
        const s = Math.abs(Rx - Lx) > 1e-9 ? (x - Lx) / (Rx - Lx) : 0;
        return Ly + s * (Ry - Ly);
      }
      return rings[ja].pts[i].y;
    };
    for (const h of holes) {
      const zA = h.z - r - m, zB = h.z + r + m;
      let ja = -1, jb = -1;
      for (let j = 0; j < NR; j++) if (rings[j].z <= zA) ja = j;
      for (let j = NR - 1; j >= 0; j--) if (rings[j].z >= zB) jb = j;
      if (ja < 0 || jb < 0 || jb <= ja) { res.skipped++; continue; }
      // Ringband mit geneigten Ringen (Punkte mit eigener z-Koordinate, z. B. geneigte Endrippe): senkrechtes Loch passt nicht -> auslassen
      const tilted = rings.slice(ja, jb + 1).some(R => R.pts.some(p => p.z != null));
      if (tilted) { res.skipped++; continue; }
      const strips = [];
      for (let i = 0; i < n; i++) {
        const k = (i + 1) % n; let ok = true;
        for (let j = ja; j <= jb && ok; j++) {
          const a = rings[j].pts[i].x, b = rings[j].pts[k].x, lo = Math.min(a, b), hi = Math.max(a, b);
          if (!(lo + m <= h.x - r && h.x + r <= hi - m)) ok = false;
        }
        if (ok) strips.push(i);
      }
      if (strips.length !== 2 || strips.some(i => used.some(u => u.i === i && u.ja < jb && ja < u.jb))) { res.skipped++; continue; }
      for (const i of strips) { used.push({ i, ja, jb }); for (let j = ja; j < jb; j++) skip.add(i * 1000000 + j); }
      const faces = strips.map(i => {
        const pts = [];
        for (let q = 0; q < N; q++) { const th = 2 * Math.PI * q / N, x = h.x + r * Math.cos(th), z = h.z + r * Math.sin(th); pts.push([x, surfY(i, ja, jb, x, z), z]); }
        return { i, pts };
      });
      jobs.push({ h, ja, jb, faces });
      res.placed++;
    }
    loft(mesh, rings, skip, tagFn);
    const nrm = (a, b, c) => { const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]; };
    for (const job of jobs) {
      const { h, ja, jb, faces } = job, cx = h.x, cz = h.z;
      for (const f of faces) {
        const i = f.i, k = (i + 1) % n;
        // Vorzeichen der Flächennormale (y) aus einem nicht entarteten Original-Viereck des Bandes
        let sg = 0;
        for (let j = ja; j < jb && !sg; j++) { const nn = nrm(v3(rings[j], i), v3(rings[j], k), v3(rings[j + 1], k)); if (Math.abs(nn[1]) > 1e-9) sg = Math.sign(nn[1]); }
        if (!sg) sg = 1;
        // Außenpolygon des Bandes: linke Polylinie (Punkt i) hin, rechte (Punkt k) zurück
        const O = [];
        for (let j = ja; j <= jb; j++) O.push(v3(rings[j], i));
        for (let j = jb; j >= ja; j--) O.push(v3(rings[j], k));
        let area = 0; for (let q = 0; q < O.length; q++) { const a = O[q], b = O[(q + 1) % O.length]; area += (a[0] - cx) * (b[2] - cz) - (b[0] - cx) * (a[2] - cz); }
        if (area < 0) O.reverse();
        const emit = (a, b, c) => { const nn = nrm(a, b, c); if (nn[1] * sg < 0) mesh.tri(a, c, b, 1); else mesh.tri(a, b, c, 1); };
        zipper(O, f.pts, cx, cz, emit);
      }
      // Zylinderwand zwischen den beiden Flächen, Normale zur Lochachse hin
      const yAvg = f => f.pts.reduce((s, p) => s + p[1], 0) / f.pts.length;
      const top = yAvg(faces[0]) >= yAvg(faces[1]) ? faces[0] : faces[1], bot = top === faces[0] ? faces[1] : faces[0];
      for (let q = 0; q < N; q++) {
        const q1 = (q + 1) % N, T0 = top.pts[q], T1 = top.pts[q1], B0 = bot.pts[q], B1 = bot.pts[q1];
        const nn = nrm(T0, T1, B1), mx = (T0[0] + B1[0]) / 2, mz = (T0[2] + B1[2]) / 2;
        const inward = nn[0] * (cx - mx) + nn[2] * (cz - mz) > 0;
        if (inward) { mesh.tri(T0, T1, B1, 1); mesh.tri(T0, B1, B0, 1); } else { mesh.tri(T0, B1, T1, 1); mesh.tri(T0, B0, B1, 1); }
      }
    }
    return res;
  }
  // Ringfläche zwischen Außenpolygon O (sternförmig um (cx,cz)) und Innenpolygon I (konvex), beide
  // CCW in der x/z-Ebene, als Dreiecke; Punkte [x,y,z]. Reißverschluss nach Winkel.
  function zipper(O, I, cx, cz, emit) {
    // Beide Polygone ab einem gemeinsamen Basiswinkel (erster Außenpunkt) monoton aufsteigend
    // sortieren; das Innenpolygon beginnt beim ersten Punkt >= Basiswinkel.
    const TAU = Math.PI * 2;
    const prep = (P, base) => {
      const ang = P.map(p => { let a = Math.atan2(p[2] - cz, p[0] - cx); if (base != null) { while (a < base) a += TAU; while (a >= base + TAU) a -= TAU; } return a; });
      let i0 = 0; for (let q = 1; q < P.length; q++) if (ang[q] < ang[i0]) i0 = q;
      const Q = P.slice(i0).concat(P.slice(0, i0)), A = ang.slice(i0).concat(ang.slice(0, i0));
      for (let q = 1; q < A.length; q++) while (A[q] < A[q - 1]) A[q] += TAU;
      A.push(A[0] + TAU);
      return { Q, A };
    };
    const o = prep(O, null), s = prep(I, o.A[0]), nO = o.Q.length, nI = s.Q.length;
    // Signierte Fläche in x/z (> 0 = CCW). Ein Fächerdreieck (Außenpunkt, Sehne) ist nur gültig,
    // wenn der Außenpunkt außerhalb der Sehnengeraden liegt; ein Dreieck (Außenkante, Innenpunkt)
    // nur, wenn der Innenpunkt von beiden Außenpunkten aus sichtbar ist (sonst schneidet eine
    // Kante den Kreis). Bei großen Außenkanten würde die reine Winkelregel sonst umklappen.
    const ar = (a, b, c) => (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
    const inner = q => s.Q[((q % nI) + nI) % nI];
    const vis = (P, q) => ar(P, inner(q + 1), inner(q)) > 1e-12 || ar(P, inner(q), inner(q - 1)) > 1e-12;
    let i = 0, j = 0;
    while (i < nO || j < nI) {
      const canO = i < nO, canI = j < nI;
      const oa = o.Q[i % nO], ob = o.Q[(i + 1) % nO], ia = inner(j), ib = inner(j + 1);
      const okA = canO && ar(oa, ob, ia) > 1e-12 && vis(oa, j) && vis(ob, j);
      const okB = canI && ar(oa, ib, ia) > 1e-12;
      let useA;
      if (okA && okB) useA = o.A[i + 1] <= s.A[j + 1];
      else if (okA || okB) useA = okA;
      else useA = canO && (!canI || o.A[i + 1] <= s.A[j + 1]);
      if (useA) { emit(oa, ob, ia); i++; } else { emit(oa, ib, ia); j++; }
    }
  }

  /* Geteiltes Urmodell (abformbar): Profilhälfte (oben/unten, Trennung Nase–Endleiste)
   * sitzt auf einer ebenen Trennplatte mit Formenüberstand rundum. Optional eine Sicke
   * (Rechtecknut) in der Plattenoberseite: vor der Nase, um den Randbogen herum und
   * hinter der Endleiste — auf der abgenommenen Form entsteht daraus eine Wulst, die
   * abgeschliffen wird und eine scharfe Formkante ergibt. Ringe gleicher Punktzahl. */
  function splitRings(W, opt, half) {
    const ps = partingSpec(W, opt);
    let rings = W.rings;
    if (opt.mirror) rings = rings.slice(1).reverse().map(r => ({ pts: r.pts, z: -r.z })).concat(rings);
    const M = rings[0].pts.length, iLE = leIndex(M), top = half === 'top', sg = top ? 1 : -1;
    let xMin = Infinity, xMax = -Infinity, yPart = top ? Infinity : -Infinity;
    for (const r of rings) {
      const P = r.pts, LE = P[iLE], TE = teRef(P, top, opt.teEdge);
      for (const p of P) { if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x; }
      yPart = top ? Math.min(yPart, LE.y, TE.y) : Math.max(yPart, LE.y, TE.y);
    }
    const xF0 = xMin - opt.ovF, xR0 = xMax + opt.ovR, yBase = yPart - sg * opt.plateT;
    const teX = P => Math.max(P[0].x, P[M - 1].x), edge = edgeFn(W, opt, xF0, xR0);
    const w = opt.sickeW, dep = Math.min(opt.sickeD, opt.plateT - 1);
    const dF = Math.min(opt.sickeDist, opt.ovF - w - 1), dR = Math.min(opt.sickeDist, opt.ovR - w - 1);
    const sk = opt.sicke && w > 0 && dep > 0 && dF >= 0 && dR >= 0, full = opt.sickeRun === 'all';
    /* Verlauf am Randbogen (wie beim Nasen-Huckel der Negativform): Sicke und Blutrinnen-Wulst laufen über
     * den Randbogen aus und nie auf die ebene Trennplatte dahinter. Bei gespiegeltem Modell zeigt orig() auf
     * den Ring des Originals. */
    const NW = W.rings.length, origK = k => opt.mirror ? (k < NW - 1 ? NW - 1 - k : k - (NW - 1)) : k;
    const fSk = tipFade(W, opt.sickeTip, opt.sickeWedge), fBl = tipFade(W, opt.blut.tip, opt.blut.wedge);
    const skFac = k => fSk(origK(k)), blFac = k => fBl(origK(k));
    // Sicke U-förmig (Halbellipse: Breite w, Tiefe dep), NG Punkte je Sicke (konstant je Ring).
    // dl: Absenkung der Fläche zwischen den Sicken (Quer-Sicke hinter dem Randbogen, 0..dep).
    const NG = 9;
    // Flanschpunkte auf der Trennfläche (nur Verlauf 'follow', sonst NX = 0): streng zwischen xa und xb
    const NX = ps.NX || 0;
    const subF = (xa, xb, y0) => ps.flangeX(xa, xb).map(x => ({ x, y: y0(x) }));
    // y0: Höhe der Plattenoberseite — Zahl oder Funktion y0(x) (geneigte Trennfläche)
    const yAtX = (y0, x) => typeof y0 === 'function' ? y0(x) : y0;
    const uArc = (xOuter, xInner, y0, dl, sf) => {   // von außen nach innen, außen oben beginnend
      const pts = [], cx = (xOuter + xInner) / 2, dirIn = Math.sign(xInner - xOuter) || 1, hw = Math.abs(xInner - xOuter) / 2;
      const dp = dep * (sf == null ? 1 : sf);
      for (let j = 0; j < NG; j++) {
        const th = Math.PI * j / (NG - 1);
        const x = cx - dirIn * hw * Math.cos(th);
        let d = dp * Math.sin(th);
        if (th > Math.PI / 2 + 1e-9) d = Math.max(d, dl);   // innere Flanke geht in die abgesenkte Fläche über
        pts.push({ x, y: yAtX(y0, x) - sg * d });
      }
      return pts;
    };
    // Sickenlage (außen/innen vorn, innen/außen hinten): Rand 'offset' -> Parallel-Offset des Grundrisses
    // (läuft um den Randbogen mit), sonst in Sehnenrichtung ab Nase/Endleiste.
    /* Blutrinne: sie muss sich vom Urmodell abformen lassen und steht deshalb hier als WULST auf der
     * Trennplatte hinter der Endleiste (in der Negativform ergibt sich daraus die Nut). Querschnitt
     * Halbkreis oder U, Abstand zur Endleiste einstellbar. */
    const NB = 9, bw = opt.blut.w, bd = opt.blut.d;
    const blOn = !!(opt.blut.on && bw > 0 && bd > 0 && opt.blut.dist + bw + 1 <= opt.ovR);
    const blProf = t => { const a = Math.abs(2 * t - 1); if (opt.blut.shape === 'u') { const u = Math.min(1, (1 - a) / 0.25); return u * u * (3 - 2 * u); } return Math.sqrt(Math.max(0, 1 - a * a)); };
    // Lage: in Sehnenrichtung hinter der Endleiste des Rings — die Wulst läuft damit genau entlang der
    // Endleiste und nicht darüber hinaus; in den Überständen (flat) bleiben die Punkte eben (Stirnwand).
    const blBand = P => { const xt = teX(P); return { xi: xt + opt.blut.dist, xo: xt + opt.blut.dist + bw }; };
    // Wulst von außen (xo) nach innen (xi), Basis auf der (ggf. um dl abgesenkten) Plattenoberseite
    const bArc = (xo, xi, y0, dl, flat, bf) => {
      const pts = [], h = flat ? 0 : bd * (bf == null ? 1 : bf);
      for (let j = 0; j < NB; j++) { const t = j / (NB - 1), x = xo + (xi - xo) * t; pts.push({ x, y: yAtX(y0, x) - sg * dl + sg * h * blProf(t) }); }
      return pts;
    };
    const gIn = sk && opt.edge === 'offset' ? edge.off(dF, dR, full) : null, gOut = gIn ? edge.off(dF + w, dR + w, full) : null;
    const grooveAt = (P, z) => {
      const LE = P[iLE], TE = teRef(P, top, opt.teEdge), I = gIn && gIn.at(Math.abs(z)), O = I && gOut.at(Math.abs(z));
      if (I && O) return { xFo: O.xF, xFi: I.xF, xRi: I.xR, xRo: O.xR };
      return { xFo: LE.x - dF - w, xFi: LE.x - dF, xRi: TE.x + dR, xRo: TE.x + dR + w };
    };
    const poly = (P, dl, z, E, flat, sf, bf) => {
      const LE = P[iLE], yL = LE.y, { xF, xR } = E || edge(P, z), xm = (LE.x + teX(P)) / 2, G = grooveAt(P, z);
      const skR = sk && (full || dl > 0);   // Sicke hinter der Endleiste vorhanden?
      // Blutrinnen-Wulst zwischen Auftreffpunkt der Profilhälfte und Sicke bzw. Formenrand
      let bo = 0, bi = 0;
      if (blOn) { const B = blBand(P); bo = Math.min(B.xo, (skR ? G.xRi : xR) - 0.2); bi = Math.min(B.xi, bo - 0.2); }
      // Trennfläche hinten auf der Sehnenmitte der Endleiste (yT); tp.x = Auftreffpunkt der Profilhälfte
      const lim = Math.min(sk ? G.xRi - 0.5 : xR - 1, blOn ? bi - 0.5 : Infinity);
      const tp = teParting(P, top, opt.teEdge, lim), yT = tp.yM;
      if (blOn) { bi = Math.max(bi, tp.x + 0.2); bo = Math.max(bo, bi + 0.2); }
      // Trennfläche vor der Nase / hinter der Endleiste (waagrecht oder geneigt), mindestens 1 mm über der Plattenunterseite
      const clampY = y => top ? Math.max(yBase + 1, y) : Math.min(yBase - 1, y);
      const yFx = x => clampY(ps.yF(LE, x, P)), yRx = x => clampY(ps.yR(tp, x, P));
      const out = [{ x: xF, y: yFx(xF) }, { x: xF, y: yBase }, { x: xm, y: yBase }, { x: xR, y: yBase }, { x: xR, y: yRx(xR) }];
      // Flanschpunkte (follow) hinten: vom Formenrand bis zur Sicke / Blutrinne / zum Auftreffpunkt
      out.push(...subF(xR, skR ? G.xRo : blOn ? bo : tp.x, yRx));
      // Sicke hinter der Endleiste: nur bei Verlauf „rundum" — bzw. in der Quer-Sicke hinter dem
      // Randbogen (dl > 0), damit diese hinter der Endleistenlinie sauber ausläuft.
      if (skR) out.push(...uArc(G.xRo, G.xRi, yRx, dl, sf));
      else for (let k = 0; k < NG; k++) { const x = blOn ? bo : tp.x; out.push({ x, y: yRx(x) - sg * dl }); }
      if (blOn) out.push(...bArc(bo, bi, yRx, dl, flat, bf));
      out.push({ x: tp.x, y: yT - sg * dl });
      if (top) for (let i = 0; i <= iLE; i++) out.push({ x: P[i].x, y: P[i].y - sg * dl });
      else for (let i = M - 1; i >= iLE; i--) out.push({ x: P[i].x, y: P[i].y - sg * dl });
      if (sk) out.push(...uArc(G.xFo, G.xFi, yFx, dl, sf).reverse());
      else for (let k = 0; k < NG; k++) out.push({ x: LE.x, y: yL - sg * dl });
      // Flanschpunkte (follow) vorn: von der Sicke / Nase bis zum Formenrand
      out.push(...subF(sk ? G.xFo : LE.x, xF, yFx));
      return top ? out : out.reverse();   // CCW
    };
    /* Steckungs-Ausnehmungen: am geteilten Urmodell steht der an der Trennlinie abgeschnittene
     * Querschnitt als Volumenkörper auf der Trennebene (die davon abgeformte Negativform bekommt
     * daraus die Tasche). Nur an der Wurzelverlängerung, nicht bei gespiegeltem Modell. */
    const ovRootOn = opt.ovRoot > 0;
    const stkSrc = W.part === 'tip' ? opt.stkT : opt.stk;
    const stk = stkSrc && stkSrc.on && !opt.mirror && ovRootOn ? stkChord(W.rings[0].pts, top, opt.teEdge, stkSrc) : null;
    const stkRun = stk && stk.run;
    // Anschluss-Steckung am Außenende (nur Bauteil „nur Tragfläche“): deckungsgleich zur Randbogenform
    const stkE = opt.stkT && opt.stkT.on && !opt.mirror && W.part === 'wing' ? stkChord(W.rings[W.rings.length - 1].pts, top, opt.teEdge, opt.stkT) : null;
    const collapsed = (P, deep, run) => {
      const LE = P[iLE], TE = teRef(P, top, opt.teEdge), Q = P.slice(); Q.psTip = P.psTip;
      if (top) for (let i = 0; i <= iLE; i++) { const t = iLE ? i / iLE : 0; Q[i] = { x: LE.x + (TE.x - LE.x) * (1 - t), y: LE.y + (TE.y - LE.y) * (1 - t) }; }
      else for (let i = iLE; i < M; i++) { const t = (i - iLE) / ((M - 1 - iLE) || 1); Q[i] = { x: LE.x + (TE.x - LE.x) * t, y: LE.y + (TE.y - LE.y) * t }; }
      const R0 = run || stkRun;
      if (R0 && deep) { const R = R0(deep), o = top ? 0 : iLE; for (let i = 0; i < R.length; i++) Q[o + i] = R[i]; }
      Q[0] = { x: TE.x, y: TE.y }; Q[M - 1] = { x: TE.x, y: TE.y };
      return Q;
    };
    // Überstand-Ringe hinter einem Ende (dir +1 = nach +z), optional mit U-förmiger Quer-Sicke
    // bzw. (an der Wurzel) mit den aufgesetzten Steckungskörpern über ihre Länge.
    /* Überstand-Ringe hinter einem Ende: weder Sicke noch Blutrinne laufen hier weiter — sie enden an der
     * ersten/letzten Rippe mit einer senkrechten Stirnwand (wie der Nasen-Huckel der Negativform). */
    const ext = (P, z0, dir, ov, groove, stkU, noEnd) => {
      const L = [], push = (Q, dz, dl) => { const z = z0 + dir * dz; L.push(Object.assign({ pts: poly(Q, dl, z, null, true, 0, 0), z }, edge(Q, z))); };
      if (stkU && stkU.run) {
        // noEnd: der abschließende flache Ring entfällt — die Stirnwand der Ausnehmung bildet dann der
        // erste Ring des anschließenden Randes (sonst lägen zwei flache Ringe auf derselben Station).
        let lv = stkLevels(stkU.lens, ov).slice().reverse();
        if (noEnd) lv = lv.slice(0, -1);
        for (const e of lv) push(collapsed(P, e.deep, stkU.run), e.dz, 0);   // vom Profilende nach außen
        return dir > 0 ? L : L.reverse();
      }
      const Q = collapsed(P);
      push(Q, 0, 0);
      push(Q, ov, 0);
      return dir > 0 ? L : L.reverse();
    };
    /* Überstand hinter der Spitze bei Rand 'offset': Rand und Sicke folgen dem Grundriss mit gleichem Abstand um
     * den Randbogen herum (kein gerader Abschluss). Ringe bis zum Ende des Offsets, zum Ende hin dichter; die
     * Punkte laufen von hinten nach vorn: NG Sickenpunkte, np Trennlinienpunkte, NG Sickenpunkte (Sickentiefe
     * aus dem Abstand zum Grundriss, damit die Sicke auch quer zum Ring stimmt). Höhe auf der Linie Nase -> Endleiste. */
    /* zEndAbs: Ende des Überstands (|z|); ohne Angabe das Ende des Parallel-Offsets (Rand 'offset'). Bei Rand 'box'
     * mit tangentialer Trennfläche werden die Ringe genauso dicht gesetzt, damit die Parabel sauber abgebildet wird. */
    const tailRings = (P, z0, dir, zEndAbs) => {
      const LE = P[iLE], TE = teRef(P, top, opt.teEdge), za0 = Math.abs(z0), zEnd = zEndAbs != null ? zEndAbs : edge.zEnd - 0.1, np = top ? iLE + 1 : M - iLE, NT = NG + 1 + np + NG + (blOn ? NB : 0) + 2 * NX;
      if (!(zEnd > za0 + 0.3)) return [];
      // Höhe der Trennfläche: Sehnenband Nase..Endleiste der letzten Rippe, davor / dahinter waagrecht oder geneigt,
      // dazu der tangentiale Verlauf ps.tipDy hinter der Spitze (s = Abstand hinter der letzten Rippe)
      const clampY = y => top ? Math.max(yBase + 1, y) : Math.min(yBase - 1, y);
      const yAt0 = x => { const t = Math.abs(TE.x - LE.x) > 1e-9 ? Math.max(0, Math.min(1, (x - LE.x) / (TE.x - LE.x))) : 0; return LE.y + (TE.y - LE.y) * t; };
      const tp0 = { yM: TE.y, x: TE.x };
      const yAtS = (x, s) => { const t = Math.abs(TE.x - LE.x) > 1e-9 ? (x - LE.x) / (TE.x - LE.x) : 0;
        const base = x < LE.x ? ps.yF(LE, x, P) : x > TE.x ? ps.yR(tp0, x, P) : yAt0(x); return clampY(base + ps.tipDy(s, t) * ps.tipFade(x, LE, TE)); };
      const bB = blBand(P);   // Lage der Blutrinne am Endring: hinter der Spitze laufen ihre Punkte eben weiter
      const seq = (x0, x1, m, arr) => { for (let j = 0; j < m; j++) arr.push(x0 + (x1 - x0) * (m > 1 ? j / (m - 1) : 0.5)); };
      const L = [], K = Math.max(14, Math.min(60, Math.round((zEnd - za0) / Math.max(0.5, opt.ringMm || 5))));
      for (let k = 0; k <= K; k++) {
        const za = za0 + (zEnd - za0) * Math.sin(Math.PI / 2 * k / K), E = edge(P, za), xs = [], yAt = x => yAtS(x, za - za0);
        const I = gIn && gIn.at(za), O = I && gOut.at(za);
        // Blutrinne endet an der Endleiste: hinter der Spitze bleiben nur ihre Punkte (eben, ohne Wulst)
        /* Trennlinienpunkte bleiben im Sehnenband der letzten Rippe (Nase .. Sehnenmitte der Endleiste)
         * statt über die ganze Plattenbreite gespreizt zu werden: die Platte läuft hinter dem Randbogen
         * eben in Verlängerung des übrigen Formenrandes weiter und schwingt nicht durch. */
        const band = (front, rear) => { let a = Math.min(Math.max(TE.x, front), rear), b = Math.min(Math.max(LE.x, front), rear);
          if (a - b < 0.2) { const c = (a + b) / 2; a = Math.min(rear, c + 0.1); b = Math.max(front, c - 0.1); } return [a, b]; };
        if (I && O) {
          for (const x of ps.flangeX(E.xR, O.xR)) xs.push(x);   // Flanschpunkte (follow) wie in poly()
          seq(O.xR, I.xR, NG, xs);
          let pf = I.xF, pr = I.xR;
          if (blOn) { const b0 = Math.min(bB.xo, I.xR - 0.1, E.xR - 0.2), b1 = Math.min(bB.xi, b0 - 0.1); seq(b0, b1, NB, xs); pr = b1; }
          const [pa, pb] = band(pf, pr); seq(pa, pb, np + 1, xs);   // np + 1 = Trennlinienpunkte wie in poly() (Profil + Auftreffpunkt)
          seq(I.xF, O.xF, NG, xs);
          for (const x of ps.flangeX(O.xF, E.xF)) xs.push(x);
        }
        else {
          // Flanschpunkte (follow) wie in poly() auf dem Rand vor / hinter dem Sehnenband — nicht im Band selbst
          // (am kollabierten Endring ist das Band nur 0,2 mm breit: zu dichte Punkte -> Deckel-Vernetzung scheitert)
          const d = (E.xR - E.xF) * 0.02, [pa, pb] = O ? band(O.xF, O.xR) : band(E.xF + d, E.xR - d);
          for (const x of ps.flangeX(E.xR, pa)) xs.push(x);
          seq(pa, pb, NT - 2 * NX, xs);
          for (const x of ps.flangeX(pb, E.xF)) xs.push(x);
        }
        // Sicke und Blutrinne enden am Randbogen: auf der ebenen Trennplatte dahinter bleiben ihre Punkte flach.
        const depth = () => 0;
        // Zwischenpunkt der Unterseite wie in poly() auf der Sehnenmitte: der Ring an der letzten Rippe und der erste
        // Randring liegen auf derselben Station -> gleiche Unterseitenpunkte, sonst offene Kanten (T-Stoß) im Netz.
        const out = [{ x: E.xF, y: yAt(E.xF) }, { x: E.xF, y: yBase }, { x: Math.min(E.xR, Math.max(E.xF, (LE.x + teX(P)) / 2)), y: yBase }, { x: E.xR, y: yBase }, { x: E.xR, y: yAt(E.xR) }];
        for (const x of xs) out.push({ x, y: yAt(x) - sg * depth(x) });
        L.push(Object.assign({ pts: top ? out : out.reverse(), z: dir * za }, E));
      }
      return dir > 0 ? L : L.reverse();
    };
    const first = rings[0], last = rings[rings.length - 1], off = opt.edge === 'offset';
    let out = [];
    const ovRoot = opt.mirror ? opt.ovTip : opt.ovRoot;
    const tanBox = !off && ps.tan;   // Rand 'box' mit tangentialer Trennfläche: dichte Ringe wie beim Offset-Rand
    /* Der erste Randring hinter dem Endring (bzw. vor dem Anfangsring bei Spiegelung) bekommt 0,05 mm Abstand zur
     * Rippenstation: auf derselben Station wäre das Ringband dazwischen eine flächenlose Wand (kollabierter Endring des
     * runden Randbogens: alle Punkte auf einer Linie; volle Endrippe: Splitter an der dünnen Endleiste) -> entartete
     * Dreiecke werden verworfen, offene Kanten. Mit dem winzigen Versatz bleibt die Wand ein echtes Band. */
    const dzPt = 0.05;
    if (opt.mirror && (off || (tanBox && ovRoot > 0))) out = out.concat(tailRings(first.pts, first.z - dzPt, -1, off ? null : Math.abs(first.z) + ovRoot));
    else if (ovRoot > 0) out = out.concat(ext(first.pts, first.z, -1, ovRoot, !!opt.mirror, stk));
    const r0 = Math.max(0, out.length - 1), n0 = out.length;   // Ringband ab dem kollabierten Ring an der Wurzel
    rings.forEach((r, k) => out.push(Object.assign({ pts: poly(r.pts, 0, r.z, null, false, skFac(k), blFac(k)), z: r.z }, edge(r.pts, r.z))));
    const n1 = out.length;
    if (off) {
      // Anschluss-Steckung vor dem auslaufenden Rand (höchstens 60 % des Überstands hinter der letzten Rippe)
      const zStk = stkE && stkE.run ? Math.min(Math.max.apply(null, stkE.lens), Math.max(0, edge.zEnd - 0.1 - last.z) * 0.6) : 0;
      if (zStk > 0.3) out = out.concat(ext(last.pts, last.z, +1, zStk, false, stkE, true));
      // 0,05 mm Versatz: die Stirnwand der Ausnehmung bekommt eine (unsichtbare) Höhe, sonst lägen der
      // offene Ring und der erste Randring auf derselben Station -> entartetes Ringband (Löcher im Netz).
      out = out.concat(tailRings(last.pts, last.z + (zStk > 0.3 ? zStk + 0.05 : dzPt), +1));
    }
    else if (opt.ovTip > 0) {
      if (tanBox && !(stkE && stkE.run)) out = out.concat(tailRings(last.pts, last.z + dzPt, +1, Math.abs(last.z) + opt.ovTip));
      else out = out.concat(ext(last.pts, last.z, +1, opt.ovTip, true, stkE));
    }
    // Formfläche (Profilhälfte): oben Streifen ab 5 Rand- + NG Sickenpunkten, unten (Polygon umgekehrt) ab NG.
    const np = top ? iLE + 1 : M - iLE, i0 = top ? 5 + NX + NG + (blOn ? NB : 0) + 1 : NG + NX;
    const surf = { i0, i1: i0 + np - 2, r0, r1: r0 + rings.length - 1 + (out.length > n1 ? 1 : 0), tip: tipBands(W, r0 + (n0 > 0 ? 1 : 0), rings.length, !!opt.mirror) };
    return { rings: out, box: { xF: xF0, xR: xR0, yBase }, sicke: sk, surf, stk: stk ? { placed: stk.placed, skipped: stk.skipped } : null,
      stkE: stkE ? { placed: stkE.placed, skipped: stkE.skipped } : null };
  }
  /* Trennfläche als Anzeige-Fläche (alle Zielarten): je Station 6 Punkte [Formenrand vorn, Nase, Mitte, Mitte,
   * Endleiste, Formenrand hinten] auf der Trennfläche. Im Rippenbereich fallen die Mittelpunkte auf Nase bzw. Endleiste
   * (dort liegt das Profil, kein Flächenstreifen), in den Überständen vor der Wurzel und hinter dem Randbogen spannen
   * sie das ganze Band auf (Höhe wie in moldRings / splitRings: Sehnenlinie der Endrippe + tangentialer Verlauf).
   * Rückgabe: Vierecke [[x,y,z]×4] in Modellkoordinaten (gebogene Teile über frameAt zurückgebogen) und Linienzüge. */
  function partingSheet(W, opt) {
    const rings = W.rings, M = rings[0].pts.length, iLE = leIndex(M), ps = partingSpec(W, opt);
    let xMin = Infinity, xMax = -Infinity;
    for (const r of rings) for (const p of r.pts) { if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x; }
    const edge = edgeFn(W, opt, xMin - opt.ovF, xMax + opt.ovR), teX = P => Math.max(P[0].x, P[M - 1].x);
    const mid = P => teMid(P);
    // je Station: [Formenrand vorn, NX Flanschpunkte, Nase, Mitte, Mitte, Endleiste, NX Flanschpunkte, Formenrand hinten]
    const NX = ps.NX || 0, iN = NX + 1, iT = NX + 4, sub = (xa, xb) => ps.flangeX(xa, xb);
    const rowAt = (P, z, spread, s) => {
      const LE = P[iLE], TE = mid(P), E = edge(P, z) || { xF: LE.x - opt.ovF, xR: teX(P) + opt.ovR };
      const tp = { yM: TE.y, x: TE.x };
      // fn: exakte Höhe y(x) der Zeile (für den 2D-Schnitt, partingSection); im Rippenbereich zwischen Nase und
      // Endleiste die Sehnenlinie (wie der Mittelstreifen der Anzeige-Vierecke: Trennfläche durch das Bauteil)
      if (!spread) {
        const yF = x => ps.yF(LE, x, P), yR = x => ps.yR(tp, x, P);
        const yC = x => Math.abs(TE.x - LE.x) > 1e-9 ? LE.y + (TE.y - LE.y) * (x - LE.x) / (TE.x - LE.x) : LE.y;
        const fn = { xF: E.xF, xR: E.xR, y: x => x <= LE.x ? yF(x) : x >= TE.x ? yR(x) : yC(x) };
        return { z, fn, pts: [{ x: E.xF, y: yF(E.xF) }, ...sub(E.xF, LE.x).map(x => ({ x, y: yF(x) })), { x: LE.x, y: LE.y }, { x: LE.x, y: LE.y }, { x: TE.x, y: TE.y }, { x: TE.x, y: TE.y }, ...sub(TE.x, E.xR).map(x => ({ x, y: yR(x) })), { x: E.xR, y: yR(E.xR) }] };
      }
      const d = (E.xR - E.xF) * 0.02, x0 = Math.min(Math.max(LE.x, E.xF + d), E.xR - d), x1 = Math.max(Math.min(TE.x, E.xR - d), E.xF + d), xm = (x0 + x1) / 2;
      const tAt = x => Math.abs(TE.x - LE.x) > 1e-9 ? (x - LE.x) / (TE.x - LE.x) : 0;
      const yAt = x => { const t = tAt(x); const base = x < LE.x ? ps.yF(LE, x, P) : x > TE.x ? ps.yR(tp, x, P) : LE.y + (TE.y - LE.y) * t; return base + ps.tipDy(s || 0, t) * ps.tipFade(x, LE, TE); };
      return { z, fn: { xF: E.xF, xR: E.xR, y: yAt }, pts: [E.xF, ...sub(E.xF, x0), x0, xm, xm, x1, ...sub(x1, E.xR), E.xR].map(x => ({ x, y: yAt(x) })) };
    };
    const rows = [], first = rings[0], last = rings[rings.length - 1];
    if (opt.ovRoot > 0 && !(opt.mirror && opt.target !== 'neg')) { rows.push(rowAt(first.pts, first.z - opt.ovRoot, true, 0)); rows.push(rowAt(first.pts, first.z, true, 0)); }
    for (const r of rings) rows.push(rowAt(r.pts, r.z, false));
    const off = opt.edge === 'offset', zEnd = off ? (edge.zEnd > last.z + 0.3 ? edge.zEnd - 0.1 : null) : (opt.ovTip > 0 ? last.z + opt.ovTip : null);
    if (zEnd != null) {
      rows.push(rowAt(last.pts, last.z, true, 0));
      const K = (off || ps.tan) ? Math.max(14, Math.min(60, Math.round((zEnd - last.z) / Math.max(0.5, opt.ringMm || 5)))) : 1;
      for (let k = 1; k <= K; k++) { const z = last.z + (zEnd - last.z) * (K > 1 ? Math.sin(Math.PI / 2 * k / K) : 1); rows.push(rowAt(last.pts, z, true, z - last.z)); }
    }
    let all = rows;
    if (opt.mirror && opt.target !== 'neg') all = rows.slice(1).reverse().map(r => ({ z: -r.z, pts: r.pts, fn: r.fn })).concat(rows);
    const to3 = (p, z) => { if (!W.frameAt) return [p.x, p.y, z]; const f = W.frameAt(z); return [f.O[0] + p.x * f.ex[0] + p.y * f.en[0], f.O[1] + p.x * f.ex[1] + p.y * f.en[1], f.O[2] + p.x * f.ex[2] + p.y * f.en[2]]; };
    const quads = [], lines = [];
    for (let r = 0; r + 1 < all.length; r++) {
      const A = all[r], B = all[r + 1];
      for (let i = 0; i + 1 < A.pts.length; i++) {
        const a0 = A.pts[i], a1 = A.pts[i + 1], b0 = B.pts[i], b1 = B.pts[i + 1];
        if (Math.abs(a1.x - a0.x) < 1e-6 && Math.abs(b1.x - b0.x) < 1e-6) continue;   // entarteter Streifen (Mitte im Rippenbereich)
        quads.push([to3(a0, A.z), to3(a1, A.z), to3(b1, B.z), to3(b0, B.z)]);
      }
    }
    // Linien: Formenrand vorn / hinten, Trennlinie an Nase und Endleiste, erste und letzte Station
    for (const i of [0, iN, iT, 2 * NX + 5]) lines.push({ pts: all.map(R => to3(R.pts[i], R.z)), dash: i === iN || i === iT });
    for (const R of [all[0], all[all.length - 1]]) lines.push({ pts: R.pts.map(p => to3(p, R.z)), dash: false });
    return { quads, lines, rows: W.frameAt ? null : all, iN, iT };
  }
  function buildSplit(W, opt, half) {
    const sr = splitRings(W, opt, half);
    const m = new Mesh();
    m.holes = loftHoles(m, sr.rings, holeSpots(sr.rings, opt, W), opt, surfTag(sr.surf));
    cap(m, sr.rings[0], false, 1);
    cap(m, sr.rings[sr.rings.length - 1], true, 1);
    m.sicke = sr.sicke; m.stk = sr.stk; m.stkE = sr.stkE;
    return m;
  }

  // ---------- Transformationen / STL ---------------------------------------
  // Netz transformieren: fn(x,y,z)->[x,y,z]; bei Spiegelung (det<0) Umlaufsinn tauschen.
  function transformMesh(mesh, fn, reflect) {
    const v = mesh.v, out = new Mesh(); out.t = (mesh.t || []).slice();
    for (let i = 0; i < v.length; i += 9) {
      const a = fn(v[i], v[i + 1], v[i + 2]), b = fn(v[i + 3], v[i + 4], v[i + 5]), c = fn(v[i + 6], v[i + 7], v[i + 8]);
      if (reflect) out.v.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2]);
      else out.v.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    }
    return out;
  }
  function meshBounds(mesh) {
    const v = mesh.v, mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { if (v[i + k] < mn[k]) mn[k] = v[i + k]; if (v[i + k] > mx[k]) mx[k] = v[i + k]; }
    return { mn, mx };
  }
  const boundsCache = new WeakMap();   // Netz -> Bounding-Box (die Vorschau fragt sie bei jedem Bild ab)
  function meshBoundsCached(mesh) { let b = boundsCache.get(mesh); if (!b) { b = meshBounds(mesh); boundsCache.set(mesh, b); } return b; }
  function exportTransform(mesh, opt, cavityFlip) {
    let m = mesh;
    if (cavityFlip) m = transformMesh(m, (x, y, z) => [x, -y, -z], false);   // Umdrehen = Drehung um X (180°), kein Spiegelbild
    if (opt.up === 'z') m = transformMesh(m, (x, y, z) => [x, -z, y], false);   // Drehung um X (+90°): Y hoch -> Z hoch
    if (opt.origin === 'min') { const b = meshBounds(m); m = transformMesh(m, (x, y, z) => [x - b.mn[0], y - b.mn[1], z - b.mn[2]], false); }
    return m;
  }
  function toBinarySTL(verts) {
    const n = Math.floor(verts.length / 9);
    const buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
    const hdr = 'AI Foam Cut Formenbau'; for (let i = 0; i < 80; i++) dv.setUint8(i, i < hdr.length ? hdr.charCodeAt(i) : 0);
    dv.setUint32(80, n, true);
    let o = 84;
    for (let i = 0; i < n * 9; i += 9) {
      const ux = verts[i + 3] - verts[i], uy = verts[i + 4] - verts[i + 1], uz = verts[i + 5] - verts[i + 2];
      const vx = verts[i + 6] - verts[i], vy = verts[i + 7] - verts[i + 1], vz = verts[i + 8] - verts[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
      dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true); o += 12;
      for (let k = 0; k < 9; k++) { dv.setFloat32(o, verts[i + k], true); o += 4; }
      dv.setUint16(o, 0, true); o += 2;
    }
    return buf;
  }
  function projBase() {
    const b = (state.projectName || '').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
    const wt = App.wingFileTag ? App.wingFileTag() : '';   // mehrere Tragflächen: Name der aktiven anhängen
    return (b && wt) ? b + '_' + wt : (b || wt || 'tragflaeche');
  }
  function saveSTL(mesh, name) {
    if (demoBlocked()) return;
    const buf = toBinarySTL(mesh.v);
    if (typeof App.download === 'function') App.download(name, buf, 'model/stl', 'svStl');
    else if (App.anchorDownload) App.anchorDownload(name, buf, 'model/stl');
  }

  // ---------- Optionen einsammeln / Modell bauen ---------------------------
  function opts() {
    // Altstand Winglet-Spitze: gemeinsamer Exponent formWlTipP -> Nase/Endleiste (frei).
    if (state.cfg.formWlTipPLE == null && state.cfg.formWlTipP != null && +state.cfg.formWlTipP !== 2) { state.cfg.formWlTipPLE = state.cfg.formWlTipPTE = +state.cfg.formWlTipP; state.cfg.formWlTipRef = 50; state.cfg.formWlTipMode = 'custom'; }
    // Altstand: eine gemeinsame Rundung formTipP -> getrennte Exponenten Nase/Endleiste.
    if (state.cfg.formTipPLE == null && state.cfg.formTipP != null) { state.cfg.formTipPLE = state.cfg.formTipPTE = +state.cfg.formTipP || 2; state.cfg.formTipPreset = 'custom'; }
    return {
      mode: C('formSmooth'), ctrl: Math.max(4, Math.round(C('formCtrl'))), lambda: Math.max(0, +C('formLambda')),
      pts: Math.max(40, Math.round(C('formPts'))), ringMm: Math.max(0.5, +C('formRingMm')), loft: C('formLoft') === 'spline' ? 'spline' : 'linear', loftAng: Math.max(0.1, +C('formLoftAng') || 2), aufmass: +C('formAufmass') || 0, teThk: Math.max(0, +C('formTeThk') || 0), teEdge: ['blend', 'flush'].includes(C('formTeEdge')) ? C('formTeEdge') : 'out',
      tipMode: C('formTipMode'), tipLen: Math.max(0, +C('formTipLen')), tipPLE: +C('formTipPLE') || 2, tipPTE: +C('formTipPTE') || 2,
      tipRef: +C('formTipRef') || 0, tipRise: +C('formTipRise') || 0, tipTwist: +C('formTipTwist') || 0, tipThk: +C('formTipThk') || 100,
      wl: { step: Math.max(0, +C('formWlStep') || 0), stepAt: Math.max(0, +C('formWlStepAt') || 0), flatWing: C('formWlFlatWing') !== false, teWing: C('formWlTeWing') !== false, teSweep: Math.min(60, Math.max(-30, +C('formWlTeSweep') || 0)), teSweepH: Math.min(60, Math.max(-30, +C('formWlTeSweepH') || 0)), flatLen: Math.max(0, +C('formWlFlatLen') || 0), flatSweep: Math.min(70, Math.max(-30, +C('formWlFlatSweep') || 0)), len: +C('formWlLen') || 0, R: Math.max(0, +C('formWlR')), cant: Math.min(85, Math.max(-30, +C('formWlCant') || 0)),
        cRoot: Math.max(5, +C('formWlCRoot') || 0), cTip: Math.max(2, +C('formWlCTip') || 0), sweep: Math.min(70, Math.max(-30, +C('formWlSweep') || 0)),
        toe: +C('formWlToe') || 0, twist: +C('formWlTwist') || 0, midPos: +C('formWlMidPos') || 50, tipLen: Math.max(0, +C('formWlTipLen')), tipP: +C('formWlTipP') || 2,
        tipMode: C('formWlTipMode') || 'ellipse', tipPLE: +C('formWlTipPLE') || 2, tipPTE: +C('formWlTipPTE') || 2, tipRef: +C('formWlTipRef') || 0, tipThk: +C('formWlTipThk') || 100 },
      wlProf: C('formWlProf') || {},
      wlDrawMode: C('formWlDrawMode') === 'pline' ? 'pline' : 'spline', wlDrawRootAt: +C('formWlDrawRootAt') || 30,
      wlDrawTw: { root: +C('formWlDrawTwRoot') || 0, mid: +C('formWlDrawTwMid') || 0, tip: +C('formWlDrawTwTip') || 0 },
      mirror: !!C('formMirror'), up: C('formUp'), origin: C('formOrigin'),
      ovF: Math.max(0, +C('formOvF')), ovR: Math.max(0, +C('formOvR')), ovRoot: Math.max(0, +C('formOvRoot')), ovTip: Math.max(0, +C('formOvTip')),
      wall: Math.max(1, +C('formWall')), cavUp: !!C('formCavUp'), target: C('formTarget'), part: partMode(),
      wallMode: C('formWallMode') === 'neg' ? 'neg' : 'custom', wallWing: C('formWallWing') || '', wallSeg: C('formWallSeg') == null ? -1 : Math.round(+C('formWallSeg')), wallRib: C('formWallRib') === 'root' ? 'root' : 'tip',
      plateT: Math.max(1, +C('formPlateT')), sicke: !!C('formSicke'), sickeDist: Math.max(0, +C('formSickeDist')),
      sickeW: Math.max(0, +C('formSickeW')), sickeD: Math.max(0, +C('formSickeD')), sickeRun: C('formSickeRun'),
      sickeTip: Math.max(0, Math.min(100, C('formSickeTip') == null ? 100 : +C('formSickeTip') || 0)), sickeWedge: Math.max(0, Math.min(100, +C('formSickeWedge') || 0)),
      blut: { on: !!C('formBlut'), shape: C('formBlutShape') === 'u' ? 'u' : 'round', dist: Math.max(0, +C('formBlutDist') || 0),
        w: Math.max(0, +C('formBlutW') || 0), d: Math.max(0, +C('formBlutD') || 0),
        tip: Math.max(0, Math.min(100, C('formBlutTip') == null ? 20 : +C('formBlutTip') || 0)), wedge: Math.max(0, Math.min(100, C('formBlutWedge') == null ? 100 : +C('formBlutWedge') || 0)) },
      hk: { on: !!C('formHk'), w: Math.max(0, +C('formHkW') || 0), h: Math.max(0, +C('formHkH') || 0),
        tip: Math.max(0, Math.min(100, C('formHkTip') == null ? 100 : +C('formHkTip') || 0)), wedge: Math.max(0, Math.min(100, +C('formHkWedge') || 0)) },
      edge: C('formEdge') === 'offset' ? 'offset' : 'box',
      ps: { show: !!C('formPsShow'), angF: Math.max(-60, Math.min(60, +C('formPsAngF') || 0)), angR: Math.max(-60, Math.min(60, +C('formPsAngR') || 0)),
        tip: C('formPsTip') === 'tangent' ? 'tangent' : 'flat', tanLen: Math.max(0, +C('formPsTanLen') || 0), chord: C('formPsChord') === 'follow' ? 'follow' : 'flat' },
      holes: { on: !!C('formHoles'), d: Math.max(1, +C('formHoleD') || 0), n: Math.max(1, Math.round(+C('formHoleN') || 0)), x: Math.max(0, +C('formHoleX') || 0),
        end: Math.max(0, +C('formHoleEnd') || 0), sides: C('formHoleSides') || 'both',
        seg: !!(C('formHoleSeg') && C('formSegOn')), per: (C('formHolePer') && typeof C('formHolePer') === 'object') ? C('formHolePer') : {} },
      pin: { on: !!C('formPin'), n: pinCount(), shape: C('formPinShape') === 'rect' ? 'rect' : 'circle', d: Math.max(0.5, +C('formPinD') || 0),
        a: Math.max(0.5, +C('formPinA') || 0), b: Math.max(0.5, +C('formPinB') || 0), depth: Math.max(0.5, +C('formPinDepth') || 0), depthTip: Math.max(0.5, +(C('formPinDepthTip') != null ? C('formPinDepthTip') : C('formPinDepth')) || 0), pts: pinPts() },
      stk: { on: !!C('formStk'), pts: stkPts() },
      stkT: { on: !!C('formStkT'), pts: stkPts('formStkT') }
    };
  }
  function partMode() { const p = C('formPart'); return p === 'wing' || p === 'tip' ? p : 'all'; }
  function pinCount() { return Math.max(1, Math.min(20, Math.round(+C('formPinN') || 1))); }
  /* Steckungs-Ausnehmungen: eigene Liste (hinzufügen / löschen), je Eintrag ALLE Werte —
   * { x, y, shape, d, a, b, len }. Altstände mit [x, y] (gemeinsamer Querschnitt aus
   * formStkShape/D/A/B und gemeinsamer Länge formStkLen) werden beim Laden migriert;
   * die zuletzt benutzten Werte sind die Vorgabe für eine neue Ausnehmung. */
  /* P = Präfix der Liste: 'formStk' Tragflächensteckung (Wurzel), 'formStkT' Steckung am Anschluss
   * Tragfläche <-> Randbogen / Winglet. Je Liste eigene Vorgabewerte (…Shape/D/A/B/Len). */
  function stkItem(q, P) {
    P = P || 'formStk';
    const o = Array.isArray(q) ? { x: q[0], y: q[1] } : (q || {});
    return { x: +o.x || 0, y: +o.y || 0, shape: (o.shape != null ? o.shape : C(P + 'Shape')) === 'rect' ? 'rect' : 'circle',
      d: Math.max(0.5, +o.d || +C(P + 'D') || 10), a: Math.max(0.5, +o.a || +C(P + 'A') || 12),
      b: Math.max(0.5, +o.b || +C(P + 'B') || 8), len: Math.max(0.5, +o.len || +C(P + 'Len') || 30) };
  }
  function stkPts(P) {
    P = P || 'formStk';
    const src = Array.isArray(C(P + 'Pts')) ? C(P + 'Pts') : null;
    if (!src) { const a = [], n = P === 'formStk' ? stkCount() : 1; for (let k = 0; k < n; k++) a.push(stkItem({ x: 25 + 25 * k, y: 0 }, P)); S(P + 'Pts', a.slice()); return a; }
    const a = src.map(q => stkItem(q, P));
    if (src.some(q => Array.isArray(q) || q == null)) S(P + 'Pts', a.slice());
    return a;
  }
  function stkCount() { return Math.max(1, Math.min(10, Math.round(+C('formStkN') || 1))); }
  function stkAdd(P) {
    P = P || 'formStk';
    const a = stkPts(P), last = a[a.length - 1];
    a.push(stkItem(last ? { x: last.x + 25, y: last.y, shape: last.shape, d: last.d, a: last.a, b: last.b, len: last.len } : { x: 25, y: 0 }, P));
    S(P + 'Pts', a); stkActive[P] = a.length - 1;
  }
  function stkDel(k, P) { P = P || 'formStk'; const a = stkPts(P); a.splice(k, 1); S(P + 'Pts', a); if (stkActive[P] === k) stkActive[P] = null; else if (stkActive[P] != null && stkActive[P] > k) stkActive[P]--; }
  const stkActive = { formStk: 0, formStkT: 0 };   // aufgeklappte Ausnehmung je Liste (Seitenleiste)
  // Lochmitten-Liste auf die Anzahl bringen (neue Löcher: hintereinander auf der Sehne, y = 0)
  function pinPts() {
    const n = pinCount(), a = Array.isArray(C('formPinPts')) ? C('formPinPts').map(p => [+p[0] || 0, +p[1] || 0]) : [];
    while (a.length < n) a.push([15 + 15 * a.length, 0]);
    if (a.length !== (C('formPinPts') || []).length) S('formPinPts', a.slice());
    return a.slice(0, n);
  }
  /* Formhöhe passend zum Negativdesign: Ober-/Unterkante beider Formhälften = Ober-/Unterkante des
   * Negativblocks (Formblockhöhe, „Tragfläche im Formblock heben/senken") eines Segments einer Tragfläche,
   * je um das halbe „Auseinanderziehen" (negSplit) zur Trennebene hin gerückt — Höhe ab Trennebene = Schalenhöhe
   * im Negativdesign; die gedruckte/gefräste Form lässt sich dann bündig an die Schaum-Negativschalen kleben.
   * Bezug ist die Sehnenmitte der Bezugsrippe (Segment außen oder Wurzel): Abstand Blockoberkante /
   * -unterkante zu ihr wird auf den Anschlussring der Form übertragen. Gleiche Tragfläche: Ring auf
   * gleicher Spannweitenlage (derselbe y-Rahmen, Datum Sehnenmitte Wurzel). Andere Tragfläche:
   * Außenrippe -> Wurzelring der Form, Wurzelrippe -> letzter Flächenring (Anschluss Stoß an Stoß).
   * Rückgabe { yTop, yBot, top, bot, name, seg, rib, err?, warn? } oder null (nicht aktiv). */
  function negFit(Wp, o) {
    if (o.target !== 'neg' || o.wallMode !== 'neg' || !Wp || !Wp.rings || !Wp.rings.length) return null;
    const L = App.wingList ? App.wingList() : [], cur = state.activeWing || 0;
    let wi = cur;
    if (o.wallWing) { const k = L.findIndex(w => w && w.name === o.wallWing); if (k < 0) return { err: T('Tragfläche nicht gefunden:') + ' ' + o.wallWing }; wi = k; }
    const same = wi === cur;
    const calc = () => {
      const w = App.wing; if (!w || !w.cuts || !w.cuts.length || !App.negRibPts || !App.negChordMidY) return null;
      const n = w.cuts.length, seg = o.wallSeg >= 0 && o.wallSeg < n ? o.wallSeg : n - 1, cut = w.cuts[seg];
      const rP = App.negRibPts(cut, seg, 'root'), tP = App.negRibPts(cut, seg, 'tip');
      const H = Math.max(1, +state.cfg.negBlockH || 0);
      // Blockmitte wie im Negativdesign: EINE gemeinsame für alle Segmente (App.negBlockCy).
      const cy = App.negBlockCy ? App.negBlockCy()
               : (App.negChordMidY(rP) + App.negChordMidY(tP)) / 2 - (+state.cfg.negProfShift || 0);
      const bP = o.wallRib === 'root' ? rP : tP, ref = App.negChordMidY(bP);
      const sz = (App.segZ || [])[seg], z = sz ? (o.wallRib === 'root' ? sz.z0 : sz.z1) : null;
      /* Die Schalen sind im Negativdesign um „Ober-/Unterseite auseinanderziehen" (negSplit) getrennt:
       * obere Schale = Blockoberkante bis Nase + split/2, untere = Nase − split/2 bis Blockunterkante.
       * Zusammengelegt (Trennebenen aufeinander) ist jede Schale also um split/2 niedriger als der halbe
       * Block — die Form muss ab ihrer Trennebene genau diese Schalenhöhen haben. */
      const s2 = Math.max(0, +state.cfg.negSplit || 0) / 2, yLE = bP[Math.ceil(bP.length / 2) - 1].y;
      return { seg, H, s2, up: cy + H / 2 - ref - s2, dn: ref - (cy - H / 2) - s2, shTop: cy + H / 2 - yLE - s2, shBot: yLE - s2 - (cy - H / 2), z, ref, name: App.wingName ? App.wingName(wi) : '' };
    };
    let d = null;
    try { d = same ? calc() : App.withWing(wi, calc); } catch (e) { console.error(e); }
    if (!d) return { err: T('Negativdesign der Tragfläche liefert keine Schalen (Tragflächendesign prüfen).') };
    // Anschlussring der Form
    const R = Wp.rings, ts = Wp.tipStart == null ? R.length - 1 : Math.min(Wp.tipStart, R.length - 1);
    let ring;
    if (same && d.z != null) { ring = R[0]; for (const r of R.slice(0, ts + 1)) if (Math.abs(r.z - d.z) < Math.abs(ring.z - d.z)) ring = r; }
    else ring = o.wallRib === 'root' ? R[ts] : R[0];
    // gleiche Tragfläche ohne abgerolltes Winglet: derselbe y-Rahmen -> Blockkanten absolut (exakt, ohne Glättungseinfluss)
    const m = same && !Wp.frameAt ? d.ref : App.negChordMidY(ring.pts);
    let yTop = m + d.up, yBot = m - d.dn, yMax = -Infinity, yMin = Infinity;
    for (const r of R) for (const p of r.pts) { if (p.y > yMax) yMax = p.y; if (p.y < yMin) yMin = p.y; }
    let warn = null;
    if (yTop < yMax + 1 || yBot > yMin - 1) { warn = T('Negativblock zu niedrig: das Profil ragt aus der Form — Kanten auf 1 mm über/unter dem Profil begrenzt. Formblockhöhe im Negativdesign vergrößern.'); yTop = Math.max(yTop, yMax + 1); yBot = Math.min(yBot, yMin - 1); }
    // Höhe der Formhälften ab der Trennebene an der Nase des Anschlussrings (Vergleich mit den Schalenhöhen im Negativdesign)
    const yN = ring.pts[leIndex(ring.pts.length)].y;
    return { yTop, yBot, top: yTop - yMax, bot: yMin - yBot, H: d.H, split: 2 * d.s2, up: d.up, dn: d.dn, hTop: yTop - yN, hBot: yN - yBot, shTop: d.shTop, shBot: d.shBot, name: d.name, seg: d.seg, rib: o.wallRib, warn };
  }
  let model = null;   // { W, ur, top, bot, opt, preview?, fit? }
  function buildWith(o) {
    // Winglets nur beim Urmodell oder als eigenes Formteil (sonst hinterschnitten -> flach)
    if ((o.tipMode === 'winglet' || o.tipMode === 'wldraw') && o.target !== 'ur' && o.part !== 'tip') o = Object.assign({}, o, { tipMode: 'flat' });
    if (o.part === 'tip') o = Object.assign({}, o, { mirror: false });
    const W = wingRings(o);
    if (!W) return null;
    const Wt = tiltRings(W);   // Anzeige (Drahtgitter-Rippen) wie das Urmodell: senkrecht zur Nasenleiste
    const m = { W: Wt, Wfull: W, opt: o, ur: null, top: null, bot: null };
    try {
      let Wp = partW(W, o);
      if (!Wp) { m.err = T('Kein Randbogen / Winglet vorhanden (Abschluss „flach“ oder Länge 0) – für das Bauteil „nur Randbogen / Winglet“ gibt es nichts zu bauen.'); return m; }
      Wp = partingReparam(Wp);   // Trennlinie an der Silhouette (senkrecht zur Mittellinie), kein Hinterschnitt am Randbogen
      m.Wp = Wp;   // Ringe, aus denen Form / Trennplatte gebaut werden (Vorschau der Trennfläche)
      const fit = negFit(Wp, o);   // Formhöhe aus dem Negativdesign (Ober-/Unterkante wie der Negativblock)
      if (fit) { m.fit = fit; if (!fit.err) { o = Object.assign({}, o, { fit }); m.opt = o; } }
      if (o.part === 'tip') m.W = { rings: Wp.disp, stations: W.stations, tipStart: 0, wl: null };
      else if (o.part === 'wing') m.W = partW(Wt, o);
      const oPos = o.target === 'neg' ? Object.assign({}, o, { mirror: false }) : o;
      const positive = () => {
        if (o.part === 'all') return buildUrmodell(W, oPos);
        const P = buildUrParts(W, oPos); m.pins = P.pins;
        const mesh = o.part === 'tip' ? P.tip : P.wing; if (mesh && o.part === 'tip') mesh.isTip = true;
        return mesh;
      };
      if (o.target === 'neg') { m.top = bendMesh(buildMold(Wp, o, 'top'), Wp); m.bot = bendMesh(buildMold(Wp, o, 'bot'), Wp); m.ur = positive(); }
      else if (o.target === 'split') { m.top = bendMesh(buildSplit(Wp, o, 'top'), Wp); m.bot = bendMesh(buildSplit(Wp, o, 'bot'), Wp); }
      else m.ur = positive();
      if (o.pin.on && o.tipMode !== 'flat' && o.part === 'all') { const P = buildUrParts(W, oPos); if (P.tip) m.parts = P; }
    } catch (e) { console.error(e); m.err = e.message; }
    return m;
  }
  // Dateinamen-Zusatz je Bauteil
  function partSuffix(o) { if (o.part === 'tip') return (o.tipMode === 'winglet' || o.tipMode === 'wldraw') ? '_winglet' : '_randbogen'; return o.part === 'wing' ? '_flaeche' : ''; }
  const PREVIEW_MAX = 25000;   // Dreiecke; darüber gröberes Vorschau-Netz (Export bleibt fein)
  let fitInfo = null;   // Infozeile „Formhöhe passend zu den Negativschalen" im Seitenmenü: nach jedem Aufbau nachführen
  function build() {
    const o = opts();
    model = buildWith(o);
    if (fitInfo) { try { fitInfo(); } catch (e) {} }
    if (model) {
      const n = ['ur', 'top', 'bot'].reduce((s, k) => s + (model[k] ? model[k].v.length / 9 : 0), 0);
      model.ntri = n;
      if (n > PREVIEW_MAX) {
        const f = Math.sqrt(n / PREVIEW_MAX);
        model.preview = buildWith(Object.assign({}, o, { pts: Math.max(60, Math.round(o.pts / f)), ringMm: o.ringMm * f }));
      }
      prepSources();
    }
    return model;
  }
  function exportUr() { if (!model || !model.ur) build(); if (!model || !model.ur) return; saveOut(model.ur, model.opt, false, projBase() + partSuffix(model.opt) + '_urmodell.stl', 'ur'); }
  // Getrennter Export Tragfläche / Randbogen: bei Negativform ohne Spiegelung (wie das dortige Urmodell).
  function partsOpt() { return model.opt.target === 'neg' ? Object.assign({}, model.opt, { mirror: false }) : model.opt; }
  function exportWingOnly() {
    if (!model || !model.W) build(); if (!model || !model.W) return;
    const o = partsOpt(), P = buildUrParts(model.Wfull || model.W, o);
    saveOut(P.wing, o, false, projBase() + '_urmodell_flaeche.stl', 'wing');
  }
  function exportTipOnly() {
    if (!model || !model.W) build(); if (!model || !model.W) return;
    const o = partsOpt(), P = buildUrParts(model.Wfull || model.W, o);
    if (!P.tip) return;
    const wl = o.tipMode === 'winglet' || o.tipMode === 'wldraw';
    saveOut(P.tip, o, false, projBase() + (wl ? '_urmodell_winglet.stl' : '_urmodell_randbogen.stl'), 'tip');
  }
  function exportTop() { if (!model || !model.top) build(); if (!model || !model.top) return; const sp = model.opt.target === 'split'; saveOut(model.top, model.opt, !sp && model.opt.cavUp, projBase() + partSuffix(model.opt) + (sp ? '_urmodell_oben.stl' : '_form_oben.stl'), 'top'); }
  function exportBot() { if (!model || !model.bot) build(); if (!model || !model.bot) return; const sp = model.opt.target === 'split'; saveOut(model.bot, model.opt, sp && model.opt.cavUp, projBase() + partSuffix(model.opt) + (sp ? '_urmodell_unten.stl' : '_form_unten.stl'), 'bot'); }

  // ---------- STEP-Export (Variante C): echter B-Spline-Volumenkörper -------
  /* Ringstapel des Positivs (Urmodell) in der REIHENFOLGE, die buildUrmodell/buildUrParts
   * lofted — Wurzel -> Spitze (-> Winglet), bei Spiegelung beidseitig. Winglet-Ringe schließen
   * lückenlos an die letzte Rippe an (ein durchgehender Schlauch). Danach bereinigt (entartete
   * Endringe entfernt, aufeinanderfolgende Dubletten zusammengefasst). Grundlage für den STEP-Solid. */
  function urmodellRingStack(o) {
    const oPos = o.target === 'neg' ? Object.assign({}, o, { mirror: false }) : o;
    const W0 = wingRings(oPos); if (!W0) return null;
    const W = tiltRings(W0);
    const flipR = r => ({ pts: r.pts.map(p => (p.z == null ? { x: p.x, y: p.y } : { x: p.x, y: p.y, z: -p.z })), z: -r.z });
    const part = oPos.part;
    let fwd;
    if (part === 'tip') fwd = W.wl ? [W.rings[W.tipStart]].concat(W.wl) : W.rings.slice(W.tipStart);
    else if (part === 'wing') fwd = W.rings.slice(0, W.tipStart + 1);
    else fwd = W.wl ? W.rings.concat(W.wl) : W.rings.slice();
    if (!fwd || fwd.length < 2) return null;
    let stack;
    if (oPos.mirror && part !== 'tip') { const mir = fwd.slice(1).reverse().map(flipR); stack = mir.concat(fwd); }
    else stack = fwd;
    return stepClean(stack);
  }
  // Ringstapel säubern: gleiche Punktzahl vorausgesetzt; aufeinanderfolgende (fast) gleiche Ringe
  // zusammenfassen; entartete Endringe (Fläche ~0, z. B. Spitze eines runden Randbogens) entfernen.
  function stepClean(rings) {
    if (!rings || !rings.length) return rings;
    const M = rings[0].pts.length;
    const zof = (r, i) => (r.pts[i].z == null ? r.z : r.pts[i].z);
    const ext = r => { let a = 0; const P = r.pts; for (let i = 0; i < P.length; i++) { const b = P[(i + 1) % P.length]; a += P[i].x * b.y - b.x * P[i].y; } return Math.abs(a); };
    const same = (a, b) => { if (a.pts.length !== b.pts.length) return false; for (let i = 0; i < a.pts.length; i++) if (Math.hypot(a.pts[i].x - b.pts[i].x, a.pts[i].y - b.pts[i].y, zof(a, i) - zof(b, i)) > 1e-6) return false; return true; };
    let R = [rings[0]]; for (let k = 1; k < rings.length; k++) if (!same(R[R.length - 1], rings[k])) R.push(rings[k]);
    while (R.length > 2 && ext(R[R.length - 1]) < 1e-3) R.pop();
    while (R.length > 2 && ext(R[0]) < 1e-3) R.shift();
    return R;
  }
  // STEP-Text des aktuellen Positivs (Urmodell) erzeugen. Wirft bei uneinheitlicher Ringpunktzahl.
  function formStepText(o) {
    o = o || (model && model.opt); if (!o) return null;
    const rings = urmodellRingStack(o);
    if (!rings || rings.length < 2) throw new Error(T('Kein Volumenkörper ableitbar (leeres oder entartetes Modell).'));
    return App.stepExport.ringsToStep(rings, { name: projBase() + partSuffix(o) });
  }
  async function exportUrStep() {
    if (demoBlocked()) return;
    if (!App.stepExport) { alert(T('STEP-Modul nicht geladen.')); return; }
    if (!model) build(); if (!model) return;
    const o = model.opt;
    // Erzeugung blockiert die UI -> Lade-Overlay davor einblenden (ein Frame zeichnen lassen).
    const run = () => formStepText(o);
    let txt;
    try {
      txt = App.withBusy ? await App.withBusy(T('STEP-Volumenkörper wird erzeugt …'), run) : run();
    } catch (e) { alert(T('STEP-Export fehlgeschlagen: ') + (e && e.message ? T(e.message) : e)); return; }
    if (!txt) return;
    App.download(projBase() + partSuffix(o) + '_urmodell.step', txt, 'application/step', 'svStl');
  }

  // Formhälfte (Negativform / geteiltes Urmodell) als Ringstapel -> STEP.
  // Die Formquerschnitte (Kavität + Flansch + Wände + Rückseite) sind geschlossene, uniforme
  // Ringe (wie beim STL-Loft); Passlöcher werden dort separat gestanzt und sind hier NICHT enthalten.
  function bendRings(rings, Wp) {   // Winglet-Form: abgerollte Ringe über frameAt(s) zurückbiegen (sonst unverändert)
    if (!Wp || !Wp.frameAt) return rings;
    return rings.map(r => ({ z: r.z, pts: r.pts.map(p => { const f = Wp.frameAt(r.z); return { x: f.O[0] + p.x * f.ex[0] + p.y * f.en[0], y: f.O[1] + p.x * f.ex[1] + p.y * f.en[1], z: f.O[2] + p.x * f.ex[2] + p.y * f.en[2] }; }) }));
  }
  function moldStepText(half) {
    const o = model && model.opt, Wp = model && model.Wp;
    if (!o || !Wp) throw new Error(T('Keine Formdaten – bitte zuerst die Form aufbauen.'));
    const rings0 = (o.target === 'split' ? splitRings : moldRings)(Wp, o, half).rings;
    // Passbohrungen (Flansch/Trennplatte): Lochmitten wie beim STL; im STEP als echte Zylinderbohrungen.
    // Bei gebogenen Winglet-Formen (Ringe mit eigener z-Koordinate) lässt der Kern sie automatisch aus.
    const holes = (o.holes && o.holes.on) ? { list: holeSpots(rings0, o, Wp).map(h => ({ x: h.x, z: h.z })), r: Math.max(0.5, o.holes.d / 2) } : null;
    let rings = rings0.map(r => ({ z: r.z, pts: r.pts.map(p => ({ x: p.x, y: p.y, z: p.z })) }));
    rings = bendRings(rings, Wp);
    rings = stepClean(rings);
    if (!rings || rings.length < 2) throw new Error(T('Kein Volumenkörper ableitbar (leeres oder entartetes Modell).'));
    const sp = o.target === 'split', suf = (sp ? '_urmodell' : '_form') + (half === 'top' ? '_oben' : '_unten');
    const opt = { name: projBase() + partSuffix(o) + suf };
    if (holes && holes.list.length) opt.holes = holes;
    return { txt: App.stepExport.ringsToStep(rings, opt), name: projBase() + partSuffix(o) + suf + '.step', bent: !!Wp.frameAt };
  }
  async function exportMoldStep(half) {
    if (demoBlocked()) return;
    if (!App.stepExport) { alert(T('STEP-Modul nicht geladen.')); return; }
    if (!model) build(); if (!model) return;
    const run = () => moldStepText(half);
    let r;
    try { r = App.withBusy ? await App.withBusy(T('STEP-Volumenkörper wird erzeugt …'), run) : run(); }
    catch (e) { alert(T('STEP-Export fehlgeschlagen: ') + (e && e.message ? T(e.message) : e)); return; }
    if (!r) return;
    if (model.opt.holes && model.opt.holes.on && r.bent && App.toast)
      App.toast(T('Hinweis: Bei gebogenen Winglet-Formen sind die Passlöcher im STEP nicht enthalten – im STL vorhanden.'));
    App.download(r.name, r.txt, 'application/step', 'svStl');
  }

  // ---------- Segmentierung (Druckstücke) -----------------------------------
  /* Formteile werden beim Export durch Ebenen senkrecht zur Spannweite (z, Modellkoordinaten)
   * in Stücke geteilt, jedes Stück eben verschlossen und als eigene STL geschrieben.
   * segOpts(): Einstellungen; segPlanes(): z-Lagen der Trennebenen aus der Ausdehnung des
   * aktuellen Modells (alle Exportkörper zusammen) bzw. den Segmentgrenzen der Tragfläche. */
  function segOpts() {
    const m = C('formSegMode');
    return { on: !!C('formSegOn'), mode: ['len', 'seg', 'n', 'max'].includes(m) ? m : 'len', len: Math.max(5, +C('formSegLen') || 0),
      per: Math.max(1, Math.min(50, Math.round(+C('formSegPer') || 1))), n: Math.max(1, Math.min(200, Math.round(+C('formSegN') || 1))),
      max: Math.max(5, +C('formSegMax') || 0), gap: Math.max(0, +C('formSegGap') || 0),
      pin: C('formSegPin') ? { n: Math.max(1, Math.min(20, Math.round(+C('formSegPinN') || 1))), d: Math.max(0.5, +C('formSegPinD') || 0),
        depth: Math.max(0.5, +C('formSegPinDepth') || 0), margin: Math.max(0, +C('formSegPinMargin') || 0) } : null,
      pinPer: (C('formSegPinPer') && typeof C('formSegPinPer') === 'object') ? C('formSegPinPer') : {} };
  }
  // Passstift-Einstellung für Trennstelle i (0 = an der Wurzel): globale Vorgabe, je Trennstelle abschaltbar / eigene Anzahl.
  function segPinAt(so, i, body) {
    if (!so.pin) return null;
    const q = so.pinPer[i];
    if (!q) return so.pin;
    if (q.on === false) return null;
    // Manuelle Lage für diesen Körper: feste Punkte statt automatischer Suche (Anzahl = Punktzahl)
    const pts = body && Array.isArray(q.pts) ? q.pts.filter(p => p[2] === body).map(p => ({ x: +p[0] || 0, y: +p[1] || 0 })) : [];
    if (pts.length) return Object.assign({}, so.pin, { n: pts.length, pts });
    const n = +q.n; return n >= 1 ? Object.assign({}, so.pin, { n: Math.min(20, Math.round(n)) }) : so.pin;
  }
  // Manuelle Passstift-Punkte je Trennstelle: alle Punkte (auch anderer Körper) für die Anzeige
  function segPinPts(i) { const q = ((C('formSegPinPer') || {})[i]) || {}; return Array.isArray(q.pts) ? q.pts : []; }
  // z-Bereich der Exportkörper (volle Auflösung, ohne Vorschau-Versatz).
  function segRange() {
    if (!model) return null;
    let lo = Infinity, hi = -Infinity;
    for (const k of ['ur', 'top', 'bot']) if (model[k]) { const b = meshBounds(model[k]); lo = Math.min(lo, b.mn[2]); hi = Math.max(hi, b.mx[2]); }
    return lo < hi ? [lo, hi] : null;
  }
  const EPS_SEG = 1e-3;
  function splitEven(a, b, n, out) { for (let i = 1; i < n; i++) out.push(a + (b - a) * i / n); }
  function segPlanes(so, R, Wx) {
    so = so || segOpts();
    R = R || segRange(); if (!so.on || !R) return [];
    const [lo, hi] = R, L = hi - lo, out = [];
    if (so.mode === 'len') { for (let z = lo + so.len; z < hi - Math.max(EPS_SEG, so.len * 0.02); z += so.len) out.push(z); }
    else if (so.mode === 'n') splitEven(lo, hi, so.n, out);
    else if (so.mode === 'max') splitEven(lo, hi, Math.max(1, Math.ceil(L / so.max - 1e-9)), out);
    else {
      // Segmentgrenzen der Tragfläche (Stationen); Wurzelüberstand gehört zum ersten, Randbogen /
      // Spitzenüberstand zum letzten Segment (die Endrippe ist keine Grenze). Gespiegelt: Grenzen auch bei −z.
      const Wq = Wx || (model && model.W), st = (Wq && Wq.stations) || [], zs = new Set();
      const o = Wx ? { mirror: !!Wx.mirror, part: Wx.part } : (model && model.opt), mirror = !!(o && o.mirror), tipPart = o && o.part === 'tip';
      const zTip = st.length ? Math.max.apply(null, st.map(q => +q.z)) : Infinity;
      if (!tipPart) for (const q of st) { const z = +q.z; if (z > lo + 1 && z < hi - 1 && Math.abs(z - zTip) > 1e-6) { zs.add(z); if (mirror) zs.add(-z); } }
      const b = Array.from(zs).filter(z => z > lo + 1 && z < hi - 1).sort((p, q) => p - q);
      const knots = [lo].concat(b, [hi]);
      for (let i = 0; i < knots.length - 1; i++) { if (i > 0) out.push(knots[i]); splitEven(knots[i], knots[i + 1], so.per, out); }
    }
    return out.filter((z, i, a) => i === 0 || z - a[i - 1] > EPS_SEG);
  }
  // Stücklängen aus Ebenen (für Infozeile / Sidebar).
  function segLengths(planes) {
    const R = segRange(); if (!R) return [];
    const k = [R[0]].concat(planes, [R[1]]), out = [];
    for (let i = 0; i < k.length - 1; i++) out.push(k[i + 1] - k[i]);
    return out;
  }
  /* Netz an z = zc teilen: { lo (z ≤ zc), hi (z ≥ zc) }, beide mit ebenem Deckel (Außenkontur + Löcher
   * per Brückenschnitt + Ear-Clipping). Deckel-Tag 1 (Rand / Hinterbau). */
  function splitMeshZ(mesh, zc, pin) {
    const v = mesh.v, tg = mesh.t || [], lo = new Mesh(), hi = new Mesh(), segs = [];
    // Liegt die Ebene (fast) auf Netzpunkten (z. B. Ringlage einer Segmentgrenze), entstehen Splitter-
    // Dreiecke, die als entartet wegfallen -> Ebene um 0,1 mm versetzen (unbedeutend fürs Druckstück).
    for (let k = 0; k < 20; k++) { let hit = false; for (let i = 2; i < v.length; i += 3) if (Math.abs(v[i] - zc) < 0.05) { hit = true; break; } if (!hit) break; zc += 0.1; }
    for (let i = 0; i < v.length; i += 9) {
      const P = [[v[i], v[i + 1], v[i + 2]], [v[i + 3], v[i + 4], v[i + 5]], [v[i + 6], v[i + 7], v[i + 8]]], t = tg[i / 9] | 0;
      const a = cutTri(P, 2, zc, -1), b = cutTri(P, 2, zc, 1);
      for (const q of a.tris) lo.tri(q[0], q[1], q[2], t);
      for (const q of b.tris) hi.tri(q[0], q[1], q[2], t);
      if (a.seg) segs.push(a.seg);
    }
    // Schleifen -> Außenkonturen und Löcher (Verschachtelungstiefe gerade = außen)
    const loops = chainSegs(segs).map(L => L.map(q => ({ x: q[0], y: q[1] })));
    const sArea = P => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p.x * q.y - q.x * p.y; } return a / 2; };
    const info = loops.map(P => ({ P: sArea(P) < 0 ? P.slice().reverse() : P, area: Math.abs(sArea(P)) })).filter(l => l.area > 1e-6);
    for (let i = 0; i < info.length; i++) {
      let best = -1;
      for (let j = 0; j < info.length; j++) if (j !== i && info[j].area > info[i].area && pointInPoly(info[i].P[0], info[j].P)) { if (best < 0 || info[j].area < info[best].area) best = j; }
      info[i].parent = best;
    }
    for (const l of info) { let d = 0, p = l.parent; while (p >= 0) { d++; p = info[p].parent; } l.depth = d; }
    const capTris = [], pins = []; let skipped = 0;
    if (pin && pin.pts) skipped = pin.pts.length;   // manuell: jeder Punkt, der in keiner Schnittfläche gültig liegt, zählt als ausgelassen
    info.forEach((l, i) => {
      if (l.depth % 2) return;
      const holes = info.filter(h => h.parent === i).map(h => h.P);
      let pc = [];
      if (pin && pin.pts) {
        // Manuelle Lage: nur Punkte innerhalb dieser Außenkontur, außerhalb der Löcher und mit Mindestwand
        const need = pin.d / 2 + pin.margin;
        pc = pin.pts.filter(q => pointInPoly(q, l.P) && !holes.some(h => pointInPoly(q, h)) && edgeDist(q, l.P) >= need && holes.every(h => edgeDist(q, h) >= need));
        skipped -= pc.length;
      } else if (pin) pc = pinSpots(l.P, holes, pin);
      const circles = pc.map(c => { const r = pin.d / 2, N = Math.max(16, Math.round(Math.PI * pin.d)), out = []; for (let q = 0; q < N; q++) { const th = 2 * Math.PI * q / N; out.push({ x: c.x + r * Math.cos(th), y: c.y + r * Math.sin(th) }); } return out; });
      const all = holes.concat(circles), poly = all.length ? mergeHoles(l.P, all) : l.P;
      for (const t of earClip(poly)) capTris.push([poly[t[0]], poly[t[1]], poly[t[2]]]);
      circles.forEach((C0, k) => pins.push({ pts: C0, c: pc[k] }));
    });
    // Deckel: CCW in x/y -> Normale +z = Außennormale des unteren Stücks; oberes Stück gespiegelt
    const emit = (m, a, b, c, flip) => flip ? m.tri(a, c, b, 1) : m.tri(a, b, c, 1);
    for (const t of capTris) {
      const a = [t[0].x, t[0].y, zc], b = [t[1].x, t[1].y, zc], c = [t[2].x, t[2].y, zc];
      emit(lo, a, b, c, false); emit(hi, a, b, c, true);
    }
    // Passstifte: Sackloch je Seite (Achse z), Lochgrund + Zylinderwand (Normale zur Lochachse)
    lo.pinEdges = (mesh.pinEdges || []).slice(); hi.pinEdges = (mesh.pinEdges || []).slice();   // Bohrungen früherer Teilungen mitnehmen
    for (const h of pins) for (const side of [[lo, -1, false], [hi, 1, true]]) {
      const [m, dir, flip] = side, zb = zc + dir * pin.depth, H = h.pts, N = H.length;
      m.pinEdges.push({ pts: H, zc, zb, dir: -dir, n: [0, 0, -dir] });   // Vorschau: Lochrand/-grund/Mantellinien (Außennormale der Trennfläche = −dir)
      for (const t of earClip(H)) emit(m, [H[t[0]].x, H[t[0]].y, zb], [H[t[1]].x, H[t[1]].y, zb], [H[t[2]].x, H[t[2]].y, zb], flip);
      for (let q = 0; q < N; q++) {
        const P0 = H[q], P1 = H[(q + 1) % N], T0 = [P0.x, P0.y, zc], T1 = [P1.x, P1.y, zc], B0 = [P0.x, P0.y, zb], B1 = [P1.x, P1.y, zb];
        const nn = nrm3(T0, T1, B1), inward = nn[0] * (h.c.x - (T0[0] + B1[0]) / 2) + nn[1] * (h.c.y - (T0[1] + B1[1]) / 2) > 0;
        if (inward) { m.tri(T0, T1, B1, 1); m.tri(T0, B1, B0, 1); } else { m.tri(T0, B1, T1, 1); m.tri(T0, B0, B1, 1); }
      }
    }
    return { lo, hi, pins: pins.length, skipped };
  }
  /* Automatische Lage der Passstifte in einer Schnittfläche (Außenkontur CCW + Löcher): Raster-Abtastung,
   * greedy jeweils der Punkt mit größtem min(Randabstand, halber Abstand zum nächsten gesetzten Stift)
   * -> Stifte sitzen an den dicksten Stellen und weit auseinander. Bedingung: Randabstand ≥ r + Mindestwand. */
  function pinSpots(outer, holes, pin) {
    const r = pin.d / 2, need = r + pin.margin, out = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of outer) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const step = Math.max(0.5, Math.max(x1 - x0, y1 - y0) / 80), cand = [];
    for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) {
      const q = { x, y };
      if (!pointInPoly(q, outer) || holes.some(h => pointInPoly(q, h))) continue;
      let d = edgeDist(q, outer); for (const h of holes) d = Math.min(d, edgeDist(q, h));
      if (d >= need) cand.push({ x, y, d });
    }
    for (let k = 0; k < pin.n && cand.length; k++) {
      let best = null, bs = -Infinity;
      for (const c of cand) {
        let sc = c.d;
        for (const o of out) { const dd = Math.hypot(c.x - o.x, c.y - o.y); if (dd < 2 * r + pin.margin) { sc = -Infinity; break; } sc = Math.min(sc, dd / 2); }
        if (sc > bs) { bs = sc; best = c; }
      }
      if (!best || bs === -Infinity) break;
      out.push({ x: best.x, y: best.y });
    }
    return out;
  }
  // Netz an allen Ebenen (aufsteigend) teilen -> Stücke von der Wurzel (kleines z) nach außen.
  // pin: Objekt (alle Trennstellen gleich) oder Funktion (i, body) -> Objekt | null je Trennstelle; body = Körperkennung für manuelle Lagen.
  function splitMeshAll(mesh, planes, pin, body) {
    const out = []; let rest = mesh; out.pins = 0; out.skipped = 0;
    planes.forEach((z, i) => { const r = splitMeshZ(rest, z, typeof pin === 'function' ? pin(i, body) : pin); out.push(r.lo); rest = r.hi; out.pins += r.pins || 0; out.skipped += r.skipped || 0; });
    out.push(rest);
    return out;
  }
  // Mehrere STL-Dateien in einen im Explorer gewählten Ordner schreiben (sonst nacheinander als Download).
  async function saveSTLMany(list) {
    if (demoBlocked()) return;
    if (!list.length) return;
    if (App.FS_SUPPORTED && window.showDirectoryPicker) {
      const dh = App.dirHandles || {};
      let root;
      try { root = await window.showDirectoryPicker({ mode: 'readwrite', startIn: dh.svStl || dh.save || 'documents' }); }
      catch (e) { return; }   // Abbruch
      try {
        for (const it of list) { const fh = await root.getFileHandle(it.name, { create: true }); const w = await fh.createWritable(); await w.write(toBinarySTL(it.mesh.v)); await w.close(); }
        if (App.toast) App.toast(T('Gespeichert: ') + list.length + ' ' + T('Dateien') + '  (' + (root.name || T('Ordner')) + ')');
      } catch (e) { alert(T('Speichern fehlgeschlagen: ') + (e && e.message ? e.message : e)); }
      return;
    }
    let i = 0; for (const it of list) setTimeout(() => App.anchorDownload(it.name, toBinarySTL(it.mesh.v), 'model/stl'), 300 * i++);
  }
  /* Export eines Körpers: ohne Segmentierung eine STL (Speichern-Dialog), mit Segmentierung je
   * Stück eine Datei name_teilNN.stl (Ordner-Dialog). Die Teilung erfolgt VOR der Exporttransformation
   * (z = Spannweite); jedes Stück wird danach einzeln umgedreht / gedreht / auf die Ecke gesetzt. */
  function saveOut(mesh, opt, cavityFlip, name, body) {
    if (demoBlocked()) return;
    const so = segOpts(), planes = so.on ? segPlanes(so) : [];
    if (!planes.length) { saveSTL(exportTransform(mesh, opt, cavityFlip), name); return; }
    let parts; try { parts = splitMeshAll(mesh, planes, (i, b) => segPinAt(so, i, b), body); } catch (e) { console.error('Formenbau Segmentierung:', e); alert(T('Segmentierung fehlgeschlagen (Vorschau ungeteilt):') + ' ' + (e && e.message ? e.message : e)); return; }
    const base = name.replace(/\.stl$/i, ''), pad = parts.length > 99 ? 3 : 2;
    if (so.pin && App.toast) App.toast(T('Passstifte gesetzt:') + ' ' + parts.pins + ' (' + planes.length + ' ' + T('Trennstellen') + ')' + (parts.skipped ? ' · ' + T('manuell außerhalb / zu nah am Rand:') + ' ' + parts.skipped : ''));
    const list = parts.map((m, i) => ({ mesh: exportTransform(m, opt, cavityFlip), name: base + '_' + T('teil') + String(i + 1).padStart(pad, '0') + '.stl' }));
    saveSTLMany(list);
  }

  // ---------- Schnittansicht -------------------------------------------------
  /* Ebene senkrecht zur Achse k (0 x, 1 y, 2 z) bei pos. keep(v) > 0 = behalten.
   * Dreieck gegen die Ebene kappen: liefert 1–2 Dreiecke der behaltenen Seite und
   * (falls geschnitten) die Schnittstrecke. Punkte als [x,y,z]. */
  const AXI = { x: 0, y: 1, z: 2 };
  function cutTri(P, k, pos, sg) {
    const d = P.map(q => sg * (q[k] - pos));
    const inside = d.filter(v => v >= 0).length;
    if (inside === 3) return { tris: [P], seg: null };
    if (inside === 0) return { tris: [], seg: null };
    const poly = [], seg = [];
    for (let i = 0; i < 3; i++) {
      const a = P[i], b = P[(i + 1) % 3], da = d[i], db = d[(i + 1) % 3];
      if (da >= 0) poly.push(a);
      if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; q[k] = pos; poly.push(q); seg.push(q); }
    }
    const tris = [];
    for (let i = 1; i < poly.length - 1; i++) tris.push([poly[0], poly[i], poly[i + 1]]);
    return { tris, seg: seg.length === 2 ? seg : null };
  }
  // Strecken zu geschlossenen Schleifen verketten (Endpunkte auf 1e-4 gerundet).
  function chainSegs(segs) {
    const key = q => q.map(v => Math.round(v * 1e4)).join(',');
    const map = new Map();   // key -> [segIdx...]
    segs.forEach((sg, i) => { for (const q of sg) { const k = key(q); if (!map.has(k)) map.set(k, []); map.get(k).push(i); } });
    const used = new Uint8Array(segs.length), loops = [];
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue; used[i] = 1;
      const loop = [segs[i][0], segs[i][1]];
      let guard = 0;
      while (guard++ < segs.length + 2) {
        const end = loop[loop.length - 1], cands = map.get(key(end)) || [];
        let nxt = -1; for (const c of cands) if (!used[c]) { nxt = c; break; }
        if (nxt < 0) break;
        used[nxt] = 1;
        const sg = segs[nxt], q = key(sg[0]) === key(end) ? sg[1] : sg[0];
        if (key(q) === key(loop[0])) break;
        loop.push(q);
      }
      if (loop.length >= 3) loops.push(loop);
    }
    return loops;
  }
  function cutSpec() {
    if (!C('formCutOn')) return null;
    const ax = C('formCutAxis'); return { k: AXI[ax] == null ? 2 : AXI[ax], ax, pos: +C('formCutPos') || 0, sg: C('formCutSide') === '+' ? -1 : 1, fill: !!C('formCutFill') };
  }
  // Schnittschleifen aller Quellen (mit Vorschau-Verschiebung dy/dz), 3D-Punkte.
  function sectionLoops(sources, cut) {
    const out = [];
    for (const s of sources) {
      const v = s.mesh.v, dy = s.dy || 0, dz = s.dz || 0, segs = [];
      for (let i = 0; i < v.length; i += 9) {
        const P = [[v[i], v[i + 1] + dy, v[i + 2] + dz], [v[i + 3], v[i + 4] + dy, v[i + 5] + dz], [v[i + 6], v[i + 7] + dy, v[i + 8] + dz]];
        const r = cutTri(P, cut.k, cut.pos, cut.sg); if (r.seg) segs.push(r.seg);
      }
      for (const L of chainSegs(segs)) out.push({ pts: L, h: s.h, sat: s.sat, l: s.l, src: s });
    }
    return out;
  }
  // 2D-Koordinaten in der Schnittebene: (u, v) = Ebenenachsen.
  function planeUV(k) { return k === 2 ? [0, 1, 'X', 'Y'] : k === 0 ? [2, 1, 'Z', 'Y'] : [0, 2, 'X', 'Z']; }
  function loopArea(L, iu, iv) { let a = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; a += p[iu] * q[iv] - q[iu] * p[iv]; } return Math.abs(a) / 2; }

  // ---------- Vorschau (eigene Canvas, orthografischer Orbit) --------------
  let canvas = null, ctx = null, W = 0, H = 0;
  let cam = { yaw: 0.9, pitch: 0.35, zoom: 1, px: 0, py: 0 };
  const CAM0 = Object.assign({}, cam);
  let center = [0, 0, 0], radius = 100;
  let pivot = null;            // eigener Drehpunkt (Mausrad-Doppelklick), sonst Modellmitte
  let lastFaces = [];          // zuletzt gezeichnete Dreiecke (Bildschirm + Welt) für die Trefferprüfung
  function resetCam(over) { cam = Object.assign({}, CAM0, over || {}); pivot = null; }
  // Weltpunkt unter dem Bildschirmpunkt (x, y): vorderstes schattiertes Dreieck; im Drahtgitter
  // nächster Netz-/Ringpunkt in 14 px Umkreis.
  function pick3d(x, y) {
    let best = null;
    const faces = lastFaces.length ? lastFaces : pickFaces(x, y);
    for (const f of faces) {
      const [a, b, c] = f.p;
      const den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y); if (Math.abs(den) < 1e-9) continue;
      const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / den, v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / den, w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      if (!best || f.d < best.d) { const t = f.t; best = { d: f.d, pt: [u * t[0][0] + v * t[1][0] + w * t[2][0], u * t[0][1] + v * t[1][1] + w * t[2][1], u * t[0][2] + v * t[1][2] + w * t[2][2]] }; }
    }
    if (best) return best.pt;
    let dm = 14, pt = null;
    for (const s of model && model.src || []) {
      const dy = s.dy || 0, dz = s.dz || 0;
      const test = (px, py, pz) => { const q = scr(px, py, pz), d = Math.hypot(q.x - x, q.y - y); if (d < dm || (d === dm && pt && q.d < pt.d)) { dm = d; pt = [px, py, pz]; pt.d = q.d; } };
      if (s.rings) { for (const r of s.rings) for (const q of r.pts) test(q.x, q.y + dy, (q.z == null ? r.z : q.z) + dz); }
      else { const v = s.mesh.v; for (let i = 0; i < v.length; i += 3) test(v[i], v[i + 1] + dy, v[i + 2] + dz); }
    }
    return pt ? [pt[0], pt[1], pt[2]] : null;
  }
  // GL-Pfad: Dreiecke erst bei Bedarf projizieren (nur die, deren Bildschirm-Box den Punkt enthält), Schnitt wie in der Ansicht.
  function pickFaces(x, y) {
    const out = [], cut = cutSpec();
    for (const s of model && model.src || []) {
      const v = s.mesh.v, dy = s.dy || 0, dz = s.dz || 0;
      for (let i = 0; i < v.length; i += 9) {
        let tris = [[[v[i], v[i + 1] + dy, v[i + 2] + dz], [v[i + 3], v[i + 4] + dy, v[i + 5] + dz], [v[i + 6], v[i + 7] + dy, v[i + 8] + dz]]];
        if (cut) tris = cutTri(tris[0], cut.k, cut.pos, cut.sg).tris;
        for (const t of tris) {
          const p0 = scr(t[0][0], t[0][1], t[0][2]), p1 = scr(t[1][0], t[1][1], t[1][2]), p2 = scr(t[2][0], t[2][1], t[2][2]);
          if (x < Math.min(p0.x, p1.x, p2.x) || x > Math.max(p0.x, p1.x, p2.x) || y < Math.min(p0.y, p1.y, p2.y) || y > Math.max(p0.y, p1.y, p2.y)) continue;
          out.push({ p: [p0, p1, p2], t, d: (p0.d + p1.d + p2.d) / 3 });
        }
      }
    }
    return out;
  }
  // Drehpunkt auf den Modellpunkt unter dem Cursor setzen; der Punkt bleibt dabei am Bildschirm stehen.
  function setPivotAt(x, y) {
    const pt = pick3d(x, y); if (!pt) return false;
    const q = scr(pt[0], pt[1], pt[2]);
    pivot = pt; center = pt; cam.px = q.x - W / 2; cam.py = q.y - H / 2;
    return true;
  }
  let dragging = false, dragMode = '', lastX = 0, lastY = 0, bound = false;
  const LIGHT = (() => { const l = [-0.35, 0.55, 0.75]; const n = Math.hypot(...l); return l.map(x => x / n); })();
  function rot(n) {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const x1 = n[0] * cy + n[2] * sy, z1 = -n[0] * sy + n[2] * cy;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    return [x1, n[1] * cp - z1 * sp, n[1] * sp + z1 * cp];
  }
  function scr(x, y, z) {
    const r = rot([x - center[0], y - center[1], z - center[2]]);
    const s = 0.42 * Math.min(W, H) / radius * cam.zoom;
    return { x: W / 2 + cam.px + s * r[0], y: H / 2 + cam.py - s * r[1], d: r[2] };
  }
  function fit() {
    canvas = document.getElementById('cForm'); if (!canvas) return false;
    const dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
    ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!bound) bindCanvas();
    if (gl) glFit();
    return true;
  }
  // ---------- WebGL2-Renderer für die 3D-Ansicht --------------------------
  /* Eine zweite Canvas liegt HINTER der 2D-Canvas und zeichnet die schattierten Netze mit
   * Z-Buffer (statt Maler-Sortierung je Dreieck auf der CPU): kein Ruckeln beim Drehen, keine
   * Sortierfehler an sich durchdringenden Flächen. Der Schnitt wird als Clip-Ebene im Shader
   * ausgeführt (kein Neuaufbau der Puffer beim Verschieben), die Schnittfläche per Stencil-
   * Parität gefüllt (Löcher bleiben frei). Darstellung: „fein“ = glatte Normalen + Glanzlicht in
   * voller Auflösung, „schnell“ = flache Schattierung in Bildschirmauflösung, beim Drehen halbiert.
   * Zebra-Analyse: Streifen aus der Spiegelrichtung (wie Zebra-Reflexionen in CAD). Alles Übrige
   * (Schnittebene, Kämme, Achsen, Gizmo, Bohrungskanten) bleibt auf der 2D-Canvas darüber.
   * Ohne WebGL2 (oder Darstellung „kompatibel“) zeichnet der alte Canvas-2D-Pfad. */
  let glc = null, gl = null, glP = null, glL = null, glVao = null, glTried = false, glCutBuf = null;
  const glBufs = new Map();        // mesh -> {buf, n, used}
  const HALF = (() => { const h = [LIGHT[0], LIGHT[1], LIGHT[2] - 1]; const n = Math.hypot(...h) || 1; return h.map(x => x / n); })();
  function glInit() {
    if (glTried || !canvas) return; glTried = true;
    try {
      glc = document.createElement('canvas'); glc.id = 'cFormGL';
      glc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
      canvas.parentNode.insertBefore(glc, canvas);
      gl = glc.getContext('webgl2', { antialias: true, alpha: false, depth: true, stencil: true });
      if (!gl) throw new Error('no webgl2');
      const VS = `#version 300 es
        in vec3 aPos; in vec3 aNrm; in float aTag;
        uniform vec3 uCenter; uniform vec3 uOff; uniform float uYaw; uniform float uPitch; uniform vec4 uProj; uniform float uZScale;
        out vec3 vCam; out vec3 vNrm; out vec3 vWorld; flat out int vTag;
        vec3 rot(vec3 p){ float cy = cos(uYaw), sy = sin(uYaw), cp = cos(uPitch), sp = sin(uPitch);
          float x1 = p.x*cy + p.z*sy, z1 = -p.x*sy + p.z*cy; return vec3(x1, p.y*cp - z1*sp, p.y*sp + z1*cp); }
        void main(){
          vWorld = aPos + uOff;
          vec3 c = rot(vWorld - uCenter); vCam = c; vNrm = rot(aNrm); vTag = int(aTag + 0.5);
          gl_Position = vec4(uProj.z + uProj.x*c.x, uProj.w + uProj.y*c.y, c.z*uZScale, 1.0);
        }`;
      const FS = `#version 300 es
        precision highp float;
        in vec3 vCam; in vec3 vNrm; in vec3 vWorld; flat in int vTag;
        uniform vec3 uHSL[3]; uniform vec3 uLight; uniform vec3 uHalf; uniform vec4 uClip;
        uniform int uSmooth; uniform int uSpec; uniform vec4 uZebra;   // x: an, y: Streifen, z: Bezug (0 Ansicht / 1 Bauteil), w: Staerke
        uniform vec2 uZebraAx; uniform float uYaw; uniform float uPitch;   // Streifenachse (cos, sin) und Kameradrehung (fuer Bauteil-Bezug)
        vec3 unrot(vec3 v){ float cy = cos(uYaw), sy = sin(uYaw), cp = cos(uPitch), sp = sin(uPitch);   // Umkehrung von rot() im Vertex-Shader
          float y1 = v.y*cp + v.z*sp, z1 = -v.y*sp + v.z*cp; return vec3(v.x*cy - z1*sy, y1, v.x*sy + z1*cy); }
        out vec4 o;
        vec3 hsl2rgb(float h, float s, float l){
          float c = (1.0 - abs(2.0*l - 1.0)) * s; float hp = h/60.0; float x = c*(1.0 - abs(mod(hp,2.0)-1.0));
          vec3 r = hp<1.0?vec3(c,x,0):hp<2.0?vec3(x,c,0):hp<3.0?vec3(0,c,x):hp<4.0?vec3(0,x,c):hp<5.0?vec3(x,0,c):vec3(c,0,x);
          return r + (l - c*0.5);
        }
        void main(){
          if (dot(vWorld, uClip.xyz) + uClip.w < 0.0) discard;
          vec3 nf = normalize(cross(dFdx(vCam), dFdy(vCam)));
          vec3 n = uSmooth == 1 ? normalize(vNrm) : nf;
          if (uSmooth == 1 && dot(n, nf) < 0.0) n = -n;     // Vorzeichen an die Flaeche angleichen
          if (n.z > 0.0) n = -n;                            // zur Kamera drehen (beidseitig)
          float lam = max(0.0, dot(n, uLight));
          vec3 hsl = uHSL[vTag < 1 ? 0 : (vTag == 1 ? 1 : 2)];
          float l = hsl.z * (0.36 + 0.64*lam);
          if (uSpec == 1) { float sp = max(0.0, dot(n, uHalf)); sp *= sp; sp *= sp; sp *= sp; l += sp*18.0; }
          vec3 rgb = hsl2rgb(hsl.x, hsl.y/100.0, min(96.0, l)/100.0);
          if (uZebra.x > 0.5) {
            vec3 r = reflect(vec3(0.0, 0.0, 1.0), n);        // Spiegelrichtung des Blicks (orthografisch)
            // Streifenachse: Ansicht = in der Bildebene (0 senkrecht, 90 waagrecht); Bauteil = feste Achse im Modell
            // (Sehne/Spannweite-Ebene, 0 = Sehne, 90 = Spannweite) – so laufen die Streifen ueber Randbogen und Winglet durch.
            float t = uZebra.z > 0.5 ? dot(unrot(r), vec3(uZebraAx.x, 0.0, uZebraAx.y)) : dot(r.xy, uZebraAx);
            t = t * 0.5 + 0.5;                                  // Streifenmuster als Kugelumgebung (stetig, wie in CAD)
            float ph = t * uZebra.y * 6.2831853, s = sin(ph), w = fwidth(ph);
            float st = smoothstep(-w, w, s);
            vec3 zc = mix(vec3(0.06), vec3(0.97), st);
            rgb = mix(rgb, zc, uZebra.w);
          }
          o = vec4(rgb, 1.0);
        }`;
      const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      glP = gl.createProgram(); gl.attachShader(glP, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(glP, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(glP);
      if (!gl.getProgramParameter(glP, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glP));
      glL = {};
      for (const u of ['uCenter', 'uOff', 'uYaw', 'uPitch', 'uProj', 'uZScale', 'uHSL', 'uLight', 'uHalf', 'uClip', 'uSmooth', 'uSpec', 'uZebra', 'uZebraAx']) glL[u] = gl.getUniformLocation(glP, u);
      glL.aPos = gl.getAttribLocation(glP, 'aPos'); glL.aNrm = gl.getAttribLocation(glP, 'aNrm'); glL.aTag = gl.getAttribLocation(glP, 'aTag');
      glVao = gl.createVertexArray();
      glc.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; glBufs.clear(); glCutBuf = null; }, false);
    } catch (e) {
      console.warn('Formenbau: WebGL2 nicht verfügbar, Canvas-2D-Darstellung:', e && e.message);
      gl = null; if (glc && glc.parentNode) glc.parentNode.removeChild(glc); glc = null;
    }
  }
  function renderMode() { const m = C('formRender'); return m === 'fast' || m === '2d' ? m : 'fine'; }
  function glActive() { if (!glTried) glInit(); return !!gl && !C('formWire') && renderMode() !== '2d'; }
  // Auflösung der GL-Canvas: fein = Geräteauflösung, schnell = Bildschirmauflösung (beim Drehen halbiert).
  function glFit() {
    if (!gl || !glc) return;
    const dpr = window.devicePixelRatio || 1, f = renderMode() === 'fast' ? (dragging && dragMode === 'rot' ? 0.5 : 1) : dpr;
    const w = Math.max(1, Math.round(W * f)), h = Math.max(1, Math.round(H * f));
    if (glc.width !== w || glc.height !== h) { glc.width = w; glc.height = h; }
  }
  function cssRGB(c) {
    try {
      ctx.fillStyle = c; const n = ctx.fillStyle; let m = /^#([0-9a-f]{6})$/i.exec(n);
      if (m) return [parseInt(m[1].slice(0, 2), 16) / 255, parseInt(m[1].slice(2, 4), 16) / 255, parseInt(m[1].slice(4, 6), 16) / 255];
      m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(n); if (m) return [m[1] / 255, m[2] / 255, m[3] / 255];
    } catch (e) {}
    return [0.06, 0.07, 0.09];
  }
  /* Vertexpuffer je Netz (Cache): Lage, geglättete Normale, Tag. Glatte Normalen = Mittel der
   * Flächennormalen aller Dreiecke am selben Punkt, aber nur solcher, die weniger als ~40° von der
   * eigenen Fläche abweichen (Kanten von Flansch/Trennplatte bleiben scharf). */
  function glMesh(mesh) {
    let b = glBufs.get(mesh); if (b) { b.used = true; return b; }
    const v = mesh.v, tg = mesh.t, n = Math.floor(v.length / 9), out = new Float32Array(n * 3 * 7);
    const fn = new Float32Array(n * 3), key = new Array(n * 3), map = new Map();
    const kOf = (x, y, z) => (Math.round(x * 1e3)) + ',' + (Math.round(y * 1e3)) + ',' + (Math.round(z * 1e3));
    for (let i = 0; i < n; i++) {
      const o = i * 9, ux = v[o + 3] - v[o], uy = v[o + 4] - v[o + 1], uz = v[o + 5] - v[o + 2], vx = v[o + 6] - v[o], vy = v[o + 7] - v[o + 1], vz = v[o + 8] - v[o + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz) || 1;
      fn[i * 3] = nx / L; fn[i * 3 + 1] = ny / L; fn[i * 3 + 2] = nz / L;
      for (let c = 0; c < 3; c++) { const k = kOf(v[o + c * 3], v[o + c * 3 + 1], v[o + c * 3 + 2]); key[i * 3 + c] = k; let a = map.get(k); if (!a) { a = []; map.set(k, a); } a.push(i); }
    }
    const COS = Math.cos(40 * Math.PI / 180);
    for (let i = 0; i < n; i++) {
      const o = i * 9, tag = tg && tg[i] != null ? tg[i] : 0, fx = fn[i * 3], fy = fn[i * 3 + 1], fz = fn[i * 3 + 2];
      for (let c = 0; c < 3; c++) {
        let sx = 0, sy = 0, sz = 0;
        for (const j of map.get(key[i * 3 + c])) { const gx = fn[j * 3], gy = fn[j * 3 + 1], gz = fn[j * 3 + 2]; if (gx * fx + gy * fy + gz * fz >= COS) { sx += gx; sy += gy; sz += gz; } }
        const L = Math.hypot(sx, sy, sz) || 1, q = (i * 3 + c) * 7;
        out[q] = v[o + c * 3]; out[q + 1] = v[o + c * 3 + 1]; out[q + 2] = v[o + c * 3 + 2];
        out[q + 3] = sx / L; out[q + 4] = sy / L; out[q + 5] = sz / L; out[q + 6] = tag;
      }
    }
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, out, gl.STATIC_DRAW);
    b = { buf, n: n * 3, used: true }; glBufs.set(mesh, b); return b;
  }
  function glAttribs() {
    gl.enableVertexAttribArray(glL.aPos); gl.vertexAttribPointer(glL.aPos, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(glL.aNrm); gl.vertexAttribPointer(glL.aNrm, 3, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(glL.aTag); gl.vertexAttribPointer(glL.aTag, 1, gl.FLOAT, false, 28, 24);
  }
  function zebraOpts() {
    const a = zebraAngle() * Math.PI / 180;
    return { on: !!C('formZebraOn'), n: Math.max(4, Math.min(120, Math.round(+C('formZebraN') || 60))), ref: C('formZebraRef') === 'view' ? 0 : 1,
      ax: [Math.cos(a), Math.sin(a)], mix: Math.max(0, Math.min(1, (+C('formZebraMix') || 0) / 100)) };
  }
  // Winkel der Streifenachse (Grad); Altstände ohne Winkel: aus der früheren Richtung senkrecht/waagrecht übernehmen.
  function zebraAngle() {
    let a = C('formZebraAng');
    if (a == null || !isFinite(+a)) a = C('formZebraDir') === 'v' ? 0 : 90;
    return Math.max(0, Math.min(180, +a));
  }
  // Schnittfläche: Schleifen in der Ebene triangulieren (Ohrenschnitt), als Dreiecke bei cut.pos.
  function glCutFaceTris(loops, cut) {
    const k = cut.k, [iu, iv] = planeUV(k), tris = [];
    for (const L of loops) {
      const poly = L.pts.map(q => ({ x: q[iu], y: q[iv] }));
      let T3; try { T3 = earClip(poly, true); } catch (e) { T3 = []; }
      for (const t of T3) for (const i of t) { const P = [0, 0, 0]; P[k] = cut.pos; P[iu] = poly[i].x; P[iv] = poly[i].y; tris.push(P[0], P[1], P[2], 0, 0, 0, 0); }
    }
    return new Float32Array(tris);
  }
  function glDraw(sources, cut, loops) {
    glFit();
    const bg = cssRGB(col('--bg', '#0f1216')), mode = renderMode(), zb = zebraOpts();
    gl.viewport(0, 0, glc.width, glc.height);
    gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clearStencil(0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    for (const b of glBufs.values()) b.used = false;
    gl.useProgram(glP); gl.bindVertexArray(glVao);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE); gl.disable(gl.STENCIL_TEST);
    const s = 0.42 * Math.min(W, H) / radius * cam.zoom;
    gl.uniform4f(glL.uProj, 2 * s / W, 2 * s / H, 2 * cam.px / W, -2 * cam.py / H);
    gl.uniform1f(glL.uZScale, 1 / (radius * 3));
    gl.uniform3f(glL.uCenter, center[0], center[1], center[2]);
    gl.uniform1f(glL.uYaw, cam.yaw); gl.uniform1f(glL.uPitch, cam.pitch);
    gl.uniform3f(glL.uLight, LIGHT[0], LIGHT[1], LIGHT[2]); gl.uniform3f(glL.uHalf, HALF[0], HALF[1], HALF[2]);
    const smooth = mode === 'fine' || zb.on;
    gl.uniform1i(glL.uSmooth, smooth ? 1 : 0); gl.uniform1i(glL.uSpec, mode === 'fine' && !zb.on ? 1 : 0);
    gl.uniform4f(glL.uZebra, zb.on ? 1 : 0, zb.n, zb.ref, zb.mix); gl.uniform2f(glL.uZebraAx, zb.ax[0], zb.ax[1]);
    if (cut) { const c = [0, 0, 0]; c[cut.k] = cut.sg; gl.uniform4f(glL.uClip, c[0], c[1], c[2], -cut.sg * cut.pos); } else gl.uniform4f(glL.uClip, 0, 0, 0, 1);
    for (const src of sources) {
      const b = glMesh(src.mesh);
      const hsl = [src.h, src.sat, src.l, src.h2 != null ? src.h2 : src.h, src.sat2 != null ? src.sat2 : src.sat, src.l2 != null ? src.l2 : src.l,
        src.h3 != null ? src.h3 : src.h, src.sat3 != null ? src.sat3 : src.sat, src.l3 != null ? src.l3 : src.l];
      gl.uniform3fv(glL.uHSL, new Float32Array(hsl));
      gl.uniform3f(glL.uOff, 0, src.dy || 0, src.dz || 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.buf); glAttribs();
      gl.drawArrays(gl.TRIANGLES, 0, b.n);
    }
    // Schnittfläche (gefüllt): Stencil-Parität über alle Schleifen -> Löcher bleiben frei.
    if (cut && cut.fill && loops && loops.length) {
      const nrm = [0, 0, 0]; nrm[cut.k] = -cut.sg;
      if (rot(nrm)[2] <= 0.02) {
        const arr = glCutFaceTris(loops, cut);
        if (arr.length) {
          if (!glCutBuf) glCutBuf = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, glCutBuf); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW); glAttribs();
          gl.uniform3f(glL.uOff, 0, 0, 0); gl.uniform4f(glL.uClip, 0, 0, 0, 1); gl.uniform1i(glL.uSmooth, 0); gl.uniform1i(glL.uSpec, 0); gl.uniform4f(glL.uZebra, 0, 0, 0, 0); gl.uniform2f(glL.uZebraAx, 1, 0);
          const s0 = loops[0].src || {}, hsl = [s0.h || 0, Math.round((s0.sat || 0) * 0.5), 82];
          gl.uniform3fv(glL.uHSL, new Float32Array([...hsl, ...hsl, ...hsl]));
          gl.enable(gl.STENCIL_TEST);
          gl.colorMask(false, false, false, false); gl.depthMask(false); gl.disable(gl.DEPTH_TEST);
          gl.stencilFunc(gl.ALWAYS, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
          gl.drawArrays(gl.TRIANGLES, 0, arr.length / 7);
          gl.colorMask(true, true, true, true); gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
          gl.stencilFunc(gl.EQUAL, 1, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
          gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -2);
          gl.drawArrays(gl.TRIANGLES, 0, arr.length / 7);
          gl.disable(gl.POLYGON_OFFSET_FILL); gl.disable(gl.STENCIL_TEST);
        }
      }
    }
    gl.bindVertexArray(null);
    for (const [k, b] of glBufs) if (!b.used) { gl.deleteBuffer(b.buf); glBufs.delete(k); }
  }
  // Schnittschleifen aller Quellen, gepuffert je Schnittlage (sie hängen nicht von der Kamera ab).
  function cutLoopsFor(sources, cut) {
    if (!cut || !model) return [];
    const key = [cut.k, cut.pos, cut.sg].concat(sources.map(s => (s.dy || 0) + '/' + (s.dz || 0))).join('|');
    const c = model.loopCache;
    if (c && c.key === key && c.meshes.length === sources.length && c.meshes.every((m, i) => m === sources[i].mesh)) return c.loops;
    const loops = sectionLoops(sources, cut);
    model.loopCache = { key, meshes: sources.map(s => s.mesh), loops };
    return loops;
  }
  function col(name, fb) { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb; } catch (e) { return fb; } }
  function drawShaded(sources, cut) {
    const faces = [], step = 9, wire = !!C('formWire');
    lastFaces = [];
    for (const s of sources) {
      if (wire) {
        const v = s.mesh.v, dz = s.dz || 0, dy = s.dy || 0;
        const colW = 'hsla(' + s.h + ',' + s.sat + '%,' + Math.min(85, s.l + 10) + '%,';
        if (s.rings) {
          // Ringe (Rippen) als Umrisse + Längslinien (Stringer) an jedem k-ten Profilpunkt.
          const R = s.rings, n = R[0].pts.length, stride = Math.max(1, Math.round(n / 28));
          const P = (r, i) => { const p = r.pts[Math.min(i, r.pts.length - 1)]; return scr(p.x, p.y + dy, (p.z == null ? r.z : p.z) + dz); };
          ctx.beginPath();
          for (const r of R) { for (let i = 0; i < r.pts.length; i++) { const q = P(r, i); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); } ctx.closePath(); }
          ctx.lineWidth = 1; ctx.strokeStyle = colW + '0.85)'; ctx.stroke();
          ctx.beginPath();
          for (let i = 0; i < n; i += stride) { for (let k = 0; k < R.length; k++) { const q = P(R[k], i); k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); } }
          ctx.lineWidth = 0.7; ctx.strokeStyle = colW + '0.45)'; ctx.stroke(); ctx.lineWidth = 1;
        } else {
        // Drahtgitter: alle Kanten (auch Rückseite) in einem Zug, keine Tiefensortierung.
        ctx.beginPath();
        for (let i = 0; i < v.length; i += step) {
          let tris = [[[v[i], v[i + 1] + dy, v[i + 2] + dz], [v[i + 3], v[i + 4] + dy, v[i + 5] + dz], [v[i + 6], v[i + 7] + dy, v[i + 8] + dz]]];
          if (cut) tris = cutTri(tris[0], cut.k, cut.pos, cut.sg).tris;
          for (const t of tris) {
            const p0 = scr(t[0][0], t[0][1], t[0][2]), p1 = scr(t[1][0], t[1][1], t[1][2]), p2 = scr(t[2][0], t[2][1], t[2][2]);
            ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.closePath();
          }
        }
        ctx.lineWidth = 0.6; ctx.strokeStyle = colW + '0.55)'; ctx.stroke(); ctx.lineWidth = 1;
        }
        if (cut) drawCutLoops(cutLoopsFor(sources, cut).filter(L => L.src === s));
        drawPinEdges(s, true);
        continue;
      }
      const v = s.mesh.v, tg = s.mesh.t, dz = s.dz || 0, dy = s.dy || 0, segs = [];
      for (let i = 0; i < v.length; i += step) {
        const ux = v[i + 3] - v[i], uy = v[i + 4] - v[i + 1], uz = v[i + 5] - v[i + 2];
        const vx = v[i + 6] - v[i], vy = v[i + 7] - v[i + 1], vz = v[i + 8] - v[i + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
        const nc = rot([nx, ny, nz]); if (nc[2] > 0.02) continue;
        let tris = [[[v[i], v[i + 1] + dy, v[i + 2] + dz], [v[i + 3], v[i + 4] + dy, v[i + 5] + dz], [v[i + 6], v[i + 7] + dy, v[i + 8] + dz]]];
        if (cut) { const r = cutTri(tris[0], cut.k, cut.pos, cut.sg); tris = r.tris; if (r.seg) segs.push(r.seg); }
        const lam = Math.max(0, nc[0] * LIGHT[0] + nc[1] * LIGHT[1] + nc[2] * LIGHT[2]);
        const tag = (s.h2 != null || s.h3 != null) && tg ? tg[i / 9] : 0;
        const hh = tag === 1 ? s.h2 : tag === 2 ? s.h3 : s.h, ss = tag === 1 ? s.sat2 : tag === 2 ? s.sat3 : s.sat, ll = tag === 1 ? s.l2 : tag === 2 ? s.l3 : s.l;
        for (const t of tris) {
          const p0 = scr(t[0][0], t[0][1], t[0][2]), p1 = scr(t[1][0], t[1][1], t[1][2]), p2 = scr(t[2][0], t[2][1], t[2][2]);
          faces.push({ p: [p0, p1, p2], t, d: (p0.d + p1.d + p2.d) / 3, h: hh, sat: ss, l: Math.min(92, ll * (0.36 + 0.64 * lam)) });
        }
      }
      // Schnittfläche: Normale zeigt zur entfernten Seite; nur zeichnen, wenn sie zur Kamera weist.
      const nrm = [0, 0, 0]; nrm[cut ? cut.k : 0] = cut ? -cut.sg : 0;
      if (cut && rot(nrm)[2] <= 0.02) {
        // Rückseiten wurden oben verworfen -> Schnittstrecken separat aus ALLEN Dreiecken holen
        const loops = cutLoopsFor(sources, cut).filter(L => L.src === s);
        for (const L of loops) {
          const p = L.pts.map(q => scr(q[0], q[1], q[2]));
          const d = p.reduce((a, q) => a + q.d, 0) / p.length - 1e-3;
          faces.push({ p, d, h: s.h, sat: Math.round(s.sat * 0.5), l: 82, cutFace: true, fill: cut.fill });
        }
      }
    }
    faces.sort((a, b) => b.d - a.d);
    lastFaces = faces.filter(f => !f.cutFace);
    ctx.lineJoin = 'round'; ctx.lineWidth = 1;
    for (const f of faces) {
      ctx.beginPath(); f.p.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath();
      if (f.cutFace) {
        if (f.fill) { ctx.fillStyle = 'hsl(' + f.h + ',' + f.sat + '%,' + f.l + '%)'; ctx.fill(); }
        ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
      } else {
        ctx.fillStyle = ctx.strokeStyle = 'hsl(' + f.h + ',' + f.sat + '%,' + Math.round(f.l) + '%)';
        ctx.fill(); ctx.stroke();
      }
    }
    for (const s of sources) drawPinEdges(s, false);
    return faces.length;
  }
  // Steckungsbohrungen in der Vorschau: Lochrand, Lochgrund und Mantellinien als Linien (die flache
  // Schattierung würde den Lochgrund sonst nicht von der Trennfläche abheben). Schattiert nur, wenn
  // die Trennfläche zur Kamera zeigt (sonst verdeckt).
  // Schnittschleifen als rote Umrisse (2D-Überlagerung).
  function drawCutLoops(loops) {
    if (!loops || !loops.length) return;
    ctx.save(); ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    for (const L of loops) {
      ctx.beginPath(); L.pts.forEach((q, i) => { const p = scr(q[0], q[1], q[2]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath(); ctx.stroke();
    }
    ctx.restore();
  }
  function drawPinEdges(s, wire) {
    const E = s.mesh && s.mesh.pinEdges; if (!E || !E.length) return;
    const dz = s.dz || 0, dy = s.dy || 0;
    ctx.save(); ctx.lineWidth = wire ? 1 : 1.2; ctx.strokeStyle = wire ? 'rgba(255,220,80,0.95)' : 'rgba(20,20,30,0.9)';
    for (const e of E) {
      // verdeckte Trennfläche (zeigt von der Kamera weg): Bohrung gestrichelt als verdeckte Kante
      const hidden = !wire && rot(e.n || [0, 0, e.dir])[2] > 0.02;
      ctx.setLineDash(hidden ? [3, 3] : []); if (!wire) ctx.strokeStyle = hidden ? 'rgba(255,220,80,0.55)' : 'rgba(20,20,30,0.9)';
      const ring = (z, fill, P) => { ctx.beginPath(); (P || e.pts).forEach((p, i) => { const q = scr(p.x, p.y + dy, (p.z == null ? z : p.z) + dz); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.closePath(); if (fill) { ctx.fillStyle = 'rgba(12,12,18,0.85)'; ctx.fill(); } ctx.stroke(); };
      // schattiert: Lochöffnung dunkel füllen (die flache Schattierung würde den Lochgrund sonst nicht abheben)
      ring(e.zb, false, e.pts2 || e.pts); ring(e.zc, !wire && !hidden);
      const st = Math.max(1, Math.round(e.pts.length / 8));
      ctx.beginPath();
      for (let i = 0; i < e.pts.length; i += st) { const p = e.pts[i], p2 = (e.pts2 || e.pts)[i], a = scr(p.x, p.y + dy, (p.z == null ? e.zc : p.z) + dz), b = scr(p2.x, p2.y + dy, (p2.z == null ? e.zb : p2.z) + dz); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.restore();
  }
  /* Trennfläche halbdurchsichtig (gelb) als Überlagerung: Vierecke je Station (Flansch vorn / hinten, volle Breite in
   * den Überständen), Formenrand und Trennlinie als Linien. Je Modell einmal berechnet (partingSheet), kameraunabhängig. */
  let psCache = null;
  function drawParting() {
    const pv = model && (model.preview || model), Wp = pv && (pv.Wp || pv.W); if (!Wp || !Wp.rings || Wp.rings.length < 2) return;
    let sheet;
    try { if (!psCache || psCache.W !== Wp) psCache = { W: Wp, sheet: partingSheet(Wp, pv.opt || model.opt) }; sheet = psCache.sheet; } catch (e) { console.warn('Trennfläche:', e); return; }
    ctx.save(); ctx.lineJoin = 'round';
    ctx.fillStyle = 'rgba(255,196,60,.22)';
    for (const q of sheet.quads) {
      ctx.beginPath();
      q.forEach((p, i) => { const s = scr(p[0], p[1], p[2]); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,196,60,.85)'; ctx.lineWidth = 1.2;
    for (const L of sheet.lines) {
      ctx.setLineDash(L.dash ? [5, 4] : []); ctx.beginPath();
      L.pts.forEach((p, i) => { const s = scr(p[0], p[1], p[2]); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.restore();
  }
  /* Schnitt der Trennfläche (dieselbe partingSheet wie in 3D) mit der Schnittebene: Strecken [u, v] der Vierecke
   * und Kreuzungspunkte der Trennlinie (Nase / Endleiste) in Ebenenkoordinaten. */
  function partingSection(cut) {
    const pv = model && (model.preview || model), Wp = pv && (pv.Wp || pv.W); if (!Wp || !Wp.rings || Wp.rings.length < 2) return null;
    let sheet;
    try { if (!psCache || psCache.W !== Wp) psCache = { W: Wp, sheet: partingSheet(Wp, pv.opt || model.opt) }; sheet = psCache.sheet; } catch (e) { return null; }
    const k = cut.k, [iu, iv] = planeUV(k), segs = [], marks = [];
    const hit = (a, b) => { const da = a[k] - cut.pos, db = b[k] - cut.pos; if ((da >= 0) === (db >= 0)) return null; const t = da / (da - db); return [a[iu] + (b[iu] - a[iu]) * t, a[iv] + (b[iv] - a[iv]) * t]; };
    /* Ebenen X (Sehne) und Z (Spannweite): Höhe je Zeile exakt aus der Zeilenfunktion (partingSheet rows.fn) statt aus
     * den Anzeige-Vierecken — die mitteln zwischen Zeilen mit verschieden liegenden Flanschpunkten und geben am
     * hochgezogenen Randbogen Wellen in der Schnittlinie. Zwischen zwei Zeilen linear (wie der Loft im Netz). */
    const rows = sheet.rows, iN = sheet.iN, iT = sheet.iT, ev = (fn, x) => (x < fn.xF - 1e-9 || x > fn.xR + 1e-9) ? null : fn.y(x);
    if (k === 0 && rows) {
      let prev = null;
      for (const R of rows) { const y = ev(R.fn, cut.pos), p = y == null ? null : [R.z, y]; if (prev && p) segs.push([prev, p]); prev = p; }
    } else if (k === 2 && rows) {
      let i = -1; for (let j = 0; j + 1 < rows.length; j++) if (rows[j].z <= cut.pos && cut.pos <= rows[j + 1].z) { i = j; break; }
      if (i >= 0) {
        const A = rows[i].fn, B = rows[i + 1].fn, dz = rows[i + 1].z - rows[i].z, t = dz > 1e-9 ? (cut.pos - rows[i].z) / dz : 0;
        const lp = (a, b) => a == null ? b : b == null ? a : a + (b - a) * t;
        const xF = lp(A.xF, B.xF), xR = lp(A.xR, B.xR);
        const yAt = x => { const a = ev(A, x), b = ev(B, x); return a == null ? b : b == null ? a : a + (b - a) * t; };
        // Stützstellen: dicht in x, dazu Nase / Endleiste der Zeilen (Knicke der Linie)
        const X = [xF, xR]; for (const R of [rows[i], rows[i + 1]]) for (const q of [R.pts[iN], R.pts[iT]]) if (q.x > xF && q.x < xR) X.push(q.x);
        const NS = 200; for (let j = 1; j < NS; j++) X.push(xF + (xR - xF) * j / NS);
        X.sort((a, b) => a - b);
        for (let j = 0; j + 1 < X.length; j++) {
          const xa = X[j], xb = X[j + 1]; if (xb - xa < 1e-9) continue;
          const ya = yAt(xa), yb = yAt(xb); if (ya == null || yb == null) continue;
          segs.push([[xa, ya], [xb, yb]]);
        }
      }
    } else for (const q of sheet.quads) {
      const pts = [];
      for (let i = 0; i < q.length; i++) { const p = hit(q[i], q[(i + 1) % q.length]); if (p) pts.push(p); }
      for (let i = 0; i + 1 < pts.length; i += 2) segs.push([pts[i], pts[i + 1]]);
    }
    for (const L of sheet.lines) { if (!L.dash) continue; for (let i = 0; i + 1 < L.pts.length; i++) { const p = hit(L.pts[i], L.pts[i + 1]); if (p) marks.push(p); } }
    return segs.length || marks.length ? { segs, marks } : null;
  }
  // Schnittebene als transparentes Rechteck über der Modell-Bounding-Box.
  function drawCutPlane(cut, mn, mx, stroke, fill) {
    const k = cut.k, [iu, iv] = planeUV(k), pad = radius * 0.06;
    const c = [[mn[iu] - pad, mn[iv] - pad], [mx[iu] + pad, mn[iv] - pad], [mx[iu] + pad, mx[iv] + pad], [mn[iu] - pad, mx[iv] + pad]];
    ctx.beginPath();
    c.forEach((q, i) => { const P = [0, 0, 0]; P[k] = cut.pos; P[iu] = q[0]; P[iv] = q[1]; const sp = scr(P[0], P[1], P[2]); i ? ctx.lineTo(sp.x, sp.y) : ctx.moveTo(sp.x, sp.y); });
    ctx.closePath(); ctx.fillStyle = fill || 'rgba(255,77,77,.08)'; ctx.fill(); ctx.strokeStyle = stroke || 'rgba(255,77,77,.6)'; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
  }
  function drawAxes() {
    const L = radius * 0.35, o = [center[0] - radius * 0.9, center[1] - radius * 0.6, center[2] - radius * 0.2];
    const ax = [[1, 0, 0, 'X'], [0, 1, 0, 'Y'], [0, 0, 1, 'Z']];
    ctx.font = '11px system-ui'; ctx.lineWidth = 1.5;
    for (const a of ax) {
      const p0 = scr(o[0], o[1], o[2]), p1 = scr(o[0] + a[0] * L, o[1] + a[1] * L, o[2] + a[2] * L);
      ctx.strokeStyle = ctx.fillStyle = col('--muted', '#8aa');
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); ctx.fillText(a[3], p1.x + 3, p1.y - 3);
    }
  }
  // ---------- Ansichtswürfel (Gizmo) rechts oben: zeigt die Orientierung, Klick auf eine
  // Seite stellt die Ansicht senkrecht auf diese Seite, Ziehen auf dem Würfel dreht.
  const GIZ_FACES = [
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], t: 'Oben', cam: { yaw: 0, pitch: Math.PI / 2 } },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], t: 'Unten', cam: { yaw: 0, pitch: -Math.PI / 2 } },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], t: 'Außen', cam: { yaw: 0, pitch: 0 } },
    { n: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0], t: 'Wurzel', cam: { yaw: Math.PI, pitch: 0 } },
    { n: [1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], t: 'Endleiste', cam: { yaw: -Math.PI / 2, pitch: 0 } },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], t: 'Nase', cam: { yaw: Math.PI / 2, pitch: 0 } }
  ];
  let gizmo = { cx: 0, cy: 0, r: 0, faces: [] };
  function drawGizmo() {
    const sz = 24, cx = W - 62, cy = 64;
    gizmo = { cx, cy, r: window.ViewCube ? 0 : sz * 1.9, faces: [] };
    if (window.ViewCube) return;   // gemeinsamer Ansichtswürfel (viewcube.js) liegt darüber
    const pr = n => { const r = rot(n); return { x: cx + r[0] * sz, y: cy - r[1] * sz, d: r[2] }; };
    const vis = [];
    for (const f of GIZ_FACES) {
      const d = rot(f.n)[2]; if (d <= 0.02) continue;
      const P = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => pr([f.n[0] + f.u[0] * a + f.v[0] * b, f.n[1] + f.u[1] * a + f.v[1] * b, f.n[2] + f.u[2] * a + f.v[2] * b]));
      vis.push({ f, P, d });
    }
    vis.sort((a, b) => a.d - b.d);
    const fg = col('--txt', '#dde'), line = col('--line', '#556');
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineWidth = 1; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const q of vis) {
      ctx.beginPath(); q.P.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
      ctx.fillStyle = 'hsl(210,25%,' + Math.round(30 + 32 * q.d) + '%)'; ctx.fill(); ctx.strokeStyle = line; ctx.stroke();
      const c = pr(q.f.n); ctx.fillStyle = fg; ctx.globalAlpha = Math.min(1, 0.35 + q.d);
      ctx.fillText(T(q.f.t), c.x, c.y); ctx.globalAlpha = 1;
      gizmo.faces.push({ f: q.f, P: q.P });
    }
    ctx.restore();
  }
  // Umschalter Fläche / Winglet unter dem Gizmo (nur wenn das Modell ein Winglet-Teilnetz hat).
  let showBtns = [];
  function drawShowBtns() {
    showBtns = [];
    const pv = model && (model.preview || model); if (!pv) return;
    const hasWl = !!((pv.ur && pv.ur.wl) || (pv.parts && pv.parts.tip)), cur = C('formShow') || 'both';
    const halves = !!(pv.top && pv.bot), curH = C('formHalf') || 'both';
    const wlN = !!(pv.ur && pv.ur.wl);
    const items = hasWl ? [['both', wlN ? 'Fläche + Winglet' : 'Fläche + Randbogen'], ['wing', 'nur Fläche'], ['wl', wlN ? 'nur Winglet' : 'nur Randbogen']]
      : halves ? [['h:both', 'beide Hälften'], ['h:top', 'nur obere Form'], ['h:bot', 'nur untere Form']] : [];
    items.push(['ps', 'Trennfläche']);
    items.push(['wire', 'Drahtgitter']);
    const bw = 104, bh = 18, x = W - 12 - bw; let y = gizmo.cy + gizmo.r + 10;
    const fg = col('--txt', '#dde'), line = col('--line', '#556');
    ctx.save(); ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 1;
    for (const [k, t] of items) {
      const on = k === 'wire' ? !!C('formWire') : k === 'ps' ? !!C('formPsShow') : k.startsWith('h:') ? k.slice(2) === curH : k === cur;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, bw, bh, 4) : ctx.rect(x, y, bw, bh);
      ctx.fillStyle = on ? 'rgba(70,130,220,.85)' : 'rgba(60,70,90,.55)'; ctx.fill(); ctx.strokeStyle = on ? 'rgba(120,170,255,.9)' : line; ctx.stroke();
      ctx.fillStyle = fg; ctx.globalAlpha = on ? 1 : 0.8; ctx.fillText(T(t), x + bw / 2, y + bh / 2 + 0.5); ctx.globalAlpha = 1;
      showBtns.push({ k, x, y, w: bw, h: bh });
      y += bh + 4;
    }
    ctx.restore();
  }
  function colorRow(body, label, key, def) {
    const row = document.createElement('div'); row.className = 'row';
    const l = document.createElement('label'); l.textContent = T(label); row.appendChild(l);
    const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;gap:6px;align-items:center';
    const inp = document.createElement('input'); inp.type = 'color'; inp.value = /^#[0-9a-f]{6}$/i.test(C(key) || '') ? C(key) : def;
    inp.style.cssText = 'width:46px;height:26px;padding:0;cursor:pointer';
    inp.oninput = () => { S(key, inp.value); draw(); };
    const rs = document.createElement('button'); rs.textContent = '\u21ba'; rs.title = T('Standardfarbe'); rs.style.cssText = 'padding:0 8px;min-width:0';
    rs.onclick = () => { S(key, def); inp.value = def; draw(); };
    wrap.appendChild(inp); wrap.appendChild(rs); row.appendChild(wrap); body.appendChild(row);
  }
  function showBtnHit(x, y) { const b = showBtns.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h); return b ? b.k : null; }
  function gizmoHit(x, y) {
    for (let k = gizmo.faces.length - 1; k >= 0; k--) {
      const P = gizmo.faces[k].P; let inside = false;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        if ((P[i].y > y) !== (P[j].y > y) && x < (P[j].x - P[i].x) * (y - P[i].y) / (P[j].y - P[i].y) + P[i].x) inside = !inside;
      }
      if (inside) return gizmo.faces[k].f;
    }
    return null;
  }
  function setInfo(html, bad) { const el = document.getElementById('formInfo'); if (el) { el.innerHTML = html; el.style.color = bad ? '#f88' : ''; } }
  // Vorschau-Quellen (Netze + Farbe + Verschiebung) und Bounding-Box des aktuellen Modells.
  function prepSources(noSeg) {
    const o = model.opt, src = [], pv = model.preview || model;
    const cw0 = hexHsl(C('formColWing'), { h: 35, sat: 80, l: 62 }), cl = hexHsl(C('formColWl'), { h: 200, sat: 70, l: 60 });
    const cw = Object.assign({ h3: cl.h, sat3: cl.sat, l3: cl.l }, cw0);   // Urmodell: Randbogen-Ringe (Tag 2) in der Winglet-/Randbogenfarbe
    if ((o.target === 'neg' || o.target === 'split') && pv.top && pv.bot) {
      const gap = +C('formGap') || 0, half = C('formHalf') || 'both';
      // Formfläche (Tag 0) und Formenrand/Hinterbau (Tag 1) in getrennten, einstellbaren Farben; untere Hälfte etwas dunkler.
      const cs = hexHsl(C('formColSurf'), { h: 205, sat: 60, l: 60 }), cr = hexHsl(C('formColRim'), { h: 215, sat: 7, l: 57 });
      const ct = hexHsl(C('formColTipF'), { h: 155, sat: 40, l: 50 });
      const rim = (dl) => ({ h2: cr.h, sat2: cr.sat, l2: Math.max(15, cr.l + dl), h3: ct.h, sat3: ct.sat, l3: Math.max(15, ct.l + dl) });
      // Gebogene Teile (Winglet): Versatz wird mitgebogen (rebend) statt als starre y-Verschiebung.
      const sep = (m, d) => m && m.rebend ? { mesh: m.rebend(d), dy: 0 } : { mesh: m, dy: d };
      if (half !== 'bot') src.push(Object.assign({ body: 'top' }, sep(pv.top, gap / 2), cs, rim(0)));
      if (half !== 'top') src.push(Object.assign({ body: 'bot', h: cs.h, sat: cs.sat, l: Math.max(15, cs.l - 6) }, sep(pv.bot, -gap / 2), rim(-6)));
      if (pv.ur && half === 'both' && o.target === 'split') src.push(Object.assign({ mesh: pv.ur, body: 'ur' }, cw));   // Positiv nur beim geteilten Urmodell und nur bei beiden Hälften (Negativform: nur die Formhälften; sonst verdeckt es die Kavität)
    } else if (pv.parts && pv.parts.tip) {
      // Passbohrungen: Tragfläche und Abschlussteil getrennt (auseinandergezogen), damit die Löcher sichtbar sind
      const gap = +C('formPinGap') || 0, show = C('formShow') || 'both';
      if (show !== 'wl') src.push(Object.assign({ mesh: pv.parts.wing, dz: -gap / 2, body: 'wing' }, cw));
      if (show !== 'wing') src.push(Object.assign({ mesh: pv.parts.tip, dz: gap / 2, body: 'tip' }, cl));
    } else if (pv.ur && pv.ur.wl) {
      const show = C('formShow') || 'both';
      if (show !== 'wl') src.push(Object.assign({ mesh: pv.ur.wing, body: 'wing' }, cw));
      if (show !== 'wing') src.push(Object.assign({ mesh: pv.ur.wl, body: 'tip' }, cl));
    }
    else if (pv.ur) src.push(Object.assign({ mesh: pv.ur, body: 'ur' }, pv.ur.isTip ? cl : cw));
    // Drahtgitter des Urmodells aus den Ringen (Rippen) statt aus der Dreiecks-Suppe.
    if (pv.ur && pv.W) {
      const flip = r => ({ pts: r.pts.map(p => p.z == null ? p : { x: p.x, y: p.y, z: -p.z }), z: -r.z });
      const wr = pv.W.rings, wlr = pv.W.wl ? [wr[wr.length - 1]].concat(pv.W.wl) : null;
      const mir = a => o.mirror ? a.slice(1).reverse().map(flip).concat(a) : a;
      for (const q of src) {
        if (q.mesh === pv.ur.wing || (q.mesh === pv.ur && !wlr)) q.rings = mir(wr);
        else if (q.mesh === pv.ur) q.rings = mir(wr.concat(pv.W.wl));
        else if (q.mesh === pv.ur.wl) q.rings = o.mirror ? wlr.slice().reverse().map(flip).concat(wlr) : wlr;
        else if (pv.parts && q.mesh === pv.parts.wing) q.rings = mir(wr.slice(0, pv.W.tipStart + 1));
        else if (pv.parts && q.mesh === pv.parts.tip) { const tr = wlr || wr.slice(pv.W.tipStart); q.rings = o.mirror ? tr.slice().reverse().map(flip).concat(tr) : tr; }
      }
    }
    // Segmentierung: Vorschau-Körper an den Trennebenen teilen (inkl. Passstift-Bohrungen) und die Stücke
    // entlang z auseinanderziehen; Teilung je Einstellung nur einmal (Cache am Modell).
    const so = segOpts(), segP = so.on && !noSeg ? segPlanes(so) : [];
    if (segP.length) {
      const key = JSON.stringify([segP, so.pin, so.pinPer, pv === model]);
      if (!model.segCache || model.segCache.key !== key) model.segCache = { key, map: new Map() };
      const cache = model.segCache.map, n = segP.length + 1, out = [];
      model.segErr = null; model.segSkipped = 0;
      for (const s of src) {
        let parts = cache.get(s.mesh);
        if (!parts) {
          // Ein Fehler beim Teilen (Geometrie-Sonderfall) darf die Vorschau nicht leeren: Körper ungeteilt zeigen, Meldung in der Infozeile.
          try { parts = splitMeshAll(s.mesh, segP, (i, b) => segPinAt(so, i, b), s.body); }
          catch (e) { console.error('Formenbau Segmentierung:', e); model.segErr = (e && e.message) ? e.message : String(e); parts = [s.mesh]; parts.pins = 0; }
          cache.set(s.mesh, parts);
        }
        model.segSkipped += parts.skipped || 0;
        if (parts.length === 1) out.push(s);
        else parts.forEach((pm, i) => out.push(Object.assign({}, s, { mesh: pm, rings: null, dz: (s.dz || 0) + (i - (n - 1) / 2) * so.gap })));
      }
      src.length = 0; for (const q of out) src.push(q);
    }
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const s of src) { const b = meshBoundsCached(s.mesh); for (let k = 0; k < 3; k++) { const off = k === 1 ? (s.dy || 0) : k === 2 ? (s.dz || 0) : 0; mn[k] = Math.min(mn[k], b.mn[k] + off); mx[k] = Math.max(mx[k], b.mx[k] + off); } }
    model.src = src; model.bounds = { mn, mx };
    return { src, mn, mx };
  }
  function draw3d() {
    const bg = col('--bg', '#0f1216'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    if (!model) { setInfo(T('Keine Tragfläche vorhanden.'), true); return; }
    const o = model.opt, { src, mn, mx } = prepSources();
    if (!src.length) { setInfo(model.err || T('Nichts zu zeigen.'), true); return; }
    center = pivot || [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    radius = Math.max(1, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2);
    const cut = cutSpec();
    if (glActive()) {
      // GPU zeichnet Hintergrund + Netze auf der Canvas dahinter; die 2D-Canvas wird durchsichtig und trägt nur die Überlagerungen.
      const loops = cutLoopsFor(src, cut);
      glDraw(src, cut, loops);
      ctx.clearRect(0, 0, W, H);
      lastFaces = [];
      if (cut) { const nrm = [0, 0, 0]; nrm[cut.k] = -cut.sg; if (rot(nrm)[2] <= 0.02) drawCutLoops(loops); }
      for (const s of src) drawPinEdges(s, false);
    } else drawShaded(src, cut);
    if (C('formPsShow')) drawParting();
    if (cut) drawCutPlane(cut, mn, mx);
    const so = segOpts(), segP = so.on ? segPlanes(so) : [];
    segP.forEach((z, i) => drawCutPlane({ k: 2, pos: z + (i + 1 - (segP.length + 1) / 2) * so.gap }, mn, mx, 'rgba(90,200,255,.55)', 'rgba(90,200,255,.05)'));
    const co = curvOpts(), nCurv = co.on ? drawCurv3d(co) : 0;
    drawAxes();
    if (pivot) {
      const q = scr(pivot[0], pivot[1], pivot[2]);
      ctx.save(); ctx.strokeStyle = 'rgba(255,220,80,.9)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(q.x - 9, q.y); ctx.lineTo(q.x + 9, q.y); ctx.moveTo(q.x, q.y - 9); ctx.lineTo(q.x, q.y + 9); ctx.stroke(); ctx.restore();
    }
    drawMeas3d();
    drawGizmo();
    drawShowBtns();
    const ntri = model.ntri || 0;
    let dev = 0; for (const s of model.W.stations) dev = Math.max(dev, s.dev);
    const dim = k => (mx[k] - mn[k]).toFixed(1);
    const wlPart = o.tipMode === 'winglet' || o.tipMode === 'wldraw';
    const partTxt = o.part === 'tip' ? T(wlPart ? 'Winglet' : 'Randbogen') + ' · ' : o.part === 'wing' ? T('Tragfläche ohne Randbogen') + ' · ' : '';
    let txt = partTxt + (o.target === 'neg' ? T('Negativform (oben + unten)') : o.target === 'split' ? T('Urmodell geteilt (oben + unten)') : T('Urmodell')) + ' · ' + Math.round(ntri) + ' ' + T('Dreiecke')
      + ' · ' + dim(0) + ' × ' + dim(1) + ' × ' + dim(2) + ' mm';
    if (o.mode !== 'none') txt += '<br>' + T('Glättung: max. Abweichung') + ' ' + dev.toFixed(3) + ' mm';
    if (model.preview) txt += '<br><span style="opacity:.7">' + T('Vorschau vergröbert (Export in voller Auflösung)') + '</span>';
    if (glTried && !gl && renderMode() !== '2d') txt += '<br><span style="opacity:.7">' + T('WebGL nicht verfügbar – Darstellung über Canvas 2D') + '</span>';
    if (C('formZebraOn')) txt += '<br><span style="color:#e6e6e6">' + T('Zebra-Analyse:') + ' ' + (glActive() ? T('Streifen = Spiegelung eines Streifenmusters; Knicke oder Wellen in den Streifen zeigen Unstetigkeiten der Fläche, glatte Streifen = glatte Fläche') : T('nur mit WebGL-Darstellung (Darstellung „fein“ oder „schnell“, kein Drahtgitter)')) + '</span>';
    if (segP.length) { const Ls = segLengths(segP); txt += '<br><span style="color:#8ad4ff">' + T('Druckstücke:') + ' ' + Ls.length + ' × ' + T('Länge') + ' ' + Ls.map(l => l.toFixed(0)).join(' / ') + ' mm · ' + T('je Körper eine Datei je Stück') + '</span>'; }
    if (model.segErr) txt += '<br><span style="color:#f88">' + T('Segmentierung fehlgeschlagen (Vorschau ungeteilt):') + ' ' + model.segErr + '</span>';
    if (model.segSkipped) txt += '<br><span style="color:#f88">' + T('Passstifte manuell:') + ' ' + model.segSkipped + ' ' + T('Punkt(e) außerhalb der Schnittfläche oder zu nah am Rand – ausgelassen') + '</span>';
    if (cut) txt += '<br><span style="color:#ff8a8a">' + T('Schnitt') + ' ' + cut.ax.toUpperCase() + ' = ' + cut.pos.toFixed(1) + ' mm · ' + T(cut.sg < 0 ? 'Seite + entfernt' : 'Seite − entfernt') + '</span>';
    if (o.target === 'split' && o.sicke && model.top && !model.top.sicke) txt += '<br><span style="color:#f88">' + T('Sicke passt nicht in den Überstand (Abstand + Breite + 1 mm ≤ Überstand vorn/hinten; Tiefe < Plattendicke).') + '</span>';
    if ((o.target === 'neg' || o.target === 'split') && o.holes.on && model.top && model.top.holes) {
      const hh = model.top.holes;
      txt += '<br>' + T('Passbohrungen (Form) je Hälfte:') + ' ' + hh.placed;
      if (hh.skipped) txt += ' <span style="color:#f88">' + T('– nicht platzierbar:') + ' ' + hh.skipped + ' (' + T('Durchmesser, Abstand vom Rand, Überstand und Randabstand prüfen') + ')</span>';
    }
    if ((o.target === 'neg' || o.target === 'split') && ((o.stk && o.stk.on) || (o.stkT && o.stkT.on))) {
      const stkInfo = (key, on, none, head) => {
        if (!on) return;
        const st = (model.top && model.top[key]) || (model.bot && model.bot[key]);
        if (!st || (!st.placed && !st.skipped)) { txt += '<br><span style="color:#f88">' + T(none) + '</span>'; return; }
        txt += '<br>' + T(head) + ' ' + st.placed;
        if (st.skipped) txt += ' <span style="color:#f88">' + T('– nicht platzierbar:') + ' ' + st.skipped + ' (' + T('Lage x/y und Größe prüfen: der Querschnitt muss mit 0,5 mm Rand in der Profilkontur liegen, die Trennlinie schneiden und darf keinen anderen überlappen') + ')</span>';
      };
      stkInfo('stk', o.stk && o.stk.on && o.part !== 'tip',
        'Steckungs-Ausnehmungen: keine — nur mit Überstand an der Wurzel (und nicht bei gespiegeltem Modell).', 'Steckungs-Ausnehmungen je Hälfte:');
      stkInfo(o.part === 'tip' ? 'stk' : 'stkE', o.stkT && o.stkT.on && o.part !== 'all',
        'Ausnehmungen der Anschluss-Steckung: keine — nur mit Überstand an dieser Seite (und nicht bei gespiegeltem Modell).', 'Ausnehmungen der Anschluss-Steckung je Hälfte:');
    }
    const fold = (model.top && model.top.fold) || (model.bot && model.bot.fold);
    if (fold) txt += '<br><span style="color:#f88">' + T('Biegeradius zu klein (ca.') + ' ' + fold + ' mm): ' + T('Platte bzw. Formdicke ist an der Innenseite der Biegung dicker als der Radius – das Netz faltet sich dort. Übergangsradius vergrößern oder Plattendicke / Formdicke verringern.') + '</span>';
    if (o.pin && o.pin.on && ((model.parts && model.parts.pins) || model.pins)) {
      const pp = (model.parts && model.parts.pins) || model.pins;
      txt += '<br>' + T('Steckungsbohrungen je Teil:') + ' ' + pp.placed;
      if (pp.skipped) txt += ' <span style="color:#f88">' + T('– nicht platzierbar:') + ' ' + pp.skipped + ' (' + T('Lage x/y und Größe prüfen: das Loch muss mit 0,5 mm Rand in der Profilkontur liegen und darf kein anderes überlappen') + ')</span>';
    }
    if (co.on) txt += '<br><span style="color:#5fd0dc">' + T('Krümmungsanalyse:') + ' ' + (co.dir === 'span' ? nCurv + ' ' + T('Längslinien (Spannweitenkrümmung)') + ' · ' + T('Linie ⟂ Fläche ∝ Krümmung entlang der Spannweite (Spitzen = Knick an einer Rippenstation), rot = Hüllkurve') : nCurv + ' ' + T('Schnitte alle') + ' ' + co.step + ' mm · ' + T('Linie ⟂ Kontur ∝ Krümmung (außen = konvex), rot = Hüllkurve')) + '</span>';
    if (model.err) txt += '<br><span style="color:#f88">' + model.err + '</span>';
    setInfo(txt);
  }
  // 2D-Profilansicht: Rohpunkte, geglättete Kurve, Kontrollpolygon.
  function drawProf() {
    const bg = col('--bg', '#0f1216'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    if (!model) { setInfo(T('Keine Tragfläche vorhanden.'), true); return; }
    const st = model.W.stations, k = Math.min(Math.max(0, Math.round(C('formStation'))), st.length - 1), s = st[k];
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const p of s.raw) { xMin = Math.min(xMin, p.x); xMax = Math.max(xMax, p.x); yMin = Math.min(yMin, p.y); yMax = Math.max(yMax, p.y); }
    const sc = Math.min((W - 60) / ((xMax - xMin) || 1), (H - 60) / ((yMax - yMin) || 1)) * cam.zoom;
    const cx = (xMin + xMax) / 2, cy = (yMin + yMax) / 2;
    const P = p => ({ x: W / 2 + cam.px + (p.x - cx) * sc, y: H / 2 + cam.py - (p.y - cy) * sc });
    if (s.ctrl) {
      ctx.strokeStyle = 'rgba(255,190,80,.45)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.beginPath(); s.ctrl.forEach((p, i) => { const q = P(p); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,190,80,.8)'; for (const p of s.ctrl) { const q = P(p); ctx.fillRect(q.x - 2, q.y - 2, 4, 4); }
    }
    ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 1.8;
    ctx.beginPath(); s.sm.forEach((p, i) => { const q = P(p); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.stroke();
    ctx.fillStyle = '#ff7b7b'; for (const p of s.raw) { const q = P(p); ctx.beginPath(); ctx.arc(q.x, q.y, 1.8, 0, Math.PI * 2); ctx.fill(); }
    const M = s.sm.length;
    let txt = T('Station') + ': ' + s.name + ' · z = ' + s.z.toFixed(1) + ' mm · ' + s.raw.length + ' ' + T('Rohpunkte (rot)') + ' → ' + M + ' ' + T('Punkte (blau)');
    if (s.ctrl) txt += ' · ' + s.ctrl.length + ' ' + T('Kontrollpunkte (orange)') + '<br>' + T('max. Abweichung') + ' ' + s.dev.toFixed(3) + ' mm';
    if (model.opt.aufmass) txt += ' · ' + T('Aufmaß') + ' ' + model.opt.aufmass + ' mm';
    if (model.opt.teThk) txt += ' · ' + T('Endleiste') + ' ' + model.opt.teThk + ' mm';
    setInfo(txt);
  }
  // 2D-Schnittansicht: Schleifen in Ebenenkoordinaten, Gesamtmaße, Messstrecke.
  let cutMeasure = [];   // bis zwei Punkte [u, v] (Modell-mm)
  let cutXf = null;      // aktuelle Abbildung für Mausklicks
  let segPinEdit = null; // Index der Trennstelle, deren Passstifte im 2D-Schnitt gesetzt werden (null = aus)
  let cutLoops = [];     // Schleifen der letzten 2D-Zeichnung (für die Trefferprüfung beim Setzen)
  // Passstift-Lage setzen: 2D-Schnitt an der Trennstelle i öffnen (Klick = Stift, Rechtsklick = entfernen)
  let segPinEditPrev = null;   // Schnittansicht-Zustand vor dem Setzen (wird bei „Fertig“ wiederhergestellt)
  function segPinEditStart(i) {
    const pl = segPlanes(); if (i == null || i < 0 || i >= pl.length) { segPinEditStop(); return; }
    if (segPinEdit == null) segPinEditPrev = { on: !!C('formCutOn'), axis: C('formCutAxis'), pos: C('formCutPos') };
    segPinEdit = i; cutMeasure = [];
    S('formCutOn', true); S('formCutAxis', 'z'); S('formCutPos', pl[i]); S('formView', 'cut'); cam = Object.assign({}, CAM0);
    buildSidebar(); draw();
  }
  function segPinEditStop() {
    if (segPinEdit == null) return; segPinEdit = null;
    // Schnittansicht beenden (bzw. den vorherigen Zustand wiederherstellen), zurück in die 3D-Ansicht
    const pv = segPinEditPrev; segPinEditPrev = null;
    if (pv) { S('formCutOn', pv.on); S('formCutAxis', pv.axis); S('formCutPos', pv.pos); } else S('formCutOn', false);
    S('formView', '3d'); buildSidebar(); draw();
  }
  /* Profilnase an der Trennstelle z (Netzkoordinaten): Bezug für die lokalen Stift-Koordinaten
   * (x entlang der Sehne nach hinten, y nach oben). Rippen des Entwurfs (ungekippt) bei |z| interpoliert. */
  function segNoseAt(z) {
    const Wq = model && (model.Wfull || model.W), R = Wq && Wq.rings; if (!R || !R.length) return { x: 0, y: 0 };
    const za = Math.abs(z), le = r => r.pts[leIndex(r.pts.length)];
    if (za <= R[0].z) return { x: le(R[0]).x, y: le(R[0]).y };
    for (let j = 0; j < R.length - 1; j++) {
      const A = R[j], B = R[j + 1];
      if (za <= B.z) { const t = B.z - A.z > 1e-9 ? (za - A.z) / (B.z - A.z) : 0, a = le(A), b = le(B); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
    }
    const l = le(R[R.length - 1]); return { x: l.x, y: l.y };
  }
  const SEG_BODY_NAMES = { ur: 'Urmodell', top: 'Form oben', bot: 'Form unten', wing: 'Tragfläche', tip: 'Randbogen / Winglet' };
  function segPinSetPts(i, pts) {
    const o = Object.assign({}, (C('formSegPinPer') && typeof C('formSegPinPer') === 'object') ? C('formSegPinPer') : {});
    o[i] = Object.assign({}, o[i] || {}); if (pts && pts.length) o[i].pts = pts; else delete o[i].pts;
    if (o[i].on !== false && !(+o[i].n >= 1) && !o[i].pts) delete o[i];
    S('formSegPinPer', Object.keys(o).length ? o : null);
  }
  // Klick im Bearbeitungsmodus: Punkt (u, v) der Schnittebene -> Stift im getroffenen Körper (Netzkoordinaten ohne Vorschau-Versatz)
  function segPinClick(q, remove) {
    const i = segPinEdit, pts = segPinPts(i).slice(), so = segOpts(), r = so.pin ? so.pin.d / 2 : 2;
    if (remove) {
      let best = -1, bd = Infinity;
      pts.forEach((p, k) => { const s = cutLoops.find(L => L.src.body === p[2]); const dy = s ? (s.src.dy || 0) : 0; const d = Math.hypot(p[0] - q[0], p[1] + dy - q[1]); if (d < bd) { bd = d; best = k; } });
      if (best < 0 || bd > r + 3 / (cutXf && cutXf.sc || 1)) return false;
      pts.splice(best, 1); segPinSetPts(i, pts); return true;
    }
    // Körper bestimmen: Quelle, bei der der Punkt in einer ungeraden Zahl ihrer Schleifen liegt (even-odd)
    const cnt = new Map();
    for (const L of cutLoops) { const P = L.pts.map(p => ({ x: p[0], y: p[1] })); if (pointInPoly({ x: q[0], y: q[1] }, P)) cnt.set(L.src, (cnt.get(L.src) || 0) + 1); }
    let hit = null; for (const [s, n] of cnt) if (n % 2) { hit = s; break; }
    if (!hit || !hit.body) return false;
    if (pts.filter(p => p[2] === hit.body).length >= 20) return false;
    pts.push([Math.round(q[0] * 100) / 100, Math.round((q[1] - (hit.dy || 0)) * 100) / 100, hit.body]);
    segPinSetPts(i, pts); return true;
  }
  function draw2dCut() {
    const bg = col('--bg', '#0f1216'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    if (!model) { setInfo(T('Keine Tragfläche vorhanden.'), true); return; }
    let cut = cutSpec() || Object.assign({}, { k: 2, ax: 'z', pos: +C('formCutPos') || 0, sg: -1 });
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // Passstifte setzen: ungeteilte Körper (ohne Stück-Versatz) genau an der Trennebene schneiden
    const so = segOpts(), segP = so.on && so.pin ? segPlanes(so) : [];
    if (segPinEdit != null && !(segPinEdit < segP.length)) segPinEdit = null;
    const editing = segPinEdit != null;
    if (editing) { cut = { k: 2, ax: 'z', pos: segP[segPinEdit], sg: -1 }; S('formCutPos', cut.pos); }
    const [iu, iv, nu, nv] = planeUV(cut.k);
    const loops = sectionLoops(editing ? prepSources(true).src : model.src, cut);
    cutLoops = editing ? loops : [];
    if (!loops.length) { setInfo(T('Schnittebene trifft das Modell nicht.') + ' (' + cut.ax.toUpperCase() + ' = ' + cut.pos.toFixed(1) + ' mm)', true); cutXf = null; return; }
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const L of loops) for (const q of L.pts) { u0 = Math.min(u0, q[iu]); u1 = Math.max(u1, q[iu]); v0 = Math.min(v0, q[iv]); v1 = Math.max(v1, q[iv]); }
    // Trennfläche (gelb) im Schnitt: derselbe Schalter wie in 3D; ihre Ausdehnung zählt zum Bildausschnitt
    const psSec = C('formPsShow') && !editing ? partingSection(cut) : null;
    if (psSec) for (const s of psSec.segs) for (const q of s) { u0 = Math.min(u0, q[0]); u1 = Math.max(u1, q[0]); v0 = Math.min(v0, q[1]); v1 = Math.max(v1, q[1]); }
    const sc = Math.min((W - 120) / ((u1 - u0) || 1), (H - 120) / ((v1 - v0) || 1)) * cam.zoom;
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    const P = (u, v) => ({ x: W / 2 + cam.px + (u - cu) * sc, y: H / 2 + cam.py - (v - cv) * sc });
    cutXf = { sc, inv: (x, y) => [cu + (x - W / 2 - cam.px) / sc, cv - (y - H / 2 - cam.py) / sc] };
    // Raster (10 mm / 50 mm)
    const grid = (st, colr) => {
      ctx.strokeStyle = colr; ctx.lineWidth = 1; ctx.beginPath();
      for (let u = Math.floor(u0 / st) * st - st; u <= u1 + st; u += st) { const a = P(u, v0 - 20), b = P(u, v1 + 20); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      for (let v = Math.floor(v0 / st) * st - st; v <= v1 + st; v += st) { const a = P(u0 - 20, v), b = P(u1 + 20, v); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke();
    };
    if (sc * 10 > 6) grid(10, 'rgba(128,160,180,.08)'); grid(50, 'rgba(128,160,180,.18)');
    { const co = curvOpts(); if (co.on && !editing) drawCurv2d(co, cut, P); }
    // Schleifen (even-odd je Quelle, damit Hohlräume frei bleiben)
    const byH = new Map(); for (const L of loops) { const k = L.h + '|' + L.sat; if (!byH.has(k)) byH.set(k, { L: [], h: L.h, sat: L.sat }); byH.get(k).L.push(L); }
    for (const g of byH.values()) {
      ctx.beginPath();
      for (const L of g.L) L.pts.forEach((q, i) => { const p = P(q[iu], q[iv]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); if (i === L.pts.length - 1) ctx.closePath(); });
      ctx.fillStyle = 'hsla(' + g.h + ',' + g.sat + '%,60%,.35)'; ctx.fill('evenodd');
      ctx.strokeStyle = 'hsl(' + g.h + ',' + g.sat + '%,70%)'; ctx.lineWidth = 1.6; ctx.stroke();
    }
    if (psSec) {
      ctx.save(); ctx.strokeStyle = 'rgba(255,196,60,.9)'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.beginPath(); for (const s of psSec.segs) { const a = P(s[0][0], s[0][1]), b = P(s[1][0], s[1][1]); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } ctx.stroke();
      ctx.fillStyle = 'rgba(255,196,60,.95)';
      for (const q of psSec.marks) { const p = P(q[0], q[1]); ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    // Gesamtmaße
    const dim = (a, b, txt, off) => {
      const pa = P(a[0], a[1]), pb = P(b[0], b[1]);
      ctx.strokeStyle = ctx.fillStyle = '#ffd27a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      const tick = (p, dx, dy) => { ctx.beginPath(); ctx.moveTo(p.x - dx, p.y - dy); ctx.lineTo(p.x + dx, p.y + dy); ctx.stroke(); };
      const horiz = Math.abs(pb.y - pa.y) < Math.abs(pb.x - pa.x);
      tick(pa, horiz ? 0 : 5, horiz ? 5 : 0); tick(pb, horiz ? 0 : 5, horiz ? 5 : 0);
      ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = horiz ? 'bottom' : 'middle';
      ctx.fillText(txt, (pa.x + pb.x) / 2 + (horiz ? 0 : off), (pa.y + pb.y) / 2 - (horiz ? off : 0));
    };
    const m = 18 / sc;
    dim([u0, v1 + m], [u1, v1 + m], (u1 - u0).toFixed(1) + ' mm', 4);
    dim([u1 + m, v0], [u1 + m, v1], (v1 - v0).toFixed(1) + ' mm', 28);
    // Achsen-Beschriftung
    ctx.fillStyle = col('--muted', '#8aa'); ctx.font = '11px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(nu + ' →', 12, H - 12); ctx.fillText('↑ ' + nv, 12, H - 26);
    // Messstrecke
    if (cutMeasure.length) {
      ctx.strokeStyle = ctx.fillStyle = '#7CFC9A'; ctx.lineWidth = 1.5;
      const pts = cutMeasure.map(q => P(q[0], q[1]));
      for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.stroke(); }
      if (pts.length === 2) {
        ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.stroke(); ctx.setLineDash([]);
        const du = cutMeasure[1][0] - cutMeasure[0][0], dv = cutMeasure[1][1] - cutMeasure[0][1];
        ctx.font = '12px system-ui'; ctx.textAlign = 'left';
        ctx.fillText(Math.hypot(du, dv).toFixed(2) + ' mm  (Δ' + nu + ' ' + du.toFixed(2) + ', Δ' + nv + ' ' + dv.toFixed(2) + ')', (pts[0].x + pts[1].x) / 2 + 8, (pts[0].y + pts[1].y) / 2 - 8);
      }
    }
    // Passstifte (manuelle Lage) an dieser Trennstelle: Kreis im Stiftdurchmesser + Mindestwand-Ring, nummeriert je Körper
    if (editing) {
      const pts = segPinPts(segPinEdit), r = so.pin.d / 2, need = r + so.pin.margin, byBody = {};
      for (const p of pts) {
        const s = (loops.find(L => L.src.body === p[2]) || {}).src; if (!s) continue;
        const k = byBody[p[2]] = (byBody[p[2]] || 0) + 1, c = P(p[0], p[1] + (s.dy || 0));
        ctx.strokeStyle = '#ffd27a'; ctx.fillStyle = 'rgba(255,210,122,.35)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(c.x, c.y, r * sc, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(c.x, c.y, need * sc, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#ffd27a'; ctx.font = '11px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(String(k), c.x + need * sc + 2, c.y - 2);
      }
      // Profilnase als Bezug (Kreuz) je gezeigtem Körper
      const nose = segNoseAt(cut.pos);
      for (const s of new Set(loops.map(L => L.src))) {
        const c = P(nose.x, nose.y + (s.dy || 0)); ctx.strokeStyle = 'rgba(255,210,122,.7)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(c.x - 6, c.y); ctx.lineTo(c.x + 6, c.y); ctx.moveTo(c.x, c.y - 6); ctx.lineTo(c.x, c.y + 6); ctx.stroke();
      }
      const nAll = pts.filter(p => loops.some(L => L.src.body === p[2])).length;
      let txt = '<span style="color:#ffd27a">' + T('Passstifte setzen – Trennstelle') + ' ' + (segPinEdit + 1) + ' (z = ' + cut.pos.toFixed(1) + ' mm) · ' + nAll + ' ' + T('Stift(e) gesetzt') + '</span>';
      txt += '<br><span style="opacity:.8">' + T('Klick in eine Schnittfläche = Stift setzen (gestrichelt = Mindestwand), Rechtsklick auf einen Stift = entfernen · ohne Punkte: automatische Lage · Ziehen = schieben · Rad = Zoom') + '</span>';
      setInfo(txt); return;
    }
    let txt = T('Schnitt') + ' ' + cut.ax.toUpperCase() + ' = ' + cut.pos.toFixed(1) + ' mm · ' + loops.length + ' ' + T('Kontur(en)') + ' · ' + (u1 - u0).toFixed(1) + ' × ' + (v1 - v0).toFixed(1) + ' mm';
    const area = loops.reduce((a, L) => a + loopArea(L.pts, iu, iv), 0);
    txt += ' · ' + T('Fläche') + ' ' + (area / 100).toFixed(2) + ' cm²';
    if (psSec) txt += ' · <span style="color:#ffc43c">' + T('gelb = Trennfläche, Punkte = Trennlinie') + '</span>';
    txt += '<br><span style="opacity:.7">' + T('Klick = Messpunkt setzen (2 Punkte = Abstand), Rechtsklick = Messung löschen · Ziehen = schieben · Rad = Zoom') + '</span>';
    setInfo(txt);
  }
  // ---------- Zeichnung „Winglet aus Zeichnung" (Dreitafel + Drahtmodell) ----
  /* Vier Felder: Aufriss (Z→, Y↑) oben links, Seitenansicht (X→, Y↑) oben rechts
   * (gemeinsame Höhe Y), Draufsicht (Z→, X↓) unten links (gemeinsame Spannweite
   * Z), Drahtmodell unten rechts. Ein Maßstab für alle Felder. Griffe: Kontroll-
   * punkte der Nasenlinie (orange) und Endleiste (blau); Punkt 0 fest. */
  let wlXf = null;     // { sc, quads:[...], geom } der letzten Zeichnung (für die Maus)
  let wlDrag = null;   // { key:'le'|'te', i, q, end?:±1 } (end = Tangentengriff-Ende)
  let wlSel = null;    // ausgewählter Kontrollpunkt { key, i } — zeigt seine Tangentengriffe (Spline)
  let wlIso = { yaw: 0.9, pitch: 0.35, zoom: 1, px: 0, py: 0 };   // Drahtmodell-Feld: eigener Orbit (Ziehen dreht, Shift schiebt, Rad zoomt)
  // Rissansichten: Zoom/Verschiebung je Feld getrennt (Aufriss/Seite/Draufsicht beeinflussen sich nicht)
  const wlView0 = () => ({ zoom: 1, px: 0, py: 0 });
  let wlView = { A: wlView0(), S: wlView0(), D: wlView0() }, wlPanQ = null;
  function wlQuads() {
    const m = 10, top = 34, gw = (W - 3 * m) / 2, gh = (H - top - 2 * m) / 2;
    return [
      { id: 'A', name: T('Aufriss (von vorn)') + '   Z →  Y ↑', x: m, y: top, w: gw, h: gh, ha: 2, va: 1, dir: 1 },
      { id: 'S', name: T('Seitenansicht') + '   X →  Y ↑', x: 2 * m + gw, y: top, w: gw, h: gh, ha: 0, va: 1, dir: 1 },
      { id: 'D', name: T('Draufsicht') + '   Z →  X ↓', x: m, y: top + gh + m, w: gw, h: gh, ha: 2, va: 0, dir: -1 },
      { id: 'I', name: T('Drahtmodell') + '   ' + T('Ziehen = drehen · Shift = schieben · Rad = Zoom'), x: 2 * m + gw, y: top + gh + m, w: gw, h: gh }
    ];
  }
  // Geometrie der Zeichnung aus dem aktuellen Modell (Stationen) und der Konfiguration.
  function wlGeom() {
    if (!model || !model.W || model.W.stations.length < 2) return null;
    const st = model.W.stations, last = st[st.length - 1], prev = st[st.length - 2], o = model.opt;
    const rl = wlRails(last, prev, o); if (!rl.le || !rl.te) return null;
    const rings = wingletDrawRings(last, prev, o);
    const rib = last.sm.map(q => [q.x, q.y, last.z]), rib0 = prev.sm.map(q => [q.x, q.y, prev.z]);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    const acc = p => { for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; } };
    for (const p of rl.le.pts) acc(p); for (const p of rl.te.pts) acc(p); for (const p of rl.le.ctrl) acc(p); for (const p of rl.te.ctrl) acc(p);
    for (const p of rib) acc(p);
    const c0 = ribExtent(last.sm).c || 100, zRef = Math.max(prev.z, last.z - 0.6 * c0);
    acc([rl.A.le[0] + (rl.B.le[0] - rl.A.le[0]) * (last.z - zRef) / ((last.z - prev.z) || 1), rl.A.le[1], zRef]);
    const M = last.sm.length, teEff = rings.filter(r => r.pts.length === M).map(r => [(r.pts[0].x + r.pts[M - 1].x) / 2, (r.pts[0].y + r.pts[M - 1].y) / 2, (r.pts[0].z + r.pts[M - 1].z) / 2]);
    if (teEff.length) teEff.unshift(rl.A.te);
    return { rl, rings, rib, rib0, mn, mx, last, prev, zRef, c0, teEff };
  }
  function drawWlView() {
    const bg = col('--bg', '#0f1216'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const g = wlGeom();
    if (!g) { setInfo(T('Keine Tragfläche vorhanden.'), true); wlXf = null; return; }
    const Q = wlQuads(), pad = 44;
    let sc = Infinity;
    for (const q of Q) if (q.ha != null) sc = Math.min(sc, (q.w - pad) / ((g.mx[q.ha] - g.mn[q.ha]) || 1), (q.h - pad) / ((g.mx[q.va] - g.mn[q.va]) || 1));
    for (const q of Q) {
      const v = wlView[q.id] || wlView0(); q.sc = sc * v.zoom;
      q.cx = q.x + q.w / 2 + v.px; q.cy = q.y + q.h / 2 + v.py;
      if (q.ha != null) { q.ch = (g.mn[q.ha] + g.mx[q.ha]) / 2; q.cv = (g.mn[q.va] + g.mx[q.va]) / 2; }
      q.P = p => ({ x: q.cx + (p[q.ha] - q.ch) * q.sc, y: q.cy - q.dir * (p[q.va] - q.cv) * q.sc });
      q.inv = (x, y) => { const r = [null, null, null]; r[q.ha] = q.ch + (x - q.cx) / q.sc; r[q.va] = q.cv + q.dir * (q.cy - y) / q.sc; return r; };
    }
    wlXf = { sc, quads: Q, geom: g };
    const muted = col('--muted', '#8aa'), rl = g.rl;
    const wingRef = [[rl.B.le, rl.A.le], [rl.B.te, rl.A.te]];
    const clipZ = p => p[2] >= g.zRef;   // Flügel nur ab zRef zeigen
    for (const q of Q) {
      ctx.save(); ctx.beginPath(); ctx.rect(q.x, q.y, q.w, q.h); ctx.clip();
      ctx.fillStyle = 'rgba(128,160,180,.04)'; ctx.fillRect(q.x, q.y, q.w, q.h);
      if (q.ha == null) { drawWlIso(q, g); ctx.restore(); ctx.strokeStyle = 'rgba(128,160,180,.25)'; ctx.strokeRect(q.x + .5, q.y + .5, q.w - 1, q.h - 1); ctx.fillStyle = muted; ctx.font = '12px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(q.name, q.x + 8, q.y + 6); continue; }
      // Raster 10 / 50 mm
      const grid = (stp, colr) => {
        const h0 = q.inv(q.x, 0)[q.ha], h1 = q.inv(q.x + q.w, 0)[q.ha], v0 = Math.min(q.inv(0, q.y)[q.va], q.inv(0, q.y + q.h)[q.va]), v1 = Math.max(q.inv(0, q.y)[q.va], q.inv(0, q.y + q.h)[q.va]);
        ctx.strokeStyle = colr; ctx.lineWidth = 1; ctx.beginPath();
        for (let h = Math.floor(h0 / stp) * stp; h <= h1; h += stp) { const x = q.cx + (h - q.ch) * q.sc; ctx.moveTo(x, q.y); ctx.lineTo(x, q.y + q.h); }
        for (let v = Math.floor(v0 / stp) * stp; v <= v1; v += stp) { const y = q.cy - q.dir * (v - q.cv) * q.sc; ctx.moveTo(q.x, y); ctx.lineTo(q.x + q.w, y); }
        ctx.stroke();
      };
      if (q.sc * 10 > 6) grid(10, 'rgba(128,160,180,.07)'); grid(50, 'rgba(128,160,180,.16)');
      // Flügel-Bezug: Nasen-/Endleistenlinie des letzten Segments (ab zRef) und Endrippe
      ctx.strokeStyle = 'rgba(180,200,220,.45)'; ctx.lineWidth = 1.2; ctx.setLineDash([]);
      for (const [b, a] of wingRef) {
        const t = (g.zRef - b[2]) / ((a[2] - b[2]) || 1), s0 = V3.lerp(b, a, Math.max(0, Math.min(1, t)));
        const p0 = q.P(s0), p1 = q.P(a); ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      }
      ctx.beginPath(); g.rib.forEach((p, i) => { const s = q.P(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.closePath(); ctx.stroke();
      // Ringe (jeder k-te) als Sehnenlinie + Kontur — zeigt Toe/Twist/Neigung
      const K = Math.max(1, Math.round(g.rings.length / 12));
      ctx.strokeStyle = 'rgba(120,200,255,.35)'; ctx.lineWidth = 1;
      for (let i = K - 1; i < g.rings.length; i += K) {
        const r = g.rings[i]; if (!r.pts.length) continue;
        ctx.beginPath(); r.pts.forEach((p, j) => { const s = q.P([p.x, p.y, p.z]); j ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.closePath(); ctx.stroke();
      }
      // Rails
      const rail = (r, colr) => { ctx.strokeStyle = colr; ctx.lineWidth = 2; ctx.beginPath(); r.pts.forEach((p, i) => { const s = q.P(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.stroke(); };
      rail(rl.le, '#ffb35c'); rail(rl.te, '#5cc8ff');
      // tatsächliche Endleiste der Ringe (mit Schränkung) gestrichelt — weicht je nach Winkel von der gezeichneten ab
      if (g.teEff.length > 1) { ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(92,200,255,.7)'; ctx.lineWidth = 1; ctx.beginPath(); g.teEff.forEach((p, i) => { const s = q.P(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.stroke(); ctx.setLineDash([]); }
      // Tangentengriffe des ausgewählten Punkts (Spline): Linie P−T/3 … P+T/3 mit Endgriffen (wie Bezier-Kontrollpunkte)
      if (wlSel && rl.mode !== 'pline' && rl[wlSel.key] && rl[wlSel.key].ctrl[wlSel.i]) {
        const r = rl[wlSel.key], p = r.ctrl[wlSel.i], tv = V3.mul(r.tan[wlSel.i], 1 / 3), colr = wlSel.key === 'le' ? '#ffd9a8' : '#b3e5ff';
        const ends = wlSel.i === 0 ? [1] : [-1, 1];
        ctx.strokeStyle = colr; ctx.fillStyle = colr; ctx.lineWidth = 1.2;
        const a = q.P(wlSel.i === 0 ? p : V3.sub(p, tv)), b = q.P(V3.add(p, tv));
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        for (const e of ends) { const s = q.P(V3.add(p, V3.mul(tv, e))); ctx.beginPath(); ctx.rect(s.x - 4, s.y - 4, 8, 8); ctx.fill(); }
        if (r.explicit[wlSel.i]) { const s = q.P(p); ctx.font = '10px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('T', s.x + 6, s.y + 4); }
      }
      // Tangentenstrahl (gestrichelt) aus Punkt 0
      ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
      for (const [P0, d, colr] of [[rl.A.le, rl.dLE, 'rgba(255,179,92,.6)'], [rl.A.te, rl.dTE, 'rgba(92,200,255,.6)']]) {
        const e = V3.add(P0, V3.mul(d, 0.5 * g.c0)), a = q.P(P0), b = q.P(e);
        ctx.strokeStyle = colr; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.setLineDash([]);
      // Griffe
      const handles = (r, colr, key) => {
        r.ctrl.forEach((p, i) => {
          const s = q.P(p), act = (wlDrag && wlDrag.key === key && wlDrag.i === i) || (wlSel && wlSel.key === key && wlSel.i === i);
          ctx.beginPath();
          if (i === 0) { ctx.fillStyle = act ? '#fff' : 'rgba(200,210,220,.7)'; ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2); ctx.fill(); return; }
          ctx.fillStyle = act ? '#fff' : colr; ctx.strokeStyle = colr; ctx.lineWidth = 1.5;
          if (i === 1 && rl.mode === 'pline') { ctx.moveTo(s.x, s.y - 6); ctx.lineTo(s.x + 6, s.y); ctx.lineTo(s.x, s.y + 6); ctx.lineTo(s.x - 6, s.y); ctx.closePath(); }
          else ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = colr; ctx.font = '10px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(String(i), s.x + 6, s.y - 4);
        });
      };
      handles(rl.le, '#ffb35c', 'le'); handles(rl.te, '#5cc8ff', 'te');
      ctx.restore();
      ctx.strokeStyle = 'rgba(128,160,180,.25)'; ctx.strokeRect(q.x + .5, q.y + .5, q.w - 1, q.h - 1);
      ctx.fillStyle = muted; ctx.font = '12px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(q.name, q.x + 8, q.y + 6);
    }
    const Lm = ((rl.le.L + rl.te.L) / 2).toFixed(1), hgt = (g.mx[1] - rl.A.te[1]).toFixed(1);
    let txt = '<b>' + T('Winglet aus Zeichnung') + '</b> · ' + T('Länge Mittellinie') + ' ' + Lm + ' mm · ' + T('Höhe über Flügelende') + ' ' + hgt + ' mm · '
      + (rl.mode === 'pline' ? T('Polylinie') : T('Spline')) + ' · ' + g.rings.length + ' ' + T('Ringe');
    txt += '<br><span style="opacity:.7">' + T('Griff ziehen = Punkt in dieser Ansicht verschieben · Klick auf Punkt = auswählen (Tangentengriffe) · Tangentenende ziehen = Tangente · Klick auf Kurve = Punkt einfügen · Rechtsklick = Punkt löschen / Tangente automatisch · Shift+Ziehen = schieben · Rad = Zoom · Doppelklick = Ansicht zurücksetzen') + '</span>';
    setInfo(txt);
  }
  // Drahtmodell im vierten Feld: feste Iso-Drehung, Ringe, Rails, Endrippe, Flügel-Bezugslinien.
  function drawWlIso(q, g) {
    const yaw = wlIso.yaw, pitch = wlIso.pitch, cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const c = [(g.mn[0] + g.mx[0]) / 2, (g.mn[1] + g.mx[1]) / 2, (g.mn[2] + g.mx[2]) / 2];
    const rad = Math.max(1, Math.hypot(g.mx[0] - g.mn[0], g.mx[1] - g.mn[1], g.mx[2] - g.mn[2]) / 2), s = 0.42 * Math.min(q.w, q.h) / rad * wlIso.zoom;
    const P = p => { const x = p[0] - c[0], y = p[1] - c[1], z = p[2] - c[2]; const x1 = x * cy + z * sy, z1 = -x * sy + z * cy; return { x: q.x + q.w / 2 + wlIso.px + s * x1, y: q.y + q.h / 2 + wlIso.py - s * (y * cp - z1 * sp) }; };
    const poly = (pts, close) => { ctx.beginPath(); pts.forEach((p, i) => { const v = P(p); i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y); }); if (close) ctx.closePath(); ctx.stroke(); };
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(180,200,220,.5)';
    poly(g.rib, true);
    const rl = g.rl;
    for (const [b, a] of [[rl.B.le, rl.A.le], [rl.B.te, rl.A.te]]) { const t = (g.zRef - b[2]) / ((a[2] - b[2]) || 1); poly([V3.lerp(b, a, Math.max(0, Math.min(1, t))), a]); }
    ctx.strokeStyle = 'rgba(120,200,255,.35)';
    const K = Math.max(1, Math.round(g.rings.length / 16));
    for (let i = K - 1; i < g.rings.length; i += K) poly(g.rings[i].pts.map(p => [p.x, p.y, p.z]), true);
    ctx.lineWidth = 2; ctx.strokeStyle = '#ffb35c'; poly(rl.le.pts); ctx.strokeStyle = '#5cc8ff'; poly(rl.te.pts);
    // Achsenkreuz
    const o = [g.mn[0], g.mn[1], g.mn[2]], L = rad * 0.35;
    for (const [d, colr, nm] of [[[L, 0, 0], '#ff7a7a', 'X'], [[0, L, 0], '#7CFC9A', 'Y'], [[0, 0, L], '#7ab8ff', 'Z']]) {
      const a = P(o), b = P(V3.add(o, d)); ctx.strokeStyle = colr; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.fillStyle = colr; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(nm, b.x + (b.x - a.x) * 0.12, b.y + (b.y - a.y) * 0.12);
    }
  }
  // Kontrollpunkte der Zeichnung (Versätze) lesen/schreiben.
  function wlDrawGet() {
    const D = wlDrawData();
    let D0 = D;
    if (!D0) { const g = wlXf && wlXf.geom; if (!g) return null; D0 = wlDrawFromParam(g.last, g.prev, model.opt); }
    return { le: D0.le.map(p => p.slice()), te: D0.te.map(p => p.slice()), leT: tArr(D0, 'le', D0.le.length + 1), teT: tArr(D0, 'te', D0.te.length + 1) };
  }
  function wlDrawSet(D) { S('formWlDraw', D); }
  // Griff unter der Maus: { key, i, q, end?:±1 } oder null. Tangentengriffe des ausgewählten Punkts haben Vorrang.
  function wlHit(x, y) {
    if (!wlXf) return null;
    let best = null, bd = 9;
    const rl = wlXf.geom.rl;
    for (const q of wlXf.quads) {
      if (q.ha == null || x < q.x || x > q.x + q.w || y < q.y || y > q.y + q.h) continue;
      if (wlSel && rl.mode !== 'pline' && rl[wlSel.key] && rl[wlSel.key].ctrl[wlSel.i]) {
        const r = rl[wlSel.key], p = r.ctrl[wlSel.i], tv = V3.mul(r.tan[wlSel.i], 1 / 3);
        for (const e of (wlSel.i === 0 ? [1] : [-1, 1])) { const s = q.P(V3.add(p, V3.mul(tv, e))), d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = { key: wlSel.key, i: wlSel.i, q, end: e }; } }
        if (best) return best;
      }
      for (const key of ['le', 'te']) rl[key].ctrl.forEach((p, i) => { const s = q.P(p), d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = { key, i, q }; } });
    }
    return best;
  }
  // Tangentengriff ziehen: Ende = P + end·T/3 -> T = end·3·(Ende − P); nur die zwei sichtbaren Koordinaten ändern.
  function wlTanTo(drag, x, y) {
    const D = wlDrawGet(); if (!D) return;
    const g = wlXf.geom, r = g.rl[drag.key], p = r.ctrl[drag.i], arr = D[drag.key + 'T'];
    const cur = V3.add(p, V3.mul(r.tan[drag.i], drag.end / 3)), w = drag.q.inv(x, y);
    cur[drag.q.ha] = w[drag.q.ha]; cur[drag.q.va] = w[drag.q.va];
    let Tv = V3.mul(V3.sub(cur, p), 3 * drag.end);
    if (drag.i === 0) { const d = drag.key === 'le' ? g.rl.dLE : g.rl.dTE; Tv = V3.mul(d, Math.max(1, V3.dot(Tv, d))); }
    if (V3.len(Tv) < 0.5) return;
    arr[drag.i] = Tv; wlDrawSet(D);
  }
  function wlTanReset(hit) { const D = wlDrawGet(); if (!D || !D[hit.key + 'T'][hit.i]) return false; D[hit.key + 'T'][hit.i] = null; wlDrawSet(D); return true; }
  function wlQuadAt(x, y) { return wlXf ? wlXf.quads.find(q => q.ha != null && x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h) : null; }
  // Punkt in einer Ansicht verschieben: nur die beiden sichtbaren Koordinaten ändern.
  function wlMoveTo(drag, x, y) {
    const D = wlDrawGet(); if (!D) return;
    const g = wlXf.geom, P0 = g.rl.A[drag.key], arr = D[drag.key], i = drag.i - 1; if (!arr[i]) return;
    const w = drag.q.inv(x, y), abs = V3.add(P0, arr[i]);
    abs[drag.q.ha] = w[drag.q.ha]; abs[drag.q.va] = w[drag.q.va];
    let off = V3.sub(abs, P0);
    if (drag.i === 1 && (C('formWlDrawMode') === 'pline')) { const d = drag.key === 'le' ? g.rl.dLE : g.rl.dTE; off = V3.mul(d, Math.max(1, V3.dot(off, d))); }
    arr[i] = off; wlDrawSet(D);
  }
  // Klick auf eine Kurve: Punkt dort einfügen (Rückgabe true).
  function wlInsertAt(x, y) {
    const q = wlQuadAt(x, y); if (!q) return false;
    const g = wlXf.geom; let best = null, bd = 8;
    for (const key of ['le', 'te']) { const r = g.rl[key]; r.pts.forEach((p, j) => { const s = q.P(p), d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = { key, j, p }; } }); }
    if (!best) return false;
    const r = g.rl[best.key], u = r.s[best.j] / r.L, D = wlDrawGet(); if (!D) return false;
    let seg = 0; while (seg + 1 < r.knotU.length && r.knotU[seg + 1] <= u) seg++;
    if (seg >= r.knotU.length - 1) return false;
    D[best.key].splice(seg, 0, V3.sub(best.p, g.rl.A[best.key]));   // Versatz-Index seg = zwischen Kontrollpunkt seg und seg+1
    D[best.key + 'T'].splice(seg + 1, 0, null);                       // neuer Punkt: Tangente automatisch
    wlSel = { key: best.key, i: seg + 1 };
    wlDrawSet(D); return true;
  }
  function wlDelete(hit) {
    const D = wlDrawGet(); if (!D || D[hit.key].length <= 1) return false;
    D[hit.key].splice(hit.i - 1, 1); D[hit.key + 'T'].splice(hit.i, 1); wlSel = null; wlDrawSet(D); return true;
  }
  function toggleWlView() {
    if (C('formTarget') !== 'ur') return;
    if (C('formTipMode') !== 'wldraw') S('formTipMode', 'wldraw');
    S('formView', C('formView') === 'wl' ? '3d' : 'wl'); cam = Object.assign({}, CAM0);
    buildSidebar(); refresh();
  }
  function draw() {
    if (!ctx && !fit()) return;
    let v = C('formView');
    if (v === 'wl' && (C('formTipMode') !== 'wldraw' || C('formTarget') !== 'ur')) { v = '3d'; S('formView', v); }
    showBtns = [];
    if (v !== 'cut' && segPinEdit != null) { segPinEdit = null; buildSidebar(); }   // Passstift-Bearbeitung gilt nur im 2D-Schnitt
    if (meas.on && (v === '3d') !== meas.shown) buildMeasPanel();                 // Messfeld nur in der 3D-Ansicht
    if (v === 'prof') drawProf(); else if (v === 'cut') draw2dCut(); else if (v === 'wl') drawWlView(); else draw3d();
  }
  function cutStep(dir) {
    const b = model && model.bounds; if (!b) return;
    const k = AXI[C('formCutAxis')] == null ? 2 : AXI[C('formCutAxis')];
    const st = Math.max(0.5, Math.round((b.mx[k] - b.mn[k]) / 100 * 2) / 2);
    S('formCutPos', Math.min(b.mx[k], Math.max(b.mn[k], (+C('formCutPos') || 0) + dir * st)));
    syncCutInputs(); draw();
  }
  function refresh() { if (state.activeTab !== 'form') return; build(); draw(); }
  // Beim ersten Öffnen des Reiters (je Sitzung) immer in der 3D-Ansicht starten, auch wenn zuletzt
  // 2D-Schnitt / Winglet-Zeichnung / Profilvergleich gespeichert war.
  let shown = false;
  function show() {
    if (!fit()) return;
    if (!shown) { shown = true; if (C('formView') !== '3d') { S('formView', '3d'); cam = Object.assign({}, CAM0); buildSidebar(); } }
    build(); draw();
  }
  function resize() { if (fit()) draw(); }
  function bindCanvas() {
    if (!canvas || bound) return; bound = true;
    if (window.ViewCube) ViewCube.attach({ canvas: () => canvas, get: () => cam, set: (y, p) => { cam.yaw = y; cam.pitch = p; }, redraw: () => draw(), rot: ViewCube.ROT_STD, k: [-0.01, -0.01], active: () => C('formView') === '3d',
      labels: { '+x': 'Endleiste', '-x': 'Nase', '+y': 'Oben', '-y': 'Unten', '+z': 'Außen', '-z': 'Wurzel' } });
    let downX = 0, downY = 0;
    const local = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onGizmo = e => { if (C('formView') !== '3d') return false; const q = local(e); return Math.hypot(q.x - gizmo.cx, q.y - gizmo.cy) <= gizmo.r; };
    let midT = 0, midX = 0, midY = 0, measDown = false;
    canvas.addEventListener('mousedown', e => {
      measDown = false;
      if (e.button === 1 && C('formView') === '3d') {
        const now = performance.now(), q = local(e);
        if (now - midT < 450 && Math.hypot(q.x - midX, q.y - midY) <= 5) { midT = 0; if (setPivotAt(q.x, q.y)) draw(); e.preventDefault(); return; }
        midT = now; midX = q.x; midY = q.y;
      }
      if (e.button === 0 && C('formView') === '3d') { const q = local(e), k = showBtnHit(q.x, q.y); if (k) { if (k === 'wire') S('formWire', !C('formWire')); else if (k === 'ps') S('formPsShow', !C('formPsShow')); else if (k.startsWith('h:')) S('formHalf', k.slice(2)); else S('formShow', k); draw(); e.preventDefault(); return; } }
      dragging = true; dragMode = (e.shiftKey || e.button === 1 || C('formView') !== '3d') ? 'pan' : 'rot';
      if (e.button === 0 && !e.shiftKey && onGizmo(e)) dragMode = 'gizmo';
      measDown = dragMode === 'rot' && measActive();   // Messpunkt erst beim Loslassen ohne Ziehen
      if (C('formView') === 'wl') { const q = local(e); wlPanQ = wlQuadAt(q.x, q.y); }
      if (C('formView') === 'wl' && !e.shiftKey && e.button !== 1) {
        const q = local(e), h = wlHit(q.x, q.y);
        const qi = wlXf && wlXf.quads.find(z => z.ha == null && q.x >= z.x && q.x <= z.x + z.w && q.y >= z.y && q.y <= z.y + z.h);
        if (qi && e.button !== 2) { dragMode = 'wliso'; lastX = downX = e.clientX; lastY = downY = e.clientY; e.preventDefault(); return; }
        if (h && e.button === 2) { dragging = false; dragMode = ''; if (h.end ? wlTanReset(h) : (h.i > 0 && wlDelete(h))) { buildSidebar(); refresh(); } e.preventDefault(); return; }
        if (h && e.button === 0) {
          wlSel = { key: h.key, i: h.i };
          if (h.end) { wlDrag = h; dragMode = 'wltan'; } else if (h.i > 0) { wlDrag = h; dragMode = 'wlpt'; } else { dragging = false; dragMode = ''; draw(); e.preventDefault(); return; }
        }
      }
      lastX = downX = e.clientX; lastY = downY = e.clientY; e.preventDefault();
    });
    canvas.addEventListener('mouseup', e => {
      if (dragMode === 'gizmo' && Math.hypot(e.clientX - downX, e.clientY - downY) <= 3) {
        const q = local(e), f = gizmoHit(q.x, q.y);
        if (f) { cam = Object.assign({}, CAM0, f.cam); draw(); }
        return;
      }
      if (dragMode === 'wlpt' || dragMode === 'wltan') { wlDrag = null; dragMode = ''; buildSidebar(); refresh(); return; }
      if (measDown) {
        measDown = false;
        if (measActive() && (e.button === 0 || e.button === 2) && Math.hypot(e.clientX - downX, e.clientY - downY) <= 3) { const q = local(e); measClick(q.x, q.y, e.button === 2, e.altKey); }
        return;
      }
      if (C('formView') === 'wl' && e.button === 0 && !e.shiftKey && Math.hypot(e.clientX - downX, e.clientY - downY) <= 3) {
        const q = local(e); if (wlInsertAt(q.x, q.y)) { buildSidebar(); refresh(); } else if (wlSel) { wlSel = null; draw(); }
        return;
      }
      if (C('formView') !== 'cut' || !cutXf || Math.hypot(e.clientX - downX, e.clientY - downY) > 3) return;
      if (segPinEdit != null) { const r = canvas.getBoundingClientRect(); if (segPinClick(cutXf.inv(e.clientX - r.left, e.clientY - r.top), e.button === 2)) { buildSidebar(); draw(); } return; }
      if (e.button === 2) { cutMeasure = []; draw(); return; }
      const r = canvas.getBoundingClientRect(), q = cutXf.inv(e.clientX - r.left, e.clientY - r.top);
      if (cutMeasure.length >= 2) cutMeasure = []; cutMeasure.push(q); draw();
    });
    canvas.addEventListener('contextmenu', e => { if (C('formView') === 'cut' || C('formView') === 'wl' || measActive()) e.preventDefault(); });
    window.addEventListener('keydown', e => {
      if (state.activeTab !== 'form' || !measActive() || /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) return;
      if (e.key === 'Escape') { if (meas.cur) meas.cur = null; else { meas.on = false; meas.hover = null; } buildMeasPanel(); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && meas.cur && meas.cur.type === 'chain') { measFinish(); buildMeasPanel(); draw(); e.preventDefault(); }
    });
    canvas.addEventListener('mouseleave', () => measHoverOff());
    window.addEventListener('keydown', e => {
      if (state.activeTab !== 'form' || !C('formCutOn') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { cutStep(-1); e.preventDefault(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { cutStep(+1); e.preventDefault(); }
    });
    canvas.addEventListener('mousemove', e => {
      if (dragging) return;
      const q = local(e), ui = onGizmo(e) || (C('formView') === '3d' && showBtnHit(q.x, q.y)) || (C('formView') === 'wl' && wlHit(q.x, q.y));
      canvas.style.cursor = ui ? 'pointer' : measActive() ? 'crosshair' : '';
      if (measActive()) { if (ui) measHoverOff(); else measHoverAt(q.x, q.y, e.altKey); }
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      if (meas.hover && Math.hypot(e.clientX - downX, e.clientY - downY) > 3) meas.hover = null;   // beim Drehen keine Cursor-Marke
      const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
      if (dragMode === 'wlpt') { const q = local(e); wlMoveTo(wlDrag, q.x, q.y); draw(); return; }
      if (dragMode === 'wltan') { const q = local(e); wlTanTo(wlDrag, q.x, q.y); draw(); return; }
      if (dragMode === 'wliso') { if (e.shiftKey) { wlIso.px += dx; wlIso.py += dy; } else { wlIso.yaw -= dx * 0.01 * (Math.cos(wlIso.pitch) < 0 ? -1 : 1); wlIso.pitch -= dy * 0.01; } draw(); return; }
      if (dragMode === 'pan' && C('formView') === 'wl') { if (wlPanQ && wlView[wlPanQ.id]) { wlView[wlPanQ.id].px += dx; wlView[wlPanQ.id].py += dy; draw(); } return; }
      if (dragMode === 'pan') { cam.px += dx; cam.py += dy; } else { cam.yaw -= dx * 0.01 * (Math.cos(cam.pitch) < 0 ? -1 : 1); cam.pitch -= dy * 0.01; }   // invertiert (wie Simulator)
      draw();
    });
    window.addEventListener('mouseup', () => {
      const wasRot = dragging && dragMode === 'rot';
      dragging = false;
      if (dragMode === 'wlpt' || dragMode === 'wltan') { wlDrag = null; dragMode = ''; buildSidebar(); refresh(); return; }
      if (wasRot && renderMode() === 'fast' && C('formView') === '3d') draw();   // „schnell“: nach dem Drehen wieder in voller Auflösung
    });
    canvas.addEventListener('wheel', e => { e.preventDefault();
      if (C('formView') === 'wl' && wlXf) { const q = local(e), qi = wlXf.quads.find(z => z.ha == null && q.x >= z.x && q.x <= z.x + z.w && q.y >= z.y && q.y <= z.y + z.h); if (qi) { wlIso.zoom = Math.max(0.1, Math.min(30, wlIso.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); draw(); return; }
        const qo = wlQuadAt(q.x, q.y); if (!qo) return;
        const v = wlView[qo.id], f = e.deltaY < 0 ? 1.12 : 1 / 1.12, z1 = Math.max(0.05, Math.min(60, v.zoom * f)), k = z1 / v.zoom;
        // um den Mauszeiger zoomen: Feldmitte so verschieben, dass der Punkt unter der Maus stehen bleibt
        const mx = qo.x + qo.w / 2, my = qo.y + qo.h / 2;
        v.px = (q.x - mx) - ((q.x - mx) - v.px) * k; v.py = (q.y - my) - ((q.y - my) - v.py) * k; v.zoom = z1; draw(); return; }
      cam.zoom *= e.deltaY < 0 ? 1.12 : 1 / 1.12; cam.zoom = Math.max(0.05, Math.min(60, cam.zoom)); draw(); }, { passive: false });
    canvas.addEventListener('dblclick', () => { if (measActive()) return;   // beim Messen setzt ein Doppelklick keine Ansicht zurück (⬚ Iso)
      resetCam(); wlIso = { yaw: 0.9, pitch: 0.35, zoom: 1, px: 0, py: 0 }; wlView = { A: wlView0(), S: wlView0(), D: wlView0() }; draw(); });
    const vb = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
    vb('formIso', () => { resetCam(); S('formView', '3d'); draw(); });
    vb('formTop', () => { resetCam({ yaw: 0, pitch: 1.5 }); S('formView', '3d'); draw(); });
    vb('formSide', () => { resetCam({ yaw: 0, pitch: 0 }); S('formView', '3d'); draw(); });
    vb('formFront', () => { resetCam({ yaw: Math.PI / 2, pitch: 0 }); S('formView', '3d'); draw(); });
    vb('formProf', openCmp);
    vb('formCurv', () => { S('formCurvOn', !C('formCurvOn')); if (C('formView') !== '3d' && C('formView') !== 'cut') { S('formView', '3d'); cam = Object.assign({}, CAM0); } buildSidebar(); draw(); });
    vb('formZebra', () => { S('formZebraOn', !C('formZebraOn')); if (C('formView') !== '3d') { S('formView', '3d'); cam = Object.assign({}, CAM0); } buildSidebar(); draw(); });
    vb('formWlDraw', toggleWlView);
    vb('formCut', () => { if (C('formView') === 'cut') { segPinEdit = null; S('formView', '3d'); } else { S('formCutOn', true); S('formView', 'cut'); cam = Object.assign({}, CAM0); } buildSidebar(); draw(); });
    vb('formMeas', () => {
      // außerhalb der 3D-Ansicht holt der Knopf die Messung nur zurück in 3D, sonst schaltet er sie um
      if (meas.on && C('formView') === '3d') meas.on = false; else meas.on = true;
      meas.cur = null; meas.hover = null;
      if (meas.on && C('formView') !== '3d') { segPinEdit = null; S('formView', '3d'); cam = Object.assign({}, CAM0); }
      buildSidebar(); draw();
    });
  }
  // ---------- Messwerkzeug in der 3D-Ansicht ------------------------------------
  /* Knopf „📏 Messen": Klick (ohne Ziehen) setzt einen Punkt auf der sichtbaren Oberfläche (vorderstes Dreieck
   * unter dem Cursor, die weggeschnittene Seite zählt nicht). Fang im 8-px-Umkreis auf die Ecken des getroffenen
   * Dreiecks und auf vorhandene Messpunkte (Alt = ohne Fang). Arten: Abstand (2 Punkte, ΔX/ΔY/ΔZ), Kette (Summe,
   * Rechtsklick/Enter beendet), Winkel (3 Punkte, Scheitel = 2. Punkt), Radius (Kreis durch 3 Punkte), Wandstärke
   * (1 Punkt: Strahl senkrecht zur Fläche nach innen bis zur Gegenseite desselben Körpers). Punkte werden OHNE
   * Vorschau-Versatz (Abstand der Formhälften / Druckstücke) gespeichert → Maße gelten für die zusammengesetzten
   * Teile; gezeichnet wird mit dem Versatz der getroffenen Quelle. Ziehen dreht die Ansicht wie gewohnt. */
  const MEAS_MODES = [['dist', 'Abstand'], ['chain', 'Kette'], ['angle', 'Winkel'], ['radius', 'Radius'], ['thick', 'Wandstärke']];
  const MEAS_NEED = { dist: 2, angle: 3, radius: 3 };   // Kette: offen (Abschluss per Rechtsklick/Enter), Wandstärke: 1 Klick
  const MEAS_COL = '#7CFC9A', MEAS_COL_CUR = '#ffd27a';
  const meas = { on: false, mode: 'dist', snap: true, axes: true, list: [], cur: null, hover: null, raf: 0, hx: 0, hy: 0, halt: false, shown: false };
  const measActive = () => meas.on && !!model && C('formView') === '3d';
  const mw = q => [q.p[0] + q.o[0], q.p[1] + q.o[1], q.p[2] + q.o[2]];   // Anzeige-Lage eines Messpunkts
  // Vorderster Oberflächenpunkt unter (x, y): { p (Modell), o (Vorschau-Versatz), w (Anzeige), n (Flächennormale), s (Quelle), snap }
  function measHit(x, y, noSnap) {
    if (!model || !model.src) return null;
    const cut = cutSpec();
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const sc = 0.42 * Math.min(W, H) / radius * cam.zoom, ox = W / 2 + cam.px, oy = H / 2 + cam.py, c0 = center[0], c1 = center[1], c2 = center[2];
    const P = new Float64Array(9);
    const pr = (X, Y, Z, j) => { X -= c0; Y -= c1; Z -= c2; const x1 = X * cy + Z * sy, z1 = -X * sy + Z * cy; P[j] = ox + sc * x1; P[j + 1] = oy - sc * (Y * cp - z1 * sp); P[j + 2] = Y * sp + z1 * cp; };
    let best = null;
    for (const s of model.src) {
      const v = s.mesh.v, dy = s.dy || 0, dz = s.dz || 0;
      for (let i = 0; i < v.length; i += 9) {
        pr(v[i], v[i + 1] + dy, v[i + 2] + dz, 0); pr(v[i + 3], v[i + 4] + dy, v[i + 5] + dz, 3); pr(v[i + 6], v[i + 7] + dy, v[i + 8] + dz, 6);
        if (x < Math.min(P[0], P[3], P[6]) || x > Math.max(P[0], P[3], P[6]) || y < Math.min(P[1], P[4], P[7]) || y > Math.max(P[1], P[4], P[7])) continue;
        const den = (P[4] - P[7]) * (P[0] - P[6]) + (P[6] - P[3]) * (P[1] - P[7]); if (Math.abs(den) < 1e-12) continue;
        const a = ((P[4] - P[7]) * (x - P[6]) + (P[6] - P[3]) * (y - P[7])) / den, b = ((P[7] - P[1]) * (x - P[6]) + (P[0] - P[6]) * (y - P[7])) / den, c = 1 - a - b;
        if (a < -1e-6 || b < -1e-6 || c < -1e-6) continue;
        const d = a * P[2] + b * P[5] + c * P[8];   // kleiner = näher am Betrachter (wie der Z-Buffer)
        if (best && d >= best.d) continue;
        const w = [a * v[i] + b * v[i + 3] + c * v[i + 6], a * v[i + 1] + b * v[i + 4] + c * v[i + 7] + dy, a * v[i + 2] + b * v[i + 5] + c * v[i + 8] + dz];
        if (cut && cut.sg * (w[cut.k] - cut.pos) < 0) continue;   // liegt auf der weggeschnittenen Seite
        best = { d, w, s, i };
      }
    }
    if (!best) return null;
    const s = best.s, v = s.mesh.v, i = best.i, o = [0, s.dy || 0, s.dz || 0];
    const A = [v[i], v[i + 1], v[i + 2]], B = [v[i + 3], v[i + 4], v[i + 5]], Cc = [v[i + 6], v[i + 7], v[i + 8]];
    const n = V3.norm(V3.cross(V3.sub(B, A), V3.sub(Cc, A)));
    let p = V3.sub(best.w, o), snap = '';
    if (!noSnap && meas.snap) {
      let bd = 8;
      const tryQ = (q, kind) => { const w = mw(q), e = scr(w[0], w[1], w[2]), dd = Math.hypot(e.x - x, e.y - y); if (dd < bd) { bd = dd; p = q.p; o[0] = q.o[0]; o[1] = q.o[1]; o[2] = q.o[2]; snap = kind; } };
      for (const q of [A, B, Cc]) tryQ({ p: q, o: [0, s.dy || 0, s.dz || 0] }, 'v');
      for (const m of meas.list.concat(meas.cur ? [meas.cur] : [])) for (const q of m.pts) tryQ(q, 'm');
    }
    return { p: p.slice(), o: o.slice(), w: V3.add(p, o), n, s, snap };
  }
  // Strahl P0 + t·d gegen alle Dreiecke einer Quelle (Möller–Trumbore): alle t > 1 µm, aufsteigend, Doppeltreffer
  // auf gemeinsamen Kanten/Ecken zusammengefasst (sonst stimmt die Paritätsprüfung nicht).
  function measRay(s, P0, d) {
    const v = s.mesh.v, dy = s.dy || 0, dz = s.dz || 0, out = [];
    for (let i = 0; i < v.length; i += 9) {
      const ax = v[i], ay = v[i + 1] + dy, az = v[i + 2] + dz;
      const e1x = v[i + 3] - v[i], e1y = v[i + 4] - v[i + 1], e1z = v[i + 5] - v[i + 2];
      const e2x = v[i + 6] - v[i], e2y = v[i + 7] - v[i + 1], e2z = v[i + 8] - v[i + 2];
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det, tx = P0[0] - ax, ty = P0[1] - ay, tz = P0[2] - az;
      const u = (tx * px + ty * py + tz * pz) * inv; if (u < -1e-9 || u > 1 + 1e-9) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const w = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (w < -1e-9 || u + w > 1 + 1e-9) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv; if (t > 1e-3) out.push(t);
    }
    out.sort((a, b) => a - b);
    return out.filter((t, k) => !k || t - out[k - 1] > 1e-6);
  }
  // Wandstärke am Treffer h: Innenseite = Richtung mit ungerader Trefferzahl (geschlossenes Netz), sonst gegen die Normale.
  function measThick(h) {
    if (h.thick !== undefined) return h.thick;
    const n = h.n, a = measRay(h.s, h.w, n), b = measRay(h.s, h.w, V3.mul(n, -1));
    let dir = -1, hits = b;
    if ((a.length % 2 === 1 && b.length % 2 === 0) || !b.length) { dir = 1; hits = a; }
    if (!hits.length) return (h.thick = null);
    const t = hits[0];
    return (h.thick = { t, q: V3.add(h.p, V3.mul(n, dir * t)) });
  }
  // Kreis durch drei Punkte (3D): Mittelpunkt c, Radius r, Ebenennormale n; null bei (fast) kollinearen Punkten.
  function circle3(A, B, Cc) {
    const a = V3.sub(A, Cc), b = V3.sub(B, Cc), axb = V3.cross(a, b), n2 = V3.dot(axb, axb), la = V3.len(a), lb = V3.len(b);
    if (la < 1e-9 || lb < 1e-9 || Math.sqrt(n2) < 1e-6 * la * lb) return null;
    const c = V3.add(Cc, V3.mul(V3.cross(V3.sub(V3.mul(b, la * la), V3.mul(a, lb * lb)), axb), 1 / (2 * n2)));
    return { c, r: V3.len(V3.sub(A, c)), n: V3.norm(axb) };
  }
  // Messwert einer Messung (Modellkoordinaten ohne Vorschau-Versatz): { v, main, sub } oder null.
  function measCalc(m) {
    const P = m.pts.map(q => q.p), f = x => x.toFixed(2);
    let r = null;
    if ((m.type === 'dist' || m.type === 'thick') && P.length >= 2) {
      const d = V3.sub(P[1], P[0]), L = V3.len(d);
      r = m.type === 'thick' ? { v: L, main: f(L) + ' mm', sub: T('Wandstärke senkrecht zur Fläche') }
        : { v: L, main: f(L) + ' mm', sub: 'ΔX ' + f(d[0]) + ' · ΔY ' + f(d[1]) + ' · ΔZ ' + f(d[2]) + ' mm' };
    } else if (m.type === 'chain' && P.length >= 2) {
      let L = 0; for (let i = 1; i < P.length; i++) L += V3.len(V3.sub(P[i], P[i - 1]));
      r = { v: L, main: 'Σ ' + f(L) + ' mm', sub: (P.length - 1) + ' ' + T('Strecken') };
    } else if (m.type === 'angle' && P.length >= 3) {
      const a = V3.sub(P[0], P[1]), b = V3.sub(P[2], P[1]), la = V3.len(a), lb = V3.len(b);
      if (la > 1e-9 && lb > 1e-9) {
        const ang = Math.acos(Math.max(-1, Math.min(1, V3.dot(a, b) / (la * lb)))) * 180 / Math.PI;
        r = { v: ang, main: ang.toFixed(2) + '°', sub: T('Ergänzung') + ' ' + (180 - ang).toFixed(2) + '° · ' + T('Schenkel') + ' ' + f(la) + ' / ' + f(lb) + ' mm' };
      }
    } else if (m.type === 'radius' && P.length >= 3) {
      const c = circle3(P[0], P[1], P[2]);
      if (c) r = { v: c.r, main: 'R ' + f(c.r) + ' mm', sub: 'Ø ' + f(2 * c.r) + ' mm · ' + T('Mitte') + ' X ' + f(c.c[0]) + ' Y ' + f(c.c[1]) + ' Z ' + f(c.c[2]) };
    }
    if (r && m.pts.some(q => q.o[1] !== m.pts[0].o[1] || q.o[2] !== m.pts[0].o[2])) r.sub += ' · ' + T('Teile zusammengesetzt gemessen (ohne Vorschau-Abstand)');
    return r;
  }
  // Wertefeld mit Hintergrund neben (x, y), im Fenster gehalten.
  function measTag(x, y, txt, colr) {
    ctx.font = 'bold 12px system-ui';
    const w = ctx.measureText(txt).width + 10, h = 18;
    const bx = Math.min(Math.max(4, x + 8), W - w - 4), by = Math.min(Math.max(4, y - h - 6), H - h - 4);
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, w, h, 4) : ctx.rect(bx, by, w, h);
    ctx.globalAlpha = 0.85; ctx.fillStyle = col('--bg', '#0f1216'); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = colr; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.stroke();
    ctx.fillStyle = colr; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, bx + 5, by + h / 2 + 0.5);
  }
  function drawMeasOne(m, k, colr, preview) {
    const Wp = m.pts.map(mw), Sp = Wp.map(w => scr(w[0], w[1], w[2])), r = measCalc(m);
    const line = (a, b) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    const path = (pts, close) => { ctx.beginPath(); pts.forEach((w, i) => { const e = scr(w[0], w[1], w[2]); i ? ctx.lineTo(e.x, e.y) : ctx.moveTo(e.x, e.y); }); if (close) ctx.closePath(); ctx.stroke(); };
    ctx.strokeStyle = colr; ctx.lineWidth = 1.6; ctx.setLineDash(preview ? [5, 4] : []);
    let at = Sp[Sp.length - 1];
    if (m.type === 'dist' || m.type === 'thick' || m.type === 'chain') {
      for (let i = 1; i < Sp.length; i++) line(Sp[i - 1], Sp[i]);
      if (Sp.length === 2 && m.type !== 'chain') at = { x: (Sp[0].x + Sp[1].x) / 2, y: (Sp[0].y + Sp[1].y) / 2 };
      // Achsanteile ΔX → ΔY → ΔZ als dünner Winkelzug (nur Abstand)
      if (m.type === 'dist' && meas.axes && Wp.length === 2) {
        const d = V3.sub(Wp[1], Wp[0]), legs = [[0, '#ff8080', 'ΔX'], [1, '#ffe066', 'ΔY'], [2, '#80b8ff', 'ΔZ']];
        let q = Wp[0].slice();
        ctx.save(); ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const [ax, cl, nm] of legs) {
          if (Math.abs(d[ax]) < 1e-6) continue;
          const q2 = q.slice(); q2[ax] += d[ax];
          const a = scr(q[0], q[1], q[2]), b = scr(q2[0], q2[1], q2[2]);
          ctx.strokeStyle = cl; ctx.globalAlpha = 0.85; line(a, b);
          if (Math.hypot(b.x - a.x, b.y - a.y) > 46) { ctx.fillStyle = cl; ctx.fillText(nm + ' ' + d[ax].toFixed(1), (a.x + b.x) / 2, (a.y + b.y) / 2 - 7); }
          q = q2;
        }
        ctx.restore(); ctx.strokeStyle = colr;
      }
    } else if (m.type === 'angle') {
      if (Sp.length >= 2) line(Sp[0], Sp[1]);
      if (Sp.length >= 3) {
        line(Sp[1], Sp[2]);
        const a = V3.sub(Wp[0], Wp[1]), b = V3.sub(Wp[2], Wp[1]), la = V3.len(a), lb = V3.len(b);
        if (la > 1e-9 && lb > 1e-9) {
          const e1 = V3.mul(a, 1 / la), bp = V3.sub(b, V3.mul(e1, V3.dot(b, e1))), lbp = V3.len(bp);
          const th = Math.acos(Math.max(-1, Math.min(1, V3.dot(a, b) / (la * lb)))), rr = 0.3 * Math.min(la, lb);
          if (lbp > 1e-9) {
            const e2 = V3.mul(bp, 1 / lbp), arc = [];
            for (let j = 0; j <= 32; j++) { const t = th * j / 32; arc.push(V3.add(Wp[1], V3.add(V3.mul(e1, rr * Math.cos(t)), V3.mul(e2, rr * Math.sin(t))))); }
            ctx.setLineDash([]); path(arc); ctx.setLineDash(preview ? [5, 4] : []);
            const mid = arc[16]; at = scr(mid[0], mid[1], mid[2]);
          }
        }
      }
    } else if (m.type === 'radius') {
      ctx.save(); ctx.lineWidth = 1; ctx.globalAlpha = 0.6; for (let i = 1; i < Sp.length; i++) line(Sp[i - 1], Sp[i]); ctx.restore();
      const c = Wp.length >= 3 ? circle3(Wp[0], Wp[1], Wp[2]) : null;
      if (c) {
        const u = V3.norm(V3.sub(Wp[0], c.c)), v = V3.cross(c.n, u), ring = [];
        for (let j = 0; j < 72; j++) { const t = j / 72 * Math.PI * 2; ring.push(V3.add(c.c, V3.add(V3.mul(u, c.r * Math.cos(t)), V3.mul(v, c.r * Math.sin(t))))); }
        path(ring, true);
        const ce = scr(c.c[0], c.c[1], c.c[2]);
        ctx.save(); ctx.lineWidth = 1; ctx.setLineDash([4, 3]); line(ce, Sp[1]); ctx.restore();
        ctx.beginPath(); ctx.moveTo(ce.x - 5, ce.y); ctx.lineTo(ce.x + 5, ce.y); ctx.moveTo(ce.x, ce.y - 5); ctx.lineTo(ce.x, ce.y + 5); ctx.stroke();
        at = ce;
      }
    }
    ctx.setLineDash([]);
    for (const e of Sp) { ctx.beginPath(); ctx.arc(e.x, e.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = colr; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke(); }
    if (r && at) measTag(at.x, at.y, (k ? k + ': ' : '') + r.main, colr);
  }
  function drawMeas3d() {
    if (!measActive()) return;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    meas.list.forEach((m, i) => drawMeasOne(m, i + 1, MEAS_COL, false));
    const h = meas.hover;
    if (meas.mode === 'thick' && h && !meas.cur) {
      const th = measThick(h);
      if (th) drawMeasOne({ type: 'thick', pts: [{ p: h.p, o: h.o }, { p: th.q, o: h.o }] }, 0, MEAS_COL_CUR, true);
    } else if (meas.cur) drawMeasOne(h ? { type: meas.cur.type, pts: meas.cur.pts.concat([{ p: h.p, o: h.o }]) } : meas.cur, 0, MEAS_COL_CUR, true);
    if (h) {
      // Cursor-Marke: Kreis + Kreuz frei auf der Fläche, Quadrat = Fang Netzecke, Raute = Fang Messpunkt
      const e = scr(h.w[0], h.w[1], h.w[2]);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath();
      if (h.snap === 'v') ctx.rect(e.x - 5, e.y - 5, 10, 10);
      else if (h.snap === 'm') { ctx.moveTo(e.x, e.y - 7); ctx.lineTo(e.x + 7, e.y); ctx.lineTo(e.x, e.y + 7); ctx.lineTo(e.x - 7, e.y); ctx.closePath(); }
      else { ctx.arc(e.x, e.y, 5, 0, Math.PI * 2); ctx.moveTo(e.x - 10, e.y); ctx.lineTo(e.x - 6, e.y); ctx.moveTo(e.x + 6, e.y); ctx.lineTo(e.x + 10, e.y); ctx.moveTo(e.x, e.y - 10); ctx.lineTo(e.x, e.y - 6); ctx.moveTo(e.x, e.y + 6); ctx.lineTo(e.x, e.y + 10); }
      ctx.stroke();
    }
    ctx.restore();
  }
  function measFinish() {
    const m = meas.cur; meas.cur = null;
    if (m && measCalc(m)) meas.list.push(m);
  }
  // Klick in der 3D-Ansicht: Punkt setzen; Rechtsklick = Kette beenden bzw. letzten Punkt / letzte Messung zurücknehmen.
  function measClick(x, y, right, noSnap) {
    if (right) {
      if (meas.cur && meas.cur.type === 'chain' && meas.cur.pts.length >= 2) measFinish();
      else if (meas.cur) { meas.cur.pts.pop(); if (!meas.cur.pts.length) meas.cur = null; }
      else meas.list.pop();
      buildMeasPanel(); draw(); return;
    }
    const h = measHit(x, y, noSnap); if (!h) return;
    if (meas.mode === 'thick') {
      const th = measThick(h);
      if (!th) { if (App.toast) App.toast(T('Wandstärke: keine Gegenseite gefunden (Netz an dieser Stelle offen?)')); return; }
      meas.list.push({ type: 'thick', pts: [{ p: h.p, o: h.o }, { p: th.q, o: h.o.slice() }] });
    } else {
      if (!meas.cur || meas.cur.type !== meas.mode) meas.cur = { type: meas.mode, pts: [] };
      const last = meas.cur.pts[meas.cur.pts.length - 1];
      if (last && V3.len(V3.sub(last.p, h.p)) < 1e-6 && last.o[1] === h.o[1] && last.o[2] === h.o[2]) return;   // derselbe Punkt (z. B. Doppelklick)
      meas.cur.pts.push({ p: h.p, o: h.o });
      const need = MEAS_NEED[meas.cur.type];
      if (need && meas.cur.pts.length >= need) {
        if (!measCalc(meas.cur)) { meas.cur.pts.pop(); if (App.toast) App.toast(T('Die drei Punkte liegen auf einer Geraden – anderen Punkt wählen.')); }
        else measFinish();
      }
    }
    buildMeasPanel(); draw();
  }
  // Maus über der 3D-Ansicht: Trefferpunkt einmal je Bild bestimmen (Fang-Vorschau, Gummiband, Live-Wandstärke).
  function measHoverAt(x, y, noSnap) {
    meas.hx = x; meas.hy = y; meas.halt = noSnap;
    if (meas.raf) return;
    meas.raf = requestAnimationFrame(() => { meas.raf = 0; if (!measActive()) return; meas.hover = measHit(meas.hx, meas.hy, meas.halt); draw(); measLive(); });
  }
  function measHoverOff() { if (meas.hover) { meas.hover = null; if (measActive()) { draw(); measLive(); } } }
  // Statuszeile im Messfeld (ohne Neuaufbau): nächster Schritt bzw. Koordinaten / Wandstärke unter dem Cursor.
  function measLive() {
    const el = document.getElementById('formMeasLive'); if (!el) return;
    const n = meas.cur ? meas.cur.pts.length : 0, md = meas.mode;
    let step = md === 'thick' ? T('Punkt auf der Fläche anklicken')
      : md === 'chain' ? T('Punkt') + ' ' + (n + 1) + (n >= 2 ? ' · ' + T('Rechtsklick oder Enter beendet die Kette') : '')
      : md === 'angle' ? [T('1. Schenkelpunkt'), T('Scheitelpunkt'), T('2. Schenkelpunkt')][n] || ''
      : T('Punkt') + ' ' + (n + 1) + ' / ' + MEAS_NEED[md] + (md === 'radius' ? ' ' + T('auf dem Bogen') : '');
    const h = meas.hover;
    let cur = '';
    if (h) {
      cur = 'X ' + h.p[0].toFixed(2) + ' · Y ' + h.p[1].toFixed(2) + ' · Z ' + h.p[2].toFixed(2);
      if (h.snap) cur += ' · ' + T(h.snap === 'v' ? 'Fang: Netzecke' : 'Fang: Messpunkt');
      if (md === 'thick') { const th = measThick(h); cur += '<br><b style="color:' + MEAS_COL_CUR + '">' + (th ? T('Wandstärke') + ' ' + th.t.toFixed(2) + ' mm' : T('keine Gegenseite')) + '</b>'; }
    }
    el.innerHTML = '<span style="color:' + MEAS_COL_CUR + '">' + step + '</span>' + (cur ? '<br><span style="opacity:.85">' + cur + '</span>' : '');
  }
  function measText() {
    return meas.list.map((m, i) => { const r = measCalc(m); return r ? (i + 1) + '\t' + T((MEAS_MODES.find(q => q[0] === m.type) || ['', m.type])[1]) + '\t' + r.main + '\t' + r.sub : ''; }).filter(Boolean).join('\n');
  }
  // Bedienfeld rechts oben neben dem Ansichtswürfel (verschiebbar wie die anderen Felder).
  function buildMeasPanel() {
    const el = document.getElementById('formMeasPanel'); if (!el) return;
    { const b = document.getElementById('formMeas'); if (b) b.classList.toggle('primary', meas.on); }
    el.innerHTML = '';
    meas.shown = meas.on && C('formView') === '3d';
    if (!meas.shown) { el.style.display = 'none'; return; }
    el.style.display = '';
    const row = () => { const d = document.createElement('div'); d.style.cssText = 'display:flex;align-items:center;gap:6px;margin:3px 0;flex-wrap:wrap'; el.appendChild(d); return d; };
    const btn = (r, t, on, fn, title) => { const b = document.createElement('button'); b.textContent = T(t); b.className = on ? 'primary' : ''; b.style.cssText = 'flex:1 1 auto;padding:2px 6px;font-size:11px;min-width:0'; if (title) b.title = T(title); b.onclick = fn; r.appendChild(b); return b; };
    const ck = (r, t, on, fn, title) => { const l = document.createElement('label'); l.className = 'ck'; l.style.cssText = 'display:flex;align-items:center;gap:4px;white-space:nowrap'; if (title) l.title = T(title); const i = document.createElement('input'); i.type = 'checkbox'; i.checked = on; i.onchange = () => fn(i.checked); l.appendChild(i); l.appendChild(document.createTextNode(T(t))); r.appendChild(l); return l; };
    const redo = () => { buildMeasPanel(); draw(); };
    let r = row(); const h = document.createElement('b'); h.textContent = '📏 ' + T('Messen'); h.style.flex = '1'; r.appendChild(h);
    btn(r, 'aus', false, () => { meas.on = false; meas.cur = null; meas.hover = null; redo(); }).style.flex = '0 0 auto';
    r = row();
    const tips = { dist: 'Abstand zwischen zwei Punkten (mit ΔX / ΔY / ΔZ)', chain: 'Kette: Summe mehrerer Strecken, Rechtsklick oder Enter beendet', angle: 'Winkel aus drei Punkten, der zweite Punkt ist der Scheitel', radius: 'Radius des Kreises durch drei Punkte (z. B. Nasenradius, Übergang)', thick: 'Wandstärke: Strahl senkrecht zur Fläche nach innen bis zur Gegenseite (Profildicke, Formwand, Platte)' };
    for (const [k, t] of MEAS_MODES) btn(r, t, meas.mode === k, () => { meas.mode = k; meas.cur = null; redo(); }, tips[k]);
    r = row();
    ck(r, 'Fang', meas.snap, v => { meas.snap = v; }, 'Fang auf Netzecken und vorhandene Messpunkte im 8-px-Umkreis (Alt gedrückt = ohne Fang)');
    ck(r, 'ΔX/ΔY/ΔZ zeigen', meas.axes, v => { meas.axes = v; draw(); }, 'Beim Abstand die Achsanteile als farbigen Winkelzug einzeichnen');
    const live = document.createElement('div'); live.id = 'formMeasLive'; live.style.cssText = 'display:block;margin:4px 0;line-height:1.35'; el.appendChild(live);
    if (meas.list.length) {
      const lst = document.createElement('div'); lst.style.cssText = 'display:block;max-height:220px;overflow:auto;margin:4px 0;border-top:1px solid var(--line,#556);padding-top:4px';
      meas.list.forEach((m, i) => {
        const res = measCalc(m); if (!res) return;
        const it = document.createElement('div'); it.style.cssText = 'display:flex;align-items:flex-start;gap:6px;margin:3px 0';
        const tx = document.createElement('div'); tx.style.cssText = 'display:block;flex:1;min-width:0;line-height:1.3';
        tx.innerHTML = '<b style="color:' + MEAS_COL + '">' + (i + 1) + ': ' + res.main + '</b> <span style="opacity:.7">' + T((MEAS_MODES.find(q => q[0] === m.type) || ['', m.type])[1]) + '</span><br><span style="opacity:.75;font-size:10px">' + res.sub + '</span>';
        const x = document.createElement('button'); x.textContent = '✕'; x.title = T('Messung löschen'); x.style.cssText = 'flex:0 0 auto;padding:0 6px;font-size:11px;min-width:0';
        x.onclick = () => { meas.list.splice(i, 1); redo(); };
        it.appendChild(tx); it.appendChild(x); lst.appendChild(it);
      });
      el.appendChild(lst);
      r = row();
      btn(r, '📋 Kopieren', false, () => {
        const t = measText(); if (!t) return;
        const ok = () => App.toast && App.toast(T('Messwerte in die Zwischenablage kopiert'));
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, () => {}); else ok();
      }, 'Alle Messwerte als Text (tabulatorgetrennt) in die Zwischenablage');
      btn(r, 'Alle löschen', false, () => { meas.list = []; meas.cur = null; redo(); });
    }
    const hn = document.createElement('div'); hn.style.cssText = 'display:block;opacity:.6;font-size:10px;line-height:1.35;margin-top:4px';
    hn.textContent = T('Klick = Punkt auf der Oberfläche · Alt = ohne Fang · Rechtsklick = letzten Punkt bzw. letzte Messung zurücknehmen · Esc = abbrechen · Ziehen dreht weiter · Maße ohne Vorschau-Abstand der Teile');
    el.appendChild(hn);
    measLive();
  }
  // ---------- Krümmungsanalyse (Krümmungskamm) ------------------------------
  /* Wie in CAD-Programmen: an jedem Konturpunkt eine Linie senkrecht zur Kontur, Länge
   * proportional zur Krümmung (konvex = nach außen), Spitzen durch eine Hüllkurve (rot)
   * verbunden. Knicke, Wellen und der Übergang Nase/Ober-/Unterseite der Glättung werden
   * so sichtbar. In 3D alle formCurvStep mm über die Spannweite (Schnitte zwischen den
   * Ringen linear interpoliert, wie die Regelfläche des Lofts), im 2D-Schnitt (Ebene Z)
   * an der Schnittlage. Länge = k · Sehne² · Maßstab/100, gekappt bei max % Sehne. */
  function curvOpts() {
    return { on: !!C('formCurvOn'), step: Math.max(1, +C('formCurvStep') || 250), scale: Math.max(0.01, +C('formCurvScale') || 10),
      max: Math.max(1, +C('formCurvMax') || 50), n: Math.max(20, Math.min(600, Math.round(+C('formCurvN') || 120))), env: C('formCurvEnv') !== false,
      dir: C('formCurvDir') === 'span' ? 'span' : 'profile', lines: Math.max(3, Math.min(120, Math.round(+C('formCurvLines') || 13))) };
  }
  // ---- Ringe der Analyse: Tragfläche + Randbogen (W.rings) + Winglet (W.wl), 3D-Punkte {x,y,z} ----
  // Tragflächen-/Randbogenringe liegen in z = ring.z (nach tiltRings mit eigener Punkt-z), Winglet-Ringe
  // stehen frei im Raum. Bauteil „nur Randbogen/Winglet": W.rings sind bereits die Ringe des Teils.
  function curvRings() {
    const Wg = model && model.W; if (!Wg || !Wg.rings || Wg.rings.length < 2) return null;
    const to3 = r => ({ z: r.z, pts: r.pts.map(p => ({ x: p.x, y: p.y, z: p.z == null ? r.z : p.z })) });
    const rings = Wg.rings.map(to3), ts = Wg.tipStart != null ? Wg.tipStart : rings.length - 1;
    const wl = (Wg.wl || []).map(to3);
    return { rings, ts, wl, all: rings.concat(wl) };
  }
  // Ebene (Newell-Normale) eines Rings, für 2D-Ringe = +z; Sehne = Abstand Nase → Endleiste (Mitte beider Enden).
  function ringFrame(P) {
    const M = P.length, iLE = leIndex(M); let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < M; i++) { const a = P[i], b = P[(i + 1) % M]; nx += (a.y - b.y) * (a.z + b.z); ny += (a.z - b.z) * (a.x + b.x); nz += (a.x - b.x) * (a.y + b.y); }
    const L = Math.hypot(nx, ny, nz); const N = L > 1e-12 ? [nx / L, ny / L, nz / L] : [0, 0, 1];
    const le = P[iLE], te = { x: (P[0].x + P[M - 1].x) / 2, y: (P[0].y + P[M - 1].y) / 2, z: (P[0].z + P[M - 1].z) / 2 };
    return { N, chord: Math.max(1e-6, Math.hypot(te.x - le.x, te.y - le.y, te.z - le.z)) };
  }
  // Signierte Krümmung (Menger, Umkreis dreier Nachbarpunkte) je Punkt einer offenen 3D-Polylinie in der Ebene N;
  // Endpunkte = 0. Vorzeichen: positiv = Linkskurve bezogen auf N (bei 2D-Ring mit N = +z wie bisher).
  function curvature(P, N) {
    const k = new Array(P.length).fill(0);
    for (let i = 1; i < P.length - 1; i++) {
      const a = P[i - 1], b = P[i], c = P[i + 1];
      const ab = [b.x - a.x, b.y - a.y, b.z - a.z], bc = [c.x - b.x, c.y - b.y, c.z - b.z], ac = [c.x - a.x, c.y - a.y, c.z - a.z];
      const d = Math.hypot(...ab) * Math.hypot(...bc) * Math.hypot(...ac);
      const cr = [ab[1] * bc[2] - ab[2] * bc[1], ab[2] * bc[0] - ab[0] * bc[2], ab[0] * bc[1] - ab[1] * bc[0]];
      k[i] = d > 1e-12 ? 2 * (cr[0] * N[0] + cr[1] * N[1] + cr[2] * N[2]) / d : 0;
    }
    return k;
  }
  // Außennormale des Rings am Punkt i in der Ringebene: t × N (rechts der Laufrichtung, CCW = außen).
  function ringOutNormal(P, i, N) {
    const M = P.length, a = P[Math.max(0, i - 1)], c = P[Math.min(M - 1, i + 1)];
    const t = [c.x - a.x, c.y - a.y, c.z - a.z];
    const n = [t[1] * N[2] - t[2] * N[1], t[2] * N[0] - t[0] * N[2], t[0] * N[1] - t[1] * N[0]], L = Math.hypot(...n) || 1;
    return [n[0] / L, n[1] / L, n[2] / L];
  }
  // Kamm einer Kontur (3D-Ring): [{i, p, q, k, L}] (Index, Fußpunkt, Spitze, Krümmung, Linienlänge). k·n ist vom
  // Umlaufsinn unabhängig (beide kehren sich gemeinsam um) -> konvexe Stellen zeigen immer nach außen.
  function curvComb(P, o) {
    const M = P.length; if (M < 5) return [];
    const fr = ringFrame(P), chord = fr.chord, K = curvature(P, fr.N), Lmax = chord * o.max / 100, f = chord * chord * o.scale / 100;
    const st = Math.max(1, Math.round(M / o.n)), out = [];
    let kMax = 0, kMin = 0;
    for (let i = 1; i < M - 1; i += st) {
      const n = ringOutNormal(P, i, fr.N);
      let L = K[i] * f; if (Math.abs(L) > Lmax) L = Math.sign(L) * Lmax;
      const p = P[i]; out.push({ i, p, q: { x: p.x + n[0] * L, y: p.y + n[1] * L, z: p.z + n[2] * L }, k: K[i], L });
      kMax = Math.max(kMax, K[i]); kMin = Math.min(kMin, K[i]);
    }
    out.kMax = kMax; out.kMin = kMin; out.chord = chord;
    return out;
  }
  // Schnitt der Tragfläche (bis Randbogenbeginn) bei z: lineare Interpolation der Nachbarringe.
  function curvSectionAt(z) {
    const CR = curvRings(); if (!CR || CR.ts < 1) return null;
    const R = CR.rings, ts = CR.ts;
    const zz = model.opt.mirror ? Math.abs(z) : z, sg = model.opt.mirror && z < 0 ? -1 : 1;
    for (let i = 0; i < ts; i++) {
      const a = R[i], b = R[i + 1];
      if (zz >= a.z - 1e-6 && zz <= b.z + 1e-6) {
        const t = b.z > a.z ? Math.max(0, Math.min(1, (zz - a.z) / (b.z - a.z))) : 0;
        return a.pts.map((p, j) => { const q = b.pts[j] || p; return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: sg * (p.z + (q.z - p.z) * t) }; });
      }
    }
    return null;
  }
  // Ring gespiegelt (z -> −z)
  const mirRing = P => P.map(p => ({ x: p.x, y: p.y, z: -p.z }));
  // Alle Analyse-Schnitte: Tragfläche ab Wurzel alle step mm bis zur letzten Rippe, danach die Ringe von
  // Randbogen bzw. Winglet selbst (im Abstand step entlang ihrer Mittellinie, kollabierte Ringe übersprungen);
  // gespiegelt auch −z. Cache je Modell + Einstellung.
  function curvSections(o) {
    const CR = curvRings(); if (!CR) return [];
    const key = JSON.stringify([o.dir, o.lines, o.step, o.scale, o.max, o.n, !!model.opt.mirror]);
    if (model.curvCache && model.curvCache.key === key) return model.curvCache.sec;
    if (o.dir === 'span') { const sec = curvSpanChains(o); model.curvCache = { key, sec }; return sec; }
    const R = CR.rings, ts = CR.ts, out = [];
    const push = (z, P) => { const comb = curvComb(P, o); if (comb.length) out.push({ z, pts: P, comb }); if (model.opt.mirror && Math.abs(z) > 1e-6) { const Q = mirRing(P); out.push({ z: -z, pts: Q, comb: curvComb(Q, o) }); } };
    if (ts >= 1) {
      const zEnd = R[ts].z;
      for (let z = R[0].z, n = 0; z <= zEnd + 1e-6 && n < 2000; z += o.step, n++) { const P = curvSectionAt(z); if (P) { const comb = curvComb(P, o); if (comb.length) out.push({ z, pts: P, comb }); if (model.opt.mirror && z > 1e-6) { const Q = curvSectionAt(-z); out.push({ z: -z, pts: Q, comb: curvComb(Q, o) }); } } }
    }
    // Randbogen / Winglet: Ringe ab der letzten Rippe (bei Bauteil „nur Randbogen" ab Ring 0)
    const tail = CR.all.slice(ts >= 1 ? ts : 0);
    if (tail.length > 1) {
      const cen = P => { let x = 0, y = 0, z = 0; for (const p of P) { x += p.x; y += p.y; z += p.z; } return [x / P.length, y / P.length, z / P.length]; };
      let sLast = -Infinity, sAcc = 0, cPrev = null, n = 0;
      for (let k = ts >= 1 ? 1 : 0; k < tail.length && n < 2000; k++) {
        const r = tail[k], c = cen(r.pts); if (cPrev) sAcc += Math.hypot(c[0] - cPrev[0], c[1] - cPrev[1], c[2] - cPrev[2]); cPrev = c;
        if (ringFrame(r.pts).chord < 0.5) continue;
        if (sAcc - sLast >= o.step - 1e-6 || k === tail.length - 1) { push(r.z, r.pts); sLast = sAcc; n++; }
      }
    }
    model.curvCache = { key, sec: out };
    return out;
  }
  /* Spannweitenkrümmung: Längslinien = Kette des Konturpunkts i über alle Ringe (Wurzel … Randbogen bzw. Winglet).
   * Krümmung der 3D-Polylinie (Menger), Vorzeichen aus der Projektion des Krümmungsvektors auf die
   * Außennormale des Rings (konvex = nach außen). Linienlänge wie beim Profilkamm mit der Sehne des
   * jeweiligen Rings. Zeigt Knicke des Lofts an den Rippenstationen (Regelfläche) bzw. deren Fehlen (Spline). */
  function curvSpanChains(o) {
    const CR = curvRings(); if (!CR) return [];
    const M = CR.all[0].pts.length, R = CR.all.filter(r => r.pts.length === M && ringFrame(r.pts).chord >= 0.5), N = R.length;
    if (N < 3) return [];
    const iLE = leIndex(M), idx = new Set([0, M - 1, iLE]);
    for (let j = 0; j < o.lines; j++) idx.add(Math.round(j * (M - 1) / Math.max(1, o.lines - 1)));
    const frames = R.map(r => ringFrame(r.pts));
    const st = Math.max(1, Math.round(N / 400)), out = [];
    const mk = sg => {
      for (const i of [...idx].sort((a, b) => a - b)) {
        const comb = [];
        for (let k = 1; k < N - 1; k += st) {
          const a = R[k - 1].pts[i], b = R[k].pts[i], c = R[k + 1].pts[i];
          const ab = [b.x - a.x, b.y - a.y, b.z - a.z], bc = [c.x - b.x, c.y - b.y, c.z - b.z], ac = [c.x - a.x, c.y - a.y, c.z - a.z];
          const Lab = Math.hypot(...ab), Lbc = Math.hypot(...bc), Lac = Math.hypot(...ac);
          if (Lab < 1e-9 || Lbc < 1e-9 || Lac < 1e-9) continue;
          const cr = [ab[1] * bc[2] - ab[2] * bc[1], ab[2] * bc[0] - ab[0] * bc[2], ab[0] * bc[1] - ab[1] * bc[0]];
          const kappa = 2 * Math.hypot(...cr) / (Lab * Lbc * Lac);
          // Krümmungsvektor-Richtung: Differenz der Einheitstangenten
          const kv = [bc[0] / Lbc - ab[0] / Lab, bc[1] / Lbc - ab[1] / Lab, bc[2] / Lbc - ab[2] / Lab], Lkv = Math.hypot(...kv);
          const n = ringOutNormal(R[k].pts, i, frames[k].N);
          const proj = Lkv > 1e-12 ? (kv[0] * n[0] + kv[1] * n[1] + kv[2] * n[2]) / Lkv : 0;
          const chord = frames[k].chord, f = chord * chord * o.scale / 100, Lmax = chord * o.max / 100;
          let L = -proj * kappa * f; if (Math.abs(L) > Lmax) L = Math.sign(L) * Lmax;
          const p = { x: b.x, y: b.y, z: sg * b.z };
          comb.push({ i, p, q: { x: p.x + n[0] * L, y: p.y + n[1] * L, z: p.z + sg * n[2] * L }, k: -proj * kappa, L });
        }
        out.push({ z: null, line: i, comb });
      }
    };
    mk(1); if (model.opt.mirror) mk(-1);
    return out;
  }
  // Versatz der Kämme in der Vorschau: Formhälften (dy je Ober-/Unterseite) und auseinandergezogene Druckstücke (dz).
  function curvOffsets() {
    const o = model.opt, split = (o.target === 'neg' || o.target === 'split') && model.top && model.bot;
    const gap = split ? (+C('formGap') || 0) / 2 : 0, half = split ? (C('formHalf') || 'both') : 'both';
    const so = segOpts(), segP = so.on ? segPlanes(so) : [], n = segP.length + 1;
    const dz = z => { if (!segP.length || !so.gap) return 0; let i = 0; while (i < segP.length && z > segP[i]) i++; return (i - (n - 1) / 2) * so.gap; };
    return { dyTop: half === 'bot' ? null : gap, dyBot: half === 'top' ? null : -gap, dz };
  }
  // Kamm eines Schnitts zeichnen; map(x,y,z,dy) -> Bildpunkt. Rückgabe false, wenn nichts gezeichnet wurde.
  function drawComb(s, o, off, map) {
    const M = s.pts ? s.pts.length : (model.W.rings[0].pts.length), iLE = leIndex(M), dz0 = s.z == null ? null : off.dz(s.z);
    const dyOf = h => h.i <= iLE ? off.dyTop : off.dyBot, dzOf = h => dz0 == null ? off.dz(h.p.z) : dz0;
    ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(70,190,205,.85)'; ctx.beginPath();
    let any = false;
    for (const h of s.comb) { const dy = dyOf(h); if (dy == null) continue; const dz = dzOf(h); const a = map(h.p.x, h.p.y + dy, h.p.z + dz), b = map(h.q.x, h.q.y + dy, h.q.z + dz); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); any = true; }
    ctx.stroke();
    if (o.env && any) {
      ctx.strokeStyle = 'rgba(255,70,70,.95)'; ctx.lineWidth = 1.3; ctx.beginPath();
      let pen = false;
      for (const h of s.comb) { const dy = dyOf(h); if (dy == null) { pen = false; continue; } const b = map(h.q.x, h.q.y + dy, h.q.z + dzOf(h)); pen ? ctx.lineTo(b.x, b.y) : ctx.moveTo(b.x, b.y); pen = true; }
      ctx.stroke();
    }
    ctx.restore();
    return any;
  }
  function drawCurv3d(o) {
    const sec = curvSections(o); if (!sec.length) return 0;
    const off = curvOffsets(); let n = 0;
    for (const s of sec) if (drawComb(s, o, off, scr)) n++;
    return n;
  }
  // 2D-Schnitt (Ebene Z): Kamm an der Schnittlage.
  function drawCurv2d(o, cut, P) {
    if (cut.k !== 2 || o.dir === 'span') return false;
    const pts = curvSectionAt(cut.pos); if (!pts) return false;
    const off = curvOffsets(); off.dz = () => 0;
    return drawComb({ z: cut.pos, pts, comb: curvComb(pts, o) }, o, off, (x, y) => P(x, y));
  }
  // Bedienfeld im Ansichtsfenster (rechts unten). Der Schnittabstand wird ERST MIT ENTER übernommen:
  // beim Tippen wird das Feld gelb umrandet, Esc oder Verlassen des Felds stellt den alten Wert wieder her.
  function buildCurvPanel() {
    const el = document.getElementById('formCurvPanel'); if (!el) return;
    el.innerHTML = '';
    const on = !!C('formCurvOn'), zOn = !!C('formZebraOn');
    { const b = document.getElementById('formCurv'); if (b) b.classList.toggle('primary', on); }
    { const b = document.getElementById('formZebra'); if (b) b.classList.toggle('primary', zOn); }
    if (!on && !zOn) { el.style.display = 'none'; return; }
    el.style.display = '';
    { const bar = el.parentElement && el.parentElement.querySelector('.simbar'); el.style.bottom = ((bar ? bar.offsetHeight : 38) + 8) + 'px'; }
    const rb = () => { buildSidebar(); draw(); };
    const row = () => { const d = document.createElement('div'); d.style.cssText = 'display:flex;align-items:center;gap:6px;margin:3px 0'; el.appendChild(d); return d; };
    const lab = (r, t, w) => { const l = document.createElement('span'); l.textContent = T(t); l.style.cssText = 'opacity:.7;flex:0 0 ' + (w || 92) + 'px'; r.appendChild(l); return l; };
    if (zOn) buildZebraRows(row, lab, rb);
    if (!on) return;
    if (zOn) { const hr = document.createElement('div'); hr.style.cssText = 'border-top:1px solid var(--line,#556);margin:6px 0'; el.appendChild(hr); }
    let r = row(); const h = document.createElement('b'); h.textContent = T('Krümmungsanalyse'); h.style.flex = '1'; r.appendChild(h);
    const bx = document.createElement('button'); bx.textContent = T('aus'); bx.style.cssText = 'flex:0 0 auto;padding:2px 6px;font-size:11px'; bx.onclick = () => { S('formCurvOn', false); rb(); }; r.appendChild(bx);
    // Richtung: Profil (Schnitte z = konst) oder Spannweite (Längslinien)
    r = row(); lab(r, 'Richtung');
    const dsel = document.createElement('select'); dsel.style.cssText = 'flex:1;min-width:0;font-size:11px;padding:2px 4px';
    dsel.title = T('Profil: Kamm auf Schnitten quer zur Spannweite – zeigt Wellen/Knicke der Profilglättung. Spannweite: Kamm entlang Längslinien (Nase, Endleiste, Zwischenlinien) – zeigt Knicke des Lofts an den Rippenstationen (Regelfläche) bzw. den glatten Verlauf (Spline).');
    for (const [v, t] of [['profile', 'Profil (Schnitte)'], ['span', 'Spannweite (Längslinien)']]) { const o = document.createElement('option'); o.value = v; o.textContent = T(t); if (v === (C('formCurvDir') === 'span' ? 'span' : 'profile')) o.selected = true; dsel.appendChild(o); }
    dsel.onchange = () => { S('formCurvDir', dsel.value); rb(); }; r.appendChild(dsel);
    const spanDir = C('formCurvDir') === 'span';
    if (spanDir) {
      r = row(); lab(r, 'Längslinien');
      const ln = document.createElement('input'); ln.type = 'number'; ln.min = 3; ln.max = 120; ln.step = 2; ln.value = C('formCurvLines'); ln.style.cssText = 'width:56px;font-size:11px;padding:2px 4px';
      ln.title = T('Anzahl der Längslinien um die Kontur (Nase und Endleiste sind immer dabei).');
      ln.onchange = () => { S('formCurvLines', Math.max(3, Math.min(120, Math.round(+ln.value || 13)))); draw(); }; r.appendChild(ln);
    }
    // Abstand: Textfeld, Übernahme nur mit Enter
    if (!spanDir) { r = row(); lab(r, 'Abstand (mm)');
    const inp = document.createElement('input'); inp.type = 'text'; inp.inputMode = 'decimal'; inp.value = C('formCurvStep'); inp.style.cssText = 'width:64px;font-size:11px;padding:2px 4px';
    inp.title = T('Abstand der Analyse-Schnitte ab der Wurzel. Eingabe erst mit Enter übernehmen (Esc = verwerfen).');
    const tag = document.createElement('span'); tag.textContent = T('↵ Enter übernimmt'); tag.style.cssText = 'font-size:10px;color:#ffd166;display:none';
    const pending = p => { inp.style.borderColor = p ? '#ffd166' : ''; tag.style.display = p ? '' : 'none'; };
    inp.oninput = () => pending(inp.value.trim() !== String(C('formCurvStep')));
    inp.onkeydown = e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = parseFloat(String(inp.value).replace(',', '.'));
        if (isFinite(v) && v >= 1) { S('formCurvStep', Math.round(v * 100) / 100); inp.value = C('formCurvStep'); pending(false); draw(); }
        else { inp.value = C('formCurvStep'); pending(false); }
      } else if (e.key === 'Escape') { e.preventDefault(); inp.value = C('formCurvStep'); pending(false); inp.blur(); }
    };
    inp.onblur = () => { inp.value = C('formCurvStep'); pending(false); };
    r.appendChild(inp); r.appendChild(tag); }
    // Maßstab (Schieber, sofort)
    r = row(); lab(r, 'Maßstab');
    const rg = document.createElement('input'); rg.type = 'range'; rg.min = 0.5; rg.max = 60; rg.step = 0.5; rg.value = C('formCurvScale'); rg.style.cssText = 'flex:1;min-width:0';
    rg.title = T('Linienlänge = Krümmung × Sehne² × Maßstab / 100');
    rg.oninput = () => { S('formCurvScale', +rg.value); draw(); }; r.appendChild(rg);
    // Kappung + Liniendichte
    r = row(); lab(r, 'max. Länge (% Sehne)');
    const mx = document.createElement('input'); mx.type = 'number'; mx.min = 1; mx.max = 300; mx.step = 5; mx.value = C('formCurvMax'); mx.style.cssText = 'width:56px;font-size:11px;padding:2px 4px';
    mx.onchange = () => { S('formCurvMax', Math.max(1, +mx.value || 50)); draw(); }; r.appendChild(mx);
    r = row(); if (!spanDir) { lab(r, 'Linien je Schnitt');
    const nn = document.createElement('input'); nn.type = 'number'; nn.min = 20; nn.max = 600; nn.step = 10; nn.value = C('formCurvN'); nn.style.cssText = 'width:56px;font-size:11px;padding:2px 4px';
    nn.onchange = () => { S('formCurvN', Math.max(20, Math.min(600, Math.round(+nn.value || 120)))); draw(); }; r.appendChild(nn); }
    const ck = document.createElement('label'); ck.className = 'ck'; ck.style.cssText = 'display:flex;align-items:center;gap:4px;white-space:nowrap;margin-left:auto';
    const ci = document.createElement('input'); ci.type = 'checkbox'; ci.checked = C('formCurvEnv') !== false; ci.onchange = () => { S('formCurvEnv', ci.checked); draw(); };
    ck.appendChild(ci); ck.appendChild(document.createTextNode(T('Hüllkurve'))); r.appendChild(ck);
  }
  // Zebra-Analyse: Abschnitt im selben Bedienfeld (Streifenzahl, Richtung, Stärke).
  function buildZebraRows(row, lab, rb) {
    let r = row(); const h = document.createElement('b'); h.textContent = T('Zebra-Analyse'); h.style.flex = '1'; r.appendChild(h);
    const bx = document.createElement('button'); bx.textContent = T('aus'); bx.style.cssText = 'flex:0 0 auto;padding:2px 6px;font-size:11px'; bx.onclick = () => { S('formZebraOn', false); rb(); }; r.appendChild(bx);
    if (!glActive()) { const w = document.createElement('div'); w.style.cssText = 'color:#ffd166;font-size:11px;margin:2px 0'; w.textContent = T('Nur mit WebGL-Darstellung („fein“ oder „schnell“, kein Drahtgitter).'); row().appendChild(w); }
    r = row(); lab(r, 'Streifen');
    const rg = document.createElement('input'); rg.type = 'range'; rg.min = 4; rg.max = 120; rg.step = 2; rg.value = C('formZebraN'); rg.style.cssText = 'flex:1;min-width:0';
    rg.title = T('Anzahl der Streifen über den Spiegelwinkel: mehr Streifen = feinere Prüfung');
    rg.oninput = () => { S('formZebraN', +rg.value); draw(); }; r.appendChild(rg);
    r = row(); lab(r, 'Bezug');
    const sel = document.createElement('select'); sel.style.cssText = 'flex:1;min-width:0;font-size:11px;padding:2px 4px';
    sel.title = T('Bauteil: feste Streifenachse im Modell – die Streifen laufen über Randbogen und Winglet durch und drehen sich mit dem Bauteil. Ansicht: Achse in der Bildebene (klassisches CAD-Zebra, Muster ändert sich beim Drehen).');
    for (const [v, t] of [['part', 'Bauteil'], ['view', 'Ansicht']]) { const o = document.createElement('option'); o.value = v; o.textContent = T(t); if (v === (C('formZebraRef') === 'view' ? 'view' : 'part')) o.selected = true; sel.appendChild(o); }
    sel.onchange = () => { S('formZebraRef', sel.value); rb(); }; r.appendChild(sel);
    r = row(); lab(r, 'Winkel');
    const an = document.createElement('input'); an.type = 'range'; an.min = 0; an.max = 180; an.step = 5; an.value = zebraAngle(); an.style.cssText = 'flex:1;min-width:0';
    const av = document.createElement('span'); av.style.cssText = 'flex:0 0 34px;text-align:right;font-size:11px'; av.textContent = zebraAngle() + '°';
    an.title = T(C('formZebraRef') === 'view' ? 'Winkel der Streifenachse in der Bildebene: 0° = senkrecht, 90° = waagrecht' : 'Winkel der Streifenachse zum Bauteil: 0° = Sehnenrichtung, 90° = Spannweite (Streifen quer zur Spannweite, zeigen die Profilkrümmung)');
    an.oninput = () => { S('formZebraAng', +an.value); av.textContent = an.value + '°'; draw(); }; r.appendChild(an); r.appendChild(av);
    r = row(); lab(r, 'Deckkraft');
    const mx = document.createElement('input'); mx.type = 'range'; mx.min = 10; mx.max = 100; mx.step = 5; mx.value = C('formZebraMix'); mx.style.cssText = 'flex:1;min-width:0';
    mx.title = T('Deckkraft der Streifen gegenüber der Schattierung');
    mx.oninput = () => { S('formZebraMix', +mx.value); draw(); }; r.appendChild(mx);
  }
  // ---------- Bedienfeld Schnittansicht im Ansichtsfenster ---------------------
  /* Schwebendes Feld links unten über der Knopfleiste (statt Gruppe in der
   * Seitenleiste): Ebene, Lage (Schieber + Zahl), entfernte Seite, Füllung,
   * Umschalten 3D/2D, Ausschalten. Wird bei jedem Sidebar-Aufbau neu gebaut. */
  function buildCutPanel() {
    const el = document.getElementById('formCutPanel'); if (!el) return;
    el.innerHTML = '';
    if (!C('formCutOn')) { el.style.display = 'none'; return; }
    el.style.display = '';
    { const bar = el.parentElement && el.parentElement.querySelector('.simbar'); el.style.bottom = ((bar ? bar.offsetHeight : 38) + 8) + 'px'; }   // über der Knopfleiste (auch wenn sie umbricht)
    const rb = () => { buildSidebar(); draw(); };
    const row = () => { const d = document.createElement('div'); d.style.cssText = 'display:flex;align-items:center;gap:6px;margin:3px 0'; el.appendChild(d); return d; };
    const lab = (r, t, w) => { const l = document.createElement('span'); l.textContent = T(t); l.style.cssText = 'opacity:.7;flex:0 0 ' + (w || 52) + 'px'; r.appendChild(l); return l; };
    const sel = (r, opts, cur, fn) => { const s = document.createElement('select'); s.style.cssText = 'flex:1;min-width:0;font-size:11px;padding:2px 4px'; for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = T(t); if (v === cur) o.selected = true; s.appendChild(o); } s.onchange = () => fn(s.value); r.appendChild(s); return s; };
    const btn = (r, t, on, fn, title) => { const b = document.createElement('button'); b.textContent = T(t); b.className = on ? 'primary' : ''; b.style.cssText = 'flex:1;padding:2px 6px;font-size:11px'; if (title) b.title = T(title); b.onclick = fn; r.appendChild(b); return b; };
    // Kopf: Titel + Aus
    let r = row(); const h = document.createElement('b'); h.textContent = T('Schnittansicht'); h.style.flex = '1'; r.appendChild(h);
    btn(r, 'Schnitt aus', false, () => { S('formCutOn', false); if (C('formView') === 'cut') { segPinEdit = null; S('formView', '3d'); } rb(); }).style.flex = '0 0 auto';
    // Ebene
    r = row(); lab(r, 'Ebene');
    sel(r, [['z', 'Spannweite Z'], ['x', 'Sehne X'], ['y', 'Höhe Y']], C('formCutAxis'), v => { S('formCutAxis', v); const b = model && model.bounds; if (b) { const k = AXI[v]; S('formCutPos', (b.mn[k] + b.mx[k]) / 2); } rb(); });
    // Lage: Schieber + Zahl
    const b = model && model.bounds, k = AXI[C('formCutAxis')] == null ? 2 : AXI[C('formCutAxis')];
    const lo = b ? Math.floor(b.mn[k]) : -500, hi = b ? Math.ceil(b.mx[k]) : 500;
    r = row(); lab(r, 'Lage (mm)');
    const rg = document.createElement('input'); rg.type = 'range'; rg.min = lo; rg.max = hi; rg.step = 0.5; rg.value = C('formCutPos'); rg.dataset.formcut = '1'; rg.style.cssText = 'flex:1;min-width:0';
    const nm = document.createElement('input'); nm.type = 'number'; nm.step = 0.5; nm.value = Math.round(C('formCutPos') * 10) / 10; nm.dataset.formcut = '1'; nm.style.cssText = 'width:64px;font-size:11px;padding:2px 4px';
    rg.oninput = () => { S('formCutPos', +rg.value); syncCutInputs(); draw(); };
    nm.onchange = () => { S('formCutPos', +nm.value || 0); syncCutInputs(); draw(); };
    rg.title = nm.title = lo + ' … ' + hi + ' mm · ' + T('←/→ verschieben die Ebene');
    r.appendChild(rg); r.appendChild(nm);
    // 3D-Optionen: entfernte Seite, Füllung
    r = row(); lab(r, '3D: entfernte Seite', 100);
    sel(r, [['+', 'größere Koordinate (+)'], ['-', 'kleinere Koordinate (−)']], C('formCutSide'), v => { S('formCutSide', v); draw(); });
    const ck = document.createElement('label'); ck.className = 'ck'; ck.style.cssText = 'display:flex;align-items:center;gap:4px;white-space:nowrap';
    const ci = document.createElement('input'); ci.type = 'checkbox'; ci.checked = !!C('formCutFill'); ci.onchange = () => { S('formCutFill', ci.checked); draw(); };
    ck.appendChild(ci); ck.appendChild(document.createTextNode(T('füllen'))); r.appendChild(ck);
    // Ansicht umschalten
    r = row();
    btn(r, '3D aufgeschnitten', C('formView') !== 'cut', () => { if (C('formView') === 'cut') segPinEdit = null; S('formView', '3d'); rb(); });
    btn(r, '2D-Schnitt', C('formView') === 'cut', () => { S('formView', 'cut'); cam = Object.assign({}, CAM0); rb(); });
  }
  // Schieber/Zahlenfeld der Schnittlage nachführen (ohne Sidebar-Neuaufbau).
  function syncCutInputs() {
    const v = +C('formCutPos') || 0;
    document.querySelectorAll('[data-formcut]').forEach(el => { if (document.activeElement !== el) el.value = el.type === 'range' ? v : Math.round(v * 10) / 10; });
  }


  // ---------- Vergleichsfenster „Profilglättung" (eigenes Modal) ------------
  /* Großes Fenster zum Vergleichen: Rohpunkte, geglättete Kurve, Kontrollpolygon
   * und eine eingefrorene Referenz (vorheriger Parameterstand) überlagert;
   * darunter die Abweichungskurve (Rohpunkt -> Kurve, signiert, über die
   * Sehnenlage) und rechts die Parameter mit Live-Aktualisierung. Alle
   * Stationen als Tabelle mit ihrer maximalen Abweichung. */
  let cmp = null;   // { el, cvs, cvsDev, nav:{zoom,px,py}, ref:{sm,name,label}|null, show:{...} }
  function cmpDom() {
    if (cmp) return cmp;
    const bd = document.createElement('div'); bd.className = 'modal-backdrop'; bd.id = 'formCmpModal';
    bd.innerHTML =
      '<div class="modal" style="width:min(1300px,96vw);max-width:96vw;height:min(880px,94vh);max-height:94vh;display:flex;flex-direction:column">'
      + '<div class="head"><h2>' + T('Profilglättung — Vergleich') + '</h2>'
      + '<button id="formCmpRef" style="margin-left:auto;margin-right:8px" title="' + T('Aktuelle geglättete Kurve als graue Referenz einfrieren, dann Parameter ändern und vergleichen') + '">' + T('Als Referenz merken') + '</button>'
      + '<button class="close-x" id="formCmpClose" title="' + T('Schließen') + '">×</button></div>'
      + '<div class="body" style="flex:1 1 auto;display:flex;gap:14px;min-height:0;overflow:hidden;padding-top:10px">'
      +   '<div style="flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:6px">'
      +     '<div id="formCmpTop" class="hint" style="flex:0 0 auto"></div>'
      +     '<div style="position:relative;flex:3 1 0;min-height:0;background:var(--panel2,#0e1520);border-radius:8px"><canvas id="cFormCmp" style="width:100%;height:100%;display:block;cursor:grab"></canvas></div>'
      +     '<div class="hint" style="flex:0 0 auto">' + T('Abweichung Rohpunkt → geglättete Kurve (positiv = Kurve liegt außerhalb), über die Kontur von Endleiste oben über die Nase zur Endleiste unten') + '</div>'
      +     '<div style="position:relative;flex:1 1 0;min-height:90px;background:var(--panel2,#0e1520);border-radius:8px"><canvas id="cFormCmpDev" style="width:100%;height:100%;display:block"></canvas></div>'
      +     '<div class="hint" style="flex:0 0 auto">' + T('Mausrad = Zoom (am Cursor) · Ziehen = Verschieben · Doppelklick = zurücksetzen · Tasten N / E = Nase / Endleiste vergrößern') + '</div>'
      +   '</div>'
      +   '<div id="formCmpSide" style="flex:0 0 300px;overflow:auto;display:flex;flex-direction:column;gap:4px"></div>'
      + '</div></div>';
    document.body.appendChild(bd);
    cmp = { el: bd, cvs: bd.querySelector('#cFormCmp'), cvsDev: bd.querySelector('#cFormCmpDev'),
      nav: { zoom: 1, px: 0, py: 0 }, ref: null, show: { raw: true, rawLine: true, sm: true, ctrl: true, ref: true, ctrlOnly: false }, drag: null };
    bd.querySelector('#formCmpClose').onclick = closeCmp;
    bd.addEventListener('mousedown', e => { if (e.target === bd) closeCmp(); });
    bd.querySelector('#formCmpRef').onclick = () => {
      const st = cmpStation(); if (!st) return;
      cmp.ref = { sm: st.sm.map(p => ({ x: p.x, y: p.y })), name: st.name, label: cmpLabel() };
      drawCmp();
    };
    const c = cmp.cvs;
    c.addEventListener('mousedown', e => { cmp.drag = { x: e.clientX, y: e.clientY }; c.style.cursor = 'grabbing'; e.preventDefault(); });
    window.addEventListener('mousemove', e => { if (!cmp.drag) return; cmp.nav.px += e.clientX - cmp.drag.x; cmp.nav.py += e.clientY - cmp.drag.y; cmp.drag = { x: e.clientX, y: e.clientY }; drawCmp(); });
    window.addEventListener('mouseup', () => { if (cmp.drag) { cmp.drag = null; c.style.cursor = 'grab'; } });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const r = c.getBoundingClientRect(), mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15, nz = Math.max(0.2, Math.min(400, cmp.nav.zoom * f)), k = nz / cmp.nav.zoom;
      // Zoom am Cursor: Punkt unter der Maus bleibt stehen
      cmp.nav.px = mx - (mx - cmp.nav.px) * k; cmp.nav.py = my - (my - cmp.nav.py) * k; cmp.nav.zoom = nz;
      drawCmp();
    }, { passive: false });
    c.addEventListener('dblclick', () => { cmp.nav = { zoom: 1, px: 0, py: 0 }; drawCmp(); });
    window.addEventListener('keydown', e => {
      if (!cmp || !cmp.el.classList.contains('open')) return;
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === 'Escape') { closeCmp(); return; }
      if (e.key === 'n' || e.key === 'N') { cmpZoomTo('le'); }
      if (e.key === 'e' || e.key === 'E') { cmpZoomTo('te'); }
    });
    return cmp;
  }
  function cmpLabel() {
    const o = opts();
    return o.mode === 'none' ? T('ohne Glättung') : (o.ctrl + ' ' + T('Kontrollpunkte/Seite') + ', ' + T('Glättung') + ' ' + o.lambda);
  }
  function cmpStation() {
    if (!model || !model.W) build();
    if (!model || !model.W) return null;
    const st = model.W.stations, k = Math.min(Math.max(0, Math.round(C('formStation'))), st.length - 1);
    return st[k];
  }
  // Transformation Modell-mm -> Canvas (Sehne füllt die Breite), mit Zoom/Pan.
  function cmpXform(st, Wc, Hc) {
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const p of st.raw) { xMin = Math.min(xMin, p.x); xMax = Math.max(xMax, p.x); yMin = Math.min(yMin, p.y); yMax = Math.max(yMax, p.y); }
    const sc = Math.min((Wc - 50) / ((xMax - xMin) || 1), (Hc - 50) / ((yMax - yMin) || 1)) * cmp.nav.zoom;
    const cx = (xMin + xMax) / 2, cy = (yMin + yMax) / 2;
    return { P: p => ({ x: Wc / 2 + cmp.nav.px + (p.x - cx) * sc, y: Hc / 2 + cmp.nav.py - (p.y - cy) * sc }), sc, xMin, xMax, cx, cy };
  }
  function cmpZoomTo(where) {
    const st = cmpStation(); if (!st) return;
    const r = cmp.cvs.getBoundingClientRect(), Wc = r.width, Hc = r.height;
    cmp.nav = { zoom: 1, px: 0, py: 0 };
    const X = cmpXform(st, Wc, Hc);
    const chord = X.xMax - X.xMin, z = where === 'le' ? Math.max(4, chord / 12) : Math.max(4, chord / 12);
    const M = st.sm.length, tgt = where === 'le' ? st.sm[leIndex(M)] : { x: (st.sm[0].x + st.sm[M - 1].x) / 2, y: (st.sm[0].y + st.sm[M - 1].y) / 2 };
    cmp.nav.zoom = z;
    const q = cmpXform(st, Wc, Hc).P(tgt);   // Zielpunkt bei zoom z ohne Pan
    cmp.nav.px = Wc / 2 - q.x; cmp.nav.py = Hc / 2 - q.y;
    drawCmp();
  }
  function cmpCanvas(c) {
    const dpr = window.devicePixelRatio || 1, r = c.getBoundingClientRect();
    c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr));
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, Wc: r.width, Hc: r.height };
  }
  // Signierte Abweichung je Rohpunkt: Abstand zur Kurve, Vorzeichen über die
  // Außennormale der Kurve (positiv = Kurve außerhalb der Rohkontur).
  function signedDev(raw, curve) {
    const out = [];
    for (const p of raw) {
      let best = Infinity, sgn = 1;
      for (let i = 0; i < curve.length - 1; i++) {
        const a = curve[i], b = curve[i + 1], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-12;
        let s = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2; s = s < 0 ? 0 : s > 1 ? 1 : s;
        const ex = p.x - a.x - s * dx, ey = p.y - a.y - s * dy, d = Math.hypot(ex, ey);
        if (d < best) { best = d; sgn = (ex * dy - ey * dx) >= 0 ? 1 : -1; }   // Punkt rechts der Laufrichtung = außen
      }
      out.push(best * sgn);
    }
    return out;
  }
  function drawCmp() {
    if (!cmp || !cmp.el.classList.contains('open')) return;
    const st = cmpStation();
    const { g, Wc, Hc } = cmpCanvas(cmp.cvs);
    g.fillStyle = col('--panel2', '#0e1520'); g.fillRect(0, 0, Wc, Hc);
    const top = cmp.el.querySelector('#formCmpTop');
    if (!st) { top.textContent = T('Keine Tragfläche vorhanden.'); return; }
    const X = cmpXform(st, Wc, Hc), P = X.P, sh = cmp.show;
    // Sehnenlinie (dezent)
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1; g.setLineDash([3, 4]);
    const M = st.sm.length, le = st.sm[leIndex(M)], te = { x: (st.sm[0].x + st.sm[M - 1].x) / 2, y: (st.sm[0].y + st.sm[M - 1].y) / 2 };
    g.beginPath(); { const a = P(le), b = P(te); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); } g.stroke(); g.setLineDash([]);
    const line = (pts, color, w, dash) => { g.strokeStyle = color; g.lineWidth = w; g.setLineDash(dash || []); g.beginPath(); pts.forEach((p, i) => { const q = P(p); i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); }); g.stroke(); g.setLineDash([]); };
    if (sh.ref && cmp.ref) line(cmp.ref.sm, 'rgba(200,200,200,.75)', 2.2);
    if (sh.rawLine) line(st.raw, 'rgba(255,123,123,.55)', 1);
    if (sh.ctrl && st.ctrl) {
      line(st.ctrl, 'rgba(255,190,80,.5)', 1, [4, 3]);
      g.fillStyle = 'rgba(255,190,80,.9)'; for (const p of st.ctrl) { const q = P(p); g.fillRect(q.x - 2.5, q.y - 2.5, 5, 5); }
    }
    if (sh.sm) line(st.sm, '#4fc3f7', 2);
    if (sh.raw) { g.fillStyle = '#ff7b7b'; const rr = Math.min(3.5, 1.5 + cmp.nav.zoom * 0.15); for (const p of st.raw) { const q = P(p); g.beginPath(); g.arc(q.x, q.y, rr, 0, Math.PI * 2); g.fill(); } }
    // Maßstabsbalken
    const mmPer = 60 / X.sc, nice = Math.pow(10, Math.floor(Math.log10(mmPer))), bar = [1, 2, 5, 10].map(m => m * nice).find(v => v >= mmPer) || nice * 10;
    g.strokeStyle = '#ddd'; g.fillStyle = '#ddd'; g.lineWidth = 2; g.font = '11px system-ui';
    g.beginPath(); g.moveTo(14, Hc - 14); g.lineTo(14 + bar * X.sc, Hc - 14); g.stroke(); g.fillText(bar + ' mm', 16, Hc - 19);
    // Legende
    const leg = [];
    if (sh.raw || sh.rawLine) leg.push(['#ff7b7b', T('Rohpunkte')]);
    if (sh.sm) leg.push(['#4fc3f7', T('geglättet') + ' (' + cmpLabel() + ')']);
    if (sh.ctrl && st.ctrl) leg.push(['rgba(255,190,80,.9)', T('Kontrollpolygon') + ' (' + st.ctrl.length + ')']);
    if (sh.ref && cmp.ref) leg.push(['rgba(200,200,200,.9)', T('Referenz') + ' (' + cmp.ref.label + (cmp.ref.name !== st.name ? ', ' + cmp.ref.name : '') + ')']);
    let ly = 16; g.font = '12px system-ui';
    for (const l of leg) { g.fillStyle = l[0]; g.fillRect(12, ly - 8, 14, 4); g.fillStyle = '#ddd'; g.fillText(l[1], 32, ly); ly += 17; }
    top.innerHTML = '<b>' + st.name + '</b> · z = ' + st.z.toFixed(1) + ' mm · ' + st.raw.length + ' ' + T('Rohpunkte') + ' → ' + M + ' ' + T('Punkte')
      + ' · <b>' + T('max. Abweichung') + ' ' + st.dev.toFixed(3) + ' mm</b>' + (model.opt.aufmass ? ' · ' + T('Aufmaß') + ' ' + model.opt.aufmass + ' mm' : '')
      + (model.opt.teThk ? ' · ' + T('Endleiste') + ' ' + model.opt.teThk + ' mm' : '');
    drawCmpDev(st);
  }
  function drawCmpDev(st) {
    const { g, Wc, Hc } = cmpCanvas(cmp.cvsDev);
    g.fillStyle = col('--panel2', '#0e1520'); g.fillRect(0, 0, Wc, Hc);
    const raw = st.raw, dev = signedDev(raw, st.sm);
    const refDev = (cmp.ref && cmp.show.ref) ? signedDev(raw, cmp.ref.sm) : null;
    let mx = 0; for (const d of dev) mx = Math.max(mx, Math.abs(d)); if (refDev) for (const d of refDev) mx = Math.max(mx, Math.abs(d));
    mx = Math.max(mx, 0.01);
    const L = 44, R = 10, Tp = 10, B = 18, w = Wc - L - R, h = Hc - Tp - B, y0 = Tp + h / 2;
    const u = chordParam(raw), iLE = Math.ceil(raw.length / 2) - 1;
    const px = i => L + u[i] * w, py = d => y0 - d / mx * (h / 2);
    g.strokeStyle = 'rgba(255,255,255,.15)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(L, y0); g.lineTo(L + w, y0); g.stroke();
    g.setLineDash([3, 4]); g.beginPath(); g.moveTo(px(iLE), Tp); g.lineTo(px(iLE), Tp + h); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#aaa'; g.font = '10px system-ui';
    g.fillText('+' + mx.toFixed(2), 4, Tp + 9); g.fillText('0', 4, y0 + 3); g.fillText('-' + mx.toFixed(2), 4, Tp + h);
    g.fillText(T('EL oben'), L, Hc - 5); g.fillText(T('Nase'), px(iLE) - 12, Hc - 5); g.fillText(T('EL unten'), L + w - 44, Hc - 5);
    const plot = (D, color, wdt) => { g.strokeStyle = color; g.lineWidth = wdt; g.beginPath(); D.forEach((d, i) => { const x = px(i), y = py(d); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); };
    if (refDev) plot(refDev, 'rgba(200,200,200,.7)', 1.5);
    plot(dev, '#4fc3f7', 1.5);
    g.fillStyle = '#4fc3f7'; for (let i = 0; i < dev.length; i++) { g.fillRect(px(i) - 1, py(dev[i]) - 1, 2, 2); }
  }
  function buildCmpSide() {
    const side = cmp.el.querySelector('#formCmpSide'); side.innerHTML = '';
    const rr = () => { build(); drawCmp(); buildCmpSide(); };
    const rrLite = () => { build(); drawCmp(); };
    const st = model && model.W ? model.W.stations : [];
    const g1 = grp('Glättung', true, null, { alwaysOpen: true, key: 'formCmpSmooth' });
    selectRow(g1.body, 'Methode', [['bspline', 'Bezier / B-Spline (Ausgleich)'], ['none', 'keine (nur neu abtasten)']], () => C('formSmooth'), v => { S('formSmooth', v); rr(); });
    if (C('formSmooth') !== 'none') {
      numRow(g1.body, 'Kontrollpunkte je Seite', () => C('formCtrl'), v => { S('formCtrl', v); rrLite(); }, { int: true, min: 4, max: 60, norender: true });
      numRow(g1.body, 'Glättung (0 = keine Strafe)', () => C('formLambda'), v => { S('formLambda', v); rrLite(); }, { step: 0.5, min: 0, norender: true });
    }
    numRow(g1.body, 'Punkte je Rippe', () => C('formPts'), v => { S('formPts', v); rrLite(); }, { int: true, min: 40, max: 1200, norender: true });
    numRow(g1.body, 'Aufmaß (mm)', () => C('formAufmass'), v => { S('formAufmass', v); rrLite(); }, { step: 0.1, norender: true });
    numRow(g1.body, 'Endleistendicke (mm)', () => C('formTeThk'), v => { S('formTeThk', v); rrLite(); }, { step: 0.1, min: 0, norender: true });
    if (st.length) selectRow(g1.body, 'Station', st.map((x, i) => [String(i), x.name]), () => String(Math.min(C('formStation'), st.length - 1)), v => { S('formStation', +v); drawCmp(); });
    side.appendChild(g1.g);
    const g2 = grp('Anzeige', true, null, { alwaysOpen: true, key: 'formCmpShow' });
    const sh = cmp.show;
    const ck = (label, key) => { const row = document.createElement('div'); row.className = 'row'; const l = document.createElement('label'); l.textContent = T(label); const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!sh[key]; i.onchange = () => { sh[key] = i.checked; drawCmp(); }; row.appendChild(l); row.appendChild(i); g2.body.appendChild(row); };
    ck('Rohpunkte (rot)', 'raw'); ck('Rohkontur als Linie', 'rawLine'); ck('Geglättete Kurve (blau)', 'sm'); ck('Kontrollpolygon (orange)', 'ctrl'); ck('Referenz (grau)', 'ref');
    const rowB = document.createElement('div'); rowB.className = 'row full'; rowB.style.display = 'grid'; rowB.style.gridTemplateColumns = '1fr 1fr'; rowB.style.gap = '6px';
    const bN = document.createElement('button'); bN.textContent = T('Nase vergrößern'); bN.onclick = () => cmpZoomTo('le');
    const bE = document.createElement('button'); bE.textContent = T('Endleiste vergrößern'); bE.onclick = () => cmpZoomTo('te');
    rowB.appendChild(bN); rowB.appendChild(bE); g2.body.appendChild(rowB);
    const bR = document.createElement('button'); bR.textContent = T('Referenz löschen'); bR.onclick = () => { cmp.ref = null; drawCmp(); }; bR.disabled = !cmp.ref; g2.body.appendChild(bR);
    side.appendChild(g2.g);
    const g3 = grp('Abweichung je Station', true, null, { alwaysOpen: true, key: 'formCmpDev' });
    const tbl = document.createElement('table'); tbl.className = 'set-table';
    tbl.innerHTML = '<tr><th>' + T('Station') + '</th><th>z</th><th>' + T('max. Abw.') + '</th></tr>'
      + st.map((x, i) => '<tr data-i="' + i + '" style="cursor:pointer' + (i === Math.min(C('formStation'), st.length - 1) ? ';color:var(--accent)' : '') + '"><td>' + x.name + '</td><td>' + x.z.toFixed(0) + '</td><td>' + x.dev.toFixed(3) + ' mm</td></tr>').join('');
    tbl.querySelectorAll('tr[data-i]').forEach(tr => { tr.onclick = () => { S('formStation', +tr.dataset.i); drawCmp(); buildCmpSide(); }; });
    g3.body.appendChild(tbl);
    hint(g3.body, 'Klick auf eine Zeile wählt die Station. Die Abweichung ist der größte Abstand eines Rohpunkts zur geglätteten Kurve.');
    side.appendChild(g3.g);
  }
  function openCmp() {
    cmpDom(); build();
    cmp.el.classList.add('open');
    buildCmpSide(); drawCmp();
    requestAnimationFrame(drawCmp);   // nach dem Layout (Canvas-Maße)
  }
  function closeCmp() {
    if (!cmp) return;
    cmp.el.classList.remove('open');
    buildSidebar(); refresh();   // Parameter könnten geändert worden sein
  }
  window.addEventListener('resize', () => { if (cmp && cmp.el.classList.contains('open')) drawCmp(); });

  // ---------- Sidebar (Reiter „form") -----------------------------------
  // Winglet-Profil laden (Explorer-Dialog im Profil-Ladeordner) / entfernen.
  function wlLoad(key, done) {
    const handler = async f => {
      try {
        const prof = Airfoil.parseDat(await f.text());
        const closed = App.closeLoadedTE ? App.closeLoadedTE(prof) : prof;
        const P = Object.assign({}, C('formWlProf') || {});
        P[key] = { name: prof.name || f.name, pts: closed.map(q => ({ x: q.x, y: q.y })) };
        S('formWlProf', P); done();
      } catch (err) { alert(T('Import fehlgeschlagen: ') + err.message); }
    };
    let inp = document.getElementById('fileDatWl');
    if (!inp) { inp = document.createElement('input'); inp.type = 'file'; inp.id = 'fileDatWl'; inp.accept = '.dat,.bez,.txt,.cor'; inp.style.display = 'none'; document.body.appendChild(inp); }
    inp.onchange = () => { const f = inp.files && inp.files[0]; inp.value = ''; if (f) handler(f); };
    if (typeof App.loadFileVia === 'function') App.loadFileVia({ 'text/plain': ['.dat', '.bez', '.txt', '.cor'] }, handler, 'fileDatWl', 'ldDat');
    else inp.click();
  }
  // Winglet-Spitze: Form (Ellipse / Sichel / frei) + Länge; frei = eigene Exponenten, Bezugspunkt, Dicke.
  function wlTipRows(body, rr, rb) {
    selectRow(body, 'Spitzenform', [['ellipse', 'Ellipse (rund)'], ['sichel', 'Sichel (Endleiste läuft weiter, Nase zieht zurück)'], ['custom', 'frei parametrisch']], () => C('formWlTipMode') || 'ellipse', v => {
      S('formWlTipMode', v); const P = WL_TIP_PRESETS[v]; if (P) { S('formWlTipPLE', P.pLE); S('formWlTipPTE', P.pTE); S('formWlTipRef', P.ref); S('formWlTipThk', P.thk); } rb(); },
      'Abschluss der Winglet-Spitze wie beim Randbogen: Nasen- und Endleistenlinie laufen als Superellipsen zum Bezugspunkt zusammen. Ellipse: rund (Bezugspunkt Sehnenmitte). Sichel: Endleiste läuft fast gerade weiter, Nase pfeilt zur Spitze zurück. Frei: alle Werte einzeln.');
    numRow(body, 'Spitzenrundung (mm)', () => C('formWlTipLen'), v => { S('formWlTipLen', v); rr(); }, { step: 1, min: 0, norender: true,
      hint: '0 = ebener Abschluss, sonst Länge der Spitze entlang der Winglet-Mittellinie.' });
    if (C('formWlTipMode') === 'custom') {
      numRow(body, 'Bezugspunkt Spitze (% Sehne)', () => C('formWlTipRef'), v => { S('formWlTipRef', v); rr(); }, { step: 5, min: 0, max: 100, norender: true,
        hint: 'Punkt der letzten Rippe, in dem Nase und Endleiste zusammenlaufen: 0 = Nase, 50 = Sehnenmitte, 100 = Endleiste.' });
      numRow(body, 'Verlauf Nasenlinie Spitze', () => C('formWlTipPLE'), v => { S('formWlTipPLE', v); rr(); }, { step: 0.25, min: 0.5, norender: true,
        hint: 'Superellipsen-Exponent: 1 = gerade, 2 = Viertelellipse, 3–8 = lange gerade weiter, dann schnell einlaufend.' });
      numRow(body, 'Verlauf Endleiste Spitze', () => C('formWlTipPTE'), v => { S('formWlTipPTE', v); rr(); }, { step: 0.25, min: 0.5, norender: true });
      numRow(body, 'Dicke am Ende (%)', () => C('formWlTipThk'), v => { S('formWlTipThk', v); rr(); }, { step: 5, min: 5, max: 150, norender: true });
    }
  }
  function wlProfRow(body, label, key, done) {
    const P = C('formWlProf') || {}, cur = P[key];
    const row = document.createElement('div'); row.className = 'row';
    const l = document.createElement('label'); l.textContent = T(label);
    const box = document.createElement('div'); box.style.cssText = 'display:flex;gap:4px;align-items:center;min-width:0';
    const nm = document.createElement('span'); nm.style.cssText = 'flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;opacity:' + (cur ? '1' : '.6');
    nm.textContent = cur ? cur.name : T('(Profil der Endrippe)'); nm.title = nm.textContent;
    const bl = document.createElement('button'); bl.textContent = T('laden…'); bl.onclick = () => wlLoad(key, done);
    box.appendChild(nm); box.appendChild(bl);
    if (cur) { const bx = document.createElement('button'); bx.textContent = '×'; bx.title = T('entfernen'); bx.onclick = () => { const Q = Object.assign({}, P); delete Q[key]; S('formWlProf', Q); done(); }; box.appendChild(bx); }
    row.appendChild(l); row.appendChild(box); body.appendChild(row);
  }
  function formSidebar(side) {
    fitInfo = null;
    const rr = () => refresh();
    const rb = () => { buildSidebar(); refresh(); };
    const g = grp('Formenbau: Bauteil', true, 'form', { alwaysOpen: true });
    const e = grp('STL/STEP-Export', true, 'form', { key: 'STL-Export' });   // Achsen, Nullpunkt, Lage, Export-Knöpfe (Key stabil halten)
    const v = grp('Ansicht', true, 'form');             // Vorschau-Optionen, Farben, Drahtgitter
    const exportRows = []; let exportHint = null; let nGrp = null, psGrp = null;
    hint(g.body, 'Leitet aus dem Tragflächendesign (Außenkontur, ohne Beplankungsabzug) ein Urmodell (Positiv) oder die beiden Negativform-Hälften als STL für 3D-Druck und CNC-Fräsen ab. Alle Rippen werden vorher als Bezier-/B-Spline-Kurve geglättet.');
    selectRow(g.body, 'Ziel', [['ur', 'Urmodell (Positiv)'], ['split', 'Urmodell geteilt (abformbar, oben + unten)'], ['neg', 'Negativform (oben + unten)']], () => C('formTarget'), v => { S('formTarget', v); rb(); });
    const part = partMode(), tipIsWl = C('formTipMode') === 'winglet' || C('formTipMode') === 'wldraw';
    selectRow(g.body, 'Bauteil', [['all', 'Tragfläche mit Randbogen / Winglet'], ['wing', 'nur Tragfläche (bis zur letzten Rippe)'], ['tip', 'nur Randbogen / Winglet (eigene Form)']], () => part, v => { S('formPart', v); rb(); },
      'Tragfläche mit Randbogen / Winglet: ein Teil wie bisher. Nur Tragfläche: bis zur letzten Rippe, dort eben (der Randbogen bzw. das Winglet wird separat gebaut). Nur Randbogen / Winglet: eigenes Formteil ab der letzten Rippe — als Urmodell, geteiltes Urmodell oder Negativform. Die Trennfläche liegt in der Sehnenfläche: in Verlängerung von Nase und Endleiste und durch die Mitte des Randbogens bzw. der Winglet-Spitze. Beim Winglet folgt sie der Biegung des Übergangs (Platte, Flansch und Rückseite werden mitgebogen, Passlöcher stehen senkrecht auf der Trennfläche); entformt wird schräg zwischen „nach oben“ und „nach außen“.');
    if (part === 'tip' && tipIsWl && C('formTarget') !== 'ur')
      hint(g.body, 'Winglet-Form: Ober- und Unterhälfte teilen sich an der Sehnenfläche des Winglets (innen / außen). Der Übergangsradius muss größer sein als Plattendicke bzw. Formdicke an der Innenseite der Biegung, sonst faltet sich das Netz (Hinweis in der Infozeile).');
    numRow(g.body, 'Aufmaß (mm)', () => C('formAufmass'), v => { S('formAufmass', v); rr(); }, { step: 0.1, norender: true,
      hint: 'Parallelversatz der Außenkontur, positiv = größer (z. B. Lack-/Gelcoat-Aufbau beim Urmodell), negativ = kleiner.' });
    numRow(g.body, 'Endleistendicke (mm)', () => C('formTeThk'), v => { S('formTeThk', v); rr(); }, { step: 0.1, min: 0, norender: true,
      hint: 'Globale Endleistendicke für Tragfläche, Randbogen und Winglet (0 = Profil unverändert). Die Endleiste jeder Rippe wird symmetrisch zur Sehne auf dieses Maß gebracht; die Änderung wächst quadratisch von der Nase zur Endleiste, das vordere Profil bleibt gleich. Wichtig für die spätere Bearbeitung (Fräsen, Schleifen, Beplankung): keine Null-Kante. Wird nach dem Aufmaß angewandt; an sehr dünnen Ringen (Randbogen-/Wingletende) höchstens halbe Profildicke.' });
    if ((C('formTarget') === 'ur' || C('formTarget') === 'split') && part !== 'tip')
      boolRow(g.body, 'Beide Hälften (an der Wurzel gespiegelt)', () => C('formMirror'), v => { S('formMirror', v); rb(); },
        'Ein: ganze Tragfläche (linke + rechte Hälfte als ein Körper). Aus: nur die entworfene Hälfte, Wurzel eben verschlossen.');
    selectRow(e.body, 'Achsen im STL', [['z', 'Z hoch (Druck / Fräse)'], ['y', 'Y hoch (wie im Programm)']], () => C('formUp'), v => { S('formUp', v); },
      'Z hoch: Spannweite liegt in −Y, Dicke in Z (Flansch/Kavität zeigt nach oben). Y hoch: unverändert wie im Programm (X Sehne, Y Dicke, Z Spannweite).');
    selectRow(e.body, 'Nullpunkt', [['min', 'Ecke (alle Koordinaten ≥ 0)'], ['keep', 'unverändert']], () => C('formOrigin'), v => { S('formOrigin', v); });
    const row = document.createElement('div'); row.className = 'row full'; row.style.display = 'grid'; row.style.gap = '6px';
    if (C('formTarget') === 'neg' || C('formTarget') === 'split') {
      const sp = C('formTarget') === 'split';
      row.style.gridTemplateColumns = '1fr 1fr';
      const b1 = document.createElement('button'); b1.className = 'primary'; b1.textContent = T(sp ? 'Urmodell oben als STL…' : 'Form oben als STL…'); b1.onclick = exportTop; demoBtn(b1);
      const b2 = document.createElement('button'); b2.className = 'primary'; b2.textContent = T(sp ? 'Urmodell unten als STL…' : 'Form unten als STL…'); b2.onclick = exportBot; demoBtn(b2);
      row.appendChild(b1); row.appendChild(b2);
    } else {
      const b = document.createElement('button'); b.className = 'primary'; b.textContent = T('Urmodell als STL…'); b.onclick = exportUr; demoBtn(b); row.appendChild(b);
    }
    exportRows.push(row);
    // STEP-Export (Variante C): echter, glatter B-Spline-Volumenkörper (ADVANCED_BREP), im CAD editierbar.
    {
      const sr = document.createElement('div'); sr.className = 'row full'; sr.style.display = 'grid'; sr.style.gap = '6px';
      if (C('formTarget') === 'neg' || C('formTarget') === 'split') {
        const sp = C('formTarget') === 'split';
        sr.style.gridTemplateColumns = '1fr 1fr';
        const s1 = document.createElement('button'); s1.textContent = T(sp ? 'Urmodell oben als STEP…' : 'Form oben als STEP…'); s1.onclick = () => exportMoldStep('top'); demoBtn(s1);
        const s2 = document.createElement('button'); s2.textContent = T(sp ? 'Urmodell unten als STEP…' : 'Form unten als STEP…'); s2.onclick = () => exportMoldStep('bot'); demoBtn(s2);
        sr.appendChild(s1); sr.appendChild(s2);
      } else {
        const wl = tipIsWl;
        const lbl = part === 'tip' ? (wl ? 'Nur Winglet als STEP…' : 'Nur Randbogen als STEP…')
          : part === 'wing' ? 'Nur Tragfläche als STEP…' : 'Urmodell als STEP…';
        const bs = document.createElement('button'); bs.textContent = T(lbl); bs.onclick = exportUrStep; demoBtn(bs); sr.appendChild(bs);
      }
      exportRows.push(sr);
      const hr = document.createElement('div'); hr.className = 'row full';
      hint(hr, (C('formTarget') === 'neg' || C('formTarget') === 'split')
        ? 'STEP: die Formhälften als echte, glatte B-Spline-Volumenkörper (ADVANCED_BREP) zum Weiterbearbeiten in CAD (Fusion, SolidWorks, FreeCAD …), inkl. Passbohrungen als echte Zylinderbohrungen (außer bei gebogenen Winglet-Formen). Höhere „Punkte je Rippe" = glatter, aber größere Datei.'
        : 'Als echter B-Spline-Volumenkörper (ADVANCED_BREP) zum Weiterbearbeiten in CAD (Fusion, SolidWorks, FreeCAD …), glatt in Spannweite. Höhere „Punkte je Rippe" = glatter, aber größere Datei.');
      exportRows.push(hr);
    }
    // Winglets gibt es nur beim Ziel Urmodell (sonst eben); der runde Randbogen bei allen Zielen.
    const tipWl = tipIsWl;
    let pinGrp = null;
    if (C('formTipMode') !== 'flat' && (C('formTarget') === 'ur' || !tipWl || part === 'tip')) {
      const wl = tipWl;
      const row2 = document.createElement('div'); row2.className = 'row full'; row2.style.display = 'grid'; row2.style.gap = '6px'; row2.style.gridTemplateColumns = '1fr 1fr';
      const c1 = document.createElement('button'); c1.textContent = T('Nur Tragfläche als STL…'); c1.onclick = exportWingOnly; demoBtn(c1);
      const c2 = document.createElement('button'); c2.textContent = T(wl ? 'Nur Winglet als STL…' : 'Nur Randbogen als STL…'); c2.onclick = exportTipOnly; demoBtn(c2);
      row2.appendChild(c1); row2.appendChild(c2); exportRows.push(row2);
      exportHint = C('formTarget') === 'ur'
        ? 'Getrennter Export: Tragfläche bis zur letzten Rippe (dort eben verschlossen) und Randbogen bzw. Winglet als eigener, geschlossener Körper. Beide Teile passen an der Trennebene exakt aneinander (z. B. getrennt drucken und kleben).'
        : 'Getrennter Export als Positiv (Urmodell): Tragfläche bis zur letzten Rippe (dort eben verschlossen) und Randbogen als eigener, geschlossener Körper, z. B. um den Randbogen separat zu drucken und an den geschäumten Flügel zu kleben.';
      pinGrp = (() => {
        const gp = grp('Steckungsbohrungen (Bauteil)', true, 'form');
        boolRow(gp.body, 'Steckungsbohrungen', () => C('formPin'), v => { S('formPin', v); rb(); },
          'Bohrungen im Bauteil selbst: Sacklöcher senkrecht zur Trennebene, in der Stirnfläche der Tragfläche und in der Wurzel des Randbogens bzw. Winglets deckungsgleich, um das Abschlussteil mit Steckstiften oder Zapfen aufzustecken. Wirkt auf die Bauteile aus „Nur Tragfläche als STL“ / „Nur Randbogen bzw. Winglet als STL“ (bei allen Zielen); die 3D-Vorschau zeigt die Teile dann auseinandergezogen. Nicht zu verwechseln mit den Passbohrungen der Form (Flansch / Trennplatte, weiter unten).');
        if (C('formPin')) {
          numRow(gp.body, 'Anzahl', () => pinCount(), v => { S('formPinN', v); rb(); }, { int: true, min: 1, max: 20, norender: true });
          selectRow(gp.body, 'Querschnitt', [['circle', 'Kreis'], ['rect', 'Rechteck (a × b)']], () => C('formPinShape') === 'rect' ? 'rect' : 'circle', v => { S('formPinShape', v); rb(); });
          if (C('formPinShape') === 'rect') {
            numRow(gp.body, 'a: Breite in Sehnenrichtung (mm)', () => C('formPinA'), v => { S('formPinA', v); rr(); }, { step: 0.5, min: 0.5, norender: true });
            numRow(gp.body, 'b: Höhe in Dickenrichtung (mm)', () => C('formPinB'), v => { S('formPinB', v); rr(); }, { step: 0.5, min: 0.5, norender: true });
          } else numRow(gp.body, 'Durchmesser (mm)', () => C('formPinD'), v => { S('formPinD', v); rr(); }, { step: 0.5, min: 0.5, norender: true });
          numRow(gp.body, 'Tiefe in der Tragfläche (mm)', () => C('formPinDepth'), v => { S('formPinDepth', v); rr(); }, { step: 1, min: 0.5, norender: true,
            hint: 'Bohrtiefe entlang der Bohrachse ab der Trennebene, getrennt für die beiden Teile (Stiftlänge = Summe beider Tiefen). Die Trennebene (Endrippe) steht in der Vorderansicht senkrecht auf der Nasenleiste des letzten Segments (V-Form); Randbogen bzw. Winglet setzen daran an, und die Bohrachse steht senkrecht auf dieser Ebene, also parallel zur Nasenleiste. Achtung bei kurzen Randbögen / engem Übergangsradius: das Loch darf nicht seitlich aus dem Teil austreten.' });
          numRow(gp.body, 'Tiefe im Randbogen / Winglet (mm)', () => C('formPinDepthTip') != null ? C('formPinDepthTip') : C('formPinDepth'), v => { S('formPinDepthTip', v); rr(); }, { step: 1, min: 0.5, norender: true });
          hint(gp.body, 'Lochmitten bezogen auf die Profilnase der letzten Rippe: x entlang der Sehne nach hinten (Endleiste), y nach oben (Oberseite), jeweils in mm. Löcher, die nicht mit 0,5 mm Rand in der Profilkontur liegen, werden ausgelassen (Hinweis in der Infozeile).');
          const pts = pinPts();
          for (let k = 0; k < pts.length; k++) {
            const setP = (j, v) => { const a = pinPts(); a[k][j] = +v || 0; S('formPinPts', a); rr(); };
            numRow(gp.body, T('Loch') + ' ' + (k + 1) + ': ' + T('x ab Nase (mm)'), () => pinPts()[k][0], v => setP(0, v), { step: 1, norender: true });
            numRow(gp.body, T('Loch') + ' ' + (k + 1) + ': ' + T('y ab Nase (mm)'), () => pinPts()[k][1], v => setP(1, v), { step: 0.5, norender: true });
          }
          numRow(v.body, 'Vorschau: Teile auseinander (mm)', () => C('formPinGap'), v => { S('formPinGap', v); build(); draw(); }, { step: 5, min: 0, norender: true });
        }
        return gp;
      })();
    }
    side.appendChild(g.g);

    const s = grp('Profil-Glättung', true, 'form');
    selectRow(s.body, 'Methode', [['bspline', 'Bezier / B-Spline (Ausgleich)'], ['none', 'keine (nur neu abtasten)']], () => C('formSmooth'), v => { S('formSmooth', v); rb(); },
      'Bezier/B-Spline: kubische Ausgleichskurve durch die Profilpunkte (Least Squares mit Krümmungsstrafe) — glättet Treppen und Ausreißer aus .dat-Dateien. Die Endleistenpunkte bleiben exakt. Die Abweichung zur Rohkontur wird in der Ansicht angezeigt.');
    if (C('formSmooth') !== 'none') {
      numRow(s.body, 'Kontrollpunkte je Seite', () => C('formCtrl'), v => { S('formCtrl', v); rr(); }, { int: true, min: 4, max: 60, norender: true,
        hint: 'Weniger Kontrollpunkte = glatter, aber größere Abweichung; mehr = folgt den Punkten genauer. 12–25 sind für die meisten Profile passend.' });
      numRow(s.body, 'Glättung (0 = keine Strafe)', () => C('formLambda'), v => { S('formLambda', v); rr(); }, { step: 0.5, min: 0, norender: true,
        hint: 'Gewicht der Krümmungsstrafe. Höhere Werte bügeln Welligkeit stärker weg, erhöhen aber die Abweichung an der Nase.' });
    }
    numRow(s.body, 'Punkte je Rippe', () => C('formPts'), v => { S('formPts', v); rr(); }, { int: true, min: 40, max: 1200, norender: true,
      hint: 'Auflösung der Kontur im STL (Kosinus-verteilt, dicht an Nase und Endleiste).' });
    numRow(s.body, 'Ringabstand Spannweite (mm)', () => C('formRingMm'), v => { S('formRingMm', v); rr(); }, { step: 1, min: 0.5, norender: true,
      hint: 'Abstand der Zwischenrippen im Loft. Die Fläche zwischen den Rippen ist eine Regelfläche (wie beim Heißdraht); kleiner = feineres Netz.' });
    selectRow(s.body, 'Loft Spannweite', [['linear', 'Regelfläche (linear, wie Heißdraht)'], ['spline', 'Spline (glatt über die Rippen)']], () => C('formLoft') === 'spline' ? 'spline' : 'linear', v => { S('formLoft', v); rb(); },
      'Regelfläche: gerade Verbindung zwischen den Rippen, exakt wie der Heißdraht den Kern schneidet. Spline: kubischer Spline durch alle Rippen einer Fläche – keine Knicke an den Stationen bei Schränkung, V-Form und Tiefenverlauf (für Laminatformen). Zwischenringe werden dann nach Krümmung gesetzt.');
    if (C('formLoft') === 'spline') numRow(s.body, 'Max. Knick je Ring (°)', () => C('formLoftAng'), v => { S('formLoftAng', v); rr(); }, { step: 0.5, min: 0.1, norender: true,
      hint: 'Neuer Zwischenring, sobald sich die Fläche um mehr als diesen Winkel gedreht hat (spätestens beim Ringabstand). Kleiner = glatter, größere STL.' });
    const bc = document.createElement('button'); bc.className = 'primary'; bc.textContent = T('Vergleichsfenster öffnen…'); bc.onclick = openCmp;
    s.body.appendChild(bc);
    hint(s.body, 'Eigenes Fenster: Rohpunkte, geglättete Kurve, Kontrollpolygon und eine eingefrorene Referenz überlagert, mit Zoom auf Nase/Endleiste, Abweichungskurve und Tabelle aller Stationen. Parameter dort live änderbar.');

    const t = grp('Randbogen / Wingtip', true, 'form');
    const tipOpts = [['round', 'Randbogen (parametrisch)'], ['flat', 'flach (ebener Deckel)']];
    const wlOk = C('formTarget') === 'ur' || partMode() === 'tip';   // Winglet: Urmodell oder eigenes Formteil
    if (wlOk) { tipOpts.push(['winglet', 'Winglet (mit Übergangsbogen)']); tipOpts.push(['wldraw', 'Winglet aus Zeichnung (Dreitafel)']); }
    else if (C('formTipMode') === 'winglet' || C('formTipMode') === 'wldraw') hint(t.body, 'Winglets gibt es bei Formhälften der ganzen Tragfläche nicht (hinterschnitten) — hier wird der flache Abschluss verwendet. Winglet-Formen: Bauteil „nur Randbogen / Winglet“ wählen (Ziel Urmodell geteilt oder Negativform).');
    selectRow(t.body, 'Form', tipOpts, () => wlOk ? C('formTipMode') : ((C('formTipMode') === 'winglet' || C('formTipMode') === 'wldraw') ? 'flat' : C('formTipMode')), v => { S('formTipMode', v); if (v !== 'wldraw' && C('formView') === 'wl') S('formView', '3d'); rb(); },
      'Verschließt das Außenende der Tragfläche. Randbogen: Nasen- und Endleistenlinie laufen als Superellipsen zum Bezugspunkt (Vorlagen nach echten Segelflugzeugen); flach: ebener Abschluss an der letzten Rippe; Winglet: Fläche biegt tangential in ein senkrecht/schräg stehendes Winglet mit eigenen Profilen.');
    const lastChord = () => { const st = stationsAbs(); if (!st.length) return 100; const e = ribExtent(st[st.length - 1].pts); return e.c || 100; };
    if (C('formTipMode') === 'round') {
      selectRow(t.body, 'Vorlage', [['custom', '— eigene Werte —'], ['ellipse', 'Ellipse (klassisch, LS4 / ASW 19)'], ['sichel', 'Sichel (Discus / ASW 27 / Ventus)'], ['raked', 'gerade gepfeilt, Spitze an der Endleiste'], ['hoch', 'hochgezogen, dünner auslaufend (DG / LS)']],
        () => C('formTipPreset') || 'custom', v => {
          S('formTipPreset', v); const P = TIP_PRESETS[v];
          if (P) { S('formTipPLE', P.pLE); S('formTipPTE', P.pTE); S('formTipRef', P.ref); S('formTipThk', P.thk); S('formTipRise', Math.round(P.rise * lastChord())); S('formTipLen', Math.round(P.len * lastChord())); S('formTipTwist', P.twist || 0); }
          rb();
        }, 'Setzt alle Randbogen-Werte auf eine Vorlage (Länge und Hochziehen relativ zur Endtiefe). Danach frei änderbar.');
      const custom = () => S('formTipPreset', 'custom');
      numRow(t.body, 'Länge (mm)', () => C('formTipLen'), v => { S('formTipLen', v); custom(); rr(); }, { step: 1, min: 0, norender: true,
        hint: 'Länge des Randbogens über die letzte Rippe hinaus (Spannweitenrichtung). Sichelrandbögen: ca. 0,6–1,0 × Endtiefe; Ellipse: 0,3–0,4 × Endtiefe.' });
      numRow(t.body, 'Bezugspunkt (% Sehne)', () => C('formTipRef'), v => { S('formTipRef', v); custom(); rr(); }, { step: 5, min: 0, max: 100, norender: true,
        hint: 'Punkt der Randrippe, in dem Nasen- und Endleistenlinie zusammenlaufen: 0 = Nase, 50 = Sehnenmitte, 100 = Endleiste (Endleiste läuft gerade weiter, Nase pfeilt zurück).' });
      numRow(t.body, 'Verlauf Nasenlinie', () => C('formTipPLE'), v => { S('formTipPLE', v); custom(); rr(); }, { step: 0.25, min: 0.5, norender: true,
        hint: 'Superellipsen-Exponent: 1 = gerade Linie zum Bezugspunkt, 2 = Viertelellipse, 3–8 = läuft lange gerade weiter und rundet erst kurz vor dem Ende ein. Ab 1 knickfreier Anschluss an die Fläche.' });
      numRow(t.body, 'Verlauf Endleiste', () => C('formTipPTE'), v => { S('formTipPTE', v); custom(); rr(); }, { step: 0.25, min: 0.5, norender: true,
        hint: 'Wie Nasenlinie, für die Endleiste. Sichel: hoher Wert (Endleiste bleibt fast gerade).' });
      numRow(t.body, 'Dicke am Ende (%)', () => C('formTipThk'), v => { S('formTipThk', v); custom(); rr(); }, { step: 5, min: 5, max: 150, norender: true,
        hint: 'Relative Profildicke am Ende des Randbogens in % der Endrippe (100 = Profil wird nur mit der Tiefe skaliert). Hochgezogene Randbögen laufen meist dünner aus.' });
      numRow(t.body, 'Hochziehen (mm)', () => C('formTipRise'), v => { S('formTipRise', v); custom(); rr(); }, { step: 1, norender: true,
        hint: 'Hebt das Ende des Randbogens zusätzlich an (positiv = nach oben) — tangentialer Beginn. Die V-Form des letzten Segments läuft immer weiter.' });
      numRow(t.body, 'Schränkung am Ende (°)', () => C('formTipTwist'), v => { S('formTipTwist', v); custom(); rr(); }, { step: 0.5, min: -15, max: 15, norender: true,
        hint: 'Schränkt nur den Randbogen: die Ringe drehen nach außen hin um ihre Nase (0° an der Endrippe, voller Winkel an der Spitze), die Endleiste steigt dabei stetig bis auf die Höhe der um die Nase gedrehten Endrippe an, und die Spitze liegt in der Verlängerung dieser Endleiste (die Nasenlinie zieht zu ihr hoch). Positiv = Endleiste nach oben (Washout), negativ = nach unten. Die Tragfläche bis zur Endrippe bleibt unverändert.' });
    }
    if (C('formTipMode') === 'winglet' && wlOk) {
      hint(t.body, 'Vorbild moderne Segelflugzeuge (Maughmer-Winglets, Discus-2 / ASW 28 / LS8): Neigung 15–25° nach außen, Toe-out 2–3°, Nasenpfeilung ~30°, Wurzeltiefe 50–60 % und Spitzentiefe ~25 % der Flügel-Endtiefe, Twist −2°, eigenes Winglet-Profil (z. B. PSU 94-097). Alle Übergänge (Tiefe, Profil, Pfeilung, Anstellung) verlaufen im Übergangsbogen stetig.');
      numRow(t.body, 'Waagrechter Teil: Länge (mm)', () => C('formWlFlatLen'), v => { S('formWlFlatLen', v); rb(); }, { step: 5, min: 0, norender: true,
        hint: 'Verlängert die Fläche vor dem Übergangsbogen waagrecht (in Richtung des letzten Segments, V-Form und Tiefenverlauf laufen weiter). 0 = der Bogen beginnt direkt an der letzten Rippe.' });
      if (+C('formWlFlatLen') > 0) boolRow(t.body, 'Waagrechter Teil: Nase in Verlängerung der Tragfläche', () => C('formWlFlatWing') !== false, v => { S('formWlFlatWing', v); rb(); },
        'Ein: die Nasenlinie läuft im waagrechten Teil in der Pfeilung des letzten Segments weiter (glatt, ohne Zwischenübergang). Aus: eigene Rückpfeilung.');
      if (+C('formWlFlatLen') > 0 && C('formWlFlatWing') === false) numRow(t.body, 'Waagrechter Teil: Rückpfeilung (°)', () => C('formWlFlatSweep'), v => { S('formWlFlatSweep', v); rr(); }, { step: 1, min: -30, max: 70, norender: true,
        hint: 'Pfeilung der Nasenlinie im waagrechten Teil (positiv = nach hinten). Geht stetig aus der Pfeilung des letzten Segments hervor; am Bogen dann in die Winglet-Pfeilung über. Die Endleiste bleibt auf der verlängerten Endleistenlinie der Tragfläche — der Wingletfuß wird dadurch schmäler.' });
      numRow(t.body, 'Länge Winglet (mm)', () => C('formWlLen'), v => { S('formWlLen', v); rr(); }, { step: 5, min: 5, norender: true,
        hint: 'Länge des Winglets entlang seiner Mittellinie ab dem Ende des waagrechten Teils (bzw. ab der letzten Flügelrippe), inklusive Übergangsbogen und Spitzenrundung.' });
      numRow(t.body, 'Übergangsradius (mm)', () => C('formWlR'), v => { S('formWlR', v); rr(); }, { step: 5, min: 0, norender: true,
        hint: 'Radius des Kreisbogens, mit dem die Fläche tangential ins Winglet biegt (Achse parallel zur Sehne). Wird automatisch auf mindestens das 1,5-fache der Profilhöhe und höchstens 80 % der Länge begrenzt.' });
      numRow(t.body, 'Rücksprung Nase: Beginn ab Flügelende (mm)', () => C('formWlStepAt'), v => { S('formWlStepAt', v); rr(); }, { step: 5, min: 0, norender: true,
        hint: 'Strecke ab der letzten Flügelrippe (entlang waagrechtem Teil und Bogen), ab der die Nase zurückspringt. 0 = direkt am Flügelende.' });
      numRow(t.body, 'Rücksprung Nase: Länge (mm)', () => C('formWlStep'), v => { S('formWlStep', v); rr(); }, { step: 1, min: 0, norender: true,
        hint: 'Länge ab dem Flügelende, auf der die Tiefe von der Endtiefe auf die Wurzeltiefe zurückspringt (Nase wandert nach hinten, Endleiste bleibt) — zuerst auf dem waagrechten Teil, dann im Bogen. 0 = über waagrechten Teil und Bogen verteilt; je kürzer, desto enger der Radius am Fuß (40–60 mm = Ventus-artig) wie bei Maughmer-Winglets (Ventus-2c/3, ASW 27, Discus-2).' });
      numRow(t.body, 'Neigung nach außen (°)', () => C('formWlCant'), v => { S('formWlCant', v); rr(); }, { step: 1, min: -30, max: 85, norender: true,
        hint: 'Neigung des Winglets aus der Senkrechten (0 = senkrecht, 20 = typisch, 90 wäre in der Flügelebene).' });
      numRow(t.body, 'Wurzeltiefe (% Endtiefe)', () => C('formWlCRoot'), v => { S('formWlCRoot', v); rr(); }, { step: 5, min: 5, max: 150, norender: true,
        hint: 'Tiefe am Ende des Übergangsbogens in % der Flügel-Endtiefe. Die Tiefe geht im Bogen stetig von der Endrippe auf diesen Wert zurück; die Endleiste bleibt dabei im Verlauf der Tragfläche, die Nase wandert nach hinten.' });
      numRow(t.body, 'Spitzentiefe (% Endtiefe)', () => C('formWlCTip'), v => { S('formWlCTip', v); rr(); }, { step: 5, min: 2, max: 150, norender: true });
      boolRow(t.body, 'Endleiste waagrecht in Verlängerung der Tragfläche', () => C('formWlTeWing') !== false, v => { S('formWlTeWing', v); rb(); },
        'Die Endleiste ist im waagrechten Teil und im senkrechten Teil je eine Gerade; im Übergangsbogen geht die Pfeilung stetig über (kein Knick). Ein: der waagrechte Teil setzt die Endleistenlinie der Tragfläche fort. Aus: eigene Pfeilung im waagrechten Teil. Die Nasenlinie ergibt sich aus Endleiste minus Tiefe und ist immer stetig, ohne Knicke.');
      if (C('formWlTeWing') === false) numRow(t.body, 'Pfeilung Endleiste waagrecht (°)', () => C('formWlTeSweepH'), v => { S('formWlTeSweepH', v); rr(); }, { step: 1, min: -30, max: 60, norender: true,
        hint: 'Pfeilung der Endleiste im waagrechten Teil (positiv = nach hinten).' });
      numRow(t.body, 'Pfeilung Endleiste senkrecht (°)', () => C('formWlTeSweep'), v => { S('formWlTeSweep', v); rr(); }, { step: 1, min: -30, max: 60, norender: true,
        hint: 'Pfeilung der Endleiste im senkrechten Teil gegen die Winglet-Mittellinie (positiv = nach hinten). Wird im Bogen stetig aus der waagrechten Pfeilung entwickelt.' });
      numRow(t.body, 'Toe-out an der Wurzel (°)', () => C('formWlToe'), v => { S('formWlToe', v); rr(); }, { step: 0.5, norender: true,
        hint: 'Anstellung des Winglet-Profils: positiv = Nase nach außen (Toe-out, Endleiste zur Rumpfseite), typisch 2–3°.' });
      numRow(t.body, 'Twist zur Spitze (°)', () => C('formWlTwist'), v => { S('formWlTwist', v); rr(); }, { step: 0.5, norender: true,
        hint: 'Zusätzliche Verdrehung an der Spitze gegenüber der Wurzel (negativ = Auswaschung), linear.' });
      wlTipRows(t.body, rr, rb);
      subhead(t.body, 'Winglet-Profile (.dat)');
      hint(t.body, 'Ohne eigenes Profil wird das Profil der Flügel-Endrippe weiterverwendet. Wurzel = am Ende des Übergangsbogens, Spitze = oben; optional ein drittes Profil dazwischen. Zwischen den Stützstellen wird linear gestrakt; im Übergangsbogen geht das Flügelprofil stetig ins Wurzelprofil über.');
      wlProfRow(t.body, 'Wurzel', 'root', rb); wlProfRow(t.body, 'Mitte (optional)', 'mid', rb); wlProfRow(t.body, 'Spitze', 'tip', rb);
      if ((C('formWlProf') || {}).mid) numRow(t.body, 'Lage Mitte (% Winglet-Länge)', () => C('formWlMidPos'), v => { S('formWlMidPos', v); rr(); }, { step: 5, min: 5, max: 95, norender: true });
    }
    if (C('formTipMode') === 'wldraw' && wlOk) {
      hint(t.body, 'Nasenlinie und Endleiste des Winglets werden als Raumkurven gezeichnet — über ihre Projektionen in Aufriss (Biegung, Neigung), Draufsicht (Grundriss, Pfeilung, Toe) und Seitenansicht (Umriss des stehenden Winglets). Ein Griff verschiebt nur die beiden Koordinaten der jeweiligen Ansicht, die Ansichten bleiben so immer widerspruchsfrei. Punkt 0 sitzt fest am Flügelende, die Kurve schließt tangential an Nasen- bzw. Endleistenlinie des letzten Segments an. Neigung und Pfeilung ergeben sich aus der Zeichnung; die Schränkung (Toe-out, Twist) wird je Profil als Winkel angegeben und bleibt beim Bearbeiten der Kurven erhalten — die Endleistenkurve bestimmt nur die Tiefe, die tatsächliche Endleiste ist gestrichelt eingezeichnet. Ausgewählter Punkt zeigt seine Tangentengriffe (wie in Fusion): Ende ziehen = Richtung/Länge der Tangente, Rechtsklick = zurück auf automatisch.');
      const inWl = C('formView') === 'wl';
      const row = document.createElement('div'); row.className = 'row full'; row.style.display = 'grid'; row.style.gridTemplateColumns = '1fr 1fr'; row.style.gap = '6px';
      const bz = document.createElement('button'); bz.className = inWl ? '' : 'primary'; bz.textContent = T(inWl ? '3D-Ansicht' : 'Zeichnung öffnen'); bz.onclick = toggleWlView;
      const bp = document.createElement('button'); bp.textContent = T('Aus Einstellungen übernehmen'); bp.title = T('Setzt die Kontrollpunkte auf das parametrische Winglet (Werte der Winglet-Einstellungen). Danach frei änderbar.');
      bp.onclick = () => { if (!model || !model.W) build(); if (!model || !model.W) return; const st = model.W.stations; if (st.length < 2) return; wlDrawSet(wlDrawFromParam(st[st.length - 1], st[st.length - 2], model.opt)); rb(); };
      row.appendChild(bz); row.appendChild(bp); t.body.appendChild(row);
      selectRow(t.body, 'Kurvenart', [['spline', 'Spline (glatt durch die Punkte)'], ['pline', 'Polylinie (gerade Strecken)']], () => C('formWlDrawMode'), v => { S('formWlDrawMode', v); rb(); },
        'Spline: kubische Kurve durch alle Kontrollpunkte, Tangenten automatisch oder je Punkt per Griff (Klick auf Punkt, dann Griffende ziehen); Starttangente = Richtung der Flügel-Nasen-/Endleistenlinie (nur Länge frei). Polylinie: gerade Strecken; Punkt 1 liegt auf dem Tangentenstrahl (nur der Abstand ist frei), damit der Anschluss tangential bleibt.');
      numRow(t.body, 'Wurzelprofil erreicht bei (% Länge)', () => C('formWlDrawRootAt'), v => { S('formWlDrawRootAt', v); rr(); }, { step: 5, min: 2, max: 95, norender: true,
        hint: 'Bis zu diesem Anteil der Winglet-Länge geht das Flügelprofil stetig (Smoothstep) in das Wurzelprofil über; danach wird zur Spitze gestrakt.' });
      wlTipRows(t.body, rr, rb);
      subhead(t.body, 'Winglet-Profile (.dat)');
      hint(t.body, 'Ohne eigenes Profil wird das Profil der Flügel-Endrippe weiterverwendet. Wurzel = nach dem Übergang, Spitze = oben; optional ein drittes Profil dazwischen.');
      wlProfRow(t.body, 'Wurzel', 'root', rb);
      numRow(t.body, 'Schränkung Wurzel (°)', () => C('formWlDrawTwRoot'), v => { S('formWlDrawTwRoot', v); rr(); }, { step: 0.5, norender: true,
        hint: 'Anstellwinkel des Wurzelprofils gegen die Sehne der Flügel-Endrippe: positiv = Nase nach außen (Toe-out), typisch 2–3°. Vom Flügelende (0°) wird stetig auf diesen Wert übergeblendet. Die Winkel bleiben beim Bearbeiten der Kurven unverändert — die Endleistenkurve gibt nur noch die Tiefe vor.' });
      wlProfRow(t.body, 'Mitte (optional)', 'mid', rb);
      if ((C('formWlProf') || {}).mid) {
        numRow(t.body, 'Schränkung Mitte (°)', () => C('formWlDrawTwMid'), v => { S('formWlDrawTwMid', v); rr(); }, { step: 0.5, norender: true });
        numRow(t.body, 'Lage Mitte (% Winglet-Länge)', () => C('formWlMidPos'), v => { S('formWlMidPos', v); rr(); }, { step: 5, min: 5, max: 95, norender: true });
      }
      wlProfRow(t.body, 'Spitze', 'tip', rb);
      numRow(t.body, 'Schränkung Spitze (°)', () => C('formWlDrawTwTip'), v => { S('formWlDrawTwTip', v); rr(); }, { step: 0.5, norender: true,
        hint: 'Anstellwinkel an der Spitze; zwischen den Profilen linear (Twist = Spitze − Wurzel, negativ = Auswaschung).' });
      // Punkttabelle (absolute mm), Punkt 0 nur zur Anzeige
      const g0 = (() => { if (!model || !model.W || model.W.stations.length < 2) return null; const st = model.W.stations; return wlRails(st[st.length - 1], st[st.length - 2], model.opt); })();
      if (g0) {
        for (const [key, label] of [['le', 'Punkte Nasenlinie (mm)'], ['te', 'Punkte Endleiste (mm)']]) {
          subhead(t.body, label);
          const tb = document.createElement('div'); tb.className = 'row full'; tb.style.display = 'grid'; tb.style.gridTemplateColumns = '22px 1fr 1fr 1fr'; tb.style.gap = '3px'; tb.style.fontSize = '11px';
          const hd = ['#', 'X', 'Y', 'Z'].map(s => { const d = document.createElement('div'); d.textContent = s; d.style.opacity = '.6'; d.style.textAlign = 'center'; return d; }); hd.forEach(d => tb.appendChild(d));
          g0[key].ctrl.forEach((p, i) => {
            const lab = document.createElement('div'); lab.textContent = String(i); lab.style.textAlign = 'center'; lab.style.alignSelf = 'center'; tb.appendChild(lab);
            for (let k = 0; k < 3; k++) {
              const inp = document.createElement('input'); inp.type = 'number'; inp.step = 1; inp.value = Math.round(p[k] * 10) / 10; inp.style.minWidth = '0'; inp.style.padding = '2px 3px';
              if (i === 0) inp.disabled = true;
              else inp.onchange = () => { const D = wlDrawGet(); if (!D) return; const P0 = g0.A[key], abs = V3.add(P0, D[key][i - 1]); abs[k] = +inp.value || 0; let off = V3.sub(abs, P0);
                if (i === 1 && C('formWlDrawMode') === 'pline') { const d = key === 'le' ? g0.dLE : g0.dTE; off = V3.mul(d, Math.max(1, V3.dot(off, d))); }
                D[key][i - 1] = off; wlDrawSet(D); rb(); };
              tb.appendChild(inp);
            }
          });
          t.body.appendChild(tb);
        }
        const br = document.createElement('button'); br.textContent = T('Zeichnung zurücksetzen'); br.onclick = () => { wlDrawSet(null); rb(); }; t.body.appendChild(br);
      }
    }

    buildCutPanel();   // Schnittansicht: Bedienfeld liegt im Ansichtsfenster (links unten)
    buildCurvPanel();  // Krümmungsanalyse: Bedienfeld rechts unten
    buildMeasPanel();  // Messwerkzeug: Bedienfeld rechts oben

    // Formenrand + Passlöcher: gemeinsam für geteiltes Urmodell und Negativform
    const edgeRows = body => {
      selectRow(body, 'Formenrand', [['box', 'rechteckig (Kasten um die ganze Fläche)'], ['offset', 'folgt Nase und Endleiste (fester Abstand)']], () => C('formEdge') === 'offset' ? 'offset' : 'box', v => { S('formEdge', v); rr(); },
        'Rechteckig: gerade Außenkanten mit dem Überstand zur vordersten Nase bzw. hintersten Endleiste. Folgt Nase/Endleiste: der Rand läuft überall im eingestellten Abstand (senkrecht gemessen) parallel zum Grundriss — entlang der Nasen- und Endleistenlinie und mit demselben Abstand um den Randbogen bzw. die Winglet-Spitze herum (kein gerader Abschluss; der Überstand hinter dem Randbogen ergibt sich aus den Abständen vorn/hinten). Bei Pfeilung und Zuspitzung wird die Form damit deutlich kleiner. Vor der Wurzel läuft der Rand in Verlängerung des ersten Segments.');
    };
    const teEdgeRow = body => {
      selectRow(body, 'Endleiste an der Trennfläche', [['out', 'steht heraus (Stirnfläche, Kante bleibt)'], ['blend', 'läuft in die Trennfläche aus (Keil)'], ['flush', 'bündig je Hälfte (wie bisher)']], () => C('formTeEdge') || 'out', v => { S('formTeEdge', v); rr(); },
          'Negativform und geteiltes Urmodell: die Trennfläche liegt hinten auf der Sehnenmitte der Endleiste, bei beiden Hälften gleich, damit sie aufeinander passen. „Steht heraus": jede Hälfte enthält die halbe Endleistendicke als senkrechte Stirnfläche über der Trennfläche — der Abguss bekommt die volle Endleistendicke, Formkante bleibt stumpf. „Läuft aus": die Profilfläche wird mit ihrer Endtangente bis zur Trennfläche verlängert (dünner Keil hinter der Endleiste, nach dem Abformen abzuschleifen). „Bündig je Hälfte": wie bisher — jede Hälfte liegt hinten auf ihrem eigenen Endleistenpunkt, die Endleiste läuft ohne Stufe in die Trennfläche; die Trennflächen der beiden Hälften sind hinten um die Endleistendicke versetzt, was beim Laminieren durch überstehendes, auftragendes Material unkritisch ist.');
    };
    const blutRows = body => {
      subhead(body, 'Blutrinne (Endleiste)');
      boolRow(body, 'Blutrinne', () => C('formBlut'), v => { S('formBlut', v); rb(); },
        'Rinne im Formenrand hinter der Endleiste, die beim Schließen der Form das austretende Harz aufnimmt. In der Negativform ist sie eine Nut in der Trennfläche; am geteilten Urmodell steht sie als Wulst auf der Trennplatte, damit sie sich beim Laminieren als Nut abformt. Sie läuft nur entlang der Endleiste und endet an Wurzel und Randbogen. Abstand + Breite + 1 mm müssen in den Überstand hinten passen.');
      if (!C('formBlut')) return;
      selectRow(body, 'Querschnitt', [['round', 'Halbkreis'], ['u', 'U (flacher Grund, verrundete Flanken)']], () => C('formBlutShape') === 'u' ? 'u' : 'round', v => { S('formBlutShape', v); rr(); });
      numRow(body, 'Abstand zur Endleiste (mm)', () => C('formBlutDist'), v => { S('formBlutDist', v); rr(); }, { step: 0.5, min: 0, norender: true,
        hint: 'Nach hinten gemessen (in Sehnenrichtung): Beginn der Rinne hinter der Endleiste. Die Rinne läuft nur entlang der Endleiste — an der Wurzel und hinter dem Randbogen endet sie mit einer Stirnwand und setzt sich nicht in den Überstand fort.' });
      numRow(body, 'Breite (mm)', () => C('formBlutW'), v => { S('formBlutW', v); rr(); }, { step: 0.5, min: 0.5, norender: true });
      numRow(body, 'Tiefe / Höhe (mm)', () => C('formBlutD'), v => { S('formBlutD', v); rr(); }, { step: 0.5, min: 0.5, norender: true,
        hint: 'Negativform: Nuttiefe in der Trennfläche. Geteiltes Urmodell: Höhe der Wulst über der Trennplatte. Beim Halbkreis ergibt der halbe Breitenwert den vollen Halbkreis.' });
      numRow(body, 'Verlauf am Randbogen (%)', () => C('formBlutTip') == null ? 20 : C('formBlutTip'), v => { S('formBlutTip', v); rr(); }, { step: 5, min: 0, max: 100, norender: true,
        hint: 'Wie weit die Rinne in den Randbogen hineinläuft: 0 % = sie endet an der letzten Rippe (die Endleiste läuft dort in die Spitze), 100 % = sie folgt der Endleiste um den ganzen Randbogen. Über den Randbogen hinaus (auf die ebene Trennfläche dahinter) läuft sie nie.' });
      numRow(body, 'davon Keil-Auslauf (%)', () => C('formBlutWedge') == null ? 100 : C('formBlutWedge'), v => { S('formBlutWedge', v); rr(); }, { step: 5, min: 0, max: 100, norender: true,
        hint: '0 = die Rinne endet stumpf (senkrechte Stirnwand). Größer: über die letzten x % ihres Randbogenverlaufs läuft sie linear auf null aus. Wird auf den Wert von „Verlauf am Randbogen" begrenzt.' });
    };
    const halfRow = body => {
      selectRow(body, 'Vorschau: sichtbar', [['both', 'beide Hälften'], ['top', 'nur obere Form'], ['bot', 'nur untere Form']], () => C('formHalf') || 'both', v => { S('formHalf', v); draw(); },
        'Nur die 3D-Vorschau; exportiert werden immer beide Hälften. Bei einer einzelnen Hälfte wird das Positiv ausgeblendet, damit die Kavität sichtbar ist. Umschalten auch über die Knöpfe rechts in der 3D-Ansicht.');
    };
    const holeRows = body => {
      subhead(body, 'Passbohrungen (Form)');
      boolRow(body, 'Passbohrungen', () => C('formHoles'), v => { S('formHoles', v); rb(); },
        'Durchgehende Bohrungen im Flansch (senkrecht zur Trennebene), gleichmäßig über die Spannweite verteilt — an Ober- und Unterhälfte deckungsgleich, damit Passstifte beide Hälften ausrichten. Löcher, die nicht in den Flansch passen, werden ausgelassen (Hinweis in der Infozeile).');
      if (!C('formHoles')) return;
      numRow(body, 'Durchmesser (mm)', () => C('formHoleD'), v => { S('formHoleD', v); rr(); }, { step: 0.5, min: 1, norender: true });
      numRow(body, 'Anzahl je Seite', () => C('formHoleN'), v => { S('formHoleN', v); rr(); }, { int: true, min: 1, max: 50, norender: true,
        hint: 'Löcher je Seite (vorn bzw. hinten) über die Spannweite verteilt, vom Wurzel- bis zum Spitzenende der Form.' });
      numRow(body, 'Abstand vom Formenrand (mm)', () => C('formHoleX'), v => { S('formHoleX', v); rr(); }, { step: 1, min: 0, norender: true,
        hint: 'Lochmitte ab Außenkante der Form (in Sehnenrichtung). Muss samt Durchmesser zwischen Rand und Kontur bzw. Sicke passen.' });
      numRow(body, 'Randabstand Wurzel / Spitze (mm)', () => C('formHoleEnd'), v => { S('formHoleEnd', v); rr(); }, { step: 1, min: 0, norender: true,
        hint: 'Abstand der äußersten Löcher vom jeweiligen Ende der Form (Spannweitenrichtung).' });
      selectRow(body, 'Seiten', [['both', 'vorn und hinten'], ['front', 'nur vorn (Nase)'], ['rear', 'nur hinten (Endleiste)']], () => C('formHoleSides') || 'both', v => { S('formHoleSides', v); rr(); });
      if (C('formSegOn')) {
        boolRow(body, 'Anzahl je Druckstück', () => C('formHoleSeg'), v => { S('formHoleSeg', v); rb(); },
          'Ein: die Löcher werden je Druckstück (Segmentierung) verteilt — jedes Stück bekommt seine eigene Anzahl je Seite, gleichmäßig innerhalb des Stücks mit dem Randabstand zu beiden Trennstellen. Aus: eine Verteilung über die ganze Spannweite (Löcher können auf einer Trennstelle liegen).');
        const pl = model ? segPlanes() : [], Ls = model ? segLengths(pl) : [];
        if (C('formHoleSeg') && Ls.length) {
          const per = () => Object.assign({}, (C('formHolePer') && typeof C('formHolePer') === 'object') ? C('formHolePer') : {});
          Ls.forEach((L, i) => {
            const row = document.createElement('div'); row.className = 'row'; row.style.cssText = 'display:flex;align-items:center;gap:6px';
            const lab = document.createElement('label'); lab.style.flex = '1'; lab.textContent = T('Stück') + ' ' + (i + 1) + ' (' + L.toFixed(0) + ' mm)';
            const num = document.createElement('input'); num.type = 'number'; num.min = 0; num.max = 50; num.step = 1; num.style.width = '3.6em'; num.title = T('Anzahl je Seite (leer = Vorgabe, 0 = keine)');
            num.placeholder = String(C('formHoleN')); const q = per()[i]; if (q != null && +q >= 0) num.value = q;
            num.addEventListener('change', () => { const o = per(), n = num.value === '' ? NaN : +num.value; if (n >= 0) o[i] = Math.min(50, Math.round(n)); else { delete o[i]; num.value = ''; } S('formHolePer', Object.keys(o).length ? o : null); rr(); });
            row.appendChild(lab); row.appendChild(num); body.appendChild(row);
          });
        }
      }
    };
    /* Steckungs-Ausnehmungen (Negativform: Tasche, geteiltes Urmodell: Volumenkörper).
     * Zwei Listen: 'formStk' = Tragflächensteckung in der Wurzelverlängerung,
     * 'formStkT' = Steckung am Anschluss Tragfläche <-> Randbogen / Winglet. Die zweite Liste wirkt
     * auf beide Bauteile: im Bauteil „nur Randbogen / Winglet“ an dessen Wurzel, im Bauteil
     * „nur Tragfläche“ am äußeren Ende — die Lage ist auf die Nase der letzten Tragflächenrippe
     * bezogen und damit in beiden Formen deckungsgleich. */
    const stkRows = (body, P) => {
      const tipStk = P === 'formStkT', pmS = partMode();
      if (tipStk) {
        subhead(body, pmS === 'tip' ? 'Steckung zur Tragfläche (Anschluss)' : 'Steckung zum Randbogen / Winglet (Anschluss)');
        boolRow(body, 'Ausnehmungen für die Steckung', () => C('formStkT'), v => { S('formStkT', v); rb(); },
          'Ausnehmungen parallel zur Spannweite am Anschluss Tragfläche ↔ Randbogen / Winglet — für Steckstifte, Rohr oder Flachprofil, mit denen das Abschlussteil an die Tragfläche gesteckt wird. Dieselbe Liste wirkt auf beide Bauteile: beim Bauteil „nur Randbogen / Winglet“ im Überstand an dessen Wurzel, beim Bauteil „nur Tragfläche“ im Überstand hinter der letzten Rippe. Die Lage ist auf die Profilnase der letzten Tragflächenrippe bezogen — beide Formen bekommen damit deckungsgleiche Ausnehmungen.');
        if (!C('formStkT')) return;
        if (pmS === 'tip' && !(+C('formOvRoot') > 0)) hint(body, 'Nur wirksam, wenn der Überstand am Anschluss zur Tragfläche größer als 0 ist.');
        if (pmS === 'wing' && C('formEdge') !== 'offset' && !(+C('formOvTip') > 0)) hint(body, 'Nur wirksam, wenn der Überstand hinter der letzten Rippe größer als 0 ist.');
      } else {
        subhead(body, 'Tragflächensteckung (Wurzelverlängerung)');
        boolRow(body, 'Ausnehmungen für die Steckung', () => C('formStk'), v => { S('formStk', v); rb(); },
          'Ausnehmungen parallel zur Spannweite in der Wurzelverlängerung (Überstand Wurzel), damit die Steckung (Rohr, Stahl, Flachprofil) der Tragfläche über die Wurzelrippe hinaus in der Form Platz hat. Querschnitt Kreis oder Rechteck, Lage im Koordinatensystem des Wurzelprofils (x/y ab Nasenleiste), Länge in der Trennebene ab der Wurzelrippe nach innen. Der Querschnitt wird an der Trennlinie geteilt: jede Hälfte bekommt ihren Anteil. In der Negativform ist es eine Tasche, am geteilten Urmodell derselbe Umriss als auf die Trennebene gesetzter Volumenkörper (davon formt sich die Tasche ab). Voraussetzung: Überstand Wurzel > 0 und kein gespiegeltes Modell.');
        if (!C('formStk')) return;
        if (!(+C('formOvRoot') > 0)) hint(body, 'Nur wirksam, wenn der Überstand an der Wurzel größer als 0 ist.');
      }
      hint(body, tipStk
        ? 'Ausnehmung anklicken zum Aufklappen — jede hat ihre eigenen Werte (Querschnitt, Maße, Lage, Länge). Lage bezogen auf die Profilnase der letzten Tragflächenrippe (= Trennebene zum Randbogen / Winglet): x entlang der Sehne nach hinten (Endleiste), y nach oben (Oberseite), jeweils in mm — Mitte des Querschnitts. y = 0 = auf der Trennlinie (jede Hälfte bekommt die Hälfte).'
        : 'Ausnehmung anklicken zum Aufklappen — jede hat ihre eigenen Werte (Querschnitt, Maße, Lage, Länge). Lage bezogen auf die Profilnase der Wurzelrippe: x entlang der Sehne nach hinten (Endleiste), y nach oben (Oberseite), jeweils in mm — Mitte des Querschnitts. y = 0 = auf der Trennlinie (jede Hälfte bekommt die Hälfte).');
      const list = stkPts(P);
      if (stkActive[P] != null && stkActive[P] >= list.length) stkActive[P] = null;
      list.forEach((it, k) => {
        const open = stkActive[P] === k;
        const card = document.createElement('div');
        card.style.cssText = 'border:1px solid var(--line);border-radius:7px;padding:0;margin:2px 0;background:var(--panel2);overflow:hidden';
        const hd = document.createElement('div');
        hd.style.cssText = 'display:flex;align-items:center;cursor:pointer;padding:7px 8px';
        if (open) hd.style.background = 'rgba(74,163,255,.14)';
        const caret = document.createElement('span'); caret.textContent = open ? '▾' : '▸';
        caret.style.cssText = 'color:var(--muted);margin-right:6px;font-size:10px';
        const lab = document.createElement('b'); lab.style.fontSize = '12px'; lab.textContent = T('Ausnehmung') + ' ' + (k + 1);
        if (open) lab.style.color = 'var(--accent)';
        const note = document.createElement('span'); note.style.cssText = 'margin-left:8px;font-size:11px;color:var(--muted)';
        note.textContent = (it.shape === 'rect' ? T('Rechteck') + ' ' + it.a + ' × ' + it.b : '⌀ ' + it.d) + ' · x ' + it.x + ' / y ' + it.y + ' · ' + it.len + ' mm';
        const spc = document.createElement('div'); spc.style.flex = '1';
        const del = mkMini('✕', () => { stkDel(k, P); rb(); }); del.style.color = 'var(--bad)';
        hd.appendChild(caret); hd.appendChild(lab); hd.appendChild(note); hd.appendChild(spc); hd.appendChild(del);
        hd.onclick = ev => { if (ev.target === del) return; stkActive[P] = open ? null : k; rb(); };
        card.appendChild(hd); body.appendChild(card);
        if (!open) return;
        const sb = document.createElement('div'); sb.style.cssText = 'padding:8px;display:grid;gap:8px';
        card.appendChild(sb);
        // Wert der Ausnehmung setzen; die zuletzt benutzten Maße bleiben Vorgabe für die nächste.
        const set = (f, v, def) => { const a = stkPts(P); a[k][f] = f === 'shape' ? v : (+v || 0); S(P + 'Pts', a); if (def) S(P + def, a[k][f]); };
        const cur = () => stkPts(P)[k];
        selectRow(sb, 'Querschnitt', [['circle', 'Kreis'], ['rect', 'Rechteck (a × b)']], () => cur().shape, v => { set('shape', v, 'Shape'); rb(); });
        if (it.shape === 'rect') {
          numRow(sb, 'a: Breite in Sehnenrichtung (mm)', () => cur().a, v => { set('a', v, 'A'); rr(); }, { step: 0.5, min: 0.5, norender: true });
          numRow(sb, 'b: Höhe in Dickenrichtung (mm)', () => cur().b, v => { set('b', v, 'B'); rr(); }, { step: 0.5, min: 0.5, norender: true });
        } else numRow(sb, 'Durchmesser (mm)', () => cur().d, v => { set('d', v, 'D'); rr(); }, { step: 0.5, min: 0.5, norender: true });
        numRow(sb, 'x ab Nase (mm)', () => cur().x, v => { set('x', v); rr(); }, { step: 1, norender: true });
        numRow(sb, 'y ab Nase (mm)', () => cur().y, v => { set('y', v); rr(); }, { step: 0.5, norender: true });
        numRow(sb, 'Länge in der Trennebene (mm)', () => cur().len, v => { set('len', v, 'Len'); rr(); }, { step: 5, min: 0.5, norender: true,
          hint: tipStk ? 'Länge dieser Ausnehmung ab der letzten Tragflächenrippe in den Überstand hinein (Spannweitenrichtung) — in beiden Bauteilen gleich, also Stiftlänge = 2 × dieser Wert. Größer als der Überstand: sie läuft bis zum Ende der Form; sonst endet sie mit einer senkrechten Stirnwand.'
            : 'Länge dieser Ausnehmung ab der Wurzelrippe nach innen (Spannweitenrichtung). Größer als der Überstand an der Wurzel: sie läuft durch bis zum Ende der Form; sonst endet sie mit einer senkrechten Stirnwand. Ausnehmungen mit unterschiedlicher Länge enden jede an ihrer eigenen Stufe.' });
      });
      const addB = document.createElement('button'); addB.className = 'primary'; addB.textContent = T('+ Ausnehmung hinzufügen');
      addB.onclick = () => { stkAdd(P); rb(); }; body.appendChild(addB);
    };
    // Tragflächensteckung nur bei Bauteilen mit Wurzelrippe, Anschluss-Steckung nur bei getrennten Bauteilen
    const stkSection = body => {
      const pmS = partMode();
      if (pmS !== 'tip') stkRows(body, 'formStk');
      if (pmS !== 'all') stkRows(body, 'formStkT');
    };
    const pm = partMode(), pmWl = pm === 'tip' && (C('formTipMode') === 'winglet' || C('formTipMode') === 'wldraw');
    const lblRoot = pm === 'tip' ? 'Überstand am Anschluss zur Tragfläche (mm)' : 'Überstand Wurzel (mm)';
    const lblTip = pmWl ? 'Überstand hinter der Winglet-Spitze (mm)' : pm === 'wing' ? 'Überstand hinter der letzten Rippe (mm)' : 'Überstand hinter Randbogen (mm)';
    const hintRoot = pm === 'tip' ? '0 = Form endet an der letzten Rippe der Tragfläche (Profil dort offen, Anschluss an die Tragfläche). Größer: Form läuft über den Anschluss hinaus.' : null;
    /* Trennfläche: eigener Block für Negativform UND geteiltes Urmodell (beim Urmodell nur die Vorschau-Fläche) —
     * Formenrand / Überstände, Verlauf vor Nase / hinter Endleiste, Endleiste an der Trennfläche, Verlauf über den Randbogen hinaus. */
    {
      const tg = C('formTarget'), tf = psGrp = grp('Trennfläche', true, 'form');
      hint(tf.body, 'Fläche, in der Ober- und Unterform aufeinanderliegen. Trennlinie vorn = Umrisspunkt jeder Rippe bei Blick senkrecht auf die Mittelfläche (Sehne und Mittellinie in Spannweitenrichtung): bei waagrechter Mittellinie der Nasenpunkt; am hochgezogenen Randbogen oder bei V-Form wandert er auf die Oberseite, sodass die Trennfläche genau durch den äußersten Punkt des Randbogens geht und die Form dort keinen Hinterschnitt bekommt. Hinten die Sehnenmitte der Endleiste. Davor und dahinter läuft die Trennfläche bis zum Formenrand. Die Einstellungen gelten für die Negativform und das geteilte Urmodell; beim Urmodell zeigt die Vorschau-Fläche, wo die spätere Form geteilt wird.');
      boolRow(tf.body, 'Trennfläche zeigen', () => C('formPsShow'), v => { S('formPsShow', v); draw(); },
        'Zeichnet die Trennfläche gelb und halbdurchsichtig über das Modell: Flansch vor der Nase und hinter der Endleiste, in den Überständen vor der Wurzel und hinter dem Randbogen die ganze Breite. Gestrichelt = Trennlinie an Nase und Endleiste. In der Schnittansicht als gelbe Linie mit Punkten an der Trennlinie. Auch in der Gruppe „Ansicht“ und unter dem Ansichtswürfel umschaltbar.');
      subhead(tf.body, 'Formenrand / Überstände');
      numRow(tf.body, 'Überstand vorn / Nase (mm)', () => C('formOvF'), v => { S('formOvF', v); rr(); }, { step: 5, min: 0, norender: true,
        hint: 'Breite der Trennfläche vor der Nase (= Flanschbreite vorn).' });
      numRow(tf.body, 'Überstand hinten / Endleiste (mm)', () => C('formOvR'), v => { S('formOvR', v); rr(); }, { step: 5, min: 0, norender: true,
        hint: 'Breite der Trennfläche hinter der Endleiste (= Flanschbreite hinten).' });
      if (tg !== 'split' || !C('formMirror') || pm === 'tip')
        numRow(tf.body, lblRoot, () => C('formOvRoot'), v => { S('formOvRoot', v); rr(); }, { step: 5, min: 0, norender: true,
          hint: hintRoot || (tg === 'split' ? '0 = Platte endet an der Wurzelrippe (Profil dort offen, z. B. für Anschluss an den Rumpf). Größer: Platte läuft über die Wurzel hinaus.' : '0 = die Form endet an der Wurzelrippe (Kavität dort offen). Größer: die Form läuft über die Wurzel hinaus, die Kavität endet mit einer Wand.') });
      if (C('formEdge') !== 'offset')
        numRow(tf.body, lblTip, () => C('formOvTip'), v => { S('formOvTip', v); rr(); }, { step: 5, min: 0, norender: true,
          hint: C('formMirror') && tg === 'split' && pm !== 'tip' ? 'Gilt für beide Außenenden.' : undefined });
      edgeRows(tf.body);
      subhead(tf.body, 'Verlauf vor der Nase / hinter der Endleiste');
      numRow(tf.body, 'Neigung vor der Nase (°)', () => C('formPsAngF') || 0, v => { S('formPsAngF', v); rr(); }, { step: 1, min: -60, max: 60, norender: true,
        hint: '0 = die Trennfläche läuft vom Nasenpunkt waagrecht nach vorn bis zum Formenrand. Positiv = sie steigt nach vorn an, negativ = sie fällt nach vorn ab (z. B. um der Nasentangente zu folgen). Gilt an jeder Station, auch in den Überständen.' });
      numRow(tf.body, 'Neigung hinter der Endleiste (°)', () => C('formPsAngR') || 0, v => { S('formPsAngR', v); rr(); }, { step: 1, min: -60, max: 60, norender: true,
        hint: '0 = waagrecht ab der Sehnenmitte der Endleiste nach hinten. Positiv = steigt nach hinten an, negativ = fällt ab. Blutrinne und Passbohrungen folgen der geneigten Fläche.' });
      teEdgeRow(tf.body);
      subhead(tf.body, 'Verlauf über den Randbogen hinaus');
      selectRow(tf.body, 'Anschluss an den Randbogen', [['flat', 'waagrecht (in Höhe der letzten Rippe)'], ['tangent', 'tangential (Nase und Endleiste laufen weiter)']], () => C('formPsTip') === 'tangent' ? 'tangent' : 'flat', v => { S('formPsTip', v); rb(); },
        'Waagrecht: hinter der Randbogenspitze bleibt die Trennfläche auf der Höhe der Sehnenlinie der letzten Rippe (eben in Spannweitenrichtung; bei V-Form oder hochgezogenem Randbogen entsteht dort ein Knick). Tangential: Nasen- und Endleistenlinie laufen mit ihrer Steigung (aus den letzten Ringen) über die Spitze hinaus weiter und gehen als Parabel knickfrei in die Waagrechte über — die Trennfläche folgt so V-Form und Hochziehen des Randbogens.');
      if (C('formPsTip') === 'tangent')
        numRow(tf.body, 'wieder waagrecht nach (mm)', () => C('formPsTanLen') == null ? 30 : C('formPsTanLen'), v => { S('formPsTanLen', v); rr(); }, { step: 5, min: 0, norender: true,
          hint: 'Abstand hinter der Randbogenspitze (bzw. der letzten Rippe), ab dem die Trennfläche wieder waagrecht läuft; bis dahin nimmt die Steigung linear ab (Parabel, ohne Knick). 0 = bleibt bis zum Formenrand tangential. Ist der Überstand hinter dem Randbogen kürzer, endet die Fläche vorher.' });
      selectRow(tf.body, 'Am Randbogen in Flugrichtung', [['flat', 'waagrecht je Rippe (Nasenhöhe)'], ['follow', 'folgt Nasen- und Endleistenlinie (keine Stufe)']], () => C('formPsChord') === 'follow' ? 'follow' : 'flat', v => { S('formPsChord', v); rr(); },
        'Verlauf der Trennfläche vor der Nase und hinter der Endleiste im Bereich des Randbogens. Waagrecht: an jedem Ring liegt der Flansch auf dessen Nasenhöhe (bzw. Endleistenhöhe) — bei einem hochgezogenen Randbogen entsteht im Schnitt quer zur Sehne eine Stufe, wo die zurückweichende Nasenlinie die Schnittebene passiert (Huckel in der Form). Folgt Nasen-/Endleistenlinie: der Flansch hat an jeder Stelle die Höhe, die die Nasen- bzw. Endleistenlinie dort hat — die Linie wird in Spannweitenrichtung ausgezogen, die Fläche ist in Flugrichtung gekrümmt und in Spannweitenrichtung gerade (kein Hinterschnitt). Vor der Nase der letzten Rippe und an den Tragflächenrippen ändert sich nichts.');
    }
    if (C('formTarget') === 'split') {
      const n = nGrp = grp('Geteiltes Urmodell (abformbar)', true, 'form');
      hint(n.body, 'Das Urmodell wird an der Trennlinie Nase–Endleiste in Ober- und Unterhälfte geteilt. Jede Hälfte sitzt auf einer Trennplatte mit Formenüberstand rundum — darauf wird die Negativform direkt abgeformt (laminiert). Verlauf und Überstände der Trennfläche werden im Block „Trennfläche“ eingestellt.');
      numRow(n.body, 'Plattendicke (mm)', () => C('formPlateT'), v => { S('formPlateT', v); rr(); }, { step: 1, min: 1, norender: true,
        hint: 'Dicke der Trennplatte unter der Trennlinie (Unterseite eben: tiefster Trennlinienpunkt + Dicke).' });
      holeRows(n.body);
      stkSection(n.body);
      subhead(n.body, 'Sicke');
      boolRow(n.body, 'Sicke', () => C('formSicke'), v => { S('formSicke', v); rb(); },
        'U-förmige Nut (Halbellipse aus Breite und Tiefe) in der Plattenoberseite im Abstand zur Kontur. Auf der abgenommenen Form entsteht daraus eine Wulst, die abgeschliffen wird — so bekommt die Form eine scharfe Trennkante. An der Wurzel keine Sicke.');
      if (C('formSicke')) {
        selectRow(n.body, 'Verlauf', [['le', 'Nasenleiste + Randbogen'], ['all', 'Nasenleiste + Randbogen + Endleiste']], () => C('formSickeRun'), v => { S('formSickeRun', v); rr(); },
          'Nasenleiste + Randbogen: vor der Nase entlang und um den Randbogen herum; die Sicke läuft hinter dem Randbogen kurz hinter der Endleistenlinie aus. Rundum: zusätzlich hinter der Endleiste zurück bis zur Wurzel.');
        numRow(n.body, 'Abstand zur Kontur (mm)', () => C('formSickeDist'), v => { S('formSickeDist', v); rr(); }, { step: 1, min: 0, norender: true });
        numRow(n.body, 'Breite (mm)', () => C('formSickeW'), v => { S('formSickeW', v); rr(); }, { step: 0.5, min: 0.5, norender: true });
        numRow(n.body, 'Tiefe (mm)', () => C('formSickeD'), v => { S('formSickeD', v); rr(); }, { step: 0.5, min: 0.5, norender: true,
          hint: 'Muss kleiner als die Plattendicke sein. Abstand + Breite + 1 mm müssen in den Überstand vorn/hinten passen.' });
        numRow(n.body, 'Verlauf am Randbogen (%)', () => C('formSickeTip') == null ? 100 : C('formSickeTip'), v => { S('formSickeTip', v); rr(); }, { step: 5, min: 0, max: 100, norender: true,
          hint: 'Wie weit die Sicke in den Randbogen hineinläuft: 0 % = sie endet an der letzten Rippe, 100 % = sie läuft um den ganzen Randbogen herum. Über den Randbogen hinaus (auf die ebene Trennplatte dahinter) läuft sie nie.' });
        numRow(n.body, 'davon Keil-Auslauf (%)', () => C('formSickeWedge'), v => { S('formSickeWedge', v); rr(); }, { step: 5, min: 0, max: 100, norender: true,
          hint: '0 = die Sicke endet stumpf (senkrechte Stirnwand). Größer: über die letzten x % des Randbogenverlaufs läuft ihre Tiefe linear auf null aus. Wird auf den Wert von „Verlauf am Randbogen" begrenzt.' });
      }
      blutRows(n.body);
      boolRow(e.body, 'Untere Hälfte für den Export umdrehen', () => C('formCavUp'), v => { S('formCavUp', v); },
        'Ein: die untere Hälfte wird um 180° gedreht exportiert, sodass bei beiden Hälften das Profil nach oben zeigt (druck-/fräsfertig). Aus: Lage wie in der Vorschau.');
      numRow(v.body, 'Vorschau: Hälften auseinander (mm)', () => C('formGap'), v => { S('formGap', v); draw(); }, { step: 5, min: 0, norender: true });
      halfRow(v.body);
    }
    if (C('formTarget') === 'neg') {
      const n = nGrp = grp('Negativform', true, 'form');
      hint(n.body, 'Formhälfte = Kasten minus Flügelhälfte. Trennlinie: vorderster Punkt jeder Rippe (Nase) und Endleiste; von dort läuft die Trennfläche bis zur Kastenwand — der Überstand vorn/hinten ist damit die Flanschbreite. Verlauf und Überstände der Trennfläche werden im Block „Trennfläche“ eingestellt. Beide Hälften haben denselben Grundriss und passen aufeinander.');
      selectRow(n.body, 'Formhöhe', [['custom', 'eigener Wert (Formdicke über Profil)'], ['neg', 'passend zu den Negativschalen (Negativdesign)']], () => C('formWallMode') === 'neg' ? 'neg' : 'custom', v => { S('formWallMode', v); rb(); },
        'Eigener Wert: Materialstärke über/unter dem Profil. Passend zu den Negativschalen: die Formhälften sind ab der Trennebene genau so hoch wie die Schalen aus dem Reiter „Negativdesign" (Formblockhöhe minus „Ober-/Unterseite auseinanderziehen", Lage nach „Tragfläche im Formblock heben/senken") — die Form lässt sich so bündig an die geschnittenen Schaum-Negativschalen kleben, z. B. die gedruckte Randbogenform an die Schalen der Fläche.');
      if (C('formWallMode') === 'neg') {
        const L = App.wingList ? App.wingList() : [], cur = state.activeWing || 0;
        const wv = C('formWallWing') || '';
        if (L.length > 1) {
          const wopts = [['', T('diese Tragfläche') + ' (' + ((L[cur] && L[cur].name) || '') + ')']].concat(L.map((w, i) => i === cur ? null : [w.name, w.name]).filter(Boolean));
          selectRow(n.body, 'Negativschalen von', wopts, () => (wopts.some(x => x[0] === wv) ? wv : ''), v => { S('formWallWing', v); S('formWallSeg', -1); rb(); },
            'Tragfläche, deren Negativschalen (Negativdesign) angeklebt werden. Andere Tragfläche: die Außenrippe des gewählten Segments stößt an die Wurzel dieser Form, die Wurzelrippe an ihr Außenende — die Blockkanten werden über die Sehnenmitte der Anschlussrippe übertragen.');
        }
        let nSeg = 1;
        { const k = wv ? L.findIndex(w => w && w.name === wv) : cur; const rec = L[k]; nSeg = k === cur ? (state.segments || []).length : ((rec && rec.segments) || []).length; nSeg = Math.max(1, nSeg || 1); }
        const sopts = [['-1', 'letztes Segment']].concat(Array.from({ length: nSeg }, (_, i) => [String(i), T('Segment') + ' ' + (i + 1)]));
        const sv = C('formWallSeg') == null ? -1 : +C('formWallSeg');
        selectRow(n.body, 'Segment', sopts, () => String(sv >= 0 && sv < nSeg ? sv : -1), v => { S('formWallSeg', +v); rb(); },
          'Segment der Tragfläche, dessen Negativblock (Höhe und Lage aus dem Negativdesign) maßgebend ist.');
        selectRow(n.body, 'Bezugsrippe', [['tip', 'Außenrippe des Segments'], ['root', 'Wurzelrippe des Segments']], () => C('formWallRib') === 'root' ? 'root' : 'tip', v => { S('formWallRib', v); rb(); },
          'Rippe, an der die Form an die Schalen anschließt. Von ihrer Sehnenmitte aus werden Ober- und Unterkante des Negativblocks auf die Form übertragen.');
        const fi = document.createElement('div'); fi.className = 'hint';
        fitInfo = () => {
          const f = model && model.fit;
          if (!f) { fi.style.color = ''; fi.textContent = T('Formhöhe: noch nicht berechnet.'); }
          else if (f.err) { fi.style.color = '#ff9a7b'; fi.textContent = f.err; }
          else {
            fi.style.color = f.warn ? '#ff9a7b' : '#8ad4ff';
            // Höhe ab Trennebene an der Nase; stimmt sie (auf 0,05 mm) mit den Schalenhöhen im Negativdesign überein, nur einmal nennen
            const eq = Math.abs(f.hTop - f.shTop) < 0.05 && Math.abs(f.hBot - f.shBot) < 0.05;
            fi.textContent = T('Ergebnis:') + ' ' + (f.name ? f.name + ', ' : '') + T('Segment') + ' ' + (f.seg + 1) + ' — ' + T('Höhe ab Trennebene (Nase): oben') + ' ' + f.hTop.toFixed(1) + ' / ' + T('unten') + ' ' + f.hBot.toFixed(1) + ' mm'
              + (eq ? ' = ' + T('Schalenhöhen im Negativdesign') : ' (' + T('Schalenhöhen im Negativdesign') + ' ' + f.shTop.toFixed(1) + ' / ' + f.shBot.toFixed(1) + ' mm)')
              + ' (' + T('Blockhöhe') + ' ' + f.H.toFixed(1) + ' mm − ' + T('auseinandergezogen') + ' ' + f.split.toFixed(1) + ' mm). ' + T('Formdicke über Profil oben') + ' ' + f.top.toFixed(1) + ' mm, ' + T('unten') + ' ' + f.bot.toFixed(1) + ' mm.' + (f.warn ? ' ' + f.warn : '');
          }
        };
        fitInfo();
        n.body.appendChild(fi);
      } else {
        fitInfo = null;
      numRow(n.body, 'Formdicke über Profil (mm)', () => C('formWall'), v => { S('formWall', v); rr(); }, { step: 5, min: 1, norender: true,
        hint: 'Materialstärke zwischen dem höchsten/tiefsten Profilpunkt und der Formrückseite.' });
      }
      holeRows(n.body);
      stkSection(n.body);
      blutRows(n.body);
      subhead(n.body, 'Nasen-Huckel (Formenrand)');
      boolRow(n.body, 'Huckel an der Nase', () => C('formHk'), v => { S('formHk', v); rb(); },
        'U-förmige Erhebung auf dem Formenrand (Trennfläche) vor der Nasenleiste, die direkt an der Nasenleiste ansetzt (ohne Absatz, als Verlängerung des Profils) und mit dem Rand um den Randbogen herumläuft — in beiden Formhälften gleich. Nach dem Füllern und Polieren wird sie plan weggeschliffen; dabei entsteht an der Nase eine scharfe Formkante, Ober- und Unterschale passen dadurch genau aufeinander. Breite + 1 mm müssen in den Überstand vorn passen.');
      if (C('formHk')) {
        numRow(n.body, 'Breite (mm)', () => C('formHkW'), v => { S('formHkW', v); rr(); }, { step: 0.5, min: 0.5, norender: true,
          hint: 'Nach vorn gemessen, ab der Nasenleiste (bei Formenrand „folgt Nase und Endleiste" senkrecht zum Grundriss, sonst in Sehnenrichtung).' });
        numRow(n.body, 'Höhe (mm)', () => C('formHkH'), v => { S('formHkH', v); rr(); }, { step: 0.5, min: 0.5, norender: true,
          hint: 'Höhe über der Trennfläche (aus der Form heraus).' });
        numRow(n.body, 'Verlauf am Randbogen (%)', () => C('formHkTip') == null ? 100 : C('formHkTip'), v => { S('formHkTip', v); rr(); }, { step: 5, min: 0, max: 100, norender: true,
          hint: 'Wie weit der Huckel in den Randbogen hineinläuft: 0 % = er endet an der letzten Rippe, 100 % = er läuft um den ganzen Randbogen herum. Über den Randbogen hinaus (auf die ebene Trennfläche hinter der Form) läuft er nie.' });
        numRow(n.body, 'davon Keil-Auslauf (%)', () => C('formHkWedge'), v => { S('formHkWedge', v); rr(); }, { step: 5, min: 0, max: 100, norender: true,
          hint: '0 = der Huckel endet stumpf (senkrechte Stirnfläche). Größer: über die letzten x % des Randbogenverlaufs läuft seine Höhe linear auf null aus — ein flacher Keil statt einer Stufe. Wird auf den Wert von „Verlauf am Randbogen" begrenzt.' });
      }
      boolRow(e.body, 'Kavität nach oben exportieren', () => C('formCavUp'), v => { S('formCavUp', v); },
        'Ein: die obere Formhälfte wird für den Export um 180° gedreht (kein Spiegelbild), sodass bei beiden Hälften die Trennfläche/Kavität oben liegt (druck- und fräsfertig). Aus: Lage wie in der Vorschau.');
      numRow(v.body, 'Vorschau: Hälften auseinander (mm)', () => C('formGap'), v => { S('formGap', v); draw(); }, { step: 5, min: 0, norender: true });
      halfRow(v.body);
    }

    // Segmentierung (Druckstücke): Teilung entlang der Spannweite beim Export
    const sg = grp('Segmentierung (Druckstücke)', C('formSegOn'), 'form');
    hint(sg.body, 'Teilt Urmodell bzw. Formhälften beim STL-Export entlang der Spannweite in Stücke, die auf den 3D-Drucker passen. Jedes Stück wird an den Trennstellen eben verschlossen (Passlöcher im Flansch bleiben erhalten) und als eigene Datei „…_teil01.stl“, „…_teil02.stl“ … in einen im Explorer gewählten Ordner geschrieben; Stück 1 liegt an der Wurzel. Die 3D-Vorschau zeigt die Trennebenen hellblau.');
    boolRow(sg.body, 'Segmentierung aktiv', () => C('formSegOn'), v => { S('formSegOn', v); rb(); });
    if (C('formSegOn')) {
      selectRow(sg.body, 'Aufteilung', [['len', 'feste Stücklänge (von der Wurzel)'], ['seg', 'Tragflächen-Segmente, je in n Stücke'], ['n', 'gesamt in n gleich lange Stücke'], ['max', 'gleich lang, höchstens max. Länge']],
        () => segOpts().mode, v => { S('formSegMode', v); rb(); },
        'Feste Stücklänge: ab dem Wurzelende immer die gleiche Länge, das letzte Stück ist der Rest. Tragflächen-Segmente: die Trennstellen liegen auf den Segmentgrenzen des Entwurfs (Randbogen und Überstände zählen zum ersten/letzten Segment), jedes Segment wird zusätzlich in n gleich lange Stücke geteilt. Gesamt in n Stücke: gleich lange Stücke über die ganze Länge. Max. Länge: so viele gleich lange Stücke, dass keines länger als der Wert ist.');
      const mode = segOpts().mode;
      if (mode === 'len') numRow(sg.body, 'Stücklänge (mm)', () => C('formSegLen'), v => { S('formSegLen', v); rb(); }, { step: 5, min: 5, norender: true, enter: true });
      else if (mode === 'seg') numRow(sg.body, 'Stücke je Segment', () => segOpts().per, v => { S('formSegPer', v); rb(); }, { int: true, min: 1, max: 50, norender: true, enter: true });
      else if (mode === 'n') numRow(sg.body, 'Anzahl Stücke', () => segOpts().n, v => { S('formSegN', v); rb(); }, { int: true, min: 1, max: 200, norender: true, enter: true });
      else numRow(sg.body, 'max. Stücklänge (mm)', () => C('formSegMax'), v => { S('formSegMax', v); rb(); }, { step: 5, min: 5, norender: true, enter: true });
      boolRow(sg.body, 'Passstifte an den Trennstellen', () => C('formSegPin'), v => { S('formSegPin', v); rb(); },
        'Sacklöcher senkrecht zur Schnittebene, in beiden angrenzenden Stücken deckungsgleich, um die Stücke mit Stiften (Stiftlänge = 2 × Tiefe) auszurichten und zu verkleben. Die Lage wird automatisch bestimmt: an den dicksten Stellen der Schnittfläche (z. B. Flansch und Rückwand der Form, dicker Profilbereich beim Urmodell), möglichst weit auseinander, mit der eingestellten Mindestwand zum Rand und zu Passlöchern. Passt kein Loch, wird die Trennstelle ohne Stift ausgegeben (Meldung beim Export).');
      if (C('formSegPin')) {
        numRow(sg.body, 'Anzahl je Trennstelle', () => C('formSegPinN'), v => { S('formSegPinN', v); }, { int: true, min: 1, max: 20, norender: true });
        numRow(sg.body, 'Durchmesser (mm)', () => C('formSegPinD'), v => { S('formSegPinD', v); }, { step: 0.5, min: 0.5, norender: true });
        numRow(sg.body, 'Tiefe je Stück (mm)', () => C('formSegPinDepth'), v => { S('formSegPinDepth', v); }, { step: 1, min: 0.5, norender: true });
        numRow(sg.body, 'Mindestwand zum Rand (mm)', () => C('formSegPinMargin'), v => { S('formSegPinMargin', v); }, { step: 0.5, min: 0, norender: true });
        // Je Trennstelle: Stifte an/aus und eigene Anzahl (leer = Vorgabe von oben)
        const plP = model ? segPlanes() : [];
        if (plP.length) {
          subhead(sg.body, 'Passstifte je Trennstelle');
          hint(sg.body, 'Trennstelle 1 liegt an der Wurzel (zwischen Stück 1 und 2). Haken aus = diese Trennstelle ohne Stifte; Anzahl leer bzw. 0 = Vorgabe „Anzahl je Trennstelle“. „Lage setzen…“ öffnet den 2D-Schnitt an der Trennstelle: Klick in eine Schnittfläche setzt dort einen Stift (je Körper – Urmodell, Form oben / unten – eigene Punkte, in den Grenzen der Schnittfläche mit Mindestwand), Rechtsklick entfernt ihn. Ohne gesetzte Punkte bleibt die Lage automatisch.');
          const per = () => Object.assign({}, (C('formSegPinPer') && typeof C('formSegPinPer') === 'object') ? C('formSegPinPer') : {});
          const setPer = (i, patch) => { const o = per(); o[i] = Object.assign({}, o[i] || {}, patch); if (o[i].on !== false && !(+o[i].n >= 1)) delete o[i]; S('formSegPinPer', Object.keys(o).length ? o : null); };
          plP.forEach((z, i) => {
            const q = per()[i] || {};
            const row = document.createElement('div'); row.className = 'row'; row.style.cssText = 'display:flex;align-items:center;gap:6px';
            const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = q.on !== false; cb.id = 'fbSegPin' + i;
            const lab = document.createElement('label'); lab.style.cssText = 'flex:1;cursor:pointer'; lab.htmlFor = cb.id;
            lab.textContent = T('Trennstelle') + ' ' + (i + 1) + ' (z = ' + z.toFixed(0) + ' mm)';
            const num = document.createElement('input'); num.type = 'number'; num.min = 1; num.max = 20; num.step = 1; num.style.width = '3.6em'; num.title = T('Anzahl (leer = Vorgabe)');
            num.placeholder = String(C('formSegPinN')); if (+q.n >= 1) num.value = q.n; num.disabled = !cb.checked;
            const man = segPinPts(i).length > 0;
            if (man) { num.disabled = true; num.value = ''; num.placeholder = String(segPinPts(i).length); num.title = T('manuelle Lage: Anzahl = gesetzte Punkte'); }
            cb.addEventListener('change', () => { setPer(i, { on: cb.checked }); num.disabled = !cb.checked || man; rr(); });
            num.addEventListener('change', () => { const n = +num.value; setPer(i, { n: n >= 1 ? Math.min(20, Math.round(n)) : null }); if (!(n >= 1)) num.value = ''; rr(); });
            row.appendChild(cb); row.appendChild(lab); row.appendChild(num); sg.body.appendChild(row);
            // Lage: automatisch (dickste Stellen) oder manuell im 2D-Schnitt gesetzt
            if (cb.checked) {
              const lr = document.createElement('div'); lr.className = 'row'; lr.style.cssText = 'display:flex;align-items:center;gap:6px;padding-left:22px';
              const st = document.createElement('span'); st.style.cssText = 'flex:1;opacity:.75;font-size:.92em';
              st.textContent = segPinEdit === i ? T('Lage: im 2D-Schnitt setzen …') : man ? T('Lage: manuell') + ' (' + segPinPts(i).length + ')' : T('Lage: automatisch');
              const b1 = document.createElement('button'); b1.type = 'button';
              if (segPinEdit === i) { b1.textContent = T('Fertig'); b1.className = 'primary'; b1.onclick = () => segPinEditStop(); }
              else { b1.textContent = T('Lage setzen…'); b1.onclick = () => segPinEditStart(i); }
              lr.appendChild(st); lr.appendChild(b1);
              if (man) { const b2 = document.createElement('button'); b2.type = 'button'; b2.textContent = T('automatisch'); b2.title = T('gesetzte Punkte verwerfen'); b2.onclick = () => { segPinSetPts(i, null); if (segPinEdit === i) draw(); rb(); }; lr.appendChild(b2); }
              sg.body.appendChild(lr);
              // Lokale Koordinaten je Stift: x ab Profilnase nach hinten (Sehne), y nach oben — je Körper
              const nose = segNoseAt(z), pts = segPinPts(i), per = {};
              const upd = (k, j, v) => { const a = segPinPts(i).map(p => p.slice()); a[k][j] = Math.round(((+v || 0) + (j ? nose.y : nose.x)) * 100) / 100; segPinSetPts(i, a); if (segPinEdit === i) draw(); rr(); };
              pts.forEach((p, k) => {
                const nb = per[p[2]] = (per[p[2]] || 0) + 1, name = T(SEG_BODY_NAMES[p[2]] || p[2]);
                const w = document.createElement('div'); w.style.paddingLeft = '22px';
                numRow(w, name + ' ' + T('Stift') + ' ' + nb + ': ' + T('x ab Nase (mm)'), () => Math.round((p[0] - nose.x) * 100) / 100, v => upd(k, 0, v), { step: 1, norender: true });
                numRow(w, name + ' ' + T('Stift') + ' ' + nb + ': ' + T('y ab Nase (mm)'), () => Math.round((p[1] - nose.y) * 100) / 100, v => upd(k, 1, v), { step: 0.5, norender: true });
                const del = document.createElement('button'); del.type = 'button'; del.textContent = '✕ ' + T('Stift') + ' ' + nb; del.style.marginBottom = '4px';
                del.onclick = () => { const a = segPinPts(i).slice(); a.splice(k, 1); segPinSetPts(i, a); if (segPinEdit === i) draw(); rb(); };
                w.appendChild(del); sg.body.appendChild(w);
              });
              // Stift per Zahl hinzufügen (je vorhandenem Körper), Startlage: 30 % Sehne hinter der Nase auf Nasenhöhe
              const bodies = Array.from(new Set(((model && model.src) || []).map(s => s.body).filter(Boolean)));
              if (bodies.length) {
                const ar = document.createElement('div'); ar.className = 'row'; ar.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding-left:22px';
                for (const b of bodies) {
                  const ab = document.createElement('button'); ab.type = 'button'; ab.textContent = '+ ' + T(SEG_BODY_NAMES[b] || b);
                  ab.title = T('Stift mit Koordinaten ab Nase hinzufügen (dann x / y eintragen)');
                  ab.onclick = () => { const a = segPinPts(i).slice(); if (a.filter(q => q[2] === b).length >= 20) return; a.push([Math.round((nose.x + 30) * 100) / 100, Math.round(nose.y * 100) / 100, b]); segPinSetPts(i, a); if (segPinEdit === i) draw(); rb(); };
                  ar.appendChild(ab);
                }
                sg.body.appendChild(ar);
              }
            }
          });
        }
      }
      numRow(sg.body, 'Vorschau: Stücke auseinanderziehen (mm)', () => C('formSegGap'), v => { S('formSegGap', v); rr(); }, { step: 5, min: 0, norender: true });
      const pl = model ? segPlanes() : [], Ls = model ? segLengths(pl) : [];
      const info = document.createElement('div'); info.className = 'hint'; info.style.color = '#8ad4ff';
      info.textContent = Ls.length > 1 ? T('Ergebnis:') + ' ' + Ls.length + ' ' + T('Stücke') + ' — ' + Ls.map(l => l.toFixed(0)).join(' / ') + ' mm' : T('Ergebnis: 1 Stück (keine Teilung)');
      sg.body.appendChild(info);
    }
    // Reihenfolge im Menü: Bauteil → Randbogen → Steckung → Form → Glättung → Ansicht → Schnitt → Segmentierung → Export
    subhead(v.body, 'Farben (3D-Ansicht)');
    colorRow(v.body, 'Farbe Tragfläche', 'formColWing', '#c98a3a');
    colorRow(v.body, 'Farbe Winglet / Randbogen', 'formColWl', '#3a8ac9');
    colorRow(v.body, 'Farbe Formfläche', 'formColSurf', '#5aa0d8');
    colorRow(v.body, 'Farbe Formenrand / Hinterbau', 'formColRim', '#8a9099');
    colorRow(v.body, 'Farbe Randbogen (Formfläche)', 'formColTipF', '#4fb08a');
    hint(v.body, 'Tragfläche / Winglet: Urmodell. Formfläche: Kavität bzw. Profilhälfte der Negativform und des geteilten Urmodells (inkl. Stirnwände); der Randbogen-Bereich (ab der letzten Rippe) in eigener Farbe. Formenrand / Hinterbau: Flansch, Trennplatte, Sicke, Rückseite, Stirnseiten und Passlöcher; die untere Hälfte wird etwas dunkler gezeichnet.');
    boolRow(v.body, 'Drahtgitter', () => C('formWire'), v => { S('formWire', v); draw(); },
      'Nur Vorschau: Netz als Drahtgitter statt schattiert (auch über den Knopf unter dem Würfel umschaltbar).');
    boolRow(v.body, 'Trennfläche zeigen', () => C('formPsShow'), v => { S('formPsShow', v); draw(); },
      'Trennfläche gelb und halbdurchsichtig in der 3D-Ansicht, in der Schnittansicht als gelbe Linie (Punkte = Trennlinie an Nase und Endleiste). Derselbe Schalter wie im Block „Trennfläche“ und unter dem Ansichtswürfel; auch beim Urmodell (zeigt, wo die spätere Form geteilt wird).');
    selectRow(v.body, 'Darstellung', [['fine', 'fein (glatt, volle Auflösung)'], ['fast', 'schnell (flach, geringere Auflösung)'], ['2d', 'kompatibel (ohne WebGL)']], () => renderMode(), v => { S('formRender', v); draw(); },
      'Fein: glatt schattiert mit Glanzlicht in Geräteauflösung. Schnell: flache Schattierung in Bildschirmauflösung, beim Drehen halbiert – für schwache Grafik. Kompatibel: alter Zeichenpfad ohne WebGL (langsam, Sortierfehler möglich; wird automatisch benutzt, wenn WebGL fehlt).');
    side.appendChild(t.g);
    if (pinGrp) side.appendChild(pinGrp.g);
    if (psGrp) side.appendChild(psGrp.g);
    if (nGrp) side.appendChild(nGrp.g);
    side.appendChild(s.g);
    side.appendChild(v.g);
    side.appendChild(sg.g);
    for (const r of exportRows) e.body.appendChild(r);
    if (DEMO) hint(e.body, DEMO_MSG);
    if (exportHint) hint(e.body, exportHint);
    side.appendChild(e.g);
  }

  Object.assign(App, { formSidebar });
  window.Formenbau = { show, refresh, resize, draw, build, exportUr, exportTop, exportBot, exportWingOnly, exportTipOnly, exportUrStep, exportMoldStep, formStepText, moldStepText, openCmp, closeCmp,
    _dbgModel: () => model,   // Test-Hook (STEP-Validierung gegen echte Ringe)
    _test: { fitBSpline, smoothRib, teThickRing, earClip, splitMeshZ, splitMeshAll, pinSpots, segPlanes, segOpts, segPinAt, segPinPts, segPinSetPts, segPinClick, segPinEditStart, segPinEditStop, segPinEdit: () => segPinEdit, segNoseAt, holeSpots, segLengths, capPins, mergeHoles, wingRings, buildUrParts, tipSpine, partW, bendMesh, buildWith, moldRings, splitRings, partingReparam, partingSheet, partingSection, holeSpots, loftHoles, zipper, buildMold, buildSplit, opts, cutTri, chainSegs, sectionLoops, stationsAbs, exportTransform, toBinarySTL, railCurve, wingletDrawRings, wlXf: () => wlXf, wlHit, wlSel: () => wlSel, urmodellRingStack, stepClean, meas: () => meas, measHit, measThick, measCalc, circle3, measClick, view: () => ({ W, H, cam, center, radius }) } };
})();
