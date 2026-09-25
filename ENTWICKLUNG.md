# HotWing — Tragflächen & 4-Achs-Heißdraht-CNC

Desktop-Werkzeug zum Entwerfen von Tragflächen und Erzeugen von G-Code für
CNC-Heißdrahtschneider (2 Türme / 4 Achsen) zum Schneiden von Styropor-/EPP-Kernen.

## Starten
`index.html` per Doppelklick im Browser öffnen (Chrome/Edge/Firefox). Keine
Installation, kein Internet nötig — alles läuft lokal.

## Funktionen
- **Mehrsegment-Flügel**: eine Wurzel + beliebig viele Segmente (Trapezflügel
  mit Knick, Mehrfachzuspitzung). Segmente hinzufügen/entfernen/verschieben.
  Jedes Segment wird als **eigener Kern** geschnitten (eigener G-Code-Block).
- **Profile pro Segment**: Jedes Segment wählt sein **Außenprofil** (NACA
  generieren oder `.dat` importieren, Selig- & Lednicer-Format). Das Innenprofil
  ist automatisch das Außenprofil des vorherigen Segments → **die Stöße sind
  per Konstruktion immer stetig** (an jedem Stoß genau ein Profil).
- **Flügelgeometrie je Segment**: Außensehne, Segment-Spannweite, Pfeilung
  (LE-Versatz), Schränkung (washout) um frei wählbaren Drehpunkt (z.B. t/4).
- **Profile nur per `.dat`-Import** (kein NACA-Generator in der UI).
- **Sauberer Profilimport**: Das Resampling nutzt einen nicht-uniformen
  Catmull-Rom-Spline mit Cosinus-Verdichtung an Nasen- und Endleiste. Auch grob
  aufgelöste `.dat`-Dateien bekommen dadurch eine runde, facettenfreie
  Nasenleiste (statt der früheren linearen Interpolation).
- **Offene (stumpfe) Endleisten** werden unterstützt: die oberen/unteren
  TE-Endpunkte bleiben exakt erhalten, der TE-Spalt bleibt offen und die
  kerf-Kompensation weitet ihn korrekt.
- **Schnittverlängerung Nasenleiste** (Steg für saubere Ein-/Ausfahrt): Länge je
  Segment; die *Art* global wählbar: `X-Schlaufe an der Nase`,
  `Horizontal nach vorne` oder `Keine`.
    Die X-Schlaufe ist **symmetrisch zur Mittellinie** (Sehne LE→TE): der Draht
    kommt über die Oberseite an der Nase an und fährt dann
    1. `A` mm **schräg unter dem Winkel** (Standard 45° zur Mittellinie) nach
       vorn-unten, 2. `B` mm **parallel zur Mittellinie nach vorne**,
    3. **senkrecht nach oben** über die Mittellinie zum Spiegelpunkt,
    4. `B` mm parallel zurück (Spiegel von 2) und 5. schräg zurück zur Nase
       (Spiegel von 1) — damit endet er exakt wieder auf der Nase und schneidet
       dann die Unterseite bis zur Endleiste. `A` (Schräge) / `B` (parallel)
       je Segment, Winkel global. Die senkrechte Höhe ergibt sich aus
       `2·A·sin(Winkel)`.
  - Endleiste (TE): **Steg hinter der Endleiste**, Länge je Segment, *Art* global
    wählbar. Der Steg setzt an der **Kern**-Endleiste an (dort endet der
    Konturschnitt) und läuft **ausschließlich nach hinten** — er taucht nicht nach
    vorne in den Bereich zwischen Kern- und Profil-Endleiste (siehe „Übergang an
    der Endleiste"). Die **Länge zählt ab der PROFIL-Endleiste**, damit der Steg
    beplankungsunabhängig gleich weit heraussteht (Blockfreigang).
    - `Horizontal (2 Stege)` *(Standard)*: **zwei waagrechte Stege**, jeder auf der
      Höhe seiner Kern-Endleisten-Ecke (oben/unten), hinten durch eine senkrechte
      Kante geschlossen. Das ist **exakt die Logik des Negativschalendesigns**,
      das den Kern mit Beplankungsabzug beplankungsunabhängig sauber schneidet.
      Bei scharfer Kern-EL fallen beide Höhen zusammen → ein Steg als Linie.
    - `Entlang Skelettlinie (gekrümmt)`: wie „Horizontal", aber beide Stege folgen
      der **Krümmung der Skelettlinie des Ausgangsprofils**. Innerhalb des Profils
      folgt der Verlauf der echten Skelettlinie; **hinter der Profil-Endleiste
      läuft er gerade (tangential) weiter** statt sich weiter zu krümmen. Der
      waagrechte Verlauf wird um die y-Abweichung der Skelettlinie gebogen; die
      Stege bleiben parallel und knickfrei am Ansatz. Die Verlängerung erhält die
      **dreifache Stützpunktzahl**, damit S-Schlag-Profile sauber rund aufgelöst
      werden.

    Der Steg ist nullbreit bzw. offen; erst die kerf-Kompensation macht daraus
    einen kerf-breiten Schlitz.

### Übergang an der Endleiste
Sobald Beplankung abgezogen wird, ist der **Kern kleiner als das Profil** — seine
Endleiste liegt weiter **vorne** als die Profil-Endleiste. Ein Steg, der von der
Kern-EL aus nach vorne zur Profil-EL liefe, würde in diesen Zwischenbereich
eintauchen und dort einen fehlerhaften Anschluss erzeugen. Deshalb läuft der Steg
**nur nach hinten**, gerade aus der Kern-EL heraus.

Die robuste Standard-Lösung ist aus dem **Negativschalendesign** übernommen (das
Kerne mit Beplankungsabzug seit jeher sauber schneidet): Der Draht fährt auf der
**Höhe der oberen Kern-Endleisten-Ecke** waagrecht ans Profil, schneidet die
Kontur und fährt auf der **Höhe der unteren Ecke** waagrecht wieder heraus. Zwei
parallele Waagrechte können sich nicht kreuzen und tauchen nicht ins Profil — das
Ergebnis ist unabhängig von der Beplankungsdicke sauber.
  - Der Kern wird in einem Zug geschnitten, beginnend/endend am Steg hinter der
    Endleiste.
- **Maschine/Block**: Turmabstand, Blockposition, Schnittspalt (kerf) mit
  automatischer Kontur-Kompensation (Versatz nach außen um kerf/2).
- **Heißdraht-Projektion**: Wurzel- und Randprofil werden synchron (gleicher
  Punktindex) auf beide Turmebenen projiziert — der Draht schneidet exakt durch
  beide Profile.
- **Vorschub** = Geschwindigkeit auf der **Schnittspur** (Wurzelrippe); die
  Steuerung regelt die Türme, um dieses Tempo zu halten. Option **konstante
  Geschwindigkeit auf der Schnittspur**: F bleibt dann **konstant = Vorschub**
  (flacher Verlauf, keine Vorschub-Spitzen). Jede Schnittzeile trägt als Kommentar
  die **tatsächlichen Portal-Geschwindigkeiten** (`Portal XY=… AZ=… mm/min`) —
  so ist sichtbar, wie schnell das äußere Portal real läuft.
- **Geschwindigkeit außerhalb Block** (Reiter „G-Code"): für die Anfahr-/Auslauf-
  Züge in Luft wählbar — `Maximum` (Maschinen-Grenze), `Gleich wie Schnitt` oder
  `Freie Wahl`. Der **Max.-Vorschub** (Reiter „Maschine") deckelt in jedem Fall
  alle Züge; da F die Geschwindigkeit des schnelleren (äußeren) Portals begrenzt,
  wird die Maschinengrenze am Außenportal beim Anfahren nie überschritten.
- **G-Code**: konfigurierbare Achsnamen (Standard `X Y` links, `A Z` rechts),
  Header/Footer, Nachkommastellen. Export als `.gcode` oder Zwischenablage.
- **Projekt speichern/laden** als JSON.
- **Maschinensteuerung direkt in der App** — Ansicht „Maschine": Steuerung
  wählbar zwischen **grblHAL** und **Mega 5X** (rcKeith „GRBL HotWire Mega 5X",
  Fork von grbl-mega-5x 1.2). Beide sprechen dasselbe GRBL-Protokoll, deshalb
  nutzt die App denselben Treiber; das Profil setzt nur Bezeichnung, Default-
  Baudrate und max. Drahtleistung. Web-Serial-Verbindung zum Board (Chrome/Edge),
  DRO, Handfahrt, Drahtheizung
  (`M3 S`/`M5`), Streaming des erzeugten G-Codes mit Pause/Stopp, Konsole/MDI und
  Not-Halt (Feed Hold). Der Knopf **GRBL Einstellungen** öffnet das `$$`-Menü des
  Boards: alle Settings werden ausgelesen, können gefiltert, einzeln geändert und
  zurückgeschrieben werden (auch direktes `$n=Wert`).

## Ansichten
In **allen** Ansichten: Mausrad = Zoom (auf den Zeiger), Ziehen = Verschieben,
Doppelklick = Zurücksetzen.

- **Tragfläche** — Grundriss und Aufriss **übereinander** in einem Reiter:
  oben die Draufsicht (**Flugrichtung oben**, inkl. t/4-Linie), unten die
  Ansicht von vorne mit der V-Form (je Station Höhe und Winkel). Zoom/Pan
  wirken je Ansicht getrennt.
- **Profile** — alle Stationsprofile überlagert, dazu schaltbar die
  Beplankungslinie, die Schnittspur inkl. kerf und Punktnummern.
- **G-Code** — links die **3D-Simulation**, rechts der Programmtext.
  Die Simulation zeigt beide Türme mit ihren fahrenden Achsen, den **kompletten
  Schneideweg jedes Turms** (die Bahn in seiner Ebene — blau links, orange
  rechts; Eilgänge blass gestrichelt), den gespannten Heißdraht und den
  Styroporblock dazwischen und fährt das Programm ab: die bereits geschnittene
  Fläche wächst mit, der Programmtext scrollt mit. Simuliert wird der erzeugte
  G-Code selbst (inkl. Vorschüben), die Laufzeit entspricht also der Maschine —
  Tempo 1×…200×, Schieberegler zum Spulen. Schaltbar: Türme, Schneidewege,
  Block, Schnittfläche. Ziehen = drehen, Shift+Ziehen = verschieben,
  Rad = Zoom, Doppelklick = zurück. Bei „Alle Segmente" wechselt der Block
  mit dem laufenden Segment.
  Der Programmtext ist zeilennummeriert; die **gerade ausgeführte Zeile wird
  hervorgehoben** und scrollt mit der Simulation mit. **Vorschub-Sprünge**
  (der Vorschub weicht zwischen zwei aufeinanderfolgenden Schneidzügen um ≥ 10 %
  ab) werden **rot markiert** und in der Kopfzeile gezählt — sie weisen auf
  Bahnknicke oder zu kurze Segmente hin (ungleichmäßiger Schnitt).
- **Maschine** — Steuerpendant (grblHAL / Mega 5X wählbar): Verbindung, Position,
  Handfahrt, Drahtheizung, Programm-Streaming, Konsole, Not-Halt und
  `$$`-Einstellungen.

Der **Styroporblock** wird (schaltbar) in allen Ansichten dargestellt. Seine
**Länge in Spannweite = Segment-Spannweite** (automatisch). Die Sehnen-
Ausdehnung ergibt sich aus **Verlängerung vor der Nase** und **hinter der
Endleiste**, jeweils getrennt für **Wurzel- und Außenprofil**. Das Außenende
kann absolut angegeben oder **proportional zur Sehne** geschaltet werden
(`Verlängerung_außen = Verlängerung_Wurzel · Sehne_außen/Sehne_Wurzel`) —
getrennt für Nasen- und Endleiste. So folgt der Block als **Trapez** der
Kontur beider Enden. Die **Block-Höhe** bleibt je Segment frei einstellbar.

## Beplankung & kerf — Reihenfolge
Die Kette ist bewusst in dieser Reihenfolge aufgebaut:

1. **Endkontur** (importiertes Profil, auf Sehne skaliert)
2. **− Beplankungsdicke** → Oberfläche des Schaumkerns, anschließend an der
   Endleiste **getrimmt** (siehe unten)
3. **+ Schnittverlängerungen** (Nase und Endleiste)
4. **+ kerf/2** → tatsächliche Drahtbahn

### Trimmen an der Endleiste
Beim Offset nach innen wandert die Oberseite nach unten und die Unterseite
nach oben. An der dünnen Endleiste laufen beide übereinander hinweg — es
entsteht ein „Fischschwanz" aus sich kreuzenden Linien. Diese Überschneidungen
werden erkannt, die Kontur wird exakt am Schnittpunkt zusammengeführt und die
überstehenden Enden entfallen. Das Verfahren läuft iterativ, weil bei dicker
Beplankung mehrere solcher Schlaufen entstehen können (getestet bis 6 mm).

Danach wird die Kontur auf die ursprüngliche Punktzahl zurückgerechnet: das
Trimmen entfernt bei Wurzel und Rand unterschiedlich viele Punkte, und ohne
diesen Schritt würden die beiden Turmbahnen entkoppeln.

Schritt 4 läuft über Kontur *und* Verlängerungen zusammenhängend — sonst
blieben die Stege unkompensiert.

## V-Form (Höhe der Profilsehne)
Je Segment wahlweise als **Höhe in mm** (Außenende über Innenende) oder als
**Winkel in Grad relativ zum vorherigen Segment**. Die Winkel summieren sich
über die Segmente; im mm-Modus wird der zugehörige Winkel mitgeführt, sodass
sich beide Modi mischen lassen.

Dargestellt wird die V-Form im **Aufriss**, in der **Profilansicht** (jede
Station auf ihrer Einbauhöhe) und in **Draht & Türme** (gestrichelte
Einbaulage-Überlagerung). Schaltbar über „V-Form (Einbaulage)".

### Zwei Betriebsarten
**Standard (Einbaulage):** Die V-Form ist eine reine Einbaulage, keine
Schnittgeometrie — jedes Paneel wird flach aus seinem Block geschnitten, die
V-Form entsteht erst beim Zusammenbau (Anschlussrippen anschrägen bzw. Paneele
im Winkel verkleben). Die Bewegungsbefehle sind dann bei 0 mm, 40 mm und 6°
V-Form zeichengleich, während die Gegenprobe (Schränkung) sie erwartungsgemäß
ändert.

**„V-Form in den Schnitt einrechnen" (Global):** Ist die Option aktiv, wird die
V-Form direkt ins Werkstück geschnitten. Wurzel- und Außenprofil werden dazu in
der Höhe gegeneinander versetzt (Wurzel um −Höhe/2, Außen um +Höhe/2, die
Sehnenlinie steigt also um die volle V-Form-Höhe über die Spannweite), sodass
der Draht das Paneel schräg aus dem Block schneidet und die V-Form ohne Anschrägen
der Rippen entsteht. Der G-Code ändert sich entsprechend. Beachte: Der Block muss
hoch genug sein, um das gekippte Paneel aufzunehmen.

**Wichtig für die Praxis:** `Segment-Spannweite` wird als **Paneellänge**
verwendet, nicht als horizontale Projektion. Wenn du deine Spannweite aus einer
Draufsicht (projiziert) entnimmst, ist die tatsächliche Paneellänge bei V-Form
etwas größer: `Länge = Projektion / cos(V-Winkel)`.

## Wichtige Hinweise zur Fertigung
- **Achszuordnung prüfen!** Standard: linker Turm `X`(horizontal)/`Y`(vertikal),
  rechter Turm `Z`(horizontal)/`A`(vertikal). An deine Steuerung anpassen (viele nutzen `X Y U V` oder
  `X Y A Z`). GMFC/DevWing-Nutzer: Achsnamen entsprechend setzen.
- **Kerf** hängt von Drahttemperatur, -durchmesser und Vorschub ab — an einem
  Probeschnitt kalibrieren. Typisch 0,8–2,0 mm.
- **Maschinennullpunkt (0/0):** liegt **hinter der Tragfläche, unten auf der
  Blockunterkante** — `X=0` an der Block-Hinterkante (Endleistenseite), `Y=0`
  an der Block-Unterkante. Der Flügelkörper liegt damit in **negativem X**
  (Nase nach vorne), der EL-Steg ragt leicht ins Positive; alle
  `Y` sind ≥ 0. Es wird nur verschoben, nicht gespiegelt — die Schnittkontur
  bleibt unverändert. Der Maschinennullpunkt liegt **immer hinten/unten am
  Block**; der Abstand in X (Nullpunkt ↔ Block) ist im Reiter „Maschine"
  wählbar. Die Sicherheitshöhe = Blockhöhe + „Sicherheitshöhe über Block"
  (Reiter „Werkstoff").
- **Schnittreihenfolge** (Reiter „Maschine"): Der „Blockschnitt" ist ein
  vertikaler Vorschnitt an Blockvorderkante und Nasenleiste (je auf Null).
  Vier Modi:
  - *Blockschnitt vor Profilschnitt* — erst Vorschnitt, dann Profil.
  - *Blockschnitt nach Profilschnitt* — erst Profil, dann Vorschnitt.
  - *Nur Blockschnitt* — kein Profilschnitt.
  - *Ohne Blockschnitt* — der Draht fährt hinten am Nullpunkt auf Höhe der
    EL-Verlängerung, horizontal von hinten ins Profil, schneidet die
    Kontur, fährt horizontal zurück und dann vertikal auf Null (kein
    senkrechtes Eintauchen von oben).
- **Profilzug:** Der Draht beginnt an der Endleiste und schneidet **zuerst die
  Oberseite** zur Nase, dann über die Unterseite zurück.
- Pro Segment wird **ein** Kern erzeugt. Über „Segment"-Auswahl (Vorschau &
  Export) wählst du, welches Segment als G-Code kommt — oder „Alle" für eine
  Datei mit allen Segmenten nacheinander (je eigenes Programm mit `M2`).
- Für die zweite Flügelhälfte Blockseite tauschen bzw. Profile spiegeln.

## Als echte .exe (optional, später)
In Electron verpacken:
```bash
npm init -y
npm i -D electron electron-builder
# main.js: BrowserWindow lädt index.html
npx electron-builder --win
```

### Linux-Ausgabe (AppImage)
Dieselbe Anwendung läuft unverändert unter Linux — alle Unterschiede stehen in
`electron/platform.js` (Ordner der portablen Ausgabe, Ablagen im Benutzerprofil,
Rechnerkennung aus `/etc/machine-id`, Symbol als PNG).

Gebaut wird im Build-Tool im Reiter **„Linux-Ausgabe"** (oder
`python build_tool_electron.py --profile NAME --linux`). Ein AppImage lässt sich
unter Windows nicht packen, deshalb läuft der Bau in WSL; der Reiter richtet die
Werkzeuge dort auf Knopfdruck ein. Auf dem Zielrechner braucht ein AppImage
`libfuse2`, die Maschinensteuerung zusätzlich die Gruppe `dialout`.

## Dateien
| Datei | Inhalt |
|-------|--------|
| `index.html` | Oberfläche/Layout |
| `airfoil.js` | NACA-Generator, `.dat`-Parser, Resampling |
| `wing.js`    | Flügelpaneel (Sehne, Pfeilung, Schränkung in mm) |
| `hotwire.js` | Turm-Projektion, kerf-Kompensation, G-Code |
| `sim3d.js`   | 3D-Schnittsimulation (G-Code-Parser + eigener Renderer) |
| `grbl.js`    | grblHAL über Web Serial: Streaming, Jog, `$$`-Editor |
| `core.js`    | Zustand (`state`), Segment-Vorlage, Übersetzungs-Helfer, Farbpaletten/Strichtypen – lädt als erstes Modul |
| `cad.js`     | Reiter „CAD-Bearbeitung": 2D-Editor, erweiterte Befehle, Befehlszeile *(abwählbare Funktion `cad`)* |
| `gcode.js`   | G-Code-Erzeugung Kern + Negativschale |
| `spars.js`   | Holmausschnitte und Taschen |
| `ribs.js`    | Rippendesigner, Nasenschablone, Rippen als STL *(abwählbare Funktion `rib`)* |
| `dxfshapes.js` | Reiter „DXF-Formen" mit Ansicht/Grundriss, Schneidepfad-Punkteditor, DXF-Export *(abwählbare Funktion `dxfshapes`)* |
| `filesys.js` | Dateizugriff (File System Access), Projekt laden/speichern, Einstellungen, Lade-/Speichermenüs |
| `render.js`  | Zoom/Pan, verschiebbare Overlays, Canvas-Helfer, Ansichten, Hauptrendering |
| `sidebar.js` | Sidebar-Aufbau, UI-Bausteine, Funktionsbeschreibungen, Notizen |
| `compute.js` | Berechnung (Schnittdaten), Segment-Operationen, Einlauf, Kern stapeln |
| `ptedit.js`  | Punkte-Editor (Kern-/Negativschale) |
| `profedit.js` | Profilbearbeitung (Modal) |
| `app.js`     | Nur noch Tabs/Verdrahtung und Start (Reihenfolge der Initialisierung) |

Die Module `core.js` … `sidebar.js` sind aus `app.js` ausgelagert (Skripte in `.claude/split_*.py`).
Sie tauschen Namen über das Registry-Objekt `window.App` aus: jede Datei registriert ihre
Top-Level-Namen am Ende, bindet Namen früher geladener Dateien am Anfang per
`const { … } = App;` und greift auf die später geladene `app.js` mit `App.<name>` zu.
Ladereihenfolge in der HTML beachten: `core.js` vor allen Modulen, `app.js` zuletzt.

### Abwählbare Funktionen (Demo-Bau)
`features.json` beschreibt, welche Dateien zu einer optionalen Funktion gehören; alles Übrige ist der
Kern und steckt in jeder exe. Je Funktion: `files` (Dateien), `tabs` (Reiterknöpfe), `views`
(`<div class="view">`-Blöcke), `requires` (vorausgesetzte Funktionen), `demo` (kann als „nur Demo ohne
Export" gebaut werden) und `kern_bis` (gehörte bis dahin zum Kern — für alte Build-Profile).
Die Build-Tools entfernen Skript, Reiter und Ansicht; zur Laufzeit stehen `window.FEATURES` und
`window.BUILD_INFO` bereit. Zusätzlich gibt es den Schalter **„Kern: nur Demo"** (Profil-Schlüssel
`demo_kern`, Pseudo-Funktion `kern` in `BUILD_INFO.demo`): dann schreibt das Programm keine Datei mehr
und gibt keinen G-Code heraus — gesperrt wird zentral in `saveFilePicker`/`anchorDownload`/
`exportViaPicker`, und jede Funktion schaltet automatisch mit auf „nur Demo". Rechnen, Anzeigen,
Simulation und der Maschinenbetrieb (Schneiden) bleiben vollständig nutzbar. Andere Module dürfen eine optionale Funktion **nur geschützt** aufrufen
(`if (App.renderCad) …`), und jeder Reiter bringt seine Verdrahtung selbst mit (`cadWireUp()`,
`dxfWireUp()`, `ribWireUp()` — von `app.js` geschützt aufgerufen). Export-Sperre einer Demo:
`const DEMO = App.demoFeature('cad', '…'); if (DEMO.blocked()) return;`

## Roadmap-Ideen
- Elliptischer Grundriss, verrundete Randbögen
- Verjüngter Draht-Nachlauf (tip lag) bei stark unterschiedlichen Sehnen
- Negativschalen-Fräsen (3-Achs) als zweites Modul
