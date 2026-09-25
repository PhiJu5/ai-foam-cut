# AI Foam Cut

Freie Software zum Entwerfen von Modellflug-Tragflächen und zum Erzeugen von G-Code für
CNC-Heißdrahtschneider (2 Türme / 4 Achsen), Fräsen und den Formenbau.

Entwickelt als vollwertige Alternative zu kommerziellen Programmen dieser Art — und seit
September 2026 quelloffen unter der GPL-3.0.

## ⚠️ Sicherheitshinweis

Dieses Programm steuert Maschinen an: glühende Drähte bei mehreren hundert Grad und Fräsen mit
schnell drehenden Werkzeugen. **Betrieb ausschließlich auf eigene Verantwortung.**

- Eine erreichbare Not-Aus-Einrichtung ist Voraussetzung. Das Programm ersetzt sie nicht.
- Maschine niemals unbeaufsichtigt laufen lassen.
- Erzeugten G-Code vor dem ersten Lauf prüfen (die Wegvorschau ist dafür da).
- Es gibt **keine Gewährleistung** und **keine Haftung** — siehe Abschnitte 15–17 der `LICENSE`.

## Funktionen

- **Tragflächen**: Mehrsegmentflügel, Profil je Segment (NACA oder `.dat`), Pfeilung, Schränkung,
  Holm- und Spar-Schnitte, Beplankungsabzug, Abbrandkompensation je Designebene
- **Kern- und Negativdesign**: Negativschalen, Kern-Stege, Kern zerteilen
- **Formenbau**: Urmodell und Negativform als STL, B-Spline-Glättung, Trennfläche,
  Krümmungs- und Zebra-Analyse, STEP-Export
- **Rumpf**: Loft aus Bezier-Splines, Spanten mit Anformungen
- **Fräse**: 2D-CAM (außen/innen/Tasche/Bohren, Haltestege) und GRBL-Steuerung
- **CAD-Bearbeitung**: eigener 2D-Editor mit AutoCAD-artiger Befehlszeile
- **3D-Modell**: STL/OBJ und Flugsimulator-Modelle (X-Plane, FlightGear, glTF) zerlegen
- **Schriften**: Linienschriften und TTF/OTF als Schnittbahn
- **Datenaustausch**: XFLR5 (`.xfl`), FLZ_vortex (`.flz`), PC2, GMFC (`.cnc`), DXF, STL, STEP
- **Maschinensteuerung**: G-Code-Erzeugung, Wegvorschau, GRBL-Anbindung, Drahtheizungskalibrierung

Zweisprachig (Deutsch/Englisch), umschaltbar in den Einstellungen.

## Starten

Es gibt zwei Wege, dasselbe Programm zu starten.

**Im Browser** (Python, keine weiteren Abhaengigkeiten):

```
python launcher.py
```

Ein Browserfenster oeffnet sich, alles laeuft lokal auf `127.0.0.1`.
Voraussetzung: Python 3.11 oder neuer.

**Im eigenen Fenster** (Electron - fuehlt sich wie ein normales Programm an,
eigener Serieller-Port-Dialog):

```
npm install
npm start
```

## Eigene Ausgabe bauen

Beide Varianten lassen sich zu einer eigenstaendigen Datei packen. Ueber
`features.json` waehlst du, welche Funktionen enthalten sein sollen - nuetzlich
fuer schlanke Ausgaben oder zum Ausprobieren einzelner Bereiche.

Unter Windows geht das mit einem Doppelklick, sonst von der Befehlszeile:

| Variante | Doppelklick | Befehlszeile |
|---|---|---|
| **Browser** (PyInstaller, `.exe` die den Browser oeffnet) | `BUILD_TOOL.bat` | `python build_tool.py` |
| **Electron** (eigenes Fenster, `.exe` bzw. AppImage) | `BUILD_TOOL_ELECTRON.bat` | `python build_tool_electron.py` |

Beide oeffnen ein Fenster: Funktionen anhaken, Version eintragen, bauen. Das
Protokoll laeuft im Fenster mit, der Bau laesst sich abbrechen. Einstellungen
lassen sich als Profil speichern und wieder laden.

Ohne Fenster geht es auch:

```
python build_tool_electron.py --cli --name "AI Foam Cut" --version 1.4
python build_tool_electron.py --cli --target linux
```

Dafuer werden Node.js und die Abhaengigkeiten aus `package.json` gebraucht
(einmalig `npm install --prefix %USERPROFILE%/afc-build`). Die Linux-Ausgabe
baut electron-builder unter Linux oder in WSL.

## Dokumentation

- `BENUTZERHANDBUCH.md` — Benutzerhandbuch (deutsch), zusätzlich als PDF
- `USER_MANUAL_EN.md` — kurze englische Fassung
- `ENTWICKLUNG.md` — Aufbau der Module, interne Zusammenhänge
- `CHANGELOG.md` — Änderungen (deutsch), `CHANGELOG_EN.md` (englisch)

## Lizenz

GNU General Public License, Version 3 oder später — siehe `LICENSE`.

Das heißt: benutzen, weitergeben und ändern ist frei. Wer eine geänderte Fassung weitergibt,
muss den Quellcode ebenfalls unter der GPL offenlegen.

Die Lizenzen der mitgelieferten Fremdkomponenten stehen in `THIRD_PARTY_LICENSES.md`.

## Mitmachen

Fehlerberichte und Verbesserungen sind willkommen. Wer Code beisteuert, stellt ihn unter dieselbe
Lizenz (GPL-3.0-or-later).

Beim Melden eines Fehlers hilft es sehr, die Projektdatei mitzuschicken, mit der er auftritt.
