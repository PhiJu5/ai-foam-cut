/* grbl.js — grblHAL-Steuerung über Web Serial (4-Achs-Heißdrahtpendant).
   Logik übernommen aus hotwire_grbl_web.html.

   Achszuordnung kommt aus der G-Code-Konfiguration der App:
   Slot 0 = Turm L horiz., 1 = Turm L vert., 2 = Turm R horiz., 3 = Turm R vert.
   Die Statusmeldung <...|MPos:a,b,c,d> liefert die Werte in Maschinen-
   Achsreihenfolge — Slot n entspricht dem n-ten Wert. */
(function () {
  'use strict';

  const T = (s) => (window.I18N ? window.I18N.t(s) : s);

  const STATUS_POLL_MS = 200;
  const WIRE_S_MAX = 1000;            // = $30 (max. Spindeldrehzahl), Fallback

  // ---------- Firmware-Profile ------------------------------------------
  // Beide Steuerungen sprechen das GRBL-Protokoll (?-Status, ok/error, $$,
  // $J=-Jog, M3 S/M5) — deshalb genügt derselbe serielle Treiber. Die Profile
  // unterscheiden nur, was drumherum verschieden ist: Bezeichnung, Default-
  // Baudrate, max. Drahtleistung ($30) und der Titel des $$-Fensters.
  //   grblhal  = grblHAL-4-Achs-Treiber
  //   mega5x   = rcKeith „GRBL HotWire Mega 5X" (Fork von grbl-mega-5x 1.2,
  //              GRBL-1.1/1.2-kompatibel; Achsen X Y Z A, Arduino Mega 2560)
  const FIRMWARES = {
    grblhal: { name: 'grblHAL',   baud: 115200, sMax: 1000, settingsTitle: 'grblHAL-Einstellungen ($$)' },
    mega5x:  { name: 'Mega 5X',   baud: 115200, sMax: 1000, settingsTitle: 'Mega 5X-Einstellungen ($$)' }
  };
  let firmware = 'grblhal';           // aktives Profil
  const fw = () => FIRMWARES[firmware] || FIRMWARES.grblhal;

  // ---------- GRBL über Web Serial --------------------------------------
  class Grbl {
    constructor() {
      this.port = null; this.writer = null; this.reader = null;
      this.connected = false;
      this.buf = '';
      this.pending = [];              // Resolver für 'ok'/'error'
      this.onStatus = () => {}; this.onConsole = () => {}; this.onSetting = () => {};
      this._pollTimer = null;
      this.streaming = false; this.paused = false;
    }

    // Wartende ok-Quittungen auflösen und die Warteschlange leeren. WICHTIG bei
    // Feed-Hold/Reset/Trennen: für die angehaltene Zeile kommt NIE ein 'ok'. Bleibt
    // der Resolver stehen, ist die FIFO-Zuordnung ok -> send() dauerhaft um eins
    // verschoben — danach wartet jeder Jog auf die Quittung des VORHERIGEN Befehls
    // und die Handfahrt reagiert gar nicht mehr. Das überlebt sogar Trennen und
    // Neuverbinden (nur ein Seiten-Neuladen half bisher).
    flushPending(reason = 'reset') {
      const pend = this.pending; this.pending = [];
      pend.forEach(p => { try { p(reason); } catch (e) {} });
    }

    async connect(baud) {
      if (!('serial' in navigator))
        throw new Error(T('Web Serial nicht verfügbar. Bitte Chrome oder Edge verwenden (nicht Firefox/Safari).'));
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: baud });
      this.writer = this.port.writable.getWriter();
      this.reader = this.port.readable.getReader();
      // Zustand aus einer früheren Sitzung verwerfen — sonst startet die neue
      // Verbindung mit halben Zeilen im Puffer und verschobener ok-Zuordnung.
      this.buf = ''; this.streaming = false; this.paused = false;
      this.lastState = ''; this.lastPins = '';
      this.flushPending('error:disconnected');
      this.connected = true;
      this._readLoop();
      // GRBL-Reset abwarten, Puffer verwerfen
      await new Promise(r => setTimeout(r, 1500));
      this.buf = ''; this.flushPending('error:disconnected');
      this._pollTimer = setInterval(() => this.rt('?'), STATUS_POLL_MS);
      this.onConsole(T('Verbunden (') + fw().name + ').', 'sys');
    }

    async disconnect() {
      this.streaming = false; this.paused = false;
      clearInterval(this._pollTimer); this._pollTimer = null;
      this.connected = false;
      this.buf = '';
      this.flushPending('error:disconnected');    // hängende Wartende freigeben
      try { await this.reader.cancel(); } catch (e) {}
      try { this.reader.releaseLock(); } catch (e) {}
      // abort() verwirft noch nicht geschriebene Bytes. Ohne das schlägt
      // releaseLock/close fehl, der Port bleibt offen und ein erneutes Verbinden
      // scheitert (bisher half nur ein Neuladen der Seite).
      try { await this.writer.abort(); } catch (e) {}
      try { this.writer.releaseLock(); } catch (e) {}
      try { await this.port.close(); } catch (e) {}
      this.port = null; this.writer = null; this.reader = null;
      this.onConsole(T('Getrennt.'), 'sys');
    }

    async _readLoop() {
      const dec = new TextDecoder();
      try {
        while (this.connected) {
          const { value, done } = await this.reader.read();
          if (done) break;
          this.buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = this.buf.indexOf('\n')) >= 0) {
            const line = this.buf.slice(0, idx).trim();
            this.buf = this.buf.slice(idx + 1);
            if (line) this._dispatch(line);
          }
        }
      } catch (e) {
        if (this.connected) this.onConsole(T('Lesefehler: ') + e.message, 'err');
      }
    }

    _dispatch(line) {
      if (line.startsWith('<') && line.endsWith('>')) {
        this.onStatus(this._parseStatus(line));
      } else if (line === 'ok') {
        const p = this.pending.shift(); if (p) p('ok');
      } else if (line.startsWith('error')) {
        this.onConsole('<< ' + line, 'err');
        const p = this.pending.shift(); if (p) p(line);
      } else if (line.startsWith('ALARM')) {
        this.onConsole('!! ' + line + T('  (mit $X quittieren)'), 'err');
        const p = this.pending.shift(); if (p) p('ok');
      } else if (/^\$\d+=/.test(line)) {
        this.onSetting(line);         // $n=Wert aus $$ -> Einstellungs-Fenster
      } else {
        this.onConsole('<< ' + line);
      }
    }

    _parseStatus(line) {
      const parts = line.slice(1, -1).split('|');
      const st = { state: parts[0], pos: [], isMPos: false, wco: null, feed: null, pins: '' };
      for (const p of parts.slice(1)) {
        if (p.startsWith('MPos:')) { st.pos = p.slice(5).split(',').map(parseFloat); st.isMPos = true; }
        else if (p.startsWith('WPos:')) { st.pos = p.slice(5).split(',').map(parseFloat); st.isMPos = false; }
        else if (p.startsWith('WCO:')) { st.wco = p.slice(4).split(',').map(parseFloat); }
        // FS:<Vorschub>,<Spindel>  bzw.  F:<Vorschub> — aktuelle Ist-Geschwindigkeit
        else if (p.startsWith('FS:')) { st.feed = parseFloat(p.slice(3).split(',')[0]); }
        else if (p.startsWith('F:')) { st.feed = parseFloat(p.slice(2)); }
        // Pn:<Buchstaben> = aktive Eingangspins (Endschalter X/Y/Z/A, P=Probe,
        // D=Tür, R=Reset, H=Hold). Fehlt das Feld, ist KEIN Pin aktiv -> ''.
        else if (p.startsWith('Pn:')) { st.pins = p.slice(3); }
      }
      return st;
    }

    async rt(byteOrChar) {            // Echtzeit-Byte, keine ok-Quittung
      if (!this.connected) return;
      const data = typeof byteOrChar === 'string'
        ? new TextEncoder().encode(byteOrChar)
        : new Uint8Array([byteOrChar]);
      try { await this.writer.write(data); } catch (e) {}
    }

    send(line, echo = true) {         // Zeile senden, auf ok/error warten
      if (!this.connected) return Promise.resolve('error:not-connected');
      line = line.trim();
      if (echo) this.onConsole('>> ' + line, 'tx');
      return new Promise((resolve) => {
        this.pending.push(resolve);
        this.writer.write(new TextEncoder().encode(line + '\n')).catch(() => {
          const i = this.pending.indexOf(resolve); if (i >= 0) this.pending.splice(i, 1);
          resolve('error:write');
        });
      });
    }

    // Komfort
    feedHold() { return this.rt('!'); }
    resume() { return this.rt('~'); }
    // Sofortiger Abbruch: Bewegung anhalten und mit Soft-Reset (Ctrl-X) den
    // gesamten Planner-Puffer verwerfen — es wird NICHTS mehr weitergefahren.
    // Hängende ok-Quittungen werden aufgelöst (nach dem Reset kommt kein ok mehr).
    async abort() {
      this.streaming = false; this.paused = false;
      await this.rt('!');                         // Feed-Hold: sofort abbremsen
      await new Promise(r => setTimeout(r, 60));
      await this.rt(0x18);                         // Soft-Reset: Puffer leeren
      this.flushPending('reset');
    }
    jog(ax, dist, feed) { return this.send(`$J=G91 G21 ${ax}${dist.toFixed(3)} F${feed}`); }
    // Dauer-Handfahrt endet mit jogCancel: 0x85 bricht nur den Jog-Puffer sanft
    // ab (verwirft die noch nachgeschobenen kleinen Jogs), ohne Soft-Reset.
    jogCancel() { return this.rt(0x85); }
    wire(pct) {
      const sMax = (FIRMWARES[firmware] || {}).sMax || WIRE_S_MAX;
      // Schaltausgang (Relais/SSR) parallel zur Heizung — dieselbe Einstellung
      // wie im erzeugten G-Code (state.cfg.relayOut, siehe applyRelay in
      // gcodegen.js). Reihenfolge wie dort: EIN vor M3, AUS nach M5.
      const c = (window.App && App.state && App.state.cfg) || {};
      const rel = c.relayOut && window.App && App.relayCmds ? App.relayCmds(c) : null;
      if (pct <= 0) {
        const p = this.send('M5');
        return rel && rel.off ? p.then(() => this.send(rel.off)) : p;
      }
      const cmd = () => this.send('M3 S' + Math.round(pct / 100 * sMax));
      return rel && rel.on ? this.send(rel.on).then(cmd) : cmd();
    }

    // Character-Counting-Streaming: so viele Zeilen vorausschicken, wie in den
    // RX-Puffer des Controllers passen (GRBL: 128 Byte, 1 Reserve), statt jede
    // Zeile einzeln auf ihr ok warten zu lassen. Beim Ping-Pong laeuft der
    // Planner bei kurzen Segmenten leer, sobald die USB-/Chromium-Latenz
    // steigt (neuere Chromium/Electron) -> Ruckeln bei kaum CPU-Last.
    async stream(lines, onProgress, onDone) {
      this.streaming = true; this.paused = false;
      const total = lines.length;
      const RX = (fw() && fw().rxBuf) || 127;
      const enc = new TextEncoder();
      let inflight = [];                // [{len, idx}] gesendet, ok ausstehend
      let used = 0, failed = false, waiter = null;
      const wake = () => { if (waiter) { const w = waiter; waiter = null; w(); } };
      const waitAck = () => new Promise(r => { waiter = r; });
      for (let i = 0; i < total; i++) {
        if (!this.streaming || failed) break;
        while (this.paused && this.streaming) { await new Promise(r => setTimeout(r, 100)); }
        const code = lines[i].split(';')[0].trim();
        if (!code) { if (!inflight.length) onProgress(i + 1, total); continue; }
        // Programmpause M0: erst alles Vorausgeschickte quittieren lassen,
        // dann senderseitig anhalten (nicht an den Controller senden).
        if (/\bM0\b/i.test(code)) {
          while (inflight.length && this.streaming && !failed) await waitAck();
          if (!this.streaming || failed) break;
          onProgress(i + 1, total);
          this.paused = true; if (this.onPause) this.onPause(i + 1, total); continue;
        }
        const len = enc.encode(code + '\n').length;
        while (inflight.length && used + len > RX && this.streaming && !failed) await waitAck();
        if (!this.streaming || failed) break;
        const item = { len, idx: i };
        inflight.push(item); used += len;
        this.send(code, false).then(resp => {
          const k = inflight.indexOf(item);
          if (k >= 0) { inflight.splice(k, 1); used -= len; }
          if (resp.startsWith('error')) {
            if (!failed) this.onConsole(T('Stopp bei Zeile ') + (item.idx + 1) + ': ' + resp, 'err');
            failed = true; this.streaming = false;
          } else onProgress(item.idx + 1, total);
          wake();
        });
      }
      const aborted = !this.streaming && !failed;
      while (inflight.length && !failed && this.streaming) await waitAck();
      if (aborted) this.onConsole(T('Streaming abgebrochen.'), 'sys');
      this.streaming = false;
      onDone();
    }
  }

  // ---------- Beschreibungen für das $$-Fenster -------------------------
  // Slots 0/1 = XY-Portal (z=0, „links"), 2/3 = UZ-Portal (z=machineWidth, „rechts").
  const TOWER = ['Portal links · horiz.', 'Portal links · vert.', 'Portal rechts · horiz.', 'Portal rechts · vert.'];
  const DESC = {
    '0': 'Schrittimpuls, µs', '1': 'Schritt-Idle-Verzögerung, ms',
    '2': 'Schrittport-Invert-Maske', '3': 'Richtungsport-Invert-Maske',
    '4': 'Step-Enable invertieren', '5': 'Limit-Pins invertieren',
    '6': 'Probe-Pin invertieren', '10': 'Statusreport-Maske',
    '11': 'Junction-Deviation, mm', '12': 'Arc-Toleranz, mm',
    '13': 'Report in Zoll', '20': 'Soft-Limits aktiv', '21': 'Hard-Limits aktiv',
    '22': 'Homing aktiv', '23': 'Homing-Richtung-Invert-Maske',
    '24': 'Homing-Feed, mm/min', '25': 'Homing-Seek, mm/min',
    '26': 'Homing-Entprellung, ms', '27': 'Homing-Pull-off, mm',
    '30': 'Max. Spindeldrehzahl S  (= max. Drahtleistung)', '31': 'Min. Spindeldrehzahl',
    '32': 'Lasermodus aktiv'
  };
  // Achsbezogene Settings mit Turmzuordnung beschriften ($100.., $110.. usw.)
  // Basis-Text + Achsindex getrennt speichern, damit die Beschreibung erst beim
  // Rendern (sprachabhängig) zusammengesetzt wird.
  const AXDESC = {};
  [[100, 'Schritte/mm'], [110, 'Max. Rate, mm/min'], [120, 'Beschleunigung, mm/s²'],
   [130, 'Max. Verfahrweg, mm'], [140, 'Motorstrom, mA (TMC)'], [150, 'Microsteps (TMC)']]
    .forEach(([base, txt]) => {
      for (let i = 0; i < 4; i++) AXDESC[String(base + i)] = { txt, i };
    });
  // Übersetzte $$-Beschreibung für Nummer num (leer, wenn unbekannt).
  function descFor(num) {
    if (DESC[num]) return T(DESC[num]);
    const a = AXDESC[num];
    if (a) return T(a.txt) + ' · ' + T('Achse ') + (a.i + 1) + ' (' + T(TOWER[a.i]) + ')';
    return '';
  }

  // ---------- Bedienoberfläche ------------------------------------------
  const grbl = new Grbl();
  const $ = s => document.querySelector(s);

  let axes = [];                      // [{letter, tower}] — aus der App-Konfig
  let posGroups = [];                 // DRO-Zellen je Slot, je Instanz (Maschine + Schneiden)
  let limGroups = [];                 // Endschalter-Lampen je Slot, je Instanz
  let gcodeLines = [];
  let getAxisLetters = () => ['X', 'Y', 'Z', 'A'];
  let getProgram = () => ({ text: '', scene: null, label: 'Programm' });
  let getLimits = () => ({ h: 0, v: 0 });   // max. Fahrweg horiz./vert. (0 = kein Limit)
  let monPlaying = false;             // Vorschau-Simulation im Monitor aktiv?
  let monAutoPaused = false;          // Simulator an einer M0-Stelle auto-pausiert?
  const setMap = {};

  // Achswort -> Bit-Position der Richtungsport-Invert-Maske ($3) in grbl/grblHAL.
  const AXIS_BIT = { X: 0, Y: 1, Z: 2, A: 3, B: 4, C: 5, U: 6, V: 7 };
  let invertMask = 0;              // zuletzt bekannter Wert von $3
  const invertChecks = {};         // Achsbuchstabe -> Checkbox

  function bitOf(letter, i) { return AXIS_BIT[letter] != null ? AXIS_BIT[letter] : i; }

  // Checkboxen an den bekannten $3-Wert angleichen.
  function syncInvertChecks() {
    Object.entries(invertChecks).forEach(([letter, cb], i) => {
      cb.checked = !!(invertMask & (1 << bitOf(letter, i)));
    });
  }

  let invertHost = null;   // Ziel-Container der Invert-Checkboxen (Sidebar-Gruppe)

  // Sidebar ruft dies mit einem frischen Host bei jedem Neuaufbau auf.
  function renderInvertAxes(host) { invertHost = host; buildInvertAxes(); }

  // Baut je Achse eine „Richtung invertieren"-Checkbox in den gemerkten Host.
  function buildInvertAxes() {
    const host = invertHost || $('#mInvertAxes');
    if (!host) return;
    host.innerHTML = '';
    for (const k in invertChecks) delete invertChecks[k];
    getAxisLetters().forEach((letter, i) => {
      const lab = document.createElement('label');
      lab.className = 'ck';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.onchange = () => sendInvertMask();
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(' ' + letter + ' (' + T(TOWER[i]) + ')'));
      host.appendChild(lab);
      invertChecks[letter] = cb;
    });
    syncInvertChecks();
  }

  // ---------- Homing-Einstellungen ($22..$27) ---------------------------
  // Fokussiertes Menü für die Referenzfahrt: jede Zeile setzt genau EIN GRBL-
  // Setting; Änderungen werden sofort an die Steuerung gesendet und dort im
  // EEPROM gespeichert. type: 'bool' -> Checkbox (0/1), sonst Zahlenfeld.
  const HOMING = [
    { n: '22', type: 'bool', label: 'Homing aktivieren',
      desc: 'Schaltet die Referenzfahrt ($H) frei. Ist sie aus, meldet die Steuerung „error:5". Erfordert eingebaute Endschalter an jeder Achse.' },
    { n: '23', type: 'mask', label: 'Suchweg-Richtung invertieren',
      desc: 'Häkchen je Achse: kehrt die Richtung um, in die diese Achse beim Homing zum Endschalter sucht. Fährt eine Achse in die FALSCHE Richtung (vom Schalter weg), ihr Häkchen setzen.' },
    { n: '25', type: 'num', label: 'Suchlauf / Seek, mm/min',
      desc: 'Schnelle erste Anfahrt, mit der die Achse den Endschalter sucht. Höher = schnelleres Homing, aber härteres Auffahren auf den Schalter.' },
    { n: '24', type: 'num', label: 'Feinfahrt / Feed, mm/min',
      desc: 'Langsame zweite Anfahrt nach dem Zurückziehen. Bestimmt die Wiederhol-Genauigkeit des Maschinennullpunkts — eher niedrig wählen.' },
    { n: '26', type: 'int', label: 'Entprellung, ms',
      desc: 'Wartezeit zum Entprellen des Schalters nach dem Auslösen (mechanisches Prellen). Übliche Werte 5–25 ms.' },
    { n: '27', type: 'num', label: 'Pull-off / Rückzug, mm',
      desc: 'Rückzugweg nach dem Auslösen, damit der Schalter wieder öffnet. Groß genug wählen, dass der Schalter sicher freigibt — sonst lösen aktive Hard-Limits sofort erneut aus.' },
    { n: '44', type: 'mask', label: 'Homing-Zyklus 1 · Achsen',
      desc: 'grblHAL: Häkchen je Achse, die ZUERST (gemeinsam) referenziert wird. Die Zyklen 1–4 werden nacheinander abgefahren. Ohne Häkchen = Zyklus nicht genutzt.' },
    { n: '45', type: 'mask', label: 'Homing-Zyklus 2 · Achsen',
      desc: 'Häkchen je Achse, die als ZWEITES referenziert wird (nach Zyklus 1). Ohne Häkchen = nicht genutzt.' },
    { n: '46', type: 'mask', label: 'Homing-Zyklus 3 · Achsen',
      desc: 'Häkchen je Achse, die als DRITTES referenziert wird. Ohne Häkchen = nicht genutzt.' },
    { n: '47', type: 'mask', label: 'Homing-Zyklus 4 · Achsen',
      desc: 'Häkchen je Achse, die als VIERTES referenziert wird. Ohne Häkchen = nicht genutzt.' }
  ];
  const homingRows = {};        // Setting-Nr. -> { s, inp }

  // Option: nach erfolgreicher Referenzfahrt den Werk-Nullpunkt (G54) auf die
  // Referenzposition setzen. Hintergrund: $H setzt nur die MASCHINENposition
  // (und die Achse steht danach um den Pull-off $27 vom Schalter entfernt);
  // ein früher per „Nullpunkt setzen" gespeicherter Werk-Offset bleibt bestehen.
  // Die Anzeige zeigt aber die WERKposition (MPos − WCO) -> ohne diese Option
  // steht sie nach dem Homing nicht auf 0. Standard: an.
  const LS_HOME_ZERO = 'hotwire-homeSetZero';
  function homeSetZero() {
    try { const v = localStorage.getItem(LS_HOME_ZERO); return v == null ? true : v === '1'; } catch (e) { return true; }
  }
  function setHomeSetZero(on) { try { localStorage.setItem(LS_HOME_ZERO, on ? '1' : '0'); } catch (e) {} }

  // Zuletzt vom Board bekannter Wert eines Settings (aus dem $$-Cache setMap).
  function cachedSetting(num) { return setMap[num] ? setMap[num].orig : null; }

  // Baut die Homing-Felder in einen beliebigen Host (Sidebar-Gruppe). Wird bei
  // jedem Sidebar-Neuaufbau erneut aufgerufen -> Felder aus dem $$-Cache füllen.
  let homingHost = null;        // zuletzt gebauter Homing-Host (für Neuaufbau bei Achsänderung)
  function renderHoming(host) {
    if (!host) return;
    homingHost = host;
    host.innerHTML = '';
    for (const k in homingRows) delete homingRows[k];
    HOMING.forEach(s => {
      const row = document.createElement('div'); row.className = 'hset-row' + (s.type === 'mask' ? ' hset-mask' : '');
      const lab = document.createElement('label'); lab.textContent = '$' + s.n + ' · ' + T(s.label);
      const desc = document.createElement('div'); desc.className = 'hint'; desc.textContent = T(s.desc);
      if (s.type === 'mask') {
        // Achsweise Häkchen: je gesetztes Häkchen = Bit in der Maske.
        const box = document.createElement('div'); box.className = 'hset-axes';
        const checks = [];
        getAxisLetters().forEach((letter, i) => {
          const l = document.createElement('label'); l.className = 'ck';
          const cb = document.createElement('input'); cb.type = 'checkbox';
          cb.onchange = () => sendHoming(s);
          l.appendChild(cb);
          l.appendChild(document.createTextNode(' ' + letter + ' (' + T(TOWER[i]) + ')'));
          box.appendChild(l);
          checks.push({ letter, bit: bitOf(letter, i), cb });
        });
        row.append(lab, box, desc);
        host.appendChild(row);
        homingRows[s.n] = { s, checks };
      } else {
        const inp = document.createElement('input');
        if (s.type === 'bool') { inp.type = 'checkbox'; }
        else { inp.type = 'text'; inp.inputMode = 'decimal'; }
        inp.onchange = () => sendHoming(s);
        const cell = (s.type !== 'bool' && window.wrapWithSpinner) ? window.wrapWithSpinner(inp, { step: s.step || 1 }) : inp;
        row.append(lab, cell, desc);
        host.appendChild(row);
        homingRows[s.n] = { s, inp };
      }
      const cv = cachedSetting(s.n);
      if (cv != null) updateHomingField(s.n, cv);
    });
    // App-Option (nicht auf dem Board): Nullpunkt nach Referenzfahrt.
    {
      const row = document.createElement('div'); row.className = 'hset-row';
      const l = document.createElement('label'); l.className = 'ck';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = homeSetZero();
      cb.onchange = () => setHomeSetZero(cb.checked);
      l.appendChild(cb);
      l.appendChild(document.createTextNode(' ' + T('Nach Referenzfahrt Nullpunkt setzen (alle Achsen = 0)')));
      const desc = document.createElement('div'); desc.className = 'hint';
      desc.textContent = T('Setzt nach erfolgreicher Referenzfahrt den Werk-Nullpunkt auf die erreichte Position (G10 L20). Ohne Häkchen bleibt ein zuvor gesetzter Nullpunkt erhalten; die Anzeige zeigt dann den Abstand dazu, nicht 0.');
      row.append(l, desc);
      host.appendChild(row);
    }
    // Aktionszeile: aktuelle Werte vom Board laden.
    const bar = document.createElement('div'); bar.className = 'mrow'; bar.style.marginTop = '4px';
    const load = document.createElement('button'); load.textContent = T('Aktuelle Werte vom Board laden');
    load.onclick = async () => {
      if (!grbl.connected) { alert(T('Erst mit der Maschine verbinden.')); return; }
      try { await grbl.send('$$'); } catch (e) {}
    };
    bar.appendChild(load);
    host.appendChild(bar);
  }

  // Ein Homing-Setting an die Steuerung senden. Bei Maske aus den Häkchen
  // gebildet, sonst aus dem Eingabefeld.
  async function sendHoming(s) {
    const e = homingRows[s.n];
    if (!e) return;
    if (!grbl.connected) { alert(T('Erst mit der Maschine verbinden.')); if (e.s.type === 'mask') syncHomingMask(s.n); return; }
    let val;
    if (s.type === 'mask') {
      let mask = 0;
      e.checks.forEach(c => { if (c.cb.checked) mask |= (1 << c.bit); });
      val = String(mask);
    } else if (s.type === 'bool') {
      val = e.inp.checked ? '1' : '0';
    } else {
      val = e.inp.value.trim().replace(',', '.');
      if (val === '') return;
    }
    const r = await grbl.send(`$${s.n}=${val}`);
    if (r.startsWith('error')) { log(T('Konnte $') + s.n + T(' nicht setzen: ') + r, 'err'); if (e.s.type === 'mask') syncHomingMask(s.n); }
    else log(T('Homing-Einstellung gesendet: ') + `$${s.n}=${val}`, 'sys');
  }

  // Maske-Häkchen an den zuletzt bekannten Board-Wert angleichen (nach Fehler/Ablehnung).
  function syncHomingMask(num) {
    const cv = cachedSetting(num);
    if (cv != null) updateHomingField(num, cv);
  }

  // Feld aus einer eingelesenen $$-Zeile aktualisieren.
  function updateHomingField(num, val) {
    const e = homingRows[num];
    if (!e) return;
    if (e.s.type === 'mask') {
      const mask = parseInt(val, 10) || 0;
      e.checks.forEach(c => { c.cb.checked = !!(mask & (1 << c.bit)); });
    } else if (e.s.type === 'bool') {
      e.inp.checked = (parseInt(val, 10) || 0) !== 0;
    } else {
      e.inp.value = val;
    }
  }

  // ---------- Generischer Sidebar-Editor für GRBL-Settings --------------
  // Baut in einen beliebigen Host eine kompakte Liste von $$-Einstellungen im
  // gleichen Zeilenlayout wie das Homing-Menü. Jede Zeile setzt genau EIN
  // Setting; Änderungen werden sofort an die Steuerung geschickt und dort
  // dauerhaft gespeichert. Werte aus dem $$-Cache füllen die Felder beim
  // (Neu-)Aufbau der Sidebar automatisch.
  //   list: [{ n, type: 'num'|'int'|'bool'|'mask', label, desc, step? }]
  // Für Achs-Settings ($100.. u. a.) baut axisSettings(base, label, desc) eine
  // Liste mit einem Eintrag je aktiver Achse.
  const settingRows = new Map();   // num -> Array< { s, inp | checks, host } >

  function registerSettingRow(num, entry) {
    if (!settingRows.has(num)) settingRows.set(num, []);
    settingRows.get(num).push(entry);
  }
  // Einträge freigeben, deren DOM nicht mehr im Dokument hängt (Sidebar-Rebuild).
  function pruneSettingRows(num) {
    const arr = settingRows.get(num); if (!arr) return;
    const live = arr.filter(e => e.host && document.contains(e.host));
    if (live.length) settingRows.set(num, live); else settingRows.delete(num);
  }
  function updateSettingRow(entry, val) {
    const s = entry.s;
    if (s.type === 'mask') {
      const mask = parseInt(val, 10) || 0;
      entry.checks.forEach(c => { c.cb.checked = !!(mask & (1 << c.bit)); });
    } else if (s.type === 'bool') {
      entry.inp.checked = (parseInt(val, 10) || 0) !== 0;
    } else {
      entry.inp.value = val;
    }
  }
  function syncSettingRow(entry) {
    const cv = cachedSetting(entry.s.n);
    if (cv != null) updateSettingRow(entry, cv);
  }
  async function sendSetting(entry) {
    const s = entry.s;
    if (!grbl.connected) { alert(T('Erst mit der Maschine verbinden.')); syncSettingRow(entry); return; }
    let val;
    if (s.type === 'mask') {
      let mask = 0;
      entry.checks.forEach(c => { if (c.cb.checked) mask |= (1 << c.bit); });
      val = String(mask);
    } else if (s.type === 'bool') {
      val = entry.inp.checked ? '1' : '0';
    } else {
      val = entry.inp.value.trim().replace(',', '.');
      if (val === '') return;
    }
    const r = await grbl.send(`$${s.n}=${val}`);
    if (r.startsWith('error')) { log(T('Konnte $') + s.n + T(' nicht setzen: ') + r, 'err'); syncSettingRow(entry); }
    else log(T('Einstellung gesendet: ') + `$${s.n}=${val}`, 'sys');
  }

  function renderSettings(host, list) {
    if (!host) return;
    host.innerHTML = '';
    list.forEach(s => {
      pruneSettingRows(s.n);
      const row = document.createElement('div');
      row.className = 'hset-row' + (s.type === 'mask' ? ' hset-mask' : '');
      const lab = document.createElement('label'); lab.textContent = '$' + s.n + ' · ' + T(s.label);
      const desc = document.createElement('div'); desc.className = 'hint'; desc.textContent = T(s.desc || '');
      let entry;
      if (s.type === 'mask') {
        const box = document.createElement('div'); box.className = 'hset-axes';
        const checks = [];
        getAxisLetters().forEach((letter, i) => {
          const l = document.createElement('label'); l.className = 'ck';
          const cb = document.createElement('input'); cb.type = 'checkbox';
          l.appendChild(cb);
          l.appendChild(document.createTextNode(' ' + letter + ' (' + T(TOWER[i]) + ')'));
          box.appendChild(l);
          checks.push({ letter, bit: bitOf(letter, i), cb });
        });
        row.append(lab, box, desc); host.appendChild(row);
        entry = { s, checks, host: row };
        checks.forEach(c => c.cb.onchange = () => sendSetting(entry));
      } else {
        const inp = document.createElement('input');
        if (s.type === 'bool') inp.type = 'checkbox';
        else { inp.type = 'text'; inp.inputMode = 'decimal'; }
        const cell = (s.type !== 'bool' && window.wrapWithSpinner) ? window.wrapWithSpinner(inp, { step: s.step || 1 }) : inp;
        row.append(lab, cell, desc); host.appendChild(row);
        entry = { s, inp, host: row };
        inp.onchange = () => sendSetting(entry);
      }
      registerSettingRow(s.n, entry);
      syncSettingRow(entry);
    });
    const bar = document.createElement('div'); bar.className = 'mrow'; bar.style.marginTop = '4px';
    const load = document.createElement('button'); load.textContent = T('Aktuelle Werte vom Board laden');
    load.onclick = async () => {
      if (!grbl.connected) { alert(T('Erst mit der Maschine verbinden.')); return; }
      try { await grbl.send('$$'); } catch (e) {}
    };
    bar.appendChild(load); host.appendChild(bar);
  }

  // Achsbezogene Setting-Liste ($base + Slot 0..3) für alle vier Türme.
  function axisSettings(base, label, desc, opts) {
    return getAxisLetters().map((letter, i) => ({
      n: String(base + i),
      type: (opts && opts.type) || 'num',
      step: opts && opts.step,
      label: label + ' · ' + letter + ' (' + T(TOWER[i]) + ')',
      desc
    }));
  }

  // Vordefinierte Gruppen. Achsen-Gruppen werden zur Laufzeit gebaut (axisSettings),
  // da sich Achsbuchstaben in der App-Konfiguration ändern können.
  const SETTINGS_GROUPS = {
    stepper: [
      { n: '0',  type: 'num',  label: 'Schrittimpulsdauer, µs',
        desc: 'Länge des Schrittimpulses am Treiber. Zu kurz = Schritte gehen verloren; zu lang = weniger Reserve für hohe Drehzahlen. Übliche Werte 3–10 µs (grblHAL Standard 10).' },
      { n: '1',  type: 'int',  label: 'Schritt-Idle-Verzögerung, ms',
        desc: 'Wartezeit nach der letzten Bewegung, bevor die Motoren abgeschaltet werden. 255 = niemals abschalten (halten mit voller Kraft, empfohlen bei Schwerkraft-Achsen).' },
      { n: '2',  type: 'mask', label: 'Schrittport invertieren · Achsen',
        desc: 'Häkchen je Achse: kehrt die Impulspolarität am Step-Pin um. Nur nötig, wenn der Treiber auf fallende Flanke reagiert.' },
      { n: '4',  type: 'bool', label: 'Step-Enable invertieren',
        desc: 'Kehrt die Polarität des Freigabesignals (Enable) für alle Treiber um. Bei „aktiv high"-Treibern setzen.' }
    ],
    limits: [
      { n: '5',  type: 'mask', label: 'Limit-Pins invertieren · Achsen',
        desc: 'Häkchen je Achse: kehrt die Polarität des Endschalter-Eingangs um (Öffner statt Schließer).' },
      { n: '6',  type: 'bool', label: 'Probe-Pin invertieren',
        desc: 'Kehrt die Polarität des Probe-Eingangs um.' },
      { n: '20', type: 'bool', label: 'Soft-Limits aktiv',
        desc: 'Verweigert Bewegungsbefehle jenseits des in $130.. hinterlegten Max. Verfahrwegs. Setzt vorheriges Homing voraus.' },
      { n: '21', type: 'bool', label: 'Hard-Limits aktiv',
        desc: 'Löst bei jedem Auslösen eines Endschalters SOFORT einen Alarm aus (harter Stopp). Erfordert saubere Verkabelung — Störungen führen sonst zu Fehlalarmen.' }
    ],
    report: [
      { n: '10', type: 'int',  label: 'Statusreport-Maske',
        desc: 'Bitmaske, welche Felder im ?-Statusreport erscheinen (Position, Puffer, Pins …). Standard für grblHAL: 511 (alles).' },
      { n: '11', type: 'num',  label: 'Junction-Deviation, mm', step: 0.001,
        desc: 'Zulässige Bahnabweichung an Ecken für die Zentripetal-Beschleunigung. Kleiner = sanfter/langsamer, größer = schneller/kantiger. Üblich 0,01 mm.' },
      { n: '12', type: 'num',  label: 'Arc-Toleranz, mm', step: 0.001,
        desc: 'Segmentlänge bei der Kreisapproximation. Kleiner = feinere Bögen, mehr Rechenlast.' },
      { n: '13', type: 'bool', label: 'Report in Zoll',
        desc: 'Positionen im Statusreport in Zoll ausgeben (statt mm). Für den Heißdraht-Workflow ausgeschaltet lassen.' }
    ],
    wire: [
      { n: '30', type: 'num',  label: 'Max. Drahtleistung (S max)',
        desc: 'S-Wert bei 100 % Drahtheizung. Die Handsteuerung skaliert die Prozentangabe auf diesen Wert (M3 S…). Auf denselben Wert wie im Firmware-Profil setzen.' },
      { n: '31', type: 'num',  label: 'Min. Drahtleistung (S min)',
        desc: 'Untere Grenze für den S-Wert (0 = keine).' },
      { n: '32', type: 'bool', label: 'Lasermodus aktiv',
        desc: 'Beim Heißdraht AUS lassen. „Ein" schaltet die Spindel bei Bewegungspausen ab und ändert die S-Wert-Interpolation — nur für Laser sinnvoll.' }
    ]
  };

  // Achsbezogene Gruppen zur Laufzeit bauen.
  function settingsGroup(id) {
    if (SETTINGS_GROUPS[id]) return SETTINGS_GROUPS[id];
    switch (id) {
      case 'stepsPerMm':   return axisSettings(100, T('Schritte/mm'),          'Anzahl Motorimpulse je Millimeter Verfahrweg. Kalibrierwert des Antriebs — nach Umbau (Zahnriemen/Übersetzung/Microsteps) neu vermessen.');
      case 'maxRate':      return axisSettings(110, T('Max. Rate, mm/min'),    'Größtmögliche Fahrgeschwindigkeit dieser Achse. Gilt für Eilgang (G0) und begrenzt auch den Schnitt-Vorschub (F).');
      case 'accel':        return axisSettings(120, T('Beschleunigung, mm/s²'), 'Wie schnell die Achse auf ihre Zielgeschwindigkeit beschleunigt. Zu hoch = Schrittverlust; zu niedrig = weiche, langsame Fahrten.');
      case 'maxTravel':    return axisSettings(130, T('Max. Verfahrweg, mm'),   'Nutzbarer Fahrweg zwischen Endschaltern. Wird für Soft-Limits ($20) und die Homing-Zyklen verwendet.');
      case 'motorCurrent': return axisSettings(140, T('Motorstrom, mA (TMC)'),  'Nur bei Trinamic-Treibern (TMC): Motorstrom je Achse in Milliampere. Zu hoch = Motoren werden heiß, Schrittverlust bei Übertemperatur; zu niedrig = Drehmomentmangel.');
      case 'microsteps':   return axisSettings(150, T('Microsteps (TMC)'),      'Nur bei Trinamic-Treibern (TMC): Microstep-Auflösung. Änderung erfordert Neu-Kalibrierung von $100.. (Schritte/mm).');
    }
    return [];
  }
  const settingHosts = new Map();   // Host -> Gruppen-id (für Neuaufbau bei Achsänderung)
  function renderSettingsGroup(host, id) {
    if (host) settingHosts.set(host, id);
    renderSettings(host, settingsGroup(id));
  }

  // Achsbuchstaben geändert: alle Menüs mit Achs-Häkchen/-Zeilen (Homing $23/$44…,
  // $2/$5-Masken, $100…-Gruppen) neu beschriften. Die Bits hängen am Buchstaben
  // (bitOf) — ohne Neuaufbau würden Häkchen auf die falsche Achse schreiben.
  function rerenderAxisMenus() {
    if (homingHost && document.contains(homingHost)) renderHoming(homingHost);
    settingHosts.forEach((id, host) => {
      if (document.contains(host)) renderSettings(host, settingsGroup(id));
      else settingHosts.delete(host);
    });
  }

  // Aktuellen Stand der Checkboxen als $3-Maske an die Steuerung senden.
  async function sendInvertMask() {
    if (!grbl.connected) { alert(T('Erst mit der Maschine verbinden.')); syncInvertChecks(); return; }
    let mask = 0, i = 0;
    for (const [letter, cb] of Object.entries(invertChecks)) {
      if (cb.checked) mask |= (1 << bitOf(letter, i));
      i++;
    }
    const r = await grbl.send(`$3=${mask}`);
    if (r.startsWith('error')) { log(T('Konnte $3 nicht setzen: ') + r, 'err'); syncInvertChecks(); return; }
    invertMask = mask;
    log(T('Richtungs-Invert-Maske gesetzt: $3=') + mask, 'sys');
  }

  /* Prüft das geladene Programm gegen die Fahrweg-Grenzen (ab Maschinennullpunkt).
     Horizontalachsen = Slot 0/2 (X/U), Vertikalachsen = Slot 1/3 (Y/V).
     Negative Koordinaten sind IMMER unzulässig (Portal darf nicht unter den
     Maschinennullpunkt), die Obergrenze nur bei gesetztem Limit (>0).
     Rückgabe: erste Verletzung {line, axis, val, limit, kind} oder null. */
  function checkLimits() {
    const lim = getLimits() || {};
    const wNeg = lim.warnNeg !== false, wTr = lim.warnTravel !== false, wF = lim.warnFeed !== false;
    const H = wTr ? (+lim.h || 0) : 0, V = wTr ? (+lim.v || 0) : 0, Fmax = wF ? (+lim.f || 0) : 0;
    if (!wNeg && !H && !V && !Fmax) return null;   // alle Warnungen aus
    const [xL, yL, uL, vL] = getAxisLetters();
    const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rex = l => new RegExp('(?:^|\\s)' + esc(l) + '(-?\\d*\\.?\\d+)', 'i');
    const axes = [[rex(xL), H, xL], [rex(uL), H, uL], [rex(yL), V, yL], [rex(vL), V, vL]];
    const rF = /(?:^|\s)F(\d*\.?\d+)/i;
    // G93 (Inverse Time): F ist dort der Kehrwert der Blockdauer, KEINE
    // Geschwindigkeit — ein Vergleich mit dem Max.-Vorschub waere sinnlos.
    // Die Deckelung auf maxFeed ist bereits bei der Erzeugung passiert.
    let invTime = false;
    for (let i = 0; i < gcodeLines.length; i++) {
      const code = gcodeLines[i].split(';')[0];
      if (/\bG93\b/.test(code)) invTime = true;
      if (/\bG94\b/.test(code)) invTime = false;
      for (const [re, limit, name] of axes) {
        const m = re.exec(code); if (!m) continue;
        const val = parseFloat(m[1]);
        if (wNeg && val < -0.001) return { line: i + 1, axis: name, val, limit, kind: 'neg' };
        if (limit > 0 && val > limit + 0.001) return { line: i + 1, axis: name, val, limit, kind: 'max' };
      }
      if (Fmax > 0 && !invTime) {
        const mf = rF.exec(code);
        if (mf) { const fv = parseFloat(mf[1]); if (fv > Fmax + 0.001) return { line: i + 1, axis: 'F', val: fv, limit: Fmax, kind: 'feed' }; }
      }
    }
    return null;
  }

  function log(txt, cls) { grbl.onConsole(txt, cls || ''); }

  // Baut DRO + Jog-Bedienung in EIN Container-Paar. Gibt die DRO-Wertzellen
  // zurück, damit die Statusanzeige jede Instanz (Maschine + Schneiden) aktualisiert.
  function buildJogInstance(droEl, jogEl, stepSel, feedSel) {
    if (!droEl || !jogEl) return null;
    droEl.innerHTML = ''; jogEl.innerHTML = '';
    const vals = [], lamps = [];
    axes.forEach((ax, i) => {
      const cell = document.createElement('div');
      cell.className = 'axis';
      cell.innerHTML = `<div class="ax-name">${ax.letter}</div>` +
        `<div class="ax-tower">${T(ax.tower)}</div><div class="val">0.000</div>` +
        `<div class="ax-lim" title="${T('Endschalter')} ${ax.letter}">` +
        `<span class="lim-dot"></span><span class="lim-txt">${T('Limit')}</span></div>`;
      droEl.appendChild(cell);
      vals[i] = cell.querySelector('.val');
      lamps[i] = cell.querySelector('.ax-lim');

      const col = document.createElement('div');
      col.className = 'col';
      col.innerHTML = `<div class="name">${ax.letter}</div><div class="tw">${T(ax.tower)}</div>`;
      const plus = document.createElement('button'); plus.textContent = '+';
      const minus = document.createElement('button'); minus.textContent = '−';
      attachJog(plus, [ax.letter], +1, stepSel, feedSel);
      attachJog(minus, [ax.letter], -1, stepSel, feedSel);
      col.appendChild(plus); col.appendChild(minus);
      jogEl.appendChild(col);
    });
    // Parallel-Handfahrt: beide horizontalen (Slot 0/2) bzw. beide vertikalen
    // (Slot 1/3) Achsen gleichzeitig verfahren — hält das Werkstück parallel.
    if (axes.length >= 4) {
      const pairCol = (label, letters) => {
        const col = document.createElement('div');
        col.className = 'col col-par';
        col.innerHTML = `<div class="name">${label}</div><div class="tw">${letters.join(' + ')}</div>`;
        const plus = document.createElement('button'); plus.textContent = '+';
        const minus = document.createElement('button'); minus.textContent = '−';
        attachJog(plus, letters, +1, stepSel, feedSel);
        attachJog(minus, letters, -1, stepSel, feedSel);
        col.appendChild(plus); col.appendChild(minus);
        jogEl.appendChild(col);
      };
      pairCol(T('⇔ Horizontal'), [axes[0].letter, axes[2].letter]);
      pairCol(T('⇕ Vertikal'), [axes[1].letter, axes[3].letter]);
    }
    return { vals, lamps };
  }

  function buildAxes() {
    const letters = getAxisLetters();
    axes = letters.map((l, i) => ({ letter: l, tower: TOWER[i] }));
    posGroups = []; limGroups = [];
    const main = buildJogInstance($('#dro'), $('#jogAxes'), '#mStep', '#mJogFeed');
    if (main) { posGroups.push(main.vals); limGroups.push(main.lamps); }
    // Zweite Instanz im Reiter „Schneiden" (unter dem Simulator), falls vorhanden.
    const cut = buildJogInstance($('#droCut'), $('#jogAxesCut'), '#mStepCut', '#mJogFeedCut');
    if (cut) { posGroups.push(cut.vals); limGroups.push(cut.lamps); }
    buildInvertAxes();
    rerenderAxisMenus();
  }

  // Schwelle in ms: kürzer gedrückt = ein Schritt, länger = Dauerfahrt.
  const JOG_HOLD_MS = 250;
  // Länge eines Häppchens der Dauerfahrt in Sekunden. Kleine Strecken pro Jog
  // vermeiden „error:15" (Ziel außerhalb Verfahrbereich) bei aktiven Soft-Limits
  // und halten den Planner-Puffer gefüllt, ohne ihn zu überlaufen.
  const JOG_CHUNK_S = 0.15;
  const JOG_MIN_CHUNK = 0.5;   // mm — Untergrenze, damit auch langsame Feeds fahren

  // Nach „Abbruch", „Stopp" oder Not-Halt steht die Steuerung in Hold (Feed-Hold)
  // bzw. Alarm (Soft-Reset). In BEIDEN Zuständen weist GRBL/grblHAL jeden Jog ab
  // ($J -> error / ignoriert) — die Maschine wirkt „tot", obwohl sie verbunden ist.
  // Vor jeder Handfahrt den Zustand deshalb selbst auflösen. Aus Hold wird NICHT
  // mit '~' fortgesetzt (das würde den abgebrochenen Schnitt weiterfahren!),
  // sondern per Soft-Reset der Puffer verworfen und anschließend mit $X entsperrt.
  let unblocking = null;
  function releaseBlock() {
    if (unblocking) return unblocking;            // parallele Jogs teilen sich einen Lauf
    const st = grbl.lastState || '';
    if (!/Alarm|Hold|Door/i.test(st)) return Promise.resolve(true);
    unblocking = (async () => {
      try {
        grbl.streaming = false; grbl.paused = false;
        await grbl.rt(0x18);                      // Soft-Reset: Puffer/Restbewegung verwerfen
        grbl.flushPending('reset');
        await new Promise(r => setTimeout(r, 400));
        const r = await grbl.send('$X', false);
        if (typeof r === 'string' && r.startsWith('error')) {
          log(T('Handfahrt blockiert — Alarm lässt sich nicht quittieren: ') + r, 'err');
          return false;
        }
        log(T('Steuerung nach Stopp/Abbruch entsperrt (Soft-Reset + $X) — Handfahrt wieder möglich.'), 'sys');
        const pins = (grbl.lastPins || '').replace(/[PDRH]/g, '');
        if (pins)
          log(T('Endschalter noch gedrückt (') + pins + T('). Erst vom Schalter wegfahren.'), 'err');
        return true;
      } finally { unblocking = null; }
    })();
    return unblocking;
  }

  // GRBL bezieht F auf den Weg ALLER Achsen zusammen. Bei einer Sammelfahrt
  // (z. B. "Horizontal" = X+Z, beide Portale gleich weit) ist dieser Weg um
  // Wurzel n laenger als der Weg je Achse — ohne Korrektur faehrt die Maschine
  // nur 1/Wurzel n des eingestellten Vorschubs (bei zwei Achsen 71 %).
  function vecFeed(feed, letters) {
    const n = (letters || []).length;
    return n > 1 ? feed * Math.sqrt(n) : feed;
  }

  // Einen Schritt in einer oder mehreren Achsen verfahren.
  async function jogStep(letters, sign, stepSel, feedSel) {
    const raw = parseFloat($(stepSel).value);
    if (!isFinite(raw) || raw === 0) return;      // leere/ungültige freie Eingabe -> nicht fahren
    if (!(await releaseBlock())) return;          // Hold/Alarm zuerst auflösen
    const step = raw * sign;
    const feed = parseFloat($(feedSel).value) || 500;
    const parts = letters.map(l => `${l}${step.toFixed(3)}`).join(' ');
    const resp = await grbl.send(`$J=G91 G21 ${parts} F${vecFeed(feed, letters)}`);
    if (typeof resp === 'string' && resp.startsWith('error'))
      log(T('Handfahrt abgelehnt: ') + resp, 'err');
  }

  // Dauerfahrt: viele kleine Jogs nachschieben, solange gehalten wird. Das
  // await auf send() (ok erst bei freiem Puffer) drosselt die Rate von selbst.
  async function jogLoop(state, letters, sign, feedSel) {
    if (!(await releaseBlock())) { state.active = false; return; }
    while (state.active && grbl.connected) {
      const feed = parseFloat($(feedSel).value) || 500;
      const dist = Math.max(feed / 60 * JOG_CHUNK_S, JOG_MIN_CHUNK) * sign;
      const parts = letters.map(l => `${l}${dist.toFixed(3)}`).join(' ');
      const resp = await grbl.send(`$J=G91 G21 ${parts} F${vecFeed(feed, letters)}`, false);
      if (typeof resp === 'string' && resp.startsWith('error')) {
        state.active = false; log(T('Handfahrt abgelehnt: ') + resp, 'err'); break;
      }
    }
  }

  // Knopf mit Handfahrt belegen: kurzes Tippen = ein Schritt, Halten = Dauer-
  // fahrt, die beim Loslassen (oder Verlassen des Knopfes) sanft stoppt.
  function attachJog(btn, letters, sign, stepSel, feedSel) {
    let holdTimer = null;
    const state = { active: false };
    const start = (e) => {
      e.preventDefault();
      // Ein Abbruch hier muss auch das folgende pointerup entwerten: sonst
      // loest stop() mangels laufender Dauerfahrt einen Einzelschritt aus.
      if (!grbl.connected) { state.blocked = true; alert(T('Erst mit der Maschine verbinden.')); return; }
      // Sicherheitshinweis vor der ersten Handfahrt (safety.js).
      if (window.App && App.safetyOk && !App.safetyOk()) { state.blocked = true; return; }
      state.blocked = false;
      state.active = false;
      holdTimer = setTimeout(() => {
        state.active = true;
        jogLoop(state, letters, sign, feedSel);
      }, JOG_HOLD_MS);
    };
    const stop = () => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      if (state.blocked) { state.blocked = false; return; }
      if (state.active) { state.active = false; grbl.jogCancel(); }
      else { jogStep(letters, sign, stepSel, feedSel); }
    };
    const cancel = () => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      state.blocked = false;
      if (state.active) { state.active = false; grbl.jogCancel(); }
    };
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointerleave', cancel);
    btn.addEventListener('pointercancel', cancel);
  }

  // Kennzeichnung unten mittig im 3D-Monitor: welches Programm (Tragfläche · Segment · Seite) liegt an.
  function setMonContext(text) {
    const el = $('#simMCtx'); if (el) el.textContent = text || '';
  }
  function setProgram(lines, info) {
    gcodeLines = lines;
    $('#mFileInfo').textContent = info;
    renderProgView(lines);
    $('#mStart').disabled = !lines.length;
    $('#mProg').max = Math.max(1, lines.length); $('#mProg').value = 0;
    $('#mProgText').textContent = `0 / ${lines.length}`;
    // Vorschau-Simulation aktivierbar, sobald ein Programm im Monitor liegt.
    const canSim = !!lines.length && window.Sim3D && Sim3D.monitorReady && Sim3D.monitorReady();
    setMonPlaying(false);
    const pb = $('#simMPlay'), rb = $('#simMReset');
    if (pb) pb.disabled = !canSim;
    if (rb) rb.disabled = !canSim;
  }

  // Kam das aktuell geladene Programm aus einer G-Code-Quelle (Tragfläche/Block/…)
  // oder aus einer geladenen Datei? Nur Quell-Programme werden beim Flächenwechsel
  // automatisch neu erzeugt — eine geladene Datei bleibt unangetastet.
  let progFromSource = false;

  // Programm aus der aktuell im Reiter „Schneiden" gewählten Quelle erzeugen und in
  // Monitor + Streaming-Puffer laden. Gemeinsame Basis für den Knopf „Quelle
  // übernehmen" und den automatischen Nachlauf beim Flächenwechsel (refreshProgram).
  // alertIfEmpty=true → Hinweis, wenn die Quelle (noch) keinen G-Code liefert.
  // Rückgabe: das Programm-Objekt bei Erfolg, sonst null.
  function applyProgramFromSource(alertIfEmpty) {
    const prog = getProgram();
    if (!prog || !prog.text || !prog.text.trim()) {
      if (alertIfEmpty) alert(T('Noch kein G-Code für die gewählte Quelle vorhanden.'));
      return null;
    }
    const lines = prog.text.split(/\r?\n/);
    // 3D-Monitor auf das gewählte Programm + passende Szene setzen.
    if (window.Sim3D && Sim3D.loadMonitor) Sim3D.loadMonitor(prog.text, prog.scene);
    setProgram(lines, prog.label + T(' — ') + lines.length + T(' Zeilen'));
    setMonContext(prog.label);
    progFromSource = true;
    return prog;
  }

  // Nach einem Tragflächen-Wechsel: ein bereits aus einer Quelle übernommenes
  // Programm samt 3D-Monitor NEU aus der jetzt aktiven Fläche erzeugen. Sonst zeigt
  // der Simulator die neue Fläche, gestreamt würde aber weiter die alte, weil
  // gcodeLines nur bei „Quelle übernehmen" gesetzt wird. Nichts tun während eines
  // laufenden Schnitts, ohne geladenes Programm oder bei geladener Datei.
  // why = 'axes': Anlass ist eine geänderte Achszuweisung (Reiter „Maschine") —
  // Achsbuchstaben/Nachkommastellen/Header/Footer stecken im erzeugten Programm.
  function refreshProgram(why) {
    if (grbl.streaming) return;                   // laufenden Schnitt niemals anfassen
    if (!gcodeLines.length || !progFromSource) return;   // nichts/Datei geladen → nichts nachzuladen
    const prog = applyProgramFromSource(false);
    if (prog) {
      log(T(why === 'axes' ? 'Achszuweisung geändert — Programm „' : 'Fläche gewechselt — Programm „')
        + prog.label + T('" neu übernommen (') + gcodeLines.length + T(' Zeilen).'), 'sys');
    } else if (why === 'axes') {
      setProgram([], T('Achszuweisung geändert — „Quelle übernehmen" erneut drücken.'));
      setMonContext('');
    } else {
      // Quelle liefert für die neue Fläche nichts → altes Programm verwerfen und
      // Start sperren, damit nicht versehentlich die vorige Fläche geschnitten wird.
      setProgram([], T('Fläche gewechselt — „Quelle übernehmen" erneut drücken.'));
      setMonContext('');
      log(T('Fläche gewechselt — kein G-Code für die gewählte Quelle. „Quelle übernehmen" erneut drücken.'), 'sys');
    }
  }

  // Programm zeilenweise in #mProgView anzeigen (für Live-Markierung beim Schneiden).
  let curProgLn = null;
  function renderProgView(lines) {
    curProgLn = null;
    const pv = $('#mProgView'); if (!pv) return;
    // In der Demo hier genauso verdeckt wie im G-Code-Reiter — geschnitten wird
    // trotzdem das echte Programm (gcodeLines bleibt unangetastet).
    const A = window.App || {};
    const demo = !!(A.demoOn && A.demoOn());
    if (demo && A.demoMaskView) A.demoMaskView(pv, '#mProgView');
    const frag = document.createDocumentFragment();
    lines.forEach((ln, i) => {
      const d = document.createElement('div');
      d.className = 'gln';
      d.dataset.n = i + 1;
      const shown = demo && A.maskGcodeLine ? A.maskGcodeLine(ln) : ln;
      d.textContent = shown.length ? shown : ' ';
      frag.appendChild(d);
    });
    pv.replaceChildren(frag);
    pv.scrollTop = 0;
  }
  // Aktuelle Zeile (0-basiert) markieren und mittig mitscrollen; davorliegende
  // Zeilen als „erledigt" abdimmen. lineIdx < 0 hebt jede Markierung auf.
  function highlightProgLine(lineIdx) {
    const pv = $('#mProgView'); if (!pv || !pv.children.length) { curProgLn = null; return; }
    const ln = lineIdx >= 0 ? pv.children[lineIdx] : null;
    if (ln === curProgLn) return;
    if (curProgLn) curProgLn.classList.remove('cur');
    curProgLn = ln || null;
    for (let k = 0; k < pv.children.length; k++)
      pv.children[k].classList.toggle('done', k < lineIdx);
    if (ln) {
      ln.classList.add('cur');
      pv.scrollTop = Math.max(0, ln.offsetTop - pv.clientHeight / 2 + ln.offsetHeight / 2);
    }
  }

  function setMonPlaying(on) {
    monPlaying = !!on;
    const pb = $('#simMPlay');
    if (pb) pb.textContent = monPlaying ? T('⏸ Pause') : T('▶ Simulieren');
  }

  // ---------- Einstellungs-Fenster ($$-Editor) --------------------------
  function openSettings() {
    $('#grblSettings').classList.add('open');
    if (!Object.keys(setMap).length && grbl.connected) loadSettings();
    else if (!grbl.connected) $('#setStatus').textContent = T('Nicht verbunden — erst oben einen Port wählen.');
  }
  function closeSettings() { $('#grblSettings').classList.remove('open'); }

  // ---------- Firmware-Umschalter ---------------------------------------
  // Aktualisiert alle firmwareabhängigen Beschriftungen. Das Protokoll bleibt
  // gleich, deshalb wird hier nichts an der Verbindung selbst geändert.
  function applyFirmwareUi() {
    const p = fw();
    const lbl = $('#mConnLbl'); if (lbl) lbl.textContent = T('Verbindung · ') + p.name + T(' (Web Serial)');
    const setBtn = $('#mSettingsBtn'); if (setBtn) setBtn.textContent = p.name + T(' Einstellungen');
    const h2 = document.querySelector('#grblSettings .head h2'); if (h2) h2.textContent = T(p.settingsTitle);
  }

  function setFirmware(id, opts) {
    if (!FIRMWARES[id]) return;
    firmware = id;
    const p = fw();
    const sel = $('#mFirmware'); if (sel && sel.value !== id) sel.value = id;
    // Default-Baudrate nur setzen, solange nicht verbunden — laufende
    // Verbindungen nicht stören.
    const baud = $('#mBaud');
    if (baud && !grbl.connected) baud.value = String(p.baud);
    applyFirmwareUi();
    // Auswahl in den Einstellungen ablegen (persistent über Neustart).
    if (opts && opts.save && window.App && App.state && App.state.cfg && App.state.cfg.firmware !== id) {
      App.state.cfg.firmware = id;
      if (typeof App.saveSettings === 'function') App.saveSettings();
    }
    if (opts && opts.log) log(T('Steuerung: ') + p.name + '.' + (grbl.connected
      ? T(' Zum vollständigen Umstellen bitte trennen und neu verbinden.') : ''), 'sys');
  }

  function addOrUpdateRow(num, val) {
    $('#setEmpty').style.display = 'none';
    let e = setMap[num];
    if (!e) {
      const tr = document.createElement('tr');
      const tdN = document.createElement('td'); tdN.className = 'num'; tdN.textContent = '$' + num;
      const tdD = document.createElement('td');
      const dsc = descFor(num);
      tdD.textContent = dsc || '—';
      if (!dsc) tdD.style.color = 'var(--muted)';
      const tdV = document.createElement('td');
      const inp = document.createElement('input'); inp.type = 'text'; inp.inputMode = 'decimal';
      tdV.appendChild(window.wrapWithSpinner ? window.wrapWithSpinner(inp, { step: 1 }) : inp);
      tr.append(tdN, tdD, tdV);
      $('#setBody').appendChild(tr);
      e = setMap[num] = { tr, inp, orig: val };
      inp.addEventListener('input', () => tr.classList.toggle('dirty', inp.value !== e.orig));
    }
    e.orig = val; e.inp.value = val; e.tr.classList.remove('dirty');
    filterRows();
  }

  async function loadSettings() {
    if (!grbl.connected) { alert(T('Erst mit der Maschine verbinden.')); return; }
    $('#setBody').innerHTML = '';
    for (const k in setMap) delete setMap[k];
    $('#setStatus').textContent = T('Lade …');
    await grbl.send('$$');
    $('#setStatus').textContent = Object.keys(setMap).length + T(' Einstellungen geladen.');
  }

  function filterRows() {
    const q = $('#setSearch').value.toLowerCase();
    for (const [n, e] of Object.entries(setMap)) {
      const hay = ('$' + n + ' ' + descFor(n)).toLowerCase();
      e.tr.style.display = hay.includes(q) ? '' : 'none';
    }
  }

  // ---------- Init -------------------------------------------------------
  function init(opts) {
    getAxisLetters = opts.axisLetters || getAxisLetters;
    getProgram = opts.program || getProgram;
    getLimits = opts.limits || getLimits;

    const consoleEls = Array.from(document.querySelectorAll('.grblConsole'));
    grbl.onConsole = (txt, cls) => {
      consoleEls.forEach(consoleEl => {
        const div = document.createElement('div');
        if (cls) div.className = cls;
        div.textContent = txt;
        consoleEl.appendChild(div);
        while (consoleEl.childElementCount > 400) consoleEl.removeChild(consoleEl.firstChild);
        consoleEl.scrollTop = consoleEl.scrollHeight;
      });
    };

    grbl.onStatus = (st) => {
      grbl.lastState = st.state;       // für Homing-Erfolgskontrolle gemerkt
      grbl.lastPins  = st.pins || '';  // aktive Eingänge (Endschalter) gemerkt
      // Rohe Maschinenposition (MPos) für die Richtungsschätzung beim Freifahren.
      if (st.pos && st.pos.length)
        grbl.lastMPos = st.isMPos ? st.pos.slice() : st.pos.map((v, i) => v + ((grbl._wco || [])[i] || 0));
      updateFreeButtons();
      $('#mStateText').textContent = st.state;
      $('#mStateDot').className = 'dot ' + (
        /Idle|Home|Check/.test(st.state) ? 'idle' :
        /Run|Jog/.test(st.state) ? 'run' :
        /Alarm|Door/.test(st.state) ? 'alarm' : '');
      // Werk-Offset (WCO) merken — wird nur gelegentlich mitgesendet. Angezeigt
      // wird die Position RELATIV zum gesetzten Nullpunkt (Arbeitsposition):
      // meldet die Steuerung MPos, ziehen wir den Offset ab -> nach „Nullpunkt
      // setzen" steht die Anzeige auf 0.
      if (st.wco) grbl._wco = st.wco;
      let pos = st.pos;
      if (st.isMPos && grbl._wco) pos = st.pos.map((v, i) => v - (grbl._wco[i] || 0));
      // DRO: grblHAL meldet die Position in Steuerungs-Reihenfolge (X,Y,Z,A,…).
      // Slot i zeigt den Wert seines Achsbuchstabens (AXIS_BIT), nicht blind pos[i]
      // — sonst vertauschen sich Z/A, wenn die App-Reihenfolge davon abweicht.
      axes.forEach((ax, i) => {
        const v = pos[bitOf(ax.letter, i)];
        if (v == null || isNaN(v)) return;
        posGroups.forEach(g => { if (g[i]) g[i].textContent = v.toFixed(3); });
      });
      // Endschalter-Kontrolllampen: Pn-Feld enthält die Buchstaben der AKTIVEN
      // Pins. Slot i ist ausgelöst, wenn sein Achsbuchstabe darin vorkommt.
      // Fehlt Pn (kein Pin aktiv), sind alle Lampen grün.
      const pins = st.pins || '';
      limGroups.forEach(g => g.forEach((lamp, i) => {
        if (!lamp) return;
        const on = axes[i] && pins.indexOf(axes[i].letter) >= 0;
        lamp.classList.toggle('on', on);
      }));

      // Aktuelle Ist-Geschwindigkeit (Vorschub) während des Schneidens anzeigen.
      // NICHT den FS:-Wert von GRBL nehmen: der ist die 4D-Vektorrate über ALLE
      // Achsen (bei X=Y=U=V bis 2× so hoch wie die echte Turmgeschwindigkeit und
      // deshalb auch über $110..). Stattdessen aus den Positionsdeltas die
      // Bahngeschwindigkeit je Turm (H/V) berechnen und den schnelleren anzeigen.
      // Anzeige: Textzeile im Schneiden-Lauf (#mFeedText) UND die Geschwindigkeits-
      // zeile unter den Koordinatenblöcken (Reiter „Maschine" und „Schneiden", [data-feednow]).
      const fEl = $('#mFeedText');
      const fNow = Array.from(document.querySelectorAll('[data-feednow]'));
      const showFeed = v => {
        if (fEl) fEl.textContent = T('Geschwindigkeit: ') + Math.round(v) + ' mm/min';
        fNow.forEach(el => { el.textContent = String(Math.round(v)); });
      };
      if (fEl || fNow.length) {
        const now = performance.now();
        const tp = axes.map((ax, i) => pos[bitOf(ax.letter, i)]);
        const ok = tp.length >= 4 && tp.every(v => v != null && !isNaN(v));
        const prev = grbl._feedPrev;
        if (ok && prev && now - prev.t > 50) {
          const dt = (now - prev.t) / 60000;                       // min
          const vL = Math.hypot(tp[0] - prev.p[0], tp[1] - prev.p[1]) / dt;
          const vR = Math.hypot(tp[2] - prev.p[2], tp[3] - prev.p[3]) / dt;
          const v = Math.max(vL, vR);
          // leichte Glättung gegen Poll-Jitter
          grbl._feedSm = grbl._feedSm == null ? v : grbl._feedSm * 0.5 + v * 0.5;
          showFeed(grbl._feedSm);
        } else if (!ok && st.feed != null && !isNaN(st.feed)) {
          showFeed(st.feed);
        }
        if (ok) grbl._feedPrev = { t: now, p: tp };
      }
    };

    grbl.onSetting = (line) => {
      const m = line.match(/^\$(\d+)=(.*)$/);
      if (m) {
        addOrUpdateRow(m[1], m[2].trim());
        if (m[1] === '3') { invertMask = parseInt(m[2].trim(), 10) || 0; syncInvertChecks(); }
        updateHomingField(m[1], m[2].trim());
        // Alle offenen Sidebar-Editor-Zeilen für dieses Setting nachziehen.
        pruneSettingRows(m[1]);
        const arr = settingRows.get(m[1]);
        if (arr) arr.forEach(entry => updateSettingRow(entry, m[2].trim()));
      }
    };

    // Schrittweiten-Preset-Dropdown -> freies Zahlenfeld. Das Dropdown zeigt
    // IMMER die volle Liste (anders als eine gefilterte datalist); nach der Wahl
    // wird der Wert ins Feld übernommen und das Dropdown auf „▾" zurückgesetzt.
    [['#mStepSel', '#mStep'], ['#mStepSelCut', '#mStepCut']].forEach(([selId, inpId]) => {
      const sel = $(selId), inp = $(inpId);
      if (sel && inp) sel.onchange = () => { if (sel.value) { inp.value = sel.value; sel.selectedIndex = 0; } };
    });

    buildAxes();

    // Steuerung wählbar: grblHAL oder Mega 5X (grbl-mega-5x). Startwert aus den
    // gespeicherten Einstellungen (state.cfg.firmware, Teil der Maschinen-
    // Einstellungen → localStorage + hotwing-settings.json), sonst aus dem Select.
    const fwSel = $('#mFirmware');
    const cfgFw = window.App && App.state && App.state.cfg && App.state.cfg.firmware;
    if (fwSel) {
      setFirmware(FIRMWARES[cfgFw] ? cfgFw : (FIRMWARES[fwSel.value] ? fwSel.value : 'grblhal'));
      fwSel.onchange = () => setFirmware(fwSel.value, { log: true, save: true });
    } else {
      applyFirmwareUi();
    }

    // Verbindung
    $('#mConnect').onclick = async () => {
      unblocking = null;                          // evtl. hängenden Entsperr-Lauf vergessen
      if (grbl.connected) {
        await grbl.disconnect();
        $('#mConnect').textContent = T('Port wählen & verbinden');
        $('#mStateText').textContent = T('getrennt');
        $('#mStateDot').className = 'dot';
      } else {
        try {
          await grbl.connect(parseInt($('#mBaud').value, 10));
          $('#mConnect').textContent = T('Trennen');
          // Aktuelle $$-Einstellungen einlesen, u. a. $3 für die Invert-Checkboxen.
          try { await grbl.send('$$'); } catch (e) {}
        } catch (e) { log(e.message, 'err'); alert(e.message); }
      }
    };
    if (!('serial' in navigator)) {
      $('#mSerialNote').textContent =
        T('Web Serial fehlt: bitte Chrome/Edge nutzen und die Seite über http://localhost oder als lokale Datei öffnen.');
    }

    // GRBL-Einstellungen ($$-Menü des Boards)
    $('#mSettingsBtn').onclick = openSettings;
    $('#setClose').onclick = closeSettings;
    $('#grblSettings').addEventListener('click', e => { if (e.target.id === 'grblSettings') closeSettings(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });
    $('#setReload').onclick = loadSettings;
    $('#setSearch').addEventListener('input', filterRows);
    $('#setSave').onclick = async () => {
      if (!grbl.connected) { alert(T('Nicht verbunden.')); return; }
      const changed = Object.entries(setMap).filter(([, e]) => e.inp.value !== e.orig);
      if (!changed.length) { $('#setStatus').textContent = T('Keine Änderungen.'); return; }
      let errs = 0;
      for (const [n, e] of changed) {
        e.tr.style.outline = '';
        const r = await grbl.send(`$${n}=${e.inp.value.trim().replace(',', '.')}`);
        if (r.startsWith('error')) { errs++; e.tr.style.outline = '1px solid var(--bad)'; }
      }
      $('#setStatus').textContent =
        `${changed.length - errs}${T(' gespeichert')}${errs ? `, ${errs}${T(' Fehler')}` : ''}${T('. Aktualisiere …')}`;
      await loadSettings();
    };
    $('#rawSet').onclick = async () => {
      if (!grbl.connected) { alert(T('Nicht verbunden.')); return; }
      const n = $('#rawNum').value.trim().replace(/^\$/, '');
      const v = $('#rawVal').value.trim();
      if (!n) return;
      await grbl.send(`$${n}=${v}`);
      $('#rawNum').value = ''; $('#rawVal').value = '';
      loadSettings();
    };

    // Drahtheizung
    $('#mWire').oninput = e => $('#mWireVal').textContent = e.target.value + ' %';
    $('#mWireSet').onclick = () => {
      if (window.App && App.safetyOk && !App.safetyOk()) return;
      grbl.wire(parseFloat($('#mWire').value));
    };
    $('#mWireOff').onclick = () => { $('#mWire').value = 0; $('#mWireVal').textContent = '0 %'; grbl.wire(0); };

    // Vorschau-Simulation: Programm-Ende setzt den Knopf zurück.
    if (window.Sim3D && Sim3D.setMonitorEnd) Sim3D.setMonitorEnd(() => { monAutoPaused = false; const b = $('#mResume'); if (b) b.style.display = 'none'; setMonPlaying(false); });
    // Auto-Pause (M0) auch in der Simulation: „Fortsetzen" anbieten.
    if (window.Sim3D && Sim3D.setMonitorPause) Sim3D.setMonitorPause(() => {
      monAutoPaused = true; setMonPlaying(false);
      const b = $('#mResume'); if (b) b.style.display = '';
      log(T('Simulation: Auto-Pause (oben angekommen). „Fortsetzen" drücken.'), 'sys');
    });

    // Programm — aus der gewählten Quelle (Tragfläche/Blockzurichten) oder Datei
    $('#mUseGcode').onclick = () => {
      const prog = applyProgramFromSource(true);
      if (prog) log(T('Programm „') + prog.label + T('" übernommen (') + gcodeLines.length + T(' Zeilen).'), 'sys');
    };
    $('#mFile').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const lines = rd.result.split(/\r?\n/);
        // Datei in den Monitor laden — Körper aus der aktuell gewählten Quelle.
        if (window.Sim3D && Sim3D.loadMonitor) {
          const prog = getProgram();
          Sim3D.loadMonitor(rd.result, prog && prog.scene);
        }
        setProgram(lines, f.name + T(' — ') + lines.length + T(' Zeilen'));
        setMonContext(T('Datei: ') + f.name);
        progFromSource = false;   // geladene Datei: beim Flächenwechsel NICHT überschreiben
      };
      rd.readAsText(f); e.target.value = '';
    };
    // Vorschau-Simulation im 3D-Monitor (Trockenlauf vor dem Schnitt).
    const simPlay = $('#simMPlay');
    if (simPlay) simPlay.onclick = () => {
      if (!window.Sim3D || !Sim3D.playMonitor) return;
      monAutoPaused = false; const b = $('#mResume'); if (b) b.style.display = 'none';
      setMonPlaying(Sim3D.playMonitor());
    };
    const simReset = $('#simMReset');
    if (simReset) simReset.onclick = () => {
      if (window.Sim3D && Sim3D.stopMonitor) Sim3D.stopMonitor();
      monAutoPaused = false; const b = $('#mResume'); if (b) b.style.display = 'none';
      setMonPlaying(false);
    };
    // Optionale Checkliste (Einstellungen → Checkliste): erst wenn alle Punkte
    // abgehakt sind, wird der eigentliche Start ausgeführt.
    function askChecklist(then) {
      const c = window.App && App.checklistGet ? App.checklistGet() : null;
      if (!c || !c.on || !c.items.length) { then(); return; }
      let bd = document.getElementById('cutChecklistModal');
      if (!bd) {
        bd = document.createElement('div'); bd.className = 'modal-backdrop'; bd.id = 'cutChecklistModal';
        bd.innerHTML = '<div class="modal" style="width:min(520px,94vw)"><div class="head"><h2></h2><button class="close-x" title="Schließen">×</button></div>'
          + '<div class="body"></div><div class="foot"><div class="mrow"><span class="hint"></span><div class="sp"></div>'
          + '<button class="cl-cancel"></button><button class="primary cl-ok" disabled></button></div></div></div>';
        document.body.appendChild(bd);
      }
      const q = sel => bd.querySelector(sel);
      q('h2').textContent = T('Checkliste vor dem Schneiden');
      q('.foot .hint').textContent = T('Alle Punkte abhaken, dann starten. Liste anpassbar unter Einstellungen → Beschreibungen und Checkliste.');
      q('.cl-cancel').textContent = T('Abbrechen'); q('.cl-ok').textContent = T('Schnitt starten');
      const body = q('.body'); body.textContent = '';
      const boxes = [];
      c.items.forEach(txt => {
        const l = document.createElement('label'); l.style.cssText = 'display:flex;gap:10px;align-items:center;padding:7px 4px;border-bottom:1px solid var(--line);cursor:pointer;font-size:14px';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.style.cssText = 'width:18px;height:18px';
        cb.onchange = () => { q('.cl-ok').disabled = !boxes.every(b => b.checked); };
        l.appendChild(cb); l.appendChild(document.createTextNode(txt)); body.appendChild(l); boxes.push(cb);
      });
      q('.cl-ok').disabled = true;
      const close = () => bd.classList.remove('open');
      q('.close-x').onclick = close; q('.cl-cancel').onclick = close;
      q('.cl-ok').onclick = () => { close(); then(); };
      bd.classList.add('open');
    }
    $('#mStart').onclick = () => {
      if (!grbl.connected) { alert(T('Erst mit der Maschine verbinden.')); return; }
      if (grbl.streaming || !gcodeLines.length) return;
      // Einmaliger Sicherheitshinweis (safety.js), danach die optionale Checkliste.
      const go = () => askChecklist(startCut);
      if (window.App && App.safetyAck) App.safetyAck(go); else go();
    };
    function startCut() {
      if (!grbl.connected || grbl.streaming || !gcodeLines.length) return;
      // Fahrweg-Grenzen prüfen — bei Überschreitung NICHT schneiden.
      const viol = checkLimits();
      if (viol) {
        let msg;
        if (viol.kind === 'feed') {
          msg = T('Vorschub überschritten: F = ') + viol.val.toFixed(0) + T(' mm/min in Zeile ') + viol.line + ' '
            + T('(max ') + viol.limit + T(' mm/min). Schnitt nicht gestartet.');
        } else {
          const range = viol.limit > 0 ? (T('erlaubt 0 … ') + viol.limit + ' mm') : T('nicht unter 0 mm (Maschinennullpunkt)');
          msg = (viol.kind === 'neg'
            ? T('Fahrweg negativ: Achse ') + viol.axis + ' = ' + viol.val.toFixed(1) + ' mm'
            : T('Fahrweg überschritten: Achse ') + viol.axis + ' = ' + viol.val.toFixed(1) + ' mm')
            + T(' in Zeile ') + viol.line + ' (' + range + T('). Schnitt nicht gestartet.');
        }
        const tips = (window.App && App.limitAdvice) ? App.limitAdvice(viol) : [];
        log(msg, 'err');
        tips.forEach(t => log('  → ' + t, 'sys'));
        alert(msg + (tips.length ? '\n\n' + T('Mögliche Abhilfe:') + '\n' + tips.map(t => '• ' + t).join('\n') : ''));
        return;
      }
      $('#mStart').disabled = true; $('#mPause').disabled = false;
      { const ab = $('#mAbort'); if (ab) ab.disabled = false; }
      { const gz = $('#mGoZero'); if (gz) gz.style.display = 'none'; }
      const rb = $('#mResume'); if (rb) rb.style.display = 'none';
      setMonPlaying(false);                       // laufende Vorschau beenden
      highlightProgLine(0);
      // Der 3D-Monitor ist bewusst NICHT mit der Maschine verknüpft — er dient
      // nur der G-Code-Prüfung vor dem Schnitt (Vorschau über „Simulieren").
      // Auto-Pause (M0): „Fortsetzen"-Button zeigen, Pause-Button sperren.
      grbl.onPause = (i, total) => {
        const b = $('#mResume'); if (b) b.style.display = '';
        $('#mPause').disabled = true;
        log(T('Auto-Pause (oben angekommen) bei Zeile ') + i + T('. „Fortsetzen" drücken.'), 'sys');
      };
      grbl.stream(gcodeLines,
        (i, total) => {
          $('#mProg').value = i; $('#mProgText').textContent = `${i} / ${total}`;
          // Aktuelle Zeile im Programm markieren und mitscrollen. Der 3D-Monitor
          // ist nicht mit der Maschine verknüpft (nur Vorschau vor dem Schnitt).
          highlightProgLine(i - 1);
        },
        () => {
          $('#mStart').disabled = false; $('#mPause').disabled = true;
          { const ab = $('#mAbort'); if (ab) ab.disabled = true; }
          $('#mPause').textContent = T('Pause');
          const b = $('#mResume'); if (b) b.style.display = 'none';
          highlightProgLine(gcodeLines.length);   // alle Zeilen erledigt, Markierung aufheben
          log(T('Programm fertig.'), 'sys');
        });
    }
    $('#mPause').onclick = () => {
      grbl.paused = !grbl.paused;
      // Die Live-Ansicht folgt der gemeldeten Position — bei Feed-Hold steht die
      // Maschine, damit steht auch der Draht automatisch. Kein Extra-Handling.
      if (grbl.paused) { grbl.feedHold(); $('#mPause').textContent = T('Weiter'); }
      else { grbl.resume(); $('#mPause').textContent = T('Pause'); }
    };
    // Fortsetzen nach Auto-Pause (M0): senderseitig weiterlaufen.
    const resumeBtn = $('#mResume');
    if (resumeBtn) resumeBtn.onclick = () => {
      resumeBtn.style.display = 'none';
      // Fall 1: Auto-Pause der reinen VORSCHAU-Simulation (M0) -> Vorschau weiter.
      if (monAutoPaused) {
        monAutoPaused = false;
        if (window.Sim3D && Sim3D.playMonitor) setMonPlaying(Sim3D.playMonitor(true));
        log(T('Simulation fortgesetzt.'), 'sys');
        return;
      }
      // Fall 2: Auto-Pause beim echten Schneiden (M0) -> Streaming fortsetzen. Die
      // Live-Ansicht folgt automatisch der wieder anlaufenden Maschinenposition.
      $('#mPause').disabled = false; $('#mPause').textContent = T('Pause');
      grbl.paused = false;
      log(T('Fortsetzen.'), 'sys');
    };

    // Schnittabbruch: Bewegung SOFORT beenden (Soft-Reset leert den Puffer, der
    // Draht wird stromlos) und den Button „Fahren auf Nullpunkt" einblenden.
    { const abortBtn = $('#mAbort'); if (abortBtn) abortBtn.onclick = async () => {
      $('#mStart').disabled = false; $('#mPause').disabled = true;
      abortBtn.disabled = true; $('#mPause').textContent = T('Pause');
      const rb = $('#mResume'); if (rb) rb.style.display = 'none';
      await grbl.abort();                          // sofortiger Stopp, Puffer leeren
      const gz = $('#mGoZero'); if (gz) gz.style.display = '';
      log(T('Schnitt sofort abgebrochen, Draht AUS. Zum Zurückfahren „Fahren auf Nullpunkt" drücken; die Handfahrt entsperrt die Steuerung automatisch.'), 'sys');
    }; }

    // Fahren auf Nullpunkt: nach dem Abbruch etwaigen Alarm quittieren, Draht AUS
    // und SEQUENZIELL zurückfahren — erst horizontal (X/U) auf 0, dann vertikal
    // (Y/V) auf 0, damit der Draht nicht über die Arbeitsplatte schleift.
    async function goToZero(btn) {
      if (!grbl.connected) { alert(T('Erst mit der Maschine verbinden.')); return; }
      if (window.App && App.safetyOk && !App.safetyOk()) return;
      if (btn) btn.disabled = true;
      try {
        const [xL, yL, uL, vL] = getAxisLetters();
        grbl.streaming = false; grbl.paused = false;
        await releaseBlock();                        // Hold/Alarm auflösen (Soft-Reset + $X)
        await grbl.send('$X');                       // Alarm nach Soft-Reset quittieren
        await grbl.wire(0);                          // Draht sicher AUS
        log(T('Fahre auf Nullpunkt … (erst X, dann Y)'), 'sys');
        await grbl.send(`G90 G0 ${xL}0 ${uL}0`);     // 1) horizontal auf 0
        await grbl.send(`G90 G0 ${yL}0 ${vL}0`);     // 2) vertikal auf 0
      } finally {
        if (btn) btn.disabled = false;
      }
    }
    { const goZeroBtn = $('#mGoZero'); if (goZeroBtn) goZeroBtn.onclick = async () => {
      await goToZero(goZeroBtn);
      goZeroBtn.style.display = 'none';
    }; }
    // Gleicher Befehl direkt unter dem Not-Halt: nach dem Feed-Hold steht die
    // Maschine irgendwo im Schaum — ein Klick löst den Hold auf (Soft-Reset
    // verwirft die Restbewegung, KEIN Weiterfahren mit '~') und bringt den
    // Draht stromlos auf den Nullpunkt zurück.
    { const ez = $('#mEstopZero'); if (ez) ez.onclick = () => goToZero(ez); }

    // MDI (Konsolen im Schneiden- und Maschine-Menü)
    const bindMdi = (inputSel, btnSel) => {
      const inp = $(inputSel), btn = $(btnSel);
      if (!inp || !btn) return;
      const sendMdi = () => {
        const v = inp.value.trim();
        if (v) { grbl.send(v); inp.value = ''; }
      };
      btn.onclick = sendMdi;
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') sendMdi(); });
    };
    bindMdi('#mMdi', '#mMdiSend');
    bindMdi('#mMdi2', '#mMdiSend2');

    // Nullpunkt setzen: aktuelle Position als Maschinennullpunkt (Werk-Null) im
    // aktiven Koordinatensystem (G10 L20 P0 setzt alle Achsen auf 0).
    const setHome = async () => {
      if (!grbl.connected) { alert(T('Erst mit der Maschine verbinden.')); return; }
      const [xL, yL, uL, vL] = getAxisLetters();
      await grbl.send(`G10 L20 P0 ${xL}0 ${yL}0 ${uL}0 ${vL}0`);
      log(T('Maschinennullpunkt gesetzt (') + `${xL}0 ${yL}0 ${uL}0 ${vL}0` + ').', 'sys');
    };
    $('#mSetHome').onclick = setHome;
    { const hc = $('#mSetHomeCut'); if (hc) hc.onclick = setHome; }

    // Referenzfahrt (Homing) über Endschalter: sendet $H an den Controller.
    // grblHAL und Mega 5X (grbl-mega-5x) führen daraufhin ihren Homing-Zyklus
    // aus (Achsreihenfolge/-richtung/-geschwindigkeit steckt in den GRBL-Settings
    // $22..$27 und den Homing-Cycle-Masken). Der Aufruf blockiert, bis der
    // Controller mit 'ok' quittiert oder in Alarm geht. Der Draht bleibt AUS.
    const homeBtns = ['#mHome', '#mHomeCut'].map(s => $(s)).filter(Boolean);
    const homeStopBtns = ['#mHomeStop', '#mHomeStopCut'].map(s => $(s)).filter(Boolean);
    const showHomeStop = on => homeStopBtns.forEach(b => { b.style.display = on ? '' : 'none'; b.disabled = !on; });
    let homingActive = false;
    const doHoming = async () => {
      if (!grbl.connected) { alert(T('Erst mit der Maschine verbinden.')); return; }
      if (window.App && App.safetyOk && !App.safetyOk()) return;
      if (!confirm(T('Referenzfahrt starten? Alle Achsen fahren auf ihre Endschalter. Stelle sicher, dass der Verfahrweg frei ist. Der Draht bleibt AUS.'))) return;
      homeBtns.forEach(b => b.disabled = true);
      homingActive = true; showHomeStop(true);
      await grbl.send('$X');                        // evtl. anstehenden Alarm quittieren
      await grbl.wire(0);                            // Draht sicher AUS
      log(T('Referenzfahrt läuft … ($H)'), 'sys');
      const resp = await grbl.send('$H');           // blockiert bis fertig/Alarm
      if (typeof resp === 'string' && resp.startsWith('error')) {
        const n = (resp.split(':')[1] || '').trim();
        if (n === '5')
          log(T('Homing ist nicht aktiviert. In den GRBL-Einstellungen $22=1 setzen und Endschalter konfigurieren.'), 'err');
        else
          log(T('Referenzfahrt fehlgeschlagen: ') + resp + T('  (ggf. mit $X quittieren)'), 'err');
      } else if (resp === 'reset') {
        log(T('Referenzfahrt abgebrochen.'), 'err');
        log(T('Vor der nächsten Fahrt ggf. „Alarm/Fehler quittieren ($X)" drücken.'), 'sys');
      } else {
        // ALARM während $H wird intern zu 'ok' aufgelöst -> Zustand prüfen.
        await new Promise(r => setTimeout(r, STATUS_POLL_MS * 2));
        if (/Alarm/i.test(grbl.lastState || ''))
          log(T('Referenzfahrt fehlgeschlagen (Endschalter nicht erreicht?). Mit $X quittieren und Schalter/Richtung ($23) prüfen.'), 'err');
        else {
          log(T('Referenzfahrt abgeschlossen. Maschinennullpunkt referenziert.'), 'sys');
          // Werk-Nullpunkt auf die Referenzposition legen (sonst bleibt ein
          // alter Offset bestehen und die Anzeige steht nicht auf 0).
          if (homeSetZero()) {
            const [xL, yL, uL, vL] = getAxisLetters();
            await grbl.send(`G10 L20 P0 ${xL}0 ${yL}0 ${uL}0 ${vL}0`);
            grbl._wco = null;                        // Anzeige sofort auf MPos, bis neue WCO kommt
            log(T('Nullpunkt auf Referenzposition gesetzt (alle Achsen = 0).'), 'sys');
          }
        }
      }
      homingActive = false; showHomeStop(false);
      homeBtns.forEach(b => b.disabled = false);
    };
    homeBtns.forEach(b => b.onclick = doHoming);
    // Referenzfahrt stoppen: $H lässt sich in GRBL nur per Soft-Reset (Ctrl-X)
    // abbrechen. grbl.abort() macht Feed-Hold + Reset und löst das wartende
    // send('$H') mit 'reset' auf -> doHoming meldet „abgebrochen".
    homeStopBtns.forEach(b => b.onclick = async () => {
      if (!homingActive) return;
      showHomeStop(false);
      await grbl.abort();
    });

    // Alarme/Fehler quittieren. Nach einem Endschalter-/Hard-Limit-Alarm (ALARM:1)
    // akzeptiert GRBL/grblHAL KEIN $X — die Steuerung verlangt zuerst einen
    // Soft-Reset (Ctrl-X). Deshalb: bei aktivem Alarm erst Soft-Reset, kurz
    // warten (Banner/„'$H'|'$X' to unlock"), dann $X. Ohne Alarm genügt $X.
    // Ein Soft-Reset verwirft die Bewegungsplanung; im Alarm steht die Maschine
    // ohnehin, es geht also nichts verloren. Ein Neustart des Boards entfällt.
    const unlockBtns = ['#mUnlock', '#mUnlockCut'].map(s => $(s)).filter(Boolean);
    const doUnlock = async () => {
      if (!grbl.connected) { alert(T('Erst mit der Maschine verbinden.')); return; }
      unlockBtns.forEach(b => b.disabled = true);
      try {
        const inAlarm = /Alarm/i.test(grbl.lastState || '');
        if (inAlarm) {
          grbl.streaming = false; grbl.paused = false;
          await grbl.rt(0x18);                     // Soft-Reset (Ctrl-X)
          grbl.flushPending('reset');
          await new Promise(r => setTimeout(r, 400));
        }
        const r = await grbl.send('$X');
        if (typeof r === 'string' && r.startsWith('error')) {
          log(T('Quittieren fehlgeschlagen: ') + r, 'err');
          return;
        }
        log(inAlarm ? T('Alarm quittiert (Soft-Reset + $X). Position ggf. verloren — Referenzfahrt empfohlen.')
                    : T('Alarm/Fehler quittiert ($X).'), 'sys');
        // Steht ein Endschalter noch an, den Anwender darauf hinweisen: erst vom
        // Schalter wegfahren, sonst löst der nächste Alarm sofort wieder aus.
        const pins = (grbl.lastPins || '').replace(/[PDRH]/g, '');
        if (pins)
          log(T('Endschalter noch gedrückt (') + pins + T('). Mit Handfahrt vom Schalter wegfahren, bevor weitergearbeitet wird.'), 'err');
      } finally {
        unlockBtns.forEach(b => b.disabled = false);
      }
    };
    unlockBtns.forEach(b => b.onclick = doUnlock);

    // ---- Endschalter freifahren ------------------------------------------
    // Situation: Achse ist ÜBER den Endschalter gefahren, der Schalter bleibt
    // gedrückt. Mit aktiven Hard-Limits ($21) löst jeder Fahrversuch sofort
    // wieder Alarm aus (Prellen beim Öffnen / Prüfung beim Entriegeln).
    // Ablauf: $21 merken -> Hard-Limits aus -> Alarm quittieren -> gedrückte
    // Achse(n) per Jog vom Schalter wegfahren -> $21 wiederherstellen.
    const freeBtns = ['#mFree', '#mFreeCut'].map(s => $(s)).filter(Boolean);
    let freeBusy = false;
    function pressedAxes() {
      const pins = grbl.lastPins || '';
      return getAxisLetters().map((l, i) => ({ letter: l, i })).filter(a => pins.indexOf(a.letter) >= 0);
    }
    function updateFreeButtons() {
      const show = grbl.connected && pressedAxes().length > 0;
      freeBtns.forEach(b => { b.style.display = show ? '' : 'none'; if (!freeBusy) b.disabled = false; });
    }
    // Richtungsschätzung: GRBL setzt MPos=0 am Referenzschalter. $23-Bit gesetzt
    // = Homing ins Negative (Schalter am Minus-Ende, Fahrweg positiv), sonst am
    // Plus-Ende (Fahrweg negativ). Welche Seite näher ist, bestimmt die Richtung.
    // +1 = ins Plus wegfahren (Schalter am Minus-Ende), -1 = ins Minus.
    function guessFreeDir(ax) {
      const mpos = (grbl.lastMPos || [])[ax.i];
      const travel = parseFloat(cachedSetting(String(130 + ax.i)));
      const dirMask = parseInt(cachedSetting('23'), 10) || 0;
      const homesNeg = !!(dirMask & (1 << bitOf(ax.letter, ax.i)));
      if (!isFinite(mpos) || !isFinite(travel) || travel <= 0) return homesNeg ? +1 : -1;
      if (homesNeg) return mpos < travel / 2 ? +1 : -1;       // 0 = Minus-Ende
      return mpos > -travel / 2 ? -1 : +1;                    // 0 = Plus-Ende
    }
    function waitIdle(ms) {
      return new Promise(res => {
        const t0 = Date.now();
        const iv = setInterval(() => {
          const st = grbl.lastState || '';
          if (/Idle|Alarm/i.test(st) || Date.now() - t0 > ms || !grbl.connected) { clearInterval(iv); res(st); }
        }, 100);
      });
    }
    function closeFreePanel() { document.querySelectorAll('.freePanel').forEach(p => p.remove()); }
    function openFreePanel(btn) {
      closeFreePanel();
      const axesP = pressedAxes();
      if (!axesP.length) { log(T('Kein Endschalter gedrückt.'), 'sys'); updateFreeButtons(); return; }
      const panel = document.createElement('div');
      panel.className = 'freePanel';
      panel.style.cssText = 'margin-top:8px;padding:8px 10px;border:1px solid var(--bad);border-radius:8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;width:100%';
      const title = document.createElement('span'); title.className = 'lbl';
      title.textContent = T('Endschalter freifahren — Richtung prüfen:');
      panel.appendChild(title);
      const sels = axesP.map(ax => {
        const wrap = document.createElement('label'); wrap.style.cssText = 'display:flex;gap:4px;align-items:center';
        const sel = document.createElement('select');
        [['1', ax.letter + ' → +'], ['-1', ax.letter + ' → −']].forEach(([v, t]) => {
          const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o);
        });
        sel.value = String(guessFreeDir(ax));
        wrap.appendChild(sel); panel.appendChild(wrap);
        return { ax, sel };
      });
      const distL = document.createElement('label'); distL.style.cssText = 'display:flex;gap:4px;align-items:center';
      distL.append(T('Weg, mm'));
      const dist = document.createElement('input'); dist.type = 'number'; dist.min = '0.5'; dist.step = '0.5'; dist.value = '5'; dist.style.width = '64px';
      distL.appendChild(dist); panel.appendChild(distL);
      const go = document.createElement('button'); go.className = 'primary'; go.textContent = T('Freifahren');
      const cancel = document.createElement('button'); cancel.textContent = T('Abbrechen');
      panel.append(go, cancel);
      cancel.onclick = closeFreePanel;
      go.onclick = () => {
        const d = parseFloat(dist.value);
        if (!isFinite(d) || d <= 0) { alert(T('Bitte einen gültigen Weg eingeben.')); return; }
        const moves = sels.map(x => ({ letter: x.ax.letter, dist: d * (parseInt(x.sel.value, 10) || 1) }));
        closeFreePanel();
        runFree(moves);
      };
      btn.parentElement.appendChild(panel);
    }
    async function runFree(moves) {
      if (!grbl.connected || freeBusy) return;
      freeBusy = true; freeBtns.forEach(b => b.disabled = true);
      let hardVal = null;
      try {
        // Aktuellen $21-Wert holen (ggf. Einstellungen nachladen).
        if (cachedSetting('21') == null) { try { await grbl.send('$$'); } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
        hardVal = cachedSetting('21');
        const hardOn = hardVal != null && parseInt(hardVal, 10) !== 0;
        // Alarm quittieren (Soft-Reset + $X wie beim Quittieren-Knopf).
        if (/Alarm/i.test(grbl.lastState || '')) {
          grbl.streaming = false; grbl.paused = false;
          await grbl.rt(0x18);
          grbl.flushPending('reset');
          await new Promise(r => setTimeout(r, 400));
        }
        if (hardOn) {
          const r = await grbl.send('$21=0');
          if (typeof r === 'string' && r.startsWith('error')) { log(T('Hard-Limits konnten nicht abgeschaltet werden: ') + r, 'err'); return; }
          log(T('Hard-Limits vorübergehend aus ($21=0).'), 'sys');
        }
        const rx = await grbl.send('$X');
        if (typeof rx === 'string' && rx.startsWith('error')) { log(T('Quittieren fehlgeschlagen: ') + rx, 'err'); return; }
        await grbl.send('M5');                        // Draht sicher aus
        const feed = Math.min(parseFloat(($('#mJogFeed') || {}).value) || 300, 500);
        for (const m of moves) {
          log(T('Freifahren: ') + m.letter + (m.dist > 0 ? ' +' : ' ') + m.dist.toFixed(1) + ' mm', 'sys');
          const r = await grbl.send(`$J=G91 G21 ${m.letter}${m.dist.toFixed(3)} F${feed}`);
          if (typeof r === 'string' && r.startsWith('error')) { log(T('Freifahren fehlgeschlagen: ') + r, 'err'); break; }
          const st = await waitIdle(30000);
          if (/Alarm/i.test(st)) { log(T('Alarm während des Freifahrens — Richtung/Weg prüfen.'), 'err'); break; }
        }
        await new Promise(r => setTimeout(r, 300));  // letzten Statusbericht abwarten
        const still = pressedAxes().map(a => a.letter).join('');
        if (still) log(T('Endschalter weiterhin gedrückt (') + still + T('). Größeren Weg oder andere Richtung wählen.'), 'err');
        else log(T('Endschalter frei. Referenzfahrt empfohlen, da die Position unsicher ist.'), 'sys');
      } finally {
        if (hardVal != null && parseInt(hardVal, 10) !== 0 && grbl.connected) {
          if (/Alarm/i.test(grbl.lastState || '')) { try { await grbl.send('$X'); } catch (e) {} }
          const r = await grbl.send('$21=' + hardVal);
          if (typeof r === 'string' && r.startsWith('error'))
            log(T('ACHTUNG: Hard-Limits konnten nicht wieder eingeschaltet werden ($21=') + hardVal + '): ' + r, 'err');
          else log(T('Hard-Limits wieder ein ($21=') + hardVal + ').', 'sys');
        }
        freeBusy = false; updateFreeButtons();
      }
    }
    freeBtns.forEach(b => b.onclick = () => {
      if (!grbl.connected) { alert(T('Erst mit der Maschine verbinden.')); return; }
      openFreePanel(b);
    });

    // Not-Halt
    $('#mEstop').onclick = () => {
      grbl.streaming = false; grbl.paused = false;
      grbl.feedHold(); grbl.wire(0);
      grbl.flushPending('reset');                 // hängende ok-Quittung freigeben
      log('!! FEED HOLD', 'err');
      log(T('Die Steuerung steht in Hold. Die nächste Handfahrt löst den Zustand automatisch auf (Soft-Reset + $X).'), 'sys');
    };
  }

  /* Achsnamen haben sich in der Sidebar geändert -> DRO/Jog neu beschriften */
  function refreshAxes() {
    const letters = getAxisLetters();
    if (letters.join() === axes.map(a => a.letter).join()) return;
    buildAxes();
  }

  // sMax = $30 (max. Spindeldrehzahl) des aktiven Profils. Wird für die
  // G-Code-Erzeugung gebraucht, damit die Heizung-Prozent dort GENAUSO wie in
  // der Handsteuerung (grbl.wire) auf den S-Wert skaliert werden.
  window.GrblPanel = { init, refreshAxes, setFirmware, getFirmware: () => firmware,
                       setProgram: (lines, info) => setProgram(lines, info),
                       refreshProgram,   // geladenes Quell-Programm nach Flächenwechsel neu erzeugen
                       renderHoming, renderInvertAxes,
                       renderSettings, renderSettingsGroup, settingsGroup,
                       sMax: () => fw().sMax || WIRE_S_MAX, grbl,
                       Grbl };   // Klasse für weitere Verbindungen (z. B. Fräse, fraese.js)
})();
