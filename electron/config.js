// Zentrale Einstellungen fuer die Electron-Variante.
module.exports = {
  APP_NAME: 'AI Foam Cut',
  // Ausgabe/Edition dieser exe (vom Build-Werkzeug gesetzt, z. B. "Design").
  // Bestimmt den Zusatz im Fenstertitel oben links.
  EDITION: '',
  HTML_NAME: 'AI Foam Cut.html',
  SETTINGS_NAME: 'hotwing-settings.json',
  LAST_CHOICE_FILE: '.hotwing-last-settings.txt',
  // Ablaufdatum: Jahr, Monat (1-12), Tag - null = kein Ablaufdatum.
  // In der quelloffenen Fassung bleibt das null. Das Build-Werkzeug kann hier
  // ein Datum eintragen, wenn jemand bewusst eine befristete Ausgabe baut.
  EXPIRY: null,
  // Fester Port, damit der localStorage-Origin ueber Neustarts stabil bleibt.
  PREFERRED_PORTS: [58743, 58744, 58745, 58746],
  // Entwicklerwerkzeuge (F12 / Strg+Shift+I).
  DEVTOOLS: true,
};
