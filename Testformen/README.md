# Testformen: Abbrand aus Bahngeschwindigkeit bei wechselndem Portal-Vorschub

Zu jeder Form gibt es zwei Dateien:
- **.json** = fertiges Projekt (Laden -> Projekt): DXF-Formen inkl. Synchronpaaren, Abbrand ein,
  Abbrand-Berechnung „Aus Bahngeschwindigkeit (lokal)", sichere Anfahrt, 240 Bahnpunkte, Spannweite 300 mm.
- **.dxf** = nur die Konturen (Layer INNEN = Wurzel, AUSSEN = Rand) zum manuellen Import; Synchronpunkte dann wie unten setzen.

Die Werkstoff-Kalibrierung ist NICHT im Projekt enthalten (sie gehört zum Werkstoff).

Empfohlene Kalibrierung zum Vergleich: Abbrand langsam 2,4 mm bei 80 mm/min, schnell 1,0 mm bei 300 mm/min.

- 01_Kreis_Dreieck.dxf — INNEN 64 Pkt, AUSSEN 3 Pkt. Sync: 3 Paare — je Dreiecksecke auf den nächstliegenden Kreispunkt
- 02_Stern_Kreis.dxf — INNEN 10 Pkt, AUSSEN 72 Pkt. Sync: 5 Paare an den Sternspitzen
- 03_LForm_Rechteck.dxf — INNEN 6 Pkt, AUSSEN 4 Pkt. Sync: 4 Paare — L-Ecken (0,0)(60,0)(20,60)(0,60) auf die 4 Rechteckecken
- 04_Rechteck_LForm.dxf — INNEN 4 Pkt, AUSSEN 6 Pkt. wie 03, Seiten getauscht
- 05_Schlitz_Rechteck.dxf — INNEN 8 Pkt, AUSSEN 4 Pkt. Sync: 4 Paare — Außenecken des Schlitzteils auf die Rechteckecken
- 06_Rechteck_Schlitz.dxf — INNEN 4 Pkt, AUSSEN 8 Pkt. wie 05, Seiten getauscht
- 07_Ellipse_Ellipse_gedreht.dxf — INNEN 96 Pkt, AUSSEN 96 Pkt. Sync: 4 Paare an den Scheiteln
- 08_Rundrechteck_Quadrat.dxf — INNEN 36 Pkt, AUSSEN 4 Pkt. Sync: 4 Paare — Bogenmitten auf Quadratecken
- 09_Quadrat_Kreis_klein.dxf — INNEN 4 Pkt, AUSSEN 48 Pkt. Sync: 4 Paare — Quadratecken auf Kreis bei 45°/135°/…
- 10_Dreieck_Dreieck_gedreht.dxf — INNEN 3 Pkt, AUSSEN 3 Pkt. Sync: 3 Paare Ecke auf Ecke (Umlaufrichtung beachten)
- 11_Kreis_Kreis_versetzt.dxf — INNEN 64 Pkt, AUSSEN 64 Pkt. Sync: 1 Paar genügt (gleicher Querschnitt versetzt)
- 12_Trapez_Stern8.dxf — INNEN 4 Pkt, AUSSEN 16 Pkt. Sync: 4 Paare — Trapezecken auf 4 Sternspitzen

## 3D-Modell (Reiter „3D-Modell")

- 13_Testrumpf_Spindel.obj — Wavefront-OBJ zum Test des OBJ-Imports (2026-09-20):
  Achteck-Spindel entlang X, 300 mm lang, max. ⌀ ~80 mm, Vierecks-Flächen +
  Achteck-Deckel (testet die n-Eck-Triangulation). Schnittachse X wird
  automatisch gewählt; gut zum Zerlegen in Segmente.
