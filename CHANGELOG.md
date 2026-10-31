# Changelog

Alle nennenswerten Änderungen an **AI Foam Cut** werden hier dokumentiert.
Format angelehnt an [Keep a Changelog](https://keepachangelog.com/de/).
Neueste Einträge oben.

## [1.98] — 2026-10-31
### 3D-Modell: Abbrand korrigiert (Maßänderung!), scharfe Ecken
- **Abbrand-Versatz korrigiert:** Bisher wurde auf Geraden nur etwa zwei Drittel des Soll-Versatzes ausgeglichen. Die Schnittspur liegt jetzt um den vollen halben Abbrand versetzt, Teile ändern dadurch ihr Maß gegenüber alten G-Codes. Ecken laufen als echte Gehrung, auch wenn ein Synchronpaar knapp neben einer Ecke liegt.
- Die echten Ecken der Schnittprofile bleiben in der Bahn erhalten (zusätzliche Bahnpunkte, die Punktzahl kann leicht über der Vorgabe liegen). Gegenüberliegende Ecken von A und B werden ohne Synchronpaare automatisch einander zugeordnet.
- Gruppe „Synchronpunkte“: **„Profile auseinanderziehen (nur Anzeige)“** mit Versatz B waagerecht/senkrecht; wahre Lage, Synchronpaare und G-Code bleiben unverändert.

### Strg+Z in allen Zeichen- und Bearbeitungsreitern
- Rückgängig über bis zu 100 Schritte (Strg+Z) und Wiederholen (Strg+Y bzw. Strg+Umschalt+Z) in Rumpf, Fräse, Ausschnitte, Schriften, Formenbau (auch Winglet-Zeichnung) und 3D-Modell (Segmentpaar-Punkte, Platte). Der Verlauf gilt je Reiter und endet beim Laden eines Projekts oder beim Wechsel der Tragfläche.
- CAD und DXF-Formen: Strg+Z greift auch, wenn das leere Koordinatenfeld den Fokus hat; beim laufenden Zeichnen geht es Punkt für Punkt zurück.

### Negativschalendesign: Holmausschnitte im Kern
- Neues Menü **„Holmausschnitte im Kern“** (mit „Kern mitschneiden“): Holme werden wie im Kerndesign während des Schnitts in die Kernbahn eingerechnet (Anfahr-Schlitz, um die Tasche, zurück). Gurttaschen sind ausgenommen.
- Kern in Stege zerteilt: je Holm Kernteil (automatisch oder fest) und Lage in % der Stegbreite; der Holm wird mit seinem Steg verschoben geschnitten. Holme über die Stegflanke werden übersprungen und gemeldet.
- Kompletter Holm-Editor samt Abbrand, als eigene Holmliste je Tragfläche, getrennt von Kerndesign und Tragflächendesigner.

### DXF-Formen
- Schalter **„Linke Profilseite hinten“**: Die linke Seite der Zeichnung liegt im G-Code hinten, wie im 3D-Modell. Blockzugabe, feste Blocklänge, Blockzuschnitt, Anfahrt und Startpunkt-Automatik folgen.
- Schalter **„Profile auseinanderziehen (nur Anzeige)“** in der Gruppe „Synchronpunkte“; wahre Lage, Synchronpaare und G-Code bleiben unverändert.
- 3D-Ansicht der geschnittenen Segmente: INNEN steht links, AUSSEN rechts (vorher seitenverkehrt).

### Formenbau
- Winglet (parametrisch): **„Schwung Endleiste“** und **„Lage der Auswölbung Endleiste“**, passend zur Nasenleiste.

## [1.97] — 2026-10-27
### Ausschnitte: Rechteck, mehrere Ausschnitte, Segmente als Bezug
- Neue Art **„Rechteckausschnitt“**: Breite, Höhe, Eckenradius, Drehwinkel; Lage zur Blockkante oder mittig; Block (Loch) oder Rechteckstück bleibt stehen.
- **Mehrere Ausschnitte je Projekt** (Gruppe „Ausschnitte im Projekt“: Neu, Kopieren, Löschen, Reihenfolge). Optional **alle im selben Block**; der G-Code schneidet alle nacheinander oder nur den gewählten.
- **Segment als Bezug**: Segmente aus **DXF-Formen** oder dem **3D-Modell** (ohne vorheriges „Zerlegen“) als Kopie laden, über **„Weitere Segmente“** auch mehrere derselben Quelle, lagerichtig hintereinander. Lage quer (Seiten-/Draufsicht) oder längs, umdrehbar; Block und Umriss kommen von den Segmenten, „Neu laden“ holt den aktuellen Stand.
- **3D-Vorschau** mit Block, Segmenten und Ausschnitten.
- Das Bezugssegment gilt für alle Ausschnitte des Projekts; 2D-Ansicht und 3D-Vorschau zeigen immer alle Ausschnitte (aktiver kräftig, übrige blass mit Nummer/Name).
- Neue Bezüge: Kabinenhaube „Höhe bezogen auf“ Blockober- oder -unterkante, Tragfläche auf Nase oder tiefsten Profilpunkt, mit Bezugssegment „Lage in X“ ab Blockseite oder Beginn des ersten Segments.

### Rippendesigner: schräge Wurzelrippe
- „Wurzelrippe schräg (°)“ bzw. Einrückung von Nase oder Endleiste in mm, dazu „parallel eingerückt (mm)“ — z. B. für eine Rumpfeinschnürung. Die Schräge geht immer zu Lasten des Werkstücks; die Rippe ist der wahre Schnitt, Holmausschnitte sitzen richtig. Gilt auch für Nasenschablonen, Rippen-STL, CAD-Bearbeitung und Fräse.

### Tragflächendesigner: Strak-Profile
- Schalter **„Strak-Profil (aus Nachbarprofilen gemischt)“** je Segment: Mischung aus dem nächsten gegebenen Profil innen und außen nach Spannweitenlage, wird automatisch nachgeführt. „Profil bearbeiten…“ bleibt möglich. Der .pc2-Import legt Straks aus dem Planform Creator entsprechend an und holt Profile direkt aus der Profildatenbank.
- Bemaßung zeigt zusätzlich die **gesamte Halbspannweite**.

### 3MF-Export mehrerer Teile
- Bei Exporten mit mehreren Teilen in der STL-Vorschau wählbar: **3MF – eine Datei, Teile getrennt** (Standard) oder STL je Teil. Gilt für Formenbau, 3D-Modell sowie neu für Rippen und Nasenschablonen (bisher eine zusammengeworfene STL).

### Formenbau
- Winglet (parametrisch): **„Schwung Nasenleiste“** und **„Lage der Auswölbung“** für eine geschwungene Nasenleiste.
- Schalter **„Gespiegelte Seite zeigen“** (nur Vorschau).

### G-Code: Werkstoff immer im Kopf
- Jeder Heißdraht-G-Code nennt im Kopf den Werkstoff, auf den sich Vorschub und Drahtheizung beziehen — für alle Quellen und Blockzuschnitt-Befehle.

## [1.96] — 2026-10-23
### Werkstoff frei zuordnen
- Neuer Schalter **„Werkstoff frei zuordnen“** oben im Reiter Projektübersicht. Ist er an, wird der Werkstoff im Reiter **G-Code** direkt unter Quelle, Tragfläche und Segment gewählt; die Dicke kommt aus Kerndesign bzw. Negativschalendesign.
- Kerndesign (Gruppe jetzt **„Blockgeometrie“**) und Negativschalendesign: Blockhöhe **für alle Segmente gleich** oder **je Segment separat** (eigenes Feld in jeder Segmentkarte). Vorschau, Blockprüfung, Simulation und G-Code rechnen mit der Höhe des jeweiligen Segments.
- Reiter **Schneiden**, Blockzuschnitt: **Guillotine**, **Block ablängen** und **Block horizontal** haben je ein eigenes Menü **Werkstoff** (immer frei wählbar); Standard „wie G-Code-Quelle (…)“.
- Tragflächendesign, „Anzeige“: bei eingeschaltetem Styroporblock ein Feld **„Blockhöhe (mm, nur Konstruktion)“** — wirkt nur auf Ansicht und Randwarnung im Tragflächendesign.
- Schalter aus = alles wie bisher; die Werte bleiben beim Umschalten erhalten.

### CAD-Bearbeitung: PDF-Export auf mehrere Blätter, Druckvorschau
- Neu im Block Export: **„Als PDF exportieren“** — echte Vektor-PDF im gewählten Maßstab (Standard 1:1), Papierformat A4 … A0, Letter, Tabloid, hoch/quer oder automatisch (wenigste Blätter).
- Übergroße Zeichnungen werden gekachelt: einstellbare **Überlappung** mit **Passkreuzen** zum Übereinanderlegen und Kleben; jedes Blatt mit Bezeichnung (A1, A2 … B1 …), Maßstab, Nachbarblättern und 100-mm-Prüfmaß, vorne ein **Übersichtsblatt** mit Klebeplan. Leere Blätter entfallen.
- Optionen: Rand, Linienbreite, Layerfarben oder schwarz; Linienarten und Texte werden übernommen. **„Blattaufteilung in der Ansicht zeigen“** blendet das Blattraster im CAD-Fenster ein.
- **„🔍 Druckvorschau…“**: alle Blätter genau wie in der PDF, Miniaturen links, Zoom/Verschieben, Einstellungen direkt umstellbar, Export aus der Vorschau.
- Beim Drucken „Tatsächliche Größe“ / 100 % wählen.

### Englische Oberfläche
- Fehlende Übersetzungen nachgetragen (u. a. „Kern zerteilen (Stege)“, Holmausschnitte, Negativschale, Profildatenbank/KFm-Gestalter, 3D-Modell Platte/Stapeln, Schneiden, G-Code-Kommentare); zusammengesetzte Texte werden jetzt stückweise übersetzt.

## [1.95] — 2026-10-21
### 3D-Modell: Synchronpunkte von Hand, Punktnummern, Menüs wie DXF-Formen
- Neuer Abschnitt **Synchronpunkte** im 3D-Modell: in der Ansicht „◫ Segmentpaar“ erst einen Punkt auf Sollkontur A, dann den zugehörigen auf B anklicken (Fang an Stützpunkten, sonst an der Kante; Esc verwirft). Zwischen den Paaren laufen A und B gleichmäßig nach Bogenlänge — so liegen Ecken, Kanten und Nasen aufeinander und der Draht verdrillt nicht. Paare gelten je Segmentpaar, auch auf Löchern, und werden im Projekt gespeichert (`modelGcode.segSync`). Überkreuzte Paare werden rot markiert und ignoriert.
- **⟳ Synchronpunkte automatisch** (bzw. für alle Segmente) mit derselben Automatik wie bei den DXF-Formen, Paarliste mit **◎ als Startpaar**, **Pkt je Intervall** und ✕; **Punktverteilung**: Punkte gesamt oder Punktdichte (Pkt/mm).
- **Punktnummern alle n Punkte**: jeder n-te Punkt der Schnittbahn auf A und B mit Nummer und Drahtlinie.
- Geprüft: Quader → um 45° gedrehte Raute: automatische Zuordnung verfehlt die Ecken um 26–39 mm, mit 4 Paaren unter 1 mm.
- Menüs wie bei den DXF-Formen gegliedert: „Heißdraht-G-Code“ → „Synchronpunkte“ → „Schnitt“ (Umlaufrichtung, **Abbrand kompensieren** an/aus, Schnittspur, Anfahrpunkt) → „Punkte bearbeiten“.
- **Anfahrt von** hinten/oben/vorne/unten mit Abstand zur Blockfläche, **Anfahrt/Ausfahrt sicher**, **Blockzuschnitt** vor/nach dem Formschnitt oder nur Blockschnitt (gleiche Einstellung wie DXF-Formen) und neue **Blockzugabe rundum**. Der G-Code ist kommentiert.
- **Ansichtsmenü** (verschiebbar, wie im Kerndesign) in „◫ Segmentpaar“, in den DXF-Formen und in „▤ Platte“: Konturen, Schnittspur, wahre Dicke, Block, Startpunkt, Synchronpaare, Punktnummern, Fahrwege, Legende.
- Anfahrpunkt per Klick nur noch nach **„▶ Anfahrpunkt wählen“** (Esc bricht ab).

### DXF-Formen: Einstich wieder auf Synchronpunkt 1
- Der Schnitt begann sporadisch nicht am Startpaar, sondern an einer anderen Stelle der Kontur (bei senkrechter Hinterkante entschied Rundungsrauschen). Mit Synchronpunkten legt jetzt immer das Startpaar den Einstich fest; „Anfahrt/Ausfahrt sicher“ wählt den Start nur noch ohne Synchronpunkte.
- Synchronpaar-Liste: die Beschriftung „Paar k: innen … ↔ außen …“ ist wieder sichtbar.

### G-Code: Knopf zurück zur Quelle
- Unter der Simulation springt **„↩ <Reiter>“** direkt in den Reiter der gewählten G-Code-Quelle.

### Seitenleiste springt nicht mehr beim Eingeben
- Beim Neuaufbau der Seitenleiste bleiben Scrolllage und Eingabefokus samt Cursor erhalten — in allen Reitern.

## [1.94] — 2026-10-20
### 3D-Modell: Anfahrpunkt und Richtung je Segment
- Im Menü „Heißdraht-G-Code“ gelten **Anfahrpunkt, Anfahrwinkel und „Richtung umkehren“** jetzt nur für das gewählte Segment; der Klick auf die Schnittspur in der Ansicht „◫ Segmentpaar“ ebenfalls. Segmente ohne eigene Einstellung nutzen die gemeinsame Vorgabe aus „Platte / Stapeln“.
- Knöpfe **„Für alle Segmente übernehmen“** und **„Gemeinsame Vorgabe“**. Die Platte verwendet pro Stück die Einstellung seines Segments; gespeichert im Projekt (`modelGcode.segStart`).
- **Startpunkt per Klick am Querschnitt**: setzt den Startpunkt genau auf den angeklickten Konturpunkt (Fadenkreuz + Fangkreis, Fangweite 24 px), auch bei eingebuchteten oder hohlen Querschnitten. Leichtes Verwackeln (bis 4 px) zählt nicht mehr als Verschieben.

### Fix: Drahtheizung bei 3D-Modell-Segmenten und Platte
- Der G-Code der Quellen „3D-Modell“ (Segment) und „Platte“ enthielt kein `M3` – die Drahtheizung schaltete nicht ein. Jetzt wie bei den anderen Quellen: Heizstrom aus dem Werkstoff, als S-Wert auf `$30` skaliert. Segment: `M3` nach dem Kopf, `M5` vor der Rückfahrt; Platte: `M3` am Anfang, `M5` am Ende.

## [1.93] — 2026-10-19
### 3D-Modell: Segmente zusammensetzen, STEP-Import
- Neuer Block **Segmente zusammensetzen**: mehrere Teile (STL, OBJ, STEP; Mehrfachauswahl) zu einem Modell vereinen, automatisch entlang X/Y/Z aneinanderreihen (optional mit Fugenabstand), je Teil verschieben und drehen. **Stirnkappen an den Fugen entfernen**, **Schnittebenen an die Fugen setzen**, als STL exportieren, Baugruppe auflösen.
- **Farben selbst wählen** je Teil und je zerlegtem Segment. Das Projekt speichert Teile, Lage und Farben.
- **STEP laden**: OpenCascade als WebAssembly (occt-import-js 0.0.23, LGPL-2.1), eingebettet in `occt_wasm.js`, im Build-Tool als Funktion `stepimport` abwählbar (ca. 4 MB). Lizenzhinweis in `THIRD_PARTY_LICENSES.md` (Nr. 6).

### Formenbau
- **In Bauteile teilen (Segmentgruppen)**: je Segmentgrenze eine Fuge wählen; jede Gruppe wird ein eigenes Bauteil (Urmodell bzw. Form oben + unten). Randbogen/Winglet gehört zum letzten Bauteil oder ist eigenständig. **Steckung an jeder Fuge** (Kreis/Rechteck) als Ausnehmung bzw. Sackloch in beiden Nachbarteilen, **Alle Bauteile als STL…**, **Alle Bauteile zeigen** mit einstellbarem Abstand. Alle Teile geprüft wasserdicht.
- **Profil-Glättung mit Toleranz zur Original-.dat** (Standard 0,02 mm): die B-Spline-Kurve wird direkt an die .dat-Punkte angepasst und nur dort verfeinert, wo nötig — Nasenradius jetzt nahe am Original. Neue Methode „exakt durch die Punkte (Interpolation)“.
- Formenbau bezieht sich immer auf die Original-.dat und ist strikt von den Heißdraht-Rippen getrennt.
- **STEP-Export Urmodell: Querschnitte als B-Spline-Kurven** (neuer Standard) — Stationskurven exakt, Datei rund 7× kleiner.

### Tragflächendesign: Profilkontur der Schnittrippen + Profilvergleich
- Neue Auswahl, wie aus den .dat-Punkten die Schnittkontur entsteht: Spline neu abtasten (wie bisher, Standard), B-Spline geglättet (Toleranz) oder exakt durch die Punkte; je Tragfläche gespeichert, wirkt auf Kern-, Negativ-, Holmschnitt und G-Code. Gemeinsames Kernmodul `profilfit.js`.
- Neues Fenster **„Profilvergleich …“**: je Rippe .dat-Punkte gegen Schnittkontur, Abweichung entlang des Profils, optional eine zweite Methode zum Vergleich.

### Heller Modus
- Einstellungen → Farben → **Erscheinungsbild**: **Dunkel** (wie bisher), **Hell** oder **Hell, Zeichenflächen dunkel**. Zeichnungsfarben werden zentral umgerechnet (`theme.js`), eigene Farbwahl gilt weiter.

### Weiteres
- **Reiterleiste**: neue Standard-Gliederung der Menüs (eigene Gliederungen bleiben erhalten; „Standard wiederherstellen“ setzt zurück).
- **Re-Zahl-Eingabe** überall mit k/M (`50k`, `1,5M`).
- Fix: winzige Schlaufen an der Profilnase nach FLZ-/XFLR5-Import werden beim Einlesen entfernt.
- Fix: Scrollleiste in den Vergleichsfenstern (Profilglättung, Profilvergleich).

## [1.92] — 2026-10-16
### Speichern auf NAS-/Netzlaufwerken
- Der Browser-Dateizugriff schreibt über eine Zwischendatei (`.crswap`) neben dem Ziel und benennt sie danach um — auf NAS/SMB-Freigaben scheitert das oft. Scheitert das Schreiben, öffnet das Programm jetzt seinen **eigenen Windows-Speichern-Dialog** (lokaler Server der exe bzw. des Programmfensters) und schreibt die Datei direkt; für den Rest der Sitzung geht jedes Speichern gleich diesen Weg.
- **Strg+S** schreibt danach ohne Dialog wieder in dieselbe Datei. Direktes Schreiben ist nur an Pfade erlaubt, die in dieser Sitzung im Dialog gewählt wurden; Anfragen fremder Webseiten werden abgewiesen.

## [1.91] — 2026-10-16
### Behoben: leere Projektdatei nach dem Speichern („Unexpected end of JSON input“) (2026-10-16)
- Der Speichern-Dialog legt die Datei sofort leer an. Scheiterte danach das Schreiben (z. B. Virenscanner wie Avast blockiert die Zwischendatei, OneDrive-Sperre), wich das Programm still auf einen Download aus — am gewählten Ort blieb eine **0-Byte-Datei**, die sich nicht mehr laden ließ.
- Jetzt wird nach dem Schreiben die Dateigröße geprüft; ein Fehler wird **gemeldet** (mit Ursache) und die Datei zusätzlich in den Download-Ordner gespeichert. Gilt für alle Exporte über den Speichern-Dialog.
- Beim Laden einer leeren oder abgeschnittenen Projektdatei erscheint eine verständliche Meldung statt des JSON-Fehlers.

### Windows 7: Zahlenfelder wieder per Tastatur beschreibbar (2026-10-09)
- In der Win7-32-Bit-Ausgabe (Electron 22) nahmen Zahlenfelder der Seitenleisten (z. B. Pfeilwinkel der
  Tragfläche) keine Ziffern von der Tastatur an — nur die ▲/▼-Pfeile wirkten. Auf Windows 7/8 wird der
  Bildschirmtastatur-Hinweis `inputmode="decimal"` jetzt nicht mehr gesetzt (i18n.js, lädt als erstes Skript);
  auf Windows 10/11 bleibt alles unverändert.

### Profildatenbank: KFm-Gestalter mit symmetrischen Stufen, Nasenform und Live-Polare (2026-10-08)
- Stufen: neue Seite **„oben + unten"** (symmetrische Stufe an derselben Stelle), Knopf **„Alle symmetrisch"**,
  bis zu 8 Stufen. **„+ Stufe"** setzt die neue Stufe jetzt hinter die letzte (halber Weg zur Endleiste) statt auf
  50 % — vorher lag sie auf der ersten und war nicht als eigene Stufe zu sehen. Neue Vorlage „Symmetrisch — je zwei
  Stufen oben und unten bei 50 % und 75 %"; KFm4 nutzt die symmetrische Stufe. Name z. B. „KFm sym 11% (s50 s75)".
- Nase: neue Einstellung **„Nasenspitze"** — **mittig (Rundung symmetrisch, Standard)**, auf Mitte der Grundplatte
  oder **frei** mit „Höhe der Nasenspitze" in % der Nasendicke. Bei elliptischer und spitzer Nase **Nasenlänge oben
  und unten getrennt** einstellbar → asymmetrische Nasen.
- **Ausrichtung: die Grundplatte liegt immer bei 0° Anstellwinkel** — auch bei mehreren Stufen auf einer Seite und
  symmetrischer Nase. Die Nase wird fürs Ausrichten nicht herangezogen: Stufen-/Plattenprofile werden beim Normieren
  nur verschoben und skaliert, nicht gedreht (Airfoil.normalize mit `keepAlign`) — im Gestalter, beim Speichern in der
  Datenbank und beim Einlesen der .dat (Namen KFm…/Platte/Knickplatte). Bei der Knickplatte liegt das vordere
  Plattenstück waagrecht.
- NeuralFoil rechnet Profile, deren Sehne (Nase → Endleistenmitte) nicht auf der x-Achse liegt, intern zur Sehne
  gedreht und gibt α bezogen auf die x-Achse des Profils aus — die Polaren dieser Profile beziehen sich damit auf die
  waagrechte Grundplatte (auch unter „Profilpolaren rechnen" und im Aerodynamik-Reiter).
- **Anstellwinkel vorgeben**: im Polarfeld **α von / bis / Schritt** (bezogen auf die waagrechte Grundplatte) und
  **„Punkt bei α"** — zeigt cl, cd, cl/cd und cm genau bei diesem Winkel und markiert den Punkt als Ring in allen
  Diagrammen.
- **Zwischenstände**: „📌 Zwischenstand merken" behält die aktuelle Polare samt Entwurfsmaßen als eigene farbige
  Vergleichskurve (bis zu 8), je Stand ein-/ausblendbar, mit ↺ in den Entwurf zurückholbar, mit ✕ entfernbar.
- **Polare live**: im freien Feld rechts neben der Eingabemaske rechnet NeuralFoil bei jeder Änderung mit —
  cl über cd, cl über α und Gleitzahl über α, Re-Zahl wählbar, cl max / beste Gleitzahl / cd min als Text; der
  vorige Stand bleibt gestrichelt zum Vergleich stehen. (Das Netz sieht die Stufen über eine glatte Ersatzkontur —
  zum Vergleichen der Varianten gedacht.)
- Polarfeld wie im Reiter „Aerodynamik": **1–4 Diagramme**, je Diagramm **auswählbar** (Polare cl/cd, cl über α,
  Gleitzahl über α bzw. cl, Steigzahl cl¹·⁵/cd, cd, cm, Umschlag oben/unten), mit Gitter und Achsenwerten.
  **Rad = Zoom** um den Zeiger, **Ziehen = Achse strecken/stauchen** (waagerecht X, senkrecht Y), Shift-/Rechts-Ziehen =
  verschieben, Doppelklick = alles, Fadenkreuz mit Werten, Klick auf die Legende = Kurve ein/aus. Der Zoom bleibt
  beim Weiterrechnen erhalten.

## [1.9] — 2026-10-08
### Blockschnitt nur durch den Werkstoff bei angehobenem Block (2026-10-08)
- Neue Option direkt unter **„Schnittreihenfolge"** (nur sichtbar, wenn ein Blockschnitt gewählt ist; ebenso
  beim DXF-Blockzuschnitt und bei den Schalenrand-Vorschnitten der Negativschale): **„Blockschnitt nur durch den Werkstoff"**. Liegt der Block über
  „Höhe über Nullpunkt Y" angehoben, fahren alle senkrechten Blockschnitte nicht mehr bis Y=0 hinunter, sondern
  nur bis zur Blockunterkante plus **„Überschnitt unter dem Block"** (Standard 1 mm, nie tiefer als Y=0).
- Gilt für alle Blockschnitt-Modi des Kerns (vor/nach/während/nur Blockschnitt, auch „von vorne"), die DXF-Formen,
  die Schalenrand-Vorschnitte der Negativschale sowie die Bahnvorschau der Simulation. Standard: aus (wie bisher).

### Schneiden: Vorschub und Heizung während des Schnitts regeln (2026-10-08) — EXPERIMENTELL
- **Experimentell, noch nicht an einer echten Maschine getestet** (nur im Browser mit simulierter Steuerung).
  Der Hinweis steht auch in der Oberfläche über den Schaltern.
- Unter dem Programmlauf zwei Regler mit **echten Werten**: **Vorschub in mm/min** und **Heizung als S-Wert**
  (je Schieber + Eingabefeld), dazu der Knopf **G-Code-Werte**. Angezeigt wird der Wert der gerade gesendeten Zeile.
- Koordinaten (und damit Abbrand) bleiben unverändert. Unterschiedliche Werte im Programm bleiben im Verhältnis erhalten.
- **Vorschub:** die F-Werte der noch nicht gesendeten Zeilen werden beim Senden umgeschrieben (G94 mm/min, G93
  1/Blockdauer; bei modalem F in G94 wird F an die nächste Bewegungszeile angehängt). Wirkt, sobald die bereits in
  der Steuerung gepufferten Zeilen abgefahren sind.
- **Heizung:** über den Spindel-Override von grblHAL / Mega 5X (10–200 % des G-Code-Werts, sofort). Ein neues S im
  laufenden G-Code würde GRBL außerhalb des Lasermodus bis zum leeren Puffer anhalten (Draht steht → Einbrand).
- Doppelklick = G-Code-Wert, Mausrad = feiner Schritt; abweichende Werte orange. Neues Programm → Regler auf G-Code-Werte.
- Neue Option **„Echtzeit senden (Zeile für Zeile)"**: jede Zeile erst nach dem ok der vorigen statt paketweise
  (Character-Counting). Nur mit dieser Option sind die Regler bedienbar; ausschalten setzt sie auf die G-Code-Werte
  zurück. Umschaltbar auch während des Laufs, wird im Browser gespeichert (Standard: AUS = Pakete).
- **Gefahrene Zeile aus der Maschinenposition:** GRBL quittiert eine Zeile schon beim Einplanen. Jetzt wird aus der
  gemeldeten Position (alle 200 ms) das Programmsegment bestimmt, auf dem der Draht wirklich steht (nur vorwärts,
  Toleranz 0,1 mm). Danach richten sich die Markierung im Programm, der angezeigte Reglerwert und der
  **3D-Monitor, der jetzt parallel zum Schnitt mitläuft** (Draht an der echten Stelle, „Zeile n"). Passt die Position
  nicht zum Programm (z. B. anderer Nullpunkt), gilt wie bisher die Quittung.
- Schalter **„3D-Simulation während des Schnitts"**: EIN = Monitor folgt der Maschine, AUS = Monitor bleibt während des
  Schnitts stehen und wird nicht gezeichnet (spart Rechenzeit). Jederzeit umschaltbar, wird gespeichert (Standard EIN).

### Block ablängen (vertikal): Segmente aus DXF-Formen/3D-Modell + manuelle Blockhöhe (2026-10-08)
- „Blocklänge aus Segment" bietet neben den Tragflächen-Segmenten jetzt auch die **Segmente der DXF-Formen**
  (Segment-Spannweite) und des **3D-Modells** (Abstand der Schnittebenen) an. Die gewählte Quelle wird beim
  Neuaufbau nachgezogen, wenn sich die Segmentlänge inzwischen geändert hat; fällt sie weg, gilt wieder „Frei".
- Neue Auswahl **„Höhe des Rohblocks"**: aus Werkstoff (wie bisher) oder **manuell eingeben** (z. B. Reststück).
  Gilt für G-Code, 3D-Vorschau und Simulation von „Block ablängen".

## [1.8] — 2026-10-06
### Build: Electron-Ausgabe für Windows 7 / 32 Bit (2026-10-04)
- Neue `BUILD_TOOL_ELECTRON_WIN7.bat` / `build_tool_electron_win7.py`: eigenes Programmfenster auf Basis von
  Electron 22 (Chromium 108), 32 Bit, für Windows 7 SP1 und neuer. Systemanforderungen in
  `SYSTEMANFORDERUNGEN_WIN7-32.txt`. Noch nicht auf einem echten Windows 7 getestet.
- Electron-Fenster: Abstürze von Renderer/GPU-Prozess und JS-Fehler landen in `afc-start.log` neben der exe.

### Kerndesign: Schalenschnitt + Blockschnitt ohne Leerfahrt (2026-10-06)
- Mit „Ober-/Unterschale schneiden" und „Blockschnitt vor Profilschnitt" fährt der Draht nicht mehr erst die
  Oberschale vom Nullpunkt aus, dann hoch, zurück auf Null und wieder vor zum Blockschnitt. Neue Reihenfolge:
  **hinteres Blockende → Blockvorderkante → kurz vor den Block, dort runter, Oberschale von vorne nach hinten bis
  kurz hinter den Block → dort runter auf den Profilanfang, Profilschnitt → nur bis kurz hinter den Block, runter,
  Unterschale bis kurz vor den Block → hoch und zurück auf Null.**
- Neue Einstellungen unter „Schalenschnitte": **Abstand vor dem Block** und **Abstand hinter dem Block** (je
  Standard 5 mm, je Tragfläche gespeichert). Hinter Null-X fährt der Draht nur, wenn das hintere Blockende selbst
  dahinter liegt (Pfeilung) — dann bis in dessen Schnittspalt.
- Die Bahnvorschau ohne G-Code-Erzeugung (Design-Ausgabe) zeigt denselben Ablauf. Andere Modi („nach"/„während"
  Profilschnitt, von vorne, nur eine Profilseite, Anfahrweg) bleiben unverändert.

### STL-Vorschau vor jedem STL-Export (2026-10-05)
- Jeder STL-Export im Programm zeigt vor dem Speichern-Dialog eine **3D-Vorschau genau der Datei, die geschrieben
  wird** (inkl. Exportlage Z oben / Nullpunkt / gedrehte Formhälfte / Segmentierung): Formenbau (Urmodell, Fläche,
  Randbogen/Winglet, Formhälften, Druckstücke), Rumpf, 3D-Modell-Segmente und Rippen.
- Je Datei: Maße, Lage, Dreiecke, Dateigröße und **Kantenprüfung** (wasserdicht / offene bzw. mehrfach genutzte
  Kanten, ungültige Eckpunkte). **Rückseiten rot** zeigt falsch orientierte Dreiecke. Bei mehreren Dateien eine
  gemeinsame Vorschau, jede Datei eigene Farbe, per Klick ein-/ausblendbar.
- Bedienung: links ziehen = drehen, rechts ziehen = verschieben, Rad = Zoom zum Cursor, Mausrad-Doppelklick =
  Drehpunkt, ⌂/Pos1 bzw. Doppelklick = Ansicht zurück. Enter = Speichern, Esc = Abbrechen.
- „Alle Segmente exportieren" im 3D-Modell schreibt jetzt nach einer gemeinsamen Vorschau in einen gewählten Ordner
  (statt vieler Speichern-Dialoge gleichzeitig).
- Neues Kernmodul `stlpreview.js` (hängt sich in `App.download`/`App.exportViaPicker` ein; Mehrfach-Exporte rufen
  `App.stlPreview` geschützt auf).

### Formenbau: V-Form für Randbogen und Winglet (2026-10-05)
- Neuer Wert **„V-Form Randbogen / Winglet (°)"** im Block „Randbogen / Wingtip": der ganze Randbogen bzw. das ganze
  Winglet wird an der letzten Rippe um die Sehnenachse durch die Nase geknickt (positiv = nach oben, zusätzlich zur
  V-Form der Tragfläche).
- Die **Trennebene** zwischen Tragfläche und Abschluss liegt auf der **Winkelhalbierenden des Knicks** — jedes Teil
  nimmt den halben Winkel auf. Die **Steckungsbohrungen** stehen senkrecht auf dieser Ebene und gehen **gerade durch
  beide Teile** (in jedem Teil um den halben Knickwinkel schräg, dadurch Platz auf beiden Seiten); die Löcher beider
  Teile sind deckungsgleich.
- Wirkt im Urmodell (ganz und getrennt exportiert, STL und STEP) und bei den Einzelteilen; Formhälften der ganzen
  Tragfläche bleiben ohne Knick.

### Formenbau: 2D-Schnitt zeigt die Tragfläche nicht mehr doppelt (2026-10-05)
- Schnitt längs der Spannweite (z. B. Ebene „Sehne X") bei Tragfläche **mit Winglet bzw. eigenem Randbogen-Körper**:
  Die Schnittkontur zerfiel in Ober- und Unterseite, und jedes Stück wurde mit einer Geraden zur Wurzel geschlossen.
  Dadurch erschien die Fläche doppelt und überkreuzt. Die Kontur wird jetzt am offenen Rand (Ansatz des Winglets)
  in beide Richtungen verkettet und als ein Stück gezeichnet.

### „Ansicht wiederherstellen" in allen 3D-Ansichten (2026-10-05)
- Neuer Knopf **⌂** oben rechts in jeder 3D-Ansicht (links neben dem Ansichtswürfel, wo es keinen gibt in der Ecke):
  setzt **Drehung, Zoom, Verschiebung und Drehpunkt** auf die Ausgangsansicht zurück. Dasselbe mit der Taste **Pos1**,
  solange die Maus über dem 3D-Bild steht. Gilt für 3D-Modell, Kern-/Segment-3D, Schneiden (Block), Simulator + Monitor,
  Formenbau, Rumpf und Rippen-STL-Vorschau.

### Formenbau: Steckungs-Taschen laufen bis zum Formende durch (2026-10-05)
- **Negativform**, Tragflächensteckung (Wurzelverlängerung) und Anschluss-Steckung: ist eine Ausnehmung mindestens
  so lang wie der Überstand, läuft die Tasche jetzt **offen bis zum Ende der Form** durch. Bisher blieb dort eine
  senkrechte Stirnwand stehen, obwohl die Länge größer als der Überstand war. Kürzere Ausnehmungen enden wie bisher
  mit einer Stirnwand; das geteilte Urmodell (aufgesetzter Steckungskörper) ist unverändert.

### Guillotine: mit X-Versatz senkrecht rauf, oben hin und oben zurück (2026-10-05)
- Liegt der Schnitt nicht bei X0 (X-Abstand oder Winkel), fährt der Draht nicht mehr waagrecht über Y0 durch den
  Werkstoff: erst **senkrecht rauf** auf die Schnitthöhe, **oben waagrecht** zum Schnittpunkt (Draht aus), Pause,
  Schnitt runter (ggf. Überfahrt + Pause), dann **in der Schnittfuge wieder hoch**, **oben zurück** auf X0 und erst
  dort senkrecht runter auf den Nullpunkt. „Rauffahren" (Eilgang/Schnitt) gilt dann für das Hochfahren in der Fuge,
  **Standard jetzt „Schnitt"** (Draht ein).
- Unten wird immer die **Verweilzeit des Werkstoffs** gehalten; neue Option **„Pause nach dem Schnitt"** (nach Schnitt
  und Verweilen, Draht aus, z. B. Abschnitt entnehmen) — ersetzt die bisher feste Pause bei Überfahrt.
- Neue Wahl **Rückfahrt**: „über Sicherheitshöhe" (Standard, **Sicherheitshöhe** 10 mm: in der Fuge nur bis dahin hoch,
  dort waagrecht zurück auf X0) oder „über den Schneideweg" (Fuge ganz rauf, oben zurück wie beim Hinfahren).

### Alle 3D-Ansichten: Mausrad-Doppelklick setzt den Drehpunkt (2026-10-04)
- Doppelklick mit dem **Mausrad** (mittlere Taste) auf das Modell legt dort den neuen **Drehpunkt** — die Ansicht springt
  dabei nicht, danach dreht (und zoomt) sie um diesen Punkt; gelbes Fadenkreuz markiert ihn. Bisher nur im Formenbau,
  jetzt auch in 3D-Modell, Simulator (G-Code + Monitor), Tragflächen-/DXF-3D-Fenster, Blockansicht (Schneiden), Rumpf
  und Rippen-STL-Vorschau.
- Linker Doppelklick (Ansicht zurücksetzen), Standardansichten und ein neues Modell setzen den Drehpunkt zurück auf die
  Modellmitte. Im Tragflächen-3D-Fenster setzt auch der linke Doppelklick aufs Modell den Drehpunkt — jetzt genau auf den
  getroffenen Flächenpunkt statt den Flächenschwerpunkt, ohne Sprung.

### Ausschnitte: Kabinenhaubenausschnitt als freier Linienzug (2026-10-04)
- Kabinenhaubenausschnitt mit neuer Einstellung **„Art der Schnittlinie"**: neben den bisherigen drei Linien
  (vorne, unten, hinten) jetzt auch **„freier Linienzug"**. Beliebig viele Punkte
  von der Blockoberkante zur Blockoberkante; je Abschnitt **gerade**, **Spline** (Wölbung + Lage) oder **Seite eines
  Tragflächenprofils** (NACA 00xx, Wurzelrippe aus dem Tragflächendesign oder .dat-Datei; Ober-/Unterseite,
  Profilnase am Anfang oder Ende, Höhe in %). An jedem Innenpunkt ein Übergangsradius **R**.
- Punkttabelle (X ab Blockvorderseite, Tiefe unter der Oberkante) mit „+ Punkt"/„Punkt löschen"; in der Ansicht
  Griffe ziehen, **Doppelklick** auf die Linie setzt einen Punkt, **Rechtsklick** auf einen Punkt löscht ihn.
- Beim ersten Umschalten werden die drei Linien formgleich übernommen; „Aus den drei Linien neu anlegen" setzt zurück.
  Abbrandseite, Überlauf, Schnittrichtung, Blockgröße (auto) und G-Code wie bisher.

### Drahtgitter verschwand beim Zoomen (2026-10-04)
- **Rumpf**: Im Modus **Drahtgitter** verschwand das ganze Netz nach dem ersten
  Zoomen oder Drehen und kam erst nach erneutem Umschalten zurück. Ursache war eine Grafiktreiber-Falle (ANGLE/D3D mit
  Kantenglättung): Linien direkt nach den verdeckenden Flächen gingen ab dem zweiten Bild verloren. Zwischen beiden
  Durchgängen wird jetzt synchronisiert — das Drahtgitter bleibt bei jedem Zoom und jeder Drehung stehen.

### Profildatenbank: Gestalter für Stufenprofile (KFm) und Knickprofile (2026-10-04)
- Neuer Knopf **„KFm-/Knickprofil gestalten…“** in der Seitenleiste der Profildatenbank. Vorlagen KFm1 bis KFm4, ebene
  Platte und Knickplatte; frei einstellbar: Dicke der Grundplatte, bis zu sechs Stufen (oben/unten, Lage, Höhe),
  Nasenform (rund, elliptisch, spitz), Knicke der Platte (Lage, Winkel) und eine angeschärfte Endleiste. Alle Maße in
  % der Sehne, dazu eine mm-Anzeige für eine frei wählbare Sehne. Der Entwurf läuft live im Vergleichsbild mit.
- **Speichern** in die Profildatenbank (sofort im Tragflächendesigner wählbar) und als
  **.dat-Datei** (Selig-Format).
- Die Punkt-Neuverteilung (Profil laden, Punktzahl ändern) setzt bei Profilen mit scharfen Ecken (> 45°) jetzt je einen
  Punkt genau auf die Ecke – Stufen bleiben senkrecht statt zur Schräge zu werden. Die Grundplatte liegt waagrecht
  (Nasenspitze auf Plattenmitte), auch bei Stufen auf nur einer Seite.
- Die Stufen bleiben beim Einsetzen als Ecken erhalten. Bei diesen Profilen wird die dicke Endleiste beim Laden
  **nicht** auf 0 geschlossen – auch nicht, wenn die .dat später über „Profil laden“ eingelesen wird (erkannt über die
  Datenbank bzw. am Namen, der mit „KFm“, „Platte“ oder „Knickplatte“ beginnt).

### Formenbau: Trennebenen der Druckstücke bei Winglet-Formen wählbar (2026-10-04)
- Segmentierung, Bauteil „nur Randbogen / Winglet“ (Negativform / geteiltes Urmodell): neue Auswahl
  **Trennebenen (Winglet-Form)** – *senkrecht zur Trennfläche* (neuer Standard: jede Ebene steht quer zum Winglet
  an ihrer Stelle), *senkrecht zum ebenen Formhinterbau* (zusätzlich rechtwinklig auf der Auflagefläche) oder
  *senkrecht zur Spannweite* (wie bisher). Bei den ersten beiden zählen Stücklängen und -anzahl längs des Winglets
  (Bogenlänge); vorher lagen alle Schnitte senkrecht zur Spannweite und liefen schräg durch das Winglet.
- Vorschau: die Stücke werden längs der Ebenen-Normalen auseinandergezogen, die Ebenen gestrichelt gezeichnet.
- Passstifte werden bei schrägen Ebenen automatisch gesetzt (manuelle Lage nur bei Ebenen senkrecht zur Spannweite).
- Teilung robuster: eng beieinanderliegende Schnittpunkte werden verschweißt, die Ebene weicht Netzpunkten gezielt
  aus (nächste freie Lage statt fester 0,1-mm-Schritte), Splitterdreiecke hinterlassen keine offenen Kanten mehr.

### Formenbau: ebener Formhinterbau für Winglet-Formen (3D-Druck) (2026-10-04)
- Bauteil „nur Randbogen / Winglet“, Ziel Negativform oder geteiltes Urmodell: neue Auswahl **Formhinterbau** –
  „folgt der Biegung“ (wie bisher) oder „ebene Auflagefläche“. Die Rückseite besteht dann nur aus ebenen Flächen:
  den geraden Rückseiten des waagrechten Teils und des Winglets und dazwischen einer Auflagefläche für das Druckbett
  (außen als Fase an der Ecke, innen füllt sie die Ecke). Beide Hälften bekommen parallele Auflageflächen.
- Lage der Auflagefläche wählbar: *gleicher Winkel zu beiden Teilen*, *durch die Enden* (die innere Hälfte liegt
  vollflächig auf) oder *eigener Winkel*; dazu eine Zugabe (Parallelversatz nach außen). Winkel und Breite der
  Auflagefläche stehen in der Infozeile. Gilt für STL und den STEP-Export der Formhälften.
- Passlöcher laufen bei ebenem Hinterbau im Bereich der Auflagefläche schräg aus – dort besser ohne Passlöcher.

### Neu: Ausschnitte – rechteckiger Ausschnitt (2026-10-03)
- Tragflächenausschnitt, Auswahl „Profil“: neue Quelle **„Rechteck (z. B. Plattenleitwerk)“** mit Länge, Dicke
  und Eckenradius. Einstellwinkel, Lage im Block, Spiel, Anfahrt, Startpunkt und Schnittrichtung gelten wie beim Profil.

### Geändert: Reiter „Tragflächenausschnitt“ heißt jetzt „Ausschnitte“ (2026-10-03)
- Der Reiter heißt nur noch **„Ausschnitte“** (Tragflächen- und Kabinenhaubenausschnitt) und steht im Menü
  **„Komplexe Formen“** statt „Tragflächen“. Auch die G-Code-Quelle heißt „Ausschnitte“. Wer die Menüleiste
  selbst umgestellt hat, behält seine Anordnung (Einstellungen → Menüleiste → „Standard wiederherstellen“).

### Neu: Tragflächen-/Kabinenhaubenausschnitt – Block abwählbar (2026-10-03)
- Leiste unter der Ansicht: neuer Schalter **„Block“** blendet die Blockdarstellung (Umriss, Beschriftung,
  Anfahrfläche) aus und ein. Schnittbahn und G-Code bleiben unverändert.

### Neu: Kabinenhaubenausschnitt (2026-10-03)
- Reiter „Tragflächenausschnitt“: neue Wahl **„Art des Ausschnitts“** – *Tragflächenausschnitt (Profil)* wie
  bisher oder **Kabinenhaubenausschnitt**. Die Haube ist durch drei Linien bestimmt: vordere, untere
  („waagrechte“) und hintere Linie. Eingaben: Lage der vorderen Ecke (Abstand zur Blockvorderseite, Tiefe unter
  der Blockoberkante), Länge und Neigung der unteren Linie, Winkel der vorderen und hinteren Linie,
  **Übergangsradius vorne und hinten**.
- Jede der drei Linien ist **gerade oder ein gekrümmter Spline** (Wölbung in mm und Lage der Wölbung in %);
  die Radien werden auch zwischen gekrümmten Linien tangential eingepasst.
- Ecken, Linienenden (Winkel) und Wölbungspunkte lassen sich in der Ansicht **mit der Maus ziehen**.
- Schnitt als offener Zug: Überlauf vor dem Block, vordere Linie hinunter, untere Linie, hintere Linie hinauf,
  Überlauf, in Luft zurück zum Nullpunkt. Wählbar, was maßhaltig bleibt (Haube, Rumpf oder Draht auf der Linie),
  Schnittrichtung vorne → hinten oder umgekehrt, Nase links/rechts. Block, Werkstoff, Abbrand und G-Code-Quelle
  sind dieselben wie beim Tragflächenausschnitt.

### Neu: Tragflächenausschnitt – Profil spiegeln (2026-10-03)
- Reiter „Tragflächenausschnitt“, Gruppe „Profil“: neue Wahl **„Profil spiegeln“**. Das Profil wird an der
  Sehne gespiegelt (Oberseite unten); Nase und Endleiste bleiben an ihrem Platz, der Einstellwinkel zählt
  weiter positiv = Nase hoch. Links/rechts tauscht wie bisher „Nase zeigt nach“.

### Behoben: Grube auf der Winglet-Oberseite vor dem Übergangsbogen (2026-10-03)
- Formenbau, Winglet (mit Übergangsbogen): Mit dem Rücksprung der Nase wird das Profil am Wingletfuß dünner –
  bisher symmetrisch zur Nasenlinie. Die Oberseite sank dadurch im waagrechten Teil ab und stieg erst im Bogen
  wieder an (sichtbare Grube am Übergang waagrecht → senkrecht, im Beispiel rund 2 mm).
- Jetzt läuft die Oberseite in Verlängerung der Tragfläche gerade weiter und geht stetig in den Bogen über; die
  Dickenabnahme liegt im waagrechten Teil ganz auf der Unterseite (Außenseite der Biegung). Im Bogen klingt der
  Ausgleich weich aus. Der gerade Teil des Winglets behält Form und Neigung, er sitzt nur um den Ausgleich
  (wenige mm) parallel nach innen versetzt.
- Ohne Rücksprung im waagrechten Teil / Bogenanfang ändert sich nichts. „Winglet aus Zeichnung“ ist nicht betroffen.
- Nebenbei: Winglet ohne waagrechten Teil (Länge 0) rechnete an der Flügel-Endrippe intern mit einem ungültigen Wert.

### Behoben: Winglet-Formen an der Innenseite der Biegung (2026-10-03)
- Formenbau, Bauteil „nur Randbogen / Winglet“: War die Form an der Innenseite der Winglet-Biegung dicker als der
  Biegeradius, faltete sich das Netz (Rückseite der oberen Negativform, Trennplatte des geteilten Urmodells) –
  überlappende, verdrehte Flächen. Die Biegung wird jetzt mit wachsendem Abstand zur Trennfläche zunehmend
  geglättet: Kavität, Flansch und Trennfläche bleiben exakt, die Rückseite rundet die Innenecke aus.
  Gilt auch für den STEP-Export der Formhälften.
- Stirnflächen bleiben eben: Die Anschlussfläche zur Tragfläche (und das Ende an der Winglet-Spitze) liegt auch an
  der dicken Formseite genau in der Rippenebene. Die ausgerundete Rückseite läuft ungestört bis zum Anschluss und
  wird dort an der Rippenebene abgeschnitten (die Stirnfläche ist an der Innenseite der Biegung entsprechend höher)
  – keine Welle und keine Rille mehr am Anschluss.
- Die zulässige Formdicke wird über die Formbreite getrennt bestimmt: eine ungünstige Flanschecke bremst nicht
  mehr die Kavität in der Mitte aus.
- Die rote Warnung „Biegeradius zu klein“ erscheint nur noch, wenn das Profil selbst dicker als der Radius ist.
- Vorschau: Die Formhälften werden zum Auseinanderziehen jetzt starr verschoben (Winkelhalbierende der Biegung,
  Spalt überall mindestens der eingestellte Wert). Vorher wurde der Versatz mitgebogen, wodurch die Hälften
  unterschiedlich verformt aussahen und nicht mehr zusammenpassten. Der Export war davon nie betroffen.
- Abstand der Hälften direkt in der 3D-Ansicht einstellbar (Knöpfe − / + unter „nur untere Form“, ±5 mm);
  Klick auf den Wert schaltet auf „geschlossen“ (0 mm) und zurück.

### Build: Ausgabe für Windows 7 / 32 Bit, Browser-Variante (2026-10-02)
- Neue `BUILD_TOOL_WIN7.bat`: startet das Build-Tool mit Python 3.8 (32 Bit) und PyInstaller 5.13.2. Jede exe aus
  diesem Fenster ist eine 32-Bit-exe für Windows 7 SP1 und neuer; die normale 64-Bit-Ausgabe bleibt unberührt.
- Das Build-Protokoll nennt jetzt Python-Version und Bitbreite des bauenden Python.
- Voraussetzung beim Anwender: Chrome oder Edge 109 (letzte Version für Windows 7). Noch nicht auf einem echten
  Windows 7 getestet.

## [1.7] — 2026-09-30
### Neuer Reiter „Tragflächenausschnitt" (2026-09-30)
- Eigenes Modul (Menü „Tragflächen", Funktion `ausschnitt`): ein Profil als **Ausschnitt aus einem Block** schneiden
  (z. B. Flächenaufnahme im Rumpfblock) oder als **Profilstück** stehen lassen.
- **Profil:** Wurzelprofil einer Tragfläche (Profiltiefe der Wurzelrippe, Maßstab in %, bei mehreren Tragflächen
  wählbar) oder **eigenes Profil** (.dat laden, aus der Profildatenbank wählen oder das Wurzelprofil als Kopie
  übernehmen; Profiltiefe frei). Dazu Einstellwinkel (Drehpunkt Endleiste — sie bleibt stehen, die Nase
  wandert; im Bild markiert) und Nasenrichtung (Standard links).
- **Block & Lage:** Profil standardmäßig mit Abstand Nase ↔ Blockvorderseite und Nasenhöhe (oder mittig);
  Blockbreite/-höhe automatisch (Abstand + Profil + Rand) oder fest, Blockdicke. Abbrand aus der Werkstoff-Kalibrierung oder manuell; beim
  Ausschnitt läuft der Draht innerhalb der Kontur, beim Profilstück außerhalb. „Spiel" vergrößert den Ausschnitt.
- **Anfahrt von oben, unten, vorne (Nasenseite) oder hinten (Endleistenseite):** in Luft zum Anfahrpunkt vor der
  Blockfläche, senkrecht zur Fläche hinein, Umlauf, auf demselben Weg hinaus.
- **Startpunkt als Befehl „▶ Startpunkt wählen"** (Seitenleiste und Knopfleiste): danach ein Klick auf die
  Profilkontur (grüner Kreis zeigt den Punkt), der Befehl endet mit dem Klick oder mit Esc; sonst automatisch der der Anfahrfläche
  nächstgelegene Punkt. Warnung, wenn der Anfahrweg durch ein stehen bleibendes Profilstück schneiden würde.
- **Schnittrichtung** im oder gegen den Uhrzeigersinn, mit Richtungspfeilen auf der Schnittbahn.
- **Maße in der Ansicht** (Schalter „Maße"): Nullpunkt → Block, Blockvorderseite → Nase, Nullpunkt → Nase und die
  Nasenhöhe (bzw. Blockhöhe über Y0) — immer an der tatsächlichen, gedrehten Nase.
- Eigene G-Code-Quelle „Tragflächenausschnitt" (G-Code, Simulation, Bahnvorschau, Reiter „Schneiden");
  Blocklage X/Y und Vorschub kommen wie gewohnt aus dem Reiter „G-Code". Deutsch/Englisch.

### DXF-Formen: Anfahrweg einstellbar, Startpunkt wählbar (2026-09-30)
- **Anfahrt von hinten / oben / vorne / unten** (Gruppe „Schnitt"): von oben fährt der Draht über den Block und
  senkrecht auf den ersten Punkt, von vorne über den Block vor die Blockvorderkante und waagrecht hinein, von unten
  unter dem Block hindurch und senkrecht hinein. Hinten bleibt die bisherige waagrechte Anfahrt vom Nullpunkt.
  Der Draht verlässt die Form nach dem Umlauf auf demselben Weg.
- **Anfahrt-Abstand zur Blockfläche (mm):** bis zu diesem Punkt fährt der Draht in Luft, ab dort mit Schnittvorschub.
  Liegt der Anfahrpunkt oben über der Sicherheitshöhe, wird diese mit angehoben. Von unten höchstens bis Y0.
- Funktioniert ohne Blockschnitt sowie mit Blockschnitt vor oder nach dem Formschnitt.
- „Anfahrt/Ausfahrt sicher" beginnt jetzt am Punkt in Anfahrrichtung (oberster, vorderster, unterster bzw. hinterster).
- **Startpunkt wählen** bei gleichem Querschnitt (INNEN = AUSSEN, keine Synchronpunkte nötig): ein Klick auf die
  Kontur legt den Startpunkt fest; „Automatisch" verwirft ihn wieder. Ein gewählter Startpunkt hat Vorrang vor
  „Anfahrt/Ausfahrt sicher". Die Einstellungen gelten je Segment.

### Startfenster „Maschine wählen“ in der eingestellten Sprache (2026-09-29)
- Das Fenster beim Programmstart (Maschine laden / **„Neue Maschine...“** / „Durchsuchen...“) erscheint auf Englisch,
  wenn die Sprache in den Einstellungen auf Englisch steht — in der Browser-Variante (Windows, Linux, Mac) und in der
  Electron-Variante. Ebenso der Dateidialog, der Zusatz „(neu)“ und die Meldungen des Starters
  („läuft jetzt im Browser“, Ablaufhinweis).
- Die Sprache wird aus der zuletzt gewählten Einstellungsdatei gelesen (ersatzweise Standarddatei, dann jede andere
  Einstellungsdatei im Programmordner). Ohne Einstellungsdatei — also beim allerersten Start — bleibt es Deutsch.

### DXF-Formen: „Eigene Blockgeometrie für AUSSEN“ ist Standard (2026-09-29)
- Neue Projekte und neu angelegte Segmente starten mit eingeschalteter eigener Blockgeometrie am AUSSEN-Profil
  (verjüngter Block). Die AUSSEN-Werte sind mit denen des INNEN-Profils vorbelegt.
- Gespeicherte Projekte bleiben unverändert; der Schalter lässt sich je Segment weiterhin abschalten (gerader Block).

### 3D-Ansicht der Tragfläche zeigt die Holmausschnitte (2026-09-29)
- Im Fenster **„3D-Ansicht — geschnittene Segmente der Tragfläche“** erscheinen die Holmausschnitte jetzt als
  durchgehende Öffnungen: Loch in den Stirnflächen, Wände durch das Segment, Kontur in Holmfarbe an beiden Rippen,
  Anfahrt gestrichelt. Gilt für alle Lochformen (Rechteck, Rund/Oval, Trapez, Doppel-T, Scharnierausschnitt), auch
  gespiegelt und bei „beide Seiten“. Taschen (Gurt ohne Steg) werden in 3D noch nicht dargestellt.

## [1.6] — 2026-09-28
### DXF-Formen: eigene Blockgeometrie für das AUSSEN-Profil (2026-09-28)
- Neuer Schalter **„Eigene Blockgeometrie für AUSSEN"** in der Blockgeometrie je Segment: Blocklänge X, Blockhöhe Y
  und die Abstände vorne/hinten/oben/unten lassen sich für das AUSSEN-Profil getrennt einstellen (bezogen auf das
  eigene Profil). Beim Einschalten mit den INNEN-Werten vorbelegt. Aus = wie bisher ein gerader Block um beide Profile.
- Der Block verjüngt sich damit von INNEN nach AUSSEN: Blockzuschnitt (Schnittposition je Portal auf die Turmebenen
  verlängert), Anfahrt durch den Block, 3D-Simulation und die Zeichnung (zwei Rechtecke in den Profilfarben mit
  Maßen) folgen dieser Form.
- **Gleiche Basis (Standard):** INNEN und AUSSEN haben dieselbe Blockunterkante — der Block liegt flach auf. Die Basis
  liegt auf der TIEFEREN der beiden Unterkanten, egal welches Profil kleiner ist oder weniger tief reicht; „Abstand
  unten" je Profil gilt als Mindestabstand, der andere Block wird bis zur Basis verlängert (wirksamer Wert wird
  angezeigt). Feste Blockhöhen zählen ab der gemeinsamen Basis. Abschaltbar über „Gleiche Basis wie INNEN" (dann
  eigener Abstand unten je Seite, schräge Unterseite).
- **Blockgrenzen gestrichelt:** in der DXF-Formen-Ansicht werden die Blockgrenzen (INNEN/AUSSEN) ab Werk gestrichelt
  gezeichnet, damit sie sich von den Profilkonturen abheben. Bestehende Einstellungen werden einmalig umgestellt;
  änderbar unter Einstellungen → Strichtypen (Ansicht DXF-Formen, „Block").

### G-Code: „Geschwindigkeit außerhalb Block“ wirkt auch mit Blockschnitt (2026-09-28)
- Behoben: Bei den Schnittreihenfolgen **mit Blockschnitt** (vor / nach / während Profilschnitt, nur Blockschnitt)
  fuhren alle Fahrten außerhalb des Blocks fest mit dem Max.-Vorschub — die Auswahl „Gleich wie Schnitt“ und der
  frei gewählte **Außen-Vorschub** blieben ohne Wirkung. Jetzt gilt die Einstellung für alle Fahrten in Luft,
  auch bei den Holmschnitten. Die vertikalen Blockschnitte laufen weiter mit dem Schnittvorschub.
- Unverändert: Der **Max.-Vorschub** (Reiter „Maschine“) deckelt den Wert — ein Außen-Vorschub darüber wird gekappt.
- Achtung: Wer „Gleich wie Schnitt“ eingestellt hat, fährt mit Blockschnitt außerhalb des Blocks jetzt wirklich
  im Schnittvorschub (vorher Maximum). Für schnelle Leerfahrten „Maximum“ oder „Freie Wahl“ wählen.

### Simulation: schnelle Verfahrwege sichtbar (2026-09-28)
- Behoben: In der 3D-Simulation (G-Code-Reiter und Monitor im Reiter „Schneiden“) wurden schnelle Fahrten —
  Eilgang, „Geschwindigkeit außerhalb Block“ auf **Maximum** oder ein hoher freier Wert — bei der Wiedergabe
  übersprungen; der Draht sprang ans Ziel. Jede Fahrt ab 20 mm läuft jetzt über mindestens einige Bilder und
  ist damit immer zu sehen. Die Konturschritte werden nicht gebremst, die Wiedergabe dauert praktisch gleich lang.
  Laufzeitangabe und G-Code bleiben unverändert.

### Maschine: erlaubter Fahrweg ins Negative (2026-09-28)
- Im Menü **„Maschinengrenzen & Warnungen“** (Reiter „Maschine“) lässt sich für die beiden horizontalen und
  die beiden vertikalen Achsen je ein Wert eintragen, wie weit sie **unter den Maschinennullpunkt** fahren dürfen, z. B. `-5`. Bis zu diesem Wert
  gibt es keine Warnung in der 3D-Simulation und keine Startsperre im Reiter „Schneiden“.
- Der negative Weg wird vom **max. Fahrweg abgezogen** (dieser ist der gesamte Weg der Achse): bei 500 mm und `-5`
  sind nach oben noch 495 mm erlaubt.
- Der Wert trägt ein negatives Vorzeichen (wird automatisch gesetzt); `0` = wie bisher nichts erlaubt.
  Die Meldungen nennen die erlaubte Grenze, die Lösungsvorschläge verweisen auf das neue Feld.

### Formenbau: Schraubbefestigung am Stoß (2026-09-28)
- Neue Gruppe **„Schraubbefestigung am Stoß“** im Reiter Formenbau (nicht beim Bauteil „nur Randbogen / Winglet“):
  Senkungen für die Schraubenköpfe eines Höhenleitwerks bzw. einer von oben verschraubten Tragfläche —
  **genau am Stoß** der linken und rechten Fläche (halbes Loch je Hälfte, mit „beide Hälften“ ein ganzes) oder
  **je eines links und rechts** davon (Abstand einstellbar). Ober- oder Unterseite wählbar.
- Bis zu 4 Löcher hintereinander in Sehnenrichtung, Lage je Loch in % der Wurzelsehne (Vorgabe 25 / 75 %).
- **Senkkopf** (Kegel mit Senkwinkel, wahlweise zusätzlich zylindrisch versenkt) oder **Zylinderkopf**
  (zylindrische Senkung mit Kopfhöhe); Gewinde-Vorgaben M2 … M5 setzen Kopfdurchmesser, Bohrung und Kopfhöhe
  nach DIN 7991 / DIN 912, alle Werte frei änderbar. Darunter eine kurze Schaftbohrung als Markierung zum Durchbohren.
- Im **Urmodell** (auch geteilt) sind es Vertiefungen, in der **Negativform** die passenden Erhöhungen — der Abguss
  bekommt die fertige Senkung. Umgesetzt auf Ringebene (zusätzliche Ringe über die Lochbreite, exakte Lochränder
  je Ring), alle Ziele wasserdicht geprüft. Nicht im STEP-Export enthalten.

### DXF-Formen: G-Code nennt Werkstückgeschwindigkeit innen und außen (2026-09-28)
- Jede Konturzeile im G-Code der DXF-Formen trägt im Kommentar jetzt die Geschwindigkeit am Werkstück
  **innen (INNEN-Profil) und außen (AUSSEN-Profil)**, z. B. `; Portal XY=… UV=…, Werkstück innen=300 außen=412 mm/min`.
  Bisher stand dort nur der Innenwert. Kern- und Negativdesign bleiben unverändert.
- **Vorschub gilt jetzt für beide Seiten als Obergrenze:** bei komplexen Formen lag die Außenseite teils über dem
  eingestellten Vorschub. Jetzt läuft je Konturschritt die schnellere Werkstückseite (innen oder außen) genau mit
  dem Vorschub, die andere entsprechend langsamer. Die Spitzen-Glättung darf den Vorschub nicht mehr anheben.
- **Fehlermeldung, wenn der Max.-Vorschub bremst:** muss ein Portal am Max.-Vorschub gedeckelt werden und liegen
  dadurch beide Werkstückseiten unter dem Vorschub, erscheint in der 3D-Simulation eine rote Meldung mit Segment,
  erster betroffener G-Code-Zeile, Portal und Anzahl betroffener Zeilen, dazu zwei Abhilfen: Max.-Vorschub auf den
  nötigen Wert erhöhen oder den Block näher an das betroffene Portal legen. Hinweis auch in der Infozeile unter dem G-Code.
- **Anfahrt durch den Block nicht mehr im Eilgang:** nach dem Blockschnitt fuhr der Draht vom hinteren Blockende mit
  Max.-Vorschub zur Form, wenn die hintere Blockfläche genau auf Null-X (Abstand in Flugrichtung 0) oder dahinter lag.
  Jetzt gilt: sobald der Draht im Werkstoff ist, Schnittvorschub — auch wenn nur eine Seite (links/rechts bzw.
  innen/außen) im Block liegt. Betrifft An- und Abfahrt in allen Schnittreihenfolgen.

### Tragflächendesign: elliptische Flächen aus Planform Creator (2026-09-28)
- Neues Untermenü **„Elliptische Fläche (Planform Creator)"** im Tragflächendesign (nur bei Tragflächen aus einem
  .pc2-Import): Kennwerte, Abweichung der Trapeze, Tabelle der Profilschnitte (Lage, Sehne, Profil bzw. Strak).
  Im Grundriss werden die glatte Kontur, die Scharnierlinie und die Lage der Profilschnitte aus dem Planform Creator
  über die Trapeze gezeichnet (abschaltbar).
- **Scharnierlinie exakt wie im Planform Creator:** gerade Strecken in absoluten Grundriss-Koordinaten zwischen den
  Sektionen mit Scharnierangabe, bis zur Spitze verlängert (bisher wurde fälschlich der Sehnenanteil linear
  interpoliert — bei elliptischen Flächen ergibt das eine krumme Scharnierlinie). Knopf „Scharnierlinie aus
  Planform Creator übernehmen" setzt Scharnierlagen und Klappengruppen der Segmente neu; Scharnier-Seite
  oben/unten für alle Segmente wählbar.
- **Scharniere der Höhe nach ausrichten:** schaltet die Profilhöhenausrichtung mit Bezug Scharnierlinie ein (neue
  Gruppe an jedem Knick der Scharnierlinie) — das Scharnier ist damit auch räumlich gerade. Der Formenbau hält den
  Scharnierpunkt dabei auch zwischen den Trapezgrenzen auf der Geraden. Das **Randbogenprofil** (Außenrippe) wird
  dabei **im Verlauf** ausgerichtet statt am Scharnier: seine Sehne setzt die Neigung des letzten Trapezes fort,
  so springt das dünne Spitzenprofil nicht. Schalter „Randbogenprofil im Verlauf ausrichten" auch allgemein im Block
  „Profilhöhenausrichtung" (für jede Tragfläche, Merkmal beliebig).
- **Profile exakt wie im Planform Creator:** Sektionen ohne eigenes Profil bekommen ein **Strak-Mischprofil** der
  Nachbarn, Mischanteil wie im Planform Creator nach dem Tiefenverhältnis (auf 1 % gerundet); es wird berechnet,
  sobald beide .dat geladen sind. Im Import-Dialog sind die Profilschnitte bei jeder Trapez-Verteilung als
  Trapezgrenze gesetzt (abschaltbar), die Profile sitzen dadurch genau an ihrer Stelle.

### Formenbau: Ansichtswürfel verdeckt die Anzeige-Schalter nicht mehr (2026-09-27)
- Die Schalter oben rechts in der 3D-Ansicht (beide Hälften / nur obere / nur untere Form, Trennfläche, Drahtgitter)
  beginnen jetzt unterhalb des Ansichtswürfels statt darunter zu liegen.

### Formenbau: glatter Grundriss aus Planform Creator (2026-09-27)
- Beim Import einer glatten (z. B. elliptischen) Fläche aus **Planform Creator (.pc2)** wird die Originalform jetzt
  zusätzlich an der Tragfläche gespeichert. Die Trapeze bleiben für den Heißdraht, der **Formenbau** baut Urmodell,
  geteiltes Urmodell und Negativform dagegen aus dem glatten Grundriss — Nasen- und Endleiste folgen exakt der
  Kurve, an der Spitze der Ellipse werden automatisch zusätzliche Zwischenringe gesetzt.
- Neue Auswahl im Formenbau → „Bauteil" → **Grundriss (Planform)**: „glatt wie im Planform Creator" (Standard) oder
  „Trapeze (wie Heißdraht)". Erscheint nur bei Tragflächen aus einem .pc2-Import. Profile, Schränkung und V-Form
  kommen weiter aus den Rippen des Tragflächendesigns. Wird die Segmentzahl danach geändert, fällt der Formenbau
  mit Hinweis auf die Trapeze zurück; jeder andere Import (FLZ, XFLR5 …) verwirft den gespeicherten Grundriss.
- Die Spitze kommt aus der Kurve selbst: Zwischenringe werden adaptiv gesetzt (die Ellipse hat an der Spitze eine
  senkrechte Tangente), ein parametrischer Randbogen wird bei glattem Grundriss nicht mehr angehängt.
- **Behoben (2026-09-28):** Blutrinne (und Sicke / Nasen-Huckel) liefen bei glattem Grundriss mit voller Höhe schräg der
  zur Spitze umbiegenden Endleiste nach und endeten dort mit einer senkrechten Wand (Keil-Artefakt). Als „Randbogen"
  gilt jetzt der Bereich, in dem Nasen- oder Endleiste steiler als 30° zur Spitze umbiegen; dort laufen sie wie am
  normalen Randbogen nach den Einstellungen „… in den Randbogen / Keil" aus (Anteil nach Länge in Spannweite).

## [1.5] — 2026-09-27
### Schneiden: eigene G-Code-Quelle „DXF-Formen" (2026-09-27)
- Im Reiter „Schneiden" gibt es jetzt die Quelle **DXF-Formen**. Bisher kamen DXF-Formen nur über „G-Code
  (Kern/Negativschale)" an, und auch nur dann, wenn im Reiter „G-Code" gerade DXF-Formen als Quelle gewählt war.
  „G-Code (Kern/Negativschale)" liefert jetzt nur noch Kern bzw. Negativschale. „✂ Schneiden" im G-Code-Reiter
  wählt bei DXF-Formen automatisch die neue Quelle.

### Behoben: Warnung „Vorschub überschritten" bei Außen-Vorschub „Maximum" (2026-09-27)
- Die 3D-Simulation warnte auch dann, wenn der Vorschub genau dem „Max. Vorschub" der Maschine entsprach. Ursache:
  Im G93-Modus wird die Geschwindigkeit aus dem gerundeten F zurückgerechnet (z. B. 500,01 statt 500). Die Warnung
  kommt jetzt erst, wenn der Vorschub wirklich darüber liegt (Toleranz 0,1 %, mind. 0,5 mm/min).

### DXF-Formen: Blockzuschnitt und Abstände vorne/hinten/oben/unten (2026-09-27)
- Je Segment **Abstand vorne, hinten, oben und unten** (Abstand der Blockkante zum Querschnitt, gemessen am
  Nennmaß ohne Abbrand) statt des bisherigen „Mindestabstands zum Profil" rundum. Alte Projekte übernehmen den
  bisherigen Abstand für alle vier Seiten.
- Feste **Blocklänge X** blendet den Abstand vorne aus, feste **Blockhöhe Y** den Abstand oben — beide werden dann aus
  dem Blockmaß berechnet angezeigt (rot, wenn der Block kleiner als der Querschnitt ist). Bezug bleiben hinten und
  unten (Nullpunkt). Eine feste Blockhöhe sitzt damit nicht mehr mittig um den Querschnitt, sondern ab dem Abstand unten.
- **Blockzuschnitt** für DXF-Formen: zwei senkrechte Schnitte bis Y0 an Blockvorderkante und hinterem Blockende, um den
  halben Abbrand ins Verschnittmaterial versetzt (Block steht genau auf Maß). Gesteuert über „Schnittreihenfolge"
  im Reiter „G-Code" (auch im Reiter „DXF-Formen" → Schnitt wählbar); „während Profilschnitt" läuft wie „vor".
- **Geändert:** Der DXF-Nullpunkt bezieht sich jetzt wie im Kerndesign auf den Rohblock — „Abstand in Flugrichtung X"
  hinter dem hinteren Blockende, „Höhe über Nullpunkt Y" unter der Blockunterkante (bisher auf die Schnittbahn).
  G-Code, 3D-Simulation und Blockgrenze passen damit zusammen. Sicherheitshöhe über der Blockoberkante.
- Die waagrechte An-/Abfahrt durch den Abstand hinten läuft mit Schnittvorschub statt mit dem Außen-Vorschub.

### Hinzugefügt
- Neuer Reiter **„Profildatenbank“** (`foildb.js`): jedes irgendwo geladene Profil landet automatisch in einer
  maschinenweiten Datenbank (`hotwing-profile.json` neben der Einstellungsdatei, im reinen Browser im
  Browser-Speicher). Vergleichen mit Kennwerte-Tabelle, Bearbeiten (Dicke/Wölbung/Endleiste/Punktzahl),
  NACA-4 anlegen, .dat-Export, in Wurzel/Segment einsetzen, frei benennbare Gruppen — die auch im neuen
  Aufklappmenü „aus Profildatenbank wählen“ im Tragflächendesigner erscheinen.
  JSON-Export/-Import; Funktion `foildb`. `launcher.py` und `electron/server.js` bedienen dafür `/__foildb__`.
- Werkstoff-Datenbank → **„Drahtversorgung“**: Interne Heißdrahtsteuerung oder **Externes Netzteil** mit Spannung (V)
  und Strom (A) als Kommentar im Kopf jedes G-Codes; der Heizstromausgang schaltet dann nur ein Relais mit festem
  Pegel. Die Abbrand-Kalibrierung zeigt bei externem Netzteil nur Punkt 1+2.
- `build_tool_electron.py`: Ziele **Linux** (AppImage) und **macOS** (`.app` im zip, Apple Silicon/Intel/beide).
  Unter Windows laufen beide in WSL („Linux-Werkzeuge einrichten" richtet node, electron und electron-builder
  ein), unter Linux/macOS direkt. CLI: `--target linux|mac [--arch arm64|x64|beide] [--distro …]`.
- `build_tool.py` (Browser-Variante): Ziel **Linux** — PyInstaller-Datei `dist/<Name>-linux`, in WSL gebaut.
  CLI: `--linux [--distro …]`. Gemeinsame WSL-Hilfen in `wslbuild.py`.
- Electron auf dem Mac: Einstellungen neben der `.app` (bei „Programme" in `Dokumente/AI Foam Cut`),
  Programm-/Bearbeiten-Menü für Cmd+C/V/Q. `icon/icon-1024.png` für das Mac-Symbol.

### Behoben
- `launcher.py`: Die Meldung „läuft im Browser" hält den Server jetzt auch unter Linux/macOS offen
  (vorher beendete er sich sofort); Browserstart ohne PyInstaller-Bibliothekspfad; kein Absturz ohne Bildschirm.

## [1.4] — 2026-09-25

Erste quelloffene Fassung. AI Foam Cut steht ab hier unter der GPL-3.0-or-later.

### Geändert
- Lizenz von proprietär (EULA) auf **GNU GPL v3.0 oder später** umgestellt.
- `README.md` neu geschrieben; die frühere Fassung ist als `ENTWICKLUNG.md` erhalten
  (Aufbau der Module, interne Zusammenhänge).
- `THIRD_PARTY_LICENSES.md` auf die tatsächlich noch enthaltenen Komponenten gekürzt:
  earcut (ISC), Python (PSF-2.0), Tcl/Tk, PyInstaller-Bootloader, Pillow.

### Hinzugefügt
- **Electron-Variante wieder dabei**, ohne Kopierschutz: eigenes Fenster statt Browser, eigener
  Dialog für serielle Ports. Start mit `npm start`.
- **`build_tool_electron.py`** neu geschrieben — baut die Electron-Ausgabe (Windows `.exe` und
  Linux AppImage) mit Funktionsauswahl und Profilen. Die Funktionslogik kommt aus `build_tool.py`,
  statt sie zu duplizieren. Vom alten Werkzeug (2700 Zeilen) sind Kunden, Bestellungen, Lizenzen,
  Demo-Verwaltung und Cloudflare-Anbindung nicht übernommen worden.
- `package.json` mit `"license": "GPL-3.0-or-later"`; das `private`-Flag ist weg.

### Entfernt
- **Reiter „Rippenfläche"** (`rippenflaeche.js`) samt Reiterknopf, Ansichts- und
  3D-Fenster-Markup sowie dem Eintrag in `features.json`. Die Rippenbauweise ist in der
  quelloffenen Fassung nicht enthalten.
- **Reiter „Aerodynamik"** (`aero.js`, `vlm.js`, `foil2d.js`, `neuralfoil.js`, `neuralfoil_data.js`).
  Grund: `vlm.js` enthielt eine zeilengetreue Portierung der Routine `VORVELC` aus
  [AVL](https://web.mit.edu/drela/Public/web/avl/) (© 2002 Mark Drela, Harold Youngren, GPL-2.0-or-later).
  Ein abgeleitetes Werk hätte die Lizenzwahl vorgegeben; ohne diesen Anteil ist der Code frei davon.
- **Lizenzprüfung aus der Electron-Variante**: `electron/license.js`, `trial.js`, `eula.js`,
  `license.html`, `preload-license.js`. `electron/main.js` ist dabei von 980 auf 441 Zeilen
  geschrumpft, `server.js` von 235 auf 153 (Lizenz-Endpunkte, Wasserzeichen-Einspritzung und
  Modul-Entschlüsselung entfallen), `platform.js` von 129 auf 67 (Uhr-Wache und Computer-Code
  entfallen). `config.js` enthält keine Schlüsselfelder mehr, und `EXPIRY` steht auf `null`.
- **Lizenz- und Kopierschutzkette**: `lizenz.py`, `build_tool_electron.py`, Demo-Uhrwache,
  EULA-Zustimmung, Online-Demo-Anbindung. Unter einer freien Lizenz gegenstandslos.
- Verkaufs-, Lizenz- und Demo-Teile der Website: `/api/demo`-Schnittstelle samt Worker-Skript
  und KV-Speicher, Design-/Vollversion, Demozugang, Lemon-Squeezy-Vorbereitung.

### Hinzugefügt
- **Website** (`website/`) als rein statische Seite neu aufgebaut: ein Programm statt
  Design-/Vollversion, gleichrangige Kästen für die fertige Windows-.exe und den Quellcode,
  neuer Abschnitt „Open Source“ (GPL, selbst bauen, mitmachen) und ein Abschnitt
  „Projekt unterstützen“ mit freiwilliger PayPal-Spende über einen einfachen PayPal.me-Link
  (paypal.me/AIfoamcut — kein PayPal-Skript, kein Zählpixel). Deutsch und Englisch.
- `rechtliches.html` an den freien Weg angepasst: Demo-Lizenz und Lizenzverwaltung
  entfallen, neuer Datenschutz-Abschnitt zur PayPal-Spende, Haftung und Urheberrecht auf
  die GPL-3.0 (Abschnitte 15–17) gestützt.
- `rechtliches.html` rechtlich nachgeschärft: **Grundlegende Richtung (Blattlinie)** im
  Impressum ergänzt (§ 25 Abs. 4 MedienG); die unzutreffende Zusage, Cloudflare liefere
  vorrangig aus EU-Rechenzentren aus, entfernt (dafür wäre die kostenpflichtige Data
  Localization Suite nötig, sie ist nicht gebucht); die Speicherdauer der Server-Protokolle
  richtiggestellt (keine eigenen Logfiles, die Protokolle entstehen bei Cloudflare); das
  technisch notwendige Sicherheits-Cookie von Cloudflare (`__cf_bm`) offengelegt, samt
  Begründung, warum es nach § 165 Abs. 3 TKG 2021 einwilligungsfrei und ohne Banner
  zulässig ist.

### Hinweis
Der vollständige Changelog der Vorgeschichte (Version 1.0 bis 1.3) ist nicht Teil dieses
Repositories, da er Geschäftsvorgänge dokumentiert. Die Funktionsgeschichte ist im
Benutzerhandbuch nachvollziehbar.
