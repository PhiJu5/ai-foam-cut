/* materials.js — Werkstoff-„Datenbank".
 *
 * Bewusst LEER: Es gibt KEINE voreingestellten Werkstoffe. Alle Werkstoffe —
 * inkl. Name — werden vom Benutzer selbst im Reiter „Werkstoff" angelegt und
 * dort komplett frei eingegeben. Die App verwaltet die benutzerdefinierten
 * Werkstoffe in `state.material` (siehe app.js: matList/addMaterial/…).
 *
 * Dieses Modul bleibt als Schnittstelle bestehen, damit später bei Bedarf doch
 * eine echte Datenbank/Backend-Anbindung ergänzt werden kann: es genügt,
 * `Materials.list()` / `Materials.get()` so umzustellen, dass sie ihre Daten aus
 * einem Backend/Fetch (dann ggf. asynchron) beziehen — die Struktur der Objekte
 * bleibt gleich.
 *
 * Feldbedeutung eines Eintrags:
 *   id        eindeutiger Schlüssel (wird gespeichert, nicht der Anzeigename)
 *   name      Anzeigename
 *   category  Gruppierung (z. B. „Schaum")
 *   density   Rohdichte (kg/m³) — informativ
 *   kerf      typischer Schnittspalt beim Heißdraht (mm), null = unbekannt
 *             (Mittelwert / Rückfallwert, wenn kein Tempo gewählt ist)
 *   kerfSlow  Schnittspalt bei LANGSAMEM Vorschub / heißerem Draht (mm) — der
 *             Draht verweilt länger, das Material schmilzt weiter zurück ->
 *             breiterer Spalt. null = unbekannt (fällt auf `kerf` zurück).
 *   kerfFast  Schnittspalt bei SCHNELLEM Vorschub / kühlerem Draht (mm) ->
 *             schmalerer Spalt. null = unbekannt (fällt auf `kerf` zurück).
 *   feed      Richtwert Vorschub am Schaum (mm/min), null = unbekannt
 *   feedSlow  Vorschub am langsamen Betriebspunkt (mm/min). Sollte >= feedFast/2
 *             sein (siehe Trapez-Regel: außen nicht kürzer als die halbe Innen-
 *             sehne, sonst läuft die kürzere Seite unter das halbe Tempo).
 *   feedFast  Vorschub am schnellen Betriebspunkt (mm/min).
 *   heat      Drahtheizung (%) — konstant, unabhängig von langsam/schnell.
 *   note      Hinweis (z. B. Sicherheit), optional
 *
 * Die Werte sind Richtwerte; im Reiter „Werkstoff" lässt sich der Schnittspalt
 * (langsam/schnell) je Werkstoff manuell überschreiben.
 */
(function (global) {
  'use strict';

  // --- Keine voreingestellten Werkstoffe. ----------------------------------
  // Alles (auch der Name) wird vom Benutzer selbst angelegt. Bleibt leer.
  const DB = [];

  function list() { return DB.map(m => Object.assign({}, m)); }
  function get(id) { const m = DB.find(x => x.id === id); return m ? Object.assign({}, m) : null; }
  // Optionen für <select>: [[id, name], …]
  function options() { return DB.map(m => [m.id, m.name]); }

  global.Materials = { list, get, options };
})(window);
