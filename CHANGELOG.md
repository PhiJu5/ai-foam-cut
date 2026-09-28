# Changelog

Alle nennenswerten Änderungen an **AI Foam Cut** werden hier dokumentiert.
Format angelehnt an [Keep a Changelog](https://keepachangelog.com/de/).
Neueste Einträge oben.

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
