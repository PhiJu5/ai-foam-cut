/* neglatte.js — Negativschalendesign: Schalen an einer GERADEN LATTE ausrichten.
 * Die Formüberstände vorne (Nase) und hinten (Endleiste) werden je Rippe so
 * verlängert, dass die Schalenränder ALLER Segmente der Tragfläche (Draufsicht)
 * auf einer geraden Linie liegen — als Rechteck (Linie parallel zur Spannweite)
 * oder, wenn möglich, als Trapez (schräge Linie, möglichst wenig Überstand).
 * Die Ränder werden als Vertikal-Vorschnitte gefahren (wie der konstante
 * Schalenrand), die Schnittverlängerung läuft automatisch um „Abstand" darüber
 * hinaus. Eigener Abbrand-Bezug (Profilschnitt/Sehnenverhältnis oder lokale
 * Bahngeschwindigkeit). Aktiv überschreibt das Menü Schneideweg, Schnittver-
 * längerung vorne/hinten und den konstanten Schalenrand.
 * Daten: cfg.negLatte (je Tragfläche über das neg*-Präfix). */
(function () {
  'use strict';
  const App = (window.App = window.App || {});
  const { T, state } = App;

  const DEF = { on: false, shape: 'trap', minF: 10, minR: 10, clear: 5, kerf: 'speed' };
  function cfgL() {
    const c = state.cfg;
    if (!c.negLatte || typeof c.negLatte !== 'object') c.negLatte = Object.assign({}, DEF);
    for (const k in DEF) if (c.negLatte[k] == null) c.negLatte[k] = DEF[k];
    return c.negLatte;
  }
  function on() { return !!(state.cfg.negLatte && state.cfg.negLatte.on); }

  /* Rippen der ganzen Tragfläche in Draufsicht-Koordinaten (global):
   * z = Spannweitenposition, xF/xT = vorderster/hinterster Profilpunkt. Die Cut-
   * Profile liegen je Segment lokal (Wurzel-Nase bei x=0, Rand bei x=Pfeilung);
   * der globale Versatz ist die Summe der Pfeilungen der Vorsegmente. */
  function ribs() {
    const cuts = (App.wing && App.wing.cuts) || [];
    const out = []; let z = 0, dx = 0;
    cuts.forEach((cut, k) => {
      ['root', 'tip'].forEach(rib => {
        if (rib === 'root' && k > 0) return;    // Stoßrippe nur einmal
        const pts = App.negRibPts ? App.negRibPts(cut, k, rib) : (rib === 'root' ? cut.root.pts : cut.tip.pts);
        let a = Infinity, b = -Infinity; for (const p of pts) { if (p.x < a) a = p.x; if (p.x > b) b = p.x; }
        out.push({ z: rib === 'root' ? z : z + (cut.span || 0), xF: a + dx, xT: b + dx });
      });
      z += cut.span || 0; dx += (cut.tip.pl && cut.tip.pl.leOffset) || 0;
    });
    return out;
  }
  /* Gerade x(z) = a + b·z, die alle Grenzpunkte auf EINER Seite hält
   * (side −1: x ≤ Grenze, vorne; +1: x ≥ Grenze, hinten) und dabei möglichst
   * nah an der Kontur liegt (Fläche zwischen Linie und Grenze minimal = Wert in
   * Spannweitenmitte maximal/minimal). Optimum liegt auf einer Hüllkanten-Geraden
   * durch zwei Grenzpunkte -> alle Paare prüfen; Rechteck = waagrechte Linie. */
  function fitLine(P, side, trap) {
    const zm = (P[0].z + P[P.length - 1].z) / 2;
    const ok = (a, b) => P.every(p => side * (a + b * p.z - p.x) >= -1e-6);
    const ext = side < 0 ? Math.min.apply(null, P.map(p => p.x)) : Math.max.apply(null, P.map(p => p.x));
    let best = { a: ext, b: 0 };
    if (trap) for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const dz = P[j].z - P[i].z; if (Math.abs(dz) < 1e-6) continue;
      const b = (P[j].x - P[i].x) / dz, a = P[i].x - b * P[i].z;
      if (ok(a, b) && side * ((a + b * zm) - (best.a + best.b * zm)) < 0) best = { a, b };
    }
    return best;
  }
  // Linien vorne/hinten + Überstand je Rippe (gecacht je Geometriestand).
  let cache = null, cacheKey = '';
  function lines() {
    const L = cfgL(), R = ribs();
    if (R.length < 2) return null;
    const key = JSON.stringify([L, R]);
    if (cache && key === cacheKey) return cache;
    const trap = L.shape === 'trap';
    const front = fitLine(R.map(r => ({ z: r.z, x: r.xF - Math.max(0, +L.minF || 0) })), -1, trap);
    const rear = fitLine(R.map(r => ({ z: r.z, x: r.xT + Math.max(0, +L.minR || 0) })), +1, trap);
    const at = (ln, z) => ln.a + ln.b * z;
    const rows = R.map(r => ({ z: r.z, xF: r.xF, xT: r.xT, f: r.xF - at(front, r.z), r: at(rear, r.z) - r.xT }));
    cacheKey = key;
    cache = { front, rear, rows, ribs: R, at };
    return cache;
  }
  /* Überstand (Abstand Profil -> Latte) vorne/hinten der Rippe `rib` von
   * Segment `idx` — null, wenn die Ausrichtung aus ist. */
  function edges(idx, rib) {
    if (!on()) return null;
    const S = lines(); if (!S) return null;
    idx = Math.max(0, Math.min(idx, S.rows.length - 2));
    const r = S.rows[rib === 'root' ? idx : idx + 1];
    return r ? { f: r.f, r: r.r, clear: Math.max(0, +cfgL().clear || 0) } : null;
  }
  // Abbrand-Bezug der Schnittverlängerung (überschreibt negKerfMode).
  function kerfMode() { return on() ? (cfgL().kerf === 'ratio' ? 'ratio' : 'speed') : null; }

  /* Draufsicht-Skizze: Profil-Nasen/-Endleisten aller Rippen + die beiden Latten. */
  function sketch(body) {
    const S = lines(); if (!S) return;
    const R = S.rows, W = 260, H = 150, pad = 8;
    const zs = R.map(r => r.z), xs = [];
    R.forEach(r => xs.push(r.xF - r.f, r.xT + r.r));
    const z0 = Math.min.apply(null, zs), z1 = Math.max.apply(null, zs);
    const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    const sc = Math.min((W - 2 * pad) / ((z1 - z0) || 1), (H - 2 * pad) / ((x1 - x0) || 1));
    const P = (z, x) => (pad + (z - z0) * sc).toFixed(1) + ',' + (pad + (x - x0) * sc).toFixed(1);
    const pl = (pts, st) => `<polyline points="${pts.join(' ')}" fill="none" ${st}/>`;
    const fr = R.map(r => P(r.z, r.xF)), te = R.map(r => P(r.z, r.xT));
    const lF = R.map(r => P(r.z, r.xF - r.f)), lR = R.map(r => P(r.z, r.xT + r.r));
    const ribL = R.map(r => `<line x1="${P(r.z, r.xF - r.f).split(',')[0]}" y1="${P(r.z, r.xF - r.f).split(',')[1]}" x2="${P(r.z, r.xT + r.r).split(',')[0]}" y2="${P(r.z, r.xT + r.r).split(',')[1]}" stroke="#8b98a8" stroke-width="0.6" stroke-dasharray="2 2"/>`).join('');
    const d = document.createElement('div'); d.className = 'row';
    d.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;background:rgba(0,0,0,.15);border-radius:4px">`
      + ribL + pl(fr, 'stroke="#57a8ff" stroke-width="1.4"') + pl(te, 'stroke="#57a8ff" stroke-width="1.4"')
      + pl(lF, 'stroke="#ffb454" stroke-width="1.6"') + pl(lR, 'stroke="#ffb454" stroke-width="1.6"') + '</svg>';
    body.appendChild(d);
    const rd = v => (Math.round(v * 10) / 10).toFixed(1);
    const tb = document.createElement('div'); tb.className = 'hint';
    tb.style.cssText = 'font-family:monospace;white-space:pre;font-size:11px';
    tb.textContent = T('Rippe   vorne  hinten (mm, Profil → Latte)') + '\n'
      + R.map((r, i) => String(i).padStart(5) + rd(r.f).padStart(8) + rd(r.r).padStart(8)).join('\n');
    body.appendChild(tb);
  }

  // Eigenes Menü im Reiter „Negativschalendesign".
  function rows(side) {
    const { grp, boolRow, selectRow, numRow, hint, buildSidebar, render } = App;
    const L = cfgL();
    const g = grp('Ausrichtung an gerader Latte', false, 'neg');
    hint(g.body, 'Verlängert die Formüberstände vorne und hinten je Rippe so, dass die Schalenränder aller Segmente '
      + 'in der Draufsicht auf EINER geraden Linie liegen — zum Ausrichten der Segmente an einer geraden Latte. '
      + 'Die Ränder werden als Vertikal-Vorschnitte gefahren, die Schnittverlängerung läuft automatisch darüber hinaus. '
      + 'Aktiv ersetzt dieses Menü Schneideweg, Schnittverlängerung vorne/hinten und den konstanten Schalenrand.');
    boolRow(g.body, 'Schalenränder an gerader Latte ausrichten', () => !!L.on,
      v => { L.on = v; buildSidebar(); render(); });
    if (L.on) {
      selectRow(g.body, 'Form der Gesamtfläche',
        [['trap', 'Trapez (schräge Linie, wenn möglich)'], ['rect', 'Rechteck (parallel zur Spannweite)']],
        () => L.shape, v => { L.shape = v; buildSidebar(); render(); },
        'Rechteck: Vorder- und Hinterkante liegen parallel zur Spannweite. Trapez: je eine schräge Gerade, die '
        + 'überall mindestens den Mindestüberstand einhält und dabei so wenig Werkstoff wie möglich verbraucht — '
        + 'ergibt bei gerader Pfeilung/Zuspitzung meist deutlich kleinere Überstände außen.');
      const nr = (lab, k, h) => numRow(g.body, lab, () => L[k], v => { L[k] = Math.max(0, v); buildSidebar(); render(); }, { min: 0, norender: true, hint: h });
      nr('Mindestüberstand vorne / Nase (mm)', 'minF', 'Kleinster Abstand Profilnase → Latte an irgendeiner Rippe.');
      nr('Mindestüberstand hinten / Endleiste (mm)', 'minR', 'Kleinster Abstand Endleiste → Latte an irgendeiner Rippe.');
      nr('Schnittverlängerung über Latte hinaus (mm)', 'clear', 'So weit läuft die Schnittverlängerung (Trennschnitt der Schalen) über den Schalenrand hinaus.');
      selectRow(g.body, 'Abbrand der Schnittverlängerung',
        [['speed', 'Aus lokaler Bahngeschwindigkeit'], ['ratio', 'Wie Profilschnitt (Sehnenverhältnis)']],
        () => L.kerf, v => { L.kerf = v; render(); },
        'Die Überstände sind NICHT proportional zur Sehne — „Aus lokaler Bahngeschwindigkeit" rechnet den Abbrand je '
        + 'Schnittstück aus der tatsächlichen Geschwindigkeit (genauer). „Wie Profilschnitt" nimmt einen Abbrand je '
        + 'Rippe aus dem Sehnenverhältnis. Ersetzt für die Negativschale die Einstellung im Menü „Abbrand".');
      sketch(g.body);
    }
    side.appendChild(g.g);
  }

  Object.assign(App, { negLatteOn: on, negLatteEdges: edges, negLatteKerf: kerfMode, negLatteLines: lines, negLatteRows: rows });
})();
