/* servos.js — Reiter „Flächenservos“ (Feature servos, braucht steghoehe)
 *
 * Servos, Hebel, Ruderhörner und Anlenkung (normal/überkreuz) mit Kinematik. Daten in cfg.stegH.srv,
 * Geometrie und Kollisionen über App.StegApi aus den Steghöhen (Stege, Holmgurt, Steckung).
 * Ansicht: Draufsicht, darunter je Servo automatisch ein Schnitt durch die Anlenkung.
 * Sender live: Mit jetiexbus.js (Jeti-Empfänger, Ausgang EX Bus, USB-Seriell-Adapter) stellt der Kanal
 * das Servo statt des Reglers. Trimmung und Mischer kommen dann aus dem Sender; die Trimmung hier
 * bleibt außen vor. Je Servo: Kanal sv.rxCh, Umkehr sv.rxRev, Mitte sv.rxMid (µs), Winkel sv.rxDeg bei ±500 µs.
 */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  if (!App.StegApi) return;
  const { state } = App;
  const { stkAll, capFace, cfg, geo, frame, section, capCenter, stkCenter, capAt, insetOf, shellOf, layA, webOf, allStege, stkData, ruderAt, secOne, profOf, f1, fl1, clamp } = App.StegApi;
  const T = s => (window.I18N ? window.I18N.t(s) : s);
  let side = null, boxes = [], win = null, cv = null, list = null, posPct = [], cards = [], openParts = {};
  let rxPeak = [], monEl = null, statEl = null, rxWasOn = false, rxRaf = 0;   // Sender live (nur Sitzung)
  const isOpen = () => !!win && state.activeTab === 'servo';

  // ---------- Flächenservos ----------
  // Maße aus Händlerangaben/Datenblättern: a = Breite, t = Dicke, b = Länge des Gehäuses in mm, ohne Laschen; dann Moment in kg·cm (0 = unbekannt)
  const SERVOS = [
    ['x10', 'KST X10', 30, 10, 35.5, 10.8], ['x10mini', 'KST X10 Mini', 30, 10, 29.6, 7.5], ['x10minipro', 'KST X10 Mini Pro', 30, 10, 28, 8], ['x10proa', 'KST X10 Pro-A', 30, 10, 33.5, 11.5],
    ['hv95', 'Chaservo HV95', 30, 9.5, 33.5, 11.5], ['ds09', 'Chaservo DS09', 23.5, 9, 27.5, 9], ['ds06', 'Chaservo DS06', 20, 7.4, 18.7, 0], ['hv06', 'Chaservo HV06', 19, 6, 18.5, 2.2],
    ['hv6130', 'MKS HV6130', 30, 10, 29.8, 8.1], ['ds6100', 'MKS DS6100', 22.5, 10, 23.8, 3.19]
  ];
  const srvList = c => (Array.isArray(c.srv) ? c.srv : (c.srv = []));
  function srvDims(sv) {
    const p = SERVOS.find(q => q[0] === sv.type);
    return p ? { a: p[2], t: p[3], b: p[4], tq: p[5] } : { a: Math.max(0, +sv.a || 0), t: Math.max(0, +sv.t || 0), b: Math.max(0, +sv.b || 0) };
  }
  // Servo liegt flach auf der Einbauseite: gemessen wird über die ganze Grundfläche an der engsten Stelle (auf der sicheren Seite)
  // ext: Kinematik-Tabelle zusätzlich bis ±ext° (Sender live kann über den Servoweg hinaus stellen)
  function srvCalc(G, c, sv, ext) {
    const { a, b, t } = srvDims(sv), z = +sv.z || 0, f = frame(G, clamp(z, 0, G.L)), xc = f.le + f.c * (+sv.pos || 0) / 100;
    const dx = a, dz = b, top = sv.side === 'top', warn = [], gap = Math.max(0, +c.srvGap || 0);
    const onOuter = !!c.layOn && sv.on === 'outer', R = { z, xc, dx, dz, t, top, warn };
    if (z - dz / 2 < -1e-6 || z + dz / 2 > G.L + 1e-6) warn.push(T('Ragt über die Tragfläche hinaus.'));
    let hi = Infinity, lo = -Infinity, out = false, onCap = false;
    for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
      const zz = clamp(z - dz / 2 + dz * j / 6, 0, G.L), x = xc - dx / 2 + dx * i / 6, sec = section(G, x, zz);
      if (!sec) { out = true; continue; }
      const cap = Math.abs(x - capCenter(G, c, zz)) < capAt(G, c, 'capW', zz) / 2, capI = insetOf(G, c, 'holm', zz);
      if (cap) onCap = true;
      const inM = Math.max(onOuter ? layA(c) : shellOf(c), cap ? capI : 0), inO = Math.max(shellOf(c), cap ? capI : 0);
      hi = Math.min(hi, sec.top - (top ? inM : inO)); lo = Math.max(lo, sec.bot + (top ? inO : inM));
    }
    if (out || !isFinite(hi)) { warn.push(T('Ragt aus dem Profil.')); R.avail = null; return R; }
    R.avail = hi - lo; R.y0 = top ? hi - t : lo; R.margin = R.avail - t - gap; R.ok = R.margin >= -1e-9;
    if (!R.ok) warn.push(T('Passt nicht: es fehlen') + ' ' + f1(-R.margin) + ' mm');
    if (onCap) warn.push(T('Liegt im Bereich des Holmgurts.'));
    // Hebel: Welle parallel zur Länge, ein Viertel der Breite vom Gehäuseende (Annahme), am gewählten Wellenende.
    // Die Welle liegt immer parallel zum Scharnier. Hebel schwingt quer dazu; 0° = senkrecht zur gewählten Austrittsseite,
    // unabhängig von der Einbauseite.
    {
      R.hornDeg = +sv.hornA || 0; R.armDeg = +sv.armA || 0; R.armLen = sv.arm != null ? Math.max(0, +sv.arm || 0) : 12;
      const armTop = (sv.armSide || sv.side) === 'top', arm = sv.arm != null ? Math.max(0, +sv.arm || 0) : 12, A = (+sv.armA || 0) * Math.PI / 180, sA = Math.sin(A) * arm, cA = Math.cos(A) * arm * (armTop ? 1 : -1);
      const zs = sv.armEnd === 'in' ? -1 : 1, xs = sv.armShaft === 'front' ? -1 : 1;
      const x0 = xc + xs * a / 4, z0 = z + zs * dz / 2, y0 = R.y0 + t / 2;
      const x1 = x0 + sA, z1 = z0, y1 = y0 + cA, sec = section(G, x1, clamp(z1, 0, G.L));
      R.arm = { x0, y0, z0, x1, y1, z1, out: sec ? (armTop ? y1 - sec.top : sec.bot - y1) : null };
    }
    if (sv.lkOn) R.lk = srvLink(G, c, sv, R, (sv.armSide || sv.side) === 'top', ext || 0);
    const hx = q => { const g = frame(G, q); return g.le + g.c * (1 - g.hp / 100); };
    if (xc + dx / 2 > Math.min(hx(clamp(z - dz / 2, 0, G.L)), hx(clamp(z + dz / 2, 0, G.L)))) warn.push(T('Reicht über die Scharnierlinie.'));
    allStege(G, c).forEach(d => {
      if (d.len > 0 && d.path.some(p => Math.abs(p.z - z) <= dz / 2 && Math.abs(p.x - xc) < dx / 2 + webOf(d.st, d.kind) / 2)) warn.push(T('Trifft') + ' ' + d.st.name);
    });
    if (stkAll(G, c).some(S => S.cy != null && z - dz / 2 < S.len && z + dz / 2 > S.z0 && Math.abs(xc - S.cx(clamp(z, S.z0, S.len))) < dx / 2 + S.oW / 2)) warn.push(T('Trifft die Steckung.'));
    return R;
  }
  // Anlenkung als Viergelenk in der Profilebene: Welle – Hebelloch – Gestänge (feste Länge) – Hornloch – Scharnier.
  // Normal: Horn auf der Seite des Servohebels. Überkreuz: Horn auf der Gegenseite, das Gestänge kreuzt die Profilmitte.
  // Ausschlag + = Ruder nach unten (wie der Regler in den Schnitten).
  // Servoweg je Richtung: Das Servo nutzt immer seinen ganzen Weg ±Servoweg (in Summe 2 × Servoweg), auch getrimmt,
  // und kommt nie darüber hinaus. Die Trimmung verschiebt nur die Knüppelmitte: von dort geht es zu einer Seite
  // weniger weit (Servoweg − Trimmung), zur anderen weiter (Servoweg + Trimmung), ±100 % Knüppel = Wegende.
  function srvRange(sv) {
    const mx = clamp(sv.lkMax != null ? +sv.lkMax : 45, 1, 90), tr = clamp(sv.trimP != null ? mx * sv.trimP / 100 : +sv.trim || 0, -mx, mx);   // sv.trim = Altstand in Grad
    return { mx, tr, neg: mx, pos: mx };
  }
  // Knüppel in % → Servowinkel: 0 % = Trimmung, je Seite linear bis zum Wegende
  const srvStick = (rg, pct) => { const p = clamp(+pct || 0, -100, 100) / 100; return clamp(rg.tr + p * (p >= 0 ? rg.pos - rg.tr : rg.neg + rg.tr), -rg.neg, rg.pos); };
  // Knüppelstellung, in der das Servo auf 0° steht (Ruder neutral)
  const srvStickZero = rg => -100 * rg.tr / (rg.tr > 0 ? rg.neg + rg.tr : rg.pos - rg.tr);
  // Hebel in der Servomitte (Mitte des getrimmten Wegs); null ohne Trimmung
  function trimArm(sv, R) {
    if (!R.arm) return null;
    const tr = srvRange(sv).tr; if (Math.abs(tr) < 1e-6) return null;
    const a = -tr * Math.PI / 180, dx = R.arm.x1 - R.arm.x0, dy = R.arm.y1 - R.arm.y0;
    return { tr, p: [R.arm.x0, R.arm.y0], q: [R.arm.x0 + dx * Math.cos(a) - dy * Math.sin(a), R.arm.y0 + dx * Math.sin(a) + dy * Math.cos(a)] };
  }
  function srvLink(G, c, sv, R, top, ext) {
    const warn = R.warn, A = R.arm;
    const Ru = ruderAt(G, Object.assign({}, c, { lipOn: false }), clamp(A.z0, 0, G.L), []);
    if (!Ru) { warn.push(T('Kein Scharnierpunkt an dieser Stelle.')); return null; }
    const cross = sv.lkType === 'cross', hornUp = cross ? !top : top, hH = sv.hornH != null ? +sv.hornH : 10, hX = +sv.hornX || 0, hA = (+sv.hornA || 0) * Math.PI / 180;
    const hx = Ru.xh + hX, sec = section(G, hx, clamp(A.z0, 0, G.L));
    if (!sec) { warn.push(T('Ruderhorn liegt außerhalb des Profils.')); return null; }
    const base = [hx, hornUp ? sec.top : sec.bot], hole = [hx + hH * Math.sin(hA), hornUp ? sec.top + hH * Math.cos(hA) : sec.bot - hH * Math.cos(hA)];
    const S = [A.x0, A.y0], T0 = [A.x1, A.y1], rod = Math.hypot(T0[0] - hole[0], T0[1] - hole[1]), H = Ru.H;
    const rot = (p, c0, deg) => { const a = -deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a); return [c0[0] + (p[0] - c0[0]) * ca - (p[1] - c0[1]) * sa, c0[1] + (p[0] - c0[0]) * sa + (p[1] - c0[1]) * ca]; };
    const err = (d, ph) => { const t = rot(T0, S, d), h = rot(hole, H, ph); return Math.hypot(t[0] - h[0], t[1] - h[1]) - rod; };
    const rg = srvRange(sv), sweep = (sgn, lim) => {
      const P = [], ds = []; let ph = 0, last = null;
      for (let d = 1; d < lim; d += 1) ds.push(d);
      if (lim > 0) ds.push(lim);
      for (const d of ds) {
        let q = ph + (last == null ? 0 : last), ok = false;
        for (let n = 0; n < 12; n++) {
          const e = err(sgn * d, q); if (Math.abs(e) < 1e-6) { ok = true; break; }
          const de = (err(sgn * d, q + 0.01) - e) / 0.01; if (Math.abs(de) < 1e-5) break;
          q -= clamp(e / de, -8, 8);
        }
        if (!ok || Math.abs(q) > 80) return { P, dead: true };
        last = q - ph; ph = q; P.push([sgn * d, q]);
      }
      return { P, dead: false };
    };
    const a = sweep(1, rg.pos), b = sweep(-1, rg.neg), pts = b.P.slice().reverse().concat([[0, 0]], a.P);
    // Sender live: Tabelle weiter als der Servoweg, damit ein zu großer Senderweg sichtbar wird (Ende = Totpunkt)
    let ptsX = null;
    if (ext > Math.max(rg.pos, rg.neg)) { const ax = sweep(1, ext), bx = sweep(-1, ext); ptsX = bx.P.slice().reverse().concat([[0, 0]], ax.P); }
    if (a.dead || b.dead) warn.push(T('Totpunkt: Das Gestänge streckt sich vor dem vollen Servoweg.'));
    const dAt = i => { const p = pts[Math.max(0, i - 1)], n = pts[Math.min(pts.length - 1, i + 1)]; return n[0] !== p[0] ? (n[1] - p[1]) / (n[0] - p[0]) : 0; };
    const i0 = pts.findIndex(p => p[0] === 0), ratio = dAt(i0), ph = pts.map(p => p[1]), down = Math.max(0, ...ph), up = -Math.min(0, ...ph);
    // Ruderlast nach Chuck Gadd (Platte, cm und mph, oz·in → kg·cm); Moment am Servo = Moment am Ruder × Übersetzung
    const f = frame(G, clamp(A.z0, 0, G.L)), rc = f.c * f.hp / 100 / 10, rl = Math.max(0, sv.ruL != null ? +sv.ruL : 300) / 10, mph = Math.max(0, sv.lkV != null ? +sv.lkV : 100) / 1.609;
    let need = 0;
    pts.forEach((p, i) => { const r = Math.abs(p[1]) * Math.PI / 180; if (r < 1.4) need = Math.max(need, 8.5e-6 * rc * rc * mph * mph * rl * Math.sin(r) * Math.tan(r) * 0.072 * Math.abs(dAt(i))); });
    const tq = sv.tq != null ? +sv.tq : srvDims(sv).tq || 0;
    if (tq > 0 && need * 2 > tq) warn.push(T('Servomoment knapp: nötig mit Faktor 2') + ' ' + f1(need * 2) + ' kg·cm');
    if (Math.abs(ratio) < 1e-3) warn.push(T('Keine Übersetzung: Hebel und Horn bewegen das Ruder hier nicht.'));
    return { rg, cross, S, T0, hole, base, H, rot, rod, pts, ptsX, ratio, up, down, need, tq, dead: a.dead || b.dead, Ru };
  }
  // Ruderausschlag zu einem Servowinkel (aus der Tabelle); am Totpunkt bleibt es bei der letzten möglichen Stellung
  function lkRudder(L, d) {
    const P = L.pts, e = clamp(d, P[0][0], P[P.length - 1][0]);
    for (let i = 1; i < P.length; i++) if (e <= P[i][0]) { const a = P[i - 1], b = P[i]; return { d: e, ph: a[1] + (b[1] - a[1]) * (e - a[0]) / (b[0] - a[0]) }; }
    return { d: e, ph: P[P.length - 1][1] };
  }
  function lkChart(L) {
    const P = L.pts, W = 250, H0 = 90, xs = Math.max(1, ...P.map(p => Math.abs(p[0]))), ys = Math.max(1, ...P.map(p => Math.abs(p[1])));
    const X0 = d => W / 2 + d / xs * (W / 2 - 4), Y0 = q => H0 / 2 + q / ys * (H0 / 2 - 4);
    return '<svg viewBox="0 0 ' + W + ' ' + H0 + '" style="width:100%;margin-top:4px;background:#10141a;border-radius:4px"><path d="M0 ' + H0 / 2 + 'H' + W + 'M' + W / 2 + ' 0V' + H0 + '" stroke="#3a4350" fill="none"/>'
      + '<polyline fill="none" stroke="#ffd27a" stroke-width="1.6" points="' + P.map(p => X0(p[0]).toFixed(1) + ',' + Y0(p[1]).toFixed(1)).join(' ') + '"/>'
      + '<text x="4" y="11" font-size="9" fill="#9aa7b8">' + T('Ruder') + ' ±' + f1(ys) + '°</text><text x="' + (W - 4) + '" y="' + (H0 - 3) + '" font-size="9" fill="#9aa7b8" text-anchor="end">' + T('Servo') + ' ±' + f1(xs) + '°</text></svg>';
  }
  function srvResult() {
    const G = geo(); if (!G) return;
    const L = srvList(cfg());
    boxes.forEach((box, i) => {
      box.innerHTML = ''; if (!L[i]) return;
      const R = srvCalc(G, cfg(), L[i]);
      const line = (t, col) => { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'font-size:12px;margin-top:3px' + (col ? ';color:' + col : ''); box.appendChild(d); };
      if (R.avail != null) line(T('Platz') + ' ' + fl1(R.avail) + ' mm, ' + T('Servo') + ' ' + f1(R.t) + ' mm' + (R.ok ? ' · ' + T('passt') : ''), R.ok ? '#7ee0a0' : '#ff6b6b');
      if (R.arm && R.arm.out > 0) line(T('Hebel ragt aus der Kontur:') + ' ' + f1(R.arm.out) + ' mm');
      if (R.lk) {
        const K = R.lk, rt = Math.abs(K.ratio);
        line(T('Servoweg') + ' −' + f1(K.rg.neg) + '° / +' + f1(K.rg.pos) + '°');
        line(T('Ausschlag: oben') + ' ' + f1(K.up) + '° / ' + T('unten') + ' ' + f1(K.down) + '°', '#ffd27a');
        line(T('Übersetzung Ruder : Servo in Mittelstellung') + ' ' + rt.toFixed(2) + ' : 1');
        line(T('Differenzierung (unten gegen oben)') + ' ' + (K.up + K.down > 0 ? f1((K.down - K.up) / (K.up + K.down) * 100) : '0.0') + ' %');
        line(T('Gestängelänge') + ' ' + f1(K.rod) + ' mm');
        line(T('Moment am Servo') + ' ' + f1(K.need) + ' kg·cm' + (K.tq > 0 ? ' ' + T('von') + ' ' + f1(K.tq) : ''));
        const ch = document.createElement('div'); ch.innerHTML = lkChart(K); box.appendChild(ch);
      }
      R.warn.forEach(w => line(w, '#ffb454'));
    });
  }

  // ---------- Seitenleiste ----------
  function buildSide() {
    if (!side) return;
    const { numRow, selectRow, hint, subhead } = App, c = cfg(), G = geo(), scr = document.getElementById('side'), keep = scr ? scr.scrollTop : 0;
    side.innerHTML = ''; boxes = [];
    if (!G) { hint(side, 'Keine Tragfläche vorhanden.'); return; }
    hint(side, 'Stege, Holmgurt und Steckung kommen aus dem Reiter Steghöhen und werden auf Kollisionen geprüft. Der Schnitt durch die Anlenkung entsteht je Servo automatisch.');
    const ds = side, L = G.L, upd = update, NR = { step: 0.5, min: 0, norender: true, enter: true }, GR = Object.assign({}, NR, { step: 0.1 }), GB = Object.assign({}, NR, { step: 1 });
    const SL = srvList(c); boxes = [];
    rxSide(ds);
    numRow(ds, 'Anzahl', () => SL.length, v => {
      const n = clamp(Math.round(v) || 0, 0, 12);
      while (SL.length < n) SL.push({ type: 'x10mini', z: Math.round(L * 0.5), pos: 50, side: 'bot', armSide: 'bot', on: 'inner', arm: 12, armA: 0, armShaft: 'rear', armEnd: 'out', a: 30, t: 10, b: 30 });
      SL.length = n; refresh(true);
    }, { step: 1, min: 0, max: 12, int: true, norender: true, enter: true });
    if (SL.length) numRow(ds, 'Luft über dem Servo (mm)', () => c.srvGap || 0, v => { c.srvGap = Math.max(0, v); upd(); }, GR);
    SL.forEach((sv, i) => {
      subhead(ds, T('Servo') + ' ' + (i + 1), '#5fd8e8');
      // Aufklappbare Teile je Servo; Zustand bleibt beim Neuaufbau erhalten
      const part = (key, title, def) => {
        const k = key + i, d = document.createElement('details'); d.open = openParts[k] != null ? openParts[k] : def !== false; d.ontoggle = () => { openParts[k] = d.open; };
        const h = document.createElement('summary'); h.textContent = T(title); h.style.cssText = 'cursor:pointer;font-weight:700;font-size:12px;margin-top:4px';
        d.appendChild(h); ds.appendChild(d); return d;
      };
      const pS = part('s', 'Servo');
      selectRow(pS, 'Typ', SERVOS.map(p => [p[0], p[1] + ' (' + p[2] + '×' + p[3] + '×' + p[4] + ')']).concat([['free', 'Eigene Maße']]), () => sv.type, v => { sv.type = v; refresh(true); });
      if (sv.type === 'free') {
        numRow(pS, 'Breite (mm)', () => sv.a, v => { sv.a = Math.max(0, v); upd(); }, GR);
        numRow(pS, 'Dicke (mm)', () => sv.t, v => { sv.t = Math.max(0, v); upd(); }, GR);
        numRow(pS, 'Länge (mm)', () => sv.b, v => { sv.b = Math.max(0, v); upd(); }, GR);
      }
      numRow(pS, 'Mitte ab Wurzel (mm)', () => sv.z, v => { sv.z = clamp(v, 0, L); upd(); }, Object.assign({}, NR, { step: 10 }));
      numRow(pS, 'Mitte (% der Sehne ab Nase)', () => sv.pos, v => { sv.pos = clamp(v, 0, 100); upd(); }, Object.assign({}, NR, { step: 1 }));
      selectRow(pS, 'Einbauseite', [['bot', 'unten'], ['top', 'oben']], () => sv.side || 'bot', v => { sv.side = v; upd(); });
      if (c.layOn) selectRow(pS, 'Servo liegt auf', [['inner', 'Innenlage'], ['outer', 'Außenlage (Stützstoff ausgespart)']], () => sv.on || 'inner', v => { sv.on = v; upd(); });
      numRow(pS, 'Servoweg ± (°)', () => sv.lkMax != null ? sv.lkMax : 45, v => { sv.lkMax = clamp(v, 1, 90); upd(); }, GB);
      numRow(pS, 'Servotrimmung (% des Servowegs)', () => { const r = srvRange(sv); return Math.round(r.tr / r.mx * 1000) / 10; }, v => { sv.trimP = clamp(v, -100, 100); upd(); }, Object.assign({}, NR, { step: 1, min: -100, max: 100 }));
      numRow(pS, 'Servomoment (kg·cm)', () => sv.tq != null ? sv.tq : (srvDims(sv).tq || 0), v => { sv.tq = Math.max(0, v); upd(); }, GR);
      selectRow(pS, 'Ruderhebel schaut heraus', [['bot', 'unten'], ['top', 'oben']], () => sv.armSide || sv.side || 'bot', v => { sv.armSide = v; upd(); });
      numRow(pS, 'Hebellänge ab Welle (mm)', () => sv.arm != null ? sv.arm : 12, v => { sv.arm = Math.max(0, v); upd(); }, GB);
      numRow(pS, 'Hebelwinkel (°, 0 = senkrecht)', () => sv.armA || 0, v => { sv.armA = clamp(v, -90, 90); upd(); }, Object.assign({}, NR, { step: 5, min: -90, max: 90 }));
      selectRow(pS, 'Welle liegt', [['rear', 'hinten am Gehäuse'], ['front', 'vorne am Gehäuse']], () => sv.armShaft || 'rear', v => { sv.armShaft = v; upd(); });
      selectRow(pS, 'Hebel am Ende', [['out', 'außen'], ['in', 'wurzelseitig']], () => sv.armEnd || 'out', v => { sv.armEnd = v; upd(); });
      const pA = part('a', 'Anlenkung');
      App.boolRow(pA, 'Anlenkung mit Ruderhorn', () => !!sv.lkOn, v => { sv.lkOn = v; refresh(true); });
      if (sv.lkOn) {
        selectRow(pA, 'Art', [['normal', 'Normal (Horn auf Hebelseite)'], ['cross', 'Überkreuz (Horn auf Gegenseite)']], () => sv.lkType || 'normal', v => { sv.lkType = v; upd(); });
        numRow(pA, 'Ruderlänge je Servo (mm)', () => sv.ruL != null ? sv.ruL : 300, v => { sv.ruL = Math.max(0, v); upd(); }, Object.assign({}, NR, { step: 10 }));
        numRow(pA, 'Fluggeschwindigkeit (km/h)', () => sv.lkV != null ? sv.lkV : 100, v => { sv.lkV = Math.max(0, v); upd(); }, Object.assign({}, NR, { step: 10 }));
        const pH = part('h', 'Ruderhorn');
        numRow(pH, 'Hornhöhe über Ruder (mm)', () => sv.hornH != null ? sv.hornH : 10, v => { sv.hornH = Math.max(0, v); upd(); }, GB);
        numRow(pH, 'Horn hinter Scharnierlinie (mm)', () => sv.hornX || 0, v => { sv.hornX = v; upd(); }, Object.assign({}, GB, { min: -100 }));
        numRow(pH, 'Hornwinkel (°, 0 = senkrecht, + = nach hinten)', () => sv.hornA || 0, v => { sv.hornA = clamp(v, -80, 80); upd(); }, Object.assign({}, NR, { step: 5, min: -80, max: 80 }));
      }
      // Sender live: welcher Kanal stellt dieses Servo, und wie das Servo µs in Grad umsetzt
      if (RX()) {
        const pR = part('r', 'Sender (Kanal)', !!(+sv.rxCh > 0));
        hint(pR, 'Mitte und Winkel aus dem Servo-Datenblatt (meist 1500 µs, 1000–2000 µs ≈ ±45°). Läuft das Ruder falsch herum: Drehrichtung umkehren, im Sender nichts ändern.');
        selectRow(pR, 'Kanal', [['0', '—']].concat(Array.from({ length: 24 }, (_, k) => [String(k + 1), T('Kanal') + ' ' + (k + 1)])), () => String(+sv.rxCh || 0), v => { sv.rxCh = +v || 0; rxPeak[i] = null; refresh(true); });
        App.boolRow(pR, 'Drehrichtung umkehren', () => !!sv.rxRev, v => { sv.rxRev = v; rxPeak[i] = null; upd(); });
        numRow(pR, 'Servomitte (µs)', () => sv.rxMid != null ? sv.rxMid : 1500, v => { sv.rxMid = clamp(v, 800, 2200); rxPeak[i] = null; upd(); }, Object.assign({}, NR, { step: 1, min: 800, max: 2200 }));
        numRow(pR, 'Servowinkel bei ±500 µs (°)', () => sv.rxDeg != null ? sv.rxDeg : 45, v => { sv.rxDeg = clamp(v, 5, 90); rxPeak[i] = null; upd(); }, Object.assign({}, GB, { min: 5, max: 90 }));
      }
      const box = document.createElement('div'); ds.appendChild(box); boxes[i] = box;
    });
    if (scr) scr.scrollTop = keep;
  }
  function refresh(rebuild) { if (!isOpen()) return; if (rebuild) { buildSide(); buildCards(); } update(); }
  function update() { cards.forEach(k => { k.Rx = null; k.lastUs = null; }); srvResult(); draw(); drawCards(); }

  // ---------- Sender live (Jeti EX Bus, jetiexbus.js) ----------
  const RX = () => window.JetiExBus || null;
  const BAUD_KEY = 'hw_exbus_baud';
  const baudMode = () => { try { return localStorage.getItem(BAUD_KEY) || 'auto'; } catch (e) { return 'auto'; } };
  // Servowinkel aus dem Kanal: null, solange kein Sender verbunden/zugeordnet ist
  function rxDeg(sv) {
    const J = RX(); if (!J || !J.isOn() || !(+sv.rxCh > 0)) return null;
    const us = J.value(+sv.rxCh); if (us == null) return null;
    const mid = sv.rxMid != null ? +sv.rxMid : 1500, k = (sv.rxDeg != null ? +sv.rxDeg : 45) / 500;
    return { us, d: (sv.rxRev ? -1 : 1) * (us - mid) * k };
  }
  function rxSide(ds) {
    const J = RX(); if (!J) return;
    const on = J.isOn(), d = document.createElement('details'); d.open = openParts.rx != null ? openParts.rx : on; d.ontoggle = () => { openParts.rx = d.open; };
    const h = document.createElement('summary'); h.textContent = T('Sender live (Jeti EX Bus)'); h.style.cssText = 'cursor:pointer;font-weight:700;font-size:12px;margin-top:2px;color:#ffd27a';
    d.appendChild(h); ds.appendChild(d);
    App.hint(d, 'Empfänger-Ausgang auf EX Bus stellen und über einen USB-Seriell-Adapter anschließen. Trimmung, Mischer und Servowege kommen fertig aus dem Sender; hier wird je Servo nur der Kanal zugeordnet.');
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:4px';
    const btn = (t, f, tip) => { const b = document.createElement('button'); b.textContent = T(t); b.style.padding = '2px 8px'; if (tip) b.title = T(tip); b.onclick = f; return b; };
    const bc = btn(on ? 'Trennen' : 'Sender verbinden', async () => {
      try { if (J.isOn()) await J.disconnect(); else { rxPeak = []; await J.connect(baudMode()); } }
      catch (e) { if (e && e.name === 'NotFoundError') return; const m = T(e && e.message || String(e)); if (App.toast) App.toast(m); else alert(m); }
      refresh(true);
    }, on ? '' : 'USB-Seriell-Adapter wählen (Anschluss, an dem der Empfänger hängt)');
    const sel = document.createElement('select');
    [['auto', 'Baudrate automatisch'], ['125000', '125 kBaud'], ['250000', '250 kBaud']].forEach(o => { const e = document.createElement('option'); e.value = o[0]; e.textContent = T(o[1]); sel.appendChild(e); });
    sel.value = baudMode(); sel.title = T('Wie im Empfänger eingestellt; „automatisch“ probiert beide');
    sel.onchange = () => { try { localStorage.setItem(BAUD_KEY, sel.value); } catch (e) {} J.setMode(sel.value); };
    row.append(bc, sel, btn('Verkabelung …', wiringHelp, 'Schaltplan: Empfänger – Adapter – PC'));
    d.appendChild(row);
    statEl = document.createElement('div'); statEl.style.cssText = 'font-size:12px;margin-top:4px'; d.appendChild(statEl);
    monEl = document.createElement('div'); monEl.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;margin-top:4px;font-size:11px'; d.appendChild(monEl);
    if (on) d.appendChild(btn('Schleppzeiger zurücksetzen', () => { rxPeak = []; drawCards(); }, 'Größte Ausschläge nach oben und unten je Servo neu messen'));
    rxStatus(); rxMon();
  }
  function rxStatus() {
    const J = RX(); if (!J || !statEl || !statEl.isConnected) return;
    const s = J.status(); let t, col = '#9aa7b8';
    if (!s.on) { t = s.err ? T('Getrennt:') + ' ' + T(s.err) : T('Nicht verbunden.'); if (s.err) col = '#ff6b6b'; }
    else if (s.age > 1000) {
      t = T('Verbunden, aber keine Daten') + ' (' + (s.baud / 1000) + ' kBaud' + (s.mode === 'auto' ? ', ' + T('suche') : '') + '). ' + T('Sender an? Ausgang auf EX Bus? Verkabelung prüfen.'); col = '#ffb454';
    } else {
      t = T('Empfange') + ' ' + s.nch + ' ' + T('Kanäle') + ' · ' + (s.baud / 1000) + ' kBaud · ' + s.rate + ' ' + T('Pakete/s') + (s.sim ? ' · ' + T('Testdaten') : '') + (s.bad ? ' · ' + s.bad + ' ' + T('Prüfsummenfehler') : ''); col = '#7ee0a0';
    }
    statEl.textContent = t; statEl.style.color = col;
  }
  // Kanal-Monitor: alle Kanäle als Balken um 1500 µs, zugeordnete Servos dabei
  function rxMon() {
    const J = RX(); if (!J || !monEl || !monEl.isConnected) return;
    const us = J.isOn() ? J.values() : [], n = us.length;
    monEl.style.display = n ? 'grid' : 'none';
    if (monEl.childElementCount !== n) {
      monEl.innerHTML = '';
      for (let k = 0; k < n; k++) {
        const e = document.createElement('div'); e.style.cssText = 'display:flex;align-items:center;gap:4px;min-width:0';
        const a = document.createElement('span'); a.style.cssText = 'width:52px;white-space:nowrap;overflow:hidden';
        const b = document.createElement('div'); b.style.cssText = 'flex:1;height:7px;background:#222a35;border-radius:3px;position:relative;min-width:30px';
        const f = document.createElement('div'); f.style.cssText = 'position:absolute;top:0;bottom:0;background:#5fd8e8;border-radius:3px'; b.appendChild(f);
        const v = document.createElement('span'); v.style.cssText = 'width:34px;text-align:right;color:#9aa7b8';
        e.append(a, b, v); monEl.appendChild(e);
      }
    }
    const used = {}; srvList(cfg()).forEach((sv, i) => { if (+sv.rxCh > 0) (used[sv.rxCh] = used[sv.rxCh] || []).push('S' + (i + 1)); });
    for (let k = 0; k < n; k++) {
      const e = monEl.children[k], [a, b, v] = e.children, f = b.firstChild, x = clamp((us[k] - 1500) / 750, -1, 1), u = used[k + 1];
      a.textContent = 'K' + (k + 1) + (u ? ' ' + u.join(',') : ''); a.style.color = u ? '#ffd27a' : '';
      f.style.left = (50 + Math.min(0, x) * 50) + '%'; f.style.width = Math.max(1, Math.abs(x) * 50) + '%';
      v.textContent = Math.round(us[k]);
    }
  }
  function rxEvent(kind) {
    if (!isOpen()) return;
    const J = RX(), on = J.isOn();
    if (on !== rxWasOn) { rxWasOn = on; refresh(true); return; }   // Seitenleiste und Karten auf Live umstellen
    if (kind === 'status') { rxStatus(); cards.forEach(k => { k.lastUs = null; }); }   // „kein Signal“ nachführen
    if (!rxRaf) rxRaf = requestAnimationFrame(rxTick);
  }
  function rxTick() {
    rxRaf = 0; if (!isOpen()) return;
    rxMon(); rxStatus();
    const SL = srvList(cfg());
    cards.forEach(card => {
      const sv = SL[card.i], L = sv && rxDeg(sv); if (!L) return;
      if (card.lastUs != null && Math.abs(card.lastUs - L.us) < 0.25) return;   // nur neu zeichnen, wenn sich etwas tut
      card.lastUs = L.us; drawCard(card);
    });
  }
  // Anzeige unter der Karte im Live-Betrieb: Kanal, Schleppzeiger, Hinweise
  function rxLive(card, sv, L, dS, st, mm, tab, rg) {
    const pk = rxPeak[card.i] || (rxPeak[card.i] = { lo: 0, hi: 0, mlo: 0, mhi: 0 });
    if (st.ph < pk.lo) { pk.lo = st.ph; pk.mlo = mm; }
    if (st.ph > pk.hi) { pk.hi = st.ph; pk.mhi = mm; }
    const J = RX(), warn = [];
    if (Math.abs(dS) > rg.mx + 0.05) warn.push(T('Servo über dem Servoweg') + ' ±' + f1(rg.mx) + '°');
    if (tab && (dS < tab.pts[0][0] - 0.05 || dS > tab.pts[tab.pts.length - 1][0] + 0.05)) warn.push(T('Totpunkt: Das Gestänge streckt sich'));
    if (J && J.age() > 500) warn.push(T('kein Signal'));
    card.lCh.textContent = T('Sender') + ' K' + sv.rxCh + ': ' + Math.round(L.us) + ' µs → ' + T('Servo') + ' ' + f1(dS) + '°';
    card.lPk.textContent = T('Schleppzeiger: oben') + ' ' + f1(-pk.lo) + '° (' + f1(Math.abs(pk.mlo)) + ' mm) · ' + T('unten') + ' ' + f1(pk.hi) + '° (' + f1(Math.abs(pk.mhi)) + ' mm)';
    card.lWarn.textContent = warn.join(' · ');
  }
  if (RX()) RX().on(rxEvent);
  function show() { if (!win) build(); if (App.recompute) App.recompute(); refresh(true); }

  // ---------- Ansicht ----------
  function build() {
    win = document.createElement('div'); win.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;min-width:0';
    const top = document.createElement('div'); top.style.cssText = 'flex:2;position:relative;min-height:0';
    cv = document.createElement('canvas'); cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'; top.appendChild(cv);
    list = document.createElement('div'); list.style.cssText = 'flex:3;overflow:auto;min-height:0;padding:6px 10px;border-top:1px solid var(--border,#2a3038)';
    win.append(top, list); document.getElementById('servoView').appendChild(win);
    new ResizeObserver(() => { draw(); cards.forEach(k => { k.view = null; }); drawCards(); }).observe(win);
  }
  // Je Servo ein Schnitt, genau durch die Anlenkung (Hebelebene)
  function buildCards() {
    if (!list) return;
    const G = geo(), SL = G ? srvList(cfg()) : []; list.innerHTML = ''; cards = [];
    if (!SL.length) { const d = document.createElement('div'); d.className = 'hint'; d.textContent = T('Noch kein Servo — links die Anzahl eintragen.'); list.appendChild(d); return; }
    posPct.length = SL.length;
    SL.forEach((sv, i) => {
      const t = document.createElement('div'); t.dataset.title = i; t.style.cssText = 'font-weight:700;font-size:12px;margin:6px 0 3px;color:#5fd8e8'; list.appendChild(t);
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap'; list.appendChild(row);
      {
        const w = document.createElement('div'); w.style.cssText = 'flex:1 1 320px;min-width:0';
        const h = document.createElement('div'); h.style.cssText = 'font-size:11px;color:#9aa7b8;margin-bottom:2px';
        const c0 = document.createElement('canvas'); c0.style.cssText = 'width:100%;height:230px;display:block;background:#10141a;border-radius:4px';
        // Knüppelstellung je Servo (nur Ansicht); Ruder neutral = die Stellung, in der das Servo auf 0° steht
        const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:3px;font-size:12px';
        const lb = document.createElement('span'); lb.textContent = T('Knüppel (%)');
        const dn = document.createElement('input'); dn.type = 'text'; dn.inputMode = 'decimal'; dn.style.width = '50px'; dn.value = posPct[i] || 0;
        const dr = document.createElement('input'); dr.type = 'range'; dr.min = -100; dr.max = 100; dr.step = 0.1; dr.value = posPct[i] || 0; dr.style.cssText = 'flex:1;min-width:100px';
        const nb = document.createElement('button'); nb.textContent = T('Ruder neutral'); nb.style.padding = '2px 7px';
        const setPos = v => { posPct[i] = v; dn.value = v; dr.value = v; drawCard(card); };
        dr.oninput = () => setPos(+dr.value);
        dn.onchange = () => { const v = parseFloat(dn.value.replace(',', '.')); if (!isNaN(v)) setPos(clamp(v, -100, 100)); };
        nb.onclick = () => { const rg = srvRange(srvList(cfg())[i]); setPos(Math.round(srvStickZero(rg) * 10) / 10); };
        bar.append(lb, dn, dr, nb);
        if (App.cadImportDxfText) { const cb = document.createElement('button'); cb.textContent = T('In CAD übernehmen'); cb.title = T('Schnitt mit Kinematik in Ruder-Neutrallage in die CAD-Bearbeitung laden, je Bauteil eine Ebene (ersetzt deren Inhalt nach Rückfrage)'); cb.style.padding = '2px 7px'; cb.onclick = () => cutToCad(i);
          const el = document.createElement('label'); el.style.cssText = 'display:flex;gap:4px;align-items:center;white-space:nowrap'; el.title = T('Endlagen mit Hebel, Gestänge, Horn und Ruder gestrichelt mit übernehmen');
          const ec = document.createElement('input'); ec.type = 'checkbox'; ec.checked = !!sv.cadEnd; ec.onchange = () => { sv.cadEnd = ec.checked; };
          const es = document.createElement('span'); es.textContent = T('mit Endlagen'); el.append(ec, es); bar.append(cb, el); }
        // Sender live: statt des Reglers Kanal, Schleppzeiger und Hinweise
        const lb2 = document.createElement('div'); lb2.style.cssText = 'display:none;gap:4px 12px;align-items:center;flex-wrap:wrap;margin-bottom:3px;font-size:12px';
        const lCh = document.createElement('span'); lCh.style.color = '#ffd27a';
        const lPk = document.createElement('span'); lPk.style.color = '#c8d2e0';
        const lRs = document.createElement('button'); lRs.textContent = T('zurücksetzen'); lRs.title = T('Schleppzeiger dieses Servos zurücksetzen'); lRs.style.padding = '1px 6px';
        lRs.onclick = () => { rxPeak[i] = null; card.lastUs = null; drawCard(card); };
        const lWarn = document.createElement('span'); lWarn.style.color = '#ffb454';
        lb2.append(lCh, lPk, lRs, lWarn);
        w.append(h, bar, lb2, c0); row.appendChild(w);
        const card = { i, cv: c0, head: h, title: t, view: null, bar, lbar: lb2, lCh, lPk, lWarn };
        c0.addEventListener('wheel', e => {
          e.preventDefault(); if (!card.view) return; const r = c0.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = Math.exp(-e.deltaY * 0.0015), V = card.view;
          const wx = (mx - V.ox) / V.s, wy = (V.oy - my) / V.s; V.s *= f; V.ox = mx - wx * V.s; V.oy = my + wy * V.s; drawCard(card);
        }, { passive: false });
        c0.addEventListener('mousedown', e => {
          if (!card.view) return; const V = card.view, sx = e.clientX, sy = e.clientY, ox = V.ox, oy = V.oy;
          const mv = ev => { V.ox = ox + ev.clientX - sx; V.oy = oy + ev.clientY - sy; drawCard(card); };
          const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
          window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
        });
        c0.addEventListener('dblclick', () => { card.view = null; drawCard(card); });
        cards.push(card);
      }
    });
  }
  function drawCards() { if (isOpen()) cards.forEach(drawCard); }
  function drawCard(card) {
    const G = geo(), c = cfg(), sv = srvList(c)[card.i]; if (!G || !sv) return;
    // Sender live: Kanal stellt das Servo; Ergebnis zwischenspeichern, weil bis zu 60-mal je Sekunde gezeichnet wird
    const live = rxDeg(sv), R = live ? (card.Rx || (card.Rx = srvCalc(G, c, sv, 90))) : srvCalc(G, c, sv);
    if (card.bar) { card.bar.style.display = live ? 'none' : 'flex'; card.lbar.style.display = live ? 'flex' : 'none'; }
    const r = card.cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, w = r.width, h = r.height; if (w < 2 || h < 2) return;
    const z = clamp(R.arm ? R.arm.z0 : R.z, 0, G.L), name = (SERVOS.find(p => p[0] === sv.type) || [0, T('Eigene Maße')])[1];
    card.title.textContent = 'S' + (card.i + 1) + ' · ' + name;
    card.head.textContent = T('Schnitt durch die Anlenkung') + ' · ' + f1(z) + ' mm ' + T('ab Wurzel');
    card.cv.width = Math.round(w * dpr); card.cv.height = Math.round(h * dpr);
    const g = card.cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#10141a'; g.fillRect(0, 0, w, h);
    const q = profOf(G, z); q.dy = -(q.hi + q.lo) / 2;
    if (!card.view) {
      let hi = q.hi - q.lo, K = R.lk; hi = hi / 2 + 4;
      const reach = p => { hi = Math.max(hi, Math.abs(p[1] + q.dy) + 4); };
      if (R.arm) reach([0, R.arm.y1]); if (K) { reach(K.hole); }
      const s = Math.max(1e-4, Math.min((w - 40) / Math.max(1, q.xr), (h - 44) / (2 * hi)));
      card.view = { s, ox: (w - q.xr * s) / 2, oy: (h - 16) / 2 };
    }
    const V = card.view, X = u => V.ox + u * V.s, Y = v => V.oy - v * V.s;
    g.font = '12px sans-serif';
    // Der Regler stellt das Servo, das Ruder folgt über die Kinematik
    const K = R.lk, rg = srvRange(sv), tab = K && K.ptsX ? { pts: K.ptsX } : K;
    let dS, st;
    if (live) { dS = live.d; st = tab ? lkRudder(tab, dS) : { d: clamp(dS, -90, 90), ph: 0 }; }   // Trimmung/Mischer schon im Kanal
    else { dS = srvStick(rg, posPct[card.i] || 0); st = K ? lkRudder(K, dS) : { d: dS, ph: 0 }; }   /* wie am Sender: Knüppelmitte = Trimmung, ±100 % = Wegende */
    // Ausschlag an der Endleiste: Rudertiefe × sin(Ruderwinkel)
    const fz = frame(G, z), mm = fz.c * fz.hp / 100 * Math.sin(st.ph * Math.PI / 180);
    card.head.textContent += ' · ' + T('Servo') + ' ' + f1(st.d) + '°' + (K ? ' · ' + T('Ruder') + ' ' + f1(st.ph) + '° (' + f1(mm) + ' mm)' : '');
    if (live) rxLive(card, sv, live, dS, st, mm, tab, rg);
    secOne(g, G, allStege(G, c), q, X, Y, V.s, st.ph);
    // Servo, Hebel, Anlenkung
    if (R.avail == null) return;
    const col = R.warn.length ? '#ff6b6b' : '#5fd8e8', P = p => [X(p[0] - q.le), Y(p[1] + q.dy)];
    g.beginPath(); g.rect(X(R.xc - R.dx / 2 - q.le), Y(R.y0 + R.t + q.dy), R.dx * V.s, R.t * V.s); g.fillStyle = col + '66'; g.fill(); g.strokeStyle = col; g.lineWidth = 1.2; g.stroke();
    const seg = (a, b, c2, lw) => { const u = P(a), v = P(b); g.beginPath(); g.moveTo(u[0], u[1]); g.lineTo(v[0], v[1]); g.strokeStyle = c2; g.lineWidth = lw; g.stroke(); };
    const dot = p => { const u = P(p); g.fillStyle = '#ffffff'; g.beginPath(); g.arc(u[0], u[1], 3, 0, 7); g.fill(); };
    // Trimmung: roter Strich = Servomitte, weißer Hebel = aktuelle Stellung (live trimmt der Sender)
    const TA = live ? null : trimArm(sv, R);
    if (TA) { seg(TA.p, TA.q, '#ff4d4d', 2); const u = P(TA.q), tx = T('Trimmung') + ' ' + (TA.tr > 0 ? '+' : '') + f1(TA.tr) + '°'; g.fillStyle = '#ff4d4d'; g.fillText(tx, clamp(u[0] - g.measureText(tx).width - 6, 2, w), clamp(u[1], 12, h - 4)); }
    if (K) {
      const tip = K.rot(K.T0, K.S, st.d), ho = K.rot(K.hole, K.H, st.ph), ba = K.rot(K.base, K.H, st.ph);
      seg(K.S, tip, '#ffffff', 2.5); seg(ba, ho, '#ffd27a', 3); seg(tip, ho, '#7ee0a0', 1.6); dot(K.H);
      // Maße an den Teilen; wirksame Hornlänge = Scharnier bis Hornloch
      const nw = (p, txt, col2, dy) => { const u = P(p), tw = g.measureText(txt).width; g.fillStyle = col2; g.fillText(txt, clamp(u[0] - tw / 2, 2, Math.max(2, w - tw - 2)), clamp(u[1] + dy, 12, h - 4)); };
      if (nw) {
        const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], down = (K.hole[1] < K.H[1]) ? 16 : -8;
        nw(tip, T('Hebel') + ' ' + f1(R.armLen) + ' mm · ' + f1(R.armDeg + st.d) + '°', '#ffffff', down);
        nw(mid(tip, ho), T('Gestänge') + ' ' + f1(K.rod) + ' mm', '#7ee0a0', -5);
        nw(ho, T('Horn') + ' ' + f1(Math.hypot(K.hole[0] - K.H[0], K.hole[1] - K.H[1])) + ' mm · ' + f1(R.hornDeg) + '° · ' + T('Ruder') + ' ' + f1(st.ph) + '°', '#ffd27a', down);
      }
    } else if (R.arm) {
      const a = -st.d * Math.PI / 180, dx0 = R.arm.x1 - R.arm.x0, dy0 = R.arm.y1 - R.arm.y0;
      const tp = [R.arm.x0 + dx0 * Math.cos(a) - dy0 * Math.sin(a), R.arm.y0 + dx0 * Math.sin(a) + dy0 * Math.cos(a)], u = P(tp);
      seg([R.arm.x0, R.arm.y0], tp, '#ffffff', 2.5);
      g.fillStyle = '#ffffff'; g.fillText(T('Hebel') + ' ' + f1(R.armLen) + ' mm · ' + f1(R.armDeg + st.d) + '°', u[0] + 5, clamp(u[1] + 14, 12, h - 4));
    }
  }
  // Draufsicht: Grundriss, Gurt, Scharnier, Stege und Steckung als Bezug, darauf die Servos
  function draw() {
    if (!cv || !isOpen()) return;
    const r = cv.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, w = r.width, h = r.height; if (w < 2 || h < 2) return;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#10141a'; g.fillRect(0, 0, w, h);
    const G = geo(); if (!G) return;
    const c = cfg(), pl = [], tr = [];
    G.segs.forEach((q, i) => { if (!i) { pl.push([q.z0, q.le0]); tr.push([q.z0, q.le0 + q.cut.root.pl.chord]); } pl.push([q.z1, q.le0 + q.sw]); tr.push([q.z1, q.le0 + q.sw + q.cut.tip.pl.chord]); });
    const xs = pl.concat(tr).map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), s = Math.min((w - 70) / G.L, (h - 40) / Math.max(1, x1 - x0));
    const ox = (w - G.L * s) / 2, oy = (h - (x1 - x0) * s) / 2 - x0 * s, X = z => ox + z * s, Y = x => oy + x * s;
    const line = (P, close) => { g.beginPath(); P.forEach((p, i) => { if (i) g.lineTo(X(p[0]), Y(p[1])); else g.moveTo(X(p[0]), Y(p[1])); }); if (close) g.closePath(); };
    g.font = '12px sans-serif';
    line(pl.concat(tr.slice().reverse()), true); g.fillStyle = 'rgba(160,180,210,.10)'; g.fill(); g.strokeStyle = '#c8d2e0'; g.lineWidth = 1.2; g.stroke();
    const Z = [0].concat(G.segs.map(q => q.z1));
    line(Z.map(z => [z, capCenter(G, c, z) - capAt(G, c, 'capW', z) / 2]).concat(Z.slice().reverse().map(z => [z, capCenter(G, c, z) + capAt(G, c, 'capW', z) / 2])), true); g.fillStyle = 'rgba(255,60,220,.18)'; g.fill();
    g.setLineDash([9, 4]); line(Z.map(z => { const f = frame(G, z); return [z, f.le + f.c * (1 - f.hp / 100)]; })); g.strokeStyle = '#7ee0a0'; g.lineWidth = 1.3; g.stroke(); g.setLineDash([]);
    allStege(G, c).forEach(d => { if (d.len > 0) { line(d.path.map(p => [p.z, p.x])); g.strokeStyle = d.kind === 'holm' ? '#5aa9ff' : '#ffa94d'; g.lineWidth = Math.max(1.5, webOf(d.st, d.kind) * s); g.stroke(); } });
    const S = stkData(G, c);
    stkAll(G, c).forEach(S => { if (S.len > S.z0 && S.oW > 0) { const ZZ = [S.z0, S.len]; line(ZZ.map(z => [z, S.cx(z) - S.oW / 2]).concat(ZZ.slice().reverse().map(z => [z, S.cx(z) + S.oW / 2])), true); g.fillStyle = 'rgba(255,240,106,.28)'; g.fill(); g.strokeStyle = '#fff06a'; g.lineWidth = 1; g.stroke(); } });
    srvList(c).forEach((sv, i) => {
      const R = srvCalc(G, c, sv), col = R.warn.length ? '#ff6b6b' : '#5fd8e8';
      line([[R.z - R.dz / 2, R.xc - R.dx / 2], [R.z + R.dz / 2, R.xc - R.dx / 2], [R.z + R.dz / 2, R.xc + R.dx / 2], [R.z - R.dz / 2, R.xc + R.dx / 2]], true);
      g.fillStyle = col + '44'; g.fill(); g.strokeStyle = col; g.lineWidth = 1.3; g.stroke();
      g.fillStyle = col; g.fillText('S' + (i + 1), X(R.z + R.dz / 2) + 3, Y(R.xc) + 4);
      if (R.arm) {
        // Schnittebene als Linie
        g.strokeStyle = '#ff5c8a'; g.lineWidth = 1; { const z = R.arm.z0, f = frame(G, clamp(z, 0, G.L)); line([[z, f.le], [z, f.le + f.c]]); g.stroke(); }
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(X(R.arm.z0), Y(R.arm.x0), 2.5, 0, 7); g.fill();
      }
    });
  }
  // Schnitt durch die Anlenkung als DXF: x ab Nase, y wie im Profil, maßstäblich 1:1; Ruder in Neutrallage,
  // dazu die beiden Endlagen von Hebel, Gestänge und Horn. Je Bauteil eine Ebene, damit im CAD Hörner darauf konstruiert werden können.
  function cutDxf(i) {
    const G = geo(), c = cfg(), sv = srvList(c)[i]; if (!G || !sv || !window.Dxf) return null;
    const R = srvCalc(G, c, sv); if (R.avail == null) return null;
    const z = clamp(R.arm ? R.arm.z0 : R.z, 0, G.L), q = profOf(G, z), layers = [], X = p => ({ x: p[0] - q.le, y: p[1] });
    const add = (name, color, polys) => { const P = polys.filter(p => p.pts.length > 1); if (P.length) layers.push({ name, color, polys: P }); };
    const open = P => ({ closed: false, pts: P.map(X) }), shut = P => ({ closed: true, pts: P.map(X) });
    add('PROFIL', 7, [{ closed: true, pts: q.P.map(p => ({ x: p[0], y: p[1] })) }]);
    // Schale: Innenkontur senkrecht versetzt wie in den Schnitten
    const sh = shellOf(c);
    if (sh > 0) {
      const up = [], dn = [];
      for (let k = 0; k <= 160; k++) { const u = q.xr * (1 - Math.cos(Math.PI * k / 160)) / 2, sc = section(G, q.le + u, z); if (sc && sc.top - sc.bot > 2 * sh) { up.push([q.le + u, sc.top - sh]); dn.push([q.le + u, sc.bot + sh]); } }
      add('SCHALE_INNEN', 3, [shut(up.concat(dn.reverse()))]);
    }
    // Holmgurt oben und unten
    const cm = capCenter(G, c, z), bw = capAt(G, c, 'capW', z), ct = capAt(G, c, 'capT', z), go = capFace(c);
    if (bw > 0 && ct > 0) {
      const a = [], b = [], d = [], e = [];
      for (let k = 0; k <= 12; k++) { const x = cm - bw / 2 + bw * k / 12, sc = section(G, x, z); if (!sc || sc.top - sc.bot < 2 * (go + ct)) continue; a.push([x, sc.top - go]); b.push([x, sc.top - go - ct]); d.push([x, sc.bot + go]); e.push([x, sc.bot + go + ct]); }
      add('HOLMGURT', 6, [shut(a.concat(b.reverse())), shut(d.concat(e.reverse()))]);
    }
    // Stege und Steckung an dieser Stelle
    const webs = [];
    allStege(G, c).forEach(d => {
      if (z < d.a - 1e-6 || z > d.b + 1e-6 || !(d.len > 0)) return;
      const a = d.at(z, 0); if (a.H == null || !(a.h > 0)) return;
      const w = webOf(d.st, d.kind) / 2; webs.push(shut([[a.x - w, a.top], [a.x + w, a.top], [a.x + w, a.bot], [a.x - w, a.bot]]));
    });
    add('STEGE', 5, webs);
    for (const S of stkAll(G, c)) if (S.cy != null && z >= S.z0 - 1e-6 && z <= S.len + 1e-6 && S.oH > 0) {
      const y = S.cy + z * S.tan, cm = S.cx(z), ring = (w, h) => {
        if (S.round) { const P = []; for (let k = 0; k < 48; k++) P.push([cm + w / 2 * Math.cos(k * Math.PI / 24), y + w / 2 * Math.sin(k * Math.PI / 24)]); return shut(P); }
        return shut([[cm - w / 2, y + h / 2], [cm + w / 2, y + h / 2], [cm + w / 2, y - h / 2], [cm - w / 2, y - h / 2]]);
      };
      add('STECKUNG', 2, [ring(S.oW, S.oH), ring(S.inW, S.inH)].filter((_, k) => k === 0 || S.inH > 0));
    }
    add('SERVO', 4, [shut([[R.xc - R.dx / 2, R.y0], [R.xc + R.dx / 2, R.y0], [R.xc + R.dx / 2, R.y0 + R.t], [R.xc - R.dx / 2, R.y0 + R.t]])]);
    { const TA = trimArm(sv, R); if (TA) add('TRIMMUNG', 1, [open([TA.p, TA.q])]); }
    const K = R.lk, cross = (p, r) => [open([[p[0] - r, p[1]], [p[0] + r, p[1]]]), open([[p[0], p[1] - r], [p[0], p[1] + r]])];
    if (R.arm) add('HEBEL', 7, [open([[R.arm.x0, R.arm.y0], [R.arm.x1, R.arm.y1]])].concat(cross([R.arm.x0, R.arm.y0], 1.5)));
    if (K) {
      const sc = section(G, K.Ru.xh, z);
      add('SCHARNIER', 3, cross(K.H, 1.5).concat(sc ? [open([[K.Ru.xh, sc.top], [K.Ru.xh, sc.bot]])] : []));
      add('RUDERHORN', 30, [open([K.base, K.hole])]);
      add('GESTAENGE', 1, [open([K.T0, K.hole])]);
      // Endlagen nur auf Wunsch: Hebel, Gestänge, Horn und das Ruder in seiner Stellung
      if (sv.cadEnd) {
        const up = [], dn = [], xe = q.le + q.xr - 1e-3, x0 = K.Ru.xh;
        for (let k = 0; k <= 60; k++) { const x = x0 + (xe - x0) * k / 60, sc = section(G, x, z); if (sc) { up.push([x, sc.top]); dn.push([x, sc.bot]); } }
        const rud = up.concat(dn.reverse());
        const end = i0 => { const p = K.pts[i0], t = K.rot(K.T0, K.S, p[0]), h = K.rot(K.hole, K.H, p[1]), b = K.rot(K.base, K.H, p[1]); return [open([K.S, t]), open([t, h]), open([b, h]), shut(rud.map(r => K.rot(r, K.H, p[1])))]; };
        add('ENDLAGE_MINUS', 8, end(0)); add('ENDLAGE_PLUS', 8, end(K.pts.length - 1));
      }
    }
    return Dxf.write(layers, { precision: state.cfg.precision != null ? state.cfg.precision : 3 });
  }
  // Maße als Texte im CAD (Ruder neutral): Hebel, Gestänge, Horn, dazu Wege und Ausschläge
  function cutTexts(i) {
    const G = geo(), c = cfg(), sv = srvList(c)[i], R = srvCalc(G, c, sv), K = R.lk; if (!R.arm) return;
    const z = clamp(R.arm.z0, 0, G.L), q = profOf(G, z), h = 2.5, c0 = state.cad, L = 'Bemaßung', put = (x, y, text) => c0.texts.push({ x: x - q.le, y, h, text, rot: 0, layer: L });
    if (!Array.isArray(c0.texts)) c0.texts = [];
    if (App.cadEnsureLayer) App.cadEnsureLayer(L);
    const below = R.arm.y1 < R.arm.y0, off = below ? -h - 1 : 1;
    { const TA = trimArm(sv, R); if (TA) put(TA.q[0], TA.q[1] + off - h - 1, T('Trimmung') + ' ' + (TA.tr > 0 ? '+' : '') + f1(TA.tr) + '°'); }
    put(R.arm.x1, R.arm.y1 + off, T('Hebel') + ' ' + f1(R.armLen) + ' mm, ' + f1(R.armDeg) + '°');
    if (K) {
      const m = [(K.T0[0] + K.hole[0]) / 2, (K.T0[1] + K.hole[1]) / 2];
      put(m[0], m[1] + 1, T('Gestänge') + ' ' + f1(K.rod) + ' mm');
      put(K.hole[0], K.hole[1] + off, T('Horn') + ' ' + f1(Math.hypot(K.hole[0] - K.H[0], K.hole[1] - K.H[1])) + ' mm, ' + f1(R.hornDeg) + '°');
      put(q.le, q.lo - 3 * h - 8, T('Servoweg') + ' −' + f1(K.rg.neg) + '° / +' + f1(K.rg.pos) + '°');
      put(q.le, q.lo - 5 * h - 8, T('Ruder oben') + ' ' + f1(K.up) + '° / ' + T('unten') + ' ' + f1(K.down) + '°, ' + T('Übersetzung') + ' ' + Math.abs(K.ratio).toFixed(2) + ' : 1');
    }
    if (App.buildSidebar) App.buildSidebar();
    if (App.renderCad) App.renderCad();
  }
  function cutToCad(i) {
    const t = cutDxf(i);
    if (!t) { if (App.toast) App.toast(T('Für diesen Servo gibt es keinen Schnitt.')); return; }
    const before = state.cad && state.cad.layers;
    App.cadImportDxfText(t, T('Servo') + ' ' + (i + 1));
    if (state.cad && state.cad.layers !== before) {   // nicht bei abgelehnter Rückfrage
      ['ENDLAGE_MINUS', 'ENDLAGE_PLUS'].forEach(n => { if (state.cad.layers[n]) { if (!state.cad.lineStyles) state.cad.lineStyles = {}; state.cad.lineStyles[n] = 'dashed'; } });
      if (state.cad.layers.TRIMMUNG) { if (!state.cad.layerColors) state.cad.layerColors = {}; state.cad.layerColors.TRIMMUNG = '#ff4d4d'; }
      cutTexts(i);
    }
    if (App.switchView && document.getElementById('cadView')) App.switchView('cad');
  }
  // ---------- Verkabelungsplan Sender live ----------
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function wiringSvg() {
    const t = (x, y, s, o) => '<text x="' + x + '" y="' + y + '"' + (o ? ' ' + o : '') + '>' + esc(T(s)) + '</text>';
    const mid = 'text-anchor="middle"', end = 'text-anchor="end"', b = 'font-weight="700"', sm = 'font-size="11"', mu = 'fill="#9aa7b8"';
    const box = (x, y, w, h, st) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="8" fill="#18202a" stroke="' + (st || '#5fd8e8') + '" stroke-width="1.4"/>';
    const pin = (x, y, col) => '<rect x="' + x + '" y="' + (y - 7) + '" width="13" height="14" rx="2" fill="' + col + '"/>';
    const ORG = '#ff9f43', RED = '#ff5b5b', BRN = '#c08850', GRN = '#7ee0a0';
    return '<svg viewBox="0 0 960 470" style="width:100%;display:block" font-family="sans-serif" font-size="12" fill="#c8d2e0">'
      + '<rect width="960" height="470" rx="8" fill="#10141a"/>'
      // Sender
      + box(20, 50, 150, 112) + '<line x1="150" y1="50" x2="161" y2="22" stroke="#5fd8e8" stroke-width="3"/><circle cx="161" cy="22" r="3" fill="#5fd8e8"/>'
      + t(95, 78, 'Jeti-Sender', mid + ' ' + b) + t(95, 96, 'DC / DS', mid) + t(95, 118, 'Trimmung, Mischer,', mid + ' ' + sm + ' ' + mu) + t(95, 133, 'Servowege, Kurven', mid + ' ' + sm + ' ' + mu) + t(95, 150, '(alles im Sender)', mid + ' ' + sm + ' ' + mu)
      + '<path d="M182 80 q10 15 0 30 M194 72 q14 23 0 46 M206 64 q18 31 0 62" stroke="#9aa7b8" stroke-width="1.5" fill="none"/>' + t(198, 150, '2,4 GHz', mid + ' ' + sm + ' ' + mu)
      // Empfänger
      + box(230, 40, 200, 190) + t(330, 64, 'Jeti-Empfänger', mid + ' ' + b)
      + pin(421, 92, '#3a4350') + t(414, 96, 'Servos (1 … n)', end)
      + pin(421, 124, '#ffd27a') + t(414, 128, 'Ausgang → EX Bus', end + ' fill="#ffd27a" ' + b)
      + pin(421, 156, '#3a4350') + t(414, 160, 'Akku / BEC', end)
      + t(330, 194, 'Gerät-Explorer: einen Ausgang', mid + ' ' + sm + ' ' + mu) + t(330, 209, '(z. B. Ext. oder E1) auf EX Bus', mid + ' ' + sm + ' ' + mu)
      // Servos
      + '<path d="M434 92 L470 62" stroke="#9aa7b8" stroke-width="1.5" fill="none"/><rect x="470" y="40" width="80" height="28" rx="4" fill="#18202a" stroke="#9aa7b8"/>' + t(510, 58, 'Servos', mid + ' ' + mu)
      // Servostecker und Adern
      + '<rect x="440" y="104" width="24" height="44" rx="3" fill="#2a3340" stroke="#9aa7b8"/>'
      + '<path d="M464 112 H515 l4 -6 l8 12 l8 -12 l8 12 l8 -12 l4 6 H600 V100 H640" stroke="' + ORG + '" stroke-width="2.5" fill="none"/>' + t(535, 97, '1 kΩ (optional)', mid + ' ' + sm + ' fill="' + ORG + '"')
      + '<path d="M464 126 H590 V156 H640" stroke="' + RED + '" stroke-width="2.5" stroke-dasharray="6 4" fill="none"/>'
      + '<path d="M464 140 H580 V184 H640" stroke="' + BRN + '" stroke-width="2.5" fill="none"/>'
      + t(444, 216, 'orange = Signal', sm + ' fill="' + ORG + '"') + t(444, 231, 'rot = + (nur Variante A)', sm + ' fill="' + RED + '"') + t(444, 246, 'braun = − (GND)', sm + ' fill="' + BRN + '"')
      // Adapter
      + box(640, 60, 180, 160) + t(730, 82, 'USB-Seriell-Adapter', mid + ' ' + b)
      + pin(634, 100, ORG) + t(653, 104, 'RXD') + pin(634, 128, '#3a4350') + t(653, 132, 'TXD – frei lassen', mu)
      + pin(634, 156, RED) + t(653, 160, '5 V') + pin(634, 184, BRN) + t(653, 188, 'GND')
      + t(730, 210, '3,3-V-Pegel', mid + ' ' + sm + ' ' + mu) + t(730, 240, 'z. B. FTDI FT232R, CP2102N, CH340', mid + ' ' + sm + ' ' + mu)
      // USB und PC
      + '<line x1="820" y1="140" x2="862" y2="140" stroke="#9aa7b8" stroke-width="5"/>' + t(841, 130, 'USB', mid + ' ' + sm + ' ' + mu)
      + box(862, 100, 86, 80) + t(905, 128, 'PC', mid + ' ' + b) + t(905, 146, 'AI Foam Cut', mid + ' ' + sm) + t(905, 162, 'Flächenservos', mid + ' ' + sm + ' ' + mu)
      // Akku
      + '<line x1="330" y1="230" x2="330" y2="262" stroke="' + GRN + '" stroke-width="2" stroke-dasharray="5 4"/>'
      + '<rect x="250" y="262" width="160" height="46" rx="6" fill="#18202a" stroke="' + GRN + '" stroke-dasharray="5 4"/>' + t(330, 282, 'Empfängerakku / BEC', mid) + t(330, 298, 'nur Variante B', mid + ' ' + sm + ' fill="' + GRN + '"')
      // Varianten
      + box(20, 330, 455, 120, RED) + t(34, 354, 'Variante A – nur Empfänger am Tisch', b + ' fill="' + RED + '"')
      + t(34, 376, 'Rote Ader (+) an 5 V des Adapters: USB versorgt den Empfänger.') + t(34, 396, 'Kein Akku, keine Servos am Empfänger – USB liefert nur 0,5 A.') + t(34, 416, 'Gut zum Zuordnen der Kanäle und Prüfen der Mischer.')
      + box(490, 330, 455, 120, GRN) + t(504, 354, 'Variante B – Empfänger im Modell mit Servos', b + ' fill="' + GRN + '"')
      + t(504, 376, 'Empfängerakku oder BEC versorgt Empfänger und Servos.') + t(504, 396, 'Rote Ader NICHT an den Adapter (abkleben), nur Signal und GND.') + t(504, 416, 'Motor abstecken oder Propeller ab, falls ein Regler dranhängt.')
      + '</svg>';
  }
  function wiringHelp() {
    const back = document.createElement('div'); back.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div'); box.style.cssText = 'width:min(94vw,1000px);max-height:92vh;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 16px;box-shadow:0 10px 40px rgba(0,0,0,.5);color:var(--txt);font-size:13px';
    const hd = document.createElement('div'); hd.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';
    const ti = document.createElement('b'); ti.style.flex = '1'; ti.textContent = T('Verkabelung: Jeti-Empfänger (EX Bus) → USB-Seriell-Adapter → PC');
    const x = document.createElement('button'); x.textContent = '✕'; x.title = T('Schließen'); x.style.padding = '2px 8px';
    hd.append(ti, x);
    const pic = document.createElement('div'); pic.innerHTML = wiringSvg();
    const ol = document.createElement('ol'); ol.style.cssText = 'margin:10px 0 2px 18px;padding:0;line-height:1.45';
    ['Im Sender den Gerät-Explorer öffnen, den Empfänger wählen und einen Ausgang (je nach Empfänger z. B. „Ext.“ oder „E1“) auf „EX Bus“ stellen. Die Geschwindigkeit (125 oder 250 kBaud) findet „Baudrate automatisch“ selbst.',
      'Adapter mit 3,3-V-Pegel verwenden (Umschalter auf 3,3 V, falls vorhanden). Er muss 125 000 Baud können: FTDI FT232R, CP2102N und CH340 können das, ältere CP2102 ohne „N“ treffen 125 000 Baud nicht genau.',
      'Nur RXD und GND anschließen, bei Variante A dazu 5 V. TXD bleibt frei: Die App hört nur mit und sendet nichts. Der Widerstand (1 kΩ) in der Signalleitung schützt bei Verwechslung, nötig ist er nicht.',
      'In der App „Sender verbinden“ drücken und den Anschluss des Adapters wählen. Im Kanal-Monitor wandert der gerade bewegte Kanal; dann je Servo unter „Sender (Kanal)“ den Kanal zuordnen.',
      'Trimmung, Mischer, Servowege und Kurven nur im Sender einstellen, die Kanäle kommen fertig gemischt an. Läuft ein Ruder in der Anzeige falsch herum, hier „Drehrichtung umkehren“ setzen.',
      'Bei Funkausfall schickt der Empfänger keine Kanalpakete; die Anzeige meldet dann „keine Daten“.'
    ].forEach(s => { const li = document.createElement('li'); li.textContent = T(s); ol.appendChild(li); });
    box.append(hd, pic, ol); back.appendChild(box);
    const close = () => { document.removeEventListener('keydown', key, true); back.remove(); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    x.onclick = close; back.addEventListener('mousedown', e => { if (e.target === back) close(); });
    document.addEventListener('keydown', key, true); document.body.appendChild(back);
  }
  function servoSidebar(side0) {
    const g = App.grp('Flächenservos', true, 'servo', { key: 'servoM', alwaysOpen: true });
    if (App.wingSelectEl) {
      const row = document.createElement('div'); row.className = 'row';
      const l = document.createElement('label'); l.textContent = T('Tragfläche');
      const s = App.wingSelectEl(); s.style.cssText = '';
      row.append(l, s); g.body.appendChild(row);
    }
    side = document.createElement('div'); side.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    g.body.appendChild(side); side0.appendChild(g.g);
    if (isOpen()) refresh(true);
  }
  App.servoSidebar = servoSidebar;
  window.Servos = { show, refresh, wiringHelp, _test: { cutDxf, srvCalc, lkRudder, srvRange, srvStick, srvStickZero, SERVOS, srvList, rxDeg, wiringSvg, peaks: () => rxPeak, cards: () => cards } };
})();
