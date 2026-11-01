/* rumpfpro.js — Reiter „Rumpf": Rumpfkonstruktion nach dem Vorbild von DevFus.
 * Eigenständiges Modul (Feature „rumpfpro", interner Name aus der Zeit neben dem alten rumpf.js);
 * eigene Einstellungen state.cfg.rpro*. Andere Module rufen nur geschützt
 * (window.RumpfPro && …). Der Bausatz (Spanten mit Beplankungsabzug, Gurte, Helling …)
 * wird im Reiter „Rumpf Spanten" (rproSpanten.js) abgeleitet.
 *
 * KONZEPT (wie DevFus)
 *   1. Umrisse: Oberkante und Unterkante (Seitenansicht) und halbe Breite (Draufsicht)
 *      sind eigene Splines mit eigenen Punkten — unabhängig von den Spanten.
 *      Punkt {x, v, c, i, o}: c 0 = glatt (automatisch, Catmull-Rom, keine Griffe —
 *      DevFus „blau"), 1 = glatt mit Tangente (Griffe kollinear), 2 = Ecke (Griffe frei —
 *      DevFus „rot/grün"). Anfang und Ende aller drei Linien liegen auf gleichem X.
 *   2. Spanten: frei entlang X platziert, je Spant ein Querschnittstyp
 *        'egg'    Ei: obere + untere Ellipse, Parameter Y der breitesten Stelle (yw)
 *        'rect'   abgerundetes Rechteck/Trapez: Eckradien X/Y oben (rt) und unten (rb),
 *                 Seitenneigung (sl, ° zur Senkrechten, + = oben breiter)
 *        'circle' echter Kreis (Durchmesser fest oder Mittel aus Höhe/Breite), z. B. Spinner
 *        'tri'    gerundetes Dreieck/Tropfen: wie das Ei, aber mit einstellbarer Völligkeit
 *                 oben (vo) und unten (vu), je an der Spitze und an der breitesten Stelle
 *                 (55 % = Ellipse, kleiner = Richtung Dreieck, größer = Richtung Kasten)
 *        'free'   Bezier-Knoten mit Tangenten (wie im Reiter „Rumpf")
 *      Jede Parametergruppe ist je Spant Steuerwert (ctl) oder wird aus den nächsten
 *      Steuerspanten desselben Laufs interpoliert (Lauf = aufeinanderfolgende Spanten
 *      gleichen Typs; erster/letzter Spant eines Laufs sind immer Steuerspanten).
 *      Interpolation (Modus am Steuerspant, gilt bis zum nächsten): yw linear/Spline,
 *      Radien absolut (mm)/proportional (zur Größe)/gerade (Übergangskante verläuft
 *      in X gerade), Neigung linear, Durchmesser linear.
 *      Sprungstelle (unstetiger Rumpf): zwei zusammengehörige Spanten 1 mm hintereinander (jmp 'a'/'b', jid) —
 *      eigener Spant für das vordere und das hintere Segment, Umrisse mit Eckpunkten an beiden.
 *   3. Fläche: an jeder Stelle x Querschnitt aus den Umrissen (Kasten top/bot/w) und
 *      der Form: zwischen zwei Spanten gleichen Parametertyps aus den interpolierten
 *      Parametern, sonst Überblendung der Bezier-Knoten (Catmull-Rom). Kreis-Spanten
 *      ziehen den Kasten auf ihren Kreis (weich zu den Nachbarspanten ausgeblendet).
 *   4. Anbauten (Tragflächenübergang, Seitenleitwerk), Darstellung, STL/DXF wie „Rumpf";
 *      zusätzlich Formen als STL (Halbschale, Positiv auf Block, Negativ im Block).
 *
 *   5. Kabinenhaube (rproKh): Ausschnitt in der Seitenansicht aus drei Linien (vorne, unten,
 *      hinten; gerade oder Spline) mit Übergangsradien, quer durch den Rumpf. Die Haube
 *      bekommt im 3D-Bild eine eigene Farbe (Abstand zur Schnittlinie je Gitterpunkt -> Shader).
 *
 * Koordinaten: X = Rumpflänge (Nase -> Heck), Y = hoch, Z = seitlich (rechte Hälfte, Z >= 0).
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;
  const { grp, hint, subhead, boolRow, selectRow, mkMini, buildSidebar } = App, numRow = App.numRowEnter || App.numRow;   // Zahlen erst bei Enter/Verlassen/Pfeil (Setter bauen die Leiste neu)
  // Fenster „Projektion“ der Anformung (projWin*): Zustand hier oben, weil draw() es abfragt
  const projW = { win: null, side: null, cv: null, cx: null, kind: 'wing', view: null, auto: true, drag: null, hot: null, sel: null, keyT: 0 };
  const cvW = { win: null, side: null, cv: null, cx: null, hs: [], drag: null, hot: null, sel: null, fr: null, mode: 'sec', nside: 'U', views: {}, keyT: 0, tgt: 'wing' };   // Fenster Hohlkehle (Vorderansicht), tgt 'wing' | 'fin'
  const KAPPA = 0.5523;   // Bezier-Kreisbogen (Viertelkreis)
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;

  // ---------- Spantknoten -------------------------------------------------------
  // Kreisbögen: 3 Knoten, breiteste Stelle bei normierter Höhe m.
  function circleNodes(m) {
    m = clamp(+m || 0.5, 0.05, 0.95);
    return [
      { y: 1, z: 0, i: [0, 0], o: [0, KAPPA] },
      { y: m, z: 1, i: [KAPPA * (1 - m), 0], o: [-KAPPA * m, 0] },
      { y: 0, z: 0, i: [0, KAPPA], o: [0, 0] }
    ];
  }
  // ---------- Vorlagen ------------------------------------------------------------
  // [x, top, bot, w, m (breiteste Stelle normiert), tan]
  function tpl(rows) { return rows.map(r => ({ x: r[0], top: r[1], bot: r[2], w: r[3], fix: '', nodes: circleNodes(r[4] == null ? 0.5 : r[4]), tan: r[5] || {} })); }
  const TPL = {
    // ASW 20 im Maßstab 1:6, abgenommen von der Schleicher-Dreiseitenansicht (Seite = Ober-/Unterkante inkl. Haube,
    // Draufsicht = halbe Breite, Vorderansicht: breiteste Stelle tief bei ~0,36 der Höhe). Rumpf bis zum Ruder (1081 mm),
    // Flügelnase an der Wurzel ~X 335, Endleiste ~X 500.
    segler: () => tpl([
      [0, -29, -39, 5, 0.5, { top: { o: [0, 10] }, bot: { o: [0, -10] }, w: { o: [0, 6.6] } }],   // Nase: senkrecht, Länge wie Ellipsenviertel
      [28, -12.6, -48.9, 15.5, 0.45],
      [56, 2.8, -55.9, 23.1, 0.4],
      [98, 23.8, -64.3, 33.6, 0.38],
      [154, 43.3, -71.3, 44, 0.36],
      [224, 60.1, -72.7, 51.7, 0.36],
      [296, 68.5, -68.5, 53.1, 0.38],
      [364, 65.7, -53, 43.3, 0.42],
      [419, 61.5, -44.7, 39.8, 0.45],
      [531, 53.1, -28, 34.3, 0.5],
      [727, 39.1, -9.8, 24.5, 0.5],
      [951, 28, -1.4, 14.7, 0.5],
      // Heck stumpf (nicht auf 0): an der Ruderlinie 24 mm breit — Platz für Seitenleitwerk (~12 mm dick) + Anformung
      [1081, 26, 2, 12, 0.5]
    ]),
    motor: () => tpl([
      [0, 24, -24, 24, 0.5, { top: { o: [4, 8] }, bot: { o: [4, -8] }, w: { o: [4, 6] } }],
      [60, 36, -38, 34, 0.5],
      [200, 50, -44, 40, 0.45],
      [400, 40, -40, 32, 0.5],
      [650, 22, -20, 16, 0.5],
      [900, 10, -6, 6, 0.5]
    ])
  };

  // ---------- Konfiguration (state.cfg.rumpf*) ------------------------------
  const DEF = {
    rproOut: null,            // Umrisse { top, bot, w: [{x, v, c, i, o}] } — null = Vorlage Segler
    rproFr: null,             // Spanten [{x, type, p, ctl, mode, nodes, lock}]
    rproNu: 32,               // Abtastung: Schritte um den Halbspant
    rproNv: 160,              // Abtastung: Schritte in Längsrichtung
    rproView: '3d',           // '3d' | 'side' | 'top' | 'sec' (Spant) | 'cut' (Schnitt)
    rproSel: 0,               // ausgewählter Spant
    rproPt: null,             // ausgewählter Umrisspunkt { line, k } (null = keiner)
    rproCutX: 300,            // Schnittansicht: X-Lage (mm)
    rproUp: 'z',              // STL: 'z' hoch (Druck/Fräse) | 'y' wie im Programm
    rproShowSt: true,         // Spantkurven in 3D anzeigen
    rproShowTan: false,       // Tangenten aller Umrisspunkte zeigen (sonst nur des gewählten)
    rproImgOp: 55,            // Hintergrundbild: Deckkraft %
    rproImgSide: null,        // { len, x, y, flip } Bildmaßstab/Lage Seitenansicht (Bilddaten in rproImgSrc)
    rproImgTop: null,
    rproImgFront: null,       // Vorderansicht / Spant (Z/Y)
    rproImgSrc: null,         // { side, top, sec }: Bilddaten der gemeinsamen Hintergrundbilder (Data-URL, im Projekt gespeichert)
    rproImgVec: null,         // { side, top }: Konturen zum Bild als Linien (aus der 3D-Bearbeitung), siehe setBackground
    rproInit: { n: 8, dF: 20, dR: 40, type: 'egg' },   // Spanten neu anlegen (DevFus „Initial Formers")
    rproMold: { type: 'halfNeg', side: 'r', ext: 5, margin: 20, base: 15 },   // Formen als STL
    // Anbauten (je Spant in die Rumpfkontur eingerechnet, siehe „Anbauten" unten)
    rproWing: { on: false, mode: 'fil', src: 'wing', prof: null, xLE: 335, yLE: 20, chord: 0, alpha: 2, z: 0, zRef: 'center', cutOpen: 'up', cutPlay: 0, cutZ: 0,
      te: 0.5, fTen: 0.55, fRnd: 0.5, fStr: 0,
      // Projektion (Anformung): Offset des Wurzelprofils rundum (pD) + weiche Zusatzverlängerung vorn/hinten (X) und
      // oben/unten (Y), Endleistendicke + -radius der Projektion
      pD: 10, pF: 30, pB: 40, pU: 0, pL: 0, pTe: 0, pTeR: 0,
      // Leitlinien der Anformung in der Draufsicht (Spline-Stützpunkte, relativ: u längs X, v zwischen Rumpf und Rippe):
      // gLE vom Projektionsanfang zur Nasenleiste der Wurzelrippe, gTE von der Endleiste der Wurzelrippe zum Projektionsende
      gLE: null, gTE: null },
    rproFin: { on: false, xLE: 0, y0Auto: true, y0: 0, cr: 180, h: 220, angLE: 30, angTE: 8, angTip: 0, leR: 60,
      srcR: 'naca', thkR: 9, profR: null, srcT: 'naca', thkT: 8, profT: null, R: 10, tipRound: 20,
      mode: 'std', ctP: 110, swP: 25,     // mode 'plain' = einfache Fläche (Außentiefe ctP, Pfeilung swP), ohne Übergänge
      fpts: null, fThkMax: 0,             // mode 'free' = freier Umriss: fpts [{x, y, t line|spline, r, k}] (geschlossen), fThkMax = größte Dicke (mm, 0 = aus)
      // Anschluss an den Rumpf unabhängig von der Umrissart: fil = Anformung nach ErnstV (Projektion vorn/hinten/seitlich,
      // Endleistendicke/-radius der Projektion, Völligkeit, Rundung, Anschlusshöhe über dem Rumpfrücken)
      // pD 4: das Leitwerk füllt das Heck der Vorlage fast aus (bis ~17 mm dick bei 24–28 mm Rumpf) — mehr passt nicht neben
      // das Leitwerk, die Projektion würde an der Rumpfflanke gekappt (steiler Fuß)
      fil: true, fTen: 0.55, fRnd: 0.5, fH: 0, fA: 0, pD: 4, pF: 20, pB: 30, pS: 0, pTe: 0, pTeR: 0,
      // wie die Tragfläche: Leitlinien Nase/Endleiste (Seitenansicht, relativ u/v), Kehlenform cv (eine für beide Seiten)
      gLE: null, gTE: null, cv: null, cvSpl: null,
      // Ruder abtrennen: Ruderlinie = Gerade aus Rudertiefe in % der Tiefe an Wurzel (pR) und Spitze (pT); das Ruder gehört
      // nicht zum Rumpf (nur Anzeige). atEnd = Leitwerk so verschieben, dass die Ruderlinie die Rumpfoberkante am Rumpfende trifft
      rud: null },
    // Höhenleitwerk oben auf dem Seitenleitwerk: schneidet die Auflage in Profilform aus (Fläche selbst nur Anzeige)
    rproHlw: { on: false, mode: 'seat', xAuto: true, x: 0, yAuto: true, y: 0, cr: 120, ct: 80, b: 420, sweep: 8, alpha: 0, src: 'naca', thk: 9, prof: null, play: 0, show: true, zS: 0, wingId: null },   // wingId = Tragfläche aus dem Projekt (null = eigene Maße); mode 'seat' = T-Leitwerk (Auflage), 'cross' = Kreuzleitwerk (Stummel bis zS)
    // V-Leitwerk-Anschluss: je Seite ein Stummel (Profil gerade bis zur Rippenebene, V-Winkel dih ab der Waagrechten), Nase bei
    // xLE (0 = automatisch vor dem Heck) / yLE (Rumpfmitte), Stummellänge len längs der Spannweite ab Rumpfmitte (0 = automatisch),
    // Steckungsbohrungen bores [{x, y, d, len}] ab der Profilnase (x längs Sehne, y senkrecht dazu), Tiefe ab der Rippenfläche
    // Art mode wie beim Tragflächenübergang: 'stub' | 'cut' (Ausschnitt) | 'fil' (Anformung nach ErnstV) — gleiche Schlüssel wie
    // rproWing, gerechnet im um den V-Winkel gedrehten Rahmen (Leitwerk dort waagrecht, „oben“ = Profiloberseite)
    rproVt: { on: false, xLE: 0, yAuto: true, yLE: 0, chord: 110, alpha: 0, dih: 35, len: 0, src: 'naca', thk: 9, prof: null, bores: null,
      mode: 'fil', cutOpen: 'none', cutPlay: 0, cutZ: 0, te: 0.3, fTen: 0.55, fStr: 0,
      pD: 6, pF: 20, pB: 30, pU: 0, pL: 0, pTe: 0, pTeR: 0, gLE: null, gTE: null },
    // Rumpfboot + konisches Leitwerksrohr: Boot endet am Übergang X (xAuto = am Heck), dort Einschnürung (Steckmaß sock,
    // Spiel play) für das Rohr; Rohr außen d0 (vorne, dAuto = aus dem Bootsquerschnitt) -> d1 (hinten), Länge len,
    // Neigung ang (°, + = nach oben), Wandstärke wall (= Abzug für den Wickeldorn im Reiter „Rumpf Formenbau")
    rproBoom: { on: false, xAuto: true, x: 0, dAuto: true, d0: 30, d1: 14, len: 700, ang: 0, wall: 0.8, sock: 40, play: 0.1, show: true },
    rproRender: 'fine',       // 3D: 'fine' WebGL glatt + Glanz | 'flat' WebGL flach | 'wire' Drahtmodell | '2d' Canvas-2D (ohne WebGL)
    rproShowWing: true,       // Tragfläche aus dem Tragflächendesign am Anschluss zeigen (nur Anzeige)
    rproComb: true,           // Krümmungskamm + Wendepunkte an den Umrissen (Seite/Draufsicht) und am Schnitt
    rproCombLen: 40,          // größte Kammlänge (px)
    rproAna: 'off',           // 3D-Analyse: 'off' | 'curv' Längskrümmung farbig | 'zebra' Reflexionsstreifen
    rproFairTol: 2,           // Linie glätten: größte Verschiebung je Punkt (mm)
    // Kontur aus dem Hintergrundbild nachzeichnen: tol Genauigkeit (mm, 0 = 2 Bildpixel), max Punkte je Linie, gap Lücken schließen (px),
    // open dünne Linien entfernen (px), thr Schwelle Farbabstand (0 = automatisch), bridge/ang Anbauten überbrücken ab Steigung (°), show Rohkontur zeigen
    rproTrace: { tol: 0, max: 30, gap: 1, open: 2, thr: 0, bridge: true, ang: 50, show: true },
    // Fixieren: top = Draufsicht (halbe Breite), side = Seitenansicht (Ober-/Unterkante), wid = Dickenlinie (Y der breitesten
    // Stelle der Ei-/Dreieck-Spanten), fr = alle Spanten (einzeln: f.pin). snap/wsnap = festgehaltener Stand.
    rproFix: { top: false, side: false, wid: false, fr: false },
    rproColBody: '#3d7ea6', rproColFin: '#b07fd0', rproColAtt: '#5fb87f', rproColWing: '#c98a3a', rproColKh: '#8fd3f4', rproColBoom: '#9aa3ad', rproColFr: '#e2d6b8',
    rproKhHide: false,        // Kabinenhaube im 3D-Bild ausblenden (Blick in den Ausschnitt)
    // Kabinenhaube: vordere untere Ecke bei X (null = automatisch), Tiefe unter der Oberkante, Länge/Neigung der
    // unteren Linie, Winkel der vorderen/hinteren Linie, Übergangsradien, je Linie (F vorne, B unten, R hinten) gerade/Spline
    rproKh: { on: false, x: null, depth: 30, len: 160, slope: 0, angF: 35, angR: 55, radF: 15, radR: 15,
      typeF: 'line', curvF: 0, posF: 50, typeB: 'line', curvB: 0, posB: 50, typeR: 'line', curvR: 0, posR: 50,
      mode: 'std', pts: null,   // mode 'free' = freier Linienzug: pts [{x, y, r (Eckradius), t line|spline|foil (Abschnitt bis zum nächsten Punkt), curv, pos, fSrc, fThk, fProf, fSide, fNose, fScale}], Endpunkte liegen auf der Oberkante
      skOn: false, skN: 1, skW: 6, skD: 0.5, skA: 30,
      skAuto: false,            // Vertiefung der Sicke aus Haubenstärke (+ Rahmenstärke + Spiel) statt skD
      glass: 0.5,               // Stärke der Kabinenhaube: Rahmen liegt so tief, Tiefziehklotz = Innenseite der Haube
      fr: { on: false, h: 12, t: 1.5, play: 0.1 } }   // Haubenrahmen: Höhe ab der Schnittlinie (Seitenansicht), Stärke, Spiel zur Sicke   // Sicke (Auflage der Haube) am Rumpfausschnitt: Stufen, Höhe und Vertiefung je Stufe, Entformungsschräge (°)
  };
  // Pseudo-Schlüssel: Lage/Maßstab des Hintergrundbilds des gewählten Spants (f.bgc), siehe IMG_KEY / ownFr.
  const FRIMG = '@frImg';
  function C(k) {
    if (k === FRIMG) { const f = ownFr(); return f ? (f.bgc || null) : null; }
    if (state.cfg[k] == null) {
      const d = DEF[k];
      state.cfg[k] = (d && typeof d === 'object') ? JSON.parse(JSON.stringify(d)) : d;
    }
    return state.cfg[k];
  }
  function S(k, v) {
    if (k === FRIMG) { const f = ownFr(); if (f) { if (v) f.bgc = v; else delete f.bgc; } return; }
    state.cfg[k] = v;
  }
  // Altstände (Superellipse nT/nB, freie Form shape, yw) in Knoten überführen.
  function norm(s) {
    s.x = +s.x || 0; s.top = +s.top || 0; s.bot = +s.bot || 0; s.w = Math.max(0, +s.w || 0);
    if (!Array.isArray(s.nodes) || s.nodes.length < 2) { const h = s.top - s.bot; s.nodes = circleNodes(h > 0 && s.yw != null ? (s.yw - s.bot) / h : 0.5); }
    if (s.fix === 'shape' || (s.fix !== 'lock' && s.fix !== 'circle')) s.fix = '';
    if (!s.tan || typeof s.tan !== 'object') s.tan = {};
    s.xfix = !!s.xfix;
    delete s.nT; delete s.nB; delete s.shape; delete s.yw;
    return s;
  }
  // Spantansicht: hat der gewählte Spant eine eigene Ansicht (f.own), gehören Bildlage, Bild und Zoom ihm.
  const IMG_KEY = new Proxy({ side: 'rproImgSide', top: 'rproImgTop', sec: 'rproImgFront' }, { get: (t, k) => k === 'sec' && ownFr() ? FRIMG : t[k] });
  // Gewählter Spant, falls er eine eigene Spantansicht hat (ohne normFr — wird beim Zeichnen sehr oft gefragt).
  function ownFr() {
    const a = state.cfg.rproFr; if (!Array.isArray(a) || !a.length) return null;
    const f = a[Math.min(Math.max(0, Math.round(+state.cfg.rproSel || 0)), a.length - 1)];
    return f && f.own ? f : null;
  }
  function selIdx() { const fr = formers(); return Math.min(Math.max(0, Math.round(C('rproSel'))), fr.length - 1); }
  let khSel = 0;     // gewählter Punkt der freien Haubenlinie
  let finSel = 0;    // gewählter Punkt des freien Seitenleitwerk-Umrisses
  let selNode = 1;   // gewählter Knoten des gewählten Spants (Spantansicht, Typ „frei“)

  // Breiteste Stelle: Knoten mit größtem z (normiert 1).
  function widestIdx(s) { let k = 0; for (let j = 1; j < s.nodes.length; j++) if (s.nodes[j].z > s.nodes[k].z + 1e-9) k = j; return k; }
  function ywOf(s) { return s.bot + s.nodes[widestIdx(s)].y * (s.top - s.bot); }
  function setYw(s, v) {
    if (s.fix === 'circle') { const r = (s.top - s.bot) / 2; s.top = r2(v + r); s.bot = r2(v - r); return; }
    if (s.fix === 'lock') return;
    const h = s.top - s.bot, k = widestIdx(s); if (!(h > 0) || k === 0 || k === s.nodes.length - 1) return;
    s.nodes[k].y = clamp((v - s.bot) / h, 0.02, 0.98);
  }

  // ---------- Bezier-Grundlagen ------------------------------------------------------
  function bez2(P, t) {
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0], a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1]];
  }
  function bez1(p0, p1, p2, p3, t) { const u = 1 - t; return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3; }
  // Parameter t zu x (x(t) monoton, da Griffe im Intervall liegen).
  function solveT(P, x) { let lo = 0, hi = 1; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (bez2(P, m)[0] < x) lo = m; else hi = m; } return (lo + hi) / 2; }
  // de Casteljau: Teilung bei t. Liefert die beiden Teilkurven.
  function splitBez(P, t) {
    const L = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const P01 = L(P[0], P[1]), P12 = L(P[1], P[2]), P23 = L(P[2], P[3]), P012 = L(P01, P12), P123 = L(P12, P23), M = L(P012, P123);
    return [[P[0], P01, P012, M], [M, P123, P23, P[3]]];
  }

  // ---------- Längslinien (top / bot / w über x) ----------------------------------------
  function lval(s, key) { return key === 'w' ? s.w : s[key]; }
  function tanAuto(sts, j, key) {
    const s = sts[j], p = sts[j - 1], n = sts[j + 1], v = lval(s, key);
    let i = [0, 0], o = [0, 0];
    if (p && n) { const D = (n.x - p.x) || 1, dv = lval(n, key) - lval(p, key); o = [(n.x - s.x) / 3, dv * (n.x - s.x) / D / 3]; i = [-(s.x - p.x) / 3, -dv * (s.x - p.x) / D / 3]; }
    else if (n) o = [(n.x - s.x) / 3, (lval(n, key) - v) / 3];
    else if (p) i = [-(s.x - p.x) / 3, -(v - lval(p, key)) / 3];
    return { i, o };
  }
  // Tangente (Bezier-Griffvektoren) einer Station: explizit oder automatisch. Kreis: Breite folgt Ober-/Unterkante.
  function tanOf(sts, j, key) {
    const s = sts[j];
    if (s.fix === 'circle' && key === 'w') {
      const a = tanOf(sts, j, 'top'), b = tanOf(sts, j, 'bot');
      return { i: [(a.i[0] + b.i[0]) / 2, (a.i[1] - b.i[1]) / 2], o: [(a.o[0] + b.o[0]) / 2, (a.o[1] - b.o[1]) / 2], explicit: a.explicit || b.explicit };
    }
    const a = tanAuto(sts, j, key), t = (s.tan && s.tan[key]) || {};
    return { i: Array.isArray(t.i) ? t.i.slice() : a.i, o: Array.isArray(t.o) ? t.o.slice() : a.o, explicit: !!(t.i || t.o) };
  }
  function lineSegs(sts, key) {
    const segs = [];
    for (let j = 0; j + 1 < sts.length; j++) {
      const a = sts[j], b = sts[j + 1], D = b.x - a.x, ta = tanOf(sts, j, key), tb = tanOf(sts, j + 1, key);
      const o = [clamp(ta.o[0], 0, D), ta.o[1]], i = [clamp(tb.i[0], -D, 0), tb.i[1]];
      const va = lval(a, key), vb = lval(b, key);
      segs.push({ x0: a.x, x1: b.x, P: [[a.x, va], [a.x + o[0], va + o[1]], [b.x + i[0], vb + i[1]], [b.x, vb]] });
    }
    return segs;
  }
  function segAt(segs, x) { let sg = segs[0]; for (const g of segs) { sg = g; if (x <= g.x1) break; } return sg; }
  function lineAt(segs, x) {
    if (!segs.length) return 0;
    const sg = segAt(segs, x);
    if (x <= sg.x0) return sg.P[0][1]; if (x >= sg.x1) return sg.P[3][1];
    return bez2(sg.P, solveT(sg.P, x))[1];
  }
  function linePts(segs, N) { const out = []; for (const sg of segs) for (let k = (out.length ? 1 : 0); k <= N; k++) out.push(bez2(sg.P, k / N)); return out; }

  // ---------- Spantkurve (Knoten -> Punkte) --------------------------------------------
  // nodes: {y,z,i,o} (normiert oder physisch). Liefert [[y,z], ...], perSeg Punkte je Segment.
  function polyOf(nodes, perSeg) {
    const out = [[nodes[0].y, nodes[0].z]];
    for (let k = 0; k + 1 < nodes.length; k++) {
      const a = nodes[k], b = nodes[k + 1];
      const P = [[a.y, a.z], [a.y + a.o[0], a.z + a.o[1]], [b.y + b.i[0], b.z + b.i[1]], [b.y, b.z]];
      for (let q = 1; q <= perSeg; q++) out.push(bez2(P, q / perSeg));
    }
    return out;
  }
  function segP(a, b) { return [[a.y, a.z], [a.y + a.o[0], a.z + a.o[1]], [b.y + b.i[0], b.z + b.i[1]], [b.y, b.z]]; }
  // Knoten einfügen: Segment k bei t teilen (Form bleibt exakt).
  function splitSeg(nodes, k, t) {
    const a = nodes[k], b = nodes[k + 1], [A, B] = splitBez(segP(a, b), t), M = A[3];
    a.o = [A[1][0] - A[0][0], A[1][1] - A[0][1]];
    b.i = [B[2][0] - B[3][0], B[2][1] - B[3][1]];
    nodes.splice(k + 1, 0, { y: M[0], z: M[1], i: [A[2][0] - M[0], A[2][1] - M[1]], o: [B[1][0] - M[0], B[1][1] - M[1]] });
    return nodes;
  }
  // Gerade Abschnitte (freier Spant): Knoten mit l = true -> Strecke bis zum nächsten Knoten ist eine Gerade
  // (Griffe auf der Sehne, je ein Drittel; bleibt beim Skalieren und Überblenden gerade).
  function straighten(nodes) {
    for (let k = 0; k + 1 < nodes.length; k++) {
      const a = nodes[k], b = nodes[k + 1]; if (!a.l) continue;
      const d = [(b.y - a.y) / 3, (b.z - a.z) / 3];
      a.o = [d[0], d[1]]; b.i = [-d[0], -d[1]];
    }
    if (nodes.length) delete nodes[nodes.length - 1].l;
    return nodes;
  }
  function longestSeg(nodes) { let k = 0, best = -1; for (let j = 0; j + 1 < nodes.length; j++) { const d = Math.hypot(nodes[j + 1].y - nodes[j].y, nodes[j + 1].z - nodes[j].z); if (d > best) { best = d; k = j; } } return k; }
  // Nach Formänderung: größtes z der Kurve = 1 (halbe Breite bleibt die Breite).
  function normalizeShape(s) {
    const P = polyOf(s.nodes, 16); let zm = 0; for (const q of P) zm = Math.max(zm, q[1]);
    if (zm > 1e-9 && Math.abs(zm - 1) > 1e-6) { for (const n of s.nodes) { n.z /= zm; n.i[1] /= zm; n.o[1] /= zm; } s.w = r2(s.w * zm); }
    for (const n of s.nodes) n.z = Math.max(0, n.z);
  }
  // Tangenten je Knoten glätten (ein-/auslaufend gleiche Richtung, Längen bleiben).
  function smoothNodes(s) {
    const n = s.nodes.length;
    s.nodes.forEach((q, k) => {
      if (k === 0) { q.o = [0, Math.max(0.01, Math.hypot(q.o[0], q.o[1]))]; return; }
      if (k === n - 1) { q.i = [0, Math.max(0.01, Math.hypot(q.i[0], q.i[1]))]; return; }
      const d = [q.o[0] - q.i[0], q.o[1] - q.i[1]], L = Math.hypot(d[0], d[1]); if (L < 1e-9) return;
      const li = Math.hypot(q.i[0], q.i[1]), lo = Math.hypot(q.o[0], q.o[1]);
      q.i = [-d[0] / L * li, -d[1] / L * li]; q.o = [d[0] / L * lo, d[1] / L * lo];
    });
  }
  // Alle Stationen auf gleiche Knotenzahl bringen (Kopien; Teilung des längsten Segments).
  function unify(sts) {
    const N = Math.max(...sts.map(s => s.nodes.length));
    return sts.map(s => { const nd = JSON.parse(JSON.stringify(s.nodes)); while (nd.length < N) splitSeg(nd, longestSeg(nd), 0.5); return nd; });
  }
  const flat = nd => { const a = []; for (const q of nd) a.push(q.y, q.z, q.i[0], q.i[1], q.o[0], q.o[1]); return a; };
  const unflat = a => { const nd = []; for (let k = 0; k < a.length; k += 6) nd.push({ y: a[k], z: Math.max(0, a[k + 1]), i: [a[k + 2], a[k + 3]], o: [a[k + 4], a[k + 5]] }); return nd; };

  // ==========================================================================================
  // Modell „Rumpf" (nach DevFus): Umrisse unabhängig von den Spanten, parametrische Spanten
  // ==========================================================================================
  const LINES = ['top', 'bot', 'w'];
  const PGROUPS = { egg: ['yw'], tri: ['yw', 'vo', 'vu'], rect: ['sl', 'rt', 'rb'], circle: ['dia'], free: [] };
  const PORDER = ['sl', 'yw', 'dia', 'rt', 'rb', 'vo', 'vu'];
  const PMODES = { yw: ['lin', 'spl'], rt: ['abs', 'prop', 'line'], rb: ['abs', 'prop', 'line'], sl: ['lin'], dia: ['lin'], vo: ['lin'], vu: ['lin'] };
  const PDEF = { yw: null, rtx: 12, rty: 12, rbx: 12, rby: 12, sl: 0, dia: 0, vot: 25, vow: 35, vut: 55, vuw: 45, vos: 180, vus: 180 };
  const MDEF = { yw: 'spl', rt: 'abs', rb: 'abs', sl: 'lin', dia: 'lin', vo: 'lin', vu: 'lin' };

  // ---- Umrisse -------------------------------------------------------------------------
  // Spline-Art der Umrisse (cfg.rproOut.spl):
  //   'c2' krümmungsstetig: je Abschnitt zwischen festen Punkten (Linienenden, Punkte mit Tangente/Ecke) ein
  //        kubischer Spline in x mit stetiger 2. Ableitung — keine Krümmungssprünge an den glatten Punkten
  //   'cr' Catmull-Rom (wie Reiter „Rumpf"): nur Tangente stetig, Krümmung springt an jedem Punkt
  //   'bs' B-Spline: glatte Punkte sind Kontrollpunkte (nicht auf der Kurve); die Kurve hat höchstens so viele
  //        Wendepunkte wie das Kontrollpolygon (variationsmindernd) — am ruhigsten. Ecken (c 2) liegen auf der Kurve.
  function splMode(o) { o = o || state.cfg.rproOut; const m = o && o.spl; return m === 'cr' || m === 'bs' ? m : 'c2'; }
  const ownTan = p => !!(p.c && Array.isArray(p.i) && Array.isArray(p.o));
  function crTan(pts, j) {
    const s = pts[j], p = pts[j - 1], n = pts[j + 1];
    let i = [0, 0], o = [0, 0];
    if (p && n) { const D = (n.x - p.x) || 1, dv = n.v - p.v; o = [(n.x - s.x) / 3, dv * (n.x - s.x) / D / 3]; i = [-(s.x - p.x) / 3, -dv * (s.x - p.x) / D / 3]; }
    else if (n) o = [(n.x - s.x) / 3, (n.v - s.v) / 3];
    else if (p) i = [-(s.x - p.x) / 3, -(s.v - p.v) / 3];
    return { i, o };
  }
  function thomas(A, B, Cc, D) {
    const n = D.length, c = new Array(n), d = new Array(n), x = new Array(n);
    c[0] = Cc[0] / B[0]; d[0] = D[0] / B[0];
    for (let k = 1; k < n; k++) { const m = (B[k] - A[k] * c[k - 1]) || 1e-12; c[k] = Cc[k] / m; d[k] = (D[k] - A[k] * d[k - 1]) / m; }
    x[n - 1] = d[n - 1]; for (let k = n - 2; k >= 0; k--) x[k] = d[k] - c[k] * x[k + 1];
    return x;
  }
  const slopeOf = v => clamp(Math.abs(v[0]) > 1e-9 ? v[1] / v[0] : (v[1] >= 0 ? 50 : -50), -50, 50);
  // Gerade Abschnitte (p.l = Strecke bis zum nächsten Punkt ist eine Gerade): die Endpunkte bekommen feste Griffe —
  // auf der Geraden je ein Drittel der Sehne, auf der Spline-Seite die Richtung der Geraden (tangentialer Anschluss;
  // bei einer Ecke bleibt der eigene Griff). Liefert eine Kopie mit Ersatzpunkten (c 1), die Löser behandeln sie wie
  // Punkte mit Tangente.
  const lineSlope = (a, b) => clamp((b.v - a.v) / ((b.x - a.x) || 1e-9), -50, 50);
  function applyStraight(pts) {
    const n = pts.length; if (!pts.some((p, j) => p.l && j < n - 1)) return pts;
    return pts.map((p, j) => {
      const L = j > 0 && !!pts[j - 1].l, R = j < n - 1 && !!p.l; if (!L && !R) return p;
      const q = { x: p.x, v: p.v, c: p.c || 1, i: Array.isArray(p.i) ? p.i.slice() : [0, 0], o: Array.isArray(p.o) ? p.o.slice() : [0, 0] };
      const h0 = j > 0 ? p.x - pts[j - 1].x : 0, h1 = j < n - 1 ? pts[j + 1].x - p.x : 0;
      if (L) q.i = [-h0 / 3, -(p.v - pts[j - 1].v) / 3];
      if (R) q.o = [h1 / 3, (pts[j + 1].v - p.v) / 3];
      if (p.c !== 2) {
        if (L && !R && j < n - 1) { const s = lineSlope(pts[j - 1], p); q.o = [h1 / 3, s * h1 / 3]; }
        if (R && !L && j > 0) { const s = lineSlope(p, pts[j + 1]); q.i = [-h0 / 3, -s * h0 / 3]; }
      }
      return q;
    });
  }
  // Griff `tan` ('i'/'o') des Umrisspunkts k liegt durch einen geraden Abschnitt fest (nicht ziehbar).
  function tanFixed(pts, k, tan) {
    const p = pts[k], lft = k > 0 && !!pts[k - 1].l, rgt = k < pts.length - 1 && !!p.l;
    return tan === 'o' ? (rgt || (lft && p.c !== 2)) : (lft || (rgt && p.c !== 2));
  }
  // Bezier-Griffe aller Punkte einer Linie (gezogen oder automatisch je Spline-Art).
  function autoTans(pts, mode) {
    pts = applyStraight(pts);
    const n = pts.length, T = new Array(n);
    if (mode === 'cr') { for (let j = 0; j < n; j++) T[j] = ownTan(pts[j]) ? { i: pts[j].i.slice(), o: pts[j].o.slice() } : crTan(pts, j); return T; }
    const brk = [0]; for (let k = 1; k < n - 1; k++) if (ownTan(pts[k])) brk.push(k); brk.push(n - 1);
    const slope = new Array(n).fill(0);
    for (let r = 0; r + 1 < brk.length; r++) {
      const a = brk[r], b = brk[r + 1], A = [], B = [], Cc = [], D = [];
      // Gleichung je Punkt: 2. Ableitung (d²v/dx²) links = rechts. Ein Nachbarsegment, das an einem Punkt mit
      // gezogener Tangente beginnt/endet, ist eine feste Bezierkurve (Griffe des Tangentenpunkts, auf unserer
      // Seite x-Griff h/3) — dessen Krümmung am gemeinsamen Punkt wird exakt angeschlossen. So läuft die Kurve
      // krümmungsstetig aus einer steilen Nasentangente heraus, statt vom Nachbarpunkt aus zurückzuschwingen.
      // Terme: Wert = cPrev·m[k-1] + c·m[k] + cNext·m[k+1] + c0.
      const L = k => {   // Krümmung am rechten Ende des Segments k-1 -> k
        const h0 = pts[k].x - pts[k - 1].x, d0 = (pts[k].v - pts[k - 1].v) / (h0 || 1e-9);
        if (k - 1 === a && ownTan(pts[a])) {
          const ax = clamp(pts[a].o[0], 0, h0), ay = pts[a].o[1], e = Math.max(h0 * 0.05, h0 - ax);
          return { cPrev: 0, c: 6 * e / (h0 * h0), cNext: 0, c0: 6 * (pts[a].v + ay - pts[k].v) / (h0 * h0) };
        }
        return { cPrev: 2 / h0, c: 4 / h0, cNext: 0, c0: -6 * d0 / h0 };
      };
      const R = k => {   // Krümmung am linken Ende des Segments k -> k+1
        const h1 = pts[k + 1].x - pts[k].x, d1 = (pts[k + 1].v - pts[k].v) / (h1 || 1e-9);
        if (k + 1 === b && ownTan(pts[b])) {
          const ix = clamp(pts[b].i[0], -h1, 0), iy = pts[b].i[1], e = Math.max(h1 * 0.05, h1 + ix);
          return { cPrev: 0, c: -6 * e / (h1 * h1), cNext: 0, c0: 6 * (pts[b].v + iy - pts[k].v) / (h1 * h1) };
        }
        return { cPrev: 0, c: -4 / h1, cNext: -2 / h1, c0: 6 * d1 / h1 };
      };
      for (let k = a; k <= b; k++) {
        let lo = 0, di = 1, up = 0, rhs = 0;
        if (k === a) { if (!ownTan(pts[k])) { const r = R(k); di = r.c; up = r.cNext; rhs = -r.c0; } }           // natürliches Ende
        else if (k === b) { if (!ownTan(pts[k])) { const l = L(k); lo = l.cPrev; di = l.c; rhs = -l.c0; } }
        else { const l = L(k), r = R(k); lo = l.cPrev; di = l.c - r.c; up = -r.cNext; rhs = r.c0 - l.c0; }
        A.push(lo); B.push(di); Cc.push(up); D.push(rhs);
      }
      const m = thomas(A, B, Cc, D);
      for (let k = a; k <= b; k++) if (!ownTan(pts[k])) slope[k] = m[k - a];
    }
    for (let j = 0; j < n; j++) {
      if (ownTan(pts[j])) { T[j] = { i: pts[j].i.slice(), o: pts[j].o.slice() }; continue; }
      const h0 = j > 0 ? pts[j].x - pts[j - 1].x : 0, h1 = j < n - 1 ? pts[j + 1].x - pts[j].x : 0, m = slope[j];
      T[j] = { i: [-h0 / 3, -m * h0 / 3], o: [h1 / 3, m * h1 / 3] };
    }
    return T;
  }
  // Bezier-Griffe eines Umrisspunkts (für Anzeige/Bearbeitung).
  function outTan(pts, j) { return autoTans(pts, splMode())[j]; }
  // B-Spline (kubisch, gleichförmig) je Lauf zwischen Ecken; Enden auf der Kurve (gespiegelte Hilfspunkte).
  function bsSegs(pts) {
    const n = pts.length, brk = [0], segs = [], st = k => k >= 0 && k < n - 1 && !!pts[k].l;
    for (let k = 1; k < n - 1; k++) if (pts[k].c === 2 || st(k) || st(k - 1)) brk.push(k);   // gerade Abschnitte = eigene Läufe
    brk.push(n - 1);
    const L = (w, ps) => [0, 1].map(c => ps.reduce((s, p, k) => s + w[k] * p[c], 0));
    // Anschluss an eine Gerade: ersten/letzten Griff des Laufs in deren Richtung drehen (Länge bleibt)
    const turn = (P, k, dir) => { const a = P[k === 1 ? 0 : 3], g = P[k], len = Math.hypot(g[0] - a[0], g[1] - a[1]), dl = Math.hypot(dir[0], dir[1]) || 1; P[k] = [a[0] + dir[0] / dl * len, a[1] + dir[1] / dl * len]; };
    for (let r = 0; r + 1 < brk.length; r++) {
      const s0 = brk[r], s1 = brk[r + 1], Q = pts.slice(s0, s1 + 1).map(p => [p.x, p.v]), m = Q.length, run = [];
      if (m === 2) { const [a, b] = Q; run.push({ x0: a[0], x1: b[0], P: [a, L([2 / 3, 1 / 3], [a, b]), L([1 / 3, 2 / 3], [a, b]), b] }); if (st(s0)) { segs.push(...run); continue; } }
      const E = m === 2 ? [] : [[2 * Q[0][0] - Q[1][0], 2 * Q[0][1] - Q[1][1]]].concat(Q, [[2 * Q[m - 1][0] - Q[m - 2][0], 2 * Q[m - 1][1] - Q[m - 2][1]]]);
      for (let j = 1; m > 2 && j < m; j++) {
        const A = E[j - 1], B = E[j], C2 = E[j + 1], D = E[j + 2];
        const b0 = L([1 / 6, 4 / 6, 1 / 6], [A, B, C2]), b1 = L([2 / 3, 1 / 3], [B, C2]), b2 = L([1 / 3, 2 / 3], [B, C2]), b3 = L([1 / 6, 4 / 6, 1 / 6], [B, C2, D]);
        run.push({ x0: b0[0], x1: b3[0], P: [b0, b1, b2, b3] });
      }
      if (st(s0 - 1) && pts[s0].c !== 2) turn(run[0].P, 1, [pts[s0].x - pts[s0 - 1].x, pts[s0].v - pts[s0 - 1].v]);
      if (st(s1) && pts[s1].c !== 2) turn(run[run.length - 1].P, 2, [pts[s1].x - pts[s1 + 1].x, pts[s1].v - pts[s1 + 1].v]);
      segs.push(...run);
    }
    return segs;
  }
  // Zusammengesetzte kubische Beziers über x (Griffe in x geklemmt -> x(t) monoton).
  function outSegs(pts, mode) {
    mode = mode || splMode();
    if (mode === 'bs') return bsSegs(pts);
    const T = autoTans(pts, mode), segs = [];
    for (let j = 0; j + 1 < pts.length; j++) {
      const a = pts[j], b = pts[j + 1], D = b.x - a.x, ta = T[j], tb = T[j + 1];
      const o = [clamp(ta.o[0], 0, D), ta.o[1]], i = [clamp(tb.i[0], -D, 0), tb.i[1]];
      segs.push({ x0: a.x, x1: b.x, P: [[a.x, a.v], [a.x + o[0], a.v + o[1]], [b.x + i[0], b.v + i[1]], [b.x, b.v]] });
    }
    return segs;
  }
  // Krümmung längs einer Bezier-Kette: [{x, v, k, n:[nx,nv]}] (k > 0 = Linkskurve in x/v).
  function curvSamples(segs, N) {
    const out = [];
    for (const sg of segs) {
      const P = sg.P;
      for (let q = (out.length ? 1 : 0); q <= N; q++) {
        const t = q / N, u = 1 - t, p = bez2(P, t);
        const d1 = [0, 1].map(c => 3 * ((P[1][c] - P[0][c]) * u * u + 2 * (P[2][c] - P[1][c]) * u * t + (P[3][c] - P[2][c]) * t * t));
        const d2 = [0, 1].map(c => 6 * ((P[2][c] - 2 * P[1][c] + P[0][c]) * u + (P[3][c] - 2 * P[2][c] + P[1][c]) * t));
        const Ld = Math.hypot(d1[0], d1[1]);
        if (Ld < 1e-9) continue;
        out.push({ x: p[0], v: p[1], k: (d1[0] * d2[1] - d1[1] * d2[0]) / (Ld * Ld * Ld), n: [-d1[1] / Ld, d1[0] / Ld] });
      }
    }
    return out;
  }
  // Wendepunkte (Vorzeichenwechsel der Krümmung, winzige Krümmungen ausgenommen) und kleinster Radius.
  function curvStats(S) {
    let kmax = 0; for (const s of S) kmax = Math.max(kmax, Math.abs(s.k));
    const eps = 2e-5 + kmax * 0.002, infl = []; let last = 0;   // absolut: 1/R < 1/50 m zählt als gerade
    for (const s of S) { const sg = s.k > eps ? 1 : s.k < -eps ? -1 : 0; if (sg && last && sg !== last) infl.push(s); if (sg) last = sg; }
    return { kmax, rmin: kmax > 1e-9 ? 1 / kmax : Infinity, infl };
  }
  // Nase abrunden: Anfangspunkt jeder Linie bekommt eine senkrechte Tangente. Länge wie beim Kegelschnitt:
  // Eckpunkt C = Schnitt der Senkrechten mit der Geraden durch Punkt 2 in Richtung der folgenden Sehne,
  // Griff = KAPPA · |C − Anfangspunkt|. Damit läuft die Nase ohne Wendepunkt in den Rumpf.
  function roundNoseOut(o) {
    for (const k of LINES) {
      const P = o[k]; if (P.length < 2) continue;
      const p = P[0], q = P[1], r = P[2];
      const s = r ? (r.v - q.v) / ((r.x - q.x) || 1e-9) : 0, cy = q.v - s * (q.x - p.x);
      let L = KAPPA * (cy - p.v);
      if (Math.sign(L) !== Math.sign(q.v - p.v) || Math.abs(L) < 1e-6) L = 0.3 * (q.v - p.v);   // Sehne kippt: kurzer Griff
      p.c = 1; p.i = [0, 0]; p.o = [0, r2(L)];
    }
  }
  function roundNose() { roundNoseOut(outlines()); }
  // Linie glätten (Fairing): die glatten Punkte (c 0) werden verschoben (Koordinatenabstieg, Schritt halbiert,
  // je Punkt höchstens tol mm) — bewertet zuerst nach der Zahl der Wendepunkte (darf nie steigen), dann nach der
  // Krümmungsänderung Σ(Δk)²/Δs, normiert auf die typische Krümmung (sonst zählt nur die stark gekrümmte Nase).
  // Linienenden, Punkte mit Tangente und Ecken bleiben stehen.
  function fairScore(pts) {
    const S = curvSamples(outSegs(pts), 16), st = curvStats(S), kr = Math.max(1e-6, kRob(S)); let e = 0;
    for (let i = 1; i < S.length; i++) {
      const ds = Math.hypot(S[i].x - S[i - 1].x, S[i].v - S[i - 1].v) || 1e-6, dk = clamp(S[i].k, -3 * kr, 3 * kr) - clamp(S[i - 1].k, -3 * kr, 3 * kr);
      e += dk * dk / ds;
    }
    return [st.infl.length, e / (kr * kr)];
  }
  const better = (p, q) => p[0] < q[0] || (p[0] === q[0] && p[1] < q[1] * (1 - 1e-9));
  function fairLine(line, tol) {
    const pts = outlines()[line], n = pts.length, v0 = pts.map(p => p.v), free = [];
    for (let k = 1; k < n - 1; k++) if (!pts[k].c) free.push(k);
    if (!free.length) return;
    let E = fairScore(pts), step = Math.max(0.05, tol / 2);
    for (let it = 0; it < 60 && step > 0.01; it++) {
      let moved = false;
      for (const k of free) for (const d of [step, -step]) {
        const old = pts[k].v; let nv = clamp(old + d, v0[k] - tol, v0[k] + tol);
        if (line === 'w') nv = Math.max(0, nv);
        if (nv === old) continue;
        pts[k].v = nv; const e = fairScore(pts);
        if (better(e, E)) { E = e; moved = true; break; } else pts[k].v = old;
      }
      if (!moved) step /= 2;
    }
    for (const p of pts) p.v = r2(p.v);
  }
  function normPt(p) {
    p.x = +p.x || 0; p.v = +p.v || 0; p.c = (p.c === 1 || p.c === 2) ? p.c : 0;
    if (!p.c) { delete p.i; delete p.o; }
    else { if (!Array.isArray(p.i)) p.i = [0, 0]; if (!Array.isArray(p.o)) p.o = [0, 0]; }
    if (p.l) p.l = true; else delete p.l;   // Abschnitt bis zum nächsten Punkt gerade
    return p;
  }
  function outlines() {
    let o = state.cfg.rproOut;
    if (!o || !LINES.every(k => Array.isArray(o[k]) && o[k].length >= 2)) { applyTemplate('segler'); o = state.cfg.rproOut; }
    for (const k of LINES) { o[k].forEach(normPt); o[k].sort((a, b) => a.x - b.x); }
    o.w.forEach(p => { p.v = Math.max(0, p.v); });
    // gemeinsamer Anfang/Ende (DevFus: Umrisse laufen zwischen Nasen- und Heckpunkt)
    const x0 = Math.min(...LINES.map(k => o[k][0].x)), x1 = Math.max(...LINES.map(k => o[k][o[k].length - 1].x));
    for (const k of LINES) { o[k][0].x = x0; o[k][o[k].length - 1].x = x1; delete o[k][o[k].length - 1].l; }
    return o;
  }
  // ---- Kopplung Umrisse <-> Spanten ------------------------------------------------------
  // Ein Umrisspunkt gehört zu einem Spant, wenn er auf dessen X liegt. Spant und Punkt bewegen sich dann
  // gemeinsam (außer der Spant ist in X fixiert), und Änderungen in der Spantansicht schreiben die Umrisse.
  const ONX = 0.25;
  const boundFr = x => (state.cfg.rproFr || []).filter(f => f && Math.abs(f.x - x) < ONX);
  // Umriss `line` so ändern, dass er bei x genau `target` hat: Punkt bei x suchen oder auf der Kurve einfügen,
  // dann seinen Wert korrigieren (alle Spline-Arten hängen linear vom Punktwert ab -> ein Sekantenschritt genügt).
  function setOutAt(line, x, target) {
    const o = state.cfg.rproOut, pts = o && o[line]; if (!pts || pts.length < 2 || lineLocked(line)) return;
    if (line === 'w') target = Math.max(0, target);
    if (x < pts[0].x - ONX || x > pts[pts.length - 1].x + ONX) return;
    let k = pts.findIndex(p => Math.abs(p.x - x) < ONX);
    if (k < 0 && Math.abs(target - lineAt(outSegs(pts), x)) < 0.005) return;   // stimmt schon: keinen Punkt einfügen
    if (k < 0) {
      let j = -1; for (let q = 0; q + 1 < pts.length; q++) if (x > pts[q].x + 0.5 && x < pts[q + 1].x - 0.5) j = q;
      if (j < 0) return;
      pts.splice(j + 1, 0, Object.assign({ x: r2(x), v: r2(lineAt(outSegs(pts), x)), c: 0 }, pts[j].l ? { l: true } : {})); k = j + 1;
    }
    const p = pts[k], v0 = p.v, c0 = lineAt(outSegs(pts), x);
    if (Math.abs(target - c0) < 0.005) return;
    p.v = v0 + 1; const d = lineAt(outSegs(pts), x) - c0;
    p.v = Math.abs(d) > 1e-4 ? v0 + (target - c0) / d : target;
    if (line === 'w') p.v = Math.max(0, p.v);
    p.v = Math.round(p.v * 1000) / 1000;
  }
  // Kreis-Spanten: Ober-/Unterkante und Breite an ihrem X auf den Kreis ziehen, damit Seiten- und Draufsicht
  // zusammenpassen. edit = { line, x } des gerade gezogenen Werts: der gibt den Durchmesser vor.
  function syncCircleOutlines(edit) {
    const o = state.cfg.rproOut, fr = state.cfg.rproFr;
    if (!o || !Array.isArray(fr)) return;
    const val = (k, x) => lineAt(outSegs(o[k]), x);
    for (const f of fr) {
      if (!f || f.type !== 'circle') continue;
      const x = f.x; if (x < o.top[0].x - ONX || x > o.top[o.top.length - 1].x + ONX) continue;
      const top = val('top', x), bot = val('bot', x), w = val('w', x), fix = f.p && +f.p.dia > 0;
      const ed = edit && Math.abs(edit.x - x) < ONX ? edit.line : null;
      let D, c = (top + bot) / 2;
      if (ed === 'w') { D = 2 * w; if (fix) f.p.dia = r1(D); }
      else if (fix) { D = +f.p.dia; if (ed === 'top') c = top - D / 2; else if (ed === 'bot') c = bot + D / 2; }
      else if (ed) D = top - bot;
      else D = (top - bot + 2 * w) / 2;
      if (!(D > 0)) continue;
      if (Math.abs(top - (c + D / 2)) > 0.005) setOutAt('top', x, c + D / 2);
      if (Math.abs(bot - (c - D / 2)) > 0.005) setOutAt('bot', x, c - D / 2);
      if (Math.abs(w - D / 2) > 0.005) setOutAt('w', x, D / 2);
    }
  }
  // Spant in X verschieben; Umrisspunkte auf seinem X wandern mit (auch Nase/Heck: Rumpflänge ändert sich).
  function moveFormerX(f, nx, keepTips) {
    const p = jumpPartner(f);
    if (!p) return moveOneX(f, nx, keepTips);
    // Sprungstelle: beide Spanten wandern gemeinsam (der vorauslaufende zuerst, sonst klemmen die Umrisspunkte)
    const A = f.jmp === 'a' ? f : p, B = f.jmp === 'a' ? p : f, xa = f.jmp === 'a' ? nx : nx - JG;
    if (xa > A.x) { moveOneX(B, xa + JG); moveOneX(A, xa); } else { moveOneX(A, xa); moveOneX(B, xa + JG); }
  }
  function moveOneX(f, nx, keepTips) {
    if (pinned(f)) return;
    const o = outlines(), old = f.x;
    keepTips = keepTips || anyLineLocked();   // fixierte Linie: Nase/Heck bleiben für alle Linien
    for (const k of LINES) {
      if (lineLocked(k)) continue;   // fixierte Ansicht: ihre Punkte bleiben stehen
      const pts = o[k], n = pts.length;
      for (let q = 1; q + 1 < n; q++) if (Math.abs(pts[q].x - old) < ONX) pts[q].x = r2(clamp(nx, pts[q - 1].x + 0.5, pts[q + 1].x - 0.5));
      // Spant auf Nase bzw. Heck: die Spitze wandert mit (Rumpflänge ändert sich)
      if (keepTips) continue;
      if (Math.abs(pts[0].x - old) < ONX) pts[0].x = r2(Math.min(nx, pts[1].x - 0.5));
      if (Math.abs(pts[n - 1].x - old) < ONX) pts[n - 1].x = r2(Math.max(nx, pts[n - 2].x + 0.5));
    }
    f.x = nx;
  }
  // ---- Sprungstellen (unstetiger Rumpf) ---------------------------------------------------
  // An einer Sprungstelle stehen zwei Spanten JG mm hintereinander: der vordere (jmp 'a') schließt das vordere
  // Segment ab, der hintere (jmp 'b') beginnt das hintere — z. B. Lufteinlauf, Haubenabsatz, Rumpfhöcker.
  // Beide gehören zusammen (jid), wandern gemeinsam, beenden/beginnen je einen eigenen Lauf (immer Steuerspant),
  // und die Umrisse haben an beiden einen Eckpunkt, damit Ober-/Unterkante und Breite ebenfalls springen können.
  const JG = 1;
  function jumpPartner(f) {
    if (!f || !f.jmp) return null;
    return (state.cfg.rproFr || []).find(q => q && q !== f && q.jid === f.jid && q.jmp && q.jmp !== f.jmp) || null;
  }
  // Umrisspunkte an der Sprungstelle: Eckpunkte bei xa und xa + JG, Kurve davor/dahinter bleibt wie sie war.
  function jumpPts(xa) {
    const o = outlines(), mode = splMode();
    for (const line of LINES) {
      const pts = o[line], xs = [xa, xa + JG], vals = xs.map(x => lineAt(outSegs(pts), x));
      xs.forEach((x, q) => setOutAt(line, x, vals[q]));
      const ks = xs.map(x => pts.findIndex(p => Math.abs(p.x - x) < ONX));
      if (ks[0] < 0 || ks[1] < 0 || ks[0] === ks[1]) continue;
      const Tn = autoTans(pts, mode);
      ks.forEach((k, q) => {
        const p = pts[k]; if (k === 0 || k === pts.length - 1) return;
        if (!p.c) { p.i = Tn[k].i.slice(); p.o = Tn[k].o.slice(); }
        p.c = 2; p.v = r2(vals[q]);
        if (q === 0) p.o = [0, 0]; else p.i = [0, 0];
      });
    }
  }
  // Spant i zur Sprungstelle machen: Kopie JG mm dahinter als Anfang des hinteren Segments.
  function makeJump(i) {
    const fr = formers(); sortFormers();
    if (!model || !model.P || model.FR.length !== fr.length) build();
    const f = fr[i]; if (!f || f.jmp) return false;
    const o = outlines(), x0 = o.top[0].x, x1 = o.top[o.top.length - 1].x, nx = fr[i + 1];
    if (f.x < x0 + 1 || f.x + JG > x1 - 1 || (nx && nx.x < f.x + JG + 0.5)) { alert(T('Hier ist kein Platz für eine Sprungstelle (zu nah an Nase, Heck oder am nächsten Spant).')); return false; }
    if (model.P && model.P[i]) f.p = Object.assign({}, f.p, model.P[i]);   // interpolierte Werte festschreiben
    if (f.type === 'free' && model.FN && model.FN[i]) f.nodes = JSON.parse(JSON.stringify(model.FN[i]));
    const g = JSON.parse(JSON.stringify(f));
    f.jid = g.jid = Date.now(); f.jmp = 'a'; g.jmp = 'b'; g.x = f.x + JG; g.xfix = f.xfix;
    jumpPts(f.x);
    fr.splice(i + 1, 0, normFr(g)); S('rproSel', i + 1); lastSel = 'fr';
    return true;
  }
  // Sprungstelle auflösen: beide Spanten bleiben als gewöhnliche Spanten stehen.
  function clearJump(f) { const p = jumpPartner(f); for (const q of [f, p]) if (q) { delete q.jmp; delete q.jid; } }
  // ---- Fixieren ----------------------------------------------------------------------------
  // Draufsicht, Seitenansicht, Dickenlinie und Spanten (einzeln f.pin oder alle) lassen sich fixieren: beim Einschalten wird
  // der Stand festgehalten und in build() gegen jede Änderung durchgesetzt — egal ob sie vom Spant (Spantansicht, Kreis-
  // Abgleich, freie Knoten), von einer anderen Ansicht oder aus der Seitenleiste kommt. Die Kopplungsstellen (setOutAt,
  // moveOneX, Griffe) fragen die Sperren zusätzlich ab, damit nichts erst geändert und dann zurückgesetzt wird.
  const FIXK = () => state.cfg.rproFix || {};
  const lineLocked = k => { const F = FIXK(); return k === 'w' ? !!F.top : !!F.side; };
  const anyLineLocked = () => LINES.some(lineLocked);
  const pinned = f => !!f && (!!f.pin || !!FIXK().fr);
  const xFixed = f => !!f && (!!f.xfix || pinned(f));
  const shapeKey = f => JSON.stringify([f.type, f.p, f.ctl, f.mode, f.nodes || null, !!f.lock]);
  // Stand eines Spants festhalten: Lage, Form und der Umriss-Kasten (Ober-/Unterkante, Breite) an seinem X.
  // full: interpolierte Parameter festschreiben (Steuerspant), damit die Form nicht mehr an den Nachbarn hängt.
  function snapFormer(f, full) {
    const o = state.cfg.rproOut;
    if (full && model && model.P && model.FR) {
      const j = model.FR.indexOf(f);
      if (j >= 0 && model.P[j] && f.type !== 'free' && f.type !== 'circle') { f.p = Object.assign({}, f.p, model.P[j]); for (const g of PGROUPS[f.type]) f.ctl[g] = true; }
    }
    const val = k => lineAt(outSegs(o[k]), f.x);
    f.pinBox = { x: f.x, top: val('top'), bot: val('bot'), w: Math.max(0, val('w')), f: shapeKey(f) };
  }
  function pinFormer(f, on) {
    if (on) { build(); snapFormer(f, true); f.pin = true; }
    else { f.pin = false; if (!FIXK().fr) delete f.pinBox; }
  }
  // Dickenlinie festhalten: Y der breitesten Stelle an jedem Ei-/Dreieck-Spant und dazwischen (wie interpoliert).
  function widSnap() {
    build(); const m = model, out = [];
    if (!m || !m.P || !m.run) return out;
    const FR = m.FR, ok = j => FR[j].type === 'egg' || FR[j].type === 'tri';
    for (let j = 0; j < FR.length; j++) {
      if (!ok(j)) continue;
      out.push([FR[j].x, m.P[j].yw]);
      if (j + 1 < FR.length && FR[j + 1].type === FR[j].type && m.run[j] === m.run[j + 1])
        for (let s = 1; s < 12; s++) { const x = FR[j].x + (FR[j + 1].x - FR[j].x) * s / 12; out.push([x, paramsAt(m, x, m.run[j]).yw]); }
    }
    return out.filter(q => isFinite(q[1])).map(q => [r2(q[0]), Math.round(q[1] * 1000) / 1000]);
  }
  // Y der fixierten Dickenlinie bei x (null = nicht fixiert / außerhalb).
  function widAt(x) {
    const F = FIXK(), a = F.wid && F.wsnap; if (!a || !a.length) return null;
    if (x < a[0][0] - 0.5 || x > a[a.length - 1][0] + 0.5) return null;
    if (x <= a[0][0]) return a[0][1];
    for (let i = 0; i + 1 < a.length; i++) if (x <= a[i + 1][0]) { const d = a[i + 1][0] - a[i][0]; return d > 1e-9 ? a[i][1] + (a[i + 1][1] - a[i][1]) * (x - a[i][0]) / d : a[i][1]; }
    return a[a.length - 1][1];
  }
  function setFix(key, on) {
    const F = C('rproFix'); on = !!on;
    if (key === 'top' || key === 'side') {
      const o = outlines(); F.snap = F.snap || {};
      if (on && !anyLineLocked()) F.snap.spl = splMode();   // Spline-Art gilt für alle Linien
      F[key] = on;
      for (const k of key === 'top' ? ['w'] : ['top', 'bot']) { if (on) F.snap[k] = JSON.parse(JSON.stringify(o[k])); else delete F.snap[k]; }
      if (!anyLineLocked()) delete F.snap;
    } else if (key === 'wid') {
      if (on) { F.wid = false; F.wsnap = widSnap(); F.wid = true; }
      else {
        // Lösen: fixierte Werte in die Steuerspanten schreiben, damit nichts springt
        build();
        if (model && model.P) model.FR.forEach((f, j) => { if ((f.type === 'egg' || f.type === 'tri') && isCtl(model, j, 'yw') && !pinned(f)) f.p.yw = r2(model.P[j].yw); });
        F.wid = false; delete F.wsnap;
      }
    } else if (key === 'fr') {
      if (on) { build(); formers().forEach(f => { if (!f.pin) snapFormer(f, true); }); F.fr = true; }
      else { F.fr = false; formers().forEach(f => { if (!f.pin) delete f.pinBox; }); }
    }
  }
  // In build(): festgehaltene Stände durchsetzen.
  function enforceFix() {
    const F = state.cfg.rproFix, o = state.cfg.rproOut; if (!F || !o) return;
    const sn = F.snap || {};
    let lk = null;
    for (const k of LINES) {
      if (!lineLocked(k) || !Array.isArray(sn[k]) || sn[k].length < 2) continue;
      lk = lk || k;
      if (JSON.stringify(o[k]) !== JSON.stringify(sn[k])) o[k] = JSON.parse(JSON.stringify(sn[k]));
    }
    if (lk) {
      if (sn.spl && splMode() !== sn.spl) o.spl = sn.spl;
      const a = o[lk][0].x, b = o[lk][o[lk].length - 1].x;   // Nase/Heck der fixierten Linie gelten für alle
      for (const k of LINES) { const p = o[k]; p[0].x = a; p[p.length - 1].x = b; }
    }
    const fr = state.cfg.rproFr || [];
    for (const f of fr) {
      if (!pinned(f)) continue;
      if (!f.pinBox) { snapFormer(f, false); continue; }   // neu hinzugekommen, während „alle Spanten" fixiert sind
      const pb = f.pinBox;
      if (Math.abs(f.x - pb.x) > 1e-9) f.x = pb.x;
      if (shapeKey(f) !== pb.f) { const s = JSON.parse(pb.f); f.type = s[0]; f.p = s[1]; f.ctl = s[2]; f.mode = s[3]; if (s[4]) f.nodes = s[4]; else delete f.nodes; f.lock = s[5]; }
    }
    // Umriss-Kasten der fixierten Spanten halten (C2-Splines wirken über Nachbarpunkte -> wenige Durchgänge)
    for (let it = 0; it < 4; it++) {
      let ch = false;
      for (const f of fr) {
        const pb = pinned(f) && f.pinBox; if (!pb) continue;
        for (const k of LINES) if (!lineLocked(k) && Math.abs(lineAt(outSegs(o[k]), pb.x) - pb[k]) > 0.005) { setOutAt(k, pb.x, pb[k]); ch = true; }
      }
      if (!ch) break;
    }
  }
  // Wert eines Umrisses bei x.
  function outAt(line, x) { const o = outlines(); return lineAt(outSegs(o[line]), x); }

  // ---- Spanten -------------------------------------------------------------------------
  function normFr(f) {
    f.x = +f.x || 0;
    if (!PGROUPS[f.type]) f.type = 'egg';
    f.p = Object.assign({}, PDEF, f.p || {});
    f.ctl = Object.assign({}, f.ctl || {});
    f.mode = Object.assign({}, MDEF, f.mode || {});
    for (const g in f.mode) if (PMODES[g] && PMODES[g].indexOf(f.mode[g]) < 0) f.mode[g] = PMODES[g][0];
    if (f.type === 'free' && (!Array.isArray(f.nodes) || f.nodes.length < 2)) f.nodes = circleNodes(0.5);
    f.lock = !!f.lock; f.xfix = !!f.xfix;
    return f;
  }
  function formers() {
    let a = state.cfg.rproFr;
    if (!Array.isArray(a) || !a.length) { applyTemplate('segler'); a = state.cfg.rproFr; }
    a.forEach(normFr);
    for (const f of a) if (f.jmp && !((f.jmp === 'a' || f.jmp === 'b') && jumpPartner(f))) { delete f.jmp; delete f.jid; }   // verwaiste Sprungstelle
    return a;
  }
  function sortFormers() { const a = formers(), cur = a[selIdx()]; a.sort((p, q) => p.x - q.x); S('rproSel', Math.max(0, a.indexOf(cur))); }

  // ---- Vorlagen / Übernahme aus dem Reiter „Rumpf" ----------------------------------------
  // Stationen (Datenmodell des früheren rumpf.js, nur noch für Altprojekte) -> Umrisse + Spanten, formgleich (Tangenten werden übernommen).
  function fromStations(sts) {
    sts = sts.map(s => norm(JSON.parse(JSON.stringify(s)))).sort((a, b) => a.x - b.x);
    const out = {};
    for (const key of LINES) out[key] = sts.map((s, j) => {
      const t = tanOf(sts, j, key), v = lval(s, key);
      if (!t.explicit && !(s.fix === 'circle' && key === 'w')) return { x: s.x, v, c: 0 };
      const li = Math.hypot(t.i[0], t.i[1]), lo = Math.hypot(t.o[0], t.o[1]), cr = t.i[0] * t.o[1] - t.i[1] * t.o[0];
      const col = li < 1e-9 || lo < 1e-9 || (Math.abs(cr) <= 1e-6 * li * lo && t.i[0] * t.o[0] + t.i[1] * t.o[1] <= 0);
      return { x: s.x, v, c: col ? 1 : 2, i: t.i, o: t.o };
    });
    // „Kreis“ nur, wenn die Station wirklich rund ist (im Reiter „Rumpf“ hält enforceFix das ein)
    sts.forEach(s => { if (s.fix === 'circle' && Math.abs(s.w - (s.top - s.bot) / 2) > 0.01) s.fix = ''; });
    out.spl = 'cr';
    const fr = sts.map(s => s.fix === 'circle' ? { x: s.x, type: 'circle', p: { dia: 0 }, ctl: { dia: true } }
      : { x: s.x, type: 'free', nodes: s.nodes, lock: s.fix === 'lock' });
    return { out, fr };
  }
  // Freie Spanten, die genau Kreisbögen sind, als Ei-Spant (Parameter yw) übernehmen.
  function freeToEgg(r) {
    const o = r.out, key = nd => JSON.stringify(nd.map(q => [q.y, q.z, q.i[0], q.i[1], q.o[0], q.o[1]].map(v => Math.round(v * 1e4))));
    r.fr.forEach(f => {
      if (f.type !== 'free' || f.nodes.length !== 3) return;
      const m = f.nodes[1].y;
      if (key(circleNodes(m)) !== key(f.nodes)) return;
      const top = lineAt(outSegs(o.top, splMode(o)), f.x), bot = lineAt(outSegs(o.bot, splMode(o)), f.x);
      f.type = 'egg'; f.p = { yw: r2(bot + m * (top - bot)) }; f.ctl = { yw: true }; delete f.nodes;
    });
    return r;
  }
  function applyTemplate(name) {
    delete state.cfg.rproMeshFrame;
    let r;
    if (name === 'motor') {
      // Kastenrumpf (DevFus-typisch): Spinner-Kreis vorne, dann abgerundete Rechtecke/Trapeze
      r = fromStations(TPL.motor()); r.out.spl = 'c2'; roundNoseOut(r.out);
      const L = { top: outSegs(r.out.top, 'c2'), bot: outSegs(r.out.bot, 'c2'), w: outSegs(r.out.w, 'c2') }, n = r.fr.length;
      r.fr = r.fr.map((f, j) => {
        if (j === 0) return { x: f.x, type: 'circle', p: { dia: 0 }, ctl: { dia: true } };
        const h = lineAt(L.top, f.x) - lineAt(L.bot, f.x), w = Math.max(0, lineAt(L.w, f.x)), R = Math.min(w, h / 2);
        const ends = j === 1 || j === n - 1;   // Steuerspanten vorne/hinten, dazwischen proportional interpoliert
        return { x: f.x, type: 'rect', p: { rtx: r1(0.45 * R), rty: r1(0.45 * R), rbx: r1(0.25 * R), rby: r1(0.25 * R), sl: j === 1 ? 0 : 4 },
          ctl: ends ? { rt: true, rb: true, sl: true } : {}, mode: { rt: 'prop', rb: 'prop' } };
      });
    } else if (name === 'rumpf' && Array.isArray(state.cfg.rumpfSt) && state.cfg.rumpfSt.length >= 2) {
      r = fromStations(state.cfg.rumpfSt);   // formgleich: freie Spanten bleiben frei, Catmull-Rom wie im früheren Reiter
    } else { r = fromStations(TPL.segler()); r.out.spl = 'c2'; roundNoseOut(r.out); freeToEgg(r); }
    state.cfg.rproOut = r.out; state.cfg.rproFr = r.fr.map(normFr); state.cfg.rproSel = 0; state.cfg.rproPt = null;
    state.cfg.rproFix = JSON.parse(JSON.stringify(DEF.rproFix));   // neuer Rumpf: Fixierungen gelten nicht mehr
  }
  // ---- Übernahme aus einem 3D-Netz (Reiter „3D-Bearbeitung") ------------------------------
  // Das Netz wird in X-Ebenen geschnitten: je Station Ober-/Unterkante, halbe Breite und Höhe der breitesten Stelle
  // (Dickenlinie); daraus Umrisse (C2-Splines, Punkte so lange eingefügt, bis die Toleranz passt) und Spanten
  // (freie Knoten, ebenso eingepasst, oder Ei mit gemessener Dickenlinie). Alles danach normal bearbeitbar.
  // Ebenenschnitt längs Achse ax: Strecken [a1,b1,a2,b2,…] in den beiden anderen Achsen (aufsteigende Reihenfolge).
  function sliceSoup(V, ax, s) {
    const a = (ax + 1) % 3, b = (ax + 2) % 3, A = Math.min(a, b), B = Math.max(a, b), out = [], P = [];
    for (let t = 0; t + 8 < V.length; t += 9) {
      const d0 = V[t + ax] - s, d1 = V[t + 3 + ax] - s, d2 = V[t + 6 + ax] - s;
      if ((d0 < 0 && d1 < 0 && d2 < 0) || (d0 >= 0 && d1 >= 0 && d2 >= 0)) continue;
      P.length = 0; const d = [d0, d1, d2];
      for (let k = 0; k < 3; k++) {
        const m = (k + 1) % 3, p = d[k], q = d[m]; if ((p < 0) === (q < 0)) continue;
        const u = p / (p - q), o = t + k * 3, r = t + m * 3;
        P.push(V[o + A] + (V[r + A] - V[o + A]) * u, V[o + B] + (V[r + B] - V[o + B]) * u);
      }
      if (P.length === 4) out.push(P[0], P[1], P[2], P[3]);
    }
    return out;
  }
  // größtes |Z| der Schnittstrecken auf Höhe y
  function segZ(seg, y) {
    let z = 0;
    for (let i = 0; i < seg.length; i += 4) {
      const ya = seg[i], yb = seg[i + 2]; if ((ya < y) === (yb < y) || ya === yb) continue;
      const zz = Math.abs(seg[i + 1] + (seg[i + 3] - seg[i + 1]) * (y - ya) / (yb - ya)); if (zz > z) z = zz;
    }
    return z;
  }
  // Hohlraum einer Form auf Höhe y: von der Symmetrieebene aus erste Wand (Z > 0), sofern dort Luft ist
  // (gerade Zahl Wanddurchgänge bei Z < 0). 0 = kein Hohlraum.
  function cavZ(seg, y) {
    let neg = 0, zc = Infinity;
    for (let i = 0; i < seg.length; i += 4) {
      const ya = seg[i], yb = seg[i + 2]; if ((ya < y) === (yb < y) || ya === yb) continue;
      const z = seg[i + 1] + (seg[i + 3] - seg[i + 1]) * (y - ya) / (yb - ya);
      if (z < 0) neg++; else if (z < zc) zc = z;
    }
    return neg % 2 === 0 && isFinite(zc) ? zc : 0;
  }
  // Haubenkante: erster Absatz oberhalb der breitesten Stelle (Kontur springt ≥ 1,5 mm auf 1 mm nach innen, deutlich
  // steiler als davor). Die innere Stufe (Auflage/Plateau fürs Abformen) liegt darüber und wird nicht beachtet. → y | null
  function canopyEdge(seg) {
    if (seg.length < 4) return null;
    let y0 = Infinity, y1 = -Infinity, zw = 0, yw = 0;
    for (let i = 0; i < seg.length; i += 2) { const y = seg[i], z = Math.abs(seg[i + 1]); if (y < y0) y0 = y; if (y > y1) y1 = y; if (z > zw) { zw = z; yw = y; } }
    const dy = 0.5, M = Math.ceil((y1 - yw) / dy), Z = [];
    for (let i = 0; i <= M; i++) Z.push(segZ(seg, yw + dy * i));
    for (let i = 6; i + 2 <= M; i++) {
      const z = Z[i], drop = z - Z[i + 2], prev = (Z[i - 6] - z) / (6 * dy);
      if (drop >= Math.max(1.5, 0.03 * z) && drop > 3 * prev * 2 * dy && z > 3) return yw + dy * i;
    }
    return null;
  }
  // Haubenlinie (Seitenansicht) als freier Linienzug: Spline-Abschnitte (quadratisch durch den Wölbungspunkt), Punkte an
  // der größten Abweichung eingefügt, bis tol passt. E = [[x, y]] von der Oberkante zur Oberkante.
  function fitKhLine(E, tol, maxN) {
    const idx = [0, E.length - 1];
    const segOf = (a, b) => {
      const A = E[a], B = E[b], d = [B[0] - A[0], B[1] - A[1]], L2 = d[0] * d[0] + d[1] * d[1] || 1e-12, L = Math.sqrt(L2), n = [d[1] / L, -d[0] / L];
      let bi = -1, bd = Infinity;
      for (let i = a + 1; i < b; i++) { const t = ((E[i][0] - A[0]) * d[0] + (E[i][1] - A[1]) * d[1]) / L2; if (Math.abs(t - 0.5) < bd) { bd = Math.abs(t - 0.5); bi = i; } }
      const q = [A[0] + d[0] / 2, A[1] + d[1] / 2], bulge = bi < 0 ? 0 : (E[bi][0] - q[0]) * n[0] + (E[bi][1] - q[1]) * n[1];
      return { bulge, pts: khCurve(A, B, 'spline', bulge, 50).pts };
    };
    for (;;) {
      let worst = 0, wi = -1; const S = [];
      for (let j = 0; j + 1 < idx.length; j++) {
        const sg = segOf(idx[j], idx[j + 1]); S.push(sg);
        for (let i = idx[j] + 1; i < idx[j + 1]; i++) {
          let dm = Infinity;
          for (let q = 0; q + 1 < sg.pts.length; q++) {
            const a = sg.pts[q], b = sg.pts[q + 1], ux = b[0] - a[0], uy = b[1] - a[1], l2 = ux * ux + uy * uy || 1e-12;
            const t = clamp(((E[i][0] - a[0]) * ux + (E[i][1] - a[1]) * uy) / l2, 0, 1);
            dm = Math.min(dm, Math.hypot(a[0] + ux * t - E[i][0], a[1] + uy * t - E[i][1]));
          }
          if (dm > worst) { worst = dm; wi = i; }
        }
      }
      if (worst <= tol || wi < 0 || idx.length >= maxN) {
        const pts = idx.map((i, j) => ({ x: r1(E[i][0]), y: r1(E[i][1]), r: 0, t: j + 1 < idx.length ? 'spline' : 'line', curv: j + 1 < idx.length ? r2(S[j].bulge) : 0, pos: 50 }));
        return { pts, err: worst };
      }
      idx.push(wi); idx.sort((a, b) => a - b);
    }
  }
  // Halbschnitt einer Station (Y hoch, Z seitlich um die Symmetrieebene): Waagrechte Linien (cos-verteilt, an Ober-
  // und Unterkante dichter) liefern je Höhe die größte |Z| -> Kontur oben -> unten.
  // o.fin: Seitenleitwerk abtrennen; o.canopy: Kabinenhaube nicht berücksichtigen (am Haubenabsatz abschneiden).
  function meshStation(seg, o) {
    if (typeof o !== 'object' || !o) o = { fin: !!o };
    if (seg.length < 4) return null;
    let y0 = Infinity, y1 = -Infinity, zw = 0, yw = 0;
    for (let i = 0; i < seg.length; i += 2) { const y = seg[i], z = Math.abs(seg[i + 1]); if (y < y0) y0 = y; if (y > y1) y1 = y; if (z > zw) { zw = z; yw = y; } }
    let h = y1 - y0; if (!(h > 1e-6) || !(zw > 1e-6)) return null;
    let zAt = y => segZ(seg, y);
    let moldUsed = false;
    const molds = o.mold ? (Array.isArray(o.mold) ? o.mold : [o.mold]).filter(q => q && q.length >= 4) : [];
    if (molds.length) {
      // Haubenform (Laminierform des Tiefziehklotzes, schon um die Haubenstärke versetzt): ihre Innenseite ist die Haube.
      // Nur wo der Rumpf offen ist (Hohlraum-Oberkante deutlich über der Rumpf-Oberkante) — davor/dahinter bleibt der Rumpf.
      // je Formkörper getrennt (Formhälften überlappen an der Fuge — doppelte Wände stören das Zählen), größter Hohlraum gilt
      const gap = 1.5 * Math.max(0, +o.glass || 0) + 0.5, cavAll = y => { let c = 0; for (const q of molds) c = Math.max(c, cavZ(q, y)); return c; };
      let my1 = -Infinity; for (const ms of molds) for (let i = 0; i < ms.length; i += 2) my1 = Math.max(my1, ms[i]);
      // Hohlraumdecke von oben her (knapp unter der Formoberkante beginnen — genau dort zählt der Rand falsch; an einer
      // schrägen Teilungsfuge der Formhälften fehlt für einen Augenblick jede Wand, deshalb bis 3 mm darunter mitprüfen)
      let yc = null; for (let y = my1 - 0.5; y > y1; y -= 0.5) if (cavAll(y) > 0 && (cavAll(y - 1) > 0 || cavAll(y - 2) > 0 || cavAll(y - 3) > 0)) { yc = y; break; }
      if (yc != null) {
        let lo = yc, hi = yc + 0.5; for (let q = 0; q < 20; q++) { const mid = (lo + hi) / 2; if (cavAll(mid) > 0) lo = mid; else hi = mid; }
        yc = lo;
      }
      if (yc != null && yc > y1 + gap) {
        const zF = zAt; zAt = y => { const f = zF(y), c = cavAll(y); return c > f + gap ? c : f; };
        y1 = yc; h = y1 - y0; moldUsed = true;
      }
    }
    let wingCut = false;
    if (o.wing) {
      // Tragflächenanschluss: Wurzelrippe = ebene Fläche parallel zur Symmetrieebene -> Band konstanter größter Breite
      // (höchstens 35 % der Höhe) mit Absatz an mindestens einer Seite. Band samt Absatz tangential überbrücken.
      const dy = Math.min(0.5, h / 400), M = Math.ceil(h / dy), Z = new Float64Array(M + 1);
      for (let i = 0; i <= M; i++) Z[i] = zAt(y0 + i * dy);
      // alle ebenen Leisten (|Z| konstant ±0,15 mm, mindestens 80 % der Breite) mit Absatz nach innen an mindestens einer Seite
      let zmax = 0; for (let i = 0; i <= M; i++) zmax = Math.max(zmax, Z[i]);
      const st = Math.max(1, Math.round(1.5 / dy)), iv = [];
      for (let i = 0; i <= M;) {
        let b = i; while (b < M && Math.abs(Z[b + 1] - Z[i]) <= 0.15) b++;
        const a = i, zr = Z[i]; i = b + 1;
        if (zr < 0.8 * zmax || (b - a) * dy > 0.35 * h) continue;
        const need = Math.max(2, 0.03 * zr);
        const up = b + st <= M && Z[b + st] <= zr - need, dn = a - st >= 0 && Z[a - st] <= zr - need;
        if (!up && !dn) continue;
        if (!(up && dn) && (b - a) * dy < 2) continue;   // schmale Leiste nur mit Absatz auf beiden Seiten
        iv.push([Math.max(0, a - (dn ? 2 * st : 1)), Math.min(M, b + (up ? 2 * st : 1))]);   // samt Ausrundung hinter dem Absatz
      }
      // nahe Leisten (z. B. Ober- und Unterseite der Wurzelrippe) zu einem Bereich zusammenfassen
      const zone = [];
      for (const q of iv) { const l = zone[zone.length - 1]; if (l && q[0] <= l[1] + 2 * st) l[1] = Math.max(l[1], q[1]); else zone.push(q.slice()); }
      // sauber schließen: kubische Hermite-Brücke, Steigungen aus der Kontur außerhalb (je 1,5 mm), begrenzt
      for (const [ia, ib] of zone) {
        const L = ib - ia, lim = Math.max(2 * Math.abs(Z[ib] - Z[ia]) / L, 0.5 * dy);
        const ma = clamp(ia - st >= 0 ? (Z[ia] - Z[ia - st]) / st : 0, -lim, lim), mb = clamp(ib + st <= M ? (Z[ib + st] - Z[ib]) / st : 0, -lim, lim);
        for (let q = ia + 1; q < ib; q++) {
          const t = (q - ia) / L, t2 = t * t, t3 = t2 * t;
          Z[q] = (2 * t3 - 3 * t2 + 1) * Z[ia] + (t3 - 2 * t2 + t) * L * ma + (-2 * t3 + 3 * t2) * Z[ib] + (t3 - t2) * L * mb;
        }
        wingCut = true;
      }
      if (wingCut) {
        zAt = y => { const t = clamp((y - y0) / dy, 0, M), i = Math.min(M - 1, Math.floor(t)), f = t - i; return Z[i] + (Z[i + 1] - Z[i]) * f; };
        zw = 0; for (let i = 0; i <= M; i++) if (Z[i] > zw) { zw = Z[i]; yw = y0 + i * dy; }
      }
    }
    const N = 140, lv = [];
    for (let k = 1; k < N; k++) { const y = y0 + h * (1 + Math.cos(Math.PI * k / N)) / 2; lv.push([y, zAt(y)]); }
    const ext = yy => { let z = 0; for (let i = 0; i < seg.length; i += 2) if (Math.abs(seg[i] - yy) < 0.002 * h) z = Math.max(z, Math.abs(seg[i + 1])); return z; };
    let top = y1, pts = [], cut = false, onlyFin = false, can = null;
    if (o.fin && y1 - yw > 2.5 * zw) {
      // Seitenleitwerk: von der breitesten Stelle aufwärts wird ein runder Rumpf immer steiler schmaler; am Leitwerksansatz
      // knickt die Flanke plötzlich in die (fast senkrechte) Leitwerksseite -> dort abschneiden.
      const M = Math.min(600, Math.ceil((y1 - yw) / (zw / 12))), dy = (y1 - yw) / M; let zp = zw, smax = 0, yj = null, zj = 0;
      for (let i = 1; i < M; i++) {
        const y = yw + dy * i, z = zAt(y), sl = (zp - z) / dy; zp = z;
        if (sl > smax) smax = sl;
        if (smax > 0.12 && sl < 0.25 * smax && z > 0.05 * zw) { yj = y - dy; zj = zAt(yj); break; }
      }
      if (yj != null && y1 - yj > 2 * zw && zj < 0.9 * zw && yj > yw + 1e-6) {
        cut = true; pts.push([0, 0]);
        const yc = y0 + zw;   // runder Leitwerksträger: Mitte = Unterkante + Radius (die breiteste Stelle wandert bei fast senkrechten Flanken)
        if (Math.abs(yw - yc) < 0.35 * zw) {
          // Kuppe = Halbkreis über der Mitte (ruhig von Schnitt zu Schnitt)
          top = yc + zw;
          for (let q = 1; q < 10; q++) { const f = Math.PI / 2 * q / 10; pts.push([yc + zw * Math.cos(f), zw * Math.sin(f)]); }
          pts.push(...lv.filter(q => q[0] < yc - 1e-6));
        } else {
          // Kreisbogen durch Ansatzpunkt und breiteste Stelle (Mittelpunkt auf der Symmetrieachse)
          const c = (zj * zj - zw * zw + yj * yj - yw * yw) / (2 * (yj - yw)), R = Math.hypot(zw, yw - c), f0 = Math.atan2(zj, yj - c);
          top = Math.max(yj, c + R);
          for (let q = 1; q < 8; q++) { const f = f0 * q / 8, p = [c + R * Math.cos(f), R * Math.sin(f)]; if (p[0] > yj + 1e-6) pts.push(p); }
          pts.push([yj, zj]);
          pts.push(...lv.filter(q => q[0] < yj - 1e-6));
        }
        pts[0] = [top, 0];
      } else if (y1 - y0 > 8 * zw) onlyFin = true;   // nur noch Leitwerk (hinter dem Rumpfende)
    }
    if (!cut && o.canopy && !moldUsed) {
      // Haubenabsatz: oberhalb der breitesten Stelle springt die Kontur plötzlich nach innen (Haubenauflage, Rahmen,
      // Ausschnitt) — vorher läuft sie flach. Unterster Absatz = Schnitthöhe; die Kuppe setzt fromMesh (überbrückte Oberkante).
      const dy = 0.5, M = Math.min(1200, Math.ceil((y1 - yw) / dy)), Z = [];
      for (let i = 0; i <= M; i++) Z.push(zAt(yw + dy * i));
      const need = Math.max(2, 0.04 * zw);
      for (let i = 6; i + 2 <= M; i++) {   // Absatz: ≥ 2 mm (4 % der Breite) auf 1 mm Höhe, mehr als dreimal so steil wie davor
        const z = Z[i], drop = z - Z[i + 2], prev = (Z[i - 6] - z) / (6 * dy);
        if (drop >= need && drop > 3 * prev * 2 * dy && Z[i + 2] > 0.25 * zw && z > 0.5 * zw) {
          const yj = yw + dy * i; can = { y: yj, z }; cut = true; top = yj;
          pts.push([yj, 0], [yj, z]);
          pts.push(...lv.filter(q => q[0] < yj - 1e-6));
          break;
        }
      }
    }
    if (!cut) {
      pts.push([y1, 0]); const zt = moldUsed ? 0 : ext(y1); if (zt > 0.01 * h && zt > lv[0][1] + 0.005 * h) pts.push([y1, zt]);   // flache Oberseite
      pts.push(...lv);
    }
    const zb = ext(y0); if (zb > 0.01 * h && zb > lv[lv.length - 1][1] + 0.005 * h) pts.push([y0, zb]);   // flache Unterseite
    pts.push([y0, 0]);
    // breiteste Stelle (nach dem Abtrennen neu)
    if (cut) { zw = 0; for (const p of pts) if (p[1] > zw) { zw = p[1]; yw = p[0]; } }
    return { top, top0: y1, bot: y0, w: zw, yw, pts, fin: cut && !can, can, onlyFin, wingCut, moldUsed };
  }
  // Haubenkuppe über dem Absatz (y, z) bis zur Oberkante T: Ellipsenviertel, oben waagrecht.
  function canopyCap(c, T) {
    const b = Math.max(T - c.y, 0.05 * c.z), out = [];
    for (let q = 0; q < 10; q++) { const f = Math.PI / 2 * q / 10; out.push([c.y + b * Math.cos(f), c.z * Math.sin(f)]); }
    return out;
  }
  // Grifflängen eines Bezier-Segments p0 -> p3 bei festen Tangenten (d0 aus p0 heraus, d1 aus p3 zurück) nach kleinsten
  // Quadraten an die Punkte P[i0..i1] (Schneider, Bogenlängen-Parameter + Newton-Nachparametrierung).
  function bezFit(P, i0, i1, p0, p3, d0, d1) {
    const L = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) || 1e-9, m = i1 - i0;
    if (m < 2) return [L / 3, L / 3];
    const u = [0]; for (let i = i0 + 1; i <= i1; i++) u.push(u[u.length - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const tot = u[m] || 1; for (let i = 0; i <= m; i++) u[i] /= tot;
    let a1 = L / 3, a2 = L / 3;
    for (let it = 0; it < 4; it++) {
      let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
      for (let i = 0; i <= m; i++) {
        const t = u[i], s1 = 1 - t, B0 = s1 * s1 * s1, B1 = 3 * s1 * s1 * t, B2 = 3 * s1 * t * t, B3 = t * t * t;
        const A1 = [d0[0] * B1, d0[1] * B1], A2 = [d1[0] * B2, d1[1] * B2], q = P[i0 + i];
        const r = [q[0] - (p0[0] * (B0 + B1) + p3[0] * (B2 + B3)), q[1] - (p0[1] * (B0 + B1) + p3[1] * (B2 + B3))];
        c00 += A1[0] * A1[0] + A1[1] * A1[1]; c01 += A1[0] * A2[0] + A1[1] * A2[1]; c11 += A2[0] * A2[0] + A2[1] * A2[1];
        x0 += A1[0] * r[0] + A1[1] * r[1]; x1 += A2[0] * r[0] + A2[1] * r[1];
      }
      const det = c00 * c11 - c01 * c01;
      let b1 = Math.abs(det) > 1e-12 ? (x0 * c11 - x1 * c01) / det : NaN, b2 = Math.abs(det) > 1e-12 ? (c00 * x1 - c01 * x0) / det : NaN;
      if (!(b1 > 0.02 * L) || !(b2 > 0.02 * L) || b1 > 1.5 * L || b2 > 1.5 * L) { if (it === 0) { a1 = a2 = L / 3; } break; }
      a1 = b1; a2 = b2;
      // Newton: Parameter auf den nächsten Kurvenpunkt schieben
      const C = [p0, [p0[0] + d0[0] * a1, p0[1] + d0[1] * a1], [p3[0] + d1[0] * a2, p3[1] + d1[1] * a2], p3];
      for (let i = 1; i < m; i++) {
        const t = u[i], s1 = 1 - t, q = P[i0 + i];
        const Q = bez2(C, t), D1 = [0, 1].map(c => 3 * (s1 * s1 * (C[1][c] - C[0][c]) + 2 * s1 * t * (C[2][c] - C[1][c]) + t * t * (C[3][c] - C[2][c])));
        const D2 = [0, 1].map(c => 6 * (s1 * (C[2][c] - 2 * C[1][c] + C[0][c]) + t * (C[3][c] - 2 * C[2][c] + C[1][c])));
        const num = (Q[0] - q[0]) * D1[0] + (Q[1] - q[1]) * D1[1], den = D1[0] * D1[0] + D1[1] * D1[1] + (Q[0] - q[0]) * D2[0] + (Q[1] - q[1]) * D2[1];
        if (Math.abs(den) > 1e-12) u[i] = clamp(t - num / den, u[i - 1], 1);
      }
    }
    return [a1, a2];
  }
  // Knoten an den Indizes ch der Kontur P: Lage pos(i), Tangente dir(i), Grifflängen per bezFit.
  function bezNodes(P, ch, pos, dir) {
    const nodes = ch.map(k => { const p = pos(k); return { y: p[0], z: Math.max(0, p[1]), i: [0, 0], o: [0, 0] }; });
    for (let j = 0; j + 1 < ch.length; j++) {
      const a = ch[j], b = ch[j + 1], p0 = pos(a), p3 = pos(b), d0 = dir(a), e = dir(b), d1 = [-e[0], -e[1]];
      const [a1, a2] = b > a ? bezFit(P, a, b, p0, p3, d0, d1) : [0, 0];
      nodes[j].o = [d0[0] * a1, d0[1] * a1]; nodes[j + 1].i = [d1[0] * a2, d1[1] * a2];
    }
    return nodes;
  }
  // Tangente der Kontur bei Index i aus einem Fenster von ±2 % der Bogenlänge (mindestens ±2 Punkte).
  function contourDir(P, i) {
    const n = P.length; let tot = 0; for (let k = 1; k < n; k++) tot += Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]);
    const w = 0.02 * tot; let a = i, b = i, sa = 0, sb = 0;
    while (a > 0 && (i - a < 2 || sa < w)) { sa += Math.hypot(P[a][0] - P[a - 1][0], P[a][1] - P[a - 1][1]); a--; }
    while (b < n - 1 && (b - i < 2 || sb < w)) { sb += Math.hypot(P[b + 1][0] - P[b][0], P[b + 1][1] - P[b][1]); b++; }
    const L = Math.hypot(P[b][0] - P[a][0], P[b][1] - P[a][1]) || 1;
    return [(P[b][0] - P[a][0]) / L, (P[b][1] - P[a][1]) / L];
  }
  // Höhe der breitesten Stelle als Mitte des Bands, in dem die Kontur höchstens 0,5 % (≥ 0,3 mm) schmaler ist.
  function ywMid(pts) {
    let zw = 0; for (const p of pts) zw = Math.max(zw, p[1]);
    const e = Math.max(0.3, 0.005 * zw); let a = Infinity, b = -Infinity;
    for (const p of pts) if (p[1] >= zw - e) { a = Math.min(a, p[0]); b = Math.max(b, p[0]); }
    return isFinite(a) ? (a + b) / 2 : 0;
  }
  // Abstand der Konturpunkte P[i0..i1] zur Bezierkette (Knoten j0..j1, chosen = Indizes der Knoten in P).
  function nodeErr(P, chosen, nodes, j0, j1) {
    let worst = 0;
    for (let j = j0; j < j1; j++) {
      const B = polyOf([nodes[j], nodes[j + 1]], 32);
      for (let i = chosen[j] + 1; i < chosen[j + 1]; i++) {
        let dm = Infinity;
        for (let q = 0; q + 1 < B.length; q++) {
          const a = B[q], b = B[q + 1], ux = b[0] - a[0], uy = b[1] - a[1], L2 = ux * ux + uy * uy || 1e-12;
          const t = clamp(((P[i][0] - a[0]) * ux + (P[i][1] - a[1]) * uy) / L2, 0, 1);
          dm = Math.min(dm, Math.hypot(a[0] + ux * t - P[i][0], a[1] + uy * t - P[i][1]));
        }
        if (dm > worst) worst = dm;
      }
    }
    return worst;
  }
  // Fester Knotenaufbau: oben, nu Knoten (gleiche Bogenlänge), breiteste Stelle bei yN (z = 1, senkrechte Tangente),
  // nl Knoten, unten. Tangenten aus der Kontur, Griffe = Sehne/3. eu/el = Abweichung oberer/unterer Teil (normiert).
  // ends: Spitzen oben/unten erhalten (Endtangente aus der Kontur statt waagrecht, wenn sie mehr als 12° davon abweicht).
  function fitFixed(P, yN, nu, nl, frac, ends) {
    const n = P.length; let zm = 0; for (const p of P) zm = Math.max(zm, p[1]);
    // breiteste Stelle: im Band ≥ 97 % der Breite so nah wie möglich an der geglätteten Dickenlinie yN
    let wi = -1; for (let i = 1; i < n - 1; i++) if (P[i][1] >= 0.97 * zm && (wi < 0 || Math.abs(P[i][0] - yN) < Math.abs(P[wi][0] - yN))) wi = i;
    if (wi < 0) wi = n >> 1;
    // Die breiteste Stelle liegt genau auf der geglätteten Dickenlinie (sofern im Band), z = 1; alle anderen Knoten und
    // Griffe bleiben darunter (≤ 99,2 % bzw. 99,6 %, Reserve für das Überblenden) -> die Kurve ist nur dort am breitesten, die Dickenlinie im Rumpf bleibt glatt.
    let ylo = Infinity, yhi = -Infinity; for (const p of P) if (p[1] >= 0.97 * zm) { ylo = Math.min(ylo, p[0]); yhi = Math.max(yhi, p[0]); }
    const yW = yN >= ylo && yN <= yhi ? yN : P[wi][0];
    const ZC = 0.996;
    const pos = i => i === wi ? [yW, 1] : [P[i][0], Math.min(P[i][1], 0.992)];
    const endDir = (i, flat) => { if (!ends) return flat; const d = contourDir(P, i); return Math.abs(d[0]) > 0.2 ? d : flat; };
    const dir = i => i === 0 ? endDir(0, [0, 1]) : i === n - 1 ? endDir(n - 1, [0, -1]) : i === wi ? [-1, 0] : contourDir(P, i);
    const capH = (q, hnd) => { const z = q.z + hnd[1]; if (z > ZC && hnd[1] > 1e-12) { const f = Math.max(0, (ZC - q.z) / hnd[1]); return [hnd[0] * f, hnd[1] * f]; } return hnd; };
    // breiteste Stelle: Griffe höchstens ¼ der Sehne, sonst ist die Flanke dort so flach, dass das Maximum nicht mehr eindeutig ist
    const capW = (nd, ch, j) => {
      const q = nd[j], lim = (k) => k >= 0 && k < nd.length ? 0.25 * Math.hypot(nd[k].y - q.y, nd[k].z - q.z) : 0;
      const sh = (hd, l) => { const L = Math.hypot(hd[0], hd[1]); return L > l && L > 1e-12 ? [hd[0] * l / L, hd[1] * l / L] : hd; };
      q.i = sh(q.i, lim(j - 1)); q.o = sh(q.o, lim(j + 1)); return q;
    };
    const make = ch => { const nd = bezNodes(P, ch, pos, dir); return nd.map((q, j) => ch[j] === wi ? capW(nd, ch, j) : Object.assign(q, { i: capH(q, q.i), o: capH(q, q.o) })); };
    // je Teil (oben bis breiteste Stelle, darunter) genau nu bzw. nl Knoten. Je Schritt mehrere Kandidaten (größte
    // Abweichung, Mitten der größten Lücken; mindestens 3 Konturpunkte Abstand zu vorhandenen Knoten) — genommen wird der,
    // nach dem der Teil am besten passt.
    let chosen = [0, wi, n - 1];
    const errPart = (ch, lo, hi) => { const nd = make(ch); let j0 = ch.indexOf(lo), j1 = ch.lastIndexOf(hi); return nodeErr(P, ch, nd, j0, j1); };
    const worstIdx = (lo, hi) => {
      const nd = make(chosen); let w = -1, wk = -1;
      for (let j = 0; j + 1 < chosen.length; j++) {
        if (chosen[j] < lo || chosen[j + 1] > hi) continue;
        const B = polyOf([nd[j], nd[j + 1]], 32);
        for (let i = chosen[j] + 1; i < chosen[j + 1]; i++) {
          if (chosen.some(c => Math.abs(c - i) < 3)) continue;
          let dm = Infinity;
          for (let q = 0; q + 1 < B.length; q++) {
            const a = B[q], b = B[q + 1], ux = b[0] - a[0], uy = b[1] - a[1], L2 = ux * ux + uy * uy || 1e-12;
            const t = clamp(((P[i][0] - a[0]) * ux + (P[i][1] - a[1]) * uy) / L2, 0, 1);
            dm = Math.min(dm, Math.hypot(a[0] + ux * t - P[i][0], a[1] + uy * t - P[i][1]));
          }
          if (dm > w) { w = dm; wk = i; }
        }
      }
      return wk;
    };
    const fill = (lo, hi, m) => {
      for (let k = 0; k < m; k++) {
        const cand = new Set(), wk = worstIdx(lo, hi); if (wk >= 0) cand.add(wk);
        const gaps = []; for (let j = 0; j + 1 < chosen.length; j++) if (chosen[j] >= lo && chosen[j + 1] <= hi) gaps.push([chosen[j + 1] - chosen[j], chosen[j], chosen[j + 1]]);
        gaps.sort((p, q) => q[0] - p[0]); for (const g of gaps.slice(0, 3)) if (g[0] >= 6) cand.add((g[1] + g[2]) >> 1);
        let best = null, be = Infinity;
        for (const i of cand) { const ch = chosen.concat([i]).sort((p, q) => p - q), e = errPart(ch, lo, hi); if (e < be) { be = e; best = ch; } }
        if (!best) { const g = gaps[0]; best = chosen.concat([g ? Math.max(g[1] + 1, Math.min(g[2] - 1, (g[1] + g[2]) >> 1)) : chosen[chosen.length - 1]]).sort((p, q) => p - q); }   // Notfall
        chosen = best;
      }
    };
    const arc = [0]; for (let i = 1; i < n; i++) arc.push(arc[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const atFrac = (a, b, f) => { const s0 = arc[a] + (arc[b] - arc[a]) * f; let i = a + 1; while (i < b - 1 && arc[i] < s0) i++; return clamp(i, a + 1, Math.max(a + 1, b - 1)); };
    if (frac) {
      // vorgegebene Lage je Knoten (Anteil der Bogenlänge oben bzw. unten) -> gleiche Zuordnung in allen Spanten
      chosen = [0].concat(frac.u.map(f => atFrac(0, wi, f)), [wi], frac.l.map(f => atFrac(wi, n - 1, f)), [n - 1]);
      for (let k = 1; k < chosen.length; k++) if (chosen[k] < chosen[k - 1]) chosen[k] = chosen[k - 1];
    } else { fill(0, wi, nu); fill(wi, n - 1, nl); }
    const nodes = make(chosen), jw = chosen.indexOf(wi);
    const fu = chosen.slice(1, jw).map(i => (arc[i] - arc[0]) / ((arc[wi] - arc[0]) || 1)), fl = chosen.slice(jw + 1, -1).map(i => (arc[i] - arc[wi]) / ((arc[n - 1] - arc[wi]) || 1));
    return { nodes, eu: nodeErr(P, chosen, nodes, 0, jw), el: nodeErr(P, chosen, nodes, jw, chosen.length - 1), frac: { u: fu, l: fl } };
  }
  // Bezier-Knoten (normiert, oben -> unten) in eine Kontur einpassen: oben/breiteste Stelle/unten, dann jeweils an der
  // größten Abweichung einen Knoten einfügen (Tangente aus den Nachbarpunkten, Griffe = Sehne/3).
  function fitNodes(P, maxN, tol) {
    const n = P.length, chosen = [0, n - 1];
    let wi = 0; for (let i = 0; i < n; i++) if (P[i][1] > P[wi][1]) wi = i;
    if (wi > 0 && wi < n - 1) chosen.splice(1, 0, wi);
    const dir = k => k === 0 ? [0, 1] : k === n - 1 ? [0, -1] : contourDir(P, k);
    const make = () => bezNodes(P, chosen, k => [P[k][0], Math.max(0, P[k][1])], dir);
    let nodes = make();
    for (;;) {
      let worst = 0, wk = -1;
      for (let j = 0; j + 1 < chosen.length; j++) {
        const B = polyOf([nodes[j], nodes[j + 1]], 32);
        for (let i = chosen[j] + 1; i < chosen[j + 1]; i++) {
          let dm = Infinity;
          for (let q = 0; q + 1 < B.length; q++) {
            const a = B[q], b = B[q + 1], ux = b[0] - a[0], uy = b[1] - a[1], L2 = ux * ux + uy * uy || 1e-12;
            const t = clamp(((P[i][0] - a[0]) * ux + (P[i][1] - a[1]) * uy) / L2, 0, 1);
            dm = Math.min(dm, Math.hypot(a[0] + ux * t - P[i][0], a[1] + uy * t - P[i][1]));
          }
          if (dm > worst) { worst = dm; wk = i; }
        }
      }
      if (worst <= tol || wk < 0 || chosen.length >= maxN) return { nodes, err: worst };
      chosen.push(wk); chosen.sort((a, b) => a - b); nodes = make();
    }
  }
  // Nase rund (senkrechte Tangente) für eine Linie, wie roundNoseOut.
  function roundNoseLine(P) {
    if (P.length < 2) return;
    const p = P[0], q = P[1], r = P[2];
    const s = r ? (r.v - q.v) / ((r.x - q.x) || 1e-9) : 0, cy = q.v - s * (q.x - p.x);
    let L = KAPPA * (cy - p.v);
    if (Math.sign(L) !== Math.sign(q.v - p.v) || Math.abs(L) < 1e-6) L = 0.3 * (q.v - p.v);
    p.c = 1; p.i = [0, 0]; p.o = [0, r2(L)];
  }
  // Umrisslinie in Messwerte D [{x, [key]}] einpassen (C2-Spline, Punkte an der größten Abweichung einfügen).
  // Knicke (Absätze, z. B. am Haubenausschnitt) werden Eckpunkte (c 2) mit einseitigen Tangenten aus den Messwerten.
  function outKinks(D, key) {
    const n = D.length, ang = new Array(n).fill(0), sl = (a, b) => (D[b][key] - D[a][key]) / ((D[b].x - D[a].x) || 1e-9);
    for (let j = 2; j < n - 2; j++) ang[j] = Math.abs(Math.atan(sl(j, j + 2)) - Math.atan(sl(j - 2, j)));
    const out = new Map();
    for (let j = 3; j < n - 3; j++) {
      if (ang[j] < 25 * Math.PI / 180) continue;
      let best = true; for (let q = j - 3; q <= j + 3; q++) if (ang[q] > ang[j] || (ang[q] === ang[j] && q < j)) best = false;
      if (best) out.set(j, { sL: sl(j - 2, j), sR: sl(j, j + 2) });
    }
    return out;
  }
  function fitOutLine(D, key, tol, maxN, nose, mode) {
    mode = mode || 'c2';
    const K = outKinks(D, key), idx = [0, D.length - 1].concat([...K.keys()]).sort((a, b) => a - b);
    const mk = () => {
      const P = idx.map(i => ({ x: r2(D[i].x), v: r2(key === 'w' ? Math.max(0, D[i][key]) : D[i][key]), c: 0 }));
      idx.forEach((i, j) => {
        const k = K.get(i); if (!k || j === 0 || j === idx.length - 1) return;
        const h0 = (P[j].x - P[j - 1].x) / 3, h1 = (P[j + 1].x - P[j].x) / 3;
        P[j].c = 2; P[j].i = [-r2(h0), -r2(k.sL * h0)]; P[j].o = [r2(h1), r2(k.sR * h1)];
      });
      if (nose) roundNoseLine(P);
      if (mode === 'bs') for (let it = 0; it < 12; it++) {   // B-Spline: glatte Punkte sind Kontrollpunkte -> auf die Messwerte nachziehen
        const sg = outSegs(P, 'bs');
        idx.forEach((i, j) => { if (j > 0 && j < idx.length - 1 && !P[j].c) P[j].v += D[i][key] - lineAt(sg, P[j].x); });
      }
      return P;
    };
    for (;;) {
      const P = mk(), segs = outSegs(P, mode);
      let worst = 0, wi = -1;
      for (let i = 1; i < D.length - 1; i++) { const e = Math.abs(lineAt(segs, D[i].x) - D[i][key]); if (e > worst && idx.indexOf(i) < 0) { worst = e; wi = i; } }
      if (worst <= tol || wi < 0 || idx.length >= maxN) return { P, err: worst };
      idx.push(wi); idx.sort((a, b) => a - b);
    }
  }
  // Lage eines Rumpfnetzes: Längsachse (längste), Hochachse (die mit wandernder Mitte), Vorzeichen (automatisch + =
  // oben), Nase (breiteres Ende), Symmetrieebene. toLocal: Dreiecke -> Rumpf-Koordinaten, toWorld: Punkt zurück.
  function meshFrame(soup, opt) {
    opt = opt || {};
    const AX = { x: 0, y: 1, z: 2 };
    if (!soup || soup.length < 9) throw new Error(T('Kein Netz.'));
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < soup.length; i += 3) for (let k = 0; k < 3; k++) { const v = soup[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
    const ext = mx.map((v, k) => v - mn[k]);
    const L = AX[opt.len] != null ? AX[opt.len] : ext.indexOf(Math.max(...ext));
    // Probeschnitte: Mitte je Station in den beiden Querachsen -> Symmetrieebene (ruhigste Mitte), Nase (breiteres Ende)
    const qa = [0, 1, 2].filter(k => k !== L), cen = { [qa[0]]: [], [qa[1]]: [] };
    for (let s = 1; s < 40; s++) {
      const seg = sliceSoup(soup, L, mn[L] + ext[L] * s / 40); if (seg.length < 4) continue;
      const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
      for (let i = 0; i < seg.length; i += 2) for (let c = 0; c < 2; c++) { lo[c] = Math.min(lo[c], seg[i + c]); hi[c] = Math.max(hi[c], seg[i + c]); }
      cen[qa[0]].push((lo[0] + hi[0]) / 2); cen[qa[1]].push((lo[1] + hi[1]) / 2);
    }
    const sd = a => { const m = a.reduce((p, q) => p + q, 0) / (a.length || 1); return Math.sqrt(a.reduce((p, q) => p + (q - m) * (q - m), 0) / (a.length || 1)); };
    const U = AX[opt.up] != null && AX[opt.up] !== L ? AX[opt.up] : (sd(cen[qa[0]]) > sd(cen[qa[1]]) ? qa[0] : qa[1]);
    const S = qa.find(k => k !== U), med = a => { const b = a.slice().sort((p, q) => p - q); return b.length ? b[b.length >> 1] : 0; };
    const zc = Math.abs(med(cen[S])) < 0.5 ? 0 : med(cen[S]);   // Symmetrieebene (liegt sie fast auf 0, genau 0)
    let us = +opt.upSign;
    if (us !== 1 && us !== -1) us = 1;   // automatisch: Plusrichtung des Modells ist oben (Überstand raten stellt Rümpfe mit steigendem Heck auf den Kopf)
    let noseMin = opt.nose === 'min' ? true : opt.nose === 'max' ? false : null;
    if (noseMin == null) {
      const si = qa.indexOf(S), wAt = f => { const seg = sliceSoup(soup, L, mn[L] + ext[L] * f); let a = Infinity, b = -Infinity; for (let i = si; i < seg.length; i += 2) { a = Math.min(a, seg[i]); b = Math.max(b, seg[i]); } return seg.length ? b - a : 0; };
      noseMin = wAt(0.05) >= wAt(0.95);
    }
    const toLocal = ms => {
      const w = new Float64Array(ms.length);
      for (let i = 0; i < ms.length; i += 3) { w[i] = noseMin ? ms[i + L] - mn[L] : mx[L] - ms[i + L]; w[i + 1] = us * ms[i + U]; w[i + 2] = ms[i + S] - zc; }
      return w;
    };
    const toWorld = (x, y, z, out, o) => { out[o + L] = noseMin ? x + mn[L] : mx[L] - x; out[o + U] = y * us; out[o + S] = z + zc; };
    return { L, U, S, us, zc, noseMin, mn, mx, ext, toLocal, toWorld };
  }
  // Haubenkante als Linienzug der Seitenansicht: erste Ausschnittkante je Schnitt dort, wo die Form die Haube liefert,
  // längster zusammenhängender Lauf, Enden bis zur Oberkante (topAt) verlängert. → [[x, y], …] von Oberkante zu Oberkante | null
  function canopyEdgeLine(W, WM, st, x1, topAt) {
    let mx0 = Infinity, mx1 = -Infinity; for (const w of WM) for (let i = 0; i < w.length; i += 3) { mx0 = Math.min(mx0, w[i]); mx1 = Math.max(mx1, w[i]); }
    const E = [];
    for (let x = Math.max(1, mx0); x <= Math.min(x1 - 1, mx1); x += 3) {
      const r = st(x); if (!r || !r.moldUsed) continue;
      const y = canopyEdge(sliceSoup(W, 0, x)); if (y != null && y < r.top - 1) E.push([x, y]);
    }
    let best = [], cur = [];   // Lücken bis 12 mm
    for (const p of E) { if (cur.length && p[0] - cur[cur.length - 1][0] > 12) { if (cur.length > best.length) best = cur; cur = []; } cur.push(p); }
    if (cur.length > best.length) best = cur;
    if (best.length < 4) return null;
    const extend = (p, q, dir) => {   // von p weg (dir -1 vorne, +1 hinten) mit der Steigung p–q bis zur Oberkante
      const sl = (p[1] - q[1]) / ((p[0] - q[0]) || 1e-9);
      for (let d = 0; d < 200; d += 0.5) { const x = p[0] + dir * d, y = p[1] + dir * d * sl; if (y >= topAt(x) || x <= 1 || x >= x1 - 1) return [x, Math.min(y, topAt(x))]; }
      return [p[0] + dir * 5, topAt(p[0] + dir * 5)];
    };
    const k3 = Math.min(3, best.length - 1);
    return [extend(best[0], best[k3], -1)].concat(best, [extend(best[best.length - 1], best[best.length - 1 - k3], 1)]);
  }
  // soup: Dreiecke (x,y,z je Ecke). opt: len/up 'auto'|'x'|'y'|'z', upSign 'auto'|1|-1, nose 'auto'|'min'|'max', nFr, tol (mm),
  // nodes (max. Knoten je Spant), fin (Leitwerk abtrennen), type 'free'|'egg'. Ergebnis: Bericht; Umrisse/Spanten sind ersetzt.
  function fromMesh(soup, opt) {
    opt = Object.assign({ len: 'auto', up: 'auto', upSign: 'auto', nose: 'auto', nFr: 14, frTol: 1.5, tol: 0.5, nodes: 10, fin: true, wing: true, canopy: false, type: 'free', outMax: 60 }, opt || {});
    const F = meshFrame(soup, opt), { L, U, S, us, zc, noseMin, mn, mx, ext } = F;
    state.cfg.rproMeshFrame = { L, U, S, us, zc, noseMin, l0: mn[L], l1: mx[L] };   // Schnitte aus der 3D-Bearbeitung nutzen genau diese Lage (frameOf)
    // im Reiter Rumpf-Koordinaten: X ab Nase, Y hoch, Z seitlich (0 = Symmetrieebene); Haubenform je Formkörper ein Feld
    const W = F.toLocal(soup);
    const mList = opt.mold ? (Array.isArray(opt.mold) ? opt.mold : [opt.mold]).filter(q => q && q.length >= 9) : [];
    const WM = mList.length ? mList.map(F.toLocal) : null;
    const mSlice = x => WM ? WM.map(w => sliceSoup(w, 0, x)) : null;
    const glass = Math.max(0, +opt.glass || 0);
    const Lx = ext[L], st = x => meshStation(sliceSoup(W, 0, x), { fin: opt.fin, canopy: opt.canopy, wing: opt.wing, mold: mSlice(x), glass });
    // Messstationen (an Nase/Heck dichter)
    const NS = 360, D = [];
    let finN = 0, wingN = 0, tailCut = null;
    for (let k = 0; k <= NS; k++) {
      const u = k / NS, x = clamp(Lx * (0.5 * u + 0.5 * (1 - Math.cos(Math.PI * u)) / 2), Math.max(0.05, 0.002 * Lx), Lx - 0.05);   // an den Enden etwas dichter
      if (D.length && x - D[D.length - 1].x < 1e-6) continue;
      const r = st(x);
      if (!r) continue;
      if (r.onlyFin) { if (D.length > NS / 4) { tailCut = x; break; } continue; }
      if (r.fin) finN++;
      if (r.wingCut) wingN++;
      D.push({ x, top: r.top, top0: r.top0, bot: r.bot, w: r.w, yw: r.yw, ym: ywMid(r.pts), fin: r.fin, can: r.can, mold: r.moldUsed });
    }
    // Kabinenhaube nicht berücksichtigen: Bereiche mit Haubenabsatz (Lücken bis 4 Schnitte geschlossen, Einzeltreffer
    // verworfen) -> Oberkante dort kubisch (Hermite, Steigungen von außen) zwischen den Nachbarn überbrücken.
    const canZones = [];
    const bridge = (ja, jb, minFn) => {
      const A = D[ja], B = D[jb], sl = (p, q) => (D[q].top - D[p].top) / ((D[q].x - D[p].x) || 1e-9);
      const mA = ja >= 2 ? sl(ja - 2, ja) : sl(ja, jb), mB = jb + 2 < D.length ? sl(jb, jb + 2) : sl(ja, jb), Hx = B.x - A.x;
      for (let j = ja + 1; j < jb; j++) {
        const t = (D[j].x - A.x) / Hx, t2 = t * t, t3 = t2 * t;
        const v = (2 * t3 - 3 * t2 + 1) * A.top + (t3 - 2 * t2 + t) * Hx * mA + (-2 * t3 + 3 * t2) * B.top + (t3 - t2) * Hx * mB;
        D[j].top = minFn(D[j], v);
      }
    };
    if (opt.canopy) {
      const f = D.map(d => !!d.can);
      for (let j = 0; j < f.length; j++) if (!f[j]) { const a = j - 1; let b = j + 1; while (b < f.length && !f[b] && b - j < 5) b++; if (a >= 0 && f[a] && b < f.length && f[b] && b - a <= 5) for (let q = a + 1; q < b; q++) f[q] = true; }
      for (let j = 0; j < f.length;) {
        if (!f[j]) { j++; continue; }
        let k = j; while (k + 1 < f.length && f[k + 1]) k++;
        if (k - j >= 2 && j > 0 && k < D.length - 1) {
          bridge(j - 1, k + 1, (d, v) => d.can ? Math.max(v, d.can.y + 0.05 * d.can.z) : Math.min(d.top, Math.max(v, d.yw)));
          canZones.push([D[j - 1].x, D[k + 1].x]);
        } else for (let q = j; q <= k; q++) if (D[q].can) { D[q].can = null; D[q].top = D[q].top0; }   // Einzeltreffer: Haube bleibt
        j = k + 1;
      }
    }
    if (D.length < 6) throw new Error(T('Zu wenige Querschnitte gefunden — Längsachse prüfen.'));
    // Leitwerksbereich: ab dem letzten sauberen Schnitt vor dem Leitwerk (4 × halbe Breite vor dem ersten abgetrennten
    // Schnitt, davor steckt noch die Leitwerksnase/-ausrundung) bis zum letzten abgetrennten Schnitt gilt dessen Querschnitt:
    // Höhe/Breite und Lage der Dickenlinie bleiben, skaliert auf die (dort sauber gemessene) Unterkante und Breite.
    // Robuster als die Kuppe je Schnitt (hohe, ovale Leitwerksträger, Leitwerksfuß).
    let finZone = null, finRef = null;
    const jf = opt.fin ? D.findIndex(d => d.fin) : -1;
    if (jf > 0) {
      const xf = D[jf].x, xa = xf - 4 * D[jf].w;
      let ja = jf; while (ja > 0 && D[ja - 1].x >= xa) ja--;
      if (ja > 0) {
        ja--; const A = D[ja]; let jl = jf; for (let j = jf; j < D.length; j++) if (D[j].fin) jl = j;
        const hr = (A.top - A.bot) / Math.max(1e-6, 2 * A.w), yr = ((A.ym != null ? A.ym : A.yw) - A.bot) / Math.max(1e-6, A.top - A.bot);
        for (let j = ja + 1; j <= jl; j++) { const d = D[j]; d.top = d.bot + hr * 2 * d.w; d.ym = d.yw = d.bot + yr * (d.top - d.bot); }
        finZone = [A.x, D[jl].x + 1e-6]; finRef = A.x;
      }
    }
    // Nasenpunkt: Mitte des ersten Schnitts, Breite 0
    const n0 = D[0], yN = (n0.top + n0.bot) / 2;
    if (n0.x > 0.01) D.unshift({ x: 0, top: yN, bot: yN, w: 0, yw: yN });
    const x1 = D[D.length - 1].x;
    // halbe Breite: gleitender Median über 5 Schnitte gegen Einzelsprünge (Anfang/Ende entfernter Anbauten), Kanten bleiben
    if (opt.wing) { const w0 = D.map(d => d.w); for (let k = 2; k < D.length - 2; k++) D[k].w = w0.slice(k - 2, k + 3).sort((p, q) => p - q)[2]; }
    // Haube aus der Form: Oberkante ebenso (Teilungsfuge der Formhälften kann einzelne Schnitte stören)
    if (WM) { const t0 = D.map(d => d.top); for (let k = 2; k < D.length - 2; k++) if (D[k].mold) D[k].top = t0.slice(k - 2, k + 3).sort((p, q) => p - q)[2]; }
    const tol = Math.max(0.02, +opt.tol || 0.3), outMax = Math.max(4, Math.round(+opt.outMax || 40));
    const out = { spl: 'c2' }, errs = {};
    for (const key of LINES) {
      const a = fitOutLine(D, key, tol, outMax, true), b = fitOutLine(D, key, tol, outMax, false);
      const r = (b.err <= tol && (a.err > tol || b.P.length < a.P.length)) || (a.err > tol && b.err < a.err) ? b : a;
      out[key] = r.P; errs[key] = r.err;
    }
    // Dickenlinie: Mitte des Bands größter Breite (bei fast senkrechten Flanken wandert der einzelne Größtwert), dann
    // über die Länge geglättet (Median, dann Gauß ±2 % der Länge) — daraus liegt die breiteste Stelle jedes Spants fest.
    const segs = { top: outSegs(out.top, 'c2'), bot: outSegs(out.bot, 'c2'), w: outSegs(out.w, 'c2') };
    const ywS = (() => {
      const xs = D.map(d => d.x), y0s = D.map(d => d.ym != null ? d.ym : d.yw), sg = 0.02 * x1;
      // erst gleitender Median (±3 % der Länge) gegen Ausreißer (Reste von Anbauten), dann Gauß
      const ys = xs.map((x, k) => { const v = []; for (let q = 0; q < xs.length; q++) if (Math.abs(xs[q] - x) <= 0.03 * x1) v.push(y0s[q]); v.sort((p, q) => p - q); return v.length ? v[v.length >> 1] : y0s[k]; });
      return x => {
        let a = 0, b = 0;
        for (let k = 0; k < xs.length; k++) { const d = (xs[k] - x) / sg; if (d * d > 9) continue; const g = Math.exp(-0.5 * d * d); a += g * ys[k]; b += g; }
        return b > 0 ? a / b : (lineAt(segs.top, x) + lineAt(segs.bot, x)) / 2;
      };
    })();
    const inZx = x => (finZone && x > finZone[0] && x < finZone[1]) || canZones.some(Z => x > Z[0] && x < Z[1]);
    // Haubenlinie: erste Kante des Haubenausschnitts im Rumpf (ohne Form) dort, wo die Form die Haube liefert; Enden bis
    // zur Oberkante verlängert -> freier Linienzug im Reiter Rumpf (Kabinenhaube, Haubenstärke = glass)
    let khRep = null;
    if (WM && opt.khLine !== false) {
      const Ef = canopyEdgeLine(W, WM, st, x1, x => lineAt(segs.top, x));
      if (Ef) {
        const f = fitKhLine(Ef, 0.5, 12);
        const k = state.cfg.rproKh = Object.assign(JSON.parse(JSON.stringify(DEF.rproKh)), state.cfg.rproKh || {});
        k.on = true; k.mode = 'free'; k.pts = f.pts; k.glass = r2(glass);
        khRep = { n: f.pts.length, err: r2(f.err), x0: r1(Ef[0][0]), x1: r1(Ef[Ef.length - 1][0]) };
      }
    }
    const cutAt = x => clamp(x, 0.05, Lx - 0.05);
    const stCache = new Map();
    const stAt = x => {   // Schnitt bei x, Haube nur in überbrückten Bereichen abgeschnitten
      const key = r2(x); if (stCache.has(key)) return stCache.get(key);
      let r = st(cutAt(x));
      if (r && r.can && !canZones.some(Z => x > Z[0] && x < Z[1])) r = meshStation(sliceSoup(W, 0, cutAt(x)), { fin: opt.fin, wing: opt.wing, mold: mSlice(cutAt(x)), glass });
      stCache.set(key, r); return r;
    };
    // normierte Kontur eines Schnitts (Kasten = Umrisse bei x)
    const normPts = (x, r) => {
      const Tp = lineAt(segs.top, x), Bt = lineAt(segs.bot, x), Wd = Math.max(1e-3, lineAt(segs.w, x)), h = Math.max(1e-3, Tp - Bt);
      if (finRef != null && x > finZone[0] && x <= finZone[1]) {   // Leitwerksbereich: Querschnitt vor dem Leitwerk übernehmen
        const q = normPts(finRef, stAt(finRef));
        return { P: q.P.map(p => p.slice()), yN: clamp((ywS(x) - Bt) / h, 0.03, 0.97), scale: Math.max(h, Wd) };
      }
      let pts = r.pts;
      if (r.can && canZones.some(Z => x > Z[0] && x < Z[1])) pts = canopyCap(r.can, Tp).concat(pts.filter(p => p[0] < r.can.y - 1e-6));   // Kuppe statt Haube
      let P = pts.map(p => [(p[0] - Bt) / h, Math.max(0, p[1] / Wd)]);
      if (inZx(x)) { P = P.filter(p => p[0] < 1); P.unshift([1, 0]); }   // Leitwerksnase/Haube oben abschneiden
      P[0][0] = 1; P[P.length - 1][0] = 0;   // Enden genau auf Ober-/Unterkante
      return { P, yN: clamp((ywS(x) - Bt) / h, 0.03, 0.97), scale: Math.max(h, Wd) };
    };
    // Gleicher Knotenaufbau für alle Spanten (oben, nu Knoten, breiteste Stelle, nl Knoten, unten): so überblendet Rumpf
    // Knoten für Knoten und die Dickenlinie bleibt glatt. nu/nl wachsen, bis Probeschnitte passen.
    const maxN = Math.max(3, Math.round(+opt.nodes || 10)), nTol = 0.004;
    let nu = 1, nl = 1, FR = null;
    if (opt.type !== 'egg') {
      const probe = [];
      for (let k = 0; k < 24; k++) { const x = x1 * (0.03 + 0.94 * k / 23); if (inZx(x)) continue; const r = stAt(x); if (r) probe.push(normPts(x, r)); }
      let fits = [];
      for (;;) {
        let eu = 0, el = 0; fits = [];
        for (const q of probe) { const f = fitFixed(q.P, q.yN, nu, nl); fits.push(f); eu = Math.max(eu, f.eu); el = Math.max(el, f.el); }
        if ((eu <= nTol && el <= nTol) || nu + nl + 3 >= maxN) break;
        if (eu >= el) nu++; else nl++;
      }
      // Knotenlage je Platz = Median der eingepassten Lagen aller Probeschnitte
      const med = a => { const b = a.slice().sort((p, q) => p - q); return b[b.length >> 1]; };
      FR = { u: [], l: [] };
      for (let k = 0; k < nu; k++) FR.u.push(med(fits.map(f => f.frac.u[k]).filter(v => isFinite(v))));
      for (let k = 0; k < nl; k++) FR.l.push(med(fits.map(f => f.frac.l[k]).filter(v => isFinite(v))));
      FR.u.sort((p, q) => p - q); FR.l.sort((p, q) => p - q);
    }
    const mkFormer = x => {
      const r = stAt(x); if (!r) return null;
      if (opt.type === 'egg') return { f: normFr({ x: r1(x), type: 'egg', p: { yw: r2(ywS(x)) }, ctl: { yw: true } }), err: 0 };
      const q = normPts(x, r), f = fitFixed(q.P, q.yN, nu, nl, FR);
      const nodes = f.nodes.map(n => ({ y: n.y, z: n.z, i: n.i.map(v => Math.round(v * 1e5) / 1e5), o: n.o.map(v => Math.round(v * 1e5) / 1e5) }));
      return { f: normFr({ x: r1(x), type: 'free', nodes }), err: inZx(x) ? 0 : Math.max(f.eu, f.el) * q.scale };
    };
    // Abweichung des fertigen Rumpf-Körpers vom Netz je Prüfschnitt (mm)
    const test = [];
    for (let k = 1; k < 80; k++) {
      const x = x1 * k / 80; if (inZx(x)) continue;
      const r = stAt(x); if (!r) continue;
      const pts = (r.can ? r.pts.filter(p => p[0] < r.can.y) : r.pts).filter((p, i) => i % 3 === 0);
      test.push({ x, pts });
    }
    const devAt = t => {
      const H = bodyHalf(model, t.x); let mx = 0;
      for (const p of t.pts) {
        let dm = Infinity;
        for (let i = 0; i + 1 < H.length; i++) {
          const a = H[i], b = H[i + 1], ux = b[0] - a[0], uy = b[1] - a[1], L2 = ux * ux + uy * uy || 1e-12;
          const tt = clamp(((p[0] - a[0]) * ux + (p[1] - a[1]) * uy) / L2, 0, 1);
          dm = Math.min(dm, Math.hypot(a[0] + ux * tt - p[0], a[1] + uy * tt - p[1]));
        }
        if (dm > mx) mx = dm;
      }
      return mx;
    };
    // Spanten sparsam setzen: Nase, dickste Stelle, Heck; dann jeweils dort einen Spant, wo der Körper am weitesten vom Netz
    // abweicht — bis die Toleranz passt oder die Höchstzahl erreicht ist (Mindestabstand 2 % der Länge).
    const nMax = Math.max(2, Math.round(+opt.nFr || 14)), frTol = Math.max(0.1, +opt.frTol || 1), gap = 0.02 * x1;
    let iw = 0; for (let k = 0; k < D.length; k++) if (D[k].w > D[iw].w) iw = k;
    const xsF = [0.015 * x1, D[iw].x, x1 - 0.005 * x1].filter((x, k, a) => a.findIndex(y => Math.abs(y - x) < gap) === k);
    const frOf = new Map();
    const apply = () => {
      const fr = xsF.slice().sort((a, b) => a - b).map(x => { if (!frOf.has(x)) frOf.set(x, mkFormer(x)); return frOf.get(x); }).filter(Boolean);
      state.cfg.rproOut = JSON.parse(JSON.stringify(out)); state.cfg.rproFr = fr.map(q => JSON.parse(JSON.stringify(q.f))).map(normFr);
      state.cfg.rproSel = 0; state.cfg.rproPt = null; state.cfg.rproFix = JSON.parse(JSON.stringify(DEF.rproFix));
      build();
      return fr;
    };
    let fr = apply(), dev = 0;
    for (;;) {
      if (!model || model.err) break;
      let wi = -1; dev = 0;
      for (const t of test) { const e = devAt(t); if (e > dev && xsF.every(x => Math.abs(x - t.x) >= gap)) { dev = e; wi = t.x; } }
      if (dev <= frTol || wi < 0 || xsF.length >= nMax) break;
      xsF.push(wi); fr = apply();
    }
    if (fr.length < 2) throw new Error(T('Zu wenige Spanten.'));
    let devAll = 0; if (model && !model.err) for (const t of test) devAll = Math.max(devAll, devAt(t));
    const nErr = Math.max(0, ...fr.map(q => q.err));
    return { canZones: canZones.map(z => z.map(r1)), len: r1(x1), axes: 'XYZ'[L] + '/' + (us < 0 ? '−' : '') + 'XYZ'[U] + '/' + 'XYZ'[S], noseMin, zc: r2(zc), pts: LINES.map(k => out[k].length), errs, nFr: fr.length, nodes: nu + nl + 3, nodeErr: r2(nErr), dev: r2(devAll), fin: finN, wing: wingN, kh: khRep, tailCut };
  }
  // ---- Kabinenhaube aus der Negativform (für „3D-Bearbeitung") ---------------------------------
  // fus: Rumpf-Dreiecke (Lage/Achsen, Ausschnittkante), molds: Liste Formkörper-Dreiecke. Der Hohlraum der Form ist der
  // Tiefziehklotz = Haube innen; je Schnitt von der Hohlraumdecke bis zur ersten Kante des Haubenausschnitts im Rumpf
  // (ohne Rumpf: bis zur Unterkante des Hohlraums), als Gitter geloftet, außen um t entlang der Gitternormalen versetzt,
  // Ränder geschlossen. → { soup (Weltlage), x0, x1, n, t } | { err }
  function canopyFromMold(fus, molds, opt) {
    opt = Object.assign({ t: 1, dx: 2, K: 40, trim: true }, opt || {});
    const ML = (Array.isArray(molds) ? molds : [molds]).filter(q => q && q.length >= 9);
    if (!ML.length) return { err: T('Keine Formkörper gewählt.') };
    const hasF = fus && fus.length >= 9;
    const F = meshFrame(hasF ? fus : ML.reduce((a, b) => { const c = new Float32Array(a.length + b.length); c.set(a); c.set(b, a.length); return c; }), opt);
    const W = hasF ? F.toLocal(fus) : null, WM = ML.map(F.toLocal), t = Math.max(0, +opt.t || 0);
    const mSlice = x => WM.map(w => sliceSoup(w, 0, x)), cavAll = (sl, y) => { let c = 0; for (const q of sl) c = Math.max(c, cavZ(q, y)); return c; };
    let mx0 = Infinity, mx1 = -Infinity, my0 = Infinity, my1 = -Infinity;
    for (const w of WM) for (let i = 0; i < w.length; i += 3) { mx0 = Math.min(mx0, w[i]); mx1 = Math.max(mx1, w[i]); my0 = Math.min(my0, w[i + 1]); my1 = Math.max(my1, w[i + 1]); }
    // Hohlraum je Schnitt: Decke (von oben gesucht, wie meshStation) und Kontur z(y)
    const ceil = (sl, yLo) => {
      for (let y = my1 - 0.5; y > yLo; y -= 0.5) if (cavAll(sl, y) > 0 && (cavAll(sl, y - 1) > 0 || cavAll(sl, y - 2) > 0 || cavAll(sl, y - 3) > 0)) {
        let lo = y, hi = y + 0.5; for (let q = 0; q < 20; q++) { const mid = (lo + hi) / 2; if (cavAll(sl, mid) > 0) lo = mid; else hi = mid; }
        return lo;
      }
      return null;
    };
    // Unterkante je x: Haubenkante aus dem Rumpf, sonst Hohlraum bis ganz unten
    let edgeAt = null, xa = mx0 + 0.5, xb = mx1 - 0.5;
    if (hasF && opt.trim) {
      const x1 = F.ext[F.L];
      const st = x => meshStation(sliceSoup(W, 0, x), { mold: mSlice(x), glass: t });
      const Ef = canopyEdgeLine(W, WM, st, x1, x => { const r = st(x); return r ? r.top : 0; });
      if (!Ef) return { err: T('Keine Ausschnittkante im Rumpf gefunden — Rumpfteile mit Haubenausschnitt sichtbar lassen.') };
      xa = Ef[0][0]; xb = Ef[Ef.length - 1][0];
      edgeAt = x => { if (x <= Ef[0][0]) return Ef[0][1]; for (let i = 0; i + 1 < Ef.length; i++) if (x <= Ef[i + 1][0]) { const a = Ef[i], b = Ef[i + 1], u = (x - a[0]) / ((b[0] - a[0]) || 1); return a[1] + (b[1] - a[1]) * u; } return Ef[Ef.length - 1][1]; };
    }
    // Stationen
    const nx = Math.max(4, Math.ceil((xb - xa) / Math.max(0.5, +opt.dx || 2))), K = Math.max(8, Math.round(+opt.K || 40)), rows = [];
    for (let i = 0; i <= nx; i++) {
      const x = xa + (xb - xa) * i / nx, sl = mSlice(x);
      const yc0 = ceil(sl, (edgeAt ? edgeAt(x) : my0) - 1);
      if (yc0 == null) { rows.push(null); continue; }
      const yc = yc0;
      let yLo = edgeAt ? edgeAt(x) : null;
      if (yLo == null) { yLo = yc; while (yLo - 0.5 > my0 && cavAll(sl, yLo - 0.5) > 0) yLo -= 0.5; }   // ohne Kante: so weit der Hohlraum nach unten reicht
      if (yc <= yLo + 0.05) { rows.push(null); continue; }
      // halbe Kontur von der Decke bis yLo (cos-verteilt), dann nach Bogenlänge auf K Punkte
      const dense = [[yc, 0]], NL = 120;
      for (let q = 1; q <= NL; q++) { const y = yc - (yc - yLo) * (1 - Math.cos(Math.PI * q / NL)) / 2; dense.push([y, cavAll(sl, y)]); }
      const arc = [0]; for (let q = 1; q < dense.length; q++) arc.push(arc[q - 1] + Math.hypot(dense[q][0] - dense[q - 1][0], dense[q][1] - dense[q - 1][1]));
      const half = [];
      for (let q = 0; q <= K; q++) { const sA = arc[arc.length - 1] * q / K; let m = 1; while (m < arc.length - 1 && arc[m] < sA) m++; const u = (sA - arc[m - 1]) / ((arc[m] - arc[m - 1]) || 1); half.push([dense[m - 1][0] + (dense[m][0] - dense[m - 1][0]) * u, dense[m - 1][1] + (dense[m][1] - dense[m - 1][1]) * u]); }
      // Ring: Kante links (−z) -> Decke -> Kante rechts (+z)
      const ring = []; for (let q = K; q >= 1; q--) ring.push([x, half[q][0], -half[q][1]]); for (let q = 0; q <= K; q++) ring.push([x, half[q][0], half[q][1]]);
      rows.push(ring);
    }
    // an den Enden (Linie trifft die Oberkante) zu einem Punkt zusammenlaufen lassen; Lücken überspringen
    const G = rows.filter(Boolean); if (G.length < 2) return { err: T('Im Formhohlraum keine Haube gefunden.') };
    const nR = G.length, nC = G[0].length, P = (i, k) => G[i][k];
    // Normalen (aus dem Gitter), nach außen = von der Haubenmitte weg
    const N = G.map((row, i) => row.map((p, k) => {
      const a = P(Math.min(nR - 1, i + 1), k), b = P(Math.max(0, i - 1), k), c = P(i, Math.min(nC - 1, k + 1)), d = P(i, Math.max(0, k - 1));
      const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], v = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const L = Math.hypot(n[0], n[1], n[2]);
      if (L < 1e-12) n = [0, p[1] > 0 ? 1 : 0, Math.sign(p[2])]; else n = n.map(q => q / L);
      return n;
    }));
    // Vorzeichen: an der Decke der mittleren Station muss die Normale nach oben zeigen
    const mi = nR >> 1, mk = nC >> 1, sg = N[mi][mk][1] >= 0 ? 1 : -1;
    const Q = G.map((row, i) => row.map((p, k) => [p[0] + sg * N[i][k][0] * t, p[1] + sg * N[i][k][1] * t, p[2] + sg * N[i][k][2] * t]));
    const tri = [], push = (a, b, c) => {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      if (Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) < 1e-9) return;   // entartet
      tri.push(a, b, c);
    };
    const quad = (a, b, c, d, flip) => { if (flip) { push(a, c, b); push(a, d, c); } else { push(a, b, c); push(a, c, d); } };
    // Umlauf untereinander stimmig (außen Q, innen G umgekehrt, Ränder passend); die Richtung insgesamt legt am Ende das
    // Vorzeichen des Volumens in Weltlage fest
    for (let i = 0; i + 1 < nR; i++) for (let k = 0; k + 1 < nC; k++) {
      quad(Q[i][k], Q[i + 1][k], Q[i + 1][k + 1], Q[i][k + 1], false);
      if (t > 0) quad(G[i][k], G[i + 1][k], G[i + 1][k + 1], G[i][k + 1], true);
    }
    if (t > 0) {
      for (let i = 0; i + 1 < nR; i++) { quad(G[i][0], G[i + 1][0], Q[i + 1][0], Q[i][0], false); quad(G[i][nC - 1], G[i + 1][nC - 1], Q[i + 1][nC - 1], Q[i][nC - 1], true); }
      for (let k = 0; k + 1 < nC; k++) { quad(G[0][k], G[0][k + 1], Q[0][k + 1], Q[0][k], true); quad(G[nR - 1][k], G[nR - 1][k + 1], Q[nR - 1][k + 1], Q[nR - 1][k], false); }
    }
    const soup = new Float32Array(tri.length * 3), tmp = [0, 0, 0];
    tri.forEach((p, i) => { F.toWorld(p[0], p[1], p[2], tmp, 0); soup[i * 3] = tmp[0]; soup[i * 3 + 1] = tmp[1]; soup[i * 3 + 2] = tmp[2]; });
    let vol = 0;
    for (let i = 0; i < soup.length; i += 9) {
      const a = i, b = i + 3, c = i + 6;
      vol += soup[a] * (soup[b + 1] * soup[c + 2] - soup[b + 2] * soup[c + 1]) - soup[a + 1] * (soup[b] * soup[c + 2] - soup[b + 2] * soup[c]) + soup[a + 2] * (soup[b] * soup[c + 1] - soup[b + 1] * soup[c]);
    }
    const flipAll = t > 0 ? vol < 0 : (() => { const p = Q[mi][mk], q = Q[mi + 1 < nR ? mi + 1 : mi - 1][mk], r = Q[mi][mk + 1]; const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]]; return ((u[2] * v[0] - u[0] * v[2]) >= 0) !== (mi + 1 < nR); })();
    if (flipAll) for (let i = 0; i < soup.length; i += 9) for (let c = 0; c < 3; c++) { const v = soup[i + 3 + c]; soup[i + 3 + c] = soup[i + 6 + c]; soup[i + 6 + c] = v; }
    return { soup, x0: r1(xa), x1: r1(xb), n: tri.length / 3, t, trimmed: !!edgeAt };
  }
  // DevFus „Initial Formers": n Spanten gleichmäßig zwischen Nase+dF und Heck−dR, alle gleicher Typ.
  function initFormers(n, dF, dR, type) {
    const o = outlines(), x0 = o.top[0].x, x1 = o.top[o.top.length - 1].x;
    const a = x0 + Math.max(0, dF), b = x1 - Math.max(0, dR), fr = [];
    n = Math.max(2, Math.round(n));
    for (let k = 0; k < n; k++) {
      const x = r1(a + (b - a) * k / (n - 1)), f = { x, type };
      if (type === 'egg') { f.p = { yw: r2((outAt('top', x) + outAt('bot', x)) / 2) }; f.ctl = {}; }
      if (type === 'tri') { const t = outAt('top', x), b = outAt('bot', x); f.p = { yw: r2(b + 0.25 * (t - b)) }; f.ctl = {}; }
      if (type === 'free') f.nodes = circleNodes(0.5);
      fr.push(normFr(f));
    }
    state.cfg.rproFr = fr; S('rproSel', 0);
  }
  // DevFus „Space evenly from … to …"
  function spaceEvenly(i0, i1) {
    const fr = formers(); sortFormers();
    i0 = clamp(Math.round(i0), 0, fr.length - 1); i1 = clamp(Math.round(i1), 0, fr.length - 1); if (i1 - i0 < 2) return;
    const a = fr[i0].x, b = fr[i1].x;
    for (let k = i0 + 1; k < i1; k++) if (!xFixed(fr[k]) && !fr[k].jmp) moveFormerX(fr[k], r1(a + (b - a) * (k - i0) / (i1 - i0)));
  }

  // ---- Parameter: Steuerspant / Interpolation -------------------------------------------
  function gVals(P, g) { return g === 'yw' ? [P.yw] : g === 'rt' ? [P.rtx, P.rty] : g === 'rb' ? [P.rbx, P.rby] : g === 'sl' ? [P.sl] : g === 'vo' ? [P.vot, P.vow, P.vos] : g === 'vu' ? [P.vut, P.vuw, P.vus] : [P.dia]; }
  function gSet(P, g, v) {
    if (g === 'yw') P.yw = v[0]; else if (g === 'rt') { P.rtx = v[0]; P.rty = v[1]; } else if (g === 'rb') { P.rbx = v[0]; P.rby = v[1]; }
    else if (g === 'sl') P.sl = v[0]; else if (g === 'vo') { P.vot = v[0]; P.vow = v[1]; P.vos = v[2]; } else if (g === 'vu') { P.vut = v[0]; P.vuw = v[1]; P.vus = v[2]; } else P.dia = v[0];
  }
  // Umriss-Kasten bei x (ohne Kreis-Spanten).
  function boxBase(m, x) {
    const top = lineAt(m.L.top, x), bot = lineAt(m.L.bot, x), w = Math.max(0, lineAt(m.L.w, x));
    return { top, bot, w, h: top - bot };
  }
  // Halbe Breite an Ober-/Unterkante des Trapezes (die Breite aus der Draufsicht gilt auf halber Höhe).
  function cornerZ(bx, sl) { const t = Math.tan(clamp(+sl || 0, -60, 60) * Math.PI / 180) * bx.h / 2; return { zt: Math.max(0, bx.w + t), zb: Math.max(0, bx.w - t) }; }
  function isCtl(m, k, g) { const f = m.FR[k], r = m.run[k]; if (!f) return false; /* Modell noch vom vorherigen Projekt */ return !!f.ctl[g] || k === m.runA[r] || k === m.runB[r]; }
  // Wert der Parametergruppe g bei x im Lauf r (aus den Steuerspanten des Laufs).
  function interpG(m, g, x, r) {
    const Ci = m.ctlIdx[r][g], FR = m.FR, P = m.P;
    if (Ci.length === 1) return gVals(P[Ci[0]], g);
    let a = 0; while (a + 2 < Ci.length && x > FR[Ci[a + 1]].x) a++;
    const ia = Ci[a], ib = Ci[a + 1], xa = FR[ia].x, xb = FR[ib].x, D = (xb - xa) || 1, t = clamp((x - xa) / D, 0, 1);
    const Va = gVals(P[ia], g), Vb = gVals(P[ib], g), mode = FR[ia].mode[g], lerp = (p, q) => p + (q - p) * t;
    if (g === 'yw' && mode === 'spl') {
      const tng = k => { const pp = Ci[Math.max(0, k - 1)], nn = Ci[Math.min(Ci.length - 1, k + 1)], dx = FR[nn].x - FR[pp].x; return dx > 1e-9 ? (P[nn].yw - P[pp].yw) / dx : 0; };
      const ma = tng(a) * D, mb = tng(a + 1) * D, t2 = t * t, t3 = t2 * t;
      return [(2 * t3 - 3 * t2 + 1) * Va[0] + (t3 - 2 * t2 + t) * ma + (-2 * t3 + 3 * t2) * Vb[0] + (t3 - t2) * mb];
    }
    if ((g === 'rt' || g === 'rb') && (mode === 'prop' || mode === 'line')) {
      const A = boxBase(m, xa), B = boxBase(m, xb), X = boxBase(m, x);
      const ca = cornerZ(A, P[ia].sl), cb = cornerZ(B, P[ib].sl), cx = cornerZ(X, lerp(P[ia].sl, P[ib].sl));
      const za = g === 'rt' ? ca.zt : ca.zb, zb = g === 'rt' ? cb.zt : cb.zb, zx = g === 'rt' ? cx.zt : cx.zb;
      if (mode === 'prop') return [lerp(Va[0] / (za || 1), Vb[0] / (zb || 1)) * zx, lerp(Va[1] / (A.h || 1), Vb[1] / (B.h || 1)) * X.h];
      // gerade: die Übergangspunkte (Ende der Verrundung) laufen in X geradlinig
      const ya = g === 'rt' ? A.top - Va[1] : A.bot + Va[1], yb = g === 'rt' ? B.top - Vb[1] : B.bot + Vb[1];
      return [Math.max(0, zx - lerp(za - Va[0], zb - Vb[0])), Math.max(0, g === 'rt' ? X.top - lerp(ya, yb) : lerp(ya, yb) - X.bot)];
    }
    return Va.map((v, k) => lerp(v, Vb[k]));
  }
  // Läufe, Steuerspanten und aufgelöste Parameter aller Spanten.
  function prepFormers(m) {
    const FR = m.FR, n = FR.length;
    m.run = []; m.runA = []; m.runB = [];
    let r = -1;
    for (let j = 0; j < n; j++) { if (j === 0 || FR[j - 1].type !== FR[j].type || FR[j].jmp === 'b') { r++; m.runA[r] = j; } m.run[j] = r; m.runB[r] = j; }
    m.P = FR.map(f => Object.assign({}, f.p));
    m.P.forEach((P, j) => { if (P.yw == null || !isFinite(P.yw)) { const b = boxBase(m, FR[j].x); P.yw = (b.top + b.bot) / 2; } });
    m.ctlIdx = [];
    for (let q = 0; q <= r; q++) {
      const type = FR[m.runA[q]].type, o = {};
      for (const g of PGROUPS[type]) { o[g] = []; for (let k = m.runA[q]; k <= m.runB[q]; k++) if (isCtl(m, k, g)) o[g].push(k); }
      m.ctlIdx.push(o);
    }
    // Neigung zuerst (Radien „proportional/gerade" brauchen sie), dann der Rest
    for (const g of PORDER)
      for (let j = 0; j < n; j++) if (PGROUPS[FR[j].type].indexOf(g) >= 0 && !isCtl(m, j, g)) gSet(m.P[j], g, interpG(m, g, FR[j].x, m.run[j]));
    // fixierte Dickenlinie
    for (let j = 0; j < n; j++) if (PGROUPS[FR[j].type].indexOf('yw') >= 0) { const y = widAt(FR[j].x); if (y != null) m.P[j].yw = y; }
  }
  // Aufgelöste Parameter bei x (zwischen zwei Spanten desselben Laufs).
  function paramsAt(m, x, r) {
    const type = m.FR[m.runA[r]].type, P = Object.assign({}, PDEF);
    for (const g of PORDER) if (PGROUPS[type].indexOf(g) >= 0) gSet(P, g, interpG(m, g, x, r));
    if (PGROUPS[type].indexOf('yw') >= 0) { const y = widAt(x); if (y != null) P.yw = y; }   // fixierte Dickenlinie
    return P;
  }
  // Abgerundetes Rechteck/Trapez -> normierte Bezier-Knoten (oben Mitte -> unten Mitte).
  // Verrundung je Ecke als Ellipsenviertel (Griffe KAPPA·Radius zur Ecke hin). bad = Radien gekürzt.
  function rectNodes(P, bx) {
    const h = Math.max(1e-6, bx.h), W = Math.max(1e-6, bx.w), { zt, zb } = cornerZ(bx, P.sl);
    let rtx = Math.max(0, +P.rtx || 0), rbx = Math.max(0, +P.rbx || 0), rty = Math.max(0, +P.rty || 0), rby = Math.max(0, +P.rby || 0), bad = '';
    if (rtx > zt + 1e-6) { rtx = zt; bad = T('Eckradius X oben > halbe Breite'); }
    if (rbx > zb + 1e-6) { rbx = zb; bad = T('Eckradius X unten > halbe Breite'); }
    if (rty + rby > h + 1e-6) { const f = h / (rty + rby); rty *= f; rby *= f; bad = T('Eckradien Y zusammen > Höhe'); }
    const Ct = [bx.top, zt], Cb = [bx.bot, zb], L = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const A = [bx.top, 0], B = [bx.top, zt - rtx], Cs = L(Ct, Cb, rty / h), D = L(Ct, Cb, 1 - rby / h), E = [bx.bot, zb - rbx], F = [bx.bot, 0];
    const v = (p, q, f) => [(q[0] - p[0]) * f, (q[1] - p[1]) * f];
    const nd = [
      { p: A, i: [0, 0], o: v(A, B, 1 / 3) },
      { p: B, i: v(B, A, 1 / 3), o: v(B, Ct, KAPPA) },
      { p: Cs, i: v(Cs, Ct, KAPPA), o: v(Cs, D, 1 / 3) },
      { p: D, i: v(D, Cs, 1 / 3), o: v(D, Cb, KAPPA) },
      { p: E, i: v(E, Cb, KAPPA), o: v(E, F, 1 / 3) },
      { p: F, i: v(F, E, 1 / 3), o: [0, 0] }
    ];
    const nodes = nd.map(q => ({ y: (q.p[0] - bx.bot) / h, z: q.p[1] / W, i: [q.i[0] / h, q.i[1] / W], o: [q.o[0] / h, q.o[1] / W] }));
    return { nodes, bad, geo: { Ct, Cb, B, Cs, D, E, zt, zb } };
  }
  // Gerundetes Dreieck/Tropfen: wie das Ei drei Knoten (oben, breiteste Stelle, unten), die Grifflängen
  // (Völligkeit in % des Wegs zur Ecke) aber frei: klein = fast gerade Flanke mit runder Ecke, 55 = Ellipse.
  // Spitze oben/unten (vos/vus = Öffnungswinkel in °, 180 = rund, waagrechte Tangente an der Symmetrieebene): der Griff
  // am Ober-/Unterknoten zeigt in der wahren Form (Höhe bx.h, halbe Breite bx.w) um (180 − Winkel)/2 schräg nach unten bzw.
  // oben — gespiegelt ergibt das den Knick. Länge = Völligkeit wie bisher.
  function triNodes(P, m, bx) {
    const v = (x, d) => clamp((isFinite(+x) ? +x : d) / 100, 0.02, 1);
    const h = bx && bx.h > 1e-6 ? bx.h : 1, w = bx && bx.w > 1e-6 ? bx.w : 1;
    const tip = (ang, sgn) => {
      const b = clamp(isFinite(+ang) ? +ang : 180, 20, 180) * Math.PI / 360, dy = sgn * Math.cos(b) / h, dz = Math.sin(b) / w, L = Math.hypot(dy, dz) || 1;
      return [dy / L, dz / L];
    };
    const tT = tip(P.vos, -1), tB = tip(P.vus, 1), lT = v(P.vot, 25), lB = v(P.vut, 55);
    return [
      { y: 1, z: 0, i: [0, 0], o: [tT[0] * lT, tT[1] * lT] },
      { y: m, z: 1, i: [v(P.vow, 35) * (1 - m), 0], o: [-v(P.vuw, 45) * m, 0] },
      { y: 0, z: 0, i: [tB[0] * lB, tB[1] * lB], o: [0, 0] }
    ];
  }
  // Normierte Knoten eines Parameter-Querschnitts.
  function shapeNodes(type, P, bx) {
    if (type === 'rect') return rectNodes(P, bx).nodes;
    if (type === 'egg') return circleNodes(clamp((P.yw - bx.bot) / (bx.h || 1), 0.03, 0.97));
    if (type === 'tri') return triNodes(P, clamp((P.yw - bx.bot) / (bx.h || 1), 0.03, 0.97), bx);
    return circleNodes(0.5);
  }
  // Überblendung der Knoten (Catmull-Rom über die Spanten) — für Übergänge zwischen Typen und freie Spanten.
  // brk[j] = true: zwischen Spant j-1 und j liegt eine Sprungstelle — Tangenten dort einseitig (kein Überschwingen).
  function prepMorph(xs, nodeList, brk) {
    const MA = unify(nodeList.map(nd => ({ nodes: nd }))).map(flat), M = xs.length, MI = [], MO = [];
    brk = brk || [];
    for (let j = 0; j < M; j++) {
      const A = MA[j], I = new Array(A.length).fill(0), O = new Array(A.length).fill(0);
      for (let q = 0; q < A.length; q++) {
        if (j > 0 && j < M - 1 && !brk[j] && !brk[j + 1]) { const D = (xs[j + 1] - xs[j - 1]) || 1, d = MA[j + 1][q] - MA[j - 1][q]; O[q] = d * (xs[j + 1] - xs[j]) / D / 3; I[q] = -d * (xs[j] - xs[j - 1]) / D / 3; }
        else {
          if (j < M - 1) O[q] = (MA[j + 1][q] - A[q]) / 3;
          if (j > 0) I[q] = -(A[q] - MA[j - 1][q]) / 3;
        }
      }
      MI.push(I); MO.push(O);
    }
    return { MA, MI, MO, nn: MA[0].length / 6 };
  }
  function morphAt(m, j, x) {
    const a = m.FR[j], b = m.FR[j + 1], t = clamp((x - a.x) / ((b.x - a.x) || 1), 0, 1);
    const A = m.MA[j], B = m.MA[j + 1], O = m.MO[j], I = m.MI[j + 1], out = new Array(A.length);
    for (let q = 0; q < A.length; q++) out[q] = bez1(A[q], A[q] + O[q], B[q] + I[q], B[q], t);
    return unflat(out);
  }
  // Normierte Querschnittsknoten bei x.
  function sectionNodes(m, x) {
    const FR = m.FR, n = FR.length;
    if (n === 1 || x <= FR[0].x) return m.FN[0];
    if (x >= FR[n - 1].x) return m.FN[n - 1];
    let j = 0; while (j + 2 < n && x > FR[j + 1].x) j++;
    const a = FR[j], b = FR[j + 1];
    if (a.type === b.type && a.type !== 'free' && m.run[j] === m.run[j + 1]) return a.type === 'circle' ? circleNodes(0.5) : shapeNodes(a.type, paramsAt(m, x, m.run[j]), boxBase(m, x));
    return morphAt(m, j, x);
  }
  // Kasten bei x inkl. Kreis-Spanten (Abweichung zum Kreis, weich bis zu den Nachbarspanten ausgeblendet).
  function boxAt(m, x) {
    const b = boxBase(m, x);
    for (const c of m.circ) {
      let wt;
      if (x <= c.x) wt = c.xl == null ? 1 : (x <= c.xl ? 0 : smooth((x - c.xl) / ((c.x - c.xl) || 1)));
      else wt = c.xr == null ? 1 : (x >= c.xr ? 0 : smooth((c.xr - x) / ((c.xr - c.x) || 1)));
      if (wt > 0) { b.top += c.dT * wt; b.bot += c.dB * wt; b.w += c.dW * wt; }
    }
    b.w = Math.max(0, b.w); b.h = b.top - b.bot;
    return b;
  }

  // ---------- Kabinenhaube ---------------------------------------------------------------
  // Ausschnitt in der Seitenansicht (X/Y), quer durch den Rumpf: vordere Linie P1→P2, untere P2→P3, hintere
  // P3→P4 (P1/P4 auf der Oberkante), je gerade oder Spline (quadratische Bézier durch den Wölbungspunkt),
  // Ecken P2/P3 mit Übergangsradius — gleiche Bemaßung wie der Kabinenhaubenausschnitt im Reiter „Ausschnitte".
  function KH() { const k = C('rproKh'), d = DEF.rproKh; for (const q in d) if (k[q] === undefined) k[q] = d[q]; return k; }
  function khCurve(a, b, type, bulge, pos) {
    if (type !== 'spline') return { pts: [a.slice(), b.slice()], m: null };
    const t = clamp((+pos || 50) / 100, 0.1, 0.9), d = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(d[0], d[1]) || 1; bulge = +bulge || 0;
    const q = [a[0] + d[0] * t, a[1] + d[1] * t], M = [q[0] + d[1] / L * bulge, q[1] - d[0] / L * bulge];
    if (Math.abs(bulge) < 1e-6) return { pts: [a.slice(), b.slice()], m: M };
    const w = 2 * t * (1 - t), cx = (M[0] - (1 - t) * (1 - t) * a[0] - t * t * b[0]) / w, cy = (M[1] - (1 - t) * (1 - t) * a[1] - t * t * b[1]) / w;
    const pts = [], n = 48;
    for (let i = 0; i <= n; i++) { const u = i / n, k0 = (1 - u) * (1 - u), k1 = 2 * u * (1 - u), k2 = u * u; pts.push([k0 * a[0] + k1 * cx + k2 * b[0], k0 * a[1] + k1 * cy + k2 * b[1]]); }
    return { pts, m: M };
  }
  // Parallelversatz eines offenen Linienzugs um d (+ = links der Laufrichtung).
  function khOffset(P, d) {
    const n = P.length, nl = i => { const a = P[i], b = P[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [-dy / L, dx / L]; }, out = [];
    for (let i = 0; i < n; i++) {
      const n1 = nl(Math.max(0, i - 1)), n2 = nl(Math.min(n - 2, i)), p = P[i];
      const mx = n1[0] + n2[0], my = n1[1] + n2[1], ml = Math.hypot(mx, my), cosH = ml / 2;
      if (ml < 1e-9 || cosH < 0.35) { out.push([p[0] + n1[0] * d, p[1] + n1[1] * d]); out.push([p[0] + n2[0] * d, p[1] + n2[1] * d]); continue; }
      out.push([p[0] + mx / ml * d / cosH, p[1] + my / ml * d / cosH]);
    }
    return out;
  }
  function khSegX(a, b, c, d) {
    const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1], den = rx * sy - ry * sx; if (Math.abs(den) < 1e-12) return null;
    const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
    return [a[0] + t * rx, a[1] + t * ry];
  }
  function khNearest(P, x, y) {
    let best = null;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / L2, 0, 1) : 0;
      const px = a[0] + t * dx, py = a[1] + t * dy, d = Math.hypot(px - x, py - y);
      if (!best || d < best.d) best = { i, t, p: [px, py], d };
    }
    return best;
  }
  // Übergangsradius zwischen Linienzug A (endet in der Ecke) und B (beginnt dort): Mittelpunkt = Schnitt der
  // um r versetzten Linien (geht auch zwischen Splines). → { A, arc, B } · null = keiner · false = passt nicht.
  function khFillet(A, B, r) {
    if (!(r > 1e-6)) return null;
    const tA = [A[A.length - 1][0] - A[A.length - 2][0], A[A.length - 1][1] - A[A.length - 2][1]], tB = [B[1][0] - B[0][0], B[1][1] - B[0][1]];
    const cr = (tA[0] * tB[1] - tA[1] * tB[0]) / ((Math.hypot(tA[0], tA[1]) || 1) * (Math.hypot(tB[0], tB[1]) || 1));
    if (Math.abs(cr) < 1e-4) return null;
    const sg = cr > 0 ? 1 : -1, oA = khOffset(A, sg * r), oB = khOffset(B, sg * r), corner = B[0];
    let c = null, cd = Infinity;
    for (let i = 0; i < oA.length - 1; i++) for (let j = 0; j < oB.length - 1; j++) {
      const x = khSegX(oA[i], oA[i + 1], oB[j], oB[j + 1]);
      if (x) { const d = Math.hypot(x[0] - corner[0], x[1] - corner[1]); if (d < cd) { cd = d; c = x; } }
    }
    if (!c) return false;
    const fa = khNearest(A, c[0], c[1]), fb = khNearest(B, c[0], c[1]);
    const a0 = Math.atan2(fa.p[1] - c[1], fa.p[0] - c[0]); let da = Math.atan2(fb.p[1] - c[1], fb.p[0] - c[0]) - a0;
    if (sg > 0) { while (da <= 0) da += 2 * Math.PI; } else { while (da >= 0) da -= 2 * Math.PI; }
    if (Math.abs(da) > Math.PI) return false;
    const n = Math.max(2, Math.ceil(Math.abs(da) / (4 * Math.PI / 180))), arc = [];
    for (let i = 1; i < n; i++) { const a = a0 + da * i / n; arc.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
    return { A: A.slice(0, fa.i + 1).concat([fa.p]), arc, B: [fb.p].concat(B.slice(fb.i + 1)) };
  }
  function khJoin(parts) {
    const out = [];
    parts.forEach(P => P.forEach(p => { const l = out[out.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 1e-6) out.push(p); }));
    return out;
  }
  // Abschnitt a→b als eine Seite eines Tragflächenprofils: Sehne = Strecke a–b, Profilhöhe senkrecht dazu
  // (+ = in den Rumpf hinein, wie die Wölbung der Splines). → { pts, m (Griff an der dicksten Stelle), hm (Höhe bei 100 %) } · null = kein Profil
  function khFoil(a, b, s) {
    const pf = s.fSrc === 'dat' ? (s.fProf && s.fProf.pts ? profFn(s.fProf.pts) : null) : s.fSrc === 'wing' ? profFn(state.root && state.root.profile) : profFn(nacaProf(s.fThk || 12));
    if (!pf) return null;
    const d = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(d[0], d[1]) || 1, nx = d[1] / L, ny = -d[0] / L;
    const sc = (s.fScale == null || !isFinite(+s.fScale) ? 100 : +s.fScale) / 100, lo = s.fSide === 'lo', rev = s.fNose === 'b';
    const h = u => lo ? -pf.lo(u) : pf.up(u), h0 = h(0), h1 = h(1), n = 72, pts = []; let m = null, hm = 0;
    for (let i = 0; i <= n; i++) {
      const c = (1 - Math.cos(Math.PI * i / n)) / 2, t = rev ? 1 - c : c, off = (h(c) - h0 * (1 - c) - h1 * c) * L;
      const p = [a[0] + d[0] * t + nx * off * sc, a[1] + d[1] * t + ny * off * sc]; pts.push(p);
      if (Math.abs(off) > Math.abs(hm)) { hm = off; m = p; }
    }
    if (rev) pts.reverse();
    pts[0] = a.slice(); pts[pts.length - 1] = b.slice();
    return { pts, m, hm };
  }
  // Freier Linienzug: Punkte k.pts von der Oberkante zur Oberkante, je Abschnitt gerade, Spline oder Profilseite,
  // je Innenpunkt ein Eckradius. → { N, H (Griffe), Pn (Punkte), S (Abschnitte), P2 } · { err, H, Pn, S }
  function khFreeLine(k, m, top, inside, warns) {
    const src = Array.isArray(k.pts) ? k.pts : [], n = src.length;
    if (n < 2) return { err: T('Kabinenhaube zu klein.'), H: [], Pn: [], S: [] };
    const P = src.map((s, i) => { const x = clamp(+s.x || 0, m.x0 + 0.5, m.x1 - 0.5); return [x, i === 0 || i === n - 1 ? top(x) : +s.y || 0]; });
    const H = P.map((p, i) => ({ k: 'n' + i, p })), S = [], cv = [];
    for (let i = 0; i < n - 1; i++) {
      const s = src[i], a = P[i], b = P[i + 1]; let c;
      if (s.t === 'foil') { c = khFoil(a, b, s); if (!c) { warns.push(T('Kein Profil geladen — der Abschnitt bleibt gerade.')); c = { pts: [a.slice(), b.slice()], m: null }; } }
      else c = khCurve(a, b, s.t, s.curv, s.pos);
      S.push(c); cv.push(c.pts); if (c.m) H.push({ k: 's' + i, p: c.m });
    }
    for (let i = 1; i < n - 1; i++) if (!inside(P[i])) return { err: T('Punkte der Haubenlinie liegen außerhalb des Rumpfs — in den Rumpf ziehen.'), H, Pn: P, S };
    const parts = []; let A = cv[0];
    for (let i = 1; i < n - 1; i++) {
      let B = cv[i]; const r = Math.max(0, +src[i].r || 0), f = r > 0 ? (A.length > 1 ? khFillet(A, B, r) : false) : null;
      if (f) { parts.push(f.A, f.arc); B = khJoin([f.B]); }
      else { if (f === false) warns.push(T('Der Eckradius passt nicht zwischen die Linien — kleiner wählen.') + ' (' + T('Punkt') + ' ' + (i + 1) + ')'); parts.push(A); }
      A = B;
    }
    parts.push(A);
    return { N: khJoin(parts), H, Pn: P, S, P2: P[1] };
  }
  // Freien Linienzug aus den drei Linien (oder als Vorgabe) anlegen.
  function khToFree(k, q, m) {
    const sg = (t, c, p, r, x, y) => ({ x: r1(x), y: r1(y), r: r || 0, t: t === 'spline' ? 'spline' : 'line', curv: +c || 0, pos: +p || 50 });
    if (q && q.P1 && q.P4) k.pts = [sg(k.typeF, k.curvF, k.posF, 0, q.P1[0], q.P1[1]), sg(k.typeB, k.curvB, k.posB, +k.radF, q.P2[0], q.P2[1]), sg(k.typeR, k.curvR, k.posR, +k.radR, q.P3[0], q.P3[1]), sg('line', 0, 50, 0, q.P4[0], q.P4[1])];
    else if (m) { const L = m.x1 - m.x0, xa = m.x0 + 0.2 * L, xb = m.x0 + 0.45 * L, tp = x => boxAt(m, x).top; k.pts = [sg('line', 0, 50, 0, xa - 30, 0), sg('line', 0, 50, 15, xa, tp(xa) - 30), sg('line', 0, 50, 15, xb, tp(xb) - 30), sg('line', 0, 50, 0, xb + 30, 0)]; }
  }
  // → { N (Schnittlinie P1…P4), P1…P4, mF/mB/mR (Wölbungsgriffe), spans(x), sd(x,y), x0, x1, warns } · { err, P2, P3 } · null = aus
  //   freier Linienzug (k.mode 'free'): statt P1…P4 die Felder H/Pn/S aus khFreeLine
  function canopyGeom(m) {
    const k = KH(); if (!k.on) return null;
    const rad = Math.PI / 180, warns = [];
    const top = x => boxAt(m, clamp(x, m.x0, m.x1)).top;
    if (k.mode === 'free') {
      const R = khFreeLine(k, m, top, p => p[0] > m.x0 && p[0] < m.x1 && p[1] < top(p[0]), warns);
      if (R.err) return R;
      if (R.N.length < 2) return Object.assign(R, { N: null, err: T('Kabinenhaube zu klein.') });
      return khRegion(m, R.N, top, Object.assign(R, { warns }));
    }
    const L = Math.max(5, +k.len || 0), sl = clamp(+k.slope || 0, -60, 60) * rad;
    const aF = clamp(+k.angF || 0, 10, 170) * rad, aR = clamp(+k.angR || 0, 10, 170) * rad;
    const x2 = clamp(k.x == null || !isFinite(+k.x) ? m.x0 + 0.2 * (m.x1 - m.x0) : +k.x, m.x0 + 1, m.x1 - 1);
    const P2 = [x2, top(x2) - Math.max(0.5, +k.depth || 0)], P3 = [P2[0] + L * Math.cos(sl), P2[1] + L * Math.sin(sl)];
    const inside = p => p[0] > m.x0 && p[0] < m.x1 && p[1] < top(p[0]);
    if (!inside(P2) || !inside(P3)) return { err: T('Die Ecken der Kabinenhaube liegen außerhalb des Rumpfs — Lage, Tiefe, Länge oder Neigung anpassen.'), P2, P3 };
    // Austritt der vorderen/hinteren Linie aus der Oberkante
    const exit = (p, d) => {
      let t = 0; const at = q => [p[0] + d[0] * q, p[1] + d[1] * q];
      for (let q = 0; q < 8000 && inside(at(t + 0.5)); q++) t += 0.5;
      let lo = t, hi = t + 0.5; for (let q = 0; q < 30; q++) { const mid = (lo + hi) / 2; if (inside(at(mid))) lo = mid; else hi = mid; }
      return at(hi);
    };
    const P1 = exit(P2, [-Math.cos(aF), Math.sin(aF)]), P4 = exit(P3, [Math.cos(aR), Math.sin(aR)]);
    const cF = khCurve(P1, P2, k.typeF, k.curvF, k.posF), cB = khCurve(P2, P3, k.typeB, k.curvB, k.posB), cR = khCurve(P3, P4, k.typeR, k.curvR, k.posR);
    let A = cF.pts, B = cB.pts, Cc = cR.pts, arc1 = [], arc2 = [];
    const f1 = khFillet(A, B, Math.max(0, +k.radF || 0));
    if (f1) { A = f1.A; arc1 = f1.arc; B = f1.B; } else if (f1 === false) warns.push(T('Der vordere Radius passt nicht zwischen die Linien — kleiner wählen.'));
    B = khJoin([B]);
    const f2 = B.length > 1 ? khFillet(B, Cc, Math.max(0, +k.radR || 0)) : false;
    if (f2) { B = f2.A; arc2 = f2.arc; Cc = f2.B; } else if (f2 === false) warns.push(T('Der hintere Radius passt nicht zwischen die Linien — kleiner wählen.'));
    const N = khJoin([A, arc1, B, arc2, Cc]);
    if (N.length < 2) return { err: T('Kabinenhaube zu klein.'), P2, P3 };
    return khRegion(m, N, top, { N, P1, P2, P3, P4, mF: cF.m, mB: cB.m, mR: cR.m, warns });
  }
  // Fläche der Haube zur Schnittlinie N: ergänzt res um sd(x,y), spans(x), x0, x1.
  function khRegion(m, N, top, res) {
    // geschlossene Fläche: Linienenden über die Oberkante hinaus verlängern und weit oben schließen
    let yBig = -Infinity; for (let q = 0; q <= 60; q++) yBig = Math.max(yBig, top(m.x0 + (m.x1 - m.x0) * q / 60)); yBig += 200;
    const ext = (p, q) => { const d = [p[0] - q[0], p[1] - q[1]], l = Math.hypot(d[0], d[1]) || 1; return [p[0] + d[0] / l * 40, p[1] + d[1] / l * 40]; };
    const e0 = ext(N[0], N[1]), e1 = ext(N[N.length - 1], N[N.length - 2]);
    const poly = [[e0[0], yBig], e0].concat(N, [e1, [e1[0], yBig]]), np = poly.length;
    let minX = Infinity, maxX = -Infinity, minY = Infinity;
    for (const p of N) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; }
    const M = 30;
    const inPoly = (x, y) => { let c = false; for (let i = 0, j = np - 1; i < np; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    // Abstand zur Schnittlinie mit Vorzeichen (+ = in der Haube); weit weg nur −M (spart Rechenzeit)
    const sd = (x, y) => {
      if (x < minX - M || x > maxX + M || y < minY - M) return -M;
      let d2 = Infinity;
      for (let i = 0; i + 1 < N.length; i++) {
        const a = N[i], b = N[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 > 0 ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / l2, 0, 1) : 0;
        const ex = a[0] + t * dx - x, ey = a[1] + t * dy - y, q = ex * ex + ey * ey; if (q < d2) d2 = q;
      }
      const d = Math.sqrt(d2); return inPoly(x, y) ? d : -d;
    };
    // Höhenabschnitte [[yUnten, yOben], …] der Haube im Schnitt x = const
    const spans = x => {
      const ys = [];
      for (let i = 0, j = np - 1; i < np; j = i++) { const a = poly[i], b = poly[j]; if ((a[0] > x) !== (b[0] > x)) ys.push(a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])); }
      ys.sort((p, q) => p - q);
      const tp = top(x), out = [];
      for (let i = 0; i + 1 < ys.length; i += 2) if (ys[i] < tp - 1e-6) out.push([ys[i], Math.min(ys[i + 1], tp)]);
      return out;
    };
    return Object.assign(res, { sd, spans, x0: minX, x1: maxX });
  }

  // ---------- Anbauten: Tragflächenübergang & Seitenleitwerk ------------------------------
  // Beide werden je Schnitt x = const in den Halbspant (Polylinie [[y,z],…] von oben nach
  // unten, z >= 0) eingerechnet: Anbaukontur ∪ Rumpfkontur, konkave Ecken mit Radius R
  // verrundet (Hohlkehle). Weil jeder Schnitt eben bleibt, gehen STL und DXF-Spanten
  // unverändert. Seglertypisch: die Wurzelrippe wird als ebene „Anformung" bis Z = zf aus
  // dem Rumpf herausgezogen (Fläche stößt an eine ebene Fläche), davor/dahinter läuft die
  // Anformung mit Smoothstep in die Rumpfflanke aus; das Seitenleitwerk ist ein Loft von
  // Wurzel- zu Spitzenprofil mit Pfeilung, Randbogen und Rückenflosse (Dorsal) am Fuß.
  function WG() {
    const w = C('rproWing'), d = DEF.rproWing;
    // Altstand der Anformung (Aufdickung fD rundum + Verlängerung fF/fB) -> Projektion vorn/hinten/oben/unten
    if (w.pF === undefined && w.fD !== undefined) { w.pD = +w.fD || 10; w.pF = +w.fF || 0; w.pB = +w.fB || 0; w.pU = w.pL = 0; }
    // Zwischenstand (Projektion je Richtung als Gesamtmaß) -> Offset rundum + Zuschläge
    else if (w.pD === undefined && w.pF !== undefined) { const a = Math.max(0.5, Math.min(+w.pU || 0, +w.pL || 0)); w.pD = a; for (const k of ['pF', 'pB', 'pU', 'pL']) w[k] = r1(Math.max(0, (+w[k] || 0) - a)); }
    delete w.fD; delete w.fF; delete w.fB;
    for (const k in d) if (w[k] === undefined) w[k] = d[k];
    return filNorm(w);
  }
  // Leitlinien und Kehlenform der Anformung (Tragfläche und V-Leitwerk) vervollständigen bzw. Altstände übernehmen.
  function filNorm(w) {
    // Nase: ohne Stützpunkt = gleiche Kurvenform (Viertelellipse, Völligkeit) wie im Profilbereich; alter Standardpunkt entfällt
    if (!Array.isArray(w.gLE) || (w.gLE.length === 1 && +w.gLE[0].u === 0.3 && +w.gLE[0].v === 0.65)) w.gLE = [];
    if (!Array.isArray(w.gTE)) w.gTE = [{ u: 0.35, v: 0.45 }];
    // Form der Hohlkehle (Vorderansicht) oben/unten: Umrisspunkte {x, v, c, i, o} normiert (Fuß 0,0 … Rippe 1,1), leer =
    // Viertelellipse. Altstand cvPts [{a, b}] (eine Form für beide Seiten) wird übernommen.
    if (Array.isArray(w.cvPts) && w.cvPts.length && !Array.isArray(w.cvU)) { const al = clamp(+w.fTen || 0.55, 0.2, 1.5), L = coveEnds(al, w.cvPts.map(q => ({ x: +q.a || 0, v: +q.b || 0, c: 0 }))); w.cvU = L; w.cvL = JSON.parse(JSON.stringify(L)); }
    delete w.cvPts;
    if (!Array.isArray(w.cvU)) w.cvU = [];
    if (!Array.isArray(w.cvL)) w.cvL = [];
    // Spline-Art der Kehlen: neu B-Spline (ruhiger); schon gezeichnete Formen behalten den krümmungsstetigen Spline
    if (w.cvSpl !== 'bs' && w.cvSpl !== 'c2') w.cvSpl = (w.cvU.length || w.cvL.length) ? 'c2' : 'bs';
    return w;
  }
  function FN() {
    const f = C('rproFin'), d = DEF.rproFin;
    // Altstand (Pfeilung/Spitzentiefe/Rückenflosse in mm) -> Winkel und Übergangsradius
    if (f.angLE === undefined && f.sweep !== undefined) {
      const h = Math.max(1, +f.h || 1), sw = +f.sweep || 0, ct = +f.ct || 0, cr = +f.cr || 1;
      f.angLE = r1(Math.atan2(sw, h) * 180 / Math.PI); f.angTE = r1(Math.atan2(sw + ct - cr, h) * 180 / Math.PI); f.angTip = 0; f.leR = Math.max(0, +f.dorsal || 0);
    }
    delete f.sweep; delete f.ct; delete f.dorsal;
    if (f.pF === undefined && f.fD !== undefined) { f.pD = +f.fD || 8; f.pF = +f.fF || 0; f.pB = +f.fB || 0; f.pS = 0; }
    else if (f.pD === undefined && f.pF !== undefined) { const a = Math.max(0.5, +f.pS || 0); f.pD = a; for (const k of ['pF', 'pB', 'pS']) f[k] = r1(Math.max(0, (+f[k] || 0) - a)); }
    delete f.fD; delete f.fF; delete f.fB;
    for (const k in d) if (f[k] === undefined) f[k] = d[k];
    // Leitlinie der Nase: normierte Umrisspunkte wie die Kehle ({x, v, c, i, o}); Altstand {u, v} (relativ in X/Höhe) verfällt
    if (!Array.isArray(f.gLE) || f.gLE.some(q => q && q.u !== undefined)) f.gLE = [];
    if (f.gSpl !== 'bs' && f.gSpl !== 'c2') f.gSpl = 'bs';
    if (!Array.isArray(f.gTE)) f.gTE = [{ u: 0.35, v: 0.45 }];
    if (!Array.isArray(f.cv)) f.cv = [];
    if (f.cvSpl !== 'bs' && f.cvSpl !== 'c2') f.cvSpl = f.cv.length ? 'c2' : 'bs';
    if (!f.rud || typeof f.rud !== 'object') f.rud = {};
    for (const [k, v] of Object.entries({ on: false, pR: 35, pT: 35, atEnd: false, show: true })) if (f.rud[k] === undefined) f.rud[k] = v;
    return f;
  }
  const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  // Normiertes Profil ({x,y}, x 0..1) -> Ober-/Unterseite und halbe Dicke als Funktion von u.
  function profFn(pts) {
    if (!Array.isArray(pts) || pts.length < 4) return null;
    let iLE = 0; for (let i = 1; i < pts.length; i++) if (pts[i].x < pts[iLE].x) iLE = i;
    const A = pts.slice(0, iLE + 1), B = pts.slice(iLE);
    const my = a => a.reduce((s, p) => s + p.y, 0) / (a.length || 1);
    let up = A, lo = B; if (my(A) < my(B)) { up = B; lo = A; }
    const sx = a => a.slice().sort((p, q) => p.x - q.x); up = sx(up); lo = sx(lo);
    if (up.length < 2 || lo.length < 2) return null;
    // Zwischen den Profilpunkten Catmull-Rom über s = √u statt linear über u: an der Nase wächst die Dicke wie √u, linear in u
    // knickte das Profil an jedem Stützpunkt (NACA mit 80 Punkten: alle 0,1–0,6 mm) — Facetten am Leitwerk und Wellen in der
    // Anformung. In s ist das Profil auch an der Nase glatt und fast gerade.
    const prep = a => { const S = a.map(p => Math.sqrt(Math.max(0, p.x))); return { a, S }; };
    up = prep(up); lo = prep(lo);
    const at = (o, u) => {
      const a = o.a, S = o.S, n = a.length;
      if (u <= a[0].x) return a[0].y; if (u >= a[n - 1].x) return a[n - 1].y;
      let l = 0, h = n - 1; while (h - l > 1) { const m = (l + h) >> 1; if (a[m].x <= u) l = m; else h = m; }
      const ds = S[h] - S[l]; if (!(ds > 1e-12)) return a[l].y;
      const f = (Math.sqrt(u) - S[l]) / ds, y1 = a[l].y, y2 = a[h].y;
      // Tangenten (Catmull-Rom auf ungleichmäßigem s): Steigung aus den Nachbarn, auf das Intervall skaliert
      const m1 = l > 0 ? (y2 - a[l - 1].y) / (S[h] - S[l - 1]) * ds : y2 - y1;
      const m2 = h < n - 1 ? (a[h + 1].y - y1) / (S[h + 1] - S[l]) * ds : y2 - y1;
      const f2 = f * f, f3 = f2 * f;
      return (2 * f3 - 3 * f2 + 1) * y1 + (f3 - 2 * f2 + f) * m1 + (-2 * f3 + 3 * f2) * y2 + (f3 - f2) * m2;
    };
    return { up: u => at(up, u), lo: u => at(lo, u), t: u => Math.max(0, (at(up, u) - at(lo, u)) / 2) };
  }
  // Rumpfkontur: äußerster Schnittpunkt mit der Waagrechten y (null = keiner).
  function crossY(P, y) {
    let best = null;
    for (let k = 0; k + 1 < P.length; k++) {
      const a = P[k], b = P[k + 1]; if (a[0] === b[0] || (y - a[0]) * (y - b[0]) > 0) continue;
      const t = (y - a[0]) / (b[0] - a[0]), z = a[1] + (b[1] - a[1]) * t;
      if (!best || z > best.z) best = { y, z, k, t };
    }
    return best;
  }
  // Rumpfkontur: tiefster und höchster Schnittpunkt mit der Senkrechten z (null = Rumpf dort schmaler).
  function crossZ(P, z) {
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k + 1 < P.length; k++) {
      const a = P[k], b = P[k + 1]; if ((z - a[1]) * (z - b[1]) > 0 || a[1] === b[1]) continue;
      const y = a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]); lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    return lo <= hi ? { lo, hi } : null;
  }
  function distPoly(P, c) {
    let best = null;
    for (let k = 0; k + 1 < P.length; k++) {
      const a = P[k], b = P[k + 1], dy = b[0] - a[0], dz = b[1] - a[1], L2 = dy * dy + dz * dz;
      const t = L2 > 1e-12 ? clamp(((c[0] - a[0]) * dy + (c[1] - a[1]) * dz) / L2, 0, 1) : 0;
      const y = a[0] + dy * t, z = a[1] + dz * t, d = Math.hypot(c[0] - y, c[1] - z);
      if (!best || d < best.d) best = { d, y, z, k, t };
    }
    return best;
  }
  // Hohlkehle: Kreismittelpunkte cen(s) = { c:[y,z], q:[y,z] } laufen von der Ecke (s = 0) entlang der
  // Anbaukontur weg (q = Berührpunkt auf dem Anbau, c = q + R·Normale). Gesucht ist die erste Lage
  // mit Abstand R zur Rumpfkontur -> Kreis berührt beide. Liefert { T (auf Rumpf), q, c, s } oder null.
  function solveFillet(P, cen, R) {
    if (!(R > 0.05) || !P || P.length < 2) return null;
    const N = 40, d0 = distPoly(P, cen(0).c);
    if (!d0 || d0.d >= R) return null;
    let prev = 0;
    for (let i = 1; i <= N; i++) {
      const s = i / N;
      if (distPoly(P, cen(s).c).d >= R) {
        let lo = prev, hi = s;
        for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (distPoly(P, cen(m).c).d >= R) hi = m; else lo = m; }
        const g = cen(hi); return { T: distPoly(P, g.c), q: g.q, c: g.c, s: hi };
      }
      prev = s;
    }
    return null;
  }
  function arcPts(c, R, from, to, n) {
    const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]), a1 = Math.atan2(to[1] - c[1], to[0] - c[0]);
    let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const out = []; for (let i = 0; i <= n; i++) { const a = a0 + d * i / n; out.push([c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)]); }
    return out;
  }
  const cutBefore = (P, T) => P.slice(0, T.k + 1).concat([[T.y, T.z]]);
  const cutAfter = (P, T) => [[T.y, T.z]].concat(P.slice(T.k + 1));
  const NACA = {};
  function nacaProf(thk) { const t = clamp(Math.round(+thk || 9), 1, 40); return NACA[t] || (NACA[t] = Airfoil.naca4('00' + String(t).padStart(2, '0'), 80)); }

  // --- Tragflächenübergang
  function wingProf(w) {
    if (w.src === 'dat') return w.prof && w.prof.pts ? profFn(w.prof.pts) : null;
    return profFn(state.root && state.root.profile);
  }
  function wingGeom(m) {
    const w = WG(); if (!w.on) return null;
    const pf = wingProf(w); if (!pf) return null;
    const chord = +w.chord > 0 ? +w.chord : (state.root && +state.root.chord) || 200;
    const xLE = +w.xLE || 0;
    // Art: 'stub' = Tragflächenstummel, per boolescher Vereinigung an den Rumpf gesetzt (scharfe Kante, keine
    // Übergänge) | 'cut' = Tragflächenausschnitt. Altstände 'fair'/'blend' (Anformungen) werden zum Stummel.
    // 'fil' = Anformung nach ErnstV (aufgedickter Fußabdruck auf dem Rumpf, tangentialer Übergang zur Wurzelrippe).
    const mode = w.mode === 'cut' ? 'cut' : w.mode === 'fil' ? 'fil' : 'stub';
    const g = { mode, pf, chord, xLE, yLE: +w.yLE || 0, tanA: Math.tan((+w.alpha || 0) * Math.PI / 180), zf: 0, warns: [], name: w.src === 'dat' ? (w.prof && w.prof.name) : (state.root && state.root.profile && state.root.profile.name) };
    // Wurzelrippen-Ebene: w.z ab Rumpfmitte oder (zRef 'wall') ab der Rumpfseitenwand in Profilhöhe; 0 = automatisch.
    g.wall = wingWallZ(m, g);
    g.zSet = +w.z > 0 ? (w.zRef === 'wall' ? g.wall + (+w.z) : +w.z) : 0;
    let zf = g.zSet;
    if (!(zf > 0)) { let wm = 0; for (let i = 0; i <= 20; i++) wm = Math.max(wm, lineAt(m.L.w, xLE + chord * i / 20)); zf = wm + 15; }
    g.zf = zf;
    if (mode === 'cut') { g.open = w.cutOpen === 'down' || w.cutOpen === 'none' ? w.cutOpen : 'up'; g.play = Math.max(0, +w.cutPlay || 0); g.cutZ = Math.max(0, +w.cutZ || 0); }
    if (mode === 'fil') {
      g.te = Math.max(0, +w.te || 0);
      try { filWing(m, g, w, !(g.zSet > 0)); } catch (e) { console.warn('Rumpf: Anformung', e); g.fl = null; g.warns.push(T('Anformung konnte nicht berechnet werden.')); }
    }
    return g;
  }
  // Rumpfseitenwand an der Tragflächenwurzel: größte halbe Rumpfbreite in Höhe der Profilmitte über die Wurzeltiefe.
  function wingWallZ(m, g) {
    let zw = 0;
    for (let i = 0; i <= 20; i++) {
      const x = g.xLE + g.chord * i / 20, P = bodyHalf(m, clamp(x, m.x0, m.x1)); if (!P || P.length < 2) continue;
      const r = wingYs(g, x), top = P[0][0], bot = P[P.length - 1][0];
      const c = crossY(P, clamp((r.yu + r.yl) / 2, bot + 1e-6, top - 1e-6)); if (c) zw = Math.max(zw, c.z);
    }
    return zw;
  }
  // Ober-/Unterkante des Wurzelprofils bei x (Y, mit Einstellwinkel um die Nase gekippt). Nur die Anformung kennt eine
  // Endleistendicke te: Ober- und Unterseite werden um die Nase gedreht, bis die Endleiste um te aufklafft (½ je Seite).
  function wingYs(g, x) {
    const dx = clamp(x - g.xLE, 0, g.chord), u = dx / g.chord, e = (g.te || 0) / 2 * u;
    return { yu: g.yLE + g.chord * g.pf.up(u) - dx * g.tanA + e, yl: g.yLE + g.chord * g.pf.lo(u) - dx * g.tanA - e };
  }
  // Tragflächenstummel: das Wurzelprofil wird gerade (in Z) bis zur Wurzelrippen-Ebene zf aus dem Rumpf herausgezogen
  // und mit dem Rumpfschnitt vereinigt — ohne Hohlkehle oder Verkleidung, die Verschneidung bleibt eine scharfe Kante.
  // Punkte tragen als 3. Wert die Herkunft (0 Rumpf, 1 Leitwerk, 2 Tragflächenstummel) für die Farbgebung.
  function wingHalf(g, x, P) {
    if (!g || !P || P.length < 2) return P;
    const xTE = g.xLE + g.chord;
    const top = P[0][0], bot = P[P.length - 1][0], A = 2, tagA = q => [q[0], q[1], A];
    // Rumpfpunkt in Profilhöhe (Merkpunkte ohne Stummel)
    // Anformung: vor/hinter der Projektion an deren Anfangs-/Endpunkt — dort laufen die gebündelten Gitterzeilen der
    // Anformung zusammen; auf Profilhöhe sprängen sie am Projektionsende um einige mm (Schattierungsring im Rumpf)
    const ref = wingYs(g, clamp(x, g.xLE, xTE)), yP = g.mode === 'fil' && g.fl ? (x >= g.fl.x1 ? g.fl.y1 : x <= g.fl.x0 ? g.fl.y0 : null) : null;
    const ym = clamp(yP != null ? yP : (ref.yu + ref.yl) / 2, bot + 1e-6, top - 1e-6), cm = crossY(P, ym);
    const zJ = cm ? cm.z : 0;
    // Ohne Stummel an dieser Stelle: Merkpunkte (s. u.) alle im Rumpfpunkt auf Profilhöhe
    const none = () => {
      if (!cm) return P;
      const R2 = cutBefore(P, cm).concat(cutAfter(P, cm).slice(1)), c = R2[cm.k + 1];
      R2.featPts = [c, c, c, c, c, c]; return R2;
    };
    if (g.mode === 'cut') return wingCut(g, x, P, none);
    if (g.mode === 'fil') return wingFil(g, x, P, none);
    if (x <= g.xLE || x >= xTE) return none();
    if (!(g.zf > zJ + 0.5)) return none();
    // Ober-/Unterkante des Stummels als Geraden in Z, von außen (zf) nach innen
    const zTop = g.zf, N = 48, U = [], L = [];
    for (let i = 0; i <= N; i++) { const t = i / N, z = zTop * (1 - t * t); U.push([ref.yu, z]); L.push([ref.yl, z]); }
    const inside = q => { if (q[0] > top || q[0] < bot) return false; const c = crossY(P, q[0]); return !!c && q[1] < c.z; };
    if (inside(U[0]) && inside(L[0])) return none();
    // Eintritt in den Rumpf: erste Lage (von außen) im Rumpf, per Bisektion genau
    const entry = C2 => {
      for (let i = 1; i < C2.length; i++) if (inside(C2[i])) {
        let a = C2[i - 1], b = C2[i];
        for (let k = 0; k < 24; k++) { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (inside(m)) b = m; else a = m; }
        return { i, p: a };
      }
      return null;
    };
    let eU = entry(U), eL = entry(L);
    // Echte Vereinigung: die Geraden laufen unverändert bis zur Rumpfhaut. Nur wenn der Stummel den Rumpf gar nicht
    // berührt (Rippe ganz unter dem Rumpfboden bzw. über dem Rumpfrücken), füllt er den Spalt bis zum Rumpf — sonst
    // zerfiele der Schnitt in zwei Teile.
    if (!eU && !eL && (ref.yl > top - 0.3 || ref.yu < bot + 0.3)) {
      for (let i = 0; i < U.length; i++) {
        const cz = crossZ(P, U[i][1]); if (!cz) continue;
        if (U[i][0] < cz.lo + 0.3) U[i][0] = Math.min(cz.lo + 0.3, cz.hi);
        if (L[i][0] > cz.hi - 0.3) L[i][0] = Math.max(cz.hi - 0.3, cz.lo);
        if (L[i][0] > U[i][0]) L[i][0] = U[i][0];
      }
      eU = entry(U); eL = entry(L);
    }
    // Stummelflanke vom Eintritt nach außen (W[0] = Eintritt)
    const flankOf = (C2, e) => e ? [e.p].concat(C2.slice(0, e.i).reverse()) : C2.slice().reverse();
    const WU = flankOf(U, eU), WL = flankOf(L, eL);
    // Merkpunkte je Seite: T = q (Verschneidung Rumpf/Stummel), C (Kante Flanke/Rippenfläche).
    // Sie bekommen beim Abtasten in jedem Spant denselben Index -> keine Sägezähne an den Kanten.
    let out, iTu;
    if (eU) { const c = crossY(P, eU.p[0]); out = (c ? cutBefore(P, c) : [P[0]]); iTu = out.length - 1; out = out.concat(WU.slice(1).map(tagA)); }
    else { out = [[WU[0][0], 0, A]]; iTu = 0; out = out.concat(WU.slice(1).map(tagA)); }
    const iCu = out.length - 1;
    let lo, jTl;
    const WLr = WL.slice().reverse();
    if (eL) { const c = crossY(P, eL.p[0]), f1 = WLr.slice(0, -1).map(tagA); jTl = f1.length; lo = f1.concat(c ? cutAfter(P, c) : [P[P.length - 1]]); }
    else { const f1 = WLr.slice(0, -1).map(tagA); jTl = f1.length; lo = f1.concat([[WL[0][0], 0, A]]); }
    // dünne Endleiste: Ober- und Unterkante nicht doppelt
    let off = out.length;
    if (out.length && lo.length && Math.hypot(out[out.length - 1][0] - lo[0][0], out[out.length - 1][1] - lo[0][1]) < 1e-6) { lo.shift(); off--; }
    const res = out.concat(lo);
    res.featPts = [iTu, iTu, iCu, Math.max(iCu, off), off + jTl, off + jTl].map(i => res[clamp(i, 0, res.length - 1)]);
    return res;
  }

  // Tragflächenausschnitt: der Rumpf wird im Band zwischen Profilunter- und -oberseite (± Spiel) ausgeschnitten —
  // nach oben offen (Flächenauflage/Sattel), nach unten offen oder als Durchbruch in Profilform. cutZ > 0 lässt
  // einen Kern der halben Breite cutZ stehen (Tasche). Merkpunkte wie beim Stummel (Kanten des Ausschnitts).
  function wingCut(g, x, P, none) {
    const sp = g.play, xTE = g.xLE + g.chord, A = 2;
    if (x <= g.xLE - sp || x >= xTE + sp) return none();
    const w = wingYs(g, x);
    let e = sp; if (x < g.xLE) e = Math.sqrt(Math.max(0, sp * sp - (g.xLE - x) * (g.xLE - x))); else if (x > xTE) e = Math.sqrt(Math.max(0, sp * sp - (x - xTE) * (x - xTE)));
    const yu = g.open === 'up' ? Infinity : w.yu + e, yl = g.open === 'down' ? -Infinity : w.yl - e, cz = g.cutZ;
    if (!(yu > yl)) return none();
    const inB = y => y < yu && y > yl;
    // Rumpfmitte: Tragfläche Z = 0; V-Leitwerk (gedrehter Rahmen) die Symmetrieebene t = h·tanΓ (g.zAxis)
    const z0 = h => g.zAxis ? g.zAxis(h) : 0;
    const map = q => { if (cz > 0) { const zc = Math.max(cz, z0(q[0])); return [q[0], Math.min(q[1], zc), q[1] > zc ? A : 0]; } const y = g.open === 'up' ? yl : g.open === 'down' ? yu : q[0]; return [y, z0(y), A]; };
    const out = []; let Tu = null, Qu = null, Ql = null, Tl = null, any = false;
    for (let k = 0; k < P.length; k++) {
      const a = P[k];
      if (k === 0) { if (inB(a[0])) { out.push(map(a)); any = true; } else out.push(a); }
      if (k + 1 >= P.length) break;
      const b = P[k + 1], ts = [];
      for (const yy of [yu, yl]) if (isFinite(yy) && (a[0] - yy) * (b[0] - yy) < 0) ts.push([(yy - a[0]) / (b[0] - a[0]), yy]);
      ts.sort((p, q) => p[0] - q[0]);
      let t0 = 0;
      for (const [t, yy] of ts) {
        const c = [yy, a[1] + (b[1] - a[1]) * t, 0], inner = map(c), bef = inB(a[0] + (b[0] - a[0]) * (t0 + t) / 2);
        if (bef) out.push(inner, c); else out.push(c, inner);
        if (yy === yu) { if (!Tu) { Tu = c; Qu = inner; } } else { Tl = c; Ql = inner; }
        t0 = t; any = true;
      }
      if (inB(b[0])) { out.push(map(b)); any = true; } else out.push(b);
    }
    if (!any) return none();
    const first = out[0], last = out[out.length - 1];
    out.featPts = [Tu || first, Qu || first, Qu || first, Ql || last, Ql || last, Tl || last];
    return out;
  }

  // ---- Anformung nach ErnstV (RC-Network „Tipps und Tricks mit Flächen“/„… mit Kurven“): das Wurzelprofil wird zur
  // Projektion erweitert (Verlängerung vorn/hinten/oben/unten, eigene Endleistendicke, runde Endleiste) und waagrecht (in Z)
  // auf den Rumpf projiziert — das ist der Ausschnitt im Rumpf. Je Spant läuft der Übergang als kubische Bezier-Kurve
  // tangential aus der Rumpfkontur (an der Projektion) heraus und tangential (Richtung +Z) in die Tragfläche an der
  // Anschlussebene zA. Weil die Spantkontur in der Tangentialebene des Rumpfs liegt und die Projektion auf dem Rumpf,
  // ist die Fläche dort G1-stetig; an der Tragfläche ebenso (Ankunft längs Z auf der Profilkontur).
  // Vor der Nase und hinter der Endleiste: Beule mit runder Kappe (Halbkreis, Scheitel auf der Kante der Anformung =
  // Viertelellipse in der Draufsicht). Die Kappendicke folgt der Projektion und geht an Nase/Endleiste stetig in die
  // Profildicke über — keine spitz zusammenlaufende Kante. Völligkeit 0,55 = Viertelellipse.

  // Projektionsprofil (Basis): Ober-/Unterseite up(x)/lo(x) über der Sehne, Endleiste um tE zusätzlich aufgedickt (um die
  // Nase aufgeklappt) und mit Radius r gerundet. Geschlossener Ring [[x, v, u],…]: Oberseite EL -> Nase, Unterseite -> EL.
  function filProjBase(up, lo, xLE, c, tE, r, L) {
    const NU = 60, U = [], Lo = []; let tailInfo = null;
    for (let i = NU; i >= 0; i--) { const u = (1 - Math.cos(Math.PI * i / NU)) / 2, x = xLE + u * c; U.push([x, up(x) + tE / 2 * u, u]); }
    for (let i = 1; i <= NU; i++) { const u = (1 - Math.cos(Math.PI * i / NU)) / 2, x = xLE + u * c; Lo.push([x, lo(x) - tE / 2 * u, u]); }
    const xT = xLE + c, yU = up(xT) + tE / 2, yL = lo(xT) - tE / 2, face = yU - yL;
    let R, hasFace = face > 0.05;
    if (L > 0.01) {
      // Verlängerung hinter der Endleiste in Richtung der Skelettlinie: Ober- und Unterseite laufen tangential aus der
      // Profilkontur (kubische Hermite-Kurve) in einen geraden Schwanz mit der Endleistendicke, Länge L
      const xa = xT - 0.03 * c, ua = 0.97, upA = up(xa) + tE / 2 * ua, loA = lo(xa) - tE / 2 * ua;
      const unit = (dx, dy) => { const l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
      const t = unit(xT - xa, (yU + yL) / 2 - (upA + loA) / 2), nv = [-t[1], t[0]], h = Math.max(0, face / 2), mid = [xT, (yU + yL) / 2];
      const Eu = [mid[0] + L * t[0] + h * nv[0], mid[1] + L * t[1] + h * nv[1]], El = [mid[0] + L * t[0] - h * nv[0], mid[1] + L * t[1] - h * nv[1]];
      const herm = (P0, d0, P1, d1) => {
        const D = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]), o = [], NT = 24;
        for (let k = 1; k <= NT; k++) { const s2 = k / NT, s3 = s2 * s2 * s2, q2 = s2 * s2, h00 = 2 * s3 - 3 * q2 + 1, h10 = s3 - 2 * q2 + s2, h01 = -2 * s3 + 3 * q2, h11 = s3 - q2;
          o.push([h00 * P0[0] + h10 * D * d0[0] + h01 * P1[0] + h11 * D * d1[0], h00 * P0[1] + h10 * D * d0[1] + h01 * P1[1] + h11 * D * d1[1], 1]); }
        return o;
      };
      const tu = herm([xT, yU], unit(xT - xa, yU - upA), Eu, t), tl = herm([xT, yL], unit(xT - xa, yL - loA), El, t);   // je bis zum Ende inkl.
      tailInfo = { xT, mid, t, h, L, xE: mid[0] + L * t[0] };
      R = [tu[tu.length - 1]].concat(tu.slice(0, -1).reverse(), U, Lo, tl);
      // R: Eu … (oberer Schwanz rückwärts) … EL oben … Nase … EL unten … El
      hasFace = 2 * h > 0.05;
      if (hasFace) { for (let k = 1; k < 4; k++) R.push([El[0] + (Eu[0] - El[0]) * k / 4, El[1] + (Eu[1] - El[1]) * k / 4, 1]); }
      else R.pop();
    } else {
      R = U.concat(Lo);
      if (hasFace) for (let k = 1; k < 4; k++) R.push([xT, yL + face * k / 4, 1]);
      else R.pop();
    }
    if (r > 0.01) {
      const big = 0.45 * (c + (L || 0)), fh = hasFace ? Math.hypot(R[0][0] - R[R.length - 4][0], R[0][1] - R[R.length - 4][1]) : 0;
      if (hasFace) { const cL = R[R.length - 4]; R = ringRound(R, 0, r, fh / 2, big); const iL = R.indexOf(cL); if (iL >= 0) R = ringRound(R, iL, r, big, fh / 2); }
      else R = ringRound(R, 0, r, big, big);
    }
    R.tail = tailInfo;
    return R;
  }
  // Ecke i eines geschlossenen Rings mit Radius r runden (Bogen tangential an beide Nachbarstücke; höchstens capB/capF
  // Bogenlänge rückwärts/vorwärts verbraucht — an einer stumpfen Endleiste die halbe Stirnfläche).
  function ringRound(R, i, r, capB, capF) {
    const n = R.length; if (n < 5) return R;
    const h = n >> 1, Q = []; for (let k = 0; k < n; k++) Q.push(R[(i - h + k + n) % n]);
    const unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
    const a0 = unit(Q[h - 1], Q[h]), b0 = unit(Q[h], Q[h + 1]), phi = Math.acos(clamp(a0[0] * b0[0] + a0[1] * b0[1], -1, 1));
    if (phi < 0.05) return R;
    const L = r * Math.tan(Math.min(phi, 3.0) / 2), Lb = Math.min(L, capB), Lf = Math.min(L, capF);
    const walk = (dir, Lw) => {
      let acc = 0, k = h;
      for (;;) {
        const k2 = k + dir; if (k2 < 0 || k2 >= n) return null;
        const a = Q[k], b = Q[k2], s = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (acc + s >= Lw) { const t = s > 0 ? (Lw - acc) / s : 0; return { k: k2, p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 1], d: [(b[0] - a[0]) / (s || 1), (b[1] - a[1]) / (s || 1)] }; }
        acc += s; k = k2;
      }
    };
    const P1 = walk(-1, Lb), P2 = walk(1, Lf); if (!P1 || !P2) return R;
    const ta = [-P1.d[0], -P1.d[1]], tb = P2.d, rr = Math.min(Lb, Lf) / Math.tan(Math.min(phi, 3.0) / 2), kk = 4 / 3 * Math.tan(phi / 4) * rr;
    const c1 = [P1.p[0] + ta[0] * kk, P1.p[1] + ta[1] * kk], c2 = [P2.p[0] - tb[0] * kk, P2.p[1] - tb[1] * kk], arc = [], N = 14;
    for (let j = 1; j < N; j++) {
      const t = j / N, s = 1 - t, w0 = s * s * s, w1 = 3 * s * s * t, w2 = 3 * s * t * t, w3 = t * t * t;
      arc.push([w0 * P1.p[0] + w1 * c1[0] + w2 * c2[0] + w3 * P2.p[0], w0 * P1.p[1] + w1 * c1[1] + w2 * c2[1] + w3 * P2.p[1], 1]);
    }
    return Q.slice(0, P1.k + 1).concat([P1.p], arc, [P2.p], Q.slice(P2.k));
  }
  // Projektion = Basisring nach außen erweitert, je Richtung eigenes Maß: e.f vorn (−X), e.b hinten (+X), e.u oben (+V),
  // e.l unten (−V). Punkt + (nx·(vorn|hinten), nv·(oben|unten)) mit der Ringnormalen n; scharfe Ecken als Fächer.
  function projOffset(R, e) {
    const n = R.length; let area = 0;
    for (let i = 0; i < n; i++) { const p = R[i], q = R[(i + 1) % n]; area += p[0] * q[1] - q[0] * p[1]; }
    const sg = area > 0 ? 1 : -1;
    const nrm = i => { const a = R[i], b = R[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [sg * dy / L, -sg * dx / L]; };
    // echter Offset um e.d + Zuschlag je Richtung mit n·|n| gewichtet: stetig differenzierbar, wo die Normale die Achse
    // wechselt (vorher n·Maß -> Knick an der Stelle, an der die Kontur von „nach vorn“ auf „nach hinten“ dreht)
    // Hinter der Endleiste (Schwanz) verjüngt sich der Offset weich auf 10 %: die Projektion läuft hinten schlank aus wie die
    // verlängerte Endleiste — sonst endet sie als dicker Bogen und die Anformung muss von breitem Fuß auf die dünne Kante
    // zusammenlaufen (kantiger „Meißel“ am Ende)
    const tl = R.tail, sc = a => { if (!tl || !(a[0] > tl.xT)) return 1; const q = clamp((a[0] - tl.xT) / Math.max(1e-6, tl.xE - tl.xT), 0, 1); return 1 - 0.9 * q * q * (3 - 2 * q); };
    // Spitze rund (e.rt, Seitenleitwerk): der Zuschlag vorn mit n_x² gewichtet gibt eine Nadel mit Spitzenradius d² / (d + 2f)
    // (pD 4, pF 20: 0,36 mm) — die Nasenfläche bekam vor der Nasenleiste einen scharfen Grat (V im Zebra). Mit c²(3 − 2c)
    // (c = −n_x, gleiche Reichweite d + f, Flanke unverändert) ist die Spitze in X flach: Radius genau d, Umriss bleibt konvex.
    const fw = m0 => { if (m0 >= 0) return m0 * m0 * e.b; const c = -m0; return -e.f * (e.rt ? c * c * (3 - 2 * c) : c * c); };
    const put = (a, m) => { const k = sc(a); return [a[0] + k * (m[0] * e.d + fw(m[0])), a[1] + k * (m[1] * e.d + m[1] * Math.abs(m[1]) * (m[1] > 0 ? e.u : e.l))]; };
    const F2 = [], src = [];   // src = Index des Basispunkts je Projektionspunkt (Fächer an scharfen Ecken: mehrfach)
    // Eckennormalen: gemittelt und zweimal geglättet ([1 2 1]) — leichtes Rauschen der Profilkontur würde der große
    // Zuschlag vorn sonst zu einer gezackten Projektion verstärken. Echte Ecken (> 20°, z. B. stumpfe Endleiste) bleiben
    // Fächer. Zwischen den Punkten wird verdichtet, sobald die Normale um mehr als ~1° dreht (runde, glatte Nase).
    const corner = [], V = [];
    for (let i = 0; i < n; i++) {
      const n1 = nrm((i - 1 + n) % n), n2 = nrm(i), ang = Math.atan2(n1[0] * n2[1] - n1[1] * n2[0], n1[0] * n2[0] + n1[1] * n2[1]);
      corner.push(Math.abs(ang) >= 0.35 && ang * sg > 0 ? { n1, ang } : null);
      const mx = n1[0] + n2[0], my = n1[1] + n2[1], ml = Math.hypot(mx, my) || 1; V.push([mx / ml, my / ml]);
    }
    for (let pass = 0; pass < 2; pass++) {
      const W = V.map(v => v.slice());
      for (let i = 0; i < n; i++) {
        if (corner[i]) continue; const a = V[(i - 1 + n) % n], b = V[(i + 1) % n], ca = corner[(i - 1 + n) % n] ? 0 : 1, cb = corner[(i + 1) % n] ? 0 : 1;
        const mx = ca * a[0] + 2 * V[i][0] + cb * b[0], my = ca * a[1] + 2 * V[i][1] + cb * b[1], ml = Math.hypot(mx, my) || 1; W[i] = [mx / ml, my / ml];
      }
      for (let i = 0; i < n; i++) V[i] = W[i];
    }
    const rot = (v, t) => { const c = Math.cos(t), sn = Math.sin(t); return [v[0] * c - v[1] * sn, v[0] * sn + v[1] * c]; };
    const angOf = (u, v) => Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
    for (let i = 0; i < n; i++) {
      const a = R[i], j = (i + 1) % n, b = R[j];
      if (corner[i]) { const { n1, ang } = corner[i], st = Math.max(2, Math.ceil(Math.abs(ang) / 0.02)); for (let s = 0; s <= st; s++) { F2.push(put(a, rot(n1, ang * s / st))); src.push(i); } }
      else { F2.push(put(a, V[i])); src.push(i); }
      if (corner[i] || corner[j]) continue;
      const da = angOf(V[i], V[j]), st = Math.ceil(Math.abs(da) / 0.02);
      for (let s = 1; s < st; s++) { const t = s / st; F2.push(put([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], rot(V[i], da * t))); src.push(i); }
    }
    F2.src = src;
    return F2;
  }
  // Projektion hinten: konvexe Hülle aus dem Offset des Profils und einem kleinen Spitzenkreis (Radius rMin) auf der
  // verlängerten Skelettlinie bei xT + L. Die beiden Geraden berühren den Offset tangential (stetige Tangente) und den
  // Kreis — keine Einschnürung, kein Klumpen; die Länge bestimmt nur, wo die Geraden den Offset berühren.
  function projTail(F2, xT, L, rMin) {
    const n = F2.length; if (n < 8 || !(L > 0.5)) return F2;
    const xsAll = F2.map(q => q[0]), xMin = Math.min.apply(null, xsAll), span = Math.max(1, xT - xMin);
    const cross = x => { const ys = []; for (let i = 0; i < n; i++) { const a = F2[i], b = F2[(i + 1) % n]; if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) ys.push(a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])); } return ys.length >= 2 ? (Math.max.apply(null, ys) + Math.min.apply(null, ys)) / 2 : null; };
    const xa = xT - 0.08 * span, ya = cross(xa), yb = cross(xT);
    if (ya == null || yb == null) return F2;
    const r = Math.max(rMin, 0.5), xe = xT + L, C = [xe - r, yb + (yb - ya) / (xT - xa) * (xe - r - xT)];
    // Spitzenkreis innerhalb des Offsets: nichts zu verlängern
    if (Math.max.apply(null, xsAll) >= xe - 1e-6) return F2;
    const tang = up => {
      let best = -1, bT = null, bx = -Infinity;
      for (let i = 0; i < n; i++) {
        const P = F2[i]; if (P[0] < xT - 0.6 * span) continue;
        const vx = C[0] - P[0], vy = C[1] - P[1], d = Math.hypot(vx, vy); if (d <= r * 1.001) continue;
        const be = Math.asin(r / d) * (up ? 1 : -1), cs = Math.cos(be), sn = Math.sin(be), ux = vx / d, uy = vy / d;
        const dx = ux * cs - uy * sn, dy = ux * sn + uy * cs, l = Math.sqrt(d * d - r * r);
        let ok = true; for (let k = 0; k < n && ok; k++) { const c = dx * (F2[k][1] - P[1]) - dy * (F2[k][0] - P[0]); if (up ? c > 1e-6 * span : c < -1e-6 * span) ok = false; }
        if (ok && P[0] > bx) { bx = P[0]; best = i; bT = [P[0] + dx * l, P[1] + dy * l]; }
      }
      return best < 0 ? null : { i: best, T: bT };
    };
    const U = tang(true), Lw = tang(false);
    if (!U || !Lw || U.i === Lw.i) return F2;
    // Teil des Rings mit der Nase behalten
    let iMin = 0; for (let i = 1; i < n; i++) if (F2[i][0] < F2[iMin][0]) iMin = i;
    const path = (i0, i1) => { const o = []; for (let k = 0; k < n; k++) { const i = (i0 + k) % n; o.push(F2[i]); if (i === i1) break; } return o; };
    const p1 = path(U.i, Lw.i), fwd = p1.indexOf(F2[iMin]) >= 0;
    const keep = fwd ? p1 : path(Lw.i, U.i), Pe = keep[keep.length - 1], Te = fwd ? Lw.T : U.T, Ts = fwd ? U.T : Lw.T, Ps = keep[0];
    const out = keep.slice(), seg = (P, Q, N) => { for (let k = 1; k < N; k++) out.push([P[0] + (Q[0] - P[0]) * k / N, P[1] + (Q[1] - P[1]) * k / N]); };
    const lineN = Math.max(4, Math.round(Math.hypot(Te[0] - Pe[0], Te[1] - Pe[1]) / 3));
    seg(Pe, Te, lineN); out.push(Te);
    // Kreisbogen um die Spitze (durch Winkel 0)
    const a0 = Math.atan2(Te[1] - C[1], Te[0] - C[0]), a1 = Math.atan2(Ts[1] - C[1], Ts[0] - C[0]), NA = 16;
    for (let k = 1; k < NA; k++) { const t = a0 + (a1 - a0) * k / NA; out.push([C[0] + r * Math.cos(t), C[1] + r * Math.sin(t)]); }
    out.push(Ts); seg(Ts, Ps, Math.max(4, Math.round(Math.hypot(Ts[0] - Ps[0], Ts[1] - Ps[1]) / 3)));
    return out;
  }
  const projExtW = w => ({ d: Math.max(0.5, +w.pD || 0), f: Math.max(0, +w.pF || 0), b: Math.max(0, +w.pB || 0), u: Math.max(0, +w.pU || 0), l: Math.max(0, +w.pL || 0) });
  function projRingWing(g, w, auto) {
    const ex = projExtW(w), base = filProjBase(x => wingYs(g, x).yu, x => wingYs(g, x).yl, g.xLE, g.chord, Math.max(0, +w.pTe || 0), Math.max(0, +w.pTeR || 0), 0);
    // freie Projektion: geschlossener Spline durch Kontrollpunkte (relativ zur Profilnase)
    if (!auto && w.pMode === 'free' && Array.isArray(w.pPts) && w.pPts.length >= 4) return { base, F2: projFree(w.pPts.map(q => [g.xLE + (+q.dx || 0), g.yLE + (+q.dy || 0)]), null, w.pSpl), free: true };
    return { base, F2: projTail(projOffset(base, Object.assign({}, ex, { b: 0 })), g.xLE + g.chord, ex.b, Math.max(0.25, +w.pTeR || 0, (+w.te || 0) / 2)) };   // hinten: tangentiale Verlängerung statt Zuschlag
  }
  // Geschlossener Catmull-Rom-Spline (zentripetal) durch die Kontrollpunkte K, je Abschnitt n Punkte.
  // mode 'bs': geschlossener, gleichförmiger kubischer B-Spline — die Punkte sind Kontrollpunkte (ruhig, nie mehr
  // Wendepunkte als das Kontrollpolygon); sonst zentripetaler Catmull-Rom durch die Punkte.
  function projFree(K, n, mode) {
    if (mode === 'bs') {
      const m = K.length, out = [], N = n || 24;
      for (let i = 0; i < m; i++) {
        const a = K[(i - 1 + m) % m], b = K[i], c = K[(i + 1) % m], d = K[(i + 2) % m];
        for (let k = 0; k < N; k++) {
          const t = k / N, t2 = t * t, t3 = t2 * t, w0 = (1 - t) ** 3 / 6, w1 = (3 * t3 - 6 * t2 + 4) / 6, w2 = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, w3 = t3 / 6;
          out.push([w0 * a[0] + w1 * b[0] + w2 * c[0] + w3 * d[0], w0 * a[1] + w1 * b[1] + w2 * c[1] + w3 * d[1]]);
        }
      }
      return out;
    }
    n = n || 16; const m = K.length, out = [];
    const tj = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-6, 0.5);
    for (let i = 0; i < m; i++) {
      const p0 = K[(i - 1 + m) % m], p1 = K[i], p2 = K[(i + 1) % m], p3 = K[(i + 2) % m];
      const t1 = tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3);
      for (let k = 0; k < n; k++) {
        const t = t1 + (t2 - t1) * k / n, L = (a, b, ta, tb) => [0, 1].map(c => ((tb - t) * a[c] + (t - ta) * b[c]) / (tb - ta));
        const A1 = L(p0, p1, 0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3), B1 = L(A1, A2, 0, t2), B2 = L(A2, A3, t1, t3);
        out.push(L(B1, B2, t1, t2));
      }
    }
    return out;
  }
  // Freie Projektion bei abgetrenntem Ruder: OFFENE Kurve von der oberen hinteren Ecke um die Nase zur unteren hinteren Ecke
  // (Endpunkte liegen auf der Ruderlinie X), hinten die gerade Kante — eckig wie die Offset-Projektion. B-Spline mit
  // dreifachen Endpunkten (läuft genau in die Ecken, Endtangente zum Nachbarpunkt) oder Catmull-Rom durch die Punkte.
  function projFreeOpen(K, mode, X) {
    const P = K.map(q => [q[0], q[1]]), n = P.length, out = [], NS = 24;
    P[0][0] = X; P[n - 1][0] = X;
    if (mode === 'bs') {
      const Q = [P[0], P[0]].concat(P, [P[n - 1], P[n - 1]]);
      for (let i = 0; i + 3 < Q.length; i++) {
        const a = Q[i], b = Q[i + 1], c = Q[i + 2], d = Q[i + 3];
        for (let k = 0; k < NS; k++) {
          const t = k / NS, t2 = t * t, t3 = t2 * t, w0 = (1 - t) ** 3 / 6, w1 = (3 * t3 - 6 * t2 + 4) / 6, w2 = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, w3 = t3 / 6;
          out.push([w0 * a[0] + w1 * b[0] + w2 * c[0] + w3 * d[0], w0 * a[1] + w1 * b[1] + w2 * c[1] + w3 * d[1]]);
        }
      }
    } else {
      const E = [[2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]]].concat(P, [[2 * P[n - 1][0] - P[n - 2][0], 2 * P[n - 1][1] - P[n - 2][1]]]);
      const tj = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-6, 0.5);
      for (let i = 1; i + 2 < E.length; i++) {
        const p0 = E[i - 1], p1 = E[i], p2 = E[i + 1], p3 = E[i + 2], t1 = tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3);
        for (let k = 0; k < NS; k++) {
          const t = t1 + (t2 - t1) * k / NS, L = (a, b, ta, tb) => [0, 1].map(c => ((tb - t) * a[c] + (t - ta) * b[c]) / (tb - ta));
          const A1 = L(p0, p1, 0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3), B1 = L(A1, A2, 0, t2), B2 = L(A2, A3, t1, t3);
          out.push(L(B1, B2, t1, t2));
        }
      }
    }
    out.push(P[n - 1].slice());
    for (const q of out) q[0] = Math.min(q[0], X);
    // gerade Kante an der Ruderlinie von der unteren zur oberen Ecke (verdichtet)
    const a = P[n - 1], b = P[0], k = Math.max(2, Math.ceil(Math.abs(b[1] - a[1]) / 0.5));
    for (let j = 1; j < k; j++) out.push([X, a[1] + (b[1] - a[1]) * j / k]);
    return out;
  }
  // Offene Kontrollpunkte aus der (an der Ruderlinie beschnittenen) Offset-Projektion: von der oberen Ecke um die Nase zur
  // unteren, N Punkte gleichmäßig nach Bogenlänge, Enden genau in den Ecken.
  function projToCtrlOpen(F2, ox, oy, N, X) {
    const n = F2.length, on = i => Math.abs(F2[i][0] - X) < 1e-6;
    let iT = -1, iB = -1; for (let i = 0; i < n; i++) if (on(i)) { if (iT < 0 || F2[i][1] > F2[iT][1]) iT = i; if (iB < 0 || F2[i][1] < F2[iB][1]) iB = i; }
    if (iT < 0 || iB < 0 || iT === iB) return projToCtrl(F2, ox, oy, N);
    const d = on((iT + 1) % n) ? -1 : 1, R = [];
    for (let k = 0, i = iT; k <= n; k++, i = (i + d + n) % n) { R.push(F2[i]); if (i === iB) break; }
    const cum = [0]; for (let i = 1; i < R.length; i++) cum.push(cum[i - 1] + Math.hypot(R[i][0] - R[i - 1][0], R[i][1] - R[i - 1][1]));
    const L = cum[cum.length - 1], out = [];
    for (let k = 0; k < N; k++) {
      const s = L * k / (N - 1); let j = 0; while (j + 2 < cum.length && cum[j + 1] < s) j++;
      const a = R[j], b = R[j + 1], t = clamp((s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]), 0, 1);
      out.push({ dx: r2(a[0] + (b[0] - a[0]) * t - ox), dy: r2(a[1] + (b[1] - a[1]) * t - oy) });
    }
    return out;
  }
  // Seitenleitwerk (symmetrisch): freie Projektion nur auf einer Seite (Z ≥ 0) bearbeiten, die andere gespiegelt. Halbe Liste
  // H von hinten (ohne Ruder: Punkt auf der Mittelachse; mit Ruder: obere Ecke an der Ruderlinie) bis zur Nase (Mittelachse).
  function projHalfFull(H, open) {
    const mir = q => ({ dx: q.dx, dy: -q.dy });
    return open ? H.concat(H.slice(0, -1).reverse().map(mir)) : H.concat(H.slice(1, -1).reverse().map(mir));
  }
  // Enden festhalten: Nase auf der Mittelachse; hinten auf der Mittelachse bzw. (mit Ruder) X auf der Ruderlinie
  function projHalfSnap(H, open, dxR) { const n = H.length; if (open) H[0].dx = dxR; else H[0].dy = 0; H[n - 1].dy = 0; return H; }
  // Obere Hälfte (Z ≥ 0) einer geschlossenen Projektion als N Punkte nach Bogenlänge, von hinten zur Nase.
  function projToCtrlHalf(F2, ox, oy, N, X) {
    const n = F2.length; let iN = 0; for (let i = 1; i < n; i++) if (F2[i][0] < F2[iN][0]) iN = i;
    let iR = -1;
    if (X != null) for (let i = 0; i < n; i++) if (Math.abs(F2[i][0] - X) < 1e-6 && (iR < 0 || F2[i][1] > F2[iR][1])) iR = i;
    if (iR < 0) { iR = 0; for (let i = 1; i < n; i++) if (F2[i][0] > F2[iR][0]) iR = i; }
    const path = d => { const R = []; for (let k = 0, i = iR; k <= n; k++, i = (i + d + n) % n) { R.push(F2[i]); if (i === iN) break; } return R; };
    const A = path(1), B = path(-1), mz = R => R.reduce((s, q) => s + q[1], 0) / R.length, R = mz(A) >= mz(B) ? A : B;
    const cum = [0]; for (let i = 1; i < R.length; i++) cum.push(cum[i - 1] + Math.hypot(R[i][0] - R[i - 1][0], R[i][1] - R[i - 1][1]));
    const L = cum[cum.length - 1], out = [];
    for (let k = 0; k < N; k++) {
      const s = L * k / (N - 1); let j = 0; while (j + 2 < cum.length && cum[j + 1] < s) j++;
      const a = R[j], b = R[Math.min(j + 1, R.length - 1)], t = clamp((s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]), 0, 1);
      out.push({ dx: r2(a[0] + (b[0] - a[0]) * t - ox), dy: r2(Math.max(0, a[1] + (b[1] - a[1]) * t - oy)) });
    }
    return out;
  }
  const projHalfN = N => Math.max(3, Math.round(N / 2) + 1);
  // Kontrollpunkte (B-Spline) zu Kurvenpunkten der Hälfte und zurück — auf der gespiegelten VOLLEN Linie gerechnet: Nase und
  // (ohne Ruder) hinterer Punkt liegen dort mitten in der Kurve, nicht an einem festen Ende (sonst schrumpft die Linie dort)
  function projHalfConv(Q, open, toCtrl) {
    const F = projHalfFull(Q, open).map(q => [+q.dx || 0, +q.dy || 0]);
    const C = toCtrl ? (open ? bsCtrlThroughOpen : bsCtrlThrough)(F) : (open ? bsKnotPtsOpen : bsKnotPts)(F);
    return C.slice(0, Q.length).map(q => ({ dx: r3(q[0]), dy: r3(q[1]) }));
  }
  // Offene Fassungen von bsCtrlThrough/bsKnotPts (Enden bleiben fest).
  function bsCtrlThroughOpen(Q) {
    const m = Q.length, P = Q.map(q => q.slice());
    for (let it = 0; it < 80; it++) for (let i = 1; i < m - 1; i++) P[i] = [(6 * Q[i][0] - P[i - 1][0] - P[i + 1][0]) / 4, (6 * Q[i][1] - P[i - 1][1] - P[i + 1][1]) / 4];
    return P;
  }
  function bsKnotPtsOpen(P) { return P.map((q, i) => i === 0 || i === P.length - 1 ? q.slice() : [(P[i - 1][0] + 4 * q[0] + P[i + 1][0]) / 6, (P[i - 1][1] + 4 * q[1] + P[i + 1][1]) / 6]); }
  // Geschlossener B-Spline durch die Punkte Q: Kontrollpunkte P mit (P[i-1] + 4 P[i] + P[i+1]) / 6 = Q[i] (zyklisch,
  // diagonaldominant -> Gauß-Seidel konvergiert schnell). Umgekehrt: Kurvenpunkte an den Knoten.
  function bsCtrlThrough(Q) {
    const m = Q.length, P = Q.map(q => q.slice());
    for (let it = 0; it < 80; it++) for (let i = 0; i < m; i++) { const a = P[(i - 1 + m) % m], c = P[(i + 1) % m]; P[i] = [(6 * Q[i][0] - a[0] - c[0]) / 4, (6 * Q[i][1] - a[1] - c[1]) / 4]; }
    return P;
  }
  function bsKnotPts(P) { const m = P.length; return P.map((q, i) => { const a = P[(i - 1 + m) % m], c = P[(i + 1) % m]; return [(a[0] + 4 * q[0] + c[0]) / 6, (a[1] + 4 * q[1] + c[1]) / 6]; }); }
  // Projektion (Offset-Art) in N Kontrollpunkte umwandeln — gleichmäßig nach Bogenlänge, beginnend am hintersten Punkt.
  function projToCtrl(F2, ox, oy, N) {
    N = N || 20; let i0 = 0; for (let i = 1; i < F2.length; i++) if (F2[i][0] > F2[i0][0]) i0 = i;
    const R = F2.slice(i0).concat(F2.slice(0, i0)), cum = [0];
    for (let i = 1; i <= R.length; i++) { const a = R[i - 1], b = R[i % R.length]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const L = cum[cum.length - 1], out = [];
    for (let k = 0; k < N; k++) {
      const s = L * k / N; let j = 0; while (j + 1 < cum.length && cum[j + 1] < s) j++;
      const a = R[j], b = R[(j + 1) % R.length], t = (s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
      out.push({ dx: r2(a[0] + (b[0] - a[0]) * t - ox), dy: r2(a[1] + (b[1] - a[1]) * t - oy) });
    }
    return out;
  }
  // Projektion + Anschlussebene der Tragfläche (g.fp, g.fp2, g.base, g.zA, g.zf, g.fl).
  function filWing(m, g, w, auto) {
    const str = Math.max(0, +w.fStr || 0), ex = projExtW(w);
    g.ten = clamp(+w.fTen || 0.55, 0.2, 1.5); g.rnd = clamp(+w.fRnd || 0, 0, 1);
    // Kehlenform oben/unten: ist eine Seite gezeichnet, bekommt die andere die normierte Viertelellipse (gleiche Familie)
    { const U = coveShape(w.cvU, g.ten, w.cvSpl), Lo = coveShape(w.cvL, g.ten, w.cvSpl); g.cvU = U || (Lo ? coveDefault(g.ten) : null); g.cvL = Lo || (U ? coveDefault(g.ten) : null); }
    const { base, F2 } = projRingWing(g, w);
    // Projektion auf den Rumpf: Z der Rumpfhaut in Höhe y (für Anschlussebene, Draufsicht und Warnungen)
    const Fp = []; let clampY = false, outX = false, zMax = 0, i0 = 0, i1 = 0;
    for (let i = 0; i < F2.length; i++) {
      const [x, y] = F2[i]; if (x < m.x0 || x > m.x1) outX = true;
      const xc = clamp(x, m.x0, m.x1), P = g.bodyAt ? g.bodyAt(xc) : bodyHalf(m, xc), top = P[0][0], bot = P[P.length - 1][0];
      if (y > top - 0.5 || y < bot + 0.5) clampY = true;
      const c = crossY(P, clamp(y, bot + 1e-6, top - 1e-6)), z = c ? c.z : 0;
      Fp.push([x, y, z]); zMax = Math.max(zMax, z);
      if (x < F2[i0][0]) i0 = i; if (x > F2[i1][0]) i1 = i;
    }
    let zA = auto ? zMax + Math.max(10, 1.5 * (ex.d + Math.max(ex.u, ex.l))) : (g.zSet || 0) - str;
    if (!(zA > zMax + 1)) { g.warns.push(T('Wurzelrippe liegt zu nah am Rumpf — Z vergrößern (Anschluss muss außerhalb der Projektion liegen).')); zA = zMax + 1; }
    if (clampY) g.warns.push(T('Projektion reicht über die Rumpfober- oder -unterkante — Verlängerung oben/unten verkleinern oder Profillage ändern.'));
    if (outX) g.warns.push(T('Projektion reicht über Rumpfnase oder Heck hinaus.'));
    g.zA = zA; g.zf = zA + str; g.fp = Fp; g.fp2 = F2; g.base = base;
    g.fl = { x0: F2[i0][0], x1: F2[i1][0], y0: F2[i0][1], y1: F2[i1][1] };
    // Leitlinien (Draufsicht X/Z): Nase = Projektionsanfang auf dem Rumpf -> Nasenleiste der Wurzelrippe, Endleiste =
    // Endleiste der Wurzelrippe -> Projektionsende auf dem Rumpf. Stützpunkte relativ (u längs X, v Rumpf … Rippe).
    // Rumpfhaut fein (wie das Gitter), Spantschnitte je X zwischengespeichert (die Nasenfläche fragt sie oft ab)
    // Spantschnitte auf einem 0,5-mm-Raster, dazwischen linear in X (die Nasenfläche fragt sehr viele Fußpunkte ab)
    const bhC = new Map(), bh = i => { let P = bhC.get(i); if (!P) { const xc = clamp(i * 0.5, m.x0, m.x1); P = g.bodyAtFine ? g.bodyAtFine(xc) : bodyHalfFine(m, xc); bhC.set(i, P); } return P; };
    const zAt = (P, y) => { const c = crossY(P, clamp(y, P[P.length - 1][0] + 1e-6, P[0][0] - 1e-6)); return c ? c.z : 0; };
    const zBody = (x, y) => { const xc = clamp(x, m.x0, m.x1), i = Math.floor(xc / 0.5), f = xc / 0.5 - i, a = zAt(bh(i), y); return f > 1e-9 ? a + (zAt(bh(i + 1), y) - a) * f : a; };
    const xT = g.xLE + g.chord, zb0 = zBody(g.fl.x0, g.fl.y0), zb1 = zBody(g.fl.x1, g.fl.y1);
    const mapPts = (L, xa, xb, za, zbb) => (L || []).map(p => [xa + clamp(+p.u || 0, 0.02, 0.98) * (xb - xa), za + clamp(+p.v || 0, 0, 1) * (zbb - za)]).sort((a, b) => a[0] - b[0]);
    g.gLE = filGuide([g.fl.x0, zb0], 'flat', mapPts(w.gLE, g.fl.x0, g.xLE, zb0, zA), [g.xLE, zA], 'up', g.ten);
    g.gTE = filGuide([xT, zA], 'down', mapPts(w.gTE, xT, g.fl.x1, zb1, zA), [g.fl.x1, zb1], 'flat');
    g.gRef = { le: [g.fl.x0, g.xLE, zb0, zA], te: [xT, g.fl.x1, zb1, zA] }; g.zb1 = zb1;
    // Halber Keilwinkel der Wurzelrippe an der Endleiste (tan), aus den letzten 2 % der Tiefe
    // Steigung von Profil-Ober-/-Unterseite an der Endleiste (letzte 1 % der Tiefe) und Übergangslänge der Endleisten-Kante
    { const dx = 0.01 * g.chord, a = wingYs(g, xT - dx), b = wingYs(g, xT); g.su = (b.yu - a.yu) / dx; g.sl = (b.yl - a.yl) / dx; g.teBl = clamp(0.2 * (g.fl.x1 - xT), 3, 10); }
    // Nasenradius der Wurzelrippe (aus der halben Dicke kurz hinter der Nase: t/2 ≈ √(2·r·δ))
    { const dx = Math.max(0.05, 0.004 * g.chord), y = wingYs(g, g.xLE + dx); g.rN = Math.max(0.2, ((y.yu - y.yl) / 2) ** 2 / (2 * dx)); }
    g.loft = filLoft(g, zBody);
  }
  // Nase der Anformung als Fläche zwischen Wurzelprofil (Anschlussebene zA) und Projektion (Rumpf): je Profilpunkt eine
  // Kurve in der Ebene aus Profilnormale n und Z — vom Fußpunkt auf der Projektion (tangential zur Rumpfhaut) zur Rippe
  // (Ankunft längs Z), alle in der Form der Leitlinie der Nase. Jeder waagrechte Schnitt ist so ein glatter Offset
  // des Profils (keine Einschnürung vor der Nasenleiste), jeder Spantschnitt endet vorn mit einer runden Kuppe.
  // Seitenleitwerk: g.prof(x) liefert {yu, yl} statt wingYs, g.anchor(x) die Anschlusshöhe je Profilpunkt (schräge
  // Schnittlinie) statt der festen Ebene zA; zBody(x, quer) ist dort die Höhe des Rumpfrückens.
  function filLoft(g, zBody) {
    const c = g.chord, ND = 600, D = [], F2 = g.fp2, zA = g.zA, pf = g.prof || (x => wingYs(g, x));
    for (let i = ND; i >= 0; i--) { const u = (1 - Math.cos(Math.PI * i / ND)) / 2, x = g.xLE + u * c; D.push([x, pf(x).yu]); }
    for (let i = 1; i <= ND; i++) { const u = (1 - Math.cos(Math.PI * i / ND)) / 2, x = g.xLE + u * c; D.push([x, pf(x).yl]); }
    // ausdünnen: Schritt höchstens 1,5 % der Tiefe und 1,5° Drehung der Normalen (an der Nase fächern die Normalen weit
    // auf die Projektion aus — grobe Winkelschritte gäben eckige Schichten)
    const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]), R = [D[0]];
    for (let i = 1, la = 0, lt = ang(D[0], D[1]); i < D.length; i++) {
      const a = ang(D[i - 1], D[i]); let da = Math.abs(a - lt); if (da > Math.PI) da = 2 * Math.PI - da;
      la += Math.hypot(D[i][0] - D[i - 1][0], D[i][1] - D[i - 1][1]);
      if (i === D.length - 1 || la > 0.015 * c || da > 0.026) { R.push(D[i]); la = 0; lt = a; }
    }
    // Normalen: Profil ist ein Polygon aus den .dat-Punkten (Knicke von 5–10° an der Nase) — mitteln, glätten und nach
    // Winkel verdichten (≤ 1°), sonst werden die Schichten mit dem großen Vorlauf eckig
    const N0 = R.map((P, k) => { const a = R[Math.max(0, k - 1)], b = R[Math.min(R.length - 1, k + 1)], tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[1] - a[1]) / tl, -(b[0] - a[0]) / tl]; });
    for (let pass = 0; pass < 3; pass++) { const W = N0.map(v => v.slice()); for (let k = 1; k + 1 < N0.length; k++) { const mx = N0[k - 1][0] + 2 * N0[k][0] + N0[k + 1][0], my = N0[k - 1][1] + 2 * N0[k][1] + N0[k + 1][1], ml = Math.hypot(mx, my) || 1; W[k] = [mx / ml, my / ml]; } for (let k = 0; k < N0.length; k++) N0[k] = W[k]; }
    const RN = [];
    for (let k = 0; k < R.length; k++) {
      RN.push([R[k], N0[k]]); if (k + 1 >= R.length) break;
      const u = N0[k], v = N0[k + 1], da = Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]), st = Math.ceil(Math.abs(da) / 0.017);
      for (let j = 1; j < st; j++) { const t = j / st, c2 = Math.cos(da * t), s2 = Math.sin(da * t); RN.push([[R[k][0] + (R[k + 1][0] - R[k][0]) * t, R[k][1] + (R[k + 1][1] - R[k][1]) * t], [u[0] * c2 - u[1] * s2, u[0] * s2 + u[1] * c2]]); }
    }
    const n = RN.length;
    // Leitlinie normiert: Abstand vor der Nase (0..1) und Höhe (0 Rumpf … 1 Rippe) über der Bogenlänge
    const gp = g.gLE.pts, x0 = gp[0][0], z0 = gp[0][1], gl = [0], gn = gp.map(q => [(g.xLE - q[0]) / Math.max(1e-6, g.xLE - x0), (q[1] - z0) / Math.max(1e-6, zA - z0)]);
    let acc = 0; for (let i = 1; i < gn.length; i++) { acc += Math.hypot(gn[i][0] - gn[i - 1][0], gn[i][1] - gn[i - 1][1]); gl.push(acc); }
    const guideAt = (t, q) => {
      // Seitenleitwerk: Leitlinie der Nase als normierte Form (wie die Kehle) — an der Nase sie, an den Flanken die Kehlenform,
      // dazwischen nach der Profilnormalen weich gemischt (beide Formen: Fuß waagrecht, Ankunft senkrecht -> stetig mischbar)
      if (g.guideN) { const w = q ? q.wN : 1, A = g.guideN.at(t), B = g.cvSide.at(t), a = w * A[0] + (1 - w) * B[0], b = w * A[1] + (1 - w) * B[1]; return [1 - a, b]; }
      // gezeichnete Kehlenform: oben/unten nach der Profilnormalen weich gemischt (um die Nase je zur Hälfte)
      if (g.cvU) { const wU = q ? q.wU : 0.5, A = g.cvU.at(t), B = g.cvL.at(t), a = wU * A[0] + (1 - wU) * B[0], b = wU * A[1] + (1 - wU) * B[1]; return [1 - a, b]; }
      const L = t * acc; let lo = 0, hi = gl.length - 1; while (hi - lo > 1) { const mI = (lo + hi) >> 1; if (gl[mI] <= L) lo = mI; else hi = mI; }
      const d = gl[hi] - gl[lo], f = d > 1e-12 ? clamp((L - gl[lo]) / d, 0, 1) : 0; return [gn[lo][0] + (gn[hi][0] - gn[lo][0]) * f, gn[lo][1] + (gn[hi][1] - gn[lo][1]) * f];
    };
    const S = [];
    for (let k = 0; k < n; k++) {
      const P = RN[k][0], nv = RN[k][1];
      // Fußpunkt: Strahl längs der Normalen bis zur Projektion
      let lam = Infinity;
      for (let i = 0, m2 = F2.length; i < m2; i++) {
        const A = F2[i], B = F2[(i + 1) % m2], ex = B[0] - A[0], ey = B[1] - A[1], den = nv[0] * ey - nv[1] * ex; if (Math.abs(den) < 1e-12) continue;
        const qx = A[0] - P[0], qy = A[1] - P[1], l = (qx * ey - qy * ex) / den, u = (qx * nv[1] - qy * nv[0]) / den;
        if (l > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9 && l < lam) lam = l;
      }
      S.push({ P, nv, lam });
    }
    for (let k = 0; k < n; k++) if (!isFinite(S[k].lam)) { let j = 1; while (j < n && !isFinite((S[k - j] || {}).lam) && !isFinite((S[k + j] || {}).lam)) j++; S[k].lam = isFinite((S[k - j] || {}).lam) ? S[k - j].lam : (S[k + j] || { lam: 5 }).lam; }
    // Fußabstand begrenzen (Seitenleitwerk: Fuß höchstens bei 92 % der Rumpfbreite wie im Spantschnitt — sonst liegt der Fuß
    // bei zu breiter Projektion neben dem Rumpf in der Luft, die Kehle faltet sich am Fuß)
    if (g.lamMax) for (const q of S) q.lam = Math.min(q.lam, g.lamMax(q.P, q.nv));
    for (const q of S) {
      const F = [q.P[0] + q.nv[0] * q.lam, q.P[1] + q.nv[1] * q.lam], h = 0.5;
      q.F = F; q.zF = zBody(F[0], F[1]);
      q.b = (zBody(F[0] + q.nv[0] * h, F[1] + q.nv[1] * h) - zBody(F[0] - q.nv[0] * h, F[1] - q.nv[1] * h)) / (2 * h);   // Steigung der Rumpfhaut längs n
      const wu = clamp((q.nv[1] + 0.35) / 0.7, 0, 1); q.wU = wu * wu * (3 - 2 * wu);   // Anteil der oberen Kehlenform
      const wn = clamp((-q.nv[0] - 0.3) / 0.5, 0, 1); q.wN = wn * wn * (3 - 2 * wn);      // Anteil der Nasen-Leitlinie
      q.sn = g.slopeN ? g.slopeN(q.P, q.nv) : 0;   // Neigung der Anbaufläche an der Anschlusslinie (Seitenleitwerk)
    }
    // Punkt der Kurve k bei Parameter t (0 Rumpf … 1 Rippe): [x, y, z]. Alle Kurven haben die Form der Leitlinie (auf
    // Fußabstand und Höhe skaliert) — eine einzige Kurvenfamilie, sonst entstehen beim Wechsel Stufen in den Schnitten.
    // Tangential in den Rumpf: Höhe = Mischung aus Leitlinienhöhe und ψ(u) = 1 − (1 − u)^p (u = zurückgelegter Anteil von
    // λ, ψ'(0) = p, ψ'(1) = 0). Nötige Anfangssteigung S = −b·λF/(zA − zF) (b = Steigung der Rumpfhaut längs n):
    // ω·p = S, p ≥ 2, ω ≤ 0,85 — damit immer exakt tangential (vorn, wo sich der Rumpf stark verjüngt, reichte ein
    // gedeckeltes ω nicht: die Kurve lag die ersten Zehntelmillimeter im Rumpf = feine Rinne längs des Fußes). Fällt die
    // Haut nach innen ab (S < 0), folgt die Kurve ihr zuerst (ω < 0).
    // Schräge Abbildung wie bei den Spantkurven: Form-Achse quer läuft längs der Rumpfhaut (Anstieg −b·λF über den Fußabstand),
    // Achse Spannweite längs Z -> jede Kurve verlässt den Rumpf tangential ohne Haken; steile Haut höchstens 75 % der Höhe.
    // Ankunft am Anbau: Richtung (sn längs n, 1 in Spannweite) = Neigung der Anbaufläche (Seitenleitwerk: Pfeilung und
    // Dickenabnahme; Tragfläche 0 = längs Z). Schräge Abbildung wie cvCtl: Achse a längs der Rumpfhaut (Länge a1 in n),
    // Achse b längs der Ankunftsrichtung (Länge b1 in Spannweite), so dass (1, 1) genau den Profilpunkt trifft.
    for (const q of S) {
      const H = Math.max(1e-6, (g.anchor ? g.anchor(q.P[0]) : zA) - q.zF), lam = Math.max(1e-6, q.lam); q.dr = Math.min(-q.b * q.lam, 0.75 * H);
      const A = filArrive(lam, H, q.dr, q.sn || 0); q.sn = A.sn; q.a1 = A.a1; q.b1 = A.b1;
    }
    const at = (k, t) => {
      const q = S[k], G = guideAt(t, q), a = 1 - G[0], bb = G[1], l = q.lam - a * q.a1 + bb * q.b1 * q.sn;
      return [q.P[0] + q.nv[0] * l, q.P[1] + q.nv[1] * l, q.zF + a * q.a1 * q.dr / Math.max(1e-6, q.lam) + bb * q.b1];
    };
    const row = t => { const o = new Array(n); for (let k = 0; k < n; k++) o[k] = at(k, t); return o; };
    const front = Q => { let i = 0; for (let k = 1; k < n; k++) if (Q[k][0] < Q[i][0]) i = k; return i; };
    // Zwischen zwei Kurven wird linear gemittelt — die Sehne zwischen zwei Fußpunkten liegt auf dem gewölbten Rumpf innen
    // (feine Rinne längs des Fußes, v. a. vorn mit weit gefächerten Fußpunkten). Korrektur = echte Rumpfhaut am
    // Zwischenfußpunkt minus gemittelte Fußhöhe, nach oben mit (λ/λF)² abklingend.
    const sag = (k, f, t) => {
      const a = S[k], b = S[k + 1]; if (!b) return 0;
      const Fx = a.F[0] + (b.F[0] - a.F[0]) * f, Fy = a.F[1] + (b.F[1] - a.F[1]) * f, c = zBody(Fx, Fy) - (a.zF + (b.zF - a.zF) * f);
      const G0 = guideAt(t, a)[0]; return c * G0 * G0;
    };
    return { n, row, front, sag, S };
  }
  // Schräge Abbildung einer Übergangskurve in ihrer Ebene (n, Spannweite): Fuß -> Anbau im Abstand lam (längs −n) und in
  // der Höhe H, Rumpfhaut mit Anstieg dr über lam, Ankunft mit Neigung sn (längs n je Höhe). Liefert die Achslängen a1 (längs
  // der Haut, in n gemessen) und b1 (längs der Ankunft, in Spannweite), so dass Fuß + a1·Haut + b1·Ankunft den Anbau trifft.
  // Zu starke Neigungen (nach hinten, sn < 0) werden begrenzt — WEICH (p-Norm-Sättigung, bei kleinen Werten praktisch
  // unverändert): hart abgeschnitten setzte die Grenze bei schmaler Projektion von einer Kurve der Schar zur nächsten
  // schlagartig ein, die Ankunftsneigung sprang (0,36 -> 0,53) und der Spantschnitt bekam eine senkrechte Wand an der Nase.
  // Grenzen: Verschiebung b1·|sn| höchstens 0,85·lam (Kurve bleibt vor ihrem Fuß), Nenner 1 + dr·sn/lam mindestens 0,3.
  function filArrive(lam, H, dr, sn) {
    const fit = s => { const b1 = (H - dr) / (1 + dr * s / lam); return { b1, a1: lam + b1 * s }; };
    if (sn < 0) {
      // exakt: a1 = lam + b1·sn ≥ 0,15·lam <=> −sn ≤ 0,85·lam / (H − 0,15·dr) (mit der Hautsteigung dr im Nenner von b1;
      // die frühere Näherung 0,85·lam / (H − dr) ließ bei starker Pfeilung zu viel zu, dann griff die Sicherung unten
      // stufenweise — Neigung und Achslängen sprangen von Kurve zu Kurve, Stufen in den Spantschnitten an der Nase)
      let lim = 0.85 * lam / Math.max(1e-6, H - 0.15 * dr); if (dr > 1e-9) lim = Math.min(lim, 0.7 * lam / dr);
      const q = -sn / Math.max(1e-9, lim); sn = -lim * q / Math.pow(1 + Math.pow(q, 4), 0.25);
    }
    for (let it = 0; it < 6; it++) {   // Sicherung (sollte nach der Sättigung nicht mehr greifen)
      if (1 + dr * sn / lam < 0.3) { sn = -0.7 * lam / dr; continue; }
      const r = fit(sn); if (r.a1 < 0.1 * lam) { sn *= 0.8; continue; }
      break;
    }
    const r = fit(sn);
    if (!(r.b1 > 0) || !(r.a1 > 0) || !isFinite(r.a1)) return { sn: 0, a1: lam, b1: H - dr };
    return { sn, a1: r.a1, b1: r.b1 };
  }
  const filCR = (p0, p1, p2, p3, f) => { const f2 = f * f, f3 = f2 * f; return 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (3 * p1 - p0 - 3 * p2 + p3) * f3); };
  const filCRd = (p0, p1, p2, p3, f) => 0.5 * ((p2 - p0) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * f + 3 * (3 * p1 - p0 - 3 * p2 + p3) * f * f);
  // Schnitt einer Zeile Q der Kurvenschar (Punkte [x, quer, Spannweite]) mit der Ebene X = x, ab Index i0 in Richtung step:
  // [quer, Spannweite] (mit Durchhang-Korrektur, wenn t gegeben) oder null. Catmull-Rom über vier Nachbarkurven.
  // Die Zeile wird mit laufendem Maximum in X abgelaufen: bei starker Pfeilung lehnen die Kurven an der Nase so weit zurück,
  // dass eine Zeile stellenweise kurz rückwärts läuft (~0,02 mm) — die Ebene traf sie dann dreimal, je Spalte wurde ein anderer
  // Treffer genommen (Sprünge von 0,2 mm im Spantschnitt). Mit dem laufenden Maximum gibt es genau einen Treffer.
  function filRowCross(Lf, Q, i0, step, t, x) {
    const n = Lf.n; let mx = Q[i0] ? Q[i0][0] : -Infinity;
    for (let k = i0; k + step >= 0 && k + step < n; k += step) {
      const a = Q[k], b = Q[k + step], xa = mx; mx = Math.max(mx, b[0]); const xb = mx;
      if ((xa - x) * (xb - x) > 0 || xa === xb) continue;
      // Nachbarn für die Tangente: nie über den Startindex (Scheitel/vorderster Punkt) hinweg — die Kurve auf der anderen Seite
      // hat das entgegengesetzte Vorzeichen quer und zog den Schnitt bei schmaler Kuppe zu einem senkrechten Plateau; dort
      // linear fortsetzen
      const kp = k + 2 * step >= 0 && k + 2 * step < n ? k + 2 * step : -1;
      const P0 = k !== i0 && k - step >= 0 && k - step < n ? Q[k - step] : [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]];
      const P3 = kp >= 0 ? Q[kp] : [2 * b[0] - a[0], 2 * b[1] - a[1], 2 * b[2] - a[2]];
      let f = clamp((x - xa) / (xb - xa), 0, 1);
      // Newton auf der Catmull-Rom-Kurve nur, wenn das Stück selbst vorwärts läuft (sonst bleibt die lineare Lage)
      if (b[0] > a[0] && a[0] >= xa - 1e-9) for (let it = 0; it < 5; it++) { const fx = filCR(P0[0], a[0], b[0], P3[0], f) - x, d = filCRd(P0[0], a[0], b[0], P3[0], f); if (!(Math.abs(d) > 1e-12)) break; f = clamp(f - fx / d, 0, 1); }
      const z = filCR(P0[2], a[2], b[2], P3[2], f);
      return [filCR(P0[1], a[1], b[1], P3[1], f), t == null ? z : z + (step > 0 ? Lf.sag(k, f, t) : Lf.sag(k - 1, 1 - f, t))];
    }
    return null;
  }
  // Spantschnitt der Nasenfläche bei x: oben (Fuß -> Rippe/Kuppe) und unten (Rippe/Kuppe -> Fuß) als [y, z], je M - 1
  // Schichten (Kosinus-Teilung, dicht an Rumpf und Rippe); vor der Nasenleiste endet der Schnitt mit dem Scheitel (apex).
  // Zwischen den Kurven der Schar nicht linear, sondern Catmull-Rom über vier Nachbarkurven (stetige Tangente): linear knickte
  // der Schnitt an jeder Kurve der Schar (~ alle 1 mm) — kleine Welligkeit, im Zebra als Fransen an der Nase sichtbar.
  function filLoftSec(Lf, xLE, x, M) {
    const n = Lf.n, cross = (Q, i0, step, t) => filRowCross(Lf, Q, i0, step, t, x);
    // vorderster Punkt einer Zeile: Parabel durch die vorderste Kurve und ihre Nachbarn (nicht auf die Kurve gerastet —
    // sonst springt der Scheitel von Kurve zu Kurve und mit ihm die Höhe der Kuppe)
    const frontPt = Q => {
      const i = Lf.front(Q); if (i <= 0 || i >= n - 1) return Q[i];
      const A = Q[i - 1], B = Q[i], C = Q[i + 1], den = A[0] - 2 * B[0] + C[0]; if (!(den > 1e-12)) return B;
      const d = clamp((A[0] - C[0]) / (2 * den), -0.5, 0.5), q = c => B[c] + d * (C[c] - A[c]) / 2 + d * d * (A[c] - 2 * B[c] + C[c]) / 2;
      return [q(0), q(1), q(2)];
    };
    let tTop = 1, apex = null;
    if (x < xLE) {
      const fx = t => frontPt(Lf.row(t))[0];
      if (fx(0) >= x) return null;
      let lo = 0, hi = 1; for (let k = 0; k < 40; k++) { const m2 = (lo + hi) / 2; if (fx(m2) < x) lo = m2; else hi = m2; }
      tTop = lo; const A = frontPt(Lf.row(tTop)); apex = [A[1], A[2]];
    }
    const up = [], lo2 = [];
    for (let j = 1; j <= M; j++) {
      const t = tTop * (1 - Math.cos(Math.PI * j / M)) / 2, Q = Lf.row(t), i = Lf.front(Q);
      if (j === M && apex) { up.push(apex); break; }
      const u = cross(Q, i, -1, t), l = cross(Q, i, 1, t); if (!u || !l) return null;
      up.push(u); lo2.push(l);
    }
    lo2.reverse();
    return { up, lo: lo2, apex: !!apex };
  }
  // Leitlinie als Hermite-Spline durch P0, Stützpunkte, Pn (Draufsicht X/Z). Endtangente 'flat' = längs X (läuft tangential
  // am Rumpf aus), 'chord' = zum Nachbarpunkt (endet mit endlicher Steigung an der Wurzelrippe). Liefert die Linie fein
  // abgetastet und z(x) (X monoton: Stützpunkte nach X sortiert).
  function filGuide(P0, t0, mids, Pn, tn, al) {
    const K = [P0].concat(mids, [Pn]), n = K.length, T = [];
    for (let i = 0; i < n; i++) {
      const a = K[Math.max(0, i - 1)], b = K[Math.min(n - 1, i + 1)];
      let t = [(b[0] - a[0]) / (i > 0 && i < n - 1 ? 2 : 1), (b[1] - a[1]) / (i > 0 && i < n - 1 ? 2 : 1)];
      if ((i === 0 && t0 === 'flat') || (i === n - 1 && tn === 'flat')) t = [Math.abs(t[0]), 0];
      if (i === n - 1 && typeof tn === 'number') t = [Math.abs(t[0]), Math.abs(t[0]) * tn];   // Steigung der Rumpfhaut: tangential in den Rumpf
      if (i === 0 && t0 === 'down') t = [0, -Math.hypot(t[0], t[1])];   // senkrecht zur Sehne: tangential an die Endleiste
      if (i === n - 1 && tn === 'up') t = [0, Math.hypot(t[0], t[1])];   // senkrecht zur Sehne: tangential in die Nasenleiste
      // Länge der Endtangenten wie die Bezier im Profilbereich (Griff = Völligkeit · Achsabstand, Hermite = 3 × Griff):
      // ohne Stützpunkte ist die Leitlinie dann genau die Viertelellipse der übrigen Übergangskurven
      if (al && i === 0 && t0 === 'flat') t = [3 * al * Math.abs(K[1][0] - K[0][0]), 0];
      if (al && i === n - 1 && tn === 'up') t = [0, 3 * al * Math.abs(K[n - 1][1] - K[n - 2][1])];
      T.push(t);
    }
    const pts = [];
    for (let i = 0; i + 1 < n; i++) {
      const a = K[i], b = K[i + 1], ta = T[i], tb = T[i + 1];
      for (let k = i ? 1 : 0; k <= 24; k++) {
        const s1 = k / 24, s2 = s1 * s1, s3 = s2 * s1, h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s1, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
        pts.push([h00 * a[0] + h10 * ta[0] + h01 * b[0] + h11 * tb[0], h00 * a[1] + h10 * ta[1] + h01 * b[1] + h11 * tb[1]]);
      }
    }
    for (let i = 1; i < pts.length; i++) if (pts[i][0] < pts[i - 1][0]) pts[i][0] = pts[i - 1][0];   // X monoton halten
    const at = x => {
      if (x <= pts[0][0]) return pts[0][1]; if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
      let lo = 0, hi = pts.length - 1; while (hi - lo > 1) { const mI = (lo + hi) >> 1; if (pts[mI][0] <= x) lo = mI; else hi = mI; }
      const d = pts[hi][0] - pts[lo][0]; return d > 1e-12 ? pts[lo][1] + (pts[hi][1] - pts[lo][1]) * (x - pts[lo][0]) / d : pts[hi][1];
    };
    return { pts, at, K };
  }
  // kubische Bezier p0 (Richtung d0) -> p3 (Ankunftsrichtung d3) in der Spantebene, nur innere Punkte (Herkunft tag).
  function filBez(p0, d0, p3, d3, al, tag) {
    const NB = 18, w0 = p3[0] - p0[0], w1 = p3[1] - p0[1], Lw = Math.hypot(w0, w1);
    const a = Math.max(w0 * d0[0] + w1 * d0[1], 0.25 * Lw), b = Math.max(w0 * d3[0] + w1 * d3[1], 0.25 * Lw);
    const b1 = [p0[0] + d0[0] * al * a, p0[1] + d0[1] * al * a], b2 = [p3[0] - d3[0] * al * b, p3[1] - d3[1] * al * b], out = [];
    for (let i = 1; i < NB; i++) {
      const t = i / NB, s = 1 - t, c0 = s * s * s, c1 = 3 * s * s * t, c2 = 3 * s * t * t, c3 = t * t * t;
      out.push([c0 * p0[0] + c1 * b1[0] + c2 * b2[0] + c3 * p3[0], c0 * p0[1] + c1 * b1[1] + c2 * b2[1] + c3 * p3[1], tag]);
    }
    return out;
  }
  function filBezCtl(p0, d0, p3, d3, al) {
    const w0 = p3[0] - p0[0], w1 = p3[1] - p0[1], Lw = Math.hypot(w0, w1);
    const a = Math.max(w0 * d0[0] + w1 * d0[1], 0.25 * Lw), b = Math.max(w0 * d3[0] + w1 * d3[1], 0.25 * Lw);
    return [p0, [p0[0] + d0[0] * al * a, p0[1] + d0[1] * al * a], [p3[0] - d3[0] * al * b, p3[1] - d3[1] * al * b], p3];
  }
  function filBezAt(c, t) { const s1 = 1 - t, a = s1 * s1 * s1, b = 3 * s1 * s1 * t, d = 3 * s1 * t * t, e = t * t * t; return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]]; }
  // Eigene Form der Hohlkehle (in der Vorderansicht gezeichnet): Umrisspunkte wie die Rumpfumrisse ({x, v, c, i, o},
  // krümmungsstetiger Spline outSegs 'c2', Punkttypen glatt/Tangente/Ecke), normiert zwischen Rumpffuß (0, 0) und
  // Wurzelrippe (1, 1) — x quer (Richtung Rippe), v in Spannweite. Endpunkte mit fester Richtung: waagrecht aus dem Fuß,
  // längs Z in die Rippe. Nach Bogenlänge parametriert. null = keine eigene Form.
  function coveEnds(al, mids) {
    const P = [{ x: 0, v: 0, c: 1, i: [0, 0], o: [al, 0], auto: true }].concat((mids || []).map(q => ({ x: r2(clamp(q.x, 0.03, 0.95)), v: r2(clamp(q.v, 0, 1)), c: 0 })).sort((u, w) => u.x - w.x), [{ x: 1, v: 1, c: 1, i: [0, -al], o: [0, 0], auto: true }]);
    return P;
  }
  function coveFromPoly(P) {
    const L = [0]; for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const tot = L[L.length - 1] || 1;
    const at = t => {
      const q = clamp(t, 0, 1) * tot; let lo = 0, hi = P.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= q) lo = m; else hi = m; }
      const d = L[hi] - L[lo], f = d > 1e-12 ? (q - L[lo]) / d : 0;
      // nie über Fuß/Rippe hinaus (Potenz einer negativen Zahl = NaN)
      return [clamp(P[lo][0] + (P[hi][0] - P[lo][0]) * f, 0, 1), clamp(P[lo][1] + (P[hi][1] - P[lo][1]) * f, 0, 1)];
    };
    return { at, pts: P };
  }
  // Wie coveFromPoly, aber exakt auf den Bezier-Segmenten ausgewertet: Bogenlängentabelle (N je Segment) liefert Segment und
  // Parameter, der Punkt kommt aus der Bezierkurve selbst. Linear zwischen Polygonpunkten war die Kurve nur stückweise gerade —
  // der Krümmungskamm sprang an jeder Polygonecke (gezackt), und die Kehle hatte feine Facetten.
  function coveFromSegs(segs, N) {
    N = N || 96; const S = [], L = [0], P = [];
    for (let k = 0; k < segs.length; k++) for (let j = (k ? 1 : 0); j <= N; j++) {
      const u = j / N, q = bez2(segs[k].P, u); S.push([k, u]); P.push(q);
      if (P.length > 1) { const a = P[P.length - 2]; L.push(L[L.length - 1] + Math.hypot(q[0] - a[0], q[1] - a[1])); }
    }
    const tot = L[L.length - 1] || 1;
    const at = t => {
      const q = clamp(t, 0, 1) * tot; let lo = 0, hi = P.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= q) lo = m; else hi = m; }
      const d = L[hi] - L[lo], f = d > 1e-12 ? (q - L[lo]) / d : 0, A = S[lo], B = S[hi];
      // gleiches Segment: Parameter interpolieren und exakt auswerten; über eine Segmentgrenze (Anfang des nächsten) ebenso
      const k = B[0], u = A[0] === B[0] ? A[1] + (B[1] - A[1]) * f : B[1] * f, r = bez2(segs[k].P, u);
      return [clamp(r[0], 0, 1), clamp(r[1], 0, 1)];   // nie über Fuß/Rippe hinaus (Potenz einer negativen Zahl = NaN)
    };
    return { at, pts: P };
  }
  // Endgriffe mit auto: Länge = Völligkeit × Breite bzw. Höhe des ersten/letzten Abschnitts (ein voller Griff vor einem
  // nahen Punkt machte die Kurve S-förmig); gezogene Endgriffe bleiben, wie sie sind.
  // B-Spline ('bs', wie bei den Umrissen): die Punkte sind Kontrollpunkte (die Kurve läuft nicht hindurch, sie wird nur
  // angezogen -> ruhig, nie mehr Wendepunkte als das Kontrollpolygon). Die Endrichtungen halten zwei Hilfspunkte (ph):
  // waagrecht neben dem Fuß und senkrecht unter dem Rippenpunkt, Abstand = Endgriff (automatisch oder gezogen).
  function coveFix(pts, al, mode) {
    const n = pts.length, P = pts.map(q => Object.assign({}, q));
    const oL = P[0].auto ? al * (P[1].x - P[0].x) : Math.max(0.01, (P[0].o || [al])[0]);
    const iL = P[n - 1].auto ? al * (P[n - 1].v - P[n - 2].v) : Math.max(0.01, -((P[n - 1].i || [0, -al])[1]));
    if (mode !== 'bs') { P[0].o = [oL, 0]; P[n - 1].i = [0, -iL]; return P; }
    const xa = n > 2 ? P[1].x : 1, vb = n > 2 ? P[n - 2].v : 0;
    const A = { x: Math.min(oL, 0.8 * xa), v: 0, c: 0, ph: 'o' }, B = { x: 1, v: 1 - Math.min(iL, 0.8 * (1 - vb)), c: 0, ph: 'i' };
    return [P[0], A].concat(P.slice(1, n - 1), [B, P[n - 1]]);
  }
  function coveSegs(pts, al, mode) { const F = coveFix(pts, al || 0.55, mode); return mode === 'bs' ? bsSegs(F) : outSegs(F, 'c2'); }
  function coveShape(pts, al, mode) {
    if (!Array.isArray(pts) || pts.length < 2) return null;
    return coveFromSegs(coveSegs(pts, al, mode), 96);
  }
  // Viertelellipse normiert (wie filBezCtl mit waagrechtem Fuß), für die nicht gezeichnete Seite
  function coveDefault(al) { return coveFromSegs([{ P: filBezCtl([0, 0], [1, 0], [1, 1], [0, 1], al) }], 200); }
  function cvCtl(g, p0, d0, p3, d3, al) {
    if (!g.cvU) return filBezCtl(p0, d0, p3, d3, al);
    const rev = p0[1] > p3[1], F = rev ? p3 : p0, R = rev ? p0 : p3, D = rev ? [-d3[0], -d3[1]] : d0;
    const dy = R[0] - F[0], dz = Math.max(1e-6, R[1] - F[1]), S = Math.abs(D[0]) > 1e-6 ? D[1] / D[0] : 0;
    // Schräge Abbildung: Form-Achse x läuft längs der Rumpfhaut (Anstieg sdy über die Breite dy), Achse v in Spannweite —
    // so verlässt jede Form den Rumpf tangential, ohne Haken. Steht die Haut sehr steil, höchstens 75 % der Höhe über die Haut.
    const sdy = Math.min(S * dy, 0.75 * dz);
    // oben: Fuß liegt über der Rippe (dy < 0), unten darunter
    return { cv: dy <= 0 ? g.cvU : g.cvL, F, dy, dz, rev, sdy, beta: dz - sdy };
  }
  function cvAt(c, t) {
    if (Array.isArray(c)) return filBezAt(c, t);
    const ab = c.cv.at(c.rev ? 1 - t : t);
    return [c.F[0] + c.dy * ab[0], c.F[1] + c.sdy * ab[0] + c.beta * ab[1]];
  }
  function cvSample(g, p0, d0, p3, d3, al, tag) {
    if (!g.cvU) return filBez(p0, d0, p3, d3, al, tag);
    const c = cvCtl(g, p0, d0, p3, d3, al), out = [];
    for (let i = 1; i < 18; i++) { const q = cvAt(c, i / 18); out.push([q[0], q[1], tag]); }
    return out;
  }
  // Kreisbogen um c von Winkel a0 nach a1 (Bogenmaß, in der Ebene (Y, Z)), ohne Endpunkte.
  function filArc(c, r, a0, a1, tag, n) { const o = []; for (let i = 1; i < n; i++) { const a = a0 + (a1 - a0) * i / n; o.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), tag]); } return o; }
  // Spant bei x mit Anformung: Rumpf bis zur Projektion, Übergang, (gerades Stück und) Wurzelrippe, Übergang, Rumpf.
  // Merkpunkte wie beim Stummel: [Fuß oben ×2, Rippe oben, Rippe unten, Fuß unten ×2] — in der Beule Kappe oben/unten.
  function wingFil(g, x, P, none) {
    const L = g.fl; if (!L || !P || P.length < 2 || x <= L.x0 || x >= L.x1) return none();
    const X = finCross(g.fp2, x, 0); if (X.length < 2) return none();
    const top = P[0][0], bot = P[P.length - 1][0], A = 2, al = g.ten;
    const snap = y => crossY(P, clamp(y, bot + 1e-6, top - 1e-6));
    const cu = snap(X[X.length - 1]), cl = snap(X[0]); if (!cu || !cl || !(cu.y > cl.y + 1e-6)) return none();
    // Laufrichtung der Rumpfkontur (oben -> unten) am Fußpunkt
    const dirAt = c => { const a = P[c.k], b = P[c.k + 1], dy = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dy, dz) || 1; return [dy / l, dz / l]; };
    const Du = dirAt(cu), Dl = dirAt(cl), Fu = [cu.y, cu.z], Fl = [cl.y, cl.z], xT = g.xLE + g.chord;
    let res = cutBefore(P, cu); const iTu = res.length - 1; let iCu, iCl;
    if (x > g.xLE && x < xT) {
      const yw = wingYs(g, x), Au = [yw.yu, g.zA], Al = [yw.yl, g.zA];
      // Schnitt der Übergangsfläche (filLoft) — eine Kurvenform rundum; ab 70 % der Tiefe weich in die Spantkurve, die
      // hinter der Endleiste weiterläuft
      const b1 = 0.7 * g.chord, b2 = 0.92 * g.chord, M = 30, Sx = g.loft && x < g.xLE + b2 ? filLoftSec(g.loft, g.xLE, x, M) : null;
      if (Sx && Sx.up.length === M && Sx.lo.length === M) {
        const wq = clamp((x - g.xLE - b1) / (b2 - b1), 0, 1), w = wq * wq * (3 - 2 * wq);
        const Cu = cvCtl(g, Fu, Du, Au, [0, 1], al), Cl = cvCtl(g, Fl, [-Dl[0], -Dl[1]], Al, [0, 1], al);
        // Schicht j (ohne die letzte = Rippenpunkt) mit der Spantkurve beim gleichen Parameter mischen
        const mix = (pts, C) => pts.slice(0, -1).map((q, j) => { const o = cvAt(C, (1 - Math.cos(Math.PI * (j + 1) / M)) / 2); return [(1 - w) * q[0] + w * o[0], (1 - w) * q[1] + w * o[1], A]; });
        res = res.concat(mix(Sx.up, Cu)); res.push([Au[0], Au[1], A]);
        if (g.zf > g.zA + 1e-6) res.push([yw.yu, g.zf, A]);
        iCu = res.length - 1; res.push([yw.yl, g.zf, A]); iCl = res.length - 1;
        if (g.zf > g.zA + 1e-6) res.push([Al[0], Al[1], A]);
        res = res.concat(mix(Sx.lo.slice().reverse(), Cl).reverse());
        const iTl1 = res.length; res = res.concat(cutAfter(P, cl));
        res.featPts = [iTu, iTu, iCu, iCl, iTl1, iTl1].map(i => res[clamp(i, 0, res.length - 1)]);
        return res;
      }
      res = res.concat(cvSample(g, Fu, Du, Au, [0, 1], al, A)); res.push([Au[0], Au[1], A]);
      if (g.zf > g.zA + 1e-6) res.push([yw.yu, g.zf, A]);
      iCu = res.length - 1; res.push([yw.yl, g.zf, A]); iCl = res.length - 1;
      if (g.zf > g.zA + 1e-6) res.push([Al[0], Al[1], A]);
      res = res.concat(cvSample(g, Al, [0, -1], Fl, Dl, al, A));
    } else {
      // Vor der Nase / hinter der Endleiste: Scheitel zr aus der Leitlinie (Draufsicht). q = 0 am Ende der Projektion, 1 an
      // Nase bzw. Endleiste. Vorn runde Kappe (Halbkreis, Radius rho -> 0 an der Nasenleiste), hinten läuft die Endleiste mit
      // ihrer Dicke (ebene Stirnfläche) unverändert bis zum Rumpf durch.
      const nose = x <= g.xLE, q = clamp(nose ? (x - L.x0) / (g.xLE - L.x0) : (L.x1 - x) / (L.x1 - xT), 0, 1);
      const ye = wingYs(g, nose ? g.xLE : xT), yW = (ye.yu + ye.yl) / 2, yF = nose ? L.y0 : L.y1, gap = cu.y - cl.y;
      const yc = clamp(yF + (yW - yF) * q, cl.y + 0.05 * gap, cu.y - 0.05 * gap);
      const cb = snap(yc), zb = cb ? cb.z : 0, zFt = Math.max(cu.z, cl.z, zb);
      // Hinten: Leitlinie als Anteil der Höhe zwischen Rumpfhaut unter der Kante (zFt) und Rippe — die Kante bleibt bis
      // zum Projektionsende über dem Rumpf und läuft dort tangential aus (vorher lag sie das letzte Stück auf der Haut)
      const zr = nose ? clamp(g.gLE.at(x), zFt + 1e-3, g.zA)
        : clamp(zFt + (g.zA - zFt) * clamp((g.gTE.at(x) - g.zb1) / Math.max(1e-6, g.zA - g.zb1), 0, 1), zFt + 1e-3, g.zA);
      let Pt, Pb;
      const Sn = nose && g.loft ? filLoftSec(g.loft, g.xLE, Math.min(x, g.xLE - 1e-4), 30) : null;   // an der Nasenleiste: Scheitel knapp davor
      if (Sn && Sn.up.length > 4) {
        // Kuppe: nur der Scheitel mit den Nachbarschichten als eigenes Stück (Merkpunkte) — es entspricht hinter der Nase der
        // Rippenfläche, die an der Nasenleiste ebenfalls auf null schrumpft; ein größeres Stück ließ dort Zeilen umklappen
        const nc = 2;
        Sn.up.forEach((q, j) => { res.push([q[0], q[1], A]); if (j === Sn.up.length - nc) iCu = res.length - 1; });
        Sn.lo.forEach((q, j) => { res.push([q[0], q[1], A]); if (j === nc - 2) iCl = res.length - 1; });
        if (iCl === undefined || iCl <= iCu) iCl = res.length - 1;
        const iTn = res.length; res = res.concat(cutAfter(P, cl));
        res.featPts = [iTu, iTu, iCu, iCl, iTn, iTn].map(i => res[clamp(i, 0, res.length - 1)]);
        return res;
      }
      if (nose) {
        // Kappe: mindestens so rund wie die Profilnase gespiegelt (Halbdicke √(2·rN·δ) im Abstand δ vor der Nasenleiste),
        // sonst wird die Anformung bei kurzer Projektion vorn zur dünnen Platte mit Grat
        const dN = Math.max(0, g.xLE - x), rhoN = Math.sqrt(2 * (g.rN || 1) * dN);
        // weiche Begrenzung (p-Norm statt min): je Spant greift sonst eine andere Grenze -> Radius springt -> Dellen
        const soft = (...v) => { let sm = 0; for (const a of v) { if (!(a > 1e-9)) return 0; sm += Math.pow(a, -4); } return Math.pow(sm, -0.25); };
        const rho = soft(Math.max(g.rnd * gap / 2 * Math.sqrt(1 - q), (g.rnd > 0 ? 1 : 0) * rhoN), 0.5 * (zr - zFt), cu.y - yc - 0.02 * gap, yc - cl.y - 0.02 * gap);
        const cz = zr - rho; Pt = [yc + rho, cz]; Pb = [yc - rho, cz];
        res = res.concat(cvSample(g, Fu, Du, Pt, [0, 1], al, A)); res.push([Pt[0], Pt[1], A]); iCu = res.length - 1;
        if (rho > 1e-4) { res = res.concat(filArc([yc, cz], rho, 0, Math.PI, A, 16)); res.push([Pb[0], Pb[1], A]); }
      } else {
        // Hinter der Endleiste: Kante oben/unten = Profil-Ober-/Unterseite, auf der Länge g.teBl weich (Hermite, gleiche
        // Steigung) in die gleich dicke Endleisten-Kante übergehend (Mitte längs der Skelettlinie zum Projektionsende).
        // Ankunft wie im Profilbereich längs Z — so setzt jeder waagrechte Schnitt die Profilkontur stetig fort.
        const yTm = (ye.yu + ye.yl) / 2, sE = (L.y1 - yTm) / Math.max(1e-6, L.x1 - xT), hh = (ye.yu - ye.yl) / 2, Lb = g.teBl || 5;
        const edgeY = (y0, s0, sgn) => {
          const d = x - xT; if (d >= Lb) return yTm + sE * d + sgn * hh;
          const t = d / Lb, t2 = t * t, t3 = t2 * t, y1 = yTm + sE * Lb + sgn * hh;
          return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * s0 * Lb + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * sE * Lb;
        };
        // Dicke der Kante exakt konstant (= Endleistendicke der Wurzelrippe); nur die Mittellinie geht weich (gleiche
        // Steigung) von der Skelettlinie an der Endleiste in die Gerade zum Projektionsende über
        // Zur Spitze der Projektion hin darf die Kante nicht breiter sein als der Fuß darunter (sonst steht am Ende eine
        // dünne Platte auf dem Rumpf): halbe Dicke weich (p-Norm) auf ≤ 0,35 × Fußbreite begrenzt — vorher wirkungslos
        const hE = Math.pow(Math.pow(hh, -4) + Math.pow(Math.max(1e-6, 0.35 * gap), -4), -0.25);
        const ym = clamp(edgeY(yTm, ((g.su || 0) + (g.sl || 0)) / 2, 0), cl.y + 1.2 * hE, cu.y - 1.2 * hE); let yU = ym + hE, yL = ym - hE;
        // Übergangskurven wie im Profilbereich (Ziel in der Anschlussebene zA, Ankunft längs Z), dann an der Leitlinie (Höhe
        // zr) abgeschnitten — die Kurvenform darunter ändert sich hinter der Endleiste stetig, keine Kante im Schnitt. Die
        // Ziele oben/unten werden um dh verschoben, bis der Abstand der abgeschnittenen Kurven in zr der Kantendicke entspricht.
        const spec = Math.max(0, yU - yL), cutAt = (cp, up) => {
          const zt = t => cvAt(cp, t)[1];
          // obere Kurve läuft von unten (Rumpf) nach oben, untere von oben nach unten
          let lo = 0, hi = 1; for (let k = 0; k < 40; k++) { const m2 = (lo + hi) / 2; if ((zt(m2) < zr) === up) lo = m2; else hi = m2; }
          return (lo + hi) / 2;
        };
        const mk = dh => {
          const cu2 = cvCtl(g, Fu, Du, [yU + dh, g.zA], [0, 1], al), cl2 = cvCtl(g, [yL - dh, g.zA], [0, -1], Fl, Dl, al);
          const tu = cutAt(cu2, true), tl = cutAt(cl2, false);
          return { cu2, cl2, tu, tl, yu: cvAt(cu2, tu)[0], yl: cvAt(cl2, tl)[0] };
        };
        let best = mk(0);
        if (Math.abs(best.yu - best.yl - spec) > 1e-4) {   // Abstand in zr auf die Kantendicke bringen (Ziele auseinander/zusammen)
          let lo = -spec / 2 - 0.5 * gap, hi = 0.5 * gap;
          for (let k = 0; k < 40; k++) { const m2 = (lo + hi) / 2, r = mk(m2); if (r.yu - r.yl > spec) hi = m2; else lo = m2; }
          best = mk((lo + hi) / 2);
        }
        // Kurz vor der Spitze liegt die Kante so tief, dass sich die abgeschnittenen Kurven nicht mehr auf die Kantendicke
        // zusammenführen lassen (Kante würde breiter). Dann weich auf Kurven umblenden, die direkt an der Kante (yU/yL, zr)
        // längs Z enden — Gewicht nach dem Überschuss der Breite, also stetig über X.
        // Umblenden über einen langen Teil der Verlängerung (15–60 % von Endleiste bis Projektionsende), damit sich die
        // Flankenneigung nicht auf wenigen mm ändert (sichtbarer Knick); wo die Trimmung früher scheitert, greift der Überschuss
        const over = best.yu - best.yl - spec, wq = clamp(over / Math.max(0.05, spec), 0, 1);
        const qx = clamp(((x - xT) / Math.max(1e-6, L.x1 - xT) - 0.15) / 0.45, 0, 1), wr = Math.max(wq, qx), wD = wr * wr * (3 - 2 * wr);
        const du = wD > 0 ? cvCtl(g, Fu, Du, [yU, zr], [0, 1], al) : null, dl = wD > 0 ? cvCtl(g, [yL, zr], [0, -1], Fl, Dl, al) : null;
        const atU = f => { const q = cvAt(best.cu2, best.tu * f); if (!du) return q; const r = cvAt(du, f); return [q[0] + (r[0] - q[0]) * wD, q[1] + (r[1] - q[1]) * wD]; };
        const atL = f => { const q = cvAt(best.cl2, best.tl + (1 - best.tl) * f); if (!dl) return q; const r = cvAt(dl, f); return [q[0] + (r[0] - q[0]) * wD, q[1] + (r[1] - q[1]) * wD]; };
        // Rest-Überbreite: Enden symmetrisch auf die Kantendicke ziehen, Korrektur mit f³ zum Kantenende hin auslaufend
        const eU = atU(1), eL = atL(0), cm = (eU[0] + eL[0]) / 2, xs = eU[0] - eL[0] > spec ? 1 : 0;
        const kU = xs * (cm + spec / 2 - eU[0]), kL = xs * (cm - spec / 2 - eL[0]);
        const atU2 = f => { const q = atU(f); return [q[0] + kU * f * f * f, q[1]]; }, atL2 = f => { const q = atL(f); return [q[0] + kL * (1 - f) ** 3, q[1]]; };
        const NB2 = 18, segU = [], segL = [];
        for (let k = 1; k < NB2; k++) { const q = atU2(k / NB2); segU.push([q[0], q[1], A]); }
        for (let k = 1; k < NB2; k++) { const q = atL2(k / NB2); segL.push([q[0], q[1], A]); }
        Pt = atU2(1); Pb = atL2(0);
        res = res.concat(segU); res.push([Pt[0], Pt[1], A]); iCu = res.length - 1;
        if (Pt[0] - Pb[0] > 1e-4) res.push([Pb[0], Pb[1], A]);
        iCl = res.length - 1;
        res = res.concat(segL);
        const iTl0 = res.length; res = res.concat(cutAfter(P, cl));
        res.featPts = [iTu, iTu, iCu, iCl, iTl0, iTl0].map(i => res[clamp(i, 0, res.length - 1)]);
        return res;
      }
      iCl = res.length - 1;
      res = res.concat(cvSample(g, Pb, [0, -1], Fl, Dl, al, A));
    }
    const iTl = res.length; res = res.concat(cutAfter(P, cl));
    res.featPts = [iTu, iTu, iCu, iCl, iTl, iTl].map(i => res[clamp(i, 0, res.length - 1)]);
    return res;
  }
  // ---- Anformung des Seitenleitwerks (wie Tragfläche, um 90° gedreht): Leitwerksprofil in Anschlusshöhe yA in der
  // Draufsicht zur Projektion erweitern und senkrecht (in Y) auf den Rumpfrücken projizieren. Je Spant läuft der Übergang
  // tangential aus der Rumpfkontur (Fußpunkt bei Z = halbe Breite der Projektion) und tangential (Richtung −Y = längs der
  // Leitwerksflanke) in das Leitwerk bei yA. Vor der Nasen- und hinter der Endleiste: Beule mit runder Kappe in der
  // Symmetrieebene (Viertelkreis), Dicke wie die Projektion, an der Leitwerkskante stetig in die Profildicke.
  // Gilt für jede Umrissart (Trapez mit/ohne Übergänge, freier Umriss) — der Anschluss ist unabhängig von der Form.
  const projExtF = f => ({ d: Math.max(0.5, +f.pD || 0), f: Math.max(0, +f.pF || 0), b: Math.max(0, +f.pB || 0), u: Math.max(0, +f.pS || 0), l: Math.max(0, +f.pS || 0), rt: true });
  // ---- Ruder: Ruderlinie (Seitenansicht) = Gerade durch die Punkte bei pR % der Tiefe an der Wurzel und pT % an der Spitze
  // (von der Endleiste aus gemessen). Alles hinter der Linie ist Ruder: es gehört nicht zum Rumpf (finT = außen), nur Anzeige.
  function rudGeom(g, f) {
    const r = f.rud; if (!r || !r.on) return null;
    const yR = g.free ? g.yB : g.y0, yT = g.free ? g.yB + 0.9 * (g.yMax - g.yB) : Math.min(g.yPT, g.yT);
    if (!(yT > yR + 1)) return null;
    const a = finChordAt(g, yR), b = finChordAt(g, yT); if (!a || !b) return null;
    const hx = (c, p) => c[1] - clamp(+p || 0, 1, 95) / 100 * (c[1] - c[0]);
    const xR = hx(a, r.pR), xT = hx(b, r.pT), s = (xT - xR) / (yT - yR);
    return { yR, yT, xR, xT, s, xh: y => xR + s * (y - yR), yAt: x => Math.abs(s) > 1e-9 ? yR + (x - xR) / s : NaN, show: r.show !== false };
  }
  // Ruderlinie am Rumpfende: Verschiebung in X, damit die Linie die Rumpfoberkante am Rumpfende trifft (0 = passt schon).
  function rudShift(m, g, f) { return g.rud && f.rud.atEnd ? m.x1 - g.rud.xh(lineAt(m.L.top, m.x1)) : 0; }
  // Hinterkante des Leitwerks ohne Ruder (größtes X) für die Längsabtastung — 0,5 mm dahinter: oben endet das Leitwerk an
  // der Ruderlinie mit voller Dicke (Stirnfläche), die letzte Spalte muss leer sein, sonst bleibt das Netz dort offen.
  function rudXe(g) {
    let xe = -Infinity;
    for (let i = 0; i <= 60; i++) { const y = g.y0 + (g.yMax - g.y0) * i / 60, c = finChordAt(g, y); if (c) xe = Math.max(xe, Math.min(c[1], g.rud.xh(y))); }
    return xe + 0.5;
  }
  // Geschlossenes Polygon auf X <= X beschneiden (Projektion endet hinten gerade an der Ruderlinie), Schnittkante verdichtet.
  function clipPolyX(R, X) {
    const out = [], n = R.length;
    for (let i = 0; i < n; i++) {
      const a = R[i], b = R[(i + 1) % n], ia = a[0] <= X, ib = b[0] <= X;
      if (ia) out.push(a);
      if (ia !== ib) out.push([X, a[1] + (b[1] - a[1]) * (X - a[0]) / (b[0] - a[0])]);
    }
    // gerade Kante an X verdichten (Strahlen/Schnitte der Nasenfläche und Fußpunkte brauchen Punkte darauf)
    const o2 = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i], b = out[(i + 1) % out.length]; o2.push(a);
      if (Math.abs(a[0] - X) < 1e-9 && Math.abs(b[0] - X) < 1e-9) { const L = Math.abs(b[1] - a[1]), k = Math.ceil(L / 0.5); for (let j = 1; j < k; j++) o2.push([X, a[1] + (b[1] - a[1]) * j / k]); }
    }
    return o2;
  }
  // Anformung bei nach hinten geneigter Ruderlinie: der Teil des Spantschnitts unterhalb der Ruderebene (Höhe yC, darunter
  // liegt die Ruderlinie vor x) gehört in den Ruderbereich -> waagrecht abschneiden; der Rumpf selbst bleibt unverändert.
  function rudClip(g, x, R, P, F) {
    const rd = g.rud; if (!rd || !(rd.s > 1e-6) || !R.finFeat) return R;
    const yC = rd.yAt(x), iFoot = R.indexOf(R.finFeat[2]); if (!isFinite(yC) || iFoot < 1) return R;
    if (R[0][0] < yC) return P;   // ganzer Anbau im Ruderbereich
    let i = -1; for (let k = 0; k < iFoot; k++) if (R[k][0] >= yC && R[k + 1][0] < yC) { i = k; break; }
    if (i < 0) return R;
    const a = R[i], b = R[i + 1], t = (a[0] - yC) / (a[0] - b[0]), Cp = [yC, Math.max(0, a[1] + (b[1] - a[1]) * t), F];
    const keep = R.slice(0, i + 1), has = q => keep.indexOf(q) >= 0;
    const fA = has(R.finFeat[0]) ? R.finFeat[0] : Cp, fB = has(R.finFeat[1]) ? R.finFeat[1] : Cp;
    const S = yC < P[0][0] ? crossY(P, yC) : null;
    let out;
    if (S) {
      if (!(S.z < Cp[1] - 1e-6)) return R;
      const ca = cutAfter(P, S); out = keep.concat([Cp], ca); out.finFeat = [fA, fB, ca[0], ca[0]];
    } else { const c0 = [yC, 0, F]; out = keep.concat([Cp, c0], P); out.finFeat = [fA, fB, c0, P[0]]; }
    return out;
  }
  function finChordAt(g, y) { if (g.free) { const X = finCross(g.N, y, 1); return X.length >= 2 ? [X[0], X[X.length - 1]] : null; } const a = finLEx(g, y), b = finTEx(g, y); return b > a ? [a, b] : null; }
  function projRingFin(g, f, yAt, ch, auto) {
    const tAt = x => { const xx = clamp(x, ch[0] + 1e-6, ch[1] - 1e-6); return Math.max(0, finT(g, xx, yAt(xx))); };
    // Ruder abgetrennt: hinten keine Verlängerung, keine EL-Aufdickung/-Rundung — die Projektion endet gerade an der
    // Ruderlinie (ch[1] = Ruderlinie in Anschlusshöhe), bündig mit dem Leitwerk ohne Ruder
    const rud = !!g.rud;
    const base = filProjBase(x => (x <= ch[0] + 1e-9 ? 0 : tAt(x)), x => (x <= ch[0] + 1e-9 ? 0 : -tAt(x)), ch[0], ch[1] - ch[0], rud ? 0 : Math.max(0, +f.pTe || 0), rud ? 0 : Math.max(0, +f.pTeR || 0), 0);
    const offR = () => clipPolyX(projOffset(base, Object.assign({}, projExtF(f), { b: 0 })), ch[1]);
    const offN = () => projTail(projOffset(base, Object.assign({}, projExtF(f), { b: 0 })), ch[1], Math.max(0, +f.pB || 0), Math.max(0.3, +f.pTeR || 0));
    // Freie Projektion: nur die obere Hälfte (pHalf, mit Ruder pHalfR: offen von der Ecke an der Ruderlinie zur Nase) wird
    // bearbeitet, die untere ist gespiegelt. Fehlt die Hälfte, aus der bisherigen vollen Linie bzw. dem Offset übernehmen.
    if (!auto && f.pMode === 'free') {
      const key = rud ? 'pHalfR' : 'pHalf', toAbs = L => L.map(q => [ch[0] + (+q.dx || 0), +q.dy || 0]);
      if (!(Array.isArray(f[key]) && f[key].length >= 3)) {
        const src = rud ? (Array.isArray(f.pPtsR) && f.pPtsR.length >= 4 ? projFreeOpen(toAbs(f.pPtsR), f.pSpl, ch[1]) : offR())
          : (Array.isArray(f.pPts) && f.pPts.length >= 4 ? projFree(toAbs(f.pPts), null, f.pSpl) : offN());
        const Q = projToCtrlHalf(src, ch[0], 0, projHalfN(clamp(Math.round(+f.pN || 10), 4, 40)), rud ? ch[1] : null);
        f[key] = f.pSpl === 'bs' ? projHalfConv(Q, rud, true) : Q;
      }
      const K = toAbs(projHalfFull(projHalfSnap(f[key], rud, r2(ch[1] - ch[0])), rud));
      return { base, F2: rud ? projFreeOpen(K, f.pSpl, ch[1]) : projFree(K, null, f.pSpl), free: true };
    }
    if (rud) return { base, F2: offR() };
    return { base, F2: projTail(projOffset(base, Object.assign({}, projExtF(f), { b: 0 })), ch[1], Math.max(0, +f.pB || 0), Math.max(0.3, +f.pTeR || 0)) };
  }
  function finFil(m, g, f) {
    const warns = g.warns || (g.warns = []), ex = projExtF(f);
    let top = -Infinity;
    for (let i = 0; i <= 40; i++) { const x = g.xs + (g.xe - g.xs) * i / 40; if (x >= m.x0 && x <= m.x1) top = Math.max(top, lineAt(m.L.top, x)); }
    if (!isFinite(top)) return null;
    // Schnittlinie in der Seitenansicht: Höhe fH über dem höchsten Rumpfrücken (in der Leitwerksmitte xr), Winkel fA
    // (+ = hinten höher). Darüber bleibt das Leitwerk, darunter beginnt der Übergang zum Rumpf.
    const xr = (g.xs + g.xe) / 2, tA = Math.tan(clamp(+f.fA || 0, -45, 45) * Math.PI / 180);
    const yA = top + (+f.fH > 0 ? +f.fH : Math.max(10, 1.5 * (ex.d + ex.u))), yAt = x => yA + tA * (x - xr);
    // Leitwerk längs der Schnittlinie: erste/letzte Stelle mit Dicke (fein abgetastet, per Bisektion genau)
    const has = x => finT(g, x, yAt(x)) >= 0, N = 400, a0 = g.xs - 5, a1 = g.xe + 5;
    let i0 = -1, i1 = -1; for (let i = 0; i <= N; i++) { const x = a0 + (a1 - a0) * i / N; if (has(x)) { if (i0 < 0) i0 = i; i1 = i; } }
    if (i0 < 0) { warns.push(T('Anformung: das Seitenleitwerk reicht nicht bis zur Schnittlinie.')); return null; }
    // Grenze zwischen out (ohne Dicke) und inn (mit Dicke) per Bisektion
    const bis = (out, inn) => { for (let k = 0; k < 30; k++) { const m = (out + inn) / 2; if (has(m)) inn = m; else out = m; } return inn; };
    const xa = i0 > 0 ? bis(a0 + (a1 - a0) * (i0 - 1) / N, a0 + (a1 - a0) * i0 / N) : a0;
    const xb = i1 < N ? bis(a0 + (a1 - a0) * (i1 + 1) / N, a0 + (a1 - a0) * i1 / N) : a1;
    const ch = [xa, xb];
    if (ch[1] - ch[0] < 2 || finT(g, (ch[0] + ch[1]) / 2, yAt((ch[0] + ch[1]) / 2)) < 0) { warns.push(T('Anformung: das Seitenleitwerk reicht nicht bis zur Schnittlinie.')); return null; }
    const { base, F2 } = projRingFin(g, f, yAt, ch);
    let x0 = Infinity, x1 = -Infinity; for (const p of F2) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); }
    let wide = false;
    for (let i = 1; i < 30; i++) {
      const x = x0 + (x1 - x0) * i / 30; if (x < m.x0 || x > m.x1) { wide = true; continue; }
      const Z = finCross(F2, x, 0), zF = Z.length ? Z[Z.length - 1] : 0; let zm = 0; for (const q of bodyHalf(m, x)) zm = Math.max(zm, q[1]);
      if (zF > zm - 0.5) wide = true;
    }
    if (wide) warns.push(T('Anformung: die Projektion des Seitenleitwerks ist breiter als der Rumpf (oder ragt übers Heck) — Verlängerung seitlich verkleinern.'));
    const Fi = { yA, yAt, xr, tA, top, ch, F2, base, x0, x1, ten: clamp(+f.fTen || 0.55, 0.2, 1.5), rnd: clamp(+f.fRnd || 0, 0, 1), te: Math.max(0, finT(g, ch[1] - 1e-6, yAt(ch[1] - 1e-6))) };
    // Wie die Tragfläche (filWing), Koordinaten getauscht: quer = Z (Leitwerksdicke), Spannweite = Y (Höhe).
    // Kehlenform (Vorderansicht): eine Form für beide Seiten — das Leitwerk ist symmetrisch.
    // ohne gezeichnete Form die Viertelellipse im schrägen Rahmen (cvCtl) — nicht die einfache Bezier (filBezCtl): deren Griff
    // längs einer steilen Rumpfhaut machte die Kehle S-förmig (Wendepunkt kurz vor dem Fuß); affin bleibt die Form konvex
    { const S = coveShape(f.cv, Fi.ten, f.cvSpl); Fi.cvU = Fi.cvL = S || coveDefault(Fi.ten); }
    // Rumpfrücken fein (wie das Gitter): Höhe der Rumpfhaut bei (x, |z|), Spantschnitte auf einem 0,5-mm-Raster
    const bhC = new Map(), bh = i => {
      let P = bhC.get(i);
      if (!P) { P = bodyHalfFine(m, clamp(i * 0.5, m.x0, m.x1)); let zm = 0; for (const q of P) zm = Math.max(zm, q[1]); P.zm = zm; bhC.set(i, P); }
      return P;
    };
    // Fuß höchstens bei 92 % der Rumpfbreite wie im Spantschnitt (finFilHalf) — sonst rutscht der Fuß der Nasenfläche bei zu
    // breiter Projektion an die Seitenwand, der Spantschnitt aber nicht (Faltung am Fuß)
    const yOn = (P, z) => { const c = crossZTop(P, Math.min(Math.abs(z), 0.92 * P.zm)); return c ? c.y : P[0][0]; };
    // zwischen den Rasterschnitten Catmull-Rom (stetige Steigung) statt linear: linear knickten Fußhöhe und Hautsteigung der
    // Kurvenschar an jeder Rasterlinie (alle 0,5 mm) — feine Wellen in der Anformung, im Zebra als Fransen an der Nase
    const yBody = (x, z) => {
      const xc = clamp(x, m.x0, m.x1), i = Math.floor(xc / 0.5), f = xc / 0.5 - i, lo = Math.floor(m.x0 / 0.5), hi = Math.ceil(m.x1 / 0.5);
      const v = j => yOn(bh(clamp(j, lo, hi)), z), p1 = v(i); if (f < 1e-9) return p1;
      const p0 = v(i - 1), p2 = v(i + 1), p3 = v(i + 2);
      return 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f * f * f);
    };
    // Leitlinien (Seitenansicht X/Y): Nase = Projektionsanfang auf dem Rumpfrücken -> Nasenleiste an der Schnittlinie,
    // Endleiste = Endleiste an der Schnittlinie -> Projektionsende. Stützpunkte relativ (u längs X, v Rumpf … Schnittlinie).
    let j0 = 0, j1 = 0; for (let i = 1; i < F2.length; i++) { if (F2[i][0] < F2[j0][0]) j0 = i; if (F2[i][0] > F2[j1][0]) j1 = i; }
    const yb0 = yBody(F2[j0][0], F2[j0][1]), yb1 = yBody(F2[j1][0], F2[j1][1]), yL = yAt(ch[0]), yT = yAt(ch[1]);
    const mapPts = (L, xa, xb, ya, yb) => (L || []).map(p => [xa + clamp(+p.u || 0, 0.02, 0.98) * (xb - xa), ya + clamp(+p.v || 0, 0, 1) * (yb - ya)]).sort((a, b) => a[0] - b[0]);
    // Neigung der Leitwerksfläche an der Schnittlinie in Richtung nv (Profilnormale in X/Z): Punkt gleicher Tiefenlage 1 mm
    // höher — Pfeilung (X) und Dickenabnahme (Z). Die Nasenfläche kommt in dieser Richtung an (tangential ans Leitwerk).
    const slopeN = (P, nv) => {
      const y0 = yAt(P[0]), h = 1, c0 = finChordAt(g, y0), c1 = finChordAt(g, y0 + h); if (!c0 || !c1) return 0;
      const u = clamp((P[0] - c0[0]) / Math.max(1e-6, c0[1] - c0[0]), 0, 1), x2 = c1[0] + u * (c1[1] - c1[0]), sg = P[1] < 0 ? -1 : 1;
      const z1 = Math.max(0, finT(g, P[0], y0, true)) * sg, z2 = Math.max(0, finT(g, x2, y0 + h, true)) * sg;
      return ((x2 - P[0]) * nv[0] + (z2 - z1) * nv[1]) / h;
    };
    // Leitlinie der Nase: normierte Form wie die Hohlkehle (Fuß (0,0) waagrecht … Leitwerk (1,1) senkrecht; Kontrollpunkte,
    // B-Spline oder krümmungsstetig), in der Seitenansicht schräg abgebildet: Achse a längs des Rumpfrückens, Achse b längs
    // der Nasenleiste — genau die Scheitellinie der Nasenfläche, tangential an Rumpf und Leitwerk.
    Fi.guideN = coveShape(f.gLE, Fi.ten, f.gSpl) || coveDefault(Fi.ten);
    {
      const lam = Math.max(1e-3, ch[0] - x0), H = Math.max(1e-3, yL - yb0), hb = 0.5, b = (yBody(x0 - hb, 0) - yBody(x0 + hb, 0)) / (2 * hb);
      const dr = Math.min(-b * lam, 0.75 * H), A = filArrive(lam, H, dr, slopeN([ch[0], 0], [-1, 0])), k = dr / lam;
      const toW = (a, bb) => [ch[0] - (lam - a * A.a1 + bb * A.b1 * A.sn), yb0 + a * A.a1 * k + bb * A.b1];
      const toN = (X, Y) => { const dX = X - x0, dY = Y - yb0, Bq = (dY - dX * k) / (1 + A.sn * k), Aq = dX + Bq * A.sn; return [Aq / A.a1, Bq / A.b1]; };
      Fi.gFrame = { toW, toN };
      const pts = []; for (let i = 0; i <= 120; i++) pts.push(toW(...Fi.guideN.at(i / 120)));
      Fi.gLE = { pts, K: [] };
    }
    // mit abgetrenntem Ruder endet die Anformung hinten an der Ruderlinie: keine Endleisten-Leitlinie
    Fi.gTE = g.rud ? null : filGuide([ch[1], yT], 'down', mapPts(f.gTE, ch[1], x1, yb1, yT), [x1, yb1], 'flat');
    Fi.gRef = { le: [x0, ch[0], yb0, yL], te: [ch[1], x1, yb1, yT] }; Fi.yb1 = yb1; Fi.yT = yT;
    // Nasenfläche: Kurvenschar je Profilpunkt (Profil = Leitwerksschnitt längs der Schnittlinie), Anschluss je Punkt in der
    // Höhe der Schnittlinie
    const tAt = x => { const xx = clamp(x, ch[0] + 1e-6, ch[1] - 1e-6); return Math.max(0, finT(g, xx, yAt(xx))); };
    Fi.loft = filLoft({ xLE: ch[0], chord: ch[1] - ch[0], fp2: F2, zA: yL, gLE: Fi.gLE, cvU: Fi.cvU, cvL: Fi.cvL, guideN: Fi.guideN, cvSide: Fi.cvU || coveDefault(Fi.ten),
      slopeN, prof: x => { const t = tAt(x); return { yu: t, yl: -t }; }, anchor: x => yAt(clamp(x, ch[0], ch[1])),
      lamMax: (P, nv) => { const xc = clamp(P[0], m.x0, m.x1) / 0.5, i = Math.floor(xc), zm = bh(i).zm + (bh(i + 1).zm - bh(i).zm) * (xc - i), nz = Math.abs(nv[1]); return nz > 0.05 ? Math.max(0.01, (0.92 * zm - Math.abs(P[1])) / nz) : Infinity; } }, yBody);
    // Anteil des Kehlenbogens für die Leitwerksflanke vor der Nasenleiste (placeB): gepfeilt wächst die Flanke hinter der
    // Nasenleiste langsam aus der Kuppe, 30 % verhindern dort den Pol. Senkrecht steht sie sofort in voller Höhe da — dann
    // spannten die auf 30 % verteilten Flankenzeilen einen verdrehten Streifen zur Nasenleiste (dunkle Linie im Zebra);
    // dort laufen sie im Scheitel zusammen (Fächer = Stirn der Nasenleiste). Weich nach der Ankunftsneigung der Nasenkurve.
    { const Q = Fi.loft.row(1), q = Fi.loft.S[Fi.loft.front(Q)], w = clamp(-(q.sn || 0) / 0.35, 0, 1); Fi.pbFrac = 0.3 * w * w * (3 - 2 * w); }
    return Fi;
  }
  // Rumpfkontur: höchster Schnittpunkt mit der Senkrechten z (Rumpfrücken), mit Segmentindex für cutAfter.
  function crossZTop(P, z) {
    let best = null;
    for (let k = 0; k + 1 < P.length; k++) {
      const a = P[k], b = P[k + 1]; if (a[1] === b[1] || (z - a[1]) * (z - b[1]) > 0) continue;
      const t = (z - a[1]) / (b[1] - a[1]), y = a[0] + (b[0] - a[0]) * t;
      if (!best || y > best.y) best = { y, z, k, t };
    }
    return best;
  }
  // Schichten je Spantschnitt der Nasenfläche (Leitwerk): 30 reichten bei schmaler, hoher Kuppe nicht — wo sich die Form auf
  // kurzem Weg dreht (Grat -> senkrechte Wand), knickte der linear verbundene Schnitt an einer Schicht
  const FIN_LOFT_M = 60;
  function finFilHalf(g, x, P) {
    // genau an der Nasenleiste (± 0,05 mm) ist der Schnitt nicht bestimmt (Leitwerksflanke und Kuppe haben Höhe 0) — knapp
    // davor rechnen; das Gitter meidet diese Stelle ohnehin, Spanten/Schnitte/Exporte über sectionAt treffen sie aber
    if (Math.abs(x - g.ff.ch[0]) < 0.05) x = g.ff.ch[0] - 0.05;
    const Fi = g.ff, F = 1, al = Fi.ten, yAx = Fi.yAt(x);
    // Leitwerk oberhalb der Anschlusshöhe (Umriss von oben nach unten, wie finHalf)
    const yTop = Math.min(finTop(g, x), g.yMax, g.hl ? hlwSeat(g.hl, x) : Infinity), out = [];
    let reachA = false;
    if (yTop > yAx) {
      const N = 64, samp = finSamp(g, x, yAx, yTop, N);
      let iF = -1; for (let i = 0; i < samp.length; i++) if (samp[i][1] >= 0) { iF = i; break; }
      if (iF >= 0) {
        if (iF > 0) { let lo = samp[iF][0], hi = samp[iF - 1][0]; for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (finT(g, x, mid) >= 0) lo = mid; else hi = mid; } out.push([lo, 0, F], [lo, Math.max(0, finT(g, x, lo)), F]); }
        else out.push([samp[0][0], 0, F]);
        let brk = -1; for (let i = iF; i < samp.length; i++) { if (samp[i][1] < 0) { brk = i; break; } out.push([samp[i][0], samp[i][1], F]); }
        if (brk > 0) { let lo = samp[brk - 1][0], hi = samp[brk][0]; for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (finT(g, x, mid) >= 0) lo = mid; else hi = mid; } out.push([lo, Math.max(0, finT(g, x, lo)), F]); }
        else reachA = true;
      }
    }
    // Projektion breiter als der Rumpf (schmales Heck): Fußpunkt höchstens knapp an der breitesten Stelle
    let zm = 0; for (const q of P) zm = Math.max(zm, q[1]);
    const Z = x > Fi.x0 && x < Fi.x1 ? finCross(Fi.F2, x, 0) : [];
    let zF = Math.min(Z.length ? Z[Z.length - 1] : 0, 0.92 * zm);
    // Im Bereich der Nasenfläche (bis 92 % der Tiefe) den Fuß der Fläche selbst nehmen (Zeile t = 0 bei x): ihr Fuß ist auf
    // 92 % der Rumpfbreite begrenzt, aber auf einem 0,5-mm-Raster gerechnet — schon 0,1 mm Versatz gegen den Spantschnitt
    // ergab bei schmalem Heck eine Falte am Fuß.
    if (Fi.loft && Z.length && x < Fi.ch[0] + 0.92 * (Fi.ch[1] - Fi.ch[0])) {
      // gleiche Interpolation wie der Schnitt der Nasenfläche (filRowCross), sonst liegen beide Füße nicht exakt aufeinander
      const Q = Fi.loft.row(0), c = filRowCross(Fi.loft, Q, Fi.loft.front(Q), -1, null, x), zl = c ? c[0] : -1;
      if (zl > 0.01) zF = Math.min(zl, 0.995 * zm);
    }
    const cB = zF > 0.01 ? crossZTop(P, zF) : null;
    if (!cB || !(cB.y > (P[P.length - 1][0]))) {
      // außerhalb der Projektion: nur das Leitwerk oberhalb yA, mit dem Rumpf vereinigt
      if (!out.length) return P;
      const e = out[out.length - 1]; out.push([e[0], 0, F]);
      return unionHalf(out, P, F);
    }
    const a = P[cB.k], b = P[cB.k + 1], dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, D = [(b[0] - a[0]) / dl, (b[1] - a[1]) / dl];
    const B = [cB.y, cB.z];
    // Wie die Tragfläche (wingFil) in getauschten Koordinaten [quer Z, Spannweite Y]: Fuß, Richtung längs der Rumpfhaut
    // zum Leitwerk hin (gegen die Laufrichtung der Kontur), Übergangskurven/Nasenfläche liefern [Z, Y]
    const Bs = [cB.z, cB.y], Ds = [-D[1], -D[0]], ca = cutAfter(P, cB);
    const done = (r, A1, A2) => { r = r.concat(ca); r.finFeat = [A1, A2, ca[0], ca[0]]; return g.rud ? rudClip(g, x, r, P, F) : r; };
    // Merkpunkt Leitwerk/Kehle (tangential, also frei wählbar) mindestens bei 30 % der Bogenlänge von oben bis zum Fuß: an der
    // Nasenleiste schrumpft die Leitwerksflanke auf 0 — dort liefen sonst alle Flankenzeilen (> 100) in einem Punkt zusammen
    // (Pol: spitze, verdrehte Dreiecke, Fransen im Zebra). Hinten, wo die Flanke lang ist, bleibt er an der Schnittlinie.
    const placeB = (r, iB) => {
      if (!(iB >= 0)) return r[0];
      const cum = [0]; for (let i = 1; i < r.length; i++) cum.push(cum[i - 1] + Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]));
      const last = r[r.length - 1], sT = (Fi.pbFrac ?? 0.3) * (cum[cum.length - 1] + Math.hypot(cB.y - last[0], cB.z - last[1]));
      if (cum[iB] >= sT - 1e-9) return r[iB];
      let i = iB + 1; while (i < cum.length && cum[i] < sT) i++;
      if (i >= cum.length) return r[iB];
      const t = (sT - cum[i - 1]) / Math.max(1e-12, cum[i] - cum[i - 1]), A = r[i - 1], B = r[i], Pf = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, F];
      r.splice(i, 0, Pf); return Pf;
    };
    const nose0 = x <= (Fi.ch[0] + Fi.ch[1]) / 2;
    let res, fA, fB;
    if (reachA && out.length >= 2) {
      res = out.slice(); fA = res[1]; fB = res[res.length - 1];
      // Die Leitwerksflanke ist schräg (Dicke ändert sich mit der Höhe, Steigung ty): Scherung ty·(y − yA)·v² (v = 0 am Fuß
      // … 1 an der Schnittlinie) dreht die Ankunft in die Flanke, ohne die Tangente am Rumpf zu ändern
      const hh = 0.5, t1 = finT(g, x, yAx + hh), ty = t1 >= 0 ? (t1 - fB[1]) / hh : 0, yF = cB.y;
      const sh = (y, z) => { const v = clamp((y - yF) / Math.max(1e-6, yAx - yF), 0, 1); return z + ty * (y - yAx) * v * v; };
      const As = [fB[1], yAx], c = Fi.ch[1] - Fi.ch[0], b1 = 0.7 * c, b2 = 0.92 * c, M = FIN_LOFT_M, C = cvCtl(Fi, Bs, Ds, As, [0, 1], al);
      // Schnitt der Nasenfläche bis 70 % der Tiefe, bis 92 % weich in die Spantkurve (wie die Tragfläche)
      const Sx = Fi.loft && x < Fi.ch[0] + b2 ? filLoftSec(Fi.loft, Fi.ch[0], x, M) : null;
      let crv;   // Fuß -> Leitwerk, ohne Endpunkte
      if (Sx && Sx.up.length === M) {
        const wq = clamp((x - Fi.ch[0] - b1) / (b2 - b1), 0, 1), w = wq * wq * (3 - 2 * wq);
        // Scherung nur auf die Spantkurve: die Nasenfläche kommt selbst schon tangential an (Pfeilung + Dicke, slopeN) —
        // doppelt gerechnet gab hinter der Nasenleiste (dort ändert sich die Dicke je Höhe im Spant stark) eine Kante
        crv = Sx.up.slice(0, -1).map((q, j) => { const o = cvAt(C, (1 - Math.cos(Math.PI * (j + 1) / M)) / 2), oz = sh(o[1], o[0]); return [(1 - w) * q[0] + w * oz, (1 - w) * q[1] + w * o[1]]; });
      } else { crv = []; for (let i = 1; i < 18; i++) { const o = cvAt(C, i / 18); crv.push([sh(o[1], o[0]), o[1]]); } }
      for (let i = crv.length - 1; i >= 0; i--) { const q = crv[i]; res.push([q[1], Math.max(0, q[0]), F]); }
      return done(res, fA, placeB(res, res.indexOf(fB)));
    }
    if (!out.length && nose0 && Fi.loft) {
      // Vor der Nasenleiste: Schnitt der Nasenfläche, Scheitel knapp vor der Nasenleiste (Kuppe in der Symmetrieebene)
      const Sn = filLoftSec(Fi.loft, Fi.ch[0], Math.min(x, Fi.ch[0] - 1e-4), FIN_LOFT_M);
      if (Sn && Sn.apex && Sn.up.length > 4) {
        const L = Sn.up; res = [];   // L: Fuß -> Scheitel
        for (let j = L.length - 1; j >= 0; j--) res.push([L[j][1], j === L.length - 1 ? 0 : Math.max(0, L[j][0]), F]);
        // Merkpunkt Leitwerk/Kehle wie hinter der Nasenleiste bei 30 % der Bogenlänge (placeB) — gleiche Regel auf beiden Seiten,
        // also stetig über die Nasenleiste und ohne Pol
        const Pf = placeB(res, 0);
        return done(res, res[0], Pf === res[0] ? res[1] : Pf);
      }
    }
    if (!nose0 && Fi.gTE) {
      // Hinter der Endleiste: die Endleiste läuft mit ihrer Dicke (Stirnfläche, halbe Dicke hE) bis zur Höhe zr der
      // Leitlinie weiter. Übergangskurve wie im Profilbereich (Ziel an der Schnittlinie, Ankunft längs Y), an zr
      // abgeschnitten; das Ziel wird um dh verschoben, bis die abgeschnittene Kurve in zr genau bei hE endet.
      const zFt = Math.max(P[0][0], cB.y), sN = clamp((Fi.gTE.at(x) - Fi.yb1) / Math.max(1e-6, Fi.yT - Fi.yb1), 0, 1);
      const zr = clamp(zFt + (yAx - zFt) * sN, zFt + 1e-3, yAx), gap = 2 * cB.z, hh = Math.max(0.05, Fi.te);
      // zur Spitze der Projektion hin nicht breiter als der Fuß (weich begrenzt wie bei der Tragfläche)
      const hE = Math.pow(Math.pow(hh, -4) + Math.pow(Math.max(1e-6, 0.35 * gap), -4), -0.25), spec = 2 * hE;
      const cutAt = cp => { let lo = 0, hi = 1; for (let k = 0; k < 40; k++) { const m2 = (lo + hi) / 2; if (cvAt(cp, m2)[1] < zr) lo = m2; else hi = m2; } return (lo + hi) / 2; };
      const mk = dh => { const c2 = cvCtl(Fi, Bs, Ds, [hE + dh, yAx], [0, 1], al), tu = cutAt(c2); return { c2, tu, yu: cvAt(c2, tu)[0] }; };
      let best = mk(0);
      if (Math.abs(best.yu - hE) > 5e-5) {
        let lo = -hE - 0.5 * gap, hi = 0.5 * gap;
        for (let k = 0; k < 40; k++) { const m2 = (lo + hi) / 2; if (mk(m2).yu > hE) hi = m2; else lo = m2; }
        best = mk((lo + hi) / 2);
      }
      // Kurz vor dem Projektionsende lässt sich die Kurve nicht mehr auf die Kantendicke bringen: weich auf die direkte
      // Kurve zur Kante (hE, zr) umblenden — nach Überbreite und über 15–60 % der Verlängerung
      const over = 2 * (best.yu - hE), wq = clamp(over / Math.max(0.05, spec), 0, 1);
      const qx = clamp(((x - Fi.ch[1]) / Math.max(1e-6, Fi.x1 - Fi.ch[1]) - 0.15) / 0.45, 0, 1), wr = Math.max(wq, qx), wD = wr * wr * (3 - 2 * wr);
      const du = wD > 0 ? cvCtl(Fi, Bs, Ds, [hE, zr], [0, 1], al) : null;
      const atU = f => { const q = cvAt(best.c2, best.tu * f); if (!du) return q; const r = cvAt(du, f); return [q[0] + (r[0] - q[0]) * wD, q[1] + (r[1] - q[1]) * wD]; };
      const eU = atU(1), kU = eU[0] > hE ? hE - eU[0] : 0, atU2 = f => { const q = atU(f); return [q[0] + kU * f * f * f, q[1]]; };
      const Pt = atU2(1);
      res = [];
      if (out.length) { const e = out[out.length - 1]; res = out.slice(); if (e[1] > 0 || e[0] > Pt[1] + 1e-6) res.push([e[0], 0, F]); }
      res.push([Pt[1], 0, F]); fA = res.length > 1 && out.length >= 2 ? res[1] : res[res.length - 1];
      if (Pt[0] > 1e-4) res.push([Pt[1], Pt[0], F]);
      fB = res[res.length - 1];
      for (let k = 17; k >= 1; k--) { const q = atU2(k / 18); res.push([q[1], Math.max(0, q[0]), F]); }
      return done(res, fA, fB);
    }
    {
      // Rückfall (vor einer nach vorn gepfeilten Nasenleiste, ohne Nasenfläche): Beule, Scheitel yr in der Symmetrieebene,
      // runde Kappe (Viertelkreis Radius rho) bis zur Flankenrichtung −Y
      const nose = nose0;
      const q = clamp(nose ? (x - Fi.x0) / Math.max(1e-6, Fi.ch[0] - Fi.x0) : (Fi.x1 - x) / Math.max(1e-6, Fi.x1 - Fi.ch[1]), 0, 1);
      const yb = P[0][0];
      let yr = yAx - (yAx - yb) * Math.pow(Math.max(0, 1 - q * q), 0.75);
      yr = Math.max(yr, cB.y + 1e-3);
      // Kappe = Bogen um (yr − rho, 0) vom Scheitel bis th: th = 0 am Ende der Projektion (runder Rücken), 90° an der
      // Leitwerkskante (Viertelkreis, Anschluss längs −Y wie an der Flanke)
      const th = Math.PI / 2 * q * q * (3 - 2 * q), sn = Math.sin(th), cs = Math.cos(th);
      let rho = Fi.rnd * zF * Math.sqrt(1 - q) + (nose ? 0 : Fi.te * q);
      rho = Math.max(0, Math.min(rho, sn > 1e-6 ? 0.9 * zF / sn : Infinity, 1 - cs > 1e-6 ? 0.5 * (yr - cB.y) / (1 - cs) : Infinity));
      res = [];
      if (out.length) { const e = out[out.length - 1]; res = out.slice(); if (e[1] > 0 || e[0] > yr + 1e-6) res.push([e[0], 0, F]); }
      const apex = [yr, 0, F]; res.push(apex); fA = res.length > 1 && out.length >= 2 ? res[1] : apex;
      if (rho * sn > 1e-4) { res = res.concat(filArc([yr - rho, 0], rho, 0, th, F, 10)); res.push([yr - rho + rho * cs, rho * sn, F]); }
      fB = res[res.length - 1];
      res = res.concat(filBez([fB[0], fB[1]], [-sn, cs], B, D, al, F));
    }
    return done(res, fA, fB);
  }

  // --- Seitenleitwerk. Seitenansicht: Nasenleiste = Gerade (Winkel zur Senkrechten), die unten mit
  //     einem Radius tangential in die Rumpfoberkante einläuft; Endleiste = Gerade (Winkel);
  //     Abschluss oben = Gerade (Winkel zur Waagrechten) vom Nasenleisten-Ende bis zur Endleiste.
  function finProf(src, thk, prof) { return src === 'dat' && prof && prof.pts ? profFn(prof.pts) : profFn(nacaProf(thk)); }
  function finGeom(m, depth) {
    const f = FN(); if (!f.on) return null;
    const pr = finProf(f.srcR, f.thkR, f.profR), pt = finProf(f.srcT, f.thkT, f.profT); if (!pr || !pt) return null;
    if (f.mode === 'free') return finFreeGeom(m, f, pr, pt, depth);
    const cr = Math.max(1, +f.cr || 1), h = Math.max(1, +f.h || 1);
    const xLE = +f.xLE > 0 ? +f.xLE : m.x1 - cr;
    let y0 = +f.y0 || 0;
    if (f.y0Auto) { const xm = clamp(xLE + cr / 2, m.x0, m.x1); y0 = (lineAt(m.L.top, xm) + lineAt(m.L.bot, xm)) / 2; }
    const rad = (a, lim) => clamp(+a || 0, -lim, lim) * Math.PI / 180;
    // Einfache Fläche: Trapez aus Wurzeltiefe, Außentiefe und Pfeilung der Nasenleiste, ohne Radien/Hohlkehle/Randbogen —
    // mit dem Rumpf nur vereinigt (boolesche Operation), die Verschneidung bleibt eine scharfe Kante.
    const plain = f.mode === 'plain';
    let tL = Math.tan(rad(f.angLE, 80)), tT = Math.tan(rad(f.angTE, 80)), tP = Math.tan(rad(f.angTip, 60));
    if (plain) { tL = Math.tan(rad(f.swP, 80)); tT = tL + (Math.max(1, +f.ctP || 1) - cr) / h; tP = 0; }
    const g = { pr, pt, cr, h, xLE, y0, tL, tT, tP, plain, cosP: 1 / Math.hypot(1, tP), leR: plain || f.fil ? 0 : Math.max(0, +f.leR || 0), R: plain || f.fil ? 0 : Math.max(0, +f.R || 0), tipRound: plain ? 0 : Math.max(0, +f.tipRound || 0), fil: null };
    // Spitze: Ende der Nasenleiste bei y0 + h; Abschlussgerade bis zur Endleiste
    g.xPT = xLE + tL * h; g.yPT = y0 + h;
    const den = 1 - tP * tT;
    g.yT = Math.abs(den) > 1e-6 ? (g.yPT + tP * (xLE + cr - g.xPT - tT * y0)) / den : g.yPT;
    g.yT = clamp(g.yT, y0 + 1, y0 + 3 * h);
    g.xT = xLE + cr + tT * (g.yT - y0); g.ct = Math.hypot(g.xT - g.xPT, g.yT - g.yPT); g.yMax = Math.max(g.yPT, g.yT);
    // Übergangsradius Nasenleiste -> Rumpfoberkante (Ebene X/Y): Kreis tangential an Gerade und Oberkante
    if (g.leR > 0.05) {
      const leX = y => xLE + tL * (y - y0), gy = y => lineAt(m.L.top, clamp(leX(y), m.x0, m.x1)) - y;
      if (gy(y0) > 0 && gy(g.yPT) < 0) {
        let lo = y0, hi = g.yPT; for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (gy(mid) > 0) lo = mid; else hi = mid; }
        const yF = (lo + hi) / 2, F = [leX(yF), yF];
        if (F[0] > m.x0 + 1e-6 && F[0] < m.x1 - 1e-6) {
          const nL = Math.hypot(tL, 1), dL = [tL / nL, 1 / nL], nn = [-1 / nL, tL / nL], Lmax = Math.max(h, 4 * g.leR);
          const xa = Math.max(m.x0, F[0] - Lmax - 2 * g.leR), xb = Math.min(m.x1, F[0] + g.leR), Ptop = [];
          for (let i = 0; i <= 120; i++) { const xx = xa + (xb - xa) * i / 120; Ptop.push([xx, lineAt(m.L.top, xx)]); }
          const fl = solveFillet(Ptop, s => { const q = [F[0] + dL[0] * s * Lmax, F[1] + dL[1] * s * Lmax]; return { q, c: [q[0] + nn[0] * g.leR, q[1] + nn[1] * g.leR] }; }, g.leR);
          if (fl) g.fil = { c: fl.c, q: fl.q, T: [fl.T.y, fl.T.z], R: g.leR, F };
        }
      }
    }
    // Ruder abgetrennt; Option „Ruderlinie am Rumpfende“: Nasenleiste verschieben und neu rechnen (Fußhöhe automatisch
    // hängt von der Lage ab -> wenige Durchgänge, bis die Linie auf 0,05 mm passt)
    g.rud = rudGeom(g, f);
    const dxE = rudShift(m, g, f);
    if (Math.abs(dxE) > 0.05 && (depth || 0) < 4) { f.xLE = r1(xLE + dxE); return finGeom(m, (depth || 0) + 1); }
    let xs = Infinity, xe = -Infinity;
    for (let i = 0; i <= 40; i++) { const y = y0 + (g.yMax - y0) * i / 40; xs = Math.min(xs, finLEx(g, y)); }
    xe = g.rud ? rudXe(g) : Math.max(finTEx(g, y0), g.xT, g.xPT);
    g.xs = xs; g.xe = xe;
    g.hl = hlwGeom(g);
    // Anformung nach ErnstV für jede Umrissart (Radius/Hohlkehle der Art „mit Übergängen“ entfallen dann, s. o.)
    if (f.fil) { g.warns = g.warns || []; g.ff = finFil(m, g, f); }
    // Scharfe Gitterführung (Merkpunkte am Leitwerk): einfache Fläche, Anformung, T-Leitwerk-Auflage. Der Kreuzleitwerk-Stummel
    // bringt eigene Merkpunkte mit — das Leitwerk mit Übergängen bleibt dabei glatt abgetastet (sonst springt der Hohlkehlen-
    // Anfang als Merkpunkt von Spant zu Spant -> Streifen/Wellen im Seitenleitwerk).
    g.sharp = plain || (!!g.hl && !g.hl.cross) || !!g.ff;
    return g;
  }
  // --- Seitenleitwerk mit freiem Umriss (mode 'free', z. B. Libelle H 201): geschlossener Linienzug in der Seitenansicht,
  //     je Abschnitt (Punkt i -> i+1, der letzte schließt zum ersten) gerade oder Spline. Aufeinanderfolgende Splines bilden
  //     eine glatte Kurve; an Gerade -> Spline läuft die Kurve tangential aus der Geraden (außer am Knickpunkt k).
  //     Je Punkt ein Eckradius r. Dicke: je Höhe die waagrechte Sehne des Umrisses × Profil (Wurzel an der Rumpfoberkante ->
  //     Spitze oben), mit dem Rumpf vereinigt wie die einfache Fläche (scharfe Kante).
  function finFreeLine(f, warns) {
    const src = Array.isArray(f.fpts) ? f.fpts : [], n = src.length; if (n < 3) return null;
    const P = src.map(s => [+s.x || 0, +s.y || 0]), spl = i => src[(i + n) % n].t === 'spline';
    const unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L]; };
    // Tangentenrichtung am Punkt i (null = frei -> Sehne)
    const tanAt = i => {
      const ip = (i - 1 + n) % n, inx = (i + 1) % n; if (src[i].k) return null;
      const a = spl(ip), b = spl(i);
      if (a && b) return unit(P[ip], P[inx]);
      if (!a && b) return unit(P[ip], P[i]);
      if (a && !b) return unit(P[i], P[inx]);
      return null;
    };
    const cv = [];
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      if (!spl(i)) { cv.push([a.slice(), b.slice()]); continue; }
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ch = unit(a, b), d0 = tanAt(i) || ch, d1 = tanAt((i + 1) % n) || ch, pts = [], ns = 40;
      for (let j = 0; j <= ns; j++) {
        const t = j / ns, t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        pts.push([h00 * a[0] + h10 * L * d0[0] + h01 * b[0] + h11 * L * d1[0], h00 * a[1] + h10 * L * d0[1] + h01 * b[1] + h11 * L * d1[1]]);
      }
      pts[0] = a.slice(); pts[ns] = b.slice(); cv.push(pts);
    }
    // Eckradien: Ecke i liegt zwischen Abschnitt i-1 und i; Ecke 0 zuletzt (zwischen dem letzten und dem ersten Abschnitt)
    const fil = (A, B, i) => {
      const r = Math.max(0, +src[i].r || 0); if (!(r > 0)) return null;
      const q = A.length > 1 && B.length > 1 ? khFillet(A, B, r) : false;
      if (q === false) warns.push(T('Der Eckradius passt nicht zwischen die Linien — kleiner wählen.') + ' (' + T('Punkt') + ' ' + (i + 1) + ')');
      return q || null;
    };
    const parts = []; let A = cv[0];
    for (let i = 1; i < n; i++) {
      let B = cv[i]; const q = fil(A, B, i);
      if (q) { parts.push(q.A, q.arc); B = q.B; } else parts.push(A);
      A = B;
    }
    const q0 = fil(A, parts[0], 0);
    if (q0) { parts[0] = q0.B; parts.push(q0.A, q0.arc); } else parts.push(A);
    const N = khJoin(parts);
    if (N.length > 2 && Math.hypot(N[0][0] - N[N.length - 1][0], N[0][1] - N[N.length - 1][1]) < 1e-6) N.pop();
    return { N, Pn: P, S: cv };
  }
  // Schnittpunkte des geschlossenen Umrisses N mit der Waagrechten y (ax 1) bzw. der Senkrechten x (ax 0), aufsteigend.
  function finCross(N, v, ax) {
    const o = 1 - ax, X = [];
    for (let i = 0, n = N.length; i < n; i++) {
      const a = N[i], b = N[(i + 1) % n];
      if ((a[ax] <= v) !== (b[ax] <= v)) X.push(a[o] + (b[o] - a[o]) * (v - a[ax]) / (b[ax] - a[ax]));
    }
    return X.sort((p, q) => p - q);
  }
  function finFreeGeom(m, f, pr, pt, depth) {
    if (!Array.isArray(f.fpts) || f.fpts.length < 3) finToFree(f, m);
    const warns = [], R = finFreeLine(f, warns); if (!R || R.N.length < 3) return null;
    let xs = Infinity, xe = -Infinity, y0 = Infinity, yMax = -Infinity;
    for (const p of R.N) { xs = Math.min(xs, p[0]); xe = Math.max(xe, p[0]); y0 = Math.min(y0, p[1]); yMax = Math.max(yMax, p[1]); }
    if (!(yMax - y0 > 1) || !(xe - xs > 1)) return null;
    // Profilverlauf: Wurzelprofil an der Rumpfoberkante (Mitte des Umrisses), Spitzenprofil am höchsten Punkt
    const yB = clamp(lineAt(m.L.top, clamp((xs + xe) / 2, m.x0, m.x1)), y0, yMax - 1);
    const tMax = p => { let t = 0; for (let i = 0; i <= 200; i++) t = Math.max(t, p.t(i / 200)); return t; };
    const g = { pr, pt, free: true, plain: true, N: R.N, Pn: R.Pn, S: R.S, warns, y0, yMax, yB, h: Math.max(1, yMax - yB), xs, xe,
      xLE: xs, cr: xe - xs, tL: 0, tT: 0, tP: 0, cosP: 1, leR: 0, R: 0, tipRound: 0, fil: null,
      cap: +f.fThkMax > 0 ? +f.fThkMax / 2 : 0, tmR: tMax(pr), tmT: tMax(pt) };
    // Spitze (für die Lage des Höhenleitwerks): Sehne knapp unter dem höchsten Punkt
    const X = finCross(R.N, yMax - Math.min(2, 0.01 * (yMax - y0)), 1);
    g.xPT = X.length ? X[0] : xs; g.xT = X.length ? X[X.length - 1] : xe; g.yPT = g.yT = yMax; g.ct = g.xT - g.xPT;
    // Ruder abgetrennt; „Ruderlinie am Rumpfende“: alle Umrisspunkte verschieben und neu rechnen
    g.rud = rudGeom(g, f);
    const dxE = rudShift(m, g, f);
    if (Math.abs(dxE) > 0.05 && (depth || 0) < 4) { for (const p of f.fpts) p.x = r1((+p.x || 0) + dxE); return finFreeGeom(m, f, pr, pt, (depth || 0) + 1); }
    if (g.rud) g.xe = rudXe(g);
    g.hl = hlwGeom(g); g.sharp = true;
    if (f.fil) g.ff = finFil(m, g, f);
    return g;
  }
  // Halbe Dicke des freien Umrisses bei (x, y): waagrechte Sehne um x, Profil darüber; -1 = außerhalb.
  function finFreeT(g, x, y) {
    if (y < g.y0 || y > g.yMax) return -1;
    const X = finCross(g.N, y, 1);
    for (let k = 0; k + 1 < X.length; k += 2) {
      if (x < X[k] || x > X[k + 1]) continue;
      const c = X[k + 1] - X[k]; if (!(c > 1e-6)) return -1;
      const s = clamp((y - g.yB) / g.h, 0, 1), u = (x - X[k]) / c;
      let t = c * ((1 - s) * g.pr.t(u) + s * g.pt.t(u));
      if (g.cap > 0) { const tm = c * ((1 - s) * g.tmR + s * g.tmT); if (tm > g.cap) t *= g.cap / tm; }
      return t;
    }
    return -1;
  }
  // Freien Umriss aus dem Trapez der anderen Arten anlegen: vier Punkte (Fuß vorne, Spitze vorne/hinten, Fuß hinten), gerade.
  function finToFree(f, m) {
    const plain = f.mode === 'plain';
    const cr = Math.max(1, +f.cr || 1), h = Math.max(1, +f.h || 1), xLE = +f.xLE > 0 ? +f.xLE : m.x1 - cr, rad = (a, l) => clamp(+a || 0, -l, l) * Math.PI / 180;
    let y0 = +f.y0 || 0;
    if (f.y0Auto) { const xm = clamp(xLE + cr / 2, m.x0, m.x1); y0 = (lineAt(m.L.top, xm) + lineAt(m.L.bot, xm)) / 2; }
    let xPT, xT, yT;
    if (plain) { xPT = xLE + Math.tan(rad(f.swP, 80)) * h; xT = xPT + Math.max(1, +f.ctP || 1); yT = y0 + h; }
    else {
      const tL = Math.tan(rad(f.angLE, 80)), tT = Math.tan(rad(f.angTE, 80)), tP = Math.tan(rad(f.angTip, 60)), den = 1 - tP * tT, yPT = y0 + h;
      xPT = xLE + tL * h;
      yT = Math.abs(den) > 1e-6 ? (yPT + tP * (xLE + cr - xPT - tT * y0)) / den : yPT; yT = clamp(yT, y0 + 1, y0 + 3 * h); xT = xLE + cr + tT * (yT - y0);
    }
    const pnt = (x, y) => ({ x: r1(x), y: r1(y), t: 'line', r: 0, k: false });
    f.fpts = [pnt(xLE, y0), pnt(xPT, y0 + h), pnt(xT, yT), pnt(xLE + cr, y0)];
  }
  // --- Höhenleitwerk auf dem Seitenleitwerk (T-Leitwerk): das Seitenleitwerk wird oben in Form der Profilunterseite
  //     ausgeschnitten (boolesche Differenz, nach oben offen) — die Fläche liegt passgenau in der Auflage.
  function HL() { const h = C('rproHlw'), d = DEF.rproHlw; for (const k in d) if (h[k] === undefined) h[k] = d[k]; return h; }
  // Tragfläche aus dem Projekt als Höhenleitwerk: Stationen (absolute Rippen in mm, z längs der Spannweite ab der Wurzel)
  // der Tragfläche mit der id. Die aktive liegt in App.wing; eine andere wird per App.withWing gerechnet und
  // zwischengespeichert, bis sich ihre Daten ändern.
  const hlWingCache = { key: null, st: null };
  function hlWingStations(id) {
    const L = App.wingList ? App.wingList() : [], i = L.findIndex(w => w.id === id); if (i < 0) return null;
    const pick = () => { const W = App.wing; return W && W.stations && W.stations.length >= 2 ? W.stations.map(s => ({ z: +s.z || 0, yRise: +s.yRise || 0, pts: s.pts.map(p => ({ x: p.x, y: p.y })) })) : null; };
    if (i === state.activeWing) return pick();
    const w = L[i], key = id + '|' + JSON.stringify([w.root, w.segments, w.cfg]);
    if (hlWingCache.key !== key) { let st = null; try { st = App.withWing ? App.withWing(i, pick) : null; } catch (e) { console.warn('Rumpf: Höhenleitwerk aus Tragfläche', e); } hlWingCache.key = key; hlWingCache.st = st; }
    return hlWingCache.st;
  }
  // Grundriss der Tragfläche: je Station Nasenleiste, Tiefe, Profil-Nasenhöhe; dazu die Wurzelrippe normiert als Profil.
  function hlWingPlan(id) {
    const st = hlWingStations(id); if (!st) return null;
    const flip = state.cfg && state.cfg.flipY ? -1 : 1, z0 = st[0].z;
    const sec = st.map(s => {
      let iL = 0, iT = 0; s.pts.forEach((p, k) => { if (p.x < s.pts[iL].x) iL = k; if (p.x > s.pts[iT].x) iT = k; });
      return { z: s.z - z0, le: s.pts[iL].x, c: Math.max(1, s.pts[iT].x - s.pts[iL].x), yN: (s.pts[iL].y + s.yRise) * flip, pts: s.pts, yRise: s.yRise };
    });
    const r = sec[0];
    const pf = profFn(r.pts.map(p => ({ x: (p.x - r.le) / r.c, y: (p.y + r.yRise) * flip / r.c - r.yN / r.c }))); if (!pf) return null;
    return { sec, pf, flip };
  }
  // Grundriss des Höhenleitwerks: Nasenleiste/Tiefe bei z (Abstand von der Rumpfmitte), stückweise linear über hl.pl,
  // innen (Stummel bis zur Rumpfmitte) mit der Neigung des ersten Abschnitts verlängert — der Stummel übernimmt die Pfeilung.
  function hlPlan(hl, z) {
    const pl = hl.pl; let k = 0; while (k < pl.length - 2 && z > pl[k + 1].z) k++;
    const a = pl[k], b = pl[k + 1], t = (z - a.z) / ((b.z - a.z) || 1);
    const le = a.le + (b.le - a.le) * t, c = Math.max(1e-3, a.c + (b.c - a.c) * t);
    // w = genutzte Tiefe: mit abgetrenntem Seitenruder endet der Stummel an der Ruderlinie (xCut, ebene Stirnfläche)
    return { le, c, w: Math.max(1e-3, Math.min(c, (hl.xCut != null ? hl.xCut : Infinity) - le)) };
  }
  function hlwGeom(g) {
    const h = HL(); if (!h.on) return null;
    const wp = h.wingId ? hlWingPlan(h.wingId) : null;
    const pf = wp ? wp.pf : h.src === 'dat' ? (h.prof && h.prof.pts ? profFn(h.prof.pts) : null) : profFn(nacaProf(h.thk)); if (!pf) return null;
    const cr = wp ? wp.sec[0].c : Math.max(1, +h.cr || 1), cross = h.mode === 'cross';
    // Kreuzleitwerk: Höhe automatisch in halber Leitwerkshöhe, Lage X mittig auf der Leitwerkstiefe in dieser Höhe
    const y = h.yAuto ? (cross ? (g.y0 + g.yMax) / 2 : Math.min(g.yPT, g.yT)) : +h.y || 0;
    let xLE = +h.x || 0;
    if (h.xAuto) { if (cross) { const ch = finChordAt(g, y); xLE = ch ? (ch[0] + ch[1]) / 2 - cr / 2 : (g.xPT + g.xT) / 2 - cr / 2; } else xLE = (g.xPT + g.xT) / 2 - cr / 2; }
    const wName = wp && App.wingName ? App.wingName(App.wingList().findIndex(w => w.id === h.wingId)) : '';
    const hl = { pf, cr, ct: wp ? wp.sec[wp.sec.length - 1].c : Math.max(1, +h.ct || cr), b: wp ? 2 * wp.sec[wp.sec.length - 1].z : Math.max(10, +h.b || 10), xLE, y, cross,
      tanA: Math.tan((+h.alpha || 0) * Math.PI / 180), tS: Math.tan(clamp(+h.sweep || 0, -70, 70) * Math.PI / 180), play: Math.max(0, +h.play || 0), show: h.show !== false,
      name: wp ? wName : h.src === 'dat' ? h.prof && h.prof.name : 'NACA 00' + String(h.thk).padStart(2, '0'), wp };
    hl.zS = 0;
    // Seitenruder abgetrennt: der Kreuzleitwerk-Stummel endet an der Ruderlinie (dahinter wäre er Teil der Ruder) — an der
    // vordersten Stelle der Linie im Höhenbereich des Stummels, damit er nirgends hinter die Stirnfläche des Leitwerks ragt
    hl.xCut = cross && g.rud ? Math.min(g.rud.xh(y - 0.2 * cr), g.rud.xh(y + 0.2 * cr)) : null;
    if (cross) {
      // Stummel-Rippenebene: fest oder automatisch = dickste Stelle des Seitenleitwerks im Stummelbereich + 15 mm
      let zS = +h.zS;
      if (!(zS > 0)) { let tm = 0; for (let i = 0; i <= 30; i++) { const x = xLE + cr * i / 30, w = hlYs(hl, x); for (const yy of [w.yu, w.yl, (w.yu + w.yl) / 2]) tm = Math.max(tm, finT(g, x, yy)); } zS = tm + 15; }
      hl.zS = wp ? zS : Math.min(zS, hl.b / 2);
    }
    // Grundriss ab der Wurzelrippe (Kreuzleitwerk: Stirnfläche des Stummels bei zS, T-Leitwerk: Rumpfmitte). Eine Tragfläche
    // aus dem Projekt beginnt mit ihrer Wurzelrippe dort; ihre Spannweite zählt ab der Wurzelrippe.
    if (wp) { const r = wp.sec[0]; hl.pl = wp.sec.map(s => ({ z: hl.zS + s.z, le: xLE + s.le - r.le, c: s.c })); hl.b = 2 * hl.pl[hl.pl.length - 1].z; }
    else hl.pl = [{ z: hl.zS, le: xLE, c: cr }, { z: Math.max(hl.zS + 1, hl.b / 2), le: xLE + hl.tS * Math.max(1, hl.b / 2 - hl.zS), c: hl.ct }];
    // X-Bereich des Stummels (Rumpfmitte bis Stirnfläche) für die Spaltenwahl
    const p0 = hlPlan(hl, 0), pS = hlPlan(hl, hl.zS);
    hl.xa = Math.min(p0.le, pS.le); hl.xb = Math.max(p0.le + p0.w, pS.le + pS.w);
    return hl;
  }
  // Ober-/Unterkante der Höhenleitwerks-Wurzelrippe bei x (mit Einstellwinkel um die Nase gekippt).
  function hlYs(hl, x) { const dx = clamp(x - hl.xLE, 0, hl.cr), u = dx / hl.cr; return { yu: hl.y + hl.cr * hl.pf.up(u) - dx * hl.tanA, yl: hl.y + hl.cr * hl.pf.lo(u) - dx * hl.tanA }; }
  // Kreuzleitwerk: Höhenleitwerks-Stummel (Wurzelprofil gerade in Z bis zur Rippenebene zS, ebene Stirnfläche) mit dem
  // Seitenleitwerk vereinigt — wie der Tragflächenstummel. Merkpunkte hlFeat [Eintritt oben, Ecke oben, Ecke unten,
  // Austritt unten]; ohne Stummel im Schnitt alle im Flankenpunkt auf Höhe hl.y.
  // Der Stummel folgt dem Grundriss des Höhenleitwerks (hlPlan, Pfeilung/Zuspitzung nach innen verlängert): im Schnitt bei x
  // reicht er über den z-Bereich, in dem x innerhalb der Profiltiefe liegt; Ober-/Unterkante je z aus dem Wurzelprofil.
  function hlSecY(hl, x, z) { const p = hlPlan(hl, z), dx = clamp(x - p.le, 0, p.c), u = dx / p.c; return { yu: hl.y + p.c * hl.pf.up(u) - dx * hl.tanA, yl: hl.y + p.c * hl.pf.lo(u) - dx * hl.tanA }; }
  function hlStubHalf(hl, x, P) {
    if (!P || P.length < 2) return P;
    const none = () => { let k = P.findIndex(q => q[0] <= hl.y); if (k < 0) k = P.length - 1; P.hlFeat = [P[k], P[k], P[k], P[k]]; return P; };
    if (x <= hl.xa || x >= hl.xb) return none();
    // z-Bereich [za, zb] innerhalb der Profiltiefe (Grundriss im Stummel linear -> ein Intervall), Ränder per Bisektion
    const inn = z => { const p = hlPlan(hl, z); return x > p.le && x < p.le + p.w; }, N = 32, zS = hl.zS;
    const bis = (a, b) => { const ia = inn(a); for (let k = 0; k < 30; k++) { const m = (a + b) / 2; if (inn(m) === ia) a = m; else b = m; } return ia ? a : b; };
    let za = -1, zb = -1;
    for (let i = 0; i <= N; i++) {
      const z = zS * i / N, ok = inn(z);
      if (ok && za < 0) za = i ? bis(zS * (i - 1) / N, z) : 0;
      if (ok) zb = z; else if (zb >= 0) { zb = bis(zS * (i - 1) / N, z); break; }
    }
    if (za < 0 || !(zb - za > 1e-3)) return none();
    const zl = [za]; for (let i = 1; i < N; i++) { const z = zS * i / N; if (z > za + 1e-3 && z < zb - 1e-3) zl.push(z); } zl.push(zb);
    const S = zl.map(z => hlSecY(hl, x, z));
    if (!S.some(w => w.yu - w.yl > 1e-4)) return none();
    const T = zl.map((z, i) => [S[i].yu, z, 1]), Bt = zl.map((z, i) => [S[i].yl, z, 1]).reverse();
    // Reicht der Stummel hier nicht bis zur Rumpfmitte (gepfeilte Nase/Endleiste), schließt eine Naht in der Kante (Dicke 0) an z = 0 an
    const A = (za > 1e-6 ? [[T[0][0], 0, 1]] : []).concat(T, Bt, za > 1e-6 ? [[Bt[Bt.length - 1][0], 0, 1]] : []);
    const cT = T[T.length - 1], cB = Bt[0];
    const U = unionHalf(A, P, 1);
    if (U.indexOf(cT) < 0 || U.indexOf(cB) < 0) return none();   // Stummel steckt ganz im Leitwerk
    const tf = U.cross.toFin.filter(q => U.indexOf(q) < U.indexOf(cT)), tb = U.cross.toBody.filter(q => U.indexOf(q) > U.indexOf(cB));
    U.hlFeat = [tf.length ? tf[tf.length - 1] : cT, cT, cB, tb.length ? tb[0] : cB];
    return U;
  }
  // Höhe der Auflage bei x (Profilunterseite der Wurzelrippe − Spiel); außerhalb der Flächentiefe unbegrenzt.
  function hlwSeat(hl, x) {
    if (hl.cross) return Infinity;   // Kreuzleitwerk: keine Auflage, der Stummel wird angesetzt
    const sp = hl.play, xT = hl.xLE + hl.cr;
    if (x <= hl.xLE - sp || x >= xT + sp) return Infinity;
    let e = sp; if (x < hl.xLE) e = Math.sqrt(Math.max(0, sp * sp - (hl.xLE - x) * (hl.xLE - x))); else if (x > xT) e = Math.sqrt(Math.max(0, sp * sp - (x - xT) * (x - xT)));
    const dx = clamp(x - hl.xLE, 0, hl.cr);
    return hl.y + hl.cr * hl.pf.lo(dx / hl.cr) - dx * hl.tanA - e;
  }
  // Kreuzleitwerk-Stummel per boolescher Vereinigung mit dem fertigen Netz (Rumpf + Seitenleitwerk bleiben unverändert):
  //  1. Dreiecke des Netzes gegen den Stummel-Körper klassifizieren (innen: |z| ≤ zS, Nase < x < Endleiste, Unter- < y <
  //     Oberseite); innen liegende fallen weg, geschnittene werden an der Stummelfläche geteilt (Kantenpunkte per Bisektion,
  //     je Kante einmal -> Nachbardreiecke teilen sie).
  //  2. Die Schnittpunkte bilden die Verschneidungslinie auf dem Leitwerk. Die Stummelfläche ist eine Regelfläche (je
  //     Profilparameter s eine Gerade in z): sie wird zwischen dieser Linie und der Wurzelrippe bei zS aufgespannt (nach s
  //     sortiert, Reißverschluss) — mit genau denselben Punkten, das Netz bleibt geschlossen. Profillinien, die das
  //     Leitwerk nicht treffen (Stummel vor der Nasenleiste), laufen bis z = 0 und treffen dort ihr Spiegelbild.
  //  s: 0 = Endleiste oben … 1 = Nase … 2 = Endleiste unten, 2…3 = stumpfe Endleiste von unten nach oben.
  function stubUnion(mesh, m) {
    const hl = m.fin.hl, g = m.fin, zS = hl.zS;
    if (!(zS > 0)) return mesh;
    const dIn = (x, y, z) => {
      const az = Math.abs(z); if (az >= zS) return az - zS;
      const p = hlPlan(hl, az), a = p.le - x, b = x - p.le - p.w; if (a >= 0 || b >= 0) return Math.max(a, b);
      const w = hlSecY(hl, x, az); return Math.max(w.yl - y, y - w.yu, a, b, az - zS);
    };
    const pos = Array.from(mesh.pos), nrm = Array.from(mesh.nrm), tag = Array.from(mesh.tag), kv = Array.from(mesh.kv), cv = Array.from(mesh.cv);
    // Klassifizieren nur in der Nähe des Stummels (Begrenzungsquader + 1 mm)
    const nv0 = pos.length / 3, din = new Float64Array(nv0), xa = hl.xa - 1, xb = hl.xb + 1;
    let ylo = Infinity, yhi = -Infinity;
    for (let k = 0; k <= 40; k++) { const z = zS * k / 40, p = hlPlan(hl, z); for (let i = 0; i <= 40; i++) { const w = hlSecY(hl, p.le + p.w * i / 40, z); ylo = Math.min(ylo, w.yl); yhi = Math.max(yhi, w.yu); } }
    const near = i => pos[3 * i] > xa && pos[3 * i] < xb && Math.abs(pos[3 * i + 2]) < zS + 1 && pos[3 * i + 1] > ylo - 1 && pos[3 * i + 1] < yhi + 1;
    // Kante/Dreieck berührt den Begrenzungsquader (auch wenn keine Ecke darin liegt — lange Kanten quer durch den Stummel)
    const boxHit = vs => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity;
      for (const i of vs) { const x = pos[3 * i], y = pos[3 * i + 1], z = Math.abs(pos[3 * i + 2]); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); }
      return x1 > xa && x0 < xb && y1 > ylo - 1 && y0 < yhi + 1 && z0 < zS + 1;
    };
    for (let i = 0; i < nv0; i++) din[i] = near(i) ? dIn(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]) : 1;
    // Kanten: alle Durchstoßpunkte (auch zwei, wenn das dünne Stummelende zwischen den Ecken durchläuft), je Kante einmal
    const edges = new Map(), cut = [];
    const at = (a, b, t) => [pos[3 * a] + (pos[3 * b] - pos[3 * a]) * t, pos[3 * a + 1] + (pos[3 * b + 1] - pos[3 * a + 1]) * t, pos[3 * a + 2] + (pos[3 * b + 2] - pos[3 * a + 2]) * t];
    const dAt = (a, b, t) => { const q = at(a, b, t); return dIn(q[0], q[1], q[2]); };
    const addV = (a, b, t) => {
      const q = at(a, b, t), id = pos.length / 3; pos.push(q[0], q[1], q[2]);
      const nx = nrm[3 * a] * (1 - t) + nrm[3 * b] * t, ny = nrm[3 * a + 1] * (1 - t) + nrm[3 * b + 1] * t, nz = nrm[3 * a + 2] * (1 - t) + nrm[3 * b + 2] * t, L = Math.hypot(nx, ny, nz) || 1;
      const o = t < 0.5 ? a : b; nrm.push(nx / L, ny / L, nz / L); tag.push(tag[o]); kv.push(kv[o]); cv.push(cv[o]); cut.push(id); return id;
    };
    // Liste [{t, id}] in Richtung a -> b
    const edgeX = (a, b) => {
      const lo = Math.min(a, b), hi = Math.max(a, b), key = lo * nv0 + hi; let L = edges.get(key);
      if (!L) {
        L = [];
        if (boxHit([lo, hi])) {
          // Abtastung ≈ 0,02 mm: auch die spitz zulaufende Ecke an der Endleiste wird getroffen
          const len = Math.hypot(pos[3 * hi] - pos[3 * lo], pos[3 * hi + 1] - pos[3 * lo + 1], pos[3 * hi + 2] - pos[3 * lo + 2]), NS = clamp(Math.ceil(len / 0.02), 12, 600);
          let tp = 0, ip = dAt(lo, hi, 0) < 0;
          for (let k = 1; k <= NS; k++) {
            const t = k / NS, ic = dAt(lo, hi, t) < 0;
            if (ic !== ip) { let u0 = tp, u1 = t; for (let j = 0; j < 40; j++) { const u = (u0 + u1) / 2; if ((dAt(lo, hi, u) < 0) === ip) u0 = u; else u1 = u; } const u = ip ? u1 : u0; L.push({ t: u, id: addV(lo, hi, u) }); }
            tp = t; ip = ic;
          }
        }
        edges.set(key, L);
      }
      return a === lo ? L : L.map(q => ({ t: 1 - q.t, id: q.id })).reverse();
    };
    const idx = [], I = mesh.idx, ins = i => din[i] < 0;
    for (let i = 0; i < I.length; i += 3) {
      const t = [I[i], I[i + 1], I[i + 2]];
      if (!boxHit(t)) { idx.push(t[0], t[1], t[2]); continue; }
      // Rand ablaufen: Ecken und Durchstoßpunkte; außen liegende Bögen (Austritt -> nächster Eintritt) bleiben, die Sehne
      // zwischen den beiden Durchstoßpunkten schließt sie (Dreieck konvex -> Teilstück konvex, Fächer genügt)
      const seq = [];
      for (let e = 0; e < 3; e++) { const a = t[e], b = t[(e + 1) % 3]; seq.push({ v: a, out: !ins(a) }); for (const q of edgeX(a, b)) seq.push({ v: q.id, x: true }); }
      const nX = seq.filter(q => q.x).length;
      if (!nX) { if (!ins(t[0]) && !ins(t[1]) && !ins(t[2])) idx.push(t[0], t[1], t[2]); continue; }
      // Zustand vor jedem Durchstoßpunkt: außen/innen wechselt an jedem Punkt; Startzustand = erste Ecke
      let st = seq[0].out; for (const q of seq) { if (q.x) { q.exit = !st; st = !st; } }
      const n = seq.length;
      for (let k = 0; k < n; k++) {
        if (!seq[k].x || !seq[k].exit) continue;
        const poly = [seq[k].v];
        for (let j = 1; j < n; j++) { const q = seq[(k + j) % n]; poly.push(q.v); if (q.x) break; }
        if (poly.length === 3) { idx.push(poly[0], poly[1], poly[2]); continue; }
        // Fächer um den Schwerpunkt (liegt in der Dreiecksebene): die Durchstoßpunkte liegen auf den Dreieckskanten — ein
        // Fächer von einer Ecke gäbe Dreiecke der Fläche 0, die wegfallen und Lücken (T-Stöße) hinterlassen
        const c = pos.length / 3, w = 1 / poly.length; let nx = 0, ny = 0, nz = 0;
        pos.push(0, 0, 0); for (const q of poly) { pos[3 * c] += pos[3 * q] * w; pos[3 * c + 1] += pos[3 * q + 1] * w; pos[3 * c + 2] += pos[3 * q + 2] * w; nx += nrm[3 * q]; ny += nrm[3 * q + 1]; nz += nrm[3 * q + 2]; }
        const L = Math.hypot(nx, ny, nz) || 1; nrm.push(nx / L, ny / L, nz / L); tag.push(tag[poly[0]]); kv.push(kv[poly[0]]); cv.push(cv[poly[0]]);
        for (let j = 0; j < poly.length; j++) idx.push(c, poly[j], poly[(j + 1) % poly.length]);
      }
    }
    const lines = []; for (let i = 0; i < mesh.lines.length; i += 2) { const a = mesh.lines[i], b = mesh.lines[i + 1]; if (!ins(a) && !ins(b)) lines.push(a, b); }
    // Stummelfläche: Punkt (s, z), Profilparameter s eines Punkts auf der Fläche
    const teThk = z => { const p = hlPlan(hl, z), w = hlSecY(hl, p.le + p.w, z); return w.yu - w.yl; };
    const thick = teThk(zS) > 0.05;
    const stubPt = (s, z) => {
      const p = hlPlan(hl, z);
      if (s >= 2) { const x = p.le + p.w, w = hlSecY(hl, x, z); return [x, w.yl + (w.yu - w.yl) * (s - 2), z]; }
      const u = s <= 1 ? 1 - s : s - 1, x = p.le + u * p.w, w = hlSecY(hl, x, z); return [x, s <= 1 ? w.yu : w.yl, z];
    };
    const sOf = (x, y, z) => {
      const p = hlPlan(hl, z), u = clamp((x - p.le) / p.w, 0, 1), w = hlSecY(hl, x, z), du = Math.abs(y - w.yu), dl = Math.abs(y - w.yl);
      if (thick && Math.abs(p.le + p.w - x) < Math.min(du, dl)) { const wt = hlSecY(hl, p.le + p.w, z); return 2 + clamp((y - wt.yl) / Math.max(1e-9, wt.yu - wt.yl), 0, 1); }
      return du <= dl ? 1 - u : 1 + u;
    };
    // Ring der Wurzelrippe (Kosinus-Teilung, Nase/Endleiste dicht) und Trefferprobe je Profillinie
    const nU = 64, Ss = [];
    for (let k = 0; k <= nU; k++) Ss.push(1 - (1 + Math.cos(Math.PI * k / nU)) / 2 * 1);   // 0 … 1 (oben, Endleiste -> Nase)
    for (let k = 1; k <= nU; k++) Ss.push(1 + (1 - Math.cos(Math.PI * k / nU)) / 2);       // 1 … 2 (unten, Nase -> Endleiste)
    if (thick) Ss.push(2.5);
    // Trifft die Profillinie s (z = 0 … zS) das Netz (Leitwerk)? Gegen die Original-Dreiecke der +z-Seite im Quader —
    // dieselbe Facettierung wie die Verschneidungslinie (die glatte Beschreibung weicht an der Nase leicht ab)
    const TS = []; for (let i = 0; i < I.length; i += 3) { const t = [I[i], I[i + 1], I[i + 2]]; if (t.some(q => pos[3 * q + 2] > 1e-9) && boxHit(t)) TS.push(t); }
    const segTri = (A, Bq, t) => {
      const P0 = [pos[3 * t[0]], pos[3 * t[0] + 1], pos[3 * t[0] + 2]], e1 = [pos[3 * t[1]] - P0[0], pos[3 * t[1] + 1] - P0[1], pos[3 * t[1] + 2] - P0[2]], e2 = [pos[3 * t[2]] - P0[0], pos[3 * t[2] + 1] - P0[1], pos[3 * t[2] + 2] - P0[2]];
      const d = [Bq[0] - A[0], Bq[1] - A[1], Bq[2] - A[2]], h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], a = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
      if (Math.abs(a) < 1e-14) return false;
      const f = 1 / a, sv = [A[0] - P0[0], A[1] - P0[1], A[2] - P0[2]], u = f * (sv[0] * h[0] + sv[1] * h[1] + sv[2] * h[2]); if (u < 0 || u > 1) return false;
      const q = [sv[1] * e1[2] - sv[2] * e1[1], sv[2] * e1[0] - sv[0] * e1[2], sv[0] * e1[1] - sv[1] * e1[0]], v = f * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]); if (v < 0 || u + v > 1) return false;
      const tt = f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]); return tt >= 0 && tt <= 1;
    };
    const hits = s => { const A = stubPt(s, 0), Bq = stubPt(s, zS); return TS.some(t => segTri(A, Bq, t)); };
    const B = [];
    for (const id of cut) { const x = pos[3 * id], y = pos[3 * id + 1], z = pos[3 * id + 2]; if (z >= 0) B.push({ s: sOf(x, y, z), p: [x, y, z] }); }
    for (const s of Ss) if (!hits(s)) B.push({ s, p: stubPt(s, 0) });
    B.sort((a, b) => a.s - b.s);
    const R = Ss.map(s => ({ s, p: stubPt(s, zS) }));
    // Reißverschluss B (unten) / R (Wurzelrippe), beide zyklisch über s ∈ [0, 3)
    const SP = [], tri = [], nB = B.length, nR = R.length;
    if (!nB) return mesh;
    const bI = k => k % nB, rI = k => nB + k % nR;
    for (const q of B) SP.push(q.p); for (const q of R) SP.push(q.p);
    const sB = k => B[k % nB].s + 3 * Math.floor(k / nB), sR = k => R[k % nR].s + 3 * Math.floor(k / nR);
    let bi = 0, rj = 0;
    while (bi < nB || rj < nR) {
      const advB = rj >= nR ? true : bi >= nB ? false : sB(bi + 1) <= sR(rj + 1);
      if (advB) { tri.push(bI(bi), bI(bi + 1), rI(rj)); bi++; } else { tri.push(bI(bi), rI(rj + 1), rI(rj)); rj++; }
    }
    // Drehsinn: auf der Oberseite (0 < s < 1) zeigt die Normale nach +y
    const fn = (a, b, c) => { const A = SP[a], Bq = SP[b], Cq = SP[c], e1 = [Bq[0] - A[0], Bq[1] - A[1], Bq[2] - A[2]], e2 = [Cq[0] - A[0], Cq[1] - A[1], Cq[2] - A[2]]; return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; };
    let sy = 0; for (let i = 0; i < tri.length; i += 3) { const a = tri[i]; const s = a < nB ? B[a].s : R[a - nB].s; if (s > 0.2 && s < 0.8) sy += fn(tri[i], tri[i + 1], tri[i + 2])[1]; }
    if (sy < 0) for (let i = 0; i < tri.length; i += 3) { const t = tri[i + 1]; tri[i + 1] = tri[i + 2]; tri[i + 2] = t; }
    // Glatte Normalen der Stummelfläche (eigene Punkte: scharfe Kante zum Leitwerk und zur Stirnfläche)
    const SN = SP.map(() => [0, 0, 0]);
    for (let i = 0; i < tri.length; i += 3) { const n = fn(tri[i], tri[i + 1], tri[i + 2]); for (let k = 0; k < 3; k++) { const q = SN[tri[i + k]]; q[0] += n[0]; q[1] += n[1]; q[2] += n[2]; } }
    const TAG = 1;
    for (const sg of [1, -1]) {
      const base = pos.length / 3;
      SP.forEach((p, i) => { const n = SN[i], L = Math.hypot(n[0], n[1], n[2]) || 1; pos.push(p[0], p[1], sg * p[2]); nrm.push(n[0] / L, n[1] / L, sg * n[2] / L); tag.push(TAG); kv.push(0); cv.push(-1); });
      for (let i = 0; i < tri.length; i += 3) { if (sg > 0) idx.push(base + tri[i], base + tri[i + 1], base + tri[i + 2]); else idx.push(base + tri[i], base + tri[i + 2], base + tri[i + 1]); }
      for (let k = 0; k < nR; k++) lines.push(base + nB + k, base + nB + (k + 1) % nR);
      for (let k = 0; k < nB; k++) lines.push(base + k, base + (k + 1) % nB);
      // Stirnfläche (Stoß zum Höhenleitwerk): Fächer um den Mittelpunkt, Normale ±z
      const cb = pos.length / 3, c = [0, 0, 0]; for (const q of R) { c[0] += q.p[0] / nR; c[1] += q.p[1] / nR; }
      pos.push(c[0], c[1], sg * zS); nrm.push(0, 0, sg); tag.push(TAG); kv.push(0); cv.push(-1);
      for (const q of R) { pos.push(q.p[0], q.p[1], sg * zS); nrm.push(0, 0, sg); tag.push(TAG); kv.push(0); cv.push(-1); }
      for (let k = 0; k < nR; k++) {
        const a = cb + 1 + k, b = cb + 1 + (k + 1) % nR, A = R[k].p, Bq = R[(k + 1) % nR].p, nz = (A[0] - c[0]) * (Bq[1] - c[1]) - (A[1] - c[1]) * (Bq[0] - c[0]);
        if ((nz > 0) === (sg > 0)) idx.push(cb, a, b); else idx.push(cb, b, a);
      }
    }
    // flache Dreiecksliste neu (wie meshFromGrid)
    const v = [], ft = [];
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
      if (Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) < 1e-9) continue;
      v.push(pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2], pos[c], pos[c + 1], pos[c + 2]);
      let t = Math.max(tag[idx[i]], tag[idx[i + 1]], tag[idx[i + 2]]); if (t === 0 && cv[idx[i]] + cv[idx[i + 1]] + cv[idx[i + 2]] > 0) t = 4; ft.push(t);
    }
    return { v: new Float32Array(v), ft: new Uint8Array(ft), pos: new Float32Array(pos), nrm: new Float32Array(nrm), tag: new Float32Array(tag), kv: new Float32Array(kv), cv: new Float32Array(cv), idx: new Uint32Array(idx), lines: new Uint32Array(lines), ntri: v.length / 9 };
  }
  // Höhenleitwerk als Trapezfläche (nur Anzeige): Wurzelrippe in der Rumpfmitte, beide Seiten gespiegelt.
  function hlwMesh(m) {
    const hl = m.fin && m.fin.hl; if (!hl || !hl.show) return null;
    const n = 40, us = []; for (let i = 0; i <= n; i++) us.push((1 - Math.cos(Math.PI * i / n)) / 2);
    const ring = (x0, c, z) => {
      const r = [];
      for (let i = n; i >= 0; i--) { const u = us[i]; r.push([x0 + u * c, hl.y + c * hl.pf.up(u) - u * c * hl.tanA, z]); }
      for (let i = 1; i <= n; i++) { const u = us[i]; r.push([x0 + u * c, hl.y + c * hl.pf.lo(u) - u * c * hl.tanA, z]); }
      r.push(r[0].slice()); return r;
    };
    let R;
    if (hl.wp) {
      // Tragfläche aus dem Projekt: echte Rippen je Station (Strak, Schränkung, V-Form), Wurzelnase auf (xLE, y)
      const r0 = hl.wp.sec[0], fl = hl.wp.flip;
      R = hl.wp.sec.map((s, k) => {
        const pts = s.pts.map(p => [p.x, (p.y + s.yRise) * fl]);
        let area = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p[0] * q[1] - q[0] * p[1]; }
        if (area < 0) pts.reverse();
        const f = pts[0], l = pts[pts.length - 1]; if (Math.hypot(f[0] - l[0], f[1] - l[1]) > 1e-6) pts.push(f.slice());
        return pts.map(p => { const dx = p[0] - r0.le; return [hl.xLE + dx, hl.y + p[1] - r0.yN - dx * hl.tanA, hl.pl[k].z]; });
      });
      if (R.some(r => r.length !== R[0].length)) return null;
    } else R = hl.pl.map(p => ring(p.le, p.c, p.z));
    return meshFromGrid(R[0].map((p, a) => R.map(r => r[a])), { mirror: true, closedU: true, tagAll: 3 });
  }
  // Ruder (nur Anzeige, nicht im STL): je Höhe y der Leitwerksschnitt hinter der Ruderlinie, Stirnfläche an der Ruderlinie.
  function rudMesh(m) {
    const g = m.fin, rd = g && g.rud; if (!rd || !rd.show) return null;
    const NY = 80, NU = 28, rows = [];
    for (let i = 0; i <= NY; i++) {
      const y = g.y0 + (g.yMax - g.y0) * i / NY, c = finChordAt(g, y), xa = rd.xh(y); if (!c || !(c[1] > xa + 0.3)) continue;
      const xb = c[1], ring = [];
      // nicht im Rumpf: über dem Rumpfrücken (im Bereich des Ruders) oder ganz hinter dem Rumpfende
      let yTop = -Infinity; for (let k = 0; k <= 12; k++) { const x = xa + (xb - xa) * k / 12; if (x >= m.x0 && x <= m.x1) yTop = Math.max(yTop, lineAt(m.L.top, x)); }
      if (y < yTop) continue;
      for (let k = 0; k <= NU; k++) { const u = (1 - Math.cos(Math.PI * k / NU)) / 2, x = xb - (xb - xa) * u; ring.push([x, y, Math.max(0, finT(g, x, y, true))]); }
      ring.push([xa, y, 0]);
      if (ring.some(q => q[2] > 0)) rows.push(ring);
    }
    if (rows.length < 2) return null;
    return meshFromGrid(rows[0].map((p, a) => rows.map(r => r[a])), { mirror: true, tagAll: 1 });
  }
  // ---------- Rumpfboot + konisches Leitwerksrohr ----------------------------------------------
  // Das Boot endet am Übergang xT. Dort setzt in Rohrachse die Einschnürung an (Steckzapfen der Länge sock), über die
  // das Rohr geschoben wird: Zapfen = Rohr-Innenfläche (außen − Wandstärke) − Spiel, mit der Konizität des Rohrs. Die
  // Rohrstirn liegt an der Schulter (Ebene X = xT). Achse: Mitte des Bootsquerschnitts am Übergang, Neigung ang.
  // Kegel um die Achse: Punkt(s, θ) = A + s·d + R(s)·(cosθ·n1 + sinθ·ez), d = (cos a, sin a, 0), n1 = (−sin a, cos a, 0).
  function BM() { const b = C('rproBoom'), d = DEF.rproBoom; for (const k in d) if (b[k] === undefined) b[k] = d[k]; return b; }
  function boomGeom(m) {
    const b = BM(); if (!b.on) return null;
    const xT = b.xAuto ? m.x1 : clamp(+b.x || 0, m.x0 + 10, m.x1);
    const bx = boxAt(m, xT), yc = (bx.top + bx.bot) / 2, dA = Math.max(2, (bx.h + 2 * bx.w) / 2);
    const r0 = Math.max(1, (b.dAuto ? dA : +b.d0 || dA) / 2), len = Math.max(20, +b.len || 20), r1 = clamp((+b.d1 || 0) / 2, 0.5, 5000);
    const a = clamp(+b.ang || 0, -15, 15) * Math.PI / 180, k = (r1 - r0) / len;
    const t = clamp(+b.wall || 0, 0, Math.min(r0, r1) - 0.5), play = Math.max(0, +b.play || 0), Ls = clamp(+b.sock || 0, 2, len * 0.9);
    const warn = [];
    let rs0 = r0 - t - play;
    if (rs0 < 1) { warn.push(T('Einschnürung: Rohr-Innendurchmesser abzüglich Spiel ist kleiner als 2 mm.')); rs0 = 1; }
    const g = { xT, yc, a, ca: Math.cos(a), sa: Math.sin(a), k, r0, r1, len, t, play, Ls, rs0, warn, dAuto: dA };
    g.xE = xT + Ls * g.ca;
    // Abweichung des Bootsquerschnitts am Übergang vom Rohr-Außenkreis (Rohr soll bündig anschließen)
    let dev = 0; for (const q of bodyHalf(m, xT)) dev = Math.max(dev, Math.abs(Math.hypot((q[0] - yc) * g.ca, q[1]) - r0));
    g.dev = dev;
    return g;
  }
  // Radius des Rohrs außen (s = Abstand ab der Schulter längs der Achse) und innen (= Wickeldorn).
  function boomR(g, s) { return g.r0 + g.k * s; }
  // Halbring (oben -> unten, z >= 0) eines Kegels R(s) = Ra + k·s um die Rohrachse in der Ebene X = x.
  function coneRing(g, Ra, x, n) {
    const P = [];
    for (let i = 0; i <= n; i++) {
      const th = Math.PI * i / n, c = Math.cos(th), sn = i === n ? 0 : Math.sin(th);
      const s = (x - g.xT + Ra * c * g.sa) / (g.ca - g.k * c * g.sa), R = Ra + g.k * s;
      P.push([g.yc + s * g.sa + R * c * g.ca, Math.max(0, R * sn), 0]);
    }
    return P;
  }
  // Querschnitt des Steckzapfens (Einschnürung) bei x.
  function boomHalf(m, x) {
    const g = m.boom, P = coneRing(g, g.rs0, clamp(x, g.xT, g.xE), Math.max(16, 2 * m.Nu));
    const nf = (m.wing ? 6 : 0) + (m.vt ? 4 : 0);   // Merkpunkte wie in halfAt (Leitwerk gibt es mit Boot nicht)
    if (nf) P.feat = new Array(nf).fill(P.length >> 1);
    return P;
  }
  // Rohr (nur Anzeige): vorne in der Schulterebene X = xT abgeschnitten, hinten senkrecht zur Achse.
  function boomMesh(m) {
    const g = m.boom; if (!g || BM().show === false) return null;
    const n = 64, ns = 30, G = [];
    for (let i = 0; i <= n; i++) {
      const th = 2 * Math.PI * (i % n) / n, c = Math.cos(th), sn = Math.sin(th), s0 = g.r0 * c * g.sa / (g.ca - g.k * c * g.sa), row = [];
      for (let j = 0; j <= ns; j++) { const s = s0 + (g.len - s0) * j / ns, R = boomR(g, s); row.push([g.xT + s * g.ca - R * c * g.sa, g.yc + s * g.sa + R * c * g.ca, R * sn]); }
      G.push(row);
    }
    return meshFromGrid(G, { closedU: true, tagAll: 5 });
  }
  // Heck am Übergang auf den Rohr-Außendurchmesser bringen: Kreisspant (Steuerspant) mit Ø = Rohr vorne.
  function boomRoundHeck() {
    if (!model || !model.boom) return;
    const g = model.boom, fr = formers();
    let f = fr.find(q => Math.abs(q.x - g.xT) < ONX);
    if (!f) { f = normFr({ x: r1(g.xT), type: 'circle', p: {}, ctl: {}, mode: {} }); let i = fr.findIndex(q => q.x > f.x); if (i < 0) i = fr.length; fr.splice(i, 0, f); }
    if (f.jmp) clearJump(f);
    f.type = 'circle'; f.p.dia = r2(2 * g.r0); f.ctl.dia = true;
    syncCircleOutlines(null);
  }
  // X der Nasenleiste in Höhe y (Gerade, darunter der Übergangsbogen, darunter senkrecht am Bogenanfang).
  function finLEx(g, y) {
    const f = g.fil;
    if (f) {
      if (y >= f.q[1]) return g.xLE + g.tL * (y - g.y0);
      if (y <= f.T[1]) return f.T[0];
      return f.c[0] + Math.sqrt(Math.max(0, f.R * f.R - (y - f.c[1]) * (y - f.c[1])));
    }
    return g.xLE + g.tL * (y - g.y0);
  }
  function finTEx(g, y) { return g.xLE + g.cr + g.tT * (y - g.y0); }
  // Oberer Abschluss bei x (vor dem Nasenleisten-Ende begrenzt die Nasenleiste selbst).
  function finTop(g, x) {
    if (g.free) { const X = finCross(g.N, x, 0); return X.length ? X[X.length - 1] : -Infinity; }
    return x <= g.xPT ? g.yPT : g.yPT + g.tP * (x - g.xPT);
  }
  // Halbe Dicke des Leitwerks bei (x, y); -1 = außerhalb des Grundrisses.
  // raw = mit Ruder (für die Anzeige des Ruders).
  function finT(g, x, y, raw) {
    if (g.rud && !raw && x > g.rud.xh(y)) return -1;   // hinter der Ruderlinie: Ruder, nicht Teil des Rumpfs
    if (g.free) return g.hl && y > hlwSeat(g.hl, x) ? -1 : finFreeT(g, x, y);
    if (y < g.y0 || y > finTop(g, x)) return -1;
    if (g.hl && y > hlwSeat(g.hl, x)) return -1;   // Auflage des Höhenleitwerks = Luft
    const le = finLEx(g, y), te = finTEx(g, y), c = te - le; if (!(c > 1e-6)) return -1;
    const u = (x - le) / c; if (u < 0 || u > 1) return -1;
    const f = g.fil;
    if (f && y <= f.T[1] && y > f.c[1] - f.R) { const s = Math.sqrt(Math.max(0, f.R * f.R - (y - f.c[1]) * (y - f.c[1]))); if (x > f.c[0] - s && x < f.c[0] + s) return -1; }   // im Übergangskreis = Luft
    const s = clamp((y - g.y0) / g.h, 0, 1), cn = Math.max(1e-6, te - (g.xLE + g.tL * (y - g.y0)));
    let t = cn * ((1 - s) * g.pr.t(u) + s * g.pt.t(u));
    if (g.tipRound > 0) { const d = (finTop(g, x) - y) * g.cosP; if (d < g.tipRound) { const q = (g.tipRound - d) / g.tipRound; t *= Math.sqrt(Math.max(0, 1 - q * q)); } }
    return t;
  }
  // Hohlkehle zwischen Rumpf P und einer Anbau-Flanke (Polylinie): Kreismittelpunkt wandert vom
  // Rumpfkontakt (Anfang der Flanke bei fromStart, sonst Ende) entlang der Flanke, bis er Abstand R hat.
  function flankFillet(P, flank, R, fromStart) {
    const L = flank.length - 1; if (L < 1 || !(R > 0.05)) return null;
    const at = s => { const p = fromStart ? s * L : (1 - s) * L, i = Math.min(L - 1, Math.max(0, Math.floor(p))), tt = p - i, A = flank[i], B = flank[i + 1]; return { i, y: A[0] + (B[0] - A[0]) * tt, z: A[1] + (B[1] - A[1]) * tt }; };
    const f = solveFillet(P, s => { const q = at(s); return { c: [q.y, q.z + R], q: [q.y, q.z] }; }, R);
    if (!f) return null;
    f.i = at(f.s).i; return f;
  }
  // Leitwerk im Spant bei x von oben (yTop) nach unten (yLo) abtasten: [[y, halbe Dicke], …], −1 = außen. Unter der ersten
  // Randstelle (gepfeilte Nasenleiste, schräg geschnitten: die Dicke wächst dort wie eine Wurzel) quadratisch verdichtet —
  // mit gleichen Schritten (~4 mm) traf jeder Spant die runde Spitze anders: gezackte Glanzlichter entlang der Nasenleiste.
  function finSamp(g, x, yLo, yTop, N) {
    const samp = []; for (let i = N; i >= 0; i--) { const y = yLo + (yTop - yLo) * i / N; samp.push([y, finT(g, x, y)]); }
    let iF = -1; for (let i = 0; i < samp.length; i++) if (samp[i][1] >= 0) { iF = i; break; }
    if (iF <= 0) return samp;
    let lo = samp[iF][0], hi = samp[iF - 1][0]; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (finT(g, x, m) >= 0) lo = m; else hi = m; }
    const D = Math.min(4 * (yTop - yLo) / N, lo - yLo), K = 16, dense = [];
    for (let k = 1; k <= K; k++) { const y = lo - D * (k / K) * (k / K); dense.push([y, finT(g, x, y)]); }
    return samp.slice(0, iF).concat(dense, samp.slice(iF).filter(q => q[0] < lo - D - 1e-9));
  }
  function finHalf(g, x, P) {
    if (!g) return P;
    if (g.ff && P && P.length >= 2) return finFilHalf(g, x, P);
    const yTop = Math.min(finTop(g, x), g.yMax, g.hl ? hlwSeat(g.hl, x) : Infinity), N = 64, F = 1;
    if (!(yTop > g.y0)) return P;
    const tagF = q => [q[0], q[1], F];
    // Umriss des Leitwerks bei x von oben nach unten (erster Punkt exakt auf dem Rand per Bisektion)
    const samp = finSamp(g, x, g.y0, yTop, N);
    let iFirst = -1; for (let i = 0; i < samp.length; i++) if (samp[i][1] >= 0) { iFirst = i; break; }
    if (iFirst < 0) return P;
    const out = [];
    if (iFirst > 0) { let lo = samp[iFirst][0], hi = samp[iFirst - 1][0]; for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (finT(g, x, mid) >= 0) lo = mid; else hi = mid; } out.push([lo, 0, F], [lo, Math.max(0, finT(g, x, lo)), F]); }
    else out.push([samp[0][0], 0, F]);
    let reachedFoot = true, iBrk = -1;
    for (let i = iFirst; i < samp.length; i++) { if (samp[i][1] < 0) { reachedFoot = false; iBrk = i; break; } out.push([samp[i][0], samp[i][1], F]); }
    // Einfache Fläche: das Leitwerk bleibt, wie es ist (Fuß eben bei y0, keine Verlängerung nach unten), der Rumpf auch —
    // der Schnitt ist die reine Vereinigung beider Umrisse.
    if (g.plain) {
      if (iBrk > 0) { let lo = samp[iBrk - 1][0], hi = samp[iBrk][0]; for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (finT(g, x, mid) >= 0) lo = mid; else hi = mid; } out.push([lo, Math.max(0, finT(g, x, lo)), F]); }
      const e = out[out.length - 1]; out.push([e[0], 0, F]);
      if (!P || P.length < 2) { out.finFeat = [out[1], e, e, e]; return out; }
      return unionHalf(out, P, F);
    }
    // Merkpunkte (scharfe Kanten): obere Ecke Abschluss/Flanke, untere Ecke, Verschneidung mit dem Rumpf, Rumpfanfang
    if (!P || P.length < 2) { const e = out[out.length - 1]; out.push([e[0], 0, F]); out.finFeat = [out[1], e, e, e]; return out; }
    const top = P[0][0], bot = P[P.length - 1][0];
    // Unter dem Leitwerksfuß mit konstanter Dicke weiter bis zur Rumpfunterkante (Leitwerksträger).
    if (reachedFoot && g.y0 > bot) { const n = 24, e = out[out.length - 1]; for (let i = 1; i <= n; i++) out.push([e[0] + (bot - e[0]) * i / n, e[1], F]); }
    const inside = q => { if (q[0] > top + 1e-9) return false; if (q[0] < bot - 1e-9) return true; const c = crossY(P, q[0]); return !!c && q[1] < c.z; };
    // Sichtbare Flanke: vom Austritt aus dem Rumpf (E) bis zum Wiedereintritt (B)
    let i0 = -1; for (let i = 0; i < out.length; i++) if (!inside(out[i])) { i0 = i; break; }
    if (i0 < 0) return P;
    let i1 = -1; for (let i = i0 + 1; i < out.length; i++) if (inside(out[i])) { i1 = i; break; }
    const bis = (a, b) => { for (let k = 0; k < 20; k++) { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, F]; if (inside(m)) a = m; else b = m; } return b; };
    const E = i0 > 0 ? bis(out[i0 - 1], out[i0]) : null, B = i1 > 0 ? bis(out[i1], out[i1 - 1]) : null;
    const flank = out.slice(i0, i1 > 0 ? i1 : out.length); if (E) flank.unshift(E); if (B) flank.push(B);
    const fh = E ? flankFillet(P, flank, g.R, true) : null;
    let ft = B ? flankFillet(P, flank, g.R, false) : null;
    if (fh && ft && fh.i + 1 > ft.i) ft = null;
    const a0 = E ? (fh ? fh.i + 1 : 1) : 0, a1 = B ? (ft ? ft.i + 1 : flank.length - 1) : flank.length;
    let res = [];
    if (E) {
      if (fh) res = cutBefore(P, fh.T).concat(arcPts(fh.c, g.R, [fh.T.y, fh.T.z], fh.q, 8).slice(1).map(tagF));
      else { const cE = crossY(P, Math.min(E[0], top)); res = cE ? cutBefore(P, cE) : [P[0]]; }
    }
    const nA = res.length;
    res = res.concat(flank.slice(a0, Math.max(a0, a1)).map(tagF));
    const fA = res[clamp(E ? nA - 1 : nA + 1, 0, res.length - 1)], nB = B ? res.length : res.length - 1; let fC = null;
    if (B) {
      if (ft) res = res.concat([tagF(ft.q)], arcPts(ft.c, g.R, ft.q, [ft.T.y, ft.T.z], 8).slice(1).map(tagF), cutAfter(P, ft.T));
      else { const cB = crossY(P, Math.max(B[0], bot)); res = res.concat([tagF(B)], cB ? cutAfter(P, cB) : [P[P.length - 1]]); }
    } else {
      // Leitwerk endet frei über dem Rumpf (gepfeilte Endleiste ragt hinter die Wurzel): der Schnitt hat zwei Teile.
      // Der Rumpf bleibt erhalten; verbunden wird über die Symmetrieebene (z = 0, dort entstehen keine Dreiecke).
      const e = res[res.length - 1]; res.push([e[0], 0, F]);
      if (e[0] > top + 1e-6) { fC = P[0]; res = res.concat(P); }
    }
    const fB = res[clamp(nB, 0, res.length - 1)];
    res.finFeat = [fA, fB, fB, fC || fB];
    return res;
  }
  // Vereinigung zweier Halbumrisse (Polylinien [[y,z,tag],…] von oben nach unten, Anfang/Ende auf z = 0, Inneres zur
  // Mitte hin): Außenkontur ablaufen, an jeder Kreuzung nach außen auf die andere Linie wechseln. Liegen die Teile
  // getrennt übereinander, verbindet die Symmetrieebene (dort entstehen keine Dreiecke). A = Leitwerk, B = Rumpf.
  function unionHalf(A, B, F) {
    const L = [A, B]; let cur = A[0][0] >= B[0][0] ? 0 : 1, i = 0, p = L[cur][0];
    const out = [p], toFin = [], toBody = [];
    for (let guard = 0; guard < 20000; guard++) {
      const Cc = L[cur], O = L[1 - cur]; if (i + 1 >= Cc.length) break;
      const q = Cc[i + 1], r0 = q[0] - p[0], r1 = q[1] - p[1]; let best = null;
      for (let k = 0; k + 1 < O.length; k++) {
        const c = O[k], d = O[k + 1], s0 = d[0] - c[0], s1 = d[1] - c[1], den = r0 * s1 - r1 * s0;
        if (!(den < -1e-14)) continue;   // nur Kreuzungen, an denen die andere Linie nach außen läuft
        const t = ((c[0] - p[0]) * s1 - (c[1] - p[1]) * s0) / den, u = ((c[0] - p[0]) * r1 - (c[1] - p[1]) * r0) / den;
        if (t > 1e-9 && t <= 1 && u >= 0 && u < 1 - 1e-12 && (!best || t < best.t)) best = { t, k };
      }
      if (best) {
        // Kreuzungspunkt doppelt: einmal mit der Herkunft der verlassenen, einmal der betretenen Linie — sonst färbt
        // das erste Stück hinter der Verschneidung in der falschen Farbe ab
        const y = p[0] + r0 * best.t, z = p[1] + r1 * best.t, pa = [y, z, q[2] || 0];
        p = [y, z, O[best.k + 1][2] || 0]; out.push(pa, p);
        cur = 1 - cur; i = best.k; (cur === 0 ? toFin : toBody).push(pa);
      } else { out.push(q); p = q; i++; }
    }
    const O = L[1 - cur]; let brg = null;
    if (O[0][0] < p[0] - 1e-9) { brg = O[0]; for (const q of O) out.push(q); }
    const has = q => out.indexOf(q) >= 0, endA = A[A.length - 1];
    const fA = has(A[1]) ? A[1] : toFin[0] || out[0];
    const fB = toBody.length ? toBody[toBody.length - 1] : has(endA) ? endA : fA;
    const fD = has(A[A.length - 2]) ? A[A.length - 2] : fB;
    out.finFeat = [fA, fD, fB, brg && cur === 0 ? brg : fB];
    out.cross = { toFin, toBody };
    return out;
  }
  // ---------- V-Leitwerk: Anschlussstummel mit Steckungsbohrungen ----------------------------------------
  // Je Seite ein Stummel wie bei der Tragfläche: das Leitwerksprofil gerade längs der Spannweitenrichtung
  // s = (sin Γ, cos Γ) in der Ebene (Y, Z) bis zur Rippenebene (Abstand tE von der Rumpfmitte, längs s gemessen), mit dem
  // Rumpf vereinigt (scharfe Kante, keine Übergänge). Profilpunkt (Sehne dx, Höhe h) -> Y = yLE + t·sin Γ + h·cos Γ,
  // Z = t·cos Γ − h·sin Γ; Einstellwinkel wie beim Tragflächenstummel als Neigung der Sehne um die Nase (h − dx·tan α).
  // Steckungsbohrungen: Lage x (längs der Sehne) / y (senkrecht dazu) ab der Profilnase, Achse längs der Spannweite,
  // Tiefe ab der Rippenfläche nach innen. Im Netz nur als Markierung (dunkle Stirn), dazu Bohrschablone als DXF.
  const VT_BORES = [{ x: 30, y: 0, d: 5, len: 12 }, { x: 75, y: 0, d: 3, len: 10 }];
  function VT() {
    const v = C('rproVt'), d = DEF.rproVt; for (const k in d) if (v[k] === undefined) v[k] = d[k];
    if (!Array.isArray(v.bores)) v.bores = JSON.parse(JSON.stringify(VT_BORES));
    return filNorm(v);
  }
  // Gedrehter Rahmen des V-Leitwerks: (h längs n, t längs s) ab der Profilnase in der Symmetrieebene — dort ist es eine
  // waagrechte Tragfläche (Nase bei h = 0, Spannweite +t), und die Rechnung des Tragflächenübergangs gilt unverändert.
  // Die Drehung ist eigentlich (det +1): die Reihenfolge der Halbspant-Punkte (oben -> unten) bleibt erhalten.
  function vtToW(g, p) { const dy = p[0] - g.yLE, z = p[1]; return [dy * g.n[0] + z * g.n[1], dy * g.s[0] + z * g.s[1]]; }
  // Leitlinien der V-Leitwerks-Anformung in den 2D-Ansichten: sie liegen im gedrehten Rahmen (X, t) — gezeigt in der Draufsicht
  // (Z = t·cosΓ − h·sinΓ), bei steilem V (|Γ| > 45°) in der Seitenansicht (Y). h = Profilmitte an Nase bzw. Endleiste.
  function vtGuideView(g) {
    const gw = g && g.gw; if (!gw || gw.mode !== 'fil' || !gw.gLE || !gw.gRef) return null;
    const kind = Math.abs(g.G) <= Math.PI / 4 ? 'top' : 'side', iv = kind === 'side' ? 0 : 1;
    const te = wingYs(gw, g.xT), hLE = 0, hTE = (te.yu + te.yl) / 2;
    return { kind, hLE, hTE, toV: (t, h) => vtPt(g, t, h)[iv], toT: (v, h) => iv ? (v - h * g.n[1]) / g.s[1] : (v - g.yLE - h * g.n[0]) / g.s[0] };
  }
  function vtPt(g, t, h) { return [g.yLE + t * g.s[0] + h * g.n[0], t * g.s[1] + h * g.n[1]]; }
  function vtHs(g, x) { const dx = clamp(x - g.xLE, 0, g.chord), u = dx / g.chord; return { hu: g.chord * g.pf.up(u) - dx * g.tanA, hl: g.chord * g.pf.lo(u) - dx * g.tanA }; }
  // Äußerste Kreuzung (größtes t) der Geraden O + t·d mit dem Halbumriss P: { t, k, u } oder null.
  function rayCross(P, O, d) {
    let best = null;
    for (let k = 0; k + 1 < P.length; k++) {
      const a = P[k], b = P[k + 1], e0 = b[0] - a[0], e1 = b[1] - a[1], den = d[0] * e1 - d[1] * e0;
      if (Math.abs(den) < 1e-12) continue;
      const w0 = a[0] - O[0], w1 = a[1] - O[1], t = (w0 * e1 - w1 * e0) / den, u = (w0 * d[1] - w1 * d[0]) / den;
      if (u >= 0 && u <= 1 && (!best || t > best.t)) best = { t, k, u };
    }
    return best;
  }
  function vtGeom(m) {
    const v = VT(); if (!v.on) return null;
    const pf = finProf(v.src, v.thk, v.prof); if (!pf) return null;
    const chord = Math.max(5, +v.chord || 0), xLE = +v.xLE > 0 ? +v.xLE : m.x1 - chord - 20;
    let yLE = +v.yLE || 0;
    if (v.yAuto) { const xm = clamp(xLE + chord / 2, m.x0, m.x1); yLE = (lineAt(m.L.top, xm) + lineAt(m.L.bot, xm)) / 2; }
    const G = clamp(+v.dih || 0, -80, 80) * Math.PI / 180;
    const g = { pf, chord, xLE, xT: xLE + chord, yLE, G, tanG: Math.tan(G), s: [Math.sin(G), Math.cos(G)], n: [Math.cos(G), -Math.sin(G)],
      tanA: Math.tan(clamp(+v.alpha || 0, -20, 20) * Math.PI / 180), warns: [],
      name: v.src === 'dat' ? (v.prof && v.prof.name) || '' : 'NACA 00' + String(clamp(Math.round(+v.thk || 9), 1, 40)).padStart(2, '0') };
    // Art wie beim Tragflächenübergang; Ausschnitt und Anformung rechnen mit der Tragflächen-Geometrie im gedrehten Rahmen (gw)
    g.mode = v.mode === 'cut' ? 'cut' : v.mode === 'fil' ? 'fil' : 'stub';
    if (g.mode !== 'stub') {
      const rot = P => P.map(p => vtToW(g, p));
      const gw = g.gw = { mode: g.mode, pf, chord, xLE, yLE: 0, tanA: g.tanA, zf: 0, warns: g.warns, name: g.name,
        bodyAt: x => rot(bodyHalf(m, x)), bodyAtFine: x => rot(bodyHalfFine(m, x)), zAxis: h => h * g.tanG };
      if (g.mode === 'cut') { gw.open = v.cutOpen === 'up' || v.cutOpen === 'down' ? v.cutOpen : 'none'; gw.play = Math.max(0, +v.cutPlay || 0); gw.cutZ = Math.max(0, +v.cutZ || 0); }
      else {
        gw.te = Math.max(0, +v.te || 0); gw.zSet = +v.len > 0 ? +v.len : 0;
        try { filWing(m, gw, v, !(gw.zSet > 0)); } catch (e) { console.warn('Rumpf: Anformung V-Leitwerk', e); gw.fl = null; g.warns.push(T('Anformung konnte nicht berechnet werden.')); }
      }
    }
    // Rippenebene: fest oder automatisch = äußerster Austritt der Profilober-/-unterseite aus dem Rumpf + 15 mm
    let tE = +v.len;
    if (g.mode === 'fil' && g.gw.fl) tE = g.gw.zf;
    if (!(tE > 0)) {
      let tm = 0;
      for (let i = 0; i <= 24; i++) {
        const x = xLE + chord * i / 24; if (x < m.x0 || x > m.x1) continue;
        const P = bodyHalf(m, x), hs = vtHs(g, x);
        for (const h of [hs.hu, hs.hl]) { const c = rayCross(P, vtPt(g, 0, h), g.s); if (c) tm = Math.max(tm, c.t); }
      }
      tE = tm + 15;
    }
    g.tE = tE;
    g.bores = v.bores.map((b, i) => {
      const r = Math.max(0.25, (+b.d || 0) / 2), bx = +b.x || 0, by = +b.y || 0, len = Math.max(0.5, +b.len || 0);
      const h = by - bx * g.tanA, tIn = tE - len, nm = T('Bohrung') + ' ' + (i + 1) + ': ';
      // Lochrand mit 0,5 mm Abstand zur Profilkontur (im Profil-Koordinatensystem ab der Nase)
      let inP = bx - r > 0.5 && bx + r < chord - 0.5;
      for (let k = 0; inP && k < 48; k++) {
        const a = 2 * Math.PI * k / 48, px = bx + r * Math.cos(a), py = by + r * Math.sin(a), u = px / chord;
        if (py > chord * pf.up(u) - 0.5 || py < chord * pf.lo(u) + 0.5) inP = false;
      }
      const w = [];
      if (!inP) w.push(nm + T('liegt nicht ganz im Profil (0,5 mm Rand).'));
      if (tIn < Math.max(0, h * g.tanG)) w.push(nm + T('reicht über die Rumpfmitte hinaus.'));
      g.warns.push(...w);
      return { i, x: bx, y: by, d: 2 * r, r, len, X: xLE + bx, h, tIn, ok: !w.length };
    });
    return g;
  }
  // Halbumriss bei x mit V-Leitwerks-Stummel (Vereinigung). Merkpunkte vtFeat: Verschneidung oben, Rippenecken oben/unten,
  // Verschneidung unten — ohne Stummel alle im Rumpfpunkt auf der Stummelachse.
  function vtHalf(g, x, P) {
    if (!g) return P;
    const F = 1;
    // h0: Höhe der Merkpunkte ohne Anbau (Anformung: vor/hinter der Projektion an deren Anfangs-/Endpunkt, wie wingHalf)
    const none = (h0 = 0) => {
      if (!P || P.length < 2) return P;
      const c = rayCross(P, vtPt(g, 0, h0), g.s); if (!c) return P;
      const a = P[c.k], b = P[c.k + 1], q = [a[0] + (b[0] - a[0]) * c.u, a[1] + (b[1] - a[1]) * c.u, a[2] || 0];
      const R = P.slice(0, c.k + 1).concat([q], P.slice(c.k + 1)); R.vtFeat = [q, q, q, q]; return R;
    };
    if (g.gw) return vtHalfW(g, x, P, none);
    if (x <= g.xLE || x >= g.xT) return none();
    const hs = vtHs(g, x); if (!(hs.hu - hs.hl > 1e-6)) return none();
    const pt = (t, h) => { const p = vtPt(g, t, h); return [p[0], Math.max(0, p[1]), F]; };
    const A = [pt(hs.hu * g.tanG, hs.hu), pt(g.tE, hs.hu), pt(g.tE, hs.hl), pt(hs.hl * g.tanG, hs.hl)];
    if (!P || P.length < 2) { const R = A.slice(); R.vtFeat = A.slice(); return R; }
    const U = unionHalf(A, P, F), cr = U.cross, has = q => U.indexOf(q) >= 0;
    if (!has(A[1]) && !has(A[2])) return none();   // Stummel liegt hier ganz im Rumpf
    const f1 = has(A[1]) ? A[1] : A[2], f2 = has(A[2]) ? A[2] : f1;
    const fU = cr.toFin.length ? cr.toFin[0] : has(A[0]) ? A[0] : f1;
    const fL = cr.toBody.length ? cr.toBody[cr.toBody.length - 1] : has(A[3]) ? A[3] : f2;
    U.vtFeat = [fU, f1, f2, fL];
    return U;
  }
  // Ausschnitt/Anformung des V-Leitwerks: Halbspant in den gedrehten Rahmen, dort wingCut/wingFil, zurückdrehen. Unberührte
  // Punkte bleiben dieselben Objekte (Merkpunkte der Tragfläche werden über die Identität wiedergefunden); neue Punkte
  // bekommen die Farbe des Leitwerks, Z < 0 (über die Symmetrieebene) wird auf 0 gesetzt.
  function vtHalfW(g, x, P, none) {
    const gw = g.gw, NONE = [];
    const fl = gw.mode === 'fil' ? gw.fl : null, h0 = fl ? (x >= fl.x1 ? fl.y1 : x <= fl.x0 ? fl.y0 : 0) : 0;
    if (!P || P.length < 2 || (gw.mode === 'fil' && !fl)) return none(h0);
    const back = new Map(), Pr = P.map(p => { const q = vtToW(g, p); q.push(p[2] || 0); back.set(q, p); return q; });
    const R = gw.mode === 'cut' ? wingCut(gw, x, Pr, () => NONE) : wingFil(gw, x, Pr, () => NONE);
    if (R === NONE || !R || !R.featPts) return none(h0);
    const out = R.map(q => { const o = back.get(q); if (o) return o; const p = vtPt(g, q[1], q[0]); return [p[0], Math.max(0, p[1]), q[2] === 2 ? F_VT : (q[2] || 0)]; });
    const fp = R.featPts, at = q => out[Math.max(0, R.indexOf(q))];
    out.vtFeat = [at(fp[0]), at(fp[2]), at(fp[3]), at(fp[5])];
    return out;
  }
  const F_VT = 1;
  // Steckungsbohrungen (nur Anzeige): je Bohrung ein Zylinder von knapp vor der Rippenfläche bis zum Bohrungsgrund,
  // beide Seiten; die dunkle Stirn markiert das Loch auf der Rippenfläche.
  function vtBoreMeshes(m) {
    const g = m.vt; if (!g || !g.bores.length) return [];
    const n = 32, out = [];
    for (const b of g.bores) {
      const at = (a, t) => { const c = vtPt(g, t, b.h), ca = Math.cos(a) * b.r, sa = Math.sin(a) * b.r; return [b.X + ca, c[0] + sa * g.n[0], c[1] + sa * g.n[1]]; };
      const G = []; for (let i = 0; i <= n; i++) { const a = 2 * Math.PI * (i % n) / n; G.push([at(a, g.tE + 0.15), at(a, b.tIn)]); }
      out.push(meshFromGrid(G, { mirror: true, closedU: true, tagAll: 6 }));
    }
    return out;
  }
  // Bohrschablone: Rippenfläche des Stummels (Profil in der Rippenebene, Nase im Ursprung, X längs Sehne) mit den Bohrungen.
  function exportVtDxf() {
    if (!model || !model.vt) { alert(T('V-Leitwerk-Stummel ist nicht aktiv.')); return; }
    const g = model.vt, n = 80, up = [], lo = [];
    for (let i = 0; i <= n; i++) { const u = (1 - Math.cos(Math.PI * i / n)) / 2, hs = vtHs(g, g.xLE + u * g.chord); up.push([u * g.chord, hs.hu]); lo.push([u * g.chord, hs.hl]); }
    const loops = [up.concat(lo.reverse().slice(1, -1))];
    for (const b of g.bores) { const L = []; for (let k = 0; k < 72; k++) { const a = 2 * Math.PI * k / 72; L.push([b.x + b.r * Math.cos(a), b.h + b.r * Math.sin(a)]); } loops.push(L); }
    saveFile(projBase() + '_vleitwerk_rippe.dxf', dxfText(loops), 'application/dxf', 'svDxf');
  }
  // Ring gleichmäßig nach Bogenlänge auf K Punkte abtasten (Herkunft = größere der beiden Segmentenden).
  // Gleiche Punktzahl je Spant mit stetiger Parametrisierung -> saubere Dreiecke zwischen den Spanten.
  // lam > 0: Verteilung nicht nur nach Bogenlänge, sondern Länge + lam · Drehung (rad) je Stück — enge Biegungen (z. B. der
  // Fuß einer schmalen, hohen Kehle: Radius < 1 mm) bekommen mehr Zeilen statt ein, zwei Facetten (sichtbare Kante).
  function resampleRing(P, K, lam) {
    const n = P.length, cum = [0], tw = new Array(n).fill(0);
    if (lam > 0) for (let i = 1; i + 1 < n; i++) {
      const u0 = P[i][0] - P[i - 1][0], u1 = P[i][1] - P[i - 1][1], v0 = P[i + 1][0] - P[i][0], v1 = P[i + 1][1] - P[i][1];
      if (Math.hypot(u0, u1) > 1e-6 && Math.hypot(v0, v1) > 1e-6) tw[i] = Math.abs(Math.atan2(u0 * v1 - u1 * v0, u0 * v0 + u1 * v1));
    }
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]) + (lam > 0 ? lam * 0.5 * (tw[i - 1] + tw[i]) : 0));
    const L = cum[n - 1], out = [];
    if (!(L > 1e-9)) { for (let k = 0; k < K; k++) out.push([P[0][0], P[0][1], P[0][2] || 0]); return out; }
    let j = 0;
    for (let k = 0; k < K; k++) {
      const s = L * k / (K - 1); while (j < n - 2 && cum[j + 1] < s) j++;
      const d = cum[j + 1] - cum[j], t = d > 1e-12 ? clamp((s - cum[j]) / d, 0, 1) : 0, A = P[j], B = P[j + 1];
      out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, Math.max(A[2] || 0, B[2] || 0)]);
    }
    return out;
  }
  // Abschnittsweises Abtasten: Ringe mit Merkpunkten (feat) werden zwischen den Merkpunkten getrennt abgetastet;
  // Punktzahl je Abschnitt global (nach der größten Abschnittslänge), damit jeder Merkpunkt überall denselben Index hat.
  function ringLen(P, a, b) { let L = 0; for (let i = a + 1; i <= b; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return L; }
  // turnMax > 0 (Anformung): jeder Abschnitt bekommt zusätzlich mindestens so viele Zeilen, dass die Kontur je Zeile
  // höchstens turnMax (rad) dreht — sonst wird die enge Kehle der Anformung im Gitter zur Facettentreppe.
  function piecewisePlan(rings, K, turnMax) {
    if (!rings.every(r => r.feat)) return null;
    const nP = rings[0].feat.length + 1, Lm = new Array(nP).fill(0), Tm = new Array(nP).fill(0);
    const turn = (r, a, b) => {
      let s = 0;
      for (let i = a + 1; i < b; i++) {
        const p = r[i - 1], q = r[i], o = r[i + 1], u0 = q[0] - p[0], u1 = q[1] - p[1], v0 = o[0] - q[0], v1 = o[1] - q[1];
        if (Math.hypot(u0, u1) < 1e-6 || Math.hypot(v0, v1) < 1e-6) continue;
        s += Math.abs(Math.atan2(u0 * v1 - u1 * v0, u0 * v0 + u1 * v1));
      }
      return s;
    };
    for (const r of rings) {
      const bd = [0].concat(r.feat, [r.length - 1]);
      for (let j = 0; j < nP; j++) { Lm[j] = Math.max(Lm[j], ringLen(r, bd[j], bd[j + 1])); if (turnMax > 0) Tm[j] = Math.max(Tm[j], turn(r, bd[j], bd[j + 1])); }
    }
    const tot = Lm.reduce((a, b) => a + b, 0) || 1;
    const cnt = Lm.map((L, j) => Math.max(2, Math.round((K - 1) * L / tot), turnMax > 0 ? Math.ceil(Tm[j] / turnMax) : 0));
    return { cnt, K: cnt.reduce((a, b) => a + b, 0) + cnt.length, lam: 0 };
  }
  // Spanten ohne Tragfläche/V-Leitwerk: deren zusammengefallener Merkpunkt wird so auf den Rumpfbogen gelegt, dass die
  // Gitterzeilen der beiden angrenzenden Rumpfabschnitte gleich dicht liegen. Sonst sitzt er auf Profilhöhe — außerhalb
  // des Querschnitts (Nase, Heck) rutscht er an den Rand, die Zeilen verdrehen sich von Spant zu Spant (Zebra-Treppen).
  function floatPieces(P, cnt) {
    if (!P.floatFeat || !P.floatFeat.length) return P;
    const Q = P.slice(), feat = P.feat.slice();
    for (const [i0, i1, w] of P.floatFeat) {
      const a = i0 > 0 ? feat[i0 - 1] : 0, b = i1 + 1 < feat.length ? feat[i1 + 1] : Q.length - 1;
      const ca = cnt[i0], cb = cnt[i1 + 1]; if (!(ca + cb > 0) || b <= a || w >= 1) continue;
      const qc = [0]; for (let i = 1; i < Q.length; i++) qc.push(qc[i - 1] + Math.hypot(Q[i][0] - Q[i - 1][0], Q[i][1] - Q[i - 1][1]));
      const sA = qc[a], sB = qc[b], s = (1 - w) * (sA + (sB - sA) * ca / (ca + cb)) + w * qc[clamp(feat[i0], a, b)];
      let j = a; while (j < b - 1 && qc[j + 1] < s) j++;
      const d = qc[j + 1] - qc[j], t = d > 1e-12 ? clamp((s - qc[j]) / d, 0, 1) : 0, A = Q[j], B = Q[j + 1];
      const pt = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, 0];
      Q.splice(j + 1, 0, pt);
      for (let k = 0; k < feat.length; k++) { if (k >= i0 && k <= i1) feat[k] = j + 1; else if (feat[k] > j) feat[k]++; }
    }
    Q.feat = feat; return Q;
  }
  function resamplePieces(P, cnt, lam) {
    P = floatPieces(P, cnt);
    const bd = [0].concat(P.feat, [P.length - 1]), out = [];
    for (let j = 0; j < cnt.length; j++) {
      const a = bd[j], b = Math.max(bd[j], bd[j + 1]), sub = P.slice(a, b + 1);
      const r = sub.length >= 2 ? resampleRing(sub, cnt[j] + 1, lam) : new Array(cnt[j] + 1).fill(0).map(() => [sub[0][0], sub[0][1], sub[0][2] || 0]);
      // Jeder Merkpunkt steht doppelt im Ring (Ende des einen, Anfang des nächsten Abschnitts): so bekommt eine
      // scharfe Kante dort je Seite eine eigene Normale und Farbe (meshFromGrid, crease) — wie nach einer booleschen Operation.
      if (sub.length >= 2 && ringLen(sub, 0, sub.length - 1) > 1e-9) { const tg = r[r.length >> 1][2] || 0, e = r.length - 1; r[0] = [r[0][0], r[0][1], tg]; r[e] = [r[e][0], r[e][1], tg]; }
      for (let i = 0; i < r.length; i++) out.push(r[i]);
    }
    return out;
  }
  // Halbspant bei x inkl. Anbauten: [[y,z,tag],…] von oben nach unten (erster/letzter Punkt z = 0).
  const FINE = 480;
  function halfAt(m, x) {
    if (m.boom && x > m.boom.xT + 1e-9) return boomHalf(m, x);
    let P = null, extra = 0;
    // Rumpf fein abgetastet (FINE Punkte je Bezier-Segment): das Gitter tastet den Ring abschnittsweise neu ab
    // (Anbauten-Merkpunkte). Läge es auf dem groben Sehnenzug, wanderten dessen Ecken von Spalte zu Spalte gegen
    // die Gitterzeilen -> Facetten-Treppen über den ganzen Rumpf (Zebra). extra = Mehrpunkte gegenüber grob (für K).
    if (x >= m.x0 - 1e-9 && x <= m.x1 + 1e-9) {
      const sp = secParams(m, x), ps = perSegOf(m, sp.nodes), pf = Math.max(ps, Math.ceil(FINE / Math.max(1, sp.nodes.length - 1)));
      P = polyOf(sp.nodes, pf).map(q => [q[0], q[1] > 0 ? q[1] : 0, 0]); extra = (sp.nodes.length - 1) * (pf - ps);
    }
    if (m.wing) P = wingHalf(m.wing, x, P);
    const fp = P && P.featPts;
    if (m.vt) P = vtHalf(m.vt, x, P);
    const vp = P && P.vtFeat;
    if (m.fin) P = finHalf(m.fin, x, P);
    const ff = P && P.finFeat;
    const hc = m.fin && m.fin.hl && m.fin.hl.cross && !m.gridBuild;   // im 3D-Gitter nicht: dort boolesch (stubUnion)
    if (hc) P = hlStubHalf(m.fin.hl, x, P);
    const hp = P && P.hlFeat;
    if (!P || P.length < 2) { const y = P && P.length ? P[0][0] : lineAt(m.L.top, clamp(x, m.x0, m.x1)); P = [[y, 0, 0], [y, 0, 0]]; }
    // Merkpunkte (Objekte aus dem Ring) als Indizes im endgültigen Ring; fehlt einer, gleichmäßig abtasten.
    // Ohne Merkpunkte (z. B. nur Leitwerk hinter dem Rumpf): alle in der Ringmitte, Abschnitte leer.
    const look = L => { const idx = []; let k = 0; for (const q of L) { while (k < P.length && P[k] !== q && !(P[k][0] === q[0] && P[k][1] === q[1])) k++; if (k >= P.length) return null; idx.push(k); } return idx; };
    const mid = n => new Array(n).fill(P.length >> 1);
    const wl = m.wing ? (fp && look(fp)) || mid(6) : [], vl = m.vt ? (vp && look(vp)) || mid(4) : [];
    // Leitwerk mit scharfen Kanten: seine Merkpunkte stehen vorn (ohne Leitwerk im Schnitt am Ringanfang, Abschnitte leer),
    // dann V-Leitwerk und Tragfläche (umgekehrtes V unter der Tragfläche); Reihenfolge im Ring erzwingen
    const fl = m.fin && m.fin.sharp ? (ff || [0, 0, 0, 0]).map(q => Math.max(0, P.indexOf(q))) : [];
    // Kreuzleitwerk-Stummel sitzt auf der Leitwerksflanke: seine Merkpunkte zwischen oberer Leitwerksecke und dem Rest
    const hli = hc ? (hp && look(hp)) || mid(4) : [], fh = hc && fl.length ? [fl[0]].concat(hli, fl.slice(1)) : fl.concat(hli);
    const all = fh.concat(m.vt && m.vt.G < 0 ? wl.concat(vl) : vl.concat(wl));
    if (all.length) {
      for (let i = 1; i < all.length; i++) if (all[i] < all[i - 1]) all[i] = all[i - 1]; P.feat = all;
      // Fehlt Tragfläche/V-Leitwerk im Schnitt (alle Merkpunkte in einem Punkt), darf der Punkt wandern (floatFeat)
      // Gewicht w: 1 = am bisherigen Punkt bleiben (am Stummel deckt er sich mit dessen dünner Nase/Endleiste),
      // 0 = frei; dazwischen weicher Übergang über eine halbe Profiltiefe vor bzw. hinter dem Anbau
      const wOf = (x0, x1, ch) => { const d = x < x0 ? x0 - x : x > x1 ? x - x1 : 0, D = Math.max(20, 0.5 * ch), t = clamp(d / D, 0, 1); return 1 - t * t * (3 - 2 * t); };
      const ww = m.wing ? (m.wing.mode === 'fil' && m.wing.fl ? wOf(m.wing.fl.x0, m.wing.fl.x1, m.wing.chord) : m.wing.mode === 'cut' ? wOf(m.wing.xLE - m.wing.play, m.wing.xLE + m.wing.chord + m.wing.play, m.wing.chord) : wOf(m.wing.xLE, m.wing.xLE + m.wing.chord, m.wing.chord)) : 0;
      const gv = m.vt && m.vt.gw, wv = !m.vt ? 0 : gv && gv.mode === 'fil' && gv.fl ? wOf(gv.fl.x0, gv.fl.x1, m.vt.chord) : gv && gv.mode === 'cut' ? wOf(m.vt.xLE - gv.play, m.vt.xT + gv.play, m.vt.chord) : wOf(m.vt.xLE, m.vt.xT, m.vt.chord);
      const grp = (L, i0, w) => L.length && L.every(v => v === L[0]) ? [[i0, i0 + L.length - 1, w]] : [];
      const inv = m.vt && m.vt.G < 0, o1 = inv ? wl : vl, o2 = inv ? vl : wl;
      P.floatFeat = grp(o1, fh.length, inv ? ww : wv).concat(grp(o2, fh.length + o1.length, inv ? wv : ww));
      // Kreuzleitwerk-Stummel: der zusammengefallene Merkpunkt bleibt fest auf der Leitwerksflanke in Stummelhöhe (hlStubHalf).
      // Wandert er (floatFeat), verschieben sich die Gitterzeilen über die Flanke von Spalte zu Spalte -> Wellen im Seitenleitwerk.
    }
    P.extra = extra;
    return P;
  }
  // Tragfläche aus dem Tragflächendesign (nur Anzeige): Wurzelrippe an der Wurzelrippen-Ebene des
  // Übergangs, gleiche Tiefe/Einstellwinkel wie die Anformung, beide Seiten gespiegelt.
  function wingMesh(m) {
    const g = m.wing; if (!g || !C('rproShowWing')) return null;
    const Wg = App.wing; if (!Wg || !Wg.stations || Wg.stations.length < 2 || !state.root) return null;
    const sc = g.chord / (+state.root.chord || g.chord), flip = state.cfg && state.cfg.flipY ? -1 : 1;
    const rings = [];
    for (const st of Wg.stations) {
      if (!st || !st.pts || st.pts.length < 3) return null;
      const pts = st.pts.map(p => [p.x * sc, (p.y + (st.yRise || 0)) * flip * sc]);
      let area = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p[0] * q[1] - q[0] * p[1]; }
      if (area < 0) pts.reverse();
      const f = pts[0], l = pts[pts.length - 1]; if (Math.hypot(f[0] - l[0], f[1] - l[1]) > 1e-6) pts.push(f.slice());
      rings.push({ pts, z: (st.z || 0) * sc });
    }
    const K = rings[0].pts.length; if (rings.some(r => r.pts.length !== K)) return null;
    const G = [];
    for (let a = 0; a < K; a++) G.push(rings.map(r => { const p = r.pts[a]; return [g.xLE + p[0], g.yLE + p[1] - p[0] * g.tanA, g.zf + r.z]; }));
    return meshFromGrid(G, { mirror: true, closedU: true, tagAll: 3 });
  }

  // ---------- Modell ------------------------------------------------------------------
  let model = null;   // { FR, FN, P, L, MA, MI, MO, circ, G, mesh, bounds, err, ntri, vol, wing, fin, x0, x1, xs, xe }
  // Punkte je Bezier-Segment eines Halbspants (Knotenzahl wechselt je nach Typ).
  function perSegOf(m, nodes) { return Math.max(2, Math.round(m.Nu / Math.max(1, nodes.length - 1))); }
  // Physischer Spant an der Stelle x.
  function secParams(m, x) {
    const bx = boxAt(m, x), { top, bot, w, h } = bx;
    const nodes = sectionNodes(m, x).map(q => ({ y: bot + q.y * h, z: Math.max(0, q.z * w), i: [q.i[0] * h, q.i[1] * w], o: [q.o[0] * h, q.o[1] * w] }));
    return { x, top, bot, w, h, nodes };
  }
  // Reiner Rumpf-Halbspant ohne Anbauten: [[y,z],…] von oben nach unten.
  function bodyHalf(m, x) { const sp = secParams(m, x); return polyOf(sp.nodes, perSegOf(m, sp.nodes)).map(q => [q[0], q[1] > 0 ? q[1] : 0]); }
  // wie bodyHalf, aber so fein wie das Gitter (halfAt, FINE) — für Fußpunkte der Anformung: das grobe Polygon liegt bis
  // ~0,04 mm innerhalb der Kontur, die Übergangskurven begannen dann unter der Rumpfhaut (feine Rinne längs des Fußes)
  function bodyHalfFine(m, x) { const sp = secParams(m, x), ps = perSegOf(m, sp.nodes), pf = Math.max(ps, Math.ceil(FINE / Math.max(1, sp.nodes.length - 1))); return polyOf(sp.nodes, pf).map(q => [q[0], q[1] > 0 ? q[1] : 0]); }
  function secHalfZ(m, x, y) { const P = bodyHalf(m, clamp(x, m.x0, m.x1)); const c = crossY(P, clamp(y, P[P.length - 1][0] + 1e-6, P[0][0] - 1e-6)); return c ? c.z : 0; }
  function secHalf(m, x) { return halfAt(m, x).map(q => [x, q[0], q[1]]); }
  // ---- Rückgängig / Wiederholen (Strg+Z, Strg+Y bzw. Strg+Umschalt+Z) ----------------------------------------
  // Verlauf als Schnappschüsse aller Rumpf-Daten (DEF-Schlüssel ohne Ansicht, Auswahl, Darstellung und Bilddaten).
  // histCommit() läuft in build() (nicht während des Ziehens, dafür beim Loslassen): jeder geänderte Stand wird abgelegt,
  // egal ob er aus der Seitenleiste, vom Ziehen eines Griffs oder von außen kommt. Laden/Speichern des Projekts leert den
  // Verlauf — zurück geht es höchstens bis zum letzten Speicherstand. Eigene Spantbilder (f.bgSrc) liegen nur einmal im Pool.
  const HIST_SKIP = new Set(['rproView', 'rproSel', 'rproPt', 'rproCutX', 'rproImgSrc', 'rproImgVec', 'rproImgOp', 'rproRender', 'rproShowSt',
    'rproShowTan', 'rproShowWing', 'rproComb', 'rproCombLen', 'rproAna', 'rproKhHide']);
  const HIST_KEYS = Object.keys(DEF).filter(k => !HIST_SKIP.has(k)), HIST_MAX = 300;
  // touched: seit dem letzten Schritt wurde in der Rumpf-Ansicht oder der Seitenleiste bedient. Nur dann wird eine Änderung
  // ein Schritt; ohne Bedienung (Selbst-Ergänzung fehlender Werte beim ersten Aufbau, Übergabe aus anderen Reitern) wird sie
  // still Teil des aktuellen Stands — sonst gäbe es Strg+Z-Schritte ohne sichtbare Wirkung.
  const hist = { undo: [], redo: [], cur: null, mute: false, touched: false }, bgPool = [];
  {
    const touch = e => {
      if (state.activeTab !== 'rpro' || hist.mute) return;
      if (e.type === 'wheel' && !e.altKey) return;   // Rad allein = Zoom; Alt+Rad skaliert/dreht das Bild
      const t = e.target; if (!(t instanceof Element)) return;
      if (t.closest('#side') || t.closest('#rproView') || t.id === 'cRpro' || e.type === 'keydown') hist.touched = true;
    };
    for (const ev of ['mousedown', 'input', 'change', 'keydown', 'wheel']) document.addEventListener(ev, touch, true);
  }
  function histSnap() {
    const o = {}; for (const k of HIST_KEYS) { const v = state.cfg[k] != null ? state.cfg[k] : DEF[k]; if (v != null) o[k] = v; }   // nicht angelegt = Vorgabe (kein Scheinschritt beim ersten Zugriff)
    return JSON.stringify(o, (k, v) => {
      if (k !== 'bgSrc' || typeof v !== 'string') return v;
      let i = bgPool.indexOf(v); if (i < 0) { i = bgPool.length; bgPool.push(v); } return '@bg' + i;
    });
  }
  function histCommit() {
    if (hist.mute || dragging) return;
    const s = histSnap();
    if (hist.cur == null) { hist.cur = s; histBtns(); return; }
    if (s === hist.cur) return;
    if (!hist.touched) { hist.cur = s; return; }
    hist.undo.push(hist.cur); if (hist.undo.length > HIST_MAX) hist.undo.shift();
    hist.cur = s; hist.redo.length = 0; hist.touched = false; histBtns();
  }
  function histApply(s) {
    const o = JSON.parse(s, (k, v) => k === 'bgSrc' && typeof v === 'string' && /^@bg\d+$/.test(v) ? bgPool[+v.slice(3)] : v);
    for (const k of HIST_KEYS) { if (k in o) state.cfg[k] = o[k]; else delete state.cfg[k]; }
    const n = (state.cfg.rproFr || []).length;
    if (!(C('rproSel') < n)) S('rproSel', Math.max(0, n - 1));
    const sp = C('rproPt'), ol = state.cfg.rproOut;
    if (sp && !(ol && ol[sp.line] && sp.k < ol[sp.line].length)) S('rproPt', null);
    traceShow = null; dragH = null; hot = null;
    hist.mute = true; try { buildSidebar(); build(); draw(); } finally { hist.mute = false; }
    hist.cur = histSnap(); histBtns();
  }
  function histStep(back) {
    if (state.activeTab !== 'rpro') return;
    histCommit();
    const from = back ? hist.undo : hist.redo, to = back ? hist.redo : hist.undo;
    if (!from.length) { if (App.toast) App.toast(T(back ? 'Nichts mehr rückgängig zu machen (Stand beim letzten Laden/Speichern).' : 'Nichts zu wiederholen.')); return; }
    to.push(hist.cur); histApply(from.pop());
  }
  // Projekt geladen/gespeichert: Verlauf leeren, der aktuelle Stand ist der neue Ausgangspunkt.
  function histReset() { hist.undo.length = 0; hist.redo.length = 0; hist.cur = null; bgPool.length = 0; histBtns(); }
  function histMarkSaved() { histReset(); hist.cur = histSnap(); histBtns(); }
  function histBtns() {
    const u = document.getElementById('rproUndo'), r = document.getElementById('rproRedo');
    if (u) { u.disabled = !hist.undo.length; u.title = T('Rückgängig (Strg+Z)') + (hist.undo.length ? ' — ' + hist.undo.length + ' ' + T('Schritte') : ''); }
    if (r) { r.disabled = !hist.redo.length; r.title = T('Wiederholen (Strg+Y)') + (hist.redo.length ? ' — ' + hist.redo.length + ' ' + T('Schritte') : ''); }
  }
  function build() {
    outlines(); formers(); enforceFix(); syncCircleOutlines(null); enforceFix();
    histCommit();
    const o = outlines(), FR = formers().slice().sort((a, b) => a.x - b.x);
    model = { FR };
    try {
      if (!FR.length) throw new Error(T('Mindestens ein Spant nötig.'));
      const L = { top: outSegs(o.top), bot: outSegs(o.bot), w: outSegs(o.w) };
      const x0 = o.top[0].x, x1 = o.top[o.top.length - 1].x;
      if (!(x1 - x0 > 1e-9)) throw new Error(T('Rumpf hat keine Ausdehnung.'));
      const Nu = Math.max(6, Math.round(C('rproNu'))), Nv = Math.max(8, Math.round(C('rproNv')));
      Object.assign(model, { L, x0, x1, xs: x0, xe: x1, Nu });
      prepFormers(model);
      model.bad = FR.map((f, j) => f.type === 'rect' ? rectNodes(model.P[j], boxBase(model, f.x)).bad : '');
      model.FN = FR.map((f, j) => f.type === 'free' ? straighten(f.nodes) : shapeNodes(f.type, model.P[j], boxBase(model, f.x)));
      Object.assign(model, prepMorph(FR.map(f => f.x), model.FN, FR.map(f => f.jmp === 'b')));
      model.circ = [];
      FR.forEach((f, j) => {
        if (f.type !== 'circle') return;
        const b = boxBase(model, f.x), D = model.P[j].dia > 0 ? model.P[j].dia : (b.h + 2 * b.w) / 2, c = (b.top + b.bot) / 2;
        model.circ.push({ x: f.x, xl: j > 0 ? FR[j - 1].x : null, xr: j < FR.length - 1 ? FR[j + 1].x : null, dT: c + D / 2 - b.top, dB: c - D / 2 - b.bot, dW: D / 2 - b.w });
      });
      model.wing = wingGeom(model); model.fin = finGeom(model);
      // Rumpfboot: Körper endet am Übergang, dahinter nur die Einschnürung (Leitwerk sitzt am Rohr, nicht am Boot)
      model.boom = boomGeom(model);
      if (model.boom) { model.fin = null; model.x1 = model.boom.xT; model.xe = model.boom.xE; }
      try { model.kh = canopyGeom(model); } catch (e) { console.warn('Rumpf: Kabinenhaube', e); model.kh = null; }
      if (model.fin) { model.xs = Math.min(x0, model.fin.xs); model.xe = Math.max(x1, model.fin.xe); }
      // V-Leitwerk-Stummel (am Rumpf bzw. Rumpfboot; mit Boot nur bis zum Übergang)
      try { model.vt = vtGeom(model); } catch (e) { console.warn('Rumpf: V-Leitwerk', e); model.vt = null; }
      if (model.vt) {
        if (model.boom) { if (model.vt.xT > model.boom.xT) model.vt.warns.push(T('Stummel ragt über den Übergang zum Leitwerksrohr — dahinter abgeschnitten.')); }
        else { model.xs = Math.min(model.xs, model.vt.xLE); model.xe = Math.max(model.xe, model.vt.xT); }
      }
      // Längsabtastung gleichmäßig, dazu exakt an jedem Spant
      const xsList = []; for (let b = 0; b <= Nv; b++) xsList.push(model.xs + (model.xe - model.xs) * b / Nv);
      for (const f of FR) if (f.x > model.xs + 0.05 && f.x < model.xe - 0.05) xsList.push(f.x);
      // Stumpfes Heck, Anbau (Leitwerk) ragt darüber hinaus: Spalte genau am Rumpfende und eine dicht dahinter (ohne Rumpf)
      // -> ebene Stirnfläche statt eines schrägen Trichters bis zur nächsten Spalte
      if (model.xe > model.x1 + 0.1 && lineAt(model.L.w, model.x1) > 0.5) { xsList.push(model.x1, model.x1 + 0.03); }
      // Tragflächenstummel/-ausschnitt: runde Profilnase und Endleiste fein auflösen
      if (model.wing) {
        const g = model.wing, xT = g.xLE + g.chord, add = x => { if (x > model.xs + 0.05 && x < model.xe - 0.05) xsList.push(x); };
        for (let i = 1; i <= 16; i++) { const t = i / 16; add(g.xLE + g.chord * 0.2 * t * t); add(xT - g.chord * 0.08 * t * t); }
        // Anformung: keine Spalte genau an Nase/Endleiste — dort laufen Profil-Ober- und -Unterseite im Spant in einem Punkt
        // zusammen (alle Kappenzeilen deckungsgleich), die Nachbarspalten falteten sich daran
        if (g.mode !== 'fil') { add(g.xLE); add(xT); }
        if (g.mode === 'cut') for (const x of [g.xLE - g.play, xT + g.play]) { add(x - 0.03); add(x + 0.03); }
        else if (g.mode === 'fil') {
          // Anformung: vor der Nase und hinter der Endleiste schleifend geschnitten -> dicht, zur Spitze hin enger
          if (g.fl) {
            const { x0, x1 } = g.fl;
            // Beulen vor der Nase/hinter der Endleiste: an beiden Enden dicht (am Projektionsende flacher Beginn, an
            // Nase/Endleiste steigt der Scheitel wurzelförmig auf zA — Abstand quadratisch, dann steigt er je Spalte gleich)
            for (let i = 1; i < 40; i++) { const t = i / 40, s = (1 - Math.cos(Math.PI * t)) / 2, s4 = 1 - (1 - t) * (1 - t); add(x0 + (g.xLE - x0) * s); add(x1 - (x1 - xT) * s); add(x0 + (g.xLE - x0) * s4); add(x1 - (x1 - xT) * s4); }
            for (let i = 1; i < 32; i++) add(g.xLE + g.chord * i / 32);
            add(x0 + 0.02); add(x1 - 0.02);
            // jenseits der Projektionsenden wachsende Abstände: an der Spitze bündeln sich die Gitterzeilen, ohne nahe
            // Nachbarspalte liefen sie als lange, spitze Dreiecke bis zur nächsten Spalte (Streifen auf dem Rumpf)
            for (const d of [0.08, 0.2, 0.4, 0.7, 1.1, 1.7, 2.5, 3.6, 5]) { add(x0 - d); add(x1 + d); }
          }
        }
        else { add(g.xLE + 0.03); add(xT - 0.03); }
      }
      if (model.vt) {
        const g = model.vt, gw = g.gw, add = x => { if (x > model.xs + 0.05 && x < model.xe - 0.05) xsList.push(x); };
        for (let i = 1; i <= 16; i++) { const t = i / 16; add(g.xLE + g.chord * 0.2 * t * t); add(g.xT - g.chord * 0.08 * t * t); }
        for (let i = 1; i < 24; i++) add(g.xLE + g.chord * i / 24);
        // wie die Tragfläche: Anformung ohne Spalte genau an Nase/Endleiste, dafür dicht an den Beulen; Ausschnitt an den Stirnwänden
        if (gw && gw.mode === 'fil') {
          if (gw.fl) {
            const { x0, x1 } = gw.fl;
            for (let i = 1; i < 40; i++) { const t = i / 40, s2 = (1 - Math.cos(Math.PI * t)) / 2, s4 = 1 - (1 - t) * (1 - t); add(x0 + (g.xLE - x0) * s2); add(x1 - (x1 - g.xT) * s2); add(x0 + (g.xLE - x0) * s4); add(x1 - (x1 - g.xT) * s4); }
            for (let i = 1; i < 32; i++) add(g.xLE + g.chord * i / 32);
            add(x0 + 0.02); add(x1 - 0.02);
            for (const d of [0.08, 0.2, 0.4, 0.7, 1.1, 1.7, 2.5, 3.6, 5]) { add(x0 - d); add(x1 + d); }
          }
        } else if (gw && gw.mode === 'cut') { add(g.xLE); add(g.xT); for (const x of [g.xLE - gw.play, g.xT + gw.play]) { add(x - 0.03); add(x + 0.03); } }
        else { add(g.xLE); add(g.xT); add(g.xLE + 0.03); add(g.xT - 0.03); }
      }
      // Leitwerk mit scharfen Kanten: Ecken des Grundrisses treffen, Bereich fein auflösen; Auflage des Höhenleitwerks
      if (model.fin && model.fin.sharp) {
        const g = model.fin, hl = g.hl, add = x => { if (x > model.xs + 0.05 && x < model.xe - 0.05) xsList.push(x); };
        for (let i = 0; i <= 80; i++) add(g.xs + (g.xe - g.xs) * i / 80);
        for (const x of [g.xLE, g.xPT, g.xT, g.xLE + g.cr]) { add(x - 0.03); add(x + 0.03); }
        if (g.free) for (const p of g.Pn) { add(p[0] - 0.03); add(p[0] + 0.03); }
        // Austritt der Nasenleiste aus dem Rumpfrücken: dahinter die runde Profilnase fein auflösen
        let xJ = g.xLE;
        if (g.tL > 1e-6) {
          const d = x => g.y0 + (x - g.xLE) / g.tL - lineAt(model.L.top, clamp(x, model.x0, model.x1));
          if (d(g.xLE) < 0 && d(g.xPT) > 0) { let lo = g.xLE, hi = g.xPT; for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (d(mid) < 0) lo = mid; else hi = mid; } xJ = hi; }
        }
        // nicht mit Anformung: dort endet die Nasenleiste an der Schnittlinie über dem Rumpf, die Verdichtung läge genau am Fuß
        // der Nasenleiste und machte das Rauschen der Flächenschnitte als Streifenband sichtbar
        if (!g.ff) { for (let i = 0; i <= 20; i++) { const t = i / 20; add(xJ + g.cr * 0.15 * t * t); } add(xJ - 0.03); }
        // Anformung: Fußabdruck dicht, zu den Enden hin enger
        if (g.ff) {
          const { x0, x1, ch } = g.ff; for (let i = 1; i < 40; i++) { const t = i / 40, s = (1 - Math.cos(Math.PI * t)) / 2, s4 = 1 - (1 - t) * (1 - t); add(x0 + (ch[0] - x0) * s); add(x1 - (x1 - ch[1]) * s); add(x0 + (ch[0] - x0) * s4); add(x1 - (x1 - ch[1]) * s4); add(ch[0] + (ch[1] - ch[0]) * t); } add(x0 + 0.02); add(x1 - 0.02);
          // wie die Tragfläche: vor dem Projektionsanfang (und hinter dem Ende) wachsende Abstände — sonst laufen die an der
          // Spitze gebündelten Gitterzeilen als lange, spitze Dreiecke bis zur nächsten Spalte (Streifen auf dem Rumpf)
          for (const d of [0.08, 0.2, 0.4, 0.7, 1.1, 1.7, 2.5, 3.6, 5]) { add(x0 - d); if (!g.rud) add(x1 + d); }
          // Hinter der Nasenleiste wie bei der Tragfläche quadratisch verdichten (die Leitwerksflanke wächst dort aus der Kuppe;
          // ohne das lag die nächste Spalte 2,6 mm dahinter, die Zeilen sprangen von der Kuppe auf die Flanke: verdrehte
          // Dreiecke an der Nase). Die ersten 0,4 mm bleiben frei (siehe unten).
          for (let i = 1; i <= 16; i++) { const t = i / 16; add(ch[0] + 0.2 * (ch[1] - ch[0]) * t * t); }
        }
        if (hl && !hl.cross) {
          const xT = hl.xLE + hl.cr;
          for (let i = 1; i <= 16; i++) { const t = i / 16; add(hl.xLE + hl.cr * 0.2 * t * t); add(xT - hl.cr * 0.08 * t * t); }
          for (const x of [hl.xLE - hl.play, xT + hl.play]) { add(x - 0.03); add(x + 0.03); }
        }
      }
      // Ruder abgetrennt: Ruderebene (Stirnfläche von Leitwerk und Anformung) dicht abtasten, ihre Enden genau treffen
      if (model.fin && model.fin.rud) {
        const g = model.fin, rd = g.rud, add = x => { if (x > model.xs + 0.05 && x < model.xe - 0.05) xsList.push(x); };
        const xa = rd.xh(g.y0), xb = rd.xh(g.yMax), lo = Math.min(xa, xb), hi = Math.max(xa, xb);
        for (let i = 0; i <= 40; i++) add(lo + (hi - lo) * i / 40);
        for (const x of [lo, hi]) { add(x - 0.03); add(x + 0.03); }
        if (g.ff) { const x = g.ff.ch[1]; add(x - 0.03); add(x + 0.03); for (let i = 1; i <= 12; i++) add(x - 0.03 - 0.4 * i * i); }
      }
      // Kreuzleitwerk-Stummel (gepfeilt: Nase/Endleiste wandern mit z): Bereich dicht abtasten — nur zusätzliche Spalten, die
      // Leitwerksform bleibt; feinere Dreiecke geben eine genauere Verschneidungslinie (stubUnion)
      if (model.fin && model.fin.hl && model.fin.hl.cross) {
        const hl = model.fin.hl, add = x => { if (x > model.xs + 0.05 && x < model.xe - 0.05) xsList.push(x); };
        add(hl.xa); add(hl.xb); add(hl.xa + 0.03); add(hl.xb - 0.03); for (let i = 1; i < 32; i++) add(hl.xa + (hl.xb - hl.xa) * i / 32);
        for (let i = 1; i <= 16; i++) { const t = i / 16; add(hl.xa + hl.cr * 0.2 * t * t); add(hl.xb - hl.cr * 0.08 * t * t); }
      }
      // Kabinenhaube: Ecken, Radien und Spline-Punkte der Schnittlinie treffen
      if (model.kh && model.kh.N) { let last = -Infinity; for (const p of model.kh.N.slice().sort((a, b) => a[0] - b[0])) if (p[0] - last > 2 && p[0] > model.xs + 0.05 && p[0] < model.xe - 0.05) { xsList.push(p[0]); last = p[0]; } }
      xsList.sort((a, b) => a - b);
      // Leitwerks-Anformung: keine Spalten in den letzten 0,05 mm vor/hinter der Nasenleiste an der Schnittlinie — dort ist die
      // Leitwerksflanke bzw. die Kuppe nur Bruchteile eines mm hoch, alle Flankenzeilen fallen fast zusammen (kaputte Normalen,
      // dunkle Streifen am Fuß der Nasenleiste). Kosinus-/Quadratteilungen legten Spalten bis 0,007 mm heran.
      // Dafür beidseits in wachsenden Abständen 0,08 … 0,6 mm: der Übergang Kuppe -> Leitwerksflanke liegt sonst in einer
      // 1,3-mm-Lücke (verdrehte Dreiecke). Die fast deckungsgleichen Zeilen dicht an der Nasenleiste fängt meshFromGrid ab
      // (Nachbarn < 0,02 mm werden für die Normale übersprungen). Gemessen: 1 statt 49 Ecken mit > 8° Normalenfehler.
      if (model.fin && model.fin.ff) {
        const c0 = model.fin.ff.ch[0];
        for (let i = xsList.length - 1; i >= 0; i--) if (Math.abs(xsList[i] - c0) < 0.05) xsList.splice(i, 1);
        for (const d of [0.08, 0.14, 0.22, 0.32, 0.45, 0.6]) xsList.push(c0 - d, c0 + d);
        xsList.sort((a, b) => a - b);
      }
      const XS = xsList.filter((x, i) => i === 0 || x - xsList[i - 1] > 0.02);
      // Stirnwände (Ausschnitt vor der Nase / hinter der Endleiste, Stummel an Nase und stumpfer Endleiste) bekommen
      // doppelte Spalten (scharfe Kante)
      if (model.wing) {
        const g = model.wing, xT = g.xLE + g.chord;
        const ed = g.mode === 'cut' ? [g.xLE - g.play - 0.03, g.xLE - g.play + 0.03, xT + g.play - 0.03, xT + g.play + 0.03] : g.mode === 'fil' ? [] : [g.xLE, g.xLE + 0.03, xT - 0.03, xT];
        for (const x of ed) { const i = XS.findIndex(q => Math.abs(q - x) < 1e-6); if (i >= 0) XS.splice(i, 0, XS[i]); }
      }
      if (model.vt) {
        const g = model.vt, gw = g.gw, ed = !gw ? [g.xLE, g.xLE + 0.03, g.xT - 0.03, g.xT] : gw.mode === 'cut' ? [g.xLE - gw.play - 0.03, g.xLE - gw.play + 0.03, g.xT + gw.play - 0.03, g.xT + gw.play + 0.03] : [];
        for (const x of ed) { const i = XS.findIndex(q => Math.abs(q - x) < 1e-6); if (i >= 0) XS.splice(i, 0, XS[i]); }
      }
      // Rumpfboot: Schulter am Übergang als scharfe, senkrechte Stufe (je zwei deckungsgleiche Spalten Boot | Zapfen), dahinter
      // der Zapfen. Die Zapfenspalten liegen 0,01 mm hinter dem Boot: Abnehmer, die über X abtasten (Formenbau colAt),
      // sehen sonst nur eine der beiden Spalten und interpolieren die Stufe zur Schräge bis zur nächsten Zapfenspalte.
      let spg = null;
      if (model.boom) {
        const g = model.boom, keep = XS.filter(x => x < g.xT - 0.05), ns = Math.max(4, Math.ceil(g.Ls / 4)), xS = g.xT + 0.01;
        XS.length = 0; XS.push(...keep, g.xT, g.xT, xS, xS); spg = keep.map(() => 0).concat([0, 0, 1, 1]);
        for (let i = 1; i <= ns; i++) { XS.push(g.xT + (g.xE - g.xT) * i / ns); spg.push(1); }
      }
      const NB = XS.length;
      const rings = []; let K = 0;
      // Gitter ohne Kreuzleitwerk-Stummel: er wird danach per boolescher Vereinigung ans Netz gesetzt (stubUnion)
      model.gridBuild = true;
      try { XS.forEach((x, b) => { const r = spg && spg[b] ? boomHalf(model, x) : halfAt(model, x); rings.push(r); K = Math.max(K, r.length - (r.extra || 0)); }); }
      finally { model.gridBuild = false; }
      K = Math.min(600, Math.max(2 * Nu, K));
      const pw = model.wing || model.vt || (model.fin && model.fin.sharp) ? piecewisePlan(rings, K, (model.wing && model.wing.mode === 'fil') || (model.vt && model.vt.mode === 'fil') || (model.fin && model.fin.ff) ? 0.06 : 0) : null; if (pw) K = pw.K;
      // Krümmungsanteil der Zeilenverteilung nur mit Leitwerks-Anformung (schmale, hohe Kehle mit engem Fuß); die anderen
      // Übergänge bleiben wie bisher
      if (pw && model.fin && model.fin.ff) pw.lam = 2;
      const G = [], TG = []; for (let a = 0; a < K; a++) { G.push(new Array(NB)); TG.push(new Array(NB)); }
      for (let b = 0; b < NB; b++) {
        const P = pw ? resamplePieces(rings[b], pw.cnt, pw.lam) : resampleRing(rings[b], K);
        for (let a = 0; a < K; a++) { G[a][b] = [XS[b], P[a][0], P[a][1] > 0 ? P[a][1] : 0]; TG[a][b] = P[a][2] || 0; }
      }
      // Längskrümmung je Gitterpunkt (in Rumpfrichtung, + = nach außen gewölbt) für die 3D-Analyse
      const KV = [];
      for (let a = 0; a < K; a++) {
        const row = new Array(NB).fill(0);
        for (let b = 1; b + 1 < NB; b++) {
          const p0 = G[a][b - 1], p1 = G[a][b], p2 = G[a][b + 1], e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
          const l1 = Math.hypot(...e1), l2 = Math.hypot(...e2); if (l1 < 1e-9 || l2 < 1e-9) continue;
          const kv = [0, 1, 2].map(c => 2 * (e2[c] / l2 - e1[c] / l1) / (l1 + l2));
          const qa = G[Math.max(0, a - 1)][b], qb = G[Math.min(K - 1, a + 1)][b], dy = qb[1] - qa[1], dz = qb[2] - qa[2], ln = Math.hypot(dy, dz);
          if (ln > 1e-9) row[b] = -(kv[1] * dz - kv[2] * dy) / ln;
        }
        row[0] = row[1]; row[NB - 1] = row[NB - 2]; KV.push(row);
      }
      const CV = model.kh && model.kh.N ? G.map(row => row.map(p => model.kh.sd(p[0], p[1]))) : null;
      // Anformung des Seitenleitwerks: die Merkpunkte Leitwerk/Kehle und Kehle/Rumpf sind per Konstruktion tangential — dort nie
      // eine Kante. Sonst schaltet die 30°-Schwelle (grob abgetasteter Spantschnitt) von Spalte zu Spalte um: dunkle Streifen.
      let smooth = null;
      if (pw && model.fin && model.fin.ff) {
        smooth = new Set(); const end = j => { let s = 0; for (let i = 0; i <= j; i++) s += pw.cnt[i] + 1; return s; };
        for (const j of [1, 2, 3]) { const e = end(j); smooth.add(e - 1); smooth.add(e); }
      }
      let mesh = meshFromGrid(G, { mirror: true, seam: true, tags: TG, kv: KV, cv: CV, crease: !!pw || !!model.boom, smooth });
      if (model.fin && model.fin.hl && model.fin.hl.cross) { try { mesh = stubUnion(mesh, model); } catch (e) { console.warn('Rumpf: Kreuzleitwerk-Stummel', e); } }
      { const all = []; for (const r of KV) for (const v of r) all.push(Math.abs(v)); all.sort((p, q) => p - q); model.kRef = all[Math.floor(all.length * 0.75)] || 1e-3; }
      Object.assign(model, { G, TG, mesh, bounds: meshBounds(mesh), ntri: mesh.ntri, vol: meshVolume(mesh) });
      try { model.wingMesh = wingMesh(model); } catch (e) { console.warn('Rumpf: Tragfläche nicht darstellbar', e); model.wingMesh = null; }
      try { model.hlwMesh = hlwMesh(model); } catch (e) { console.warn('Rumpf: Höhenleitwerk nicht darstellbar', e); model.hlwMesh = null; }
      try { model.rudMesh = rudMesh(model); } catch (e) { console.warn('Rumpf: Ruder nicht darstellbar', e); model.rudMesh = null; }
      try { model.boomMesh = boomMesh(model); } catch (e) { console.warn('Rumpf: Leitwerksrohr nicht darstellbar', e); model.boomMesh = null; }
      try { model.vtBores = vtBoreMeshes(model); } catch (e) { console.warn('Rumpf: Steckungsbohrungen nicht darstellbar', e); model.vtBores = []; }
      // Ansichtsbereich der 2D-Ansichten: inkl. Rohr
      model.vbounds = model.bounds;
      if (model.boomMesh) { const b = meshBounds(model.boomMesh), a = model.bounds; model.vbounds = { mn: a.mn.map((v, k) => Math.min(v, b.mn[k])), mx: a.mx.map((v, k) => Math.max(v, b.mx[k])) }; }
    } catch (e) { console.error(e); model.err = e.message; }
    return model;
  }

  // ---------- Dreiecksnetz -------------------------------------------------------------
  // Aus dem Gitter G[a][b] (a um den Spant, b längs): Lage/geglättete Normale/Herkunft je Gitterpunkt
  // (für WebGL, indiziert), Kantenliste für das Drahtmodell und die flache 9-Werte-Liste je Dreieck
  // (STL, Volumen, Canvas-2D). Normalen aus den Gitter-Ableitungen (du × dv, nach außen); am
  // Symmetrie-Saum (seam) über die Spiegelung, bei geschlossenen Ringen (closedU) umlaufend.
  // mirror: Spiegelung z -> -z als zweite Hälfte (Rumpf) bzw. zweite Tragfläche. Offene Enden werden gedeckelt.
  function meshFromGrid(G, opt) {
    opt = opt || {};
    const K = G.length, Nv = G[0].length, mirror = !!opt.mirror, seam = !!opt.seam, closedU = !!opt.closedU, TG = opt.tags, tagAll = opt.tagAll || 0;
    const sides = mirror ? 2 : 1, nV = K * Nv, pos = [], nrm = [], tag = [], idx = [], lines = [];
    const kvs = [], cvs = [], CVg = opt.cv;   // cv: Abstand zur Haubenlinie (+ = Haube), ohne Haube −1
    const vid = (s, a, b) => s * nV + a * Nv + b;
    // crease: doppelte (deckungsgleiche) Zeilen/Spalten sind Kanten — knickt die Fläche dort um mehr als 30°, nimmt
    // jede Seite nur ihre eigene Richtung (einseitige Ableitung) statt über die Kante zu mitteln.
    const crease = !!opt.crease && !closedU, COSC = Math.cos(30 * Math.PI / 180);
    const eq3 = (p, q) => Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) < 1e-9;
    const oneSided = (p, A, Bq, prevSame, nextSame) => {
      if (prevSame === nextSame) return null;
      const tb = [p[0] - A[0], p[1] - A[1], p[2] - A[2]], tf = [Bq[0] - p[0], Bq[1] - p[1], Bq[2] - p[2]], lb = Math.hypot(tb[0], tb[1], tb[2]), lf = Math.hypot(tf[0], tf[1], tf[2]);
      if (lb < 1e-9 || lf < 1e-9 || tb[0] * tf[0] + tb[1] * tf[1] + tb[2] * tf[2] >= COSC * lb * lf) return null;
      return nextSame ? tb : tf;
    };
    for (let s = 0; s < sides; s++) {
      const sg = s ? -1 : 1;
      for (let a = 0; a < K; a++) for (let b = 0; b < Nv; b++) {
        const p = G[a][b];
        let du;
        // Saum: auch am Ringanfang/-ende zusammengefallene Punkte (leere Abschnitte) bekommen die Saum-Normale
        const sYZ = q => Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) < 1e-9;
        if (seam && (a === 0 || sYZ(G[0][b]))) { let an = Math.min(K - 1, a + 1); while (an < K - 1 && sYZ(G[an][b])) an++; du = [0, 0, 2 * G[an][b][2]]; }
        else if (seam && (a === K - 1 || sYZ(G[K - 1][b]))) { let ap = Math.max(0, a - 1); while (ap > 0 && sYZ(G[ap][b])) ap--; du = [0, 0, -2 * G[ap][b][2]]; }
        else {
          let ap = a > 0 ? a - 1 : (closedU ? K - 2 : 0), an = a < K - 1 ? a + 1 : (closedU ? 1 : K - 1);
          // zusammengefallene Punkte (leere Abschnitte beim abschnittsweisen Abtasten): nächsten verschiedenen Nachbarn nehmen
          const same = q => Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) < 1e-9;
          // Nachbarn für die Richtung: auch fast deckungsgleiche Zeilen (< 0,02 mm) überspringen — wo sich viele Zeilen auf
          // Bruchteile eines mm drängen (Fuß der Leitwerks-Nasenleiste), rauschte die Normale aus winzigen Differenzen
          const near = q => Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) < 0.02;
          if (!closedU) { while (ap > 0 && near(G[ap][b])) ap--; while (an < K - 1 && near(G[an][b])) an++; }
          const A = G[ap][b], Bq = G[an][b]; du = [Bq[0] - A[0], Bq[1] - A[1], Bq[2] - A[2]];
          if (crease && !(opt.smooth && opt.smooth.has(a))) du = oneSided(p, A, Bq, a > 0 && same(G[a - 1][b]), a < K - 1 && same(G[a + 1][b])) || du;
        }
        let bp = Math.max(0, b - 1), bn = Math.min(Nv - 1, b + 1), dv = null;
        if (crease) {
          const ps = b > 0 && eq3(G[a][b - 1], p), ns = b < Nv - 1 && eq3(G[a][b + 1], p);
          while (bp > 0 && eq3(G[a][bp], p)) bp--; while (bn < Nv - 1 && eq3(G[a][bn], p)) bn++;
          dv = oneSided(p, G[a][bp], G[a][bn], ps, ns);
        }
        const Pb = G[a][bp], Pn = G[a][bn]; if (!dv) dv = [Pn[0] - Pb[0], Pn[1] - Pb[1], Pn[2] - Pb[2]];
        let nx = du[1] * dv[2] - du[2] * dv[1], ny = du[2] * dv[0] - du[0] * dv[2], nz = du[0] * dv[1] - du[1] * dv[0];
        const L = Math.hypot(nx, ny, nz);
        if (L > 1e-12) { nx /= L; ny /= L; nz /= L; } else { nx = 0; ny = 0; nz = 1; }
        pos.push(p[0], p[1], sg * p[2]); nrm.push(nx, ny, sg * nz); tag.push(TG ? TG[a][b] : tagAll); kvs.push(opt.kv ? opt.kv[a][b] : 0); cvs.push(CVg ? CVg[a][b] : -1);
      }
      for (let a = 0; a + 1 < K; a++) for (let b = 0; b + 1 < Nv; b++) {
        const i00 = vid(s, a, b), i10 = vid(s, a + 1, b), i01 = vid(s, a, b + 1), i11 = vid(s, a + 1, b + 1);
        // Saum: Dreiecke ganz in der Symmetrieebene (Verbindung getrennter Schnitt-Teile) sind keine Oberfläche
        const zA = seam && G[a][b][2] === 0 && G[a + 1][b + 1][2] === 0, s1 = zA && G[a][b + 1][2] === 0, s2 = zA && G[a + 1][b][2] === 0;
        if (sg > 0) { if (!s1) idx.push(i00, i11, i01); if (!s2) idx.push(i00, i10, i11); } else { if (!s1) idx.push(i00, i01, i11); if (!s2) idx.push(i00, i11, i10); }
      }
      const sb = Math.max(1, Math.round(Nv / 48)), sa = Math.max(1, Math.round(K / 28));
      for (let b = 0; b < Nv; b += sb) for (let a = 0; a + 1 < K; a++) lines.push(vid(s, a, b), vid(s, a + 1, b));
      if ((Nv - 1) % sb) for (let a = 0; a + 1 < K; a++) lines.push(vid(s, a, Nv - 1), vid(s, a + 1, Nv - 1));
      for (let a = 0; a < K; a += sa) for (let b = 0; b + 1 < Nv; b++) lines.push(vid(s, a, b), vid(s, a, b + 1));
    }
    // Deckel: Ring des Endes fächern; Normale = Längsrichtung nach außen (Vorzeichen per Test)
    const cap = (b, dir) => {
      const rings = [];
      if (seam) {
        const r = []; for (let a = 0; a < K; a++) r.push(G[a][b]);
        if (mirror) for (let a = K - 2; a >= 1; a--) { const q = G[a][b]; r.push([q[0], q[1], -q[2]]); }
        rings.push(r);
      } else {
        for (let s = 0; s < sides; s++) { const r = []; for (let a = 0; a < (closedU ? K - 1 : K); a++) { const q = G[a][b]; r.push(s ? [q[0], q[1], -q[2]] : q); } rings.push(r); }
      }
      for (const ring of rings) {
        const n = ring.length; if (n < 3) continue;
        const c = [0, 0, 0]; for (const q of ring) { c[0] += q[0]; c[1] += q[1]; c[2] += q[2]; } c[0] /= n; c[1] /= n; c[2] /= n;
        let ax = 0, ay = 0, az = 0;
        for (let i = 0; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n], e1 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], e2 = [q[0] - c[0], q[1] - c[1], q[2] - c[2]]; ax += e1[1] * e2[2] - e1[2] * e2[1]; ay += e1[2] * e2[0] - e1[0] * e2[2]; az += e1[0] * e2[1] - e1[1] * e2[0]; }
        const A = Math.hypot(ax, ay, az); if (A < 1e-3) continue;
        const flip = (ax * dir[0] + ay * dir[1] + az * dir[2]) < 0, nn = flip ? [-ax / A, -ay / A, -az / A] : [ax / A, ay / A, az / A];
        const base = pos.length / 3, tg = TG ? TG[0][b] : tagAll;
        pos.push(c[0], c[1], c[2]); nrm.push(nn[0], nn[1], nn[2]); tag.push(tg); kvs.push(0); cvs.push(-1);
        for (const q of ring) { pos.push(q[0], q[1], q[2]); nrm.push(nn[0], nn[1], nn[2]); tag.push(tg); kvs.push(0); cvs.push(-1); }
        for (let i = 0; i < n; i++) { const j = (i + 1) % n; if (flip) idx.push(base, base + 1 + j, base + 1 + i); else idx.push(base, base + 1 + i, base + 1 + j); }
      }
    };
    const d0 = [G[0][1][0] - G[0][0][0], G[0][1][1] - G[0][0][1], G[0][1][2] - G[0][0][2]], d1 = [G[0][Nv - 1][0] - G[0][Nv - 2][0], G[0][Nv - 1][1] - G[0][Nv - 2][1], G[0][Nv - 1][2] - G[0][Nv - 2][2]];
    cap(0, [-d0[0], -d0[1], -d0[2]]); cap(Nv - 1, d1);
    // Flache Dreiecksliste (ohne entartete Dreiecke) + Herkunft je Dreieck
    const v = [], ft = [];
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
      if (Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) < 1e-9) continue;
      v.push(pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2], pos[c], pos[c + 1], pos[c + 2]); { let t = Math.max(tag[idx[i]], tag[idx[i + 1]], tag[idx[i + 2]]); if (t === 0 && CVg && cvs[idx[i]] + cvs[idx[i + 1]] + cvs[idx[i + 2]] > 0) t = 4; ft.push(t); }
    }
    return { v: new Float32Array(v), ft: new Uint8Array(ft), pos: new Float32Array(pos), nrm: new Float32Array(nrm), tag: new Float32Array(tag), kv: new Float32Array(kvs), cv: new Float32Array(cvs), idx: new Uint32Array(idx), lines: new Uint32Array(lines), ntri: v.length / 9 };
  }
  function meshBounds(mesh) {
    const v = mesh.v, mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { if (v[i + k] < mn[k]) mn[k] = v[i + k]; if (v[i + k] > mx[k]) mx[k] = v[i + k]; }
    if (!isFinite(mn[0])) return { mn: [0, 0, 0], mx: [1, 1, 1] };
    return { mn, mx };
  }
  function meshVolume(mesh) {
    const v = mesh.v; let s = 0;
    for (let i = 0; i < v.length; i += 9) s += v[i] * (v[i + 4] * v[i + 8] - v[i + 5] * v[i + 7]) - v[i + 1] * (v[i + 3] * v[i + 8] - v[i + 5] * v[i + 6]) + v[i + 2] * (v[i + 3] * v[i + 7] - v[i + 4] * v[i + 6]);
    return Math.abs(s) / 6;
  }

  // ---------- Schnitt X = const (exakt aus der Beschreibung) ------------------------------
  function sectionAt(x) {
    if (!model || !model.G) return [];
    if (x < model.xs - 1e-9 || x > model.xe + 1e-9) return [];
    const P = halfAt(model, x), loop = [];
    for (const q of P) loop.push([x, q[0], Math.max(0, q[1])]);
    for (let k = P.length - 2; k >= 1; k--) loop.push([x, P[k][0], -Math.max(0, P[k][1])]);
    return [loop];
  }
  function loopArea(L) { let a = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; a += p[2] * q[1] - q[2] * p[1]; } return Math.abs(a) / 2; }

  // ---------- Export -----------------------------------------------------------
  function toBinarySTL(verts) {
    const n = Math.floor(verts.length / 9);
    const buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
    const hdr = 'AI Foam Cut Rumpf'; for (let i = 0; i < 80; i++) dv.setUint8(i, i < hdr.length ? hdr.charCodeAt(i) : 0);
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
  function projBase() { return ((state.projectName || 'rpro').replace(/[^\w\-]+/g, '_')) || 'rpro'; }
  function saveFile(name, data, mime, which) {
    if (typeof App.download === 'function') App.download(name, data, mime, which);
    else if (App.anchorDownload) App.anchorDownload(name, data, mime);
  }
  function exportStl() {
    if (!model || !model.mesh) build(); if (!model || !model.mesh) return;
    let v = model.mesh.v;
    if (C('rproUp') === 'z') { const o = new Float32Array(v.length); for (let i = 0; i < v.length; i += 3) { o[i] = v[i]; o[i + 1] = -v[i + 2]; o[i + 2] = v[i + 1]; } v = o; }
    const mn = [Infinity, Infinity, Infinity]; for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) mn[k] = Math.min(mn[k], v[i + k]);
    const o = new Float32Array(v.length); for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) o[i + k] = v[i + k] - mn[k];
    saveFile(projBase() + '_rumpf.stl', toBinarySTL(o), 'model/stl', 'svStl');
  }
  function dxfText(loops) {
    const L = ['0', 'SECTION', '2', 'ENTITIES'];
    for (const lp of loops) {
      L.push('0', 'LWPOLYLINE', '8', 'SPANT', '90', String(lp.length), '70', '1');
      for (const q of lp) L.push('10', q[0].toFixed(4), '20', q[1].toFixed(4));
    }
    L.push('0', 'ENDSEC', '0', 'EOF');
    return L.join('\n');
  }
  function exportSectionDxf() {
    if (!model || !model.mesh) build(); if (!model || !model.mesh) return;
    const x = +C('rproCutX') || 0, loops = sectionAt(x).filter(L => loopArea(L) > 1e-6).map(L => L.map(q => [q[2], q[1]]));
    if (!loops.length) { alert(T('Schnittebene trifft den Rumpf nicht.')); return; }
    saveFile(projBase() + '_spant_x' + Math.round(x) + '.dxf', dxfText(loops), 'application/dxf', 'svDxf');
  }
  function exportAllSectionsDxf() {
    if (!model || !model.mesh) build(); if (!model || !model.mesh) return;
    const all = [];
    let off = 0;
    for (const s of model.FR) {
      const loops = sectionAt(s.x).filter(L => loopArea(L) > 1e-6); if (!loops.length) continue;
      let w = 0; for (const L of loops) for (const q of L) w = Math.max(w, Math.abs(q[2]));
      for (const L of loops) all.push(L.map(q => [q[2] + off + w, q[1]]));
      off += 2 * w + 20;
    }
    if (!all.length) { alert(T('Keine Spanten.')); return; }
    saveFile(projBase() + '_spanten.dxf', dxfText(all), 'application/dxf', 'svDxf');
  }

  // ---------- Formen als STL (DevFus „Export mold to STL") ---------------------------------
  // Halbe Rumpfschale (rechte Hälfte, Trennebene Z = 0), um ext in −Z „aufgesockelt" (Extrusion):
  //   halfShell  geschlossene Halbschale (Trennebene als Deckfläche)
  //   halfPos    Positiv: Halbschale auf einem Block (Rand margin, Blockdicke base unter der Trennebene)
  //   halfNeg    Negativ: Halbschale als Hohlraum in einem Block (Wandstärke base hinter dem tiefsten Punkt)
  // Blockformen als Höhenfeld über das Rumpfgitter (je Längsschnitt ein Ring von Blockkante zu Blockkante),
  // Seiten und Boden über die Randkanten angehängt; Umlaufsinn einheitlich, am Ende per Volumen nach außen.
  // Gitter nur eines Bauteils: part 'kh' = nur Kabinenhaube, 'fus' = Rumpf ohne Haube. Je Spalte (x = const)
  // bleibt der zum Bauteil gehörende Teil des Halbspants stehen; an der Schnittlinie entsteht eine ebene Wand
  // bis zur Trennebene (genauer Schnittpunkt), der Rest fällt auf z = 0 an der Schnittkante zusammen.
  // Die Punktzahl je Spalte bleibt gleich. Nur Haube: Spalten auf den Bereich der Haube beschränkt.
  function partGrid(part) {
    const G = model.G, K = G.length, NB = G[0].length, kh = model.kh, cols = [];
    for (let b = 0; b < NB; b++) {
      const x = G[0][b][0], sp = kh.spans(x), r = G.map(row => [row[b][1], row[b][2]]), yTop = r[0][0];
      const inS = y => sp.some(q => y > q[0] + 1e-9 && y <= q[1] + 1e-6);
      const keep = r.map(q => (part === 'kh') === inS(q[0])), out = r.map((q, a) => keep[a] ? q : null);
      const edges = []; for (const q of sp) { edges.push(q[0]); if (q[1] < yTop - 1e-6) edges.push(q[1]); }
      for (let a = 0; a + 1 < K; a++) if (keep[a] !== keep[a + 1]) {
        const u = r[a], w = r[a + 1]; let yb = null;
        for (const e of edges) if ((e - u[0]) * (e - w[0]) <= 0) yb = e;
        if (yb == null) continue;
        const t = Math.abs(w[0] - u[0]) > 1e-12 ? (yb - u[0]) / (w[0] - u[0]) : 0, zc = u[1] + (w[1] - u[1]) * t;
        const n1 = keep[a] ? a + 1 : a, n2 = n1 + (keep[a] ? 1 : -1);
        out[n1] = [yb, zc];
        if (n2 >= 0 && n2 < K && !keep[n2] && !out[n2]) out[n2] = [yb, 0];
      }
      const any = keep.some(Boolean);
      for (let a = 0; a < K; a++) if (!out[a]) {
        // nächster schon gesetzter Punkt gibt die Höhe der Schnittkante vor
        let y = any ? null : yTop;
        for (let d = 1; d < K && y == null; d++) { const lo = out[a - d], hi = out[a + d]; if (lo && !keep[a - d]) y = lo[0]; else if (hi && !keep[a + d]) y = hi[0]; }
        out[a] = [y == null ? r[a][0] : y, 0];
      }
      cols.push({ x, out, any });
    }
    let b0 = 0, b1 = NB - 1;
    if (part === 'kh') {
      while (b0 < NB - 1 && !cols[b0].any) b0++; while (b1 > 0 && !cols[b1].any) b1--;
      if (b1 <= b0) return null;
      b0 = Math.max(0, b0 - 1); b1 = Math.min(NB - 1, b1 + 1);
      // Randspalten ohne Haube: auf die Oberkante der Nachbarspalte legen (kein Sprung im Block)
      if (!cols[b0].any) cols[b0].out = cols[b0].out.map(() => [cols[b0 + 1].out[0][0], 0]);
      if (!cols[b1].any) cols[b1].out = cols[b1].out.map(() => [cols[b1 - 1].out[0][0], 0]);
    }
    const Gp = [];
    for (let a = 0; a < K; a++) { const row = []; for (let b = b0; b <= b1; b++) row.push([cols[b].x, cols[b].out[a][0], cols[b].out[a][1]]); Gp.push(row); }
    return Gp;
  }
  // Sicke aktiv? → { n Stufen, w Höhe je Stufe (in der Seitenansicht ab der Schnittlinie), d Vertiefung je Stufe }
  function sicke() {
    const k = KH(); if (!k.skOn) return null;
    const n = clamp(Math.round(+k.skN || 1), 1, 6), w = Math.max(0, +k.skW || 0), d = k.skAuto ? sickeAutoDepth() / n : Math.max(0, +k.skD || 0);
    // Schräge der Stufe: Winkel zur Flächennormalen (0 = senkrechte Wand), Rampe höchstens 80 % der Stufenhöhe
    const r = Math.min(0.8 * w, d * Math.tan(clamp(+k.skA || 0, 0, 80) * Math.PI / 180));
    return w > 0.05 && d > 0.01 ? { n, w, d, r: r > 0.02 ? r : 0 } : null;
  }
  /* Rumpf ohne Haube MIT Sicke: der Rand des Ausschnitts läuft als abgesetzte Auflage unter die Haube.
   * Vorgehen wie von ErnstV auf RC-Network beschrieben („Abpausen mit Solid Edge", #33/#51): Offsetfläche der
   * Rumpfhaut um die Haubenstärke nach innen = Auflage, Stufe mit Entformungsschräge.
   * Die Halbschale (Dreiecke des Gitters) wird an den Linien „Abstand zur Schnittlinie = 0, w, 2w, …" (und am
   * Ende jeder Schräge) exakt geteilt; die Tiefe (Versatz nach innen, in der Spantebene senkrecht zur Kontur)
   * steigt je Stufe um d — über die Schräge linear, ohne Schräge als senkrechte Stufenwand. Hinter der
   * letzten Stufe ist der Ausschnitt offen (Wand bis zur Trennebene).
   * Daraus je Formtyp: Block (Rand außen herum, Wände, Boden), geschlossene Halbschale oder ganzer Körper.
   * Liefert die flache Dreiecksliste (9 Werte je Dreieck) wie moldTris. */
  function sickeTris(mc, sk) {
    const G = model.G, K = G.length, NB = G[0].length, kh = model.kh, full = mc.type === 'full' || mc.type === 'disp';
    const ext = full ? 0 : Math.max(0, +mc.ext || 0);
    // Grenzen th[j] (Abstand zur Schnittlinie) und Tiefe je Streifen j am unteren/oberen Ende; letzter Streifen = Ausschnitt
    const th = [], dLo = [0], dHi = [0];
    for (let k = 0; k < sk.n; k++) {
      th.push(k * sk.w);
      if (sk.r > 0) { dLo.push(k * sk.d); dHi.push((k + 1) * sk.d); th.push(k * sk.w + sk.r); }
      dLo.push((k + 1) * sk.d); dHi.push((k + 1) * sk.d);
    }
    th.push(sk.n * sk.w);
    const n = th.length - 1, dTot = sk.n * sk.d;
    // Gitterpunkte: Abstand zur Schnittlinie, Richtung nach innen (in der Spantebene)
    const gid = (a, b) => a * NB + b, GP = new Array(K * NB);
    for (let b = 0; b < NB; b++) for (let a = 0; a < K; a++) {
      const P = G[a][b]; let sd = kh.sd(P[0], P[1]);
      for (const t of th) if (Math.abs(sd - t) < 1e-7) sd = t + 2e-7;
      let iy = 0, iz = 0;
      if (a === 0) iy = -1; else if (a === K - 1) iy = 1;
      else {
        let ap = a - 1, an = a + 1; const same = q => Math.abs(q[1] - P[1]) + Math.abs(q[2] - P[2]) < 1e-9;
        while (ap > 0 && same(G[ap][b])) ap--; while (an < K - 1 && same(G[an][b])) an++;
        const ty = G[an][b][1] - G[ap][b][1], tz = G[an][b][2] - G[ap][b][2], l = Math.hypot(ty, tz);
        if (l > 1e-9) { iy = -tz / l; iz = ty / l; }
      }
      GP[gid(a, b)] = { id: 'v' + gid(a, b), P, I: [iy, iz], s: sd, tag: -1, tg: model.TG ? model.TG[a][b] || 0 : 0 };
    }
    const V = [], vmap = new Map(), tris = [];
    // Lage eines Punkts im Streifen j (j = n+1: offener Ausschnitt, auf die Trennebene gelegt)
    const vid = (pt, j) => {
      let d = dTot;
      if (j <= n) {
        if (pt.tag >= 0) d = pt.tag === j ? dHi[j] : dLo[j];
        else if (j === 0) d = 0;
        else { const t = clamp((pt.s - th[j - 1]) / (th[j] - th[j - 1]), 0, 1); d = dLo[j] + (dHi[j] - dLo[j]) * t; }
      }
      const key = pt.id + '|' + Math.round(d * 1e6) + (j > n ? 'F' : ''); let i = vmap.get(key);
      if (i == null) { i = V.length; V.push([pt.P[0], pt.P[1] + pt.I[0] * d, j > n ? 0 : Math.max(0, pt.P[2] + pt.I[1] * d)]); vmap.set(key, i); }
      return i;
    };
    const cross = new Map();
    const crossPt = (u, w, k) => {
      const lo = u.id < w.id ? u : w, hi = lo === u ? w : u, key = 'e' + lo.id + '_' + hi.id + '_' + k; let c = cross.get(key);
      if (!c) {
        const t = (th[k] - lo.s) / (hi.s - lo.s), L = (p, q) => p + (q - p) * t; let iy = L(lo.I[0], hi.I[0]), iz = L(lo.I[1], hi.I[1]); const l = Math.hypot(iy, iz);
        if (l > 1e-9) { iy /= l; iz /= l; }
        c = { id: key, P: [L(lo.P[0], hi.P[0]), L(lo.P[1], hi.P[1]), L(lo.P[2], hi.P[2])], I: [iy, iz], s: th[k], tag: k }; cross.set(key, c);
      }
      return c;
    };
    // Umlaufsinn der Gitterdreiecke: Oberseite soll nach +z zeigen
    let nzSum = 0, rev = false;
    for (let a = 0; a + 1 < K; a += Math.max(1, K >> 3)) for (let b = 0; b + 1 < NB; b += Math.max(1, NB >> 4)) { const p = G[a][b], q = G[a + 1][b + 1], r = G[a][b + 1]; nzSum += (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); }
    rev = nzSum < 0;
    // g = Streifen (−1 = Stufenwand), t = Herkunft (Rumpf/Leitwerk/Übergang) — nur für die 3D-Anzeige
    const add = (i, j, k, g, t) => { if (i === j || j === k || i === k) return; const tr = rev ? [i, k, j] : [i, j, k]; tr.g = g; tr.t = t; tris.push(tr); };
    const splitTri = (A, B, Cc) => {
      const ring = [], tv = [A, B, Cc], tg = Math.max(A.tg, B.tg, Cc.tg);
      for (let e = 0; e < 3; e++) {
        const u = tv[e], w = tv[(e + 1) % 3]; ring.push(u);
        const ks = []; for (let k = 0; k <= n; k++) if ((th[k] - u.s) * (th[k] - w.s) < 0) ks.push(k);
        if (u.s > w.s) ks.reverse();
        for (const k of ks) ring.push(crossPt(u, w, k));
      }
      for (let j = 0; j <= n + 1; j++) {
        const lo = j === 0 ? -Infinity : th[j - 1], hi = j > n ? Infinity : th[j], poly = ring.filter(q => q.s >= lo && q.s <= hi), m = poly.length;
        if (m < 3) continue;
        if (!(j > n && full)) for (let i = 1; i + 1 < m; i++) add(vid(poly[0], j), vid(poly[i], j), vid(poly[i + 1], j), j, tg);
        if (j < n || (j === n && mc.type !== 'disp')) for (let i = 0; i < m; i++) {   // Stufenwand an der oberen Grenze des Streifens
          const X = poly[i], Y = poly[(i + 1) % m];
          if (X.tag === j && Y.tag === j) { add(vid(Y, j), vid(X, j), vid(X, j + 1), -1, tg); add(vid(Y, j), vid(X, j + 1), vid(Y, j + 1), -1, tg); break; }
        }
      }
    };
    for (let a = 0; a + 1 < K; a++) for (let b = 0; b + 1 < NB; b++) {
      const p00 = GP[gid(a, b)], p10 = GP[gid(a + 1, b)], p01 = GP[gid(a, b + 1)], p11 = GP[gid(a + 1, b + 1)];
      splitTri(p00, p11, p01); splitTri(p00, p10, p11);
    }
    if (ext > 0) for (const q of V) q[2] += ext;
    // offene Ränder (gerichtete Kanten ohne Gegenkante)
    const boundary = () => { const E = new Set(); for (const t of tris) for (let k = 0; k < 3; k++) E.add(t[k] + ',' + t[(k + 1) % 3]); const out = []; for (const t of tris) for (let k = 0; k < 3; k++) { const u = t[k], w = t[(k + 1) % 3]; if (!E.has(w + ',' + u)) out.push([u, w]); } return out; };
    const projTo = z => { const m = new Map(); return i => { if (Math.abs(V[i][2] - z) < 1e-9) return i; let j = m.get(i); if (j == null) { j = V.length; V.push([V[i][0], V[i][1], z]); m.set(i, j); } return j; }; };
    const wallsTo = z => { const pr = projTo(z); for (const [u, w] of boundary()) { const u2 = pr(u), w2 = pr(w); if (u2 === u && w2 === w) continue; tris.push([w, u, u2]); if (w2 !== w) tris.push([w, u2, w2]); } return pr; };
    if (mc.type === 'disp') return { V, tris };   // Anzeige: Ausschnitt bleibt offen
    wallsTo(0);   // Spantenden und (mit Extrusion) der ganze Umriss: senkrecht auf die Trennebene
    const flat = () => { const o = []; for (const t of tris) o.push(...V[t[0]], ...V[t[1]], ...V[t[2]]); return o; };
    if (full) { const o = flat(), m = o.length; for (let i = 0; i < m; i += 9) o.push(o[i], o[i + 1], -o[i + 2], o[i + 6], o[i + 7], -o[i + 8], o[i + 3], o[i + 4], -o[i + 5]); return o; }
    let zb = 0;
    if (mc.type !== 'halfShell') {
      // Block: ebener Rand zwischen Rumpfumriss (Randschleife bei z = 0) und Blockrechteck
      const margin = Math.max(0, +mc.margin || 0), base = Math.max(1, +mc.base || 1);
      let yMin = Infinity, yMax = -Infinity, zMax = 0, xMin = Infinity, xMax = -Infinity;
      for (const q of V) { yMin = Math.min(yMin, q[1]); yMax = Math.max(yMax, q[1]); zMax = Math.max(zMax, q[2]); xMin = Math.min(xMin, q[0]); xMax = Math.max(xMax, q[0]); }
      const yT = yMax + margin, yB = yMin - margin;
      zb = mc.type === 'halfNeg' ? zMax + base : -base;
      const nx = new Map(); for (const [u, w] of boundary()) nx.set(u, w);
      const loops = [], seen = new Set();
      for (const st of nx.keys()) { if (seen.has(st)) continue; const lp = []; let c = st; while (c != null && !seen.has(c)) { seen.add(c); lp.push(c); c = nx.get(c); } if (lp.length > 2) loops.push(lp); }
      const edgeId = new Map(), edgePt = (x, y) => { const key = x + '|' + y; let i = edgeId.get(key); if (i == null) { i = V.length; V.push([x, y, 0]); edgeId.set(key, i); } return i; };
      const EPS = 1e-9;
      for (const lp of loops) {
        const m = lp.length, at = i => lp[((i % m) + m) % m];
        // Punkte gleicher X-Lage über (up = 1) bzw. unter (up = -1) dem Punkt i, in Schleifenrichtung dir
        const run = (i, dir, up) => { const out = []; let c = i; for (let q = 0; q < m; q++) { const a = V[at(c)], b = V[at(c + dir)]; if (Math.abs(b[0] - a[0]) > EPS || (b[1] - a[1]) * up <= EPS) break; c += dir; out.push(at(c)); } return out; };
        for (let i = 0; i < m; i++) {
          const pi = at(i), qi = at(i + 1), p = V[pi], q = V[qi], dx = q[0] - p[0];
          if (Math.abs(dx) <= EPS) continue;
          if (dx < 0) {   // Oberkante: Streifen bis yT
            const R = [pi].concat(run(i, -1, 1), [edgePt(p[0], yT)]), L = [qi].concat(run(i + 1, 1, 1), [edgePt(q[0], yT)]), TQ = L[L.length - 1];
            for (let k = 0; k + 1 < R.length; k++) tris.push([TQ, R[k], R[k + 1]]);
            for (let k = 0; k + 1 < L.length; k++) tris.push([pi, L[k + 1], L[k]]);
          } else {        // Unterkante: Streifen bis yB
            const L = [pi].concat(run(i, -1, -1), [edgePt(p[0], yB)]), R = [qi].concat(run(i + 1, 1, -1), [edgePt(q[0], yB)]), BQ = R[R.length - 1];
            for (let k = 0; k + 1 < R.length; k++) tris.push([pi, R[k + 1], R[k]]);
            for (let k = 0; k + 1 < L.length; k++) tris.push([BQ, L[k], L[k + 1]]);
          }
        }
      }
      if (margin > 0) {   // Blockrand vor der Nase und hinter dem Heck
        const colAt = x => { const ids = []; for (let i = 0; i < V.length; i++) if (Math.abs(V[i][0] - x) <= EPS && Math.abs(V[i][2]) <= EPS) ids.push(i); ids.sort((a, b) => V[b][1] - V[a][1]); const S = [edgePt(x, yT)]; for (const i of ids) if (V[i][1] < V[S[S.length - 1]][1] - EPS && V[i][1] > yB + EPS) S.push(i); S.push(edgePt(x, yB)); return S; };
        const SL = colAt(xMin), A = edgePt(xMin - margin, yT), D = edgePt(xMin - margin, yB);
        for (let k = 0; k + 1 < SL.length; k++) tris.push([A, SL[k + 1], SL[k]]); tris.push([A, D, SL[SL.length - 1]]);
        const SR = colAt(xMax), Cq = edgePt(xMax + margin, yT), E = edgePt(xMax + margin, yB);
        for (let k = 0; k + 1 < SR.length; k++) tris.push([Cq, SR[k], SR[k + 1]]); tris.push([Cq, SR[SR.length - 1], E]);
      }
    }
    // Boden: jede Fläche auf die Bodenebene projiziert (gegenläufig); Flächen in der Bodenebene entfallen
    const top = tris.filter(t => !(Math.abs(V[t[0]][2] - zb) < 1e-9 && Math.abs(V[t[1]][2] - zb) < 1e-9 && Math.abs(V[t[2]][2] - zb) < 1e-9));
    tris.length = 0; for (const t of top) tris.push(t);
    const pr = wallsTo(zb), nTop = top.length;
    for (let i = 0; i < nTop; i++) {
      const t = top[i], a = V[t[0]], b = V[t[1]], c = V[t[2]];
      if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-12) continue;
      tris.push([pr(t[0]), pr(t[2]), pr(t[1])]);
    }
    return flat();
  }
  // Anzeige-Netz „Rumpf mit Sicke, Haube abgenommen": beide Hälften, glatte Normalen je Streifen (Stufenwände
  // und Streifengrenzen bleiben Kanten), Herkunft je Dreieck für die Farben. null, wenn es nichts zu zeigen gibt.
  function sickeMesh() {
    const sk = sicke(); if (!sk || !model || !model.kh || !model.kh.N || !model.G) return null;
    const { V, tris } = sickeTris({ type: 'disp' }, sk);
    const pos = [], nrm = [], tag = [], idx = [], v = [], ft = [], key = new Map();
    for (const sg of [1, -1]) for (let q = 0; q < tris.length; q++) {
      const t = tris[q], a = V[t[0]], b = V[t[1]], c = V[t[2]];
      let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.hypot(nx, ny, nz) < 1e-12) continue;
      nz *= sg;
      const g = t.g == null ? -1 : t.g, tg = t.t || 0, ids = [];
      for (let e = 0; e < 3; e++) {
        const kk = g < 0 ? null : sg + '|' + t[e] + '|' + g + '|' + tg; let i = kk ? key.get(kk) : null;
        if (i == null) { const P = V[t[e]]; i = pos.length / 3; pos.push(P[0], P[1], sg * P[2]); nrm.push(0, 0, 0); tag.push(tg); if (kk) key.set(kk, i); }
        nrm[i * 3] += nx; nrm[i * 3 + 1] += ny; nrm[i * 3 + 2] += nz; ids.push(i);
      }
      if (sg > 0) idx.push(ids[0], ids[1], ids[2]); else idx.push(ids[0], ids[2], ids[1]);
      for (const i of (sg > 0 ? ids : [ids[0], ids[2], ids[1]])) v.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      ft.push(tg);
    }
    for (let i = 0; i < nrm.length; i += 3) { const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1; nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l; }
    const n = pos.length / 3;
    return { v: new Float32Array(v), ft: new Uint8Array(ft), pos: new Float32Array(pos), nrm: new Float32Array(nrm), tag: new Float32Array(tag), kv: new Float32Array(n), cv: new Float32Array(n).fill(-1), idx: new Uint32Array(idx), lines: new Uint32Array(0), ntri: idx.length / 3 };
  }
  // Gesamttiefe der Sicke „automatisch": Haubenstärke, mit Haubenrahmen zusätzlich Rahmenstärke + Spiel —
  // Haube (und Rahmen) liegen dann außen bündig mit dem Rumpf.
  function sickeAutoDepth() {
    const k = KH(), f = FRM(), g = Math.max(0, +k.glass || 0);
    return f.on ? g + Math.max(0.3, +f.t || 0) + Math.max(0, +f.play || 0) : g;
  }
  function FRM() { const k = KH(); if (!k.fr || typeof k.fr !== 'object') k.fr = {}; const d = DEF.rproKh.fr; for (const q in d) if (k.fr[q] === undefined) k.fr[q] = d[q]; return k.fr; }
  /* Haubenrahmen: Band auf der Rumpfhaut ab der Schnittlinie in die Haube hinein (Abstand s in der Seitenansicht,
   * wie die Sicke). Außen liegt er um die Haubenstärke g unter der Rumpfhaut (die Haube wird darauf geklebt und sitzt
   * bündig), innen folgt er auf der Sicke genau deren Stufen — um das Spiel p versetzt (Kanten rücken um p in die
   * Haube, die Auflage liegt um p höher, wie das Hauben-Urmodell im Rumpf Formenbau). Hinter der letzten Stufe
   * hat er die eingestellte Stärke t. Er beginnt erst, wo er mindestens MIN stark ist.
   * -> { th Grenzen, eLo/eHi Innentiefe je Streifen, g, t, p, H, s0, warn[] } | { err } | null */
  function frameSpec() {
    const k = KH(), f = FRM(); if (!f.on || !model || !model.kh || !model.kh.N || !model.G) return null;
    const g = Math.max(0, +k.glass || 0), t = Math.max(0.3, +f.t || 0), p = Math.max(0, +f.play || 0), H = Math.max(0.5, +f.h || 0), sk = sicke(), MIN = 0.2, warn = [];
    // Stufen der Sicke wie in sickeTris: Grenzen thS, Tiefe je Streifen j am unteren/oberen Ende
    const thS = [], dLo = [0], dHi = [0];
    if (sk) {
      for (let q = 0; q < sk.n; q++) {
        thS.push(q * sk.w);
        if (sk.r > 0) { dLo.push(q * sk.d); dHi.push((q + 1) * sk.d); thS.push(q * sk.w + sk.r); }
        dLo.push((q + 1) * sk.d); dHi.push((q + 1) * sk.d);
      }
      thS.push(sk.n * sk.w);
    }
    // Innentiefe des Rahmens bei s (Tiefe = Abstand nach innen, senkrecht zur Rumpfhaut in der Spantebene)
    const Df = s => {
      if (!sk) return g + t;
      const u = s - p; if (u <= 0) return -p;
      for (let j = 1; j < thS.length; j++) if (u <= thS[j]) { const a = thS[j - 1], b = thS[j]; return dLo[j] + (dHi[j] - dLo[j]) * (b > a ? (u - a) / (b - a) : 1) - p; }
      return g + t;
    };
    const bp = sk ? thS.map(x => x + p) : [];
    let s0 = 0;
    if (sk) {
      s0 = null;
      const cand = [p].concat(bp.filter(x => x > p + 1e-9)), E = 1e-6;
      for (let i = 0; i < cand.length && s0 == null; i++) {
        const a = cand[i], b = i + 1 < cand.length ? cand[i + 1] : a + 1, lo = Df(a + E), hi = Df(b - E);
        if (lo - g >= MIN) s0 = a;
        else if (i + 1 < cand.length && hi - g >= MIN) s0 = a + (b - a) * (g + MIN - lo) / (hi - lo);
      }
      if (s0 == null) s0 = bp[bp.length - 1];
    }
    if (!(H - s0 > 0.3)) return { err: T('Haubenrahmen: Höhe zu klein — der Rahmen beginnt erst bei') + ' ' + s0.toFixed(1) + ' mm.' };
    const th = [s0]; for (const x of bp) if (x > s0 + 1e-4 && x < H - 1e-4) th.push(x); th.push(H);
    const eLo = [0], eHi = [0], E = 1e-7;
    for (let j = 1; j < th.length; j++) { eLo.push(Df(th[j - 1] + E)); eHi.push(Df(th[j] - E)); }
    if (!sk) warn.push(T('Ohne Sicke liegt der Rahmen nicht auf dem Rumpf auf — Sicke einschalten (Vertiefung automatisch).'));
    else {
      if (sk.n * sk.w + p > H) warn.push(T('Der Rahmen ist niedriger als die Sicke — er deckt nur einen Teil der Auflage ab.'));
      if (sk.n * sk.d - p < g + t - 0.01) warn.push(T('Die Sicke ist flacher als Haubenstärke + Rahmenstärke + Spiel — auf der Auflage ist der Rahmen nur') + ' ' + Math.max(0, sk.n * sk.d - p - g).toFixed(2) + ' ' + T('mm stark (Vertiefung automatisch einschalten).'));
    }
    return { th, eLo, eHi, g, t, p, H, s0, warn };
  }
  /* Geschlossener Körper des Rahmens (beide Hälften) aus denselben Gitterdreiecken wie die Sicke (sickeTris):
   * an den Grenzen th exakt geteilt, Außenlage um g versetzt, Innenlage je Streifen eLo..eHi mit Stufenwänden,
   * Ränder als Wände bis zur Innenlage; Flächen in der Symmetrieebene entfallen nach dem Spiegeln (dort stoßen
   * die Hälften aneinander). -> Float32Array (9 Werte je Dreieck) | null */
  function frameTris(F) {
    const G = model.G, K = G.length, NB = G[0].length, kh = model.kh, th = F.th, n = th.length - 1;
    const gid = (a, b) => a * NB + b, GP = new Array(K * NB);
    for (let b = 0; b < NB; b++) for (let a = 0; a < K; a++) {
      const P = G[a][b]; let sd = kh.sd(P[0], P[1]);
      for (const t of th) if (Math.abs(sd - t) < 1e-7) sd = t + 2e-7;
      let iy = 0, iz = 0;
      if (a === 0) iy = -1; else if (a === K - 1) iy = 1;
      else {
        let ap = a - 1, an = a + 1; const same = q => Math.abs(q[1] - P[1]) + Math.abs(q[2] - P[2]) < 1e-9;
        while (ap > 0 && same(G[ap][b])) ap--; while (an < K - 1 && same(G[an][b])) an++;
        const ty = G[an][b][1] - G[ap][b][1], tz = G[an][b][2] - G[ap][b][2], l = Math.hypot(ty, tz);
        if (l > 1e-9) { iy = -tz / l; iz = ty / l; }
      }
      GP[gid(a, b)] = { id: 'v' + gid(a, b), P, I: [iy, iz], s: sd, tag: -1 };
    }
    const V = [], vmap = new Map(), tris = [];
    const put = (pt, d, key) => { let i = vmap.get(key); if (i == null) { i = V.length; V.push([pt.P[0], pt.P[1] + pt.I[0] * d, Math.max(0, pt.P[2] + pt.I[1] * d)]); vmap.set(key, i); } return i; };
    const vo = pt => put(pt, F.g, pt.id + '|o');
    const vi = (pt, j) => {
      const d = pt.tag >= 0 ? (pt.tag === j ? F.eHi[j] : F.eLo[j]) : F.eLo[j] + (F.eHi[j] - F.eLo[j]) * clamp((pt.s - th[j - 1]) / (th[j] - th[j - 1]), 0, 1);
      return put(pt, d, pt.id + '|i' + Math.round(d * 1e6));
    };
    const cross = new Map();
    const crossPt = (u, w, k) => {
      const lo = u.id < w.id ? u : w, hi = lo === u ? w : u, key = 'e' + lo.id + '_' + hi.id + '_' + k; let c = cross.get(key);
      if (!c) {
        const t = (th[k] - lo.s) / (hi.s - lo.s), L = (p, q) => p + (q - p) * t; let iy = L(lo.I[0], hi.I[0]), iz = L(lo.I[1], hi.I[1]); const l = Math.hypot(iy, iz);
        if (l > 1e-9) { iy /= l; iz /= l; }
        c = { id: key, P: [L(lo.P[0], hi.P[0]), L(lo.P[1], hi.P[1]), L(lo.P[2], hi.P[2])], I: [iy, iz], s: th[k], tag: k }; cross.set(key, c);
      }
      return c;
    };
    let nzSum = 0;
    for (let a = 0; a + 1 < K; a += Math.max(1, K >> 3)) for (let b = 0; b + 1 < NB; b += Math.max(1, NB >> 4)) { const p = G[a][b], q = G[a + 1][b + 1], r = G[a][b + 1]; nzSum += (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); }
    const rev = nzSum < 0, outerE = new Map();
    const add = (i, j, k) => { if (i === j || j === k || i === k) return null; const tr = rev ? [i, k, j] : [i, j, k]; tris.push(tr); return tr; };
    const addR = (i, j, k) => add(i, k, j);
    const splitTri = (A, B, Cc) => {
      const ring = [], tv = [A, B, Cc];
      for (let e = 0; e < 3; e++) {
        const u = tv[e], w = tv[(e + 1) % 3]; ring.push(u);
        const ks = []; for (let k = 0; k <= n; k++) if ((th[k] - u.s) * (th[k] - w.s) < 0) ks.push(k);
        if (u.s > w.s) ks.reverse();
        for (const k of ks) ring.push(crossPt(u, w, k));
      }
      for (let j = 1; j <= n; j++) {
        const poly = ring.filter(q => q.s >= th[j - 1] && q.s <= th[j]), m = poly.length;
        if (m < 3) continue;
        for (let i = 1; i + 1 < m; i++) {
          const tr = add(vo(poly[0]), vo(poly[i]), vo(poly[i + 1]));
          if (tr) { const pts = rev ? [poly[0], poly[i + 1], poly[i]] : [poly[0], poly[i], poly[i + 1]]; for (let e = 0; e < 3; e++) outerE.set(tr[e] + ',' + tr[(e + 1) % 3], { A: pts[e], B: pts[(e + 1) % 3], j }); }
          addR(vi(poly[0], j), vi(poly[i], j), vi(poly[i + 1], j));
        }
        if (j < n) for (let i = 0; i < m; i++) {   // Stufenwand der Innenlage an der oberen Grenze des Streifens
          const X = poly[i], Y = poly[(i + 1) % m];
          if (X.tag === j && Y.tag === j) { addR(vi(Y, j), vi(X, j), vi(X, j + 1)); addR(vi(Y, j), vi(X, j + 1), vi(Y, j + 1)); break; }
        }
      }
    };
    for (let a = 0; a + 1 < K; a++) for (let b = 0; b + 1 < NB; b++) {
      const p00 = GP[gid(a, b)], p10 = GP[gid(a + 1, b)], p01 = GP[gid(a, b + 1)], p11 = GP[gid(a + 1, b + 1)];
      if (Math.max(p00.s, p10.s, p01.s, p11.s) < th[0] || Math.min(p00.s, p10.s, p01.s, p11.s) > th[n]) continue;
      splitTri(p00, p11, p01); splitTri(p00, p10, p11);
    }
    if (!tris.length) return null;
    // Wände an allen Rändern der Außenlage (Rahmenkanten, Symmetrieebene) bis zur Innenlage
    const edges = () => { const E = new Set(); for (const t of tris) for (let k = 0; k < 3; k++) E.add(t[k] + ',' + t[(k + 1) % 3]); return E; };
    let E = edges();
    for (const [key, o] of outerE) {
      const ab = key.split(','), a = +ab[0], b = +ab[1]; if (E.has(b + ',' + a)) continue;
      const ai = vi(o.A, o.j), bi = vi(o.B, o.j);
      if (ai !== a) tris.push([b, a, ai]);
      if (bi !== b && ai !== bi) tris.push([b, ai, bi]);
    }
    // Restlöcher (Ecken, wo Randwand und Stufenwand zusammentreffen) als Fächer schließen
    E = edges(); const nx = new Map();
    for (const t of tris) for (let k = 0; k < 3; k++) { const u = t[k], w = t[(k + 1) % 3]; if (!E.has(w + ',' + u)) nx.set(w, u); }
    const seen = new Set();
    for (const st of nx.keys()) {
      if (seen.has(st)) continue; const lp = []; let c = st;
      while (c != null && !seen.has(c)) { seen.add(c); lp.push(c); c = nx.get(c); }
      if (lp.length >= 3 && c === st) for (let i = 1; i + 1 < lp.length; i++) tris.push([lp[0], lp[i], lp[i + 1]]);
    }
    const o = [], Z = 1e-7;
    for (const t of tris) {
      const a = V[t[0]], b = V[t[1]], c = V[t[2]];
      if (Math.abs(a[2]) < Z && Math.abs(b[2]) < Z && Math.abs(c[2]) < Z) continue;   // Symmetrieebene: nach dem Spiegeln innen
      o.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      o.push(a[0], a[1], -a[2], c[0], c[1], -c[2], b[0], b[1], -b[2]);
    }
    return new Float32Array(o);
  }
  // Rahmen je Modell einmal: { spec, v } | { err } | null
  function frameGeo() {
    if (!model) return null;
    if (model.frGeo !== undefined) return model.frGeo;
    let r = null;
    try { const F = frameSpec(); if (F && F.err) r = { err: F.err }; else if (F) { const v = frameTris(F); r = v ? { spec: F, v } : { err: T('Haubenrahmen: keine Fläche im Bereich des Rahmens.') }; } }
    catch (e) { console.warn('Rumpf: Haubenrahmen', e); r = { err: T('Haubenrahmen: ') + (e && e.message ? e.message : e) }; }
    model.frGeo = r; return r;
  }
  // Anzeige-Netz des Rahmens (Tag 7): Normalen über gleiche Punkte gemittelt, an Kanten > 35° getrennt
  function frameMesh() {
    const fg = frameGeo(); if (!fg || !fg.v) return null;
    const v = fg.v, nt = v.length / 9, fn = new Float32Array(nt * 3), acc = new Map(), kOf = i => Math.round(v[i] * 1e4) + ',' + Math.round(v[i + 1] * 1e4) + ',' + Math.round(v[i + 2] * 1e4);
    for (let t = 0; t < nt; t++) {
      const i = t * 9, ux = v[i + 3] - v[i], uy = v[i + 4] - v[i + 1], uz = v[i + 5] - v[i + 2], wx = v[i + 6] - v[i], wy = v[i + 7] - v[i + 1], wz = v[i + 8] - v[i + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz) || 1;
      fn[t * 3] = nx / l; fn[t * 3 + 1] = ny / l; fn[t * 3 + 2] = nz / l;
      for (let e = 0; e < 3; e++) { const k = kOf(i + e * 3); let a = acc.get(k); if (!a) { a = []; acc.set(k, a); } a.push(t); }
    }
    const pos = new Float32Array(nt * 9), nrm = new Float32Array(nt * 9), idx = new Uint32Array(nt * 3), ca = Math.cos(35 * Math.PI / 180);
    for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
      const i = t * 9 + e * 3, f0 = fn[t * 3], f1 = fn[t * 3 + 1], f2 = fn[t * 3 + 2]; let sx = 0, sy = 0, sz = 0;
      for (const q of acc.get(kOf(i))) { const d = fn[q * 3] * f0 + fn[q * 3 + 1] * f1 + fn[q * 3 + 2] * f2; if (d > ca) { sx += fn[q * 3]; sy += fn[q * 3 + 1]; sz += fn[q * 3 + 2]; } }
      const l = Math.hypot(sx, sy, sz) || 1;
      pos[i] = v[i]; pos[i + 1] = v[i + 1]; pos[i + 2] = v[i + 2]; nrm[i] = sx / l; nrm[i + 1] = sy / l; nrm[i + 2] = sz / l; idx[t * 3 + e] = t * 3 + e;
    }
    const nv = nt * 3;
    return { v, ft: new Uint8Array(nt).fill(7), pos, nrm, tag: new Float32Array(nv).fill(7), kv: new Float32Array(nv), cv: new Float32Array(nv).fill(-1), idx, lines: new Uint32Array(0), ntri: nt };
  }
  // Für den Reiter „Cockpit" (Pilz am Haubenrahmen) und andere Module: Maße + Körper des Rahmens
  function frameApi() {
    const f = FRM(); if (!f.on) return null;
    const k = KH();
    return {
      h: Math.max(0.5, +f.h || 0), t: Math.max(0.3, +f.t || 0), glass: Math.max(0, +k.glass || 0), play: Math.max(0, +f.play || 0),
      mesh: () => { const fg = frameGeo(); return fg && fg.v ? fg.v : null; },
      err: () => { const fg = frameGeo(); return fg && fg.err ? fg.err : null; },
      s0: () => { const fg = frameGeo(); return fg && fg.spec ? fg.spec.s0 : 0; }   // Beginn des Rahmens ab der Schnittlinie
    };
  }
  function exportFrameStl() {
    if (!model || !model.mesh) build(); const fg = frameGeo();
    if (!fg || !fg.v) { alert(fg && fg.err ? fg.err : T('Haubenrahmen ist nicht eingeschaltet.')); return; }
    let v = fg.v;
    if (C('rproUp') === 'z') { const o = new Float32Array(v.length); for (let i = 0; i < v.length; i += 3) { o[i] = v[i]; o[i + 1] = -v[i + 2]; o[i + 2] = v[i + 1]; } v = o; }
    const mn = [Infinity, Infinity, Infinity]; for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) mn[k] = Math.min(mn[k], v[i + k]);
    const o = new Float32Array(v.length); for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) o[i + k] = v[i + k] - mn[k];
    saveFile(projBase() + '_haubenrahmen.stl', toBinarySTL(o), 'model/stl', 'svStl');
  }
  function moldPart() { const mc = C('rproMold'); return model && model.kh && model.kh.N && (mc.part === 'fus' || mc.part === 'kh') ? mc.part : 'all'; }
  function moldTris(mc, G) {
    G = G || model.G;
    const K = G.length, NB = G[0].length, ext = Math.max(0, +mc.ext || 0), out = [];
    if (mc.type === 'halfShell') {
      const Gs = [];
      for (let a = 0; a < K + 3; a++) Gs.push(new Array(NB));
      for (let b = 0; b < NB; b++) {
        const t = G[0][b], u = G[K - 1][b];
        Gs[0][b] = [t[0], t[1], -ext];
        for (let a = 0; a < K; a++) Gs[a + 1][b] = [G[a][b][0], G[a][b][1], G[a][b][2]];
        Gs[K + 1][b] = [u[0], u[1], -ext]; Gs[K + 2][b] = Gs[0][b].slice();
      }
      return Array.from(meshFromGrid(Gs, { closedU: true }).v);
    }
    const margin = Math.max(0, +mc.margin || 0), base = Math.max(1, +mc.base || 1);
    let yMin = Infinity, yMax = -Infinity, zMax = 0;
    for (let a = 0; a < K; a++) for (let b = 0; b < NB; b++) { const p = G[a][b]; yMin = Math.min(yMin, p[1]); yMax = Math.max(yMax, p[1]); zMax = Math.max(zMax, p[2]); }
    const yT = yMax + margin, yB = yMin - margin, x0 = G[0][0][0], x1 = G[0][NB - 1][0];
    // Ring je Spalte: Blockkante oben, Rumpf (mit Extrusion um ext nach oben versetzt), Blockkante unten; alles z >= 0
    const col = b => { const r = [[yT, 0], [G[0][b][1], 0]]; for (let a = 0; a < K; a++) r.push([G[a][b][1], G[a][b][2] + ext]); r.push([G[K - 1][b][1], 0], [yB, 0]); return r; };
    const flat = r => r.map(q => [q[0], 0]);
    const cols = [], xs = [];
    const first = col(0), last = col(NB - 1);
    if (margin > 0) { cols.push(flat(first)); xs.push(x0 - margin); }
    cols.push(flat(first)); xs.push(x0);
    for (let b = 0; b < NB; b++) { cols.push(col(b)); xs.push(G[0][b][0]); }
    cols.push(flat(last)); xs.push(x1);
    if (margin > 0) { cols.push(flat(last)); xs.push(x1 + margin); }
    const nA = cols[0].length, nC = cols.length, V = [], id = (a, c) => a * nC + c;
    for (let a = 0; a < nA; a++) for (let c = 0; c < nC; c++) V.push([xs[c], cols[c][a][0], cols[c][a][1]]);
    const tris = [], dir = new Map(), ek = (s, t) => s + ',' + t;
    const addT = (p, q, r) => { tris.push([p, q, r]); dir.set(ek(p, q), 1); dir.set(ek(q, r), 1); dir.set(ek(r, p), 1); };
    for (let a = 0; a + 1 < nA; a++) for (let c = 0; c + 1 < nC; c++) { addT(id(a, c), id(a + 1, c), id(a + 1, c + 1)); addT(id(a, c), id(a + 1, c + 1), id(a, c + 1)); }
    // Rand der Fläche (Umlauf) -> Seitenwände bis zur Blockebene zb und Blockboden
    const zb = mc.type === 'halfNeg' ? zMax + ext + base : -base, loop = [];
    for (let c = 0; c < nC; c++) loop.push(id(0, c));
    for (let a = 1; a < nA; a++) loop.push(id(a, nC - 1));
    for (let c = nC - 2; c >= 0; c--) loop.push(id(nA - 1, c));
    for (let a = nA - 2; a >= 1; a--) loop.push(id(a, 0));
    const P = {}; const proj = v => { if (P[v] == null) { P[v] = V.length; V.push([V[v][0], V[v][1], zb]); } return P[v]; };
    const cx = (xs[0] + xs[nC - 1]) / 2, cy = (yT + yB) / 2, ci = V.length; V.push([cx, cy, zb]);
    for (let k = 0; k < loop.length; k++) {
      const u = loop[k], v = loop[(k + 1) % loop.length];
      const [s, t] = dir.has(ek(u, v)) ? [u, v] : [v, u];
      const s2 = proj(s), t2 = proj(t);
      tris.push([t, s, s2], [t, s2, t2], [ci, t2, s2]);
    }
    for (const [p, q, r] of tris) out.push(...V[p], ...V[q], ...V[r]);
    return out;
  }
  function exportMold() {
    if (!model || !model.mesh) build(); if (!model || !model.mesh) return;
    const mc = C('rproMold');
    const part = moldPart(), sk = part === 'fus' ? sicke() : null, Gp = part === 'all' ? model.G : sk ? model.G : partGrid(part);
    if (!Gp) { alert(T('Die Kabinenhaube ist leer — Ausschnitt prüfen.')); return; }
    let v = sk ? sickeTris(mc, sk) : mc.type === 'full' ? Array.from(part === 'all' ? model.mesh.v : meshFromGrid(Gp, { mirror: true, seam: true }).v) : moldTris(mc, Gp);
    // entartete Dreiecke weg, Umlaufsinn nach außen (Volumen positiv), linke Hälfte = gespiegelt (Y)
    const o = [];
    for (let i = 0; i < v.length; i += 9) {
      const e1 = [v[i + 3] - v[i], v[i + 4] - v[i + 1], v[i + 5] - v[i + 2]], e2 = [v[i + 6] - v[i], v[i + 7] - v[i + 1], v[i + 8] - v[i + 2]];
      if (Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) < 1e-9) continue;
      for (let k = 0; k < 9; k++) o.push(v[i + k]);
    }
    let vol = 0; for (let i = 0; i < o.length; i += 9) vol += o[i] * (o[i + 4] * o[i + 8] - o[i + 5] * o[i + 7]) - o[i + 1] * (o[i + 3] * o[i + 8] - o[i + 5] * o[i + 6]) + o[i + 2] * (o[i + 3] * o[i + 7] - o[i + 4] * o[i + 6]);
    let flip = vol < 0;
    if (mc.type !== 'full' && mc.side === 'l') { for (let i = 1; i < o.length; i += 3) o[i] = -o[i]; flip = !flip; }
    if (flip) for (let i = 0; i < o.length; i += 9) for (let k = 0; k < 3; k++) { const t = o[i + 3 + k]; o[i + 3 + k] = o[i + 6 + k]; o[i + 6 + k] = t; }
    let arr = new Float32Array(o);
    if (mc.type === 'full' && C('rproUp') === 'z') { const r = new Float32Array(arr.length); for (let i = 0; i < arr.length; i += 3) { r[i] = arr[i]; r[i + 1] = -arr[i + 2]; r[i + 2] = arr[i + 1]; } arr = r; }
    const mn = [Infinity, Infinity, Infinity]; for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) mn[k] = Math.min(mn[k], arr[i + k]);
    for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) arr[i + k] -= mn[k];
    const nm = { full: 'rumpf', halfShell: 'halbschale', halfPos: 'form_positiv', halfNeg: 'form_negativ' }[mc.type] || 'form';
    const pn = { all: '', fus: sk ? '_ohne_haube_sicke' : '_ohne_haube', kh: '_haube' }[part];
    saveFile(projBase() + '_' + nm + pn + (mc.type !== 'full' ? '_' + (mc.side === 'l' ? 'links' : 'rechts') : '') + '.stl', toBinarySTL(arr), 'model/stl', 'svStl');
  }

  // ---------- Vorschau ---------------------------------------------------------------
  let canvas = null, ctx = null, W = 0, H = 0;
  let cam = { yaw: 0.75, pitch: 0.5, zoom: 1, px: 0, py: 0 };   // schräg von vorne oben (Betrachter bei +z, wie der Ansichtswürfel)
  const CAM0 = Object.assign({}, cam);
  // cam2.sec leitet bei eigener Spantansicht auf f.view um (Zoom/Verschiebung je Spant, im Projekt gespeichert).
  const cam2 = new Proxy({ side: { zoom: 1, px: 0, py: 0 }, top: { zoom: 1, px: 0, py: 0 }, sec: { zoom: 1, px: 0, py: 0 }, cut: { zoom: 1, px: 0, py: 0 } }, {
    get(t, k) { if (k === 'sec') { const f = ownFr(); if (f) return f.view || (f.view = Object.assign({}, t.sec)); } return t[k]; },
    set(t, k, v) { if (k === 'sec') { const f = ownFr(); if (f) { f.view = v; return true; } } t[k] = v; return true; }
  });
  let center = [0, 0, 0], radius = 100;
  let pivot = null;            // eigener Drehpunkt (Mausrad-Doppelklick), sonst Modellmitte
  let lastMeshes = [], lastCut = null;   // zuletzt in 3D gezeigte Netze + Schnitt (für die Trefferprüfung)
  let dragging = false, dragMode = '', lastX = 0, lastY = 0, bound = false, hot = null, dragH = null, dragCtrl = false;
  const LIGHT = (() => { const l = [-0.35, 0.55, 0.75]; const n = Math.hypot(...l); return l.map(x => x / n); })();
  // Hintergrundbilder. Gemeinsame Bilder (Seiten-, Drauf-, Spantansicht) liegen im Projekt als state.cfg.rproImgSrc[kind]
  // (Data-URL; Fotos JPEG, Linienbilder PNG, höchstens 3000 px) und im RAM als daraus gebautes Bild. img.sec leitet bei
  // eigener Spantansicht auf das Bild des Spants um: im RAM ein Canvas (WeakMap je Spant), im Projekt f.bgSrc (JPEG, 2000 px).
  // Beim Setzen wird zuerst verkleinert und dieses Bild benutzt -> Bildpixel-Angaben (Basispunkt, Referenz, Zuschnitt) bleiben gültig.
  const ownImg = new WeakMap(), shared = {};   // shared[kind] = { src, im }
  const img = new Proxy({}, {
    get(t, k) { if (k === 'sec') { const f = ownFr(); if (f) return frImg(f); } return sharedImg(k); },
    set(t, k, v) { if (k === 'sec') { const f = ownFr(); if (f) { setFrImg(f, v); return true; } } setShared(k, v, !!(v && v.__png)); return true; }
  });
  function sharedImg(k) {
    const src = state.cfg.rproImgSrc && state.cfg.rproImgSrc[k], e = shared[k];
    if (!src) return e && e.ram ? e.im : null;   // ließ sich nicht als Data-URL speichern: nur RAM
    if (!e || e.src !== src) {
      const im = new Image(); shared[k] = { src, im };
      im.onload = () => { if (state.activeTab === 'rpro') { buildSidebar(); draw(); } };
      im.src = src; return null;
    }
    const im = e.im; return im instanceof HTMLCanvasElement || (im.complete && im.naturalWidth > 0) ? im : null;
  }
  function setShared(k, im, png) {
    const S0 = state.cfg.rproImgSrc = (state.cfg.rproImgSrc && typeof state.cfg.rproImgSrc === 'object') ? state.cfg.rproImgSrc : {};
    if (state.cfg.rproImgVec && state.cfg.rproImgVec[k]) delete state.cfg.rproImgVec[k];   // neues Bild: mitgegebene Konturen gelten nicht mehr
    if (!im) { delete S0[k]; delete shared[k]; return; }
    const w0 = im.naturalWidth || im.width, h0 = im.naturalHeight || im.height, q = Math.min(1, 3000 / Math.max(w0, h0, 1));
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w0 * q)); cv.height = Math.max(1, Math.round(h0 * q));
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height);
    let src = null; try { src = cv.toDataURL(png ? 'image/png' : 'image/jpeg', 0.88); } catch (e) { src = null; }
    if (src) { S0[k] = src; shared[k] = { src, im: cv }; } else { delete S0[k]; shared[k] = { ram: true, im: cv }; }
  }
  function frImg(f) {
    let im = ownImg.get(f);
    if (!im && f.bgSrc) {
      im = new Image(); ownImg.set(f, im);
      im.onload = () => { if (state.activeTab === 'rpro') { buildSidebar(); draw(); } };
      im.src = f.bgSrc;
    }
    return im && im.width > 0 && (im instanceof HTMLCanvasElement || (im.complete && im.naturalWidth > 0)) ? im : null;
  }
  // Bild des Spants setzen: verkleinert (Bildpixel-Angaben wie Basispunkt/Zuschnitt beziehen sich auf diese Größe).
  function setFrImg(f, im) {
    if (!im) { ownImg.delete(f); delete f.bgSrc; return; }
    const w0 = im.naturalWidth || im.width, h0 = im.naturalHeight || im.height, k = Math.min(1, 2000 / Math.max(w0, h0, 1));
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w0 * k)); cv.height = Math.max(1, Math.round(h0 * k));
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height);
    ownImg.set(f, cv);
    try { f.bgSrc = cv.toDataURL('image/jpeg', 0.85); } catch (e) { delete f.bgSrc; }
  }
  // Hintergrundbild von außen (Schnitt/Ansicht aus der 3D-Bearbeitung): kind 'side' | 'top' | 'sec', cv = Canvas,
  // place = { len (Bildbreite mm), x, y (Weltlage der linken oberen Ecke) }. frameX: der Spant dort (±5 mm) bekommt das
  // Bild als eigene Spantansicht; sonst gemeinsames Bild der Ansicht (beides im Projekt gespeichert).
  // vec = { parts: [{ name, loops: [[[u, v], …]] }] }: Konturen des Bilds als Linien (Bildanteile 0…1, wandern mit dem Bild) —
  // Nachzeichnen nimmt dann diese statt der Pixel (cfg.rproImgVec[kind], wird beim Ersetzen des Bilds gelöscht).
  function setBackground(kind, cv, place, frameX, vec) {
    const pl = Object.assign({ flip: false, rot: 0 }, place);
    let fi = -1;
    if (kind === 'sec' && frameX != null) {
      const fr = formers(); let bd = Infinity;
      fr.forEach((q, i) => { const d = Math.abs(q.x - frameX); if (d < bd) { bd = d; fi = i; } });
      if (bd > 5) fi = -1;
      if (fi >= 0) { const f = fr[fi]; f.own = true; setFrImg(f, cv); f.bgc = pl; S('rproSel', fi); }
    }
    if (fi < 0) {
      cv.__png = true; setShared(kind, cv, true); state.cfg[{ side: 'rproImgSide', top: 'rproImgTop', sec: 'rproImgFront' }[kind]] = pl;
      if (vec && Array.isArray(vec.parts) && vec.parts.length && kind !== 'sec') {
        const rd = v => Math.round(v * 1e6) / 1e6;
        state.cfg.rproImgVec = Object.assign({}, state.cfg.rproImgVec, { [kind]: { parts: vec.parts.map(pt => ({ name: String(pt.name || ''), loops: pt.loops.map(L => L.map(q => [rd(q[0]), rd(q[1])])) })) } });
      }
    }
    if (!(+C('rproImgOp') > 0)) S('rproImgOp', 55);
    if (state.activeTab === 'rpro') { buildSidebar(); draw(); }
    return { frame: fi };
  }
  // Achsenrahmen wie bei „Ableiten" (fromMesh): Weltpunkt -> Rumpf-Koordinaten [X ab Nase, Y hoch, Z seitlich]
  // Wurde der Rumpf aus einem Netz abgeleitet, gilt dessen gemerkte Lage — auch wenn inzwischen andere Körper sichtbar sind.
  function frameOf(soup, opt) {
    const M = state.cfg.rproMeshFrame;
    if (M) return { toLocal: p => [M.noseMin ? p[M.L] - M.l0 : M.l1 - p[M.L], M.us * p[M.U], p[M.S] - M.zc] };
    const F = meshFrame(soup, opt);
    return { toLocal: p => [F.noseMin ? p[F.L] - F.mn[F.L] : F.mx[F.L] - p[F.L], F.us * p[F.U], p[F.S] - F.zc] };
  }
  // Querschnitt von außen als Spant: x = Station, loops = [{ closed, pts: [[z, y], …] }] im Reiter Rumpf-Koordinaten. Hülle wie beim Ableiten
  // (größtes |Z| je Höhe -> innere Ausschnitte fallen weg, symmetrisch). Ein Spant in ±5 mm wird ersetzt, sonst neu eingefügt;
  // Umrisse laufen danach durch Oberkante, Unterkante und Breite des Schnitts. Knotenaufbau wie der nächste freie Spant.
  // opt.only: ab zwei übernommenen Spanten (f.sec) fallen alle anderen weg, Umrisse = Nase, diese Spanten, Heck.
  function setFormerFromSection(x, loops, opt) {
    opt = opt || {};
    const fx = C('rproFix'), blocked = T('Der Spant ändert Umrisse und Spanten — bitte zuerst die Fixierungen lösen (Gruppe „Fixieren“).');
    if (fx.top || fx.side || fx.fr) throw new Error(blocked);
    const o = outlines(), x0 = o.top[0].x, x1 = o.top[o.top.length - 1].x;
    x = r1(x);
    if (x <= x0 || x >= x1) throw new Error(T('Der Schnitt liegt außerhalb des Rumpfs im Reiter Rumpf.'));
    const seg = [];
    for (const L of loops) for (let i = 0, P = L.pts, n = L.closed ? P.length : P.length - 1; i < n; i++) { const a = P[i], b = P[(i + 1) % P.length]; seg.push(a[1], a[0], b[1], b[0]); }
    const r = meshStation(seg, {});
    if (!r || r.pts.length < 6) throw new Error(T('Die Ebene schneidet keinen sichtbaren Körper.'));
    const h = Math.max(1e-3, r.top - r.bot), Wd = Math.max(1e-3, r.w);
    const P = r.pts.map(p => [(p[0] - r.bot) / h, Math.max(0, p[1] / Wd)]);
    P[0][0] = 1; P[P.length - 1][0] = 0;
    const yN = clamp((ywMid(r.pts) - r.bot) / h, 0.03, 0.97), scale = Math.max(h, Wd), fr = formers();
    let hit = -1, bd = 5; fr.forEach((q, i) => { const d = Math.abs(q.x - x); if (d <= bd) { bd = d; hit = i; } });
    if (hit >= 0 && pinned(fr[hit])) throw new Error(blocked);
    // Vorbild: nächster freier Spant (gleiche Knotenzahl und -zuordnung -> saubere Überblendung); übernommene zuerst
    const hasSec = fr.some((q, i) => i !== hit && q.sec);
    let ref = null; fr.forEach((q, i) => { if (i !== hit && q.type === 'free' && q.nodes.length >= 3 && (!hasSec || q.sec) && (!ref || Math.abs(q.x - x) < Math.abs(ref.x - x))) ref = q; });
    let fit;
    if (ref) {
      const N = ref.nodes; let wi = 0; N.forEach((q, j) => { if (q.z > N[wi].z) wi = j; });
      if (wi > 0 && wi < N.length - 1) {
        const arc = [0]; for (let j = 0; j + 1 < N.length; j++) { const B = polyOf([N[j], N[j + 1]], 12); let s = 0; for (let k = 1; k < B.length; k++) s += Math.hypot(B[k][0] - B[k - 1][0], B[k][1] - B[k - 1][1]); arc.push(arc[j] + s); }
        const frac = { u: [], l: [] };
        for (let j = 1; j < wi; j++) frac.u.push(arc[j] / (arc[wi] || 1));
        for (let j = wi + 1; j < N.length - 1; j++) frac.l.push((arc[j] - arc[wi]) / ((arc[N.length - 1] - arc[wi]) || 1));
        fit = fitFixed(P, yN, frac.u.length, frac.l.length, frac, true);
        if (Math.max(fit.eu, fit.el) * scale > 0.5) { const f2 = fitFixed(P, yN, frac.u.length, frac.l.length, null, true); if (Math.max(f2.eu, f2.el) < Math.max(fit.eu, fit.el)) fit = f2; }
      }
    }
    if (!fit) for (let nu = 1, nl = 1; ; ) { fit = fitFixed(P, yN, nu, nl, null, true); if ((fit.eu <= 0.004 && fit.el <= 0.004) || nu + nl + 3 >= 10) break; if (fit.eu >= fit.el) nu++; else nl++; }
    const rd = v => Math.round(v * 1e5) / 1e5;
    const nodes = fit.nodes.map(n => ({ y: n.y, z: n.z, i: n.i.map(rd), o: n.o.map(rd) }));
    let f;
    if (hit >= 0) { f = fr[hit]; if (!f.jmp) f.x = x; f.type = 'free'; f.nodes = nodes; }
    else { f = normFr({ x, type: 'free', nodes }); fr.push(f); }
    f.sec = { top: r2(r.top), bot: r2(r.bot), w: r2(r.w) };
    const nSec = fr.filter(q => q.sec).length;
    let removed = 0;
    if (opt.only && nSec >= 2) {
      for (let i = fr.length - 1; i >= 0; i--) if (!fr[i].sec) { fr.splice(i, 1); removed++; }
      fr.sort((p, q) => p.x - q.x);
      for (const line of ['top', 'bot', 'w']) {
        const pts = o[line], key = line, s0 = fr[0].sec, s1 = fr[fr.length - 1].sec;
        // Nase und Heck hängen sich mit an: Nase = Mitte des ersten Spants (Breite 0), Heck = Maße des letzten
        const a = { x: pts[0].x, v: line === 'w' ? 0 : r2((s0.top + s0.bot) / 2), c: 0 }, b = { x: pts[pts.length - 1].x, v: s1[key], c: 0 };
        o[line] = [a].concat(fr.filter(q => q.x > a.x + 0.6 && q.x < b.x - 0.6).map(q => ({ x: q.x, v: q.sec[key], c: 0 })), [b]);
      }
    } else {
      // Umrisse durch den Schnitt führen, wo sie mehr als 0,5 mm daneben liegen (Einpasstoleranz; dichte Zusatzpunkte machen die Linie sonst wellig)
      const put = (line, v) => {
        const pts = o[line]; if (Math.abs(lineAt(outSegs(pts), x) - v) <= 0.5) return;
        let q = pts.find(p => Math.abs(p.x - x) <= 0.6);
        if (!q && insertOutPt(line, x)) q = pts.find(p => Math.abs(p.x - x) <= 0.6);
        if (q) q.v = r2(v);
      };
      put('top', r.top); put('bot', r.bot); put('w', r.w);
    }
    S('rproPt', null);
    fr.sort((p, q) => p.x - q.x); S('rproSel', fr.indexOf(f));
    hist.touched = true; build();
    if (state.activeTab === 'rpro') { buildSidebar(); draw(); }
    return { frame: fr.indexOf(f), replaced: hit >= 0, x: f.x, err: r2(Math.max(fit.eu, fit.el) * scale), nodes: nodes.length, removed, nSec };
  }
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
  function resetCam(over) { cam = Object.assign({}, CAM0, over || {}); pivot = null; }
  // Weltpunkt unter dem Bildschirmpunkt (x, y): vorderstes sichtbares Dreieck (hier GRÖSSTES d, Betrachter bei +z),
  // abgenommene Haube und weggeschnittene Hälfte wie in der Darstellung ausgelassen; sonst nächster Netzpunkt in 14 px.
  function pick3d(x, y) {
    let best = null;
    const hideKh = !!C('rproKhHide'), cut = lastCut;
    const gone = (m, i, t) => (hideKh && m.ft && m.ft[t] === 4) || (cut && cut.rm * (cut.n[0] * (m.v[i] + m.v[i + 3] + m.v[i + 6]) / 3 + cut.n[1] * (m.v[i + 1] + m.v[i + 4] + m.v[i + 7]) / 3 + cut.n[2] * (m.v[i + 2] + m.v[i + 5] + m.v[i + 8]) / 3 - cut.d) > 0);
    for (const m of lastMeshes) {
      const v = m.v;
      for (let i = 0, f = 0; i < v.length; i += 9, f++) {
        const a = scr(v[i], v[i + 1], v[i + 2]), b = scr(v[i + 3], v[i + 4], v[i + 5]), c = scr(v[i + 6], v[i + 7], v[i + 8]);
        if (x < Math.min(a.x, b.x, c.x) || x > Math.max(a.x, b.x, c.x) || y < Math.min(a.y, b.y, c.y) || y > Math.max(a.y, b.y, c.y)) continue;
        const den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y); if (Math.abs(den) < 1e-9) continue;
        const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / den, w = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / den, t = 1 - u - w;
        if (u < -1e-6 || w < -1e-6 || t < -1e-6 || gone(m, i, f)) continue;
        const d = u * a.d + w * b.d + t * c.d;
        if (!best || d > best.d) best = { d, pt: [u * v[i] + w * v[i + 3] + t * v[i + 6], u * v[i + 1] + w * v[i + 4] + t * v[i + 7], u * v[i + 2] + w * v[i + 5] + t * v[i + 8]] };
      }
    }
    if (best) return best.pt;
    if (!(window.ViewCube && ViewCube.pickNear)) return null;
    return ViewCube.pickNear(x, y, cb => { for (const m of lastMeshes) { const v = m.v; for (let i = 0; i < v.length; i += 9) if (!gone(m, i, i / 9)) for (let j = 0; j < 9; j += 3) cb(v[i + j], v[i + j + 1], v[i + j + 2]); } },
      (a, b, c) => { const q = scr(a, b, c); return { x: q.x, y: q.y, d: -q.d }; });   // pickNear: kleines d = vorne
  }
  // Drehpunkt auf den Modellpunkt unter dem Cursor setzen; der Punkt bleibt dabei am Bildschirm stehen.
  function setPivotAt(x, y) {
    const pt = pick3d(x, y); if (!pt) return false;
    const q = scr(pt[0], pt[1], pt[2]);
    pivot = pt; center = pt; cam.px = q.x - W / 2; cam.py = q.y - H / 2;
    return true;
  }
  function fit() {
    canvas = document.getElementById('cRpro'); if (!canvas) return false;
    const dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
    ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!bound) bindCanvas();
    return true;
  }
  function col(name, fb) { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb; } catch (e) { return fb; } }
  function setInfo(html, bad) { const el = document.getElementById('rproInfo'); if (el) { el.innerHTML = html; el.style.color = bad ? '#f88' : ''; } }
  const COL_KEYS = ['rproColBody', 'rproColFin', 'rproColAtt', 'rproColWing', 'rproColKh', 'rproColBoom'];   // Index 4 = Kabinenhaube, 5 = Leitwerksrohr
  function hexRGB(h) { const m = /^#([0-9a-f]{6})$/i.exec(h || ''); return m ? [parseInt(m[1].slice(0, 2), 16) / 255, parseInt(m[1].slice(2, 4), 16) / 255, parseInt(m[1].slice(4, 6), 16) / 255] : [0.4, 0.5, 0.6]; }
  function frCol() { const v = C('rproColFr'); return /^#[0-9a-f]{6}$/i.test(v || '') ? v : DEF.rproColFr; }
  function colOf(k) { const v = C(COL_KEYS[k]); return /^#[0-9a-f]{6}$/i.test(v || '') ? v : DEF[COL_KEYS[k]]; }
  function renderMode() { const m = C('rproRender'); return m === 'flat' || m === 'wire' || m === '2d' ? m : 'fine'; }
  function cssRGB(c) {
    try {
      ctx.fillStyle = c; const n = ctx.fillStyle; let m = /^#([0-9a-f]{6})$/i.exec(n);
      if (m) return hexRGB(n);
      m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(n); if (m) return [m[1] / 255, m[2] / 255, m[3] / 255];
    } catch (e) {}
    return [0.06, 0.07, 0.09];
  }
  // Canvas-2D-Rückfall: Dreiecke tiefensortiert (Maler-Algorithmus), Farbe nach Herkunft.
  function drawShaded(mesh, cut) {
    const faces = [], v = mesh.v, ft = mesh.ft, hideKh = !!C('rproKhHide'), cols = [0, 1, 2, 3, 4, 5].map(k => hexRGB(colOf(k)).map(c => Math.round(c * 255))).concat([[18, 18, 20], hexRGB(frCol()).map(c => Math.round(c * 255))]);
    for (let i = 0, t = 0; i < v.length; i += 9, t++) {
      if (hideKh && ft && ft[t] === 4) continue;
      if (cut && cut.rm * (cut.n[0] * (v[i] + v[i + 3] + v[i + 6]) / 3 + cut.n[1] * (v[i + 1] + v[i + 4] + v[i + 7]) / 3 + cut.n[2] * (v[i + 2] + v[i + 5] + v[i + 8]) / 3 - cut.d) > 0) continue;
      const ux = v[i + 3] - v[i], uy = v[i + 4] - v[i + 1], uz = v[i + 5] - v[i + 2];
      const vx = v[i + 6] - v[i], vy = v[i + 7] - v[i + 1], vz = v[i + 8] - v[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
      let nc = rot([nx, ny, nz]); if (nc[2] < 0) nc = [-nc[0], -nc[1], -nc[2]];
      const lam = Math.max(0, nc[0] * LIGHT[0] + nc[1] * LIGHT[1] + nc[2] * LIGHT[2]);
      const p0 = scr(v[i], v[i + 1], v[i + 2]), p1 = scr(v[i + 3], v[i + 4], v[i + 5]), p2 = scr(v[i + 6], v[i + 7], v[i + 8]);
      faces.push({ p: [p0, p1, p2], d: (p0.d + p1.d + p2.d) / 3, l: 0.3 + 0.7 * lam, c: cols[ft ? ft[t] : 0] || cols[0] });
    }
    faces.sort((a, b) => a.d - b.d);   // hinten (kleines d) zuerst
    ctx.lineJoin = 'round'; ctx.lineWidth = 1;
    for (const f of faces) {
      ctx.beginPath(); f.p.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle = (window.DrawTheme ? DrawTheme.raw('rgb(' + Math.min(255, Math.round(f.c[0] * f.l)) + ',' + Math.min(255, Math.round(f.c[1] * f.l)) + ',' + Math.min(255, Math.round(f.c[2] * f.l)) + ')') : 'rgb(' + Math.min(255, Math.round(f.c[0] * f.l)) + ',' + Math.min(255, Math.round(f.c[1] * f.l)) + ',' + Math.min(255, Math.round(f.c[2] * f.l)) + ')'); ctx.fill(); ctx.stroke();
    }
  }
  /* WebGL2-Darstellung (wie im Formenbau): eigene Canvas hinter der 2D-Canvas; die 2D-Canvas wird im
   * 3D-Modus durchsichtig und trägt nur Stationskurven/Achsen. Glatte Normalen kommen aus dem Gitter
   * (meshFromGrid), ohne teures Nachbarschafts-Suchen -> auch beim Ziehen flüssig. Modi: fein (glatt +
   * Glanz), flach, Drahtmodell (verdeckte Kanten durch hintergrundfarbene Flächen ausgeblendet). */
  let glc = null, gl = null, glP = null, glL = null, glVao = null, glTried = false;
  const glBufs = new Map();   // mesh -> { vbo, ibo, lbo, n, nl, used }
  let glQuad = null;          // Rechteck der Schnittfläche
  const SYNC_PX = new Uint8Array(4);
  const HALF = (() => { const h = [LIGHT[0], LIGHT[1], LIGHT[2] + 1]; const n = Math.hypot(...h) || 1; return h.map(x => x / n); })();
  function glInit() {
    if (glTried || !canvas) return; glTried = true;
    try {
      glc = document.createElement('canvas'); glc.id = 'cRproGL';
      glc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
      canvas.parentNode.insertBefore(glc, canvas);
      gl = glc.getContext('webgl2', { antialias: true, alpha: false, depth: true, stencil: true });
      if (!gl) throw new Error('no webgl2');
      const VS = `#version 300 es
        in vec3 aPos; in vec3 aNrm; in float aTag; in float aK; in float aC;
        uniform vec3 uCenter; uniform float uYaw; uniform float uPitch; uniform vec4 uProj; uniform float uZScale;
        out vec3 vCam; out vec3 vNrm; flat out int vTag; out float vK; out float vC; out vec3 vW;
        vec3 rot(vec3 p){ float cy = cos(uYaw), sy = sin(uYaw), cp = cos(uPitch), sp = sin(uPitch);
          float x1 = p.x*cy + p.z*sy, z1 = -p.x*sy + p.z*cy; return vec3(x1, p.y*cp - z1*sp, p.y*sp + z1*cp); }
        void main(){
          vec3 c = rot(aPos - uCenter); vCam = c; vW = aPos; vNrm = rot(aNrm); vTag = int(aTag + 0.5); vK = aK; vC = aC;
          gl_Position = vec4(uProj.z + uProj.x*c.x, uProj.w + uProj.y*c.y, -c.z*uZScale, 1.0);
        }`;
      const FS = `#version 300 es
        precision highp float;
        in vec3 vCam; in vec3 vNrm; flat in int vTag; in float vK; in float vC;
        uniform vec3 uColKh; uniform int uKhHide; uniform float uSkW; uniform float uSkN;
        uniform vec3 uCol[5]; uniform vec3 uColFr; uniform vec3 uLight; uniform vec3 uHalf; uniform int uSmooth; uniform int uSpec; uniform int uWire; uniform vec3 uBg;
        uniform int uAna; uniform float uKs;
        in vec3 vW; uniform vec4 uClip; uniform int uClipOn; uniform int uCap;
        out vec4 o;
        void main(){
          if (uCap == 1) { o = vec4(min(vec3(1.0), uCol[0] * 0.55 + 0.22), 1.0); return; }   // Schnittfläche
          if (uClipOn == 1 && dot(uClip.xyz, vW) > uClip.w) discard;
          vec3 col = uCol[vTag < 1 ? 0 : (vTag == 1 ? 1 : (vTag == 2 ? 2 : (vTag == 5 ? 4 : 3)))];
          if (vTag == 6) col = vec3(0.07, 0.07, 0.08);   // Steckungsbohrung (Markierung)
          if (vTag == 7) col = uColFr;                   // Haubenrahmen
          if (vTag < 1) {   // Kabinenhaube: eigene Farbe, Trennfuge als dunkle Linie
            float e = max(fwidth(vC), 1.0e-4);
            if (uKhHide == 1) {   // Haube ausgeblendet: Ausschnitt offen, davor die Sicke als abgesetzter Rand
              if (vC > uSkW * uSkN) discard;
              if (vC > 0.0) {
                float k = vC / max(uSkW, 1.0e-4), st = floor(k), ds = min(k - st, st + 1.0 - k) * uSkW;
                col *= 0.86 - 0.07 * st;
                col *= 0.5 + 0.5 * smoothstep(0.6 * e, 1.6 * e, ds);
              }
            } else {
              col = mix(col, uColKh, smoothstep(-e, e, vC));
              col *= 0.5 + 0.5 * smoothstep(0.6 * e, 1.6 * e, abs(vC));
            }
          }
          if (uWire == 2) { o = vec4(uBg, 1.0); return; }
          if (uWire == 1) { o = vec4(min(vec3(1.0), col * 1.25 + 0.08), 1.0); return; }
          vec3 nf = normalize(cross(dFdx(vCam), dFdy(vCam)));
          vec3 n = uSmooth == 1 ? normalize(vNrm) : nf;
          if (uSmooth == 1 && dot(n, nf) < 0.0) n = -n;
          if (n.z < 0.0) n = -n;
          float lam = max(0.0, dot(n, uLight));
          if (uAna == 1) {   // Längskrümmung: rot = nach außen gewölbt, blau = hohl, weiß = gerade
            float t = clamp(vK * uKs, -1.0, 1.0);
            col = t >= 0.0 ? mix(vec3(0.92), vec3(0.85, 0.15, 0.12), t) : mix(vec3(0.92), vec3(0.12, 0.35, 0.95), -t);
          } else if (uAna == 2) {   // Zebra: Reflexion waagrechter Lichtstreifen
            vec3 r = reflect(vec3(0.0, 0.0, 1.0), n);
            float st = step(0.5, fract(r.y * 3.0 + 0.5));
            o = vec4(vec3(0.08 + 0.84 * st) * (0.75 + 0.25 * lam), 1.0); return;
          }
          vec3 rgb = col * (0.30 + 0.70*lam);
          if (uSpec == 1) { float sp = max(0.0, dot(n, uHalf)); sp = pow(sp, 28.0); rgb += sp * 0.28; }
          o = vec4(min(rgb, vec3(1.0)), 1.0);
        }`;
      const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
      glP = gl.createProgram(); gl.attachShader(glP, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(glP, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(glP);
      if (!gl.getProgramParameter(glP, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glP));
      glL = {};
      for (const u of ['uCenter', 'uYaw', 'uPitch', 'uProj', 'uZScale', 'uCol', 'uLight', 'uHalf', 'uSmooth', 'uSpec', 'uWire', 'uBg', 'uAna', 'uKs', 'uColKh', 'uColFr', 'uKhHide', 'uSkW', 'uSkN', 'uClip', 'uClipOn', 'uCap']) glL[u] = gl.getUniformLocation(glP, u);
      glL.aPos = gl.getAttribLocation(glP, 'aPos'); glL.aNrm = gl.getAttribLocation(glP, 'aNrm'); glL.aTag = gl.getAttribLocation(glP, 'aTag'); glL.aK = gl.getAttribLocation(glP, 'aK'); glL.aC = gl.getAttribLocation(glP, 'aC');
      glVao = gl.createVertexArray();
      glc.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; glBufs.clear(); glQuad = null; }, false);
    } catch (e) {
      console.warn('Rumpf: WebGL2 nicht verfügbar, Canvas-2D-Darstellung:', e && e.message);
      gl = null; if (glc && glc.parentNode) glc.parentNode.removeChild(glc); glc = null;
    }
  }
  function glActive() { if (renderMode() === '2d') return false; if (!glTried) glInit(); return !!gl; }
  function glFit() {
    if (!gl || !glc) return;
    const dpr = window.devicePixelRatio || 1, w = Math.max(1, Math.round(W * dpr)), h = Math.max(1, Math.round(H * dpr));
    if (glc.width !== w || glc.height !== h) { glc.width = w; glc.height = h; }
  }
  function glMesh(mesh) {
    let b = glBufs.get(mesh); if (b) { b.used = true; return b; }
    const n = mesh.pos.length / 3, out = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) { const q = i * 9; out[q + 8] = mesh.cv ? mesh.cv[i] : -1; out[q] = mesh.pos[i * 3]; out[q + 1] = mesh.pos[i * 3 + 1]; out[q + 2] = mesh.pos[i * 3 + 2]; out[q + 3] = mesh.nrm[i * 3]; out[q + 4] = mesh.nrm[i * 3 + 1]; out[q + 5] = mesh.nrm[i * 3 + 2]; out[q + 6] = mesh.tag[i]; out[q + 7] = mesh.kv ? mesh.kv[i] : 0; }
    const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, out, gl.STATIC_DRAW);
    const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STATIC_DRAW);
    const lbo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lbo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.lines, gl.STATIC_DRAW);
    b = { vbo, ibo, lbo, n: mesh.idx.length, nl: mesh.lines.length, used: true }; glBufs.set(mesh, b); return b;
  }
  function glDraw(meshes, cut) {
    glFit();
    const bg = cssRGB(col('--bg', '#0f1216')), mode = renderMode();
    gl.viewport(0, 0, glc.width, glc.height);
    gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    for (const b of glBufs.values()) b.used = false;
    gl.useProgram(glP); gl.bindVertexArray(glVao);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    const s = 0.42 * Math.min(W, H) / radius * cam.zoom;
    gl.uniform4f(glL.uProj, 2 * s / W, 2 * s / H, 2 * cam.px / W, -2 * cam.py / H);
    gl.uniform1f(glL.uZScale, 1 / (radius * 3));
    gl.uniform3f(glL.uCenter, center[0], center[1], center[2]);
    gl.uniform1f(glL.uYaw, cam.yaw); gl.uniform1f(glL.uPitch, cam.pitch);
    gl.uniform3f(glL.uLight, LIGHT[0], LIGHT[1], LIGHT[2]); gl.uniform3f(glL.uHalf, HALF[0], HALF[1], HALF[2]); gl.uniform3f(glL.uBg, bg[0], bg[1], bg[2]);
    const cols = []; for (let k = 0; k < 4; k++) cols.push(...hexRGB(colOf(k))); cols.push(...hexRGB(colOf(5)));
    gl.uniform3fv(glL.uCol, new Float32Array(cols));
    gl.uniform3fv(glL.uColKh, new Float32Array(hexRGB(colOf(4)))); gl.uniform3fv(glL.uColFr, new Float32Array(hexRGB(frCol()))); gl.uniform1i(glL.uKhHide, C('rproKhHide') ? 1 : 0);
    { const sk = sicke(); gl.uniform1f(glL.uSkW, sk ? sk.w : 0); gl.uniform1f(glL.uSkN, sk ? sk.n : 0); }
    gl.uniform1i(glL.uSmooth, mode === 'fine' ? 1 : 0); gl.uniform1i(glL.uSpec, mode === 'fine' ? 1 : 0);
    gl.uniform1i(glL.uCap, 0); gl.uniform1i(glL.uClipOn, cut ? 1 : 0);
    if (cut) gl.uniform4f(glL.uClip, cut.rm * cut.n[0], cut.rm * cut.n[1], cut.rm * cut.n[2], cut.rm * cut.d);
    const bind = b => {
      gl.bindBuffer(gl.ARRAY_BUFFER, b.vbo); gl.enableVertexAttribArray(glL.aPos); gl.vertexAttribPointer(glL.aPos, 3, gl.FLOAT, false, 36, 0); gl.enableVertexAttribArray(glL.aNrm); gl.vertexAttribPointer(glL.aNrm, 3, gl.FLOAT, false, 36, 12); gl.enableVertexAttribArray(glL.aTag); gl.vertexAttribPointer(glL.aTag, 1, gl.FLOAT, false, 36, 24);
      if (glL.aK >= 0) { gl.enableVertexAttribArray(glL.aK); gl.vertexAttribPointer(glL.aK, 1, gl.FLOAT, false, 36, 28); }
      if (glL.aC >= 0) { gl.enableVertexAttribArray(glL.aC); gl.vertexAttribPointer(glL.aC, 1, gl.FLOAT, false, 36, 32); }
    };
    const ana = C('rproAna'); gl.uniform1i(glL.uAna, mode === 'wire' ? 0 : ana === 'curv' ? 1 : ana === 'zebra' ? 2 : 0); gl.uniform1f(glL.uKs, 1 / ((model && model.kRef) || 1e-3));
    const bufs = meshes.map(glMesh);
    if (mode === 'wire') {
      gl.uniform1i(glL.uWire, 2); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 2);
      for (const b of bufs) { bind(b); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.ibo); gl.drawElements(gl.TRIANGLES, b.n, gl.UNSIGNED_INT, 0); }
      // Treiberfalle (ANGLE/D3D, Kantenglättung): Linien direkt nach Dreiecken im selben Bild gehen ab dem zweiten
      // Bild verloren (Zoomen/Drehen -> leeres Drahtgitter). Ein 1-Pixel-Lesen synchronisiert; flush/finish genügen nicht.
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, SYNC_PX);
      gl.disable(gl.POLYGON_OFFSET_FILL); gl.uniform1i(glL.uWire, 1);
      for (const b of bufs) { bind(b); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.lbo); gl.drawElements(gl.LINES, b.nl, gl.UNSIGNED_INT, 0); }
    } else {
      gl.uniform1i(glL.uWire, 0);
      for (const b of bufs) { bind(b); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.ibo); gl.drawElements(gl.TRIANGLES, b.n, gl.UNSIGNED_INT, 0); }
      if (cut && cut.fill && cut.cap && model && model.bounds) {   // Schnittfläche: Stencil-Parität des aufgeschnittenen (geschlossenen) Rumpfs, dann Ebene füllen
        const b = bufs[0], m = radius * 2.2;
        gl.enable(gl.STENCIL_TEST); gl.clear(gl.STENCIL_BUFFER_BIT); gl.colorMask(false, false, false, false); gl.depthMask(false); gl.disable(gl.DEPTH_TEST);
        gl.stencilFunc(gl.ALWAYS, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT); bind(b); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.ibo); gl.drawElements(gl.TRIANGLES, b.n, gl.UNSIGNED_INT, 0);
        gl.colorMask(true, true, true, true); gl.depthMask(true); gl.enable(gl.DEPTH_TEST); gl.stencilFunc(gl.NOTEQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        const Q = [[-m, -m], [m, -m], [m, m], [-m, m]], d = new Float32Array(54);
        [0, 1, 2, 0, 2, 3].forEach((qi, i) => { for (let j = 0; j < 3; j++) { d[i * 9 + j] = cut.P0[j] + Q[qi][0] * cut.U[j] + Q[qi][1] * cut.W[j]; d[i * 9 + 3 + j] = cut.n[j]; } d[i * 9 + 6] = 1; });
        if (!glQuad) glQuad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, glQuad); gl.bufferData(gl.ARRAY_BUFFER, d, gl.DYNAMIC_DRAW); bind({ vbo: glQuad });
        gl.uniform1i(glL.uClipOn, 0); gl.uniform1i(glL.uCap, 1); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.uniform1i(glL.uCap, 0); gl.disable(gl.STENCIL_TEST);
      }
    }
    gl.bindVertexArray(null);
    for (const [k, b] of glBufs) if (!b.used) { gl.deleteBuffer(b.vbo); gl.deleteBuffer(b.ibo); gl.deleteBuffer(b.lbo); glBufs.delete(k); }
  }
  function glHide() { if (glc) glc.style.display = 'none'; }
  function drawAxes() {
    const L = radius * 0.35, o = [center[0] - radius * 0.9, center[1] - radius * 0.6, center[2] - radius * 0.2];
    ctx.font = '11px system-ui'; ctx.lineWidth = 1.5; ctx.strokeStyle = ctx.fillStyle = col('--muted', '#8aa');
    for (const a of [[1, 0, 0, 'X'], [0, 1, 0, 'Y'], [0, 0, 1, 'Z']]) {
      const p0 = scr(o[0], o[1], o[2]), p1 = scr(o[0] + a[0] * L, o[1] + a[1] * L, o[2] + a[2] * L);
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); ctx.fillText(a[3], p1.x + 3, p1.y - 3);
    }
  }
  // Ansichtsschalter im 3D-Fenster unter dem Ansichtswürfel (wie im Formenbau).
  let viewBtns = [];
  function viewItems() {
    const it = [], kh = model && model.kh && model.kh.N, ana = C('rproAna');
    if (kh) it.push(['kh', 'Kabinenhaube', !C('rproKhHide')]);
    if (kh) it.push(['sk', 'Sicke', !!KH().skOn]);
    if (kh && FRM().on) it.push(['fr', 'Haubenrahmen', FRM().show !== false]);
    it.push(['cut', 'Schnitt', !!CUT().on]);
    it.push(['st', 'Spantkurven', !!C('rproShowSt')]);
    if (model && model.wing) it.push(['wing', 'Tragfläche', !!C('rproShowWing')]);
    if (model && model.fin && model.fin.hl) it.push(['hlw', 'Höhenleitwerk', HL().show !== false]);
    if (model && model.fin && model.fin.rud) it.push(['rud', 'Ruder', FN().rud.show !== false]);
    if (model && model.boom) it.push(['boom', 'Leitwerksrohr', BM().show !== false]);
    it.push(['wire', 'Drahtgitter', renderMode() === 'wire']);
    it.push(['curv', 'Krümmung', ana === 'curv'], ['zebra', 'Zebra', ana === 'zebra']);
    return it;
  }
  function drawViewBtns() {
    viewBtns = [];
    const bw = 104, bh = 18, x = W - 8 - bw; let y = 4 + 104 + 8;
    const fg = col('--txt', '#dde'), line = col('--line', '#556');
    ctx.save(); ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 1; ctx.setLineDash([]);
    for (const [k, t, on] of viewItems()) {
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, 4); else ctx.rect(x, y, bw, bh);
      ctx.fillStyle = on ? 'rgba(70,130,220,.85)' : 'rgba(60,70,90,.55)'; ctx.fill(); ctx.strokeStyle = on ? 'rgba(120,170,255,.9)' : line; ctx.stroke();
      ctx.fillStyle = fg; ctx.globalAlpha = on ? 1 : 0.8; ctx.fillText(T(t), x + bw / 2, y + bh / 2 + 0.5); ctx.globalAlpha = 1;
      viewBtns.push({ k, x, y, w: bw, h: bh });
      y += bh + 4;
    }
    ctx.restore();
  }
  function hitViewBtn(mx, my) { for (const b of viewBtns) if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) return b.k; return null; }
  function clickViewBtn(k) {
    const ana = C('rproAna');
    if (k === 'kh') S('rproKhHide', !C('rproKhHide'));
    else if (k === 'cut') CUT().on = !CUT().on;
    else if (k === 'sk') KH().skOn = !KH().skOn;
    else if (k === 'fr') { const f = FRM(); f.show = f.show === false; if (f.show) S('rproKhHide', true); }
    else if (k === 'st') S('rproShowSt', !C('rproShowSt'));
    else if (k === 'wing') { S('rproShowWing', !C('rproShowWing')); build(); }
    else if (k === 'hlw') { HL().show = HL().show === false; build(); }
    else if (k === 'rud') { const r = FN().rud; r.show = r.show === false; build(); }
    else if (k === 'boom') { BM().show = BM().show === false; build(); }
    else if (k === 'wire') S('rproRender', renderMode() === 'wire' ? 'fine' : 'wire');
    else if (k === 'curv') S('rproAna', ana === 'curv' ? 'off' : 'curv');
    else if (k === 'zebra') S('rproAna', ana === 'zebra' ? 'off' : 'zebra');
    buildSidebar(); draw();
  }
  function draw3d() {
    ctx.fillStyle = col('--bg', '#0f1216'); ctx.fillRect(0, 0, W, H);
    if (!model || !model.mesh) { glHide(); setInfo(model && model.err ? model.err : T('Kein Rumpf.'), true); return; }
    let { mn, mx } = model.bounds;
    // Haube abgenommen + Sicke: Rumpf mit wirklich vertiefter Auflage zeigen (einmal je Modell berechnet)
    let body = model.mesh;
    if (C('rproKhHide') && renderMode() !== 'wire' && model.kh && model.kh.N && sicke()) {
      if (model.skMesh === undefined) { try { model.skMesh = sickeMesh(); } catch (e) { console.warn('Rumpf: Sicke nicht darstellbar', e); model.skMesh = null; } }
      if (model.skMesh) body = model.skMesh;
    }
    const meshes = [body];
    if (C('rproKhHide') && renderMode() !== 'wire' && model.kh && model.kh.N && FRM().on && FRM().show !== false) {
      if (model.frMesh === undefined) { try { model.frMesh = frameMesh(); } catch (e) { console.warn('Rumpf: Haubenrahmen nicht darstellbar', e); model.frMesh = null; } }
      if (model.frMesh) meshes.push(model.frMesh);
    }
    for (const wm of [model.wingMesh, model.hlwMesh, model.rudMesh, model.boomMesh].concat(model.vtBores || [])) if (wm) { meshes.push(wm); const b = meshBounds(wm); mn = mn.map((v, k) => Math.min(v, b.mn[k])); mx = mx.map((v, k) => Math.max(v, b.mx[k])); }
    radius = Math.max(1, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2);
    // Drehpunkt weit außerhalb des (neuen) Modells -> wieder Modellmitte
    if (pivot && pivot.some((v, k) => v < mn[k] - radius || v > mx[k] + radius)) { pivot = null; cam.px = cam.py = 0; }
    center = pivot || [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    const cut = cutSpec(); if (cut) cut.cap = body === model.mesh && !(C('rproKhHide') && model.kh && model.kh.N);
    lastMeshes = meshes; lastCut = cut;
    if (glActive()) { glc.style.display = ''; glDraw(meshes, cut); ctx.clearRect(0, 0, W, H); }
    else { glHide(); for (const m of meshes) drawShaded(m, cut); }
    if (C('rproShowSt')) {
      ctx.strokeStyle = 'rgba(255,210,120,.85)'; ctx.lineWidth = 1.2;
      for (const s of model.FR) {
        if (model.boom && s.x > model.boom.xT + 1e-6) continue;   // Spanten hinter dem Übergang wirken nicht
        const pts = secHalf(model, s.x);
        for (const sg of [1, -1]) { ctx.beginPath(); pts.forEach((q, i) => { const p = scr(q[0], q[1], sg * q[2]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); }
      }
    }
    drawAxes(); drawViewBtns();
    if (pivot && window.ViewCube && ViewCube.drawPivot) { const q = scr(pivot[0], pivot[1], pivot[2]); ViewCube.drawPivot(ctx, q.x, q.y); }
    setInfo(infoText() + (cut ? '<br>' + cutName(cut) + ' · ' + T('Pfeiltasten verschieben die Ebene') : ''));
  }
  function infoText() {
    const { mn, mx } = model.bounds;
    const dim = k => (mx[k] - mn[k]).toFixed(1);
    return T('Rumpf: Umrisse + Spanten') + ' · ' + model.FR.length + ' ' + T('Spanten') + ' · ' + LINES.map(k => outlines()[k].length).reduce((a, b) => a + b, 0) + ' ' + T('Umrisspunkte')
      + '<br>' + Math.round(model.ntri) + ' ' + T('Dreiecke') + ' · ' + dim(0) + ' × ' + dim(1) + ' × ' + dim(2) + ' mm'
      + ' · ' + T('Volumen') + ' ' + (model.vol / 1000).toFixed(1) + ' cm³'
      + (model.wingMesh ? ' · ' + T('Tragfläche (nur Anzeige)') + ' ' + Math.round(model.wingMesh.ntri) + ' ' + T('Dreiecke') : '')
      + (model.boom ? '<br>' + boomInfo(model.boom) : '');
  }
  function boomInfo(g) {
    const bad = g.dev > 0.3 || g.warn.length;
    return T('Rumpfboot: Übergang bei X') + ' ' + g.xT.toFixed(1) + ' · ' + T('Rohr') + ' Ø ' + (2 * g.r0).toFixed(1) + ' → ' + (2 * g.r1).toFixed(1) + ' × ' + g.len.toFixed(0) + ' mm'
      + ' · ' + T('Einschnürung') + ' Ø ' + (2 * g.rs0).toFixed(2) + ' × ' + g.Ls.toFixed(0) + ' mm'
      + (bad ? ' · <span style="color:#fb8">' + (g.warn.length ? g.warn.join(' ') + ' ' : '') + (g.dev > 0.3 ? T('Bootsquerschnitt am Übergang weicht bis') + ' ' + g.dev.toFixed(1) + ' ' + T('mm vom Rohr ab („Heck rund auf Rohr“).') : '') + '</span>' : '');
  }

  // ---- 2D-Ansichten (Seite: X/Y, Draufsicht: X/Z, Spant: Z/Y) ----------------------
  let xf2 = null;   // aktuelle 2D-Abbildung { P(u,v), inv(x,y), sc }
  const vFrozen = {};
  function view2dBase(kind) {
    const b = model && model.bounds ? (model.vbounds || model.bounds) : { mn: [0, -50, -50], mx: [1000, 50, 50] };
    let u0, u1, v0, v1;
    if (kind === 'side') { u0 = b.mn[0]; u1 = b.mx[0]; v0 = b.mn[1]; v1 = b.mx[1]; }
    else if (kind === 'top') { u0 = b.mn[0]; u1 = b.mx[0]; v0 = b.mn[2]; v1 = b.mx[2]; }
    else { u0 = b.mn[2]; u1 = b.mx[2]; v0 = b.mn[1]; v1 = b.mx[1]; }
    let c2 = cam2[kind];
    if (!c2 || ![c2.zoom, c2.px, c2.py].every(isFinite) || !(c2.zoom > 0)) c2 = cam2[kind] = { zoom: 1, px: 0, py: 0 };
    let base = Math.min(Math.max(W - 140, W * 0.5, 1) / ((u1 - u0) || 1), Math.max(H - 140, H * 0.5, 1) / ((v1 - v0) || 1));
    let cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    // Beim Ziehen eines Griffs bleibt der Ansichtsbezug stehen (sonst rutscht die Ansicht mit der Rumpflänge unter der Maus weg);
    // nach dem Loslassen wird Zoom/Verschiebung so umgerechnet, dass das Bild nicht springt.
    const fz = vFrozen[kind];
    if (dragging && dragMode === 'handle') { if (fz && fz.W === W && fz.H === H) ({ base, cu, cv } = fz); else vFrozen[kind] = { base, cu, cv, W, H }; }
    else if (fz) {
      delete vFrozen[kind];
      if (fz.W === W && fz.H === H) { const so = fz.base * c2.zoom; c2.zoom = so / base; c2.px += (cu - fz.cu) * so; c2.py -= (cv - fz.cv) * so; }
    }
    const sc = base * c2.zoom;
    xf2 = { sc, P: (u, v) => ({ x: W / 2 + c2.px + (u - cu) * sc, y: H / 2 + c2.py - (v - cv) * sc }), inv: (x, y) => [cu + (x - W / 2 - c2.px) / sc, cv - (y - H / 2 - c2.py) / sc] };
    return xf2;
  }
  // ⌂ in Seiten-/Drauf-/Spantansicht: Zoom und Verschiebung so, dass Rumpf UND Hintergrundbild ganz zu sehen sind.
  function fit2d(kind) {
    cam2[kind] = { zoom: 1, px: 0, py: 0 };
    const im = img[kind], c = C(IMG_KEY[kind]); if (!im || !c || !(W > 0) || !(H > 0)) return;
    const base = view2dBase(kind).sc, b = model && model.bounds ? (model.vbounds || model.bounds) : { mn: [0, -50, -50], mx: [1000, 50, 50] };
    const iu = kind === 'sec' ? 2 : 0, iv = kind === 'top' ? 2 : 1;
    let U0 = b.mn[iu], U1 = b.mx[iu], V0 = b.mn[iv], V1 = b.mx[iv];
    const cr = c.crop || [0, 0, im.width, im.height];
    for (const q of [[cr[0], cr[1]], [cr[2], cr[1]], [cr[0], cr[3]], [cr[2], cr[3]]]) { const w = imgToW(kind, q); U0 = Math.min(U0, w[0]); U1 = Math.max(U1, w[0]); V0 = Math.min(V0, w[1]); V1 = Math.max(V1, w[1]); }
    if (![U0, U1, V0, V1].every(isFinite)) return;
    const sc = Math.min(Math.max(W - 140, W * 0.5, 1) / ((U1 - U0) || 1), Math.max(H - 140, H * 0.5, 1) / ((V1 - V0) || 1)), cu = (b.mn[iu] + b.mx[iu]) / 2, cv = (b.mn[iv] + b.mx[iv]) / 2;
    cam2[kind] = { zoom: sc / base, px: -((U0 + U1) / 2 - cu) * sc, py: ((V0 + V1) / 2 - cv) * sc };
  }
  // Bild wieder auf den Rumpf legen (Lage wie beim Laden; mit Basispunkt an die Rumpfspitze).
  function imgDefault(kind) {
    const key = IMG_KEY[kind], old = C(key) || {}, b = model && model.bounds ? model.bounds : { mn: [0, -50, -50], mx: [1000, 50, 50] };
    const c = kind === 'sec' ? { len: b.mx[2] - b.mn[2], x: b.mn[2], y: b.mx[1] } : { len: b.mx[0] - b.mn[0], x: b.mn[0], y: kind === 'side' ? b.mx[1] : b.mx[2] };
    c.flip = !!old.flip; if (old.bp) c.bp = old.bp; if (old.ref) c.ref = old.ref; if (old.crop) c.crop = old.crop;
    S(key, c); if (c.bp) imgAlignNose(kind);
  }
  function grid2d(xf, u0, u1, v0, v1) {
    const g = (st, colr) => {
      ctx.strokeStyle = colr; ctx.lineWidth = 1; ctx.beginPath();
      for (let u = Math.floor(u0 / st) * st; u <= u1; u += st) { const a = xf.P(u, v0), b = xf.P(u, v1); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      for (let v = Math.floor(v0 / st) * st; v <= v1; v += st) { const a = xf.P(u0, v), b = xf.P(u1, v); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke();
    };
    if (xf.sc * 10 > 6) g(10, 'rgba(128,160,180,.07)'); g(50, 'rgba(128,160,180,.16)');
  }
  function drawImg(kind, xf) {
    const im = img[kind], cfg = C(IMG_KEY[kind]);
    if (!im || !cfg) return;
    const mmpp = cfg.len > 0 ? cfg.len / im.width : 1;
    const a = xf.P(cfg.x, cfg.y), wpx = im.width * mmpp * xf.sc, hpx = im.height * mmpp * xf.sc;
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, (+C('rproImgOp') || 0) / 100));
    ctx.translate(a.x, a.y); ctx.rotate(-(+cfg.rot || 0) * Math.PI / 180);   // Drehung um die linke obere Bildecke (Welt: + = gegen den Uhrzeigersinn)
    if (cfg.flip) { ctx.translate(0, hpx); ctx.scale(1, -1); }
    const cr = cfg.crop, k = mmpp * xf.sc;   // Zuschnitt [x0, y0, x1, y1] in Bildpixeln
    if (cr && imgTool !== 'crop') ctx.drawImage(im, cr[0], cr[1], cr[2] - cr[0], cr[3] - cr[1], cr[0] * k, cr[1] * k, (cr[2] - cr[0]) * k, (cr[3] - cr[1]) * k);
    else {
      if (cr) { ctx.globalAlpha *= 0.35; ctx.drawImage(im, 0, 0, wpx, hpx); ctx.globalAlpha /= 0.35; ctx.drawImage(im, cr[0], cr[1], cr[2] - cr[0], cr[3] - cr[1], cr[0] * k, cr[1] * k, (cr[2] - cr[0]) * k, (cr[3] - cr[1]) * k); }
      else ctx.drawImage(im, 0, 0, wpx, hpx);
    }
    ctx.restore();
    // Zuschnitt-Rahmen: beim Aufziehen das neue Rechteck, mit aktivem Werkzeug der bisherige Zuschnitt
    const rect = (r, colr) => { ctx.strokeStyle = colr; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.beginPath(); [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]].forEach((q, i) => { const w = imgToW(kind, q), p = xf.P(w[0], w[1]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]); };
    if (imgTool === 'crop') { if (cropA && cropB) rect(cropRect(kind, cropA, cropB), '#5aa9ff'); else if (cr) rect(cr, 'rgba(90,169,255,.6)'); }
    // Basispunkt, Referenzstrecke und laufendes Bildwerkzeug
    const mark = (w, colr, r) => { const p = xf.P(w[0], w[1]); ctx.strokeStyle = colr; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.moveTo(p.x - r - 5, p.y); ctx.lineTo(p.x + r + 5, p.y); ctx.moveTo(p.x, p.y - r - 5); ctx.lineTo(p.x, p.y + r + 5); ctx.stroke(); return p; };
    const seg = (A, B, colr, txt) => {
      const p = xf.P(A[0], A[1]), q = xf.P(B[0], B[1]), L = Math.hypot(q.x - p.x, q.y - p.y) || 1, nx = -(q.y - p.y) / L * 6, ny = (q.x - p.x) / L * 6;
      ctx.strokeStyle = colr; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
      ctx.moveTo(p.x - nx, p.y - ny); ctx.lineTo(p.x + nx, p.y + ny); ctx.moveTo(q.x - nx, q.y - ny); ctx.lineTo(q.x + nx, q.y + ny); ctx.stroke();
      if (txt) { ctx.font = 'bold 11px system-ui'; ctx.fillStyle = colr; ctx.fillText(txt, (p.x + q.x) / 2 + nx * 1.6 + 4, (p.y + q.y) / 2 + ny * 1.6 - 2); }
    };
    if (imgTool === 'base') { const p = mark(noseOf(kind), '#4dff88', 5); ctx.font = '11px system-ui'; ctx.fillStyle = '#4dff88'; ctx.fillText(T('Rumpfspitze'), p.x + 9, p.y - 8); }
    if (cfg.bp) { const p = mark(imgToW(kind, cfg.bp), '#ff9b3d', 6); ctx.font = '11px system-ui'; ctx.fillStyle = '#ff9b3d'; ctx.fillText(T('Basispunkt'), p.x + 10, p.y + 16); }
    drawTrace(kind, xf);
    if (cfg.ref && imgTool !== 'ref') seg(imgToW(kind, cfg.ref.a), imgToW(kind, cfg.ref.b), '#ffe14d', r1(imgRefMm(kind)) + ' mm');
    if (imgTool === 'ref' && refA) seg(refA, refB || refA, '#ffe14d', r1(Math.hypot((refB || refA)[0] - refA[0], (refB || refA)[1] - refA[1])) + ' mm');
  }
  // ---- Hintergrundbild: Bildpixel <-> Welt (mm), Basispunkt, Referenzstrecke ----
  let imgKind = 'side';   // Hintergrundbild-Gruppe in 3D-/Schnittansicht: zuletzt benutzte 2D-Ansicht
  let imgToolEnd = 0, imgTool = null, refA = null, refB = null, cropA = null, cropB = null;   // Bildwerkzeug: null | 'move' | 'base' | 'ref' | 'crop' | 'trace'
  // Zuschnitt-Rechteck aus zwei Weltpunkten, in Bildpixeln (achsparallel im Bild, auch bei gedrehtem Bild), auf das Bild begrenzt.
  function cropRect(kind, A, B) {
    const im = img[kind], a = wToImg(kind, A[0], A[1]), b = wToImg(kind, B[0], B[1]), cl = (v, m) => Math.max(0, Math.min(m, Math.round(v)));
    return [cl(Math.min(a[0], b[0]), im.width), cl(Math.min(a[1], b[1]), im.height), cl(Math.max(a[0], b[0]), im.width), cl(Math.max(a[1], b[1]), im.height)];
  }
  function finishCrop(kind) {
    const c = C(IMG_KEY[kind]); if (!c || !cropA || !cropB || !img[kind]) return;
    const r = cropRect(kind, cropA, cropB);
    if (r[2] - r[0] >= 4 && r[3] - r[1] >= 4) c.crop = r;
    setImgTool(null);
  }
  function imgMmpp(kind) { const im = img[kind], c = C(IMG_KEY[kind]); return im && c && c.len > 0 ? c.len / im.width : 1; }
  // (c.x, c.y) = linke obere Bildecke in mm, c.rot = Drehung in ° um diese Ecke.
  function imgToW(kind, p) {
    const im = img[kind], c = C(IMG_KEY[kind]), m = imgMmpp(kind), py = c.flip ? im.height - p[1] : p[1];
    const a = (+c.rot || 0) * Math.PI / 180, lx = p[0] * m, ly = -py * m;
    return [c.x + lx * Math.cos(a) - ly * Math.sin(a), c.y + lx * Math.sin(a) + ly * Math.cos(a)];
  }
  function wToImg(kind, u, w) {
    const im = img[kind], c = C(IMG_KEY[kind]), m = imgMmpp(kind), a = (+c.rot || 0) * Math.PI / 180, dx = u - c.x, dy = w - c.y;
    const lx = dx * Math.cos(a) + dy * Math.sin(a), ly = -dx * Math.sin(a) + dy * Math.cos(a), py = -ly / m;
    return [lx / m, c.flip ? im.height - py : py];
  }
  // Drehung setzen; fest bleibt der Basispunkt (sonst der Weltpunkt `pivot` bzw. die Bildmitte).
  function imgSetRot(kind, deg, pivot) {
    const c = C(IMG_KEY[kind]), im = img[kind]; if (!c || !im) return;
    const q = c.bp ? c.bp : pivot ? wToImg(kind, pivot[0], pivot[1]) : [im.width / 2, im.height / 2], P = imgToW(kind, q);
    deg = ((deg % 360) + 540) % 360 - 180; c.rot = Math.round(deg * 1000) / 1000;
    const N = imgToW(kind, q); c.x += P[0] - N[0]; c.y += P[1] - N[1];
  }
  // Gezeichnete Strecke waagrecht (axis 0) bzw. senkrecht (axis 1) stellen, kleinste Drehung.
  function imgRefAlign(kind, axis) {
    const c = C(IMG_KEY[kind]); if (!c || !c.ref) return;
    const A = imgToW(kind, c.ref.a), B = imgToW(kind, c.ref.b);
    let ang = Math.atan2(B[1] - A[1], B[0] - A[0]) * 180 / Math.PI - (axis ? 90 : 0);
    ang = ((ang % 180) + 270) % 180 - 90;
    imgSetRot(kind, (+c.rot || 0) - ang, A);
  }
  // Rumpfspitze in der jeweiligen Ansicht: vorderster Umrisspunkt, Höhe = Mitte zwischen Ober- und Unterkante.
  function noseOf(kind) {
    const o = outlines(), x = o.top[0].x, y = (o.top[0].v + o.bot[0].v) / 2;
    return kind === 'side' ? [x, y] : kind === 'top' ? [x, 0] : [0, y];
  }
  function imgRefMm(kind) { const r = C(IMG_KEY[kind]).ref; return Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) * imgMmpp(kind); }
  // Bildbreite setzen; fest bleibt der Basispunkt (sonst der Weltpunkt `anchor` bzw. die linke obere Ecke).
  function imgSetLen(kind, len, anchor) {
    const c = C(IMG_KEY[kind]); if (!c) return;
    const A = c.bp && img[kind] ? imgToW(kind, c.bp) : anchor || [c.x, c.y], f = Math.max(1, len) / c.len;
    c.len = Math.max(1, len); c.x = A[0] - (A[0] - c.x) * f; c.y = A[1] - (A[1] - c.y) * f;
  }
  function imgAlignNose(kind) {
    const c = C(IMG_KEY[kind]); if (!c || !c.bp || !img[kind]) return;
    const A = imgToW(kind, c.bp), N = noseOf(kind); c.x += N[0] - A[0]; c.y += N[1] - A[1];
  }
  // Gezeichnete Strecke übernehmen (in Bildpixeln, wandert also mit dem Bild) und das Längenfeld anbieten.
  function finishRef(kind) {
    const c = C(IMG_KEY[kind]), a = refA, b = refB;
    if (!c || !a || !b || !xf2 || Math.hypot(b[0] - a[0], b[1] - a[1]) * xf2.sc < 4) { refB = null; return; }
    c.ref = { a: wToImg(kind, a[0], a[1]), b: wToImg(kind, b[0], b[1]) };
    setImgTool(null);
    const el = document.querySelector('[data-rpimg="ref"]'); if (el) { el.focus(); el.select && el.select(); }
  }
  function setImgTool(t) { if (imgTool) imgToolEnd = performance.now(); imgTool = imgTool === t ? null : t; refA = refB = cropA = cropB = null; if (canvas) canvas.style.cursor = imgTool === 'move' ? 'move' : imgTool ? 'crosshair' : ''; buildSidebar(); draw(); }
  // ---- Kontur aus dem Hintergrundbild nachzeichnen (Seitenansicht -> Ober-/Unterkante, Draufsicht -> halbe Breite) ----
  // Klick in den Rumpf im Bild (Saatpunkt), dann:
  //  1. Bild in Weltachsen abtasten (Drehung, Spiegelung, Zuschnitt gelten), Raster = Bildpixelgröße.
  //  2. „Wand" = Pixel, die deutlich von der Hintergrundfarbe (häufigste Farbe) abweichen — bei einer Strichzeichnung die
  //     Linien, bei einem Foto vor ruhigem Hintergrund das Modell selbst; um `gap` px verdickt (Lücken in Linien schließen).
  //  3. Hintergrund vom Rand aus fluten; was nicht erreicht wird, ist Körper (Innenlinien stören so nicht). Öffnen um `open` px
  //     entfernt angesetzte dünne Linien (Maßlinien, Mittellinie). Zusammenhängender Körper am Saatpunkt.
  //  4. Je Spalte der Lauf, der den der Nachbarspalte am meisten überdeckt -> Ober-/Unterrand; bei Strichen gilt die Strichmitte.
  //  5. Anbauten (Leitwerk, Tragfläche, Höhenleitwerk) überbrücken: Ausbuchtungen nach außen, die steiler als `ang` ansteigen.
  //  6. Messwerte in die Umrisslinie einpassen (fitOutLine wie bei der Übernahme aus einem 3D-Netz).
  const TRC = () => { const d = DEF.rproTrace, c = C('rproTrace'); for (const k in d) if (c[k] == null) c[k] = d[k]; return c; };
  const pixCache = new WeakMap();
  function imgPixels(im) {
    let d = pixCache.get(im); if (d) return d;
    const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, cv = document.createElement('canvas');
    cv.width = w; cv.height = h; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(im, 0, 0, w, h);
    d = { w, h, data: g.getImageData(0, 0, w, h).data }; pixCache.set(im, d); return d;
  }
  // Quadratische Dilatation einer 0/1-Maske, Radius r, getrennt in Zeilen und Spalten.
  function dilateMask(M, nx, ny, r) {
    if (r <= 0) return M;
    const A = new Uint8Array(M.length), B = new Uint8Array(M.length);
    for (let j = 0; j < ny; j++) {
      const o = j * nx; let last = -1e9;
      for (let i = 0; i < nx; i++) { if (M[o + i]) last = i; if (i - last <= r) A[o + i] = 1; }
      last = 1e9; for (let i = nx - 1; i >= 0; i--) { if (M[o + i]) last = i; if (last - i <= r) A[o + i] = 1; }
    }
    for (let i = 0; i < nx; i++) {
      let last = -1e9;
      for (let j = 0; j < ny; j++) { if (A[j * nx + i]) last = j; if (j - last <= r) B[j * nx + i] = 1; }
      last = 1e9; for (let j = ny - 1; j >= 0; j--) { if (A[j * nx + i]) last = j; if (last - j <= r) B[j * nx + i] = 1; }
    }
    return B;
  }
  // Füllen (4er-Nachbarschaft) über die Zellen mit pass = 1, ab den Startzellen.
  function flood(pass, nx, starts) {
    const R = new Uint8Array(pass.length), Q = new Int32Array(pass.length); let qh = 0, qt = 0;
    for (const k of starts) if (pass[k] && !R[k]) { R[k] = 1; Q[qt++] = k; }
    while (qh < qt) {
      const k = Q[qh++], i = k % nx;
      if (i > 0 && pass[k - 1] && !R[k - 1]) { R[k - 1] = 1; Q[qt++] = k - 1; }
      if (i < nx - 1 && pass[k + 1] && !R[k + 1]) { R[k + 1] = 1; Q[qt++] = k + 1; }
      if (k >= nx && pass[k - nx] && !R[k - nx]) { R[k - nx] = 1; Q[qt++] = k - nx; }
      if (k + nx < pass.length && pass[k + nx] && !R[k + nx]) { R[k + nx] = 1; Q[qt++] = k + nx; }
    }
    return R;
  }
  // Schwelle nach Otsu über ein Histogramm 0…255.
  function otsu(hist) {
    let n = 0, sum = 0; for (let t = 0; t < 256; t++) { n += hist[t]; sum += t * hist[t]; }
    let wB = 0, sB = 0, best = 0, thr = 60;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break;
      sB += t * hist[t]; const d = sB / wB - (sum - sB) / wF, v = wB * wF * d * d;
      if (v > best) { best = v; thr = t; }
    }
    return thr;
  }
  // Rohkontur aus dem Bild: { x0, x1 (Nase/Heck), xs, top, bot (Welt-v je Spalte), h (Rastermaß), thr }.
  function traceRaw(kind, seed) {
    const im = img[kind], c = C(IMG_KEY[kind]), o = TRC();
    if (!im || !c) throw new Error('Kein Hintergrundbild geladen.');
    const vec = state.cfg.rproImgVec && state.cfg.rproImgVec[kind];
    if (vec && Array.isArray(vec.parts) && vec.parts.length) return traceVec(kind, seed, vec);
    const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height, cr = c.crop || [0, 0, iw, ih];
    let U0 = Infinity, U1 = -Infinity, V0 = Infinity, V1 = -Infinity;
    for (const q of [[cr[0], cr[1]], [cr[2], cr[1]], [cr[0], cr[3]], [cr[2], cr[3]]]) { const w = imgToW(kind, q); U0 = Math.min(U0, w[0]); U1 = Math.max(U1, w[0]); V0 = Math.min(V0, w[1]); V1 = Math.max(V1, w[1]); }
    const gap = clamp(Math.round(+o.gap || 0), 0, 10), opn = clamp(Math.round(+o.open || 0), 0, 15), pad = gap + 3;
    let h = imgMmpp(kind), nx = 0, ny = 0;
    for (;;) { nx = Math.ceil((U1 - U0) / h) + 2 * pad; ny = Math.ceil((V1 - V0) / h) + 2 * pad; if (nx * ny <= 6e6) break; h *= Math.sqrt(nx * ny / 6e6) * 1.01; }
    const ox = U0 - pad * h, oy = V1 + pad * h;   // Zelle (i, j): u = ox + (i + ½)h, v = oy − (j + ½)h
    const P = imgPixels(im), A = wToImg(kind, ox + h / 2, oy - h / 2), B = wToImg(kind, ox + 1.5 * h, oy - h / 2), Cq = wToImg(kind, ox + h / 2, oy - 1.5 * h);
    const di = [B[0] - A[0], B[1] - A[1]], dj = [Cq[0] - A[0], Cq[1] - A[1]], N = nx * ny;
    const RGB = new Uint8Array(N * 3), inside = new Uint8Array(N), cnt = new Map();
    const qkey = k => (RGB[k * 3] >> 4) << 8 | (RGB[k * 3 + 1] >> 4) << 4 | (RGB[k * 3 + 2] >> 4);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const ix = Math.floor(A[0] + i * di[0] + j * dj[0]), iy = Math.floor(A[1] + i * di[1] + j * dj[1]);
      if (ix < cr[0] || ix >= cr[2] || iy < cr[1] || iy >= cr[3] || ix < 0 || iy < 0 || ix >= P.w || iy >= P.h) continue;
      const k = j * nx + i, q = (iy * P.w + ix) * 4, a = P.data[q + 3] / 255;
      for (let ch = 0; ch < 3; ch++) RGB[k * 3 + ch] = Math.round(255 - (255 - P.data[q + ch]) * a);
      inside[k] = 1; const key = qkey(k); cnt.set(key, (cnt.get(key) || 0) + 1);
    }
    // Hintergrund = häufigste (vergröberte) Farbe, genau gemittelt
    let bk = 0, bn = -1; for (const [k, n] of cnt) if (n > bn) { bn = n; bk = k; }
    const bg = [0, 0, 0]; let nb = 0;
    for (let k = 0; k < N; k++) if (inside[k] && qkey(k) === bk) { bg[0] += RGB[k * 3]; bg[1] += RGB[k * 3 + 1]; bg[2] += RGB[k * 3 + 2]; nb++; }
    for (let ch = 0; ch < 3; ch++) bg[ch] = nb ? bg[ch] / nb : 255;
    const dist = new Uint8Array(N), hist = new Float64Array(256);
    for (let k = 0; k < N; k++) if (inside[k]) { const d = Math.max(Math.abs(RGB[k * 3] - bg[0]), Math.abs(RGB[k * 3 + 1] - bg[1]), Math.abs(RGB[k * 3 + 2] - bg[2])) | 0; dist[k] = d; hist[d]++; }
    const thr = +o.thr > 0 ? clamp(+o.thr, 1, 254) : clamp(otsu(hist), 25, 200);
    const wall0 = new Uint8Array(N); for (let k = 0; k < N; k++) wall0[k] = inside[k] && dist[k] > thr ? 1 : 0;
    const wall = dilateMask(wall0, nx, ny, gap), pass = new Uint8Array(N); for (let k = 0; k < N; k++) pass[k] = wall[k] ? 0 : 1;
    const starts = []; for (let i = 0; i < nx; i++) starts.push(i, (ny - 1) * nx + i); for (let j = 0; j < ny; j++) starts.push(j * nx, j * nx + nx - 1);
    const bgR = flood(pass, nx, starts);
    let body = new Uint8Array(N); for (let k = 0; k < N; k++) body[k] = bgR[k] ? 0 : 1;
    if (opn > 0) {   // Öffnen: Erosion (= Dilatation des Hintergrunds), dann Dilatation
      const inv = new Uint8Array(N); for (let k = 0; k < N; k++) inv[k] = body[k] ? 0 : 1;
      const er = dilateMask(inv, nx, ny, opn); for (let k = 0; k < N; k++) er[k] = er[k] ? 0 : 1;
      body = dilateMask(er, nx, ny, opn);
    }
    // Saatpunkt (nächste Körperzelle im Umkreis von 6 Zellen)
    let si = Math.floor((seed[0] - ox) / h), sj = Math.floor((oy - seed[1]) / h), sk = -1;
    for (let r = 0; r <= 6 && sk < 0; r++) for (let dj2 = -r; dj2 <= r && sk < 0; dj2++) for (let di2 = -r; di2 <= r; di2++) {
      const i = si + di2, j = sj + dj2; if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      if (body[j * nx + i]) { sk = j * nx + i; break; }
    }
    if (sk < 0) throw new Error('Der Klickpunkt liegt nicht in einer geschlossenen Kontur. In den Rumpf klicken — bei unterbrochenen Linien „Lücken schließen“ erhöhen.');
    si = sk % nx; sj = (sk - si) / nx;
    const comp = flood(body, nx, [sk]);
    let nc = 0, nin = 0; for (let k = 0; k < N; k++) { nc += comp[k]; nin += inside[k]; }
    if (nc > 0.7 * nin) throw new Error('Der Hintergrund lässt sich nicht vom Rumpf trennen (fast das ganze Bild ist „Körper“). Schwelle von Hand setzen oder das Bild zuschneiden.');
    // Läufe je Spalte, vom Saatpunkt aus nach vorn und hinten verfolgt
    const runs = i => { const out = []; let a = -1; for (let j = 0; j <= ny; j++) { const on = j < ny && comp[j * nx + i]; if (on && a < 0) a = j; else if (!on && a >= 0) { out.push([a, j - 1]); a = -1; } } return out; };
    const col = new Array(nx).fill(null);
    col[si] = runs(si).find(r => r[0] <= sj && r[1] >= sj);
    for (const dir of [1, -1]) {
      let prev = col[si];
      for (let i = si + dir; i >= 0 && i < nx; i += dir) {
        let best = null, bo = 0;
        for (const r of runs(i)) { const ov = Math.min(r[1], prev[1]) - Math.max(r[0], prev[0]) + 1; if (ov > bo) { bo = ov; best = r; } }
        if (!best) break; col[i] = prev = best;
      }
    }
    let i0 = si, i1 = si; while (i0 > 0 && col[i0 - 1]) i0--; while (i1 < nx - 1 && col[i1 + 1]) i1++;
    if (i1 - i0 < 10) throw new Error('Die gefundene Kontur ist zu klein.');
    // Rand auf die Strichmitte setzen: hinter der Verdickung (gap) die Strichbreite in der Originalmaske zählen;
    // breiter als SMAX = Fläche (Foto) -> Rand = erstes Wandpixel. Ergebnis in Zellkoordinaten (Kante).
    const SMAX = 14;
    const edge = (i, j, dir, horiz) => {
      const at = q => horiz ? wall0[j * nx + q] : wall0[q * nx + i], s0 = horiz ? i : j, lim = horiz ? nx : ny;
      let s = s0, k = 0; while (k <= gap + 1 && s >= 0 && s < lim && !at(s)) { s += dir; k++; }
      if (s < 0 || s >= lim || !at(s)) return s0 + (dir > 0 ? 0 : 1);
      let t = 0; while (t < SMAX && s + dir * t >= 0 && s + dir * t < lim && at(s + dir * t)) t++;
      const half = t < SMAX ? t / 2 : 0;
      return dir > 0 ? s + half : s + 1 - half;
    };
    const xs = [], top = [], bot = [];
    for (let i = i0; i <= i1; i++) { const r = col[i]; xs.push(ox + (i + 0.5) * h); top.push(oy - edge(i, r[0], 1, false) * h); bot.push(oy - edge(i, r[1], -1, false) * h); }
    const midRow = r => Math.round((r[0] + r[1]) / 2);
    const x0 = ox + edge(i0, midRow(col[i0]), 1, true) * h, x1 = ox + edge(i1, midRow(col[i1]), -1, true) * h;
    return { x0, x1, xs, top, bot, h, thr };
  }
  // Nachzeichnen aus mitgegebenen Linien (Bild aus der 3D-Bearbeitung): exakt, nur der angeklickte Körper — liegen dort mehrere
  // übereinander (Tragfläche über dem Rumpf), der kleinste. Je Spalte die Schnittpunkte der Senkrechten mit den Konturen
  // (gerade/ungerade), der Lauf wird wie beim Raster vom Klickpunkt aus verfolgt.
  function traceVec(kind, seed, vec) {
    const im = img[kind], iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
    const parts = vec.parts.map(pt => ({ name: pt.name, loops: pt.loops.map(L => L.map(q => imgToW(kind, [q[0] * iw, q[1] * ih]))) }));
    const inLoop = (L, x, y) => { let k = false; for (let i = 0, j = L.length - 1; i < L.length; j = i++) { const a = L[i], b = L[j]; if ((a[1] > y) !== (b[1] > y) && x < a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) k = !k; } return k; };
    const area = L => { let s = 0; for (let i = 0, j = L.length - 1; i < L.length; j = i++) s += (L[j][0] - L[i][0]) * (L[j][1] + L[i][1]); return Math.abs(s / 2); };
    let best = null, ba = Infinity;
    for (const pt of parts) {
      let ins = false, a = 0; for (const L of pt.loops) { if (inLoop(L, seed[0], seed[1])) ins = !ins; a += area(L); }
      if (ins && a < ba) { ba = a; best = pt; }
    }
    if (!best) throw new Error('Der Klickpunkt liegt in keinem Körper der übernommenen Kontur. In den Rumpf klicken.');
    let X0 = Infinity, X1 = -Infinity; for (const L of best.loops) for (const q of L) { X0 = Math.min(X0, q[0]); X1 = Math.max(X1, q[0]); }
    const h = Math.max(0.05, Math.min(0.5, (X1 - X0) / 3000));
    const runsAt = x => {
      const ys = [];
      for (const L of best.loops) for (let i = 0, j = L.length - 1; i < L.length; j = i++) { const a = L[i], b = L[j]; if ((a[0] > x) !== (b[0] > x)) ys.push(a[1] + (x - a[0]) * (b[1] - a[1]) / (b[0] - a[0])); }
      ys.sort((p, q) => q - p); const out = []; for (let k = 0; k + 1 < ys.length; k += 2) out.push([ys[k], ys[k + 1]]);   // [oben, unten]
      return out;
    };
    const seedRun = runsAt(seed[0]).find(r => r[0] >= seed[1] && r[1] <= seed[1]);
    if (!seedRun) throw new Error('Der Klickpunkt liegt in keinem Körper der übernommenen Kontur. In den Rumpf klicken.');
    const cols = new Map(); cols.set(0, seedRun);
    const n0 = Math.floor((seed[0] - X0) / h), n1 = Math.floor((X1 - seed[0]) / h);
    for (const [dir, nn] of [[1, n1], [-1, n0]]) {
      let prev = seedRun;
      for (let s = 1; s <= nn; s++) {
        let bst = null, bo = 0;
        for (const r of runsAt(seed[0] + dir * s * h)) { const ov = Math.min(r[0], prev[0]) - Math.max(r[1], prev[1]); if (ov > bo) { bo = ov; bst = r; } }
        if (!bst) break; cols.set(dir * s, bst); prev = bst;
      }
    }
    const ks = [...cols.keys()].sort((a, b) => a - b), xs = [], top = [], bot = [];
    for (const k of ks) { xs.push(seed[0] + k * h); top.push(cols.get(k)[0]); bot.push(cols.get(k)[1]); }
    if (xs.length < 10) throw new Error('Die gefundene Kontur ist zu klein.');
    // Nase/Heck: Ende des verfolgten Laufs, genauer an der Kontur (Spitze liegt höchstens eine Spalte weiter)
    let x0 = xs[0], x1 = xs[xs.length - 1];
    const yA = (top[0] + bot[0]) / 2, yB = (top[top.length - 1] + bot[bot.length - 1]) / 2;
    for (const L of best.loops) for (const q of L) {
      if (q[0] < x0 && q[0] > x0 - 1.5 * h && Math.abs(q[1] - yA) < 0.5 * (top[0] - bot[0]) + 2 * h) x0 = q[0];
      if (q[0] > x1 && q[0] < x1 + 1.5 * h && Math.abs(q[1] - yB) < 0.5 * (top[top.length - 1] - bot[bot.length - 1]) + 2 * h) x1 = q[0];
    }
    return { x0, x1, xs, top, bot, h, thr: 0, vec: best.name };
  }
  // Anbauten überbrücken. f = Werte nach außen positiv (Oberkante y, Unterkante −y, halbe Breite z) je Spalte xs;
  // eine Ausbuchtung beginnt, wo die Linie steiler als ang nach außen läuft (nicht an der Nase), und endet, wo sie ebenso
  // steil zurückkommt (Ausrundungen davor/dahinter eingeschlossen) — dazwischen Hermite mit den Steigungen außerhalb.
  // Ohne Rückweg im hinteren Rumpfteil (Leitwerk bis zum Heck): Gerade mit der Steigung davor. Ändert f, liefert Zonen [xa, xb].
  function bridgeBumps(xs, f, angDeg) {
    const n = f.length, L = xs[n - 1] - xs[0], k = Math.max(2, Math.round(0.006 * L / ((xs[1] - xs[0]) || 1))), tA = Math.tan(clamp(angDeg, 10, 89) * Math.PI / 180);
    if (n < 6 * k) return [];
    const s = new Float64Array(n); for (let i = 0; i < n; i++) { const a = Math.max(0, i - k), b = Math.min(n - 1, i + k); s[i] = (f[b] - f[a]) / ((xs[b] - xs[a]) || 1e-9); }
    const ivs = sign => { const out = []; let a = -1; for (let i = 0; i <= n; i++) { const on = i < n && sign * s[i] > tA; if (on && a < 0) a = i; else if (!on && a >= 0) { out.push([a, i - 1]); a = -1; } } return out; };
    const up = ivs(1), dn = ivs(-1), zones = [];
    const med = (a, b) => { const v = []; for (let i = Math.max(0, a); i <= Math.min(n - 1, b); i++) v.push(s[i]); v.sort((p, q) => p - q); return v.length ? v[v.length >> 1] : 0; };
    let after = -1;
    for (const R of up) {
      if (R[0] <= 2 * k || R[0] <= after) continue;   // Nase / schon überbrückt
      let a = R[0]; const bA = med(a - 8 * k, a - 2 * k);
      while (a > 1 && s[a - 1] - bA > 0.1 * tA && s[a - 1] <= s[a] + 1e-9) a--;
      // Ende = erster steiler Abfall, nach dem die Linie wieder nahe der Grundlinie (Gerade mit der Steigung davor) liegt —
      // kleine Absätze auf dem Anbau (Zacken, Ruderspalt) zählen nicht
      const base = i => f[a] + bA * (xs[i] - xs[a]);
      let top = 0; const F = dn.find(D => {
        if (D[0] <= R[1]) return false;
        for (let i = a; i <= D[0]; i++) top = Math.max(top, f[i] - base(i));
        return f[D[1]] - base(D[1]) < 0.25 * top;
      });
      let b = -1, bB = bA;
      if (F && F[1] < n - 1 - 2 * k) {
        b = F[1]; bB = med(b + 2 * k, b + 8 * k);
        while (b < n - 2 && bB - s[b + 1] > 0.1 * tA && s[b + 1] >= s[b] - 1e-9) b++;
      } else if (xs[a] > xs[0] + 0.55 * L) b = n - 1;
      else continue;
      const xa = xs[a], xb = xs[b], Hx = xb - xa, fa = f[a], fb = f[b];
      for (let i = a + 1; i <= b; i++) {
        const t = (xs[i] - xa) / Hx, t2 = t * t, t3 = t2 * t;
        const v = b === n - 1 ? fa + bA * (xs[i] - xa) : (2 * t3 - 3 * t2 + 1) * fa + (t3 - 2 * t2 + t) * Hx * bA + (-2 * t3 + 3 * t2) * fb + (t3 - t2) * Hx * bB;
        f[i] = Math.min(f[i], v);
      }
      zones.push([xa, xb]); after = b;
    }
    return zones;
  }
  let traceShow = null, traceUndo = null;   // Rohkontur zur Anzeige / Stand vor dem letzten Nachzeichnen (nur RAM)
  const traceBlocked = () => { const F = FIXK(); return anyLineLocked() || !!F.wid || !!F.fr || formers().some(f => f.pin); };
  function runTrace(kind, seed) {
    if (kind !== 'side' && kind !== 'top') return;
    if (traceBlocked()) { alert(T('Nachzeichnen ändert die Umrisse und verschiebt die Spanten — bitte zuerst die Fixierungen lösen (Gruppe „Fixieren“).')); return; }
    const o = TRC(); let R;
    try { R = traceRaw(kind, seed); } catch (err) { alert(T(err.message)); return; }
    const n = R.xs.length, zones = [];
    // Werte je Spalte (Seitenansicht: Ober-/Unterkante, Unterkante nach außen positiv; Draufsicht: halber Abstand der Ränder)
    const cols = kind === 'side' ? { top: R.top.slice(), bot: R.bot.map(v => -v) } : { w: R.top.map((t, i) => Math.max(0, (t - R.bot[i]) / 2)) };
    if (o.bridge) for (const k in cols) zones.push(...bridgeBumps(R.xs, cols[k], +o.ang || 50));
    if (cols.bot) cols.bot = cols.bot.map(v => -v);
    traceShow = { kind, xs: R.xs, raw: [R.top, R.bot], zones };
    // Seitenansicht legt Nase/Heck fest; die Draufsicht wird auf die vorhandene Länge gestreckt
    const o2 = outlines(), ox0 = o2.top[0].x, ox1 = o2.top[o2.top.length - 1].x, X0 = R.x0, X1 = R.x1;
    const map = kind === 'side' ? (x => x) : (x => ox0 + (x - X0) * (ox1 - ox0) / ((X1 - X0) || 1));
    // Stationen: an den Enden dichter, Wert = Mittel der Spalten im Umkreis (glättet die Pixelstufen)
    const NS = 300, D = [], keys = Object.keys(cols), hw = Math.max(R.h, 0.6 * (X1 - X0) / NS);
    for (let q = 1; q < NS; q++) {
      const u = q / NS, x = X0 + (X1 - X0) * (0.5 * u + 0.5 * (1 - Math.cos(Math.PI * u)) / 2), d = { x: map(x) };
      let ok = true;
      for (const k of keys) { let a = 0, m = 0; for (let i = 0; i < n; i++) if (Math.abs(R.xs[i] - x) <= hw) { a += cols[k][i]; m++; } if (m) d[k] = a / m; else ok = false; }
      if (ok && (!D.length || d.x - D[D.length - 1].x > 1e-6)) D.push(d);
    }
    if (D.length < 8) { alert(T('Die gefundene Kontur ist zu klein.')); return; }
    const nl = D[D.length - 1];
    if (kind === 'side') { const yN = (D[0].top + D[0].bot) / 2; D.unshift({ x: X0, top: yN, bot: yN }); D.push({ x: X1, top: nl.top, bot: nl.bot }); }
    else { D.unshift({ x: ox0, w: 0 }); D.push({ x: ox1, w: nl.w }); }
    const tol = +o.tol > 0 ? +o.tol : Math.max(0.2, 2 * R.h), maxN = clamp(Math.round(+o.max || 30), 4, 80), mode = splMode();
    const res = {};
    for (const key of keys) {   // mit und ohne runde Nase einpassen, die bessere/sparsamere Linie nehmen (wie fromMesh)
      const a = fitOutLine(D, key, tol, maxN, true, mode), b = fitOutLine(D, key, tol, maxN, false, mode);
      res[key] = ((b.err <= tol && (a.err > tol || b.P.length < a.P.length)) || (a.err > tol && b.err < a.err) ? b : a).P;
    }
    traceUndo = JSON.stringify({ out: state.cfg.rproOut, fr: state.cfg.rproFr });
    if (kind === 'side') {
      // neue Länge: Draufsicht und Spanten maßstäblich auf Nase/Heck des Bilds mitnehmen
      const f = (X1 - X0) / ((ox1 - ox0) || 1), mx = x => X0 + (x - ox0) * f;
      for (const p of o2.w) { p.x = r2(mx(p.x)); if (p.c) { p.i = [p.i[0] * f, p.i[1]]; p.o = [p.o[0] * f, p.o[1]]; } }
      const fr = formers();
      for (const q of fr) if (q.jmp !== 'b') q.x = r2(clamp(mx(q.x), X0, X1));
      for (const q of fr) if (q.jmp === 'b') { const p = jumpPartner(q); q.x = p ? r2(p.x + JG) : r2(clamp(mx(q.x), X0, X1)); }
      o2.top = res.top; o2.bot = res.bot;
    } else o2.w = res.w;
    S('rproPt', null);
    imgTool = 'trace'; setImgTool(null);   // Werkzeug beenden, Seitenleiste + Bild neu
  }
  function undoTrace() {
    if (!traceUndo) return;
    const u = JSON.parse(traceUndo); state.cfg.rproOut = u.out; state.cfg.rproFr = u.fr; traceUndo = null; traceShow = null;
    buildSidebar(); draw();
  }
  // Erkannte Rohkontur (orange) und überbrückte Anbauten (rot hinterlegt) in der Ansicht des Bilds.
  function drawTrace(kind, xf) {
    const t = traceShow; if (!t || t.kind !== kind || !TRC().show) return;
    for (const z of t.zones) { const a = xf.P(z[0], 0), b = xf.P(z[1], 0); ctx.fillStyle = 'rgba(255,80,80,.10)'; ctx.fillRect(Math.min(a.x, b.x), 0, Math.abs(b.x - a.x), H); }
    ctx.strokeStyle = 'rgba(255,140,40,.95)'; ctx.lineWidth = 1.2;
    for (const vs of t.raw) { ctx.beginPath(); vs.forEach((v, i) => { const p = xf.P(t.xs[i], v); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); }
  }
  // Dickenlinie (Y der breitesten Stelle über x), nur der reine Rumpf (ohne Anbauten).
  function widLine() {
    const Nv = Math.max(8, Math.round(C('rproNv'))), wid = [];
    for (let b = 0; b <= Nv; b++) {
      const x = model.x0 + (model.x1 - model.x0) * b / Nv, P = bodyHalf(model, x);
      let best = P[0]; for (const q of P) if (q[1] > best[1]) best = q;
      wid.push([x, best[0], best[1]]);
    }
    return wid;
  }
  const HANDLE_R = 6;
  const LINE_NAME = { top: 'Oberkante', bot: 'Unterkante', w: 'halbe Breite' };
  const TYPE_NAME = { egg: 'Ei (zwei Ellipsen)', tri: 'Dreieck/Tropfen, gerundet', rect: 'Rechteck/Trapez, gerundet', circle: 'Kreis', free: 'frei (Knoten, Kurven und Geraden)' };
  let lastSel = 'fr';   // zuletzt gewählt: 'fr' Spant | 'pt' Umrisspunkt (Entf löscht das)
  function selPt() { const s = C('rproPt'), o = outlines(); return s && o[s.line] && o[s.line][s.k] ? s : null; }
  // Griffe je Ansicht. t: 'pt' Umrisspunkt, 'ptan' dessen Tangente, 'fr' Spantlage, 'yw' breiteste Stelle (Ei),
  // 'node'/'ntan' Knoten/Tangente (freier Spant), 'rtx'/'rty'/'rby'/'rbx' Eckradien, 'sl' Neigung, 'dia' Kreis.
  function handles(kind) {
    const out = [];
    if (!model || !model.L || !model.P) return out;
    const o = outlines(), fr = formers(), sel = selIdx(), sp = selPt(), all = !!C('rproShowTan');
    const lineH = line => {
      const pts = o[line];
      pts.forEach((p, k) => {
        out.push({ t: 'pt', line, k, u: p.x, v: p.v, c: p.c });
        if (p.c && splMode() !== 'bs' && (all || (sp && sp.line === line && sp.k === k))) {
          const tg = outTan(pts, k);
          if (k > 0 && !tanFixed(pts, k, 'i')) out.push({ t: 'ptan', line, k, tan: 'i', u: p.x + tg.i[0], v: p.v + tg.i[1], pu: p.x, pv: p.v });
          if (k < pts.length - 1 && !tanFixed(pts, k, 'o')) out.push({ t: 'ptan', line, k, tan: 'o', u: p.x + tg.o[0], v: p.v + tg.o[1], pu: p.x, pv: p.v });
        }
      });
    };
    if (kind === 'side' && model.kh) {   // Kabinenhaube: Ecken, Enden (Winkel), Wölbung der Splines
      const q = model.kh;
      if (q.H) for (const h of q.H) out.push({ t: 'kh', k: h.k, u: h.p[0], v: h.p[1] });
      else for (const [id, p] of [['c2', q.P2], ['c3', q.P3], ['t1', q.P1], ['t4', q.P4], ['mF', q.mF], ['mB', q.mB], ['mR', q.mR]]) if (p) out.push({ t: 'kh', k: id, u: p[0], v: p[1] });
    }
    if (kind === 'side' && model.fin && model.fin.free) model.fin.Pn.forEach((p, i) => out.push({ t: 'fin', k: i, u: p[0], v: p[1] }));   // freier Leitwerksumriss
    // Leitlinien der Tragflächen-Anformung (Draufsicht): Stützpunkte ziehen
    if (kind === 'top' && model.wing && model.wing.mode === 'fil' && model.wing.gLE) {
      const g = model.wing;
      g.gLE.K.slice(1, -1).forEach((p, i) => out.push({ t: 'wg', k: 'le' + i, u: p[0], v: p[1] }));
      g.gTE.K.slice(1, -1).forEach((p, i) => out.push({ t: 'wg', k: 'te' + i, u: p[0], v: p[1] }));
    }
    // Leitlinien der V-Leitwerks-Anformung (Draufsicht bzw. bei steilem V Seitenansicht)
    { const gv = model.vt && vtGuideView(model.vt);
      if (gv && gv.kind === kind) { const gw = model.vt.gw;
        gw.gLE.K.slice(1, -1).forEach((p, i) => out.push({ t: 'vg', k: 'le' + i, u: p[0], v: gv.toV(p[1], gv.hLE) }));
        gw.gTE.K.slice(1, -1).forEach((p, i) => out.push({ t: 'vg', k: 'te' + i, u: p[0], v: gv.toV(p[1], gv.hTE) })); } }
    // Schnittlinie der Leitwerks-Anformung: Enden = Winkel (anderes Ende bleibt), Mitte = Höhe
    if (kind === 'side' && model.fin && model.fin.ff) {
      const q = model.fin.ff, xa = Math.min(q.x0, model.fin.xs) - 10, xb = Math.max(q.x1, model.fin.xe) + 10;
      out.push({ t: 'fcut', k: 0, u: xa, v: q.yAt(xa) }, { t: 'fcut', k: 2, u: q.xr, v: q.yA }, { t: 'fcut', k: 1, u: xb, v: q.yAt(xb) });
      // Leitlinien der Leitwerks-Anformung (Seitenansicht)
      if (q.gFrame) { const L = FN().gLE; L.forEach((p, i) => { if (i > 0 && i < L.length - 1) { const w = q.gFrame.toW(+p.x, +p.v); out.push({ t: 'fg', k: 'le' + i, u: w[0], v: w[1] }); } }); }
      if (q.gTE) q.gTE.K.slice(1, -1).forEach((p, i) => out.push({ t: 'fg', k: 'te' + i, u: p[0], v: p[1] }));
    }
    if (kind === 'side' || kind === 'top') {
      if (kind === 'side') { lineH('top'); lineH('bot'); } else lineH('w');
      fr.forEach((f, i) => {
        const b = boxAt(model, f.x);
        out.push({ t: 'fr', i, u: f.x, v: kind === 'side' ? b.bot - 18 : -b.w - 18 });
        if (kind === 'side' && (f.type === 'egg' || f.type === 'tri') && model.P[i]) out.push({ t: 'yw', i, u: f.x, v: model.P[i].yw, ctl: isCtl(model, i, 'yw') });
      });
    } else if (kind === 'sec') {
      const f = fr[sel], P = model.P[sel]; if (!f || !P) return out;
      const b = boxAt(model, f.x);
      if (f.type === 'free') {
        const h = b.h, w = b.w, n = f.nodes.length;
        f.nodes.forEach((q, k) => {
          const y = b.bot + q.y * h, z = q.z * w;
          if (k > 0 && k < n - 1) out.push({ t: 'node', i: sel, k, u: z, v: y, locked: f.lock });   // Endknoten = Ober-/Unterkante (blaue Griffe)
          // gerade Abschnitte haben keine Tangentengriffe
          if (k > 0 && !f.nodes[k - 1].l) out.push({ t: 'ntan', i: sel, k, tan: 'i', u: z + q.i[1] * w, v: y + q.i[0] * h, pu: z, pv: y, locked: f.lock });
          if (k < n - 1 && !q.l) out.push({ t: 'ntan', i: sel, k, tan: 'o', u: z + q.o[1] * w, v: y + q.o[0] * h, pu: z, pv: y, locked: f.lock });
        });
      } else if (f.type === 'egg' || f.type === 'tri') out.push({ t: 'yw', i: sel, u: b.w, v: P.yw, ctl: isCtl(model, sel, 'yw'), sec: true });
      else if (f.type === 'rect') {
        const g = rectNodes(P, b).geo, ct = isCtl(model, sel, 'rt'), cb = isCtl(model, sel, 'rb');
        out.push({ t: 'rtx', i: sel, u: g.B[1], v: g.B[0], ctl: ct }, { t: 'rty', i: sel, u: g.Cs[1], v: g.Cs[0], ctl: ct },
          { t: 'rby', i: sel, u: g.D[1], v: g.D[0], ctl: cb }, { t: 'rbx', i: sel, u: g.E[1], v: g.E[0], ctl: cb },
          { t: 'sl', i: sel, u: g.Ct[1], v: g.Ct[0], ctl: isCtl(model, sel, 'sl') });
      }
      // Höhe oben/unten und Breite — gekoppelt an Seiten- und Draufsicht (Ei: Raute trägt die Breite mit)
      out.push({ t: 'st', i: sel, u: 0, v: b.top }, { t: 'sb', i: sel, u: 0, v: b.bot });
      if (f.type !== 'egg' && f.type !== 'tri') out.push({ t: 'sw', i: sel, u: b.w, v: f.type === 'free' ? b.bot + b.h * widestY(f.nodes) : (b.top + b.bot) / 2 });
    }
    // fixierte Ansichten/Spanten: Griffe grau, nicht ziehbar
    const FX = FIXK();
    for (const h of out) {
      if (h.i != null && pinned(fr[h.i])) h.locked = true;
      else if ((h.t === 'pt' || h.t === 'ptan') && (lineLocked(h.line) || (h.t === 'pt' && boundFr(h.u).some(pinned)))) h.locked = true;
      else if (h.t === 'yw' && FX.wid && (!h.sec || lineLocked('w'))) h.locked = true;   // Spantansicht: Raute trägt auch die Breite
      else if ((h.t === 'st' && lineLocked('top')) || (h.t === 'sb' && lineLocked('bot')) || (h.t === 'sw' && lineLocked('w'))) h.locked = true;
    }
    return out;
  }
  const sameH = (a, b) => !!a === !!b && (!a || (a.t === b.t && a.line === b.line && a.k === b.k && a.i === b.i && a.tan === b.tan));
  // Verlauf der Verrundungskanten (DevFus: violett oben, cyan unten) in Seiten-/Draufsicht.
  function filletLines(kind) {
    const FR = model.FR, up = [], lo = [], segs = [];
    for (let j = 0; j + 1 < FR.length; j++) {
      if (FR[j].type !== 'rect' || FR[j + 1].type !== 'rect') { if (up.length) { segs.push([up.splice(0), lo.splice(0)]); } continue; }
      for (let q = 0; q <= 16; q++) {
        const x = FR[j].x + (FR[j + 1].x - FR[j].x) * q / 16, b = boxBase(model, x), g = rectNodes(paramsAt(model, x, model.run[j]), b).geo;
        if (kind === 'side') { up.push([x, g.Cs[0]]); lo.push([x, g.D[0]]); } else { up.push([x, g.B[1]]); lo.push([x, g.E[1]]); }
      }
    }
    if (up.length) segs.push([up, lo]);
    return segs;
  }
  // Krümmungskamm (Zähne senkrecht zur Kurve, Länge ~ Krümmung; über dem Bezugswert logarithmisch gestaucht, damit
  // die Nase nicht alles überdeckt) mit Hüllkurve, Wendepunkte als Ringe.
  // S: curvSamples in Weltkoordinaten (u, v), mirror: auch gespiegelt (v -> -v) zeichnen. kRef: gemeinsamer Maßstab.
  // Kammmaßstab robust (85 %-Wert), damit die starke Nasenkrümmung den Rest nicht plattdrückt.
  // Gewichtet nach Bogenlänge (die Abtastung ist je Segment gleich dicht — kurze Nasensegmente zählten sonst zu viel).
  function kRob(...lists) {
    const a = []; let tot = 0;
    for (const L of lists) for (let i = 1; i < L.length; i++) { const w = Math.hypot(L[i].x - L[i - 1].x, L[i].v - L[i - 1].v); a.push([Math.abs(L[i].k), w]); tot += w; }
    a.sort((p, q) => p[0] - q[0]); let acc = 0;
    for (const [k, w] of a) { acc += w; if (acc >= 0.85 * tot) return k; }
    return a.length ? a[a.length - 1][0] : 0;
  }
  function drawComb(xf, S, kRef, mirror) {
    if (!S.length || !(kRef > 1e-12)) return;
    const len = Math.max(5, +C('rproCombLen') || 40) / xf.sc / kRef;   // mm je Krümmungseinheit
    for (const sg of (mirror ? [1, -1] : [1])) {
      const env = [];
      ctx.strokeStyle = 'rgba(255,150,210,.35)'; ctx.lineWidth = 1; ctx.beginPath();
      S.forEach((q, i) => {
        const t = Math.abs(q.k) / kRef, kk = Math.sign(q.k) * kRef * (t <= 1 ? t : Math.min(1.8, 1 + 0.5 * Math.log(t))), tip = [q.x - q.n[0] * kk * len, (q.v - q.n[1] * kk * len) * sg], a = xf.P(q.x, q.v * sg), b = xf.P(tip[0], tip[1]);
        if (i % 2 === 0) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
        env.push(b);
      });
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,120,200,.9)'; ctx.lineWidth = 1.2; ctx.beginPath();
      env.forEach((b, i) => i ? ctx.lineTo(b.x, b.y) : ctx.moveTo(b.x, b.y)); ctx.stroke();
      ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2;
      for (const q of curvStats(S).infl) { const a = xf.P(q.x, q.v * sg); ctx.beginPath(); ctx.arc(a.x, a.y, 6, 0, Math.PI * 2); ctx.stroke(); }
    }
  }
  // Kurzbericht je Linie: Wendepunkte und kleinster Radius.
  function combInfo(lines) {
    return lines.map(k => { const st = curvStats(curvSamples(model.L[k], 24)); return T(LINE_NAME[k]) + ': ' + st.infl.length + ' ' + T('Wendepunkte') + ', R min ' + (isFinite(st.rmin) ? st.rmin.toFixed(0) + ' mm' : '∞'); }).join(' · ');
  }
  // Infozeile: was in dieser Ansicht fixiert ist ('' = nichts).
  function fixInfo(kind) {
    const F = FIXK(), fr = formers(), sel = selIdx(), fl = [];
    if (kind === 'side' && F.side) fl.push(T('Ober-/Unterkante'));
    if (kind === 'side' && F.wid) fl.push(T('Dickenlinie'));
    if (kind === 'top' && F.top) fl.push(T('halbe Breite'));
    if (F.fr) fl.push(T('alle Spanten'));
    else if (kind === 'sec') { if (pinned(fr[sel])) fl.push(T('dieser Spant')); }
    else { const L = fr.map((q, i) => q.pin ? i + 1 : 0).filter(Boolean); if (L.length) fl.push(T('Spanten') + ' ' + L.join(', ')); }
    return fl.length ? '<br><span style="color:#ffd27a">🔒 ' + T('fixiert:') + ' ' + fl.join(' · ') + '</span>' : '';
  }
  function draw2d(kind) {
    ctx.fillStyle = col('--bg', '#0f1216'); ctx.fillRect(0, 0, W, H);
    const xf = view2dBase(kind);
    const b = model && model.bounds ? model.bounds : null;
    if (b) { const iu = kind === 'side' || kind === 'top' ? 0 : 2, iv = kind === 'top' ? 2 : 1; grid2d(xf, b.mn[iu] - 100, b.mx[iu] + 100, b.mn[iv] - 100, b.mx[iv] + 100); }
    drawImg(kind, xf);
    const sel = selIdx(), fr = formers();
    const line = (pts, iv, colr, wdt, mirror, dash) => {
      ctx.strokeStyle = colr; ctx.lineWidth = wdt; ctx.setLineDash(dash || []); ctx.beginPath();
      pts.forEach((q, i) => { const p = xf.P(q[0], q[iv]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke();
      if (mirror) { ctx.beginPath(); pts.forEach((q, i) => { const p = xf.P(q[0], -q[iv]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); }
      ctx.setLineDash([]);
    };
    if (model && model.G) {
      const frLines = (lo, hi) => {
        ctx.font = '10px system-ui';
        model.FR.forEach((f, i) => {
          const bx = boxAt(model, f.x), a = xf.P(f.x, lo(bx)), c = xf.P(f.x, hi(bx)), bad = model.bad && model.bad[i];
          ctx.strokeStyle = bad ? 'rgba(255,80,80,.95)' : i === sel ? 'rgba(255,120,120,.9)' : 'rgba(180,200,220,.35)'; ctx.lineWidth = i === sel ? 1.6 : 1;
          if (i !== sel) ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = bad ? '#f66' : i === sel ? '#ff9a9a' : 'rgba(200,215,230,.7)'; ctx.fillText(String(i + 1), c.x - 3, c.y - 4);
        });
      };
      // gerade Abschnitte der Umrisse hervorheben
      const straightMarks = (ln, mir) => { const q = outlines()[ln]; q.forEach((p, k) => { if (p.l && k < q.length - 1) line([[p.x, p.v], [q[k + 1].x, q[k + 1].v]], 1, '#ffd166', 3, mir); }); };
      const circ = model.circ && model.circ.length, eff = key => { const pts = []; for (let q = 0; q <= 240; q++) { const x = model.x0 + (model.x1 - model.x0) * q / 240, bx = boxAt(model, x); pts.push([x, bx[key]]); } return pts; };
      if (kind === 'side') {
        line(linePts(model.L.top, 24), 1, '#4fc3f7', 2); line(linePts(model.L.bot, 24), 1, '#4fc3f7', 2);
        straightMarks('top'); straightMarks('bot');
        if (splMode() === 'bs') for (const k of ['top', 'bot']) line(outlines()[k].map(p => [p.x, p.v]), 1, 'rgba(90,169,255,.45)', 1, false, [3, 3]);
        if (C('rproComb')) { const St = curvSamples(model.L.top, 24), Sb = curvSamples(model.L.bot, 24), kr = kRob(St, Sb); drawComb(xf, St, kr); drawComb(xf, Sb, kr); }
        if (circ) { line(eff('top'), 1, 'rgba(255,190,80,.8)', 1.2, false, [5, 3]); line(eff('bot'), 1, 'rgba(255,190,80,.8)', 1.2, false, [5, 3]); }
        line(widLine(), 1, 'rgba(255,190,80,.7)', 1);
        for (const [u, l] of filletLines('side')) { line(u, 1, 'rgba(200,120,255,.85)', 1); line(l, 1, 'rgba(80,220,230,.85)', 1); }
        frLines(bx => bx.bot - 10, bx => bx.top + 10);
        drawAttach('side', xf); drawCanopy('side', xf); drawBoom('side', xf); drawVt('side', xf);
      } else if (kind === 'top') {
        line(linePts(model.L.w, 24), 1, '#4fc3f7', 2, true);
        straightMarks('w', true);
        if (splMode() === 'bs') line(outlines().w.map(p => [p.x, p.v]), 1, 'rgba(90,169,255,.45)', 1, false, [3, 3]);
        if (C('rproComb')) { const Sw = curvSamples(model.L.w, 24); drawComb(xf, Sw, kRob(Sw), true); }
        if (circ) line(eff('w'), 1, 'rgba(255,190,80,.8)', 1.2, true, [5, 3]);
        for (const [u, l] of filletLines('top')) { line(u, 1, 'rgba(200,120,255,.85)', 1, true); line(l, 1, 'rgba(80,220,230,.85)', 1, true); }
        const a = xf.P(model.bounds.mn[0], 0), c = xf.P(model.bounds.mx[0], 0); ctx.strokeStyle = 'rgba(180,200,220,.4)'; ctx.setLineDash([8, 4]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke(); ctx.setLineDash([]);
        frLines(bx => -bx.w - 10, bx => bx.w + 10);
        drawAttach('top', xf); drawCanopy('top', xf); drawBoom('top', xf); drawVt('top', xf);
      } else {
        // Spantansicht ('sec'): alle Spanten blass, gewählter rot (anklickbar). Schnittansicht ('cut'): Schnitt bei rproCutX blau.
        const cut = kind === 'cut';
        const frCurve = (f, i) => {
          const pts = secHalf(model, f.x), on = !cut && i === sel; ctx.lineWidth = on ? 2 : 1; ctx.strokeStyle = on ? 'rgba(255,120,120,.9)' : 'rgba(180,200,220,.22)';
          for (const sg of [1, -1]) { ctx.beginPath(); pts.forEach((q, k) => { const p = xf.P(sg * q[2], q[1]); k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); }
        };
        model.FR.forEach((f, i) => { if (cut || i !== sel) frCurve(f, i); });
        if (!cut && model.FR[sel]) frCurve(model.FR[sel], sel);
        ctx.lineWidth = 1;
        const f = fr[sel];
        if (!cut && f) {   // Nummer des bearbeiteten Spants groß über der Kurve
          const p = xf.P(0, boxAt(model, f.x).top);
          ctx.font = 'bold 16px system-ui'; ctx.fillStyle = '#ff9a9a'; ctx.textAlign = 'center';
          ctx.fillText(T('Spant') + ' ' + (sel + 1) + ' / ' + fr.length, p.x, p.y - 16); ctx.textAlign = 'left';
        }
        if (!cut && f && f.type === 'rect' && model.P[sel]) {
          // Trapez (ohne Verrundung) gestrichelt
          const g = rectNodes(model.P[sel], boxAt(model, f.x)).geo;
          ctx.strokeStyle = 'rgba(255,170,80,.55)'; ctx.setLineDash([3, 3]); ctx.beginPath();
          [[0, g.Ct[0]], [g.Ct[1], g.Ct[0]], [g.Cb[1], g.Cb[0]], [0, g.Cb[0]]].forEach((q, k) => { const p = xf.P(q[0], q[1]); k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); ctx.setLineDash([]);
        }
        const x = cut ? (+C('rproCutX') || 0) : f ? f.x : 0, loops = sectionAt(x);
        let secInfl = null;
        if (C('rproComb') && x >= model.x0 && x <= model.x1) {
          const sp2 = secParams(model, x), segs = [];
          for (let k = 0; k + 1 < sp2.nodes.length; k++) segs.push({ P: segP(sp2.nodes[k], sp2.nodes[k + 1]).map(q => [q[1], q[0]]) });
          const Ss = curvSamples(segs, 24); drawComb(xf, Ss.map(q => ({ x: q.x, v: q.v, k: q.k, n: q.n })), kRob(Ss));
          // gespiegelte Hälfte: z -> -z
          drawComb(xf, Ss.map(q => ({ x: -q.x, v: q.v, k: -q.k, n: [-q.n[0], q.n[1]] })), kRob(Ss));
          secInfl = curvStats(Ss);
        }
        ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 2.2;
        if (cut) for (const Lp of loops) { ctx.beginPath(); Lp.forEach((q, i) => { const p = xf.P(q[2], q[1]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath(); ctx.stroke(); ctx.fillStyle = 'rgba(79,195,247,.15)'; ctx.fill(); }
        drawCanopy(kind, xf);
        if (cut) drawVtCut(x, xf);
        let txt = cut ? T('Schnitt bei X =') + ' ' + x.toFixed(1) + ' mm' : f ? T('Spant') + ' ' + (sel + 1) + ' (' + T('rot') + ') · X ' + f.x.toFixed(1) + ' mm · ' + T(TYPE_NAME[f.type]) : '';
        if (loops.length) {
          let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
          for (const Lp of loops) for (const q of Lp) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]); }
          txt += ' · ' + (z1 - z0).toFixed(1) + ' × ' + (y1 - y0).toFixed(1) + ' mm · ' + T('Fläche') + ' ' + (loops.reduce((a, Lp) => a + loopArea(Lp), 0) / 100).toFixed(2) + ' cm²';
        } else txt += ' · ' + T('Schnittebene trifft den Rumpf nicht.');
        if (secInfl) txt += '<br>' + T('Querschnitt (Rumpf, halbe Seite):') + ' ' + secInfl.infl.length + ' ' + T('Wendepunkte') + ', R min ' + (isFinite(secInfl.rmin) ? secInfl.rmin.toFixed(1) + ' mm' : '∞');
        if (cut) txt += '<br><span style="opacity:.7">' + T('Schnitt an beliebiger Stelle, mit Anbauten (Tragflächenübergang, Seitenleitwerk) · Spanten blass als Bezug · Pfeiltasten oder Regler im Bedienfeld = Schnittlage · Ziehen = schieben · Rad = Zoom') + '</span>';
        else if (f) {
          if (model.bad && model.bad[sel]) txt += ' · <span style="color:#f88">' + model.bad[sel] + '</span>';
          const hint2 = { free: 'Knoten (Kreis) und Tangenten (grüne Quadrate) ziehen · Strg = Tangente einseitig (Ecke) · Doppelklick auf die Kurve = Knoten einfügen · gerade Abschnitte links in der Knotentabelle (Haken „gerade“)',
            tri: 'Raute = breiteste Stelle (Höhe und Breite) · blaue Griffe oben/unten = Ober-/Unterkante · Völligkeit oben/unten links einstellen · für noch freiere Formen die Querschnittsform auf „frei“ stellen (Form bleibt, Knoten beliebig ergänzen)',
            egg: 'Raute = breiteste Stelle (Höhe = Steuerwert, seitlich = Breite in der Draufsicht) · blaue Griffe oben/unten = Ober-/Unterkante in der Seitenansicht',
            rect: 'Blau = Eckradien (X oben/unten, Y oben/unten), Orange = Seitenneigung an der oberen Ecke — Ziehen macht den Spant für diese Werte zum Steuerspant',
            circle: 'Blaue Griffe oben/unten/seitlich = Durchmesser (ändert Seiten- und Draufsicht mit; fester Durchmesser: oben/unten verschiebt den Kreis)' }[f.type];
          txt += '<br><span style="opacity:.7">' + T(hint2) + ' · ' + T('Spant anklicken = auswählen (Menü links klappt auf) · Pfeiltasten = voriger/nächster Spant · Alt+Ziehen/Rad = Bild') + '</span>';
          txt += fixInfo('sec');
        }
        setInfo(txt);
      }
    }
    // Griffe
    const hs = handles(kind), sp = selPt();
    for (const h of hs) {
      if (h.t !== 'ptan' && h.t !== 'ntan') continue;
      const p = xf.P(h.u, h.v), q = xf.P(h.pu, h.pv);
      ctx.strokeStyle = 'rgba(140,220,160,.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    for (const h of hs) {
      const p = xf.P(h.u, h.v), isHot = sameH(hot, h);
      const isSelPt = h.t === 'pt' && sp && sp.line === h.line && sp.k === h.k, isSelFr = (h.t === 'fr' || h.t === 'yw') && h.i === sel;
      let fill;
      if (h.t === 'pt') fill = h.c ? '#ff6b6b' : '#5aa9ff';
      else if (h.t === 'ptan' || h.t === 'ntan') fill = 'rgba(140,220,160,.95)';
      else if (h.t === 'fr') fill = isSelFr ? '#ff8a8a' : '#6fdc8c';
      else if (h.t === 'yw' || h.t === 'sl' || h.t === 'dia') fill = 'rgba(255,170,70,.95)';
      else if (h.t === 'st' || h.t === 'sb' || h.t === 'sw') fill = '#4fc3f7';
      else if (h.t === 'node') fill = '#ffd27a';
      else if (h.t === 'kh') fill = '#ffe14d';
      else if (h.t === 'fin') fill = h.k === finSel ? '#ffffff' : '#c792ff';
      else if (h.t === 'fcut') fill = '#e7b6ff';
      else if (h.t === 'wg') fill = '#9cf0b4';
      else if (h.t === 'vg') fill = '#d9b8ff';
      else if (h.t === 'fg') fill = '#f0c8ff';
      else fill = '#5aa9ff';
      if (h.locked) fill = 'rgba(150,160,170,.9)';
      ctx.fillStyle = isHot ? '#fff' : fill;
      ctx.strokeStyle = (isSelPt || (h.t === 'node' && h.k === selNode) || (isSelFr && h.t === 'fr')) ? '#fff' : 'rgba(0,0,0,.6)';
      ctx.lineWidth = (isSelPt || isSelFr) ? 1.8 : 1;
      ctx.beginPath();
      if (h.t === 'ptan' || h.t === 'ntan') ctx.rect(p.x - 3.5, p.y - 3.5, 7, 7);
      else if (h.t === 'fr') ctx.rect(p.x - 5, p.y - 5, 10, 10);
      else if (h.t === 'pt' && h.c) ctx.rect(p.x - 4.5, p.y - 4.5, 9, 9);
      else if (h.t === 'yw') { ctx.moveTo(p.x, p.y - 5.5); ctx.lineTo(p.x + 5.5, p.y); ctx.lineTo(p.x, p.y + 5.5); ctx.lineTo(p.x - 5.5, p.y); ctx.closePath(); }
      else ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      if (h.ctl === false) { ctx.lineWidth = 2; ctx.strokeStyle = isHot ? '#fff' : fill; ctx.stroke(); }   // interpoliert: hohl
      else { ctx.fill(); ctx.stroke(); }
      if (kind === 'sec' && h.t !== 'ptan' && h.t !== 'ntan') { const pm = xf.P(-h.u, h.v); ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(pm.x, pm.y, 2.2, 0, Math.PI * 2); ctx.fill(); }
    }
    if (kind === 'side' || kind === 'top') {
      const f = fr[sel];
      let txt = (kind === 'side' ? T('Seitenansicht') : T('Draufsicht'));
      if (sp) { const p = outlines()[sp.line][sp.k]; txt += ' · ' + T(LINE_NAME[sp.line]) + ' ' + T('Punkt') + ' ' + (sp.k + 1) + ': X ' + p.x.toFixed(1) + ' · ' + p.v.toFixed(1) + ' mm · ' + T(['glatt (auto)', 'glatt mit Tangente', 'Ecke'][p.c]); }
      if (f) txt += '<br>' + T('Spant') + ' ' + (sel + 1) + ': X ' + f.x.toFixed(1) + ' mm · ' + T(TYPE_NAME[f.type]);
      if (model && model.L) txt += '<br>' + T({ c2: 'krümmungsstetig (C2)', cr: 'Catmull-Rom', bs: 'B-Spline' }[splMode()]) + ' · ' + combInfo(kind === 'side' ? ['top', 'bot'] : ['w']) + (C('rproComb') ? ' <span style="color:#ffe14d">◯</span> = ' + T('Wendepunkt') : '');
      txt += '<br><span style="opacity:.7">' + T('Blau = glatter Umrisspunkt, Rot = Punkt mit Tangente/Ecke (grüne Griffe), grünes Quadrat unten = Spantlage (waagrecht ziehen), Raute = breiteste Stelle (Ei-Spant, hohl = interpoliert) · Doppelklick auf eine Umrisslinie = Punkt einfügen, sonst = Spant einfügen · Entf = zuletzt Gewähltes löschen · Alt+Ziehen/Rad = Bild') + '</span>';
      if (model && model.err) txt += '<br><span style="color:#f88">' + model.err + '</span>';
      setInfo(txt + fixInfo(kind));
    }
    drawAxes2d(kind);
  }
  // Anbauten in Seiten-/Draufsicht: Wurzelprofil + Anformungsbereich, Leitwerksgrundriss, Wurzelrippen-Ebene.
  function drawAttach(kind, xf) {
    const poly = (pts, closed, colr, dash) => {
      ctx.strokeStyle = colr; ctx.lineWidth = 1.2; ctx.setLineDash(dash || []); ctx.beginPath();
      pts.forEach((q, i) => { const p = xf.P(q[0], q[1]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      if (closed) ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    };
    const g = model.wing, f = model.fin;
    ctx.font = '11px system-ui';
    if (g) {
      if (kind === 'side') {
        const up = [], lo = [];
        for (let i = 0; i <= 40; i++) { const x = g.xLE + g.chord * i / 40, y = wingYs(g, x); up.push([x, y.yu]); lo.push([x, y.yl]); }
        poly(up.concat(lo.reverse()), true, 'rgba(120,230,150,.9)');
        if (g.fp) poly(g.fp.map(q => [q[0], q[1]]), true, 'rgba(120,230,150,.7)', [4, 3]);
        ctx.fillStyle = 'rgba(120,230,150,.9)'; const p = xf.P(g.xLE, wingYs(g, g.xLE).yu); ctx.fillText(T('Tragfläche') + (g.name ? ' · ' + g.name : ''), p.x, p.y - 6);
      } else {
        // Stummel in der Draufsicht: von der Rumpfflanke (in Profilhöhe) gerade zur Wurzelrippe
        const zJat = x => { const y = wingYs(g, clamp(x, g.xLE, g.xLE + g.chord)); return Math.max(0, secHalfZ(model, x, (y.yu + y.yl) / 2)); };
        const pl = [[g.xLE, zJat(g.xLE)], [g.xLE, g.zf], [g.xLE + g.chord, g.zf], [g.xLE + g.chord, zJat(g.xLE + g.chord)]];
        for (const sg of [1, -1]) poly(pl.map(q => [q[0], q[1] * sg]), false, 'rgba(120,230,150,.7)', [4, 3]);
        // Anformung: Leitlinien (Nase, Endleiste) in der Draufsicht
        if (g.gLE) for (const G of [g.gLE, g.gTE]) for (const sg of [1, -1]) poly(G.pts.map(q => [q[0], q[1] * sg]), false, 'rgba(156,240,180,.95)');
        // Anformung: Projektion auf dem Rumpf (äußerste Lage je X) in der Draufsicht
        if (g.fp) {
          const fpt = g.fp.map(q => [q[0], q[2]]).sort((a, b) => a[0] - b[0]), env = [];
          for (const q of fpt) { if (env.length && q[0] - env[env.length - 1][0] < 0.5) { env[env.length - 1][1] = Math.max(env[env.length - 1][1], q[1]); } else env.push(q.slice()); }
          for (const sg of [1, -1]) poly(env.map(q => [q[0], q[1] * sg]), false, 'rgba(120,230,150,.7)', [2, 3]);
        }
        ctx.fillStyle = 'rgba(120,230,150,.9)'; const p = xf.P(g.xLE, g.zf); ctx.fillText(T('Wurzelrippe Z =') + ' ' + g.zf.toFixed(1), p.x, p.y - 6);
        // Tragfläche aus dem Tragflächendesign: Nasen-/Endleiste je Station, beide Seiten
        const Wg = App.wing;
        if (model.wingMesh && Wg && Wg.stations && state.root) {
          const sc = g.chord / (+state.root.chord || g.chord), le = [], te = [];
          for (const st of Wg.stations) { let a = Infinity, b = -Infinity; for (const q of st.pts) { a = Math.min(a, q.x); b = Math.max(b, q.x); } le.push([g.xLE + a * sc, g.zf + st.z * sc]); te.push([g.xLE + b * sc, g.zf + st.z * sc]); }
          const cw = hexRGB(colOf(3)), cs = 'rgba(' + Math.round(cw[0] * 255) + ',' + Math.round(cw[1] * 255) + ',' + Math.round(cw[2] * 255) + ',.8)';
          for (const sg of [1, -1]) poly(le.concat(te.slice().reverse()).map(q => [q[0], q[1] * sg]), true, cs);
        }
      }
    }
    if (f) {
      const cf = colOf(1), rgba = (h, a) => { const c = hexRGB(h); return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + a + ')'; };
      // Anformung: Fußabdruck (Draufsicht) bzw. Anschlusshöhe (Seitenansicht)
      if (f.ff) {
        if (kind === 'side') {
          const xa = Math.min(f.ff.x0, f.xs) - 10, xb = Math.max(f.ff.x1, f.xe) + 10; poly([[xa, f.ff.yAt(xa)], [xb, f.ff.yAt(xb)]], false, rgba(cf, 0.85), [6, 4]);
          for (const G of [f.ff.gLE, f.ff.gTE]) if (G) poly(G.pts, false, 'rgba(240,200,255,.95)');   // Leitlinien
        }
        else poly(f.ff.F2.map(q => [q[0], q[1]]), true, rgba(cf, 0.7), [4, 3]);
      }
      // Ruderlinie (gestrichelt) innerhalb des Umrisses, Beschriftung am Ruder
      if (kind === 'side' && f.rud) {
        const rd = f.rud, L = [];
        for (let i = 0; i <= 60; i++) { const y = f.y0 + (f.yMax - f.y0) * i / 60, c = finChordAt(f, y), xh = rd.xh(y); if (c && xh > c[0] && xh < c[1] && finT(f, xh - 1e-3, y, true) >= 0) L.push([xh, y]); }
        if (L.length > 1) {
          ctx.lineWidth = 1.8; poly(L, false, rgba(cf, 0.95), [6, 3]); ctx.lineWidth = 1.2;
          const q = L[L.length >> 1], p = xf.P(q[0], q[1]); ctx.fillStyle = rgba(cf, 0.95); ctx.fillText(T('Ruder (nicht im Rumpf)'), p.x + 6, p.y);
        }
      }
      if (kind === 'side' && f.free) {
        poly(f.N, true, rgba(cf, 0.95));
        // gewählter Punkt: die beiden anschließenden Abschnitte hervorheben
        const n = f.S.length, i = clamp(finSel, 0, n - 1);
        ctx.lineWidth = 2.4; poly(f.S[(i - 1 + n) % n], false, rgba(cf, 0.45)); poly(f.S[i], false, rgba(cf, 0.45)); ctx.lineWidth = 1.2;
        let top = f.Pn[0]; for (const q of f.N) if (q[1] > top[1]) top = q;
        ctx.fillStyle = rgba(cf, 0.95); const p = xf.P(top[0], top[1]); ctx.fillText(T('Seitenleitwerk') + ' · ' + T('freier Umriss'), p.x, p.y - 8);
      } else if (kind === 'side') {
        // Grundriss: Nasenleiste (mit Übergangsbogen) vom Fuß bis zur Spitze, Abschlussgerade, Endleiste zurück zum Fuß
        const pts = [];
        for (let i = 0; i <= 48; i++) { const y = f.y0 + (f.yPT - f.y0) * i / 48; pts.push([finLEx(f, y), y]); }
        pts.push([f.xT, f.yT]); pts.push([finTEx(f, f.y0), f.y0]);
        poly(pts, true, rgba(cf, 0.95));
        if (f.fil) { const c = f.fil.c; ctx.strokeStyle = rgba(cf, 0.35); ctx.setLineDash([2, 3]); ctx.beginPath(); const pc = xf.P(c[0], c[1]); ctx.arc(pc.x, pc.y, f.fil.R * xf.sc, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
        ctx.fillStyle = rgba(cf, 0.95); const p = xf.P(f.xPT, f.yPT); ctx.fillText(T('Seitenleitwerk') + ' · ' + T('Spitzentiefe') + ' ' + f.ct.toFixed(0) + ' mm', p.x, p.y - 6);
      } else {
        // Dickenverlauf (größte halbe Dicke über x)
        const pts = [];
        for (let i = 0; i <= 60; i++) { const x = f.xs + (f.xe - f.xs) * i / 60; let t = 0; for (let k = 0; k <= 16; k++) t = Math.max(t, finT(f, x, f.y0 + (f.yMax - f.y0) * k / 16)); pts.push([x, t]); }
        for (const sg of [1, -1]) poly(pts.map(q => [q[0], q[1] * sg]), false, rgba(cf, 0.7), [4, 3]);
      }
      // Höhenleitwerk: Seite = Wurzelprofil in der Auflage, Draufsicht = Grundriss beider Hälften
      const hl = f.hl;
      if (hl) {
        const ch = rgba(colOf(3), 0.9);
        if (kind === 'side') {
          const up = [], lo = [];
          for (let i = 0; i <= 40; i++) { const u = i / 40, dy = hl.y - u * hl.cr * hl.tanA; up.push([hl.xLE + u * hl.cr, dy + hl.cr * hl.pf.up(u)]); lo.push([hl.xLE + u * hl.cr, dy + hl.cr * hl.pf.lo(u)]); }
          poly(up.concat(lo.reverse()), true, ch);
          ctx.fillStyle = ch; const p = xf.P(hl.xLE + hl.cr, hl.y); ctx.fillText(T('Höhenleitwerk') + (hl.name ? ' · ' + hl.name : ''), p.x + 6, p.y + 4);
        } else {
          // Grundriss ab der Rumpfmitte (Kreuzleitwerk: Stummel innen bis zur Wurzelrippe mit verlängerter Pfeilung)
          const zz = [0].concat(hl.pl.map(p => p.z).filter(z => z > 1e-6)), le = zz.map(z => [hlPlan(hl, z).le, z]), te = zz.map(z => { const p = hlPlan(hl, z); return [p.le + p.c, z]; }).reverse();
          for (const sg of [1, -1]) poly(le.concat(te).map(q => [q[0], q[1] * sg]), false, ch);
          if (hl.cross) { const p = hlPlan(hl, hl.zS); for (const sg of [1, -1]) poly([[p.le, hl.zS * sg], [p.le + p.c, hl.zS * sg]], false, ch, [4, 3]); }
        }
      }
    }
  }
  // V-Leitwerk-Stummel in Seiten-/Draufsicht: Rippenfläche (durchgezogen), Profil in der Symmetrieebene (gestrichelt),
  // Steckungsbohrungen auf der Rippenfläche (Ellipse = schräg gesehener Kreis) und ihr Grund (gestrichelt).
  function drawVt(kind, xf) {
    const g = model && model.vt; if (!g) return;
    const cf = hexRGB(colOf(1)), rgba = a => 'rgba(' + cf.map(c => Math.round(c * 255)).join(',') + ',' + a + ')', iv = kind === 'side' ? 0 : 1;
    const poly = (pts, closed, colr, dash) => {
      ctx.strokeStyle = colr; ctx.lineWidth = 1.2; ctx.setLineDash(dash || []); ctx.beginPath();
      pts.forEach((q, i) => { const p = xf.P(q[0], q[1]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      if (closed) ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    };
    const loop = tf => {
      const up = [], lo = [];
      for (let i = 0; i <= 40; i++) {
        const u = (1 - Math.cos(Math.PI * i / 40)) / 2, x = g.xLE + u * g.chord, hs = vtHs(g, x);
        up.push([x, vtPt(g, tf(hs.hu), hs.hu)[iv]]); lo.push([x, vtPt(g, tf(hs.hl), hs.hl)[iv]]);
      }
      return up.concat(lo.reverse());
    };
    const rib = loop(() => g.tE), root = loop(h => h * g.tanG);
    const sides = kind === 'side' ? [1] : [1, -1];
    // Anformung: Projektion auf dem Rumpf (gestrichelt), Ausschnitt: Profil in der Rumpfmitte
    { const gv = vtGuideView(g);
      if (gv && gv.kind === kind) for (const [G, h] of [[g.gw.gLE, gv.hLE], [g.gw.gTE, gv.hTE]]) for (const sg of sides) poly(G.pts.map(q => [q[0], gv.toV(q[1], h) * sg]), false, 'rgba(217,184,255,.95)'); }
    if (g.gw && g.gw.fp) for (const sg of sides) poly(g.gw.fp.map(q => { const p = vtPt(g, q[2], q[1]); return [q[0], p[iv] * sg]; }), true, rgba(0.8), [5, 3]);
    for (const sg of sides) {
      poly(rib.map(q => [q[0], q[1] * sg]), true, rgba(0.95));
      if (kind === 'side') poly(root, true, rgba(0.5), [4, 3]);
      else for (const x of [g.xLE, g.xT]) poly([[x, 0], [x, vtPt(g, g.tE, vtHs(g, x).hu)[1] * sg]], false, rgba(0.6), [4, 3]);
    }
    // Bohrungen
    for (const b of g.bores) {
      const colr = b.ok ? '#ffb74d' : '#ff6666', sq = kind === 'side' ? Math.abs(g.n[0]) : Math.abs(g.n[1]);
      for (const sg of sides) {
        for (const [t, dash] of [[g.tE, []], [b.tIn, [3, 3]]]) {
          const c = vtPt(g, t, b.h), p = xf.P(b.X, c[iv] * sg);
          ctx.strokeStyle = colr; ctx.lineWidth = 1.3; ctx.setLineDash(dash); ctx.beginPath();
          ctx.ellipse(p.x, p.y, b.r * xf.sc, Math.max(0.5, b.r * sq * xf.sc), 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }
        if (kind === 'top') for (const dx of [-b.r, b.r]) poly([[b.X + dx, vtPt(g, g.tE, b.h)[1] * sg], [b.X + dx, vtPt(g, b.tIn, b.h)[1] * sg]], false, colr, [3, 3]);
      }
    }
    ctx.font = '11px system-ui'; ctx.fillStyle = rgba(0.95);
    const lp = vtPt(g, g.tE, vtHs(g, g.xLE + 0.3 * g.chord).hu), p = xf.P(g.xLE, lp[iv]);
    ctx.fillText(T('V-Leitwerk') + ' ' + (g.G * 180 / Math.PI).toFixed(0) + '° · ' + T('Rippe') + ' ' + g.tE.toFixed(1) + ' mm' + (g.name ? ' · ' + g.name : ''), p.x, p.y - 6);
  }
  // Schnittansicht X: Steckungsbohrungen im Stummel (Rechteck = geschnittener Zylinder), beide Seiten.
  function drawVtCut(x, xf) {
    const g = model && model.vt; if (!g) return;
    for (const b of g.bores) {
      const dx = x - b.X; if (Math.abs(dx) >= b.r) continue;
      const w = Math.sqrt(b.r * b.r - dx * dx), Q = [[b.tIn, b.h - w], [g.tE, b.h - w], [g.tE, b.h + w], [b.tIn, b.h + w]].map(q => vtPt(g, q[0], q[1]));
      for (const sg of [1, -1]) {
        ctx.beginPath(); Q.forEach((q, i) => { const p = xf.P(sg * q[1], q[0]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath();
        ctx.fillStyle = 'rgba(15,18,22,.85)'; ctx.fill(); ctx.strokeStyle = b.ok ? '#ffb74d' : '#ff6666'; ctx.lineWidth = 1.3; ctx.stroke();
      }
    }
  }
  // Leitwerksrohr in Seiten-/Draufsicht: Außenkontur (Rohrfarbe), Innenkontur = Wickeldorn gestrichelt, Achse strichpunktiert.
  function drawBoom(kind, xf) {
    const g = model && model.boom; if (!g) return;
    const c = hexRGB(colOf(5)).map(v => Math.round(v * 255)), rgba = a => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
    // Mantellinie oben/unten (Seite: in der Symmetrieebene, Draufsicht: seitlich) für Radius R(s) = Ra + k·s
    const edge = (Ra, sg, s0, s1) => {
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        const s = s0 + (s1 - s0) * i / 20, R = Ra + g.k * s;
        pts.push(kind === 'side' ? [g.xT + s * g.ca - sg * R * g.sa, g.yc + s * g.sa + sg * R * g.ca] : [g.xT + s * g.ca, sg * R]);
      }
      return pts;
    };
    const poly = (pts, colr, w, dash) => { ctx.strokeStyle = colr; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.beginPath(); pts.forEach((q, i) => { const p = xf.P(q[0], q[1]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); ctx.setLineDash([]); };
    const s0 = sg => sg * g.r0 * g.sa / (g.ca - sg * g.k * g.sa);   // Rohrstirn in der Ebene X = xT
    for (const sg of [1, -1]) {
      const a = edge(g.r0, sg, kind === 'side' ? s0(sg) : 0, g.len);
      poly(a, rgba(0.95), 1.6);
      poly(edge(g.r0 - g.t, sg, kind === 'side' ? s0(sg) : 0, g.len), rgba(0.6), 1, [4, 3]);
    }
    // Stirn und Ende
    for (const sEnd of [null, g.len]) {
      const A = sEnd == null ? edge(g.r0, 1, kind === 'side' ? s0(1) : 0, kind === 'side' ? s0(1) : 0)[0] : edge(g.r0, 1, sEnd, sEnd)[0];
      const B = sEnd == null ? edge(g.r0, -1, kind === 'side' ? s0(-1) : 0, kind === 'side' ? s0(-1) : 0)[0] : edge(g.r0, -1, sEnd, sEnd)[0];
      poly([A, B], rgba(0.95), 1.6);
    }
    poly([[g.xT - 20, kind === 'side' ? g.yc - 20 * Math.tan(g.a) : 0], [g.xT + (g.len + 20) * g.ca, kind === 'side' ? g.yc + (g.len + 20) * g.sa : 0]], rgba(0.5), 1, [10, 3, 2, 3]);
    ctx.font = '11px system-ui'; ctx.fillStyle = rgba(0.95);
    const p = xf.P(g.xT + g.len * 0.5 * g.ca, (kind === 'side' ? g.yc + g.len * 0.5 * g.sa : 0) + boomR(g, g.len * 0.5));
    ctx.fillText(T('Leitwerksrohr') + ' Ø ' + (2 * g.r0).toFixed(1) + ' → ' + (2 * g.r1).toFixed(1) + ' mm', p.x, p.y - 6);
  }
  // Kabinenhaube in den 2D-Ansichten: Seite = Fläche + Schnittlinie, Draufsicht = Umriss der Haube,
  // Spant = Trennlinie im aktuellen Schnitt.
  function drawCanopy(kind, xf) {
    const kh = model.kh; if (!kh || !kh.N) return;
    const c = hexRGB(colOf(4)).map(v => Math.round(v * 255)), rgba = a => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
    const path = (pts, closed) => { ctx.beginPath(); pts.forEach((q, i) => { const p = xf.P(q[0], q[1]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); if (closed) ctx.closePath(); };
    const halfZ = (x, ya) => { let z = Math.max(0, secHalfZ(model, x, ya)); for (const q of bodyHalf(model, clamp(x, model.x0, model.x1))) if (q[0] >= ya && q[1] > z) z = q[1]; return z; };
    ctx.lineWidth = 2; ctx.setLineDash([]);
    if (kind === 'side') {
      const a = kh.N[0], b = kh.N[kh.N.length - 1], pts = kh.N.slice();
      for (let i = 0; i <= 40; i++) { const x = b[0] + (a[0] - b[0]) * i / 40; pts.push([x, boxAt(model, clamp(x, model.x0, model.x1)).top]); }
      path(pts, true); ctx.fillStyle = rgba(0.35); ctx.fill();
      path(kh.N, false); ctx.strokeStyle = rgba(1); ctx.stroke();
      const sk = sicke();
      if (sk) { ctx.lineWidth = 1; ctx.setLineDash([4, 3]); for (let j = 1; j <= sk.n; j++) { path(khOffset(kh.N, j * sk.w), false); ctx.stroke(); } ctx.setLineDash([]); ctx.lineWidth = 2; }
      const fsp = FRM().on ? frameSpec() : null;   // Haubenrahmen: Ober- (und ggf. Unter-)kante strichpunktiert
      if (fsp && !fsp.err) { const fc = hexRGB(frCol()).map(v => Math.round(v * 255)); ctx.strokeStyle = 'rgb(' + fc.join(',') + ')'; ctx.lineWidth = 1.5; ctx.setLineDash([8, 3, 2, 3]); path(khOffset(kh.N, fsp.H), false); ctx.stroke(); if (fsp.s0 > 0.05) { path(khOffset(kh.N, fsp.s0), false); ctx.stroke(); } ctx.setLineDash([]); ctx.lineWidth = 2; ctx.strokeStyle = rgba(1); }
      ctx.fillStyle = rgba(1); ctx.font = '11px system-ui'; const lp = kh.P2 || kh.N[0], p = xf.P(lp[0], lp[1]); ctx.fillText(T('Kabinenhaube'), p.x + 8, p.y + 14);
    } else if (kind === 'top') {
      const up = [];
      for (let i = 0; i <= 80; i++) { const x = kh.x0 + (kh.x1 - kh.x0) * i / 80, sp = kh.spans(x); up.push([x, sp.length ? halfZ(x, sp[0][0]) : 0]); }
      path(up.concat(up.slice().reverse().map(q => [q[0], -q[1]])), true); ctx.fillStyle = rgba(0.3); ctx.fill(); ctx.strokeStyle = rgba(0.95); ctx.lineWidth = 1.5; ctx.stroke();
    } else {
      const fs = formers()[selIdx()], x = kind === 'cut' ? (+C('rproCutX') || 0) : fs ? fs.x : 0; if (x < model.x0 || x > model.x1) return;
      ctx.strokeStyle = rgba(1); ctx.setLineDash([6, 3]);
      for (const sp of kh.spans(x)) { const z = halfZ(x, sp[0]); path([[-z, sp[0]], [z, sp[0]]], false); ctx.stroke(); }
      ctx.setLineDash([]);
    }
  }
  function drawAxes2d(kind) {
    ctx.fillStyle = col('--muted', '#8aa'); ctx.font = '11px system-ui';
    const nu = kind === 'sec' || kind === 'cut' ? 'Z' : 'X', nv = kind === 'top' ? 'Z' : 'Y';
    ctx.fillText(nu + ' →', 12, H - 12); ctx.fillText('↑ ' + nv, 12, H - 26);
  }
  // ---- Schnittsteuerung wie im Formenbau: Ebene senkrecht zu X/Y/Z; 3D aufgeschnitten (Clip im Shader) oder
  //      2D-Schnitt (rproView 'cut'). Lage: X in rproCutX (Spantschnitt, DXF-Export), Y/Z in rproCut.py/pz.
  const AXI = { x: 0, y: 1, z: 2 };
  function CUT() {
    let q = state.cfg.rproCut;
    if (!q || typeof q !== 'object') q = state.cfg.rproCut = { on: false, axis: 'x', py: null, pz: null, side: '+', fill: true };
    if (AXI[q.axis] == null) q.axis = 'x';
    return q;
  }
  function cutGet() {
    const q = CUT(), b = model && model.bounds, k = AXI[q.axis], raw = k === 0 ? C('rproCutX') : q['p' + q.axis];
    let p = raw == null || !isFinite(+raw) ? (b ? r1((b.mn[k] + b.mx[k]) / 2) : 0) : +raw;
    if (b) p = clamp(p, b.mn[k], b.mx[k]);
    return p;
  }
  function cutSet(p) { const q = CUT(); if (q.axis === 'x') S('rproCutX', p); else q['p' + q.axis] = p; }
  function cutSpec() {
    const q = CUT(); if (!q.on || !model || !model.bounds) return null;
    // Ebene n·p = d: Grundachse k, gedreht um die senkrechte Bildachse W (a1) und geneigt um die waagrechte U (a2);
    // Drehpunkt = Mitte des Rumpfs auf Höhe der Lage. U, W = Achsen des 2D-Schnittbilds (ohne Winkel: Z/Y, X/Z, X/Y).
    const k = AXI[q.axis], pos = cutGet(), bd = model.bounds, rad = Math.PI / 180;
    const a1 = clamp(+q.a1 || 0, -85, 85), a2 = clamp(+q.a2 || 0, -85, 85), c1 = Math.cos(a1 * rad), s1 = Math.sin(a1 * rad), c2 = Math.cos(a2 * rad), s2 = Math.sin(a2 * rad);
    const N0 = [0, 0, 0], U0 = [0, 0, 0], W0 = [0, 0, 0]; N0[k] = 1; U0[k === 0 ? 2 : 0] = 1; W0[k === 1 ? 2 : 1] = 1;
    const N1 = N0.map((v, i) => v * c1 + U0[i] * s1), U = U0.map((v, i) => v * c1 - N0[i] * s1);
    const n = N1.map((v, i) => v * c2 + W0[i] * s2), Wv = W0.map((v, i) => v * c2 - N1[i] * s2);
    const P0 = [0, 1, 2].map(i => i === k ? pos : (bd.mn[i] + bd.mx[i]) / 2);
    return { k, pos, rm: q.side === '-' ? -1 : 1, fill: !!q.fill, n, U, W: Wv, P0, d: n[0] * P0[0] + n[1] * P0[1] + n[2] * P0[2], a1, a2, tilt: !!(a1 || a2) };
  }
  function cutName(cut) { return T('Schnitt') + ' ' + 'XYZ'[cut.k] + ' = ' + cut.pos.toFixed(1) + ' mm' + (cut.tilt ? ' · ' + T('gedreht') + ' ' + cut.a1 + '° / ' + T('geneigt') + ' ' + cut.a2 + '°' : ''); }
  // Schnittstrecken des Dreiecksnetzes mit der Ebene, in 2D (k = 0: Z/Y · 1: X/Z · 2: X/Y)
  function sectionSegs(mesh, cut) {
    const v = mesh.v, segs = [], n = cut.n, U = cut.U, Wv = cut.W;
    for (let i = 0; i < v.length; i += 9) {
      const d = [0, 3, 6].map(o => n[0] * v[i + o] + n[1] * v[i + o + 1] + n[2] * v[i + o + 2] - cut.d), P = [];
      for (let e = 0; e < 3; e++) {
        const a = e, b = (e + 1) % 3; if ((d[a] < 0) === (d[b] < 0)) continue;
        const t = d[a] / (d[a] - d[b]), ia = i + a * 3, ib = i + b * 3, x = v[ia] + (v[ib] - v[ia]) * t, y = v[ia + 1] + (v[ib + 1] - v[ia + 1]) * t, z = v[ia + 2] + (v[ib + 2] - v[ia + 2]) * t;
        P.push([x * U[0] + y * U[1] + z * U[2], x * Wv[0] + y * Wv[1] + z * Wv[2]]);
      }
      if (P.length === 2) segs.push(P);
    }
    return segs;
  }
  // Schnitt als DXF: Spantschnitt X ohne Winkel exakt aus den Spantkurven, sonst Netzschnitt in der (schrägen) Ebene.
  function exportCutDxf() {
    if (!model || !model.mesh) build(); if (!model || !model.mesh) return;
    const on = CUT().on; CUT().on = true; const cut = cutSpec(); CUT().on = on; if (!cut) return;
    if (cut.k === 0 && !cut.tilt) return exportSectionDxf();
    const loops = chainSegs(sectionSegs(model.mesh, cut)).map(L => { const e = L[L.length - 1]; return L.length > 3 && Math.hypot(e[0] - L[0][0], e[1] - L[0][1]) < 1e-3 ? L.slice(0, -1) : L; }).filter(L => L.length >= 3);
    if (!loops.length) { alert(T('Schnittebene trifft den Rumpf nicht.')); return; }
    saveFile(projBase() + '_schnitt_' + 'xyz'[cut.k] + Math.round(cut.pos) + (cut.tilt ? '_w' + Math.round(cut.a1) + '_' + Math.round(cut.a2) : '') + '.dxf', dxfText(loops), 'application/dxf', 'svDxf');
  }
  function chainSegs(segs) {
    const key = p => Math.round(p[0] * 500) + ',' + Math.round(p[1] * 500), adj = new Map();
    segs.forEach((sg, i) => { for (const e of [0, 1]) { const q = key(sg[e]); let l = adj.get(q); if (!l) adj.set(q, (l = [])); l.push(i); } });
    const used = new Uint8Array(segs.length), loops = [];
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue; used[i] = 1;
      const L = [segs[i][0], segs[i][1]]; let cur = key(segs[i][1]);
      for (;;) { const j = (adj.get(cur) || []).find(q => !used[q]); if (j == null) break; used[j] = 1; const sg = segs[j], nx = key(sg[0]) === cur ? sg[1] : sg[0]; L.push(nx); cur = key(nx); }
      loops.push(L);
    }
    return loops;
  }
  // 2D-Schnitt aus dem Dreiecksnetz: Längsschnitte (Y, Z) und alle schrägen Ebenen; der gerade Spantschnitt (X) läuft über draw2d('cut').
  function draw2dCutAxis(cut) {
    ctx.fillStyle = col('--bg', '#0f1216'); ctx.fillRect(0, 0, W, H); xf2 = null;
    if (!model || !model.mesh || !model.bounds) { setInfo(model && model.err ? model.err : T('Kein Rumpf.'), true); return; }
    const k = cut.k, bd = model.bounds, c2 = cam2.cut;
    const loops = chainSegs(sectionSegs(model.mesh, cut));
    // Maßstab aus den Gesamtmaßen (Ecken des Rumpfkastens in Bildachsen): beim Durchfahren bleibt der Maßstab gleich
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let c = 0; c < 8; c++) { const q = [0, 1, 2].map(i => (c >> i) & 1 ? bd.mx[i] : bd.mn[i]), u = q[0] * cut.U[0] + q[1] * cut.U[1] + q[2] * cut.U[2], w = q[0] * cut.W[0] + q[1] * cut.W[1] + q[2] * cut.W[2]; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, w); v1 = Math.max(v1, w); }
    const sc = Math.max(1e-3, Math.min((W - 160) / Math.max(1, u1 - u0), (H - 160) / Math.max(1, v1 - v0))) * c2.zoom, ca = (u0 + u1) / 2, cb = (v0 + v1) / 2;
    const X = a => W / 2 + c2.px + (a - ca) * sc, Y = b => H / 2 + c2.py - (b - cb) * sc;
    let st = 1; for (const q of [1, 2, 5, 10, 20, 50, 100, 200, 500]) { st = q; if (q * sc >= 40) break; }
    ctx.strokeStyle = 'rgba(140,160,190,.14)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let g = Math.floor((ca - (W / 2 + c2.px) / sc) / st) * st; X(g) < W; g += st) { ctx.moveTo(X(g), 0); ctx.lineTo(X(g), H); }
    for (let g = Math.floor((cb - (H / 2 - c2.py) / sc) / st) * st; Y(g) > 0; g += st) { ctx.moveTo(0, Y(g)); ctx.lineTo(W, Y(g)); }
    ctx.stroke();
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const L of loops) for (const p of L) { if (p[0] < a0) a0 = p[0]; if (p[0] > a1) a1 = p[0]; if (p[1] < b0) b0 = p[1]; if (p[1] > b1) b1 = p[1]; }
    const nm = (k === 0 ? ['Z', 'Y'] : k === 1 ? ['X', 'Z'] : ['X', 'Y']).map(a => a + (cut.tilt ? '′' : '')), hintTxt = '<br><span style="opacity:.7">' + T('Ziehen = schieben · Rad = Zoom · Doppelklick = zurück · Pfeiltasten = Schnittlage') + '</span>';
    if (!isFinite(a0)) { setInfo(cutName(cut) + ' · ' + T('Schnittebene trifft den Rumpf nicht.') + hintTxt); drawAxes2dCut(nm); return; }
    ctx.beginPath(); for (const L of loops) L.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
    ctx.fillStyle = 'rgba(79,195,247,.15)'; ctx.fill('evenodd'); ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = ctx.fillStyle = col('--muted', '#8aa'); ctx.font = '11px system-ui'; ctx.lineWidth = 1; ctx.textAlign = 'center';
    ctx.beginPath(); ctx.moveTo(X(a0), Y(b0) + 18); ctx.lineTo(X(a1), Y(b0) + 18); ctx.moveTo(X(a0), Y(b0) + 12); ctx.lineTo(X(a0), Y(b0) + 24); ctx.moveTo(X(a1), Y(b0) + 12); ctx.lineTo(X(a1), Y(b0) + 24);
    ctx.moveTo(X(a0) - 18, Y(b0)); ctx.lineTo(X(a0) - 18, Y(b1)); ctx.moveTo(X(a0) - 24, Y(b0)); ctx.lineTo(X(a0) - 12, Y(b0)); ctx.moveTo(X(a0) - 24, Y(b1)); ctx.lineTo(X(a0) - 12, Y(b1)); ctx.stroke();
    ctx.fillText(nm[0] + ' ' + (a1 - a0).toFixed(1) + ' mm', (X(a0) + X(a1)) / 2, Y(b0) + 34);
    ctx.save(); ctx.translate(X(a0) - 26, (Y(b0) + Y(b1)) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(nm[1] + ' ' + (b1 - b0).toFixed(1) + ' mm', 0, 0); ctx.restore(); ctx.textAlign = 'left';
    setInfo(cutName(cut) + ' · ' + (a1 - a0).toFixed(1) + ' × ' + (b1 - b0).toFixed(1) + ' mm · ' + T('Raster') + ' ' + st + ' mm' + hintTxt);
    drawAxes2dCut(nm);
  }
  function drawAxes2dCut(nm) { ctx.fillStyle = col('--muted', '#8aa'); ctx.font = '11px system-ui'; ctx.textAlign = 'left'; ctx.fillText(nm[0] + ' →', 12, H - 12); ctx.fillText('↑ ' + nm[1], 12, H - 26); }
  // Bedienfeld Schnittansicht im Ansichtsfenster (links unten über der Knopfleiste) — wie im Formenbau
  function buildCutPanel() {
    const el = document.getElementById('rproCutPanel'); if (!el) return;
    el.innerHTML = ''; const q = CUT(), view = C('rproView');
    if (!q.on || (view !== '3d' && view !== 'cut')) { el.style.display = 'none'; return; }
    el.style.display = '';
    { const bar = el.parentElement && el.parentElement.querySelector('.simbar'); el.style.bottom = ((bar ? bar.offsetHeight : 38) + 8) + 'px'; }
    const rb = () => { buildSidebar(); draw(); };
    const row = () => { const d = document.createElement('div'); d.style.cssText = 'display:flex;align-items:center;gap:6px;margin:3px 0'; el.appendChild(d); return d; };
    const lab = (r, t, w) => { const l = document.createElement('span'); l.textContent = T(t); l.style.cssText = 'opacity:.7;flex:0 0 ' + (w || 52) + 'px'; r.appendChild(l); return l; };
    const sel = (r, opts, cur, fn) => { const e = document.createElement('select'); e.style.cssText = 'flex:1;min-width:0;font-size:11px;padding:2px 4px'; for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = T(t); if (v === cur) o.selected = true; e.appendChild(o); } e.onchange = () => fn(e.value); r.appendChild(e); return e; };
    const btn = (r, t, on, fn) => { const b = document.createElement('button'); b.textContent = T(t); b.className = on ? 'primary' : ''; b.style.cssText = 'flex:1;padding:2px 6px;font-size:11px'; b.onclick = fn; r.appendChild(b); return b; };
    let r = row(); const h = document.createElement('b'); h.textContent = T('Schnittansicht'); h.style.flex = '1'; r.appendChild(h);
    btn(r, 'Schnitt aus', false, () => { q.on = false; if (C('rproView') === 'cut') S('rproView', '3d'); rb(); }).style.flex = '0 0 auto';
    r = row(); lab(r, 'Ebene');
    sel(r, [['x', 'Rumpfachse X (Spantschnitt)'], ['y', 'Höhe Y'], ['z', 'Breite Z']], q.axis, v => { q.axis = v; rb(); });
    const b = model && model.bounds, k = AXI[q.axis], lo = b ? Math.floor(b.mn[k]) : -500, hi = b ? Math.ceil(b.mx[k]) : 500, pos = cutGet();
    r = row(); lab(r, 'Lage (mm)');
    const rg = document.createElement('input'); rg.type = 'range'; rg.min = lo; rg.max = hi; rg.step = 0.5; rg.value = pos; rg.dataset.rpcut = '1'; rg.style.cssText = 'flex:1;min-width:0';
    const nm = document.createElement('input'); nm.type = 'number'; nm.step = 0.5; nm.value = r1(pos); nm.dataset.rpcut = '1'; nm.style.cssText = 'width:64px;font-size:11px;padding:2px 4px';
    rg.oninput = () => { cutSet(+rg.value); syncCutInputs(); draw(); };
    nm.onchange = () => { cutSet(+nm.value || 0); syncCutInputs(); draw(); };
    rg.title = nm.title = lo + ' … ' + hi + ' mm · ' + T('←/→ verschieben die Ebene');
    r.appendChild(rg); r.appendChild(nm);
    r = row(); lab(r, 'Winkel (°)');
    const ang = (key, t, tip) => {
      const l = document.createElement('span'); l.textContent = T(t); l.style.opacity = '.7'; r.appendChild(l);
      const e = document.createElement('input'); e.type = 'number'; e.step = 1; e.min = -85; e.max = 85; e.value = +q[key] || 0; e.style.cssText = 'width:52px;font-size:11px;padding:2px 4px'; e.title = T(tip);
      e.onchange = () => { q[key] = clamp(Math.round((+e.value || 0) * 10) / 10, -85, 85); e.value = q[key]; if (C('rproView') === 'cut') buildSidebar(); draw(); }; r.appendChild(e);
    };
    ang('a1', 'drehen', 'Schnittebene um die senkrechte Achse des Schnittbilds drehen (−85 … 85°). Drehpunkt: Rumpfmitte an der eingestellten Lage.');
    ang('a2', 'neigen', 'Schnittebene um die waagrechte Achse des Schnittbilds neigen (−85 … 85°). Drehpunkt: Rumpfmitte an der eingestellten Lage.');
    if (q.a1 || q.a2) btn(r, '0°', false, () => { q.a1 = 0; q.a2 = 0; rb(); }).style.flex = '0 0 auto';
    r = row(); lab(r, '3D: entfernte Seite', 100);
    sel(r, [['+', 'größere Koordinate (+)'], ['-', 'kleinere Koordinate (−)']], q.side === '-' ? '-' : '+', v => { q.side = v; draw(); });
    const ck = document.createElement('label'); ck.className = 'ck'; ck.style.cssText = 'display:flex;align-items:center;gap:4px;white-space:nowrap';
    const ci = document.createElement('input'); ci.type = 'checkbox'; ci.checked = !!q.fill; ci.onchange = () => { q.fill = ci.checked; draw(); };
    ck.appendChild(ci); ck.appendChild(document.createTextNode(T('füllen'))); r.appendChild(ck);
    r = row();
    btn(r, '3D aufgeschnitten', view === '3d', () => { S('rproView', '3d'); rb(); });
    btn(r, '2D-Schnitt', view === 'cut', () => { S('rproView', 'cut'); cam2.cut = { zoom: 1, px: 0, py: 0 }; rb(); });
    btn(r, 'DXF…', false, exportCutDxf).title = T('Schnittkontur in der eingestellten Ebene (auch schräg) als DXF speichern, Maße in mm.');
  }
  function syncCutInputs() {
    const v = cutGet();
    document.querySelectorAll('[data-rpcut]').forEach(el => { if (document.activeElement !== el) el.value = el.type === 'range' ? v : r1(v); });
  }
  // ---- Spantansicht: kleine Seiten- und Draufsicht oben als Lageplan der Spanten (Größe ziehbar, zuklappbar) ----
  const MINI_KEY = 'hw_rpro_mini';
  let mini = null;   // { box, side: { body, cv, ttl, xf }, top: { … } }
  function miniCfg() { try { return JSON.parse(localStorage.getItem(MINI_KEY)) || {}; } catch (e) { return {}; } }
  function miniSave(kind, o) { try { const c = miniCfg(); c[kind] = Object.assign(c[kind] || {}, o); localStorage.setItem(MINI_KEY, JSON.stringify(c)); } catch (e) { } }
  function miniInit() {
    if (mini || !canvas || !canvas.parentNode) return;
    const mk = (tag, css) => { const el = document.createElement(tag); el.style.cssText = css; return el; };
    const box = mk('div', 'position:absolute;left:460px;right:110px;top:10px;z-index:3;display:none;flex-wrap:wrap;gap:8px;align-items:flex-start;pointer-events:none');   // rechts bleibt Platz für den Ansichtswürfel
    mini = { box };
    const cfg = miniCfg();
    for (const kind of ['side', 'top']) {
      const c = cfg[kind] || {};
      const wrap = mk('div', 'pointer-events:auto;background:var(--ovl,rgba(15,18,22,.9));border:1px solid var(--line,#2a323c);border-radius:6px;overflow:hidden');
      const head = mk('div', 'display:flex;align-items:center;gap:6px;padding:3px 8px;font:11px system-ui;cursor:pointer;user-select:none;white-space:nowrap;color:var(--muted,#8aa)');
      head.title = T('Klick = Fenster auf-/zuklappen · Ecke rechts unten ziehen = Größe · Klick ins Bild = Spant wählen');
      const arrow = mk('span', ''), ttl = mk('span', '');
      const body = mk('div', 'resize:both;overflow:hidden;min-width:150px;min-height:50px;width:' + Math.max(150, +c.w || 340) + 'px;height:' + Math.max(50, +c.h || (kind === 'side' ? 110 : 90)) + 'px' + (c.closed ? ';display:none' : ''));
      const cv = mk('canvas', 'display:block;width:100%;height:100%;cursor:pointer');
      arrow.textContent = c.closed ? '▸' : '▾';
      head.appendChild(arrow); head.appendChild(ttl); body.appendChild(cv); wrap.appendChild(head); wrap.appendChild(body); box.appendChild(wrap);
      const m = mini[kind] = { body, cv, ttl, xf: null };
      head.onclick = () => {
        const closed = body.style.display !== 'none';
        body.style.display = closed ? 'none' : ''; arrow.textContent = closed ? '▸' : '▾'; miniSave(kind, { closed });
        if (!closed) drawMini(kind);
      };
      cv.addEventListener('mousedown', e => {   // Spant mit der nächstgelegenen X-Lage wählen
        if (!m.xf || !model || !model.FR) return;
        const u = m.xf.inv(e.clientX - cv.getBoundingClientRect().left); let best = 0;
        model.FR.forEach((f, i) => { if (Math.abs(f.x - u) < Math.abs(model.FR[best].x - u)) best = i; });
        selectFormer(best); e.preventDefault();
      });
      if (window.ResizeObserver) new ResizeObserver(() => {
        if (body.style.display === 'none' || !body.offsetWidth) return;
        miniSave(kind, { w: body.offsetWidth, h: body.offsetHeight }); drawMini(kind);
      }).observe(body);
    }
    canvas.parentNode.appendChild(box);
  }
  function drawMini(kind) {
    const m = mini && mini[kind]; if (!m || !model || !model.L || !model.FR) return;
    const sel = selIdx(), top = kind === 'top';
    m.ttl.textContent = T(top ? 'Draufsicht' : 'Seitenansicht') + ' · ' + T('Spant') + ' ' + (sel + 1) + ' / ' + model.FR.length;
    if (m.body.style.display === 'none') return;
    const w = m.body.clientWidth, h = m.body.clientHeight; if (w < 20 || h < 20) return;
    const dpr = window.devicePixelRatio || 1, cv = m.cv, pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const lines = top ? [linePts(model.L.w, 12)] : [linePts(model.L.top, 12), linePts(model.L.bot, 12)];
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const Ln of lines) for (const q of Ln) { u0 = Math.min(u0, q[0]); u1 = Math.max(u1, q[0]); v0 = Math.min(v0, top ? -q[1] : q[1]); v1 = Math.max(v1, q[1]); }
    const padX = 10, padT = 16, padB = 8;
    const sc = Math.min((w - 2 * padX) / ((u1 - u0) || 1), (h - padT - padB) / ((v1 - v0) || 1)), cu = (u0 + u1) / 2, cv0 = (v0 + v1) / 2;
    const P = (u, v) => [w / 2 + (u - cu) * sc, (padT + h - padB) / 2 - (v - cv0) * sc];
    m.xf = { inv: x => cu + (x - w / 2) / sc };
    c.strokeStyle = '#4fc3f7'; c.lineWidth = 1.5;
    for (const Ln of lines) for (const sg of (top ? [1, -1] : [1])) { c.beginPath(); Ln.forEach((q, i) => { const p = P(q[0], sg * q[1]); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); }); c.stroke(); }
    // Spanten mit Nummer; bei engem Abstand nur jede passende Nummer, die gewählte immer
    const fl = i => { const f = model.FR[i], bx = boxAt(model, f.x); return [P(f.x, top ? -bx.w : bx.bot), P(f.x, top ? bx.w : bx.top)]; };
    c.textAlign = 'center'; c.font = '9px system-ui'; let lastX = -1e9;
    const selX = model.FR[sel] ? fl(sel)[1][0] : -1e9;
    model.FR.forEach((f, i) => {
      if (i === sel) return;
      const [a, b] = fl(i);
      c.strokeStyle = 'rgba(180,200,220,.45)'; c.lineWidth = 1; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      if (b[0] - lastX >= 11 && Math.abs(b[0] - selX) >= 14) { c.fillStyle = 'rgba(200,215,230,.7)'; c.fillText(String(i + 1), b[0], Math.max(9, b[1] - 3)); lastX = b[0]; }
    });
    if (model.FR[sel]) {
      const [a, b] = fl(sel);
      c.strokeStyle = '#ff7a7a'; c.lineWidth = 2.2; c.beginPath(); c.moveTo(a[0], Math.min(h - 2, a[1] + 4)); c.lineTo(b[0], Math.max(12, b[1] - 4)); c.stroke();
      c.fillStyle = '#ff9a9a'; c.font = 'bold 12px system-ui'; c.fillText(String(sel + 1), b[0], Math.max(11, b[1] - 6));
    }
    c.textAlign = 'left';
  }
  function updateMini() {
    const on = C('rproView') === 'sec' && model && model.L && model.FR && model.FR.length;
    if (!on) { if (mini) mini.box.style.display = 'none'; return; }
    miniInit(); if (!mini) return;
    const info = document.getElementById('rproInfo');
    mini.box.style.left = ((info ? info.offsetLeft + info.offsetWidth : 450) + 10) + 'px';
    mini.box.style.display = 'flex'; drawMini('side'); drawMini('top');
  }
  function draw() {
    if (!ctx && !fit()) return;
    // Größe der Zeichenfläche bei jedem Bild prüfen: Layoutänderungen ohne Fenster-Resize (Seitenleiste wächst,
    // Reiter war verdeckt) ließen sonst die 2D-Ansichten mit alter Größe rechnen — bei 0 px mit negativem Maßstab.
    { const r = canvas.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && (Math.abs(r.width - W) > 0.5 || Math.abs(r.height - H) > 0.5)) fit(); }
    if (!(W > 0 && H > 0)) return;
    const v = C('rproView');
    if (v === 'cut') { CUT().on = true; const cut = cutSpec(); if (cut && (cut.k !== 0 || cut.tilt)) { glHide(); draw2dCutAxis(cut); updateMini(); return; } }
    if (v === 'side' || v === 'top' || v === 'sec' || v === 'cut') {
      glHide();
      try { draw2d(v); }
      catch (e) { console.error('Rumpf 2D:', e); setInfo(T('Fehler beim Zeichnen der Ansicht') + ': ' + (e && e.message), true); }   // statt stumm leerer Ansicht
    } else draw3d();
    updateMini();
    if (projW.win && projW.win.style.display !== 'none' && !projW.drag) projWinDraw();
    if (cvW.win && cvW.win.style.display !== 'none' && !cvW.drag) cvWinDraw();
  }
  function refresh() { if (state.activeTab !== 'rpro') return; build(); draw(); }
  function show() { if (!fit()) return; build(); draw(); }
  function resize() { if (fit()) draw(); }

  // ---------- Bearbeitung in den 2D-Ansichten ------------------------------------
  function hitHandle(kind, mx, my) {
    if (!xf2) return null; let best = null, bd = HANDLE_R + 2;
    for (const h of handles(kind)) { const p = xf2.P(h.u, h.v), d = Math.hypot(p.x - mx, p.y - my); if (d < bd) { bd = d; best = h; } }
    return best;
  }
  // Spantansicht: Spantkurve unter dem Mauszeiger (Index) oder null.
  function hitFormer(mx, my) {
    if (!xf2 || !model || !model.FR) return null; let best = null, bd = 6;
    const cx = xf2.P(0, 0).x, px = mx > cx ? mx : 2 * cx - mx;   // gespiegelte Hälfte
    model.FR.forEach((f, i) => {
      const pts = secHalf(model, f.x).map(q => xf2.P(q[2], q[1]));
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k], b = pts[k + 1], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
        const t = L2 > 1e-12 ? clamp(((px - a.x) * dx + (my - a.y) * dy) / L2, 0, 1) : 0, d = Math.hypot(a.x + dx * t - px, a.y + dy * t - my);
        if (d < bd) { bd = d; best = i; }
      }
    });
    return best;
  }
  // Menü „Spant n" in der Seitenleiste aufklappen und in den Blick holen.
  function revealFormerMenu(key) {
    const g = document.querySelector('.grp[data-grpkey="' + (key || 'rproSpSel') + '"]'); if (!g) return;
    const h = g.querySelector('h3'), body = g.querySelector('.body');
    if (h && body && body.style.display === 'none') h.click();
    if (g.scrollIntoView) g.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function selectFormer(i) {
    const fr = formers(); if (!(i >= 0 && i < fr.length)) return;
    if (i !== selIdx()) selNode = 1;
    S('rproSel', i); lastSel = 'fr'; buildSidebar(); draw(); revealFormerMenu();
  }
  // Parametergruppe g eines Spants zum Steuerwert machen (Startwert = bisher interpolierter Wert).
  function makeCtl(i, g) {
    const f = formers()[i]; if (!f) return;
    if (!f.ctl[g] && model && model.P && model.P[i]) gSet(f.p, g, gVals(model.P[i], g).map(r2));
    f.ctl[g] = true;
  }
  function applyHandle(h, u, v, ctrl) {
    const o = outlines(), fr = formers();
    if (h.t === 'fin') { const s = FN().fpts && FN().fpts[h.k]; if (s) { s.x = r1(u); s.y = r1(v); finSel = h.k; } return; }
    if (h.t === 'wg') {   // Leitlinie der Anformung: Stützpunkt relativ zu X-Bereich und Höhe Rumpf … Rippe speichern
      const g = model.wing, w = WG(); if (!g || !g.gRef) return;
      const le = h.k.startsWith('le'), i = +h.k.slice(2), r = le ? g.gRef.le : g.gRef.te, L = le ? w.gLE : w.gTE; if (!L[i]) return;
      L[i].u = r2(clamp((u - r[0]) / (r[1] - r[0]), 0.02, 0.98)); L[i].v = r2(clamp((v - r[2]) / (r[3] - r[2]), 0, 1)); return;
    }
    if (h.t === 'vg') {   // Leitlinie der V-Leitwerks-Anformung: Ansichtswert -> t im gedrehten Rahmen, dann relativ wie die Tragfläche
      const g = model.vt, gw = g && g.gw, gv = vtGuideView(g), w = VT(); if (!gv) return;
      const le = h.k.startsWith('le'), i = +h.k.slice(2), r = le ? gw.gRef.le : gw.gRef.te, L = le ? w.gLE : w.gTE; if (!L[i]) return;
      const t = gv.toT(v, le ? gv.hLE : gv.hTE);
      L[i].u = r2(clamp((u - r[0]) / (r[1] - r[0]), 0.02, 0.98)); L[i].v = r2(clamp((t - r[2]) / (r[3] - r[2]), 0, 1)); return;
    }
    if (h.t === 'fg') {   // Leitlinie der Leitwerks-Anformung (Seitenansicht)
      const q = model.fin && model.fin.ff, f = FN(); if (!q || !q.gRef) return;
      if (h.k.startsWith('le')) {   // Nase: Punkt im schrägen Rahmen (normiert), zwischen den Nachbarn
        const L = f.gLE, i = +h.k.slice(2); if (!L[i] || !q.gFrame) return;
        const n = q.gFrame.toN(u, v); L[i].x = r3(clamp(n[0], L[i - 1].x + 0.01, L[i + 1].x - 0.01)); L[i].v = r3(clamp(n[1], -0.2, 1.2)); return;
      }
      const i = +h.k.slice(2), r = q.gRef.te, L = f.gTE; if (!L[i]) return;
      L[i].u = r2(clamp((u - r[0]) / (r[1] - r[0]), 0.02, 0.98)); L[i].v = r2(clamp((v - r[2]) / (r[3] - r[2]), 0, 1)); return;
    }
    if (h.t === 'fcut') {   // Schnittlinie Seitenleitwerk: Mitte verschiebt in der Höhe, Enden drehen um das andere Ende
      const q = model.fin && model.fin.ff, f = FN(); if (!q) return;
      if (h.k === 2) { f.fH = r1(Math.max(0.5, v - q.top)); return; }
      const xa = Math.min(q.x0, model.fin.xs) - 10, xb = Math.max(q.x1, model.fin.xe) + 10, uo = h.k === 0 ? xb : xa, vo = q.yAt(uo);
      if (Math.abs(u - uo) < 5) return;
      const tA = clamp((v - vo) / (u - uo), -1, 1);
      f.fA = r1(Math.atan(tA) * 180 / Math.PI); f.fH = r1(Math.max(0.5, vo + tA * (q.xr - uo) - q.top)); return;
    }
    if (h.t === 'kh') {
      const k = KH(), q = model.kh, deg = 180 / Math.PI; if (!q) return;
      if (k.mode === 'free') {
        const i = +h.k.slice(1), s = k.pts && k.pts[i]; if (!s) return;
        if (h.k[0] === 'n') { s.x = r1(clamp(u, model.x0 + 0.5, model.x1 - 0.5)); if (i > 0 && i < k.pts.length - 1) s.y = r1(v); khSel = i; return; }
        const a = q.Pn[i], b = q.Pn[i + 1]; if (!a || !b) return;
        const d = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(d[0], d[1]) || 1, perp = ((u - a[0]) * d[1] - (v - a[1]) * d[0]) / L;
        if (s.t === 'foil') { const hm = q.S[i] && q.S[i].hm; if (Math.abs(hm) > 1e-6) s.fScale = Math.round(perp / hm * 100); }
        else { s.pos = r1(clamp(((u - a[0]) * d[0] + (v - a[1]) * d[1]) / (L * L), 0.1, 0.9) * 100); s.curv = r1(perp); }
        khSel = i; return;
      }
      if (h.k === 'c2') { k.x = r1(clamp(u, model.x0 + 1, model.x1 - 1)); k.depth = r1(Math.max(0.5, boxAt(model, k.x).top - v)); }
      else if (h.k === 'c3') { const dx = u - q.P2[0], dy = v - q.P2[1]; k.len = r1(Math.max(5, Math.hypot(dx, dy))); k.slope = r1(clamp(Math.atan2(dy, Math.max(1e-6, dx)) * deg, -60, 60)); }
      else if (h.k === 't1') k.angF = r1(clamp(Math.atan2(v - q.P2[1], q.P2[0] - u) * deg, 10, 170));
      else if (h.k === 't4') k.angR = r1(clamp(Math.atan2(v - q.P3[1], u - q.P3[0]) * deg, 10, 170));
      else {
        const sx = h.k.slice(1), ab = sx === 'F' ? [q.P1, q.P2] : sx === 'B' ? [q.P2, q.P3] : [q.P3, q.P4]; if (!ab[0] || !ab[1]) return;
        const d = [ab[1][0] - ab[0][0], ab[1][1] - ab[0][1]], L = Math.hypot(d[0], d[1]) || 1;
        const t = clamp(((u - ab[0][0]) * d[0] + (v - ab[0][1]) * d[1]) / (L * L), 0.1, 0.9), qx = ab[0][0] + d[0] * t, qy = ab[0][1] + d[1] * t;
        k['pos' + sx] = r1(t * 100); k['curv' + sx] = r1(((u - qx) * d[1] - (v - qy) * d[0]) / L);
      }
      return;
    }
    if (h.t === 'pt' || h.t === 'ptan') {
      const pts = o[h.line], p = pts[h.k]; if (!p) return;
      if (h.t === 'ptan') {
        const vec = [u - p.x, v - p.v]; vec[0] = h.tan === 'o' ? Math.max(0, vec[0]) : Math.min(0, vec[0]);
        const cur = outTan(pts, h.k); p.i = cur.i; p.o = cur.o;
        if (ctrl && p.c === 1) p.c = 2;
        p[h.tan] = vec;
        if (p.c === 1) {
          const other = h.tan === 'o' ? 'i' : 'o', L = Math.hypot(p[other][0], p[other][1]), Lv = Math.hypot(vec[0], vec[1]);
          if (L > 1e-9 && Lv > 1e-9) p[other] = [-vec[0] / Lv * L, -vec[1] / Lv * L];
        }
        return;
      }
      const n = pts.length, end = h.k === 0 || h.k === n - 1, bf = boundFr(p.x), xlock = bf.some(xFixed);
      let x = xlock ? p.x : r1(u);
      if (end) {
        // Nase/Heck: X gilt für alle drei Umrisse
        const lim = h.k === 0 ? Math.min(...LINES.map(k => o[k][1].x)) - 1 : Math.max(...LINES.map(k => o[k][o[k].length - 2].x)) + 1;
        x = h.k === 0 ? Math.min(x, lim) : Math.max(x, lim);
        for (const k of LINES) o[k][h.k === 0 ? 0 : o[k].length - 1].x = x;
        bf.forEach(f => { f.x = x; });
      } else {
        // Spanten auf diesem Punkt (samt ihren Punkten in den anderen Umrissen) wandern mit
        const nx = clamp(x, pts[h.k - 1].x + 0.5, pts[h.k + 1].x - 0.5);
        if (bf.length && Math.abs(nx - p.x) > 1e-9) { bf.forEach(f => moveFormerX(f, nx)); sortFormers(); }
        p.x = nx;
      }
      p.v = h.line === 'w' ? Math.max(0, r1(Math.abs(v))) : r1(v);
      syncCircleOutlines({ line: h.line, x: p.x });
      return;
    }
    const f = fr[h.i]; if (!f) return;
    if (h.t === 'fr') {
      // Sprungstelle: der Partner wandert mit, Grenzen sind die Nachbarn des Paars
      const ia = f.jmp === 'b' ? h.i - 1 : h.i, ib = f.jmp === 'a' ? h.i + 1 : h.i;
      let lo = (ia > 0 ? fr[ia - 1].x + 0.5 : o.top[0].x) + (h.i - ia) * JG, hi = (ib < fr.length - 1 ? fr[ib + 1].x - 0.5 : o.top[o.top.length - 1].x) - (ib - h.i) * JG;
      // Spant auf der Nase / dem Heck: frei nach außen (Spitze wandert mit), nach innen höchstens bis vor den nächsten Umrisspunkt
      const tipFree = !ctrl && !anyLineLocked();   // fixierte Linie: Nase/Heck wandern nicht mit
      const atNose = tipFree && !f.jmp && Math.abs(f.x - o.top[0].x) < ONX, atTail = tipFree && !f.jmp && Math.abs(f.x - o.top[o.top.length - 1].x) < ONX;
      if (atNose) { lo = -1e5; hi = Math.min(hi, ...LINES.map(k => o[k][1].x - 0.5)); }
      if (atTail) { hi = 1e5; lo = Math.max(lo, ...LINES.map(k => o[k][o[k].length - 2].x + 0.5)); }
      if (xFixed(f) || xFixed(jumpPartner(f))) return;
      moveFormerX(f, r1(clamp(u, lo, hi)), !!ctrl); return;   // Strg: Spant allein, Nase/Heck bleiben
    }
    // Spantansicht: Höhe oben/unten und Breite schreiben die Umrisse an diesem Spant
    if (h.t === 'st' || h.t === 'sb' || h.t === 'sw') {
      const line = h.t === 'st' ? 'top' : h.t === 'sb' ? 'bot' : 'w', b = boxBase(model, f.x);
      let val = h.t === 'sw' ? Math.max(0.5, Math.abs(u)) : v;
      if (h.t === 'st') val = Math.max(val, b.bot + 0.5);
      if (h.t === 'sb') val = Math.min(val, b.top - 0.5);
      setOutAt(line, f.x, r1(val)); syncCircleOutlines({ line, x: f.x });
      return;
    }
    if (h.t === 'yw') { if (!FIXK().wid) { makeCtl(h.i, 'yw'); f.p.yw = r1(v); } if (h.sec) setOutAt('w', f.x, r1(Math.max(0.5, Math.abs(u)))); return; }
    if (h.t === 'dia') { const b = boxBase(model, f.x); f.p.dia = r1(Math.max(1, 2 * (v - (b.top + b.bot) / 2))); return; }
    if (h.t === 'node' || h.t === 'ntan') return h.t === 'node' ? applySecNode(f, h, u, v) : applySecTan(f, h, u, v, ctrl);
    const b = boxBase(model, f.x), P = model.P[h.i], cz = cornerZ(b, P.sl);
    if (h.t === 'rtx') { makeCtl(h.i, 'rt'); f.p.rtx = r1(Math.max(0, cz.zt - Math.abs(u))); }
    else if (h.t === 'rty') { makeCtl(h.i, 'rt'); f.p.rty = r1(Math.max(0, b.top - v)); }
    else if (h.t === 'rby') { makeCtl(h.i, 'rb'); f.p.rby = r1(Math.max(0, v - b.bot)); }
    else if (h.t === 'rbx') { makeCtl(h.i, 'rb'); f.p.rbx = r1(Math.max(0, cz.zb - Math.abs(u))); }
    else if (h.t === 'sl') { makeCtl(h.i, 'sl'); f.p.sl = r1(clamp(Math.atan2(Math.abs(u) - b.w, Math.max(1e-6, b.h / 2)) * 180 / Math.PI, -60, 60)); }
  }
  // Knoten eines freien Spants ziehen (u = z, v = y, normiert auf den Umriss-Kasten); Endknoten liegen fest.
  function applySecNode(f, h, u, v) {
    if (f.lock) return;
    const b = boxAt(model, f.x), n = f.nodes.length, k = h.k;
    if (k === 0 || k === n - 1) return;
    const q = f.nodes[k]; q.y = clamp((v - b.bot) / (b.h || 1), 0.01, 0.99); q.z = Math.max(0, Math.abs(u)) / (b.w || 1);
    straighten(f.nodes); renormFree(f, b);
  }
  function widestY(nodes) { let best = [0.5, -1]; for (const q of polyOf(nodes, 24)) if (q[1] > best[1]) best = q; return best[0]; }
  // Freier Spant: breiteste Stelle = Breite aus der Draufsicht (z max = 1), der Überschuss geht in den Umriss.
  function renormFree(f, b) {
    let zm = 0; for (const q of polyOf(f.nodes, 24)) zm = Math.max(zm, q[1]);
    if (!(zm > 1e-6) || Math.abs(zm - 1) < 1e-4) return;
    for (const q of f.nodes) { q.z /= zm; q.i = [q.i[0], q.i[1] / zm]; q.o = [q.o[0], q.o[1] / zm]; }
    setOutAt('w', f.x, b.w * zm);
  }
  function applySecTan(f, h, u, v, ctrl) {
    if (f.lock) return;
    const b = boxAt(model, f.x), q = f.nodes[h.k], n = f.nodes.length, hh = b.h || 1, w = b.w || 1;
    const py = b.bot + q.y * b.h, pz = q.z * b.w;
    let vec = [(v - py) / hh, (u - pz) / w];
    if (h.k === 0 || h.k === n - 1) vec = [0, Math.max(0.01, vec[1])];
    q[h.tan] = vec;
    const oStraight = h.tan === 'o' ? (h.k > 0 && f.nodes[h.k - 1].l) : q.l;   // Gegenseite ist eine Gerade -> nicht mitdrehen
    if (!ctrl && !oStraight && h.k > 0 && h.k < n - 1) {
      const other = h.tan === 'o' ? 'i' : 'o', L = Math.hypot(q[other][0], q[other][1]), Lv = Math.hypot(vec[0], vec[1]);
      if (L > 1e-9 && Lv > 1e-9) q[other] = [-vec[0] / Lv * L, -vec[1] / Lv * L];
    }
    renormFree(f, b);
  }
  function addNode(f, k, t) {
    if (f.type !== 'free' || f.lock) return;
    if (k == null) k = longestSeg(f.nodes);
    splitSeg(f.nodes, k, t == null ? 0.5 : t); selNode = k + 1;
    if (f.nodes[k].l) f.nodes[k + 1].l = true;   // geteilte Gerade bleibt beidseitig gerade
  }
  // Abschnitt ab Knoten k (bis zum nächsten Knoten) gerade <-> Kurve.
  function setStraight(f, k, on) {
    if (f.type !== 'free' || f.lock || !(k >= 0 && k < f.nodes.length - 1)) return;
    if (on) f.nodes[k].l = true; else delete f.nodes[k].l;
    straighten(f.nodes);
  }
  function removeNode(f, k) {
    if (f.type !== 'free' || f.lock || f.nodes.length <= 3) return;
    if (!(k > 0 && k < f.nodes.length - 1)) k = Math.max(1, Math.min(f.nodes.length - 2, Math.round(f.nodes.length / 2)));
    f.nodes.splice(k, 1); selNode = Math.max(1, k - 1); straighten(f.nodes);
  }
  // Umrisspunkt bei x einfügen: Bezier exakt geteilt (Form bleibt), neuer Punkt „glatt mit Tangente".
  function insertOutPt(line, x) {
    if (lineLocked(line)) return false;
    const pts = outlines()[line]; x = r1(x);
    let j = -1; for (let q = 0; q + 1 < pts.length; q++) if (x > pts[q].x + 0.5 && x < pts[q + 1].x - 0.5) j = q;
    if (j < 0) return false;
    if (pts[j].l) {   // in einer Geraden: neuer Punkt auf der Strecke, beide Teile bleiben gerade
      pts.splice(j + 1, 0, { x, v: r2(lineAt(outSegs(pts), x)), c: 0, l: true });
      S('rproPt', { line, k: j + 1 }); lastSel = 'pt';
      return true;
    }
    if (splMode() !== 'cr') {
      // krümmungsstetig/B-Spline: glatten Punkt auf der Kurve einsetzen (Form bleibt nahezu gleich, ohne Tangentenpunkte zu erzeugen)
      pts.splice(j + 1, 0, { x, v: r2(lineAt(outSegs(pts), x)), c: 0 });
      S('rproPt', { line, k: j + 1 }); lastSel = 'pt';
      return true;
    }
    const sg = outSegs(pts)[j], t = solveT(sg.P, x), [A, B] = splitBez(sg.P, t), M = A[3], a = pts[j], b = pts[j + 1];
    const ta = outTan(pts, j), tb = outTan(pts, j + 1);
    if (!a.c) a.c = 1; a.i = ta.i; a.o = [A[1][0] - A[0][0], A[1][1] - A[0][1]];
    if (!b.c) b.c = 1; b.o = tb.o; b.i = [B[2][0] - B[3][0], B[2][1] - B[3][1]];
    pts.splice(j + 1, 0, { x: r1(M[0]), v: r2(M[1]), c: 1, i: [A[2][0] - M[0], A[2][1] - M[1]], o: [B[1][0] - M[0], B[1][1] - M[1]] });
    S('rproPt', { line, k: j + 1 }); lastSel = 'pt';
    return true;
  }
  // Spant bei x einfügen: Typ wie der vordere Nachbar, Parameter interpoliert (kein Steuerspant) — wie DevFus.
  function insertFormer(x) {
    const fr = formers(); x = r1(x);
    if (fr.some(f => Math.abs(f.x - x) < 0.5 || (f.jmp === 'a' && x > f.x && x < f.x + JG + 0.5))) return;
    if (!model || !model.P) build();
    let j = 0; while (j + 1 < fr.length && fr[j + 1].x < x) j++;
    const nb = fr[j], f = { x, type: nb ? nb.type : 'egg', p: nb ? JSON.parse(JSON.stringify(nb.p)) : {}, ctl: {}, mode: nb ? Object.assign({}, nb.mode) : {} };
    if (f.type === 'free') f.nodes = JSON.parse(JSON.stringify(model && model.MA ? sectionNodes(model, x) : nb.nodes));
    if (f.type === 'circle') f.ctl.dia = true;
    let i = fr.findIndex(q => q.x > x); if (i < 0) i = fr.length;
    fr.splice(i, 0, normFr(f)); S('rproSel', i); lastSel = 'fr';
    buildSidebar(); draw();
  }
  function removeFormer(i) {
    const fr = formers(); if (fr.length <= 1) return;
    clearJump(fr[i]);   // Partner einer Sprungstelle bleibt als gewöhnlicher Spant
    fr.splice(i, 1); S('rproSel', Math.max(0, i - 1)); buildSidebar(); draw();
  }
  function removeOutPt() {
    const sp = selPt(); if (!sp || lineLocked(sp.line)) return;
    const pts = outlines()[sp.line]; if (sp.k === 0 || sp.k === pts.length - 1 || pts.length <= 2) return;
    pts.splice(sp.k, 1); S('rproPt', null); buildSidebar(); draw();
  }
  // Abschnitt k -> k+1 eines Umrisses gerade <-> Spline.
  function setStraightOut(line, k, on) {
    if (lineLocked(line)) return;
    const pts = outlines()[line]; if (!(k >= 0 && k < pts.length - 1)) return;
    if (on) pts[k].l = true; else delete pts[k].l;
  }
  // Abschnitt ab dem gewählten Umrisspunkt umschalten (am Linienende: der Abschnitt davor).
  function toggleStraightSel() {
    const sp = selPt(); if (!sp) return false;
    const pts = outlines()[sp.line], k = Math.min(sp.k, pts.length - 2);
    setStraightOut(sp.line, k, !pts[k].l); return true;
  }
  // Punkttyp umschalten: 0 glatt (auto), 1 glatt mit Tangente, 2 Ecke (Griffe = aktuelle Tangente).
  function setPtType(line, k, c) {
    const pts = outlines()[line], p = pts[k]; if (!p) return;
    if (c && !p.c) { const t = outTan(pts, k); p.i = t.i; p.o = t.o; }
    p.c = c; normPt(p);
    if (c === 1) { const L = Math.hypot(p.i[0], p.i[1]), d = [p.o[0] - p.i[0], p.o[1] - p.i[1]], Ld = Math.hypot(d[0], d[1]), lo = Math.hypot(p.o[0], p.o[1]); if (Ld > 1e-9 && k > 0 && k < pts.length - 1) { p.i = [-d[0] / Ld * L, -d[1] / Ld * L]; p.o = [d[0] / Ld * lo, d[1] / Ld * lo]; } }
  }
  function cutStep(dir) {
    if (!model || !model.bounds) return;
    const b = model.bounds, k = AXI[CUT().axis], stp = Math.max(0.5, Math.round((b.mx[k] - b.mn[k]) / 100 * 2) / 2);
    cutSet(clamp(cutGet() + dir * stp, b.mn[k], b.mx[k])); syncCutInputs(); draw();
  }
  // Doppelklick in der Spantansicht: Knoten auf der Kurve des gewählten (freien) Spants einfügen.
  function insertNodeAt(mx, my) {
    const f = formers()[selIdx()]; if (!f || f.type !== 'free' || f.lock || !xf2 || !model) return false;
    const b = boxAt(model, f.x), hh = b.h; let best = null, bd = 9;
    for (let k = 0; k + 1 < f.nodes.length; k++) {
      const a = f.nodes[k], c = f.nodes[k + 1];
      const P = [[b.bot + a.y * hh, a.z * b.w], [b.bot + (a.y + a.o[0]) * hh, (a.z + a.o[1]) * b.w], [b.bot + (c.y + c.i[0]) * hh, (c.z + c.i[1]) * b.w], [b.bot + c.y * hh, c.z * b.w]];
      for (let q = 1; q < 40; q++) { const t = q / 40, p = bez2(P, t); for (const sg of [1, -1]) { const sc = xf2.P(sg * p[1], p[0]), d = Math.hypot(sc.x - mx, sc.y - my); if (d < bd) { bd = d; best = { k, t }; } } }
    }
    if (!best) return false;
    addNode(f, best.k, best.t); buildSidebar(); draw(); return true;
  }
  // Nächste Umrisslinie unter dem Mauszeiger (Seitenansicht: top/bot, Draufsicht: w), sonst null.
  function lineNear(kind, mx, my) {
    if (!model || !model.L || !xf2) return null;
    const lines = kind === 'side' ? ['top', 'bot'] : kind === 'top' ? ['w'] : [];
    const [u] = xf2.inv(mx, my); let best = null, bd = 8;
    for (const line of lines) {
      const v = lineAt(model.L[line], u);
      for (const sg of (line === 'w' ? [1, -1] : [1])) { const p = xf2.P(u, sg * v), d = Math.abs(p.y - my); if (d < bd) { bd = d; best = line; } }
    }
    return best;
  }
  function bindCanvas() {
    if (!canvas || bound) return; bound = true;
    // Würfel nur in der 3D-Ansicht (in den 2D-Ansichten drehte er unsichtbar die 3D-Kamera); dort nur ⌂ = Rumpf + Bild einpassen.
    if (window.ViewCube && ViewCube.home) ViewCube.home({ reset: () => { const v = C('rproView'); if (v === 'cut') cam2.cut = { zoom: 1, px: 0, py: 0 }; else if (v !== '3d') fit2d(v); }, redraw: () => draw(), canvas: () => canvas, active: () => C('rproView') !== '3d' });
    if (window.ViewCube) ViewCube.attach({ reset: () => resetCam(), active: () => C('rproView') === '3d', canvas: () => canvas, get: () => cam, set: (y, p) => { cam.yaw = y; cam.pitch = p; }, redraw: () => draw(), rot: ViewCube.ROT_STD, k: [0.01, 0.01] });
    let downX = 0, downY = 0, moved = false, pickFr = null;
    const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    // Mausrad-Doppelklick in der 3D-Ansicht: neuer Drehpunkt am Modellpunkt unter dem Cursor
    if (window.ViewCube && ViewCube.midDbl) ViewCube.midDbl(canvas, (x, y) => {
      if (C('rproView') !== '3d' || !setPivotAt(x, y)) return false;
      dragging = false; draw(); return true;
    });
    canvas.addEventListener('mousedown', e => {
      const v = C('rproView'); dragging = true; moved = false; lastX = downX = e.clientX; lastY = downY = e.clientY; dragH = null; dragCtrl = e.ctrlKey; pickFr = null;
      if (v === '3d') {
        const [mx, my] = pos(e), vb = e.button === 0 ? hitViewBtn(mx, my) : null;
        if (vb) { dragging = false; clickViewBtn(vb); e.preventDefault(); return; }
        dragMode = (e.shiftKey || e.button === 1) ? 'pan' : 'rot';
      }
      else if (imgTool && img[v] && C(IMG_KEY[v]) && e.button === 0 && xf2) {
        const [mx, my] = pos(e), wp = xf2.inv(mx, my), c = C(IMG_KEY[v]);
        if (imgTool === 'move') dragMode = 'img';
        else if (imgTool === 'base') {
          dragging = false; c.bp = wToImg(v, wp[0], wp[1]); imgAlignNose(v); setImgTool(null); syncImgInputs();
        }
        else if (imgTool === 'crop') { cropA = wp; cropB = wp; dragMode = 'crop'; draw(); }
        else if (imgTool === 'trace') { dragging = false; runTrace(v, wp); }
        else if (imgTool === 'ref') {
          if (!refA) { refA = wp; refB = wp; dragMode = 'ref'; }
          else { dragging = false; refB = wp; finishRef(v); }
          draw();
        }
      }
      else if (e.altKey) dragMode = 'img';
      else {
        const [mx, my] = pos(e); const h = hitHandle(v, mx, my);
        if (h && e.button === 0) {
          if (h.t === 'pt' || h.t === 'ptan') { S('rproPt', { line: h.line, k: h.k }); lastSel = 'pt'; }
          else if (h.t === 'kh' || h.t === 'fcut' || h.t === 'wg' || h.t === 'vg' || h.t === 'fg') { /* Kabinenhaube / Schnittlinie / Leitlinie: keine Auswahl */ }
          else if (h.t === 'fin') finSel = h.k;
          else { S('rproSel', h.i); lastSel = 'fr'; if (h.t === 'node') selNode = h.k; }
          if (h.locked) { dragMode = 'pan'; draw(); } else { dragMode = 'handle'; dragH = h; if (v === 'side' || v === 'top' || v === 'sec') view2dBase(v); }   // Ansichtsbezug sofort einfrieren
        }
        else { dragMode = 'pan'; if (v === 'sec' && e.button === 0) pickFr = hitFormer(mx, my); }
      }
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      const v = C('rproView');
      if (!dragging) {
        if (imgTool === 'ref' && refA && xf2 && canvas.matches(':hover')) { const [mx, my] = pos(e); refB = xf2.inv(mx, my); draw(); return; }
        if (imgTool && v !== '3d') return;
        if (v !== '3d' && canvas.matches(':hover')) { const [mx, my] = pos(e); const h = hitHandle(v, mx, my); const ch = !sameH(h, hot); hot = h; canvas.style.cursor = h ? (h.locked ? 'not-allowed' : 'pointer') : (v === 'sec' && hitFormer(mx, my) != null ? 'pointer' : ''); if (ch) draw(); }
        return;
      }
      const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 3) moved = true;
      if (dragMode === 'rot') { cam.yaw += dx * 0.01 * (Math.cos(cam.pitch) < 0 ? -1 : 1); cam.pitch += dy * 0.01; draw(); }   // Modell folgt der Maus (Betrachter bei +z)
      else if (dragMode === 'pan') { if (v === '3d') { cam.px += dx; cam.py += dy; } else { cam2[v].px += dx; cam2[v].py += dy; } draw(); }
      else if (dragMode === 'img') { const c = C(IMG_KEY[v]); if (c && xf2) { c.x += dx / xf2.sc; c.y -= dy / xf2.sc; syncImgInputs(); draw(); } }
      else if (dragMode === 'crop' && xf2) { const [mx, my] = pos(e); cropB = xf2.inv(mx, my); draw(); }
      else if (dragMode === 'ref' && xf2) { const [mx, my] = pos(e); refB = xf2.inv(mx, my); draw(); }
      else if (dragMode === 'handle' && dragH && xf2 && moved) { const [mx, my] = pos(e); const [u, w] = xf2.inv(mx, my); applyHandle(dragH, u, w, dragCtrl || e.ctrlKey); build(); draw(); }
    });
    window.addEventListener('mouseup', () => {
      if (dragging && dragMode === 'crop') { if (moved) finishCrop(C('rproView')); else { cropA = cropB = null; draw(); } }
      if (dragging && dragMode === 'ref' && moved && refA && refB) finishRef(C('rproView'));   // Strecke aufgezogen (sonst: zweiter Klick)
      if (dragging && dragMode === 'handle') buildSidebar();
      if (dragging && !moved && dragMode === 'handle') draw();
      if (dragging && !moved && dragMode === 'pan' && pickFr != null) selectFormer(pickFr);                 // Spantkurve angeklickt
      else if (dragging && !moved && dragMode === 'handle' && dragH && C('rproView') === 'sec') revealFormerMenu();
      dragging = false; dragH = null; pickFr = null;
      if (state.activeTab === 'rpro') histCommit();   // ein Zug = ein Schritt
    });
    canvas.addEventListener('dblclick', e => {
      const v = C('rproView');
      if (imgTool || performance.now() - imgToolEnd < 700) return;   // Doppelklick beim Bildwerkzeug: kein Spant/Punkt einfügen
      if (v === '3d') { resetCam(); draw(); return; }
      const [mx, my] = pos(e);
      if ((v === 'side' || v === 'top') && xf2) {
        if (hitHandle(v, mx, my)) return;
        if (v === 'side' && (khInsertAt(mx, my) || finInsertAt(mx, my))) { build(); buildSidebar(); draw(); return; }
        const ln = lineNear(v, mx, my), [u] = xf2.inv(mx, my);
        if (ln) { if (insertOutPt(ln, u)) { buildSidebar(); draw(); } return; }
        insertFormer(u); return;
      }
      if (v === 'sec') { if (hitHandle(v, mx, my)) return; if (insertNodeAt(mx, my)) return; }
      cam2[v] = { zoom: 1, px: 0, py: 0 }; draw();
    });
    // Rechtsklick auf einen Punkt löscht ihn: Spantknoten (Spantansicht), Umriss-/Hauben-/Leitwerkspunkte (Seiten-/Draufsicht).
    canvas.addEventListener('contextmenu', e => {
      const v = C('rproView'); if (v === '3d') return;
      e.preventDefault();
      const [mx, my] = pos(e), h = hitHandle(v, mx, my); if (!h || h.locked) return;
      if (h.t === 'node') { const f = formers()[h.i]; if (f) removeNode(f, h.k); }
      else if (h.t === 'pt') { S('rproPt', { line: h.line, k: h.k }); removeOutPt(); }
      else if (h.t === 'kh' && /^n\d+$/.test(h.k)) {
        const k = KH(), i = +h.k.slice(1); if (!k.pts || k.pts.length <= 2) return;
        k.pts.splice(i, 1); khSel = Math.max(0, i - 1);
      }
      else if (h.t === 'fin') {
        const f = FN(); if (!f.fpts || f.fpts.length <= 3) return;
        f.fpts.splice(h.k, 1); finSel = Math.max(0, h.k - 1);
      }
      else return;
      build(); buildSidebar(); draw();
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault(); const v = C('rproView'), f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      if (e.altKey && v !== '3d' && v !== 'cut') {
        const c = C(IMG_KEY[v]); if (!c || !xf2) return;
        const [mx, my] = pos(e);
        if (e.shiftKey) { const d = e.deltaY || e.deltaX; imgSetRot(v, (+c.rot || 0) + (d < 0 ? 1 : -1) * (e.ctrlKey ? 0.1 : 0.5), xf2.inv(mx, my)); }   // Umschalt+Rad dreht
        else imgSetLen(v, c.len * f, xf2.inv(mx, my));   // um den Basispunkt, sonst um den Mauszeiger
        syncImgInputs(); draw(); return;
      }
      // Zoomzentrum = Mauszeiger: der Punkt unter dem Cursor bleibt stehen (alle Ansichten: Bildpunkt = Mitte + Verschiebung + Maßstab·…)
      const q = v === '3d' ? cam : cam2[v]; if (!q) return;
      const z = Math.max(0.05, Math.min(60, q.zoom * f)), k = z / q.zoom, [mx, my] = pos(e);
      q.px = (mx - W / 2) - (mx - W / 2 - q.px) * k; q.py = (my - H / 2) - (my - H / 2 - q.py) * k; q.zoom = z;
      draw();
    }, { passive: false });
    window.addEventListener('keydown', e => {
      if (state.activeTab !== 'rpro' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) return;
      const v = C('rproView');
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) { e.preventDefault(); histStep((e.key === 'z' || e.key === 'Z') && !e.shiftKey); return; }
      if (e.key === 'Escape' && imgTool) { setImgTool(null); e.preventDefault(); return; }
      if (v === 'sec') {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { selectFormer(selIdx() - 1); e.preventDefault(); }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { selectFormer(selIdx() + 1); e.preventDefault(); }
        else if (e.key === 'Delete') { const f = formers()[selIdx()]; if (f) { removeNode(f, selNode); buildSidebar(); draw(); } }
      }
      else if (v === 'cut' || (v === '3d' && CUT().on)) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { cutStep(-1); e.preventDefault(); }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { cutStep(+1); e.preventDefault(); }
      }
      else if (e.key === 'Delete' && v !== '3d') { if (lastSel === 'pt' && selPt()) removeOutPt(); else removeFormer(selIdx()); }
      else if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey && !e.altKey && (v === 'side' || v === 'top') && lastSel === 'pt' && toggleStraightSel()) { buildSidebar(); draw(); }
    });
    const vb = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
    const setView = v => { S('rproView', v); if (v === '3d') resetCam(); buildSidebar(); draw(); };
    vb('rproUndo', () => histStep(true)); vb('rproRedo', () => histStep(false)); histBtns();
    vb('rproIso', () => setView('3d'));
    vb('rpro3dTop', () => { S('rproView', '3d'); resetCam({ yaw: 0, pitch: 1.5 }); buildSidebar(); draw(); });
    vb('rproSideV', () => setView('side'));
    vb('rproTopV', () => setView('top'));
    vb('rproSecV', () => setView('sec'));
    vb('rproCutV', () => { const q = CUT(); if (q.on && C('rproView') === 'cut') S('rproView', '3d'); else { q.on = true; S('rproView', 'cut'); cam2.cut = { zoom: 1, px: 0, py: 0 }; } buildSidebar(); draw(); });
  }
  function loadImage(kind) {
    const handler = f => {
      const im = new Image(); im.onload = () => {
        img[kind] = im;
        const key = IMG_KEY[kind];
        if (!C(key)) {
          const b = model && model.bounds ? model.bounds : { mn: [0, -50, -50], mx: [1000, 50, 50] };
          if (kind === 'sec') S(key, { len: b.mx[2] - b.mn[2], x: b.mn[2], y: b.mx[1], flip: false });
          else S(key, { len: b.mx[0] - b.mn[0], x: b.mn[0], y: kind === 'side' ? b.mx[1] : b.mx[2], flip: false });
        }
        buildSidebar(); draw();
      };
      im.src = URL.createObjectURL(f);
    };
    if (App.loadFileVia) App.loadFileVia({ 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'] }, handler, 'fileRproImg', 'ldImg');
    else { const inp = document.getElementById('fileRproImg'); if (inp) { inp.onchange = () => { if (inp.files[0]) handler(inp.files[0]); inp.value = ''; }; inp.click(); } }
  }
  function syncImgInputs() {
    const c = C(IMG_KEY[C('rproView')]); if (!c) return;
    const kind = C('rproView');
    document.querySelectorAll('[data-rpimg]').forEach(el => { if (document.activeElement !== el) el.value = el.dataset.rpimg === 'ref' ? (c.ref && img[kind] ? r1(imgRefMm(kind)) : '') : el.dataset.rpimg === 'rot' ? (+c.rot || 0) : r1(c[el.dataset.rpimg]); });
  }

  // Profil (.dat) für einen Anbau laden: cb({ name, pts }).
  function datLoad(cb) {
    const handler = async f => {
      try {
        const prof = Airfoil.parseDat(await f.text());
        const closed = App.closeLoadedTE ? App.closeLoadedTE(prof) : prof;
        cb({ name: prof.name || f.name, pts: closed.map(q => ({ x: q.x, y: q.y })) });
      } catch (err) { alert(T('Import fehlgeschlagen: ') + err.message); }
    };
    let inp = document.getElementById('fileDatRpro');
    if (!inp) { inp = document.createElement('input'); inp.type = 'file'; inp.id = 'fileDatRpro'; inp.accept = '.dat,.bez,.txt,.cor'; inp.style.display = 'none'; document.body.appendChild(inp); }
    inp.onchange = () => { const f = inp.files && inp.files[0]; inp.value = ''; if (f) handler(f); };
    if (typeof App.loadFileVia === 'function') App.loadFileVia({ 'text/plain': ['.dat', '.bez', '.txt', '.cor'] }, handler, 'fileDatRpro', 'ldDat');
    else inp.click();
  }
  // Doppelklick auf die freie Haubenlinie: Punkt genau dort einfügen (der hintere Teil wird eine Gerade).
  function khInsertAt(mx, my) {
    const k = KH(), q = model && model.kh; if (!k.on || k.mode !== 'free' || !q || !q.S || !xf2) return false;
    const [u, w] = xf2.inv(mx, my); let best = null;
    q.S.forEach((c, i) => { const nr = khNearest(c.pts, u, w); if (!nr) return; const p = xf2.P(nr.p[0], nr.p[1]), d = Math.hypot(p.x - mx, p.y - my); if (d < 8 && (!best || d < best.d)) best = { i, d, p: nr.p }; });
    if (!best) return false;
    k.pts.splice(best.i + 1, 0, { x: r1(best.p[0]), y: r1(best.p[1]), r: 0, t: 'line', curv: 0, pos: 50 }); khSel = best.i + 1;
    return true;
  }
  // Doppelklick auf den freien Leitwerksumriss: Punkt genau dort einfügen (gleiche Abschnittsart wie bisher).
  function finInsertAt(mx, my) {
    const f = FN(), g = model && model.fin; if (!f.on || f.mode !== 'free' || !g || !g.free || !xf2) return false;
    const [u, w] = xf2.inv(mx, my); let best = null;
    g.S.forEach((c, i) => { const nr = khNearest(c, u, w); if (!nr) return; const p = xf2.P(nr.p[0], nr.p[1]), d = Math.hypot(p.x - mx, p.y - my); if (d < 8 && (!best || d < best.d)) best = { i, d, p: nr.p }; });
    if (!best) return false;
    const s0 = f.fpts[best.i];
    f.fpts.splice(best.i + 1, 0, { x: r1(best.p[0]), y: r1(best.p[1]), t: s0.t === 'spline' ? 'spline' : 'line', r: 0, k: false }); finSel = best.i + 1;
    return true;
  }
  // Seitenleiste des freien Leitwerksumrisses: Punkttabelle (X, Y, Eckradius, Knick, Abschnittsart).
  function finFreeSidebar(body, f, rb) {
    const pts = f.fpts || [], n = pts.length;
    finSel = clamp(finSel, 0, Math.max(0, n - 1));
    hint(body, 'Geschlossener Umriss in der Seitenansicht: Punkt für Punkt im Uhrzeigersinn oder dagegen, der letzte Abschnitt schließt zum ersten Punkt. Jeder Abschnitt bis zum nächsten Punkt ist eine Gerade oder ein Spline; aufeinanderfolgende Splines bilden eine glatte Kurve, aus einer Geraden läuft ein Spline tangential heraus (Knick = an diesem Punkt nicht glätten). R = Eckradius. Die Fußpunkte in den Rumpf legen — der Umriss wird mit dem Rumpf vereinigt. In der Seitenansicht: lila Griffe ziehen, Doppelklick auf den Umriss setzt einen Punkt. Zum Abzeichnen eine Dreiseitenansicht als Hintergrundbild laden.');
    const tb = tbl(body), th = document.createElement('tr');
    th.innerHTML = '<th style="width:16px">#</th><th>X</th><th>Y</th><th title="' + T('Eckradius an diesem Punkt (mm)') + '">R</th><th title="' + T('Knick: Kurve an diesem Punkt nicht glätten') + '">' + T('Knick') + '</th><th style="width:30%" title="' + T('Form der Linie von diesem Punkt bis zum nächsten') + '">' + T('Abschnitt') + '</th>'; tb.appendChild(th);
    pts.forEach((s, i) => {
      const tr = document.createElement('tr'); if (i === finSel) tr.style.background = 'rgba(199,146,255,.18)';
      const td = el => { const c = document.createElement('td'); if (el) c.appendChild(el); tr.appendChild(c); return c; };
      const t0 = td(); t0.textContent = i + 1; t0.style.cursor = 'pointer'; t0.onclick = () => { finSel = i; rb(); };
      td(cellInp(r1(s.x), v => { s.x = v; finSel = i; rb(); }));
      td(cellInp(r1(s.y), v => { s.y = v; finSel = i; rb(); }));
      td(cellInp(r1(+s.r || 0), v => { s.r = Math.max(0, v); finSel = i; rb(); }));
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!s.k; cb.onchange = () => { s.k = cb.checked; finSel = i; rb(); }; td(cb).style.textAlign = 'center';
      const se = document.createElement('select'); se.style.cssText = 'width:100%;font-size:10px;padding:0';
      for (const [val, name] of [['line', 'gerade'], ['spline', 'Spline']]) { const o = document.createElement('option'); o.value = val; o.textContent = T(name); se.appendChild(o); }
      se.value = s.t === 'spline' ? 'spline' : 'line'; se.onchange = () => { s.t = se.value; finSel = i; rb(); };
      se.title = T('Abschnitt') + ' ' + (i + 1) + ' → ' + (i + 1 < n ? i + 2 : 1); td(se);
      tb.appendChild(tr);
    });
    const bb = miniBar(body);
    bb.appendChild(mkMini(T('+ Punkt'), () => {
      const i = finSel, a = pts[i], b = pts[(i + 1) % n];
      pts.splice(i + 1, 0, { x: r1((+a.x + +b.x) / 2), y: r1((+a.y + +b.y) / 2), t: a.t === 'spline' ? 'spline' : 'line', r: 0, k: false }); finSel = i + 1; rb();
    })).title = T('Fügt hinter dem gewählten Punkt einen neuen ein (Mitte des Abschnitts).');
    const del = mkMini(T('Punkt löschen'), () => { if (pts.length > 3) { pts.splice(finSel, 1); finSel = Math.max(0, finSel - 1); rb(); } }); del.disabled = n <= 3; bb.appendChild(del);
    const mv = (dx, dy) => { for (const q of pts) { q.x = r1(+q.x + dx); q.y = r1(+q.y + dy); } rb(); };
    const b2 = miniBar(body);
    b2.appendChild(mkMini('← 5', () => mv(-5, 0))).title = T('Ganzen Umriss verschieben (mm)');
    b2.appendChild(mkMini('5 →', () => mv(5, 0))).title = T('Ganzen Umriss verschieben (mm)');
    b2.appendChild(mkMini('↑ 5', () => mv(0, 5))).title = T('Ganzen Umriss verschieben (mm)');
    b2.appendChild(mkMini('↓ 5', () => mv(0, -5))).title = T('Ganzen Umriss verschieben (mm)');
  }
  // Seitenleiste des freien Linienzugs: Punkttabelle + Einstellungen des gewählten Abschnitts.
  function khFreeSidebar(body, kh, rb) {
    const pts = kh.pts, n = pts.length, q = model && model.kh, Pn = q && q.Pn && q.Pn.length === n ? q.Pn : null;
    khSel = clamp(khSel, 0, n - 1);
    hint(body, 'Die Schnittlinie läuft von der Oberkante über beliebig viele Punkte zurück zur Oberkante (erster und letzter Punkt liegen immer auf der Oberkante). Jeder Abschnitt bis zum nächsten Punkt ist eine Gerade, ein gewölbter Spline oder eine Seite eines Tragflächenprofils; R = Übergangsradius an der Ecke. In der Seitenansicht: gelbe Griffe ziehen, Doppelklick auf die Linie setzt einen Punkt.');
    const tb = tbl(body), th = document.createElement('tr');
    th.innerHTML = '<th style="width:16px">#</th><th>X</th><th>Y</th><th title="' + T('Übergangsradius an diesem Punkt (mm)') + '">R</th><th style="width:36%" title="' + T('Form der Linie von diesem Punkt bis zum nächsten') + '">' + T('Abschnitt') + '</th>'; tb.appendChild(th);
    pts.forEach((s, i) => {
      const tr = document.createElement('tr'), end = i === 0 || i === n - 1; if (i === khSel) tr.style.background = 'rgba(255,210,122,.18)';
      const td = el => { const c = document.createElement('td'); if (el) c.appendChild(el); tr.appendChild(c); return c; };
      const t0 = td(); t0.textContent = i + 1; t0.style.cursor = 'pointer'; t0.onclick = () => { khSel = i; rb(); };
      td(cellInp(r1(s.x), v => { s.x = v; khSel = i; rb(); }));
      const iy = cellInp(r1(end ? (Pn ? Pn[i][1] : 0) : s.y), v => { s.y = v; khSel = i; rb(); }); iy.disabled = end; td(iy);
      if (end) td(); else td(cellInp(r1(+s.r || 0), v => { s.r = Math.max(0, v); khSel = i; rb(); }));
      if (i < n - 1) {
        const se = document.createElement('select'); se.style.cssText = 'width:100%;font-size:10px;padding:0';
        for (const [val, name] of [['line', 'gerade'], ['spline', 'Spline'], ['foil', 'Profil']]) { const o = document.createElement('option'); o.value = val; o.textContent = T(name); se.appendChild(o); }
        se.value = s.t === 'spline' || s.t === 'foil' ? s.t : 'line';
        se.onchange = () => {
          s.t = se.value; khSel = i;
          if (s.t === 'spline' && !(+s.curv)) { s.curv = 10; s.pos = s.pos || 50; }
          if (s.t === 'foil') { if (!s.fSrc) s.fSrc = 'naca'; if (!s.fThk) s.fThk = 12; if (!s.fSide) s.fSide = 'up'; if (!s.fNose) s.fNose = 'a'; if (s.fScale == null) s.fScale = 100; }
          rb();
        };
        td(se);
      } else td();
      tb.appendChild(tr);
    });
    const bb = miniBar(body);
    bb.appendChild(mkMini(T('+ Punkt'), () => {
      const i = Math.min(khSel, n - 2), a = Pn ? Pn[i] : [pts[i].x, pts[i].y || 0], b = Pn ? Pn[i + 1] : [pts[i + 1].x, pts[i + 1].y || 0];
      pts.splice(i + 1, 0, { x: r1((a[0] + b[0]) / 2), y: r1((a[1] + b[1]) / 2), r: 0, t: 'line', curv: 0, pos: 50 }); khSel = i + 1; rb();
    })).title = T('Fügt hinter dem gewählten Punkt einen neuen ein (Mitte des Abschnitts).');
    const del = mkMini(T('Punkt löschen'), () => { if (pts.length > 2) { pts.splice(khSel, 1); khSel = Math.max(0, khSel - 1); rb(); } }); del.disabled = n <= 2; bb.appendChild(del);
    const s = pts[khSel];
    if (khSel < n - 1 && (s.t === 'spline' || s.t === 'foil')) {
      subhead(body, T('Abschnitt') + ' ' + (khSel + 1) + ' → ' + (khSel + 2));
      const nr = (label, key, o) => numRow(body, label, () => s[key], v => { s[key] = v; rb(); }, Object.assign({ step: 1, norender: true }, o || {}));
      if (s.t === 'spline') { nr('Wölbung (mm)', 'curv'); nr('Lage der Wölbung (%)', 'pos', { step: 5, min: 10, max: 90 }); }
      else {
        selectRow(body, 'Profil', [['naca', 'NACA 00xx (symmetrisch)'], ['wing', 'aus Tragflächendesign (Wurzelrippe)'], ['dat', 'aus Datei (.dat)']], () => s.fSrc || 'naca', v => { s.fSrc = v; rb(); });
        if (s.fSrc === 'dat') {
          const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:4px;align-items:center;margin:2px 0 4px';
          const nm = document.createElement('span'); nm.style.cssText = 'font-size:10px;opacity:.8;flex:1'; nm.textContent = s.fProf && s.fProf.name ? s.fProf.name : T('(kein Profil geladen)');
          row.appendChild(mkMini(T('Profil laden…'), () => datLoad(p => { s.fProf = p; rb(); }))); row.appendChild(nm); body.appendChild(row);
        } else if (s.fSrc !== 'wing') nr('Dicke (%)', 'fThk', { min: 1, max: 40, int: true, enter: true });
        if (s.fSrc === 'dat' || s.fSrc === 'wing') selectRow(body, 'Profilseite', [['up', 'Oberseite'], ['lo', 'Unterseite']], () => s.fSide || 'up', v => { s.fSide = v; rb(); });
        selectRow(body, 'Profilnase', [['a', 'am Anfang des Abschnitts'], ['b', 'am Ende des Abschnitts']], () => s.fNose || 'a', v => { s.fNose = v; rb(); });
        nr('Höhe der Profilseite (%)', 'fScale', { step: 10, hint: '100 = maßstäblich zur Sehne (Strecke zwischen den beiden Punkten). Größer = bauchiger; positiv = in den Rumpf hinein (Ausschnitt wird größer), negativ = in die Haube hinein. Auch mit dem gelben Griff an der dicksten Stelle ziehbar.' });
      }
    }
  }
  function profRow(body, label, src, thk, prof, setSrc, setThk, setProf, rb, withWing) {
    const opts = withWing ? [['wing', 'aus Tragflächendesign (Wurzelrippe)'], ['dat', 'aus Datei (.dat)']] : [['naca', 'NACA 00xx (symmetrisch, Dicke unten)'], ['dat', 'aus Datei (.dat)']];
    selectRow(body, label, opts, () => src(), v => { setSrc(v); rb(); });
    if (src() === 'dat') {
      const row = document.createElement('div'); row.style.display = 'flex'; row.style.gap = '4px'; row.style.alignItems = 'center'; row.style.margin = '2px 0 4px';
      const nm = document.createElement('span'); nm.style.fontSize = '10px'; nm.style.opacity = '.8'; nm.style.flex = '1'; nm.textContent = prof() && prof().name ? prof().name : T('(kein Profil geladen)');
      row.appendChild(mkMini(T('Profil laden…'), () => datLoad(p => { setProf(p); rb(); }))); row.appendChild(nm); body.appendChild(row);
    } else if (!withWing) numRow(body, 'Dicke (%)', () => thk(), v => { setThk(v); rb(); }, { step: 1, min: 1, max: 40, int: true, norender: true, enter: true });
  }
  function colorRow(body, label, key) {
    const def = DEF[key], row = document.createElement('div'); row.className = 'row';
    const l = document.createElement('label'); l.textContent = T(label); row.appendChild(l);
    const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;gap:6px;align-items:center';
    const inp = document.createElement('input'); inp.type = 'color'; inp.value = /^#[0-9a-f]{6}$/i.test(C(key) || '') ? C(key) : def;
    inp.style.cssText = 'width:46px;height:26px;padding:0;cursor:pointer';
    inp.oninput = () => { S(key, inp.value); draw(); };
    const rs = document.createElement('button'); rs.textContent = '\u21ba'; rs.title = T('Standardfarbe'); rs.style.cssText = 'padding:0 8px;min-width:0';
    rs.onclick = () => { S(key, def); inp.value = def; draw(); };
    wrap.appendChild(inp); wrap.appendChild(rs); row.appendChild(wrap); body.appendChild(row);
  }
  // ---------- Fenster „Projektion“ (Anformung nach ErnstV) ----------------------------------------------------------
  // Eigenes Ansichtsfenster: Wurzel- bzw. Leitwerksprofil an der Anschlussstelle, Basis der Projektion (Endleiste
  // aufgedickt/gerundet) und die Projektion selbst; Griffe vorn/hinten/oben/unten (Leitwerk: seitlich) zum Ziehen,
  // links die Zahlenwerte. Beim Ziehen wird nur die Projektion neu gerechnet, beim Loslassen der ganze Rumpf.
  function projSrc() {
    if (!model) return null;
    if (projW.kind === 'wing' || projW.kind === 'vt') {
      // V-Leitwerk: Tragflächen-Geometrie im gedrehten Rahmen (Y = Höhe senkrecht zur Leitwerkshälfte), Rumpf dort umgerechnet
      const vt = projW.kind === 'vt', g = vt ? model.vt && model.vt.gw : model.wing, w = vt ? VT() : WG(); if (!g || g.mode !== 'fil') return null;
      const { base, F2 } = projRingWing(g, w), R = [];
      for (let i = 0; i <= 80; i++) { const u = (1 - Math.cos(Math.PI * i / 80)) / 2, x = g.xLE + u * g.chord; R.push([x, wingYs(g, x).yu]); }
      for (let i = 80; i >= 0; i--) { const u = (1 - Math.cos(Math.PI * i / 80)) / 2, x = g.xLE + u * g.chord; R.push([x, wingYs(g, x).yl]); }
      const bodyU = [], bodyL = []; let x0 = Infinity, x1 = -Infinity; for (const p of F2) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); }
      for (let i = 0; i <= 60; i++) {
        const x = clamp(x0 - 20 + (x1 - x0 + 40) * i / 60, model.x0, model.x1);
        if (vt) { const Pb = g.bodyAt(x); bodyU.push([x, Pb[0][0]]); bodyL.push([x, Pb[Pb.length - 1][0]]); }
        else { bodyU.push([x, lineAt(model.L.top, x)]); bodyL.push([x, lineAt(model.L.bot, x)]); }
      }
      return { p: w, prof: R, base, F2, body: [bodyU, bodyL], vName: vt ? T('Höhe') : 'Y', col: vt ? 'rgba(200,150,255,.95)' : 'rgba(120,230,150,.95)', keys: { f: 'pF', b: 'pB', u: 'pU', l: 'pL' }, xTE: g.xLE + g.chord,
        org: [g.xLE, g.yLE], free: w.pMode === 'free' && Array.isArray(w.pPts) && w.pPts.length >= 4, pk: 'pPts', open: false, autoF2: () => projRingWing(g, w, true).F2 };
    }
    const g = model.fin, f = FN(); if (!g || !g.ff) return null;
    const { base, F2 } = projRingFin(g, f, g.ff.yAt, g.ff.ch), ch = g.ff.ch, R = [], tAt = x => { const xx = clamp(x, ch[0] + 1e-6, ch[1] - 1e-6); return Math.max(0, finT(g, xx, g.ff.yAt(xx))); };
    for (let i = 0; i <= 80; i++) { const u = (1 - Math.cos(Math.PI * i / 80)) / 2, x = ch[0] + u * (ch[1] - ch[0]); R.push([x, i ? tAt(x) : 0]); }
    for (let i = 80; i >= 0; i--) { const u = (1 - Math.cos(Math.PI * i / 80)) / 2, x = ch[0] + u * (ch[1] - ch[0]); R.push([x, i ? -tAt(x) : 0]); }
    const bodyU = [], bodyL = []; let x0 = Infinity, x1 = -Infinity; for (const p of F2) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); }
    for (let i = 0; i <= 60; i++) { const x = clamp(x0 - 20 + (x1 - x0 + 40) * i / 60, model.x0, model.x1), hw = lineAt(model.L.w, x); bodyU.push([x, hw]); bodyL.push([x, -hw]); }
    return { p: f, prof: R, base, F2, body: [bodyU, bodyL], vName: 'Z', col: 'rgba(200,150,255,.95)', keys: { f: 'pF', b: 'pB', u: 'pS', l: 'pS' }, yA: g.ff.yA, xTE: g.ff.ch[1],
      // mit abgetrenntem Ruder: offene Punktliste pPtsR (Enden in den Ecken an der Ruderlinie)
      // symmetrisch: nur die obere Hälfte (pHalf bzw. mit Ruder pHalfR, offen ab der Ecke an der Ruderlinie) wird bearbeitet
      org: [ch[0], 0], pk: g.rud ? 'pHalfR' : 'pHalf', open: !!g.rud, half: true, free: f.pMode === 'free' && Array.isArray(f[g.rud ? 'pHalfR' : 'pHalf']) && f[g.rud ? 'pHalfR' : 'pHalf'].length >= 3, autoF2: () => projRingFin(g, f, g.ff.yAt, g.ff.ch, true).F2 };
  }
  function projWinOpen(kind) {
    projW.kind = kind; projW.auto = true;
    if (!projW.win) projWinBuild();
    projW.win.style.display = 'flex'; projWinSide(); projWinDraw();
  }
  function projWinBuild() {
    const win = document.createElement('div'); projW.win = win; win.id = 'rproProjWin';
    win.style.cssText = 'position:fixed;left:14vw;top:12vh;width:70vw;height:66vh;min-width:520px;min-height:300px;z-index:60;display:none;flex-direction:column;'
      + 'background:var(--panel,#161a20);border:1px solid var(--border,#2a3038);border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.5);resize:both;overflow:hidden';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--border,#2a3038);cursor:move;user-select:none';
    const ttl = document.createElement('b'); ttl.style.flex = '1'; projW.ttl = ttl;
    const close = document.createElement('button'); close.textContent = '✕'; close.title = T('Schließen'); close.style.padding = '2px 8px'; close.onclick = () => { win.style.display = 'none'; };
    head.append(ttl, close);
    head.onmousedown = e => {
      if (e.target.closest('button')) return;
      e.preventDefault(); const r = win.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
      const mv = ev => { win.style.left = (r.left + ev.clientX - sx) + 'px'; win.style.top = Math.max(0, r.top + ev.clientY - sy) + 'px'; };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    };
    const body = document.createElement('div'); body.style.cssText = 'flex:1;display:flex;min-height:0';
    const side = document.createElement('div'); side.className = 'sidebar-inner'; projW.side = side;
    side.style.cssText = 'width:290px;flex:none;overflow:auto;padding:8px 10px;border-right:1px solid var(--border,#2a3038);display:flex;flex-direction:column;gap:6px';
    const right = document.createElement('div'); right.style.cssText = 'flex:1;position:relative;min-width:0';
    const cv = document.createElement('canvas'); cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'; projW.cv = cv; projW.cx = cv.getContext('2d');
    right.appendChild(cv); body.append(side, right); win.append(head, body); document.body.appendChild(win);
    new ResizeObserver(() => projWinDraw()).observe(right);
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const hit = (mx, my) => { let best = null, bd = 10; for (const h of projW.hs || []) { const d = Math.hypot(h.sx - mx, h.sy - my); if (d < bd) { bd = d; best = h; } } return best; };
    cv.addEventListener('wheel', e => {
      e.preventDefault(); const v = projW.view; if (!v) return; const [mx, my] = pos(e), f = Math.exp(-e.deltaY * 0.0015);
      projW.auto = false; const wx = (mx - v.ox) / v.s, wy = (v.oy - my) / v.s; v.s *= f; v.ox = mx - wx * v.s; v.oy = my + wy * v.s; projWinDraw();
    }, { passive: false });
    cv.addEventListener('mousedown', e => {
      const [mx, my] = pos(e), h = hit(mx, my), v = projW.view; if (!v) return;
      projW.drag = h ? { h, mx0: mx, my0: my, sx0: h.sx, sy0: h.sy } : { pan: true, x: e.clientX, y: e.clientY, ox: v.ox, oy: v.oy };
      if (!h) projW.auto = false; e.preventDefault();
      if (h && h.k[0] === 'c') { projW.sel = +h.k.slice(1); projWinSide(); projWinDraw(); }
    });
    window.addEventListener('mousemove', e => {
      const d = projW.drag, v = projW.view;
      if (!d) { if (projW.win.style.display !== 'none' && v) { const [mx, my] = pos(e), h = hit(mx, my); if ((h && h.k) !== (projW.hot && projW.hot.k)) { projW.hot = h; cv.style.cursor = h ? (h.k[0] === 'c' ? 'move' : h.k === 'f' || h.k === 'b' ? 'ew-resize' : 'ns-resize') : ''; projWinDraw(); } } return; }
      if (d.pan) { v.ox = d.ox + e.clientX - d.x; v.oy = d.oy + e.clientY - d.y; projWinDraw(); return; }
      // Feinziehen: Umschalt = 1/10 des Mauswegs, Strg = nur die größere Richtung
      const [mx0, my0] = pos(e); let ddx = mx0 - d.mx0, ddy = my0 - d.my0;
      if (e.shiftKey) { ddx *= 0.1; ddy *= 0.1; } if (e.ctrlKey) { if (Math.abs(ddx) > Math.abs(ddy)) ddy = 0; else ddx = 0; }
      const mx = d.sx0 + ddx, my = d.sy0 + ddy, wx = (mx - v.ox) / v.s, wy = (v.oy - my) / v.s, S0 = projSrc(); if (!S0) return;
      const p = S0.p, K = S0.keys, bb = d.h.bb;
      if (d.h.k[0] === 'c') {
        const L = p[S0.pk], i = +d.h.k.slice(1), q = L && L[i];
        if (q) { q.dx = r2(wx - S0.org[0]); q.dy = r2(wy - S0.org[1]); projFixEnd(S0, L, i); }
      }
      else if (d.h.k === 'f') p[K.f] = r1(Math.max(0, bb.x0 - wx - (+p.pD || 0)));
      else if (d.h.k === 'b') p[K.b] = r1(Math.max(0, wx - S0.xTE - (+p.pD || 0)));   // hinten = Schwanzlänge ab der Endleiste
      else if (d.h.k === 'u') p[K.u] = r1(Math.max(0, wy - bb.v1 - (+p.pD || 0)));
      else if (d.h.k === 'l') p[K.l] = r1(Math.max(0, bb.v0 - wy - (+p.pD || 0)));
      d.moved = true; projWinDraw(); projWinSyncInputs();
    });
    window.addEventListener('mouseup', () => { const d = projW.drag; projW.drag = null; if (d && d.h && d.moved) projWinCommit(); });
    // Pfeiltasten: gewählten Kontrollpunkt um 1 px (Umschalt 10 px) verschieben, neu gerechnet nach kurzer Pause
    window.addEventListener('keydown', e => {
      if (!projW.win || projW.win.style.display === 'none' || projW.sel == null) return;
      const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key]; if (!k) return;
      const t = document.activeElement; if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      const S0 = projSrc(), v = projW.view; if (!S0 || !S0.free || !v) return;
      const L = S0.p[S0.pk], q = L[projW.sel]; if (!q) return;
      e.preventDefault(); const st = (e.shiftKey ? 10 : 1) / v.s;
      q.dx = r3(q.dx + k[0] * st); q.dy = r3(q.dy + k[1] * st); projFixEnd(S0, L, projW.sel); projWinDraw(); projWinSyncInputs();
      clearTimeout(projW.keyT); projW.keyT = setTimeout(() => projWinCommit(), 450);
    });
    // Doppelklick: freie Projektion -> Kontrollpunkt auf der Linie einfügen, sonst einpassen. Rechtsklick: Punkt löschen.
    cv.addEventListener('dblclick', e => {
      const S0 = projSrc(), v = projW.view;
      if (S0 && S0.free && v) {
        const [mx, my] = pos(e), wx = (mx - v.ox) / v.s, wy = (v.oy - my) / v.s, L = S0.p[S0.pk], n = L.length; let best = -1, bd = 15 / v.s;
        for (let i = 0; i < (S0.open || S0.half ? n - 1 : n); i++) {
          const a = [S0.org[0] + L[i].dx, S0.org[1] + L[i].dy], b = [S0.org[0] + L[(i + 1) % n].dx, S0.org[1] + L[(i + 1) % n].dy];
          const ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1, t = clamp(((wx - a[0]) * ex + (wy - a[1]) * ey) / l2, 0, 1), dd = Math.hypot(wx - a[0] - ex * t, wy - a[1] - ey * t);
          if (dd < bd) { bd = dd; best = i; }
        }
        if (best >= 0) { L.splice(best + 1, 0, { dx: r2(wx - S0.org[0]), dy: r2(wy - S0.org[1]) }); projWinCommit(); return; }
      }
      projW.auto = true; projWinDraw();
    });
    cv.addEventListener('contextmenu', e => {
      e.preventDefault(); const S0 = projSrc(); if (!S0 || !S0.free) return;
      const [mx, my] = pos(e), h = hit(mx, my), L = S0.p[S0.pk]; if (!h || h.k[0] !== 'c' || L.length <= (S0.half ? 3 : 4)) return;
      const i = +h.k.slice(1); if ((S0.open || S0.half) && (i === 0 || i === L.length - 1)) return;
      L.splice(i, 1); projW.sel = null; projWinCommit();
    });
  }
  // Werte übernehmen: Rumpf neu rechnen, Hauptansicht + Seitenleiste + Fenster auffrischen
  // Neue freie Punkte aus der Offset-Projektion: p.pN Punkte (Standard 10) auf der Linie; beim B-Spline als Kontrollpunkte
  // so, dass die Kurve durch diese Punkte läuft (gleiche Form wie die Offset-Projektion)
  function projCtrlNew(S0, p) {
    const N = clamp(Math.round(+p.pN || 10), 4, 40);
    const L = S0.half ? projToCtrlHalf(S0.autoF2(), S0.org[0], S0.org[1], projHalfN(N), S0.open ? S0.xTE : null) : S0.open ? projToCtrlOpen(S0.autoF2(), S0.org[0], S0.org[1], N, S0.xTE) : projToCtrl(S0.autoF2(), S0.org[0], S0.org[1], N); if (p.pSpl !== 'bs') return L;
    if (S0.half) return projHalfConv(L, S0.open, true);
    return (S0.open || S0.half ? bsCtrlThroughOpen : bsCtrlThrough)(L.map(q => [q.dx, q.dy])).map(q => ({ dx: r3(q[0]), dy: r3(q[1]) }));
  }
  // Endpunkte der freien Linie festhalten (halbe Liste: Nase und hinten auf der Mittelachse bzw. Ecke an der Ruderlinie)
  function projFixEnd(S0, L, i) {
    const q = L[i], last = L.length - 1; if (!q) return;
    if (S0.half) { if (i === 0) { if (S0.open) q.dx = r2(S0.xTE - S0.org[0]); else q.dy = 0; } if (i === last) q.dy = 0; }
    else if (S0.open && (i === 0 || i === last)) q.dx = r2(S0.xTE - S0.org[0]);
  }
  function projWinCommit() { clearTimeout(projW.keyT); hist.touched = true; build(); draw(); buildSidebar(); projWinSide(); projWinDraw(); }
  function projWinSyncInputs() {
    if (!projW.side) return; const S0 = projSrc(); if (!S0) return;
    projW.side.querySelectorAll('[data-pj]').forEach(el => { if (document.activeElement !== el) el.value = r1(+S0.p[el.dataset.pj] || 0); });
    const q = S0.free && projW.sel != null ? S0.p[S0.pk][projW.sel] : null;
    projW.side.querySelectorAll('[data-pc]').forEach(el => { if (q && document.activeElement !== el) el.value = r2(q[el.dataset.pc]); });
  }
  function projWinSide() {
    const side = projW.side; if (!side) return; side.innerHTML = '';
    const fin = projW.kind === 'fin';
    const vt = projW.kind === 'vt';
    projW.ttl.textContent = T('Projektion') + ' — ' + T(fin ? 'Seitenleitwerk (Draufsicht in Anschlusshöhe)' : vt ? 'V-Leitwerk (Ebene senkrecht zur Leitwerkshälfte)' : 'Tragfläche (Seitenansicht)');
    const S0 = projSrc();
    if (!S0) { hint(side, fin ? 'Seitenleitwerk mit Anschluss „Anformung tangential“ einschalten.' : vt ? 'V-Leitwerk-Anschluss mit der Art „Anformung“ einschalten.' : 'Tragflächenübergang mit der Art „Anformung“ einschalten.'); return; }
    const p = S0.p, set = (k, v) => { p[k] = v; projWinCommit(); };
    selectRow(side, 'Art der Projektion', [['auto', 'Offset des Profils (Maße)'], ['free', 'frei (Kontrollpunkte)']], () => (S0.free ? 'free' : 'auto'), v => {
      if (v === 'free' && !(Array.isArray(p[S0.pk]) && p[S0.pk].length >= (S0.half ? 3 : 4))) { p.pSpl = 'bs'; p[S0.pk] = projCtrlNew(S0, p); }
      p.pMode = v; projW.sel = null; projWinCommit();
    });
    if (S0.free) {
      if (S0.half) hint(side, 'Das Seitenleitwerk ist symmetrisch: nur die obere Hälfte (Punkte gefüllt) wird bearbeitet, die untere ist gespiegelt (hohle Punkte). Nase und hinterer Punkt liegen auf der Mittelachse.');
      if (S0.open) hint(side, 'Seitenruder abgetrennt: die freie Projektion ist eine offene Linie von der oberen zur unteren Ecke an der Ruderlinie, hinten schließt sie gerade ab (eckig wie der Offset). Die beiden Eckpunkte lassen sich nur seitlich verschieben.');
      hint(side, 'Freie Projektion: geschlossener Spline über die Kontrollpunkte (blau). Punkte ziehen, Doppelklick auf die Linie = Punkt einfügen, Rechtsklick auf einen Punkt = löschen (mindestens 4). Umschalt beim Ziehen = fein (1/10), Strg = nur waagrecht/senkrecht, Pfeiltasten verschieben den gewählten Punkt (Umschalt = 10 ×). Rad = Zoom, Ziehen ins Leere = verschieben. Die Punkte hängen an der Profilnase und wandern mit, wenn die Tragfläche verschoben wird.');
      const fb = miniBar(side);
      fb.appendChild(mkMini(T('Aus Offset neu übernehmen'), () => { p[S0.pk] = projCtrlNew(S0, p); projW.sel = null; projWinCommit(); })).title = T('Verwirft die freien Punkte und legt sie aus der Offset-Projektion (Maße unten) neu an.');
      fb.appendChild(mkMini(T('Einpassen'), () => { projW.auto = true; projWinDraw(); }));
      numRow(side, 'Punktzahl beim Übernehmen', () => clamp(Math.round(+p.pN || 10), 4, 40), v => { p.pN = clamp(Math.round(v), 4, 40); }, { step: 1, min: 4, max: 40, norender: true, hint: 'So viele Kontrollpunkte legt „Aus Offset neu übernehmen“ an (gleichmäßig längs der Linie). Wenige Punkte = ruhigere Linie.' });
      // Spline-Art: beim Umschalten bleibt die Kurve (Punkte werden umgerechnet)
      selectRow(side, 'Spline-Art', [['bs', 'B-Spline (Kontrollpunkte, am ruhigsten)'], ['cr', 'durch die Punkte (Catmull-Rom)']], () => (p.pSpl === 'bs' ? 'bs' : 'cr'), v => {
        const cur = p.pSpl === 'bs' ? 'bs' : 'cr'; if (v === cur) return;
        if (S0.half) { p[S0.pk] = projHalfConv(p[S0.pk], S0.open, v === 'bs'); p.pSpl = v; projWinCommit(); return; }
        const Q = p[S0.pk].map(q => [+q.dx || 0, +q.dy || 0]), R = v === 'bs' ? (S0.open ? bsCtrlThroughOpen : bsCtrlThrough)(Q) : (S0.open ? bsKnotPtsOpen : bsKnotPts)(Q);
        p[S0.pk] = R.map(q => ({ dx: r3(q[0]), dy: r3(q[1]) })); p.pSpl = v; projWinCommit();
      }, 'B-Spline: die Punkte ziehen die Linie nur an (Kontrollpolygon gestrichelt) — verschieben verformt sie sanft und örtlich, nie mehr Wendepunkte als das Polygon. Catmull-Rom: die Linie läuft genau durch die Punkte. Beim Umschalten bleibt die Form erhalten.');
      boolRow(side, 'Krümmungskamm und Wendepunkte zeigen', () => !!C('rproComb'), v => { S('rproComb', v); projWinDraw(); draw(); });
      const Lq = p[S0.pk], q = projW.sel != null ? Lq[projW.sel] : null, endQ = (S0.open || S0.half) && (projW.sel === 0 || projW.sel === Lq.length - 1);
      if (q) {
        subhead(side, T('Punkt') + ' ' + (projW.sel + 1));
        if (endQ) hint(side, S0.half ? 'Endpunkt: liegt auf der Mittelachse (Nase, hinten) bzw. mit X auf der Ruderlinie (Ecke) fest.' : 'Eckpunkt an der Ruderlinie: X liegt fest, nur seitlich verschiebbar.');
        if (!(endQ && S0.open && !S0.half)) numRow(side, 'X ab Profilnase (mm)', () => r2(q.dx), v => { q.dx = r2(v); projWinCommit(); }, { step: 0.1, norender: true }).dataset.pc = 'dx';
        numRow(side, (fin ? 'Z' : 'Y') + ' ' + T('ab Profilnase (mm)'), () => r2(q.dy), v => { q.dy = r2(v); projWinCommit(); }, { step: 0.1, norender: true }).dataset.pc = 'dy';
        if (Lq.length > (S0.half ? 3 : 4) && !endQ) miniBar(side).appendChild(mkMini(T('Punkt löschen'), () => { Lq.splice(projW.sel, 1); projW.sel = null; projWinCommit(); }));
      }
      if (!fin) { subhead(side, 'Wurzelrippe'); numRow(side, 'Endleistendicke der Wurzelrippe (mm)', () => p.te, v => set('te', Math.max(0, v)), { step: 0.1, min: 0, norender: true }); }
      return;
    }
    hint(side, fin
      ? 'Leitwerksprofil (lila) in Anschlusshöhe, darum die Projektion (blau) — sie wird senkrecht auf den Rumpfrücken projiziert. Griffe vorn, hinten und seitlich ziehen; Rad = Zoom, Ziehen = verschieben, Doppelklick = einpassen. Gestrichelt: Rumpfbreite.'
      : 'Wurzelprofil (grün), darum die Projektion (blau) — sie wird waagrecht auf den Rumpf projiziert. Griffe vorn, hinten, oben und unten ziehen; Rad = Zoom, Ziehen = verschieben, Doppelklick = einpassen. Gestrichelt: Rumpfober- und -unterkante.');
    subhead(side, 'Offset des Profils');
    numRow(side, 'Offset rundum (mm)', () => p.pD, v => set('pD', Math.max(0.5, v)), { step: 0.5, min: 0.5, norender: true, hint: 'Grundform der Projektion: das Profil wird überall um dieses Maß nach außen versetzt (gleicher Abstand, hinten runder Bogen). Die Zuschläge darunter verformen diesen Offset weich nach vorn, hinten, oben oder unten.' }).dataset.pj = 'pD';
    subhead(side, 'Zusätzliche Verlängerung');
    numRow(side, 'vorn (X, mm)', () => p.pF, v => set('pF', Math.max(0, v)), { step: 1, min: 0, norender: true }).dataset.pj = 'pF';
    if (!S0.open) numRow(side, 'hinten (X, mm)', () => p.pB, v => set('pB', Math.max(0, v)), { step: 1, min: 0, norender: true }).dataset.pj = 'pB';
    if (fin) numRow(side, 'seitlich (Z, mm)', () => p.pS, v => set('pS', Math.max(0, v)), { step: 0.5, min: 0, norender: true }).dataset.pj = 'pS';
    else {
      numRow(side, 'oben (Y, mm)', () => p.pU, v => set('pU', Math.max(0, v)), { step: 0.5, min: 0, norender: true }).dataset.pj = 'pU';
      numRow(side, 'unten (Y, mm)', () => p.pL, v => set('pL', Math.max(0, v)), { step: 0.5, min: 0, norender: true }).dataset.pj = 'pL';
    }
    if (S0.open) hint(side, 'Seitenruder abgetrennt: die Projektion endet hinten gerade an der Ruderlinie — keine Verlängerung, Aufdickung oder Rundung der Endleiste.');
    if (!S0.open) subhead(side, 'Endleiste der Projektion');
    if (!S0.open) numRow(side, 'Aufdickung der Endleiste (mm)', () => p.pTe, v => set('pTe', Math.max(0, v)), { step: 0.5, min: 0, norender: true, hint: 'Die Projektion bekommt hinten diese zusätzliche Dicke (Ober- und Unterseite um die Nase aufgeklappt) — die Anformung läuft hinten nicht spitz aus.' });
    if (!S0.open) numRow(side, 'Radius runde Endleiste (mm)', () => p.pTeR, v => set('pTeR', Math.max(0, v)), { step: 0.5, min: 0, norender: true, hint: 'Rundet die Ecken der Endleiste der Projektion. Bei spitzer Endleiste wird die Spitze mit diesem Radius verrundet.' });
    if (!fin) {
      subhead(side, 'Wurzelrippe');
      numRow(side, 'Endleistendicke der Wurzelrippe (mm)', () => p.te, v => set('te', Math.max(0, v)), { step: 0.1, min: 0, norender: true, hint: 'Gilt für Wurzelrippe und Tragflächenanschluss (für den Schaumkern dieselbe Dicke wählen).' });
    }
    const mb = miniBar(side);
    mb.appendChild(mkMini(T('Einpassen'), () => { projW.auto = true; projWinDraw(); }));
    mb.appendChild(mkMini(T('Standardwerte'), () => {
      const d = fin ? DEF.rproFin : projW.kind === 'vt' ? DEF.rproVt : DEF.rproWing; for (const k of ['pD', 'pF', 'pB', 'pU', 'pL', 'pS', 'pTe', 'pTeR']) if (k in d) p[k] = d[k]; projWinCommit();
    }));
  }
  function projWinDraw() {
    const cv = projW.cv; if (!cv || !projW.win || projW.win.style.display === 'none') return;
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, Wd = Math.max(1, r.width), Hd = Math.max(1, r.height);
    if (cv.width !== Math.round(Wd * dpr) || cv.height !== Math.round(Hd * dpr)) { cv.width = Math.round(Wd * dpr); cv.height = Math.round(Hd * dpr); }
    const c = projW.cx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.fillStyle = '#0f1318'; c.fillRect(0, 0, Wd, Hd);
    const S0 = projSrc(); projW.hs = [];
    if (!S0) { c.fillStyle = '#9aa'; c.font = '13px system-ui'; c.fillText(T('Keine Anformung eingeschaltet.'), 20, 30); return; }
    let x0 = Infinity, x1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of S0.F2.concat(S0.prof)) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); v0 = Math.min(v0, q[1]); v1 = Math.max(v1, q[1]); }
    if (projW.auto || !projW.view) {
      const s = Math.min((Wd - 170) / Math.max(1, x1 - x0), (Hd - 90) / Math.max(1, v1 - v0));
      projW.view = { s, ox: Wd / 2 - s * (x0 + x1) / 2, oy: Hd / 2 + s * (v0 + v1) / 2 };
    }
    const v = projW.view, P = (x, y) => [v.ox + x * v.s, v.oy - y * v.s];
    const line = (pts, col, wd, dash, close) => { c.beginPath(); pts.forEach((q, i) => { const [a, b] = P(q[0], q[1]); i ? c.lineTo(a, b) : c.moveTo(a, b); }); if (close) c.closePath(); c.strokeStyle = col; c.lineWidth = wd; c.setLineDash(dash || []); c.stroke(); c.setLineDash([]); };
    // Raster 10 mm
    { const st = v.s * 10 < 12 ? 50 : 10; c.strokeStyle = 'rgba(255,255,255,.05)'; c.lineWidth = 1; c.beginPath();
      for (let x = Math.floor((-v.ox / v.s) / st) * st; x < (Wd - v.ox) / v.s; x += st) { const [a] = P(x, 0); c.moveTo(a, 0); c.lineTo(a, Hd); }
      for (let y = Math.floor(((v.oy - Hd) / v.s) / st) * st; y < v.oy / v.s; y += st) { const [, b] = P(0, y); c.moveTo(0, b); c.lineTo(Wd, b); } c.stroke(); }
    for (const b of S0.body) line(b, 'rgba(160,190,220,.55)', 1, [5, 4]);
    line(S0.prof, S0.col, 2, null, true);
    line(S0.base.map(q => [q[0], q[1]]), 'rgba(255,255,255,.35)', 1, [3, 3], true);
    line(S0.F2, '#4fb3ff', 2.2, null, true);
    // Griffe an den äußersten Punkten; Maßtexte = Verlängerung
    let bx0 = Infinity, bx1 = -Infinity, bv0 = Infinity, bv1 = -Infinity; for (const q of S0.base) { bx0 = Math.min(bx0, q[0]); bx1 = Math.max(bx1, q[0]); bv0 = Math.min(bv0, q[1]); bv1 = Math.max(bv1, q[1]); }
    const bb = { x0: bx0, x1: bx1, v0: bv0, v1: bv1 }, ext = (cmp) => S0.F2.reduce((a, q) => (cmp(q, a) ? q : a), S0.F2[0]);
    const pf = ext((q, a) => q[0] < a[0]), pb = ext((q, a) => q[0] > a[0]), pu = ext((q, a) => q[1] > a[1]), pl = ext((q, a) => q[1] < a[1]), K = S0.keys, pp = S0.p;
    c.font = '12px system-ui';
    if (S0.free) {
      const L = pp[S0.pk], n = L.length, Q = L.map(q => [S0.org[0] + q.dx, S0.org[1] + q.dy]);
      // Kontrollpolygon (offen bei abgetrenntem Ruder); symmetrisch: ganze Linie gestrichelt, gespiegelte Punkte hohl
      const QF = S0.half ? projHalfFull(L, S0.open).map(q => [S0.org[0] + q.dx, S0.org[1] + q.dy]) : Q;
      line(QF, 'rgba(79,179,255,.35)', 1, [2, 3], !S0.open);
      if (S0.half) { c.strokeStyle = 'rgba(79,179,255,.55)'; c.lineWidth = 1.2; for (const q of QF.slice(n)) { const [sx, sy] = P(q[0], q[1]); c.beginPath(); c.arc(sx, sy, 4, 0, 2 * Math.PI); c.stroke(); } }
      // Krümmungskamm der Projektion (geschlossene Linie, diskret: Kreis durch drei Punkte)
      let combTxt = '';
      { const F = S0.F2, m = F.length, Kc = [];
        for (let i = 0; i < m; i++) {
          const a = F[(i - 1 + m) % m], b = F[i], d2 = F[(i + 1) % m], ux = b[0] - a[0], uz = b[1] - a[1], vx = d2[0] - b[0], vz = d2[1] - b[1];
          if (S0.open && b[0] > S0.xTE - 1e-6) continue;   // gerade Kante und Ecken an der Ruderlinie nicht bewerten
          const la = Math.hypot(ux, uz), lb = Math.hypot(vx, vz), lc = Math.hypot(d2[0] - a[0], d2[1] - a[1]); if (la < 1e-9 || lb < 1e-9 || lc < 1e-9) continue;
          Kc.push({ x: b[0], v: b[1], k: 2 * (ux * vz - uz * vx) / (la * lb * lc), n: [-(d2[1] - a[1]) / lc, (d2[0] - a[0]) / lc] });
        }
        const st = curvStats(Kc); combTxt = st.infl.length + ' ' + T('Wendepunkte') + ', R min ' + (isFinite(st.rmin) ? st.rmin.toFixed(1) + ' mm' : '∞');
        if (C('rproComb')) {
          const kRef = kRob(Kc), lenPx = Math.max(5, +C('rproCombLen') || 40);
          if (kRef > 1e-12) {
            const env = []; c.strokeStyle = 'rgba(255,150,210,.35)'; c.lineWidth = 1; c.beginPath();
            Kc.forEach((q, i) => {
              const t = Math.abs(q.k) / kRef, kk = Math.sign(q.k) * (t <= 1 ? t : Math.min(1.8, 1 + 0.5 * Math.log(t))) * lenPx / v.s;
              const a = P(q.x, q.v), b = P(q.x - q.n[0] * kk, q.v - q.n[1] * kk); if (i % 2 === 0) { c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); } env.push(b);
            });
            c.stroke(); c.strokeStyle = 'rgba(255,120,200,.9)'; c.lineWidth = 1.2; c.beginPath(); env.forEach((b, i) => i ? c.lineTo(b[0], b[1]) : c.moveTo(b[0], b[1])); c.closePath(); c.stroke();
            c.strokeStyle = '#ffe14d'; c.lineWidth = 2; for (const q of st.infl) { const a = P(q.x, q.v); c.beginPath(); c.arc(a[0], a[1], 6, 0, Math.PI * 2); c.stroke(); }
          }
        }
      }
      Q.forEach((q, i) => {
        const [sx, sy] = P(q[0], q[1]), k = 'c' + i, hot = projW.hot && projW.hot.k === k, sel = projW.sel === i; projW.hs.push({ k, sx, sy, bb });
        c.fillStyle = sel ? '#ffd24a' : hot ? '#cfe8ff' : '#4fb3ff'; c.beginPath(); c.arc(sx, sy, hot || sel ? 6.5 : 5, 0, 2 * Math.PI); c.fill();
      });
      c.textAlign = 'left'; c.fillStyle = '#9fb0c0';
      c.fillText(n + ' ' + T('Kontrollpunkte') + ' · ' + combTxt + ' · ' + T('Doppelklick auf die Linie = Punkt einfügen, Rechtsklick = löschen'), 10, Hd - 10);
      return;
    }
    const hs = [['f', pf, pp[K.f]]].concat(S0.open ? [] : [['b', pb, pp[K.b]]], [['u', pu, pp[K.u]]]); if (projW.kind !== 'fin') hs.push(['l', pl, pp[K.l]]);
    for (const [k, q, val] of hs) {
      const [sx, sy] = P(q[0], q[1]), hot = projW.hot && projW.hot.k === k;
      projW.hs.push({ k, sx, sy, bb });
      c.fillStyle = hot ? '#ffd24a' : '#4fb3ff'; c.beginPath(); c.arc(sx, sy, hot ? 7 : 5.5, 0, 2 * Math.PI); c.fill();
      c.fillStyle = '#dfe8f0'; const tx = k === 'f' ? sx - 12 : k === 'b' ? sx + 12 : sx + 10, ty = k === 'u' ? sy - 10 : k === 'l' ? sy + 18 : sy - 10;
      c.textAlign = k === 'f' ? 'right' : 'left'; c.fillText(r1(+val || 0) + ' mm', tx, ty);
    }
    c.textAlign = 'left'; c.fillStyle = '#9fb0c0';
    c.fillText('X ' + r1(S0.F2.reduce((a, q) => Math.min(a, q[0]), Infinity)) + ' … ' + r1(S0.F2.reduce((a, q) => Math.max(a, q[0]), -Infinity)) + ' mm' + (S0.yA != null ? ' · ' + T('Anschlusshöhe Y') + ' ' + r1(S0.yA) + ' mm' : '') + ' · ' + S0.vName + ' ↑', 10, Hd - 10);
  }

  // ---- Fenster „Hohlkehle zeichnen (Vorderansicht)“: Hohlkehle oben und unten je als eigene Kurve wie die Rumpfumrisse
  // (B-Spline mit Kontrollpunkten oder krümmungsstetiger Spline durch die Punkte, Punktarten, Griffe) mit Krümmungskamm.
  // Ansicht „Schnitt“: Spantschnitt bei 30 % der Wurzeltiefe in mm (Blick längs X); Ansicht „normiert“: eine Seite groß
  // im Einheitsquadrat (Fuß unten links, Rippe oben rechts). Rad = Zoom, Ziehen ins Leere = verschieben; Umschalt beim
  // Ziehen = fein (1/10), Strg = nur waagrecht/senkrecht, Pfeiltasten verschieben den gewählten Punkt (Umschalt = größer).
  // Seitenleitwerk (tgt 'fin'): eine Form f.cv für beide Seiten (symmetrisch), Spantschnitt bei 30 % der Tiefe an der Schnittlinie.
  function cvWinOpen(tgt) {
    if (!cvW.win) cvWinBuild();
    tgt = tgt === 'fin' || tgt === 'vt' ? tgt : 'wing';
    if (tgt !== cvW.tgt) { cvW.tgt = tgt; cvW.sel = null; cvW.hot = null; }
    if (tgt === 'fin') cvW.nside = 'U';
    cvW.win.querySelector('b').textContent = T(tgt === 'fin' ? 'Hohlkehle Seitenleitwerk — Vorderansicht (Spantschnitt)' : tgt === 'vt' ? 'Hohlkehle V-Leitwerk — Spantschnitt (gedreht auf die Leitwerkshälfte)' : 'Hohlkehle — Vorderansicht (Spantschnitt)');
    cvW.win.style.display = 'flex'; cvWinSide(); cvWinDraw();
  }
  const cvFin = () => cvW.tgt === 'fin';
  const cvObj = () => cvFin() ? FN() : cvW.tgt === 'vt' ? VT() : WG();
  const cvSides = () => cvFin() ? ['U'] : ['U', 'L'];
  const cvKey = side => cvFin() ? 'cv' : side === 'L' ? 'cvL' : 'cvU';
  const cvAl = w => clamp(+w.fTen || 0.55, 0.2, 1.5);
  // Bildschirm <-> Ansicht (Welt) der aktiven Darstellung
  const cvView = () => { const k = cvW.tgt + cvW.mode; return cvW.views[k] || (cvW.views[k] = { auto: true }); };
  const cvS2W = (mx, my) => { const v = cvView(); return [(mx - v.ox) / v.s, (v.oy - my) / v.s]; };
  function cvWinBuild() {
    const win = document.createElement('div'); cvW.win = win; win.id = 'rproCoveWin';
    win.style.cssText = 'position:fixed;left:16vw;top:12vh;width:66vw;height:68vh;min-width:520px;min-height:320px;z-index:60;display:none;flex-direction:column;'
      + 'background:var(--panel,#161a20);border:1px solid var(--border,#2a3038);border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.5);resize:both;overflow:hidden';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--border,#2a3038);cursor:move;user-select:none';
    const ttl = document.createElement('b'); ttl.style.flex = '1'; ttl.textContent = T('Hohlkehle — Vorderansicht (Spantschnitt)');
    const close = document.createElement('button'); close.textContent = '✕'; close.title = T('Schließen'); close.style.padding = '2px 8px'; close.onclick = () => { win.style.display = 'none'; };
    head.append(ttl, close);
    head.onmousedown = e => {
      if (e.target.closest('button')) return;
      e.preventDefault(); const r = win.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
      const mv = ev => { win.style.left = (r.left + ev.clientX - sx) + 'px'; win.style.top = Math.max(0, r.top + ev.clientY - sy) + 'px'; };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    };
    const body = document.createElement('div'); body.style.cssText = 'flex:1;display:flex;min-height:0';
    const side = document.createElement('div'); side.className = 'sidebar-inner'; cvW.side = side;
    side.style.cssText = 'width:290px;flex:none;overflow:auto;padding:8px 10px;border-right:1px solid var(--border,#2a3038);display:flex;flex-direction:column;gap:6px';
    const right = document.createElement('div'); right.style.cssText = 'flex:1;position:relative;min-width:0';
    const cv = document.createElement('canvas'); cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'; cvW.cv = cv; cvW.cx = cv.getContext('2d');
    right.appendChild(cv); body.append(side, right); win.append(head, body); document.body.appendChild(win);
    new ResizeObserver(() => cvWinDraw()).observe(right);
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const hit = (mx, my) => { let best = null, bd = 9; for (const h of cvW.hs) { const d = Math.hypot(h.sx - mx, h.sy - my) - (h.t === 'p' ? 1 : 0); if (d < bd) { bd = d; best = h; } } return best; };
    cv.addEventListener('wheel', e => {
      e.preventDefault(); const v = cvView(); if (!(v.s > 0)) return; const [mx, my] = pos(e), f = Math.exp(-e.deltaY * 0.0015);
      v.auto = false; const wx = (mx - v.ox) / v.s, wy = (v.oy - my) / v.s; v.s *= f; v.ox = mx - wx * v.s; v.oy = my + wy * v.s; cvWinDraw();
    }, { passive: false });
    cv.addEventListener('mousedown', e => {
      const [mx, my] = pos(e), h = hit(mx, my), v = cvView(); e.preventDefault(); cv.focus && cv.focus();
      if (!h) { cvW.drag = { pan: true, x: e.clientX, y: e.clientY, ox: v.ox, oy: v.oy }; v.auto = false; return; }
      const w = cvObj(), Lp = w[cvKey(h.side)], q = Lp && Lp[h.k]; if (!q) return;
      cvW.sel = { side: h.side, k: h.k }; cvW.drag = { h, mx0: mx, my0: my, sx0: h.sx, sy0: h.sy }; cvWinSide(); cvWinDraw();
    });
    window.addEventListener('mousemove', e => {
      if (!cvW.win || cvW.win.style.display === 'none') return;
      const [mx, my] = pos(e), d = cvW.drag;
      if (!d) { const h = hit(mx, my); const id = h ? h.side + h.k + h.t : null; if (id !== (cvW.hot && cvW.hot.id)) { cvW.hot = h ? Object.assign({ id }, h) : null; cv.style.cursor = h ? 'move' : ''; cvWinDraw(); } return; }
      if (d.pan) { const v = cvView(); v.ox = d.ox + e.clientX - d.x; v.oy = d.oy + e.clientY - d.y; cvWinDraw(); return; }
      // Feinziehen: Umschalt = 1/10 des Mauswegs, Strg = nur die größere Richtung
      let dx = mx - d.mx0, dy = my - d.my0; if (e.shiftKey) { dx *= 0.1; dy *= 0.1; } if (e.ctrlKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      cvMoveTo(d.h, d.sx0 + dx, d.sy0 + dy); d.moved = true; cvWinDraw();
    });
    window.addEventListener('mouseup', () => { const d = cvW.drag; cvW.drag = null; if (d && d.moved) cvWinCommit(); });
    // Pfeiltasten: gewählten Punkt um 1 px (Umschalt 10 px) in der Ansicht verschieben; neu gerechnet wird nach kurzer Pause
    window.addEventListener('keydown', e => {
      if (!cvW.win || cvW.win.style.display === 'none' || !cvW.sel) return;
      const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (!k) return;
      const t = document.activeElement; if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      const h = cvW.hs.find(q => q.side === cvW.sel.side && q.k === cvW.sel.k && q.t === 'p'); if (!h) return;
      e.preventDefault(); const st = e.shiftKey ? 10 : 1;
      cvMoveTo(h, h.sx + k[0] * st, h.sy + k[1] * st); cvWinDraw(); cvWinSyncInputs();
      clearTimeout(cvW.keyT); cvW.keyT = setTimeout(() => cvWinCommit(), 450);
    });
    // Doppelklick nahe einer Kurve: Punkt einfügen (ohne Punkte zuerst Standardform anlegen); sonst Ansicht einpassen
    cv.addEventListener('dblclick', e => {
      const [mx, my] = pos(e), w = cvObj(); let best = null, bd = 14;
      for (const sd of cvSides()) { const fr = cvW.fr && cvW.fr[sd]; if (!fr) continue; for (const q of fr.scr) { const dd = Math.hypot(q[0] - mx, q[1] - my); if (dd < bd) { bd = dd; best = sd; } } }
      if (!best) { cvView().auto = true; cvWinDraw(); return; }
      const key = cvKey(best); if (!(w[key] && w[key].length >= 2)) w[key] = coveEnds(cvAl(w), []);
      const xv = cvW.fr[best].s2n(mx, my); if (!xv || xv[0] <= 0.03 || xv[0] >= 0.97) return;
      const Lp = w[key]; let k = 1; while (k < Lp.length - 1 && Lp[k].x < xv[0]) k++;
      Lp.splice(k, 0, { x: r2(xv[0]), v: r2(xv[1]), c: 0 }); cvW.sel = { side: best, k }; cvWinCommit();
    });
    cv.addEventListener('contextmenu', e => {
      e.preventDefault(); const w = cvObj(), h = hit(...pos(e)); if (!h || h.t !== 'p') return;
      const Lp = w[cvKey(h.side)]; if (!Lp || h.k === 0 || h.k === Lp.length - 1) return;
      Lp.splice(h.k, 1); cvW.sel = null; cvWinCommit();
    });
  }
  // Punkt bzw. Griff h auf die Bildschirmlage (sx, sy) setzen (normiert über die Ansicht der Seite)
  function cvMoveTo(h, sx, sy) {
    const w = cvObj(), Lp = w[cvKey(h.side)], fr = cvW.fr && cvW.fr[h.side]; if (!Lp || !fr) return;
    const xv = fr.s2n(sx, sy), q = Lp[h.k], n = Lp.length; if (!q || !xv) return;
    if (h.t === 'p') {
      if (h.k === 0 || h.k === n - 1) return;   // Fuß und Rippe liegen fest
      q.x = r3(clamp(xv[0], Lp[h.k - 1].x + 0.01, Lp[h.k + 1].x - 0.01)); q.v = r3(clamp(xv[1], -0.2, 1.2));
      return;
    }
    // Griff: Vektor vom Punkt zur neuen Lage; Fuß nur waagrecht, Rippe nur längs Z (Länge frei)
    let hv = [xv[0] - q.x, xv[1] - q.v];
    if (h.k === 0) { hv = [Math.max(0.02, hv[0]), 0]; delete q.auto; }
    else if (h.k === n - 1) { hv = [0, Math.min(-0.02, hv[1])]; delete q.auto; }
    else if (h.t === 'o') hv[0] = Math.max(0.005, hv[0]); else hv[0] = Math.min(-0.005, hv[0]);
    if (!(q.c > 0) && h.k > 0 && h.k < n - 1) { q.c = 1; const T0 = autoTans(coveFix(Lp, cvAl(w), 'c2'), 'c2')[h.k]; q.i = T0.i.slice(); q.o = T0.o.slice(); }
    q[h.t] = [r3(hv[0]), r3(hv[1])];
    if (q.c === 1 && h.k > 0 && h.k < n - 1) {   // Tangente: Gegengriff in Gegenrichtung, Länge bleibt
      const ot = h.t === 'o' ? 'i' : 'o', L0 = Math.hypot(q[ot][0], q[ot][1]) || 0.1, L1 = Math.hypot(hv[0], hv[1]) || 1;
      q[ot] = [r3(-hv[0] / L1 * L0), r3(-hv[1] / L1 * L0)];
    }
  }
  const r3 = v => Math.round(v * 1000) / 1000;
  function cvWinCommit() { clearTimeout(cvW.keyT); hist.touched = true; build(); draw(); buildSidebar(); cvWinSide(); cvWinDraw(); }
  function cvWinSyncInputs() { if (!cvW.side) return; cvW.side.querySelectorAll('[data-cv]').forEach(el => { if (document.activeElement === el) return; const sel = cvW.sel, Lp = sel && cvObj()[cvKey(sel.side)], q = Lp && Lp[sel.k]; if (q) el.value = r3(q[el.dataset.cv]); }); }
  function cvWinSide() {
    const side = cvW.side; if (!side) return; side.innerHTML = '';
    const w = cvObj(), al = cvAl(w), bs = w.cvSpl === 'bs', fin = cvFin();
    if (fin ? !(w.on && w.fil) : !(w.on && w.mode === 'fil')) { hint(side, fin ? 'Seitenleitwerk mit dem Anschluss „Anformung tangential“ einschalten.' : 'Tragflächenübergang mit der Art „Anformung“ einschalten.'); return; }
    if (fin) hint(side, 'Hohlkehle zwischen Rumpfrücken und Seitenleitwerk (blau) mit Krümmungskamm, bearbeitet wie die Rumpfumrisse — eine Form für beide Seiten. Punkte ziehen, Doppelklick auf die Kurve = Punkt einfügen, Rechtsklick = löschen. Umschalt beim Ziehen = fein (1/10), Strg = nur waagrecht/senkrecht, Pfeiltasten verschieben den gewählten Punkt (Umschalt = 10 ×). Rad = Zoom, Ziehen ins Leere = verschieben, Doppelklick ins Leere = einpassen. Die Form gilt rundum.');
    else hint(side, 'Hohlkehle oben und unten (blau) mit Krümmungskamm, bearbeitet wie die Rumpfumrisse. Punkte ziehen, Doppelklick auf eine Kurve = Punkt einfügen, Rechtsklick = löschen. Umschalt beim Ziehen = fein (1/10), Strg = nur waagrecht/senkrecht, Pfeiltasten verschieben den gewählten Punkt (Umschalt = 10 ×). Rad = Zoom, Ziehen ins Leere = verschieben, Doppelklick ins Leere = einpassen. Die Formen gelten rundum (vor der Nase gemischt).');
    selectRow(side, 'Ansicht', [['sec', fin ? 'Spantschnitt (mm)' : 'Spantschnitt (mm, beide Seiten)'], ['norm', fin ? 'normiert groß' : 'normiert groß (eine Seite)']], () => cvW.mode, v => { cvW.mode = v; cvWinSide(); cvWinDraw(); });
    if (cvW.mode === 'norm' && !fin) selectRow(side, 'Seite', [['U', 'Hohlkehle oben'], ['L', 'Hohlkehle unten']], () => cvW.nside, v => { cvW.nside = v; cvW.sel = null; cvWinSide(); cvWinDraw(); });
    selectRow(side, 'Spline-Art', [['bs', 'B-Spline (Kontrollpunkte, am ruhigsten)'], ['c2', 'krümmungsstetig (durch die Punkte)']], () => (bs ? 'bs' : 'c2'), v => { w.cvSpl = v; cvW.sel = null; cvWinCommit(); },
      'B-Spline: die Punkte ziehen die Kurve nur an (Kontrollpolygon gestrichelt) — verschieben verformt sie sanft und örtlich, nie mehr Wendepunkte als das Polygon. Krümmungsstetig: die Kurve läuft genau durch die Punkte.');
    for (const sd of cvSides()) {
      if (cvW.mode === 'norm' && sd !== cvW.nside) continue;
      const key = cvKey(sd), has = Array.isArray(w[key]) && w[key].length >= 2;
      subhead(side, fin ? 'Hohlkehle' : sd === 'U' ? 'Hohlkehle oben' : 'Hohlkehle unten');
      hint(side, has ? (w[key].length - 2) + ' ' + T('Punkte') + ' + ' + T('Fuß und Rippe') : T('Standardform (Viertelellipse)'));
      const mb = miniBar(side);
      mb.appendChild(mkMini(T('Punkte anlegen'), () => {
        const C0 = filBezCtl([0, 0], [1, 0], [1, 1], [0, 1], al);
        // B-Spline: Kontrollpunkte am Bezier-Kontrollpolygon (Kurve liegt dann nahe an der Viertelellipse), sonst auf der Kurve
        // (konvexes Polygon längs des Bezier-Kontrollpolygons [0,0]-[al,0]-[1,1-al]-[1,1] -> keine Wendepunkte)
        const mids = bs ? [[0.75 * al, 0.04 * al], [(al + 1) / 2, (1 - al) / 2], [1 - 0.04 * al, 1 - 0.75 * al]].map(q => ({ x: q[0], v: q[1] })) : [0.3, 0.6].map(t => { const q = filBezAt(C0, t); return { x: q[0], v: q[1] }; });
        w[key] = coveEnds(al, mids); cvW.sel = null; cvWinCommit();
      })).title = T('Legt Punkte auf die Standardform — dann ziehen.');
      mb.appendChild(mkMini(T('Standardform'), () => { w[key] = []; cvW.sel = null; cvWinCommit(); })).title = T('Löscht die Punkte: Viertelellipse mit der Völligkeit.');
      const other = cvKey(sd === 'U' ? 'L' : 'U');
      if (!fin) mb.appendChild(mkMini(T(sd === 'U' ? 'wie unten' : 'wie oben'), () => { w[key] = JSON.parse(JSON.stringify(w[other] || [])); cvW.sel = null; cvWinCommit(); })).title = T('Übernimmt die Form der anderen Seite.');
    }
    const sel = cvW.sel, Lp = sel && w[cvKey(sel.side)], q = Lp && Lp[sel.k];
    if (q) {
      subhead(side, T(fin ? 'Hohlkehle' : sel.side === 'U' ? 'Hohlkehle oben' : 'Hohlkehle unten') + ' — ' + T('Punkt') + ' ' + (sel.k + 1));
      const end = sel.k === 0 || sel.k === Lp.length - 1;
      if (!end) {
        const types = bs ? [['0', 'glatt (krümmungsstetig)'], ['2', 'Ecke (Griffe getrennt)']] : [['0', 'glatt (krümmungsstetig)'], ['1', 'Tangente (Griffe)'], ['2', 'Ecke (Griffe getrennt)']];
        selectRow(side, 'Punktart', types, () => String(bs && q.c === 1 ? 0 : (q.c || 0)), v => {
          const c = +v; if (c > 0 && !(q.c > 0)) { const T0 = autoTans(coveFix(Lp, al, 'c2'), 'c2')[sel.k]; q.i = T0.i.slice(); q.o = T0.o.slice(); }
          q.c = c; if (!c) { delete q.i; delete q.o; } cvWinCommit();
        });
        numRow(side, fin ? 'quer (0 = Fuß … 1 = Leitwerk)' : 'quer (0 = Fuß … 1 = Rippe)', () => r3(q.x), v => { q.x = r3(clamp(v, Lp[sel.k - 1].x + 0.01, Lp[sel.k + 1].x - 0.01)); cvWinCommit(); }, { step: 0.005, norender: true }).dataset.cv = 'x';
        numRow(side, fin ? 'Höhe (0 = Rumpf … 1 = Schnittlinie)' : 'Spannweite (0 = Rumpf … 1 = Rippe)', () => r3(q.v), v => { q.v = r3(clamp(v, -0.2, 1.2)); cvWinCommit(); }, { step: 0.005, norender: true }).dataset.cv = 'v';
        miniBar(side).appendChild(mkMini(T('Punkt löschen'), () => { Lp.splice(sel.k, 1); cvW.sel = null; cvWinCommit(); }));
      } else numRow(side, sel.k === 0 ? 'Griff am Fuß (Länge)' : fin ? 'Griff am Leitwerk (Länge)' : 'Griff an der Rippe (Länge)', () => { const qf = coveFix(Lp, al, 'c2')[sel.k]; return r2(sel.k === 0 ? qf.o[0] : -qf.i[1]); }, v => { const L = clamp(v, 0.02, 1.5); delete q.auto; if (sel.k === 0) q.o = [r2(L), 0]; else q.i = [0, r2(-L)]; cvWinCommit(); }, { step: 0.05, norender: true });
    }
    subhead(side, 'Anzeige');
    boolRow(side, 'Krümmungskamm und Wendepunkte zeigen', () => !!C('rproComb'), v => { S('rproComb', v); cvWinDraw(); draw(); });
    numRow(side, 'Völligkeit des Übergangs', () => w.fTen, v => { w.fTen = clamp(v, 0.2, 1.5); cvWinCommit(); }, { step: 0.05, min: 0.2, max: 1.5, norender: true, hint: 'Gilt für die Standardform (Viertelellipse) und die Griffe neu angelegter Punkte.' });
    miniBar(side).appendChild(mkMini(T('Einpassen'), () => { cvView().auto = true; cvWinDraw(); }));
  }
  function cvWinDraw() {
    const cv = cvW.cv; if (!cv || !cvW.win || cvW.win.style.display === 'none') return;
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, Wd = Math.max(1, r.width), Hd = Math.max(1, r.height);
    if (cv.width !== Math.round(Wd * dpr) || cv.height !== Math.round(Hd * dpr)) { cv.width = Math.round(Wd * dpr); cv.height = Math.round(Hd * dpr); }
    const c = cvW.cx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.fillStyle = '#0f1318'; c.fillRect(0, 0, Wd, Hd); cvW.hs = []; cvW.fr = null;
    const fin = cvFin(), w = cvObj(), al = cvAl(w), mode = w.cvSpl === 'bs' ? 'bs' : 'c2', norm = cvW.mode === 'norm';
    const noFil = () => { c.fillStyle = '#9aa'; c.font = '13px system-ui'; c.fillText(T('Keine Anformung eingeschaltet.'), 20, 30); };
    // Je Ziel: Spantschnitt x, Rumpfhälfte P, Seiten [Kennung, Fuß, Richtung zum Anbau, Ziel] in den Koordinaten von cvCtl
    // (Tragfläche [Y, Z], Seitenleitwerk getauscht [Z, Y]), Ansichtsrahmen (Welt der Anzeige: waagrecht Z, senkrecht Y)
    let x, P, sides, box, shp, info0, rib;
    if (fin) {
      const g = model && model.fin, Fi = g && g.ff; if (!Fi) { noFil(); return; }
      x = Fi.ch[0] + 0.3 * (Fi.ch[1] - Fi.ch[0]); P = bodyHalfFine(model, clamp(x, model.x0, model.x1));
      let zm = 0; for (const q of P) zm = Math.max(zm, q[1]);
      const Z = finCross(Fi.F2, x, 0), zF = Math.min(Z.length ? Z[Z.length - 1] : 0, 0.92 * zm), cB = zF > 0.01 ? crossZTop(P, zF) : null; if (!cB) return;
      const a = P[cB.k], b = P[cB.k + 1], dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, yAx = Fi.yAt(x), t = Math.max(0, finT(g, x, yAx));
      sides = [['U', [cB.z, cB.y], [-(b[1] - a[1]) / dl, -(b[0] - a[0]) / dl], [t, yAx]]];
      const h = Math.max(1, yAx - cB.y);
      box = [-0.15 * cB.z, 1.3 * cB.z, cB.y - 0.25 * h, yAx + 0.35 * h];
      shp = { U: coveShape(w.cv, al, mode) };
      rib = { t, yAx }; info0 = 'X ' + r1(x) + ' mm · ' + T('Schnittlinie Y') + ' ' + r1(yAx) + ' mm';
    } else {
      const g = model && (cvW.tgt === 'vt' ? model.vt && model.vt.gw : model.wing);
      if (!g || g.mode !== 'fil' || !g.fl || !g.fp2) { noFil(); return; }
      x = g.xLE + 0.3 * g.chord; P = g.bodyAtFine ? g.bodyAtFine(clamp(x, model.x0, model.x1)) : bodyHalfFine(model, clamp(x, model.x0, model.x1)); const top = P[0][0], bot = P[P.length - 1][0];
      const X = finCross(g.fp2, x, 0); if (X.length < 2) return;
      const snap = y => crossY(P, clamp(y, bot + 1e-6, top - 1e-6)), cu = snap(X[X.length - 1]), cl = snap(X[0]); if (!cu || !cl) return;
      const dir = cc => { const a = P[cc.k], b = P[cc.k + 1], dy = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dy, dz) || 1; return [dy / l, dz / l]; };
      const yw = wingYs(g, x);
      sides = [['U', [cu.y, cu.z], dir(cu), [yw.yu, g.zA]], ['L', [cl.y, cl.z], [-dir(cl)[0], -dir(cl)[1]], [yw.yl, g.zA]]];
      box = [Math.min(cu.z, cl.z) - 0.2 * (g.zA - cu.z), g.zA + 0.3 * (g.zA - cu.z), cl.y - 0.12 * (cu.y - cl.y), cu.y + 0.12 * (cu.y - cl.y)];
      // Formen aus den aktuellen (evtl. gerade gezogenen) Punkten — wie filWing; die nicht gezeichnete Seite als Viertelellipse
      shp = { U: coveShape(w.cvU, al, mode), L: coveShape(w.cvL, al, mode) };
      rib = { yw, zA: g.zA }; info0 = 'X ' + r1(x) + ' mm · ' + T('Wurzelrippe Z') + ' ' + r1(g.zA) + ' mm';
    }
    sides = sides.filter(q => !norm || q[0] === cvW.nside);
    const anyC = fin || !!(shp.U || shp.L), gg = { cvU: shp.U || coveDefault(al), cvL: shp.L || shp.U || coveDefault(al) };
    // Welt -> normiert je Seite: Schnitt = schräge Abbildung wie cvCtl (Welt: waagrecht Z, senkrecht Y), normiert = identisch.
    // Tragfläche: cvCtl rechnet in [Y, Z] -> Anzeige getauscht; Seitenleitwerk: cvCtl rechnet schon in [Z, Y].
    const frames = {}, toW = fin ? (p, q) => [p, q] : (p, q) => [q, p];
    for (const [sd, F, D, R] of sides) {
      const C0 = cvCtl(gg, F, D, R, [0, 1], al);
      frames[sd] = norm ? { n2w: (a, b) => [a, b], w2n: (u, v) => [u, v], C0 }
        : { n2w: (a, b) => toW(C0.F[0] + C0.dy * a, C0.F[1] + C0.sdy * a + C0.beta * b),
          w2n: (u, v) => { const [p, q] = toW(u, v), a = (p - C0.F[0]) / C0.dy; return [a, (q - C0.F[1] - C0.sdy * a) / Math.max(1e-6, C0.beta)]; }, C0 };
      // angezeigte Kurve: ohne eigene Form die Bezier wie im Modell, sonst die Form
      const curve = [];
      if (norm) { const sh = shp[sd] || coveDefault(al); for (let i = 0; i <= 200; i++) curve.push(sh.at(i / 200)); }
      else { const Cm = anyC ? C0 : filBezCtl(F, D, R, [0, 1], al); for (let i = 0; i <= 200; i++) { const q = cvAt(Cm, i / 200); curve.push(toW(q[0], q[1])); } }
      frames[sd].curve = curve;
    }
    // Ansicht einpassen
    const v = cvView();
    if (v.auto || !(v.s > 0)) {
      const [u0, u1, w0, w1] = norm ? [-0.08, 1.15, -0.08, 1.12] : box;
      const s = Math.min((Wd - 40) / Math.max(1e-6, u1 - u0), (Hd - 50) / Math.max(1e-6, w1 - w0));
      Object.assign(v, { s, ox: Wd / 2 - s * (u0 + u1) / 2, oy: Hd / 2 + s * (w0 + w1) / 2 });
    }
    const W2S = (u, vv) => [v.ox + u * v.s, v.oy - vv * v.s];
    const line = (pts, col, wd, dash) => { c.beginPath(); pts.forEach((q, i) => { const [a, b] = W2S(q[0], q[1]); i ? c.lineTo(a, b) : c.moveTo(a, b); }); c.strokeStyle = col; c.lineWidth = wd; c.setLineDash(dash || []); c.stroke(); c.setLineDash([]); };
    if (norm) {
      // Raster 0,1 und Einheitsquadrat (Fuß unten links, Rippe oben rechts)
      c.strokeStyle = 'rgba(255,255,255,.06)'; c.lineWidth = 1; c.beginPath();
      for (let k = 0; k <= 10; k++) { const [a1, b1] = W2S(k / 10, 0), [a2, b2] = W2S(k / 10, 1); c.moveTo(a1, b1); c.lineTo(a2, b2); const [a3, b3] = W2S(0, k / 10), [a4, b4] = W2S(1, k / 10); c.moveTo(a3, b3); c.lineTo(a4, b4); } c.stroke();
      line([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], 'rgba(255,255,255,.25)', 1, [4, 4]);
      c.font = '12px system-ui'; c.fillStyle = '#9fb0c0'; { const [a, b] = W2S(0, 0); c.fillText(T('Fuß (Rumpf)'), a + 6, b + 16); } { const [a, b] = W2S(1, 1); c.textAlign = 'right'; c.fillText(T(fin ? 'Leitwerk' : 'Wurzelrippe'), a - 6, b - 8); c.textAlign = 'left'; }
    } else if (fin) {
      line(P.map(q => [q[1], q[0]]), 'rgba(160,190,220,.6)', 1.2, [5, 4]);
      // Leitwerk oberhalb der Schnittlinie (Symmetrieebene links), Schnittlinie
      c.fillStyle = 'rgba(200,150,255,.18)'; { const [a1, b1] = W2S(-rib.t, rib.yAx), a2 = W2S(rib.t, rib.yAx)[0]; c.fillRect(a1, 0, a2 - a1, b1); }
      line([[-rib.t, rib.yAx], [rib.t, rib.yAx]], '#c792ff', 2);
      line([[0, box[2]], [0, box[3]]], 'rgba(255,255,255,.15)', 1, [2, 4]);
    } else {
      line(P.map(q => [q[1], q[0]]), 'rgba(160,190,220,.6)', 1.2, [5, 4]);
      c.fillStyle = 'rgba(95,200,120,.18)'; { const [a1, b1] = W2S(rib.zA, rib.yw.yu), b2 = W2S(rib.zA, rib.yw.yl)[1]; c.fillRect(a1, b1, Wd - a1, b2 - b1); }
      line([[rib.zA, rib.yw.yu], [rib.zA, rib.yw.yl]], '#5fc878', 2);
    }
    cvW.fr = {}; const combs = [];
    for (const [sd] of sides) {
      const fm = frames[sd], scr = fm.curve.map(q => W2S(q[0], q[1]));
      cvW.fr[sd] = { scr, s2n: (sx, sy) => { const wv = cvS2W(sx, sy); return fm.w2n(wv[0], wv[1]); } };
      line(fm.curve, '#4fb3ff', 2.2);
      // Krümmung der angezeigten Kurve (diskret, Kreis durch drei Punkte), in Weltkoordinaten
      const K = [], pts = fm.curve;
      for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1], b = pts[i], d2 = pts[i + 1], ux = b[0] - a[0], uz = b[1] - a[1], vx = d2[0] - b[0], vz = d2[1] - b[1];
        const la = Math.hypot(ux, uz), lb = Math.hypot(vx, vz), lc = Math.hypot(d2[0] - a[0], d2[1] - a[1]); if (la < 1e-12 || lb < 1e-12 || lc < 1e-12) continue;
        K.push({ x: b[0], v: b[1], k: 2 * (ux * vz - uz * vx) / (la * lb * lc), n: [-(d2[1] - a[1]) / lc, (d2[0] - a[0]) / lc] });
      }
      combs.push([sd, K]);
      const Lp = w[cvKey(sd)];
      if (Array.isArray(Lp) && Lp.length >= 2) {
        const Lf = coveFix(Lp, al, mode), N2W = (a, b) => fm.n2w(a, b);
        if (mode === 'bs') line(Lf.map(q => N2W(q.x, q.v)), 'rgba(79,179,255,.4)', 1, [3, 3]);   // Kontrollpolygon inkl. Hilfspunkte
        const Tn = mode === 'bs' ? null : autoTans(Lf, 'c2');
        const ph = mode === 'bs' ? { o: Lf[1], i: Lf[Lf.length - 2] } : null;
        Lp.forEach((q, k) => {
          const [sx, sy] = W2S(...N2W(q.x, q.v)), selp = cvW.sel && cvW.sel.side === sd && cvW.sel.k === k, end = k === 0 || k === Lp.length - 1;
          // Griffe: c2 an Tangenten-/Eckpunkten und den Enden; B-Spline nur an den Enden (Hilfspunkte)
          const hl = [];
          if (mode === 'bs') { if (k === 0) hl.push(['o', [ph.o.x, ph.o.v]]); if (k === Lp.length - 1) hl.push(['i', [ph.i.x, ph.i.v]]); }
          else if (q.c > 0 || end) for (const t of ['i', 'o']) { const hv = Lf[k][t] || Tn[k][t]; if (hv && (Math.abs(hv[0]) > 1e-9 || Math.abs(hv[1]) > 1e-9)) hl.push([t, [q.x + hv[0], q.v + hv[1]]]); }
          for (const [t, hp] of hl) {
            const [hx2, hy2] = W2S(...N2W(hp[0], hp[1])), hot = cvW.hot && cvW.hot.side === sd && cvW.hot.k === k && cvW.hot.t === t;
            c.strokeStyle = 'rgba(255,210,74,.6)'; c.lineWidth = 1; c.beginPath(); c.moveTo(sx, sy); c.lineTo(hx2, hy2); c.stroke();
            c.fillStyle = hot ? '#fff' : '#ffd24a'; c.fillRect(hx2 - 3.5, hy2 - 3.5, 7, 7); cvW.hs.push({ side: sd, k, t, sx: hx2, sy: hy2 });
          }
          const hot = cvW.hot && cvW.hot.side === sd && cvW.hot.k === k && cvW.hot.t === 'p';
          c.fillStyle = selp ? '#ffd24a' : hot ? '#cfe8ff' : end ? '#7f8c99' : '#4fb3ff';
          c.beginPath(); if (q.c === 2) c.rect(sx - 5, sy - 5, 10, 10); else if ((q.c === 1 && mode !== 'bs') || end) { c.moveTo(sx, sy - 6); c.lineTo(sx + 6, sy); c.lineTo(sx, sy + 6); c.lineTo(sx - 6, sy); c.closePath(); } else c.arc(sx, sy, 5, 0, 2 * Math.PI);
          c.fill(); cvW.hs.push({ side: sd, k, t: 'p', sx, sy });
        });
      }
    }
    // Krümmungskamm (gemeinsamer Maßstab), Wendepunkte als Ringe
    if (C('rproComb')) {
      const kRef = kRob(...combs.map(q => q[1])), lenPx = Math.max(5, +C('rproCombLen') || 40);
      if (kRef > 1e-12) for (const [, K] of combs) {
        const env = []; c.strokeStyle = 'rgba(255,150,210,.35)'; c.lineWidth = 1; c.beginPath();
        K.forEach((q, i) => {
          const t = Math.abs(q.k) / kRef, kk = Math.sign(q.k) * (t <= 1 ? t : Math.min(1.8, 1 + 0.5 * Math.log(t))) * lenPx / v.s;
          const a = W2S(q.x, q.v), b = W2S(q.x - q.n[0] * kk, q.v - q.n[1] * kk); if (i % 2 === 0) { c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); } env.push(b);
        });
        c.stroke(); c.strokeStyle = 'rgba(255,120,200,.9)'; c.lineWidth = 1.2; c.beginPath(); env.forEach((b, i) => i ? c.lineTo(b[0], b[1]) : c.moveTo(b[0], b[1])); c.stroke();
        c.strokeStyle = '#ffe14d'; c.lineWidth = 2; for (const q of curvStats(K).infl) { const a = W2S(q.x, q.v); c.beginPath(); c.arc(a[0], a[1], 6, 0, Math.PI * 2); c.stroke(); }
      }
    }
    c.font = '12px system-ui'; c.fillStyle = '#9fb0c0'; c.textAlign = 'left';
    const info = combs.map(([sd, K]) => { const st = curvStats(K); return (fin ? '' : T(sd === 'L' ? 'unten' : 'oben') + ': ') + st.infl.length + ' ' + T('Wendepunkte') + (norm ? '' : ', R min ' + (isFinite(st.rmin) ? st.rmin.toFixed(1) + ' mm' : '∞')); }).join(' · ');
    c.fillText((norm ? T('normiert') : info0) + ' · ' + info, 10, Hd - 10);
  }
  // Sidebar-Gruppen für die Anbauten.
  function attachSidebar(side, rr, rb) {
    const w = WG(), f = FN();
    const gw = grp('Tragflächenübergang', !!w.on, 'rpro', { key: 'Rumpf: Tragflächenübergang' });
    hint(gw.body, 'Tragflächenstummel: das Wurzelprofil (aus dem Tragflächendesign oder .dat) wird gerade bis zur Wurzelrippen-Ebene Z aus dem Rumpf herausgezogen und mit dem Rumpf vereinigt (boolesche Operation) — ohne Übergänge, die Verschneidung mit dem Rumpf bleibt eine scharfe Kante. Alternativ wird der Rumpf in Profilform ausgeschnitten (Tragflächenausschnitt). Grün in Seiten-/Draufsicht.');
    boolRow(gw.body, 'Tragflächenübergang einrechnen', () => !!w.on, v => { w.on = v; rb(); });
    // Lage der Wurzelrippe: Abstand ab Rumpfmitte oder ab Rumpfseitenwand (Umrechnung beim Umschalten, Lage bleibt).
    const rootZRows = auto => {
      const wall = model && model.wing && model.wing.wall != null ? model.wing.wall : null;
      selectRow(gw.body, 'Wurzelrippe: Abstand messen ab', [['center', 'Rumpfmitte'], ['wall', 'Rumpfseitenwand']], () => (w.zRef === 'wall' ? 'wall' : 'center'), v => {
        if (v !== (w.zRef === 'wall' ? 'wall' : 'center') && +w.z > 0 && wall != null) w.z = r1(Math.max(0.1, v === 'wall' ? +w.z - wall : +w.z + wall));
        w.zRef = v; rb();
      }, 'Rumpfseitenwand = größte halbe Rumpfbreite in Höhe der Profilmitte über die Wurzeltiefe (an der Tragflächenwurzel).');
      const wallMode = w.zRef === 'wall';
      numRow(gw.body, wallMode ? 'Abstand Wurzelrippe – Rumpfseitenwand (mm, 0 = automatisch)' : 'Wurzelrippen-Ebene Z (mm, 0 = automatisch)', () => w.z, v => { w.z = Math.max(0, v); rr(); },
        { step: 1, min: 0, norender: true, hint: T(wallMode ? 'Abstand der Wurzelrippe (Stoßfläche zur Tragfläche) von der Rumpfseitenwand.' : 'Abstand der Wurzelrippe (Stoßfläche zur Tragfläche) von der Rumpfmitte.') + ' ' + T(auto) });
    };
    if (w.on) {
      profRow(gw.body, 'Wurzelprofil', () => w.src, null, () => w.prof, v => { w.src = v; }, null, p => { w.prof = p; }, rb, true);
      numRow(gw.body, 'Nasenleiste X (mm)', () => w.xLE, v => { w.xLE = v; rr(); }, { step: 5, norender: true });
      numRow(gw.body, 'Nasenleiste Y (mm)', () => w.yLE, v => { w.yLE = v; rr(); }, { step: 1, norender: true });
      numRow(gw.body, 'Wurzeltiefe (mm, 0 = aus Tragflächendesign)', () => w.chord, v => { w.chord = Math.max(0, v); rr(); }, { step: 5, min: 0, norender: true });
      numRow(gw.body, 'Einstellwinkel (°)', () => w.alpha, v => { w.alpha = v; rr(); }, { step: 0.5, norender: true });
      const md = w.mode === 'cut' ? 'cut' : w.mode === 'fil' ? 'fil' : 'stub';
      selectRow(gw.body, 'Art', [['stub', 'Tragflächenstummel (scharfe Kante, ohne Übergang)'], ['fil', 'Anformung tangential'], ['cut', 'Tragflächenausschnitt (Rumpf ausgeschnitten)']], () => md, v => { w.mode = v; rb(); });
      if (md === 'fil') {
        hint(gw.body, 'Tangentiale Anformung: das Wurzelprofil wird zur Projektion erweitert (vorn/hinten/oben/unten verlängert, Endleiste aufgedickt und gerundet) und waagrecht auf den Rumpf projiziert. Von dort läuft die Übergangsfläche tangential aus der Rumpfhaut heraus und tangential in die Tragfläche an der Wurzelrippe; vor der Nase und hinter der Endleiste rund. Projektion gestrichelt in Seiten-/Draufsicht.');
        const pbar = miniBar(gw.body);
        pbar.appendChild(mkMini(T('Projektion bearbeiten…'), () => projWinOpen('wing'))).title = T('Eigenes Fenster: Wurzelprofil und Projektion, Verlängerung vorn/hinten/oben/unten, Endleistendicke und -radius — mit Griffen zum Ziehen.');
        pbar.appendChild(mkMini(T('Hohlkehle zeichnen…'), () => cvWinOpen())).title = T('Eigenes Fenster: Form der Hohlkehle in der Vorderansicht (Spantschnitt) mit Stützpunkten zeichnen — gilt rundum.');
        hint(gw.body, T('Projektion') + ': ' + T('Offset') + ' ' + r1(+w.pD) + ' mm · ' + T('Zuschlag') + ' ' + T('vorn') + ' ' + r1(+w.pF) + ' · ' + T('hinten') + ' ' + r1(+w.pB) + ' · ' + T('oben') + ' ' + r1(+w.pU) + ' · ' + T('unten') + ' ' + r1(+w.pL) + ' mm' + (+w.pTe > 0 ? ' · ' + T('EL-Dicke') + ' ' + r1(+w.pTe) : '') + (+w.pTeR > 0 ? ' · ' + T('EL-Radius') + ' ' + r1(+w.pTeR) : ''));
        numRow(gw.body, 'Endleistendicke der Wurzelrippe (mm)', () => w.te, v => { w.te = Math.max(0, v); rr(); }, { step: 0.1, min: 0, norender: true, hint: 'Ober- und Unterseite werden um die Nase gedreht, bis die Endleiste so weit aufklafft — die Anformung läuft dann hinten nicht messerdünn aus. Für den Schaumkern dieselbe Endleistendicke wählen.' });
        numRow(gw.body, 'Völligkeit des Übergangs', () => w.fTen, v => { w.fTen = clamp(v, 0.2, 1.5); rr(); }, { step: 0.05, min: 0.2, max: 1.5, norender: true, hint: '0,55 = Viertelellipse. Kleiner = schlanker, enger in der Kehle; größer = voller.' });
        subhead(gw.body, 'Leitlinien (Draufsicht)');
        hint(gw.body, 'Die Form der Anformung vor der Nase und hinter der Endleiste bestimmen zwei Leitlinien (Splines, grün in der Draufsicht): von der Projektion am Rumpf zur Nasenleiste der Wurzelrippe bzw. von der Endleiste der Wurzelrippe zum Ende der Projektion. Die Stützpunkte in der Draufsicht ziehen. Die Leitlinie der Nase gibt allen Übergangskurven im vorderen Bereich ihre Form — jeder waagrechte Schnitt läuft als glatter Offset um die Profilnase. Die Leitlinie an der Endleiste läuft tangential aus der Endleiste (in Spannweitenrichtung) und tangential in den Rumpf; dahinter läuft die Endleiste in ihrer Dicke unverändert bis zum Rumpf durch.');
        const gb = miniBar(gw.body), addPt = (L, other) => { const a = L.length ? L[L.length - 1] : { u: 0, v: other }; L.push({ u: r2((a.u + 1) / 2), v: r2(a.v * 0.6 + other * 0.4) }); L.sort((p, q) => p.u - q.u); rb(); };
        gb.appendChild(mkMini(T('Nase: + Punkt'), () => addPt(w.gLE, 1)));
        gb.appendChild(mkMini(T('Nase: − Punkt'), () => { if (w.gLE.length) { w.gLE.pop(); rb(); } }));
        gb.appendChild(mkMini(T('Endleiste: + Punkt'), () => addPt(w.gTE, 0)));
        gb.appendChild(mkMini(T('Endleiste: − Punkt'), () => { if (w.gTE.length) { w.gTE.pop(); rb(); } }));
        gb.appendChild(mkMini(T('Leitlinien zurücksetzen'), () => { w.gLE = []; w.gTE = [{ u: 0.35, v: 0.45 }]; rb(); }));
        numRow(gw.body, 'Gerades Stück vor der Wurzelrippe (mm)', () => w.fStr, v => { w.fStr = Math.max(0, v); rr(); }, { step: 1, min: 0, norender: true, hint: 'Nach dem Übergang läuft das Profil so weit gerade bis zur Wurzelrippe (Stoßfläche zur Tragfläche). 0 = Übergang endet direkt an der Rippe.' });
        rootZRows('Automatisch: breiteste Stelle der Projektion + 1,5 × Verlängerung oben/unten (mind. 10 mm) + gerades Stück.');
        if (model && model.wing && model.wing.warns) for (const t of model.wing.warns) hint(gw.body, t);
      } else
      if (md === 'cut') {
        hint(gw.body, 'Statt eines Stummels wird der Rumpf in Form des Wurzelprofils ausgeschnitten — als Flächenauflage (Sattel, nach oben oder unten offen) oder als Durchbruch bzw. Tasche in Profilform. Lage, Tiefe und Einstellwinkel wie oben.');
        selectRow(gw.body, 'Ausschnitt', [['up', 'nach oben offen (Flächenauflage von oben)'], ['down', 'nach unten offen (Flächenauflage von unten)'], ['none', 'nur Profil (Durchbruch / Tasche)']], () => (w.cutOpen === 'down' || w.cutOpen === 'none' ? w.cutOpen : 'up'), v => { w.cutOpen = v; rr(); });
        numRow(gw.body, 'Spiel um das Profil (mm)', () => w.cutPlay, v => { w.cutPlay = Math.max(0, v); rr(); }, { step: 0.1, min: 0, norender: true });
        numRow(gw.body, 'Kern stehen lassen: halbe Breite Z (mm, 0 = durchgehend)', () => w.cutZ, v => { w.cutZ = Math.max(0, v); rr(); }, { step: 1, min: 0, norender: true, hint: 'Größer 0: der Ausschnitt reicht von außen nur bis zu diesem Abstand von der Rumpfmitte — es entsteht je Seite eine Tasche in Profilform (z. B. für Steckflächen). 0 = Ausschnitt quer durch den ganzen Rumpf.' });
        rootZRows('Nur für die Darstellung der Tragfläche.');
      } else rootZRows('Gilt für die Stummel-Stirnfläche. Automatisch: größte halbe Rumpfbreite im Flächenbereich + 15 mm.');
      if (model && model.wing) hint(gw.body, T('Wurzelrippe bei Z =') + ' ' + model.wing.zf.toFixed(1) + ' mm · ' + T('Rumpfseitenwand') + ' ' + model.wing.wall.toFixed(1) + ' mm · ' + T('Abstand') + ' ' + (model.wing.zf - model.wing.wall).toFixed(1) + ' mm · ' + T('Wurzeltiefe') + ' ' + model.wing.chord.toFixed(0) + ' mm' + (model.wing.name ? ' · ' + model.wing.name : ''));
      else if (w.src === 'dat' && !(w.prof && w.prof.pts)) hint(gw.body, 'Kein Profil geladen — der Übergang wird nicht eingerechnet.');
    }
    side.appendChild(gw.g);

    const gf = grp('Seitenleitwerk', !!f.on, 'rpro', { key: 'Rumpf: Seitenleitwerk' });
    hint(gf.body, 'Seitenansicht: Nasenleiste und Endleiste sind Geraden mit einstellbarem Winkel, der Abschluss oben eine Gerade mit Winkel. Die Nasenleiste läuft unten mit einem Übergangsradius tangential in die Rumpfoberkante ein. Loft von Wurzel- zu Spitzenprofil (Dicke in Z), elliptischer Randbogen oben, Hohlkehle zum Rumpf. Unter dem Fuß läuft das Profil mit konstanter Dicke bis zur Rumpfunterkante (Leitwerksträger). Reicht das Leitwerk über das Rumpfende hinaus, wird der Rumpf entsprechend verlängert.');
    boolRow(gf.body, 'Seitenleitwerk einrechnen', () => !!f.on, v => { f.on = v; rb(); });
    if (f.on) {
      const plain = f.mode === 'plain', free = f.mode === 'free';
      selectRow(gf.body, 'Art', [['std', 'mit Übergängen (Radius, Hohlkehle, Randbogen)'], ['plain', 'einfache Fläche (scharfe Kante, ohne Übergänge)'], ['free', 'freier Umriss (Geraden und Splines)']], () => (free ? 'free' : plain ? 'plain' : 'std'), v => {
        if (v === 'free' && !(Array.isArray(f.fpts) && f.fpts.length >= 3) && model) { finToFree(f, model); finSel = 0; }
        f.mode = v; rb();
      });
      if (free) {
        finFreeSidebar(gf.body, f, rb);
        miniBar(gf.body).appendChild(mkMini(T('Aus Trapez neu anlegen'), () => { const m0 = f.mode; f.mode = 'std'; if (model) finToFree(f, model); f.mode = m0; finSel = 0; rb(); })).title = T('Verwirft den freien Umriss und legt ihn als Trapez aus den Werten der Art „mit Übergängen" neu an.');
        numRow(gf.body, 'Größte Dicke (mm, 0 = nur Profil)', () => f.fThkMax, v => { f.fThkMax = Math.max(0, v); rr(); }, { step: 1, min: 0, norender: true, hint: 'Die Dicke folgt je Höhe der waagrechten Sehne des Umrisses × Profildicke. Bei einer langen Rückenflosse würde das Leitwerk unten sehr dick — dieser Wert begrenzt die Dicke (Profilform bleibt, nur flacher).' });
        if (model && model.fin && model.fin.warns) for (const w of model.fin.warns) hint(gf.body, w);
      }
      if (plain) hint(gf.body, 'Trapezfläche aus Wurzeltiefe, Außentiefe, Höhe und Pfeilung, mit dem Rumpf nur vereinigt (boolesche Operation) — keine Radien, keine Hohlkehle, kein Randbogen; die Verschneidung mit dem Rumpf bleibt eine scharfe Kante.');
      if (!free) {
      numRow(gf.body, 'Nasenleiste Wurzel X (mm, 0 = am Rumpfende)', () => f.xLE, v => { f.xLE = Math.max(0, v); rr(); }, { step: 5, min: 0, norender: true, hint: f.rud.on && f.rud.atEnd ? 'Wird durch „Ruderlinie am Rumpfende“ bestimmt.' : undefined });
      boolRow(gf.body, 'Fußhöhe automatisch (Rumpfmitte)', () => !!f.y0Auto, v => { f.y0Auto = v; if (!v && model && model.fin) f.y0 = r1(model.fin.y0); rb(); });
      if (!f.y0Auto) numRow(gf.body, 'Fußhöhe Y (mm)', () => f.y0, v => { f.y0 = v; rr(); }, { step: 1, norender: true });
      numRow(gf.body, 'Tiefe Wurzel (mm)', () => f.cr, v => { f.cr = Math.max(1, v); rr(); }, { step: 5, min: 1, norender: true });
      numRow(gf.body, 'Höhe Nasenleiste über dem Fuß (mm)', () => f.h, v => { f.h = Math.max(1, v); rr(); }, { step: 5, min: 1, norender: true });
      if (plain) {
        numRow(gf.body, 'Außentiefe (mm)', () => f.ctP, v => { f.ctP = Math.max(1, v); rr(); }, { step: 5, min: 1, norender: true });
        numRow(gf.body, 'Pfeilung der Nasenleiste (°, + = nach hinten)', () => f.swP, v => { f.swP = clamp(v, -80, 80); rr(); }, { step: 1, min: -80, max: 80, norender: true });
      } else {
      numRow(gf.body, 'Nasenleiste: Winkel zur Senkrechten (°, + = nach hinten)', () => f.angLE, v => { f.angLE = clamp(v, -80, 80); rr(); }, { step: 1, min: -80, max: 80, norender: true });
      if (!f.fil) numRow(gf.body, 'Übergangsradius Nasenleiste → Rumpf (mm)', () => f.leR, v => { f.leR = Math.max(0, v); rr(); }, { step: 5, min: 0, norender: true, hint: 'Die gerade Nasenleiste läuft unten mit diesem Radius tangential in die Rumpfoberkante ein (0 = Ecke).' });
      numRow(gf.body, 'Endleiste: Winkel zur Senkrechten (°, + = nach hinten)', () => f.angTE, v => { f.angTE = clamp(v, -80, 80); rr(); }, { step: 1, min: -80, max: 80, norender: true });
      numRow(gf.body, 'Abschluss oben: Winkel zur Waagrechten (°, + = hinten höher)', () => f.angTip, v => { f.angTip = clamp(v, -60, 60); rr(); }, { step: 1, min: -60, max: 60, norender: true, hint: 'Gerade vom Ende der Nasenleiste bis zur Endleiste; die Spitzentiefe ergibt sich daraus.' });
      numRow(gf.body, 'Randbogen oben (mm)', () => f.tipRound, v => { f.tipRound = Math.max(0, v); rr(); }, { step: 5, min: 0, norender: true });
      if (!f.fil) numRow(gf.body, 'Hohlkehle zum Rumpf Radius (mm)', () => f.R, v => { f.R = Math.max(0, v); rr(); }, { step: 1, min: 0, norender: true });
      }
      }
      // Ruder: hinter der Ruderlinie gehört das Leitwerk nicht zum Rumpf (Anzeige ja, STL/Formen nein)
      subhead(gf.body, 'Ruder');
      const rd = f.rud;
      boolRow(gf.body, 'Ruder abtrennen (nicht im Rumpf)', () => !!rd.on, v => { rd.on = v; rb(); }, 'Das Seitenleitwerk wird an der Ruderlinie in Leitwerk und Ruder getrennt. Das Ruder gehört nicht zum Rumpf: es wird nur angezeigt (3D-Knopf „Ruder“), nicht im STL, nicht in den Formen und nicht in der Anformung. Das Leitwerk endet an der Ruderlinie mit einer ebenen Stirnfläche.');
      if (rd.on) {
        numRow(gf.body, 'Rudertiefe an der Wurzel (% der Tiefe)', () => rd.pR, v => { rd.pR = clamp(v, 1, 95); rr(); }, { step: 1, min: 1, max: 95, norender: true, hint: 'Von der Endleiste aus gemessen. Die Ruderlinie ist eine Gerade durch diesen Punkt und den an der Spitze.' });
        numRow(gf.body, 'Rudertiefe an der Spitze (% der Tiefe)', () => rd.pT, v => { rd.pT = clamp(v, 1, 95); rr(); }, { step: 1, min: 1, max: 95, norender: true });
        boolRow(gf.body, 'Ruderlinie am Rumpfende (Leitwerk verschieben)', () => !!rd.atEnd, v => { rd.atEnd = v; rb(); }, 'Das Leitwerk wird in X so verschoben, dass die Ruderlinie die Rumpfoberkante genau am Rumpfende trifft — der Rumpf endet an der Ruderlinie. Ändert sich das Rumpfende, wandert das Leitwerk mit.');
        const gr = model && model.fin && model.fin.rud;
        if (gr) hint(gf.body, T('Ruderlinie') + ': X ' + gr.xR.toFixed(1) + ' mm ' + T('bei Y') + ' ' + gr.yR.toFixed(0) + ' · X ' + gr.xT.toFixed(1) + ' mm ' + T('bei Y') + ' ' + gr.yT.toFixed(0) + ' · ' + T('Neigung') + ' ' + (Math.atan(gr.s) * 180 / Math.PI).toFixed(1) + '° (' + T('+ = oben weiter hinten') + ')' + (rd.atEnd ? ' · ' + T('Rumpfende X') + ' ' + model.x1.toFixed(1) + ' mm' : ''));
        else hint(gf.body, 'Ruderlinie lässt sich nicht bestimmen (Leitwerk zu niedrig?).');
      }
      // Anschluss an den Rumpf: unabhängig von der Umrissart
      subhead(gf.body, 'Anschluss an den Rumpf');
      selectRow(gf.body, 'Art des Anschlusses', [['def', free || plain ? 'scharfe Kante (Vereinigung)' : 'Radius und Hohlkehle (Werte oben)'], ['fil', 'Anformung tangential']], () => (f.fil ? 'fil' : 'def'), v => { f.fil = v === 'fil'; rb(); });
      if (f.fil) {
        hint(gf.body, 'Das Leitwerksprofil in Anschlusshöhe wird zur Projektion erweitert (vorn/hinten/seitlich verlängert, Endleiste aufgedickt und gerundet) und senkrecht auf den Rumpfrücken projiziert. Von dort läuft die Übergangsfläche tangential aus dem Rumpf heraus und tangential in das Leitwerk, vor der Nasen- und hinter der Endleiste rund. Gilt für jede Umrissart; Übergangsradius und Hohlkehle der Art „mit Übergängen“ entfallen dabei. Projektion gestrichelt in der Draufsicht.');
        const fbar = miniBar(gf.body);
        fbar.appendChild(mkMini(T('Projektion bearbeiten…'), () => projWinOpen('fin'))).title = T('Eigenes Fenster: Leitwerksprofil in Anschlusshöhe und Projektion, Verlängerung vorn/hinten/seitlich, Endleistendicke und -radius — mit Griffen zum Ziehen.');
        fbar.appendChild(mkMini(T('Hohlkehle zeichnen…'), () => cvWinOpen('fin'))).title = T('Eigenes Fenster: Form der Hohlkehle in der Vorderansicht (Spantschnitt) mit Stützpunkten zeichnen — gilt rundum, beide Seiten gleich.');
        hint(gf.body, T('Projektion') + ': ' + T('Offset') + ' ' + r1(+f.pD) + ' mm · ' + T('Zuschlag') + ' ' + T('vorn') + ' ' + r1(+f.pF) + ' · ' + T('hinten') + ' ' + r1(+f.pB) + ' · ' + T('seitlich') + ' ' + r1(+f.pS) + ' mm' + (+f.pTe > 0 ? ' · ' + T('EL-Dicke') + ' ' + r1(+f.pTe) : '') + (+f.pTeR > 0 ? ' · ' + T('EL-Radius') + ' ' + r1(+f.pTeR) : ''));
        numRow(gf.body, 'Völligkeit des Übergangs', () => f.fTen, v => { f.fTen = clamp(v, 0.2, 1.5); rr(); }, { step: 0.05, min: 0.2, max: 1.5, norender: true, hint: '0,55 = Viertelellipse. Kleiner = schlanker, größer = voller.' });
        subhead(gf.body, 'Leitlinien (Seitenansicht)');
        hint(gf.body, 'Die Form der Anformung vor der Nasen- und hinter der Endleiste bestimmen zwei Leitlinien (Splines, hell lila in der Seitenansicht): vom Projektionsanfang auf dem Rumpfrücken zur Nasenleiste an der Schnittlinie bzw. von der Endleiste an der Schnittlinie zum Projektionsende. Die Leitlinie der Nase gibt allen Übergangskurven im vorderen Bereich ihre Form — jeder waagrechte Schnitt läuft als glatter Offset um die Profilnase. Hinter der Endleiste läuft die Endleiste mit ihrer Dicke bis zur Leitlinie weiter.');
        hint(gf.body, 'Die Leitlinie der Nase verlässt den Rumpfrücken tangential und läuft tangential in die Nasenleiste des Leitwerks ein (wie die Hohlkehle: Enden fest, dazwischen Kontrollpunkte). Sie ist genau die Scheitellinie der Anformung.');
        selectRow(gf.body, 'Spline-Art der Nasen-Leitlinie', [['bs', 'B-Spline (Kontrollpunkte, am ruhigsten)'], ['c2', 'krümmungsstetig (durch die Punkte)']], () => (f.gSpl === 'c2' ? 'c2' : 'bs'), v => { f.gSpl = v; rb(); });
        const fgb = miniBar(gf.body), addFg = (L, other) => { const a = L.length ? L[L.length - 1] : { u: 0, v: other }; L.push({ u: r2((a.u + 1) / 2), v: r2(a.v * 0.6 + other * 0.4) }); L.sort((p, q) => p.u - q.u); rb(); };
        // Nase: Kontrollpunkte wie die Hohlkehle (normiert, Enden fest: tangential an Rumpfrücken und Nasenleiste)
        const addLe = () => {
          const al = clamp(+f.fTen || 0.55, 0.2, 1.5), L = f.gLE;
          if (L.length < 2) {
            const C0 = filBezCtl([0, 0], [1, 0], [1, 1], [0, 1], al);
            const mids = f.gSpl === 'bs' ? [[0.75 * al, 0.04 * al], [(al + 1) / 2, (1 - al) / 2], [1 - 0.04 * al, 1 - 0.75 * al]].map(q => ({ x: q[0], v: q[1] })) : [0.3, 0.6].map(t => { const q = filBezAt(C0, t); return { x: q[0], v: q[1] }; });
            f.gLE = coveEnds(al, mids);
          } else {
            let k = 0, best = -1; for (let i = 0; i + 1 < L.length; i++) { const d = Math.hypot(L[i + 1].x - L[i].x, L[i + 1].v - L[i].v); if (d > best) { best = d; k = i; } }
            L.splice(k + 1, 0, { x: r3((L[k].x + L[k + 1].x) / 2), v: r3((L[k].v + L[k + 1].v) / 2), c: 0 });
          }
          rb();
        };
        fgb.appendChild(mkMini(T('Nase: + Punkt'), addLe)).title = T('Legt Stützpunkte an (zuerst auf der Standardform) bzw. fügt einen in der größten Lücke ein — in der Seitenansicht ziehen.');
        fgb.appendChild(mkMini(T('Nase: − Punkt'), () => { const L = f.gLE; if (L.length > 3) L.splice(L.length - 2, 1); else f.gLE = []; rb(); }));
        if (!f.rud.on) {
          fgb.appendChild(mkMini(T('Endleiste: + Punkt'), () => addFg(f.gTE, 0)));
          fgb.appendChild(mkMini(T('Endleiste: − Punkt'), () => { if (f.gTE.length) { f.gTE.pop(); rb(); } }));
        } else hint(gf.body, 'Mit abgetrenntem Ruder endet die Anformung hinten gerade an der Ruderlinie (ebene Stirnfläche mit dem Leitwerk) — die Leitlinie der Endleiste entfällt. Vorn und seitlich läuft sie tangential mit Hohlkehle in den Rumpf.');
        fgb.appendChild(mkMini(T('Leitlinien zurücksetzen'), () => { f.gLE = []; f.gTE = [{ u: 0.35, v: 0.45 }]; rb(); }));
        subhead(gf.body, 'Schnittlinie (Seitenansicht)');
        hint(gf.body, 'Oberhalb der Schnittlinie bleibt das Leitwerk unverändert, darunter wird es abgeschnitten und der Übergang zum Rumpf beginnt dort tangential. In der Seitenansicht gestrichelt mit drei Griffen: Mitte = Höhe, Enden = Winkel.');
        numRow(gf.body, 'Höhe über dem Rumpfrücken (mm, 0 = automatisch)', () => f.fH, v => { f.fH = Math.max(0, v); rr(); }, { step: 1, min: 0, norender: true, hint: 'Gemessen in der Mitte des Leitwerks ab der höchsten Stelle des Rumpfrückens unter dem Leitwerk. Automatisch: 1,5 × (Offset + Zuschlag seitlich), mind. 10 mm.' });
        numRow(gf.body, 'Winkel der Schnittlinie (°, + = hinten höher)', () => f.fA, v => { f.fA = clamp(v, -45, 45); rr(); }, { step: 1, min: -45, max: 45, norender: true });
        if (model && model.fin && model.fin.ff) hint(gf.body, T('Schnittlinie bei Y =') + ' ' + model.fin.ff.yA.toFixed(1) + ' mm (X ' + model.fin.ff.xr.toFixed(0) + ') · ' + T('Projektion') + ' X ' + model.fin.ff.x0.toFixed(0) + ' … ' + model.fin.ff.x1.toFixed(0) + ' mm');
        if (model && model.fin && model.fin.warns && !free) for (const t of model.fin.warns) hint(gf.body, t);
      }
      subhead(gf.body, 'Profil unten (Wurzel)');
      profRow(gf.body, 'Wurzelprofil', () => f.srcR, () => f.thkR, () => f.profR, v => { f.srcR = v; }, v => { f.thkR = v; }, p => { f.profR = p; }, rb, false);
      subhead(gf.body, 'Profil oben (Spitze)');
      profRow(gf.body, 'Spitzenprofil', () => f.srcT, () => f.thkT, () => f.profT, v => { f.srcT = v; }, v => { f.thkT = v; }, p => { f.profT = p; }, rb, false);
      if (model && model.fin && model.fin.free) hint(gf.body, 'X ' + model.fin.xs.toFixed(0) + ' … ' + model.fin.xe.toFixed(0) + ' mm · Y ' + model.fin.y0.toFixed(0) + ' … ' + model.fin.yMax.toFixed(0) + ' mm · ' + T('Wurzelprofil an der Rumpfoberkante (Y') + ' ' + model.fin.yB.toFixed(0) + ')');
      else if (model && model.fin) hint(gf.body, T('Fuß bei Y =') + ' ' + model.fin.y0.toFixed(1) + ' mm · X ' + model.fin.xs.toFixed(0) + ' … ' + model.fin.xe.toFixed(0) + ' mm · ' + T('Spitzentiefe') + ' ' + model.fin.ct.toFixed(0) + ' mm' + (model.fin.fil || plain ? '' : ' · ' + T('(kein Übergangsradius: Nasenleiste trifft die Oberkante nicht)')));
      // Höhenleitwerk oben aufsetzen
      const h = HL();
      subhead(gf.body, 'Höhenleitwerk');
      boolRow(gf.body, 'Höhenleitwerk einrechnen', () => !!h.on, v => { h.on = v; rb(); }, 'T-Leitwerk: das Seitenleitwerk wird oben in Form der Profilunterseite des Höhenleitwerks ausgeschnitten (Auflage). Kreuzleitwerk: am Seitenleitwerk sitzt nur ein Stummel des Höhenleitwerks mit ebener Stirnfläche als Anschluss (wie der Tragflächenstummel). Das Höhenleitwerk selbst wird nur angezeigt (nicht im STL).');
      if (h.on) {
        const cross = h.mode === 'cross';
        selectRow(gf.body, 'Art', [['seat', 'T-Leitwerk (Auflage oben ausschneiden)'], ['cross', 'Kreuzleitwerk (Stummel am Seitenleitwerk)']], () => (cross ? 'cross' : 'seat'), v => { h.mode = v; rb(); });
        // Geometrie: eigene Maße oder eine Tragfläche aus dem Projekt (Wurzelrippe = Stirnfläche des Stummels bzw. Rumpfmitte)
        const wl = App.wingList ? App.wingList() : [], wOk = h.wingId && wl.some(w => w.id === h.wingId);
        selectRow(gf.body, 'Geometrie', [['', T('Eigene Maße')]].concat(wl.map((w, i) => [w.id, T('Tragfläche') + ': ' + (App.wingName ? App.wingName(i) : i + 1)])), () => (wOk ? h.wingId : ''), v => { h.wingId = v || null; rb(); });
        if (h.wingId && !wOk) hint(gf.body, 'Die zugewiesene Tragfläche gibt es nicht mehr — es gelten die eigenen Maße.');
        if (wOk) {
          const hl = model && model.fin && model.fin.hl;
          if (hl && hl.wp) hint(gf.body, T('Aus der Tragfläche') + ': ' + T('Wurzeltiefe') + ' ' + hl.cr.toFixed(0) + ' mm · ' + T('Außentiefe') + ' ' + hl.ct.toFixed(0) + ' mm · ' + T('Spannweite') + ' ' + hl.b.toFixed(0) + ' mm' + (hl.cross ? ' ' + T('(inkl. Stummel)') : ''));
          else hint(gf.body, 'Die Tragfläche hat noch keine zwei Rippen — es gelten die eigenen Maße.');
        } else {
          numRow(gf.body, 'Wurzeltiefe (mm)', () => h.cr, v => { h.cr = Math.max(1, v); rr(); }, { step: 5, min: 1, norender: true });
          numRow(gf.body, 'Außentiefe (mm)', () => h.ct, v => { h.ct = Math.max(1, v); rr(); }, { step: 5, min: 1, norender: true });
          numRow(gf.body, 'Spannweite (mm)', () => h.b, v => { h.b = Math.max(10, v); rr(); }, { step: 10, min: 10, norender: true });
          numRow(gf.body, 'Pfeilung der Nasenleiste (°, + = nach hinten)', () => h.sweep, v => { h.sweep = clamp(v, -70, 70); rr(); }, { step: 1, min: -70, max: 70, norender: true, hint: cross ? 'Der Stummel übernimmt die Pfeilung (und Zuspitzung): Nasen- und Endleiste laufen bis zur Rumpfmitte gerade weiter.' : undefined });
        }
        numRow(gf.body, 'Einstellwinkel (°)', () => h.alpha, v => { h.alpha = v; rr(); }, { step: 0.5, norender: true });
        if (!wOk) profRow(gf.body, 'Profil', () => h.src, () => h.thk, () => h.prof, v => { h.src = v; }, v => { h.thk = v; }, p => { h.prof = p; }, rb, false);
        boolRow(gf.body, cross ? 'Lage X automatisch (mittig auf der Leitwerkstiefe)' : 'Lage X automatisch (mittig auf der Leitwerksspitze)', () => !!h.xAuto, v => { h.xAuto = v; if (!v && model && model.fin && model.fin.hl) h.x = r1(model.fin.hl.xLE); rb(); });
        if (!h.xAuto) numRow(gf.body, 'Nasenleiste X (mm)', () => h.x, v => { h.x = v; rr(); }, { step: 1, norender: true });
        boolRow(gf.body, cross ? 'Höhe automatisch (halbe Leitwerkshöhe)' : 'Höhe automatisch (Profilsehne auf der Oberkante)', () => !!h.yAuto, v => { h.yAuto = v; if (!v && model && model.fin && model.fin.hl) h.y = r1(model.fin.hl.y); rb(); });
        if (!h.yAuto) numRow(gf.body, 'Höhe der Profilnase Y (mm)', () => h.y, v => { h.y = v; rr(); }, { step: 1, norender: true, hint: cross ? 'Höhe der Profilnase des Stummels.' : 'Tiefer als die Oberkante: das Seitenleitwerk bleibt vor und hinter der Fläche in voller Höhe stehen.' });
        if (cross) {
          numRow(gf.body, 'Stummel bis Rippenebene Z (mm, 0 = automatisch)', () => h.zS, v => { h.zS = Math.max(0, v); rr(); }, { step: 1, min: 0, norender: true, hint: 'Abstand der ebenen Stirnfläche (Stoß zum Höhenleitwerk) von der Mitte. Automatisch: dickste Stelle des Seitenleitwerks im Stummelbereich + 15 mm.' });
          if (model && model.fin && model.fin.hl && model.fin.hl.cross) hint(gf.body, T('Stummel') + ': X ' + model.fin.hl.xLE.toFixed(0) + ' … ' + (model.fin.hl.xLE + model.fin.hl.cr).toFixed(0) + ' mm · Y ' + model.fin.hl.y.toFixed(1) + ' mm · ' + T('Rippenebene Z =') + ' ' + model.fin.hl.zS.toFixed(1) + ' mm');
        } else numRow(gf.body, 'Spiel um das Profil (mm)', () => h.play, v => { h.play = Math.max(0, v); rr(); }, { step: 0.1, min: 0, norender: true });
        if (!wOk && h.src === 'dat' && !(h.prof && h.prof.pts)) hint(gf.body, 'Kein Profil geladen — das Höhenleitwerk wird nicht eingerechnet.');
        else if (!cross && !plain && f.tipRound > 0) hint(gf.body, 'Hinweis: Der Randbogen verjüngt die Auflage — für eine volle Auflagefläche Randbogen 0 oder die Art „einfache Fläche" wählen.');
      }
    }
    side.appendChild(gf.g);
  }

  // V-Leitwerk-Anschluss: Stummel je Seite + Steckungsbohrungen (Liste)
  function vtSidebar(side, rr, rb) {
    const v = VT(), gv = grp('V-Leitwerk-Anschluss', !!v.on, 'rpro', { key: 'rproVtGrp' });
    hint(gv.body, 'Anschluss für ein V-Leitwerk mit denselben Arten wie der Tragflächenübergang: Stummel (das Leitwerksprofil läuft je Seite unter dem V-Winkel gerade bis zur Rippenebene aus dem Rumpf heraus, scharfe Kante), Anformung tangential oder Ausschnitt. Auf der Rippenfläche sitzen die Steckungsbohrungen — Lage bezogen auf die Nase des Leitwerksprofils (X längs der Sehne, Y senkrecht dazu), Achse längs der Spannweite, Tiefe ab der Rippenfläche nach innen. Lila in Seiten-/Draufsicht, Bohrungen orange.');
    boolRow(gv.body, 'V-Leitwerk-Stummel einrechnen', () => !!v.on, val => { v.on = val; rb(); });
    if (v.on) {
      profRow(gv.body, 'Leitwerksprofil', () => v.src, () => v.thk, () => v.prof, val => { v.src = val; }, val => { v.thk = val; }, p => { v.prof = p; }, rb, false);
      numRow(gv.body, 'Nasenleiste X (mm, 0 = vor dem Heck)', () => v.xLE, val => { v.xLE = Math.max(0, val); rr(); }, { step: 5, min: 0, norender: true });
      boolRow(gv.body, 'Höhe der Profilnase automatisch (Rumpfmitte)', () => !!v.yAuto, val => { v.yAuto = val; if (!val && model && model.vt) v.yLE = r1(model.vt.yLE); rb(); });
      if (!v.yAuto) numRow(gv.body, 'Profilnase Y in der Symmetrieebene (mm)', () => v.yLE, val => { v.yLE = val; rr(); }, { step: 1, norender: true, hint: 'Höhe, in der die Profilsehne (verlängert) die Rumpfmitte schneidet. Von dort läuft der Stummel unter dem V-Winkel nach außen.' });
      numRow(gv.body, 'Profiltiefe an der Rippe (mm)', () => v.chord, val => { v.chord = Math.max(5, val); rr(); }, { step: 5, min: 5, norender: true });
      numRow(gv.body, 'V-Winkel ab der Waagrechten (°, − = umgekehrtes V)', () => v.dih, val => { v.dih = clamp(val, -80, 80); rr(); }, { step: 1, min: -80, max: 80, norender: true, hint: 'Neigung jeder Leitwerkshälfte gegen die Waagrechte (V-Form). Der Öffnungswinkel des V ist 180° − 2 × dieser Wert.' });
      numRow(gv.body, 'Einstellwinkel (°)', () => v.alpha, val => { v.alpha = clamp(val, -20, 20); rr(); }, { step: 0.5, min: -20, max: 20, norender: true });
      numRow(gv.body, 'Rippenebene: Abstand von der Rumpfmitte längs der Spannweite (mm, 0 = automatisch)', () => v.len, val => { v.len = Math.max(0, val); rr(); }, { step: 1, min: 0, norender: true, hint: 'Lage der Stummel-Stirnfläche (Anschlussrippe des Leitwerks), gemessen längs der Leitwerks-Spannweite ab der Rumpfmitte. Automatisch: Profil tritt überall aus dem Rumpf aus + 15 mm.' });
      // Art wie beim Tragflächenübergang (gleiche Optionen), gerechnet in der Ebene der Leitwerkshälfte („oben“ = Profiloberseite)
      const md = v.mode === 'cut' ? 'cut' : v.mode === 'fil' ? 'fil' : 'stub';
      selectRow(gv.body, 'Art', [['stub', 'Stummel (scharfe Kante, ohne Übergang)'], ['fil', 'Anformung tangential'], ['cut', 'Ausschnitt (Rumpf ausgeschnitten)']], () => md, val => { v.mode = val; rb(); });
      if (md === 'fil') {
        hint(gv.body, 'Wie beim Tragflächenübergang (tangential): das Leitwerksprofil wird zur Projektion erweitert und in Richtung der Leitwerks-Spannweite auf den Rumpf projiziert; von dort läuft die Übergangsfläche tangential aus der Rumpfhaut in das Leitwerk an der Rippenebene, vor der Nase und hinter der Endleiste rund. „Oben/unten“ meint hier Profilober-/-unterseite der Leitwerkshälfte. Projektion gestrichelt in Seiten-/Draufsicht.');
        const pbar = miniBar(gv.body);
        pbar.appendChild(mkMini(T('Projektion bearbeiten…'), () => projWinOpen('vt'))).title = T('Eigenes Fenster: Leitwerksprofil und Projektion (in der Ebene der Leitwerkshälfte), Verlängerung vorn/hinten/oben/unten, Endleistendicke und -radius — mit Griffen zum Ziehen.');
        pbar.appendChild(mkMini(T('Hohlkehle zeichnen…'), () => cvWinOpen('vt'))).title = T('Eigenes Fenster: Form der Hohlkehle oben/unten im Spantschnitt (Blick längs X, gedreht auf die Leitwerkshälfte) — gilt rundum.');
        hint(gv.body, T('Projektion') + ': ' + T('Offset') + ' ' + r1(+v.pD) + ' mm · ' + T('Zuschlag') + ' ' + T('vorn') + ' ' + r1(+v.pF) + ' · ' + T('hinten') + ' ' + r1(+v.pB) + ' · ' + T('oben') + ' ' + r1(+v.pU) + ' · ' + T('unten') + ' ' + r1(+v.pL) + ' mm' + (+v.pTe > 0 ? ' · ' + T('EL-Dicke') + ' ' + r1(+v.pTe) : '') + (+v.pTeR > 0 ? ' · ' + T('EL-Radius') + ' ' + r1(+v.pTeR) : ''));
        numRow(gv.body, 'Endleistendicke der Leitwerksrippe (mm)', () => v.te, val => { v.te = Math.max(0, val); rr(); }, { step: 0.1, min: 0, norender: true, hint: 'Ober- und Unterseite werden um die Nase gedreht, bis die Endleiste so weit aufklafft — die Anformung läuft hinten nicht messerdünn aus.' });
        numRow(gv.body, 'Völligkeit des Übergangs', () => v.fTen, val => { v.fTen = clamp(val, 0.2, 1.5); rr(); }, { step: 0.05, min: 0.2, max: 1.5, norender: true, hint: '0,55 = Viertelellipse. Kleiner = schlanker, enger in der Kehle; größer = voller.' });
        numRow(gv.body, 'Gerades Stück vor der Rippe (mm)', () => v.fStr, val => { v.fStr = Math.max(0, val); rr(); }, { step: 1, min: 0, norender: true, hint: 'Nach dem Übergang läuft das Profil so weit gerade bis zur Rippenebene. 0 = Übergang endet direkt an der Rippe.' });
        subhead(gv.body, 'Leitlinien (Nase / Endleiste)');
        hint(gv.body, 'Wie beim Tragflächenübergang: die Leitlinien bestimmen die Form vor der Nase und hinter der Endleiste (Projektion am Rumpf -> Nasenleiste bzw. Endleiste -> Projektionsende). Stützpunkte hier hinzufügen/entfernen und in der Draufsicht ziehen (bei V-Winkel über 45° in der Seitenansicht); die Linien liegen in der Ebene der Leitwerkshälfte.');
        const gb = miniBar(gv.body), addPt = (L, other) => { const a = L.length ? L[L.length - 1] : { u: 0, v: other }; L.push({ u: r2((a.u + 1) / 2), v: r2(a.v * 0.6 + other * 0.4) }); L.sort((p, q) => p.u - q.u); rb(); };
        gb.appendChild(mkMini(T('Nase: + Punkt'), () => addPt(v.gLE, 1)));
        gb.appendChild(mkMini(T('Nase: − Punkt'), () => { if (v.gLE.length) { v.gLE.pop(); rb(); } }));
        gb.appendChild(mkMini(T('Endleiste: + Punkt'), () => addPt(v.gTE, 0)));
        gb.appendChild(mkMini(T('Endleiste: − Punkt'), () => { if (v.gTE.length) { v.gTE.pop(); rb(); } }));
        gb.appendChild(mkMini(T('Leitlinien zurücksetzen'), () => { v.gLE = []; v.gTE = [{ u: 0.35, v: 0.45 }]; rb(); }));
        if (model && model.vt && model.vt.gw && model.vt.gw.fl) hint(gv.body, T('Anformung') + ': X ' + r1(model.vt.gw.fl.x0) + ' … ' + r1(model.vt.gw.fl.x1) + ' mm · ' + T('Rippenebene') + ' ' + r1(model.vt.gw.zf) + ' mm');
      } else if (md === 'cut') {
        hint(gv.body, 'Statt eines Stummels wird der Rumpf in Form des Leitwerksprofils ausgeschnitten — als Durchbruch bzw. Tasche in Profilform oder zur Profilober-/-unterseite hin offen (Auflage). Der Durchbruch reicht bis zur Rumpfmitte.');
        selectRow(gv.body, 'Ausschnitt', [['none', 'nur Profil (Durchbruch / Tasche)'], ['up', 'zur Profiloberseite offen'], ['down', 'zur Profilunterseite offen']], () => (v.cutOpen === 'up' || v.cutOpen === 'down' ? v.cutOpen : 'none'), val => { v.cutOpen = val; rr(); });
        numRow(gv.body, 'Spiel um das Profil (mm)', () => v.cutPlay, val => { v.cutPlay = Math.max(0, val); rr(); }, { step: 0.1, min: 0, norender: true });
        numRow(gv.body, 'Kern stehen lassen: Abstand längs der Spannweite (mm, 0 = bis zur Mitte)', () => v.cutZ, val => { v.cutZ = Math.max(0, val); rr(); }, { step: 1, min: 0, norender: true, hint: 'Größer 0: der Ausschnitt reicht von außen nur bis zu diesem Abstand von der Rumpfmitte (längs der Leitwerks-Spannweite) — es entsteht je Seite eine Tasche in Profilform (z. B. für Steckungen).' });
      }
      subhead(gv.body, 'Steckungsbohrungen');
      hint(gv.body, 'Je Bohrung: X / Y ab der Profilnase der Leitwerksrippe (X zur Endleiste, Y nach oben bzw. zur Profiloberseite), Durchmesser und Tiefe ab der Rippenfläche nach innen. Rot = Bohrung nicht ganz im Profil (0,5 mm Rand) oder über die Rumpfmitte hinaus.');
      const g = model && model.vt, tb = tbl(gv.body), th = document.createElement('tr');
      th.innerHTML = '<th style="width:16px">#</th><th>X</th><th>Y</th><th>Ø</th><th title="' + T('Tiefe ab der Rippenfläche (mm)') + '">' + T('Tiefe') + '</th><th style="width:22px"></th>'; tb.appendChild(th);
      v.bores.forEach((b, i) => {
        const tr = document.createElement('tr'), td = el => { const c = document.createElement('td'); if (el) c.appendChild(el); tr.appendChild(c); return c; };
        const t0 = td(); t0.textContent = i + 1; if (g && g.bores[i] && !g.bores[i].ok) t0.style.color = '#f66';
        td(cellInp(r1(+b.x || 0), val => { b.x = val; rb(); }));
        td(cellInp(r1(+b.y || 0), val => { b.y = val; rb(); }));
        td(cellInp(r1(+b.d || 0), val => { b.d = Math.max(0.5, val); rb(); }));
        td(cellInp(r1(+b.len || 0), val => { b.len = Math.max(0.5, val); rb(); }));
        const x = mkMini('×', () => { v.bores.splice(i, 1); rb(); }); x.title = T('Bohrung löschen'); x.style.cssText = 'padding:0 4px;min-width:0'; td(x);
        tb.appendChild(tr);
      });
      const bb = miniBar(gv.body);
      bb.appendChild(mkMini(T('+ Bohrung'), () => { const l = v.bores[v.bores.length - 1]; v.bores.push(l ? { x: r1(l.x + 15), y: l.y, d: l.d, len: l.len } : { x: 30, y: 0, d: 4, len: 30 }); rb(); }));
      bb.appendChild(mkMini(T('Bohrschablone (Rippe) als DXF…'), exportVtDxf)).title = T('Rippenfläche des Stummels 1:1 mit den Bohrungen: Profilnase im Ursprung, X längs der Sehne — zum Ausdrucken/Bohren oder als Formenrippe.');
      if (g) {
        hint(gv.body, T('Rippe bei') + ' ' + g.tE.toFixed(1) + ' mm ' + T('ab Rumpfmitte (längs der Spannweite)') + ' · ' + T('Nase') + ' X ' + g.xLE.toFixed(1) + ' / Y ' + g.yLE.toFixed(1) + ' · ' + g.name);
        for (const b of g.bores) {
          const c = vtPt(g, g.tE, b.h);
          hint(gv.body, T('Bohrung') + ' ' + (b.i + 1) + ' ' + T('Mitte auf der Rippe:') + ' X ' + b.X.toFixed(1) + ' · Y ' + c[0].toFixed(1) + ' · Z ±' + c[1].toFixed(1) + ' mm');
        }
        for (const w of g.warns) hint(gv.body, w);
      } else if (v.src === 'dat' && !(v.prof && v.prof.pts)) hint(gv.body, 'Kein Profil geladen — der Stummel wird nicht eingerechnet.');
    }
    side.appendChild(gv.g);
  }
  // Rumpfboot + konisches Leitwerksrohr
  function boomSidebar(side, rr, rb) {
    const b = BM(), g = model && model.boom;
    const gb = grp('Rumpfboot + Leitwerksrohr', !!b.on, 'rpro', { key: 'rproBoomGrp' });
    hint(gb.body, 'Nur ein Rumpfboot: der Rumpf endet am Übergang, dahinter schließt ein konisches Rohr als Leitwerksausleger an. Am Übergang bekommt das Boot eine Einschnürung (Steckzapfen), über die das Rohr geschoben wird — Durchmesser = Rohr innen (außen − Wandstärke) − Spiel, mit der Konizität des Rohrs; die Rohrstirn liegt an der Schulter an. Das Rohr selbst wird nur angezeigt; seinen Wickeldorn (Form zum Wickeln, in Druckstücken auf ein durchgehendes Rohr aufgefädelt) gibt es im Reiter „Rumpf Formenbau", Bauteil „Leitwerksrohr".');
    boolRow(gb.body, 'Rumpfboot mit Leitwerksrohr', () => !!b.on, v => { b.on = v; rb(); });
    if (b.on) {
      boolRow(gb.body, 'Übergang am Heck (letzter Umrisspunkt)', () => !!b.xAuto, v => { b.xAuto = v; if (!v && g) b.x = r1(g.xT); rb(); });
      if (!b.xAuto) numRow(gb.body, 'Übergang X (mm)', () => b.x, v => { b.x = v; rr(); }, { step: 5, norender: true, hint: 'Der Rumpf wird hier abgeschnitten; Umrisse und Spanten dahinter bleiben erhalten, wirken aber nicht.' });
      boolRow(gb.body, 'Rohr vorne Ø aus dem Bootsquerschnitt', () => !!b.dAuto, v => { b.dAuto = v; if (!v && g) b.d0 = r1(2 * g.r0); rb(); });
      if (!b.dAuto) numRow(gb.body, 'Rohr außen Ø vorne (mm)', () => b.d0, v => { b.d0 = Math.max(2, v); rr(); }, { step: 0.5, min: 2, norender: true });
      numRow(gb.body, 'Rohr außen Ø hinten (mm)', () => b.d1, v => { b.d1 = Math.max(1, v); rr(); }, { step: 0.5, min: 1, norender: true });
      numRow(gb.body, 'Rohrlänge ab Übergang (mm)', () => b.len, v => { b.len = Math.max(20, v); rr(); }, { step: 10, min: 20, norender: true });
      numRow(gb.body, 'Neigung der Rohrachse (°, + = nach oben)', () => b.ang, v => { b.ang = clamp(v, -15, 15); rr(); }, { step: 0.5, min: -15, max: 15, norender: true, hint: 'Die Achse geht durch die Mitte des Bootsquerschnitts am Übergang. Die Schulter bleibt senkrecht zur Rumpflängsachse — bei geneigtem Rohr wird die Rohrstirn entsprechend schräg abgelängt.' });
      numRow(gb.body, 'Wandstärke / Abzug für den Wickeldorn (mm)', () => b.wall, v => { b.wall = Math.max(0, v); rr(); }, { step: 0.05, min: 0, norender: true, hint: 'Laminatstärke des gewickelten Rohrs. Wie der Beplankungsabzug beim Kern: der Wickeldorn ist das Rohr außen minus diese Stärke, ebenso der Steckzapfen am Boot.' });
      subhead(gb.body, 'Einschnürung am Boot');
      numRow(gb.body, 'Steckmaß: Länge der Einschnürung (mm)', () => b.sock, v => { b.sock = Math.max(2, v); rr(); }, { step: 1, min: 2, norender: true, hint: 'So weit wird das Rohr über den Zapfen geschoben.' });
      numRow(gb.body, 'Spiel (radial, mm)', () => b.play, v => { b.play = Math.max(0, v); rr(); }, { step: 0.05, min: 0, norender: true, hint: 'Luft zwischen Zapfen und Rohr-Innenseite (Klebespalt).' });
      if (g) {
        hint(gb.body, T('Rohr') + ' Ø ' + (2 * g.r0).toFixed(1) + ' → ' + (2 * g.r1).toFixed(1) + ' mm · ' + T('innen') + ' Ø ' + (2 * (g.r0 - g.t)).toFixed(1) + ' → ' + (2 * (g.r1 - g.t)).toFixed(1) + ' mm · ' + T('Einschnürung') + ' Ø ' + (2 * g.rs0).toFixed(2) + ' mm' + (b.dAuto ? '' : ' · ' + T('Bootsquerschnitt am Übergang ≈ Ø') + ' ' + g.dAuto.toFixed(1) + ' mm'));
        if (g.dev > 0.3) hint(gb.body, T('Der Bootsquerschnitt am Übergang weicht bis') + ' ' + g.dev.toFixed(1) + ' ' + T('mm vom Rohr-Außenkreis ab — das Rohr schließt dort nicht bündig an.'));
        for (const w of g.warn) hint(gb.body, w);
      }
      const bb = miniBar(gb.body);
      bb.appendChild(mkMini(T('Heck rund auf Rohr'), () => { if (!model || !model.boom) build(); boomRoundHeck(); rb(); }));
      hint(gb.body, 'Setzt am Übergang einen Kreisspant (Steuerspant) mit dem Rohr-Außendurchmesser vorne — Ober-/Unterkante und Breite ziehen mit, das Boot läuft bündig ins Rohr.');
      colorRow(gb.body, 'Farbe Leitwerksrohr', 'rproColBoom');
      if (FN().on) hint(gb.body, 'Das Seitenleitwerk wird bei einem Rumpfboot nicht angeformt (es sitzt am Rohr).');
    }
    side.appendChild(gb.g);
  }

  // ---------- Sidebar (Reiter „rpro") ----------------------------------------------
  const num = v => { const x = parseFloat(String(v).replace(',', '.')); return isNaN(x) ? null : x; };
  function miniBar(body) { const d = document.createElement('div'); d.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin:4px 0'; body.appendChild(d); return d; }
  function cellInp(val, onchg, opt) {
    const inp = document.createElement('input'); inp.type = 'text'; inp.inputMode = 'decimal'; inp.value = val;
    inp.style.cssText = 'width:100%;min-width:26px;padding:1px 2px;font-size:10px';
    if (opt && opt.ro) { inp.readOnly = true; inp.style.opacity = '.5'; }
    if (opt && opt.title) inp.title = opt.title;
    inp.onchange = () => { const v = num(inp.value); if (v != null) setTimeout(() => onchg(v), 0); };   // nach dem Fokuswechsel (angeklicktes Feld behält den Fokus)
    return inp;
  }
  function miniSel(opts, val, onchg, w) {
    const sf = document.createElement('select'); sf.style.cssText = 'font-size:10px;padding:0;min-width:0;width:' + (w || '100%');
    opts.forEach(o => { const e = document.createElement('option'); e.value = o[0]; e.textContent = T(o[1]); sf.appendChild(e); });
    sf.value = val; sf.onchange = () => onchg(sf.value); return sf;
  }
  function tbl(body) { const t = document.createElement('table'); t.className = 'rumpf-tbl'; t.style.cssText = 'width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed'; body.appendChild(t); return t; }
  // Rumpf maßstäblich ändern (DevFus: neue Hauptmaße im ersten Panel = Projekt neu skalieren).
  function scaleAll(fx, fy, fz) {
    const o = outlines();
    for (const k of LINES) {
      const fv = k === 'w' ? fz : fy;
      for (const p of o[k]) { p.x = r2(p.x * fx); p.v = r2(p.v * fv); if (p.c) { p.i = [p.i[0] * fx, p.i[1] * fv]; p.o = [p.o[0] * fx, p.o[1] * fv]; } }
    }
    for (const f of formers()) {
      f.x = r2(f.x * fx);
      if (f.p.yw != null) f.p.yw = r2(f.p.yw * fy);
      f.p.rtx = r2(f.p.rtx * fz); f.p.rbx = r2(f.p.rbx * fz); f.p.rty = r2(f.p.rty * fy); f.p.rby = r2(f.p.rby * fy);
      if (f.p.dia) f.p.dia = r2(f.p.dia * (fy + fz) / 2);
      if (f.pinBox) { const pb = f.pinBox; pb.x = f.x; pb.top *= fy; pb.bot *= fy; pb.w *= fz; pb.f = shapeKey(f); }
    }
    // Fixierungen mitskalieren (Skalieren ist eine bewusste Gesamtänderung)
    const F = state.cfg.rproFix;
    if (F && F.snap) for (const k of LINES) if (Array.isArray(F.snap[k])) {
      const fv = k === 'w' ? fz : fy;
      for (const p of F.snap[k]) { p.x = r2(p.x * fx); p.v = r2(p.v * fv); if (p.c) { p.i = [p.i[0] * fx, p.i[1] * fv]; p.o = [p.o[0] * fx, p.o[1] * fv]; } }
    }
    if (F && Array.isArray(F.wsnap)) F.wsnap = F.wsnap.map(q => [r2(q[0] * fx), q[1] * fy]);
  }
  // Eigene Spantansicht ein/aus. Beim ersten Einschalten startet der Spant mit dem aktuellen gemeinsamen Zoom.
  function setOwn(f, on) {
    if (on && !f.own && !f.view) { const cur = cam2.sec; f.own = true; f.view = Object.assign({}, cur); return; }
    f.own = !!on;
  }
  function rproSidebar(side) {
    const rr = () => refresh();
    const rb = () => { buildSidebar(); draw(); };   // die Seitenleiste baut das Modell selbst neu (unten)
    // Modell immer frisch, sonst zeigt die Spantliste interpolierte Werte eines veralteten Stands
    if (state.activeTab === 'rpro' || !model || !model.P) build();
    buildCutPanel();   // Schnittansicht: Bedienfeld liegt im Ansichtsfenster (links unten)
    const o = outlines(), fr = formers(), sel = selIdx();
    const G = {};   // Gruppen erst sammeln, unten in Arbeitsreihenfolge einhängen

    // --- Vorlagen & Hauptmaße -----------------------------------------------------
    const g0 = grp('Vorlagen & Hauptmaße', true, 'rpro', { key: 'Rumpf: Vorlagen & Hauptmaße' });
    hint(g0.body, 'Arbeitsweise wie DevFus: 1. Umrisse in Seiten- und Draufsicht zeichnen (auf Wunsch über Hintergrundbildern), 2. Spanten platzieren und je Spant die Querschnittsform wählen — Werte als Steuerspant festlegen oder aus den Nachbarn interpolieren lassen, 3. prüfen in 3D. Der Bausatz (Spanten mit Beplankungsabzug, Gurte, Helling) entsteht im Reiter „Rumpf Spanten".');
    const b0 = miniBar(g0.body);
    const ask = (fn) => () => { if (confirm(T('Umrisse und Spanten ersetzen?'))) { fn(); rb(); } };
    b0.appendChild(mkMini(T('Vorlage Segler (Ei-Spanten)'), ask(() => applyTemplate('segler'))));
    b0.appendChild(mkMini(T('Vorlage Kastenrumpf (Rechteck-Spanten)'), ask(() => applyTemplate('motor'))));
    if (Array.isArray(state.cfg.rumpfSt) && state.cfg.rumpfSt.length >= 2) b0.appendChild(mkMini(T('Aus altem Rumpf-Reiter übernehmen'), ask(() => applyTemplate('rumpf')))).title = T('Stationen des früheren Reiters „Rumpf" aus diesem Projekt formgleich als Umrisse und Spanten übernehmen.');
    if (model && model.bounds) {
      const L0 = o.top[o.top.length - 1].x - o.top[0].x, bmn = model.bounds.mn, bmx = model.bounds.mx;
      let hMax = 0, wMax = 0; for (let q = 0; q <= 100; q++) { const b = boxAt(model, model.x0 + (model.x1 - model.x0) * q / 100); hMax = Math.max(hMax, b.h); wMax = Math.max(wMax, b.w * 2); }
      numRow(g0.body, 'Länge Nase–Heck (mm)', () => r1(L0), v => { if (v > 1 && L0 > 0) { scaleAll(v / L0, 1, 1); rb(); } }, { step: 10, min: 1, norender: true, enter: true, hint: 'Neuer Wert skaliert den Rumpf in X (Umrisse und Spantlagen).' });
      numRow(g0.body, 'Größte Höhe (mm)', () => r1(hMax), v => { if (v > 0 && hMax > 0) { scaleAll(1, v / hMax, 1); rb(); } }, { step: 5, min: 1, norender: true, enter: true, hint: 'Skaliert alle Y-Werte (Ober-/Unterkante, breiteste Stelle, Eckradien Y).' });
      numRow(g0.body, 'Größte Breite (mm)', () => r1(wMax), v => { if (v > 0 && wMax > 0) { scaleAll(1, 1, v / wMax); rb(); } }, { step: 5, min: 1, norender: true, enter: true, hint: 'Skaliert alle Z-Werte (Breite, Eckradien X).' });
      hint(g0.body, T('Außenmaße inkl. Anbauten:') + ' ' + (bmx[0] - bmn[0]).toFixed(0) + ' × ' + (bmx[1] - bmn[1]).toFixed(0) + ' × ' + (bmx[2] - bmn[2]).toFixed(0) + ' mm');
    }

    // --- Fixieren ----------------------------------------------------------------------
    const FXc = C('rproFix'), gfx = grp('Fixieren', false, 'rpro', { key: 'rproFixGrp' });
    hint(gfx.body, 'Fixierte Ansichten und Spanten bleiben genau so, wie sie beim Einschalten waren: Änderungen an einem Spant (Spantansicht, Höhe/Breite, Kreis, freie Knoten), an der anderen Ansicht oder in den Tabellen wirken nicht mehr darauf. Ihre Griffe sind grau und lassen sich nicht ziehen. Lösen übernimmt den Stand ohne Sprung.');
    boolRow(gfx.body, 'Draufsicht (halbe Breite)', () => !!FXc.top, v => { setFix('top', v); rb(); });
    boolRow(gfx.body, 'Seitenansicht (Ober- und Unterkante)', () => !!FXc.side, v => { setFix('side', v); rb(); });
    boolRow(gfx.body, 'Dickenlinie (Y der breitesten Stelle)', () => !!FXc.wid, v => { setFix('wid', v); rb(); }, 'Die orange Linie in der Seitenansicht. Gilt für Ei- und Dreieck-Spanten: deren breiteste Stelle folgt der festgehaltenen Linie, auch wenn Spanten verschoben, eingefügt oder Steuerwerte geändert werden. Bei Rechteck-, Kreis- und freien Spanten ergibt sich die breiteste Stelle aus der Form — die hält „Spanten fixieren“.');
    boolRow(gfx.body, 'Alle Spanten', () => !!FXc.fr, v => { setFix('fr', v); rb(); }, 'Jeder Spant behält Lage, Querschnittsform (interpolierte Werte werden als Steuerwerte festgeschrieben) sowie Höhe und Breite an seiner Stelle: die Umrisse werden dort festgehalten. Einzelne Spanten lassen sich in der Gruppe „Spant n“ fixieren.');
    const bfx = miniBar(gfx.body);
    bfx.appendChild(mkMini(T('Alles fixieren'), () => { for (const k of ['top', 'side', 'wid', 'fr']) if (!FXc[k]) setFix(k, true); rb(); }));
    bfx.appendChild(mkMini(T('Alles lösen'), () => { for (const k of ['fr', 'wid', 'side', 'top']) if (FXc[k]) setFix(k, false); fr.forEach(q => { if (q.pin) pinFormer(q, false); }); rb(); }));
    const pinList = fr.map((q, i) => q.pin ? i + 1 : 0).filter(Boolean);
    if (pinList.length && !FXc.fr) hint(gfx.body, T('Einzeln fixierte Spanten:') + ' ' + pinList.join(', '));

    // --- Umrisse --------------------------------------------------------------------
    const g1 = grp('Umrisse (Seite & Draufsicht)', true, 'rpro', { key: 'Rumpf: Umrisse' });
    if (anyLineLocked()) hint(g1.body, '🔒 ' + T(FXc.top && FXc.side ? 'Seiten- und Draufsicht sind fixiert' : FXc.side ? 'Seitenansicht (Ober-/Unterkante) ist fixiert' : 'Draufsicht (halbe Breite) ist fixiert') + ' — ' + T('Änderungen an diesen Linien werden nicht übernommen (Gruppe „Fixieren“).'));
    hint(g1.body, 'Drei Splines mit eigenen Punkten, unabhängig von den Spanten: Oberkante und Unterkante (Seitenansicht), halbe Breite (Draufsicht). Punkttypen wie in DevFus: glatt (blau, Tangente automatisch), glatt mit Tangente (rot, Griffe bleiben in einer Linie) und Ecke (rot, Griffe frei). Doppelklick auf eine Linie fügt einen Punkt ein (Form bleibt), Entf löscht ihn. Nase und Heck liegen für alle drei Linien auf gleichem X.');
    hint(g1.body, 'Gerade Linie: in der Seitenansicht oder Draufsicht einen Punkt anklicken, dann Knopf „Abschnitt gerade ⇄ Kurve“ oder Taste G (oder Häkchen „gerade“ in der Tabelle). Der Abschnitt bis zum nächsten Punkt wird eine Strecke (gelb angezeigt); die Splines davor und danach schließen tangential an (außer an einer Ecke). Rechtsklick auf einen Punkt löscht ihn.');
    selectRow(g1.body, 'Spline-Art', [['c2', 'krümmungsstetig (C2, empfohlen)'], ['bs', 'B-Spline (Punkte = Kontrollpunkte, am ruhigsten)'], ['cr', 'Catmull-Rom (wie Reiter „Rumpf")']], () => splMode(), v => { o.spl = v; rb(); },
      'Catmull-Rom hält nur die Tangente stetig — an jedem Punkt springt die Krümmung, und das Verschieben eines Punkts verbiegt die Nachbarabschnitte; so entstehen leicht ungewollte Wendepunkte. Krümmungsstetig (C2): die Kurve läuft weiter durch die Punkte, Krümmung ohne Sprünge. B-Spline: die Punkte ziehen die Kurve nur an (Kontrollpolygon gestrichelt), sie hat nie mehr Wendepunkte als das Polygon — am ruhigsten, Ecken (Typ „Ecke") liegen auf der Kurve. Punkte mit Tangente/Ecke teilen die Linie in unabhängige Abschnitte.');
    const sp = selPt(), curLine = sp ? sp.line : (C('rproView') === 'top' ? 'w' : 'top');
    selectRow(g1.body, 'Linie', [['top', 'Oberkante'], ['bot', 'Unterkante'], ['w', 'halbe Breite']], () => curLine, v => { S('rproPt', { line: v, k: 0 }); lastSel = 'pt'; rb(); });
    const t1 = tbl(g1.body);
    const th1 = document.createElement('tr'); th1.innerHTML = '<th style="width:18px">#</th><th>X</th><th>' + T(curLine === 'w' ? '½ Breite' : 'Y') + '</th><th style="width:34%">' + T('Typ') + '</th><th title="' + T('Abschnitt bis zum nächsten Punkt ist eine Gerade; angrenzende Splines schließen tangential an') + '">' + T('gerade') + '</th>'; t1.appendChild(th1);
    o[curLine].forEach((p, k) => {
      const tr = document.createElement('tr'); if (sp && sp.line === curLine && sp.k === k) tr.style.background = 'rgba(90,169,255,.18)';
      const td0 = document.createElement('td'); td0.textContent = k + 1; td0.style.cursor = 'pointer'; td0.onclick = () => { S('rproPt', { line: curLine, k }); lastSel = 'pt'; rb(); }; tr.appendChild(td0);
      const end = k === 0 || k === o[curLine].length - 1;
      const tdx = document.createElement('td'); tdx.appendChild(cellInp(r2(p.x), v => {
        if (end) { for (const q of LINES) o[q][k === 0 ? 0 : o[q].length - 1].x = v; } else p.x = v;
        rb();
      }, { title: end ? T('Nase/Heck: gilt für alle drei Linien') : '' })); tr.appendChild(tdx);
      const tdv = document.createElement('td'); tdv.appendChild(cellInp(r2(p.v), v => { p.v = curLine === 'w' ? Math.max(0, v) : v; rb(); })); tr.appendChild(tdv);
      const tdc = document.createElement('td'); tdc.appendChild(miniSel([['0', 'glatt'], ['1', 'Tangente'], ['2', 'Ecke']], String(p.c), v => { setPtType(curLine, k, +v); S('rproPt', { line: curLine, k }); rb(); })); tr.appendChild(tdc);
      const tdl = document.createElement('td'); tdl.style.textAlign = 'center';
      if (k < o[curLine].length - 1) { const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!p.l; cb.title = T('Abschnitt') + ' ' + (k + 1) + ' → ' + (k + 2); cb.onchange = () => { setStraightOut(curLine, k, cb.checked); S('rproPt', { line: curLine, k }); lastSel = 'pt'; rb(); }; tdl.appendChild(cb); }
      tr.appendChild(tdl);
      t1.appendChild(tr);
    });
    const b1 = miniBar(g1.body);
    b1.appendChild(mkMini(T('+ Punkt (Mitte des längsten Abschnitts)'), () => { const pts = o[curLine]; let j = 0, d = -1; for (let q = 0; q + 1 < pts.length; q++) if (pts[q + 1].x - pts[q].x > d) { d = pts[q + 1].x - pts[q].x; j = q; } insertOutPt(curLine, (pts[j].x + pts[j + 1].x) / 2); rb(); }));
    b1.appendChild(mkMini(T('− gewählten Punkt'), () => removeOutPt()));
    b1.appendChild(mkMini(T('Abschnitt gerade ⇄ Kurve'), () => { if (toggleStraightSel()) rb(); })).title = T('Strecke vom gewählten Punkt bis zum nächsten als gerade Linie (oder wieder als Kurve). Punkt in der Seitenansicht oder Draufsicht anklicken; Taste G. Auch je Zeile in der Tabelle.');
    b1.appendChild(mkMini(T('Alle Punkte glatt'), () => { o[curLine].forEach((p, k) => { if (k > 0 && k < o[curLine].length - 1) { p.c = 0; normPt(p); } }); rb(); })).title = T('Alle inneren Punkte dieser Linie auf „glatt (automatisch)" setzen.');
    boolRow(g1.body, 'Tangenten aller Punkte zeigen', () => C('rproShowTan'), v => { S('rproShowTan', v); draw(); }, 'Aus: nur die Tangentengriffe des gewählten Punkts werden gezeigt.');
    subhead(g1.body, 'Glätten (Fairing)');
    numRow(g1.body, 'Größte Verschiebung je Punkt (mm)', () => C('rproFairTol'), v => { S('rproFairTol', Math.max(0.1, v)); }, { step: 0.5, min: 0.1, norender: true,
      hint: 'Verschiebt die glatten Punkte so, dass sich die Krümmung längs der Linie möglichst wenig ändert (entfernt Buckel und unnötige Wendepunkte), jeden Punkt höchstens um diesen Betrag. Linienenden, Punkte mit Tangente und Ecken bleiben stehen. Krümmungskamm vorher/nachher vergleichen; mehrmals drücken glättet weiter.' });
    const bf = miniBar(g1.body);
    bf.appendChild(mkMini(T('Diese Linie glätten'), () => { fairLine(curLine, +C('rproFairTol') || 2); rb(); }));
    bf.appendChild(mkMini(T('Alle drei Linien glätten'), () => { for (const k of LINES) fairLine(k, +C('rproFairTol') || 2); rb(); }));
    bf.appendChild(mkMini(T('Nase abrunden'), () => { roundNose(); rb(); })).title = T('Anfangspunkt aller drei Linien: senkrechte Tangente, Länge so gewählt, dass die Nase ohne Wendepunkt in den Rumpf läuft (runde, stumpfe Nase). Danach die Nase über den zweiten Punkt jeder Linie formen.');

    const gk = grp('Krümmungsanalyse', false, 'rpro', { key: 'rproCurv' });
    hint(gk.body, 'Krümmungskamm: Zähne senkrecht zur Linie, Länge = Krümmung. Eine gute Linie hat eine ruhige, stetige Hüllkurve; Sprünge im Kamm = Krümmungssprung, Kamm wechselt die Seite = Wendepunkt (gelber Ring). Gilt für die Umrisse in Seiten-/Draufsicht und für den Querschnitt in der Spantansicht.');
    boolRow(gk.body, 'Krümmungskamm und Wendepunkte zeigen', () => !!C('rproComb'), v => { S('rproComb', v); draw(); });
    numRow(gk.body, 'Kammlänge (px)', () => C('rproCombLen'), v => { S('rproCombLen', clamp(v, 5, 300)); draw(); }, { step: 5, min: 5, max: 300, norender: true });
    selectRow(gk.body, '3D-Analyse', [['off', 'aus'], ['curv', 'Längskrümmung farbig (rot = gewölbt, blau = hohl)'], ['zebra', 'Zebra (Reflexionsstreifen)']], () => C('rproAna'), v => { S('rproAna', v); draw(); },
      'Längskrümmung: jede Längslinie der Fläche farbig nach ihrer Krümmung in Rumpfrichtung — ein blauer Fleck auf einem sonst roten Rumpf ist eine Delle (Wendepunkte). Zebra: Lichtstreifen wie auf lackierter Oberfläche; Knicke in den Streifen zeigen Krümmungssprünge, Streifen mit Versatz Tangentensprünge. Nur in der WebGL-Darstellung (fein/flach).');
    if (model && model.L) hint(gk.body, combInfo(['top', 'bot', 'w']));

    // --- Spanten ----------------------------------------------------------------------
    const g2 = grp('Spanten', true, 'rpro', { key: 'Rumpf: Spanten' });
    hint(g2.body, 'Spanten sind frei entlang X platziert (grünes Quadrat in Seiten-/Draufsicht ziehen, Doppelklick neben die Umrisse fügt einen ein). Jeder Spant hat eine Querschnittsform. Zwischen Spanten gleichen Typs werden die Parameter interpoliert, zwischen unterschiedlichen Typen wird die Form überblendet.');
    const ini = C('rproInit'), si = subhead(g2.body, 'Spanten neu anlegen');
    numRow(g2.body, 'Anzahl', () => ini.n, v => { ini.n = clamp(Math.round(v), 2, 200); }, { int: true, min: 2, max: 200, norender: true });
    numRow(g2.body, 'Abstand Nase → erster Spant (mm)', () => ini.dF, v => { ini.dF = Math.max(0, v); }, { step: 5, min: 0, norender: true });
    numRow(g2.body, 'Abstand letzter Spant → Heck (mm)', () => ini.dR, v => { ini.dR = Math.max(0, v); }, { step: 5, min: 0, norender: true });
    selectRow(g2.body, 'Form aller Spanten', Object.keys(TYPE_NAME).map(k => [k, TYPE_NAME[k]]), () => ini.type, v => { ini.type = v; });
    miniBar(g2.body).appendChild(mkMini(T('Spanten neu anlegen'), () => { if (confirm(T('Alle Spanten durch gleichmäßig verteilte neue ersetzen?'))) { initFormers(ini.n, ini.dF, ini.dR, ini.type); rb(); } }));
    void si;
    subhead(g2.body, T('Spantliste') + ' (' + fr.length + ')');
    const t2 = tbl(g2.body);
    const th2 = document.createElement('tr'); th2.innerHTML = '<th style="width:18px">#</th><th>X</th><th style="width:44%">' + T('Form') + '</th><th style="width:26%" title="' + T('Steuerwerte dieses Spants (Rest interpoliert)') + '">' + T('Steuer') + '</th>'; t2.appendChild(th2);
    const GN = { yw: 'yw', rt: 'R↑', rb: 'R↓', sl: '∠', dia: '⌀', vo: 'V↑', vu: 'V↓' };
    fr.forEach((f, i) => {
      const tr = document.createElement('tr'); if (i === sel) tr.style.background = 'rgba(255,120,120,.15)';
      const bad = model && model.bad && model.bad[i];
      const td0 = document.createElement('td'); td0.textContent = (i + 1) + (f.jmp === 'a' ? '▸' : f.jmp === 'b' ? '◂' : '') + (pinned(f) ? '🔒' : '') + (f.own ? '🖼' : ''); if (f.jmp) td0.title = T(f.jmp === 'a' ? 'Sprungstelle: Ende des vorderen Segments' : 'Sprungstelle: Anfang des hinteren Segments'); td0.style.cursor = 'pointer'; if (bad) { td0.style.color = '#f66'; td0.title = bad; } td0.onclick = () => { S('rproSel', i); lastSel = 'fr'; rb(); }; tr.appendChild(td0);
      const tdx = document.createElement('td'); tdx.appendChild(cellInp(r2(f.x), v => { moveFormerX(f, v); sortFormers(); rb(); })); tr.appendChild(tdx);
      const tdt = document.createElement('td'); tdt.appendChild(miniSel(Object.keys(TYPE_NAME).map(k => [k, { egg: 'Ei', tri: 'Dreieck', rect: 'Rechteck', circle: 'Kreis', free: 'frei' }[k]]), f.type, v => {
        if (v === 'free' && f.type !== 'free' && model && model.FN && model.FN[i]) f.nodes = JSON.parse(JSON.stringify(model.FN[i]));
        f.type = v; normFr(f); S('rproSel', i); rb();
      })); tr.appendChild(tdt);
      const tdc = document.createElement('td'); tdc.style.fontSize = '9px'; tdc.style.opacity = '.85';
      tdc.textContent = model && model.run ? PGROUPS[f.type].filter(g => isCtl(model, i, g)).map(g => GN[g]).join(' ') || '–' : '';
      tr.appendChild(tdc);
      t2.appendChild(tr);
    });
    const b2 = miniBar(g2.body);
    b2.appendChild(mkMini(T('+ Spant dahinter'), () => { const s2 = fr[sel].jmp === 'a' ? sel + 1 : sel, a = fr[s2], b = fr[s2 + 1]; insertFormer(b ? (a.x + b.x) / 2 : Math.min(o.top[o.top.length - 1].x, a.x + 50)); }));
    b2.appendChild(mkMini(T('− Spant löschen'), () => removeFormer(sel)));
    const ev = { a: 1, b: fr.length };
    const evRow = document.createElement('div'); evRow.className = 'row';
    const evl = document.createElement('label'); evl.textContent = T('Gleichmäßig verteilen von # bis #'); evRow.appendChild(evl);
    const evw = document.createElement('div'); evw.style.cssText = 'display:flex;gap:4px';
    const ia = cellInp(ev.a, v => { ev.a = v; }), ib = cellInp(ev.b, v => { ev.b = v; }); ia.style.width = '40px'; ib.style.width = '40px';
    evw.appendChild(ia); evw.appendChild(ib); evw.appendChild(mkMini(T('verteilen'), () => { spaceEvenly(ev.a - 1, ev.b - 1); rb(); })); evRow.appendChild(evw); g2.body.appendChild(evRow);

    // --- gewählter Spant ----------------------------------------------------------------
    const f = fr[sel];
    if (f) {
      const g3 = grp(T('Spant') + ' ' + (sel + 1), true, 'rpro', { key: 'rproSpSel' });
      numRow(g3.body, 'Lage X (mm)', () => f.x, v => { moveFormerX(f, v); sortFormers(); rb(); }, { step: 1, norender: true });
      boolRow(g3.body, 'X fix (Spant bleibt beim Ziehen an seiner Stelle)', () => !!f.xfix, v => { f.xfix = v; rb(); });
      boolRow(g3.body, 'Eigene Spantansicht (Zoom und Hintergrundbild nur für diesen Spant)', () => !!f.own, v => { setOwn(f, v); rb(); }, 'Ein: die Spantansicht merkt sich für diesen Spant eigenen Zoom und eigene Lage und zeigt ein eigenes Hintergrundbild (z. B. die Spantzeichnung genau dieser Station) mit eigenem Maßstab. Das Bild wird im Projekt mitgespeichert. Aus: gemeinsame Ansicht und gemeinsames Bild; die eigenen Einstellungen bleiben erhalten, bis das Bild entfernt wird.');
      miniBar(g3.body).appendChild(mkMini(T('Eigenes Hintergrundbild laden…'), () => { setOwn(f, true); S('rproView', 'sec'); buildSidebar(); draw(); loadImage('sec'); }));
      if (C('rproFix').fr) hint(g3.body, '🔒 ' + T('Alle Spanten sind fixiert (Gruppe „Fixieren“) — Änderungen an diesem Spant werden nicht übernommen.'));
      else boolRow(g3.body, 'Spant fixieren (Lage, Form, Höhe und Breite)', () => !!f.pin, v => { pinFormer(f, v); rb(); }, 'Der Spant bleibt, wie er ist: Lage, Querschnittsform (interpolierte Werte werden als Steuerwerte festgeschrieben) sowie Ober-/Unterkante und Breite der Umrisse an seiner Stelle. Ändern sich die Umrisse daneben, laufen sie durch den fixierten Spant.');
      // Sprungstelle (unstetiger Rumpf): eigener Spant für das vordere und das hintere Segment
      if (f.jmp) {
        hint(g3.body, f.jmp === 'a' ? 'Sprungstelle: dieser Spant schließt das vordere Segment ab; der nächste Spant (1 mm dahinter) beginnt das hintere. Form, Höhe und Breite beider Spanten sind unabhängig.' : 'Sprungstelle: dieser Spant beginnt das hintere Segment; der Spant davor (1 mm davor) schließt das vordere ab. Form, Höhe und Breite beider Spanten sind unabhängig.');
        const jb = miniBar(g3.body);
        jb.appendChild(mkMini(T(f.jmp === 'a' ? 'zum hinteren Spant' : 'zum vorderen Spant'), () => { const p = jumpPartner(f), k = fr.indexOf(p); if (k >= 0) { S('rproSel', k); S('rproCutX', p.x); } rb(); }));
        jb.appendChild(mkMini(T('Sprungstelle auflösen'), () => { clearJump(f); rb(); })).title = T('Beide Spanten bleiben als gewöhnliche Spanten stehen; der Übergang wird wieder geglättet.');
      } else {
        miniBar(g3.body).appendChild(mkMini(T('Sprungstelle hier (eigener Spant je Segment)'), () => { if (makeJump(sel)) S('rproCutX', fr[selIdx()].x); rb(); })).title = T('Für unstetige Rümpfe: an dieser Stelle bekommt das vordere und das hintere Segment je einen eigenen Spant (z. B. Beginn eines Lufteinlaufs, Absatz hinter der Haube, Rumpfhöcker). Der hintere Spant wird als Kopie angelegt und kann dann frei verändert werden.');
      }
      selectRow(g3.body, 'Querschnittsform', Object.keys(TYPE_NAME).map(k => [k, TYPE_NAME[k]]), () => f.type, v => {
        if (v === 'free' && f.type !== 'free' && model && model.FN && model.FN[sel]) f.nodes = JSON.parse(JSON.stringify(model.FN[sel]));
        f.type = v; normFr(f); rb();
      });
      if (model && model.bad && model.bad[sel]) hint(g3.body, '⚠ ' + model.bad[sel] + ' — ' + T('Wert wurde für die Form gekürzt.'));
      const P = model && model.P ? model.P[sel] : f.p;
      const runEnd = model && model.run ? (sel === model.runA[model.run[sel]] || sel === model.runB[model.run[sel]]) : false;
      const MN = { lin: 'linear', spl: 'Spline', abs: 'konstant (mm)', prop: 'proportional', line: 'gerade Kante' };
      // Parametergruppe: Steuerspant-Schalter, Werte, Interpolationsart (zum nächsten Steuerspant)
      const grpRow = (g, label, fields, tip) => {
        subhead(g3.body, label);
        const ctl = runEnd || !!f.ctl[g];
        const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;align-items:center;margin:2px 0;font-size:11px;flex-wrap:wrap';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = ctl; cb.disabled = runEnd; cb.title = runEnd ? T('Erster/letzter Spant eines Laufs gleichen Typs ist immer Steuerspant.') : T('Steuerspant: Wert hier festlegen (sonst aus den Nachbarn interpoliert).');
        cb.onchange = () => { if (cb.checked) makeCtl(sel, g); else f.ctl[g] = false; rb(); };
        const lb = document.createElement('span'); lb.textContent = T('Steuerspant'); row.appendChild(cb); row.appendChild(lb);
        if (PMODES[g].length > 1) {
          const ms = miniSel(PMODES[g].map(m => [m, MN[m]]), f.mode[g], v => { f.mode[g] = v; rb(); }, '120px');
          ms.title = T('Interpolation ab diesem Steuerspant bis zum nächsten: ') + T(tip || '');
          ms.disabled = !ctl; row.appendChild(ms);
        }
        g3.body.appendChild(row);
        for (const [key, lab] of fields) {
          const r = numRow(g3.body, lab, () => r2(ctl ? f.p[key] : P[key]), v => { makeCtl(sel, g); f.p[key] = v; rb(); }, { step: 0.5, norender: true });
          if (!ctl && r) { r.style.opacity = '.6'; r.title = T('interpoliert — Eingabe macht den Spant zum Steuerspant'); }
        }
      };
      if (f.type === 'egg') {
        hint(g3.body, 'Ei: obere und untere Ellipse treffen sich an der breitesten Stelle (Y). Typisch für moderne Segler.');
        grpRow('yw', T('Breiteste Stelle'), [['yw', 'Y der breitesten Stelle (mm)']], 'linear = gerade in der Seitenansicht, Spline = weicher Bogen durch die Steuerspanten');
      } else if (f.type === 'tri') {
        hint(g3.body, 'Gerundetes Dreieck bzw. Tropfen (z. B. Leitwerksträger der Libelle H 201): Spitze oben oder unten, je nachdem wo die breiteste Stelle liegt — tief = Spitze oben, hoch = Spitze unten. Völligkeit: 55 % = Ellipse (wie das Ei), kleiner = geradere Flanke und spitzere Ecke, größer = kastenförmiger. Öffnungswinkel unter 180° macht oben bzw. unten eine echte Spitze (Knick in der Symmetrieebene), z. B. 90° oben, 150° unten. Alle Werte lassen sich als Steuerspant festlegen oder werden zwischen den Spanten interpoliert.');
        grpRow('yw', T('Breiteste Stelle'), [['yw', 'Y der breitesten Stelle (mm)']], 'linear = gerade in der Seitenansicht, Spline = weicher Bogen durch die Steuerspanten');
        grpRow('vo', T('Völligkeit oben'), [['vot', 'an der Oberkante (%)'], ['vow', 'an der breitesten Stelle (%)'], ['vos', 'Spitze oben: Öffnungswinkel (°, 180 = rund)']]);
        grpRow('vu', T('Völligkeit unten'), [['vut', 'an der Unterkante (%)'], ['vuw', 'an der breitesten Stelle (%)'], ['vus', 'Spitze unten: Öffnungswinkel (°, 180 = rund)']]);
      } else if (f.type === 'rect') {
        hint(g3.body, 'Abgerundetes Rechteck bzw. Trapez: Ecken als Ellipsenviertel (X = in Breitenrichtung, Y = in Höhenrichtung). Die Breite aus der Draufsicht gilt auf halber Höhe; Neigung + = oben breiter.');
        grpRow('sl', T('Seitenneigung'), [['sl', 'Neigung zur Senkrechten (°)']]);
        grpRow('rt', T('Eckradien oben'), [['rtx', 'Radius X oben (mm)'], ['rty', 'Radius Y oben (mm)']], 'konstant = mm-Wert linear, proportional = mit der Spantgröße, gerade = Übergangskante läuft in X gerade');
        grpRow('rb', T('Eckradien unten'), [['rbx', 'Radius X unten (mm)'], ['rby', 'Radius Y unten (mm)']], 'konstant = mm-Wert linear, proportional = mit der Spantgröße, gerade = Übergangskante läuft in X gerade');
      } else if (f.type === 'circle') {
        hint(g3.body, 'Echter Kreis (z. B. Spinner-Anschluss). Ober-/Unterkante und Breite werden am Spant auf den Kreis gesetzt (Umrisspunkt wird bei Bedarf eingefügt), Seiten- und Draufsicht passen also immer zusammen.');
        grpRow('dia', T('Durchmesser'), [['dia', 'Durchmesser (mm, 0 = Mittel aus Höhe und Breite)']]);
      } else {
        hint(g3.body, 'Freie Form aus Bezier-Knoten (normiert auf den Umriss-Kasten). Knoten und Tangenten in der Spantansicht ziehen; Strg = Tangente einseitig (Ecke).');
        boolRow(g3.body, 'Form fixieren (nicht ziehbar)', () => !!f.lock, v => { f.lock = v; rb(); });
        const fb = miniBar(g3.body);
        fb.appendChild(mkMini(T('+ Knoten'), () => { addNode(f); rb(); }));
        fb.appendChild(mkMini(T('− Knoten'), () => { removeNode(f, selNode); rb(); }));
        fb.appendChild(mkMini(T('Abschnitt gerade ⇄ Kurve'), () => { const k = Math.min(selNode, f.nodes.length - 2); setStraight(f, k, !f.nodes[k].l); rb(); })).title = T('Strecke vom gewählten Knoten bis zum nächsten als gerade Linie (oder wieder als Kurve). Auch je Zeile in der Tabelle unten.');
        fb.appendChild(mkMini(T('Tangenten glätten'), () => { smoothNodes(f); straighten(f.nodes); rb(); }));
        fb.appendChild(mkMini(T('Form zurücksetzen (Kreisbögen)'), () => { f.nodes = circleNodes(0.5); rb(); }));
        fb.appendChild(mkMini(T('Vorlage gerundetes Dreieck'), () => { f.nodes = triNodes(PDEF, 0.25); rb(); })).title = T('Drei Knoten als gerundetes Dreieck (Spitze oben); danach Knoten ergänzen und ziehen.');
        hint(g3.body, 'Beliebig viele Knoten: „+ Knoten" teilt den längsten Abschnitt, Doppelklick auf die Kurve in der Spantansicht setzt einen Knoten genau dort, Entf löscht den gewählten. Haken „gerade“ = Strecke bis zum nächsten Knoten ist eine gerade Linie. Höhe/Breite in % des Umriss-Kastens (Höhe 0 = Unterkante, 100 = Oberkante; Breite 100 = halbe Breite aus der Draufsicht).');
        const tn = tbl(g3.body), thn = document.createElement('tr'); thn.innerHTML = '<th style="width:18px">#</th><th>' + T('Höhe %') + '</th><th>' + T('Breite %') + '</th><th title="' + T('Strecke von diesem Knoten bis zum nächsten als gerade Linie') + '">' + T('gerade') + '</th>'; tn.appendChild(thn);
        f.nodes.forEach((nd, k) => {
          const tr = document.createElement('tr'), end = k === 0 || k === f.nodes.length - 1; if (k === selNode) tr.style.background = 'rgba(255,210,122,.18)';
          const td0 = document.createElement('td'); td0.textContent = k + 1; td0.style.cursor = 'pointer'; td0.onclick = () => { selNode = k; rb(); }; tr.appendChild(td0);
          const ty = document.createElement('td'), iy = cellInp(r1(nd.y * 100), v => { nd.y = clamp(v / 100, 0.01, 0.99); straighten(f.nodes); rb(); }); iy.disabled = end || f.lock; ty.appendChild(iy); tr.appendChild(ty);
          const tz = document.createElement('td'), iz = cellInp(r1(nd.z * 100), v => { nd.z = Math.max(0, v / 100); straighten(f.nodes); if (model) renormFree(f, boxAt(model, f.x)); rb(); }); iz.disabled = end || f.lock; tz.appendChild(iz); tr.appendChild(tz);
          const tl = document.createElement('td'); tl.style.textAlign = 'center';
          if (k < f.nodes.length - 1) { const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!nd.l; cb.disabled = !!f.lock; cb.onchange = () => { setStraight(f, k, cb.checked); rb(); }; tl.appendChild(cb); }
          tr.appendChild(tl);
          tn.appendChild(tr);
        });
      }
      const fb2 = miniBar(g3.body);
      fb2.appendChild(mkMini(T('Spantansicht'), () => { S('rproView', 'sec'); rb(); }));
      fb2.appendChild(mkMini(T('Schnittansicht hier'), () => { const q = CUT(); q.on = true; q.axis = 'x'; q.a1 = 0; q.a2 = 0; S('rproView', 'cut'); S('rproCutX', f.x); rb(); })).title = T('Schnitt durch den Rumpf an der Lage dieses Spants, mit Anbauten.');
      fb2.appendChild(mkMini(T('Form auf alle Spanten gleichen Typs kopieren'), () => {
        if (!confirm(T('Werte dieses Spants auf alle Spanten gleichen Typs übertragen?'))) return;
        for (const q of fr) { if (q === f || q.type !== f.type) continue; if (f.type === 'free') { if (!q.lock) q.nodes = JSON.parse(JSON.stringify(f.nodes)); } else { q.p = Object.assign({}, q.p, f.p); if (f.type === 'egg' || f.type === 'tri') q.p.yw = null; q.ctl = Object.assign({}, f.ctl); } }
        rb();
      }));
      G.sp = g3.g;
    }

    const q = grp('Fläche & Anzeige', false, 'rpro', { key: 'Rumpf: Fläche & Anzeige' });
    numRow(q.body, 'Netz: Schritte um den Spant', () => C('rproNu'), v => { S('rproNu', v); rr(); }, { int: true, min: 6, max: 200, norender: true });
    numRow(q.body, 'Netz: Schritte längs', () => C('rproNv'), v => { S('rproNv', v); rr(); }, { int: true, min: 8, max: 1000, norender: true });
    selectRow(q.body, 'Darstellung', [['fine', 'fein (glatt, Glanz)'], ['flat', 'flach (Facetten)'], ['wire', 'Drahtmodell (verdeckte Kanten weg)'], ['2d', 'kompatibel (ohne WebGL)']], () => renderMode(), v => { S('rproRender', v); draw(); });
    colorRow(q.body, 'Farbe Rumpf', 'rproColBody'); colorRow(q.body, 'Farbe Seitenleitwerk', 'rproColFin'); colorRow(q.body, 'Farbe Tragflächenübergang', 'rproColAtt'); colorRow(q.body, 'Farbe Tragfläche', 'rproColWing');
    boolRow(q.body, 'Tragfläche aus dem Tragflächendesign zeigen', () => C('rproShowWing'), v => { S('rproShowWing', v); rr(); }, 'Nur Anzeige (nicht im STL). Braucht einen eingeschalteten Tragflächenübergang.');
    boolRow(q.body, 'Spantkurven in 3D zeigen', () => C('rproShowSt'), v => { S('rproShowSt', v); draw(); });

    {   // Hintergrundbild: immer sichtbar; in 3D-/Schnittansicht gilt die zuletzt benutzte 2D-Ansicht (Auswahl in der Gruppe)
      const v2d = C('rproView') !== '3d' && C('rproView') !== 'cut';
      if (v2d) imgKind = C('rproView');
      const kind = imgKind, key = IMG_KEY[kind], front = kind === 'sec';
      const own = front && ownFr();
      const b = grp(T('Hintergrundbild') + ' (' + (kind === 'side' ? T('Seitenansicht') : kind === 'top' ? T('Draufsicht') : own ? T('Spant') + ' ' + (selIdx() + 1) : T('Vorderansicht')) + ')', true, 'rpro', { key: 'rproImgGrp' });
      if (!v2d) selectRow(b.body, 'Bild für', [['side', 'Seitenansicht'], ['top', 'Draufsicht'], ['sec', 'Spantansicht']], () => imgKind, v => { imgKind = v; rb(); }, 'Das Bild wird in der gewählten 2D-Ansicht hinterlegt; „Bild laden…“ wechselt dorthin.');
      if (front) hint(b.body, own ? 'Dieser Spant hat eine eigene Spantansicht: Bild, Bildlage und Zoom gelten nur für ihn (Bild wird im Projekt mitgespeichert). Umschalten in der Gruppe „Spant n“.' : 'Gemeinsames Bild für alle Spanten ohne eigene Spantansicht. Eigenes Bild je Spant: in der Gruppe „Spant n“ „Eigene Spantansicht“ einschalten.');
      hint(b.body, front ? 'Spantzeichnung / Vorderansicht hinterlegen und die Form des gewählten Spants darüber einstellen. Maßstab = Bildbreite in mm; Lage per Zahlen, Alt+Ziehen (schieben) oder Alt+Rad (skalieren um den Mauszeiger).'
        : 'Zeichnung (Dreitafel) hinterlegen und die Umrisse darüber zeichnen. Maßstab = Bildbreite in mm (z. B. Rumpflänge); Lage per Zahlen, Alt+Ziehen (schieben) oder Alt+Rad (skalieren um den Mauszeiger).');
      const bb = miniBar(b.body);
      bb.appendChild(mkMini(T('Bild laden…'), () => { if (!v2d) { S('rproView', kind); rb(); } loadImage(kind); }));
      bb.appendChild(mkMini(T('Bild entfernen'), () => { img[kind] = null; S(key, null); imgTool = null; rb(); }));
      if (img[kind] && C(key)) {
        bb.appendChild(mkMini(T('⌂ Ansicht auf Rumpf + Bild'), () => { fit2d(kind); draw(); }));
        bb.appendChild(mkMini(T('Bild neu einpassen'), () => { imgDefault(kind); fit2d(kind); rb(); }));
      }
      const c = C(key);
      if (c && img[kind]) {
        hint(b.body, 'Bildwerkzeuge: „Verschieben" = Bild mit der linken Maustaste ziehen; Alt+Mausrad skaliert das Bild, Alt+Umschalt+Mausrad dreht es (das Mausrad allein zoomt immer die Ansicht). „Basispunkt" = im Bild die Rumpfspitze anklicken — das Bild springt mit diesem Punkt auf die Rumpfspitze des Modells, und jede Skalierung hält ihn fest. „Strecke" = im Bild eine bekannte Länge aufziehen (oder zwei Klicks) und ihre wahre Länge in mm eintragen; „Strecke waagrecht stellen" dreht das Bild danach (z. B. Rumpfachse). „Zuschneiden" = Rechteck über den gewünschten Bildteil aufziehen, der Rest wird ausgeblendet (Maßstab und Lage bleiben). Esc bricht ab. Bild oder Rumpf verloren? ⌂ (oben rechts im Ansichtsfenster, Taste Pos1) zeigt beides wieder ganz.');
        const tb = miniBar(b.body), tool = (id, txt) => { const btn = mkMini(T(txt), () => setImgTool(id)); if (imgTool === id) { btn.style.background = 'var(--accent,#5aa9ff)'; btn.style.color = '#000'; } tb.appendChild(btn); };
        tool('move', 'Verschieben'); tool('base', 'Basispunkt (Rumpfspitze)'); tool('ref', 'Strecke zeichnen'); tool('crop', 'Zuschneiden');
        if (c.bp || c.ref) {
          const ob = miniBar(b.body);
          if (c.bp) { ob.appendChild(mkMini(T('An Rumpfspitze ausrichten'), () => { imgAlignNose(kind); syncImgInputs(); draw(); })); ob.appendChild(mkMini(T('Basispunkt löschen'), () => { delete c.bp; rb(); })); }
          if (c.ref) ob.appendChild(mkMini(T('Strecke löschen'), () => { delete c.ref; rb(); }));
        }
        if (c.crop) miniBar(b.body).appendChild(mkMini(T('Zuschnitt aufheben'), () => { delete c.crop; rb(); }));
        if (!front) {
          const tr = TRC();
          subhead(b.body, 'Kontur automatisch nachzeichnen');
          hint(b.body, kind === 'side'
            ? 'Erst Maßstab und Lage des Bilds einstellen (Basispunkt, Strecke), dann „In den Rumpf klicken“ und im Bild auf eine Stelle im Rumpf klicken: Ober- und Unterkante werden erkannt und als Umrisspunkte gesetzt. Nase und Heck kommen aus dem Bild; Draufsicht und Spanten werden auf die neue Länge mitgenommen. Am besten wirkt eine Strichzeichnung oder ein Foto vor ruhigem Hintergrund.'
            : 'Erst Maßstab und Lage des Bilds einstellen, dann „In den Rumpf klicken“ und im Bild auf eine Stelle im Rumpf klicken: die halbe Breite wird erkannt und als Umrisspunkte gesetzt. Die Länge kommt aus der Seitenansicht — die erkannte Kontur wird auf Nase und Heck der Seitenansicht gestreckt.');
          hint(b.body, 'Orange = erkannte Kontur im Bild, rot hinterlegt = überbrückte Anbauten (Leitwerk, Tragfläche). Danach lässt sich alles wie gewohnt nachbearbeiten (Punkte ziehen, „Glätten“). Ergebnis falsch? „Rückgängig“ stellt Umrisse und Spanten wieder her.');
          if (state.cfg.rproImgVec && state.cfg.rproImgVec[kind]) hint(b.body, 'Bild aus der 3D-Bearbeitung: Nachgezeichnet wird exakt aus den mitgegebenen Konturlinien, und zwar nur der angeklickte Körper (Leitwerk oder Tragfläche als eigener Körper bleiben draußen). „Lücken schließen“, „Dünne Linien“ und „Schwelle“ wirken hier nicht.');
          const tb2 = miniBar(b.body);
          { const btn = mkMini(T('In den Rumpf klicken (nachzeichnen)'), () => setImgTool('trace')); if (imgTool === 'trace') { btn.style.background = 'var(--accent,#5aa9ff)'; btn.style.color = '#000'; } tb2.appendChild(btn); }
          if (traceUndo) tb2.appendChild(mkMini(T('Nachzeichnen rückgängig'), undoTrace));
          numRow(b.body, 'Genauigkeit (mm, 0 = automatisch)', () => tr.tol, v => { tr.tol = Math.max(0, v); }, { step: 0.1, min: 0, norender: true, hint: 'Größte Abweichung der Umrisslinie von der erkannten Kontur; es werden so lange Punkte eingefügt, bis sie passt. Automatisch = 2 Bildpixel.' });
          numRow(b.body, 'Höchstens Punkte je Linie', () => tr.max, v => { tr.max = clamp(Math.round(v), 4, 80); }, { int: true, min: 4, max: 80, norender: true });
          boolRow(b.body, 'Anbauten überbrücken (Leitwerk, Tragfläche)', () => !!tr.bridge, v => { tr.bridge = v; rb(); }, 'Steile Ausbuchtungen nach außen gehören nicht zum Rumpf: dort läuft die Linie glatt darunter durch. Eine steile Windschutzscheibe kann ebenfalls erfasst werden — dann den Winkel erhöhen oder ausschalten.');
          if (tr.bridge) numRow(b.body, 'Anbau ab Steigung (°)', () => tr.ang, v => { tr.ang = clamp(v, 10, 89); }, { step: 5, min: 10, max: 89, norender: true });
          numRow(b.body, 'Lücken in Linien schließen (px)', () => tr.gap, v => { tr.gap = clamp(Math.round(v), 0, 10); }, { int: true, min: 0, max: 10, norender: true, hint: 'Unterbrochene Umrisslinien (gestrichelt, verdeckt, Scanfehler) werden um so viele Bildpixel verdickt, damit die Kontur geschlossen ist.' });
          numRow(b.body, 'Dünne Linien entfernen (px)', () => tr.open, v => { tr.open = clamp(Math.round(v), 0, 15); }, { int: true, min: 0, max: 15, norender: true, hint: 'Maß-, Mittel- und Hilfslinien, die an den Rumpf stoßen, werden bis zu dieser Stärke weggenommen.' });
          numRow(b.body, 'Schwelle Farbabstand (0 = automatisch)', () => tr.thr, v => { tr.thr = clamp(Math.round(v), 0, 254); }, { int: true, min: 0, max: 254, norender: true, hint: 'Ab welchem Abstand zur Hintergrundfarbe (0…255) ein Pixel als Linie/Körper zählt. Automatisch nach Otsu.' });
          boolRow(b.body, 'Erkannte Kontur zeigen', () => !!tr.show, v => { tr.show = v; draw(); });
        }
        if (c.ref) numRow(b.body, 'Länge der Strecke (mm)', () => r1(imgRefMm(kind)), v => {
          const cur = imgRefMm(kind); if (!(v > 0) || !(cur > 0)) return;
          imgSetLen(kind, c.len * v / cur, imgToW(kind, c.ref.a)); syncImgInputs(); draw();
        }, { step: 1, min: 0.1, norender: true }).dataset.rpimg = 'ref';
        numRow(b.body, 'Bildbreite entspricht (mm)', () => c.len, v => { imgSetLen(kind, v); syncImgInputs(); draw(); }, { step: 10, min: 1, norender: true }).dataset.rpimg = 'len';
        numRow(b.body, 'Drehung (°, + = gegen den Uhrzeigersinn)', () => +c.rot || 0, v => { imgSetRot(kind, v); syncImgInputs(); draw(); }, { step: 0.5, norender: true, hint: 'Gedreht wird um den Basispunkt, ohne Basispunkt um die Bildmitte. Auch Alt+Umschalt+Mausrad, mit Strg in 0,1°-Schritten.' }).dataset.rpimg = 'rot';
        if (c.ref) { const rb2 = miniBar(b.body); rb2.appendChild(mkMini(T('Strecke waagrecht stellen'), () => { imgRefAlign(kind, 0); syncImgInputs(); draw(); })); rb2.appendChild(mkMini(T('Strecke senkrecht stellen'), () => { imgRefAlign(kind, 1); syncImgInputs(); draw(); })); }
        numRow(b.body, 'Bild links ' + (front ? 'Z' : 'X') + ' (mm)', () => c.x, v => { c.x = v; draw(); }, { step: 5, norender: true }).dataset.rpimg = 'x';
        numRow(b.body, 'Bild oben ' + (kind === 'top' ? 'Z' : 'Y') + ' (mm)', () => c.y, v => { c.y = v; draw(); }, { step: 5, norender: true }).dataset.rpimg = 'y';
        if (front) miniBar(b.body).appendChild(mkMini(T('Bild mittig (Z = 0)'), () => { c.x = -c.len / 2; syncImgInputs(); draw(); }));
        boolRow(b.body, 'Bild senkrecht spiegeln', () => !!c.flip, v => { c.flip = v; draw(); });
      }
      numRow(b.body, 'Deckkraft (%)', () => C('rproImgOp'), v => { S('rproImgOp', v); draw(); }, { step: 5, min: 0, max: 100, norender: true });
      G.img = b.g;
    }
    if (C('rproView') === 'cut') {
      const c = grp('Schnitt', true, 'rpro', { key: 'rproCutGrp' });
      hint(c.body, 'Schnittansicht wie im Formenbau: Ebene (X, Y oder Z), Lage und Darstellung im Bedienfeld links unten im Ansichtsfenster — „3D aufgeschnitten“ oder „2D-Schnitt“. Die Ebene lässt sich frei drehen und neigen (Winkel); „DXF…“ speichert die Schnittkontur der eingestellten Ebene. Die Spanten selbst werden in der Spantansicht bearbeitet.');
      const bb = miniBar(c.body);
      bb.appendChild(mkMini(T('Zum gewählten Spant'), () => { const q = CUT(); q.axis = 'x'; q.a1 = 0; q.a2 = 0; S('rproCutX', fr[sel].x); rb(); }));
      bb.appendChild(mkMini(T('Schnitt als DXF…'), exportCutDxf));
      G.cut = c.g;
    }
    const fa = document.createDocumentFragment(); attachSidebar(fa, rr, rb); G.wing = fa.children[0]; G.fin = fa.children[1];
    const fv = document.createDocumentFragment(); vtSidebar(fv, rr, rb); G.vt = fv.children[0];
    const fb = document.createDocumentFragment(); boomSidebar(fb, rr, rb); G.boom = fb.children[0];
    {
      const kh = KH(), gh = grp('Kabinenhaube', !!kh.on, 'rpro', { key: 'rproKhGrp' });
      hint(gh.body, 'Kabinenhaubenausschnitt in der Seitenansicht, quer durch den Rumpf: vordere, untere und hintere Linie (gerade oder als Spline gewölbt) mit Übergangsradien — bemaßt wie der Kabinenhaubenausschnitt im Reiter „Ausschnitte". Die Haube bekommt in 3D eine eigene Farbe und wird so auch im Reiter „Decals" gezeigt. In der Seitenansicht ziehen: gelbe Griffe = Ecken, Linienenden (Winkel) und Wölbung.');
      boolRow(gh.body, 'Kabinenhaube ausschneiden', () => !!kh.on, v => { kh.on = v; if (v && kh.x == null && model && model.x1 > model.x0) kh.x = r1(model.x0 + 0.2 * (model.x1 - model.x0)); rb(); });
      if (kh.on) {
        colorRow(gh.body, 'Farbe Kabinenhaube', 'rproColKh');
        boolRow(gh.body, 'Kabinenhaube in 3D ausblenden', () => !!C('rproKhHide'), v => { S('rproKhHide', v); draw(); }, 'Zeigt den Rumpf mit offenem Ausschnitt (Blick ins Innere); eine eingeschaltete Sicke erscheint dann als abgesetzter Rand mit Stufenlinien. Nur Anzeige — Export und Decals bleiben unverändert. Auch als Schalter im 3D-Fenster unter dem Ansichtswürfel.');
        const nr = (label, key, o) => numRow(gh.body, label, () => kh[key], v => { kh[key] = v; rb(); }, Object.assign({ step: 1, norender: true }, o || {}));
        selectRow(gh.body, 'Art der Schnittlinie', [['std', 'drei Linien (vorne, unten, hinten)'], ['free', 'freier Linienzug (Geraden, Splines, Profil)']], () => kh.mode === 'free' ? 'free' : 'std',
          v => { if (v === 'free' && !(Array.isArray(kh.pts) && kh.pts.length >= 2)) khToFree(kh, model && model.kh, model); kh.mode = v; rb(); },
          'Freier Linienzug: beliebig viele Punkte, je Abschnitt gerade, Spline oder Seite eines Tragflächenprofils — z. B. für den Haubenausschnitt einer Libelle. Beim ersten Umschalten werden die drei Linien übernommen.');
        if (kh.mode === 'free' && Array.isArray(kh.pts) && kh.pts.length >= 2) {
          khFreeSidebar(gh.body, kh, rb);
          miniBar(gh.body).appendChild(mkMini(T('Aus den drei Linien neu anlegen'), () => { const m0 = kh.mode; kh.mode = 'std'; let q = null; try { q = canopyGeom(model); } catch (e) {} kh.mode = m0; khToFree(kh, q, model); khSel = 0; rb(); })).title = T('Verwirft den freien Linienzug und übernimmt wieder die drei Linien (vorne, unten, hinten) als Ausgangsform.');
        } else {
        nr('Vordere Ecke: Lage X (mm)', 'x', { step: 5 });
        nr('Tiefe unter der Oberkante (mm)', 'depth', { min: 0.5 });
        nr('Länge der unteren Linie (mm)', 'len', { step: 5, min: 5 });
        nr('Neigung der unteren Linie (°)', 'slope', { min: -60, max: 60, hint: '+ = hinten höher.' });
        nr('Winkel vorne (°)', 'angF', { min: 10, max: 170, hint: 'Winkel der vorderen Linie zur Waagrechten: klein = flach nach vorne auslaufend, 90 = senkrecht.' });
        nr('Winkel hinten (°)', 'angR', { min: 10, max: 170 });
        nr('Radius vorne (mm)', 'radF', { min: 0 });
        nr('Radius hinten (mm)', 'radR', { min: 0 });
        for (const [sx, name] of [['F', 'Vordere Linie'], ['B', 'Untere Linie'], ['R', 'Hintere Linie']]) {
          selectRow(gh.body, name, [['line', 'gerade'], ['spline', 'Spline (gewölbt)']], () => kh['type' + sx], v => { kh['type' + sx] = v; rb(); });
          if (kh['type' + sx] === 'spline') { nr('Wölbung (mm)', 'curv' + sx); nr('Lage der Wölbung (%)', 'pos' + sx, { step: 5, min: 10, max: 90 }); }
        }
        }
        nr('Stärke der Kabinenhaube (mm)', 'glass', { step: 0.1, min: 0, hint: 'Wandstärke der Haube (Klarsicht tiefgezogen etwa 0,5–1 mm, laminiert dicker). Der Haubenrahmen liegt um diesen Betrag unter der Rumpfhaut, die automatische Sickentiefe rechnet damit, und der Tiefziehklotz im Reiter „Rumpf Formenbau" wird um diesen Betrag kleiner (Innenseite der Haube) — so sitzt die Haube außen bündig.' });
        subhead(gh.body, 'Sicke (Auflage für die Haube)');
        boolRow(gh.body, 'Sicke um den Ausschnitt', () => !!kh.skOn, v => { kh.skOn = v; rb(); }, 'Der Rumpf bekommt rund um den Ausschnitt einen nach innen abgesetzten Rand, auf den die Haube (bzw. der Haubenrahmen) aufgesetzt wird. Wirkt beim Export „Form als STL" mit Bauteil „Rumpf ohne Kabinenhaube" (alle Formtypen); in der Seitenansicht gestrichelt gezeigt.');
        if (kh.skOn) {
          nr('Anzahl Stufen', 'skN', { int: true, min: 1, max: 6 });
          nr('Höhe je Stufe (mm)', 'skW', { step: 0.5, min: 0.1, hint: 'Breite des abgesetzten Streifens, gemessen in der Seitenansicht ab der Schnittlinie in die Haube hinein.' });
          boolRow(gh.body, 'Vertiefung automatisch (Haube + Rahmen)', () => !!kh.skAuto, v => { kh.skAuto = v; rb(); }, 'Gesamttiefe der Sicke = Stärke der Kabinenhaube, mit Haubenrahmen zusätzlich Rahmenstärke + Spiel, gleichmäßig auf die Stufen verteilt. Dann liegen Haube und Rahmen außen bündig mit dem Rumpf.');
          if (kh.skAuto) hint(gh.body, T('Vertiefung je Stufe:') + ' ' + (sickeAutoDepth() / clamp(Math.round(+kh.skN || 1), 1, 6)).toFixed(2) + ' mm');
          else nr('Vertiefung je Stufe (mm)', 'skD', { step: 0.1, min: 0.05, hint: 'Um so viel liegt jede Stufe tiefer (nach innen) als die vorige — die Wandstärke der Haube (Klarsichthaube etwa 0,5 mm), damit sie außen bündig sitzt.' });
          nr('Entformungsschräge der Stufe (°)', 'skA', { step: 5, min: 0, max: 80, hint: '0 = senkrechte Stufe (schlecht zu entformen). Größer = die Stufe läuft als Schräge aus, das Bauteil löst sich aus der Form.' });
        }
        subhead(gh.body, 'Haubenrahmen');
        const fr = FRM();
        boolRow(gh.body, 'Haubenrahmen erzeugen', () => !!fr.on, v => { fr.on = v; if (v) { kh.skOn = true; kh.skAuto = true; } rb(); }, 'Rahmen rund um den Ausschnitt, auf den die Haube geklebt wird. Er liegt in der Sicke des Rumpfs und übernimmt deren Stufen und Schrägen — so passt er genau auf den Rumpf. Außen liegt er um die Haubenstärke unter der Rumpfhaut. Beim Einschalten werden Sicke und automatische Vertiefung mit eingeschaltet. Im 3D-Fenster bei ausgeblendeter Haube sichtbar; der Reiter „Cockpit" nimmt diesen Rahmen für „Pilz am Haubenrahmen".');
        if (fr.on) {
          const nf = (label, key, o) => numRow(gh.body, label, () => fr[key], v => { fr[key] = v; rb(); }, Object.assign({ step: 0.5, norender: true }, o || {}));
          nf('Höhe des Rahmens (mm)', 'h', { min: 1, hint: 'Gemessen in der Seitenansicht ab der Schnittlinie in die Haube hinein (wie die Höhe der Sicke). In der Seitenansicht strichpunktiert gezeigt.' });
          nf('Stärke des Rahmens (mm)', 't', { step: 0.1, min: 0.3, hint: 'Wandstärke oberhalb der Sicke. Auf der Sicke ergibt sich die Stärke aus deren Vertiefung (automatisch: genau diese Stärke).' });
          nf('Spiel zur Sicke (mm)', 'play', { step: 0.05, min: 0, hint: 'Luft zwischen Rahmen und Rumpf: Rahmenkante und Stufen rücken um diesen Betrag vom Rumpf weg, die Auflage liegt um diesen Betrag höher.' });
          colorRow(gh.body, 'Farbe Haubenrahmen', 'rproColFr');
          const fsp = frameSpec();
          if (fsp && fsp.err) hint(gh.body, '⚠ ' + fsp.err);
          else if (fsp) { if (fsp.s0 > 0.05) hint(gh.body, T('Der Rahmen beginnt') + ' ' + fsp.s0.toFixed(2) + ' ' + T('mm hinter der Schnittlinie (davor wäre er dünner als 0,2 mm).')); fsp.warn.forEach(w => hint(gh.body, '⚠ ' + w)); }
          const mb = miniBar(gh.body);
          mb.appendChild(mkMini(T('Haubenrahmen als STL…'), exportFrameStl));
          mb.appendChild(mkMini(T('Im 3D zeigen'), () => { fr.show = true; S('rproKhHide', true); S('rproView', '3d'); rb(); }));
        }
        const q = model && model.kh;
        if (q && q.err) hint(gh.body, '⚠ ' + q.err);
        if (q && q.warns) q.warns.forEach(w => hint(gh.body, '⚠ ' + w));
        miniBar(gh.body).appendChild(mkMini(T('Seitenansicht'), () => { S('rproView', 'side'); rb(); }));
      }
      G.kh = gh.g;
    }
    const x = grp('Export', false, 'rpro', { key: 'Rumpf: Export' });
    selectRow(x.body, 'Achsen im STL (ganzer Rumpf)', [['z', 'Z hoch (Druck / Fräse)'], ['y', 'Y hoch (wie im Programm)']], () => C('rproUp'), v => { S('rproUp', v); });
    const eb = miniBar(x.body);
    eb.appendChild(mkMini(T('Rumpf als STL…'), exportStl));
    eb.appendChild(mkMini(T('Spantkonturen als DXF…'), exportAllSectionsDxf));
    hint(x.body, 'Spantkonturen: reine Außenkontur je Spant. Spanten zum Bauen (Beplankungsabzug, Gurte, Leichterung, Helling) im Reiter „Rumpf Spanten".');
    subhead(x.body, 'Form als STL (wie DevFus)');
    const mc = C('rproMold');
    selectRow(x.body, 'Formtyp', [['halfNeg', 'Negativform: Halbschale im Block'], ['halfPos', 'Positiv: Halbschale auf Block'], ['halfShell', 'Halbschale geschlossen'], ['full', 'ganzer Rumpf (Positiv)']], () => mc.type, v => { mc.type = v; buildSidebar(); });
    if (model && model.kh && model.kh.N) selectRow(x.body, 'Bauteil', [['all', 'Rumpf mit Kabinenhaube (ein Stück)'], ['fus', 'Rumpf ohne Kabinenhaube'], ['kh', 'nur Kabinenhaube']], () => moldPart(), v => { mc.part = v; },
      'Eigene Formen für Rumpf und Haube: Form zweimal ausgeben — einmal „Rumpf ohne Kabinenhaube", einmal „nur Kabinenhaube". Die Schnittfläche ist eine ebene Wand entlang der Schnittlinie; der Block der Haubenform richtet sich nur nach der Haube.');
    if (mc.type !== 'full') {
      selectRow(x.body, 'Seite', [['r', 'rechts'], ['l', 'links']], () => mc.side, v => { mc.side = v; });
      numRow(x.body, 'Extrusion unter der Trennebene (mm)', () => mc.ext, v => { mc.ext = Math.max(0, v); }, { step: 1, min: 0, norender: true, hint: 'Setzt die Halbschale um diesen Betrag auf (Rand zum Abziehen/Verkleben), wie in DevFus.' });
      if (mc.type !== 'halfShell') {
        numRow(x.body, 'Blockrand um den Rumpf (mm)', () => mc.margin, v => { mc.margin = Math.max(0, v); }, { step: 5, min: 0, norender: true });
        numRow(x.body, mc.type === 'halfNeg' ? 'Wandstärke hinter dem tiefsten Punkt (mm)' : 'Blockdicke unter der Trennebene (mm)', () => mc.base, v => { mc.base = Math.max(1, v); }, { step: 1, min: 1, norender: true });
      }
    }
    miniBar(x.body).appendChild(mkMini(T('Form als STL…'), exportMold));
    hint(x.body, 'Formen enthalten die eingerechneten Anbauten (Tragflächenübergang, Seitenleitwerk). Hinterschneidungen werden nicht geprüft.');
    // Arbeitsreihenfolge: Vorlagen → Hintergrundbild → Umrisse → Spanten → Anbauten (Rumpfboot zuletzt) → Ansicht/Analyse → Export
    for (const el of [g0.g, G.img, g1.g, g2.g, G.sp, gfx.g, G.kh, G.wing, G.fin, G.vt, G.boom, q.g, gk.g, G.cut, x.g]) if (el) side.appendChild(el);
  }

  // Schnittstelle für „Rumpf Spanten" (rproSpanten.js): Spanten und Querschnitte des aktuellen Modells.
  function api() {
    if (!model || !model.P) build();
    if (!model || model.err || !model.FR) return null;
    return {
      model,
      formers: () => model.FR.map((f, i) => ({ i, x: f.x, type: f.type, bad: model.bad[i] || '' })).filter(f => !model.boom || f.x <= model.x1 + 1e-6),   // Rumpfboot: nur bis zum Übergang
      bodyHalf: x => bodyHalf(model, x),          // [[y,z],…] oben -> unten, nur Rumpf
      fullHalf: x => halfAt(model, x).map(q => [q[0], q[1]]),   // inkl. Anbauten
      box: x => boxAt(model, x),
      outline: (line, x) => lineAt(model.L[line], x),
      // Kabinenhaube (z. B. für „Decals"): Farbe, Schnittlinie [[x,y],…], Höhenabschnitte der Haube je Schnitt x
      canopy: model.kh && model.kh.N ? { col: colOf(4), line: model.kh.N, x0: model.kh.x0, x1: model.kh.x1, spans: model.kh.spans, sd: model.kh.sd, sicke: sicke(), glass: Math.max(0, +KH().glass || 0), frame: frameApi() } : null,
      // Rumpfboot + Leitwerksrohr (für den Wickeldorn im Reiter „Rumpf Formenbau"): Achse ab (xT, yc), Neigung a (rad),
      // Radius außen R(s) = r0 + k·s für s = 0…len, Wandstärke/Abzug t (Dorn = R − t)
      boom: model.boom ? (({ xT, yc, a, k, r0, r1, len, t, play, Ls, rs0 }) => ({ xT, yc, a, k, r0, r1, len, t, play, Ls, rs0, col: colOf(5) }))(model.boom) : null,
      x0: model.x0, x1: model.x1, bounds: model.bounds
    };
  }
  Object.assign(App, { rproSidebar });
  window.RumpfPro = { show, refresh, resize, draw, build, api, histReset, histMarkSaved, undo: () => histStep(true), redo: () => histStep(false), fromMesh, canopyFromMold, setBackground, setFormerFromSection, frameOf, exportStl, exportMold, exportSectionDxf, exportAllSectionsDxf, sectionAt,
    _dbg: () => ({ handles: handles(C('rproView')), xf: xf2, canvas, model, halfAt: x => halfAt(model, x), filLoftSec, filProjBase, ringRound, projOffset, traceRaw, runTrace, bridgeBumps, hist, scr: (x, y, z) => scr(x, y, z), size: () => [W, H], setCam: c => { Object.assign(cam, c); draw(); }, setImg: (kind, src) => new Promise(res => { const im = new Image(); im.onload = () => { img[kind] = im; if (!C(IMG_KEY[kind])) S(IMG_KEY[kind], { len: 100, x: 0, y: 0, flip: false }); buildSidebar(); draw(); res(true); }; im.src = src; }) }),
    _test: { meshStation, canopyCap, canopyEdge, cavZ, fitKhLine, fitNodes, fitFixed, ywMid, fitOutLine, sliceSoup, boomGeom, coneRing, boomRoundHeck, makeJump, clearJump, moveFormerX, applyHandle, setOutAt, bez2, solveT, splitBez, outSegs, lineAt, polyOf, circleNodes, rectNodes, secParams, sectionNodes, boxAt, meshFromGrid, resampleRing, halfAt, fromStations, applyTemplate, moldTris, TPL, canopyGeom, khFoil, khToFree, triNodes, KH, partGrid, sickeTris, sickeMesh, frameSpec, frameTris, frameGeo, FRM, setFix, pinFormer, widAt, enforceFix, renormFree, syncCircleOutlines, widLine } };
})();
