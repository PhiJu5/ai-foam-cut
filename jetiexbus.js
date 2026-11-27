/* jetiexbus.js — Jeti EX Bus mithören (gehört zum Feature servos, Reiter „Flächenservos“)
 *
 * Weg: Jeti-Empfänger, ein Ausgang im Gerät-Explorer auf „EX Bus“ gestellt → USB-Seriell-Adapter
 * (nur RXD + GND, Pegel 3,3 V) → Web Serial. Die Kanäle kommen so an, wie die Servos sie bekommen:
 * mit Trimmung, Mischern, Servowegen und Kurven aus dem Sender. Die App sendet nie etwas.
 *
 * Protokoll nach JETI „EX Bus communication protocol“ v1.21 (18.12.2013):
 *   125 kBaud (LowSpeed) oder 250 kBaud (HighSpeed), 8N1, Halbduplex, Pegel 0 ≤ 1,5 V / 1 ≥ 3,0 V.
 *   Kanalpaket: 0x3E, 0x01|0x03, LEN (ganzes Paket mit Kopf und CRC), Paket-ID, 0x31, SUB_LEN,
 *   je Kanal uint16 LSB zuerst in 1/8 µs, dann CRC16-CCITT über alles davor (LSB, MSB).
 *   Bei Funkausfall schickt der Empfänger keine Kanalpakete. Die Baudrate stellt der Empfänger
 *   fest ein; „automatisch“ probiert hier beide, bis Pakete mit gültiger Prüfsumme kommen.
 */
(function () {
  'use strict';
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  const BAUDS = [125000, 250000];
  const SWITCH_MS = 1500;   // ohne gültiges Paket so lange → andere Baudrate (nur „automatisch“)

  // CRC16-CCITT genau wie der Beispielcode im Jeti-Dokument (crc_ccitt_update, Startwert 0)
  function crcUpd(crc, d) {
    d = (d ^ crc) & 0xFF; d = (d ^ (d << 4)) & 0xFF;
    return (((d << 8) | (crc >> 8)) ^ (d >> 4) ^ (d << 3)) & 0xFFFF;
  }
  function crc16(b, a, e) { let c = 0; for (let i = a; i < e; i++) c = crcUpd(c, b[i]); return c; }

  // Zerleger: nimmt Bytes in beliebigen Stücken, meldet gültige Kanalpakete als Liste in µs
  function Parser(onFrame) {
    let buf = new Uint8Array(1024), n = 0;
    const st = { ok: 0, bad: 0, other: 0 };
    function push(chunk) {
      if (n + chunk.length > buf.length) { const nb = new Uint8Array(Math.max(buf.length * 2, n + chunk.length)); nb.set(buf.subarray(0, n)); buf = nb; }
      buf.set(chunk, n); n += chunk.length;
      let i = 0;
      while (n - i >= 8) {                                       // kürzestes Paket: 8 Byte
        const h = buf[i], h2 = buf[i + 1], len = buf[i + 2];
        if (!(h === 0x3E || h === 0x3D || h === 0x3B) || !(h2 === 0x01 || h2 === 0x03) || len < 8 || len > 64) { i++; continue; }
        if (n - i < len) break;                                  // Paket noch nicht vollständig
        const c = crc16(buf, i, i + len - 2);
        if ((c & 0xFF) !== buf[i + len - 2] || (c >> 8) !== buf[i + len - 1]) {
          if (h === 0x3E && buf[i + 4] === 0x31 && buf[i + 5] + 8 === len) st.bad++;   // sah wie ein Kanalpaket aus
          i++; continue;
        }
        if (h === 0x3E && buf[i + 4] === 0x31) {
          const sl = Math.min(buf[i + 5], len - 8), us = [];
          for (let k = 0; k + 1 < sl; k += 2) us.push((buf[i + 6 + k] | (buf[i + 7 + k] << 8)) / 8);
          st.ok++; onFrame(us);
        } else st.other++;                                       // Telemetrie-/JETIBOX-Anfragen, Antworten
        i += len;
      }
      if (i) { buf.copyWithin(0, i, n); n -= i; }
    }
    return { push, st, reset() { n = 0; } };
  }
  // Kanalpaket bauen (nur für Tests und Testdaten): Werte in µs
  function packet(us, id) {
    const sl = us.length * 2, b = new Uint8Array(sl + 8);
    b[0] = 0x3E; b[1] = 0x03; b[2] = sl + 8; b[3] = (id || 0) & 0xFF; b[4] = 0x31; b[5] = sl;
    us.forEach((v, k) => { const q = Math.max(0, Math.min(0xFFFF, Math.round(v * 8))); b[6 + 2 * k] = q & 0xFF; b[7 + 2 * k] = q >> 8; });
    const c = crc16(b, 0, sl + 6); b[sl + 6] = c & 0xFF; b[sl + 7] = c >> 8;
    return b;
  }

  // ---------- Verbindung über Web Serial ----------
  const S = { on: false, sim: false, port: null, reader: null, run: null, baud: 0, mode: 'auto', next: false, us: [], tLast: 0, tOpen: 0, rate: 0, err: '' };
  const subs = new Set();
  const emit = kind => subs.forEach(f => { try { f(kind); } catch (e) { console.error(e); } });
  let cnt = 0, dog = null;
  const parser = Parser(us => { S.us = us; S.tLast = performance.now(); cnt++; emit('data'); });
  const now = () => performance.now();

  function startDog() {
    stopDog(); let t1 = now(); cnt = 0;
    dog = setInterval(() => {
      const t = now();
      if (t - t1 >= 1000) { S.rate = Math.round(cnt * 1000 / (t - t1)); cnt = 0; t1 = t; emit('status'); }
      if (S.on && !S.sim && S.mode === 'auto' && S.reader && !S.next && t - Math.max(S.tLast, S.tOpen) > SWITCH_MS) {
        S.next = true; S.reader.cancel().catch(() => {});
      }
    }, 250);
  }
  function stopDog() { if (dog) clearInterval(dog); dog = null; }

  async function run() {
    let k = 0;
    while (S.on) {
      const list = S.mode === 'auto' ? BAUDS : [+S.mode], baud = list[k % list.length];
      try { await S.port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', bufferSize: 4096 }); }
      catch (e) { S.err = e.message || String(e); break; }
      S.baud = baud; S.tOpen = now(); S.next = false; parser.reset(); emit('status');
      let lost = false, ended = false;
      while (S.on && !S.next) {
        if (!S.port.readable) { lost = true; break; }
        const rd = S.reader = S.port.readable.getReader();
        ended = false;
        try {
          for (;;) { const r = await rd.read(); if (r.done) { ended = true; break; } if (r.value && r.value.length) parser.push(r.value); }
        } catch (e) {
          // Rahmenfehler (z. B. falsche Baudrate) sind harmlos: Web Serial gibt danach einen neuen Datenstrom
          if (!S.port.readable) { lost = true; S.err = e.message || String(e); }
        }
        try { rd.releaseLock(); } catch (e) {}
        S.reader = null;
        if (ended || lost) break;
      }
      try { await S.port.close(); } catch (e) {}
      if (lost && S.on) { S.err = S.err || 'Verbindung verloren.'; break; }
      if (S.next) k++;
      else if (ended && S.on) await new Promise(r => setTimeout(r, 200));
    }
    S.on = false; S.reader = null; stopDog(); emit('status');
  }

  async function connect(mode) {
    if (S.on) return;
    if (!('serial' in navigator)) throw new Error('Web Serial nicht verfügbar. Bitte Chrome oder Edge verwenden (nicht Firefox/Safari).');
    const port = await navigator.serial.requestPort();
    Object.assign(S, { port, mode: mode || 'auto', on: true, sim: false, err: '', us: [], tLast: 0, rate: 0, next: false });
    parser.st.ok = parser.st.bad = parser.st.other = 0;
    startDog(); emit('status');
    S.run = run();
  }
  async function disconnect() {
    if (S.sim) { S.on = false; S.sim = false; stopDog(); emit('status'); return; }
    if (!S.on && !S.run) return;
    S.on = false;
    const rd = S.reader; if (rd) { try { await rd.cancel(); } catch (e) {} }
    if (S.run) { try { await S.run; } catch (e) {} }
    S.run = null; S.port = null; S.err = ''; stopDog(); emit('status');
  }
  // Baudrate umstellen, auch während der Verbindung
  function setMode(mode) {
    S.mode = mode || 'auto';
    if (S.on && !S.sim && S.reader) { S.next = true; S.reader.cancel().catch(() => {}); }
  }
  if (navigator.serial && navigator.serial.addEventListener) {
    navigator.serial.addEventListener('disconnect', e => {
      if (S.on && e.target === S.port) { S.err = 'Adapter abgezogen.'; if (S.reader) S.reader.cancel().catch(() => {}); }
    });
  }

  function status() {
    return { on: S.on, sim: S.sim, baud: S.baud, mode: S.mode, rate: S.rate, nch: S.us.length, age: S.tLast ? now() - S.tLast : Infinity,
      ok: parser.st.ok, bad: parser.st.bad, err: S.err };
  }

  window.JetiExBus = {
    connect, disconnect, setMode, status,
    isOn: () => S.on,
    values: () => S.us,
    value: ch => { const v = S.us[ch - 1]; return v == null ? null : v; },
    age: () => (S.tLast ? now() - S.tLast : Infinity),
    on: f => { subs.add(f); return () => subs.delete(f); },
    // Testdaten ohne Adapter: simulate(true) und dann inject(packet([...µs]))
    _test: {
      crc16: b => crc16(b, 0, b.length), Parser, packet,
      simulate(on) { if (on) { Object.assign(S, { on: true, sim: true, err: '', us: [], tLast: 0, baud: 125000 }); parser.reset(); startDog(); } else { S.on = false; S.sim = false; stopDog(); } emit('status'); },
      inject(bytes) { parser.push(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)); }
    }
  };
})();
