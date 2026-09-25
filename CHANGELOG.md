# Changelog

Alle nennenswerten Änderungen an **AI Foam Cut** werden hier dokumentiert.
Format angelehnt an [Keep a Changelog](https://keepachangelog.com/de/).
Neueste Einträge oben.

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
