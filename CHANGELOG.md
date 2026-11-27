# Changelog

Alle nennenswerten Änderungen an **AI Foam Cut** werden hier dokumentiert.
Format angelehnt an [Keep a Changelog](https://keepachangelog.com/de/).
Neueste Einträge oben.

## [2.16] — 2026-11-27

### Reiterleiste: neue Standard-Gliederung (2026-11-27)
- Die Reiterleiste startet jetzt in dieser Gliederung: Projektübersicht · „Aero“ (Profildatenbank) · „Tragflächen“ (Tragflächendesigner, Kerndesign, Negativschalendesign, Formenbau) · „Rumpf“ · „Komplexe Formen“ · G-Code · Schneiden · Maschine · „Spezial Module“ (Ausschnitte, Schriften, Decals, Fräse, Drehachse, Projektbibliothek) · CAD-Bearbeitung · neu „Tragflächen Spezialmodule“ (Verbinderform, Ballastbox, Steghöhen, Flächenservos, Servorahmen, Laminierplan, Rippendesigner, Bauanleitung) · neu „Flugzeug“ (Flugsimulator, Tragflächenständer, Flugzeug gesamt).
- Eine eigene Gliederung aus Einstellungen → Menüleiste bleibt erhalten; „Standard wiederherstellen“ setzt auf die neue Gliederung zurück. Englischer Menüname „Wing special modules“.

### Kern vorne/hinten teilen: Lage in mm, Fuge in der Draufsicht, Holme auf der Fuge werden mitgeteilt (2026-11-27)
- **Lage der Trennfuge wahlweise in mm:** „Lage angeben in“ „% der Sehne“ oder „mm an der Wurzel“ (ab Nase an der Wurzelrippe des Segments). Außen liegt die Fuge dann beim selben Anteil der Sehne (proportional). Beim Umschalten bleibt die Fuge, wo sie ist; „Automatisch: kürzester Verfahrweg“ schreibt den mm-Wert mit.
- **Draufsicht (Grundriss) im Kerndesign:** Die Fuge erscheint je geteiltem Segment als Linie von der Wurzel- zur Außenrippe, mit Maß ab Nase an beiden Enden, dazu Klebefuge und Rohblockkanten der Teile.
- **Holme auf der Fuge werden mitgeteilt** — vor allem nicht proportionale Holme, die die Fuge schräg kreuzen: Teil vorne schneidet die Vorderseite, Teil hinten die Rückseite. Jedes Teil fährt dazu genau die Drahtbahn des ungeteilten Schnitts überall, wo sie sein Material berührt; Stücke, die an beiden Rippen jenseits der Fuge liegen, werden knapp hinter der Fuge abgekürzt. Gilt für Holme „während des Schnitts“ (auch nicht proportional über den Kern), „nach dem Schnitt“, „nach Oberseitenschnitt“, „nur Holmausschnitte“ und für Gurttaschen. Ein- und Ausstich eigenständiger Holmschnitte liegen dann jenseits der Fuge im Verschnitt. Statt der Warnung „Fuge verschieben“ steht jetzt der Hinweis, welcher Holm geteilt wird.
- Liegt ein geteilter Holm an einer Rippe ganz jenseits der Fuge, wird er dort trotzdem ganz umfahren (sonst bliebe im Holmkanal ein Schaumkeil stehen); der Nullpunkt auf der Fugenseite berücksichtigt das, kein Portal muss deshalb hinter Null.
- **Simulation:** Beim geteilten Kern endet die blaue Schnittfläche am Rohblock des Teils (+2 mm). Jenseits davon fährt der Draht nur durch Luft; geteilte Holme standen vorher aus dem Block heraus.
- **Fix Schnittrichtung „von vorne“, auch ohne Teilung:** Welches Ende eines Zugs am Nullpunkt liegt, wurde am linken Turm entschieden. Bei stark extrapolierten Turmbahnen (tiefe Wurzel, starke Zuspitzung, Turm weit außerhalb) kehrt sich diese Bahn um. Dann lief die Oberseite „Endleiste → Nase“ und fuhr dabei waagrecht durch den ganzen Block. Jetzt entscheidet die Wurzelrippe. Beim geteilten Kern traf das das hintere Teil mit Holm auf der Fuge.
- Geprüft: 96 Fälle mit Holm auf der Fuge (Loch-Holm nicht proportional „während“/„nach“/„nach Oberseite“, proportional mittig auf der Fuge, Gurttasche, Kreuzung in beide Richtungen; von vorne/hinten; kleiner und tiefer Flügel; mit/ohne Klebefuge). Aus dem G-Code beider Teile die Drahtlage an fünf Stellen der Spannweite zurückgerechnet und im Material jedes Teils mit dem ungeteilten Schnitt verglichen: Abweichung unter 0,001 mm. Ohne Holm auf der Fuge sind 288 Programme byte-gleich zum Stand davor; die Wurzelrippen-Entscheidung ändert nur die genannten Fehlerfälle.

### Ballastbox: gerader Durchgang für den V-Verbinder (2026-11-27)
- **Fix Durchsteckblock und Kasten mit Hülse:** Bei V-Form folgte der Kanal dem Knick. Durch einen solchen Kanal lässt sich ein einteiliger V-Verbinder aber nicht durchschieben. Jetzt ist der Durchgang gerade und um halbe Kanallänge × Steigung je Seite höher: Höhe = Verbinder + Spiel + halbe Kanallänge × tan(V/2). Kanallänge ist die ganze Blockbreite (samt Schraubenaugen) bzw. die Hülsenlänge.
- In der Endlage liegt der Knick unten in der Mitte auf, die Enden oben an den Kanalenden, so dass der Verbinder ohne Kippspiel sitzt. Beim Durchschieben kippt er von flach in die V-Lage. Die Info rechnet die Höhe vor, die Planzeichnung nennt das Kanalmaß.
- Klemmschrauben, Lage der Ballastreihen (Block „zwischen den Reihen“: obere Reihe über der Kanaldecke) und Hülsenwand richten sich nach dem geraden Durchgang; ohne V-Form ändert sich nichts.
- Geprüft: Durchschieben für Verbinderhöhen 3–25 mm, V-Form 1–40°, Kanallängen 16–160 mm mit Spiel nachgerechnet (die Höhe reicht immer, ohne Spiel bleibt keine Toleranz). In 288 Fällen ist der Durchgang frei, und über dem Kanal liegt kein Material außerhalb der gerechneten Kanallänge. Hülse und Block 15 552, Block zwischen den Reihen 9072 Kombinationen: alle Teile geschlossen, Volumen exakt.

### Flugsimulator: fünf vorbildgetreue Scale-Segler aus FlightGear, Maßstab frei wählbar (2026-11-26)
- **Neu im Flugsimulator:** Rolladen-Schneider LS4, Schleicher ASK 21, Schleicher Ka 6 CR, Schempp-Hirth Arcus und Glaser-Dirks DG-300 als detaillierte 3D-Modelle aus dem FlightGear-Archiv (FGAddon, GNU GPL v2 oder später) mit Originallackierung, Glashaube, Cockpit (beim LS4 mit Pilot) und Fahrwerk. Sie ersetzen die selbst gebauten LS3-17 und Kobuz; alte Einstellungen springen auf LS4 bzw. ASK 21.
- **Maßstab im Simulator einstellbar** (Feld „Maßstab 1:“, je Segler gemerkt; Standard LS4/Ka 6/DG-300 1:3, ASK 21 1:3,5, Arcus 1:4). Spannweite, Fläche und Masse rechnen sich mit; die Flächenbelastung ist je Segler einstellbar. Der Hinweis zeigt die Spannweite beim gewählten Maßstab.
- **Ruder und Klappen bewegen sich:** Querruder bzw. Wölbklappen-Querruder, Höhen- und Seitenruder folgen den Knüppeln, die Schempp-Hirth-Bremsklappen fahren mit dem Gasknüppel aus (Drehachsen aus den FlightGear-Modelldaten, Ausschlagrichtung geprüft). Auch Steuerknüppel und Pedale im Cockpit gehen mit.
- **Darstellung:** Texturen mit Materialfarbe, durchsichtige Hauben werden zuletzt gezeichnet, anisotrope Filterung; weiße Modelle bekommen mehr Umgebungslicht.
- **Lieferung:** Die Modelle liegen als Datenpakete `fsim_ls4.js`, `fsim_ask21.js`, `fsim_ka6.js`, `fsim_arcus.js`, `fsim_dg300.js` (zusammen rund 5 MB) bei und gehören zur Funktion „Flugsimulator“ in `features.json`. Erzeugt werden sie mit `.claude/fg_glider_convert.py` aus den unveränderten FGAddon-Dateien; Nachweis in `THIRD_PARTY_LICENSES.md` (Abschnitt 20).

### Flugsimulator: Segler nach Vorbild neu gebaut, Kunstflugsegler SZD-21 Kobuz 3, felsiger Startplatz an der Kante (2026-11-26)
- **LS3-17 nach Originalfotos neu aufgebaut:** einfach trapezförmiger Flügel (vorher fälschlich mit Knick) 0,93 → 0,47 m plus rote 17-m-Ohren mit Randbogen, Mitteldecker. Der Rumpf entsteht jetzt aus Seiten- und Draufsicht des Originals (6,86 m, schlank, spitze Nase): große, bündige Glashaube, rote Nasenkappe, roter Zierstreifen, Schriftzug „LS3-17“ und Kennzeichen am Leitwerksträger, gepfeiltes Seitenleitwerk mit roter Spitze und festem T-Höhenleitwerk, Hauptrad und Sporn.
- **Neuer Kunstflugsegler „SZD-21 Kobuz 3 (4 m)“** im Maßstab 1:3,5 (14 m Original): Schulterdecker mit trapezförmigem Flügel und Normalleitwerk, lange Haube bis zur Flügelnase, Seitenruder bis unter den Rumpf. Originalbemalung nach dem Exemplar im Luftfahrtmuseum Krakau: weiß, Seitenruder und Spitzen rot, schwarzes „SP-2499“ am Rumpf und unter dem linken Flügel, „-KOBUZ-3-“ an der Nase. 110 dm², 7 kg, rollt deutlich schneller als der LS3, Bremsklappen auf dem Gasknüppel.
- **Darstellung aus der Nähe:** Die Flügeloberseiten der eingebauten Modelle erschienen grau, weil ihre Flächennormalen nach innen zeigten. Die Normalen werden jetzt nach außen gedreht, und die Beleuchtung ist beidseitig. Neu ist ein Glanzlicht für Gelcoat sowie eine Glashaube mit Himmelsspiegelung. Beschriftungen liegen als Textur auf dem Rumpf und stehen auf beiden Seiten richtig herum.
- **Hochalpiner Grat: Startplatz an der Kante.** Der Pilot steht jetzt auf einer kleinen Felskanzel direkt an der Abbruchkante; vor ihm fällt die Flanke sofort steil ab, so dass er das Modell auch tief vor dem Hang sieht. Rund um den Startplatz liegen unregelmäßige Felsblöcke und Felsplatten, der Blick nach vorn bleibt frei.

### Flugsimulator: hochalpines Hangflug-Gelände und Scale-Segler LS3-17 mit 5 m (2026-11-26)
- **Neues Gelände „Hochalpiner Grat (Hangflug im Gebirge)“** unter Landschaft. Der Pilot steht knapp vor einem Grat, die Luvflanke fällt mehrere hundert Meter ins Tal (oben felsig und steil, unten flacher, mit Rippen und Rinnen). Rechts ein Gipfel mit Gipfelkreuz, links eine Scharte, hinter dem Startplatz eine Berghütte, gegenüber und dahinter weitere Bergketten mit Schnee. Wald wächst bis zur Baumgrenze, darüber Alpwiese, Geröll, Fels und Schnee je nach Höhe und Neigung. Sichtweite bis 12 km, tiefblauer Himmel.
- **Einstellbar:** Grathöhe über dem Tal (200–1500 m, Standard 700 m) und Flankenneigung (20–60°, Standard 40°). Der Talboden liegt auf 1700 m, der Grat damit standardmäßig auf 2400 m über dem Meer.
- **Dünne Luft:** Im Gebirge rechnet der Simulator mit der Luftdichte der Normatmosphäre in der jeweiligen Flughöhe (am Grat rund 0,97 statt 1,23 kg/m³). Die Modelle fliegen spürbar schneller, die Anzeige zeigt Höhe über dem Meer und Luftdichte.
- **Hangwind im Gebirge:** Der Aufwind folgt der Flanke wie am Hang, an steilen Felsflanken aber gedämpft (Sinus statt Tangens der Neigung). Das Aufwindband reicht mehrere hundert Meter hoch. Hinter dem Grat (Lee) gibt es kräftiges, böiges Sinken. Bei 6 m/s Wind steigt ein Segler vor der Flanke um 2–4 m/s.
- **Neues Flugzeug „Scale-Segler LS3-17 (5 m)“:** Rolladen-Schneider LS3-17 im Maßstab 1:3,4, 5,00 m Spannweite, rund 98 dm², Streckung 25, 2,0 m lang. Doppeltrapezflügel mit 3° V-Form und gewölbtem Profil, Rumpf mit langer Haube und rotem Zierstreifen, gepfeiltes Seitenleitwerk mit T-Höhenleitwerk, rote Randbögen, Hauptrad. Flächenbelastung Standard 95 g/dm² (9,3 kg).
- **Bremsklappen beim LS3-17** auf dem Gasknüppel bzw. W/S: Die Schempp-Hirth-Klappen fahren sichtbar aus der Flächenoberseite, kosten Auftrieb und erhöhen den Widerstand deutlich (Gleitzahl rund 31 → 7). Die Anzeige links unten heißt dann „Bremse“.
- Gerechnet: Der LS3-17 gleitet in Bodennähe rund 1:31 bei 67 km/h mit 0,6 m/s Sinken; der Pilot sieht vom Startplatz aus in die Flanke hinunter.

### Ballastbox: Verbinder nach vorn versetzen, Block mit Verbinder zwischen den Reihen (2026-11-26)
- **Box zum Aufschieben:** Neuer Wert „Verbinder nach vorn versetzt“ in „Kasten und Aufnahme“. Anschlagwand, Lippe und Verbinder rücken nach vorn, der Kasten reicht hinter den Verbinder. Ein Knopf setzt den Versatz so, dass die Verbindermitte genau über der Ballastmitte liegt (Schwerpunkt in Flugrichtung unverändert).
- **Lippe nach hinten:** Bei Versatz läuft die Lippe standardmäßig als Platte bis zur Kastenkante durch. Dann liegt das Klettband auf, und der Druck auf der Rückseite bleibt ohne Stützen, weil die Anschlagwand nur die Verbinderhöhe überbrückt. Abgeschaltet lässt sich die Länge hinter der Anschlagwand frei wählen, auch 0 = keine. Die Box wird dann auf der Seite liegend gedruckt.
- **Anschlagwand und Lippe getrennt:** Die Stärke der senkrechten Anschlagwand ist ein eigener Wert. Bisher galt „Stärke Anschlagwand und Lippe“ für beide; gespeicherte Projekte übernehmen den alten Wert für beide.
- **Durchsteckblock:** Neue Auswahl „Lage des Verbinders“ mit „Zwischen den Reihen (Ballast darüber und darunter)“. Die Reihen werden oben und unten auseinandergerückt, der Kanal läuft mittig dazwischen und mittig über die Ballastlänge. Der Block wird dadurch kürzer, der Schwerpunkt liegt in Flugrichtung auf der Verbindermitte. Die Klemmschrauben sitzen im Steg zwischen den Reihen. Bei ungerader Anzahl liegt die zusätzliche Reihe unten; die V-Form ist im Abstand zur oberen Reihe berücksichtigt. Gilt auch für Rundmaterial (Raster/versetzt, gerundete Außenform) und ohne Trennwände.
- **Bündiger Deckel rundum geschlossen:** Bei der Box mit Hülse (Druck wie eingebaut) und bei der seitlich gedruckten Box zum Aufschieben hatte der bündige Deckel an der Druckbettseite keinen Rand. Jetzt hat er wie sonst auf allen vier Seiten einen gleich langen Rand, der Kasten ist vorn rundum eingezogen. An der Druckbettseite hängt dieser Absatz beim Druck frei: Die Info sagt das und empfiehlt dort eine kleine Stütze oder den übergestülpten Deckel (dann ganz ohne Stützen). Geprüft: keine Überschneidung von Deckel und Kasten.
- **Fix Klemmschrauben (Hülse und Block):** Die eingelassene Sechskantmutter saß vorn an der Stirnseite. Beim Spannen drückt die Gegenkraft der Schraube die Mutter aber nach vorn, also aus der offenen Tasche heraus. Die Mutter sitzt jetzt direkt am Verbinderkanal und wird von dort eingelegt, die Kraft geht ins Material. Einschmelzmutter und Kernloch bleiben vorn.
- Geprüft: Box zum Aufschieben ohne Versatz unverändert (2880 Kombinationen), mit Versatz, Lippenlänge hinten und eigener Wandstärke 40 320, Hülse/Block mit verlegter Mutter 15 552 (Hülse nach dem Deckel-Umbau erneut 6480), Block zwischen den Reihen 9072 — alle Teile geschlossen, Volumen exakt.

### Ballastbox: zwei weitere Bauarten „Kasten mit Hülse“ und „Durchsteckblock“ (2026-11-26)
- **Neue Auswahl „Bauart der Box“** im Reiter Ballastbox (Menü Tragflächen). Neben der bisherigen Box zum Aufschieben mit Lippe und Klettband gibt es jetzt zwei Bauarten, die am Verbinder **festgeklemmt** werden. Beide haben **einen Stülpdeckel** über allen Fächern statt einzeln verschraubter Ballaststücke.
- **Kasten mit Hülse und Klemmschraube** (nach rc-network.de, Thema „Ballastbox“, Beitrag 1): Fächerkasten, oben eine Hülse quer um den Verbinder (Länge, Wandstärke, Versatz in Flugrichtung frei; Standard: Verbindermitte über der Ballastmitte, Schwerpunkt bleibt in Flugrichtung gleich). Eine oder zwei Klemmschrauben vorn in der Hülse drücken den Verbinder gegen die hintere Wand. Druck wie eingebaut ohne Stützen; der bündige Deckel hat dafür unten keinen Absatz.
- **Durchsteckblock mit Klemmschrauben** (Art handelsüblicher Ballastblöcke): Der Verbinder läuft quer durch einen Kanal im hinteren Gehäuse, davor liegen die Fächer bzw. **runde Bohrungen für Rundmaterial** (Raster oder versetzt, Außenform rechteckig oder **gerundet um die Bohrungen**). Eine oder zwei Klemmschrauben laufen von vorn bis zum Verbinderkanal, zwischen den Bohrungen oder, wenn dort kein Platz ist, außen in Augen. **Der Deckel hat Aussparungen für die Schraubenköpfe** und lässt sich abnehmen, ohne die Schrauben zu lösen. Höhenlage des Verbinders einstellbar. Druck auf der Rückseite stehend (Bohrungen senkrecht).
- **Klemmschrauben M3–M6** mit Gewinde im Druckteil wahlweise über eingelassene Sechskantmutter, Gewindeeinsatz (Einschmelzmutter, Bohrung einstellbar) oder Kernloch zum Gewindeschneiden; die nötige Schraubenlänge steht in der Info.
- Kanal und Hülse folgen der **V-Form** des Verbinders. 3D-Ansicht mit Verbinder, Ballast und Schrauben, Einblendung Vorderansicht + Schnitt, STL/3MF-Export und **Planzeichnung (DXF bzw. ins CAD)** mit Vorderansicht, Schnitt A–A, Draufsicht und Schriftfeld für alle Bauarten.
- Netz: der Säulen-Netzbauer kann jetzt Hohlräume (Bohrungen, Kanal, Schraubenlöcher) und Vielecke abziehen. Schnittpunkte von Kanten werden als zusätzliche Rasterlinien eingefügt, damit nichts über Kreuz läuft. Fast gleiche Punkte werden zusammengefasst. Geprüft mit den alten 2880 Kombinationen (unverändert) und über 15 000 Kombinationen der neuen Bauarten: alle Teile geschlossen, Volumen exakt.

### Neuer Reiter „Servorahmen“ für Flächenservos (2026-11-26)
- **Servorahmen zum 3D-Druck (STL / 3MF)** im Menü Tragflächen, direkt nach „Flächenservos“. Der Rahmen wird auf die Innenseite der Beplankung geklebt, der Servo liegt flach darin, die Abtriebswelle parallel zur Beplankung.
- **Servo-Datenbank:** alle KST-Servos mit Herstellermaßen (rund 85, von X06/A06 über X08, HS08, X10-Familie, X12/DS215/MS325, X15 bis zu den 20-mm-Standardservos) und alle 18 Chaservo-Servos aus dem Katalog 2024/25 (LV06 bis HV7010), dazu MKS HV6130/DS6100 und eigene Maße. Servos aus dem Reiter „Flächenservos“ lassen sich übernehmen. Gewählte Werte bleiben frei änderbar, „Datenblattwerte wiederherstellen“ holt sie zurück.
- **Laschenrahmen:** Der Servo wird an seinen eigenen Laschen verschraubt, der Rahmen ist nicht höher als der Servo. Flache Laschen (parallel zur Breitseite, z. B. KST X10, HS08A) liegen auf Stützen, die Schrauben gehen senkrecht zur Beplankung. Flansch-Laschen (quer zur Welle, z. B. KST X12-508, X06, HS08B) liegen an Laschenböcken an, die Schrauben laufen parallel zur Welle. Laschenmaße aus den KST-Datenblättern (X06, X10, X12-508, HS08A/B), für dieselben Gehäusefamilien übernommen, sonst selbst eintragen.
- **Klemmrahmen mit Deckel** für laschenlose Servos: Die Wand ist um die „Klemmung“ niedriger als der Servo, der verschraubte Deckel (geschlossen oder als Rahmen mit Fenster) drückt den Servo auf die Beplankung. 2 oder 4 Schraubaugen, die Laschen und dem Kabel ausweichen. Kleine Anschläge an der Wellenseite.
- **Gegenlager:** optional ein Lagerbock hinter dem Hebel mit Miniatur-Kugellager (MR52 bis 684 oder eigene Maße) in der Flucht der Abtriebswelle; Hebelfreiraum, Wandstärke, Sitzspiel und Hebelrichtung einstellbar.
- Spiel, Wandstärke, offener oder geschlossener Boden, Klebeflansch, Kabelschlitz (Seite oder Gehäuseende, weicht Laschenböcken und Augen aus und lässt keine dünnen Wandreste stehen), Schraubenwahl (M2, Blechschraube 2,2, M2,5, M3, eigene Lochmaße) mit Kern- und Durchgangslöchern als Sacklöcher. Die Info nennt Außenmaße, Einbauhöhe über dem Servo, Masse, Schraubenanzahl und die längste passende Schraube.
- **Export** in Druckposition (Flansch auf dem Druckbett, Deckel flach), normal, gespiegelt oder als Paar für linke und rechte Tragfläche, mehrfach, als STL je Teil oder als ein 3MF.
- Eigener Netzbauer: Quader auf einem gemeinsamen Raster plus nachträglich gebohrte runde Löcher entlang x, y oder z. Geprüft an 8640 Kombinationen (alle Servos × Bauart × Boden × Gegenlager × Kabel × Hebelrichtung): alle Teile geschlossen, keine Bohrung ausgelassen.
- Build-Tool: neue Funktion `servorahmen` (Datei servorahmen.js).

### Flugsimulator: Fernsteuerungsmenü ausgebaut, Ruderausschläge je Ruder (2026-11-26)
- **Neue Gruppe „Fernsteuerung“** (ersetzt „Steuerung“): Zeigt den erkannten Sender mit Name, Zahl der Achsen und Kalibrierstand. Sind mehrere Sender oder Joysticks angesteckt, ist das Gerät wählbar.
- **Alle Achsen live**: Jede Achse des Senders steht mit Balken und Rohwert in der Liste, daneben die zugeordnete Funktion. Die gerade bewegte Achse leuchtet auf, so sieht man sofort, welcher Knüppel welche Achse ist. Es werden so viele Achsen angezeigt, wie der Sender meldet, nicht mehr fest 8. Die Achsenzahlen unten im Flugbild entfallen.
- **Zuordnung mit „Anlernen“**: Je Funktion (Querruder, Höhenruder, Seitenruder, Gas) Achse wählen oder „Anlernen“ drücken und den Knüppel wie angezeigt bewegen (Quer/Seite nach rechts, Höhe ziehen, Gas auf Vollgas). Achse und Richtung werden selbst erkannt, „umkehren“ wird passend gesetzt. Unter jeder Funktion zeigt ein Balken das Ergebnis: Er muss nach rechts gehen, dann stimmt die Richtung. Eine Funktion kann auch „keine“ Achse haben.
- **Kalibrieren**: Alle Knüppel bis an die Anschläge bewegen, dann loslassen und „Fertig“ drücken. Danach reichen die Knüppel ab der gemessenen Mitte sicher bis ±1, Gas läuft linear zwischen den Anschlägen. Die Kalibrierung gilt je Sender und lässt sich löschen. Dazu kommt eine einstellbare **Totzone** um die Mitte, der Vollausschlag bleibt dabei erhalten.
- Der Sender übernimmt erst, wenn ein Knüppel wirklich bewegt wird. Eine leicht verstellte Mitte schaltet die Tastatur nicht mehr dauernd ab.
- **Neue Gruppe „Ruderausschläge“**: Ausschlag (10 bis 200 %) und Expo je Querruder, Höhenruder und Seitenruder, mit kleiner Kurve und Live-Punkt der aktuellen Knüppelstellung. Gilt für Sender und Tastatur. Über 100 % gibt es jetzt wirklich mehr Ruderweg. Bisher wurde ab 100 % nur abgeschnitten, so dass der Knüppel früher am Anschlag war.
- **Altstände**: Der bisherige gemeinsame Ausschlag und Expo gehen auf alle drei Ruder über. Die frühere doppelt verneinte Höhenruder-Umkehr wird umgerechnet, die Richtung bleibt gleich.

### Fix: Kernschnitt fuhr an der Endleiste im Eilgang durch den Block (2026-11-26)
- **Ist die Endleisten-Verlängerung kürzer als die Blockzugabe** (Standard 20 gegen 25 mm), liegt ihre Spitze im Block. Beim Schnitt von hinten fuhr der Draht die waagrechte Anfahrt, die Ausfahrt und die Übergänge zwischen gestapelten Kopien trotzdem mit „Geschwindigkeit außerhalb Block“ durch die letzten Millimeter Schaum. Das fiel nur auf, wenn diese Geschwindigkeit nicht auf „wie Schnitt“ steht.
- Jetzt laufen diese Stücke bis zum hinteren Blockende mit Schnittvorschub, erst dahinter geht es mit der Außen-Geschwindigkeit weiter. Der Haltepunkt liegt genau auf dem hinteren Blockschnitt, auch wenn ein Portal dafür (Zuspitzung) hinter Null-X muss — dieselbe Stelle fährt der Blockschnitt ohnehin an.
- Betrifft nur „von hinten“ mit kurzer Verlängerung. Mit längerer Verlängerung, „von vorne“ und bei DXF-Formen bleibt der G-Code byte-gleich (480 Fälle verglichen, 64 erwartete Änderungen). Prüfung aller Eilgangfahrten gegen den Block: keine mehr durch Schaum.

### Kerndesign: Kern vorne/hinten teilen für sehr tiefe Wurzelrippen (2026-11-26)
- **Neue Gruppe „Kern vorne/hinten teilen“** im Kerndesign, je Segment. Passt eine Rippe nicht in den Verfahrweg, wird der Kern an einer Trennfuge parallel zur Spannweite in ein vorderes Teil (Nase) und ein hinteres Teil (Endleiste) zerlegt. Jedes Teil bekommt einen eigenen Rohblock und ein eigenes Programm. Welches Teil der G-Code enthält, wählt „G-Code für“ im Kerndesign oder „Kernteil“ im Reiter „G-Code“ unter „Quelle Gcode“ direkt unter dem Segment. Blockhöhe, Höhenbezug und Lage in Spannweite bleiben gleich.
- **Geklebt wie aus einem Stück:** Die Fuge liegt an Wurzel und Rand beim gleichen % der Sehne, also parallel zu den Holmen. Sie wird als senkrechter Blockschnitt über die volle Blockhöhe gefahren. Wurzel und Rand fahren dabei dieselbe Strecke und damit gleich schnell, der Abbrand ist an beiden Rippen und an beiden Teilen gleich (Abbrand bei vollem Vorschub, nicht nach Sehnenverhältnis). Der Draht steht um den halben Abbrand auf der Verschnittseite, beide Teile haben Nennmaß. Optional Klebefuge bzw. Steg-Einlage: jede Fläche wird um die Hälfte zurückgesetzt.
- Der Profilschnitt wird an der Fuge beschnitten. Erhalten bleiben Holme „während des Schnitts“, Beplankung, Nasenleiste, bearbeitete Schnittbahn, Schnittrichtung von vorne/hinten, alle Schnittreihenfolgen, „nur Ober-/Unterseite“, Schalenschnitte und Werkstück-Drehung. Holmausschnitte „nach dem Schnitt“ kommen in das Teil, in dem der Holm liegt (seit 2026-11-27: ein Holm auf der Fuge in beide Teile, siehe oben). Fahrten im Rohblock-Überstand an der Fuge laufen mit Schnittvorschub. „Ohne Blockschnitt“ wird hier zu „Blockschnitt vor Profilschnitt“, Stapeln wirkt nicht.
- **Nullpunkt und Einlegemaß:** Bei Zuspitzung läuft die Fuge schräg zum Draht. Der Nullpunkt wird so gelegt, dass beide Rippen den Blockabstand haben und kein Portal hinter Null muss. Sidebar und G-Code-Kopf nennen den Rohblock und den Verfahrweg je Teil (geprüft gegen „Max. Fahrweg horizontal“) und wo die Blockkante an der Fuge liegt.
- **„Automatisch: kürzester Verfahrweg“** sucht die Lage, bei der das längere der beiden Teile den kürzesten Verfahrweg braucht.
- Warnungen bei Fuge im Nasenbereich, Holm auf der Fuge, zu großem Verfahrweg und zu kleinem Überstand. Ist die Lage nicht teilbar, besteht das Programm nur aus Kommentaren (kein Schnitt).
- Zeichnung: Fuge (Wurzel durchgezogen, Rand gestrichelt), Rohblockkanten, nicht gewähltes Teil abgeblendet, Schnittspur nur des gewählten Teils. Die Simulation zeigt den Rohblock des Teils.
- Zusammensetzen: Die Blockreste beider Teile haben dieselbe Stirnfläche wie der Kern und dieselbe Unterkante und dienen als Klebebett.
- Geprüft an 80 Kombinationen (Schnittrichtung × Schnittreihenfolge × Profilseiten × Schalenschnitt × Teil), dazu Werkstück-Drehung, linke/rechte Fläche und Holme: Teilbahnen lückenlos und synchron, keine Eilgangfahrt durch Schaum an der Fuge. Ohne Teilung bleibt der G-Code byte-gleich.
- Build-Tool: neue Funktion `kernteilung` (Datei kernteilung.js).

### Werkstück drehen: Automatik sucht den kürzesten Fahrweg (2026-11-26)
- **Neuer Standard „Automatisch (kürzester Fahrweg)“** für den Drehwinkel, im Kern- und im Negativdesign. Bisher drehte die Automatik die Bezugslinie (Standard: Nasenleiste) parallel zum Draht. Sind Nasen- und Endleiste verschieden stark gepfeilt, wurde der Fahrweg dadurch sogar länger. Beispiel Spaceshuttle: Nase 46° gepfeilt, Endleiste fast gerade. Die Drehung um 46,5° verlängerte den X-Fahrweg von 964 auf 1511 mm, und das Portal fuhr 909 mm ins Negative.
- Jetzt wird der Winkel gesucht, bei dem beide Portale zusammen den kürzesten X-Fahrweg brauchen. Der gedrehte Block muss dabei zwischen die Portale passen. Bringt eine Drehung weniger als 1 mm, bleibt das Werkstück gerade („Keine Drehung angewandt — gedreht wird der Fahrweg nicht kürzer.“). Spaceshuttle: Segment 1 2,1° (964 → 898 mm), Segment 2 12,1° (964 → 630 mm), Laufzeit 16,8 → 9,9 min. Ein Kontroll-Durchlauf in 0,1°-Schritten ergab dieselben Winkel.
- Die bisherige Automatik bleibt als **„Aus Bezugslinie“** wählbar, daneben weiter „Fester Winkel“.
- **Altprojekte:** War die Drehung gespeichert eingeschaltet, bleibt es bei „Aus Bezugslinie“, der G-Code ändert sich also nicht. War sie aus, gilt beim Einschalten die neue Automatik.

### Fix: Simulation bei gedrehtem Werkstück (Pfeilung) (2026-11-26)
- **Die geschnittene Fläche lag in der 3D-Simulation verzerrt neben dem gedrehten Block.** Die Simulation suchte Wurzel- und Randrippe immer in Ebenen quer zum Draht. Mit „Werkstück drehen“ stehen beide Rippen aber um den Drehwinkel schräg. Das Profil wurde deshalb schräg angeschnitten, gestreckt gezeichnet und passte nicht in den Block. Jetzt nimmt die Simulation die gedrehten Rippenebenen: Überstrichene Fläche, Schnittkanten und fertiges Profil liegen genau im gedrehten Block. Geprüft an rechter/linker Tragfläche, Schnitt von hinten/vorne, Kern- und Negativdesign: Der Draht trifft die gedrehten Rippen auf 10⁻¹² mm genau.
- Der G-Code selbst war schon richtig und bleibt unverändert. Den gedrehten Block bezieht die Ansicht jetzt auch beim Einpassen ein.

### Neuer Reiter „Ballastbox“ (Menü Tragflächen, 2026-11-25)
- **Parametrische Ballastbox für den 3D-Druck**, die bei montiertem Modell von vorn auf den Tragflächenverbinder geschoben und mit Klettbändern festgezurrt wird (Vorbild: rc-network.de, Thema „Ballastbox“, Beitrag 4). Der Verbinder liegt auf der Oberseite des Kastens, hinten an einer Anschlagwand und unter einer Lippe (C-Profil, nach vorn offen).
- **Verbinder:** Breite in Flugrichtung, Höhe und **V-Form** (Knickwinkel gesamt) frei; Auflage, Lippe und Schlaufen folgen dem Knick in der Mitte. Werte lassen sich einmalig aus Verbinderform, Steghöhen (Hauptsteckung) oder Formenbau übernehmen, die V-Form auch aus dem Tragflächendesign.
- **Ballaststücke:** Quader oder Rundmaterial, Anzahl nebeneinander × übereinander × hintereinander, Spiel je Seite, Werkstoff (Messing, Blei, Stahl, Wolfram, Kupfer oder eigene Dichte). **Breite, Höhe und Tiefe der Box ergeben sich daraus** zusammen mit Wandstärke und Trennwänden (abschaltbar). Die Stücke werden von vorn in die Fächer geschoben.
- **Klettband-Schlaufen** auf der Lippe (keine, eine oder zwei; Bandbreite, Schlitzhöhe, Stegstärke, Abstand), **Stülpdeckel** bündig auf einem Absatz am Kasten oder außen übergestülpt.
- **Info:** Außenmaße, Ballastmasse, Masse der Box, Schwerpunkt des Ballasts gegenüber der Verbindermitte (vor/unter) und Länge je Klettband.
- **3D-Ansicht** mit Verbinder und Ballast (abschaltbar), Deckel abgerückt, Vorder-/Seiten-/Draufsicht, Ansichtswürfel, Drehpunkt per Mausrad-Doppelklick; Einblendung Vorderansicht + Schnitt in Flugrichtung maßstäblich.
- **Export:** Kasten und Deckel als **STL oder gemeinsam als 3MF** (mit Vorschau), wahlweise in Druckposition (Kasten auf der Rückseite, Fächer offen nach oben, ohne Stützen) oder wie eingebaut. **Planzeichnung als DXF** (Vorderansicht, Schnitt A–A, Draufsicht, 1:1, bemaßt, Schriftfeld; Ebenen Kontur, Ballast, Verbinder, Schnittlinie, Maße, Text) und **Übernahme der Planzeichnung in die CAD-Bearbeitung** (dort weiter bearbeiten oder als PDF drucken).
- Netz: eigener Säulen-Netzbauer (Blöcke über Rechteckraster, Ober-/Unterkante mit V-Form), geprüft über 2880 Parameterkombinationen: alle Teile geschlossen, Volumen exakt.
- Build-Tool: neue Funktion `ballastbox` (Datei ballastbox.js, Reiter `ballast`).

### Tragflächenständer: Anschlag folgt der Endleiste, Messwerkzeug und Drehpunkt, Steckung in 3D, Fachwerk in der Grundplatte und frei einstellbar (2026-11-23)
- **Anschlag folgt der Endleiste:** Die Stütze ist eine Platte (Standard 10 mm), über deren Dicke die Endleiste wegen der Pfeilung schräg läuft. Die Vorderkante des Anschlags stand bisher quer zur Platte, der Spalt zur Endleiste war deshalb keilförmig (LS3-17: 0,2 mm an der einen, 0,8 mm an der anderen Seite statt 0,5 mm). Jetzt folgen **beide Seitenflächen jeder Stütze der Tragfläche an ihrer eigenen Spannweitenlage**: Der Anschlag läuft parallel zur Endleiste und überragt sie überall um die eingestellte Höhe. Die Auflage folgt auch V-Form und Zuspitzung. Bisher kam die Profilunterseite an der Innenseite der Stütze bis auf 0,12 mm statt 0,5 mm an die Auflage heran, jetzt stimmt das Spiel an beiden Seiten (0,49–0,50 mm).
- Die Stirnseiten der Stützen laufen dabei parallel zu Nasen- und Endleiste, der **Schlitz der Fußplatte folgt** (Spiel bleibt rundum). Der Boden bleibt eben, DXF und Zeichnung zeigen weiter den Schnitt in Stützenmitte. Geprüft mit 768 Stützen (verschiedene Anstellwinkel, Plattendicken 10/30 mm, mit/ohne Fuß, Haken, Anschlag, Erleichterungslöcher, Lagen an Wurzel, Stößen und Spitze): alle wasserdicht, keine umgeklappten Flächen.
- **Messwerkzeug in der 3D-Ansicht** (Knopf „📏 Messen“, wie im Formenbau und in der 3D-Bearbeitung): Abstand mit ΔX/ΔY/ΔZ, Kette, Winkel, Radius und Wandstärke (z. B. Plattendicke). Punkte liegen auf der sichtbaren Oberfläche, mit Fang auf Netzecken und vorhandene Messpunkte. Y ist die Höhe über dem Tisch. Klick setzt einen Punkt, Ziehen dreht weiter, Rechtsklick nimmt zurück, Esc bricht ab, Enter beendet eine Kette. Die Werte lassen sich kopieren.
- **Mausrad-Doppelklick setzt den Drehpunkt genau auf die Oberfläche unter dem Mauszeiger.** Bisher wurde nur die nächste Netzecke im Umkreis von 16 Pixeln gesucht. Auf großen Flächen (Platte, Tragfläche) gab es oft keine, und der Doppelklick tat nichts. Der Drehpunkt bleibt jetzt auch stehen, wenn man eine Einstellung ändert (vorher sprang die Ansicht). Er wird nur noch verworfen, wenn Teile ein- oder ausgeblendet werden.
- **Steckung in der 3D-Ansicht** (neues Häkchen „Steckung“ in der Knopfleiste der Ansicht, Standard aus): Hülse (dunkel) in jeder Flächenhälfte über die Einbindetiefe und die Steckung selbst (rot) durchgehend durch den Rumpf, bei „parallel zur Tragfläche“ in der Mitte geknickt. Teilungen erscheinen in der Fläche. Maße, Lage und Neigung kommen aus „Steghöhen“; damit lässt sich prüfen, ob die Bohrungen der Schablone auf der Steckung sitzen. Das Häkchen erscheint nur, wenn „Steghöhen“ eine Steckung liefert.
- **Fachwerk in der Grundplatte der Bohrschablone** (Erleichterungslöcher, neuer Schalter „In der Grundplatte der Bohrschablone“, Standard an): Streben zwischen den beiden Platten, voller Rand ringsum und entlang der Platten bzw. Schlitze. Ab rund 90 mm lichter Breite kommt ein Längsgurt in der Mitte dazu, damit die Felder nicht zu groß werden. Die Grundplatte liegt beim Druck flach, die Löcher brauchen kein Dach. Ersetzt das Fenster in der Grundplatte (das ist nur noch ohne Fachwerk wählbar). LS3-17 mit 155/115 mm Abstand: 10 Löcher, 52 % weniger Material in der Grundplatte. Geprüft in 54 Kombinationen (Abstand 20–250 mm, Stegbereich, Strebenbreite, Rand, Radius): alle dicht; bei sehr schmalem Rumpf bleibt die Platte voll.
- **Fachwerk je Teil einstellbar:** Für Stützen, Steg der Schablone und Grundplatte gibt es jetzt je eine **Anzahl der Streben** (0 = automatisch, Streben etwa 55° geneigt; gerade Zahl, zwei Streben je Feld; bei der Grundplatte mit Längsgurt je Hälfte) und eine eigene **Stegbreite**. Rand und Eckenradius gelten für alle Teile. Die Info zeigt die tatsächliche Zahl der Streben je Teil. Lassen zu viele Streben keinen Platz mehr für Löcher, erscheint ein Hinweis. Bisherige Projekte übernehmen die gemeinsame Stegbreite.
- **Fix: Die Gruppe „Erleichterungslöcher (3D-Druck)“ fehlte in der Seitenleiste.** Sie wurde aufgebaut, aber nicht eingehängt. Die Erleichterungslöcher waren deshalb immer eingeschaltet und Stegbreite, Rand und Radius nicht einstellbar.

### Steghöhen: Lage der Steckung mit V-Form; Tragflächenständer: Höhe an der Wurzel, Erleichterungslöcher (2026-11-23)
- **Steghöhen → Steckung: neue Auswahl „Lage der Steckung“** für Vierkant UND Rund: **parallel zur Tragfläche** (die Hülse folgt der V-Form; die Steckung ist in der Mitte um 2 × V-Form geknickt), **waagrecht** (gerade Steckung durch den Rumpf, die Hülse liegt schräg in der Fläche) oder **eigener Winkel** gegen die Tragfläche (+ = Hülse fällt nach außen gegen die Profilebene). Bisher lief die Vierkant-Steckung immer waagrecht. Bei einer Fläche mit V-Form blieb dadurch über die Einbindetiefe wenig gemeinsamer Platz zwischen den Gurten (LS3-17: 11 mm statt 18,3 mm), und die Hülse stand an der Wurzel oben aus dem Profil. Teilungen haben dieselbe Auswahl (parallel / waagrecht). Das Ergebnis zeigt Neigung der Hülse, V-Form der Fläche und Knick der Steckung.
- **Fix V-Form bei runder Steckung:** Der Winkel war als Winkel gegen die Tragfläche gedacht (so beschrieben, und so rechnet auch die Verbinderform den Knick), gerechnet wurde er aber gegen die Waagrechte. Bei einer Fläche mit V-Form lag die Hülse dadurch um die V-Form der Fläche verkehrt. Jetzt gilt er gegen die Tragfläche.
- Bestehende Projekte behalten ihre Lage: ohne Angabe gilt „waagrecht“ (bzw. bei Rund mit V-Winkel „eigener Winkel“). Neue Steckungen und Teilungen beginnen mit „parallel zur Tragfläche“.
- Wurzelrippe, Stützrippen, Flächenservos, Bohrschablonen und die Verbinderform (Übernahme „Steghöhen: Hauptsteckung“, Knick = 2 × Neigung der Hülse) übernehmen die neue Lage.
- **Tragflächenständer: Bohrschablone auf Höhe der Tragfläche.** Die Schablone hatte eine eigene Höhe über dem Tisch und lag damit nicht deckungsgleich zur Wurzel der Tragfläche auf den Stützen (LS3-17: rund 4,4 mm zu hoch). Jetzt gibt es **eine** Lage der Tragfläche für alle Teile, und die **Höhe gilt innen an der Wurzel**: wahlweise für die **Nasenleiste an der Wurzel** oder den **tiefsten Punkt der Wurzel** (bei schräger Wurzel an der Wurzelrippe). Jede Stütze passt ihre Höhe ihrer Lage in Spannweitenrichtung an (V-Form, Schränkung), die Schablone deckt sich mit der Wurzel. Das Feld „Höhe der Schablone über dem Tisch“ entfällt, die frühere Auswahl „Nasenleiste der Wurzel“ wird übernommen. Die Info oben zeigt Nasenleiste und tiefsten Punkt an der Wurzel über dem Tisch.
- **Erleichterungslöcher (3D-Druck)** in den Stützen und im Steg der Bohrschablone (eigene Gruppe, je Teil schaltbar, Standard an): Fachwerk aus schrägen Streben (etwa 55°) zwischen vollem Rand oben (Auflage bzw. Profil und Bohrungen) und unten (über dem Schlitz der Fuß- bzw. Grundplatte). Die Enden mit den Haken bleiben voll. Stegbreite, Rand und Eckenradius sind einstellbar (Standard 5 / 6 / 3 mm). Die zusammengebaute Schablone wird stehend gedruckt, ihre Löcher bekommen dort ein 45°-Dach und sind ohne Stützstruktur druckbar. Die Info zeigt Anzahl und Ersparnis (LS3-17: Stützen rund 60–70 % weniger Material, Schablonenplatte rund 40 %). Geprüft in 288 Kombinationen: alle Teile wasserdicht, Rand und Streben nie schmaler als eingestellt.
- **Bohrungen quer zum Rumpf (90° zur Flugrichtung):** Die Option heißt jetzt so. Die Bohrungen laufen rechtwinklig zur Flugrichtung, mit der Neigung der Hülse aus der V-Form, und liegen an der Innenseite der Platte genau wie die Ausnehmungen der Wurzelrippe. Bisher folgten sie auch der Richtung der Steckung im Grundriss (bei LS3-17 nur 0,12° Abweichung, weil die Steckung dem Gurt folgt). Weicht die Steckung mehr als 0,5° ab, erscheint ein Hinweis.
- 3D-Ansicht: Wo Platten und Tragfläche an der Wurzel zusammenfallen, flimmerten Streifen. Jetzt ist dort sauber die Platte zu sehen.

### Tragflächenständer: Anschlag an der Endleiste, schräge Wurzel, Steckung am Rand (2026-11-22)
- **Anschlag hinter der Endleiste** (Option bei den Stützen): ein Klotz hinter der Endleiste, der sie um eine einstellbare Höhe überragt, damit die Fläche nicht nach hinten rutscht. Stärke und Abstand zur Endleiste (mindestens das Spiel) sind einstellbar; reicht der Überstand hinten nicht, wird die Stütze länger.
- **Wurzel schräg** in der Bohrschablone wie in „Steghöhen“: Nase eingerückt, Endleiste eingerückt und Winkel (+ = Endleiste bleibt, − = Nase bleibt). Mit „Steghöhen“ sind es **dieselben Werte** wie dort bei der Wurzelrippe, damit Rippe und Schablone deckungsgleich bleiben; ohne „Steghöhen“ eigene Werte (Schnitt durch die Tragfläche in der schrägen Ebene).
- **Abstand hinten aus der Schräge** (Standard an): hinten = vorne + 2 × (Endleiste eingerückt − Nase eingerückt), die Platten stehen dann genau wie die schräge Wurzel. Ausgeschaltet ist der Abstand hinten frei. In der 3D-Ansicht ist die Tragfläche an der schrägen Wurzel abgeschnitten.
- **Fix Steckung fehlte:** Eine Ausnehmung, die über die Profilkontur ragt (z. B. eine Hülse, die höher ist als der Platz zwischen den Gurten), wurde weggelassen. Jetzt wird sie zum **Ausschnitt am Rand** der Platte, mit Hinweis. Nur Ausnehmungen ganz außerhalb der Platte entfallen.
- **Ausschnitt der Steckung** wählbar: Hülse (außen, wie in der Wurzelrippe) oder Steckung (innen, um die Wandstärke kleiner).
- **3D-Ansicht: Häkchen „Tragfläche“, „Stützen“, „Schablone“** in der Knopfleiste der Ansicht schalten die Teile einzeln ein und aus. Der Bildausschnitt passt sich an das Sichtbare an, ohne Tragfläche sind Stützen und Schablone also groß zu sehen. Das Umschalten ist ein reiner Ansichtswert und erzeugt keinen Strg+Z-Schritt. Der bisherige Haken „Tragfläche zeigen“ in der Seitenleiste entfällt.
- DXF und die Zeichnung unten links zeigen jetzt die echten Umrisse (auch mit Randausschnitt). Geprüft mit dem Projekt LS3-17 in 192 Einstellungs-Kombinationen: alle Teile wasserdicht, Fläche und Volumen exakt.

### Neuer Reiter „Tragflächenständer“: Stützen und Bohrschablone für den Rumpfanschluss (2026-11-22)
- Neuer Reiter **Tragflächenständer** direkt nach „Flugzeug gesamt“. Er baut Hilfsmittel für das Bohren und Einkleben der Tragflächenanschlüsse in den Rumpf, als STL für den 3D-Druck und als DXF zum Lasern oder Fräsen.
- **Lage der Tragfläche:** Anstellwinkel der Wurzelsehne gegen den Tisch und Höhe über dem Tisch. Die Höhe bezieht sich wahlweise auf den tiefsten Punkt der Profilunterseite, auf die Nasenleiste oder auf die **Nasenleiste der Wurzel**. Mit dem letzten Bezug liegt die Tragfläche als Ganzes fest, und alle Stützen und die Schablone passen zusammen (V-Form und Schränkung inbegriffen).
- **Stützen:** beliebig viele, je mit Abstand ab der Wurzel (eine Stütze gilt für links und rechts). Die Oberkante ist die Profilunterseite an dieser Stelle aus dem Tragflächendesign, um den Anstellwinkel gedreht. Das **Spiel/Polster** (z. B. für Filz) ist ein echter Abstand senkrecht zur Profiloberfläche. Die Auflage umfasst die Nase bis zur Nasenleiste und hinten bis zur Endleiste; beide Ränder lassen sich tiefer setzen, der Überstand vorne und hinten ist einstellbar.
- **Haken für Gummiringe** vorne und hinten: ein Arm nach außen mit einer Nase nach unten. Der Gummiring liegt unter dem Arm, die Nase hält ihn, und beide Stränge laufen neben der Platte über die Tragfläche. Höhe, Länge, Dicke und Nase sind einstellbar.
- **Fußplatte zum Einstecken** (abschaltbar): Die Stütze wird flach und ohne Stützstruktur gedruckt und in den Schlitz der Fußplatte gesteckt. Breite, Dicke, Rand und Spiel im Schlitz sind einstellbar.
- **Bohrschablone:** zwei Platten mit der **Wurzelrippe aus „Steghöhen“** (originale Profilkontur, auch bei schräger Wurzelrippe in wahrer Form) mit **Hülse und Bohrungen als Bohrführung**. Gleicher Anstellwinkel wie die Stützen. Unten sind die Platten über eine Grundplatte verbunden. Der **lichte Abstand vorne und hinten** ist frei, damit der Rumpf dazwischen passt. Bei schräger Wurzelrippe übernimmt ein Knopf den passenden Abstand hinten.
- Jede Ausnehmung ist einzeln an- und abwählbar, mit Spiel je Seite. **„In Richtung der Steckung bohren“:** Die Bohrungen folgen der Achse der Hülse (Richtung im Grundriss und V-Form) bzw. laufen quer zum Rumpf, auch wenn die Platten schräg stehen. Dafür ist die Außenseite der Platte um Bruchteile eines Millimeters versetzt, die Innenseite am Rumpf bleibt exakt.
- Der Steg unter dem Profil reicht von … bis … % der Rippenlänge zum Tisch, davor und dahinter bleibt die Profilunterseite sichtbar. Die Grundplatte hat einen einstellbaren Rand und optional ein Fenster.
- **Ausgabe:** Stützen flach liegend mit Fußplatten (je Stütze zwei drucken). Die Schablone gibt es als Einzelteile flach (rechte und linke Platte, Grundplatte mit Schlitzen) oder zusammengebaut als ein Druckteil. Alle Teile laufen durch die STL-Vorschau und liegen nebeneinander auf dem Druckbett. **DXF** mit einer Ebene je Teil, auch direkt **in die CAD-Bearbeitung**.
- 3D-Ansicht mit Tragfläche (beide Seiten), Stützen und Schablone, Würfel und Ansichtsknöpfe. Unten links eine Zeichnung des gewählten Teils mit Maßen. Hinweise erscheinen z. B., wenn eine Stütze zu niedrig ist, der Gummi unter dem Haken nicht durchpasst oder eine Bohrung nicht ganz in der Platte liegt.
- Alle Körper sind wasserdicht (in 144 Einstellungs-Kombinationen geprüft, Fläche und Volumen exakt). Neue Datei `staender.js` (Feature „staender“ im Build-Tool), Einstellungen je Tragfläche im Projekt, Strg+Z, englische Übersetzung.

### Flächenservos: Sender live über Jeti EX Bus (2026-11-22)
- Neuer Block **Sender live (Jeti EX Bus)** im Reiter „Flächenservos“. Ein Ausgang des Jeti-Empfängers wird auf „EX Bus“ gestellt und über einen USB-Seriell-Adapter (nur Signal und GND, 3,3-V-Pegel) an den PC gehängt. Die App hört nur mit und sendet nichts.
- Die Kanäle kommen so an, wie die Servos sie bekommen: **Trimmung, Mischer, Servowege und Kurven stellt man im Sender ein**. Am PC wird je Servo nur der Kanal zugeordnet (neuer Teil **Sender (Kanal)**: Kanal 1–24, Drehrichtung umkehren, Servomitte in µs, Servowinkel bei ±500 µs aus dem Datenblatt).
- Mit zugeordnetem Kanal stellt der Sender das Servo statt des Reglers. Schnitt, Hebel, Gestänge, Horn und Ruder bewegen sich live mit, die Trimmung des Moduls bleibt dabei außen vor.
- Je Servo gibt es einen **Schleppzeiger** mit dem größten Ruderausschlag nach oben und unten, in Grad und in mm an der Endleiste. Er lässt sich zurücksetzen und zeigt Differenzierung, Butterfly und Wölbklappen-Mitnahme direkt am Profil.
- **Warnungen:** wenn der Sender das Servo über den eingestellten Servoweg hinaus stellt, wenn das Gestänge in den Totpunkt läuft und wenn kein Signal kommt. Die Kinematik wird dafür live bis ±90° Servoweg gerechnet.
- **Kanal-Monitor** mit allen Kanälen als Balken (µs) und den zugeordneten Servos, Statuszeile mit Baudrate, Paketen/s und Prüfsummenfehlern. Die Baudrate (125 oder 250 kBaud) wird automatisch erkannt oder fest gewählt.
- **Verkabelung …** öffnet einen Schaltplan (Empfänger – Stecker – Adapter – PC) mit zwei Varianten: Empfänger am Tisch über USB versorgt, oder Empfänger im Modell mit Akku/BEC (dann rote Ader nicht an den Adapter). Dazu Hinweise zu Empfängereinstellung und geeigneten Adaptern (FTDI FT232R, CP2102N, CH340).
- Im Schnitt steht der Ruderausschlag jetzt auch in mm an der Endleiste.
- Englische Übersetzung für den ganzen Reiter „Flächenservos“ nachgetragen.
- Neues Modul `jetiexbus.js` (Feature „Flächenservos“). Das Protokoll folgt JETI „EX Bus communication protocol“ v1.21, Prüfsumme gegen alle Beispielpakete des Dokuments getestet.

### Formenbau: Randbogen nach unten gezogen (2026-11-22)
- Neuer Punkt in der Auswahl **Form** (Gruppe „Randbogen / Wingtip“): **Randbogen nach unten gezogen (z. B. LS 3)**. Das ist der hängende Randbogen vieler Segelflugzeuge der 70er und 80er Jahre. Die Fläche biegt am Ende tangential in einem Kreisbogen nach unten, um bis zu 90° und mehr. Die Tiefe nimmt dabei stetig ab, und der hängende Teil endet in einer Spitzenrundung.
- Der Punkt hat **eigene Werte**, unabhängig vom Winglet, und wird je Tragfläche gespeichert: Winkel nach unten (gegen die Fläche), Länge, Biegeradius, gerader Teil vor dem Bogen, Tiefe nach dem Bogen, Rücksprung der Nase, **Rückpfeilung der Nasenleiste**, Dickenverjüngung, Anstellung und Spitzenform (Ellipse / Sichel / frei).
- **Rückpfeilung:** Die Nasenleiste läuft im hängenden Teil unter diesem Winkel nach hinten. Weil Nasenleiste, Endleiste und Tiefe einander festlegen, gibt man zusätzlich entweder die **Tiefe am Ende** vor (dann ergibt sich die Pfeilung der Endleiste) oder die **Pfeilung der Endleiste** (dann ergibt sich die Tiefe am Ende). Der abgeleitete Wert und der wirksame Biegeradius stehen darunter.
- **Die Nase steht in der Draufsicht nie über die verlängerte Nasenleiste der Tragfläche hinaus**, bei keiner Einstellung. Vorher konnte sie bei kurzem, stark verjüngtem hängendem Teil nach vorn springen. Der Tiefenverlauf im Bogen ist jetzt monoton (kein Anschwellen über die Endtiefe). Zusätzlich gibt es eine Nasen-Sperre: Wo nötig, rückt sie den Querschnitt nach hinten, Anstellung und Höhenausgleich eingerechnet. Geprüft mit über 100 zufälligen Einstellungen.
- **Vorlagen:** „LS 3-artig“ (85°), „kurz und eng gebogen“ (70°) und „leicht hängend“ (45°). Längen und Radius werden aus der Endtiefe der Tragfläche berechnet, die Endleiste bleibt dabei etwa gerade. Beim ersten Wählen des Punkts wird die LS 3-Vorlage automatisch auf die Tragfläche angepasst.
- Die Oberseite liegt außen, die Unterseite innen im Bogen. Alle Übergänge sind knickfrei, und weder Ober- noch Unterseite bekommt einen Buckel vor dem Bogen.
- Gilt für das Urmodell (ganz, gespiegelt, getrennt mit Steckungsbohrungen, mit „V-Form Randbogen“) und als eigenes Formteil „nur Randbogen / Winglet“ (Negativform und geteiltes Urmodell mit gebogener Trennfläche). Bei Formhälften der ganzen Tragfläche wäre der Randbogen hinterschnitten. Dort wird er wie ein Winglet flach abgeschlossen, mit Hinweis.
- Alle Varianten sind wasserdicht geprüft.

### Negativschalendesign: Werkstück drehen bei starker Pfeilung (2026-11-21)
- Neues Menü **Werkstück drehen (Pfeilung)** im Reiter „Negativschalendesign“. Es funktioniert wie der gleichnamige Befehl im Kerndesign: Der Block wird um die Hochachse gedreht, bis die Bezugslinie (Sehnenanteil, z. B. Nasenleiste) parallel zum Draht liegt. Ein stark gepfeiltes Segment braucht dadurch viel weniger X-Fahrweg.
- **Keine Kopplung ans Kerndesign:** eigene Einstellungen (Drehung aktiv, Winkel automatisch oder fest, Bezugslinie, Drehwinkel), je Tragfläche gespeichert. Die Drehung im Kerndesign wirkt hier nicht und umgekehrt.
- Der Draht schneidet weiter genau dieselbe Schale; geändert werden nur die Turmbahnen. Gilt für den Umriss samt Kern, Stegen und Stützstoff sowie für die Randvorschnitte (Schalenrand). Der Nullpunkt liegt an der hintersten gedrehten Blockecke, der Portalabstand zählt ab der nächstgelegenen Blockecke.
- Draufsicht und 3D-Simulator zeigen den Block gedreht, wie er wirklich liegt. Der Querschnitt bleibt unverändert. Das Menü zeigt Drehwinkel und X-Fahrweg vorher/nachher, der G-Code-Kopf nennt den Winkel.
- Der **Profilvergleich (Original ↔ verzerrt)** samt DXF-Export geht auch für die Negativschale.
- Neues Modul `negsweeprot.js` (Kern).

## [2.15] — 2026-11-21

### Negativschalendesign: Schnittverlängerung je Segment oder automatisch (2026-11-21)
- Neue Auswahl **Schnittverlängerung** (Gruppe „Negativschale“, Schneideweg „Schnittverlängerung + Randvorschnitte“), je Tragfläche:
  - **Ein Wert für die ganze Tragfläche (proportional):** wie bisher. Der Wert gilt für die Wurzel des 1. Segments, alle Rippen der Tragfläche skalieren mit der Sehne.
  - **Je Segment einstellbar:** eigener Wert vorne und hinten an der Innenrippe jedes Segments, die Außenrippe skaliert mit der Sehne dieses Segments. Beim Umschalten übernimmt jedes Segment den bisher wirksamen Wert, die Form ändert sich dadurch nicht.
  - **Automatisch über den Blockschnitt:** Die kleinste Rippe (meist das Außenprofil) steht um x mm (vorne und hinten getrennt) über den Blockschnitt hinaus. Blockschnitt ist der Schalenrand-Vorschnitt; steht der auf 0, gilt die Profilnase bzw. Endleiste. Die übrigen Rippen skalieren mit der Sehne. **Automatik rechnet** je Segment (jedes Segment so kurz wie möglich) oder über die ganze Tragfläche (eine durchgehende Kette wie bisher).
- Innerhalb eines Segments bleibt die Verlängerung immer proportional. Die Draht-Geschwindigkeit bleibt dadurch konstant, und der Abbrand nach Sehnenverhältnis bleibt exakt.
- Zwei Anzeigezeilen zeigen die wirksamen Werte innen und außen für das gewählte Segment, live beim Tippen. Die Legende der Querschnittsansicht nennt innen und außen sowie die Art.
- Gilt überall gleich: Zeichnung, Draufsicht, 3D-Ansicht und G-Code. Die Latten-Ausrichtung und der Schneideweg „ein Zug“ haben weiterhin Vorrang.

### Negativschalendesign: Kern-Nasenschlaufe schneidet über die Blockvorderkante hinaus (2026-11-21)
- Bisher lag das vordere Ende der Kern-Nasenschlaufe im G-Code einen ganzen Abbrand hinter der Blockvorderkante. Der Abbrand-Versatz schiebt die Vorderkante um ½ Abbrand nach vorne, die Schlaufe aber um ½ Abbrand nach hinten in den Schlitz. Die Schlaufe hat die Vorderkante dadurch nur gerade berührt.
- Jetzt fährt der Draht die Schlaufe bis zur selben Station wie die Blockvorderkante. Der Schlitz geht damit sauber durch den Blockrand.
- Gilt für die Kern-Schlaufe, die Nasenschlaufe der Stege und „Nur Stege schneiden“ (ohne Schalen: ½ Abbrand vor der Nennkante). Das gilt auch für „Kern zerteilen“ im Kerndesign. Die Nennkontur bleibt unverändert, die Schnittspur in der Zeichnung zeigt die Verlängerung mit.

### Verbinderform: V-Knick in der Vorderansicht, scharfe Ecken (2026-11-21)
- **V-Knick der Form** hat jetzt drei Möglichkeiten:
  - **In der Draufsicht:** Form liegt flach, wie bisher.
  - **In der Vorderansicht, Unterteil und Stempel geknickt:** neu. Die Form folgt dem Knick wie die Tragfläche von vorn gesehen. Unterseite, Wandoberkante und Stempeloberseite knicken als scharfe Kante, die Wandstärken sind überall mindestens so dick wie eingestellt. Beim 3D-Druck braucht diese Form eine Stützstruktur.
  - **In der Vorderansicht, Unter- und Oberseite eben:** der Knick liegt nur im Kanal, wie das bisherige „stehend“.
- **Ebene Latte (V-Form ausgeglichen):** Zur geknickten Form in der Vorderansicht gibt es die Option **Ebene Latte unten und oben**. Unter das Unterteil bzw. die Grundplatte und auf den Stempel kommt je eine ebene Latte. Die Form steht damit eben auf, liegt eben auf dem Druckbett und lässt sich eben pressen.
  - Einstellbar sind **Breite** (0 = ganze Breite, mindestens Kanal + 2 mm) und **Stärke an der dünnsten Stelle**.
  - Würde die Lattenkante eine Bohrung schneiden, rückt sie neben das Loch; das Infofeld nennt dann die angepasste Breite.
  - Bohrungen und Mutterfallen gehen durch die Latte.
- **Ecken der Steckung immer scharf:** Der Kantenradius ist entfallen, Kanal und Zunge sind scharfkantig.
- **Knick scharf oder ausgerundet:** Standard ist **scharf**, beide Hälften stoßen innen und außen in einer Kante zusammen. **Ausgerundet** zeigt wieder das Feld Innenradius; außen gilt dann Innenradius + Dicke.
- Ansichtsknöpfe getauscht: **Vorderansicht** blickt auf die Längsseite, dort sieht man den Knick wie am Flugzeug von vorn. **Seitenansicht** blickt auf die Stirnseite und zeigt den Querschnitt.

### Neuer Reiter „Verbinderform“: Pressform für den Tragflächenverbinder (2026-11-19)
- Neuer Reiter **Verbinderform** im Menü **Tragflächen** (direkt nach Formenbau). Er erzeugt die Pressform für einen Tragflächenverbinder (Steckung) aus UD-Kohle in Composite-Bauweise und exportiert sie als STL bzw. 3MF für den 3D-Druck oder als Vorlage zum Fräsen.
- **Steckung ganz frei:** Querschnitt **Vierkant** (Breite in Sehnenrichtung, Höhe in Dickenrichtung, Kantenradius) oder **rund** (Durchmesser), **Länge je Seite** getrennt, **V-Knick** in der Mitte mit Knickwinkel gesamt und **Innenradius**. **Übernehmen** füllt die Werte nur einmalig vor, danach bleibt alles änderbar. Quellen sind die Steckungs-Ausnehmungen im Formenbau (Wurzel, jede Fuge der Segmentgruppen, Anschluss Randbogen/Winglet, jeweils mit dem V-Winkel der Stelle), die Hauptsteckung aus „Steghöhen“ (mit Einbindetiefe) oder die V-Form der Tragfläche an Wurzel bzw. Fuge.
- **Aufbau:** **zweiteilig für den 3D-Druck** (Unterteil = untere Platte + beide Seitenwände in einem Stück, Stempel = obere Platte + Zunge in einem Stück) oder **dreiteilig** (Grundplatte, zwei abschraubbare Seitenleisten, Stempel).
- **Wandstärken frei:** untere Platte, obere Platte und Seitenwand. Dazu Führungshöhe der Zunge, Spiel der Zunge je Seite (Harzaustritt), Überlänge je Ende (Kanal offen, Rovings straff durchziehen), Entformungsschräge (nur zweiteilig) und Überlaufnut.
- **Lage der Steckung:** **liegend** (Dickenrichtung waagrecht, flache Form, Knick in der Draufsicht) oder **stehend** (Dickenrichtung senkrecht, Knick in der Seitenansicht, Unterteil unten eben).
- **Verschraubung:** M3–M8 mit Sechskant-Mutterfalle von unten, nur Durchgangsbohrung oder keine (Schraubzwingen). Abstand und Randabstand sind einstellbar; ist die Wand zu schmal, steht die nötige Mindest-Wandstärke in der Warnung.
- **Faserbedarf:** Querschnittsfläche, Volumen, Anzahl Rovings (Feinheit in tex, Faservolumenanteil, Überfüllung), Zuschnittlänge, Faser- und Harzmasse.
- 3D-Ansicht mit Ansichtswürfel, Drehpunkt per Mausrad-Doppelklick, ⌂/Pos1, Teile auseinanderziehen und Querschnitt-Einblendung in der Mitte. Der Export liegt in Druckposition (Stempel umgedreht, Oberseite aufs Bett) und läuft über die STL-Vorschau mit Wahl 3MF/STL.
- Netze als 2,5D-Körper: Kanalraster, Wandraster, Ringe um die Bohrungen und senkrechte Flächen ohne T-Stöße. Geprüft über 238 Kombinationen (Form, Lage, Aufbau, Knick 0–30°, scharfer Knick, Schräge, Nut, alle Gewinde): alle Teile geschlossen, richtig orientiert, Volumen positiv; die Volumina der Teile ergeben zusammen mit Steckung und Harzspalt genau den Formblock.
- Neue Datei `verbinder.js` (Funktion „verbinder“ in features.json, Reiter `vbf`). Die Einstellungen liegen je Tragfläche in `cfg.formVb`.

### Flächenservos: Trimmung nutzt den ganzen Servoweg (2026-11-19)
- Getrimmt ging bisher Servoweg verloren: Der Knüppel wurde um die Trimmung verschoben und am Wegende abgeschnitten (z. B. ±60° mit −42° Trimmung → nur −60° bis +18°, also 78° statt 120°). Jetzt fährt das Servo immer den ganzen Weg ±Servoweg, also in Summe 2 × Servoweg, und nie darüber hinaus. Die Trimmung legt nur die Knüppelmitte fest: Von dort geht es zu einer Seite weniger weit (Servoweg − Trimmung), zur anderen entsprechend weiter, ±100 % Knüppel = jeweiliges Wegende.
- Kinematik, Ausschlag oben/unten, Momentbedarf, Endlagen im CAD und „Servoweg −/+“ rechnen damit immer mit dem vollen Weg. „Ruder neutral“ stellt den Knüppel weiter so, dass das Servo auf 0° steht.

### Steghöhen → Wurzelrippe: Nase und Endleiste frei einrücken, Bohrungen, Auswahl für das CAD (2026-11-19)
- **Nase eingerückt (mm)** und **Endleiste eingerückt (mm)** sind jetzt beide frei, nicht mehr nur eines von beiden: gleich = Wurzelrippe parallel eingerückt, verschieden = schräg. **Wurzelrippe schräg (°)** ergibt sich daraus; wer den Winkel eingibt, ändert ein Maß (+ = Endleiste bleibt, die Nase rückt; − = Nase bleibt, die Endleiste rückt). Projekte mit dem bisherigen Winkel werden beim Öffnen auf die beiden Maße umgestellt (gleiche Lage).
- Stützrippen ganz vor der Wurzelrippe entfallen (auch die an der Wurzel), Rippen im Bereich der Schräge werden an ihr abgeschnitten. Die 3D-Ansicht beginnt erst an der Wurzelrippe.
- **Bohrungen in der Wurzelrippe** (für Stecker, Bolzen …): beliebig viele, **rund** (Durchmesser) oder **eckig** (Breite in Flugrichtung, Höhe, Eckenradius), je mit Name. Lage der Mitte in der Rippenebene ab der Nase der Wurzelrippe (wahre Länge, wie im CAD), Höhe ab der Profilmitte. Die Bohrungen gehören zur Kontur der Rippe (Ebene WURZELRIPPE), stehen beschriftet in der Vorschau und in der 3D-Ansicht. Ragt eine über die Kontur hinaus, erscheint eine Warnung.
- **Wurzelrippe in CAD übernehmen** fragt jetzt in einem Fenster, welche Teile übernommen werden (Häkchen je Teil/Ebene, „Alle“/„Keine“). Die Auswahl wird je Tragfläche gemerkt.
- **Wurzelrippe als STL…** (Gruppe „Wurzelrippe“ und „Ausgabe“): Eine Abfrage fragt nach der **Dicke** und welche **Ausnehmungen** drin sein sollen (Häkchen für Holmgurt-Aussparung, Hülse und jede Bohrung; gemerkt je Tragfläche), danach kommt die gewohnte **STL-Vorschau** mit Dichtheitsprüfung und erst dann der Speichern-Dialog. Die Rippe liegt flach (x = wahre Länge ab Nase, y = Höhe wie im CAD, z = Dicke) und ist ein geschlossener Körper, auch wenn eine Ausnehmung über den Rand ragt (wird dann zur Kerbe; teilt sie die Rippe, kommt ein Hinweis).
- **Rippenkontur wählbar:** **Rippe reicht bis** Innenlage (innen an der Schale, wie bisher) oder **Außenlage** (Stützstoff und Innenlage enden an der Rippe); ohne Lagenaufbau „Schale innen“ oder „Außenkontur“ (volle Profilkontur). **Holmgurt ausgenommen** (Standard an): Die Rippe spart den Gurt aus, Kontur an der Gurt-Innenfläche, seitlich mit dem eingestellten Spiel; aus = die Rippe geht über den Gurt hinweg, der Gurt endet an ihr.
- **Bohrschablone** (Gruppe „Wurzelrippe“, erscheint nur bei schräger Wurzelrippe): Quader mit durchgehender Führungsbohrung, rechtwinklig zur Flugrichtung; die eine Seite ist genau in der Ebene der schrägen Wurzelrippe abgeschnitten und wird dort von außen angesetzt. **Bohrung für** die Hülse (rund, Bohrachse mit der V-Form der Steckung), eine runde Bohrung der Wurzelrippe oder eine freie Lage; Bohrungs-Ø, Breite, Höhe und Führungslänge einstellbar (zu kurz für die Schräge → wird verlängert, mit Hinweis). **Bohrschablone als STL…** mit STL-Vorschau; gedruckt mit der geraden Seite nach unten steht die Bohrung senkrecht. In der 3D-Ansicht sitzt sie an ihrem Platz (ausblendbar).
- **Übergang zum Gurt** (bei ausgenommenem Holmgurt): **scharf** (senkrechte Stufe, wie bisher), **abgeschrägt** (gerade Schräge über eine einstellbare Breite) oder **ausgerundet** (Hohlkehle am Boden und Rundung oben mit einstellbarem Radius; bei kleinem Radius bleibt dazwischen ein senkrechtes Stück). Der Übergang liegt neben dem Gurt (außerhalb von Gurtbreite + Spiel), die Aussparung für den Gurt bleibt voll tief. Maße in der Rippenebene; die Tiefe der Aussparung wird angezeigt. Gilt für Vorschau, CAD, 3D-Ansicht und STL.

### Steghöhen: schräge Wurzelrippe und Wurzelrippe ins CAD (2026-11-14)
- **Neue Menügruppe „Wurzelrippe“** im Reiter „Steghöhen“: **Wurzelrippe schräg (°)** stellt die Wurzelrippe im Grundriss schräg (z. B. bei einem Rumpf mit Einschnürung), wie im Rippendesigner. Die Schräge geht immer zu Lasten des Werkstücks: + = Endleiste bleibt an der Wurzel, die Nase rückt nach außen; − = Nase bleibt, die Endleiste rückt nach außen. Alternativ **Nase eingerückt (mm)** bzw. **Endleiste eingerückt (mm)** eingeben, der Winkel wird daraus bestimmt (gilt auch, wenn die Rippe über einen Segmentstoß reicht). *(Seit 2026-11-19 sind beide Maße frei, siehe oben.)*
- Mit Schräge beginnen **Holm- und Ruderstege, die Steckung (Einbindetiefe ab der Wurzelrippe) und die Listen für Holmgurt, Scharnierlinie und Stützstoff an der Endleiste an der Wurzelrippe**. Steglängen und Höhen gelten ab dort; die erste Listenzeile heißt „Wurzelrippe“. Der Keil davor ist in der Draufsicht dunkel schraffiert. „Rechtwinklig zur Wurzelrippe“ bei Gurt und Steckung bleibt rechtwinklig zur Flugrichtung (Rumpfachse).
- **Stützrippen** bleiben in Flugrichtung. Eine Stützrippe an der Wurzel entfällt bei Schräge (dort sitzt die Wurzelrippe), Rippen im Keil davor werden an der Wurzelrippe abgeschnitten.
- **Wurzelrippe in CAD übernehmen** (in der Gruppe „Wurzelrippe“ und unter „Ausgabe“): Schnitt in der Ebene der Wurzelrippe als **wahre Form** (x = wahre Länge ab der Nase der Wurzelrippe), je Teil eine Ebene: PROFIL, SCHALE bzw. AUSSENLAGE / STUETZSTOFF / INNENLAGE, HOLMGURT, HOLMSTEGE, RUDERSTEGE, HUELSE, STECKUNG und WURZELRIPPE (Kontur innerhalb der Schale bzw. am Gurt, mit Ausschnitt für die Hülse, gestrichelt; Spiel einstellbar). Funktioniert auch ohne Schräge.
- **Vorschau:** „Schnitt zeigen“ bzw. „Schnitte in Spannweite → Stelle wählen → Wurzelrippe“ zeigt genau das, was ins CAD geht, mit Legende. Klick auf die Wurzelrippe in der Draufsicht oder in der 3D-Ansicht wählt sie. Die 3D-Ansicht schneidet Schale, Gurt, Stege und Hülse an der schrägen Rippe ab und zeigt die Wurzelrippe als eigenes, ausblendbares Teil.
- Neue Datei `wurzelrippe.js` (Funktion „Steghöhen“ in features.json).

### Fix: X-Spalt-Scharnier verdrehte die Außenbahn (2026-11-14)
- War der Draht an einer Rippe breiter als der Keil des X-Spalts (typisch: schmale Außenrippe, Abbrand nach Profillängen-Verhältnis), klappte der Abbrand-Versatz des Keils um. Ein Bein lief dann quer durchs Profil bis zur Endleisten-Verlängerung; die Außenbahn verlor Oberseite und Nase, passte nicht mehr zur Wurzelbahn, und die Portale fuhren teils ins Negative. In noch schmaleren Segmenten fiel der X-Spalt sogar stillschweigend weg.
- Jetzt fährt der Draht an solchen Rippen auf der Mittellinie des Keils gerade bis zur Spitze und zurück. Der Spalt wird dort so breit wie der Draht (schmaler geht nicht), der Steg in der Mitte bleibt. Die Abbrand-Vorschau des X-Spalts zeichnet dieselbe Bahn.

### Rückmeldungen Neil (4) — Nasenabschnitt im Rippendesigner, Taschentiefe bei Beplankung (2026-11-14)
- **Kerndesign → Nasenabschnitt → „Gilt für“** (wie bei Holmen): **Ganze Tragfläche** = Wurzelwert an der Wurzelrippe, Randwert an der äußersten Rippe, dazwischen linear über die Spannweite. **Segmentgruppen** = je Gruppe (Segment von–bis) eigene Werte innen/außen, Gruppen hinzufügen/löschen; Segmente ohne Gruppe bekommen keinen Nasenabschnitt. Bisher galten Wurzel/Rand für jedes Segment neu, bei mehreren Segmenten sprang das Maß am Segmentstoß zurück. Achtung: Mehrsegment-Projekte mit Nasenabschnitt ergeben dadurch andere Maße als vorher.
- **Rippendesigner übernimmt den Nasenabschnitt aus dem Kerndesign** (Vierkant-Tasche oder gerader Nasenabschnitt). Bisher kannte der Rippendesigner ihn gar nicht, die Rippen hatten immer die volle Nase. Kantenlänge und Tiefe je Rippe nach ihrer Lage in Tragfläche bzw. Segmentgruppe (wie der Kernschnitt), Drehung gleich. Fertigmaß ohne Drahtabbrand (Tasche = Kantenlänge + Spiel).
- **Rippen sind bei Beplankung immer die innere Kontur** (Profil minus Beplankung): jetzt auch im Fräse-Import (nahm bisher die Außenkontur) und im CAD-Import (Layer „Rippen“). Das CAD-Häkchen „Beplankung (Kernlinie)“ heißt jetzt **„Außenkontur mit Beplankung (Bezug)“** und lädt die Außenkontur auf den Layer „Außenkontur“. Kernende (stumpf/spitz) wie im Rippendesigner eingestellt. Gilt für Vorschau (Leiste in Nennlage eingezeichnet), Rippen-STL, CAD-Import und Fräse-Import. Abschaltbar im neuen Menü **Rippendesigner → Nasenabschnitt** (erscheint nur, wenn der Nasenabschnitt im Kerndesign an ist); trifft er eine Rippe nicht, steht ein Hinweis unter der Vorschau.
- **Gurttaschen bei Beplankung**: Der Schnitt (G-Code) hat die Taschentiefe schon immer ab der Kernoberfläche gemessen, also unter der Beplankung. Kerndesign-Ansicht, Rippendesigner und die Rippen-Ausgaben (STL, CAD, Fräse) maßen sie dagegen ab dem Außenprofil, dort wirkte die Tasche um die Beplankungsdicke zu flach. Jetzt zählt überall die Tiefe ab Kernoberfläche; im Kerndesign bleibt das Außenprofil bei Beplankung ganz, die Tasche steckt in der Kernlinie. Die Begrenzung der Tiefe (85 % der Dicke) und der halbe Steg richten sich nach der Kerndicke.

### Holm „Gerade Steckung“: „90° zur Flugrichtung“ (2026-11-14)
- Der Schalter hieß fälschlich **Parallel zur Flugrichtung**, hält den Holm aber auf konstantem X, also rechtwinklig zur Flugrichtung. Er heißt jetzt **90° zur Flugrichtung** (Funktion unverändert).
- Ist er an, verschwinden die Felder der Außenlage („Außen Seg n ab NL“ und Wert): Die Lage kommt dann allein von der Wurzelrippe.

## [2.14] — 2026-11-12

### Fix: Simulation zeigt die Schnittfläche ab Segment 2 wieder (2026-11-12)
- Im 3D-Simulator fehlte bei Segment 2 und weiter außen die Schnittfläche. Der neue Auftragskopf („; Teil: 3D-Modell · Segment n“) wurde fälschlich als Segmentwechsel gelesen. Jetzt zählen nur die echten Segment-Marker im G-Code.

### Kerndesign: Menü „Nasenabschnitt“ (2026-11-12)
- Das Seitenmenü **Nasenleiste (Vierkant)** heißt jetzt **Nasenabschnitt**, da es neben der Vierkant-Tasche auch den geraden Nasenabschnitt enthält.

### Scharnierausschnitt X-Spalt als ein Schnitt (2026-11-12)
- **Form → „X-Spalt (oben + unten)“** (bei X-Spalt entfällt „Lage der Spitze“): Ein Ausschnitt ergibt das ganze X, ohne zweiten gespiegelten Ausschnitt und ohne Dreieck mit Anfahrt. Die Profilbahn selbst läuft an der Scharnierstelle schräg bis zur Mitte und schräg wieder hinaus: oben im Zug der Oberseite, unten im Zug der Unterseite. Einstellbar: Winkel vorne/hinten und **Steg in der Mitte** (Material zwischen den Spitzen, Standard 1 mm). Abbrand an der Spitze nur um den halben Spalt (nicht k/sin α), sonst blieb in der Mitte zu viel stehen. Anzeige: das X liegt im Profil (keine Dreiecke darüber hinaus).

### Rückmeldungen Neil (3) — Schlitz-Abbrand, Nasenabschnitt, profilfolgende Aussparung (2026-11-12)
- **Fix Holmschlitz außen zu schmal**: Der Abbrand der Holmtaschen (Bezug „Lokale Geschwindigkeit“) setzte den größeren Taschenumfang mit dem Vorschub gleich und ließ den Anfahrschlitz weg. Tatsächlich führt der G-Code die Wurzelrippe mit dem Vorschub; ein paralleler Schlitz ist an beiden Rippen gleich lang, außen läuft der Draht dort also genauso schnell wie innen. Jetzt zählt der ganze Weg je Rippe (Tasche + Schlitz hin und zurück), die Wurzel ist der Bezug.
- **Kerndesign → Nasenleiste**: neue Form **Gerader Nasenabschnitt**. Die Nase wird senkrecht im eingestellten Abstand (Wurzel/Rand) abgeschnitten, z. B. für eine aufgeklebte Balsa-Nasenleiste. Der Abbrand ist ausgeglichen, im selben Zug wie der Kernschnitt.
- **Holmausschnitt**: neue Form **Profilfolgende Aussparung** (Gewichtserleichterung). Vorder- und Hinterwand senkrecht und parallel (Vorderwand = Lage, Hinterwand ab Nase in % oder mm, außen getrennt einstellbar), Ober- und Unterkante im Abstand zur Kern-Oberfläche in mm oder % der lokalen Dicke.

### Fix: Rückmeldungen Neil (2) — Übersetzung, Strak, Holm-Warnung (2026-11-12)
- Beschreibungs-„?“ einer ganzen Karte (z. B. „Segment im Grundriss anklicken …“) hing an der ersten Beschriftung darin (Wurzelsehne) und öffnete dort scheinbar eine leere Beschreibung. Es sitzt jetzt direkt bei seiner Beschreibung.
- Meldungen „Gespeichert:“ / „Geladen:“ (Projekt, G-Code) erscheinen auf Englisch.
- Holme lassen sich frei benennen (Feld **Name (frei)**); der Name steht in Kopfzeile, Kerndesign, Negativdesign, Rippendesigner und Warnungen („Holm 1 · Hauptholm“). Kopfzeile auf Englisch „Spar n“.
- **Strak-Profil**: Am äußersten Segment gibt es kein gegebenes Profil weiter außen; der Schalter kopierte dort das Wurzelprofil über das geladene Randprofil (wirkte „verkehrt herum“). Der Schalter erscheint dort nicht mehr; beim Ausschalten kommt das zuvor geladene Profil zurück.
- Warnung „Lage nicht proportional“ verschwand nicht, wenn Wurzel- und Außenlage danach gleich gestellt wurden. Die Seitenleiste wird jetzt neu aufgebaut, sobald sich das ändert (Übernahme mit Enter/Verlassen des Felds).
- Englisch: „Ausrichtung an gerader Latte“, „Verschnitt/Verlust (%)“ ergänzt.

### Neu: X-Ruderspalt, durchgehender Schlitz, D-Box-Beplankung (2026-11-12)
- **Scharnierschnitt → Lage der Spitze**: neben „an der Scharnier-Profilseite“ jetzt **Profilmitte – öffnet nach oben/unten**. Zwei solche Ausschnitte ergeben den X-Spalt (z. B. Fun-Fly, 45° oben und unten); Knopf **„X-Spalt: Gegenstück anlegen“** legt den zweiten an.
- **Scharnierschnitt → Form „Schlitz durchgehend (Hilfsendleiste)“**: senkrechter Schlitz über die ganze Profildicke auf der Scharnierlinie, Breite und Versatz einstellbar — zum Einsetzen von Hilfsendleiste/Querruder-Nasenleiste.
- **Beplankung → „Nur D-Box“**: Beplankungsabzug nur von der Nase bis x % der Sehne (oben und unten), dahinter voller Kern mit Stufe. Wirkt auf Kernschnitt, Holmausschnitte, Profilbild und DXF; je Tragfläche gespeichert.
- **Rippendesigner**: Bei Beplankung ist die innere Kontur (die eigentliche Rippe) durchgezogen, die Außenkontur gestrichelt. Der **STL-Export** liefert bei Beplankung jetzt die innere Kontur (vorher das volle Profil).
- **Gurttasche nahe der Nasenleiste**: Die Taschentiefe wird an der dünnsten Stelle über die Taschenbreite begrenzt (vorher nur in der Mitte) — der Boden kann vorne nicht mehr durch die Gegenseite stoßen.

## [2.13] — 2026-11-10

### Fix: Holm „kürzester Weg“ + Rückmeldungen Neil P. (2026-11-10)
- Holmausschnitt mit Anfahrt **Kürzester Weg**: Wurzel- und Randrippe konnten verschiedene Seiten wählen (typisch: waagrechte Steckungsröhre, Profil wird nach außen dünner). Dann wurde ein Einstich von oben mit einem von unten gemischt, und die Schnittbahn in der Nähe (z. B. die untere Gurttasche) war zerstört. Jetzt fahren beide Rippen immer von derselben Seite an, und zwar von der mit der kürzeren Gesamtanfahrt.
- Profilbearbeitung: Wird die Dicke geändert, steht sie jetzt im Profilnamen (z. B. „NACA 0012 (11.0 %)“). Bisher hieß ein auf 11 % gebrachtes NACA 0012 weiter „NACA 0012“, und das 11-%-Profil schien verloren.
- Maschine (Heißdraht und Fräse): **Start** grün, **Stopp/Abbruch** rot hervorgehoben.
- Englisch: fehlende Texte ergänzt (Scharnierschnitt, Anfahrt-Hinweise, Drehteller u. a.).

### Fix: Holmschnitt „nach Oberseitenschnitt“ bei der linken Hälfte (2026-11-10)
- Linke Hälfte: Die Nase wurde nur am linken Turm gesucht. Wegen der stark verlängerten (gespiegelten) Turmbahn lag sie dann fast an der Endleiste. Dadurch kam die Pause schon nach wenigen Punkten, und die Reihenfolge stimmte nicht. Jetzt dient die Wurzelrippe als Bezug, und linke und rechte Hälfte laufen spiegelgleich.
- Nach der Pause fährt der Draht mit Schnittvorschub statt mit Höchstgeschwindigkeit nach oben aus dem Block, weil er noch im Schaumrest stehen kann.

### Steghöhen: Steckungen an Teilungen in Spannweitenrichtung (2026-11-08)
- In der Menügruppe **Steckung** neu: **Teilungen in Spannweitenrichtung** (bis 10). Je Teilung: Lage der Trennung ab Wurzel, Steckung x mm in den Flügel innen und x mm in den Flügel außen, Form Vierkant oder Rund, Wandstärke Hülse, Breite (Vierkant), festes Maß.
- Die Teilungssteckung liegt zwischen den Gurten entlang der Gurtmitte; mögliches Maß und Hülse werden wie bei der Hauptsteckung berechnet. Trennstelle rot gestrichelt in der Draufsicht, Steckung in Draufsicht, Profilschnitt, 3D-Ansicht, Stützrippen-Ausschnitt und Flächenservos (Kollisionsprüfung). Trifft ein Holmsteg die Hülse, erscheint ein Hinweis.

### Steghöhen: Stützstoff an der Endleiste (2026-11-08)
- Bei Schalenaufbau (Außenlage, Stützstoff, Innenlage) berechnet der Reiter, wo der Stützstoff an der Endleiste weggeschliffen werden muss, damit Ober- und Unterschale zusammenpassen. Neue Tabelle **„Stützstoff an der Endleiste“** in Höhenliste, Ausdruck und kopierter Liste, je Stelle ab Wurzel (Raster, Segmentstöße, außen), gemessen ab Endleiste (mit Spalte „+ Überstand“ bei Schalenüberstand an der Endleiste):
  - **Schalen berühren sich, Schleifen ab** (Profilhöhe = 2 × ganze Schale; nur mit Innenlage),
  - **Stützstoff trifft aufeinander** (Profilhöhe = 2 × (Außenlage + Stützstoff)),
  - **Stützstoff ganz weg** (Profilhöhe = 2 × Außenlage).
- In den **Schnitten in Spannweite** ist der Schleifbereich bis zur Endleiste rot hinterlegt, mit beschrifteten Linien an den drei Stellen.

### Steghöhen: Ruderstege ab Endleiste, Schalenüberstand (2026-11-08)
- Ruderstege haben in der Liste zusätzlich die Spalte **„ab Endleiste“** (Ansicht, Ausdruck, Liste kopieren).
- Neue Felder **„Schalenüberstand Nase (mm)“** und **„Schalenüberstand Endleiste (mm)“** unter Steghöhen. Die Liste zeigt die Originalmaße ab Nase bzw. Endleiste und, wenn ein Überstand gesetzt ist, daneben jeweils eine Spalte „+ Überstand“ (Maß ab Schalenkante) – bei Stegen, Holmgurt und Scharnierlinie, in Ansicht, Ausdruck und kopierter Liste.

### Steghöhen: Lage der Scharnierlinie in der Höhenliste (2026-11-08)
- Höhenliste (Anzeige, „Liste kopieren“, Druckvorschau) hat einen eigenen Block **Scharnierlinie** (wie Holmgurt): je Station ab Wurzel Profiltiefe, Scharnier **ab Nase** und **ab Endleiste** (mm).
- Rudersteg „an der Scharnierlinie“: neue Wahl **„Abstand angeben“** – gleich über die ganze Länge, **innen / außen** (eigener Wert außen), an jedem Segmentstoß oder **je Segmentgruppe innen/außen** (wie beim Holmgurt: Anzahl Gruppen, Gruppenende je Segment, Werte innen/außen je Gruppe; an der Gruppengrenze darf der Abstand springen, die Liste zeigt dort „Gruppe n innen“). Alte Projekte bleiben unverändert.

### Drehachse: Quelle „Kontur drehen“ und Bahn ausdünnen (2026-11-07)
- Neue Quelle **„Kontur drehen“** im Reiter Drehachse (Anregung: StyroFoamRobot). Die Seitenkontur wird direkt in der Seitenleiste gezeichnet: Punkt ziehen = verschieben, Rechtsklick = Punkt einfügen, Doppel- oder Mittelklick = Punkt löschen, mit Rasterfang. Vorlagen: Kegel, Kuppel, Figur.
- **Drehschritte**: 0 = runder Drehkörper, sonst n-Kant (z. B. 6 = Sechskant). Die Flächen liegen bei 0°, 360/n° … – die automatische Winkelwahl trifft sie genau.
- Geladene Modelle: **„Achse der Datei, die nach oben zeigt“** frei wählbar (+Z, +Y, +X, −Z, −Y, −X) statt nur „Z oben ja/nein“; alte Projekte werden übernommen.
- Fix: Im Simulator des Reiters Drehachse sprang der Zeitregler beim Ziehen immer auf 0 zurück – Vor-/Zurückspulen funktioniert jetzt.
- Zeitanzeige in allen 3D-Simulatoren (G-Code, Schneiden, Drehachse) jetzt als h:mm:ss statt Minuten:Sekunden (vorher z. B. „868:34“).
- **Bahn ausdünnen: Toleranz (mm)**, Standard 0,05: Douglas-Peucker je Schnittbahn, deutlich weniger G1-Sätze (Beispiel: 1055 → 207 Zeilen) und ruhigerer Lauf auf GRBL.

### Steghöhen: Gurtlage in der Liste, Druckvorschau (2026-11-07)
- Die Höhenliste beginnt mit einer eigenen Tabelle **Holmgurt**, unabhängig von den Stegen: je Stelle ab Wurzel (Raster „Höhe alle … mm“, Segmentstöße, außen) Gurt von / Mitte / bis ab Nase in Profilrichtung, Gurtbreite und -dicke. Auch in „Liste kopieren“ und im Ausdruck.
- Neu unter Ausgabe: **🔍 Druckvorschau…** zeigt die Liste als A4-Dokument; „Drucken / als PDF…“ öffnet den Systemdruckdialog (dort „Als PDF speichern“ bzw. „Microsoft Print to PDF“ wählen).
- **Gurtlage angeben** (Holmgurt, ab 2 Segmenten): „Wurzel → außen gerade“, „an jedem Segmentstoß“ oder neu **„je Segmentgruppe innen/außen“**. Segmente lassen sich zu Gruppen zusammenfassen (Anzahl, „Gruppe endet bis Segment …“); je Gruppe Gurtmitte innen und außen, dazwischen im Grundriss gerade. An Gruppengrenzen darf die Lage springen; die Holmgurt-Liste zeigt dort beide Werte.
- Fix: Bei einer Tragfläche mit nur einem Segment brach das Anlegen eines Stegs mit „Lage je Segmentstoß“ ab.

### Fix: G-Code-Reiter folgt dem Segmentwechsel (2026-11-07)
- War der G-Code geladen („G-Code laden…“) oder von Hand bearbeitet, blieben nach einem Wechsel von Segment oder Quelle Grafik und G-Code-Text beim alten Stand stehen, während die Beschriftung unter der Simulation schon das neue Segment nannte. Erst ein Neustart half. Jetzt wird beim Segment-/Quellenwechsel (Tragfläche, Negativschale, DXF-Segment, 3D-Modell-Segment) wie beim Tragflächenwechsel neu erzeugt.

### Steghöhen: Stegbereich nach Segmenten (2026-11-07)
- Je Steg (Holm- und Rudersteg) lässt sich bei mehreren Segmenten **„Ab Segment“** und **„Bis Segment“** wählen. Von/Bis folgen dann den Segmentgrenzen, auch wenn sich die Segmentbreiten im Tragflächendesign später ändern. Alternativ wie bisher frei in mm (Von/Bis/Länge); eine Eingabe dort löst die Segmentbindung.

### Neuer Reiter „Drehachse“ — Schneiden mit Drehtisch (Spezial Module, 2026-11-07)
- Die Maschine bleibt wie in allen anderen Modulen. Zusätzlich steht der Block auf einem **Drehtisch mit senkrechter Achse** (grblHAL A, B oder C). Je Tischwinkel schneidet der Draht die Silhouette des Teils (beide Portale gleich), fährt über den Block, der Tisch dreht weiter, dann folgt der nächste Schnitt. Das ist das Verfahren aus devFoam 3D. Mulden und Löcher, die aus keiner Richtung sichtbar sind, bleiben stehen.
- **Teil:** STL/OBJ/STEP/IGES laden, aus dem Reiter 3D-Modell übernehmen oder einen Testkörper nehmen (Kabinenhaube, Drehkörper, Pyramide). Einstellbar sind Maßstab, Drehung und Versatz auf dem Tisch sowie die Sockelhöhe: Bis zu dieser Höhe bleibt der Block stehen und hält das Teil. Das Modell wird im Projekt gespeichert.
- **Schnittwinkel:** automatisch nach der Geometrie (es wird jeweils der Winkel mit dem größten Materialabtrag gewählt; die Automatik hört auf, wenn nichts mehr abzutragen ist), gleichmäßig verteilt oder als eigene Liste. Angezeigt werden die Abweichung von der Idealform (konvexe Hülle je Schicht) und die Schnittdauer.
- Rohling automatisch (Teil + Rand) oder mit eigenen Maßen; Abbrand, Schichtabstand, Anfahrweg und Sicherheitshöhe einstellbar.
- **3D-Simulation als Hauptansicht** mit derselben Maschine wie im Reiter G-Code bzw. Schneiden: Boden, Nullpunkt, beide Portale mit Fahrwegen, Draht, Positionsanzeige, Warnungen, Ansichtswürfel und gewohnte Mausbedienung. Dazu kommen der Drehteller mit 0°-Marke und Tischachse sowie das Werkstück, das nach jedem Schnitt kleiner wird (Zielteil wahlweise durchscheinend, standardmäßig aus). Der Körper wird als glatte, geschlossene Hülle mit pixelgenauem Tiefentest gezeichnet (Tiefenpuffer, geglättete Kanten). Teller, Sockel und Werkstück verdecken sich in jeder Ansicht richtig; keine Stufen, kein Durchscheinen. Wiedergabe mit Tempo 1–100×.
- **Fenster „Schnitte“** (aufklappbar, verschiebbar): Profil des gewählten Schnitts und Draufsicht mit allen Drahtrichtungen.
- G-Code mit G0/G1; der Tisch dreht nur im Eilgang über dem Block. Das Programm hat einen eigenen Auftragskopf (Teil „Drehtisch · …“, Maschine mit Drehteller).
- **Drehteller als Maschineneigenschaft:** Reiter Maschine → „Drehteller (5. Achse)“: Schalter „Maschine hat einen Drehteller“, Achsbuchstabe (A/B/C, mit Warnung bei Doppelbelegung), Tischmitte X und Tisch-Oberkante Y. Wird mit den Einstellungen gespeichert, nicht im Projekt. Ohne Drehteller sind der Reiter „Drehachse“ und die Quelle „Drehtisch“ ausgeblendet.
- **Steuerung:** Mit Drehteller zeigen Positionsanzeige und Handfahrt (Reiter Maschine und Schneiden) eine fünfte Spalte „Drehteller · °“ mit ±-Tasten, „→0°“ (auf 0° fahren) und „=0°“ (aktuellen Winkel als 0° setzen).
- **Reiter „Schneiden“:** neue Quelle „Drehtisch“. „An Schneiden übergeben“ im Reiter Drehachse wählt sie und übernimmt das Programm. Der 3D-Monitor zeigt Drehteller und Werkstück mit dem Winkel und Schnittstand der jeweiligen Programmzeile, in der Vorschau und beim echten Lauf. Vorschub-Modus, Heizung, Relais und Sicherheitshinweis gelten wie bei allen Quellen.
- **Startsperre:** Benutzt ein Programm eine Achse, die die Steuerung nicht meldet (z. B. B bei einer 4-Achs-Firmware), wird der Schnitt mit klarer Meldung nicht gestartet.
### Neue Reiter: Projektbibliothek, Bauanleitung, Laminierplan (2026-11-07)
- **Projektbibliothek** (neben der Projektübersicht): Eigene Projekte lassen sich mit Name, Kategorie und Beschreibung auf diesem Computer ablegen. Jede Karte zeigt den Grundriss sowie Spannweite, Fläche und Streckung. Projekte lassen sich suchen, öffnen, überschreiben, bearbeiten, als .json exportieren und importieren. Mitgeliefert sind fünf Vorlagen: Segler 2 m, Nurflügel 1,2 m, Speed/Pylon 1 m, Trainer 1,6 m und ein Testflügel für den ersten Schnitt.
- **Bauanleitung**: Die Anleitung entsteht automatisch aus dem Projekt, mit den Kapiteln Geometrie (Segmenttabelle), Styroporblöcke, Kerne schneiden, Negativschalen, Holm, Laminieren, Rippen und Gewicht. Jedes Kapitel lässt sich abschalten und bekommt auf Wunsch einen eigenen Hinweis und ein Bild. „Ansicht einfügen“ übernimmt die Zeichnung eines beliebigen Reiters, alternativ geht eine Bilddatei. Dazu kommen eigene Schritte. Die Vorschau zeigt das A4-Blatt; Ausgabe über „Drucken / als PDF“ oder als HTML.
- **Laminierplan** (Menü Tragflächen): Der Lagenaufbau der Schale wird je Tragfläche festgelegt (Gewebe, Seite, Spannweiten- und Profilbereich, 0/90° oder ±45°, Anzahl). Daraus berechnet der Reiter:
  - die Zuschnitte als Abwicklung der Profilseiten mit Zugabe,
  - die Verschachtelung auf die Rollenbreite (Meter je Gewebe, Ausnutzung),
  - Gewebe- und Harzmasse, Abreißgewebe, Vlies und Vakuumsack,
  - einen Ablauf mit Uhrzeit gegen die Topfzeit (mit Warnung).

### Flugsimulator: Kunstflug-Motormodell Sukhoi Su-26M (2026-11-07)
- Neue eingebaute Maschine „Kunstflug-Motormodell Sukhoi Su-26M“ (Maßstab 1:3, 2,60 m Spannweite, rund 130 dm², etwa 8,8 kg bei 68 g/dm²) neben dem F3F-Segler.
- Tief angesetzter Trapezflügel mit symmetrischem Profil, Sternmotorhaube mit Kabinenhaube, Spornradfahrwerk, Spinner und Propeller.
- Kunstflugtaugliche Flugphysik: Schub etwa 1,8 × Gewicht, hohe Rollrate, starkes Höhen- und Seitenruder, mehr Seitenkraft für den Messerflug. Die Flächenbelastung ist einstellbar.
- Der Propeller dreht sich passend zur Gasstellung (Leerlauf etwa 1800 U/min, Vollgas etwa 7000 U/min, kurzer Hoch- und Auslauf). Bei hoher Drehzahl erscheint eine halbdurchsichtige Propellerscheibe.
- Motorgeräusch (synthetisch, Einzylinder-Zweitakter): Tonhöhe folgt der Drehzahl, mit Doppler-Effekt, leiser mit wachsender Entfernung zur Kamera. Schalter „Motorgeräusch“ und Lautstärke in der Seitenleiste. Gilt auch für eigene Flugzeuge mit Motor.

### Ausrichtung an gerader Latte: nur vorne oder nur hinten (2026-11-07)
- Negativschalendesign → „Ausrichtung an gerader Latte“: neue Auswahl „Gerade Linie an“ — vorne und hinten, nur vorne (Nase) oder nur hinten (Endleiste).
- Die nicht gewählte Seite bleibt wie ohne Ausrichtung (proportionaler Formüberstand bzw. konstanter Schalenrand); dort wird kein Latten-Vorschnitt gefahren.

### G-Code-Kopf mit Auftragsdaten, sprechender Dateiname (2026-11-07)
- Jedes erzeugte Programm beginnt mit einem Kopf: Projektname, Teil/Segment, Seite (links/rechts), Maschinenname mit Portalbreite und Blocklage (Abstand zum Portal oder mittig).
- Beim Herunterladen setzt sich der Dateiname aus Projekt, Segment und Seite zusammen, z. B. `Projekt_tragflaeche_seg2_links.gcode`.

## [2.12] — 2026-11-06

### Holmausschnitte farbig und nummeriert (2026-11-06)
- Bei mehreren Holmen bekommt jeder Holmausschnitt in Draufsicht und Seitansicht eine eigene Farbe und ein Nummernschild (1, 2, 3 …). Die Legende listet die Holme einzeln. Gilt auch in der Profilansicht. Die Nummern lassen sich im Holm-Menü mit „Holme nummerieren“ global ein- und ausschalten.
- Bei nur einem Holm bleibt alles wie bisher.

### Kerndesign: Tasche für Vierkant-Nasenleiste (2026-11-06)
- Neues Seitenmenü **Kerndesign → Nasenleiste (Vierkant)**: An der Nase wird eine quadratische Tasche in den Kern geschnitten. Dort wird eine Vierkantleiste eingeklebt und danach auf Profilform verschliffen.
- Einstellbar sind Kantenlänge und Einlasstiefe je Wurzel und Rand, die Drehung (45° = über Eck) und das Spiel für die Klebefuge. Die Werte gelten je Tragfläche.
- Die Tasche wird im selben Zug wie der Kernschnitt geschnitten. Der Abbrand wird nach innen ausgeglichen, die Nasenspitze davor ist Verschnitt. Die Leiste wird in der Profilansicht angezeigt.

## [2.11] — 2026-11-06

### Kopfüber schneiden nur noch im Kerndesign, Holm-Anfahrt ins Kerndesign (2026-11-06)
- Das **Tragflächendesign zeigt die Fläche immer ungespiegelt** (Grundriss, Profile, Aufriss). „Kopfüber schneiden“ wirkt nur noch im Kerndesign und beim Schneiden.
- Die **Anfahrt der Holmausschnitte** (kürzester Weg / von oben / von unten) ist vom Tragflächendesign ins **Kerndesign → Holmausschnitte** gewandert: je Holm unter „Holm n · Schnitt“, nur bei „während des Schnitts“.
- „Oben“ und „unten“ beziehen sich jetzt auf die **Lage im Block an der Maschine**, auch kopfüber.
- Bei „nach dem Schnitt“ und „nach Oberseitenschnitt“ zeigt das Kerndesign jetzt die tatsächliche Anfahrt von oben. Bisher war die Anzeige dort falsch, der G-Code stimmte schon.
- Die Holmausschnitte nach dem Profil werden **von vorne nach hinten** in einem Zug geschnitten, egal in welcher Reihenfolge die Holme angelegt sind.

### Holmschnitt „nach Oberseitenschnitt“: Oberseite = oberer Schnitt (2026-11-06)
- „Oberseite“ ist jetzt immer der **an der Maschine oben liegende Schnitt**, egal wie die Fläche liegt. Kopfüber geschnitten wird zuerst die oben liegende Seite geschnitten, dann folgen die Holme, dann die untere Seite.
- Beim Blockschnitt „während Profilschnitt (umlaufend)“ wurden die Holme in diesem Modus bisher gar nicht geschnitten. Jetzt kommen sie an der Nase nach der Blockvorderkante.

### Kopfüber schneiden: alle Holmausschnitte werden mitgespiegelt (2026-11-06)
- „Kopfüber schneiden“ im Kerndesign spiegelt jetzt die **fertige Tragfläche samt allen Ausschnitten** rein geometrisch: Kreis, Oval, Trapez (Basis Mitte/oben/unten, Drehung, Versatz), Doppel-T, Scharnier, waagrechte Holme und Gurttaschen (mit/ohne Steg, unterschiedliche Tiefen oben/unten, flacher Boden). Geprüft: gespiegelte Bahn = Original, Abweichung 0,000 mm.
- Die Ausschnitte werden am ungespiegelten Profil aus dem Tragflächendesign berechnet und danach gespiegelt. Das Kerndesign wirkt nicht auf das Tragflächendesign zurück.
- Holmausschnitte „nach dem Schnitt“ werden auch kopfüber immer von der Maschinen-Oberseite angefahren.

## [2.1] — 2026-11-05

### Neuer Reiter „Flugsimulator“ (2026-11-05)
- Menü **Flugzeug → Flugsimulator**: mit dem zusammengesetzten Flugzeug aus „Flugzeug gesamt“ (Rumpf, Tragflächen, Leitwerk, Farben und Decals) wie mit einem Modellflugzeug fliegen.
- **Pilotensicht am Boden** (Blickfeld holt das Modell mit der Entfernung heran) oder **Verfolgerkamera**; Mausrad = Zoom. Wiese mit Piste, Bäumen und Hügeln, Schatten unter dem Modell.
- Flugmodell aus Fläche, Spannweite und Streckung der Haupttragfläche; Masse aus **Flächenbelastung** oder fest, Schwerpunkt, Nullwiderstand, Motor mit Standschub (oder Segler). Strömungsabriss, Bruch-/Absturzerkennung.
- **Handstart, Hochstart (120 m), Bodenstart**; **Wind** mit Böen und Richtung, **Thermik**-Blasen.
- Steuerung per **Tastatur** (Pfeile, A/D, W/S, Leertaste, R, C, P) oder **Fernsteuerung/Gamepad** über USB — Achsen und Umkehr frei zuordenbar, Ruderausschlag und Expo einstellbar.
- Eigenes, abwählbares Feature `flugsim` im Build-Tool (braucht „Flugzeug gesamt“).
- **Hang zum Hangfliegen** (Landschaft → Gelände): Pilot an der Hangkante, Hanghöhe und -neigung einstellbar, Wind aus dem Tal. **Hangaufwind** folgt dem Gelände und reicht vor und über die Kante, nimmt mit der Höhe ab; dahinter sinkende, böige Lee-Luft.
- **Flugphysik verfeinert**: Eigenfrequenzen aus Fahrt und Modellgröße, Stabilität aus **Schwerpunkt und Neutralpunkt** (instabil, wenn der Schwerpunkt dahinter liegt), Rollrate aus Spannweite, negatives Wendemoment, Rollen aus Gieren, **Abkippen über eine Fläche** beim Strömungsabriss, **Bodeneffekt**, Reynolds-Einfluss auf den Widerstand, Propellerstrahl macht Höhen-/Seitenruder im Stand wirksam, Bugradsteuerung über das Seitenruder, stärkere Böen in Bodennähe. Landen auf geneigtem Gelände, Flügelspitze im Boden = Bruch. Startfahrt gilt gegenüber der Luft. Anzeige Höhe über Grund/über Pilot und Strömungsabriss.
- **Gasstellung** als Balken links unten (nur mit Motor). Simulator-Einstellungen (Gelände, Wind, Steuerung …) bleiben jetzt auch nach einem Neustart erhalten — vorher sprang der Hang auf den Flugplatz zurück, weil Laden/Rückgängig `state.cfg` ersetzte; die Simulator-Werte liegen jetzt getrennt vom Projekt.
- Steuertasten (Pfeile, A/D/W/S …) verstellen keine Auswahlliste der Seitenleiste mehr: Hatte die Geländeauswahl noch den Fokus, schalteten die Pfeiltasten beim Steuern den Hang auf „Flugplatz“ um. Der Fokus springt jetzt aufs Flugbild.
- **Kein Selbststart mehr:** Beim Öffnen und nach R hält der Pilot das Modell in der Hand, Gas steht auf 0. **Leertaste = Handstart**, **B = Bodenstart** (dann mit W Gas geben); Gas aus W vor dem Wurf wird übernommen. Die Auswahl „Start“ in der Seitenleiste entfällt.
- **Eingebauter F3F-Hangrennsegler als Standardmodell**: 2,95 m Spannweite, rund 60 dm², gewölbtes Profil, V-Leitwerk 110°, schlanker Rumpf, Rot/Gelb/Weiß; Segler ohne Motor, eigene Flächenbelastung (Vorgabe 40 g/dm² ≈ 2,4 kg). Auswahl **Flugzeug**: F3F oder **eigenes Flugzeug** aus „Flugzeug gesamt“.
- Am Hang steht der Pilot jetzt direkt an der Kante (1,5 m statt 6 m dahinter).

### Steghöhen: Stützrippen und 3D-Ansicht (2026-11-05)
- Neues aufklappbares Menü **„Stützrippen“** im Reiter Steghöhen: Rippen parallel zur Wurzelrippe, **gleichmäßig über die Spannweite**, **gleichmäßig je Segment** (optional zusätzlich an Wurzel, Stößen und Außenende) oder **frei** an beliebiger Stelle. Rippendicke, Spiel zur Schale/zum Gurt und zum Steg einstellbar; Kontur = Profil innen, im Gurtbereich unter dem Gurt.
- **Schnitt durch die Stege** global je Steg und einzeln je Rippe überschreibbar: geschnitten (geht vor und hinter dem Steg weiter), endet am Steg (nur davor), beginnt am Steg (nur dahinter) oder nicht geschnitten.
- **Löcher** (rund oder Langloch, z. B. für Servokabel) für alle Rippen und je Rippe, Lage in % der Sehne + Höhe ab Mitte; passt ein Loch nicht, wird es gemeldet. Automatischer **Ausschnitt für die Steckungshülse**.
- Rippen erscheinen in der Draufsicht; **„Rippen in CAD übernehmen“** lädt alle Rippen mit Löchern, je Rippe eine Ebene. Auch **„In CAD übernehmen“** (Ausgabe) nimmt die Stützrippen jetzt mit, unter den Stegen.
- **Teilstücke entfernen**: Zwischenstücke der Rippen, z. B. zwischen Holmsteg 1 und Holmsteg 2, für alle Rippen wegnehmen und je Rippe überschreiben (wie für alle / behalten / entfernen). Entfernte Stücke sind in Draufsicht und Schnitt gestrichelt, in 3D ausgeblendet.
- Gewählte Rippe: der Schnitt in Spannweite springt genau an ihre Stelle und zeigt die Rippe mit Löchern.
- Seitenleiste von Steghöhen in eigene Menügruppen aufgeteilt wie in den anderen Modulen: **Steghöhen** (Schale, Raster), **Holmgurt**, **Steckung**, **Stege**, **Stützrippen**, **Ausgabe** (standardmäßig zugeklappt). Der Knopf **„3D-Ansicht“** sitzt jetzt oben rechts im Ansichtsbereich.
- **Anklicken wählt im Menü**: in der Draufsicht Rippe oder Steg, in der 3D-Ansicht Rippe, Steg, Holmgurt oder Steckung (Menü klappt auf); gewählte Rippe/Steg sind hervorgehoben.
- Knopf **„3D-Ansicht“** (Ausgabe): eigenes Fenster mit Schale bzw. Außenlage/Stützstoff/Innenlage (durchscheinend), Holmgurt, Holm- und Ruderstegen, Stützrippen, Steckung und Hülse — alles einzeln ein-/ausblendbar.

### Negativschalendesign: Schalenränder an gerader Latte ausrichten (2026-11-05)
- Neues Menü **„Ausrichtung an gerader Latte“** im Reiter Negativschalendesign: die Formüberstände vorne und hinten werden je Rippe so verlängert, dass die Schalenränder aller Segmente in der Draufsicht auf einer geraden Linie liegen — als **Rechteck** (parallel zur Spannweite) oder **Trapez** (schräge Linie mit möglichst wenig Überstand).
- Einstellbar: Mindestüberstand vorne/hinten, Schnittverlängerung über die Latte hinaus (läuft automatisch mit), Abbrand der Schnittverlängerung **aus lokaler Bahngeschwindigkeit** oder **wie Profilschnitt** (Sehnenverhältnis).
- Die Ränder werden als Vertikal-Vorschnitte gefahren (G-Code, Vorschau, 3D-Simulation). Draufsicht-Skizze und Tabelle der Überstände je Rippe im Menü.
- Aktiv ersetzt das Menü Schneideweg, Schnittverlängerung vorne/hinten und den konstanten Schalenrand.
- Oberes Ansichtsfenster im Negativschalendesign umschaltbar **Vorderansicht / Draufsicht**: die Draufsicht zeigt Profil-Grundriss, Formblock mit Schnittverlängerung und Schalenrand (bzw. die Latten) aller Segmente; Klick schaltet das Segment aktiv.
- Umschalter Vorder-/Draufsicht jetzt im verschiebbaren Bedienfeld des Ansichtsfensters, dazu Knopf **„3D-Ansicht“**: eigenes Fenster mit allen Segmenten in 3D, Ober-/Unterschale, Kern und Stützstoff einzeln ein-/ausblendbar; in Stege zerlegte Kerne erscheinen zusammengesetzt mit sichtbaren Trennschnitten (drehen/verschieben/zoomen mit der Maus).
- Negativschale, Abbrand „aus lokaler Bahngeschwindigkeit“: keine Schlaufen mehr an der Nase und kein Huckel am Übergang Schnittverlängerung → Endleiste. Der Abbrand wird entlang der Bahn geglättet (läuft an Ecken über einige mm über), jede gerade Kante bekommt ihren eigenen Abbrand, und der Versatz nutzt denselben Parallel-Offset wie der Profilschnitt-Modus.
- Negativschale: Band „Abbrand in wahrer Dicke“ passt bei lokaler Bahngeschwindigkeit jetzt zum tatsächlichen Versatz (je Kante deren eigener Spalt); Legende und Heatmap zeigen bei aktiver Latten-Ausrichtung deren Abbrand-Art statt „Sehnenverhältnis“.

### Neuer Reiter „Flugzeug gesamt“ mit flow5-Netz (2026-11-05)
- Anzeige übernimmt den Rumpf genau wie im Reiter „Rumpf“ (Anformungen, Leitwerk, Rohr; glatte Oberfläche), die Haupttragfläche sitzt wie dort (Wurzelnase, Einstellwinkel, Wurzelrippe der Anformung; Formenbau-Ringe werden auf die Wurzelrippe ausgerichtet, dort war die Fläche um die Blocklage in der Höhe versetzt); Decals liegen darauf.
- flow5-Netz wird aus diesem Modell abgeleitet und in einem eigenen Vorschaufenster gezeigt; das Rumpfgitter wird nach Formänderung ausgedünnt, die Grenzen der Anformung bleiben immer erhalten; das Höhenleitwerk aus „Rumpf“ wird im flow5-Netz als eigene Tragfläche vernetzt (Hälften rechts/links, Endleisten-Paare) (Dreieckskanten, offene Kanten rot, Prüfliste je Bauteil), erst dort gespeichert.
- Eigenes Übermenü **Flugzeug → Flugzeug gesamt** (neben Tragflächen und Rumpf): Rumpf (inkl. Leitwerk/Anformungen aus „Rumpf“) und alle Tragflächen mit Randbogen bzw. Winglet aus dem Formenbau in einer 3D-Ansicht.
- Je Tragfläche: Rolle (Tragfläche, Höhenleitwerk/V-Leitwerk, Seitenleitwerk), Lage X/Y der Wurzelnase, Einstellwinkel, beide Hälften, eigene Farbe und Farbe für Randbogen/Winglet. Rumpf- und Haubenfarbe frei.
- Decals aus dem Reiter „Decals“ erscheinen auf Rumpf und Tragflächen (Ober-/Unterseite).
- **flow5-STL…**: ganzes Flugzeug als ein STL-Netz für flow5 (Plane → Import → From an STL file), Einheit m oder mm, Achsen wie flow5 (x hinten, z oben). Jedes Bauteil ist ein geschlossener Körper mit Normalen nach außen, Flächen an der Rumpfwand gekürzt (keine Überschneidung), strukturiertes Netz mit Kosinus-Teilung und gleich vielen Dreiecken oben/unten an der Endleiste. Vor dem Speichern wird auf offene Kanten und entartete Dreiecke geprüft. **Einzelteile…** speichert je Bauteil eine STL. Bezugsfläche, -flügeltiefe und Spannweite stehen in der Info.

### Steghöhen: Gurt/Steckung rechtwinklig zur Wurzelrippe (2026-11-04)
- Holmgurt: Schalter **„Rechtwinklig zur Wurzelrippe (Draufsicht)“** – Gurt (und damit Steckung und „auf dem Gurt verteilte“ Holmstege) läuft von oben gesehen gerade mit der Rücklage der Wurzel; Lage außen/je Segmentstoß entfällt dann.
- Steckung: derselbe Schalter einzeln – nur die Steckung läuft rechtwinklig ab der Gurtmitte an der Wurzel, der Gurt bleibt gepfeilt. Gilt auch für Flächenservos (Kollision, Draufsicht, Schnitte).

### CAD-Bearbeitung: mehrere Hintergrundbilder (2026-11-04)
- Gruppe **„Hintergrundbilder“**: beliebig viele Vorlagenbilder laden („Weiteres Bild laden…“), Auswahl des Bildes per Liste; Deckkraft, Lage, Breite, Skalierung, Drehung und Entfernen gelten je Bild.
- **„Bild verschieben“** wie ein CAD-Objekt: Bild anklicken, Basispunkt, Zielpunkt (mit Fang, Koordinateneingabe und Vorschau-Rahmen).
- **„Referenzlänge“**: zwei Punkte auf dem Bild angeben, dann die wahre Länge in mm tippen (oder dritten Punkt klicken) — das Bild wird um den ersten Punkt maßstäblich skaliert.

### Rippendesigner: Stege berücksichtigen (2026-11-01)
- Neue Option **„Stege berücksichtigen“** (Gruppe Halbrippen): Die Rippen werden an den Holm- und Ruderstegen aus dem Reiter Steghöhen getrennt, die Stegbreite bleibt frei. Es zählt nur ein Steg, der in der Spannweitenlage der Rippe verläuft; auch die schräge Wurzelrippe wird richtig getroffen. Der Grundriss zeigt die Stege.
- Die Teilstücke gehen in Galerie und STL. Die Übernahme ins CAD und in die Fräse nimmt jetzt ebenfalls die Teilstücke, also auch Halbrippen, die dort bisher als ganze Rippe ankamen.

## [2.0] — 2026-11-01
### Neue Module
- **Rumpf:** Rumpf aus Umrissen und parametrischen Spanten, Tragflächenübergang, Seitenleitwerk, Export STL/DXF.
- **Rumpf Spanten und Schnittspanten:** Bauteile aus Spanten oder frei gelegten Schnittebenen, als DXF, Stückliste und ins CAD.
- **Rumpf Formenbau:** Formen für Rumpf und Kabinenhaube als STL.
- **Steghöhen:** Holm- und Ruderstege mit Höhenliste und Schnitten, Übernahme ins CAD.
- **Flächenservos:** Servos, Hebel, Anlenkung und Kinematik mit Kollisionsprüfung und Schnitten.
- **Cockpit:** Instrumentenpilz, Instrumentenbrett, Sitzwanne; passt sich an ein eigenes STL an.
- **Decals:** Schriftzüge und Motive maßgetreu als SVG, DXF und für Silhouette.
- **3D-Bearbeitung:** STL/OBJ/STEP/IGES zusammensetzen und bearbeiten, CAD-Volumen (OpenCascade), Schnitte.
- **Profilpolaren in der Profildatenbank:** XFOIL und NeuralFoil, auch im direkten Vergleich; dazu Polaren in den Profil-Vergleichsfenstern und im KFm-Gestalter.

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
