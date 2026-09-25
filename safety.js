/* safety.js — Einmalige Bestätigung des Sicherheitshinweises vor dem ersten
 * Maschinenlauf (Reiter „Schneiden" und „Fräse").
 *
 * Abschnitt 2.2b der Lizenzbedingungen verlangt einen hardwareseitigen,
 * zwangsöffnenden Not-Aus und stellt klar, dass die Halt-, Grenzwert- und
 * Endlagenfunktionen des Programms reine Bedienhilfen ohne Sicherheitswirkung
 * sind. Damit nachvollziehbar bleibt, dass der Nutzer davon Kenntnis hatte,
 * wird die Bestätigung einmal je Benutzer mit Datum festgehalten — nach dem
 * Muster der Lizenzzustimmung (electron/eula.js), hier aber im localStorage,
 * weil der Dialog in beiden Ausgaben (Electron und PyInstaller) gebraucht wird.
 *
 * Massgeblich ist VERSION: ein neuer Wert fragt erneut. Die optionale
 * Schneid-Checkliste (filesys.js, vor JEDEM Schnitt) bleibt davon unberührt —
 * dieser Hinweis erscheint nur beim ersten Mal.
 *
 * Zwei Einhängevarianten:
 *   safetyAck(then) — für Programmstarts: bestätigt der Nutzer, läuft then().
 *   safetyOk()      — für Knöpfe, die SOFORT die Maschine bewegen oder Energie
 *                     einschalten (Handfahrt, Referenzfahrt, Fahren auf
 *                     Nullpunkt, Draht/Spindel EIN). Liefert false und zeigt
 *                     den Hinweis; die Bewegung wird NICHT nachgeholt — der
 *                     Nutzer drückt bewusst erneut. Sonst würde sich die
 *                     Maschine im Moment des Bestätigens in Bewegung setzen.
 * Knöpfe, die etwas ABSCHALTEN oder stoppen (Draht AUS, Stopp, Abbruch,
 * Not-Halt, Referenzfahrt stoppen), werden NIE gesperrt. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const T = (s) => (window.I18N ? window.I18N.t(s) : s);

  const LS_KEY = 'hotwire-safety-ack';
  const VERSION = '2026-09-23';          // erhöhen, wenn der Text sich ändert

  const POINTS = [
    'Meine Maschine hat einen hardwareseitigen, zwangsöffnenden Not-Aus, der unabhängig von Computer und Programm wirkt und Antriebe, Heizdraht und Spindel unmittelbar abschaltet.',
    'Mir ist bekannt, dass alle Halt-, Pause-, Grenzwert-, Arbeitsraum-, Kollisions- und Endlagenfunktionen dieses Programms reine Bedienhilfen ohne Sicherheitswirkung sind und jederzeit ausfallen können.',
    'Ich lasse die Maschine während des Laufs nicht unbeaufsichtigt und habe den Verfahrweg vorher in der Simulation geprüft.',
    'Brandschutz und Absaugung sind sichergestellt: Der Heißdraht ist eine Zündquelle, Schaumstoffe sind brennbar und setzen beim Schneiden gesundheitsschädliche Dämpfe frei.',
    'Ich bin Hersteller und Betreiber meiner Maschine und trage die Verantwortung für deren Sicherheit (Abschnitt 2.2 und 2.2b der Lizenzbedingungen).'
  ];

  function stored() {
    try {
      const r = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      return r && r.v === VERSION ? r : null;
    } catch (e) { return null; }
  }
  function remember() {
    const rec = { v: VERSION, date: new Date().toISOString().slice(0, 10),
                  lang: (window.I18N && I18N.getLang()) || 'de' };
    try { localStorage.setItem(LS_KEY, JSON.stringify(rec)); } catch (e) {}
    return rec;
  }
  /** Bestätigt? — für die Anzeige in den Einstellungen. */
  function safetyAckInfo() { return stored(); }
  /** Zurücksetzen — der Hinweis erscheint beim nächsten Start erneut. */
  function safetyAckReset() { try { localStorage.removeItem(LS_KEY); } catch (e) {} }

  /** Für Sofort-Aktionen: true = darf laufen. Sonst Hinweis zeigen, false.
   *  Die Aktion wird bewusst NICHT nachgeholt (siehe Kopfkommentar). */
  function safetyOk() {
    if (stored()) return true;
    safetyAck(function () {}, { again: true });
    return false;
  }

  /** then() läuft erst, wenn der Hinweis bestätigt ist (oder es schon war). */
  function safetyAck(then, opts) {
    if (stored()) { then(); return; }
    let bd = document.getElementById('safetyModal');
    if (!bd) {
      bd = document.createElement('div'); bd.className = 'modal-backdrop'; bd.id = 'safetyModal';
      bd.innerHTML = '<div class="modal" style="width:min(640px,94vw)"><div class="head"><h2></h2>'
        + '<button class="close-x" title="Schließen">×</button></div>'
        + '<div class="body"></div><div class="foot"><div class="mrow"><span class="hint"></span>'
        + '<div class="sp"></div><button class="sf-cancel"></button>'
        + '<button class="primary sf-ok" disabled></button></div></div></div>';
      document.body.appendChild(bd);
    }
    const q = sel => bd.querySelector(sel);
    q('h2').textContent = T('Sicherheitshinweis — vor dem ersten Maschinenlauf');
    q('.foot .hint').textContent = (opts && opts.again)
      ? T('Nach dem Bestätigen den Knopf erneut drücken — die Maschine setzt sich nicht von selbst in Bewegung.')
      : T('Wird einmal je Benutzer festgehalten. Erneut anzeigen: Einstellungen → Beschreibungen und Checkliste.');
    q('.sf-cancel').textContent = T('Abbrechen');
    q('.sf-ok').textContent = T('Bestätigen und fortfahren');

    const body = q('.body'); body.textContent = '';
    const lead = document.createElement('div'); lead.className = 'hint';
    lead.style.cssText = 'margin-bottom:10px;line-height:1.45';
    lead.textContent = T('Dieses Programm erzeugt Steuerdaten und ist kein Sicherheitsbauteil. '
      + 'Bitte bestätigen Sie vor dem ersten Maschinenlauf, dass die folgenden Punkte zutreffen.');
    body.appendChild(lead);

    const boxes = [];
    POINTS.forEach(txt => {
      const l = document.createElement('label');
      l.style.cssText = 'display:flex;gap:10px;align-items:flex-start;padding:8px 4px;border-bottom:1px solid var(--line);cursor:pointer;font-size:14px;line-height:1.4';
      const cb = document.createElement('input'); cb.type = 'checkbox';
      cb.style.cssText = 'width:18px;height:18px;flex:0 0 auto;margin-top:1px';
      cb.onchange = () => { q('.sf-ok').disabled = !boxes.every(b => b.checked); };
      l.appendChild(cb); l.appendChild(document.createTextNode(T(txt)));
      body.appendChild(l); boxes.push(cb);
    });
    q('.sf-ok').disabled = true;

    const close = () => bd.classList.remove('open');
    q('.close-x').onclick = close; q('.sf-cancel').onclick = close;
    q('.sf-ok').onclick = () => { remember(); close(); then(); };
    bd.classList.add('open');
  }

  Object.assign(App, { safetyAck, safetyOk, safetyAckInfo, safetyAckReset });
})();
